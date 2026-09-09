// CI-only integration on a disposable runner. Never log in or read user Keys.
import {mkdtemp,realpath,access,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {MacManager} from '../backend/js/mac-manager.mjs';
import {macCodexStatus,stopMacCodex} from '../backend/js/macos-runtime.mjs';
if(process.platform!=='darwin'||process.env.CI!=='true')throw Error('Only run on an isolated macOS CI runner');
const root=await realpath(await mkdtemp(join(tmpdir(),'777-official-acceptance-'))),home=join(root,'home'),target=join(home,'Applications','Codex.app');
const manager=new MacManager({managerRoot:join(root,'manager'),home,isolated:false,backup:async()=>({fake:true})});
manager.selected=async()=>{if(!await access(target).then(()=>true,()=>false))return {installed:false,running:false};const info=await manager.bundleIdentity(target);return {installed:true,running:false,installDirectory:target,version:info.version};};
await manager.load();
const result={arch:process.arch,officialSource:true,realAccount:false,officialAppLaunched:false};
try{
 await manager.download();result.download=true;result.version=manager.state.version;result.dmgSha256=manager.state.sha256;
 await manager.install();result.install=true;
 const original=join(target,'Contents','Resources','app.asar'),hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex'),before=await hash(original);
 await manager.localize();result.chineseCopy=true;if(before!==await hash(original))throw Error('Official ASAR changed');
 // Exercise LaunchServices, not just codesign verification. This launches only
 // our newly built private copy on the disposable CI runner, without an account.
 try{
  await manager.launchZh();result.chineseLaunchServices=true;
  await new Promise(r=>setTimeout(r,5000));
  if(!(await macCodexStatus({CODEX_DESKTOP_PATH:manager.zh})).running)throw Error('Chinese copy exited after launch');
  result.chineseProcessStable=true;
 }finally{
  await stopMacCodex({CODEX_DESKTOP_PATH:manager.zh});
 }
 await manager.removeZh();result.chineseRemoval=true;
 await manager.install();result.update=true;
 // Alter only our temporary CI app, then prove install trust checks still reject
 // it while uninstall can move the identified app to a recoverable location.
 await writeFile(original,Buffer.concat([await readFile(original),Buffer.from('\n777 CI signature regression\n')]));
 let rejected=false;try{await manager.bundle(target);}catch{rejected=true;}if(!rejected)throw Error('Damaged app unexpectedly passed trust checks');result.damagedSignatureRejected=true;
 await manager.uninstall();result.uninstall=true;if(await access(target).then(()=>true,()=>false))throw Error('App remains');
 await access(join(manager.state.recoveryPath,'Contents','Resources','app.asar'));result.damagedAppUninstall=true;
 result.ok=true;
}catch(error){
 if(process.arch==='x64'&&error.code==='MAC_ARCH_UNSUPPORTED'){result.ok=true;result.officialIntelUnsupported=true;}
 else{result.ok=false;result.error=error.message;}
}
const dist=new URL('../../dist-mac-tauri/',import.meta.url);await mkdir(dist,{recursive:true});await writeFile(new URL(`mac-native-components-${process.arch}.json`,dist),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
