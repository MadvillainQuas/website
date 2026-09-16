# Switching the league feed on — the three commands

Everything below MUST run from `C:\Users\Admin\Documents\website_repo` — `cd` there first.
Run from the home folder, the CLI sees no migrations, reports every remote version as
missing and suggests `migration repair --status reverted …` — never run that; it would
re-apply all 93 migrations to the live database. Easiest: double-click
`scripts\ingest\Push Database.bat`, which does the cd + link + push for you. Step 1 is the database, step 2 is GitHub (secrets +
push + first run in one script), step 3 is optional (the platform league).

## 1. Database — apply migrations 0094 → 0096

No install needed; `npx` fetches the Supabase CLI.

```bash
npx supabase@latest login
```
(opens the browser once; paste nothing, just approve)

```bash
npx supabase@latest link --project-ref hhvofgqqadtyvcjudhjx
```
(asks for the database password — the one from Project Settings → Database; it is only used for the link)

```bash
npx supabase@latest db push
```
This applies every migration the project has not seen yet. It lists them first
(`0094_ingest_sources`, `0095_feed_season_rollup`, `0096_feed_registry`, plus
any earlier ones never pushed from this machine) and asks `Do you want to push
these migrations? [Y/n]`. Answer `Y`. If it stops on an earlier migration that
was applied by hand in the past, run
`npx supabase@latest migration repair --status applied <number>` for that one
and push again. Never use `supabase db query`.

## 2. GitHub — secrets, push, first run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-github.ps1
```
It installs the GitHub CLI if needed, signs you in (browser), asks for the two
Supabase values (Project Settings → API: the **Project URL** and the
**service_role** secret — input is hidden), stores them as repo secrets,
commits + pushes the ingest work (that is what enables the workflow), runs the
workflow once for SLB and opens the Actions page. Re-running it is safe.

Then open index_9 → Advanced Games View → 📡 League feed. The competition
line says `supabase` once the run has written rows, `repo` before that.

## 3. The scraper on the worker (stints, lineups, every league scraper) — DONE 2026-09-06

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-scraper.ps1
```
Turns the `scraper files` folder into the PRIVATE repo `MadvillainQuas/scraper-pipeline`
(everything except caches, node_modules, the 6 GB output folder, backups and users.json), adds a
read-only deploy key, stores it as the website's `SCRAPER_DEPLOY_KEY` secret and sets
`SCRAPER_REPO`. **Re-run it whenever you change a scraper file** — it pushes the changes. Run logs
then read `(final, 32 stints)` instead of `0 stints`. To backfill stints for games ingested
before this, run the workflow with the `refresh` box ticked (Actions → League ingest → Run workflow).

## 4. Adding leagues — from the website, no files

**prophesyscouting.co.uk/admin.html → League feeds (auto-update)**: one row per league (code,
label, adapter, schedule URLs). *Publish* commits `config/ingest-sources.json` — the registry the
worker, Scrape Now and GameVis all read — with your saved GitHub token; *Run ingest now* starts the
worker immediately and the card lists the last runs.

**Epinoia console → 07b Connect a league feed** (migrations 0097 + 0098 — run `Push Database.bat`
again after pulling): a platform admin can **create a brand-new league** here from nothing but a
name, a code and its schedule URL(s) (`create league` — makes the league, the current season, a
competition, you as its admin, and registers the feed). To attach a feed to a league that already
exists, paste the league's schedule URL, give it a code, press *connect*. The worker then creates
that league's clubs, players, rosters and fixtures from the feed and turns every finished game into
a scored Epinoia game (roster snapshot, event log, finalise). The card shows each feed's last poll,
game counts and errors, with pause / resume / poll-now.

## 4b. The worker finalises games — DONE 2026-09-06 (`finalise-game` redeployed)

The finalise function accepts the ingest worker (it identifies itself with the service key;
its actions are logged against the platform admin). If it is ever redeployed from an older
checkout, fed games stay `live` with their full event log and the worker logs `finalise-game 401`;
redeploy with:

```bash
cd /d C:\Users\Admin\Documents\website_repo && npx supabase@latest functions deploy finalise-game
```

## 4c. Dates, fixtures and live games (built 2026-09-06; self-chaining live lane the same evening)

The worker reads each game's tip-off time, venue and clubs from the Genius hosted schedule (league
local time → UTC), so fixtures appear on Epinoia with real dates before tip. The half-hourly
discovery lane (12:00–23:30 UTC) finds new games and finals and commits the repo feed. The **live
lane** is a long-lived pass (up to 5.5 h): it re-reads the due set every 2 minutes, polls every game
that is live or inside its tip-off window (20 min before → 4 h after) every 30 seconds, appending
events + clock + score to Supabase, naps until the next listed tip-off when nothing is on, and
**re-dispatches itself** while games are live or a tip-off is within 8 h. The discovery lane also
starts it whenever a tip-off is within 3 h. So live coverage never depends on GitHub's cron, which
is best-effort (on 6 Sep it dropped three half-hour slots and never fired the 10-minute lane; the
Hemel game sat 30 minutes behind until a pass was started by hand).

If the site ever looks behind: Actions → League ingest → Run workflow → tick **live**. The pass
picks up within a minute and keeps chaining. A signed-in admin / league admin / the game's
statistician also sees **FIBA LiveStats ↗** in the game page's top bar — the Genius page the game is
fed from — to check the source directly.

## 4d. Video on a fed game (built 2026-09-06 evening)

Attach video from the game page as before (admin / league admin / the game's statistician). The
sheet can now fill the tip-off number in itself: *from the stream's start time* (YouTube live
streams — put a free YouTube Data API key in `epinoia/config.js` as `youtubeApiKey`), *from a local
copy of the footage* (the file's own clock, read in the browser, never uploaded), or *read the
scoreboard in the picture* (finds the overlay and the first running first-period clock; ~11 MB of
reader loads once). The video tab then shows how tightly plays are placed (a fed game's plays are
stamped by the 10-second live poll), a ↗ link per play, +/− nudges for admins, and *export clips*
(JSON) for the labelling studio. Plan and status: `docs/video-livestats-sync-roadmap.md`.

## 4e. Phases, designation, crests, matching, broadcasts (built 2026-09-06 late)

- **One competition per Genius phase.** A registry entry pointing at a client's whole schedule
  (`…/HBBC/en/schedule`) is expanded by the worker into one source per competition the page offers
  for the current season — BCB: *BCB 2026-2027* (league), *BCB Trophy 2027* (cup) — each with its
  own schedule URL, its own Epinoia competition (kind from the name: trophy/cup → cup, playoff/finals
  → playoff) and its own team list. All-star and exhibition phases are skipped unless named in
  `adapter_config.competitions_include`; `competitions_exclude` drops any; `competition_kinds`
  overrides a kind. Games filed under the league's catch-all competition before the phases were
  known are re-filed on the next discovery run (tables rebuilt). A game an admin has placed
  somewhere specific is never touched.
- **Block designation.** Console → Fixtures: tick games (or *select all*) and *move ticked games
  to…* another phase, before or after they are played. The game page has the same control for one
  game (admins / league admins).
- **Crests.** Every club's logo is taken from the schedule page at discovery (both sides of every
  fixture carry one), so a club has its crest before its first game is fetched. Uploaded crests win.
- **Player matching.** `epinoia/match.js` and its port `scripts/ingest/matching.py` score a name on
  surname, forename / nickname / initial, club, shirt number and position; the worker uses it before
  creating a player, and index_9's player profile links to the player's (or at least the club's)
  Epinoia page through it. Ambiguous pairs are logged (`?  name: ambiguous between …`), never guessed.
- **Broadcasts, found by themselves.** Add a repo secret `YOUTUBE_API_KEY` (a free, read-only YouTube
  Data API key) and the worker attaches each finished fed game's broadcast: a search for both clubs
  within a day of tip-off (the league's channel first when `adapter_config.youtube_channel` is set),
  a live stream preferred because YouTube publishes its actual start time, which with the platform's
  own tip stamp anchors every play with no human step. A plain upload is attached with the tip time
  known and the offset left for the scoreboard reader on the game page.

## 4f. Broadcasts: the channel path (no key), the API key, and the clock track (2026-09-07)

**What runs by itself now.** BCB's registry entry names the league's YouTube channel
(`adapter_config.youtube_channel = UCbx2AZS5az8q39mI_MB_RkA`, i.e. @BritishChampionshipBasketball).
The worker reads the channel's RSS feed (its newest fifteen videos, no key needed), matches a video to
a fixture by both clubs' names and the date in the title (typos tolerated when the publish time
fits), and reads the stream's real start and end off the watch page. A fixture gets its stream
attached days ahead (streams are scheduled early); when the game goes live the stream start is
filled in; when the log has its first period_start the tip is filled in — and every play is placed.
Verified on the 5–6 Sep weekend: 7 of 8 games matched (the eighth was never streamed).

**Why the key still matters.** Matching works from the worker without one (the RSS feed answers
anywhere), but YouTube shows GitHub's runners a sign-in wall on its watch pages and player endpoint
(LOGIN_REQUIRED, seen 7 Sep), so the stream's real start — the thing that anchors every play with no
human step — only comes back through the Data API. Until the key is in, streams are attached and
the page asks for the tip-off offset (or reads it off the scoreboard); once it is in, the next run
anchors every attached stream by itself.

**Finding the channel id for another league:** open the channel's page, view source, search
`externalId` — the `UC…` value — and put it in that league's registry entry (admin.html → League
feeds → adapter config) as `youtube_channel`.

**The YouTube Data API key (optional — reaches beyond the newest fifteen videos and other channels):**
1. console.cloud.google.com → create a project (any name).
2. APIs & Services → Library → "YouTube Data API v3" → Enable.
3. APIs & Services → Credentials → Create credentials → API key. Restrict it: API restrictions →
   YouTube Data API v3 only. (Leave application restrictions unset; the worker calls from GitHub.)
4. GitHub → the website repo → Settings → Secrets and variables → Actions → New repository secret:
   name `YOUTUBE_API_KEY`, value the key. Nothing else to change; the workflow already passes it.
   Free quota is 10,000 units a day; one game costs about 100, so it is never a concern.

**The vision model's clock track.** The playtype-vision studio (`label_server.py --video <game.mp4>`,
then `/studio`, mode **clock**) reads the clock right through a whole game with the jersey-number
model (PARSeq) asked the clock question — only times the clock can legally show are candidates,
the overlay's own digits are learned as it goes — and offers the track for download; import it on
the game page. `python scripts/clock.py track <video>` does the same from a prompt. Details in the
skill's SKILL.md ("The game clock").

**The clock track — plays placed by the game clock itself.** After a game, on its page (attach
video → choose a local copy of the footage) *read the whole game clock* walks the footage every 5 s,
reads the overlay, and saves the readings on the video row; from then on every play sits where its
period and clock were on screen, stoppages included, with no tip-off anchor involved. A vision model
can do the same job offline and be imported with *import a clock track*: a JSON file
`{"format":"epinoia-clock-track/1","samples":[{"t":1287.5,"period":1,"clock_ms":598000}, …]}` where `t`
is seconds into the video (`clock_s` and `p` are accepted too). Needs migration **0099** — run
`Push Database.bat` again.

## 4g. AI process game — one button, the PC does the rest (built 2026-09-07)

**What it is.** On a game page, attach video → **AI process game**. A row goes into `video_jobs`;
the worker on your PC claims it, downloads the stream (720p, yt-dlp, no ffmpeg needed), fetches
the game's archived FIBA log, looks at five frames spread through the footage to decide what the
picture holds — a clock, a score, or both — reads it right through, and writes the readings onto
the video row. The card under the button follows the job live (waiting → downloading → reading
with the last score or clock seen → done), and the page re-derives itself when the track lands:
every play seeks by its own game clock. Then, while the file is still on disk, the worker
harvests self-labels for the detectors around every basket the log knows about, and deletes the
file. The ingest queues a job by itself for every fed game that goes **final** with a stream
attached (`adapter_config.auto_process_video = false` turns that off per league), so the button
is mostly for re-runs.

**Switch it on — one step, once, on the PC.** Double-click `scripts\worker\setup-worker.bat`,
paste the **service_role** key when it asks (Supabase → Project settings → API → service_role),
Enter. It writes `%APPDATA%\epinoia\worker.json`, drops a launcher in your Startup folder so the
worker runs minimised at every logon (no admin rights needed; delete that launcher to stop it),
and starts the worker now. The key never leaves this machine. (Migration **0100** is already
applied.)

**The dashboard (a window on the PC).** `scripts\worker\ai_dashboard.bat` — the queue with a
progress bar per game and the last thing the reader saw, the worker's state (online / paused /
not running), and buttons: **Start worker / Stop / Pause / Resume** (pause finishes the current game
and claims nothing more; stop kills the process and the current game goes back to the queue),
**To top / Up / Down / To bottom / Cancel / Retry / Open page** for the selected game, and
**Add game…** (paste a game page link). Migration **0101** (priority + paused) is applied. A status
bar along the bottom counts waiting / running / done / failed. Double-click a row to open its page.
It opens by itself whenever a game starts processing (and comes to the front if already open); one
window only. `dashboard_auto: false` in worker.json turns that off.

**When YouTube asks for a sign-in.** After many downloads from one address YouTube shows a "confirm
you're not a bot" wall for a while. The worker treats it as weather: the job goes back to the queue,
the card says "waiting: YouTube asked for a sign-in check", and the worker rests half an hour before
trying again. If it keeps happening, export your YouTube sign-in once with the browser CLOSED —
`yt-dlp --cookies-from-browser edge --cookies "%APPDATA%\epinoia\yt_cookies.txt" <any video url>` — and
set `"yt_cookies_file": "C:\Users\Admin\AppData\Roaming\epinoia\yt_cookies.txt"` in worker.json (done
2026-09-09). The browser's own store cannot be read while the browser is open, which is why the
file, not `"yt_cookies_browser"`, is the setting that works day to day.

**Then nothing.** Every final game with a stream attached and no clock track — including ones
that finished before the worker existed, back 21 days — is queued and read by itself; the button
on a game page is only for re-runs. Watch a game's card (attach video) or the minimised window.

**Timing.** A full game is ~50 min in score mode (step 2 s) or clock mode (step 5 s); clock+score
runs both and takes ~1.5×; the harvest adds ~10 min per basket window (capped at 12, skipped when
another game is waiting). One machine, one game at a time; a second PC with the skill can run the
same worker and the claim never hands both the same job.

**Test without the database:** `python scripts\worker\ai_worker.py --dry-run <game.mp4> --pbp <data.json URL> --start 1000 --end 1300 --harvest 1`.

## 5. Optional — bootstrap an existing archive into a platform league

```bash
set SUPABASE_URL=https://hhvofgqqadtyvcjudhjx.supabase.co
set SUPABASE_SERVICE_KEY=<service_role secret>
python scripts\ingest\bootstrap_league.py --source SLB --season 2025-26 --dry-run
python scripts\ingest\bootstrap_league.py --source SLB --season 2025-26
```
The dry run prints what would be created (league, season, competition, clubs,
players, roster entries, fixtures). The real run prints the `league_id` and
`competition_id` — paste them into `config/ingest-sources.json` for SLB so the
worker also writes `games` + `game_advanced` from the next run.

## 6. Memberships and payments (Stripe): test mode first

Paid plans, for the advanced analytics and for members-only leagues, taken through the `billing`
Edge Function. The contract is `docs/memberships.md`. As shipped nothing changes for anyone:
**memberships are switched off for the whole platform** (Plans tab → **Memberships: off**), every
league is `open`, the analytics are `free`, and `billing` answers `503 payments are not switched on
yet` to everything but `status`. None of the steps below has been done yet.

While memberships are off, leagues can set themselves up (members only, plans, grants) and you can
set the analytics default, but nothing is enforced for fans. Switching memberships on is the
**last** step (6.12), after a plan can be bought and payments are live.

Do every step with the Stripe dashboard in **test mode** first (keys start `sk_test_`), buy a plan
end to end (6.9), and only then repeat for live (6.11). Stripe keeps test and live apart: keys,
webhook endpoints and their secrets, products and price ids, portal settings, Radar rules and
connected accounts are all separate. The database is shared by both.

Never paste a key into a file. Keys live only in `npx supabase secrets`. The guard workflow fails the
build on a quoted `sk_live_…`, `sk_test_…`, `rk_…` or `whsec_…` under `epinoia/` or `supabase/`.

### 6.1 Database: migrations 0117 and 0118

As in §1, from `C:\Users\Admin\Documents\website_repo`, once the membership work is merged and
pulled there:

```bash
npx supabase@latest db push
```
It lists `0117_access_plans` and `0118_members_only_leagues`. Answer `Y`. Each one ends by calling
what it created as real roles, so a broken rule stops the push instead of reaching the site. Nothing
visible changes.

### 6.2 Deploy the function

```bash
cd /d C:\Users\Admin\Documents\website_repo && npx supabase@latest functions deploy billing
```
`supabase/config.toml` sets `[functions.billing] verify_jwt = false`, because Stripe cannot send a
Supabase JWT. The function checks signatures and callers itself. Check it from Command Prompt:

```bash
curl.exe -s -X POST https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/billing -H "Content-Type: application/json" -d "{\"action\":\"status\"}"
```
→ `{"configured":false,"connect":false}`. If you get `401` with `Missing authorization header`, the
gateway is still checking JWTs. Deploy again with `--no-verify-jwt` added.

### 6.3 The Stripe account: public details and a Terms page

Settings → Business → **Public details**: public business name **Epinoia**, a support email (a site
address, not a personal one), website `https://prophesyscouting.co.uk`, the business address (a
trader must give one before the contract), statement descriptor `EPINOIA`, and the **Terms of
service** and **Privacy policy** URLs. Checkout shows those links next to the pay button.

**The repo has no terms page yet. Write one first.** It needs to say who sells (Epinoia, or the
league on its own account), what each plan includes, the price per period including any VAT, that
it renews automatically until cancelled, that you cancel online in one step from Your account, the
14-day right to cancel and that it ends once access starts, refunds, and how to complain.

### 6.4 Customer Portal and subscription settings

Settings → Billing → **Customer portal** (this drives "Manage billing"):
- Update payment methods: on. Invoice history: on. Update email and billing address: on.
- **Cancel subscriptions: on, "At the end of the billing period".** The confirmation and
  end-of-contract emails promise that access lasts until the end of the period already paid for.
- **Switch plans: off. Change quantity: off.** A member's plan is recorded when they buy, and what
  they get comes from that plan. A switch made in the portal would change what they pay without
  changing what they get.
- Business information: a headline, the Terms and Privacy links, and the default redirect
  `https://prophesyscouting.co.uk/epinoia/me/`.
- **Save.** Until the portal settings are saved (once in test mode, once in live), Manage billing
  answers `the payment provider refused: …`.

Billing → **Subscriptions and emails** (called **Revenue recovery** on newer dashboards):
- Failed payments: Smart Retries for up to **1 week**, then **cancel the subscription**. The database
  lets a `past_due` member keep access for 7 days after the period ends. If retries run longer, Stripe
  keeps charging people who have already lost access.
- Customer emails for failed payments: **off**. `billing` already sends its own "update your card"
  email with the account link, so leaving Stripe's on means people get two.
- Upcoming renewal events: **on**, for example 14 days before. `billing` turns `invoice.upcoming` into
  the renewal reminder for yearly plans (DMCCA s.258). Monthly plans don't get one.

### 6.5 The webhook endpoint for your own account

Developers → Webhooks → **Add destination**:
1. Events from: **Your account**.
2. API version: **`2026-08-26.dahlia`**, exactly that. Stripe writes each event in the endpoint's
   version, not the function's. On any other version an invoice names its subscription in a
   different place and the period end moves. Payments would be recorded but would never reach the
   member.
3. Events: these seven. The function records and ignores anything else.
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`
4. Destination type: webhook endpoint. URL:
   `https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/billing/webhook`
5. Create it, then **Reveal** the signing secret (`whsec_…`). That is `STRIPE_WEBHOOK_SECRET`.

### 6.6 Secrets

Developers → API keys → **Secret key** (`sk_test_…` for now; the live key comes in 6.11). Then:

```bash
cd /d C:\Users\Admin\Documents\website_repo && npx supabase@latest secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… SITE_URL=https://prophesyscouting.co.uk/epinoia/ BILLING_TEST_EMAILS=you@example.com
```
**`BILLING_TEST_EMAILS` is who may buy while the key is a test key.** Put the address of the ordinary
account you will test with (6.9), and anyone helping you, separated by commas with no spaces. While
`STRIPE_SECRET_KEY` starts `sk_test_`, checkout lets through only platform admins and these addresses.
Everyone else gets `403 Payments are in test mode, so only the people testing them can buy for now`.
Without this, anyone who found the join page could "pay" with Stripe's published test card and get a
real membership in the database live mode shares. With a live key the list is ignored.

**Set `SITE_URL` to the `/epinoia/` root, not the bare domain.** `notify` and `ics` build every email
and calendar link by adding `game/…` or `me/` to this secret, so with `https://prophesyscouting.co.uk`
those links would point outside `/epinoia/`. `billing` reads only the origin, so one value works for
all three functions. If `npx supabase@latest secrets list` already shows `SITE_URL`, leave it out of
the command. `RESEND_API_KEY` and `CONTACT_FROM` are already set for `notify`, and `billing` sends its
emails with them. New secrets take effect without a redeploy.

Checks (Command Prompt):
- The status call from 6.2 now answers `{"configured":true,"connect":false}`.
- A webhook call with no signature:
  ```bash
  curl.exe -s -i -X POST https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/billing/webhook -d "{}"
  ```
  → `HTTP/1.1 400` and `a Stripe event carries a Stripe-Signature header, and this has none`. Before
  the secrets were set, this was a `503`.
- A checkout call without signing in (the status command with `{\"action\":\"checkout\"}`) →
  `401` and `sign in first`.
- Once a plan has a price (6.7): signed in on `/epinoia/join/` with an ordinary account that is **not**
  in `BILLING_TEST_EMAILS`, try to buy. The page says checkout could not start because payments are in
  test mode.

### 6.7 Products and prices

Product catalogue → **Add product**, one for each plan:
- Name: the plan's name.
- Price: **recurring**, **GBP**, exactly the plan's amount, billed **monthly** or **yearly** to match
  the plan.
- **Include tax in price: yes** (tax behaviour *inclusive*). The join page, the line above Checkout's
  pay button and the confirmation email all say "including any VAT". An *exclusive* price would add
  VAT on top once tax collection is switched on.

Save it and copy the price id (`price_…`). Then go to the platform console
`/epinoia/admin/platform/` → **Plans** → **new platform plan**. Give it the same name, price and
interval as the Stripe price, and paste the id into **STRIPE PRICE ID**. The plan is on sale from
then on (in test mode, only to the addresses in `BILLING_TEST_EMAILS`). Without an id it is listed
but can't be bought. A league plan that Epinoia sells (seller = platform) gets its price the same
way, in Epinoia's own account.

**The plan and the Stripe price must agree exactly.** Every checkout fetches the price first. It
refuses the sale (`409`) unless the price is recurring, billed every **1** month or every **1** year as
the plan says, for the same amount in the same currency, with tax behaviour **inclusive**. The page
then shows a sentence naming both prices, for example `This plan cannot be bought until its price is
put right: Stripe would charge £50.00 a year, but it is shown here as £4.99 a month`. Nothing is
charged, and no consent record or Stripe customer is created. To fix it, edit the plan to match the
price or paste the id of the right price. A Stripe price's amount can't be changed after it is
created, so for a new amount make a new price. The same check covers a test `price_…` id left in a
plan after the switch to live: `Stripe has no price with the id the plan names`.

### 6.8 Radar: GB cards only to begin with

Radar → Rules → add `Block if :card_country: != 'GB'`. At first the terms and VAT position are UK
only, and the rule also turns away most card-testing. Custom rules may require Radar for Fraud Teams,
which charges for each screened payment; if Stripe asks, decide then. Remove the rule when you start
selling abroad. In test mode the rule would also block `4242…`, which is a US test card. Either test
with the GB card `4000 0082 6000 0000`, or add the rule in live mode only.

### 6.9 Testing (test mode)

1. **End to end.** Sign in as an ordinary account whose address is in `BILLING_TEST_EMAILS`. Staff and
   admins never pay and already hold every feature, so they can't test a purchase. Open
   `/epinoia/join/`, choose the plan, tick both boxes and pay with `4242 4242 4242 4242` (any future
   date, any CVC, any postcode). Stripe sends you back
   to the page with `joined=1`, and the page waits for the webhook. Then check:
   - `/epinoia/me/` → Membership shows the plan as active, with its renewal date.
   - The confirmation email arrived. It gives the price per period, the automatic renewal, how to
     cancel, and quotes the consent wording.
   - The Plans tab counts one active subscription.
2. **Cancel.** Me → Manage billing → cancel. The end-of-contract email arrives once, the membership
   shows its end date (not "Renews on"), and access continues until then. Stripe's portal books the
   cancellation as a `cancel_at` date rather than the older `cancel_at_period_end` flag; both are
   recorded as cancelling.
3. **Deliveries.** Developers → Webhooks → the endpoint: every event should show `200`. With the
   Stripe CLI (run `stripe login` once), `stripe listen` prints events as they arrive, and
   `stripe trigger customer.subscription.updated` sends a real signed test event through the
   dashboard endpoint. It should answer `200`. Stripe's sample objects aren't linked to any member,
   so nothing is granted. If you see `400 the signature did not verify`, `STRIPE_WEBHOOK_SECRET` is
   not this endpoint's secret. Don't use `stripe listen --forward-to` against the function: the CLI
   signs with its own secret, which is not the endpoint's.
4. **Before going live**, cancel every test subscription immediately (Subscriptions → Cancel →
   immediately) and wait for the webhook to record it. Do the same in the test mode of every league's
   connected account that sold anything. Test and live share the database, so a test membership left
   `active` would never hear from Stripe again. The database stops honouring an active subscription
   a week after the last period end it was told about, so a forgotten one does run out, but a yearly
   test plan would take a year. Each row also records `livemode` (false for a test purchase), so a
   leftover can be found. Customers made in test mode are replaced automatically at that person's
   next live checkout.

### 6.10 Before any league sells on its own account

**Get an accountant's view on VAT first.** Under HMRC's digital-platform rules, Epinoia can count
as the VAT supplier of a league's memberships even when the league's own account takes the charge.
Get advice before the first league plan with seller = league goes on sale. The league console says
the same next to its Connect button. Until then, league plans are either sold by Epinoia
(seller = platform) or not sold at all.

Then:
1. Stripe → **Connect** → get started. In the platform profile, the leagues are the sellers and get
   the full Stripe dashboard.
2. Developers → Webhooks → **Add destination**:
   - Events from: **Connected accounts**.
   - API version: **`2026-08-26.dahlia`**.
   - Events: the same seven as 6.5, **plus `account.updated`**.
   - URL: the same `…/functions/v1/billing/webhook`.

   Reveal its signing secret and set it:
   ```bash
   cd /d C:\Users\Admin\Documents\website_repo && npx supabase@latest secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…
   ```
   The status call now answers `"connect":true`. Until this secret is set, checkout refuses a plan
   the league sells with `this league cannot take payments yet`, because nothing would ever record
   the payment.
3. Platform console → Plans → **Every league**: set the league's **Fee %** (10 by default).
4. The league admin opens their console → **06j Memberships & access** → **Connect a Stripe account**,
   finishes Stripe's onboarding and comes back to the console. Sales open once Stripe enables
   charges on the account.
5. In **its own** Stripe dashboard, the league:
   - creates its products and prices (tax inclusive, as in 6.7) and pastes the price ids into its
     plans in 06j. Checkout checks each price against its plan exactly as in 6.7, on the league's
     account;
   - **saves its own Customer Portal settings** (as in 6.4: cancel at the end of the period, no plan
     switching). Without that, Manage billing fails for its members;
   - **sets its own Subscriptions and emails settings** (as in 6.4). A league's subscriptions follow
     the league account's settings, not Epinoia's:
     - Failed payments: Smart Retries for up to **1 week**, then **cancel the subscription**. On "leave
       it past due", Stripe keeps charging members after the database has cut their access.
     - Customer emails for failed payments: **off**. Otherwise its members get Stripe's email as well
       as ours.
     - Upcoming renewal events: **on** (for example 14 days before). Without `invoice.upcoming`, the
       league's yearly members never get the renewal reminder (DMCCA s.258).

   Refunds and disputes are handled by the league, in its own dashboard.

### 6.11 Live mode

Switch the dashboard to live mode and repeat 6.3 to 6.8:
- the live API key;
- the live endpoint or endpoints and their secrets: `secrets set STRIPE_SECRET_KEY=sk_live_…
  STRIPE_WEBHOOK_SECRET=whsec_…`, plus the Connect secret if 6.10 is done;
- the portal settings, saved again;
- the products and prices, created again;
- **every price id in both consoles replaced with its live one.** A test price doesn't exist for
  the live key, so checkout refuses that plan with `Stripe has no price with the id the plan names`;
- the league accounts' own settings from step 5 of 6.10, saved again in live mode.

With the live key in place, the test-mode restriction switches itself off and anyone can buy.
`BILLING_TEST_EMAILS` is no longer read. Remove it with `npx supabase@latest secrets unset
BILLING_TEST_EMAILS` so it isn't left looking meaningful.

Then buy a plan once with your own card, repeat steps 1 and 2 of 6.9, and refund yourself from the
dashboard.

### 6.12 Last: switching memberships on

**This is the last step, and nothing before it gates anybody.** Everything in 6.1 to 6.11 (and
test purchases in 6.9) works with memberships switched off: plans can be bought, subscriptions and
grants are recorded, and leagues can set themselves to members only. None of it is enforced until
the master switch is on.

Wait until:
- a plan **can be bought in live mode** (the Plans tab no longer says "No platform plan can be bought
  yet", or the league selling its own plan shows payouts connected with charges enabled), and
- **payments are live** (6.11) and a live purchase has worked end to end.

Then:
1. Decide the analytics default first: Plans → **Analytics by default** → **members** or leave it
   `free`. While memberships are off this changes nothing for fans; it is what applies at step 2.
   Gating analytics with nothing to buy only takes them away from people. A sponsored league can
   stay free with its own override under **Every league**.
2. Plans → **Memberships: off** → **switch memberships on**. The confirm lists what starts being
   enforced straight away: the leagues set to members only (by name) and whether the analytics
   default is members. Read it, then OK.
3. Check as a signed-out visitor: a members-only league shows its paywall card, and (if the default
   is members) a box score's game flow tab shows the teaser.

Switching memberships **off** again opens everything at once and keeps every setting, so it is the
quick way back if something is wrong. People paying keep paying until they cancel: decide in
Stripe whether to pause, cancel or refund them. Switching the analytics default back to `free`
while memberships are on also takes effect straight away.

Making a league **members-only** is the league admin's switch, in 06j (the section says at the top
while memberships are off that nothing is enforced yet). Read the "not yet protected" list there
first: public storage URLs, open realtime channels, and broadcast overlays that go blank. A league
that streams should stay `open` for now.

## Where things are
| | |
|---|---|
| worker | `scripts/ingest/run_ingest.py` (feed → repo + Supabase + platform) |
| adapters | `scripts/ingest/adapters/` (FIBA LiveStats complete; others are stubs) |
| league bootstrap | `scripts/ingest/bootstrap_league.py` |
| event translator | `scripts/ingest/translate/` (roadmap Phase B) |
| dataset rebuild | `scripts/ingest/build_dataset.py` (local, needs the scraper folder) |
| schedule | `.github/workflows/ingest.yml` — every 30 min 12:00–23:30 UTC |
| vision worker | `scripts/worker/ai_worker.py` (+ `ai_worker.bat`, `worker.example.json`) — the PC side of AI process game |
| reader | `%USERPROFILE%\.claude\skills\playtype-vision\scripts\clock.py` (`auto` = probe, read, fuse) |
| memberships | `docs/memberships.md` (contract), `supabase/functions/billing/` + `_shared/billing.js` (Stripe), `epinoia/access.js`, `epinoia/join/` |
| roadmaps | `docs/live-data-roadmap.md`, `docs/epinoia-fiba-roadmap.md` |, `docs/ai-process-game-roadmap.md`, `docs/video-livestats-sync-roadmap.md`
