import {spawnSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {configureLoginRecovery} from './login-recovery.mjs';
import {runtimePaths} from './runtime-paths.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const isolated=process.env.MANAGER777_ISOLATED!=='0';
process.env.PORT='0';
process.env.MANAGER777_ISOLATED=isolated?'1':'0';
process.env.MANAGER777_LIVE=isolated?'0':'1';
const paths=runtimePaths({platform:process.platform,home:homedir(),root,environment:process.env});
process.env.MANAGER777_ROOT=paths.manager;
process.env.MANAGER777_CODEX_ROOT=paths.codex;
process.env.MANAGER777_SKILL_ROOT=paths.skills;
for(const key of ['MANAGER777_ROOT','MANAGER777_CODEX_ROOT','MANAGER777_SKILL_ROOT'])if(isolated||key==='MANAGER777_ROOT')mkdirSync(process.env[key],{recursive:true});
process.env.CODEX_ZH_COMPONENT_ARCHIVE=join(root,'components','codex-zh','release-kit.zip');
function native(op,value='') {
  if(!process.env.MANAGER777_NATIVE)throw new Error('本机适配组件不可用');
  const result=spawnSync(process.env.MANAGER777_NATIVE,[],{input:JSON.stringify({op,value}),encoding:'utf8',windowsHide:true,timeout:op==='chooseDirectory'?120000:15000,maxBuffer:256*1024});
  if(result.error||result.status!==0)throw new Error('系统操作未完成；请查看组件状态');
  const reply=JSON.parse(result.stdout);if(!reply.ok)throw new Error(reply.message||'系统操作未完成');return reply.value;
}
const backend=await import('./server.mjs');
configureLoginRecovery(backend.accountManager);
backend.configureRuntimeAdapters({
  protect:value=>native('protect',String(value)),unprotect:value=>native('unprotect',String(value)),
  openExternal:async value=>{if(isolated)throw new Error('隔离测试不打开外部网页');return native('openUrl',value);},
  openPath:async value=>{if(isolated)throw new Error('隔离测试不打开本机目录');return native('openPath',value);},
  chooseSkillDirectory:async()=>native('chooseDirectory','选择包含 SKILL.md 的目录'),
  chooseDirectory:async title=>native('chooseDirectory',title||'选择目录'),
  chooseZip:async()=>native('chooseZip'),
  importProtocolState:()=>({ok:false,status:'unavailable',message:'请使用网页登录同步账号 Key'}),
  registerImportProtocol:()=>({ok:false,status:'unavailable'}),
  scheduleManagerUpdate:async plan=>{
    let command,args;
    if(process.platform==='win32'){
      command=join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',plan.helperPath,'-Plan',plan.planPath];
    }else if(process.platform==='darwin'){
      command=process.execPath;args=[plan.helperPath,plan.planPath];
    }else throw new Error('此系统暂不支持自动更新');
    const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    return {scheduled:true};
  },
});
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
send({kind:'ready',...(await backend.ready),isolated});
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
  try {
    if(line.length>65536)return;
    const request=JSON.parse(line);
    if(request.op==='busy')send({kind:'reply',id:request.id,busy:!!backend.getBusyOperation()});
    else if(request.op==='import') {try{backend.offerPlatformImport(request.value);}catch(error){backend.reportImportLinkError(error);}send({kind:'reply',id:request.id,ok:true});}
    else send({kind:'reply',id:request.id,ok:false});
  }catch{send({kind:'invalid-command'});}
});
lines.on('close',()=>{backend.server.close();backend.server.closeAllConnections?.();process.exit(0);});
