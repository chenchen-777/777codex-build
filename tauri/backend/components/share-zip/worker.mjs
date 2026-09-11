import { parentPort,workerData } from 'node:worker_threads';
import { open, readFile } from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { patchRegistration } from '../../js/registration-patch.mjs';

const MAX_ENTRIES=20000,MAX_EXPANDED=2*1024**3,MAX_ENTRY=1024**3,MAX_RATIO=250;
const forbidden=/(^|\/)(auth\.json|config\.toml|providers\.json|devices?|device[-_]?tokens?|tokens?|logs?|sessions?|\.ssh)(\/|$)/i;
const progress=(phase,value)=>parentPort.postMessage({phase,progress:value});
function reject(code){const e=new Error(code);e.code=code;throw e;}
function safeName(name,seen){if(!name||name.length>1024||name.includes('\\')||/[<>:"|?*\u0000-\u001f]/.test(name)||name.startsWith('/')||/(^|\/)\.\.?($|\/)/.test(name)||forbidden.test(name))reject('UNSAFE');const parts=name.split('/'),directory=name.endsWith('/');if(directory)parts.pop();if(!parts.length||parts.some(part=>!part||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part)))reject('UNSAFE');const key=name.normalize('NFC').toLocaleUpperCase('en-US');if(seen.has(key))reject('UNSAFE');seen.add(key);}
const openFd=(fd,options={})=>new Promise((ok,fail)=>yauzl.fromFd(fd,{lazyEntries:true,autoClose:false,decodeStrings:true,validateEntrySizes:true,...options},(e,z)=>e?fail(e):ok(z)));
const nextEntry=z=>new Promise((ok,fail)=>{const clean=()=>{z.off('entry',entry);z.off('end',end);z.off('error',error);},entry=e=>{clean();ok(e);},end=()=>{clean();ok(null);},error=e=>{clean();fail(e);};z.once('entry',entry);z.once('end',end);z.once('error',error);z.readEntry();});
const streamEntry=(z,e)=>new Promise((ok,fail)=>z.openReadStream(e,(x,s)=>x?fail(x):ok(s)));
async function entryBytes(z,e){if(e.uncompressedSize>4*1024*1024)reject('LIMIT');const parts=[];for await(const b of await streamEntry(z,e))parts.push(b);return Buffer.concat(parts);}

async function upgradedWindows(zin,entries,prefix,partialZip,descriptor,shareUrl){
 const launcher=await readFile(new URL('../../../helpers/777-share-launcher.exe',import.meta.url));
 if(launcher.subarray(0,2).toString()!=='MZ')reject('INVALID');
 const targets=['backend/js/account-manager.mjs','backend/scripts/server.mjs','backend/account-ui.js'];
 if(targets.some(n=>!entries.some(e=>e.fileName===prefix+n)))reject('INVALID');
 const zout=new yazl.ZipFile(),dest=createWriteStream(partialZip,{flags:'wx'});
 const finished=once(dest,'close');zout.outputStream.on('error',e=>dest.destroy(e));zout.outputStream.pipe(dest);
 const patched=[];
 // Do not copy a running client's backend, profiles, or Doctor components.
 // Only these three account-related files in the SHA-pinned public base change.
 for(const e of entries){
  if(!e.fileName.startsWith(prefix))reject('UNSAFE');
  const relative=e.fileName.slice(prefix.length);if(!relative)continue;
  const name='app/'+relative;
  if(e.fileName.endsWith('/')){zout.addEmptyDirectory(name);continue;}
  if(targets.includes(relative)){
   const bytes=Buffer.from(patchRegistration(relative.slice('backend/'.length),(await entryBytes(zin,e)).toString('utf8')));
   patched.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});zout.addBuffer(bytes,name);
  }else if(relative==='build-manifest.json'){
   // Preserve original provenance under a distinct name, never claim unchanged hashes.
   zout.addReadStream(await streamEntry(zin,e),'app/base-build-manifest.json');
  }else zout.addReadStream(await streamEntry(zin,e),name,{compress:true});
 }
 const referralReader=await readFile(new URL('../../js/incoming-referral.mjs',import.meta.url));
 zout.addBuffer(referralReader,'app/backend/js/incoming-referral.mjs');
 zout.addBuffer(launcher,'777Codex.exe');
 zout.addBuffer(Buffer.from(JSON.stringify({...descriptor,client_registration:'register-button',layout:'single-entry-v1'})),'app/referral.json');
 zout.addBuffer(Buffer.from(`[InternetShortcut]\r\nURL=${shareUrl}\r\n`),'先注册账号.url');
 zout.addBuffer(Buffer.from('1. 将压缩包完整解压到一个文件夹，不要删除里面的文件。\r\n2. 双击 777Codex.exe，点击“登录 / 注册账号”。\r\n3. 新用户点击“注册账号”，网页会带上分享者的邀请码；已有账号直接登录，不更换邀请人。\r\n4. 回到软件完成网页登录，按首页提示连接并开始聊天。\r\n'),'使用说明.txt');
 zout.addBuffer(Buffer.from(JSON.stringify({schema:'777codes-share-upgrade-v1',baseSha256:descriptor.base.sha256,signed:false,modifiedFiles:patched,launcherSha256:createHash('sha256').update(launcher).digest('hex'),referralReaderSha256:createHash('sha256').update(referralReader).digest('hex')},null,2)),'share-manifest.json');
 progress('compressing',60);zout.end();await finished;
 await verify(partialZip,['777Codex.exe','app/777Codex.exe','app/777-native.exe','app/777-codexpp.exe','app/referral.json','app/backend/js/incoming-referral.mjs']);
}
async function hashFd(fd,size){const h=createHash('sha256'),s=createReadStream('',{fd,autoClose:false,start:0,end:size-1});for await(const b of s)h.update(b);return h.digest('hex');}
async function verify(path,required){const z=await new Promise((ok,fail)=>yauzl.open(path,{lazyEntries:true,validateEntrySizes:true},(e,x)=>e?fail(e):ok(x))),names=new Set();try{for(;;){const e=await nextEntry(z);if(!e)break;names.add(e.fileName);if(!e.fileName.endsWith('/'))for await(const _ of await streamEntry(z,e)){} }for(const n of required)if(!names.has(n))reject('INVALID');}finally{z.close();}}
async function main(){
 const {inputZip,partialZip,shareUrl,descriptor}=workerData,fh=await open(inputZip,'r');let zin;
 try{
  const st=await fh.stat();if(st.size!==descriptor.base.bytes)reject('HASH');progress('hashing',18);if(await hashFd(fh.fd,st.size)!==descriptor.base.sha256)reject('HASH');
  if(descriptor.platform==='mac'){
   // Preserve the original signed/symlinked executable archive byte-for-byte.
   // macOS, not Windows, extracts the inner ZIP with its permissions intact.
   const name=descriptor.arch==='arm64'?'Mac-Apple-公测版-1.0.zip':'Mac-Intel-公测版-1.0.zip';
   const names=[name,'referral.json','先注册账号.webloc','使用说明.txt'];
   const zout=new yazl.ZipFile(),dest=createWriteStream(partialZip,{flags:'wx'});
   const finished=once(dest,'close');zout.outputStream.on('error',e=>dest.destroy(e));zout.outputStream.pipe(dest);
   zout.addReadStream(createReadStream('',{fd:fh.fd,autoClose:false,start:0,end:st.size-1}),name,{compress:false});
   zout.addBuffer(Buffer.from(JSON.stringify(descriptor)),names[1]);
   zout.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>URL</key><string>${shareUrl.replaceAll('&','&amp;')}</string></dict></plist>`),names[2]);
   zout.addBuffer(Buffer.from('1. 双击“先注册账号.webloc”，打开注册网页。\n2. 新用户确认邀请码后注册；已有账号直接登录，不更换邀请人。\n3. 解压文件夹里的安装包，打开应用。\n4. 回到软件完成网页登录，按首页提示连接并开始聊天。\n'),names[3]);
   progress('compressing',45);zout.end();await finished;
   if(await hashFd(fh.fd,st.size)!==descriptor.base.sha256)reject('HASH');
   await verify(partialZip,names);progress('ready',98);return;
  }
  progress('scanning',30);zin=await openFd(fh.fd);const entries=[],seen=new Set();let expanded=0,exe='';
  for(;;){const e=await nextEntry(zin);if(!e)break;if(entries.length>=MAX_ENTRIES)reject('LIMIT');safeName(e.fileName,seen);const mode=(e.externalFileAttributes>>>16)&0xf000;if(mode===0xa000)reject('UNSAFE');expanded+=e.uncompressedSize;if(e.uncompressedSize>MAX_ENTRY||expanded>MAX_EXPANDED||(e.uncompressedSize>1048576&&(e.compressedSize===0||e.uncompressedSize/e.compressedSize>MAX_RATIO)))reject('LIMIT');if(/(^|\/)777Codex\.exe$/i.test(e.fileName)){if(exe)reject('UNSAFE');exe=e.fileName;}entries.push(e);}
  if(!exe)reject('INVALID');const prefix=exe.slice(0,-'777Codex.exe'.length);
  if(descriptor.base.sha256==='c7bd341d9d320577d2adfd49a4da3cef817442dec7b79401381bfd9fae25eb33'){
   await upgradedWindows(zin,entries,prefix,partialZip,descriptor,shareUrl);
   if(await hashFd(fh.fd,st.size)!==descriptor.base.sha256)reject('HASH');progress('ready',98);return;
  }
  const extraNames=[prefix+'referral.json',prefix+'先注册账号.url',prefix+'邀请来源说明.txt'];for(const n of extraNames)safeName(n,seen);
  progress('compressing',45);const zout=new yazl.ZipFile(),dest=createWriteStream(partialZip,{flags:'wx'});zout.outputStream.pipe(dest);
  let i=0;for(const e of entries){if(e.fileName.endsWith('/'))zout.addEmptyDirectory(e.fileName);else zout.addReadStream(await streamEntry(zin,e),e.fileName,{compress:true});if(++i%50===0)progress('compressing',Math.min(88,45+Math.floor(43*i/entries.length)));}
  zout.addBuffer(Buffer.from(JSON.stringify(descriptor)),extraNames[0]);zout.addBuffer(Buffer.from(`[InternetShortcut]\r\nURL=${shareUrl}\r\n`),extraNames[1]);zout.addBuffer(Buffer.from('先打开“先注册账号.url”，确认页面显示的邀请来源，再注册账号；平台在线验证后才可能绑定。已有账号不会改绑；此离线文件未签名，不代表已绑定。'),extraNames[2]);zout.end();await once(dest,'close');
  progress('verifying',90);const after=await fh.stat();if(after.size!==descriptor.base.bytes||await hashFd(fh.fd,after.size)!==descriptor.base.sha256)reject('HASH');progress('verifying',94);await verify(partialZip,extraNames);progress('ready',98);
 }finally{await fh.close().catch(()=>{});}
}
main().then(()=>parentPort.postMessage({done:true})).catch(e=>parentPort.postMessage({error:['UNSAFE','LIMIT','HASH','INVALID'].includes(e.code)?e.code:/invalid relative path|absolute path/i.test(e.message)?'UNSAFE':'INVALID'}));
