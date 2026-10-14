# Holds the dictation chord so the pill's material can be captured
# during development. Verification aid only, not part of the product.
param([int]$HoldMs = 2500, [string]$Out = "$env:TEMP\pill-shot.png")

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# keybd_event rather than SendInput: SendInput needs a correctly sized
# INPUT structure, and a hand-rolled one that disagrees with the
# platform's is silently rejected, which looks exactly like a hook that
# never fires.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Chord {
  [DllImport("user32.dll")]
  static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  const uint KEYUP = 0x0002;
  static void Key(byte vk, bool up) {
    keybd_event(vk, 0, up ? KEYUP : 0, UIntPtr.Zero);
  }
  public static void Down() { Key(0xA2, false); Key(0xA0, false); Key(0x20, false); }
  public static void Up() { Key(0xA0, true); Key(0x20, true); Key(0xA2, true); }
}
"@

# Press the chord down, let the pill sit in its recording state, then
# release so the take is delivered the way a real one would be.
[Chord]::Down()
Start-Sleep -Milliseconds $HoldMs

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()

[Chord]::Up()
Write-Host "shot: $Out"