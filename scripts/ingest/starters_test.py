"""infer_starters: a side whose feed flags fewer than five starters gets the rest from the play-by-play."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translate.fiba_events import translate

FAILED = 0
def ok(name, cond):
    global FAILED
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond: FAILED += 1

def raw(flag_side2):
    def side(k, flagged):
        pl = {str(n): {"firstName": "P", "familyName": f"{k}{n}", "shirtNumber": str(n), "starter": "1" if n in flagged else "0"} for n in range(1, 9)}
        return {"name": f"Team {k}", "pl": pl}
    pbp, an = [], 0
    def add(**kw):
        nonlocal an
        an += 1
        pbp.append(dict({"actionNumber": an, "period": 1, "periodType": "REGULAR", "gt": "09:00"}, **kw))
    add(actionType="period", subType="start", tno=0)
    for n in (1, 2, 3, 4, 5):          # side 1: all five flagged and all act
        add(actionType="2pt", subType="jumpshot", success=1, tno=1, pno=n)
    for n in (11, 12):                  # side 2: acts before ever coming on
        pass
    add(actionType="2pt", subType="layup", success=1, tno=2, pno=1)
    add(actionType="rebound", subType="defensive", tno=2, pno=2)
    add(actionType="substitution", subType="out", tno=2, pno=3, gt="08:00")
    add(actionType="substitution", subType="in", tno=2, pno=6, gt="08:00")
    add(actionType="3pt", subType="", success=0, tno=2, pno=6, gt="07:50")
    add(actionType="substitution", subType="out", tno=2, pno=4, gt="07:00")
    add(actionType="substitution", subType="in", tno=2, pno=7, gt="07:00")
    return {"tm": {"1": side(1, {1, 2, 3, 4, 5}), "2": side(2, flag_side2)}, "pbp": pbp}

def ids(t, d):
    m = {p["id"]: p["name"] for p in d["roster_snapshot"]["teams"][t]["players"]}
    return sorted(m[i] for i in d["starters"][t])

d = translate(raw({1}))
ok("one flagged starter: the others come from the play-by-play", ids(1, d) == ["P 21", "P 22", "P 23", "P 24"])
ok("the flagged one is kept", "P 21" in ids(1, d))
ok("a bench player who only ever came on is not a starter", "P 26" not in ids(1, d) and "P 27" not in ids(1, d))
ok("never more than five", len(d["starters"][1]) <= 5)
ok("the full side is untouched", ids(0, d) == ["P 11", "P 12", "P 13", "P 14", "P 15"])
ok("the report says so", any("starters inferred for side 2" in w for w in d["report"]["warnings"]))
d2 = translate(raw({1, 2, 3, 4, 5}))
ok("a side already at five is left as flagged", ids(1, d2) == ["P 21", "P 22", "P 23", "P 24", "P 25"])
ok("no inference warning then", not any("inferred" in w for w in d2["report"]["warnings"]))
d3 = translate(raw(set()))
ok("no flags at all: four found from the log, none of them bench", len(d3["starters"][1]) == 4 and "P 26" not in ids(1, d3))
print(f"\n{FAILED} failed" if FAILED else "\nall passed")
sys.exit(1 if FAILED else 0)
