# Clicks the pill's settings control at a known point and reports what
# happened. Development probe only; it needs the pointer left alone.
param(
  [string]$Out = "$env:TEMP\pill-settings-click.png",
  [int]$ScreenW = 2560,
  [int]$ScreenH = 1440,
  [int]$RestingMargin = 48,
  [int]$PillHeight = 56
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Probe {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  const uint KEYUP = 0x0002, LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  public static void ChordDown() { keybd_event(0xA2,0,0,UIntPtr.Zero); keybd_event(0xA0,0,0,UIntPtr.Zero); keybd_event(0x20,0,0,UIntPtr.Zero); }
  public static void ChordUp() { keybd_event(0xA0,0,KEYUP,UIntPtr.Zero); keybd_event(0x20,0,KEYUP,UIntPtr.Zero); keybd_event(0xA2,0,KEYUP,UIntPtr.Zero); }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click() { mouse_event(LEFTDOWN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(LEFTUP,0,0,0,UIntPtr.Zero); }
}
"@

function Save-Shot([string]$path) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

[Probe]::ChordDown()
Start-Sleep -Milliseconds 2500
[Probe]::ChordUp()
Start-Sleep -Milliseconds 300

# The pill stays up in its finished state. Its three-dot control sits at
# the pill's right end, just inside the padding.
$pillCentreX = [int]($ScreenW / 2)
$pillCentreY = [int]($ScreenH - $RestingMargin - $PillHeight / 2)
$dotsX = [int]($pillCentreX + 460/2 - 10 - 38/2)
$dotsY = $pillCentreY

[Probe]::Move($dotsX, $dotsY)
Start-Sleep -Milliseconds 500
[Probe]::Click()
Start-Sleep -Milliseconds 900
Save-Shot $Out
Write-Host "clicked at ($dotsX,$dotsY); shot: $Out"