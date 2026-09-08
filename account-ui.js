(() => {
  const { api, showToast, runButton, escapeHtml: h } = window.manager777;
  const $ = selector => document.querySelector(selector);
  const dialog = $("#account-dialog"); const body = $("#account-dialog-body"); const footer = $("#account-dialog-footer");
  let status = { state: "logged-out", available: true, user: null }; let pollTimer = null; let viewRevision = 0;
  const post = (path, value = {}) => api(path, { method: "POST", body: JSON.stringify(value) });
  function close() { viewRevision++; clearTimeout(pollTimer); pollTimer = null; if (dialog.open) dialog.close(); }
  function open() { if (!dialog.open) dialog.showModal(); }
  function setHeader() {
    const name = $("#account-name"); const chip = $("#account-entry");
    name.textContent = status.user?.displayName || (status.state === "pending" ? "等待网页登录" : status.available === false ? "平台账号 · 预览" : "登录 777codes");
    chip.title = status.user?.email || status.message || "登录 777codes 平台账号";
    chip.classList.toggle("offline", status.state === "offline");
  }
  async function refresh() { status = await api("/api/account/status"); setHeader(); return status; }
  function showLogin() {
    viewRevision++;
    open(); body.innerHTML = `<div class="account-state"><div class="account-identity"><span class="account-avatar">77</span><div><strong>登录 777codes</strong><small>通过浏览器登录并授权此客户端</small></div></div><p>登录后，客户端右上角会显示你的用户名或邮箱，并可生成自己的推广安装链接。</p><div class="modal-note">客户端不会读取或保存平台密码。设备凭证使用 Windows 安全存储加密，也不会与模型 API Key 混用。</div><p class="inline-error" id="account-error"></p></div>`;
    footer.innerHTML = `<button type="button" class="button ghost" data-account-close>取消</button><button type="button" class="button primary" id="account-login-start">网页登录</button>`;
    footer.querySelector("[data-account-close]").addEventListener("click", close);
    $("#account-login-start").addEventListener("click", event => runButton(event.currentTarget, "正在打开…", async () => {
      try { status = await post("/api/account/login/start"); setHeader(); showPending(); schedulePoll(status.pollInterval || 3); }
      catch (error) { $("#account-error").textContent = error.message; }
    }));
  }
  function showPending() {
    viewRevision++;
    open(); body.innerHTML = `<div class="account-state"><div class="account-wait"><strong>请在浏览器完成登录和授权</strong><br>完成后本窗口会自动更新。授权用于读取当前账号、推广数据和同步平台 Key。</div><p class="inline-error" id="account-error"></p></div>`;
    footer.innerHTML = `<button type="button" class="button ghost" data-account-close>稍后再说</button><button type="button" class="button primary" id="account-login-check">我已完成，立即检查</button>`;
    footer.querySelector("[data-account-close]").addEventListener("click", close);
    $("#account-login-check").addEventListener("click", event => runButton(event.currentTarget, "检查中…", poll));
  }
  function schedulePoll(seconds) { clearTimeout(pollTimer); pollTimer = setTimeout(() => void poll(), Math.max(2, Number(seconds) || 3) * 1000); }
  async function poll() {
    try {
      status = await post("/api/account/login/poll"); setHeader();
      if (status.state === "logged-in") { showToast("777codes 平台账号登录成功"); await showAccount(); return; }
      schedulePoll(status.pollInterval || 3);
    } catch (error) { const target = $("#account-error"); if (target) target.textContent = error.message; }
  }
  async function copyLink(input) {
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); if (!document.execCommand("copy")) throw new Error("复制失败，请手动选择链接复制"); }
    showToast("推广安装链接已复制");
  }
  async function showAccount({ referral = false } = {}) {
    viewRevision++;
    open();
    if (!status.user) { await refresh(); if (!status.user) return showLogin(); }
    body.innerHTML = `<div class="account-state"><div class="account-identity"><span class="account-avatar">77</span><div><strong>${h(status.user.displayName)}</strong><small>${h(status.user.email || "777codes 已登录账号")}</small></div></div><div id="referral-content">${referral ? "正在读取推广信息…" : '<p>已登录。可以在“我的 Key”同步配置，或分享安装链接。</p>'}</div><p class="inline-error" id="account-error"></p></div>`;
    footer.innerHTML = `<button type="button" class="button ghost danger-text" id="account-logout">退出登录</button><button type="button" class="button ghost" data-account-close>关闭</button><button type="button" class="button primary" id="account-referral">推广分享安装包</button>`;
    footer.querySelector("[data-account-close]").addEventListener("click", close);
    $("#account-logout").addEventListener("click", async event => {
      const button = event.currentTarget;
      if (!await window.manager777.confirm("退出 777codes 平台账号？只清除此客户端的设备登录，不删除 Key 配置。")) return;
      const result = await runButton(button, "退出中…", () => post("/api/account/logout"));
      if (result) { status = result; setHeader(); close(); showToast("已退出平台账号"); }
    });
    $("#account-referral").addEventListener("click", () => loadReferral());
    if (referral) await loadReferral();
  }
  async function loadReferral() {
    const revision = ++viewRevision;
    const host = $("#referral-content"); const button = $("#account-referral");
    if (!host || !button) return null;
    button.disabled = true; button.textContent = '读取中…';
    host.textContent = '正在读取推广信息…'; $("#account-error").textContent = '';
    let loaded = false;
    try {
      const result = await api("/api/account/referral");
      if (revision !== viewRevision || !dialog.open) return null;
      host.innerHTML = `<div class="referral-stats"><div><small>邀请人数</small><strong>${h(result.invitedUserCount ?? '未提供')}</strong></div></div><div class="share-link-row"><input id="referral-link" readonly aria-label="推广链接" value="${h(result.shareUrl)}"><button type="button" class="button primary" id="referral-copy">复制链接</button><button type="button" class="button ghost" id="referral-open">打开网页</button></div><p class="modal-note">分享此链接，对方即可前往下载页。链接不包含你的 API Key。</p>`;
      $("#referral-copy").addEventListener("click", event => runButton(event.currentTarget, "复制中…", async () => {
        const fresh = await loadReferral();
        if (fresh) await copyLink($("#referral-link"));
      }));
      $("#referral-open").addEventListener("click", event => runButton(event.currentTarget, "打开中…", async () => {
        try { await post('/api/account/referral/open'); showToast('已请求浏览器打开推广下载页'); }
        catch (error) {
          if (revision === viewRevision && dialog.open) { host.textContent = '暂时无法打开推广下载页，请刷新后重试。'; $("#account-error").textContent = error.message; }
          throw error;
        }
      }));
      loaded = true; return result;
    } catch (error) {
      if (revision === viewRevision && dialog.open) { host.textContent = '推广分享暂时不可用。原有登录、Key 配置和 Codex 使用不受影响。'; $("#account-error").textContent = error.message; }
      return null;
    } finally {
      if (revision === viewRevision) { button.disabled = false; button.textContent = loaded ? '刷新推广信息' : '重试读取'; }
    }
  }
  $("#account-dialog-close").addEventListener("click", close); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  $("#account-entry").addEventListener("click", async () => { try { await refresh(); status.state === "logged-in" || status.state === "offline" ? await showAccount() : status.state === "pending" ? showPending() : showLogin(); } catch (error) { showToast(error.message, true); } });
  $("#referral-share").addEventListener("click", async () => { try { await refresh(); status.state === "logged-in" ? await showAccount({ referral: true }) : showLogin(); } catch (error) { showToast(error.message, true); } });
  $('#sync-platform-keys').addEventListener('click', event => runButton(event.currentTarget, '同步中…', async () => {
    const note = $('#platform-key-sync-status');
    try {
      await refresh();
      if (status.state !== 'logged-in') {
        note.textContent = status.state === 'offline' ? '平台当前离线，原有 Key 保留，请稍后重试。' : '请先登录 777codes，再点击同步平台 Key。';
        if (status.state !== 'offline') showLogin();
        return;
      }
      note.textContent = '正在读取平台 Key，完整读取后才会更新本地列表…';
      const result = await post('/api/account/keys/sync');
      await window.manager777.refreshProviders();
      note.textContent = `同步完成：共 ${result.total} 个有效 Key，新增 ${result.added}，更新 ${result.updated}，禁用 ${result.disabled}。当前 Key 和模型未自动切换。${result.disabled ? '已禁用的 Key 仍保留记录；不会清除 Codex 配置或关闭对话。' : ''}`;
      showToast('平台 Key、分组和倍率已同步');
    } catch (error) { note.textContent = `同步未完成：${error.message}。请检查后重试。`; throw error; }
  }));
  void refresh().catch(error => { status = { state: "logged-out", available: false, message: error.message }; setHeader(); });
})();
