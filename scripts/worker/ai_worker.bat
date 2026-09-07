@echo off
title Epinoia AI worker (AI process game)
REM Runs the worker loop from this folder. Config lives in %APPDATA%\epinoia\worker.json
REM (copy worker.example.json there and paste the service_role key).
REM
REM To run it at every logon, once, from an Administrator prompt:
REM   schtasks /Create /TN "Epinoia AI worker" /SC ONLOGON /RL LIMITED /TR "\"%~f0\"" /F
REM To stop it: close this window (or Task Manager -> python.exe), or
REM   schtasks /Delete /TN "Epinoia AI worker" /F
cd /d "%~dp0"
if not exist "%APPDATA%\epinoia" mkdir "%APPDATA%\epinoia"
:loop
REM everything the worker prints also lands in %APPDATA%\epinoia\worker.log (the dashboard and
REM a person debugging a game can read it; it is what was missing when a game read only its first half)
python -u ai_worker.py 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath \"$env:APPDATA\epinoia\worker.log\" -Append"
echo worker exited; restarting in 60 s (Ctrl+C to stop)
timeout /t 60 >nul
goto loop
