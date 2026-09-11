import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AppError } from './errors.mjs';

const RUNTIME_EXIT_CODES = new Set([0xC0000135, -1073741515]);
const MAX_OUTPUT = 2_000_000;

function engineError(message, code, status, diagnostics) {
  const error = new AppError(message, code, status);
  error.diagnostics = Object.fromEntries(Object.entries(diagnostics).filter(([key, value]) =>
    ['exitCode', 'signal', 'timedOut', 'protocolReceived', 'resultReceived', 'runtimeMissing'].includes(key) && value !== undefined
  ));
  return error;
}

export class InstallEngine {
  constructor(executable, environment = process.env, options = {}) {
    this.executable = executable;
    this.environment = environment;
    this.spawn = options.spawn || spawn;
    this.timeouts = options.timeouts || {};
    this.onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this.child = null;
    this.busy = false;
    this.versionChecked = false;
  }

  async call(action, params = {}, onProgress = () => {}) {
    if (this.busy) throw new AppError('安装引擎正在处理任务', 'ENGINE_BUSY', 409);
    this.busy = true;
    try {
      if (action === 'plan' && !this.versionChecked) {
        await this.invoke('version', {}, () => {});
        this.versionChecked = true;
      }
      return await this.invoke(action, params, onProgress);
    } finally {
      this.busy = false;
    }
  }

  invoke(action, params, onProgress) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawn(this.executable, [], { windowsHide: true, env: this.environment, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        try { this.onDiagnostic({action, code:'ENGINE_UNAVAILABLE', protocolReceived:false, resultReceived:false}); } catch {}
        reject(engineError(`安装引擎无法启动：${error.message}`, 'ENGINE_UNAVAILABLE', 503, {protocolReceived:false, resultReceived:false}));
        return;
      }
      this.child = child;
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let result;
      let protocolReceived = false;
      let outputBytes = 0;
      let timedOut = false;
      let settled = false;
      const timeout = this.timeouts[action] ?? (action === 'download' ? 2 * 60 * 60_000 : 10 * 60_000);
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
      const cleanup = () => { clearTimeout(timer); if (this.child === child) this.child = null; };
      const finish = (fn, value) => { if (settled) return; settled = true; cleanup(); fn(value); };
      const parseLine = line => {
        if (!line.trim()) return;
        let value;
        try { value = JSON.parse(line); } catch { return; }
        if (value?.protocol !== 1) return;
        protocolReceived = true;
        if (value.event === 'progress') onProgress(value.bytes);
        else if (value.event === 'result') result = value;
      };
      const consume = final => {
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          parseLine(buffer.slice(0, index).replace(/\r$/, ''));
          buffer = buffer.slice(index + 1);
        }
        if (final && buffer) { parseLine(buffer.replace(/\r$/, '')); buffer = ''; }
      };
      child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT) { child.kill(); return; }
        buffer += decoder.write(chunk); consume(false);
      });
      // stderr is deliberately drained but never copied into errors or diagnostics.
      child.stderr.on('data', () => {});
      child.on('error', error => {
        const diagnostics = {timedOut, protocolReceived, resultReceived:Boolean(result)};
        try { this.onDiagnostic({action, code:'ENGINE_UNAVAILABLE', ...diagnostics}); } catch {}
        finish(reject, engineError(`安装引擎无法启动：${error.message}`, 'ENGINE_UNAVAILABLE', 503, diagnostics));
      });
      child.on('close', (code, signal) => {
        buffer += decoder.end(); consume(true);
        const exitCode = typeof code === 'number' ? code : null;
        const runtimeMissing = RUNTIME_EXIT_CODES.has(exitCode) || RUNTIME_EXIT_CODES.has(exitCode >>> 0);
        const diagnostics = {exitCode, signal:signal || null, timedOut, protocolReceived, resultReceived:Boolean(result), runtimeMissing};
        const fail = (message, errorCode, status) => {
          try { this.onDiagnostic({action, code:errorCode, ...diagnostics}); } catch {}
          return finish(reject, engineError(message, errorCode, status, diagnostics));
        };
        if (timedOut) return fail('安装引擎响应超时，请重试', 'ENGINE_TIMEOUT', 504);
        if (runtimeMissing) return fail('安装引擎缺少 Microsoft Visual C++ x64 运行库，请安装后重试', 'ENGINE_RUNTIME_MISSING', 503);
        if (code === 0 && result?.ok) return finish(resolve, result.data);
        if (!protocolReceived) return fail('安装引擎未返回有效协议响应', 'ENGINE_PROTOCOL_MISSING', 502);
        if (!result) return fail('安装引擎未返回完成结果', 'ENGINE_RESULT_MISSING', 502);
        return fail(result.message || '安装引擎执行失败', 'ENGINE_FAILED', 502);
      });
      child.stdin.write(JSON.stringify({protocol:1, action, params}) + '\n');
    });
  }

  control(action) {
    if (this.child && ['pause', 'cancel'].includes(action)) this.child.stdin.write(JSON.stringify({protocol:1, action}) + '\n');
  }
}
