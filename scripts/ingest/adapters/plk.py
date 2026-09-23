# -*- coding: utf-8 -*-
"""The ORLEN Basket Liga (PLK, Poland), from plk.pl's own JSON API.

WHERE THE DATA IS. plk.pl is a Next.js site, and every page of it is rendered from the league's
public JSON API, which answers a plain request - no key, no cookie, no browser:

    GET https://plk.pl/api/webpage/schedule[?seasonId=N]
        the season list (2003/04 on, each with its id), currentSeasonId, and every game of ONE
        season: schedule[league].rounds[].queues[].games[] with id, isFinished, date (UTC),
        home/guestTeam {id, name, logoUrl} and the result. No seasonId = the current season.
    GET https://plk.pl/api/webpage/game/{gameId}
        one game: both rosters, the league's own box score (gameStatistics: playersStatistics,
        the team row, sumStatistics = the two added up) and actionsAndShots[], one entry per
        period (OT = 5, 6 ...), each with its play-by-play and its shot chart.
It is the federation's own data (esor.pzkosz.pl, where the crests live too).

THE KEY is the PLK game id. Every fixture carries it from the day the schedule is published -
all 240 regular-season games of 2026/27 had one on 2026-09-23, nine days before the first tip -
and it is the id of the game page and of the game endpoint, so one key runs from fixture to final.

WHAT IS DISCOVERED. League 2 (Polska Liga Koszykówki) only: the cup (22) and the Superpuchar (29)
come in the same reply and are never discovered. `stage` splits league 2 into the two sources
config/ingest-sources.json has, the way ProA's are split:
    regular   round 1, "Runda Zasadnicza" - 16 clubs, 30 games each, 240 games
    playoffs  every other round: Play-in, Ćwierćfinały, Półfinały, O 3 miejsce, Finał
The configured URL is https://plk.pl/terminarz (the playoff source adds "#playoffs", because
run_ingest keys sources by URL); the adapter reads the API and never that page.

TIP-OFF TIMES. `date` is UTC and `dateLocal` Polish time. A fixture whose time is not set yet says
00:00 local (196 of the 240 in 2026/27 on 2026-09-23): that is not a midnight tip, and read as
one it would put the game on the previous day in UTC. So it becomes noon UTC on the local date,
with extra["time_tbc"] - U SPORTS' convention - until the league publishes the real time.

TEAM IDENTITY. The club code is the PLK's numeric club id, in discover() and fetch() alike - the
schedule row's homeTeam.id IS the game's homeTeam.id. It holds across seasons while the names move
with the sponsors (Tauron GTK Gliwice in 2025/26 is Euvic GTK Gliwice in 2026/27, club 2310
both times), so a renamed club stays one club. Names are the league's own for that season.

THE GAME PAYLOAD is translated into FIBA LiveStats data.json shape and handed to
FibaLiveStatsAdapter.bundle_from_raw, like every other translated league. It is a port of the
scraper's plk_fiba.py, validated there on 20 games over two seasons (OT, double OT, every play-off
round - every player's box exact, the score exact, five a side throughout:
validation/plk/validate_plk.py). Its repairs carry over:
  * the feed's actionNumber is the order actions were TYPED, not played (a correction goes in
    late), so events are stable-sorted by (period, time run off, actionNumber) and then numbered
    1..n: stints.py and translate() both replay a game by actionNumber;
  * a substitution split around another action in the same second is put back together
    (200477: an IN, a free throw, then its OUT - six men on the floor for that free throw);
  * one player, two ids: the feed can log a player's actions under another person id than his
    box row (179630: Mario Ihring, box 65112, every action 108810). The shirt in the action's own
    text ("7, M. Ihring") and his club identify him;
  * a drawn foul ("faulowany") points at the foul it mirrors (previousAction): the other side's
    foul at the same clock time, as FIBA's own foulon does;
  * period starts and ends are written once each - for every period the feed has played, an end
    for every period it has closed (or moved on from) - and a finished game always gets its
    final whistle, whether or not an operator typed "koniec meczu".
Every Polish event string is mapped explicitly, from an inventory of 20 games and 11,421 actions.
A string the tables do not know is not guessed: it is kept on raw["plk"]["unknown"] and printed.

SHOT CHART. x/y copied as they are: the PLK's frame IS FIBA's - full court 0-100 along x, the rims
at about 6 and 94, 0-100 across (805 lay-ups and dunks from 20 games sit on the two rims).

WHAT THE FEED DOES NOT HAVE: second-chance / fast-break / paint / off-turnover points per PLAYER
(the league publishes them per team: they are on the team row, and 0 on every player), and a
shooting foul told apart from any other personal foul.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA
from .twobbl import current_season, normalize_season

API = "https://plk.pl/api/webpage"
PLK_LEAGUE_ID = 2
REGULAR_ROUND_ID = 1            # "Runda Zasadnicza"; every other round of league 2 is the play-offs
#: an unfinished game that tipped this recently may be in progress
LIVE_GUARD_S = 3 * 3600
#: fetchwindow's lead: before it, the game endpoint has nothing to say about a game
FETCH_LEAD_S = 30 * 60


# ============================================================================ the vocabulary
# Actions with no team and no player, keyed on actionType.
GENERIC = {
    "start meczu": None,                                  # game start: nothing to record
    "start części gry": ("period", "start"),
    "koniec części gry": ("period", "end"),
    "koniec meczu": ("game", "end"),
    "sytuacja rzutu sędziowskiego": None,                 # the period-start jump situation
}
# Team actions (teamId set, no player), keyed on actionType.
TEAM = {
    "zbiórka w ataku": ("rebound", "offensive"),
    "zbiórka w obronie": ("rebound", "defensive"),
    "strata - błąd 24 sekund": ("turnover", "shotclock"),
    "strata - błąd 5 sekund": ("turnover", "5sec"),
    "strata - błąd 8 sekund": ("turnover", "8sec"),
    "strata - błąd 3 sekund": ("turnover", "3sec"),
    "strata - poza boiskiem": ("turnover", "outofbounds"),
    "pełna przerwa na żądanie": ("timeout", "full"),
    "przerwa na żądanie": ("timeout", "full"),
    "faul techniczny trenera": ("foul", "coachtechnical"),
    "faul techniczny ławki": ("foul", "benchtechnical"),
    "faul dyskwalifikujący trenera": ("foul", "coachdisqualifying"),
    "faul niesportowy trenera": ("foul", "coachdisqualifying"),
}
TEAM_SKIP_PREFIXES = ("headcoachchallenge", "sytuacja rzutu sędziowskiego")
# Player actions, keyed on actionSubType (shots and free throws are parsed separately).
EVENTS = {
    "zmiana - wejście": ("substitution", "in"),
    "zmiana - zejście": ("substitution", "out"),
    "zbiórka w obronie": ("rebound", "defensive"),
    "zbiórka w ataku": ("rebound", "offensive"),
    "asysta": ("assist", ""),
    "przechwyt": ("steal", ""),
    "blok": ("block", ""),
    "faulowany": ("foulon", ""),
    "faul osobisty": ("foul", "personal"),
    "faul w ataku": ("foul", "offensive"),
    "faul niesportowy": ("foul", "unsportsmanlike"),
    "faul techniczny": ("foul", "technical"),
    "faul dyskwalifikujący": ("foul", "disqualifying"),
    "wygrany rzut sędziowski": ("jumpball", "won"),
    "przegrany rzut sędziowski": ("jumpball", "lost"),
}
TURNOVERS = {
    "strata - złe podanie": "badpass",
    "strata - błąd kozłowania": "ballhandling",
    "strata - poza boiskiem": "outofbounds",
    "strata w ataku": "offensive",
    "strata - błąd kroków": "travel",
    "strata - powrót piłki na pole obrony": "backcourt",
    "strata - błąd 3 sekund": "3sec",
    "strata - błąd 5 sekund": "5sec",
    "strata - błąd 8 sekund": "8sec",
    "strata - błąd 24 sekund": "shotclock",
    "strata - błąd podwójnego kozłowania": "doubledribble",
    "strata - piłka stracona": "lostball",
    "turnover.other": "other",
}
# Shot kinds: the first match wins, so the longer forms come first.
SHOT_KINDS = [
    ("alley-oop wsad", "alleyoopdunk"),
    ("alley-oop", "alleyoop"),                  # "alley-oop" and "alley-oop lay-up"
    ("dobitka wsadem", "tipindunk"),
    ("dobitka", "tipinlayup"),                  # "dobitka lay-up'em": a put-back lay-up
    ("lay-up z drugiej strony", "reverselayup"),
    ("eurostep", "eurostep"),
    ("lay-up", "layup"),
    ("wsad", "dunk"),
    ("hakiem", "hookshot"),
    ("floater", "floatingjumpshot"),
    ("pullup", "pullupjumpshot"),
    ("z odskoku", "stepbackjumpshot"),
    ("z odchylenia", "fadeawayjumpshot"),
    ("z obrotu", "turnaroundjumpshot"),
    ("z wyskoku", "jumpshot"),
]
FT = re.compile(r"^(celny|niecelny) rzut wolny (\d+)z(\d+)$")
PLAYER_FORM = re.compile(r"^\s*(\d+)\s*,\s*(.+?)\s*$")        # actionType "18, S. Tomczak"

# PLK box field -> FIBA stat name
BOX = {
    "points": "sPoints",
    "madeTwoThreePts": "sFieldGoalsMade", "attemptTwoThreePts": "sFieldGoalsAttempted",
    "madeTwoPts": "sTwoPointersMade", "attemptTwoPts": "sTwoPointersAttempted",
    "madeThreePts": "sThreePointersMade", "attemptThreePts": "sThreePointersAttempted",
    "madeFreeThrowPts": "sFreeThrowsMade", "attemptFreeThrowPts": "sFreeThrowsAttempted",
    "reboundsOffensive": "sReboundsOffensive", "reboundsDefensive": "sReboundsDefensive",
    "reboundsTotal": "sReboundsTotal",
    "assists": "sAssists", "turnovers": "sTurnovers", "steals": "sSteals",
    "blocks": "sBlocks", "blocksReveived": "sBlocksReceived",       # (sic) in the feed
    "foulsPersonal": "sFoulsPersonal", "foulsOn": "sFoulsOn",
    "foulsTechnical": "sFoulsTechnical", "foulsUnsportsmanlike": "sFoulsUnsportsmanlike",
    "foulsDisqualifying": "sFoulsDisqualifying",
    "plusMinus": "sPlusMinusPoints",
}
#: per-player splits the PLK publishes per team only: present and 0, the way FIBA's box has them
ZERO_SPLITS = ("sPointsSecondChance", "sPointsFastBreak", "sPointsFromTurnovers", "sPointsInThePaint")
#: the team row's own extras -> FIBA's team totals
TEAM_EXTRAS = {
    "pointsSecondChance": "sPointsSecondChance", "pointsFastBreak": "sPointsFastBreak",
    "pointsFromTurnover": "sPointsFromTurnovers", "pointsInThePaint": "sPointsInThePaint",
    "pointsBench": "sBenchPoints", "biggestLead": "sBiggestLead",
    "biggestScoringRun": "sBiggestScoringRun", "leadChanges": "sLeadChanges",
    "timesScoresLevel": "sTimesScoresLevel", "timeLeading": "sTimeLeading",
}


def classify(e: dict) -> Tuple[Optional[str], str, Optional[int], List[str], Optional[str]]:
    """(actionType, subType, success, qualifier, unknown) for one PLK action.
    actionType None = an action that records nothing (skipped on purpose, or not known)."""
    at = (e.get("actionType") or "").strip()
    sub = (e.get("actionSubType") or "").strip()
    player = bool(PLAYER_FORM.match(at)) and bool(e.get("playerId"))
    if not player:
        if not e.get("teamId"):
            if at in GENERIC:
                v = GENERIC[at]
                return (v[0], v[1], None, [], None) if v else (None, "", None, [], None)
            return None, "", None, [], f"generic:{at}|{sub}"
        if at.startswith(TEAM_SKIP_PREFIXES):
            return None, "", None, [], None
        if at in TEAM:
            a, s = TEAM[at]
            return a, s, None, (["team"] if a in ("rebound", "turnover") else []), None
        return None, "", None, [], f"team:{at}|{sub}"

    s = sub.lower()
    m = FT.match(s)
    if m:
        return "freethrow", f"{m.group(2)}of{m.group(3)}", 1 if m.group(1) == "celny" else 0, [], None
    if s.startswith("niecelny ") or s.startswith("celny "):      # "niecelny" first: it ends in "celny"
        made = 0 if s.startswith("niecelny ") else 1
        rest = s.split(" ", 1)[1]
        value = "3pt" if re.search(r"za 3\b", rest) else "2pt"
        for key, fiba in SHOT_KINDS:
            if key in rest:
                return value, fiba, made, [], None
        return value, "jumpshot", made, [], f"shot:{sub}"
    if sub in EVENTS:
        a, st = EVENTS[sub]
        return a, st, None, [], None
    if sub in TURNOVERS:
        return "turnover", TURNOVERS[sub], None, [], None
    if s.startswith("strata"):
        return "turnover", "other", None, [], f"turnover:{sub}"
    return None, "", None, [], f"player:{sub}"


# ============================================================================ small helpers
def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _secs(clock) -> float:
    """'09:46:00' / '00:41:70' (MM:SS:cc remaining) -> seconds remaining."""
    parts = str(clock or "0:0:0").split(":")
    try:
        mm, ss = int(parts[0]), int(parts[1])
        cc = int(parts[2]) if len(parts) > 2 and parts[2] else 0
    except (ValueError, IndexError):
        return 0.0
    return mm * 60 + ss + cc / 100.0


def _gt(clock) -> str:
    """'MM:SS:cc' -> FIBA's 'MM:SS' (whole seconds)."""
    parts = str(clock or "00:00").split(":")
    try:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    except (ValueError, IndexError):
        return "00:00"


def _mmss(seconds) -> str:
    s = int(seconds or 0)
    return f"{s // 60}:{s % 60:02d}"


def utc_iso(date_str) -> Optional[str]:
    """'2025-12-23T16:30:00.000Z' -> '2025-12-23T16:30:00+00:00'."""
    s = str(date_str or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def fixture_tip(row: dict) -> Tuple[Optional[str], bool]:
    """(tip-off in UTC, time still to be confirmed) for one schedule row. 00:00 local is the
    league's "no time yet": noon UTC on that local date keeps the calendar day everywhere."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})", str(row.get("dateLocal") or ""))
    if m and m.group(4) == "00" and m.group(5) == "00":
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T12:00:00+00:00", True
    return utc_iso(row.get("date")), False


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (t - now).total_seconds() > FETCH_LEAD_S


# ============================================================================ the schedule
def season_games(schedule: dict, leagues=(PLK_LEAGUE_ID,)) -> List[dict]:
    """Every game row of a schedule reply, flattened, with its round and queue attached."""
    out = []
    for lg in schedule.get("schedule") or []:
        if leagues and _num(lg.get("id")) not in leagues:
            continue
        for rnd in lg.get("rounds") or []:
            for q in rnd.get("queues") or []:
                for g in q.get("games") or []:
                    row = dict(g)
                    row["_round"] = (rnd.get("name") or "").strip()
                    row["_round_id"] = _num(rnd.get("id"))
                    row["_queue"] = (q.get("name") or "").strip()
                    out.append(row)
    return out


def stage_of(row: dict) -> str:
    return "regular" if _num(row.get("_round_id")) == REGULAR_ROUND_ID else "playoffs"


def season_id_for(season: str, schedule: dict) -> Optional[int]:
    """'2026/2027' -> the PLK's own id for it, read from the reply's season list (never guessed)."""
    for s in schedule.get("seasons") or []:
        if str(s.get("name") or "").strip() == season:
            return _num(s.get("id")) or None
    return None


def round_label(row: dict) -> str:
    """'Runda Zasadnicza · 1 kolejka', 'Ćwierćfinały · Mecz 3' - the round, then its queue."""
    return " · ".join(x for x in (row.get("_round"), row.get("_queue")) if x)


# ============================================================================ one game
def _group_substitutions(chrono: List[dict]) -> List[dict]:
    """A substitution split around another action in the same second is put back together.

    The operator types the two halves of one change as they come, so an IN can precede a free
    throw and its OUT follow it (200477: Goins in #876, a free throw #877, Zapala out #878) - six
    men on the floor for that one action. Every substitution of a second moves up to where the
    first substitution of that second was typed, in its own order: the change happened when it
    began to be entered, and the lineup changes once instead of twice."""
    out: List[dict] = []
    i, n = 0, len(chrono)
    while i < n:
        ev = chrono[i]
        if ev["actionType"] != "substitution":
            out.append(ev)
            i += 1
            continue
        key = (ev["period"], ev["periodType"], ev["gt"])
        j = i
        subs, others = [], []
        while j < n and (chrono[j]["period"], chrono[j]["periodType"], chrono[j]["gt"]) == key:
            (subs if chrono[j]["actionType"] == "substitution" else others).append(chrono[j])
            j += 1
        out.extend(subs)
        out.extend(others)
        i = j
    return out


def _link_drawn_fouls(events: List[dict]) -> None:
    """previousAction on every foulon: the other side's foul at the same clock time - the one
    typed just before it, else the one just after (an operator can type either first)."""
    fouls: Dict[tuple, List[int]] = {}
    for i, e in enumerate(events):
        if e["actionType"] == "foul" and e["tno"] in (1, 2):
            fouls.setdefault((e["period"], e["periodType"], e["gt"], e["tno"]), []).append(i)
    for i, e in enumerate(events):
        if e["actionType"] != "foulon" or e["tno"] not in (1, 2):
            continue
        cands = fouls.get((e["period"], e["periodType"], e["gt"], 3 - e["tno"])) or []
        before = [j for j in cands if j < i]
        after = [j for j in cands if j > i]
        j = before[-1] if before else (after[0] if after else None)
        if j is not None:
            e["previousAction"] = events[j]["actionNumber"]


def raw_from_game(reply: dict) -> Optional[dict]:
    """One plk.pl game reply -> FIBA data.json shape: play-by-play OLDEST first, actionNumber
    1..n, periods and the final whistle written once each. Pure: same input, same output.

    None when there is nothing to show yet (no game, or not one action typed)."""
    g = reply.get("game") if isinstance(reply, dict) and "game" in reply else reply
    if not isinstance(g, dict) or not g.get("homeTeam") or not g.get("guestTeam"):
        return None
    periods = [q for q in (g.get("actionsAndShots") or []) if _num(q.get("quarterNumber"))]
    if not any(q.get("playByPlay") for q in periods):
        return None
    home_id, guest_id = _num(g["homeTeam"].get("id")), _num(g["guestTeam"].get("id"))
    tno_of = {home_id: 1, guest_id: 2}

    # ------------------------------------------------------------------ people and the box
    people: Dict[int, dict] = {}
    by_shirt: Dict[Tuple[int, str], int] = {}               # (tno, shirt) -> box player id
    for tno, key in ((1, "homeTeam"), (2, "guestTeam")):
        for p in (g.get(key) or {}).get("players") or []:
            pid = _num(p.get("id"))
            people[pid] = {"first": (p.get("firstName") or "").strip(),
                           "last": (p.get("lastName") or "").strip(),
                           "shirt": str(p.get("shirtNumber") or "").strip(), "tno": tno}
            if people[pid]["shirt"]:
                by_shirt[(tno, people[pid]["shirt"])] = pid

    tm: Dict[str, dict] = {}
    for tno, key in ((1, "homeTeam"), (2, "guestTeam")):
        t = g.get(key) or {}
        gs = t.get("gameStatistics") or {}
        pl: Dict[str, dict] = {}
        for row in gs.get("playersStatistics") or []:
            pid = _num(row.get("playerId"))
            who = people.get(pid, {})
            first, last = who.get("first", ""), who.get("last", "")
            p = {"firstName": first, "familyName": last, "name": f"{first} {last}".strip(),
                 "internationalFirstName": first, "internationalFamilyName": last,
                 "scoreboardName": (f"{first[:1]}. {last}" if first else last).strip(),
                 "shirtNumber": who.get("shirt", ""), "playingPosition": "",
                 "starter": 1 if _num(row.get("isStart5")) else 0, "active": 1,
                 "sMinutes": _mmss(row.get("playTimeSeconds"))}
            for k, fiba in BOX.items():
                p[fiba] = _num(row.get(k))
            for k in ZERO_SPLITS:
                p[k] = 0
            pl[str(pid)] = p
        # THE LEAGUE'S OWN TEAM TOTALS: sumStatistics is the players plus the team row (team
        # rebounds, team turnovers, bench fouls) - exactly, on 40 of 40 team-games checked - which
        # is what a FIBA team total is. Summed from the two when a reply has no sum row.
        total = gs.get("sumStatistics") or {}
        team_row = gs.get("teamStatistics") or {}
        tot = {}
        for k, fiba in BOX.items():
            v = total.get(k) if k in total else (sum(_num(r.get(k)) for r in gs.get("playersStatistics") or [])
                                                 + _num(team_row.get(k)))
            tot["tot_" + fiba] = _num(v)
        tot["tot_sReboundsTeamOffensive"] = _num(team_row.get("reboundsOffensive"))
        tot["tot_sReboundsTeamDefensive"] = _num(team_row.get("reboundsDefensive"))
        tot["tot_sReboundsTeam"] = _num(team_row.get("reboundsTotal"))
        tot["tot_sTurnoversTeam"] = _num(team_row.get("turnovers"))
        ext = t.get("teamStatistics") or {}
        for k, fiba in TEAM_EXTRAS.items():
            tot["tot_" + fiba] = _num(ext.get(k))
        logo = (t.get("logoUrl") or t.get("websiteLogoUrl") or "").strip()
        name = (t.get("name") or g.get("homeTeamName" if tno == 1 else "guestTeamName") or "").strip()
        tm[str(tno)] = {
            "name": name, "nameInternational": name,
            "shortName": (t.get("shortName") or name).strip(),
            "code": str(_num(t.get("id")) or ""),
            "score": _num(g.get("resultHome") if tno == 1 else g.get("resultGuest")),
            "coachDetails": [{"firstName": (c.get("firstName") or "").strip(),
                              "familyName": (c.get("lastName") or "").strip()}
                             for c in (t.get("coaches") or [])[:1]],
            "pl": pl, "shot": [], **tot,
        }
        if logo.startswith("https://"):
            tm[str(tno)]["logoT"] = {"url": logo}
            tm[str(tno)]["logoS"] = {"url": logo}

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    repairs: List[str] = []
    keyed: List[Tuple[tuple, dict]] = []
    by_feed_an: Dict[int, dict] = {}
    shots_in: List[dict] = []
    closed = set()                      # periods the feed says have ended
    whistle = False                     # "koniec meczu" typed
    for q in periods:
        qn = _num(q.get("quarterNumber"))
        plen = 600 if qn <= 4 else 300
        for e in q.get("playByPlay") or []:
            a, st, success, quals, unk = classify(e)
            if unk:
                unknown.append(unk)
            if not a:
                continue
            if a == "period":
                if st == "end":
                    closed.add(qn)
                continue                # written once each, below
            if a == "game":
                whistle = True
                continue
            pid = _num(e.get("playerId"))
            tno = tno_of.get(_num(e.get("teamId")), 0)
            # ONE PLAYER, TWO IDS: moved onto the box player wearing the action's shirt for that club
            if pid and pid not in people and tno in (1, 2):
                m = PLAYER_FORM.match(e.get("actionType") or "")
                box_pid = by_shirt.get((tno, m.group(1))) if m else None
                if box_pid:
                    repairs.append(f"pid {pid} -> {box_pid} (#{m.group(1)})")
                    pid = box_pid
            who = people.get(pid) or {}
            shirt = who.get("shirt", "")
            if pid and not shirt:
                m = PLAYER_FORM.match(e.get("actionType") or "")
                shirt = m.group(1) if m else ""
            feed_an = _num(e.get("actionNumber"))
            ev = {
                "actionNumber": feed_an,
                "period": qn if qn <= 4 else qn - 4,
                "periodType": "REGULAR" if qn <= 4 else "OVERTIME",
                "gt": _gt(e.get("time")),
                "s1": str(_num(e.get("pointsHome"))), "s2": str(_num(e.get("pointsGuest"))),
                "tno": tno, "pno": str(pid) if pid else "",
                "actionType": a, "subType": st, "qualifier": quals,
                "success": success if success is not None else 0,
                "scoring": 1 if (a in ("2pt", "3pt", "freethrow") and success == 1) else 0,
                "shirtNumber": shirt,
                "firstName": who.get("first", ""), "familyName": who.get("last", ""),
                "player": f"{who.get('first', '')} {who.get('last', '')}".strip() if pid else "",
            }
            by_feed_an[feed_an] = ev
            keyed.append(((qn, plen - _secs(e.get("time")), feed_an), ev))
        shots_in.extend(q.get("shots") or [])
    keyed.sort(key=lambda kv: kv[0])
    chrono = _group_substitutions([ev for _, ev in keyed])

    # periods: one start for every period played, one end for every period closed or left behind
    def pnum(ev):
        return ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)

    played = {pnum(ev) for ev in chrono} | closed
    last_q = max(played) if played else 1
    finished = bool(g.get("isFinished")) or whistle
    closed |= {qn for qn in range(1, last_q)}
    if finished:
        closed.add(last_q)
    by_q: Dict[int, List[dict]] = {}
    for ev in chrono:
        by_q.setdefault(pnum(ev), []).append(ev)
    score = ["0", "0"]

    def marker(qn, action, sub, clock):
        return {"actionNumber": 0, "period": qn if qn <= 4 else qn - 4,
                "periodType": "REGULAR" if qn <= 4 else "OVERTIME", "gt": clock,
                "s1": score[0], "s2": score[1], "tno": 0, "pno": "",
                "actionType": action, "subType": sub, "qualifier": [], "success": 0, "scoring": 0,
                "shirtNumber": "", "firstName": "", "familyName": "", "player": ""}

    events: List[dict] = []
    for qn in range(1, last_q + 1):
        events.append(marker(qn, "period", "start", "10:00" if qn <= 4 else "05:00"))
        for ev in by_q.get(qn, []):
            events.append(ev)
            score = [ev["s1"], ev["s2"]]
        if qn in closed:
            events.append(marker(qn, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n
    _link_drawn_fouls(events)

    # the shot chart, joined to its action by the feed's own number, renumbered with it
    for s in shots_in:
        ev = by_feed_an.get(_num(s.get("actionNumber")))
        if not ev or ev["actionType"] not in ("2pt", "3pt") or ev["tno"] not in (1, 2):
            continue
        if s.get("x") is None or s.get("y") is None:
            continue
        tm[str(ev["tno"])]["shot"].append({
            "r": ev["success"], "x": s.get("x"), "y": s.get("y"),
            "actionType": ev["actionType"], "subType": ev["subType"],
            "actionNumber": ev["actionNumber"], "pno": ev["pno"],
            "per": ev["period"], "perType": ev["periodType"],
            "player": ev["player"], "shirtNumber": ev["shirtNumber"]})

    # period scores: p1..p4 as FIBA writes them, p5.. for overtimes (read by period number), and
    # FIBA's own ot_score / full_score beside them
    for q in periods:
        qn = _num(q.get("quarterNumber"))
        tm["1"][f"p{qn}_score"] = _num(q.get("resultHome"))
        tm["2"][f"p{qn}_score"] = _num(q.get("resultAway"))
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(v for k, v in tm[s].items() if re.fullmatch(r"p(\d+)_score", k)
                                and int(k[1:-6]) > 4)
        tm[s]["full_score"] = tm[s]["score"]

    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    else:
        raw["clock"] = last_play["gt"] if last_play and pnum(last_play) == last_q else (
            "10:00" if last_q <= 4 else "05:00")
    raw["plk"] = {"gameId": str(g.get("id") or ""), "seasonId": _num(g.get("seasonId")),
                  "round": (g.get("round") or {}).get("name"), "queue": (g.get("queue") or {}).get("name"),
                  "date": utc_iso(g.get("date")), "isFinished": bool(g.get("isFinished")),
                  "venue": ((g.get("venue") or {}).get("name") or "").strip() or None,
                  "unknown": sorted(set(unknown)), "repairs": sorted(set(repairs))}
    return raw


# ============================================================================ the adapter
class PlkAdapter(FibaLiveStatsAdapter):
    """The ORLEN Basket Liga. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "plk"
    #: a league's own website, not a CDN built to be polled
    min_request_gap_s = 1.0

    # shared across instances: two sources (regular + playoffs) read one schedule in one run
    _schedules: dict = {}       # season id (0 = the current one) -> (fetched_at, reply)
    SCHEDULE_TTL_S = 300.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"plk: stage must be 'regular' or 'playoffs', not {stage!r}")
        sched = self._schedule(season)
        if sched is None:
            return []
        now = datetime.now(timezone.utc)
        out = []
        for r in season_games(sched):
            if stage and stage_of(r) != stage:
                continue
            gid = str(r.get("id") or "").strip()
            home, away = r.get("homeTeam") or {}, r.get("guestTeam") or {}
            if not gid or not home.get("id") or not away.get("id"):
                continue
            tip, tbc = fixture_tip(r)
            extra = {"home_code": str(_num(home.get("id"))), "away_code": str(_num(away.get("id"))),
                     "home_logo": self._logo(home), "away_logo": self._logo(away),
                     "round": round_label(r), "stage": stage_of(r)}
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(
                external_id=gid,
                home_name=(home.get("name") or r.get("homeTeamName") or "").strip(),
                away_name=(away.get("name") or r.get("guestTeamName") or "").strip(),
                tipoff_at=tip, status=self._fixture_status(r, None if tbc else tip, now), extra=extra))
        print(f"     PLK {season} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final, "
              f"{sum(1 for g in out if g.status == 'live')} live)")
        return out

    @staticmethod
    def _season(config: dict) -> str:
        tok = config.get("season")
        if not tok:
            return current_season()
        season = normalize_season(tok)
        if not season:
            raise ValueError(f"plk: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    @staticmethod
    def _logo(team: dict) -> Optional[str]:
        u = (team.get("logoUrl") or team.get("websiteLogoUrl") or "").strip()
        return u if u.startswith("https://") else None

    @staticmethod
    def _fixture_status(r: dict, tip: Optional[str], now: datetime) -> str:
        if r.get("isFinished"):
            return "final"
        try:
            t = datetime.fromisoformat(tip) if tip else None
        except ValueError:
            t = None
        if t and t <= now and (now - t).total_seconds() < LIVE_GUARD_S:
            return "live"
        return "scheduled"

    def _schedule(self, season: str) -> Optional[dict]:
        """The season's schedule reply - or None, loudly, when plk.pl has no such season yet.

        The reply without a seasonId IS the current season, and names every season with its id,
        so the current season costs one request and any other two."""
        base = self._cached_schedule(0)
        if base is None:
            raise RuntimeError("plk: schedule API unreachable")
        sid = season_id_for(season, base)
        if sid is None:
            names = [s.get("name") for s in base.get("seasons") or []][-4:]
            print(f"     PLK: plk.pl has no season {season} (it lists {', '.join(map(str, names))} ...)")
            return None
        if sid == _num(base.get("currentSeasonId")):
            return base
        got = self._cached_schedule(sid)
        if got is None:
            raise RuntimeError(f"plk: schedule API unreachable for season {season}")
        return got

    def _cached_schedule(self, sid: int) -> Optional[dict]:
        at, reply = self._schedules.get(sid, (0.0, None))
        if reply is not None and time.time() - at < self.SCHEDULE_TTL_S:
            return reply
        reply = self._get_json(f"{API}/schedule" + (f"?seasonId={sid}" if sid else ""))
        if not isinstance(reply, dict) or "schedule" not in reply:
            return None
        self._schedules[sid] = (time.time(), reply)
        return reply

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit() or _too_early(config.get("_tipoff_at")):
            return None                   # decided before a single request is made
        reply = self._get_json(f"{API}/game/{gid}")
        if not isinstance(reply, dict):
            return None
        raw = raw_from_game(reply)
        if raw is None:
            return None
        if raw["plk"]["unknown"]:
            print(f"     PLK {gid}: {len(raw['plk']['unknown'])} action string(s) the adapter does not "
                  f"know, left out: {raw['plk']['unknown'][:4]}")
        if raw["plk"]["repairs"]:
            print(f"     PLK {gid}: identity repairs {raw['plk']['repairs']}")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = config.get("_tipoff_at") or raw["plk"]["date"]
        return b

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(PlkAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        PlkAdapter._last_req = time.time()

    def _get_json(self, url: str):
        self._pause()
        for attempt in range(3):
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=40)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    return None
            time.sleep(1.5 * (attempt + 1))
        return None
