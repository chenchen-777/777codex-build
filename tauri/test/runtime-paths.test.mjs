import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {runtimePaths} from '../scripts/runtime-paths.mjs';
test('macOS live state is outside .app, independent from old Electron data',()=>{
 const p=runtimePaths({platform:'darwin',home:'/Users/example',root:'/Applications/777 Codex.app/Contents/Resources/backend',environment:{MANAGER777_ISOLATED:'0'}});
 assert.equal(p.isolated,false);assert.ok(!p.manager.includes('.app'));assert.ok(!p.manager.includes('0.11'));
 assert.equal(p.codex,join('/Users/example','.codex'));
});
test('Mac isolation never changes real Codex or Skill locations',()=>{
 const p=runtimePaths({platform:'darwin',home:'/Users/example',root:'/Applications/777 Codex.app/Contents/Resources/backend'});
 assert.ok(p.isolated);for(const field of ['manager','codex','skills'])assert.ok(p[field].includes('777Codex-Tauri-Isolated'));
});
