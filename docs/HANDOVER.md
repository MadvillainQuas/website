# Epinoia Network — handover

Written for whoever picks this up next, human or otherwise. Read this before
touching anything; it is the compressed version of several long sessions and
most of it is things that are not obvious from the code.

Repo: `MadvillainQuas/website` → prophesyscouting.co.uk
Local: `C:\Users\Admin\Documents\website_repo`
Branch: **`epinoia-network`** — not merged to `main`, so nothing here is live.

---

## 1. THE BLOCKER — read this first

**54 commits are local-only.** `git push` needs an interactive credential
prompt that a headless session cannot satisfy:

```
fatal: could not read Username for 'https://github.com'
```

Reads (`git ls-remote`) work; writes do not. Louie has to run this himself:

```bash
git -C /c/Users/Admin/Documents/website_repo push origin epinoia-network
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
`/epinoia/`. GitHub Pages serves **code only**; Supabase serves **the game**.
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
  under `epinoia/`, from `epinoia/version.txt` (currently **38**).
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

### A CSS transition on a non-compositing tab never finishes
Cost an hour. The rail's slide is `transform`, which runs on the compositor; in
a browser pane that is not painting, the transition sits in `running` for ever
and `getComputedStyle` keeps returning the START value — so the CSS looks
broken when it is not. `!important` bypasses it (important beats animations),
which is how to tell the two apart. `requestAnimationFrame` never fires there
either, so anything that must happen "after layout" needs a timeout fallback:
see `afterPaint()` in nav.js.

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
- **`/epinoia/` must never load `gate.js` or `topnav.js`.** The public carve-out
  is defined by omission; CI enforces it.
- **No personal email addresses in the repo.** CI guard added after finding
  Louie's address hardcoded in `0008`/`0009` (since redacted). The contact
  recipient lives in a `CONTACT_TO` function secret.
- **Never run full scrape runs** on the scraper project — cap at ~5 games.

---

## 5. Layout

```
league/
  index.html        SPLASH (no ?l=) AND league splash (?l=slug) — one file, two
                    pages. home.js picks; they share only a URL.
  splash.js         the platform splash: pool, inline sign-in, the three decks
  kit/splash.css    the water, the marble, the segments
  learn/            the scoring app explained — sales tab first, tutorial second
  prophesy/         what the scouting side is, for people who cannot see it
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
  bpm.js          BPM 2.0 — ALSO runs in the Edge Function, see below
  merch.js        merchandise: products drawn from club crests, star of the month
  artwork.js      PRINT files — real inches at 300 DPI, transparent, no garment
  data.js         shared loader (paged) + season/window aggregation
  fulltable.js    the index_9-style table, 70+ columns
  live.js         publisher/subscriber, 250ms frames, corrections
  nav.js          the sidebar (self-injecting, auth-aware, TWO VIEWS — see below)
  t/venue.js      home venue + club contact: drawn arena, map, pop-up form
```

**The rail has two views.** At rest it lists LEAGUES and nothing else; pick one
and it slides to that league's own pages (fixtures / statistics / wowy / table,
then the role-gated three) with a back button. A page that knows its league
opens drilled in — `window.__CS_LEAGUE_SLUG = slug` both retargets the links and
switches the view. The first view never animates (`.noanim`, removed after the
first paint), because animating into a state nobody asked for is wrong and
because a tab that is not compositing would otherwise leave the deck stranded
mid-slide.

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
`EPINOIA_API_KEY`.

**The box score is extracted, not reimplemented.** `epinoia/boxscore.js` is
lifted verbatim from the scorer by `extract-boxscore.mjs`. Edit the scorer,
then re-run the extractor. CI fails if they drift.

---

## 7. Open items

**Scraper keys (partner feeds).** `data_feeds` + `feed_deliveries` (0037), the
shared builder in `supabase/functions/_shared/feeds.js` (pure, unit-tested) and
`feeds.ts` (the IO half), the `feeds` Edge Function (preview / test send /
retry) and section 11 of the admin console. finalise-game queues and posts on
publish. The endpoint and signing secret live on a table with no SELECT policy,
exactly like `league_webhooks`. **The authenticated path — preview, test send,
retry — has not been exercised end to end**, because doing so needs a signed-in
league admin and this session must never create an account. Everything under it
is proven: the SQL functions and every SSRF guard by 0037's self-test on the
live project, the payloads by 75 unit tests, and the function refuses
unauthenticated callers.

**The MVP is decided by BPM, not by efficiency.** `compute_season_awards` still
writes the efficiency pick and the finalise function then OVERWRITES the `mvp`
row with the box plus/minus leader, so the award and the leaderboard two
sections below it can never name different players. The award's `detail` always
says which basis was used, so a failed BPM pass degrades to a labelled
efficiency award rather than to a wrong one.

**`epinoia/bpm.js` and `epinoia/season.js` now run in two places.**
`supabase/tests/extract-shared.mjs` copies them into `supabase/functions/_shared/`
with an ESM tail; **run it after editing either, CI runs `--check`**. This is the
same arrangement `_shared/engine.js` uses, and it exists so there is never a
second implementation of BPM to disagree with the first. Recomputing awards for
an existing season is `POST {competitionId, awards:1}` to finalise-game, wired
to the "recompute awards" button in the console.

**Merchandise** (league splash, section 04) draws a tee, hoodie, scarf, print
and mug from each club's crest and colours, plus the month's BPM star on a
print. Epinoia sells nothing: items link to `leagues.store_url`, set in the
console, and the section says the shop is not open when there is none. A minor
is never featured — RLS hides them anyway and `home.js` checks again.

**COURTSIDE IS NOW EPINOIA** (migration 0042 + a sweep of 94 files). What that
touched and what it deliberately did not:

- Text, JS globals (`EPINOIA_CONFIG`, `EpinoiaData`, `epinoiaClient`), the CSS
  namespace (`.cs-` → `.ep-`), the feed headers (`X-Epinoia-Signature`), the
  page titles, `courtside-kit.css` → `epinoia-kit.css`.
- **Applied migrations 0001–0041 were left alone.** Their contents are history,
  editing an applied migration risks a checksum mismatch on the next push, and
  the word survives in them only in comments and a session-setting name.
- **Keys issued as `csk_` still work.** Only the hash is stored, authentication
  never looks at the prefix, and a partner's key must not die in a rename. New
  keys mint as `epk_`. The demo key is still `csk_tjtCi98Q`.
- **The scorer's saved game reads the old localStorage key once** and carries it
  over (`epinoia/score/index.html`, `loadSaved`). Delete that fallback after a
  season. Renaming a storage key without it is silent data loss.
- **The logotype has SIX GLYPHS: A E I N O P.** It is bound to `.epinoia-mark`,
  which may only go on an element whose whole content is the word EPINOIA.
  `home.js` removes the class when the hub's wordmark becomes a league name,
  because anything else renders as missing-glyph boxes. The face is also twice
  as wide as Jersey25 at the same size, so `.wordmark.epinoia-mark` and
  `.wm.epinoia-mark` set their own smaller sizes.
- Brand assets are in `epinoia/brand/`, built from the two supplied PNGs: white
  keyed to transparency, the icon cropped off its shadow. Every page now has a
  favicon, which it did not before.

**THE MERCHANDISE PIPELINE** (migration 0043) turns the drawn mockups into
things that exist. Three places on purpose:

- `epinoia/artwork.js` builds the PRINT file — the design alone, on
  transparency, at the real physical size, 300 DPI. Not the mockup; confusing
  the two gives you a t-shirt with a picture of a t-shirt on it.
- **The artwork is rasterised in the ADMIN CONSOLE**, because that needs a
  canvas. Verified: a 17.3-megapixel tee sheet renders in ~1.4s to a 483KB PNG
  with transparent corners. One design at a time — several 17MP canvases at
  once kills a tab. Anything over 40MP is scaled down and the real DPI is
  recorded in the design's warnings rather than hidden.
- **The store is called from the `merch` Edge Function**, never the browser:
  `merch_providers` has no SELECT policy, so the API key is unreadable even to
  the admin who set it.

It is AUTOMATIC in the sense that matters: triggers put a design back to
`pending` when its club's logo is approved or the club is renamed or
recoloured, and the console builds anything pending the moment it is opened.

Catalogue ids (Printful variants, Printify blueprint/provider) are PASTED by
the league, never guessed — a product created against a guessed variant is a
real product in a real shop that nobody can buy. `missing()` names the gaps in
sentences and `action:'dryrun'` shows the exact requests with the key redacted.
**The live store call is unverified** — it needs a real account, and creating a
product is not undoable from our side.

`/epinoia/embed/merch/` is the shop window for other people's sites
(`data-epinoia="shop"`), and only ever shows `status='published'` rows, which is
structural rather than a filter: RLS hides everything earlier from anonymous
readers.

**THE SPLASH.** `/epinoia/` with no `?l=` is now the platform's front page: a
shallow pool over marble, a centred title, inline sign-in and three segmented
decks. `/epinoia/?l=slug` is untouched and must stay that way — the two are
different pages sharing a document because they share a URL, and `home.js`
picks between them.

- The water is **two pre-rendered seamless tiles** (`brand/pool-*.jpg`, built by
  `scratchpad/pool.py`) moved by `transform`. Never make it an animated SVG
  filter: that recomputes noise every frame across the viewport.
- The wash is deliberately THIN (30-48%). The first pass at 58-74% drowned the
  caustics and flattened the floor, which is a blue rectangle rather than water.
- The title is centred on the VIEWPORT, not on the content box — the pool runs
  under the rail, so content-box centring puts it half a rail-width off.
- `?train=1` on the scorer fills the setup through the real UI and presses the
  real button, so training cannot drift from the live app.

**Blocked on Louie:**
- Push the branch (§1).
- **Rotate the GitHub PAT.** `config/github-token.json` is XOR-encoded against
  a hash published in `gate.js` — both halves are public, so the token is
  recoverable and grants write access to the site. Flagged repeatedly; still
  outstanding. **OG images and the publish-queue consumer are blocked on this**
  — they need a server-side GitHub credential.
- **Enable Google auth** in Supabase → Authentication → Providers. The button
  on `/epinoia/signin/` hides itself until then and appears automatically after;
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

`epinoia/bpm.js` is ported from `BPMCalculator` in
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
