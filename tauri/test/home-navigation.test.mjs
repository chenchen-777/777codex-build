import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {homeNavigation} from '../scripts/home-navigation.mjs';
const source=new URL('../backend/',import.meta.url);
const html=await readFile(new URL('index.html',source),'utf8');
const ui=await readFile(new URL('ui.js',source),'utf8');
test('Key sync is moved once to home with its original handler and status IDs',()=>{
 const result=homeNavigation(html,ui).html;
 const home=result.slice(result.indexOf('id="page-home"'),result.indexOf('id="page-tools"'));
 assert.ok(home.includes('当前 Key'));assert.ok(home.includes('同步账号 Key'));assert.ok(home.includes('id="platform-key-sync-status"'));
 assert.equal((result.match(/id="sync-platform-keys"/g)||[]).length,1);
 assert.equal((result.match(/id="platform-key-sync-status"/g)||[]).length,1);
 assert.ok(!result.includes('这次使用的 Key'));
});
test('three-page shell keeps Codex management reachable from home and toolbox',()=>{
 const result=homeNavigation(html,ui);
 const shell=result.html.slice(result.html.indexOf('id="onboarding-app"'),result.html.indexOf('legacy-app-window'));
 assert.deepEqual([...shell.matchAll(/data-shell-page="([^"]+)"/g)].map(match=>match[1]),['home','tools','account']);
 const tools=result.html.slice(result.html.indexOf('id="page-tools"'),result.html.indexOf('id="page-providers"'));
 assert.ok(tools.includes('data-page-link="codex"'));assert.ok(result.html.includes('<h1>Codex 管理</h1>'));
 assert.ok(result.html.includes('data-page-link="codex">安装 / 更新'));
 assert.ok(result.ui.includes("['enhance', 'sessions', 'extensions'].includes(pageName)"));
 for(const id of ['codex-launch','codex-restart','codex-download','codex-uninstall'])assert.ok(result.html.includes(`id="${id}"`));
 assert.deepEqual(homeNavigation(result.html,result.ui),result);
});
test('compact copy retains meaningful model states and detail access',()=>{
 const result=homeNavigation(html,ui);
 assert.ok(result.html.includes('<summary>配置详情</summary>'));
 assert.ok(!result.ui.includes('启动前检查 Key 是否支持此模型。'));
 for(const text of ['模型待验证','该 Key 不支持此模型','同步失败：','failureMessage','待实测'])assert.ok(result.ui.includes(text));
});
