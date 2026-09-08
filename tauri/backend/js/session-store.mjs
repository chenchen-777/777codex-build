import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

async function walk(root, output = [], depth = 0) {
  if (depth > 6) return output;
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const pathname = join(root, entry.name);
    if (entry.isDirectory()) await walk(pathname, output, depth + 1);
    else if (/\.jsonl$/i.test(entry.name)) output.push(pathname);
  }
  return output;
}

export async function listSessions(codexRoot) {
  const sessionsRoot = join(codexRoot, "sessions");
  const files = await walk(sessionsRoot);
  const rows = [];
  let totalBytes = 0;
  for (const pathname of files) {
    try {
      const info = await stat(pathname);
      totalBytes += info.size;
      rows.push({
        id: basename(pathname, ".jsonl"),
        name: basename(pathname, ".jsonl"),
        path: pathname,
        modifiedAt: info.mtime.toISOString(),
        size: info.size,
      });
    } catch {}
  }
  rows.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  if (rows.length) return { sessions: rows.slice(0, 200), total: rows.length, totalBytes, sessionsRoot, source: "jsonl" };

  const databasePath = join(codexRoot, "state_5.sqlite");
  try {
    const databaseInfo = await stat(databasePath);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const count = Number(database.prepare("SELECT COUNT(*) AS count FROM threads").get()?.count || 0);
      const records = database.prepare(`
        SELECT id, title, cwd, model_provider, model, reasoning_effort, rollout_path,
               tokens_used, archived,
               COALESCE(NULLIF(recency_at_ms, 0), updated_at_ms, updated_at * 1000) AS modified_ms
        FROM threads
        ORDER BY modified_ms DESC, id DESC
        LIMIT 200
      `).all();
      const sessions = records.map((record) => ({
        id: String(record.id),
        name: String(record.title || record.id),
        path: String(record.rollout_path || ""),
        project: String(record.cwd || ""),
        provider: String(record.model_provider || ""),
        model: String(record.model || ""),
        reasoningEffort: String(record.reasoning_effort || ""),
        modifiedAt: new Date(Number(record.modified_ms || 0)).toISOString(),
        size: 0,
        tokensUsed: Number(record.tokens_used || 0),
        archived: Boolean(record.archived),
      }));
      return { sessions, total: count, totalBytes: databaseInfo.size, sessionsRoot: databasePath, source: "state_5.sqlite" };
    } finally { database.close(); }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { sessions: [], total: 0, totalBytes: 0, sessionsRoot, source: "none" };
  }
}

export async function backupSessions(codexRoot, managerRoot) {
  const source = join(codexRoot, "sessions");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const target = join(managerRoot, "Backups", `sessions-${stamp}`);
  await mkdir(target, { recursive: true });
  try {
    await cp(source, join(target, "sessions"), { recursive: true, errorOnExist: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(join(target, "sessions"), { recursive: true });
  }
  const databasePath = join(codexRoot, "state_5.sqlite");
  try {
    await stat(databasePath);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try { await sqliteBackup(database, join(target, "state_5.sqlite")); }
    finally { database.close(); }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return { ok: true, target, createdAt: new Date().toISOString() };
}
