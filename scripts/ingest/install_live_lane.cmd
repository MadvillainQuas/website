@echo off
REM Runs the Epinoia live lane at every logon, invisibly, and opens a window only while a game is
REM live or tips within 30 minutes (see live_lane_supervisor.ps1 for how it decides).
REM
REM Run once from a normal Command Prompt (no Administrator needed - it is a per-user task):
REM     cd /d C:\Users\Admin\Documents\website_repo\scripts\ingest && install_live_lane.cmd
REM To remove it:
REM     schtasks /Delete /TN "Epinoia live lane" /F
REM To watch what it is doing:
REM     type "%LOCALAPPDATA%\epinoia\live_lane.log"

setlocal
set "SUP=%~dp0live_lane_supervisor.ps1"

REM the old task pointed at live_lane.bat (a window that stays open all day); replace it
schtasks /Delete /TN "Epinoia live lane" /F >nul 2>&1

schtasks /Create /TN "Epinoia live lane" /SC ONLOGON /RL LIMITED /F ^
  /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%SUP%\""
if errorlevel 1 (
  echo.
  echo Could not create the scheduled task.
  exit /b 1
)

echo.
echo Installed. Starting it now so you do not have to log out and in...
schtasks /Run /TN "Epinoia live lane"
echo.
echo It will start itself at every logon. Log: %LOCALAPPDATA%\epinoia\live_lane.log
endlocal
