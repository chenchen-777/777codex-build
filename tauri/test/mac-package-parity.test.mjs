import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Mac staging retains all approved UI and tools, bundles image dependencies',async()=>{
 const source=await readFile(new URL('../scripts/stage-mac-source.mjs',import.meta.url),'utf8');
 for(const file of ['tool-ui.js','tool-ui.css','inline-models.js','install-flow.js','tool-doctor','windows-api.mjs'])assert.ok(source.includes("'"+file+"'"),file);
 assert.match(source,/await compactImageComponent\(from,/);
 assert.doesNotMatch(source,/display\s*:\s*none/);
 assert.match(source,/publicRedistributable:true/);
 assert.match(source,/userConfirmed:true/);
});

test('Mac package preserves Doctor dependency and checks native architecture and window',async()=>{
 const source=await readFile(new URL('../scripts/package-mac.mjs',import.meta.url),'utf8');
 assert.match(source,/'tool-doctor','node_modules','smol-toml'/);
 assert.match(source,/'share-zip','node_modules'/);
 assert.match(source,/load\('yauzl'\);load\('yazl'\)/);
 assert.match(source,/readFile\(join\(root,'release-readiness\.json'\)/);
 assert.match(source,/publicRedistributable/);
 assert.match(source,/process.platform!=='darwin'/);
 assert.match(source,/Architecture mismatch/);
 assert.match(source,/Packaged WebKit smoke failed/);
 assert.match(source,/使用说明.txt/);
 for(const step of ['1. 将','2. 登录','3. 按首页','4. 点击'])assert.ok(source.includes(step));
});
