"""
platform.py — everything the worker needs to make a fed game a real Epinoia
game: league / season / competition / club / player / roster creation from a
FIBA payload, with identity rules that never guess.

  team   : teams.external_ids.fiba_livestats == tm.code  → else exact / alias name
           on the same league → else CREATE (when auto_create) → else unmatched
  player : players.external_ids.fiba_livestats == "<teamcode>:<pno>" → else exact
           full-name / alias match on that team's roster → else CREATE → else unmatched

(named feedplatform so it never shadows the stdlib platform module)
Used by bootstrap_league.py (one-off, whole archive) and by run_ingest.write_platform
(per game, so a league connected from the Epinoia console fills itself in as games arrive).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone


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


def season_name_for(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now.year}-{str(now.year + 1)[2:]}" if now.month >= 8 else f"{now.year - 1}-{str(now.year)[2:]}"


class Platform:
    """Thin, idempotent creator over the Supabase REST client (service role)."""

    def __init__(self, sb, dry: bool = False, auto_create: bool = True, log=print):
        self.sb, self.dry, self.auto_create, self.log = sb, dry, auto_create, log
        self.created: dict[str, int] = {}
        self.cache: dict = {"team": {}, "player": {}, "roster": set()}

    # -- primitives ---------------------------------------------------------------
    def one(self, table, query):
        rows = self.sb.select(table, query + "&limit=1") if self.sb else []
        return rows[0] if rows else None

    def insert(self, table, row, on_conflict="id"):
        self.created[table] = self.created.get(table, 0) + 1
        if self.dry or not self.sb:
            return {**row, "id": f"dry-{table}-{self.created[table]}"}
        return self.sb.upsert(table, row, on_conflict)[0]

    # -- league / season / competition ------------------------------------------
    def league(self, code: str, name: str, slug: str | None = None) -> dict:
        slug = slug or slugify(code)
        r = self.one("leagues", f"slug=eq.{slug}&select=id,slug,name")
        if r:
            return r
        self.log(f"  + league {slug} ({name})")
        return self.insert("leagues", {"slug": slug, "name": name, "public_live": True, "youth_protected": False})

    def season(self, league_id: str, name: str) -> dict:
        r = self.one("seasons", f"league_id=eq.{league_id}&name=eq.{name}&select=id,name")
        if r:
            return r
        y = re.match(r"(\d{4})", name)
        self.log(f"  + season {name}")
        return self.insert("seasons", {"league_id": league_id, "name": name,
                                       "starts_on": f"{y.group(1)}-09-01" if y else None,
                                       "ends_on": f"{int(y.group(1)) + 1}-06-30" if y else None}, "league_id,name")

    def competition(self, season_id: str, name: str) -> dict:
        r = self.one("competitions", f"season_id=eq.{season_id}&name=eq.{name}&select=id,name")
        if r:
            return r
        self.log(f"  + competition {name}")
        return self.insert("competitions", {"season_id": season_id, "name": name, "kind": "league"}, "season_id,name")

    def ensure_competition(self, league_id: str, label: str, season_name: str | None = None) -> dict:
        s = self.season(league_id, season_name or season_name_for())
        return self.competition(s["id"], label)

    # -- clubs + people -----------------------------------------------------------
    def team(self, league_id: str, t: dict) -> dict | None:
        code = (t.get("code") or "").strip() or slugify(t.get("name", ""))
        key = (league_id, code)
        if key in self.cache["team"]:
            return self.cache["team"][key]
        r = self.one("teams", f"league_id=eq.{league_id}&external_ids->>fiba_livestats=eq.{code}&select=id,slug,name")
        if not r:
            nm = (t.get("name") or "").strip().lower()
            for row in (self.sb.select("teams", f"league_id=eq.{league_id}&select=id,slug,name,aliases") if self.sb else []):
                names = {row["name"].strip().lower()} | {a.strip().lower() for a in (row.get("aliases") or [])}
                if nm in names:
                    r = row
                    if not self.dry:
                        self.sb.patch("teams", f"id=eq.{row['id']}", {"external_ids": {"fiba_livestats": code}})
                    break
        if not r and self.auto_create:
            self.log(f"  + team {t.get('name')} [{code}]")
            r = self.insert("teams", {"league_id": league_id, "slug": slugify(t.get("name", code)), "name": (t.get("name") or code).strip(),
                                      "short_name": (t.get("shortName") or code)[:12], "logo_path": t.get("logoT") or t.get("logo"),
                                      "external_ids": {"fiba_livestats": code},
                                      "aliases": [t["nameInternational"]] if t.get("nameInternational") and t["nameInternational"] != t.get("name") else []})
        self.cache["team"][key] = r
        return r

    def player(self, team: dict, team_code: str, pno: str, p: dict) -> dict | None:
        ext = f"{team_code}:{pno}"
        if ext in self.cache["player"]:
            return self.cache["player"][ext]
        r = self.one("players", f"external_ids->>fiba_livestats=eq.{ext}&select=id,slug,first_name,last_name")
        first, last = full_name(p)
        if not r and self.sb:
            for row in self.sb.select("roster_entries", f"team_id=eq.{team['id']}&select=player_id,players(id,slug,first_name,last_name,aliases)"):
                pl = row.get("players") or {}
                names = {(pl.get("first_name", "") + " " + pl.get("last_name", "")).strip().lower()} | {a.strip().lower() for a in (pl.get("aliases") or [])}
                if (first + " " + last).strip().lower() in names:
                    r = pl
                    if not self.dry:
                        self.sb.patch("players", f"id=eq.{pl['id']}", {"external_ids": {"fiba_livestats": ext}})
                    break
        if not r and self.auto_create:
            aliases = [a for a in {p.get("name"), p.get("scoreboardName")} if a and a != (first + " " + last).strip()]
            r = self.insert("players", {"slug": f"{team['slug']}-{slugify(first + ' ' + last)}", "first_name": first or "?", "last_name": last,
                                        "is_minor": False, "external_ids": {"fiba_livestats": ext}, "aliases": aliases}, "slug")
        self.cache["player"][ext] = r
        return r

    def roster(self, team: dict, player: dict, season_id: str, p: dict) -> None:
        key = (team["id"], player["id"], season_id)
        if key in self.cache["roster"]:
            return
        self.cache["roster"].add(key)
        if self.one("roster_entries", f"team_id=eq.{team['id']}&player_id=eq.{player['id']}&season_id=eq.{season_id}&select=id"):
            return
        self.insert("roster_entries", {"team_id": team["id"], "player_id": player["id"], "season_id": season_id,
                                       "jersey": str(p.get("shirtNumber") or ""), "position": p.get("playingPosition") or None, "active": True})

    def ensure_game_people(self, league_id: str, comp: dict, season_id: str, raw: dict) -> dict:
        """Both clubs + every listed player of one payload. Returns {'1': team, '2': team, 'pids': {ext: uuid}}."""
        out = {"pids": {}}
        for k in ("1", "2"):
            t = (raw.get("tm") or {}).get(k) or {}
            team = self.team(league_id, t)
            out[k] = team
            if not team:
                continue
            if not self.dry and self.sb:
                self.sb.upsert("competition_teams", {"competition_id": comp["id"], "team_id": team["id"]}, "competition_id,team_id")
            tcode = (t.get("code") or "").strip() or slugify(t.get("name", ""))
            for pno, p in (t.get("pl") or {}).items():
                pl = self.player(team, tcode, str(pno), p)
                if pl:
                    self.roster(team, pl, season_id, p)
                    out["pids"][f"{tcode}:{pno}"] = pl["id"]
        return out
