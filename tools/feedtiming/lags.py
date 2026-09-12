import json, collections, statistics, sys
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
d = json.load(_open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "feed.json")))
p = sorted(d["pbp"], key=lambda e: int(e["actionNumber"]))
def cms(e):
    m, s, c = e["clock"].split(":")
    return int(m) * 60000 + int(s) * 1000 + int(c) * 10
# missed shot -> next rebound in same period
dl = []
for i, e in enumerate(p):
    if e["actionType"] in ("2pt", "3pt") and str(e.get("success")) == "0":
        for f in p[i + 1:i + 4]:
            if f["actionType"] == "rebound" and f["period"] == e["period"]:
                dl.append((cms(e) - cms(f)) / 1000); break
print("miss->rebound game-clock delta (s): n", len(dl), "dist", sorted(collections.Counter(dl).items()))
# made shot -> assist same clock?
same = sum(1 for i, e in enumerate(p[:-1]) if e["actionType"] == "assist" and e["clock"] == p[i - 1]["clock"])
print("assists at same clock as preceding action", same, "of", sum(1 for e in p if e["actionType"] == "assist"))
# actionNumber gaps (deleted/corrected actions)
ans = [int(e["actionNumber"]) for e in p]
print("actionNumber range", ans[0], ans[-1], "present", len(ans), "missing (edited/deleted)", ans[-1] - ans[0] + 1 - len(ans))
# is clock ever increasing within a period (order anomaly)?
bad = [(a["period"], a["clock"], a["actionType"], b["clock"], b["actionType"]) for a, b in zip(p, p[1:]) if a["period"] == b["period"] and cms(b) > cms(a)]
print("clock goes UP between consecutive actions:", len(bad), bad[:10])
# running segments: time between dead-ball stoppages (sub/timeout/ft/foul/period) in game seconds
stops = [e for e in p if e["actionType"] in ("substitution", "timeout", "freethrow", "foul", "period", "jumpball")]
segs = []
prev = None
for e in p:
    if e["actionType"] in ("foul", "timeout", "period") or (e["actionType"] == "turnover" and e["subType"] in ("outofbounds", "travel", "badpass", "ballhandling")):
        if prev is not None and prev["period"] == e["period"]:
            segs.append((cms(prev) - cms(e)) / 1000)
        prev = e
print("approx running-segment lengths between whistles (s): n", len(segs), "median", statistics.median(segs), "min", min(segs), "max", max(segs))
print("top-level clock", d["clock"], "period", d["period"])
