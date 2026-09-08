import test from 'node:test';
import assert from 'node:assert/strict';
import {configureLoginRecovery} from '../scripts/login-recovery.mjs';
function fixture(fail=false){
 let starts=0,opens=0;
 const account={now:()=>100,assertLive(){},publicStatus:(state,extra)=>({state,...extra}),openExternal:async()=>{opens++;if(fail)throw Error('OS failure');},async startLogin(){starts++;this.pending={expiresAt:1000,interval:3,authorizeUrl:'https://www.777codes.codes/desktop/authorize?session_id=synthetic',verifier:'never-render'};await this.openExternal(this.pending.authorizeUrl);return this.publicStatus('pending');}};
 configureLoginRecovery(account);return {account,counts:()=>({starts,opens})};
}
test('retry opens the same unexpired PKCE session without exposing verifier',async()=>{
 const {account,counts}=fixture();await account.startLogin();const result=await account.startLogin();
 assert.deepEqual(counts(),{starts:1,opens:2});assert.ok(result.authorizeUrl);assert.ok(!JSON.stringify(result).includes('never-render'));
});
test('opener failure leaves copyable authorization link, not false login success',async()=>{
 const {account}=fixture(true);const result=await account.startLogin();assert.equal(result.state,'pending');assert.match(result.message,/复制/);assert.ok(result.authorizeUrl);
});
test('expired links and logged-in status do not expose an authorization URL',async()=>{
 const {account,counts}=fixture();await account.startLogin();account.pending.expiresAt=99;assert.equal(account.publicStatus('pending').authorizeUrl,undefined);await account.startLogin();assert.equal(counts().starts,2);assert.equal(account.publicStatus('logged-in').authorizeUrl,undefined);
});
