(() => {
  if(window.manager777Mac)return;
  const $=s=>document.querySelector(s);let pending=false,initialized=false,lastStatus=null;
  const labels={idle:'尚未开始',planning:'检查版本中',planned:'可下载',downloading:'下载中',verifying:'校验中',ready:'已下载，待安装',installing:'安装中',complete:'上次安装完成',paused:'已暂停',cancelled:'已取消',interrupted:'上次任务中断',error:'操作未完成'};
  async function api(path,body) {const r=await fetch('/api/codex/installer'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json();if(!r.ok)throw new Error(v.message||'请求失败');return v;}
  function render(s) {
    lastStatus=s;
    const p=s.plan;const locked=s.busy||s.isolated||pending;
    if(!initialized){if(p){$('#install-source').value=p.sourceId;$('#install-route').value=p.route;}initialized=true;}
    const changed=!!p&&(p.sourceId!==$('#install-source').value||p.route!==$('#install-route').value);
    const ready=s.phase==='ready'&&s.packageExists===true;
    const missing=s.phase==='ready'&&!s.packageExists;
    let title=labels[s.phase]||s.phase,help='选择来源与安装方式，再点击「检查版本」。';
    if(s.phase==='planned'||s.phase==='cancelled')help=s.packageExists?'发现已有安装包，点击「校验已有安装包」，通过后即可安装；无需重复下载。':'版本已确认。先点击「下载安装包」，完成后再点击「安装 Codex」。';
    if(s.phase==='planned'&&s.packageExists)title='发现已有安装包，待校验';
    if(s.phase==='downloading')help='正在下载到下方保存位置。下载完成后还需要安装，请稍候。';
    if(s.phase==='verifying')help='正在检查安装包完整性、签名和版本，通过后才能安装。';
    if(ready)help='安装包已下载并校验，但这一步还没有安装。点击「前往安装」，无需重新下载。';
    if(missing){title='安装包文件已不在保存位置';help='请重新下载安装包，校验通过后再安装。';}
    if(s.phase==='installing')help='正在安装 Codex，请等待结果；此时无需再次点击。';
    if(s.phase==='complete')help='上次安装流程已完成。当前是否仍已安装，请查看上方 Codex 状态或点击「识别已安装」。';
    if(['paused','error','interrupted'].includes(s.phase))help='下载或安装尚未完成。请查看下方任务信息，点击「继续 / 重试」重新下载或校验。';
    if(changed){title='选项已更改，请重新检查版本';help='检查后才会应用新的更新源和安装方式；相同安装包可复用，不会重复下载。';}
    $('#install-stage-title').textContent=title;
    $('#install-stage-help').textContent=help;
    $('.install-next-step').dataset.ready=String(ready&&!changed);
    $('#install-go-to-commit').hidden=!ready||changed||locked;
    $('#install-package-path').textContent=s.packagePath||s.cacheDirectory||'暂时无法读取保存位置';
    $('#install-package-note').textContent=s.packageExists?'此安装包文件已在电脑上保存。下载完成不等于安装完成。':p?'这是安装包下载完成后的保存位置，目前没有完整文件。':'这是下载目录；检查版本后显示完整文件路径。';
    $('#install-version-info').textContent=p?.version||'尚未检查';
    $('#install-system-info').textContent=p?`Windows · ${p.architecture}`:'检查后显示';
    $('#install-size-info').textContent=p?`${(p.size/1024**2).toFixed(1)} MB`:'检查后显示';
    $('#install-source-info').textContent=p?new URL(p.url).hostname:'检查后显示';
    $('#install-method-note').textContent=$('#install-route').value==='msix'?'通用安装：安装到 Windows 应用列表。兼容性由安装前检查确认。':'便携安装：解压到管理工具的独立目录，不注册为系统应用。';
    $('#install-plan-description').textContent=p?`Codex ${p.version} · ${p.architecture} · ${(p.size/1024**2).toFixed(1)} MB · ${p.sourceName} · ${p.route==='msix'?'MSIX':'便携安装'}`:'首次无缓存时需要联网；程序包不内置 Codex。';
    $('#install-task-state').textContent=`${labels[s.phase]||s.phase}：${s.message||''}${s.phase==='downloading'?` ${(s.bytes/1024**2).toFixed(1)} MB`:''}`;
    $('#install-progress').value=p?Math.min(100,(s.bytes||0)/p.size*100):0;
    for(const id of ['install-check','install-adopt','install-source','install-route'])$('#'+id).disabled=locked;
    $('#install-download').textContent=s.packageExists?'校验已有安装包':'下载安装包';
    $('#install-download').disabled=locked||changed||!p||(!['planned','cancelled'].includes(s.phase)&&!missing);
    $('#install-pause').disabled=s.isolated||s.phase!=='downloading';
    $('#install-cancel').disabled=s.isolated||!['downloading','paused'].includes(s.phase);
    $('#install-resume').disabled=locked||changed||!p||!['paused','error','interrupted'].includes(s.phase);
    $('#install-commit').disabled=locked||changed||!ready;
    $('#install-clear').disabled=locked||!p;
  }
  async function refresh(){try{render(await api(''));}catch(e){$('#install-task-state').textContent=e.message;}}
  async function perform(action){if(pending)return;pending=true;let failure;if(lastStatus)render(lastStatus);try{render(await action());}catch(e){failure=e.message;}finally{pending=false;if(lastStatus)render(lastStatus);if(failure)$('#install-task-state').textContent=failure;}}
  for(const id of ['install-source','install-route'])$('#'+id).onchange=()=>{if(lastStatus)render(lastStatus);};
  $('#install-go-to-commit').onclick=()=>{$('#install-commit').scrollIntoView({block:'center',behavior:'smooth'});$('#install-commit').focus({preventScroll:true});};
  $('#install-check').onclick=()=>perform(()=>api('/plan',{sourceId:$('#install-source').value,route:$('#install-route').value}));
  $('#install-download').onclick=()=>perform(()=>api('/download',{}));
  $('#install-adopt').onclick=()=>perform(async()=>{await api('/adopt',{});$('#install-task-state').textContent='已接管检测到的 Codex';return api('');});
  for(const [id,action] of [['pause','pause'],['resume','resume'],['cancel','cancel'],['clear','clear-cache']])$('#install-'+id).onclick=()=>perform(()=>api('/control',{action}));
  $('#install-commit').onclick=async()=>{if(await window.manager777.confirm('安装此已校验版本？请先保存正在进行的 Codex 工作。安装前将备份会话。'))await perform(()=>api('/install',{}));};
  setInterval(()=>{if(!pending)void refresh();},1500);void refresh();
})();
