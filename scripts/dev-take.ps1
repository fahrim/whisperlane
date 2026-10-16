# Holds the dictation chord for a fixed number of seconds, so a take
# starts and stops without anyone having to be at the keyboard.
#
# A take with nothing said in it fails, which is a property of dictation
# rather than a fault: the engine needs speech to transcribe. For an
# end-to-end check, speak while this runs.
#
# Usage: dev-take.ps1 [-Seconds 5]

param(
  # How long the chord is held. The engine loads a few hundred megabytes
  # before it answers, so a take shorter than the load reports nothing.
  [ValidateRange(1, 60)][int]$Seconds = 5
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Chord {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  const uint UP = 0x0002;
  static void Send(bool down) {
    uint f = down ? 0u : UP;
    keybd_event(0xA2, 0, f, IntPtr.Zero);  // LCTRL
    keybd_event(0xA0, 0, f, IntPtr.Zero);  // LSHIFT
    keybd_event(0x20, 0, f, IntPtr.Zero);  // SPACE
  }
  public static void Down() { Send(true); }
  public static void Up() { Send(false); }
}
"@

"holding the chord for $Seconds s"
[Chord]::Down()
Start-Sleep -Seconds $Seconds
[Chord]::Up()
"released"

# Give the transcription a moment, then report what the engine did.
Start-Sleep -Seconds 6

$server = @(Get-Process whisper-server -ErrorAction SilentlyContinue)
"engine processes : $($server.Count)"
foreach ($p in $server) {
  "  pid $($p.Id)  $([math]::Round($p.WorkingSet64 / 1MB)) MB"
}
$listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -in $server.Id })
"listening ports  : $(($listen | ForEach-Object { $_.LocalPort }) -join ', ')"