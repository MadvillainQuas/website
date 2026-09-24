"""Fouled out: no sixth foul in anybody's name, and nobody on court at the end with five.

    python scripts/ingest/translate/fouls_test.py

THE BUG THIS PINS (found 2026-09-23 loading CIBACOPA and the LNBP). finalise-game's gate
refuses a player with more than five fouls, or with five who is still on court, and a game it
refuses stays "live" for good: a February game on HOME's live strip in September. Three feed
shapes got there:

  - a technical drawn from the bench after the fifth foul (CIBACOPA 2817625: Farmer's fifth at
    Q4 1:02, subbed off at 1:02, a technical at 1:02). FIBA records a foul by a player with five
    against the bench, and so does the translator now: the team's foul, without his name;
  - an operator's sixth personal on a player never taken off (an LNBP game): the same rule;
  - a player back on court after his fifth because a substitution's missing half arrived late,
    as a correction, and applied then (LNBP f822ee66). The translator subbed off only the players
    on court AT their fifth; it now checks everybody with five at the end of the log. The
    replacement it sends on is never another player with five.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from translate.fiba_events import translate  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


def pl(*pnos):
    return {str(p): {"firstName": "P", "familyName": str(p), "shirtNumber": str(p), "starter": 1 if p <= 5 else 0}
            for p in pnos}


def game(actions):
    """Side 1 has players 1-9, side 2 players 1-5; 1-5 start."""
    raw = {"tm": {"1": {"name": "Home", "pl": pl(*range(1, 10))}, "2": {"name": "Away", "pl": pl(*range(1, 6))}},
           "pbp": [], "period": 4}
    for n, a in enumerate(actions, 1):
        at, sub, tno, pno, period, gt = a
        raw["pbp"].append({"actionNumber": n, "actionType": at, "subType": sub, "tno": tno, "pno": pno,
                           "period": period, "periodType": "REGULAR", "gt": gt, "success": 1, "qualifier": []})
    return raw


def run(actions):
    return translate(game(actions), lambda t, p: "%d:%s" % (t, p))


def fouls(T):
    n = {}
    for e in T["events"]:
        if e["t"] == "foul" and e["pid"]:
            n[e["pid"]] = n.get(e["pid"], 0) + 1
    return n


def on_court_at_end(T, team=0):
    """The engine's replay: every substitution in log order, as a set operation."""
    on = set(T["starters"][team])
    for e in T["events"]:
        if e["t"] == "sub" and e["team"] == team:
            on.discard(e["payload"]["out"])
            on.add(e["payload"]["in"])
    return on


def gate(T):
    """finalise-game's foul test: more than five, or five and still on court."""
    pf, on = fouls(T), on_court_at_end(T)
    return [p for p, n in pf.items() if n > 5 or (n == 5 and p in on)]


def five(pno, period, *clocks):
    return [("foul", "personal", 1, pno, period, c) for c in clocks]


start = [("period", "start", 0, 0, 4, "10:00")]

print("-- a technical from the bench after the fifth (CIBACOPA 2817625)")
T = run(start + five(2, 4, "08:00", "06:00", "04:00", "02:00", "01:02") +
        [("substitution", "out", 1, 2, 4, "01:02"), ("substitution", "in", 1, 6, 4, "01:02"),
         ("foul", "technical", 1, 2, 4, "01:02"), ("freethrow", "1of1", 2, 1, 4, "01:02")])
tech = [e for e in T["events"] if e["t"] == "foul" and e["payload"]["kind"] == "tech"]
ok("the technical stays in the log, as the team's foul", len(tech) == 1 and tech[0]["team"] == 0 and tech[0]["pid"] is None, tech)
ok("...and his fouls stop at five", fouls(T).get("0:2") == 5, fouls(T))
ok("the gate passes", gate(T) == [], gate(T))

print("\n-- an operator's sixth personal on a player never taken off")
T = run(start + five(3, 4, "09:00", "07:00", "05:00", "03:00", "01:26") + [("foul", "personal", 1, 3, 4, "01:07"),
        ("substitution", "out", 1, 3, 4, "00:51"), ("substitution", "in", 1, 6, 4, "00:51")])
ok("five in his name, the sixth the team's", fouls(T).get("0:3") == 5 and
   sum(1 for e in T["events"] if e["t"] == "foul" and e["team"] == 0 and e["pid"] is None) == 1, fouls(T))
ok("the gate passes", gate(T) == [], gate(T))

print("\n-- back on court after his fifth, through a substitution completed late (LNBP f822ee66)")
acts = start + [
    ("substitution", "out", 1, 4, 4, "09:30"), ("substitution", "in", 1, 6, 4, "09:30"),   # 4 off for 6
    ("substitution", "in", 1, 4, 4, "08:00"),                                              # 4 back: the OUT half missing
] + five(4, 4, "07:30", "07:00", "06:30", "06:00", "05:30") + \
    five(6, 4, "07:40", "07:10", "06:40", "06:10", "05:40") + [                            # 6 fouls out too
    ("2pt", "layup", 1, 1, 4, "03:00"),
    ("substitution", "out", 1, 6, 4, "08:00"),                                             # the missing half, entered late
    ("2pt", "layup", 2, 1, 4, "01:00")]
T = run(acts)
on = on_court_at_end(T)
ok("he does not end the game on court", "0:4" not in on, sorted(on))
ok("...replaced by a player without five fouls, not by 6 (who also has five)",
   "0:6" not in on and len(on) == 5 and all(fouls(T).get(p, 0) < 5 for p in on), (sorted(on), fouls(T)))
ok("...said so in the report", any("fabricated sub for fouled-out 0:4" in w for w in T["report"]["warnings"]),
   T["report"]["warnings"])
ok("the gate passes", gate(T) == [], gate(T))

print("\n-- what does not change")
T = run(start + five(5, 4, "09:00", "08:00", "07:00", "06:00", "05:00") +
        [("substitution", "out", 1, 5, 4, "05:00"), ("substitution", "in", 1, 7, 4, "05:00")])
ok("a player with five, subbed off at the time: five fouls in his name, no substitution invented",
   fouls(T).get("0:5") == 5 and not any("fabricated" in w for w in T["report"]["warnings"]), (fouls(T), T["report"]["warnings"]))
T = run(start + five(1, 4, "09:00", "08:00", "07:00", "06:00"))
ok("four fouls is four fouls, on court or not", fouls(T).get("0:1") == 4 and "0:1" in on_court_at_end(T))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
