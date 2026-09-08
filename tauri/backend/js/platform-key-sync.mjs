import { AppError, ensure } from './errors.mjs';
import { PLATFORM_ORIGIN } from './account-manager.mjs';
import { normalizeDescriptor, validModelId } from './provider-descriptor.mjs';
import { normalizeProviderGroup } from './provider-group.mjs';
import { reconcilePlatformProviders } from './provider-store.mjs';

const invalid = () => new AppError('平台 Key 同步数据不完整或格式不兼容，原有配置未改动', 'KEY_SYNC_RESPONSE_INVALID', 502);
const text = (v, max, empty = false) => typeof v === 'string' && (empty || v.length > 0) && v.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
export function normalizePlatformKey(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid();
  const { keyId, key, name, protocol, taskType, baseUrl, models, defaultModel, groupId, groupName, rateMultiplier } = item;
  if (!text(keyId, 128) || !/^[A-Za-z0-9_-]+$/.test(keyId) || typeof key !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(key)) throw invalid();
  if (!text(name, 80) || !text(taskType, 64) || !text(baseUrl, 2048) || !Array.isArray(models) || !text(groupName, 120, true) || !(defaultModel === '' || validModelId(defaultModel))) throw invalid();
  if (!(groupId === null || Number.isSafeInteger(groupId) && groupId >= 0) || typeof rateMultiplier !== 'number' || !Number.isFinite(rateMultiplier) || rateMultiplier < 0) throw invalid();
  let endpoint; try { endpoint = new URL(baseUrl); } catch { throw invalid(); }
  // Routing may use a configured API hostname, but credentials are never sent by synchronization.
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw invalid();
  const type = taskType === 'chat' ? 'text' : taskType;
  let descriptor, group;
  try {
    descriptor = normalizeDescriptor({ type, protocol, models, apiKey: key });
    group = normalizeProviderGroup({ groupName: groupName || null, groupMultiplier: rateMultiplier });
  } catch { throw invalid(); }
  // Never accept a server echo of a full Key in any UI-visible field.
  if ([keyId, name, taskType, protocol, baseUrl, ...models, defaultModel, groupName].some(value => value.includes(key))) throw invalid();
  return { keyId, apiKey: key, name, ...descriptor, baseUrl, model: defaultModel, ...group, groupId };
}

export class PlatformKeySync {
  constructor({ account, managerRoot, protect, now = Date.now }) { Object.assign(this, { account, managerRoot, protect, now }); this.busy = false; }
  async sync() {
    this.account.assertLive();
    ensure(!this.busy, '平台 Key 正在同步，请稍后', 'KEY_SYNC_BUSY', 409);
    this.busy = true;
    try {
      const token = await this.account.access();
      const ownerId = this.account.user?.id;
      ensure(text(ownerId, 128), '请先登录 777codes 平台账号', 'ACCOUNT_LOGIN_REQUIRED', 401);
      const items = [], seen = new Set(); let total = null;
      const deadline = this.now() + 120_000;
      for (let page = 1; page <= 100; page++) {
        if (this.now() > deadline) throw new AppError('平台 Key 同步超时，原有配置未改动', 'KEY_SYNC_TIMEOUT', 504);
        const { payload } = await this.account.request('GET', `/api/v1/desktop/keys?page=${page}&pageSize=100`, { token, maxBytes: 4 * 1024 * 1024 });
        const data = payload?.data;
        if (payload?.code !== 0 || !data || data.scope !== 'keys.read' || data.page !== page || data.pageSize !== 100 || !Array.isArray(data.items) || data.items.length > 100 || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 10000 || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0 || data.totalPages !== Math.ceil(data.total / 100) || data.hasMore !== (page < data.totalPages) || data.snapshotComplete !== !data.hasMore) throw invalid();
        if (total !== null && total !== data.total) throw new AppError('同步期间平台 Key 列表发生变化，请重试；原有配置未改动', 'KEY_SYNC_SNAPSHOT_CHANGED', 409);
        total = data.total;
        for (const raw of data.items) {
          const item = normalizePlatformKey(raw);
          if (seen.has(item.keyId)) throw invalid();
          seen.add(item.keyId); items.push(item);
        }
        if (!data.hasMore) {
          if (items.length !== total) throw invalid();
          ensure(this.account.user?.id === ownerId && this.account.accessToken === token, '账号状态已改变，请重新同步；原有配置未改动', 'KEY_SYNC_ACCOUNT_CHANGED', 409);
          return await reconcilePlatformProviders(this.managerRoot, { origin: PLATFORM_ORIGIN, ownerId, items, snapshotComplete: true }, this.protect);
        }
        if (data.items.length !== 100) throw invalid();
      }
      throw invalid();
    } finally { this.busy = false; }
  }
}
