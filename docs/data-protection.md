# Who can reach what (written 2026-09-30)

**The policy.** Scraping what a page shows (a table, a box score) is tolerated. Not tolerated: (1) the API or the raw
data streams without a paid plan, (2) AI training crawlers. Claude fetching a page for the owner is allowed.

## Done
- **The website is an allowlist of `epinoia/`** (`tools/build-site.py`). The older Prophesy tools, `/data`, `/config`
  (including `config/users.json`, sign-in hashes), `/league`, `/transfermatrix` and `/share` are no longer published and are on
  the never-publish list; the build refuses to finish if any turns up. 561 MB -> 25 MB.
- **The repo no longer holds** the old datasets (`data/data_*`, `data/player-stats`, `data/shortlist-saves`, `data/latest.json`),
  the old accounts file and the old tools' config. The ingest no longer builds or commits datasets. It still commits its own
  state, `data/feed/`, and `config/ingest-sources.json` (the source list) stays in the repo.
- **robots.txt** disallows AI-training and bulk crawlers by name and allows `Claude-User` / `Claude-SearchBot`. robots.txt is
  a request: only honest crawlers read it.

## Not done, and why (needs the owner)
1. **The repository is public** (github.com/MadvillainQuas/website). Everything above that was ever committed is still in
   its history (old datasets, the password hashes, the source list, the code). Deleting files does not remove history. Only
   making the repo private, or rewriting history and force-pushing, does. Pages from a private repo needs GitHub Pro.
   **Change any password that was ever used for the old tools' sign-in.**
2. **The database API is open by design, for what the pages themselves show.** The pages read Supabase directly with the
   public anon key (it has to be in the page), so a scraper can page through the play-by-play (`game_events`, which the box
   score is built from), standings and box-score lines, and the realtime stream, with no plan. Tables are tolerated; what
   is *not* is the ready-made premium data and bulk feeds, which is what item 3 is.

## Built (migration 0190, 2026-09-30): the events splits are enforced by the database
`stats.sit` (second chances, transition, off turnovers, after timeouts, half court, assisted baskets: every ev_ figure on
the site) used to sit in the box-score jsonb anyone could read; the membership lock only hid it on screen. Now:
- `game_sit_lines` holds those lines. Its read policy is "may you read this game" AND `game_analytics_ok(game)`, which is the
  site's own rule (`can_use_analytics`, 0117): open for everyone while `memberships_enabled` is off, open for a league whose
  analytics are free, otherwise members and that league's administrators only. The service role still reads everything.
- A trigger on `player_game_stats` / `team_game_stats` files any written `sit` in that table and strips it from `stats`, so
  finalise-game, the situations backfill and any future writer are covered without changing them.
- `data.js` asks for the lines with the reader's own session and puts them back on the rows, so a member, a free league, and
  everybody while memberships are off see exactly what they saw before; a reader the database refuses gets none.
- When the master switch changes, a trigger drops the public season snapshots (0152 builds them as a signed-out reader and
  they hold ev_ figures); `select public.premium_snapshots_purge()` does it by hand after a league's analytics plan changes.
- CSV is built in the browser from what the reader may see, so it needs no server rule of its own: a reader the database
  refuses cannot put the refused columns in a file.

**Runbook (order does not matter for safety; the site works before, between and after):**
1. `npx supabase db push` (applies 0189, loss = 0, and 0190).
2. Actions -> "Move the events splits into the members' table" -> Run. Until it finishes, rows it has not reached still carry
   their `sit` in the open table (`select public.premium_sit_remaining()` says how many; it needs the service key).
3. Nothing else changes while memberships are off. To try the gating: switch `memberships_enabled` on in the platform
   console; `localStorage.epinoia_access_sim = 'locked'` previews the screen only.

## Still open, and what only the edge can do
- **The play-by-play stays public**, because the box score is built from it; anyone can rebuild the splits from it with the
  engine, slowly. That is a scraping-rate question, not a row-policy one.
- **Rate limits and bots.** Supabase has no per-IP limit on `/rest/v1`. Put the API behind a proxy that has one (Cloudflare with
  a custom domain for the project, rate-limiting rules on `/rest/v1/*` and `/realtime/*`, Bot Fight Mode / Turnstile), or
  serve bulk reads through a rate-limited Edge Function. Neither can be done from this repository.
- **The paid API** is the keyed Edge Function (`/functions/v1/api`, per-key rate limit); its keys are issued on request.
- **Known small gaps:** `scripts/backfill_situations.mjs` compares against `stats.sit`, which is now empty, so it rewrites
  every line (harmless, and the trigger files it); a rewrite that omits a player's `sit` no longer removes his old line.

## What wins: the feature table and the members-only files (migration 0211, 2026-10-01)
What wins and the Front office's win model (docs/what-wins-model.md) are the ready-made analysis, so they are protected
where the box score is not. The rule is the site's own (`can_use_analytics`, 0117), asked by the database at request time.

**What is gated, and where**
- **`game_features`** (every finished game as 108 counts a side, plus each side's stints): RLS on, no policy, nothing granted
  to anon or authenticated. Only the service role reads or writes it: finalise-game, `scripts/backfill_features.mjs`, the
  builder (`tools/build-analytics.mjs`) and the analytics-file function (the RECALCULATE delta and the pending count).
- **The `analytics` bucket** holds the built files (`wins`, `fo`, `club`, `pos`, the private `store`, `priors`). It is
  private and has no `storage.objects` policy at all. The store (feature lines, player lines, stints, the withheld-player
  list) lives only there: the analytics workflow keeps NO Actions cache of it (a public repository's cache can be restored
  by other workflow runs, a fork's pull request included), and a local builder run's mirror in `.cache/` is git-ignored. A file leaves it only as a 120-second signed URL from the
  `analytics-file` Edge Function, and only after `analytics_check` (run with the CALLER's own token) answers ok and
  `analytics_take` (service role) has counted the request. The index (`analytics_files`), the issue log
  (`analytics_issue_log`) and the refresh table (`analytics_refresh`) are service-role only.
- **What the files hold**: aggregates and per-club lines. No player names, no withheld player (`is_minor` without
  `public_consent`: the builder reads the list for every player of the unit; RECALCULATE reads it again from `players` for
  every player the store and the new games name, so a debut or a withdrawn consent since the last build counts, and runs
  the builder's `validate()` on every file before uploading, leaving the unit to the scheduled build on any problem), no
  per-game feature vector, a club file only that club's games, every block at least 8 games. The
  pooled file has per-league rows only for leagues whose analytics are free and open (`analytics_open_leagues()`).
- **Public by design**: the teaser (`snapshots/whatwins/`, about 2 KB) holds box-score aggregates of the public measures for
  open, free-analytics leagues only. The play-by-play, box-score tables and `lineup_stints` stay public as before, so a
  determined scraper can rebuild the features slowly; that is the edge question below, not a row policy.
- **In the browser**: the files are cached in memory and sessionStorage keyed by the user, never localStorage; another
  account signing in (or signing out) clears them: on a page with the loader at once, and wherever it happened (the
  sign-in page, the app shell, admin, the rail) `epinoiaSignOut` removes every `epinoia_ww:` key and the loader's first
  request on the next page (after `sessionReady()`) sweeps every key that is not the current user's; a download still
  in flight then is dropped, never written back;
  a members' file is fetched with `cache: 'no-store'` and stored with `no-store` / `max-age=0`, so the browser's HTTP disk
  cache keeps no copy that sign-out cannot clear; an expired session is refreshed (`sessionReady()`) before every request,
  so a tab left open past the hour is not taken for signed out. The old `epinoia_winning_v1` cache (1.9 MB of computed
  analysis) is deleted on first load.
  The lock `CATALOGUE.locks.model` (`gate: 'analytics'`) only chooses what to draw first; the server's answer decides.

**Rate limits** (`analytics_take`, counted per subject: `u:<user id>` signed in, otherwise `ip:` + the first 32 hex of
SHA-256(address | UTC date | `ANALYTICS_SALT`), so no address is stored). The address is the one the platform saw, never
what the client wrote: EXACTLY ONE header is read, `ANALYTICS_IP_HEADER` (default `x-forwarded-for`), and in it the entry
`ANALYTICS_XFF_HOPS` (1) from the right, the one the last hop appended (a single-valued header the edge sets, such as
`cf-connecting-ip`, is its own right end). There is no list of headers and no fallback: a header the platform does not
set or overwrite is one the client writes, and a fallback would trust it whenever the configured one is missing. A
signed-out request without that header is answered 401 signin, never counted in a bucket every signed-out reader
shares. The user agent is not part of it, so rotating it, or the left end of x-forwarded-for, mints no new bucket. Signed in 60 files an hour and 400 a day;
signed out 20 an hour and 100 a day. A refusal is 429 with `Retry-After`. RECALCULATE (`{refresh: true}`) needs a
signed-in account that the same gate allows (any signed-in account while memberships are off), and each press counts
once against the file allowance (its `analytics_take`) besides its own limit (6 an hour, 20 a day per account, logged in
`analytics_issue_log` with scope 'refresh'). It runs at most once per league-season per 10 minutes for everybody (a
second press joins the first), and refuses more than 500 new games, or a unit over 250 games or a 1.6 MB store
(`ANALYTICS_REFRESH_MAX_GAMES`, `ANALYTICS_REFRESH_MAX_STORE_BYTES`, raised only after measuring on the hosted runtime's
2 s CPU limit) before reading its store: the scheduled build does those. A refresh holds `due` as its lease while it
runs, so an isolate killed mid-update leaves the unit flagged for the scheduled build. Every log row, refreshes included, is deleted after 30 days (`analytics_issue_prune()`, run by every builder
pass). `analytics_refresh` keeps one row per league-season with the last refresher's subject, overwritten by the next.

**The sign-in switch.** While `memberships_enabled` is off the files are open to everybody, rate-limited as above.
`platform_settings.analytics_signin = true` makes them need a signed-in account even then (`analytics_check` answers
'signin'); it is off by default, which follows today's rule. Changing either applies on the next request: nothing public
needs purging, because nothing gated is public.

**Residual risk.** (1) The raw tables stay public, so the features can be rebuilt from the play-by-play by anyone willing to
replay every game. (2) Accounts can be farmed to multiply the per-user limit; watch `analytics_issue_log` for subjects at the
daily cap. (3) A signed URL works for anyone for its 120 seconds. (4) The per-IP subject trusts the header the edge sets
(`ANALYTICS_IP_HEADER`, default the right end of x-forwarded-for): CHECK ON THE DEPLOYED FUNCTION which header the edge
sets or overwrites itself (log `clientAddress` once) and set `ANALYTICS_IP_HEADER` / `ANALYTICS_XFF_HOPS` to match. A
wrong choice can be too loose: a header the platform passes through untouched is written by the client, who can rotate
it and get a fresh 20 an hour and 100 a day on every request; and too strict: if the configured entry is an internal hop,
every signed-out reader shares one bucket. A missing header is never either (401 signin). Turning `analytics_signin` on
removes the question. (5) The builder's Actions log and job summary are public (a public repository): they name an open
league with its acceptance numbers and any other unit by an opaque hash, and print a failure as a scope and a count,
never validate()'s text (which can name a withheld player and his club); the whole report goes to the private bucket
(`reports/last.json`). None of this exposes a player's personal data:
the files hold none.

**Runbook (docs/what-wins-model.md §17, in this order):**
1. Finish the events-splits move above (`premium_sit_remaining()` = 0).
2. Check and redeploy the `snapshots` function (it names neither `game_features` nor the bucket; ww-contract checks that).
3. `npx supabase db push` (0211_what_wins.sql).
4. `npx supabase functions deploy finalise-game` and `npx supabase functions deploy analytics-file --no-verify-jwt`; set the
   function secret `ANALYTICS_SALT` (any long random string; changing it resets the signed-out counts); check which address
   header the deployed function receives (residual risk 4) and set `ANALYTICS_IP_HEADER` / `ANALYTICS_XFF_HOPS`.
5. Actions -> backfill-features: a dry run, then a real run, until `select count(*) from game_features_missing(1)` is 0.
6. Actions -> analytics, by hand once with `--dry-run`, then for real; read the job summary. Secrets `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`; variables `ANALYTICS_MIN_GAP_H` (1) and `ANALYTICS_POOL_GAP_H` (6), both 6 once NCAA is on.
7. Decide `platform_settings.analytics_signin`.
8. Publish (the stamps are already bumped).
