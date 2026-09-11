// Shared by Windows and Mac staging. Does not alter installation behavior.
export function patchZhButtonCopy(source){
 if(source.includes('重新安装中文版'))return source;
 source=source.replace('zh.installed ? "重新构建" : "安装中文版"','zh.installed ? "更新中文版" : "安装中文版"').replace('这是首页快捷功能，不属于 Codex++ 插件页。Codex 更新后重新构建即可。','Codex 更新后，点击“更新中文版”即可再次使用中文界面。');
 return source.replace('zh.installed ? "更新中文版" : "安装中文版"','zh.installed ? (zh.compatible ? "重新安装中文版" : "更新中文版") : "安装中文版"')
 .replace('Codex 更新后，点击“更新中文版”即可再次使用中文界面。','${zh.installed && zh.compatible ? "已是当前版本，直接点击“启动中文版”。" : zh.installed ? "官方版本已变化，请先更新中文版。" : "先安装中文版，再点击启动。"}')
 .replace('dialog.querySelector(\'[data-action="install-zh"]\').addEventListener',`dialog.querySelector('[data-action="' + (zh.installed && zh.compatible ? 'launch-zh' : 'install-zh') + '"]').classList.replace('ghost','primary');
    dialog.querySelector('[data-action="install-zh"]').addEventListener`);
}
