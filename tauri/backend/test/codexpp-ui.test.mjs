import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../features-ui.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('  async function refreshCodexpp(host)'),source.indexOf('  async function openCodexZh()'));
async function harness({available=true,confirm=true,error=null}={}){
 const calls=[],buttons=new Map(),messages=[],history={textContent:''};
 const host={innerHTML:'',querySelector(s){return {addEventListener:(event,fn)=>buttons.set(s,fn)};},querySelectorAll(){return [{dataset:{codexppFlag:'codexAppPasteFix'},checked:true}];}};
 const result={available,version:'1.2.56-777.4',features:[{id:'codexAppPasteFix',name:'粘贴修复'}],settings:{},marketplace:{registered:false},state:{phase:'idle',message:'尚未启用'},error};
 const context={host,api:async url=>{calls.push(url);return url.endsWith('/recoveries')?{recoveries:[]}:result;},post:async(url,body)=>{calls.push({url,body});return {message:'完成'};},h:String,button:(action,label,extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`,showToast:text=>messages.push(text),runButton:async(button,label,fn)=>fn(),ask:async()=>confirm,$:()=>history,failure:(_,e)=>{throw e;},Date};
 vm.createContext(context);await vm.runInContext(render+';refreshCodexpp(host)',context);
 return {host,calls,messages,history,click:action=>buttons.get(`[data-action="${action}"]`)({currentTarget:{}})};
}
test('same renderer is reached on Mac and Windows Tauri and missing core is explicit',async()=>{
 assert.match(source,/window\.__TAURI_INTERNALS__ \|\| window\.manager777Mac/);
 const h=await harness({available:false});assert.match(h.host.innerHTML,/缺少增强核心/);assert.match(h.host.innerHTML,/data-action="pp-repair" disabled/);assert.doesNotMatch(h.host.innerHTML,/已注册/);
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');assert.doesNotMatch(css,/data-platform="darwin"[^\n]*data-page-link="enhance"/);
});
test('repair has confirmation, sends correct route and refreshes actual result',async()=>{
 const cancelled=await harness({confirm:false});await cancelled.click('pp-repair');assert.equal(cancelled.calls.some(c=>c.url),false);
 const h=await harness();await h.click('pp-repair');assert.equal(h.calls.find(c=>c.url)?.url,'/api/enhancements/codexpp/repair');assert.equal(h.calls.find(c=>c.url)?.body.confirm,'REPAIR_PLUGINS');assert.equal(h.messages[0],'完成');
});
test('enhanced startup saves chosen flags, then launches without sending API Keys',async()=>{
 const h=await harness();await h.click('pp-start');const writes=h.calls.filter(c=>c.url);assert.equal(writes[0].url,'/api/enhancements/codexpp/settings');assert.equal(writes[0].body.settings.codexAppPasteFix,true);assert.equal(writes[1].body.confirm,'START_CODEXPP');assert.doesNotMatch(JSON.stringify(writes),/apiKey|relayApiKey/);
});
