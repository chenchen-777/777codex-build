(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const state = { providers: [], activeScope: "text", sessions: [], installerPath: null, modelFollow: null };
  const homeDraft = { id: '', model: '', effort: '', dirty: false, models: null, revision: 0, launching: false };
  let toastTimer;

  function showToast(message, error = false) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store", ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(`${payload.message || `HTTP ${response.status}`}${payload.requestId ? `（编号 ${payload.requestId.slice(0, 8)}）` : ""}`);
    return payload;
  }

  async function runButton(button, busyText, task) {
    const previous = button.textContent;
    button.disabled = true; button.textContent = busyText;
    try { return await task(); }
    catch (error) { showToast(error.message, true); return null; }
    finally { button.disabled = false; button.textContent = previous; }
  }

  function openPage(pageName) {
    const target = $(`#page-${pageName}`);
    if (!target) return;
    $$(".page").forEach((page) => page.classList.toggle("active", page === target));
    const navigation = ['enhance', 'sessions', 'extensions'].includes(pageName) ? 'tools' : pageName === 'logs' ? 'settings' : pageName;
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === navigation));
    $('#referral-share').hidden = pageName !== 'home';
    $(".main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    if (pageName === "sessions") void refreshSessions();
    if (pageName === "extensions") void refreshExtensions();
    if (pageName === "codex") void refreshCodex();
    document.dispatchEvent(new CustomEvent("777:navigate", { detail: pageName }));
  }

  $$('[data-page]').forEach((button) => button.addEventListener("click", () => openPage(button.dataset.page)));
  $$('[data-page-link]').forEach((button) => button.addEventListener("click", () => openPage(button.dataset.pageLink)));

  function activeTextProvider() { return state.providers.find((item) => item.type === "text" && item.active); }
  const knownTypes = ['text', 'image', 'video', 'audio', 'multimodal'];
  function providerScope(item) { return knownTypes.includes(item.type) ? item.type : 'other'; }
  function providerTypeLabel(type) { return ({ text: '文字', image: '生图', video: '视频', audio: '音频', multimodal: '多模态', other: '其他类型' })[type] || `其他类型 · ${type}`; }
  function openProviderScope(type) { openPage('providers'); $(`[data-scope="${knownTypes.includes(type) ? type : 'other'}"]`)?.click(); }
  function providerStatus(item) {
    if (item.platformSync?.disabled) return '平台已禁用或移除';
    if (item.platformSync?.requiresActivation) return 'Key 已更新，请重新选择';
    if (item.adapter?.status === 'stored-only') return item.adapter.message;
    return item.active && state.modelFollow?.providerId === item.id ? modelStatusLabel(state.modelFollow) : item.verifiedAt ? '列表已验证' : '未验证';
  }
  function providerGroupLabel(item) {
    return `${item?.groupName || '分组未同步'} · ${typeof item?.groupMultiplier === 'number' && Number.isFinite(item.groupMultiplier) ? item.groupMultiplier + '×' : '倍率未同步'}`;
  }
  function modelStatusLabel(follow) {
    return ({ listed: '列表支持·未测对话', unsupported: '不支持此模型', mismatch: 'Key 不一致', unchecked: '待检查' })[follow.status] || follow.message;
  }

  function renderHomeProviders() {
    const selectedId = $('#home-key-select').value;
    const textProfiles = state.providers.filter((item) => item.type === "text");
    const select = $("#home-key-select");
    select.replaceChildren(...(textProfiles.length ? textProfiles.map((item) => {
      const option = new Option(`${item.name} · ${providerGroupLabel(item)} · ${item.model || '未指定模型'} · ${item.maskedKey}${item.platformSync?.disabled ? ' · 平台已禁用' : item.adapter?.canActivate === false ? ' · 暂未适配调用' : ''}`, item.id);
      option.disabled = item.adapter?.canActivate === false;
      option.selected = selectedId ? item.id === selectedId : item.active;
      return option;
    }) : [new Option("暂无文字 Key，请先添加", "")]));
    const active = activeTextProvider();
    if (textProfiles.length && !active && !selectedId) select.prepend(new Option('请选择 Key', '', true, true));
    $("#home-provider-name").textContent = active?.name || "尚未选择 Key";
    $("#home-provider-group").textContent = active ? providerGroupLabel(active) : '';
    $("#home-provider-model").textContent = active ? `当前文字模型 · ${active.model} · ${active.reasoningEffort}` : "前往供应商页面添加并验证";
    $("#home-provider-status").textContent = active?.platformSync?.disabled || active?.platformSync?.requiresActivation ? providerStatus(active) : active ? "● 已配置" : "○ 未配置";
    $("#home-provider-status").classList.toggle("success", Boolean(active && !active.platformSync?.disabled && !active.platformSync?.requiresActivation));
    if (active && state.modelFollow?.providerId === active.id) {
      const follow = state.modelFollow;
      $('#home-provider-model').textContent = `当前模型 · ${follow.model} · ${follow.reasoningEffort}`;
      $('#home-provider-status').textContent = modelStatusLabel(follow);
      $('#home-provider-status').title = follow.message;
      $('#home-provider-status').classList.toggle('success', follow.status === 'listed');
    }
    renderHomeModel();
  }

  function renderHomeModel() {
    $('#home-key-select').disabled = homeDraft.launching;
    const profile = state.providers.find(p => p.id === $('#home-key-select').value);
    if (homeDraft.id !== profile?.id) {
      Object.assign(homeDraft, { id: profile?.id || '', model: profile?.model || '', effort: profile?.reasoningEffort || 'high', dirty: false, models: null, revision: homeDraft.revision + 1 });
    } else if (profile && !homeDraft.dirty) {
      homeDraft.model = profile.model || ''; homeDraft.effort = profile.reasoningEffort || 'high';
    }
    const models = homeDraft.models;
    const select = $('#home-model-select');
    select.replaceChildren(...(models ? [new Option('请选择支持的模型', ''), ...models.map(m => new Option(m, m))] : [new Option(homeDraft.model ? `${homeDraft.model}（待检查）` : '请同步模型', homeDraft.model)]));
    select.value = models && !models.includes(homeDraft.model) ? '' : homeDraft.model;
    select.disabled = !profile || !models || homeDraft.launching;
    $('#home-effort-select').value = homeDraft.effort;
    $('#home-effort-select').disabled = !profile || homeDraft.launching;
    $('#home-sync-models').disabled = !profile || profile.adapter?.canSyncModels === false || homeDraft.launching;
    $('#home-start-with-key').disabled = !profile || profile.platformSync?.disabled || profile.adapter?.canActivate === false || Boolean(models && !select.value) || homeDraft.launching;
    $('#home-model-message').textContent = !profile ? '请先添加或同步一个文字 Key。' : models ? (select.value ? `模型已同步 · 待实测${homeDraft.dirty ? ' · 待应用' : ''}` : '该 Key 不支持此模型，请重新选择。') : '模型待验证';
  }

  $('#home-sync-models').addEventListener('click', async event => {
    const id = homeDraft.id, revision = ++homeDraft.revision;
    $('#home-model-message').textContent = '正在同步模型…';
    let failureMessage = '';
    const result = await runButton(event.currentTarget, '同步中…', async () => {
      try { return await api('/api/providers/models', { method: 'POST', body: JSON.stringify({ id }) }); }
      catch (error) { failureMessage = error.message; throw error; }
    });
    if (revision !== homeDraft.revision || id !== $('#home-key-select').value) return;
    homeDraft.models = result?.models || [];
    renderHomeModel();
    if (!result) $('#home-model-message').textContent = `同步失败：${failureMessage || '请重试'}`;
  });
  $('#home-model-select').addEventListener('change', () => { homeDraft.model = $('#home-model-select').value; homeDraft.dirty = true; renderHomeModel(); });
  $('#home-effort-select').addEventListener('change', () => { homeDraft.effort = $('#home-effort-select').value; homeDraft.dirty = true; renderHomeModel(); });

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function renderProviders() {
    const keyword = ($("#provider-search")?.value || "").trim().toLowerCase();
    const rows = state.providers.filter((item) => providerScope(item) === state.activeScope && (!keyword || `${item.name} ${item.type} ${item.protocol} ${item.model} ${item.baseUrl} ${providerGroupLabel(item)}`.toLowerCase().includes(keyword)));
    const host = $("#provider-list-live");
    if (!rows.length) {
      host.className = "empty-inline";
      host.innerHTML = `此类型还没有配置。<button class="text-button" data-live-add>立即添加 ›</button>`;
      host.querySelector("[data-live-add]")?.addEventListener("click", () => openProviderModal());
      return;
    }
    host.className = "provider-list-live";
    host.innerHTML = rows.map((item) => `
      <article class="provider-card panel ${item.active ? "selected" : ""}" data-live-provider="${escapeHtml(item.id)}">
        <div class="provider-main"><div class="mini-logo"><img src="assets/777codes-logo.png" alt="777codes" width="39" height="39"></div><div><div class="provider-title"><strong>${escapeHtml(item.name)}</strong>${item.active ? '<span class="default-tag">当前</span>' : ""}</div><p>${escapeHtml(item.baseUrl)} · ${escapeHtml(item.protocol)} · ${escapeHtml(providerTypeLabel(item.type))}</p></div><span class="health ${item.adapter?.canActivate && item.verifiedAt ? 'success' : ''}">${escapeHtml(providerStatus(item))}</span></div>
        <p class="provider-group" title="平台分组快照；可重新导入或同步更新">${escapeHtml(providerGroupLabel(item))}${item.platformSync ? ' · 平台同步' : ''}</p>
        <div class="provider-details"><span><small>API Key</small><strong>${escapeHtml(item.maskedKey)}</strong></span><span><small>模型</small><strong>${escapeHtml(item.model)}</strong></span><span><small>推理</small><strong>${escapeHtml(item.reasoningEffort)}</strong></span><span><small>存储</small><strong>${item.disableResponseStorage ? "关闭" : "默认"}</strong></span></div>
        <div class="provider-actions"><button class="button ghost" data-live-verify ${item.adapter?.canSyncModels === false ? 'disabled title="当前配置不可验证"' : ''}>验证</button><button class="button ghost" data-live-edit ${item.platformSync?.disabled ? 'disabled' : ''}>编辑</button><button class="button primary" data-live-use ${(item.active && !item.platformSync?.requiresActivation) || item.adapter?.canActivate === false ? "disabled" : ""}>${item.platformSync?.disabled ? '平台已禁用' : item.adapter?.canActivate === false ? '暂未适配调用' : item.platformSync?.requiresActivation ? '重新选择' : item.active ? '使用中' : '切换使用'}</button><button class="button ghost danger-text" data-live-delete>删除</button></div>
      </article>`).join("");
    host.querySelectorAll("[data-live-provider]").forEach((card) => {
      const id = card.dataset.liveProvider;
      card.querySelector("[data-live-verify]")?.addEventListener("click", (event) => verifyProvider(id, event.currentTarget));
      card.querySelector("[data-live-edit]")?.addEventListener("click", () => openProviderModal(id));
      card.querySelector("[data-live-use]")?.addEventListener("click", (event) => activateProvider(id, event.currentTarget));
      card.querySelector("[data-live-delete]")?.addEventListener("click", (event) => removeProvider(id, event.currentTarget));
    });
  }

  async function refreshProviders() {
    const result = await api("/api/providers");
    state.providers = result.providers || [];
    const current = activeTextProvider();
    if (!current || current.platformSync?.disabled || current.platformSync?.requiresActivation) state.modelFollow = null;
    $$('[data-scope]').forEach(button => { const small = button.querySelector('small'); if (small) small.textContent = `${state.providers.filter(p => providerScope(p) === button.dataset.scope).length} 个配置`; });
    renderHomeProviders(); renderProviders();
  }

  async function verifyProvider(id, button) {
    const result = await runButton(button, "验证中…", () => api("/api/providers/verify", { method: "POST", body: JSON.stringify({ id }) }));
    if (!result) return;
    $("#home-balance").textContent = result.usage?.remaining ?? "暂未提供";
    showToast(`列表接口通过，返回 ${result.models.length} 个模型；实际对话尚未验证`);
    await refreshProviders();
  }

  async function activateProvider(id, button, launchAfter = false) {
    if (launchAfter && activeTextProvider()?.id === id && !activeTextProvider()?.platformSync?.requiresActivation) {
      const result = await runButton(button, '启动中…', () => api('/api/codex/launch', { method: 'POST', body: '{}' }));
      return Boolean(result);
    }
    let needsRestart = false;
    if (launchAfter) {
      try {
        needsRestart = (await api('/api/codex/status')).running === true;
        if (needsRestart && !await window.manager777.confirm('Codex 正在运行。切换 Key 后需要重启才能确保读取新配置；请先结束正在进行的对话。是否切换并重启？')) return false;
      } catch (error) { showToast(error.message, true); return false; }
    }
    const result = await runButton(button, "验证并切换…", () => api("/api/providers/activate", { method: "POST", body: JSON.stringify({ id }) }));
    if (!result) return false;
    await Promise.all([refreshProviders(), refreshLocalState()]);
    showToast(result.applied ? `已切换到 ${result.applied.model}，备份编号 ${result.applied.backupId}` : `已选择 ${result.selected.name}，下次从本工具启动 Codex 时注入该能力 Key`);
    if (launchAfter) {
      const launched = await runButton(button, needsRestart ? '重启中…' : '启动中…', () => api(needsRestart ? '/api/codex/restart' : '/api/codex/launch', { method: 'POST', body: '{}' }));
      if (!launched) { showToast('Key 已切换，但启动或重启失败，请到 Codex 管理页面重试', true); return false; }
    }
    return true;
  }

  async function removeProvider(id, button) {
    const profile = state.providers.find((item) => item.id === id);
    if (!profile) return;
    const note = profile.active ? '此 Key 正在使用，删除后管理工具将不再选择它，也不会自动切换其他 Key。' : '';
    if (!await window.manager777.confirm(`删除 Key 配置“${profile.name}”？${note}仅删除管理工具记录，删除前保留加密备份；不会撤销平台 Key、清除 Codex 配置或关闭 Codex。`)) return;
    const result = await runButton(button, "删除中…", () => api("/api/providers/delete", { method: "POST", body: JSON.stringify({ id, confirmActive: Boolean(profile.active) }) }));
    if (result) { if (result.deletedActive) state.modelFollow = null; showToast("配置已删除，已保留备份；Codex 配置未改动"); await refreshProviders(); }
  }

  const modal = $("#provider-modal");
  let modalRevision = 0;
  function openProviderModal(id = "") {
    modalRevision++;
    const record = state.providers.find((item) => item.id === id);
    $("#provider-modal-title").textContent = record ? "编辑配置" : "添加配置";
    $("#modal-provider-id").value = record?.id || "";
    $("#modal-provider-name").value = record?.name || "";
    $("#modal-provider-type").value = record?.type || (state.activeScope === 'other' ? '' : state.activeScope);
    $("#modal-provider-url").value = record?.baseUrl || "https://www.777codes.codes";
    $("#modal-provider-key").value = "";
    $("#modal-provider-protocol").value = record?.protocol || "responses";
    $('#modal-provider-key').type = 'password'; $('#toggle-modal-key').textContent = '显示';
    $('#modal-model').replaceChildren(new Option(record?.model ? `${record.model}（已保存，待同步）` : '未指定模型，可先保存', record?.model || ''), ...(record?.models || []).filter(m => m !== record?.model).map(m => new Option(m, m)));
    $('#modal-reasoning').value = record?.reasoningEffort || '';
    $('#modal-model-status').textContent = record?.adapter?.status === 'stored-only' ? record.adapter.message : '模型可先留空；已适配协议支持同步模型';
    $('#modal-sync-models').disabled = record?.adapter?.canSyncModels === false;
    $('#modal-verify').disabled = record?.adapter?.canSyncModels === false;
    modal.hidden = false;
  }
  function closeProviderModal() { modalRevision++; modal.hidden = true; $('#modal-provider-key').value = ''; }
  function modalPayload() {
    return {
      id: $("#modal-provider-id").value || undefined, name: $("#modal-provider-name").value,
      type: $("#modal-provider-type").value, baseUrl: $("#modal-provider-url").value,
      apiKey: $("#modal-provider-key").value, protocol: $("#modal-provider-protocol").value,
      model: $("#modal-model").value, reasoningEffort: $('#modal-reasoning').value, disableResponseStorage: true,
    };
  }

  $$('[data-modal-open]').forEach((button) => button.addEventListener("click", () => openProviderModal()));
  $$('[data-modal-close]').forEach((button) => button.addEventListener("click", closeProviderModal));
  modal.addEventListener("click", (event) => { if (event.target === modal) closeProviderModal(); });
  $("#toggle-modal-key").addEventListener("click", () => {
    const input = $("#modal-provider-key"); input.type = input.type === "password" ? "text" : "password";
    $("#toggle-modal-key").textContent = input.type === "password" ? "显示" : "隐藏";
  });
  $("#modal-verify").addEventListener("click", async (event) => {
    const payload = modalPayload();
    const result = await runButton(event.currentTarget, "验证中…", () => api("/api/providers/verify", { method: "POST", body: JSON.stringify(payload) }));
    if (result) showToast(`列表接口通过，返回 ${result.models.length} 个模型；实际对话尚未验证`);
  });
  for (const selector of ['#modal-provider-key', '#modal-provider-url', '#modal-provider-type', '#modal-provider-protocol']) {
    $(selector).addEventListener('input', () => {
      modalRevision++; $('#modal-model').replaceChildren(new Option('未指定模型，可先保存', ''));
      $('#modal-sync-models').disabled = false; $('#modal-verify').disabled = false;
      $('#modal-model-status').textContent = '配置已改变，可先保存；仅已适配协议支持同步模型。';
    });
  }
  $('#modal-sync-models').addEventListener('click', async event => {
    const revision = modalRevision; const previous = $('#modal-model').value;
    $('#modal-model-status').textContent = '正在读取当前 Key 的模型列表…';
    const result = await runButton(event.currentTarget, '同步中…', () => api('/api/providers/models', { method: 'POST', body: JSON.stringify(modalPayload()) }));
    if (revision !== modalRevision || modal.hidden) return;
    if (!result) { $('#modal-model-status').textContent = '同步失败，未替换模型。请检查错误提示后重试。'; return; }
    $('#modal-model').replaceChildren(new Option(result.models.length ? '请选择模型' : '此 Key 没有返回模型', ''), ...result.models.map(model => new Option(model, model)));
    if (result.models.includes(previous)) $('#modal-model').value = previous;
    $('#modal-model-status').textContent = previous && !result.models.includes(previous) ? '原模型未在新列表中，请重新选择。' : `已同步 ${result.models.length} 个模型；实际对话需单独测试。`;
  });
  $("[data-modal-save]").addEventListener("click", async (event) => {
    const result = await runButton(event.currentTarget, "保存中…", () => api("/api/providers/save", { method: "POST", body: JSON.stringify(modalPayload()) }));
    if (result) { closeProviderModal(); showToast("Key 已加密保存"); await refreshProviders(); openProviderScope(result.provider.type); }
  });

  const scopeNames = { text: "文字配置", image: "生图配置", video: "视频配置", audio: "音频配置", multimodal: "多模态配置", other: "其他类型配置" };
  $$('[data-scope]').forEach((button) => button.addEventListener("click", () => {
    state.activeScope = button.dataset.scope;
    $$('[data-scope]').forEach((item) => item.classList.toggle("active", item === button));
    $("#provider-scope-title").textContent = scopeNames[state.activeScope];
    $('#provider-scope-note').textContent = state.activeScope === 'text' ? '切换使用后写入 Codex 的文字模型路由' : '按类型保存 Key；能否调用以各配置的适配状态为准';
    renderProviders();
  }));
  $("#provider-search").addEventListener("input", renderProviders);

  $("#home-key-select").addEventListener("change", () => {
    const profile = state.providers.find((item) => item.id === $("#home-key-select").value);
    $("#home-key-hint").textContent = profile ? `将验证并切换到 ${profile.name}，然后启动 Codex。` : "请先添加文字 Key。";
    renderHomeModel();
  });
  $("#home-start-with-key").addEventListener("click", async (event) => {
    const id = $("#home-key-select").value;
    if (!id) return showToast("请先添加并选择文字 Key", true);
    if (homeDraft.launching) return;
    homeDraft.launching = true;
    homeDraft.revision++;
    renderHomeModel();
    const button = event.currentTarget;
    try {
      // Explicit choices must be saved before applying; provider-store timestamps
      // prevent older session observations from replacing this selection.
      if (homeDraft.dirty) {
        const profile = state.providers.find(p => p.id === id);
        if (!homeDraft.model || (homeDraft.models && !homeDraft.models.includes(homeDraft.model))) throw new Error('请选择当前 Key 支持的模型');
        const running = (await api('/api/codex/status')).running;
        if (running && !await window.manager777.confirm('Codex 正在运行。应用新模型需要重启，请先结束正在进行的对话。继续？')) return;
        await api('/api/providers/save', { method: 'POST', body: JSON.stringify({ id, name: profile.name, model: homeDraft.model, reasoningEffort: homeDraft.effort }) });
        await api('/api/providers/activate', { method: 'POST', body: JSON.stringify({ id }) });
        homeDraft.dirty = false;
        await api(running ? '/api/codex/restart' : '/api/codex/launch', { method: 'POST', body: '{}' });
        showToast('已应用模型并启动 Codex');
      } else {
        // Revalidate on each launch, not merely a previous green badge.
        const result = await api('/api/providers/models', { method: 'POST', body: JSON.stringify({ id }) });
        if (!result.models.includes(homeDraft.model)) { homeDraft.models = result.models; throw new Error('此 Key 不支持所选模型，请重新选择'); }
        const ok = await activateProvider(id, button, true);
        if (!ok) return;
        showToast('Codex 已启动');
      }
      await Promise.all([refreshProviders(), refreshCodex()]);
    } catch (error) { showToast(error.message, true); }
    finally { homeDraft.launching = false; renderHomeModel(); }
  });
  $("#home-verify").addEventListener("click", (event) => {
    const active = state.providers.find(p => p.id === $('#home-key-select').value);
    if (!active) return showToast("尚无正在使用的 Key", true);
    void verifyProvider(active.id, event.currentTarget);
  });
  $("#refresh-balance").addEventListener("click", async event => {
    const id = $('#home-key-select').value;
    if (!id) return showToast('请先选择或同步账号 Key', true);
    const result = await runButton(event.currentTarget, '刷新中…', () => api('/api/providers/usage', { method: 'POST', body: JSON.stringify({ id }) }));
    if (id !== $('#home-key-select').value) return;
    $('#home-balance').textContent = result ? result.usage.remaining : '—';
    if (result) showToast(Number(result.usage.remaining) === 0 ? '余额为 0；调用模型前请充值或检查 Key 额度' : '余额已刷新');
  });
  $('#home-uninstall').addEventListener('click', () => $('#codex-uninstall').click());
  $('#window-toggle-size').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!window.window777?.toggleSize) return showToast('请在 EXE 客户端中展开窗口');
    try {
      const result = await window.window777.toggleSize();
      const label = result.expanded ? '收起窗口' : '展开窗口';
      button.setAttribute('aria-pressed', String(result.expanded));
      button.setAttribute('aria-label', label);
      button.title = label;
    } catch { showToast('窗口尺寸调整失败', true); }
  });
  $('#help-entry').addEventListener('click', () => window.manager777.confirm('使用顺序：登录账号 → 在“我的 Key”同步或添加 → 首页选择 Key 与模型 → 安装并启动 Codex。汉化在首页，插件和 MCP 在工具箱。此试验版的 Windows 发布者签名尚未完成。'));

  async function refreshLocalState() {
    const local = await api("/api/local-state");
    $("#config-model").textContent = local.model || "未配置";
    $("#config-provider").textContent = local.provider || "未配置";
    $("#config-base-url").textContent = local.baseUrl || "—";
  }

  async function refreshCodex() {
    const result = await api("/api/codex/status");
    const label = result.isolated ? "Codex · 隔离预览" : result.installed ? `Codex Desktop ${result.version || "已安装"}` : "Codex Desktop 未安装";
    const detail = result.isolated ? "不检测、不操作本机 Codex" : result.installed ? `${result.running ? "正在运行" : "当前未运行"} · ${result.source === "microsoft-store" ? "Microsoft Store 官方版" : result.executable}` : "在线下载 Codex；已校验缓存可用于重装";
    $("#home-codex-version").textContent = label; $("#home-codex-state").textContent = detail;
    $("#codex-page-version").textContent = label; $("#codex-page-path").textContent = result.source === "microsoft-store" ? `Microsoft Store · ${result.installDirectory || "已注册"}` : result.executable || "未检测到安装路径";
    $("#codex-page-state").textContent = result.installed ? `● ${result.running ? "运行中" : "已安装"}` : "○ 未安装";
    $("#codex-page-state").classList.toggle("success", result.installed);
    $("#codex-launch").disabled = !result.installed; $("#codex-restart").disabled = !result.installed; $("#codex-open-dir").disabled = !result.installed;
    $("#codex-uninstall").disabled = window.manager777Mac ? false : !result.canUninstall || uninstallState.busy;
    $('#home-uninstall').disabled = window.manager777Mac ? false : !result.canUninstall || result.isolated || uninstallState.busy;
    $("#codex-uninstall").title = window.manager777Mac ? '卸载所选官方 Codex；保留可恢复的应用副本、聊天记录和配置' : result.installed && !result.canUninstall ? "当前安装类型需在 Windows 应用设置中卸载" : "只卸载 Codex 应用；备份会话，原地保留配置与 Key";
    if (result.isolated) { $("#codex-page-state").textContent = "隔离预览"; $("#codex-page-path").textContent = "不读取本机安装路径"; $("#codex-download").disabled = true; $("#codex-uninstall").disabled = true; }
  }
  $("#codex-launch").addEventListener("click", (event) => runButton(event.currentTarget, "启动中…", async () => { const r = await api("/api/codex/launch", { method: "POST", body: "{}" }); showToast("Codex 已启动"); await refreshCodex(); return r; }));
  $("#codex-restart").addEventListener("click", (event) => runButton(event.currentTarget, "重启中…", async () => { const r = await api("/api/codex/restart", { method: "POST", body: "{}" }); showToast("Codex 已重启"); await refreshCodex(); return r; }));
  $("#codex-open-dir").addEventListener("click", (event) => runButton(event.currentTarget, "打开中…", () => api("/api/codex/open-directory", { method: "POST", body: "{}" })));
  $("#codex-download-page").addEventListener("click", (event) => runButton(event.currentTarget, "打开中…", () => api("/api/codex/open-download-page", { method: "POST", body: "{}" })));
  $("#codex-download").addEventListener("click", async (event) => {
    document.querySelector('#codex-installer-panel')?.scrollIntoView({behavior:'smooth',block:'center'});
    document.querySelector('#install-check')?.click();
  });
  let uninstallState = { phase: 'idle' }, uninstallConfirming = false, uninstallTimer;
  function showUninstall() { if (!$('#uninstall-dialog').open) $('#uninstall-dialog').showModal(); }
  function renderUninstall(s) {
    const wasBusy = uninstallState.busy;
    uninstallState = s;
    $('#uninstall-message').textContent = s.message || '准备卸载…';
    $('#uninstall-message').classList.toggle('danger-text', s.phase === 'error');
    $('#uninstall-progress').hidden = !s.busy;
    const seconds = s.startedAt ? Math.max(0, Math.floor(((s.finishedAt ? Date.parse(s.finishedAt) : Date.now()) - Date.parse(s.startedAt)) / 1000)) : 0;
    $('#uninstall-elapsed').textContent = `已用时 ${seconds} 秒${s.busy ? ' · 请勿重复卸载或关闭管理工具' : ''}`;
    $('#uninstall-events').replaceChildren(...(s.events || []).map((item, index, rows) => {
      const li = document.createElement('li');
      const current = index === rows.length - 1;
      li.textContent = `${new Date(item.time).toLocaleTimeString()}　${item.message}${current && s.busy ? '…' : ''}`;
      li.className = current ? s.phase : 'done'; return li;
    }));
    $('#uninstall-close').textContent = s.busy ? '后台继续' : '关闭';
    $('#uninstall-view').hidden = s.phase === 'idle';
    $('#uninstall-view').textContent = s.busy ? '正在卸载 · 查看进度' : '查看卸载结果';
    if (s.busy) { $('#home-uninstall').disabled = true; $('#codex-uninstall').disabled = true; }
    else if (wasBusy) void refreshCodex().catch(error => showToast(error.message, true));
  }
  async function pollUninstall() {
    clearTimeout(uninstallTimer);
    try {
      const previous = uninstallState;
      const latest = await api('/api/codex/uninstall/status', { signal: AbortSignal.timeout(6000) });
      $('#uninstall-connection').textContent = '';
      if (latest.phase !== 'idle') {
        renderUninstall(latest);
        if (previous.busy && !latest.busy) {
          showToast(latest.message, latest.phase === 'error');
        }
      } else if (previous.busy) {
        renderUninstall({ phase: 'error', busy: false, message: '卸载状态已丢失，请检查 Codex 安装状态后再操作。', events: previous.events });
      }
      if (latest.busy) uninstallTimer = setTimeout(pollUninstall, 1000);
      return latest;
    } catch {
      $('#uninstall-connection').textContent = '暂时无法读取进度，正在重连。请勿重复卸载。';
      if (uninstallState.busy) uninstallTimer = setTimeout(pollUninstall, 2500);
      return null;
    }
  }
  $('#uninstall-view').onclick = showUninstall;
  $('#uninstall-close').onclick = () => $('#uninstall-dialog').close();
  window.addEventListener('beforeunload', () => clearTimeout(uninstallTimer));
  $("#codex-uninstall").addEventListener("click", async () => {
    if (uninstallState.busy) { showUninstall(); return; }
    if (uninstallConfirming) return;
    uninstallConfirming = true;
    try {
      if (!await window.manager777.confirm("确定卸载 Codex 应用？会先备份聊天记录，再关闭并卸载程序。配置、Key 和 777 管理工具保留。")) return;
      const previousTaskId = uninstallState.id;
      renderUninstall({ phase: 'running', busy: true, startedAt: new Date().toISOString(), message: '正在提交卸载任务…', events: [] });
      $('#uninstall-connection').textContent = '';
      showUninstall();
      try {
        const result = await api('/api/codex/uninstall', { method: 'POST', signal: AbortSignal.timeout(10000), body: JSON.stringify({ confirm: 'UNINSTALL_CODEX_APP' }) });
        renderUninstall(result); void pollUninstall();
      } catch (error) {
        // A lost response may still mean the task started: read state, never retry POST.
        const current = await pollUninstall();
        if (current?.phase === 'idle' || (current && current.id === previousTaskId)) {
          renderUninstall({ phase: 'error', busy: false, message: error.message, events: [] });
          void refreshCodex().catch(() => {});
        } else if (!current) $('#uninstall-connection').textContent = '提交结果暂未确认，正在读取后台状态。请勿重复卸载。';
      }
    } finally { uninstallConfirming = false; }
  });
  void pollUninstall().then(s => { if (s?.busy) showUninstall(); });

  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function renderSessions() {
    const keyword = ($("#session-search").value || "").toLowerCase();
    const rows = state.sessions.filter((item) => !keyword || `${item.name} ${item.path}`.toLowerCase().includes(keyword));
    $("#session-list-live").className = rows.length ? "session-list-live" : "empty-inline";
    $("#session-list-live").innerHTML = rows.length ? rows.slice(0, 100).map((item) => `<article data-session-search="${escapeHtml(item.name)}"><div class="session-icon">话</div><div><strong>${escapeHtml(item.name)}</strong><p>${new Date(item.modifiedAt).toLocaleString()} · ${item.tokensUsed ? `${item.tokensUsed} tokens` : formatBytes(item.size)}</p></div><span class="session-provider">${escapeHtml(item.provider || "本机")}</span><div class="row-actions"><button disabled title="为避免破坏，本版只开放整库备份">已保护</button></div></article>`).join("") : "没有找到会话记录";
  }
  async function refreshSessions() {
    const result = await api("/api/sessions"); state.sessions = result.sessions || [];
    $("#session-count").textContent = result.total; $("#session-size").textContent = formatBytes(result.totalBytes); renderSessions();
  }
  $("#session-search").addEventListener("input", renderSessions);
  $("#backup-sessions").addEventListener("click", async (event) => {
    const result = await runButton(event.currentTarget, "备份中…", () => api("/api/sessions/backup", { method: "POST", body: "{}" }));
    if (result) { $("#session-last-backup").textContent = "刚刚"; showToast(`会话已备份到 ${result.target}`); }
  });
  $("#open-backups").addEventListener("click", (event) => runButton(event.currentTarget, "打开中…", () => api("/api/backups/open", { method: "POST", body: "{}" })));

  async function refreshExtensions() {
    const result = await api("/api/extensions");
    $("#image-mcp-state").textContent = result.imageMcp.installed ? "● 已安装" : result.imageMcp.configured ? "○ 配置失效" : "○ 未安装";
    $("#image-mcp-state").classList.toggle("success", result.imageMcp.installed);
    $("#image-mcp-install").disabled = result.imageMcp.installed;
    $("#image-mcp-install").textContent = result.imageMcp.installed ? "已安装" : "一键安装";
  }
  $("#image-mcp-install").addEventListener("click", async (event) => {
    const result = await runButton(event.currentTarget, "安装中…", () => api("/api/extensions/image-mcp/install", { method: "POST", body: "{}" }));
    if (result) { showToast(`Image MCP ${result.version} 与 Skill 已安装，配置已备份`); await refreshExtensions(); }
  });
  const extensionMeta = { plugins: ["插件", "管理已安装插件、权限与更新", "＋ 添加插件"], skills: ["Skill", "管理用户级与项目级 Skill", "＋ 导入 Skill"], mcp: ["MCP 服务", "管理 Codex 可调用的 stdio 与 HTTP MCP", "＋ 添加 MCP"] };
  function showExtensionPanel(name) {
    $$('[data-extension-tab]').forEach((button) => button.classList.toggle("active", button.dataset.extensionTab === name));
    $$('[data-extension-panel]').forEach((panel) => { panel.hidden = panel.dataset.extensionPanel !== name; });
    const meta = extensionMeta[name]; $("#extension-title").textContent = meta[0]; $("#extension-subtitle").textContent = meta[1]; $("#extension-add").textContent = meta[2];
    document.dispatchEvent(new CustomEvent("777:extensions", { detail: name }));
  }
  $$('[data-extension-tab]').forEach((button) => button.addEventListener("click", () => showExtensionPanel(button.dataset.extensionTab)));
  $$('[data-extension-tab-link]').forEach((button) => button.addEventListener("click", () => showExtensionPanel(button.dataset.extensionTabLink)));
  $$('[data-extension-shortcut]').forEach((button) => button.addEventListener("click", () => showExtensionPanel(button.dataset.extensionShortcut)));

  $$("#launch-mode button").forEach((button) => button.addEventListener("click", () => {
    $$("#launch-mode button").forEach((item) => item.classList.toggle("active", item === button));
    showToast("启动模式界面已保留；注入型增强尚未启用，不会改写 Codex 程序文件");
  }));
  $$(".switch:not([data-live-setting])").forEach((button) => { button.disabled = true; button.classList.remove("on"); button.title = "已纳入后续开发，尚未接入"; button.setAttribute("aria-label", "尚未接入"); });
  $$('[data-demo]').forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.demo}：已纳入范围，尚未接入`)));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeProviderModal(); });

  function updateLabel(result) {
    if (!result?.latest) return `当前版本 ${result?.current?.version || '—'} ${result?.current?.revisionLabel || ''}`;
    return result.available ? `${result.message} · ${(result.latest.bytes / 1024 / 1024).toFixed(1)} MB` : result.message;
  }
  async function checkManagerUpdate({ interactive = true } = {}) {
    const button = $('#manager-update-check');
    const task = () => api('/api/manager-update/check', { method: 'POST', body: '{}' });
    const result = interactive ? await runButton(button, '…', task) : await task().catch(() => null);
    if (!result) return;
    $('#manager-update-status').textContent = updateLabel(result);
    button.classList.toggle('update-available', Boolean(result.available));
    if (!result.available) { if (interactive) showToast(result.message); return; }
    if (!result.installable) { showToast(result.message, true); return; }
    if (!interactive) { showToast(`${result.message}，在设置中检查更新`); return; }
    const notes = result.latest.notes ? `\n\n${result.latest.notes}` : '';
    if (!await window.manager777.confirm(`${result.message}，下载并安装后管理工具会自动重启。${notes}`)) return;
    const downloaded = await runButton(button, '↓', () => api('/api/manager-update/download', { method: 'POST', body: '{}' }));
    if (!downloaded) return;
    showToast('更新包下载并校验通过，正在准备重启');
    await runButton(button, '…', () => api('/api/manager-update/install', { method: 'POST', body: JSON.stringify({ confirm: 'INSTALL_MANAGER_UPDATE' }) }));
  }
  async function refreshManagerUpdate() {
    if(window.manager777Mac)return;
    const result = await api('/api/manager-update/status');
    const auto = $('#manager-update-auto');
    auto.classList.toggle('on', result.settings.autoCheck);
    auto.setAttribute('aria-pressed', String(result.settings.autoCheck));
    $('#manager-update-status').textContent = result.lastCheck ? updateLabel(result.lastCheck) : `当前版本 ${result.current.version} ${result.current.revisionLabel} · 尚未检查`;
    if (result.settings.autoCheck) setTimeout(() => void checkManagerUpdate({ interactive: false }), 1800);
  }
  $('#manager-update-check').addEventListener('click', () => void checkManagerUpdate());
  $('#manager-update-auto').addEventListener('click', async event => {
    const button = event.currentTarget; const enabled = !button.classList.contains('on');
    const result = await runButton(button, '…', () => api('/api/manager-update/settings', { method: 'POST', body: JSON.stringify({ autoCheck: enabled }) }));
    if (!result) return;
    button.classList.toggle('on', result.autoCheck); button.setAttribute('aria-pressed', String(result.autoCheck));
    showToast(result.autoCheck ? '已开启启动时检查更新' : '已关闭自动检查；仍可在设置中手动检查');
  });

  window.manager777 = { api, showToast, runButton, escapeHtml, providerGroupLabel, providerTypeLabel, openProviderScope, openPage, refreshProviders, refreshExtensions, refreshLocalState, refreshCodex };
  let followTimer;
  async function followModel() {
    try {
      if (homeDraft.launching) return;
      const previous = JSON.stringify(state.modelFollow);
      state.modelFollow = await api('/api/model/sync', { method: 'POST', body: '{}' });
      if (previous !== JSON.stringify(state.modelFollow)) await refreshProviders();
    } catch {
      if (state.modelFollow) { state.modelFollow = { ...state.modelFollow, status: 'unknown', message: '模型状态暂未更新，请稍后重试' }; renderHomeProviders(); renderProviders(); }
    } finally { followTimer = setTimeout(followModel, 4000); }
  }
  window.addEventListener('beforeunload', () => clearTimeout(followTimer));
  void followModel();
  Promise.all([refreshProviders(), refreshLocalState(), refreshCodex(), refreshExtensions(), refreshManagerUpdate()]).catch((error) => showToast(`初始化失败：${error.message}`, true));
})();
