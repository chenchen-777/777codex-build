import {access,mkdir,mkdtemp,readFile,writeFile,rename,lstat,realpath,readdir,open,stat} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError,ensure} from './errors.mjs';
import {macCodexStatus,stopMacCodex,launchMacCodex} from './macos-runtime.mjs';
import {patchMacI18n} from './mac-i18n.mjs';
const exec=promisify(execFile),exists=p=>access(p).then(()=>true,()=>false);
export const MAC_DOWNLOAD='https://persistent.oaistatic.com/codex-app-prod/Codex.dmg';
export const MAC_SECURITY='x-apple.systempreferences:com.apple.preference.security?General';
const ids=new Set(['com.openai.codex','com.openai.chat','com.openai.chatgpt']);
export async function digestFile(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
export function assertMacUrl(url){const u=new URL(url);ensure(u.protocol==='https:'&&u.hostname==='persistent.oaistatic.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith('/codex-app-prod/'),'官方安装包地址不可信','MAC_SOURCE_INVALID',409);return u.href;}
export class MacManager{
  constructor({managerRoot,isolated=true,environment=process.env,platform=process.platform,arch=process.arch,home=homedir(),run=exec,fetcher=fetch,backup=async()=>null,audit}={}){
    Object.assign(this,{isolated,environment,platform,arch,home,run,fetcher,backup,audit});
    this.root=join(managerRoot,'MacComponents');this.file=join(this.root,'state.json');this.dmg=join(this.root,'Codex.dmg');
    this.zh=join(home,'Applications','777 Codex 中文.app');this.state={phase:'idle',message:'请先检查版本或下载官方安装包',events:[]};this.worker=null;this.loaded=false;
  }
  async load(){if(this.loaded)return;this.loaded=true;try{this.state=JSON.parse(await readFile(this.file,'utf8'));if(!['idle','complete','ready','error'].includes(this.state.phase))Object.assign(this.state,{phase:'error',message:'上次任务中断，请重新检查或下载；已有应用和用户数据保留'});}catch(e){if(e.code!=='ENOENT')this.state={phase:'error',message:'任务记录无法读取，请重新检查',events:[]};}}
  async save(){await mkdir(this.root,{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify(this.state));await rename(this.file+'.tmp',this.file);}
  async status(){await this.load();return {ok:true,...this.state,busy:!!this.worker,isolated:this.isolated,architecture:this.arch,packagePath:this.dmg,packageExists:await exists(this.dmg),zhInstalled:await exists(join(this.zh,'Contents','Info.plist')),zhPath:this.zh,source:MAC_DOWNLOAD};}
  async report(phase,message){this.state={...this.state,phase,message,events:[...(this.state.events||[]).slice(-29),{at:new Date().toISOString(),message}]};await this.save();}
  async command(cmd,args,timeout=30000){try{return await this.run(cmd,args,{timeout,maxBuffer:4*1024*1024});}catch{throw new AppError(`${basename(cmd)} 执行未完成，请检查系统提示、权限或组件兼容性`,'MAC_COMMAND_FAILED',409);}}
  async bundle(path,{official=true,architecture=true}={}){
    ensure((await lstat(path)).isDirectory()&&!(await lstat(path)).isSymbolicLink(),'应用目录不能是链接','MAC_PATH_INVALID',409);
    const plist=join(path,'Contents','Info.plist');const value=async key=>(await this.command('/usr/bin/plutil',['-extract',key,'raw','-o','-',plist])).stdout.trim();
    const id=await value('CFBundleIdentifier'),exe=await value('CFBundleExecutable'),version=await value('CFBundleShortVersionString');
    ensure(ids.has(id)&&basename(exe)===exe&&exe!=='.'&&exe!=='..','不是可管理的官方 Codex 应用','MAC_APP_INVALID',409);
    const executable=join(path,'Contents','MacOS',exe);
    if(official){await this.command('/usr/bin/codesign',['--verify','--deep','--strict',path],120000);await this.command('/usr/sbin/spctl',['--assess','--type','execute',path],120000);}
    const arches=(await this.command('/usr/bin/lipo',['-archs',executable])).stdout.trim().split(/\s+/);
    if(architecture)ensure(arches.includes(this.arch==='x64'?'x86_64':'arm64'),`这个官方 Codex 安装包不支持当前 ${this.arch==='x64'?'Intel':'Apple'} 芯片，不能安装`,'MAC_ARCH_UNSUPPORTED',409);
    const minimum=await value('LSMinimumSystemVersion').catch(()=>null);
    if(minimum){const current=(await this.command('/usr/bin/sw_vers',['-productVersion'])).stdout.trim().split('.').map(Number),required=minimum.split('.').map(Number);for(let i=0;i<3;i++){if((current[i]||0)>(required[i]||0))break;ensure((current[i]||0)>=(required[i]||0),`Codex 需要 macOS ${minimum} 或更新版本`,'MAC_OS_UNSUPPORTED',409);}}
    return {path,version,id,executable,arches};
  }
  async selected(){return macCodexStatus(this.environment,{run:this.run,home:this.home});}
  async writableApp(path){
    const allowed=[join(this.home,'Applications','Codex.app'),join(this.home,'Applications','ChatGPT.app'),'/Applications/Codex.app','/Applications/ChatGPT.app',this.zh].map(p=>resolve(p));
    ensure(allowed.includes(resolve(path)),'只管理应用程序目录中的 Codex；自定义路径请手动处理','MAC_PATH_INVALID',409);
    await mkdir(dirname(path),{recursive:true});
    ensure(await realpath(dirname(path))===resolve(dirname(path)),'应用程序父目录为链接，停止修改','MAC_PATH_INVALID',409);
    if(await exists(path))ensure(!(await lstat(path)).isSymbolicLink(),'应用程序为链接，停止修改','MAC_PATH_INVALID',409);
    try{await access(dirname(path),constants.W_OK);}catch{throw new AppError('应用目录没有写入权限，请在访达授权或将应用移到个人 Applications 目录','MAC_PERMISSION',403);}
  }
  async mounted(task){
    const mount=await mkdtemp(join(this.root,'mount-'));let attached=false;
    try{await this.command('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,this.dmg],120000);attached=true;
      const apps=(await readdir(mount)).filter(n=>['Codex.app','ChatGPT.app'].includes(n));ensure(apps.length===1,'安装包中未找到唯一的 Codex 应用','MAC_PACKAGE_INVALID',409);
      return await task(join(mount,apps[0]));
    }finally{if(attached)await this.command('/usr/bin/hdiutil',['detach',mount],60000);}
  }
  async start(action){
    await this.load();ensure(this.platform==='darwin'&&!this.isolated,'隔离预览不修改本机，也不下载应用','ISOLATED_PREVIEW',403);
    ensure(!this.worker,'已有 Mac 任务正在执行，请稍候','MAC_BUSY',409);
    const actions={'check':()=>this.check(),'download':()=>this.download(),'install':()=>this.install(),'uninstall':()=>this.uninstall(),'zh-install':()=>this.localize(),'zh-launch':()=>this.launchZh(),'zh-remove':()=>this.removeZh(),'security':async()=>{await this.command('/usr/bin/open',[MAC_SECURITY]);await this.report('complete','已请求打开隐私与安全性；请自行确认“仍要打开”，程序不会代替安全授权');}};
    ensure(Object.hasOwn(actions,action),'未知 Mac 操作','INVALID_ACTION');
    this.worker=Promise.resolve().then(async()=>{await this.report('working','正在处理，请稍候');await actions[action]();await this.audit?.record({action:`mac:${action}`,outcome:'success'});}).catch(async error=>{await this.report('error',error instanceof AppError?error.message:'操作失败，原应用及用户数据保留，请检查磁盘空间与权限');await this.audit?.record({action:`mac:${action}`,outcome:'error',code:error.code||'MAC_FAILED'});}).finally(()=>{this.worker=null;});
    return {...await this.status(),busy:true};
  }
  async check(){
    await this.report('checking','正在检查官方来源');
    const r=await this.fetcher(assertMacUrl(MAC_DOWNLOAD),{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(20000)});
    ensure(r.ok,`官方来源暂不可用（HTTP ${r.status}），请稍后重试`,'MAC_DOWNLOAD_FAILED',502);
    this.state.size=Number(r.headers.get('content-length'))||null;
    await this.report('complete','官方来源可访问；版本与芯片在下载后通过应用签名和元数据确认');
  }
  async download(){
    await this.report('downloading','正在下载官方 Codex 安装包');this.state.bytes=0;
    const r=await this.fetcher(assertMacUrl(MAC_DOWNLOAD),{redirect:'error',signal:AbortSignal.timeout(20*60*1000)});
    ensure(r.ok,`下载失败（HTTP ${r.status}）`,'MAC_DOWNLOAD_FAILED',502);const expected=Number(r.headers.get('content-length'))||0;
    ensure(expected<3*1024**3,'安装包过大，停止下载','MAC_PACKAGE_INVALID',409);this.state.size=expected||null;
    const part=join(this.root,`download-${randomUUID()}.part`),file=await open(part,'wx');
    try{for await(const chunk of r.body){this.state.bytes+=chunk.length;ensure(this.state.bytes<=3*1024**3,'安装包超过大小限制','MAC_PACKAGE_INVALID',409);let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);ensure(bytesWritten>0,'安装包写入失败','MAC_DOWNLOAD_FAILED',500);offset+=bytesWritten;}}}finally{await file.close();}
    ensure(!expected||this.state.bytes===expected,'下载不完整，请重新下载','MAC_DOWNLOAD_INCOMPLETE',409);
    // Preserve any earlier package instead of overwriting it before validation.
    if(await exists(this.dmg))await rename(this.dmg,join(this.root,`previous-${randomUUID()}.dmg`));
    await rename(part,this.dmg);await this.report('verifying','下载完成，正在验证签名、系统和芯片');
    const info=await this.mounted(p=>this.bundle(p));
    this.state.version=info.version;this.state.sha256=await digestFile(this.dmg);
    await this.report('ready','已下载并验证，尚未安装。点击“安装 / 更新”完成安装');
  }
  async requirePackage(){ensure(this.state.sha256&&await exists(this.dmg)&&await digestFile(this.dmg)===this.state.sha256,'请先下载并验证官方安装包；缓存缺失或已改变','MAC_PACKAGE_INVALID',409);}
  async swap(stage,target){
    await this.writableApp(target);let previous=null;
    if(await exists(target)){previous=join(dirname(target),`.777-previous-${randomUUID()}.app`);await rename(target,previous);}
    try{await rename(stage,target);}catch(e){if(previous)await rename(previous,target);throw e;}
    if(previous)this.state.recoveryPath=previous;
  }
  async install(){
    await this.requirePackage();await this.report('installing','正在备份聊天记录并安装；不会删除 Key');
    const current=await this.selected();const target=current.installed?current.installDirectory:join(this.home,'Applications','Codex.app');
    await this.writableApp(target);if(current.installed){await this.bundle(target);ensure(!current.running,'请先结束对话并退出 Codex，再安装更新','MAC_APP_RUNNING',409);}
    await this.backup();
    await this.mounted(async source=>{const info=await this.bundle(source);const scratch=await mkdtemp(join(dirname(target),'.777-install-'));const stage=join(scratch,'Codex.app');
      await this.command('/usr/bin/ditto',[source,stage],20*60*1000);await this.bundle(stage);await this.swap(stage,target);this.state.version=info.version;});
    this.state.installedPath=target;await this.report('complete','安装完成。旧版应用保留为恢复副本；可返回首页启动 Codex');
  }
  async uninstall(){
    const current=await this.selected();ensure(current.installed,'未检测到 Codex 应用','MAC_CODEX_MISSING',404);
    await this.writableApp(current.installDirectory);await this.bundle(current.installDirectory,{architecture:false});
    ensure(!current.running,'请先保存工作并退出 Codex，再卸载','MAC_APP_RUNNING',409);
    await this.report('uninstalling','正在备份聊天记录');await this.backup();
    const recovery=join(dirname(current.installDirectory),`.777-uninstalled-${randomUUID()}.app`);
    await this.report('uninstalling','正在移出应用位置，保留恢复副本');await rename(current.installDirectory,recovery);this.state.recoveryPath=recovery;
    ensure(!await exists(current.installDirectory),'卸载未完成，请重试','MAC_UNINSTALL_FAILED',409);
    await this.report('complete','所选 Codex 已卸载。聊天记录、Key 和其他应用未删除，原程序可从恢复副本找回');
  }
  async localize(){
    const current=await this.selected();ensure(current.installed,'请先安装官方 Codex','MAC_CODEX_MISSING',404);
    ensure(!current.running,'请先退出 Codex，再构建中文副本','MAC_APP_RUNNING',409);
    await this.bundle(current.installDirectory);await this.writableApp(this.zh);
    if(await exists(this.zh))ensure(!(await macCodexStatus({CODEX_DESKTOP_PATH:this.zh},{run:this.run,home:this.home})).running,'请先退出中文副本','MAC_APP_RUNNING',409);
    await this.report('localizing','正在复制官方应用；官方文件不会修改');
    const scratch=await mkdtemp(join(dirname(this.zh),'.777-zh-')),stage=join(scratch,'777 Codex 中文.app');
    await this.command('/usr/bin/ditto',[current.installDirectory,stage],20*60*1000);
    const asar=join(stage,'Contents','Resources','app.asar');ensure(!(await lstat(asar)).isSymbolicLink(),'汉化资源是链接，停止修改','MAC_PATH_INVALID',409);
    ensure((await stat(asar)).size<=512*1024*1024,'汉化资源过大，当前不支持','MAC_ZH_INCOMPATIBLE',409);
    const patched=patchMacI18n(await readFile(asar));await writeFile(asar,patched.buffer);
    const plist=join(stage,'Contents','Info.plist');
    await this.command('/usr/bin/plutil',['-replace','ElectronAsarIntegrity','-json',JSON.stringify({'Resources/app.asar':{algorithm:'SHA256',hash:patched.headerHash}}),plist]);
    await this.command('/usr/bin/plutil',['-replace','CFBundleDisplayName','-string','777 Codex 中文',plist]);
    await this.report('localizing','正在为独立中文副本建立本地签名；它不是 Apple 公证应用');
    await this.command('/usr/bin/codesign',['--force','--deep','--preserve-metadata=entitlements,flags,runtime','--sign','-',stage],5*60*1000);
    await this.command('/usr/bin/codesign',['--verify','--deep','--strict',stage],120000);
    await this.swap(stage,this.zh);this.state.zhVersion=current.version;
    await this.report('complete','中文副本已构建，请点击“启动中文版”，在应用语言设置选择简体中文。首次打开可能需要系统安全确认');
  }
  async launchZh(){
    ensure(await exists(this.zh),'请先构建中文副本','MAC_ZH_MISSING',404);
    const current=await this.selected(),zh=await this.bundle(this.zh,{official:false});
    ensure(current.version===zh.version,'官方版本已更新，请重新构建中文副本','MAC_ZH_STALE',409);
    ensure(!current.running,'请先退出官方 Codex，避免两个副本同时打开','MAC_APP_RUNNING',409);
    await this.command('/usr/bin/open',['-a',this.zh,'--args','--lang=zh-CN']);await this.report('complete','已请求系统打开中文版；若被拦截，请使用“打开安全设置”确认');
  }
  async removeZh(){await this.writableApp(this.zh);ensure(await exists(this.zh),'没有中文副本','MAC_ZH_MISSING',404);const s=await macCodexStatus({CODEX_DESKTOP_PATH:this.zh},{run:this.run,home:this.home});ensure(!s.running,'请先退出中文副本','MAC_APP_RUNNING',409);const recovery=join(dirname(this.zh),`.777-zh-removed-${randomUUID()}.app`);await rename(this.zh,recovery);this.state.recoveryPath=recovery;await this.report('complete','中文副本已移除，官方应用和用户数据保留');}
}
