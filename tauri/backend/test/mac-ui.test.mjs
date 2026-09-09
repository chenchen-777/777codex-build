import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=await readFile(new URL('../mac-ui.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map(),calls=[],prompts=[],listeners={};let accept=true;
 class Node{value=0;disabled=false;dataset={};textContent='';
  set innerHTML(v){for(const m of v.matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],new Node());}
  before(n){nodes.set('#'+n.id,n);}scrollIntoView(){}removeAttribute(){}querySelectorAll(){return [];}
 }
 for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],new Node());
 const document={documentElement:{dataset:{}},createElement:()=>new Node(),querySelector:s=>nodes.get(s)||null,addEventListener:(n,f)=>{listeners[n]=f;}};
 const window={manager777:{openPage:p=>calls.push(p),refreshCodex:async()=>{},showToast:()=>{},confirm:async text=>{prompts.push(text);return accept;},api:async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});return {phase:'idle',message:'就绪',architecture:'arm64',events:[],packagePath:'/fake/Codex.dmg'};}}};
 vm.runInNewContext(source,{window,document,setInterval(){}});
 return {nodes,calls,prompts,accept:v=>accept=v,async click(id,action){listeners.click({target:{closest:()=>({id,dataset:{macAction:action}})},preventDefault(){},stopImmediatePropagation(){}});for(let i=0;i<30;i++)await Promise.resolve();},async ready(){listeners.DOMContentLoaded();for(let i=0;i<15;i++)await Promise.resolve();}};
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
