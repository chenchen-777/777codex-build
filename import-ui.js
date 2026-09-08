(() => {
  const { api, escapeHtml: esc, showToast, runButton, refreshProviders, openProviderScope, providerTypeLabel } = window.manager777;
  const dialog = document.createElement('dialog'); dialog.id = 'platform-import-dialog'; dialog.setAttribute('aria-label', '从平台导入配置'); document.body.append(dialog);
  let last = ''; let busy = false; let models = []; let timer; let lastLinkError = '';
  const post = (path, body = {}) => api('/api/import/' + path, { method: 'POST', body: JSON.stringify(body) });
  const close = async () => { await post('cancel'); last = ''; models = []; dialog.close(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close().catch(error => showToast(error.message, true)); });
  const protocolButton = document.querySelector('#enable-platform-import');
  const protocolLabel = document.querySelector('#platform-import-status');
  let protocolFailureShown = false; let protocolTicks = 0;
  async function refreshProtocol() {
    try {
      const state = await api('/api/import/protocol');
      protocolLabel.textContent = state.message;
      protocolButton.hidden = !state.canRetry;
      if (state.status === 'failed' && !protocolFailureShown) { showToast(state.message, true); protocolFailureShown = true; }
      if (state.ok) protocolFailureShown = false;
      return state;
    } catch {
      protocolLabel.textContent = '无法检查网页关联，请稍后重试。'; protocolButton.hidden = false;
    }
  }
  protocolButton.addEventListener('click', async event => {
    const result = await runButton(event.currentTarget, '注册中…', () => post('register'));
    await refreshProtocol();
    if (result?.ok) showToast('网页导入已就绪；请在这台电脑的平台官网发起');
  });
  function render(state) {
    if (['idle', 'expired'].includes(state.phase)) {
      if (dialog.open) dialog.close();
      if (state.phase === 'expired') showToast('导入已过期，请在平台重新发起', true);
      last = ''; models = []; return;
    }
    const key = state.intentId + ':' + state.phase;
    if (key === last) return; last = key;
    const profile = state.profile;
    const choices = profile ? [...new Set(['', profile.model, ...(profile.models || [])])] : [];
    const content = profile ? `<p>即将导入：<strong>${esc(profile.name)}</strong> · ${esc(providerTypeLabel(profile.type))}</p>
      <p>协议：${esc(profile.protocol)}<br>接口：${esc(profile.baseUrl)}</p><p>API Key：${esc(profile.maskedKey)}</p>
      <div class="field"><label for="import-model">模型（可留空）</label><div class="input-action"><select id="import-model">${choices.map(m => `<option value="${esc(m)}" ${m === profile.model ? 'selected' : ''}>${esc(m || '未指定模型，可先保存')}</option>`).join('')}</select><button data-models ${profile.adapter?.canSyncModels ? '' : 'disabled title="此协议的模型同步尚未适配"'}>同步模型</button></div></div>
      ${profile.type === 'text' ? `<label class="field">推理强度<select id="import-effort">${['low','medium','high','xhigh'].map(e => `<option value="${e}" ${e === profile.reasoningEffort ? 'selected' : ''}>${e}</option>`).join('')}</select></label>` : ''}
      <p id="import-model-note" role="status">${profile.adapter?.canActivate ? '已带入平台配置，可先保存，使用前需验证。' : '可以导入并保存；此协议的调用尚未适配，不会自动切换或发送请求。'}</p>
      <label><input type="checkbox" id="import-replace"> 此 Key 已存在时，备份后更新配置</label>` : '<p role="status">正在读取配置…</p>';
    const group = profile ? `<p class="provider-group" title="平台导入时的信息；变更后重新导入更新">${esc(window.manager777.providerGroupLabel(profile))}</p>` : '';
    dialog.innerHTML = `<div class="modal-header"><h2>导入 777codes 配置</h2></div><div class="modal-body">${group}${content}</div><div class="modal-footer"><button class="button ghost" data-cancel>取消</button>${state.phase === 'ready' ? '<button class="button primary" data-save>确认保存</button>' : ''}</div>`;
    dialog.querySelector('[data-cancel]').onclick = () => close().catch(error => showToast(error.message, true));
    dialog.querySelector('[data-models]')?.addEventListener('click', async event => {
      const identity = last;
      const result = await runButton(event.currentTarget, '同步中…', () => post('models'));
      if (identity !== last) return;
      if (!result) { dialog.querySelector('#import-model-note').textContent = '同步未成功，仍可使用平台带入的模型导入，稍后再验证。'; return; }
      models = result.models;
      const select = dialog.querySelector('#import-model');
      const choices = [...new Set(['', profile.model, ...(profile.models || []), ...models])];
      const selected = select.value;
      select.replaceChildren(...choices.map(m => new Option(m || '未指定模型，可先保存', m)));
      select.value = choices.includes(selected) ? selected : profile.model;
      dialog.querySelector('#import-model-note').textContent = `已同步 ${models.length} 个模型；平台带入的模型已保留，可直接导入。`;
    });
    dialog.querySelector('[data-save]')?.addEventListener('click', async event => {
      const input = { confirm: 'IMPORT_PROVIDER', model: dialog.querySelector('#import-model').value, reasoningEffort: dialog.querySelector('#import-effort')?.value || '', replace: dialog.querySelector('#import-replace').checked };
      const result = await runButton(event.currentTarget, '导入中…', () => post('save', input));
      if (result) { dialog.close(); last = ''; models = []; await refreshProviders(); openProviderScope(result.provider.type); showToast('Key 已加密保存；未切换当前配置，未启动 Codex'); }
    });
    if (!dialog.open) dialog.showModal();
  }
  async function tick() {
    if (busy) return; busy = true;
    try {
      if (protocolTicks++ % 10 === 0) await refreshProtocol();
      let state = await api('/api/import/state');
      if (state.linkError && state.linkError.id !== lastLinkError) { lastLinkError = state.linkError.id; showToast(state.linkError.message, true); }
      render(state);
    } catch (error) { if (dialog.open) showToast(error.message, true); }
    finally { busy = false; timer = setTimeout(tick, 3000); }
  }
  window.addEventListener('beforeunload', () => clearTimeout(timer));
  void tick();
})();
