#!/usr/bin/env python3
"""
bootstrap_league.py — roadmap Phase A: create a league's static facets in
Supabase from the feed archive, so the Epinoia site shows clubs, rosters and a
fixture list BEFORE a single game is translated.

Reads data/feed/<CODE>/games/*.json (the archived FIBA payloads) and writes,
idempotently, with the service key:

  leagues       one per code (slug from the code; --league-slug to override)
  seasons       one per --season (default: the current YYYY-YY)
  competitions  one per --competition (default: the source label)
  teams         one per distinct tm[].name → slug from name, external_ids.fiba_livestats = code
  players       one per distinct (team, pno) → external_ids.fiba_livestats = "<teamcode>:<pno>",
                slug = <team-slug>-<first>-<last>, aliases = [FIBA short name]
  roster_entries one per (team, player, season) with jersey + position
  competition_teams
  games         scheduled rows (home/away, status from the payload) linked in external_games

Identity rules (never guess):
  team   : external_ids.fiba_livestats == tm.code, else exact/alias name match, else CREATE
  player : external_ids.fiba_livestats == "<teamcode>:<pno>", else exact full-name match on the same team, else CREATE
A created row is reported so a wrong split can be fixed by adding an alias.

    python scripts/ingest/bootstrap_league.py --source SLB --season 2025-26 --dry-run
    python scripts/ingest/bootstrap_league.py --source SLB --season 2025-26

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (service role — this bypasses RLS on purpose;
the platform's own create_league() needs a signed-in platform admin). Migration 0096 adds the
aliases / external_ids columns this relies on.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_ingest import Supabase, CONFIG_PATH, FEED_DIR, now_iso  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s) or "x"


def full_name(p: dict) -> tuple[str, str]:
    first = (p.get("firstName") or p.get("internationalFirstName") or "").strip()
    last = (p.get("familyName") or p.get("internationalFamilyName") or "").strip()
    if not (first or last):
        parts = (p.get("name") or "").replace(".", "").split()
        first, last = (parts[0], " ".join(parts[1:])) if parts else ("", "")
    return first, last


class Bootstrap:
    def __init__(self, sb: Supabase | None, dry: bool):
        self.sb, self.dry = sb, dry
        self.created = {"leagues": 0, "seasons": 0, "competitions": 0, "teams": 0, "players": 0, "roster_entries": 0, "games": 0}

    # -- generic helpers -------------------------------------------------------------
    def one(self, table, query):
        rows = self.sb.select(table, query + "&limit=1") if self.sb else []
        return rows[0] if rows else None

    def insert(self, table, row, on_conflict=None):
        self.created[table] = self.created.get(table, 0) + 1
        if self.dry or not self.sb:
            return {**row, "id": f"dry-{table}-{self.created[table]}"}
        return self.sb.upsert(table, row, on_conflict or "id")[0]

    # -- facets ----------------------------------------------------------------------
    def league(self, code: str, name: str, slug: str) -> dict:
        r = self.one("leagues", f"slug=eq.{slug}&select=id,slug,name")
        if r:
            return r
        print(f"  + league {slug} ({name})")
        return self.insert("leagues", {"slug": slug, "name": name, "public_live": True, "youth_protected": False})

    def season(self, league_id: str, name: str) -> dict:
        r = self.one("seasons", f"league_id=eq.{league_id}&name=eq.{name}&select=id,name")
        if r:
            return r
        y = re.match(r"(\d{4})", name)
        starts = f"{y.group(1)}-09-01" if y else None
        ends = f"{int(y.group(1)) + 1}-06-30" if y else None
        print(f"  + season {name}")
        return self.insert("seasons", {"league_id": league_id, "name": name, "starts_on": starts, "ends_on": ends}, "league_id,name")

    def competition(self, season_id: str, name: str) -> dict:
        r = self.one("competitions", f"season_id=eq.{season_id}&name=eq.{name}&select=id,name")
        if r:
            return r
        print(f"  + competition {name}")
        return self.insert("competitions", {"season_id": season_id, "name": name, "kind": "league"}, "season_id,name")

    def team(self, league_id: str, t: dict, cache: dict) -> dict:
        code = (t.get("code") or "").strip() or slugify(t.get("name", ""))
        if code in cache:
            return cache[code]
        r = self.one("teams", f"league_id=eq.{league_id}&external_ids->>fiba_livestats=eq.{code}&select=id,slug,name")
        if not r:
            nm = (t.get("name") or "").strip()
            rows = self.sb.select("teams", f"league_id=eq.{league_id}&select=id,slug,name,aliases") if self.sb else []
            for row in rows:
                names = {row["name"].strip().lower()} | {a.strip().lower() for a in (row.get("aliases") or [])}
                if nm.lower() in names:
                    r = row
                    if not self.dry:
                        self.sb.patch("teams", f"id=eq.{row['id']}", {"external_ids": {"fiba_livestats": code}})
                    break
        if not r:
            slug = slugify(t.get("name", code))
            print(f"  + team {t.get('name')} [{code}] → {slug}")
            r = self.insert("teams", {"league_id": league_id, "slug": slug, "name": t.get("name", code).strip(),
                                      "short_name": (t.get("shortName") or code)[:12], "logo_path": t.get("logoT") or t.get("logo"),
                                      "external_ids": {"fiba_livestats": code}, "aliases": [t.get("nameInternational")] if t.get("nameInternational") and t.get("nameInternational") != t.get("name") else []})
        cache[code] = r
        return r

    def player(self, team: dict, team_code: str, pno: str, p: dict, cache: dict) -> dict:
        ext = f"{team_code}:{pno}"
        if ext in cache:
            return cache[ext]
        r = self.one("players", f"external_ids->>fiba_livestats=eq.{ext}&select=id,slug,first_name,last_name")
        first, last = full_name(p)
        if not r and self.sb:
            rows = self.sb.select("roster_entries", f"team_id=eq.{team['id']}&select=player_id,players(id,slug,first_name,last_name,aliases)")
            for row in rows:
                pl = row.get("players") or {}
                names = {(pl.get("first_name", "") + " " + pl.get("last_name", "")).strip().lower()} | {a.strip().lower() for a in (pl.get("aliases") or [])}
                if (first + " " + last).strip().lower() in names:
                    r = pl
                    if not self.dry:
                        self.sb.patch("players", f"id=eq.{pl['id']}", {"external_ids": {"fiba_livestats": ext}})
                    break
        if not r:
            slug = f"{team['slug']}-{slugify(first + ' ' + last)}"
            aliases = [a for a in {p.get("name"), p.get("scoreboardName")} if a and a != (first + " " + last).strip()]
            r = self.insert("players", {"slug": slug, "first_name": first or "?", "last_name": last, "is_minor": False,
                                        "external_ids": {"fiba_livestats": ext}, "aliases": aliases}, "slug")
        cache[ext] = r
        return r

    def roster(self, team: dict, player: dict, season_id: str, p: dict, seen: set) -> None:
        key = (team["id"], player["id"], season_id)
        if key in seen:
            return
        seen.add(key)
        r = self.one("roster_entries", f"team_id=eq.{team['id']}&player_id=eq.{player['id']}&season_id=eq.{season_id}&select=id")
        if r:
            return
        self.insert("roster_entries", {"team_id": team["id"], "player_id": player["id"], "season_id": season_id,
                                       "jersey": str(p.get("shirtNumber") or ""), "position": p.get("playingPosition") or None, "active": True})

    def game(self, comp_id: str, home: dict, away: dict, ext_id: str, adapter: str, status: str, hs: int, as_: int, date) -> None:
        r = self.one("external_games", f"adapter=eq.{adapter}&external_id=eq.{ext_id}&select=game_id")
        if r and r.get("game_id"):
            return
        st = "final" if status == "final" else ("live" if status == "live" else "scheduled")
        g = self.insert("games", {"competition_id": comp_id, "home_team_id": home["id"], "away_team_id": away["id"],
                                  "status": st, "home_score": hs, "away_score": as_, "tipoff_at": date})
        if not self.dry and self.sb:
            self.sb.upsert("external_games", {"adapter": adapter, "external_id": ext_id, "game_id": g["id"], "home_name": home["name"], "away_name": away["name"]}, "adapter,external_id")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--season", default=None, help="season name, e.g. 2025-26 (default: current)")
    ap.add_argument("--competition", default=None, help="competition name (default: source label)")
    ap.add_argument("--league-slug", default=None)
    ap.add_argument("--league-name", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    src = next((s for s in cfg["sources"] if s.get("code") == args.source or s.get("label") == args.source), None)
    if not src:
        raise SystemExit(f"no source {args.source}")
    code = src["code"]
    now = datetime.now(timezone.utc)
    season_name = args.season or (f"{now.year}-{str(now.year + 1)[2:]}" if now.month >= 8 else f"{now.year - 1}-{str(now.year)[2:]}")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = Supabase(url, key) if (url and key) else None
    if not sb and not args.dry_run:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (or pass --dry-run)")
    B = Bootstrap(sb, args.dry_run)

    archive = FEED_DIR / code / "games"
    files = sorted(archive.glob("*.json")) if archive.exists() else []
    index = {str(g["id"]): g for g in json.loads((FEED_DIR / code / "index.json").read_text(encoding="utf-8")).get("games", [])} if (FEED_DIR / code / "index.json").exists() else {}
    print(f"-> {code}: {len(files)} archived payloads; season {season_name}")

    league = B.league(code, args.league_name or src.get("label", code), args.league_slug or slugify(code))
    season = B.season(league["id"], season_name)
    comp = B.competition(season["id"], args.competition or src.get("label", code))

    teams, players, roster_seen = {}, {}, set()
    for f in files:
        raw = json.loads(f.read_text(encoding="utf-8"))
        tm = raw.get("tm") or {}
        sides = {}
        for k in ("1", "2"):
            t = tm.get(k) or {}
            team = B.team(league["id"], t, teams)
            sides[k] = team
            if not B.dry and B.sb:
                B.sb.upsert("competition_teams", {"competition_id": comp["id"], "team_id": team["id"]}, "competition_id,team_id")
            tcode = (t.get("code") or "").strip() or slugify(t.get("name", ""))
            for pno, p in (t.get("pl") or {}).items():
                pl = B.player(team, tcode, str(pno), p, players)
                B.roster(team, pl, season["id"], p, roster_seen)
        g = index.get(f.stem, {})
        status = g.get("status") or ("final" if any(e.get("actionType") == "game" and e.get("subType") == "end" for e in raw.get("pbp") or []) else "scheduled")
        B.game(comp["id"], sides["1"], sides["2"], f.stem, src["adapter"], status, int(g.get("homeScore") or 0), int(g.get("awayScore") or 0), g.get("date"))

    print("created:", {k: v for k, v in B.created.items() if v})
    print(f"   {len(teams)} teams, {len(players)} players seen" + (" (dry run — nothing written)" if args.dry_run else ""))
    if not args.dry_run and sb:
        # remember the league on the source so run_ingest writes platform rows from now on
        sb.upsert("feed_competitions", {"code": code, "label": src.get("label", code), "adapter": src["adapter"], "league_id": league["id"], "updated_at": now_iso()}, "code")
        print(f"   feed_competitions.{code}.league_id = {league['id']}  → put this in config/ingest-sources.json as league_id, and competition_id = {comp['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
