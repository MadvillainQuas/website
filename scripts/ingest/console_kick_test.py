"""The console's jobs are started as soon as they are asked for, offline:

    python scripts/ingest/console_kick_test.py

What this holds (console_kick.py, run_ingest.py, console-jobs.yml, ingest.yml):
  * a kick with no token, or nothing queued, starts nothing; a queued request nobody has started is started once, and
    every queued row is stamped with when; one started in the last fifteen minutes is not started again, one started
    longer ago than that is; a refusal from GitHub stamps nothing; each kind can be kicked on its own;
  * a database without 0217 (no dispatched_at) is still started, just not noted;
  * a queued "send next week's reports now" (report_mail_requests, 0226) starts report-mail.yml the same way, each
    worker judged on its own queues: a fresh backfill is started while the mailer waits on one started a minute ago, a
    request nobody took in three hours is given up, a database without 0226 holds nothing else up, and a refusal for
    one worker does not stop the other;
  * the dispatch is GitHub's workflow_dispatch for console-jobs.yml (or report-mail.yml) on the branch asked for, with the token;
  * the light client: two PostgREST calls with the service key and nothing to install;
  * the live lane kicks every two minutes; a backfill says each step at once (force), with its run's log, and a season
    with nothing on its schedule is failed with the reason rather than "done";
  * the workflow: a reset and a backfill in jobs of their own, each asking the queue before installing anything, the
    backfill taking every queued season in turn, both starting the workflow again when something is still queued.
"""
import io
import json
import os
import sys
import time
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import console_kick as K  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


class Q:
    """the two queues as PostgREST would answer them, and every patch written"""

    def __init__(self, backfills=(), resets=(), reports=(), no_column=False, no_reports=False):
        self.rows = {"season_backfills": [dict(r) for r in backfills], "league_resets": [dict(r) for r in resets],
                     "report_mail_requests": [dict(r) for r in reports]}
        self.no_column, self.no_reports = no_column, no_reports
        self.selects, self.patches = [], []

    def select(self, table, query):
        self.selects.append((table, query))
        if self.no_reports and table == "report_mail_requests":
            raise RuntimeError('relation "report_mail_requests" does not exist')
        if self.no_column and "dispatched_at" in query:
            raise RuntimeError("column season_backfills.dispatched_at does not exist")
        return [dict(r) for r in self.rows[table]]

    def patch(self, table, query, body):
        if self.no_column:
            raise RuntimeError("column dispatched_at does not exist")
        self.patches.append((table, query, body))


ENV = {"GH_TOKEN": "ghs_x", "GITHUB_REPOSITORY": "owner/site"}
NOW = 1_800_000_000.0
iso = lambda t: __import__("datetime").datetime.fromtimestamp(t, __import__("datetime").timezone.utc).isoformat()


def sender(answer=(True, "HTTP 204"), refuse=()):
    """the dispatcher: calls are (repo, token, ref); send.flows says which workflow each one asked for; a workflow named
    in refuse is refused with HTTP 403"""
    calls, flows = [], []

    def send(repo, token, ref, workflow=K.WORKFLOW):
        calls.append((repo, token, ref))
        flows.append(workflow)
        return (False, "HTTP 403") if workflow in refuse else answer
    send.flows = flows
    return send, calls


print("\nwho starts the worker, and when")
send, calls = sender()
ok("no token: nothing is started", K.kick(Q(backfills=[{"id": "b1"}]), env={}, send=send) == "not set up" and not calls)
ok("nothing queued: nothing is started", K.kick(Q(), env=ENV, now=NOW, send=send) == "nothing queued" and not calls)

q = Q(backfills=[{"id": "b1", "requested_at": "x", "dispatched_at": None}, {"id": "b2", "dispatched_at": None}],
      resets=[{"id": "r1", "dispatched_at": None}])
said = K.kick(q, env=dict(ENV, CONSOLE_JOBS_REF="claude/x"), now=NOW, send=send)
ok("a queued request nobody has started is started once, on the branch asked for, with the token",
   said.startswith("started the worker for 3") and calls == [("owner/site", "ghs_x", "claude/x")], (said, calls))
ok("...and every queued row of both kinds says when", sorted((t, qq) for t, qq, _ in q.patches) ==
   [("league_resets", "id=in.(r1)&state=eq.queued"), ("season_backfills", "id=in.(b1,b2)&state=eq.queued")] and
   all(b == {"dispatched_at": iso(NOW)} for _, _, b in q.patches), q.patches)

send, calls = sender()
recent = Q(backfills=[{"id": "b1", "dispatched_at": iso(NOW - 600)}, {"id": "b2", "dispatched_at": None}])
ok("one started ten minutes ago is not started again (a request queued since is taken by that run)",
   K.kick(recent, env=ENV, now=NOW, send=send) == "already started" and not calls and not recent.patches)
stale = Q(backfills=[{"id": "b1", "dispatched_at": iso(NOW - 20 * 60)}])
ok("one started twenty minutes ago and still waiting is started again",
   K.kick(stale, env=ENV, now=NOW, send=send).startswith("started") and len(calls) == 1)

send, calls = sender((False, "HTTP 403"))
refused = Q(backfills=[{"id": "b1", "dispatched_at": None}])
ok("GitHub refusing: said, and nothing is stamped", K.kick(refused, env=ENV, now=NOW, send=send) == "dispatch failed: HTTP 403" and not refused.patches)

send, calls = sender()
only = Q(backfills=[{"id": "b1", "dispatched_at": None}], resets=[{"id": "r1", "dispatched_at": None}])
said = K.kick(only, env=ENV, now=NOW, send=send, kinds=("backfill",))
ok("a kind on its own: the backfill job asks about backfills only, and stamps only those",
   said.startswith("started the worker for 1") and {t for t, _ in only.selects} == {"season_backfills"} and
   [t for t, _, _ in only.patches] == ["season_backfills"], (said, only.selects, only.patches))

print("\nthe report mailer, started the same way (0226)")
send, calls = sender()
rq = Q(reports=[{"id": "q1", "requested_at": iso(NOW - 120), "dispatched_at": None}])
said = K.kick(rq, env=ENV, now=NOW, send=send)
ok("a queued \"send next week's reports now\" starts report-mail.yml, and only that, and its row says when",
   said.startswith("started the worker for 1") and send.flows == ["report-mail.yml"] and
   rq.patches == [("report_mail_requests", "id=in.(q1)&state=eq.queued", {"dispatched_at": iso(NOW)})], (said, send.flows, rq.patches))

send, calls = sender()
three = Q(backfills=[{"id": "b1"}], resets=[{"id": "r1"}], reports=[{"id": "q1", "requested_at": iso(NOW - 60)}, {"id": "q2", "requested_at": iso(NOW - 30)}])
said = K.kick(three, env=ENV, now=NOW, send=send)
ok("a backfill, a reset and two report requests: console-jobs.yml once and report-mail.yml once, every row noted",
   said.startswith("started the worker for 4") and sorted(send.flows) == ["console-jobs.yml", "report-mail.yml"] and
   sorted((t, qq) for t, qq, _ in three.patches) == [("league_resets", "id=in.(r1)&state=eq.queued"), ("report_mail_requests", "id=in.(q1,q2)&state=eq.queued"),
                                                    ("season_backfills", "id=in.(b1)&state=eq.queued")], (said, send.flows, three.patches))

send, calls = sender()
judged = Q(backfills=[{"id": "b1", "dispatched_at": None}], reports=[{"id": "q1", "requested_at": iso(NOW - 300), "dispatched_at": iso(NOW - 60)}])
said = K.kick(judged, env=ENV, now=NOW, send=send)
ok("each worker is judged on its own: the mailer started a minute ago waits, a fresh backfill is started",
   said.startswith("started the worker for 1") and send.flows == ["console-jobs.yml"] and [t for t, _, _ in judged.patches] == ["season_backfills"], (said, send.flows))
send, calls = sender()
waiting = Q(reports=[{"id": "q1", "requested_at": iso(NOW - 300), "dispatched_at": iso(NOW - 60)}])
ok("...and a mailer started a minute ago, with nothing else queued, is not started again", K.kick(waiting, env=ENV, now=NOW, send=send) == "already started" and not calls)
send, calls = sender()
late = Q(reports=[{"id": "q1", "requested_at": iso(NOW - 20 * 60), "dispatched_at": iso(NOW - 16 * 60)}])
ok("...but one still waiting sixteen minutes after its start is started again", K.kick(late, env=ENV, now=NOW, send=send).startswith("started") and send.flows == ["report-mail.yml"])

send, calls = sender()
stale = Q(reports=[{"id": "q1", "requested_at": iso(NOW - 4 * 3600), "dispatched_at": None}], backfills=[])
ok("a request nobody took in three hours is given up (the database fails it): it is not started for, and no run is wasted on it",
   K.kick(stale, env=ENV, now=NOW, send=send) == "nothing queued" and not calls)

send, calls = sender()
before = Q(backfills=[{"id": "b1", "dispatched_at": None}], no_reports=True)
said = K.kick(before, env=ENV, now=NOW, send=send)
ok("a database without 0226 has no such table: the backfill is started all the same, and the lane carries on",
   said.startswith("started the worker for 1") and send.flows == ["console-jobs.yml"], (said, send.flows))
ok("...but a missing table of the other kinds is still the caller's to judge", K.kick(Q(no_reports=True, backfills=[]), env=ENV, now=NOW, send=send) == "nothing queued")

send, calls = sender(refuse=("report-mail.yml",))
half = Q(backfills=[{"id": "b1", "dispatched_at": None}], reports=[{"id": "q1", "requested_at": iso(NOW - 60), "dispatched_at": None}])
said = K.kick(half, env=ENV, now=NOW, send=send)
ok("GitHub refusing the mailer does not stop the backfill, and the refused request is not noted as started",
   said.startswith("started the worker for 1") and sorted(send.flows) == ["console-jobs.yml", "report-mail.yml"] and [t for t, _, _ in half.patches] == ["season_backfills"], (said, half.patches))
send, calls = sender(refuse=("report-mail.yml",))
lone = Q(reports=[{"id": "q1", "requested_at": iso(NOW - 60), "dispatched_at": None}])
ok("...and when the mailer alone is refused, that is said", K.kick(lone, env=ENV, now=NOW, send=send) == "dispatch failed: HTTP 403" and not lone.patches)

send, calls = sender()
only = Q(backfills=[{"id": "b1", "dispatched_at": None}], reports=[{"id": "q1", "requested_at": iso(NOW - 60), "dispatched_at": None}])
said = K.kick(only, env=ENV, now=NOW, send=send, kinds=("report",))
ok("a kind on its own: the mailer's start asks about report requests only", said.startswith("started the worker for 1") and {t for t, _ in only.selects} == {"report_mail_requests"} and send.flows == ["report-mail.yml"])
import inspect  # noqa: E402
ok("the live lane's own call (no kinds named) takes all three", inspect.signature(K.kick).parameters["kinds"].default == ("backfill", "reset", "report") and
   K.WORKFLOWS == {"backfill": "console-jobs.yml", "reset": "console-jobs.yml", "report": "report-mail.yml"} and K.TABLES["report"] == "report_mail_requests")

send, calls = sender()
old = Q(backfills=[{"id": "b1"}], no_column=True)
said = K.kick(old, env=ENV, now=NOW, send=send)
ok("before 0217 (no dispatched_at): the queue is read without it and the worker is started all the same",
   said.startswith("started") and len(calls) == 1 and any("dispatched_at" not in qq for _, qq in old.selects), (said, old.selects))


class Boom:
    def select(self, *a):
        raise RuntimeError("the database is away")


ok("a kick never raises: the live lane calls it between polls of live games",
   K.kick(Boom(), env=ENV, now=NOW, send=sender()[0]).startswith("kick failed"))

print("\nthe dispatch and the client")


class Resp:
    def __init__(self, status=204, body=b""):
        self.status, self._b = status, body

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


seen = []


def opener(req, timeout=None):
    seen.append(req)
    return Resp(204)


good = K.dispatch("owner/site", "tok", "main", opener=opener)
r = seen[-1]
ok("workflow_dispatch of console-jobs.yml: POST, the token, GitHub's JSON, the branch in the body",
   good == (True, "HTTP 204") and r.get_method() == "POST" and
   r.full_url == "https://api.github.com/repos/owner/site/actions/workflows/console-jobs.yml/dispatches" and
   r.headers.get("Authorization") == "Bearer tok" and r.headers.get("Accept") == "application/vnd.github+json" and
   json.loads(r.data) == {"ref": "main"}, (good, r.full_url, dict(r.headers)))


def refuse(req, timeout=None):
    raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b"{}"))


ok("...a refusal is said with its status", K.dispatch("owner/site", "tok", opener=refuse) == (False, "HTTP 404"))
K.dispatch("owner/site", "tok", "main", workflow=K.REPORT_WORKFLOW, opener=opener)
ok("...and the mailer's is the same call for report-mail.yml", seen[-1].full_url == "https://api.github.com/repos/owner/site/actions/workflows/report-mail.yml/dispatches")

seen.clear()
rest = K.Rest("https://x.supabase.co/", "svc", opener=lambda req, timeout=None: (seen.append(req), Resp(200, b'[{"id":"b1"}]'))[1])
rows = rest.select("season_backfills", "state=eq.queued&select=id")
rest.patch("season_backfills", "id=in.(b1)", {"dispatched_at": "t"})
ok("the light client: PostgREST with the service key, a select and a patch (return=minimal)",
   rows == [{"id": "b1"}] and seen[0].full_url == "https://x.supabase.co/rest/v1/season_backfills?state=eq.queued&select=id" and
   seen[0].headers.get("Apikey") == "svc" and seen[1].get_method() == "PATCH" and seen[1].headers.get("Prefer") == "return=minimal" and
   json.loads(seen[1].data) == {"dispatched_at": "t"}, [s.full_url for s in seen])
ok("...and console_kick.py imports nothing but the standard library",
   not any(l.startswith(("import requests", "from run_ingest", "import run_ingest")) for l in open(os.path.join(HERE, "console_kick.py")).read().splitlines()))

print("\nthe worker says what it is doing")
import run_ingest as R  # noqa: E402
SRC = open(os.path.join(HERE, "run_ingest.py")).read()
ok("the live lane kicks the console's jobs every two minutes", "said = console_kick.kick(sb)" in SRC and
   "console_check = time.time() + 120" in SRC and "import console_kick" in SRC)


class Rpc:
    def __init__(self):
        self.calls = []

    def rpc(self, fn, body):
        self.calls.append((fn, body))


rq = Rpc()
R._BEAT = {"q": rq, "id": "job", "at": time.time()}
R.beat(5.0, "a game", force=False)
R.beat(1.0, "reading the schedule", force=True, extra={"run_url": "https://github.com/o/r/actions/runs/1"})
R.beat(2.0, "writing fixtures", force=True)
R._BEAT = None
ok("a new step is said at once (force), a game's progress no more than every 8 s",
   [c[1]["p_step"] for c in rq.calls] == ["reading the schedule", "writing fixtures"] and
   rq.calls[0][1]["p_detail"] == {"run_url": "https://github.com/o/r/actions/runs/1", "pct": 1.0}, rq.calls)
ok("...the claim says so with its run's log, and so do the sources, the schedule and the fixtures",
   'beat(0.5, "taken by the worker: reading the league\'s sources", force=True' in SRC and
   'source(s) to read for {job[\'season\']}' in SRC and "reading the {job['season']} schedule" in SRC and
   "game(s) on the {job['season']} schedule" in SRC and "fixture(s) of {job['season']}" in SRC)
ok("a season with nothing on its schedule is failed, with the reason, not \"done\"",
   'if not exit_code and not tot["seen"]:' in SRC and "the source shows nothing for that season" in SRC)
RS = open(os.path.join(HERE, "reset_league.py")).read()
ok("a reset says when it is taken, with its run's log", 'send("taken by the worker", {"pct": 0.5, "run_url":' in RS)

print("\nthe workflows")
ROOT = os.path.dirname(os.path.dirname(HERE))
WF = open(os.path.join(ROOT, ".github", "workflows", "console-jobs.yml")).read()
IN = open(os.path.join(ROOT, ".github", "workflows", "ingest.yml")).read()
try:
    import yaml
    d = yaml.safe_load(WF)
    jobs = d["jobs"]
    ok("a reset and a backfill are jobs of their own, each its own concurrency group, waiting rather than cancelling",
       set(jobs) == {"reset", "backfill"} and jobs["reset"]["concurrency"]["group"] != jobs["backfill"]["concurrency"]["group"] and
       not jobs["reset"]["concurrency"]["cancel-in-progress"] and "concurrency" not in d)
    for name, job in jobs.items():
        steps = job["steps"]
        q = next(i for i, s in enumerate(steps) if s.get("name") == "Anything queued?")
        heavy = [s for s in steps[q + 1:] if s.get("name") not in ("Start again if something is still queued", "Keep the backup")]
        ok(f"{name}: the queue is asked before anything is installed, and nothing heavy runs when it is empty",
           q == 1 and all("steps.q.outputs.any == 'true'" in str(s.get("if", "")) for s in heavy), [s.get("if") for s in heavy])
        last = steps[-1]
        ok(f"{name}: it starts the workflow again when something of its kind is still queued",
           last.get("name") == "Start again if something is still queued" and last.get("if") == "${{ always() }}" and
           f"console_kick.py --kick {name}" in last["run"] and last["env"].get("GH_TOKEN") == "${{ github.token }}")
    ok("the workflow may start itself (actions: write), and the cron stays as the floor",
       d["permissions"].get("actions") == "write" and d[True]["schedule"][0]["cron"] == "7-57/10 * * * *")
except ImportError:
    print("  SKIP  the workflow's shape (PyYAML is not installed)")
ok("the backfill job takes every queued season in turn, its log unbuffered",
   "for i in 1 2 3 4 5 6; do" in WF and "console_kick.py --queued backfill || break" in WF and
   "python -u scripts/ingest/run_ingest.py --config --backfill" in WF and 'PYTHONUNBUFFERED: "1"' in WF)
ok("the live lane holds the workflow's own token, to start the console's jobs", "GH_TOKEN: ${{ github.token }}\n        run: |\n          python scripts/ingest/run_ingest.py --config" in IN)
RM = open(os.path.join(ROOT, ".github", "workflows", "report-mail.yml")).read()
ok("report-mail.yml can be started by dispatch, with no input needed, and has an hourly slot as its floor beside the half-hourly one",
   "workflow_dispatch:" in RM and "required: true" not in RM and "cron: '7,37 * * * *'" in RM and "cron: '22 * * * *'" in RM, RM[:900])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
