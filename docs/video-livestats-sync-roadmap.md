# Video ↔ FIBA LiveStats sync — roadmap

**Goal.** Attach a video (a recording or a stream) to a game that Epinoia is fed from FIBA
LiveStats, and have every play-by-play line know where it sits in the footage — click a play,
the video seeks there — with the manual "where is the jump ball on the scrub bar" step turning
into a one-click confirmation of a number the system worked out itself.

Written 2026-09-06, after the first day of live-fed BCB games. Everything under *What is
already true* was checked against the code and the live payload that evening.

## Status (built the same evening)

| phase | state | where |
|---|---|---|
| 0 — feed timestamps | **built** | `run_ingest.py` `write_event_log(observed=…)`: new events from the live lane carry `payload.wall` (poll wall clock, epoch ms) + `payload.wall_err` (poll interval + fetch time); a log replace carries earned stamps across by `(type, team, pid, period, clock)`; live lane polls every **10 s** (`--live-every 10`). Not yet seen on a real live game — the next BCB tip is 12 Sep; check `game_events.payload->>'wall'` on that day's first game. |
| 1 — find the tip | **built, partly verified** | `epinoia/videoanchor.js` + the attach-video sheet (`epinoia/game/game.js`): *from the stream's start time* (YouTube Data API — needs `youtubeApiKey` in `epinoia/config.js`, unset so far), *from a local copy of the footage* (MP4 `mvhd` / QuickTime metadata; verified on a real file in Node — YouTube downloads carry none), *read the scoreboard in the picture* (Tesseract vendored under `epinoia/vendor/tesseract`, ~11 MB, loaded on first use; automatic crop-finder over the usual overlay positions, then the first-period search + half-second refine). OCR verified on six synthetic scoreboard frames (93–96 % confidence, period labels included) and the crop search ran on real BCB footage (a highlights reel with no overlay, so no clock — the negative path). **Not yet run on a full broadcast with a clock overlay** — the first real game video will be the test. |
| 1b — the broadcast found by itself | **built, needs a key** | `scripts/ingest/auto_video.py`: with a `YOUTUBE_API_KEY` repo secret, the worker searches YouTube for both clubs within a day of tip-off (league channel first via `adapter_config.youtube_channel`), prefers a live stream and anchors it from `liveStreamingDetails.actualStartTime` + the first period_start's poll stamp — no human step at all. A plain upload is attached with `tip_at` known and the offset left to the scoreboard reader. LiveStats itself was re-checked for any timestamp remnant (data.json, bs.html, pbp.html, the webcast page): there is none. |
| 2 — seek from the play-by-play | **built** (seeking already existed) | `epinoia/game/video.js`: ±accuracy note from `wall_err`, per-play ↗ clip link (`watchHref` at the clip start), the nudge (+/−1 s, +/−5 s → `trim_ms` via `set_game_video`, admins only), and the tip's device stamp handed over on save (`p_tip_wall`) so fed plays are placed device-against-itself. |
| 3 — video → data | **first slice** | *export clips* on the video tab: `epinoia-clips/1` JSON (`seq, type, pid, team, period, clock_ms, at_ms, start_ms, end_ms, approx, err_ms, label` + video/gap) for the labelling studio or an editor. The studio-side import, sub-moment and shot-spot refinement are not built. |

## What is already true (and what is not)

- **The Genius payload carries no wall clock per play.** `data.json` actions have
  `period`, `gt` (game clock, mm:ss), `clock` (with hundredths), `actionNumber`, scores — and
  nothing that says *when* the play happened in the real world. The hosted schedule / LiveStats
  page only shows the *scheduled* tip ("Tip off: 6:30 pm GMT"), never the actual one. So the
  question "when did the broadcast start" cannot be answered by scraping the LiveStats page.
  The only clocks in the world that saw the plays happen are ours: the ingest worker's poll
  loop, and the video file / streaming platform.
- **Epinoia's video model already does the right arithmetic** (`epinoia/video.js`,
  `game_videos` row: `url`, `tip_at`, `stream_started_at`, `tip_offset_ms`, `trim_ms`).
  `gapMs()` = dead air before tip; `videoMsOf(event)` = gap + (event wall time − tip wall time).
  Event wall time is the row's `created_at` (or a device stamp in the payload). It also has the
  honesty test that matters here: a log whose first and last events are seconds apart was
  imported in bulk and is *not timed*, so no video can be anchored to it.
- **Live-fed games are timed by accident of design.** The keeper appends only the tail of the
  log every 30 s, so a fed event's `created_at` is within one poll of the real moment. A game
  backfilled after the fact (a refresh run, or a game first seen already final) is inserted in
  one go and correctly reads as untimed. The `replace` path (log rewritten when the prefix no
  longer matches) also destroys the timing — it re-inserts everything with a fresh `created_at`.
- **The game clock ≠ the video clock.** The game clock stops on every whistle; the video does
  not. So `period + game clock` can never be turned into a video position on its own — a
  per-play wall time is the only thing that works, which is why the poll-time stamps are the
  foundation of everything below, not a nice-to-have.

## Phase 0 — make the feed's timestamps first-class (worker only, no UI)

1. **Observed time on every fed event.** When the keeper sees a new action it stamps
   `payload.at` = the poll's wall time (ISO). Backfilled events get no `at`. `sinceTipMs` already
   prefers a device stamp when present, so this is one line in `translate/fiba_events.py`'s
   emitter path (the keeper passes the observation time down) and nothing on the page.
2. **Tighter live polling.** 30 s → 10 s while a game is live (the payload is ~200 KB; three
   requests a minute per live game is well inside the politeness budget the GameVis pre-scrape
   already uses). Timing error becomes ±10 s before any anchor is touched.
3. **Never re-stamp an already-observed event.** The replace path (prefix mismatch) must carry
   the old rows' `at`/`created_at` across by `(period, clock, type, pid)` match, and the
   worker's log must say when a log was replaced. Otherwise one hiccup on Genius's side
   (a corrected foul three plays back) silently un-times a game.
4. **A timing quality flag on the game** (`game_advanced.timing = {observed: n, bulk: n,
   poll_s: 10}`) so the page can say "this game's video will be accurate to about 10 s"
   instead of hoping.

## Phase 1 — find the tip-off in the video without asking

The page needs one number: where the ball goes up in the footage. Sources, in order of trust:

1. **A stream the platform started.** YouTube Live: `liveStreamingDetails.actualStartTime`
   from the Data API (one key, read-only, quota trivial). Twitch: VOD `created_at`. Facebook
   Live: `broadcast_start_time`. That is `stream_started_at`; the first observed
   `period_start` (Phase 0) is `tip_at`; `gapMs()` already computes the rest. Expected error:
   the platform's ingest delay (5–30 s) — a constant, so a single nudge fixes the whole game.
2. **A file somebody uploaded.** MP4/MOV carry `creation_time` (the `mvhd` atom; QuickTime and
   most phones/cameras/OBS write it). Read it client-side (a few KB of the file header, no
   upload needed to know it) and treat it as `stream_started_at`. Cameras' clocks drift by
   minutes, so this is a *proposal*, not an anchor, until Phase 2 confirms it.
3. **The scoreboard in the picture.** If neither exists, or the proposal looks wrong (Epinoia's
   `gapLooksOdd` already flags a gap outside 0–45 min), a short in-browser OCR pass on the
   broadcast's clock overlay: sample one frame every 2 s for the first few minutes, read the
   period/clock digits (tesseract.js, digits-only whitelist), and find the frame where the
   clock first reads 9:5x in period 1. That frame *is* the tip. Same trick at every period
   start gives four anchors instead of one and removes any drift between camera and clock.

The "attach video" sheet stays as it is; the only change is that its offset field arrives
filled in with the source named ("from the stream's start time" / "from the file's clock" /
"read off the scoreboard at 0:14:32"), and the person presses *use this* rather than typing.

## Phase 2 — seeking from the play-by-play

- **Click a play → seek.** `videoMsOf(event)` already exists; wire it to the play-by-play rows
  of a fed game the way the scorer's own games have it (the tab that lists plays "tap one to
  jump to it"). Pre-roll of 4 s so the viewer sees the possession, not just the make.
- **Show the confidence.** A play stamped by a 10 s poll is "~10 s"; one under an OCR anchor
  is "~1 s". A small "±10 s" beside the seek control is the honest version of a feature that
  otherwise looks precise and isn't.
- **Nudge once, apply everywhere.** If the first seek lands 8 s early, a "video is 8 s later"
  control adjusts `trim_ms` for the game (the model already has it). Per-period nudges if the
  broadcast dropped frames between periods (rare, but ITV-style regional streams do it).
- **Clips.** Every seek is also a `?t=` deep link (YouTube) or a `#t=` (HTML5), so a play can
  be shared as a clip from the match report — the same mapping, no new data.

## Phase 3 — the closed loop (video → data)

Once the video is anchored, the footage can *improve* the data, which is where this becomes
the play-type tracker's front door:

- **Substitution moments and dead-ball lengths** from the scoreboard OCR (the clock stops) —
  fixes the FIBA feed's period-boundary sub-pairing warnings without a human.
- **Shot-location refinement**: the FIBA feed's x/y is the statistician's tap; a frame at the
  release lets the labelling studio snap it to the real spot (Phase 1 of the playtype-vision
  plan already expects a frame per chance).
- **Broadcast-derived possessions**: the video clock + the feed's possession changes give a
  chance-level timeline the studio can tag, with the clip pre-cut.

## What each phase needs from you

| phase | needs | effort |
|---|---|---|
| 0 | nothing (worker only; Louie sees "timing: observed" on fed games) | half a day |
| 1 | a YouTube Data API key (free) for streams; nothing for files; OCR is client-side | 2–3 days incl. the OCR spike |
| 2 | nothing new — it is UI over the existing model | 1–2 days |
| 3 | the labelling studio work already planned | later |

## Not doing

- Scraping the LiveStats HTML for a start time — it has none (checked 2026-09-06).
- Trusting `created_at` on backfilled logs — the honesty test stays; an untimed game says so
  and offers the scoreboard OCR route instead.
- Server-side video processing — everything that reads the video runs in the viewer's browser
  on the file or the embedded player; nothing gets uploaded to Supabase but the anchor numbers.
