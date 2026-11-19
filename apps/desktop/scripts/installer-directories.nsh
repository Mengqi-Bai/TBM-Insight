!include "LogicLib.nsh"

Var tbmFinalDirectory
Var tbmNewDirectory
Var tbmOldDirectory
Var tbmOldMoved
Var tbmNewMoved
Var tbmDirectoryError
Var tbmDirectorySource
Var tbmDirectoryDestination
Var tbmRestoreError
Var tbmDirectoryLogDirectory
Var tbmRecoveryStopped

; MoveFileEx preserves the destination and exposes the Windows error before rollback changes it.
; Open files inside a directory can make its rename return access denied (5).
!macro tbmDirectoryOperation SOURCE DESTINATION RESULT PHASE
  Push $0
  Push $1
  Push $2
  StrCpy $0 0
  ${Do}
    ${If} "${DESTINATION}" == ""
      System::Call 'kernel32::RemoveDirectoryW(w "${SOURCE}") i.r1 ?e'
    ${Else}
      System::Call 'kernel32::MoveFileExW(w "${SOURCE}", w "${DESTINATION}", i 0) i.r1 ?e'
    ${EndIf}
    Pop ${RESULT}
    ${If} "${DESTINATION}" == ""
      ${If} ${RESULT} == 2
      ${OrIf} ${RESULT} == 3
        StrCpy $1 1
      ${EndIf}
    ${EndIf}
    ${If} $1 != 0
      StrCpy ${RESULT} 0
      ${ExitDo}
    ${EndIf}
    ClearErrors
    FileOpen $2 "$PLUGINSDIR\directory-operations.log" a
    ${IfNot} ${Errors}
      FileSeek $2 0 END
      FileWrite $2 "${PHASE}: Windows error: ${RESULT}$\r$\n"
      FileClose $2
    ${EndIf}
    ${If} ${RESULT} != 5
    ${AndIf} ${RESULT} != 32
    ${AndIf} ${RESULT} != 33
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
    ${If} $0 >= 10
      ${ExitDo}
    ${EndIf}
    IntOp $1 $0 * 250
    Sleep $1
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro tbmReportDirectoryFailure
  ${If} $tbmRestoreError != 0
    StrCpy $tbmRecoveryStopped "1"
  ${EndIf}
  !ifmacrodef customInstallerDirectoryFailed
    !insertmacro customInstallerDirectoryFailed
  !else
    DetailPrint "Directory operation failed ($tbmDirectoryError): $tbmDirectorySource -> $tbmDirectoryDestination; restore error: $tbmRestoreError"
  !endif
!macroend

!macro tbmExtractPayload FILE
  !ifmacrodef customInstallerExtract
    !insertmacro customInstallerExtract "${FILE}"
  !else
    nsExec::ExecToStack '"$PLUGINSDIR\tbm-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${FILE}"'
    Pop $R0
    Pop $R1
  !endif
  ${If} $R0 != 0
    DetailPrint $R1
    Call tbmRollbackDirectories
    !ifmacrodef customInstallerExtractFailed
      !insertmacro customInstallerExtractFailed "${FILE}"
    !else
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)" /SD IDOK
    !endif
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro tbmStageApplication
  !ifdef TBM_ENGINE_INSTALLER_LOG_DIR
    ; electron-builder defines the cache name after including our function bodies, before this section expands.
    StrCpy $tbmDirectoryLogDirectory "${TBM_ENGINE_INSTALLER_LOG_DIR}"
  !endif
  StrCpy $tbmFinalDirectory $INSTDIR
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $tbmNewDirectory "$INSTDIR.new-$0"
  StrCpy $tbmOldDirectory "$INSTDIR.old-$0"
  StrCpy $tbmOldMoved ""
  StrCpy $tbmNewMoved ""
  StrCpy $tbmDirectoryError 0
  StrCpy $tbmRestoreError 0
  StrCpy $tbmRecoveryStopped ""
  ClearErrors
  CreateDirectory $tbmNewDirectory
  ${If} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  File /oname=$PLUGINSDIR\tbm-7za.exe "${TBM_ENGINE_SEVENZIP_PATH}"
  StrCpy $INSTDIR $tbmNewDirectory
  SetOutPath $INSTDIR
  !insertmacro installApplicationFiles
  !ifdef TBM_ENGINE_SEVENZIP_LICENSE_DIR
    File /oname=7zip-installer-LICENSE.txt "${TBM_ENGINE_SEVENZIP_LICENSE_DIR}\LICENSE.txt"
    File /oname=7zip-installer-COPYING.txt "${TBM_ENGINE_SEVENZIP_LICENSE_DIR}\COPYING"
  !endif
  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif
  StrCpy $INSTDIR $tbmFinalDirectory
  SetOutPath $PLUGINSDIR
!macroend

Function .onGUIEnd
  Call tbmCleanupDirectories
FunctionEnd

Function tbmCleanupDirectories
  ${If} $tbmRecoveryStopped == "1"
    Return
  ${EndIf}
  ${If} $tbmFinalDirectory != ""
    Call tbmRollbackDirectories
  ${EndIf}
FunctionEnd

; Only directories created or renamed by this installer are removed during rollback.
Function tbmRollbackDirectories
  SetOutPath $PLUGINSDIR
  ${If} $tbmNewMoved == "1"
    RMDir /r "\\?\$tbmFinalDirectory"
    StrCpy $tbmNewMoved ""
  ${EndIf}
  ${If} $tbmOldMoved == "1"
    !insertmacro tbmDirectoryOperation "$tbmOldDirectory" "$tbmFinalDirectory" $tbmRestoreError "restore"
    ${If} $tbmRestoreError != 0
      ; Leave the complete backup in place if another process prevents restoration.
      DetailPrint $tbmOldDirectory
      RMDir /r "\\?\$tbmNewDirectory"
      Return
    ${EndIf}
    StrCpy $tbmOldMoved ""
  ${EndIf}
  ${If} $tbmNewDirectory != ""
    RMDir /r "\\?\$tbmNewDirectory"
  ${EndIf}
  StrCpy $INSTDIR $tbmFinalDirectory
FunctionEnd

Function tbmPromoteDirectories
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 2
  !endif
  ; SetOutPath opens a directory handle; release it before either rename.
  SetOutPath $PLUGINSDIR
  ClearErrors
  ${If} ${FileExists} "$tbmFinalDirectory\*.*"
    StrCpy $tbmDirectorySource $tbmFinalDirectory
    StrCpy $tbmDirectoryDestination $tbmOldDirectory
    !insertmacro tbmDirectoryOperation "$tbmDirectorySource" "$tbmDirectoryDestination" $tbmDirectoryError "backup"
    ${If} $tbmDirectoryError != 0
      Call tbmRollbackDirectories
      !insertmacro tbmReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
    StrCpy $tbmOldMoved "1"
  ${Else}
    ; NSIS can create the destination before the install section starts.
    StrCpy $tbmDirectorySource $tbmFinalDirectory
    StrCpy $tbmDirectoryDestination ""
    !insertmacro tbmDirectoryOperation "$tbmDirectorySource" "" $tbmDirectoryError "remove-empty"
    ${If} $tbmDirectoryError != 0
      Call tbmRollbackDirectories
      !insertmacro tbmReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
  ${EndIf}
  ClearErrors
  StrCpy $tbmDirectorySource $tbmNewDirectory
  StrCpy $tbmDirectoryDestination $tbmFinalDirectory
  !insertmacro tbmDirectoryOperation "$tbmDirectorySource" "$tbmDirectoryDestination" $tbmDirectoryError "promote"
  ${If} $tbmDirectoryError != 0
    Call tbmRollbackDirectories
    !insertmacro tbmReportDirectoryFailure
    SetErrors
    Return
  ${EndIf}
  StrCpy $tbmNewMoved "1"
  SetOutPath $tbmFinalDirectory
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 3
  !endif
  ClearErrors
FunctionEnd

!macro tbmFinishDirectories
  StrCpy $tbmNewMoved ""
  ${If} $tbmOldMoved == "1"
    RMDir /r "\\?\$tbmOldDirectory"
    StrCpy $tbmOldMoved ""
  ${EndIf}
!macroend
