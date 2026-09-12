import {createHash} from 'node:crypto';
import {access,chmod,cp,lstat,mkdir,readFile,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

const planPath=process.argv[2];
const exists=path=>access(path).then(()=>true,()=>false);
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const atomic=async(path,value)=>{const temp=`${path}.${process.pid}.new`;await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);};
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
function child(root,path){const rel=relative(resolve(root),resolve(path));return rel&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);}
function safeRelative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||value.includes(':'))throw Error('unsafe inventory path');const parts=value.split('/');if(parts.some(p=>!p||p==='.'||p==='..'))throw Error('unsafe inventory path');return value;}
async function alive(pid){try{process.kill(pid,0);return true}catch{return false}}
function processExecutable(pid){const result=spawnSync('/bin/ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'});return result.status===0?result.stdout.trim():'';}
function run(file,args,options={}){const result=spawnSync(file,args,{encoding:'utf8',maxBuffer:8*1024*1024,...options});if(result.error||result.status!==0)throw Error(`${basename(file)} failed`);return result;}
async function inventory(root){const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw Error('link or special file rejected');if(info.isDirectory())await walk(path);else files.push(path);}}await walk(root);return files;}

let plan,updates,stage,resultPath,journal,newApp,siblingNew,siblingOld,processesGone=false,installed=false;
try{
 plan=JSON.parse(await readFile(planPath,'utf8'));
 if(plan.schemaVersion!==2||plan.product!=='777codex-tauri'||plan.platform!=='darwin'||!['arm64','x64'].includes(plan.arch)||!isAbsolute(plan.archivePath)||!isAbsolute(plan.installRoot)||!isAbsolute(plan.managerRoot)||plan.targetRevision<=plan.currentRevision)throw Error('invalid update plan');
 const install=resolve(plan.installRoot),manager=resolve(plan.managerRoot);if(install===manager||child(install,manager)||child(manager,install)||!install.endsWith('.app'))throw Error('unsafe update roots');
 updates=join(manager,'Updates');await mkdir(updates,{recursive:true});resultPath=join(updates,'last-update-result.json');journal=join(updates,'apply-journal.json');stage=join(updates,`stage-${process.pid}-${Date.now()}`);await mkdir(stage);
 const archive=await stat(plan.archivePath);if(archive.size!==plan.archiveBytes||await digest(plan.archivePath)!==plan.archiveSha256)throw Error('archive changed before apply');
 const wanted=new Map();for(const file of plan.packageFiles){const rel=safeRelative(file.path),key=rel.toLowerCase();if(wanted.has(key)||!Number.isInteger(file.mode)||file.mode<0||file.mode>0o777)throw Error('invalid inventory');wanted.set(key,{...file,path:rel});}
 run('/usr/bin/ditto',['-x','-k','--noextattr','--norsrc',plan.archivePath,stage]);
 const actual=await inventory(stage);if(actual.length!==wanted.size)throw Error('archive inventory mismatch');
 for(const path of actual){const rel=relative(stage,path).split(sep).join('/'),item=wanted.get(rel.toLowerCase());if(!item||rel!==item.path)throw Error('archive inventory mismatch');const info=await stat(path);if(info.size!==item.bytes||await digest(path)!==item.sha256.toLowerCase())throw Error('payload verification failed');await chmod(path,item.mode);}
 const roots=await readdir(stage,{withFileTypes:true});const apps=roots.filter(e=>e.isDirectory()&&e.name.endsWith('.app'));if(apps.length!==1)throw Error('archive must contain exactly one app');newApp=join(stage,apps[0].name);
 run('/usr/bin/codesign',['--verify','--deep','--strict',newApp]);
 for(const [pid,expected] of [[plan.parentPid,plan.executable],[plan.sidecarPid,plan.sidecarExecutable]]){if(await alive(pid)&&resolve(processExecutable(pid))!==resolve(expected))throw Error('process identity changed; update refused');}
 const deadline=Date.now()+60_000;while(await alive(plan.parentPid)||await alive(plan.sidecarPid)){if(Date.now()>deadline)throw Error('application processes did not exit');await sleep(250);}processesGone=true;
 const parent=dirname(install),token=`r${plan.currentRevision}-to-r${plan.targetRevision}-${Date.now()}`;siblingNew=join(parent,`.777codex-update-new-${token}.app`);siblingOld=join(parent,`.777codex-update-old-${token}.app`);
 await atomic(journal,{state:'prepared',install,newApp,siblingNew,siblingOld,targetRevision:plan.targetRevision});
 await cp(newApp,siblingNew,{recursive:true,errorOnExist:true,preserveTimestamps:true});run('/usr/bin/codesign',['--verify','--deep','--strict',siblingNew]);
 await rename(install,siblingOld);await atomic(journal,{state:'old-moved',install,siblingNew,siblingOld,targetRevision:plan.targetRevision});
 await rename(siblingNew,install);installed=true;run('/usr/bin/codesign',['--verify','--deep','--strict',install]);
 const backup=join(updates,'backups',token+'.app');await mkdir(dirname(backup),{recursive:true});await cp(siblingOld,backup,{recursive:true,preserveTimestamps:true});
 await rm(siblingOld,{recursive:true});await atomic(journal,{state:'committed',install,backup,targetRevision:plan.targetRevision});
 await atomic(resultPath,{status:'success',targetRevision:plan.targetRevision,time:new Date().toISOString()});
}catch(error){
 try{if(installed&&siblingOld&&await exists(siblingOld)){await rm(plan.installRoot,{recursive:true});await rename(siblingOld,plan.installRoot);}else if(siblingOld&&await exists(siblingOld)&&!await exists(plan.installRoot))await rename(siblingOld,plan.installRoot);}catch{}
 if(resultPath)await atomic(resultPath,{status:'error',code:'UPDATE_APPLY_FAILED',message:String(error?.message||error),time:new Date().toISOString()}).catch(()=>{});
 process.exitCode=1;
}finally{
 if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});
 if(processesGone&&process.exitCode!==1&&plan?.executable){const childProcess=spawn('/usr/bin/open',['-a',plan.installRoot],{detached:true,stdio:'ignore'});childProcess.unref();}
}
