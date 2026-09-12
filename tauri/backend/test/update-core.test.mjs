import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { compareBuild, manifestSignaturePayload, validateUpdateManifest } from '../js/update-core.mjs';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
function signed(overrides = {}) {
  const manifest = {
    schemaVersion: 2, product: '777codex-tauri', channel: 'public-beta', platform:'win32',arch:'x64',
    version: '1.0.0', revision: 103, minimumRevision: 102,
    publishedAt: '2026-09-06T12:00:00.000Z', notes: '候选更新',
    package: {
      kind: 'full-release-zip',
      url: 'https://top777ai.com/downloads/777codex/tauri/public-beta/win32-x64/releases/1.0.0-r103/Windows.zip',
      bytes: 1234, sha256: 'a'.repeat(64),files:[{path:'777Codex.exe',bytes:1234,sha256:'b'.repeat(64),mode:0o755}], signature: '',
    },
    ...overrides,
  };
  manifest.package.signature = sign(null, manifestSignaturePayload(manifest), keys.privateKey).toString('base64');
  return manifest;
}

test('accepts a correctly signed manifest on the pinned host and channel', () => {
  const value = validateUpdateManifest(signed(), { product: '777codex-tauri', channel: 'public-beta',platform:'win32',arch:'x64', publicKey });
  assert.equal(value.revision, 103);
});

test('rejects a manifest changed after signing', () => {
  const value = signed(); value.package.bytes++;
  assert.throws(() => validateUpdateManifest(value, { product: '777codex-tauri', channel: 'public-beta',platform:'win32',arch:'x64', publicKey }), /签名验证失败/);
});

test('rejects downloads outside the pinned 777codes path', () => {
  const value = signed(); value.package.url = 'https://example.com/update.zip';
  value.package.signature = sign(null, manifestSignaturePayload(value), keys.privateKey).toString('base64');
  assert.throws(() => validateUpdateManifest(value, { product: '777codex-tauri', channel: 'public-beta',platform:'win32',arch:'x64', publicKey }), /可信下载范围/);
});

test('rejects a signed manifest for another architecture',()=>{
  assert.throws(()=>validateUpdateManifest(signed(),{product:'777codex-tauri',channel:'public-beta',platform:'win32',arch:'arm64',publicKey}),/当前系统或芯片/);
});

test('rejects unsafe and case-colliding signed inventory paths',()=>{
  for(const files of [
    [{path:'../777Codex.exe',bytes:1,sha256:'b'.repeat(64),mode:0o755}],
    [{path:'Backend/a.js',bytes:1,sha256:'b'.repeat(64),mode:0o644},{path:'backend/A.js',bytes:1,sha256:'c'.repeat(64),mode:0o644}],
  ]){const value=signed({package:{...signed().package,files,signature:''}});value.package.signature=sign(null,manifestSignaturePayload(value),keys.privateKey).toString('base64');assert.throws(()=>validateUpdateManifest(value,{product:'777codex-tauri',channel:'public-beta',platform:'win32',arch:'x64',publicKey}),/路径/);}
});

test('compares semantic version before internal revision', () => {
  assert.ok(compareBuild({ version: '0.12.0', revision: 1 }, { version: '0.11.0', revision: 99 }) > 0);
  assert.ok(compareBuild({ version: '0.11.0', revision: 20 }, { version: '0.11.0', revision: 19 }) > 0);
});
