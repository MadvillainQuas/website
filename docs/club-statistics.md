# The club page's team statistics

The **Team statistics** section of a club's page (`t/`). Its code is `t/team.js` (the section), `t/seasonline.js` (the season line) and `p/sos-chip.js` (the chips). Its look is `kit/clubstats.css` and `kit/soschip.css`.

## Beside the heading: ELO and schedule

Two chips sit under the title, as the player page's schedule chip sits under its own.

| Chip | What it says |
| --- | --- |
| **ELO** | The club's strength rating from its results (`sos.js` `eloRatings`: 1500 is an average team). Its rank among the clubs in the scope, in five bands from *weakest* to *elite*. Stronger is greener. |
| **Schedule** | The average ELO of the opponents it has faced, ranked the same way, from *easiest* to *hardest*. Harder is warmer. |

Both read the games the section already loaded, and both need three games. Tapping a chip opens one sentence on what it means.

## The season line

**The ratings come first, on a row of their own:** ORTG, DRTG and NET. Each shows:

- the number;
- its rank among the clubs;
- its gap to the league's average;
- a strip with every club on it: the club's own mark in its colour, the average as a tick.

Better is always to the right, so on the DRTG strip the lowest rating is on the right.

**Then one table, in four groups.** A row the season can rank has the value, the same strip, the rank and the gap to the average.

| Group | Row | How it is counted |
| --- | --- | --- |
| Tempo | **PACE** | Possessions per 40 minutes, both sides averaged. |
| | **AVG POSSESSION** | Game-clock seconds from winning the ball to the possession's last action (`shotclock.js`). The opponents' average is beside it. |
| Efficiency | **PPP** | Points per possession (ORTG ÷ 100). |
| | **TS%**, **FT%** | As everywhere else. |
| | **MOREY%** | The share of the club's shots taken at the rim or from three. Only where the league's box score splits the twos by zone. |
| Distribution | **AST%** | The share of the club's baskets that were assisted. |
| | **HELIOCENTRISM** | How much of the offence runs through one player, from 0 (five equal hands) to 100 (one player uses every play). This is the WOWY page's measure. Each player's usage is shared out within every five he played in, and the Herfindahl index of the shares is averaged over the fives by the plays they used. The top user, his share of the plays and his usage are beside it. |
| | **BENCH MINS%** | The share of the club's minutes played by those who did not start. It comes from each game's starters and the players' minutes. A side whose starters were never recorded is left out. |
| Against starters & bench | **VS STARTERS** | The club's NET, with its ORTG and DRTG, against the other side's starters (see the two splits below). Beside it: the gap to the club's NET over every minute, and the sample. |
| | **VS BENCH** | The same, against the other side's bench. |

**The two splits.** The reader picks one on the card; the choice and N are kept in this browser.

| Split | VS STARTERS | VS BENCH |
| --- | --- | --- |
| **Regular starters** (the default, index_9's VS Starters tab) | The other side has 4+ of its regular starters on, or 4+ of that game's starting five. A regular starter is a player with N games started or more for his club in the scope: 10 by default (index_9's since its V6.2), from 1 to 40 with the − and + on the card. Early in a season nobody has N starts yet; the card says so, and only that game's starting five counts. | Every other minute. |
| **Basic** | All five of that game's starters on. | Two of them or fewer. Three or four is "mixed", on the WOWY page only. |

The starts come from every game's starters in the scope's competitions (one small read). Changing the split re-splits the minutes already read; nothing is read again.

**From the play-by-play.** Four rows come from the club's own game logs, read the way the WOWY page reads them (`lineupevents.js`): the average possession, heliocentrism, VS STARTERS and VS BENCH. So these numbers are the WOWY page's own: one definition on the site.

- **Not ranked.** The other clubs' logs are not read on this page.
- **Members only**, as the shot clock analysis and the WOWY page's play-by-play are.
- **Read once.** The logs are read a game at a time, and each game is kept for the page's life.

Style rows have no good end: pace, the possession, MOREY%, AST%, heliocentrism and the bench. They are ranked by "most", drawn in one colour, and the ends of their strips say what each way means.

## Shot zones and what became of every shot attempt

**The shot zones.** One row per zone, then the larger cuts (the sides, the paint, jump shots, every shot). Each row shows:

- the club's share of its shots, as a bar;
- its attempts per 100 possessions and per game;
- its makes per game;
- its eFG%.

Each figure carries the club's rank among the clubs. Makes and eFG% are coloured green to red. Volumes are only a style, so their ranks are plain.

**What became of every shot attempt.** One bar per zone, for the club's own attempts and for the attempts against it. Every attempt ended one of four ways:

- it went in;
- it was rebounded by the shooter's side;
- it was rebounded by the other side;
- nobody rebounded it (a foul and free throws, a turnover, the end of a period).

The club's colour is the ball ending up the club's. Beside the bar are the FG% and the club's **ORB%** (its own misses) or **DRB%** (the opponents'). These are counted as the four factors count them: of the misses somebody rebounded, the share the club took (`rb_<zone>_orb` and `rb_<zone>_drb`, from `shotchart.js`). They are ranked once there are ten rebounded misses.

**The league table.** The same six rates are columns of the team table's **defence + rebounding** tab: SELF RIM/MID/3PT ORB% and OPP RIM/MID/3PT DRB%. They are members' columns, as every `rb_` column is (`access.js`).

**The events.** The events card is the player page's events panel (`sitpanel.js`), dressed like the tables above inside the club's card.

## The lineups: With or without, Lineup filter, Every lineup

These three sections are the WOWY / Lineups page's own views, drawn by its code (`stats/wowy/wowyui.js`). So they look and behave like that page, and its upgrades reach them. `t/teamwowy.js` does for one club what `stats/wowy/wowy.js` does for that page: it keeps the state, sums the records and builds what the views read.

| Section | The WOWY page's | What it is |
| --- | --- | --- |
| With or without | WOWY | Up to five players: every on/off arrangement of them, each its own line. |
| Lineup filter | Builder | Up to five players: that unit, every stat, against the rest of the team. |
| Every lineup | Lineups | Every unit of two to five players, as a table or as cards. |

**Every lineup:**

- **Sorting.** Pressing a header sorts by it, and pressing it again sorts the other way. The old list lit the header on hover, but it never sorted.
- **Colour.** Every stat is coloured by where it ranks among the league's units of that size. The colour is direction-aware: a low turnover rate is green. While the league's stints load, the club's own units are the reference, and the key says which.
- **Δ.** Each value's on/off delta: the unit minus the team's other minutes.
- **Filters.** Most used, best or worst net; a with/without filter on the player circles; the sample thresholds.
- **Layout.** The column picker (the WOWY page's own choice, shared with it) and cards or a table. A table where there is room; cards on a phone, where five names take half the width.
- **The rows.** A row opens on its split against the rest of the team. "Open in builder" and "Open in WOWY" go to those sections of this page.

**Against.** Every section has the WOWY page's switch: all minutes, or only those against the opponent's starters, a mixed five or its bench.

**The play-by-play** is the page's own read (`seasonLogs`), the one the shot chart and the season line use. It is never read twice.

**Who sees what** (`docs/memberships.md`):

- The club page has always shown every five and the lineup filter to everyone, and still does.
- What the WOWY page keeps for members stays members' here: the play-by-play columns, the opponent split, and units of two to four.
- The combinations take one player at a time (`CATALOGUE.wowyPreviewMax`), with the WOWY page's preview card.

**Kept on the device:** only what the reader changed: cards or table; values, deltas or both; the sample thresholds.

**The links.** "Copy link" and the link under each section open the WOWY page on exactly what is shown: this club, this season, that view, the sort. On / off, Pairs and Vs starters are there.

The page cannot load `kit/page.css`, because its `.topbar` and `.sec` would restyle this older page. So the two rules the views need from it, the switch and the empty box, are given to the lineups alone in `kit/teampage.css`.

## Phones

Every table is its own container. Below 560–600 px of its own width, every row becomes a card: the figures sit with their names, and the bars run across the width. The ratings stay on one row.

## Languages

The words are in Spanish and Japanese. The short ones have contexts of their own, so they do not clash with a page's pack: `seasonline`, `zonetable` and `soschip` in `i18n/es.js` and `i18n/ja.js`.

## Tests

`supabase/tests/seasonline.test.mjs` checks:

- the bench's minutes, MOREY% and the ranks, worked out by hand;
- the play-by-play summed through the real `lineupevents.js`, split both ways, with regular starters at different N;
- the split's control (basic and back, the games started, what this browser keeps);
- the card drawn on a stand-in document, with its late rows filling in;
- the ELO chip;
- ORB% and DRB% by zone;
- the table's columns;
- the page's wiring.

It runs in `guard.yml`, with `sos-chip.test.mjs`.

`supabase/tests/team-lineups.test.mjs` checks the lineups:

- the state a visit opens on, and who sees what;
- which sections a change draws again;
- the three sections mounted on made-up stints: the sort, the rest of the team, the league's reference;
- the jumps to the builder and the combinations, and the links;
- what is kept on the device;
- the page's wiring.

It runs in `guard.yml`, beside the WOWY page's own tests.
