// Copy only reviewed product source; never copy profiles, releases, .git or caches.
import {access,cp,lstat,mkdir,readdir,readFile,realpath,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {applyHomeNavigation} from './home-navigation.mjs';
import {applyKeyOnboarding} from './key-onboarding.mjs';
import {applyAccountBalanceUi} from './account-balance-ui.mjs';
import {RELEASE,updateManifestUrl} from './release-info.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fileURLToPath(new URL('../../777codex-desktop-0.11.0/',import.meta.url));
const target=join(root,'backend');
await mkdir(target,{recursive:true});
if(process.platform==='win32'){
  // Windows starts from the last complete public-beta backend, then replays the
  // reviewed overlay. The older shared 0.11 snapshot lacks later Codex++/Mac/UI fixes.
  const baseline=join(root,'windows-baseline-1.0');
  await Promise.all([access(join(baseline,'index.html')),access(join(baseline,'package.json'))]);
  const resolvedRoot=await realpath(root),expected=join(resolvedRoot,'backend');
  if(target!==join(root,'backend')||expected!==join(await realpath(root),'backend'))throw new Error('Unsafe generated backend target');
  const targetInfo=await lstat(target).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  if(targetInfo?.isSymbolicLink())throw new Error('Refusing symlinked generated backend target');
  await rm(expected,{recursive:true,force:true});
  await cp(baseline,expected,{recursive:true});
  // The native adapter contract evolves independently of the frozen release.
  // In particular, sharing needs both the folder and ZIP pickers.
  await cp(join(root,'scripts','sidecar.mjs'),join(target,'scripts','sidecar.mjs'));
  await cp(join(root,'windows-tests-baseline-1.0'),join(target,'test'),{recursive:true});
  // Developer-only regression fixtures are absent from the distributed public-beta
  // backend. Restore them for the full source test suite; package-portable excludes
  // Electron and these three build scripts from the candidate inventory.
  await mkdir(join(target,'electron'),{recursive:true});
  for(const name of await readdir(join(source,'electron')))if(/\.(mjs|cjs|ps1)$/.test(name))await cp(join(source,'electron',name),join(target,'electron',name));
  for(const name of ['authenticode.mjs','package-online.mjs','build-update-artifact.mjs'])await cp(join(source,'scripts',name),join(target,'scripts',name));
  await mkdir(join(root,'src-tauri','icons'),{recursive:true});
  await cp(join(root,'assets','777codes-round.ico'),join(root,'src-tauri','icons','icon.ico'));
  await import('./apply-windows-overlay.mjs');
  await applyKeyOnboarding(target);
  const releaseHtml=await readFile(join(target,'index.html'),'utf8');
  await writeFile(join(target,'index.html'),releaseHtml.replace(/(<span class="review-badge">)[^<]*(<\/span>)/,'$1'+RELEASE.label+'$2').replace(/(<div class="version-indicator"><span><\/span>\s*)[^<]*(<\/div>)/,'$1'+RELEASE.label+'$2'));
  await applyAccountBalanceUi(target);
  await writeFile(join(target,'js','build-info.mjs'),`export const BUILD_INFO=Object.freeze(${JSON.stringify({product:'777codex-tauri',version:RELEASE.version,revision:RELEASE.revision,revisionLabel:RELEASE.label,channel:RELEASE.channel,updateManifestUrl:updateManifestUrl('win32',process.arch)})});\n`);
  // Use the reviewed static-CRT engine, never the legacy dynamic-CRT snapshot.
  const installer=join(source,'engine','target','release','codes777-install-engine.exe');
  const {peImports}=await import('./pe-imports.mjs');
  if(peImports(await readFile(installer)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw Error('Rebuild installation engine with static CRT before preparing');
  await cp(installer,join(target,'components','install-engine','777codex-install-engine.exe'));
  await mkdir(join(root,'runtime'),{recursive:true});
  await cp(process.execPath,join(root,'runtime','node.exe'));
  console.log('Prepared Windows Tauri backend from complete public-beta baseline plus reviewed overlay.');
}else{
for(const name of ['index.html','styles.css','ui.js','features-ui.js','account-ui.js','install-ui.js','import-ui.js','mac-ui.js'])await cp(join(source,name),join(target,name));
for(const dir of ['js','scripts','assets','components','test'])await mkdir(join(target,dir),{recursive:true});
for(const name of await readdir(join(source,'js')))if(/\.(mjs|pem)$/.test(name))await cp(join(source,'js',name),join(target,'js',name));
for(const name of ['server.mjs','feature-api.mjs','authenticode.mjs','package-online.mjs','build-update-artifact.mjs'])await cp(join(source,'scripts',name),join(target,'scripts',name));
await cp(join(source,'assets','777codes-logo.png'),join(target,'assets','777codes-logo.png'));
await cp(join(source,'assets','777codes.ico'),join(target,'assets','777codes.ico'));
await mkdir(join(root,'src-tauri','icons'),{recursive:true});
await cp(join(root,'assets','777codes-round.ico'),join(root,'src-tauri','icons','icon.ico'));
await cp(join(root,'assets','777codes-round.ico'),join(target,'assets','777codes-round.ico'));
for(const name of ['@iarna/toml','yaml'])await cp(join(source,'node_modules',name),join(target,'node_modules',name),{recursive:true});
for(const dir of ['codex-zh','plugin-repair','install-engine','777codes-image-mcp'])await cp(join(source,'components',dir),join(target,'components',dir),{recursive:true});
await cp(join(source,'test'),join(target,'test'),{recursive:true});
await mkdir(join(target,'electron'),{recursive:true});
for(const name of await readdir(join(source,'electron')))if(/\.(mjs|cjs|ps1)$/.test(name))await cp(join(source,'electron',name),join(target,'electron',name));
await writeFile(join(target,'package.json'),JSON.stringify({name:'777codex-tauri-backend',private:true,type:'module',version:RELEASE.version},null,2));
let html=await readFile(join(target,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="./styles.css">','<link rel="stylesheet" href="./styles.css"><link rel="stylesheet" href="./tauri-window.css"><script src="./tauri-window.js"></script>');
await writeFile(join(target,'index.html'),html);
let server=await readFile(join(target,'scripts','server.mjs'),'utf8');
server=server.replace('"mac-ui.js", normalize(', '"mac-ui.js", "tauri-window.js", "tauri-window.css", normalize(');
server=server.replace("connect-src 'self';", "connect-src 'self' ipc: http://ipc.localhost;");
await writeFile(join(target,'scripts','server.mjs'),server);
for(const name of ['tauri-window.js','tauri-window.css'])await cp(join(root,'ui',name),join(target,name));
await cp(join(root,'scripts','sidecar.mjs'),join(target,'scripts','sidecar.mjs'));
await cp(join(root,'scripts','login-recovery.mjs'),join(target,'scripts','login-recovery.mjs'));
await cp(join(root,'scripts','runtime-paths.mjs'),join(target,'scripts','runtime-paths.mjs'));
await applyHomeNavigation(target);
await applyKeyOnboarding(target);
await applyAccountBalanceUi(target);
await mkdir(join(root,'runtime'),{recursive:true});
await cp(process.execPath,join(root,'runtime',process.platform==='win32'?'node.exe':'node'));
console.log('Prepared Tauri backend (no Electron runtime, no user configuration).');
}
