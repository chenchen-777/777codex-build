# 777codes Image MCP 能力

## 固定接口

- Base URL：`https://www.777codes.codes/gpt-image/v1`
- 模型：`gpt-image-2`
- 单次数量：`1`
- 生成：`POST /images/generations`
- 返回：同步 JSON，图片位于 `data[].b64_json` 或 `data[].url`
- 参考图：通过 `image_urls` 发送本地图片的 data URI

## 比例与分辨率

`1k`、`2k` 支持：`auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`16:9`、`9:16`、`2:1`、`1:2`、`21:9`、`9:21`。

`4k` 仅支持：`16:9`、`9:16`、`2:1`、`1:2`、`21:9`、`9:21`。

最终报告以下载文件的真实格式和像素为准。MCP 不会把 Base64 图片放进对话上下文。
