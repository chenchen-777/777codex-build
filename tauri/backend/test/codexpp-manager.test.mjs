import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexppManager,CODEXPP_VERSION,validateCodexppSettings} from '../js/codexpp-manager.mjs';
import {macUnavailableRoute} from '../js/macos-runtime.mjs';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'gcc-codexpp-test-')),home=join(dir,'codex'),root=join(dir,'manager');
 await mkdir(home);await writeFile(join(home,'config.toml'),'model = "test-model"\n# preserve this config\n');
 const manager=new CodexppManager({codexRoot:home,managerRoot:root,codexStatus:async()=>({installed:true,running:false,installDirectory:join(dir,'Fake.app')}),enginePath:process.env.MANAGER777_CODEXPP_TEST_ENGINE||join(dir,'missing-engine')});
 return {dir,home,root,manager};
}
test('settings allow only known boolean flags and never accept provider secrets',()=>{
 const result=validateCodexppSettings({codexAppPasteFix:true});assert.equal(result.codexAppPasteFix,true);assert.equal(result.codexAppSessionDelete,false);
 for(const value of [null,[],{relayApiKey:'not-a-real-key'},{codexAppPasteFix:'true'},{codexExtraArgs:['arbitrary']}])assert.throws(()=>validateCodexppSettings(value));
});
test('Mac allows only implemented enhancement actions, not legacy Windows installers',()=>{
 for(const route of ['settings','repair','launch'])assert.equal(macUnavailableRoute('/api/enhancements/codexpp/'+route),false);
 assert.equal(macUnavailableRoute('/api/enhancements/codex-zh/install'),true);assert.equal(macUnavailableRoute('/api/enhancements/codexpp/unknown'),true);
});
test('missing core is not reported as healthy and settings persist across restarts',async()=>{
 const {manager}=await fixture();const initial=await manager.status();assert.equal(initial.available,Boolean(process.env.MANAGER777_CODEXPP_TEST_ENGINE));assert.equal(initial.version,CODEXPP_VERSION);
 await manager.save({codexAppPasteFix:true});assert.equal((await manager.settings()).codexAppPasteFix,true);
 manager.worker={};await assert.rejects(manager.save({}),/关闭/);manager.worker=null;
});
test('repair refuses to modify files while Codex is running',async()=>{
 const {manager,home}=await fixture();manager.codexStatus=async()=>({running:true});manager.call=()=>assert.fail('core must not execute');
 await assert.rejects(manager.repair(),/关闭/);assert.equal(await readFile(join(home,'config.toml'),'utf8'),'model = "test-model"\n# preserve this config\n');
});
function mockCore(manager,{failRegistration=false,changeConfig=false}={}){
 manager.call=async p=>{
  if(p.action==='repair'){await mkdir(join(p.codexRoot,'.tmp','plugins-remote'),{recursive:true});await writeFile(join(p.codexRoot,'.tmp','plugins-remote','new.txt'),'new');if(changeConfig)await writeFile(join(manager.home,'config.toml'),'changed externally');return {ok:true};}
  if(p.action==='register'){await writeFile(join(manager.home,'config.toml'),'registered config');if(failRegistration)throw Error('synthetic failure');return {ok:true};}
  throw Error('unexpected action');
 };
}
test('plugin repair preserves old directory and records recovery without deleting user data',async()=>{
 const {manager,home}=await fixture();await mkdir(join(home,'.tmp','plugins-remote'),{recursive:true});await writeFile(join(home,'.tmp','plugins-remote','old.txt'),'user-plugin');mockCore(manager);
 const result=await manager.repair();const backup=join(home,'.tmp','gcc-codexpp-recoveries',result.recoveryId);
 assert.equal(await readFile(join(backup,'plugins.before','old.txt'),'utf8'),'user-plugin');assert.match(await readFile(join(backup,'config.before.toml'),'utf8'),/test-model/);
 assert.equal((await manager.recoveries()).recoveries[0].phase,'complete');
});
test('failed registration restores both configuration and old plugins',async()=>{
 const {manager,home}=await fixture();await mkdir(join(home,'.tmp','plugins-remote'),{recursive:true});await writeFile(join(home,'.tmp','plugins-remote','old.txt'),'old');mockCore(manager,{failRegistration:true});
 await assert.rejects(manager.repair(),/synthetic failure/);
 assert.match(await readFile(join(home,'config.toml'),'utf8'),/test-model/);assert.equal(await readFile(join(home,'.tmp','plugins-remote','old.txt'),'utf8'),'old');assert.equal((await manager.recoveries()).recoveries[0].phase,'rolled-back');
});
test('external config changes abort before replacing plugins and are not overwritten',async()=>{
 const {manager,home}=await fixture();mockCore(manager,{changeConfig:true});await assert.rejects(manager.repair(),/其他程序/);assert.equal(await readFile(join(home,'config.toml'),'utf8'),'changed externally');
});
test('real pinned core repairs isolated marketplace, registers it, preserves existing config, and repeats safely',{skip:!process.env.MANAGER777_CODEXPP_TEST_ENGINE},async()=>{
 const {manager,home}=await fixture();assert.equal((await manager.status()).marketplace.needsRepair,true);
 await manager.repair();const status=await manager.status();assert.equal(status.available,true);assert.equal(status.marketplace.registered,true);assert.equal(status.marketplace.needsRepair,false);
 const config=await readFile(join(home,'config.toml'),'utf8');assert.match(config,/test-model/);assert.match(config,/codex-plus-curated/);assert.ok(!config.includes('gcc-codexpp-recoveries'));
 await access(join(home,'.tmp','plugins-remote','.agents','plugins','marketplace.json'));
 await manager.repair();assert.equal((await manager.recoveries()).recoveries.length,2);assert.equal((await manager.status()).marketplace.registered,true);
});
