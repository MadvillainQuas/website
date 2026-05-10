# GameVis schedule pre-scrape

The Game Visualizer wrapper (`gamevis.html`) needs a list of FIBA matchIds
per competition to render its schedule. League sites like SLB are SPAs —
the games only appear after JavaScript runs. That means the browser CAN'T
scrape them client-side (no proxy can render JS for free without paid
infrastructure).

So we render the schedules **server-side** — once, periodically — and
commit the resulting per-competition index file into the repo. The
wrapper just `fetch()`es that file at runtime: instant, no CORS spend,
schedule already populated when the user opens the splash.

## How it runs in production

`.github/workflows/gamevis-schedule.yml` runs `gamevis_schedule_scraper.py`:

- **On a schedule** — every 30 min between 12:00 and 23:30 UTC (covers
  UK + EU evenings and most US daylight). Skip overnight to be polite.
- **On demand** — Actions tab → "GameVis schedule pre-scrape" →
  "Run workflow". You can also pass `competition: SLB` to only scrape one.

Each run:
1. Reads `config/gamevis-competitions.json`
2. For each competition, headless-Chromes every `scheduleUrls` entry, scrapes
   matchIds from the rendered DOM
3. Fetches `data/<id>/data.json` for each matchId from FIBA LiveStats
4. Writes `data/gamevis/<CODE>/index.json` (the file the wrapper reads)
5. Commits + pushes the diff back to the repo

The whole thing is rate-limited (300 ms minimum gap between requests, real
User-Agent, retries with backoff). Safe to run every 30 min indefinitely.

## One-time setup

1. **Push these files** (you already have them after our last commit):
   - `scripts/gamevis_schedule_scraper.py`
   - `scripts/requirements.txt`
   - `.github/workflows/gamevis-schedule.yml`
2. **Workflow permissions** — repo Settings → Actions → General → "Workflow
   permissions" → tick **"Read and write permissions"**. Required because
   the workflow commits data files back.
3. **Trigger first run** — Actions tab → "GameVis schedule pre-scrape" →
   "Run workflow" (manual). Watch the log; it should finish in ~3–5 min
   for SLB and create `data/gamevis/SLB/index.json`.
4. **Verify** — visit `https://prophesyscouting.co.uk/gamevis.html?comp=SLB`,
   pick SLB on the splash, click Open. The schedule should render
   instantly with all current games.

After step 3 succeeds, the cron handles itself.

## Running locally

If you want to test before pushing the workflow, or just run it ad-hoc:

```sh
# from the website repo root
pip install -r scripts/requirements.txt
python scripts/gamevis_schedule_scraper.py                     # all comps
python scripts/gamevis_schedule_scraper.py --competition SLB   # one comp
python scripts/gamevis_schedule_scraper.py --headed            # visible browser (debug)
```

You'll get `data/gamevis/<CODE>/index.json` locally; commit + push to
make it visible on the live site.

You need:
- Python 3.8+ (3.11 in CI)
- Google Chrome installed locally (Selenium uses it)

## How the wrapper uses the file

`gamevis.html` (function `tryLoadCachedScheduleIndex`) does roughly:

```js
const r = await fetch(`data/gamevis/${code}/index.json`, { cache: 'no-cache' });
if (r.ok) {
    const j = await r.json();
    if (j.games?.length) return j.games;   // ← instant render
}
// fall through to client-side scraping (only works for non-SPA pages)
```

So if the file exists, the user never sees a CORS proxy attempt at all
when they open a competition. That's the whole point.

## Tuning

- **Cadence** — edit the cron in `.github/workflows/gamevis-schedule.yml`.
  Default is `*/30 12-23 * * *`.  Change to `*/10 *` for a more aggressive
  refresh during live games (ensures live scores tick over within ~10 min
  on the schedule list — the per-game live polling in the wrapper itself
  is still 10 s).
- **Render delay** — `SCHEDULE_RENDER_DELAY_S` in the script. 6 s default
  works for SLB. Bump to 8–10 if you add a slower-loading league.
- **Scope** — add competitions in admin → "GameVis competitions" card.
  The scraper picks them up automatically on the next run.
