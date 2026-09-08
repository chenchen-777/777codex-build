import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

const messages = {
  checking: '检查 Codex 安装状态', backup: '备份聊天记录',
  stopping: '关闭 Codex 进程', removing: '卸载 Codex 程序', verifying: '检查卸载结果',
};
const errors = {
  CODEX_NOT_INSTALLED: '未检测到已安装的 Codex。',
  CODEX_UNINSTALL_UNSUPPORTED: '当前安装类型请到 Windows 应用设置中卸载。',
  PORTABLE_REMOVE_UNSUPPORTED: '此便携目录不由管理工具维护，已停止卸载。',
  CODEX_STOP_FAILED: '无法关闭 Codex，请保存工作并退出 Codex 后重试。',
  CODEX_UNINSTALL_UNCONFIRMED: '卸载后仍检测到 Codex，请查看安装状态。',
  CODEX_UNINSTALL_FAILED: 'Windows 未完成卸载，请检查权限及是否仍有程序占用。',
};

/** A single in-memory task; real OS work remains in the existing child processes. */
export class UninstallTask {
  constructor({ execute, audit } = {}) {
    this.execute = execute; this.audit = audit;
    this.state = { phase: 'idle', busy: false, events: [] };
  }
  snapshot() { return structuredClone(this.state); }
  start() {
    if (this.state.busy) throw new AppError('卸载正在执行，请查看进度', 'OPERATION_BUSY', 409);
    this.state = { id: randomUUID(), phase: 'running', busy: true, startedAt: new Date().toISOString(), events: [] };
    this.report('checking');
    this.worker = Promise.resolve().then(() => this.execute(step => this.report(step)))
      .then(result => {
        if (!result?.uninstalled) throw new AppError('无法确认卸载结果', 'CODEX_UNINSTALL_UNCONFIRMED', 502);
        this.finish('complete', 'Codex 已卸载，聊天备份、配置与 Key 已保留。');
      }, error => { this.fail(error); })
      .catch(error => { this.fail(error); })
      .then(async () => {
        await this.audit?.record({ id: this.state.id, action: 'codex:uninstall-task', outcome: this.state.phase === 'complete' ? 'success' : 'error', code: this.state.code, durationMs: Date.now() - Date.parse(this.state.startedAt) }).catch(() => {});
      });
    return this.snapshot();
  }
  report(step) {
    if (!messages[step]) return;
    this.state.step = step; this.state.message = messages[step];
    this.state.events.push({ step, message: messages[step], time: new Date().toISOString() });
  }
  finish(phase, message) {
    this.state.phase = phase; this.state.message = message; this.state.busy = false;
    this.state.finishedAt = new Date().toISOString();
    this.state.events.push({ step: phase, message, time: this.state.finishedAt });
  }
  fail(error) {
    const code = String(error?.code || 'UNINSTALL_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 60);
    this.state.code = code;
    this.finish('error', errors[code] || `卸载未完成，停在“${messages[this.state.step] || '检查安装状态'}”。请检查磁盘空间、目录权限或程序占用后重试。`);
  }
}

export async function performUninstall({ installManager, status, backup, uninstall }, report) {
  if ((await installManager.target())?.source === 'portable') return installManager.removePortable(report);
  const current = await status();
  if (!current.installed) throw new AppError('未检测到 Codex', 'CODEX_NOT_INSTALLED', 404);
  if (!current.canUninstall) throw new AppError('安装类型不支持', 'CODEX_UNINSTALL_UNSUPPORTED', 409);
  report('backup'); await backup();
  return uninstall(report);
}
