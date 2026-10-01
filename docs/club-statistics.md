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
| Against starters & bench | **VS STARTERS** | The club's NET, with its ORTG and DRTG, in the minutes the other side had all five of its starters on. Beside it: the gap to the club's NET over every minute, and the sample. |
| | **VS BENCH** | The same, in the minutes the other side had two of its starters on, or fewer. (Three or four is "mixed", on the WOWY page.) |

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

## Phones

Every table is its own container. Below 560–600 px of its own width, every row becomes a card: the figures sit with their names, and the bars run across the width. The ratings stay on one row.

## Languages

The words are in Spanish and Japanese. The short ones have contexts of their own, so they do not clash with a page's pack: `seasonline`, `zonetable` and `soschip` in `i18n/es.js` and `i18n/ja.js`.

## Tests

`supabase/tests/seasonline.test.mjs` checks:

- the bench's minutes, MOREY% and the ranks, worked out by hand;
- the play-by-play summed through the real `lineupevents.js`;
- the card drawn on a stand-in document, with its late rows filling in;
- the ELO chip;
- ORB% and DRB% by zone;
- the table's columns;
- the page's wiring.

It runs in `guard.yml`, with `sos-chip.test.mjs`.
