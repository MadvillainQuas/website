"""Austria: win2day Basketball Superliga, Basketball Zweite Liga and win2day Damen Superliga - Sportradar's EUI embed.

basketballaustria.at shows each league's schedule and game centre as the same Sportradar "EUI Connect" widget
lnb.fr's match centre renders, one WEBSITE per league, all three in the federation's own locale (de-AT):

    260  win2day Basketball Superliga (BSL, men, tier 1)       basketballaustria.at/bsl/saison/spielplan
    262  Basketball Zweite Liga (B2L, men, tier 2)             basketballaustria.at/b2l/saison/spielplan
    261  win2day Damen Superliga (BDSL, women, tier 1)         basketballaustria.at/bdsl/saison/spielplan

(each page's <script data-type="fixtures" data-website-id="..."> names it; nothing else is needed - the
embed asks for no key or token). The game feed is exactly the shape LnbAdapter translates, so the game side is
inherited: checked on five games across the three leagues (Graz 102-94 Dukes after two overtimes, the 2025-26
BSL final's game 5, a B2L game, a BDSL game and the 2025-26 BDSL final's game 3): every player's minutes
replayed from the substitutions equal the box score's to the second, no substitution left unpaired, the
play-by-play's points equal the final score and the stints cover the game five a side. The feed's play-by-play
is STRUCTURED (eventType "2pt", eventSubType "tipIn", success, x/y) - the German text the page draws ("2Pkt Tip
In getroffen", "Einwechslung") is only its label, and nothing here reads it. What is new is the schedule:

    GET embed-api.eui.connect.sportradar.com/v1/embed/<site>/fixtures?state=<{"l": "de-AT"}>
        -> seasons.seasons[]: every season of every competition the site shows, each with its year
    GET .../<site>/fixtures?state=<{"s": <season>, "l": "de-AT", "z": "RESULTS" | "FIXTURES"}>
        -> the season's played games, then the rest; the whole season each time, with no paging

THE LEAGUE IS FOUND BY ITS COMPETITION ID, not its name: the name carries the sponsor ("Admiral Basketball
Bundesliga", "bet-at-home Basketball Superliga", "win2day BSL") and the season id changes every year, but the
competition id has been the same since the league's first season on the embed. Website 261 also shows a second
competition, "win2day BDSL National League" (a cup-like round of group games beside the league, with clubs
that are not in it: Flamesbabes, TI Eagles Innsbruck), and its 2024-25 Supercup; neither is the Damen
Superliga, and the competition id keeps them out.

THE SEASON IS THE START YEAR: the embed's "year" for "win2day BSL - 26/27" is 2026.

THE REGULAR SEASON AND THE PLAY-OFFS ARE ONE EUI SEASON, and fixtureType says REGULAR on every game of both
(the 2025-26 final included). The stage is read off the game itself, in this order:

  * its name's code - "BSL-GD - 044" is the Grunddurchgang (the regular season), "BSL-QR"/"BSL-PR" the
    Qualifikations- and Platzierungsrunde that finish it, "BSL-VF"/"-SF"/"-FIN" the quarter-finals,
    semi-finals and final, "B2L-REL" the relegation series. 2024-25 wrote "GD-013" without the league, and
    one 2025-26 BDSL semi-final is "BSDL-SF": only the part after the last hyphen counts;
  * else the stage tab its stageCode names ("Grunddurchgang", "Zwischenrunde", "BSL Playoffs", "BSL
    Playdown", "Snickers(R)-Play-Offs" ...), which is all a season before 2024-25 has: those games carry no
    name. (And 2024-25's play-off games carry a name but no stageCode.)

A play-down or relegation series is a post-season knockout like the play-offs, and is filed with them: it is
nobody's regular-season table. A code and a tab this file does not know are filed as regular season, and said.

OLDER SEASONS (a backfill), checked 15 Oct 2026. Every season the site lists is on the embed - the BSL back to
2006-07, the B2L to 2012-13, the BDSL to 2019-20 - but not all of each:
  * 2024-25 on: box score and play-by-play (with shot x/y), as this season;
  * 2018-19 to 2023-24 (games sampled in 2018-19, 2019-20, 2021-22, 2022-23 and 2023-24 of the three leagues):
    the box score only - periodData carries no events. LnbAdapter publishes such a game as a result and a box
    (translate off) once it is two days old, as it does LNB's 2020-21;
  * before that, a sampled 2015-16 BSL game has no box rows either, and fetch() returns nothing for it.
A past season is asked for by its start year exactly like this one; nothing is pinned.

CLUBS are keyed by the EUI code (GRA, DUK ... "KUF" for Kufstein in both men's leagues, which are two leagues
on the platform). Within one league's competition no two clubs share a code in 2025-26 or 2026-27 (the
National League's "Flamesbabes" shares Basket Flames' FLA, which is one more reason it is kept out). Three codes
carry an umlaut (FÜR, GÜS, WÖR) and are kept as the feed writes them.

DEFENSIVE REBOUNDS. The BSL's website (260) is configured to show "rebounds" and "reboundsOffensive" only - its
box rows carry no reboundsDefensive at all, where 261 and 262 do. Read as LNB reads it, every BSL player and
club would have 0 defensive rebounds beside his full total, and the four factors' rebounding would be 100% for
both sides. So a missing reboundsDefensive is the total less the offensive ones (_with_dreb), and only when it
is missing.
"""
from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from typing import Iterable, Optional

from . import fibashape as S
from .base import ScheduleGame
from .lnb import EUI_EMBED, FINAL_STATUS, PROVISIONAL_STATUS, LnbAdapter, page_state
from .twobbl import current_season

try:
    from zoneinfo import ZoneInfo
except ImportError:                       # pragma: no cover - Python < 3.9
    ZoneInfo = None

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
           "Referer": "https://basketballaustria.at/", "Origin": "https://basketballaustria.at"}
LOCALE = "de-AT"
#: adapter_config.league -> the league's EUI website and its competition id (see the module docstring)
LEAGUES = {
    "bsl":  {"site": 260, "competition": "b359f9b2-d3d7-11e9-972c-b24257e70dcc", "label": "Basketball Superliga"},
    "b2l":  {"site": 262, "competition": "12c8ceaa-e472-11e9-92df-c26e08174d5e", "label": "Basketball Zweite Liga"},
    "bdsl": {"site": 261, "competition": "1a9584c4-fe6c-11ea-9402-620a21de7e07", "label": "Damen Superliga"},
}
#: a game's name code (the part after the league's): the regular season, and everything after it
REGULAR_CODES = {"GD", "QR", "PR", "ZR", "RS"}
PLAYOFF_CODES = {"VF", "QF", "HF", "SF", "FIN", "F", "PO", "PD", "REL", "P3"}
#: a stage tab that is not the regular season (the play-offs, a play-down, a relegation series)
PLAYOFF_LABEL = re.compile(r"play\s*-?\s*offs?|play\s*-?\s*downs?|finale?\b|viertel|halbfinal|semifinal|relegation|abstieg",
                           re.I)
REGULAR_LABEL = re.compile(r"grunddurchgang|zwischenrunde|platzierungsrunde|qualifikationsrunde|regular\s+season", re.I)
#: the code is the last letters-first part before the number: "BSL-FIN - 005", "GD-013", "B2L-REL - 001"
NAME_CODE = re.compile(r"^\s*(?:[A-Z0-9]+-)*([A-Z][A-Z0-9]*?)\s*(?:-\s*)?\d*\s*$")
LIVE_STATUS = {"IN_PROGRESS", "INPROGRESS", "LIVE", "STARTED", "HALFTIME", "BREAK", "INTERRUPTED"}
DROPPED = {"CANCELLED", "CANCELED", "POSTPONED", "ABANDONED"}


def _season_year(config: dict) -> int:
    """The platform's "2026-27" -> 2026, the embed's year for "26/27"; the season the site shows when none is set."""
    m = re.search(r"(\d{4})", str(config.get("season") or "")) or re.search(r"(\d{4})", current_season())
    return int(m.group(1))


def _league(config: dict) -> dict:
    key = str(config.get("league") or "").strip().lower()
    if key not in LEAGUES:
        raise ValueError(f"austria: adapter_config.league must be one of {', '.join(LEAGUES)}, not {key!r}")
    lg = dict(LEAGUES[key], key=key)
    # a row can name another website or competition outright (a league the federation moves)
    if config.get("eui_site"):
        lg["site"] = int(config["eui_site"])
    if config.get("eui_competition"):
        lg["competition"] = str(config["eui_competition"])
    return lg


def name_code(name) -> str:
    """"BSL-FIN - 005" -> "FIN", "GD-013" -> "GD", "BSDL-SF - 002" -> "SF"; "" for no name."""
    m = NAME_CODE.match(str(name or "").upper())
    return m.group(1) if m else ""


def stage_of(fixture: dict, tabs: dict) -> tuple:
    """("regular" | "playoffs", what said so) for one fixture, off its name's code, else its stage tab's label.
    tabs is {stageCode: label} off the season's pages. ("regular", "?<...>") when neither is known."""
    code = name_code(fixture.get("name"))
    if code in PLAYOFF_CODES:
        return "playoffs", code
    if code in REGULAR_CODES:
        return "regular", code
    label = str(tabs.get(fixture.get("stageCode")) or "").strip()
    if label and PLAYOFF_LABEL.search(label) and not REGULAR_LABEL.search(label):
        return "playoffs", label
    if label and REGULAR_LABEL.search(label):
        return "regular", label
    return "regular", "?" + (code or label or "no name, no stage")


def _local_to_utc(local: str, tz: str) -> Optional[str]:
    """"2026-10-11T16:00:00" in Europe/Vienna -> "2026-10-11T14:00:00Z"; None when it cannot be read."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", str(local or ""))
    if not m or ZoneInfo is None:
        return None
    try:
        zone = ZoneInfo(tz or "Europe/Vienna")
    except Exception:
        zone = ZoneInfo("Europe/Vienna")
    d = datetime(*(int(x) for x in m.groups()), tzinfo=zone)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _with_dreb(side: dict) -> dict:
    """A box-score side whose rows (and club row) say reboundsDefensive: the total less the offensive ones where
    the website does not publish it (the BSL's 260 - see the module docstring). A row that has it keeps it."""
    def fill(stats):
        if isinstance(stats, dict) and stats.get("reboundsDefensive") is None and stats.get("rebounds") is not None:
            stats["reboundsDefensive"] = max(0, S.num(stats.get("rebounds")) - S.num(stats.get("reboundsOffensive")))
    out = copy.deepcopy(side or {})
    for group in out.get("persons") or []:
        for row in group.get("rows") or []:
            fill(row.get("statistics"))
    fill(out.get("entity"))
    return out


class AustriaAdapter(LnbAdapter):
    name = "austria"
    eui_site = 260                         # per source row: adapter_config.league picks the website
    locale = LOCALE
    headers = HEADERS

    # ----------------------------------------------------------------- schedule ---
    def _page(self, site: int, fields: dict) -> dict:
        return (self._req("GET", f"{EUI_EMBED}/{site}/fixtures",
                          params={"state": page_state(fields)}, headers=self.headers) or {}).get("data") or {}

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        lg = _league(config)
        year = _season_year(config)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"austria: stage must be 'regular' or 'playoffs', not {stage!r}")
        listing = self._page(lg["site"], {"l": self.locale})
        listed = [s for s in ((listing.get("seasons") or {}).get("seasons") or [])
                  if s.get("competitionId") == lg["competition"] and s.get("seasonId")]
        seasons = [s for s in listed if S.num(s.get("year")) == year]
        self.last_competitions = [(s.get("nameLocal") or "").strip() for s in seasons]
        if not seasons:
            years = sorted({S.num(s.get("year")) for s in listed if S.num(s.get("year"))})
            print(f"     {lg['label']} {year}/{year + 1}: no season of competition {lg['competition']} on website "
                  f"{lg['site']} (it has {years[0] if years else '-'}..{years[-1] if years else '-'}) - nothing read")
            return []
        games: dict = {}
        unknown: dict = {}
        for s in seasons:
            fixtures, tabs = [], {}
            for tab in ("RESULTS", "FIXTURES"):
                data = self._page(lg["site"], {"s": s["seasonId"], "l": self.locale, "z": tab})
                for o in (data.get("stageTabs") or {}).get("options") or []:
                    if o.get("value") and o.get("value") != "All":
                        tabs[o["value"]] = o.get("label") or ""
                fixtures.extend(data.get("fixtures") or [])
            for f in fixtures:
                g = self._game(s, f, stage, tabs, unknown)
                if g:
                    games[g.external_id] = g
        for why, n in unknown.items():
            print(f"     {lg['label']}: {n} game(s) of a stage this adapter does not know ({why[1:]}) - filed as regular season")
        out = sorted(games.values(), key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     {lg['label']} {year}/{year + 1} {stage}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _game(self, season: dict, f: dict, stage: str, tabs: dict, unknown: dict):
        fixture = (f.get("fixtureId") or "").strip()
        status = str((f.get("status") or {}).get("value") or "").upper()
        if not fixture or status in DROPPED:
            return None
        sides = f.get("competitors") or []
        home = next((c for c in sides if c.get("isHome")), None)
        away = next((c for c in sides if c is not home), None)
        if not (home and away and (home.get("name") or "").strip() and (away.get("name") or "").strip()):
            return None                    # a play-off slot not drawn yet
        st, why = stage_of(f, tabs)
        if why.startswith("?"):
            unknown[why] = unknown.get(why, 0) + 1
        if st != stage:
            return None
        tip = self._utc(f.get("startTimeUTC")) or _local_to_utc(f.get("startTimeLocal"), f.get("timezone") or "Europe/Vienna")
        extra = {"home_code": (home.get("code") or "").strip(), "away_code": (away.get("code") or "").strip(),
                 "home_logo": home.get("logo") or None, "away_logo": away.get("logo") or None,
                 "round": f.get("round") or None, "stage": st, "phase": why.lstrip("?"),
                 "venue": (f.get("venue") or "").strip() or None,
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
            # UNCONFIRMED is the window between the buzzer and the officials signing: polled until fetch says final
            status="final" if status in FINAL_STATUS else
                   ("live" if status in LIVE_STATUS or status in PROVISIONAL_STATUS else "scheduled"),
            extra=extra)

    # --------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict):
        # the game feed is read from the league's own website (the instance is one source row's). The embed
        # answers a fixture of any of the federation's three leagues on any of the three websites (seen in the
        # dry run, 15 Oct 2026), so a call with no league - a tool, a test - is read where the instance points
        if (config or {}).get("league"):
            self.eui_site = _league(config)["site"]
        return super().fetch(external_id, config)

    @staticmethod
    def _players(side: dict) -> dict:
        return LnbAdapter._players(_with_dreb(side))

    @staticmethod
    def _totals(side: dict) -> dict:
        return LnbAdapter._totals(_with_dreb(side))
