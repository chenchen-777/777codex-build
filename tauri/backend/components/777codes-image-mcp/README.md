# 777codes Image MCP

面向 777codes 下游用户的文本型 MCP 生图工具。它让 Codex 通过本地 stdio MCP 调用 777codes GPT-Image 接口，把生成结果保存为本地图片，并在对话中显示。

服务地址：

```text
https://www.777codes.codes/gpt-image/v1
```

## 功能

- 文生图与本地参考图编辑
- 固定使用 777codes 支持的 `gpt-image-2`
- 支持 `1k`、`2k`、`4k` 分辨率档位
- 支持常见横竖比例
- 接收接口同步返回的 Base64 或图片 URL，并自动保存到本地
- 下载结果到本地，只向 Codex 返回文本、文件路径和 Markdown
- API Key 存入受保护的本地配置，不写入项目或 Codex 对话

## Windows 安装

1. 从 `release` 目录取得 `777codes-Image-MCP-v<版本>.zip` 并解压。
2. 双击 `install.cmd`。
3. 按提示输入从 777codes 控制台创建的 GPT-Image API Key。
4. 完全退出并重新打开 Codex，然后新建任务。

安装包已内置固定版本的 Node.js 运行时，不需要联网下载 Node.js，也不需要预装 Node.js、npm 或 PowerShell 7，不会修改系统 `PATH`。

默认安装目录为 `%LOCALAPPDATA%\777codes-image-mcp`，不需要管理员权限，可避免其他磁盘的目录权限冲突。

## 第一次生成

在新的 Codex 任务中输入：

```text
使用 $777codes-image 生成一张 1:1、2k 的 PNG 图片：白色背景上的红色纸鹤，居中构图，柔和阴影，不要文字。生成后显示图片。
```

## MCP 工具

| 工具 | 用途 | 是否可能计费 |
|---|---|---|
| `image_doctor` | 检查本地运行时、Key 和模型目录 | 否 |
| `list_image_models` | 查询当前图片模型 | 否 |
| `explain_image_capability` | 查询比例与分辨率边界 | 否 |
| `generate_image` | 文生图并保存本地文件 | 是 |
| `edit_image` | 使用本地参考图生成新图片 | 是 |
| `inspect_image` | 检查图片格式、尺寸和 SHA-256 | 否 |

生成与编辑工具公开的主要参数：

- `prompt`：图片描述
- `aspect_ratio`：默认 `1:1`
- `resolution`：`1k`、`2k` 或 `4k`，默认 `2k`
- `out`：可选的输出文件或目录
- `reference_path`：仅编辑工具使用，本地 PNG、JPEG 或 WebP

每次请求固定生成一张图。`4k` 仅支持 `16:9`、`9:16`、`2:1`、`1:2`、`21:9`、`9:21`。

## Key 与更新

更换 Key：

```powershell
.\install.cmd -ResetApiKey
```

卸载：

```powershell
.\install.cmd -Uninstall
```

也可以在启动 Codex 前设置 `CODES777_API_KEY`。不要把 Key 写进仓库、README、Issue 或聊天记录。

## 开发验证

```powershell
npm ci
npm test
npm run build:release
```

能力边界见 [CAPABILITIES.md](CAPABILITIES.md)。

## 许可

代码使用 MIT License。777codes 相关名称与服务条款不因本代码许可而改变。
