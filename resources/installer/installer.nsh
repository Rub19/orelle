; Orelle branded assisted installer (electron-builder NSIS, no administrator rights).
; Orelle changes nothing system-wide; the only things to undo on uninstall are what it may have
; changed for the current user while running: the hidden / auto-hidden taskbar and its sign-in entry.

!ifndef ORELLE_BRAND_PAGES
  !define ORELLE_BRAND_PAGES
  !define MUI_WELCOMEPAGE_TITLE "Orelle"
  !define MUI_WELCOMEPAGE_TEXT "A calmer, configurable Windows desktop.$\r$\n$\r$\nOrelle keeps your preferences between updates."
  !define MUI_FINISHPAGE_TITLE "Orelle is ready"
  !define MUI_FINISHPAGE_TEXT "Installation complete. Start Orelle from the Start menu or notification area."
!endif

!macro customInit
  ; Close a running Orelle cleanly (it restores the taskbar and releases its reserved screen space).
  IfFileExists "$INSTDIR\Orelle.exe" 0 +3
    nsExec::Exec '"$INSTDIR\Orelle.exe" --orelle-quit'
    Sleep 1500
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\Orelle.exe" 0 +5
    nsExec::Exec '"$INSTDIR\Orelle.exe" --orelle-quit'
    Sleep 1500
    ; Also covers a crash while the taskbar was hidden (state saved in %APPDATA%\Orelle).
    nsExec::Exec '"$INSTDIR\Orelle.exe" --orelle-restore-taskbar'
    Sleep 500
  ; "Launch at sign-in" entry written by Orelle (Electron setLoginItemSettings, value name "Orelle").
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Orelle"
!macroend
