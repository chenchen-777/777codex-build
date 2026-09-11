import test from 'node:test';import assert from 'node:assert/strict';
import {commandFailure} from '../js/command-diagnostic.mjs';
test('Mac diagnostics distinguish missing, permission, timeout and exit without leaking command output',()=>{
 for(const [error,code]of [[{code:'ENOENT'},'MAC_COMPONENT_MISSING'],[{code:'EACCES'},'MAC_PERMISSION_DENIED'],[{code:1},'MAC_COMMAND_FAILED'],[{killed:true,signal:'SIGTERM'},'MAC_COMMAND_TIMEOUT']]){
  const result=commandFailure('/usr/bin/codesign',{...error,stderr:'token private'});assert.equal(result.code,code);assert.doesNotMatch(JSON.stringify(result),/private/);
 }
});
