import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../tool-ui.js',import.meta.url),'utf8');
const css=await readFile(new URL('../tool-ui.css',import.meta.url),'utf8');
test('zero downloaded bytes are known, not missing size',()=>{
 const declaration=source.split(/\r?\n/).find(l=>l.startsWith('const sizeLabel='));const label=vm.runInNewContext(declaration+';sizeLabel');
 assert.equal(label(0),'0 B');assert.equal(label(1024),'1.0 KB');assert.equal(label(1048576),'1.0 MB');for(const n of [null,undefined,'',-1,NaN])assert.equal(label(n),'大小暂未提供');
});
test('slow share catalog does not lock the next Key navigation or move its scroll position',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve),mounted=[];
 const section={classList:{add(){}},querySelector(){return null;},prepend(){}};
 const context=vm.createContext({window:{manager777:{}},$:()=>section,releaseLegacy(){},legacyOpenPage(){},document:{createElement:()=>({dataset:{}})},content:{replaceChildren:s=>mounted.push(s),scrollTop:0},nav(){},refreshReferral:()=>pending,refreshTargets:async()=>{},render(){},refreshAccount(){}});
 const lines=source.split(/\r?\n/);vm.runInContext(lines.find(l=>l.startsWith('async function openLegacy('))+'\n'+lines.find(l=>l.startsWith('if(window.manager777)window.manager777.openPage=')),context);
 const first=context.window.manager777.openPage('share-package');await context.window.manager777.openPage('providers');assert.equal(mounted.length,2);context.content.scrollTop=80;finish();await first;assert.equal(context.content.scrollTop,80);
});
function harness(response){
  const nodes=new Map(),calls=[];
  const $=s=>{if(!nodes.has(s))nodes.set(s,{value:'',innerHTML:'',textContent:'',disabled:false,classList:{toggle(){},add(){},remove(){}}});return nodes.get(s);};
  const context=vm.createContext({$,escape:String,show:(s,t)=>$(s).textContent=t,api:async(path)=>{calls.push(path);if(path==='/api/account/referral')return {shareUrl:'https://777codes.com/register?ref=public'};return typeof response==='function'?response():response;}});
  vm.runInContext(source.slice(source.indexOf('let sharePackages='),source.indexOf('function show('))+';globalThis.testShare={refreshReferral,refreshShareReleases,shareControls,shareSelection};',context);
  return {$,calls,context,ui:context.testShare};
}
test('Key status has a full row and category heading/count have separate structural boxes',()=>{
  assert.match(css,/#platform-import-status\{[^}]*flex:1 0 100%/);
  assert.match(css,/\.header-actions\{[^}]*flex-wrap:wrap[^}]*gap:10px/);
  assert.match(css,/\.category-panel\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.category-panel>h3[^}]*grid-column:1\/-1/);
  assert.match(css,/\.category-item>div\{display:grid;gap:4px/);
  assert.match(css,/\.category-item strong,\.shell-tool-active \.category-item small\{display:block/);
  assert.match(css,/@media\(max-width:400px\)[^\n]*\.header-actions>\.button\{flex-basis:100%/);
});
test('share selector uses real availability and enables create only after directory + referral',async()=>{
  const h=harness({ok:true,packages:[{id:'manager-windows',available:true,version:'1.2.3',sizeBytes:1048576,cached:true},{id:'manager-macos-arm64',available:false,message:'即将提供'}]});
  await h.ui.refreshReferral();
  assert.match(h.$('#share-package-version').innerHTML,/Windows/);
  assert.match(h.$('#share-package-version').innerHTML,/manager-macos-arm64" disabled/);
  assert.match(h.$('#share-package-version').innerHTML,/manager-macos-x64" disabled/);
  assert.match(h.$('#share-release-info').textContent,/1.2.3 · 1.0 MB/);
  assert.match(h.$('#share-release-info').textContent,/已缓存/);
  assert.equal(h.$('#share-package-create').disabled,true);
  h.$('#share-output').value='D:/Downloads';h.ui.shareControls();assert.equal(h.$('#share-package-create').disabled,false);
});
test('loading, empty and error responses never offer a fabricated download',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));const pending=h.ui.refreshShareReleases();
  assert.equal(h.$('#share-package-create').disabled,true);assert.match(h.$('#share-release-info').textContent,/正在/);
  resolve({ok:true,packages:[]});await pending;assert.equal(h.$('#share-package-create').disabled,true);assert.match(h.$('#share-release-info').textContent,/暂时不可用/);
  const failed=harness(()=>{throw new Error('网络不可用');});await failed.ui.refreshShareReleases();assert.match(failed.$('#share-release-info').textContent,/网络不可用/);assert.equal(failed.$('#share-package-create').disabled,true);
});
test('new package request contains only release identity and output directory; legacy manual ZIP removed',()=>{
  assert.match(source,/api\('\/api\/share-package\/start',\{packageId:selected.id,outputDirectory\}\)/);
  assert.doesNotMatch(source,/basePackage:|share-base-choose/);
  assert.match(source,/shareBusy=true;sharePath='';/);
  assert.match(source,/shareBusy=false;shareControls\(\);throw error/);
  assert.match(source,/id==='share-cancel'&&shareId&&shareBusy/);
  for(const page of ['codex','home','providers','extensions','enhance','tool-doctor','share-package','sessions','logs','settings'])assert.ok(source.includes(`['${page}',`));
});
test('share and Doctor progress translate all known phases and hide unknown internal labels',()=>{
  const declaration=source.split(/\r?\n/).find(line=>line.startsWith('function taskPhaseLabel('));
  const label=vm.runInNewContext(declaration+';taskPhaseLabel');
  for(const phase of ['queued','running','downloading','download','validating','verifying','hashing','scanning','compressing','packaging','ready','cached','completed','done','cancelled','failed'])assert.match(label('share',phase),/[\u4e00-\u9fff]/);
  for(const phase of ['queued','running','saving-report','completed','cancelled','failed'])assert.match(label('doctor',phase),/[\u4e00-\u9fff]/);
  assert.equal(label('share','future-internal-phase'),'正在处理');
  assert.equal(label('doctor','future-internal-phase'),'正在处理');
  assert.match(source,/taskPhaseLabel\('doctor',t.phase\)/);
  assert.match(source,/taskPhaseLabel\('share',t.phase\)/);
  assert.doesNotMatch(source,/\$\{t.phase\}/);
});
