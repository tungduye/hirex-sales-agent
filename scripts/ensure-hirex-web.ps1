$ErrorActionPreference = "Stop"
$workspace = "C:\Users\Admin\hirex-sales-agent"
$healthy = $false

# Deploys and restarts stop the web on purpose and write this flag first. Starting a second copy in
# that window (often from the old build) is what left a stale web serving pages without styles.
$maintenanceFlag = Join-Path $workspace "runtime\web-maintenance.flag"
if ((Test-Path -LiteralPath $maintenanceFlag) -and (Get-Item -LiteralPath $maintenanceFlag).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddMinutes(-30)) { exit 0 }

try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000/login" -TimeoutSec 8 -MaximumRedirection 0 -ErrorAction Stop
  $healthy = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ge 300 -and [int]$_.Exception.Response.StatusCode -lt 500) {
    $healthy = $true
  }
}

if ($healthy) { exit 0 }

$listener = netstat -ano | Select-String ':3000\s+.*LISTENING\s+(\d+)$' | Select-Object -First 1
if ($listener -and $listener.Matches.Count -gt 0) {
  $processId = [int]$listener.Matches[0].Groups[1].Value
  if ($processId -gt 0) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}

Start-Process -FilePath "C:\Program Files\nodejs\npm.cmd" -ArgumentList "run","start" `
  -WorkingDirectory $workspace `
  -RedirectStandardOutput (Join-Path $workspace ".next-start.stdout.log") `
  -RedirectStandardError (Join-Path $workspace ".next-start.stderr.log") `
  -WindowStyle Hidden
