import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AppError } from "./errors.mjs";

export const PLUGIN_REPAIR_ARCHIVE_SHA256 = "E4A8682246938CECC0B70E2A253B89F49410654B5F0438332DEB19D34BBEDF2C";

async function exists(pathname) { try { await access(pathname); return true; } catch { return false; } }
async function sha256(pathname) { const digest = createHash("sha256"); for await (const chunk of createReadStream(pathname)) digest.update(chunk); return digest.digest("hex").toUpperCase(); }
function safeChild(root, ...parts) {
  const base = resolve(root); const target = resolve(base, ...parts);
  if (target === base || !target.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) throw new AppError("插件修复目录不安全，已停止操作", "UNSAFE_PLUGIN_REPAIR_PATH", 500);
  return target;
}
function powershell(environment) { return join(environment.SystemRoot || environment.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"); }
function windowsTar(environment) { return join(environment.SystemRoot || environment.WINDIR || "C:\\Windows", "System32", "tar.exe"); }
function runProcess(command, args, options = {}) {
  return new Promise(resolveResult => {
    const child = spawn(command, args, { windowsHide: true, ...options }); const stdout = []; const stderr = [];
    const timer = setTimeout(() => child.kill(), options.timeoutMs || 5 * 60_000);
    child.stdout?.on("data", chunk => stdout.push(chunk)); child.stderr?.on("data", chunk => stderr.push(chunk));
    child.on("error", error => { clearTimeout(timer); resolveResult({ code: -1, stdout: "", stderr: error.message }); });
    child.on("close", code => { clearTimeout(timer); resolveResult({ code: Number(code ?? -1), stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
}
async function anyCodexClientRunning(environment) {
  if (process.platform !== "win32") return false;
  const result = await runProcess(powershell(environment), ["-NoProfile", "-NonInteractive", "-Command", "$items=@(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue); Write-Output $items.Count"], { env: environment, timeoutMs: 20_000 });
  if (result.code !== 0 || !/^\d+$/.test(result.stdout.trim())) throw new AppError("无法确认 Codex 是否已关闭，已停止修复", "CODEX_PROCESS_CHECK_FAILED", 503);
  return Number(result.stdout.trim()) > 0;
}
async function rejectLinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name); const info = await lstat(path);
    if (info.isSymbolicLink()) throw new AppError("插件修复包包含链接，已拒绝安装", "PLUGIN_REPAIR_LINK_REJECTED", 409);
    if (entry.isDirectory()) await rejectLinks(path);
  }
}
async function validMarketplace(pathname) {
  try { const value = JSON.parse(await readFile(pathname, "utf8")); return Boolean(value && typeof value === "object" && !Array.isArray(value)); } catch { return false; }
}
async function locateRepairCandidate(stagingRoot, manifestFor) {
  if (await validMarketplace(manifestFor(stagingRoot))) return stagingRoot;
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pathname = safeChild(stagingRoot, entry.name);
    if (await validMarketplace(manifestFor(pathname))) candidates.push(pathname);
  }
  if (candidates.length !== 1) return null;
  return candidates[0];
}
function validateArchiveListing(value) {
  const entries = String(value).split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  if (!entries.length) throw new AppError("插件修复包为空，已停止操作", "PLUGIN_REPAIR_INVALID_PACKAGE", 409);
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..")) {
      throw new AppError("插件修复包包含不安全路径，已停止操作", "PLUGIN_REPAIR_UNSAFE_ARCHIVE", 409);
    }
  }
}

export class PluginRepairManager {
  constructor({ codexRoot, managerRoot, componentArchive, codexStatus, environment = process.env, platform = process.platform, run = runProcess, isCodexRunning = anyCodexClientRunning }) {
    this.codexRoot = codexRoot; this.managerRoot = managerRoot; this.componentArchive = componentArchive;
    this.codexStatus = codexStatus; this.environment = environment; this.platform = platform; this.run = run; this.isCodexRunning = isCodexRunning;
    this.targetRoot = safeChild(codexRoot, ".tmp", "plugins");
    this.backupRoot = safeChild(codexRoot, ".tmp", "plugin-repair-backups");
    this.stagingRoot = safeChild(managerRoot, "Components", "PluginRepairStaging");
  }
  manifest(root = this.targetRoot) { return join(root, ".agents", "plugins", "marketplace.json"); }
  async status() {
    const archiveExists = await exists(this.componentArchive);
    const installed = await validMarketplace(this.manifest());
    const manifestStat = installed ? await stat(this.manifest()) : null;
    return { ok: true, installed, repairedAt: manifestStat?.mtime.toISOString() || null, componentAvailable: archiveExists, componentValid: archiveExists ? await sha256(this.componentArchive) === PLUGIN_REPAIR_ARCHIVE_SHA256 : false, target: this.targetRoot };
  }
  async assertCodexClosed() {
    const status = await this.codexStatus(this.environment);
    if (status.running || await this.isCodexRunning(this.environment)) throw new AppError("请先关闭所有 Codex 窗口，再执行插件修复；本工具不会强制结束正在使用的客户端", "CODEX_MUST_BE_CLOSED", 409);
  }
  async repair() {
    if (this.platform !== "win32") throw new AppError("插件修复目前仅支持 Windows", "PLUGIN_REPAIR_WINDOWS_ONLY", 409);
    await this.assertCodexClosed();
    if (!await exists(this.componentArchive)) throw new AppError("安装包中缺少插件修复组件", "PLUGIN_REPAIR_COMPONENT_MISSING", 500);
    if (await sha256(this.componentArchive) !== PLUGIN_REPAIR_ARCHIVE_SHA256) throw new AppError("插件修复组件校验失败，已停止操作", "PLUGIN_REPAIR_HASH_MISMATCH", 409);
    await rm(this.stagingRoot, { recursive: true, force: true }); await mkdir(this.stagingRoot, { recursive: true });
    const archiveEntries = await this.run(windowsTar(this.environment), ["-tf", this.componentArchive], { env: this.environment, timeoutMs: 60_000 });
    if (archiveEntries.code !== 0) { await rm(this.stagingRoot, { recursive: true, force: true }); throw new AppError(`无法读取插件修复包目录：${(archiveEntries.stderr || archiveEntries.stdout).replace(/\s+/g, " ").trim().slice(0, 220)}`, "PLUGIN_REPAIR_EXTRACT_FAILED", 500); }
    validateArchiveListing(archiveEntries.stdout);
    const expanded = await this.run(windowsTar(this.environment), ["-xf", this.componentArchive, "-C", this.stagingRoot], { env: this.environment, timeoutMs: 5 * 60_000 });
    if (expanded.code !== 0) { await rm(this.stagingRoot, { recursive: true, force: true }); throw new AppError(`插件修复包展开失败：${(expanded.stderr || expanded.stdout).replace(/\s+/g, " ").trim().slice(0, 220)}`, "PLUGIN_REPAIR_EXTRACT_FAILED", 500); }
    await rejectLinks(this.stagingRoot);
    const candidate = await locateRepairCandidate(this.stagingRoot, root => this.manifest(root));
    if (!candidate) { await rm(this.stagingRoot, { recursive: true, force: true }); throw new AppError("插件修复包不完整、包含多个根目录或 marketplace.json 无效", "PLUGIN_REPAIR_INVALID_PACKAGE", 409); }
    await mkdir(this.backupRoot, { recursive: true }); let backup = null;
    if (await exists(this.targetRoot)) { backup = safeChild(this.backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-before-repair`); await rename(this.targetRoot, backup); }
    try {
      await mkdir(resolve(this.targetRoot, ".."), { recursive: true }); await rename(candidate, this.targetRoot);
      if (!await validMarketplace(this.manifest())) throw new AppError("修复完成后校验失败，已自动恢复旧插件目录", "PLUGIN_REPAIR_UNCONFIRMED", 502);
      return { ...await this.status(), backupCreated: Boolean(backup), restartRequired: true, message: "插件入口已修复，请重新启动 Codex 后检查 Plugins" };
    } catch (error) {
      await rm(this.targetRoot, { recursive: true, force: true });
      if (backup && await exists(backup)) await rename(backup, this.targetRoot);
      throw error;
    } finally { await rm(this.stagingRoot, { recursive: true, force: true }); }
  }
  async recoveries() {
    let entries = []; try { entries = await readdir(this.backupRoot, { withFileTypes: true }); } catch {}
    const recoveries = [];
    for (const entry of entries.filter(item => item.isDirectory())) {
      const path = safeChild(this.backupRoot, entry.name); if (!await validMarketplace(this.manifest(path))) continue;
      recoveries.push({ id: entry.name, time: (await stat(path)).mtime.toISOString() });
    }
    return { ok: true, recoveries: recoveries.sort((a, b) => b.time.localeCompare(a.time)) };
  }
  async restore(id) {
    await this.assertCodexClosed();
    if (!/^[0-9TZ-]+(?:-[a-f0-9]{8})?-before-repair$/.test(String(id))) throw new AppError("插件恢复记录编号无效", "INVALID_PLUGIN_RECOVERY_ID", 400);
    const source = safeChild(this.backupRoot, id);
    if (!await validMarketplace(this.manifest(source))) throw new AppError("插件恢复记录不存在或不完整", "PLUGIN_RECOVERY_NOT_FOUND", 404);
    const displaced = await exists(this.targetRoot) ? safeChild(this.backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-before-repair`) : null;
    if (displaced) await rename(this.targetRoot, displaced);
    try { await rename(source, this.targetRoot); return { ...await this.status(), restartRequired: true, message: "插件目录已恢复，请重新启动 Codex" }; }
    catch (error) { if (displaced && await exists(displaced) && !await exists(this.targetRoot)) await rename(displaced, this.targetRoot); throw error; }
  }
}
