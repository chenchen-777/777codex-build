import {cp,mkdir,readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peImports} from './pe-imports.mjs';
import {RELEASE} from './release-info.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw new Error('Windows portable packager only; Mac requires native validation.');
// Always stage into a fresh directory: never redistribute a previous preview's data.
const output=join(root,'dist',`Windows-公测版-${RELEASE.displayVersion}-${Date.now()}`);
await mkdir(output,{recursive:true});
for(const name of ['777Codex.exe','777-native.exe']){
 const source=join(root,'src-tauri','target','release',name);
 if(peImports(await readFile(source)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw new Error('Portable executable requires Visual C++ runtime; rebuild with static CRT: '+name);
 await cp(source,join(output,name));
}
await cp(join(root,'runtime'),join(output,'runtime'),{recursive:true});
const engine=join(root,'codexpp-engine','target','release','777-codexpp.exe');
if(peImports(await readFile(engine)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw new Error('Rebuild Codex++ engine with static CRT before packaging');
await cp(engine,join(output,'777-codexpp.exe'));
await mkdir(join(output,'licenses'));for(const name of ['LICENSE','NOTICE.md'])await cp(join(root,'codexpp-engine',name),join(output,'licenses','CodexPlusPlus-'+name));
await cp(join(root,'backend'),join(output,'backend'),{recursive:true,filter:path=>{
 const rel=path.slice(join(root,'backend').length).replaceAll('\\','/');
 return !/^\/(\.dev|\.window-data|test|electron)(\/|$)/.test(rel)&&!rel.endsWith('/package-online.mjs')&&!rel.endsWith('/authenticode.mjs')&&!rel.endsWith('/build-update-artifact.mjs');
}});
const files=[];
async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const file=join(dir,entry.name);if(entry.isDirectory()){await inventory(file);continue;}
 if(entry.isSymbolicLink())throw new Error('Refusing symlink in portable package');
 const bytes=await readFile(file);files.push({path:file.slice(output.length+1).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}}
await inventory(output);
if(files.some(f=>/chrome_elf|icudtl|v8_context|LICENSES.chromium|electron\.(exe|asar)/i.test(f.path)))throw new Error('Electron runtime leaked into Tauri bundle');
await writeFile(join(output,'build-manifest.json'),JSON.stringify({framework:'Tauri 2',backend:'Node.js sidecar',version:RELEASE.version,signed:false,status:RELEASE.channel,defaultMode:'live',bytes:files.reduce((sum,f)=>sum+f.bytes,0),files},null,2));
await writeFile(join(output,'README.txt'),'GCC CodeX 管理工具 · Windows 公测版 1.0\r\n完整解压后，双击 777Codex.exe 即可运行，无需安装管理工具。需要 Windows x64 和系统 WebView2。\r\n网页登录后同步账号 Key；已有 Tauri 版用户数据位置不变。旧 Electron 登录凭证不自动迁入。\r\n已同步模型/余额错误提示、插件修复与恢复、Codex++ 增强开关。\r\n请保留完整目录；不要单独移动 exe。请从官网下载管理工具新版本，不使用旧 Electron 更新包。\r\n本版未签名，可能出现系统安全提示；不是稳定版，也不能保证所有 Codex 版本兼容。\r\n开发验收可用 --isolated 参数，不会进行真实安装或账号操作。\r\n');
console.log(JSON.stringify({output,files:files.length,MiB:Number((files.reduce((sum,f)=>sum+f.bytes,0)/1048576).toFixed(2))}));
