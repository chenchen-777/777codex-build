import { app, BrowserWindow, safeStorage, shell, ipcMain, dialog, screen } from "electron";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configureRuntimeAdapters, server, ready, audit, getBusyOperation, offerPlatformImport, runtimeIsolated, reportImportLinkError } from "../scripts/server.mjs";
import { createImportProtocol } from './import-protocol.mjs';
import { createImportReceiver, importLaunchData } from './import-receiver.mjs';
import { compactWindowBounds } from '../js/window-layout.mjs';

app.disableHardwareAcceleration();
app.setName("777Codex 0.11 Candidate");
if (process.env.APPDATA) app.setPath("userData", join(process.env.APPDATA, "777Codex-0.11-Candidate-window"));
const importProtocol = createImportProtocol({ app, executable: process.execPath, isolated: runtimeIsolated });
let mainWindow = null; let rendererUrl = ""; let warningOpen = false;
let windowExpanded = false;
const importReceiver = createImportReceiver({ app, argv: process.argv, offer: offerPlatformImport, reportError: reportImportLinkError, record: entry => audit.record(entry), getWindow: () => mainWindow });
const gotLock = app.requestSingleInstanceLock(importLaunchData(process.argv));
function cleanupPreviousUpdateTask() {
  if(process.platform!=='win32')return;
  try {
    const updateRoot = join(process.env.APPDATA, '777Codex-0.11-Candidate', 'Updates');
    const statePath = join(updateRoot, 'update-launch.json');
    if (!existsSync(statePath)) return;
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.taskName !== '777Codex-Update' && !/^777Codex-Update-r\d+-\d+$/.test(String(state.taskName || ''))) return;
    const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    spawnSync(join(windowsRoot, 'System32', 'schtasks.exe'), ['/Delete', '/TN', state.taskName, '/F'], { windowsHide: true, encoding: 'utf8' });
  } catch {}
}
async function explainBusy() {
  if (warningOpen || !mainWindow) return;
  warningOpen = true;
  try { await dialog.showMessageBox(mainWindow, { type: "info", title: "操作尚未完成", message: "正在执行安装或配置操作，请等待完成后再关闭。", buttons: ["继续等待"] }); }
  finally { warningOpen = false; }
}
function trustedSender(event) { return mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === rendererUrl; }
ipcMain.handle("777:window:minimize", event => { if (!trustedSender(event)) throw new Error("非法窗口来源"); mainWindow.minimize(); return true; });
ipcMain.handle("777:window:toggle-size", event => {
  if (!trustedSender(event)) throw new Error("非法窗口来源");
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  windowExpanded = !windowExpanded;
  const size = compactWindowBounds(area, windowExpanded);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setMinimumSize(size.minWidth, size.minHeight);
  mainWindow.setBounds({width:size.width,height:size.height,x:area.x+Math.floor((area.width-size.width)/2),y:area.y+Math.floor((area.height-size.height)/2)});
  return { expanded: windowExpanded };
});
ipcMain.handle("777:window:close", event => { if (!trustedSender(event)) throw new Error("非法窗口来源"); if (getBusyOperation()) { void explainBusy(); return { busy: true }; } mainWindow.close(); return { busy: false }; });

function createWindow(url) {
  rendererUrl = `${url}/`;
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    ...compactWindowBounds(workArea), show: false, frame: false,
    title: "777 Codex · 折叠便携版 r43", backgroundColor: "#f3f6fa", autoHideMenuBar: true,
    icon: fileURLToPath(new URL(process.platform==='darwin'?'../assets/777codes-logo.png':'../assets/777codes.ico', import.meta.url)),
    webPreferences: { preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => { if (target !== rendererUrl) event.preventDefault(); });
  mainWindow.webContents.on("render-process-gone", () => { void audit.record({ action: "window:renderer-exited", outcome: "error", code: "RENDERER_EXITED" }).catch(() => {}); });
  mainWindow.on("close", event => { if (getBusyOperation()) { event.preventDefault(); void explainBusy(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(rendererUrl).then(async () => {
    mainWindow.show(); mainWindow.focus();
    if(process.platform==='darwin' && runtimeIsolated && process.env.MANAGER777_MAC_SMOKE) {
      const {runMacSmoke}=await import('./mac-smoke.mjs');
      await runMacSmoke({app,window:mainWindow});
    }
  });
}

app.whenReady().then(async () => {
  if (!gotLock) { await ready; server.close(); app.quit(); return; }
  cleanupPreviousUpdateTask();
  for (const delay of [4000, 12000, 30000]) setTimeout(cleanupPreviousUpdateTask, delay);
  delete process.env.CODEX_EMBEDDED_MSIX;
  delete process.env.CODEX_EMBEDDED_INSTALLER;
  process.env.CODEX_ZH_COMPONENT_ARCHIVE = app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", "components", "codex-zh", "release-kit.zip")
    : fileURLToPath(new URL("../components/codex-zh/release-kit.zip", import.meta.url));
  configureRuntimeAdapters({
    protect(value) { if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，拒绝保存 Key"); return safeStorage.encryptString(String(value)).toString("base64"); },
    unprotect(value) { if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用"); return safeStorage.decryptString(Buffer.from(String(value), "base64")); },
    openExternal(url) { return shell.openExternal(url); }, openPath(path) { return shell.openPath(path); },
    importProtocolState: importProtocol.state,
    registerImportProtocol: importProtocol.ensureRegistered,
    async scheduleManagerUpdate(plan) {
      const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const powershell = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const schtasks = join(windowsRoot, 'System32', 'schtasks.exe');
      const logRoot = join(plan.managerRoot, 'Updates'); mkdirSync(logRoot, { recursive: true });
      for (const value of [powershell, schtasks, plan.helperPath, plan.planPath]) if (String(value).includes('"')) throw new Error('更新路径包含不支持的字符');
      const taskName = '777Codex-Update';
      const launcherPath = join(logRoot, 'run-update.cmd');
      writeFileSync(launcherPath, `@echo off\r\n"${powershell}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${plan.helperPath}" -Plan "${plan.planPath}" -TaskName "${taskName}" >> "${join(logRoot, 'update-launcher.log')}" 2>&1\r\n`, 'utf8');
      const start = new Date(Date.now() + 10 * 60_000); const startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
      const created = spawnSync(schtasks, ['/Create', '/TN', taskName, '/TR', `"${launcherPath}"`, '/SC', 'ONCE', '/ST', startTime, '/F', '/RL', 'LIMITED', '/IT'], { encoding: 'utf8', windowsHide: true });
      if (created.error || created.status !== 0) throw new Error('无法创建一次性更新任务');
      const launched = spawnSync(schtasks, ['/Run', '/TN', taskName], { encoding: 'utf8', windowsHide: true });
      if (launched.error || launched.status !== 0) {
        spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { windowsHide: true });
        throw new Error('无法启动一次性更新任务');
      }
      const disabled = spawnSync(schtasks, ['/Change', '/TN', taskName, '/DISABLE'], { encoding: 'utf8', windowsHide: true });
      if (disabled.error || disabled.status !== 0) {
        const removed = spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { encoding: 'utf8', windowsHide: true });
        if (removed.error || removed.status !== 0) throw new Error('无法禁用已启动的更新任务');
      }
      writeFileSync(join(logRoot, 'update-launch.json'), `${JSON.stringify({ scheduledAt: new Date().toISOString(), taskName, parentPid: plan.parentPid, fromRevision: plan.currentRevision, toRevision: plan.targetRevision }, null, 2)}\n`);
      setTimeout(() => app.exit(0), 1200);
      return { scheduled: true };
    },
    async chooseSkillDirectory() { const result = await dialog.showOpenDialog(mainWindow, { title: "选择包含 SKILL.md 的目录", properties: ["openDirectory"] }); return result.canceled ? null : result.filePaths[0]; },
  });
  const backend = await ready;
  const protocolState = importProtocol.ensureRegistered();
  await audit.record({ action: 'import:protocol-startup', outcome: protocolState.ok ? 'success' : protocolState.status === 'unavailable' ? 'skipped' : 'error', code: protocolState.status === 'failed' ? 'PROTOCOL_REGISTRATION_FAILED' : undefined }).catch(() => {});
  await audit.record({ action: "manager:start", outcome: "success" }).catch(() => {});
  createWindow(backend.url);
  importReceiver.start();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (getBusyOperation()) { event.preventDefault(); void explainBusy(); return; }
  if (server.listening) { server.close(); server.closeIdleConnections?.(); }
});
