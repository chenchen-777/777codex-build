import { createHash } from "node:crypto";
import {createReadStream} from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { platform as hostPlatform, arch as hostArch } from "node:process";
import { AppError } from "./errors.mjs";
import { compareBuild, validateUpdateManifest } from "./update-core.mjs";

const exists = path => access(path).then(() => true, () => false);
function safeChild(root, ...parts) {
  const base = resolve(root); const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new AppError("更新目录不安全", "UPDATE_PATH_UNSAFE", 500);
  return target;
}
async function atomicJson(pathname, value) {
  await mkdir(dirname(pathname), { recursive: true }); const temporary = `${pathname}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, pathname);
}
async function sha256File(pathname){const digest=createHash('sha256');for await(const chunk of createReadStream(pathname))digest.update(chunk);return digest.digest('hex');}
async function readBoundedJson(response, limit = 2 * 1024 * 1024) {
  if (!response.body) throw new AppError("更新清单内容为空", "UPDATE_MANIFEST_INVALID", 502);
  const chunks=[];let length=0;
  for await(const chunk of response.body){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>limit)throw new AppError("更新清单内容过大", "UPDATE_MANIFEST_TOO_LARGE", 502);chunks.push(bytes);}
  const bytes=Buffer.concat(chunks,length);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new AppError("更新清单不是有效 JSON", "UPDATE_MANIFEST_INVALID", 502); }
}

export class UpdateManager {
  constructor({ build, managerRoot, installRoot, executable, publicKeyPath, helperSource, isolated = false, fetcher = fetch, scheduleInstall, platform=hostPlatform, arch=hostArch, outerPid=process.ppid,outerStartEpochMs=Number(process.env.MANAGER777_OUTER_START_EPOCH_MS||0),sidecarStartEpochMs=performance.timeOrigin }) {
    this.build = build; this.managerRoot = managerRoot; this.installRoot = installRoot; this.executable = executable;
    this.publicKeyPath = publicKeyPath; this.helperSource = helperSource; this.isolated = isolated; this.fetcher = fetcher; this.scheduleInstall = scheduleInstall;
    this.platform=platform;this.arch=arch;this.outerPid=outerPid;this.outerStartEpochMs=outerStartEpochMs;this.sidecarStartEpochMs=sidecarStartEpochMs;
    this.updateRoot = safeChild(managerRoot, "Updates"); this.settingsPath = safeChild(this.updateRoot, "settings.json");
    this.lastCheck = null; this.ready = null;this.operation=null;
  }
  async settings() {
    try {
      const value = JSON.parse(await readFile(this.settingsPath, "utf8"));
      return { autoCheck: value.autoCheck !== false, lastCheckedAt: typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : null };
    } catch { return { autoCheck: true, lastCheckedAt: null }; }
  }
  async saveSettings(payload) {
    if (typeof payload.autoCheck !== "boolean") throw new AppError("自动更新设置必须为布尔值", "UPDATE_SETTING_INVALID", 400);
    const current = await this.settings(); const next = { ...current, autoCheck: payload.autoCheck };
    await atomicJson(this.settingsPath, next); return { ok: true, ...next };
  }
  safeResult(manifest) {
    const comparison = compareBuild(manifest, this.build); const available = comparison > 0;
    // Windows has an exercised external transaction helper. Mac checking stays
    // enabled, but in-place install remains fail-closed until the whole-app swap
    // and crash recovery pass on both native architectures.
    const installable = available && this.platform==='win32' && this.build.version === manifest.version && this.build.revision >= manifest.minimumRevision;
    return {
      ok: true, current: { version: this.build.version, revision: this.build.revision, revisionLabel: this.build.revisionLabel, channel: this.build.channel },
      latest: { version: manifest.version, revision: manifest.revision, revisionLabel: `r${manifest.revision}`, publishedAt: manifest.publishedAt, notes: manifest.notes, bytes: manifest.package.bytes },
      available, installable, status: !available ? "current" : installable ? "available" : "manual-required",
      message: !available ? "当前已是最新版本" : installable ? `发现新版本 ${manifest.version} r${manifest.revision}` : this.platform==='darwin'?"发现 Mac 新版本，请从官网下载对应芯片的完整客户端":"此更新需要重新下载安装完整客户端",
    };
  }
  async check() {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetcher(this.build.updateManifestUrl, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, redirect: "error", signal: controller.signal });
      if (!response.ok) throw new AppError(`更新服务器返回 HTTP ${response.status}`, "UPDATE_SERVER_ERROR", 502);
      const manifest = validateUpdateManifest(await readBoundedJson(response), { product: this.build.product, channel: this.build.channel, platform:this.platform, arch:this.arch, publicKey: await readFile(this.publicKeyPath, "utf8") });
      this.lastCheck = { manifest, checkedAt: new Date().toISOString() };
      const settings = await this.settings(); await atomicJson(this.settingsPath, { ...settings, lastCheckedAt: this.lastCheck.checkedAt });
      return this.safeResult(manifest);
    } catch (error) {
      if (error?.name === "AbortError") throw new AppError("检查更新超时，请稍后重试", "UPDATE_CHECK_TIMEOUT", 504);
      if (error instanceof AppError) throw error;
      throw new AppError("无法连接 777codes 更新服务器", "UPDATE_SERVER_UNREACHABLE", 503);
    } finally { clearTimeout(timer); }
  }
  async status() {
    return { ok: true, current: { version: this.build.version, revision: this.build.revision, revisionLabel: this.build.revisionLabel, channel: this.build.channel }, settings: await this.settings(), lastCheck: this.lastCheck ? { checkedAt: this.lastCheck.checkedAt, ...this.safeResult(this.lastCheck.manifest) } : null, ready: this.ready ? { revision: this.ready.manifest.revision, downloadedAt: this.ready.downloadedAt } : null };
  }
  async currentManifest() {
    if (!this.lastCheck || Date.now() - Date.parse(this.lastCheck.checkedAt) > 5 * 60_000) await this.check();
    return this.lastCheck.manifest;
  }
  async download() {
    if(this.operation)throw new AppError("正在处理管理工具更新，请稍候","UPDATE_BUSY",409);this.operation='download';
    try{
    const manifest = await this.currentManifest(); const summary = this.safeResult(manifest);
    if (!summary.available) throw new AppError("当前没有可下载的新版本", "UPDATE_NOT_AVAILABLE", 409);
    if (!summary.installable) throw new AppError("此版本需要下载完整安装包", "UPDATE_MANUAL_REQUIRED", 409);
    const downloads = safeChild(this.updateRoot, "downloads"); await mkdir(downloads, { recursive: true });
    const finalPath = safeChild(downloads, basename(new URL(manifest.package.url).pathname)); const temporary = `${finalPath}.${process.pid}.part`;
    await rm(temporary, { force: true });
    const controller = new AbortController(); let timer; const refreshIdle=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),60_000);};refreshIdle();
    let size = 0; const digest = createHash("sha256"); const output=await open(temporary,"wx");
    try {
      const response = await this.fetcher(manifest.package.url, { redirect: "error", signal: controller.signal });
      if (!response.ok || !response.body) throw new AppError(`更新包下载失败：HTTP ${response.status}`, "UPDATE_DOWNLOAD_FAILED", 502);
      for await (const chunk of response.body) {
        refreshIdle();
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > manifest.package.bytes || size > 512 * 1024 * 1024) throw new AppError("更新包大小与清单不一致", "UPDATE_PACKAGE_SIZE_MISMATCH", 409);
        digest.update(bytes);await output.write(bytes);
      }
      await output.sync();await output.close();
      if (size !== manifest.package.bytes || digest.digest("hex") !== manifest.package.sha256) throw new AppError("更新包完整性校验失败", "UPDATE_PACKAGE_HASH_MISMATCH", 409);
      await rm(finalPath, { force: true }); await rename(temporary, finalPath);
      this.ready = { manifest, path: finalPath, downloadedAt: new Date().toISOString() };
      return { ok: true, revision: manifest.revision, bytes: size, downloaded: true };
    } catch (error) {
      await output.close().catch(()=>{}); await rm(temporary, { force: true });
      if (error?.name === "AbortError") throw new AppError("下载更新超时，请稍后重试", "UPDATE_DOWNLOAD_TIMEOUT", 504);
      if (error instanceof AppError) throw error;
      throw new AppError("更新包下载失败，请检查网络后重试", "UPDATE_DOWNLOAD_FAILED", 502);
    } finally { clearTimeout(timer); }
    }finally{this.operation=null;}
  }
  async install() {
    if(this.operation)throw new AppError("正在处理管理工具更新，请稍候","UPDATE_BUSY",409);this.operation='install';
    try{
    if (this.isolated) throw new AppError("隔离预览不能安装管理工具更新", "ISOLATED_PREVIEW", 403);
    if (!this.ready || !await exists(this.ready.path)) throw new AppError("请先下载并校验更新包", "UPDATE_NOT_READY", 409);
    const info = await stat(this.ready.path); const digest = await sha256File(this.ready.path);
    if (info.size !== this.ready.manifest.package.bytes || digest !== this.ready.manifest.package.sha256) throw new AppError("待安装更新包已发生变化，请重新下载", "UPDATE_PACKAGE_HASH_MISMATCH", 409);
    const extension=this.platform==='win32'?'.ps1':'.mjs';const helperPath = safeChild(this.updateRoot, `update-helper${extension}`); await writeFile(helperPath, await readFile(this.helperSource));
    const planPath = safeChild(this.updateRoot, 'update-plan.json');
    const updatePlan = { schemaVersion:2,product:this.build.product,platform:this.platform,arch:this.arch,archivePath: this.ready.path, archiveSha256: digest,archiveBytes:info.size,packageFiles:this.ready.manifest.package.files, installRoot: this.installRoot, executable: this.executable, managerRoot: this.managerRoot, sidecarPid:process.pid,sidecarExecutable:process.execPath,sidecarStartEpochMs:this.sidecarStartEpochMs,parentPid:this.outerPid,parentStartEpochMs:this.outerStartEpochMs, currentRevision: this.build.revision, targetRevision: this.ready.manifest.revision };
    await atomicJson(planPath, updatePlan);
    const plan = { helperPath, planPath, ...updatePlan };
    const scheduled = await this.scheduleInstall(plan);
    if (!scheduled?.scheduled) throw new AppError("未能启动独立更新程序", "UPDATE_SCHEDULE_FAILED", 500);
    return { ok: true, restarting: true, targetRevision: this.ready.manifest.revision, message: "更新已校验，管理工具即将重启" };
    }finally{this.operation=null;}
  }
}
