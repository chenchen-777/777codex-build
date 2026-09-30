import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../account-ui.js', import.meta.url), 'utf8');
// Tiny DOM harness executes the shipped event handlers, including real async event lifetime.
function harness() {
  const nodes = new Map(); const copies = []; const calls = []; const toasts = [];
  class Element {
    constructor(id) { this.id = id; this.dataset = {}; this.listeners = {}; this.children = []; this.disabled = false; this.open = false; this.classList = { toggle() {} }; }
    set innerHTML(value) {
      this.clear(); this.html = value;
      for (const match of value.matchAll(/id="([^"]+)"/g)) { const child = new Element(match[1]); nodes.set('#' + child.id, child); this.children.push(child); }
      if (value.includes('data-account-close')) { const child = new Element('data-account-close'); nodes.set('[data-account-close]', child); this.children.push(child); }
      const input = nodes.get('#referral-link'); if (input) input.value = /id="referral-link"[^>]*value="([^"]*)"/.exec(value)?.[1];
    }
    get innerHTML() { return this.html || ''; }
    clear() { for (const child of this.children) { child.clear(); nodes.delete('#' + child.id); } this.children = []; }
    set textContent(value) { this.clear(); this.text = value; this.html = ''; }
    get textContent() { return this.text || ''; }
    querySelector(selector) { return nodes.get(selector); }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    async click() { const event = { currentTarget: this, preventDefault() {} }; const promise = this.listeners.click(event); event.currentTarget = null; return promise; }
  }
  for (const id of ['account-dialog', 'account-dialog-body', 'account-dialog-footer', 'account-dialog-close', 'account-entry', 'account-name', 'referral-share', 'sync-platform-keys']) nodes.set('#' + id, new Element(id));
  const state = { referral: async () => ({ inviteCode: 'FAKE', shareUrl: 'https://www.777codes.codes/download/777codex?ref=FAKE', invitedUserCount: 3, totalCommission: 1, pendingCommission: 0, thisMonthCommission: 1, ruleSummary: '平台规则', installer: { version: 'test', sizeBytes: 1048576, sha256: 'a'.repeat(64) } }), openError: null };
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/account/status') return { state: 'logged-in', user: { displayName: 'Fake' } };
    if (path === '/api/account/referral') return state.referral();
    if (path.endsWith('/open') && state.openError) throw state.openError;
    return { state: 'logged-out' };
  };
  const showToast = (...args) => toasts.push(args);
  const runButton = async (button, busy, task) => { const previous = button.textContent; button.disabled = true; button.textContent = busy; try { return await task(); } catch (error) { showToast(error.message); return null; } finally { button.disabled = false; button.textContent = previous; } };
  vm.runInNewContext(source, { window: { addEventListener(){}, manager777: { api, showToast, runButton, escapeHtml: value => String(value), confirm: async () => true } }, document: { addEventListener(){}, querySelector: selector => nodes.get(selector) || null }, navigator: { clipboard: { writeText: async value => copies.push(value) } }, setTimeout, clearTimeout });
  return { nodes, state, calls, copies, toasts, click: id => nodes.get('#' + id).click() };
}

test('share UI loads, refreshes before copying, opens, and keeps the correct button label', async () => {
  const h = harness(); await h.click('referral-share');
  assert.equal(h.nodes.get('#account-referral').textContent, '刷新推广信息');
  assert.match(h.nodes.get('#referral-content').innerHTML, /邀请人数/);
  await h.click('referral-copy'); assert.equal(h.copies.length, 1);
  assert.equal(h.copies[0], 'https://www.777codes.codes/download/777codex?ref=FAKE');
  assert.equal(h.calls.filter(x => x.path === '/api/account/referral').length, 2);
  await h.click('referral-open'); assert.equal(h.calls.at(-1).path, '/api/account/referral/open');
  assert.equal(h.toasts.at(-1)[0], '已请求浏览器打开推广下载页');
});

test('failed refresh clears old link and error recovers without reopening account', async () => {
  const h = harness(); await h.click('referral-share'); const success = h.state.referral;
  h.state.referral = async () => { throw new Error('平台尚未配置正式安装包'); };
  await h.click('referral-copy'); assert.equal(h.copies.length, 0); assert.ok(!h.nodes.has('#referral-link'));
  assert.equal(h.nodes.get('#account-referral').textContent, '重试读取');
  assert.match(h.nodes.get('#account-error').textContent, /正式安装包/);
  h.state.referral = success; await h.click('account-referral');
  assert.equal(h.nodes.get('#account-error').textContent, ''); assert.ok(h.nodes.has('#referral-link'));
});

test('closing while loading ignores late response; logout captures event target before awaiting confirmation', async () => {
  const h = harness(); let release;
  h.state.referral = () => new Promise(resolve => { release = resolve; });
  const loading = h.click('referral-share');
  while (!release) await Promise.resolve();
  await h.click('account-dialog-close'); release({}); await loading;
  assert.ok(!h.nodes.has('#referral-link')); assert.equal(h.nodes.get('#account-dialog').open, false);
  await h.click('account-entry'); await h.click('account-logout');
  assert.equal(h.calls.at(-1).path, '/api/account/logout'); assert.equal(h.nodes.get('#account-dialog').open, false);
});

test('opening a now-unavailable referral removes copyable stale data', async () => {
  const h = harness(); await h.click('referral-share'); h.state.openError = new Error('平台推广暂不可用');
  await h.click('referral-open'); assert.ok(!h.nodes.has('#referral-link')); assert.match(h.nodes.get('#account-error').textContent, /暂不可用/);
});

test('referral UI keeps commission amounts on the website even if the API supplies them', async () => {
  const h = harness(); const original = h.state.referral;
  h.state.referral = async () => ({ ...await original(), currency: 'USD', totalCommission: 12.5 });
  await h.click('referral-share');
  const html = h.nodes.get('#referral-content').innerHTML;
  assert.doesNotMatch(html, /佣金|返佣|奖励/);
  assert.match(html, /邀请人数/);
  assert.match(html, /复制链接/);
  assert.doesNotMatch(html, /12\.50|USD|¥|累计返佣|待结算|本月/);
  h.state.referral = async () => ({ ...await original(), totalCommission: null, pendingCommission: null, thisMonthCommission: null });
  await h.click('account-referral');
  assert.doesNotMatch(h.nodes.get('#referral-content').innerHTML, /币种未提供|未提供|累计返佣|待结算|本月/);
  await h.click('account-entry');
  assert.doesNotMatch(h.nodes.get('#account-dialog-body').innerHTML, /佣金|返佣|奖励/);
  assert.doesNotMatch(h.nodes.get('#account-dialog-body').innerHTML, /已经结算的返佣/);
});
