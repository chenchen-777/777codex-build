import { AppError, ensure } from './errors.mjs';
import { normalizeModels } from './runtime-core.mjs';
import { requireProviderAdapter } from './provider-descriptor.mjs';

export const PLATFORM_ORIGIN = 'https://www.777codes.codes';
export function modelEndpoint(baseUrl) {
  let url; try { url = new URL(baseUrl); } catch { throw new AppError('接口地址无效', 'INVALID_ENDPOINT'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, '只支持无凭证参数的 HTTPS 地址', 'INVALID_ENDPOINT');
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = `${prefix.endsWith('/v1') ? prefix : `${prefix}/v1`}/models`;
  return url.href;
}
export async function readBoundedJson(response, maxBytes = 256 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('接口响应过大', 'RESPONSE_TOO_LARGE', 502);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('接口未返回有效 JSON', 'INVALID_RESPONSE', 502); }
}
export async function syncModels(profile, fetcher = fetch) {
  requireProviderAdapter(profile);
  ensure(typeof profile.apiKey === 'string' && profile.apiKey.length >= 8, '请先填写 API Key', 'KEY_REQUIRED');
  const url = modelEndpoint(profile.baseUrl);
  let response;
  try { response = await fetcher(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${profile.apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new AppError('模型同步失败：网络异常或超时，请稍后重试', 'MODEL_NETWORK_ERROR', 502); }
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const detail = status === 401 || status === 403 ? 'Key 无效或没有访问权限' : status === 429 ? '请求过于频繁' : status >= 500 ? '平台或上游服务异常，不代表 Key 无效' : '平台拒绝了请求';
    throw new AppError(`模型同步失败（HTTP ${status}）：${detail}`, `MODEL_HTTP_${status}`, status >= 400 && status <= 599 ? status : 502);
  }
  const models = normalizeModels(await readBoundedJson(response));
  return { ok: true, models, syncedAt: new Date().toISOString(), message: models.length ? '模型列表已同步；不代表实际对话已经验证' : '接口未返回模型，请检查该 Key 的分组权限' };
}
export function validateTextProfile(profile, models) {
  if (profile.type !== 'text') return;
  requireProviderAdapter(profile);
  ensure(typeof profile.model === 'string' && profile.model.trim(), '请同步并选择模型后保存', 'MODEL_REQUIRED');
  ensure(models.includes(profile.model), '所选模型不在此 Key 的模型列表中，请重新同步并选择', 'MODEL_NOT_LISTED');
  ensure(['low', 'medium', 'high', 'xhigh'].includes(profile.reasoningEffort), '请选择推理强度；是否支持需通过实际对话确认', 'REASONING_REQUIRED');
}
