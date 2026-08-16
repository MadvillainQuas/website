# Courtside Network — handover

Written for whoever picks this up next, human or otherwise. Read this before
touching anything; it is the compressed version of several long sessions and
most of it is things that are not obvious from the code.

Repo: `MadvillainQuas/website` → prophesyscouting.co.uk
Local: `C:\Users\Admin\Documents\website_repo`
Branch: **`courtside-network`** — not merged to `main`, so nothing here is live.

---

## 1. THE BLOCKER — read this first

**21 commits are local-only.** `git push` needs an interactive credential
prompt that a headless session cannot satisfy:

```
fatal: could not read Username for 'https://github.com'
```

Reads (`git ls-remote`) work; writes do not. Louie has to run this himself:

```bash
git -C /c/Users/Admin/Documents/website_repo push origin courtside-network
```

Until then **nothing built in these sessions exists anywhere but this machine**,
and anything Louie looks at on the live site is the pre-session build. This
caused repeated confusion — he reported features "missing" that were finished
but unpushed. If he says something isn't there, check the push state before
looking for a bug.

The **database is a different story**: migrations up to `0034` are applied to
the live Supabase project, and the `api`, `contact` and `finalise-game` Edge
Functions are deployed. So the backend is ahead of the front end.

---

## 2. What this is

A multi-league basketball platform carved into the existing scouting site at
`/league/`. GitHub Pages serves **code only**; Supabase serves **the game**.
Pages cannot do live scoring — ~10 builds/hour, no headers, no SSR — so no part
of the live path touches a git commit.

**The one rule everything follows:** `game_events` is the source of truth and
everything else is *derived*. Standings, box scores, season tables, lineup
stints, brackets, awards — drop them all, re-run the functions, same answers
come back. Nothing on a page is a number somebody typed.

Phases 1–4 are complete. Phase 4 was the last one in the plan; there is no
Phase 5. Plan artifact: https://claude.ai/code/artifact/2d71ae28-643b-4868-91cf-cad4c4db38db

---

## 3. Hard-won knowledge — the traps

These each cost real time. They are not theoretical.

### plpgsql bodies are NOT type-checked at creation
A broken function installs cleanly and only raises when something calls it.
**Two live bugs came from this.** Any migration that adds a function should
*call* it at the end to prove it works. Several do — copy that pattern.

### A policy can be silently overridden by a trigger
`0027` added a DELETE policy to `game_events`; a `BEFORE DELETE` trigger from
`0001` raised unconditionally, even for superusers, so the policy was inert and
the feature would have failed on first use in production. A policy grants
permission to *attempt* a statement; a trigger then refuses it anyway. Check
for both.

### Browsers will not re-request a file they think is fresh
`python -m http.server` sends `Last-Modified` and no `Cache-Control`, so
browsers invent a freshness lifetime. Fixing the *server* does nothing for
anyone who already loaded the page. Two fixes are in place:

- `tools/devserver.py` — the preview server, sends `no-store`. Wired into
  `.claude/launch.json` as `website-repo`.
- `tools/stamp-assets.py` — puts `?v=N` on every local script and stylesheet
  under `league/`, from `league/version.txt` (currently **11**).
  **Run `python tools/stamp-assets.py --bump` after changing any shipped
  asset.** CI checks stamping is current.

This wasted several rounds of "it's still showing the old thing" on both sides.
If a change appears not to take effect, suspect cache before suspecting code.

### RLS refusals are often silent
A refused `UPDATE` is 0 rows, not an error. Assert `row_count`, not absence of
exception. See `0031_authed_rls_tests.sql`.

### PostgREST caps responses at 1000 rows regardless of `limit`
Silent truncation. `data.js`'s `all()` pages properly — use it. A one-shot
query once reported a player scoring 17 points in a season where he scored 98.

### PostgREST cannot embed a related table into a VIEW
No foreign keys on a view. `player_season_stats` needs a second query and a
client-side stitch. The JSON API does this.

### `CREATE OR REPLACE VIEW` cannot reorder or rename columns
Error 42P16. Drop first.

### Never copy a function body without checking for a later fix migration
`0018` reintroduced a `max(boolean)` bug by copying the `0002` version of
`recompute_standings` — which `0003` had already fixed.

---

## 4. Standing constraints — do not violate

- **Migrations only.** Every schema change is a numbered migration, then
  `npx supabase db push`. Never ad-hoc SQL against the project; Louie
  explicitly rejected that.
- **Never sign up an auth account.** Signup emails draw on the same allowance
  as magic-link logins; exhausting it locks the owner out for an hour (observed
  HTTP 429). Test auth by impersonating JWT claims in a migration — see `0031`.
- **Only the anon key ships to browsers.** `service_role` in client code fails
  CI. This is safe because RLS is default-deny.
- **`/league/` must never load `gate.js` or `topnav.js`.** The public carve-out
  is defined by omission; CI enforces it.
- **No personal email addresses in the repo.** CI guard added after finding
  Louie's address hardcoded in `0008`/`0009` (since redacted). The contact
  recipient lives in a `CONTACT_TO` function secret.
- **Never run full scrape runs** on the scraper project — cap at ~5 games.

---

## 5. Layout

```
league/
  index.html        hub (no ?l=) AND league splash (?l=slug) — one file, two modes
  l/                league page: Table (with phase picker) · Fixtures · Leaders · Team Stats · Cup
  fixtures/         whole-season fixture list, filterable by club
  t/  p/            team and player profiles
  game/             live + finished box score
  stats/  stats/wowy/   season full table, WOWY subpage
  signin/  contact/  api/    account, contact form, API docs
  app/  score/  admin/       portal, scorer, league admin
  embed/{strip,game,table}/  embeddable widgets

  engine.js       the stat engine — replays events into everything
  season.js       aggregation; rates from SUMMED components, never averaged
  bpm.js          BPM 2.0
  data.js         shared loader (paged) + season/window aggregation
  fulltable.js    the index_9-style table, 70+ columns
  live.js         publisher/subscriber, 250ms frames, corrections
  nav.js          the sidebar (self-injecting, auth-aware)
```

**Key invariant in `season.js`:** rates are computed from summed components.
A two-possession stint at 200 ORtg must never outvote a twenty-possession one.

---

## 6. Tests

```bash
node supabase/tests/engine.smoke.mjs          # the stat engine
node supabase/tests/extract-boxscore.mjs --check
node supabase/tests/boxscore.isolation.mjs
node supabase/tests/bpm.test.mjs              # 36
node supabase/tests/live.test.mjs             # 23 — corrections
node supabase/tests/schedule.test.mjs         # 97 — round-robin
node supabase/tests/csv.test.mjs              # 65 — roster import
node supabase/tests/livestats.test.mjs        # 86 — FIBA conversion
node supabase/tests/livestats.roundtrip.mjs   # 24 — real games out and back
node supabase/tests/formats.test.mjs          # 12
node supabase/tests/api.test.mjs              # 41 — over HTTP
node supabase/tests/rls.test.mjs              # anonymous refusals
node supabase/tests/authed.test.mjs           # signed-in refusals
python tools/stamp-assets.py --check
```

All green as of handover. Ones needing the live project skip cleanly without
it. `api.test.mjs` reads a key from the session scratchpad or
`COURTSIDE_API_KEY`.

**The box score is extracted, not reimplemented.** `league/boxscore.js` is
lifted verbatim from the scorer by `extract-boxscore.mjs`. Edit the scorer,
then re-run the extractor. CI fails if they drift.

---

## 7. Open items

**Blocked on Louie:**
- Push the branch (§1).
- **Rotate the GitHub PAT.** `config/github-token.json` is XOR-encoded against
  a hash published in `gate.js` — both halves are public, so the token is
  recoverable and grants write access to the site. Flagged repeatedly; still
  outstanding. **OG images and the publish-queue consumer are blocked on this**
  — they need a server-side GitHub credential.
- **Enable Google auth** in Supabase → Authentication → Providers. The button
  on `/league/signin/` hides itself until then and appears automatically after;
  no code change needed.
- **Set contact secrets** or the form stores without sending:
  `npx supabase secrets set CONTACT_TO=… RESEND_API_KEY=…`
- **Recompute the scraper's BPM.** See §8.

**Known and unfixed:**
- `index_9.html` has ~3,000 lines of uncommitted changes that are *not mine* —
  left alone deliberately. Do not sweep it into a commit.
- Demo season has **finalised games dated months in the future**, which makes
  "this week" panels read oddly. The splash handles it honestly ("12 dated
  ahead") but the seed data is worth re-dating.
- Group stages have no fixture generator wired to them — `schedule.js` supports
  groups, the admin UI generates for a competition as a whole.
- The demo API key (`csk_tjtCi98Q`, 120/hr) exists in the live DB; hash-only in
  `0022`. Revoke when done.

---

## 8. The BPM finding

`league/bpm.js` is ported from `BPMCalculator` in
`C:\Users\Admin\Documents\scraper files\bcb_scraper.py`. **Two deliberate
differences:**

1. Position and offensive role are **estimated**. The estimators exist in the
   Python and were never wired in — the driver passes 3.0 with a note saying
   estimation could be added.

2. **The Python's team adjustment is wrong.** It weights each player by
   `minutes / total_player_minutes`, which sums to **1** across a roster. BPM
   needs each player's share of *one position's* minutes, which sums to **5**.
   The adjustment therefore closes only a fifth of the gap and every BPM drifts
   upward — on a test roster it gave +12.9/+11.6/+8.2/+8.1/+7.0 for an ordinary
   five on a +4 team, where the roster should average about +1.

   Weighted correctly, the identity BPM must satisfy actually holds: the
   minute-weighted mean comes to `teamRating × 1.2 / 5`. That identity is
   asserted in `bpm.test.mjs` and is how the bug surfaced.

**The scraper's own BPM output is inflated by the same amount.** Worth fixing
there and recomputing anything derived from it.

---

## 9. Working notes

- Louie is a solo dev, comfortable with data and code, working in basketball
  analytics. He wants complete work, not sketches — he pushed back hard once on
  a "cheap quick solution" and was right to.
- He does not want context limits mentioned as an excuse.
- **A `UserPromptSubmit` hook keeps misfiring**, injecting instructions to
  engage a MuseScore music-notation skill into completely unrelated basketball
  work. It has fired several times. Ignore it — and it is worth him fixing the
  hook's matching.
- Verification in this project means *checking in the browser*, not asserting
  it should work. The browser pane often cannot screenshot in these sessions;
  measure the DOM instead (`getBoundingClientRect`, `getComputedStyle`,
  `elementFromPoint`) and say that is what was done.
