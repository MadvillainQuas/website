#!/usr/bin/env python3
"""
feed_observer.py - watch LiveStats data.json between writes (docs/feed-timing.md, steps 2-4).
The I/O half; the state machine it drives is feedstamp.accept(), and every new version it
holds is run through feedstamp.stamp_version(), so stamps(xid) can tell a write which upload
each action first appeared in (step 3).

NO STAMP SHOULD WAIT FOR SUPABASE. live_keeper used to fetch a game, write it (17-19 HTTPS
round trips per changed game), fetch the next, write that, and only then sleep, so the time
between two looks at one game was the time it took to write all the others: a median of
37.9 s and a worst of 198.5 s across four live games on 2026-09-12. Every version the CDN
published and replaced inside that gap was never seen at all, and the one that was seen was
stamped however late the loop came round to it.

This polls instead, between writes, as often as is useful and no more: a conditional GET per
game every few seconds (If-None-Match, so almost every answer is an empty 304 - 91% in the
probe), with the adapter's own 0.3 s gap between requests. A version is noticed within a
poll of the CDN publishing it, stamped with its Last-Modified, and held until the loop has
time to write it. The loop asks take() for the newest version and whether it has already
written that one.

ONE CACHE KEY. Accept-Encoding is pinned to "gzip, deflate": CloudFront keys its copies on
the encoding, requests would add br/zstd whenever those packages happen to be installed, and
two keys are two independently-aged copies whose Last-Modified can go backwards between polls.

    python scripts/ingest/feed_observer.py --watch 2887008,2886999 --minutes 3 --every 5 --out probe.jsonl

The watch needs no Supabase, prints each version as it appears, and records every poll in
tools/feedtiming/probe3.py's row shape, so its output replays through feedstamp.py --replay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import requests  # noqa: E402

import feedstamp  # noqa: E402
from adapters.fiba_livestats import FIBA_DATA_URL, UA  # noqa: E402

ACCEPT_ENCODING = "gzip, deflate"


@dataclass
class Snapshot:
    raw: dict
    version: int
    stamp_ms: int
    changed_at_ms: int
    lm_ms: Optional[int]
    recv_ms: int
    fetch_ms: int


class FeedObserver:
    """Per-game conditional polling of data.json. Single-threaded: call observe_due() from the
    loop that writes, as often as you like; it only sends a request for a game whose last poll
    is at least its interval old."""

    def __init__(self, session=None, gap_s: float = 0.3, timeout=(3.05, 5), log: Callable = print,
                 on_poll: Callable | None = None):
        # NOT a default argument: a Session built in the signature is built once, at import,
        # and shared by every observer ever made (and by the test harnesses that stub requests).
        self.s = session if session is not None else requests.Session()
        self.gap_s = gap_s
        self.timeout = timeout
        self.log = log
        self.on_poll = on_poll           # (xid, probe-shaped row) after every poll - the --watch recorder
        self.st: dict[str, dict] = {}
        self.raw: dict[str, dict] = {}
        self._last = 0.0

    def _state(self, xid: str) -> dict:
        return self.st.setdefault(xid, feedstamp.new_state())

    def observe_due(self, xids: Iterable, every_s: float = 5.0, armed=frozenset(), armed_every_s: float = 2.0) -> int:
        """Poll every game in `xids` whose last poll is at least its interval old (armed games:
        armed_every_s). Returns how many of them produced a new version."""
        fresh = 0
        for xid in dict.fromkeys(str(x) for x in xids):
            st = self._state(xid)
            interval_ms = (armed_every_s if xid in armed else every_s) * 1000
            if st["last_poll_ms"] is not None and time.time() * 1000 - st["last_poll_ms"] < interval_ms:
                continue
            if self.poll(xid) == "new":
                fresh += 1
        return fresh

    def poll(self, xid: str) -> str:
        """One conditional GET of one game, folded into its state. Returns the accept() event."""
        xid = str(xid)
        st = self._state(xid)
        gap = time.time() - self._last
        if gap < self.gap_s:
            time.sleep(self.gap_s - gap)
        headers = {"User-Agent": UA, "Accept-Encoding": ACCEPT_ENCODING}
        if st["etag"]:
            headers["If-None-Match"] = st["etag"]
        t0 = time.time()
        self._last = t0
        row = {"gid": xid, "v": "gzip", "t0": round(t0, 3)}
        raw = None
        try:
            r = self.s.get(FIBA_DATA_URL.format(game_id=xid), headers=headers, timeout=self.timeout)
            recv = int(time.time() * 1000)
            status, lm, etag, body_hash = r.status_code, feedstamp.lm_ms(r.headers.get("Last-Modified")), r.headers.get("ETag"), None
            code = status
            if status == 200:
                try:
                    raw = r.json()
                except ValueError:
                    raw, code = None, 0                     # a 200 that is not JSON is an error, not a version
                if raw is not None and not (isinstance(raw, dict) and "tm" in raw):
                    code = 404                               # JSON but not a game yet: the adapter's "not published"
                if code == 200:
                    body_hash = hashlib.sha1(json.dumps(raw, sort_keys=True).encode()).hexdigest()
            _, ev = feedstamp.accept(st, code, lm, etag, recv, body_hash)
            if self.on_poll:
                row.update(recv=round(recv / 1000, 3), status=status, age=r.headers.get("Age"), xc=r.headers.get("X-Cache"),
                           lm=(lm / 1000 if lm is not None else None), bytes=len(r.content or b""))
        except Exception as exc:                             # a timeout or a reset is one missed poll, never a dead loop
            recv = int(time.time() * 1000)
            _, ev = feedstamp.accept(st, 0, None, None, recv)
            row.update(err=repr(exc))
            self.log(f"    ! observer {xid}: {exc!r}")
        if ev == "new":
            self.raw[xid] = raw
            st["fetch_ms"] = recv - int(t0 * 1000)
            # EVERY ACTION IS TIMED BY THE VERSION IT FIRST APPEARED IN (step 3), here and only
            # here: the loop may not write this version for a while, and may never write it at
            # all if the next one arrives first, but what the CDN published at this upload is
            # fixed now. The first version this process holds is the baseline (known, never
            # stamped). A failure costs the stamps of this version, never the poll: the rows
            # fall back to the poll stamp, exactly as before this existed. And the version after a
            # failure is a baseline again - memory never learnt what the failed one held, so its
            # actions would otherwise look new next time and be windowed from AFTER they were
            # already published.
            try:
                feedstamp.stamp_version(st, (raw or {}).get("pbp") or [], st["stamp_ms"], st["lo_ms"],
                                        baseline=(st["version"] == 1 or bool(st.get("rebaseline"))))
                st["rebaseline"] = False
            except Exception as exc:
                st["rebaseline"] = True
                self.log(f"    ! feedstamp {xid}: {exc!r}")
        elif ev == "older":
            self.log(f"    ~ {xid}: older copy (Last-Modified {lm} < {st['lm_ms']}), skipped")
        if self.on_poll:
            row["event"] = ev
            if isinstance(raw, dict) and "err" not in row and row.get("status") == 200:
                pbp = sorted(raw.get("pbp") or [], key=lambda e: -int(e.get("actionNumber") or 0))
                row.update(period=raw.get("period"), clock=raw.get("clock"), n=len(pbp),
                           top=[[e.get("actionNumber"), e.get("actionType"), e.get("subType"), e.get("clock"),
                                 e.get("period"), e.get("periodType")] for e in pbp[:60]])
            try:
                self.on_poll(xid, row)
            except Exception as exc:
                self.log(f"    ! observer recorder: {exc!r}")
        return ev

    def take(self, xid) -> Snapshot | None:
        """The newest version held for a game, or None until a 200 has been held."""
        xid = str(xid)
        st, raw = self.st.get(xid), self.raw.get(xid)
        if not st or raw is None or not st["version"]:
            return None
        return Snapshot(raw=raw, version=st["version"], stamp_ms=st["stamp_ms"], changed_at_ms=st["changed_at_ms"],
                        lm_ms=st["lm_ms"], recv_ms=st["changed_at_ms"], fetch_ms=st["fetch_ms"])

    def stamps(self, xid) -> dict:
        """A copy of the game's per-action stamps, {actionNumber: [hi, lo] | None} (step 3).
        A copy, so a poll between here and the write cannot change what that write sees; the
        entries themselves are write-once and never mutated."""
        st = self.st.get(str(xid))
        return dict(st["stamps"]) if st else {}

    def stats(self, xid) -> dict:
        st = self.st.get(str(xid)) or feedstamp.new_state()
        polls = st["polls"]
        stamps = st["stamps"]
        return {"polls": polls, "share304": (st["n304"] / polls) if polls else 0.0,
                "max_poll_gap_ms": st["max_poll_gap_ms"], "gaps_over_25s": st["gaps_over_25s"], "gaps": st["gaps"],
                "versions": st["version"], "older": st["n_older"], "errors": st["n_error"],
                "stamped": sum(1 for v in stamps.values() if v is not None), "late": st["late"], "contra": st["contra"]}

    def forget(self, xid) -> None:
        self.st.pop(str(xid), None)
        self.raw.pop(str(xid), None)


# ─────────────────────────────────────────────────────────── --watch
def _hms(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%H:%M:%S") if ms is not None else "--:--:--"


def _spread(xs, unit=1000.0) -> str:
    if not xs:
        return "n=0"
    xs = [x / unit for x in xs]
    return f"n={len(xs)} min {min(xs):.1f} median {statistics.median(xs):.1f} max {max(xs):.1f}"


def watch(ids: list[str], minutes: float, every: float, out_path: str | None) -> int:
    out = open(out_path, "w", encoding="utf-8") if out_path else None
    hist: dict[str, dict] = {x: {"lm": [], "lag": [], "polls": []} for x in ids}

    def record(xid, row):
        if out:
            out.write(json.dumps(row) + "\n"); out.flush()
        h = hist.setdefault(xid, {"lm": [], "lag": [], "polls": []})
        if "recv" in row:
            h["polls"].append(int(row["recv"] * 1000))
        if row.get("event") != "new":
            if row.get("event") in ("older", "error"):
                print(f"  {_hms(time.time() * 1000)}Z {xid} {row['event']}" + (f" ({row.get('err')})" if row.get("err") else
                      f" (Last-Modified {_hms(row['lm'] * 1000) if row.get('lm') else 'none'})"))
            return
        st = obs.st[xid]
        lm = st["lm_ms"]
        prev = h["lm"][-1] if h["lm"] else None
        if lm is not None:
            h["lm"].append(lm)
            if prev is not None:
                h.setdefault("lm_gaps", []).append(lm - prev)
            h["lag"].append(st["changed_at_ms"] - lm)
        raw = obs.raw.get(xid) or {}
        tm = raw.get("tm") or {}
        score = f"{(tm.get('1') or {}).get('score', '?')}-{(tm.get('2') or {}).get('score', '?')}"
        print(f"  {_hms(st['changed_at_ms'])}Z {xid} v{st['version']}  Last-Modified {_hms(lm)}"
              + (f" (+{(lm - prev) / 1000:.0f} s)" if (lm is not None and prev is not None) else "")
              + (f"  recv-LM {(st['changed_at_ms'] - lm) / 1000:.1f} s" if lm is not None else "  (no usable Last-Modified: receive time)")
              + f"  stamp {_hms(st['stamp_ms'])}  P{raw.get('period')} {raw.get('clock')}  {score}  {len(raw.get('pbp') or [])} actions")

    obs = FeedObserver(on_poll=record)
    end = time.time() + minutes * 60
    print(f"watching {', '.join(ids)} for {minutes:g} min, a conditional GET every {every:g} s per game"
          + (f", recording to {out_path}" if out_path else ""))
    try:
        while time.time() < end:
            obs.observe_due(ids, every)
            nxt = min((obs.st[x]["last_poll_ms"] or 0) for x in ids) / 1000 + every
            time.sleep(max(0.2, min(1.0, nxt - time.time())))
    except KeyboardInterrupt:
        print("  (interrupted)")
    finally:
        if out:
            out.close()
    print("summary")
    for x in ids:
        s, h = obs.stats(x), hist.get(x, {})
        pg = [b - a for a, b in zip(h.get("polls", []), h.get("polls", [])[1:])]
        print(f"  {x}: {s['polls']} polls, {s['share304'] * 100:.0f}% 304, {s['versions']} versions "
              f"({s['older']} older copies skipped, {s['errors']} errors)")
        print(f"      Last-Modified gaps between versions: {_spread(h.get('lm_gaps', []))} s")
        print(f"      receive minus Last-Modified:         {_spread(h.get('lag', []))} s")
        print(f"      poll gaps:                           {_spread(pg)} s; over 25 s: {s['gaps_over_25s']}/{s['gaps']}")
    return 0


def main(argv=None) -> int:
    for s_ in (sys.stdout, sys.stderr):
        try:
            s_.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="watch LiveStats data.json versions (no Supabase)")
    ap.add_argument("--watch", required=True, help="comma-separated LiveStats game ids (keep it to a handful)")
    ap.add_argument("--minutes", type=float, default=10.0)
    ap.add_argument("--every", type=float, default=5.0, help="seconds between polls of each game (minimum 3)")
    ap.add_argument("--out", help="record every poll here as JSON lines (probe3's shape)")
    args = ap.parse_args(argv)
    ids = [x.strip() for x in args.watch.split(",") if x.strip()]
    return watch(ids, args.minutes, max(3.0, args.every), args.out)


if __name__ == "__main__":
    sys.exit(main())
