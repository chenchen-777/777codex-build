import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,access,realpath} from 'node:fs/promises';import {join,basename} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {MacManager,assertMacUrl,MAC_DOWNLOAD,MAC_SECURITY} from '../js/mac-manager.mjs';import {patchMacI18n} from '../js/mac-i18n.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function asar(source='a.get(`enable_i18n`,!1)'){
 const bytes=Buffer.from(source),header=Buffer.from(JSON.stringify({files:{'app.js':{offset:'0',size:bytes.length,integrity:{algorithm:'SHA256',hash:hash(bytes),blockSize:4194304,blocks:[hash(bytes)]}}}}));
 const out=Buffer.alloc(16+header.length+bytes.length);out.writeUInt32LE(8+header.length,4);out.writeUInt32LE(header.length,12);header.copy(out,16);bytes.copy(out,16+header.length);return out;
}
test('Chinese patch preserves byte offsets and updates exact ASAR integrity; unknown versions reject',()=>{
 const original=asar(),r=patchMacI18n(original);assert.equal(r.buffer.length,original.length);assert.equal(r.changes,1);assert.ok(r.buffer.includes(Buffer.from('!0')));assert.ok(original.includes(Buffer.from('!1')));
 const header=JSON.parse(r.buffer.subarray(16,16+r.buffer.readUInt32LE(12)));const data=r.buffer.subarray(8+r.buffer.readUInt32LE(4));assert.equal(header.files['app.js'].integrity.hash,hash(data));
 assert.throws(()=>patchMacI18n(asar('unknown runtime')),e=>e.code==='MAC_ZH_INCOMPATIBLE');assert.throws(()=>patchMacI18n(Buffer.alloc(4)));
 assert.equal(patchMacI18n(r.buffer).alreadyEnabled,true);
});
async function fixture(t,arch='arm64'){
 const root=await realpath(await mkdtemp(join(tmpdir(),'777-mac-fixture-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'home'),bundle=join(root,'fixture','Codex.app');await mkdir(join(bundle,'Contents','MacOS'),{recursive:true});await mkdir(join(bundle,'Contents','Resources'));
 await writeFile(join(bundle,'Contents','Info.plist'),'FAKE_PLIST');await writeFile(join(bundle,'Contents','MacOS','Codex'),'FAKE_EXECUTABLE');await writeFile(join(bundle,'Contents','Resources','app.asar'),asar());
 const calls=[],state={arch:'arm64',running:false,signatureFails:false,id:'com.openai.codex',zhRunning:false,openStarts:true,entitlements:''};let backups=0;
 const run=async(command,args)=>{
  calls.push([command,args]);
  if(command.endsWith('plutil'))return {stdout:args[0]==='-extract'?({CFBundleIdentifier:state.id,CFBundleExecutable:'Codex',CFBundleShortVersionString:'26.9',LSMinimumSystemVersion:'12.0'}[args[1]]||''):''};
  if(command.endsWith('lipo'))return {stdout:state.arch};if(command.endsWith('sw_vers'))return {stdout:'15.0'};
  if(command.endsWith('ps'))return {stdout:[state.running?`123 ${join(home,'Applications','Codex.app','Contents','MacOS','Codex')}`:'',state.zhRunning?`124 ${join(home,'Applications','777 Codex 中文.app','Contents','MacOS','Codex')}`:''].join('\n')};
  if(command.endsWith('open')&&args.includes('-a')){if(state.openError)throw state.openError;state.zhRunning=state.openStarts;}
  if(command.endsWith('codesign')&&args.includes('--display'))return {stdout:state.entitlements};
  if((command.endsWith('spctl')||command.endsWith('codesign'))&&state.signatureFails)throw Error('signature failed');
  if(command.endsWith('hdiutil')&&args[0]==='attach')await cp(bundle,join(args[args.indexOf('-mountpoint')+1],'Codex.app'),{recursive:true});
  if(command.endsWith('ditto'))await cp(args[0],args[1],{recursive:true});return {stdout:''};
 };
 const manager=new MacManager({managerRoot:join(root,'manager'),platform:'darwin',isolated:false,home,arch,run,wait:async()=>{},fetcher:async()=>new Response('FAKE_DMG'),backup:async()=>{backups++;}});
 return {manager,root,home,calls,state,backups:()=>backups};
}
async function act(m,action){await m.start(action);await m.worker;return m.status();}
test('download, verify, install, update and uninstall preserve original files in scoped recoveries',async t=>{
 const f=await fixture(t),m=f.manager;
 assert.equal((await act(m,'download')).phase,'ready');assert.equal((await act(m,'install')).phase,'complete');
 const app=join(f.home,'Applications','Codex.app');await access(app);
 assert.equal((await act(m,'install')).phase,'complete');await access(m.state.recoveryPath);
 assert.equal((await act(m,'uninstall')).phase,'complete');await assert.rejects(access(app));await access(m.state.recoveryPath);assert.equal(f.backups(),3);
 assert.ok(f.calls.some(([c])=>c.endsWith('spctl')));assert.ok(f.calls.some(([c,a])=>c.endsWith('hdiutil')&&a[0]==='detach'));
});
test('Mac actions fail safely on incompatible chip, running app, modified cache and arbitrary target',async t=>{
 const f=await fixture(t,'x64'),m=f.manager;assert.equal((await act(m,'download')).phase,'error');assert.match(m.state.message,/Intel/);
 m.arch='arm64';await act(m,'download');await act(m,'install');f.state.running=true;assert.match((await act(m,'uninstall')).message,/退出/);f.state.running=false;
 await writeFile(m.dmg,'CHANGED');assert.match((await act(m,'install')).message,/缓存/);
 await assert.rejects(m.writableApp(join(f.home,'Other.app')),e=>e.code==='MAC_PATH_INVALID');
});
test('Chinese copy is independent, verifies local signature, preserves official app and can be removed',async t=>{
 const f=await fixture(t),m=f.manager;await act(m,'download');await act(m,'install');
 const original=join(f.home,'Applications','Codex.app','Contents','Resources','app.asar'),before=await readFile(original);
 assert.equal((await act(m,'zh-install')).phase,'complete');assert.deepEqual(await readFile(original),before);assert.notDeepEqual(await readFile(join(m.zh,'Contents','Resources','app.asar')),before);
 assert.equal((await act(m,'zh-launch')).phase,'complete');assert.ok(f.calls.some(([c,a])=>c.endsWith('open')&&a.includes(m.zh)));f.state.zhRunning=false;
 assert.equal((await act(m,'zh-remove')).phase,'complete');await access(original);await assert.rejects(access(m.zh));
});

test('Chinese signing matches standalone kit without metadata inheritance or security bypass',async t=>{
 const f=await fixture(t),m=f.manager;await act(m,'download');await act(m,'install');
 assert.equal((await act(m,'zh-install')).phase,'complete');
 const signing=f.calls.find(([c,a])=>c.endsWith('codesign')&&a.includes('--sign'));
 assert.deepEqual(signing[1].slice(0,-1),['--force','--deep','--sign','-']);
 assert.equal(f.calls.some(([c,a])=>c.endsWith('xattr')||a.some(v=>String(v).includes('preserve-metadata'))),false);
 const before=await readFile(join(m.zh,'Contents','Resources','app.asar'));
 f.state.entitlements='<plist><dict><key>keychain-access-groups</key><array><string>ORIGINAL_TEAM.shared</string></array></dict></plist>';
 assert.match((await act(m,'zh-install')).message,/受限权限/);
 assert.deepEqual(await readFile(join(m.zh,'Contents','Resources','app.asar')),before);
});

test('Chinese launch rejects spawn errors and absent processes instead of claiming success',async t=>{
 const f=await fixture(t),m=f.manager;await act(m,'download');await act(m,'install');await act(m,'zh-install');
 f.state.openError=Object.assign(new Error('open failed'),{stderr:'NSPOSIXErrorDomain Code=163 Launchd job spawn failed PRIVATE_ACCOUNT_DATA'});
 const failed=await act(m,'zh-launch');assert.equal(failed.phase,'error');assert.match(failed.message,/163/);assert.doesNotMatch(failed.message,/PRIVATE_ACCOUNT_DATA/);
 f.state.openError=null;f.state.openStarts=false;
 assert.match((await act(m,'zh-launch')).message,/未检测到/);
 f.state.openStarts=true;
 assert.match((await act(m,'zh-launch')).message,/持续运行/);
});
test('isolated mode never invokes commands; security action opens settings only',async t=>{
 const f=await fixture(t),m=f.manager;m.isolated=true;await assert.rejects(m.start('download'),e=>e.code==='ISOLATED_PREVIEW');assert.equal(f.calls.length,0);
 m.isolated=false;await act(m,'security');assert.deepEqual(f.calls,[['/usr/bin/open',[MAC_SECURITY]]]);assert.equal(m.state.phase,'complete');
 assert.equal(assertMacUrl(MAC_DOWNLOAD),MAC_DOWNLOAD);for(const u of ['http://persistent.oaistatic.com/codex-app-prod/Codex.dmg','https://evil.example/Codex.dmg','https://u:p@persistent.oaistatic.com/codex-app-prod/Codex.dmg'])assert.throws(()=>assertMacUrl(u));
});
test('signature failure cannot result in install ready, and mount is detached',async t=>{
 const f=await fixture(t);f.state.signatureFails=true;assert.equal((await act(f.manager,'download')).phase,'error');assert.equal(f.manager.state.sha256,undefined);assert.ok(f.calls.some(([c,a])=>c.endsWith('hdiutil')&&a[0]==='detach'));
});

test('uninstall ignores broken signatures and launch compatibility, preserving app and user data',async t=>{
 const f=await fixture(t),m=f.manager;await act(m,'download');await act(m,'install');
 const app=join(f.home,'Applications','Codex.app'),asarPath=join(app,'Contents','Resources','app.asar');
 await writeFile(asarPath,'MODIFIED_APP_RESOURCE');
 const userData=join(f.home,'.codex');await mkdir(userData);await writeFile(join(userData,'history.jsonl'),'USER_HISTORY');await writeFile(join(userData,'auth.json'),'SYNTHETIC_CREDENTIAL');
 f.state.signatureFails=true;f.state.arch='unsupported';f.calls.length=0;
 assert.equal((await act(m,'uninstall')).phase,'complete');await assert.rejects(access(app));
 assert.equal(await readFile(join(m.state.recoveryPath,'Contents','Resources','app.asar'),'utf8'),'MODIFIED_APP_RESOURCE');
 assert.equal(await readFile(join(userData,'history.jsonl'),'utf8'),'USER_HISTORY');assert.equal(await readFile(join(userData,'auth.json'),'utf8'),'SYNTHETIC_CREDENTIAL');
 assert.equal(f.calls.some(([c])=>/codesign|spctl|lipo|sw_vers/.test(c)),false);
 assert.equal(f.backups(),2);
});

test('uninstall still refuses wrong identity, running app, unapproved path and backup failure',async t=>{
 const f=await fixture(t),m=f.manager;await act(m,'download');await act(m,'install');const app=join(f.home,'Applications','Codex.app');
 f.state.signatureFails=true;f.state.id='com.other.app';assert.equal((await act(m,'uninstall')).phase,'error');await access(app);
 f.state.id='com.openai.codex';f.state.running=true;assert.match((await act(m,'uninstall')).message,/退出/);await access(app);f.state.running=false;
 const selected=m.selected.bind(m);m.selected=async()=>({installed:true,running:false,installDirectory:join(f.home,'Other.app')});assert.match((await act(m,'uninstall')).message,/自定义路径/);m.selected=selected;await access(app);
 m.backup=async()=>{throw Error('FAKE_BACKUP_FAILURE');};assert.equal((await act(m,'uninstall')).phase,'error');await access(app);assert.equal(m.state.recoveryPath,undefined);
});
