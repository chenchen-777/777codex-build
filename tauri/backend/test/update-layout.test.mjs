import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manager update controls are live rather than demo controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(html, /id="manager-update-check"/);
  assert.match(html, /id="manager-update-auto" data-live-setting/);
  assert.doesNotMatch(html, /data-demo="检查组件更新"/);
  assert.match(ui, /\/api\/manager-update\/install/);
  assert.match(ui, /\.switch:not\(\[data-live-setting\]\)/);
});

test('desktop updater creates one reusable disabled-on-run task before a forced clean handoff', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /schtasks\.exe/);
  assert.match(source, /'\/Create'/);
  assert.match(source, /'\/Run'/);
  assert.match(source, /const taskName = '777Codex-Update'/);
  assert.match(source, /spawnSync\(schtasks, \['\/Change', '\/TN', taskName, '\/DISABLE'\]/);
  assert.doesNotMatch(source, /'\/Z'/);
  assert.match(source, /update-launcher\.log/);
  assert.match(source, /app\.exit\(0\)/);
  assert.match(source, /cleanupPreviousUpdateTask/);
  assert.match(source, /state\.taskName !== '777Codex-Update'/);
});
