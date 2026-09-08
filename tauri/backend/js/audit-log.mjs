import { appendFile, mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function redact(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[已脱敏]");
  return text.replace(/\bsk-[\w.-]+/gi, "[已脱敏]")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [已脱敏]")
    .replace(/((?:api[_-]?key|token|ticket|password|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[已脱敏]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已脱敏]@")
    .replace(/([?&](?:key|token|ticket|secret|api_key|access_token)=)[^&#\s]+/gi, "$1[已脱敏]");
}

// A strict field allowlist: request/response bodies, command arguments, env values
// and renderer console messages are intentionally never persisted.
export class AuditLog {
  constructor(root, { maxBytes = 1024 * 1024 } = {}) {
    this.root = join(root, "logs"); this.maxBytes = maxBytes; this.queue = Promise.resolve(); this.failure = null;
  }
  record(event) {
    const row = {
      id: event.id || randomUUID(), time: new Date().toISOString(),
      action: redact(event.action || "operation").slice(0, 120),
      outcome: ["success", "error", "started"].includes(event.outcome) ? event.outcome : "success",
      status: Number(event.status || 0), durationMs: Math.max(0, Number(event.durationMs || 0)),
      code: String(event.code || "").replace(/[^A-Z0-9_]/g, "").slice(0, 60),
    };
    const work = this.queue.then(async () => {
      await mkdir(this.root, { recursive: true });
      const target = join(this.root, "operations.jsonl");
      const size = await stat(target).then(s => s.size).catch(e => { if (e.code === "ENOENT") return 0; throw e; });
      if (size >= this.maxBytes) await rename(target, join(this.root, `operations-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`));
      await appendFile(target, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
      this.failure = null;
    });
    this.queue = work.catch(() => { this.failure = "日志写入失败，请检查磁盘空间和目录权限"; });
    return work;
  }
  async list({ outcome = "", limit = 200 } = {}) {
    await this.queue;
    let names;
    try { names = await readdir(this.root); } catch (e) { if (e.code !== "ENOENT") throw e; names = []; }
    const files = names.filter(n => /^operations(?:-\d+-[a-f0-9]{8})?\.jsonl$/.test(n)).sort().reverse();
    let rows = []; let malformed = 0;
    for (const name of files.slice(0, 20)) {
      const text = await readFile(join(this.root, name), "utf8");
      for (const line of text.split("\n").filter(Boolean)) {
        try { rows.push(JSON.parse(line)); } catch { malformed++; }
      }
    }
    rows.sort((a, b) => b.time.localeCompare(a.time));
    if (outcome) rows = rows.filter(r => r.outcome === outcome);
    return { entries: rows.slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000))), warning: this.failure, malformed, path: this.root };
  }
}
