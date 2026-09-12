"""Lag-envelope estimator on probe data.

lag(e) = wall time - elapsed game time, non-decreasing through a game.
UPPER points (hard): a version written at W whose top clock reads E  -> lag(E-1) <= W+2-E
                     an action first present in a version written at W -> lag(e-1) <= W+2-e
LOWER points:        an action absent from the previous version (written at W') and not a backfill
                     -> lag(e+1) >= W' - G - e - 1   (G = generation-to-write latency allowance)
interval(a) = [e + max lower at x<=e - K,  e + min upper at x>=e]
"""
import json, sys, collections, statistics
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "probe3.jsonl.gz")
G = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
K = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
VERBOSE = len(sys.argv) > 4
rows = [json.loads(l) for l in _open(path)]
USE_304 = "--no304" not in sys.argv
cur = {}; lmlast = {}
for r in sorted(rows, key=lambda r: r.get("recv") or 0):
    if not r.get("lm"): continue
    kv = (r["gid"], r["v"])
    if r.get("status") == 200 and r.get("top") is not None:
        cur[kv] = r
        r["lm_last"] = r["lm"]
    elif r.get("status") == 304 and kv in cur and USE_304:
        c = cur[kv]; c["lm_last"] = max(c["lm_last"], r["lm"])
rows = [r for r in rows if r.get("status") == 200 and r.get("lm") and r.get("top") is not None]

def plen(p): return 600.0 if p <= 4 else 300.0
def pnum(p, ptype):
    p = int(p or 1)
    return 4 + p if str(ptype or "").upper() == "OVERTIME" and p <= 4 else p
def cs(c):
    parts = str(c).split(":")
    s = int(parts[0]) * 60 + int(parts[1])
    if len(parts) > 2: s += int(parts[2]) / 100.0
    return s
def elapsed(p, c):
    return sum(plen(q) for q in range(1, p)) + plen(p) - cs(c)

DEAD = {"substitution", "timeout", "freethrow", "foul", "foulon", "period", "game", "jumpball"}
by = collections.defaultdict(list)
for r in rows: by[r["gid"]].append(r)

def q(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))]

widths = collections.defaultdict(list); base = collections.defaultdict(list); shift = collections.defaultdict(list); big = []; contra = []; declined = 0; tot = 0; hi_minus_first = []
for gid, rs in by.items():
    vers = {}
    for r in sorted(rs, key=lambda r: r["recv"]):
        k = (r["lm"], r["clock"], r["n"], tuple(a[0] for a in r["top"][:5]))
        if k in vers: vers[k]["lm_last"] = max(vers[k]["lm_last"], r["lm_last"])
        else: vers[k] = r
    V = sorted(vers.values(), key=lambda r: (r["lm"], r["n"]))
    # top-level period: data.json 'period' + (no periodType in probe rows -> assume REGULAR unless > 4)
    act = {}; first = {}; maxE = []
    for i, r in enumerate(V):
        mx = elapsed(int(r["period"]), r["clock"])
        for a in r["top"]:
            an, at, st, c, p, pt = (a + [None])[:6]
            if p is None or c is None: continue
            e = elapsed(pnum(p, pt), c)
            if at == "period" and st == "start": e = elapsed(pnum(p, pt), "%02d:00" % int(plen(pnum(p, pt)) // 60))
            act.setdefault(an, (at, st, c, pnum(p, pt), e))
            first.setdefault(an, i)
            mx = max(mx, e)
        maxE.append(mx)
    ups, los = [], []
    for i, r in enumerate(V):
        E = elapsed(int(r["period"]), r["clock"])
        mxan = max([a[0] for a in r["top"]] or [0])
        ups.append(((E, mxan + 0.5), r["lm"] + 2 - E))
    for an, i in first.items():
        at, st, c, p, e = act[an]
        ups.append(((e, an), V[i]["lm"] + 2 - e))
        if i > 0 and e >= maxE[i - 1] - 1:            # not a backfill
            los.append(((e, an), V[i - 1]["lm_last"] - G - e - 1))
    for an, i in sorted(first.items()):
        if i == 0: continue
        at, st, c, p, e = act[an]
        lo_l = max([y for x, y in los if x <= (e, an)] or [None], key=lambda v: -1e18 if v is None else v)
        hi_l = min([y for x, y in ups if x >= (e, an)] or [None], key=lambda v: 1e18 if v is None else v)
        tot += 1
        if lo_l is None or hi_l is None:
            declined += 1; continue
        lo = e + lo_l - K; hi = e + hi_l
        if lo > hi:
            contra.append((gid, an, at, st, p, c, round(lo - hi, 1))); continue
        cls = "shot" if at in ("2pt", "3pt") else ("dead" if at in DEAD else "live-other")
        widths[cls].append(hi - lo)
        base[cls].append(V[i]["lm"] + 1 - (V[i-1]["lm_last"] - G) + K)
        shift[cls].append(hi - V[i]["lm"])
        if hi - lo > 40: big.append((gid, an, at, st, p, c, round(hi-lo,1), "LMgap", V[i]["lm"]-V[i-1]["lm_last"], "backfill" if e < maxE[i-1]-1 else ""))
        hi_minus_first.append(hi - V[i]["lm"])
        if VERBOSE:
            print(f"{gid} #{an:<4} {at:12} {str(st):14} P{p} {c:9} width {hi - lo:6.1f}  hi-LM(first) {hi - V[i]['lm']:6.1f}")
print(f"G={G} K={K}")
for cls, ws in sorted(widths.items()):
    print(f"  {cls:10} n {len(ws):3}  width median {statistics.median(ws):5.1f}  p25 {q(ws,.25):5.1f}  p75 {q(ws,.75):5.1f}  p90 {q(ws,.9):5.1f}  max {max(ws):5.1f}")
for cls in sorted(widths):
    print(f"  {cls:10} membership-only width median {statistics.median(base[cls]):5.1f} | hi - LM(first) median {statistics.median(shift[cls]):6.1f} p25 {q(shift[cls],.25):6.1f}")
for b in big: print("   wide:", b)
print("  stamp moved earlier than first-containing LM (hi - LM): median", round(statistics.median(hi_minus_first), 1) if hi_minus_first else None)
print("  contradictions", len(contra), "declined", declined, "of", tot)
for c in contra[:15]: print("   ", c)
