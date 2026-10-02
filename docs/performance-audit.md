# Performance audit — what makes a page heavy, and what was done

Measured 2 October 2026 against the live database, signed out, in Chromium (Playwright, a fresh profile per page,
service worker blocked, 1280×900), serving this repository locally. Each page was scrolled to the bottom so every
lazy section loaded, then left to settle (network idle twice, 1.5 s apart). Counted: Supabase requests (REST and
RPC; storage files separately), bytes transferred (`encodedDataLength`, i.e. compressed on the wire), time until
the last request finished, duplicate requests, and main-thread long tasks (`PerformanceObserver('longtask')`).
The league pages use CIBACOPA (256 finished games in its current season, the third biggest on the platform); a
first pass on ORLEN Basket Liga measured almost nothing because its current season (2026-27) has no finals yet.

Timings move by a second or two between runs (the network, the database's load); requests and bytes do not. The
scripts are not part of the repository; the method above is all they did.

## The table

REST = rest/v1 tables and RPCs; storage = public files (season snapshots, event logs, crests, photographs).
"after" is with this branch's changes; HOME and the league front page read the new records board from a stub
answering what migration 0215 answers (see *Verifying the records* below), because the live database does not
have 0215 yet.

| Rank | Page | REST before → after | Storage before → after | Settled before → after | Cause | Fix |
|---:|---|---|---|---|---|---|
| 1 | **HOME — Global records** (and HOME `#leagues`, the same page) | 49 req / 526 KB → **17 / 225 KB** (records alone: 17 reads → **1**, 6.6 KB gzipped) | 25 / 315 KB → 17 / 154 KB | 18.6 s → **4.1 s** (records drawn: 13.9 s → 2.8 s) | `records.js global()` read every finished game on the platform (1,799 rows, 160 KB), every season, then one sorted `player_game_stats` read per statistic across ~40 competitions (each an inner join + `order by stats->key` over ~40,000 rows through the row policy) and every team line of those seasons (93 KB). The sorted reads hit the 3 s statement timeout: **HTTP 500s, retried**, in two of three runs. | **Migration 0215**: the records are kept in the database as games are finalised, and `records_board()` answers the section in one request. Details below. |
| 2 | **Injury report, global** (`/injuries/`) | 445 req / **5,748 KB** → 327 / **1,490 KB** | — | 35.4 s → 17.1 s | `wire.js` asked `EpinoiaData.season()` with the rows kept, for every league: every player line's ~33 statistics, every team line whole, the members' events splits (`game_sit_lines`), summed into season lines the page never draws. The report reads four fields. | Read the games and, of each line, `game_id, player_uuid, player_id, team_idx, min:stats->min` only. Same output (compared text, global and CIBACOPA). |
| 2b | Injury report, one league (`?l=cibacopa`) | 48 / 1,270 KB → 33 / 300 KB | — | 7.2 s → 5.5 s | as above | as above |
| 3 | **League front page — Records** | 80 / 220 KB → 67 / 169 KB (records: 13 reads → **1**, 2.3 KB gzipped) | (images vary run to run) | 8.3 s → 5.3 s (records drawn: 6.9–9.3 s → 2.1–2.9 s on seven leagues) | `records.js load()`: the season's finals, seven sorted `player_game_stats` reads (rebounds two, widened when needed), every team line of the season, names in two reads a 40, photographs | the board (0215), one request |
| 4 | **WOWY** (`/stats/wowy/`) | 32 / **1,272 KB** → 32 / **538 KB** | 68 / 1,151 KB → 86 / 1,647 KB (photographs; varies) | 20.3 s → 10.1 s | the league's lineup stints, read whole for the colours' reference: each stint's `stats` repeats the five ids and carries a dozen derived rates the page recomputes | `leanStints()`: `player_ids, dur, off, def` by JSON path, put back into the shape `stints()` returns. Same output (compared text). |
| 5 | Team page | 52 / 399 KB (unchanged) | 60 / 833 KB | 7.5 s | 53 event-log files (803 KB) for shots / shot clock / rotations, already lazy (`whenNear`) and already CDN files; `player_game_stats` 200 KB is the depth chart's minutes | **depth chart: handled elsewhere** (not touched). Event logs: recommendation R3. |
| 6 | Player page | 24 / 257 KB (unchanged) | 57 / 1,009 KB | 9.1 s | 54 event-log files (949 KB) for the player's shot chart / rotations, lazy and on the CDN; `lineup_stints` 199 KB | recommendation R3 |
| 7 | Fixtures | 27 / 326 KB (unchanged) | 7 / 33 KB | 6.2 s | the leaders under each finished game: four numbers of every player line of every game on screen (211 KB for 256 games); already narrowed and held once a page | recommendation R4 |
| 8 | League front page — the rest | 67 requests | | | the league row read 5× (`leagues?slug=…&select=*`), the seasons 4×, competitions 4×, `leagues?…select=id,slug,name` 3×, by home.js, seasonbar.js, access.js and data.js each on its own | recommendation R5 |
| — | Statistics, table, game, global games, news, what wins, scouting | 7–14 req, 19–75 KB each | | 2.4–6 s | already served from season snapshots / narrow reads | nothing needed |

Long tasks: no page had a long task budget problem except WOWY (1.9–2.4 s of main thread, the play-by-play replay
into segments; R6). The rest are 0.1–0.9 s in total, spread over 2–9 tasks.

## The records, kept (migration 0215)

### What the pages showed, and still show

`epinoia/records.js` draws two sets behind one switch, for a league's current season (front page) and for every
league's current season (HOME):

- **player**: points, rebounds (offensive + defensive), assists, steals, blocks, threes made — one player in one game;
- **team**: points (the side's score), winning margin, threes made, assists, rebound margin (one side's rebounds
  minus the other's) — one side in one game;
- a value must be above nought; **a tie is shared**, credited to whoever set it first (tip-off, then game id), and
  the card says how many share it;
- a player the reader may not see by name (a minor without consent, an unregistered line) is passed over and the
  record goes to the next line, among the best twelve lines (rebounds: among every line read);
- HOME's filters: ALL, MEN'S, WOMEN'S (by the league's gender), U22 (by age, players only).

Nothing about this changed. The board reproduces it exactly; see *Verifying*.

### Storage: a table, read through one RPC (not a JSON file in Storage)

- **Atomic with the finalise.** The lists change in the same transaction that finalises (or corrects) the game, so a
  page never sees a game final without its records, and two finalises cannot overwrite each other's file. A JSON
  file would be a read-modify-write outside the transaction, needing its own locking and a writer with the service
  key on every path that finalises (the ingest, finalise-game, close-stuck-games, an administrator's edit).
- **Every read policy applies to the reader**, for free: a private league, a members-only league, a withheld minor's
  name and an unapproved photograph are hidden exactly as the old reads hid them, and a member sees their private
  league's records. A file in a public bucket can only hold what everybody may see, and would need one per audience.
- **Small and cheap.** 4,305 rows for 57 competitions with finished games (about 75 a competition); the HOME answer
  is 22 KB (6.6 KB gzipped) and took 65 ms on a local copy of the live data; a league's is 10 KB (2.3 KB gzipped),
  12 ms.
- The cost: it is a database read (no CDN cache), one per page view. At this size that is negligible next to what
  it replaces; if HOME's traffic ever makes it matter, the snapshots function can copy `records_board()`'s answer to
  a file the same way it copies the podiums.

### Tables

| Table | What | Who reads it |
|---|---|---|
| `record_lines` | per competition and statistic, the lines that can hold its record: a player statistic's best 12 and every line level with the best; a team statistic's lines level with the best. `(competition_id, kind, cat, game_id, subject, pid, side, value)` — names, dates, clubs and scores are joined when read, so a corrected name or date needs nothing here | the policy of `player_game_stats` (0151's fast path, then `can_read_game_rows`) |
| `record_comps` | per competition: finished games, the latest one, `stale` | whoever may see its latest finished game (`games`' policies) |
| `records_state` | one row: `ready` once the backfill has finished | everybody |

Twelve is what the page read (it cut each sorted read at twelve), so the union of each competition's twelve always
holds a season's or the platform's best twelve: merging competitions is exact.

### Kept on every path that finalises

Triggers, so nothing that finalises has to know:

- `games`: after insert (a final game), after update of `status`, `competition_id`, `home_score`, `away_score` (only
  when the game is or was final and one of them moved), after delete;
- `player_game_stats` and `team_game_stats`: after insert, update and delete, **once per statement**, with transition
  tables, for each final game the statement touched (a live game's lines, written all evening, cost one look at
  `games`).

Each hands the game to `records_apply_game(game)`:

1. **Lock** each competition involved (`pg_advisory_xact_lock` on a hash of its id), always in the same order. Two
   games finalised at once in one competition are applied one after the other, each seeing the other's committed
   lines (read committed: every statement after the lock takes a fresh snapshot). The tests show both orders end in
   the lists a rebuild from nothing gives.
2. **Count** the competition's finished games (`record_comps`); none left, nothing kept.
3. A competition never built (before the backfill, or brand new) or marked stale is **built whole**.
4. A game no longer final, moved elsewhere, or deleted: its lines leave, and each list they were on is rebuilt.
5. **A correction**: a line of this game on a list that went down or disappeared means the next best may be anywhere
   in the competition, so that one list is rebuilt from the competition's lines (one competition, one statistic:
   a scan of a season's lines). Nothing else is recomputed.
6. Otherwise the game's lines go in **only where they reach a list** — a guarded upsert: a list not yet full takes
   any line, a full one only a line at least level with its last — and each list touched is cut back to its length.
   A game that sets nothing changes nothing.

**Never fatal.** `records_touch` wraps it: any error is caught, raised as a warning, and the competition marked
`stale`, so it is rebuilt whole at its next touch or by the backfill. A finalise never fails because of a record.

The functions that write are `security definer`, not callable by `anon` or `authenticated`.

### Read: `records_board(p_comps, p_filter)`

`GET /rest/v1/rpc/records_board?p_comps=<ids, comma-separated>&p_filter=all` for a league's season;
`?p_filter=all|men|women` with no `p_comps` for HOME, where it picks each league's newest season with a finished game
the reader can see (the old rule). `security invoker`, so every policy is the reader's. It answers, in one row:
`ready`, `games`, `leagues`, the competitions it used (with their league), the player and team records (value, tie
count, holder, the game, the league, the player's name, slug and photograph) and the clubs on them (with their latest
approved crest).

`records.js`:
- `load({comps})` (a league's front page, the creator hub) and `global({filter})` (HOME) ask the board first;
- **the old reads run only when the board is not there**: a 404/400 (a database before 0215 — remembered for the
  page, so it is asked once) or `ready: false` (before the backfill has finished);
- **U22** takes the board's seasons and runs the old player reads over those competitions only (an age is not
  something a kept list can know); it no longer reads every finished game on the platform first.

### Backfill (gently: one competition a call, 0219)

0215's `records_backfill(25)` built up to 25 competitions in one transaction, holding each competition's lock (the
lock a finalise takes for it) until the last was built. 0219 replaces it with **`records_backfill_step()`**: one
competition a call, built whole in one short transaction, and the competition's lock only **tried** — a competition
a finalise is working on at that moment is passed over and taken on a later call, so the backfill never waits for a
finalise and a finalise waits at most one competition's build. Its own `lock_timeout` (2 s) and `statement_timeout`
(20 s, applied by PostgREST before the call). It answers
`{"built": 1, "competition": "…", "games": 272, "ms": 140, "left": 41, "ready": false, "busy": 0}`; when `left`
reaches 0 it sets `records_state.ready` and the pages switch over. Finding the next competition and counting what is
left go through `games_competition_status` and `record_comps`' key (about 2 ms); no new index.

Measured on PGlite with every migration applied (`supabase/tests/records-backfill.test.mjs` prints these): a
300-game competition 1.0–1.2 s, 120 games 0.4 s, 20 games 0.07 s; the call once everything is built 1 ms. (The
biggest competition on the platform has 272 finished games; a real Postgres is faster than PGlite.)

**Run it paced, from GitHub** (after `npx supabase db push`): Actions → **Records backfill** → Run workflow
(`.github/workflows/records-backfill.yml`, `scripts/records_backfill.mjs`). It calls the step with the service key,
waits 1.5 s (twice that after a step that found every candidate busy), calls again, until `left` is 0 or the budget
(20 minutes) is spent — a second run carries on. One log line a step. The 57 competitions take about two minutes.
It also runs nightly at 03:23 UTC: one call once everything is built, and a rebuild of any competition a failure
marked stale since.

**Or by hand, in the SQL editor**, one competition a run:

```sql
select public.records_backfill_step();   -- run again until it answers "left": 0
```

(`select public.records_backfill(25);`, the call 0215 printed, now does one step too.) Safe while games are being
finalised and safe to run again. To rebuild everything later: `update record_comps set stale = true;` then the
backfill again.

**The triggers on game writes** (0215, unchanged; measured on PGlite with and without them): a live game's score
update costs their `WHEN` clause only (+0.01 ms; they fire only when a *final* game's status, competition or score
changes); a live game's 24 player lines upserted in one statement +0.2–0.3 ms, its two team lines +0.2 ms (one
statement-level trigger, one look at `games` for the statement, nothing a row); correcting one line of a final game
in a 120-game competition +12 ms (its lines checked against the lists, the lists it reaches cut back).

### Verifying the records

- **PGlite** (`supabase/tests/records-store.test.mjs`, in guard.yml): 0215 on stand-ins for the tables and policies
  it relies on, with a seeded fixture of three leagues (one women's, one private), two seasons each, ties, missing
  statistics, unregistered lines, a withheld minor and approved/unapproved photographs. The old `records.js` reads are
  run against the same database (as a signed-out reader, sorted and cut as PostgREST did) and the board must match
  them exactly — values, holders, tie counts, clubs, names, photographs — for three league seasons and for ALL / MEN'S
  / WOMEN'S across leagues, before and after every change below. Also: one request each; a record replaced only when
  surpassed; a tie shared and credited to whoever set it first; the list length; either finalise order equal to a
  rebuild from nothing; a corrected score and a corrected line handing the record to the next best; a revert, a
  re-finalise, a move and a delete; a private league invisible signed out and visible to its member; a withheld minor
  never named; a failure caught, marked stale and rebuilt; the migration loading twice.
- **Real data**: every public league's finished games, lines (only the seven statistics and four team numbers, by
  JSON path), players, crests and photographs were copied read-only into PGlite, 0215 applied and backfilled, and
  Chromium loaded HOME and seven league front pages twice: live (old reads) and with `records_board` stubbed from
  that copy. **Every card's text, link and photograph was identical** on HOME (11 records across 47 leagues and
  1,509 games) and on CIBACOPA, LNBP, CEBL, BCB, EuroLeague and Primera FEB (SLB Women's front page shows no records
  section either way).

Two places where the board can differ from the old reads, neither seen in the data:
- **rebounds**: the old reads widened their offensive/defensive lists until the best total was certain and passed
  over unnamed players among all of those lines; the board keeps the best twelve totals (and ties). Only a season
  whose twelve best rebounding games all belong to players the reader may not name would differ;
- a statistic stored as a JSON *string* holding a number sorts after every number in PostgREST's `order=stats->key`,
  so the old reads would effectively ignore it; the board reads it as the number. No such values are in the data.

## What the user must run

1. `npx supabase db push` — applies `0215_records.sql` (tables, policies, triggers, functions; idempotent) and
   `0219_records_backfill_gentle.sql` (the one-competition step).
2. Actions → **Records backfill** → Run workflow (paced, logs each step); or in the SQL editor
   `select public.records_backfill_step();` until `"left": 0`.

No Edge Function to deploy. Until step 2 has finished the pages work the records out as before.

## Recommendations (not done here)

- **R1 — U22 global records may still time out.** The U22 path keeps the old sorted reads (now over the current
  seasons' competitions only, which helps; the join and sort through the row policy is what timed out). Fix: a
  `records_u22` RPC (security invoker) that narrows to players born in the last 22 years before it sorts, or kept
  per-competition lists for those players, rebuilt once a year when the birth-year floor moves. About half a day.
- **R2 — the global injury report is still 327 requests.** It is now cheap per request but per league: games, lines
  in 40-game chunks, clubs, releases, names. A per-league appearances file written by the snapshots function after
  each final (`snapshots/appearances/<season>.json`: per game the ids, sides and minutes, ~40 bytes a line) would make
  it one CDN file a league, or an RPC returning the report's input for all leagues at once. About a day.
- **R3 — team and player pages read one event-log file per game** (53–54 files, 0.8–1 MB) for shot zones, shot clock
  and rotations. They are already lazy and on the CDN; a per-team season bundle (`snapshots/events/team/<id>.json`)
  built by the same function would make it one file. About a day, including the invalidation.
- **R4 — fixtures' leaders**: 211 KB of four numbers a line for a season of games. A `game_leaders(p_games)` RPC (or a
  `leaders` jsonb on `games` filled at finalise) would make it a few KB. Half a day.
- **R5 — the league front page reads its league row five times** (and seasons and competitions four) through four
  modules' own fetches. One page-level promise for the league row and seasonbar's `load()` shared through
  `EpinoiaData` would remove about 12 requests (~30 KB). Two hours, but it touches five files other work is changing.
- **R6 — WOWY's 2 s of main thread** is the play-by-play replay into segments (`lineupevents.js gameSegments`). It
  could run in a worker (the page already caches segments per game in sessionStorage). Half a day.
- **R7 — photographs** (`media-public/players/*/fiba.png`, 30–50 KB each at full size) are drawn at 40–96 px. Crests
  already go through Storage's image transformation at display size; photographs could too. Two hours.
- **Depth chart** (team page `player_game_stats` minutes, 200 KB; `depthInput`, `floorMinutes`): **handled
  elsewhere** — another piece of work owns `epinoia/t/depth.js`, the depth-chart code in `team.js` and
  `position.js`; nothing was changed there.
