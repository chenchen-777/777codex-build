# 777codes image capability reference

- Model: `gpt-image-2`
- Count: `1`
- Default: `1:1`, `2k`
- Resolutions: `1k`, `2k`, `4k`
- `4k` ratios: `16:9`, `9:16`, `2:1`, `1:2`, `21:9`, `9:21`
- Reference files: PNG, JPEG, WebP, up to 10 MB

The MCP submits `POST /images/generations`, accepts the synchronous Base64 or image URL response, validates the real file, and returns text-only metadata.
