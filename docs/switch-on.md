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

## 3. The scraper on the worker (stints, lineups, every league scraper) — DONE 2026-09-06

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-scraper.ps1
```
Turns the `scraper files` folder into the PRIVATE repo `MadvillainQuas/scraper-pipeline`
(everything except caches, node_modules, the 6 GB output folder, backups and users.json), adds a
read-only deploy key, stores it as the website's `SCRAPER_DEPLOY_KEY` secret and sets
`SCRAPER_REPO`. **Re-run it whenever you change a scraper file** — it pushes the changes. Run logs
then read `(final, 32 stints)` instead of `0 stints`. To backfill stints for games ingested
before this, run the workflow with the `refresh` box ticked (Actions → League ingest → Run workflow).

## 4. Adding leagues — from the website, no files

**prophesyscouting.co.uk/admin.html → League feeds (auto-update)**: one row per league (code,
label, adapter, schedule URLs). *Publish* commits `config/ingest-sources.json` — the registry the
worker, Scrape Now and GameVis all read — with your saved GitHub token; *Run ingest now* starts the
worker immediately and the card lists the last runs.

**Epinoia console → 07b Connect a league feed** (migrations 0097 + 0098 — run `Push Database.bat`
again after pulling): a platform admin can **create a brand-new league** here from nothing but a
name, a code and its schedule URL(s) (`create league` — makes the league, the current season, a
competition, you as its admin, and registers the feed). To attach a feed to a league that already
exists, paste the league's schedule URL, give it a code, press *connect*. The worker then creates
that league's clubs, players, rosters and fixtures from the feed and turns every finished game into
a scored Epinoia game (roster snapshot, event log, finalise). The card shows each feed's last poll,
game counts and errors, with pause / resume / poll-now.

## 4b. The worker finalises games — DONE 2026-09-06 (`finalise-game` redeployed)

The finalise function accepts the ingest worker (it identifies itself with the service key;
its actions are logged against the platform admin). If it is ever redeployed from an older
checkout, fed games stay `live` with their full event log and the worker logs `finalise-game 401`;
redeploy with:

```bash
cd /d C:\Users\Admin\Documents\website_repo && npx supabase@latest functions deploy finalise-game
```

## 4c. Dates, fixtures and live games (built 2026-09-06)

The worker reads each game's tip-off time, venue and clubs from the Genius hosted schedule (league
local time → UTC), so fixtures appear on Epinoia with real dates before tip. Two lanes run in the
12:00–23:30 UTC window: the half-hourly discovery lane (new games, finals, repo feed commit) and a
**live lane every 10 minutes** that polls only games live or due to tip (±20 min / last 4 h) every
30 seconds for 9 minutes, appending new events and the running clock to Supabase — the game page
picks the new rows up through its own gap check. Run the live lane by hand from Actions with the
`live` box ticked.

## 5. Optional — bootstrap an existing archive into a platform league

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
