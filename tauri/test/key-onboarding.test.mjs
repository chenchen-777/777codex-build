import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {patchKeyOnboarding} from '../scripts/key-onboarding.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('durable onboarding distinguishes empty, failed, selectable and incompatible keys',async()=>{
 const ui=await read('backend/tool-ui.js');
 for(const copy of ['还差一步：创建聊天密钥','去网页创建密钥','我已创建，重新同步','使用这把密钥并继续','使用所选密钥并继续','同步失败','不代表账号里没有密钥','暂时没有可用于聊天的密钥'])assert.ok(ui.includes(copy),copy);
 assert.match(ui,/keyOnboardingFlight/);assert.match(ui,/keyCreationIdentity!==identity\(snapshot\.account\)/);
 for(const preserved of ['密钥已验证 · 启动时连接','密钥待验证','想使用中文界面？','连接出问题了？','准备 Codex 客户端','软件名称'])assert.ok(ui.includes(preserved),preserved);
 const choose=ui.slice(ui.indexOf("if(action==='choose-key')"),ui.indexOf("if(action==='balance-refresh')"));
 assert.match(choose,/\/api\/providers\/switch/);assert.match(choose,/confirm:'SWITCH_PROVIDER'/);assert.match(choose,/await refresh\(\)/);assert.doesNotMatch(choose,/home-start-with-key|launch/);
 assert.match(ui,/data-onboarding-choice="true"/);assert.match(ui,/dataset\.onboardingChoice==='true'/);
 assert.match(ui,/sameUser\?\{referral:previous\.referral,keySyncState:previous\.keySyncState,balance:previous\.balance,balanceAt:previous\.balanceAt,accountFetchedAt:previous\.accountFetchedAt\}/);
 assert.ok(ui.indexOf("if(incompatible.length)")<ui.indexOf("snapshot.keySyncState==='failed'"),'incompatible synced keys must not render as confirmed zero');
});

test('create-key route is fixed, trusted POST and carries no credential input',async()=>{
 const server=await read('backend/scripts/server.mjs');
 assert.match(server,/pathname === '\/api\/account\/keys\/open-create'.*request\.method === 'POST'/);
 assert.match(server,/requireTrusted\(request\).*readJsonBody\(request\).*adapters\.openExternal\('https:\/\/www\.777codes\.codes\/keys'\)/s);
 const route=server.slice(server.indexOf("pathname === '/api/account/keys/open-create'"),server.indexOf("pathname.startsWith('/api/account/')"));
 assert.doesNotMatch(route,/payload|token|apiKey|key:/i);
});

test('patcher is idempotent for generated Windows and Mac backends',async()=>{
 const ui=await read('backend/tool-ui.js'),server=await read('backend/scripts/server.mjs'),again=patchKeyOnboarding(ui,server);
 assert.equal(again.ui,ui);assert.equal(again.server,server);
 assert.match(await read('scripts/prepare.mjs'),/applyKeyOnboarding\(target\)/);
 assert.match(await read('scripts/stage-mac-source.mjs'),/'key-onboarding\.mjs'/);
});

test('one Key explicitly switches without launching; multiple-Key selection alone does not submit',async()=>{
 const source=await read('backend/tool-ui.js'),seamed=source.replace('void refresh();','window.__keyTest={set(v){snapshot=v;},home(v){snapshot=v;return renderHome();}};'),events=new Map(),calls=[];
 const one={id:'one',name:'唯一密钥',type:'text',active:false,model:'gpt-5.5',reasoningEffort:'high',updatedAt:'now',adapter:{canActivate:true}},two={...one,id:'two',name:'第二把'};
 let providers=[one];const node=()=>({value:'',innerHTML:'',textContent:'',scrollTop:0,querySelector(){return null},replaceChildren(){},append(){},classList:{add(){},remove(){},toggle(){}}});
 const document={querySelector:node,querySelectorAll:()=>[],addEventListener:(name,handler)=>events.set(name,[...(events.get(name)||[]),handler])};
 const window={addEventListener(){},manager777:{confirm:async()=>true,refreshProviders:async()=>{}}};
 const fetch=async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});if(path==='/api/providers/switch'){providers=providers.map(x=>({...x,active:x.id==='one'}));return{ok:true,json:async()=>({ok:true})};}const body=path==='/api/providers'?{providers}:path==='/api/account/status'?{state:'logged-in',user:{id:'u1'}}:{installed:false};return{ok:true,json:async()=>body};};
 vm.runInNewContext(seamed,{window,document,fetch,structuredClone,console,Event},{timeout:2000});window.__keyTest.set({account:{state:'logged-in',user:{id:'u1'}},providers:{providers},codex:{installed:false},loading:false});
 for(const handler of events.get('click'))await handler({preventDefault(){},stopImmediatePropagation(){},target:{closest:selector=>selector==='[data-shell-action]'?{dataset:{shellAction:'choose-key'}}:null}});
 assert.equal(calls.filter(x=>x.path==='/api/providers/switch').length,1);assert.equal(calls.some(x=>/launch|restart/.test(x.path)),false);
 const ready=window.__keyTest.home({account:{state:'logged-in',user:{id:'u1'}},providers:{providers:providers.map(x=>({...x,active:true}))},codex:{installed:false},loading:false});assert.match(ready,/准备 Codex 客户端/);
 calls.length=0;window.__keyTest.set({account:{state:'logged-in',user:{id:'u1'}},providers:{providers:[one,two]},codex:{installed:false},loading:false});for(const handler of events.get('change'))await handler({target:{id:'shell-key-select',value:'two',dataset:{onboardingChoice:'true'}}});assert.equal(calls.length,0);
});

test('empty, failure and incompatible-only states remain distinct',async()=>{
 const source=await read('backend/tool-ui.js'),seamed=source.replace('void refresh();','window.__keyHome=v=>{snapshot=v;return renderHome();};'),window={addEventListener(){}},document={querySelector:()=>({}),querySelectorAll:()=>[],addEventListener(){}};vm.runInNewContext(seamed,{window,document,structuredClone,console},{timeout:2000});
 const base={account:{state:'logged-in',user:{id:'u'}},providers:{providers:[]},codex:{installed:false},loading:false};assert.match(window.__keyHome({...base,keySyncState:'empty'}),/还差一步/);assert.match(window.__keyHome({...base,keySyncState:'failed'}),/同步失败/);
 const image={id:'img',type:'image',adapter:{canActivate:true}};assert.match(window.__keyHome({...base,providers:{providers:[image]},keySyncState:'ready'}),/同步账号密钥/);assert.doesNotMatch(window.__keyHome({...base,providers:{providers:[image]},keySyncState:'ready'}),/还差一步/);
});
