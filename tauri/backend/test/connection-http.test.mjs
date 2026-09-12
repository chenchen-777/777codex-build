import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('official connection requires session and confirmation; isolated mode never launches',async t=>{
 const root=await mkdtemp(join(tmpdir(),'777-connection-http-'));
 process.env.PORT='0';process.env.MANAGER777_ROOT=join(root,'manager');process.env.MANAGER777_CODEX_ROOT=join(root,'codex');process.env.MANAGER777_SKILL_ROOT=join(root,'skills');
 // Test process only; never modify the user's persistent environment.
 delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_BASE_URL;delete process.env.CODEX_API_KEY;
 await mkdir(process.env.MANAGER777_ROOT);
 const {server,ready}=await import('../scripts/server.mjs');const {url}=await ready;
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(root,{recursive:true,force:true});});
 let cookie='';
 const call=async(path,body)=>fetch(url+path,{method:'POST',headers:{cookie,Origin:url,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await call('/api/connection/official',{confirm:'USE_OFFICIAL'})).status,403);
 cookie=(await fetch(url+'/')).headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/connection/official',{})).status,400);
 assert.equal((await call('/api/connection/official',{confirm:'USE_OFFICIAL'})).status,200);
 assert.deepEqual(JSON.parse(await readFile(join(root,'codex/auth.json'),'utf8')),{});
 assert.equal((await call('/api/connection/official-launch',{})).status,409);
});
