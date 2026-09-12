# Fed-game timing: how accurate a play's time of day can be, and the plan to get there

Written 2026-09-12 from a design study: grounding measurements, three competing designs,
two independent judges, and a synthesised plan. The question was whether every LiveStats
event (a shot, the first tick of the clock) can carry a true time of day to place it in the
YouTube stream.

**The finding that changes the answer:** data.json is served through CloudFront with
`Cache-Control: max-age=30`, and a query string does not bypass it. Measured on four live
games: a new version appears every 26-35 s however often it is asked for. Polling faster
alone cannot get a play below about 15 s. Stamping with the response's `Last-Modified`
and pulling each action back by the game clock within its version gets an honest window
of about 26 s (expected lateness about 13 s) with no schema change. Only the vision
worker reading the clock off the footage reaches 1-2 s.

---

# Epinoia fed-event timing: build plan

The plan builds on Design 3: stamp each action when it first appears, dated by the feed's `Last-Modified`, and pulled earlier using the game clock within that version. Six ideas are grafted in from the other designs and the judges. Each step below ships on its own and keeps today's path as its fallback.

**Grafts**
- **Observer inside the loop, not a thread.** The observer polls between writes in the existing loop. It only becomes a daemon thread if step 2's measured poll gaps require it.
- **Lower edge from unchanged rewrites (Design 1).** A 304 that carries a newer `Last-Modified` narrows the lower edge. It is capped at 60 s.
- **Cross-version chaining (Design 1).** Kept as the last step, and only if footage calibration shows the lower bounds hold.
- **Judges' fixes.**
  - Test `_ans is None`, not `_ans or [...]`.
  - Skip older CDN copies.
  - Update the source-regex guard in `ingest-replace.test.mjs`.
  - New stamping code falls back to today's behaviour if it throws. `write_platform` swallows `write_event_log` exceptions (`run_ingest.py:623-626`) and the hash is marked anyway (`:1130`), so an exception there would otherwise freeze a live log with no error shown.
- **From Design 2.**
  - Feed-derived data never goes into `game_videos.clock_track`, because a non-null track stops the vision job being queued (`run_ingest.py:528-529`).
  - Deploy between match nights.
  - For recordings with a typed offset (`video.js:236-237`), the tip error does not cancel.
- **Not built:**
  - the samples table and page-side run inference (Design 2's fatal flaw);
  - the identity cache key;
  - persisted GameClock state;
  - storing clock tenths in rows, which would break the carry key at `:820`/`:848`.

## How accuracy is measured in this plan

I replayed `supabase/tests/fixtures/feedtiming/probe3.jsonl.gz` with `tools/feedtiming/steps_sim.py` (new this session).
- **Data:** 4 live BCB games, about 15 minutes, gzip cache key, polled every 3 s. Slower cadences are simulated by subsampling.
- **Window W:** the honest hard interval `[lo, hi]` for each action.
  - `hi` = a moment the play cannot be later than (keyed ≤ upload).
  - `lo` = the last upload known not to contain it.
- **Lateness:** the truth lies in `[hi − W, hi]`. The one exception is keying lag K (inferred 1–2 s, unmeasured), which can put the truth slightly before `lo`.
- **Expected lateness ≈ W/2.** This assumes the play is uniformly placed in the window, which is unverified.
- **Clip containment.** A clip opens `ROLL_pre + LEEWAY 2 s + min(wall_err, 15 s)` before the stamp (`video.js:385-399`, `:408`, `:423-427`).
  - Made three: 9.5 + 2 + 15 = **26.5 s**. Made free throw: 6 + 2 + 15 = **23 s**.
  - "Containment" is the mean over the replayed actions of min(1, threshold / W), under the uniform assumption. The figure in brackets allows K = 2 s.
- Nothing here has been compared against footage. Constant biases are invisible in this replay: keying lag, the Genius pipeline, and YouTube `actualStartTime`.

**Measured windows by step (seconds)**

| Step | Shots (median / p25 / p90) | Other live-ball | Dead ball (FT, sub, timeout, period) | Three in clip | FT in clip |
|---|---|---|---|---|---|
| Today (stamp = receive time, ~38 s loop) | 76 / 70 / 168 | 76 / 71 / 132 | 81 / 72 / 258 | ≈0.35 (26.5/76) | lower |
| 1: Last-Modified stamp, same loop | 62 / 55 / 144 | 61 / 55 / 123 | 66 / 58 / 242 | 0.38 (0.35) | 0.30 |
| 2: observer, 5 s polls | 29 / 26 / 53 | 29 / 28 / 56 | 33 / 29 / 206 | 0.85 (0.79) | 0.57 |
| 3: per-action stamp with clock pull | 26 / 19 / 45 | 27 / 22 / 51 | 33 / 28 / 206 | 0.90 (0.86) | 0.60 |
| 4: 304 lower edge, 60 s cap | 26 / 19 / 37 | 27 / 22 / 45 | 29 / 26 / 46 | 0.91 (0.88) | 0.76 |
| 5: page run-up cap raised to 30 s | stamps unchanged | | | 0.98 (0.98) | 0.96 (0.95) |
| 7: cross-version envelope (anal3, both keys) | 18 / 9 / 28 | 18.5 / 12 / 29 | 29 / 25 / 34 | ≈1.0 | |

Today's stored `wall_err` is the poll gap (median 37.9 s), but the honest window is about 76 s, so today's error bar understates.

---

## Step 0: Save the evidence (15 min, no live effect) - DONE 2026-09-12

The session scratchpad was temporary, so these were copied into the repo:
- `probe3.jsonl` (gzip it; about 1.1 MB raw) and `feed.json` → `supabase/tests/fixtures/feedtiming/`
- `steps_sim.py`, `anal3.py`, `probe3.py` → `tools/feedtiming/`
- A golden translation of `feed.json`: the output of `translate()` today, saved as JSON. Step 3 uses it to prove rows did not change.

---

## Step 1: Stamp with Last-Modified inside today's loop (about half a day)

This is the cheapest step: about 40 lines, no threads, and no change to `write_event_log`.

**Change**
- **`adapters/base.py` `GameBundle` (`:32-48`):** add `feed_lm_ms: Optional[int] = None` and `feed_recv_ms: Optional[int] = None`. Both have defaults, so this is additive.
- **`adapters/fiba_livestats.py`:**
  - Add `_get_meta(url) -> (raw, {"lm_ms", "recv_ms"})`, a copy of `_get` (`:213-222`) that keeps `r.headers["Last-Modified"]`.
  - `fetch` (`:224-231`) calls it and sets the two new fields.
  - `bundle_from_raw` is unchanged, so the discovery lane is unaffected.
- **New `scripts/ingest/feedstamp.py`** (standard library only, no I/O):
  - `lm_ms(header) -> int | None` via `email.utils.parsedate_to_datetime`.
  - `version_stamp(lm_ms, recv_ms, last_lm_ms) -> {"stamp_ms", "basis": "lm" | "recv", "older": bool}`.
  - Use `lm` only when `recv − 120000 ≤ lm ≤ recv + 2000`. Then `stamp_ms = lm + 999`, because S3 truncates `Last-Modified` to whole seconds and the stamp must stay a hard upper bound. Otherwise `stamp_ms = recv`.
  - `older = last_lm_ms is not None and lm < last_lm_ms`.
- **`run_ingest.py` `live_keeper`:**
  - Keep `last_lm: dict[str, int]`.
  - After the fetch at `:1100`, compute `vs = version_stamp(...)`.
  - If `vs["older"]`, print and `continue` before the hash check at `:1105`. That stops an older CDN copy from being written, which today could rewrite the log backwards. That failure is possible but not observed on a single cache key.
  - `:1119` becomes `observed = (vs["stamp_ms"], <configured err as today>)`, and `last_lm[xid]` is updated after the write.
  - `observed[1]` stays the configured interval, so the `fast` line at `:918` and its guard regex do not change.
- **Dry-run print (~`:1296`):** add `lm=` and `recv−lm=`.

**Tests**
- **New `supabase/tests/feedstamp.test.mjs`.** It spawns `python scripts/ingest/feedstamp.py --eval` (`spawnSync`, JSON cases on stdin, JSON results on stdout) and asserts:
  - a valid header gives `lm + 999`;
  - a missing header gives recv;
  - a header 130 s old gives recv;
  - a header 5 s in the future gives recv;
  - an older header sets `older: true`.
- Add a guard step `node supabase/tests/feedstamp.test.mjs`. Python already runs on the guard runner (`guard.yml:72`).
- Add a guard step `python -m py_compile scripts/ingest/run_ingest.py scripts/ingest/feedstamp.py scripts/ingest/adapters/fiba_livestats.py`. Today a syntax slip in the ingest only shows up on match night.
- Extend `ingest-replace.test.mjs` with source asserts:
  - `version_stamp(` is used in `live_keeper`;
  - `observed = (vs["stamp_ms"]` is present;
  - the older-copy `continue` comes before `hashes[xid] = b.payload_hash`.
  - All existing asserts must still pass.
- **Manual:** `python scripts/ingest/run_ingest.py --dry-run --ids <live xid> --source <code>` should print `recv−lm` between 0 and 30 s.
- **Pushing:** edits under `.github/workflows` need the `gh auth git-credential` push path in this repo, not the stored PAT.

**Live write path**
- Only the value of `observed[0]` changes, plus older copies are skipped.
- The existing newest-wall rule (`:767-780`) then computes `err = this LM − the previous stamped LM`, which is the honest window, with no new code.
- Deploy between match nights. For a game live across the deploy, the new stamps are about 12 s earlier than its receive-time stamps, `real` goes negative, and one batch gets the configured 10.5 s error.

**Accuracy after step 1 (running and stoppage behave the same here, because the ~38 s loop dominates)**
- Every stamp moves earlier by `recv − LM`: median **12.4 s**, p90 19.8 s (replay at 38 s cadence).
- Window: shots median 62 s, dead ball 66 s. Expected lateness ≈ 31–33 s, but now inside an honest bar.
- Containment: three 0.38, FT 0.30.
- Period breaks push about 9–15% of rows past 180 s. Those are declined, as today's rule already does across breaks.

---

## Step 2: Poll between writes, so no stamp waits for Supabase (about 1 day, plus 2b)

**Change**
- **`feedstamp.py`, pure state machine:**
  - Per-game state: `{etag, lm_ms, lm_seen_ms, version, changed_at_ms, last_poll_ms, max_poll_gap_ms}`.
  - `accept(state, status, lm_ms, etag, recv_ms, has_body) -> (state, event)`, where event is one of `new | same | older | lm_invalid | error`.
  - A 200 with a new ETag and a newer `Last-Modified` increments `version` and sets `stamp_ms` from `version_stamp`.
  - An older `Last-Modified` is ignored and the stored raw is kept.
- **New `scripts/ingest/feed_observer.py` (the I/O part):**
  - `FeedObserver(session=requests.Session(), gap_s=0.3, timeout=(3.05, 5))`.
  - `.observe_due(xids, every_s=5, armed_every_s=fast_every)` does conditional GETs (If-None-Match, gzip key only) on every game whose last poll is older than its interval. It parses JSON only on `new`.
  - `.take(xid) -> Snapshot(raw, version, stamp_ms, changed_at_ms)`.
  - `.stats(xid)` returns polls, 304 share and max poll gap.
  - CLI: `--watch ids --minutes N --every S --out file.jsonl`. It needs no Supabase, prints each version, and records rows in probe3's shape, so it also produces new fixtures.
- **`live_keeper` (replaces `:1096-1119` and the sleep at `:1136-1138`):**
  - Create the observer after `:1051` unless `EPINOIA_OBSERVER == "0"`. With the switch at `"0"`, the step-1 inline fetch runs as the kill switch.
  - Call `observer.observe_due(...)` at the top of each loop and after every `write_platform` call.
  - For each due game:
    - `snap = observer.take(xid)`.
    - If `snap.version == written.get(xid)`, run only the stale-final check, using `snap.changed_at_ms` and a cached `last_bundle[xid]`.
    - Otherwise run `b = adapters[code].bundle_from_raw(snap.raw, xid, cfg)`, set `b.tipoff_at`, do the hash compare as at `:1105`, set `observed = (snap.stamp_ms, configured)`, write as at `:1123`/`:1127`, then `written[xid] = snap.version`.
  - Sleep 1 s when there is nothing to write.
  - Print one summary line per game at the end of the pass: polls, 304 share, max poll gap, median write seconds.
- **`ingest.yml` env:** `EPINOIA_OBSERVER: ${{ vars.EPINOIA_OBSERVER }}`, so the switch is flipped from repo settings without a commit.
- **2b (1 hour, separate commit):** `Supabase` (`run_ingest.py:64-105`) gets `self.s = requests.Session()`, and every method uses it. The loop is single-threaded, so this is safe. It shortens writes, and write length is now the only thing that stretches the gap between polls.

**Tests**
- `feedstamp.test.mjs` `accept` cases:
  - a new 200;
  - a 304 (content unchanged, version unchanged);
  - a 200 with the same ETag;
  - an older `Last-Modified` (ignored);
  - a missing `Last-Modified` (recv basis);
  - `changed_at` moves only on new content.
- **Replay:** `python scripts/ingest/feedstamp.py --replay supabase/tests/fixtures/feedtiming/probe3.jsonl.gz --every S`. Assert:
  - every version is seen at S = 5, 10 and 15;
  - the shot window median is ≤ 30 s;
  - S = 25 loses versions, which documents the budget.
- **`ingest-replace.test.mjs` source asserts:**
  - `observe_due(` appears at least twice in `live_keeper`;
  - `EPINOIA_OBSERVER` is present;
  - `bundle_from_raw(snap.raw` is present;
  - `.fetch(` is reachable only in the kill-switch branch.
- **Manual on a live evening, no Supabase:** `python scripts/ingest/feed_observer.py --watch <ids> --minutes 10`. Expect `Last-Modified` gaps of 26–36 s and poll gaps of about 5 s.
- **Production evening, decision gate:** read the summary lines. If the max poll gap is over 15 s in more than about 5% of intervals, ship 2b. If that is still not enough, move `observe_due` into a daemon thread (Design 3's original). The state is already a plain dict, so that change only needs one lock.

**Live write path**
- The fetch leaves the write loop.
- Writes still happen once per new content.
- `bundle_from_raw` (SHA-1 plus the stints pipeline, `fiba_livestats.py:235-242`) no longer runs on unchanged polls.
- Requests to Genius go to about 0.2 per second per game, almost all empty 304s (91% in probe3).
- `write_event_log` is untouched, and the stale-final rule is preserved.

**Accuracy after step 2**
- **Running clock:** window median 29 s (p90 53) → expected lateness ≈ 14.5 s. Three containment 0.85 (0.79). At a 10 s cadence the replay gave 0.77.
- **Stoppage:** median 33 s (p90 206, mostly period breaks) → ≈ 16.5 s. FT containment 0.57.
- The replay says a 10–15 s cadence gives the same medians as 5 s; 20 s and slower loses dead-ball versions (median 33 → 56 s).

---

## Step 3: Stamp each FIBA action when it first appears, pulled by the clock (about 1.5 days)

**Change**
- **`translate/fiba_events.py`:**
  - `emit(t, team=None, pid=None, period=None, clock=None, _ans=None, **payload)` (`:131-134`) sets `ev["_ans"] = [cur_an] if _ans is None else list(_ans)`.
  - `cur_an` is set next to `an` at `:163` and initialised to `None` before the loop.
  - `loc`, `stype` and `tag` inherit their shot's `an` automatically, because they are emitted in the same iteration (`:184-196`).
  - `pending_subs` groups (`:255-257`) also collect `an_out` and `an_in`, and `flush_subs` (`:150`) passes `_ans=[an_out, an_in]` explicitly. This is required: flush runs during the next action's iteration (`:166-167`), so the default would pick up the wrong number.
  - The fabricated fouled-out sub (`:272`) passes `_ans=[]`.
  - `game_rows` (`:288-291`) copies named keys only, so `_ans` never reaches the database.
- **`feedstamp.py`:**
  - `stamp_version(gstate, pbp, lm_ms, prev_lo_ms, baseline)` fills a write-once `gstate["stamps"]: {an: [hi, lo] | None}`:
    - The first 200 for a game in a process is the baseline: every action is marked known and no stamps are made.
    - Elapsed time `el` comes from `ev["clock"]` read as mm:ss:cc, falling back to `clock_ms(gt)`. It uses `period_of` and `PLEN` (`:30`, `:79-83`). A `period_start` row takes the period base.
    - A new action with `el < maxel_prev − 3000` is a late entry and gets `None`.
    - Otherwise `E_i` = the largest `el` among actions in this version with an actionNumber ≥ i. Then `hi = lm_ms + 999 − (E_i − el_i)` and `lo = prev_lo_ms`.
    - If `hi − lo > 180000`, the stamp is `None`.
    - Versions with `lm ≤` the previous one are skipped.
  - `row_stamp(ans, stamps)`:
    - every an stamped → `("mem", {"wall": min hi, "wall_err": max(2000, min_hi − max_lo)})`;
    - any `None` → `("decline", None)`;
    - any unknown an, or `[]` → `("none", None)`, which falls back to the poll stamp.
- **Observer:** calls `stamp_version` on each new version and exposes `.stamps(xid)` as a copy.
- **`write_event_log(..., observed=None, stamps=None)`:** `write_platform` passes it through at `:623`. After `:735`, `ans = [e["_ans"] for e in T["events"]]`. The whole new block sits inside `try/except`; on failure it prints `! feedstamp: …` and runs today's logic.
  1. **Same-prefix tail:**
     - `mem` → apply the memory stamp;
     - `decline` → leave the row unstamped;
     - `none` → today's poll stamp.
  2. **Refill:** if any existing row has no `payload.wall` but `row_stamp` returns `mem`, take the rewrite branch. This covers rows the discovery lane wrote unstamped (`:1313`).
  3. **Rewrite branch:** apply `mem` stamps after the carry (`:816-854`) and let them overwrite it. Memory is write-once, so this is the same value when it was carried from memory. The fresh-stamp loop (`:856-859`) skips declined rows. The upsert at `:892-893` is unchanged.
- **`live_keeper`:** passes `stamps=observer.stamps(xid)`.

**Tests (all via `feedstamp.test.mjs` spawning python)**
- **Translator** on `fixtures/feedtiming/feed.json`:
  - every event has `_ans`;
  - `loc`/`stype`/`tag` carry their shot's an;
  - every paired sub has 2 ans, and the fabricated sub has `[]`;
  - `game_rows` output has exactly the 8 named keys;
  - seq, t, team, pid, period and clock equal the step-0 golden file.
- **`stamp_version` hand cases:**
  - the clock pull;
  - a late entry;
  - baseline;
  - `period_start` pulled toward the first tick;
  - write-once;
  - over 180 s;
  - an older copy;
  - final-minute tenths.
- **`row_stamp` cases:** all-known, a `None`, an unknown, and `[]`.
- **Replay fixture:**
  - no row with `hi` more than 1 s after the first containing `Last-Modified`;
  - no row with `hi < lo − 2 s` (the replay shows one at −1 s, an assist in 2887012, inside the slack);
  - shot window median ≤ 27 s.
- **`ingest-replace.test.mjs` source asserts:**
  - memory stamps are applied after the carry;
  - declined rows are excluded from the fresh stamp;
  - the try/except fallback is present;
  - the existing `for r in rows[len(existing):]:` and carry-key asserts still pass.
- **Shadow evening:** set `vars.EPINOIA_STAMPS=shadow` (env as in step 2). Memory stamps are computed and printed per batch next to the poll stamp but not written. Then switch to `on`.

**Live write path**
- No schema change, and payload keys are unchanged. I grepped `supabase/**/*.sql` and `*.ts` and nothing reads `wall`/`wall_err` there.
- `auto_video.tip_instant` (`auto_video.py:415-430`) and `video.js` consume the result unchanged.
- Late-entry rows become unstamped where today they get a poll stamp. `fillGaps` interpolates them and marks them approximate.
- Refill upserts in place and never deletes.

**Accuracy after step 3**
- **Running clock:**
  - window median 26 s (p25 19, p90 45) → expected lateness ≈ 13 s + K;
  - three containment 0.90 (0.86);
  - the pull moves stamps a mean of 5.6 s earlier (Design 3's replay; half of actions move 0).
  - Coalesced writes no longer widen stamps.
  - The P1 tip row is pulled toward the first tick. That matters for recordings, where the tip error does not cancel (`video.js:236-237`, `:305-310`).
- **Stoppage:** median 33 s (p90 206) → ≈ 16.5 s. FT containment 0.60. The pull rarely helps dead balls.

---

## Step 4: Unchanged rewrites narrow the lower edge (2–3 hours)

**Change**
- In `accept`, a 304 (or a 200 with the same ETag) whose `Last-Modified` is newer sets `lm_seen_ms = min(lm, lm_ms + 60000)`.
- `stamp_version` takes `lo = lm_seen_ms` of the previous content.
- The 60 s cap guards against an unobserved case: the venue device goes offline while Genius keeps rewriting stale content. In the replay, caps of 30, 60 and 90 s gave the same medians.

**Tests**
- `accept` cases: extend, cap, no extension on a new ETag.
- Replay: dead-ball p90 ≤ 50 s, and contradictions stay at the single −1 s case.

**Live write path:** none, only the numbers change.

**Accuracy after step 4**
- **Running clock:** shots 26 s (p90 37, max 63) → ≈ 13 s; other live-ball 27 s (p90 45). Three containment 0.91 (0.88).
- **Stoppage:** 29 s (p25 26, p90 46, max 56) → ≈ 14.5 s. FT containment 0.76 (0.71).
- No replayed row exceeds 180 s. Before this step, 11% of dead-ball rows did, at period breaks.

---

## Step 5: The page tells the truth about the new bars (about half a day, page only)

**Change**
- **`epinoia/game/video.js` `accuracyMs` (`:408-417`) and label (`:387`):** report the median `wall_err` alongside the worst. The label currently says "±worst", which would read 46–56 s because of dead balls. `wall_err` is one-sided, so word it as "plays happened up to N s before the mark".
- **`epinoia/video.js` `clipOf` (`:423-427`):** raise the run-up cap to 30 s, but only for rows with `wall_err > 15000` (fed stamps). Scored games keep 15 s.
  - This is the owner's call. The cost is up to 41.5 s of run-up for a three (9.5 + 2 + 30).
  - The gain, by the same arithmetic: three containment 0.91 → 0.98, FT 0.76 → 0.96, sub 0.95.

**Test:** extend `videosync.test.mjs`:
- a `p3_made` and an `ft_made` whose truth is a full 29 s before the stamp (`wall_err` 29000) lie inside their clip;
- a scored-game row keeps the 15 s cap;
- the existing tip-cancel asserts are unchanged;
- the label shows the median.

**Live write path:** none.

---

## Step 6: Calibrate against footage (one evening plus half a day; needs YOUTUBE_API_KEY)

**Change**
- Extend the vision worker's `wall_check` (`scripts/worker/ai_worker.py:559`, which today reports the median and spread). Add, split into live-ball and dead-ball groups, the share of plays whose OCR position lies inside `[stamp − wall_err − 2 s, stamp + 1 s]`.
- **Outputs:**
  - the constant bias per game: keying lag, the Genius pipeline, and the YouTube `actualStartTime` offset. Apply it via `trim_ms` or a league default.
  - whether the lower bounds actually hold.
- **Verification:** the evening's `wall_check` output itself. The ingest side has no Python harness, so keep the new share calculation a pure function and cover it with one `--eval` case in the style of `feedstamp.test.mjs`.

---

## Step 7: Cross-version envelope, only if step 6 coverage is at least 95% (about 1 day)

**Change**
- `stamp_version` gains Design 1's algebra:
  - upper points per version (the top-level clock is used only as an upper bound, because it is stale in 9 of 110 pairs);
  - upper points per action at first sight;
  - lower points chained along (elapsed, actionNumber).
- If `lo > hi`, fall back to the step-4 interval.
- No GameClock persistence: pass handover keeps the baseline rule.

**Test:** replay with 0 contradictions at G = 0, and a shot median ≤ 19 s.

**Accuracy after step 7**
- anal3 on both cache keys (G = 0, K = 0): shots 18 s (p25 9, p90 28) → ≈ 9 s; other live-ball 18.5 s; dead ball 29 s (p90 34), which does not improve.
- A gzip-only run was not measured and is probably slightly wider.
- Only the vision worker's footage clock track reaches 1–2 s. No feed-only step does.

---

## What still needs YOUTUBE_API_KEY

- **Placing plays in the video at all.** `auto_video.attach` returns early when neither `adapter_config.youtube_channel` nor the key is set (`auto_video.py:434-435`). Without a video row there is no `stream_started_at` and no position. I did not check whether a channel alone finds streams without the key.
- **Footage ground truth.** The vision job is queued only for a final game with a primary video URL and no clock track (`run_ingest.py:528-529`). So steps 6 and 7, the constant-bias correction, the 30 s cap decision, and any accuracy claim beyond "consistent with the feed's physics" all need the key.
- **Not needed to ship steps 1–5.** Stamps are wall time. Once `stream_started_at` arrives they convert through `gapMs`/`sinceTipMs` (`video.js:232-242`, `:305-316`), with the tip cancelling for streams.

**Total effort:** about 4.5 developer days plus two live evenings, and one more evening once the key exists.

**Replay files** (saved in step 0, 2026-09-12):
- `supabase/tests/fixtures/feedtiming/probe3.jsonl.gz`: 2,400 GETs of four live BCB games, every 3 s, with `Last-Modified`, `Age`, status and the newest 60 actions of each version.
- `supabase/tests/fixtures/feedtiming/feed.json`: one saved data.json, P1-P2, captured at half-time.
- `tools/feedtiming/`: `probe3.py` (the recorder), `steps_sim.py` (the per-step window table above), `anal3.py` (the cross-version envelope), `anal4.py` and `verify_topclock.py` (the stale top-level clock), `clusters.py` and `lags.py` (stoppage share). Each defaults to the fixtures, so `python tools/feedtiming/steps_sim.py` reproduces the table.

---

# Appendix: the grounding measurements

**Short version:** faster polling cannot get plays to a few seconds. The public `data.json` sits behind a CloudFront cache that is at most 30 seconds old (`max-age=30`), so we can only see a new version about every 30 s however often we ask. I checked this on today's live BCB games. That changes the numbers the brief assumed for designs (ii) and (iii).

## (a) What `live_keeper` does per game, per loop

The loop is one serial `for` over the due games (`run_ingest.py:1091`), then one sleep (`:1138`). For each game:

**Observation part**
- `t_obs = time.time()` is taken just before the request (`:1098`).
- `adapter.fetch` does one GET of `data.json` (`fiba_livestats.py:218`), with a 0.3 s minimum gap between requests (`:82`, `:215`).
- It then runs `bundle_from_raw` straight away (`:228`). That includes a SHA-1 hash and the stints pipeline (`:235`, `:242`). This CPU work happens before the hash check at `run_ingest.py:1105`, so it runs even when nothing has changed.
- An unchanged payload goes to `continue` and nothing is written.

**Writing part (only when the payload changed)** — counting `sb.*` calls in steady state (game already exists, caches warm, not final):

| Where | Calls | Count |
|---|---|---|
| `write_supabase_feed` | `storage_put` of the whole raw JSON (`:176`), `external_games` upsert (`:177`) | 2 |
| `write_platform` | `competitions` select (`:554`) | 1 |
| | `competition_teams` upsert, once per team, every poll (`feedplatform.py:275`) | 2 |
| | `external_games` select (`:563`) | 1 |
| | `games` select (`:575`) | 1 |
| | `games` patch (`:597`) | 1 |
| | auto_video: `attach` select (`auto_video.py:387`, only with a key or channel), `complete` select (`:426`), maybe `tip_instant` (`:369`) and a patch | 1–3 |
| | `game_advanced` upsert, large (`:617`) | 1 |
| | `external_games` patch (`:621`) | 1 |
| `write_event_log` | `games` select (`:710`), `games` patch (`:732`), select of **every** `game_events` row with payload (`:738`), tail insert or upsert (`:787` / `:893`), `game_state` upsert (`:921`) | 5 |
| After the log | `rpc refresh_feed_team_season` (`:628`) | 1 |

- **Total: about 17–19 HTTPS round trips per changed game.** New players add more lookups, and a final game adds `finalise-game`.
- Every call is a bare `requests.get/post/patch` with no Session (`:71–103`). Each one therefore opens a new TCP+TLS connection.
- At roughly 0.3–1 s each, that is about 5–17 s per game. For four games that is about 20–70 s per sweep, which fits the measured 37.9 s median. This per-call latency is my estimate; I did not time it in production.

**Can observation and writing be separated?** Yes. The fetch plus hash check (`:1098–1117`) needs only `hashes` and `unchanged_since`. The writer needs only `(b, observed)`. One thing is coupled: `_CLOCK_SEEN` stamps `time.time()` when the write happens (`:919–920`), not when the fetch happened, so it would need to move to observation time. The hash check could also run on the raw bytes, before `bundle_from_raw`.

## (b) Stoppage share in the saved feed

The saved feed has 228 actions covering P1–P2. It was captured at half-time: top-level `period` 3, `clock` "10:00". Scripts: `tools/feedtiming/clusters.py`, `tools/feedtiming/lags.py`.

- **Clusters:** 145 distinct (period, clock) values.
  - By size: 107 singles, 27 pairs, 2 of 3, 2 of 4, 2 of 5, and one each of 6, 7, 8, 10 and 12.
  - Median cluster size is 1, mean 1.57, largest 12 (P1 1:55: technical foul, 10 substitutions, 1 free throw). Next largest is 10 (P2 0:31.6: turnover, timeout, 8 subs).
- **Actions at a new clock value, i.e. the clock ran before them: 145/228 = 63.6%.** This includes 73 of the 75 field-goal attempts.
- **Actions sharing a value with the one before: 83 (36.4%).** These split into:
  - 28 (12.3%) same-instant satellites: assist, steal, block, foulon. All 14 assists share their basket's clock. These inherit the anchor's time.
  - 51 (22.4%) true dead-ball followers: subs, timeouts, free throws.
  - 4 others.
- **By cluster:** 12 clusters contain a sub, timeout or free throw, holding 68 actions (29.8%).
- **So about 76% of actions can be placed from the game clock** (63.6% anchors plus 12.3% satellites). About 22–24% cannot.
- **One anomaly:** P2 9:17 has a layup and a 3pt after four subs, all at the same clock. Either the clock was not started or it was keyed late.
- **Corrections are common:** actionNumbers run 1–300 but only 228 are present, so 72 (24%) were deleted or edited. That cause is inferred, not confirmed.
- **Game-clock gap between distinct values:** median 5 s, p90 19 s, max 73 s.
- **Rough length of running stretches between whistles:** median about 27 s (n=24, crude detection).

## (d) How the translator handles clock and period

- **Tenths are dropped.** `translate` reads `ev["gt"]` (`fiba_events.py:162`), not `ev["clock"]`. `gt` is floored whole seconds: 21 actions have non-zero centiseconds in `clock` (e.g. `"00:51:40"` = mm:ss:cc), and every one has an integer `gt` (`"00:51"`). Reading `clock` instead would keep the tenths.
- **`clock_ms` can handle fractions** (`:68–76`, `float(rest)`), but it is never given one.
- **Top-level clock:** `run_ingest.py:901–902` does `int(float(ss))`. I watched live games in their final minute today and the top-level clock was always whole seconds (`"00:37"`, `"00:09"`), so nothing extra is lost there.
- **Period mapping:** `period_of` (`:79–83`) turns OVERTIME with p ≤ 4 into 4+p, so OT1 = 5. Period lengths are hard-coded at 600 000 / 300 000 ms (`:30`, and `run_ingest.py:643`), which matches `periodLengthREGULAR` 10 / `OVERTIME` 5 in the feed.
- **Period mismatch:** `game_state` pairs `T["period"]` (the last action's period) with the raw top-level clock (`run_ingest.py:921`). In the saved feed that gives P2 at 10:00 when the game is really at P3 10:00. Any clock-sample design must take `raw["period"]`.

## New measurement: the CDN

About 460 GETs of four live BCB games (2887012, 2887007, 2886997, 2887018), every 2 s for 240 s, from this PC:

- **Cache:** every response had `Cache-Control: max-age=30`. The `Age` header had median 14 s, p90 27 s, max 29 s. A query string does not bypass the cache (`?a=1` still came back as a Hit with Age 13).
- **New content** (a changed `Last-Modified`) appeared every 26–35 s, even though I asked every 2 s.
- **Receive time minus `Last-Modified`** for each newly seen version: median ≈ 9 s, range 1.5–18.7 s (n≈26, excluding the first poll of each game).
- **The top-level clock is not the clock at `Last-Modified`.** In 4 of about 15 same-period intervals the clock fell 6–9 s more than the time between uploads (for example 36 s of clock over 27 s of `Last-Modified`). That is impossible if the two matched. So a (wall, clock) pair from this feed is inconsistent by up to about 9 s.
- **Not established:**
  - Whether the GitHub runner's CloudFront edge is kept warm by other viewers.
  - How often Genius really uploads (versions in between are hidden).
  - Whether differently encoded requests get separately cached copies.

## (c) Placement error for each design

**Lateness terms**
- **K:** play to statistician keystroke. Unknown. Indirect clue: missed shot to rebound in the game clock has median 4 s (spread 2–6 s, n=46). Physically that is usually 1–2 s, which suggests a keying lag with roughly ±1–2 s of jitter. This is an inference, not a measurement.
- **U:** keystroke to upload. Unknown; the clock-vs-`Last-Modified` gap above hints at 0–9 s.
- **C:** CDN delay, 0 to 30 s.
- **W:** wait for our next poll.

Only the spread can't be calibrated out. A constant bias could be fixed once per game. Placement is `play_wall − stream_start`: the tip cancels, but nothing else does.

**(i) Current design, median gap G = 37.9 s**
- If polls are ≥ 30 s apart and nobody else warms the edge, each poll likely gets fresh data, so C ≈ 0.
- W is roughly uniform on 0–G: mean 19 s, SD 38/√12 ≈ 11 s, p90 34 s, max 38 s.
- Uneven gaps (worst 198.5 s) push the mean above 19 s. Stamps with an error over 180 s are dropped (`:779`).
- **Lateness ≈ K + U + 19 ± 11 s, with a tail to about 198 s.** A 10–15 s clip placed on the stamp misses about half the plays unless the clip start is pulled 30+ s earlier.

**(ii) Same design, 2 s polls**
- W ≤ 2 s, but now C dominates, uniform on 0–30: mean 15 s, SD 8.7 s, max about 32 s.
- **Lateness ≈ K + U + 15 ± 9 s.** That is only about 1.3× better than (i), not 19×.
- **Free improvement:** stamp with the response's `Last-Modified` instead of receive time. That removes about 9 s on average (measured). What remains is K + U plus the gap between the play's upload and the upload that got cached. That gap is bounded at 30 s but its typical size is unknown. My guess is a few seconds.

**(iii) Place running-clock plays by game clock**
- **With perfect (wall, clock) samples:** error = clock quantisation (uniform ±0.5 s, SD 0.29) + keying jitter (about 1–2 s, unverified). **About 1–2 s**, for about 76% of actions, including 73/75 shots.
- **With samples from the public feed:** samples arrive about every 30 s, each inconsistent by up to about 9 s. Running stretches are about 27 s long, so a typical stretch contains about 1 sample. Offset within about [L−9, L], so about ±4.5 s (SD ≈ 2.6 s), plus quantisation and keying. **About ±5 s.** A stretch with 2–3 samples narrows to about ±2–3 s. A stretch with no sample falls back to (ii).
- **Dead-ball actions** (about 22–24%) cannot be placed by clock. `positionFromRuns` puts them at the whistle (`video.js:615`). For a free throw that can be 30–90 s early, so they need wall stamps at (ii) quality.
- **Existing machinery mismatch:** `runsFromTrack` (`video.js:553`, `:562`) needs readings no more than 30 s apart and at least 3 readings per stretch. That fits the vision worker's footage clock track (readings about 2 s apart). It will not reliably build stretches from ~30 s feed samples.
- **The only verified path to about 1–2 s** is the vision worker's clock track read off the footage. It measures in video time directly, so stream start, runner clock and CDN all drop out.

## (e) Runner clock

- Ubuntu GitHub-hosted runners run on Azure ([GitHub docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). The workflow uses `runs-on: ubuntu-latest` (`ingest.yml:57`).
- Azure hosts sync to Microsoft Stratum-1 GPS devices. On Ubuntu 19.10+, chrony syncs to the host through a PTP clock ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/time-sync)).
- I could not confirm that GitHub's runner image keeps that setup. A one-line `chronyc tracking` step in the workflow would settle it.
- Even plain external NTP gives millisecond-to-tens-of-ms error, which does not matter next to the 15–30 s terms. S3's `Last-Modified` has 1 s resolution.
- The bigger unknown at the seconds level is YouTube itself. `actualStartTime` has 1 s resolution, and its offset from the video's t=0 (encoder and ingest delay) is unverified. That is a constant bias, fixable with one manual check per game.
