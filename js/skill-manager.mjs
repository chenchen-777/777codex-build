import { mkdir, readFile, readdir, lstat, rename, writeFile, cp } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, basename } from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { ensure } from "./errors.mjs";
import { rejectLinks, revision } from "./managed-config.mjs";

const validName = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) && !["con", "prn", "aux", "nul", "constructor", "prototype"].includes(value) && !/^(com|lpt)[0-9]$/.test(value);
export function skillMetadata(text) {
  ensure(typeof text === "string" && Buffer.byteLength(text) <= 128 * 1024, "SKILL.md 最大 128 KB");
  const match = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  ensure(match, "SKILL.md 必须包含 YAML 头部（name 和 description）");
  let info; try { info = YAML.parse(match[1], { maxAliasCount: 0, uniqueKeys: true }); } catch { ensure(false, "Skill 元信息格式不正确"); }
  ensure(validName(info?.name), "Skill 名称只允许小写字母、数字及短横线，最长 64 字符");
  ensure(typeof info.description === "string" && info.description.trim() && info.description.length <= 2048, "请填写有效的 Skill description");
  ensure(text.slice(match[0].length).trim(), "Skill 正文不能为空");
  return { name: info.name, description: info.description };
}

export class SkillManager {
  constructor({ codexRoot, managerRoot, userRoot }) {
    this.roots = [{ id: "user", label: "用户级", path: resolve(userRoot) }, { id: "legacy", label: "Codex 用户级", path: join(resolve(codexRoot), "skills") }];
    this.trash = join(managerRoot, "skill-recovery");
  }
  target(scope, folder) {
    const root = this.roots.find(r => r.id === scope); ensure(root, "此版只管理用户级 Skill，不修改系统级和项目级目录");
    ensure(typeof folder === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(folder) && !["con", "prn", "aux", "nul", "constructor", "prototype"].includes(folder.toLowerCase()) && !/^(com|lpt)[0-9]$/i.test(folder), "Skill 目录名不合法");
    const target = resolve(root.path, folder); ensure(relative(root.path, target) === folder, "Skill 路径越界"); return target;
  }
  async list() {
    const skills = []; const warnings = [];
    for (const root of this.roots) {
      try {
        await rejectLinks(root.path);
        const entries = await readdir(root.path, { withFileTypes: true }).catch(e => { if (e.code === "ENOENT") return []; throw e; });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isSymbolicLink()) { skills.push({ folder: entry.name, scope: root.id, name: entry.name, protected: true, description: "链接目录，仅展示；请在来源目录维护" }); continue; }
          if (!entry.isDirectory()) continue;
          const pathname = join(root.path, entry.name, "SKILL.md");
          try {
            await rejectLinks(pathname); const text = await readFile(pathname, "utf8");
            let info; try { info = skillMetadata(text); } catch { info = { name: entry.name, description: "元信息无效，可编辑修复", invalid: true }; }
            skills.push({ ...info, folder: entry.name, scope: root.id, scopeLabel: root.label, path: pathname, revision: revision(text), protected: false });
          } catch (e) { if (e.code !== "ENOENT") warnings.push(`${entry.name}：无法安全读取`); }
        }
      } catch { warnings.push(`${root.label}目录不可访问或为链接，已跳过`); }
    }
    return { skills, warnings, roots: this.roots };
  }
  async read(scope, folder) {
    const target = this.target(scope, folder); await rejectLinks(join(target, "SKILL.md"));
    const text = await readFile(join(target, "SKILL.md"), "utf8");
    ensure(Buffer.byteLength(text) <= 128 * 1024, "此文件过大，无法在界面编辑");
    return { text, revision: revision(text) };
  }
  async snapshot(target, scope, folder, operation) {
    await this.validateTree(target); const id = randomUUID(); const directory = join(this.trash, id);
    await rejectLinks(directory); await mkdir(directory, { recursive: true });
    await cp(target, join(directory, "payload"), { recursive: true, errorOnExist: true, force: false, dereference: false });
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ id, scope, folder, operation, time: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return { id, directory };
  }
  async save({ scope = "user", folder, text, revision: expected, mode }) {
    const info = skillMetadata(text); const target = this.target(scope, folder || info.name); await rejectLinks(join(target, "SKILL.md"));
    ensure(["create", "edit"].includes(mode), "请明确新增还是编辑");
    if (mode === "create") {
      await mkdir(resolve(target, ".."), { recursive: true });
      await mkdir(target).catch(e => { if (e.code === "EEXIST") ensure(false, "同名目录已存在，请编辑现有 Skill", "SKILL_EXISTS", 409); throw e; });
      await writeFile(join(target, "SKILL.md"), text, { flag: "wx", mode: 0o600 });
      return { ok: true, name: info.name };
    }
    const current = await this.read(scope, folder);
    ensure(current.revision === expected, "Skill 已被修改，请刷新后重试", "SKILL_CHANGED", 409);
    const backup = await this.snapshot(target, scope, folder, "edit");
    const temporary = join(target, `.SKILL-${randomUUID()}.tmp`); await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    ensure((await this.read(scope, folder)).revision === expected, "Skill 已被外部修改，未覆盖", "SKILL_CHANGED", 409);
    await rename(temporary, join(target, "SKILL.md"));
    return { ok: true, recoveryId: backup.id };
  }
  async validateTree(path) {
    await rejectLinks(path); let bytes = 0; let count = 0;
    async function walk(dir, depth) {
      ensure(depth <= 16, "目录层级过深");
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        ensure(!entry.isSymbolicLink(), "Skill 含链接文件，停止导入／移除");
        ensure(++count <= 3000, "Skill 文件数量超过 3000"); const item = join(dir, entry.name);
        if (entry.isDirectory()) await walk(item, depth + 1);
        else { const s = await lstat(item); ensure(s.isFile(), "Skill 含不支持的文件类型"); bytes += s.size; ensure(bytes <= 64 * 1024 * 1024, "Skill 文件总大小不能超过 64 MB"); }
      }
    }
    await walk(path, 0);
  }
  async importDirectory({ source, scope = "user" }) {
    ensure(typeof source === "string" && isAbsolute(source), "请选择 Skill 的绝对目录"); await this.validateTree(source);
    const info = skillMetadata(await readFile(join(source, "SKILL.md"), "utf8")); const target = this.target(scope, info.name);
    await rejectLinks(target); ensure(!relative(source, target).startsWith("..") ? false : true, "来源目录不能包含目标目录");
    await mkdir(resolve(target, ".."), { recursive: true });
    // Reserve a new target; existing skills are never silently overwritten.
    await mkdir(target).catch(e => { if (e.code === "EEXIST") ensure(false, "同名 Skill 已存在，未覆盖", "SKILL_EXISTS", 409); throw e; });
    for (const name of await readdir(source)) await cp(join(source, name), join(target, name), { recursive: true, errorOnExist: true, force: false, dereference: false });
    return { ok: true, name: info.name, path: target };
  }
  async remove({ scope, folder, revision: expected }) {
    const target = this.target(scope, folder); const current = await this.read(scope, folder);
    ensure(current.revision === expected, "Skill 已变化，请刷新", "SKILL_CHANGED", 409);
    await this.validateTree(target); await rejectLinks(this.trash); await mkdir(this.trash, { recursive: true });
    const id = randomUUID(); const directory = join(this.trash, id); await mkdir(directory);
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ id, scope, folder, operation: "remove", time: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    await rename(target, join(directory, "payload"));
    return { ok: true, recoveryId: id, recoverable: true };
  }
  async recoveries() {
    await rejectLinks(this.trash); const entries = await readdir(this.trash).catch(e => { if (e.code === "ENOENT") return []; throw e; }); const rows = [];
    for (const id of entries.filter(x => /^[a-f0-9-]{36}$/.test(x))) {
      try { await rejectLinks(join(this.trash, id)); const row = JSON.parse(await readFile(join(this.trash, id, "manifest.json"), "utf8")); if (!row.restoredAt) rows.push(row); } catch { /* Partial recovery records are not offered. */ }
    }
    return rows.sort((a, b) => b.time.localeCompare(a.time));
  }
  async restore(id) {
    ensure(/^[a-f0-9-]{36}$/.test(String(id)), "恢复编号不合法"); const dir = join(this.trash, id); await rejectLinks(dir);
    const record = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")); ensure(record.id === id && !record.restoredAt, "恢复记录无效");
    const target = this.target(record.scope, record.folder); await rejectLinks(target);
    const payload = join(dir, "payload"); await this.validateTree(payload); skillMetadata(await readFile(join(payload, "SKILL.md"), "utf8"));
    ensure(!(await lstat(target).catch(e => { if (e.code === "ENOENT") return null; throw e; })), "目标已存在，未覆盖；请先移除当前版本再恢复", "TARGET_EXISTS", 409);
    await mkdir(resolve(target, ".."), { recursive: true }); await cp(payload, target, { recursive: true, errorOnExist: true, force: false });
    record.restoredAt = new Date().toISOString(); await writeFile(join(dir, "manifest.json"), JSON.stringify(record), { mode: 0o600 });
    return { ok: true, folder: basename(target) };
  }
}
