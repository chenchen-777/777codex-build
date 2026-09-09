import {createHash} from 'node:crypto';
import {AppError} from './errors.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Same-length enable_i18n flag patch, adapted from the existing release-kit.
// Only a private app copy is passed here. Unknown ASAR layouts fail closed.
export function patchMacI18n(input){
  const fail=()=>{throw new AppError('当前 Codex 版本的汉化结构尚不兼容，官方应用未修改','MAC_ZH_INCOMPATIBLE',409);};
  if(input.length<16)fail();
  const n=input.readUInt32LE(12),start=8+input.readUInt32LE(4);
  if(n>32*1024*1024||16+n>start||start>input.length)fail();
  const headerBytes=input.subarray(16,16+n);let header;
  try{header=JSON.parse(headerBytes.toString());}catch{fail();}
  const output=Buffer.from(input);let changes=0,enabled=false;const replacements=new Map();
  const walk=(node)=>{for(const [name,entry] of Object.entries(node.files||{})){
    if(entry.files){walk(entry);continue;}
    if(!name.endsWith('.js')||entry.unpacked||entry.link)continue;
    const offset=Number(entry.offset),size=Number(entry.size),at=start+offset;
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||at+size>input.length)fail();
    const old=input.subarray(at,at+size),source=old.toString();
    if(!source.includes('enable_i18n'))continue;
    enabled ||= /get\([`"']enable_i18n[`"'],(?:!0|true\s*)\)/.test(source);
    const next=source.replace(/get\(([`"'])enable_i18n\1,(!1|false)\)/g,(_,q,v)=>{changes++;return `get(${q}enable_i18n${q},${v==='!1'?'!0':'true '})`;});
    if(next===source)continue;
    const bytes=Buffer.from(next);if(bytes.length!==size)fail();bytes.copy(output,at);
    if(entry.integrity){
      const integrity=entry.integrity,block=integrity.blockSize||4194304;
      if(integrity.algorithm!=='SHA256'||!Number.isSafeInteger(block)||block<=0)fail();
      const pairs=[[integrity.hash,hash(bytes)]];
      const blocks=[];for(let i=0;i<bytes.length;i+=block)blocks.push(hash(bytes.subarray(i,i+block)));
      if(blocks.length!==integrity.blocks?.length)fail();
      pairs.push(...blocks.map((value,i)=>[integrity.blocks[i],value]));
      for(const [before,after] of pairs){if(!/^[a-f0-9]{64}$/i.test(before)||replacements.has(before)&&replacements.get(before)!==after)fail();replacements.set(before,after);}
    }
  }};
  walk(header);if(!changes&&!enabled)fail();
  // Simultaneous replacement avoids replacing newly computed hashes again.
  const text=headerBytes.toString().replace(/[a-f0-9]{64}/gi,value=>replacements.get(value)||value);
  if(Buffer.byteLength(text)!==n)fail();Buffer.from(text).copy(output,16);
  return {buffer:output,headerHash:hash(Buffer.from(text)),changes,alreadyEnabled:!changes&&enabled};
}
