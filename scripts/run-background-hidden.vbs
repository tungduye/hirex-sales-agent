Option Explicit
Dim shell, command, result, script, root, q
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
root = "C:\Users\Admin\hirex-sales-agent"
q = Chr(34)
Select Case WScript.Arguments(0)
  Case "HireX Local App": script = "run-hirex-local-app.ps1"
  Case "HireX Web Watchdog": script = "ensure-hirex-web.ps1"
  Case "HireX Deplao Realtime Supervisor": script = "start-deplao-realtime-supervisor.ps1"
  Case "HireX Deplao Watchdog": script = "ensure-deplao-realtime-supervisor.ps1"
  Case "HireX Email Campaign Worker": script = "run-email-campaign-scheduler.ps1"
  Case "HireX Gmail Incremental Sync": script = "run-gmail-incremental-sync.ps1"
  Case "HireX Zalo Campaign Worker": script = "run-channel-campaign-scheduler.ps1"
  Case "HireX Facebook Profile Bridge": script = ""
  Case Else: WScript.Quit 2
End Select
shell.CurrentDirectory = root
If script = "" Then
  command = q & "C:\Program Files\nodejs\node.exe" & q & " " & q & root & "\scripts\facebook-profile-bridge.mjs" & q
Else
  command = q & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & q & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & q & root & "\scripts\" & script & q
End If
' Wait so Task Scheduler retains running-state and overlap protection.
result = shell.Run(command, 0, True)
WScript.Quit result
