"""Substitutions: every change at one instant is one change, whenever its halves were logged.

    python scripts/ingest/translate/subs_test.py

THE BUG THIS PINS (found 2026-09-23 auditing the full stats tab against LiveStats' own box).
The translator paired a substitution's OUT and IN only when they arrived back to back, flushing
at the first action of any other kind. Operators do not always log them that way:

  - they split one change with the other actions at its clock (the OUT, the foul and the free
    throws, then the IN);
  - they enter a forgotten half minutes later, as a correction stamped with the original clock
    (2702552: "out Jack" live at P1 03:05, "in Anthony" at P1 03:05 entered 250 actions later).

Both halves were then dropped as "unpaired", and the next ordinary change left a side with four
or six on the floor -- in 22 of the 160 saved SLB games, for 19 seconds to 23 minutes, and every
minute, plus/minus and on-court figure of those players with it. A late correction can also
restate a change that a live one at the same instant continues (2778590, P4 06:49: "Lindo off,
White on" live and "White off, Policelli on" late, with White already on since 08:30): applied
one after the other that took White off as well -- four on the floor for 409 s.
"""
import io
import json
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
    """A two-side payload: side 1 has players 1-9, side 2 players 1-5; 1-5 start."""
    raw = {"tm": {"1": {"name": "Home", "pl": pl(*range(1, 10))}, "2": {"name": "Away", "pl": pl(*range(1, 6))}},
           "pbp": [], "period": 1}
    for n, a in enumerate(actions, 1):
        at, sub, tno, pno, period, gt = a
        raw["pbp"].append({"actionNumber": n, "actionType": at, "subType": sub, "tno": tno, "pno": pno,
                           "period": period, "periodType": "REGULAR", "gt": gt, "success": 1, "qualifier": []})
    return raw


def subs(T, team=0):
    return [(e["period"], e["clock"], e["payload"]["out"], e["payload"]["in"]) for e in T["events"]
            if e["t"] == "sub" and e["team"] == team]


def pid(p):
    return "0:%d" % p


start = [("period", "start", 0, 0, 1, "10:00")]

print("-- the two halves of one change, however they were logged")
T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "in", 1, 6, 1, "05:00")]),
              lambda t, p: "%d:%s" % (t, p))
ok("back to back: one change", subs(T) == [(1, 300000, pid(2), pid(6))], subs(T))

T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("foul", "personal", 2, 3, 1, "05:00"),
                            ("freethrow", "1of2", 1, 1, 1, "05:00"), ("freethrow", "2of2", 1, 1, 1, "05:00"),
                            ("substitution", "in", 1, 6, 1, "05:00")]), lambda t, p: "%d:%s" % (t, p))
ok("split by the foul and free throws at its clock: still one change", subs(T) == [(1, 300000, pid(2), pid(6))], subs(T))
ok("...and nothing is reported unpaired", not T["report"]["warnings"], T["report"]["warnings"])

late = start + [("substitution", "out", 1, 2, 1, "03:05"), ("2pt", "layup", 1, 1, 1, "02:50"),
                ("2pt", "layup", 2, 1, 1, "02:10"), ("period", "end", 0, 0, 1, "00:00"),
                ("period", "start", 0, 0, 2, "10:00"), ("2pt", "layup", 1, 1, 2, "09:00"),
                ("substitution", "in", 1, 6, 1, "03:05")]
T = translate(game(late), lambda t, p: "%d:%s" % (t, p))
ok("the IN entered a quarter later at the old clock pairs with its OUT (the 2702552 shape)",
   subs(T) == [(1, 185000, pid(2), pid(6))], subs(T))
ok("...stamped with the change's own clock, so the replay puts it back where it happened",
   [e["clock"] for e in T["events"] if e["t"] == "sub"] == [185000])

T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "out", 1, 3, 1, "05:00"),
                            ("substitution", "in", 1, 6, 1, "05:00"), ("substitution", "in", 1, 7, 1, "05:00")]),
              lambda t, p: "%d:%s" % (t, p))
ok("a double change is two pairs", subs(T) == [(1, 300000, pid(2), pid(6)), (1, 300000, pid(3), pid(7))], subs(T))

print("\n-- every change at one instant is one change")
chain = start + [("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "in", 1, 6, 1, "05:00"),
                 ("2pt", "layup", 1, 1, 1, "04:40"),
                 ("substitution", "out", 1, 6, 1, "05:00"), ("substitution", "in", 1, 7, 1, "05:00")]
T = translate(game(chain), lambda t, p: "%d:%s" % (t, p))
ok("2 off for 6, then (late) 6 off for 7 at the same instant: 2 off for 7 (the 2778590 shape)",
   subs(T) == [(1, 300000, pid(2), pid(7))], subs(T))
chain2 = start + [("substitution", "out", 1, 6, 1, "05:00"), ("substitution", "in", 1, 7, 1, "05:00"),
                  ("2pt", "layup", 1, 1, 1, "04:40"),
                  ("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "in", 1, 6, 1, "05:00")]
T = translate(game(chain2), lambda t, p: "%d:%s" % (t, p))
ok("...and the same change logged the other way round", subs(T) == [(1, 300000, pid(2), pid(7))], subs(T))
T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "out", 1, 6, 1, "05:00"),
                            ("substitution", "in", 1, 6, 1, "05:00"), ("substitution", "in", 1, 7, 1, "05:00")]),
              lambda t, p: "%d:%s" % (t, p))
ok("inside one group too: 2 and 6 off, 6 and 7 on, is 2 off for 7", subs(T) == [(1, 300000, pid(2), pid(7))], subs(T))
T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("substitution", "in", 1, 6, 1, "05:00"),
                            ("2pt", "layup", 1, 1, 1, "04:00"),
                            ("substitution", "out", 1, 6, 1, "04:00"), ("substitution", "in", 1, 7, 1, "04:00")]),
              lambda t, p: "%d:%s" % (t, p))
ok("a second change at a DIFFERENT clock is a second change", subs(T) == [(1, 300000, pid(2), pid(6)), (1, 240000, pid(6), pid(7))], subs(T))

print("\n-- a half that never gets its partner")
T = translate(game(start + [("substitution", "out", 1, 2, 1, "05:00"), ("2pt", "layup", 1, 1, 1, "04:00")]),
              lambda t, p: "%d:%s" % (t, p))
ok("an OUT with no IN anywhere in the log is dropped, and said so",
   subs(T) == [] and any("unpaired" in w for w in T["report"]["warnings"]), (subs(T), T["report"]["warnings"]))

print("\n-- the two real games")
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "..", "data", "data_2026-05-09T15-59_SLB", "game_data"))


def real(gid):
    raw = json.load(io.open(os.path.join(DATA, gid + ".json"), encoding="utf-8"))
    return raw, translate(raw, lambda t, p: "%d:%s" % (t, p))


def always_five(T, team):
    """Replay the side's subs in GAME order (period, clock, seq), as the engine does."""
    plen = lambda p: 600000 if p <= 4 else 300000  # noqa: E731

    def cum(e):
        p = e["period"] or 1
        c = e["clock"] if e["clock"] is not None else plen(p)
        return sum(plen(q) for q in range(1, p)) + plen(p) - c

    on = set(T["starters"][team])
    for e in sorted((e for e in T["events"] if e["t"] == "sub" and e["team"] == team), key=lambda e: (cum(e), e["seq"])):
        on.discard(e["payload"]["out"])
        on.add(e["payload"]["in"])
        if len(on) != 5:
            return False, (e["seq"], e["period"], e["clock"], len(on))
    return True, None


raw, T = real("2702552")
five, where = always_five(T, 1)
ok("2702552: the away side is five on the floor all game (was four for 23 minutes)", five, where)
ok("...Jack off and Anthony back on at P1 03:05, as the operator logged it a quarter later",
   ("1:" + next(k for k, v in raw["tm"]["2"]["pl"].items() if v["familyName"] == "Jack"),
    "1:" + next(k for k, v in raw["tm"]["2"]["pl"].items() if v["familyName"] == "Anthony"))
   in [(e["payload"]["out"], e["payload"]["in"]) for e in T["events"] if e["t"] == "sub" and e["period"] == 1 and e["clock"] == 185000])
raw, T = real("2778590")
five, where = always_five(T, 1)
ok("2778590: the away side is five on the floor all game (was four for 409 s)", five, where)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
