import TOML from "@iarna/toml";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, writeFile, rename, unlink, open, readdir } from "node:fs/promises";
import { join, resolve, parse as parsePath } from "node:path";
import { AppError, ensure } from "./errors.mjs";

export const revision = text => createHash("sha256").update(text).digest("hex");
export async function optionalRead(path) {
  try { return await readFile(path, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
export async function rejectLinks(path) {
  let current = resolve(path); const root = parsePath(current).root;
  while (current !== root) {
    const info = await lstat(current).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    ensure(!info?.isSymbolicLink(), "路径含符号链接或目录联接，请先选择普通目录", "LINK_NOT_ALLOWED");
    current = resolve(current, "..");
  }
}
export function parseConfig(text) {
  try { return TOML.parse(text || ""); } catch { throw new AppError("config.toml 格式有误，已停止写入；请先修复配置", "INVALID_TOML", 409); }
}
function keyPath(header) {
  const tokens = header.match(/"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_-]+/g) || [];
  return tokens.map(t => /^["']/.test(t) ? TOML.parse(`x = ${t}`).x : t);
}

// Find real TOML table headers, ignoring headers embedded in multiline strings
// and arrays. Replacements keep every unrelated byte and comment intact.
function blocks(text) {
  const result = []; let offset = 0; let quote = null; let depth = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const header = !quote && depth === 0 ? line.match(/^\s*(\[\[?)(.*?)\]\]?\s*(?:#.*)?(?:\r?\n)?$/) : null;
    if (header) { result.push({ start: offset, path: keyPath(header[2]), array: header[1] === "[[" }); offset += line.length; continue; }
    for (let i = 0; i < line.length; i++) {
      const c = line[i]; const triple = line.slice(i, i + 3);
      if (quote) {
        if (quote[0] === '"' && c === "\\") { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
      } else if (c === "#") break;
      else if (triple === '"""' || triple === "'''") { quote = triple; i += 2; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
    }
    offset += line.length;
  }
  return result.map((b, i) => ({ ...b, end: result[i + 1]?.start ?? text.length }));
}
function validatePath(path) {
  ensure(Array.isArray(path) && path.length && path.every(k => typeof k === "string" && k && !["__proto__", "prototype", "constructor"].includes(k)), "配置名称不合法");
}
export function replaceTable(text, path, value) {
  validatePath(path); const expected = parseConfig(text);
  let parent = expected;
  for (const part of path.slice(0, -1)) parent = parent[part] ??= {};
  const last = path.at(-1);
  if (value === null) delete parent[last]; else parent[last] = value;
  const targets = blocks(text).filter(b => path.every((p, i) => b.path[i] === p));
  let output = text;
  for (const b of targets.reverse()) output = output.slice(0, b.start) + output.slice(b.end);
  if (value !== null) {
    const wrapper = {}; let node = wrapper;
    for (const key of path.slice(0, -1)) node = node[key] = {};
    node[last] = value;
    output = `${output}${output.endsWith("\n") ? "" : "\n"}\n${TOML.stringify(wrapper)}`;
  }
  // Empty parents are semantically irrelevant and aren't always serialized.
  function prune(v) { if (!v || typeof v !== "object" || v instanceof Date) return v; for (const k of Object.keys(v)) { prune(v[k]); if (v[k] && !Array.isArray(v[k]) && typeof v[k] === "object" && !(v[k] instanceof Date) && !Object.keys(v[k]).length) delete v[k]; } return v; }
  let actual; try { actual = TOML.parse(output); } catch { throw new AppError("该条目使用内联或点号配置，无法安全局部修改；原配置未改动", "UNSUPPORTED_LAYOUT", 409); }
  ensure(isDeepStrictEqual(prune(actual), prune(expected)), "配置采用当前不支持的写法，已停止以保留其他设置", "UNSUPPORTED_LAYOUT", 409);
  return output;
}

export class ManagedConfig {
  constructor(codexRoot) { this.root = resolve(codexRoot); this.path = join(this.root, "config.toml"); this.backups = join(this.root, "777codex-extension-backups"); }
  async read() { await rejectLinks(this.path); const text = await optionalRead(this.path) ?? ""; return { text, data: parseConfig(text), revision: revision(text) }; }
  async update(expectedRevision, reason, transform) {
    await rejectLinks(this.path); await mkdir(this.root, { recursive: true });
    const lockPath = join(this.root, ".777codex-config.lock");
    const lock = await open(lockPath, "wx").catch(e => { if (e.code === "EEXIST") throw new AppError("另一个配置操作尚未完成，请稍后重试", "CONFIG_BUSY", 409); throw e; });
    const temp = join(this.root, `.777codex-${randomUUID()}.tmp`);
    try {
      const current = await this.read();
      ensure(typeof expectedRevision === "string" && expectedRevision === current.revision, "配置已变化，请刷新后重试", "CONFIG_CHANGED", 409);
      const next = await transform(current.text, current.data); parseConfig(next);
      if (next === current.text) return { ok: true, changed: false, revision: current.revision };
      const id = randomUUID(); const dir = join(this.backups, id);
      await rejectLinks(dir); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "config.toml"), current.text, { flag: "wx", mode: 0o600 });
      await writeFile(join(dir, "manifest.json"), JSON.stringify({ id, reason, time: new Date().toISOString(), sha256: current.revision }), { flag: "wx", mode: 0o600 });
      await writeFile(temp, next, { flag: "wx", mode: 0o600 });
      ensure((await this.read()).revision === current.revision, "外部程序刚刚修改了配置，请刷新后重试", "CONFIG_CHANGED", 409);
      await rename(temp, this.path);
      ensure(revision(await readFile(this.path, "utf8")) === revision(next), "配置写后校验失败，备份已保留", "WRITE_VERIFY_FAILED", 500);
      return { ok: true, changed: true, backupId: id, revision: revision(next), restartRequired: true };
    } finally { await unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); await lock.close(); await unlink(lockPath); }
  }
  async listBackups() {
    await rejectLinks(this.backups);
    const entries = await readdir(this.backups).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    const rows = [];
    for (const id of entries.filter(n => /^[a-f0-9-]{36}$/.test(n))) {
      await rejectLinks(join(this.backups, id));
      try { rows.push(JSON.parse(await readFile(join(this.backups, id, "manifest.json"), "utf8"))); } catch { /* Incomplete snapshots are not restoration candidates. */ }
    }
    return rows.sort((a, b) => b.time.localeCompare(a.time));
  }
  async restore(id, expectedRevision) {
    ensure(/^[a-f0-9-]{36}$/.test(String(id)), "备份编号不合法");
    const dir = join(this.backups, id); await rejectLinks(dir);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    const text = await readFile(join(dir, "config.toml"), "utf8");
    ensure(manifest.id === id && revision(text) === manifest.sha256, "备份校验失败，未恢复", "BACKUP_INVALID", 409);
    return this.update(expectedRevision, `restore:${id}`, () => text);
  }
}
