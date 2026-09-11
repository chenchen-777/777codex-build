import {basename} from 'node:path';
import {AppError} from './errors.mjs';
export function commandFailure(cmd,error={}){
 const action=basename(cmd),exitCode=Number.isInteger(error.code)?error.code:null;
 const timedOut=!!error.killed&&['SIGTERM','SIGKILL'].includes(error.signal);
 const code=error.code==='ENOENT'?'MAC_COMPONENT_MISSING':error.code==='EACCES'?'MAC_PERMISSION_DENIED':timedOut?'MAC_COMMAND_TIMEOUT':'MAC_COMMAND_FAILED';
 const reason=code==='MAC_COMPONENT_MISSING'?'系统组件不存在':code==='MAC_PERMISSION_DENIED'?'没有执行权限':timedOut?'执行超时':`执行失败（退出码 ${exitCode??'未知'}）`;
 const result=new AppError(`${action}：${reason}。请保存脱敏日志反馈，不要关闭系统防护。`,code,409);
 result.diagnostics={action,exitCode,timedOut,signal:/^SIG[A-Z]+$/.test(error.signal||'')?error.signal:null};
 return result;
}
