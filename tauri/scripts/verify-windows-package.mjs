import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]);
const manifest=JSON.parse(await readFile(join(root,'build-manifest.json'),'utf8'));
assert.equal(manifest.version,'1.0.0');assert.equal(manifest.defaultMode,'live');
for(const entry of manifest.files){
 assert.ok(!entry.path.split('/').includes('..'));
 const bytes=await readFile(join(root,entry.path));
 assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path);
 assert.doesNotMatch(entry.path,/(?:^|\/)(?:\.dev|\.window-data|providers\.json|auth\.json)(?:\/|$)/);
}
const state=await mkdtemp(join(tmpdir(),'777-public-beta-smoke-'));
const native=join(root,'helpers','777-native.exe');
const invoke=(op,value)=>{const r=spawnSync(native,[],{input:JSON.stringify({op,value}),encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0);return JSON.parse(r.stdout);};
const encrypted=invoke('protect','synthetic-public-beta-only');assert.equal(encrypted.ok,true);
assert.equal(invoke('unprotect',encrypted.value).value,'synthetic-public-beta-only');
assert.equal(invoke('openUrl','file:///C:/Windows').ok,false);
const child=spawn(join(root,'runtime','node.exe'),[join(root,'backend','scripts','sidecar.mjs')],{cwd:root,windowsHide:true,env:{...process.env,MANAGER777_ISOLATED:'1',MANAGER777_STATE_ROOT:state,MANAGER777_NATIVE:native,MANAGER777_CODEXPP:join(root,'helpers','777-codexpp.exe')},stdio:['pipe','pipe','pipe']});
let stderr='';child.stderr.on('data',b=>stderr+=b.toString().slice(0,1000));
try{
 const ready=await new Promise((res,rej)=>{
  const timer=setTimeout(()=>rej(Error('Packaged backend timed out')),25000);
  child.once('error',rej);child.once('exit',()=>{clearTimeout(timer);rej(Error('Backend exited'));});
  createInterface({input:child.stdout}).on('line',line=>{try{const v=JSON.parse(line);if(v.kind==='ready'){clearTimeout(timer);res(v);}}catch{}});
 });
 assert.equal(ready.isolated,true);assert.match(ready.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 const page=await fetch(ready.url),cookie=page.headers.get('set-cookie').split(';')[0];
 assert.match(await page.text(),/公测版 1\.0/);
 const get=async path=>{const r=await fetch(ready.url+path,{headers:{cookie}});assert.equal(r.status,200);return r.json();};
 assert.equal((await get('/api/health')).version,'1.0.0');
 const core=await get('/api/enhancements/codexpp');assert.equal(core.available,true,core.error);assert.equal(core.features.length,15);
 const login=await fetch(ready.url+'/api/account/login/start',{method:'POST',headers:{cookie,origin:ready.url,'Content-Type':'application/json'},body:'{}'});
 assert.equal(login.status,403);assert.equal((await login.json()).code,'ISOLATED_PREVIEW');
 const report={ok:true,version:'1.0.0',filesVerified:manifest.files.length,defaultMode:'live',testedMode:'isolated',dpapiSynthetic:true,packagedCoreAvailable:true,featureSwitches:15,realAccountTest:false,liveUiOnThisComputer:false};
 await writeFile(process.argv[3],JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{child.kill();}
