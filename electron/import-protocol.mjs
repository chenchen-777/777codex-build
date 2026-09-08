const protocol = 'codes777';
const failureMessage = '网页关联未成功，浏览器暂时无法打开本工具。请在供应商页重试注册；如仍失败，请检查系统权限或默认应用设置。';

// Only the main process supplies the executable and mode. No URL/renderer input.
export function createImportProtocol({ app, executable, isolated, platform = process.platform }) {
  const enabled = app.isPackaged && !isolated && ['win32','darwin'].includes(platform);
  const protocolArgs = platform === 'darwin' ? [protocol] : [protocol, executable, []];
  let last = { status: 'checking', ok: false, canRetry: false, message: '正在检查网页关联…' };
  const fail = () => (last = { status: 'failed', ok: false, canRetry: true, message: failureMessage });
  function state() {
    if (!enabled) return { status: 'unavailable', ok: false, canRetry: false, message: '开发预览或隔离测试不注册网页关联；请使用桌面打包版。' };
    try {
      if (app.isDefaultProtocolClient(...protocolArgs)) return (last = { status: 'ready', ok: true, canRetry: false, message: '网页导入已就绪' });
      return fail();
    } catch { return fail(); }
  }
  function ensureRegistered() {
    if (!enabled) return state();
    if (state().ok) return last;
    try {
      const registered = app.setAsDefaultProtocolClient(...protocolArgs);
      if (!registered) return fail();
      return state(); // Never trust the setter return alone.
    } catch { return fail(); }
  }
  return { state, ensureRegistered };
}
