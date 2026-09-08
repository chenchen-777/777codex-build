import { access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "./errors.mjs";
import {macCodexStatus,launchMacCodex,stopMacCodex} from './macos-runtime.mjs';

export const OFFICIAL_WINDOWS_DOWNLOAD = "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi";
export const OFFICIAL_WINDOWS_MSIX = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-x64.msix";
export const OFFICIAL_INSTALLER_NAME = "ChatGPT-Codex-Official-Installer.exe";
export const OFFICIAL_MSIX_NAME = "ChatGPT-x64.msix";
export const EMBEDDED_INSTALLER_SHA256 = "998AFF4F44BEE9E1442CF1654E1A455E50345DA640DFE2BA19DA7E92D2A63F2A";
export const EMBEDDED_MSIX_SHA256 = "905B6136D03D7EF9E8C9D097A4A3FB13BB6E9C1815A017A390480DF49976CF02";

async function exists(pathname) {
  try { await access(pathname); return true; } catch { return false; }
}

async function sha256File(pathname) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

async function findNamedExecutable(root, depth = 0) {
  if (!root || depth > 5 || !(await exists(root))) return null;
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return null; }
  const direct = entries.find((entry) => entry.isFile() && /^chatgpt\.exe$/i.test(entry.name))
    || entries.find((entry) => entry.isFile() && /^codex\.exe$/i.test(entry.name));
  if (direct) return join(root, direct.name);
  for (const entry of entries) {
    if (!entry.isDirectory() || /^node_modules$|^resources$|^assets$/i.test(entry.name)) continue;
    const found = await findNamedExecutable(join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

export async function locateCodex(environment = process.env) {
  const candidates = [
    environment.CODEX_DESKTOP_PATH,
    "D:\\Codex\\app\\ChatGPT.exe",
    "D:\\Codex\\ChatGPT.exe",
    "D:\\Codex\\app\\Codex.exe",
    "D:\\Codex\\Codex.exe",
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, "Programs", "Codex", "ChatGPT.exe"),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, "Programs", "Codex", "Codex.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return findNamedExecutable("D:\\Codex");
}

async function readVersion(executable) {
  if (!executable) return null;
  const roots = [dirname(executable), "D:\\Codex"];
  for (const root of roots) {
    const manifest = join(root, "AppxManifest.xml");
    try {
      const text = await readFile(manifest, "utf8");
      return text.match(/<Identity\b[^>]*\bVersion="([^"]+)"/i)?.[1] || null;
    } catch {}
  }
  try { return (await stat(executable)).mtime.toISOString().slice(0, 10); } catch { return null; }
}

function execCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function execCaptureDetailed(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => resolve({ code: -1, stdout: "", stderr: String(error?.message || error) }));
    child.on("close", (code) => resolve({
      code: Number(code ?? -1),
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function windowsPowerShell(environment = process.env) {
  return join(environment.SystemRoot || environment.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function windowsPowerShellEnvironment(environment = process.env) {
  const windowsRoot = environment.SystemRoot || environment.WINDIR || "C:\\Windows";
  const moduleRoots = [
    environment.USERPROFILE && join(environment.USERPROFILE, "Documents", "WindowsPowerShell", "Modules"),
    environment.ProgramFiles && join(environment.ProgramFiles, "WindowsPowerShell", "Modules"),
    join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
  ].filter(Boolean);
  return { ...environment, PSModulePath: moduleRoots.join(";") };
}

function encodedPowerShell(script, environment = process.env) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const cleanEnvironment = windowsPowerShellEnvironment(environment);
  return execCaptureDetailed(windowsPowerShell(environment), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    env: cleanEnvironment,
  });
}

async function queryStoreCodex(environment = process.env) {
  if (process.platform !== "win32") return null;
  const script = [
    "$pkg = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue",
    "$pkg = $pkg | Sort-Object Version -Descending | Select-Object -First 1",
    "if ($pkg) { [pscustomobject]@{ Name=$pkg.Name; Version=$pkg.Version.ToString(); InstallLocation=$pkg.InstallLocation; PackageFullName=$pkg.PackageFullName } | ConvertTo-Json -Compress }",
  ].join("; ");
  const output = await execCapture(windowsPowerShell(environment), ["-NoProfile", "-NonInteractive", "-Command", script], { env: windowsPowerShellEnvironment(environment) });
  try { return output.trim() ? JSON.parse(output.trim()) : null; } catch { return null; }
}

export async function codexStatus(environment = process.env) {
  if(process.platform==='darwin')return macCodexStatus(environment);
  let target = null;
  if (environment.MANAGER777_INSTALL_TARGET_FILE) {
    try { target=JSON.parse(await readFile(environment.MANAGER777_INSTALL_TARGET_FILE,'utf8')); }
    catch(e) { if(e.code!=='ENOENT')throw new Error('安装目标记录损坏，请重新接管安装'); }
  }
  const targetExe = target?.source === 'portable' ? await findNamedExecutable(target.path) : null;
  if (target?.source === 'portable' && !targetExe) return { installed:false, running:false, source:'standalone', executable:null, installDirectory:target.path, canUninstall:false, version:null, processIds:[] };
  const executable = target ? targetExe : await locateCodex(environment);
  const storePackage = executable ? null : await queryStoreCodex(environment);
  const installDirectory = executable ? dirname(executable) : storePackage?.InstallLocation || null;
  const processIds = process.platform === 'win32' && installDirectory ? await queryCodexPids(installDirectory, environment) : [];
  return {
    installed: Boolean(executable || storePackage),
    executable: executable || (storePackage ? "codex://" : null),
    installDirectory,
    version: storePackage?.Version || await readVersion(executable),
    source: storePackage ? "microsoft-store" : executable ? "standalone" : null,
    packageFullName: storePackage?.PackageFullName || null,
    canUninstall: Boolean(storePackage?.PackageFullName),
    running: processIds.length > 0,
    processIds,
  };
}

export function validCodexPackageFullName(value) {
  return typeof value === "string" && /^OpenAI\.Codex_[0-9.]+_(?:x64|x86|arm64|neutral)__[a-z0-9]+$/i.test(value);
}

export async function uninstallCodex(environment = process.env, dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  if (platform !== "win32") throw new AppError("Codex 卸载仅支持 Windows", "CODEX_UNINSTALL_UNSUPPORTED", 409);
  const readStatus = dependencies.status || codexStatus;
  const runPowerShell = dependencies.runPowerShell || encodedPowerShell;
  const before = await readStatus(environment);
  if (!before.installed) throw new AppError("未检测到已安装的 Codex", "CODEX_NOT_INSTALLED", 404);
  if (before.source !== "microsoft-store" || !validCodexPackageFullName(before.packageFullName)) {
    throw new AppError("当前 Codex 不是可由本工具安全识别的 Microsoft Store 安装，请使用 Windows 应用设置卸载", "CODEX_UNINSTALL_UNSUPPORTED", 409);
  }
  if (before.running) {
    dependencies.onProgress?.('stopping');
    const stopped = await runPowerShell(scopedCodexScript(before.installDirectory, true), environment);
    if (stopped.code !== 0) throw new AppError("无法只关闭目标 Codex 进程，已停止卸载", "CODEX_STOP_FAILED", 409);
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$matches=@(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Where-Object { $_.PackageFullName -ceq $env:CODEX_PACKAGE_FULL_NAME })",
    "if ($matches.Count -ne 1) { throw 'Exact Codex package not found' }",
    "Remove-AppxPackage -Package $matches[0].PackageFullName -Confirm:$false -ErrorAction Stop",
    "$left=@(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Where-Object { $_.PackageFullName -ceq $env:CODEX_PACKAGE_FULL_NAME })",
    "if ($left.Count -ne 0) { throw 'Codex package still registered' }",
  ].join("; ");
  dependencies.onProgress?.('removing');
  const removed = await runPowerShell(script, { ...environment, CODEX_PACKAGE_FULL_NAME: before.packageFullName });
  if (removed.code !== 0) {
    const detail = (removed.stderr || removed.stdout).replace(/\s+/g, " ").trim().slice(0, 300);
    throw new AppError(`Codex 卸载失败：${detail || `PowerShell 退出码 ${removed.code}`}`, "CODEX_UNINSTALL_FAILED", 500);
  }
  dependencies.onProgress?.('verifying');
  const after = await readStatus(environment);
  if (after.installed) throw new AppError("卸载命令已完成，但仍检测到 Codex，未报告成功", "CODEX_UNINSTALL_UNCONFIRMED", 502);
  return { ok: true, uninstalled: true, stoppedProcessCount: before.processIds?.length || 0, managedDataRemoved: false };
}

export function scopedCodexScript(installDirectory, stop = false) {
  if (typeof installDirectory !== 'string' || !/^[A-Za-z]:[\\/].+/.test(installDirectory) || /[\r\n]/.test(installDirectory)) throw new Error('Codex 安装路径无效');
  const literal = installDirectory.replace(/'/g, "''");
  return `$ErrorActionPreference='Stop'; $targetDir=[IO.Path]::GetFullPath('${literal}').TrimEnd('\\'); if ($targetDir.Length -le 3) { throw 'Unsafe install directory' }; $prefix=$targetDir+'\\'; $matches=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -and $_.Name -match '^(ChatGPT|Codex)\\.exe$' }); ` +
    (stop ? `$matches | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }; Write-Output 'STOPPED'` : `$ids=@($matches | ForEach-Object { [int]$_.ProcessId }); ConvertTo-Json -InputObject $ids -Compress`);
}
async function queryCodexPids(installDirectory, environment) {
  const result = await encodedPowerShell(scopedCodexScript(installDirectory), environment);
  if (result.code !== 0) throw new Error('无法确认 Codex 进程状态，未执行启动或关闭');
  try { return JSON.parse(result.stdout.trim()); } catch { throw new Error('Codex 进程状态格式无效'); }
}

async function waitForCodexProcess(environment, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const status = await codexStatus(environment);
    if (status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  throw new Error("Codex 启动命令已执行，但未检测到客户端进程");
}

export async function launchCodex(environment = process.env, extraEnvironment = {}) {
  if(process.platform==='darwin')return launchMacCodex(environment,extraEnvironment);
  const statusBeforeLaunch = await codexStatus(environment);
  if (!statusBeforeLaunch.installed) throw new Error("未检测到 Codex，请先使用安装按钮安装官方客户端");
  const executable = statusBeforeLaunch.executable;
  // The Windows package must be activated through its registered protocol.
  // Starting app/ChatGPT.exe or the bundled Codex.exe directly can create
  // background helper processes without ever opening the desktop window.
  const useProtocol = process.platform === 'win32' && statusBeforeLaunch.source === 'microsoft-store';
  const command = useProtocol ? 'explorer.exe' : executable;
  const args = useProtocol ? ['codex://'] : [];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false, env: { ...environment, ...extraEnvironment } });
  child.unref();
  const status = await waitForCodexProcess(environment);
  return { ok: true, executable, activation: useProtocol ? "codex-protocol" : "direct", running: status.running };
}

export async function restartCodex(environment = process.env, extraEnvironment = {}) {
  if(process.platform==='darwin'){await stopMacCodex(environment);return launchMacCodex(environment,extraEnvironment);}
  const status = await codexStatus(environment);
  if (!status.installed) throw new Error("未检测到 Codex");
  if (process.platform === "win32") {
    const stopped = await encodedPowerShell(scopedCodexScript(status.installDirectory, true), environment);
    if (stopped.code !== 0) throw new Error('未能关闭目标 Codex 进程，已停止重启；未关闭其他程序');
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return launchCodex(environment, extraEnvironment);
}

export async function stopSelectedCodex(environment = process.env) {
  if(process.platform==='darwin')return stopMacCodex(environment);
  const status=await codexStatus(environment);
  if(status.installed&&status.running){const stopped=await encodedPowerShell(scopedCodexScript(status.installDirectory,true),environment);if(stopped.code!==0)throw new AppError('无法关闭选定的 Codex','CODEX_STOP_FAILED',409);}
}

export async function microsoftSignature(pathname, environment = process.env) {
  if (process.platform !== "win32") return { status: "Unavailable", signer: "" };
  const result = await encodedPowerShell([
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:CODEX_MSIX_PATH",
    "[pscustomobject]@{ status=$signature.Status.ToString(); signer=$signature.SignerCertificate.Subject; issuer=$signature.SignerCertificate.Issuer } | ConvertTo-Json -Compress",
  ].join("; "), { ...environment, CODEX_MSIX_PATH: pathname });
  try { return JSON.parse(result.stdout.trim()); } catch { return { status: "UnknownError", signer: "", diagnostic: `${result.stdout} ${result.stderr}`.trim().slice(0, 500) }; }
}

export async function downloadCodexInstaller(environment = process.env) {
  const embeddedMsix = environment.CODEX_EMBEDDED_MSIX;
  if (embeddedMsix && await exists(embeddedMsix)) {
    const info = await stat(embeddedMsix);
    if (info.size < 100_000_000) throw new Error("内置 Codex 完整安装包大小异常，已停止安装");
    const signature = await microsoftSignature(embeddedMsix, environment);
    const hash = await sha256File(embeddedMsix);
    if (hash !== EMBEDDED_MSIX_SHA256) throw new Error("内置 Codex 完整安装包校验失败，已停止安装");
    if (signature.status !== "Valid" || !/Microsoft Corporation/i.test(`${signature.signer || ""} ${signature.issuer || ""}`)) {
      throw new Error("内置 Codex 完整安装包不是有效的 Microsoft 签名包，已停止安装");
    }
    return {
      ok: true, path: embeddedMsix, size: info.size, sha256: hash,
      source: "bundled-official-msix", bundled: true, kind: "msix", signer: signature.signer, issuer: signature.issuer,
    };
  }
  const embedded = environment.CODEX_EMBEDDED_INSTALLER;
  if (embedded && await exists(embedded)) {
    const info = await stat(embedded);
    if (info.size < 10_000) throw new Error("内置官方安装引导包大小异常，已停止安装");
    const hash = await sha256File(embedded);
    if (hash !== EMBEDDED_INSTALLER_SHA256) throw new Error("内置官方安装引导包校验失败，已停止安装");
    return { ok: true, path: embedded, size: info.size, sha256: hash, source: "bundled-official-bootstrapper", bundled: true, kind: "bootstrapper" };
  }
  const userRoot = environment.USERPROFILE;
  if (!userRoot) throw new Error("无法定位下载目录");
  const downloads = join(userRoot, "Downloads");
  await mkdir(downloads, { recursive: true });
  const target = join(downloads, OFFICIAL_INSTALLER_NAME);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(OFFICIAL_WINDOWS_DOWNLOAD, { redirect: "follow", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`官方下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
    const info = await stat(target);
    if (info.size < 10_000) throw new Error("下载文件大小异常，已停止安装");
    return { ok: true, path: target, size: info.size, source: OFFICIAL_WINDOWS_DOWNLOAD, kind: "bootstrapper" };
  } finally {
    clearTimeout(timer);
  }
}

export async function installCodexMsix(pathname, environment = process.env) {
  if (process.platform !== "win32") throw new Error("Codex MSIX 仅支持在 Windows 上安装");
  const result = await encodedPowerShell(
    "Add-AppxPackage -Path $env:CODEX_MSIX_PATH -ForceApplicationShutdown -ErrorAction Stop",
    { ...environment, CODEX_MSIX_PATH: pathname },
  );
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`Codex 完整安装包安装失败：${detail || `PowerShell 退出码 ${result.code}`}`);
  }
  const status = await codexStatus(environment);
  if (!status.installed) throw new Error("安装命令已完成，但未检测到 Codex Microsoft Store 包");
  return { ok: true, installed: true, status };
}
