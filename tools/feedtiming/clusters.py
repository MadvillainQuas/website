import json, collections, statistics, sys
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
d = json.load(_open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "feed.json")))
p = sorted(d["pbp"], key=lambda e: int(e["actionNumber"]))
print("n", len(p), "periods", sorted({e["period"] for e in p}))

def cms(e):
    m, s, c = e["clock"].split(":")
    return int(m) * 60000 + int(s) * 1000 + int(c) * 10

# tenths check
nz = [e for e in p if not e["clock"].endswith(":00")]
print("clock with non-zero centis:", len(nz), [(e["period"], e["gt"], e["clock"], e["actionType"]) for e in nz[:25]])
gt_frac = [e["gt"] for e in p if "." in e["gt"]]
print("gt with fraction:", len(gt_frac), gt_frac[:10])

# clusters: consecutive actions sharing (period, clock)
clusters = []
for e in p:
    key = (e["period"], e["clock"])
    if clusters and clusters[-1][0] == key:
        clusters[-1][1].append(e)
    else:
        clusters.append((key, [e]))
sizes = [len(c[1]) for c in clusters]
print("clusters", len(clusters), "size dist", sorted(collections.Counter(sizes).items()))
print("median size", statistics.median(sizes), "mean", round(statistics.mean(sizes), 2), "max", max(sizes))
big = sorted(clusters, key=lambda c: -len(c[1]))[:5]
for k, es in big:
    print(k, [f"{e['actionType']}/{e['subType']}" for e in es])

# singletons vs cluster members
single = sum(1 for s in sizes if s == 1)
first_of_cluster = len(clusters)
print("actions that are FIRST at their clock value (clock moved before them):", first_of_cluster, round(first_of_cluster / len(p), 3))
print("actions that share a value with an earlier action:", len(p) - first_of_cluster, round((len(p) - first_of_cluster) / len(p), 3))

# classify members after the first
SAME_INSTANT = {"assist", "block", "steal", "foulon"}
DEADBALL = {"substitution", "timeout", "freethrow", "period", "game", "jumpball"}
cat = collections.Counter()
for k, es in clusters:
    for i, e in enumerate(es):
        at = e["actionType"]
        if i == 0:
            cat["first@" + ("structural" if at in ("period", "game") else "play")] += 1
        elif at in SAME_INSTANT:
            cat["follower:same-instant satellite"] += 1
        elif at in DEADBALL:
            cat["follower:dead-ball"] += 1
        else:
            cat["follower:other(" + at + ")"] += 1
print(cat)

# "dead-ball" clusters: those containing sub/timeout/FT
dead = [c for c in clusters if any(e["actionType"] in ("substitution", "timeout", "freethrow") for e in c[1])]
print("dead-ball clusters", len(dead), "actions in them", sum(len(c[1]) for c in dead), "sizes", sorted(len(c[1]) for c in dead))

# clock gaps between successive distinct values within a period (game seconds)
gaps = []
for (k1, a), (k2, b) in zip(clusters, clusters[1:]):
    if k1[0] == k2[0]:
        gaps.append((cms(a[0]) - cms(b[0])) / 1000)
print("game-clock gap between distinct values: median", statistics.median(gaps), "p90", sorted(gaps)[int(len(gaps) * .9)], "max", max(gaps), "n", len(gaps))

# type breakdown of key events
shots = [e for e in p if e["actionType"] in ("2pt", "3pt")]
def is_first(e):
    for k, es in clusters:
        if es[0] is e:
            return True
    return False
print("shots", len(shots), "shots that are first at their value", sum(is_first(e) for e in shots))
fts = [e for e in p if e["actionType"] == "freethrow"]
print("FTs", len(fts))
# within cluster: does a shot follow a rebound at same clock (putback) etc
for k, es in clusters:
    if len(es) > 1 and any(e["actionType"] in ("2pt", "3pt") for e in es[1:]):
        print("shot as follower:", k, [f"{e['actionType']}/{e['subType']}" for e in es])
