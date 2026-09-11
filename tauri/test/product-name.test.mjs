import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('public shell uses the 777codes name while native package and credential identities stay stable',async()=>{
 const [html,bootstrap,rust,configText,pack,css]=await Promise.all(['backend/index.html','bootstrap/index.html','src-tauri/src/main.rs','src-tauri/tauri.conf.json','scripts/package-mac.mjs','backend/tauri-window.css'].map(read));
 const config=JSON.parse(configText);
 assert.equal(config.productName,'GCC CodeX 管理工具');
 assert.match(html,/id="onboarding-app" aria-label="777codes 管理工具"/);
 assert.match(html,/<strong>777codes 管理工具<\/strong>/);
 assert.match(html,/<div class="app-window legacy-app-window" hidden>/);
 assert.match(bootstrap,/<title>GCC CodeX 管理工具<\/title>/);
 assert.match(rust,/\.title\("GCC CodeX 管理工具/);
 assert.match(pack,/<key>CFBundleDisplayName<\/key><string>GCC CodeX 管理工具<\/string>/);
 assert.match(pack,/<key>CFBundleIdentifier<\/key><string>codes\.777\.manager\.tauri\.candidate<\/string>/);
 assert.match(css,/\.brand-title \{ font-size:13px; line-height:1\.25; white-space:normal/);
 assert.doesNotMatch(html,/管理工具 管理工具/);
});
