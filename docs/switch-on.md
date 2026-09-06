# Switching the league feed on — the three commands

Everything below MUST run from `C:\Users\Admin\Documents\website_repo` — `cd` there first.
Run from the home folder, the CLI sees no migrations, reports every remote version as
missing and suggests `migration repair --status reverted …` — never run that; it would
re-apply all 93 migrations to the live database. Easiest: double-click
`scripts\ingest\Push Database.bat`, which does the cd + link + push for you. Step 1 is the database, step 2 is GitHub (secrets +
push + first run in one script), step 3 is optional (the platform league).

## 1. Database — apply migrations 0094 → 0096

No install needed; `npx` fetches the Supabase CLI.

```bash
npx supabase@latest login
```
(opens the browser once; paste nothing, just approve)

```bash
npx supabase@latest link --project-ref hhvofgqqadtyvcjudhjx
```
(asks for the database password — the one from Project Settings → Database; it is only used for the link)

```bash
npx supabase@latest db push
```
This applies every migration the project has not seen yet. It lists them first
(`0094_ingest_sources`, `0095_feed_season_rollup`, `0096_feed_registry`, plus
any earlier ones never pushed from this machine) and asks `Do you want to push
these migrations? [Y/n]`. Answer `Y`. If it stops on an earlier migration that
was applied by hand in the past, run
`npx supabase@latest migration repair --status applied <number>` for that one
and push again. Never use `supabase db query`.

## 2. GitHub — secrets, push, first run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-github.ps1
```
It installs the GitHub CLI if needed, signs you in (browser), asks for the two
Supabase values (Project Settings → API: the **Project URL** and the
**service_role** secret — input is hidden), stores them as repo secrets,
commits + pushes the ingest work (that is what enables the workflow), runs the
workflow once for SLB and opens the Actions page. Re-running it is safe.

Then open index_9 → Advanced Games View → 📡 League feed. The competition
line says `supabase` once the run has written rows, `repo` before that.

## 3. Optional now, required for Epinoia — create the platform league

```bash
set SUPABASE_URL=https://hhvofgqqadtyvcjudhjx.supabase.co
set SUPABASE_SERVICE_KEY=<service_role secret>
python scripts\ingest\bootstrap_league.py --source SLB --season 2025-26 --dry-run
python scripts\ingest\bootstrap_league.py --source SLB --season 2025-26
```
The dry run prints what would be created (league, season, competition, clubs,
players, roster entries, fixtures). The real run prints the `league_id` and
`competition_id` — paste them into `config/ingest-sources.json` for SLB so the
worker also writes `games` + `game_advanced` from the next run.

## Where things are
| | |
|---|---|
| worker | `scripts/ingest/run_ingest.py` (feed → repo + Supabase + platform) |
| adapters | `scripts/ingest/adapters/` (FIBA LiveStats complete; others are stubs) |
| league bootstrap | `scripts/ingest/bootstrap_league.py` |
| event translator | `scripts/ingest/translate/` (roadmap Phase B) |
| dataset rebuild | `scripts/ingest/build_dataset.py` (local, needs the scraper folder) |
| schedule | `.github/workflows/ingest.yml` — every 30 min 12:00–23:30 UTC |
| roadmaps | `docs/live-data-roadmap.md`, `docs/epinoia-fiba-roadmap.md` |
