$ErrorActionPreference = "Stop"

$projectRoot = "C:\Users\Admin\hirex-sales-agent"
$statePath = Join-Path $projectRoot "runtime\deplao-supervisor-state.json"
$lockPath = Join-Path $projectRoot "runtime\deplao-supervisor.lock"
$logPath = Join-Path $projectRoot "runtime\deplao-watchdog.log"
$mainTaskName = "HireX Deplao Realtime Supervisor"
$requiredPorts = @(18788, 18789, 18790)
$heartbeatMaxAgeSeconds = 45

function Write-WatchdogLog([string]$eventName, [hashtable]$fields = @{}) {
  $record = @{ at = [DateTime]::UtcNow.ToString("o"); event = $eventName }
  foreach ($entry in $fields.GetEnumerator()) { $record[$entry.Key] = $entry.Value }
  Add-Content -LiteralPath $logPath -Value ($record | ConvertTo-Json -Compress)
}

function Get-SupervisorProcess([int]$processId) {
  if ($processId -le 0) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.Name -ne "node.exe" -or $process.CommandLine -notmatch "deplao-realtime-supervisor\.mjs") { return $null }
  return $process
}

try {
  $state = $null
  if (Test-Path -LiteralPath $statePath) {
    try { $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $state = $null }
  }

  $supervisorPid = 0
  if ($null -ne $state -and $null -ne $state.pid) { $supervisorPid = [int]$state.pid }
  elseif (Test-Path -LiteralPath $lockPath) { $supervisorPid = [int](Get-Content -LiteralPath $lockPath -Raw) }

  $supervisor = Get-SupervisorProcess $supervisorPid
  $heartbeatFresh = $false
  if ($null -ne $state -and $null -ne $state.at) {
    $heartbeatAge = ([DateTime]::UtcNow - [DateTime]::Parse($state.at).ToUniversalTime()).TotalSeconds
    $heartbeatFresh = $heartbeatAge -ge 0 -and $heartbeatAge -le $heartbeatMaxAgeSeconds
  }
  $openPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0", "::") -and $_.LocalPort -in $requiredPorts } | Select-Object -ExpandProperty LocalPort -Unique)
  $allPortsOpen = @($requiredPorts | Where-Object { $_ -notin $openPorts }).Count -eq 0

  if ($null -ne $supervisor -and $heartbeatFresh) {
    if (-not $allPortsOpen) { Write-WatchdogLog "RUNTIME_RECOVERING" @{ pid = $supervisorPid; openPorts = ($openPorts -join ",") } }
    exit 0
  }

  if ($null -ne $supervisor) {
    Write-WatchdogLog "STALE_SUPERVISOR_TERMINATED" @{ pid = $supervisorPid }
    & taskkill.exe /PID $supervisorPid /T /F | Out-Null
    Start-Sleep -Seconds 2
  }

  Write-WatchdogLog "SUPERVISOR_START_REQUESTED" @{ previousPid = $supervisorPid }
  & schtasks.exe /Run /TN $mainTaskName | Out-Null
} catch {
  Write-WatchdogLog "WATCHDOG_FAILED" @{ error = $_.Exception.GetType().Name }
  exit 1
}
