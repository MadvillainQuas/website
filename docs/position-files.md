# Position files

Each finished game's minutes at each position are worked out once on a server and kept as a small file. A club page's depth chart reads those files rather than every lineup and the league's season line.

- **Where it lives:** `snapshots/pos/<game id>.json`, in Storage.
- **Who builds it:** the `snapshots` function (migration 0216), for every finished game a signed-out reader may read. These are the same games that get an event log file.
- **When it is rewritten:** when the game is finalised again. Lineups and box scores are only written by finalising, so nothing else can change a file.
- **The index:** `pos_files` (which game, from which finalisation). Only the service role can read it.

## What a file holds

```json
{ "v": 1, "game": "<id>", "f": "<finalised_at>",
  "t": [ { "<player id>": [box, PG, SG, SF, PF, C] }, { … } ] }
```

- `t[0]` is the home side, `t[1]` the away side.
- Every number is whole seconds:
  - `box` is the box score's minutes;
  - `PG` to `C` are the seconds the player spent at each position.
- A player with box minutes but no lineups is `[box, 0, 0, 0, 0, 0]`. A player who did not play is left out.
- A game is about 1.3 KB. Grupo Alega Cantabria's 2025/26 season (32 games) is 42.6 KB of files. The page used to read about 600 KB to draw the same chart: 334 KB of lineups for both sides, plus the last ten box scores.

## How a five is ranked

Every five on the floor is ranked point guard to centre with `t/depth.js`, the same code the page uses. The function runs a generated copy of it (`supabase/functions/_shared/depth.js`).

- **`posFile`** lays the stints out, exactly as `floorPos` does on the page.
- **`positionOf`** gives each player's position, from three sources:
  - the box-score estimate on the season line of the game's competition;
  - the roster's listed position;
  - the player's height.

The function uses the **latest season file** built for the competition (`data.js` `latestSeason`). It never sums a season itself. A game finalised a moment ago may be ranked by the line from just before it, which moves nobody.

## How the club page reads them

`epinoia/t/team.js` `depthShares`:

1. It asks for the newest three games' files first. If none exist, it asks for no more, so a members-only league's page costs three requests, not forty.
2. It sums the club's side of every file (`depth.js` `posFromFiles`). The result is the same as `floorPos` on the lineups, and the chart is identical (checked on Grupo Alega 2025/26, Season and Last 5).
3. **A game with no file yet** (finished in the last few minutes) is read from its own lineups, the club's side only. Its fives are ranked by where the files put each player: his minutes' average position, or else his listed position and height.
4. **A club with no file at all** (a members-only league, or before the files were written) is read the old way: the season line and every lineup.
5. **Who is out now** comes from the files' box minutes for the last ten games (`posLines`, read by `injuries.js`). A game without a file uses its lineups instead.

The box scores and the season line are now read only for the projected chart, which is used when a club has no lineups at all.

## How the player page reads them

The player profile's position breakdown (`p/player.js` `paintPosBreakdown`, `docs/player-profile.md`) reads the same files for the games of the season and competition shown, newest three first, and takes the player's own seconds at each position. Without any file it ranks the lineups he was in, as above.

## Deploying

1. Apply the migration: `npx supabase db push` (0216 creates `pos_files`).
2. Deploy the function: `npx supabase functions deploy snapshots`.

What happens next:

- The tick calls the function every five minutes while files are left to write. The function is not marked done until they are all written.
- Each call writes up to 120 files, newest games first. The platform's roughly 1,800 public finished games take about an hour and a quarter of ticks (15 calls).
- To go faster, POST `{}` to the function by hand, as many times as you like. It only writes what is missing or out of date.
- Until a club's files exist, its page reads the old way, so nothing is wrong in the meantime. It is only slower.

## Tests

- `supabase/tests/depth.test.mjs`:
  - a file's layout;
  - five on the floor;
  - files summed are the same as `floorPos` on the lineups;
  - files from another layout or another game are skipped;
  - the injury report reads `posLines` as it reads the box score.
- `supabase/tests/scale.test.mjs`: `posFiles` asks one file a game, at most `POS_LANES` at once, and answers null for a missing or mismatched file.
- `supabase/tests/snapshots.test.mjs`:
  - the function writes each file with `posFile` and `positionOf`, under `pos/<id>.json`;
  - it indexes the file, removes files for games that are gone, and is not done while any file is left;
  - 0216's table is the service role's alone.
- `supabase/tests/ww-fomodel.test.mjs`:
  - the profile's chart sums the files;
  - it reads the box scores and the season line only for the projection;
  - it reads only the club's own side of a lineup.
