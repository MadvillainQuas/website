"""Width of the honest interval per action, per build step, replayed over probe3.jsonl.
Truth is unknown; every stamp is an upper bound 'hi' and a lower bound 'lo'; width = hi - lo.
Step1: serial loop, one key (gzip), a poll every GAP s; hi = LM of served copy, lo = LM of previous served copy.
Step2: observer, gzip only, every POLL s; hi = LM first containing, lo = LM of previous version (200).
Step2b: same, lo = latest LM seen on a 304 of the previous content (lm_last).
Step3: + in-version clock pull (hi -= d_i).
Also: recv - LM on first sighting."""
import json, sys, statistics as st, collections
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
rows = [json.loads(l) for l in _open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "probe3.jsonl.gz"))]
rows = [r for r in rows if r.get("lm") and "err" not in r]
rows.sort(key=lambda r: r["recv"])

def plen(p): return 600.0 if p <= 4 else 300.0
def pn(p, pt): p = int(p or 1); return 4 + p if str(pt).upper() == "OVERTIME" and p <= 4 else p
def cl(s):
    parts = str(s).split(":"); m = int(parts[0]); sec = int(parts[1]); cc = int(parts[2]) if len(parts) > 2 else 0
    return m * 60 + sec + cc / 100.0
def el(a):
    p = pn(a[4], a[5]); base = sum(plen(q) for q in range(1, p))
    if a[1] == "period" and a[2] == "start": return base
    return base + plen(p) - cl(a[3])
FGA = {"2pt", "3pt"}; LIVE = {"rebound", "turnover", "steal", "block", "assist", "foul", "foulon", "jumpball"}
DEAD = {"substitution", "timeout", "freethrow", "period", "game"}
def grp(t): return "FGA" if t in FGA else ("live" if t in LIVE else ("dead" if t in DEAD else "other"))

def pct(xs, q):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))] if xs else None
def summ(name, d):
    for g in ("FGA", "live", "dead"):
        xs = d.get(g, [])
        if xs: print(f"  {name:28s} {g:5s} n={len(xs):3d} median {st.median(xs):5.1f}  p25 {pct(xs,.25):5.1f}  p75 {pct(xs,.75):5.1f}  p90 {pct(xs,.9):5.1f}  max {max(xs):5.1f}")

def replay(variant, poll_every, use_304=False, pull=False, maxgap=None):
    out = collections.defaultdict(list); recvlag = []
    games = sorted({r["gid"] for r in rows})
    for gid in games:
        rs = [r for r in rows if r["gid"] == gid and r["v"] == variant]
        last_take = -1e18; prev_lm = None; lm_last = None; known = None; maxel_prev = -1e9
        for r in rs:
            if r["recv"] - last_take < poll_every - 1.5: continue   # subsample to the chosen cadence
            last_take = r["recv"]
            if r["status"] == 304:
                if use_304 and lm_last is not None and r["lm"] > lm_last: lm_last = r["lm"]
                continue
            if r["status"] != 200 or r.get("top") is None: continue
            # a 200 at a slower cadence may still be the same content as last time
            ans = {a[0]: a for a in r["top"]}
            if known is None:
                known = set(ans); prev_lm = r["lm"]; lm_last = r["lm"]
                maxel_prev = max(el(a) for a in r["top"]); continue
            if r["lm"] <= prev_lm:
                continue
            new = [a for a in r["top"] if a[0] not in known]
            if not new:
                if use_push := use_304: lm_last = max(lm_last, r["lm"])
                continue
            recvlag.append(r["recv"] - r["lm"])
            lo = lm_last if use_304 else prev_lm
            els = {a[0]: el(a) for a in r["top"]}
            for a in new:
                e = els[a[0]]
                if pull and e < maxel_prev - 3: continue       # late entry: declined
                E = max(v for k, v in els.items() if k >= a[0])
                d = (E - e) if pull else 0.0
                hi = r["lm"] - d
                w = max(hi - lo, 2.0) if pull else hi - lo
                if maxgap and w > maxgap: continue
                out[grp(a[1])].append(w)
            known |= set(ans); maxel_prev = max(maxel_prev, max(els.values()))
            prev_lm = r["lm"]; lm_last = r["lm"]
    return out, recvlag

print("probe3 replay, width of honest interval [lo, hi] in seconds")
for gap in (38, 60):
    o, lag = replay("gzip", gap); summ(f"step1 LM stamp, poll {gap}s", o)
o, lag = replay("gzip", 5); summ("step2 observer 5s gzip", o)
print(f"  recv-LM on first sighting, gzip @5s: median {st.median(lag):.1f} p90 {pct(lag,.9):.1f} n={len(lag)}")
o, _ = replay("gzip", 5, use_304=True); summ("step2 + 304 lm_last", o)
o, _ = replay("gzip", 5, pull=True); summ("step3 + in-version pull", o)
o, _ = replay("gzip", 5, use_304=True, pull=True); summ("step3 + pull + 304 lm_last", o)
