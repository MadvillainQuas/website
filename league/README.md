# Courtside Network

A game is scored privately, appears publicly under a second behind the whistle, and
everything else — tables, profiles, lineups, awards — is derived from the same event log.
Lives under `/league/` in `MadvillainQuas/website`. Built on the Backlit kit.

**Branch `courtside-network`, not merged to `main`.** Nothing here is live on
prophesyscouting.co.uk until it is.

## Where it is

| Phase | State |
|---|---|
| 1 — the spine (engine, live transport, public game page, portal, scorer sync) | done |
| 2 — leagues, standings, season stats, profiles | done |
| 3 — media pipeline, embeds, structured data, webhooks | done except OG images and the publish-queue consumer, both blocked on the GitHub credential |
| 4 — platform (CSV import, LiveStats import, JSON API, formats, awards, seasons) | done |

Phase 4's optional items — an origin-isolated scorer subdomain and per-league billing —
are deliberately not built.

## The rule everything follows

`game_events` is append-only and is the only source of truth. Standings, box scores,
season tables, lineup stints, brackets and awards are all **derived**: drop them, re-run
the functions, and the same answers come back. Nothing on a page is a number somebody
typed that could drift from what happened on the floor.

Two consequences worth knowing before changing anything:

* **Rates are computed from summed components, never averaged.** A two-possession stint
  at 200 offensive rating must not outvote a twenty-possession one.
* **plpgsql bodies are not type-checked at creation.** A function installs cleanly and
  raises only when called. Two live bugs came from exactly this (`max(boolean)` in
  standings, an ambiguous `key_id` in the API). Migrations that add a function should
  call it.

## Tests

```
node supabase/tests/engine.smoke.mjs          # the stat engine
node supabase/tests/extract-boxscore.mjs --check
node supabase/tests/boxscore.isolation.mjs    # public box score renders from S + derive()
node supabase/tests/csv.test.mjs              # roster import parsing
node supabase/tests/livestats.test.mjs        # FIBA -> Courtside conversion
node supabase/tests/livestats.roundtrip.mjs   # real games out to FIBA and back
node supabase/tests/formats.test.mjs          # groups, brackets, awards
node supabase/tests/api.test.mjs              # the JSON API over HTTP
node supabase/tests/rls.test.mjs              # anonymous refusals
node supabase/tests/authed.test.mjs           # signed-in refusals
```

All of them run in CI. The ones that need the live project skip cleanly without it.
`api.test.mjs` needs `COURTSIDE_API_KEY`; the others do not.

**Never sign up a test account.** Signups draw on the same email allowance as the
magic-link logins and will lock the owner out for an hour.

## Try it without a backend

```
python -m http.server 8741
```

* `localhost:8741/league/devfeed.html` — press **Start live game**
* `localhost:8741/league/game/?g=demo&mode=local` — watch it update

Two tabs over `BroadcastChannel`, exercising the same publisher and subscriber the
Supabase path uses.

## Database changes

Migrations only, then `npx supabase db push`. Never ad-hoc SQL against the project —
a change that is not in a migration is a change that cannot be reviewed or replayed.

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

* **OG images at finalise, and the publish-queue consumer** that commits a static page
  per finished game. Both need a server-side GitHub credential, so both wait on the PAT
  below being rotated and moved into an Edge Function secret. Until then, link previews
  on services that do not run JavaScript fall back to the document's generic tags.
* **A seeded RLS fixture** (manager A against manager B) to test the *authenticated*
  refusals. The current suite covers the anonymous ones properly and the signed-in ones
  only shallowly.
* **Groups and brackets have no fixture generator.** A league admin can create groups and
  seed a bracket, but the games inside a group stage are still scheduled by hand.

## Before real data

* **Rotate the GitHub PAT.** `config/github-token.json` in the website repo is XOR-encoded
  against a hash published in `gate.js` — both halves are public, so the token is recoverable
  and grants write access to the site. Revoke it, then purge it from git history.
* **`leagues.youth_protected` ships `true`.** Under-18 profiles stay behind league membership,
  and the database refuses to approve a photo of a minor without recorded guardian consent.
  Turning that off should be a deliberate, per-league act.
