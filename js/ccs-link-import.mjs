import { createHash, randomUUID } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { PLATFORM_ORIGIN, syncModels } from './model-service.mjs';
import { maskApiKey } from './config-core.mjs';
import { listProviders, upsertProvider } from './provider-store.mjs';
import { normalizeProviderGroup } from './provider-group.mjs';
import { normalizeDescriptor, providerAdapter } from './provider-descriptor.mjs';

const fields = ['resource', 'app', 'name', 'homepage', 'endpoint', 'apiKey', 'configFormat', 'usageEnabled', 'usageScript', 'usageAutoInterval', 'model', 'groupName', 'groupMultiplier', 'providerType', 'protocol', 'models', 'metadata'];
const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);
export function parseCCSImportLink(raw) {
  ensure(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 32768 && !/[\x00-\x20\x7f]/.test(raw) && !/%(?![\da-f]{2})/i.test(raw), '导入链接格式无效', 'INVALID_IMPORT_URL');
  let url; try { url = new URL(raw); } catch { throw new AppError('导入链接格式无效', 'INVALID_IMPORT_URL'); }
  ensure(url.protocol === 'codes777:' && !url.username && !url.password && !url.hash, '导入链接来源无效', 'IMPORT_URL_ORIGIN');
  ensure(url.host !== 'import', '旧版导入链接已停用，请在平台重新点击导入', 'LEGACY_IMPORT_LINK');
  ensure(url.host === 'v1' && url.pathname === '/import', '导入链接路径无效', 'IMPORT_URL_PATH');
  const q = url.searchParams;
  ensure([...q.keys()].every(k => fields.includes(k) && q.getAll(k).length === 1), '导入链接参数无效', 'IMPORT_URL_PARAMETERS');
  ensure(q.get('resource') === 'provider' && q.get('app') === 'codex' && q.get('configFormat') === 'json', '仅支持 Codex 配置导入', 'IMPORT_URL_PARAMETERS');
  const extended = q.has('providerType') || q.has('protocol');
  ensure(q.has('providerType') === q.has('protocol'), '类型与协议必须一起提供', 'IMPORT_URL_PARAMETERS');
  let endpoint; try { endpoint = new URL(q.get('endpoint')); } catch { throw new AppError('接口地址无效', 'IMPORT_URL_ORIGIN'); }
  ensure(endpoint.origin === PLATFORM_ORIGIN && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && q.get('homepage')?.replace(/\/+$/, '') === PLATFORM_ORIGIN, '仅支持 777codes 平台地址', 'IMPORT_URL_ORIGIN');
  if (!extended) ensure(q.get('endpoint')?.replace(/\/+$/, '') === PLATFORM_ORIGIN, '旧文字链接接口地址无效', 'IMPORT_URL_ORIGIN');
  const name = q.get('name'), apiKey = q.get('apiKey'), model = q.get('model') ?? '';
  ensure(name?.trim() && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name), '配置名称无效', 'IMPORT_URL_PARAMETERS');
  ensure(typeof apiKey === 'string' && /^[\x21-\x7e]{8,4096}$/.test(apiKey), 'Key 格式无效', 'IMPORT_URL_PARAMETERS');
  ensure((extended && model === '') || validModel(model), '模型名称无效', 'IMPORT_URL_PARAMETERS');
  function jsonField(key, fallback) {
    if (!q.has(key)) return fallback;
    try { return JSON.parse(q.get(key)); } catch { throw new AppError('导入附加字段不是有效 JSON', 'IMPORT_URL_PARAMETERS'); }
  }
  const descriptor = normalizeDescriptor({ type: extended ? q.get('providerType') : 'text', protocol: extended ? q.get('protocol') : 'responses', models: jsonField('models', []), metadata: jsonField('metadata', {}), apiKey });
  // CCS usage metadata is intentionally discarded. Never decode/evaluate scripts.
  return { name: name.trim(), ...descriptor, baseUrl: endpoint.href.replace(/\/+$/, ''), apiKey, model,
    reasoningEffort: descriptor.type === 'text' ? 'high' : '', disableResponseStorage: true,
    ...normalizeProviderGroup({ groupName: q.get('groupName') ?? undefined, groupMultiplier: q.get('groupMultiplier') ?? undefined }) };
}

export class CCSLinkImport {
  constructor({ managerRoot, adapters, modelFetcher = fetch }) {
    Object.assign(this, { managerRoot, adapters, modelFetcher }); this.pending = null;
  }
  state() {
    const p = this.pending; if (!p) return { phase: 'idle' };
    const { name, type, model, reasoningEffort, apiKey } = p.profile;
    return { phase: p.phase, intentId: p.id, profile: { name, type, model, reasoningEffort, baseUrl: p.profile.baseUrl, protocol: p.profile.protocol, models: p.profile.models, adapter: providerAdapter(p.profile), maskedKey: maskApiKey(apiKey), ...normalizeProviderGroup(p.profile) } };
  }
  offer(raw) {
    const profile = parseCCSImportLink(raw);
    const digest = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
    if (this.pending?.digest === digest) return this.state();
    ensure(!this.pending, '已有配置待导入，请先保存或取消', 'IMPORT_BUSY', 409);
    this.pending = { id: randomUUID(), digest, phase: 'ready', profile }; return this.state();
  }
  current() { ensure(this.pending?.phase === 'ready', '导入状态已改变，请重新发起', 'IMPORT_STATE', 409); return this.pending; }
  cancel() {
    ensure(this.pending?.phase !== 'saving', '正在保存，请稍后', 'IMPORT_BUSY', 409);
    this.pending = null; return this.state();
  }
  async models() {
    const p = this.current(); const result = await syncModels(p.profile, this.modelFetcher);
    ensure(this.pending === p, '导入已取消', 'IMPORT_STATE', 409); return result;
  }
  async save(input) {
    ensure(input.confirm === 'IMPORT_PROVIDER', '请确认导入配置', 'CONFIRMATION_REQUIRED');
    const p = this.current(); const profile = { ...p.profile, model: input.model ?? p.profile.model, reasoningEffort: input.reasoningEffort ?? p.profile.reasoningEffort };
    ensure((profile.model === '' || validModel(profile.model)) && (profile.reasoningEffort === '' || ['low', 'medium', 'high', 'xhigh'].includes(profile.reasoningEffort)), '模型设置无效', 'IMPORT_URL_PARAMETERS');
    p.phase = 'saving';
    try {
      const keyFingerprint = createHash('sha256').update(profile.baseUrl + '\n' + profile.apiKey).digest('hex');
      const providers = await listProviders(this.managerRoot);
      const previous = providers.find(v => v.source?.platform === '777codes-link' && v.source.keyFingerprint === keyFingerprint && v.type === profile.type && v.protocol === profile.protocol);
      Object.assign(profile, normalizeProviderGroup(profile, previous));
      if (previous && ['name', 'model', 'reasoningEffort', 'baseUrl', 'protocol', 'disableResponseStorage', 'groupName', 'groupMultiplier'].every(k => previous[k] === profile[k]) && JSON.stringify(previous.models || []) === JSON.stringify(profile.models) && JSON.stringify(previous.metadata || {}) === JSON.stringify(profile.metadata)) {
        this.pending = null; return { ok: true, duplicate: true, provider: previous, activated: false };
      }
      ensure(!previous || input.replace === true, '此 Key 已存在，请勾选更新配置后保存', 'IMPORT_DUPLICATE', 409);
      const provider = await upsertProvider(this.managerRoot, { ...profile, id: previous?.id, source: { platform: '777codes-link', keyFingerprint } }, this.adapters().protect);
      // Receiving a link does not prove that a Key or model is available.
      this.pending = null; return { ok: true, provider, activated: false };
    } catch (error) { if (this.pending === p) p.phase = 'ready'; throw error; }
  }
}
