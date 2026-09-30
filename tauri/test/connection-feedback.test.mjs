import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../backend/tool-ui.js',import.meta.url),'utf8');
function fixture(){
 const controls=[{disabled:false,isConnected:true},{disabled:true,isConnected:true}];
 let notice;
 const context=vm.createContext({$:()=>notice,content:{},document:{createElement:()=>({setAttribute(){},remove(){notice=undefined;}}),body:{append(node){notice=node;}},querySelectorAll:()=>controls},MutationObserver:class{observe(){}disconnect(){}},clearTimeout(){},setTimeout(){return 1;}});
 const start=source.indexOf('let connectionBusy='),end=source.indexOf('const legacyApi=',start);
 vm.runInContext(source.slice(start,end),context);
 return {context,controls,get notice(){return notice;}};
}
test('pending feedback appears immediately, prevents duplicate work and restores controls',async()=>{
 const f=fixture();let finish;
 f.context.task=()=>new Promise(resolve=>{finish=resolve;});
 const operation=vm.runInContext("connectionFeedback(task,'新模型')",f.context);
 assert.match(f.notice.textContent,/正在切换到 新模型/);
 assert.ok(f.controls.every(x=>x.disabled));
 await assert.rejects(vm.runInContext("connectionFeedback(task,'另一个')",f.context),/等待完成/);
 finish({applied:true});await operation;
 assert.match(f.notice.textContent,/新连接已应用/);
 assert.equal(f.controls[0].disabled,false);assert.equal(f.controls[1].disabled,true);
});
test('failed operation reports failure and releases the lock for retry',async()=>{
 const f=fixture();f.context.task=async()=>{throw Error('测试失败');};
 await assert.rejects(vm.runInContext("connectionFeedback(task,'新模型')",f.context),/测试失败/);
 assert.match(f.notice.textContent,/切换未完成/);assert.equal(f.controls[0].disabled,false);
 f.context.task=async()=>({});await vm.runInContext("connectionFeedback(task,'新模型')",f.context);
 assert.match(f.notice.textContent,/下次从管理工具启动时生效/);
});
test('shared rounded form controls cover shell, tools and dialogs',async()=>{
 const css=await readFile(new URL('../backend/tool-ui.css',import.meta.url),'utf8');
 assert.match(css,/--control-radius:12px/);
 assert.match(css,/\.production-app #content select,\.production-app select,dialog select,\.modal select/);
 assert.match(css,/border-radius:var\(--control-radius\)!important/);
});
