# The Transfer matrix's data: rebuilding and uploading

The Transfer matrix (`/epinoia/scouting/transfer/`) and the league adjustments in compare and on the player profile work
from two files built from the scraped player-stats files. **Neither is ever published.** They are built locally,
uploaded to the private `analytics` bucket, and handed out only by the `analytics-file` function to a signed-in reader the
`transferMatrix` gate lets in (migration 0265; docs/memberships.md §10).

| scope | object in the `analytics` bucket | what | read by |
|---|---|---|---|
| `transfer` | `transfer/<token>.bin.gz` | every player-season, the store the page computes from (binary, `TMS2`, gzipped) | the Transfer matrix page |
| `tscale` | `tscale/<token>.json.gz` | the league scale at the page's defaults (JSON, gzipped) | compare, the player profile |

`<token>` is the first 20 hex digits of the SHA-256 of the gzipped file, so the same data always has the same name and a
reader's copy on their device (transferdata.js keeps one, by token) stays good until the data changes. Each scope has one
index row in `analytics_files`: league `all`, season `current`, team `''`.

## Rebuilding (when the player-stats files change)

```
cd /d C:\Users\Admin\Documents\website_repo
node tools\build-transfer.mjs
```

It reads `transfermatrix\player_stats*.csv` (or `--src <folder>`), merges them as the old standalone app did, and writes
`transfermatrix\build\`: `transfer.bin.gz`, `tscale.json.gz` and `manifest.json` (tokens, sizes, layout). That folder
is in `.gitignore` and `transfermatrix/` is on build-site.py's never-publish list, so nothing built is committed or
published. `--dry` builds and reports without writing. The tool refuses to write into a folder the site is published from.

It prints the sizes and how far the store's two decimals move the scale from the CSVs' own numbers (a hundredth at most).

## Uploading

```
cd /d C:\Users\Admin\Documents\website_repo
node tools\upload-transfer.mjs --dry-run
node tools\upload-transfer.mjs
```

The key: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in the environment, else `supabase_url` and `service_key` from
`%APPDATA%\epinoia\worker.json`. It is never printed.

`--dry-run` checks the files against the manifest, reads the two index rows and says what it would do; it writes
nothing. The real run, for each file: checks the database knows the scopes (it stops, writing nothing, until 0265 is
applied), uploads the object (`application/gzip`, `private, no-store`), **then** writes the index row, then deletes the
scope's older objects **except the one the row named until now** (a reader handed a two-minute URL for it a moment ago
still gets it; the next upload removes it). The same build again does nothing (`--force` uploads anyway).

## First deployment, in order

1. `supabase db push` (migration 0265: the gate row, the two scopes, `application/gzip` in the bucket, `analytics_check`).
2. `npx supabase functions deploy analytics-file --no-verify-jwt` (`_shared/analyticsfile.ts` knows the two scopes).
3. `node tools\build-transfer.mjs`, then `node tools\upload-transfer.mjs --dry-run`, then `node tools\upload-transfer.mjs`.
4. Publish the site (the page and transferdata.js).

Until steps 1-3 are done, a member who opens the page is told the player data is not available just now (the function
answers `scope` before 0265 and the deploy, `none` before the upload); nothing breaks and nothing is exposed.

## What a reader's browser does

`EpinoiaTransferData.load('transfer' | 'tscale')` (epinoia/transferdata.js): signed out, it asks nothing. Signed in, it
asks the function, and downloads the file only when the token it is given is not the one already kept on the device
(IndexedDB `epinoia_transfer`, one entry per account and file, removed on sign-out, on a refusal, and for any other
account). Within ten minutes of the function's last yes for that account and file it uses the kept copy without asking
(What wins' own window), so a reader going from profile to profile is not counted against the function's hourly limit
(60 an hour signed in) at every page; a membership that ends is honoured on that device within those ten minutes. The
page shows the membership placeholder for `members`, asks the reader to sign in again for `signin`, and says so plainly
for `rate`, `none` and an old browser.

## Sizes (2026-10-15 build)

The store is 1.85 MB gzipped (3.89 MB unzipped; the JSON layout it replaced was 2.52 MB gzipped), the scale 0.19 MB
gzipped. engine.js documents the store's layout (`encodeStore` / `decodeStore`); tools/build-transfer.mjs documents the
scale's schema and the rule for adjusting a stat with it.

## Tests

```
node supabase\tests\transfer-matrix.test.mjs     the engine, the store, the build (and transfermatrix\build\ when present), the page
node supabase\tests\transfer-gate.test.mjs       analytics_check for the two scopes, and every other scope unchanged (PGlite)
node supabase\tests\ww-function.test.mjs         the function: the two scopes, no league, no refresh
node supabase\tests\transfer-data.test.mjs       the loader
node supabase\tests\transfer-upload.test.mjs     the upload, against a stand-in project
```
