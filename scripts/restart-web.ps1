# Restarts the HireX web app cleanly: stops EVERY web/worker process of this project (including
# stray copies left from older starts), starts the 'HireX Local App' task once, then checks that
# the page AND its stylesheet load. Prints what it found so a stray copy is visible.
# Does not touch the email campaign scheduler or anything outside this project.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\hirex-sales-agent'
$rootPattern = [regex]::Escape($root)
$patterns = @(
  'node_modules\\next\\dist\\bin\\next"?\s+start',
  'node_modules\\next\\dist\\server\\',
  'scripts[\\/]start-production\.mjs',
  'scripts[\\/]ai-recruiter-worker\.mjs',
  'scripts[\\/]facebook-page-reconciler\.mjs'
)

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $line = [string]$_.CommandLine
    $line -match $rootPattern -or $line -match 'start-production\.mjs'
  } | Where-Object {
    $line = [string]$_.CommandLine
    @($patterns | Where-Object { $line -match $_ }).Count -gt 0
  })
}
function Get-Listeners3000 { @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) }
function Show($label) {
  Write-Host "--- $label" -ForegroundColor Cyan
  foreach ($p in Get-AppProcesses) {
    $started = if ($p.CreationDate) { $p.CreationDate.ToString('yyyy-MM-dd HH:mm:ss') } else { '?' }
    Write-Host ("  PID {0,-6} parent {1,-6} started {2}  {3}" -f $p.ProcessId, $p.ParentProcessId, $started, $p.CommandLine)
  }
  foreach ($l in Get-Listeners3000) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)"
    Write-Host ("  Port 3000 on {0} -> PID {1}  {2}" -f $l.LocalAddress, $l.OwningProcess, $owner.CommandLine)
  }
}

Show 'Before restart'
Stop-ScheduledTask -TaskName 'HireX Local App' -ErrorAction SilentlyContinue
$toStop = @(Get-AppProcesses | ForEach-Object { $_.ProcessId })
foreach ($l in Get-Listeners3000) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)"
  if ($owner -and ([string]$owner.CommandLine -match $rootPattern)) { $toStop += $owner.ProcessId }
  elseif ($owner) { throw "PORT_3000_HELD_BY_OTHER_PROGRAM: PID $($owner.ProcessId) $($owner.CommandLine)" }
}
foreach ($id in ($toStop | Select-Object -Unique)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
$until = (Get-Date).AddSeconds(30)
while (((Get-AppProcesses).Count -gt 0 -or (Get-Listeners3000).Count -gt 0) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
if ((Get-AppProcesses).Count -gt 0 -or (Get-Listeners3000).Count -gt 0) { Show 'Still running'; throw 'WEB_DID_NOT_STOP' }
Write-Host "Stopped $(@($toStop | Select-Object -Unique).Count) process(es)." -ForegroundColor Yellow

Start-ScheduledTask -TaskName 'HireX Local App'
$html = $null
$until = (Get-Date).AddSeconds(90)
while (-not $html -and (Get-Date) -lt $until) {
  Start-Sleep -Seconds 3
  try { $html = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/login -TimeoutSec 15).Content } catch { }
}
if (-not $html) { Show 'After start'; throw 'WEB_DID_NOT_START' }
$build = (Get-Content -LiteralPath "$root\.next\BUILD_ID" -Raw).Trim()
$css = [regex]::Matches($html, 'href="(/_next/static/[^"]+\.css)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 3
$bad = @()
foreach ($path in $css) {
  try { $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3000$path" -TimeoutSec 15 } catch { $bad += $path }
}
Show 'After restart'
if ($css.Count -eq 0 -or $bad.Count -gt 0) {
  Write-Host "FAILED: stylesheet missing ($($bad -join ', ')). Send this output to Claude." -ForegroundColor Red
  exit 1
}
Write-Host "OK: web is running build $build and its stylesheet loads." -ForegroundColor Green
