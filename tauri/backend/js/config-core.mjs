const MANAGED_ROOT_KEYS = new Set([
  "model",
  "model_provider",
  "forced_login_method",
  "profile",
  "model_reasoning_effort",
  "disable_response_storage",
]);

const DEFAULT_OPTIONS = Object.freeze({
  model: "gpt-5.5",
  reasoningEffort: "high",
  disableResponseStorage: true,
  removeXiaojiMarketplace: true,
});

function tableName(line) {
  return line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/)?.[1]?.trim() || null;
}

function rootAssignmentKey(line) {
  return line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1] || null;
}

function shouldDropTable(name, removeXiaojiMarketplace) {
  if (name === "model_providers.xiaoji" || name === "model_providers.777codes") return true;
  return removeXiaojiMarketplace && name === "marketplaces.xiaoji-codex-plugin";
}

export function merge777Config(existingText = "", options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const sourceLines = String(existingText).replace(/\r\n/g, "\n").split("\n");
  const keptLines = [];
  let currentTable = null;
  let droppingTable = false;

  for (const line of sourceLines) {
    const nextTable = tableName(line);
    if (nextTable) {
      currentTable = nextTable;
      droppingTable = shouldDropTable(nextTable, settings.removeXiaojiMarketplace);
      if (!droppingTable) keptLines.push(line);
      continue;
    }
    if (droppingTable) continue;

    const key = currentTable === null ? rootAssignmentKey(line) : null;
    if (key && MANAGED_ROOT_KEYS.has(key)) continue;
    keptLines.push(line);
  }

  const preserved = keptLines.join("\n").trim();
  const rootBlock = [
    `model = ${JSON.stringify(settings.model)}`,
    'model_provider = "777codes"',
    `model_reasoning_effort = ${JSON.stringify(settings.reasoningEffort)}`,
    `disable_response_storage = ${settings.disableResponseStorage ? "true" : "false"}`,
  ].join("\n");
  const providerBlock = [
    "[model_providers.777codes]",
    'name = "777codes"',
    'base_url = "https://www.777codes.codes"',
    'wire_api = "responses"',
    "requires_openai_auth = true",
  ].join("\n");

  return [rootBlock, preserved, providerBlock].filter(Boolean).join("\n\n") + "\n";
}

export function buildAuthJson(existingAuth = {}, apiKey = "") {
  const normalized = existingAuth && typeof existingAuth === "object" && !Array.isArray(existingAuth)
    ? { ...existingAuth }
    : {};
  normalized.OPENAI_API_KEY = String(apiKey).trim();
  return JSON.stringify(normalized, null, 2) + "\n";
}

export function maskApiKey(apiKey = "") {
  const value = String(apiKey).trim();
  if (!value) return "尚未输入";
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 6)}••••••••${value.slice(-4)}`;
}

export function previewAuthJson(existingAuth = {}, apiKey = "") {
  const masked = maskApiKey(apiKey);
  return buildAuthJson(existingAuth, masked === "尚未输入" ? "[等待输入777codes Key]" : masked);
}

export function mergeMcpServer(existingText = "", { name, command, startupTimeout = 20, toolTimeout = 600 }) {
  const normalizedName = String(name || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedName)) throw new Error("MCP 名称不合法");
  const sourceLines = String(existingText).replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  let dropping = false;
  const tablePrefix = `mcp_servers.${normalizedName}`;
  for (const line of sourceLines) {
    const table = tableName(line);
    if (table) dropping = table === tablePrefix || table.startsWith(`${tablePrefix}.`);
    if (!dropping) kept.push(line);
  }
  const block = [
    `[mcp_servers.${normalizedName}]`,
    `command = ${JSON.stringify(String(command))}`,
    `startup_timeout_sec = ${Number(startupTimeout)}`,
    `tool_timeout_sec = ${Number(toolTimeout)}`,
  ].join("\n");
  return [kept.join("\n").trim(), block].filter(Boolean).join("\n\n") + "\n";
}
