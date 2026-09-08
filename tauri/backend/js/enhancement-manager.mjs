import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { AppError } from "./errors.mjs";

export const CODEX_ZH_ARCHIVE_SHA256 = "7057C2C9E123AD7408CA1B0C4A2185DF20DAD33F563AD9E19B0F197CF089D7D3";

async function exists(pathname) {
  try { await access(pathname); return true; } catch { return false; }
}

async function sha256(pathname) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(pathname)) digest.update(chunk);
  return digest.digest("hex").toUpperCase();
}

function safeChild(root, ...parts) {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AppError("增强组件目录不安全，已停止操作", "UNSAFE_ENHANCEMENT_PATH", 500);
  }
  return target;
}

function powershell(environment) {
  return join(environment.SystemRoot || environment.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function runProcess(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    const stdout = []; const stderr = [];
    const timer = setTimeout(() => { child.kill(); }, options.timeoutMs || 15 * 60_000);
    child.stdout?.on("data", chunk => stdout.push(chunk));
    child.stderr?.on("data", chunk => stderr.push(chunk));
    child.on("error", error => { clearTimeout(timer); resolveResult({ code: -1, stdout: "", stderr: error.message }); });
    child.on("close", code => { clearTimeout(timer); resolveResult({ code: Number(code ?? -1), stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
}

function integratedInstaller(source) {
  const targetLine = "$targetRoot = Select-InstallRoot -DefaultRoot $defaultRoot -IsPreviousInstall ([bool]$previousRoot)";
  if (!source.includes(targetLine)) throw new AppError("内置汉化组件版本不兼容：缺少安装目录接口", "CODEX_ZH_COMPONENT_INCOMPATIBLE", 409);
  let result = source.replace(targetLine, '$targetRoot = Get-ExactInstallRoot $env:MANAGER777_CODEX_ZH_ROOT');
  const prompts = (result.match(/Read-Host "Press Enter to close"/g) || []).length;
  if (prompts !== 2) throw new AppError("内置汉化组件版本不兼容：结束流程已变化", "CODEX_ZH_COMPONENT_INCOMPATIBLE", 409);
  result = result.replaceAll('Read-Host "Press Enter to close"', 'Write-Host "MANAGER777_DONE"');
  return result;
}

async function readJson(pathname) {
  try { return JSON.parse(await readFile(pathname, "utf8")); } catch { return null; }
}

export class EnhancementManager {
  constructor({ managerRoot, componentArchive, codexStatus, openPath, environment = process.env, platform = process.platform, run = runProcess }) {
    this.managerRoot = managerRoot;
    this.componentArchive = componentArchive;
    this.codexStatus = codexStatus;
    this.openPath = openPath;
    this.environment = environment;
    this.platform = platform;
    this.run = run;
    this.targetRoot = safeChild(managerRoot, "Enhancements", "CodexZh");
    this.runtimeRoot = safeChild(managerRoot, "Components", "CodexZhRuntime");
    this.recoveryRoot = safeChild(managerRoot, "Recoveries", "CodexZh");
  }

  async status() {
    const official = await this.codexStatus(this.environment);
    const info = await readJson(join(this.targetRoot, "install-info.json"));
    const launcher = join(this.targetRoot, "Launch Chinese UI.vbs");
    const archiveExists = await exists(this.componentArchive);
    let componentValid = false;
    if (archiveExists) componentValid = await sha256(this.componentArchive) === CODEX_ZH_ARCHIVE_SHA256;
    return {
      ok: true,
      official: { installed: official.installed, version: official.version, source: official.source },
      codexZh: {
        installed: Boolean(info && await exists(launcher) && await exists(join(this.targetRoot, "app", info.ExeName || "ChatGPT.exe"))),
        compatible: Boolean(info && official.version && String(info.PackageVersion) === String(official.version)),
        installedVersion: info?.PackageVersion || null,
        installedAt: info?.InstalledAt || null,
        path: info ? this.targetRoot : null,
        componentAvailable: archiveExists,
        componentValid,
      },
      capabilities: [
        { id: "codex-zh", name: "中文界面", state: "available", description: "从当前官方 Codex 构建独立中文副本；官方安装不被修改。" },
        { id: "drawing-enhancement", name: "绘画增强", state: "planned", description: "面向 Image MCP 的提示词、任务阶段和结果操作增强。" },
        { id: "conversation-tools", name: "对话增强", state: "planned", description: "会话时间、历史定位和常用对话操作。" },
        { id: "plain-paste", name: "粘贴增强", state: "planned", description: "纯文本粘贴及长内容处理，需要适配当前 Codex 渲染层。" },
        { id: "drawing-stats", name: "绘画统计", state: "planned", description: "读取 Image MCP 的真实任务记录后统计模型、成功率和耗时。" },
        { id: "sql-tools", name: "SQL 工具", state: "planned", description: "数据库查询与结果查看，执行前明确连接范围和权限。" },
        { id: "user-scripts", name: "用户脚本", state: "planned", description: "受控加载可信脚本，展示权限、版本兼容性和回滚状态。" },
      ],
    };
  }

  async install() {
    if (this.platform !== "win32") throw new AppError("中文界面组件目前仅支持 Windows", "CODEX_ZH_WINDOWS_ONLY", 409);
    const official = await this.codexStatus(this.environment);
    if (!official.installed) throw new AppError("请先安装并至少启动一次官方 Codex", "CODEX_NOT_INSTALLED", 404);
    if (!await exists(this.componentArchive)) throw new AppError("安装包中缺少中文界面组件", "CODEX_ZH_COMPONENT_MISSING", 500);
    if (await sha256(this.componentArchive) !== CODEX_ZH_ARCHIVE_SHA256) throw new AppError("中文界面组件校验失败，已停止安装", "CODEX_ZH_COMPONENT_HASH_MISMATCH", 409);

    await mkdir(dirname(this.runtimeRoot), { recursive: true });
    await rm(this.runtimeRoot, { recursive: true, force: true });
    await mkdir(this.runtimeRoot, { recursive: true });
    const extract = await this.run(powershell(this.environment), ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:MANAGER777_ZH_ARCHIVE -DestinationPath $env:MANAGER777_ZH_RUNTIME -Force"], {
      env: { ...this.environment, MANAGER777_ZH_ARCHIVE: this.componentArchive, MANAGER777_ZH_RUNTIME: this.runtimeRoot },
    });
    if (extract.code !== 0) throw new AppError(`无法展开中文界面组件：${(extract.stderr || extract.stdout).replace(/\s+/g, " ").trim().slice(0, 220)}`, "CODEX_ZH_EXTRACT_FAILED", 500);

    const kitRoot = join(this.runtimeRoot, "codex-zh-release-kit", "win");
    const sourceInstaller = join(kitRoot, "install-user-copy.ps1");
    const managedInstaller = join(kitRoot, "install-managed.ps1");
    await writeFile(managedInstaller, integratedInstaller(await readFile(sourceInstaller, "utf8")), "utf8");

    let recovery = null;
    if (await exists(this.targetRoot)) {
      await mkdir(this.recoveryRoot, { recursive: true });
      recovery = safeChild(this.recoveryRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-before-reinstall`);
      await rename(this.targetRoot, recovery);
    }
    try {
      await mkdir(dirname(this.targetRoot), { recursive: true });
      const installed = await this.run(powershell(this.environment), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", managedInstaller], {
        env: { ...this.environment, MANAGER777_CODEX_ZH_ROOT: this.targetRoot }, timeoutMs: 20 * 60_000,
      });
      if (installed.code !== 0) throw new AppError(`中文界面构建失败：${(installed.stderr || installed.stdout).replace(/\s+/g, " ").trim().slice(-260)}`, "CODEX_ZH_INSTALL_FAILED", 500);
      const after = await this.status();
      if (!after.codexZh.installed) throw new AppError("构建命令已完成，但未检测到可启动的中文副本", "CODEX_ZH_INSTALL_UNCONFIRMED", 502);
      await this.cleanupDesktopArtifacts();
      return { ...after, recoveryCreated: Boolean(recovery), message: after.codexZh.compatible ? "中文界面已构建，可从增强页启动" : "中文界面已构建，但版本信息与官方客户端不一致" };
    } catch (error) {
      if (await exists(this.targetRoot)) await rm(this.targetRoot, { recursive: true, force: true });
      if (recovery && await exists(recovery)) await rename(recovery, this.targetRoot);
      throw error;
    }
  }

  async launch() {
    const state = await this.status();
    if (!state.codexZh.installed) throw new AppError("中文界面尚未安装", "CODEX_ZH_NOT_INSTALLED", 404);
    if (!state.codexZh.compatible) throw new AppError("官方 Codex 已更新，请先重新构建中文界面", "CODEX_ZH_REBUILD_REQUIRED", 409);
    const launcher = join(this.targetRoot, "Launch Chinese UI.vbs");
    const message = await this.openPath(launcher);
    if (message) throw new AppError(`无法启动中文界面：${message}`, "CODEX_ZH_LAUNCH_FAILED", 500);
    return { ok: true, launched: true, path: launcher };
  }

  async remove() {
    if (!await exists(this.targetRoot)) throw new AppError("中文界面尚未安装", "CODEX_ZH_NOT_INSTALLED", 404);
    await mkdir(this.recoveryRoot, { recursive: true });
    const recovery = safeChild(this.recoveryRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-removed`);
    await rename(this.targetRoot, recovery);
    await this.cleanupDesktopArtifacts();
    return { ok: true, installed: false, recovery, message: "中文副本已移到恢复区；官方 Codex 和用户会话均未删除" };
  }

  async recoveries() {
    let rows = [];
    try { rows = await readdir(this.recoveryRoot, { withFileTypes: true }); } catch {}
    const recoveries = [];
    for (const row of rows.filter(row => row.isDirectory())) {
      const path = safeChild(this.recoveryRoot, row.name);
      const info = await readJson(join(path, "install-info.json"));
      const details = await stat(path);
      recoveries.push({ id: row.name, version: info?.PackageVersion || null, time: details.mtime.toISOString() });
    }
    return { ok: true, recoveries: recoveries.sort((a, b) => b.time.localeCompare(a.time)) };
  }

  async restore(id) {
    if (!/^[0-9TZ-]+-(?:before-reinstall|removed)$/.test(String(id))) throw new AppError("恢复记录编号无效", "INVALID_RECOVERY_ID", 400);
    const source = safeChild(this.recoveryRoot, id);
    if (!await exists(join(source, "install-info.json"))) throw new AppError("恢复记录不存在或不完整", "RECOVERY_NOT_FOUND", 404);
    if (await exists(this.targetRoot)) throw new AppError("请先卸载当前中文界面，再恢复旧版本", "CODEX_ZH_ALREADY_INSTALLED", 409);
    await mkdir(dirname(this.targetRoot), { recursive: true });
    await rename(source, this.targetRoot);
    return this.status();
  }

  async cleanupDesktopArtifacts() {
    const desktop = this.environment.USERPROFILE && join(this.environment.USERPROFILE, "Desktop");
    if (!desktop) return;
    for (const name of ["Codex Zh.lnk", "ChatGPT Zh.lnk", "Debug Codex Zh.bat", "Debug ChatGPT Zh.bat"]) {
      await rm(join(desktop, name), { force: true }).catch(() => {});
    }
  }
}
