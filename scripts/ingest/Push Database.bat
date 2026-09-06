@echo off
title Push Supabase migrations (website repo)
REM Runs from the repo root so the CLI sees supabase\migrations (running it from
REM C:\Users\Admin creates an empty stray project and reports every remote version missing).
cd /d "%~dp0..\.."
echo Repo: %CD%
npx supabase@latest link --project-ref hhvofgqqadtyvcjudhjx
npx supabase@latest db push
pause
