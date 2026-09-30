"""Move the events splits (`sit`) that are still inside the open stats jsonb into the members' table (migration 0190).

    python scripts/ingest/premium_move.py [--batch 2000] [--max-minutes 40]

Calls public.premium_sit_move(n) with the service key until public.premium_sit_remaining() is 0. Each call is one bounded
batch, so the database is never asked for a season-sized rewrite at once, and a stopped run is simply run again. Until it has
finished, a row it has not reached still carries its `sit` in the open table.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import requests


def rpc(base: str, key: str, fn: str, body: dict | None = None):
    r = requests.post(f"{base}/rest/v1/rpc/{fn}", json=body or {}, timeout=120,
                      headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    if not r.ok:
        raise SystemExit(f"{fn} failed: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=2000)
    ap.add_argument("--max-minutes", type=float, default=40)
    a = ap.parse_args()
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    left = rpc(base, key, "premium_sit_remaining")
    print(f"{left} row(s) still carry an open sit")
    t0, moved = time.time(), 0
    while left:
        if (time.time() - t0) / 60 > a.max_minutes:
            print("time limit reached; run it again to carry on")
            break
        n = rpc(base, key, "premium_sit_move", {"p_limit": a.batch}) or 0
        if not n:
            break
        moved += n
        left = rpc(base, key, "premium_sit_remaining")
        print(f"  moved {moved}, {left} left")
        time.sleep(1.0)                     # politely: one bounded batch a second
    print("done" if not left else f"{left} still to move")
    return 0 if not left else 2


if __name__ == "__main__":
    sys.exit(main())
