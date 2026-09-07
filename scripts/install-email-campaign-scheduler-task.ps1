$ErrorActionPreference = "Stop"
$taskName = "HireX Email Campaign Processor"
$root = Split-Path -Parent $PSScriptRoot
$runner = [IO.Path]::GetFullPath((Join-Path $root "scripts\run-email-campaign-scheduler.ps1"))
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "Runner unavailable" }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "Task already exists" }
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -InputObject (New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal) | Out-Null
Write-Output "installation=success"
