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

THE REPORT MAILER IS KICKED THE SAME WAY (0226, 2026-10-03). "Send next week's reports now" (report_mail_requests, the
platform console's Reports by email) is a queued row that .github/workflows/report-mail.yml takes, and that workflow's
own half-hourly cron went hours without a run too (two runs in four hours, measured 2026-10-03: a request sat for an
hour). So the live lane starts report-mail.yml for a queued request exactly as it starts console-jobs.yml for a
backfill, each workflow on its own: no extra token, no function to deploy.

A REPORT PDF PAID FOR ONCE IS KICKED THE SAME WAY (0279, 2026-10-16). The buyer is told it comes "within a few minutes";
the billing webhook starts report-mail.yml itself only where GITHUB_DISPATCH_TOKEN is set (it is not, as console-kick
says), so a paid PDF waiting to be drawn (access_purchases, render_state queued) is one more kind the lane starts the
mailer for, every two minutes, and stamps dispatched_at on as it does the others.

    python scripts/ingest/console_kick.py --kick [backfill|reset|report|pdf]   start the worker if anything (of that kind) is queued
    python scripts/ingest/console_kick.py --queued backfill                exit 0 when a backfill is queued, 1 when none is

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
REPORT_WORKFLOW = "report-mail.yml"
KICK_AGAIN_S = 15 * 60          # a request still queued this long after a dispatch is dispatched again
REPORT_GIVE_UP_S = 3 * 3600     # a "send next week's reports now" nobody took in three hours is given up (0226), not started again
TABLES = {"backfill": "season_backfills", "reset": "league_resets", "report": "report_mail_requests", "pdf": "access_purchases"}
WORKFLOWS = {"backfill": WORKFLOW, "reset": WORKFLOW, "report": REPORT_WORKFLOW, "pdf": REPORT_WORKFLOW}      # the worker that takes each kind
# a paid PDF's queue is not a request table: its state is render_state, it was asked for when it was paid, and a refunded one or one
# that failed three times is not waiting (pdf_render_claim's own rule)
PDF_QUEUED = "render_state=eq.queued&status=eq.paid&render_attempts=lt.3&select=id,requested_at:paid_at,dispatched_at&order=paid_at.asc"


def _at(iso) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


# A LEASE THAT RAN OUT IS WORK TOO (2026-10-15). 0135/0187 put a running request back in the queue once its worker has been
# quiet for 90 minutes - but only inside the claim, and the claim only runs when this says something is queued. A worker
# killed at its time limit (NBL1 2026, cancelled at 12:27 UTC) left its row "running" for good: every run after asked
# --queued, heard no, and stopped in fifteen seconds while the season sat at 653 of 716 games. A running row past the
# lease (with five minutes to spare, so the database's own clock agrees) now counts, and the claim re-queues and takes it.
LEASE_MIN = 95
LEASED = ("backfill", "reset")


def stale(q, kind, now=None) -> list[dict]:
    """Running rows of a leased kind whose worker has not been heard from for LEASE_MIN minutes."""
    from datetime import datetime, timedelta, timezone
    cut = ((now or datetime.now(timezone.utc)) - timedelta(minutes=LEASE_MIN)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        rows = q.select(TABLES[kind], f"state=eq.running&or=(heartbeat_at.lt.{cut},and(heartbeat_at.is.null,claimed_at.lt.{cut}))"
                                      "&select=id,requested_at,dispatched_at")
    except Exception:
        return []
    return [dict(r, _kind=kind, _stale=True) for r in rows or []]


def queued(q, kinds=("backfill", "reset")) -> list[dict]:
    """The queued rows of each kind, with when the worker was last started for them (None before 0217), and any running
    row whose lease has run out (stale: the claim puts it back and takes it)."""
    out = []
    for kind in kinds:
        table = TABLES[kind]
        if kind == "pdf":
            try:
                rows = q.select(table, PDF_QUEUED)
            except Exception:
                continue            # 0279 is not applied: nothing bought, and the others are not held up
            out += [dict(r, _kind=kind) for r in rows or []]
            continue
        try:
            rows = q.select(table, "state=eq.queued&select=id,requested_at,dispatched_at&order=requested_at.asc")
        except Exception:
            # a database without 0217 has no dispatched_at yet; a second failure is the caller's to judge
            try:
                rows = q.select(table, "state=eq.queued&select=id,requested_at&order=requested_at.asc")
            except Exception:
                if kind == "report":
                    continue        # 0226 is not applied: no such table, nothing asked for, and the others are not held up
                raise
        out += [dict(r, _kind=kind) for r in rows or []]
        if kind in LEASED:
            out += stale(q, kind)
    return out


def _creds(env=None) -> tuple[str | None, str | None]:
    """The token and the repository to dispatch with. In a workflow they are in the environment (GH_TOKEN, GITHUB_REPOSITORY). On the
    machine that runs the live lane (2026-10-04) neither is, so the lane falls back on what the machine already has: the GitHub CLI's
    own login (`gh auth token`, with GH_TOKEN/GITHUB_TOKEN cleared so it answers with its stored one) and the checkout's origin
    remote. A test passes its own env and gets exactly what is in it."""
    if env is not None:
        return (env.get("GH_TOKEN") or env.get("GITHUB_TOKEN")), env.get("GITHUB_REPOSITORY")
    e = os.environ
    token, repo = e.get("GH_TOKEN") or e.get("GITHUB_TOKEN"), e.get("GITHUB_REPOSITORY")
    if not token or not repo:
        try:
            import re
            import subprocess
            clean = {k: v for k, v in e.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}
            if not token:
                token = subprocess.run(["gh", "auth", "token"], env=clean, capture_output=True, text=True, timeout=15).stdout.strip() or None
            if not repo:
                url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=os.path.dirname(os.path.abspath(__file__)),
                                     capture_output=True, text=True, timeout=15).stdout.strip()
                m = re.search(r"github\.com[:/]([^/]+/[^/.]+?)(?:\.git)?$", url)
                repo = m.group(1) if m else None
        except Exception:
            pass
    return token, repo


# A TOKEN THAT CAN READ IS NOT ONE THAT CAN START A RUN (2026-10-16). The lane machine has a fine-grained token in its user
# environment (GITHUB_TOKEN, github_pat_...) with no Actions permission: it reads the repository, and GitHub answers 403 to
# every dispatch with it. _creds() took it first and never looked at the GitHub CLI's own login (scopes repo + workflow),
# so for as long as that variable was set the lane's two-minute kick failed every time - backfills queued from the console
# ("not set up" there: console-kick has no secret) waited for GitHub's cron, and the mailer's cadence was not kept either.
# Off a workflow, every token the machine has is a candidate, in order; a dispatch refused (401/403/404) tries the next,
# and the one GitHub took is used first from then on.
_GOOD: dict = {}


def _tokens(env=None) -> list[str]:
    """The tokens to try, best first: the one that last worked, the environment's, then the GitHub CLI login (off a workflow)."""
    first, _ = _creds(env)
    out = [t for t in (_GOOD.get("token"), first) if t]
    if env is None and not os.environ.get("GITHUB_ACTIONS"):
        try:
            import subprocess
            clean = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}
            cli = subprocess.run(["gh", "auth", "token"], env=clean, capture_output=True, text=True, timeout=15).stdout.strip()
            if cli:
                out.append(cli)
        except Exception:
            pass
    return list(dict.fromkeys(out))


def send_any(send, repo: str, tokens: list[str], ref: str, workflow: str) -> tuple[bool, str]:
    """One dispatch, with each token in turn until GitHub takes one; a refusal (401/403/404) moves on, anything else stops."""
    said = "no token"
    for tok in tokens:
        ok, said = send(repo, tok, ref, workflow)
        if ok:
            _GOOD["token"] = tok
            return True, said
        if not any(c in said for c in ("401", "403", "404")):
            break
    return False, said


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


def kick(q, env=None, now: float | None = None, send=dispatch, kinds=("backfill", "reset", "report", "pdf")) -> str:
    """Start console-jobs.yml when a backfill or reset is queued, and report-mail.yml when a "send next week's reports
    now" or a paid PDF is, each when nobody has started it for KICK_AGAIN_S. Never raises: the live lane calls this between polls of
    live games, and nothing here is worth a missed score."""
    try:
        e = env if env is not None else os.environ
        token, repo = _creds(env)
        tokens = _tokens(env)
        if not (q and tokens and repo):
            return "not set up"
        rows = queued(q, kinds)
        t = time.time() if now is None else now
        rows = [r for r in rows if not (r["_kind"] == "report" and t - (_at(r.get("requested_at")) or t) > REPORT_GIVE_UP_S)]
        if not rows:
            return "nothing queued"
        stamp = datetime.fromtimestamp(t, timezone.utc).isoformat()
        started, why = 0, []
        for workflow in dict.fromkeys(WORKFLOWS[k] for k in kinds):              # each worker on its own, in order
            mine = [r for r in rows if WORKFLOWS[r["_kind"]] == workflow]
            if not mine:
                continue
            if any(x is not None and t - x < KICK_AGAIN_S for x in (_at(r.get("dispatched_at")) for r in mine)):
                why.append("already started")
                continue
            ok, said = send_any(send, repo, tokens, e.get("CONSOLE_JOBS_REF") or "main", workflow)
            if not ok:
                why.append("dispatch failed: " + said)
                continue
            for kind in kinds:
                ids = [r["id"] for r in mine if r["_kind"] == kind]
                if ids:
                    try:
                        # a stale running row is stamped too (2026-10-16): unstamped, it was started again every two
                        # minutes while another backfill held the worker, each new run cancelling the one waiting
                        q.patch(TABLES[kind], f"id=in.({','.join(ids)})&" + ("state=in.(queued,running)" if kind in LEASED
                                                                             else "render_state=eq.queued" if kind == "pdf" else "state=eq.queued"),
                                {"dispatched_at": stamp})
                    except Exception:
                        pass        # before 0217: started all the same, just not noted
            started += len(mine)
        if started:
            return f"started the worker for {started} queued request(s)"
        return next((w for w in why if w.startswith("dispatch failed")), why[0])
    except Exception as exc:
        return f"kick failed: {exc}"[:200]


MAIL_EVERY_S = 35 * 60          # the report mailer is meant to run every half hour: no run started for this long is one that GitHub's cron dropped


def mail_cadence(env=None, now: float | None = None, send=dispatch, opener=None) -> str:
    """THE REPORT MAILER'S CRON, KEPT BY THE LIVE LANE (2026-10-04). report-mail.yml's own schedule (every half hour, and an hourly
    floor) went an hour and a half without a run on a Sunday, and a Sunday email held until an hour after an opponent's game
    (sundayHold) went out an hour late. So the lane that runs around the clock looks every two minutes whether the mailer has had
    a run in MAIL_EVERY_S, and starts one when not. Never raises; nothing at all without a token and a repository."""
    try:
        e = env if env is not None else os.environ
        token, repo = _creds(env)
        tokens = _tokens(env)
        if not (tokens and repo):
            return "not set up"
        token = tokens[0]
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/actions/workflows/{REPORT_WORKFLOW}/runs?per_page=1",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "epinoia-console-kick"})
        with (opener or urllib.request.urlopen)(req, timeout=20) as r:
            runs = (json.loads(r.read() or b"{}") or {}).get("workflow_runs") or []
        t = time.time() if now is None else now
        last = _at(runs[0].get("created_at")) if runs else None
        if last is not None and t - last < MAIL_EVERY_S:
            return "mailer ran recently"
        ok, said = send_any(send, repo, tokens, e.get("CONSOLE_JOBS_REF") or "main", REPORT_WORKFLOW)
        return "started the mailer" if ok else "dispatch failed: " + said
    except Exception as exc:
        return f"mail cadence failed: {exc}"[:200]


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
                    help="start the worker (console-jobs.yml, or report-mail.yml for a report) if anything (of this kind) is queued")
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
