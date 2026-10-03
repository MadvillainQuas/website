# The player report's statistics

The Report tab on a player's profile (`report.js`, `report-playerpages.js`) is the player as A4 pages; the same rows, as cards, are
the club report's PLAYERS pages (`report-teampages.js`). Each row is a value, its percentile among the players of his position in the
competition (guards, wings, bigs: the third that plays most like each), and their average.

**The templates** are `TPL` in `report.js`: `main` for a player's page, `players` for the club report's cards, each by position. A
reader can edit one and save it in the browser. A stat is in `STATS` (label, decimals, whether lower is better, whether it is a
*style*, drawn in one neutral tone because it has no good end) and, for the legend, in `DEFS`.

## Situation stats (2026-10-03)

| Stat | Where | What it is |
|---|---|---|
| HALF-COURT AST% | player report, guards | of his teammates' half-court baskets while he was on the floor, the share he assisted |
| HALF-COURT USG% | SCORING, both reports, every position | of his team's half-court chances while he was on the floor, the share he ended: a shot, 0.44 of a free throw, a turnover |
| % OF RIM ATT IN HALF COURT | SHOT PROFILE, both reports | of his shots at the rim, the share taken in the half court |
| HALF-COURT RIM% | SHOT PROFILE, both reports | his field-goal percentage at the rim in the half court |
| TRANSITION RIM VOL / 100 | SITUATIONS, player report | his shots at the rim in transition per 100 of his team's possessions while he is on the floor |
| TRANSITION RIM% | SITUATIONS, player report | his field-goal percentage at the rim in transition |

The half court is the events lines' (`situations.js`): a chance that was none of a second chance, a fast break (or within eight
seconds of a defensive rebound or a steal), off a turnover, or after a timeout.

- **HALF-COURT USG%** is worked out in `season.js` (`ev_half_usg`). The team's half-court chances come from the club's stored
  events line of each game, weighted by the share of that game's floor time he played, exactly as USG%'s possessions are. It counts
  only the games that have an events line, on both sides of the fraction, and is blank under ten chances. Averaged over the minutes
  played, it is the same as USG%: about 20%.
- **The share of rim attempts, and the transition volume,** are worked out in `report.js derive` from the row's `ev_` counts
  (`rim_half_sh = ev_half_rimA / ev_all_rimA`; `ev_transition_rim_a100 = ev_transition_rimA / on_poss × 100`, blank under 20
  possessions). The two rim percentages are the row's own (`ev_half_rim_pct`, `ev_transition_rim_pct`).
- **HALF-COURT AST%** needs every game's play-by-play of the competition, which the player page reads once (`fieldGames`), and is
  blank under **ten** such baskets (it was twenty, which left most of a competition blank for its first weeks).

The rim here is the events lines' own (`situations.js zoneOf`), so these rim counts can differ by a shot or two from the box
score's RIM VOL / 100 and RIM% (`engine.js isRim`, which asks the marker before the shot type). RIM ASSISTED% has always been read
the same way.

## The shot profile in parts (2026-10-03)

A group of stats about several kinds of shot is drawn in a part for each: a small heading (*at the rim*, *mid-range*, *three-point*) and the rows on a bar of the kind's colour (`groupRowsHTML`). On the club report's player cards the cells have the bar on top and a gap between the parts (`groupCellsHTML`). The colours are the club's, then 62% of it, then 34% of it, which are the zone tables' swatches.

Which stat is about which kind of shot is `SHOT_KIND` in `report.js` (the volume, the percentage, the assisted share, the half-court share of the rim). A group about one kind, or none (SITUATIONS, RIM PROTECTION), is drawn as it was, and a reader's own template is cut the same way wherever its stats are of several kinds. The report's two shot zone tables are cut by the profile pages' list (`shotchart.js parts`); their labels may wrap now, which also fixes the larger cuts' table running off the page.

## Pages that fit (2026-10-03)

A page of each report (player, club, game analysis) was measured in a browser against live data: is anything wider than the A4 page,
cut short by its box, or a page left nearly empty? What was found, and what the engine now does:

- **The engine** (`report.js layout`). A block goes on the page while it fits. When one is a little too tall for what is left, it is
  drawn smaller rather than given a page of its own: first the block alone, down to 88%; then, when it would have to go below that,
  *every block of the page together*, down to 92% (a chart that was alone on a nearly empty page, as the game flow's margin chart
  was, now sits under the rotations at 96%). A block much too tall still starts a new page, and one taller than a page is shrunk to it.
  A game's analysis went from 21 pages to 18 by this.
- **Both teams, zone by zone** (club report and game analysis) is cut into parts like every other zone table, each club's name once over
  its three columns, in fixed columns that add up to the page's width (`.rp-zz`). It had a club's name on all six columns and ran off
  the right of the page.
- **A crest or a photo that does not load** (a league's logo with no cross-origin header, as the KBL's, cannot be drawn into a PDF)
  is replaced by its monogram or the jersey number once the pages are built (`stand`, the `data-fb` on the image), where the page
  showed a broken-picture icon.
- **Names**: those under the cover's five spots wrap (112px at most) instead of running off the court, a long name in the rotations
  wraps to two lines, and a lineup card's tile has 2px a side so "opp eFG% −44.5" is not cut.

The cover's stripes and the hero's shapes are meant to run off the page; the audit lists them and they are not faults.

## Rim defence on and off

DEF RIM FG% ± and DEF RIM VOL ± (the bigs' RIM PROTECTION) are the opponents' rim field-goal percentage, and rim shots per 100
possessions, with him on the floor minus with him off it. They need the **on-court rim counts** stored on each player's game row
(`stats.oc.oRimA`, `oRimM`, written by `engine.js` since 30 September 2026), and 15 opponent rim shots on and off.

Games finalised before that carry none, so until the **Backfill stored player stats** workflow (`backfill-stats.yml`) has been run
for real the figure is blank for a player whose games are older. The workflow's `dry_run` defaults to **true**, which only counts. For
real: Actions, Backfill stored player stats, Run workflow, untick *Count what would change, write nothing*. It replays each stored
log with `engine.js` and merges six numbers into each row (`scripts/backfill_player_reb.mjs`); a game whose replay does not give the
stored score is skipped and named.

A season is kept as a file named by its token (the number of finished games and when the last was finalised), and the backfill
changes neither, so a competition's file keeps the old figures until its next final, or until `season.js`'s version changes (below).
Run the backfill **before** deploying the snapshots function, so the files it builds read the backfilled rows.

## When this reaches the site

Adding `ev_half_usg` is a new key on every season line, so the version of the code that sums a season changed
(`EpinoiaSeason.version()`, see [Season files](season-files.md)). Pages sum a season themselves until the files are built again,
which is slower and right. After merging:

1. (once) run the backfill for real, as above, and wait for it to finish;
2. `npx supabase functions deploy snapshots`.

`finalise-game` runs a copy of `season.js` too (for the BPM award), but reads nothing that changed, so it needs no deploy for this.

## Tests

`supabase/tests/report-page-fit.test.mjs` holds the engine's shrinking (driven through a small fake document with the pages' heights), the
crest fallback, the zone table's columns and the names; `supabase/tests/report-situation-stats.test.mjs` (and `zone-table.test.mjs` for the zone tables' parts): the ten-basket line; the derived rim stats on a row (rounding, the guards, no
coverage is blank, never zero); the new figures ranked and drawn; every template (the new keys beside the rim stats, after USG%, in
every position's SITUATIONS); half-court usage in `season.js` on a hand-worked season (weights, a game with no events line, under ten
chances); the Edge Function's copy.
