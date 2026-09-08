import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deleteProvider, getProviderSecret, listProviders,
  markProviderActive, upsertProvider,
} from "../js/provider-store.mjs";

const protect = (value) => Buffer.from(value, "utf8").toString("base64");
const unprotect = (value) => Buffer.from(value, "base64").toString("utf8");

test("provider store never exposes or persists a plaintext key", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "777codex-providers-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const secret = "sk-777-provider-secret";
  const saved = await upsertProvider(root, { name: "主线路", apiKey: secret, model: "gpt-5.5" }, protect);
  assert.equal(saved.maskedKey, "sk-777••••••••cret");
  assert.equal(saved.apiKey, undefined);
  assert.doesNotMatch(await readFile(join(root, "providers.json"), "utf8"), new RegExp(secret));
  assert.equal((await getProviderSecret(root, saved.id, unprotect)).apiKey, secret);
});

test("active provider deletes after confirmation, with encrypted backup and no replacement selection", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "777codex-providers-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const saved = await upsertProvider(root, { name: "主线路", apiKey: "sk-777-provider-secret" }, protect);
  await markProviderActive(root, saved.id, "text");
  const other = await upsertProvider(root, { name: '备用', apiKey: 'sk-FAKE-other-provider' }, protect);
  assert.equal((await listProviders(root))[0].active, true);
  await assert.rejects(deleteProvider(root, saved.id), { code: 'ACTIVE_DELETE_CONFIRMATION_REQUIRED' });
  assert.equal((await listProviders(root)).length, 2);
  const result = await deleteProvider(root, saved.id, { confirmActive: true });
  assert.equal(result.deletedActive, true);
  const remaining = await listProviders(root);
  assert.equal(remaining.length, 1); assert.equal(remaining[0].id, other.id); assert.equal(remaining[0].active, false);
  const backup = await readFile(join(root, 'provider-backups', result.backupId), 'utf8');
  assert.equal(JSON.parse(backup).providers.length, 2); assert.equal(backup.includes('sk-777-provider-secret'), false);
  await deleteProvider(root, other.id); assert.deepEqual(await listProviders(root), []);
});
