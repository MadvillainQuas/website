# EPINOIA Manager (individual mode, built 2026-10-09)

A Football Manager-style game on EPINOIA. The reader takes a club into a real league: they name it and its manager,
draw or upload a badge, choose the country and league, and draft a squad of real players within a budget. Then they set
lineups and tactics and play the league's real clubs on the real calendar, every club three times. Real form moves the
players during the season (the fantasy element).

**Modes.** Individual mode is built. Friends mode (shared leagues, a creator who starts the league, join requests) is
next. Global mode was scrapped (Louie, 2026-10-09).

## Where it lives
| Part | Files |
|---|---|
| The way in | HOME's third strip tab, MANAGER (`home/index.html`, `kit/home.css` `.mg-warp`, `home/vhmode.js` `toManager`): a royal-blue wipe, then `manager/` |
| The page | `manager/index.html`, `boot.js`, `app.js` (router, rail, shared builders, catch-up, saving), `manager.css` (the royal blue, soft-glass skin; dark navy and light sky-blue) |
| The screens | `manager/views/`: `onboard.js` (login, black transition, team name, manager name, badge, country and league, mode); `squad.js` (draft pool, filters, shortlist, hover cards, 1–20 attributes, confirm); `tactics.js` (court drag-drop, up to 4 lineups, minutes to 40, sliders); `season.js` (home, fixtures, table, statistics); `pages.js` (player pages with Real season / Manager season tabs, each with Scouting and Simple views; team pages); `trade.js`; `live.js`; `game.js`; `boards.js` (leaderboards, club settings) |
| The game itself | `manager/core/` (UMD, no DOM, no site: `root.Mgr.*`): `value.js`, `ratings.js`, `schedule.js`, `names.js`, `badge.js`, `cards.js`, `engine.js`, `season.js`, `scorer.js` |
| The site, from the game | `manager/adapters/epinoia.js` (`Mgr.site`): the **only** file that knows EPINOIA. It provides the leagues, the season files, the values and boosts, form windows, the clubs (`manager_*` RPCs) and badges. Swap it and the game runs elsewhere. |
| EPINOIA GO | `go/leaderboards/` `#manager` and a teaser on GO's home (`leaderboards/managerboard.js`, `kit/mgboard.css`): the promise, the realism marks, your clubs, and the boards (global and league by league) |
| The platform console | the Manager tab (`admin/platform/manager-ui.js`): each league's value range and continental boost |
| The marks | `tools/manager-validate.mjs` writes `manager/validation.json` |
| The database | `supabase/migrations/0259_manager.sql` |
| Tests | `supabase/tests/manager-core.test.mjs` (73), `manager-db.test.mjs` (35, PGlite); both in guard.yml |
| Languages | the `manager` pack (`i18n/ja/manager.js`, `i18n/es/manager.js`), and the go, platform and game packs for their parts |

## Everything is played in the reader's browser
Louie's instruction: only the reader's chosen league is simulated, and only on their device. On each visit `app.js`
`catchUp` plays every round that has come due. Rounds fall on Wednesday and Saturday (two a week) or Saturday only (one
a week), at 19:00 UTC. Before each round the form windows from `player_game_stats` are read, so real form moves the
players. The database keeps only what has to outlive a visit:

- the club, its squad and lineups;
- the season's compact state: fixtures and results, every player's line in `season.LINE` order, club totals with the
  opponents' side, the reader's own games' boxes with plus-minus, and their play-by-play (about 4 KB a game, base 36);
- the summary the boards rank.

A **scouting network** widens the draft and trade pool. The reader adds leagues to it, and their players can be signed,
but only the chosen league is simulated.

## The engine (core/cards.js, core/engine.js)
- **Players become cards.** Each card holds league-relative deltas, shrunk toward positional priors by minutes. Where the
  individual stats have gaps, on/off figures weigh in lightly, and less at low minutes. The card is also adjusted for the
  opposition faced, for the league's strength, and for current form.
- **Fives become winsim profiles.** The usage sim adds the plays up to 100%, on the skill curve. Taking more shots from a
  zone costs efficiency, less for players used to creating unassisted. Spacing, added up over the five, decides how
  packed the paint is (fewer shooters, a harder rim). Passing synergy, out-of-position play, fatigue and the tactics all
  apply.
- **Tactics** (`E.TACTICS`). Focus: guard play, wing play, big play. Attack: get downhill, punish from deep, off-ball
  cutting / space the floor, hit the big / hit the shooters. Defence: funnel to rim protection / no paint touches,
  gamble for steals, leak out, crash the offensive glass. There is no transition slider. Leak out drives the volume of
  transition, and players who rarely run pay for it.
- **Rotations are timelines.** The two sides are overlaid into stretches, and each stretch is a `winsim.matchup`. The
  rates are mixed and one `winsim.game` is played with a trace. `pbp()` then hands every event to a player on the floor.
- **Real clubs carry their identity.** `winsim.applyEdits` pulls each real club toward its real four factors. The
  fallback league is calibrated from the season's team totals, home court from the home-win share, and `dTr` from
  transition against half-court points per possession.
- **The play-by-play's clock** (`clockOf`, Louie: the box score's transition points and shot clock read the clock, as
  EPINOIA's do). Each quarter's possessions are laid out again inside it:
  - a fast break takes 2–6 s to its first shot;
  - a put-back comes 2–5 s after the board;
  - a set play's last chance comes late in its possession.

  Each possession names the five on the floor (`l`), and the box score substitutes there. Only the clock moves; who did
  what does not.

## The economy (core/value.js)
1. A player's index weighs points most, values minutes, and weights bigs (and athletic, shot-blocking bigs most).
2. The index becomes a percentile p in the league.
3. The value is `min + (max − min) · p³`, inside the league's range. The best go up to 12% over the range and the
   fringe up to 12% under.
4. A club linked (in Links) to a side in a boosted league adds that league's boost.

Wages are 16% of value, and the squad budget is 12 × the league's average wage. A trade may bring in any value as long
as the wages stay within budget. Leagues without a range take the middle league's range (`medianRange`).

## Watching a game
At a round's tip-off, HOME offers **Watch it live** or **Show me the result** (`views/live.js`). The broadcast runs at
game pace, with 2-minute breaks between quarters and a 5-minute half-time. Watching changes nothing in the game. A round
being watched is hidden from every other screen (`A.view()`) and kept off the boards' summary until it ends or the
reader asks for the result.

## Box scores
A game's box score is EPINOIA's own game page, drawing it. `core/scorer.js` turns the play-by-play into the scorer's
event log (shots placed in their zones, assists, blocks, fouls and free throws, turnovers and steals, boards,
substitutions). It is handed over in `sessionStorage` (`mgr_game`) to `game/?mgr=1` and embedded with `&embed=1`
(no rail). Every tab works: the traditional and modern box, the play-by-play with linked plays and faces, shot charts,
lineups, full stats, game flow, connections, play types and the shot clock.

A Manager game has no match report, no league table and no PDFs. The core tests replay the converted log through
`epinoia/engine.js` back to the Manager's own box, player by player.

## The realism marks (tools/manager-validate.mjs → manager/validation.json, shown on GO)
Four complete seasons were replayed, every club against every other, home and away, six times (6,384 games). Each club
was built the way the Manager builds it.

| League | r (identity) | r (players alone) | Points a game, sim (real) | Home wins, sim (real) |
|---|---|---|---|---|
| ORLEN Basket Liga 2025-26 | 0.97 | 0.72 | 85.9 (85.5) | 61% (60%) |
| Primera FEB 2025-26 | 0.99 | 0.93 | 81.8 (80.9) | 60% (61%) |
| NBL Division One 2025-26 | 0.95 | 0.76 | 74.8 (75.9) | 58% (58%) |
| CEBL 2026 | 0.92 | 0.61 | 93.7 (92.7) | 64% (61%) |

"r" is the correlation of each club's simulated margin with its real point difference. Run the tool again
(`node tools/manager-validate.mjs`) whenever the engine changes, and commit the file.

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
Friends mode: shared leagues with a creator, join requests accepted or rejected, public or private leagues, "please wait
for friends" until the creator starts the league, and head-to-head records. Also the GO "Leagues" list of friends'
leagues that want players.
