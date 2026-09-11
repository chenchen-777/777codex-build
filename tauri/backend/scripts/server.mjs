import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { access, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { merge777Config } from "../js/config-core.mjs";
import {
  apply777Configuration, list777Backups, read777ConfigState,
  resolveCodexRoot, rollback777Configuration,
} from "../js/config-store.mjs";
import {
  deleteProvider, getProviderSecret, listProviders, markProviderActive,
  markProviderVerified, resolveManagerRoot, upsertProvider,
} from "../js/provider-store.mjs";
import {
  codexStatus, downloadCodexInstaller, installCodexMsix, launchCodex,
  OFFICIAL_WINDOWS_DOWNLOAD, restartCodex,
  uninstallCodex, stopSelectedCodex,
} from "../js/codex-runtime.mjs";
import { backupSessions, listSessions } from "../js/session-store.mjs";
import { imageMcpComponentSource, installImageMcp } from "../js/extension-store.mjs";
import { errorMessage, normalizeModels, normalizeUsage, redactSensitiveToml } from "../js/runtime-core.mjs";
import { AuditLog, redact } from "../js/audit-log.mjs";
import { AppError } from "../js/errors.mjs";
import { createFeatureApi } from "./feature-api.mjs";
import { createWindowsApi } from "./windows-api.mjs";
import { syncModels, syncUsage, validateTextProfile } from '../js/model-service.mjs';
import { CCSLinkImport } from '../js/ccs-link-import.mjs';
import { ModelFollow, prepareFollowedModel } from '../js/model-follow.mjs';
import { normalizeDescriptor, providerAdapter, requireProviderAdapter } from '../js/provider-descriptor.mjs';
import { BUILD_INFO } from '../js/build-info.mjs';
import { UpdateManager } from '../js/update-manager.mjs';
import { AccountManager } from '../js/account-manager.mjs';
import { PlatformKeySync } from '../js/platform-key-sync.mjs';
import { InstallEngine } from '../js/install-engine.mjs';
import { InstallManager } from '../js/install-manager.mjs';
import { UninstallTask, performUninstall } from '../js/uninstall-task.mjs';
import {macUnavailableRoute} from '../js/macos-runtime.mjs';
import {MacManager} from '../js/mac-manager.mjs';

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configuredPort = Number(process.env.PORT ?? (process.versions.electron ? 0 : 4179));
if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) throw new Error("PORT 不合法");
let activePort = configuredPort;
const isolated = process.env.MANAGER777_ISOLATED === "1" || (!process.versions.electron && process.env.MANAGER777_LIVE !== "1");
export const runtimeIsolated = isolated;
const codexRoot = process.env.MANAGER777_CODEX_ROOT || (isolated ? join(projectRoot, ".dev", "codex") : resolveCodexRoot());
const managerRoot = process.env.MANAGER777_ROOT || (isolated ? join(projectRoot, ".dev", "manager") : join(process.env.APPDATA, "777Codex-0.11-Candidate"));
const userSkillRoot = process.env.MANAGER777_SKILL_ROOT || (isolated ? join(projectRoot, ".dev", "skills") : join(process.env.USERPROFILE, ".agents", "skills"));
export const audit = new AuditLog(managerRoot);
export const macManager = new MacManager({managerRoot,isolated,backup:()=>backupSessions(codexRoot,managerRoot),audit});
const sessionToken = randomBytes(32).toString("hex");
let busyOperation = null;
let windowsApi;
const uninstallTask = new UninstallTask({ audit, execute: report => performUninstall({ installManager, status: codexStatus, backup: () => backupSessions(codexRoot, managerRoot), uninstall: onProgress => uninstallCodex(process.env, { onProgress }) }, report) });
export const getBusyOperation = () => busyOperation || windowsApi?.getBusyOperation?.() || (macManager.worker ? {action:'Mac 组件任务',startedAt:new Date().toISOString()} : null) || (uninstallTask.state.busy ? { action: 'Codex 卸载', startedAt: uninstallTask.state.startedAt } : null) || (installManager?.worker ? { action: 'Codex 下载或安装', startedAt: new Date().toISOString() } : null);
const startedAt = Date.now();
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
};

let adapters = {
  protect() { throw new Error("安全存储尚未初始化"); },
  unprotect() { throw new Error("安全存储尚未初始化"); },
  openExternal() { throw new Error("桌面外链能力尚未初始化"); },
  openPath() { throw new Error("桌面文件能力尚未初始化"); },
  scheduleManagerUpdate() { throw new AppError("浏览器预览不能安装管理工具更新", "DESKTOP_ONLY", 400); },
  chooseSkillDirectory() { throw new AppError("浏览器预览请手动填写目录；桌面版支持文件夹选择", "DESKTOP_ONLY", 400); },
};

export function configureRuntimeAdapters(next) { adapters = { ...adapters, ...next }; }
export const updateManager = new UpdateManager({
  build: BUILD_INFO,
  managerRoot,
  installRoot: process.versions.electron ? dirname(process.execPath) : projectRoot,
  executable: process.execPath,
  publicKeyPath: join(projectRoot, 'js', 'update-public.pem'),
  helperSource: join(projectRoot, 'electron', 'update-helper.ps1'),
  isolated,
  scheduleInstall: plan => adapters.scheduleManagerUpdate(plan),
});
export const accountManager = new AccountManager({
  managerRoot,
  isolated,
  protect: value => adapters.protect(value),
  unprotect: value => adapters.unprotect(value),
  openExternal: url => adapters.openExternal(url),
});
export const platformImport = new CCSLinkImport({ managerRoot, adapters: () => adapters });
export const platformKeySync = new PlatformKeySync({ account: accountManager, managerRoot, protect: value => adapters.protect(value) });
const enginePath = process.versions.electron
  ? join(process.resourcesPath, 'app.asar.unpacked', 'components', 'install-engine', '777codex-install-engine.exe')
  : join(projectRoot, 'components', 'install-engine', '777codex-install-engine.exe');
export const installManager = new InstallManager({managerRoot, engine:new InstallEngine(enginePath,process.env,{onDiagnostic:d=>audit.record({action:'installer:engine',outcome:'error',code:d.code||'ENGINE_FAILED',engine:d}).catch(()=>{})}), isolated, installMsix:installCodexMsix, backup:()=>backupSessions(codexRoot,managerRoot), audit});
if (!isolated) process.env.MANAGER777_INSTALL_TARGET_FILE = installManager.targetFile;
async function launchSelectedCodex() {
  if(process.platform==='darwin')return launchCodex(process.env,await activeImageEnvironment());
  const target = await installManager.target();
  if (target) { await new InstallEngine(enginePath,{...process.env,...await activeImageEnvironment()}).call('launch', {installed:target}); return {ok:true,running:true,executable:target.path,activation:target.source}; }
  return launchCodex(process.env, await activeImageEnvironment());
}
export const modelFollow = new ModelFollow({ managerRoot, codexRoot, adapters: () => adapters });
let modelRefresh = null;
async function prepareLastModel() {
  return prepareFollowedModel(modelFollow);
}
let importLinkError = null;
export const offerPlatformImport = raw => { const state = platformImport.offer(raw); importLinkError = null; return state; };
export const reportImportLinkError = error => {
  const messages = {
    IMPORT_URL_ORIGIN: '导入链接来源格式无效，请从平台官网重新发起。',
    IMPORT_URL_PATH: '导入链接路径不兼容，请从平台官网重新发起。',
    IMPORT_URL_PARAMETERS: '导入链接参数不完整或版本不兼容，请从平台官网重新发起。',
    IMPORT_BUSY: '已有导入待处理，请先完成或取消，再从平台重新发起。',
    LEGACY_IMPORT_LINK: '旧版导入链接已停用，请在平台重新点击导入；若仍提示旧版，请等待平台按钮更新。',
  };
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'INVALID_IMPORT_URL';
  importLinkError = { id: randomUUID(), code, message: messages[code] || '未能识别网页导入链接，请从平台官网重新发起。' };
  return code;
};

function sendJson(response, statusCode, value) {
  if (response.deferJson) { response.statusCode = statusCode; response.pendingJson = { statusCode, value }; return; }
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new AppError("请求内容过大", "BODY_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("请求必须是 JSON 对象", "INVALID_BODY", 400);
  return value;
}

function endpointFor(baseUrl, resource) {
  const url = new URL(baseUrl);
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname = `${prefix.endsWith("/v1") ? prefix : `${prefix}/v1`}/${resource}`.replace(/\/+/g, "/");
  return url.href;
}

async function requestProvider(baseUrl, resource, apiKey = "") {
  const url = new URL(endpointFor(baseUrl, resource));
  if (url.protocol !== "https:") return { ok: false, status: 0, message: "仅允许 HTTPS 接口", body: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: 'error' });
    const text = await response.text(); let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text.slice(0, 300) }; }
    return { ok: response.ok, status: response.status, message: response.ok ? "请求成功" : errorMessage(body, response.statusText), body };
  } catch (error) {
    return { ok: false, status: 0, message: error?.name === "AbortError" ? "请求超时" : String(error?.message || error), body: null };
  } finally { clearTimeout(timer); }
}

async function verifySecret(profile) {
  const synced = await syncModels(profile);
  const usageResult = await requestProvider(profile.baseUrl, 'usage', profile.apiKey);
  const modelsResult = { ok: true, status: 200, message: synced.message };
  return {
    ok: true, models: synced.models,
    usage: usageResult.ok ? normalizeUsage(usageResult.body) : null,
    checks: {
      models: { ok: modelsResult.ok, status: modelsResult.status, message: modelsResult.message },
      usage: { ok: usageResult.ok, status: usageResult.status, message: usageResult.message },
    },
    message: 'Key 的模型列表接口通过；实际对话尚未验证',
  };
}

async function profileFromInput(payload) {
  const previous = payload.id ? await getProviderSecret(managerRoot, String(payload.id), adapters.unprotect) : null;
  if (previous && !String(payload.apiKey || '').trim() && payload.baseUrl && payload.baseUrl.replace(/\/+$/, '') !== previous.baseUrl.replace(/\/+$/, '')) {
    throw new AppError('修改接口地址时请重新填写 Key，防止将已保存密钥发送到其他地址', 'KEY_REENTRY_REQUIRED');
  }
  const apiKey = String(payload.apiKey || '').trim() || previous?.apiKey || '';
  const baseUrl = payload.baseUrl || previous?.baseUrl || 'https://www.777codes.codes';
  const keyChanged = previous && (apiKey !== previous.apiKey || baseUrl.replace(/\/+$/, '') !== previous.baseUrl.replace(/\/+$/, ''));
  // A different Key must not inherit another Key's group/rate snapshot.
  return { ...previous, ...payload, apiKey, baseUrl, ...(keyChanged ? { groupName: null, groupMultiplier: null } : {}) };
}

async function bootstrapCurrentProvider() {
  if ((await listProviders(managerRoot)).length) return;
  const state = await read777ConfigState(codexRoot);
  if (!state.exists || state.provider !== "777codes") return;
  let auth;
  try { auth = JSON.parse(await readFile(join(codexRoot, "auth.json"), "utf8")); } catch { return; }
  const apiKey = String(auth?.OPENAI_API_KEY || "").trim();
  if (apiKey.length < 8) return;
  const saved = await upsertProvider(managerRoot, {
    name: "777codes 当前配置", type: "text", baseUrl: state.baseUrl || "https://www.777codes.codes",
    protocol: "responses", model: state.model || "gpt-5.5", reasoningEffort: "high",
    disableResponseStorage: true, apiKey,
  }, adapters.protect);
  await markProviderActive(managerRoot, saved.id, "text");
}

function isTrustedMutationRequest(request) {
  const origin = request.headers.origin;
  return origin === `http://127.0.0.1:${activePort}` || origin === `http://localhost:${activePort}`;
}
function requireTrusted(request) {
  if (!isTrustedMutationRequest(request)) throw Object.assign(new Error("拒绝非本机界面发起的写入请求"), { status: 403 });
}

async function extensionStatus() {
  const state = await read777ConfigState(codexRoot);
  const imageSection = state.text.match(/\[mcp_servers\.777codes-image]\s*([\s\S]*?)(?=\n\s*\[|$)/)?.[1] || "";
  const command = imageSection.match(/^\s*command\s*=\s*["']([^"']+)["']/m)?.[1] || null;
  let commandExists = false;
  if (command) { try { await access(command); commandExists = true; } catch {} }
  let skillCount = 0;
  try { skillCount = (await readdir(join(codexRoot, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length; } catch {}
  return { imageMcp: { configured: Boolean(command), installed: Boolean(command && commandExists), command }, skillCount };
}

async function activeImageEnvironment() {
  const active = (await listProviders(managerRoot)).find((item) => item.type === "image" && item.active);
  if (!active) return {};
  const profile = await getProviderSecret(managerRoot, active.id, adapters.unprotect);
  requireProviderAdapter(profile);
  return { CODES777_API_KEY: profile.apiKey };
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/mac/status' && request.method === 'GET') {
    if(process.platform!=='darwin')throw new AppError('此入口仅用于 Mac','MAC_ONLY',409);
    sendJson(response,200,await macManager.status());return true;
  }
  if (pathname === '/api/mac/action' && request.method === 'POST') {
    requireTrusted(request);const p=await readJsonBody(request);
    if(p.confirm!==`MAC_${p.action}`)throw new AppError('请确认此次 Mac 操作','CONFIRMATION_REQUIRED',400);
    sendJson(response,202,await macManager.start(p.action));return true;
  }
  if (request.method === 'GET' && pathname === '/api/codex/installer') { sendJson(response,200,await installManager.status()); return true; }
  if (request.method === 'POST' && pathname.startsWith('/api/codex/installer/')) {
    requireTrusted(request); const p=await readJsonBody(request); let r;
    if(pathname.endsWith('/plan'))r=await installManager.plan(p.sourceId,p.route);
    else if(pathname.endsWith('/download'))r=await installManager.startDownload();
    else if(pathname.endsWith('/control'))r=await installManager.control(p.action);
    else if(pathname.endsWith('/adopt'))r=await installManager.adopt(p.path);
    else if(pathname.endsWith('/install'))r=await installManager.install();
    else return false;
    sendJson(response,200,r);return true;
  }
  if (pathname === '/api/account/status' && request.method === 'GET') {
    sendJson(response, 200, await accountManager.status()); return true;
  }
  if (pathname === '/api/account/referral' && request.method === 'GET') {
    sendJson(response, 200, await accountManager.referral()); return true;
  }
  if (pathname.startsWith('/api/account/') && request.method === 'POST') {
    requireTrusted(request); const body = await readJsonBody(request); let result;
    if (pathname === '/api/account/login/start') result = await accountManager.startLogin(body.deviceName || process.env.COMPUTERNAME || 'Windows 设备');
    else if (pathname === '/api/account/register/start') result = await accountManager.startRegistration();
    else if (pathname === '/api/account/login/poll') result = await accountManager.pollLogin();
    else if (pathname === '/api/account/logout') result = await accountManager.logout();
    else if (pathname === '/api/account/referral/open') result = await accountManager.openReferral();
    else if (pathname === '/api/account/keys/sync') { await modelRefresh?.catch(() => {}); result = await platformKeySync.sync(); }
    else return false;
    sendJson(response, 200, result); return true;
  }
  if (pathname === '/api/manager-update/status' && request.method === 'GET') {
    sendJson(response, 200, await updateManager.status()); return true;
  }
  if (pathname === '/api/manager-update/check' && request.method === 'POST') {
    requireTrusted(request); await readJsonBody(request);
    sendJson(response, 200, await updateManager.check()); return true;
  }
  if (pathname === '/api/manager-update/settings' && request.method === 'POST') {
    requireTrusted(request);
    sendJson(response, 200, await updateManager.saveSettings(await readJsonBody(request))); return true;
  }
  if (pathname === '/api/manager-update/download' && request.method === 'POST') {
    requireTrusted(request); await readJsonBody(request);
    sendJson(response, 200, await updateManager.download()); return true;
  }
  if (pathname === '/api/manager-update/install' && request.method === 'POST') {
    requireTrusted(request); const payload = await readJsonBody(request);
    if (payload.confirm !== 'INSTALL_MANAGER_UPDATE') throw new AppError('请确认安装管理工具更新', 'CONFIRMATION_REQUIRED', 400);
    sendJson(response, 200, await updateManager.install()); return true;
  }
  if (pathname === '/api/model/sync' && request.method === 'POST') {
    requireTrusted(request); await readJsonBody(request);
    if (busyOperation || windowsApi?.getBusyOperation?.() || uninstallTask.state.busy) throw new AppError('配置操作正在执行，稍后同步模型', 'OPERATION_BUSY', 409);
    if (!modelRefresh) modelRefresh = modelFollow.refresh().finally(() => { modelRefresh = null; });
    sendJson(response, 200, await modelRefresh); return true;
  }
  if (pathname === '/api/import/protocol' && request.method === 'GET') {
    sendJson(response, 200, adapters.importProtocolState?.() || { status: 'unavailable', ok: false, canRetry: false, message: '开发预览不注册网页关联；请使用 Windows 打包版。' }); return true;
  }
  if (pathname === '/api/import/state' && request.method === 'GET') { sendJson(response, 200, { ...platformImport.state(), linkError: importLinkError }); return true; }
  if (pathname.startsWith('/api/import/') && request.method === 'POST') {
    requireTrusted(request); const body = await readJsonBody(request); let result;
    if (pathname === '/api/import/receive') throw new AppError('旧版领取接口已停用，请从平台重新导入', 'LEGACY_IMPORT_LINK', 410);
    else if (pathname === '/api/import/models') result = await platformImport.models();
    else if (pathname === '/api/import/save') result = await platformImport.save(body);
    else if (pathname === '/api/import/cancel') result = platformImport.cancel();
    else if (pathname === '/api/import/register') {
      if (isolated || !adapters.registerImportProtocol) throw new AppError('开发预览或隔离测试不注册网页关联', 'DESKTOP_ONLY', 403);
      result = await adapters.registerImportProtocol();
      if (!result.ok) throw new AppError(result.message || '网页关联失败，请检查系统权限后重试', 'PROTOCOL_REGISTRATION_FAILED', 503);
    } else return false;
    sendJson(response, 200, result); return true;
  }
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, platform:process.platform, arch:process.arch, version: BUILD_INFO.version, revision: BUILD_INFO.revisionLabel, channel: BUILD_INFO.channel, isolated, busy: getBusyOperation(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }); return true;
  }
  if (request.method === "GET" && pathname === "/api/status") {
    const result = await requestProvider("https://www.777codes.codes", "models");
    sendJson(response, 200, { reachable: result.status === 401 || result.ok, httpStatus: result.status, message: result.message }); return true;
  }
  if (request.method === "GET" && pathname === "/api/local-state") {
    const state = await read777ConfigState(codexRoot); delete state.text; sendJson(response, 200, state); return true;
  }
  if (request.method === "POST" && pathname === "/api/config-preview") {
    const payload = await readJsonBody(request); const state = await read777ConfigState(codexRoot);
    sendJson(response, 200, { ok: true, source: state.exists ? state.path : "新配置", configToml: redactSensitiveToml(merge777Config(state.text, payload)), writePerformed: false }); return true;
  }
  if (request.method === "GET" && pathname === "/api/backups") {
    sendJson(response, 200, { ok: true, backups: await list777Backups(codexRoot) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/rollback") {
    requireTrusted(request); const payload = await readJsonBody(request);
    if (payload.confirm !== "RESTORE_BACKUP") throw Object.assign(new Error("缺少回滚确认"), { status: 400 });
    sendJson(response, 200, await rollback777Configuration({ codexRoot, backupId: String(payload.backupId || "") })); return true;
  }
  if (request.method === "GET" && pathname === "/api/providers") {
    sendJson(response, 200, { ok: true, providers: await listProviders(managerRoot) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/import-current") {
    requireTrusted(request); await bootstrapCurrentProvider(); sendJson(response, 200, { ok: true, providers: await listProviders(managerRoot) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/model-choice") {
    requireTrusted(request);const payload=await readJsonBody(request);
    const before=(await listProviders(managerRoot)).find(p=>p.id===payload.id);
    if(!before||before.updatedAt!==payload.expectedUpdatedAt)throw new AppError('密钥已变更，请刷新模型后重试','PROVIDER_CONFLICT',409);
    const profile=await profileFromInput({id:before.id,model:String(payload.model||'')});
    const result=await syncModels(profile);
    if(!result.models.includes(profile.model))throw new AppError('此密钥不支持所选模型','MODEL_NOT_SUPPORTED',400);
    const current=(await listProviders(managerRoot)).find(p=>p.id===before.id);
    if(current?.updatedAt!==before.updatedAt)throw new AppError('密钥已变更，请刷新模型后重试','PROVIDER_CONFLICT',409);
    const saved=await upsertProvider(managerRoot,profile,adapters.protect);
    sendJson(response,200,{ok:true,provider:saved,appliesOnNextLaunch:true});return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/save") {
    requireTrusted(request); const payload = await readJsonBody(request);
    const profile = await profileFromInput(payload);
    Object.assign(profile, normalizeDescriptor(profile));
    let verified = null;
    if (providerAdapter(profile).canActivate && profile.model) {
      verified = await verifySecret(profile);
      validateTextProfile(profile, verified.models);
    }
    const saved = await upsertProvider(managerRoot, profile, adapters.protect);
    if (verified) await markProviderVerified(managerRoot, saved.id);
    sendJson(response, 200, { ok: true, provider: saved }); return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/verify") {
    requireTrusted(request); const payload = await readJsonBody(request);
    const profile = await profileFromInput(payload);
    const result = await verifySecret(profile);
    if (!result.ok) { sendJson(response, 401, result); return true; }
    if (payload.id && !payload.apiKey && !payload.baseUrl) await markProviderVerified(managerRoot, String(payload.id));
    sendJson(response, 200, result); return true;
  }
  if (request.method === 'POST' && pathname === '/api/providers/models') {
    requireTrusted(request);
    sendJson(response, 200, await syncModels(await profileFromInput(await readJsonBody(request)))); return true;
  }
  if (request.method === 'POST' && pathname === '/api/providers/usage') {
    requireTrusted(request);
    sendJson(response, 200, await syncUsage(await profileFromInput(await readJsonBody(request)))); return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/switch") {
    requireTrusted(request); const payload = await readJsonBody(request);
    if (payload.confirm !== 'SWITCH_PROVIDER') throw new AppError('请确认切换 Key','CONFIRMATION_REQUIRED',400);
    const before = (await listProviders(managerRoot)).find(p => p.id === String(payload.id));
    if (!before || before.updatedAt !== payload.expectedUpdatedAt) throw new AppError('Key 配置已在其他操作中变化，请刷新后重试','PROVIDER_CONFLICT',409);
    const storePath=join(managerRoot,'providers.json'), snapshot=await readFile(storePath); let applied=null,saved=null,selfSnapshot=null;
    try {
      const profile=await profileFromInput(payload);Object.assign(profile,normalizeDescriptor(profile));requireProviderAdapter(profile);const verified=await verifySecret(profile);validateTextProfile(profile,verified.models);
      if(!verified.ok)throw Object.assign(new Error('切换前验证失败：'+verified.message),{status:401});
      saved=await upsertProvider(managerRoot,profile,adapters.protect);selfSnapshot=await readFile(storePath);await markProviderVerified(managerRoot,saved.id);selfSnapshot=await readFile(storePath);
      applied=await apply777Configuration({codexRoot,apiKey:profile.apiKey,options:{model:profile.model,reasoningEffort:profile.reasoningEffort,disableResponseStorage:profile.disableResponseStorage,removeXiaojiMarketplace:true}});
      await markProviderActive(managerRoot,profile.id,'text');await markProviderVerified(managerRoot,profile.id);
      selfSnapshot=await readFile(storePath);
      sendJson(response,200,{ok:true,selected:{id:profile.id,name:profile.name},applied,verification:verified});return true;
    } catch(error) {
      if(applied?.backupId){try{await rollback777Configuration({codexRoot,backupId:applied.backupId});}catch(rollbackError){throw new AppError('切换失败，且 Codex 配置回滚失败：'+errorMessage(rollbackError),'PROVIDER_CONFIG_ROLLBACK_FAILED',500);}}
      const currentBytes=await readFile(storePath);
      const unchangedByOthers=!selfSnapshot||currentBytes.equals(selfSnapshot);
      if(snapshot&&(!saved||unchangedByOthers)){const temporary=storePath+'.switch-rollback';await writeFile(temporary,snapshot);await rename(temporary,storePath);}
      else if(saved)throw new AppError('切换失败且 Key 列表又被修改，已保留新修改；请刷新检查 Codex 配置','PROVIDER_ROLLBACK_CONFLICT',409);
      throw error;
    }
  }
  if (request.method === "POST" && pathname === "/api/providers/activate") {
    requireTrusted(request); const payload = await readJsonBody(request);
    const existing = (await listProviders(managerRoot)).find(p => p.id === String(payload.id));
    if (existing?.active && existing.type === 'text') await modelFollow.refresh({ check: false });
    const profile = await getProviderSecret(managerRoot, String(payload.id), adapters.unprotect);
    requireProviderAdapter(profile);
    const verified = await verifySecret(profile);
    validateTextProfile(profile, verified.models);
    if (!verified.ok) throw Object.assign(new Error(`切换前验证失败：${verified.message}`), { status: 401 });
    if (profile.type !== "text") {
      await markProviderActive(managerRoot, profile.id, profile.type); await markProviderVerified(managerRoot, profile.id);
      sendJson(response, 200, { ok: true, selected: { id: profile.id, name: profile.name }, verification: verified }); return true;
    }
    const applied = await apply777Configuration({ codexRoot, apiKey: profile.apiKey, options: {
      model: profile.model, reasoningEffort: profile.reasoningEffort,
      disableResponseStorage: profile.disableResponseStorage, removeXiaojiMarketplace: true,
    }});
    await markProviderActive(managerRoot, profile.id, "text"); await markProviderVerified(managerRoot, profile.id);
    sendJson(response, 200, { ok: true, applied, verification: verified }); return true;
  }
  if (request.method === "POST" && pathname === "/api/providers/delete") {
    requireTrusted(request); const payload = await readJsonBody(request);
    sendJson(response, 200, await deleteProvider(managerRoot, String(payload.id), { confirmActive: payload.confirmActive })); return true;
  }
  if (request.method === "GET" && pathname === "/api/codex/status") {
    if (isolated) { sendJson(response, 200, { ok: true, installed: false, running: false, isolated: true }); return true; }
    const s=await codexStatus();const selected=await installManager.target();
    if(selected?.source==='portable'&&selected.path.toLowerCase()===installManager.portableRoot.toLowerCase())s.canUninstall=s.installed;
    sendJson(response, 200, { ok: true, ...s }); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/launch") {
    requireTrusted(request); if (!isolated) await prepareLastModel(); sendJson(response, 200, await launchSelectedCodex()); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/restart") {
    requireTrusted(request); if (!isolated) await prepareLastModel(); await stopSelectedCodex();sendJson(response, 200, await launchSelectedCodex()); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/open-directory") {
    requireTrusted(request); const state = await codexStatus();
    if (!state.installDirectory) throw Object.assign(new Error("未检测到 Codex 安装目录"), { status: 404 });
    const message = await adapters.openPath(state.installDirectory); if (message) throw new Error(message);
    sendJson(response, 200, { ok: true }); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/download") {
    requireTrusted(request); sendJson(response, 200, await installManager.startDownload()); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/install") {
    requireTrusted(request);
    sendJson(response, 200, await installManager.install()); return true;
  }
  if (request.method === "GET" && pathname === "/api/codex/uninstall/status") {
    sendJson(response, 200, uninstallTask.snapshot()); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/uninstall") {
    requireTrusted(request); const payload = await readJsonBody(request);
    if (payload.confirm !== "UNINSTALL_CODEX_APP") throw new AppError("请确认卸载 Codex 应用", "CONFIRMATION_REQUIRED", 400);
    sendJson(response, 202, uninstallTask.start()); return true;
  }
  if (request.method === "POST" && pathname === "/api/codex/run-installer") {
    throw new AppError("请使用安装按钮校验并运行内置官方安装包", "USE_VERIFIED_INSTALLER", 400);
  }
  if (request.method === "POST" && pathname === "/api/codex/open-download-page") {
    requireTrusted(request); await adapters.openExternal(process.platform==='darwin'?"https://learn.chatgpt.com/docs/app":"https://learn.chatgpt.com/docs/windows/windows-app");
    sendJson(response, 200, { ok: true, download: OFFICIAL_WINDOWS_DOWNLOAD }); return true;
  }
  if (request.method === "GET" && pathname === "/api/sessions") {
    sendJson(response, 200, { ok: true, ...(await listSessions(codexRoot)) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/sessions/backup") {
    requireTrusted(request); sendJson(response, 200, await backupSessions(codexRoot, managerRoot)); return true;
  }
  if (request.method === "POST" && pathname === "/api/backups/open") {
    requireTrusted(request); const path = join(managerRoot, "Backups"); const message = await adapters.openPath(path);
    if (message) throw new Error(message); sendJson(response, 200, { ok: true, path }); return true;
  }
  if (request.method === "GET" && pathname === "/api/extensions") {
    sendJson(response, 200, { ok: true, ...(await extensionStatus()) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/extensions/image-mcp/install") {
    requireTrusted(request);
    const result = await installImageMcp({ codexRoot, managerRoot, componentSource: imageMcpComponentSource(projectRoot), managerExecutable: process.execPath });
    sendJson(response, 200, result); return true;
  }
  return false;
}

const codexZhArchive = process.env.CODEX_ZH_COMPONENT_ARCHIVE || (process.versions.electron
  ? join(process.resourcesPath, "app.asar.unpacked", "components", "codex-zh", "release-kit.zip")
  : join(projectRoot, "components", "codex-zh", "release-kit.zip"));
const pluginRepairArchive = process.env.CODEX_PLUGIN_REPAIR_ARCHIVE || (process.versions.electron
  ? join(process.resourcesPath, "app.asar.unpacked", "components", "plugin-repair", "plugins-main.zip")
  : join(projectRoot, "components", "plugin-repair", "plugins-main.zip"));
const featureApi = createFeatureApi({ codexRoot, managerRoot, userSkillRoot, componentArchive: codexZhArchive, pluginRepairArchive, audit, adapters: () => adapters, status: codexStatus, readBody: readJsonBody, sendJson });
windowsApi = createWindowsApi({ projectRoot, codexRoot, managerRoot, isolated, audit, readBody: readJsonBody, sendJson, requireTrusted, accountManager, adapters: () => adapters });

export const server = http.createServer(async (request, response) => {
  const requestId = randomUUID(); const start = Date.now(); let action = "request"; let mutation = false; let ownsBusy = false; let code = "";
  response.deferJson = true;
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (![ `127.0.0.1:${activePort}`, `localhost:${activePort}` ].includes(request.headers.host)) throw new AppError("拒绝非法 Host", "INVALID_HOST", 403);
    if (request.headers["sec-fetch-site"] === "cross-site") throw new AppError("拒绝跨站访问", "CROSS_SITE", 403);
    const rawPath = new URL(request.url || "/", `http://${request.headers.host}`).pathname;
    action = rawPath.startsWith("/api/") ? rawPath : "static-resource";
    if (rawPath === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (rawPath.startsWith("/api/")) {
      if (rawPath !== "/api/health" && !(request.headers.cookie || "").split(/;\s*/).includes(`session777_${activePort}=${sessionToken}`)) throw new AppError("界面会话已失效，请重新打开工具", "SESSION_REQUIRED", 403);
      if (request.headers.origin && !isTrustedMutationRequest(request)) throw new AppError("拒绝跨站接口请求", "CROSS_SITE", 403);
      const writeRequest = request.method !== "GET";
      const passiveRefresh = rawPath === "/api/model/sync";
      mutation = writeRequest && !passiveRefresh;
      if (writeRequest) requireTrusted(request);
      if (mutation) {
        if (isolated && (/^\/api\/mac\//.test(rawPath) || /^\/api\/codex\//.test(rawPath) || /^\/api\/enhancements\//.test(rawPath) || rawPath === "/api/extensions/image-mcp/install" || /^\/api\/manager-update\/(download|install)$/.test(rawPath))) throw new AppError("隔离预览禁止启动或安装本机 Codex；请在试验机桌面候选包中操作", "ISOLATED_PREVIEW", 403);
        if (busyOperation || (windowsApi?.getBusyOperation?.() && !rawPath.endsWith('/cancel')) || macManager.worker || uninstallTask.state.busy || (installManager.worker && rawPath !== '/api/codex/installer/control')) throw new AppError("另一个操作正在执行，请稍后重试", "OPERATION_BUSY", 409);
        busyOperation = { action: rawPath, startedAt: new Date().toISOString(), requestId }; ownsBusy = true;
        await audit.record({ id: requestId, action, outcome: "started" });
      }
      if(process.platform==='darwin'&&request.method==='POST'&&macUnavailableRoute(rawPath))throw new AppError('此功能尚未适配 macOS 测试版；不会运行 Windows 组件。Codex 请从官方页面手动安装或更新。','MAC_FEATURE_UNAVAILABLE',409);
      const handled = await windowsApi(request, response, rawPath) || await featureApi(request, response, rawPath) || await handleApi(request, response, rawPath);
      if (!handled) sendJson(response, 404, { ok: false, message: "API 路径不存在" });
      return;
    }
    const relativePath = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
    const safePath = normalize(relativePath);
    if (!["index.html", "styles.css", "ui.js", "features-ui.js", "account-ui.js", "install-ui.js", "import-ui.js", "mac-ui.js", "tauri-window.js", "tauri-window.css", "tool-ui.js", "tool-ui.css", "inline-models.js", "install-flow.js", "log-export.js", normalize("assets/777codes-logo.png")].includes(safePath)) { response.writeHead(404).end("Not found"); return; }
    if (safePath === "index.html") response.setHeader("Set-Cookie", `session777_${activePort}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
    const body = await readFile(join(projectRoot, safePath));
    response.writeHead(200, { "Content-Type": contentTypes[extname(safePath)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(body);
  } catch (error) {
    code = error?.code || "OPERATION_FAILED";
    const status = error instanceof SyntaxError ? 400 : Number(error?.status || 500);
    sendJson(response, status, { ok: false, code, requestId, message: redact(error instanceof SyntaxError ? "请求 JSON 格式不正确" : String(error?.message || "操作失败")).slice(0, 300) });
  } finally {
    if (mutation || response.statusCode >= 400) await audit.record({ id: requestId, action, outcome: response.statusCode >= 400 ? "error" : "success", status: response.statusCode, durationMs: Date.now() - start, code }).catch(() => {});
    if (ownsBusy) busyOperation = null;
    if (response.pendingJson) { response.deferJson = false; sendJson(response, response.pendingJson.statusCode, response.pendingJson.value); }
  }
});

export const ready = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(configuredPort, "127.0.0.1", () => {
    const address = server.address(); activePort = typeof address === "object" && address ? address.port : configuredPort;
    const url = `http://127.0.0.1:${activePort}`;
    if (!process.versions.electron) console.log(`777Codex desktop backend: ${url}`);
    resolve({ port: activePort, url });
  });
});
