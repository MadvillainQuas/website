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

## Players not on the site yet (0186)

A league publishes its rosters before its first game; the ingest makes a player only when he is in a box score. So a feed row that
matches nobody (and carries a height, weight or birth) is kept in `player_bio_pending`, one row per person per league (by the feed's
key, else name + club). Every later pass offers the kept rows to the players made since, by the same matcher and rules, and deletes a
row once it has found its player. A league not on the site at all yet (no game ingested) is read too: all its rows are kept.

* Same privacy as `players`: an adult's date, a minor's year only (a trigger holds it), service role only (RLS, no policy, no grant).
* `bio_sync.py --stash-only` reads no feed and only hands out kept rows: the workflow runs it **daily at 07:40 UTC**, so a new player
  has his bio the day after his first game. The weekly pass reads the feeds and keeps what is new.
* A row nobody claims for 18 months is dropped. A player not on the site costs a detail page too (at most 200 a league per pass).
* Until 0186 is pushed, the job says so and runs as before (nothing kept).

```
python scripts/ingest/bio_sync.py --worker-config --stash-only           # give kept rows to new players; no feed read
python scripts/ingest/bio_sync.py --worker-config --no-stash             # neither keep nor offer
```

## Sources (found 2026-09-27; match counts are of the players already on the site that day)

| league (slug) | source | gives | dry run |
|---|---|---|---|
| euroleague | incrowdsports people feed | date, height, weight | 239 / 239 |
| eurocup | same feed | date, height, weight | no players on the site yet |
| basketligaen | Sportality API: roster per club, athlete page per new player | date, height, weight | 150 / 155 |
| basketligan, basketligan-dam | the same Sportality API on sblherr.se / sbldam.se | date, height (often), weight (seldom) | feed read: 140 / 108 rows |
| lega-basket-serie-a | legabasket.it API, roster per club | date, height, weight | 72 / 72 |
| lnb-elite, lnb-elite-2, lnb-espoirs-elite, lnb-espoirs-elite-2 | api-prod.lnb.fr `teams/getRoster` (divisions 1-4) | date, height (no weight; Espoirs ~40% height) | matched; **refuses a GitHub runner: run from home** |
| nbl, wnbl, nbl1-men, nbl1-women | rosetta `/get/<org>/players/in/season/<year>` | date, height, weight (NBL1 seldom height) | nbl 131 / 132; others: no players yet |
| bbl | easycredit-bbl.de club pages (page data) | date, height, weight | 219 / 219 |
| proa, prob | 2basketballbundesliga.de Kader pages | date, height, weight | 151 / 153, 175 / 175 |
| czech-nbl | nbl.basketball club pages | date (bare year for some minors), height | 146 / 150 |
| czech-zbl | zbl.basketball club pages (the same layout) | date (bare year for some minors), height | feed read: 10 clubs |
| czech-1-liga | cz.basketball: the competition by name, each club's squad tab | birth YEAR as printed, height where entered (no date) | feed read: 21 clubs |
| liga-endesa | acb.com player pages (page data), squads from plantilla | date, height | matched |
| primera-feb (+ segunda-feb, liga-femenina-endesa, liga-femenina-2, liga-femenina-challenge, liga-u) | baloncestoenvivo.feb.es club pages | date, height, weight where given | 178 / 186 |
| b-league-premier, b-league-one | bleague.jp player page, by the league's PlayerID | date, height, weight | matched |
| w-league-premier, w-league-future | api.wjbl.01core.app `/player` | date, height, weight | no players yet |
| aba-league, aba-league-2, aba-u19-league | aba-liga.com club pages | date, height | no players yet |
| bnxt-league | box scores (`birthdate` per player) | date only, 40 games read | no players yet |
| slb-men | Genius hosted: competition roster page per club | date, height, weight | feed read: 217 rows |
| slb-women | Genius WBBL roster pages | date, height | feed read: 127 rows |
| bcb | Genius HBBC roster pages | height, a little weight (age only, never used) | feed read: 298 rows |
| eabl, nbl-d1, wnbl-d1, weabl | Genius BBE roster pages ("Surname, Forename") | height only | feed read |
| kvinde-basketligaen | Genius DAM roster pages | height only | feed read: 125 rows |
| cibacopa | Genius CIBA rosters (date) + cibacopa.mx `/api/public/players` (height, weight, full name), joined on the Genius person id | date, height, weight | feed read: 363 rows |
| korisliiga, naisten-korisliiga, i-divisioona-a, i-divisioona-b | TorneoPal `getTeams` + `getTeam` | birth YEAR (as printed), height | feed read: 151 / 87 / 101 / 205 rows |
| slovak-sbl | club Súpiska (Roster) tab; player page for height/weight | date; height and weight on ~25% | feed read: 346 rows |
| nbl-bulgaria | nbl.basketball.bg player search per club; player page | date, height, weight (Cyrillic, transliterated) | 2025/26: 165 rows |
| greek-elite-league | stats.basket.gr player page by the feed's GUID, only for players without a date | date only | 6 / 6 sampled |
| lkl | lkl.lt/zaidejai/<slug>, by the slug the feed keys him by | date, height, weight | 89 / 89 sampled |
| nkl | nkl.lt club pages; player page for the date | date, height, weight | feed read: 176 rows |
| orlen-basket-liga | rozgrywki.pzkosz.pl club pages (league 2), keyed: the federation id is the PLK feed's player id | date, height | feed read: 280 rows |
| 1-liga-mezczyzn, 1-liga-kobiet | rozgrywki.pzkosz.pl club pages (leagues 1, 16) | date, height | feed read: 315 / 598 rows |
| lnbp | Sportradar EUI embed players list, keyed by the box score's personId | height, weight (~75%), date (~25%) | feed read: 482 rows |
| u-sports | each university's roster page (PrestoSports / Sidearm), 39 of 48 clubs; feet-inches and lbs converted | height, weight where printed | feed read: 755 players |

"feed read" = read live on 2026-09-27, not yet dry-run against the site's players (run `--dry-run` to see the match counts).

## Not done, and why

`bio_sources.NO_BIO` names every ingested league without a reader, with its reason; `bio_test.py` fails when a league is
added to the ingest with neither.

* **estonian-latvian-basketball-league**: estlatbl.com and basket.ee disallow every crawler but the search engines in
  robots.txt; the permitted portal (online.basket.ee) lists games and box scores with no bio, and neither does LiveStats.

* **kosovo-superliga**: basketbolli.com lists players by name and licence number only; no player page, no bio in the LiveStats data.
* **Ages are never used**: HBBC, Basketball England, DAM, Slovak player pages and NKL print an age; a year from an age is right only to
  within a year, so it is not written.
* **No weight anywhere**: LNB, Poland (plk.pl, the federation site, Puls Basketu), Basketball England, DAM, WBBL.
* **U SPORTS**: no club publishes a date (class year only, not used). Cape Breton, Dalhousie, Lakehead, Laval, Ottawa, UQAM have no
  roster page with heights; Algoma, Nipissing, Brandon print none yet.
* **Genius person pages** are empty; the competition's roster page is what is read.

## Adding a league

Write a reader in `bio_sources.py` yielding `{first, last | name, team, key?, height_cm?, weight_kg?, birth?, birth_year?, detail?}`,
register it under the league slug, dry-run it against the live site (`--dry-run`), and check the matched count against the number of
players on the site. A reader takes `players=` (the league's players) and `teams=` (its clubs with the feed's own club id) if it needs them.

## The stats tables

Every player stats table (a league's, the Statistics page, global scouting) has **AGE, HT, WT** right after the name, in every
preset, outside the column drawer and not sortable-away (they sort like any column; a blank sinks). They are `epinoia/fulltable.js`'s
`BIO_COLS`, filled by `player_bio(ids)` (migration 0185): one call per 500 players, kept in the browser for half an hour
(`epinoia/ages.js loadBio`). Before 0185 is pushed the columns show dashes. A career table (one person) and a team table have none.

**Before 0185 is applied**, the table columns still work: `player_bio()` 404s once, and `epinoia/ages.js` falls back to a plain read of
`players.height_cm/weight_kg/birth_year` (public columns since 0033/0002, and `players_read`, 0049, already keeps an under-18 out of
that read entirely). Age is then last-birth-year-to-this-year, the same approximation `t/team.js`'s staff list has always shown; once
0185 is live it is replaced by the exact, date-of-birth-driven age.
