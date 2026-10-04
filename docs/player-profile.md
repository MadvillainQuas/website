# The player profile

A player's page (`p/`). Its code is `p/player.js`, with `p/withui.js` (on the floor with), `shotchart.js` (the shot chart) and `fulltable.js` (the career table). It predates the page standard (`docs/page-standard.md`), so it keeps its own sections.

## Shot chart: the zones as a table

Under the court, every zone and then the larger cuts (the sides, the paint, jump shots, every shot), in the club page's table dress (`kit/clubstats.css` `table.czt`): a heading row over each group, each zone's swatch by kind, and the share of the shots as a bar in the club's colour. Each row has its makes of attempts, its share, its attempts and makes per game, its FG% and its eFG%.

**The colours are the court's.** FG% and eFG% sit on pills tinted on the same diverging scale as the zones above them: blue below the break-even, orange above, grey within two points, three steps a side. The gap to the break-even is under each pill.

- A zone's break-even is its kind's: paint 58%, mid-range 40%, three 35%.
- A cut of several kinds is held to the mix it was shot from, weighted by attempts. So "every shot" taken mostly at the rim is not judged against the three's 35%.
- eFG% counts a three as one and a half makes, and so does its break-even (35% from three is 52.5% eFG).
- A row under the court's attempt floor is hatched, as its zone is: too few to rate is not average.

**In parts (2026-10-03).** Under *every zone*, a heading band for each kind of shot (rim & paint, mid-range, threes) with its zones on a bar of the same colour; the larger cuts are headed *by side of the floor* and *by kind of shot*, the three cuts that are a kind of shot wearing its colour, and *every shot* stands alone. The colours are the club's, then 62% of it, then 34% of it. Below 600 px of the table's own width, the band is a small heading over the cards and a card's bar is its left edge. The club page's table is cut the same way (see [the club page's team statistics](club-statistics.md)).

Below 600 px of the table's own width, every row is a card with its figures on one line. Code: `shotchart.js` `PARTS`, `parts`, `zoneRows` and `zoneTableHTML`, `kit/shotchart.css` (`.scz`, `.scz-kh`). Test: `supabase/tests/zone-table.test.mjs`.

## Career stats

The section that was "Season" is now **Career stats**. It has a row for every season and competition the player has played, his linked profiles' included (`docs/entity-links.md`): the same scopes as the season picker above the page. Each row is the club he played that competition for, not his club today. The newest 60 rows are read, three at a time.

- **COMP** is a locked column after TEAM, next to GP and MPG, in every preset. So a player with a league and a European cup in one season has a row for each: SLB and EuroCup. The name is the competition's short one (`seasonbar.js` `compLabel`): the league's initials or short name, then its kind ("SLB Cup", "Primera FEB Playoffs"), but a cup with a name of its own keeps it ("Copa Princesa"). Two competitions that would read the same say their own names after the league's ("SLB · Championship").
- **A row is a link to that season and competition on this page.** A plain press switches the page's scope (the season picker, the tiles, the game log) without leaving it and scrolls back up to the tiles. A press with a modifier key, or a middle click, opens it in a new tab. The row being shown is marked.
- The search finds a season, a team or a competition.

Code: `p/player.js` `paintCareer`, `renderCareerRows`, `markCareer`; `fulltable.js` (`compColumn`, `sortDir`).

## Game log

A chart over the table: any statistic, game by game, oldest first. Pick it with the chips above the chart, or by pressing a column's heading in the table. The choice is kept on the device (`localStorage epinoia_log_stat`).

- **Bars** are the games. Where the log has more than one competition, each one is a shade of the player's colour, named in the key. A result tick under each bar is green for a win and red for a loss.
- **The dashed line** is his season. **The solid line** runs over his last five games (fewer at the start).
- **Percentages are makes over attempts**, over whatever stretch a figure covers: the season, the last five, a half. They are never an average of game percentages. A game without an attempt has no bar, not a zero.
- **The facts** over the chart are the season, the last five against it, the first half of his games against the second, and the best game. A percentage's best game needs his usual number of attempts (and at least two), so 1 of 1 is not a season's best.
- Point at a game (or tap it) for its date, opponent, competition, result, figure and gap to his season, with a link to the box score. Its row in the table is lit.
- **The table** names each game's competition (COMP). The charted column is lit, and its cells far from his season are tinted: green better, red worse, a deeper shade from one and a half standard deviations.

**BPM is the game's own, as Basketball-Reference adapts BPM 2.0 to one game** (`bpm.js` `game`, 2026-10-04). The regression runs on the game's box score, but each player's **position and offensive role are his season's** (the competition's season rows), and the **team rating for the game** is not its margin alone: each side's quality is first estimated from the players who played (each one's season BPM, regressed for few minutes, weighted by his share of the game's possessions), the two averaged, then each side gets half the game's efficiency margin either way, the leading side credited 0.35 per 100 possessions for every point of average lead (the engine keeps each side's average lead, `engine.js teamAdv avgLead`). BBRef's example: both sides at +10, a +12 margin with a +5 average lead give +16.9 and +3.1. A season BPM from under 450 minutes is regressed to -4.75 + 0.175 x minutes / (games + 4), weighted (450 - minutes) / 3, with that estimate's level set by the competition (so a season a few games old does not pull every game down). The team adjustment holds within the game, so a side's minutes-weighted BPM is 1.2 times its rating over five. The game page's circles and modern box, this game log and the graphics all ask the one function. A game whose other side has no lines has no BPM; without the season it is the box score's own estimate. Averaged over his games it is labelled "avg of games", because the season's BPM is worked out from the season's box score, not averaged from games.

Game score is gone: BPM is the game figure here and in the graphics.

Code: `p/gamelog.js`, `kit/gamelog.css`; `p/player.js` `seasonLog`, `logBPM`.

## On the floor with

**On / off** (the team with him on the floor and off it, `wowy.js` `onOffTiles`):
- the head: his net rating on and off, with the swing between them, green when the team is better with him on;
- then a row for each rating and factor: net, offensive and defensive rating, eFG%, TS%, turnover %, offensive rebound %, the opponents' eFG% and pace.

**With and without teammates** (`p/withui.js`):
- The teammates are listed by most minutes together, each with those minutes. The first ten show, and the rest are one press away.
- Pick one or more teammates. A row a statistic then shows his line with them, without them, the gap and his overall line, under a head that names them and the minutes on each side.

**The gaps** (`wowy.js` `deltaCell`) are a pill and a bar from the centre:
- green and to the right where the number is better, red and to the left where it is worse;
- a lower defensive rating, turnover rate and opponents' shooting count as better;
- grey where more is only a style (shots and threes taken: how many a player takes is his role).

The bar's full length is a set gap for a rating, or a share of the "without" figure for a count.

Code: `wowy.js`, `p/withui.js`, `kit/onfloor.css`.

## Position breakdown

The hero's "EST POS" chip is replaced by a half court: the five positions on their spots, each coloured by his share of minutes there, as Football Manager colours a player's positions (green over half, light green 25–50%, yellow 10–25%, orange under 10%, an empty ring never). His main position is ringed. The court's head says how many games and minutes it covers. It covers the season and competition shown, and redraws when that changes.

Where the minutes come from:
1. **The games' position files** (`docs/position-files.md`): his seconds at each position, summed. The newest three are asked for first. If none exist (a members-only league, or before the files were written), no more are asked for.
2. **Otherwise the lineups.** Each five he was in is ranked point guard to centre the way the files and the club's depth chart rank them (`depth.js` `floorPos`, each player placed by `positionOf`: his season line's position, his listing and his height).

It sits beside the hero's details: a third column from 1800 px, under the details below that, and full width on a phone.

Code: `p/player.js` `paintPosBreakdown`; the `.idpos` styles in `p/index.html`.

## Tests

`supabase/tests/player-profile.test.mjs`:
- the game log's arithmetic and chart;
- `gameFromBox`;
- the delta cells, on/off and the teammate chips;
- the position breakdown, from files and from lineups;
- the career wiring;
- `compLabel`;
- the page's scripts and styles.

`zone-table.test.mjs` holds the shot zones table. `fulltable-global.test.mjs` §11 holds the COMP column.
