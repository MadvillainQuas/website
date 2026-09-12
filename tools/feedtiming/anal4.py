import json, sys, collections, statistics
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
rows = [json.loads(l) for l in _open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "probe3.jsonl.gz"))]
def plen(p): return 600.0 if p <= 4 else 300.0
def cs(c):
    parts = str(c).split(":"); s = int(parts[0]) * 60 + int(parts[1])
    if len(parts) > 2: s += int(parts[2]) / 100.0
    return s
def elapsed(p, c): return sum(plen(q) for q in range(1, p)) + plen(p) - cs(c)
by = collections.defaultdict(list)
for r in rows:
    if r.get("lm"): by[r["gid"]].append(r)
print("=== versions per cache key, and discovery latency ===")
for gid, rs in by.items():
    first = collections.defaultdict(dict)
    for r in sorted(rs, key=lambda r: r["recv"]):
        first[r["v"]].setdefault(r["lm"], r["recv"])
    g, i = first["gzip"], first["identity"]
    merged = {}
    for d in (g, i):
        for k, t in d.items(): merged[k] = min(t, merged.get(k, 1e18))
    lms = sorted(merged)
    gaps = [b - a for a, b in zip(lms, lms[1:])]
    print(gid, "gzip", len(g), "identity", len(i), "union", len(merged), "only-gzip", len(set(g) - set(i)), "only-identity", len(set(i) - set(g)),
          "| LM gaps median", statistics.median(gaps) if gaps else None, "min", min(gaps) if gaps else None, "max", max(gaps) if gaps else None,
          "| recv-LM gzip median", round(statistics.median([t - k for k, t in g.items()]), 1),
          "union median", round(statistics.median([t - k for k, t in merged.items()]), 1))
print("\n=== top clock vs newest action clock in each version ===")
ahead = []; behind = []
for gid, rs in by.items():
    seen = set()
    for r in rs:
        if r.get("status") != 200 or not r.get("top"): continue
        k = (r["lm"], r["n"])
        if k in seen: continue
        seen.add(k)
        E = elapsed(int(r["period"]), r["clock"])
        acts = [a for a in r["top"] if a[3] and a[4] and not (a[1] == "period" and a[2] == "start")]
        pe = []
        for a in acts[:8]:
            p = int(a[4]); p = 4 + p if str(a[5] or "").upper() == "OVERTIME" and p <= 4 else p
            pe.append(elapsed(p, a[3]))
        if not pe: continue
        d = E - max(pe)
        (ahead if d >= 0 else behind).append(round(d, 1))
print("top clock ahead of/equal to newest action (s):", sorted(ahead))
print("top clock BEHIND the newest action (s):", sorted(behind))
