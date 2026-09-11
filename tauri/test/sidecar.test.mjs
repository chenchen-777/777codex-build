import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
test('sidecar uses a random local port, preserves sessions and refuses real installation in isolation',async t=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../backend/scripts/sidecar.mjs',import.meta.url))],{env:{...process.env,MANAGER777_ISOLATED:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
 t.after(()=>child.kill());
 const lines=createInterface({input:child.stdout});
 const receive=predicate=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{lines.off('line',onLine);reject(new Error('sidecar timeout'));},10000);
  function onLine(raw){try{const result=JSON.parse(raw);if(predicate(result)){clearTimeout(timer);lines.off('line',onLine);resolve(result);}}catch{}}
  lines.on('line',onLine);
 });
 const ready=await receive(r=>r.kind==='ready');
 assert.equal(ready.isolated,true);assert.match(ready.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 const page=await fetch(ready.url);const cookie=page.headers.get('set-cookie').split(';')[0];
 assert.match(await page.text(),/tool-ui\.css/);
 const css=await fetch(ready.url+'/tool-ui.css');assert.equal(css.status,200);assert.match(await css.text(),/\.bottom-nav/);
 assert.equal((await fetch(ready.url+'/api/providers')).status,403);
 assert.equal((await fetch(ready.url+'/api/providers',{headers:{cookie}})).status,200);
 const blocked=await fetch(ready.url+'/api/codex/install',{method:'POST',headers:{cookie,origin:ready.url,'Content-Type':'application/json'},body:'{}'});
 assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'ISOLATED_PREVIEW');
 const reply=receive(r=>r.id===9);child.stdin.write(JSON.stringify({id:9,op:'busy'})+'\n');assert.equal((await reply).busy,false);
 child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));
});
test('Tauri window is transparent, rounded and exposes no filesystem/process IPC to the renderer',async()=>{
 const main=await readFile(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 const config=JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
 assert.match(main,/decorations\(false\)\.transparent\(true\)/);
 assert.match(main,/window\.url\(\).*state\.url/);
 assert.deepEqual(config.app.security.capabilities[0].permissions,['allow-window-action']);
 const native=await readFile(new URL('../src-tauri/src/native.rs',import.meta.url),'utf8');
 assert.match(native,/CryptProtectData/);assert.match(native,/CRYPTPROTECT_UI_FORBIDDEN/);
});
test('native helper encrypts synthetic secrets, rejects old ciphertext and does not expose secrets as arguments',{skip:process.platform!=='win32'||!existsSync(new URL('../src-tauri/target/release/777-native.exe',import.meta.url))},()=>{
 const executable=fileURLToPath(new URL('../src-tauri/target/release/777-native.exe',import.meta.url));
 const call=(op,value)=>{const result=spawnSync(executable,[],{input:JSON.stringify({op,value}),encoding:'utf8',windowsHide:true});assert.equal(result.status,0);return JSON.parse(result.stdout);};
 const sample='synthetic-test-only-not-a-real-key';const protectedValue=call('protect',sample);assert.equal(protectedValue.ok,true);assert.ok(!protectedValue.value.includes(sample));
 assert.equal(call('unprotect',protectedValue.value).value,sample);
 assert.equal(call('unprotect','electron-old-ciphertext').ok,false);
 assert.equal(call('openUrl','file:///C:/Windows').ok,false);
});
