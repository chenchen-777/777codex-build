import {cp,mkdir,readFile,writeFile,mkdtemp,chmod,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin'||!['arm64','x64'].includes(process.arch))throw Error('Use a native macOS arm64/x64 runner');
const arch=process.arch;
const scratch=await realpath(await mkdtemp(join(tmpdir(),'777-tauri-package-')));
const app=join(scratch,'777 Codex.app'),contents=join(app,'Contents'),resources=join(contents,'Resources'),bin=join(contents,'MacOS');
for(const dir of [resources,bin,join(root,'src-tauri','icons')])await mkdir(dir,{recursive:true});
await cp(join(root,'assets','777codes-round.ico'),join(root,'src-tauri','icons','icon.ico'));
await cp(join(root,'assets','777codes-round.png'),join(root,'src-tauri','icons','icon.png'));
const icons=join(scratch,'777codes.iconset');await mkdir(icons);
for(const size of [16,32,128,256,512])for(const scale of [1,2])await exec('/usr/bin/sips',['-z',String(size*scale),String(size*scale),join(root,'assets','777codes-round.png'),'--out',join(icons,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
await exec('/usr/bin/iconutil',['-c','icns',icons,'-o',join(resources,'777codes.icns')]);
await exec('cargo',['build','--release','--locked','--bins','--manifest-path',join(root,'src-tauri','Cargo.toml')],{cwd:root,timeout:25*60*1000,maxBuffer:16*1024*1024});
for(const name of ['777Codex','777-native']){await cp(join(root,'src-tauri','target','release',name),join(bin,name));await chmod(join(bin,name),0o755);}
await cp(join(root,'backend'),join(resources,'backend'),{recursive:true,filter:path=>!/[\\/](?:\.dev|\.window-data|node_modules|test)(?:[\\/]|$)/.test(path)});
await mkdir(join(resources,'runtime'));
await cp(process.execPath,join(resources,'runtime','node'));await chmod(join(resources,'runtime','node'),0o755);
for(const dependency of ['@iarna/toml','yaml'])await cp(join(root,'..','node_modules',dependency),join(resources,'backend','node_modules',dependency),{recursive:true});
await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>codes.777.manager.tauri.candidate</string>
<key>CFBundleName</key><string>GCC CodeX 管理工具</string><key>CFBundleDisplayName</key><string>GCC CodeX 管理工具</string>
<key>CFBundleExecutable</key><string>777Codex</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>777codes.icns</string><key>CFBundleShortVersionString</key><string>0.12.0</string>
<key>CFBundleVersion</key><string>4</string><key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/><key>NSAppleEventsUsageDescription</key><string>仅在你点击重启时请求退出 Codex。</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>`);
for(const path of [join(resources,'runtime','node'),join(bin,'777-native'),join(bin,'777Codex'),app])await exec('/usr/bin/codesign',['--force','--sign','-',path],{maxBuffer:4*1024*1024});
await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
for(const path of [join(bin,'777Codex'),join(bin,'777-native'),join(resources,'runtime','node')]){
 const found=(await exec('/usr/bin/lipo',['-archs',path])).stdout.trim();
 if(found!==(arch==='x64'?'x86_64':'arm64'))throw Error('Architecture mismatch: '+path);
}
const dist=resolve(root,'..','dist-mac-tauri');await mkdir(dist,{recursive:true});
// No real account/network requests and no writes to the user's Codex configuration.
const smoke=join(dist,`mac-tauri-${arch}-smoke.json`);
const env={...process.env,MANAGER777_ISOLATED:'1',MANAGER777_STATE_ROOT:join(scratch,'state'),MANAGER777_SMOKE_REPORT:smoke};
await exec(join(bin,'777Codex'),['--isolated'],{env,timeout:90000,maxBuffer:4*1024*1024});
const smokeResult=JSON.parse(await readFile(smoke,'utf8'));
if(!smokeResult.ok||!smokeResult.uiLoaded||smokeResult.framework!=='tauri')throw Error('Packaged WebKit smoke failed');
await exec(process.execPath,['--test',join(root,'test','mac-native.test.mjs')],{env:{...env,MANAGER777_NATIVE:join(bin,'777-native')},timeout:90000,maxBuffer:4*1024*1024});
const payload=join(scratch,'download');await mkdir(payload);
await cp(app,join(payload,'777 Codex.app'),{recursive:true});
await writeFile(join(payload,'首次打开说明.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>777 Codex 首次打开</title><style>body{font:17px/1.8 -apple-system,sans-serif;max-width:680px;margin:48px auto;padding:24px;color:#243b50}a{display:inline-block;padding:12px 20px;background:#243b50;color:white;border-radius:12px;margin:8px 0}</style><h1>777 Codex · 首次打开</h1><p>版本 0.12.0-mac-tauri-4 · ${arch==='arm64'?'Apple 芯片':'Intel'} · 未经 Apple Developer ID 签名和公证的测试版。</p><p>先双击同目录的 777 Codex.app。如出现“Apple 无法验证”，点击“完成”，再打开系统设置。只在确认来源可信且文件校验一致时手动放行。</p><a href="x-apple.systempreferences:com.apple.preference.security?General">打开隐私与安全性</a><p>浏览器可能要求确认打开系统设置。如果链接不可用：苹果菜单 → 系统设置 → 隐私与安全性 → 向下找到安全性 → 777 Codex → 仍要打开。</p><p>此入口不能直接弹出或代替“仍要打开”的授权，也不会关闭系统防护。租用或受管理的 Mac 可能不允许更改此设置。</p><a href="https://support.apple.com/zh-cn/102445">Apple 官方说明</a><p>安装 Codex：工具左侧“Codex 管理” → 下载 → 校验 → 安装。Intel 管理工具可运行不表示官方 Codex 支持 Intel。新 Mac 功能仍需实机验收。</p></html>`);
const zip=join(dist,`777Codex-0.12.0-mac-tauri-4-${arch}-test.zip`);
await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc',payload,zip],{timeout:120000});
const bytes=await readFile(zip),sha=createHash('sha256').update(bytes).digest('hex');
await writeFile(join(dist,`SHA256-${arch}.txt`),`${sha}  ${zip.split('/').at(-1)}\n`);
await writeFile(join(dist,`mac-tauri-${arch}-build.json`),JSON.stringify({framework:'Tauri 2 + system WebKit + Node sidecar',version:'0.12.0',revision:'mac-tauri-4',arch,signature:'ad-hoc; no Developer ID',notarized:false,realUserMacAcceptance:false,keychainSyntheticTest:true,smoke:smokeResult,bytes:bytes.length,sha256:sha,commit:process.env.GITHUB_SHA||null},null,2));
console.log(JSON.stringify({zip,bytes:bytes.length,sha256:sha,smoke:smokeResult}));
