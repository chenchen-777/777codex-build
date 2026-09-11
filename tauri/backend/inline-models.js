(() => {
  const caches=new Map(),pending=new Map();
  const api=(path,body)=>window.manager777.api(path,body?{method:'POST',body:JSON.stringify(body)}:undefined);
  const escape=window.manager777.escapeHtml;
  function control(id,model){
    const box=document.createElement('div');box.className='inline-model-control';box.dataset.inlineModel=id;
    box.innerHTML=`<div class="inline-model-input"><select aria-label="选择此密钥的模型"><option value="${escape(model||'')}">${escape(model||'尚未选择')}</option><option value="__load">获取可选模型…</option></select><button type="button" class="model-reload" aria-label="刷新可选模型" title="刷新可选模型">↻</button></div><small class="model-feedback" role="status" aria-live="polite"></small>`;
    const select=box.querySelector('select'),note=box.querySelector('.model-feedback'),reload=box.querySelector('button');
    let current=model||'',loaded=null,saving=false;
    const populate=data=>{loaded=data;select.replaceChildren(...[...new Set([current,...data.models].filter(Boolean))].map(value=>new Option(value,value)));select.value=current;};
    const load=async(force=false)=>{
      if(saving)return;note.textContent='正在读取可选模型…';reload.disabled=true;
      try{
        let data=caches.get(id);
        if(force||!data||Date.now()-data.at>60000){
          if(!pending.has(id))pending.set(id,(async()=>{const list=await api('/api/providers'),provider=list.providers.find(p=>p.id===id);if(!provider)throw Error('此密钥已移除，请刷新列表');const result=await api('/api/providers/models',{id});return{models:result.models||[],provider,at:Date.now()};})().finally(()=>pending.delete(id)));
          data=await pending.get(id);caches.set(id,data);
        }
        if(!data.models.length)throw Error('没有取得可选模型，请稍后重试');
        populate(data);note.textContent='选择后保存，下次启动 Codex 时生效。';
      }catch(error){note.textContent='读取失败：'+error.message;select.value=current;}
      finally{reload.disabled=false;}
    };
    select.addEventListener('focus',()=>{if(!loaded)void load();});
    reload.addEventListener('click',()=>void load(true));
    select.addEventListener('change',async()=>{
      if(select.value==='__load'){select.value=current;await load();return;}
      const model=select.value;if(model===current||saving)return;
      if(!loaded?.models.includes(model)){select.value=current;note.textContent='请先刷新此密钥支持的模型';return;}
      saving=true;select.disabled=reload.disabled=true;note.textContent='正在保存模型…';
      try{
        await api('/api/providers/model-choice',{id,model,expectedUpdatedAt:loaded.provider.updatedAt});
        current=model;caches.delete(id);loaded=null;
        await window.manager777.refreshProviders();await window.demoAlignedUI?.refresh();
        window.manager777.showToast('模型已保存；下次从管理工具启动 Codex 时生效，当前对话未中断。');
      }catch(error){select.value=current;note.textContent='保存失败：'+error.message;}
      finally{saving=false;select.disabled=reload.disabled=false;}
    });
    const cached=caches.get(id);if(cached&&Date.now()-cached.at<60000)populate(cached);
    return box;
  }
  function mount(){
    const key=document.querySelector('#shell-key-select'),snapshot=window.demoAlignedUI?.getSnapshot();
    if(key&&!key.parentElement.querySelector('[data-inline-model]')){
      const active=snapshot?.providers?.providers?.find(p=>p.id===key.value);
      if(active){const field=document.createElement('div');field.className='home-model-field';const label=document.createElement('label');label.textContent='当前模型';field.append(label,control(active.id,active.model));key.after(field);}
      document.querySelectorAll('#content .summary-row').forEach(row=>{if(row.firstElementChild?.textContent==='当前模型')row.remove();});
    }
    document.querySelectorAll('#content [data-live-provider]').forEach(card=>{
      if(card.querySelector('[data-inline-model]'))return;
      const field=[...card.querySelectorAll('.provider-details>span')].find(n=>n.querySelector('small')?.textContent==='模型');
      const value=field?.querySelector('strong');if(value){const node=control(card.dataset.liveProvider,value.textContent);value.replaceWith(node);field.classList.add('provider-model-field');}
    });
  }
  new MutationObserver(mount).observe(document.querySelector('#content'),{childList:true,subtree:true});mount();
})();
