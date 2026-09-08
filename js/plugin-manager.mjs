import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { AppError, ensure } from "./errors.mjs";
import { replaceTable } from "./managed-config.mjs";

// Only the official Codex core is used, not CC Switch/Codex++ executables.
export async function locateCodexCore(status, environment = process.env, cacheRoot = null) {
  const explicit = environment.CODEX777_CLI;
  if (explicit && isAbsolute(explicit) && await access(explicit).then(() => true, () => false)) return explicit;
  const candidates = status.installDirectory
    ? [join(status.installDirectory, "app", "resources", "codex.exe"), join(status.installDirectory, "resources", "codex.exe")]
    : [];
  for (const source of candidates) {
    if (!isAbsolute(source) || !await access(source).then(() => true, () => false)) continue;
    if (!cacheRoot) return source;
    // WindowsApps binaries can be readable yet reject CreateProcess with EPERM
    // when launched by an unpackaged manager. Stage only the signed Codex core
    // into this manager's private runtime directory; never modify WindowsApps.
    const sourceStat = await stat(source);
    const token = createHash("sha256").update(`${source}\0${sourceStat.size}\0${sourceStat.mtimeMs}`).digest("hex").slice(0, 16);
    const runtimeRoot = join(cacheRoot, "runtime", "codex-core");
    const staged = join(runtimeRoot, `codex-${token}.exe`);
    await mkdir(runtimeRoot, { recursive: true });
    const stagedStat = await stat(staged).catch(() => null);
    if (stagedStat?.isFile() && stagedStat.size === sourceStat.size) return staged;
    const temporary = join(runtimeRoot, `.codex-${randomUUID()}.tmp`);
    try {
      await copyFile(source, temporary);
      const copied = await stat(temporary);
      ensure(copied.size === sourceStat.size, "Codex 管理内核暂存不完整", "CODEX_CORE_COPY_FAILED", 503);
      await rename(temporary, staged);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      if (error instanceof AppError) throw error;
      throw new AppError("无法准备 Codex 管理内核；WindowsApps 文件仍保持不变", "CODEX_CORE_COPY_FAILED", 503);
    }
    return staged;
  }
  throw new AppError("未找到当前 Codex 的管理内核，请先安装 Codex；此版不会改写插件缓存来伪造安装", "CODEX_CORE_MISSING", 503);
}

export class CodexRpc {
  constructor(executable, { codexRoot, cwd, timeoutMs = 20000, spawnProcess = spawn } = {}) {
    this.timeoutMs = timeoutMs; this.pending = new Map(); this.sequence = 0; this.closed = false;
    this.process = spawnProcess(executable, ["app-server", "--stdio"], { cwd, env: { ...process.env, CODEX_HOME: codexRoot }, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    const fail = (error) => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) { fail(new AppError("Codex 管理接口返回过大", "RPC_TOO_LARGE", 502)); this.close(); return; }
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.method && msg.id != null) { this.send({ id: msg.id, error: { code: -32601, message: "Interactive approval is not supported by this manager" } }); continue; }
        const pending = this.pending.get(msg.id); if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(msg.id);
        if (msg.error) pending.reject(new AppError(msg.error.code === -32601 ? "当前 Codex 版本不支持该插件管理接口" : "Codex 插件操作失败，可能需要授权或版本不兼容；未标记为成功", "PLUGIN_RPC_FAILED", 502));
        else pending.resolve(msg.result);
      }
    });
    this.process.stderr.resume(); // Do not persist possibly sensitive child output.
    this.process.stdin.on("error", () => fail(new AppError("Codex 管理连接已关闭", "RPC_CLOSED", 502)));
    this.process.on("error", () => { this.closed = true; fail(new AppError("Codex 管理内核启动失败", "RPC_START_FAILED", 503)); });
    this.process.on("exit", () => { this.closed = true; fail(new AppError("Codex 管理内核已退出", "RPC_CLOSED", 502)); });
  }
  send(value) { if (!this.closed && !this.process.stdin.destroyed) this.process.stdin.write(`${JSON.stringify(value)}\n`); }
  request(method, params = {}) {
    ensure(!this.closed, "Codex 管理连接已关闭", "RPC_CLOSED", 502);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AppError("Codex 管理请求超时，实际状态需刷新核对", "RPC_TIMEOUT", 504)); this.close(); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "777codex_manager", title: "777 Codex Manager", version: "0.10.0" }, capabilities: { experimentalApi: true } });
    this.send({ method: "initialized", params: {} });
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.process.stdin.end(); this.process.kill();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AppError("Codex 管理连接已关闭", "RPC_CLOSED", 502)); } this.pending.clear();
  }
}

export class PluginManager {
  constructor(config, createRpc) { this.config = config; this.createRpc = createRpc; }
  async withRpc(work) { const rpc = await this.createRpc(); try { await rpc.initialize(); return await work(rpc); } finally { rpc.close(); } }
  async catalog(rpc) {
    const result = await rpc.request("plugin/list", { forceRefetch: false, marketplaceKinds: ["local"] });
    ensure(Array.isArray(result?.marketplaces), "Codex 插件清单格式不兼容", "PLUGIN_SCHEMA_MISMATCH", 502);
    return result;
  }
  publicCatalog(result) {
    return { plugins: result.marketplaces.flatMap(m => (m.plugins || []).map(p => ({
      id: p.id, name: p.name, displayName: p.interface?.displayName || p.name, description: p.interface?.shortDescription || "",
      installed: Boolean(p.installed), enabled: Boolean(p.enabled), version: p.localVersion || p.version || "未提供",
      marketplace: m.name, sourceType: p.source?.type || "unknown", canInstall: Boolean(m.path) && p.installPolicy !== "NOT_AVAILABLE" && p.availability !== "DISABLED_BY_ADMIN",
      protected: p.installPolicy === "INSTALLED_BY_DEFAULT" || p.availability === "DISABLED_BY_ADMIN" || /@openai-(bundled|primary-runtime)$/.test(p.id),
    }))), warnings: (result.marketplaceLoadErrors || []).map(() => "有插件市场读取失败，清单可能不完整") };
  }
  async list() { return this.withRpc(async rpc => ({ ok: true, ...this.publicCatalog(await this.catalog(rpc)), revision: (await this.config.read()).revision })); }
  async toggle({ id, enabled, revision }) {
    ensure(typeof enabled === "boolean", "插件启停状态不合法");
    const list = await this.list(); const p = list.plugins.find(x => x.id === id);
    ensure(p?.installed && !p.protected, "插件未安装或为受保护组件，不能操作", "PLUGIN_PROTECTED", 409);
    return this.config.update(revision, `plugin:${enabled ? "enable" : "disable"}`, (text, data) => replaceTable(text, ["plugins", id], { ...(data.plugins?.[id] || {}), enabled }));
  }
  async install({ id }) {
    return this.withRpc(async rpc => {
      const catalog = await this.catalog(rpc); let found;
      for (const market of catalog.marketplaces) for (const plugin of market.plugins || []) if (plugin.id === id) found = { market, plugin };
      const pub = this.publicCatalog(catalog).plugins.find(p => p.id === id);
      ensure(found && pub.canInstall && !pub.protected, "此插件不可从当前本地市场安装", "PLUGIN_UNAVAILABLE", 409);
      ensure(!found.plugin.installed, "插件已安装；版本更新流程另行接入", "ALREADY_INSTALLED", 409);
      const result = await rpc.request("plugin/install", { marketplacePath: found.market.path, pluginName: found.plugin.name });
      const refreshed = this.publicCatalog(await this.catalog(rpc)).plugins.find(p => p.id === id);
      ensure(refreshed?.installed, "安装后尚未确认插件已注册，请刷新核对", "INSTALL_UNCONFIRMED", 502);
      return { ok: true, installed: true, needsAuth: Boolean(result?.appsNeedingAuth?.length), restartRequired: true };
    });
  }
  // Uninstall remains disabled until a versioned package backup/restore path is
  // validated. Toggling is available; no cache folders are silently deleted.
}
