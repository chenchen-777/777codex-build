import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=await readFile(new URL('../mac-ui.js',import.meta.url),'utf8');
function setup({mac={},codex={installed:false}}={}){
 const nodes=new Map(),calls=[],prompts=[],listeners={};let accept=true,macState=mac,codexState=codex,alignedRefreshes=0;
 class Node{value=0;disabled=false;dataset={};textContent='';
  set innerHTML(v){for(const m of v.matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],new Node());}
  before(n){nodes.set('#'+n.id,n);}scrollIntoView(){}removeAttribute(){}querySelector(s){return nodes.get(s)||null;}querySelectorAll(){return [];}
 }
 for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],new Node());
 const document={documentElement:{dataset:{}},createElement:()=>new Node(),querySelector:s=>nodes.get(s)||null,addEventListener:(n,f)=>{listeners[n]=f;}};
 const window={dispatchEvent:event=>calls.push({event:event.type}),demoAlignedUI:{refresh:async()=>{alignedRefreshes++;}},manager777:{openPage:p=>calls.push(p),refreshCodex:async()=>calls.push('refreshCodex'),showToast:()=>{},confirm:async text=>{prompts.push(text);return accept;},api:async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});return path==='/api/codex/status'?codexState:{phase:'idle',message:'就绪',architecture:'arm64',events:[],packagePath:'/fake/Codex.dmg',...macState};}}};
 vm.runInNewContext(source,{window,document,Event:class Event{constructor(type){this.type=type;}},setInterval(){}});
 return {nodes,calls,prompts,get alignedRefreshes(){return alignedRefreshes;},setMac:v=>macState=v,setCodex:v=>codexState=v,accept:v=>accept=v,async click(id,action,main){listeners.click({target:{closest:()=>({id,dataset:{macAction:action,macMain:main}})},preventDefault(){},stopImmediatePropagation(){}});for(let i=0;i<30;i++)await Promise.resolve();},async ready(){listeners.DOMContentLoaded();for(let i=0;i<15;i++)await Promise.resolve();}};
}
test('Mac renderer initializes from real current IDs and shows native management panel',async()=>{
 const h=setup();await h.ready();assert.ok(h.nodes.has('#mac-components'));assert.equal(h.nodes.get('#mac-task-message').textContent,'就绪');
 await h.click('codex-download');assert.ok(h.calls.includes('codex'));
 await h.click('home-codex-zh');assert.ok(h.nodes.has('#mac-zh-heading'));
});
test('uninstall requires confirmation and sends only the native Mac action',async()=>{
 const h=setup();h.accept(false);await h.click('codex-uninstall');assert.equal(h.calls.some(c=>c.path==='/api/mac/action'),false);
 h.accept(true);await h.click('codex-uninstall');assert.match(h.prompts[0],/保留聊天记录/);
 assert.equal(h.calls.find(c=>c.path==='/api/mac/action').body.action,'uninstall');
 assert.equal(h.calls.some(c=>c.path==='/api/codex/uninstall'),false);
});
test('localization warns about local signature and security shortcut does not grant permission',async()=>{
 const h=setup();await h.click('', 'zh-install');assert.match(h.prompts[0],/不是 Apple 公证/);
 await h.click('', 'security');assert.equal(h.calls.filter(c=>c.path==='/api/mac/action').at(-1).body.confirm,'MAC_security');
 assert.doesNotMatch(source,/spctl.*disable|xattr.*-d|osascript/);
});
test('main flow uses real installed state instead of treating every complete Mac task as an install',async()=>{
 const missing=setup({mac:{phase:'complete',message:'来源检查完成'}});await missing.ready();
 assert.equal(missing.nodes.get('#mac-flow-main').textContent,'下载安装');
 const installed=setup({mac:{phase:'complete'},codex:{installed:true,version:'1.2.3'}});await installed.ready();
 assert.equal(installed.nodes.get('#mac-flow-main').textContent,'启动');
});
test('verified package offers install or update and routes through native Mac action',async()=>{
 const h=setup({mac:{packageExists:true,sha256:'abc',version:'2.0'},codex:{installed:true,version:'1.0'}});await h.ready();
 assert.equal(h.nodes.get('#mac-flow-main').textContent,'更新');await h.click('',undefined,'install');
 assert.equal(h.calls.filter(c=>c.path==='/api/mac/action').at(-1).body.action,'install');
});
test('same-version verified cache prefers launch instead of offering a redundant update',async()=>{
 const h=setup({mac:{packageExists:true,sha256:'abc',version:'2.0'},codex:{installed:true,version:'2.0'}});await h.ready();
 assert.equal(h.nodes.get('#mac-flow-main').textContent,'启动');assert.equal(h.nodes.get('#mac-flow-main').dataset.macMain,'launch');
});
test('busy completion refreshes legacy state and the three-page home directly',async()=>{
 const h=setup({mac:{busy:true,phase:'installing'},codex:{installed:false}});await h.ready();
 h.setMac({busy:false,phase:'complete'});h.setCodex({installed:true,version:'2.0'});await h.ready();
 assert.ok(h.calls.includes('refreshCodex'));assert.equal(h.alignedRefreshes,1);assert.ok(h.calls.some(c=>c.event==='manager777:installation-changed'));
 assert.equal(h.nodes.get('#mac-flow-main').textContent,'启动');
});
test('Chinese copy labels follow missing, compatible and stale official versions',async()=>{
 const missing=setup({codex:{installed:true,version:'2'}});await missing.ready();assert.equal(missing.nodes.get('#mac-zh-install').textContent,'安装中文版');
 const current=setup({mac:{zhInstalled:true,zhVersion:'2'},codex:{installed:true,version:'2'}});await current.ready();assert.equal(current.nodes.get('#mac-zh-install').textContent,'重新安装中文版');assert.equal(current.nodes.get('#mac-zh-launch').className,'button primary');
 const stale=setup({mac:{zhInstalled:true,zhVersion:'1'},codex:{installed:true,version:'2'}});await stale.ready();assert.equal(stale.nodes.get('#mac-zh-install').textContent,'更新中文版');assert.equal(stale.nodes.get('#mac-zh-launch').className,'button ghost');
});
