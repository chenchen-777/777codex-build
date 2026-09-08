import { resolve, isAbsolute } from "node:path";
import { access } from "node:fs/promises";
import { ensure } from "./errors.mjs";
import { replaceTable } from "./managed-config.mjs";
import { redact } from "./audit-log.mjs";

function validName(name) { ensure(typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name) && !["constructor", "prototype", "__proto__"].includes(name), "MCP 名称限字母、数字、短横线和下划线"); return name; }
function strings(value, label) { ensure(Array.isArray(value) && value.length <= 100 && value.every(x => typeof x === "string" && x.length <= 2048 && !/[\0\r\n]/.test(x)), `${label} 必须是字符串数组`); return value; }
function envNames(value) { return strings(value, "环境变量名").map(n => { ensure(/^[A-Za-z_][A-Za-z0-9_]*$/.test(n), "环境变量名称不合法"); return n; }); }
function safeArgs(args = []) {
  let secretNext = false;
  return args.map(a => {
    const text = String(a); const hidden = secretNext; secretNext = /^--?(?:api[-_]?key|token|password|secret|authorization)$/i.test(text);
    return hidden ? "[已脱敏]" : redact(text);
  });
}
export class McpManager {
  constructor(config) { this.config = config; }
  async list() {
    const state = await this.config.read();
    return { revision: state.revision, servers: Object.entries(state.data.mcp_servers || {}).map(([name, s]) => ({
      name, transport: s.url ? "http" : "stdio", command: redact(s.command || ""), url: redact(s.url || ""),
      args: safeArgs(s.args), envVars: s.env_vars || [], bearerEnv: s.bearer_token_env_var || "",
      enabled: s.enabled !== false, startupTimeout: s.startup_timeout_sec || 10, toolTimeout: s.tool_timeout_sec || 60,
      privateConfig: Boolean(s.env || s.http_headers),
    })) };
  }
  async save(input) {
    const name = validName(input.name);
    ensure(["create", "edit"].includes(input.mode), "请明确新增还是编辑");
    ensure(["stdio", "http"].includes(input.transport), "请选择 stdio 或 HTTP");
    return this.config.update(input.revision, `mcp:${input.mode}:${name}`, (text, data) => {
      const previous = data.mcp_servers?.[name];
      ensure(input.mode === "create" ? !previous : Boolean(previous), input.mode === "create" ? "同名 MCP 已存在，请编辑原条目" : "MCP 不存在，请刷新", "MCP_CONFLICT", 409);
      const next = { ...(previous || {}) };
      const changingTransport = previous && Boolean(previous.url) !== (input.transport === "http");
      ensure(!changingTransport || (!previous.env && !previous.http_headers), "该条目含私有配置，不能直接转换传输类型；请另建条目", "PRIVATE_CONFIG_PRESENT", 409);
      if (input.transport === "stdio") {
        ensure(typeof input.command === "string" && input.command.trim() && input.command.length <= 1024 && !/[\0\r\n]/.test(input.command), "请填写可执行程序名称或路径");
        next.command = input.command.trim();
        if (input.args !== undefined) {
          const args = strings(input.args, "参数");
          ensure(JSON.stringify(safeArgs(args)) === JSON.stringify(args) && !JSON.stringify(args).includes("[已脱敏]"), "参数中不能保存明文密钥，请通过环境变量提供");
          next.args = args;
        }
        next.env_vars = envNames(input.envVars || []);
        delete next.url; delete next.bearer_token_env_var; delete next.http_headers; delete next.env_http_headers;
      } else {
        let url; try { url = new URL(input.url); } catch { ensure(false, "MCP 地址格式不正确"); }
        ensure(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)), "HTTP MCP 仅允许 HTTPS 或本机回环地址");
        ensure(!url.username && !url.password && !url.hash && !url.search, "请不要把密钥放入 MCP 地址；使用授权环境变量（此版不接受查询参数）");
        next.url = url.href;
        if (input.bearerEnv) next.bearer_token_env_var = envNames([input.bearerEnv])[0]; else delete next.bearer_token_env_var;
        delete next.command; delete next.args; delete next.env_vars; delete next.env; delete next.cwd;
      }
      for (const [field, key, fallback, max] of [["startupTimeout", "startup_timeout_sec", 10, 120], ["toolTimeout", "tool_timeout_sec", 60, 3600]]) {
        const n = input[field] ?? previous?.[key] ?? fallback;
        ensure(Number.isInteger(n) && n >= 1 && n <= max, `超时时间须为 1–${max} 秒的整数`); next[key] = n;
      }
      // Adding a server never executes it; default disabled until explicitly enabled.
      next.enabled = previous ? previous.enabled !== false : false;
      return replaceTable(text, ["mcp_servers", name], next);
    });
  }
  async toggle({ name, enabled, revision }) {
    validName(name); ensure(typeof enabled === "boolean", "启停状态不合法");
    return this.config.update(revision, `mcp:${enabled ? "enable" : "disable"}:${name}`, (text, data) => {
      ensure(data.mcp_servers?.[name], "MCP 不存在", "NOT_FOUND", 404);
      return replaceTable(text, ["mcp_servers", name], { ...data.mcp_servers[name], enabled });
    });
  }
  async remove({ name, revision }) {
    validName(name);
    return this.config.update(revision, `mcp:remove:${name}`, (text, data) => {
      ensure(data.mcp_servers?.[name], "MCP 不存在", "NOT_FOUND", 404);
      return replaceTable(text, ["mcp_servers", name], null);
    });
  }
  async check(name, environment = process.env) {
    validName(name); const { data } = await this.config.read(); const entry = data.mcp_servers?.[name];
    ensure(entry, "MCP 不存在", "NOT_FOUND", 404);
    const names = [...(entry.env_vars || []), ...(entry.bearer_token_env_var ? [entry.bearer_token_env_var] : [])];
    const missing = names.filter(n => !environment[n] && !entry.env?.[n]);
    let executableFound = null;
    if (entry.command && isAbsolute(entry.command)) executableFound = await access(resolve(entry.command)).then(() => true, () => false);
    const valid = !missing.length && executableFound !== false && Boolean(entry.command || entry.url);
    return { ok: true, valid, missingEnvironment: names.filter(n => missing.includes(n)), executableFound,
      message: valid ? "配置检查通过；尚未启动服务或测试工具调用，请在 Codex 新会话中验收" : "配置检查未通过，请检查程序路径和环境变量", connectionTested: false };
  }
}
