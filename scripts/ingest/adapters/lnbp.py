"""LNBP (Liga Nacional de Baloncesto Profesional, Mexico) — Sportradar's EUI embed, schedule and game.

lnbp.mx renders the same Sportradar "EUI Connect" embed as lnb.fr's match centre, as its own website
(14) in its own locale (es-ES). The game feed is exactly the shape LnbAdapter translates. Checked on
Abejas de León 83-89 Freseros Irapuato (21 Sep 2026): 483 events and 31 stints covering all 2400
seconds, with the stint points summing to 83-89 and no box line differing from the log. So the
game side is inherited unchanged. The schedule is new, because lnb.fr's backend is France only:

    GET embed-api.eui.connect.sportradar.com/v1/embed/14/fixtures?state=<{"l": "es-ES"}>
        -> the embed's default season, plus seasons.seasons[]: every season of every competition
           the site shows (the league, the Copa, the women's league), each with its year
    GET .../14/fixtures?state=<{"s": <season>, "l": "es-ES", "z": "RESULTS" | "FIXTURES"}>
        -> the season's played games, then the rest; the whole season each time, with no paging

THE LEAGUE IS FOUND BY ITS COMPETITION ID, not its name. The name carries the sponsor ("LIGA
CALIENTE.MX LNBP") and the season id changes every year, but the competition id was
16be8396-24fb-11ef-9ab7-df6be196e88f in both 2025 and 2026. adapter_config.eui_competition can
name another.

THE SEASON IS THE CALENDAR YEAR (July to November, so 2026 is "2026"). It is read off the
platform's season name, which is why the source rows say season_calendar.

THE REGULAR SEASON AND THE PLAY-OFFS ARE ONE EUI SEASON, told apart by each fixture's fixtureType:
REGULAR, then PLAYOFF and FINAL (2025: 197 + 39 + 5). adapter_config.stage picks which of the two
a source row takes, as with PLK's and LBA's rows.

THE GAME FEED NAMES A CLUB ONLY BY ITS CODE. fixture.competitors[].name is "LEO", while the fixtures
pages say "ABEJAS DE LEON". A pass writes played games before fixtures, so every club would be
created named by its three letters. The full names are therefore learnt from the fixtures pages,
keyed by the club's entityId. Discovery reads those pages anyway; a game fetched without a
discovery pass (the live lane) reads its season's pages once.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable

from . import fibashape as S
from .base import ScheduleGame
from .lnb import EUI_EMBED, FINAL_STATUS, LnbAdapter, page_state

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
           "Referer": "https://www.lnbp.mx/", "Origin": "https://www.lnbp.mx"}
LEAGUE_COMPETITION = "16be8396-24fb-11ef-9ab7-df6be196e88f"
#: fixtureTypes that are nobody's table: a pre-season or exhibition game would file its result
#: against a stage it was never part of
NOT_COMPETITIVE = {"PRESEASON", "PRE_SEASON", "FRIENDLY", "EXHIBITION", "ALLSTAR", "ALL_STAR"}
LIVE_STATUS = {"IN_PROGRESS", "INPROGRESS", "LIVE", "STARTED", "HALFTIME", "BREAK"}


def _season_year(config: dict) -> int:
    """The platform's "2026" (a calendar-year season) -> 2026; the current year when none is set."""
    m = re.search(r"(\d{4})", str(config.get("season") or ""))
    return int(m.group(1)) if m else datetime.now(timezone.utc).year


class LnbpAdapter(LnbAdapter):
    name = "lnbp"
    eui_site = 14
    locale = "es-ES"
    headers = HEADERS

    def _page(self, fields: dict) -> dict:
        data = (self._req("GET", f"{EUI_EMBED}/{self.eui_site}/fixtures",
                          params={"state": page_state(fields)}, headers=self.headers) or {}).get("data") or {}
        names = self.__dict__.setdefault("_names", {})
        for f in data.get("fixtures") or []:
            for c in f.get("competitors") or []:
                if c.get("entityId") and (c.get("name") or "").strip():
                    names[c["entityId"]] = c["name"].strip()
        return data

    def _club_name(self, competitor: dict) -> str:
        return self.__dict__.get("_names", {}).get(competitor.get("entityId")) or super()._club_name(competitor)

    def fetch(self, external_id: str, config: dict):
        season = str(external_id).split("_")[0] if "_" in str(external_id) else ""
        read = self.__dict__.setdefault("_named_seasons", set())
        if season and season not in read:
            read.add(season)
            for tab in ("RESULTS", "FIXTURES"):
                self._page({"s": season, "l": self.locale, "z": tab})
        return super().fetch(external_id, config)

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        year = _season_year(config)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"lnbp: stage must be 'regular' or 'playoffs', not {stage!r}")
        comp = config.get("eui_competition") or LEAGUE_COMPETITION
        listing = self._page({"l": self.locale})
        # Normally one season per competition and year. The Copa has had two in one year, so every
        # match is read, and a fixture listed twice is kept once (by its id).
        seasons = [s for s in ((listing.get("seasons") or {}).get("seasons") or [])
                   if s.get("competitionId") == comp and S.num(s.get("year")) == year and s.get("seasonId")]
        self.last_competitions = [s.get("nameLocal") or "" for s in seasons]
        if not seasons:
            print(f"     LNBP {year}: no season of competition {comp} published yet")
            return []
        games: dict = {}
        for s in seasons:
            self.__dict__.setdefault("_named_seasons", set()).add(s["seasonId"])
            for tab in ("RESULTS", "FIXTURES"):
                for f in self._page({"s": s["seasonId"], "l": self.locale, "z": tab}).get("fixtures") or []:
                    g = self._game(s, f, stage)
                    if g:
                        games[g.external_id] = g
        out = sorted(games.values(), key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     LNBP {year} {stage}: {len(out)} games ({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _game(self, season: dict, f: dict, stage: str):
        fixture = (f.get("fixtureId") or "").strip()
        ftype = str(f.get("fixtureType") or "").upper()
        if not fixture or ftype in NOT_COMPETITIVE or (ftype != "REGULAR") != (stage == "playoffs"):
            return None
        sides = f.get("competitors") or []
        home = next((c for c in sides if c.get("isHome")), None)
        away = next((c for c in sides if c is not home), None)
        if not (home and away):
            return None
        status = str((f.get("status") or {}).get("value") or "").upper()
        tip = self._utc(f.get("startTimeUTC"))
        extra = {"home_code": (home.get("code") or "").strip(), "away_code": (away.get("code") or "").strip(),
                 "home_logo": home.get("logo") or None, "away_logo": away.get("logo") or None,
                 "round": f.get("round") or None, "stage": "playoffs" if ftype != "REGULAR" else "regular",
                 "competition": (season.get("nameLocal") or "").strip()}
        if f.get("timesUnconfirmed") and tip:
            # a date without its time: noon UTC on the local date, the PLK / U SPORTS convention
            tip = (f.get("startTimeLocal") or tip)[:10] + "T12:00:00Z"
            extra["time_tbc"] = True
        return ScheduleGame(
            # BOTH uuids, as LnbAdapter.fetch wants: the game feed's state blob needs the season
            external_id=f"{season['seasonId']}_{fixture}",
            home_name=(home.get("name") or "").strip(), away_name=(away.get("name") or "").strip(),
            tipoff_at=tip,
            status="final" if status in FINAL_STATUS else ("live" if status in LIVE_STATUS else "scheduled"),
            extra=extra)
