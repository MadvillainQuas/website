# NCAA Division II and III: readiness

Written 1 Oct 2026. It covers what the platform measures today, what NCAA D2 and D3 (men and women) add,
what was changed to carry it, what is left, and what only the owner can do in Supabase and GitHub. It
complements `docs/large-leagues.md` (big competitions: season files built on a server) and
`docs/conferences.md` (conferences as groups).

Every number below was measured on 1 Oct 2026 unless it says "estimate". The measurements were made with
the publishable key, as a signed-out reader, so a private league is not counted.

---

## 1. Baseline (the platform today)

### Rows

| table | rows | per finished game |
|---|---|---|
| leagues / competitions / seasons | 69 / 87 / 65 | |
| teams | 993 | |
| games | 12,796 (11,328 scheduled, 1,468 final) | |
| games this season (since 1 Aug) | 11,938 (636 final) | 368 finals in the last 7 days |
| game_events | 1,153,063 | **785** |
| player_game_stats | 33,021 | 22.5 |
| team_game_stats | 2,930 | 2 |
| lineup_stints | 52,806 | 36 |
| game_sit_lines | 3,024 | ~21 |
| game_advanced / game_state | 1,469 / 1,468 | 1 / 1 |
| external_games | 12,943 | |
| standings / competition_teams | 1,150 / 1,154 | |
| roster_entries / player_season_stats | 7,933 / 8,538 | |

The JSON the API returns for one finished game, from three games sampled: events 179-273 KB (698-999 rows),
player lines 31-37 KB, stints 35-41 KB, splits 8-9 KB, `game_advanced` 83-88 KB, team lines 2.5 KB. That is
**~360-450 KB of JSON a game**.

**PostgREST answers at most 1,000 rows a request** (checked: `games?select=id` with no limit returns 1,000
of 12,796). A page that reads a whole table without paging is silently wrong past 1,000 rows. See §4.

### Storage

| bucket | objects | size |
|---|---|---|
| `feed` (raw payloads) | 1,613 | 549 MB (340 KB a payload) |
| `media-public` | 2,288 | 81.5 MB |
| `snapshots`, `crests` | not listable with the publishable key | |

### The live lane (GitHub Actions run 36748323142, 30 Sep 2026, 17:00-22:11 UTC)

- Up to **26 games live or due at once**, 34 different games, **2,334 versions written**.
- Interval between two writes of one game: median **51 s**, p90 153 s, p99 492 s.
- Peak: **56 writes a minute** on one lane, about one second each. The lane reads and writes one game at a
  time, so this is its ceiling.
- The catch-up step took 3 min 17 s across 123 sources, and the stuck-game repair took 8 s.
- The lane polls every 10 s, chains itself, and is capped at 330 min a pass.

### Page loads

These were measured with Playwright against the live database. The pages were served from the repository
by `python -m http.server`, which does not compress, so "static" is uncompressed. GitHub Pages compresses
it to about a quarter. The Supabase bytes are as transferred.

| page | requests | REST (n / KB) | Storage (n / KB) | static KB | to idle |
|---|---|---|---|---|---|
| HOME | 190 | 64 / 1,402 | 36 / 376 | 1,382 | 14.4 s |
| fixtures | 61 | 2 / 7 | 0 | 925 | 5.1 s |
| league (BCB) | 107 | 13 / 46 | 16 / 68 | 1,628 | 8.5 s |
| box score (final) | 134 | 14 / 49 | 7 / 85 | 2,684 | 8.8 s |
| statistics (BCB) | 107 | 15 / 30 | 21 / 396 | 1,403 | 9.2 s |
| WOWY (BCB) | 99 | 19 / 215 | 6 / 87 | 1,223 | 12.3 s |
| scouting | 87 | 7 / 31 | 11 / 197 | 1,165 | 6.8 s |

Two of these pages asked for a file that is not there. The statistics page asked for the v3 season file
before the v2 one that exists. The box score asked for an events file that was not built yet. Both requests
answer 400.

---

## 2. What NCAA D2/D3 adds (the model)

### Size

- **Schools.** About 300 in D2 and 430 in D3, each with a men's and a women's team: ~1,460 teams.
- **Games, estimated from teams × games ÷ 2, plus games against non-D2/D3 opponents.**
  - D2: ~4,600 per gender.
  - D3: ~5,900 per gender.
  - **About 21,000 games a season.** The brief's planning figure is 30-35k, and the tables below give both.
- **One evening, measured on Saturday 14 Feb 2026 on ncaa.com's scoreboard.**
  - D3 men 177, D3 women 182, D2 women 137. D2 men was not checked and is assumed similar, ~140.
  - That is **~640 games in a day**, nearly all tipping between 17:00 and 01:00 UTC.
  - **About 350-400 are live at the peak.**
- **Players.** About 20,000.

### Per NCAA game (the scraper's 46 captured games, translated by this repo)

| | NCAA | today's average |
|---|---|---|
| events | **515** | 785 |
| stints | 35 | 36 |
| raw payload (FIBA shape, stored in `feed`) | **91 KB** | 340 KB |
| rows written in all | ~600 | ~870 |

### A season

| | 21k games | 35k games | today |
|---|---|---|---|
| rows | 12.6 M | 21 M | ~1.3 M |
| `game_events` rows | 10.8 M | 18 M | 1.15 M |
| database, on disk (estimate: ~200-300 KB a game with indexes and TOAST) | **4-6 GB** | **7-10 GB** | ~0.5 GB |
| `feed` bucket | 1.9 GB | 3.2 GB | 0.55 GB |
| events files (`snapshots/events/`, ~134 KB a game) | 2.8 GB | 4.7 GB | |
| crests (1,460 at ~20 KB after shrink_crests) | ~30 MB | | |

### The peak evening

**Live lane.**
- Each version costs two GraphQL reads, about 175 KB together.
- With the 300 ms per-host gap and network time, that is about 1.2 s.
- One write costs about 1.0 s, as measured above.
- So one shard handles about **0.45 games a second**.
- For 400 live games:

| shards (runners) | each game refreshed every | requests/s to ncaa.com, all shards | writes/s to Supabase |
|---|---|---|---|
| 1 (today's lane) | ~15 min | 0.9 | 0.45 |
| 4 | ~220 s | 3.6 | 1.8 |
| 8 | ~110 s | 7 | 3.6 |
| 12 | ~75 s | 11 | 5.4 |

**Database writes.**
- At 8 shards that is ~3.6 writes a second.
- Each write is ~18 statements, so ~65 statements a second.
- This is comfortable on the Small compute or larger. The writes are short.

**Edge Functions.**
- `finalise-game` runs once per final: ~640 on a Saturday, ~5-8k a month.
- `snapshots` runs on every 5-minute tick while games finish.
- The Pro plan includes 2M invocations a month.

**pg_cron.**
- `notify_tick` runs every minute. Its prefilter is one indexed read.
- `notify_halftime` is now in halves (0206). It looks only at live games that are not running, so its cost
  follows the number of live games.
- `close_stuck_games` runs hourly and finds nothing almost every time.

**Season roll-up (`refresh_feed_team_season`).**
- It re-adds the whole competition: ~5,000 games for an NCAA division.
- It used to run after every final, which would mean ~400 times an evening.
- It now has an opt-in floor. See §3.

**Big season files (`big-seasons.yml`).**
- One build reads the whole season: ~5,000 games × ~19 KB = ~95 MB.
- Four divisions rebuilt every hour would read **~9 GB a day of database egress**.
- The new floor brings this down to ~1.5 GB a day at 6 hours. See §3.

**HOME's stars.**
- They summed every box score of the month, in every browser and in the snapshots function.
- NCAA alone finishes ~4,300 games a month, which is ~30 MB of JSON and 200+ requests a visit.
- They are now capped. See §3.

**Realtime.**
- Each viewer of a live box score holds one socket.
- Each ingest write sends 2-3 broadcasts (events, state, sometimes the game row) to that game's topic.
- Only games in public open leagues are broadcast.

### Against the Pro plan

These are publicly documented Pro inclusions. **Check them on supabase.com/pricing before deciding.**

| | included | at NCAA scale | risk |
|---|---|---|---|
| database disk | 8 GB, then $0.125/GB-month (autoscaling) | +4-10 GB a season | low cost, **watch it** |
| compute | $10 credit = Micro (1 GB RAM) | `game_events` alone: 18 M rows, its two (game_id, seq) indexes ~1-1.5 GB | **Micro is too small; Small (2 GB) for the pilot, Medium (4 GB) for all four divisions** |
| egress | 250 GB + 250 GB cached, then $0.09/GB | big seasons ~45 GB/month at a 6 h floor (~270 GB at hourly); a box-score view ~0.15-0.3 MB of Supabase bytes | **set the floor**; traffic-dependent |
| storage | 100 GB | +5-8 GB a season | low |
| Edge Function invocations | 2 M/month | <20 k/month | low |
| Realtime | 500 concurrent peak connections, 5 M messages/month | one connection per live viewer; messages = broadcasts × listeners | **depends on audience**: set a spend cap or a quota alert |
| image transformations | 100/month | not used (`crestSizes: false`) | none |
| pooler | by compute size | PostgREST pools its own connections; the ingest uses REST | low |

### GitHub Actions

The repository is public, so standard runners cost no minutes. The limits that matter:

- **20 concurrent jobs on the Free plan, across the account.** That has to hold:
  - the existing live lane,
  - discovery,
  - guard,
  - pages,
  - eight NCAA shards.

  It fits, but CI may queue on a college evening.
- **6 hours a job.** The lanes chain themselves every 330 minutes.
- **Cron is best effort.** The hourly floor exists for that.

If the repository is made private (`docs/data-protection.md`), minutes are billed. Budget for that: eight
shards × ~5 h × ~100 evenings is about 4,000 runner-hours a season.

---

## 3. What was changed (this branch)

### Two halves, end to end

- **The engine** (`epinoia/engine.js`, generated into `supabase/functions/_shared/engine.js`).
  - New `formatOf(game | rules | events)` returns `QUARTERS` (4 × 10:00) or `HALVES` (2 × 20:00), with
    5:00 overtimes either way.
  - A game's own `format`, or the league's `rules`, decide. Failing that, the log decides: a first- or
    second-period clock above 10:00 can only be a half. Not one of today's 1.15 M events has one.
  - `PLEN`, `cumEl` and `perName` take the format. `deriveGame` uses it everywhere: minutes, stints, the
    transition window, the game order. It returns `d.format`.
  - Team fouls are kept per half and carry into overtime.
  - Timeouts: FIBA's allowance is not claimed for a game in halves (`timeoutsLeft` returns null, which the
    scorebug already handles).
  - Labels are `h1`, `h2`, `ot1`.
- **The box score** (`epinoia/score/index.html`, generated into `epinoia/boxscore.js`).
  - `gameFmt()` reads the game on the page.
  - The period pill, the quarter strip and the scoresheet use it: "H1 · 20:00", "end of h1".
- **The game page.**
  - `game/game.js`: half-time is the end of period 1 in halves, the half-time report is the first half, and
    `settleClock` reads a half's 20:00.
  - These modules now carry the same halves rule:
    - `game/flow.js`, `rotation.js` (H1/H2 axis, 20-minute halves in the season view)
    - `game/connections.js`, `situations.js`, `possessions.js`, `rapm.js`, `lineupevents.js`
    - `game/story.js`, `game/gamefacts.js` (`reg`), `game/report.js`, `game/reportview.js`
    - `game/events.js`, `game/video.js`, `shotchart.js` (H1/H2 filter), `embed/game/game.js`
    - `broadcast/broadcast.js`, where the bonus is at the 7th foul in halves.
- **Edge Functions.**
  - `finalise-game`: the gate "only N periods played" and the expected minutes follow the format. Before
    this, **every NCAA men's game would have been refused**.
  - `broadcast` and `share`: labels, fouls and finality follow it too.
- **The ingest.**
  - `translate/fiba_events.py`: `QUARTERS` / `HALVES`, `fmt_of(raw)` (the payload's `format`, else its
    clock), `PLEN(p, fmt)`, `period_of(ev, fmt)` (an overtime after halves is period 3), and `format` in
    the translation.
  - `stints.py`: elapsed time and stint periods per format.
  - `run_ingest.py`:
    - the stale-final and abandoned-feed rules (`_looks_finished`, `feed_abandoned`, `_period_over`) use
      the regulation periods;
    - the stamp helpers (`_elapsed_ms`) use the batch's format.
  - `stuck.py`: `verdict(..., periods)`, reading each league's `rules.periods`. Before this, a stuck game
    in halves was always VOID.
- **The database** (migration `0206`):
  - `game_in_halves(game, rules)`.
  - `close_stuck_games`, `notif_first_half` and `notify_halftime` re-stated with only the lines tagged
    `-- 0206` changed. Quarters games behave exactly as before. The privacy and paywall gates are kept.
- **Tests.**
  - `scripts/ingest/ncaa_test.py`: a synthetic game in halves with an overtime runs through the adapter,
    the stints, the translator and the engine: 2,700 s, 225 player-minutes a side, h1/h2/ot1, fouls per
    half, the stuck rule, lanes and shards, the roll-up floor, and league rules. Where the scraper checkout
    is present, its 46 captures also run.
  - `supabase/tests/periodpill.test.mjs`: the halves pill, clock, minutes, fouls and timeouts.
  - `supabase/tests/ncaa-halves.test.mjs`: 0206 on PGlite.
  - All three are in `guard.yml`.

### The data source: a thin adapter over the scraper's NCAA parse

- **`scripts/ingest/adapters/ncaa.py`** (`"adapter": "ncaa"`).
  - It loads `validation/ncaa/ncaa_adapter.py` from the private scraper-pipeline checkout at run time
    (`SCRAPER_DIR`, as `ingest.yml` already provides). **No scraper code is copied here.**
  - It turns the scraper's output into the FIBA LiveStats shape (`to_fiba`), with `format` stated, so
    everything downstream is unchanged.
- **Discovery.** The day's scoreboard per sport and division, one request a day. By default it reads the
  days around today; `full_season` reads Nov-Mar. Each scoreboard entry gives:
  - the teams, in UTC;
  - the state;
  - each school's conference (`conferenceSeo` → `home_group` / `away_group`, named by `conference_name`);
  - the crest (`ncaa.com/.../bgl/<seoname>.svg`, verified).
- **Live.** A game is read in full only when its scoreboard line has moved: its state, its period or
  either score. Otherwise it is read every `max_age_s` (90 s). The scoreboard is read at most every 20 s
  and is cached for 5 s at ncaa.com's edge.
- **Substitutions are paired** (`paired_subs`). ncaa.com logs an IN and its OUT at different clocks.
  Paired the way the scraper's engine does it, the 46 captures went from 231 translator warnings to 0 and
  from 23 games with a side not five on the floor to 0.
- **Shirt numbers become slots.** `#0` and `#00` are real NCAA shirts, and the translator reads pno 0 as
  "no player".
- **A game whose plays do not add up to its score is published as a result, not replayed**
  (`GameBundle.translate = False`, honoured in `write_platform`). `finalise-game` writes the score the log
  replays to, so a log missing baskets would publish the wrong score, or the wrong winner. A box-only
  final, where some schools publish no play-by-play, goes the same way. **19 of the 43 captures with a
  log do not add up.** The captures are the scraper's validation set and probably the hard cases, so
  measure a random sample during the pilot.
- **Women's games.**
  - They are four 10-minute quarters (`WBB`), with the same GraphQL shape (checked: contest 6523932, four
    periods of 10:00).
  - The adapter lends the scraper's parse a quarters clock for them.
  - `docs/ncaa/scraper-ncaa-women.patch` makes scraper-pipeline take `sport` itself; the adapter uses it
    once it is there.
- **New leagues get their rules.** A source row's `league_rules` is written when the league is created
  (`feedplatform.Platform.league`). Men's rows say `{"periods": 2, "period_ms": 1200000}`.

### Several runners for one evening

**`run_ingest.py --lane NAME --shard i/n`** (live lane only):

- A source row with `"live_lane": "ncaa"` is polled only by `--lane ncaa`.
- The default lane takes exactly what it always took: the sources that name no lane.
- `--shard 2/4` takes the games whose `crc32(external id) % 4 == 1`. That is stable across runs and
  machines, so no two runners write one game.

**`.github/workflows/ingest-ncaa.yml`:**

- A matrix of `NCAA_SHARDS` (default 4) lanes. It chains itself.
- **Manual only until go-live.** Its schedule is commented out.

**The season roll-up floor** (`adapter_config.season_refresh_s`):

- A final only marks its competition as owed a roll-up.
- The roll-up is paid at most every N seconds, and once more at the end of the pass (`roll_up_due`,
  `flush_refresh`).
- Unset is the old rule.

### Less load from the pages

- **Season files** (`epinoia/data.js`). The layout that answered last (v3 or v2) is asked first for the
  session. That ends one 400 per season read on the league, statistics and scouting pages while the
  function still writes v2.
- **HOME's stars** (`epinoia/stars.js`). A competition with more than 250 finished games in the 30-day
  window is left off the podiums. Today's busiest has under 100, so nothing visible changes. This keeps
  NCAA's ~4,300 games a month out of every browser and out of the snapshots function's two seconds.
- **Scouting's club counts** (`epinoia/scouting/scouting.js`). One embedded count per league
  (`leagues?select=id,teams(count)`) replaces paging through every club.
- **Big season files** (`tools/build-seasons.mjs`, `big-seasons.yml`). `--min-gap-hours` (the repository
  variable `BIG_SEASONS_MIN_GAP_H`) lets a file younger than N hours stand when its token moves. A file in
  an older layout is always rebuilt. Unset is the old rule.

### The database (migration 0206, additive)

These indexes are `create index if not exists`, not `CONCURRENTLY`, because a migration runs in a
transaction. On today's tables each builds in under a second.

- `games (competition_id, tipoff_at)`: a league's fixtures in order.
- `external_games (competition_code, tipoff_at) where external_status <> 'final'`: the live lane's and the
  catch-up's question on every pass.
- `competition_teams (team_id)` and `standings (team_id)`: a club's competitions and table rows.
- `game_events (game_id) where period <= 2 and clock > 600000`: `game_in_halves`, answered from an index
  that holds almost nothing.

RLS was already made cheap for the row-heavy tables by 0151 (a fast path, not one function call per row),
so 0206 does not touch it.

---

## 4. What is left, most important first

1. **HOME counts clubs by reading every club, and stops at 1,000.**
   - The files: `epinoia/home/leagues.js` `clubCounts`, `home/favourites.js` `clubCounts` and
     `home/private-leagues.js`. Each asks for `teams?select=league_id&league_id=not.is.null`.
   - Today that is 982 rows. With NCAA it is ~2,450, cut to 1,000, so **HOME's club counts go wrong**.
   - Use `leagues?select=id,teams(count)` instead, as scouting now does. This is another session's file.
     The exact change is in the hand-off notes, along with the `country.test.mjs` assertion it needs.
2. **HOME's daily fixtures and cards.**
   - With 300-640 NCAA games a day, the daily list needs grouping or capping by followed and popular
     leagues.
   - `globalgames.js` `periodLabel` and "Half-time" assume quarters. Read `periods:rules->periods` with
     the league, write `(n === 2 ? 'H' : 'Q') + p`, and treat half-time as period `n / 2` at 0:00, as
     `game/dyntable.js` `periodLabel` already does.
   - This is another session's file. See the hand-off notes.
3. **Data quality of the NCAA play-by-play.**
   - 19 of 43 captured logs do not add up to the score and are published as results only.
   - Such a game keeps the partial log its live writes left, which the box score replays, and has no
     player season lines.
   - Improving the scraper's parse is the biggest single item for NCAA statistics.
   - Re-measure on a random sample of ~200 games during the pilot.
4. **Live cadence and ncaa.com.**
   - Choose the shard count from the table in §2. Eight shards give ~2-minute freshness at the peak and
     ~7 requests a second to sdataprod.
   - **`sdataprod.ncaa.com` is the API behind ncaa.com's public pages, not a published feed.**
     `docs/data-protection.md`'s own policy is that a page's table is tolerated and an API without a plan
     is not.
   - Before go-live, read ncaa.com's terms and consider asking the NCAA, or its stats provider, for
     permission or a feed.
   - **Fallbacks per school:**
     - Sidearm Sports stats pages and box-score XML (most D2/D3 athletics sites run Sidearm);
     - PrestoSports `/sports/mbkb/<season>/boxscores/`;
     - StatBroadcast;
     - stats.ncaa.org box scores and play-by-play.

     All are per-school or per-host, and slower to integrate.
5. **Labels still in quarters** (cosmetic, a game in halves still computes correctly):
   - `socialcard.js` (a game in halves gets no period table); the fixture strip labels halves H1/H2 from the
     league's `rules.periods` since it took HOME's card (2026-10-08);
   - `p/video.js`, `video.js` and `video/videohub.js` coverage notes;
   - the scorer app itself (`score/index.html`), which is fed, not scored, for NCAA.
6. **The snapshots function lists every game on every call.**
   - `buildEventFiles` reads every public game, every final and every `event_files` row on each 5-minute
     call while games finish. At 30k games that is ~100 requests a call.
   - Make the listing incremental: the finals since the newest file built, with the full reconciliation
     once a day.
7. **SEO pages.**
   - `tools/build-seo.py` writes a page per player with a finished game. NCAA adds ~20k pages (~20 KB
     each, ~400 MB) to a GitHub Pages site whose limit is 1 GB.
   - Limit NCAA to players with at least N games, or leave NCAA players out.
   - The sitemap's 50,000-URL guard already exists.
8. **A duplicate index on `game_events`.**
   - `0001` declares `unique (game_id, seq)` and also `create index on public.game_events (game_id, seq)`.
     The second doubles that index's write cost on the biggest table.
   - Dropping it is not additive, so it is not in 0206. Run it by hand after checking (§5).
9. **Search** queries `ilike '*x*'` on `players` and `teams` with a limit. That is server-side and fine at
   30k players. Add a `pg_trgm` GIN index only if it shows in slow queries.

---

## 5. What the owner must do

**Supabase dashboard**

1. **Compute.**
   - Small (2 GB) before the pilot.
   - Medium (4 GB) before all four divisions.
   - Settings → Compute and Disk.
2. **Disk.** Leave autoscaling on and expect +4-10 GB a season. Set a usage alert.
3. **Spend cap and alerts.** Egress (big seasons and audience) and Realtime connections are the
   audience-dependent ones. Decide the cap before the first college Saturday.
4. **Apply 0206** with `npx supabase db push`, in the morning UTC when no league is live. Its self-test
   runs first.
5. **Optional: drop the duplicate index**, after reading what is there:

   ```sql
   select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'game_events';
   -- keep the UNIQUE constraint's index (game_events_game_id_seq_key); drop the plain duplicate, e.g.:
   drop index concurrently if exists public.game_events_game_id_seq_idx;
   ```

   `drop index concurrently` cannot run in a transaction. Run it alone in the SQL editor.

**GitHub**

1. Repository variables:
   - `NCAA_SHARDS` = 4 for the pilot, 8 for the season;
   - `BIG_SEASONS_MIN_GAP_H` = 6.
2. Uncomment the schedule in `.github/workflows/ingest-ncaa.yml` at go-live.
3. `SCRAPER_REPO` and `SCRAPER_DEPLOY_KEY` are already used by `ingest.yml`. The NCAA lane uses the same
   pair.

**scraper-pipeline**

- Optional: apply `docs/ncaa/scraper-ncaa-women.patch`. The website's adapter works without it.

---

## 6. Source rows (example, not enabled)

```json
{ "code": "NCAA_D3M", "label": "NCAA Division III Men", "adapter": "ncaa", "enabled": true,
  "create_league": true, "league_slug": "ncaa-d3-men", "league_name": "NCAA Division III Men",
  "league_country": "US", "league_gender": "men",
  "league_rules": { "periods": 2, "period_ms": 1200000, "ot_ms": 300000, "bonus_at": 7 },
  "live_lane": "ncaa", "repo_feed": false,
  "adapter_config": { "code": "NCAA_D3M", "sport": "MBB", "division": 3, "season_refresh_s": 900,
                      "groups_from_feed": true, "competition_format": "conferences",
                      "archive_raw": true, "store_pbp": false, "auto_create": true },
  "scheduleUrls": ["https://www.ncaa.com/scoreboard/basketball-men/d3"] }
```

The women's rows are the same with:

- `"sport": "WBB"`;
- `/basketball-women/`;
- no `league_rules` (quarters are the default);
- `"league_gender": "women"`.

D2 rows use `"division": 2` and `/d2`. `repo_feed: false` keeps the payloads out of git, as
`docs/large-leagues.md` says.

---

## 7. Go-live checklist (pilot with one D2 conference first)

1. 0206 applied. Compute on Small. Alerts set.
2. **One conference, in one division, for one gender.**
   - Its source row, with `adapter_config.dates` or the default window.
   - `--source NCAA_D2M --dry-run` locally with `SCRAPER_DIR` set. Read the discovery count and two games'
     translation.
3. **First real night.**
   - Run `ingest-ncaa.yml` by hand with `shards=1`.
   - Watch in the log:
     - "published as a result only" lines (the plays did not add up);
     - lineup warnings;
     - the write cadence.
   - Then open three box scores: H1/H2, minutes 200 a side, half-time report at the break.
4. **After the night.**
   - `close_stuck_games` and `--repair-stalled` find nothing.
   - The standings by conference look right (`docs/conferences.md`).
   - The big-season file is built, or "being built" is shown.
5. **Measure.**
   - The result-only share on a random 200 games.
   - The DB size delta per game.
   - Egress per day.

   Then decide the shards and the floors for the full season.
6. **Widen.** All of D2 men, then D2 women, then D3. Raise `NCAA_SHARDS` and compute as the table in §2
   says.
