import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,open,link,unlink,rm} from 'node:fs/promises';
import {join} from 'node:path';

// Audited public-beta assets: never accept a URL, architecture or digest from UI input.
// A platform release change fails closed until this catalog is reviewed again.
export const SHARE_RELEASES=Object.freeze([
 {id:'manager-windows',label:'Windows',platform:'windows',arch:'x64',version:'1.0',assetId:552852109,filename:'Windows-Beta-1.0.zip',sizeBytes:83160536,sha256:'c7bd341d9d320577d2adfd49a4da3cef817442dec7b79401381bfd9fae25eb33'},
 {id:'manager-macos-arm64',label:'Mac Apple 芯片',platform:'mac',arch:'arm64',version:'1.0',assetId:552857731,filename:'Mac-Apple-Beta-1.0.zip',sizeBytes:56923271,sha256:'be5c1d456e280444d14da6d56b9261bd8072102b746502456fd9c1bf4d3a7edb'},
 {id:'manager-macos-x64',label:'Mac Intel',platform:'mac',arch:'x64',version:'1.0',assetId:552867610,filename:'Mac-Intel-Beta-1.0.zip',sizeBytes:58459503,sha256:'fa43fe0f34cc14fba26631ed3711213d968cd8313462fef6a42f192f95bd97ec'}
].map(Object.freeze));
const PAGE='https://www.777codes.codes/download/777codex',PREFIX='https://github.com/chenchen-777/777codex-build/releases/download/public-beta-1.0/';
const assetURL=r=>`https://api.github.com/repos/chenchen-777/777codex-build/releases/assets/${r.assetId}?download=1`;
const error=(message,code='SHARE_DOWNLOAD_FAILED')=>Object.assign(new Error(message),{code,status:409});
const checkCancel=c=>{if(c())throw error('已取消下载，未完成的文件已清理','TASK_CANCELLED');};
export function allowedReleaseURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw error('下载地址不受信任','SHARE_SOURCE_INVALID');if(!(u.href.startsWith(PREFIX)||SHARE_RELEASES.some(r=>u.href===assetURL(r))||u.hostname==='release-assets.githubusercontent.com'))throw error('下载跳转地址不受信任','SHARE_SOURCE_INVALID');return u.href;}
export async function verifiedFile(path,release,cancelled=()=>false){const st=await lstat(path).catch(()=>null);if(!st?.isFile()||st.isSymbolicLink()||st.size!==release.sizeBytes)return false;const h=createHash('sha256');for await(const b of createReadStream(path)){checkCancel(cancelled);h.update(b);}return h.digest('hex')===release.sha256;}
export function downloadError(e){const code=String(e.cause?.code||e.code||e.name||'');if(['ENOSPC','EDQUOT'].includes(code))return error('保存位置空间不足，请清理空间或更换位置','SHARE_DISK_FULL');if(['EACCES','EPERM'].includes(code))return error('没有写入下载目录的权限，请选择可写目录','SHARE_WRITE_DENIED');if(/CERT|TLS|SSL/.test(code))return error('无法验证下载服务器的安全连接，请检查系统时间和网络','SHARE_TLS_ERROR');if(/TIMEOUT|Timeout|Abort/.test(code))return error('连接下载服务器超时，请稍后重新生成','SHARE_NETWORK_TIMEOUT');if(/ECONNRESET|UND_ERR_SOCKET/.test(code))return error('下载连接被网络重置，请稍后重新生成','SHARE_NETWORK_RESET');if(/ENOTFOUND|EAI_AGAIN/.test(code))return error('无法解析下载服务器地址，请检查网络或 DNS','SHARE_NETWORK_DNS');return error('无法连接官方安装包下载服务，请稍后重新生成','SHARE_NETWORK_UNAVAILABLE');}
async function consume(url,{fetchImpl=fetch,cancelled=()=>false,onChunk,headers={},allow=allowedReleaseURL,idleMs=60000}={}){
 const controller=new AbortController();let timer,interval;const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),idleMs);};
 reset();interval=setInterval(()=>{if(cancelled())controller.abort();},100);
 try{for(let hop=0;hop<6;hop++){checkCancel(cancelled);url=allow(url);const r=await fetchImpl(url,{headers,redirect:'manual',signal:controller.signal});reset();if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw error('下载地址已失效');url=new URL(next,url).href;continue;}if(!r.ok){await r.body?.cancel();throw error(r.status===429?'下载服务繁忙，请稍后重试':r.status===404?'发布包暂不可用，请稍后重试':'无法获取安装包，请检查网络后重试');}if(r.headers.get('content-type')?.includes('application/json')){await r.body?.cancel();throw error('下载服务未返回安装包，请稍后重试','SHARE_DOWNLOAD_METADATA');}if(!r.body)throw error('下载服务未返回文件');for await(const chunk of r.body){checkCancel(cancelled);reset();await onChunk(chunk);}return;}throw error('下载跳转次数过多');}catch(e){checkCancel(cancelled);if(e.code?.startsWith('SHARE_'))throw e;throw downloadError(e);}finally{clearTimeout(timer);clearInterval(interval);controller.abort();}
}
export class ShareReleaseSource{
 constructor({cacheRoot,fetchImpl=fetch,releases=SHARE_RELEASES}={}){this.cacheRoot=cacheRoot;this.fetchImpl=fetchImpl;this.releases=releases;}
 async catalog(){let body='',bytes=0;await consume(PAGE,{fetchImpl:this.fetchImpl,allow:u=>{if(u!==PAGE)throw error('平台校验地址异常');return u;},onChunk:b=>{bytes+=b.length;if(bytes>256*1024)throw error('平台校验响应过大');body+=Buffer.from(b).toString('utf8');}});return this.releases.map(r=>({...r,available:body.includes(r.sha256)&&body.includes(String(r.sizeBytes)),message:body.includes(r.sha256)&&body.includes(String(r.sizeBytes))?'已与官网公测包核对':'官网版本已变化，请更新管理工具后重试'}));}
 async release(id){const r=(await this.catalog()).find(r=>r.id===id);if(!r)throw error('请选择 Windows、Mac Apple 芯片或 Mac Intel','SHARE_PLATFORM_REQUIRED');if(!r.available)throw error(r.message,'SHARE_TRUST_UNAVAILABLE');return r;}
 async acquire(release,progress=()=>{},cancelled=()=>false){
  checkCancel(cancelled);await mkdir(this.cacheRoot,{recursive:true});const st=await lstat(this.cacheRoot);if(!st.isDirectory()||st.isSymbolicLink())throw error('下载缓存目录不可用');
  const final=join(this.cacheRoot,release.sha256+'.zip');if(await verifiedFile(final,release,cancelled)){progress('cached',12,{message:'已找到并校验缓存，无需重新下载',downloadedBytes:release.sizeBytes,totalBytes:release.sizeBytes});return final;}
  // Do not overwrite an unexpected existing cache object.
  if(await lstat(final).catch(()=>null))throw error('缓存校验失败，请选择新的缓存目录或联系支持','SHARE_CACHE_INVALID');
  const partial=join(this.cacheRoot,release.sha256+'.'+randomUUID()+'.partial');const fd=await open(partial,'wx',0o600);let bytes=0;const hash=createHash('sha256');
  try{progress('downloading',1,{message:'正在下载 '+release.label+' 公测版',downloadedBytes:0,totalBytes:release.sizeBytes});await consume(assetURL(release),{fetchImpl:this.fetchImpl,headers:{Accept:'application/octet-stream','User-Agent':'777codes-manager'},cancelled,onChunk:async b=>{bytes+=b.length;if(bytes>release.sizeBytes)throw error('下载文件超过官方大小','SHARE_BASE_HASH_MISMATCH');hash.update(b);await fd.writeFile(b);progress('downloading',Math.min(12,Math.floor(bytes/release.sizeBytes*12)),{message:'正在下载安装包',downloadedBytes:bytes,totalBytes:release.sizeBytes});}});if(bytes!==release.sizeBytes||hash.digest('hex')!==release.sha256)throw error('安装包校验失败，已丢弃，请重试','SHARE_BASE_HASH_MISMATCH');await fd.close();checkCancel(cancelled);try{await link(partial,final);}catch(e){if(e.code!=='EEXIST'||!await verifiedFile(final,release,cancelled))throw e;}await unlink(partial);return final;}finally{await fd.close().catch(()=>{});await rm(partial,{force:true}).catch(()=>{});}
 }
}
