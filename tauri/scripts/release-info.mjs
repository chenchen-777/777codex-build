// Public names are intentionally independent of storage IDs and updater channels.
export const RELEASE = Object.freeze({version:'1.0.0',displayVersion:'1.0',label:'公测版 1.0 · 连接修复',channel:'public-beta',revision:101});
export function packageName(platform,arch){
  if(platform==='win32'&&arch==='x64')return 'Windows-公测版-1.0.zip';
  if(platform==='darwin'&&arch==='arm64')return 'Mac-Apple芯片-公测版-1.0.zip';
  if(platform==='darwin'&&arch==='x64')return 'Mac-Intel-公测版-1.0.zip';
  throw new Error('Unsupported release platform/architecture');
}
