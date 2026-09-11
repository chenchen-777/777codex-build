import {mkdir,writeFile} from 'node:fs/promises';import{randomUUID}from'node:crypto';import{dirname,join}from'node:path';import{pathToFileURL}from'node:url';
import{AppError}from'../js/errors.mjs';import{ToolDoctorManager,doctorErrorKind}from'../js/tool-doctor-manager.mjs';import{SharePackageManager}from'../js/share-package-manager.mjs';
import{ShareReleaseSource}from'../js/share-release-source.mjs';
const mutating=new Set(['apply','repair','rollback','recover']);
function redact(v){if(Array.isArray(v))return v.map(redact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!/(api.?key|token|authorization|secret|verifier|auth)/i.test(k)).map(([k,x])=>[k,redact(x)]));if(typeof v==='string')return v.replace(/(?:sk|sess|eyJ)[-_A-Za-z0-9.]{12,}/g,'[REDACTED]').slice(0,4000);return v;}
export function createWindowsApi({projectRoot,codexRoot,managerRoot,isolated,audit,readBody,sendJson,requireTrusted,accountManager,adapters}){
 const engine=join(projectRoot,'components','tool-doctor','src','engine.mjs');async function targets(){if(isolated)return[];const m=await import(pathToFileURL(join(projectRoot,'components','tool-doctor','src','binaries.mjs')).href);return m.discoverBinaries();}
 const releaseSource=new ShareReleaseSource({cacheRoot:join(managerRoot,'share-downloads')});
 const doctor=new ToolDoctorManager({engine,isolated,audit,allowedTarget:async({home,binary})=>home.toLowerCase()===codexRoot.toLowerCase()&&(await targets()).some(x=>x.path.toLowerCase()===binary.toLowerCase())}),sharing=new SharePackageManager({releaseSource,trustedRelease:async()=>{const r=await accountManager.referral();return{sha256:r.installer?.sha256,sizeBytes:r.installer?.sizeBytes,shareUrl:r.shareUrl};}}),jobs=new Map();
 async function saveReport(j,report){const path=join(managerRoot,'reports',`tool-doctor-${j.id}.json`);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(redact(report),null,2));j.report=redact(report);j.reportPath=path;}
 function start(body){
  if([...jobs.values()].some(j=>j.state==='running'))throw new AppError('工具修复任务正在执行','OPERATION_BUSY',409);
  const id=randomUUID(),command=String(body.command||'inspect'),j={id,command,state:'running',phase:'queued',progress:0,cancelRequested:false,transactional:mutating.has(command),startedAt:new Date().toISOString()};jobs.set(id,j);
  Promise.resolve().then(async()=>{
   if(j.cancelRequested)throw new AppError('任务在执行前取消','TASK_CANCELLED',409);
   j.phase='running';j.progress=10;
   const result=await doctor.run(body,message=>{j.message=redact(message);j.progress=Math.min(90,j.progress+5);});
   j.phase='saving-report';await saveReport(j,{...result,createdAt:new Date().toISOString()});
   const samples=result.result?.samples,passed=samples?.filter(s=>s.result==='pass').length;
   const message=samples?`检测完成：${passed}/${samples.length} 项通过。${passed===samples.length?'本次未发现需要此补丁修复的问题。':'请查看报告中的失败项目；检测完成不代表修复成功。'}`:'操作完成，请查看检查报告。';
   Object.assign(j,{state:j.cancelRequested?'cancelled':'completed',phase:j.cancelRequested?'cancelled':'completed',progress:100,message:j.cancelRequested?'已等待安全事务边界后停止。':message,completedAt:new Date().toISOString()});
  }).catch(async e=>{
   const safe=redact(doctorErrorKind(e));
   try{await saveReport(j,{ok:false,command,error:safe,diagnostic:e.diagnostic,createdAt:new Date().toISOString()});}catch{safe.message+=' 检查报告保存失败。';}
   Object.assign(j,{state:e.code==='TASK_CANCELLED'?'cancelled':'failed',phase:e.code==='TASK_CANCELLED'?'cancelled':'failed',message:'',error:safe,completedAt:new Date().toISOString()});
  });return{ok:true,task:{...j,report:undefined}};
 }
 const get=(map,id,label)=>{const j=map.get(String(id||''));if(!j)throw new AppError(`${label}任务不存在`,'TASK_NOT_FOUND',404);return j;};
 const api=async(req,res,path)=>{const query=()=>new URL(req.url,'http://local').searchParams.get('id');
  if(path==='/api/account/open-platform'&&req.method==='POST'){requireTrusted(req);await readBody(req);if(isolated)throw new AppError('隔离模式不打开外部网页','ISOLATED_PREVIEW',403);await adapters().openExternal('https://www.777codes.codes');sendJson(res,200,{ok:true});return true;}
  if(path==='/api/logs/export'&&req.method==='POST'){requireTrusted(req);await readBody(req);const result=await audit.list({limit:1000}),folder=join(managerRoot,'reports'),reportPath=join(folder,`operations-${Date.now()}-${randomUUID()}.jsonl`);await mkdir(folder,{recursive:true});await writeFile(reportPath,result.entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n',{encoding:'utf8',flag:'wx'});sendJson(res,201,{ok:true,path:reportPath,folder,count:result.entries.length});return true;}
  if(path==='/api/logs/export/open'&&req.method==='POST'){requireTrusted(req);await readBody(req);if(isolated)throw new AppError('隔离模式不打开本机目录','ISOLATED_PREVIEW',403);const folder=join(managerRoot,'reports'),message=await adapters().openPath(folder);if(message)throw new AppError('无法打开日志报告目录','OPEN_PATH_FAILED',500);sendJson(res,200,{ok:true,path:folder});return true;}
  if(path==='/api/tool-doctor/targets'&&req.method==='GET'){sendJson(res,200,{ok:true,home:codexRoot,targets:(await targets()).map(x=>({path:x.path,source:x.source,version:x.version,sha256:x.sha256}))});return true;}
  if(path==='/api/tool-doctor/start'&&req.method==='POST'){requireTrusted(req);while(jobs.size>=20)jobs.delete(jobs.keys().next().value);sendJson(res,202,start(await readBody(req)));return true;}
  if(path==='/api/tool-doctor/status'&&req.method==='GET'){sendJson(res,200,{ok:true,task:{...get(jobs,query(),'工具修复'),report:undefined}});return true;}
  if(path==='/api/tool-doctor/cancel'&&req.method==='POST'){requireTrusted(req);const j=get(jobs,(await readBody(req)).id,'工具修复');if(j.state==='running'){j.cancelRequested=true;j.cancelPending=j.phase!=='queued';}sendJson(res,200,{ok:true,task:{...j,report:undefined},message:j.cancelPending?(j.transactional?'事务步骤不会中途终止；完成或安全回滚后停止。':'当前核心步骤结束后停止；不会强杀子进程。'):'已在执行前请求取消。'});return true;}
  if(path==='/api/tool-doctor/report'&&req.method==='GET'){const j=get(jobs,query(),'工具修复');if(!j.report)throw new AppError('脱敏报告尚未生成','REPORT_NOT_READY',409);sendJson(res,200,j.report);return true;}
  if(path==='/api/share-package/start'&&req.method==='POST'){requireTrusted(req);while(sharing.jobs.size>=20)sharing.jobs.delete(sharing.jobs.keys().next().value);const body=await readBody(req),referral=await accountManager.referral();sendJson(res,202,sharing.start({...body,shareUrl:referral.shareUrl}));return true;}
  if(path==='/api/share-package/releases'&&req.method==='GET'){sendJson(res,200,{ok:true,packages:await releaseSource.catalog()});return true;}
  if(path==='/api/share-package/status'&&req.method==='GET'){sendJson(res,200,sharing.status(query()));return true;}
  if(path==='/api/share-package/cancel'&&req.method==='POST'){requireTrusted(req);sendJson(res,200,sharing.cancel((await readBody(req)).id));return true;}
  if(path==='/api/share-package/choose-output'&&req.method==='POST'){requireTrusted(req);if(isolated)throw new AppError('隔离模式不打开系统目录选择器','ISOLATED_PREVIEW',403);sendJson(res,200,{ok:true,path:await adapters().chooseDirectory('选择分享安装包保存位置')});return true;}
  if(path==='/api/share-package/choose-base'&&req.method==='POST'){requireTrusted(req);if(isolated)throw new AppError('隔离模式不打开系统文件选择器','ISOLATED_PREVIEW',403);sendJson(res,200,{ok:true,path:await adapters().chooseZip()});return true;}
  if(path==='/api/share-package/open-output'&&req.method==='POST'){requireTrusted(req);if(isolated)throw new AppError('隔离模式不打开本机目录','ISOLATED_PREVIEW',403);const j=get(sharing.jobs,(await readBody(req)).id,'分享包');if(j.state!=='completed'||!j.path)throw new AppError('分享包尚未完成','REPORT_NOT_READY',409);const folder=dirname(j.path);await adapters().openPath(folder);sendJson(res,200,{ok:true,path:folder});return true;}
  if(path==='/api/windows/capabilities'&&req.method==='GET'){sendJson(res,200,{ok:true,toolDoctor:{version:'2.2.0',redistribution:'internal-trial-only'},sharePackage:{descriptorSigned:false,serverVerification:'share_url'}});return true;}return false;};
 api.getBusyOperation=()=>[...jobs.values()].find(j=>j.state==='running')||[...sharing.jobs.values()].find(j=>j.state==='running')||null;return api;
}
