---
kind: upgrade-guide
description: The TBM Insight launcher, workspace packages, and profile metadata use new names.
---

# TBM Insight package and command names

English | [中文](guide.zh.md)

## Change

The command is now `tbm`. Workspace packages now use the `@tbm-insight` scope and profile manifests use the `tbm` key.

## Migration

1. Extract the new Windows ZIP into a new folder. The launcher uses the same TBM Insight data directory and updates the default Web profile manifest from the previous portable release. It saves the original as `profiles/web/package.json.before-package-rename`.
2. For custom profiles or plugins, update workspace package imports and dependencies to the names in the new manifests. Update command scripts to use `tbm`. The Web launcher supplies its engine data directory from `TBM_INSIGHT_HOME`.
3. Open TBM Insight and check that the project list and data-source settings load.
