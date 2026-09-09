(() => {
  const invoke=(action)=>window.__TAURI_INTERNALS__.invoke('window_action',{action});
  window.window777=Object.freeze({minimize:()=>invoke('minimize'),toggleSize:()=>invoke('toggle-size'),close:async()=>{
    const result=await invoke('close');
    if(result.busy)window.manager777?.confirm('正在下载、安装或修改配置，请等待完成后再关闭。');
    return result;
  }});
  document.addEventListener('DOMContentLoaded',()=>{
    const footer=document.querySelector('#account-dialog-footer');
    if(footer)new MutationObserver(()=>{
      if(!footer.querySelector('#account-login-check')||footer.querySelector('[data-login-recovery]'))return;
      const group=document.createElement('div');group.dataset.loginRecovery='true';
      group.style.cssText='display:flex;gap:8px;flex-wrap:wrap;width:100%';
      const add=(label,action)=>{const button=document.createElement('button');button.type='button';button.className='button ghost';button.textContent=label;button.onclick=async()=>{
        button.disabled=true;
        const note=document.querySelector('#account-error');
        try{await action(note);}catch(error){if(note)note.textContent=error.message;}finally{button.disabled=false;}
      };group.append(button);};
      add('重新打开授权网页',async note=>{
        const result=await window.manager777.api('/api/account/login/start',{method:'POST',body:'{}'});
        if(note)note.textContent=result.message;
      });
      add('复制授权链接',async note=>{
        const state=await window.manager777.api('/api/account/status');
        if(!state.authorizeUrl)throw new Error('授权链接已过期，请点击“重新打开授权网页”。');
        const url=new URL(state.authorizeUrl);
        if(url.origin!=='https://www.777codes.codes'||!url.pathname.startsWith('/desktop/authorize'))throw new Error('授权地址无效，请重新登录。');
        try{await navigator.clipboard.writeText(url.href);}catch{
          const input=document.createElement('textarea');input.value=url.href;group.append(input);input.select();
          const copied=document.execCommand('copy');input.remove();if(!copied)throw new Error('复制失败，请使用重新打开授权网页。');
        }
        if(note)note.textContent='已复制。请在这台电脑的浏览器中登录并确认授权；不要把链接发给别人。';
      });
      footer.prepend(group);
    }).observe(footer,{childList:true});
    document.querySelector('.titlebar')?.addEventListener('mousedown',event=>{
      if(event.button===0&&!event.target.closest('button,a,input,select'))void invoke('drag');
    });
    document.querySelector('.review-badge').textContent='公测版 1.0';
    document.querySelector('.version-indicator').lastChild.textContent=' 公测版 1.0';
    // Electron update payloads cannot be applied to a Tauri distribution.
    for(const id of ['manager-update-check','manager-update-auto']){
      const element=document.getElementById(id);if(element){element.disabled=true;element.title='管理工具更新请从官网下载；Codex 更新请进入 Codex 管理';}
    }
  });
})();
