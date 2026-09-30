import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function patchLoginUi(source){
 if(source.includes('login-recovery-v2'))return source;
 source=source.replace('let pollTimer = null; let viewRevision = 0;', 'let pollTimer = null; let viewRevision = 0; let polling = false; // login-recovery-v2');
 source=source.replace('clearTimeout(pollTimer); pollTimer = null; if (dialog.open)', 'if (status.state !== "pending") { clearTimeout(pollTimer); pollTimer = null; } if (dialog.open)');
 const start=source.indexOf('  async function poll() {'),end=source.indexOf('  async function copyLink(',start);
 if(start<0||end<0)throw Error('Login UI poll target missing');
 source=source.slice(0,start)+`  function accountChanged() { window.dispatchEvent(new CustomEvent("manager777:account-changed")); }
  async function completeLogin() {
    clearTimeout(pollTimer); pollTimer = null; setHeader(); close(); accountChanged();
    showToast("登录成功，正在同步账号密钥…");
    try {
      const result = await post('/api/account/keys/sync');
      await window.manager777.refreshProviders(); accountChanged();
      showToast(result.total ? "登录成功，账号密钥已同步。请选择连接后继续。" : "登录成功。还没有连接密钥，请到网页创建后同步。");
    } catch { showToast("已登录，但密钥同步未完成。请点击同步账号密钥重试。", true); }
  }
  async function poll() {
    if (polling || status.state !== 'pending') return;
    if (status.expiresAt && Date.now() >= Date.parse(status.expiresAt)) {
      // Let the backend discard the expired PKCE session so a new login can start.
      try { await post('/api/account/login/poll'); } catch {}
      status = { ...status, state:'logged-out', message:'授权已过期，请重新登录。' };
      clearTimeout(pollTimer); setHeader(); close(); accountChanged(); showToast(status.message, true); return;
    }
    polling = true; clearTimeout(pollTimer);
    try {
      status = await post("/api/account/login/poll"); setHeader();
      if (status.state === "logged-in") { await completeLogin(); return; }
      if (status.state === 'pending') schedulePoll(status.pollInterval || 3);
      else accountChanged();
    } catch (error) {
      const target = $("#account-error"); if (target) target.textContent = '登录确认暂时未完成，正在重试：' + error.message;
      if (status.state === 'pending') schedulePoll(Math.max(5, status.pollInterval || 3));
    } finally { polling = false; }
  }
  window.addEventListener('focus', () => { if (status.state === 'pending') void poll(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && status.state === 'pending') void poll(); });
`+source.slice(end);
 source=source.replace('void refresh().catch(error =>', "void refresh().then(value => { if(value.state === 'pending') schedulePoll(value.pollInterval || 3); }).catch(error =>");
 source=source.replace('? showPending() : showLogin()', '? (showPending(), schedulePoll(status.pollInterval || 3)) : showLogin()');
 return source;
}
export async function applyLoginUiRecovery(target){const path=join(target,'account-ui.js');await writeFile(path,patchLoginUi(await readFile(path,'utf8')));}
