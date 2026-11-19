# TBM Insight

面向 TBM 施工现场的工程分析与科研平台。

- 施工进度、掘进工况、换刀统计和规范案例
- 支持真实数据、科研协作、试验、论文写作和图表

## Windows 快速开始

1. 在仓库的 **Releases** 页面下载附件 `TBM-Insight-Windows-x64.zip`。GitHub 自动生成的 `Source code (zip)` 是供构建使用的源码。
2. 将便携包完整解压到本机可写的 NTFS 目录，双击 `启动 TBM Insight.cmd`。平台会在浏览器中打开。便携包已带 Node.js 和 Python。
3. 左侧「规范与案例」可直接浏览 PDF、检索规范和查看案例。内置库包含 64 份可检索规范、66 份 PDF 和 174 个案例项目。设置中的「规范与案例库」留空即可使用内置库。
4. 在左下角「设置 → 工程数据」选择自己的 PLC 归档目录和换刀台账。PLC 支持 CREC188 字段和日归档格式，换刀台账支持符合既有 `Sheet1` 表头的 XLSX，可选其所在文件夹或填写完整文件路径。

工程看板和内置知识库的浏览、检索可离线使用。主对话和科研功能使用「设置 → 模型」中配置的模型服务。

[使用说明](tbm-insight/README.md) · [科研平台](tbm-insight/research/README.md) · [源码构建与发布](tbm-insight/release/README.md)

上一版便携包与自定义插件的升级方法见[包名与命令变更](docs/upgrade-guide/v0.2.2-alpha.3/product-package-names/guide.zh.md)。
