---
name: 777codes-image
description: Generate or edit images through the registered 777codes stdio MCP, save results locally, and display them in the conversation. Use when a user asks to create, draw, render, transform, or edit a raster image through 777codes.
---

# 777codes Image

Use the registered `777codes-image` MCP tools for 777codes image requests.

## Workflow

1. Call `image_doctor` before the first live generation in a task.
2. Stop when `data.ready=false`; report its issues without asking the user to paste a Key into chat.
3. Use `generate_image` for text-to-image and `edit_image` when the user supplies a local PNG, JPEG, or WebP reference.
4. Choose `aspect_ratio` and `resolution` from the user's request. Default to `1:1` and `2k`.
5. Set `out` to a descriptive location in the current workspace when practical.
6. On success, display every `data.result.images[].markdown` value and report the actual size and format.

The model is fixed to `gpt-image-2`, and each request generates one image. `1k` and `2k` support all documented ratios. `4k` supports only `16:9`, `9:16`, `2:1`, `1:2`, `21:9`, and `9:21`.

## Safety And Billing

- A user image request authorizes one potentially billable call, not automatic variants or retries.
- Never expose API Keys, authorization headers, reference-image Base64, or raw upstream responses.
- Do not retry after host cancellation, timeout, HTTP 502/503/524, or an ambiguous network failure without fresh user authorization.
- `image_doctor` is read-only. `generation_channel_status=not_probed` means it cannot prove that a billable generation will succeed.
- `catalog_status=unverified` is non-blocking when the user has already requested an image.

## Errors

- `api_key_missing`: rerun `install.cmd -ResetApiKey` or configure `CODES777_API_KEY` before launching Codex.
- `invalid_api_key`: update the 777codes Key and confirm it belongs to a GPT-Image group.
- `unsupported_size` or `unsupported_resolution`: choose a documented ratio/resolution combination; do not silently resubmit.
- `reference_image_not_found` or `invalid_reference_image`: request a valid local PNG, JPEG, or WebP path.
- `upstream_channel_unavailable`, `rate_limit`, `upstream_error`, or `upstream_timeout`: report the condition and stop.
- `MCP error -32001: Request timed out`: do not retry automatically. The installer configures a 600-second tool timeout; rerun the latest installer and restart Codex if the old timeout remains.

If the active model cannot inspect images visually, display the saved file but distinguish file validation from visual review.
