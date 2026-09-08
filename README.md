# 777 Codex — macOS 客户端构建源码

此仓库公开管理工具的客户端构建源码，用于生成 Apple Silicon（arm64）与 Intel（x64）测试包。它不包含 777 平台服务端源码、用户配置、真实 API Key 或服务器凭证。

下载入口：[777codex Releases](https://github.com/chenchen-777/777codex/releases)。仅在两种架构的构建检查通过后发布测试包；成功的构建记录不代表用户真实 Mac 全功能验收。

## 本机构建

需要 macOS 12 或更高、Node.js 22，以及对应架构的构建环境：

```sh
npm ci
node scripts/package-mac.mjs arm64
# Intel Mac 使用：node scripts/package-mac.mjs x64
```

输出在 `dist-mac`。构建过程进行原生架构检查、ad-hoc 签名验证、隔离目录中的程序启动和本地接口检查。所有测试使用隔离目录，不读取你的 Codex 会话或真实 Key。

## 测试版范围

- Key 与模型配置、会话备份、通用 MCP 与 Skill 配置管理采用共享客户端逻辑。
- Mac 端识别 `/Applications/Codex.app` 或 `~/Applications/Codex.app`，提供启动、重启入口。官方 Codex 的芯片兼容性需要另外确认。
- Windows 专用安装器、卸载器、汉化、Codex++ 注入与插件修复、Image MCP 一键安装、管理工具自动更新尚未适配，在 Mac 界面或后台禁用。
- 不含 Apple Developer ID 签名或 Apple 公证；ad-hoc 签名不代表可信发行者，不能保证没有系统安全提示。
- 网页授权、真实 API 对话、跨重启钥匙串行为、实际 Codex 启停仍需用户 Mac 验收。

请勿提交密码、API Key、登录凭证或未经脱敏的日志。源码公开不等于第三方组件的许可证已改变；依赖各自的许可证仍然有效。
