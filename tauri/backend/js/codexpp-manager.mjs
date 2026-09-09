import {access,cp,lstat,mkdir,readFile,readdir,rename,writeFile,realpath} from 'node:fs/promises';
import {dirname,join,resolve,parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {AppError,ensure} from './errors.mjs';

export const CODEXPP_VERSION='1.2.56-777.4';
export const CODEXPP_FEATURES=Object.freeze([
 ['codexAppPluginMarketplaceUnlock','插件市场'],['codexAppModelWhitelistUnlock','模型选择扩展'],
 ['codexAppSessionDelete','会话删除'],['codexAppMarkdownExport','导出 Markdown'],
 ['codexAppPasteFix','粘贴修复'],['codexAppFastStartup','快速启动'],
 ['codexAppThreadIdBadge','显示会话编号'],['codexAppConversationView','会话视图'],
 ['codexAppThreadScrollRestore','记住滚动位置'],['codexAppZedRemoteOpen','用 Zed 打开远程项目'],
 ['codexAppUpstreamWorktreeCreate','创建 Worktree'],['codexAppNativeMenuPlacement','菜单位置优化'],
 ['codexAppServiceTierControls','服务档位选择'],['codexAppAnswerOutlineEnabled','回答大纲'],
 ['codexAppPetRealMouseLook','桌宠跟随鼠标'],
]);
export function validateCodexppSettings(value){
 ensure(value&&typeof value==='object'&&!Array.isArray(value),'增强设置格式错误');
 const allowed=new Set(CODEXPP_FEATURES.map(([id])=>id));
 for(const [key,v] of Object.entries(value))ensure(allowed.has(key)&&typeof v==='boolean','不支持的增强设置');
 return Object.fromEntries(CODEXPP_FEATURES.map(([id])=>[id,value[id]===true]));
}
const exists=path=>access(path).then(()=>true,()=>false);
async function noLinks(path,tree=false){
 let absolute=resolve(path);
 // macOS exposes its temporary roots through root-owned system aliases.
 // Accept only those exact verified aliases, never arbitrary user symlinks.
 if(process.platform==='darwin')for(const alias of ['/var','/tmp']){
  if(absolute===alias||absolute.startsWith(alias+'/')){
   const stat=await lstat(alias),canonical=await realpath(alias);
   ensure(stat.uid===0&&canonical==='/private'+alias,'系统目录链接异常','CODEXPP_UNSAFE_PATH',409);
   absolute=canonical+absolute.slice(alias.length);break;
  }
 }
 let current=parse(absolute).root;
 for(const segment of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)){
  current=join(current,segment);const stat=await lstat(current).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!stat)break;ensure(!stat.isSymbolicLink(),'目标包含链接，请先手动检查','CODEXPP_UNSAFE_PATH',409);
 }
 if(tree&&await exists(path))for(const entry of await readdir(path,{withFileTypes:true})){
  ensure(!entry.isSymbolicLink(),'插件目录包含链接，请先手动检查','CODEXPP_UNSAFE_PATH',409);
  if(entry.isDirectory())await noLinks(join(path,entry.name),true);
 }
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
async function fingerprint(path){
 if(!await exists(path))return null;await noLinks(path);const hash=createHash('sha256');
 async function walk(current,relative=''){const stat=await lstat(current);ensure(!stat.isSymbolicLink(),'恢复目标包含链接','CODEXPP_UNSAFE_PATH',409);hash.update(relative+'\0');if(stat.isDirectory()){for(const name of (await readdir(current)).sort())await walk(join(current,name),relative+'/'+name);}else hash.update(await readFile(current));}
 await walk(path);return hash.digest('hex');
}
export class CodexppManager {
 constructor({codexRoot,managerRoot,codexStatus,enginePath,spawnProcess=spawn}){
  this.home=resolve(codexRoot);this.root=join(resolve(managerRoot),'CodexPlusPlus');this.codexStatus=codexStatus;this.spawn=spawnProcess;
  this.engine=enginePath||process.env.MANAGER777_CODEXPP||resolve(dirname(fileURLToPath(import.meta.url)),process.platform==='darwin'?'../../../MacOS/777-codexpp':'../../777-codexpp.exe');
  this.worker=null;this.state={phase:'idle',message:'尚未启用'};
 }
 async settings(){try{return validateCodexppSettings(JSON.parse(await readFile(join(this.root,'settings.json'),'utf8')));}catch(e){if(e.code==='ENOENT')return validateCodexppSettings({});throw new AppError('增强设置无法读取，请检查配置文件','CODEXPP_SETTINGS_INVALID',409);}}
 async save(value){ensure(!this.worker,'请先关闭增强会话，再保存设置','OPERATION_BUSY',409);const settings=validateCodexppSettings(value);await noLinks(this.root);await mkdir(this.root,{recursive:true});await noLinks(join(this.root,'settings.json'));const pending=join(this.root,`settings-${randomUUID()}.pending`);await writeFile(pending,JSON.stringify(settings,null,2),{mode:0o600,flag:'wx'});await rename(pending,join(this.root,'settings.json'));return {ok:true,settings,message:'增强设置已保存，下次增强启动时生效'};}
 async call(payload,{runtime=false,onMessage=()=>{}}={}){
  ensure(await exists(this.engine),'安装包缺少 Codex++ 核心，请下载含增强组件的新版管理工具','CODEXPP_COMPONENT_MISSING',409);
  return new Promise((resolve,reject)=>{
   const child=this.spawn(this.engine,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,CODEX_HOME:payload.codexRoot||this.home}});
   if(runtime)this.worker=child;
   let text='',last=null,settled=false,total=0;
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
   const failure=()=>new AppError(runtime?'Codex++ 启动或连接失败，请确认 Codex 已关闭且版本兼容':'插件修复未完成，原配置已保留，请查看恢复记录','CODEXPP_ENGINE_FAILED',409);
   const timer=setTimeout(()=>{child.kill();finish(new AppError('Codex++ 执行超时，请重试','CODEXPP_TIMEOUT',504));},runtime?45000:120000);
   child.stdout.on('data',chunk=>{
    total+=chunk.length;if(total>1024*1024){child.kill();finish(failure());return;}
    text+=chunk.toString();let end;
    while((end=text.indexOf('\n'))>=0){const line=text.slice(0,end);text=text.slice(end+1);try{last=JSON.parse(line);}catch{continue;}
     onMessage(last);if(runtime&&last.ok&&last.phase==='running')finish(null,last);
    }
   });
   // Native diagnostics can include paths or config content; do not expose them as API errors.
   child.stderr.on('data',()=>{});
   child.stdin.on('error',()=>{});
   child.on('error',()=>{if(runtime){this.worker=null;this.state={phase:'failed',message:failure().message};}finish(failure());});
   child.on('close',code=>{if(runtime){this.worker=null;this.state={phase:code===0?'idle':'failed',message:code===0?'Codex 已退出':failure().message};}finish(code===0&&last?.ok?null:failure(),last);});
   child.stdin.end(JSON.stringify(payload)+'\n');
  });
 }
 async status(){
  const available=await exists(this.engine);let marketplace=null,error=null;
  if(available)try{const v=await this.call({action:'version'});ensure(v.version===CODEXPP_VERSION,'增强核心版本不匹配','CODEXPP_VERSION_MISMATCH',409);marketplace=await this.call({action:'status',codexRoot:this.home});}catch(e){error=e.message;}
  return {ok:true,available:available&&!error,version:CODEXPP_VERSION,features:CODEXPP_FEATURES.map(([id,name])=>({id,name})),settings:await this.settings(),marketplace,state:this.state,error};
 }
 async closed(){const status=await this.codexStatus();ensure(!status.running&&!this.worker,'请先保存对话并关闭 Codex，再执行此操作','CODEX_STILL_RUNNING',409);return status;}
 async repair(){
  await this.closed();await noLinks(this.home);await noLinks(join(this.home,'.tmp'));await noLinks(join(this.home,'config.toml'));await noLinks(join(this.home,'.tmp','plugins-remote'),true);
  const id=randomUUID(),recovery=join(this.home,'.tmp','gcc-codexpp-recoveries',id),work=join(recovery,'work');
  await noLinks(recovery);await mkdir(work,{recursive:true,mode:0o700});
  const config=join(this.home,'config.toml'),target=join(this.home,'.tmp','plugins-remote');
  const original=await readFile(config).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(original)await writeFile(join(recovery,'config.before.toml'),original,{mode:0o600});
  const record={id,time:new Date().toISOString(),phase:'preparing',configExisted:original!==null,pluginsExisted:await exists(target)};
  const recordFile=join(recovery,'record.json');await writeFile(recordFile,JSON.stringify(record));
  let moved=false,installed=false,registering=false;
  try{
   // Upstream extraction works exclusively in a fresh workspace; no previous user directory is deleted.
   await this.call({action:'repair',codexRoot:work});await this.closed();
   const current=await readFile(config).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   ensure(original===null?current===null:current?.equals(original),'Codex 配置已被其他程序修改，请重试','CONFIG_CHANGED',409);
   await noLinks(target,true);await noLinks(config);
   if(record.pluginsExisted){await rename(target,join(recovery,'plugins.before'));moved=true;}
   await rename(join(work,'.tmp','plugins-remote'),target);installed=true;registering=true;
   await this.call({action:'register',codexRoot:this.home});
   record.afterConfig=await fingerprint(config);record.afterPlugins=await fingerprint(target);record.phase='complete';await writeFile(recordFile,JSON.stringify(record));
   return {ok:true,message:'插件市场已修复并完成注册，重新启动 Codex 后检查插件列表',recoveryId:id};
  }catch(error){
   if(registering&&await exists(config))await rename(config,join(recovery,'config.failed.toml'));
   if(registering&&original)await writeFile(config,original,{mode:0o600});
   if(installed&&await exists(target))await rename(target,join(recovery,'plugins.failed'));
   if(moved)await rename(join(recovery,'plugins.before'),target);
   record.phase='rolled-back';await writeFile(recordFile,JSON.stringify(record));throw error;
  }
 }
 async recoveries(){const base=join(this.home,'.tmp','gcc-codexpp-recoveries');const entries=await readdir(base,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});return {ok:true,recoveries:await Promise.all(entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&/^[a-f0-9-]{36}$/.test(e.name)).map(async e=>JSON.parse(await readFile(join(base,e.name,'record.json'),'utf8'))))};}
 async restore(id){
  ensure(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'恢复记录无效');await this.closed();
  const dir=join(this.home,'.tmp','gcc-codexpp-recoveries',id),file=join(dir,'record.json');await noLinks(dir,true);
  const record=JSON.parse(await readFile(file,'utf8'));ensure(record.id===id&&record.phase==='complete','此记录不可恢复');
  const config=join(this.home,'config.toml'),target=join(this.home,'.tmp','plugins-remote');
  ensure(await fingerprint(config)===record.afterConfig&&await fingerprint(target)===record.afterPlugins,'修复后配置或插件已改变，为避免覆盖新 Key 或插件，请先手动核对恢复记录','RECOVERY_CONFLICT',409);
  if(record.configExisted)await access(join(dir,'config.before.toml'));if(record.pluginsExisted)await access(join(dir,'plugins.before'));
  let savedConfig=false,savedPlugins=false,restoredConfig=false,restoredPlugins=false;
  try{
   await rename(config,join(dir,'config.after.toml'));savedConfig=true;await rename(target,join(dir,'plugins.after'));savedPlugins=true;
   if(record.configExisted){await cp(join(dir,'config.before.toml'),config,{errorOnExist:true,force:false});restoredConfig=true;}
   if(record.pluginsExisted){await rename(join(dir,'plugins.before'),target);restoredPlugins=true;}
   record.phase='restored';await writeFile(file,JSON.stringify(record));return {ok:true,message:'已恢复修复前的配置和插件目录，本次替换的文件也已保留'};
  }catch(error){
   if(restoredConfig)await rename(config,join(dir,'config.restore-failed.toml'));if(restoredPlugins)await rename(target,join(dir,'plugins.before'));
   if(savedConfig)await rename(join(dir,'config.after.toml'),config);if(savedPlugins)await rename(join(dir,'plugins.after'),target);throw error;
  }
 }
 async launch(){
  const status=await this.closed();ensure(status.installed&&status.installDirectory,'请先安装兼容的 Codex 客户端','CODEX_MISSING',409);
  const settings=await this.settings();ensure(Object.values(settings).some(Boolean),'请先选择并保存需要的增强功能');
  await noLinks(this.root);await mkdir(this.root,{recursive:true});const port=await freePort();this.state={phase:'starting',message:'正在启动并连接 Codex++'};
  try{return await this.call({action:'runtime',codexRoot:this.home,root:this.root,app:status.installDirectory,port,settings},{runtime:true,onMessage:v=>{if(v.ok&&v.phase==='running')this.state={phase:'running',message:'Codex++ 已连接'};}});}catch(e){this.state={phase:'failed',message:e.message};throw e;}
 }
 dispose(){this.worker?.kill();}
}
