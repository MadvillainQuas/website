# Manager mode (future plan, 2026-10-09)

Louie: "I want ALL of this incorporated into a 'Manager' mode, where the user is, like Football Manager, able to take the
reins of a team, draft a team, pick lineups and bench units, alter styles (i.e. give one player more usage, encourage more
threes etc.), competitive between users and with simmed games from other teams, that uses fantasy sports elements."

This is a direction marker, not a build. Nothing here is scheduled; it records how the Front office's pieces would carry
over so later work does not paint itself into a corner.

## What already exists to build on
| Piece | Where | What Manager mode would use it for |
|---|---|---|
| Squad model | `epinoia/t/squad.js` | Team strength from players, minutes and positions; the usage sim (plays add up to 100%, skill curve); stamina and who-they-face effects; roles |
| Game simulator | `epinoia/winsim.js` (+ `winsim.worker.js`) | Possession-level match sims from two profiles, seeded and reproducible |
| League values | What wins files (`winfile.js`) | Pricing every rate in points and wins, per league or pooled |
| Player lines | `D.season` (`season.js`) | The real season line every manager-mode player starts from |
| Roster what-if UI | `fomodel.js` `squadSimUI` | Starting point for the tactics and rotation screen |
| Ratings | (not built) | The 1–20 attribute scale held back from the Front office (Louie, 2026-10-09) belongs here: percentile among the league's players → 1–20 |

## The loop
1. **Take a team**: a real club in a covered league (career), or draft one from a league's player pool (with friends).
2. **Set it up**: rotation and bench units (minutes by position, as the squad model already holds them), styles (each
   player's usage weight on the discretionary usage the usage sim shares out, three-point emphasis, pace, rim or perimeter
   defensive focus), and minutes management (the stamina line).
3. **Play the matchday**: user against user and user against AI clubs simulated by winsim from the squads' profiles; the
   other fixtures from real results (career) or simulated (leagues).
4. **Read it**: box scores, standings and the Front office panel itself as the post-match report.
5. **Move**: trades, waivers or free agents between matchdays; repeat.

## Fantasy layer
Real games feed player points; a manager's lineup decides which count; season-long and head-to-head formats; a draft
budget or salary cap so a squad cannot simply be the league's best five.

## Data (a future migration, sketch only)
`manager_leagues`, `manager_teams` (owner, club or drafted), `manager_rosters`, `manager_tactics` (json: minutes,
usage weights, styles), `manager_fixtures`, `manager_results` (sim output with its seed), `manager_drafts` / picks.
Row-level security by owner; sims in an edge function or worker with a seeded RNG so a result can be replayed.

## Phases (indicative)
- P0: this note.
- P1: single-player career on one league (pick a club, set rotation and styles, season simmed on the real fixtures).
- P2: leagues with friends, the draft, head-to-head matchdays.
- P3: the fantasy layer from real games.
- P4: the Football Manager feel (1–20 attributes, scouting, staff, press).

## Open questions
Weekly or on-demand sims; how much a manager's choices may move a real club's simulated results; anti-collusion in
leagues with friends; whether paid access gates any of it.
