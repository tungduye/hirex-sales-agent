# Ban xem truoc HireX (moduleHS): "next dev" cong 3005, cung code + database voi ban that, tu cap nhat khi sua code.
# - Chay nen boi task "HireX HS Preview" (cai 1 lan: nhap dup moduleHS\HS-XEM-TRUOC-CAI-DAT.cmd).
# - Ban that (cong 3000, app.hirexmkt.online) khong bi dung toi: build rieng o runtime\hs-preview\next.
# - Tam nghi khi release.ps1 / restart-web.ps1 dang chay (runtime\web-maintenance.flag) de khong vuong deploy cua anh Tung.
# - Dia chi xem: runtime\hs-preview.txt ; log: runtime\hs-preview.log
param([switch]$Install)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$task = 'HireX HS Preview'
$runtime = Join-Path $root 'runtime'
$info = Join-Path $runtime 'hs-preview.txt'

if ($Install) {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  if (-not (Get-NetFirewallRule -DisplayName 'HireX HS Preview 3005' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'HireX HS Preview 3005' -Direction Inbound -Protocol TCP -LocalPort 3005 -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
  }
  # FFmpeg cho muc Tien ich > Cuoc hop (ghep / nen audio). Cai bang winget neu may chua co.
  $ff = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $ff)) {
    Write-Host 'Dang cai FFmpeg (winget)...'
    winget install --id Gyan.FFmpeg -e --silent --accept-source-agreements --accept-package-agreements
  }
  Start-ScheduledTask -TaskName $task
  Write-Host ''
  Write-Host 'XONG: ban xem truoc HireX dang khoi dong (lan dau mat 1-2 phut).' -ForegroundColor Green
  Start-Sleep -Seconds 4
  if (Test-Path -LiteralPath $info) { Get-Content -LiteralPath $info }
  Write-Host 'Co the dong cua so nay.'
  return
}

Set-Location -LiteralPath $root
New-Item -ItemType Directory -Force $runtime | Out-Null
$flag = Join-Path $runtime 'web-maintenance.flag'
$log = Join-Path $runtime 'hs-preview.log'
$env:HIREX_BUILD_DIR = 'runtime/hs-preview/next'
$env:NEXT_TELEMETRY_DISABLED = '1'
while ($true) {
  while (Test-Path -LiteralPath $flag) { Start-Sleep -Seconds 10 }
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 20MB) { Move-Item -LiteralPath $log -Destination "$log.old" -Force }
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress)
  Set-Content -LiteralPath $info -Encoding UTF8 -Value @("started=$((Get-Date).ToString('o'))", ("urls=" + (($ips | ForEach-Object { "http://${_}:3005" }) -join ' ')))
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format s)] start next dev :3005"
  & cmd.exe /c "npx.cmd next dev -p 3005 -H 0.0.0.0 >> `"$log`" 2>&1"
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format s)] next dev stopped (exit $LASTEXITCODE)"
  Start-Sleep -Seconds 30
}
