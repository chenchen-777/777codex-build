// Desktop-only recovery; PKCE exchange, expiry and credential storage stay in AccountManager.
export function configureLoginRecovery(account) {
  const publicStatus = account.publicStatus.bind(account);
  account.publicStatus = (state, extra = {}) => {
    const pending = account.pending;
    const authorizeUrl = state === 'pending' && pending?.expiresAt > account.now() ? pending.authorizeUrl : undefined;
    return publicStatus(state, {...extra, ...(authorizeUrl ? {authorizeUrl} : {})});
  };
  const open = account.openExternal.bind(account);
  account.openExternal = async value => {
    // Keep a valid authorization session usable if the OS opener fails.
    if (value !== account.pending?.authorizeUrl) return open(value);
    try { await open(value); account.openWarning = ''; }
    catch { account.openWarning = '未能自动打开浏览器，请复制授权链接到这台电脑的浏览器中打开。'; }
  };
  const start = account.startLogin.bind(account);
  account.startLogin = async (...args) => {
    account.assertLive();
    let result;
    if (account.pending?.expiresAt > account.now()) {
      await account.openExternal(account.pending.authorizeUrl);
      result = account.publicStatus('pending', {expiresAt:new Date(account.pending.expiresAt).toISOString(),pollInterval:account.pending.interval});
    } else result = await start(...args);
    return {...result, message: account.openWarning || '请在浏览器确认授权；仅登录平台账号还未完成客户端授权。'};
  };
}
