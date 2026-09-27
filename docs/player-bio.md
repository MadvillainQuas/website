# Player bio: height, weight, age

Filled from what each league publishes, matched to the players the game feeds already made. Code: `scripts/ingest/bio.py` (the
rules), `bio_sources.py` (one reader per league), `bio_sync.py` (the command), weekly from `.github/workflows/bio.yml`
(Wednesday 06:20 UTC). Tests: `scripts/ingest/bio_test.py`, `supabase/tests/player-bio.test.mjs` (0184 on real Postgres),
`supabase/tests/ages.test.mjs` (the pages).

## What the site shows

* A player's **age** and **birth year** ("born 1996 · age 30"), the age moving by itself on his birthday.
* A club's **AGE** column and a **squad average** row (age, height, weight; each over the players who have that number, and how many).
* Never a date of birth. `players.birth_date` (migration 0184) is a column no browser can read: `players` has no table-wide SELECT
  (0171), so a new column is unreadable until granted by name, and this one never is (`-- SECRET-COLUMN` in the migration; the
  security sweep test holds every later migration to it). The only way an age reaches a page is `player_ages(ids)`, which returns
  ages and nothing else, and not for a withheld (minor, no consent) player.
* **Under 18: no date is ever stored, only the birth year.** A trigger drops a date that would make him a minor, whoever writes it.
  `is_minor` is never set by the bio job: that is a decision, not a roster fact.
* A hand-edited birth year with the date left alone clears the date (the date was wrong); a date makes the year its year.

## What the job writes

Blanks only. A height, weight or birth year a person typed is never replaced. A feed year that disagrees with the one on file is
reported (`~` lines) and left. A feed row that matches nobody, or two players, is left: by feed key first (EuroLeague person code,
FEB / BBL / ABA / 2. Bundesliga / B.LEAGUE / WJBL player ids are the game feed's own player keys), otherwise by the shared matcher
(surname, forename, club), accepting only an outright match.

```
python scripts/ingest/bio_sync.py --worker-config --dry-run              # every league with a reader; writes nothing
python scripts/ingest/bio_sync.py --worker-config --league euroleague    # one league
python scripts/ingest/bio_sync.py --worker-config --dry-run --verbose    # also print feed rows that matched nobody
```

Until 0184 is pushed (`npx supabase@latest db push`) the job writes birth years only and says so.

## Sources (found 2026-09-27; match counts are of the players already on the site that day)

| league (slug) | source | gives | dry run |
|---|---|---|---|
| euroleague | incrowdsports people feed | date, height, weight | 239 / 239 |
| eurocup | same feed | date, height, weight | no players on the site yet |
| basketligaen | Sportality API: roster per club, athlete page per new player | date, height, weight | 150 / 155 |
| lega-basket-serie-a | legabasket.it API, roster per club | date, height, weight | 72 / 72 |
| lnb-elite, lnb-elite-2 | api-prod.lnb.fr `teams/getRoster` | date, height (no weight) | matched; **refuses a GitHub runner: run from home** |
| nbl, wnbl, nbl1-men, nbl1-women | rosetta `/get/<org>/players/in/season/<year>` | date, height, weight (NBL1 seldom height) | nbl 131 / 132; others: no players yet |
| bbl | easycredit-bbl.de club pages (page data) | date, height, weight | 219 / 219 |
| proa, prob | 2basketballbundesliga.de Kader pages | date, height, weight | 151 / 153, 175 / 175 |
| czech-nbl | nbl.basketball club pages | date (bare year for some minors), height | 146 / 150 |
| liga-endesa | acb.com player pages (page data), squads from plantilla | date, height | matched |
| primera-feb (+ segunda-feb, liga-femenina-endesa, liga-femenina-2, liga-femenina-challenge, liga-u) | baloncestoenvivo.feb.es club pages | date, height, weight where given | 178 / 186 |
| b-league-premier, b-league-one | bleague.jp player page, by the league's PlayerID | date, height, weight | matched |
| w-league-premier, w-league-future | api.wjbl.01core.app `/player` | date, height, weight | no players yet |
| aba-league, aba-league-2, aba-u19-league | aba-liga.com club pages | date, height | no players yet |
| bnxt-league | box scores (`birthdate` per player) | date only, 40 games read | no players yet |

## Not done, and why

* **Genius Sports hosted leagues** (SLB men and women, WBBL, Kvinde Basketligaen, other Genius clients): the person pages have an empty
  "Player Profile" on the two tenants checked. No bio anywhere in the feed.
* **EuroLeague-style Sportradar EUI** (Bulgaria): roster rows carry no bio.
* **PLK, 1LM, 1LK** (Poland): the game JSON has none and no player endpoint was found under `plk.pl/api/webpage` or the Puls Basketu API.
* **Slovak SBL**: player pages give height, weight and an **age**, not a date: a birth year from an age is right only to within a year,
  so it is not written.
* **Finland (basket.fi TorneoPal)**: `getPlayer?player_id=` gives a birth year (and often height 0), but no roster call lists the ids.
* **LKL, NKL, Kosovo, Greek Elite (stats.basket.gr), U SPORTS, Mexico (CIBACOPA, LNBP)**: not probed to a working page; U SPORTS club
  pages carry height, weight and class year only.

## Adding a league

Write a reader in `bio_sources.py` yielding `{first, last | name, team, key?, height_cm?, weight_kg?, birth?, birth_year?, detail?}`,
register it under the league slug, dry-run it against the live site (`--dry-run`), and check the matched count against the number of
players on the site. A reader takes `players=` (the league's players) and `teams=` (its clubs with the feed's own club id) if it needs them.

## The stats tables

Every player stats table (a league's, the Statistics page, global scouting) has **AGE, HT, WT** right after the name, in every
preset, outside the column drawer and not sortable-away (they sort like any column; a blank sinks). They are `epinoia/fulltable.js`'s
`BIO_COLS`, filled by `player_bio(ids)` (migration 0185): one call per 500 players, kept in the browser for half an hour
(`epinoia/ages.js loadBio`). Before 0185 is pushed the columns show dashes. A career table (one person) and a team table have none.

**Each column only where there is something to put in it.** The tables (and a club's roster) decide AGE, BORN, HT and WT one by one
from the players they hold (`epinoia/ages.js bioColumns`): AGE where the database gives an exact age (a date of birth, 0184/0185);
BORN, showing the year, where there are birth years but no exact ages - a year is never turned into an age that could be a year
out; HT and WT where anyone has one. A league whose feed gives nothing gets none of the columns. Where some players have an exact
age and others only a year, the column is AGE and the year-only ones read `~30`. The roster also drops WING and PREVIOUS CLUB when no
one has them; a manager signed in to edit still gets every measurement box. `player_bio()` returns `birth_year` alongside the age
for this (0185, dropped and re-created because its result columns changed).

**Before 0185 is applied**, the table columns still work: `player_bio()` 404s once, and `epinoia/ages.js` falls back to a plain read of
`players.height_cm/weight_kg/birth_year` (public columns since 0033/0002, and `players_read`, 0049, already keeps an under-18 out of
that read entirely). That read gives the birth year rather than an age, so until 0185 is live the tables show BORN; once it is, a league with dates of
birth shows AGE.
