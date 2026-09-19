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
REM To watch what it is doing:
REM     type "%LOCALAPPDATA%\epinoia\live_lane.log"

setlocal
set "VBS=%~dp0live_lane_startup.vbs"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Epinoia live lane.lnk"

REM an older attempt may have left a scheduled task pointing at live_lane.bat; harmless if absent
schtasks /Delete /TN "Epinoia live lane" /F >nul 2>&1

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments=$env:VBS; $s.WorkingDirectory=(Split-Path $env:VBS); $s.Save()"
if not exist "%LNK%" (
  echo.
  echo Could not create the startup shortcut at:
  echo   %LNK%
  exit /b 1
)

echo.
echo Installed: %LNK%
echo Starting it now so you do not have to log out and in...
start "" wscript.exe "%VBS%"
echo.
echo It will start itself at every logon. Log: %LOCALAPPDATA%\epinoia\live_lane.log
endlocal
