# -*- coding: utf-8 -*-
"""The Spanish federation's leagues, from its live-score site (baloncestoenvivo.feb.es).

ONE SITE, SIX LEAGUES. Everything the FEB runs is scored on the same system and shown on the same
site, so one adapter carries them all and a league is a config row: `competition` is the site's
own number for it (the `g=` of calendario.aspx):

    1  Primera FEB        2  Segunda FEB          4  Liga Femenina Endesa
    9  Liga Femenina 2    67 Liga Femenina Challenge    74 Liga U
    (3 Tercera FEB is on the same system and deliberately not configured.)

robots.txt: baloncestoenvivo.feb.es and intrafeb.feb.es publish none (404) and www.feb.es disallows
nothing, so every path used here is open.

THE SCHEDULE is server-rendered ASP.NET, one request per group:
    calendario.aspx?g=<competition>&t=<season start year>
        -> /calendario/<name>/<g>/<t>: every game of the selected group, round by round. A played
           game shows its score; a game to come shows its date and local time.
    A league in more than one group (Segunda FEB "A"/"B", LF2, Liga U) lists them in a dropdown,
    and the other group is an ASP.NET postback of that dropdown (the page's own hidden fields sent
    back), which plain requests do.
    Knockout rounds (Play-offs 1/4, 1/2, Final) are not on the calendar. The results page
    (resultados.aspx) links them from its bracket as series/<f>, one page listing every series and
    game of the phase with both clubs, the score and the date.
THE STAGE: a group named "Liga Regular ..." is the regular season; every other group or phase
(play-offs, Liga U's second phase and play-outs) is the "playoffs" source - except a CUP. LF
Endesa's pages carry the Supercopa and the Copa de la Reina as phases of the league, and the game
feed cannot tell those games from the league's, so a phase named for a cup is never read as the
league's, and the cup games seen are remembered (data/feed/<CODE>/feb.json "cup_games") so that no
lane - the live lane fetches by stored id, without a schedule - fetches one as the league's.
GROUPS: a league played in two groups carries each fixture's group (home_group / away_group) so
the table splits itself (groups_from_feed in the source row).

THE GAME is one request to the federation's own stats API:
    intrafeb.feb.es/LiveStats.API/api/v1/KeyFacts/<game>
with the site's public app token (a hidden input on every page, valid 24 hours, scoped to the six
read-only widget endpoints). KeyFacts carries the whole box score (SCOREBOARD - identical, field for
field, to the BoxScore endpoint's) and the whole play-by-play, and every shot in it carries its
court position - identical to the ShotChart endpoint's - so a game costs ONE request, never three.
A game not yet played answers 404.

WHAT THE PLAY-BY-PLAY SAYS, action by action (inventory of seven games, 3,768 lines, every league):
    shoot     logParam6 = 2 or 3, logParam4 = made, logParam5 9 = dunk; Position "x|y" on FIBA's
              frame (full court 0-100 along x, rims at ~5.6 / ~94.4, 0-100 across - dunks sit on it)
    fthrow    logParam4 = made
    foul      logParam3 = kind (1 personal, 2 technical, 6 coach, 8 offensive), logParam6 = free
              throws awarded, logParam4 = the LICENCE of the player fouled -> the drawn foul
    subst     logParam2 = licence going off, logParam3 = licence coming on
    rebound   no offensive/defensive flag: a rebound after its own side's miss is offensive. That
              reproduces every player's box exactly (seven games); a line with no player is a team
              rebound
    lose (turnover), recovery (steal), assist, blockshot, timeout; period (start/end markers)
    A line with no player on lose / foul / rebound is the team's (a coach technical is
    "Entrenador: FALTA Técnica").
Every player of the play-by-play is in the box, licence -> player is one to one, the clock never
runs backwards in line order, periods add up to the score, and fouls drawn, turnovers and fouls
per player are the box's exactly - checked on all seven.

HOME IS THE FIRST TEAM. The API's first team is the side the federation lists as local, on the
calendar and on its own game page (even the 2025/26 Primera FEB final, played in Coruña with
Estudiantes as local). A fixture whose calendar says otherwise is turned round.

TIMES ARE LOCAL TO THE VENUE. The Canary Islands are an hour behind the peninsula, and the site
prints each game in its own local time: SPAR Gran Canaria's 12:00 tip (LF Endesa, 12 Oct 2025) is
logged from 11:01 UTC. So a Canary home game is read in Atlantic/Canary, every other in
Europe/Madrid. At the fixture the home club's name decides (a regex, with what fetched games
have taught - below); once a game is fetched its venue's province decides for good.

NAMES. The box prints "C. BARTON"; the club's page lists "CHARLES WILLIAM BARTON" under the same
player id, so each club's page is read once per season (only when a box has a player it has not
seen). A player the club's page does not list (a late signing, a youth licence) is read off his own
page ("GARCIA CALVO, SERGI"), four a game at most. Both are remembered with the clubs' time zones
in data/feed/<CODE>/feb.json - which the ingest worker commits, so the next run does not ask again.
A player nobody names keeps the box's initial.

DATA SAVING: one request per game (KeyFacts only), the token read off pages the pass fetches
anyway, a club's roster once a season, calendars cached for five minutes across the two sources of
a league, a 1-second gap between requests, and a fixture more than half an hour away never fetched.
"""
from __future__ import annotations

import base64
import html
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA, ZoneInfo
from .plk import _group_substitutions, _mmss

SITE = "https://baloncestoenvivo.feb.es"
API = "https://intrafeb.feb.es/LiveStats.API/api/v1"
MADRID, CANARY = "Europe/Madrid", "Atlantic/Canary"
#: the site's own slug per competition number (only used to build a readable URL; g= is the key)
SLUGS = {1: "primerafeb", 2: "segundafeb", 3: "tercerafeb", 4: "lfendesa", 9: "lf2", 67: "lfchallenge", 74: "ligau"}
#: an unfinished game that tipped this recently may be in progress
LIVE_GUARD_S = 3 * 3600
#: before this, the game endpoint has nothing to say about a game
FETCH_LEAD_S = 30 * 60
REGULAR = re.compile(r"^\s*liga\s+regular", re.I)
#: a cup the site files under a league: LF Endesa's page carries the Supercopa and the Copa de S.M. la
#: Reina ("C.SM Reina 1/4 Final") as phases of its own, and their games are indistinguishable from the
#: league's in the game feed (the 2025/26 Supercopa final says CompID 210, 'LF ENDESA', round 'Final').
#: The phase name is the only thing that tells them apart, so it is read here and nowhere else.
CUP = re.compile(r"super\s*copa|\bcopa\b|\breina\b|\bcup\b", re.I)
#: a home club in the Canary Islands, by name (the fixture list prints no venue)
CANARY_CLUB = re.compile(r"CANARIA|TENERIFE|LANZAROTE|FUERTEVENTURA|\bLA\s+LAGUNA\b|LAGUNERA|\bLA\s+PALMA\b|"
                         r"GOMERA|\bHIERRO\b|\bTELDE\b|\bARUCAS\b|\bADEJE\b|\bT[IÍ]AS\b|\bARONA\b|\bG[AÁ]LDAR\b|"
                         r"\bARRECIFE\b|\bMAGEC\b", re.I)
#: ...and by the venue's province, which the game feed prints
CANARY_PLACE = re.compile(r"\bLas\s+Palmas\b|\bPalmas,\s*Las\b|Santa\s+Cruz\s+de\s+Tenerife", re.I)

_TAG = re.compile(r"<[^>]+>")
_GAME = re.compile(r"(?:Partido\.aspx\?p=|/partido/)(\d+)", re.I)
_TEAM = re.compile(r"Equipo\.aspx\?i=(\d+)\"[^>]*>([^<]+)</a>", re.I)
_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
_HOUR = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_SCORE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")


# ============================================================================ small helpers
def _text(s) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", str(s or "")))).strip()


def _n(v) -> int:
    """'12' / '0,0' / None -> an int (the API sends numbers as strings, decimals with a comma)."""
    s = str(v if v is not None else "").strip().replace(",", ".")
    try:
        return int(float(s)) if s else 0
    except ValueError:
        return 0


def _clock_secs(t) -> int:
    m = re.match(r"^\s*(\d+):(\d{2})", str(t or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _gt(t) -> str:
    s = _clock_secs(t)
    return f"{s // 60:02d}:{s % 60:02d}"


def _start_year(season) -> int:
    """'2026-27' / '2026/2027' / '2026' -> 2026; nothing -> the current season (August cut-over)."""
    m = re.match(r"(\d{4})", str(season or ""))
    if m:
        return int(m.group(1))
    now = time.gmtime()
    return now.tm_year if now.tm_mon >= 8 else now.tm_year - 1


def local_to_utc(y, mo, d, h, mi, tz: str) -> Optional[str]:
    if ZoneInfo is None:
        return None
    try:
        t = datetime(int(y), int(mo), int(d), int(h), int(mi), tzinfo=ZoneInfo(tz))
    except (ValueError, KeyError):
        return None
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def noon_utc(y, mo, d) -> str:
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}T12:00:00Z"


def group_label(name: str) -> str:
    """'Liga Regular "A"' -> 'Grupo A'; 'LIGA REGULAR GRUPO "B"' -> 'Grupo B'; '"ESTE"' -> 'Este'."""
    m = re.search(r'"([^"]+)"', html.unescape(name or ""))
    q = (m.group(1) if m else re.sub(r"(?i)^\s*liga\s+regular\s*(grupo)?", "", html.unescape(name or ""))).strip()
    if not q or q.lower() in ("único", "unico"):
        return ""
    return f"Grupo {q.upper()}" if len(q) <= 2 else q.title()


def jwt_exp(token: str) -> float:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return float(json.loads(base64.urlsafe_b64decode(part)).get("exp") or 0)
    except Exception:
        return 0.0


# ============================================================================ the pages
def hidden_fields(page: str) -> dict:
    out = {}
    for m in re.finditer(r"<input[^>]*type=\"hidden\"[^>]*>", page, re.I):
        tag = m.group(0)
        nm = re.search(r'name="([^"]+)"', tag)
        if nm:
            val = re.search(r'value="([^"]*)"', tag)
            out[html.unescape(nm.group(1))] = html.unescape(val.group(1)) if val else ""
    return out


def page_token(page: str) -> Optional[str]:
    return hidden_fields(page).get("_ctl0:token") or None


def selects(page: str) -> Dict[str, List[Tuple[str, str, bool]]]:
    """{select name: [(value, label, selected)]}"""
    out = {}
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', page, re.S | re.I):
        out[html.unescape(m.group(1))] = [(v, _text(lbl), "selected" in a)
                                          for a, v, lbl in re.findall(r'<option([^>]*)value="([^"]*)"[^>]*>([^<]*)</option>',
                                                                      m.group(2))]
    return out


def groups_of(page: str) -> List[Tuple[str, str, bool]]:
    for name, opts in selects(page).items():
        if name.endswith("gruposDropDownList"):
            return opts
    return []


def calendar_games(page: str) -> List[dict]:
    """Every fixture on one calendar page, in round order."""
    out = []
    heads = [(m.start(), _text(m.group(1))) for m in re.finditer(r'<h1 class="titulo-modulo">(.*?)</h1>', page, re.S)]
    for m in re.finditer(r'<td class="equipo local">(.*?)</td>\s*<td class="(fecha|resultado)">(.*?)</td>\s*'
                         r'<td class="equipo visitante">(.*?)</td>', page, re.S):
        home, away, gid = _TEAM.search(m.group(1)), _TEAM.search(m.group(4)), _GAME.search(m.group(3))
        if not (home and away and gid):
            continue                     # a bye, or a row the site prints without a game
        head = next((h for pos, h in reversed(heads) if pos < m.start()), "")
        rnd = re.sub(r"\s*\d{1,2}/\d{1,2}/\d{4}\s*$", "", head).strip()
        cell = _text(m.group(3))
        g = {"id": gid.group(1), "home_id": home.group(1), "home": _text(home.group(2)),
             "away_id": away.group(1), "away": _text(away.group(2)), "round": rnd,
             "date": None, "hour": None, "score": None}
        sc = _SCORE.match(cell)
        if m.group(2) == "resultado" and sc:
            g["score"] = (int(sc.group(1)), int(sc.group(2)))
            d = _DATE.search(head)            # a played game shows only its score: the round's date
            g["date"] = d.groups() if d else None
        else:
            d, h = _DATE.search(cell), _HOUR.search(cell)
            g["date"] = d.groups() if d else None
            g["hour"] = h.groups() if h else None
        out.append(g)
    return out


def series_links(page: str) -> List[str]:
    return sorted(set(re.findall(r"(?:Series\.aspx\?f=|/series/)(\d+)", page, re.I)))


def series_games(page: str) -> List[dict]:
    """A play-off phase's page: every series (h1 '1/4 Final. A - B') and its games."""
    out = []
    heads = [(m.start(), _text(m.group(1))) for m in re.finditer(r'<h1 class="titulo-modulo">(.*?)</h1>', page, re.S)]
    for m in re.finditer(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", page, re.S):
        teams = _TEAM.findall(m.group(1))
        gid = _GAME.search(m.group(2))
        if len(teams) != 2 or not gid:
            continue
        head = next((h for pos, h in reversed(heads) if pos < m.start()), "")
        rnd = head.split(".")[0].strip() if "." in head else head
        cell, when = _text(m.group(2)), _text(m.group(3))
        sc = _SCORE.match(cell.replace(" ", "")) or _SCORE.match(cell)
        d, h = _DATE.search(when), _HOUR.search(when)
        out.append({"id": gid.group(1), "home_id": teams[0][0], "home": _text(teams[0][1]),
                    "away_id": teams[1][0], "away": _text(teams[1][1]), "round": rnd,
                    "date": d.groups() if d else None, "hour": h.groups() if h else None,
                    "score": (int(sc.group(1)), int(sc.group(2))) if sc else None})
    return out


def roster_names(page: str) -> Dict[str, str]:
    """A club's page: {player id: 'CHARLES WILLIAM BARTON'}."""
    out = {}
    for m in re.finditer(r'<td class="nombre jugador">\s*<a href=[\'"][^\'"]*?[?&](?:amp;)?c=(\d+)[^\'"]*[\'"]>([^<]+)</a>',
                         page, re.I):
        out[m.group(1)] = _text(m.group(2))
    return out


def player_page_name(page: str) -> Optional[str]:
    """A player's own page prints 'GARCIA CALVO, SERGI' -> 'SERGI GARCIA CALVO'."""
    m = re.search(r'class="[^"]*nombre[^"]*"[^>]*>(.*?)</', page or "", re.S | re.I)
    if not m:
        return None
    name = _text(m.group(1))
    if "," in name:
        family, first = (s.strip() for s in name.split(",", 1))
        name = f"{first} {family}".strip()
    return name or None


# ============================================================================ one game
FOUL_CODES = {"1": "personal", "2": "technical", "3": "unsportsmanlike", "4": "disqualifying",
              "6": "coachtechnical", "8": "offensive"}


def foul_kind(line: dict) -> Tuple[str, Optional[str]]:
    """(FIBA foul subType, an unknown description or None) - by the words first, the code second."""
    txt = (line.get("text") or "").lower()
    has_player = bool(line.get("idPlayer"))
    coach = "entrenador" in txt
    if "descalificante" in txt:
        return ("disqualifying" if has_player else "coachdisqualifying"), None
    if "antideportiva" in txt:
        return "unsportsmanlike", None
    if "técnica" in txt or "tecnica" in txt:
        if has_player:
            return "technical", None
        return ("coachtechnical" if coach else "benchtechnical"), None
    if "ofensiva" in txt:
        return "offensive", None
    if "personal" in txt:
        return "personal", None
    code = FOUL_CODES.get(str(line.get("logParam3") or ""))
    if code:
        return code, None
    return "personal", f"foul:{line.get('logParam3')}:{line.get('text')}"


def split_name(box_name: str, full: Optional[str]) -> Tuple[str, str]:
    """('C. BARTON', 'CHARLES WILLIAM BARTON') -> ('CHARLES WILLIAM', 'BARTON').
    The box's surname part decides where the full name splits; without a full name, the initial."""
    box_name = (box_name or "").strip()
    m = re.match(r"^\s*([^\s.]{1,3}\.)\s*(.+)$", box_name)
    initial, family = (m.group(1), m.group(2).strip()) if m else ("", box_name)
    if full:
        f = full.strip()
        if family and f.upper().endswith(family.upper()) and len(f) > len(family):
            return f[: len(f) - len(family)].strip(), f[len(f) - len(family):].strip()
        parts = f.split()
        if len(parts) > 1:
            return parts[0], " ".join(parts[1:])
    return initial, family


def is_final(header: dict) -> bool:
    return (str(header.get("statusText") or "").upper() == "FINISHED" or str(header.get("status") or "") == "3"
            or str(header.get("time") or "").upper() == "FINAL")


def header_tip(header: dict) -> Optional[str]:
    """'07-06-2026 - 19:00' (local to the venue) -> UTC."""
    m = re.match(r"\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*-\s*(\d{1,2}):(\d{2})", str(header.get("starttime") or ""))
    if not m:
        return None
    d, mo, y, h, mi = m.groups()
    tz = CANARY if CANARY_PLACE.search(str(header.get("place") or "")) else MADRID
    return local_to_utc(y, mo, d, h, mi, tz)


def raw_from_keyfacts(reply: dict, home_id: Optional[str] = None,
                      rosters: Optional[Dict[str, str]] = None) -> Optional[dict]:
    """One KeyFacts reply -> FIBA LiveStats data.json shape (the shape plk.raw_from_game writes and
    FibaLiveStatsAdapter.bundle_from_raw, stints.py and translate() already read): play-by-play oldest
    first, actionNumber 1..n, periods opened and closed once each, the final whistle on a finished
    game, drawn fouls linked, shots charted. Pure: the same reply gives the same payload.

    None when there is nothing to show yet (no teams, or not one line of play-by-play)."""
    if not isinstance(reply, dict):
        return None
    header = reply.get("HEADER") or {}
    hteams = header.get("TEAM") or []
    sb_teams = ((reply.get("SCOREBOARD") or {}).get("TEAM")) or []
    lines = [l for l in (((reply.get("PLAYBYPLAY") or {}).get("LINES")) or []) if not l.get("deleted")]
    if len(hteams) != 2 or not lines:
        return None
    rosters = rosters or {}
    ida, idb = str(hteams[0].get("id") or ""), str(hteams[1].get("id") or "")
    swap = bool(home_id) and str(home_id) == idb and str(home_id) != ida
    tno_of = {"1": 2, "2": 1} if swap else {"1": 1, "2": 2}          # the feed's side -> FIBA's tno
    side_team = {"1": hteams[0], "2": hteams[1]}
    sb_by_id = {str(t.get("id")): t for t in sb_teams}

    # ------------------------------------------------------------------ people
    people: Dict[str, dict] = {}            # player id -> first, family, shirt, tno, box name
    lic2pid: Dict[str, str] = {}
    for l in lines:
        if l.get("idPlayer") and l.get("idLicense"):
            lic2pid[str(l["idLicense"])] = str(l["idPlayer"])
    for side in ("1", "2"):
        t = sb_by_id.get(str(side_team[side].get("id"))) or {}
        for p in t.get("PLAYER") or []:
            pid = str(p.get("id") or "")
            if not pid:
                continue
            first, family = split_name(p.get("name") or "", rosters.get(pid))
            people[pid] = {"first": first, "family": family, "shirt": str(p.get("no") or "").strip(),
                           "tno": tno_of[side], "side": side, "box": (p.get("name") or "").strip(),
                           "starter": str(p.get("inn") or "") == "1"}
    # who is on the floor, from the box's starters: FEB logs the opening five as five "enters the
    # court" lines at 10:00 with nobody leaving, which is a lineup, not five substitutions
    on_floor = {1: {k for k, v in people.items() if v["tno"] == 1 and v["starter"]},
                2: {k for k, v in people.items() if v["tno"] == 2 and v["starter"]}}
    repairs: List[str] = []

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    chrono: List[dict] = []
    shots_in: List[Tuple[dict, float, float]] = []
    closed: set = set()
    score = {"1": 0, "2": 0}
    last_miss: Optional[str] = None         # the side of the last missed shot the ball is live after
    team_rebs = {1: [0, 0], 2: [0, 0]}      # tno -> [offensive, defensive] with no player
    team_tov = {1: 0, 2: 0}
    fouls_by_kind: Dict[Tuple[str, str], int] = {}

    def ev(l, action, sub="", success=0, quals=None, pid=None, side=None):
        q = _n(l.get("quarter")) or 1
        side = side if side is not None else str(l.get("team") or "")
        pid = str(pid if pid is not None else (l.get("idPlayer") or ""))
        who = people.get(pid, {})
        s1, s2 = (score["1"], score["2"]) if not swap else (score["2"], score["1"])
        e = {"actionNumber": 0, "period": q if q <= 4 else q - 4,
             "periodType": "REGULAR" if q <= 4 else "OVERTIME", "gt": _gt(l.get("time")),
             "s1": str(s1), "s2": str(s2), "tno": tno_of.get(side, 0), "pno": pid,
             "actionType": action, "subType": sub, "qualifier": quals or [],
             "success": 1 if success else 0,
             "scoring": 1 if (action in ("2pt", "3pt", "freethrow") and success) else 0,
             "shirtNumber": who.get("shirt", ""), "firstName": who.get("first", ""),
             "familyName": who.get("family", ""),
             "player": f"{who.get('first', '')} {who.get('family', '')}".strip() if pid else ""}
        chrono.append(e)
        return e

    for l in sorted(lines, key=lambda x: _n(x.get("num"))):
        a = str(l.get("action") or "")
        side = str(l.get("team") or "")
        if l.get("scoreA") not in (None, "") and l.get("scoreB") not in (None, ""):
            score = {"1": _n(l["scoreA"]), "2": _n(l["scoreB"])}
        pid = str(l.get("idPlayer") or "")
        # A LINE FILED UNDER THE OTHER CLUB: the player id is right and the team label is not (Primera
        # FEB 2486258: four of HLA Alicante's assists labelled Ourense, and the league's box credits
        # them to the Alicante players). The player decides, and the line is noted.
        if pid in people and people[pid]["side"] != side:
            repairs.append(f"{a} #{l.get('num')}: {people[pid]['box']} is team {people[pid]['side']}, not {side or '-'}")
            side = people[pid]["side"]
        if a == "subst":
            tno = tno_of.get(side, 0)
            txt = (l.get("text") or "").lower()
            going_in = bool(l.get("logParam3")) or ("entra" in txt and not l.get("logParam2"))
            if tno in on_floor and pid:
                if going_in and pid in on_floor[tno]:
                    continue                 # already on the floor: the opening five, not a change
                if not going_in and pid not in on_floor[tno]:
                    repairs.append(f"subst #{l.get('num')}: {people.get(pid, {}).get('box', pid)} leaves but was not on")
                    continue
                (on_floor[tno].add if going_in else on_floor[tno].discard)(pid)
            ev(l, "substitution", "in" if going_in else "out", side=side)
            continue
        if a == "period":
            if str(l.get("logParam2") or "") == "1":
                closed.add(_n(l.get("logParam1")) or _n(l.get("quarter")))
            continue                         # written once each, below
        if a == "shoot":
            value = str(l.get("logParam6") or "") or ("3" if "DE 3" in (l.get("text") or "").upper() else "2")
            made = str(l.get("logParam4") or "") == "1"
            e = ev(l, "3pt" if value == "3" else "2pt", "dunk" if str(l.get("logParam5") or "") == "9" else "", made,
                   side=side)
            last_miss = None if made else side
            pos = str(l.get("Position") or "")
            if "|" in pos:
                try:
                    x, y = (float(v) for v in pos.split("|")[:2])
                    shots_in.append((e, x, y))
                except ValueError:
                    pass
        elif a == "fthrow":
            made = str(l.get("logParam4") or "") == "1"
            ev(l, "freethrow", "", made, side=side)
            last_miss = None if made else side
        elif a == "rebound":
            off = last_miss is not None and last_miss == side
            e = ev(l, "rebound", "offensive" if off else "defensive", quals=[] if pid else ["team"], side=side)
            if not pid and e["tno"] in (1, 2):
                team_rebs[e["tno"]][0 if off else 1] += 1
            last_miss = None
        elif a == "assist":
            ev(l, "assist", side=side)
        elif a == "recovery":
            ev(l, "steal", side=side)
        elif a == "blockshot":
            ev(l, "block", side=side)
        elif a == "lose":
            e = ev(l, "turnover", "", quals=[] if pid else ["team"], side=side)
            if not pid and e["tno"] in (1, 2):
                team_tov[e["tno"]] += 1
        elif a == "timeout":
            ev(l, "timeout", "full", pid="", side=side)
        elif a == "foul":
            kind, unk = foul_kind(l)
            if unk:
                unknown.append(unk)
            e = ev(l, "foul", kind, pid=pid if pid else "", side=side)
            if pid:
                fouls_by_kind[(pid, kind)] = fouls_by_kind.get((pid, kind), 0) + 1
            fouled = lic2pid.get(str(l.get("logParam4") or ""))
            if fouled and fouled in people and people[fouled]["tno"] != e["tno"]:
                # the fouled player's mirror, right after the foul, on the other side
                f = ev(l, "foulon", "", pid=fouled, side=people[fouled]["side"])
                f["_of"] = e
        else:
            unknown.append(f"action:{a}:{(l.get('text') or '')[:60]}")

    # free throws: 1of2, 2of2 ... by shooter and clock
    trips: Dict[tuple, List[dict]] = {}
    for e in chrono:
        if e["actionType"] == "freethrow":
            trips.setdefault((e["pno"], e["period"], e["periodType"], e["gt"]), []).append(e)
    for fts in trips.values():
        for i, e in enumerate(fts, start=1):
            e["subType"] = f"{i}of{len(fts)}"

    chrono = _group_substitutions(chrono)

    # ------------------------------------------------------------------ periods and the whistle
    def qnum(e):
        return e["period"] + (4 if e["periodType"] == "OVERTIME" else 0)

    finished = is_final(header)
    played = {qnum(e) for e in chrono} | closed
    if finished:        # a finished game's period list is complete; a live one's may run ahead of play
        played |= {_n(q.get("n")) for q in ((header.get("QUARTERS") or {}).get("QUARTER") or [])}
    played.discard(0)
    last_q = max(played) if played else 1
    closed |= set(range(1, last_q))
    if finished:
        closed.add(last_q)
    by_q: Dict[int, List[dict]] = {}
    for e in chrono:
        by_q.setdefault(qnum(e), []).append(e)
    cur = ["0", "0"]

    def marker(q, action, sub, clock):
        return {"actionNumber": 0, "period": q if q <= 4 else q - 4,
                "periodType": "REGULAR" if q <= 4 else "OVERTIME", "gt": clock,
                "s1": cur[0], "s2": cur[1], "tno": 0, "pno": "", "actionType": action, "subType": sub,
                "qualifier": [], "success": 0, "scoring": 0, "shirtNumber": "", "firstName": "",
                "familyName": "", "player": ""}

    events: List[dict] = []
    for q in range(1, last_q + 1):
        events.append(marker(q, "period", "start", "10:00" if q <= 4 else "05:00"))
        for e in by_q.get(q, []):
            events.append(e)
            cur = [e["s1"], e["s2"]]
        if q in closed:
            events.append(marker(q, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for i, e in enumerate(events, start=1):
        e["actionNumber"] = i
    for e in events:
        of = e.pop("_of", None)
        if of is not None:
            e["previousAction"] = of["actionNumber"]

    # ------------------------------------------------------------------ the box
    tm: Dict[str, dict] = {}
    for side in ("1", "2"):
        tno = tno_of[side]
        ht = side_team[side]
        t = sb_by_id.get(str(ht.get("id"))) or {}
        pl: Dict[str, dict] = {}
        for p in t.get("PLAYER") or []:
            pid = str(p.get("id") or "")
            if not pid:
                continue
            who = people[pid]
            first, family = who["first"], who["family"]
            row = {"firstName": first, "familyName": family, "name": f"{first} {family}".strip(),
                   "internationalFirstName": first, "internationalFamilyName": family,
                   "scoreboardName": who["box"], "shirtNumber": who["shirt"], "playingPosition": "",
                   "starter": 1 if str(p.get("inn") or "") == "1" else 0, "active": 1,
                   "sMinutes": _mmss(_n(p.get("min"))),
                   "sPoints": _n(p.get("pts")),
                   "sFieldGoalsMade": _n(p.get("fgm")), "sFieldGoalsAttempted": _n(p.get("fga")),
                   "sTwoPointersMade": _n(p.get("p2m")), "sTwoPointersAttempted": _n(p.get("p2a")),
                   "sThreePointersMade": _n(p.get("p3m")), "sThreePointersAttempted": _n(p.get("p3a")),
                   "sFreeThrowsMade": _n(p.get("p1m")), "sFreeThrowsAttempted": _n(p.get("p1a")),
                   "sReboundsOffensive": _n(p.get("ro")), "sReboundsDefensive": _n(p.get("rd")),
                   "sReboundsTotal": _n(p.get("rt")), "sAssists": _n(p.get("assist")),
                   "sTurnovers": _n(p.get("to")), "sSteals": _n(p.get("st")),
                   "sBlocks": _n(p.get("bs")), "sBlocksReceived": _n(p.get("tc")),
                   "sFoulsPersonal": _n(p.get("pf")), "sFoulsOn": _n(p.get("rf")),
                   "sFoulsTechnical": fouls_by_kind.get((pid, "technical"), 0),
                   "sFoulsUnsportsmanlike": fouls_by_kind.get((pid, "unsportsmanlike"), 0),
                   "sFoulsDisqualifying": fouls_by_kind.get((pid, "disqualifying"), 0),
                   "sPlusMinusPoints": _n(p.get("pllss")),
                   "sPointsSecondChance": 0, "sPointsFastBreak": 0, "sPointsFromTurnovers": 0, "sPointsInThePaint": 0}
            pl[pid] = row
        tot = {}
        for k in ("sPoints", "sFieldGoalsMade", "sFieldGoalsAttempted", "sTwoPointersMade", "sTwoPointersAttempted",
                  "sThreePointersMade", "sThreePointersAttempted", "sFreeThrowsMade", "sFreeThrowsAttempted",
                  "sReboundsOffensive", "sReboundsDefensive", "sReboundsTotal", "sAssists", "sTurnovers", "sSteals",
                  "sBlocks", "sBlocksReceived", "sFoulsPersonal", "sFoulsOn", "sFoulsTechnical",
                  "sFoulsUnsportsmanlike", "sFoulsDisqualifying", "sPlusMinusPoints"):
            tot["tot_" + k] = sum(r[k] for r in pl.values())
        # FIBA's team totals include the team's own rebounds and turnovers (the league's box does not
        # print them; the play-by-play has them as lines with no player)
        o, d = team_rebs[tno]
        tot["tot_sReboundsOffensive"] += o
        tot["tot_sReboundsDefensive"] += d
        tot["tot_sReboundsTotal"] += o + d
        tot["tot_sTurnovers"] += team_tov[tno]
        tot["tot_sReboundsTeamOffensive"], tot["tot_sReboundsTeamDefensive"] = o, d
        tot["tot_sReboundsTeam"] = o + d
        tot["tot_sTurnoversTeam"] = team_tov[tno]
        name = (ht.get("name") or "").strip()
        logo = str(ht.get("logo") or "").strip()
        tm[str(tno)] = {"name": name, "nameInternational": name, "shortName": name,
                        "code": str(ht.get("id") or ""), "score": _n(ht.get("pts")) or tot["tot_sPoints"],
                        "coachDetails": [], "pl": pl, "shot": [], **tot}
        if logo.startswith("http"):
            logo = "https://" + logo.split("://", 1)[1]
            tm[str(tno)]["logoT"] = {"url": logo}
            tm[str(tno)]["logoS"] = {"url": logo}

    # the shot chart, joined to its action by the renumbered action itself
    for e, x, y in shots_in:
        if e["tno"] not in (1, 2):
            continue
        tm[str(e["tno"])]["shot"].append({
            "r": e["success"], "x": x, "y": y, "actionType": e["actionType"], "subType": e["subType"],
            "actionNumber": e["actionNumber"], "pno": e["pno"], "per": e["period"], "perType": e["periodType"],
            "player": e["player"], "shirtNumber": e["shirtNumber"]})

    # period scores: each period's own points, p5.. for overtimes, as FIBA writes them
    for q in (header.get("QUARTERS") or {}).get("QUARTER") or []:
        qn = _n(q.get("n"))
        if not qn:
            continue
        a, b = _n(q.get("scoreA")), _n(q.get("scoreB"))
        tm[str(tno_of["1"])][f"p{qn}_score"] = a
        tm[str(tno_of["2"])][f"p{qn}_score"] = b
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(v for k, v in tm[s].items() if re.fullmatch(r"p(\d+)_score", k) and int(k[1:-6]) > 4)
        tm[s]["full_score"] = tm[s]["score"]

    last_play = next((e for e in reversed(events) if e["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    elif re.match(r"^\d{1,2}:\d{2}$", str(header.get("time") or "").strip()):
        raw["clock"] = _gt(header["time"])
    else:
        raw["clock"] = last_play["gt"] if last_play and qnum(last_play) == last_q else ("10:00" if last_q <= 4 else "05:00")
    raw["feb"] = {"competition": (header.get("competition") or "").strip(), "round": (header.get("round") or "").strip(),
                  "date": header_tip(header), "venue": (header.get("field") or "").strip() or None,
                  "place": (header.get("place") or "").strip() or None, "final": finished,
                  "canary": bool(CANARY_PLACE.search(str(header.get("place") or ""))),
                  "home_id": str(tm["1"]["code"]), "swapped": swap, "unknown": sorted(set(unknown)),
                  "repairs": repairs}
    return raw


# ============================================================================ the adapter
class FebAdapter(FibaLiveStatsAdapter):
    """The FEB's leagues. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "feb"
    #: the federation's own servers, not a CDN built to be polled
    min_request_gap_s = 1.0
    PAGE_TTL_S = 300.0
    #: player pages read per game for players their club's page does not list
    MAX_PLAYER_PAGES = 4

    # shared across instances: a league's two sources (regular + playoffs) read one calendar a run
    _pages: dict = {}          # url or (url, group) -> (fetched_at, html)
    _token: tuple = ("", 0.0)  # (token, expires at)
    _fixtures: dict = {}       # game id -> (home team id, away team id)
    _last_req: float = 0.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        comp = _n(config.get("competition"))
        if not comp:
            raise ValueError("feb: adapter_config needs competition (the site's number: 1 Primera FEB ...)")
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"feb: stage must be 'regular' or 'playoffs', not {stage!r}")
        season = _start_year(config.get("season"))
        cal_url = f"{SITE}/calendario.aspx?g={comp}&t={season}"
        page = self._page(cal_url)
        if not page:
            print(f"     FEB {comp}: no calendar for {season}")
            return []
        groups = groups_of(page)
        regular = [g for g in groups if REGULAR.match(g[1])]
        other = [g for g in groups if not REGULAR.match(g[1]) and not CUP.search(g[1])]
        cache = self._cache(config)
        cups = set(cache.get("cup_games") or [])
        rows: List[Tuple[dict, str, str]] = []     # (game, stage, group label)
        if stage in ("", "regular"):
            split = len(regular) > 1
            for value, label, selected in regular:
                gp = page if selected else self._postback(cal_url, page, value)
                for g in calendar_games(gp or ""):
                    rows.append((g, "regular", group_label(label) if split else ""))
        if stage in ("", "playoffs"):
            for value, label, selected in other:
                gp = page if selected else self._postback(cal_url, page, value)
                for g in calendar_games(gp or ""):
                    g["round"] = " · ".join(x for x in (label.strip(), g.get("round")) if x)
                    rows.append((g, "playoffs", ""))
            # the knockout rounds: the results page links the series of the phase it has selected, so
            # each of the league's own play-off phases is selected in turn (the latest one is already)
            res_url = f"{SITE}/resultados.aspx?g={comp}&t={season}"
            res = self._page(res_url) or ""
            seen_f = set()
            for value, label, selected in groups_of(res):
                if REGULAR.match(label):
                    continue
                if CUP.search(label):
                    if selected:
                        # a cup is the latest phase (LF Endesa's Supercopa in September): its games
                        # are remembered as not the league's, so no lane ever fetches them as the league's
                        for f in series_links(res):
                            cups |= {g["id"] for g in series_games(self._page(f"{SITE}/series/{f}") or "")}
                    continue
                rp = res if selected else self._postback(res_url, res, value)
                for f in series_links(rp or ""):
                    if f in seen_f:
                        continue
                    seen_f.add(f)
                    for g in series_games(self._page(f"{SITE}/series/{f}") or ""):
                        rows.append((g, "playoffs", ""))
            if cups != set(cache.get("cup_games") or []):
                cache["cup_games"] = sorted(cups)
                self._save_cache(config, cache)
        tzmap = self._cache(config).get("tz") or {}
        now = datetime.now(timezone.utc)
        out, seen = [], set()
        for g, st, grp in rows:
            if g["id"] in seen or g["id"] in cups:
                continue
            seen.add(g["id"])
            FebAdapter._fixtures[g["id"]] = (g["home_id"], g["away_id"])
            tz = tzmap.get(g["home_id"]) or (CANARY if CANARY_CLUB.search(g["home"]) else MADRID)
            tbc = not g["hour"] or tuple(g["hour"]) == ("0", "00") or tuple(g["hour"]) == ("00", "00")
            if g["date"] and not tbc:
                d, mo, y = g["date"]
                tip = local_to_utc(y, mo, d, *g["hour"], tz)
            elif g["date"]:
                d, mo, y = g["date"]
                tip = noon_utc(y, mo, d)
            else:
                tip = None
            extra = {"home_code": g["home_id"], "away_code": g["away_id"],
                     "home_logo": f"https://imagenes.feb.es/Imagen.aspx?i={g['home_id']}&ti=1",
                     "away_logo": f"https://imagenes.feb.es/Imagen.aspx?i={g['away_id']}&ti=1",
                     "round": g["round"], "stage": st}
            if grp:
                extra["home_group"] = extra["away_group"] = grp
            if tbc:
                extra["time_tbc"] = True
            status = "scheduled"
            if g["score"]:
                status = "final"
            elif tip and not tbc:
                t = datetime.fromisoformat(tip.replace("Z", "+00:00"))
                if t <= now and (now - t).total_seconds() < LIVE_GUARD_S:
                    status = "live"
            out.append(ScheduleGame(external_id=g["id"], home_name=g["home"], away_name=g["away"],
                                    tipoff_at=tip, status=status, extra=extra))
        print(f"     FEB {comp} {season}/{season + 1} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit() or self._too_early(config.get("_tipoff_at")):
            return None                        # decided before a single request is made
        if gid in set(self._cache(config).get("cup_games") or []):
            print(f"     FEB {gid}: a cup game filed under the league's page, not the league's - not fetched")
            return None
        reply = self._api(f"KeyFacts/{gid}", gid)
        if not isinstance(reply, dict):
            return None
        home_id = (FebAdapter._fixtures.get(gid) or (None, None))[0]
        cache = self._cache(config)
        rosters = self._rosters_for(reply, cache, config)
        raw = raw_from_keyfacts(reply, home_id=home_id, rosters=rosters)
        if raw is None:
            return None
        meta = raw["feb"]
        if meta["unknown"]:
            print(f"     FEB {gid}: {len(meta['unknown'])} line(s) the adapter does not know, left out: {meta['unknown'][:3]}")
        # a club's time zone, learnt from its own venue, for the fixtures still to come
        tz = CANARY if meta["canary"] else MADRID
        if cache.setdefault("tz", {}).get(meta["home_id"]) != tz and meta.get("place"):
            cache["tz"][meta["home_id"]] = tz
            self._save_cache(config, cache)
        b = self.bundle_from_raw(raw, gid, config)
        # the feed's own start time is exact; the fixture's can be a round's date only
        b.tipoff_at = meta["date"] or config.get("_tipoff_at")
        return b

    @staticmethod
    def _too_early(tip, now: Optional[datetime] = None) -> bool:
        try:
            t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
        except ValueError:
            return False
        if t is None:
            return False
        now = now or datetime.now(timezone.utc)
        return (t - now).total_seconds() > FETCH_LEAD_S

    def _rosters_for(self, reply: dict, cache: dict, config: dict) -> Dict[str, str]:
        """{player id: full name} for both clubs; a club's page is read only for a player not seen yet."""
        names: Dict[str, str] = {}
        book = cache.setdefault("rosters", {})
        changed = False
        for t in ((reply.get("SCOREBOARD") or {}).get("TEAM")) or []:
            tid = str(t.get("id") or "")
            known = book.get(tid) or {}
            ids = {str(p.get("id")) for p in t.get("PLAYER") or [] if p.get("id")}
            if tid and ids - set(known) and not getattr(self, "_roster_asked", {}).get(tid):
                self.__dict__.setdefault("_roster_asked", {})[tid] = True
                got = roster_names(self._page(f"{SITE}/equipo/{tid}", cache_ok=False) or "")
                if got:
                    known = {**known, **got}
                    book[tid] = known
                    changed = True
            # a player the club's page does not list (a late signing, a youth licence): his own page,
            # a few a game at most, and remembered either way so he is asked about once
            for pid in sorted(ids - set(known))[: self.MAX_PLAYER_PAGES]:
                full = player_page_name(self._page(f"{SITE}/jugador/{tid}/{pid}", cache_ok=False) or "")
                known = {**known, pid: full or ""}
                book[tid] = known
                changed = True
            names.update({k: v for k, v in known.items() if v})
        if changed:
            self._save_cache(config, cache)
        return names

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - FebAdapter._last_req
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        FebAdapter._last_req = time.time()

    def _get(self, url: str, headers: Optional[dict] = None):
        self._pause()
        hdrs = {"User-Agent": UA, **(headers or {})}
        for attempt in range(3):
            try:
                r = requests.get(url, headers=hdrs, timeout=40)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code in (200, 401, 404):
                return r
            time.sleep(1.5 * (attempt + 1))
        return None

    def _page(self, url: str, cache_ok: bool = True) -> Optional[str]:
        at, text = FebAdapter._pages.get(url, (0.0, None))
        if cache_ok and text is not None and time.time() - at < self.PAGE_TTL_S:
            return text
        r = self._get(url)
        if r is None or r.status_code != 200:
            return None
        text = r.text
        tok = page_token(text)
        if tok:
            FebAdapter._token = (tok, jwt_exp(tok) or time.time() + 3600)
        if cache_ok:
            FebAdapter._pages[url] = (time.time(), text)
        return text

    def _postback(self, url: str, page: str, group_value: str) -> Optional[str]:
        """The same calendar with another group selected: the dropdown's own postback."""
        key = (url, group_value)
        at, text = FebAdapter._pages.get(key, (0.0, None))
        if text is not None and time.time() - at < self.PAGE_TTL_S:
            return text
        fields = hidden_fields(page)
        grp = None
        for name, opts in selects(page).items():
            sel = next((v for v, _, s in opts if s), opts[0][0] if opts else "")
            fields[name] = sel
            if name.endswith("gruposDropDownList"):
                grp = name
        if not grp:
            return None
        fields[grp] = group_value
        fields["__EVENTTARGET"] = grp.replace(":", "$")
        fields["__EVENTARGUMENT"] = ""
        m = re.search(r'<form[^>]*action="([^"]*)"', page)
        action = requests.compat.urljoin(SITE + "/", html.unescape(m.group(1))) if m else url
        self._pause()
        try:
            r = requests.post(action, data=fields, timeout=40,
                              headers={"User-Agent": UA, "Referer": action, "Origin": SITE})
        except requests.RequestException:
            return None
        if r.status_code != 200:
            return None
        FebAdapter._pages[key] = (time.time(), r.text)
        return r.text

    def _token_for(self, gid: str, force: bool = False) -> Optional[str]:
        tok, exp = FebAdapter._token
        if tok and not force and time.time() < exp - 300:
            return tok
        self._page(f"{SITE}/partido/{gid}", cache_ok=False)     # any page carries it
        tok, exp = FebAdapter._token
        return tok or None

    def _api(self, path: str, gid: str):
        tok = self._token_for(gid)
        if not tok:
            return None
        for attempt in range(2):
            r = self._get(f"{API}/{path}", headers={"Authorization": "Bearer " + tok, "Accept": "application/json"})
            if r is None or r.status_code == 404:
                return None                    # not played yet
            if r.status_code == 401 and attempt == 0:
                tok = self._token_for(gid, force=True)
                if not tok:
                    return None
                continue
            try:
                return r.json()
            except ValueError:
                return None
        return None

    @staticmethod
    def _cache_path(config: dict) -> Optional[str]:
        code = config.get("code")
        if not code:
            return None
        root = config.get("repo_root") or os.getcwd()
        return os.path.join(root, "data", "feed", str(code), "feb.json")

    _caches: dict = {}

    def _cache(self, config: dict) -> dict:
        p = self._cache_path(config)
        if not p:
            return {}
        if p in FebAdapter._caches:
            return FebAdapter._caches[p]
        data = {}
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        FebAdapter._caches[p] = data
        return data

    def _save_cache(self, config: dict, data: dict) -> None:
        p = self._cache_path(config)
        if not p:
            return
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
        except Exception:
            pass                           # a cache that cannot be written is a slow pass, not a failure
