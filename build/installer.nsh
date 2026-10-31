!macro customInstall
  FileOpen $0 "$INSTDIR\resources\installer-language.txt" w
  StrCmp $LANGUAGE 1049 0 writeEnglish
    FileWrite $0 "ru"
    Goto languageWritten
  writeEnglish:
    FileWrite $0 "en"
  languageWritten:
  FileClose $0
!macroend
