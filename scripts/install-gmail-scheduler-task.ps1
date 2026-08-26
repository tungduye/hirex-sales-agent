$ErrorActionPreference = "Stop"

$taskName = "HireX Gmail Incremental Sync"
$taskPath = "\"

try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $runnerPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "scripts\run-gmail-incremental-sync.ps1"))
    if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
        Write-Output "installation=failure"
        Write-Output "error=Gmail scheduler runner was not found."
        exit 1
    }

    $existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
    if ($null -ne $existingTask) {
        Write-Output "installation=failure"
        Write-Output "error=Scheduled task already exists. Run the reviewed uninstaller before installing again."
        exit 1
    }

    $actionArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 4 -Seconds 30) `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal

    Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $task | Out-Null

    Write-Output "installation=success"
    Write-Output ("taskName={0}" -f $taskName)
    Write-Output ("runnerPath={0}" -f $runnerPath)
    Write-Output "schedule=every 5 minutes"
    exit 0
} catch {
    Write-Output "installation=failure"
    Write-Output "error=Windows Scheduled Task could not be registered."
    exit 1
}
