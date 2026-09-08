import { ensure } from './errors.mjs';

export const validIdentifier = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
const validProtocol = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:+-]{0,127}$/.test(value);
export const validModelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);
export function normalizeDescriptor(input, previous = {}) {
  const type = input.type ?? previous.type ?? 'text';
  const protocol = input.protocol ?? previous.protocol ?? 'responses';
  ensure(validIdentifier(type) && validProtocol(protocol), '类型或协议标识格式无效', 'INVALID_PROVIDER_DESCRIPTOR');
  const models = input.models === undefined ? (previous.models ?? []) : input.models;
  ensure(Array.isArray(models) && models.length <= 100 && models.every(validModelId), '模型列表格式无效', 'INVALID_PROVIDER_MODELS');
  const metadata = input.metadata === undefined ? (previous.metadata ?? {}) : input.metadata;
  ensure(metadata && typeof metadata === 'object' && !Array.isArray(metadata), '附加信息必须为对象', 'INVALID_PROVIDER_METADATA');
  let nodes = 0;
  function visit(value, depth) {
    ensure(++nodes <= 128 && depth <= 4, '附加信息层级或数量超限', 'INVALID_PROVIDER_METADATA');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { ensure(Number.isFinite(value), '附加信息数值无效', 'INVALID_PROVIDER_METADATA'); return; }
    if (typeof value === 'string') {
      ensure(value.length <= 1024, '附加信息文本过长', 'INVALID_PROVIDER_METADATA');
      ensure(!input.apiKey || !value.includes(input.apiKey), '附加信息不能重复包含 Key', 'INVALID_PROVIDER_METADATA');
      return;
    }
    ensure(typeof value === 'object', '附加信息格式无效', 'INVALID_PROVIDER_METADATA');
    for (const [key, child] of Object.entries(value)) {
      ensure(key.length <= 64 && !['__proto__', 'prototype', 'constructor'].includes(key) && !/(api.?key|token|password|secret|authorization)/i.test(key), '附加信息不能包含凭据或危险字段', 'INVALID_PROVIDER_METADATA');
      ensure(!input.apiKey || !key.includes(input.apiKey), '附加信息不能重复包含 Key', 'INVALID_PROVIDER_METADATA');
      visit(child, depth + 1);
    }
  }
  visit(metadata, 0);
  const encoded = JSON.stringify(metadata);
  ensure(Buffer.byteLength(encoded, 'utf8') <= 8192, '附加信息过大', 'INVALID_PROVIDER_METADATA');
  ensure(!input.apiKey || !encoded.includes(input.apiKey), '附加信息不能重复包含 Key', 'INVALID_PROVIDER_METADATA');
  return { type, protocol, models: [...new Set(models)], metadata: JSON.parse(encoded) };
}

// This registry controls execution, not admission to the configuration library.
export function providerAdapter(profile) {
  if (profile.platformSync?.disabled) return { canActivate: false, canSyncModels: false, status: 'platform-disabled', message: '平台已禁用或移除' };
  const type = profile.type ?? 'text', protocol = profile.protocol ?? 'responses';
  const base = String(profile.baseUrl || '').replace(/\/+$/, '');
  const text = type === 'text' && ['responses', 'openai-responses', 'openai'].includes(protocol) && ['https://www.777codes.codes', 'https://www.777codes.codes/v1'].includes(base);
  return { canActivate: text, canSyncModels: text, status: text ? 'adapter-ready' : 'stored-only', message: text ? '已适配文字配置；实际对话待验证' : '已保存，暂未适配调用' };
}
export function requireProviderAdapter(profile) {
  ensure(providerAdapter(profile).canActivate, '此类型或协议尚未适配调用，配置可以保存但不能切换使用', 'PROVIDER_ADAPTER_UNAVAILABLE', 409);
}
