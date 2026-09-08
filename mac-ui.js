// Included only in the macOS package, before the shared UI scripts.
window.manager777Mac=true;
document.documentElement.dataset.platform='darwin';
(() => {
  const style=document.createElement('style');
  style.textContent=`#codex-installer-panel,#home-uninstall,#codex-uninstall,#uninstall-view,#image-mcp-entry,#home-codex-zh,[data-page-link="enhance"],[data-extension-tab="plugins"],#manager-update-check,#manager-update-auto {display:none!important} .mac-notice {padding:16px;margin-bottom:16px;border:1px solid #c5d5e5;border-radius:14px;background:#edf3f9;color:#233e58;line-height:1.6;overflow-wrap:anywhere} .mac-notice a{color:#284d72;text-decoration:underline}`;
  document.head.append(style);
  const note=document.createElement('div');note.className='mac-notice';note.id='mac-test-notice';note.setAttribute('role','note');
  note.textContent='macOS 测试版：支持 Key、模型配置、会话备份、MCP 与 Skill 配置管理。请先自行安装兼容的 Codex.app。汉化、Codex++、插件安装修复和一键安装组件暂未适配。未完成 Apple 公证及用户实机验收。';
  document.querySelector('#page-home .page-header').after(note);
  const instructions=document.createElement('section');instructions.className='panel mac-notice';
  instructions.innerHTML='<h2>安装与更新 Codex</h2><p>先从官方页面获取与你的芯片兼容的 Codex.app，放入 /Applications 或 ~/Applications。安装完成后返回本工具，选择 Key 并启动。更新或卸载由你在 macOS 中手动完成；本工具不会删除聊天记录。</p><p>Intel 版是管理工具的 Intel 版本，不代表官方 Codex 客户端已支持 Intel。</p>';
  document.querySelector('#codex-installer-panel').before(instructions);
  document.querySelector('#page-codex .page-header p').textContent='识别、启动与重启已安装的 Codex.app。';
  document.querySelector('#manager-update-status').textContent='macOS 测试版暂不自动更新，请到 GitHub 下载新版。';
  const link=document.createElement('a');link.href='https://github.com/chenchen-777/777codex/releases';link.textContent='GitHub 下载与版本说明';link.className='button ghost';
  // Browser navigation is intentionally disabled in the packaged client; show a copyable address.
  link.removeAttribute('href');link.setAttribute('role','button');link.tabIndex=0;
  const copy=()=>navigator.clipboard.writeText('https://github.com/chenchen-777/777codex/releases').then(()=>window.manager777.showToast('下载页面地址已复制'));
  link.addEventListener('click',copy);link.addEventListener('keydown',e=>{if(e.key==='Enter')void copy();});
  document.querySelector('#manager-update-check').after(link);
  document.addEventListener('click',event=>{
    const target=event.target.closest('#codex-download');
    if(target){event.preventDefault();event.stopImmediatePropagation();document.querySelector('#codex-download-page').click();}
  },true);
})();
