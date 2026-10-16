; Custom hooks for the generated NSIS installer.
;
; One hook, for one leftover.
;
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

; Custom hooks for the generated NSIS installer.
;
; Two hooks, for two reasons a generated script cannot see.

; ---------------------------------------------------------------------
; The shortcut's name.
;
; The product is written in lower case everywhere it is a name the
; product owns: the bundle file, the registry entry, the settings file,
; the window title. A shortcut is different — Windows shows it in the
; Start menu, the app list and on the desktop, beside things like
; "Steam" and "Notepad", and it sorts them by name. Every desktop
; application there leads with a capital letter; a lower-case entry
; reads as something installed by accident.
;
; So the shortcuts alone are capitalised. The product name is not
; changed to achieve it: that would rename the bundle, the registry
; entry and the data directory as well, and the lower-case spelling is
; the product's own.
;
; The installer writes three shortcuts and knows them only by the
; product name, so each is recreated under the capitalised name and the
; original is deleted. A Start menu entry's name is the file's name,
; which is why this is a recreate rather than a rename.
;
; Declared rather than retyped, so this keeps following the product
; name if it ever changes.
!define SHORTCUT_NAME "Whisperlane"
!define SHORTCUT_TARGET "$INSTDIR\${PRODUCTNAME}.exe"

!macro NSIS_HOOK_POSTINSTALL
  Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "${SHORTCUT_TARGET}"

  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "${SHORTCUT_TARGET}"

  Delete "$COMMON_DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortCut "$COMMON_DESKTOP\${SHORTCUT_NAME}.lnk" "${SHORTCUT_TARGET}"
!macroend

; ---------------------------------------------------------------------
; The leftover.
;
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

!macro NSIS_HOOK_PREUNINSTALL
  ; The renamed shortcuts have to go here. The installer removes the
  ; ones it knows the name of, and these are not those — so without this
  ; they survive every uninstall, pointing at a program that is no
  ; longer installed.
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$COMMON_DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$INSTDIR\Uninstall ${PRODUCTNAME}.lnk"
!macroend