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
REM the worker writes its own log to %APPDATA%\epinoia\worker.log
python -u ai_worker.py
echo worker exited; restarting in 60 s (Ctrl+C to stop)
timeout /t 60 >nul
goto loop
