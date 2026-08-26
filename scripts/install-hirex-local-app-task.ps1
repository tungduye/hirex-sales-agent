$ErrorActionPreference = "Stop"

$taskName = "HireX Local App"
$taskPath = "\"

try {
    $projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    $runnerPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "scripts\run-hirex-local-app.ps1"))
    $packageJsonPath = Join-Path $projectRoot "package.json"
    $buildMarkerPath = Join-Path $projectRoot ".next\BUILD_ID"

    if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
        Write-Output "installation=failure"
        Write-Output "error=HireX local app runner was not found."
        exit 1
    }
    if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
        Write-Output "installation=failure"
        Write-Output "error=Project package.json was not found."
        exit 1
    }
    if (-not (Test-Path -LiteralPath $buildMarkerPath -PathType Leaf)) {
        Write-Output "installation=failure"
        Write-Output "error=Production build is missing. Run npm run build first."
        exit 1
    }

    $existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
    if ($null -ne $existingTask) {
        Write-Output "installation=failure"
        Write-Output "error=Scheduled task already exists. Run the reviewed uninstaller before installing again."
        exit 1
    }

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $actionArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -RestartCount 3
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal

    Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $task | Out-Null

    Write-Output "installation=success"
    Write-Output ("taskName={0}" -f $taskName)
    Write-Output ("runnerPath={0}" -f $runnerPath)
    Write-Output "trigger=current user logon"
    exit 0
} catch {
    Write-Output "installation=failure"
    Write-Output "error=HireX Local App Scheduled Task could not be registered."
    exit 1
}
