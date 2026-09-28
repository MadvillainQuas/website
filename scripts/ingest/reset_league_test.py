"""reset_league.py, offline: the progress the console's bar draws, and the polite deletes.

    python scripts/ingest/reset_league_test.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reset_league as R  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


print("-- the bar")
sent = []
pg = R.Progress(lambda step, d: sent.append((step, d)), every=0)
ok("the phases share exactly 100", sum(w for _, _, w in R.Progress.PHASES) == 100)
pg.tick("read")
ok("reading starts at 0", sent[-1][1]["pct"] == 0, sent[-1])
pg.tick("events", 50, 100)
ok("half the play-by-play is 3 + 2 + 12.5", sent[-1][1]["pct"] == 17.5, sent[-1])
ok("...and the sentence says how many", "50 of 100" in sent[-1][0], sent[-1][0])
pg.tick("reread", 100, 100)
ok("the last game read is 100", sent[-1][1]["pct"] == 100, sent[-1])
pg2 = R.Progress(lambda step, d: sent.append((step, d)), every=3600)
n = len(sent)
pg2.tick("games", 1, 10)
pg2.tick("games", 2, 10)
pg2.tick("games", 3, 10)
ok("throttled: one write per phase until the interval passes", len(sent) == n + 1, len(sent) - n)
pg2.tick("ingest", 0, 5)
ok("...but a new phase is written at once", len(sent) == n + 2)

print("\n-- polite deletes")


class Resp:
    def __init__(self, code, text=""):
        self.status_code, self.text = code, text


class Session:
    def __init__(self, heavy_over):
        self.heavy_over, self.calls = heavy_over, []

    def delete(self, url, headers=None, timeout=None):
        n = url.split("in.(")[1].rstrip(")").count(",") + 1
        self.calls.append(n)
        if n > self.heavy_over:
            return Resp(500, '{"code":"57014","message":"canceling statement due to statement timeout"}')
        return Resp(204)


db = R.DB("http://x", "k", pause=0)
db.s = Session(heavy_over=5)
steps = []
done = db.delete_in("games", "id", [str(i) for i in range(23)], 20, "games", lambda d, t: steps.append((d, t)))
ok("every row goes in the end", done == 23, done)
ok("a batch the database cannot finish is halved (20 -> 10 -> 5)", db.s.calls[:3] == [20, 10, 5], db.s.calls)
ok("no request ever larger than it managed", all(c <= 5 for c in db.s.calls[3:]), db.s.calls)
ok("progress after every batch, ending at the total", steps and steps[-1] == (23, 23), steps[-3:])


class Broken(Session):
    def delete(self, url, headers=None, timeout=None):
        return Resp(403, '{"message":"permission denied"}')


db.s = Broken(0)
try:
    db.delete_in("games", "id", ["1", "2"], 20, "games")
    ok("a refusal (not a timeout) stops the reset", False)
except RuntimeError as exc:
    ok("a refusal (not a timeout) stops the reset", "403" in str(exc), str(exc))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
