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
| roadmaps | `docs/live-data-roadmap.md`, `docs/epinoia-fiba-roadmap.md` |, `docs/ai-process-game-roadmap.md`, `docs/video-livestats-sync-roadmap.md`
