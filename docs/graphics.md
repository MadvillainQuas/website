# Graphics for socials

A league's posts, drawn in the browser from the rows the site already has and never stored: the console's **Graphics** tab (Weekly content, and Build your own) and the **creator hub's** Graphics section. Square (1:1), portrait (4:5) and story (9:16); each with the words to post it with.

Code: `socialcard.js` draws and words them, `admin/socialgfx-ui.js` reads the rows and lays out what there is, `admin/graphics-ui.js` is the screen. Tests: `socialcard.test.mjs`, `graphics-tab.test.mjs`, `graphics-every-stat.test.mjs`, `daily-scores.test.mjs`.

## The night's picks: BPM and nothing else, from 18 minutes

A game's player, a side's leader, and the week's stars are picked by the game's own **BPM**: the figure on the game page's squads circles, to the tenth (`socialcard.js` `gameBPMs`: each club's own pace and ratings from its game line, `bpm.js` `forTeam`; where a game has no club lines, `bpm.js` `gameFromBox` from the players' lines, a little different). Two things bend that, and only these:

- **18 minutes.** A player must have played 18 minutes in the game to be in the running (`socialcard.js` `NIGHT_MIN_MS`). Per-100 rates worked from a few minutes are noise: before this, one pick in three on live data (74 of 227 player-of-the-game picks, 27 league-weeks) went to a player of under 18 minutes, +97.6 BPM in eight minutes the worst. Where nobody on a side played 18, the minimum is waived for that side (a deep rotation still has a best night).
- **No BPM, points.** A feed with no minutes has no BPM; the picks go by points, as they always did, and the graphic says "ranked by points", not BPM.

Level BPM is ordered by name, never by another stat. **BPM is printed wherever a pick is named**: a leader's line on a final and on a day's scores (`24 PTS · 8 REB · 5 AST · +12.3 BPM`), the stars of the week and of the month (a fourth stat, and "ranked by BPM" under the title), the builder's player lists, and the first cell of the player of the game's strip.

The **stars of the month** (and a BPM leaders board) rank players averaging 18+ minutes a game; a month's list was led by a player of two minutes and no points.

## Every number is the page's number

A graphic is only worth posting if it says what the game page says. So the figures on the cards are **worked the way the page works them** (`boxscore.js` `playerAdv` / `teamAdv`, `game.js` `gameBPM`), not by the season's formulas run over one game, and a test holds each to the page's own figure on a real game (`daily-scores.test.mjs`, fixture `slb-london-leicester-2026-10-02.json`: London Lions 71-66 Leicester Riders, all 21 players, the page's BPM, USG%, TS%, STL%, BLK%, on-court NET / ORTG / DRTG against each player's line).

- **The inputs** are what the game page reads: each player's stored line and his **on-court block** (`oc`, from `player_game_stats`), and the two **club lines** of the game (`adv` of `team_game_stats`: totals with the team's own rebounds and turnovers, pace and ratings), read with the week (`socialgfx-ui.js` `PLAYER_COLS`, `read()` → `teamAdv`).
- **A number the game cannot work out is a dash** (or, in the strip, a cell left out), never a guess: a player with no shot attempts has no TS%; a player with no on-court possessions has no on-court ratings (the page prints a meaningless -110 there).
- **A final's optional TEAM STATS** are the clubs' own lines, as the box score's totals row prints them: the rebounds and turnovers that belong to the team and to no player, and a bench or coach foul, are in them and in no player's line (the club's line is read with its fouls total, `foulTot`). A game with no club lines is summed from the players' lines. Checked against the live box score tab on every final of the Super League (14 totals rows, none different).

## The player of the game

Winning side's best night (a draw: either side). Under his points, rebounds and assists, left to right: **BPM** (lit), **USG%**, **TS%**, **STOCKS%**, **ON-COURT NET**, **ON-COURT ORTG**, **ON-COURT DRTG** (`socialcard.js` `NIGHT_STRIP`, worked by `nightAdv`).

- **USG%** is his possessions (shots, 0.44 x free throws, turnovers) over the club's, in the minutes he played against the game's. **TS%** is points over twice his shooting possessions. **STOCKS% is STL% + BLK%**, the two figures the Full stats tab prints, added (the site has no column of its own).
- **ON-COURT NET** is what the club did while he was on the floor, as the Full stats tab prints it: its offensive rating less its defensive one. **ON-COURT ORTG** and **DRTG** are, as the tab prints them, each **against the game's average rating** (the mean of the two clubs'): a DRTG of -30 is thirty fewer points allowed per 100 possessions than the game's average. Whole numbers, a real minus.
- This is the **box score's Full stats numbers, not the on-minus-off of the season profile** (his club's rating with him on the floor minus off it): they are different things and the cards used to print the second under the first's name. They are labelled ON-COURT so nobody takes them for the profile's ON-OFF.
- A cell the game cannot fill (a league scored without on-court records, no club lines) is **left out**, not dashed. Chosen stat lines (the builder's picker, up to ten) still win; the first keys older builders saved for the on-off numbers (`onnet`, `onortg`, `ondrtg`) read as the on-court ones.

## Daily scores

Every final of **one game day** for the league: crests, names, the score, and each side's leader (his name, and his line with the BPM he was picked on) **when the rows are tall enough** (`DAY_LEAD_ROW` = 132px: about six games on a portrait, four on a square, seven on a story). A busier day is short rows of scores only, and the builder says the leaders were left out for want of room; fewer rows (the Rows module), a taller shape, or fewer games bring them back. More games than a page holds (7 square, 9 portrait, 10 story) are cut into even pages, which usually have the room.

- **The game day is the league's own calendar day** (its timezone's, midnight to midnight; a day the clocks change is 23 or 25 hours), not the browser's. "Times shown in" moves only the tip-off times (Also on each game: tip-off, venue, quarter scores), never the day.
- **Weekly content** has a Daily scores graphic for every game day the week on screen holds whole, newest first (a day cut by the window's edge would be a partial list and is left to the builder), all competitions together; the Competition filter narrows it.
- **Build your own > Daily scores** has a **Game day** picker: every day the league played on (the competition on screen's), newest first, with its games counted, however far back. `readDays` is one narrow read of every finished game's tip-off; the day picked is then read on its own (`readDay`) and kept until Read again.
- Options: headline, subline, club crests, each side's leader (on/off) and the stats beside him, how many rows, also on each game (tip-off, venue, quarter scores), the colours, the logo and the footer, as every template.
- Files: `league-scores-2026-10-02-portrait.png` (a page two: `...-2-...`).
