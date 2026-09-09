import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
function harness() {
  const nodes = new Map(), calls = [], timers = [];
  class Element {
    value = ''; textContent = ''; disabled = false; dataset = {}; hidden = false; children = []; listeners = {};
    classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
    addEventListener(type, action) { (this.listeners[type] ||= []).push(action); }
    async emit(type) { for (const fn of this.listeners[type] || []) await fn({ currentTarget: this, target: this }); }
    click() { return this.emit('click'); }
    replaceChildren(...children) { this.children = children; this.value = (children.find(c => c.selected) || children[0])?.value || ''; }
    prepend(child) { this.children.unshift(child); if (child.selected) this.value = child.value; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    setAttribute() {} scrollTo() {} scrollIntoView() {}
  }
  const node = s => nodes.get(s) || null;
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set('#' + match[1], new Element());
  for (const s of ['[data-modal-save]', '.main-content']) nodes.set(s, new Element());
  const profiles = ['one', 'two'].map((id, i) => ({ id, name: id, type: 'text', model: i ? 'model-b' : 'model-a', reasoningEffort: 'high', active: !i, adapter: {canActivate:true,canSyncModels:true} }));
  const state = { models: async id => ({models: [id === 'one' ? 'model-a' : 'model-b']}), usage: async()=>({usage:{remaining:0}}), running: false };
  async function fetch(path, options) {
    const body = options?.body ? JSON.parse(options.body) : null; calls.push({path, body});
    let value = {};
    if (path === '/api/providers') value = {providers: profiles};
    if (path === '/api/model/sync') value = {status: 'unconfigured'};
    if (path === '/api/providers/models') value = await state.models(body.id);
    if (path === '/api/providers/usage') value = await state.usage(body.id);
    if (path === '/api/codex/status') value = {installed: true, running:state.running,canUninstall:true};
    if (path === '/api/extensions') value = {imageMcp:{installed:false}};
    if (path === '/api/manager-update/status') value = {settings:{autoCheck:false},current:{version:'0.11.0',revisionLabel:'r35'}};
    if (path === '/api/providers/save') Object.assign(profiles.find(p => p.id === body.id), body);
    return {ok:true,json:async()=>value};
  }
  const window = {addEventListener(){}};
  vm.runInNewContext(source, {window,document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}},fetch,Option:class {constructor(text,value,def,selected){Object.assign(this,{text,value,selected});}},setTimeout:fn=>timers.push(fn),clearTimeout(){},CustomEvent:class{},console});
  window.manager777.confirm = async()=>true;
  return {nodes,calls,profiles,state,window,timers,node,settle:async()=>{for(let i=0;i<30;i++)await Promise.resolve();}};
}
test('real renderer boots using only existing static IDs; reviewed navigation includes Codex management', async()=>{
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((html.match(/class="nav-item/g)||[]).length,5);
  assert.doesNotMatch(html,/review\.js|data-demo=/);
  const h=harness();await h.settle();
  assert.equal(h.node('#home-key-select').value,'one');
  assert.equal(h.node('#home-model-select').value,'model-a');
  assert.doesNotMatch(h.node('#toast').textContent,/初始化失败/);
});

test('balance refresh does not verify models and keeps zero visible; errors clear stale balances', async()=>{
  const h=harness();await h.settle();h.calls.length=0;
  h.state.models=async()=>{throw Error('should not query models');};
  await h.node('#refresh-balance').click();
  assert.equal(h.node('#home-balance').textContent,0);
  assert.equal(h.calls.filter(c=>c.path==='/api/providers/usage').length,1);
  assert.equal(h.calls.some(c=>c.path==='/api/providers/models'||c.path==='/api/providers/verify'),false);
  h.state.usage=async()=>{throw Error('余额刷新失败：网络异常');};
  await h.node('#refresh-balance').click();
  assert.equal(h.node('#home-balance').textContent,'—');
  assert.match(h.node('#toast').textContent,/余额刷新失败：网络异常/);
  h.state.models=async()=>{throw Error('余额不足');};
  await h.node('#home-sync-models').click();
  assert.match(h.node('#home-model-message').textContent,/同步失败：余额不足/);
});
test('model sync rejects stale Key results and failed/unsupported models block launch', async()=>{
  const h=harness();await h.settle();let resolve;
  h.state.models=()=>new Promise(r=>resolve=r);
  const sync=h.node('#home-sync-models').click();await h.settle();
  h.node('#home-key-select').value='two';await h.node('#home-key-select').emit('change');
  resolve({models:['model-a']});await sync;
  assert.equal(h.node('#home-model-select').value,'model-b');
  h.state.models=async()=>({models:['different']});await h.node('#home-sync-models').click();
  assert.equal(h.node('#home-model-select').value,'');assert.equal(h.node('#home-start-with-key').disabled,true);
  h.state.models=async()=>{throw new Error('502');};await h.node('#home-sync-models').click();
  assert.equal(h.node('#home-start-with-key').disabled,true);
  assert.match(h.node('#home-model-message').textContent,/同步失败/);
});
test('explicit model and effort are saved before activate and launch; no credential enters DOM request', async()=>{
  const h=harness();await h.settle();
  h.state.models=async()=>({models:['model-a','model-new']});await h.node('#home-sync-models').click();
  h.node('#home-model-select').value='model-new';await h.node('#home-model-select').emit('change');
  h.node('#home-effort-select').value='low';await h.node('#home-effort-select').emit('change');
  h.calls.length=0;await h.node('#home-start-with-key').click();
  const paths=h.calls.map(c=>c.path);
  assert.ok(paths.indexOf('/api/providers/save')<paths.indexOf('/api/providers/activate'));
  assert.ok(paths.indexOf('/api/providers/activate')<paths.indexOf('/api/codex/launch'));
  const saved=h.calls.find(c=>c.path==='/api/providers/save').body;
  assert.equal(saved.model,'model-new');assert.equal(saved.reasoningEffort,'low');assert.equal(saved.apiKey,undefined);
  assert.equal(h.node('#home-start-with-key').disabled,false);
});
