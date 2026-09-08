import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthJson, maskApiKey, merge777Config, mergeMcpServer } from "../js/config-core.mjs";

const remoteSample = `model_provider = "xiaoji"

notify = ["D:\\\\Codex\\\\app\\\\resources\\\\notify.exe", "turn-ended"]

[marketplaces.openai-bundled]
source_type = "local"
source = "C:/openai-bundled"

[marketplaces.xiaoji-codex-plugin]
source_type = "local"
source = "C:/ProgramData/XiaojiCodex/plugin"

[desktop]
conversationDetailMode = "STEPS_COMMANDS"

[model_providers.xiaoji]
name = "xiaoji"
base_url = "https://xiaoji.baziapi.site/v1"
experimental_bearer_token = "secret-value"
`;

test("migrates xiaoji provider while preserving unrelated config", () => {
  const result = merge777Config(remoteSample);
  assert.match(result, /model = "gpt-5\.5"/);
  assert.match(result, /model_provider = "777codes"/);
  assert.match(result, /\[model_providers\.777codes]/);
  assert.match(result, /\[marketplaces\.openai-bundled]/);
  assert.match(result, /\[desktop]/);
  assert.match(result, /notify =/);
  assert.doesNotMatch(result, /model_providers\.xiaoji/);
  assert.doesNotMatch(result, /xiaoji-codex-plugin/);
  assert.doesNotMatch(result, /secret-value/);
});

test("replaces an existing 777 provider without duplicating managed keys", () => {
  const first = merge777Config(remoteSample);
  const second = merge777Config(first, { model: "gpt-5.6-sol", reasoningEffort: "medium" });
  assert.equal((second.match(/^model =/gm) || []).length, 1);
  assert.equal((second.match(/^model_provider =/gm) || []).length, 1);
  assert.equal((second.match(/^\[model_providers\.777codes]/gm) || []).length, 1);
  assert.match(second, /model = "gpt-5\.6-sol"/);
  assert.match(second, /model_reasoning_effort = "medium"/);
});

test("auth writer preserves existing official token data", () => {
  const parsed = JSON.parse(buildAuthJson({ tokens: { access_token: "official" } }, "sk-777-demo"));
  assert.equal(parsed.OPENAI_API_KEY, "sk-777-demo");
  assert.equal(parsed.tokens.access_token, "official");
});

test("API key masking never exposes the middle of the key", () => {
  assert.equal(maskApiKey("sk-1234567890abcdef"), "sk-123••••••••cdef");
  assert.equal(maskApiKey(""), "尚未输入");
});

test("MCP merge replaces only the selected server and preserves other tables", () => {
  const source = '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.777codes-image]\ncommand = "old"\n\n[desktop]\nmode = "safe"\n';
  const result = mergeMcpServer(source, { name: "777codes-image", command: "D:\\Tool\\image.cmd" });
  assert.match(result, /\[mcp_servers\.other]/);
  assert.match(result, /\[desktop]/);
  assert.match(result, /D:\\\\Tool\\\\image\.cmd/);
  assert.equal((result.match(/\[mcp_servers\.777codes-image]/g) || []).length, 1);
  assert.doesNotMatch(result, /command = "old"/);
});
