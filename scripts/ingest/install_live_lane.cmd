@echo off
REM Runs the Epinoia live lane at every logon, invisibly, and opens a window only while a game is
REM live or tips within 30 minutes (see live_lane_supervisor.ps1 for how it decides).
REM
REM Uses the per-user STARTUP FOLDER, not a scheduled task: creating a logon task needs
REM Administrator on some Windows setups ("Access is denied"); the Startup folder never does.
REM
REM Run once from a normal Command Prompt:
REM     cd /d C:\Users\Admin\Documents\website_repo\scripts\ingest && install_live_lane.cmd
REM To remove it:
REM     del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Epinoia live lane.lnk"
REM     schtasks /Delete /TN "Epinoia live lane watchdog" /F
REM To watch what it is doing:
REM     type "%LOCALAPPDATA%\epinoia\live_lane.log"
REM To check the watchdog is registered:
REM     schtasks /Query /TN "Epinoia live lane watchdog"

setlocal
set "VBS=%~dp0live_lane_startup.vbs"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Epinoia live lane.lnk"

REM an older attempt may have left a scheduled task pointing at live_lane.bat; harmless if absent
schtasks /Delete /TN "Epinoia live lane" /F >nul 2>&1

REM The path is quoted in the shortcut's arguments ([char]34, so nothing has to be escaped through
REM cmd): unquoted, a repo living under a folder with a space in it would start wscript on the
REM first word of the path and silently do nothing.
powershell -NoProfile -Command "$q=[char]34; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments=($q+$env:VBS+$q); $s.WorkingDirectory=(Split-Path $env:VBS); $s.Save()"
if not exist "%LNK%" (
  echo.
  echo Could not create the startup shortcut at:
  echo   %LNK%
  exit /b 1
)

REM A WATCHDOG AS WELL AS THE LOGON SHORTCUT. The Startup folder only fires at logon, so a
REM supervisor that stops -- an update, a stray error, a window closed by hand, a crash -- stays
REM stopped until the next logon, and every game played in between goes unwatched. This task
REM launches the same starter every 10 minutes. The supervisor holds a named mutex, so a launch
REM while one is already running exits immediately and costs nothing; the only time it does
REM anything is the time it is needed.
REM
REM Registered for THIS user with no elevation, which is why it is a repeating task rather than
REM /SC ONLOGON -- that one asks for Administrator on some setups, which is the whole reason the
REM Startup folder is used above. StartWhenAvailable picks up a run missed while the PC slept,
REM and IgnoreNew stops them stacking up.
powershell -NoProfile -Command "$q=[char]34; $a=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ($q+$env:VBS+$q) -WorkingDirectory (Split-Path $env:VBS); $t=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10); $st=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName 'Epinoia live lane watchdog' -Action $a -Trigger $t -Settings $st -Force | Out-Null"
if errorlevel 1 (
  set "WATCHDOG=could not be registered - the logon shortcut alone will still start it"
) else (
  set "WATCHDOG=registered: relaunches it every 10 min if it has stopped"
)

echo.
echo Installed: %LNK%
echo Watchdog:  %WATCHDOG%
echo Starting it now so you do not have to log out and in...
start "" wscript.exe "%VBS%"
echo.
echo It will start itself at every logon. Log: %LOCALAPPDATA%\epinoia\live_lane.log
endlocal
