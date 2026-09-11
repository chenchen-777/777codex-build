# 777codes Image MCP capabilities

- Base URL: `https://www.777codes.codes/gpt-image/v1`
- Model: `gpt-image-2`
- Count: one image per request
- Generate: `POST /images/generations`
- Response: synchronous JSON with images in `data[].b64_json` or `data[].url`
- Reference images: local PNG, JPEG, or WebP files sent as data URIs in `image_urls`

`1k` and `2k` support `auto`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `2:1`, `1:2`, `21:9`, and `9:21`.

`4k` supports only `16:9`, `9:16`, `2:1`, `1:2`, `21:9`, and `9:21`.
