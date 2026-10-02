"""START THE CONSOLE'S LONG JOBS AS SOON AS THEY ARE ASKED FOR (2026-10-02).

"Fill in an older season" (season_backfills, 0135) and "start a league again" (league_resets, 0187) are queued rows
that .github/workflows/console-jobs.yml takes. That workflow was started by its own ten-minute cron and nothing else,
and GitHub delivers frequent crons when it can: 16 runs in 76 hours, gaps of 2.8 to 7.2 hours (measured 2026-10-02).
A season somebody asked for sat there, saying "the worker looks every 10 minutes", for half a day.

So whatever is already running starts it:

  * the live lane (run_ingest.live_keeper), which runs around the clock, looks every two minutes;
  * console-jobs.yml itself, when it finishes and something is still queued (a request made while it ran);
  * the console, through the console-kick Edge Function, the moment the button is pressed (when it is set up).

A kick is one POST to GitHub's workflow_dispatch endpoint, with the token the caller already holds (the workflow's own
GITHUB_TOKEN with actions: write). Each queued row is stamped with dispatched_at (0217), so the console can say "the
worker was started at 14:02" and a request is not dispatched again until KICK_AGAIN_S has gone by without anything
taking it. The cron stays, as the floor.

    python scripts/ingest/console_kick.py --kick [backfill|reset]   start the worker if anything (of that kind) is queued
    python scripts/ingest/console_kick.py --queued backfill         exit 0 when a backfill is queued, 1 when none is

Nothing but the standard library: the workflow asks --queued BEFORE it installs Chrome and the scraper, so a run
with nothing to do costs a checkout and two requests.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

WORKFLOW = "console-jobs.yml"
KICK_AGAIN_S = 15 * 60          # a request still queued this long after a dispatch is dispatched again
TABLES = {"backfill": "season_backfills", "reset": "league_resets"}


def _at(iso) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def queued(q, kinds=("backfill", "reset")) -> list[dict]:
    """The queued rows of each kind, with when the worker was last started for them (None before 0217)."""
    out = []
    for kind in kinds:
        table = TABLES[kind]
        try:
            rows = q.select(table, "state=eq.queued&select=id,requested_at,dispatched_at&order=requested_at.asc")
        except Exception:
            # a database without 0217 has no dispatched_at yet; a second failure is the caller's to judge
            rows = q.select(table, "state=eq.queued&select=id,requested_at&order=requested_at.asc")
        out += [dict(r, _kind=kind) for r in rows or []]
    return out


def dispatch(repo: str, token: str, ref: str = "main", workflow: str = WORKFLOW, opener=None) -> tuple[bool, str]:
    """One workflow_dispatch. GitHub answers 204 with no body when the run is created."""
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches",
        data=json.dumps({"ref": ref}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "epinoia-console-kick",
                 "Content-Type": "application/json"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=20) as r:
            return r.status in (200, 201, 204), f"HTTP {r.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except Exception as exc:                                       # a network blip: the next look tries again
        return False, str(exc)[:200]


def kick(q, env=None, now: float | None = None, send=dispatch, kinds=("backfill", "reset")) -> str:
    """Start console-jobs.yml when a request is queued and nobody has started it for KICK_AGAIN_S. Never raises: the
    live lane calls this between polls of live games, and nothing here is worth a missed score."""
    try:
        e = env if env is not None else os.environ
        token = e.get("GH_TOKEN") or e.get("GITHUB_TOKEN")
        repo = e.get("GITHUB_REPOSITORY")
        if not (q and token and repo):
            return "not set up"
        rows = queued(q, kinds)
        if not rows:
            return "nothing queued"
        t = time.time() if now is None else now
        last = [_at(r.get("dispatched_at")) for r in rows]
        recent = [x for x in last if x is not None and t - x < KICK_AGAIN_S]
        if recent:
            return "already started"
        ok, why = send(repo, token, e.get("CONSOLE_JOBS_REF") or "main")
        if not ok:
            return "dispatch failed: " + why
        stamp = datetime.fromtimestamp(t, timezone.utc).isoformat()
        for kind in kinds:
            ids = [r["id"] for r in rows if r["_kind"] == kind]
            if ids:
                try:
                    q.patch(TABLES[kind], f"id=in.({','.join(ids)})&state=eq.queued", {"dispatched_at": stamp})
                except Exception:
                    pass            # before 0217: started all the same, just not noted
        return f"started the worker for {len(rows)} queued request(s)"
    except Exception as exc:
        return f"kick failed: {exc}"[:200]


class Rest:
    """The two calls this needs, over PostgREST with the service key, and nothing to install."""

    def __init__(self, url: str, key: str, opener=None):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.open = opener or urllib.request.urlopen

    def select(self, table: str, query: str) -> list:
        with self.open(urllib.request.Request(self.base + table + "?" + query, headers=self.h), timeout=30) as r:
            return json.loads(r.read() or b"[]")

    def patch(self, table: str, query: str, body: dict) -> None:
        req = urllib.request.Request(self.base + table + "?" + query, data=json.dumps(body).encode(), method="PATCH",
                                     headers=dict(self.h, Prefer="return=minimal"))
        with self.open(req, timeout=30):
            pass


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--kick", nargs="?", const="all", choices=["all"] + sorted(TABLES),
                    help="start console-jobs.yml if anything (of this kind) is queued")
    ap.add_argument("--queued", choices=sorted(TABLES), help="exit 0 if a request of this kind is queued, 1 if not")
    a = ap.parse_args(argv)
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("console_kick needs SUPABASE_URL / SUPABASE_SERVICE_KEY")
        return 2
    q = Rest(url, key)
    if a.queued:
        try:
            n = len(queued(q, (a.queued,)))
        except Exception as exc:              # cannot tell: say so, and let the job go on and look for itself
            print(f"could not read the queue ({exc}): going on")
            return 0
        print(f"{n} {a.queued} request(s) queued")
        return 0 if n else 1
    if a.kick:
        print(kick(q, kinds=tuple(TABLES) if a.kick == "all" else (a.kick,)))
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
