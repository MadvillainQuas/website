# Season files

A competition's season lines (every player's and every club's) are summed once on a server and kept as a file. Pages read the file rather than every box score.

- **Where it lives:** `snapshots/season/<competition id(s)>/v3-<version>-<token>.json`, in Storage.
- **Who builds it:**
  - the `snapshots` function, for competitions up to 800 finished games;
  - `tools/build-seasons.mjs`, in the `big-seasons.yml` workflow, for bigger ones.
- **The token:** how many games are finished, and when the last one was finalised. A new final is a new token, so a new file.
- **The browser's copy:** each page keeps the season under `epinoia_season_v3:<version>:<ids>` for six hours.

## The version

`<version>` says which code summed the season. It is `EpinoiaSeason.version()` in `epinoia/season.js`, and has two parts:

- **`MATHS`:** a number bumped by hand when a formula changes without adding a key.
- **A fingerprint:** of the keys a player's and a club's line carry. Adding a statistic adds a key, so it changes the fingerprint by itself.

A page reads only a file, or a copy, with its own version. With any other version, the page sums the season from the box scores itself. That is slower, but the numbers are right.

## Why

Before 1 October 2026 a file was trusted on its token alone. The `snapshots` function had not been deployed since several statistics were added to `season.js`, and its files kept being served until each league's next final. LNBP's file had none of these:

- the four shot volumes (RIM, MID, 3P and FT ATT / 100);
- TEAM SPACING;
- ORB% ON TEAM MISSES;
- DEF RIM FG% ±;
- FOULS CONCEDED / 30.

So the player profile showed a dash for each of them. Its other numbers (ranks, league averages) came from the older code too.

## When you change `season.js`

1. If the change alters a formula but adds no key, bump `MATHS`.
2. Run `node supabase/tests/extract-shared.mjs` so the function's copy matches the page's.
3. Deploy the function: `npx supabase functions deploy snapshots`.

What happens next:

- **Pages sum the season themselves** until the new files exist.
- **The function rebuilds every file under the new name.** Its tick calls it at the next final, or within the hour. Each call builds up to six seasons, and the tick keeps calling every five minutes until none are left.
- **Big competitions are rebuilt** by the hourly workflow, which runs the repository's code.

## Tests

`supabase/tests/snapshots.test.mjs` checks:

- the name and the copy's key carry the version;
- a file from other code is never read;
- the version follows the line's keys;
- every bar on the player profile is one of those keys.
