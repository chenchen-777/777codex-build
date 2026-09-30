import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {patchLoginUi} from '../scripts/login-ui-recovery.mjs';
const original=await readFile(new URL('../backend/account-ui.js',import.meta.url),'utf8');
const source=patchLoginUi(original);
function fixture(post){
 const events=[],timers=[],notices=[];
 const context=vm.createContext({post,status:{state:'pending',expiresAt:new Date(Date.now()+60000).toISOString(),pollInterval:3},polling:false,pollTimer:null,$:()=>({textContent:''}),setHeader(){},close(){},showToast:(...args)=>notices.push(args),schedulePoll:n=>timers.push(n),clearTimeout(){},Date,CustomEvent:class{constructor(type){this.type=type;}},window:{dispatchEvent:e=>events.push(e.type),addEventListener(){},manager777:{refreshProviders:async()=>{}}},document:{addEventListener(){},hidden:false}});
 vm.runInContext(source.slice(source.indexOf('  function accountChanged()'),source.indexOf('  async function copyLink(')),context);
 return{context,events,timers,notices,poll:()=>vm.runInContext('poll()',context)};
}
test('closing dialog retains pending authorization; initial pending and focus resume polling',()=>{
 assert.match(source,/if \(status.state !== "pending"\) \{ clearTimeout/);
 assert.match(source,/refresh\(\).then\(value => \{ if\(value.state === 'pending'\)/);
 assert.match(source,/addEventListener\('focus'.*void poll\(\)/);
 assert.equal(patchLoginUi(source),source);
});
test('transient failure retries; approval updates shell and automatically syncs once',async()=>{
 const calls=[];let failed=false;
 const f=fixture(async path=>{calls.push(path);if(path.endsWith('/poll')){if(!failed){failed=true;throw Error('临时网络错误');}return{state:'logged-in',user:{id:'fake'}};}return{total:1};});
 await f.poll();assert.deepEqual(f.timers,[5]);await f.poll();
 assert.equal(f.context.status.state,'logged-in');assert.equal(calls.filter(x=>x.endsWith('/keys/sync')).length,1);
 assert.equal(f.events.length,2);await f.poll();assert.equal(calls.length,3);
});
test('focus and timer cannot exchange the same authorization concurrently',async()=>{
 let finish,count=0;const f=fixture(()=>{count++;return new Promise(resolve=>finish=resolve);});
 const a=f.poll();await f.poll();assert.equal(count,1);finish({state:'pending',pollInterval:3});await a;
 assert.deepEqual(f.timers,[3]);
});
test('expired authorization stops retrying; sync failure does not undo login',async()=>{
 const expired=fixture(()=>{throw Error('must not call');});expired.context.status.expiresAt=new Date(0).toISOString();await expired.poll();assert.equal(expired.context.status.state,'logged-out');assert.equal(expired.timers.length,0);
 const f=fixture(async path=>{if(path.endsWith('/poll'))return{state:'logged-in'};throw Error('同步失败');});await f.poll();assert.equal(f.context.status.state,'logged-in');assert.match(f.notices.at(-1)[0],/已登录，但密钥同步未完成/);
});
