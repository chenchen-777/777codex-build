import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import http from 'node:http';
import { AccountManager } from '../js/account-manager.mjs';
import { PlatformKeySync, normalizePlatformKey } from '../js/platform-key-sync.mjs';
import { getProviderSecret, listProviders, markProviderActive, updateObservedModel, upsertProvider, reconcilePlatformProviders } from '../js/provider-store.mjs';
import { ModelFollow, prepareFollowedModel } from '../js/model-follow.mjs';
import { providerAdapter } from '../js/provider-descriptor.mjs';

const encryptionKey = randomBytes(32);
const protect = value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64'); };
const unprotect = value => { const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'); };
const item = (id, changes = {}) => ({ keyId: `key_FAKE_${id}`, key: `sk-FAKE-SYNC-ONLY-${id}-abcdef`, name: `假 Key ${id}`, taskType: 'chat', protocol: 'openai', baseUrl: 'https://www.777codes.codes', models: ['gpt-5.5'], defaultModel: 'gpt-5.5', groupId: 23, groupName: 'Codex 优惠', rateMultiplier: 0.33, ...changes });
const envelope = (items, page = 1, total = items.length) => ({ code: 0, message: 'success', data: { items, page, pageSize: 100, total, totalPages: Math.ceil(total / 100), hasMore: page < Math.ceil(total / 100), snapshotComplete: page >= Math.ceil(total / 100), scope: 'keys.read' } });
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), '777-key-sync-')); t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const account = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: () => { throw new Error('No login or browser during sync'); } });
  account.accessToken = 'dta_FAKE-SYNC-ONLY'; account.accessExpiresAt = Date.now() + 900000; account.user = { id: 'usr_FAKE_A', displayName: '假账号 A' };
  let response = envelope([]);
  account.fetcher = async (url, options) => { calls.push({ url, authorization: options.headers.Authorization }); assert.match(url, /^https:\/\/www\.777codes\.codes\/api\/v1\/desktop\/keys\?page=\d+&pageSize=100$/); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); return Response.json(typeof response === 'function' ? response(new URL(url)) : response); };
  return { root, account, calls, set: value => { response = value; }, sync: new PlatformKeySync({ account, managerRoot: root, protect }) };
}

test('complete paginated sync preserves protocol, endpoint, group, multiplier and encrypts Keys without login', async t => {
  const s = await setup(t), first = Array.from({ length: 100 }, (_, i) => item(i));
  const last = [item('img', { protocol: 'gpt-image', taskType: 'image', baseUrl: 'https://www.777codes.codes/gpt-image/v1beta', models: ['gemini-3.1-flash-image-preview-c'], defaultModel: 'gemini-3.1-flash-image-preview-c', rateMultiplier: 0 }), item('future', { protocol: 'vendor.future-v9', taskType: 'future-task', models: [], defaultModel: '', groupId: null, groupName: '' })];
  s.set(url => envelope(url.searchParams.get('page') === '1' ? first : last, Number(url.searchParams.get('page')), 102));
  const result = await s.sync.sync(); assert.equal(result.added, 102); assert.equal(result.snapshotComplete, true); assert.equal(result.activated, false);
  assert.equal(s.calls.length, 2); assert.ok(s.calls.every(c => c.authorization === 'Bearer dta_FAKE-SYNC-ONLY'));
  let rows = await listProviders(s.root); assert.equal(rows.length, 102); assert.ok(rows.every(p => !p.active && p.verifiedAt === null));
  const text = rows.find(p => p.platformSync.keyId === 'key_FAKE_0'); assert.equal(text.type, 'text'); assert.equal(text.protocol, 'openai'); assert.equal(text.adapter.canActivate, true); assert.equal(text.groupName, 'Codex 优惠'); assert.equal(text.groupMultiplier, 0.33); assert.equal(text.groupId, 23);
  const img = rows.find(p => p.type === 'image'); assert.equal(img.baseUrl, last[0].baseUrl); assert.equal(img.groupMultiplier, 0); assert.equal(img.adapter.canActivate, false);
  const future = rows.find(p => p.type === 'future-task'); assert.equal(future.protocol, 'vendor.future-v9'); assert.equal(future.model, ''); assert.equal(future.adapter.canActivate, false);
  assert.equal((await getProviderSecret(s.root, text.id, unprotect)).apiKey, first[0].key);
  const stored = await readFile(join(s.root, 'providers.json'), 'utf8'); assert.ok(!stored.includes(first[0].key)); assert.ok(!JSON.stringify(rows).includes(first[0].key)); assert.ok(!JSON.stringify(rows).includes('syncConnectionHash'));
  assert.ok(!JSON.stringify(result).includes('dta_')); assert.ok(!JSON.stringify(result).includes('sk-'));
  const repeated = await s.sync.sync(); rows = await listProviders(s.root); assert.equal(repeated.added, 0); assert.equal(repeated.updated, 102); assert.equal(rows.find(p => p.platformSync.keyId === text.platformSync.keyId).id, text.id);
});

test('reconciliation only disables owned records, preserves model choices, blocks a disabled active Key and can restore', async t => {
  const s = await setup(t); s.set(envelope([item(1), item(2)])); await s.sync.sync();
  const a = (await listProviders(s.root))[0]; await markProviderActive(s.root, a.id, 'text');
  await updateObservedModel(s.root, a.id, { model: 'gpt-5.6-sol', reasoningEffort: 'medium', time: Date.now() + 1000 });
  const manual = await upsertProvider(s.root, { name: '手工', apiKey: 'sk-FAKE-MANUAL-ONLY' }, protect);
  const linked = await upsertProvider(s.root, { name: '网页', apiKey: 'sk-FAKE-LINK-ONLY', source: { platform: '777codes-link' } }, protect);
  s.account.user = { id: 'usr_FAKE_B' }; s.set(envelope([item(3)])); await s.sync.sync();
  s.account.user = { id: 'usr_FAKE_A' }; s.set(envelope([item(1, { groupName: '新分组', rateMultiplier: 1.3, defaultModel: 'gpt-5.5' })]));
  const result = await s.sync.sync(); assert.equal(result.disabled, 1);
  let rows = await listProviders(s.root), current = rows.find(p => p.id === a.id);
  assert.equal(current.model, 'gpt-5.6-sol'); assert.equal(current.reasoningEffort, 'medium'); assert.equal(current.active, true); assert.equal(current.groupMultiplier, 1.3);
  assert.ok(rows.find(p => p.id === manual.id)); assert.ok(rows.find(p => p.id === linked.id)); assert.equal(rows.find(p => p.platformSync?.ownerId === 'usr_FAKE_B').platformSync.disabled, false);
  s.set(envelope([])); await s.sync.sync(); rows = await listProviders(s.root); current = rows.find(p => p.id === a.id); assert.equal(current.platformSync.disabled, true); assert.equal(current.active, true); assert.equal(providerAdapter(current).canActivate, false);
  await assert.rejects(getProviderSecret(s.root, a.id, unprotect), { code: 'PLATFORM_KEY_DISABLED' }); await assert.rejects(markProviderActive(s.root, a.id), { code: 'PLATFORM_KEY_DISABLED' });
  const follower = new ModelFollow({ managerRoot: s.root, codexRoot: join(s.root, 'codex'), adapters: () => ({ unprotect }) });
  await assert.rejects(prepareFollowedModel(follower), { code: 'MODEL_SELECTION_UNAVAILABLE' });
  s.set(envelope([item(1)])); assert.equal((await s.sync.sync()).restored, 1);
  current = (await listProviders(s.root)).find(p => p.id === a.id); assert.equal(current.platformSync.requiresActivation, true);
  await markProviderActive(s.root, a.id); assert.equal((await listProviders(s.root)).find(p => p.id === a.id).platformSync.requiresActivation, false);
  const backup = await readFile(join(s.root, 'provider-backups', result.backupId), 'utf8'); assert.ok(!backup.includes(item(1).key));
});

test('failed, duplicate, truncated, count-changing or incomplete pagination never changes the old file', async t => {
  const s = await setup(t); s.set(envelope([item('seed')])); await s.sync.sync();
  const original = await readFile(join(s.root, 'providers.json'), 'utf8');
  const first = Array.from({ length: 100 }, (_, i) => item(i));
  for (const second of [null, envelope([item(0)], 2, 101), envelope([item(100)], 2, 102), { ...envelope([item(100)], 2, 101), data: { ...envelope([item(100)], 2, 101).data, snapshotComplete: false } }]) {
    s.set(url => { if (url.searchParams.get('page') === '1') return envelope(first, 1, 101); if (!second) throw new Error('fake offline'); return second; });
    await assert.rejects(s.sync.sync()); assert.equal(await readFile(join(s.root, 'providers.json'), 'utf8'), original); assert.equal(s.sync.busy, false);
  }
  s.account.fetcher = async () => Response.json({ reason: 'DESKTOP_TOKEN_INVALID', message: item(0).key }, { status: 401 });
  await assert.rejects(s.sync.sync(), e => e.code === 'DESKTOP_TOKEN_INVALID' && !e.message.includes('sk-')); assert.equal(await readFile(join(s.root, 'providers.json'), 'utf8'), original);
  await assert.rejects(reconcilePlatformProviders(s.root, { origin: 'https://www.777codes.codes', ownerId: 'usr_FAKE_A', items: [], snapshotComplete: false }, protect), { code: 'KEY_SYNC_INCOMPLETE' });
});

test('Key rotation requires explicit reselection, encryption failure is atomic, and isolation has no network', async t => {
  const s = await setup(t); s.set(envelope([item(1)])); await s.sync.sync(); const row = (await listProviders(s.root))[0]; await markProviderActive(s.root, row.id);
  s.set(envelope([item(1, { key: 'sk-FAKE-ROTATED-ONLY' })])); await s.sync.sync();
  const rotated = (await listProviders(s.root))[0]; assert.equal(rotated.active, true); assert.equal(rotated.platformSync.requiresActivation, true); assert.equal((await getProviderSecret(s.root, row.id, unprotect)).apiKey, 'sk-FAKE-ROTATED-ONLY');
  const original = await readFile(join(s.root, 'providers.json'), 'utf8');
  s.set(envelope([item(1), item(2)])); s.sync.protect = () => { throw new Error('storage unavailable'); }; await assert.rejects(s.sync.sync()); assert.equal(await readFile(join(s.root, 'providers.json'), 'utf8'), original);
  s.account.isolated = true; const callCount = s.calls.length; await assert.rejects(s.sync.sync(), { code: 'ISOLATED_PREVIEW' }); assert.equal(s.calls.length, callCount);
});

test('validation rejects credential echoes, unsafe URLs and malformed descriptors without rewriting unknown protocols', () => {
  for (const changes of [{ baseUrl: 'http://untrusted.example/v1' }, { baseUrl: 'https://u:p@example.com/v1' }, { baseUrl: 'https://example.com/?key=secret' }, { protocol: '../bad' }, { name: item(1).key }, { groupName: item(1).key }, { models: ['bad model'] }, { rateMultiplier: -1 }, { models: Array(101).fill('model') }]) assert.throws(() => normalizePlatformKey(item(1, changes)), { code: 'KEY_SYNC_RESPONSE_INVALID' });
  const future = normalizePlatformKey(item(1, { protocol: 'new-proto.2030', baseUrl: 'https://api.example.com/new/v5', models: [], defaultModel: '' })); assert.equal(future.protocol, 'new-proto.2030'); assert.equal(future.baseUrl, 'https://api.example.com/new/v5');
  assert.equal(normalizePlatformKey(item(1, { protocol: 'Vendor.Future:v3' })).protocol, 'Vendor.Future:v3');
  const quotedKey = 'sk-FAKE-"quoted\\Key'; assert.throws(() => normalizePlatformKey(item(1, { key: quotedKey, name: quotedKey })), { code: 'KEY_SYNC_RESPONSE_INVALID' });
});

test('account change during sync, oversized responses and concurrent sync never commit partial records', async t => {
  const s = await setup(t); s.set(envelope([item('seed')])); await s.sync.sync();
  const original = await readFile(join(s.root, 'providers.json'), 'utf8');
  s.set(() => { s.account.user = { id: 'usr_CHANGED' }; return envelope([item(1)]); });
  await assert.rejects(s.sync.sync(), { code: 'KEY_SYNC_ACCOUNT_CHANGED' });
  assert.equal(await readFile(join(s.root, 'providers.json'), 'utf8'), original);
  s.account.fetcher = async () => new Response('x'.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(s.sync.sync(), { code: 'PLATFORM_RESPONSE_INVALID' });
  assert.equal(await readFile(join(s.root, 'providers.json'), 'utf8'), original);
  let release; s.account.fetcher = () => new Promise(resolve => { release = resolve; });
  const pending = s.sync.sync();
  await assert.rejects(s.sync.sync(), { code: 'KEY_SYNC_BUSY' });
  release(Response.json(envelope([]))); await pending;
  assert.equal((await listProviders(s.root)).find(p => p.platformSync.ownerId === 'usr_FAKE_A').platformSync.disabled, false);
});

test('HTTP client-to-platform isolated joint test: real loopback transport, bearer scope, no Key in UI response or audit', async t => {
  const root = await mkdtemp(join(tmpdir(), '777-key-sync-http-'));
  const requests = [];
  const platform = http.createServer((req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(envelope([item('http')])));
  });
  await new Promise(resolve => platform.listen(0, '127.0.0.1', resolve));
  process.env.PORT = '0'; process.env.MANAGER777_ISOLATED = '1'; process.env.MANAGER777_ROOT = root; process.env.MANAGER777_CODEX_ROOT = join(root, 'codex'); process.env.MANAGER777_SKILL_ROOT = join(root, 'skills');
  const { server, ready, accountManager, configureRuntimeAdapters } = await import('../scripts/server.mjs'); const { url } = await ready;
  t.after(async () => { await Promise.all([new Promise(r => { server.close(r); server.closeAllConnections(); }), new Promise(r => { platform.close(r); platform.closeAllConnections(); })]); await rm(root, { recursive: true, force: true }); });
  configureRuntimeAdapters({ protect, unprotect });
  const page = await fetch(url + '/'); const cookie = page.headers.get('set-cookie').split(';')[0]; assert.match(await page.text(), /id="sync-platform-keys"/);
  const post = (headers = {}) => fetch(url + '/api/account/keys/sync', { method: 'POST', headers: { cookie, Origin: url, 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await post({ cookie: '' })).status, 403); assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await (await post()).json()).code, 'ISOLATED_PREVIEW'); assert.equal(requests.length, 0);
  // Test-only injected transport. Runtime remains isolated: no installer, registry or real account access.
  accountManager.isolated = false; accountManager.accessToken = 'dta_FAKE_HTTP_ONLY'; accountManager.accessExpiresAt = Date.now() + 900000; accountManager.user = { id: 'usr_FAKE_HTTP' };
  accountManager.fetcher = (target, options) => { const u = new URL(target); assert.equal(u.origin, 'https://www.777codes.codes'); assert.equal(u.pathname, '/api/v1/desktop/keys'); return fetch(`http://127.0.0.1:${platform.address().port}${u.pathname}${u.search}`, options); };
  const synced = await post(); assert.equal(synced.status, 200); assert.equal(synced.headers.get('cache-control'), 'no-store'); const responseText = await synced.text(); assert.equal(JSON.parse(responseText).added, 1); assert.ok(!responseText.includes(item('http').key));
  const rows = await (await fetch(url + '/api/providers', { headers: { cookie } })).json(); assert.equal(rows.providers[0].protocol, 'openai'); assert.equal(rows.providers[0].groupMultiplier, 0.33); assert.ok(!JSON.stringify(rows).includes(item('http').key));
  assert.deepEqual(requests, [{ path: '/api/v1/desktop/keys?page=1&pageSize=100', authorization: 'Bearer dta_FAKE_HTTP_ONLY' }]);
  const logs = await (await fetch(url + '/api/logs', { headers: { cookie } })).text(); assert.ok(!logs.includes(item('http').key)); assert.ok(!logs.includes('dta_FAKE_HTTP_ONLY'));
});
