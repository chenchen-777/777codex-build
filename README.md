# 777 Codex — macOS 客户端构建源码

## 当前构建：Tauri 测试版 0.12.0-mac-tauri-3

mac-tauri-3 修复卸载被应用签名检查阻断的问题：卸载只做应用身份、路径、权限和运行状态检查，备份后保留恢复副本，不要求签名有效。下载/安装依然严格校验签名。新包构建完成不等于网站已更新，请核对下载页版本号。

当前构建入口为 `tauri/`，不再使用 Electron。系统 WebKit 负责界面，Rust 提供原生窗口与钥匙串适配，包内携带 Node 后台组件。历史 Electron 源码和 r44 下载仍保留供回退。

这轮补齐：Mac 官方应用下载/校验/安装/更新/卸载、独立中文副本及其移除、任务进度与安装包位置；余额独立刷新，明确区分余额不足、Key 失效、权限和网络错误。保留圆形图标、首页 Key/模型管理和网页登录修补。

首次使用请重新网页登录并同步 Key。Tauri 使用 macOS 钥匙串保存 AES 主密钥，配置仅保存认证加密后的凭证；不尝试解密或覆盖旧 Electron 登录数据。原有 `~/.codex` 聊天记录不迁移、不删除。

解压后将完整的 `777 Codex.app` 放入 Applications。默认进入可用模式；`--isolated` 仅供不连接真实平台账号的隔离测试。网页直接唤起导入协议和自动更新通道尚未迁入，请使用账号同步和手动下载新版。

此仓库公开管理工具的客户端构建源码，用于生成 Apple Silicon（arm64）与 Intel（x64）测试包。它不包含 777 平台服务端源码、用户配置、真实 API Key 或服务器凭证。

下载入口：[777codes 下载管理工具](https://www.777codes.codes/download/777codex)。仅在两种架构的构建检查通过后更新网站测试包；成功的构建记录不代表用户真实 Mac 全功能验收。请核对下载页的版本号。

## 本机构建

需要 macOS 12 或更高、Node.js 22，以及对应架构的构建环境：

```sh
npm ci
npm run package:mac
# Apple Silicon 和 Intel 必须分别在对应芯片 runner 上构建；还需要 Rust 和 Xcode Command Line Tools。
```

输出在 `dist-mac-tauri`。构建过程检查主程序、原生助手及 Node 三个文件的架构、ad-hoc 签名、隔离的 Tauri/WebKit 界面启动，以及合成凭证的钥匙串加解密。所有测试使用隔离目录，不读取你的 Codex 会话或真实 Key。

## 测试版范围

- Key 与模型配置、会话备份、通用 MCP 与 Skill 配置管理采用共享客户端逻辑。
- Mac 端识别 `/Applications/Codex.app` 或 `~/Applications/Codex.app`，提供启动、重启入口。官方 Codex 的芯片兼容性需要另外确认。
- Mac 原生下载/安装/更新/卸载与独立中文副本使用 Mac 专用实现，不运行 Windows 脚本。旧应用保留为定点恢复副本，官方文件及用户数据不被汉化覆盖。
- 官方当前下载源是 Apple 芯片包；Intel 管理工具可运行不表示官方 Codex 支持 Intel，不兼容时明确拒绝安装。未知汉化结构也会停止。
- Codex++ 注入与插件修复、Image MCP 一键安装、管理工具自动更新尚未适配，在 Mac 界面或后台禁用。
- ZIP 内的「首次打开说明.html」可请求打开隐私与安全性，不能自动完成“仍要打开”授权；不移除隔离标记，也不关闭 Gatekeeper。
- 不含 Apple Developer ID 签名或 Apple 公证；ad-hoc 签名不代表可信发行者，不能保证没有系统安全提示。
- 网页授权、真实 API 对话、跨重启钥匙串行为、实际 Codex 启停仍需用户 Mac 验收。

请勿提交密码、API Key、登录凭证或未经脱敏的日志。源码公开不等于第三方组件的许可证已改变；依赖各自的许可证仍然有效。
