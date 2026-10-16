!macro NSIS_HOOK_PREUNINSTALL
  ; The uninstaller registers a shortcut to itself inside the install
  ; directory. That shortcut is created after the installer's file list is
  ; built, so the uninstaller does not know about it and never removes it.
  ; The directory therefore never empties, and removing an empty directory
  ; is the last thing the uninstaller does — which means the whole folder
  ; survives. The user is left with an install directory they cannot name
  ; the reason for.
  ;
  ; Deleting it before the file removal runs is enough: afterwards the
  ; directory is empty and the uninstaller's own removal takes it.
  Delete "$INSTDIR\Uninstall ${PRODUCTNAME}.lnk"
!macroend