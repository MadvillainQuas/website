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
REM TO RUN IT AT EVERY LOGON, use install_live_lane.cmd instead of registering this file: that
REM starts live_lane_supervisor.ps1, which stays invisible while nothing is on and opens a window
REM only when a game is live or tips within 30 minutes. Registering THIS file keeps a console
REM window open all day. (This file is still the way to run one lane by hand.)
REM To stop the startup task: schtasks /Delete /TN "Epinoia live lane" /F

cd /d "%~dp0"
:loop
REM --live-only     no discovery: only games already on the schedule that are live or due
REM --live-loop     seconds this pass stays up (it naps until the next tip-off inside that)
REM --live-every    seconds between reads of a live game
REM --feed-out ""   write to Supabase only; the repo feed is the workflow's job, not this one
if exist "%TEMP%\epinoia_live_wait" del "%TEMP%\epinoia_live_wait"
python -u run_ingest.py --worker-config --live-only --live-loop 21600 --live-every 15 --feed-out ""

REM HOW LONG TO WAIT IS THE LANE'S ANSWER, NOT A CONSTANT. It stops as soon as nothing is live
REM and no tip-off is near, and this used to restart it 30 s later regardless -- roughly 1,300
REM passes across a night with no basketball in it, each one re-reading every schedule to be
REM told the same thing. The lane now leaves the number of seconds in %TEMP%\epinoia_live_wait:
REM 30 when a game is live or due, otherwise long enough to wake half an hour before the next
REM tip-off. A missing file means the old 30 s, so an older run_ingest.py still works.
set "WAIT=30"
if exist "%TEMP%\epinoia_live_wait" set /p WAIT=<"%TEMP%\epinoia_live_wait"
echo.
echo live lane exited; next pass in %WAIT% s (press a key to go now, Ctrl+C to stop)
REM no /nobreak: a keypress skips the wait, which is how you start a pass by hand
timeout /t %WAIT%
goto loop
