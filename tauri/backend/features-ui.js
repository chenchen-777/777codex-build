(() => {
  const { api, showToast, runButton, escapeHtml: h, refreshProviders } = window.manager777;
  const $ = s => document.querySelector(s);
  const post = (url, body) => api(url, { method: "POST", body: JSON.stringify(body) });
  let tab = "mcp"; let mcp = { servers: [], revision: "" }; let skillRows = []; let plugins = { plugins: [] }; let generation = 0;
  const dialog = $("#feature-dialog"); let dirty = false;
  const confirmation = $("#confirmation-dialog"); let confirmResolve = null;
  function ask(message) {
    if (confirmResolve) return Promise.resolve(false);
    $("#confirmation-message").textContent = message;
    confirmation.showModal(); $("#confirmation-cancel").focus();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function finishConfirmation(accepted) { confirmation.close(); const done = confirmResolve; confirmResolve = null; done?.(accepted); }
  $("#confirmation-cancel").addEventListener("click", () => finishConfirmation(false));
  $("#confirmation-accept").addEventListener("click", () => finishConfirmation(true));
  confirmation.addEventListener("cancel", e => { e.preventDefault(); finishConfirmation(false); });
  window.manager777.confirm = ask;
  const button = (action, label, extra = "") => `<button type="button" class="button ghost" data-action="${action}" ${extra}>${label}</button>`;
  const status = enabled => `<span class="status-pill ${enabled ? "success" : ""}">${enabled ? "已启用" : "已停用"}</span>`;
  const notice = "配置已保存。请重启 Codex，在新会话中验证扩展是否可用。";
  const textField = (name, label, value = "", placeholder = "") => `<label class="field"><span>${label}</span><input name="${name}" value="${h(value)}" placeholder="${h(placeholder)}"></label>`;
  async function closeDialog() { if (dirty && !await ask("有尚未保存的内容，确认放弃？")) return; dialog.close(); }
  dialog.addEventListener("cancel", e => { e.preventDefault(); closeDialog(); });
  function openDialog(title, content, onSave, saveLabel = "保存") {
    dirty = false;
    dialog.innerHTML = `<form><div class="modal-header"><h2 id="feature-dialog-title">${h(title)}</h2><button type="button" class="icon-button" data-cancel aria-label="关闭对话框">×</button></div><div class="modal-body">${content}<p id="feature-error" class="inline-error" role="alert"></p></div><div class="modal-footer"><button type="button" class="button ghost" data-cancel>取消</button>${onSave ? `<button type="submit" class="button primary">${h(saveLabel)}</button>` : ""}</div></form>`;
    dialog.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", closeDialog));
    dialog.querySelector("form").addEventListener("input", () => { dirty = true; });
    dialog.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault(); if (!onSave) return;
      const b = dialog.querySelector('[type="submit"]'); b.disabled = true; $("#feature-error").textContent = "";
      try { await onSave(new FormData(e.currentTarget)); dirty = false; dialog.close(); await refresh(); await refreshLogs(); }
      catch (error) { $("#feature-error").textContent = error.message; }
      finally { b.disabled = false; }
    });
    if (!dialog.open) dialog.showModal();
  }
  function loading(host) { host.innerHTML = '<div class="empty-inline" role="status">正在读取实际数据…</div>'; }
  function failure(host, error) { host.innerHTML = `<div class="empty-inline inline-error" role="alert">${h(error.message)}<br>可点击“刷新状态”重试。</div>`; }
  function parseArray(text, label) { try { const value = JSON.parse(text || "[]"); if (Array.isArray(value) && value.every(v => typeof v === "string")) return value; } catch {} throw new Error(`${label}请填写 JSON 字符串数组，例如 ["--flag", "value"]`); }

  function editMcp(entry) {
    const mode = entry ? "edit" : "create";
    openDialog(entry ? `编辑 MCP · ${entry.name}` : "添加 MCP", `
      <div class="form-grid">${textField("name", "服务名称", entry?.name || "", "my-mcp")}
      <label class="field"><span>类型</span><select name="transport"><option value="stdio" ${entry?.transport !== "http" ? "selected" : ""}>本机 stdio</option><option value="http" ${entry?.transport === "http" ? "selected" : ""}>HTTP MCP</option></select></label></div>
      <div data-stdio-fields>${textField("command", "可执行程序（不是整段 shell 命令）", entry?.command || "", "node 或完整 exe 路径")}
      <label class="field"><span>参数（JSON 数组；编辑时留空保留原参数）</span><textarea name="args" rows="3" placeholder='["C:/tools/server.mjs"]'>${entry ? "" : "[]"}</textarea></label>
      <p class="field-hint">${entry ? `现有参数：${h(JSON.stringify(entry.args))}` : "参数中不要填写 Key；密钥通过环境变量提供。"}</p>
      ${textField("envVars", "传递的环境变量名（逗号分隔，不填写值）", (entry?.envVars || []).join(", "))}</div>
      <div data-http-fields>${textField("url", "MCP 地址", entry?.url || "", "https://example.com/mcp")}${textField("bearerEnv", "授权环境变量名称（可选）", entry?.bearerEnv || "", "MY_MCP_TOKEN")}</div>
      <div class="form-grid">${textField("startupTimeout", "启动超时／秒", entry?.startupTimeout || 10)}${textField("toolTimeout", "工具超时／秒", entry?.toolTimeout || 60)}</div>
      <div class="modal-note">新增后默认停用，不下载或执行程序。现有条目的私有环境配置和其他高级字段会保留。保存前创建配置快照。</div>`, async form => {
      const payload = Object.fromEntries(form); payload.mode = mode; payload.revision = mcp.revision;
      payload.args = payload.args.trim() ? parseArray(payload.args, "参数") : undefined;
      payload.envVars = payload.envVars.split(",").map(x => x.trim()).filter(Boolean);
      payload.startupTimeout = Number(payload.startupTimeout); payload.toolTimeout = Number(payload.toolTimeout);
      if (!await ask("确认保存此 MCP 配置？现有配置将先备份；不会在此刻启动服务。")) throw new Error("已取消保存");
      await post("/api/extensions/mcp/save", { ...payload, confirm: "SAVE_MCP" }); showToast(notice);
    });
    if (entry) dialog.querySelector('[name="name"]').readOnly = true;
    const transport = dialog.querySelector('[name="transport"]');
    const sync = () => { dialog.querySelector("[data-stdio-fields]").hidden = transport.value !== "stdio"; dialog.querySelector("[data-http-fields]").hidden = transport.value !== "http"; };
    transport.addEventListener("change", sync); sync();
  }
  async function refreshMcp() {
    const host = $("#mcp-live"); loading(host);
    try {
      mcp = await api("/api/extensions/mcp"); $("#mcp-total").textContent = mcp.servers.length;
      $("#image-mcp-entry").hidden = mcp.servers.some(s => s.name === "777codes-image");
      host.innerHTML = mcp.servers.length ? mcp.servers.map((s, i) => `<article class="managed-row" data-index="${i}"><div class="feature-icon mint">M</div><div class="managed-detail"><strong>${h(s.name)}</strong><p>${h(s.transport)} · ${h(s.url || s.command)}</p><small>${s.privateConfig ? "保留已有私有配置 · " : ""}${s.name === "777codes-image" ? "配套 Skill 在 Skill 页统一管理 · " : ""}启用状态来自 config.toml，尚不代表连接成功</small></div>${status(s.enabled)}<div class="managed-actions">${button("edit", "编辑")}${button("toggle", s.enabled ? "停用" : "启用")}${button("check", "检查配置")}${button("remove", "移除配置")}</div></article>`).join("") : '<div class="empty-inline">尚无 MCP 配置，点击“添加 MCP”创建。</div>';
      host.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => {
        const s = mcp.servers[Number(b.closest("[data-index]").dataset.index)];
        if (b.dataset.action === "edit") return editMcp(s);
        return runButton(b, "处理中…", async () => {
          if (b.dataset.action === "check") { const result = await post("/api/extensions/mcp/check", { name: s.name }); showToast(`${result.message}${result.missingEnvironment.length ? `；缺少 ${result.missingEnvironment.join(", ")}` : ""}`, !result.valid); return; }
          const remove = b.dataset.action === "remove";
          if (!await ask(remove ? `移除 ${s.name} 的配置？会先备份，不删除组件文件或配套 Skill。` : `${s.enabled ? "停用" : "启用"} ${s.name}？启用后 Codex 可以按配置启动程序或访问服务，请确认来源可信。`)) return;
          await post(`/api/extensions/mcp/${remove ? "remove" : "toggle"}`, { name: s.name, revision: mcp.revision, enabled: !s.enabled, confirm: remove ? "REMOVE_MCP" : "TOGGLE_MCP" });
          showToast(notice); await refreshMcp(); await refreshLogs();
        });
      }));
    } catch (e) { failure(host, e); $("#mcp-total").textContent = "—"; }
  }
  async function editSkill(entry) {
    let current = { text: "---\nname: my-skill\ndescription: 描述这个 Skill 在什么任务中使用。\n---\n\n在这里填写具体使用步骤。\n" };
    if (entry) current = await api(`/api/extensions/skills/read?scope=${encodeURIComponent(entry.scope)}&folder=${encodeURIComponent(entry.folder)}`);
    openDialog(entry ? `编辑 Skill · ${entry.name}` : "新建 Skill", `<div class="modal-note">${entry ? h(entry.path) : "创建在用户级 .agents/skills 目录；不会执行其中的脚本。"}</div><label class="field"><span>SKILL.md</span><textarea name="text" class="code-editor" rows="14">${h(current.text)}</textarea></label>`, async form => {
      if (!await ask("确认保存 Skill？编辑现有文件前会创建恢复副本。")) throw new Error("已取消保存");
      await post("/api/extensions/skills/save", { mode: entry ? "edit" : "create", scope: entry?.scope || "user", folder: entry?.folder, text: form.get("text"), revision: current.revision, confirm: "SAVE_SKILL" });
      showToast("Skill 已保存，请在 Codex 中验证触发效果");
    });
  }
  function importSkill() {
    openDialog("导入 Skill", `${textField("source", "包含 SKILL.md 的目录", "", "D:/skills/my-skill")}<div class="header-actions">${button("choose", "选择文件夹")}${button("create", "改为新建 Skill")}</div><div class="modal-note">完整复制该 Skill 及附属文件。请确认内容可信；不会自动执行脚本，不覆盖同名目录，不跟随符号链接。</div>`, async form => {
      if (!await ask("确认导入此目录？导入后 Codex 可在相关任务中读取并使用它。")) throw new Error("已取消导入");
      await post("/api/extensions/skills/import", { source: form.get("source"), scope: "user", confirm: "IMPORT_SKILL" }); showToast("Skill 已导入");
    }, "确认导入");
    dialog.querySelector('[data-action="choose"]').addEventListener("click", e => runButton(e.currentTarget, "选择中…", async () => { const result = await post("/api/extensions/skills/choose", {}); if (result.source) { dialog.querySelector('[name="source"]').value = result.source; dirty = true; } }));
    dialog.querySelector('[data-action="create"]').addEventListener("click", () => editSkill());
  }
  async function refreshSkills() {
    const host = $("#skill-live"); loading(host);
    try {
      const result = await api("/api/extensions/skills"); skillRows = result.skills; $("#skill-total").textContent = skillRows.length;
      host.innerHTML = result.warnings.map(w => `<p class="inline-error">${h(w)}</p>`).join("") + (skillRows.length ? skillRows.map((s, i) => `<article class="managed-row" data-index="${i}"><div class="feature-icon amber">S</div><div class="managed-detail"><strong>${h(s.name)}</strong><p>${h(s.description)}</p><small>${h(s.scopeLabel || s.scope)} · ${h(s.path || "受保护链接")}</small></div><span class="status-pill">${s.protected ? "只读" : s.invalid ? "格式待修复" : "已发现"}</span><div class="managed-actions">${button("edit", "查看／编辑", s.protected ? "disabled" : "")}${button("remove", "移除", s.protected ? "disabled" : "")}</div></article>`).join("") : '<div class="empty-inline">尚无用户级 Skill，可导入或新建。</div>');
      host.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => runButton(b, "处理中…", async () => {
        const s = skillRows[Number(b.closest("[data-index]").dataset.index)];
        if (b.dataset.action === "edit") return editSkill(s);
        if (!await ask(`将 ${s.name} 移到恢复区？不会永久删除，可在“恢复记录”中找回。`)) return;
        await post("/api/extensions/skills/remove", { scope: s.scope, folder: s.folder, revision: s.revision, confirm: "REMOVE_SKILL" }); showToast("已移到恢复区，可以恢复"); await refreshSkills(); await refreshLogs();
      })));
    } catch (e) { failure(host, e); }
  }
  async function refreshPlugins() {
    const host = $("#plugin-live"); loading(host); const requestGeneration = ++generation;
    try {
      const result = await api("/api/extensions/plugins"); if (requestGeneration !== generation) return; plugins = result;
      $("#plugin-total").textContent = plugins.plugins.filter(p => p.installed).length;
      host.innerHTML = plugins.warnings.map(w => `<p class="inline-error">${h(w)}</p>`).join("") + (plugins.plugins.length ? plugins.plugins.map((p, i) => `<article class="managed-row" data-index="${i}"><div class="feature-icon violet">P</div><div class="managed-detail"><strong>${h(p.displayName)}</strong><p>${h(p.description)}</p><small>${h(p.marketplace)} · ${h(p.version)} · ${h(p.sourceType)}</small></div><span class="status-pill">${p.protected ? "受保护" : p.installed ? p.enabled ? "已启用" : "已停用" : "未安装"}</span><div class="managed-actions">${p.installed ? button("toggle", p.enabled ? "停用" : "启用", p.protected ? "disabled" : "") : button("install", "安装", !p.canInstall || p.protected ? "disabled" : "")}</div></article>`).join("") : '<div class="empty-inline">没有可读取的本地插件市场。不会把缓存文件当作已安装插件。</div>');
      host.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => runButton(b, "处理中…", async () => {
        const p = plugins.plugins[Number(b.closest("[data-index]").dataset.index)]; const install = b.dataset.action === "install";
        if (!await ask(install ? `从 ${p.marketplace} 安装 ${p.displayName}？安装可能下载组件，插件可能包含工具与脚本，请确认来源可信。` : `${p.enabled ? "停用" : "启用"} ${p.displayName}？配置将先备份，重启 Codex 后生效。`)) return;
        const result = await post(`/api/extensions/plugins/${install ? "install" : "toggle"}`, { id: p.id, enabled: !p.enabled, revision: plugins.revision, confirm: install ? "INSTALL_PLUGIN" : "TOGGLE_PLUGIN" });
        showToast(result.needsAuth ? "已安装，但仍需在 Codex 中完成服务授权；尚未验证工具可用" : notice); await refreshPlugins(); await refreshLogs();
      })));
    } catch (e) { if (requestGeneration === generation) failure(host, e); }
  }
  async function recovery(mode = null) {
    const skillMode = mode === "skills" || (mode === null && tab === "skills");
    const result = await api(skillMode ? "/api/extensions/skills/recoveries" : "/api/extensions/snapshots");
    const rows = skillMode ? result.recoveries : result.snapshots;
    openDialog(skillMode ? "Skill 恢复记录" : "扩展配置快照", `<p class="modal-note">${skillMode ? "目标目录已存在时不会覆盖；编辑前的副本也保留在这里。" : "恢复整个 config.toml，会影响此快照之后的配置改动；恢复前再备份当前配置。不涉及 auth.json。"}</p><div class="recovery-list">${rows.length ? rows.map((r, i) => `<article><div><strong>${h(r.folder || r.reason)}</strong><p>${h(new Date(r.time).toLocaleString())} · ${h(r.id.slice(0, 8))}</p></div>${button("restore", "恢复", `data-index="${i}"`)}</article>`).join("") : '<div class="empty-inline">没有恢复记录。</div>'}</div>`, null);
    dialog.querySelectorAll('[data-action="restore"]').forEach(b => b.addEventListener("click", () => runButton(b, "恢复中…", async () => {
      const row = rows[Number(b.dataset.index)]; if (!await ask(skillMode ? "确认恢复此 Skill？目标已存在时会停止。" : "确认恢复整个配置快照？当前配置会先备份。")) return;
      await post(skillMode ? "/api/extensions/skills/restore" : "/api/extensions/snapshots/restore", { id: row.id, revision: result.revision, confirm: skillMode ? "RESTORE_SKILL" : "RESTORE_EXTENSION_CONFIG" });
      dirty = false; dialog.close(); showToast("恢复完成，请重启 Codex 后检查"); await refresh(); await refreshLogs();
    })));
  }
  async function configBackups() {
    const result = await api("/api/backups"); const rows = result.backups || [];
    openDialog("Codex 配置快照", `<p class="modal-note">这里是切换供应商和回滚前创建的完整配置快照。恢复会同时还原 config.toml 与当时存在的 auth.json，执行前会再备份当前状态。</p><div class="recovery-list">${rows.length ? rows.map((r, i) => `<article><div><strong>${h(r.reason || "配置变更前")}</strong><p>${h(new Date(r.createdAt).toLocaleString())} · ${h(r.backupId)}</p></div>${button("restore-config", "恢复", `data-index="${i}"`)}</article>`).join("") : '<div class="empty-inline">没有配置快照。</div>'}</div>`, null);
    dialog.querySelectorAll('[data-action="restore-config"]').forEach(b => b.addEventListener("click", () => runButton(b, "恢复中…", async () => {
      const row = rows[Number(b.dataset.index)];
      if (!await ask(`恢复配置快照 ${row.backupId}？当前配置会先自动备份，恢复后需重启 Codex。`)) return;
      await post("/api/rollback", { backupId: row.backupId, confirm: "RESTORE_BACKUP" }); dirty = false; dialog.close();
      showToast("配置快照已恢复，请重启 Codex 后检查"); await window.manager777.refreshLocalState(); await refreshLogs();
    })));
  }
  async function refreshEnhancements() {
    const host = $("#enhancement-capabilities");
    if (window.__TAURI_INTERNALS__ || window.manager777Mac) return refreshCodexpp(host);
    try {
      const result = await api("/api/enhancements"); const zh = result.codexZh;
      $("#home-codex-zh-detail").textContent = zh.installed ? zh.compatible ? "已安装 · 点击管理或启动" : "官方已更新 · 需要重建" : "检测、安装、启动与恢复";
      const repair = result.pluginRepair;
      host.innerHTML = `<article class="panel enhancement-card operational"><div class="feature-icon violet">修</div><div><strong>插件修复</strong><p>恢复 Codex++ 使用的本地插件市场入口；执行前备份现有插件目录。</p></div><span class="status-pill ${repair.installed ? "success" : repair.componentValid ? "warning" : ""}">${repair.installed ? "已就绪" : repair.componentValid ? "可修复" : "组件异常"}</span><div class="enhancement-actions">${button("repair-plugins", repair.installed ? "重新修复" : "修复插件入口", repair.componentValid ? "" : "disabled")}${button("plugin-recoveries", "恢复记录")}</div><small class="origin">需先关闭 Codex；完成后重新启动客户端检查 Plugins</small></article>` + result.capabilities.filter(item => item.id !== "codex-zh").map(item => `<article class="panel enhancement-card planned"><div class="feature-icon ${item.id === "drawing-stats" || item.id === "drawing-enhancement" ? "coral" : item.id === "conversation-tools" ? "amber" : "violet"}">${h(item.name.slice(0, 1))}</div><div><strong>${h(item.name)}</strong><p>${h(item.description)}</p></div><span class="status-pill warning">待接入</span><small class="origin">Codex++ 功能 · 完成版本适配和回滚测试后开放</small></article>`).join("");
      host.querySelector('[data-action="repair-plugins"]').addEventListener("click", e => runButton(e.currentTarget, "修复中…", async () => {
        if (!await ask("请先关闭 Codex。确认修复插件入口？现有插件目录会先保留为恢复记录，不会执行插件脚本。")) return;
        const repaired = await post("/api/enhancements/plugin-repair/run", { confirm: "REPAIR_PLUGINS" }); showToast(repaired.message); await refreshEnhancements(); await refreshLogs();
      }));
      host.querySelector('[data-action="plugin-recoveries"]').addEventListener("click", e => runButton(e.currentTarget, "读取中…", pluginRepairRecoveries));
      return result;
    } catch (error) { failure(host, error); $("#home-codex-zh-detail").textContent = "汉化状态检测失败"; throw error; }
  }
  async function refreshCodexpp(host) {
    try {
      const r=await api('/api/enhancements/codexpp');
      host.innerHTML=`<article class="panel codexpp-panel"><div class="title-line"><strong>Codex++</strong><span class="status-pill">${h(r.version)}</span></div><p>${h(r.error||(!r.available?'当前安装包缺少增强核心，请更新管理工具。':r.state.message))}</p><div class="codexpp-settings">${r.features.map(f=>`<label class="codexpp-option"><input type="checkbox" data-codexpp-flag="${h(f.id)}" ${r.settings[f.id]?'checked':''} ${!r.available?'disabled':''}><span>${h(f.name)}</span></label>`).join('')}</div><div class="enhancement-actions">${button('pp-save','保存设置',r.available?'':'disabled')}${button('pp-start','启动 Codex++',r.available?'':'disabled')}</div><small>先关闭 Codex，再从这里增强启动。不会改写当前 Key，也不修改官方安装包。</small></article><article class="panel codexpp-panel"><div class="title-line"><strong>插件修复</strong><span class="status-pill">${r.marketplace?.registered&&!r.marketplace?.needsRepair?'已注册':'待检查／修复'}</span></div><p>修复本地插件市场并重新注册，原目录和配置会保留。</p><div class="enhancement-actions">${button('pp-repair','修复插件',r.available?'':'disabled')}${button('pp-history','恢复记录')}</div><div id="codexpp-history"></div></article>`;
      const bind=(action,label,fn)=>host.querySelector(`[data-action="${action}"]`).addEventListener('click',e=>runButton(e.currentTarget,label,fn));
      const settings=()=>Object.fromEntries([...host.querySelectorAll('[data-codexpp-flag]')].map(e=>[e.dataset.codexppFlag,e.checked]));
      bind('pp-save','保存中…',async()=>{const result=await post('/api/enhancements/codexpp/settings',{settings:settings()});showToast(result.message);});
      bind('pp-start','连接中…',async()=>{if(!await ask('请先保存对话并关闭 Codex。按当前勾选的设置增强启动？'))return;await post('/api/enhancements/codexpp/settings',{settings:settings()});await post('/api/enhancements/codexpp/launch',{confirm:'START_CODEXPP'});await refreshCodexpp(host);});
      bind('pp-repair','修复中…',async()=>{if(!await ask('请先关闭 Codex。修复插件市场并注册？原配置与目录将保留在恢复记录中。'))return;const result=await post('/api/enhancements/codexpp/repair',{confirm:'REPAIR_PLUGINS'});showToast(result.message);await refreshCodexpp(host);});
      bind('pp-history','读取中…',async()=>{const result=await api('/api/enhancements/codexpp/recoveries');$('#codexpp-history').textContent=result.recoveries.length?result.recoveries.map(e=>`${new Date(e.time).toLocaleString()} · ${e.phase==='complete'?'修复完成，原文件已保留':'已回滚'} · ${e.id}`).join('\n'):'暂无记录';});
      return r;
    }catch(e){failure(host,e);}
  }
  async function openCodexZh() {
    const result = await api("/api/enhancements"); const zh = result.codexZh;
    const stateClass = zh.installed && zh.compatible ? "success" : zh.installed ? "warning" : "";
    const stateText = zh.installed ? zh.compatible ? "已安装" : "需要重建" : "未安装";
    const detail = !result.official.installed ? "未检测到官方 Codex，请先到 Codex 页安装" : !zh.componentAvailable ? "当前管理工具安装包缺少中文组件" : !zh.componentValid ? "内置中文组件校验失败，安装已禁用" : zh.installed ? `中文副本 ${zh.installedVersion || "未知版本"} · 官方 ${result.official.version || "未知版本"}${zh.compatible ? " · 版本一致" : " · 官方已更新"}` : `官方 Codex ${result.official.version || "未知版本"} · 可构建中文副本`;
    openDialog("汉化 Codex", `<div class="home-zh-pocket"><div class="feature-icon mint">汉</div><div class="managed-detail"><div class="title-line"><strong>中文界面组件</strong><span class="status-pill ${stateClass}">${stateText}</span></div><p>从当前官方 Codex 构建独立中文副本；官方安装、Key 和会话不会被覆盖。</p><small>${h(detail)}</small></div></div><div class="managed-actions home-zh-actions">${button("install-zh", zh.installed ? "重新构建" : "安装中文版", !result.official.installed || !zh.componentValid ? "disabled" : "")}${button("launch-zh", "启动中文版", !zh.installed || !zh.compatible ? "disabled" : "")}${button("remove-zh", "卸载中文版", !zh.installed ? "disabled" : "")}${button("recoveries-zh", "恢复记录")}</div><div class="modal-note">这是首页快捷功能，不属于 Codex++ 插件页。Codex 更新后重新构建即可。</div>`, null);
    dialog.querySelector('[data-action="install-zh"]').addEventListener("click", e => runButton(e.currentTarget, "构建中…", async () => {
      if (!await ask("确认构建中文界面？会复制当前官方 Codex 到独立组件目录，文件较大，期间请不要关闭管理工具。")) return;
      const installed = await post("/api/enhancements/codex-zh/install", { confirm: "INSTALL_CODEX_ZH" }); showToast(installed.message); await refreshEnhancements(); await refreshLogs(); await openCodexZh();
    }));
    dialog.querySelector('[data-action="launch-zh"]').addEventListener("click", e => runButton(e.currentTarget, "启动中…", async () => { await post("/api/enhancements/codex-zh/launch", {}); showToast("已启动中文界面"); await refreshLogs(); }));
    dialog.querySelector('[data-action="remove-zh"]').addEventListener("click", e => runButton(e.currentTarget, "卸载中…", async () => {
      if (!await ask("卸载中文界面？独立副本会移到恢复区；官方 Codex、Key 和会话均保留。")) return;
      const removed = await post("/api/enhancements/codex-zh/remove", { confirm: "REMOVE_CODEX_ZH" }); showToast(removed.message); await refreshEnhancements(); await refreshLogs(); await openCodexZh();
    }));
    dialog.querySelector('[data-action="recoveries-zh"]').addEventListener("click", e => runButton(e.currentTarget, "读取中…", codexZhRecoveries));
  }
  async function codexZhRecoveries() {
    const result = await api("/api/enhancements/codex-zh/recoveries"); const rows = result.recoveries || [];
    openDialog("中文界面恢复记录", `<p class="modal-note">重装或卸载中文版时保留的独立副本。恢复不会更改官方 Codex，但版本过旧时仍需重新构建。</p><div class="recovery-list">${rows.length ? rows.map((row, index) => `<article><div><strong>Codex ${h(row.version || "未知版本")}</strong><p>${h(new Date(row.time).toLocaleString())}</p></div>${button("restore-zh", "恢复", `data-index="${index}"`)}</article>`).join("") : '<div class="empty-inline">没有中文界面恢复记录。</div>'}</div>`, null);
    dialog.querySelectorAll('[data-action="restore-zh"]').forEach(b => b.addEventListener("click", () => runButton(b, "恢复中…", async () => {
      const row = rows[Number(b.dataset.index)]; if (!await ask("恢复此中文副本？如果版本落后于官方 Codex，恢复后仍需重新构建。")) return;
      await post("/api/enhancements/codex-zh/restore", { id: row.id, confirm: "RESTORE_CODEX_ZH" }); dirty = false; dialog.close(); showToast("中文副本已恢复"); await refreshEnhancements(); await refreshLogs(); await openCodexZh();
    })));
  }
  async function pluginRepairRecoveries() {
    const result = await api("/api/enhancements/plugin-repair/recoveries"); const rows = result.recoveries || [];
    openDialog("插件修复恢复记录", `<p class="modal-note">每次重新修复前保留的原插件目录。恢复前请关闭 Codex；当前目录也会再次备份。</p><div class="recovery-list">${rows.length ? rows.map((row, index) => `<article><div><strong>插件目录备份</strong><p>${h(new Date(row.time).toLocaleString())}</p></div>${button("restore-plugin-repair", "恢复", `data-index="${index}"`)}</article>`).join("") : '<div class="empty-inline">没有插件修复恢复记录。</div>'}</div>`, null);
    dialog.querySelectorAll('[data-action="restore-plugin-repair"]').forEach(b => b.addEventListener("click", () => runButton(b, "恢复中…", async () => {
      const row = rows[Number(b.dataset.index)]; if (!await ask("确认恢复此插件目录？请确保 Codex 已关闭。")) return;
      const restored = await post("/api/enhancements/plugin-repair/restore", { id: row.id, confirm: "RESTORE_PLUGIN_REPAIR" }); dirty = false; dialog.close(); showToast(restored.message); await refreshEnhancements(); await refreshLogs();
    })));
  }
  const actionNames = { "/api/account/login/start": "发起平台登录", "/api/account/login/poll": "确认平台登录", "/api/account/logout": "退出平台账号", "/api/account/referral/open": "打开推广链接", "/api/extensions/mcp/save": "保存 MCP", "/api/extensions/mcp/toggle": "切换 MCP", "/api/extensions/mcp/remove": "移除 MCP 配置", "/api/extensions/mcp/check": "检查 MCP 配置", "/api/extensions/skills/save": "保存 Skill", "/api/extensions/skills/import": "导入 Skill", "/api/extensions/skills/remove": "移除 Skill", "/api/extensions/skills/restore": "恢复 Skill", "/api/extensions/snapshots/restore": "恢复扩展配置", "/api/extensions/plugins/toggle": "切换插件", "/api/extensions/plugins/install": "安装插件", "/api/enhancements/plugin-repair/run": "修复插件入口", "/api/enhancements/plugin-repair/restore": "恢复插件目录", "/api/enhancements/codex-zh/install": "构建中文界面", "/api/enhancements/codex-zh/launch": "启动中文界面", "/api/enhancements/codex-zh/remove": "卸载中文界面", "/api/enhancements/codex-zh/restore": "恢复中文界面", "/api/providers/activate": "切换 Key", "/api/providers/save": "保存 Key", "/api/rollback": "恢复 Codex 配置", "/api/codex/install": "安装 Codex", "/api/codex/uninstall": "卸载 Codex", "/api/sessions/backup": "备份会话", "manager:start": "启动管理工具" };
  async function refreshLogs() {
    try {
      const result = await api(`/api/logs?limit=500&outcome=${encodeURIComponent($("#log-filter").value)}`);
      const stateNames = { success: "成功", error: "失败", started: "开始" };
      $("#logs-live").innerHTML = (result.warning ? `<p class="inline-error">${h(result.warning)}</p>` : "") + (result.entries.length ? `<table class="log-table"><thead><tr><th>时间</th><th>操作</th><th>结果</th><th>编号／错误</th></tr></thead><tbody>${result.entries.map(r => `<tr><td>${h(new Date(r.time).toLocaleString())}</td><td>${h(actionNames[r.action] || r.action)}</td><td>${h(stateNames[r.outcome])}</td><td>${h(r.id.slice(0, 8))}${r.code ? `<br>${h(r.code)}` : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-inline">暂无符合条件的操作记录。</div>');
      const recent = result.entries.filter(r => r.outcome !== "started").slice(0, 3);
      $("#recent-operations").innerHTML = recent.length ? recent.map(r => `<div><span class="activity-dot ${r.outcome === "success" ? "success" : ""}"></span><p><strong>${h(actionNames[r.action] || r.action)} · ${h(stateNames[r.outcome])}</strong><small>${h(new Date(r.time).toLocaleString())}</small></p></div>`).join("") : '<p class="empty-inline">暂无操作记录</p>';
    } catch (e) { failure($("#logs-live"), e); $("#recent-operations").textContent = "日志暂不可读取"; }
  }
  async function refresh() {
    $("#extension-recovery").textContent = tab === "skills" ? "恢复记录" : "配置快照";
    $("#extension-add").textContent = tab === "skills" ? "导入／新建 Skill" : tab === "plugins" ? "刷新插件市场" : "添加 MCP";
    if (tab === "mcp") await refreshMcp(); else if (tab === "skills") await refreshSkills(); else await refreshPlugins();
  }
  document.addEventListener("777:extensions", e => { tab = e.detail; void refresh(); });
  document.addEventListener("777:navigate", e => { if (e.detail === "extensions") void refresh(); if (e.detail === "enhance") void refreshEnhancements(); if (["home", "logs"].includes(e.detail)) void refreshLogs(); });
  $("#extensions-refresh").addEventListener("click", () => refresh());
  $("#extension-add").addEventListener("click", () => { if (tab === "mcp") editMcp(); else if (tab === "skills") importSkill(); else void refreshPlugins(); });
  $("#extension-recovery").addEventListener("click", e => runButton(e.currentTarget, "读取中…", recovery));
  $("#codex-snapshots").addEventListener("click", e => runButton(e.currentTarget, "读取中…", configBackups));
  $("#enhancements-refresh").addEventListener("click", e => runButton(e.currentTarget, "检测中…", refreshEnhancements));
  $("#home-codex-zh").addEventListener("click", async e => {
    const entry = e.currentTarget; entry.disabled = true;
    try { await openCodexZh(); } catch (error) { showToast(error.message, true); }
    finally { entry.disabled = false; }
  });
  $("#logs-refresh").addEventListener("click", refreshLogs); $("#log-filter").addEventListener("change", refreshLogs);
  $("#import-current-provider").addEventListener("click", e => runButton(e.currentTarget, "导入中…", async () => {
    if (!await ask("从当前 Codex 的配置读取 777codes Key 并加密保存到 0.10 独立配置库？不会修改原配置。已有 Key 列表不覆盖。")) return;
    const result = await post("/api/providers/import-current", {}); await refreshProviders(); showToast(result.providers.length ? "已读取独立 Key 配置库" : "没有找到可导入的 777codes 配置");
  }));
  for (const [id, action] of [["window-minimize", "minimize"], ["window-close", "close"]]) $("#" + id).addEventListener("click", async () => {
    if (!window.window777) return showToast("这是浏览器隔离预览；窗口按钮在桌面程序中生效");
    if (action === "close" && dirty && !await ask("有未保存的内容，确认关闭管理工具？")) return;
    try { await window.window777[action](); } catch { showToast("窗口操作失败", true); }
  });
  void api("/api/health").then(result => {
    $("#runtime-title").textContent = result.isolated ? "隔离测试 · 不操作本机 Codex" : "开始使用";
    $("#runtime-description").textContent = result.isolated ? "仅使用测试目录，真实安装与启动已禁用。" : "选择 Key，打开 Codex 就能开始聊天。";
    $("#runtime-status").textContent = result.isolated ? "隔离预览" : "服务已连接";
  }).catch(e => { $("#runtime-status").textContent = "连接失败"; showToast(e.message, true); });
  void refreshMcp(); void refreshEnhancements(); void refreshLogs();
})();
