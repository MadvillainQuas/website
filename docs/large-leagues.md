# Large leagues (NCAA, Tercera FEB)

What changes when a league is big, why, and how to add one. Introduced 30 Sep 2026.

## How big is big

In September 2026 the biggest competition on the platform had **240** finished games, and the
whole platform 1,320. An NCAA Division I season is about **5,800 games** and 140,000 player rows;
Tercera FEB (the FEB's fourth tier, on the same live-score system as Primera and Segunda FEB) is
thousands of games across its groups.

Three things did not survive that size:

| | normal league | NCAA season |
|---|---|---|
| the season's player rows, trimmed, read by a page when no season file is current | 1–5 MB | **112 MB** |
| the snapshots function summing a season (it has about 2 s of CPU a call) | 0.15–0.3 s | **~7 s** |
| raw payloads committed to `data/feed/<CODE>/games/` (370 KB a game) | tens of MB | **2 GB** |

`epinoia/data.js` `BIG_GAMES` (**800** finished games in a competition, or in a league season's
competitions together) is the line. Every league on the platform in 2026 is well under it, and
nothing about those leagues changes.

## What happens past the line

**Season lines are built on a server, hourly.** `.github/workflows/big-seasons.yml` runs
`tools/build-seasons.mjs` at :25 every hour. It sums each big competition with the pages' own
code (`data.js`, `season.js`, `bpm.js`), reading as a signed-out visitor (publishable key, every
policy applying). It reads forty games at a time, four batches ahead. Each batch is added to the
running sums and let go (`season.js` `addPlayers` / `addTeams`), so the season's rows are never
all in memory.

It writes the same packed file the snapshots function writes for every other season, with the
same index row in `public.snapshots`. The snapshots function leaves big competitions alone. A
dry run says what it would build:

```sh
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/build-seasons.mjs --dry-run
```

**A page never reads a big competition's rows.** `data.js` `season()`:

- Knows the size from the token's count before it lists a single game.
- Takes the current file when it exists.
- Otherwise takes the latest file built. The season comes back with `stale: { builtAt, token }`,
  and the Statistics page says "As of …".
- Before the first build, returns an empty season with `building: true`, and the Statistics page
  says so.
- Refuses a caller that keeps the rows (the injury wire skips such a league) and a builder that
  is not allowed big ones.
- Hides the RAPM button on the Statistics and league pages past the line: it reads every game's
  event log.

**A big league's payloads stay out of git.** Give its source `"repo_feed": false`, either at the
top level of its row in `config/ingest-sources.json` or in `adapter_config` for a
`schedule_sources` row. The ingest then writes no payloads or index to `data/feed/<CODE>/`
(`run_ingest.repo_feed_of`). Supabase remains the record of what is done (`external_games`), and
every payload is still stored in the `feed` bucket, as every source's already is.

## Adding one

1. **The adapter.**
   - *Tercera FEB:* the FEB adapter already reads it (`scripts/ingest/adapters/feb.py`,
     competition `3`, slug `tercerafeb`). Each group is one request, and fixtures carry their
     group.
   - *NCAA:* needs an adapter for whichever source is chosen. There is no public FIBA LiveStats
     feed.
2. **The source row**, with `"repo_feed": false`. For Tercera FEB, copy a Segunda FEB row and
   change `code`, `label`, `competition: 3` and the schedule URL. `scripts/ingest/feb_test.py`
   holds "no Tercera FEB" today, so change that line in the same commit.
3. **Groups or conferences** (`docs/conferences.md`): `competitions.format = 'groups'` for
   Tercera FEB's groups; `'conferences'` and a `config/groups/<league>.json` for NCAA conferences.
4. **Crests**: the ingest copies each club's crest on sight (the snapshots function's
   `buildCrests`), as for every league.
5. **The first season file** arrives within the hour of the first finals. Until then the
   Statistics page says it is being built. Run the workflow by hand
   (**Actions → Big seasons → Run workflow**) to have it at once.

## What is still heavy for a big league

- **The live lane** polls one host at a time with a gap between requests. A hundred games live
  on one host at once (a college Saturday, Tercera FEB's weekend) is a cycle of about 30 s rather
  than 10. Games are still finished correctly by the catch-up.
- **Strength of schedule and the ELO column** read every finished game's scores and team lines:
  about 5 MB and 0.6 MB of JSON for an NCAA season, on the tabs that show them.
- **Global scouting** reads each league's season file. An NCAA file is several MB (about 2 MB
  compressed) the first time.
