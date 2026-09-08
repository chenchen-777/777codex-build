import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProviderGroup } from '../js/provider-group.mjs';
import { CCSLinkImport, parseCCSImportLink } from '../js/ccs-link-import.mjs';
import { listProviders, upsertProvider, markProviderActive, updateObservedModel } from '../js/provider-store.mjs';
const base = { resource: 'provider', app: 'codex', name: 'Fake group test', homepage: 'https://www.777codes.codes', endpoint: 'https://www.777codes.codes', apiKey: 'sk-FAKE-group-only-test', configFormat: 'json', model: 'gpt-5.5' };
const link = (extra = {}) => 'codes777://v1/import?' + new URLSearchParams({ ...base, ...extra });
test('optional group fields accept Unicode/zero/decimals; reject invalid and duplicate values', () => {
  assert.deepEqual(normalizeProviderGroup({}), {});
  assert.equal(parseCCSImportLink(link()).groupName, undefined);
  for (const value of ['0', '0.22', '1', '0.0000001', '123.456']) {
    const p = parseCCSImportLink(link({ groupName: ' Codex 优惠 ', groupMultiplier: value }));
    assert.equal(p.groupName, 'Codex 优惠'); assert.equal(p.groupMultiplier, Number(value));
  }
  for (const value of ['', 'NaN', 'Infinity', '-1', '0.22×', '1e-7', '01', ' ', '9'.repeat(65)]) assert.throws(() => parseCCSImportLink(link({ groupMultiplier: value })), { code: 'INVALID_PROVIDER_GROUP' });
  for (const value of ['', ' ', '名'.repeat(121), 'bad\nname', 'bad\u0085name']) assert.throws(() => parseCCSImportLink(link({ groupName: value })));
  assert.throws(() => parseCCSImportLink(link({ groupName: 'a' }) + '&groupName=b'));
  for (const value of [true, {}, [], NaN, Infinity, -1]) assert.throws(() => normalizeProviderGroup({ groupMultiplier: value }));
});
test('group snapshot survives save/reload/model edit, updates without duplicates, old imports do not erase it', async t => {
  const root = await mkdtemp(join(tmpdir(), '777-group-')); t.after(() => rm(root, { recursive: true, force: true }));
  const adapters = () => ({ protect: () => 'TEST-ENCRYPTED-ONLY' });
  const client = new CCSLinkImport({ managerRoot: root, adapters });
  const preview = client.offer(link({ groupName: 'Codex 优惠', groupMultiplier: '0.22' }));
  assert.equal(preview.profile.groupName, 'Codex 优惠'); assert.equal(preview.profile.groupMultiplier, 0.22);
  const saved = await client.save({ confirm: 'IMPORT_PROVIDER' }); const id = saved.provider.id;
  await markProviderActive(root, id);
  const before = (await listProviders(root))[0];
  await upsertProvider(root, { ...before, groupName: undefined, groupMultiplier: undefined }, adapters().protect);
  await updateObservedModel(root, id, { model: 'gpt-5.6-sol', reasoningEffort: 'medium', time: Date.now() + 1000 });
  const observed = (await listProviders(root))[0];
  assert.equal(observed.groupName, 'Codex 优惠'); assert.equal(observed.groupMultiplier, 0.22);
  client.offer(link({ groupName: 'Codex 免费测试', groupMultiplier: '0' }));
  await assert.rejects(client.save({ confirm: 'IMPORT_PROVIDER' }), { code: 'IMPORT_DUPLICATE' });
  const changed = await client.save({ confirm: 'IMPORT_PROVIDER', replace: true });
  assert.equal(changed.provider.id, id); assert.equal(changed.provider.active, true);
  assert.equal(changed.provider.groupMultiplier, 0); assert.equal(changed.provider.groupName, 'Codex 免费测试');
  client.offer(link()); assert.equal((await client.save({ confirm: 'IMPORT_PROVIDER' })).duplicate, true);
  const persisted = (await listProviders(root))[0];
  assert.equal(persisted.groupMultiplier, 0); assert.equal(persisted.groupName, 'Codex 免费测试');
  assert.equal((await listProviders(root)).length, 1); assert.ok((await readdir(join(root, 'provider-backups'))).length >= 2);
  assert.equal((await readFile(join(root, 'providers.json'), 'utf8')).includes(base.apiKey), false);
  const cleared = await upsertProvider(root, { ...persisted, groupName: null, groupMultiplier: null }, adapters().protect);
  assert.equal(cleared.groupName, undefined); assert.equal(cleared.groupMultiplier, undefined);
});
