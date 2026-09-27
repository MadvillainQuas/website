@echo off
title Epinoia home sources (the leagues GitHub's runners cannot read)
REM Brazil's NBB and Liga Ouro, from lnb.com.br.
REM
REM WHY THIS RUNS HERE AND NOT ON GITHUB. lnb.com.br answers this machine and returns 403 Forbidden to GitHub's
REM runners (the first run from Actions read no fixture at all), as lnb.fr does for the French leagues
REM (live_lane.bat). So these sources are read from here: the schedule, then every game whose report is out.
REM It is an ordinary ingest pass for those sources only, written straight to Supabase; nothing is committed.
REM The live lane (live_lane.bat) follows a game from here once its fixture is on the schedule.
REM
REM Run it by hand, or every day from Task Scheduler (from a normal Command Prompt, once):
REM     schtasks /Create /TN "Epinoia home sources" /SC DAILY /ST 06:10 /TR "C:\Users\Admin\Documents\website_repo\scripts\ingest\home_sources.bat"
REM To stop it:
REM     schtasks /Delete /TN "Epinoia home sources" /F
REM
REM Config (URL + service key) is the worker's own: %APPDATA%\epinoia\worker.json. Nothing is pasted into this file.
REM
REM Anything after the file's name is passed on to run_ingest.py. Once after an adapter change (the shot chart,
REM 2026-09-27), read every game on the schedule again, the ones already stored included:
REM     scripts\ingest\home_sources.bat --refresh

REM the repository's root, so the adapters' caches (data\feed\NBB, data\feed\LOURO) sit where the workflow keeps its own
cd /d "%~dp0..\.."
python -u scripts\ingest\run_ingest.py --worker-config --config --source NBB,LOURO --feed-out "" %*
