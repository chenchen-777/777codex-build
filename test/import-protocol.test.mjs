import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportProtocol } from '../electron/import-protocol.mjs';
test('macOS uses declared bundle protocol without Windows executable arguments',()=>{
 const f=fixture();const service=createImportProtocol({app:f.app,executable:'/Applications/777Codex.app/Contents/MacOS/777Codex',isolated:false,platform:'darwin'});
 assert.equal(service.ensureRegistered().ok,true);assert.deepEqual(f.calls.find(c=>c[0]==='set'),['set','codes777']);
});
const executable = 'D:\\777 Client\\777Codex.exe';
function fixture(options = {}) {
  let current = false; const calls = [];
  const app = { isPackaged: true, isDefaultProtocolClient(...args) { calls.push(['check', ...args]); return current; }, setAsDefaultProtocolClient(...args) { calls.push(['set', ...args]); current = true; return true; }, ...options };
  return { app, calls, clear() { current = false; } };
}
test('normal packaged startup auto-registers codes777 with exact executable, then is idempotent and repairs loss', () => {
  const f = fixture(); const service = createImportProtocol({ app: f.app, executable, isolated: false, platform: 'win32' });
  assert.equal(service.ensureRegistered().ok, true);
  assert.deepEqual(f.calls.find(c => c[0] === 'set'), ['set', 'codes777', executable, []]);
  service.ensureRegistered(); assert.equal(f.calls.filter(c => c[0] === 'set').length, 1);
  f.clear(); assert.equal(service.state().status, 'failed');
  assert.equal(service.ensureRegistered().ok, true); assert.equal(f.calls.filter(c => c[0] === 'set').length, 2);
});
test('source, isolated and non-Windows modes never read or write protocol associations', () => {
  for (const [isPackaged, isolated, platform] of [[false, false, 'win32'], [true, true, 'win32'], [true, false, 'linux']]) {
    const f = fixture({ isPackaged }); const service = createImportProtocol({ app: f.app, executable, isolated, platform });
    assert.equal(service.ensureRegistered().status, 'unavailable'); assert.equal(service.state().canRetry, false); assert.equal(f.calls.length, 0);
  }
});
test('setter false, exception and unverified success all fail honestly and allow retry', () => {
  for (const setter of [() => false, () => { throw new Error('private diagnostic'); }, () => true]) {
    const f = fixture({ setAsDefaultProtocolClient: setter }); const service = createImportProtocol({ app: f.app, executable, isolated: false, platform: 'win32' });
    const result = service.ensureRegistered(); assert.equal(result.ok, false); assert.equal(result.canRetry, true); assert.ok(!result.message.includes('private diagnostic'));
  }
});
