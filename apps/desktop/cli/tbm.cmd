@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\TBM Insight.exe" --expose-internals "%~dp0..\..\..\app.asar\tbm\node_modules\@deepseek-ai\tbm-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
