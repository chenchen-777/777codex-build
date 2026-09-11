// Reused by the current client and the reviewed legacy Windows share base.
// A changed upstream contract fails the build rather than silently omitting registration.
function once(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('Registration integration contract changed: '+needle.slice(0,70));
  return source.replace(needle,replacement);
}
export function patchRegistration(name, source) {
  if(source.includes('startRegistration')||source.includes('id="account-register-start"')) throw Error('Registration integration already applied');
  if (name === 'js/account-manager.mjs') {
    source = `import { registrationTarget } from './incoming-referral.mjs';\nimport { fileURLToPath as referralFilePath } from 'node:url';\n` + source;
    return once(source, '  async startLogin(', `  async startRegistration() {
    this.assertLive();
    const target = await registrationTarget(referralFilePath(new URL('../../', import.meta.url)));
    await this.openExternal(target.url);
    return {ok:true,invited:target.invited,message:target.invited?'已打开注册页，分享邀请码将由平台验证并自动填入。注册成功后，回到这里点击“网页登录”。':'已打开普通注册页。注册成功后，回到这里点击“网页登录”。'};
  }
  async startLogin(`);
  }
  if (name === 'scripts/server.mjs') return once(source,
    "else if (pathname === '/api/account/login/poll')", 
    "else if (pathname === '/api/account/register/start') result = await accountManager.startRegistration();\n    else if (pathname === '/api/account/login/poll')");
  if (name === 'account-ui.js') {
    source = once(source, '<button type="button" class="button primary" id="account-login-start">', '<button type="button" class="button ghost" id="account-register-start">注册账号</button><button type="button" class="button primary" id="account-login-start">');
    return once(source, '    $("#account-login-start").addEventListener', `    $("#account-register-start").addEventListener("click", event => runButton(event.currentTarget, "正在打开…", async () => {
      const errorNode = $("#account-error");
      try {
        const result = await post('/api/account/register/start');
        errorNode.textContent = ''; showToast(result.message);
        const note = document.createElement('p'); note.className = 'modal-note'; note.textContent = result.message;
        body.querySelector('[data-registration-note]')?.remove(); note.dataset.registrationNote = ''; body.append(note);
      } catch(error) { errorNode.textContent = error.message; }
    }));
    $("#account-login-start").addEventListener`);
  }
  throw Error('Unknown registration patch target');
}
