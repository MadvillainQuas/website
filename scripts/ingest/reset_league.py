"""reset_league.py - start a league again from its feed, keeping everything about the league and its clubs.

    python scripts/ingest/reset_league.py --league cibacopa --worker-config             # dry run: what would go
    python scripts/ingest/reset_league.py --league cibacopa --worker-config --apply     # do it
    python scripts/ingest/run_ingest.py --worker-config --source CIBA --refresh         # then read it all again

(or from GitHub: Actions -> League ingest -> Run workflow, with reset_league = the slug and reset_confirm = the slug
again; the ingest step then re-reads the league's sources with --refresh.)

WHAT GOES
  every game of the league's competitions - and with them (ON DELETE CASCADE) their events, box scores, team stats,
  lineups, game state and advanced stats; the ingest's bookkeeping for the league's source codes (external_games),
  so every game is fetched fresh; the league's standings, season snapshots and feed_team_season rows, rebuilt by the
  first finalise; the roster entries of the league's clubs; and every PLAYER who is on no roster outside this league
  (a player also on another league's roster keeps his profile and loses only this league's rows).

WHAT STAYS
  the league, its seasons and competitions, competition_teams, the clubs (names, codes, crests, colours, home arena),
  every venue row with its map pin, the LiveStats id maps in data/feed/<CODE>/idmap.json, and the ingest config.
  A new game names its arena by the same text, so it lands on the same venue row and pin.

A BACKUP FIRST. Before anything is deleted, every player row (names, aliases, photo, feed ids), roster entry and game
row that will go is written to data/reset/<slug>-<UTC time>.json, so a photo or a hand-made edit can be restored.

POLITE TO THE DATABASE. Deletes go in small batches (--batch, default 20 games / 100 rows) with a pause between them
(--pause, default 1.5 s). A batch that runs into the statement timeout (57014) or a 5xx is halved and retried after a
back-off, down to one row at a time, so a league with a heavy event log is taken apart gently rather than in one
statement that ties the database up. Reads are paged. Nothing runs in parallel.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


class DB:
    def __init__(self, url: str, key: str, pause: float):
        self.url = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}
        self.s = requests.Session()
        self.pause = pause

    def get(self, path: str) -> list:
        for attempt in range(5):
            r = self.s.get(self.url + path, headers=self.h, timeout=90)
            if r.status_code < 500 and "57014" not in r.text:
                r.raise_for_status()
                return r.json()
            time.sleep(self.pause * (2 ** attempt))
        r.raise_for_status()
        return []

    def all(self, table: str, query: str, page: int = 500) -> list:
        rows, start = [], 0
        while True:
            got = self.get(f"{table}?{query}&limit={page}&offset={start}")
            rows += got
            if len(got) < page:
                return rows
            start += page
            time.sleep(self.pause / 3)

    def _delete(self, table: str, query: str) -> tuple[bool, str]:
        r = self.s.delete(self.url + f"{table}?{query}", headers=dict(self.h, Prefer="return=minimal"), timeout=120)
        if r.status_code < 300:
            return True, ""
        return False, f"{r.status_code} {r.text[:200]}"

    def delete_in(self, table: str, column: str, values: list, batch: int, label: str) -> int:
        """Delete rows whose `column` is in `values`, `batch` at a time, halving a batch the database cannot finish."""
        done, i, size = 0, 0, max(1, batch)
        while i < len(values):
            chunk = values[i:i + size]
            ok, why = self._delete(table, f"{column}=in.({','.join(chunk)})")
            if ok:
                done += len(chunk)
                i += len(chunk)
                print(f"     {label}: {done}/{len(values)}", end="\r", flush=True)
                time.sleep(self.pause)
                size = min(batch, size * 2) if size < batch else size
                continue
            heavy = "57014" in why or why.startswith("5")
            if heavy and size > 1:
                size = max(1, size // 2)
                print(f"\n     {label}: the database needs smaller steps ({why[:60]}) - {size} at a time")
                time.sleep(self.pause * 4)
                continue
            raise RuntimeError(f"{label}: {why}")
        print(f"     {label}: {done}/{len(values)}")
        return done

    def delete_where(self, table: str, query: str, label: str) -> None:
        ok, why = self._delete(table, query)
        if not ok:
            raise RuntimeError(f"{label}: {why}")
        print(f"     {label}: cleared")
        time.sleep(self.pause)


def source_codes(slug: str) -> list:
    with open(os.path.join(ROOT, "config", "ingest-sources.json"), encoding="utf-8") as f:
        srcs = json.load(f)["sources"]
    return sorted({s["code"] for s in srcs if s.get("league_slug") == slug})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", required=True, help="the league's slug (leagues.slug)")
    ap.add_argument("--codes", help="source codes whose external_games go (default: every config source with this league_slug)")
    ap.add_argument("--apply", action="store_true", help="delete; without it nothing is written")
    ap.add_argument("--batch", type=int, default=20, help="games per delete (rows: 5x this)")
    ap.add_argument("--pause", type=float, default=1.5, help="seconds between deletes")
    ap.add_argument("--worker-config", action="store_true", help=r"SUPABASE_URL / SUPABASE_SERVICE_KEY from %%APPDATA%%\epinoia\worker.json")
    args = ap.parse_args()

    if args.worker_config:
        cfg = json.load(open(os.path.join(os.environ["APPDATA"], "epinoia", "worker.json")))
        os.environ.setdefault("SUPABASE_URL", cfg["supabase_url"])
        os.environ.setdefault("SUPABASE_SERVICE_KEY", cfg["service_key"])
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("needs SUPABASE_URL and SUPABASE_SERVICE_KEY (or --worker-config)")
        return 2
    db = DB(url, key, args.pause)

    lg = db.get(f"leagues?slug=eq.{args.league}&select=id,name")
    if not lg:
        print(f"no league with slug {args.league!r}")
        return 2
    lid, lname = lg[0]["id"], lg[0]["name"]
    codes = [c.strip() for c in (args.codes or "").split(",") if c.strip()] or source_codes(args.league)
    seasons = [s["id"] for s in db.all("seasons", f"league_id=eq.{lid}&select=id")]
    comps = [c["id"] for c in db.all("competitions", f"season_id=in.({','.join(seasons)})&select=id")] if seasons else []
    teams = db.all("teams", f"league_id=eq.{lid}&select=id,name")
    tids = [t["id"] for t in teams]

    games = db.all("games", f"competition_id=in.({','.join(comps)})&select=*&order=id") if comps else []
    roster = db.all("roster_entries", f"team_id=in.({','.join(tids)})&select=*&order=id") if tids else []
    pids = sorted({r["player_id"] for r in roster})
    elsewhere: set = set()
    for i in range(0, len(pids), 100):
        chunk = pids[i:i + 100]
        for r in db.all("roster_entries", f"player_id=in.({','.join(chunk)})&team_id=not.in.({','.join(tids)})&select=player_id"):
            elsewhere.add(r["player_id"])
    doomed = [p for p in pids if p not in elsewhere]
    players = []
    for i in range(0, len(doomed), 100):
        players += db.all("players", f"id=in.({','.join(doomed[i:i + 100])})&select=*")
    ext = db.all("external_games", f"competition_code=in.({','.join(codes)})&select=id") if codes else []

    print(f"{lname} ({args.league}): {len(seasons)} season(s), {len(comps)} competition(s), {len(teams)} club(s) - KEPT")
    print(f"  games to delete            {len(games)}  (events, box scores, lineups and game state go with them)")
    print(f"  ingest rows to delete      {len(ext)}  (external_games for {', '.join(codes) or 'no source code'})")
    print(f"  roster entries to delete   {len(roster)}")
    print(f"  players to delete          {len(players)}  ({len(elsewhere)} also on another league's roster: kept)")
    if not args.apply:
        print("dry run - nothing written. Add --apply to do it.")
        return 0

    os.makedirs(os.path.join(ROOT, "data", "reset"), exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = os.path.join(ROOT, "data", "reset", f"{args.league}-{stamp}.json")
    with open(backup, "w", encoding="utf-8") as f:
        json.dump({"league": lg[0], "codes": codes, "games": games, "roster_entries": roster, "players": players}, f, ensure_ascii=False)
    print(f"  backup written: {os.path.relpath(backup, ROOT)}")

    gids = [g["id"] for g in games]
    # the event log is the heavy part of a game: taken apart first, a few games at a time, so the games' own
    # cascade has little left to do
    db.delete_in("game_events", "game_id", gids, max(1, args.batch // 4), "game events")
    db.delete_in("games", "id", gids, args.batch, "games")
    db.delete_in("external_games", "id", [e["id"] for e in ext], args.batch * 5, "ingest rows")
    if comps:
        cl = ",".join(comps)
        db.delete_where("standings", f"competition_id=in.({cl})", "standings")
        db.delete_where("snapshots", f"competition_id=in.({cl})", "season snapshots")
        db.delete_where("feed_team_season", f"competition_id=in.({cl})", "feed season rollup")
    db.delete_in("roster_entries", "id", [r["id"] for r in roster], args.batch * 5, "roster entries")
    db.delete_in("players", "id", [p["id"] for p in players], args.batch * 5, "players")
    print(f"done. Now read the league again:  python scripts/ingest/run_ingest.py --source {','.join(codes)} --refresh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
