# "AI process game" — one click, everything else autonomous

Goal: an admin opens a game page, presses **AI process game**, and walks away. The site
finds the stream, reads the picture, decides for itself whether it is looking at a game clock,
a score, or both, places every play by its own game clock, and the page updates live while
it works. Later the click itself disappears: a final game with an attached video is processed
on its own.

Where things stand (2026-09-07, evening): **phases 0–4 are built.** Migration 0100 (queue,
request/cancel/claim), the button and live card on the game page, `scripts/worker/ai_worker.py`
with its batch file and config template, `clock.py auto` (probe → clock / score / clock+score /
none, with score anchors correcting the clock), and the ingest queueing every final fed game with
a stream. Switch-on steps are in `switch-on.md` §4g. Phase 5 remains optional. The text below is
the design as built.

## The one constraint that decides the shape

The frames must be decoded somewhere that can (a) download the YouTube stream and (b) run the
PARSeq reader at a reasonable pace.

- **GitHub Actions / cloud IPs**: YouTube answers `LOGIN_REQUIRED` to yt-dlp from datacenter
  ranges (seen on the ingest runner). Cookies work for a while and then break. Not a base.
- **The browser**: the embedded player is cross-origin; its pixels cannot be read. Only a
  self-hosted mp4 with CORS could be read in-page (ONNX Runtime Web). Possible later, not first.
- **Louie's PC**: residential IP, GTX 1660 SUPER, yt-dlp and the skill already installed. A
  full 128-minute stream in score mode took ~50 minutes at step 2; clock mode is similar.

So: **the website is the control plane, Supabase is the queue, a small worker on the PC is the
muscle.** If the PC is off, the job waits and the page says so. Nothing else changes for the
user — it is still one button on the website.

```
game page (admin)  --request_video_job-->  video_jobs (Supabase, realtime)
        ^                                        |
        | live progress, track lands, page       | picks up queued jobs
        | re-derives itself                      v
   game_videos.clock_track  <--set_video_clock_track--  ai_worker.py (PC, GPU)
                                                          yt-dlp -> clock.py auto -> harvest
```

## Phase 0 — queue (migration 0100)

`video_jobs`: `id, game_id, video_url, kind ('clock_track'), status
(queued|claimed|running|done|failed|cancelled), mode_requested ('auto'), mode_used
(clock|score|clock+score|none), progress jsonb ({i, n, stage, last, accepted}), result jsonb
(samples, periods, matched, seen), error, requested_by, requested_at, worker, claimed_at,
finished_at`. Realtime enabled on the table.

RPCs: `request_video_job(p_game)` (league admin / admin; refuses when a job for that game is
queued or running; re-runs allowed once done/failed), `cancel_video_job(p_job)`. The worker
writes with the service key and uses `claim_video_job(p_worker)` (`for update skip locked`,
oldest first) so two workers never take the same job. RLS: admins read their leagues' jobs;
nobody but the service key updates.

## Phase 1 — the button and the live view (game page)

In the attach-video sheet, above the manual rows: **AI process game**. Visible to league admin
and admin once a video URL is saved. Click → `request_video_job` → the sheet turns into a
progress card fed by a realtime subscription on that job:

- `queued` — "waiting for the processing machine" (with how long it has waited; the worker
  heartbeats to a `workers` row so the card can say "worker last seen 3 min ago" honestly)
- `running` — stage (downloading 720p · finding the overlay · reading), % of frames, the last
  reading, and the mode it chose: *clock*, *score (no clock on screen)* or *clock + score*
- `done` — "88 readings across 4 periods; plays now seek by game clock" and the sheet's
  existing "readings on file" line updates; `mountVideo(derive())` re-runs so seeking is live
- `failed` — the error, and a **retry** button

The manual rows stay (tip anchor, OCR, import a file) as the fallback for odd streams.

## Phase 2 — the worker (`scripts/worker/ai_worker.py`)

Plain Python, torch-free, runs on the PC at logon as a scheduled task (`ai-worker.bat` +
`schtasks` line in `switch-on.md`). Config from `%APPDATA%\epinoia\worker.json`: Supabase URL
+ service key, skill scripts path (`C:\Users\Admin\.claude\skills\playtype-vision\scripts`),
download dir (`D:\Download\bcb_streams`), keep-video flag.

Loop, every 20 s (or on a realtime notice):

1. `claim_video_job(worker_id)`; heartbeat `workers` row.
2. **Fetch**: YouTube → `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]"` into the download
   dir, resume-safe; mp4 URL → stream download. Progress stage `downloading`.
3. **Play-by-play**: the game's raw feed (`feed/fiba_livestats/<id>.json` in storage), fetched
   fresh so a re-run after the log is corrected uses the corrected log.
4. **Read**: `clock.py auto` via `sys.path` import. Progress callback → `progress` every ~5 s
   (i, n, last reading, accepted). The worker also applies the download's `startTimestamp`
   as a sanity check on the first anchor (a reading 40 min from the true tip is a mis-crop).
5. **Write**: `set_video_clock_track(game, track)` with the same `epinoia-clock-track/1` body
   the file import saves; `result` filled; `done`.
6. **Learn** (low priority, skipped if another job is queued): `auto_labels.py harvest` on
   the same file over the windows around every made basket in the log (the score events tell
   it where the shots are, so rims get harvested too — the blind 3-minute slice found none).
   Then delete the video unless keep-video is set.

Failure handling: any exception → `failed` with the message; download failures retry twice
with backoff; a job `claimed` for over an hour without heartbeat is re-queued.

## Phase 3 — auto-adapt: clock, score, or both

`clock.py auto` today probes a few frames for a clock and falls back to score mode. Make the
decision continuous rather than one-shot:

- Probe at 5 points spread through the file (not the first minutes — pre-game graphics differ).
- **Clock found** → clock mode, and *also* track the score whenever the overlay shows one:
  each matched score change becomes a hard anchor that overrules drift and confirms the
  period, so a mis-read period label self-corrects within one basket. Mode `clock+score`.
- **No clock, score found** → score mode (as now). Mode `score`.
- **Neither** (camera-only stream) → `none`: fall back to the tip anchor from the stream's
  `startTimestamp` + the timed log, and say so on the card.
- Overlay changes mid-stream (broadcast switches graphics after half-time) → re-probe when
  readings stop landing for 3 minutes.

The per-broadcast glyph bank (`corpus/clock_templates`) already keys on the channel; the
worker passes the channel id so BCB, Hemel and every new league grow their own bank.

## Phase 4 — no click at all

In `run_ingest.py write_platform`, when a game goes **final** and `sync_videos` has attached a
stream (or when a video is attached to an already-final game), call `request_video_job`
automatically with `requested_by = 'ingest'`. The button then only matters for re-runs. A
league setting `auto_process_video` (default on) turns it off per league.

## Phase 5 — later options

- **In-browser processing for uploaded mp4s** (ONNX Runtime Web + the PARSeq weights, WebGPU
  where available): no worker needed for self-hosted files. Only worth it once uploads exist.
- **Cloud fallback** for when the PC is off for days: a GitHub Actions job that processes
  jobs whose video is an mp4 URL (not YouTube), CPU-only, step 4.
- **Second machine**: the claim RPC already allows it; any PC with the skill can run the worker.

## Order and effort

| Phase | What lands for the user | Size |
|---|---|---|
| 0 + 1 | The button, live progress, track appears on the page | migration + game.js, ~1 day |
| 2 | The PC worker that makes the button do something | new script + task, ~1 day |
| 3 | Clock+score fusion and mid-stream re-probe | clock.py, ~half a day |
| 4 | Fully autonomous on final | run_ingest.py, ~1 hour |
| 5 | Optional | — |

Phases 0–2 are one unit; ship them together. Phase 3 improves accuracy on clocked broadcasts;
phase 4 removes the click.

## Decisions Louie owns

1. **The worker runs on your PC** (recommended; free, GPU, no YouTube blocks). Alternative is
   a paid GPU box with residential-proxy download, which is money and fragility for no gain
   until you are processing several games a night.
2. **Keep downloaded streams?** 720p is ~1.5 GB per game. Default: delete after harvest.
3. **Auto-process every final game** (phase 4) or keep it a click per game.
