import {createHash,sign} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,cp,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {RELEASE,immutableUpdateUrl,updateTarget} from './release-info.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SECRET_PATTERN=/(^|[\\/])(?:\.release-secrets|\.ssh|\.git|\.env(?:\.|$)|credentials?)(?:[\\/]|$)|private[-_.]?key/i;
const PUBLIC_KEY_PATH=/^(?:[^/]+\.app\/Contents\/Resources\/)?backend\/js\/update-public\.pem$/;
function stable(value){if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;return JSON.stringify(value);}
export function signaturePayload(manifest){const copy={...manifest,package:{...manifest.package}};delete copy.package.signature;return Buffer.from(stable(copy));}
export async function sha256File(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export function assertNoCaseCollisions(paths){const seen=new Set();for(const path of paths){const folded=path.toLocaleLowerCase('en-US');if(seen.has(folded))throw Error(`Case-colliding path is not allowed: ${path}`);seen.add(folded);}}
export function isInsidePath(child,parent,pathApi={relative,isAbsolute,sep}){const rel=pathApi.relative(parent,child);return rel===''||(!rel.startsWith(`..${pathApi.sep}`)&&rel!=='..'&&!pathApi.isAbsolute(rel));}
async function canonicalOutput(path){let cursor=resolve(path);const suffix=[];while(!await access(cursor).then(()=>true,()=>false)){suffix.unshift(cursor.slice(dirname(cursor).length+1));const next=dirname(cursor);if(next===cursor)throw Error(`Cannot resolve output parent: ${path}`);cursor=next;}return resolve(await realpath(cursor),...suffix);}
export async function validateBundle(bundle,platform){
 bundle=await realpath(bundle);
 const files=[],names=[];let expandedBytes=0;
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name),rel=path.slice(bundle.length+1).replaceAll('\\','/');
  if(!rel||rel.startsWith('/')||rel.split('/').some(part=>!part||part==='.'||part==='..'))throw Error(`Unsafe release path: ${rel}`);
  const info=await lstat(path);
  if(info.isSymbolicLink()||(info.isFile()&&info.nlink>1))throw Error(`Link is not allowed: ${rel}`);
  if(SECRET_PATTERN.test('/'+rel)||(rel.toLowerCase().endsWith('.pem')&&!PUBLIC_KEY_PATH.test(rel)))throw Error(`Sensitive path is not allowed: ${rel}`);
  names.push(rel);assertNoCaseCollisions(names);
  if(info.isDirectory())await walk(path);
  else if(info.isFile()){
   if(PUBLIC_KEY_PATH.test(rel)&&/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(await readFile(path,'utf8')))throw Error(`Private key content is not allowed: ${rel}`);
   expandedBytes+=info.size;if(files.length>=10000||expandedBytes>1024*1024*1024)throw Error('Release bundle exceeds safety limits');
   files.push({path:rel,bytes:info.size,sha256:await sha256File(path),mode:info.mode&0o777});
  }else throw Error(`Unsupported file type: ${rel}`);
 }}
 await walk(bundle);if(!files.length)throw Error('Release bundle is empty');const paths=files.map(x=>x.path);
 if(platform==='win32'){for(const required of ['777Codex.exe','backend/','helpers/','runtime/'])if(required.endsWith('/')?!paths.some(x=>x.startsWith(required)):!paths.includes(required))throw Error(`Windows release is missing ${required}`);}
 else if(platform==='darwin'){if(!paths.some(x=>/^[^/]+\.app\/Contents\/MacOS\/777Codex$/.test(x)))throw Error('Mac release must contain a complete .app tree');}
 else throw Error('Unsupported platform');return files;
}
function run(file,args){return new Promise((ok,bad)=>{const child=spawn(file,args,{stdio:'inherit',windowsHide:true});child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error(`${file} exited ${code}`)));});}
// Keep archive entries identical to the signed inventory: no leading "./"
// and no ditto-generated __MACOSX resource-fork metadata.
async function archiveDirectory(source,archive){const entries=await readdir(source);if(process.platform==='darwin')await run('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr',source,archive]);else await run(join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'),['-a','-cf',archive,'-C',source,...entries]);}
export function parseArgs(argv){const values={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw Error('Arguments must be --name value pairs');values[argv[i].slice(2)]=argv[i+1];}return values;}
export async function buildUpdate(options){
 const platform=options.platform,arch=options.arch;updateTarget(platform,arch);
 const privateKeyInput=options.privateKey||process.env.MANAGER777_UPDATE_PRIVATE_KEY;
 if(!options.bundle||!options.output||!privateKeyInput)throw Error('Required: --bundle --output --platform --arch and --private-key (or MANAGER777_UPDATE_PRIVATE_KEY)');
 const bundle=await realpath(resolve(options.bundle)),privateKey=await realpath(resolve(privateKeyInput)),output=await canonicalOutput(options.output);
 if(isInsidePath(privateKey,bundle))throw Error('Update signing key must be outside the release bundle');
 if(isInsidePath(output,bundle)||isInsidePath(bundle,output))throw Error('Output and release bundle must not contain each other');
 if(await access(output).then(()=>true,()=>false))throw Error(`Refusing to overwrite ${output}`);
 const files=await validateBundle(bundle,platform);await access(privateKey);
 const scratch=await mkdtemp(join(tmpdir(),'777-tauri-update-'));try{
  const payload=join(scratch,'payload');await cp(bundle,payload,{recursive:true});await mkdir(output,{recursive:true});
  const archiveName=`777codex-tauri-${platform}-${arch}-${RELEASE.version}-r${RELEASE.revision}.zip`,archive=join(output,archiveName);await archiveDirectory(payload,archive);
  const info=await stat(archive);if(info.size>512*1024*1024)throw Error('Update archive exceeds client download limit');
  const manifest={schemaVersion:2,product:'777codex-tauri',channel:RELEASE.channel,platform,arch,version:RELEASE.version,revision:RELEASE.revision,minimumRevision:RELEASE.minimumUpdateRevision,publishedAt:options.publishedAt||new Date().toISOString(),notes:options.notes||'完整客户端安全更新。',package:{kind:'full-release-zip',url:immutableUpdateUrl(platform,arch,archiveName),bytes:info.size,sha256:await sha256File(archive),files,signature:''}};
  manifest.package.signature=sign(null,signaturePayload(manifest),await readFile(privateKey)).toString('base64');
  const manifestPath=join(output,'latest.json');await writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx'});return{output,archive,manifestPath,manifest};
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=parseArgs(process.argv.slice(2));const result=await buildUpdate({bundle:args.bundle,output:args.output,platform:args.platform,arch:args.arch,privateKey:args['private-key'],notes:args.notes,publishedAt:args['published-at']});process.stdout.write(`${JSON.stringify(result,null,2)}\n`);}
