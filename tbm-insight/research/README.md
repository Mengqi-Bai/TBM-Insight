# TBM Insight 科研平台

从「规范与案例」下方进入，点击「新建项目」。可在项目创建时选择本机保存位置，系统会在该位置创建独立子文件夹。留空时，Windows 便携版将项目保存在 `%LOCALAPPDATA%\TBM Insight\research` 下，源码开发环境保存在 `tbm-insight/research/projects/` 下。项目索引、对话和任务状态由科研平台的本地数据库保存，运行文件放入对应项目文件夹。

每个科研项目在 TBM Insight 中使用独立的科研会话。助手根据自然语言和工具结果决定下一项操作。右侧显示实际工具活动、待审议题和项目成果。科研记录支持版本及引用关系，已有 AutoResearchClaw 成果可在原流程成果中查看。回车发送，Ctrl+回车换行，暂停、恢复和确认在对话框底栏操作。

可从研究问题、已有结果、真实数据路径或附件开始。助手可以先盘点目录和数据字段。支持自然语言中的含空格路径。预处理工具分块读取 CSV、TSV、PLC TXT 和包含这些表格的 ZIP，保留源文件、表名和行号。多级目录可以逐层盘点。实测试验要求提供实际输入并读取数据。源文件保持只读。

模型复用「设置 → 模型」里的默认模型及其现有凭据。公开文献查询使用公开工程关键词。主会话可按需委派研究设计、文献与证据、数据与试验、科技论文写作和模拟同行评审。协作会话从独立上下文开始，接收本次任务及所需项目记录和文件，向主会话返回摘要与成果。

科技论文写作技能指引助手核对期刊模板及各部分篇幅。稿件检查工具统计 Markdown 的正文、摘要和全稿，定位清单式正文、工作备注与图占位。关键图可在对话里带图注预览与下载。初审、返修回复和修订稿分别保存，记录审阅及修改所依据的版本。

科研 Python 的 Matplotlib 导出接入共享绘图样式，包括优先字体、无网格、黑色四边框、内向刻度和图例避让。独立图沿用绘图代码选择的画布比例。同日或同周的对照图可用 `tbm_figure.new_figure(height, align_time=True)` 共享绘图区宽度，绘图代码同时设定共同范围和刻度。作图任务通过 `figure_language` 指定 `zh` 或 `en`，保存时核对标题和坐标轴，报告记录所选语种。旧图可以用对应试验脚本和数据重新生成。

## 运行条件

AutoResearchClaw 0.5.0 源码位于 `vendor/AutoResearchClaw/`，基于提交 `be4ba4755bf1b52220f25e13b2293b5956590070`，附上游 MIT 许可证。科研智能体复用其中的学术检索代码，并参考实验审查和证据管理方法。试验与预处理工具使用项目内的 Python 环境。

Windows 一键启动优先使用项目内安装的 `tbm-insight/.runtime/python/python.exe`。实验运行和迭代使用随 Python 环境安装的 WASI 隔离运行时，无需 Docker、WSL 或外部项目源码。该环境提供 CPU 科学计算库 NumPy、pandas、SciPy、scikit-learn 和 Matplotlib。实验只能读取本次研究复制到 `/data` 的文件，不能联网或启动宿主程序。GPU 和实验时安装包均不可用。实际执行需要读到已登记的数据文件并产出完整的真实数据指标。后台保存读到的文件及其 SHA-256，供管理员追溯。

迁移时保留项目内的 `tbm-insight/.runtime`。如果仅复制了源码，可从仓库根目录重建科研 Python 环境。

```powershell
py -3.11 -m venv .\tbm-insight\research\.venv
.\tbm-insight\research\.venv\Scripts\python.exe -m pip install -r .\tbm-insight\research\requirements.txt
.\tbm-insight\research\.venv\Scripts\python.exe -B -X utf8 .\tbm-insight\research\tbm_arc_runner.py probe --runtime-root .\tbm-insight\research
```
