import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ShareReleaseSource,SHARE_RELEASES,allowedReleaseURL,downloadError} from '../js/share-release-source.mjs';
const data=Buffer.from('verified release fixture'),sha256=createHash('sha256').update(data).digest('hex');
const release={...SHARE_RELEASES[0],sizeBytes:data.length,sha256};
test('catalog exposes only three reviewed environments and fails closed on changed official digest',async()=>{
 const s=new ShareReleaseSource({fetchImpl:async()=>new Response(SHARE_RELEASES.map(r=>r.sha256+' '+r.sizeBytes).join('\n'))});
 assert.deepEqual((await s.catalog()).map(r=>[r.id,r.available]),SHARE_RELEASES.map(r=>[r.id,true]));
 await assert.rejects(s.release('arbitrary-url'),e=>e.code==='SHARE_PLATFORM_REQUIRED');
 s.fetchImpl=async()=>new Response('new version');assert.ok((await s.catalog()).every(r=>!r.available));
});
test('downloads verified bytes once, revalidates cache, reports progress without credentials',async t=>{
 const root=await mkdtemp(join(tmpdir(),'share-fetch-'));t.after(()=>rm(root,{recursive:true,force:true}));let requests=0;const progress=[];
 const s=new ShareReleaseSource({cacheRoot:root,fetchImpl:async(u,opts)=>{requests++;assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.headers.Accept,'application/octet-stream');assert.match(u,/^https:\/\/api.github.com\/repos\/chenchen-777\/777codex-build\/releases\/assets\/552852109\?download=1$/);return new Response(data);}});
 const path=await s.acquire(release,(...p)=>progress.push(p));assert.deepEqual(await readFile(path),data);assert.equal(await s.acquire(release),path);assert.equal(requests,1);assert.ok(progress.some(p=>p[2].downloadedBytes===data.length));
});
test('wrong size or hash and cancelled downloads publish no cache or partial files',async t=>{
 for(const mode of ['size','hash','cancel']){const root=await mkdtemp(join(tmpdir(),'share-bad-'));t.after(()=>rm(root,{recursive:true,force:true}));let cancel=false;
 const s=new ShareReleaseSource({cacheRoot:root,fetchImpl:async()=>{if(mode==='cancel')cancel=true;return new Response(mode==='size'?'x':Buffer.alloc(data.length,1));}});
 await assert.rejects(s.acquire(release,()=>{},()=>cancel));assert.deepEqual(await readdir(root),[]);}
});
test('redirects cannot reach local servers, another release repository, or send credentials',()=>{
 for(const u of ['http://127.0.0.1/file','https://github.com/evil/release.zip','https://user:secret@release-assets.githubusercontent.com/a','https://release-assets.githubusercontent.com.evil.test/a'])assert.throws(()=>allowedReleaseURL(u));
 assert.equal(allowedReleaseURL('https://release-assets.githubusercontent.com/file?x=1'),'https://release-assets.githubusercontent.com/file?x=1');
});
test('API asset allowlist rejects unreviewed asset ids and metadata is not accepted as a ZIP',async t=>{
 assert.throws(()=>allowedReleaseURL('https://api.github.com/repos/chenchen-777/777codex-build/releases/assets/1?download=1'));
 const root=await mkdtemp(join(tmpdir(),'share-metadata-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const s=new ShareReleaseSource({cacheRoot:root,fetchImpl:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})});
 await assert.rejects(s.acquire(release),e=>e.code==='SHARE_DOWNLOAD_METADATA');assert.deepEqual(await readdir(root),[]);
});
test('connection reset, timeout, DNS, TLS and disk errors are distinct and redact raw details',()=>{
 for(const [code,expected] of [['ECONNRESET','SHARE_NETWORK_RESET'],['UND_ERR_CONNECT_TIMEOUT','SHARE_NETWORK_TIMEOUT'],['EAI_AGAIN','SHARE_NETWORK_DNS'],['CERT_HAS_EXPIRED','SHARE_TLS_ERROR'],['ENOSPC','SHARE_DISK_FULL'],['EACCES','SHARE_WRITE_DENIED']]){const e=downloadError({cause:{code},message:'secret-private-path'});assert.equal(e.code,expected);assert.ok(!e.message.includes('secret'));}
});
