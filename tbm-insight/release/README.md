# 构建与发布

Windows 便携包包含运行所需的 Node.js 和 Python。运行状态和用户数据保存在本机用户目录，另行配置工程文件路径。

在 Windows x64 上构建。准备 Node.js 24.9 或以上版本和 Python 3.13，并在 `tbm-insight/.runtime/node/` 和 `tbm-insight/.runtime/python/` 分别准备可独立运行的发行版。把下列 Python 依赖安装到便携 Python 环境，确认该环境能导入 `matplotlib`、`wasi_python` 和 `wasmtime`。启动和打包均使用该目录下的二进制文件。

```powershell
pnpm install --frozen-lockfile
pnpm run build:artifacts
python -m pip install --target tbm-insight/.runtime/python/Lib/site-packages -r tbm-insight/tools/requirements.txt -r tbm-insight/research/requirements.txt
python -B tbm-insight/release/pack-installed-runtime.py . ./TBM-Insight-Windows-x64.zip
```

源码目录用于 Git 仓库，便携 ZIP 用作发布附件。发布内容排除个人设置、凭据、工程原件、知识库索引、科研项目、运行输出及缓存。随包保留依赖许可。
