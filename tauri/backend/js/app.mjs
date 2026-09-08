import { maskApiKey, merge777Config, previewAuthJson } from "./config-core.mjs";

const fallbackConfig = `model_provider = "xiaoji"

[model_providers.xiaoji]
name = "xiaoji"
base_url = "https://xiaoji.baziapi.site/v1"
wire_api = "responses"
supports_websockets = true
experimental_bearer_token = "[旧 Key 已脱敏]"
`;

const state = {
  activeCode: "toml",
  configToml: merge777Config(fallbackConfig),
  authJson: previewAuthJson({}, ""),
  verified: false,
  localState: null,
  backups: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
  if (!response.ok) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function currentOptions() {
  return {
    model: $("#model").value,
    reasoningEffort: $("#effort").value,
    disableResponseStorage: $("#disableStorage").checked,
  };
}

function updateCodePanel() {
  state.authJson = previewAuthJson({}, $("#apiKey").value);
  $("#configPreview").textContent = state.activeCode === "toml" ? state.configToml : state.authJson;
  $("#maskedKey").textContent = maskApiKey($("#apiKey").value);
  $("#modelState").textContent = $("#model").value;
}

async function refreshConfigPreview() {
  try {
    const result = await apiJson("/api/config-preview", {
      method: "POST",
      body: JSON.stringify(currentOptions()),
    });
    state.configToml = result.configToml;
    $("#previewSource").textContent = result.sourceModifiedAt
      ? `读取 ${result.source}（${new Date(result.sourceModifiedAt).toLocaleString()}），仅生成脱敏预览，未写入。`
      : "未发现现有配置，将按新配置生成预览；未写入。";
  } catch (error) {
    state.configToml = merge777Config(fallbackConfig, currentOptions());
    $("#previewSource").textContent = `读取实际配置失败：${error.message}。当前显示安全示例。`;
  }
  updateCodePanel();
}

async function openPreview() {
  $("#configPreview").textContent = "正在读取实际配置并生成脱敏预览…";
  $("#previewModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("#closePreview").focus();
  await refreshConfigPreview();
}

function closePreview() {
  $("#previewModal").hidden = true;
  document.body.style.overflow = "";
}

function updateModels(models) {
  if (!Array.isArray(models) || !models.length) return;
  const select = $("#model");
  const previous = select.value;
  select.replaceChildren(...models.map((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    return option;
  }));
  select.value = models.includes(previous) ? previous : models.includes("gpt-5.5") ? "gpt-5.5" : models[0];
  updateCodePanel();
}

function setVerified(result) {
  state.verified = true;
  $("#applyConfig").disabled = false;
  $("#writeStatus").textContent = "Key 已验证。点击安全写入后会再次联网验证，并先创建完整备份。";
  $("#serviceState").textContent = "Key 已验证";
  $("#connectionBadge").classList.add("online");
  $("#connectionBadge").innerHTML = "<i></i>真实验证通过";
  updateModels(result.models);

  const remaining = result.usage?.remaining;
  if (remaining !== null && remaining !== undefined) {
    $("#balanceState").textContent = `${remaining} ${result.usage.currency || "USD"}`;
    $("#balanceCaption").textContent = "来自 /v1/usage 的实时结果";
  } else if (result.checks?.usage?.ok) {
    $("#balanceState").textContent = "接口已通过";
    $("#balanceCaption").textContent = "余额返回结构中没有可显示字段";
  } else {
    $("#balanceState").textContent = "读取失败";
    $("#balanceCaption").textContent = result.checks?.usage?.message || "Key 已验证，但余额接口失败";
  }
}

function setVerifyFailure(error) {
  state.verified = false;
  $("#applyConfig").disabled = true;
  $("#writeStatus").textContent = "Key 验证失败，禁止写入。";
  $("#serviceState").textContent = "验证失败";
  $("#connectionBadge").classList.remove("online");
  $("#connectionBadge").innerHTML = "<i></i>Key 无效或无权限";
  $("#keyError").textContent = error.message;
}

async function verifyCurrentKey({ openConfig = false } = {}) {
  const apiKey = $("#apiKey").value.trim();
  if (apiKey.length < 8) {
    $("#keyError").textContent = "请输入有效的 777codes API Key。";
    $("#apiKey").focus();
    return null;
  }

  const button = $("#verifyKey");
  button.disabled = true;
  button.classList.add("loading");
  $("#keyError").textContent = "";
  try {
    const result = await apiJson("/api/verify", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
    setVerified(result);
    await refreshConfigPreview();
    if (openConfig) await openPreview();
    return result;
  } catch (error) {
    setVerifyFailure(error);
    showToast(`验证失败：${error.message}`);
    return null;
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

async function refreshRuntimeStatus() {
  const [service, local] = await Promise.allSettled([
    apiJson("/api/status"),
    apiJson("/api/local-state"),
  ]);

  if (service.status === "fulfilled") {
    $("#serviceState").textContent = service.value.reachable ? "服务可达" : "服务不可达";
    $("#serviceCaption").textContent = service.value.reachable
      ? `未带 Key 探测返回 HTTP ${service.value.httpStatus}，接口在线`
      : service.value.message;
  } else {
    $("#serviceState").textContent = "探测失败";
    $("#serviceCaption").textContent = service.reason.message;
  }

  if (local.status === "fulfilled") {
    state.localState = local.value;
    $("#localProviderState").textContent = local.value.provider || "未配置";
    $("#localConfigCaption").textContent = local.value.exists
      ? `${local.value.path} · 只读检查`
      : `未找到 ${local.value.path}`;
    $("#codexConfigState").textContent = local.value.exists ? "已读取" : "未发现";
    $("#codexConfigState").classList.toggle("muted", !local.value.exists);
  }
}

async function refreshBackups() {
  try {
    const result = await apiJson("/api/backups");
    state.backups = result.backups || [];
    const select = $("#backupSelect");
    if (!state.backups.length) {
      select.replaceChildren(new Option("暂无可用备份", ""));
      $("#backupBadge").classList.remove("online");
      $("#backupBadge").innerHTML = "<i></i>暂无备份";
      $("#rollbackBackup").disabled = true;
      return;
    }
    select.replaceChildren(...state.backups.map((backup) => {
      const option = new Option(`${new Date(backup.createdAt).toLocaleString()} · ${backup.reason}`, backup.backupId);
      return option;
    }));
    $("#backupBadge").classList.add("online");
    $("#backupBadge").innerHTML = `<i></i>${state.backups.length} 个备份`;
    $("#rollbackBackup").disabled = false;
  } catch (error) {
    $("#backupBadge").classList.remove("online");
    $("#backupBadge").innerHTML = "<i></i>读取失败";
    $("#backupHelp").textContent = error.message;
  }
}

$$('.nav-item').forEach((button) => {
  button.addEventListener("click", () => {
    $$('.nav-item').forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

$("#apiKey").addEventListener("input", () => {
  $("#keyError").textContent = "";
  state.verified = false;
  $("#applyConfig").disabled = true;
  $("#writeStatus").textContent = "Key 内容已变化，请重新完成真实验证。";
  updateCodePanel();
});
$("#model").addEventListener("change", refreshConfigPreview);
$("#effort").addEventListener("change", refreshConfigPreview);
$("#disableStorage").addEventListener("change", refreshConfigPreview);

$("#toggleKey").addEventListener("click", () => {
  const input = $("#apiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggleKey").setAttribute("aria-label", input.type === "password" ? "显示 API Key" : "隐藏 API Key");
});

$("#providerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await verifyCurrentKey({ openConfig: true });
});

$("#syncModels").addEventListener("click", async () => {
  const button = $("#syncModels");
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "正在读取 /v1/models…";
  const result = await verifyCurrentKey();
  button.disabled = false;
  button.textContent = previous;
  if (result) showToast(`已同步 ${result.models.length} 个真实模型。`);
});

$("#openPreviewTop").addEventListener("click", openPreview);
$("#closePreview").addEventListener("click", closePreview);
$("#previewModal").addEventListener("click", (event) => {
  if (event.target === $("#previewModal")) closePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#previewModal").hidden) closePreview();
});

$$('.code-tab').forEach((button) => {
  button.addEventListener("click", () => {
    $$('.code-tab').forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    state.activeCode = button.dataset.code;
    updateCodePanel();
  });
});

$("#copyPreview").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#configPreview").textContent);
    showToast("已复制脱敏预览。");
  } catch {
    showToast("浏览器未授予剪贴板权限，可手动选择代码复制。");
  }
});
$("#applyConfig").addEventListener("click", async () => {
  if (!state.verified) {
    showToast("请先重新验证当前 Key。");
    return;
  }
  const confirmed = window.confirm("即将备份并更新当前用户的 config.toml 与 auth.json。失败会自动恢复。是否继续？");
  if (!confirmed) return;

  const button = $("#applyConfig");
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "正在备份并写入…";
  $("#writeStatus").textContent = "正在重新验证 Key、创建备份并执行写后校验，请勿关闭窗口。";
  try {
    const result = await apiJson("/api/apply-config", {
      method: "POST",
      body: JSON.stringify({ apiKey: $("#apiKey").value.trim(), ...currentOptions() }),
    });
    $("#writeStatus").textContent = `写入成功，回滚编号：${result.backupId}`;
    $("#apiKey").value = "";
    state.verified = false;
    updateCodePanel();
    await Promise.all([refreshRuntimeStatus(), refreshBackups(), refreshConfigPreview()]);
    showToast("777codes 配置已写入并验证；Key 输入框已清空。");
  } catch (error) {
    $("#writeStatus").textContent = `写入失败：${error.message}。若写入曾开始，服务已尝试自动恢复。`;
    showToast(`写入失败：${error.message}`);
  } finally {
    button.textContent = previous;
    button.disabled = !state.verified;
  }
});
$("#refreshBackups").addEventListener("click", refreshBackups);
$("#backupSelect").addEventListener("change", () => {
  $("#rollbackBackup").disabled = !$("#backupSelect").value;
});
$("#rollbackBackup").addEventListener("click", async () => {
  const backupId = $("#backupSelect").value;
  if (!backupId) return;
  const confirmed = window.confirm(`将 config.toml 与 auth.json 恢复到备份 ${backupId}。回滚前会再次备份当前状态。是否继续？`);
  if (!confirmed) return;
  const button = $("#rollbackBackup");
  button.disabled = true;
  try {
    const result = await apiJson("/api/rollback", {
      method: "POST",
      body: JSON.stringify({ backupId, confirm: "RESTORE_BACKUP" }),
    });
    await Promise.all([refreshRuntimeStatus(), refreshBackups(), refreshConfigPreview()]);
    showToast(result.message || "配置已恢复。");
  } catch (error) {
    showToast(`回滚失败：${error.message}`);
  } finally {
    button.disabled = !$("#backupSelect").value;
  }
});
$("#mockRefresh").addEventListener("click", async () => {
  await refreshRuntimeStatus();
  showToast("真实运行状态已刷新。");
});
$$('.demo-action').forEach((button) => button.addEventListener("click", () => {
  showToast("该增强模块尚未接入 0.4；当前客户端不会调用旧版程序。");
}));

updateCodePanel();
await Promise.all([refreshRuntimeStatus(), refreshConfigPreview(), refreshBackups()]);
