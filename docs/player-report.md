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

## Synergy, AST% by situation, the type, PRIME REPORT (2026-10-04)

**A player's Synergy file** (the scraper's `synergy_playtypes_<Player>_accumulated.csv`) is read by `synergy.js`: one row per node of
Synergy's play-type tree, each side of the ball. What the reports take from it, and only that (the file itself is never kept):

| What | Where | How |
|---|---|---|
| Left / right chart | the club report's player card (bottom left), the player report's DIRECTION (under WHERE HE SHOOTS) | his drives left against right: PPP (the heaviest bar, in the colour of the shot that side leans on - red the rim, blue the pull-up jumper, light for mid-range, dark for threes, stronger the more one-sided), % of his possessions, eFG%, TO%; each on one scale for both sides; the dashed marks his drives in all directions; the better side's numbers green, the worse red |
| Where the drives end | DIRECTION | each side's shots at the rim, pull-up mid-range and pull-up threes, as % of that side's shots |
| DRIVES L/R · SYNERGY | a category of its own after SHOT PROFILE, both reports | DRIVE L/R RIM FG% and ATT%, MID FG% and ATT%, 3FG% and 3 ATT%: each pair tinted against his drives in all directions (never against this season's RIM% / MID% / 3PT%: the file covers several seasons); the better side's number green; the attempts (or each side's shots) under it |
| ATTACKED FACE-UP eFG% | every position's defence group, both reports | what his man shot isolating him or driving at him (every defensive isolation, and every drive left, right or straight outside one); against the break-even 52.5, lower is better |
| POST-D eFG% | the same | what his man shot posting him up |

Drives come from every play type that has them (a spot-up closeout attacked, an isolation, a pick-and-pop), counted once: an
isolation's drives are split by where he started (Top / Left / Right) and summed again under "Isolation - Overall" - the total is the
Overall row, the shot types the split's. A player with no file has none of these: no category, no rows, no chart.

**Adding them**: *Add Synergy CSVs* on the report's own panel (any number of files at once, and more after them). Each player in them is matched to the report's
players by name, or by surname and initial where only one fits ("JJ White" is Jaylon White), and **the match is shown to be checked
and changed by hand** (or left out) before anything is kept. A platform administrator's are kept in `synergy_profiles` (0228) for every
report after it, the mailer's too; anyone else's stay on that page.

**AST% by situation**: every half-court and transition card (club report, both ends; a player's own) has its AST% in the gap under
the court: the share of its made baskets that were assisted, and the same at the rim, mid-range and three (`situations.js` marks
each made shot assisted or not). A guard's card has HALF-COURT AST% in HALF COURT; the player report has TRANSITION AST% in SITUATIONS.
The club's own half-court AST% has a key of its own (`tm_hc_ast_pct`).

**The type**: every report page (player, club, game analysis) is set in Archivo; the site's pixel faces are not used on paper.

**PRIME REPORT**: one click makes the report ready - RAPM read where it was already worked out (this browser, then `report_rapm`,
0228) or worked out now and kept there for every report of that league and season, Synergy read, every page built - then the PDF
**stored for sending** (0229, below), not downloaded (*Download PDF* gives a copy). `?prime=1` on a report's address does the same
on opening; the mailer primes the reports it draws itself.

## The reports manager and the players' reports (2026-10-04)

**The reports manager** (platform console, Reports > Team reports by email > *open the reports manager*; `admin/platform/reports-manager.js`):

- *Addresses and clubs*: each address with all its clubs (an address may have several: a `report_mail_subs` row is an address and
  a club), added with one club or several at once, or a club added to an address already there. For each club: PRIME REPORT (a
  report opened with `?prime=1`) of each club it plays in the next two weeks (the reports its Sunday email carries) or of its own
  report; pause, remove, and *send next week's reports now* for the address. The address's
  *players' reports (ZIP)* switch is `player_zip` (0228, on by default).
- *Synergy files*: the CSVs dropped in are matched to **the clubs the reports are on**, never the whole site: every club an active
  address is sent reports of, and every club those play in the next two weeks (the Sunday email's scouting reports), each listed
  with why it is there and its PRIME REPORT. A club the schedule does not show yet can be added by hand. A name is suggested from
  those squads alone, and changed by hand from them (typed, or picked from a club's squad); then kept (`synergy_profiles`). Files are
  taken as many at a time as are chosen: in the drop box for all those clubs, or with a club's own *add CSVs*, matched to its
  squad alone. The
  kept ones are listed, each with its player report's PRIME REPORT, or to remove.

**The players' reports** (`scripts/report_mailer.mjs`): right after a Sunday email (or a *send now* one), a reply to it ("Re:" its
subject, `In-Reply-To` / `References` the Message-ID the mailer gives the Sunday email), with one ZIP a club whose report went in it:
the player report of everyone who has played for the club this season (its league's newest season, final games), at 10 minutes a
game or more, and not released by it (`player_releases`). A player's report is drawn once a run. Logged as kind `players`. An address
with `player_zip` off, or a database before 0228, gets the Sunday email alone.

**Every report the mailer draws is primed** (`EPINOIA_RP_PRIME`) with the Synergy numbers kept (`EPINOIA_SYNERGY`, read with the
service key); RAPM a report had to work out is kept in `report_rapm`, so the next report of that league and season reads it. The
workflow's limit is 120 minutes.

Tests: `supabase/tests/reports-manager.test.mjs` (the clubs a file is matched to, the ZIP read back, whose reports go in, the threaded
reply, priming).

## PRIME REPORT stores the report for sending (0229, 2026-10-04)

PRIME REPORT (a club's or a player's Report tab, or the reports manager's buttons) draws the report at email weight and keeps the
PDF in the private bucket `primed` (`<team|player>/<id>.pdf`) with its row in `primed_reports` (kind, ref_id, path, bytes,
primed_at, primed_by); a new PRIME replaces it. Platform administrators alone write and read them.

The mailer sends that file in place of drawing its own - the Sunday email's club reports and the players' ZIP - while no game of
its club has been finalised since it was primed (otherwise it is drawn afresh). At the end of the run every primed copy an email
carried is deleted (file and row), as are the stale ones and any older than two weeks; one no email has carried yet stays for the
one that will. An email that fails to go leaves its copies for the next try. Before 0229 every report is drawn as before.

What PRIME did is said under its buttons, read back where it is kept: green "Primed" when all is ready for the emailed reports
(RAPM kept for the league and season, Synergy kept for n of the players, the pages built, the file stored for sending), amber with
what is not (for instance a sign-in that is not a platform administrator's: the file is not stored). The reports manager marks
every report stored for sending with when (`✓ stored Sun 4 Oct 08:14`).

## Insights: the scout's read, on the tab (2026-10-08)

Louie asked for a written section on the scouting report of a club and of a player, "how to prepare, strengths,
weaknesses, using basketball language and technical terms", from the report's own numbers and not on the PDFs.
`epinoia/scoutinsights.js` writes it; `report.js` mount draws it (`o.insights`) FIRST on the tab, above the controls
(Louie, the same day: "promoted more on the screen"; under a controls panel 650-860px tall it had been off the first
screen), as a fold that opens closed (it keeps the reader's choice when the report is built again). It is never in the
pages, so it is not printed, not in the PDF or the images, and not in the Sunday emails.

The folded row sells what is inside: a kicker ("The scout's read" and the scope), "Insights on" the club or player, the
read's first line as a two-line teaser, chips counting what the fold holds (strengths, weaknesses, the game plan's points
and the players scouted; for a player the ways to guard him), and a button in the kit's primary (`ep-btn pri`, as
Download PDF) reading "Read the insights", "Hide" once open. Open, the teaser and the chips give way to the read itself.
Until the first build has the insights, a quiet copy of the row ("Reading this report's numbers…") holds its place at the
same height, so the controls do not jump down when it lands; a build that fails takes it away.

- **Club** (`t/team.js`, from `ctx.season()` and its shot zones): the read (the ratings and their places, the identity at
  each end), strengths and weaknesses (the top and bottom quarters among the season's clubs, the most salient first: the
  four factors and the ratings weigh most, a style only as identity), how to prepare (their strengths taken away, their
  weaknesses attacked, each line with the measure it rests on), and the personnel (the rotation's main players, a role and
  how to guard him each).
- **Player** (`p/player.js`, from `ctx.bars()`): his line, his role, strengths and weaknesses among his position's players
  (guards, wings, bigs: season.js positionGroups), how to guard him, and how to attack him on defence.
- **The scout's words with their evidence** (the basketball-scouting-language skill's lexicon): "plays downhill" only
  with rim volume and free-throw rate, a big's rim volume as interior finishing, "rim deterrence" from opponents' rim
  volume, "connective passer" only with a high assist rate at low usage; a coverage the event data cannot see is never
  asserted (a mid-range-heavy defence "fits" a drop scheme). When the box score and the on/off disagree they are said
  together; the on/off only on 300 possessions or more. No plan line another measure contradicts.
- **The editor** (`scrutiny.js`, `register: 'scout'`): the fan's model-speak rules off (PPP, eFG% and the four factors are a
  scout's words), the near-copy and grammar rules on; the read and the lists are edited as two pieces, each line marked
  with its slot so a dropped line never shifts the rest.
- Tests: `supabase/tests/scoutinsights.test.mjs` (in CI).


## Pages with no dead space, three new sections, and a weekly email (2026-10-16)

Louie: "make sure that all player report PDFs are perfectly structured and laid out ... so that there's no dead space,
including if synergy is included", a section of actionable insights before the legend, a connections section, a games played
during the week section, and a weekly player report by email.

**The engine** (`report.js layout`):

- **A block of parts** (`splitBlock(parts, render)`): MAIN STATS's groups, the legend's rows, the on/off table's groups and the
  week's rows of courts. Where the whole does not fit what is left of a page, the most parts that do are drawn there and the
  rest go overleaf (`cut`), rather than the whole moving to a page of its own. MAIN STATS was a season line and four-fifths of a
  blank page.
- **A section may flow on** (`pack: 'flow'`): it begins under the section before when its first block fits and 30% of the
  page is free (`FLOW_FREE`; the legend 15%, its key alone). A section joining a page is named over a rule in the club's
  colour (`joinHead`, a printed label, never a `::before`), and the page's head names both ("ON THE FLOOR WITH · continued ·
  CONNECTIONS", smaller when long so the player's name is never cut).
- **A small last block** (a legend's last few rows) may take the page down to 86% together rather than a page of its own.
- The player report's order: cover, MAIN STATS, SHOT CHART (Synergy's Direction after the half-court and transition cards),
  LEFT V RIGHT, CONNECTIONS, ON THE FLOOR WITH (its tiles and its table two blocks), GAMES PLAYED DURING THE WEEK, INSIGHTS,
  LEGEND. Measured on SLB players with and without Synergy: every page but the last 70% full or more.

**CONNECTIONS**: every assist paired with its basket by the game page's rule (`passLinks`, the last made field goal of the
passer's side, each basket once), over the competition's games: who they set up most (assists, points, threes, at the rim,
mid-range, their most frequent shot types), a court of where those baskets were scored in a colour for each teammate, and who
sets them up.

**GAMES PLAYED DURING THE WEEK** (`p/player.js loadWeekGames`): the week `?rpweek=` names (the email's Monday), else the week of
the player's latest game, Monday to Sunday in the league's time zone, every profile of theirs. A court of their shots for each
game (one game: the court and the game's tiles side by side), then the match report's three FULL STATS tables
(`epinoia/gamefull.js`, shared with `game/analysis.js`), a row a game, each figure against its own game (its bar ranges, its
average, the game percentiles). The stored line lacks eFG% and the two on-court free-throw rates; `fromStored` works them out.

**INSIGHTS** (`scoutinsights.js develop`): what is working and what to work on, for a guard, a wing or a big, read from what
every section found (`R.facts`): the season line ranked among their position, transition and half-court finishing, half-court
AST%, the handle or the passes behind the turnovers, the three (with FT% as the touch), the line, the glass, defensive events,
left v right, the passing menu, and the week against the season. Each note gives its measure and percentile, and each thing to
work on the work, in the scout's words. Rebound, steal and block notes wait for 80 minutes, shooting notes for their attempts.
They/their throughout: the site covers women's leagues.

**The weekly email** (0272, `scripts/report_mailer.mjs playerRound`): an address and a player in `report_mail_players`
(platform administrators only; the reports manager's **Players** tab, opened from the console's Reports tab). Every Monday from 8 am at the address's time, the week
just played: the player's report drawn for that week, attached to an email listing its games. A week without a game of theirs
is skipped and not logged. A Monday missed is caught up on the Tuesday; on the Monday a game of the club's still being played
is waited for. *Send now* (`send_now_at`) asks which games: their last 20, newest first, the week of their latest game
ticked to start with (0273 `send_now_games`, at most 12). The report is then drawn of those games alone (`p/?rpgames=`: the
section is **SELECTED GAMES**, from the first game's day to the last's), and the email lists them. When the games ticked are
every game of one week, that week is logged, so its Monday does not send it again. Before 0273, send now sends the week of
their latest game at the next run, as it did. One log row a week
(`report_mail_player_log`); the address carries what was last done (`last_at`, `last_detail`). Synergy profiles are handed to
the page as for every report. Until 0272 is applied the round is skipped and the console says so.

Tests: `supabase/tests/report-page-fit.test.mjs` (the engine), `supabase/tests/player-report-weekly.test.mjs` (the rest, in CI).
