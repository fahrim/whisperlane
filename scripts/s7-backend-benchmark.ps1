# S7 live check: launches whisper-server on each backend in turn and
# times the same take, so "accelerated" is a measurement rather than a
# claim. Vulkan is the AMD and Intel path; CPU is the fallback.
#
# Usage: pwsh -File scripts/s7-backend-benchmark.ps1 [-Wav <path>] [-Repetitions 3]

param(
  [string]$Wav = "$env:TEMP\jfk.wav",
  [int]$Repetitions = 3,
  [int]$ModelPort = 8821
)

$ErrorActionPreference = "Stop"

$runtime = "$env:APPDATA\com.whisperlane.app\runtime"
$model = "$env:APPDATA\com.whisperlane.app\models\ggml-large-v3-turbo-q5_0.bin"
$server = Join-Path $runtime "whisper-server.exe"

if (-not (Test-Path $server)) { throw "runtime missing: $server" }
if (-not (Test-Path $model)) { throw "model missing: $model" }
if (-not (Test-Path $Wav)) { throw "take missing: $Wav" }

function Stop-Server {
  param($Child)
  if ($Child -and -not $Child.HasExited) {
    $Child.Kill() | Out-Null
    $Child.WaitForExit(5000) | Out-Null
  }
}

# A backend is proven by launching it and seeing it answer, never by a
# file being present: that is the whole point of this check.
function Measure-Backend {
  param(
    [string]$Name,
    [string[]]$ExtraArgs,
    [int]$Port
  )

  Write-Host ""
  Write-Host "=== $Name ==="

  $stderr = [IO.Path]::GetTempFileName()
  $stdout = [IO.Path]::GetTempFileName()
  # One command line string: this binary's loader rejects a quoted
  # argument list on some PowerShell versions and prints its usage
  # instead of starting, which looks exactly like a missing backend.
  $argLine = "--model `"$model`" --host 127.0.0.1 --port $Port"
  if ($ExtraArgs.Count -gt 0) { $argLine += " $($ExtraArgs -join ' ')" }

  $child = Start-Process -FilePath $server `
    -ArgumentList $argLine `
    -WorkingDirectory $runtime `
    -RedirectStandardError $stderr `
    -RedirectStandardOutput $stdout `
    -PassThru -NoNewWindow

  # Startup includes model load, so it is reported apart from inference:
  # the product pays it once per idle period, not per take.
  $ready = $false
  $loadMs = 0
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 180) {
    if ($child.HasExited) { break }
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2 -UseBasicParsing | Out-Null
      $ready = $true
      $loadMs = $sw.ElapsedMilliseconds
      break
    } catch { Start-Sleep -Milliseconds 500 }
  }

  if (-not $ready) {
    Write-Host "  NOT READY — backend unavailable on this machine"
    Write-Host "  --- server said ---"
    Get-Content $stderr -Tail 12 | ForEach-Object { Write-Host "  $_" }
    Stop-Server $child
    Remove-Item $stderr, $stdout -Force
    return [pscustomobject]@{ Backend = $Name; Ready = $false; LoadMs = 0; Runs = @() }
  }

  $log = Get-Content $stderr -Raw
  if ($log -match "ggml_vulkan: Found (\d+) Vulkan devices") {
    Write-Host "  ggml_vulkan: Found $($Matches[1]) Vulkan devices"
  }
  if ($log -match "(AMD Radeon|NVIDIA|Intel|Arc|Radeon)[^\r\n]*") {
    Write-Host "  device: $($Matches[0].Trim())"
  }
  # The backend the engine actually loaded, read from the server's own
  # banner rather than inferred from which flag was passed.
  if ($log -match "load_backend\s*=\s*(\w+)" -or $log -match "ggml_backend_init: (\w+)") {
    Write-Host "  backend loaded: $($Matches[1])"
  }

  $runs = @()
  for ($i = 0; $i -lt $Repetitions; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $body = & curl.exe -s -X POST "http://127.0.0.1:$Port/inference" `
      -F "file=@$Wav;type=audio/wav" -F "response_format=json" -F "language=en"
    $sw.Stop()
    $text = ($body | ConvertFrom-Json).text
    $runs += $sw.ElapsedMilliseconds
    Write-Host ("  run {0}: {1} ms" -f ($i + 1), $sw.ElapsedMilliseconds)
  }
  Write-Host "  text: $text"

  Stop-Server $child
  Remove-Item $stderr, $stdout -Force
  
  $sorted = $runs | Sort-Object
  $median = $sorted[[int][Math]::Floor($sorted.Count / 2)]
  Write-Host "  median: $median ms"
  return [pscustomobject]@{ Backend = $Name; Ready = $true; LoadMs = $loadMs; Runs = $runs; MedianMs = $median }
}

Write-Host "take: $Wav ($([math]::Round((Get-Item $Wav).Length/1KB)) KB, $Repetitions repetitions)"

# CPU first: it is the fallback every machine has, so the comparison
# baseline exists even where the accelerated path does not run.
# This whisper-server build enables the GPU by default, so the two runs
# differ only in that flag: no `-ng` is the accelerated path, `-ng` is
# the CPU fallback.
$cpu = Measure-Backend -Name "cpu" -ExtraArgs @("-ng") -Port $ModelPort
$vulkan = Measure-Backend -Name "vulkan" -ExtraArgs @() -Port ($ModelPort + 1)

Write-Host ""
Write-Host "=== summary ==="
foreach ($r in @($cpu, $vulkan)) {
  if ($r.Ready) {
    Write-Host ("  {0,-8} load {1,6} ms   median {2,6} ms" -f $r.Backend, $r.LoadMs, $r.MedianMs)
  } else {
    Write-Host ("  {0,-8} unavailable on this machine" -f $r.Backend)
  }
}

if ($cpu.Ready -and $vulkan.Ready -and $cpu.MedianMs -gt 0) {
  $speedup = [math]::Round($cpu.MedianMs / $vulkan.MedianMs, 2)
  Write-Host ""
  Write-Host "  vulkan is ${speedup}x the cpu time (higher is faster)"
  if ($speedup -ge 1.5) {
    Write-Host "  MEANINGFULLY_FASTER=yes"
  } else {
    Write-Host "  MEANINGFULLY_FASTER=no"
  }
}