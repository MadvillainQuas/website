# Similar players

The player profile's **find similar players** button (left of *expand all*, in the league percentile bars' row) slides
the percentile bars off to the left and a list of the player's twelve nearest matches in from the right. Each match
opens to the measures it was made on, the two players side by side on the pool's own scale.

## Who and what

* A line is comparable with **four games or fifty minutes**; below that the button is switched off.
* The pool is every comparable player-season of every competition with a public season file (members-only leagues have
  no file and are not in it). The same person under another competition's profile is skipped by name.
* Three groups, scored apart and then together (45 / 30 / 25): **style** (usage, assists per usage, rim / mid-range / three
  as a share of attempts, free-throw rate, assisted share of rim / mid / three makes and of points, half-court and
  transition shares, and the share of minutes at each of PG, SG, SF, PF, C), **efficiency** (TS%, rim / mid / three / FT
  accuracy, turnover rate, assist-to-turnover) and **rebounding and defence** (OREB%, DREB%, steal%, block%, fouls
  per 30, defensive rating and opponent eFG% with the player on against off).
* Rates over few attempts are pulled toward the pool; a measure one side lacks (a league with no play-by-play has no
  assisted or situation shares) sits out for that pair; a group with under 40% of its weight in common is not scored.
* The twelve shot zones are **not** compared: they need the shot logs, which the season line does not carry. They would
  be one more entry in `FEATURES` (epinoia/similar.js), built from the event files, weighted below the three distances.
* Minutes at each position come from the lineups (`lineup_stints`) the way the club page does it when a game has no
  position file (t/depth.js `floorPos`); the per-game position files are not published yet, and the builder does not
  need them.

## How it is built and served

`tools/build-similar.mjs` reads the public season files, works every neighbour out once, and writes
`snapshots/similar/v1/<competition id>/<player id>.json` (about 4 KB each, about 16 MB for 3,600 players).
`.github/workflows/similar.yml` runs it daily with `--upload` (the service key only writes). A profile reads exactly one file.

    node tools/build-similar.mjs --out <dir> --report      build locally, print the scale and coverage of each measure
    SUPABASE_SERVICE_KEY=... node tools/build-similar.mjs --upload

A new feature list or file layout is a new `VERSION` in epinoia/similar.js: it is a new path, so no browser reads an old
file as a new one. Percentages are `exp(-(D/tau)^2)` with tau from the pool's own median distance, so they follow the
pool as it grows; read them as "how alike", not as a probability.

To try the page against local files: build with `--out .cache/simtest`, serve the repo (`python tools/devserver.py`) and
set `EPINOIA_CONFIG.similarBase = location.origin + '/.cache/simtest/'` in the console before pressing the button.
