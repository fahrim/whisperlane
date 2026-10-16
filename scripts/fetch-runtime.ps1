# Fetches the transcription runtime and stages it for the bundle.
#
# The engine is not ours and is not built here: it is whisper.cpp
# compiled with the Vulkan backend by a separate repository, pinned by
# tag, because a runtime that only exists on the machine that happens to
# have built it is not a runtime an installer can ship.
#
# The pin is exact on purpose. A build that fetches "latest" produces a
# different installer on a different day, and a transcription engine is
# the one component where a surprise is a wrong answer rather than a
# crash.
#
# Usage: fetch-runtime.ps1 [-Force]

[CmdletBinding()]
param(
  # Skip the download when the staged files are already present. Use
  # -Force after changing the pin.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# --- the pin --------------------------------------------------------------
# Two names, because the publishing workflow uses two. The release is
# tagged for the whisper.cpp build it compiles, while the archive inside
# is named for the whisper.cpp release that build ships as. Both have to
# be right: the tag is the URL, the asset is the file.
#
# b5454 is the build that ships as v1.9.5. Changing either name is a
# deliberate act, not a version bump.
$RUNTIME_TAG = 'engine-vulkan-b5454'
$RUNTIME_ASSET = 'whisper-vulkan-win-x64-v1.9.5.zip'
$SHA_URL = 'https://github.com/fahrim/whisper-vulkan-win/releases/download'
$RUNTIME_URL = "$SHA_URL/$RUNTIME_TAG/$RUNTIME_ASSET"
# Digest of the pinned archive, reviewed here rather than trusted from
# the release page: a published checksum can be edited after the fact,
# this line is read. Change it only when the pin above changes.
$EXPECTED_SHA256 = '30cb637213e89f39c6e845a0659773c3768d8e47c404737f616a356d60ca6106'

$cache = Join-Path $env:TEMP 'whisperlane-runtime'
$stage = Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\runtime'
# The marker sits beside the directory, not inside it. Inside, the
# bundle's resource glob would ship it to every install.
$marker = Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\runtime.pin'

function Say([string]$m) { Write-Host "[runtime] $m" }

# --- already staged? -------------------------------------------------------
if (-not $Force -and (Test-Path $marker)) {
    $staged = (Get-Content $marker -Raw).Trim()
    if ($staged -eq $RUNTIME_TAG) {
        Say "already staged: $RUNTIME_TAG"
        exit 0
    }
    Say "staged runtime is $staged, pin is $RUNTIME_TAG — refetching"
}

New-Item -ItemType Directory -Force -Path $cache | Out-Null
$zip = Join-Path $cache $RUNTIME_ASSET
$sums = Join-Path $cache 'SHA256SUMS.txt'

# --- download --------------------------------------------------------------
Say "fetching $RUNTIME_URL"
Invoke-WebRequest -Uri $RUNTIME_URL -OutFile $zip -UseBasicParsing
Invoke-WebRequest -Uri "$SHA_URL/$RUNTIME_TAG/SHA256SUMS.txt" -OutFile $sums -UseBasicParsing

# --- verify ----------------------------------------------------------------
# Against the release's own checksum first, so a corrupt download is
# caught even when no expected hash has been pinned yet.
$published = $null
foreach ($line in Get-Content $sums) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?([A-Za-z0-9._-]+)') {
        if ($Matches[2] -eq $RUNTIME_ASSET) { $published = $Matches[1].ToLower() }
    }
}
if (-not $published) {
    Say "no checksum for $RUNTIME_ASSET in the release's SHA256SUMS.txt"
    exit 1
}

$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $published) {
    Say "checksum mismatch: got $actual, release says $published"
    exit 1
}
Say "checksum matches the release ($($actual.Substring(0,16))…)"

# The pinned hash is the stronger statement of the two: the release page
# can be edited after the fact, this file is reviewed.
if ($EXPECTED_SHA256 -and $actual -ne $EXPECTED_SHA256.ToLower()) {
    Say "checksum does not match the pinned value"
    Say "  got      $actual"
    Say "  expected $($EXPECTED_SHA256.ToLower())"
    exit 1
}

# --- stage -----------------------------------------------------------------
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

$wanted = @('whisper-server.exe', 'whisper-cli.exe', 'whisper.dll',
            'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-vulkan.dll')
$missing = $wanted | Where-Object { -not (Test-Path (Join-Path $stage $_)) }
if ($missing) {
    Say "archive is missing: $($missing -join ', ')"
    exit 1
}

$bytes = (Get-ChildItem $stage -File | Measure-Object Length -Sum).Sum
Set-Content -Path $marker -Value $RUNTIME_TAG -NoNewline
Say "staged $($wanted.Count) files, {0:N1} MB, pin $RUNTIME_TAG" -f ($bytes / 1MB)
Say "sha256 $actual"