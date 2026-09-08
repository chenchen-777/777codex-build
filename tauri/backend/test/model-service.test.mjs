import test from 'node:test';
import assert from 'node:assert/strict';
import { modelEndpoint, syncModels, validateTextProfile, PLATFORM_ORIGIN } from '../js/model-service.mjs';
const profile = { apiKey: 'sk-fake-unit-test-only', baseUrl: PLATFORM_ORIGIN, type: 'text', model: 'test-model', protocol: 'responses', reasoningEffort: 'high' };
test('model endpoint handles v1 once and refuses credential URLs', () => {
  assert.equal(modelEndpoint(PLATFORM_ORIGIN), PLATFORM_ORIGIN + '/v1/models');
  assert.equal(modelEndpoint(PLATFORM_ORIGIN + '/v1/'), PLATFORM_ORIGIN + '/v1/models');
  assert.throws(() => modelEndpoint('https://user:secret@example.com'), /HTTPS/);
});
test('model sync normalizes only valid unique IDs without disclosing Key', async () => {
  const result = await syncModels(profile, async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer ' + profile.apiKey);
    return Response.json({ data: [{ id: 'B' }, { id: 'A' }, { id: 'A' }, { id: 123 }, { id: 'bad\n' }] });
  });
  assert.deepEqual(result.models, ['A', 'B']); assert.ok(!JSON.stringify(result).includes(profile.apiKey));
});
test('502 is preserved and never mislabeled 401; raw upstream secrets are not emitted', async () => {
  await assert.rejects(syncModels(profile, async () => new Response(profile.apiKey, { status: 502 })), e => e.status === 502 && e.code === 'MODEL_HTTP_502' && !e.message.includes(profile.apiKey));
});
test('empty model list and unavailable model cannot silently fall back to default', async () => {
  assert.deepEqual((await syncModels(profile, async () => Response.json({ data: [] }))).models, []);
  assert.throws(() => validateTextProfile({ ...profile, model: '' }, ['test-model']), e => e.code === 'MODEL_REQUIRED');
  assert.throws(() => validateTextProfile(profile, ['different-model']), e => e.code === 'MODEL_NOT_LISTED');
  assert.throws(() => validateTextProfile({ ...profile, reasoningEffort: '' }, ['test-model']), e => e.code === 'REASONING_REQUIRED');
});
