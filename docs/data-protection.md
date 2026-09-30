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
