# Rounds the corners of a square, fully opaque icon and makes everything
# outside the curve transparent.
#
# Why this is needed: the brand kit's app icon is a fully opaque square.
# Its corners are not rounded and carry no alpha, so "round the glass"
# means adding the shape rather than preserving one. Only the corners
# change: the plate, the rim highlight and the gradient are copied
# through untouched, because those are the design.
#
# The mask is computed per pixel from the rounded rectangle's signed
# distance rather than by erasing with a composited path. Distance gives
# a true one-pixel ramp at the curve instead of a stepped edge, and it
# needs no alpha compositing, which is not dependable from PowerShell.
#
# Usage: make-rounded-icon.ps1 -Source <png> -Out <png> [-Radius 0.20]

param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Out,
  # Corner radius as a fraction of the image width. 0.20 is roughly what
  # the kit's own presentation uses.
  [double]$Radius = 0.20
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# The compiler needs the drawing assembly by reference, not merely loaded:
# Add-Type's default reference set does not include it, and naming the
# loaded assembly's own location is what resolves it in either shell.
$drawingRef = [System.Drawing.Bitmap].Assembly.Location
Add-Type -ReferencedAssemblies $drawingRef -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;

public static class RoundedIcon {
  public static void Write(string source, string outPath, double radiusFraction) {
    using (Image src = Image.FromFile(source))
    using (Bitmap bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb))
    {
      float r = (float)(src.Width * radiusFraction);
      using (Graphics g = Graphics.FromImage(bmp))
      using (Bitmap flat = new Bitmap(src))
      {
        g.DrawImage(flat, 0, 0, src.Width, src.Height);
      }

      Rectangle r0 = new Rectangle(0, 0, src.Width, src.Height);
      BitmapData data = bmp.LockBits(r0, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int stride = data.Stride;
      System.IntPtr scan = data.Scan0;

      for (int y = 0; y < src.Height; y++) {
        System.IntPtr row = System.IntPtr.Add(scan, y * stride);
        for (int x = 0; x < src.Width; x++) {
          // Signed distance to the rounded rectangle. Negative inside,
          // positive outside, zero on the curve.
          float qx = Math.Abs(x + 0.5f - src.Width / 2f) - (src.Width / 2f - r);
          float qy = Math.Abs(y + 0.5f - src.Height / 2f) - (src.Height / 2f - r);
          float ox = Math.Max(qx, 0f), oy = Math.Max(qy, 0f);
          float dist = (float)Math.Sqrt(ox * ox + oy * oy) + Math.Min(Math.Max(qx, qy), 0f) - r;

          // Half a pixel of ramp either side of the curve, which is what
          // antialiases the corner. Outside the curve the cover is zero,
          // so those pixels are dropped rather than left as they were.
          float cover = 0.5f - dist;
          if (cover < 0f) cover = 0f;
          if (cover > 1f) cover = 1f;

          System.IntPtr p = System.IntPtr.Add(row, x * 4);
          byte alpha = System.Runtime.InteropServices.Marshal.ReadByte(p, 3);
          int a = (int)(alpha * cover);
          System.Runtime.InteropServices.Marshal.WriteByte(p, 3, (byte)a);
        }
      }
      bmp.UnlockBits(data);
      bmp.Save(outPath, ImageFormat.Png);
    }
  }
}
'@

[RoundedIcon]::Write((Resolve-Path $Source).Path, $Out, $Radius)

$check = [System.Drawing.Image]::FromFile($Out)
"wrote $Out  $($check.Width)x$($check.Height)  radius=$([int]($check.Width * $Radius)) px"
$check.Dispose()