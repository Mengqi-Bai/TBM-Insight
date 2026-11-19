@echo off
setlocal DisableDelayedExpansion
set "signTool=%TBM_ENGINE_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%TBM_ENGINE_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%TBM_ENGINE_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%TBM_ENGINE_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%TBM_ENGINE_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%TBM_ENGINE_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "TBM_ENGINE_DESKTOP_WINDOWS_SIGNTOOL="
set "TBM_ENGINE_DESKTOP_WINDOWS_CER_FILE="
set "TBM_ENGINE_DESKTOP_WINDOWS_TOKEN_PIN="
set "TBM_ENGINE_DESKTOP_WINDOWS_KEY_CONTAINER="
set "TBM_ENGINE_DESKTOP_WINDOWS_SIGN_TARGET="
set "TBM_ENGINE_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% "%targetFile%"
exit /b %errorlevel%
