# S4 live check: posts a synthetic take to whisper-server and times it.
# Usage: pwsh -File scripts/s4-live-check.ps1 [-Port 8811]
param([int]$Port = 8811)

$ErrorActionPreference = "Stop"
$wav = Join-Path $env:TEMP "whisperlane-s4-sine.wav"

# 2 s 440 Hz sine, 16 kHz mono 16-bit.
$rate = 16000; $n = $rate * 2
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $bw.Write(36 + $n * 2)
$bw.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt ")); $bw.Write(16); $bw.Write([int16]1)
$bw.Write([int16]1); $bw.Write($rate); $bw.Write($rate * 2); $bw.Write([int16]2); $bw.Write([int16]16)
$bw.Write([Text.Encoding]::ASCII.GetBytes("data")); $bw.Write($n * 2)
for ($i = 0; $i -lt $n; $i++) {
  $bw.Write([int16]([Math]::Sin(2 * [Math]::PI * 440 * $i / $rate) * 12000))
}
[IO.File]::WriteAllBytes($wav, $ms.ToArray())

$sw = [Diagnostics.Stopwatch]::StartNew()
& curl.exe -s -X POST "http://127.0.0.1:$Port/inference" `
  -F "file=@$wav;type=audio/wav" -F "response_format=json" -F "language=tr"
$sw.Stop()
Write-Host ""
Write-Host "INFERENCE_MS=$($sw.ElapsedMilliseconds)"
Remove-Item $wav -Force
