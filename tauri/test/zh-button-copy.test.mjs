import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {patchZhButtonCopy} from '../scripts/zh-button-copy.mjs';
test('Chinese install label follows installed and compatible state',async()=>{
 const source=patchZhButtonCopy(await readFile(new URL('../windows-baseline-1.0/features-ui.js',import.meta.url),'utf8'));
 const expression=source.match(/button\("install-zh", (.*?), !result\.official/)[1];
 for(const [installed,compatible,label]of [[false,false,'安装中文版'],[true,true,'重新安装中文版'],[true,false,'更新中文版']])assert.equal(vm.runInNewContext(expression,{zh:{installed,compatible}}),label);
 assert.match(source,/classList.replace\('ghost','primary'\)/);
 assert.equal(patchZhButtonCopy(source),source);
});
