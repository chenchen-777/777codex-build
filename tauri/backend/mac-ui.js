// Loaded before shared UI scripts. Callbacks run after boot.
window.manager777Mac=true;
document.documentElement.dataset.platform='darwin';
(() => {
  const $=s=>document.querySelector(s);
  const panel=document.createElement('section');panel.id='mac-components';panel.className='panel mac-notice';
  panel.innerHTML=`<h2>Mac 下载与安装</h2><p>下载 → 校验 → 安装。更新时请先退出 Codex。</p>
    <section class="install-flow-card" id="mac-install-flow"><ol class="install-flow-steps"><li>1 检查</li><li>2 下载</li><li>3 安装</li></ol><h2 id="mac-flow-title">正在读取安装状态</h2><p id="mac-flow-note">不会在检查前修改应用。</p><button class="primary" id="mac-flow-main" data-mac-main disabled>请稍候</button></section>
    <details class="install-flow-details"><summary>更多选项与详细进度</summary>
      <div class="mac-action-grid"><button class="button ghost" data-mac-action="check">检查来源</button><button class="button ghost" data-mac-action="download">重新下载安装包</button><button class="button ghost" data-mac-action="install">使用已校验安装包</button><button class="button ghost danger-text" data-mac-action="uninstall">卸载 Codex</button></div>
      <p id="mac-task-message" role="status" aria-live="polite">正在读取状态…</p><progress id="mac-task-progress" max="100" value="0"></progress>
      <dl class="mac-facts"><dt>版本</dt><dd id="mac-package-version">下载后校验</dd><dt>芯片</dt><dd id="mac-arch">检测中</dd><dt>安装包位置</dt><dd id="mac-package-path">读取中</dd><dt>恢复副本</dt><dd id="mac-recovery">暂无</dd></dl>
      <details><summary>任务记录</summary><pre id="mac-task-log"></pre></details>
    </details>
    <h3 id="mac-zh-heading">汉化 Codex</h3><p>创建独立中文副本，保留官方应用。官方更新后需要重新构建；未知版本会停止，不强行修改。</p>
    <div class="mac-action-grid"><button class="button primary" id="mac-zh-install" data-mac-action="zh-install">安装中文版</button><button class="button ghost" id="mac-zh-launch" data-mac-action="zh-launch">启动中文版</button><button class="button ghost" data-mac-action="zh-remove">移除中文版</button><button class="button ghost" data-mac-action="security">打开安全设置</button></div>
    <p>本工具和中文副本尚未通过 Apple 公证。“打开安全设置”只导航到设置，不会自动授权或关闭系统防护。</p>`;
  $('#codex-installer-panel')?.before(panel);
  $('#codex-download').textContent='安装 / 更新';
  $('#codex-uninstall').textContent='卸载';$('#home-uninstall').textContent='卸载';
  $('#home-codex-zh-detail').textContent='构建、启动和移除中文副本';
  const intro=$('#page-codex .page-header p');if(intro)intro.textContent='管理 Mac 客户端、安装包和中文副本。';
  $('#manager-update-status').textContent='请从平台下载与你芯片匹配的管理工具新版。';
  let pending=false,lastBusy=false,lastStatus=null;
  function showPanel(zh=false){window.manager777.openPage('codex');(zh?$('#mac-zh-heading'):panel).scrollIntoView({behavior:'smooth',block:'start'});}
  const confirmations={install:'将安装已校验的官方 Codex。更新前请先退出客户端；旧程序保留恢复副本，聊天记录和 Key 不会删除。继续？',uninstall:'只卸载当前识别到的官方 Codex，保留聊天记录、Key 和程序恢复副本。请先退出客户端。继续？','zh-install':'将从官方应用创建独立中文副本，并使用本地签名。官方文件不修改；副本不是 Apple 公证应用，首次运行可能需要你在系统设置确认。继续？','zh-remove':'移除独立中文副本并保留恢复副本，官方应用及聊天记录不受影响。继续？'};
  async function refresh(){
    try{const [s,codex]=await Promise.all([window.manager777.api('/api/mac/status'),window.manager777.api('/api/codex/status')]);lastStatus=s;
      $('#mac-task-message').textContent=s.message;
      $('#mac-package-version').textContent=s.version||'下载后校验';$('#mac-arch').textContent=s.architecture==='arm64'?'Apple 芯片':'Intel（官方包需单独校验兼容性）';
      $('#mac-package-path').textContent=s.packagePath;$('#mac-recovery').textContent=s.recoveryPath||'暂无';
      $('#mac-task-log').textContent=(s.events||[]).map(e=>`${e.at} ${e.message}`).join('\n');
      const progress=$('#mac-task-progress');if(s.busy&&!s.size)progress.removeAttribute('value');else progress.value=s.phase==='ready'||s.phase==='complete'?100:Math.min(100,s.size?100*(s.bytes||0)/s.size:0);
      const installed=!!codex.installed,ready=!!(s.packageExists&&s.sha256),update=installed&&ready&&s.version&&codex.version&&s.version!==codex.version;
      const flow=$('#mac-install-flow'),main=$('#mac-flow-main');let title='准备 Codex 客户端',note='自动下载并校验与你芯片匹配的官方安装包。',label='下载安装',next='download';
      if(s.busy){title=s.phase==='downloading'?'正在下载安装包':s.phase==='installing'?'正在安装 Codex':'正在处理';note=s.message||'请稍候，不要关闭管理工具。';label='请稍候';next='';}
      else if(ready&&(!installed||update)){title=update?'Codex 可以更新':'安装包已校验';note=`${s.version||'当前版本'} · ${installed?'可以安全安装更新。':'可以安全安装。'}`;label=installed?'更新':'安装';next='install';}
      else if(installed){title='Codex 已安装';note=`版本 ${codex.version||'已识别'} · 可以开始使用。`;label='启动';next='launch';}
      if(s.phase==='complete'&&installed&&!ready){title='Codex 已就绪';note=`版本 ${codex.version||s.version||'已识别'} · 现在可以开始使用。`;label='启动';next='launch';}
      $('#mac-flow-title').textContent=title;$('#mac-flow-note').textContent=note;main.textContent=label;main.dataset.macMain=next;main.disabled=pending||s.busy||s.isolated||!next;
      flow.querySelectorAll('li').forEach((li,i)=>li.classList.toggle('active',i===(installed?2:ready?1:0)));
      const zhCompatible=!!(s.zhInstalled&&s.zhVersion&&codex.version&&s.zhVersion===codex.version),zhInstall=$('#mac-zh-install'),zhLaunch=$('#mac-zh-launch');
      zhInstall.textContent=!s.zhInstalled?'安装中文版':zhCompatible?'重新安装中文版':'更新中文版';zhInstall.className=zhCompatible?'button ghost':'button primary';zhLaunch.className=zhCompatible?'button primary':'button ghost';
      panel.querySelectorAll('[data-mac-action]').forEach(b=>{b.disabled=pending||s.busy||s.isolated||b.dataset.macAction==='install'&&!ready||b.dataset.macAction==='zh-install'&&!installed||b.dataset.macAction==='zh-launch'&&!zhCompatible||b.dataset.macAction==='zh-remove'&&!s.zhInstalled;});
      if(lastBusy&&!s.busy){await window.manager777.refreshCodex();window.dispatchEvent?.(new Event('manager777:installation-changed'));await window.demoAlignedUI?.refresh?.();}lastBusy=s.busy;
    }catch(error){$('#mac-task-message').textContent=`状态读取失败：${error.message}`;}
  }
  async function act(action){
    if(pending)return;pending=true;
    try{if(confirmations[action]&&!await window.manager777.confirm(confirmations[action]))return;await window.manager777.api('/api/mac/action',{method:'POST',body:JSON.stringify({action,confirm:`MAC_${action}`})});}
    catch(error){window.manager777.showToast(error.message,true);$('#mac-task-message').textContent=error.message;}
    finally{pending=false;await refresh();}
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-mac-main],[data-mac-action],#codex-download,#codex-uninstall,#home-uninstall,#home-codex-zh');if(!target)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(target.dataset.macMain){if(target.dataset.macMain==='launch')void window.manager777.api('/api/codex/launch',{method:'POST',body:'{}'}).catch(error=>window.manager777.showToast(error.message,true));else void act(target.dataset.macMain);return;}
    if(target.dataset.macAction){void act(target.dataset.macAction);return;}
    showPanel(target.id==='home-codex-zh');if(target.id==='codex-uninstall'||target.id==='home-uninstall')void act('uninstall');
  },true);
  document.addEventListener('DOMContentLoaded',()=>{void refresh();setInterval(()=>{if(!document.hidden)void refresh();},1500);});
})();
