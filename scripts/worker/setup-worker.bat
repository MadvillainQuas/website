@echo off
title Epinoia AI worker - one-time setup
REM Everything the PC side of "AI process game" needs, once:
REM   1. asks for the service_role key and writes %APPDATA%\epinoia\worker.json
REM   2. makes the worker start (minimised) at every logon, via the Startup folder -- no admin needed
REM   3. starts it now
REM From then on every final game with a stream is read by itself, and the button on a game page
REM is only for re-runs.
cd /d "%~dp0"
python ai_worker.py --setup
if errorlevel 1 (
  echo.
  echo setup did not finish -- run this again.
  pause
  exit /b 1
)
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
> "%STARTUP%\Epinoia AI worker.bat" echo @echo off
>> "%STARTUP%\Epinoia AI worker.bat" echo start "" /min "%~dp0ai_worker.bat"
echo   starts at logon: "%STARTUP%\Epinoia AI worker.bat"  (delete that file to stop it)
start "" /min "%~dp0ai_worker.bat"
echo   worker started (minimised window "Epinoia AI worker").
start "" pythonw ai_dashboard.py
echo   dashboard opened (ai_dashboard.bat opens it again any time).
echo.
echo   Done. Final games with a stream are read by themselves from now on.
pause
