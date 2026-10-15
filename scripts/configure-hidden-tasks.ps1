$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\hirex-sales-agent'
$wrapper = Join-Path $root 'scripts\run-background-hidden.vbs'
$backup = Join-Path $root ('runtime\hidden-task-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$null = New-Item -ItemType Directory -Path $backup
$tasks = @(Get-ScheduledTask | Where-Object TaskName -like 'HireX*')
foreach ($task in $tasks) {
  if ($task.Actions.Count -ne 1) { throw "UNSUPPORTED_ACTION_COUNT:$($task.TaskName)" }
  $action = $task.Actions[0]
  if ($action.Execute -match 'wscript' -and $action.Arguments -like '*run-background-hidden.vbs*') { continue }
  if ($action.Execute -notmatch '(?i)(powershell|node)(\.exe)?$' -or $action.Arguments -notlike '*hirex-sales-agent\scripts\*') { throw "UNEXPECTED_ACTION:$($task.TaskName)" }
  Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-File -LiteralPath (Join-Path $backup ($task.TaskName + '.xml')) -Encoding unicode
  $working = if ($action.WorkingDirectory) { $action.WorkingDirectory } else { $root }
  # Pass only the task name; the wrapper owns the exact command and quoting.
  $arguments = '//B //Nologo "' + $wrapper + '" "' + $task.TaskName + '"'
  $replacement = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument $arguments -WorkingDirectory $working
  Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $replacement | Out-Null
  Write-Output "HIDDEN: $($task.TaskName)"
}
Write-Output "Backup: $backup"
# Hide only already-running HireX PowerShell consoles; don't stop their jobs.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HireXWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*hirex-sales-agent\scripts\*' } | ForEach-Object {
  $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($process.MainWindowHandle -ne 0) { $null = [HireXWindow]::ShowWindowAsync($process.MainWindowHandle, 0) }
}
