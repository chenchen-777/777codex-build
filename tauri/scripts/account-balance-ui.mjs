import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function patchAccountBalanceUi(source){
 source=source.replace(/const usageAmount=.*?;\n/,"const balanceAmount=balance=>{const value=Number(balance?.amount),valid=balance?.amount!==null&&balance?.amount!==undefined&&balance?.amount!==''&&Number.isFinite(value),unit=balance?.currency?escape(balance.currency):'单位未提供';return valid?`<span title=\"完整值：${escape(balance.amount)} · ${unit}\">${value.toFixed(2)} <small>${unit}</small></span>`:'暂未取得';};\n");
 source=source.replace(',usage=snapshot.usage;',',balance=snapshot.balance;')
  .replace('当前密钥可用额度</p><div class="balance-value">${usageAmount(usage)}</div><p class="subtle">这不是网页账户余额；账户余额请到平台查看。</p>','账户余额</p><div class="balance-value">${balanceAmount(balance)}</div><p class="subtle">来自当前登录的 777codes 账户，与所选密钥无关。</p>')
  .replace("${button('刷新额度','balance-refresh','link')}","${button('刷新账户余额','balance-refresh','link')}")
  .replace('{referral:previous.referral,keySyncState:previous.keySyncState}', '{referral:previous.referral,keySyncState:previous.keySyncState,balance:previous.balance,balanceAt:previous.balanceAt,accountFetchedAt:previous.accountFetchedAt}')
  .replace(/\.\.\.\(sameKey\?\{usage:previous\.usage,usageAt:previous\.usageAt,accountFetchedAt:previous\.accountFetchedAt\}:\{\}\)/,'')
  .replace("snapshot.usageAt?'余额更新于 '+new Date(snapshot.usageAt).toLocaleTimeString()", "snapshot.balanceAt?'账户余额更新于 '+new Date(snapshot.balanceAt).toLocaleTimeString()")
  .replace('/(<div class="balance-value">[^<]*<\\/div>)/', '/(<div class="balance-value">[\\s\\S]*?<\\/div>)/')
  .replace("activeId?api('/api/providers/usage',{id:activeId}):Promise.resolve(null)", "api('/api/account/balance')")
  .replace("if(usage.status==='fulfilled'){snapshot.usage=usage.value?.usage;snapshot.usageAt=Date.now();}else errors.push(`余额更新失败，保留上次数据：${usage.reason.message}`);", "if(usage.status==='fulfilled'){if(usage.value?.userId!==userId)return;snapshot.balance=usage.value?.balance;snapshot.balanceAt=Date.now();}else errors.push(`账户余额更新失败，显示的同一账号上次数据可能已过期：${usage.reason.message}`);");
 if(!source.includes("api('/api/account/balance')")||source.includes("api('/api/providers/usage',{id:activeId})"))throw Error('account balance UI patch incomplete');return source;
}
export async function applyAccountBalanceUi(target){const path=join(target,'tool-ui.js');await writeFile(path,patchAccountBalanceUi(await readFile(path,'utf8')));}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await applyAccountBalanceUi(fileURLToPath(new URL('../backend/',import.meta.url)));
