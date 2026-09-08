import { AppError } from '../js/errors.mjs';

const field = 'codes777Import';
const invalid = () => new AppError('导入链接参数无效', 'INVALID_IMPORT_URL');
function candidates(argv) {
  return Array.isArray(argv) ? argv.filter(value => typeof value === 'string' && /^codes777:/i.test(value)) : [];
}
function bounded(urls) {
  if (!Array.isArray(urls) || urls.length > 1 || urls.some(url => typeof url !== 'string' || !/^codes777:/i.test(url) || Buffer.byteLength(url, 'utf8') > 32768)) throw invalid();
  return urls;
}

// Never log argv/additionalData: they contain credentials. The existing importer
// remains the sole parser and requires explicit confirmation before saving.
export function importLaunchData(argv) {
  try { return { [field]: { version: 1, urls: bounded(candidates(argv)) } }; }
  catch { return { [field]: { version: 1, invalid: true } }; }
}

export function createImportReceiver({ app, argv, offer, reportError, record, getWindow }) {
  let active = false;
  const queue = [];
  let overflow = false;
  function focus() {
    const window = getWindow();
    if (!window || window.isDestroyed?.()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  function log(source, outcome, code) {
    // Fixed source labels only; parser/OS exception text is never recorded.
    try { Promise.resolve(record({ action: `import:receive-${source}`, outcome, ...(code ? { code } : {}) })).catch(() => {}); } catch {}
  }
  function deliver(entry) {
    try {
      if (entry.error) throw invalid();
      offer(entry.url);
      log(entry.source, 'success');
    } catch (error) { log(entry.source, 'error', reportError(error)); }
    finally { focus(); }
  }
  function receive(urls, source) {
    let entry;
    try {
      bounded(urls);
      if (!urls.length) { if (active && source === 'second-instance') focus(); return; }
      entry = { url: urls[0], source };
    } catch { entry = { error: true, source }; }
    if (active) deliver(entry);
    else if (queue.length < 8) queue.push(entry);
    else overflow = true;
  }
  // Queue the original launch first; second-instance may arrive while the
  // backend/window is still being initialized, even after Electron app ready.
  receive(candidates(argv), 'cold-start');
  app.on('second-instance', (_event, args, _cwd, data) => {
    if (data && Object.hasOwn(data, field)) {
      const payload = data[field];
      receive(payload?.version === 1 && !payload.invalid ? payload.urls : null, 'second-instance');
    } else receive(candidates(args), 'second-instance'); // older clients
  });
  // macOS emits this before ready; Windows uses argv and second-instance.
  app.on('open-url', (event, url) => { event.preventDefault(); receive([url], 'open-url'); });
  return {
    start() {
      if (active) return;
      active = true;
      for (const entry of queue.splice(0)) deliver(entry);
      if (overflow) deliver({ error: true, source: 'startup-overflow' });
    },
  };
}
