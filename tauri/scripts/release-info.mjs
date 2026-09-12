// Public names are intentionally independent of storage IDs and updater channels.
export const RELEASE = Object.freeze({version:'1.0.0',displayVersion:'1.0',label:'公测版 1.0 · 账户余额修复',channel:'public-beta',revision:103,minimumUpdateRevision:102});
const UPDATE_ORIGIN='https://top777ai.com/downloads/777codex/tauri';
export function updateTarget(platform,arch){
  if(platform==='win32'&&arch==='x64')return 'win32-x64';
  if(platform==='darwin'&&arch==='arm64')return 'darwin-arm64';
  if(platform==='darwin'&&arch==='x64')return 'darwin-x64';
  throw new Error('Unsupported release platform/architecture');
}
export function updateManifestUrl(platform,arch,channel=RELEASE.channel){return `${UPDATE_ORIGIN}/${channel}/${updateTarget(platform,arch)}/latest.json`;}
export function immutableUpdateUrl(platform,arch,filename,{channel=RELEASE.channel,version=RELEASE.version,revision=RELEASE.revision}={}){
  if(!/^[A-Za-z0-9._-]+\.zip$/.test(filename))throw new Error('Unsafe update archive filename');
  return `${UPDATE_ORIGIN}/${channel}/${updateTarget(platform,arch)}/releases/${version}-r${revision}/${filename}`;
}
export function packageName(platform,arch){
  if(platform==='win32'&&arch==='x64')return 'Windows-公测版-1.0.zip';
  if(platform==='darwin'&&arch==='arm64')return 'Mac-Apple芯片-公测版-1.0.zip';
  if(platform==='darwin'&&arch==='x64')return 'Mac-Intel-公测版-1.0.zip';
  throw new Error('Unsupported release platform/architecture');
}
