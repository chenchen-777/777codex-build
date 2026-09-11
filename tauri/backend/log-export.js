(() => {
  const manager = window.manager777;
  const legacy = document.querySelector('a[href="/api/logs/export"]');
  if (!manager || !legacy) return;

  const save = document.createElement("button");
  save.type = "button";
  save.className = legacy.className;
  save.textContent = "保存脱敏日志";
  legacy.replaceWith(save);

  const result = document.createElement("div");
  result.className = "field-hint";
  result.setAttribute("aria-live", "polite");
  result.hidden = true;
  save.closest(".session-toolbar")?.insertAdjacentElement("afterend", result);

  const request = (url) => manager.api(url, { method: "POST", body: "{}" });
  save.addEventListener("click", () => manager.runButton(save, "保存中…", async () => {
    const exported = await request("/api/logs/export");
    result.hidden = false;
    result.replaceChildren(document.createTextNode(`已保存 ${exported.count} 条脱敏日志：${exported.path} `));
    const open = document.createElement("button");
    open.type = "button";
    open.className = "button ghost";
    open.textContent = "打开所在文件夹";
    open.addEventListener("click", () => manager.runButton(open, "打开中…", async () => {
      await request("/api/logs/export/open");
    }));
    result.append(open);
    manager.showToast("脱敏日志已保存");
  }));
})();
