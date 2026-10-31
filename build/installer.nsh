!macro customInstall
  FileOpen $0 "$INSTDIR\resources\installer-language.txt" w
  FileWrite $0 "en"
  FileClose $0
!macroend
