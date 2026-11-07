# Fetches the transcription runtimes and stages them for the bundle.
#
# Neither engine is ours and neither is built here: they are published by
# their own repositories, pinned by tag and reviewed digest, because a
# runtime that only exists on the machine that happened to build it is not
# a runtime an installer can ship.
#
# Two families travel together:
#   - whisper.cpp with the Vulkan backend (the default Whisper models)
#   - transcribe.cpp with the Vulkan backend (multilingual families,
#     Qwen3-ASR first)
#
# Each family has its own staged directory and its own marker, so the
# application can keep one pointer and one pruning rule per family and an
# upgrade of one cannot disturb the other.
#
# The pins are exact on purpose. A build that fetches "latest" produces a
# different installer on a different day, and a transcription engine is
# the one component where a surprise is a wrong answer rather than a crash.
#
# Usage: fetch-runtime.ps1 [-Force]

[CmdletBinding()]
param(
  # Skip a download when its staged files are already present. Use -Force
  # after changing a pin.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Get-FileHash is a module cmdlet, and the CI runner disables module
# auto-loading. The helper below is plain .NET and works under both
# Windows PowerShell 5.1 and pwsh without that preference.
. (Join-Path $PSScriptRoot 'sha256.ps1')

# --- the pins --------------------------------------------------------------
# Two names per family, because the publishing workflows use two. The tag
# is the URL, the asset is the file; both have to be right.
#
# The whisper pin ships whisper.cpp v1.9.5 as two static executables. The
# transcribe pin ships transcribe.cpp at revision 2778ae4 with the portable
# AVX2 baseline. Changing either name or digest is a deliberate act, not a
# version bump.
$whisper = @{
  Tag    = 'engine-vulkan-b5454-static'
  Asset  = 'whisper-vulkan-win-x64-v1.9.5.zip'
  Url    = 'https://github.com/fahrim/whisper-vulkan-win/releases/download'
  # Digest of the pinned archive, reviewed here rather than trusted from
  # the release page: a published checksum can be edited after the fact,
  # this line is read.
  Sha    = '105b03c51d38583b333c7f116c5c12e8ce72c443f3a614204425f617e9ecbdde'
  Stage  = '..\apps\desktop\src-tauri\runtime'
  Marker = '..\apps\desktop\src-tauri\runtime.pin'
  Files  = @('whisper-server.exe', 'whisper-server-cpu.exe', 'vcomp140.dll')
}

$transcribe = @{
  Tag    = 'engine-transcribe-2778ae4-static'
  Asset  = 'transcribe-vulkan-win-x64-2778ae4.zip'
  Url    = 'https://github.com/fahrim/transcribe-vulkan-win/releases/download'
  Sha    = 'a35ef6797160eabe47a335503bf081c90561ba7995d8620932ca7708980ad3c0'
  Stage  = '..\apps\desktop\src-tauri\runtime-transcribe'
  Marker = '..\apps\desktop\src-tauri\runtime-transcribe.pin'
  Files  = @('transcribe-server.exe', 'transcribe-server-cpu.exe')
}

$cache = Join-Path $env:TEMP 'whisperlane-runtime'

function Say([string]$m) { Write-Host "[runtime] $m" }

# Stages one pinned archive. The marker records both the tag and the
# digest of the archive that produced the staged files; checking the tag
# alone would let a changed digest ship the old archive's bytes, which is
# the one thing a pin exists to prevent.
function Stage-Runtime($pin) {
  $stage = Join-Path $PSScriptRoot $pin.Stage
  $marker = Join-Path $PSScriptRoot $pin.Marker

  $markerTag = $null
  $markerSha = $null
  if (Test-Path $marker) {
    $parts = @((Get-Content $marker -Raw).Trim() -split '\s+')
    if ($parts.Count -ge 1) { $markerTag = $parts[0] }
    if ($parts.Count -ge 2) { $markerSha = $parts[1].ToLower() }
  }

  if (-not $Force -and $markerTag) {
    $complete = $true
    foreach ($name in $pin.Files) {
      if (-not (Test-Path (Join-Path $stage $name))) { $complete = $false }
    }
    $digestMatches = (-not $pin.Sha) -or ($markerSha -eq $pin.Sha.ToLower())
    if ($markerTag -eq $pin.Tag -and $digestMatches -and $complete) {
      Say "already staged: $($pin.Tag)"
      return
    }
    if ($markerTag -ne $pin.Tag) {
      Say "staged runtime is $markerTag, pin is $($pin.Tag) - refetching"
    } elseif (-not $digestMatches) {
      Say "staged runtime digest is not the pinned digest - refetching"
    } else {
      Say "staged runtime is incomplete - refetching"
    }
  }

  $runtimeUrl = "$($pin.Url)/$($pin.Tag)/$($pin.Asset)"
  $sumsUrl = "$($pin.Url)/$($pin.Tag)/SHA256SUMS.txt"
  $zip = Join-Path $cache $pin.Asset
  $sums = Join-Path $cache "SHA256SUMS-$($pin.Tag).txt"

  Say "fetching $runtimeUrl"
  Invoke-WebRequest -Uri $runtimeUrl -OutFile $zip -UseBasicParsing
  Invoke-WebRequest -Uri $sumsUrl -OutFile $sums -UseBasicParsing

  # Against the release's own checksum first, so a corrupt download is
  # caught even when no expected hash has been pinned yet.
  $published = $null
  foreach ($line in Get-Content $sums) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?([A-Za-z0-9._-]+)') {
      if ($Matches[2] -eq $pin.Asset) { $published = $Matches[1].ToLower() }
    }
  }
  if (-not $published) {
    Say "no checksum for $($pin.Asset) in the release's SHA256SUMS.txt"
    exit 1
  }

  $actual = Get-Sha256 $zip
  if ($actual -ne $published) {
    Say "checksum mismatch: got $actual, release says $published"
    exit 1
  }
  Say "checksum matches the release ($($actual.Substring(0, 16))...)"

  # The pinned hash is the stronger statement of the two: the release page
  # can be edited after the fact, this file is reviewed.
  if ($pin.Sha -and $actual -ne $pin.Sha.ToLower()) {
    Say "checksum does not match the pinned value"
    Say "  got      $actual"
    Say "  expected $($pin.Sha.ToLower())"
    exit 1
  }

  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)

  # Flatten. An archive built by archiving a build directory keeps that
  # directory, and the bundle wants the engine's files beside each other:
  # it loads its libraries by relative path from its own folder.
  $loose = Get-ChildItem $stage -File
  if ($loose.Count -eq 0) {
    $inner = @(Get-ChildItem $stage -Directory)
    if ($inner.Count -eq 1) {
      Get-ChildItem $inner[0].FullName -File | ForEach-Object {
        Move-Item $_.FullName (Join-Path $stage $_.Name) -Force
      }
      Remove-Item $inner[0].FullName -Recurse -Force
    }
  }

  $missing = $pin.Files | Where-Object { -not (Test-Path (Join-Path $stage $_)) }
  if ($missing) {
    Say "archive is missing: $($missing -join ', ')"
    exit 1
  }

  $bytes = (Get-ChildItem $stage -File | Measure-Object Length -Sum).Sum
  Set-Content -Path $marker -Value "$($pin.Tag) $actual" -NoNewline
  Say ("staged {0} files, {1:N1} MB, pin {2}" -f $pin.Files.Count, ($bytes / 1MB), $pin.Tag)
  Say "sha256 $actual"
}

New-Item -ItemType Directory -Force -Path $cache | Out-Null
Stage-Runtime $whisper
Stage-Runtime $transcribe
