"""NBL Bulgaria (Национална баскетболна лига) — Sportradar's EUI embed 308, schedule and game.

nbl.basketball.bg shows the same Sportradar "EUI Connect" embed as lnb.fr's match centre (12) and
lnbp.mx (14), as its own website 308. The game feed is exactly the shape LnbAdapter translates, so
the game side is inherited; the scraper's 25-game box-vs-play-by-play check (2025-26, every player
of every game equal) is the same parser on the same payloads. What is new here is four things:

EVERYTHING IS IN CYRILLIC, whatever locale is asked for ("en-EN" gives English labels round
Bulgarian names; "bg-BG" is refused), and there is no Latin name anywhere in the feed. So every
reply is transliterated the moment it arrives (_req), by Bulgaria's own standard - the
Transliteration Act 2009, names.bulgarian_latin: Hristo, not Khristo; Shumen, not Shchumen. No
name can reach a table, a box score or a lineup in Cyrillic by any path, and names.py then only
ever sees Latin.

A PLAYED GAME CAN STILL SAY "SCHEDULED". 27 of 2025-26's 192 fixtures were never moved on by the
operator, yet carry a final score, every quarter ended and a full box (Botev 86-90 Beroe on
4 Oct 2025, 491 events). A fixture is therefore final on its status OR on the evidence: both clubs
scored, the last period ended, the scores differ (a tie at the end of Q4 is overtime to come),
and it tipped off hours ago.

ONE SEASON AT A TIME. Embed 308 publishes no season list (LNBP's embed 14 does), so the season
read is the one the feed is on now - its year read off its own fixture dates - or one recorded in
SEASONS. A platform season that is neither is refused with a reason, never read as the current
one: that is how one season's games get filed under another's name.

REGULAR SEASON AND PLAY-OFFS ARE ONE EUI SEASON with no fixtureType, told apart by the round
numbers: the regular season runs Round 1..33, and the play-offs start again at Round 1 after it
(quarter-finals, semi-finals, final: 2025-26 from 29 Apr). A fixture dated after the last game of
the highest round is a play-off game. adapter_config.stage picks which a source row takes.

CLUBS are keyed by the EUI entityId (the feed has no club code), the same id in the fixtures list
and the game feed, so a club created from a fixture and one named by a played game are one club.
Names are the transliterated Bulgarian ones ("Cherno more Ticha", "Rilski sportist"): the
standard spells letters, and the capitals are the club's own.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import names as _names                  # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

from . import fibashape as S
from .base import ScheduleGame
from .lnb import EUI_EMBED, FINAL_STATUS, LnbAdapter, page_state
from .twobbl import current_season, normalize_season

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
           "Referer": "https://nbl.basketball.bg/", "Origin": "https://nbl.basketball.bg"}
#: EUI season uuids by START year, for a season the feed is no longer on (it lists none itself)
SEASONS = {2025: "3f73b7bb-9a47-11f0-8a96-b5a52c2e9fb9"}
DROPPED = {"CANCELLED", "CANCELED", "POSTPONED", "ABANDONED"}
LIVE_STATUS = {"IN_PROGRESS", "INPROGRESS", "LIVE", "STARTED", "HALFTIME", "BREAK"}
#: a scored fixture this long past its tip-off is a result, whatever its status says
PLAYED_AFTER = timedelta(hours=4)
ROUND = re.compile(r"(\d+)")


def _year(season: str) -> int:
    return int(str(season)[:4])


def _tip(v) -> Optional[datetime]:
    s = str(v or "").strip().replace("Z", "")
    try:
        d = datetime.fromisoformat(s[:19])
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc)


def _round(f: dict) -> int:
    m = ROUND.search(str(f.get("round") or ""))
    return int(m.group(1)) if m else 0


def _real(c: dict) -> bool:
    return bool(c) and str(c.get("name") or "").strip().lower() not in ("", "unknown")


def scored_and_past(f: dict, now: Optional[datetime] = None) -> bool:
    """The schedule-side evidence that a SCHEDULED fixture was played: two real clubs, two scores,
    a tip-off PLAYED_AFTER ago."""
    comps = f.get("competitors") or []
    if len(comps) < 2 or not all(_real(c) for c in comps) or any(c.get("score") in (None, "") for c in comps):
        return False
    tip = _tip(f.get("startTimeUTC"))
    return bool(tip) and (now or datetime.now(timezone.utc)) - tip > PLAYED_AFTER


def playoff_cutoff(fixtures: list) -> Optional[str]:
    """The tip-off of the last game of the highest round: anything later is a play-off game
    (their rounds start again at 1). None until the season has a highest round at all."""
    rounds = [(_round(f), f.get("startTimeUTC") or "") for f in fixtures if _round(f)]
    if not rounds:
        return None
    top = max(r for r, _ in rounds)
    return max(t for r, t in rounds if r == top) or None


class BgNblAdapter(LnbAdapter):
    name = "bgnbl"
    eui_site = 308
    locale = "en-EN"
    headers = HEADERS

    # ---------------------------------------------------------------- transport ---
    def _req(self, method: str, url: str, **kw):
        """Every reply, transliterated before anything reads it (see the module docstring)."""
        got = super()._req(method, url, **kw)
        return _names.bulgarian_payload(got) if got else got

    def _page(self, fields: dict) -> dict:
        return (self._req("GET", f"{EUI_EMBED}/{self.eui_site}/fixtures",
                          params={"state": page_state(fields)}, headers=self.headers) or {}).get("data") or {}

    def _season_fixtures(self, season_id: str) -> tuple:
        """(the season id the feed answered with, every fixture of it: RESULTS then FIXTURES, once each)."""
        seen, out, sid = set(), [], season_id
        for tab in ("RESULTS", "FIXTURES"):
            data = self._page({"s": season_id, "l": self.locale, "z": tab})
            sid = data.get("seasonId") or sid
            for f in data.get("fixtures") or []:
                if f.get("fixtureId") and f["fixtureId"] not in seen:
                    seen.add(f["fixtureId"])
                    out.append(f)
        return sid, out

    # ----------------------------------------------------------------- schedule ---
    @staticmethod
    def _season(config: dict) -> str:
        tok = config.get("season")
        if not tok:
            return current_season()
        season = normalize_season(tok)
        if not season:
            raise ValueError(f"bgnbl: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        want = _year(season)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"bgnbl: stage must be 'regular' or 'playoffs', not {stage!r}")
        sid, fixtures = self._season_fixtures("")
        dates = sorted(str(f.get("startTimeLocal") or "")[:10] for f in fixtures if f.get("startTimeLocal"))
        feed_year = None
        if dates:
            y, mo = int(dates[0][:4]), int(dates[0][5:7])
            feed_year = y if mo >= 7 else y - 1
        if feed_year != want:
            if want not in SEASONS:
                print(f"     NBL Bulgaria {season}: not on the feed yet (it is on "
                      f"{feed_year}/{feed_year + 1 if feed_year else '?'}; known: "
                      f"{', '.join(f'{y}/{y + 1}' for y in sorted(SEASONS)) or 'none'}) - nothing read")
                self.last_competitions = []
                return []
            sid, fixtures = self._season_fixtures(SEASONS[want])
        cutoff = playoff_cutoff(fixtures)
        out = []
        for f in fixtures:
            g = self._game(sid, f, stage, cutoff)
            if g:
                out.append(g)
        out.sort(key=lambda g: (g.tipoff_at or "", g.external_id))
        self.last_competitions = ["NBL Bulgaria"]
        print(f"     NBL Bulgaria {season} {stage}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _game(self, season_id: str, f: dict, stage: str, cutoff: Optional[str]):
        fixture = (f.get("fixtureId") or "").strip()
        status = str((f.get("status") or {}).get("value") or "").upper()
        sides = f.get("competitors") or []
        home = next((c for c in sides if c.get("isHome")), None)
        away = next((c for c in sides if c is not home), None)
        if not fixture or status in DROPPED or not (_real(home) and _real(away)):
            return None                        # a cancelled game, or a play-off slot still "Unknown"
        is_playoff = bool(cutoff) and (f.get("startTimeUTC") or "") > cutoff
        if is_playoff != (stage == "playoffs"):
            return None
        final = status in FINAL_STATUS or scored_and_past(f)
        extra = {"home_code": home.get("entityId") or "", "away_code": away.get("entityId") or "",
                 "home_logo": home.get("logo") or None, "away_logo": away.get("logo") or None,
                 "round": f.get("round") or None, "stage": "playoffs" if is_playoff else "regular",
                 "venue": (f.get("venue") or "").strip() or None}
        tip = self._utc(f.get("startTimeUTC"))
        if f.get("timesUnconfirmed") and tip:
            tip = (f.get("startTimeLocal") or tip)[:10] + "T12:00:00Z"
            extra["time_tbc"] = True
        return ScheduleGame(
            external_id=f"{season_id}_{fixture}",     # LnbAdapter.fetch needs both uuids
            home_name=(home.get("name") or "").strip(), away_name=(away.get("name") or "").strip(),
            tipoff_at=tip,
            status="final" if final else ("live" if status in LIVE_STATUS else "scheduled"),
            extra=extra)

    # --------------------------------------------------------------------- game ---
    def _club_code(self, competitor: dict) -> str:
        """The EUI entityId: the feed has no club code, and this id is the same in the fixtures
        list, so a club found from a fixture and one named by a game are one club."""
        return (competitor.get("entityId") or "").strip() or super()._club_code(competitor)

    def _played(self, fixture: dict, pbp: dict) -> bool:
        """Final on the status, or on the evidence a SCHEDULED-but-played game leaves: every
        published period, at least four, ended; both scores in and different; long since tipped."""
        if LnbAdapter._played(fixture, pbp):
            return True
        status = str(fixture.get("status") or "").upper()
        if status in DROPPED or not pbp:
            return False
        keys = sorted(pbp, key=lambda k: S.num(k))
        if len(keys) < 4 or not all((pbp.get(k) or {}).get("ended") for k in keys):
            return False
        scores = [c.get("score") for c in fixture.get("competitors") or []]
        if len(scores) < 2 or any(s in (None, "") for s in scores) or str(scores[0]) == str(scores[1]):
            return False
        tip = _tip(fixture.get("startTimeUTC"))
        return bool(tip) and datetime.now(timezone.utc) - tip > PLAYED_AFTER
