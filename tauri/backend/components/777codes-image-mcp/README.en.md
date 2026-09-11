# 777codes Image MCP

A text-only stdio MCP server and Codex Skill for 777codes image generation. It submits asynchronous GPT-Image jobs, polls their status, saves real image files locally, and returns only structured text, paths, and Markdown to Codex.

The endpoint is fixed to `https://www.777codes.codes/gpt-image/v1`. The public tool surface uses `gpt-image-2`, one image per request, aspect-ratio sizing, and `1k`, `2k`, or `4k` resolution tiers.

## Windows installation

1. Extract `777codes-Image-MCP-v<version>.zip` from the release bundle.
2. Double-click `install.cmd`.
3. Enter a GPT-Image API key created in the 777codes console.
4. Fully restart Codex and open a new task.

No preinstalled Node.js, npm, or PowerShell 7 is required. The x64 release bundle includes the pinned managed Node.js runtime and configures a 600-second MCP tool timeout without downloading Node.js during installation.

The default installation directory is `%LOCALAPPDATA%\777codes-image-mcp`; administrator access is not required.

Example:

```text
Use $777codes-image to generate a 1:1, 2k image of a red paper crane on a white background, then display it.
```

The tools are `image_doctor`, `list_image_models`, `explain_image_capability`, `generate_image`, `edit_image`, and `inspect_image`. See the [complete capability and degradation matrix](CAPABILITIES.en.md).
