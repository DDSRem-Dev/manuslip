; Advertise Open with Manuslip using a private ProgID. Default choices belong to
; the OS settings UI; neither installation nor uninstallation writes them.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Manuslip.Markdown" "" "Markdown document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Manuslip.Markdown\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Manuslip.Markdown\shell\open" "" "Open with Manuslip"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Manuslip.Markdown\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Manuslip"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "Manuslip.Markdown"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "Manuslip.Markdown"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.mdown\OpenWithProgids" "Manuslip.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".md" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".markdown" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".mdown" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "Manuslip.Markdown"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "Manuslip.Markdown"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mdown\OpenWithProgids" "Manuslip.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Manuslip.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
