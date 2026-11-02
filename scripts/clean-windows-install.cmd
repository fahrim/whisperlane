@echo off
setlocal
title Whisperlane cleanup

echo.
echo Whisperlane cleanup
echo -------------------
echo This window runs the PowerShell cleanup script next to it.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean-windows-install.ps1" %*

echo.
echo The window can be closed now.
pause
