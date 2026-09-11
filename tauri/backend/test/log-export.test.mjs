import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createWindowsApi} from '../../backend/scripts/windows-api.mjs';

test('POST log export writes only audit.list data under the fixed reports directory',async t=>{
 const managerRoot=await mkdtemp(join(tmpdir(),'log-export-'));t.after(()=>rm(managerRoot,{recursive:true,force:true}));
 const entries=[{time:'2026-09-11T00:00:00.000Z',action:'safe',outcome:'success'}];let listed;
 const audit={list:async options=>(listed=options,{entries})};let response;
 const api=createWindowsApi({projectRoot:managerRoot,codexRoot:managerRoot,managerRoot,isolated:false,audit,readBody:async()=>({path:'C:\\untrusted'}),sendJson:(_res,status,body)=>{response={status,body}},requireTrusted:()=>{},accountManager:{},adapters:()=>({openPath:async()=>''})});
 assert.equal(await api({method:'POST',url:'/api/logs/export'},{},'/api/logs/export'),true);assert.equal(response.status,201);assert.deepEqual(listed,{limit:1000});assert.equal(dirname(response.body.path),join(managerRoot,'reports'));assert.match(response.body.path,/operations-\d+-[0-9a-f-]+\.jsonl$/);assert.equal(await readFile(response.body.path,'utf8'),JSON.stringify(entries[0])+'\n');assert.doesNotMatch(await readFile(response.body.path,'utf8'),/untrusted/);
});

test('opening exported logs uses the fixed reports folder and never a client path',async t=>{
 const managerRoot=await mkdtemp(join(tmpdir(),'log-open-'));t.after(()=>rm(managerRoot,{recursive:true,force:true}));let opened;
 const api=createWindowsApi({projectRoot:managerRoot,codexRoot:managerRoot,managerRoot,isolated:false,audit:{list:async()=>({entries:[]})},readBody:async()=>({path:'C:\\untrusted'}),sendJson:()=>{},requireTrusted:()=>{},accountManager:{},adapters:()=>({openPath:async path=>(opened=path,'')})});
 await api({method:'POST',url:'/api/logs/export/open'},{},'/api/logs/export/open');assert.equal(opened,join(managerRoot,'reports'));
});

test('log export UI uses POST, renders the full returned path, and opens only on a separate click',async()=>{
 const source=await readFile(new URL('../log-export.js',import.meta.url),'utf8');assert.match(source,/method: "POST"/);assert.match(source,/exported\.path/);assert.match(source,/\/api\/logs\/export\/open/);assert.doesNotMatch(source,/download\s*=/);
});
