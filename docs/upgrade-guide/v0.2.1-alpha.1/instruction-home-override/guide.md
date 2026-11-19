---
kind: upgrade-guide
description: "The `agent-instructions` row no longer accepts `tbmHome`; instruction loading always resolves the harness home from `$TBM_ENGINE_HOME` or `~/.tbm`."
---

# Instruction loading resolves one harness home

English | [中文](guide.zh.md)

## Change

`@tbm-insight/agent-instructions` removed its `tbmHome` config field. The plugin resolves the harness home through `resolveTbmHome()` from `@tbm-insight/home-paths`, like every other harness consumer: the home is `$TBM_ENGINE_HOME` when it is set and non-blank, otherwise `~/.tbm`, with tilde expansion.

A `cordis.yml`, profile patch, or `--patch` overlay that still sets `tbmHome` on the `agent-instructions` row has no effect: the row keeps the stray key and the plugin ignores it, so instruction loading follows the process home. Other providers, such as `tbm-skill-filesystem` and `tbm-shell-env`, keep their own home fields; this removal covers the instruction loader only.

## Migration

1. Delete `tbmHome` from the `agent-instructions` row in `cordis.yml`, `$TBM_ENGINE_HOME/cordis.patch.yml`, `$TBM_ENGINE_HOME/profiles/<profile>/cordis.patch.yml`, and any `--patch` overlay.
2. Where the override pointed at a non-default home, export `TBM_ENGINE_HOME` for the process instead, so every harness consumer reads that home.
3. Confirm with `tbm --profile <profile> --dump-config` that the `agent-instructions` row lists only its remaining fields, and that a new session's first request shows `Instructions from: $TBM_ENGINE_HOME/AGENTS.md` (or `~/.tbm/AGENTS.md`) when that file exists.
