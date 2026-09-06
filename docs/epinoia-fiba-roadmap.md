# Epinoia × FIBA LiveStats — populating a whole league from the feed

_Goal: point Epinoia at a league's FIBA LiveStats schedule and have every facet of
that league — teams, rosters, fixtures, live scores, box scores, play-by-play,
advanced stats, standings, awards, player and team pages — fill in and stay
current with no statistician in the loop. Written 2026-09-06. **Status: Phases A
and B are built and verified offline (see "Progress"); nothing is applied to the
production project until the migrations are pushed and the secrets set — see
`docs/switch-on.md`.**_

## Progress (2026-09-06, same day)
- **Phase A — built.** `scripts/ingest/bootstrap_league.py` creates league / season /
  competition / clubs / players / roster entries / fixtures from the feed archive, matching
  by `external_ids.fiba_livestats` then aliases, never guessing. Dry run on the 3 archived SLB
  games: 4 clubs, 41 players, 41 roster entries, 3 fixtures.
- **Phase B — built and PARITY-VERIFIED.** `scripts/ingest/translate/fiba_events.py` emits the
  scorer's exact grammar (20 event types, satellites by `ref`, half-court shot frame, engine
  shot-type vocabulary, `drawn` folded from `foulon`, fouled-out sub fabricated when the feed
  omits it). `parity.js` replays the translated log through the real `epinoia/engine.js`:
  **915 / 915 player stat cells match FIBA's box across the 3 games; scores and team rebounds
  match.** The worker's platform path (`run_ingest.write_event_log`) writes roster snapshot +
  starters + tip/arrow/period, replaces the event log (delete-then-insert, the platform's own
  model), sets `game_state`, and calls `finalise-game` with `{gameId}`.
- The older browser importer (`epinoia/livestats.js` + `admin/import-ui.js`) has 8 defects the
  Python translator avoids (wrong DQ key, wrong shot frame, raw subTypes, no fouls drawn, wrong
  finalise body key, period never set, fouled-out player left on court). Retire it once the
  worker path is live.
- Not yet done: Phase C live translation (incremental events + broadcast frame), Phase D/E.

## Where we start (already true today)

| Layer | State | Where |
|---|---|---|
| Schedule discovery for FIBA SPAs | Working (headless Chrome, 144 SLB ids in 89 s) | `scripts/gamevis_schedule_scraper.py` → `scripts/ingest/adapters/fiba_livestats.py` |
| Per-game normalisation: box, team totals, calibrated shot zones, transition, **stints via the scraper pipeline** | Working, verified on 3 SLB games | `adapters/fiba_livestats.py` (`bundle_from_raw`) |
| Feed publication for index_9 | Working: `data/feed/<CODE>/…` + Supabase `external_games`/storage (0096) | `scripts/ingest/run_ingest.py`, `.github/workflows/ingest.yml` |
| Supabase schema for fed games | Written, not applied: 0094 `schedule_sources / external_games / ingest_runs / game_advanced`, 0095 `feed_team_season` + roll-up fn, 0096 feed registry + storage bucket | `supabase/migrations/` |
| Epinoia game page with a feed-driven advanced tab | Built and verified on the fixture, then parked (not wired into the live site) | `docs/prototypes/epinoia-feed-tab/` (advanced.js + the two patches) |
| Epinoia engines | Event-log based: `engine.js`, `boxscore.js`, `finalise-game`, `lineups.js`, `bpm.js`, `season.js` | `epinoia/`, `supabase/functions/_shared/` |

The single design decision that everything else hangs on:

> **A fed game must become an Epinoia game, not a second kind of game.**
> Epinoia's tabs, report, season aggregates, awards, BPM and WOWY all read
> `game_events` + `roster_snapshot` through `deriveGame()`. If the feed is
> translated into that event grammar, every existing screen works unchanged
> and future screens only have one shape to read. The parked feed tab is the
> fallback for sources whose play-by-play cannot be translated (a box-only
> feed), not the main road.

## Phases

### Phase A — league bootstrap from the schedule (1 week)
Create the league's static facets from what the schedule + first payloads carry.
- `bootstrap_league.py`: for a `schedule_sources` row with no `league_id`, create
  `leagues` (slug from code), `seasons`, `competitions`, then from every
  discovered game's `tm[1|2]`: `teams` (name, short name, code, logo URL from
  `logoT`, colours later), `roster_entries` from `pl[]` (name, shirt, position,
  `pno` kept as the external player id in `players.external_ids jsonb`).
- Team/player identity: exact external id first, then `public.teams.aliases` /
  `players.aliases`; never guess. Unmatched → `external_games.error`, surfaced
  in the admin console's ingest card.
- Dates: FIBA `data.json` has no date. Take it from the schedule page (extend
  `discover_game_ids` to return `{id, date, home, away}` — the DOM has all
  four) and fall back to `othermatches`/`timeline` timestamps.
- Acceptance: a fresh league appears in `/epinoia/?l=<slug>` with clubs,
  rosters and a fixture list, before a single game is finalised.

### Phase B — event translation: FIBA pbp → `game_events` (2–3 weeks, the core)
Write `scripts/ingest/translate/fiba_events.py` (Python, unit-tested against
archived payloads) that emits the scorer's event rows, then reuse `finalise-game`.
- Grammar to target: `game_events(seq, t, team, pid, period, clock, payload)`
  as produced by the scorer (`epinoia/score/`), consumed by `engine.deriveGame`.
  Inventory the `t` vocabulary from `engine.js` (shot kinds with `x/y`, rebounds
  off/def, assists, turnovers with `kind`, fouls with `drawn`, subs with
  `in/out`, timeouts, period start/end, jump ball) — the same dictionary
  `fiba_api_parser._apply_event` already maps for the CSV pipeline, so the
  mapping table exists; it needs a second output target.
- Tricky bits, all already solved somewhere: assist chaining
  (`generatePbpHtmlFromJson` lines 15036-15100), sub batching within a dead
  ball (`_flush_pending_substitutions`), FT sequences, team rebounds (FIBA
  `tot_sReboundsTeam*` vs. per-player), shot coordinates (FIBA 0-100 frame →
  the scorer's court frame; rim constants in `fiba_livestats.py`), period
  clock direction (`gt` is time remaining).
- Write path: `external_games → games (status live/final) → game_events
  (idempotent on (game_id, seq))`, then call the existing `finalise-game`
  function when the payload says `game end` → `player_game_stats`,
  `team_game_stats`, `lineup_stints`, standings, awards recompute, feeds.
- Parity gate before switching a league on: for 5 archived games, the
  translated log's `deriveGame()` box must equal FIBA's `tm` totals per player
  (pts/reb/ast/stl/blk/tov/pf/min) and `lineup_stints` must reconcile with the
  pipeline's `stints.csv` possessions within 2%.

### Phase C — live (1 week)
- The worker already re-fetches live games each poll; for live fidelity the
  Epinoia game page keeps its 30 s `livestats` poll (already built for the
  scorer-less GameVis) and the translator runs incrementally: only new
  `actionNumber`s become events, `game_state` is set from `clock/period`.
- Realtime: broadcast a `frame` on `game:<id>` from an edge function after
  each incremental translation so viewers get the same push a scorer produces
  (the page code needs no change).

### Phase D — everything else is already downstream (ongoing)
Once B lands, these are free because they read `game_events` / finalise output:
match report, video tab anchoring, WOWY, player pages, awards, standings,
brackets, API `/v1/games/{id}`, partner feeds (`data_feeds`), merch/socials.
Remaining feed-specific additions:
- `game_advanced.stints` for the pipeline's richer stint stats (rim/OTD,
  vs_starters) shown on the parked feed tab as an "extras" panel.
- Season BPM 2.0 (the workbook-exact engine now in index_9) as a Supabase
  function fed by `feed_team_season` + player season rows, so Epinoia and
  index_9 quote the same BPM.
- Non-FIBA sources: the adapter registry already has the seams; each new
  source is `discover + fetch + translate`, never a new pipeline.

### Phase E — operations
- Admin console card: sources, last poll, errors, "run now" (dispatches the
  workflow), alias fixer for unmatched names.
- Politeness stays at 300 ms/request, one host at a time, 12:00–23:30 UTC.
- Cost: payload storage ~65 MB per league-season in the `feed` bucket;
  game_events ~700 rows per game.

## Sequencing

A (bootstrap) → B (translation + parity) → switch SLB on → C (live) → D/E.
B is the only phase with real research risk; everything before and after it
is plumbing that already exists in one form or another in this repo.
