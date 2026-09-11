// Publication allowlist. No profiles, credentials, binaries, archives or local logs.
import {mkdir,cp,readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {RELEASE} from './release-info.mjs';
import {compactImageComponent} from './compact-image-component.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
const repo=fileURLToPath(new URL('../../777codex-mac-build-source/',import.meta.url));
// CI keeps the historical transfer repository default. Local verification can
// point at a fresh directory so staging never mutates the checked-in backend.
const stage=process.env.MANAGER777_MAC_STAGE_ROOT?resolve(process.env.MANAGER777_MAC_STAGE_ROOT):join(repo,'tauri');
async function copy(from,to){await mkdir(join(to,'..'),{recursive:true});await cp(from,to);}
for(const name of ['Cargo.toml','Cargo.lock','build.rs','tauri.conf.json','.cargo/config.toml'])await copy(join(source,'src-tauri',name),join(stage,'src-tauri',name));
for(const name of ['Cargo.toml','Cargo.lock','src/main.rs','LICENSE','NOTICE.md','.cargo/config.toml'])await copy(join(source,'codexpp-engine',name),join(stage,'codexpp-engine',name));
for(const dir of ['src-tauri/src','src-tauri/permissions','bootstrap','ui','test']){
 for(const entry of await readdir(join(source,dir),{withFileTypes:true}))if(entry.isFile()&&/\.(rs|toml|html|css|js|mjs)$/.test(entry.name))await copy(join(source,dir,entry.name),join(stage,dir,entry.name));
}
for(const name of ['777codes-round.png','777codes-round.ico'])await copy(join(source,'assets',name),join(stage,'assets',name));
for(const name of ['sidecar.mjs','login-recovery.mjs','runtime-paths.mjs','home-navigation.mjs','package-mac.mjs','verify-official-mac.mjs','release-info.mjs','package-portable.mjs','pe-imports.mjs','verify-windows-package.mjs','verify-release.py'])await copy(join(source,'scripts',name),join(stage,'scripts',name));
const backend=join(stage,'backend');
await copy(join(source,'backend','log-export.js'),join(backend,'log-export.js'));
for(const name of ['stage-mac-source.mjs','zh-button-copy.mjs'])await copy(join(source,'scripts',name),join(stage,'scripts',name));
await copy(join(source,'windows-baseline-1.0','features-ui.js'),join(stage,'windows-baseline-1.0','features-ui.js'));
for(const name of ['index.html','styles.css','ui.js','features-ui.js','account-ui.js','install-ui.js','import-ui.js','mac-ui.js','tauri-window.js','tauri-window.css','tool-ui.js','tool-ui.css','inline-models.js','install-flow.js'])await copy(join(source,'backend',name),join(backend,name));
// The generated backend may be recreated by a Windows build. Keep reviewed
// native Mac behavior in a durable overlay instead of relying on that cache.
await copy(join(source,'mac-overlay','mac-ui.js'),join(backend,'mac-ui.js'));
for(const entry of await readdir(join(source,'backend','js')))if(/\.mjs$/.test(entry)||entry==='update-public.pem')await copy(join(source,'backend','js',entry),join(backend,'js',entry));
for(const name of ['server.mjs','feature-api.mjs','windows-api.mjs'])await copy(join(source,'backend','scripts',name),join(backend,'scripts',name));
for(const name of ['sidecar.mjs','login-recovery.mjs','runtime-paths.mjs'])await copy(join(source,'scripts',name),join(backend,'scripts',name));
await copy(join(source,'backend','assets','777codes-logo.png'),join(backend,'assets','777codes-logo.png'));
// Project owner confirmed public redistribution permission in this task.
for(const dir of ['codex-zh','plugin-repair','install-engine','777codes-image-mcp','share-zip','tool-doctor']){
 const from=join(source,'backend','components',dir);
 await cp(from,join(backend,'components',dir),{recursive:true,filter:path=>!path.endsWith('.exe')&&(dir!=='777codes-image-mcp'||!/[\\/]node_modules(?:[\\/]|$)/.test(path))});
 if(dir==='777codes-image-mcp')await compactImageComponent(from,join(backend,'components',dir));
}
for(const dependency of ['@iarna/toml','yaml'])await cp(join(source,'backend','node_modules',dependency),join(backend,'node_modules',dependency),{recursive:true});
await cp(join(source,'backend','components','tool-doctor','node_modules','smol-toml'),join(stage,'vendor','smol-toml'),{recursive:true});
for(const name of ['macos-runtime.test.mjs','mac-ui.test.mjs','mac-manager.test.mjs','simple-home-ui.test.mjs','account-manager.test.mjs','platform-key-sync.test.mjs','config-core.test.mjs','provider-group.test.mjs','provider-store.test.mjs','model-service.test.mjs','windows-onboarding-ui.test.mjs','tool-responsive-share.test.mjs','provider-switch.test.mjs','share-package-safe.test.mjs','share-release-source.test.mjs'])await copy(join(source,'backend','test',name),join(backend,'test',name));
await copy(join(source,'backend','test','fixtures','desktop-auth-referral-contract.json'),join(backend,'test','fixtures','desktop-auth-referral-contract.json'));
await copy(join(source,'backend','test','codexpp-manager.test.mjs'),join(backend,'test','codexpp-manager.test.mjs'));
for(const name of ['command-diagnostic.test.mjs','engine-audit.test.mjs','log-export.test.mjs','install-engine-diagnostics.test.mjs'])await copy(join(source,'backend','test',name),join(backend,'test',name));
await copy(join(source,'backend','test','codexpp-ui.test.mjs'),join(backend,'test','codexpp-ui.test.mjs'));
await copy(join(source,'mac-overlay','mac-ui.test.mjs'),join(backend,'test','mac-ui.test.mjs'));
await writeFile(join(backend,'package.json'),JSON.stringify({private:true,type:'module',version:RELEASE.version}));
let html=await readFile(join(backend,'index.html'),'utf8');
if(!html.includes('<script src="./mac-ui.js"></script>'))html=html.replace('<script src="./ui.js">','<script src="./mac-ui.js"></script><script src="./ui.js">');
await writeFile(join(backend,'index.html'),html);
await writeFile(join(backend,'account-ui.js'),(await readFile(join(backend,'account-ui.js'),'utf8')).replaceAll('Windows 安全存储','macOS 钥匙串安全存储'));
await writeFile(join(backend,'js','build-info.mjs'),`export const BUILD_INFO=Object.freeze(${JSON.stringify({product:'777codex-tauri',version:RELEASE.version,revision:RELEASE.revision,revisionLabel:RELEASE.label,channel:RELEASE.channel,updateManifestUrl:''})});\n`);
// System font stack keeps the compact approved layout readable on both platforms.
await writeFile(join(backend,'tauri-window.css'),(await readFile(join(backend,'tauri-window.css'),'utf8')).replace('font-family:"Segoe UI","Microsoft YaHei UI",sans-serif','font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei UI",sans-serif'));
const findings=[];let scanned=0;
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 if(['.dev','.window-data','node_modules','target','gen','icons'].includes(entry.name))continue;
 const p=join(dir,entry.name);if(entry.isDirectory()){await scan(p);continue;}
 if(/\.(png|ico)$/.test(entry.name))continue;
 const text=await readFile(p,'utf8');scanned++;
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{24,}/.test(text))findings.push(p);
}}
await scan(stage);if(findings.length)throw new Error('Potential secrets: '+findings.join(', '));
await writeFile(join(stage,'release-readiness.json'),JSON.stringify({publicRedistributable:true,userConfirmed:true,permissionBasis:'Project owner confirmed Tool Doctor public redistribution permission in task on 2026-09-11; not independently verified',realUserMacAcceptance:false},null,2));
console.log(JSON.stringify({stage,scanned,secretFindings:0,publicRedistributable:true}));
