@echo off
setlocal
title TBM Insight
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tbm-insight\start.ps1" -Port 0 %*
set "launch_exit=%errorlevel%"
if "%launch_exit%"=="0" exit /b 0
echo.
echo TBM Insight stopped with exit code %launch_exit%.
pause
exit /b %launch_exit%
