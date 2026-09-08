import { open, readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { providerAdapter } from './provider-descriptor.mjs';
import TOML from '@iarna/toml';
import { getProviderSecret, listProviders, updateObservedModel } from './provider-store.mjs';
import { syncModels, PLATFORM_ORIGIN } from './model-service.mjs';
import { apply777Configuration } from './config-store.mjs';
import { AppError } from './errors.mjs';

const validModel = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v);
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
async function candidates(root, files = [], depth = 0) {
  if (depth > 5 || files.length >= 10000) return files;
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return files; throw e; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const path = join(root, e.name);
    if (e.isDirectory()) await candidates(path, files, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) files.push({ path, ...(await stat(path)) });
  }
  return files;
}
// Read bounded metadata only; never return chat contents, paths or raw errors.
export async function latestModelUse(codexRoot, cache = new Map()) {
  const files = (await candidates(join(codexRoot, 'sessions'))).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 24);
  const found = [];
  for (const file of files) {
    const signature = `${file.size}:${file.mtimeMs}`;
    if (cache.get(file.path)?.signature === signature) { if (cache.get(file.path).value) found.push(cache.get(file.path).value); continue; }
    const handle = await open(file.path, 'r'); let value = null;
    try {
      const head = Buffer.alloc(Math.min(256 * 1024, file.size)); await handle.read(head, 0, head.length, 0);
      let meta; try { meta = JSON.parse(head.toString('utf8').split('\n')[0]); } catch { continue; }
      if (meta.type !== 'session_meta' || meta.payload?.model_provider !== '777codes' || typeof meta.payload?.source === 'object') continue;
      const length = Math.min(1024 * 1024, file.size), tail = Buffer.alloc(length);
      await handle.read(tail, 0, length, file.size - length);
      const lines = tail.toString('utf8').split('\n'); if (length < file.size) lines.shift(); lines.pop();
      for (const line of lines) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (row.type !== 'turn_context') continue;
        const p = row.payload, time = Date.parse(row.timestamp), effort = p?.effort ?? p?.reasoning_effort;
        if (!validModel(p?.model) || !efforts.includes(effort) || !Number.isFinite(time) || time > Date.now() + 60000) continue;
        if (!value || time >= value.time) value = { model: p.model, reasoningEffort: effort, time };
      }
    } finally { await handle.close(); }
    cache.set(file.path, { signature, value }); if (value) found.push(value);
  }
  for (const key of cache.keys()) if (!files.some(f => f.path === key)) cache.delete(key);
  return found.sort((a, b) => b.time - a.time)[0] || null;
}

export class ModelFollow {
  constructor({ managerRoot, codexRoot, adapters, fetcher = fetch, now = Date.now, reader = latestModelUse }) {
    Object.assign(this, { managerRoot, codexRoot, adapters, fetcher, now, reader }); this.cache = new Map(); this.support = null;
  }
  async refresh({ check = true } = {}) {
    const active = (await listProviders(this.managerRoot)).find(p => p.active && p.type === 'text');
    if (!active) return { status: 'unconfigured', message: '尚未选择 Key', model: null };
    if (active.platformSync?.disabled || active.platformSync?.requiresActivation) return { status: 'unsupported', providerId: active.id, message: active.platformSync.disabled ? '当前 Key 已被平台禁用或移除，请选择其他 Key' : '平台 Key 或线路已更新，请重新选择此 Key 后启动', model: active.model, reasoningEffort: active.reasoningEffort };
    if (!providerAdapter(active).canActivate) return { status: 'unsupported', providerId: active.id, message: '此协议暂未适配调用', model: active.model, reasoningEffort: active.reasoningEffort };
    let profile;
    try {
      profile = await getProviderSecret(this.managerRoot, active.id, this.adapters().unprotect);
      const config = TOML.parse(await readFile(join(this.codexRoot, 'config.toml'), 'utf8'));
      const auth = JSON.parse(await readFile(join(this.codexRoot, 'auth.json'), 'utf8'));
      if (config.model_provider !== '777codes' || config.model_providers?.['777codes']?.base_url?.replace(/\/+$/, '') !== PLATFORM_ORIGIN || auth.OPENAI_API_KEY !== profile.apiKey) {
        return { status: 'mismatch', message: 'Codex 当前 Key 与管理工具不同，未同步', providerId: active.id, model: active.model, reasoningEffort: active.reasoningEffort };
      }
      const observed = await this.reader(this.codexRoot, this.cache);
      if (observed && observed.time > (active.modelSelectionAt || 0) && observed.time > (active.modelObservedAt || 0)) {
        const updated = await updateObservedModel(this.managerRoot, active.id, observed);
        Object.assign(profile, updated);
      }
    } catch {
      return { status: 'unknown', message: '无法读取 Codex 模型或 Key 状态，未确认支持', providerId: active.id, model: active.model, reasoningEffort: active.reasoningEffort };
    }
    const identity = createHash('sha256').update([profile.id, profile.apiKey, profile.baseUrl, profile.model, profile.reasoningEffort].join('\n')).digest('hex');
    if (check && (!this.support || this.support.identity !== identity || this.now() >= this.support.until)) {
      let result;
      try {
        const models = await syncModels(profile, this.fetcher);
        result = models.models.includes(profile.model)
          ? { status: 'listed', message: 'Key 模型列表支持；实际对话尚未验证' }
          : { status: 'unsupported', message: '当前 Key 的模型列表不包含此模型，请切换模型或 Key' };
      } catch (error) {
        result = { status: 'unknown', message: error.code?.startsWith('MODEL_HTTP_') ? `无法确认支持（HTTP ${error.status}），请稍后重试` : '无法确认模型支持：连接失败或超时' };
      }
      this.support = { identity, until: this.now() + 60000, ...result };
    }
    const result = this.support?.identity === identity ? this.support : { status: 'unchecked', message: '模型支持待检查' };
    return { providerId: active.id, model: profile.model, reasoningEffort: profile.reasoningEffort, observedAt: profile.modelObservedAt || null, canApply: true, status: result.status, message: result.message };
  }
}

export async function prepareFollowedModel(follower, apply = apply777Configuration) {
  const current = await follower.refresh();
  if (['unsupported', 'mismatch'].includes(current.status)) throw new AppError(current.message, 'MODEL_SELECTION_UNAVAILABLE', 409);
  if (!current.canApply) return { applied: false };
  const profile = await getProviderSecret(follower.managerRoot, current.providerId, follower.adapters().unprotect);
  const config = TOML.parse(await readFile(join(follower.codexRoot, 'config.toml'), 'utf8'));
  if (config.model === profile.model && config.model_reasoning_effort === profile.reasoningEffort) return { applied: false };
  await apply({ codexRoot: follower.codexRoot, apiKey: profile.apiKey, options: { model: profile.model, reasoningEffort: profile.reasoningEffort, disableResponseStorage: profile.disableResponseStorage } });
  return { applied: true, model: profile.model, reasoningEffort: profile.reasoningEffort };
}
