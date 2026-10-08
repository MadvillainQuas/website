# What wins 2: a members-only model of what wins basketball games

Status: frozen for the v1 build, 2026-10-01. The contract six work packages build against (§19). A package that finds
it impossible records the deviation here in the same pull request. Base design "systems" (best of three by the judges),
with the grafts from "rigour" and "product" listed in §0.3.

## 0. Decisions

### 0.1 The answer to the request
Yes. What wins can use every play-by-play and event statistic, chart how pace and time of possession relate to winning,
value every factor in points per game and in wins, work per position and per squad shape, feed the Front office, and
run a calibrated possession-level model that says what is needed to win and why a game was lost. Efficiently, and
without opening a bulk stream:
1. Every finished game is reduced once, on the server, to a **feature line** of 108 counts per side (§3): one shared
   module, `epinoia/features.js`, run inside `finalise-game` (+≤ 6 ms) and by a one-off backfill. About 0.5 KB a row.
2. The lines live in `game_features` (migration 0207), readable by the service role only.
3. A GitHub Action (`tools/build-analytics.mjs`, hourly with a floor) reads only new lines since its watermark, fits the
   models and writes small JSON files to a **private** bucket `analytics`: per league-season an analysis file (`wins`)
   and a Front office file (`fo`), one file per club (`club`), and a pooled `wins` file.
4. A page asks the Edge Function `analytics-file` for one file. The database decides at request time
   (`analytics_check`, run with the caller's own token), a per-user / per-IP limit applies (`analytics_take`), and the
   function returns a 120 s signed URL. One file (≤ 300 KB) draws everything; re-fits and simulations run in the
   browser (simulations in a Web Worker).
5. The public sees a box-score preview (`snapshots/whatwins/…`, ≤ 40 KB) for public, free-analytics leagues only.

### 0.2 Three lenses, never mixed
| Lens | Question | Method | Label |
|---|---|---|---|
| Explain | What decided the games played? | same-game differences against the margin (accounting, R² ≈ 0.94) | EXPLAINS |
| Forecast | What do the numbers so far say about the next games? | season-to-date profiles, validated out of sample | FORECASTS |
| Simulate | What if a team changed one thing? | calibrated possession simulator | MODEL |

Accounting says where points came from, not what to change; the simulator is a model's answer, never proof of cause.

### 0.3 Grafts and code checks
- From rigour: competitive-time four factors (garbage time out) as the Explain and causes-of-loss inputs (§7.2, §7.11);
  DerSimonian-Laird EB with fallback and the pooled weight shown (§7.4); blocks of ≥ 8 games (§7.0); √N on pre-game
  expected possessions and the Forecast gate (§7.8, §7.10); three-level positions incl. a week-cut slot forecast (§7.12);
  value-ranked needs and the roster what-if (§12); numeric acceptance tests (§16); the open-league hash in the pooled and
  teaser tokens (§6.1); the loader rejecting an unknown layout (§10.2).
- From product: `pace3q` (first 75% of regulation) as the realised pace (§7.10); wins from σ_pred, never σ_acc (I9); the
  ZONES bit requiring engine/situations rim agreement (§3.4); the shot-quality / shot-making split (§7.11); the short
  answer with hard thresholds (§11); slot targets and the shooters × bigs grid (§7.12-13); a light games read for the
  Front office (§12).
- Checked in code: `isRim` is a closure in `deriveGame` (engine.js L293), so zone counts come from `teamAdv`
  (`rimA/rimM/midA/midM`) and the engine is not edited. `teamFoulsNow` exists but reads the live period only, so the
  bonus is worked out in features.js's own walk (§3.2). `seasonLogs()` (t/team.js) feeds four sections (L316, L367, L405,
  L970) and stays as it is. The publishable key is not a JWT, so `analytics-file` is `verify_jwt = false` and checks
  access itself, like `fanvote`.

### 0.4 Not claimed
No contract or salary construction (no data). No player substitution inside the simulator. No causal claims from
observational data. Positions are estimated (about 42% of active roster entries list one).

## 1. Invariants (WP6's ww-contract test checks those a file can show)
- **I1** No browser reads `game_events`, `game_features`, `player_game_stats`, `lineup_stints` or `team_game_stats` for
  this feature; pages read files through `EpinoiaWinFile` plus public leagues, seasons and the club's fixtures.
  *Transition:* until the builder has published the teaser, the What wins page's public part falls back to its
  previous reading (`winning/boxpreview.js`, loaded only when the teaser index is missing, unreachable or of another
  layout): the finished games and the 18 public box-score keys of `team_game_stats` (winning.js `SELECT`, 150 games a
  request), cached six hours in memory and sessionStorage under the reader's `epinoia_ww:` key. Never events, feature
  lines, player rows or lineups; once the teaser exists it is never loaded.
- **I2** `game_features`: RLS on, no policies, no grants to anon or authenticated.
- **I3** Bucket `analytics`: private, no `storage.objects` policy; files only through 120 s signed URLs issued by
  `analytics-file` after `analytics_check` (caller's token) and `analytics_take`.
- **I4** The only public output is the teaser: aggregates of `pub` factors (§3.6) for `analytics_open_leagues()`.
- **I5** The pooled file has per-league rows only for `analytics_open_leagues()` and no sufficient-statistic blocks;
  other leagues contribute to pooled estimates only.
- **I6** No player names in any file; per-player rows leave out withheld players (`player_withheld(is_minor,
  public_consent)`); a club file holds only that club's games; no file holds a per-game feature vector; every block
  covers ≥ 8 games.
- **I7** The browser caches in memory and sessionStorage keyed by user, never localStorage, and deletes the legacy
  `epinoia_winning_v1` key.
- **I8** No new code selects `stats->sit` or a whole `stats` blob (the builder's call of data.js `season()` is unchanged
  and its event splits are not copied into any file).
- **I9** Points become wins with σ_pred (spread around a pre-game expectation, ≈ 11-13), never σ_acc (≈ 4, 3× too many wins).
- **I10** Every number shows its lens, its n and, for an estimate, a 95% interval.

## 2. Architecture
```
finalise-game: deriveGame, teamAdv, situations (already) + EpinoiaFeatures.extract → upsert 2 rows (non-fatal)
                                   └──► public.game_features (service only) ◄── scripts/backfill_features.mjs
tools/build-analytics.mjs (Actions): keyset read after watermark → private store (the bucket only; B.5)
  → EpinoiaWinModel (EpinoiaWinStats, EpinoiaWinSim) → analytics/{wins,fo,club}/… + public.analytics_files
  → snapshots/whatwins/… (public teaser, box score only)
browser: POST /functions/v1/analytics-file {scope, league, season, team} → {url (signed 120 s), token, bytes, built_at,
  layout} | 401/403/404/429 → GET url → vizkit charts; winstats re-fits; winsim.worker.js simulations
```

## 3. The feature line (FV 1): epinoia/features.js
UMD `window.EpinoiaFeatures` (CommonJS in node), generated into `supabase/functions/_shared/features.js` by
`supabase/tests/extract-shared.mjs`. Pure.

### 3.1 Inputs
`extract(game, pre)`. `game` is finalise-game's object `{teams:[{players:[{id,name,num}]}×2], starters:[[pid×5]×2],
events, period, clockMs, format?}`, events mapped as finalise maps them (`{id: seq, seq, t, team, pid, period, clock,
...payload}`). `pre = {d, TA, C}` (deriveGame, `[teamAdv×2]`, `situations.compute`): finalise passes what it already
holds (index.ts ~L290, ~L352); missing pieces are computed. Dependencies: `root.EpinoiaEngine/Possessions/ShotClock/
Situations`, else `require('./x.js')` (the shotclock.js pattern). Never throws on a thin feed: NaN and a cleared bit.

### 3.2 Definitions
- `F = d.format || formatOf(game)`, `REG_MS = F.periods × F.period_ms`, `cum = Engine.cumEl(period, clock, F)`.
- `plays` = `Situations.inGameOrder(events)` without `loc`/`tag`/`stype`. `P = Possessions.enumerate({events: plays})`,
  `SC = ShotClock.compute({events})`; an SC possession's `index` points into `P.possessions`.
- Possession start = `cum(gainPeriod, gainClock)` of `P.possessions[index]`; remaining regulation = `REG_MS − start`
  (a period above `F.periods` is overtime). Margin at start = the side's score minus the other's just before the play
  whose seq is the possession's `startEventId` (running score: p2_made 2, p3_made 3, ft_made 1).
- Clutch possession: overtime, or remaining ≤ 300,000 ms, with |margin| ≤ 5. Garbage possession: regulation, and
  (remaining ≤ 480,000 and |margin| ≥ 20) or (remaining ≤ 240,000 and |margin| ≥ 13). Exported `CLUTCH_MS`, `GARBAGE`.
- Live-ball turnover: a `to` by t with a `stl` by 1−t at play index i−2…i+3, same period, |Δclock| ≤ 2,000 ms (pairs
  every steal on three live feeds checked 2026-10-01). Offensive-foul turnover: a `to` by t with a `foul` kind
  'offensive' by t at i−2…i+2, |Δclock| ≤ 1,000, or a stype matching /offensive|charg/i. Turnover stype = `d.stypes[id]`:
  bad pass /pass/, handling /travel|dribbl|carr|palm|handl/.
- FT trip: consecutive `ft_made`/`ft_miss` of one team, one pid, one period, within 1,000 ms, with only `sub`, `timeout`,
  `foul` or `ast` plays between (FIBA logs an assist between FTs). Its foul: the other side's `foul` nearest by index
  within ±6 plays, same period, |Δclock| ≤ 1,000 (kind 'none' if absent). And-one: a size-1 trip of kind 'shooting' or
  'none' with a made FG by the same team (same pid when both have one) within ±4 plays, |Δclock| ≤ 1,000.
- Bonus trip: foul kind 'personal' (or empty) and the fouler's team fouls in the period, counting it, ≥ `BONUS[F.periods]`
  = 5 for quarters, 7 for halves; team fouls counted as the engine keys them (bench techs without pid out; overtime in
  period F.periods).
- Lead change: a side takes the lead from the other (a tie does not reset who led). Tie: a score levels the game above
  0-0. Run: consecutive points by one side.

### 3.3 Layout (index: key; agg sum unless *mean*; side own unless **game**; ✓ = pub; [bit] = need)
- 0-26 box, from `TA` and `T = d.team[t]`, all ✓: 0 pts, 1 fga, 2 fgm, 3 fg3a, 4 fg3m, 5 fta, 6 ftm, 7 oreb, 8 dreb,
  9 tov, 10 ast, 11 stl, 12 blk, 13 rim_a [ZONES], 14 rim_m [ZONES], 15 mid_a [ZONES], 16 mid_m [ZONES],
  17 poss_est (TA.possessions), 18 **minutes** (TA.minutes/5, overtime included), 19 pts_paint (T.paint), 20 pts_fast
  (T.fast), 21 pts_second (T.sc), 22 pts_offto (T.pot), 23 pts_bench (T.bench), 24 fouls (T.foulTot), 25 timeouts
  (T.tos.h1 + h2 + Σot), 26 max_lead *mean* (T.lead).
- 27-42 possessions and time (SC/P): 27 poss (SC possessions), 28 chances (SC chances), 29 poss_3q (start < 0.75·REG_MS),
  30 **reg_min** (REG_MS/60000), 31 gain_dreb, 32 timed_n (dur ≠ null), 33 timed_s [TIMED] (Σ dur, s), 34 fc_n [TIMED]
  (timed first chances), 35 fc_e_n, 36 fc_e_pts (dur ≤ 8), 37 fc_m_n, 38 fc_m_pts (8 < dur ≤ 16), 39 fc_l_n,
  40 fc_l_pts (dur > 16) [all TIMED], 41 reb_off_ch, 42 reb_def_ch (chances with reb 'off' / 'def').
- 43-56 situations, `C = situations.compute(...).side[t]`, all [SIT]: 43 sit_ch (sits.all.chances), 44 tr_ch, 45 tr_pts,
  46 hc_ch, 47 hc_pts (half), 48 sc_ch, 49 sc_pts (second), 50 offto_ch, 51 offto_pts, 52 ato_n, 53 ato_pts,
  54 fgm_ast, 55 fgm_unast (assists.ast/unast.fgm), 56 fg3m_ast (assists.ast.p3m).
- 57-62 turnovers: 57 to_n, 58 to_live [STL], 59 to_typed, 60 to_badpass [STYPE], 61 to_handle [STYPE],
  62 to_offfoul [FOULKIND].
- 63-70 fouls and FTs: 63 fouls_shooting [FOULKIND], 64 fouls_offensive [FOULKIND], 65 techs (kind tech or unsport, pid
  or not), 66 ft_trips, 67 and1, 68 trips_shooting [FOULKIND] (and-ones out), 69 trips_bonus [FOULKIND],
  70 fta_bonus [FOULKIND].
- 71-80 flow (own walk): 71 **lead_changes** *mean*, 72 **ties** *mean*, 73 lead_ms (ms ahead), 74 max_deficit *mean*,
  75 best_run *mean*, 76 runs8 (runs reaching 8), 77 pts_h1 (Σ d.perQ for p ≤ F.periods/2), 78 pts_h2 (to F.periods),
  79 pts_ot, 80 **ot_periods**.
- 81-86 clutch possessions: 81 cl_poss, 82 cl_pts, 83 cl_tov, 84 cl_fga, 85 cl_efgm (Σ fgm + 0.5·p3m), 86 cl_fta.
- 87-95 competitive (non-garbage) possessions: 87 g_poss (garbage count), 88 c_pts, 89 c_fga, 90 c_efgm, 91 c_fta,
  92 c_ftm, 93 c_tov, 94 c_reb_off, 95 c_reb_def.
- 96-104 rotation (*mean* unless noted): 96 players_used, 97 rot_n (≥ 600,000 ms), 98 top5_min_share,
  99 starters_min_share [STARTERS], 100 usg_hhi (100·Σ(u_i/U)², u = p2a + p3a + 0.44·fta + to), 101 top_usg_share,
  102 fives_used (d.lineups[t], dur > 0), 103 top_five_share, 104 starters_net (sum; Σ pf − pa of the starting five)
  [STARTERS].
- 105-107 quality: 105 **events** (plays), 106 zoned_2pa (2PA with `d.locs[id]` or a shot stype), 107 sit_rim_a [SIT]
  (situations.js's own rim count, kept only to test agreement).

N = 108. Units: counts `n`; minutes/reg_min `min`; timed_s `s`; lead_ms `ms`; points values `pts`; the four shares
`share`; usg_hhi `index`. Every zone count is the engine's (125 cm, marker first, then type) as `adv.rimA` is.

### 3.4 Quality bits `q`
`QBITS = {MARK:1, TYPE:2, ZONES:4, TIMED:8, SIT:16, STYPE:32, FOULKIND:64, STARTERS:128, STL:256, DENSE:512}`.
MARK: markers on ≥ 80% of 2PA. TYPE: a shot stype on ≥ 50% of FGA. ZONES: `zoned_2pa ≥ 0.8·2PA` and
`|rim_a − sit_rim_a| ≤ max(6, 0.4·max(rim_a, sit_rim_a))`. TIMED: `timed_n ≥ 0.7·poss`. SIT: situations computed with
possessions. STYPE: `to_typed ≥ 0.7·to_n > 0`. FOULKIND (game): a 'shooting' foul exists and ≥ 90% of fouls carry a kind.
STARTERS: five starters. STL (game): a `stl` exists. DENSE (game): no in-period gap over 90 s between plays.
Live feeds checked: CEBL every bit; ORLEN Basket Liga only 'personal' fouls (no FOULKIND); Liga Endesa no markers or
types (no ZONES/STYPE).

### 3.5 Rows
`toRows(gameId, out, meta)` → two `{game_id, team_idx, fv, f, q, league_id, season_id, competition_id, finalised_at}`
with `f` rounded to 4 significant figures, NaN/±Infinity → null. `fromRow(row)` → `Float64Array(108)` (null → NaN, padded).

### 3.6 Factors (`FACTORS`; `derive(own, opp, qOwn, qOpp)` for one game)
Fields `{k, label, grp, unit, dir (+1 better high, −1 better low, 0 style), side, need, diff, score, pub, def}`. A zero
denominator gives null; a missing `need` bit gives null. `diff` = may enter home-minus-away models; `score` = part of
the score (scan only, badged, never in a multivariable model); `pub` = built from pub counts only.
- Four factors and shooting (diff, pub): efg = 100(fgm + 0.5 fg3m)/fga; ts = 100 pts/(2(fga + 0.44 fta));
  tovp = 100 tov/(fga + 0.44 fta + tov) (−1); orebp = 100 oreb/(oreb + opp.dreb); ftr = 100 fta/fga (the site's);
  ftmr = 100 ftm/fga (Oliver's); ftp = 100 ftm/fta; p3r = 100 fg3a/fga (0); p3p = 100 fg3m/fg3a; rimr = 100 rim_a/fga (0),
  rimp = 100 rim_m/rim_a, midr = 100 mid_a/fga (0), midp = 100 mid_m/mid_a [ZONES]; astp = 100 ast/fgm;
  stlp = 100 stl/opp.poss_est; blkp = 100 blk/(opp.fga − opp.fg3a). Score: ortg = 100 pts/poss, ppp = pts/poss;
  paint, fast, second, offto, bench (pub, per game).
- Competitive (diff; the Explain inputs): c_efg = 100 c_efgm/c_fga; c_tovp = 100 c_tov/(c_fga + 0.44 c_fta + c_tov);
  c_orebp = 100 c_reb_off/(c_reb_off + c_reb_def); c_ftmr = 100 c_ftm/c_fga (A.3: a measure only; the model's free-throw factor
  is c_ftr = 100 c_fta/c_fga); c_margin = c_pts − opp.c_pts (game,
  score); garbage_share = g_poss/poss (0).
- Tempo (game unless noted): pace = 40(poss_est + opp.poss_est)/2/minutes (= TA.pace, pub); pace_x the same with poss;
  pace3q = 40(poss_3q + opp.poss_3q)/2/(0.75 reg_min); pace_own = 40 poss_est/minutes (own, pub); chances_pp =
  chances/poss (own). Time [TIMED, own, 0]: top_avg = timed_s/timed_n; top_share = timed_s/(timed_s + opp.timed_s);
  early_share = fc_e_n/fc_n; late_share = fc_l_n/fc_n; ppc_early/mid/late = fc_*_pts/fc_*_n (+1; null under 5 in a
  game); dreb_start = gain_dreb/poss.
- Situations [SIT, diff]: tr_freq = tr_ch/sit_ch (0); tr_ppc, hc_ppc, sc_ppc, offto_ppc = pts/ch (+1); sc_freq =
  sc_ch/sit_ch (0); ato_ppp = ato_pts/ato_n (+1; null under 3 in a game); ast_share = fgm_ast/(fgm_ast + fgm_unast) (0);
  ast3_share = fg3m_ast/fg3m (0).
- Turnovers and fouls (diff): live_share = to_live/to_n, live100 = 100 to_live/poss, dead100 = 100(to_n − to_live)/poss
  (−1, STL); badpass100, handle100 (−1, STYPE); offfoul100 (−1, FOULKIND); foul100 = 100 fouls/opp.poss (−1);
  sfoul_drawn100 = 100 opp.fouls_shooting/poss (+1, FOULKIND); trips100 = 100 ft_trips/poss (+1); and1_rate = 100
  and1/fgm (+1); bonus_share = fta_bonus/fta (0, FOULKIND); techs per game (−1).
- Flow and clutch: lead_changes, ties (game, 0); lead_share = lead_ms/(60000 minutes), max_lead, max_deficit, best_run,
  runs8 per game, m_h1/m_h2/m_ot = pts_h* − opp.pts_h* (all score); cl_poss per game (0); cl_ppp = cl_pts/cl_poss (+1;
  null under 4 in a game); cl_tovp = 100 cl_tov/cl_poss (−1); cl_efg = 100 cl_efgm/cl_fga (+1); cl_ftr = 100 cl_fta/cl_fga
  (+1); cl_net100 = 100(cl_pts − opp.cl_pts)/((cl_poss + opp.cl_poss)/2) (score).
- Rotation (diff, 0): players_used, rot_n, top5_min_share, starters_min_share [STARTERS], usg_hhi, top_usg_share,
  fives_used, top_five_share; starters_net per game (score).
- Builder-only (need league make rates, §7.11): xefg, making = efg − xefg, xpts, luck_pts = pts − xpts.

`PUBLIC_KEYS` = efg, ts, tovp, orebp, ftr, ftmr, ftp, p3r, p3p, rimr, rimp, midr, midp, astp, stlp, blkp, pace,
pace_own, paint, fast, second, offto, bench.

### 3.7 Season sums
`seasonFactors(pairs: [{own, opp, qOwn, qOpp}])` → `{k: {v, n}}`: for each factor, counts are summed (`mean` fields
averaged) over the games where both rows carry its need bits, then the formula is applied (a ratio of sums, never a mean
of ratios); a per-game factor is the sum divided by the games used. The same call gives a league mean (all team-games)
or a defence (pairs swapped). A new or changed index is FV 2: `extract` writes fv 2, `game_features_missing(2, …)` lists
every game, and the builder reads only the current FV.

## 4. Writing the line

### 4.1 finalise-game (supabase/functions/finalise-game/index.ts)
1. After the existing side-effect imports: `import { extract as extractFeatures, toRows as featureRows } from
   '../_shared/features.js';`
2. After the situations block, unless `Deno.env.get('FEATURES_OFF') === '1'`: `FL = extractFeatures(game, {d, TA,
   C: SITC})` in its own try/catch (warning: "the What wins feature line could not be worked out — run the features
   backfill").
3. One timestamp `publishedAt` is used for `games.finalised_at` and for the rows. After the three stats inserts succeed
   and before publishing, if `FL` and `g.competition_id`: read `competitions?id=eq.…&select=season_id,seasons(league_id)`
   and upsert `featureRows(gameId, FL, {league_id, season_id, competition_id, finalised_at: publishedAt})` on
   `game_id,team_idx`, in its own try/catch (warning: "… was not stored — run the features backfill"). Never blocking.
4. `reopen: 1` also deletes the game's `game_features` rows. A re-finalise gets a later `finalised_at`, so the builder
   reads the game again.

### 4.2 Backfill (scripts/backfill_features.mjs, .github/workflows/backfill-features.yml)
Env `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (sent as `apikey` and `Authorization: Bearer`). Flags `--dry`, `--force`,
`--league <slug>`, `--since <date>`, `--max-minutes` (45, resumable), `--lanes` (4), or one `<game-id>`. Games from
`rpc/game_features_missing {p_fv, p_limit: 500}` (or, with --force, every final game keyset by id); per game the row
(`id,status,period,starters,roster_snapshot,competition_id,finalised_at,home_score,away_score`), its competition's
season and league, and the log `game_events?game_id=eq.…&select=seq,t,team,pid,period,clock,payload&order=seq&seq=gt.…
&limit=1000` until short, mapped by `mapEvents` imported from `scripts/backfill_situations.mjs` (not edited). Skipped and
named: no roster snapshot or starters, no events, a replayed score that differs from the stored one. Upsert with
`Prefer: resolution=merge-duplicates`. Workflow: manual; inputs dry_run (default true), game_id, league, force,
max_minutes; concurrency `backfill-features`; node 24; 120 min. Cost: ~1,468 games × ~173 KB ≈ 250 MB once, ~15 min.

## 5. Migration 0207_what_wins.sql
Next free number (highest is 0206). No `raise` with a `%` placeholder (migration-lint). Every function `security definer
set search_path = public`.
```sql
create table if not exists public.game_features (
  game_id uuid not null references public.games on delete cascade,
  team_idx smallint not null check (team_idx in (0, 1)),
  fv smallint not null, f real[] not null, q integer not null default 0,
  league_id uuid not null references public.leagues on delete cascade,
  season_id uuid not null references public.seasons on delete cascade,
  competition_id uuid not null references public.competitions on delete cascade,
  finalised_at timestamptz not null, built_at timestamptz not null default now(),
  primary key (game_id, team_idx));
create index if not exists game_features_unit on public.game_features (league_id, season_id, fv, finalised_at, game_id);
alter table public.game_features enable row level security;
revoke all on public.game_features from public; revoke all on public.game_features from anon, authenticated;
grant all on public.game_features to service_role;

create or replace function public.game_features_missing(p_fv int, p_limit int default 500)
returns setof uuid language sql stable security definer set search_path = public as $$
  select g.id from public.games g
   where g.status = 'final' and g.competition_id is not null
     and (select count(*) from public.game_features f where f.game_id = g.id and f.fv >= p_fv) < 2
   order by g.finalised_at nulls last, g.id
   limit greatest(1, least(coalesce(p_limit, 500), 5000)) $$;
-- revoke from public, anon, authenticated; grant execute to service_role

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('analytics', 'analytics', false, array['application/json'], 104857600)
on conflict (id) do update set public = false, allowed_mime_types = array['application/json'], file_size_limit = 104857600;
-- deliberately no storage.objects policy naming 'analytics'

create table if not exists public.analytics_files (
  scope text not null check (scope in ('wins', 'fo', 'club', 'store', 'priors', 'teaser')),
  league_key text not null,            -- league uuid or 'all'
  season_key text not null,            -- season uuid or 'current'
  team_key text not null default '',   -- team uuid for 'club'
  league_id uuid references public.leagues on delete cascade,
  season_id uuid references public.seasons on delete cascade,
  team_id uuid references public.teams on delete cascade,
  is_current boolean not null default false,
  path text not null, token text not null, layout int not null, fv int not null,
  bytes int, n_games int, built_at timestamptz not null default now(),
  primary key (scope, league_key, season_key, team_key));
create index if not exists analytics_files_current on public.analytics_files (scope, league_key, team_key) where is_current;
-- RLS on; revoke all from public, anon, authenticated; grant all to service_role

create table if not exists public.analytics_issue_log (
  id bigserial primary key, subject text not null,   -- 'u:<user id>' or 'ip:<sha-256 prefix>'
  scope text not null, league_key text not null default '', at timestamptz not null default now());
create index if not exists analytics_issue_log_subject on public.analytics_issue_log (subject, at);
-- RLS on; revoke all from public, anon, authenticated; grant all (and the sequence) to service_role

create or replace function public.analytics_signin_required()  -- platform_settings 'analytics_signin' = true
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.value = 'true'::jsonb from public.platform_settings s where s.key = 'analytics_signin'), false) $$;
-- grant execute to anon, authenticated, service_role

create or replace function public.analytics_open_leagues()       -- analytics open to everyone, as configured
returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from public.leagues l
   where coalesce(l.visibility, 'public') = 'public' and l.access_mode = 'open'
     and public.access_analytics_configured(l.id) = 'free' $$;
-- service_role only

create or replace function public.analytics_check(p_scope text, p_league uuid, p_season uuid, p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.analytics_signin_required() and auth.uid() is null then return 'signin'; end if;
  if p_scope is null or p_scope not in ('wins', 'fo', 'club') then return 'scope'; end if;
  if p_league is null then
    if p_scope <> 'wins' or p_season is not null or p_team is not null then return 'scope'; end if;
    if public.memberships_enabled() and not public.can_use_analytics(null) then return 'members'; end if;
    return 'ok';
  end if;
  if not public.can_view_league(p_league) then return 'league'; end if;
  if public.memberships_enabled()
     and not (public.can_use_analytics(p_league) or coalesce(public.is_league_admin(p_league), false)) then
    return 'members'; end if;
  if p_season is not null and not exists (select 1 from public.seasons s where s.id = p_season and s.league_id = p_league)
    then return 'league'; end if;
  if p_scope = 'club' then
    if p_team is null then return 'scope'; end if;
    if not exists (select 1 from public.games g join public.competitions c on c.id = g.competition_id
                     join public.seasons s on s.id = c.season_id
                    where s.league_id = p_league and (p_season is null or s.id = p_season)
                      and (g.home_team_id = p_team or g.away_team_id = p_team)) then return 'league'; end if;
  end if;
  return 'ok';
end $$;
-- grant execute to anon, authenticated, service_role (it is called with the CALLER's token)

create or replace function public.analytics_take(p_subject text, p_signed boolean, p_scope text, p_league text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare lim_h int := case when p_signed then 60 else 20 end; lim_d int := case when p_signed then 400 else 100 end;
        used_h int; used_d int; first_h timestamptz; first_d timestamptz;
begin
  select count(*) filter (where at > now() - interval '1 hour'), count(*),
         min(at) filter (where at > now() - interval '1 hour'), min(at)
    into used_h, used_d, first_h, first_d
    from public.analytics_issue_log where subject = p_subject and at > now() - interval '1 day';
  if used_h >= lim_h or used_d >= lim_d then
    return jsonb_build_object('ok', false, 'used_hour', used_h, 'limit_hour', lim_h, 'used_day', used_d, 'limit_day', lim_d,
      'retry_after', greatest(1, ceil(extract(epoch from (case when used_h >= lim_h then first_h + interval '1 hour'
                                                          else first_d + interval '1 day' end) - now()))::int));
  end if;
  insert into public.analytics_issue_log (subject, scope, league_key) values (p_subject, p_scope, coalesce(p_league, ''));
  return jsonb_build_object('ok', true, 'used_hour', used_h + 1, 'limit_hour', lim_h, 'used_day', used_d + 1, 'limit_day', lim_d);
end $$;
-- service_role only

create or replace function public.analytics_issue_prune(p_days int default 30) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int; begin
  delete from public.analytics_issue_log where at < now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
  get diagnostics n = row_count; return n; end $$;
-- service_role only
```
"Revoke from public, anon, authenticated; grant to service_role" is written out in full in the file, as 0190 does.

## 6. The builder (tools/build-analytics.mjs, .github/workflows/analytics.yml)
The build-seasons.mjs pattern: node 24, page modules loaded as globals (`data.js`, `season.js`, `bpm.js`, `sos.js`,
`winning.js`, `t/depth.js`, `features.js`, `winstats.js`, `winsim.js`, `winmodel.js`); reads and writes with the service
key; every calculation lives in `epinoia/winmodel.js`.

### 6.1 Units, tokens, when to build
- Unit = one league-season (all final games of its competitions: league, cup, playoff). Pooled unit = `('all',
  'current')`: every league's newest season with feature rows.
- Token = `<n>@<max finalised_at>` over the unit's rows with `fv = FV`, `team_idx = 0` (HEAD count + newest). Pooled
  token = its units' tokens joined + `@o<FNV hash of the sorted analytics_open_leagues()>`; the teaser uses the pooled token.
- File name `v<FILE_V>-<token with each non-alphanumeric run as '-'>.json`; never rewritten.
- Due: a new token, another FILE_V or FV in the indexed path, the current season's file older than 24 h, a past season's
  older than 30 days, or `--full`; but not while younger than the floor `ANALYTICS_MIN_GAP_H` (default 1; at least 6 above
  `D.BIG_GAMES` = 800 games). Pooled: due when a current-season unit was rebuilt, it is older than
  `ANALYTICS_POOL_GAP_H` (6) AND the current units hold at least 5% more games than it does (at least 20; PERF2-3: it
  reads every current unit's whole store), or on a layout change, or after 24 h. League fits use the latest pooled
  priors (§7.4). At most 2 units over BIG_GAMES are built a run (the rest wait an hour, before their stores are read),
  and a run stops cleanly between units past 40 minutes (PERF2-5); what is left stays due.

### 6.2 The private store
`analytics/store/<league>/<season>/s<STORE_V>-fv<FV>.json`; a local run mirrors it in the git-ignored `.cache/analytics/`
(whichever has the later watermark wins; never an Actions cache, B.5):
```
{ v, fv, league, season, wm: {at, id}, n,
  games: pack([{id, d: 'YYYY-MM-DD', t: tipoff ms, c: comp index, k: 'l'|'c'|'p', h, a, hs, as, v: venue id|'', s0, s1}]),
  comps: [ids], F: base64 Float32Array(n × 2 × 108), Q: base64 Int32Array(n × 2),
  pgs: {players: [ids], rows: base64 Float32Array(m × 18: gameIdx, side, playerIdx, min (minutes), pts, fga, fgm, fg3a,
        fg3m, fta, ftm, or, dr, ast, stl, blk, to, pf)},
  stints: {rows: base64 Float32Array(s × 11: gameIdx, side, p0..p4, poss, pf, pa, dur s)} }
```
`s0/s1` = FNV-1a of the sorted starters. Stints: every game up to 3,000 games, else the latest 3,000 (§7.13).

### 6.3 Reads (keyset only; never `stats->sit`, never a whole `stats`)
Incremental, after the watermark: (1) `game_features?league_id=eq.…&season_id=eq.…&fv=eq.1&select=game_id,team_idx,f,q,
finalised_at&or=(finalised_at.gt.<at>,and(finalised_at.eq.<at>,game_id.gt.<id>))&order=finalised_at,game_id,team_idx&
limit=1000` (a returning game replaces its row); (2) their games, 150 ids a request
(`id,status,competition_id,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue_id,starters`; not final →
dropped); (3) their player lines, 40 games a request: `player_game_stats?…&select=game_id,team_idx,player_uuid,player_id,
min:stats->min,pts:stats->pts,p2a:stats->p2a,p2m:stats->p2m,p3a:stats->p3a,p3m:stats->p3m,fta:stats->fta,ftm:stats->ftm,
or:stats->or,dr:stats->dr,ast:stats->ast,stl:stats->stl,blk:stats->blk,to:stats->to,pf:stats->pf` (a player is
`player_uuid`, else `player_id`; `min` is milliseconds); (4) their stints: `lineup_stints?…&select=game_id,team_idx,
player_ids,dur:stats->dur,pf:stats->pf,pa:stats->pa,off:stats->off,def:stats->def`, `poss = ½(possEst(off) +
possEst(def))`, `possEst(b) = 0.96(b.fga + b.tov + 0.44 b.fta − b.or)`.
Per build: season rows by `D.season(compIds, {rows: false, allowBig: true, trim: true, window: 4})` with data.js given the
service key (`EPINOIA_CONFIG.supabaseAnonKey = key`, `globalThis.EpinoiaAccess = {authHeaders: () => ({Authorization:
'Bearer ' + key})}`), the previous season likewise; rosters (`roster_entries?team_id=in.(…)&active=eq.true&select=
team_id,position,players(id,height_cm)`); `rpc/player_bio` (500 ids); withheld (`players?select=id,is_minor,
public_consent`); venues (`id,lat,lng`); teams (`id,name,short_name,colour,logo_path,home_venue_id`); fixtures to come
(`status=in.(scheduled,live)`). The previous season's players by club are kept in the store's context with the token
of the store they came from, so that store is read once a season, not every build (PERF2-3). There is no scheduled rebuild from
nothing (the weekly Sunday 03:40 UTC full run was removed 2026-10-06): every run builds on top of each store, adding the
games after its watermark; `--full` (and `--full-past`) remain for a repair by hand. Between full runs a
unit's simulator calibration (most of a big unit's build) is carried until it has grown by 25% (PERF2-5).

### 6.4 One run
0 `rpc/analytics_issue_prune`. 1 Discover seasons, leagues, the open set, the index and every token. 2 Refresh and save
the stores of due units. 3 Pooled: if due, `buildPool` and upload `wins/all/current` and `analytics/priors/v1.json`; else
download the priors. 4 Each due unit: `buildUnit` (seed = FNV(token), B = 400), `validate`, budget, upload `wins`, `fo`
and the clubs whose games changed, upsert their index rows, then delete the objects the old rows named. 5 Teaser when the
pooled file was rebuilt or the open set changed: upload `snapshots/whatwins/v1-<token>.json` (max-age 31536000), then
`snapshots/whatwins/index.json` = `{file, token, built}` (x-upsert, max-age 600), then delete older teasers. 6 Purge objects
of deleted leagues. 7 Job summary: units, sizes, warnings and §16's live acceptance numbers. THE LOG AND THE SUMMARY ARE
PUBLIC (a public repository): an open league is named with its numbers, any other unit by an opaque hash of its ids, and a
failure is a scope and a count, never validate()'s text; the whole report goes to the private bucket as
`analytics/reports/last.json` (SEC2-1).
Flags: `--dry-run`, `--unit <league>:<season>`, `--full`, `--full-past`, `--min-gap-hours`, `--pool-gap-hours`, `--fixtures <dir>`
(offline: write the §9 sample files from `synthUnit` into `supabase/tests/fixtures/ww/`).
`export async function run({url, serviceKey, fetch, dryRun, unit, full, minGapHours, poolGapHours, fixtures, log, now})`
→ `{built: [{scope, unit, bytes, games}], current, skipped, failed: [{unit, error}], summary}`.

### 6.5 Paths
`analytics/wins/<league>/<season>/v1-<token>.json`, `analytics/wins/all/current/v1-<token>.json`,
`analytics/fo/<league>/<season>/v1-<token>.json`, `analytics/club/<league>/<season>/<team>/v1-<token>.json`,
`analytics/priors/v1.json`, `analytics/store/<league>/<season>/s1-fv1.json`; public `snapshots/whatwins/…`. Uploads
`POST /storage/v1/object/<bucket>/<path>` with `cache-control: max-age=31536000`; index rows upserted on
`scope,league_key,season_key,team_key`, `is_current` true for a league's current season and the pooled row.

### 6.6 Budgets and determinism
Raw bytes: teaser 40 KB, wins 300 KB (pooled 400 KB), fo 100 KB (150 KB above 800 games), club 25 KB. Over budget: drop
`adj` curves, thin curves to 15 points, merge blocks to fortnights, drop curves of factors with q ≥ 0.05; still over by
more than 25%: the unit fails and the previous file stays. Every draw is seeded from FNV(token): the same store gives
byte-identical files, and incremental equals full.

### 6.7 Workflow
Cron `40 * * * *` (no scheduled full run since 2026-10-06); dispatch inputs unit, full, dry_run; concurrency `analytics`; RUNS_ON
pattern; 50 min; sparse checkout `epinoia`, `tools`; node 24; no Actions cache (B.5: the stores stay in the private
bucket); secrets `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`; variables `ANALYTICS_MIN_GAP_H`, `ANALYTICS_POOL_GAP_H`.

## 7. Statistics (primitives in epinoia/winstats.js, assembly in epinoia/winmodel.js)
All fits run in the builder; the browser re-runs only ridge re-fits from blocks, their bootstrap, curve look-ups and the
simulator.

### 7.0 Notation
Home view: `y` = final margin, `y^c` = competitive margin (`c_margin`), `w` = home won (draws dropped), `h` = 1 at the
home side's venue, 0 at a neutral site (venue known, home team's venue known (`home_venue_id`, else its modal venue over
≥ 3 home games), and different). `Δx_k = derive(home, away).k − derive(away, home).k`; a game missing a needed bit has no
Δx_k. **No intercept**: swapping sides at a neutral site flips every sign, so models are `y = α h + Σ β_k Δx_k + ε` (α ≈
0.24 points live: home court beyond the factors). **Blocks** = ISO weeks of tip-off, a week under 8 games merged into the
next (the last into the previous). Block statistics over `[h, Δx…]`: `n, sw, xx (packed upper), xy, yy, sy`; their sums
give any fit of any column subset exactly.

### 7.1 The scan
Per diff factor: point-biserial r(Δx, w), flipped when dir = −1; Fisher interval `tanh(atanh r ± 1.96/√(n_eff − 3))`,
`n_eff = n/DEFF`, `DEFF = 1 + (m̄ − 1) ρ_x ρ_w` (ANOVA ICCs within blocks, clamped [0, 1]); p from the same z; BH q across
the unit's factors (q ≥ 0.05 drawn grey: "not distinguishable from noise"). "Won it, won the game" share with Wilson;
winners' and losers' means with Welch. Score factors badged "part of the score".

### 7.2 Explain models
- **core4c** (every unit; A.3: c_ftr in place of c_ftmr, and ftr in the full-game twin): `y^c = α h + Σ β Δ(c_efg, c_tovp, c_orebp, c_ftmr)`, OLS (shares comparable with Oliver's
  40/25/20/15). Its residual SD is σ_acc. The full-game twin (efg, tovp, orebp, ftmr on y) is reported as `fullR2` (live
  0.944).
- **shot** (ZONES on ≥ 80% of games): `y` on rimr, midr, rimp, midp, p3p, tovp, orebp, ftr, ftp (eFG replaced by its parts).
- **extended**: core4c + the style set (§7.7); reports added R² (block-bootstrap interval) and the nested F test.
- **Ridge**: minimise `Σ(y − x·b)² + λ n Σ_k s_k² (b_k − b0_k)²`, s_k = RMS of Δx_k, h unpenalised, b0 = 0 or a prior;
  λ by 5-fold CV over blocks (fold = block index mod 5, train = total − fold), golden section on ln λ in [1e-4, 10];
  Cholesky with jitter retries (1e-10·trace/p, three times); Gauss-Jordan kept for the parity test.

### 7.3 Uncertainty
Block bootstrap, B = 400 (within league in pooled fits), refits from summed block statistics at the unit's λ,
percentile 95%. CR1 sandwich by block as the check: `c A⁻¹(Σ_b s_b s_bᵀ)A⁻¹`, `A = XᵀX + λD`, `s_b = (Xᵀy)_b − (XᵀX)_b b`,
`c = G/(G−1)·(n−1)/(n−p)`; > 30% disagreement in an SE is a job-summary warning; CR1 is the covariance EB uses.
Builder-only fits (logistic, splines, path stages) bootstrap with B = 200 and ship interval ends.

### 7.4 Adaptive per league (empirical Bayes)
Pooled fit over every league's current season with α_ℓ per league and common β → `β_pool`. Each league with n ≥ 20 is
fitted alone at the pooled λ → `β̂_ℓ`, `V_ℓ` (CR1). τ² per coefficient by DerSimonian-Laird over leagues with n ≥ 50
(`w = 1/V_kk`, `Q = Σ w (β̂ − β̄_w)²`, `τ² = max(0, (Q − (m − 1))/(Σw − Σw²/Σw))`); fewer than 4 such leagues:
`τ² = (0.25 β_pool)²`. Posterior `β̃ = (V⁻¹ + T⁻¹)⁻¹(V⁻¹β̂ + T⁻¹β_pool)`, T = diag τ²; pooled weight `w = post_kk/τ²_k`.
n < 20: no own estimate and no league files (pages use the pooled file); 20-199: shrunk only; ≥ 200: own and shrunk
shown. α and, on the log scale with weight n/(n + 200), σ_pred are shrunk the same way.

### 7.5 Value scale
Per factor (shrunk b, points of margin per unit): `sdTeam` = SD over team-seasons (≥ 8 games) of the season factor for
offence, defence allowed and their difference (`net`). Points per game for one team-SD better `pts = b·sdTeam.net`; wins
`wins30 = 30(Φ(pts/σ_pred) − 0.5)`, `winsSeason = G(Φ(pts/σ_pred) − 0.5)`, G = median games per team. A club, per end:
contribution `b(x_off − μ)` and `−b(x_def − μ)`; a move to a target (the league's P75 in the better direction):
`δ = b(target − x_off)` or `−b(target − x_def)`, worth `Σ_f [Φ((μ_f + δ)/σ_pred) − Φ(μ_f/σ_pred)]` over fixtures with
expected margins μ_f, or `G(Φ(δ/σ_pred) − 0.5)` against an average side. σ_pred = out-of-fold residual SD of y on the
Forecast model when live, else on the Elo expectation; never σ_acc (`valueScale` returns null for sigma < 2 σ_acc).

### 7.6 Collinearity and importance
VIF = diag(R⁻¹) (amber > 5, red > 10); building the shot and extended sets drops the higher-VIF member of the most
correlated pair until all VIF ≤ 10 (TS never sits beside eFG and the FT factor: r = 0.962 live); condition number
reported. Shares: exact Shapley R² over groups, `v(S) = R²(h ∪ S) − R²(h)`, every subset by Cholesky on Gram sub-blocks
(core4c: 4 factors; extended: shooting, turnovers, boards, free throws, tempo and possession, transition, ball movement
and usage, fouling); Σφ = v(all) to 1e-10. Shown beside Oliver's 40/25/20/15 and, in a details element, the old |b|·sd shares.

### 7.7 Path model (does style matter beyond the four factors?)
Stage A per mediator f ∈ core4c: `Δf = a_f0 h + Σ_j a_fj Δs_j`. Stage B: `y^c = α h + Σ_f b_f Δf + Σ_j c_j Δs_j`. Style
set (kept where its bits cover ≥ 80% of games): top_avg, early_share, tr_freq, sc_freq, ast_share, p3r, rimr [ZONES],
live_share [STL], foul100, trips100, usg_hhi, top5_min_share. Direct `c_j`, indirect `Σ_f b_f a_fj` (with its parts),
total; block-bootstrap intervals (B = 200).

### 7.8 Forecast
- Profiles at date t: each team's counts from earlier games only (own rows = offence, opponents' = defence) through
  `seasonFactors`, shrunk `x̃ = (n x + k μ)/(n + k)`, n games, `k = σ²_within/τ²_between` per factor (whole unit, clamped
  [2, 30] games).
- Expected differential: proportions `E[x_A] = expit(logit x̃_A,off + logit x̃_B,def − logit μ)`, others additive;
  `E[Δx] = E[x_home] − E[x_away]`.
- Elo: K 20, 1500 each season, sos.js's margin multiplier, home term H fitted on 0, 10, …, 150 Elo by log loss.
- Schedule: rest days (≤ 7), back-to-back (< 1.5 days), travel km (haversine; used where ≥ 70% of games have coordinates).
- `y = α h + Σ_{core4c} γ E[Δx] + δ_e Δelo/100 + δ_r Δrest + δ_b (b2b_h − b2b_a) + δ_t Δkm/1000`, ridge (units under 200
  games shrunk to the pooled coefficients); `P(home) = Φ(ŷ/σ_pred)`. Cross-check: ridge logistic by IRLS (≤ 25 iterations,
  1e-8, step-halving); `logitAgree` when `β_logit σ/1.702` lies within the margin model's intervals.
- Rolling origin from each unit's fourth ISO week: train on earlier weeks, predict the week; a test game needs both teams
  with ≥ 3 earlier games; λ is the full-unit value; units over 4,000 games score a fixed 1,500-game sample.
- Metrics: Brier, log loss, ECE (10 equal-count bins), AUC, reliability slope and intercept, the bins. Baselines on the
  same games: home-only, Elo with home, net rating `1/(1 + 10^(−Δnet/10))`, Pythagorean log5 (exponent 14).
- Gate `live = nEval ≥ 60 ∧ Brier < Brier_home ∧ Brier ≤ Brier_elo + 0.002`; not live → "season numbers do not forecast
  better than Elo here", and the Front office uses Elo expectations.
- League-out transfer (pooled): each league with n ≥ 50 predicted from a fit on the others; Brier per league.

### 7.8.1 EPINOIA's model (epinoia/winodds.js; the run tools/build-odds.mjs; picks in model_picks, 0253)
One online model for every game in every league, beside §7.8's per-unit forecast: what the preview card, the game's
preview and the board's EPINOIA competitor show (signed in now; `gate_open('model', league)` once memberships are on).
- Inputs a fixture, 20: home (0 at a neutral venue: away from the home club's modal venue, ≥ 3 home games); §7.8's
  expected differentials of the four factors (shrink 5 games); the same factors schedule-adjusted (`y_ig = μ + o_i +
  d_j`, logit, every club of a league-season solved together, Gauss-Seidel × 10, shrink 20 games); Elo (K 20, margin
  multiplier, ⅓ back to 1500 a season, home term from the model's own edge); the margin rating (competitive margin a game
  `= r_i − r_j`, solved with the factors, shrink 8); rest and back-to-back; positions (bpm.js position estimate → guard
  < 2.5 ≤ wing < 3.75 ≤ big; each club's game score a 36 at each position against the league's, and its defence's pull on
  opposing players at each against their own season rate, shrink 200 minutes); form (EW residual of the model's own
  margin, α 0.05, × n/(n + 10)); who is playing (last game's minutes-weighted player rating against the season roster's);
  style, points a game each side can expect, each attack against the defence it meets against the league (a share on
  the logit scale, a rate a chance added; shrink 120 chances or shots): half-court (share of chances × points a
  half-court chance), transition (share × points a transition chance), second chances (share × points), the shot diet
  (rim / mid / three shares × make rates × 2, 2, 3) - only where the feed has situations and zones (`need` bits).
- Learning, after each game: RLS on the margin (forgetting 0.9995, each weight's variance capped at 4 × its prior);
  each league's home edge (SGD, near the shared one); σ (EW, α 0.02); a calibration `P = expit(a + b · 1.702 z)` by
  SGD on its own wins and losses. Silent until both clubs have played 3 games this season.
- Tuning itself, weekly (`tune()`, `--tune` to force, ≤ 4 minutes): every finished game walked again under each candidate
  setting (shrinks, form, σ and home-edge rates, Elo K and carry, each family's prior freedom, each family on or off);
  coordinate descent, a change kept only if log loss falls ≥ 0.001 overall and ≥ 0.0003 in each half of the games.
  Checked out of sample: tuned on the older half, tried on the newer, it is level with the defaults (Brier 0.2139 v
  0.2140) - looser rules gained 0.006 where they were tuned and nothing elsewhere. Kept in the state (`tuned`).
- Data: each run reads only lines finalised after the watermark — 22 numbers of each game_features line (`f->i`:
  competitive eFG makes, FGA, FTA, turnovers, offensive / defensive rebounds, points, possessions − garbage time's;
  chances all / transition / half-court / second and their points; rim, mid and three attempts and makes) and
  the named stats of each player line. State: `pack()` (ids interned, one array a club / league / player, the
  covariance's upper triangle, numbers to their precision), gzipped, `analytics/odds/state.v4.json.gz` (≈ 0.6 MB;
  a pick moves < 1e-4 through a pack); put back only when a run learned something.
- Picks: a fixture's pick rewritten each run until tip-off, then frozen (trigger); a game first met after it was played
  gets a record pick made from earlier games only, never replacing a fixture pick; `pick` is generated from `p_home`.
- Walk (2026-10-08, every finished game, 1,540 judged): Brier 0.2007, 67.8% right, log loss 0.5819 tuned (0.2011 /
  68.0% / 0.5830 on the defaults); the four factors,
  Elo, the margin and the home court alone 0.2026 / 67.3% / 0.5873; Elo with home 0.2046 / 66.4%; home always 0.2456 /
  57.5%. Form is the gain that holds (paired Brier −0.003, t −2.6 over the older half, full seasons; level early in a
  season, where every version is within the noise); the schedule-adjusted factors, positions, who is playing and the
  style are level within the noise (the style is alive - the shot diet alone correlates 0.46 with the result, the model
  0.55 - but 0.81 with the model's margin and −0.05 with what it misses), so they start at weight 0 with a small prior variance and earn weight as the
  evidence grows. Pace scaling (factors and σ) measured worse: off. Each family switches off in `C.use` for the next
  walk (`node tools/build-odds.mjs --worker-config --dry-run --full --eval`).

### 7.9 Curves and hard numbers
Per diff factor: 10 equal-count bins of Δx merged to n ≥ 30 (`[lo, hi, x̄, n, wins, p, Wilson lo, hi, mean margin]`);
logistic `logit P = s(Δx) + α h` (natural cubic spline, knots at the 5/35/65/95th percentiles, ridge), evaluated at h = 0
on 25 points with delta-method bands; `adj` (core4c and the leading five style factors) holds the other core4c at 0;
`x50`, `x75` by bisection with block-bootstrap intervals (null if not crossed in the data); quartile win shares with
Wilson; hard number: t = the nice number (1, 2, 2.5, 5 × 10ⁿ) nearest the 75th percentile of |Δx|, "sides ahead by t or
more won p% (lo-hi) of n games", shown when n ≥ 50.

### 7.10 Pace and time of possession
Pace is equal for both sides, so it never enters a difference model.
1. Team-season tempo: mean pace3q per team-season, z within the unit; win% and net per 100 against it: quintile bins
   (Wilson) and a binomial spline logistic, raw and holding net rating level.
2. √N: for games where both teams have ≥ 3 earlier games, μ̂ = Forecast (else Elo) expected margin for an average-length
   game, `N̂ = pace_h,pre·pace_a,pre/pace_lg × reg_min/40` (shrunk season-to-date pace3q), ρ = N̂/N̄; ML fit of
   `P(favourite wins) = Φ(a + b|μ̂| ρ^γ)`, γ ∈ [−1, 2] (structural value 0.5); LR test of γ = 0; γ interval by block
   bootstrap (B = 200). Never the realised pace.
3. Tempo control (pre-game paces ≥ 2 apart): `TC = (pace3q − pace_a,pre)/(pace_h,pre − pace_a,pre)` clipped [−1, 2];
   home dictates when TC > 0.5; dictator win share (Wilson) and an odds ratio from a logistic with offset logit(p_pre);
   labelled descriptive.
4. Time of possession: Δtop_avg, Δtop_share, Δearly_share in the scan and curves; direct and indirect effects from §7.7
   (the direct effect is the headline: short possessions are partly transition and offensive rebounds); league points
   per first chance by window (≤ 8 s, 8-16 s, > 16 s) with block-bootstrap intervals.

### 7.11 Causes of a result (exact)
One model for expectation and parts (core4c, shrunk β, α), home view (a club's view flips signs):
`m̂ = α h + Σ β_k E[Δx_k]` (pre-game competitive profiles); parts `c_k = β_k(Δx_k − E[Δx_k])`; the shooting part splits
into shot quality `β_efg(Δxefg − E[Δxefg])` and shot-making (the rest), `xefg = 100(rim_a p̄_rim + mid_a p̄_mid + 1.5 fg3a
p̄_3)/fga` at the unit's season make rates (two zones without ZONES); `other` = the core4c residual; `garbage = y − y^c`.
Identity (tested to 1e-9): `y = m̂ + Σ c_k + other + garbage`. Shooting luck `pts − xpts`, `xpts = 2(rim_a p̄_rim + mid_a
p̄_mid) + 3 fg3a p̄_3 + fta p̄_ft`, net of the opponent's, is shown beside, never added. A club's losses: mean parts with a
bootstrap over games; "you lose when …" names the parts whose interval excludes 0. The simulator's Shapley (§8) is the
non-linear check.

### 7.12 Positions
- One definition: `EpinoiaDepth.positionOf({position: normListed(listed), height}, seasonRow)` (the Front office's blend).
  `normListed` maps POINT_GUARD→pg, SHOOTING_GUARD→sg, SMALL_FORWARD→sf, POWER_FORWARD→pf, CENTER/CENTRE→c, GD→g, FD→f,
  F/G and G/F→gf, PG/SG→g, SG/SF→gf, SF/PF→f, C/F, F/C and C/PF→fc (case and punctuation tolerant; unknown → '').
- Groups by minutes, cut like the five's slots: sorted by value, G = first 40% of the unit's minutes (players ≥ 60 min),
  F = next 40%, C = last 20%; others by their value against the cuts. Coverage (listed, height, BPM only) is shown.
- **P1** positional accounting: per team-game and group, ts, usg_share, ast_share, reb_share, stocks40, tov_share,
  p3a_rate; home − away (21 columns + h), ridge on y, block bootstrap; points per +1 team-SD per cell, ★ when the interval
  excludes 0 after BH.
- **P2** what winners get: team-season group lines (minutes-weighted box BPM, the seven stats, min_share); median of the top
  quarter by net, of the league, of the bottom quarter; team bootstrap (B = 1000); under 8 teams, pooled z-targets. These
  are the Front office's slot targets. **Every team-season BPM here, in P2f and in §7.14 is the box BPM BEFORE bpm.js's
  team adjustment (`bpmRaw`):** the adjustment adds (1.2 net − Σ)/5 to every player, so the roster's minutes-weighted BPM
  is 1.2 × the club's own net / 5 exactly, and set against the clubs' results it would explain the results with
  themselves (r(talent, net) 0.99 with it, about 0.7 without). The lineups (§7.13) keep the adjusted BPM: the team
  constant cancels in their within-team-game demeaning.
- **P2f** slot forecast (units ≥ 200 games): at each ISO week start, season-to-date minutes-weighted BPM by group
  (EpinoiaBPM.forLeague on earlier player and team totals, its bpmRaw); `y = α h + Σ_g θ_g ΔBPM_g`, ridge, bootstrap.

### 7.13 Lineups (P3, the strongest squad evidence)
Rows: lineup_stints, `y = 100(pf − pa)/poss`, weight poss ≥ 1. Composition from season rows (unit-relative): shooters
(p3a ≥ 40, p3_rate ≥ P60 of players ≥ 200 min, shrunk 3P% `(p3m + 150 μ)/(p3a + 150)` ≥ median), handlers (ast_pct ≥ P75),
protectors (blk_pct ≥ P75 and height z ≥ 0.5, or group C without a height), bigs (group C), mean height z (missing → group
mean), mean BPM. Within team-game demeaning; columns shooters, bigs 0/1/2+ (ref 1), handlers 0/1/2+ (ref 1), protector
0/1+, height z, BPM, shooters × protector, handlers × shooters; ridge, game-blocked CV, bootstrap by game (B = 200). Output:
the grid shooters 0-5 × bigs 0/1/2+ as net per 100 against the reference five (2 shooters, 1 big, 1 handler, 1 protector,
mean height and BPM), interval, possessions (faint under 200), and the other terms. Stated limit: the opposing five is not
controlled.

### 7.14 Squad construction (team-season, underpowered and said so)
Features (unit z, ≥ 8 games): rot_n (mpg ≥ 10), top5_share, star_pts_share, usg_hhi (season), pos_entropy (`−Σ m_g ln m_g /
ln 3`), shooters/handlers/protectors in the rotation, height_w and age_w (only with > 50% of minutes covered),
bench_share, depth_bpm (rotation players 6-9), talent (minutes-weighted box BPM before the team adjustment), continuity (minutes by last season's players
of the club; null without one), starter_stability (modal five's share of games), availability (1 − top-8 games missed /
possible). Outcomes: net per 100 (shrunk by games) and win% minus Pythagorean. Pooled ridge with unit centring, raw and
talent-adjusted, splines on usg_hhi and pos_entropy, team-season bootstrap (B = 1000). Evidence: strong (95% excludes 0
and q < 0.05), some (90% excludes 0), none; power 'low' under 50 team-seasons or when every half-width exceeds |b|; no
verdict words without strong evidence. Winners' band: P25-P75 of the unit's top-quarter teams.

### 7.15 Roles (rule-based in v1)
shooter, handler, protector, big as §7.13; creator = usg ≥ the unit's P80 (≥ 200 min). Used by lineups, squad features,
the Front office and the "add a shooter" what-if.

### 7.16 Minimum samples
Own models and files ≥ 20 games; shrunk-only 20-199; bin 30; hard number 50; team-season 8 games; Forecast test game
needs 3 earlier games per team, the gate 60 test games; lineup cell faint < 200 possessions; squad power 'low' < 50
team-seasons; P2f ≥ 200 games.

### 7.17 Caveats (on #method and in tooltips)
Accounting is identity, not levers. Leaders slow down and trailing sides foul and shoot threes (competitive time and
pace3q reduce, not remove, this). Talent confounds style and squad shape. The simulator moves one rate with the others
fixed. Positions are estimated. Leagues differ in level and gender; transfer across them is an assumption. A q-value is not
causal evidence.

## 8. The simulator (epinoia/winsim.js, epinoia/winsim.worker.js)
Possession Markov chain; pure; mulberry32 seeds; the same file in node (calibration) and in a Worker.

### 8.1 Rates (per end; offence from own rows, defence from opponents'; shrink `(x + kμ)/(n + k)` toward the league)
d = timed_s/timed_n (k 20 possessions); tov = to_n/chances (150 chances); live = to_live/to_n (40); sfoul =
trips_shooting/chances (150); bonus = trips_bonus/chances (150); mixRim, mixMid, mix3 = rim_a, mid_a, fg3a over fga
(Dirichlet 100 FGA); pRim, pMid, p3, p2 = rim_m/rim_a, mid_m/mid_a, fg3m/fg3a, (fgm − fg3m)/(fga − fg3a) (80, 80, 150, 150);
and1 = and1/fgm (100); ft = ftm/fta (60); orb = reb_off_ch/(reb_off_ch + reb_def_ch) (100); tr = tr_ch/(gain_dreb +
opp.to_live), ≤ 0.95 (150). Without ZONES: two zones (p2, mix3); without TIMED: the league's d; without FOULKIND: the
league's split of ft_trips.

### 8.2 One game
- Blend (log5): `logit r_AB = logit r_A,off + logit r_B,def − logit r_lg + h·hca` (+hca on make logits, −hca on tov;
  h = +1 home, −1 away, 0 neutral); shot mix by log-ratios against threes, renormalised; `d_A = d_A,off d_B,def / d_lg`.
- Form: ε ~ N(0, τ²) per side per game, + on make logits, − on tov.
- Possessions `N = round(κ_N T/(d_A + d_B) + η)`, η ~ N(0, σ_N²), T = regulation seconds; away gets N or N − 1 (a coin).
  Pace and time of possession are one mechanism.
- Possession, ≤ 6 chances: (1) after a defensive rebound or a live turnover the first chance is transition with
  probability tr (+δ_tr on make logits); (2) turnover (tov), live with `live` (opponent's transition chance); (3) bonus
  trip (2 FTs; a missed last FT won back with 0.12·orb); (4) shooting foul (2, or 3 on a three); (5) shot: zone, make;
  a make scores (+ and-one with and1); a miss is won back with orb (new chance) or ends.
- End game (`fouling`, default on): trailing by 3-8 with ≤ 120 s left (time = Σ d) → the leader's possession is 2 FTs, 3 s.
- Overtime: 300 s, `N_ot = round(κ_N·300/(d_A + d_B))`, up to 6, then a coin.
- CRN: game i draws from `rng(seed ^ (i·0x9E3779B9))`: game-level draws, then exactly 8 uniforms per chance (transition,
  turnover, live, foul, zone, make, rebound, and-one); free throws from `rng(seed ^ i ^ 0x85EBCA6B)`.

### 8.3 Calibration and gate (builder, per unit, rolling-origin games; validated out of sample, B.5)
Fit hca (home win share), τ (actual-vs-simulated margin SD), κ_N (mean possessions = observed pace_x), μ_off (league make
offset: points per possession within 0.3%), δ_tr (transition − half-court points per chance); σ_N = residual SD of
possessions on T/(d_A + d_B); fouling kept unless it worsens possessions in games decided by ≤ 8; with fouling on, the
trip offset `tripOff` (a logit shift on the shooting and bonus trip rates) puts FTA/FGA back within 0.2 of the feed's, then
μ_off again: the feed's trips already hold the late-game fouls that end-game fouling adds (R2S-3: lnbp and CEBL shot
2-3.5 more free throws a 100 FGA without it, and μ_off pushed the makes down to pay for them). Validation: Brier, log
loss, ECE, slope against the Forecast model, Elo, home-only; observed vs simulated pace, ortg, eFG%, TOV%, OREB%, FT rate,
margin SD, share decided by ≤ 5, overtime rate; the gate also asks the held-out FT rate within 1 point of the feed's. Platt `p' = expit(b logit p)` when the slope is outside [0.9, 1.1] and n ≥ 60, with no intercept (a = 0): the held-out games are all in the home side's view, so an intercept would carry the home court onto whichever side is A; applied only when the simulator is calibrated.
`calibrated = nEval ≥ 60 ∧ Brier_sim ≤ min(Brier_forecast, Brier_elo) + 0.003 ∧ slope ∈ [0.85, 1.15]`; otherwise
"experimental": relative differences only, and the Front office converts with the margin model. 1,000 sims per test game
(units ≤ 2,000 games), else a 1,500-game sample at 400.

### 8.4 Uses
- Counterfactual (n = 4,000 per arm, CRN, half home and half away): edits in natural units on one end: efg (pp; one logit
  shift on the make rates found so the mix-weighted eFG moves exactly that much), tovp and orebp (scale tov, orb by the
  ratio), ftr (scale sfoul + bonus), p3r (mix3 + Δ, rim and mid rescaled), secs (d + Δ). Returns Δ win probability with
  paired SE and Δ margin.
- `needed`: bisection on one rate inside the league's P1-P99 of team-seasons to P(win) = 0.5 or 0.6, tolerance 0.005,
  ≤ 14 steps of 3,000 games.
- Loss Shapley: groups shooting, shot mix, turnovers, boards, free throws, tempo; v(S) = mean club margin with S's groups
  at the game's realised rates (both sides, from the club file), 1,000 CRN games × 64 coalitions; exact, Σφ = v(all) − v(∅).
- Season: remaining fixtures' P(win) from the simulator (calibrated) or Φ(μ_f/σ_pred); played results fixed; mean, p10,
  p50, p90.

### 8.5 Worker protocol
`importScripts('winstats.js?v=' + v, 'winsim.js?v=' + v)` (v from the worker URL, which the page builds from its own
script's `?v=`). `postMessage({id, op, args})`, op ∈ simulate, counterfactual, needed, shapley, season, refit, bootstrap;
replies `{id, ok: true, result}`, `{id, ok: false, error}`, `{id, progress}`. `refit`: `{blocks, cols, lambda, scale}` →
`{b, lo, hi}` (B = 200). No Worker: the same calls on the main thread, n / 5, in idle slices.

## 9. File schemas (FILE_V 1; numbers to 4 significant figures; rows packed with data.js `pack` where marked)
```ts
type CI = { v: number; lo: number; hi: number };
type Cal = { brier: number; logloss: number; ece: number; auc: number; slope: number; intercept: number; n: number; bins: [number, number, number][] };
type Bin = [lo: number, hi: number, x: number, n: number, wins: number, p: number, plo: number, phi: number, margin: number];
type Curve = [x: number, p: number, lo: number, hi: number][];
type Rates = Record<'d'|'tov'|'live'|'sfoul'|'bonus'|'mixRim'|'mixMid'|'mix3'|'pRim'|'pMid'|'p3'|'p2'|'and1'|'ft'|'orb'|'tr', number>;
interface Header { w: 1; fv: 1; code: number; scope: 'wins'|'fo'|'club'|'teaser';   // (as built: + ci_at, below)
  league: { id: string; slug: string; name: string } | null; season: { id: string; name: string } | null;  // null = pooled
  token: string; built: string; n: { games: number; decided: number; teams: number };
  lens: { explain: true; forecast: boolean; simulate: boolean };
  ci_at: string | null }                       // as built (A.2): when the intervals were last bootstrapped; a RECALCULATE carries them
interface Model { set: string[]; n: number; lambda: number; r2: number; r2cv: number; sigma: number; home: CI;
  coef: { k: string; b: number; lo: number; hi: number; se: number; own: CI | null; w: number; vif: number;
          sdTeam: { off: number; def: number; net: number }; pts: CI; wins30: CI; winsSeason: CI }[];
  shares: { k: string; phi: number; lo: number; hi: number }[]; oliver: Record<string, number> | null; legacy: Record<string, number> | null }
interface Wins extends Header {
  quality: { zones: number; timed: number; sit: number; stype: number; foulkind: number; stl: number; listed: number; heights: number;
             ok: { zones: boolean; timed: boolean; tovTypes: boolean; foulKinds: boolean } };
  meta: Record<string, { label: string; grp: string; unit: string; dir: 1|0|-1; score: boolean; def: string }>;
  homeWin: { p: number; lo: number; hi: number; n: number }; sigma: { acc: number; pred: number; src: 'forecast'|'elo' }; G: number;
  scan: { k: string; n: number; r: number; lo: number; hi: number; q: number; wonIt: number; wonLo: number; wonHi: number;
          decided: number; winMean: number; loseMean: number; vif: number | null; score: boolean }[];
  models: { core4c: Model; fullR2: number; shot: Model | null;
            extended: { r2: number; addR2: CI; F: number; p: number; groups: { g: string; phi: number; lo: number; hi: number }[] } | null };
  path: { k: string; direct: CI; indirect: CI; total: CI; via: { f: string; v: number }[] }[];
  predictive: { live: boolean; n: number; nEval: number; sigma: number; coef: { k: string; b: number; lo: number; hi: number }[];
                metrics: Cal; baselines: { home: Cal; elo: Cal; net: Cal; pyth: Cal }; logitAgree: boolean; eloHca: number;
                sim: { calibrated: boolean; brier: number; slope: number; checks: Record<string, { obs: number; sim: number }> } | null;
                transfer: { id: string; n: number; brier: number }[] | null };           // transfer: pooled only
  curves: Record<string, { bins: Bin[]; raw: Curve; adj: Curve | null; x50: CI | null; x75: CI | null;
    quart: { lo: number; hi: number; n: number; p: number; plo: number; phi: number }[]; hist: [number, number, number][];
    hard: { t: number; n: number; p: number; lo: number; hi: number } | null }>;
  tempo: { teams: { id: string; name: string; pace3q: number; z: number; winPct: number; net: number; gp: number }[];   // pooled: open leagues only
           bins: Bin[]; curve: Curve; curveAdj: Curve;
           sqrtN: { gamma: CI; a: number; b: number; lrP: number; n: number;
                    terciles: { rho: number; n: number; p: number; lo: number; hi: number; fit: number; fit0: number }[] } | null;
           control: { n: number; p: number; lo: number; hi: number; or: CI } | null; windows: { e: CI; m: CI; l: CI } | null };
  positions: { coverage: { listed: number; height: number; bpmOnly: number };
               p1: { g: 'G'|'F'|'C'; stat: string; b: number; lo: number; hi: number; star: boolean }[];
               p2: { g: 'G'|'F'|'C'; stat: string; top: number; topLo: number; topHi: number; mid: number; bottom: number }[];
               p2f: { g: 'G'|'F'|'C'; b: number; lo: number; hi: number }[] | null } | null;
  lineup: { grid: { s: number; b: '0'|'1'|'2+'; net: number; lo: number; hi: number; poss: number }[];
            terms: { k: string; b: number; lo: number; hi: number }[]; n: number; poss: number } | null;
  squad: { n: number; power: 'ok'|'low'; coef: { k: string; b: number; lo: number; hi: number; wins30: number; evidence: 'strong'|'some'|'none' }[];
           adj: { k: string; b: number; lo: number; hi: number; evidence: 'strong'|'some'|'none' }[];
           bands: Record<string, { p25: number; p50: number; p75: number }>; pd: Record<string, Curve> } | null;
  losses: { parts: { k: string; pts: number; lo: number; hi: number }[]; luckSd: number; n: number };
  blocks: { keys: string[]; scale: number[]; lambda: number; list: { n: number; sw: number; xx: number[]; xy: number[]; yy: number; sy: number }[] } | null;  // league files only
  leagues: { id: string; slug: string; name: string; n: number; home: CI; top: string[];
             coef: { k: string; own: CI | null; eb: CI; w: number }[] }[] | null }    // pooled only, open leagues only
interface Fo extends Header {
  lg: { rates: Rates; T: number; Tot: number; kappaN: number; sigmaN: number; hca: number; tau: number; muOff: number; dTr: number;
        fouling: boolean; zones: boolean; G: number; homeEdge: number;
        lead: number; ft3: number;            // as built (WP2): the score effect and the three-shot share of shooting trips
        tripOff: number };                    // the trip offset (§8.3, R2S-3); 0 without fouling
  sim: { calibrated: boolean; platt: { a: number; b: number } | null; brier: number; slope: number };
  sigmaPred: number; predLive: boolean;
  value: Record<string, { b: number; lo: number; hi: number; model: 'core4c'|'shot'|'path'; dir: 1|0|-1; unit: string;
    sdTeam: { off: number; def: number; net: number }; lg: number;
    p25: { off: number; def: number }; p50: { off: number; def: number }; p75: { off: number; def: number } }>;
  teams: { id: string; name: string; short: string; colour: string; logo: string | null; gp: number; w: number; l: number; net: number;
           ortg: number; drtg: number; pace3q: number; pyth: number; elo: number; prof: { off: Rates; def: Rates; n: number };
           f: Record<string, { off: number | null; def: number | null }> }[];
  slots: { stats: string[]; p1: Wins['positions']['p1']; targets: Wins['positions']['p2']; forecast: Wins['positions']['p2f'] } | null;
  squad: Wins['squad']; lineup: Wins['lineup'];
  pos: Record<string, Pos> }                  // as built (A.1): team id -> its pos file; may be emptied to fit the budget
interface Club extends Header { team: { id: string; name: string };
  record: { w: number; l: number; pythW: number; factorW: number };      // factorW = Σ Φ(fitted margin from its factors / σ_acc)
  games: { g: string; d: string; opp: string; h: 1|0|-1; m: number; mc: number; xm: number;
           parts: { quality: number; making: number; tovp: number; orebp: number; ftmr: number; other: number; garbage: number };  // A.3: ftr (files before: ftmr)
           luck: number }[];                                            // club view; m = xm + Σ parts exactly
  losses: { n: number; mean: { k: string; pts: number; lo: number; hi: number }[] };
  realised: Record<string, { own: Rates; opp: Rates }>;                 // per game, for the loss Shapley
  squad: Record<string, number | null>; squadCoverage: { height: number; age: number };
  slots: Record<'G'|'F'|'C', Record<string, { v: number; z: number; target: number; sd: number | null }>>;   // sd: the team-season SD z uses (as built)
  lineups: { ids: string[]; s: number; b: '0'|'1'|'2+'; poss: number; net: number; pred: number }[];   // top 10
  players: { id: string; g: 'G'|'F'|'C'; v: number; min: number; bpm: number | null; roles: string[] }[];  // no names; withheld out
  pos: Pos | null }                            // as built (A.1)
interface Pos { w: 1; team: string; season: string; games: number; min: number;   // A.1, scope 'pos' (≤ 6 KB); no Header
  players: { id: string; pos: number; min: [number, number, number, number, number] }[]; slots: { slot: 1|2|3|4|5; top: string[] }[] }
interface Teaser { w: 1; scope: 'teaser'; token: string; built: string; n: number; homeWin: number;
  ranked: { k: string; label: string; r: number; winRate: number }[];    // EpinoiaWinning.analyse on PUBLIC_KEYS rows
  factors: { r2: number; home: number; shares: { k: string; share: number; oliver: number }[] } | null;
  leagues: { slug: string; name: string; n: number; top: { k: string; label: string; r: number; winRate: number } | null; homeWin: number }[] }
```
`EpinoiaWinModel.validate(file, scope)` → problems (empty when valid): the shape; the budget; no key `f`; no string over 40
characters outside label, name, def, slug and ids; pooled: no blocks, leagues ⊆ the open set; blocks n ≥ 8; teaser keys ⊆
PUBLIC_KEYS; club games only of the club.

## 10. Delivery and gating
The database decides at request time with the caller's token; `analyticsOk` (fails open) and memlock only pick a first
drawing. A plan change or the master switch applies on the next request; nothing public needs purging.

### 10.1 Edge Function `analytics-file`
`supabase/functions/_shared/analyticsfile.ts` holds the pure `handle(req, deps)` (no imports; tested in node with
`--experimental-strip-types`; `deps = {callerClient(auth | null), admin, env, sha256}`); `supabase/functions/analytics-file/
index.ts` wires supabase-js and `Deno.serve`; `supabase/config.toml` gets `[functions.analytics-file] verify_jwt = false`.
`POST {scope: 'wins'|'fo'|'club', league?, season?, team?}` (≤ 1 KB) with `apikey` and, signed in, `Authorization: Bearer
<JWT>`:
1. OPTIONS → CORS (origin env `ALLOWED_ORIGIN` or `*`; headers `authorization, content-type, apikey, x-client-info`;
   `POST, OPTIONS`). Other methods 405; a bad body or non-uuid id 400 `{reason: 'bad_request'}`.
2. A JWT bearer (three dot-separated parts) → caller client with it, else anonymous. `rpc analytics_check` →
   PostgREST rejects the JWT: 401 'jwt'; 'signin' 401; 'members' | 'league' | 'scope' 403.
3. Subject `'u:' + sub`, or `'ip:' + sha256(address | UTC date | env ANALYTICS_SALT)[0..32]`, the address the platform saw
   (cf-connecting-ip, x-real-ip, else the right end of x-forwarded-for; B.5), no user agent.
4. `admin.rpc analytics_take` → not ok: 429 `{reason: 'rate', retry_after}` + `Retry-After`, `X-RateLimit-Limit`,
   `X-RateLimit-Remaining`.
5. `analytics_files` row by scope, `league_key` (id or 'all'), `team_key` (id or ''), `season_key` = season or
   `is_current`; none → 404 `{reason: 'none'}`.
6. `createSignedUrl(path, 120)` → 200 `{url, token, bytes, built_at, layout, expires_in: 120}`.

All responses `Cache-Control: no-store`; logs carry scope, league, signed, bytes, never a token or URL. Limits (§5): signed
in 60/h and 400/day; signed out 20/h and 100/day.

### 10.2 Loader `epinoia/winfile.js` (`window.EpinoiaWinFile`)
`get({scope: 'wins'|'fo'|'club'|'teaser', league?, season?, team?})` → `{ok: true, data, token, built}` or `{ok: false,
reason: 'signin'|'members'|'league'|'scope'|'none'|'rate'|'layout'|'jwt'|'network', retryAfter?}`; `clear()`;
`FILE_V = 1`; `_setTransport(fn)` for tests. Teaser: `GET <supabaseUrl>/storage/v1/object/public/snapshots/whatwins/
index.json` then the named file. Others: `POST <supabaseUrl>/functions/v1/analytics-file` with `apikey:
EPINOIA_CONFIG.supabaseAnonKey` and `Authorization: 'Bearer ' + EpinoiaAccess.session().token` only when signed in (not
`authHeaders()`), then `GET url` with no headers; `data.w !== FILE_V` → 'layout'; a 400/403 from an expired signed URL is
retried once. Cache: memory and sessionStorage `epinoia_ww:<userId|anon>:<scope>:<league|all>:<season|current>:<team|->` =
`{token, at, data}` (under 2 MB), reused without a request for 10 minutes, then refreshed only if the token changed; a
different user on `EpinoiaAccess.onChange` clears every `epinoia_ww:` key; never localStorage; removes the legacy
`epinoia_winning_v1` on first load.

### 10.3 Lock catalogue
`epinoia/access.js`: `CATALOGUE.locks.model = {gate: 'analytics', label: 'What wins model'}` (unknown keys are free, so
pages work before it lands).

### 10.4 Boundary (docs/data-protection.md gets a section)
Protected: the ready-made analysis (files, game_features). Public by design: game_events, box-score tables, lineup_stints
(a determined scraper can rebuild features slowly; per-IP limits on /rest/v1 need an edge proxy outside this repository).
While memberships are off, files are open but rate-limited (or need sign-in with `analytics_signin`).

## 11. The What wins page (epinoia/winning/)
Rebuilt to docs/page-standard.md; `winning/index.html` leaves `PREDATE`. The existing meta and CSP stay; no inline script
or style.
- Head: `appmode.js`; `<script src="../i18n.js?v=568" data-i18n-packs="analysis"></script>`; `glyphs.js` defer. Sheets:
  kit/epinoia-kit.css, kit/nav.css, kit/access.css, kit/page.css, kit/vizkit.css, kit/winning.css, kit/sectitle.css,
  kit/teletext.css, kit/legibility.css. Scripts (defer, in order): config, access, memlock, data, teamcolour, winning,
  winstats, winsim, winfile, vizkit, xscroll, winning/page.js, nav.js (last).
- Frame `<div class="ep-frame ww" data-std>`, the standard topbar, `<header class="hero pg-head">` with `<p class="pg-kick"
  id="wwKick">`, `<h1>What wins</h1>`, `<p class="pg-sub">Which parts of the game turn into wins, what each is worth, and
  what a squad needs to win more.</p>`.
- `?l=<slug>`: read `leagues?slug=eq.<slug>&select=*`, `EpinoiaTeamColour.league(row, {keepAccent: !!(row.theme &&
  row.theme.accent)})`, kick links to the league. Other reads: `leagues?select=id,slug,name&order=name`,
  `seasons?league_id=eq.…&select=id,name,starts_on`, and EpinoiaWinFile. Address: `?l=&s=&lens=explain|forecast&k=&t1=&t2=`.
- Sections, all static: `<section class="sec" id="X" aria-labelledby="XH"><div class="sec-h"><h2 id="XH">Title</h2><p
  class="note">Note</p>` then controls.

| id | title | note | content |
|---|---|---|---|
| answer | The short answer | What decided these games, in plain numbers | league and season selects; ≤ 6 cards |
| value | What each factor is worth | Points of margin and wins for one step better, with a 95% range | Explains/Forecasts switch; units pts / wins per 30 / per unit; forest (hollow = shrunk, ghost = own); Shapley shares; pick-factors re-fit (Worker) |
| factors | Every measure | Each measure against the result, with how sure we can be | sortable table / bars of the scan, q, VIF, badges |
| curves | Where the line is | The chance of winning across each gap, and the break-even point | factor picker; binned curve, band, x50/x75; histogram; quartiles; the hard number |
| tempo | Pace and possession | Whether playing fast or holding the ball changes who wins | team pace vs win% (brushable); favourite's win% by expected possessions (γ); tempo control; time of possession direct/indirect; points per chance by shot-clock window |
| positions | By position | What guards, wings and bigs add, and what winners get from each | P1 heatmap; P2 dumbbells; P2f forest |
| squad | Building a squad | Roster shapes and lineup mixes that go with winning | lineup grid; squad coefficients with evidence; winners' bands; partial dependence |
| sim | Simulate a game | Pick two sides, move the dials, and see the odds change | two clubs, venue, six sliders a side, win meter ± error, margin histogram, needed tornado (loads the fo file when opened) |
| losses | Why games are lost | Each defeat split into shooting, turnovers, boards and the rest | league average loss waterfall; a club's losses |
| leagues | League by league | Each league’s answer, leaning on the rest where games are few | pooled: leagues × factors heatmap (hatched where w > 0.6); league: own vs pooled |
| model | How good is the model | Forecasts checked against games the model had not seen | reliability with baselines; metrics table; simulator checks; transfer; data-quality flags |
| method | How it is worked out | Definitions, sample sizes and what the numbers cannot say | static prose, public: lenses, definitions, §7.16, §7.17, data date and token |

- Cards (fixed templates, also i18n patterns, interval-backed only): "Shooting decides {p}% of the margin here
  ({lo}-{hi})"; the best hard number (never a score factor); the pace finding, one of four (B.5): "More possessions help
  the favourite: γ = {g} ({lo}-{hi})", "Longer games help the underdog here: γ = …", "The pace of a game does not change
  who wins here, once quality is counted: γ = …" (a narrow interval around 0 only) or "These games cannot yet tell whether
  pace changes who wins: γ could be anywhere from {lo} to {hi}"; "Home court is worth {a} points ({lo}-{hi}) and {p}% of
  games" with {a} the home side's mean margin (B.5; α is "Home court beyond the four factors"); "One team-SD better at
  {factor} is worth {w} wins per 30 games ({lo}-{hi})"; time of possession by its DIRECT effect (§7.10.4): "One second
  more a possession is worth {d} points of margin directly ({lo} to {hi}), beyond the four factors" or "… has no clear
  direct effect here …". Each with its lens chip.
- Not entitled: the teaser's cards (box-score preview) and, in member sections, `EpinoiaMemLock.placeholder({rows: 5,
  what: 'What wins model', leagueSlug})` or a sign-in link; titles stay; #method public. Under 20 games: `.pg-empty`
  "Fewer than 20 finished games here yet: showing every league pooled" and the pooled file. 'layout': "The model is being
  rebuilt; back within the hour". 'rate': "Too many requests: try again in {n} minutes". A file over 48 h old while newer
  finals exist: a banner with its build time. Missing data: `.hide` or `.pg-empty` saying how it fills.
- Interaction: tooltips (textContent) with value, interval, n and definition; tap pins; forest row → #curves factor;
  brushing; every chart `role="img"`, `<title>`, `<desc>`, focusable marks, arrows, Enter = table twin; numbers in
  `translate="no"`; reduced motion; forced colours. Phone (≤ 720 px): 16 px gutters, no sideways page scroll, redraw on
  width change > 2 px, labels above bars, transposed heatmaps, wide tables in `.ep-tw` (xscroll), 44 px slider targets,
  40 px `.pg-seg`, `touch-action: pan-y`.
- Words: pack `analysis` (`epinoia/i18n/{es,ja}/analysis.js`, key parity; phrases for static text, `patterns` for the card
  and tooltip templates). `winning.insights()` keeps its API but claims "How well a side shoots matters far more than
  where it shoots from" only when |r(eFG)| ≥ 2 × the largest |r| of the style group.

## 12. The Front office (epinoia/t/)
- `t/index.html`, in `#fosec` after the GM's view (grandfathered style): `<div class="ep-hdr"><span class="idx">F3</span>
  <h2>Win model</h2><span class="note" id="wmodelNote">what wins in this league, and what it means for the club</span></div>
  <div id="wmodel" class="ep-card"></div>`. Scripts before team.js: ../winstats.js, ../winsim.js, ../winfile.js,
  ../vizkit.js, fomodel.js; sheets before legibility.css: ../kit/vizkit.css, ../kit/fomodel.css; packs "report go frontoffice".
- Data when the tab first opens: `EpinoiaWinFile.get` fo and club, and fixtures to come (`games?or=(home_team_id.eq.…,
  away_team_id.eq.…)&status=in.(scheduled,live)&select=id,home_team_id,away_team_id,tipoff_at` + `inSeason()`). Refused →
  memlock placeholder; 'none' → "the model needs 20 finished games in this league".
- Blocks (collapsible, summary first): (1) verdict: record, Pythagorean and factor-expected wins, luck, projected wins
  p10-p50-p90, lens chips, one sentence ("Your biggest cost is {factor} on {end}: about {w} wins ({lo}-{hi}) over 30
  games"); (2) where the wins are: core4c at both ends (contributions summing to the factor-expected net, check printed)
  then the levers rimr, p3r, rimp, p3p, tr_freq, top_avg, live_share, ftr, each with value, median, winners' P75,
  contribution, wins per 30, interval, ▲▼; (3) needs ranked by wins over the remaining fixtures from reaching P75 alone
  (simulator counterfactual when calibrated, else §7.5), top 5 with target, "worth +x.x wins (± se)" and depth.js's NEED
  sentence; (4) slots: Guards / Wings / Bigs against P2 targets valued by P1, the two largest gaps, P2f, per-slot buttons
  `data-slot="PG"`… opening EpinoiaPosition (team.js wires the `#depth` handler on `#wmodel` too); (5) squad shape against
  winners' bands with evidence, the lineup grid with the club's five most used compositions and their real net; (6) why we
  lose: last 10 losses as waterfalls, mean parts over losses, "simulator check" (§8 loss Shapley) per loss; (7) what it
  takes to beat …: opponent (next fixture first), venue, P(win) ± error, margin histogram, values needed for 50% and 60% on
  six rates ("Hold them under 49.1 eFG% (your defence allows 52.3)"); (8) what if: sliders eFG ±5, TOV% ±4, OREB% ±8, FT rate
  ±10, 3PA rate ±10, seconds per possession ±3, offence or defence → Δ win% (next and average opponent), Δ projected wins,
  250 ms debounce, CRN, `?wi=<base64url>`; roster what-if where P2f exists (remove a player or add a median shooter at a
  slot → `projectedMinutes` → Δ group BPM × θ → Δ net → make-logit shift matching it in the simulator → Δ wins, "approximate").
- `depth.gm(o)` accepts `o.model = {wins: {<MEASURES key>: number}}` built by `EpinoiaFoModel.gmModel` through KEYMAP:
  ff_efg/dff_efg → c_efg off/def, ff_tov/dff_tov → c_tovp, ff_oreb/dff_oreb → c_orebp, ff_ftr/dff_ftr → c_ftmr (A.3: c_ftr, which is what depth.js's ff_ftr measures),
  p3_pct → p3p off, ft_pct → ftp off, rim_pct → rimp off (ortg, drtg, net unmapped). Selection unchanged; order by |wins|
  (unmapped after, in rank order); entries gain `wins`; needs follow. Without a model the output is byte-identical.
  `positionOf`, `projectedMinutes` and `chart` do not change (the builder uses positionOf).
- Light read: new `seasonGames(team)` → `{gs, sideOf}` with seasonLogs' games query (reusing `logsP` when loaded);
  `frontOffice()` calls it instead of `seasonLogs()`, which is untouched. Opening the tab no longer downloads ~7 MB of logs.

## 13. Chart kit (epinoia/vizkit.js, epinoia/kit/vizkit.css)
UMD, pure SVG-string builders plus one DOM binder; no library. Builders `(data, o) → {svg, table: {head, rows}, hits:
[{id, x, y, label, value}]}`, `o = {W = 760, H, x: {lo, hi, label, fmt}, y, theme}`: forest (hollow, ghost, muted, badge),
stackShare, bars (diverging, ▲▼), binnedCurve, histogram, scatter (fit, brush), line, heatmap ('div' | 'seq', hatch),
dumbbell, waterfall, tornado, meter, reliability, smallMultiples. `bind(host, built, {onHover, onPick, label}) → {redraw,
destroy}`: one pointer layer, nearest hit within 24 px, textContent tooltip, tap to pin, roving focus with arrows, Enter
toggles the table twin, ResizeObserver (> 2 px) and a `data-theme` MutationObserver redraw. Helpers `niceTicks` (chartlab's
algorithm), `nearest`, `theme(el)`, `tableTwin`, `png(svg, w, h)` (members only). Colour: series `--vz-s1..3` = chartlab's
validated slots (dark #3987e5 #d95926 #199e70; light #2a78d6 #eb6834 #1baf7a, the light s3 at 2.66:1 so always labelled or
tabled); G/F/C = s1/s2/s3; good/bad = `color-mix(in oklch, var(--good|--bad) t%, transparent)` with ▲▼ or ± (light CVD
ΔE 6.3); sequential = s1 by opacity, 5 steps; never kit neons as categories, never `--lume` for heat. Figures `--f-data`;
labels `--f-micro` ≤ .2em tracking. Dark tokens on `:root`, light on `:root[data-theme="light"]`; reduced-motion and
forced-colors rules.

## 14. Interfaces not already fixed above
`EpinoiaFeatures` (§3): `FV, LAYOUT, INDEX, QBITS, FACTORS, PUBLIC_KEYS, CLUTCH_MS, GARBAGE, BONUS, extract, toRows, fromRow,
derive, seasonFactors, valid`. `EpinoiaWinFile` (§10.2). `EpinoiaVizKit` (§13).
```js
// epinoia/winstats.js  window.EpinoiaWinStats
normCdf, normPdf, normInv, logit, expit;  rng(seed) /* mulberry32 */;  normal(rand);  hash(str) /* FNV-1a */
chol(A, p), cholSolve(L, b, p), invSPD(A, p), gaussJordan(A, b, p)
suff(X, y, w?) -> {p, n, sw, xx, xy, yy, sy};  addSuff(a, b), subSuff(a, b), pick(S, cols)
ridge(S, {lambda = 0, pen, prior?}) -> {b, A, Ainv, rss, sigma2, df, r2, n}
cvLambda(blocks, {folds = 5, lo = 1e-4, hi = 10, pen}) -> {lambda, mse, path}
clusterCov(blocks, fit) -> Float64Array;  blockBootstrap(blocks, fitFn, {B = 400, seed, strata?}) -> {est, draws, lo, hi, se}
logistic(X, y, {lambda = 0, pen?, w?, offset?, maxIter = 25, tol = 1e-8}) -> {b, cov, ll, iters, converged, separated}
corrFromSuff(S), vif(R, p), condNumber(R, p);  shapleyR2(S, groups, {force, lambda?, pen?}) -> {total, phi}
dersimonianLaird(est: {b, v}[]) -> tau2;  ebPosterior(bOwn, Vown, bPool, tau2) -> {b, V, w}
wilson(k, n, z = 1.96), fisherCI(r, nEff), fisherP(r, nEff), bh(ps), welchCI(m1, v1, n1, m2, v2, n2), icc(groups)
pointBiserial(x, w, {dir = 1, blocks}) -> {r, lo, hi, p, n, nEff}
bins(x, w, m, {n = 10, minN = 30}) -> Bin[];  quantile(sorted, q);  nsBasis(x, knots)
gamLogit({x, y, X?, h?, knots?, lambda?, grid = 25}) -> {knots, b, cov, grid: Curve, at(x) -> {p, lo, hi}}
calibration(p, y, {bins = 10}) -> Cal;  valueScale({b, sdTeam, sigma, G, sigmaAcc?}) -> {pts, wins} | null
winsOver(mus, delta, sigma);  oaxaca({beta, alpha, h, dx, ex, y, yc}) -> {expected, parts, other, garbage}
golden(f, lo, hi, {tol, maxIter}) -> {x, fx};  bisect(f, lo, hi, {tol, maxIter});  niceTicks(lo, hi, n)

// epinoia/winsim.js  window.EpinoiaWinSim
RATES, K_PRIOR;  profile({off: {rate: {x, n}}, def, games}, lg) -> Profile
matchup(A, B, L, {home: 1|0|-1}) -> Match;  game(M, rand, randFt, {fouling = true}) -> {pts, poss, ot, tally: [Tally, Tally]}
  // Tally keys = the LAYOUT names it can make: pts fga fgm fg3a fg3m fta ftm oreb dreb tov rim_a rim_m mid_a mid_m poss
  // chances to_live trips_shooting trips_bonus and1 reb_off_ch reb_def_ch tr_ch tr_pts timed_s timed_n
simulate(M, {n = 5000, seed = 1}) -> {pWin, pRaw, se, mean, sd, q05, q50, q95, hist, pts, poss}
applyEdits(P, [{end, key: 'efg'|'tovp'|'orebp'|'ftr'|'p3r'|'secs', delta}], L) -> Profile
counterfactual(M, [{side, end, key, delta}], {n = 4000, seed}) -> {base, alt, dWin, se, dMargin}
needed(M, key, {side = 'A', end = 'off', target = 0.5, n = 3000, seed}) -> {value, delta, p, reached}
shapley(Mexp, Mplayed, groups, {n = 1000, seed}) -> {phi, base, full}
season(own, [{opp, home}], L, {n = 2000, seed, done, sigma?, mu?}) -> {mean, p10, p50, p90, dist}
calibrate(games, L, {seed}) -> {hca, tau, kappaN, sigmaN, muOff, dTr, fouling, tripOff, platt, report}
synth({teams = 12, games = 132, seed}) -> {league, profiles, games}

// epinoia/winmodel.js  window.EpinoiaWinModel
FILE_V = 1, CODE_V = 1, STORE_V = 1, BUDGET, KEYMAP, normListed(s), groupsFor(players) -> Map, roles(players, unit) -> Map
blocksOf(games) -> number[];  storeAdd(store, rows, games, pgs, stints), storeDrop(store, ids)
buildUnit(input, {priors, seed, B = 400, simN = 1000, now}) -> {wins, fo, clubs: Map, warnings}
buildPool(inputs, open: Set, opts) -> {wins, priors, warnings};  buildTeaser(inputs, open, opts) -> Teaser
validate(file, scope) -> string[];  pack(file), unpack(obj);  synthUnit({teams, games, seed, zones = true}) -> UnitInput
// UnitInput = {league, season, store, players, prevPlayers, teams, rosters, bios, withheld: Set, venues, homeVenues, scheduled, open}

// epinoia/t/fomodel.js  window.EpinoiaFoModel
KEYMAP (equal to winmodel's);  view({fo, club, team, seasonRows, chart, fixtures}) -> {verdict, ledger, needs, slots, squad, losses, next, whatIf}
ledger(fo, teamId), needs(fo, teamId, {fixtures, sim}), gmModel(fo, teamId) -> {wins: {measureKey: number}}
mount(host, vm, {worker, link, onSlot}) -> {destroy};  html: {verdict, ledger, needs, slots, squad, losses, next, whatIf}
```

## 15. Performance budget
| | today | target |
|---|---|---|
| What wins, member, cold | 13 requests, 1.60 MB, ~6.7 s, 1.88 MB localStorage | 3 requests, ≤ 300 KB, first chart ≤ 1.5 s on 4G, no localStorage |
| What wins, signed out | the same | 2 requests, ≤ 41 KB |
| re-fit + B 200 / 10k sims / counterfactual / needed / loss Shapley | – | ≤ 250 ms / ≤ 150 ms / ≤ 300 ms / ≤ 1 s / ≤ 2 s (Worker) |
| Front office | 40 event logs (~7 MB) + season reads | season reads + fo ≤ 100 KB + club ≤ 25 KB + fixtures |
| finalise-game | – | + ≤ 6 ms CPU (p95 ≤ 10 ms), one 2-row upsert, never blocking |
| game_features | – | ~0.5 KB a row: 1.5 MB today, ~35 MB per NCAA division-season |
| builder | – | ~1 KB per new game read; < 3 min typical; < 50 MB/day egress (≤ 0.6 GB/day at NCAA scale) |

## 16. Tests (every new one `supabase/tests/ww-*.test.mjs`, run by `run-ww.mjs` in one guard step)
- **WP1** `ww-features`: on `fixtures/game.json`, its halves conversion (periods 1-2 → 1, 3-4 → 2, +600,000 ms on the
  first of each pair), its copy without `loc`/`stype`, and an overtime variant: 108 unique contiguous indices; box counts
  = teamAdv; poss = SC count; `timed_s/timed_n` = `ShotClock.averages` (1e-9); top_share sums to 1; lead_changes and ties
  equal on both rows; pts_h1 + pts_h2 + pts_ot = score; to_live ≤ to_n; stripped game: MARK, TYPE, ZONES off and rimr
  null; halves bonus limit 7; and-ones and trips on hand-built sequences (FT logged before its foul, assist between FTs);
  deterministic; < 15 ms a game; toRows rounding and null; seasonFactors a ratio of sums under masks. `ww-gate` (pglite,
  front-office.test.mjs pattern, stand-ins then 0207): anon/authenticated cannot select the three tables; bucket private;
  analytics_check answers ok / members / league / scope / signin as §5; the 61st signed-in and 21st anonymous call in an
  hour refused with retry_after > 0; prune works; no `raise` with `%`. `ww-function`: 405, 400, 401/403/404/429 with
  headers, the caller's token used for the check, `createSignedUrl(path, 120)`, no-store; config.toml entry; finalise-game
  wiring (own try/catch outside the inserts' Promise.all, FEATURES_OFF, reopen delete). `ww-winfile`: headers, reasons,
  one expired-URL retry, 10-minute reuse, user-keyed cache cleared on user change, no localStorage writes, legacy key
  removed, 'layout'.
- **WP2** `ww-winstats`: Cholesky/ridge(0) = `EpinoiaWinning.ols` = Gauss-Jordan (1e-9); ridge with prior and λ → ∞ = prior;
  block sums = row statistics; recovery within 3 SE; bootstrap and CR1 95% coverage over 200 replications in [0.92, 0.98];
  Wilson coverage [0.93, 0.97]; logistic = 2×2 MLE, separation flagged; VIF at r = 0.96 = 12.76 ± 2%; Shapley sums to
  1e-10 and splits duplicated columns equally; DerSimonian-Laird hand example; EB limits (V → ∞ pooled, V → 0 own);
  Wilson(8, 10) = [0.490, 0.943]; BH hand example; normCdf/normInv round trip 1e-10; calibrated synthetic slope 1 ± 0.05,
  ECE < 0.02; `valueScale({b: 1, sdTeam: 2, sigma: 12, G: 30})` = pts 2, wins 1.98551 (± 1e-4), and null for sigma 5 with
  sigmaAcc 4; oaxaca exact; gamLogit within 0.02; bins minN; a 35,000 × 40 Gram < 1 s. `ww-winsim`: determinism; points
  per possession = Markov expectation (3 MC SE); orb 1 and make 0.5 → 2 chances per possession; possessions = κ_N T/(d_A +
  d_B); P(A,B,home) + P(B,A,away) = 1 (2 SE); identical teams 0.5; +eFG up and +TOV down (z > 3, paired); CRN variance
  < 20% of independent arms; needed within 0.01; Shapley exact; favourite's win share rises with N; no ties; calibrate
  recovers planted hca and τ; 10,000 games < 400 ms; Worker protocol in a vm sandbox.
- **WP3** `ww-winmodel` (synthUnit leagues of 20-400 games): core4c signs and Shapley shares within 5 points of truth;
  small league shrunk (w > 0.6); Forecast beats home-only when teams differ; planted indirect effect and shooter effect
  recovered; Oaxaca identity to 1e-9 every game; rolling origin never trains on a game in or after its test week;
  normListed covers §7.12; groupsFor 40/40/20; validate and budgets pass; teaser ⊆ PUBLIC_KEYS; pooled without blocks and
  only open leagues; deterministic; wins use `predictive.sigma` ≠ `core4c.sigma`. `ww-build` (mocked Supabase): keyset
  only; incremental = full byte for byte; re-finalised game replaced; unchanged token skipped, floor honoured; index after
  upload, delete after index; dry run writes nothing; deleted league purged; over-budget keeps the old file; no
  `stats->sit` or whole `stats`; `--fixtures` writes the five sample files (`supabase/tests/fixtures/ww/`).
- **WP4** `ww-vizkit`: well-formed SVG with role/title/desc; escaping; niceTicks = chartlab's; nearest within 24 px; table
  twin holds every value; whiskers ordered; waterfall sums; extreme heatmap cells carry ▲▼; series contrast ≥ 2.5:1 on
  both grounds except the light s3. `ww-page`: CSP, no inline script or `on*=`; twelve static sections with their notes;
  nav.js last; teamcolour.js; analysis pack parity; page.js names none of the five tables of I1 nor `localStorage.setItem`,
  and removes the legacy key; locked fixture shows placeholders and no numbers; each section draws from
  `fixtures/ww-page/*.json`. page-standard, legibility, i18n pass; winning.test.mjs drops the `i += 150` and 6-hour checks
  and checks EpinoiaWinFile and the conditional insight.
- **WP5** depth.test.mjs: existing cases byte-identical; a model reorders and adds `wins`. `ww-fomodel`
  (`fixtures/ww-fo/*.json`): core contributions sum to the factor-expected net (1e-6); needs sorted; loss parts sum to
  margins; refusal draws no numbers; KEYMAP = winmodel's when present; the Front office path calls `seasonGames`, never
  `D.events`, and `seasonLogs` is unchanged.
- **WP6** `ww-contract`: `ww-page` and `ww-fo` fixtures pass `EpinoiaWinModel.validate`; only features.js, the builder, the
  backfill, finalise-game and 0207 name `game_features`; the snapshots function names neither it nor the bucket; no
  `stats->sit` in new files; `CATALOGUE.locks.model`; `stamp-assets.py --check`.
- **Live acceptance** (builder job summary, not blocking): pooled full-game four-factor R² in [0.93, 0.95] with OLS near efg
  1.157, tovp −1.130, orebp 0.398, ftr 0.094 (FTA/FGA); eFG share [40, 55] (as built: this band is the old |b|·sd share, `models.core4c.legacy`; the Shapley R²
  share of eFG is 63-74% on live data and has no band); home win [0.55, 0.59]; Forecast Brier < home-only
  and ≤ Elo + 0.002; slope [0.85, 1.15]; simulator ortg and pace within 0.5, margin SD ratio [0.95, 1.05], home within 1.5
  points. A miss downgrades the unit's chip.
- **Manual**: Playwright signed out, signed in and `epinoia_access_sim = 'locked'` (requests, bytes); 375 and 1,280 px in
  both themes; keyboard; es and ja; the Front office for orlen-basket-liga and for a league under 20 games; 61 requests in
  an hour; one time of possession checked against the game page's shot clock tab.

## 17. Release runbook
1. premium-move.yml until `premium_sit_remaining()` = 0 (2,642 team rows and ~21-25k player rows still expose `stats.sit`).
2. Check and redeploy the snapshots function (live files are v2; last build 2026-09-28).
3. `npx supabase db push` (0207).
4. `npx supabase functions deploy finalise-game` and `npx supabase functions deploy analytics-file --no-verify-jwt`; set the
   function secret `ANALYTICS_SALT`.
5. backfill-features.yml: dry run, then real, until `game_features_missing` is empty.
6. analytics.yml by hand once; read the job summary; variables `ANALYTICS_MIN_GAP_H` (1) and `ANALYTICS_POOL_GAP_H` (6), 6
   for both once NCAA is on.
7. Decide `platform_settings.analytics_signin`.
8. Publish (WP6 bumps the stamps).

## 18. Risks
Reading accounting as cause (lenses, path model, #method). Small samples (33 of 45 leagues under 20 games; ~600
team-seasons: pooling, EB, badges). Feed quality (bits, masks, one rim rule, two-zone simulator). Endogeneity of pace and
time of possession (pace3q, pre-game N, competitive time). Estimated positions (one positionOf, normListed, coverage; move
normListed into season.js later). Simulator mis-specification (calibration, τ, Platt, gate). Raw tables stay public; edge
rate limits are outside the repo; files are open while memberships are off unless sign-in is required; watch
`analytics_issue_log` for farmed accounts. Operational state (runbook 1-2). A feature bug never blocks finalising
(try/catch, FEATURES_OFF, backfill). Layout bumps (FV, FILE_V, 'layout'). NCAA scale (per-league-season files, cache,
floors, stint caps, sampled validation).

## 19. Work packages
| WP | name | depends on |
|---|---|---|
| WP1 | Feature line and members-only delivery | – |
| WP2 | Statistics and simulation engine | – |
| WP3 | Model builder | WP1, WP2 |
| WP4 | What wins page and chart kit | WP1, WP2 |
| WP5 | Front office | WP1, WP2, WP4 |
| WP6 | Integration and release | all |

No file belongs to two packages; WP6's `stamp-assets.py --bump` rewrites `?v=` everywhere only after every merge.


---

## A. Addendum (lead, after the design panel; these override anything above they contradict)

### A.0 Migration number
`main` already has `0207_league_creators.sql` and `0208_scorer_reliability.sql`. The What wins migration is the **next free
number at build time** (today `0211_what_wins.sql`; main took 0209 and 0210 first): every reference to `0207_what_wins.sql` in this spec means that file.
Check `git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3` before naming it.

### A.1 Positions by the floor (user requirement, overrides §7.12's 40/40/20 cut where stints exist)
"Front office positions are calculated via minutes share at each position via the BPM position estimation dynamically
registering players to positions in game": for EVERY stint (each five on the floor, from the engine replay / the same
segments lineupevents.js and lineup_stints use), the five are RANKED by their BPM position estimate (EpinoiaBPM
estimatePosition on the player's season-to-date totals in that league-season: 1.0 = point guard … 5.0 = centre); the
lowest gets slot 1 (PG), the next slot 2 (SG), … slot 5 (C). Ties: the season-long estimate (more decimals), then season
minutes (more first to the lower slot only if their estimates are equal), then player id. Each player's stint seconds are
added to his slot. So two guards at 1.4 who share the floor: the slightly higher one is the 2 for those minutes, and the
depth chart's 2 is never bare when someone played it.
- **Storage**: the per-game feature row carries each side's stints compactly (`st`: array of `[s, i1,i2,i3,i4,i5]` with
  `s` = seconds and `i` = indexes into the game's player list, plus the player id list) so the builder can RE-RANK when
  season estimates move (dynamic: positions update with every build, no re-reading events). Size: ~20-40 stints a team
  a game.
- **Builder output, simple and low-data JSON** (scope `pos`, one per team-season, 1-3 KB, delivered like `club` files and
  also embedded in `fo`/`club`):
  ```json
  {"w":1,"team":"<team uuid>","season":"<season uuid>","games":12,"min":2400.0,
   "players":[{"id":"<player uuid>","pos":1.42,"min":[310.5,92.0,0,0,0]}],
   "slots":[{"slot":1,"top":["<player uuid>","<player uuid>"]}]}
  ```
  `min` = minutes at slots 1..5 (one decimal), `pos` = the season estimate used (two decimals), `slots[k].top` = players
  by minutes at that slot. Players sorted by total minutes. Numbers rounded; no names (the page has them).
- **Uses**: the Front office depth chart (t/depth.js) fills each position from these minutes (share bars), falling back to
  the listed/height/BPM blend only for a team with no stints; §7.12 groups become G = slots 1-2, F = 3-4, C = 5 from
  these minutes (fallback as now); squad construction and per-position analysis read the same file. A pure function
  `slotMinutes(stints, estimates)` (in epinoia/winmodel.js, also used by the depth chart for a projected rotation) is
  unit-tested: the 1.4/1.4 case, ties, a five with a missing estimate (sorted last by listed position then height), a
  stint with fewer than five known players (skipped and counted).

### A.2 Dynamic, safe, data-saving updates with a RECALCULATE button (user requirement)
"It should dynamically adjust to games in a safe, data saving/processing kind manner - maybe with a 'recalculate'
button with a loading bar":
- **Incremental by construction**: a game's feature line is computed ONCE (finalise-game; backfill for history) and never
  recomputed unless the game is corrected (finalised_at moves). Builds read only rows the store has not seen.
- **Sufficient statistics in the store**: the builder keeps, per unit, the model's sufficient statistics in the private
  `store` file (X'X, X'y and counts for the ridge/logit blocks or the IRLS state; bin sums for curves; rate sums for the
  simulator; per-team season sums; slot-minute sums), so an UPDATE with k new games is O(k·p + p³), not a refit from raw
  rows. A pure `winmodel.update(store, deltaRows) -> {store, file}` produces the same point estimates as a full build on
  the union (tested to 1e-9 on fixtures); bootstrap intervals are carried from the last full build and flagged
  (`ci_at`), and refreshed by the next scheduled full build.
- **The button**: on the What wins page and the Front office model panel, a status line "Model of N games · built 2 h ago ·
  12 new games since" (the new-game count comes from a cheap HEAD/count, or from `analytics-file` answering
  `{pending: n}`). RECALCULATE is enabled only when pending > 0 (greyed with "up to date" otherwise). Pressing it calls
  `analytics-file` with `{refresh: true}` for that unit: the function runs `winmodel.update` server-side on the delta
  (service role; at most a few hundred rows), writes the new file version, returns it. Guarded: members only (same gate as
  the files), one refresh per unit per 10 minutes for everyone (concurrent presses join the same refresh), a per-user
  limit, and it refuses deltas above a cap (e.g. 500 games) with "a full rebuild is scheduled" instead.
- **The loading bar**: a real staged progress bar (CEEFAX style), honest about each step: 1 checking (what changed), 2
  updating the model (server), 3 downloading the new file (bytes), 4 re-simulating (the Web Worker posts `{progress}`
  during simulator calibration / what-ifs), 5 drawing. Cancel button (aborts the client steps; a server update already
  started still completes and is reused next time). aria-live announcements, reduced-motion respected.
- **Data saving**: the browser never downloads raw rows; files are per unit, versioned by token, cached in
  sessionStorage (and memory) per user, reused for 10 minutes then refreshed only if the token changed; a recalculation
  downloads one new compact file. The heavy maths (bootstrap, Monte Carlo) runs in the worker in idle slices.
- **Edge function limits**: if a delta update cannot finish within the function's time budget, it answers `{queued: true}`
  and marks the unit due so the next scheduled build picks it up first; the UI says so plainly.


---

## B. As built (WP6, 2026-10-01; records what the six packages built where it differs from the above)

### B.0 Where things are
| Piece | File(s) |
|---|---|
| Feature line (FV 1) | `epinoia/features.js` (+ generated `supabase/functions/_shared/features.js`) |
| Migration | `supabase/migrations/0211_what_wins.sql` (A.0: `main` has 0207-0210 (league_creators, scorer_reliability, league_picks_sources, scouts)) |
| Writing the line | `supabase/functions/finalise-game/index.ts`, `scripts/backfill_features.mjs`, `.github/workflows/backfill-features.yml` |
| Delivery | `supabase/functions/_shared/analyticsfile.ts` (pure `handle`), `supabase/functions/analytics-file/index.ts`, `epinoia/winfile.js` |
| Statistics, simulator | `epinoia/winstats.js`, `epinoia/winsim.js`, `epinoia/winsim.worker.js` |
| Model, builder | `epinoia/winmodel.js`, `tools/build-analytics.mjs`, `.github/workflows/analytics.yml` |
| Page, chart kit | `epinoia/winning/` (`index.html`, `page.js`), `epinoia/vizkit.js`, `epinoia/kit/vizkit.css`, `epinoia/kit/winning.css` |
| Front office | `epinoia/t/fomodel.js`, `epinoia/kit/fomodel.css`, `epinoia/t/depth.js` (`slotChart`, `gm` with a model), `epinoia/t/team.js` |
| Words | `epinoia/i18n/{es,ja}/analysis.js` (533 phrases), `epinoia/i18n/{es,ja}/frontoffice.js` (206 phrases) |
| Tests | twelve `supabase/tests/ww-*.test.mjs`, run by `supabase/tests/run-ww.mjs --strict` in one guard step |

### B.1 What differs from the spec
**WP1: the feature line and delivery**
- `game_features` has an extra nullable `st jsonb` (A.1's stints: `{p: [player ids], s: [[seconds, i1..i5], ...]}`), so a row
  is about 1.4 KB of JSON (f alone about 320 B), not 0.5 KB.
- `analytics_files`: the scope CHECK adds `'pos'`, and there is an extra `ci_at timestamptz`. `analytics_check` checks
  'pos' exactly like 'club'.
- `analytics_take` counts only rows whose scope is not 'refresh'. RECALCULATE has its own table and functions:
  `analytics_refresh (league_id, season_id, started_at, finished_at, status, by_subject, due)`,
  `analytics_refresh_take(subject, league, season)` → `{ok}` | `{ok: false, state: 'rate'|'running'|'recent', retry_after?}`
  (6 an hour, 20 a day per subject; a refresh that died can be taken over after 10 minutes) and
  `analytics_refresh_done(league, season, 'done'|'failed'|'queued')`.
- `analytics-file`: RECALCULATE needs a signed-in caller (401 'signin') and a league's own unit (403 'scope' for the pooled
  file). Answers add `refreshed`, `queued`, `refresh_reason`, `joined`, `retry_after`; every 200 carries `n_games`, `pending`
  (null for the pooled file) and `ci_at`. A database error is 503 `{reason: 'unavailable'}` (winfile maps it to 'network').
  `index.ts` states the CORS headers and answers OPTIONS itself (cors.test.mjs). It imports, in order, engine, possessions,
  situations, shotclock, features, winstats, winsim, bpm, winmodel (winsim finds EpinoiaWinStats on globalThis under Deno;
  bpm.js so positions, lineups and P2f match the builder's).
- `features.js` also exports `CLUTCH_MARGIN` (5) and `N` (108). FACTORS entries also carry `uses, pg, min, builder, fn`; the
  builder-only factors (xefg, making, xpts, luck_pts) have `builder: true` and no formula. Where §3.6 gives no direction:
  astp/stlp/blkp +1, live_share −1, max_deficit −1. dreb_start needs TIMED. A factor's need bits must be on both rows. With
  no plays every quality bit is cleared, SIT included.
- `winfile.js` adds `cached(o)`, options `{onProgress, signal, force}` and the reason 'aborted'.
- The ww-features timing check uses the p95 budget (10 ms), not 6 ms; measured about 2 ms on the fixture, 1.9 ms p50 live.
- Feeds where every foul is 'personal' (ORLEN, NBL, EuroLeague) have no FOULKIND bit, so and1, trips_shooting and the
  foul kinds are masked there (and1 reads 0, trips_bonus is inflated before masking).

**WP2: statistics and simulator**
- CRN (§8.2): each possession draws its chances from its own sub-stream (fmix32 of the game stream) and its free throws from
  a sub-stream of `rng(seed ^ i ^ 0x85EBCA6B)`, so one changed outcome does not shift every later draw (variance ratio 0.019).
- At a neutral venue a game-level coin picks the first possession (identical sides 0.5001).
- A score effect `lead` in L: make logits shift by −lead × (gap from the expected path, capped ±20) / 10. calibrate fits
  `lead` when the simulator spreads margins too widely and τ when too narrowly (one is always 0). Without it independent
  possessions gave about 1.25× the observed margin SD.
- A shooting foul is a three-shot trip with probability `L.ft3` (0.05), not the three-point share of the shot mix.
- `endInput` rates: sfoul and bonus are per chance that did not end in a turnover; free throws are conserved (any not from a
  shooting trip or an and-one counts as a two-shot bonus trip); orb is per missed shot plus 0.12 of missed last free throws;
  without FOULKIND, and-ones come from the chance accounting and the remaining trips are split by the league share. The
  default and-one rate is 0.05.
- dTr is split around each side's expected transition share s: half court −dTr·s, transition +dTr·(1 − s).
- calibrate's order: κN/σN, dTr, muOff, dTr, muOff, hca, spread (τ or lead), hca, muOff, fouling, κN. Validation
  probabilities use (wins + 0.5)/(sims + 1).
- Edits: tovp and ftr are solved exactly on the model's own box numbers (`natural()`); efg is one logit shift.
- `counterfactual` splits half home, half away by default (`split: false` keeps the venue). Tallies add `gain_dreb`; `game()`
  also returns the possessions pair. The worker also answers 'calibrate' and 'bootstrap', with positional or named args.
- winstats conventions: `suff` carries `sx`; ridge's `pen` is per column (s_k² supplied by the caller), scaled by sw; gamLogit
  has an intercept, λ 1e-5 and a P2-P98 grid; condNumber is √(λmax/λmin) of the correlation matrix; `wilson` and `fisherCI`
  return [lo, hi]; `valueScale` also returns wins30 and winsSeason; `oaxaca` takes an optional quality / making split.

**WP3: the model and builder**
- The private store holds each game's compact lines (two 108-count rows, quality bits, player lines, stints) and the last full
  build's carry, not pre-summed X'X blocks. `update()` recomputes every statistic from those lines (O(n·p)), because the CV
  λ, Elo walk, curves, probit γ and simulator inputs are not additive; it never re-reads old rows, and its point estimates
  equal a full build exactly (worst difference 0 on real data). The store is about 1.6 MB for 275 games.
- Player season rows come from the store's player lines (18 named keys), not data.js `season()`.
- EB uses CR1 only with at least max(10, 2p) blocks, otherwise the model-based covariance (CR1 gave a 3-block league zero
  variance in some directions). DerSimonian-Laird: with 4+ leagues of 50+ games a τ² below (0.01β_pool)² is set to that
  floor (full pooling); fewer such leagues use (0.25β_pool)².
- §7.12 P1: usage, assist, rebound and turnover shares are reported as contrasts (b_g minus the mean of G, F, C), which are
  identified; the page words them "against an even spread". The pooled squad model centres within each league-season.
- §8.3: evalSims 1,000 up to 2,000 games, 400 above.
- Budgets: a pos file 6 KB. Club trimming: lineups to 5, realised rates to the last 5 defeats, pos.slots dropped, parts to
  1 decimal. fo trimming: pos slots, squad pd, the embedded pos, then teams[].f to the core four.
- Builder additions: building a league's current season retires its other seasons' current rows; a store refreshed only for
  the pooled file gets its index row; the store is not downloaded when the cache holds the indexed token; stints are capped
  at the latest 3,000 games; `--local --out` reads only public tables with the publishable key; `--fixtures` writes compact
  JSON; test hooks `opts.trace`, `opts.raw`, `budget`.
- Index rows: scope 'store' (league_key = league id, season_key = season id, team_key ''), 'pos' with team_key; paths are
  inside the bucket (`wins/<league>/<season>/v1-<token>.json`); `ci_at` set on full builds; units with
  `analytics_refresh.due` go first and the flag is cleared; every run calls `analytics_issue_prune`.
- `club.slots[g][stat].sd` (added in WP6 at WP5's request): the team-season SD the z uses.

**WP4: the page and chart kit**
- The fixtures in `supabase/tests/fixtures/ww-page/` are the builder's real `--local` output (ORLEN 2025-26, the pooled file,
  the Zastal club file, the teaser), curves cut to ten factors. They predate `slots[].sd`.
- §11 P2: BPM and min_share are left out of the "% above the median" dumbbell (a median near 0 swamps it) and listed in a
  table under it. The hard-number card skips score factors. Style factors (dir 0) are drawn neutral.
- A refusal that is not about entitlement (rate, layout, network, none with no pooled file) shows a plain message in each
  member section rather than the membership placeholder.
- The chart kit's table button reads "show table" / "hide table" (the core dictionary translates "table" as standings).
  On a phone, the bars chart gives its value labels the room the longest one needs (WP6, at WP5's request).
- The analysis pack carries a `keep` list (Elo, ECE, AUC, P25, P50, P75, Dean Oliver) and every FACTORS label and definition.

**WP5: the Front office**
- Expected margins of the fixtures to come always use Elo plus `lg.homeEdge` (the fo file has no Forecast coefficients).
- Needs drop factor/end pairs whose b interval spans 0; with no fixtures left a need is worth G·(Φ(δ/σ) − ½) over a season
  against an average side. The simulator's counterfactual replaces the margin model only for calibrated units.
- Slot gaps value only non-share statistics (P1 identifies only the share contrasts); each gap is P1's points per team-SD ×
  (target − v)/SD, clamped to ±3 SD, with SD = `club.slots[g][stat].sd` (files built before it: |v − median|/|z|, which on
  ORLEN understated the C true-shooting SD by about 2.5×).
- An uncalibrated simulator: P(win) shown is the margin model's, with the simulator's beside it; "needed" values come from
  the margin model. The roster what-if converts group BPM × θ_g to wins with the margin model and is labelled approximate.
- A.1 depth chart: `depth.slotChart(o)` beside an unchanged `chart()`; the pos file is read from `club.pos`, else
  `fo.pos[team]`. The RECALCULATE strip is a local copy in fomodel.js/css with the page's words and stages.
- The team page's packs are "report go frontoffice" (go-page.test.mjs accepts it).

**WP6: integration**
- `run-ww.mjs --strict` (the guard step) fails a test that prints SKIP, since PGlite is installed there.
- ww-contract's game_features rule also allows the generated `_shared/features.js`, `_shared/analyticsfile.ts` (A.2's pending
  count and delta) and the ww tests, and reads code with comments stripped (winmodel.js names the table in a doc comment).
  Its "no whole stats" rule allows `*` only on tables with no stats blob (finalise-game's existing game_events, games and
  game_state reads; the page's leagues row).
- The end-to-end check (builder files through winfile.js into the page's views and the Front office) is part of
  ww-contract, on the real ORLEN files and the synthetic `--fixtures` files; `WW_LOCAL_DIR=<--local out dir>` adds every
  league of a local build.
- extract-shared: winstats, winsim and winmodel are no longer optional, and their export lists name every public function.

### B.2 Acceptance on real data (read-only, the publishable key)
Builder `--local`, 36 leagues' current seasons, 1,429 games (WP3), and again with the final code on four leagues (WP6):

| Unit | Games | R² full 4F | b efg / tovp / orebp / ftr | eFG share Shapley / \|b\|·sd | Home win | Forecast Brier (home / Elo) | Slope | Live |
|---|---|---|---|---|---|---|---|---|
| Pooled, 36 leagues | 1,429 | 0.943 | 1.154 / −1.130 / 0.401 / 0.093 | 63.3% / 47.6% | 0.568 | 0.211 (0.248 / 0.213) | 0.85 | yes |
| ORLEN | 275 | 0.934 | 1.136 / −1.010 / 0.395 / 0.071 | 73.4% / 48.9% | 0.607 | 0.227 (0.241 / 0.214) | 0.73 | no |
| cibacopa | 256 | 0.922 | 1.151 / −1.231 / 0.432 / 0.072 | 66.4% / 46.7% | 0.527 | 0.224 (0.251 / 0.214) | 1.13 | no |
| lnbp | 168 | 0.932 | 1.069 / −1.060 / 0.380 / 0.058 | 65.2% / 49.3% | 0.530 | 0.214 (0.257 / 0.216) | 1.28 | yes |
| CEBL | 108 | 0.901 | 1.282 / −1.351 / 0.441 / 0.181 | 72.6% / 47.1% | 0.596 | 0.245 (0.244 / 0.247) | 0.31 | no |

Spec targets met on the pooled unit: R² in [0.93, 0.95]; b near 1.157 / −1.130 / 0.398 / 0.094; |b|·sd eFG share in [40, 55];
home win in [0.55, 0.59]; Forecast Brier below home-only and within 0.002 of Elo; slope 0.85. The single leagues miss the
Forecast gate (ORLEN, cibacopa, CEBL) or the slope band (lnbp 1.28-1.37), so their chips say so; that is the gate working.

Simulator (rolling origin): cibacopa Brier 0.213, slope 0.89, pace −0.05, ortg +0.19, margin SD ratio 1.042, calibrated; lnbp
0.207, 1.14, −0.03, −0.04, 1.004, calibrated; ORLEN 0.215, 0.80, +0.01, −0.24, 1.064, experimental; CEBL 0.248, 0.31, +0.05,
+0.20, 1.142, experimental. Pace and ortg are within 0.5 everywhere.

RECALCULATE (`update()` on the store less its newest 10 games, then the 10): the store comes back byte for byte and every
point estimate equals the full build (worst difference 0), in 276 ms (CEBL), 382 ms (lnbp), 771 ms (cibacopa) and 925 ms
(ORLEN) in node. Real file sizes: wins 171-202 KB (pooled 287 KB), fo 49-67 KB, club 21-25 KB, pos 2.3-3.2 KB, teaser 1.7 KB.

Feature line: 481 games in 9 leagues replayed with no score or half mismatch; full-game four-factor OLS R² 0.919 with b 1.153,
−1.083, 0.401, 0.085; extraction on top of finalise-game 1.9 ms p50, 3.0 ms p95.

### B.3 What the owner has to do (runbook §17, as built)
1. Finish the events-splits move (`premium_sit_remaining()` = 0); check and redeploy the snapshots function.
2. `npx supabase db push` (0211_what_wins.sql).
3. `npx supabase functions deploy finalise-game`; `npx supabase functions deploy analytics-file --no-verify-jwt`; the function
   secret `ANALYTICS_SALT`. Optional: `ANALYTICS_REFRESH_BUDGET_MS` (default 20000), `ALLOWED_ORIGIN`.
4. Actions → backfill-features: the dry run (the default), then a real run, until `game_features_missing(1)` is empty.
5. Repository secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`; variables `ANALYTICS_MIN_GAP_H` (1) and
   `ANALYTICS_POOL_GAP_H` (6). Actions → analytics by hand once with `--dry-run`, then for real; read the job summary.
6. Decide `platform_settings.analytics_signin`.
7. Publish: the stamps are bumped (WP6). docs/data-protection.md has the boundary, the limits and the residual risk.

### B.4 Not verified before release
The Edge Function and the migration were not run against the real project (PGlite and node stand-ins only; no service key
here, and the rules forbid writes). The builder's real upload, index and delete paths ran only against a mocked PostgREST and
Storage. Neither workflow was triggered. The Edge CPU time of a 275-game RECALCULATE (about 1 s in node plus parsing a
1.6 MB store) has not been measured against the hosted limit. No live league has a calibrated simulator in the Front office's
browser path, so those paths are covered by unit tests only. Keyboard, screen-reader and forced-colours passes were not done
in a live browser.

### B.5 After the review (the fixer, 2026-10-01; overrides anything above it contradicts)
**Statistics**
- The simulator is validated OUT OF SAMPLE (`EpinoiaWinSim.calibrate`): the games in time order, the later 60% cut into
  three folds, each fold simulated with league parameters (hca, τ/lead, κN, σN, μoff, δtr, fouling) fitted only on the games
  played before its first game; Brier, slope, the checks, Platt and the gate are those held-out predictions', and the gate
  compares against the Forecast's and Elo's own Briers on the same held-out games. The parameters written for what comes
  next are fitted on every game; `report.inSample` (the same games scored by them) is shown apart and never gated. The
  WP6 table in B.2 was in sample: on held-out games cibacopa and lnbp are no longer calibrated. Cost about 1.7-2× the old
  calibration (lnbp 37 s, cibacopa 70 s in node).
- The pooled core4c `home` is the games-weighted mean of the leagues' alphas (variance w'Vw); `causes()` uses each game's
  own league's alpha.
- `score: true` also on every factor built from points or from the margin: the points-per-chance and points-per-possession
  measures (tr/hc/sc/offto_ppc, ppc_early/mid/late, ato_ppp, cl_ppp) and garbage_share (ww-features checks the rule: any
  factor reading a `pts` count or g_poss, TS% apart).
- `wins.homeMargin` {v, lo, hi, n}: the home side's mean margin at home venues, block bootstrap; the home card uses it.
- Front office: top_avg is valued by its direct path effect only (`model: 'path:direct'`).
- The CR1 and block-bootstrap SEs are compared per coefficient (`model.seCheck`); over 30% apart is a job-summary warning.
- Carried intervals record their column names (`carry.ci[key].cols`); an update whose columns moved shows none.
- A spread below 1e-6 of the values' size is 0 (`sdReal`): min_share (constant under slot minutes) leaves P2 and the slots,
  pos_entropy leaves the squad fit where it is constant, and their z is 0 / null.
- A.1's slot ranking breaks a tie between two estimates clamped to 1.0 or 5.0 by the unclamped estimate
  (`EpinoiaBPM.estimatePosition(…, {raw: true})`).
**Security**
- RECALCULATE reads `players.is_minor/public_consent` for every player of the store and the delta and passes the withheld
  list to `update(…, {withheld})`; every file is `validate`d before upload (a problem: `{queued, refresh_reason: 'validate'}`).
- The signed-out subject hashes the platform-set address only (no user agent); see data-protection.md for the deploy check.
- No Actions cache of the stores; `.cache/` is git-ignored.
- Members' files: uploaded `no-store` / `max-age=0` and fetched with `cache: 'no-store'`; a sign-out mid-download drops the
  answer (a cache generation); every request waits for `sessionReady()`.
**Performance**
- RECALCULATE refuses (queued, 'size') a unit over 250 games or a 1.6 MB store before downloading it (PERF2-4: update alone is
  about 1.1 s wall and 1.7 s CPU cold at 275 real games, against the Edge 2 s CPU limit), and holds `due` as its lease while it
  runs, so an isolate killed mid-update leaves the unit flagged for the scheduled build (which waits out a live lease); pages its player-line
  and stint reads past PostgREST's 1000 rows; reads `st` only for games whose stints are missing or short (`stintGaps`; the
  builder too); uploads wins, fo and the changed clubs' files only, six at a time, after a budget check that counts them.
- The builder decodes a store once per unit for the club checks, and reads a unit's context once a run.
- fo for hundreds of clubs: a last trimming step writes each club's simulator profile as arrays in RATES order (EpinoiaWinSim
  reads either), and the fo budget allows 60 KB + 450 B a club (350 clubs: written, about 207 KB).
- The team page loads the win model's code and sheets only when the Front office opens; the fo and club files are asked for
  at once. The What wins page draws two sections at once and the rest as they near the viewport or in idle time.
- finalise-game reads the competition chain once, beside the stats inserts, and notify() reuses it.
**The page and the chart kit**
- The tooltip and focus ring are attached; the meter never overlaps long names; the reliability chart has a key; rotated
  heatmap labels stay inside the frame; the leagues heatmap is a neutral more/less pair (`mode: 'rel'`); a style measure has
  its own hue; the dumbbell's bottom quarter is hollow; the share bar shows shares of the whole margin with the unexplained
  rest; labels are translated before they are cut or split; the time-of-possession forest is one panel a measure on its own
  unit; the luck note is "shot-making against shot quality"; a simulation redraws only its result (focus kept; any redraw
  restores the focused control); RECALCULATE answers that updated nothing stop the bar and hold the button for the retry time.
- Tests: ww-contract no longer requires the What wins migration to be the newest, nor exactly three locks; guard.yml runs
  on the builder, the backfill scripts and their workflows; ww-features asserts its wall-clock budgets only with WW_PERF=1.


---

## A.3 Depth upgrade (Oct 2026)
User requirement ("more depth across the board"), 2026-10-01; overrides anything above it contradicts. Six asks: the four
factors by free-throw ATTEMPT rate; "Where the line is" with every measure defined and a gap the reader moves; positions
with the players' own rates against winning; a lineup builder over every five; a composite ball handler; more roles in
the squad shape. Built under one extra rule from the owner: no new per-pageview database read, no new full-table read in
the builder, nothing more for the Edge Function per request, the new lineup data loaded only when its section is near.

### A.3.1 The four factors use FT attempt rate (FTA / FGA)
- `features.js` gains `c_ftr = 100 c_fta / c_fga` (FACTORS only: the counts were in the line already, so FV stays 1).
  `core4c = [c_efg, c_tovp, c_orebp, c_ftr]`; the full-game twin `[efg, tovp, orebp, ftr]` (= CHECK4, the §16 acceptance
  model, which already used FTA / FGA). `ftmr` / `c_ftmr` (FTM / FGA) stay as measures, out of every model; FT% (`ftp`) is
  its own measure and now a Front office lever (LEVERS: `ftr` out, `ftp` in, valued by the shot model).
- KEYMAP `ff_ftr` / `dff_ftr` → `c_ftr`: t/depth.js's ff_ftr IS FTA / FGA (season.js `pct(A.fta, A.fga)`), so the old
  mapping to c_ftmr valued the GM's measure with another quantity. The Front office's FT dial is valued by `c_ftr`, and
  `SIM_KEY.c_ftr = 'ftr'` lets a c_ftr need use the simulator's ftr edit (which was always FTA / FGA).
- The Forecast's column is `e_c_ftr`; the extended model's free-throw group `[c_ftr, trips100]`; Oliver's 15 is shown
  against c_ftr. The causes part is `ftr` (club files `parts.ftr`; files built before A.3 say `ftmr` and the page and the
  Front office read either, so no FILE_V bump: a FILE_V bump would send every signed-out reader to the box-score
  fallback until the next build).
- Labels say it: "FT attempt rate (FTA/FGA)", "FT attempt rate (FTA/FGA, competitive)", "FT made rate (FTM/FGA)",
  "Clutch FT attempt rate (FTA/FGA)"; #method says the FT factor is getting to the line and FT% is apart.
- `synthUnit` plants the attempt rate (β c_ftr 0.3) with FT% drawn on its own; ww-winmodel recovers it within 3 SE.
- **Real data** (builder `--local`, ORLEN 2025-26 + CEBL 2026, 402 games, read-only, 2026-10-01):

| Unit | core4c R² before → after | FT coefficient before (c_ftmr) → after (c_ftr) | FT Shapley share | pts per team-SD (FT) | full-game R² (FULL4) |
|---|---|---|---|---|---|
| Pooled (2 leagues) | 0.934 → 0.917 | 0.178 (0.155–0.198) → 0.080 (0.058–0.098) | 1.5% → 0.4% | 0.76 → 0.45 | 0.942 → 0.920 |
| ORLEN (275) | 0.942 → 0.926 | 0.162 (0.134–0.190) → 0.069 (0.050–0.089) | 2.3% → 0.7% | 0.77 → 0.46 | 0.953 → 0.934 |
| CEBL (127) | 0.940 → 0.916 | 0.264 (0.226–0.302) → 0.120 (0.090–0.149) | 2.0% → 1.5% | 0.93 → 0.47 | 0.939 → 0.904 |

  The other three coefficients barely move (pooled eFG 1.077 → 1.077, TOV −1.058 → −1.037, OREB 0.378 → 0.365). The R²
  falls by about 0.02 because whether the free throws go in now sits in the residual (and in the parts' `other`): FTM /
  FGA is FTA / FGA × FT%. **Acceptance**: the §16 targets were set on the FTA version (CHECK4) and do not change; the
  core4c R² with the attempt rate is expected about 0.015-0.025 below the made-rate version, so read B.2's "R² full 4F" as
  the FTA model's. σ_acc grows accordingly (pooled 3.59 → 4.03).

### A.3.2 The store's sidecars and the reads (STORE_V 2)
- Player lines gain a byte sidecar `pgs.x` (m × 6): rimA, rimM, midA, midM (the engine's zones, four more named keys of
  the same player_game_stats rows; unknown on a side without the ZONES bit) and unFgm, unPts (each scorer's unassisted
  makes, from the feature row). Stints gain `stints.box` (s × 16): the five's and its opponents' fga, fgm, f3m, fta, pts,
  tov, or, dr (lineup_stints' off and def, which the builder already read whole, for the possessions). 255 = unknown.
  ORLEN's store: 1.66 → 1.93 MB.
- `extract()` writes `st.u = {player id: [unassisted FGM, unassisted FG points, assisted FGM]}` (situations.js's own
  pairing, the one fgm_ast / fgm_unast count). The builder and RECALCULATE read only that part: `u:st->u` beside f and q
  (a few dozen bytes a row), never st whole. Rows written before A.3 have no u: their players' unassisted shares are
  unknown (and the ball-handler score drops that part, below) until `backfill-features --force` rewrites them.
- A v1 store still decodes (the sidecars unknown). The builder rebuilds a store of another STORE_V from nothing on its
  next due build (the same reads as the weekly full run, once). `update()` answers `{stale: true}` for an older store and
  analytics-file then queues the unit (`refresh_reason: 'layout'`) rather than fold games into a layout it would never fill.

### A.3.3 The players' season rates (winmodel `rates()`, PLAYER_STATS)
Ratios of season sums over the games he played (context as AST% / BLK% / USG% already were, §7.12): ts, efg, AST%,
USG%, ORB% = 100 or × (game minutes ÷ his minutes) ÷ (team OR + opponents' DR), DRB% the same way round, STL% = 100 stl
× (…) ÷ opponents' possessions, TOV% = 100 to ÷ (fga + 0.44 fta + to), 3PA rate, 3P%, rim rate and mid rate (÷ the FGA of
games with zones), FT attempt rate (fta ÷ fga), unassisted share `una` = unFgm ÷ fgm (games where known), unassisted
points share `ups` = 100 unPts × (game minutes ÷ his minutes) ÷ the team's unassisted FG points (usage's construction:
20 is an even fifth), A/U = AST% ÷ USG% (the site's assist-to-usage, season.js `au`).

### A.3.4 Roles (replaces §7.15; §7.13 and the squad features use them)
Every cut is a percentile within the league-season over its regulars (200 minutes or more); a player is placed against
them by the empirical CDF; a tag needs 100 minutes (protector 60, as before; big none). In the pooled unit each league is
cut on its own.
- **shooter** (unchanged): 3PA ≥ 40, 3PA rate ≥ P60, shrunk 3P% ≥ P50.
- **handler = ball handler**: 0.45 pct(AST%) + 0.30 pct(UPS) + 0.25 pct(USG%) ≥ 0.70, weights renormalised over the
  parts a player has (UPS needs st.u on half the regulars). AST% weighs most: it is the handler-specific part; usage and
  UPS are both scoring load. The cut was set on real data so about a quarter of 100-minute players qualify (ORLEN: 49 of
  201; at 0.65 it was 62, a third, and four "handlers" a rotation).
- **passer**: A/U ≥ P75 and AST% ≥ P50 (pass-first, not a low-usage player with two assists).
- **slasher (rim pressure)**: ½ (pct(rim rate) + pct(FT attempt rate)) ≥ 0.75 on 40 FGA; without shot locations (zones on
  under half the games) pct(FT attempt rate) ≥ 0.80 alone, and the file says so (`cuts.slasher.zones`).
- **crasher** ORB% ≥ P75; **glass** DRB% ≥ P75; **protector** (unchanged); **disruptor** (turnover generator) STL% ≥ P75;
  **big** group C; **creator** USG% ≥ P80 (200 min).
- `roles()` returns the Map with `.cuts` (the values as they fall); `wins.roles.cuts` and `fo.roles.cuts` carry them so
  the page can say how a tag is earned HERE.

### A.3.5 Roles and winning (`wins.roles`; squad features)
SQUAD_KEYS gain passers, slashers, crashers, glass, disruptors (counts in the rotation, ≥ 10 mpg). `roleAnalysis` per
role: (1) club seasons — the share of the club's minutes its tagged players played against shrunk net per 100, centred
within each league-season: r with a Fisher interval (n less the leagues' means) and the slope, net per 100 for ten points
more of the minutes, club-season bootstrap (B = 1000); (2) lineups — net per 100 for each tagged player more on the floor,
the five's mean BPM held, within team-game (as §7.13), game bootstrap (B = 200), and the possessions with 0 / 1 / 2+.
Evidence strong / some / none as the squad model, one false-discovery set across both parts; power 'low' under 30 club
seasons. ORLEN (16 club seasons, all 'low'): a ball handler more on the floor +3.0 net per 100 (0.4 to 6.9, some), a
passer +3.5 (0.5 to 6.5, some), a turnover generator +5.0 (1.6 to 8.6, some), a defensive rebounder −4.4 (−8.5 to −0.6,
some); no club-season association is told from noise.

### A.3.6 By position, in depth (`wins.positions.stats`)
For each club season (8 games) and each group — G / F / C by the A.1 slot shares and each of the five slots by its
minutes — the minutes-weighted mean of every player's season rate (POS_STATS: AST%, USG%, TS%, eFG%, 3PA rate, 3P%, rim
rate, mid rate, FT attempt rate, unassisted share, UPS, ORB%, DRB%, TOV%, STL%, BLK%; a group's value needs 60% of its
minutes rated). Across club seasons: median, P25-P75 and SD; r with net per 100 and r with the share of games won, each
with a Fisher interval, centred within league-season; `b` = net per 100 for one club-season SD more (r × SD of net) with
the same interval; ★ after BH. ORLEN's strongest: wings' TOV% r −0.69 (−0.88 to −0.29), slot 2's DRB% +0.63 (0.19 to 0.86),
slot 2's usage +0.61, slot 3's ORB% +0.59 (16 club seasons each: flagged as few).

### A.3.7 The lineup mixes file (scope `mix`) and the builder
- `mixFile(X)`: every (club, five) with its stints summed — seconds and both ends' box — in columns
  (`rows: {t, p (5 a five), s, o (8), d (8)}`), and an anonymous player index (`players: {t, min, tag (role bits), v
  (MIX_STATS)}`: AST%, USG%, UPS, A/U, TS%, 3PA rate, 3P%, rim rate, FT attempt rate, unassisted share, ORB%, DRB%, STL%,
  BLK%, TOV%), the league's P25 / P50 / P75 / P90 of each over its regulars (`pct`, the builder's defaults and presets),
  the role cuts, `minRate` 100. No player id or name; a withheld player (I6) is index −1. Integers and rounded rates, never
  packed. Budget 360,000 raw bytes; over it the fives with the fewest possessions go first and `trim` = {minPoss, fives,
  poss share}, said on the page. ORLEN: 4,170 fives from 10,204 stints, 261 KB raw, **62 KB gzipped**; CEBL 164 KB raw.
- Gating: migration `0213_analytics_mix.sql` adds 'mix' to analytics_files' scope CHECK and to `analytics_check` (a
  league-season's file, checked as fo: a league required, no team). analytics-file serves it like any file (FILE_SCOPES);
  RECALCULATE writes it with the rest. The builder and the function index the mix row in an upsert of its own: before
  0213 is applied the CHECK refuses it, the unit's other rows stand and the new mix upload is removed.
- `winfile.js` accepts scope 'mix' (same cache rules).
- Builder reads: no new table; player_game_stats gains four named keys, game_features `u:st->u`. Build time is the
  simulator's as before (ORLEN 97 s at B = 100 before, 94-97 s after); the non-simulator part grew by the roles' and
  positions' bootstraps (ORLEN, B = 400: squad step 0.2 s). `update()` on real data: ORLEN 1.0 → 1.5 s (refused at the
  function anyway, over 250 games), CEBL 0.28 → 0.49 s; worst point-estimate difference against a full build 0 (wins, fo,
  club, mix).

### A.3.8 The page
- **Where the line is**: under the picker the measure's definition (FACTORS `def`), how to read it (which end is better,
  or a style, or part of the score; the gap is this side less the other, in its unit), and a glossary of every measure
  the picker lists. **Move the gap**: a range input and a number over the fitted curve's own x range (≈ 200 nice steps,
  starting at the x75 break-even or 0), the curve's mark (vizkit binnedCurve `d.mark`) and an aria-live readout move live
  without drawing the section again: the fitted chance with its 95% band, the curve with the other factors held level
  where the file has it, and how often a gap that big happened. Keyboard: the native range (arrows, Page keys).
- **By position**: "Each group's own numbers against winning": a heatmap of r (groups × statistics, G/F/C or the five
  slots, against net rating or the share of games won), the chosen group's forest (net per 100 for one SD more, sorted),
  the table (typical, middle half, SD, r with both, club seasons) and the statistics' definitions; few club seasons said.
- **Building a squad**: the grid's heading is "Shooters and bigs on the floor"; new "Roles in the rotation": the lineup
  forest (each role on the floor), the club-season forest (each role's share of the minutes), and "How a player earns each
  tag here" (rule, the cut values in this league-season, players tagged).
- **Lineup mixes** (a 13th section, after Building a squad; `#mixes`): presets (two ball handlers, three shooters, two
  passers, no big, a protector and three shooters, two rim attackers, AST% / ORB% above the top quarter), a club picker,
  one or two conditions (AND), each "at least / exactly / at most n players who are <role> | whose <stat> is above / below
  x". The result: fives, minutes, possessions and their share of what is in view; net, offensive and defensive rating and
  the four factors at both ends for these fives, the rest and the difference, each with a 95% cluster-robust interval
  (each five a cluster; winmix.js says how); the difference forest; net rating by how many of the five meet the first
  condition (the dose). Under 200 possessions flagged; the share of possessions with a player no rule could judge (under
  100 minutes, or withheld) said; the opposing five is not controlled for.
- The mix file is asked for only when #mixes comes within 200 px (IntersectionObserver, as #sim's fo file) or its button
  is pressed; nothing else is read. `epinoia/winmix.js` decodes once (typed arrays, 10 ms at ORLEN) and filters in one
  pass with every group's five sums a ratio (0.7 ms median, 1.6 ms worst in node at ORLEN, against a 50 ms phone budget);
  a typed threshold waits 250 ms.

### A.3.9 The Front office
SQUAD_LABEL names the new rotation counts (its squad table lists every squad feature the file has); a new "Roles in the
squad" table names the club's players by role (names on the page only) with how each is earned; the ball handler is the
composite wherever handlers appear (the lineup grid's reference five, the squad shape). The core four and needs read
c_ftr; FT% is a lever.

### A.3.10 Tests
ww-winmodel (FTA mapping and the planted c_ftr; store v2 and v1 compatibility; update stale; the role rules incl. the
ball-handler composite and the no-zones fallback; roles and winning; positions in depth; the mix file's sums, budget
and trim; update = full incl. mix), ww-winmix (new: a filter equals hand sums on a small file; the cluster-robust
interval; minRate, unknown and withheld players; the real fixture's partition and timing; under 100 KB gzipped, no
ids), ww-page (13 sections; definitions and the gap control; gapAt / gapRange; the new sections' translations; no read
but the files, the mix file only near its section), ww-contract (the mix file through winfile.js into #mixes), ww-build
(u:st->u, s2 store, the mix file uploaded and indexed), ww-function (stale → queued 'layout'; the mix row apart, and a
refused one costing nothing else), ww-gate (0213: the CHECK and analytics_check for mix). Fixtures: `fixtures/ww` from
`--fixtures` (now with mix.sample.json); `fixtures/ww-page` and `ww-fo` from `--local --page-fixtures supabase/tests/fixtures
--club Zastal --leagues orlen-basket-liga,cebl` (new flag; replaces the hand cut).

### A.3.11 Runbook (owner)
1. `npx supabase db push` (0213_analytics_mix.sql). Until then the page's #mixes says the file is built with the next run.
2. `npx supabase functions deploy analytics-file --no-verify-jwt` (scope mix; the u read; the stale queue) and
   `npx supabase functions deploy finalise-game` (st.u on every new line).
3. Optional, for the unassisted shares of past games: Actions → backfill-features with `force` (about 250 MB once).
4. The next scheduled builds rebuild each due unit's store once (STORE_V 2) and publish the mix files.

## A.4 Positions against the league, ball handlers, creation and the match reports (Oct 2026)

Asked for by Louie on 7 October 2026: every per-position statistic against the league's average and what it is worth in
wins; self-created scoring, shot volume and balance, and the passes that make threes; ball handlers beside shooters and
bigs; the efficiency of a club's creation; the Front office reading a club by its positions, not the four factors alone;
the match reports explaining a result by what wins in its league.

### A.4.1 The feature row and the store (STORE_V 3)
`features.js` st.u is now `{player: [unassisted FGM, unassisted FG points, assisted FGM, threes he assisted, twos he
assisted]}`, the passers included (paired as situations.js assistedShots pairs them). The store's player sidecar carries
`a3, a2` (PGX_COLS, 8 bytes; a v2 store decodes with them unknown and is rebuilt). Rows written before the change have
three numbers and the a3s rate is null for those games (a `force` backfill fills them).

### A.4.2 New player rates (PLAYER_STATS, POS_STATS)
`un_pg` unassisted makes a game, `unp_pg` self-created points a game, `upp` the unassisted share of his own FG points,
`rim40` rim attempts per 40 (minutes with zones), `p3a40`, `fga40`, `ast40`, `a3s` the share of his assists that made a
three (5 or more assists of known kind).

### A.4.3 By position against the league (`wins.positions.stats`)
Each cell adds `avg` (the league's mean), `top` / `bot` (the top and bottom quarter of club seasons by net), `dTop` (the
winners' +/-) and `w30` (with `w30lo`, `w30hi`): wins over 30 games for one club-season SD more, 30 (Φ(b pace / 100 /
σ_pred) − ½). `levers[g]`: each position's differentiator, the stat whose SD moves wins most there (★ first).
The club file's `posv` is the club's line at G / F / C on every POS_STATS stat as [value, z, wins over 30 the gap goes
with]; the fo file's `posLg` the league's [mean, SD, winners', wins for one SD, ★].

### A.4.4 The ball handler, and the handlers grid
Handler = 0.35 pct(AST%) + 0.25 pct(USG%) + 0.40 pct(UPP) ≥ 0.70 (renormalised without UPP). `wins.lineup.gridH`: the
lineup model's expectation for 0 / 1 / 2+ handlers with 0..5 shooters (one big, one protector) against the reference
five, with the possessions played so.

### A.4.5 Creation and how well it works (`wins.creation`, club `creation`, fo `creation`)
The creators are the players tagged handler or creator. Per club season: their share of the club's plays (FGA + 0.44 FTA
+ TOV), their TS% and points a play (points / plays), and the handlers' alone (`hand_ts`, `hand_ppp`); 50 plays or more.
Each with the league's mean, SD, winners' and strugglers' lines, r with net (within league) and w30.

### A.4.6 The Front office
`fomodel.js posGaps(fo, club)`: the club's positional gaps worth 0.2 wins or more on stats that count there (★ or 0.5 wins
for one SD), the costliest first with the player who would close each (POS_NEED); `creation`: short of creation when two of
the guards' self-created points, self-created share and AST% sit half an SD under the league or the rotation holds fewer
handlers than the winners' band; inefficient when the creators' points a play (or TS%) sits half an SD under while they
carry at least the league's share of the plays. Drawn in By position (the club against the league), in What the club
needs (creation first, then the positional needs) and in the GM's view (depth.js gm o.model.pos: the two biggest
positional weaknesses and strengths, efficient or inefficient creation, the needs ranked again by wins).

### A.4.7 The match reports
`winmodel.js explainOf(wins)`: the current season's core4c b (points of margin for one percentage point of difference),
the home term and n, published by the builder at `snapshots/whatwins-explain/<league>.json` (public: four numbers a
league, no club's). The game page (game.js ensureWinModel) and finalise-game read it onto the brief (`g.model`); story.js
then weighs the four factors by b × (side − baseline), in place of the fixed weights, and report.js says it is the
league's own model and on how many games. Without the file, as before.

### A.4.8 Runbook (owner)
1. `npx supabase functions deploy finalise-game` (the new st.u, and the report's weights) and
   `npx supabase functions deploy analytics-file` (the shared winmodel copy).
2. The next build rebuilds each store once (STORE_V 3) and publishes the weights files.
3. Optional, for the assisted threes of past games: Actions → backfill-features with `force`.

### A.4.9 Data (as little read as can be)
No new database reads on the pages: By position, creation and posGaps come in the files the pages already fetch (the
club file's posv + creation add about 1-2 KB; the club budget's trim drops positional gaps under 0.1 wins first); the match
report's weights are one public file of a few hundred bytes a league, cached an hour, fetched only when the report tab is
opened; the finalise function reads it from storage, no database. The club report ranks every club's half-court AST% only
when its players' cards already read the competition's play-by-play (else the club's own value, unranked), never for a
single game's analysis; the player page's clutch section waits for the reader to come near it before fetching the replay
engine, and reads no logs of its own (the club logs "on the floor with" reads).
