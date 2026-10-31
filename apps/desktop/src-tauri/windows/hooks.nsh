!macro NSIS_HOOK_POSTINSTALL
  ; Older packages shipped ggml*.dll, whisper.dll, and whisper-cli.exe
  ; beside the engine. 0.8.3 ships two static executables, and a stale
  ; DLL in the same directory caused the 0xC0000409 crash on upgrade.
  ; Remove the old set after the new files are in place.
  Delete "$INSTDIR\runtime\ggml-base.dll"
  Delete "$INSTDIR\runtime\ggml-cpu.dll"
  Delete "$INSTDIR\runtime\ggml-vulkan.dll"
  Delete "$INSTDIR\runtime\ggml.dll"
  Delete "$INSTDIR\runtime\whisper.dll"
  Delete "$INSTDIR\runtime\whisper-cli.exe"
  Delete "$INSTDIR\runtime\.pin"
!macroend

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