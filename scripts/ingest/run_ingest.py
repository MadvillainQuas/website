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
import re
import sys
import time
from datetime import datetime, timedelta, timezone
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
        r = requests.post(f"{self.url}/functions/v1/{name}", headers=dict(self.h, **{"x-ingest-worker": "1"}), json=body, timeout=120)
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


def entry_for(b: GameBundle, prev: dict | None, raw_ref: str | None, sched: ScheduleGame | None = None) -> dict:
    tip = (sched.tipoff_at if sched else None) or b.tipoff_at or (prev or {}).get("date")
    return {
        "id": b.external_id, "home": b.home_name, "away": b.away_name,
        "homeScore": int(b.team["home"].get("points", 0) or 0), "awayScore": int(b.team["away"].get("points", 0) or 0),
        "status": b.status, "date": tip, "hash": b.payload_hash,
        "venue": (sched.extra.get("venue") if sched else None) or (prev or {}).get("venue"),
        "raw_ref": raw_ref or (prev or {}).get("raw_ref"), "updated": now_iso(),
    }


def sched_entry(g: ScheduleGame, prev: dict | None) -> dict:
    """A game the schedule lists but the feed has not published yet (no payload): keep it in the
    index with its date, teams and venue so index_9 and Epinoia can show the fixture."""
    e = dict(prev or {})
    e.update({"id": g.external_id, "home": g.home_name or e.get("home"), "away": g.away_name or e.get("away"),
              "status": e.get("status") if e.get("hash") else (g.status or "scheduled"),
              "date": g.tipoff_at or e.get("date"), "venue": (g.extra or {}).get("venue") or e.get("venue")})
    return e


# ─────────────────────────────────────────────────────────── Supabase feed + platform writes
def write_supabase_feed(sb: Supabase, src: dict, b: GameBundle, entry: dict) -> str | None:
    raw_ref = None
    if b.raw is not None:
        raw_ref = sb.storage_put(STORAGE_BUCKET, f"{src['adapter']}/{b.external_id}.json", json.dumps(b.raw, ensure_ascii=False).encode("utf-8"))
    sb.upsert("external_games", {
        "adapter": src["adapter"], "external_id": b.external_id, "source_id": src.get("id"),
        "competition_code": src["code"], "home_name": b.home_name, "away_name": b.away_name,
        "home_score": entry["homeScore"], "away_score": entry["awayScore"], "game_date": (entry.get("date") or "")[:10] or None,
        "tipoff_at": entry.get("date"), "external_status": b.status, "payload_hash": b.payload_hash, "raw_ref": raw_ref, "last_fetched_at": now_iso(),
    }, "adapter,external_id")
    return raw_ref


def write_supabase_competition(sb: Supabase, src: dict, count: int) -> None:
    sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"],
                                    "league_id": src.get("league_id"), "games": count, "updated_at": now_iso()}, "code")


def resolve_league(sb: Supabase, src: dict, run: dict) -> str | None:
    """The platform league a source feeds: given in the registry, remembered on feed_competitions,
    or — for an entry that asks for its own league (create_league) — created now, once."""
    ac = src.get("adapter_config") or {}
    plat = run.setdefault("_platform", Platform(sb, dry=False, auto_create=bool(ac.get("auto_create", True))))
    league_id = src.get("league_id")
    if league_id or not src.get("create_league"):
        return league_id
    try:
        fc = sb.select("feed_competitions", f"code=eq.{src['code']}&select=league_id")
        league_id = fc[0]["league_id"] if fc and fc[0].get("league_id") else None
        if not league_id:
            lg = plat.league(src["code"], src.get("league_name") or src.get("label") or src["code"], src.get("league_slug"), src.get("league_country"))
            league_id = lg["id"]
            sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"], "league_id": league_id, "updated_at": now_iso()}, "code")
            print(f"    + league {src.get('league_slug') or src['code']} created for {src['code']}")
        elif src.get("league_country"):        # keep an existing league's country in step with the registry
            plat.league(src["code"], src.get("league_name") or src["code"], src.get("league_slug"), src["league_country"])
        src["league_id"] = league_id
    except Exception as exc:
        print(f"    (league creation failed: {exc})")
        return None
    return league_id


KIND_RULES = [
    (re.compile(r"play-?off|final four|finals?\b|post-?season", re.I), "playoff"),
    (re.compile(r"trophy|cup|shield|plate|knock-?out", re.I), "cup"),
    (re.compile(r"all.?star|exhibition|friendl|pre-?season|showcase", re.I), "friendly"),
]


def kind_of(name: str, overrides: dict | None = None) -> str:
    """What sort of competition a Genius phase name describes. adapter_config.competition_kinds
    ({"BCB Trophy 2027": "cup"}) wins over the words."""
    if overrides and name in overrides:
        return overrides[name]
    for rx, kind in KIND_RULES:
        if rx.search(name or ""):
            return kind
    return "league"


def season_match(name: str, season_name: str) -> bool:
    """Does a Genius phase name belong to this season? A name carrying a year RANGE (2025-2026,
    2025/26) must carry ours; a name with a single year (BCB Trophy 2027, Pro Am 2026) may name
    either end of ours. '2026' inside '2025-2026' is last season, not this one."""
    m = re.match(r"(\d{4})-(\d{2})$", season_name or "")
    if not m:
        return bool(season_name) and season_name in (name or "")
    y1 = int(m.group(1)); y2 = y1 + 1
    ranges = re.findall(r"(\d{4})\s*[-/–]\s*(\d{2,4})", name or "")
    if ranges:
        for a, b in ranges:
            bb = int(b) if len(b) == 4 else int(str(y1)[:2] + b)
            if int(a) == y1 and bb == y2:
                return True
        return False
    years = {int(y) for y in re.findall(r"(?<!\d)(\d{4})(?!\d)", name or "")}
    return bool(years & {y1, y2})


def expand_competition_sources(sources: list[dict]) -> list[dict]:
    """A FIBA source pointing at a client's whole schedule page becomes ONE SOURCE PER COMPETITION
    the page offers for the current season (league, cup/trophy, playoffs, an all-star game), each
    carrying the competition's own schedule URL, name and kind. That is what gives Epinoia the
    separate team lists and tables a cup has, straight from the feed. Names that carry none of
    the league's own words (a client also hosting somebody else's event) are left alone unless
    adapter_config.competitions_include names them; competitions_exclude drops any."""
    out = []
    for src in sources:
        ac = src.get("adapter_config") or {}
        url = src.get("schedule_url") or ""
        if src.get("adapter") != "fiba_livestats" or "/competition/" in url or ac.get("expand_competitions") is False:
            out.append(src); continue
        adapter = get_adapter(src["adapter"])
        try:
            list(adapter.discover(url, dict(ac, code=src.get("code"))))
            comps = getattr(adapter, "last_competitions", None) or []
        except Exception as exc:
            print(f"   (competition list unavailable for {src.get('code')}: {exc})"); comps = []
        if not comps:
            out.append(src); continue
        season = ac.get("season") or season_name_for()
        words = {w.lower() for w in re.findall(r"[A-Za-z]{3,}", f"{src.get('label', '')} {src.get('code', '')} {src.get('league_name', '')}")}
        inc = [re.compile(x, re.I) for x in (ac.get("competitions_include") or [])]
        exc_ = [re.compile(x, re.I) for x in (ac.get("competitions_exclude") or [])]
        picked = []
        for c in comps:
            n = c["name"]
            if any(r.search(n) for r in exc_):
                continue
            wanted = any(r.search(n) for r in inc)
            if not wanted:
                in_season = season_match(n, season)
                ours = any(w in n.lower() for w in words)
                wanted = in_season and ours
            if wanted:
                picked.append(c)
        if not picked:
            out.append(src); continue
        print(f"-> {src.get('code')}: {len(picked)} competition(s) this season: " + ", ".join(f"{c['name']} [{kind_of(c['name'], ac.get('competition_kinds'))}]" for c in picked))
        for c in picked:
            out.append({**src, "schedule_url": c["url"], "competition_label": c["name"],
                        "competition_kind": kind_of(c["name"], ac.get("competition_kinds")), "competition_id": None,
                        "label": src.get("label"), "_parent_url": url})
    return out


def source_competition(sb: Supabase, plat, src: dict, league_id: str, ac: dict) -> dict:
    """The competition this source's games belong to: the DB row's, else the feed's phase for
    this source (name + kind), else the league's default competition (the source label)."""
    if src.get("competition_id"):
        return {"id": src["competition_id"]}
    if src.get("competition_label"):
        comp = plat.ensure_competition(league_id, src["competition_label"], ac.get("season"), src.get("competition_kind"))
    else:
        comp = plat.ensure_competition(league_id, src.get("label") or src.get("code") or "League", ac.get("season"))
    src["competition_id"] = comp["id"]
    if src.get("id"):
        try:
            sb.patch("schedule_sources", f"id=eq.{src['id']}", {"competition_id": comp["id"]})
        except Exception:
            pass
    return comp


def default_competition_id(plat, src: dict, league_id: str, ac: dict) -> str | None:
    """The league's catch-all competition (named after the source), if it exists - the one games
    were filed under before the feed's phases were known."""
    try:
        s = plat.season(league_id, ac.get("season") or season_name_for())
        r = plat.one("competitions", f"season_id=eq.{s['id']}&name=eq.{src.get('label') or src.get('code')}&select=id")
        return r["id"] if r else None
    except Exception:
        return None


def sync_logos(sb: Supabase, src: dict, games: list, run: dict) -> None:
    """Every club on the schedule gets its crest from the schedule page itself (both sides of every
    fixture carry one), so a club's logo is on the site before its first game is fetched."""
    league_id = resolve_league(sb, src, run)
    if not league_id or not games:
        return
    plat = run["_platform"]
    seen = set(); n = 0
    for g in games:
        for side in ("home", "away"):
            code = (g.extra or {}).get(f"{side}_code"); logo = (g.extra or {}).get(f"{side}_logo")
            name = g.home_name if side == "home" else g.away_name
            if not code or not logo or code in seen:
                continue
            seen.add(code)
            try:
                before = plat.cache["team"].get((league_id, code), {}) or {}
                t = plat.team(league_id, {"code": code, "name": name, "logoT": {"url": logo}})
                if t and t.get("logo_path") == logo and before.get("logo_path") != logo:
                    n += 1
            except Exception:
                continue
    if n:
        print(f"   {n} club crest(s) taken from the schedule")


def write_fixture(sb: Supabase, src: dict, g: ScheduleGame, run: dict) -> None:
    """A scheduled game (no payload yet) becomes an Epinoia fixture with its date and venue, so the
    fixtures page shows what is coming. Clubs are matched by code/name; unknown clubs wait for the payload."""
    league_id = resolve_league(sb, src, run)
    if not league_id or not (g.home_name and g.away_name):
        return
    ac = src.get("adapter_config") or {}
    plat = run["_platform"]
    comp_id = source_competition(sb, plat, src, league_id, ac)["id"]
    ex = g.extra or {}
    home = plat.team(league_id, {"name": g.home_name, "code": ex.get("home_code") or ""})
    away = plat.team(league_id, {"name": g.away_name, "code": ex.get("away_code") or ""})
    if not (home and away):
        return
    existing = sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{g.external_id}&select=game_id")
    game_id = existing[0]["game_id"] if existing and existing[0].get("game_id") else None
    row = {"tipoff_at": g.tipoff_at, "venue": ex.get("venue")}
    if game_id:
        cur = sb.select("games", f"id=eq.{game_id}&select=status,tipoff_at,venue")
        if cur and cur[0].get("status") in ("scheduled", None) and (cur[0].get("tipoff_at") != g.tipoff_at or (ex.get("venue") and cur[0].get("venue") != ex.get("venue"))):
            sb.patch("games", f"id=eq.{game_id}", {k: v for k, v in row.items() if v})
        return
    gm = sb.upsert("games", {"competition_id": comp_id, "home_team_id": home["id"], "away_team_id": away["id"], "status": "scheduled", **{k: v for k, v in row.items() if v}}, "id")
    if src.get("competition_label") and gm and gm[0].get("competition_id") not in (None, comp_id):
        dflt = default_competition_id(plat, src, league_id, ac)
        if dflt and gm[0]["competition_id"] == dflt:
            sb.patch("games", f"id=eq.{gm[0]['id']}", {"competition_id": comp_id})
            run.setdefault("_recompute", set()).update({dflt, comp_id})
    for tid in (home["id"], away["id"]):
        sb.upsert("competition_teams", {"competition_id": comp_id, "team_id": tid}, "competition_id,team_id")
    sb.upsert("external_games", {"adapter": src["adapter"], "external_id": g.external_id, "competition_code": src["code"], "game_id": gm[0]["id"],
                                 "home_name": g.home_name, "away_name": g.away_name, "external_status": "scheduled",
                                 "tipoff_at": g.tipoff_at, "game_date": (g.tipoff_at or "")[:10] or None}, "adapter,external_id")
    run["fixtures"] = run.get("fixtures", 0) + 1


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


def write_platform(sb: Supabase, src: dict, b: GameBundle, run: dict, observed: tuple | None = None) -> bool:
    """games + game_advanced (+ event log) for the Epinoia site — only when the source names a league.
    A league connected from the console (auto_create) has its clubs / players / rosters created
    from the payload the first time they appear; a hand-mapped league only matches, never invents."""
    ac = src.get("adapter_config") or {}
    league_id = resolve_league(sb, src, run)
    plat = run["_platform"]
    if not league_id or b.raw is None:
        return False
    comp = source_competition(sb, plat, src, league_id, ac)
    srow = sb.select("competitions", f"id=eq.{comp['id']}&select=season_id")
    season_id = srow[0]["season_id"] if srow else None
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
        cur = sb.select("games", f"id=eq.{game_id}&select=status,tipoff_at,competition_id")
        extra = {"tipoff_at": b.tipoff_at} if (b.tipoff_at and cur and cur[0].get("tipoff_at") != b.tipoff_at) else {}
        # A game filed under the league's catch-all competition before the feed's phases were known
        # moves to the phase this source is (Trophy, League, playoffs). A game an administrator has
        # already placed somewhere specific is never touched - only the catch-all is.
        if src.get("competition_label") and cur and cur[0].get("competition_id") not in (None, comp["id"]):
            dflt = default_competition_id(plat, src, league_id, ac)
            if dflt and cur[0]["competition_id"] == dflt:
                extra["competition_id"] = comp["id"]
                run.setdefault("_recompute", set()).update({dflt, comp["id"]})
                print(f"    -> filed under {src['competition_label']}")
        if cur and cur[0].get("status") == "final" and will_translate:
            # marked final without a scored log (an earlier run inserted it closed) → reopen it
            n_ev = sb.select("game_events", f"game_id=eq.{game_id}&select=seq&limit=1")
            if not n_ev:
                sb.patch("games", f"id=eq.{game_id}", {"status": "live", **scores, **extra})
            elif extra:
                sb.patch("games", f"id=eq.{game_id}", extra)
        elif cur and cur[0].get("status") == "final":
            if extra:
                sb.patch("games", f"id=eq.{game_id}", extra)
        else:
            sb.patch("games", f"id=eq.{game_id}", {"status": status, **scores, **extra})
    sb.upsert("game_advanced", {"game_id": game_id, "external_id": b.external_id, "adapter": src["adapter"], "status": b.status,
                                "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
                                "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition,
                                "pbp": b.pbp if ac.get("store_pbp") else None, "computed_at": now_iso()}, "game_id")
    sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}", {"game_id": game_id, "ingested_at": now_iso(), "error": None})
    if will_translate:
        try:
            write_event_log(sb, src, b, game_id, people["pids"], observed)
        except Exception as exc:
            print(f"    (event translation failed: {exc})")
    try:
        sb.rpc("refresh_feed_team_season", {"p_competition": comp["id"]})
    except Exception as exc:
        print(f"    (season roll-up skipped: {exc})")
    return True


def write_event_log(sb: Supabase, src: dict, b: GameBundle, game_id: str, pids: dict, observed: tuple | None = None) -> None:
    """Translate the FIBA payload into game_events and finalise the game (roadmap Phase B).
    `pids` maps "<teamcode>:<pno>" -> players.id (from Platform.ensure_game_people).
    `observed` = (epoch_ms, err_ms): WHEN THIS POLL SAW THE FEED, and how far back the play could
    really have happened (the poll interval + fetch time). The Genius payload carries no time of
    day for a play, so the only clock that saw it happen is ours. New events get payload.wall =
    epoch_ms (the device-stamp slot epinoia/video.js already prefers) and payload.wall_err =
    err_ms, which is what places a fed game's plays in a video - see
    docs/video-livestats-sync-roadmap.md, Phase 0. Backfilled logs get no stamp: their created_at
    is the import, and the page's timed-log test correctly refuses to anchor a video to them."""
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
    rows = game_rows(game_id, T["events"])
    # LIVE GAMES GROW: if the existing log is a prefix of the new one, append only the tail — the
    # game page's gap check (last_seq) then pulls just the new rows, like a scorer's frames.
    existing = sb.select("game_events", f"game_id=eq.{game_id}&select=seq,t,team,pid,period,clock,payload,created_at&order=seq")
    same_prefix = len(existing) <= len(rows) and all(
        e["seq"] == r["seq"] and e["t"] == r["t"] and e.get("team") == r["team"] and e.get("pid") == r["pid"] and e["period"] == r["period"] and e["clock"] == r["clock"]
        for e, r in zip(existing, rows))
    stamp = None
    if observed and observed[1] is not None and observed[1] <= 180_000:
        stamp = {"wall": int(observed[0]), "wall_err": int(observed[1])}
    if existing and same_prefix:
        tail = rows[len(existing):]
        if stamp:
            for r in tail:
                r["payload"] = {**(r.get("payload") or {}), **stamp}
        for i in range(0, len(tail), 400):
            sb.insert("game_events", tail[i:i + 400])
        how = f"+{len(tail)} events (now {len(rows)})" + (" stamped" if stamp and tail else "")
    else:
        # A corrected feed = replace (the platform's own model). The stamps already earned are
        # carried across by matching the old rows in order - one Genius correction three plays
        # back must not un-time the whole game.
        carry = {}
        for e in existing:
            p = e.get("payload") or {}
            if p.get("wall") is not None:
                carry.setdefault((e["t"], e.get("team"), e.get("pid"), e["period"], e["clock"]), []).append(
                    {"wall": p["wall"], "wall_err": p.get("wall_err"), "created_at": e.get("created_at")})
        kept = 0
        for r in rows:
            k = (r["t"], r["team"], r["pid"], r["period"], r["clock"])
            if carry.get(k):
                c = carry[k].pop(0)
                r["payload"] = {**(r.get("payload") or {}), "wall": c["wall"], **({"wall_err": c["wall_err"]} if c.get("wall_err") is not None else {})}
                if c.get("created_at"):
                    r["created_at"] = c["created_at"]
                kept += 1
        if stamp and existing:
            for r in rows[len(existing):]:
                if "wall" not in (r.get("payload") or {}):
                    r["payload"] = {**(r.get("payload") or {}), **stamp}
        sb.delete("game_events", f"game_id=eq.{game_id}")
        for i in range(0, len(rows), 400):
            sb.insert("game_events", rows[i:i + 400])
        how = f"{len(rows)} events written" + (f" (log replaced, {kept} stamps kept)" if existing else "")
    # scoreboard state: FIBA's clock is mm:ss remaining in the current period
    live = b.status == "live"
    clock_ms = 0
    try:
        mm, ss = str(b.raw.get("clock") or "0:00").split(":")[:2]
        clock_ms = (int(mm) * 60 + int(float(ss))) * 1000
    except Exception:
        pass
    # `running` stays FALSE for a fed game: the page would otherwise count the clock down locally
    # between polls, and a feed clock is only ever as current as its last event. Written stopped,
    # it reads exactly what FIBA LiveStats shows and moves when the next payload lands.
    sb.upsert("game_state", {"game_id": game_id, "period": T["period"], "clock_ms": clock_ms if live else 0, "running": False,
                             "score_home": T["home_score"], "score_away": T["away_score"], "last_seq": len(rows), "updated_at": now_iso()}, "game_id")
    print(f"    = {how}" + (f", warnings: {'; '.join(T['report']['warnings'])}" if T["report"]["warnings"] else ""))
    if b.status == "final":
        code, body = sb.function("finalise-game", {"gameId": game_id})
        if code >= 300:
            msg = f"finalise-game {code}: {str(body)[:300]}"
            print(f"    ! {msg}")
            try:
                sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}", {"error": msg[:500]})
            except Exception:
                pass
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


# ----------------------------------------------------------------------------
# THE LIVE LANE. GitHub's cron is best-effort (on 2026-09-06 the 10-minute lane never fired and the
# half-hourly one skipped three slots in a row), so live coverage cannot wait on it. One pass of the
# live lane is long-lived instead: it re-reads the due set every 2 minutes (a game that tips while we
# run is picked up), polls every due game every --live-every seconds, naps until the next listed
# tip-off when nothing is on, and at the end tells the workflow (GITHUB_OUTPUT chain=true) to start
# the next pass whenever games are live or a tip-off is near. The passes chain back to back, so the
# only cron that matters is the one that starts the first pass of the day - and the discovery lane
# starts one too whenever it sees a game due.
LIVE_BEFORE_TIP = 20 * 60      # start polling this long before the listed tip-off
LIVE_AFTER_TIP = 4 * 3600      # keep polling an unpublished game this long after its tip-off
LIVE_STALE = 7 * 3600          # a game still 'live' this long after tip is a log nobody closed - not a reason to keep a runner up
CHAIN_AHEAD = 8 * 3600         # the live lane re-dispatches itself when the next tip-off is within this
MAIN_CHAIN_AHEAD = 3 * 3600    # the discovery lane starts the live lane when the next tip-off is within this
STALE_FINAL_S = 15 * 60        # a payload unchanged this long at the end of P4+ with unequal scores is a finished game


def _looks_finished(raw: dict) -> bool:
    """End of the fourth period or later, clock at 0:00, scores not level: nothing but a scorer's
    'game end' tap is missing. Level scores mean overtime is coming, so never final."""
    try:
        period = int(raw.get("period") or 0)
        clock = str(raw.get("clock") or "").strip()
        tm = raw.get("tm") or {}
        s1 = int((tm.get("1") or {}).get("score") or 0)
        s2 = int((tm.get("2") or {}).get("score") or 0)
    except (TypeError, ValueError):
        return False
    return period >= 4 and clock in ("00:00", "0:00", "00:00:00") and s1 != s2


def gh_output(**kv) -> None:
    """Hand values to the workflow step (GITHUB_OUTPUT) - no-op locally."""
    p = os.environ.get("GITHUB_OUTPUT")
    if not p:
        return
    with open(p, "a", encoding="utf-8") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def _tip(r: dict):
    try:
        return datetime.fromisoformat(str(r.get("tipoff_at")).replace("Z", "+00:00")) if r.get("tipoff_at") else None
    except ValueError:
        return None


def live_due(sb: "Supabase", sources: list[dict], now: datetime) -> tuple[list[tuple[dict, dict]], datetime | None]:
    """(due, next_tip): the games to poll now - live, or inside the tip-off window - and the next
    listed tip-off beyond the window (so a quiet pass knows how long to wait)."""
    due, next_tip = [], None
    for src in sources:
        try:
            rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final"
                                               "&select=external_id,external_status,tipoff_at,game_date,home_name,away_name,payload_hash")
        except Exception as exc:
            print(f"   (live lookup failed for {src['code']}: {exc})"); continue
        today = now.date().isoformat(); yday = (now - timedelta(days=1)).date().isoformat()
        for r in rows:
            t = _tip(r); since = (now - t).total_seconds() if t else None
            # a game marked live is polled while its tip-off is recent - or, when the schedule never
            # gave one, while its game date is today/yesterday. A log nobody closed last season must
            # not keep a runner alive (and chaining) for ever.
            recent = (since is not None and since < LIVE_STALE) or (since is None and r.get("game_date") in (today, yday))
            if r.get("external_status") == "live" and recent:
                due.append((src, r))
            elif since is not None and -LIVE_BEFORE_TIP <= since < LIVE_AFTER_TIP:
                due.append((src, r))
            elif since is not None and since < -LIVE_BEFORE_TIP and (next_tip is None or t < next_tip):
                next_tip = t
    return due, next_tip


def live_keeper(sb: "Supabase | None", sources: list[dict], args) -> tuple[int, bool]:
    """One long-lived live-lane pass (see the note above). Returns (exit_code, chain)."""
    fiba, seen_codes = [], set()
    for s_ in sources:
        if s_["adapter"] == "fiba_livestats" and s_["code"] not in seen_codes:
            seen_codes.add(s_["code"])
            fiba.append({**s_, "competition_label": None, "competition_kind": None})   # discovery decides the phase
    if sb is None or not fiba:
        print("live lane: needs Supabase and a fiba_livestats source"); return 0, False
    adapters = {s["code"]: get_adapter(s["adapter"]) for s in fiba}
    worker = os.environ.get("GITHUB_RUN_ID", "local")
    runs = {s["code"]: {"source_id": s.get("id"), "worker": f"gha:{worker}", "games_seen": 0, "games_fetched": 0, "games_written": 0} for s in fiba}
    hashes: dict[str, str] = {}
    finished: set[str] = set()
    unchanged_since: dict[str, float] = {}      # when each game's payload last changed (stale-final rule)
    end = time.time() + max(60, args.live_loop); every = max(10, args.live_every)
    due, next_tip, recheck, exit_code = [], None, 0.0, 0
    print(f"live lane: up to {args.live_loop // 60} min, polling every {every} s")
    while time.time() < end:
        now = datetime.now(timezone.utc)
        if time.time() >= recheck:
            due, next_tip = live_due(sb, fiba, now)
            due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
            for s, r in due:
                hashes.setdefault(str(r["external_id"]), r.get("payload_hash") or "")
                runs[s["code"]]["games_seen"] = max(runs[s["code"]]["games_seen"], len([1 for s2, _ in due if s2 is s]))
            recheck = time.time() + 120
            print(f"{now.strftime('%H:%M:%S')}Z {len(due)} live/due game(s)" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") +
                  ((": " + ", ".join(f"{r.get('home_name') or r['external_id']} v {r.get('away_name') or ''}" for _, r in due[:6])) if due else ""))
        for src, r in due:
            xid = str(r["external_id"])
            g = ScheduleGame(external_id=xid, home_name=r.get("home_name") or "", away_name=r.get("away_name") or "",
                             tipoff_at=r.get("tipoff_at"), status=r.get("external_status") or "scheduled")
            t_obs = time.time()
            try:
                b = adapters[src["code"]].fetch(xid, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
            except Exception as exc:
                print(f"    ! {xid}: {exc}"); exit_code = 1; continue
            if not b:
                continue                                                  # not published yet
            if hashes.get(xid) == b.payload_hash:
                # NOTHING NEW - but a game a scorer never closed must still finish. Genius only
                # marks a game final through an explicit 'game end' action; when the payload has
                # sat unchanged for 15 min at the end of the fourth period (or later) with the
                # scores not level, the game is over in every sense that matters and is finalised.
                first_seen = unchanged_since.setdefault(xid, time.time())
                if b.status == "live" and time.time() - first_seen >= STALE_FINAL_S and _looks_finished(b.raw):
                    print(f"    = {b.home_name} v {b.away_name}: unchanged {int((time.time() - first_seen) // 60)} min at the end of P{b.raw.get('period')} - treating as final")
                    b.status = "final"
                else:
                    continue
            else:
                unchanged_since[xid] = time.time()
            # a play in this payload happened between the previous poll and this fetch
            observed = (int(t_obs * 1000), int((every + (time.time() - t_obs)) * 1000))
            run = runs[src["code"]]; run["games_fetched"] += 1
            raw_ref = None
            try:
                raw_ref = write_supabase_feed(sb, src, b, entry_for(b, None, None, g))
            except Exception as exc:
                print(f"    (supabase feed write failed: {exc})")
            try:
                write_platform(sb, src, b, run, observed); run["games_written"] += 1
            except Exception as exc:
                print(f"    (platform write failed: {exc})")
            hashes[xid] = b.payload_hash
            e = entry_for(b, None, raw_ref, g)
            print(f"    ~ {b.home_name} {e['homeScore']}-{e['awayScore']} {b.away_name} ({b.status}) {datetime.now(timezone.utc).strftime('%H:%M:%S')}Z")
            if b.status == "final":
                finished.add(xid)
        due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
        if due:
            time.sleep(every); continue
        # nothing on: wait for the next tip-off if this pass can still reach it (short naps - the
        # 2-minute recheck notices a schedule change or a game that goes live early)
        wait = ((next_tip - datetime.now(timezone.utc)).total_seconds() - LIVE_BEFORE_TIP) if next_tip else None
        if wait is None or time.time() + wait > end:
            break
        time.sleep(min(max(wait, 5), 120))
    for s in fiba:
        if s.get("id"):
            try:
                sb.patch("schedule_sources", f"id=eq.{s['id']}", {"last_polled_at": now_iso(), "last_ok_at": now_iso()})
                if runs[s["code"]]["games_fetched"]:
                    sb.insert("ingest_runs", {**runs[s["code"]], "finished_at": now_iso(), "status": "ok"})
            except Exception:
                pass
    now = datetime.now(timezone.utc)
    due, next_tip = live_due(sb, fiba, now)
    due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
    chain = bool(due) or (next_tip is not None and (next_tip - now).total_seconds() < CHAIN_AHEAD)
    print(f"live lane done: {len(due)} still live/due" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") +
          (" - chaining the next pass" if chain else " - nothing near, stopping"))
    return exit_code, chain


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
    ap.add_argument("--live-only", action="store_true", help="skip discovery; re-check only games live or due to tip (the frequent pass)")
    ap.add_argument("--live-loop", type=int, default=0, help="after the pass, keep re-polling live games every --live-every seconds for this many seconds")
    ap.add_argument("--live-every", type=int, default=30)
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = Supabase(url, key) if (url and key and not args.dry_run and not args.no_supabase) else None
    feed = RepoFeed(Path(args.feed_out)) if (args.feed_out and not args.dry_run) else None
    if sb is None:
        print("Supabase: off" + ("" if args.no_supabase or args.dry_run else " (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)") + " - repo feed only")

    sources = load_sources(sb, args.config and sb is None, args.source)
    if not args.ids:
        sources = expand_competition_sources(sources)
    print(f"{len(sources)} source(s) due")
    if args.live_only and not args.ids:
        rc, chain = live_keeper(sb, sources, args)
        gh_output(chain="true" if chain else "false")
        return rc
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
            if args.ids:
                games = [ScheduleGame(external_id=x.strip()) for x in args.ids.split(",") if x.strip()]
            elif args.live_only:
                # games live now, or due to tip within 20 min / tipped within the last 4 h (from the schedule dates)
                games = []
                now = datetime.now(timezone.utc)
                try:
                    rows_ = (sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final&select=external_id,external_status,tipoff_at,home_name,away_name")
                             if sb else [dict(external_id=k, external_status=v.get("status"), tipoff_at=v.get("date"), home_name=v.get("home"), away_name=v.get("away"))
                                         for k, v in (feed.known(src["code"]) if feed else {}).items() if v.get("status") != "final"])
                except Exception as exc:
                    print(f"   (live lookup failed: {exc})"); rows_ = []
                for r in rows_:
                    due = False
                    if r.get("external_status") == "live":
                        due = True
                    elif r.get("tipoff_at"):
                        try:
                            t = datetime.fromisoformat(str(r["tipoff_at"]).replace("Z", "+00:00"))
                            due = (t - now).total_seconds() < 20 * 60 and (now - t).total_seconds() < 4 * 3600
                        except ValueError:
                            due = False
                    if due:
                        games.append(ScheduleGame(external_id=str(r["external_id"]), home_name=r.get("home_name") or "", away_name=r.get("away_name") or "",
                                                  tipoff_at=r.get("tipoff_at"), status=r.get("external_status") or "scheduled"))
                if not games:
                    print("   no live or due games"); continue
                print(f"   {len(games)} live/due game(s): " + ", ".join(f"{g.home_name or g.external_id} v {g.away_name}" for g in games[:6]))
            else:
                games = list(adapter.discover(src["schedule_url"], dict(src.get("adapter_config", {}), code=src.get("code"))))
                if sb and not args.dry_run:
                    try:
                        sync_logos(sb, src, games, run)
                    except Exception as exc:
                        print(f"   (crests: {exc})")
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
            # schedule facts for every game (dates, venues, clubs) even before the feed publishes a payload
            for g in games:
                if g.tipoff_at or g.home_name:
                    entries[g.external_id] = sched_entry(g, entries.get(g.external_id))
                    if sb and not args.dry_run and not entries[g.external_id].get("hash"):
                        try:
                            write_fixture(sb, src, g, run)
                            sb.upsert("external_games", {"adapter": src["adapter"], "external_id": g.external_id, "competition_code": src["code"],
                                                         "home_name": g.home_name or None, "away_name": g.away_name or None,
                                                         "external_status": g.status or "scheduled", "tipoff_at": g.tipoff_at,
                                                         "game_date": (g.tipoff_at or "")[:10] or None}, "adapter,external_id")
                        except Exception as exc:
                            print(f"    (fixture {g.external_id}: {exc})")
            live_set = []
            for g in todo:
                try:
                    b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
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
                        write_test_fixture(Path(args.fixture_out), src, b)
                    continue
                raw_ref = None
                if sb:
                    try:
                        raw_ref = write_supabase_feed(sb, src, b, entry_for(b, prev, None, g))
                    except Exception as exc:
                        print(f"    (supabase feed write failed: {exc})")
                entry = entry_for(b, prev, raw_ref, g)
                if feed:
                    feed.write_game(src["code"], b)
                entries[g.external_id] = entry
                if sb:
                    try:
                        write_platform(sb, src, b, run)
                    except Exception as exc:
                        print(f"    (platform write failed: {exc})")
                if args.fixture_out:
                    write_test_fixture(Path(args.fixture_out), src, b)
                run["games_written"] += 1
                if b.status == "live":
                    live_set.append(g)
                print(f"    + {b.home_name} {entry['homeScore']}-{entry['awayScore']} {b.away_name} ({b.status}, {len(b.stints)} stints)")
            # LIVE LOOP: keep the in-progress games moving every --live-every seconds until the budget
            # runs out or every one of them has finished (then the next scheduled pass takes over)
            deadline = time.time() + max(0, args.live_loop)
            while args.live_loop and live_set and time.time() < deadline and not args.dry_run:
                time.sleep(args.live_every)
                still = []
                for g in live_set:
                    try:
                        b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
                    except Exception as exc:
                        print(f"    ! {g.external_id}: {exc}"); still.append(g); continue
                    if not b:
                        still.append(g); continue
                    prev = entries.get(g.external_id)
                    if prev and prev.get("hash") == b.payload_hash:
                        still.append(g); continue                     # nothing new on the feed yet
                    raw_ref = None
                    if sb:
                        try:
                            raw_ref = write_supabase_feed(sb, src, b, entry_for(b, prev, None, g))
                        except Exception as exc:
                            print(f"    (supabase feed write failed: {exc})")
                    entries[g.external_id] = entry_for(b, prev, raw_ref, g)
                    if sb:
                        try:
                            write_platform(sb, src, b, run)
                        except Exception as exc:
                            print(f"    (platform write failed: {exc})")
                    print(f"    ~ {b.home_name} {entries[g.external_id]['homeScore']}-{entries[g.external_id]['awayScore']} {b.away_name} ({b.status}) {datetime.now(timezone.utc).strftime('%H:%M:%S')}")
                    if b.status == "live":
                        still.append(g)
                live_set = still
            if not args.dry_run:
                # games moved between phases: both tables are rebuilt, as the console does
                for cid in sorted(run.pop("_recompute", set()) or []):
                    for fn in ("recompute_standings", "compute_season_awards", "advance_bracket"):
                        try:
                            sb.rpc(fn, {"p_competition": cid})
                        except Exception:
                            pass
                if feed and not args.live_only:
                    feed.update_index(src, {k: v for k, v in entries.items() if v.get("hash") or v.get("date")})
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
    # discovery is done - if a game is live or tips soon, ask the workflow to start the live lane
    if sb and not args.dry_run and not args.ids:
        try:
            now = datetime.now(timezone.utc)
            due, next_tip = live_due(sb, [s for s in sources if s["adapter"] == "fiba_livestats"], now)
            chain = bool(due) or (next_tip is not None and (next_tip - now).total_seconds() < MAIN_CHAIN_AHEAD)
            gh_output(chain="true" if chain else "false")
            if chain:
                print(f"{len(due)} live/due game(s)" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") + " - asking the workflow to start the live lane")
        except Exception as exc:
            print(f"(live-lane check failed: {exc})")
    return exit_code


def write_test_fixture(d: Path, src: dict, b: GameBundle) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{b.external_id}.json").write_text(json.dumps({
        "external_id": b.external_id, "adapter": src["adapter"], "status": b.status, "home_name": b.home_name, "away_name": b.away_name,
        "tipoff_at": b.tipoff_at, "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
        "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition, "pbp": b.pbp}, ensure_ascii=False), encoding="utf-8")
    if b.raw is not None:
        (d / f"{b.external_id}.raw.json").write_text(json.dumps(b.raw, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
