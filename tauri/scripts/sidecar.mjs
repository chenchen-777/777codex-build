import {spawnSync} from 'node:child_process';
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
const updateStatus=backend.updateManager.status.bind(backend.updateManager);
backend.updateManager.status=async()=>({...await updateStatus(),settings:{autoCheck:false},lastCheck:null,ready:null});
backend.updateManager.check=backend.updateManager.download=backend.updateManager.install=async()=>{throw new Error('Tauri 迁移版不能使用 Electron 更新通道；请下载匹配的版本');};
backend.configureRuntimeAdapters({
  protect:value=>native('protect',String(value)),unprotect:value=>native('unprotect',String(value)),
  openExternal:async value=>{if(isolated)throw new Error('隔离测试不打开外部网页');return native('openUrl',value);},
  openPath:async value=>{if(isolated)throw new Error('隔离测试不打开本机目录');return native('openPath',value);},
  chooseSkillDirectory:async()=>native('chooseDirectory'),
  importProtocolState:()=>({ok:false,status:'unavailable',message:'Tauri 网页唤起入口尚在迁移；可使用网页登录同步 Key'}),
  registerImportProtocol:()=>({ok:false,status:'unavailable'}),
  scheduleManagerUpdate:async()=>{throw new Error('Tauri 候选版禁止安装 Electron 更新包，请下载对应 Tauri 版本');},
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
