#!/usr/bin/env python3
"""
run_ingest.py — poll every due schedule source, fetch new / live games through
the source's adapter, and publish them where index_9 (and, later, the Epinoia
site) read from:

  FEED  (always)      data/feed/index.json                 competitions
                      data/feed/<CODE>/index.json          games (id, teams, score, status, hash)
                      data/feed/<CODE>/games/<id>.json     the raw payload (data.json)
                      → committed by the Actions workflow; index_9's Advanced
                        Games View reads it (repo fallback when Supabase is down)
  SUPABASE (if keys)  external_games rows (competition_code, scores, status,
                      payload_hash, raw_ref = public storage URL) + the payload
                      in storage bucket `feed` + feed_competitions upsert
                      → index_9's primary source; realtime-capable
  PLATFORM (if the source has league_id) games + game_advanced rows for the
                      Epinoia site (Phase 2+ of the platform roadmap)

    python scripts/ingest/run_ingest.py                     # everything due (DB sources)
    python scripts/ingest/run_ingest.py --config --source SLB   # config/ingest-sources.json
    python scripts/ingest/run_ingest.py --config --source SLB --ids 2702542,2702560
    python scripts/ingest/run_ingest.py --config --source SLB --dry-run   # write nothing

Idempotent: (adapter, external_id) is unique; unchanged payload hashes are
skipped; live games are re-fetched until final. Politeness is the adapter's
job (min gap between requests); this runner never fans out in parallel.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

for _stream in (sys.stdout, sys.stderr):        # Windows consoles default to cp1252
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters import get_adapter  # noqa: E402
from adapters.base import GameBundle, ScheduleGame  # noqa: E402
from translate.fiba_events import translate, game_rows  # noqa: E402
from feedplatform import Platform, season_name_for  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "ingest-sources.json"
FEED_DIR = REPO_ROOT / "data" / "feed"
STORAGE_BUCKET = "feed"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────── Supabase (REST)
class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def rpc(self, fn: str, body: dict | None = None):
        r = requests.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self.h, json=body or {}, timeout=30)
        r.raise_for_status(); return r.json()

    def select(self, table: str, query: str):
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status(); return r.json()

    def upsert(self, table: str, rows, on_conflict: str):
        h = dict(self.h, Prefer="resolution=merge-duplicates,return=representation")
        r = requests.post(f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}", headers=h, json=rows, timeout=60)
        r.raise_for_status(); return r.json()

    def patch(self, table: str, query: str, body: dict):
        r = requests.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30)
        r.raise_for_status(); return r.json() if r.text else None

    def delete(self, table: str, query: str):
        r = requests.delete(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=60)
        r.raise_for_status(); return True

    def insert(self, table: str, rows):
        h = dict(self.h, Prefer="return=minimal")
        r = requests.post(f"{self.url}/rest/v1/{table}", headers=h, json=rows, timeout=120)
        r.raise_for_status(); return True

    def function(self, name: str, body: dict):
        r = requests.post(f"{self.url}/functions/v1/{name}", headers=self.h, json=body, timeout=120)
        return r.status_code, (r.json() if r.text and r.headers.get("content-type", "").startswith("application/json") else r.text)

    def storage_put(self, bucket: str, path: str, data: bytes, content_type="application/json") -> str:
        r = requests.post(f"{self.url}/storage/v1/object/{bucket}/{path}",
                          headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": content_type, "x-upsert": "true"},
                          data=data, timeout=120)
        r.raise_for_status()
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"


# ─────────────────────────────────────────────────────────── feed (repo files)
class RepoFeed:
    def __init__(self, root: Path):
        self.root = root

    def index(self, code: str) -> dict:
        p = self.root / code / "index.json"
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"code": code, "games": []}

    def known(self, code: str) -> dict:
        return {str(g["id"]): g for g in self.index(code).get("games", [])}

    def write_game(self, code: str, b: GameBundle) -> None:
        d = self.root / code / "games"
        d.mkdir(parents=True, exist_ok=True)
        if b.raw is not None:
            (d / f"{b.external_id}.json").write_text(json.dumps(b.raw, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    def update_index(self, src: dict, entries: dict) -> None:
        code = src["code"]
        games = sorted(entries.values(), key=lambda g: (g.get("date") or "", str(g["id"])), reverse=True)
        (self.root / code).mkdir(parents=True, exist_ok=True)
        (self.root / code / "index.json").write_text(json.dumps({
            "code": code, "label": src.get("label", code), "adapter": src["adapter"], "updated": now_iso(), "games": games
        }, ensure_ascii=False, indent=0), encoding="utf-8")
        comps = []
        for d in sorted(self.root.iterdir()) if self.root.exists() else []:
            ip = d / "index.json"
            if d.is_dir() and ip.exists():
                try:
                    j = json.loads(ip.read_text(encoding="utf-8"))
                    comps.append({"code": j.get("code", d.name), "label": j.get("label", d.name), "adapter": j.get("adapter"),
                                  "games": len(j.get("games", [])), "updated": j.get("updated")})
                except Exception:
                    continue
        (self.root / "index.json").write_text(json.dumps({"updated": now_iso(), "competitions": comps}, ensure_ascii=False, indent=1), encoding="utf-8")


def entry_for(b: GameBundle, prev: dict | None, raw_ref: str | None) -> dict:
    return {
        "id": b.external_id, "home": b.home_name, "away": b.away_name,
        "homeScore": int(b.team["home"].get("points", 0) or 0), "awayScore": int(b.team["away"].get("points", 0) or 0),
        "status": b.status, "date": b.tipoff_at or (prev or {}).get("date"), "hash": b.payload_hash,
        "raw_ref": raw_ref or (prev or {}).get("raw_ref"), "updated": now_iso(),
    }


# ─────────────────────────────────────────────────────────── Supabase feed + platform writes
def write_supabase_feed(sb: Supabase, src: dict, b: GameBundle, entry: dict) -> str | None:
    raw_ref = None
    if b.raw is not None:
        raw_ref = sb.storage_put(STORAGE_BUCKET, f"{src['adapter']}/{b.external_id}.json", json.dumps(b.raw, ensure_ascii=False).encode("utf-8"))
    sb.upsert("external_games", {
        "adapter": src["adapter"], "external_id": b.external_id, "source_id": src.get("id"),
        "competition_code": src["code"], "home_name": b.home_name, "away_name": b.away_name,
        "home_score": entry["homeScore"], "away_score": entry["awayScore"], "game_date": entry.get("date"),
        "external_status": b.status, "payload_hash": b.payload_hash, "raw_ref": raw_ref, "last_fetched_at": now_iso(),
    }, "adapter,external_id")
    return raw_ref


def write_supabase_competition(sb: Supabase, src: dict, count: int) -> None:
    sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"],
                                    "league_id": src.get("league_id"), "games": count, "updated_at": now_iso()}, "code")


def match_team_id(sb: Supabase, league_id: str, name: str, cache: dict) -> str | None:
    key = (league_id, name.strip().lower())
    if key in cache:
        return cache[key]
    rows = sb.select("teams", f"league_id=eq.{league_id}&select=id,name,aliases")
    for r in rows:
        names = {r["name"].strip().lower()} | {a.strip().lower() for a in (r.get("aliases") or [])}
        if name.strip().lower() in names:
            cache[key] = r["id"]; return r["id"]
    cache[key] = None
    return None


def write_platform(sb: Supabase, src: dict, b: GameBundle, run: dict) -> bool:
    """games + game_advanced (+ event log) for the Epinoia site — only when the source names a league.
    A league connected from the console (auto_create) has its clubs / players / rosters created
    from the payload the first time they appear; a hand-mapped league only matches, never invents."""
    league_id = src.get("league_id")
    ac = src.get("adapter_config") or {}
    plat = run.setdefault("_platform", Platform(sb, dry=False, auto_create=bool(ac.get("auto_create", True))))
    if not league_id and src.get("create_league") and b.raw is not None:
        # a registry entry that asks for its own league (website admin card / config) — created once,
        # then remembered on feed_competitions so every later run finds it
        try:
            fc = sb.select("feed_competitions", f"code=eq.{src['code']}&select=league_id")
            league_id = fc[0]["league_id"] if fc and fc[0].get("league_id") else None
            if not league_id:
                lg = plat.league(src["code"], src.get("league_name") or src.get("label") or src["code"], src.get("league_slug"))
                league_id = lg["id"]
                sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"], "league_id": league_id, "updated_at": now_iso()}, "code")
                print(f"    + league {src.get('league_slug') or src['code']} created for {src['code']}")
            src["league_id"] = league_id
        except Exception as exc:
            print(f"    (league creation failed: {exc})")
            return False
    if not league_id or b.raw is None:
        return False
    comp_id = src.get("competition_id")
    if comp_id:
        comp = {"id": comp_id}
        srow = sb.select("competitions", f"id=eq.{comp_id}&select=season_id")
        season_id = srow[0]["season_id"] if srow else None
    else:
        comp = plat.ensure_competition(league_id, src.get("label") or src.get("code") or "League", ac.get("season"))
        src["competition_id"] = comp["id"]
        season_id = plat.one("competitions", f"id=eq.{comp['id']}&select=season_id")["season_id"]
        if src.get("id"):
            try:
                sb.patch("schedule_sources", f"id=eq.{src['id']}", {"competition_id": comp["id"]})
            except Exception:
                pass
    people = plat.ensure_game_people(league_id, comp, season_id, b.raw)
    home, away = people.get("1"), people.get("2")
    if not (home and away):
        sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}",
                 {"error": f"unmatched team: {'' if home else b.home_name} {'' if away else b.away_name}".strip()})
        print(f"    !! unmatched team for {b.home_name} v {b.away_name} - add an alias in public.teams.aliases")
        return False
    existing = sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}&select=game_id")
    game_id = existing[0]["game_id"] if existing and existing[0].get("game_id") else None
    will_translate = src["adapter"] == "fiba_livestats" and ac.get("translate", True)
    # a game we are about to translate stays 'live' until finalise-game closes it — 'final' means
    # "log closed" to the platform (insert trigger refuses events, finalise refuses a second pass)
    status = ("live" if will_translate else "final") if b.status == "final" else ("live" if b.status == "live" else "scheduled")
    scores = {"home_score": int(b.team["home"].get("points", 0)), "away_score": int(b.team["away"].get("points", 0))}
    if not game_id:
        g = sb.upsert("games", {"competition_id": comp["id"], "home_team_id": home["id"], "away_team_id": away["id"],
                                "tipoff_at": b.tipoff_at, "status": status, **scores}, "id")
        game_id = g[0]["id"]
    else:
        cur = sb.select("games", f"id=eq.{game_id}&select=status")
        if cur and cur[0].get("status") == "final" and will_translate:
            # marked final without a scored log (an earlier run inserted it closed) → reopen it
            n_ev = sb.select("game_events", f"game_id=eq.{game_id}&select=seq&limit=1")
            if not n_ev:
                sb.patch("games", f"id=eq.{game_id}", {"status": "live", **scores})
        elif not (cur and cur[0].get("status") == "final"):
            sb.patch("games", f"id=eq.{game_id}", {"status": status, **scores})
    sb.upsert("game_advanced", {"game_id": game_id, "external_id": b.external_id, "adapter": src["adapter"], "status": b.status,
                                "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
                                "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition,
                                "pbp": b.pbp if ac.get("store_pbp") else None, "computed_at": now_iso()}, "game_id")
    sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}", {"game_id": game_id, "ingested_at": now_iso(), "error": None})
    if will_translate:
        try:
            write_event_log(sb, src, b, game_id, people["pids"])
        except Exception as exc:
            print(f"    (event translation failed: {exc})")
    try:
        sb.rpc("refresh_feed_team_season", {"p_competition": comp["id"]})
    except Exception as exc:
        print(f"    (season roll-up skipped: {exc})")
    return True


def write_event_log(sb: Supabase, src: dict, b: GameBundle, game_id: str, pids: dict) -> None:
    """Translate the FIBA payload into game_events and finalise the game (roadmap Phase B).
    `pids` maps "<teamcode>:<pno>" -> players.id (from Platform.ensure_game_people)."""
    tm = b.raw.get("tm") or {}
    codes = {0: (tm.get("1") or {}).get("code", ""), 1: (tm.get("2") or {}).get("code", "")}
    missing = set()

    def pid_for(team, pno):
        key = f"{codes[team]}:{pno}"
        if key in pids:
            return pids[key]
        missing.add(key)
        return f"{team}:{pno}"

    T = translate(b.raw, pid_for)
    if missing:
        print(f"    ! {len(missing)} players without a platform id: {sorted(missing)[:6]}…")
    g = sb.select("games", f"id=eq.{game_id}&select=status")
    if g and g[0].get("status") == "final":
        return                                              # a finalised log is closed (insert trigger refuses)
    sb.patch("games", f"id=eq.{game_id}", {"roster_snapshot": T["roster_snapshot"], "starters": T["starters"],
                                           "tip_winner": T["tip_winner"], "arrow_init": T["arrow_init"], "period": T["period"],
                                           "status": "live"})
    sb.delete("game_events", f"game_id=eq.{game_id}")       # re-import = delete then insert (the platform's own model)
    rows = game_rows(game_id, T["events"])
    for i in range(0, len(rows), 400):
        sb.insert("game_events", rows[i:i + 400])
    sb.upsert("game_state", {"game_id": game_id, "period": T["period"], "clock_ms": 0, "running": False,
                             "score_home": T["home_score"], "score_away": T["away_score"], "last_seq": len(rows), "updated_at": now_iso()}, "game_id")
    print(f"    = {len(rows)} events written" + (f", warnings: {'; '.join(T['report']['warnings'])}" if T["report"]["warnings"] else ""))
    if b.status == "final":
        code, body = sb.function("finalise-game", {"gameId": game_id})
        if code >= 300:
            print(f"    ! finalise-game {code}: {str(body)[:300]}")
        else:
            print("    = finalised")


# ─────────────────────────────────────────────────────────── main loop
def load_sources(sb: Supabase | None, use_config: bool, only: str | None) -> list[dict]:
    """Config sources (config/ingest-sources.json, edited from the website admin) UNION the
    database's due sources (schedule_sources, connected from the Epinoia console). Same
    schedule URL in both → the DB row wins (it carries league_id + the poll bookkeeping)."""
    rows: dict[str, dict] = {}
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for s in cfg["sources"]:
            if not s.get("enabled", True):
                continue
            for url in s.get("scheduleUrls") or []:
                rows[url] = {**s, "schedule_url": url, "id": None}
    except Exception as exc:
        print(f"(config sources unavailable: {exc})")
    if sb and not use_config:
        try:
            for r in sb.rpc("due_schedule_sources"):
                ac = r.get("adapter_config") or {}
                code = ac.get("code") or r.get("label") or "FEED"
                rows[r["schedule_url"]] = {**rows.get(r["schedule_url"], {}), **r, "code": code,
                                           "scheduleUrls": [r["schedule_url"]], "adapter_config": ac,
                                           "league_id": r.get("league_id"), "competition_id": r.get("competition_id")}
        except Exception as exc:
            print(f"(database sources unavailable: {exc})")
    out = list(rows.values())
    if only:
        out = [r for r in out if r.get("label") == only or r.get("code") == only]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="label/code of one source")
    ap.add_argument("--dry-run", action="store_true", help="discover + fetch, write nothing")
    ap.add_argument("--config", action="store_true", help="(kept for compatibility) config sources are always read; with Supabase keys the database sources are merged in too")
    ap.add_argument("--max-games", type=int, default=400)
    ap.add_argument("--ids", help="comma-separated external ids: skip discovery and fetch just these (tests)")
    ap.add_argument("--feed-out", default=str(FEED_DIR), help="repo feed directory (default data/feed); '' to disable")
    ap.add_argument("--fixture-out", help="also write each bundle (+ raw) as JSON test fixtures here")
    ap.add_argument("--no-supabase", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="re-process every game on the schedule even if already final (backfill stints / re-run translation)")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = Supabase(url, key) if (url and key and not args.dry_run and not args.no_supabase) else None
    feed = RepoFeed(Path(args.feed_out)) if (args.feed_out and not args.dry_run) else None
    if sb is None:
        print("Supabase: off" + ("" if args.no_supabase or args.dry_run else " (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)") + " - repo feed only")

    sources = load_sources(sb, args.config and sb is None, args.source)
    print(f"{len(sources)} source(s) due")
    worker = os.environ.get("GITHUB_RUN_ID", "local")
    exit_code = 0
    for src in sources:
        adapter = get_adapter(src["adapter"])
        run = {"source_id": src.get("id"), "worker": f"gha:{worker}", "games_seen": 0, "games_fetched": 0, "games_written": 0}
        run_id = None
        if sb and src.get("id"):
            try:
                run_id = sb.upsert("ingest_runs", {k: v for k, v in run.items()}, "id")[0]["id"]
            except Exception:
                run_id = None
        t0 = time.time(); err = None
        try:
            print(f"-> {src['label']} [{src['adapter']}] {src['schedule_url'][:90]}")
            games = ([ScheduleGame(external_id=x.strip()) for x in args.ids.split(",") if x.strip()] if args.ids
                     else list(adapter.discover(src["schedule_url"], dict(src.get("adapter_config", {}), code=src.get("code")))))
            run["games_seen"] = len(games)
            # What we already have. When Supabase is configured IT is the authority for "already
            # done" (a game only in the repo index still needs its Supabase rows + storage copy);
            # the repo index is merged in afterwards so index.json keeps every game it knew.
            known_repo = feed.known(src["code"]) if feed else {}
            known_db = {}
            if sb:
                try:
                    for r in sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&select=external_id,external_status,payload_hash,raw_ref,game_date,home_name,away_name,home_score,away_score"):
                        k = str(r["external_id"])
                        known_db[k] = {**known_repo.get(k, {"id": k}), "id": k, "home": r.get("home_name"), "away": r.get("away_name"),
                                       "homeScore": r.get("home_score"), "awayScore": r.get("away_score"),
                                       "status": r.get("external_status"), "hash": r.get("payload_hash"), "raw_ref": r.get("raw_ref"), "date": r.get("game_date")}
                except Exception as exc:
                    print(f"   (external_games unavailable: {exc})")
            known = known_db if sb else known_repo
            todo = ([g for g in games] if args.refresh else
                    [g for g in games if not (known.get(g.external_id, {}).get("status") == "final" and known.get(g.external_id, {}).get("hash"))])[: args.max_games]
            print(f"   {len(games)} on schedule, {len(todo)} to (re)fetch")
            entries = {**known_repo, **known}
            for g in todo:
                try:
                    b = adapter.fetch(g.external_id, src.get("adapter_config", {}))
                except Exception as exc:                                 # one bad game never stops the league
                    print(f"    ! {g.external_id}: {exc}")
                    continue
                if not b:
                    continue
                run["games_fetched"] += 1
                prev = known.get(g.external_id)
                if prev and prev.get("hash") == b.payload_hash and b.status != "live" and not args.refresh:
                    continue
                if args.dry_run:
                    print(f"    [dry] {b.home_name} vs {b.away_name} ({b.status}) stints={len(b.stints)} box={len(b.box.get('home', []))}+{len(b.box.get('away', []))}")
                    if args.fixture_out:
                        write_fixture(Path(args.fixture_out), src, b)
                    continue
                raw_ref = None
                if sb:
                    try:
                        raw_ref = write_supabase_feed(sb, src, b, entry_for(b, prev, None))
                    except Exception as exc:
                        print(f"    (supabase feed write failed: {exc})")
                entry = entry_for(b, prev, raw_ref)
                if feed:
                    feed.write_game(src["code"], b)
                entries[g.external_id] = entry
                if sb:
                    try:
                        write_platform(sb, src, b, run)
                    except Exception as exc:
                        print(f"    (platform write failed: {exc})")
                if args.fixture_out:
                    write_fixture(Path(args.fixture_out), src, b)
                run["games_written"] += 1
                print(f"    + {b.home_name} {entry['homeScore']}-{entry['awayScore']} {b.away_name} ({b.status}, {len(b.stints)} stints)")
            if not args.dry_run:
                if feed:
                    feed.update_index(src, {k: v for k, v in entries.items() if v.get("hash")})
                if sb:
                    try:
                        write_supabase_competition(sb, src, len([v for v in entries.values() if v.get("hash")]))
                    except Exception as exc:
                        print(f"    (feed_competitions upsert failed: {exc})")
        except Exception as exc:                                             # keep polling other sources
            err = f"{type(exc).__name__}: {exc}"[:500]; exit_code = 1
            print(f"   !! {err}")
        finally:
            if sb and src.get("id"):
                try:
                    sb.patch("schedule_sources", f"id=eq.{src['id']}", {"last_polled_at": now_iso(), **({"last_ok_at": now_iso(), "last_error": None} if not err else {"last_error": err})})
                    if run_id:
                        sb.patch("ingest_runs", f"id=eq.{run_id}", {"finished_at": now_iso(), "games_seen": run["games_seen"], "games_fetched": run["games_fetched"],
                                                                   "games_written": run["games_written"], "status": "failed" if err and not run["games_written"] else ("partial" if err else "ok"), "error": err})
                except Exception:
                    pass
            print(f"   done in {time.time() - t0:.1f}s - seen {run['games_seen']}, fetched {run['games_fetched']}, written {run['games_written']}")
    return exit_code


def write_fixture(d: Path, src: dict, b: GameBundle) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{b.external_id}.json").write_text(json.dumps({
        "external_id": b.external_id, "adapter": src["adapter"], "status": b.status, "home_name": b.home_name, "away_name": b.away_name,
        "tipoff_at": b.tipoff_at, "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
        "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition, "pbp": b.pbp}, ensure_ascii=False), encoding="utf-8")
    if b.raw is not None:
        (d / f"{b.external_id}.raw.json").write_text(json.dumps(b.raw, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
