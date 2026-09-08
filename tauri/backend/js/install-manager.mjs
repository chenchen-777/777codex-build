import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

export const INSTALL_SOURCES = [
  {id:'mirror', name:'Codex 镜像', base:'https://codexapp.agentsmirror.com', kind:'mirror-v3'},
  {id:'official', name:'OpenAI 官方包', base:'https://codexapp.agentsmirror.com', kind:'official-msix', packageUrl:'https://persistent.oaistatic.com/codex-app-prod/ChatGPT-x64.msix'},
];
const busyStates = ['planning','downloading','verifying','installing'];
const exists = async p => access(p).then(()=>true,()=>false);
async function fetchText(url) {
  let response;
  for(let redirects=0;redirects<6;redirects++) {
    const endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new AppError('下载来源必须使用 HTTPS','SOURCE_INVALID',400);
    response=await fetch(endpoint,{signal:AbortSignal.timeout(25_000),redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),endpoint).href;continue;}
    break;
  }
  if (!response.ok) throw new AppError(`版本来源请求失败：HTTP ${response.status}`, 'SOURCE_UNAVAILABLE', 502);
  let text=''; for await (const chunk of response.body) {text+=Buffer.from(chunk).toString('utf8');if(text.length>2_000_000)throw new AppError('版本清单过大','SOURCE_INVALID',502);}
  return text;
}

export class InstallManager {
  constructor({managerRoot, engine, isolated=false, fetchSource=fetchText, installMsix, backup, audit, sources=INSTALL_SOURCES}) {
    Object.assign(this,{managerRoot,engine,isolated,fetchSource,installMsix,backup,audit,sources});
    this.root=join(managerRoot,'CodexInstaller'); this.cache=join(this.root,'Cache'); this.portableRoot=join(this.root,'Portable','Codex');
    this.file=join(this.root,'state.json'); this.targetFile=join(this.root,'target.json');
    this.state={phase:'idle'}; this.worker=null; this.loaded=false; this.stopIntent=null;
  }
  async load() {
    if(this.loaded)return; this.loaded=true;
    try { this.state=JSON.parse(await readFile(this.file,'utf8')); } catch(error) { if(error.code!=='ENOENT')this.state={phase:'error',message:'安装任务记录损坏，请重新检查版本'}; }
    if(busyStates.includes(this.state.phase)) {this.state.phase='interrupted';this.state.message='上次任务中断；请重新校验缓存后继续，安装结果需重新检测';}
  }
  async persist() {await mkdir(this.root,{recursive:true}); const temp=this.file+'.tmp';await writeFile(temp,JSON.stringify(this.state,null,2));await rename(temp,this.file);}
  async status() {
    await this.load();
    const packagePath=/^[a-f0-9]{64}$/.test(this.state.plan?.sha256||'')?this.packagePath():null;
    const packageExists=packagePath?await stat(packagePath).then(s=>s.isFile(),()=>false):false;
    return {ok:true,...this.state,cacheDirectory:this.cache,packagePath,packageExists,isolated:this.isolated,sources:this.sources.map(({id,name,kind})=>({id,name,kind})),busy:busyStates.includes(this.state.phase)};
  }
  assertLive() {if(this.isolated)throw new AppError('隔离预览不执行真实安装或联网下载','ISOLATED_PREVIEW',403);}
  assertIdle() {if(this.worker||busyStates.includes(this.state.phase))throw new AppError('安装任务正在进行','INSTALL_BUSY',409);}
  async target() {try{return JSON.parse(await readFile(this.targetFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new AppError('安装目标记录损坏','INSTALL_TARGET_INVALID',409);}}
  async saveTarget(installed) {if(!installed?.path)throw new AppError('安装后未检测到目标','INSTALL_UNCONFIRMED',502);await mkdir(this.root,{recursive:true});await writeFile(this.targetFile+'.tmp',JSON.stringify(installed,null,2));await rename(this.targetFile+'.tmp',this.targetFile);return installed;}
  async removePortable(onProgress = () => {}) {
    this.assertLive();await this.load();this.assertIdle();const target=await this.target();
    if(target?.source!=='portable'||target.path.toLowerCase()!==this.portableRoot.toLowerCase())throw new AppError('仅支持卸载本工具创建的便携安装；接管的外部目录需要手动管理','PORTABLE_REMOVE_UNSUPPORTED',409);
    onProgress('stopping');
    await this.engine.call('close-portable',{portableRoot:this.portableRoot});
    if(this.backup){onProgress('backup');await this.backup();}
    onProgress('removing');
    const removed=join(this.root,'Portable',`Removed-${randomUUID()}`);await rename(this.portableRoot,removed);
    await rm(this.targetFile,{force:true});this.state.phase='ready';this.state.message='便携版已卸载，原程序目录已保留为恢复副本';await this.persist();
    onProgress('verifying');
    if(await this.target())throw new AppError('便携卸载后目标仍存在','CODEX_UNINSTALL_UNCONFIRMED',502);
    return {ok:true,uninstalled:true,backup:{program:removed},codexDataPreserved:true};
  }
  async adopt(path) {this.assertLive();await this.load();this.assertIdle();const r=await this.engine.call(path?'adopt':'detect',path?{path}:{portableRoot:this.portableRoot});return {ok:true,installed:await this.saveTarget(r.installed)};}
  async plan(sourceId='mirror',route='msix') {
    this.assertLive();await this.load();this.assertIdle();
    const source=this.sources.find(s=>s.id===sourceId);
    if(!source||!['msix','portable'].includes(route))throw new AppError('请选择有效来源和安装方式','INVALID_INSTALL_PLAN',400);
    this.state={phase:'planning'};
    try {
      const [manifest,checksums]=await Promise.all([this.fetchSource(source.base+'/latest/manifest'),this.fetchSource(source.base+'/latest/checksums')]);
      const {release,sha256,downloadArchitecture}=await this.engine.call('plan',{manifest,checksums});
      if(!/^[a-f0-9]{64}$/i.test(sha256)||!/^OpenAI\.Codex_[\d.]+_(x64|arm64)__[a-z0-9]+$/i.test(release.packageMoniker))throw new AppError('版本清单缺少有效包身份或摘要','SOURCE_INVALID',502);
      if(source.kind==='official-msix'&&release.architecture!=='x64')throw new AppError('此官方直链只支持 x64','SOURCE_ARCH_UNAVAILABLE',409);
      const size=release.contentLength;
      if(!Number.isSafeInteger(size)||size<=0||size>4*1024**3)throw new AppError('版本清单下载长度无效','SOURCE_INVALID',502);
      const plan={id:randomUUID(),sourceId,sourceName:source.name,route,version:release.version,packageVersion:release.packageVersion,architecture:release.architecture,packageMoniker:release.packageMoniker,size,sha256:sha256.toLowerCase(),url:source.packageUrl||`${source.base}/latest/win${downloadArchitecture?'-'+downloadArchitecture:''}`};
      this.state={phase:'planned',plan,bytes:0,message:source.kind==='official-msix'?'官方包使用镜像版本元数据校验；若版本不同会拒绝安装':'版本已确认，点击下载'};
      await this.persist();return this.status();
    }catch(e){this.state={phase:'error',message:e.message,code:e.code};await this.persist();throw e;}
  }
  packagePath() {const hash=this.state.plan?.sha256;if(!/^[a-f0-9]{64}$/.test(hash||''))throw new AppError('请先检查可用版本','INSTALL_PLAN_REQUIRED',409);return join(this.cache,hash+'.msix');}
  verifyParams() {const p=this.state.plan;return {path:this.packagePath(),sha256:p.sha256,size:p.size,packageVersion:p.packageVersion,architecture:p.architecture};}
  async startDownload() {
    this.assertLive();await this.load();this.assertIdle();const path=this.packagePath();await mkdir(this.cache,{recursive:true});
    this.stopIntent=null;delete this.state.code;this.state.phase='downloading';this.state.message='正在下载';await this.persist();
    this.worker=this.download(path).catch(async error=>{this.state.phase=this.stopIntent==='pause'?'paused':this.stopIntent==='cancel'?'cancelled':'error';this.state.message=this.stopIntent==='pause'?'已暂停，可继续下载':this.stopIntent==='cancel'?'已取消下载':error.message;this.state.code=error.code;await this.persist();}).finally(()=>{this.worker=null;});
    return this.status();
  }
  async download(path) {
    let cached=false;
    if(await exists(path)) {
      this.state.phase='verifying';
      try {await this.engine.call('verify',this.verifyParams());cached=true;}
      catch {await rm(path,{force:true});}
    }
    if(!cached) {
      if(this.stopIntent)throw new Error('下载已暂停或取消');
      const space=await statfs(this.cache);if(space.bavail*space.bsize < this.state.plan.size+50*1024**2)throw new AppError('缓存磁盘空间不足','INSUFFICIENT_SPACE',409);
      this.state.phase='downloading';
      await this.engine.call('download',{url:this.state.plan.url,path,size:this.state.plan.size},bytes=>{this.state.bytes=Math.max(0,Number(bytes)||0);if(this.stopIntent)this.engine.control(this.stopIntent);});
      if(this.stopIntent){if(this.stopIntent==='cancel')await rm(path,{force:true});throw new Error('下载已暂停或取消');}
      this.state.phase='verifying';this.state.message='正在校验包签名、版本和完整性';
      try{await this.engine.call('verify',this.verifyParams());}catch(e){await rm(path,{force:true});throw e;}
    }
    this.state.phase='ready';this.state.bytes=this.state.plan.size;this.state.cached=cached;this.state.message=cached?'已复用并重新校验缓存':'下载及校验完成，可以安装';await this.persist();
  }
  async control(action) {
    this.assertLive();await this.load();
    if(!['pause','cancel','resume','clear-cache'].includes(action))throw new AppError('无效下载操作','INVALID_INSTALL_ACTION',400);
    if(action==='resume')return this.startDownload();
    if(action==='clear-cache') {this.assertIdle();const path=this.packagePath();await rm(path,{force:true});await rm(path+'.part',{force:true});this.state.phase='planned';this.state.bytes=0;await this.persist();return this.status();}
    if(this.state.phase==='installing'||this.state.phase==='verifying')throw new AppError('校验或安装正在提交，请等待结果','INSTALL_COMMITTING',409);
    if(this.worker){this.stopIntent=action;this.engine.control(action);return this.status();}
    this.assertIdle();if(action==='cancel'&&this.state.plan)await rm(this.packagePath()+'.part',{force:true});
    this.state.phase=action==='cancel'?'cancelled':'paused';await this.persist();return this.status();
  }
  async install() {
    this.assertLive();await this.load();this.assertIdle();if(this.state.phase!=='ready')throw new AppError('请先完成下载校验','INSTALL_NOT_READY',409);
    this.state.phase='installing';this.state.message='正在安装，请等待';await this.persist();
    this.worker=this.commit().catch(async error=>{this.state.phase='error';this.state.message=error.message;this.state.code=error.code;await this.persist();}).finally(()=>{this.worker=null;});return this.status();
  }
  async commit() {
    await this.engine.call('verify',this.verifyParams());
    const space=await statfs(this.root);if(space.bavail*space.bsize < this.state.plan.size*4)throw new AppError('安装磁盘可用空间不足','INSUFFICIENT_SPACE',409);
    if(this.backup)await this.backup();
    let installed;
    if(this.state.plan.route==='portable') {const r=await this.engine.call('portable-install',{...this.verifyParams(),portableRoot:this.portableRoot});installed=r.installed;}
    else {
      const preflight=await this.engine.call('preflight',{path:this.packagePath()});
      if(preflight.dependencies?.missingFrameworks?.length)throw new AppError('MSIX 缺少依赖，请重新规划为便携安装','MSIX_DEPENDENCIES_MISSING',409);
      await this.installMsix(this.packagePath());
      const r=await this.engine.call('detect',{portableRoot:join(this.root,'AbsentProbe')});installed=r.installed;
      if(!installed||![this.state.plan.version,this.state.plan.packageVersion].includes(installed.version))throw new AppError('安装后版本不匹配，请检测现有安装','INSTALL_UNCONFIRMED',502);
    }
    await this.saveTarget(installed);this.state.phase='complete';this.state.message='安装完成，可在首页选择 Key 后启动';this.state.installed=installed;await this.persist();
    await this.audit?.record({action:'codex-install:complete',outcome:'success'});
  }
}
