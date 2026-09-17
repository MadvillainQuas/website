#!/usr/bin/env python3
"""
golden.py - the translator's output on the saved feed, frozen, so a change to
scripts/ingest/translate/fiba_events.py can prove it did not move a single row.

docs/feed-timing.md step 3 teaches the translator to remember which LiveStats
actionNumbers each event came from (`_ans`, in memory only - game_rows copies named
keys, so it never reaches the database). Everything the database DOES see must be
exactly what it was before that edit: seq, t, team, pid, period, clock and the whole
payload. This writes that from a COMMITTED translator (HEAD by default, read with
`git show`, never the working tree), so the golden file cannot silently absorb the
very change it exists to check.

    python tools/feedtiming/golden.py                 # from HEAD
    python tools/feedtiming/golden.py --rev 21966c4   # from any commit

Output: supabase/tests/fixtures/feedtiming/feed.golden.json, one row per event,
[seq, t, team, pid, period, clock, payload], pids as translate's default "<team>:<pno>".
supabase/tests/feedstamp.test.mjs compares the working tree against it.
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRANSLATOR = "scripts/ingest/translate/fiba_events.py"
FEED = ROOT / "supabase" / "tests" / "fixtures" / "feedtiming" / "feed.json"
OUT = ROOT / "supabase" / "tests" / "fixtures" / "feedtiming" / "feed.golden.json"


def committed_translator(rev: str) -> types.ModuleType:
    src = subprocess.run(["git", "show", f"{rev}:{TRANSLATOR}"], cwd=ROOT, capture_output=True, check=True).stdout
    mod = types.ModuleType("fiba_events_golden")
    exec(compile(src.decode("utf-8"), f"{rev}:{TRANSLATOR}", "exec"), mod.__dict__)
    return mod


def rows_of(events: list[dict]) -> list[list]:
    return [[e["seq"], e["t"], e["team"], e["pid"], e["period"], e["clock"], e["payload"]] for e in events]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="freeze translate() on the saved feed")
    ap.add_argument("--rev", default="HEAD", help="the commit whose translator to run (default HEAD)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    fe = committed_translator(args.rev)
    raw = json.load(io.open(FEED, encoding="utf-8"))
    T = fe.translate(raw, fe.default_pid)
    rows = rows_of(T["events"])
    with io.open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n]\n")
    print(f"{len(rows)} events from {args.rev}:{TRANSLATOR} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
