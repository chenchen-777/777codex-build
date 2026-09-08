import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('macOS Keychain survives helper restart, uses authenticated encryption, rejects invalid URLs',{skip:process.platform!=='darwin'||!process.env.MANAGER777_NATIVE},()=>{
 const call=(op,value)=>{const result=spawnSync(process.env.MANAGER777_NATIVE,[],{input:JSON.stringify({op,value}),encoding:'utf8',timeout:15000,env:{...process.env,MANAGER777_ISOLATED:'1'}});assert.equal(result.status,0);return JSON.parse(result.stdout);};
 const sample='synthetic-mac-test-not-a-real-credential';
 const first=call('protect',sample);assert.equal(first.ok,true);assert.match(first.value,/^tauri-keychain-v1:/);assert.ok(!first.value.includes(sample));
 assert.equal(call('unprotect',first.value).value,sample);
 const second=call('protect',sample);assert.notEqual(first.value,second.value);assert.equal(call('unprotect',first.value).value,sample);
 const raw=Buffer.from(first.value.split(':')[1],'base64');raw[15]^=1;
 assert.equal(call('unprotect','tauri-keychain-v1:'+raw.toString('base64')).ok,false);
 assert.equal(call('unprotect','old-electron-credential').ok,false);
 for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:password@example.com'])assert.equal(call('openUrl',url).ok,false);
});
