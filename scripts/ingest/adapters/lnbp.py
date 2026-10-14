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

OLDER SEASONS (a console backfill), checked 14 Oct 2026. The EUI holds the league from 2025 only:
its season list has the Copa back to 2023 and the women's league from 2024, but no league season
before 2025. Before that, lnbp.mx's own back end (lnbpback.truewisdom.co, the CMS behind its
calendar and scores pages) has every season since 2014-15, with its rounds and games:

    POST /sports/seasons/all                    "2021", "2024 Varonil", "2024 Femenil" ...
    POST /sports/rounds/season {id_season}      "Jornada 1" ... "Semifinal de Zona - Juego 3", "Gran Final ..."
    POST /sports/games/dates {date_start, date_end}   every game in the window, each with its round,
                                                the clubs, the score, the local date and time - and fiba_id

fiba_id is the game's FIBA LiveStats id, and its data.json still answers with the whole box score and
play-by-play. 2021 has it on all 129 games, 2020 on 122 of 126; 2022, 2023 and 2024 on none (115
games sampled over 24 rounds) - so those three seasons have nowhere to be read from, and are said so.
The back end names a club "Abejas"; the game feed "ABEJAS DE LEON", as the EUI does. A fixture named
"Abejas" would create a second club beside the one the game then lands on, so each club's name is
taken from one of its own games' data.json (_livestats_names) - never the back end's.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Iterable

import requests

from . import fibashape as S
from .base import ScheduleGame
from .fiba_livestats import FIBA_DATA_URL, ZoneInfo
from .lnb import EUI_EMBED, FINAL_STATUS, LnbAdapter, page_state

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
           "Referer": "https://www.lnbp.mx/", "Origin": "https://www.lnbp.mx"}
LEAGUE_COMPETITION = "16be8396-24fb-11ef-9ab7-df6be196e88f"
#: fixtureTypes that are nobody's table: a pre-season or exhibition game would file its result
#: against a stage it was never part of
NOT_COMPETITIVE = {"PRESEASON", "PRE_SEASON", "FRIENDLY", "EXHIBITION", "ALLSTAR", "ALL_STAR"}
LIVE_STATUS = {"IN_PROGRESS", "INPROGRESS", "LIVE", "STARTED", "HALFTIME", "BREAK"}

#: lnbp.mx's own back end (OLDER SEASONS above). It answers its own site's Origin, and a browser's request.
SITE_API = "https://lnbpback.truewisdom.co"
SITE_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
                "Origin": "https://www.lnbp.mx", "Referer": "https://www.lnbp.mx/", "Accept": "*/*",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
SITE_GAP_S = 1.5
#: the back end's dates and times are local; the league's own clock is central Mexico's
SITE_TZ = "America/Mexico_City"
#: a round that is the play-offs: "Semifinal de Zona - Juego 1", "Final de Zona Juego 2", "Gran Final - Juego 4"
PLAYOFF_ROUND = re.compile(r"final|cuartos|play\s*-?\s*off|repechaje", re.I)
#: a FIBA LiveStats game id
LIVESTATS_ID = re.compile(r"\d{5,10}")


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
        if LIVESTATS_ID.fullmatch(str(external_id).strip()):
            return self._fetch_livestats(str(external_id).strip(), config)      # a season before the EUI
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
        listed = [s for s in ((listing.get("seasons") or {}).get("seasons") or [])
                  if s.get("competitionId") == comp and s.get("seasonId")]
        seasons = [s for s in listed if S.num(s.get("year")) == year]
        self.last_competitions = [s.get("nameLocal") or "" for s in seasons]
        if not seasons:
            first = min((S.num(s.get("year")) for s in listed if S.num(s.get("year"))), default=None)
            if first and year < first:
                # older than anything the EUI holds of the league: its own site's games, read off FIBA LiveStats
                return self._discover_site(year, stage)
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

    # ------------------------------------------------- a season before the EUI ---
    #: year -> {back-end club id: the club's name in the game feed}; shared by the league's two sources
    _site_names: dict = {}
    _site_last = 0.0
    #: (path, form) -> the back end's reply: a past season does not change, and a league's two sources (regular
    #: season, play-offs) read the same one - the year's games are one ~800 KB reply, asked for once
    _site_replies: dict = {}

    def _site(self, path: str, data: dict) -> dict:
        """One POST to lnbp.mx's own back end, as its pages make it; {} when it does not answer (said so)."""
        key = (path, tuple(sorted(data.items())))
        if key in LnbpAdapter._site_replies:
            return LnbpAdapter._site_replies[key]
        gap = time.time() - LnbpAdapter._site_last
        if gap < SITE_GAP_S:
            time.sleep(SITE_GAP_S - gap)
        LnbpAdapter._site_last = time.time()
        try:
            r = requests.post(SITE_API + path, data=data, headers=SITE_HEADERS, timeout=90)
            if r.status_code == 200:
                LnbpAdapter._site_replies[key] = r.json() or {}
                return LnbpAdapter._site_replies[key]
            print(f"   (lnbp: lnbp.mx's back end answered {r.status_code} on {path})")
        except (requests.RequestException, ValueError) as exc:
            print(f"   (lnbp: lnbp.mx's back end unreachable on {path}: {exc})")
        return {}

    @staticmethod
    def _site_tip(event: dict) -> tuple:
        """(ISO UTC, time_tbc) from the back end's local date and time."""
        d, t = str(event.get("date_start") or ""), str(event.get("time_start") or "")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            return None, False
        m = re.match(r"(\d{1,2}):(\d{2})", t)
        if not m or ZoneInfo is None or t.startswith("00:00"):
            return f"{d}T12:00:00Z", True          # noon UTC on the local date, the PLK / U SPORTS convention
        local = datetime(int(d[:4]), int(d[5:7]), int(d[8:10]), int(m.group(1)), int(m.group(2)), tzinfo=ZoneInfo(SITE_TZ))
        return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False

    def _livestats_names(self, year: int, games: list) -> dict:
        """{back-end club id: the club's name as its games' data.json writes it}, from one game per club.
        A game tells which side is which by its score (the back end's score_1 against data.json's team 1);
        a game whose two sides cannot be told apart that way (a tie, a missing score) teaches nothing."""
        if year in LnbpAdapter._site_names:
            return LnbpAdapter._site_names[year]
        need = {g.get("id_team_1") for g in games} | {g.get("id_team_2") for g in games}
        names: dict = {}
        tried = 0
        for g in games:
            if need <= set(names) or tried >= 3 * len(need):
                break
            if g.get("id_team_1") in names and g.get("id_team_2") in names:
                continue
            tried += 1
            try:
                raw = self._get(FIBA_DATA_URL.format(game_id=str(g.get("fiba_id")).strip()))
            except Exception:
                raw = None
            tm = (raw or {}).get("tm") or {}
            one, two = tm.get("1") or {}, tm.get("2") or {}
            s1, s2 = S.num(g.get("score_1")), S.num(g.get("score_2"))
            got = (S.num(one.get("score")), S.num(two.get("score")))
            if s1 == s2 or not (one.get("name") and two.get("name")):
                continue
            if got == (s1, s2):
                names.setdefault(g.get("id_team_1"), one["name"].strip())
                names.setdefault(g.get("id_team_2"), two["name"].strip())
            elif got == (s2, s1):
                names.setdefault(g.get("id_team_1"), two["name"].strip())
                names.setdefault(g.get("id_team_2"), one["name"].strip())
        if need <= set(names):
            LnbpAdapter._site_names[year] = names     # a partial answer (a feed that did not answer) is asked again
        return names

    def _discover_site(self, year: int, stage: str) -> list:
        """A season before the EUI, from lnbp.mx's own back end (OLDER SEASONS above): every game of the year's
        men's season that carries a FIBA LiveStats id, keyed by it, as every LiveStats league's game is."""
        season = next((s for s in self._site("/sports/seasons/all", {}).get("items") or []
                       # "2021" before the women's league began; "2024 Varonil" beside "2024 Femenil" after
                       if re.fullmatch(rf"\s*{year}(\s+varonil)?\s*", str(s.get("name") or ""), re.I)), None)
        if not season:
            print(f"     LNBP {year}: neither the EUI nor lnbp.mx's own site has a {year} season")
            return []
        rounds = {r.get("id"): str(r.get("name") or "").strip()
                  for r in self._site("/sports/rounds/season", {"id_season": season.get("id")}).get("items") or []}
        # one request for the whole year; another season's games in the window (2019-20 ended in 2020) are
        # not this one's, and are told apart by their round
        games = [g for g in self._site("/sports/games/dates", {"date_start": f"{year}-01-01", "date_end": f"{year + 1}-01-15"})
                 .get("items") or [] if g.get("id_round") in rounds]
        linked = [g for g in games if LIVESTATS_ID.fullmatch(str(g.get("fiba_id") or "").strip())]
        self.last_competitions = [str(season.get("name") or year)]
        if not linked:
            print(f"     LNBP {year}: lnbp.mx's own site lists {len(games)} games of its {season.get('name')} season and links "
                  "none of them to a box score (no FIBA LiveStats id) - nothing to read")
            return []
        names = self._livestats_names(year, linked)
        out, unnamed, unplayed = [], 0, 0
        for g in linked:
            rnd = rounds.get(g.get("id_round")) or ""
            st = "playoffs" if PLAYOFF_ROUND.search(rnd) else "regular"
            if st != stage:
                continue
            home, away = names.get(g.get("id_team_1")), names.get(g.get("id_team_2"))
            if not (home and away):
                unnamed += 1                     # a club no game of its own would name: never filed under a guess
                continue
            if not (S.num(g.get("score_1")) or S.num(g.get("score_2"))):
                unplayed += 1                    # the season is over: a game with no score was never played
                continue
            ev = g.get("event") or {}
            tip, tbc = self._site_tip(ev)
            extra = {"home_code": "", "away_code": "", "round": rnd, "stage": st, "feed": "livestats",
                     "venue": str(ev.get("venue") or "").strip() or None, "competition": str(season.get("name") or "")}
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id=str(g.get("fiba_id")).strip(), home_name=home, away_name=away,
                                    tipoff_at=tip, status="final", extra=extra))
        out.sort(key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     LNBP {year} {stage} (lnbp.mx + FIBA LiveStats): {len(out)} games"
              + (f"; {len(games) - len(linked)} of the season's {len(games)} have no LiveStats id" if len(games) > len(linked) else "")
              + (f"; {unnamed} between clubs no game named" if unnamed else "")
              + (f"; {unplayed} never played" if unplayed else ""))
        return out

    def _fetch_livestats(self, gid: str, config: dict):
        """One game of a season before the EUI: its data.json, as FibaLiveStatsAdapter.fetch reads it, with the
        clubs' codes taken off first. LiveStats coded the clubs its own way (Abejas "GTO", where the EUI has
        "LEO"), and an old season must not re-code the clubs the season being played is keyed on: without a
        code a club is found by its name, which LiveStats and the EUI write alike ("ABEJAS DE LEON")."""
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=gid))
        if not raw or "tm" not in raw:
            return None
        for k in ("1", "2"):
            if isinstance(raw["tm"].get(k), dict):
                raw["tm"][k]["code"] = ""
        b = self.bundle_from_raw(raw, gid, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b
