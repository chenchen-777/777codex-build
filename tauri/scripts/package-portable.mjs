import {cp,mkdir,readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peImports} from './pe-imports.mjs';
import {RELEASE} from './release-info.mjs';
import {compactImageComponent} from './compact-image-component.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw new Error('Windows portable packager only; Mac requires native validation.');
// Always stage into a fresh directory: never redistribute a previous preview's data.
const installer=join(root,'backend','components','install-engine','777codex-install-engine.exe');
if(peImports(await readFile(installer)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw new Error('Installation engine requires Visual C++ runtime; rebuild it with static CRT before packaging');
const output=join(root,'dist',`Windows-公测版-${RELEASE.displayVersion}-${Date.now()}`);
await mkdir(output,{recursive:true});
await mkdir(join(output,'helpers'));
for(const name of ['777Codex.exe','777-native.exe']){
 const source=join(root,'src-tauri','target','release',name);
 if(peImports(await readFile(source)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw new Error('Portable executable requires Visual C++ runtime; rebuild with static CRT: '+name);
 await cp(source,join(output,name==='777Codex.exe'?name:'helpers/'+name));
}
await cp(join(root,'src-tauri','target','release','777-share-launcher.exe'),join(output,'helpers','777-share-launcher.exe'));
await cp(join(root,'runtime'),join(output,'runtime'),{recursive:true});
const engine=join(root,'codexpp-engine','target','release','777-codexpp.exe');
if(peImports(await readFile(engine)).some(dll=>/^(vcruntime|msvcp)\d/i.test(dll)))throw new Error('Rebuild Codex++ engine with static CRT before packaging');
await cp(engine,join(output,'helpers','777-codexpp.exe'));
await mkdir(join(output,'licenses'));for(const name of ['LICENSE','NOTICE.md'])await cp(join(root,'codexpp-engine',name),join(output,'licenses','CodexPlusPlus-'+name));
await cp(join(root,'backend'),join(output,'backend'),{recursive:true,filter:path=>{
 const rel=path.slice(join(root,'backend').length).replaceAll('\\','/');
 if(/^\/components\/777codes-image-mcp\/node_modules(\/|$)/.test(rel))return false;
 return !/^\/(\.dev|\.window-data|test|test-results|electron)(\/|$)/.test(rel)&&!rel.endsWith('/package-online.mjs')&&!rel.endsWith('/authenticode.mjs')&&!rel.endsWith('/build-update-artifact.mjs');
}});
await compactImageComponent(join(root,'backend','components','777codes-image-mcp'),join(output,'backend','components','777codes-image-mcp'));
await writeFile(join(output,'使用说明.txt'),'1. 将压缩包完整解压到一个文件夹。\r\n2. 双击 777Codex.exe，不要单独移动它。\r\n3. 点击“登录 / 注册账号”，按网页提示完成登录。\r\n4. 回到软件，按照首页提示连接，点击“打开 Codex 客户端，开始聊天”。\r\n');
await writeFile(join(output,'licenses','内部试验说明.txt'),'本包尚未签名，供验证使用，未替换线上下载。Tool Doctor 分发许可由项目所有者确认，保留原作者声明。\r\n');
const files=[];
async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const file=join(dir,entry.name);if(entry.isDirectory()){await inventory(file);continue;}
 if(entry.isSymbolicLink())throw new Error('Refusing symlink in portable package');
 const bytes=await readFile(file);files.push({path:file.slice(output.length+1).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}}
await inventory(output);
if(files.some(f=>/chrome_elf|icudtl|v8_context|LICENSES.chromium|electron\.(exe|asar)/i.test(f.path)))throw new Error('Electron runtime leaked into Tauri bundle');
const buildId=`win-${RELEASE.version}-${Date.now()}`;
await writeFile(join(output,'build-manifest.json'),JSON.stringify({framework:'Tauri 2',backend:'Node.js sidecar',version:RELEASE.version,buildId,signed:false,status:RELEASE.channel,defaultMode:'live',publicRedistributable:false,releaseBlockers:['Unsigned validation candidate; production release not performed'],bytes:files.reduce((sum,f)=>sum+f.bytes,0),files},null,2));
console.log(JSON.stringify({output,files:files.length,MiB:Number((files.reduce((sum,f)=>sum+f.bytes,0)/1048576).toFixed(2))}));
