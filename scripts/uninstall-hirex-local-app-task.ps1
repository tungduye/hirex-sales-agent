$ErrorActionPreference = "Stop"

$taskName = "HireX Local App"
$taskPath = "\"

try {
    $existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
    if ($null -eq $existingTask) {
        Write-Output "uninstall=no-op"
        Write-Output ("taskName={0}" -f $taskName)
        Write-Output "message=Scheduled task does not exist."
        exit 0
    }

    Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false
    Write-Output "uninstall=success"
    Write-Output ("taskName={0}" -f $taskName)
    exit 0
} catch {
    Write-Output "uninstall=failure"
    Write-Output "error=HireX Local App Scheduled Task could not be removed."
    exit 1
}
