$ErrorActionPreference = "Stop"
$taskName = "HireX Email Campaign Processor"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
Write-Output "uninstall=success"
