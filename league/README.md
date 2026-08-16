# Courtside Network — Phase 1

The spine: a game scored privately, visible publicly, under a second behind the whistle.
Drops into `MadvillainQuas/website` under `/league/`. Everything is built on the Backlit kit.

## Status

| Piece | State |
|---|---|
| `engine.js` — the stat engine, extracted from `courtside.html` | **verified bit-identical** to the original across 5 games (802-event sims + an OT/tech/DQ edge case) |
| `live.js` — frames, clock transitions, degradation ladder | **verified across two tabs**: viewer matched scorer to the millisecond |
| `game/` — public live + finished game page | **working**, strict CSP, no inline script |
| `app/` — portal: magic-link login, teams, rosters | **working** against the live project |
| `score/sync.js` — bridges the existing scorer to the transport | **verified** driving a public page from real courtside actions |
| `kit/` — Backlit design system (CSS + 4 OFL fonts) | done, used by every page |
| `../supabase/migrations/0001_init.sql` | parses under PostgreSQL's own parser · **not yet applied** |
| `../supabase/functions/finalise-game/` | written · **not yet deployed** |
| `../supabase/tests/` | engine smoke passing; RLS tests skip until the schema exists |
| `../.github/workflows/guard.yml` | passing, and each guard verified to fire on an injected violation |

## Try it with no backend

```
python -m http.server 8741
```

* `localhost:8741/league/devfeed.html` — press **Start live game**
* `localhost:8741/league/game/?g=demo&mode=local` — watch it update

Two tabs talking over `BroadcastChannel`, exercising the same publisher and subscriber the
Supabase path uses. Measured identical: clock to the millisecond, score, event count,
minutes, and both team ratings to six decimals.

## One step left to go live

The key is in and the project answers. **The tables do not exist yet** — creating them needs
privileges the browser deliberately does not have, so this step is yours:

1. Supabase dashboard → **SQL Editor**
2. Paste all of `supabase/migrations/0001_init.sql`
3. **Run**
4. `node supabase/tests/rls.test.mjs` — it should stop skipping and start asserting

Then:

* `supabase functions deploy finalise-game`, and set `SUPABASE_SERVICE_ROLE_KEY` +
  `ALLOWED_ORIGIN` as **function secrets** (never in this folder — CI fails the build).
* Add to the repo-root `sw.js`, first line of the `fetch` handler, then bump `CACHE_VERSION`:

  ```js
  if (url.pathname.startsWith('/league/')) return;   // never cache the public section
  ```

* Enable **Email** auth in the dashboard so magic links send.

`config.js` already flips to the Supabase transport now a key is present; force either with
`?mode=local` / `?mode=supabase`.

## Wiring the real scorer

Add to `courtside.html`, after its own script:

```html
<script src="/league/live.js"></script>
<script src="/league/score/sync.js"></script>
<script>CourtsideSync.attach({ gameId: '…' });</script>
```

`sync.js` wraps `addEvent`, `pauseClock` and `resumeClock` — the scorer is otherwise untouched,
and nothing in the sync path can slow a tap down or block on the network.

## Notes on the security posture

* **No inline scripts.** Both pages run `script-src 'self'`; the JS lives in `app/app.js` and
  `game/game.js`. This is stricter than allowing `unsafe-inline` and was the reason the portal
  first failed to load — the fix was to externalise, not to relax the policy.
* **`frame-ancestors` cannot be set from a `<meta>` tag** and Pages cannot send headers, so the
  portal busts out of frames in JS instead. The game page is *meant* to be embeddable.
* **The Supabase SDK is vendored** (`vendor/supabase.js`) rather than loaded from a CDN, keeping
  the promise of no third-party scripts under `/league/`. CI excludes `vendor/` from credential
  scanning, since minified bundles mention these strings internally.
* **`sb_publishable_*` is a public key** and belongs in `config.js`. `sb_secret_*` and
  `service_role` are blocked by CI from ever appearing there.

## Still to build

* Standings, schedule, team and player pages (Phase 2).
* Photo upload and moderation (Phase 3) — the schema, the buckets policy and the
  minor-consent trigger already exist.
* A seeded RLS fixture (manager A vs manager B) to test the *authenticated* refusals; the
  current suite covers the anonymous ones.

## Before real data

* **Rotate the GitHub PAT.** `config/github-token.json` in the website repo is XOR-encoded
  against a hash published in `gate.js` — both halves are public, so the token is recoverable
  and grants write access to the site. Revoke it, then purge it from git history.
* **`leagues.youth_protected` ships `true`.** Under-18 profiles stay behind league membership,
  and the database refuses to approve a photo of a minor without recorded guardian consent.
  Turning that off should be a deliberate, per-league act.
