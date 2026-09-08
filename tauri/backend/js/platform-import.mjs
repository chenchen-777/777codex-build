import { createHash, randomBytes } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { PLATFORM_ORIGIN, readBoundedJson, syncModels, validateTextProfile } from './model-service.mjs';
import { listProviders, upsertProvider, markProviderVerified } from './provider-store.mjs';
import { maskApiKey } from './config-core.mjs';

const idPattern = /^[A-Za-z0-9_-]{22,128}$/;
export function parseImportLink(raw) {
  ensure(typeof raw === 'string' && raw.length <= 2048, '导入链接无效', 'INVALID_IMPORT_URL');
  let url; try { url = new URL(raw); } catch { throw new AppError('导入链接无效', 'INVALID_IMPORT_URL'); }
  ensure(url.protocol === 'codes777:' && url.host === 'import' && !url.username && !url.password && !url.hash, '导入链接来源格式无效，请从平台官网重新发起', 'IMPORT_URL_ORIGIN');
  // Windows URI normalization may turn an empty authority path into '/'.
  ensure(url.pathname === '' || url.pathname === '/', '导入链接路径不兼容，请从平台官网重新发起', 'IMPORT_URL_PATH');
  ensure([...url.searchParams.keys()].length === 2 && url.searchParams.getAll('v').length === 1 && url.searchParams.getAll('intent').length === 1 &&
    url.searchParams.get('v') === '1' && idPattern.test(url.searchParams.get('intent') || ''), '导入链接参数不完整或版本不兼容，请从平台官网重新发起', 'IMPORT_URL_PARAMETERS');
  return url.searchParams.get('intent');
}
export function createProof() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
}
export function validateImportPayload(value, intentId) {
  ensure(value?.schemaVersion === 1 && value.importId === intentId, '导入版本或请求标识不匹配', 'INVALID_IMPORT_PAYLOAD');
  const p = value.profile; const s = value.source;
  ensure(s?.platform === '777codes' && ['accountId', 'keyId'].every(k => typeof s[k] === 'string' && /^[\w-]{1,128}$/.test(s[k])), '平台来源标识无效', 'INVALID_IMPORT_SOURCE');
  ensure(p && p.type === 'text' && p.protocol === 'responses' && p.baseUrl === PLATFORM_ORIGIN, '当前导入版本仅支持 777codes 文字 Responses 配置', 'UNSUPPORTED_IMPORT_TYPE');
  ensure(typeof p.name === 'string' && p.name.trim() && p.name.length <= 80 && typeof p.apiKey === 'string' && p.apiKey.length >= 8 && p.apiKey.length <= 4096 && !/[\s\x00-\x1f]/.test(p.apiKey), '导入名称或密钥格式无效', 'INVALID_IMPORT_PAYLOAD');
  ensure(typeof p.model === 'string' && p.model.length <= 200 && !/[\x00-\x1f]/.test(p.model) && ['', 'low', 'medium', 'high', 'xhigh'].includes(p.reasoningEffort) && p.disableResponseStorage === true, '模型设置格式不受支持', 'INVALID_IMPORT_PAYLOAD');
  return {
    importId: intentId, source: { platform: s.platform, accountId: s.accountId, keyId: s.keyId },
    profile: { name: p.name, type: 'text', baseUrl: PLATFORM_ORIGIN, apiKey: p.apiKey, protocol: 'responses', model: p.model, reasoningEffort: p.reasoningEffort, disableResponseStorage: true },
  };
}
const errorMessages = {
  IMPORT_EXPIRED: '导入授权已过期，请在平台重新发起', IMPORT_CONSUMED: '此授权已经领取；如未保存请重新发起',
  IMPORT_REJECTED: '平台已拒绝此次授权', PROOF_INVALID: '授权绑定校验失败', IMPORT_NOT_FOUND: '导入请求不存在或无权访问',
  INTENT_ALREADY_BOUND: '此次导入已绑定其他请求，请重新发起', KEY_UNAVAILABLE: '此 Key 已不可用',
  IMPORT_UNAVAILABLE: '平台导入尚未开启或暂不可用', RATE_LIMITED: '请求过快，请等待后重试',
};

export class PlatformImport {
  constructor({ managerRoot, adapters, fetcher = fetch, modelFetcher = fetch, now = Date.now, apiOrigin = PLATFORM_ORIGIN, testMode = false }) {
    // Test origin injection is constructor-only, never from URL, env or renderer.
    ensure(apiOrigin === PLATFORM_ORIGIN || testMode && /^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin), '导入服务地址不可更改', 'INVALID_ORIGIN');
    Object.assign(this, { managerRoot, adapters, fetcher, modelFetcher, now, apiOrigin }); this.pending = null;
  }
  state() {
    const p = this.pending;
    if (!p) return { phase: 'idle' };
    if (this.now() >= p.deadline) { this.pending = null; return { phase: 'expired' }; }
    const profile = p.payload?.profile;
    return { phase: p.phase, intentId: p.intentId, pairingCode: p.pairingCode || '', expiresAt: new Date(p.deadline).toISOString(),
      ...(profile ? { profile: { name: profile.name, type: profile.type, model: profile.model, reasoningEffort: profile.reasoningEffort, maskedKey: maskApiKey(profile.apiKey) } } : {}) };
  }
  offer(raw) {
    const intentId = parseImportLink(raw);
    const state = this.state();
    if (state.intentId === intentId) return state;
    ensure(['idle', 'expired'].includes(state.phase), '已有导入待处理，请先完成或取消', 'IMPORT_BUSY', 409);
    this.pending = { phase: 'offered', intentId, deadline: this.now() + 300000 };
    return this.state();
  }
  current(phases) {
    const state = this.state();
    ensure(phases.includes(state.phase), '导入状态已改变，请重新发起或刷新', 'IMPORT_STATE', 409);
    return this.pending;
  }
  cancel() { this.pending = null; return { phase: 'idle' }; }
  async call(path, body) {
    let response;
    try { response = await this.fetcher(`${this.apiOrigin}/api/v1/manager-import${path}`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError('平台导入连接失败或超时，请重试；若领取结果不确定，请重新发起', 'IMPORT_NETWORK', 502); }
    if (!response.ok) {
      const error = await readBoundedJson(response, 32768).catch(() => ({}));
      const code = Object.hasOwn(errorMessages, error.code) ? error.code : 'IMPORT_UNAVAILABLE';
      const failure = new AppError(errorMessages[code], code, response.status >= 400 ? response.status : 502);
      failure.retryAfter = Math.min(60, Math.max(3, Number(response.headers.get('retry-after')) || 3));
      throw failure;
    }
    return { status: response.status, body: await readBoundedJson(response, 32768) };
  }
  async start() {
    const p = this.current(['offered']); p.phase = 'claiming';
    const proof = createProof();
    try {
      const { body: claim, status } = await this.call('/claims', { intentId: p.intentId, codeChallenge: proof.challenge, codeChallengeMethod: 'S256', clientVersion: '0.11.0', schemaVersion: 1 });
      ensure(this.pending === p && this.now() < p.deadline, '导入已取消或过期', 'IMPORT_EXPIRED', 410);
      ensure(status === 201 && idPattern.test(claim.claimId) && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(claim.pairingCode) && Number.isFinite(Date.parse(claim.expiresAt)) && Date.parse(claim.expiresAt) > this.now(), '平台授权格式不兼容', 'INVALID_CLAIM', 502);
      Object.assign(p, { verifier: proof.verifier, claimId: claim.claimId, pairingCode: claim.pairingCode, phase: 'awaiting', deadline: Math.min(p.deadline, Date.parse(claim.expiresAt)), nextPoll: 0, interval: Math.min(30, Math.max(3, Number(claim.pollIntervalSeconds) || 3)) });
      return this.state();
    } catch (error) { if (this.pending === p) this.pending = null; throw error; }
  }
  async openApproval() {
    const p = this.current(['awaiting']);
    await this.adapters().openExternal(`${PLATFORM_ORIGIN}/manager-import/approve?claim=${p.claimId}`);
    return { ok: true };
  }
  async poll() {
    const p = this.current(['awaiting']);
    if (p.polling || this.now() < p.nextPoll) return this.state();
    p.polling = true; p.nextPoll = this.now() + p.interval * 1000;
    try {
      const result = await this.call(`/claims/${p.claimId}/redemptions`, { codeVerifier: p.verifier });
      ensure(this.pending === p && this.now() < p.deadline, '导入已取消或过期', 'IMPORT_EXPIRED', 410);
      if (result.status === 202 && result.body.status === 'pending') return this.state();
      ensure(result.status === 200, '领取状态无效', 'INVALID_REDEMPTION', 502);
      p.payload = validateImportPayload(result.body, p.intentId); p.verifier = ''; p.phase = 'ready';
      return this.state();
    } catch (error) {
      if (error.status === 429) p.nextPoll = this.now() + error.retryAfter * 1000;
      else if (this.pending === p) this.pending = null;
      throw error;
    } finally { p.polling = false; }
  }
  async models() {
    const p = this.current(['ready']);
    const result = await syncModels(p.payload.profile, this.modelFetcher);
    ensure(this.pending === p && this.now() < p.deadline, '导入已取消或过期', 'IMPORT_EXPIRED', 410);
    return result;
  }
  async save(input) {
    ensure(input.confirm === 'IMPORT_PROVIDER', '请先确认导入', 'CONFIRMATION_REQUIRED');
    const p = this.current(['ready']);
    const payload = p.payload;
    const profile = { ...payload.profile, model: input.model, reasoningEffort: input.reasoningEffort };
    const models = await this.models(); validateTextProfile(profile, models.models);
    const providers = await listProviders(this.managerRoot);
    const previous = providers.find(v => v.source?.platform === payload.source.platform && v.source?.accountId === payload.source.accountId && v.source?.keyId === payload.source.keyId && v.type === profile.type);
    if (previous?.importId === payload.importId) { this.cancel(); return { ok: true, duplicate: true, provider: previous }; }
    ensure(!previous || input.replace === true, '这个平台 Key 已存在，确认更新后重试；不会自动切换当前配置', 'IMPORT_DUPLICATE', 409);
    ensure(this.pending === p && this.now() < p.deadline, '导入已取消或过期', 'IMPORT_EXPIRED', 410);
    p.phase = 'saving';
    try {
      const saved = await upsertProvider(this.managerRoot, { ...profile, id: previous?.id, source: payload.source, importId: payload.importId }, this.adapters().protect);
      await markProviderVerified(this.managerRoot, saved.id);
      this.cancel(); return { ok: true, provider: saved, activated: false };
    } catch (error) { if (this.pending === p) p.phase = 'ready'; throw error; }
  }
}
