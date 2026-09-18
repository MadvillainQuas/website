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

THE PLAY-BY-PLAY IS TRANSLATED, NOT DROPPED. The `pbp` feed is fetched for the shot chart
anyway, so `_events` maps it into the event contract scripts/ingest/stints.py replays — that is
the whole of what a league has to supply to get stints, lineups and the margin timeline. Two
things this feed spells its own way and one it does not spell at all:

  · ITS SHOT subTypes ARE FIBA'S IN camelCase. "drivingLayup".lower() IS "drivinglayup", which is
    the exact string stints._RIM_SUBTYPES holds; the same is true of pullUpJumpShot,
    stepBackJumpShot, floatingJumpShot, alleyOopDunk, tipIn, hookShot and fadeAway. So the
    translation of a subType is `.lower()` and nothing else — a hand-written mapping table here
    would be a second place to keep in step with stints.py for no gain.
  · A FOUL IS LOGGED TWICE, once as `personal` against the offender and once as `drawn` against
    the man he fouled (42 of them in the game checked). `drawn` is FIBA's sFoulsOn, not a
    personal foul, and passing it through would file a PF against the fouled team's lineup.
  · NOTHING TAGS A SCORING PLAY as fast-break / second-chance / off-turnover. FIBA feeds carry
    `qualifier` for that; the EUI carries no equivalent, so those three stint columns stay 0 —
    which stints.py documents as the honest answer rather than guessing them from a time window.

WHAT THIS ADAPTER DOES NOT DO, deliberately. The scraper's LNB path spends most of its length
repairing the substitution stream (operators pre-log a batch of subs and then re-log it a minute
later, so in/out pairing needs a 45-second window). That repair exists because the scraper PAIRS
an IN to an OUT; stints.py does not pair, it applies each as a set operation on the five, so a
re-logged batch lands on a lineup it has already been applied to and changes nothing. The raw
stream is therefore handed over as it comes. Checked on Dijon 89-91 Le Mans (26/09/2025): 478
events, 114 substitutions, 36 stints, every one of them five a side, no lineup warning, 2400 of
2400 seconds accounted for and the stint plus/minus summing to the final -2. What IS ported from
that path is the OVERTIME RENUMBERING and the SPILL detection, because both change an event's
period, and a stint stamped with the wrong period is wrong everywhere it is read.

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
#: EUI eventType -> the actionType scripts/ingest/stints.py replays. Everything absent here
#: carries no stat and no lineup change: `jumpBall` and `timeOut` are furniture, and `period` /
#: `fixture` are rebuilt below from the period block, which is the only place THIS feed states
#: that a period ended (the game checked logs no `period` event at all).
EVENT_TYPE = {
    "2pt": "2pt", "3pt": "3pt", "freeThrow": "freethrow", "rebound": "rebound",
    "assist": "assist", "turnover": "turnover", "steal": "steal", "block": "block",
    "foul": "foul", "substitution": "substitution",
}
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


def _remaining(iso: str) -> tuple:
    """A play-by-play clock "PT9M43S" -> ("9:43", 583), i.e. the `gt` the contract wants and the
    seconds behind it, parsed once.

    gt is time REMAINING in the period, which is both FIBA's convention and the EUI's, so there
    is nothing to invert here — but it is worth saying, because inverting it would put every
    stint in the right order at the wrong time and nothing would look broken."""
    gt = _minutes(iso)                        # the same ISO-duration parse sMinutes already uses
    mm, ss = (gt.split(":") + ["0"])[:2]
    return gt, int(mm) * 60 + int(ss)


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

        # The box score's own "home"/"away" keys are the EMBED's display order, which the feed can
        # reverse (reverseTeamOrder); every box row carries its club's entityId, so the two halves
        # are joined on that and never on the key, which would silently swap the two clubs' stats.
        by_entity = {}
        for key, fallback in (("home", home_id), ("away", away_id)):
            side = stats.get(key) or {}
            rows = ((side.get("persons") or [{}])[0].get("rows")) or []
            by_entity[(rows[0].get("entityId") if rows else None) or fallback] = side

        # The rosters are built BEFORE the play-by-play because the events are keyed on personId
        # and the stint builder puts whatever pno it is handed straight into a lineup: a personId
        # the box score does not carry (an official, a player the embed drops) would otherwise
        # become a sixth man on court that no name could ever be found for.
        rosters = {eid: self._players(by_entity.get(eid) or {}) for eid in (home_id, away_id)}
        events = self._events(pbp, {home_id: 1, away_id: 2}, rosters)
        shots = self._shot_chart(events)

        tm = []
        for tno, eid in ((1, home_id), (2, away_id)):
            c, side = comps.get(eid) or {}, by_entity.get(eid) or {}
            qs = quarters.get(eid) or {}
            t = S.team(
                (c.get("name") or "").strip(), (c.get("code") or "").strip(),
                score=c.get("score"),           # the club's official final, not a re-sum
                quarters=[qs.get(i) for i in (1, 2, 3, 4)],
                players=rosters.get(eid) or {},
                shots=shots.get(tno, []),
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
        if played and events:
            # S.game writes this sentinel itself, but writes it WITHOUT an actionNumber — and
            # `stints.ordered` only takes its deterministic sorted-by-actionNumber path when
            # EVERY event has one. Numbering it here keeps the replay order a fact rather than
            # the fallback guess (does the first event sit later in the game than the last?),
            # which is the sort of thing that works until the day it quietly does not.
            events.append({"actionNumber": len(events) + 1, "actionType": "game",
                           "subType": "end", "period": events[-1]["period"], "gt": "0:00"})
        # A game still running has no sentinel and so reads as live off its own events; a game
        # that has not tipped has no events at all, which reads as never-started.
        raw = S.game(tm[0], tm[1], played=played, pbp=events)
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
    def _events(pbp: dict, tno_of: dict, rosters: dict) -> list:
        """The EUI play-by-play as the event contract in scripts/ingest/stints.py spells it.

        `tno_of` is {entityId: 1 home / 2 away} and `rosters` the pl dicts the pno must exist in.
        Events come back OLDEST FIRST, numbered, which is what `stints.ordered` sorts on.

        THE OTHER CONSUMER WANTS THE OPPOSITE ORDER AND DOES NOT ASK. fiba_livestats prefers
        `_stints_via_pipeline` — the scraper's fiba_api_parser — whenever Louie's scraper folder
        is reachable, and that parser does `list(reversed(events))` unconditionally, because a
        genuine FIBA data.json is newest first. Handed this list it replays the game backwards
        and returns ONE stint of the starters (measured on the game below: 1 there, 36 here).
        That is a defect in the shared path, not in this feed — every translated league hits it —
        so it is reported rather than worked around by writing the list backwards here, which
        would leave this file the only one in the folder disagreeing with the stated contract.

        THREE THINGS ARE DECIDED HERE and nowhere downstream:

        OVERTIME IS RENUMBERED 5, 6, … Sportradar keys its OT periods 11, 12 (found in the
        scraper's 25-game validation, game 5b4ff397). Left alone, `stints._elapsed` would read
        period 11 as ten full quarters gone and put every OT stint an hour into a 40-minute game.
        The block says `isOvertime` itself, so that is read rather than inferred from the key.

        SPILL: some games misfile the NEXT period's opening events into the previous period's
        array, and the only sign is the clock jumping back UP mid-array. The trigger is kept as
        tight as the scraper's — from under 2 minutes left to over 8 — because a looser one
        false-fires on an ordinary late-inserted correction and shifts the whole rest of the
        period.

        PERIOD END: this feed logs no `period` event, so the end of each finished period is
        emitted from the block's own `ended` flag. Without it the clock stops at the last shot
        and the dead tail of every period belongs to no lineup — stints.py is explicit that every
        event moves the clock so a side's stint seconds sum to the length of the game."""
        out: list = []
        ot = 4
        for key in sorted(pbp or {}, key=lambda k: S.num(k)):
            block = pbp.get(key) or {}
            raw_events = (block.get("events") if isinstance(block, dict) else block) or []
            p_base = S.num(key, 1)
            if block.get("isOvertime") or p_base > 4:
                ot += 1
                p_base = ot
            spill, prev_left = 0, None
            for e in raw_events:
                kind = EVENT_TYPE.get(e.get("eventType"))
                sub = str(e.get("eventSubType") or "").lower()
                # `drawn` is the man who WAS fouled (sFoulsOn), logged against his own club — a
                # personal foul on the defending five if it were let through.
                if kind is None or (kind == "foul" and sub == "drawn"):
                    continue
                tno = tno_of.get(e.get("entityId"))
                if tno is None:
                    continue                  # an event belonging to neither club: the scraper
                                              # files these as `unparsed` and ignores them too
                gt, left = _remaining(e.get("clock"))
                if prev_left is not None and prev_left <= 120 and left >= 480:
                    spill += 1
                prev_left = left
                pno = (e.get("personId") or "").strip()
                if pno not in (rosters.get(e.get("entityId")) or {}):
                    # A team rebound and a shot-clock turnover carry no personId at all (10 of
                    # them in the game checked). They are a possession but nobody's stat, and
                    # stints.py drops them on exactly this test — so the key is left off rather
                    # than filled with an empty string, which would read as a player named "".
                    pno = ""
                if kind == "substitution" and not pno:
                    continue                  # a sub with no player cannot be applied to a five
                ev = {"actionNumber": len(out) + 1, "actionType": kind,
                      "period": p_base + spill, "gt": gt, "tno": tno}
                if sub:
                    # camelCase lowered IS the FIBA subType vocabulary stints.py matches on —
                    # see the module docstring. No table, so no table to fall out of step.
                    ev["subType"] = sub
                if pno:
                    ev["pno"] = pno
                    # THE SHIRT NUMBER RIDES ALONG for the other stint builder. stints.py tracks
                    # players by pno and never looks at this; fiba_api_parser reads `shirtNumber`
                    # off the event and only falls back to pno, and this feed's pno is a personId
                    # uuid. It does not refuse one — normalize_jersey_number hands a uuid straight
                    # back — so the lineups would come out keyed on uuids that the shirt-to-name
                    # map in _stints_via_pipeline cannot match, and every five would be spelled as
                    # five uuids. One extra field beats a lineup table nobody can read.
                    ev["shirtNumber"] = str(e.get("bib") or "")
                if e.get("success") is not None:
                    ev["success"] = 1 if e["success"] else 0
                if kind in ("2pt", "3pt") and e.get("x") is not None and e.get("y") is not None:
                    # Riding along for _shot_chart only. Every NON-shot event repeats the previous
                    # shot's coordinates, which is why they are carried on shots alone.
                    ev["x"], ev["y"] = S.num(e["x"]), S.num(e["y"])
                out.append(ev)
            if block.get("ended"):
                # THE BLOCK'S OWN PERIOD, never the spilled one. A block that spilled has already
                # handed its tail to the next period, and stamping its end with p_base + spill
                # would run the clock to the end of a period that has not been played yet — in an
                # overtime game that is the whole of OT1 gone before it tips, and every OT stint
                # comes out zero seconds long.
                out.append({"actionNumber": len(out) + 1, "actionType": "period",
                            "subType": "end", "period": p_base, "gt": "0:00"})
        return out

    @staticmethod
    def _shot_chart(events: list) -> dict:
        """{tno: [shot…]} from the mapped play-by-play, which is the only place shots live.

        Built from the SAME list the stint builder replays so the two share one actionNumber:
        stints._shot_type looks a shot's marker up by that number and measures rim-or-not from the
        coordinates, falling back on the subType label only when it finds none. Numbering the
        chart separately would silently put every game on that fallback.

        x/y are already a percentage of the full court — no at_rim_offset conversion."""
        out: dict = {}
        for e in events:
            if e["actionType"] not in ("2pt", "3pt") or e.get("x") is None:
                continue
            s = S.shot(e["x"], e["y"], made=bool(e.get("success")),
                       three=(e["actionType"] == "3pt"),
                       pno=e.get("pno") or None, period=e["period"])
            s["actionNumber"] = e["actionNumber"]
            out.setdefault(e["tno"], []).append(s)
        return out
