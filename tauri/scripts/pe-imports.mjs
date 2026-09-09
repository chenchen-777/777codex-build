import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function peImports(b){
const pe=b.readUInt32LE(0x3c),sections=b.readUInt16LE(pe+6),optional=pe+24,size=b.readUInt16LE(pe+20),plus=b.readUInt16LE(optional)===0x20b;
const table=optional+size;
function offset(rva){for(let i=0;i<sections;i++){const p=table+i*40,virtual=b.readUInt32LE(p+12),length=Math.max(b.readUInt32LE(p+8),b.readUInt32LE(p+16));if(rva>=virtual&&rva<virtual+length)return b.readUInt32LE(p+20)+rva-virtual;}throw new Error('Unmapped RVA');}
function string(rva){const p=offset(rva);return b.toString('ascii',p,b.indexOf(0,p));}
const rva=b.readUInt32LE(optional+(plus?112:96)+8);const imports=[];
for(let p=offset(rva);b.readUInt32LE(p+12);p+=20)imports.push(string(b.readUInt32LE(p+12)));
return imports;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(peImports(readFileSync(process.argv[2])),null,2));
