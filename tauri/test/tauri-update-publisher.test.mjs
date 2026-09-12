import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join,posix,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {RELEASE,immutableUpdateUrl,updateManifestUrl} from '../scripts/release-info.mjs';
import {assertNoCaseCollisions,buildUpdate,isInsidePath,signaturePayload,validateBundle} from '../scripts/build-tauri-update.mjs';

test('current release enables only architecture-specific Tauri feeds',()=>{
 assert.ok(Number.isInteger(RELEASE.revision)&&RELEASE.revision>=RELEASE.minimumUpdateRevision);assert.equal(RELEASE.minimumUpdateRevision,102);
 assert.equal(updateManifestUrl('win32','x64'),'https://top777ai.com/downloads/777codex/tauri/public-beta/win32-x64/latest.json');
 assert.equal(immutableUpdateUrl('darwin','arm64','release.zip'),`https://top777ai.com/downloads/777codex/tauri/public-beta/darwin-arm64/releases/${RELEASE.version}-r${RELEASE.revision}/release.zip`);
 assert.throws(()=>updateManifestUrl('win32','arm64'));assert.throws(()=>immutableUpdateUrl('win32','x64','../bad.zip'));
});

test('Ed25519 signature binds every security-sensitive manifest field',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const manifest={schemaVersion:2,product:'777codex-tauri',channel:RELEASE.channel,platform:'win32',arch:'x64',version:RELEASE.version,revision:RELEASE.revision,minimumRevision:RELEASE.minimumUpdateRevision,publishedAt:'2026-09-12T00:00:00.000Z',notes:'test',package:{kind:'full-release-zip',url:immutableUpdateUrl('win32','x64','a.zip'),bytes:3,sha256:'a'.repeat(64),files:[{path:'777Codex.exe',bytes:3,sha256:'b'.repeat(64),mode:0o755}],signature:''}};
 manifest.package.signature=sign(null,signaturePayload(manifest),privateKey).toString('base64');
 const valid=value=>verify(null,signaturePayload(value),publicKey,Buffer.from(value.package.signature,'base64'));
 assert.ok(valid(manifest));
 for(const mutate of [m=>m.product='other',m=>m.channel='stable',m=>m.platform='darwin',m=>m.arch='arm64',m=>m.version='1.0.1',m=>m.revision++,m=>m.minimumRevision--,m=>m.package.kind='patch',m=>m.package.url+='x',m=>m.package.bytes++,m=>m.package.sha256='c'.repeat(64),m=>m.package.files[0].bytes++,m=>m.package.files[0].mode=0o644]){const copy=structuredClone(manifest);mutate(copy);assert.equal(valid(copy),false);}
});

test('containment uses correct POSIX and Windows path semantics',()=>{
 assert.equal(isInsidePath('/release/key','/release',posix),true);assert.equal(isInsidePath('/release2/key','/release',posix),false);assert.equal(isInsidePath('/key','/release',posix),false);
 assert.equal(isInsidePath('C:\\release\\key','C:\\release',win32),true);assert.equal(isInsidePath('C:\\release2\\key','C:\\release',win32),false);assert.equal(isInsidePath('D:\\key','C:\\release',win32),false);
});

test('bundle validation requires full layouts and rejects links and case collisions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'777-update-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['backend','helpers','runtime'])await mkdir(join(root,dir));
 await writeFile(join(root,'777Codex.exe'),'app');await writeFile(join(root,'backend','server.mjs'),'server');await writeFile(join(root,'helpers','helper.exe'),'helper');await writeFile(join(root,'runtime','node.exe'),'node');
 const files=await validateBundle(root,'win32');assert.ok(files.every(x=>x.bytes>0&&/^[a-f0-9]{64}$/.test(x.sha256)&&Number.isInteger(x.mode)&&x.mode>=0&&x.mode<=0o777));
 await mkdir(join(root,'backend','js'));await writeFile(join(root,'backend','js','update-public.pem'),'-----BEGIN PUBLIC KEY-----\nSYNTHETIC\n-----END PUBLIC KEY-----\n');await validateBundle(root,'win32');
 await writeFile(join(root,'backend','js','extra.pem'),'public');await assert.rejects(validateBundle(root,'win32'),/Sensitive path/);await rm(join(root,'backend','js','extra.pem'));
 const syntheticPrivateMarker='-----BEGIN PRIVATE'+' KEY-----\nSYNTHETIC\n-----END PRIVATE'+' KEY-----\n';
 await writeFile(join(root,'backend','js','update-public.pem'),syntheticPrivateMarker);await assert.rejects(validateBundle(root,'win32'),/Private key content/);
 await writeFile(join(root,'signing-key'),'synthetic');
 await assert.rejects(buildUpdate({bundle:root,output:join(root,'out'),platform:'win32',arch:'x64',privateKey:join(root,'signing-key')}),/outside the release bundle/);
 assert.throws(()=>assertNoCaseCollisions(['backend/server.mjs','BACKEND/SERVER.MJS']),/Case-colliding/);
});
