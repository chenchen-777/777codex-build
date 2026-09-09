import test from 'node:test';
import assert from 'node:assert/strict';
import { modelEndpoint, syncModels, syncUsage, providerFailure, validateTextProfile, PLATFORM_ORIGIN } from '../js/model-service.mjs';
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

test('known balance errors are actionable and raw error bodies are never echoed', async () => {
  for (const status of [402,403,429]) {
    await assert.rejects(syncModels(profile, async () => Response.json({error:{code:'INSUFFICIENT_BALANCE',message:profile.apiKey}}, {status})), e => e.code === 'INSUFFICIENT_BALANCE' && /余额/.test(e.message) && !e.message.includes(profile.apiKey));
  }
  assert.match(providerFailure(403, {error:{message:'insufficient balance'}}, '模型同步').message, /余额/);
  assert.doesNotMatch(providerFailure(403, {}, '模型同步').message, /余额/);
  assert.match(providerFailure(429, {}, '模型同步').message, /频繁/);
  assert.match(providerFailure(502, {code:'insufficient_balance'}, '模型同步').message, /上游/);
});

test('balance refresh is independent from model validation and zero is a valid result', async () => {
  let calls=0;
  const result=await syncUsage(profile, async (url, options) => {
    calls++;assert.equal(url,PLATFORM_ORIGIN+'/v1/usage');assert.equal(options.redirect,'error');
    return Response.json({balance:0});
  });
  assert.equal(calls,1);assert.equal(result.usage.remaining,0);
  await assert.rejects(syncUsage(profile,async()=>Response.json({}, {status:404})), /余额刷新失败.*未提供/);
  await assert.rejects(syncUsage(profile,async()=>Response.json({})), /未返回余额/);
  await assert.rejects(syncUsage(profile,async()=>{throw Error(profile.apiKey);}), e=>/网络/.test(e.message)&&!e.message.includes(profile.apiKey));
});
