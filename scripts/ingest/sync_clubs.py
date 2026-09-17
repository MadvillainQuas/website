#!/usr/bin/env python3
"""
sync_clubs.py — a fed league's clubs, feed codes and crests for the season, before a ball is thrown.

The ingest worker (run_ingest.py) takes a club's crest from the hosted schedule, keyed by the club's
feed code. Some clients publish their schedule with no codes at all (Super League Basketball, men and
women), so a new season would open with fixtures between clubs that have no crest, a slug for a code
and a short name cut from that slug, until each club's first game. The live-stats PREVIEW page of an
upcoming game already carries what the game feed will use:

    fibalivestats.dcd.shared.geniussports.com/u/<CLIENT>/<gameId>/
      both clubs' feed codes (BRI, LON), their crests and their names (home first)

For every registry source (config/ingest-sources.json) whose adapter_config has "sync_clubs": true,
this reads the season's competitions exactly as the worker does (expand_competition_sources), makes
or finds the league and each competition, reads as few preview pages as cover every club, and makes
or finds each club under the code the game feed will use, so the first game lands on the same club.
A crest Genius has changed replaces the old one; a crest an admin uploaded is never replaced.

Players are NOT taken from here. Genius's hosted roster pages still list last season's squads before
the season starts, so rosters and head shots come from the game feed as games are played
(Platform.ensure_game_people, called by the worker for every fed game).

    python scripts/ingest/sync_clubs.py                   # every source with adapter_config.sync_clubs
    python scripts/ingest/sync_clubs.py --source SLBW
    python scripts/ingest/sync_clubs.py --dry-run         # read the pages and print; write nothing

Needs SUPABASE_URL + SUPABASE_SERVICE_KEY unless --dry-run. Runs daily from
.github/workflows/clubs.yml, before the worker's first discovery pass of the day.
"""
from __future__ import annotations

import argparse
import html as htmllib
import os
import re
import sys
import time
from pathlib import Path

import requests

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_ingest as RI  # noqa: E402
from feedplatform import Platform, season_name_for  # noqa: E402

LIVESTATS = "https://fibalivestats.dcd.shared.geniussports.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
GAP_S = 0.3          # the worker's politeness: one request at a time, 300 ms apart
_last = [0.0]


def get(url: str) -> str | None:
    wait = GAP_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
    except requests.RequestException as exc:
        print(f"     (fetch failed {url[:90]}: {exc})")
        return None
    return r.text if r.status_code == 200 else None


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


# ------------------------------------------------------------------ parsers (text in, dicts out)
_BLOCK = re.compile(r'<div class="match-wrap([^"]*)"\s+id\s*=\s*"extfix_(\d{5,10})"(.*?)(?=<div class="match-wrap|\Z)', re.S)
_SIDE = re.compile(r'class="(home|away)-team">(.*?)(?=class="(?:home|away)-team">|\Z)', re.S)


def fixture_teams(html: str) -> dict[str, dict]:
    """Each fixture on a hosted schedule page -> its clubs' hosted team ids and names:
    {gameId: {'status': 'scheduled'|'final'|'live', 'home': {'team_id', 'name'}, 'away': {...}}}.
    A fixture still waiting on a qualifier (no team link on one side) is left out."""
    out = {}
    for m in _BLOCK.finditer(html or ""):
        classes, gid, body = m.group(1), m.group(2), m.group(3)
        status = "final" if "COMPLETE" in classes else ("live" if ("INPROGRESS" in classes or "LIVE" in classes.upper()) else "scheduled")
        row = {"status": status}
        for sm in _SIDE.finditer(body):
            tid = re.search(r"/team/(\d+)", sm.group(2))
            name = re.search(r'team-name-full">([^<]*)<', sm.group(2))
            row[sm.group(1)] = {"team_id": tid.group(1) if tid else None, "name": _text(name.group(1)) if name else ""}
        if row.get("home", {}).get("team_id") and row.get("away", {}).get("team_id"):
            out[gid] = row
    return out


def parse_preview(html: str) -> dict | None:
    """The live-stats page of a game not yet played: both clubs' feed codes, crests and names.
    Returns {'1': {'code', 'logo', 'name'}, '2': {...}, 'competition'}, or None when the page carries
    no codes (a played game's page fills itself in by script and has none in its markup)."""
    codes = dict(re.findall(r'id\s*=\s*"aj_([12])_shortName"\s*>([^<]*)<', html or ""))
    if not (codes.get("1", "").strip() and codes.get("2", "").strip()):
        return None
    logos = dict(re.findall(r'class\s*=\s*"id_aj_([12])_logoT"\s*>\s*<img\s+src\s*=\s*"([^"]+)"', html))
    names = re.search(r'upcoming-match-teams"\s*>\s*<h2[^>]*>(.*?)<span>\s*vs\s*</span>(.*?)</h2>', html, re.S)
    comp = re.search(r"dimension5'\s*,\s*\"([^\"]*)\"", html)
    out = {"competition": comp.group(1).strip() if comp else None}
    for k in ("1", "2"):
        logo = (logos.get(k) or "").strip()
        out[k] = {"code": codes[k].strip(), "logo": logo if logo.startswith("https://") else None,
                  "name": _text(names.group(int(k))) if names else ""}
    return out


def client_of(src: dict) -> str | None:
    ac = src.get("adapter_config") or {}
    if ac.get("client_code"):
        return ac["client_code"]
    m = re.search(r"geniussports\.com/([A-Za-z0-9_]+)/en/", src.get("schedule_url") or "")
    return m.group(1) if m else None


def club_idents(fixtures: dict[str, dict], names: dict[str, str], client: str, fetch=get) -> dict[str, dict]:
    """Feed code + crest per hosted team id, from as few upcoming games' preview pages as cover
    every club. A page whose names disagree with the schedule's (home/away order not holding) is
    not used."""
    idents: dict[str, dict] = {}
    for gid, row in fixtures.items():
        if all(t in idents for t in names):
            break
        if row["status"] != "scheduled":
            continue
        h, a = row["home"]["team_id"], row["away"]["team_id"]
        if h in idents and a in idents:
            continue
        pv = parse_preview(fetch(f"{LIVESTATS}/u/{client}/{gid}/") or "")
        if not pv:
            continue
        wrong = [(pv[k]["name"], names[tid]) for k, tid in (("1", h), ("2", a))
                 if pv[k]["name"] and names.get(tid) and pv[k]["name"].lower() != names[tid].lower()]
        if wrong:
            print(f"     (preview {gid}: '{wrong[0][0]}' is not '{wrong[0][1]}' - not used)")
            continue
        for k, tid in (("1", h), ("2", a)):
            idents.setdefault(tid, pv[k])
    return idents


# ------------------------------------------------------------------ one league
def sync_league(sb, code: str, comps: list[dict], dry: bool) -> dict:
    head = comps[0]
    ac = head.get("adapter_config") or {}
    client = client_of(head)
    run: dict = {}
    if dry:
        run["_platform"] = Platform(None, dry=True, auto_create=True)
        league_id = f"dry-league-{code}"
    else:
        league_id = RI.resolve_league(sb, head, run)
        if not league_id:
            print(f"   {code}: no league (set create_league or league_id in the registry) - skipped")
            return {}
    plat: Platform = run["_platform"]
    plat.season(league_id, ac.get("season") or season_name_for())

    fixtures: dict[str, dict] = {}
    comp_teams: dict[str, tuple[dict, set]] = {}
    names: dict[str, str] = {}
    for src in comps:
        fx = fixture_teams(get(src["schedule_url"]) or "")
        label = src.get("competition_label") or src.get("label") or code
        print(f"   {label}: {len(fx)} fixture(s)")
        tids = comp_teams.setdefault(label, (src, set()))[1]
        for gid, row in fx.items():
            fixtures.setdefault(gid, row)
            for side in ("home", "away"):
                tids.add(row[side]["team_id"])
                names.setdefault(row[side]["team_id"], row[side]["name"])

    idents = club_idents(fixtures, names, client)
    teams: dict[str, dict] = {}
    for tid, name in sorted(names.items(), key=lambda kv: kv[1]):
        ident = idents.get(tid) or {}
        t_in = {"code": ident.get("code") or "", "name": name}
        if ident.get("logo"):
            t_in["logoT"] = {"url": ident["logo"]}
        team = plat.team(league_id, t_in)
        if not team:
            continue
        teams[tid] = team
        logo, lp = ident.get("logo"), (team.get("logo_path") or "")
        if logo and not dry and lp != logo and (not lp or lp.startswith("{") or lp.startswith("https://images.statsengine")):
            # no crest yet, or one Genius has since changed; a crest an admin uploaded (a storage path) is never replaced
            cur = sb.select("teams", f"id=eq.{team['id']}&select=colour_source")
            upd = {"logo_path": logo}
            if lp and cur and cur[0].get("colour_source") == "logo":
                upd["colour_source"] = "default"      # the colour sweep reads the new crest
            sb.patch("teams", f"id=eq.{team['id']}", upd)
            team["logo_path"] = logo
            print(f"   crest {'updated' if lp else 'added'}: {name}")
        print(f"   club {name} [{ident.get('code') or 'no code yet'}]" + ("" if ident.get("logo") else " (no crest yet)"))

    for label, (src, tids) in comp_teams.items():
        if dry:
            continue
        comp = RI.source_competition(sb, plat, src, league_id, ac)
        for tid in tids:
            if tid in teams:
                sb.upsert("competition_teams", {"competition_id": comp["id"], "team_id": teams[tid]["id"]}, "competition_id,team_id")
    return {"clubs": len(teams), "coded": sum(1 for t in names if t in idents), "created": dict(plat.created)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="code of one registry source")
    ap.add_argument("--dry-run", action="store_true", help="read every page and print; write nothing")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = None
    if not args.dry_run:
        if not (url and key):
            print("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (or pass --dry-run)")
            return 2
        sb = RI.Supabase(url, key)

    sources = [s for s in RI.load_sources(None, True, args.source)
               if s.get("adapter") == "fiba_livestats" and (s.get("adapter_config") or {}).get("sync_clubs")]
    if not sources:
        print("no registry source has adapter_config.sync_clubs")
        return 0
    by_code: dict[str, list] = {}
    for s in RI.expand_competition_sources(sources):
        by_code.setdefault(s["code"], []).append(s)

    rc = 0
    for code, comps in by_code.items():
        print(f"-> {code}: {len(comps)} competition(s)")
        try:
            res = sync_league(sb, code, comps, args.dry_run)
            if res:
                print(f"   {code}: {res['clubs']} club(s), {res['coded']} with a feed code; created {res['created']}")
        except Exception as exc:
            print(f"   {code} failed: {exc}")
            rc = 1
    if sb:
        try:
            import team_colours
            c = team_colours.sweep(sb, log=lambda m: print(m))
            if c:
                print(f"{c} club(s) coloured from their crest")
        except Exception as exc:
            print(f"(colours: {exc})")
    return rc


if __name__ == "__main__":
    sys.exit(main())
