import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import TOML from '@iarna/toml';
import {apply777Configuration,applyOfficialConnection,rollback777Configuration} from '../js/config-store.mjs';
import {officialConfig,assertOfficialEnvironment} from '../js/official-connection.mjs';

test('official connection drops overrides; unrelated tools stay intact',()=>{
 const c=TOML.parse(officialConfig('model_provider="custom"\nprofile="old"\nmodel="old"\n[model_providers.openai]\nbase_url="https://example.invalid"\n[mcp_servers.demo]\ncommand="demo"\n'));
 assert.equal(c.model_provider,'openai');assert.equal(c.profile,undefined);
 assert.equal(c.model_providers.openai,undefined);assert.equal(c.mcp_servers.demo.command,'demo');
 assert.equal(c.forced_login_method,'chatgpt');
 assert.throws(()=>assertOfficialEnvironment({OPENAI_API_KEY:'secret'}),/OPENAI_API_KEY/);
});
test('777 -> official -> 777 and restore preserve independent credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'777-connection-'));
 try{
  await apply777Configuration({codexRoot:root,apiKey:'test-key-777',options:{model:'test-model'}});
  const oldConfig=await readFile(join(root,'config.toml'),'utf8');
  const official=await applyOfficialConnection(root);
  assert.deepEqual(JSON.parse(await readFile(join(root,'auth.json'),'utf8')),{});
  assert.equal(TOML.parse(await readFile(join(root,'config.toml'),'utf8')).model_provider,'openai');
  await rollback777Configuration({codexRoot:root,backupId:official.backupId});
  assert.equal(await readFile(join(root,'config.toml'),'utf8'),oldConfig);
  await applyOfficialConnection(root);
  await apply777Configuration({codexRoot:root,apiKey:'test-key-777',options:{model:'chosen-model'}});
  const c=TOML.parse(await readFile(join(root,'config.toml'),'utf8'));
  assert.equal(c.model_provider,'777codes');assert.equal(c.forced_login_method,undefined);
  assert.equal(c.model,'chosen-model');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('invalid config does not clear credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'777-invalid-'));
 try{await writeFile(join(root,'config.toml'),'[broken');await writeFile(join(root,'auth.json'),'keep');
 await assert.rejects(applyOfficialConnection(root));assert.equal(await readFile(join(root,'auth.json'),'utf8'),'keep');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('active key launch reapplies before launch and restarts running client',async()=>{
 const source=await readFile(new URL('../ui.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  async function activateProvider'),source.indexOf('  async function removeProvider'));
 for(const running of [true,false]){
  const calls=[];const ctx={window:{manager777:{confirm:async()=>true}},api:async(path)=>{calls.push(path);return path==='/api/codex/status'?{running}:{ok:true,applied:{model:'test'}};},runButton:async(b,t,f)=>f(),refreshProviders:async()=>{},refreshLocalState:async()=>{},showToast:()=>{},activeTextProvider:()=>({id:'same'})};
  vm.createContext(ctx);vm.runInContext(fn+'\nthis.activate=activateProvider',ctx);
  assert.equal(await ctx.activate('same',{},true),true);
  assert.deepEqual(calls,['/api/codex/status','/api/providers/activate',running?'/api/codex/restart':'/api/codex/launch']);
 }
});
test('new navigation and reconnect controls are wired',async()=>{
 const ui=await readFile(new URL('../ui.js',import.meta.url),'utf8'),shell=await readFile(new URL('../tool-ui.js',import.meta.url),'utf8'),html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(ui,/item.active \? '重新连接'/);assert.doesNotMatch(ui,/\(item.active && !item.platformSync/);
 assert.match(shell,/openLegacy\(link.dataset.pageLink\)/);assert.match(html,/使用 OpenAI 官方/);assert.doesNotMatch(html,/查看快照记录/);
});
