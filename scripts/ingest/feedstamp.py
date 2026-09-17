#!/usr/bin/env python3
"""
feedstamp.py - WHEN DID THE FEED CHANGE? The pure half of docs/feed-timing.md.

Standard library only, and no I/O outside the command line at the bottom. It must never
depend on requests: the guard runner's python has none, and the test harnesses stub it.
The network half is feed_observer.py; run_ingest.py's inline fetch (the kill switch) uses
version_stamp() directly.

THE CDN, NOT OUR POLL, SETS THE PACE. data.json sits behind CloudFront with
`Cache-Control: max-age=30`, and a query string does not bypass it. Measured on four live
BCB games (2026-09-12): a new version appears every 26-35 s however often it is asked for,
and the copy we receive is on average 13 s older than the moment we receive it (recv minus
Last-Modified over 110 versions: median 13.2 s, p90 23.3 s, max 87.6 s). So stamping a play
with our receive time made every stamp late by that much for nothing; the response already
says when S3 got the upload.

    step 1  version_stamp()   stamp = Last-Modified + 999 ms, not receive time
    step 2  new_state/accept  a per-game state machine the observer polls between writes
    step 3  stamp_version()   each action stamped by the version it FIRST appeared in, pulled
            row_stamp()       earlier by the game clock within that version
    step 4  accept()          an unchanged rewrite (a 304 with a newer Last-Modified) narrows
                              the lower edge the next version's actions start from

    python scripts/ingest/feedstamp.py --eval  < cases.json   # the test harness
    python scripts/ingest/feedstamp.py --replay supabase/tests/fixtures/feedtiming/probe3.jsonl.gz --every 5 --step 4

The only import outside the standard library is the translator's own period arithmetic
(translate/fiba_events.py: PLEN, period_of), itself pure python, so a stamp's idea of "how much
basketball had been played" can never drift from the rows it stamps.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import os
import statistics
import sys
from datetime import timezone
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translate.fiba_events import PLEN, period_of  # noqa: E402

# A Last-Modified is believed only inside [recv - 120 s, recv + 2 s]. Older than two minutes
# is not a copy a 30 s cache can legitimately hold (an edge that lost its origin, a clock we
# cannot trust); more than two seconds ahead of our own clock is one of the two clocks lying.
# Either way receive time is still a hard upper bound, so it is what we stamp with.
LM_MAX_AGE_MS = 120_000
LM_MAX_AHEAD_MS = 2_000
# S3 truncates Last-Modified to whole seconds. The upload happened somewhere inside that
# second, so the header plus 999 ms is the latest it can have been: the stamp stays an upper
# bound, which is the one property epinoia/video.js relies on (it spends wall_err as run-up
# BEFORE the stamp, never after it).
LM_RES_MS = 999
# Without a usable Last-Modified the copy is at most max-age old, so this is the earliest the
# version can have been uploaded: the lower edge the next version's window starts from.
CDN_MAX_AGE_MS = 30_000
# Past three minutes nothing can honestly bound a play (the same rule write_event_log applies).
WIDE_MS = 180_000
ERR_FLOOR_MS = 2_000
# The step-2 decision gate (docs/feed-timing.md, spec item 18): with Last-Modified stamps a
# poll gap below about 25 s costs nothing, because the CDN only changes every 26 s or more.
# A pass that leaves more than 5% of its gaps above this needs 2b or a daemon thread.
POLL_GAP_GATE_MS = 25_000
# Step 3: an action first seen with MORE than this much less game played than the most the
# log had already shown was keyed late (a missed play added afterwards, a correction filed
# under a new actionNumber). Its version says when it was TYPED, not when it happened, so it
# is declined outright. Three seconds is a clock keyed in whole seconds plus a reaction.
LATE_ENTRY_MS = 3_000
# Step 4: how far an unchanged rewrite may move the lower edge past the upload it rewrites.
# Guards the case nobody has watched but everybody can imagine: the courtside device goes
# offline and Genius keeps re-publishing the last thing it had, so "unchanged at 19:42" stops
# meaning "nothing had been keyed by 19:42". Caps of 30, 60 and 90 s replay identically.
#
# EXCEPT ACROSS A BREAK. Before the tip (the table opens twenty minutes early and Genius
# re-uploads the roster every half minute) and between periods, nothing is being played, so
# there is nothing an offline device could be sitting on - and the cap was measured doing real
# damage there: on 2026-09-13 the 16:00 tips were windowed from "the pre-tip upload + 60 s",
# 184 s and 95 s wide, so one tip fell back to a first-write bar and the other became the
# worst error in its log. accept() also keeps the uncapped newest rewrite (lo_break_ms), and
# stamp_version uses it when the version is the first after a break (see there).
LM_SEEN_CAP_MS = 60_000
# THE PREVIOUS UPLOAD IS NOT QUITE A LOWER BOUND. "Not in the upload at Last-Modified L, so
# keyed after L" is true of the upload's CONTENT, and the content is older than L: Genius
# builds the file from the courtside device's state and S3 stamps it when it lands, and the
# statistician keys a play a few seconds after it happens. Both push a play's real time
# earlier than the upload that first missed it. Measured from the feed itself - the top-level
# clock a version was generated with, against how much basketball the next version then holds
# (the clock cannot run faster than real time) - the content was provably more than 5 s stale
# in 5 of 97 consecutive versions on 2026-09-12 (10, 17 and 23 s among them) and 3 of 9 on
# 2026-09-13 (7.8-10 s). Every memory window's lower edge is moved this much earlier. It widens
# every bar by 10 s, and epinoia/video.js spends a bar as run-up, so it is the difference
# between a clip that opens on the play and one that opens just after it.
KEY_LAG_MS = 10_000
# Step 3: "the clock the log had reached" is the most basketball among the last few actions
# first seen, not the most ever. A clock the table corrects backwards (2886999, 2026-09-13:
# a foul at P3 03:06, then the clock put back to 04:25 and play resumed from there) would
# otherwise make every play for the next 79 s of game look keyed late; within five actions of
# the correction the reference has followed it.
RECENT_N = 5
# A clock that is not running: three field-goal attempts keyed at one period and clock value
# (2886999 had six such values, up to dozens of shots at P2 05:50; 2887008 none). Their clock
# is behind the real game, so pulling them back by it would claim they happened earlier than
# they could have - their upper bound stays the upload itself.
FROZEN_FGA = 3


# ─────────────────────────────────────────────────────────── step 1: one response
def lm_ms(header) -> int | None:
    """A Last-Modified header as epoch milliseconds, or None when it is missing or unreadable.
    A date with no zone is read as UTC, which is what HTTP dates are."""
    if not header or not isinstance(header, str):
        return None
    try:
        dt = parsedate_to_datetime(header)
    except (TypeError, ValueError, IndexError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def version_stamp(lm: int | None, recv: int, last_lm: int | None) -> dict:
    """What one response says about when its content was published.

    stamp_ms  the latest the content can have been uploaded: Last-Modified + 999 ms when the
              header is believable, never later than receive time (which is also a hard upper
              bound, and binds when the header is within 999 ms of receipt); receive time
              otherwise.
    edge_ms   the earliest it can have been uploaded - the lower edge the NEXT version's
              window starts from (step 3 uses it).
    basis     "lm" or "recv".
    older     Last-Modified is strictly earlier than the newest one already held: an edge
              serving an older copy. EQUAL is not older - S3's whole-second truncation lets
              two different uploads carry the same header."""
    older = last_lm is not None and lm is not None and lm < last_lm
    if lm is not None and recv - LM_MAX_AGE_MS <= lm <= recv + LM_MAX_AHEAD_MS:
        return {"stamp_ms": min(lm + LM_RES_MS, recv), "edge_ms": lm, "basis": "lm", "older": older}
    return {"stamp_ms": recv, "edge_ms": recv - CDN_MAX_AGE_MS, "basis": "recv", "older": older}


# ─────────────────────────────────────────────────────────── step 2: a game's state machine
def new_state() -> dict:
    """One game's observation state. A plain dict on purpose: if the step-2 decision gate ever
    moves observation into a daemon thread, one lock around accept() and stamp_version() is the
    whole change. known / stamps / maxel_ms / recent / sigs / gone / contra / late / frozen /
    rekeyed / last_contra are stamp_version's (step 3)."""
    return {"etag": None, "hash": None, "lm_ms": None, "edge_ms": None, "stamp_ms": None, "basis": None,
            "lm_seen_ms": None, "lm_seen_raw_ms": None, "lo_ms": None, "lo_break_ms": None,
            "version": 0, "changed_at_ms": None, "fetch_ms": 0,
            "last_poll_ms": None, "max_poll_gap_ms": 0, "gaps": 0, "gaps_over_25s": 0,
            "polls": 0, "n304": 0, "n_older": 0, "n_error": 0,
            "known": set(), "stamps": {}, "maxel_ms": None, "recent": [], "sigs": {}, "gone": {},
            "contra": 0, "late": 0, "frozen": 0, "rekeyed": 0, "last_contra": []}


def accept(st: dict, status, lm: int | None, etag: str | None, recv: int, body_hash: str | None = None) -> tuple[dict, str]:
    """Fold one poll into the state. Returns (st, event), event one of new | same | older |
    absent | error. `st` is changed in place and returned for convenience.

    CONTENT IS DETECTED BY HASH, NOT BY ETAG. A new ETag on identical content (an edge that
    re-fetched from origin, a re-upload of the same bytes) would otherwise count as a change,
    reset changed_at, and the stale-final rule - "unchanged for 15 minutes at the end of P4" -
    would never fire. The hash is bundle_from_raw's own (sha1 of the parsed JSON, keys sorted),
    so it compares directly with the payload_hash already stored in external_games.

    AN OLDER COPY IS NOT NEWS. A 200 whose Last-Modified is strictly earlier than the version
    held is an edge serving what it had before; taking it would rewrite the log backwards and
    reset the stale-final timer. It is counted and dropped, and the held raw is kept.

    A missing or out-of-range Last-Modified is still a new version, stamped on receive time
    (basis "recv"): the plan's separate lm_invalid event would only make every caller treat
    two events as "new".

    AN UNCHANGED REWRITE IS EVIDENCE TOO (step 4). Genius re-uploads data.json whether or not
    anything was keyed, so a 304 (or a same-hash 200) carrying a NEWER Last-Modified says: at
    that second the upload still held exactly what we hold. Whatever the next version adds was
    keyed after it, so it becomes the lower edge (lm_seen_ms) the next version's actions are
    windowed from, instead of the older upload the held content first arrived in. It is only
    taken from a believable header (a date 5 s ahead of our clock moves nothing), and never more
    than LM_SEEN_CAP_MS past that upload. Replayed on four live games it takes dead-ball windows
    from a p90 of 47 s to 35 s (and the worst shot window from 124 s to 64 s): during a stoppage
    nothing is keyed, so the version before a free throw can be a minute old while the rewrites
    of it since are seconds old. The newest believable rewrite is also kept uncapped
    (lm_seen_raw_ms -> lo_break_ms at the next version) for the first version after a break,
    where the cap guards nothing (LM_SEEN_CAP_MS)."""
    st["polls"] += 1
    last = st["last_poll_ms"]
    if last is not None:
        gap = int(recv) - int(last)
        st["gaps"] += 1
        if gap > st["max_poll_gap_ms"]:
            st["max_poll_gap_ms"] = gap
        if gap > POLL_GAP_GATE_MS:
            st["gaps_over_25s"] += 1
    st["last_poll_ms"] = int(recv)

    if status in (403, 404):                     # not published (403 is what LiveStats returns before the table opens)
        return st, "absent"
    if status == 304 or (status == 200 and body_hash is not None and body_hash == st["hash"]):
        if status == 304:
            st["n304"] += 1
        elif etag:
            st["etag"] = etag
        if lm is not None and st["lm_ms"] is not None and version_stamp(lm, int(recv), None)["basis"] == "lm":
            if lm > (st["lm_seen_ms"] or 0):
                st["lm_seen_ms"] = min(lm, st["lm_ms"] + LM_SEEN_CAP_MS)
            if lm > (st.get("lm_seen_raw_ms") or 0):
                st["lm_seen_raw_ms"] = lm
        return st, "same"
    if status != 200:
        st["n_error"] += 1
        return st, "error"

    vs = version_stamp(lm, int(recv), st["lm_ms"])
    if vs["older"]:
        st["n_older"] += 1
        return st, "older"
    # the newest moment the held content is known to have still been the upload (step 4);
    # without a rewrite in between that is simply the held version's own lower edge
    st["lo_ms"] = st["lm_seen_ms"] if st["version"] else None
    st["lo_break_ms"] = st.get("lm_seen_raw_ms") if st["version"] else None
    st["version"] += 1
    st["hash"] = body_hash
    st["etag"] = etag
    st["changed_at_ms"] = int(recv)
    st["lm_ms"] = lm if vs["basis"] == "lm" else None
    st["edge_ms"] = vs["edge_ms"]
    st["stamp_ms"] = vs["stamp_ms"]
    st["basis"] = vs["basis"]
    st["lm_seen_ms"] = vs["edge_ms"]
    st["lm_seen_raw_ms"] = vs["edge_ms"]
    return st, "new"


# ─────────────────────────────────────────────────────────── step 3: one action
def clock_cc_ms(s) -> int | None:
    """A LiveStats clock as milliseconds remaining, or None when it cannot be read.

    NOT translate.fiba_events.clock_ms. The pbp `clock` is mm:ss:cc - "00:51:40" is 51.40 s -
    and clock_ms splits on the FIRST colon and hands "51:40" to float(), which raises, which it
    swallows into 0: every action would read as the end of its period. `gt` (mm:ss, whole
    seconds) is what the translator reads; the tenths matter here, where a clock pull of one
    second is the whole difference between a dunk and the inbound before it."""
    if s is None:
        return None
    parts = str(s).strip().split(":")
    try:
        if len(parts) == 3:
            return (int(parts[0]) * 60 + int(parts[1])) * 1000 + int(parts[2]) * 10
        if len(parts) == 2:
            return int(round((int(parts[0]) * 60 + float(parts[1])) * 1000))
    except (ValueError, OverflowError):
        return None
    return None


def elapsed_ms(ev: dict) -> int | None:
    """How much basketball had been played at a pbp action: whole periods before its own (OT1
    is period 5, translate's period_of) plus what had run off the clock in it. A period's start
    is the period's base, whatever its clock says. None when the period or clock is unreadable."""
    try:
        p = period_of(ev)
    except (TypeError, ValueError, AttributeError):
        return None
    if p < 1:
        return None
    base = sum(PLEN(q) for q in range(1, p))
    if str(ev.get("actionType") or "").lower() == "period" and str(ev.get("subType") or "").lower() == "start":
        return base
    c = clock_cc_ms(ev.get("clock"))
    if c is None:
        c = clock_cc_ms(ev.get("gt"))
    if c is None:
        return None
    full = PLEN(p)
    return base + full - max(0, min(full, c))


def stamp_version(st: dict, pbp: list, hi_ms: int, lo_ms: int | None, baseline: bool,
                  lo_break_ms: int | None = None) -> list[int]:
    """Stamp every action this version shows for the first time. Returns their actionNumbers
    (a re-keyed action, which inherits, is not among them).

    `hi_ms` is the version's stamp (nothing in it was uploaded later); `lo_ms` the lower edge of
    the version before it (nothing new here had been uploaded by then: step 2's edge, or step
    4's lm_seen); `lo_break_ms` step 4's uncapped rewrite, used only after a break (below).
    st["stamps"][an] becomes [hi, lo] - or None for a late entry - and is WRITE-ONCE: an action
    is timed by the version it first appeared in and never again, however many later versions
    repeat it, so a stamp already written to the log is the stamp memory still holds.

    THE BASELINE IS KNOWN, NOT STAMPED. The first version a process sees has no version before
    it, so nothing in it can be bounded below: its actions are marked known and left out of
    `stamps`, which row_stamp reads as "fall back to today's poll logic" - not as a decline, or
    every row of a pass handover would lose its time.

    THE LOWER EDGE ALLOWS FOR THE FEED'S OWN LAG. lo is moved KEY_LAG_MS earlier: an upload's
    content is older than its Last-Modified, and a play is keyed after it happens.

    AFTER A BREAK THE REWRITES COUNT IN FULL. When nothing was being played between the upload
    held and this one - memory held no actions yet (the table opened before the tip), the
    newest action held was a period or game boundary, or this version's first new action is a
    period start - lo is the newest believable unchanged rewrite however long after the held
    upload it came. LM_SEEN_CAP_MS exists for a device that went offline mid-play; before a tip
    it only turned a 30 s window into a 184 s one.

    PULLED BY THE CLOCK. Real time between two plays is never less than the game time between
    them. Every action this version adds happened no later than hi, so action i happened at
    least (E - el_i) earlier, E the most basketball played among ALL of this version's new
    actions: hi_i = hi - (E - el_i). All of them, not only those numbered after i - a play keyed
    after a later play in the same upload (a steal entered after the foul and free throws that
    followed it) is still bounded by that later play, and taking only the suffix left it at the
    upload's own stamp, tens of seconds late. Period and game boundaries never pull: the
    period-end action is keyed at 00:00 whatever the clock said a moment before, so after a
    clock that stuck (2886999, P2 05:50 for sixty actions) it would pull every stuck play back
    by the size of the jump. Neither does a frozen clock pull its own plays (FROZEN_FGA): their
    upper bound stays the upload.

    A LATE ENTRY IS DECLINED. An action whose clock is more than LATE_ENTRY_MS behind the clock
    the log had reached (the most basketball among the last RECENT_N actions memory first saw)
    was keyed after the fact; its upload says when it was typed. None, and row_stamp declines it.

    A CONTRADICTION IS LEFT TO THE POLL. If the pull lands before even the lag-widened lower
    edge, one of the two things this rests on is false: the clock (a stuck clock the period end
    then jumps) or the lower edge (a statistician a minute behind who then catches up). This used
    to keep the pulled hi and move the edge to hi - 2 s, which made the narrowest bar the page
    ever sees out of exactly the rows it knew least about - on the real feed, frozen-clock shots
    written with 2 s bars five minutes before their upload. Now nothing is stored: row_stamp
    reads it as "none", and today's poll stamp and within_stamp decide, as they do for anything
    else memory cannot place. Counted in st["contra"]; the last call's are in st["last_contra"]
    as [an, pulled hi, lo before the allowance] for the replay.

    A RE-KEYED ACTION KEEPS ITS TIME. LiveStats corrects a play by deleting it and keying it
    again under a new actionNumber - same type, same period, same clock, usually another
    player. The new number first appears an upload later than the play did, so windowing it
    from there would put the play after the upload that already held it. An action whose
    (type, period, clock) matches one that vanished from the feed in the last two versions
    takes that action's stamp (or its decline, or its absence) instead."""
    acts = []
    for ev in pbp or []:
        if not isinstance(ev, dict):
            continue
        try:
            an = int(ev.get("actionNumber"))
        except (TypeError, ValueError):
            continue
        at = str(ev.get("actionType") or "").lower()
        sub = str(ev.get("subType") or "").lower()
        sig = (at, str(ev.get("period")), str(ev.get("periodType") or ""), str(ev.get("clock")))
        acts.append((an, elapsed_ms(ev), at, sub, sig))
    acts.sort(key=lambda a: a[0])
    known, stamps = st["known"], st["stamps"]
    recent = st.setdefault("recent", [])
    gone = st.setdefault("gone", {})
    st["last_contra"] = []
    for k in ("contra", "late", "frozen", "rekeyed"):
        st.setdefault(k, 0)
    version = st.get("version") or 0

    # what vanished from the feed since the last version (a deletion, or the first half of a re-key);
    # only numbers inside this pbp's range, so a recording that keeps the newest actions only
    # never mistakes an action that scrolled out of it for a deleted one
    cur = {a[0]: a[4] for a in acts}
    low = acts[0][0] if acts else None
    for an, sig in (st.get("sigs") or {}).items():
        if an not in cur and low is not None and an > low:
            gone.setdefault(an, [sig, version])
    for an in [an for an, (_, v) in gone.items() if version - v > 2]:
        del gone[an]
    st["sigs"] = cur

    def remember(el):
        if el is not None:
            recent.append(el)
            del recent[:-RECENT_N]
            st["maxel_ms"] = max(recent)

    if baseline or lo_ms is None:
        for an, el, *_ in acts:
            if an not in known:
                known.add(an)
            remember(el)
        return []

    held = [a for a in acts if a[0] in known]
    new = [a for a in acts if a[0] not in known]
    ref = max(recent) if recent else None
    lo_raw = int(lo_ms)
    if lo_break_ms is not None and int(lo_break_ms) > lo_raw and (
            not held or held[-1][2] in ("period", "game")
            or (new and new[0][2] in ("period", "game") and new[0][3] == "start")):
        lo_raw = int(lo_break_ms)
    lo_eff = lo_raw - KEY_LAG_MS
    hi_ms = int(hi_ms)
    fga = collections.Counter(a[4][1:] for a in acts if a[2] in ("2pt", "3pt"))
    frozen = {k for k, n in fga.items() if n >= FROZEN_FGA}
    E = max((a[1] for a in new if a[1] is not None and a[2] not in ("period", "game")), default=None)
    made = []
    for an, el, at, sub, sig in new:
        known.add(an)
        twin = next((g for g, (gsig, _) in sorted(gone.items()) if gsig == sig), None)
        if twin is not None:
            del gone[twin]
            if twin in stamps:
                stamps[an] = stamps[twin]
            st["rekeyed"] += 1
            remember(el)
            continue
        if el is None:
            continue                                  # unreadable clock: unstamped, so it falls back
        made.append(an)
        late = ref is not None and el < ref - LATE_ENTRY_MS
        remember(el)
        if late:
            stamps[an] = None
            st["late"] += 1
            continue
        if sig[1:] in frozen:
            st["frozen"] += 1
            pull = 0
        else:
            pull = 0 if E is None else max(0, E - el)
        hi = hi_ms - pull
        if hi < lo_eff:
            st["contra"] += 1
            st["last_contra"].append([an, hi, lo_raw])
            continue
        stamps[an] = [hi, lo_eff]
    return made


_MISSING = object()


def row_stamp(ans, stamps) -> tuple[str, dict | None]:
    """What memory says about one translated event, from the actionNumbers it was built from.

        ("mem", {"wall", "wall_err"})  every action stamped: the earliest upper bound, and the
                                       window down to the earliest lower edge (never under 2 s)
        ("decline", None)              any action a late entry - wins over everything else
        ("none", None)                 no actions ([] - the invented fouled-out sub), any action
                                       memory never stamped (the baseline, an unreadable clock),
                                       or a window past WIDE_MS: today's poll logic decides

    THE SMALLEST LOWER EDGE, NOT THE LARGEST. A substitution is two actions, and its out-half
    and in-half can land in different versions. Taking the larger lower edge with the smaller
    upper bound gives a window of a second, or a negative one the 2 s floor then hides: a
    confident, wrong bar. The earliest lower edge is the honest one.

    PAST THREE MINUTES IS "NONE", NOT A DECLINE. LiveStats publishes when the table opens, often
    twenty minutes before the tip, so the first version holding the tip is windowed from a
    pre-game upload. Declining it would leave the P1 period_start unstamped, and without a tip
    stamp the whole game falls back to insert times (run_ingest.first_write_stamp)."""
    if not ans:
        return ("none", None)
    vals, unknown = [], False
    for an in ans:
        v = stamps.get(an, _MISSING)
        if v is _MISSING:
            v = stamps.get(str(an), _MISSING)
        if v is _MISSING:
            unknown = True
        elif v is None:
            return ("decline", None)
        else:
            vals.append(v)
    if unknown:
        return ("none", None)
    hi, lo = min(int(v[0]) for v in vals), min(int(v[1]) for v in vals)
    if hi - lo > WIDE_MS:
        return ("none", None)
    return ("mem", {"wall": hi, "wall_err": max(ERR_FLOOR_MS, hi - lo)})


# ─────────────────────────────────────────────────────────── replay over a recorded probe
SHOTS = {"2pt", "3pt"}
LIVE = {"rebound", "turnover", "steal", "block", "assist", "foul", "foulon", "jumpball"}
DEAD = {"substitution", "timeout", "freethrow", "period", "game"}


def _group(action_type) -> str:
    t = str(action_type or "")
    return "shots" if t in SHOTS else ("live" if t in LIVE else ("dead" if t in DEAD else "other"))


def _pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))] if xs else None


def _open(path):
    return gzip.open(path, "rt", encoding="utf-8") if str(path).endswith(".gz") else open(path, encoding="utf-8")


def replay(path: str, every_s: float, step: int = 2) -> dict:
    """The honest window [lo, hi] of every action a poller at `every_s` would have stamped,
    replayed over a probe recording (tools/feedtiming/probe3.py or feed_observer.py --watch).

    THE REPLAY MODELS THE CDN, NOT THE PROBE'S ROWS. tools/feedtiming/steps_sim.py kept only
    rows that carried a Last-Modified, which threw away 964 of 1,200 gzip rows (every 304
    without the header) and subsampled what was left, so its cadence numbers describe the
    CDN's 30 s cycle rather than a poller. Here every row is walked: the copy the edge holds
    at a row is the latest 200 at or before it, its Last-Modified the largest of that 200's
    and any later 304's. A poll is taken whenever `every_s - 1.5` s have passed since the
    last one and fed to accept() as that copy (same hash -> "same"). It assumes the edge is
    kept warm, as the probe's own 3 s polling did.

    Step 2 is today's newest-wall rule on observer stamps: a version's new actions get
    hi = its stamp and lo = the stamp - 999 ms of the last version that added actions (the
    first version a process sees is a baseline: known, never stamped). A window past
    WIDE_MS is counted as declined, as write_event_log declines it.

    Steps 3 and 4 run stamp_version() on every new version, exactly as the observer does, with
    the recording's newest 60 actions standing in for the pbp: step 3 windows from the previous
    version's own lower edge, step 4 from accept()'s lm_seen_ms. Each first-seen action is read
    back through row_stamp() alone; "none" (past WIDE_MS) is counted in `wide`, a late entry in
    `late`. `contradictions` counts a pull that landed before the lower edge, and
    `hi_minus_lo_min_ms` says by how much at worst (before the edge is moved to hi - 2 s).

    The recording keeps only 60 actions per version, so a late entry cannot occur in it: that
    rule is covered by hand cases (supabase/tests/feedstamp.test.mjs), not by this."""
    step = int(step)
    if step not in (2, 3, 4):
        raise ValueError(f"no replay for step {step}")
    rows = [json.loads(line) for line in _open(path) if line.strip()]
    rows = [r for r in rows if "err" not in r and r.get("v", "gzip") == "gzip"]
    rows.sort(key=lambda r: r["recv"])
    widths: dict[str, list] = collections.defaultdict(list)
    wide: dict[str, int] = collections.defaultdict(int)
    out = {"file": os.path.basename(str(path)), "every_s": every_s, "step": step, "versions_total": 0,
           "versions_seen": 0, "contradictions": 0, "late": 0, "hi_after_first_lm_max_ms": None,
           "hi_minus_lo_min_ms": None, "contra_list": [], "games": {}}
    for gid in sorted({r["gid"] for r in rows}):
        rs = [r for r in rows if r["gid"] == gid]
        v200 = [i for i, r in enumerate(rs) if r["status"] == 200 and r.get("top") is not None]
        first_lm = {}
        for i in v200:
            for a in rs[i]["top"]:
                first_lm.setdefault(int(a[0]), rs[i]["lm"])
        st = new_state()
        last_take, cur200, cur_lm = -1e18, None, None
        seen, known, wall_lo, same = set(), None, None, 0
        for i, r in enumerate(rs):
            if r["status"] == 200 and r.get("top") is not None:
                cur200, cur_lm = i, r.get("lm")
            elif r["status"] == 304 and r.get("lm") and cur_lm is not None and r["lm"] > cur_lm:
                cur_lm = r["lm"]
            if r["recv"] - last_take < every_s - 1.5:
                continue
            last_take = r["recv"]
            if cur200 is None:
                continue
            recv = int(r["recv"] * 1000)
            lm_s = cur_lm if cur_lm is not None else r.get("lm")
            lm = int(lm_s * 1000) if lm_s else None
            edge_before = st["edge_ms"] if st["version"] else None      # step 3's lower edge, before step 4 narrows it
            _, ev = accept(st, 200, lm, None, recv, str(cur200))
            if ev == "same":
                same += 1
            if ev != "new":
                continue
            seen.add(cur200)
            if step >= 3:
                top = rs[cur200]["top"]
                kinds = {int(a[0]): a[1] for a in top}
                pbp = [{"actionNumber": a[0], "actionType": a[1], "subType": a[2], "clock": a[3], "period": a[4],
                        "periodType": a[5] if len(a) > 5 else None} for a in top]
                lo = st["lo_ms"] if step >= 4 else edge_before
                contra_before = st["contra"]
                made = stamp_version(st, pbp, st["stamp_ms"], lo, baseline=(st["version"] == 1))
                for an in made:
                    v = st["stamps"].get(an)
                    if v is None:
                        continue                                        # a late entry: declined
                    gap = v[0] - lo
                    cur = out["hi_minus_lo_min_ms"]
                    out["hi_minus_lo_min_ms"] = gap if cur is None else min(cur, gap)
                    if gap < 0:
                        out["contra_list"].append([str(gid), an, gap])
                    kind, stamp = row_stamp([an], st["stamps"])
                    if kind != "mem":
                        wide[_group(kinds.get(an))] += 1
                        continue
                    widths[_group(kinds.get(an))].append(stamp["wall_err"] / 1000.0)
                    if an in first_lm:
                        d = v[0] - (int(first_lm[an] * 1000) + LM_RES_MS)
                        cur = out["hi_after_first_lm_max_ms"]
                        out["hi_after_first_lm_max_ms"] = d if cur is None else max(cur, d)
                out["contradictions"] += st["contra"] - contra_before
                continue
            acts = [(int(a[0]), a[1]) for a in rs[cur200]["top"]]
            if known is None:                                   # baseline: the first version this process sees
                known = {an for an, _ in acts}
                wall_lo = st["stamp_ms"] - LM_RES_MS if st["lm_ms"] is not None else st["stamp_ms"]
                continue
            new = [(an, at) for an, at in sorted(acts) if an not in known]
            known.update(an for an, _ in new)
            if not new:
                continue
            hi, lo = st["stamp_ms"], wall_lo
            for an, at in new:
                if hi < lo:
                    out["contradictions"] += 1
                w = hi - lo
                if w > WIDE_MS:
                    wide[_group(at)] += 1
                    continue
                widths[_group(at)].append(max(ERR_FLOOR_MS, w) / 1000.0)
                if an in first_lm:
                    d = hi - (int(first_lm[an] * 1000) + LM_RES_MS)
                    cur = out["hi_after_first_lm_max_ms"]
                    out["hi_after_first_lm_max_ms"] = d if cur is None else max(cur, d)
            wall_lo = st["stamp_ms"] - LM_RES_MS if st["lm_ms"] is not None else st["stamp_ms"]
        out["versions_total"] += len(v200)
        out["versions_seen"] += len(seen)
        out["late"] += st["late"]
        out["games"][str(gid)] = {"versions": len(v200), "seen": len(seen), "polls": st["polls"], "same": same,
                                  "max_poll_gap_s": st["max_poll_gap_ms"] / 1000.0}
    out["groups"] = {g: {"n": len(xs), "median": statistics.median(xs), "p25": _pct(xs, .25), "p75": _pct(xs, .75),
                         "p90": _pct(xs, .9), "max": max(xs)}
                     for g, xs in sorted(widths.items()) if xs}
    out["wide"] = dict(sorted(wide.items()))
    out["wide_total"] = sum(wide.values())
    # HOW OFTEN A CLIP STILL HOLDS THE PLAY, the number epinoia/video.js clipOf's run-up cap is
    # chosen by: the play taken as anywhere in its window W, a clip opening ROLL + 2 s leeway +
    # min(W, cap) before the stamp contains it with probability min(1, that / W). Threes are
    # read off the shot windows, free throws off the dead-ball ones; k2 allows 2 s of keying lag.
    out["containment"] = {}
    for kind, group, roll in (("p3_made", "shots", 9.5), ("ft_made", "dead", 6.0)):
        ws = widths.get(group) or []
        if ws:
            out["containment"][kind] = {f"cap{cap}{k_name}": round(sum(min(1.0, (roll + 2 + min(w, cap) - k) / w) for w in ws) / len(ws), 3)
                                        for cap in (15, 30, 45) for k_name, k in (("", 0.0), ("_k2", 2.0))}
    return out


# ─────────────────────────────────────────────────────────── command line
def _plain(v):
    """JSON-safe: sets become sorted lists, tuples lists (dict int keys become strings in dumps)."""
    if isinstance(v, (set, frozenset)):
        return sorted(_plain(x) for x in v)
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {(k if isinstance(k, (str, int, float, bool)) or k is None else str(k)): _plain(x) for k, x in v.items()}
    return v


def _eval(cases: list) -> list:
    """The test harness. stdin: [{"fn": name, "args": [...], "kwargs": {...}, "as": name?}].

    A case with "as" keeps its raw return value under that name, and an argument written
    {"$": name} (optionally {"$": name, "i": k}) is replaced by it - which is how one batch
    walks a single state through a sequence of accept() calls. Each result is serialised the
    moment its call returns, so a later call mutating the same state does not rewrite it."""
    names, results = {}, []
    fns = {"lm_ms": lm_ms, "version_stamp": version_stamp, "new_state": new_state, "accept": accept, "replay": replay,
           "stamp_version": stamp_version, "row_stamp": row_stamp, "elapsed_ms": elapsed_ms, "clock_cc_ms": clock_cc_ms,
           "value": lambda v: v}                    # {"fn": "value", "args": [{"$": "st", "i": "stamps"}]} reads a state back

    def deref(a):
        if isinstance(a, dict) and set(a) <= {"$", "i"} and "$" in a:
            v = names[a["$"]]
            return v[a["i"]] if "i" in a else v
        return a
    for c in cases:
        try:
            fn = fns[c["fn"]]
            val = fn(*[deref(a) for a in c.get("args", [])], **{k: deref(v) for k, v in (c.get("kwargs") or {}).items()})
            if c.get("as"):
                names[c["as"]] = val
            results.append({"ok": _plain(val)})
        except Exception as exc:
            results.append({"error": repr(exc)})
    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--eval", action="store_true", help="read JSON cases on stdin, print '@@' + JSON results")
    ap.add_argument("--replay", metavar="PATH", help="replay a probe recording (.jsonl or .jsonl.gz)")
    ap.add_argument("--every", type=float, default=5.0, help="replay: seconds between polls")
    ap.add_argument("--step", type=int, choices=(2, 3, 4), default=2)
    ap.add_argument("--json", action="store_true", help="replay: print '@@' + JSON instead of a table")
    args = ap.parse_args(argv)
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if args.eval:
        sys.stdout.write("@@" + json.dumps(_eval(json.load(sys.stdin))))
        return 0
    if args.replay:
        r = replay(args.replay, args.every, args.step)
        if args.json:
            sys.stdout.write("@@" + json.dumps(r))
            return 0
        print(f"{r['file']}: step {r['step']}, a poll every {r['every_s']:g} s - "
              f"{r['versions_seen']}/{r['versions_total']} versions seen, {r['wide_total']} windows past "
              f"{WIDE_MS // 1000} s {'left to the poll' if r['step'] >= 3 else 'declined'} {r['wide']}, "
              f"{r['contradictions']} contradictions"
              + (f" (worst {r['hi_minus_lo_min_ms']} ms), {r['late']} late entries" if r["step"] >= 3 else ""))
        for g, x in r["groups"].items():
            print(f"  {g:6s} n={x['n']:3d}  median {x['median']:5.1f}  p25 {x['p25']:5.1f}  p75 {x['p75']:5.1f}"
                  f"  p90 {x['p90']:5.1f}  max {x['max']:5.1f}  (seconds)")
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
