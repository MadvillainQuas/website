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
2. **The database API is open by design.** The pages read Supabase directly with the public anon key (it has to be in the
   page). Anyone who copies it can call `/rest/v1/...` and page through `game_events` (the whole play-by-play), `standings`,
   `player_game_stats`, and the realtime stream, with no plan. This includes the *events* splits (`stats.sit`) that the
   membership lock hides in the interface: today the lock is on the screen, not in the database.
3. What would make a paid plan real is server-side: move premium fields to a table only entitled users can read (RLS on the
   membership), cap rows per request, serve the bulk reads through a rate-limited function, and put bot/rate rules in front of
   the API. The keyed API (`/functions/v1/api`, rate limited per key) is the paid route and already exists.
