' Starts live_lane_supervisor.ps1 with NO window at all. A shortcut straight to powershell.exe
' flashes a console for a moment even with -WindowStyle Hidden; wscript with window style 0 does not.
' Finds the supervisor next to itself, so the repo can live anywhere.
Dim fso, here, sh
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & here & "\live_lane_supervisor.ps1""", 0, False
