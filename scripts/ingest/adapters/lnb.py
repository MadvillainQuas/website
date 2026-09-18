"""LNB Betclic ELITE and ELITE 2 (France) — lnb.fr's own schedule, Sportradar's EUI game feed.

TWO HOSTS, ONE ADAPTER, TWO CONFIG ROWS. The schedule lives on the league's own backend
(api-prod.lnb.fr) and the game data on the Sportradar "EUI Connect" embed that lnb.fr's match
centre renders. Elite and Elite 2 differ by exactly ONE query parameter — division_external_id —
so `adapter_config.division` (1 or 2) is the whole difference between the two rows:

    GET  api-prod.lnb.fr/competition/getDivisionCompetitionByYear?year=<YYYY>&division_external_id=<1|2>
         -> the season's competitions (league, Supercoupe, Leaders Cup, Play-In, Playoffs …),
            each with its own external_id AND its own season_id
    POST api-prod.lnb.fr/match/getCalendar  {competition_external_id, start_date, end_date}
         -> the fixtures, grouped by date; match_id IS the EUI fixture uuid
    GET  embed-api.eui.connect.sportradar.com/v1/embed/12/fixture_detail?state=…&fixtureId=…
         -> the game, twice: once for the play-by-play, once for the box score

THE SEASON AXIS IS THE START YEAR, a plain integer — "2026-27" is year=2026. It is derived from
the platform's own season name rather than pinned, because every LNB competition id changes each
season (2025-26 Betclic ELITE is 302, 2026-27 is 317) and a pinned id silently ingests last
season forever.

THE STATE PARAMETER is the one fiddly thing here. The EUI embed takes its whole request as a
zlib-compressed, urlsafe-base64, '='-stripped JSON blob; the season_id has to be threaded into it
from the schedule, which is why the external_id carries both uuids. Key order and the compact
separators are kept exactly as lnb.fr's own player sends them — the endpoint is tolerant, but
there is nothing to gain by drifting from a proven request.

WHAT THIS ADAPTER DOES NOT DO, deliberately. The scraper's LNB path spends most of its length
repairing the substitution stream (operators pre-log a batch of subs and then re-log it a minute
later, so in/out pairing needs a 45-second window) and renumbering overtime periods. That work
exists to build STINTS, which the shared pipeline builds for every league from the same payload —
so it is not re-done here. The box score, the team totals, the shot zones, the clubs and the
players need none of it.

THE SHOT CHART is free: every play-by-play event carries x/y as a PERCENTAGE OF THE FULL COURT,
which is already the frame shot_dist_to_nearest_rim measures in — no at_rim_offset conversion, and
converting anyway would file every lay-up as a jump shot. Verified on a real game: the 2pt shots
span 0.3-6.4 m from the nearest rim and the 3pt shots 6.8-10.5 m, i.e. dead on the 6.75 m arc.
"""
from __future__ import annotations

import base64
import json
import re
import time
import zlib
from datetime import datetime, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

# lnb.fr's backend answers anyone, but only with its own site's Referer/Origin on the request.
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
           "Referer": "https://lnb.fr/", "Origin": "https://lnb.fr"}
LNB_API = "https://api-prod.lnb.fr"
EUI = "https://embed-api.eui.connect.sportradar.com/v1/embed/12/fixture_detail"

# The EUI box-score row -> FIBA's own stat names. Everything the pipeline reads, nothing it does not.
PLAYER_STATS = {
    "sPoints": "points",
    "sTwoPointersMade": "pointsTwoMade", "sTwoPointersAttempted": "pointsTwoAttempted",
    "sThreePointersMade": "pointsThreeMade", "sThreePointersAttempted": "pointsThreeAttempted",
    "sFreeThrowsMade": "freeThrowsMade", "sFreeThrowsAttempted": "freeThrowsAttempted",
    "sReboundsOffensive": "reboundsOffensive", "sReboundsDefensive": "reboundsDefensive",
    "sReboundsTotal": "rebounds",
    "sAssists": "assists", "sTurnovers": "turnovers", "sSteals": "steals",
    "sBlocks": "blocks", "sBlocksReceived": "blocksReceived",
    # foulsTotal is fouls COMMITTED (personal + offensive + technical) — checked against the
    # play-by-play on a real game: 21 personal + 5 offensive + 1 technical == foulsTotal 27.
    "sFoulsPersonal": "foulsTotal",
    "sPlusMinusPoints": "plusMinus",
}
#: the club's own totals row carries these two beyond the per-player stats
TEAM_EXTRA = {"sBiggestLead": "biggestLead", "sLeadChanges": "leadChanges"}
#: a finished fixture, in the EUI's vocabulary (its statusLabel is French, its status is not)
FINAL_STATUS = {"CONFIRMED", "COMPLETE", "COMPLETED", "FINAL", "FINISHED"}
#: played, but the result is not signed off yet — believed only when the last period has ended
PROVISIONAL_STATUS = {"UNCONFIRMED", "PROVISIONAL"}


def _season_year(config: dict) -> int:
    """The platform's "2026-27" -> 2026, the season START YEAR the LNB API is keyed on.

    Falls back to the league's own rule (a season opens in July) only when no season is
    configured at all — never to a hard-coded id."""
    m = re.search(r"(\d{4})", str(config.get("season") or ""))
    if m:
        return int(m.group(1))
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def _state(season_id: str, fixture_id: str, feed: str) -> str:
    """The EUI's whole request, as it wants it: compact JSON -> zlib -> urlsafe base64, '=' stripped.

    The padding MUST come off: the embed passes the value on unescaped and a '=' inside a query
    string is read as another parameter boundary."""
    blob = json.dumps({"s": season_id or "", "l": "fr-FR", "z": feed, "f": fixture_id},
                      separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(zlib.compress(blob)).decode().rstrip("=")


def _minutes(iso: str) -> str:
    """ISO duration "PT23M53S" -> "23:53", which is what sMinutes is everywhere else.

    A player who did not dress carries None for every field including this one."""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$", str(iso or ""))
    if not m:
        return "0:00"
    mins = int(m.group(1) or 0) * 60 + int(m.group(2) or 0)
    return "%d:%02d" % (mins, int(float(m.group(3) or 0)))


def _stats(src: dict) -> dict:
    out = {k: S.num((src or {}).get(v)) for k, v in PLAYER_STATS.items()}
    # The feed publishes 2pt and 3pt separately and never a combined field goal.
    out["sFieldGoalsMade"] = out["sTwoPointersMade"] + out["sThreePointersMade"]
    out["sFieldGoalsAttempted"] = out["sTwoPointersAttempted"] + out["sThreePointersAttempted"]
    return out


class LnbAdapter(FibaLiveStatsAdapter):
    name = "lnb"
    min_request_gap_s = 0.5
    division = 1                              # overridden per source by adapter_config.division

    # ---------------------------------------------------------------- transport ---
    def _req(self, method: str, url: str, **kw):
        gap = time.time() - getattr(self, "_last_api", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.request(method, url, timeout=45, **kw)
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        return r.json()

    # ----------------------------------------------------------------- schedule ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        year = _season_year(config)
        div = int(config.get("division") or self.division)
        comps = self._req("GET", f"{LNB_API}/competition/getDivisionCompetitionByYear",
                          params={"year": year, "division_external_id": div}, headers=HEADERS) or {}
        inc = [re.compile(x, re.I) for x in (config.get("competitions_include") or [])]
        exc = [re.compile(x, re.I) for x in (config.get("competitions_exclude") or [])]
        out, comp_names = [], []
        for comp in comps.get("data") or []:
            name = (comp.get("competition_name") or "").strip()
            ext = comp.get("external_id")
            # The All Star / Young Star games are exhibitions on the same division: they have
            # made-up rosters and would file invented clubs against the league.
            if ext is None or "star game" in name.lower():
                continue
            if (inc and not any(p.search(name) for p in inc)) or any(p.search(name) for p in exc):
                continue
            comp_names.append(name)
            out.extend(self._calendar(comp, year))
        self.last_competitions = comp_names
        return out

    def _calendar(self, comp: dict, year: int) -> list:
        """One competition's fixtures. The API wants an explicit window; the competition's own
        dates are it, and a competition with none gets the season's July-to-June year."""
        body = {"competition_external_id": comp.get("external_id"),
                "start_date": (comp.get("start_date") or "")[:10] or f"{year}-07-01",
                "end_date": (comp.get("end_date") or "")[:10] or f"{year + 1}-06-30"}
        cal = self._req("POST", f"{LNB_API}/match/getCalendar", data=json.dumps(body),
                        headers={**HEADERS, "Content-Type": "application/json"}) or {}
        season_id = comp.get("season_id") or ""
        games = []
        for group in cal.get("data") or []:
            for m in group.get("data") or []:
                fixture = (m.get("match_id") or "").strip()
                if not fixture:
                    continue
                teams = m.get("teams") or []
                home, away = (teams + [{}, {}])[0], (teams + [{}, {}])[1]
                games.append(ScheduleGame(
                    # BOTH uuids: the EUI's state blob needs the season_id, and nothing in a game
                    # feed request can be derived from the fixture id alone.
                    external_id=f"{season_id}_{fixture}",
                    home_name=(home.get("team_name") or "").strip(),
                    away_name=(away.get("team_name") or "").strip(),
                    tipoff_at=m.get("match_time_utc"),
                    # A scheduled match still reports score_string "0", so completion is read off
                    # match_status and never off the score.
                    status="final" if (m.get("match_status") or "").upper() == "COMPLETE" else "scheduled",
                    extra={"venue": (m.get("venue_name") or "").strip() or None,
                           "home_code": (home.get("team_code") or "").strip(),
                           "away_code": (away.get("team_code") or "").strip(),
                           # logo_WHITE is a white silhouette for dark backgrounds — invisible on
                           # the site's light default. logo_black is the coloured crest. Checked:
                           # the "white" file is 100% pure white pixels, zero saturation.
                           "home_logo": self._logo(home), "away_logo": self._logo(away),
                           "competition": (comp.get("competition_name") or "").strip()}))
        return games

    @staticmethod
    def _logo(team: dict) -> Optional[str]:
        for key in ("logo_black", "logo_white"):
            v = team.get(key)
            url = (v or {}).get("lg") if isinstance(v, dict) else v
            if isinstance(url, str) and url.startswith("https://"):
                return url
        return None

    # --------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        m = re.match(r"([0-9a-f-]*)_([0-9a-f-]{20,})$", str(external_id))
        if not m:
            return None
        season_id, fixture_id = m.group(1), m.group(2)
        feeds = {}
        for feed in ("pbp", "statistics"):
            d = self._req("GET", EUI, params={"state": _state(season_id, fixture_id, feed),
                                              "fixtureId": fixture_id}, headers=HEADERS) or {}
            feeds[feed] = d.get("data") or {}
        stats = ((feeds["statistics"].get("statistics") or {}).get("data") or {}).get("base") or {}
        fixture = feeds["statistics"].get("fixture") or feeds["pbp"].get("fixture") or {}
        if not stats.get("home") or not fixture.get("competitors"):
            return None                        # not played, or half-published: try again next pass

        sides = fixture["competitors"]
        comps = {c.get("entityId"): c for c in sides}
        home_id = next((c["entityId"] for c in sides if c.get("isHome")), sides[0].get("entityId"))
        away_id = next((c["entityId"] for c in sides if c.get("entityId") != home_id), None)
        quarters = self._quarters(feeds["statistics"].get("periodData") or {})
        pbp = feeds["pbp"].get("pbp") or {}
        shots = self._shot_chart(pbp)

        # The box score's own "home"/"away" keys are the EMBED's display order, which the feed can
        # reverse (reverseTeamOrder); every box row carries its club's entityId, so the two halves
        # are joined on that and never on the key, which would silently swap the two clubs' stats.
        by_entity = {}
        for key, fallback in (("home", home_id), ("away", away_id)):
            side = stats.get(key) or {}
            rows = ((side.get("persons") or [{}])[0].get("rows")) or []
            by_entity[(rows[0].get("entityId") if rows else None) or fallback] = side

        tm = []
        for eid in (home_id, away_id):
            c, side = comps.get(eid) or {}, by_entity.get(eid) or {}
            qs = quarters.get(eid) or {}
            t = S.team(
                (c.get("name") or "").strip(), (c.get("code") or "").strip(),
                score=c.get("score"),           # the club's official final, not a re-sum
                quarters=[qs.get(i) for i in (1, 2, 3, 4)],
                players=self._players(side),
                shots=shots.get(eid, []),
                logo=c.get("logo"),             # full-colour crest, for a club with no badge yet
                totals=self._totals(side))
            # A PERIOD THE FEED NEVER PUBLISHED IS LEFT ABSENT, not written as 0. One game in the
            # cached sample (Nanterre 88-82 Chalon) carries a teamScores list holding Q2 alone;
            # a zero there would read as a quarter the club failed to score in, and the quarter
            # line would contradict the final score it sits under.
            for i in (1, 2, 3, 4):
                if qs.get(i) is None:
                    t.pop("p%d_score" % i, None)
            tm.append(t)

        played = self._played(fixture, pbp)
        # The pipeline reads "is this over?" off the pbp sentinel alone, so a game still running
        # needs at least one event for it to be called live rather than never-started.
        started = any((blk.get("events") if isinstance(blk, dict) else blk) for blk in pbp.values())
        live_marker = None if played or not started else [{"actionType": "period", "subType": "start"}]
        raw = S.game(tm[0], tm[1], played=played, pbp=live_marker)
        b = self.bundle_from_raw(raw, str(external_id), config)
        # startTimeUTC is the venue-confirmed tip-off; the schedule's match_time_utc is the
        # announced one, so it is only the fallback.
        b.tipoff_at = self._utc(fixture.get("startTimeUTC")) or config.get("_tipoff_at")
        return b

    # ------------------------------------------------------------------ pieces ---
    @staticmethod
    def _played(fixture: dict, pbp: dict) -> bool:
        """Is this game over? CONFIRMED is the signed-off result; UNCONFIRMED is the window
        between the final buzzer and the officials signing, and is only believed once the last
        period reports ended — a live game's current period never does, so a game in progress can
        never be called final and stop being polled."""
        status = str(fixture.get("status") or "").upper()
        if status in FINAL_STATUS:
            return True
        if status in PROVISIONAL_STATUS and pbp:
            last = sorted(pbp, key=lambda k: S.num(k))[-1]
            return bool((pbp.get(last) or {}).get("ended"))
        return False

    @staticmethod
    def _utc(v) -> Optional[str]:
        """The EUI writes local-looking ISO without a zone on a field it documents as UTC."""
        s = str(v or "").strip()
        if not s:
            return None
        return s if s.endswith("Z") or "+" in s[10:] else s + "Z"

    @staticmethod
    def _players(side: dict) -> dict:
        players = {}
        # persons[] is a list of groups; the first is the players ("Joueurs"). Any further group
        # the embed is configured to show is staff (showTeamStaffStatistics), which is not a
        # player and must not land on a roster.
        for group in (side.get("persons") or [])[:1]:
            for row in group.get("rows") or []:
                # personId is the stable handle across games and seasons; the shirt number is not
                # (players change it), and the pipeline keys rosters on "<club>:<pno>".
                pno = (row.get("personId") or "").strip() or str(len(players) + 1)
                players[pno] = S.player(
                    # names.py owns what a player is CALLED — the feed's own string goes through
                    # untouched ("Robin Ducoté", "TaShawn Thomas").
                    name=(row.get("personName") or "").strip(),
                    shirt=(row.get("bib") or "").strip(),
                    starter=row.get("starter"),
                    # "active" on this feed means ON COURT RIGHT NOW, which is false for everyone
                    # once the game ends. "participated" is the one that means what FIBA's active
                    # means, and getting it wrong empties the whole box score.
                    active=1 if row.get("participated") else 0,
                    minutes=_minutes((row.get("statistics") or {}).get("minutes")),
                    position=(row.get("position") or "") or "",
                    stats=_stats(row.get("statistics") or {}))
        return players

    @staticmethod
    def _totals(side: dict) -> dict:
        """The club's own totals row, which is NOT the sum of its players: `entity` already
        includes the team rebounds `extra` holds separately (12 player + 4 team = 16 offensive on
        the game checked), and summing the box would lose them."""
        out = _stats(side.get("entity") or {})
        for k, v in TEAM_EXTRA.items():
            if (side.get("totalEntityStats") or {}).get(v) is not None:
                out[k] = S.num(side["totalEntityStats"][v])
        return out

    @staticmethod
    def _quarters(period_data: dict) -> dict:
        """{entityId: {1: q1, … 4: q4}} from teamScores, the points scored IN each period.

        KEYED BY periodId, NEVER BY POSITION: the list is not guaranteed to start at Q1 (one game
        publishes Q2 alone), so reading it in order would file Q2's points as the first quarter.
        Overtime is keyed 11, 12, … by Sportradar and is dropped here, because the platform's
        quarter line — for every league — is four wide."""
        out: dict = {}
        for eid, rows in (period_data.get("teamScores") or {}).items():
            got = {}
            for r in rows or []:
                p = S.num(r.get("periodId"))
                if p in (1, 2, 3, 4):
                    got[p] = S.num(r.get("score"))
            out[eid] = got
        return out

    @staticmethod
    def _shot_chart(pbp: dict) -> dict:
        """{entityId: [shot…]} from the play-by-play, which is the only place shots live.

        x/y are already a percentage of the full court. Dead-ball events carry null, and every
        NON-shot event repeats the previous shot's coordinates — so a free throw or a foul read as
        a shot would double-count the attempt it followed. Filtering on eventType is the fix."""
        out: dict = {}
        for period, block in (pbp or {}).items():
            events = block.get("events") if isinstance(block, dict) else block
            for e in events or []:
                kind = e.get("eventType")
                if kind not in ("2pt", "3pt") or e.get("x") is None or e.get("y") is None:
                    continue
                per = S.num(e.get("periodId"), S.num(period, 1))
                out.setdefault(e.get("entityId"), []).append(
                    S.shot(S.num(e.get("x")), S.num(e.get("y")),
                           made=bool(e.get("success")), three=(kind == "3pt"),
                           pno=(e.get("personId") or "").strip() or None,
                           period=per - 10 + 4 if per >= 11 else per))   # OT 11,12 -> 5,6
        return out
