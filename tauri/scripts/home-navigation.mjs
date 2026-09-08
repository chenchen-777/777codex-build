import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function homeNavigation(html, ui) {
  if (!html.includes('id="home-key-heading"')) {
    const oldLabel='<label><span>这次使用的 Key</span><select id="home-key-select">';
    if(!html.includes(oldLabel))throw new Error('Home Key source layout changed');
    html=html.replace('<button class="button ghost" id="sync-platform-keys">同步平台 Key</button>','');
    html=html.replace('<p class="modal-note" id="platform-key-sync-status" role="status">同步已登录账号的 Key、分组与倍率；不会自动切换当前 Key 或模型。</p>','');
    html=html.replace(oldLabel,'<div class="home-key-heading" id="home-key-heading"><label for="home-key-select">当前 Key</label><button type="button" class="button ghost" id="sync-platform-keys">同步账号 Key</button></div><label><select id="home-key-select" aria-label="当前 Key">');
    html=html.replace('<div class="home-model-controls">','<small id="platform-key-sync-status" role="status" aria-live="polite"></small><div class="home-model-controls">');
    const home='<button class="nav-item active" data-page="home"><span class="nav-icon">⌂</span><span>首页</span></button>';
    if(!html.includes(home))throw new Error('Home navigation source changed');
    html=html.replace(home,home+'\n          <button class="nav-item" data-page="codex" aria-label="Codex 管理"><span>Codex<br>管理</span></button>');
    html=html.replace('<button class="quick-entry" data-page-link="codex"><strong>安装、更新与卸载 Codex</strong><b>›</b></button>','');
    html=html.replace('<h1>Codex Desktop</h1>','<h1>Codex 管理</h1>');
  }
  ui=ui.replace("['enhance', 'sessions', 'extensions', 'codex'].includes(pageName)","['enhance', 'sessions', 'extensions'].includes(pageName)");
  html=html.replace('<summary>当前使用状态</summary>','<summary>配置详情</summary>');
  ui=ui.replace("`列表支持此模型；实际对话需测试。${homeDraft.dirty ? '启动时应用本次选择。' : ''}`","`模型已同步 · 待实测${homeDraft.dirty ? ' · 待应用' : ''}`")
    .replace("'当前 Key 不支持原模型，请重新选择。'","'该 Key 不支持此模型，请重新选择。'")
    .replace("'启动前检查 Key 是否支持此模型。'","'模型待验证'")
    .replace("'同步失败，暂不能确认模型支持。请重试。'","'同步失败，请重试'");
  return {html,ui};
}
export async function applyHomeNavigation(target) {
  const result=homeNavigation(await readFile(join(target,'index.html'),'utf8'),await readFile(join(target,'ui.js'),'utf8'));
  await writeFile(join(target,'index.html'),result.html);
  await writeFile(join(target,'ui.js'),result.ui);
  await writeFile(join(target,'tauri-window.css'),await readFile(new URL('../ui/tauri-window.css',import.meta.url),'utf8'));
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])await applyHomeNavigation(fileURLToPath(new URL('../backend/',import.meta.url)));
