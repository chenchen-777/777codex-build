import {access} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError} from './errors.mjs';
const exec=promisify(execFile);
export function macPaths(environment=process.env,home=homedir()) {
  return {manager:environment.MANAGER777_ROOT||join(home,'Library','Application Support','777Codex-0.11-Candidate'),codex:environment.MANAGER777_CODEX_ROOT||environment.CODEX_HOME||join(home,'.codex'),skills:environment.MANAGER777_SKILL_ROOT||join(home,'.agents','skills')};
}
export function parseMacPids(output,executable) {
  return output.split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(.+)$/);return m&&m[2]===executable?[Number(m[1])]:[];});
}
export async function macCodexStatus(environment=process.env,{run=exec,exists=p=>access(p).then(()=>true,()=>false),home=homedir()}={}) {
  const candidates=[environment.CODEX_DESKTOP_PATH,join(home,'Applications','Codex.app'),'/Applications/Codex.app',join(home,'Applications','ChatGPT.app'),'/Applications/ChatGPT.app'].filter(Boolean);
  for(const bundle of candidates){
    if(!bundle.endsWith('.app')||!await exists(join(bundle,'Contents','Info.plist')))continue;
    if(!await exists(join(bundle,'Contents','Resources','app.asar')))continue;
    const field=async key=>(await run('/usr/bin/plutil',['-extract',key,'raw','-o','-',join(bundle,'Contents','Info.plist')],{timeout:10000})).stdout.trim();
    const name=await field('CFBundleExecutable');
    if(!name||basename(name)!==name||name==='.'||name==='..')throw new AppError('Codex 应用信息无效','MAC_APP_INVALID',409);
    const executable=join(bundle,'Contents','MacOS',name);if(!await exists(executable))continue;
    const version=await field('CFBundleShortVersionString');
    const {stdout}=await run('/bin/ps',['-axo','pid=,comm='],{timeout:10000,maxBuffer:4*1024*1024});
    const processIds=parseMacPids(stdout,executable);
    return {installed:true,running:processIds.length>0,processIds,executable,installDirectory:bundle,version,source:'macos-app',canUninstall:false};
  }
  return {installed:false,running:false,processIds:[],executable:null,installDirectory:null,version:null,source:null,canUninstall:false};
}
export async function launchMacCodex(environment=process.env,extraEnvironment={}) {
  const before=await macCodexStatus(environment);
  if(!before.installed)throw new AppError('请先将兼容的官方 Codex.app 安装到 Applications，再启动','MAC_CODEX_MISSING',409);
  if(before.running){await exec('/usr/bin/open',['-a',before.installDirectory],{timeout:10000});return {ok:true,running:true,executable:before.executable};}
  await new Promise((resolve,reject)=>{const child=spawn(before.executable,[],{detached:true,stdio:'ignore',env:{...environment,...extraEnvironment}});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,400));const status=await macCodexStatus(environment);if(status.running)return {ok:true,running:true,executable:status.executable};}
  throw new AppError('启动后未检测到 Codex，请检查芯片兼容性及系统提示','MAC_CODEX_START_FAILED',409);
}
export async function stopMacCodex(environment=process.env) {
  const before=await macCodexStatus(environment);
  if(!before.running)return;
  // Quit only the selected bundle gracefully; never kill by a broad process name.
  const bundle=JSON.stringify(before.installDirectory);
  await exec('/usr/bin/osascript',['-e',`tell application ${bundle} to quit`],{timeout:15000});
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,400));if(!(await macCodexStatus(environment)).running)return;}
  throw new AppError('Codex 尚未退出，请保存工作并手动关闭后重试','MAC_CODEX_STILL_RUNNING',409);
}
export function macUnavailableRoute(path) {
  if(['/api/enhancements/codexpp/settings','/api/enhancements/codexpp/repair','/api/enhancements/codexpp/launch'].includes(path))return false;
  if(path.startsWith('/api/extensions/plugins/'))return true;
  return path.startsWith('/api/codex/installer/')||['/api/codex/download','/api/codex/install','/api/codex/uninstall','/api/codex/run-installer','/api/extensions/image-mcp/install'].includes(path)||path.startsWith('/api/enhancements/')||path.startsWith('/api/manager-update/');
}
