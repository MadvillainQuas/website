import json, collections, statistics
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

rows=[json.loads(l) for l in _open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures", "feedtiming", "probe3.jsonl.gz"))]
rows.sort(key=lambda r:r.get("recv") or 0)
cur={}; new_lm_304=0; n304=0
for r in rows:
    k=(r["gid"],r["v"])
    if r.get("status")==200 and r.get("lm"): cur[k]=r["lm"]
    elif r.get("status")==304:
        n304+=1
        if k in cur and r.get("lm") and r["lm"]>cur[k]:
            new_lm_304+=1; cur[k]=r["lm"]
print("304s",n304,"with advanced LM",new_lm_304)
# D2 bias estimate: for versions, k_sample = LM + clock_top. Compare against D1-style upper bound of newest action: nothing to compare truth.
# Instead: how often does the top clock equal the newest action clock while a LATER version shows the clock ran (i.e. clock was running at upload)?
def cs(c):
    p=str(c).split(":"); s=int(p[0])*60+int(p[1]); 
    if len(p)>2: s+=int(p[2])/100
    return s
by=collections.defaultdict(dict)
for r in rows:
    if r.get("status")==200 and r.get("top") is not None and r.get("lm"):
        by[r["gid"]].setdefault((r["lm"],r["n"]),r)
biases=[]
for gid,d in by.items():
    V=sorted(d.values(),key=lambda r:r["lm"])
    for a,b in zip(V,V[1:]):
        if a["period"]!=b["period"]: continue
        dc=cs(a["clock"])-cs(b["clock"]); dt=b["lm"]-a["lm"]
        biases.append(round(dc-dt,1))
print("same-period version pairs:",len(biases))
print("clock fall minus LM advance (s), sorted:",sorted(biases))
