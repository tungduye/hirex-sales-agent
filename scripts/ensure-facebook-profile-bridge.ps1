$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$statusPath = Join-Path $root "runtime\facebook-profile-bridge\sync-status.json"
$healthy = $false

try {
  $listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3101 -State Listen -ErrorAction Stop | Select-Object -First 1
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
  $ageSeconds = ((Get-Date).ToUniversalTime() - [DateTime]::Parse($status.checkedAt).ToUniversalTime()).TotalSeconds
  $healthy = $process.CommandLine -like "*facebook-profile-bridge.mjs*" -and $ageSeconds -lt 120
} catch { $healthy = $false }

if ($healthy) { exit 0 }

Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*facebook-profile-bridge.mjs*" } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
schtasks.exe /Run /TN "HireX Facebook Profile Bridge" | Out-Null
