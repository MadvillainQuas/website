# EPINOIA Manager (individual mode, built 2026-10-09; live play 2026-10-14)

A Football Manager-style game on EPINOIA. The reader takes a club into a real league: they name it and its manager,
draw or upload a badge, choose the country and league, and draft a squad of real players within a budget. Then they set
lineups, team instructions and each player's instructions, and play the league's real clubs on the real calendar, every
club three times: live (managing the game as it happens, full screen) or straight to the result, any time on the match
day. Real form moves the players during the season (the fantasy element).

**Modes.** Individual mode is built. Friends mode (shared leagues, a creator who starts the league, join requests) is
next. Global mode was scrapped (Louie, 2026-10-09).

## Where it lives
| Part | Files |
|---|---|
| The way in | HOME's third strip tab, MANAGER (`home/index.html`, `kit/home.css` `.mg-warp`, `home/vhmode.js` `toManager`): a royal-blue wipe, then `manager/` |
| The page | `manager/index.html`, `boot.js`, `app.js` (router, rail, shared builders, catch-up, saving, the game in hand), `manager.css` (the royal blue, soft-glass skin; dark navy and light sky-blue) |
| The screens | `manager/views/`: `onboard.js` (login, black transition, team name, manager name, badge, country and league, mode); `squad.js` (draft pool, filters, shortlist, hover cards, 1–20 attributes, confirm); `tactics.js` (the court, drag and drop, up to 4 lineups, minutes to 40, the team's instructions in a pop-up at the top, a player's on a press); `ui.js` (the two pop-ups the tactics and the live game share); `match.js` (match day, the live game full screen, a game played again); `season.js` (home with the match-day panel, fixtures, table, statistics); `pages.js` (player pages with Real season / Manager season tabs, each with Scouting and Simple views; team pages); `trade.js`; `game.js`; `boards.js` (leaderboards, club settings) |
| The game itself | `manager/core/` (UMD, no DOM, no site: `root.Mgr.*`): `value.js`, `ratings.js`, `schedule.js`, `names.js`, `badge.js`, `cards.js`, `engine.js`, `instruct.js` (player instructions, roles, fit), `match.js` (the possession engine), `season.js`, `scorer.js` |
| The site, from the game | `manager/adapters/epinoia.js` (`Mgr.site`): the **only** file that knows EPINOIA. It provides the leagues, the season files, the values and boosts, form windows, each real club's starting fives (`starts`), the clubs (`manager_*` RPCs) and badges. Swap it and the game runs elsewhere. |
| EPINOIA GO | `go/leaderboards/` `#manager` and a teaser on GO's home (`leaderboards/managerboard.js`, `kit/mgboard.css`): the promise, the realism marks, your clubs, and the boards (global and league by league) |
| The platform console | the Manager tab (`admin/platform/manager-ui.js`): each league's value range and continental boost |
| The marks | `tools/manager-validate.mjs` writes `manager/validation.json` |
| The database | `supabase/migrations/0259_manager.sql` |
| Tests | `supabase/tests/manager-core.test.mjs` (117), `manager-db.test.mjs` (35, PGlite: `PGLITE_DIR=<…>/node_modules/@electric-sql/pglite`); both in guard.yml |
| Languages | the `manager` pack (`i18n/ja/manager.js`, `i18n/es/manager.js`) exists but is empty: the Manager is English only for now |

## Everything is played in the reader's browser
Louie's instruction: only the reader's chosen league is simulated, and only on their device. Rounds fall on Wednesday
and Saturday (two a week) or Saturday only (one a week). Before each round the form windows from `player_game_stats`
are read, so real form moves the players. The database keeps only what has to outlive a visit:

- the club, its squad (with each man's instructions on his roster entry: `u` touches −2..2, `ins` keys, `role`) and
  lineups;
- the season's compact state: fixtures and results, every player's line in `season.LINE` order, club totals with the
  opponents' side, the reader's own games' boxes with plus-minus, and their play-by-play (about 4 KB a game, base 36);
  and the game in hand (`S.live`, below);
- the summary the boards rank.

A **scouting network** widens the draft and trade pool. The reader adds leagues to it, and their players can be signed,
but only the chosen league is simulated.

## Match day (Louie, 2026-10-14: "can the user choose to play the game anytime on that day")
- A match day is the reader's own day, midnight to midnight in their browser (`season.dayStart` / `dayEnd`).
  `season.matchday(S, now, me)` is their unplayed game whose day is under way.
- On that day HOME's match-day panel (`views/match.js` `A.livePanel`) and `#/match` offer **Play it live** or
  **Straight to the result**. Either one plays the round's other games at that moment
  (`app.js` `A.startMatch(mode)`); their results stay hidden (`A.view()`) until the reader's own game ends.
- **The game in hand** is `S.live = {r, started, mode, plan: {h, a}, form, snap}`. Each side's plan (its rotation and
  tactics) and the form are kept as they were at tip-off. `snap` is `match.snapshot`. It is kept in the browser
  (`mgr_live_<club>`) every couple of seconds and in the database at the breaks, on a pause and on leaving; the newer
  of the two is taken up again (`A.liveSnap`). The game moves only while the match screen is open.
- **Nobody choosing:** `catchUp` plays a round once its day is over (`season.due`), and a round without the reader's
  club once its day has begun. A game in hand whose day is over is played out by the assistant (`finishLive`). If it
  cannot be taken up again, it is let go and played from the start, never left unplayed.
- A season is redrawn (a club of the real league added or dropped) only before its first match day begins, and keeps
  its own start date (`season.redrawable`; the cause of the "skipped Saturday" on 2026-10-14).
- **The schedule** alternates every pairing's home and away by round (`schedule.roundRobin`). The old rule
  (round + place) kept a club at one end all along its side of the circle: 16 away games in a row in a 17-club league.
  The tests cap runs at four.

## The engine (core/cards.js, core/engine.js, core/match.js)
- **Players become cards.** Each card holds league-relative deltas, shrunk toward positional priors by minutes. Where the
  individual stats have gaps, on/off figures weigh in lightly, and less at low minutes. The card is also adjusted for the
  opposition faced, for the league's strength, and for current form.
- **Fives become winsim profiles** (`engine.sideOf`). The usage sim adds the plays up to 100%, on the skill curve. Taking
  more shots from a zone costs efficiency, less for players used to creating unassisted. Spacing, added up over the
  five, decides how packed the paint is. Passing synergy, out-of-position play, fatigue, the team's instructions and each
  man's instructions all apply. **Instructions change what a man tries; his own numbers decide how it goes** (FM's
  rule). For example, green light is +0.84 points per 100 possessions for a good shooter and −0.46 for a poor one; push
  in transition is +1.30 for a runner and −0.78 for a walker.
- **The team's instructions** (`E.TACTICS`, FM's three phases):
  - *In possession:* guard, wing and big play; **Ball handlers: Get downhill ↔ Punish from deep** (one slider, for the
    ball handlers only); off-ball cutting ↔ space the floor; hit the big ↔ hit the shooters.
  - *In transition:* leak out; attack the offensive boards.
  - *Out of possession:* funnel to rim protection ↔ no paint touches; gamble for steals.
- **Each player's instructions** (`core/instruct.js`), by role:
  - Guards: be more passive / aggressive, push in transition / slow it down, punish behind the arc / put pressure
    downhill, kick-outs, dump-offs, gamble for steals / stay solid.
  - Wings: handle the ball more / less, only spot-ups and cuts, push, cut more / space more, green light / rip through,
    crash the glass, gamble / stay solid, more aggressive rim protection.
  - Bigs: handle more / less, finisher only, roller big (short roll / dive) / pick and pop, post more / less / don't post
    up, hedge / contain / drop, defend the rim aggressively / be foul-conservative.
  - Touches run −2..2. Role presets (floor general, 3-and-D wing, rim runner …) carry suitability stars, and every
    instruction shows the player's fit for it (Natural, Good, Workable, Poor), with the stat it rests on.
- **Every game is played possession by possession** (`core/match.js`, also for the games nobody watches) by the ten men
  on the floor: the winsim matchup of the two fives, then each man's own turnovers, trips, shot mix and makes; the
  assist, the board, the steal and the block by the right men.
  - FM's additions: each man's condition (energy falls on the floor, faster with more of the ball, and returns on the
    bench and at the breaks); fouls (five and out); the assistant's substitutions at dead balls (the plan's rotation,
    changed for fouls, legs and a decided game); timeouts.
  - Every change is logged at the possession it took effect, and the same seed plays the same game.
- **The whistle.** A dead-ball turnover is an offensive foul 20% of the time. The fouls without free throws are the
  league's own fouls a team-game (`ref.five.pf40`), less what the trips, and-ones, offensive fouls and late fouling
  give. A man one or two fouls from the limit draws 0.6 or 0.85 of his share.
  - Checked against real 2025-26 seasons, fouls per team-game: 20.7 (real 21.5) ORLEN, 21.3 (21.6) FEB, 16.8 (17.0)
    NBL D1.
  - Foul-outs per team-game: 0.46 (0.45), 0.47 (0.39), 0.26 (0.28).
- **Real clubs play their real style and rotation.** `engine.identityOf` edits style first (three-point rate, rim and
  mid-range share, transition and pace, relative to the league's own), then the four factors. Each club opens with its
  real starters (`adapters/epinoia.js` `starts`, recent games counting most), but only among its eight most-used men:
  a late signing or a man who lost his place is not made to start. Without that guard, CEBL's summer roster churn
  wrecked its players-only mark (0.26).
- **The play-by-play's clock.** Fast breaks shoot 2–6 s in, put-backs 2–5 s after the board, set plays late. The
  transition and shot-clock tabs of the box score read it.

## The live game (views/match.js, `#/match`)
FM's match screen, full screen (the rail and tab bar hidden):
- **Along the top:** the scoreboard (score, period and clock with tenths in the last minute, timeouts, team fouls), the
  speed (pause, 1× real time to 16×), and leave (the game is kept).
- **Down the left:** your five, each man with his energy, fouls, line and match rating (Game Score on a 1–10 scale).
  Under it, the bench.
  - Press a man for his instructions (for this game, from the next possession) and his substitution (at the next dead
    ball); dragging a bench man onto a man also works.
- **In the middle:** the court, with the ten men in their places, the ball, and every shot's result (or the shot
  chart). Under it the commentary and the margin's path.
- **Down the right:** Match (the clubs compared: shooting, boards, paint, fast break, second chance, off turnovers,
  biggest lead), Box score, Plays, Assistant (his notes on legs, foul trouble, runs, hot hands, the glass, plus the
  assistant-subs switch), Opposition.
- **Along the foot:** team instructions (for every lineup, the rest of the game), player instructions, timeout,
  assistant subs on/off, the rest of the game now.

The engine is never more than one possession ahead of the clock on screen. So a period's end and the reader's own
timeout (`match.js` halts before the next possession) show before the next possession is played, and a change made
then counts in it. Quarter breaks pause briefly; half-time and the reader's timeouts wait for them. At full time the
game goes into the season (`A.endLive`).

`#/live/<round>` plays a game already played again, on the same screen, from its kept play-by-play.

## The economy (core/value.js)
1. A player's index weighs points most, values minutes, and weights bigs (and athletic, shot-blocking bigs most).
2. The index becomes a percentile p in the league.
3. The value is `min + (max − min) · p³`, inside the league's range. The best go up to 12% over the range and the
   fringe up to 12% under.
4. A club linked (in Links) to a side in a boosted league adds that league's boost.

Wages are 16% of value, and the squad budget is 12 × the league's average wage. A trade may bring in any value as long
as the wages stay within budget. Leagues without a range take the middle league's range (`medianRange`).

## Box scores
A game's box score is EPINOIA's own game page drawing it.
- `core/scorer.js` turns the play-by-play into the scorer's event log: shots placed in their zones, assists, blocks,
  fouls (offensive among them) and free throws, turnovers and steals, boards, substitutions, timeouts.
- The log is handed over in `sessionStorage` (`mgr_game`) to `game/?mgr=1` and embedded with `&embed=1` (no rail).
- Every tab works: the traditional and modern box, the play-by-play with linked plays and faces, shot charts, lineups,
  full stats, game flow, connections, play types and the shot clock.

A Manager game has no match report, no league table and no PDFs. The core tests replay the converted log through
`epinoia/engine.js` back to the Manager's own box, player by player, fouls included.

## The realism marks (tools/manager-validate.mjs → manager/validation.json, shown on GO)
Four complete seasons were replayed with the possession engine, every club against every other, home and away, six
times (6,384 games). Each club was built the way the Manager builds it, with its real starters.

| League | r (identity) | r (players alone) | Points a game, sim (real) | Home wins, sim (real) |
|---|---|---|---|---|
| ORLEN Basket Liga 2025-26 | 0.95 | 0.73 | 85.5 (85.5) | 62% (60%) |
| Primera FEB 2025-26 | 0.99 | 0.93 | 82.7 (80.9) | 60% (61%) |
| NBL Division One 2025-26 | 0.98 | 0.80 | 75.2 (75.9) | 59% (58%) |
| CEBL 2026 | 0.85 | 0.69 | 93.9 (92.7) | 62% (61%) |

"r" is the correlation of each club's simulated margin with its real point difference. Run the tool again
(`node tools/manager-validate.mjs`) whenever the engine changes, and commit the file.
- `--dry` prints the diagnostics against the real season: possessions, eFG%, turnovers, free-throw rate, the glass,
  free throws, fouls and foul-outs.
- `--engine stretch` uses the older engine; `--no-starters` and `--decay` vary the real starters.

## The database (0259)
- `manager_teams`: owner-only RLS. Written only through `manager_create`, `manager_save` (sizes checked) and
  `manager_delete`.
- `manager_league_values`: public read, written by `manager_set_values` (platform administrators only).
- `manager_boosts(league)`: each club's continental boost, through the 0178 links.
- `manager_leaderboard(league?, limit?)`, `manager_board_leagues()` and `manager_badges(ids)`: a club's own names, badge
  and record only, never the account.
- Names are checked against the username blocklist, including disguised letters.

**Until Louie runs `supabase db push` for 0259:**
- the Manager cannot save a club;
- GO's boards say they are on their way;
- the console's tab saves nothing.

`?local=1` runs the whole game against this browser's storage for trying it out.

## Next
- Friends mode: shared leagues with a creator, join requests accepted or rejected, public or private leagues, "please
  wait for friends" until the creator starts the league, and head-to-head records. Also the GO "Leagues" list of
  friends' leagues that want players.
- The Manager's languages: the `manager` pack (ja, es) for the whole game.
