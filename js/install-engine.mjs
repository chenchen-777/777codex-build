import { spawn } from 'node:child_process';
import { AppError } from './errors.mjs';

export class InstallEngine {
  constructor(executable, environment=process.env) { this.executable = executable; this.environment=environment; this.child = null; }
  call(action, params = {}, onProgress = () => {}) {
    if (this.child) return Promise.reject(new AppError('安装引擎正在处理任务', 'ENGINE_BUSY', 409));
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], { windowsHide: true, env:this.environment, stdio: ['pipe','pipe','pipe'] });
      this.child = child; let buffer = ''; let result; let stderr = '';
      const timer = setTimeout(() => child.kill(), action === 'download' ? 2 * 60 * 60_000 : 10 * 60_000);
      child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 2_000_000) { child.kill(); return; }
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,i); buffer = buffer.slice(i+1);
          try { const value = JSON.parse(line); if (value.protocol !== 1) continue; if (value.event === 'progress') onProgress(value.bytes); else if (value.event === 'result') result = value; } catch {}
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-1000); });
      const cleanup = () => { clearTimeout(timer); if (this.child === child) this.child = null; };
      child.on('error', error => { cleanup(); reject(new AppError(`安装引擎无法启动：${error.message}`, 'ENGINE_UNAVAILABLE', 503)); });
      child.on('close', code => {
        cleanup();
        if (code === 0 && result?.ok) resolve(result.data);
        else reject(new AppError(result?.message || stderr || '安装引擎未返回完成结果', 'ENGINE_FAILED', 502));
      });
      child.stdin.write(JSON.stringify({protocol:1, action, params})+'\n');
    });
  }
  control(action) { if (this.child && ['pause','cancel'].includes(action)) this.child.stdin.write(JSON.stringify({protocol:1,action})+'\n'); }
}
