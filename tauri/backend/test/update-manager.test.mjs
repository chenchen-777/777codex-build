import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateManager } from '../js/update-manager.mjs';
import { manifestSignaturePayload, sha256Buffer } from '../js/update-core.mjs';

async function fixture({ isolated = false,platform='win32',arch='x64' } = {}) {
  const root = await mkdtemp(join(tmpdir(), '777-update-test-'));
  const managerRoot = join(root, 'manager'); const installRoot = join(root, 'install');
  await mkdir(installRoot, { recursive: true });
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPath = join(root, 'public.pem'); const helperSource = join(root, 'helper.ps1');
  await writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' })); await writeFile(helperSource, '# helper');
  const archive = Buffer.from('verified update package');
  const manifest = {
    schemaVersion: 2, product: '777codex-tauri', channel: 'public-beta', platform,arch,version: '1.0.0', revision: 103, minimumRevision: 102,
    publishedAt: '2026-09-06T12:00:00.000Z', notes: 'test', package: {
      kind: 'full-release-zip', url: `https://top777ai.com/downloads/777codex/tauri/public-beta/${platform}-${arch}/releases/r103/update.zip`,
      bytes: archive.length, sha256: sha256Buffer(archive),files:[{path:'777Codex.exe',bytes:archive.length,sha256:sha256Buffer(archive),mode:0o755}], signature: '',
    },
  };
  manifest.package.signature = sign(null, manifestSignaturePayload(manifest), keys.privateKey).toString('base64');
  const fetcher = async url => new Response(url.endsWith('latest.json') ? JSON.stringify(manifest) : archive, { status: 200 });
  let scheduled = null;
  const manager = new UpdateManager({
    build: { product: '777codex-tauri', version: '1.0.0', revision: 102, revisionLabel: 'r102', channel: 'public-beta', updateManifestUrl: 'https://top777ai.com/downloads/777codex/tauri/public-beta/win32-x64/latest.json' },
    managerRoot, installRoot, executable: join(installRoot, '777Codex.exe'), publicKeyPath, helperSource, isolated, fetcher,
    scheduleInstall: async plan => { scheduled = plan; return { scheduled: true }; },platform,arch,outerPid:123,
  });
  return { manager, archive, managerRoot, scheduled: () => scheduled };
}

test('checks, downloads, verifies and schedules an update', async () => {
  const item = await fixture();
  const check = await item.manager.check();
  assert.equal(check.status, 'available'); assert.equal(check.installable, true);
  await item.manager.download();
  const installed = await item.manager.install();
  assert.equal(installed.restarting, true);
  assert.equal(item.scheduled().targetRevision, 103);
  assert.equal(await readFile(item.scheduled().archivePath, 'utf8'), item.archive.toString());
});

test('persists auto-check preference', async () => {
  const { manager } = await fixture();
  await manager.saveSettings({ autoCheck: false });
  assert.equal((await manager.status()).settings.autoCheck, false);
});

test('isolated preview refuses installation even after a verified download', async () => {
  const { manager } = await fixture({ isolated: true });
  await manager.check(); await manager.download();
  await assert.rejects(() => manager.install(), error => error.code === 'ISOLATED_PREVIEW');
});

test('rejects a correctly signed manifest for another architecture before download', async () => {
  const item=await fixture();
  item.manager.arch='arm64';
  await assert.rejects(()=>item.manager.check(),error=>error.code==='UPDATE_MANIFEST_MISMATCH');
});

test('serializes update downloads', async () => {
  const item=await fixture();await item.manager.check();
  let release;item.manager.fetcher=async()=>new Promise(resolve=>{release=()=>resolve(new Response(item.archive,{status:200}));});
  const first=item.manager.download();
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  await assert.rejects(()=>item.manager.download(),error=>error.code==='UPDATE_BUSY');
  release();await first;
});

test('Mac checks the matching channel but fails closed to manual download until native transaction validation',async()=>{
  const item=await fixture({platform:'darwin',arch:'arm64'});
  const result=await item.manager.check();assert.equal(result.available,true);assert.equal(result.installable,false);assert.equal(result.status,'manual-required');
});
