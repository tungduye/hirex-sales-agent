Option Explicit
Dim shell, command, result
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = WScript.Arguments(0)
command = WScript.Arguments(1)
' Wait so Task Scheduler retains running-state and overlap protection.
result = shell.Run(command, 0, True)
WScript.Quit result
