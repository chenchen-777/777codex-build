import { createHash } from 'node:crypto';
import { PlatformImport, validateImportPayload } from './platform-import.mjs';
import { AppError, ensure } from './errors.mjs';
import { maskApiKey } from './config-core.mjs';

export function parseDirectImportLink(raw) {
  ensure(typeof raw === 'string' && raw.length <= 2048, '导入链接无效', 'INVALID_IMPORT_URL');
  let url; try { url = new URL(raw); } catch { throw new AppError('导入链接无效', 'INVALID_IMPORT_URL'); }
  ensure(url.protocol === 'codes777:' && url.host === 'import' && !url.username && !url.password && !url.hash, '导入链接来源无效', 'IMPORT_URL_ORIGIN');
  ensure(url.pathname === '' || url.pathname === '/', '导入链接路径无效', 'IMPORT_URL_PATH');
  ensure(url.searchParams.get('v') !== '1', '这是旧版配对链接，请在平台重新发起免配对导入', 'LEGACY_IMPORT_LINK');
  ensure([...url.searchParams.keys()].length === 3 && ['v', 'intent', 'ticket'].every(k => url.searchParams.getAll(k).length === 1) &&
    url.searchParams.get('v') === '2' && /^[A-Za-z0-9_-]{32}$/.test(url.searchParams.get('intent') || '') && /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('ticket') || ''), '导入链接参数不完整或版本不兼容', 'IMPORT_URL_PARAMETERS');
  return { intentId: url.searchParams.get('intent'), ticket: url.searchParams.get('ticket') };
}

// Reuse profile verification, encryption, backup, dedupe and explicit save only.
// No v1 claim, pairing, decision, or polling endpoint is used by this service.
export class DirectImport extends PlatformImport {
  state() {
    const p = this.pending;
    if (!p) return { phase: 'idle' };
    if (this.now() >= p.deadline) { this.pending = null; return { phase: 'expired' }; }
    const profile = p.payload?.profile;
    return { phase: p.phase, intentId: p.intentId, expiresAt: new Date(p.deadline).toISOString(),
      ...(profile ? { profile: { name: profile.name, type: profile.type, model: profile.model, reasoningEffort: profile.reasoningEffort, maskedKey: maskApiKey(profile.apiKey) } } : {}) };
  }
  offer(raw) {
    const { intentId, ticket } = parseDirectImportLink(raw);
    const ticketHash = createHash('sha256').update(ticket).digest('hex');
    const state = this.state();
    if (this.pending?.intentId === intentId && this.pending.ticketHash === ticketHash) return state;
    ensure(['idle', 'expired'].includes(state.phase), '已有配置待确认，请先保存或取消，再从平台重新发起', 'IMPORT_BUSY', 409);
    this.pending = { intentId, ticket, ticketHash, phase: 'offered', deadline: this.now() + 120000 };
    return this.state();
  }
  async start() {
    const p = this.current(['offered']); p.phase = 'redeeming';
    try {
      const { status, body } = await this.call('/direct-redemptions', { schemaVersion: 2, intentId: p.intentId, ticket: p.ticket, clientVersion: '0.11.0-r4' });
      ensure(this.pending === p && this.now() < p.deadline, '导入已取消或过期，请在平台重新发起', 'IMPORT_EXPIRED', 410);
      ensure(status === 200 && body.schemaVersion === 2, '平台导入响应版本不兼容', 'INVALID_IMPORT_PAYLOAD', 502);
      p.payload = validateImportPayload({ ...body, schemaVersion: 1 }, p.intentId);
      p.phase = 'ready'; p.deadline = this.now() + 300000;
      return this.state();
    } catch (error) {
      if (this.pending === p) this.pending = null;
      throw error;
    } finally { p.ticket = ''; }
  }
}
