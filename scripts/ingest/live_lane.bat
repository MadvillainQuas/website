@echo off
title Epinoia live lane (fixtures, scores and play-by-play while games are on)
REM Polls every game that is live or about to tip, and writes it straight to Supabase, so the
REM strip, the fixture cards and the box score follow a game while it is being played.
REM
REM WHY THIS RUNS HERE AND NOT ON GITHUB.
REM   1. lnb.fr answers this machine and returns 403 Forbidden to GitHub's runners, so the French
REM      leagues -- ELITE, ELITE 2 and both Espoirs divisions -- cannot be fetched from Actions at
REM      all. The ingest workflow has been failing on exactly that since the season started.
REM   2. GitHub's cron is best-effort and drops most high-frequency schedules: on 17-18 Sep 2026
REM      the every-10-minute live schedule ran at 08:35 and then not again until 16:41.
REM Nothing here replaces the workflow; it covers the leagues and the moments the workflow cannot.
REM
REM Config (URL + service key) is the worker's own: %APPDATA%\epinoia\worker.json. Nothing is
REM pasted into this file and nothing is committed by it.
REM
REM To run it at every logon, once, from an Administrator prompt:
REM   schtasks /Create /TN "Epinoia live lane" /SC ONLOGON /RL LIMITED /TR "\"%~f0\"" /F
REM To stop it: close this window, or
REM   schtasks /Delete /TN "Epinoia live lane" /F

cd /d "%~dp0"
:loop
REM --live-only     no discovery: only games already on the schedule that are live or due
REM --live-loop     seconds this pass stays up (it naps until the next tip-off inside that)
REM --live-every    seconds between reads of a live game
REM --feed-out ""   write to Supabase only; the repo feed is the workflow's job, not this one
python -u run_ingest.py --worker-config --live-only --live-loop 21600 --live-every 15 --feed-out ""
echo.
echo live lane exited; starting the next pass in 30 s (Ctrl+C to stop)
timeout /t 30 >nul
goto loop
