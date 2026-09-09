import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('GCC display name is shared across Windows and Mac without changing credential identities',async()=>{
 const [html,bootstrap,rust,configText,pack,css]=await Promise.all(['backend/index.html','bootstrap/index.html','src-tauri/src/main.rs','src-tauri/tauri.conf.json','scripts/package-mac.mjs','backend/tauri-window.css'].map(read));
 const config=JSON.parse(configText);
 assert.equal(config.productName,'GCC CodeX 管理工具');
 assert.match(html,/<div class="brand-title">GCC CodeX 管理工具 /);
 assert.match(bootstrap,/<title>GCC CodeX 管理工具<\/title>/);
 assert.match(rust,/\.title\("GCC CodeX 管理工具/);
 assert.match(pack,/<key>CFBundleDisplayName<\/key><string>GCC CodeX 管理工具<\/string>/);
 assert.match(pack,/<key>CFBundleIdentifier<\/key><string>codes\.777\.manager\.tauri\.candidate<\/string>/);
 assert.match(css,/\.brand-title \{ font-size:13px; line-height:1\.25; white-space:normal/);
 assert.doesNotMatch(html,/管理工具 管理工具/);
});
