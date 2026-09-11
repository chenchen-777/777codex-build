import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from './errors.mjs';

const PAID = new Set(['diagnose', 'verify', 'plan', 'apply', 'repair']);
const MUTATING = new Set(['apply', 'repair', 'rollback', 'recover']);
const ALLOWED = new Set(['inspect', 'status', ...PAID, ...MUTATING]);

function requiredPath(value, label) {
  const text = String(value || '').trim();
  if (!text || !isAbsolute(text)) throw new AppError(`${label}必须是绝对路径`, 'DOCTOR_PATH_REQUIRED', 400);
  return resolve(text);
}

export class ToolDoctorManager {
  constructor({ engine, isolated = false, audit, execute, allowedTarget } = {}) {
    this.engine = engine; this.isolated = isolated; this.audit = audit; this.executeOverride = execute; this.allowedTarget = allowedTarget;
  }
  async run(payload = {}, progress = () => {}) {
    const command = String(payload.command || 'inspect');
    if (!ALLOWED.has(command)) throw new AppError('不支持的工具修复操作', 'DOCTOR_COMMAND_INVALID', 400);
    const home = requiredPath(payload.home, 'Codex 配置目录');
    const binary = requiredPath(payload.binary, 'Codex 程序');
    await access(home).catch(() => { throw new AppError('Codex 配置目录不存在', 'DOCTOR_HOME_MISSING', 404); });
    await access(binary).catch(() => { throw new AppError('Codex 程序不存在', 'DOCTOR_BINARY_MISSING', 404); });
    if (this.allowedTarget && !await this.allowedTarget({ home, binary })) throw new AppError('所选路径不是管理工具当前识别的 Codex 配置和程序', 'DOCTOR_TARGET_MISMATCH', 409);
    if (this.isolated && (PAID.has(command) || MUTATING.has(command))) throw new AppError('隔离模式只允许离线检查合成目录，不发送请求或写入配置', 'ISOLATED_PREVIEW', 403);
    if (PAID.has(command) && payload.consent !== 'ALLOW_PAID_TOOL_TEST') throw new AppError('此操作可能发送真实模型请求并消耗额度，请先明确同意', 'DOCTOR_PAID_CONSENT_REQUIRED', 400);
    if (MUTATING.has(command) && payload.confirm !== `DOCTOR_${command.toUpperCase()}`) throw new AppError('请确认此次工具修复操作', 'CONFIRMATION_REQUIRED', 400);
    const execute = this.executeOverride || (await import(pathToFileURL(this.engine).href)).execute;
    progress('正在执行受保护的工具修复步骤');
    // Collect a bounded, safe summary even if candidate planning refuses a patch.
    const startedAt=Date.now();let result;
    try { result = await execute(command, { home, binary, repeats: payload.repeats || 2, timeout: payload.timeout || 30 }, message => progress(String(message || '处理中'))); }
    catch(error){
      const {readFile}=await import('node:fs/promises');
      try{const report=JSON.parse(await readFile(resolve(home,'tool-doctor','last-report.json'),'utf8'));
        if(Date.parse(report.createdAt)>=startedAt)error.diagnostic={createdAt:report.createdAt,samples:report.samples?.map(s=>({kind:s.kind,round:s.round,result:s.result,status:s.status,failure:s.failure,orphanDeltas:s.orphanDeltas})),summary:report.summary};
      }catch{}
      throw error;
    }
    await this.audit?.write?.({ action: `tool-doctor:${command}`, outcome: 'success', detail: { state: result?.state || command } });
    return { ok: true, command, result, notice: PAID.has(command) ? '检测或验证可能已消耗 API 额度。' : '本次未要求发送模型请求。' };
  }
}

export function doctorErrorKind(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = String(error?.message || '');
  if (status === 429) return { code: 'RATE_LIMITED', message: '请求受到限流；不能据此判断余额不足。' };
  if (status === 401 || status === 403) return { code: 'AUTH_FAILED', message: '认证失败，请检查 Key 与服务权限。' };
  if (/余额|quota|credit/i.test(text)) return { code: 'BALANCE_REPORTED', message: '服务明确报告额度或余额问题。' };
  if (/flat-control-failed/.test(text)) return { code: 'DOCTOR_CONTROL_FAILED', message: text };
  if (/no-format-evidence/.test(text)) return { code: 'DOCTOR_PATCH_NOT_APPLICABLE', message: text };
  if (/超时|timeout/i.test(text)) return { code: 'DOCTOR_TIMEOUT', message: text };
  return { code: error?.code || 'DOCTOR_ERROR', message: text || '工具修复操作失败。' };
}
