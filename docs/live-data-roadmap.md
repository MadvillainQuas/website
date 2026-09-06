# Live data roadmap — auto-updating leagues for index_9

_Updated 2026-09-06 (second pass). The index_9 side is BUILT and verified locally
with real SLB games; the Supabase side is written but not applied; the Actions
worker is written but not yet enabled. The wholesale Epinoia hookup has its own
plan: `docs/epinoia-fiba-roadmap.md`._

## How it works now

```
league schedule URLs (config/ingest-sources.json, or public.schedule_sources)
        │  adapter per source kind: fiba_livestats | bbl_2bbl | euroleague_api | … (never per league)
        ▼
scripts/ingest/run_ingest.py  (GitHub Actions every 30 min 12:00–23:30 UTC, or by hand)
        │  discover ids → fetch data.json → normalise (box/team/zones/transition)
        │  → stints through the scraper pipeline's own parser (fiba_api_parser)
        ├─► data/feed/<CODE>/index.json + games/<id>.json   (committed; offline source)
        ├─► Supabase: external_games (+competition_code/scores/status/hash) + storage `feed`
        │             + feed_competitions                       (primary source, realtime-capable)
        └─► Supabase platform rows (games + game_advanced) when the source names a league_id
                                                                (for Epinoia — see the other roadmap)
        ▼
index_9 › Advanced Games View › 📡 League feed
        competitions from feed_competitions (repo index as fallback) → load → every game becomes
        the bs/pbp pair the existing parser reads (FibaJsonToHtml, lifted from GAMEVIS) → the full
        game view (four factors, players, BPM, shooting, halves, connections, win prob, flow, lineups)
        auto-update every 5 min while the tab is open; live games re-fetched through the
        livestats edge function; converted HTML cached per game id + payload hash

nightly / on demand: scripts/ingest/build_dataset.py --source SLB  (or scripts/ingest/Update Dataset.bat)
        runs the scraper project's own scrape-now.py --competition CODE in-process, with data.json
        served from the archive → the usual 13-CSV data_<stamp>_<CODE>/ upload → data/latest.json →
        index_9 follows it on next load
        (the user's stored dataFolder is the league key; opt out with followLatest:false)
```

## What was verified (2026-09-06)
- Discovery: 144 SLB game ids from the regular-season schedule page (headless Chrome, 89 s).
- Fetch + normalise: 3 real SLB games → 32 / 29 / 33 stints, stint points reconcile to the final
  score, team totals correct (`tot_*` keys), lineups mapped to full names, calibrated rim geometry.
- Repo feed written (`data/feed/SLB/…`); index_9 lists the competition, loads the 3 games, opens a
  game with four factors, box, and 12+13 lineups — zero console errors.
- Engine parity: the BPM 2.0 port reproduces the Basketball-Reference workbook; the opponent-adjusted
  team ratings centre on zero for the SLB season.

## To switch it on
1. Apply migrations 0094 → 0096 (`supabase db push`; never `supabase db query`).
2. Repo secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; repo variable `SCRAPER_REPO` + secret
   `SCRAPER_DEPLOY_KEY` so the worker can import `fiba_api_parser` (without it, games still
   flow — with box/zones/transition but no stints).
3. Enable `.github/workflows/ingest.yml` (Actions → run once with `source: SLB`).
4. Open index_9 → Advanced Games View → 📡 League feed → SLB. The source column says
   `supabase` once 0096 is live, `repo` until then.

## Known gaps / next
- **Discovery** now reads the server-rendered Genius hosted schedule
  (`hosted.wh.geniussports.com/<CLIENT>/en/<WHurl>`) with a plain GET — 144 SLB ids in ~1 s, no
  Chrome; headless Chrome is only the fallback. The same HTML carries dates and team names, so the
  next step is parsing them into the index (FIBA data.json carries no date; cards sort by id, which
  is chronological). Note the SLB menu's current-season link is `/competition/49597/schedule…`
  (173 ids) — put that URL first in `config/ingest-sources.json` for the new season.
- **Non-FIBA adapters** are registry stubs (`bbl_2bbl`, `euroleague_api`, `eurobasket_html`): each
  needs `discover()` + `fetch()` written against the corresponding parser in the scraper project
  (see the pbp-scraper-builder skill for the per-league conventions).
- **Dataset rebuild on Actions** needs the scraper repo checkout; locally it runs against
  `C:\Users\Admin\Documents\scraper files` (`SCRAPER_DIR`).
- **Service worker**: `/data/` responses are cached by `sw.js`; the feed loader fetches with
  `no-store`, but bump the SW cache name when changing feed file shapes.
- Realtime subscription to `external_games` from index_9 (0096 publishes it) is the next UX step
  for live games; today live games refresh on the 5-minute cycle plus the livestats function.
