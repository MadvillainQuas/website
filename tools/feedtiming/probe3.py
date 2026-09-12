import requests, time, json, sys
import os, sys
import gzip as _gz
def _open(p):
    return _gz.open(p, "rt", encoding="utf-8") if str(p).endswith(".gz") else open(p, encoding="utf-8")

from email.utils import parsedate_to_datetime
ids = sys.argv[1].split(",")
dur = float(sys.argv[2]); every = float(sys.argv[3])
out = open(sys.argv[4], "w", encoding="utf-8")
VARIANTS = {"gzip": "gzip, deflate", "identity": "identity"}
S = {k: requests.Session() for k in VARIANTS}
etag = {}
end = time.time() + dur
while time.time() < end:
    t_loop = time.time()
    for gid in ids:
        for name, ae in VARIANTS.items():
            t0 = time.time()
            h = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": ae}
            if (gid, name) in etag:
                h["If-None-Match"] = etag[(gid, name)]
            try:
                r = S[name].get(f"https://fibalivestats.dcd.shared.geniussports.com/data/{gid}/data.json", timeout=20, headers=h)
                t1 = time.time()
                lm = r.headers.get("Last-Modified")
                row = dict(gid=gid, v=name, t0=round(t0, 3), recv=round(t1, 3), status=r.status_code, age=r.headers.get("Age"),
                           xc=r.headers.get("X-Cache"), lm=parsedate_to_datetime(lm).timestamp() if lm else None,
                           bytes=len(r.content))
                if r.status_code == 200:
                    etag[(gid, name)] = r.headers.get("ETag")
                    j = r.json()
                    pbp = sorted(j.get("pbp") or [], key=lambda e: -int(e.get("actionNumber") or 0))[:60]
                    row.update(period=j.get("period"), clock=j.get("clock"), n=len(j.get("pbp") or []),
                               top=[[e.get("actionNumber"), e.get("actionType"), e.get("subType"), e.get("clock"), e.get("period"), e.get("periodType")] for e in pbp])
            except Exception as exc:
                row = dict(gid=gid, v=name, t0=t0, err=str(exc))
            out.write(json.dumps(row) + "\n"); out.flush()
    time.sleep(max(0, every - (time.time() - t_loop)))
