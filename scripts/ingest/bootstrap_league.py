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
from feedplatform import Platform, slugify, season_name_for  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass



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
    season_name = args.season or season_name_for(now)
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = Supabase(url, key) if (url and key) else None
    if not sb and not args.dry_run:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (or pass --dry-run)")
    B = Platform(sb, dry=args.dry_run, auto_create=True)

    archive = FEED_DIR / code / "games"
    files = sorted(archive.glob("*.json")) if archive.exists() else []
    index = {str(g["id"]): g for g in json.loads((FEED_DIR / code / "index.json").read_text(encoding="utf-8")).get("games", [])} if (FEED_DIR / code / "index.json").exists() else {}
    print(f"-> {code}: {len(files)} archived payloads; season {season_name}")

    league = B.league(code, args.league_name or src.get("label", code), args.league_slug or slugify(code))
    season = B.season(league["id"], season_name)
    comp = B.competition(season["id"], args.competition or src.get("label", code))

    for f in files:
        raw = json.loads(f.read_text(encoding="utf-8"))
        people = B.ensure_game_people(league["id"], comp, season["id"], raw)
        g = index.get(f.stem, {})
        status = g.get("status") or ("final" if any(e.get("actionType") == "game" and e.get("subType") == "end" for e in raw.get("pbp") or []) else "scheduled")
        h, a = people.get("1"), people.get("2")
        if h and a:
            ext = B.one("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{f.stem}&select=game_id")
            if not (ext and ext.get("game_id")):
                st = "final" if status == "final" else ("live" if status == "live" else "scheduled")
                gm = B.insert("games", {"competition_id": comp["id"], "home_team_id": h["id"], "away_team_id": a["id"], "status": st,
                                        "home_score": int(g.get("homeScore") or 0), "away_score": int(g.get("awayScore") or 0), "tipoff_at": g.get("date")})
                if not B.dry and sb:
                    sb.upsert("external_games", {"adapter": src["adapter"], "external_id": f.stem, "game_id": gm["id"], "home_name": h["name"], "away_name": a["name"]}, "adapter,external_id")
    teams, players = B.cache["team"], B.cache["player"]
    print("created:", {k: v for k, v in B.created.items() if v})
    print(f"   {len(teams)} teams, {len(players)} players seen" + (" (dry run — nothing written)" if args.dry_run else ""))
    if not args.dry_run and sb:
        # remember the league on the source so run_ingest writes platform rows from now on
        sb.upsert("feed_competitions", {"code": code, "label": src.get("label", code), "adapter": src["adapter"], "league_id": league["id"], "updated_at": now_iso()}, "code")
        print(f"   feed_competitions.{code}.league_id = {league['id']}  → put this in config/ingest-sources.json as league_id, and competition_id = {comp['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
