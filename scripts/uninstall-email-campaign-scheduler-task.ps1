$ErrorActionPreference = "Stop"
$taskName = "HireX Email Campaign Worker"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
Write-Output "uninstall=success"
