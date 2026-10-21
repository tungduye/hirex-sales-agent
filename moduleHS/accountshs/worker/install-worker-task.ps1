# install-worker-task.ps1
# Đăng ký Scheduled Task để host Windows tự giữ worker AccountsHS sống:
#   · chạy ensure-worker.ps1 lúc đăng nhập + lặp mỗi phút (ensure tự thoát nếu đã chạy).
# Chạy 1 lần với quyền Administrator:  powershell -ExecutionPolicy Bypass -File moduleHS\accountshs\worker\install-worker-task.ps1
param(
    [string]$TaskName = 'HireX-AccountsHS-Worker'
)
$ErrorActionPreference = 'Stop'

$ScriptDir = $PSScriptRoot
$Ensure    = Join-Path $ScriptDir 'ensure-worker.ps1'
if (-not (Test-Path $Ensure)) { throw "Không thấy $Ensure" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Ensure`""

$triggers = @(
    New-ScheduledTaskTrigger -AtLogOn
)
# Lặp mỗi phút, vô thời hạn (ensure idempotent).
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)
$triggers += $repeat

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Đã đăng ký Scheduled Task '$TaskName' (đăng nhập + mỗi phút)."
Write-Host "Gỡ:  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
