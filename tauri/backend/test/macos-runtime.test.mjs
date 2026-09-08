import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {macPaths,parseMacPids,macCodexStatus,macUnavailableRoute} from '../js/macos-runtime.mjs';
test('macOS uses user Application Support and respects isolated test directories',()=>{
 const p=macPaths({},'/Users/tester');assert.equal(p.manager,join('/Users/tester','Library','Application Support','777Codex-0.11-Candidate'));assert.equal(p.codex,join('/Users/tester','.codex'));
 assert.equal(macPaths({CODEX_HOME:'/custom/codex'},'/Users/tester').codex,'/custom/codex');
 assert.equal(macPaths({MANAGER777_ROOT:'/isolated'},'/Users/tester').manager,'/isolated');
});
test('Mac process matching excludes other apps and helpers',()=>{
 const exe='/Applications/Codex.app/Contents/MacOS/Codex';
 assert.deepEqual(parseMacPids(` 12 ${exe}\n13 ${exe} Helper\n14 /other/Codex`,exe),[12]);
});
test('Mac detection reads bundle metadata, and absent app is not reported installed',async()=>{
 const bundle='/Applications/Codex.app';const exe=join(bundle,'Contents','MacOS','Codex');
 const run=async(command,args)=>({stdout:command.endsWith('plutil')?(args[1]==='CFBundleExecutable'?'Codex':'1.2.3'):`123 ${exe}\n124 /other/Codex`});
 const status=await macCodexStatus({CODEX_DESKTOP_PATH:bundle},{run,exists:async()=>true});
 assert.equal(status.installed,true);assert.equal(status.running,true);assert.equal(status.version,'1.2.3');assert.equal(status.canUninstall,false);assert.deepEqual(status.processIds,[123]);
 const missing=await macCodexStatus({},{run,exists:async()=>false});assert.equal(missing.installed,false);
 await assert.rejects(macCodexStatus({CODEX_DESKTOP_PATH:bundle},{run:async()=>({stdout:'../escape'}),exists:async()=>true}),e=>e.code==='MAC_APP_INVALID');
});
test('Windows installers, repair and update mutations are gated on Mac, common key and MCP routes remain available',()=>{
 for(const path of ['/api/codex/installer/install','/api/codex/uninstall','/api/enhancements/plugin-repair/run','/api/manager-update/install','/api/extensions/image-mcp/install'])assert.equal(macUnavailableRoute(path),true,path);
 for(const path of ['/api/providers/save','/api/providers/activate','/api/extensions/mcp/save','/api/codex/launch','/api/account/login/start'])assert.equal(macUnavailableRoute(path),false,path);
});
