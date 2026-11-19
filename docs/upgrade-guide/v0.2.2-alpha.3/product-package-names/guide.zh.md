---
kind: upgrade-guide
description: TBM Insight 的启动命令、工作区包和配置清单使用新的名称。
---

# TBM Insight 包名与命令

[English](guide.md) | 中文

## 变更

命令改为 `tbm`，工作区包使用 `@tbm-insight` 作用域，运行配置清单使用 `tbm` 字段。

## 迁移

1. 将新版 Windows ZIP 解压到新文件夹。启动器沿用 TBM Insight 的数据目录，并更新上一版便携包的默认 Web 配置清单。原清单备份到 `profiles/web/package.json.before-package-rename`。
2. 若有自定义配置或插件，按新版清单更新工作区包的导入和依赖名。脚本改用 `tbm` 命令。Web 启动器通过 `TBM_INSIGHT_HOME` 设置运行数据目录。
3. 打开 TBM Insight，确认科研项目列表和工程数据设置可以读取。
