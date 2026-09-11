// Runs only in the native --isolated --smoke-report window. No accounts, paid
// probes, installations or configuration mutations are performed.
(async () => {
  const checks=[];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async (condition,label)=>{for(let n=0;n<160;n++){if(condition())return;await pause(125);}throw Error(label);};
  const assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const visible=node=>!!node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
  const color=(node,name)=>getComputedStyle(node)[name];
  const fit=label=>{
    const content=document.querySelector('#content');
    assert(document.documentElement.scrollWidth<=innerWidth+1&&content.scrollWidth<=content.clientWidth+1,label+' no horizontal overflow');
  };
  try {
    const response=await fetch('/api/health');const health=await response.json();
    assert(response.ok&&health.isolated===true,'isolated health');
    await wait(()=>window.window777&&window.manager777?.confirm&&document.querySelector('#content .hero-symbol')&&!document.querySelector('#content .skeleton'),'initial state loaded');
    const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);
    assert(new Set(ids).size===ids.length,'unique DOM ids');
    const nav=[...document.querySelectorAll('.bottom-nav [data-shell-page]')];
    assert(nav.map(x=>x.dataset.shellPage).join(',')==='home,tools,account','Demo three primary destinations');
    const app=document.querySelector('.production-app');
    assert(color(app,'backgroundColor')==='rgb(25, 29, 36)','Demo base color');
    assert(color(app.querySelector('.titlebar'),'backgroundColor')==='rgb(29, 33, 40)','Demo titlebar color');
    assert(color(app.querySelector('.bottom-nav'),'backgroundColor')==='rgb(29, 33, 40)','Demo navigation color');
    if(!window.manager777Mac){const corners=await window.__TAURI_INTERNALS__.invoke('window_action',{action:'corner-check'});
    assert(corners.nativeCornersClipped===true,'native window excludes square corner pixels');}
    else assert(document.querySelector('#mac-components')&&document.querySelector('#mac-flow-main'),'native Mac installation controls present');
    assert(document.querySelectorAll('#content .progress-steps li').length===3,'Demo three onboarding steps');
    const primary=document.querySelector('#content button.primary');
    assert(visible(primary),'visible main action');
    const gradient=color(primary,'backgroundImage');
    assert(gradient.includes('rgb(180, 217, 207)')&&gradient.includes('rgb(154, 196, 185)'),'Demo mint main gradient');
    assert(color(primary,'color')==='rgb(24, 56, 47)','Demo main action text');
    assert(color(primary,'borderRadius')==='12px','Demo main action radius');
    fit('home 360px');
    nav[2].click();await wait(()=>document.querySelector('#content h1')?.textContent==='我的账号'&&!document.querySelector('#content .skeleton'),'account loaded');
    assert(visible(document.querySelector('#content .empty-state'))||document.querySelectorAll('#content .account-card').length===2,'account has direct state or account cards');
    fit('account 360px');
    nav[1].click();await wait(()=>document.querySelector('#shell-tool-search'),'tools loaded');
    assert(document.querySelectorAll('#content .tool-row').length>=9,'full tools list retained');
    assert(document.querySelectorAll('#content .tool-section').length>=3,'Demo grouped tool rows');
    fit('toolbox 360px');
    document.querySelector('#content [data-legacy-page="tool-doctor"]').click();
    await wait(()=>visible(document.querySelector('#content #doctor-progress')),'Doctor tool opened');
    assert(visible(document.querySelector('#content [data-doctor-command="inspect"]')),'Doctor real command entry retained');
    fit('Doctor 360px');
    // Existing public navigation API is the same route used by connected tool links.
    window.manager777.openPage('share-package');
    await wait(()=>visible(document.querySelector('#content #share-output-live'))||visible(document.querySelector('#content #share-package-create')),'share package tool opened');
    assert(visible(document.querySelector('#content #share-choose'))&&visible(document.querySelector('#content #share-open')),'share output path actions retained');
    fit('share package 360px');
    window.manager777.openPage('providers');
    await wait(()=>visible(document.querySelector('#content [data-modal-open="provider-modal"]')),'Key management opened');
    fit('Key management 360px');
    const category=document.querySelector('#content .category-panel');
    const tiles=[...category.querySelectorAll('.category-item')];
    assert(tiles.length===6,'six task categories retained');
    for(const tile of tiles){
      const title=tile.querySelector('strong').getBoundingClientRect(),count=tile.querySelector('small').getBoundingClientRect();
      assert(count.top>=title.bottom-1,'category name and count do not overlap: '+tile.dataset.scope);
      assert(tile.scrollWidth<=tile.clientWidth+1,'category fits: '+tile.dataset.scope);
    }
    assert(getComputedStyle(category).display==='grid','category heading and tiles use responsive grid');
    // Synthetic long values test actual field CSS without creating or changing any Key.
    const fixture=document.createElement('article');fixture.className='provider-card panel';
    fixture.innerHTML='<div class="provider-main"><div class="mini-logo"></div><div><div class="provider-title"><strong>布局验收：很长的配置名称与模型分组说明</strong><span class="default-tag">当前</span></div><p>https://example.invalid/very-long-provider-path/v1</p></div><span class="health">等待验证</span></div><div class="provider-details"><span><small>API Key</small><strong>sk-masked-••••••••••••</strong></span><span><small>模型</small><strong>very-long-model-name-for-responsive-layout-verification</strong></span><span><small>推理</small><strong>中</strong></span><span><small>存储</small><strong>关闭</strong></span></div>';
    document.querySelector('#content #page-providers, #content .page').append(fixture);
    for(const field of fixture.querySelectorAll('.provider-details>span')){
      assert(field.querySelector('strong').getBoundingClientRect().top>=field.querySelector('small').getBoundingClientRect().bottom+6,'Key label separated from value: '+field.querySelector('small').textContent);
      assert(field.scrollWidth<=field.clientWidth+1,'long Key field fits: '+field.querySelector('small').textContent);
    }
    fit('populated Key card 360px');
    fixture.dataset.liveProvider='isolated-layout-fixture';fixture.append(document.createComment('inline model layout fixture only'));
    await wait(()=>fixture.querySelector('[data-inline-model] select'),'inline model mounted in Key card');
    const modelControl=fixture.querySelector('[data-inline-model] select');
    assert(color(modelControl,'fontSize')==='12px','compact model selector font');
    for(const corner of ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'])assert(color(modelControl,corner)==='7px','fine model selector corners: '+corner+' = '+color(modelControl,corner));
    assert(modelControl.getBoundingClientRect().height===36,'compact model selector height');
    fit('inline model Key card 360px');fixture.remove();
    document.querySelector('#content [data-modal-open="provider-modal"]').click();
    await wait(()=>visible(document.querySelector('#provider-modal:not([hidden]) .modal')),'Key editor visible');
    const editor=document.querySelector('#provider-modal .modal');
    assert(color(editor,'backgroundColor')==='rgb(34, 40, 49)','Demo Key editor color');
    assert(editor.scrollWidth<=editor.clientWidth+1,'Key editor no horizontal overflow');
    document.querySelector('#provider-modal [data-modal-close]').click();
    assert(document.querySelector('#provider-modal').hidden,'Key editor closed without saving');
    nav[0].click();await wait(()=>document.querySelector('#content .hero-symbol'),'home restored');
    const confirmation=window.manager777.confirm('内部界面验收：仅检查弹窗显示，随后取消，不执行操作。');
    await wait(()=>document.querySelector('#confirmation-dialog')?.open,'confirmation opened');
    const dialog=document.querySelector('#confirmation-dialog');
    assert(visible(dialog),'confirmation visible outside hidden legacy container');
    assert(color(dialog,'backgroundColor')==='rgb(34, 40, 49)','Demo dialog color');
    document.querySelector('#confirmation-cancel').click();
    assert(await confirmation===false,'confirmation safely cancelled');
    await window.window777.toggleSize();await pause(300);fit('expanded window');
    if(!window.manager777Mac)assert((await window.__TAURI_INTERNALS__.invoke('window_action',{action:'corner-check'})).nativeCornersClipped===true,'native corner clipping survives resize');
    await window.window777.toggleSize();await pause(300);fit('normal 390px window');
    await window.__TAURI_INTERNALS__.invoke('window_action',{action:'smoke-pass',details:{checks,viewports:[360,940,390],visualScreenshotPerformed:false}});
  } catch(error) {
    await window.__TAURI_INTERNALS__.invoke('window_action',{action:'smoke-fail',details:{checks,failedCheck:String(error.message).slice(0,200),visualScreenshotPerformed:false}});
  }
})();
