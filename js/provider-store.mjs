import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { maskApiKey } from "./config-core.mjs";
import { normalizeProviderGroup } from './provider-group.mjs';
import { ensure } from './errors.mjs';
import { normalizeDescriptor, providerAdapter } from './provider-descriptor.mjs';

const STORE_FILE = "providers.json";

export function resolveManagerRoot(environment = process.env) {
  const base = environment.APPDATA || environment.USERPROFILE;
  if (!base) throw new Error("无法定位当前用户的应用数据目录");
  return resolve(base, "777Codex");
}

async function readStore(managerRoot) {
  try {
    const value = JSON.parse(await readFile(join(managerRoot, STORE_FILE), "utf8"));
    return value && Array.isArray(value.providers) ? value : { schemaVersion: 1, providers: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, providers: [] };
    throw new Error("Key 配置库损坏，已停止读取；请从备份恢复");
  }
}

async function writeStore(managerRoot, store) {
  await mkdir(managerRoot, { recursive: true });
  const target = join(managerRoot, STORE_FILE);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function publicRecord(record) {
  const { protectedKey, syncConnectionHash, ...safe } = record;
  return { ...safe, adapter: providerAdapter(record), maskedKey: record.maskedKey || "未保存" };
}

export async function listProviders(managerRoot) {
  const store = await readStore(managerRoot);
  return store.providers.map(publicRecord);
}

export async function getProviderSecret(managerRoot, id, unprotect) {
  const store = await readStore(managerRoot);
  const record = store.providers.find((item) => item.id === id);
  if (!record) throw new Error("没有找到所选 Key 配置");
  ensure(!record.platformSync?.disabled, '此 Key 已被平台禁用或移除，请同步或切换其他 Key', 'PLATFORM_KEY_DISABLED', 409);
  if (!record.protectedKey) throw new Error("该配置没有保存 Key");
  return { ...publicRecord(record), apiKey: unprotect(record.protectedKey) };
}

export async function upsertProvider(managerRoot, input, protect) {
  const store = await readStore(managerRoot);
  const id = String(input.id || randomUUID());
  const previous = store.providers.find((item) => item.id === id);
  const apiKey = String(input.apiKey || "").trim();
  if (!previous && apiKey.length < 8) throw new Error("新配置必须填写有效 Key");
  if (apiKey && apiKey.length < 8) throw new Error("API Key 长度不正确");

  const descriptor = normalizeDescriptor(input, previous);
  const { type } = descriptor;
  const record = {
    id,
    name: String(input.name || "未命名配置").trim().slice(0, 80),
    ...descriptor,
    baseUrl: String(input.baseUrl || "https://www.777codes.codes").trim().replace(/\/+$/, ""),
    model: String(input.model ?? previous?.model ?? (type === "text" ? "gpt-5.5" : "")),
    reasoningEffort: String(input.reasoningEffort ?? previous?.reasoningEffort ?? (type === 'text' ? 'high' : '')),
    disableResponseStorage: input.disableResponseStorage !== false,
    active: Boolean(previous?.active && previous.type === type && previous.protocol === descriptor.protocol),
    verifiedAt: null,
    updatedAt: new Date().toISOString(),
    modelSelectionAt: Date.now(),
    modelObservedAt: previous?.modelObservedAt || 0,
    ...normalizeProviderGroup(input, previous),
    protectedKey: apiKey ? protect(apiKey) : previous?.protectedKey,
    maskedKey: apiKey ? maskApiKey(apiKey) : previous?.maskedKey,
    ...(input.source || previous?.source ? { source: input.source || previous.source } : {}),
    ...(input.importId || previous?.importId ? { importId: input.importId || previous.importId } : {}),
    ...(previous?.platformSync ? { platformSync: previous.platformSync, syncConnectionHash: previous.syncConnectionHash, groupId: previous.groupId } : {}),
  };
  if (!record.protectedKey) throw new Error("没有可保存的 Key");
  const index = store.providers.findIndex((item) => item.id === id);
  if (index >= 0) {
    const backupRoot = join(managerRoot, 'provider-backups');
    await mkdir(backupRoot, { recursive: true });
    await copyFile(join(managerRoot, STORE_FILE), join(backupRoot, `providers-${Date.now()}-${randomUUID()}.json`));
    store.providers[index] = record;
  }
  else store.providers.push(record);
  await writeStore(managerRoot, store);
  return publicRecord(record);
}

export async function markProviderVerified(managerRoot, id) {
  const store = await readStore(managerRoot);
  const record = store.providers.find((item) => item.id === id);
  if (!record) throw new Error("没有找到所选 Key 配置");
  record.verifiedAt = new Date().toISOString();
  record.updatedAt = record.verifiedAt;
  await writeStore(managerRoot, store);
  return publicRecord(record);
}

export async function markProviderActive(managerRoot, id, type = "text") {
  const store = await readStore(managerRoot);
  ensure(!store.providers.find(p => p.id === id)?.platformSync?.disabled, '此 Key 已被平台禁用或移除', 'PLATFORM_KEY_DISABLED', 409);
  let found = false;
  for (const record of store.providers) {
    if (record.type !== type) continue;
    record.active = record.id === id;
    if (record.active) { found = true; record.modelSelectionAt = Date.now(); if (record.platformSync) record.platformSync.requiresActivation = false; }
  }
  if (!found) throw new Error("没有找到要启用的配置");
  await writeStore(managerRoot, store);
  return store.providers.map(publicRecord);
}

export async function updateObservedModel(managerRoot, id, observation) {
  const store = await readStore(managerRoot);
  const record = store.providers.find(p => p.id === id && p.active && p.type === 'text');
  if (!record) throw new Error('当前 Key 已改变');
  if (observation.time <= Math.max(record.modelSelectionAt || 0, record.modelObservedAt || 0)) return publicRecord(record);
  const changed = record.model !== observation.model || record.reasoningEffort !== observation.reasoningEffort;
  record.model = observation.model; record.reasoningEffort = observation.reasoningEffort;
  record.modelObservedAt = observation.time;
  if (changed) record.verifiedAt = null;
  await writeStore(managerRoot, store);
  return publicRecord(record);
}

export async function deleteProvider(managerRoot, id, { confirmActive = false } = {}) {
  const store = await readStore(managerRoot);
  const record = store.providers.find((item) => item.id === id);
  if (!record) throw new Error("配置不存在");
  ensure(!record.active || confirmActive === true, '此 Key 正在使用，请确认删除当前配置', 'ACTIVE_DELETE_CONFIRMATION_REQUIRED', 409);
  const backupId = `providers-delete-${Date.now()}-${randomUUID()}.json`;
  const backupRoot = join(managerRoot, 'provider-backups');
  await mkdir(backupRoot, { recursive: true });
  await copyFile(join(managerRoot, STORE_FILE), join(backupRoot, backupId));
  store.providers = store.providers.filter((item) => item.id !== id);
  await writeStore(managerRoot, store);
  return { ok: true, deletedActive: Boolean(record.active), backupId };
}

// Called only after validated, complete pagination. A single atomic file commit;
// manually created or link-imported records never acquire platform ownership.
export async function reconcilePlatformProviders(managerRoot, snapshot, protect) {
  const { origin, ownerId, items, snapshotComplete } = snapshot;
  ensure(snapshotComplete === true && origin === 'https://www.777codes.codes' && typeof ownerId === 'string' && ownerId.length > 0 && Array.isArray(items), '平台同步尚未完整完成，未修改配置', 'KEY_SYNC_INCOMPLETE', 409);
  ensure(new Set(items.map(p => p.keyId)).size === items.length, '平台 Key 编号重复，未修改配置', 'KEY_SYNC_RESPONSE_INVALID', 502);
  const store = await readStore(managerRoot), now = new Date().toISOString();
  const owned = p => p.platformSync?.origin === origin && p.platformSync.ownerId === ownerId;
  let added = 0, updated = 0, disabled = 0, restored = 0;
  const seen = new Set();
  for (const input of items) {
    const previous = store.providers.find(p => owned(p) && p.platformSync.keyId === input.keyId);
    const descriptor = normalizeDescriptor(input);
    const syncConnectionHash = createHash('sha256').update(JSON.stringify([input.apiKey, input.baseUrl, descriptor.type, descriptor.protocol])).digest('hex');
    const connectionChanged = previous && syncConnectionHash !== previous.syncConnectionHash;
    const record = {
      ...previous,
      id: previous?.id || randomUUID(), name: input.name, ...descriptor, baseUrl: input.baseUrl,
      model: previous?.model ?? input.model,
      reasoningEffort: previous?.reasoningEffort ?? (descriptor.type === 'text' ? 'high' : ''),
      disableResponseStorage: previous?.disableResponseStorage ?? true,
      groupName: input.groupName ?? null, groupMultiplier: input.groupMultiplier, groupId: input.groupId,
      active: Boolean(previous?.active), verifiedAt: null, updatedAt: now,
      modelSelectionAt: previous?.modelSelectionAt ?? Date.now(), modelObservedAt: previous?.modelObservedAt ?? 0,
      protectedKey: previous && !connectionChanged ? previous.protectedKey : protect(input.apiKey), maskedKey: maskApiKey(input.apiKey),
      syncConnectionHash,
      platformSync: { origin, ownerId, keyId: input.keyId, disabled: false, syncedAt: now, requiresActivation: Boolean(previous?.platformSync?.requiresActivation || previous?.active && (connectionChanged || previous?.platformSync?.disabled)) },
    };
    ensure(record.protectedKey, '无法安全保存平台 Key，原有配置未改动', 'KEY_SYNC_STORAGE_FAILED', 500);
    if (previous) { store.providers[store.providers.indexOf(previous)] = record; updated++; if (previous.platformSync.disabled) restored++; }
    else { store.providers.push(record); added++; }
    seen.add(input.keyId);
  }
  for (const record of store.providers) if (owned(record) && !seen.has(record.platformSync.keyId) && !record.platformSync.disabled) {
    record.platformSync = { ...record.platformSync, disabled: true, syncedAt: now };
    record.verifiedAt = null; record.updatedAt = now; disabled++;
  }
  let backupId = null;
  try {
    await readFile(join(managerRoot, STORE_FILE));
    backupId = `providers-sync-${Date.now()}-${randomUUID()}.json`;
    const backupRoot = join(managerRoot, 'provider-backups'); await mkdir(backupRoot, { recursive: true });
    await copyFile(join(managerRoot, STORE_FILE), join(backupRoot, backupId));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeStore(managerRoot, store);
  return { ok: true, snapshotComplete: true, total: items.length, added, updated, disabled, restored, backupId, syncedAt: now, activated: false };
}
