"""EuroLeague — its own API, shaped into the payload the platform already reads.

THREE FEEDS PER GAME, which is what the scraper has always used (LINEUPDATASCRAPE
fetch_euroleague_game_via_api):

    live.euroleague.net/api/Boxscore?gamecode=&seasoncode=     the box score
    live.euroleague.net/api/PlayByPlay?gamecode=&seasoncode=   team names and codes, mixed case
    live.euroleague.net/api/Points?gamecode=&seasoncode=       the shot chart (optional)

and one feed for the whole season's schedule, which also carries the crests:

    feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/E<year>/games

THE SEASON IS E + THE START YEAR. E2026 is 2026-27, and the platform's own season name is the only
thing every source here agrees on, so it is derived from that rather than configured.

WHAT IS NOT PORTED, and why. The scraper's EuroLeague path also repairs the play-by-play's
substitution stream (the operators emit the IN before the matching OUT, leaving six men on court)
and splits extra time by minute. That work exists to build STINTS, and stints are built here by the
same pipeline the FIBA leagues use, off the same payload — so if it is ever wired up it is wired up
once, for every league, rather than again for this one. The box score, the shot zones, the clubs
and the players need none of it.

THE SHOT CHART is the reason the Points feed is worth a third request: EuroLeague coordinates are
centimetres from the basket, and fibashape.at_rim_offset turns them into the chart percentages the
rim/mid/three split is measured in. A Points failure degrades to no shot chart, never to no game.
"""
from __future__ import annotations

import re
import time
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"
SCHEDULE = ("https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/"
            "{comp}/seasons/{season}/games?limit=500")
LIVE = "https://live.euroleague.net/api/{feed}?gamecode={code}&seasoncode={season}"

# Boxscore player row -> the FIBA stat names. Everything the pipeline reads, nothing it does not.
PLAYER_STATS = {
    "sPoints": "Points",
    "sTwoPointersMade": "FieldGoalsMade2", "sTwoPointersAttempted": "FieldGoalsAttempted2",
    "sThreePointersMade": "FieldGoalsMade3", "sThreePointersAttempted": "FieldGoalsAttempted3",
    "sFreeThrowsMade": "FreeThrowsMade", "sFreeThrowsAttempted": "FreeThrowsAttempted",
    "sReboundsOffensive": "OffensiveRebounds", "sReboundsDefensive": "DefensiveRebounds",
    "sReboundsTotal": "TotalRebounds",
    "sAssists": "Assistances", "sTurnovers": "Turnovers", "sSteals": "Steals",
    "sBlocks": "BlocksFavour", "sBlocksReceived": "BlocksAgainst",
    "sFoulsPersonal": "FoulsCommited", "sFoulsOn": "FoulsReceived",
    "sPlusMinusPoints": "Plusminus",
}


def _season(config: dict, comp: str = "E") -> str:
    """"2026-27" -> "E2026", or "U2026" for the EuroCup.

    THE SEASON CODE CARRIES THE COMPETITION. Both competitions run on the same two hosts and the
    same field names; what separates them is one letter, in the feeds path AND in the season code
    (E2026 is the EuroLeague, U2026 the EuroCup). Hard-coding the E here was the only thing
    stopping the EuroCup being a config entry."""
    raw = str(config.get("season") or "")
    m = re.match(r"[A-Z]?(\d{4})", raw)
    return comp + (m.group(1) if m else str(time.gmtime().tm_year))


def _stats(row: dict) -> dict:
    out = {k: S.num(row.get(v)) for k, v in PLAYER_STATS.items()}
    out["sFieldGoalsMade"] = out["sTwoPointersMade"] + out["sThreePointersMade"]
    out["sFieldGoalsAttempted"] = out["sTwoPointersAttempted"] + out["sThreePointersAttempted"]
    return out


class EuroLeagueAdapter(FibaLiveStatsAdapter):
    name = "euroleague"
    min_request_gap_s = 0.4
    competition = "E"        # "U" is the EuroCup: same hosts, same fields, one letter apart

    # ---------------------------------------------------------------- schedule ---
    def _json(self, url: str):
        gap = time.time() - getattr(self, "_last_api", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.get(url, headers={"User-Agent": UA}, timeout=45)
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        return r.json()

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        comp = config.get("competition_code") or self.competition
        season = _season(config, comp)
        data = self._json(SCHEDULE.format(comp=comp, season=season)) or {}
        out = []
        for g in data.get("data") or []:
            code = g.get("code")
            if code is None:
                continue
            home, away = g.get("home") or {}, g.get("away") or {}
            # THE CRESTS ARE ON THE SCHEDULE, one per club, so a club has its badge on the site
            # before its first game is even played (run_ingest.sync_logos reads these).
            out.append(ScheduleGame(
                external_id=f"{season}_{code}",
                home_name=home.get("name") or "", away_name=away.get("name") or "",
                tipoff_at=g.get("date"),
                status="final" if g.get("played") else "scheduled",
                extra={"home_logo": (home.get("imageUrls") or {}).get("crest"),
                       "away_logo": (away.get("imageUrls") or {}).get("crest"),
                       "home_code": (home.get("code") or home.get("tla") or "").strip(),
                       "away_code": (away.get("code") or away.get("tla") or "").strip()}))
        self.last_competitions = []
        return out

    # ------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        m = re.match(r"([A-Z]\d{4})_(\d+)$", str(external_id))
        if not m:
            return None
        season, code = m.group(1), m.group(2)
        box = self._json(LIVE.format(feed="Boxscore", code=code, season=season))
        stats = (box or {}).get("Stats") or []
        if len(stats) != 2:
            return None                      # not played, or half-published: try again next pass
        pbp = self._json(LIVE.format(feed="PlayByPlay", code=code, season=season)) or {}
        points = self._json(LIVE.format(feed="Points", code=code, season=season)) or {}

        # The PBP feed is where the club's own spelling and its three-letter code live; the
        # Boxscore shouts the name ("ANADOLU EFES ISTANBUL") and carries no code at all.
        sides = [
            {"name": (pbp.get("TeamA") or stats[0].get("Team") or "").strip(),
             "code": (pbp.get("CodeTeamA") or "").strip(), "box": stats[0]},
            {"name": (pbp.get("TeamB") or stats[1].get("Team") or "").strip(),
             "code": (pbp.get("CodeTeamB") or "").strip(), "box": stats[1]},
        ]
        quarters = self._quarters(box)
        shots = self._shots_by_code(points)

        tm = []
        for i, side in enumerate(sides):
            players = {}
            for row in side["box"].get("PlayersStats") or []:
                # Player_ID is the one stable handle in this feed; the NAME is shouted and
                # comma-flipped, which names.py sorts out downstream.
                pno = (row.get("Player_ID") or "").strip() or str(len(players) + 1)
                players[pno] = S.player(
                    name=(row.get("Player") or "").strip(),
                    shirt=(row.get("Dorsal") or "").strip(),
                    starter=row.get("IsStarter"), active=1,
                    minutes=(row.get("Minutes") or "0:00").strip() or "0:00",
                    stats=_stats(row))
            totals = self._team_totals(side["box"], players)
            tm.append(S.team(side["name"], side["code"],
                             score=totals.get("sPoints"),
                             quarters=quarters[i], players=players,
                             shots=shots.get(side["code"], []), totals=totals))

        raw = S.game(tm[0], tm[1], played=True)
        b = self.bundle_from_raw(raw, str(external_id), config)
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ----------------------------------------------------------------- pieces ---
    @staticmethod
    def _quarters(box: dict) -> list:
        """[[q1..q4], [q1..q4]] from ByQuarter, which is per team and per quarter.

        ByQuarter is the points scored IN each quarter; EndOfQuarter is the running score, and
        reading that one instead would put 85 in the fourth column of a 25-point quarter."""
        out = [[], []]
        for i, row in enumerate((box.get("ByQuarter") or [])[:2]):
            out[i] = [S.num(row.get("Quarter%d" % q)) for q in range(1, 5)]
        return out

    @staticmethod
    def _team_totals(side_box: dict, players: dict) -> dict:
        """The club's own totals row where it has one, summed from its players where it does not."""
        tot = side_box.get("totr") or {}
        if not tot:
            return S.totals_of(players)
        out = {k: S.num(tot.get(v)) for k, v in PLAYER_STATS.items() if v in tot}
        base = S.totals_of(players)
        for k in S.STATS:
            out.setdefault(k, base.get(k, 0))
        out["sFieldGoalsMade"] = out.get("sTwoPointersMade", 0) + out.get("sThreePointersMade", 0)
        out["sFieldGoalsAttempted"] = out.get("sTwoPointersAttempted", 0) + out.get("sThreePointersAttempted", 0)
        return out

    @staticmethod
    def _shots_by_code(points: dict) -> dict:
        """The Points rows as chart-percentage shots, per team code.

        Free throws are sentinel-coded (-1, -1) and are not shots on a chart; everything else is
        an offset in centimetres from the basket it was taken at."""
        out: dict = {}
        for r in (points or {}).get("Rows") or []:
            act = (r.get("ID_ACTION") or "").strip()
            if act not in ("2FGM", "2FGA", "3FGM", "3FGA"):
                continue
            cx, cy = S.num(r.get("COORD_X"), -1), S.num(r.get("COORD_Y"), -1)
            if cx == -1 and cy == -1:
                continue
            x, y = S.at_rim_offset(cx, cy)
            code = (r.get("TEAM") or "").strip()
            out.setdefault(code, []).append(
                S.shot(x, y, made=act.endswith("M"), three=act.startswith("3"),
                       period=S.num(r.get("MINUTE")) // 10 + 1))
        return out
