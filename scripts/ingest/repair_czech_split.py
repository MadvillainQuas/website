"""repair_czech_split.py - the Czech NBL games that were filed twice (18-25 Sep 2026).

WHAT HAPPENED. Since 18 Sep the Czech schedule has been keyed on nbl.basketball's own fixture id
(adapters/fiba_site_schedule.py _czech), but fetch() handed back a bundle keyed on the LiveStats
id it translated to. So every game the lane or discovery fetched was written under a SECOND
external_games row, which created a second game; the fixture row it came from never became final,
and every catch-up pass (every 2 h on the PC) and every discovery pass re-fetched and rewrote each
finished game in full - the 11 games in every catch-up line of live_lane.log. fetch() now keeps
the fixture's id; this script mends the rows written before that.

    python repair_czech_split.py --worker-config            # dry run: what would change
    python repair_czech_split.py --worker-config --apply    # step 1: the fixture rows follow the real game
    python repair_czech_split.py --worker-config --apply --placeholders
                                                            # step 2: the empty fixture games go

STEP 1 (bookkeeping only, reversible - a backup of every row is written first): the site-id row
points at the game that holds the result and carries its status, payload hash, stored copy and
score, so nothing treats the game as outstanding again. The games themselves are not touched.

STEP 2 (deletes rows - only when asked): each empty placeholder game (scheduled, 0-0, no events,
no box score) is deleted, after its video - if one was attached to the placeholder rather than the
real game, and the real game has none - is moved to the real game. A placeholder that anything
else refers to is left alone and named."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

ADAPTER, CODE = "fiba_site_schedule", "CBFFE"
REFS = ["game_events", "player_game_stats", "team_game_stats", "game_advanced", "game_state", "video_jobs",
        "notifications", "highlight_jobs"]


class DB:
    def __init__(self, url, key):
        self.url = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    def get(self, path, count=False):
        r = requests.get(self.url + path, headers=dict(self.h, Prefer="count=exact") if count else self.h, timeout=60)
        r.raise_for_status()
        return int((r.headers.get("content-range") or "*/0").split("/")[-1]) if count else r.json()

    def patch(self, path, body):
        r = requests.patch(self.url + path, headers=dict(self.h, Prefer="return=representation"), json=body, timeout=60)
        r.raise_for_status()
        return r.json()

    def delete(self, path):
        r = requests.delete(self.url + path, headers=dict(self.h, Prefer="return=representation"), timeout=60)
        r.raise_for_status()
        return r.json()


def _inst(v):
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


def pairs(db, idmap):
    """(site row, LiveStats row) for every game written under both ids."""
    rows = db.get(f"external_games?adapter=eq.{ADAPTER}&competition_code=eq.{CODE}"
                  "&select=external_id,external_status,payload_hash,raw_ref,game_id,tipoff_at,home_name,away_name,"
                  "home_score,away_score,last_fetched_at,ingested_at&limit=5000")
    site = {str(r["external_id"]): r for r in rows if len(str(r["external_id"])) < 7}   # site ids are six digits, LiveStats ids seven
    rev = {str(v): str(k) for k, v in idmap.items()}
    norm = lambda s: " ".join((s or "").split()).lower()  # noqa: E731
    out = []
    for x in rows:
        xid = str(x["external_id"])
        if xid in site or not x.get("payload_hash"):
            continue
        s = site.get(rev.get(xid, ""))
        if s is None:
            c = [r for r in site.values() if norm(r["home_name"]) == norm(x["home_name"]) and norm(r["away_name"]) == norm(x["away_name"])
                 and r["tipoff_at"] and x["tipoff_at"] and abs((_inst(r["tipoff_at"]) - _inst(x["tipoff_at"])).total_seconds()) < 36 * 3600]
            s = c[0] if len(c) == 1 else None
        if s is None:
            print(f"  ? {xid} {x['home_name']} v {x['away_name']}: no single fixture row matches - left alone")
            continue
        out.append((s, x))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--placeholders", action="store_true", help="step 2: delete the empty placeholder games")
    ap.add_argument("--idmap", default=os.path.join(os.path.dirname(__file__), "..", "..", "data", "feed", CODE, "idmap.json"))
    args = ap.parse_args()
    if args.worker_config:
        cfg = json.load(open(os.path.join(os.environ["APPDATA"], "epinoia", "worker.json"), encoding="utf-8"))
        os.environ.setdefault("SUPABASE_URL", cfg["supabase_url"]); os.environ.setdefault("SUPABASE_SERVICE_KEY", cfg["service_key"])
    db = DB(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    try:
        idmap = json.load(open(args.idmap, encoding="utf-8"))
    except OSError:
        idmap = {}
    ps = pairs(db, idmap)
    print(f"{len(ps)} game(s) filed under both ids")
    if args.apply:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(os.environ.get("TEMP") or ".", f"czech_split_backup_{stamp}.json")
        json.dump([{"site": s, "fiba": x} for s, x in ps], open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(f"backup of every row: {path}")
    for s, x in ps:
        placeholder, real = s.get("game_id"), x.get("game_id")
        line = f"  {s['external_id']} -> {x['external_id']}  {s['home_name']} v {s['away_name']}  game {str(placeholder)[:8]} -> {str(real)[:8]}"
        if s.get("external_status") == "final" and s.get("game_id") == real and s.get("payload_hash") == x.get("payload_hash"):
            print(line + "  (already mended)")
        else:
            print(line)
            if args.apply:
                db.patch(f"external_games?adapter=eq.{ADAPTER}&external_id=eq.{s['external_id']}",
                         {"game_id": real, "external_status": x["external_status"], "payload_hash": x["payload_hash"],
                          "raw_ref": x.get("raw_ref"), "home_score": x.get("home_score"), "away_score": x.get("away_score"),
                          "last_fetched_at": x.get("last_fetched_at"), "ingested_at": x.get("ingested_at")})
        if not args.placeholders or not placeholder or placeholder == real:
            continue
        g = db.get(f"games?id=eq.{placeholder}&select=id,status,home_score,away_score")
        if not g:
            continue
        g = g[0]
        refs = {t: n for t in REFS for n in [db.get(f"{t}?game_id=eq.{placeholder}&select=game_id&limit=1", count=True)] if n}
        if g["status"] != "scheduled" or (g.get("home_score") or 0) or (g.get("away_score") or 0) or refs:
            print(f"     placeholder {placeholder[:8]} kept: {g['status']} {g.get('home_score')}-{g.get('away_score')} {refs or ''}")
            continue
        vids = db.get(f"game_videos?game_id=eq.{placeholder}&select=id,url")
        if vids and not db.get(f"game_videos?game_id=eq.{real}&select=id&limit=1"):
            print(f"     its video moves to the real game: {vids[0]['url']}")
            if args.apply:
                db.patch(f"game_videos?game_id=eq.{placeholder}", {"game_id": real})
        elif vids:
            print(f"     placeholder {placeholder[:8]} kept: it has a video and so does the real game")
            continue
        print(f"     placeholder {placeholder[:8]} deleted")
        if args.apply:
            db.delete(f"games?id=eq.{placeholder}&status=eq.scheduled")
    if not args.apply:
        print("dry run - nothing written (--apply to write)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
