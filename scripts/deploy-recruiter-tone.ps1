param([ValidatePattern('^[a-z0-9][a-z0-9-]{1,40}$')][string]$Release='recruiter-tone',[switch]$MigrateDatabase)
$ErrorActionPreference='Stop'
$root='C:\Users\Admin\hirex-sales-agent'
$source=(Resolve-Path -LiteralPath "$root\.next-$Release").Path
$current=(Resolve-Path -LiteralPath "$root\.next").Path
$backup="$root\.next-before-$Release"
if($source -ne "$root\.next-$Release" -or $current -ne "$root\.next" -or (Test-Path -LiteralPath $backup)){throw 'INVALID_DEPLOY_PATHS'}
if(-not(Test-Path -LiteralPath "$source\BUILD_ID")){throw 'BUILD_MISSING'}

# Every "next start" of this project (normally exactly one, started by the 'HireX Local App' task
# through scripts/start-production.mjs). A second copy can appear when the web is started by hand or
# by ensure-hirex-web.ps1; all copies must stop so the new build is the only one serving.
function Get-WebProcesses {
  @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'hirex-sales-agent\\node_modules\\next\\dist\\bin\\next"?\s+start' })
}
function Get-Port3000Owner {
  $line = netstat -ano | Select-String ':3000\s+\S+\s+LISTENING\s+(\d+)\s*$' | Select-Object -First 1
  if ($line) { return [int]$line.Matches[0].Groups[1].Value }
  return $null
}
function Show-Process($p) {
  $started = if ($p.CreationDate) { $p.CreationDate.ToString('yyyy-MM-dd HH:mm:ss') } else { '?' }
  Write-Output ("  PID {0}  parent {1}  started {2}  {3}" -f $p.ProcessId, $p.ParentProcessId, $started, $p.CommandLine)
}

$lock=$null
$deadline=[DateTime]::UtcNow.AddMinutes(35)
try {
  while(-not $lock -and [DateTime]::UtcNow -lt $deadline){
    try{$lock=[IO.File]::Open("$root\runtime\email-campaign-scheduler.lock",[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{Start-Sleep -Seconds 3}
  }
  if(-not $lock){throw 'ACTIVE_SEND_DEPLOY_NOT_STARTED'}

  $web = @(Get-WebProcesses)
  $owner = Get-Port3000Owner
  Write-Output "Web processes found: $($web.Count); port 3000 owner PID: $(if($owner){$owner}else{'none'})"
  foreach ($p in $web) { Show-Process $p }
  $toStop = @($web)
  if ($owner -and -not ($web | Where-Object { $_.ProcessId -eq $owner })) {
    # The listener may be a server process forked by "next start". Anything else on port 3000 is
    # not ours and is left alone.
    $other = Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
    if ($other) { Show-Process $other }
    $ours = $other -and ($other.CommandLine -match 'hirex-sales-agent\\node_modules\\next\\' -or ($web | Where-Object { $_.ProcessId -eq $other.ParentProcessId }))
    if (-not $ours) { throw 'PORT_3000_HELD_BY_UNKNOWN_PROCESS' }
    $toStop += $other
  }
  if ($web.Count -gt 1) { Write-Output 'More than one web process: all of them will be stopped.' }
  if ($web.Count -eq 0) { Write-Output 'Web is not running; deploying without a stop step.' }

  Stop-ScheduledTask -TaskName 'HireX Local App' -ErrorAction SilentlyContinue
  # Stopping "next start" makes its start-production.mjs parent stop the workers it launched.
  foreach ($p in $toStop) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  $waitUntil=[DateTime]::UtcNow.AddSeconds(20)
  while ((@(Get-WebProcesses).Count -gt 0 -or (Get-Port3000Owner)) -and [DateTime]::UtcNow -lt $waitUntil) { Start-Sleep -Seconds 1 }
  if (@(Get-WebProcesses).Count -gt 0 -or (Get-Port3000Owner)) {
    Start-ScheduledTask -TaskName 'HireX Local App'
    throw 'WEB_DID_NOT_STOP'
  }

  if($MigrateDatabase){
    # Apply pending migrations while no web process or worker can act on the old schema.
    # Each migration runs in its own transaction; on failure the old build is restarted unchanged.
    Push-Location -LiteralPath $root
    try{
      & npx.cmd supabase db push
      if($LASTEXITCODE -ne 0){throw 'MIGRATION_FAILED'}
    }catch{
      Start-ScheduledTask -TaskName 'HireX Local App'
      Write-Output 'MIGRATION_FAILED_OLD_BUILD_RESTARTED'
      throw
    }finally{Pop-Location}
  }
  Move-Item -LiteralPath $current -Destination $backup
  try {
    Move-Item -LiteralPath $source -Destination $current
    Start-ScheduledTask -TaskName 'HireX Local App'
    Start-Sleep -Seconds 8
    $result=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/login -TimeoutSec 30
    Write-Output "DEPLOYED HTTP=$($result.StatusCode)"
    $after = @(Get-WebProcesses)
    if ($after.Count -ne 1) { Write-Output "WARNING: $($after.Count) web processes are running after deploy:"; foreach ($p in $after) { Show-Process $p } }
  } catch {
    Write-Output 'DEPLOY_VERIFY_FAILED_BACKUP_PRESERVED'
    throw
  }
}finally{if($lock){$lock.Dispose()}}
