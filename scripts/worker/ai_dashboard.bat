@echo off
title Epinoia AI worker - dashboard
REM The control panel: the queue with a progress bar per game, start/stop/pause/resume,
REM reorder, cancel, retry, add a game, open its page. Needs the same worker.json as the worker.
cd /d "%~dp0"
start "" pythonw ai_dashboard.py
