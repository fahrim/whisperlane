# Whisperlane NSIS install cleanup for Windows.
#
# Run as the same Windows user that uses Whisperlane. Do not use
# "Run as administrator" unless the installer was per-machine; an elevated
# process can point %APPDATA% at a different profile.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File clean-windows-install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File clean-windows-install.ps1 -DryRun
#   powershell -NoProfile -ExecutionPolicy Bypass -File clean-windows-install.ps1 -KeepModels
#
# The default removes models and settings too. -KeepModels keeps
# %APPDATA%\com.whisperlane.desktop\models and settings.json.

[CmdletBinding()]
param(
    [switch]$KeepModels,
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Continue'
$script:removed = 0
$script:skipped = 0

function Write-Step([string]$Message) {
    Write-Host "[clean] $Message"
}

function Remove-Tree([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if ($DryRun) {
        Write-Step "would remove $Path"
        return
    }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        Write-Step "removed $Path"
        $script:removed++
    } catch {
        Write-Warning "could not remove ${Path}: $($_.Exception.Message)"
        $script:skipped++
    }
}

function Remove-OneFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if ($DryRun) {
        Write-Step "would remove $Path"
        return
    }
    try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        Write-Step "removed $Path"
        $script:removed++
    } catch {
        Write-Warning "could not remove ${Path}: $($_.Exception.Message)"
        $script:skipped++
    }
}

function Remove-RunValue([string]$Name) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $value = Get-ItemProperty -Path $key -Name $Name -ErrorAction SilentlyContinue
    if (-not $value) { return }
    if ($DryRun) {
        Write-Step "would remove autostart value $Name"
        return
    }
    Remove-ItemProperty -Path $key -Name $Name -Force -ErrorAction SilentlyContinue
    Write-Step "removed autostart value $Name"
}

Write-Host ''
Write-Host 'Whisperlane cleanup (NSIS installer)'
Write-Host '--------------------------------------'
Write-Host 'This stops Whisperlane and its speech engines.'
if ($KeepModels) {
    Write-Host 'Models and settings are kept; runtime, logs and WebView2 data are removed.'
} else {
    Write-Host 'Models, settings, runtime, logs and WebView2 data will be removed.'
}
Write-Host 'Run this as the same Windows user that uses Whisperlane.'
Write-Host ''

if ($DryRun) {
    Write-Host 'DRY RUN: nothing will be changed.'
} elseif (-not $Force) {
    $answer = Read-Host 'Type CLEAN to continue'
    if ($answer -cne 'CLEAN') {
        Write-Host 'Cancelled.'
        exit 0
    }
}

# 1. Stop the app and the engines it may have left running.
foreach ($name in @('whisperlane', 'whisper-server', 'whisper-server-cpu')) {
    $processes = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
        if ($DryRun) {
            Write-Step "would stop $($process.ProcessName) (PID $($process.Id))"
            continue
        }
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            Write-Step "stopped $($process.ProcessName) (PID $($process.Id))"
        } catch {
            Write-Warning "could not stop $($process.ProcessName) (PID $($process.Id)): $($_.Exception.Message)"
        }
    }
}
if (-not $DryRun) { Start-Sleep -Milliseconds 500 }

# 2. Find the NSIS uninstaller through the registry and the usual paths.
$keys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'whisperlane' }

$dirs = @()
foreach ($entry in $entries) {
    if ($entry.InstallLocation) { $dirs += $entry.InstallLocation }
}
$dirs += @(
    "$env:LOCALAPPDATA\Programs\whisperlane",
    "$env:ProgramFiles\Whisperlane",
    "${env:ProgramFiles(x86)}\Whisperlane"
)
$dirs = $dirs |
    ForEach-Object { if ($_ -is [string]) { $_.Trim().Trim('"') } } |
    Where-Object { $_ } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'uninstall.exe') } |
    Select-Object -Unique

if (-not $dirs) {
    Write-Step 'no NSIS uninstaller found; removing app data and leftovers only'
}

foreach ($dir in $dirs) {
    $uninstaller = Join-Path $dir 'uninstall.exe'
    if ($DryRun) {
        Write-Step "would run $uninstaller /S"
        continue
    }
    Write-Step "running $uninstaller /S"
    try {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            Write-Warning "uninstaller exited with $($process.ExitCode)"
        }
    } catch {
        Write-Warning "could not run ${uninstaller}: $($_.Exception.Message)"
    }
    # NSIS uninstallers sometimes copy themselves to a temporary folder and
    # return before the removal has finished. Give the directory a moment.
    for ($i = 0; $i -lt 15; $i++) {
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'uninstall.exe'))) { break }
        Start-Sleep -Seconds 1
    }
}

# 3. Remove whatever the uninstaller left in the install tree.
foreach ($dir in $dirs) {
    Remove-Tree $dir
}

# 4. App data. The runtime is always removed; models and settings only
#    when the caller did not ask to keep them.
$appData = Join-Path $env:APPDATA 'com.whisperlane.desktop'
$oldAppData = Join-Path $env:APPDATA 'com.whisperlane.app'
$localAppData = Join-Path $env:LOCALAPPDATA 'com.whisperlane.desktop'

if ($KeepModels) {
    Remove-Tree (Join-Path $appData 'runtime')
    Remove-Tree (Join-Path $appData 'runtime-transcribe')
    Remove-Tree (Join-Path $appData 'logs')
    Remove-Tree (Join-Path $oldAppData 'runtime')
    Remove-Tree $localAppData
} else {
    Remove-Tree $appData
    Remove-Tree $oldAppData
    Remove-Tree $localAppData
}

# 5. Start menu and desktop shortcuts.
Remove-OneFile (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Whisperlane.lnk')
Remove-OneFile (Join-Path $env:USERPROFILE 'Desktop\Whisperlane.lnk')

# 6. The autostart value, if the app registered one.
Remove-RunValue 'whisperlane'
Remove-RunValue 'Whisperlane'

Write-Host ''
Write-Host 'Cleanup finished.'
Write-Host "Removed entries: $script:removed"
if ($script:skipped -gt 0) {
    Write-Host "Entries that could not be removed: $script:skipped"
    Write-Host 'Close any Whisperlane window or engine process and run the script again.'
}
Write-Host ''
Write-Host 'Next: install Whisperlane 0.8.4 from:'
Write-Host 'https://github.com/fahrim/whisperlane/releases/tag/v0.8.4'
Write-Host ''
Write-Host 'If Windows Settings still lists Whisperlane, remove it from Settings > Apps.'
