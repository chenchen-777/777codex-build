(()=>{
 if(window.manager777Mac)return;
 const $=s=>document.querySelector(s),panel=$('#codex-installer-panel');if(!panel)return;
 const heading=panel.querySelector('.section-title');
 const card=document.createElement('section');card.className='install-flow-card';
 card.innerHTML='<ol class="install-flow-steps"><li>1 检查</li><li>2 下载</li><li>3 安装</li></ol><h2 id="flow-title">正在读取安装状态</h2><p id="flow-note" role="status" aria-live="polite"></p><button id="flow-main" class="primary" disabled>请稍候</button>';
 const details=document.createElement('details');details.className='install-flow-details';details.innerHTML='<summary>更多选项与详细进度</summary>';
 for(const child of [...panel.children])if(child!==heading)details.append(child);
 panel.append(card,details);if(heading)heading.querySelector('p').textContent='按提示完成安装，然后开始使用。';
 let busy=false,autoPlan='',status=null,installed=null,lastCompletion='',polling=false;
 async function api(path,body){const r=await fetch(path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message||'状态读取失败，请重试');return v;}
 function paint(){if(!status)return;const s=status,p=s.phase,button=$('#flow-main');
 let title='准备安装 Codex',note='一次确认，自动检查版本、下载并安装。',label='下载安装',disabled=!!(busy||s.busy||s.isolated);
 if(installed?.installed&&!autoPlan&&!s.busy){title='Codex 已安装';note=`版本 ${installed.version||'已识别'} · 可以开始使用。`;label='开始使用';}
 if(p==='planning'){title='正在检查版本';note='正在寻找适合这台电脑的安装包。';}
 if(p==='downloading'){title='正在下载安装包';note=s.plan?.size?`${((s.bytes||0)/1048576).toFixed(1)} / ${(s.plan.size/1048576).toFixed(1)} MB`:'正在下载，请稍候。';}
 if(p==='verifying'){title='下载完成，正在检查';note='检查通过后才能安装，这时还没有安装完成。';}
 if(p==='ready'){title='安装包已准备好';note='无需重新下载，下一步安装到电脑。';label='安装 Codex';}
 if(p==='installing'){title='正在安装 Codex';note='请等待安装结果，不要关闭管理工具。';}
 if(p==='complete'&&installed?.installed){title='安装成功';note=`版本 ${installed.version||s.plan?.version||'已识别'} · 现在可以开始使用。`;label='开始使用';}
 if(p==='complete'&&!installed?.installed){title='正在确认安装结果';note='尚未识别到客户端，请重新检查。';label='重新检查';}
 if(['error','interrupted','paused','cancelled'].includes(p)&&!installed?.installed){title=p==='paused'?'下载已暂停':'安装尚未完成';note=s.message||'请重试，已下载的内容会尽量复用。';label='继续 / 重试';}
 $('#flow-title').textContent=title;$('#flow-note').textContent=note;button.textContent=disabled?'请稍候…':label;button.disabled=disabled;
 card.dataset.success=String(!!installed?.installed&&!s.busy);card.dataset.failed=String(p==='error');
 card.querySelectorAll('li').forEach((li,i)=>li.classList.toggle('active',i===(['installing','complete'].includes(p)?2:['downloading','verifying','ready'].includes(p)?1:0)));
 }
 async function refresh(){if(polling)return;polling=true;try{
  status=await api('/api/codex/installer');
  if(!status.busy)installed=await api('/api/codex/status');
  if(status.phase==='complete'&&installed?.installed&&lastCompletion!==status.plan?.id){lastCompletion=status.plan?.id;autoPlan='';window.dispatchEvent(new Event('manager777:installation-changed'));}
  if(autoPlan&&status.plan?.id!==autoPlan)autoPlan='';
  if(autoPlan&&['error','paused','cancelled','interrupted'].includes(status.phase))autoPlan='';
  if(autoPlan&&status.phase==='ready'&&!status.busy&&!busy){autoPlan='';busy=true;try{status=await api('/api/codex/installer/install',{});}finally{busy=false;}}
  paint();
 }catch(e){autoPlan='';$('#flow-note').textContent=e.message;$('#flow-main').disabled=false;$('#flow-main').textContent='重新检查';status=null;}finally{polling=false;}}
 $('#flow-main').onclick=async()=>{
  if(busy)return;
  if(!status||status.phase==='complete'&&!installed?.installed){await refresh();return;}
  if(installed?.installed&&status.phase!=='ready'){document.querySelector('[data-shell-page="home"]')?.click();return;}
  if(!await window.manager777.confirm('下载并安装 Codex？请先保存正在进行的工作。'))return;
  busy=true;paint();try{
   const sourceId=$('#install-source').value,route=$('#install-route').value;
   if(!status.plan||status.plan.sourceId!==sourceId||status.plan.route!==route||['complete','idle'].includes(status.phase))status=await api('/api/codex/installer/plan',{sourceId,route});
   autoPlan=status.plan.id;
   if(status.phase==='ready'){autoPlan='';status=await api('/api/codex/installer/install',{});}
   else status=await api('/api/codex/installer/download',{});
  }catch(e){autoPlan='';status={...status,phase:'error',busy:false,message:e.message};installed=null;details.open=true;}finally{busy=false;paint();}
 };
 window.addEventListener('manager777:installation-changed',()=>void window.demoAlignedUI?.refresh());
 document.addEventListener('click',e=>{if(e.target.closest('[data-shell-page="home"],[data-shell-action="home"]'))void window.demoAlignedUI?.refresh();});
 setInterval(()=>{if(!document.hidden&&(autoPlan||status?.busy||panel.closest('.shell-tool-active')))void refresh();},2000);void refresh();
})();
