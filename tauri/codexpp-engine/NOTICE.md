# Codex++ integration

This component incorporates chenchen-777/CodexPlusPlus, licensed AGPL-3.0-only.
Upstream tag: v1.2.56-777.4.
Pinned source: https://github.com/chenchen-777/CodexPlusPlus/tree/9cbf0130c23b655727dc5c9f43689c425926618c

The GCC adapter source is in `tauri/codexpp-engine` in the corresponding
release commit of https://github.com/chenchen-777/777codex-build.
Publish that corresponding source (including Cargo.lock and build scripts)
alongside every binary distribution. Do not publish a binary without its
matching source. Preserve upstream copyright notices and the attached LICENSE.

Adapter modifications: scoped manager settings, standard-input JSON interface,
embedded plugin marketplace repair, direct CDP integration, no separate manager,
no inherited provider profiles, no marketing or external sharing, no persistent
watcher installer, and session-index backups before deletion.

This is not an OpenAI product. Runtime compatibility must be tested against the
installed Codex version. This adapter does not confer Apple notarization or
Windows code-signing trust.
