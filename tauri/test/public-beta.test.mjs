import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RELEASE,packageName} from '../scripts/release-info.mjs';
import {BUILD_INFO} from '../backend/js/build-info.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('public beta uses short distinct package names and one release version',async()=>{
 assert.equal(RELEASE.version,'1.0.0');assert.equal(BUILD_INFO.version,RELEASE.version);
 assert.equal(BUILD_INFO.channel,'public-beta');assert.match(BUILD_INFO.updateManifestUrl,/^https:\/\/top777ai\.com\/downloads\/777codex\/tauri\/public-beta\/(?:win32-x64|darwin-(?:arm64|x64))\/latest\.json$/);
 assert.equal(JSON.parse(await read('src-tauri/tauri.conf.json')).version,RELEASE.version);
 const names=[packageName('win32','x64'),packageName('darwin','arm64'),packageName('darwin','x64')];
 assert.equal(new Set(names).size,3);for(const name of names){assert.match(name,/公测版-1\.0\.zip$/);assert.doesNotMatch(name,/Tauri|candidate|0\.12|r43/);}
 assert.throws(()=>packageName('win32','arm64'));
 for(const path of ['backend/index.html','ui/tauri-window.js','backend/tauri-window.js']){
  const source=await read(path);assert.match(source,/公测版 1\.0/);assert.doesNotMatch(source,/迁移候选|r43/);
 }
 const html=await read('backend/index.html');
 assert.deepEqual([...html.matchAll(/data-shell-page="([^"]+)"/g)].map(match=>match[1]),['home','tools','account']);
});
test('Windows and Mac share functional fixes without changing credential paths',async()=>{
 const paths=await read('scripts/runtime-paths.mjs');assert.match(paths,/777Codex-Tauri-(?:Candidate|Public-Beta)/);
 const rust=await read('src-tauri/src/main.rs');
 assert.match(rust,/let isolated=.*args.*"--isolated".*MANAGER777_ISOLATED/s);
 assert.doesNotMatch(rust,/else\s*\{\s*!.*args.*"--isolated"/s);
 assert.match(await read('backend/features-ui.js'),/__TAURI_INTERNALS__/);
 assert.match(await read('scripts/package-portable.mjs'),/777-codexpp\.exe/);
 assert.match(await read('scripts/package-mac.mjs'),/777-codexpp/);
 assert.match(await read('backend/js/model-service.mjs'),/INSUFFICIENT_BALANCE/);
});
