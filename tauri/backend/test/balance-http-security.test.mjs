import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountManager} from '../js/account-manager.mjs';

test('balance GET reaches business logic without Origin while request boundary still rejects untrusted callers',async t=>{
 const root=await mkdtemp(join(tmpdir(),'777-balance-http-'));
 process.env.PORT='0';
 process.env.MANAGER777_ISOLATED='1';
 process.env.MANAGER777_ROOT=join(root,'manager');
 process.env.MANAGER777_CODEX_ROOT=join(root,'codex');
 process.env.MANAGER777_SKILL_ROOT=join(root,'skills');
 await mkdir(process.env.MANAGER777_ROOT);
 const originalBalance=AccountManager.prototype.balance;
 AccountManager.prototype.balance=async()=>({userId:'usr_balance_browser',balance:{amount:17.25,currency:'USD',source:'account',updatedAt:'2026-09-20T00:00:00.000Z'}});
 t.after(()=>{AccountManager.prototype.balance=originalBalance;});
 const {server,ready}=await import('../scripts/server.mjs');
 const {url}=await ready;
 t.after(async()=>{
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await rm(root,{recursive:true,force:true});
 });
 const cookie=(await fetch(url+'/')).headers.get('set-cookie').split(';')[0];
 const request=(headers={})=>fetch(url+'/api/account/balance',{headers:{cookie,...headers}});

 const local=await request();
 assert.equal(local.status,200);
 const localBody=await local.json();assert.equal(localBody.userId,'usr_balance_browser');
 assert.deepEqual(localBody.balance,{amount:17.25,currency:'USD',source:'account',updatedAt:'2026-09-20T00:00:00.000Z'});

 const foreignOrigin=await request({Origin:'https://attacker.invalid'});
 assert.equal(foreignOrigin.status,403);
 assert.equal((await foreignOrigin.json()).code,'CROSS_SITE');

 const crossSite=await request({'Sec-Fetch-Site':'cross-site'});
 assert.equal(crossSite.status,403);
 assert.equal((await crossSite.json()).code,'CROSS_SITE');

 const noSession=await fetch(url+'/api/account/balance');
 assert.equal(noSession.status,403);
 assert.equal((await noSession.json()).code,'SESSION_REQUIRED');
});
