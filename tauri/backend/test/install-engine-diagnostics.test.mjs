import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { InstallEngine } from '../../backend/js/install-engine.mjs';

function mockSpawn(scenarios) {
  const calls = [];
  const spawn = () => {
    const scenario = scenarios.shift();
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { scenario.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); };
    child.stdin.on('data', chunk => calls.push(JSON.parse(chunk.toString())));
    queueMicrotask(() => scenario.run(child));
    return child;
  };
  return {spawn, calls};
}

test('plan performs one version handshake without recursion or retaining the busy lock', async () => {
  const result = data => ({run(child) { child.stdout.end(JSON.stringify({protocol:1,event:'result',ok:true,data})); child.emit('close', 0, null); }});
  const mock = mockSpawn([result({protocol:1}), result({planned:true}), result({planned:true})]);
  const engine = new InstallEngine('engine.exe', {}, {spawn:mock.spawn});
  assert.deepEqual(await engine.call('plan'), {planned:true});
  assert.deepEqual(await engine.call('plan'), {planned:true});
  assert.deepEqual(mock.calls.map(value => value.action), ['version','plan','plan']);
});

test('decodes UTF-8 split across chunks and accepts a final line without newline', async () => {
  const mock = mockSpawn([{run(child) {
    const bytes = Buffer.from(JSON.stringify({protocol:1,event:'result',ok:true,data:{message:'完成'}}));
    const split = bytes.indexOf(Buffer.from('完')) + 1;
    child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split)); child.emit('close', 0, null);
  }}]);
  assert.deepEqual(await new InstallEngine('engine.exe', {}, {spawn:mock.spawn}).call('version'), {message:'完成'});
});

test('classifies missing VC++ runtime without exposing stderr secrets', async () => {
  const mock = mockSpawn([{run(child) { child.stderr.write('api_key=super-secret'); child.emit('close', -1073741515, null); }}]);
  await assert.rejects(new InstallEngine('engine.exe', {}, {spawn:mock.spawn}).call('version'), error => {
    assert.equal(error.code, 'ENGINE_RUNTIME_MISSING'); assert.match(error.message, /Microsoft Visual C\+\+ x64/);
    assert.equal(error.diagnostics.runtimeMissing, true); assert.equal(JSON.stringify(error).includes('super-secret'), false); return true;
  });
});

test('reports timeout, signal and missing protocol/result distinctly', async () => {
  let mock = mockSpawn([{run() {}}]);
  await assert.rejects(new InstallEngine('engine.exe', {}, {spawn:mock.spawn,timeouts:{version:5}}).call('version'), error => error.code === 'ENGINE_TIMEOUT' && error.diagnostics.timedOut);
  mock = mockSpawn([{run(child) { child.emit('close', null, 'SIGKILL'); }}]);
  await assert.rejects(new InstallEngine('engine.exe', {}, {spawn:mock.spawn}).call('version'), error => error.code === 'ENGINE_PROTOCOL_MISSING' && error.diagnostics.signal === 'SIGKILL');
  mock = mockSpawn([{run(child) { child.stdout.write('{"protocol":1,"event":"progress","bytes":1}\n'); child.emit('close', 1, null); }}]);
  await assert.rejects(new InstallEngine('engine.exe', {}, {spawn:mock.spawn}).call('version'), error => error.code === 'ENGINE_RESULT_MISSING' && error.diagnostics.protocolReceived);
});

test('emits only allowlisted diagnostics and ignores callback failures', async () => {
  let diagnostic;
  const mock = mockSpawn([{run(child) { child.stderr.write('secret-token'); child.emit('close', 9, 'SIGABRT'); }}]);
  const engine = new InstallEngine('engine.exe', {}, {spawn:mock.spawn,onDiagnostic(value) { diagnostic = value; throw new Error('logger failed'); }});
  await assert.rejects(engine.call('version'), error => error.code === 'ENGINE_PROTOCOL_MISSING');
  assert.deepEqual(Object.keys(diagnostic).sort(), ['action','code','exitCode','protocolReceived','resultReceived','runtimeMissing','signal','timedOut'].sort());
  assert.equal(JSON.stringify(diagnostic).includes('secret-token'), false);
});

test('cancel reaches the child and close releases busy state', async () => {
  const first = {run() {}};
  const success = {run(child) { child.stdout.end('{"protocol":1,"event":"result","ok":true,"data":{}}'); child.emit('close', 0, null); }};
  const mock = mockSpawn([first, success]); const engine = new InstallEngine('engine.exe', {}, {spawn:mock.spawn,timeouts:{download:1000}});
  const pending = engine.call('download'); await new Promise(resolve => setImmediate(resolve)); engine.control('cancel');
  assert.equal(mock.calls.at(-1).action, 'cancel');
  engine.child.emit('close', 1, null); await assert.rejects(pending);
  await engine.call('version');
});
