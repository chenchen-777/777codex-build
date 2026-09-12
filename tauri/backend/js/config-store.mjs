import {officialConfig} from './official-connection.mjs';
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { activeProviderBaseUrl, valueForKey } from "./runtime-core.mjs";
import { buildAuthJson, merge777Config } from "./config-core.mjs";

const MANAGED_FILES = ["config.toml", "auth.json"];
const BACKUP_FOLDER = "777codex-backups";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function readOptional(pathname) {
  try {
    return { exists: true, data: await readFile(pathname) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, data: Buffer.alloc(0) };
    throw error;
  }
}

async function writePrivate(pathname, data, options = {}) {
  await writeFile(pathname, data, options);
  try {
    await chmod(pathname, 0o600);
  } catch {
    // Windows ACLs are inherited from the user profile. chmod is best effort.
  }
}

function validateGenerated(configText, authText, apiKey) {
  if (valueForKey(configText, "model_provider") !== "777codes") {
    throw new Error("写入验证失败：model_provider 不是 777codes");
  }
  if (activeProviderBaseUrl(configText) !== "https://www.777codes.codes") {
    throw new Error("写入验证失败：777codes 请求地址不正确");
  }
  const auth = JSON.parse(authText);
  if (auth.OPENAI_API_KEY !== apiKey) {
    throw new Error("写入验证失败：auth.json 未包含本次确认的 Key");
  }
}

async function createSnapshot(codexRoot, reason, date = new Date()) {
  const backupId = `${compactTimestamp(date)}-${randomBytes(3).toString("hex")}`;
  const backupRoot = join(codexRoot, BACKUP_FOLDER);
  const backupDir = join(backupRoot, backupId);
  await mkdir(backupDir, { recursive: false });

  const manifest = {
    schemaVersion: 1,
    backupId,
    createdAt: date.toISOString(),
    reason,
    files: {},
  };

  for (const name of MANAGED_FILES) {
    const current = await readOptional(join(codexRoot, name));
    manifest.files[name] = {
      existed: current.exists,
      length: current.data.length,
      sha256: current.exists ? sha256(current.data) : null,
    };
    if (current.exists) await writePrivate(join(backupDir, name), current.data, { flag: "wx" });
  }

  await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

async function replaceFile(codexRoot, name, data, transactionId) {
  const target = join(codexRoot, name);
  const temporary = join(codexRoot, `.${name}.777codex-${transactionId}.tmp`);
  const previous = join(codexRoot, `.${name}.777codex-${transactionId}.previous`);
  await writePrivate(temporary, data, { flag: "wx" });

  let movedPrevious = false;
  try {
    const current = await readOptional(target);
    if (current.exists) {
      await rename(target, previous);
      movedPrevious = true;
    }
    await rename(temporary, target);
    if (movedPrevious) await rm(previous, { force: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (movedPrevious) {
      await rm(target, { force: true }).catch(() => {});
      await rename(previous, target).catch(() => {});
    }
    throw error;
  }
}

async function restoreSnapshot(codexRoot, manifest) {
  const backupDir = join(codexRoot, BACKUP_FOLDER, manifest.backupId);
  const transactionId = randomBytes(5).toString("hex");
  for (const name of MANAGED_FILES) {
    const record = manifest.files?.[name];
    if (!record) throw new Error(`备份清单缺少 ${name}`);
    const target = join(codexRoot, name);
    if (!record.existed) {
      await rm(target, { force: true });
      continue;
    }
    const data = await readFile(join(backupDir, name));
    if (sha256(data) !== record.sha256) throw new Error(`备份校验失败：${name}`);
    await replaceFile(codexRoot, name, data, transactionId);
  }
}

export function resolveCodexRoot(environment = process.env) {
  if (environment.CODEX_HOME) return resolve(environment.CODEX_HOME);
  if (!environment.USERPROFILE) throw new Error("无法定位当前用户目录");
  return join(environment.USERPROFILE, ".codex");
}

export async function apply777Configuration({ codexRoot, apiKey, options = {} }) {
  const normalizedKey = String(apiKey || "").trim();
  if (normalizedKey.length < 8) throw new Error("API Key 长度不正确");
  await mkdir(codexRoot, { recursive: true });
  await mkdir(join(codexRoot, BACKUP_FOLDER), { recursive: true });

  const configState = await readOptional(join(codexRoot, "config.toml"));
  const authState = await readOptional(join(codexRoot, "auth.json"));
  const existingConfig = configState.data.toString("utf8");
  let existingAuth = {};
  if (authState.exists && authState.data.length) {
    try {
      existingAuth = JSON.parse(authState.data.toString("utf8"));
    } catch {
      throw new Error("现有 auth.json 不是有效 JSON，已停止且未写入");
    }
  }

  const configText = merge777Config(existingConfig, options);
  const authText = buildAuthJson(existingAuth, normalizedKey);
  validateGenerated(configText, authText, normalizedKey);

  const snapshot = await createSnapshot(codexRoot, "before-apply-777codes");
  const transactionId = randomBytes(5).toString("hex");
  try {
    await replaceFile(codexRoot, "config.toml", configText, transactionId);
    await replaceFile(codexRoot, "auth.json", authText, transactionId);
    const [writtenConfig, writtenAuth] = await Promise.all([
      readFile(join(codexRoot, "config.toml"), "utf8"),
      readFile(join(codexRoot, "auth.json"), "utf8"),
    ]);
    validateGenerated(writtenConfig, writtenAuth, normalizedKey);
  } catch (error) {
    await restoreSnapshot(codexRoot, snapshot).catch(() => {});
    throw error;
  }

  return {
    ok: true,
    backupId: snapshot.backupId,
    configPath: join(codexRoot, "config.toml"),
    authPath: join(codexRoot, "auth.json"),
    provider: "777codes",
    model: valueForKey(configText, "model"),
  };
}

export async function list777Backups(codexRoot) {
  const backupRoot = join(codexRoot, BACKUP_FOLDER);
  let entries = [];
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(backupRoot, entry.name, "manifest.json"), "utf8"));
      results.push({
        backupId: manifest.backupId,
        createdAt: manifest.createdAt,
        reason: manifest.reason,
        files: manifest.files,
      });
    } catch {
      // Ignore incomplete backup folders; they are never valid rollback targets.
    }
  }
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function rollback777Configuration({ codexRoot, backupId }) {
  const normalizedId = basename(String(backupId || ""));
  if (!/^[0-9TZ]+-[a-f0-9]{6}$/.test(normalizedId) || normalizedId !== backupId) {
    throw new Error("备份编号不合法");
  }
  const manifestPath = join(codexRoot, BACKUP_FOLDER, normalizedId, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.backupId !== normalizedId) throw new Error("备份清单不匹配");

  const recovery = await createSnapshot(codexRoot, `before-rollback-${normalizedId}`);
  try {
    await restoreSnapshot(codexRoot, manifest);
  } catch (error) {
    await restoreSnapshot(codexRoot, recovery).catch(() => {});
    throw error;
  }
  return { ok: true, restoredBackupId: normalizedId };
}

export async function read777ConfigState(codexRoot) {
  const pathname = join(codexRoot, "config.toml");
  try {
    const [text, info] = await Promise.all([readFile(pathname, "utf8"), stat(pathname)]);
    return {
      exists: true,
      path: pathname,
      modifiedAt: info.mtime.toISOString(),
      model: valueForKey(text, "model"),
      provider: valueForKey(text, "model_provider"),
      baseUrl: activeProviderBaseUrl(text),
      text,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      exists: false,
      path: pathname,
      modifiedAt: null,
      model: null,
      provider: null,
      baseUrl: null,
      text: "",
    };
  }
}


export async function applyOfficialConnection(codexRoot) {
 await mkdir(codexRoot,{recursive:true});
 await mkdir(join(codexRoot,BACKUP_FOLDER),{recursive:true});
 const previous=await readOptional(join(codexRoot,'config.toml'));
 const config=officialConfig(previous.data.toString('utf8'));
 const backup=await createSnapshot(codexRoot,'before-official-connection');
 try {
  await replaceFile(codexRoot,'auth.json','{}\n',randomBytes(5).toString('hex'));
  await replaceFile(codexRoot,'config.toml',config,randomBytes(5).toString('hex'));
  if(await readFile(join(codexRoot,'config.toml'),'utf8')!==config || await readFile(join(codexRoot,'auth.json'),'utf8')!=='{}\n')throw new Error('官方连接写入检查失败');
 } catch(error) {await restoreSnapshot(codexRoot,backup);throw error;}
 return {ok:true,backupId:backup.backupId,requiresLogin:true};
}
