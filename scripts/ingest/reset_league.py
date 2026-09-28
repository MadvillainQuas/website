"""reset_league.py - start a league again from its feed, keeping everything about the league and its clubs.

    python scripts/ingest/reset_league.py --league cibacopa --worker-config             # dry run: what would go
    python scripts/ingest/reset_league.py --league cibacopa --worker-config --apply     # do it
    python scripts/ingest/run_ingest.py --worker-config --source CIBA --refresh         # then read it all again
    python scripts/ingest/reset_league.py --claim                                       # the console's queue (0187)

FROM THE PLATFORM CONSOLE (the usual way): Platform administration -> Rebuild derived data -> "Start a league again".
The request goes to league_resets (0187); .github/workflows/console-jobs.yml looks every 10 minutes, runs --claim,
and the console shows each step as it happens, then done (with the counts) or failed (with the reason).

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

    def delete_in(self, table: str, column: str, values: list, batch: int, label: str, on_step=None) -> int:
        """Delete rows whose `column` is in `values`, `batch` at a time, halving a batch the database cannot finish."""
        done, i, size = 0, 0, max(1, batch)
        ceiling = size                      # once the database has said a size is too much, it is never asked again
        while i < len(values):
            chunk = values[i:i + size]
            ok, why = self._delete(table, f"{column}=in.({','.join(chunk)})")
            if ok:
                done += len(chunk)
                i += len(chunk)
                print(f"     {label}: {done}/{len(values)}", end="\r", flush=True)
                if on_step:
                    on_step(done, len(values))
                time.sleep(self.pause)
                size = min(ceiling, size * 2)
                continue
            heavy = "57014" in why or why.startswith("5")
            if heavy and size > 1:
                size = max(1, size // 2)
                ceiling = size
                print(f"\n     {label}: the database needs smaller steps ({why[:60]}) - {size} at a time")
                time.sleep(self.pause * 4)
                continue
            raise RuntimeError(f"{label}: {why}")
        print(f"     {label}: {done}/{len(values)}")
        return done

    def rpc(self, fn: str, body: dict):
        r = self.s.post(self.url + "rpc/" + fn, headers=self.h, json=body, timeout=60)
        r.raise_for_status()
        return r.json() if r.text else None

    def delete_where(self, table: str, query: str, label: str) -> None:
        ok, why = self._delete(table, query)
        if not ok:
            raise RuntimeError(f"{label}: {why}")
        print(f"     {label}: cleared")
        time.sleep(self.pause)


class Progress:
    """How far along a reset is, as the console's bar draws it: each phase owns a share of 0-100, and a phase
    reports how much of itself is done. Written to league_resets.detail (0187) at most every few seconds and on
    every change of phase, so the bar is the same whoever opens the console and whenever."""
    PHASES = [("read", "Reading the league", 3), ("backup", "Backing up", 2), ("events", "Deleting the play-by-play", 25),
              ("games", "Deleting the games", 8), ("ingest", "Clearing the ingest's records", 2),
              ("people", "Deleting rosters and players", 5), ("reread", "Reading the league again from its feed", 55)]

    def __init__(self, send=None, every: float = 4.0):
        self.send, self.every, self.last, self.phase = send, every, 0.0, None
        self.start = {}
        acc = 0
        for key, _, w in self.PHASES:
            self.start[key] = acc
            acc += w
        self.weight = {k: w for k, _, w in self.PHASES}
        self.label = {k: l for k, l, _ in self.PHASES}

    def tick(self, phase: str, done: int = 0, total: int = 0, note: str = "") -> None:
        frac = (min(done, total) / total) if total else 0.0
        pct = round(self.start[phase] + self.weight[phase] * frac, 1)
        changed = phase != self.phase
        self.phase = phase
        if not self.send or (not changed and time.time() - self.last < self.every):
            return
        self.last = time.time()
        step = self.label[phase] + (f" - {done} of {total}" if total else "") + (f" ({note})" if note else "")
        self.send(step, {"pct": pct, "phase": phase, "done": done, "total": total})

    def finished(self) -> None:
        if self.send:
            self.send("finished", {"pct": 100, "phase": "done", "done": 0, "total": 0})


def source_codes(slug: str) -> list:
    with open(os.path.join(ROOT, "config", "ingest-sources.json"), encoding="utf-8") as f:
        srcs = json.load(f)["sources"]
    return sorted({s["code"] for s in srcs if s.get("league_slug") == slug})


def reset(db: DB, slug: str, codes: list, apply: bool, batch: int, pg: Progress | None = None) -> dict:
    """Take one league apart (see the module docstring). Returns the counts; with apply=False, only counts."""
    lg = db.get(f"leagues?slug=eq.{slug}&select=id,name")
    if not lg:
        raise RuntimeError(f"no league with slug {slug!r}")
    lid, lname = lg[0]["id"], lg[0]["name"]
    pg = pg or Progress()
    pg.tick("read")
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
    counts = {"games": len(games), "ingest_rows": len(ext), "roster_entries": len(roster), "players": len(players),
              "players_kept": len(elsewhere), "clubs": len(teams), "competitions": len(comps)}

    print(f"{lname} ({slug}): {len(seasons)} season(s), {len(comps)} competition(s), {len(teams)} club(s) - KEPT")
    print(f"  games to delete            {len(games)}  (events, box scores, lineups and game state go with them)")
    print(f"  ingest rows to delete      {len(ext)}  (external_games for {', '.join(codes) or 'no source code'})")
    print(f"  roster entries to delete   {len(roster)}")
    print(f"  players to delete          {len(players)}  ({len(elsewhere)} also on another league's roster: kept)")
    if not apply:
        print("dry run - nothing written. Add --apply to do it.")
        return counts

    os.makedirs(os.path.join(ROOT, "data", "reset"), exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = os.path.join(ROOT, "data", "reset", f"{slug}-{stamp}.json")
    with open(backup, "w", encoding="utf-8") as f:
        json.dump({"league": lg[0], "codes": codes, "games": games, "roster_entries": roster, "players": players}, f, ensure_ascii=False)
    print(f"  backup written: {os.path.relpath(backup, ROOT)}")
    pg.tick("backup", 1, 1)

    gids = [g["id"] for g in games]
    # the event log is the heavy part of a game: taken apart first, a few games at a time, so the games' own
    # cascade has little left to do
    pg.tick("events", 0, len(gids))
    db.delete_in("game_events", "game_id", gids, max(1, batch // 4), "game events", lambda d, t: pg.tick("events", d, t))
    pg.tick("games", 0, len(gids))
    db.delete_in("games", "id", gids, batch, "games", lambda d, t: pg.tick("games", d, t))
    pg.tick("ingest", 0, len(ext))
    db.delete_in("external_games", "id", [e["id"] for e in ext], batch * 5, "ingest rows", lambda d, t: pg.tick("ingest", d, t))
    if comps:
        cl = ",".join(comps)
        db.delete_where("standings", f"competition_id=in.({cl})", "standings")
        db.delete_where("snapshots", f"competition_id=in.({cl})", "season snapshots")
        db.delete_where("feed_team_season", f"competition_id=in.({cl})", "feed season rollup")
    people = len(roster) + len(players)
    pg.tick("people", 0, people)
    db.delete_in("roster_entries", "id", [r["id"] for r in roster], batch * 5, "roster entries", lambda d, t: pg.tick("people", d, people))
    db.delete_in("players", "id", [p["id"] for p in players], batch * 5, "players", lambda d, t: pg.tick("people", len(roster) + d, people))
    return counts


def reread(codes: list, pg: Progress) -> tuple[bool, str]:
    """The league's sources, read again from the feed (--refresh). The ingest's own log is read as it runs: each
    source says how many games it will fetch ("N on schedule, M to (re)fetch") and prints a line per game written
    ("    + ..."), which is what moves the bar. A source's closing "done in" line settles its count."""
    import re
    import subprocess
    import threading
    cmd = [sys.executable, "-u", os.path.join(HERE, "run_ingest.py"), "--config", "--source", ",".join(codes), "--refresh",
           "--max-games", "2000", "--feed-out", ""]
    state = {"total": 0, "done": 0, "base": 0, "src_todo": 0}
    tail: list = []
    pg.tick("reread", 0, 0, "finding the games")
    stop = threading.Event()

    def beat():                             # the lease stays alive through a long quiet stretch (a slow source)
        while not stop.wait(240):
            pg.last = 0
            pg.tick("reread", state["done"], max(state["total"], 1))
    threading.Thread(target=beat, daemon=True).start()
    p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    try:
        for ln in p.stdout:
            print(ln, end="")
            tail.append(ln)
            del tail[:-60]
            m = re.search(r"(\d+) on schedule, (\d+) to \(re\)fetch", ln)
            if m:
                state["base"] = state["done"]
                state["src_todo"] = int(m.group(2))
                state["total"] += int(m.group(2))
            elif ln.startswith("    + "):
                state["done"] = min(state["done"] + 1, state["base"] + state["src_todo"])
            elif re.match(r"\s+done in ", ln):
                state["done"] = state["base"] + state["src_todo"]
            if state["total"]:
                pg.tick("reread", state["done"], state["total"])
        p.wait()
    finally:
        stop.set()
    return p.returncode == 0, "".join(tail)[-400:]


def claim(db: DB, batch: int) -> int:
    """The console's queue (0187): take the oldest request, reset, re-read, report. Nothing queued = nothing done."""
    job = db.rpc("claim_league_reset", {"p_worker": os.environ.get("GITHUB_RUN_ID") or os.uname().nodename})
    if not job or not job.get("id"):
        print("no league reset queued")
        return 0
    jid = job["id"]

    def send(step, detail=None):
        try:
            db.rpc("progress_league_reset", {"p_id": jid, "p_step": step, "p_detail": detail or {}})
        except Exception as exc:
            print(f"   (progress not recorded: {exc})")
    pg = Progress(send)
    lg = db.get(f"leagues?id=eq.{job['league_id']}&select=slug,name")
    slug = lg[0]["slug"] if lg else None
    codes = source_codes(slug) if slug else []
    try:
        if not codes:
            raise RuntimeError(f"no source in config/ingest-sources.json reads {slug!r}: a reset could not be read back, so nothing was deleted")
        counts = reset(db, slug, codes, True, batch, pg)
        ok, tail = reread(codes, pg)
        if not ok:
            raise RuntimeError("the league was cleared but reading it again failed: " + tail)
        pg.finished()
        db.rpc("finish_league_reset", {"p_id": jid, "p_state": "done", "p_detail": {"counts": counts, "codes": codes}})
        print(f"reset of {slug} done")
        return 0
    except Exception as exc:
        db.rpc("finish_league_reset", {"p_id": jid, "p_state": "failed", "p_detail": {"codes": codes}, "p_error": str(exc)[:500]})
        print(f"reset of {slug} failed: {exc}")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", help="the league's slug (leagues.slug)")
    ap.add_argument("--claim", action="store_true", help="take the oldest reset queued from the platform console, and run it")
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
    if args.claim:
        return claim(db, args.batch)
    if not args.league:
        print("--league SLUG, or --claim")
        return 2
    codes = [c.strip() for c in (args.codes or "").split(",") if c.strip()] or source_codes(args.league)
    reset(db, args.league, codes, args.apply, args.batch)
    if args.apply:
        print(f"done. Now read the league again:  python scripts/ingest/run_ingest.py --source {','.join(codes)} --refresh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
