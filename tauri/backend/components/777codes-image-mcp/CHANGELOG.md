# Changelog

## 1.0.4 - 2026-08-07

- Bundled the verified official Node.js x64 runtime so normal installation no longer downloads Node.js.
- Made partial installations from older releases safely resumable.

## 1.0.3 - 2026-08-07

- Fixed managed Node.js installation on Windows systems that deny directory-level `Move-Item` operations.

## 1.0.2 - 2026-08-07

- Changed the default Windows installation directory to `%LOCALAPPDATA%\777codes-image-mcp`.
- Replaced the noisy Node.js byte counter with a percentage progress bar.

## 1.0.1 - 2026-08-07

- Fixed 777codes generation handling to accept the verified synchronous `data[].b64_json` response.
- Removed the incorrect task polling assumption from the runtime and documentation.

## 1.0.0 - 2026-08-07

- Adapted the upstream text-only MCP and Codex Skill for 777codes downstream users.
- Fixed the service endpoint to `https://www.777codes.codes/gpt-image/v1`.
- Added the 777codes asynchronous submit and task-polling protocol.
- Fixed the model to `gpt-image-2`, count to one, and exposed supported aspect ratios and resolution tiers.
- Changed reference-image requests to the `image_urls` JSON contract.
- Renamed the installer, Skill, MCP registration, state directory, and environment variables for 777codes.
