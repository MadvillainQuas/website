@echo off
title Update index_9 dataset from the feed archive
cd /d "%~dp0..\.."
REM Same pipeline as "Scrape Now.bat", but games already archived under data\feed\<CODE>\games
REM are read from disk instead of re-fetched. Pass a code, default SLB.
set CODE=%1
if "%CODE%"=="" set CODE=SLB
python scripts\ingest\build_dataset.py --source %CODE%
pause
