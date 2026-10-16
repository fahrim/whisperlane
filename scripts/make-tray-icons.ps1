# Cuts a brand-kit status image down to something a tray can show.
#
# Why not just resize: the status artwork is 512px square with the mark
# floating in the middle of it. Resized as-is, the mark lands in about
# half of a 32px icon and the state is a grey smudge. Trimming to the
# drawn pixels first and then fitting to the tray box is what makes the
# five states tell themselves apart at that size.
#
# Usage: make-tray-icons.ps1 [-Size 32] [-Out <dir>]

param(
  # Tray icons are drawn at 16 to 24 physical pixels, and Windows scales
  # them up on high-density displays, so this is the source size rather
  # than a final size.
  [int]$Size = 32,
  # Fraction of the box the mark may fill. The rest is the breathing room
  # that keeps a wave from looking like it is falling off the edge.
  [double]$Fill = 0.88,
  [string]$Out = "$PSScriptRoot\..\apps\desktop\src-tauri\icons\status"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = "$PSScriptRoot\..\brand-kit\03_Status_States"
$states = @('idle', 'listening-active', 'processing', 'muted', 'error')
New-Item -ItemType Directory -Force -Path $Out | Out-Null

foreach ($state in $states) {
  $path = Join-Path $source "whisperlane-status-$state.png"
  $src = New-Object System.Drawing.Bitmap $path

  # Bounding box of what was actually drawn. Anything below a whisper of
  # alpha is treated as empty so a soft glow does not drag the box out.
  $minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $src.Height; $y += 2) {
    for ($x = 0; $x -lt $src.Width; $x += 2) {
      if ($src.GetPixel($x, $y).A -lt 8) { continue }
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
  if ($maxX -lt 0) { throw "$state has nothing drawn in it" }

  $w = $maxX - $minX + 1
  $h = $maxY - $minY + 1
  $scale = ($Size * $Fill) / [math]::Max($w, $h)
  $dw = [int][math]::Round($w * $scale)
  $dh = [int][math]::Round($h * $scale)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage(
    $src,
    (New-Object System.Drawing.Rectangle ([int](($Size - $dw) / 2)), ([int](($Size - $dh) / 2)), $dw, $dh),
    (New-Object System.Drawing.Rectangle $minX, $minY, $w, $h),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $g.Dispose()
  $src.Dispose()

  $dest = Join-Path $Out "tray-$state.png"
  $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "  $state -> $([System.IO.Path]::GetFileName($dest))  trimmed ${w}x${h}, drawn ${dw}x${dh} in ${Size}x${Size}"
}