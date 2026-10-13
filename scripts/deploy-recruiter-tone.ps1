param([ValidatePattern('^[a-z0-9][a-z0-9-]{1,40}$')][string]$Release='recruiter-tone',[switch]$MigrateDatabase)
$ErrorActionPreference='Stop'
$root='C:\Users\Admin\hirex-sales-agent'
$source=(Resolve-Path -LiteralPath "$root\.next-$Release").Path
$current=(Resolve-Path -LiteralPath "$root\.next").Path
$backup="$root\.next-before-$Release"
if($source -ne "$root\.next-$Release" -or $current -ne "$root\.next" -or (Test-Path -LiteralPath $backup)){throw 'INVALID_DEPLOY_PATHS'}
if(-not(Test-Path -LiteralPath "$source\BUILD_ID")){throw 'BUILD_MISSING'}
$lock=$null
$deadline=[DateTime]::UtcNow.AddMinutes(35)
try {
  while(-not $lock -and [DateTime]::UtcNow -lt $deadline){
    try{$lock=[IO.File]::Open("$root\runtime\email-campaign-scheduler.lock",[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{Start-Sleep -Seconds 3}
  }
  if(-not $lock){throw 'ACTIVE_SEND_DEPLOY_NOT_STARTED'}
  $web=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'hirex-sales-agent\\node_modules\\next\\dist\\bin\\next start'})
  if($web.Count -ne 1){throw 'WEB_PROCESS_AMBIGUOUS'}
  Stop-ScheduledTask -TaskName 'HireX Local App'
  Stop-Process -Id $web[0].ProcessId -Force -ErrorAction SilentlyContinue
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
    $result=Invoke-WebRequest http://127.0.0.1:3000/login -TimeoutSec 30
    Write-Output "DEPLOYED HTTP=$($result.StatusCode)"
  } catch {
    Write-Output 'DEPLOY_VERIFY_FAILED_BACKUP_PRESERVED'
    throw
  }
}finally{if($lock){$lock.Dispose()}}
