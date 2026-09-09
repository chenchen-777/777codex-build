import { join } from "node:path";
import { ManagedConfig } from "../js/managed-config.mjs";
import { McpManager } from "../js/mcp-manager.mjs";
import { SkillManager } from "../js/skill-manager.mjs";
import { PluginManager, CodexRpc, locateCodexCore } from "../js/plugin-manager.mjs";
import { EnhancementManager } from "../js/enhancement-manager.mjs";
import { PluginRepairManager } from "../js/plugin-repair-manager.mjs";
import { CodexppManager } from "../js/codexpp-manager.mjs";
import { requireConfirmation, ensure } from "../js/errors.mjs";

export function createFeatureApi({ codexRoot, managerRoot, userSkillRoot, componentArchive, pluginRepairArchive, audit, adapters, status, readBody, sendJson }) {
  const config = new ManagedConfig(codexRoot);
  const mcp = new McpManager(config);
  const skills = new SkillManager({ codexRoot, managerRoot, userRoot: userSkillRoot });
  const plugins = new PluginManager(config, async () => new CodexRpc(await locateCodexCore(await status(), process.env, managerRoot), { codexRoot, cwd: managerRoot }));
  const enhancements = new EnhancementManager({ managerRoot, componentArchive, codexStatus: status, openPath: path => adapters().openPath(path) });
  const pluginRepair = new PluginRepairManager({ codexRoot, managerRoot, componentArchive: pluginRepairArchive, codexStatus: status });
  const codexpp = new CodexppManager({ codexRoot, managerRoot, codexStatus: status });
  process.once('exit', () => codexpp.dispose());
  return async (request, response, pathname) => {
    if (request.method === "GET") {
      const query = new URL(request.url, "http://127.0.0.1").searchParams;
      if (pathname === "/api/logs") { sendJson(response, 200, { ok: true, ...await audit.list({ outcome: query.get("outcome"), limit: query.get("limit") }) }); return true; }
      if (pathname === "/api/logs/export") {
        const result = await audit.list({ limit: 1000 });
        response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": 'attachment; filename="777codex-operations.jsonl"', "Cache-Control": "no-store" });
        response.end(result.entries.map(e => JSON.stringify(e)).join("\n") + "\n"); return true;
      }
      if (pathname === "/api/extensions/mcp") { sendJson(response, 200, { ok: true, ...await mcp.list() }); return true; }
      if (pathname === "/api/extensions/skills") { sendJson(response, 200, { ok: true, ...await skills.list() }); return true; }
      if (pathname === "/api/extensions/skills/read") { sendJson(response, 200, { ok: true, ...await skills.read(query.get("scope"), query.get("folder")) }); return true; }
      if (pathname === "/api/extensions/skills/recoveries") { sendJson(response, 200, { ok: true, recoveries: await skills.recoveries() }); return true; }
      if (pathname === "/api/extensions/plugins") { sendJson(response, 200, await plugins.list()); return true; }
      if (pathname === "/api/extensions/snapshots") { sendJson(response, 200, { ok: true, snapshots: await config.listBackups(), revision: (await config.read()).revision }); return true; }
      if (pathname === "/api/enhancements") { const result = await enhancements.status(); sendJson(response, 200, { ...result, pluginRepair: await pluginRepair.status() }); return true; }
      if (pathname === "/api/enhancements/codexpp") { sendJson(response, 200, await codexpp.status()); return true; }
      if (pathname === "/api/enhancements/codexpp/recoveries") { sendJson(response, 200, await codexpp.recoveries()); return true; }
      if (pathname === "/api/enhancements/codex-zh/recoveries") { sendJson(response, 200, await enhancements.recoveries()); return true; }
      if (pathname === "/api/enhancements/plugin-repair/recoveries") { sendJson(response, 200, await pluginRepair.recoveries()); return true; }
    }
    if (request.method !== "POST") return false;
    const routes = {
      "/api/enhancements/codexpp/settings": p => codexpp.save(p.settings),
      "/api/enhancements/codexpp/repair": async p => { requireConfirmation(p.confirm, "REPAIR_PLUGINS"); return codexpp.repair(); },
      "/api/enhancements/codexpp/launch": async p => { requireConfirmation(p.confirm, "START_CODEXPP"); return codexpp.launch(); },
      "/api/extensions/mcp/save": async p => { requireConfirmation(p.confirm, "SAVE_MCP"); return mcp.save(p); },
      "/api/extensions/mcp/toggle": async p => { requireConfirmation(p.confirm, "TOGGLE_MCP"); return mcp.toggle(p); },
      "/api/extensions/mcp/remove": async p => { requireConfirmation(p.confirm, "REMOVE_MCP"); return mcp.remove(p); },
      "/api/extensions/mcp/check": p => mcp.check(p.name),
      "/api/extensions/skills/save": async p => { requireConfirmation(p.confirm, "SAVE_SKILL"); return skills.save(p); },
      "/api/extensions/skills/import": async p => { requireConfirmation(p.confirm, "IMPORT_SKILL"); return skills.importDirectory(p); },
      "/api/extensions/skills/remove": async p => { requireConfirmation(p.confirm, "REMOVE_SKILL"); return skills.remove(p); },
      "/api/extensions/skills/restore": async p => { requireConfirmation(p.confirm, "RESTORE_SKILL"); return skills.restore(p.id); },
      "/api/extensions/skills/choose": async () => ({ ok: true, source: await adapters().chooseSkillDirectory() }),
      "/api/extensions/plugins/toggle": async p => { requireConfirmation(p.confirm, "TOGGLE_PLUGIN"); return plugins.toggle(p); },
      "/api/extensions/plugins/install": async p => { requireConfirmation(p.confirm, "INSTALL_PLUGIN"); return plugins.install(p); },
      "/api/extensions/snapshots/restore": async p => { requireConfirmation(p.confirm, "RESTORE_EXTENSION_CONFIG"); return config.restore(p.id, p.revision); },
      "/api/enhancements/codex-zh/install": async p => { requireConfirmation(p.confirm, "INSTALL_CODEX_ZH"); return enhancements.install(); },
      "/api/enhancements/codex-zh/launch": async () => enhancements.launch(),
      "/api/enhancements/codex-zh/remove": async p => { requireConfirmation(p.confirm, "REMOVE_CODEX_ZH"); return enhancements.remove(); },
      "/api/enhancements/codex-zh/restore": async p => { requireConfirmation(p.confirm, "RESTORE_CODEX_ZH"); return enhancements.restore(p.id); },
      "/api/enhancements/plugin-repair/run": async p => { requireConfirmation(p.confirm, "REPAIR_PLUGINS"); return pluginRepair.repair(); },
      "/api/enhancements/plugin-repair/restore": async p => { requireConfirmation(p.confirm, "RESTORE_PLUGIN_REPAIR"); return pluginRepair.restore(p.id); },
      "/api/logs/open": async () => { const message = await adapters().openPath(join(managerRoot, "logs")); ensure(!message, "无法打开日志目录"); return { ok: true }; },
    };
    if (!routes[pathname]) return false;
    sendJson(response, 200, await routes[pathname](await readBody(request))); return true;
  };
}
