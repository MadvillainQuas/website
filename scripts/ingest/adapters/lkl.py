# -*- coding: utf-8 -*-
"""The LKL (Lietuvos krepšinio lyga, Lithuania), from lkl.lt's own data.

WHERE THE DATA IS. lkl.lt is a Laravel site whose game centre reads its own JSON routes, and a
plain GET answers them - no key, no cookie, no browser:

    https://www.lkl.lt/kalendorius/all                 the league's calendar feed (iCal): every game
        of the season - UID lkl-game-<id>, DTSTART in Europe/Vilnius, SUMMARY "Home vs Away".
        All 180 regular-season games of 2026/27 (10 clubs x 36) on 2026-09-23.
    https://www.lkl.lt/tvarkarastis  (+ /rezultatai)   the schedule pages: the clubs' own ids in the
        team filter (<option value="41">Hipocredit</option>), and per game row the crests, the
        three-letter codes and the hall.
    https://www.lkl.lt/api/livestream/{kind}/{gameId}   the game itself:
        game-score    the score and the clock ("4 kėlinys - 00:00")
        boxscore      gameStatistics (per team id: quarter scores, totals, paint / fast-break /
                      second-chance / off-turnover points ...) and the box (home / away: players
                      with slug, jersey, is_starter, time to the second, every counting stat)
        play-by-play  quarters.regular {"1".."4": [...]} and quarters.overtime [...], NEWEST FIRST,
                      each action FIBA LiveStats' own vocabulary - type / subtype / success
                      (2pt layup, freethrow 1of2, foulon, jumpball heldball ...), is_home, the
                      player's slug and name, the clock left and the score after it
        shot-chart    per quarter, every field-goal attempt with x/y in FIBA's frame (and the
                      league's internal player id, which nothing else carries)

IT IS FIBA LIVESTATS UNDERNEATH, SO THE TRANSLATION IS SMALL. What the feed does NOT carry is
supplied here:
  * no action numbers: each quarter's list is reversed into entry order, stable-sorted by the
    clock (a correction is typed late), and numbered 1..n;
  * no period on an action: regular quarters come keyed, overtimes as one list, split at their
    own period markers;
  * no player ids: players are keyed by their slug, which the box carries too; names are the
    play-by-play's full names ("Grantas Vasiliauskas"), the box only has "G. Vasiliauskas";
  * no team ids on the game: gameStatistics names both, and home is the one whose points are the
    home score (its key order is NOT reliable: 11340 lists the away side first);
  * no x/y on a shot: the shot chart is joined to the play-by-play side by side, quarter by
    quarter, by kind, result and player (the chart's internal player id learnt from the quarters
    that agree one to one) - every attempt of 21 games joined;
  * no link from a drawn foul to its foul: the other side's foul at the same clock time.
Coach's challenges are recorded and left out (no FIBA event), and so is an officials' timeout.

THE KEY is the league's game id - in the calendar from the day it is published, and the id of the
game page (/rungtynes/11583). THE CLUB CODE is the league's own team id (Hipocredit 41, Žalgiris 3),
the value of the schedule's team filter; the calendar names the clubs, the filter maps the names.

STAGES. The regular season is a quadruple round robin (every pair meets four times), and the
calendar does not label rounds; so a pair's meetings in date order after the fourth are play-offs
(adapter_config "meetings" if the format ever changes).

A PAST SEASON IS NOT IN THE CALENDAR. The iCal feed is the season being played and nothing else
(?season= is ignored: 2024-25 asked for, 2026-27's 180 games came back), so a backfill used to
file this season's games under whichever season it was asked for. Past seasons are read where the
site's own "Rezultatai" list reads them when its season filter changes:

    https://www.lkl.lt/loadResults?team=-&opponent=-&month=-&season=<id>&page=<n>
        ten played games a page, newest first, with the date, the hall, both clubs (slug, code,
        crest) and the game id. The season ids are the <select id="season-lkl"> options on the
        schedule pages ("2024-2025 m. sezonas" = 39252), the selected one being the calendar's.

Two things differ in a past season. The clubs of one that has since left the league (Labas Gas,
Wolves Twinsbet, Pieno žvaigždės) are not in the team filter, so their team id is read once off
their own club page (/komandos/<slug>, "teamId":8). And the round robin was not always quadruple:
2021-22 to 2023-24 were triple (11, 12 and 11 clubs), so a finished season's regular meetings are
the count most of its pairs share, not the constant. A season the site does not list, or whose
pages come back with games of another season, returns nothing - never the calendar's.

NO PLAY-BY-PLAY FOR 2021-22 TO 2023-24. lkl.lt's game feed keeps those seasons' box scores (every
line, both team lines, the quarters) but its play-by-play and shot chart are empty for every game
sampled (10167, 10265, 10682, 10687, 10923, 10945, the three finals); 2020-21 and 2024-25 have
them. Such a game is published as a result (translate False, as nbl.py does for NBL 2023-24): the
league's box and quarters, no log, no lineups - once it is two days old, so a recent game whose
plays are late is never closed to them. Some 2020-21 games are short the other way: plays, but one
side's box empty (3 of 11 sampled: 9662, 9714, 9758 - no away lines, the away score 0 even in the
game's own score reply). Their score is the plays' and they too are published as results.
"""
from __future__ import annotations

import html as _html
import re
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA

try:
    from zoneinfo import ZoneInfo
    _VILNIUS = ZoneInfo("Europe/Vilnius")
except Exception:                       # pragma: no cover
    _VILNIUS = None

SITE = "https://www.lkl.lt"
CALENDAR = SITE + "/kalendorius/all"
SCHEDULE_PAGES = (SITE + "/tvarkarastis", SITE + "/rezultatai")
LIVESTREAM = SITE + "/api/livestream/{kind}/{gid}"
#: a past season's played games, ten a page (see the module docstring)
RESULTS = SITE + "/loadResults"
TEAM_PAGE = SITE + "/komandos/{slug}"
MEETINGS = 4
FETCH_LEAD_S = 30 * 60
#: a played game with a box and no play-by-play is published as a result only once it is this old
BOX_ONLY_AFTER_S = 2 * 86400
#: the most pages one past season is read over (2022-23, the longest of the last six, is 23)
MAX_PAGES = 40
#: the date headings of the results list, "2025 m. birželio 21 d. (šeštadienis)": months in the genitive
LT_MONTHS = {"sausio": 1, "vasario": 2, "kovo": 3, "balandžio": 4, "gegužės": 5, "birželio": 6, "liepos": 7,
             "rugpjūčio": 8, "rugsėjo": 9, "spalio": 10, "lapkričio": 11, "gruodžio": 12}

#: subtypes renamed to FIBA's spelling (the feed writes these camel-cased or its own way)
SUBTYPE_FIX = {"coachTechnical": "coachtechnical", "benchTechnical": "benchtechnical",
               "24sec": "shotclock", "flagrant": "unsportsmanlike"}
#: fouls that belong to a bench or a coach, never a player's PF
BENCH_FOULS = {"coachtechnical", "benchtechnical", "coachdisqualifying"}
#: recorded by the league, no FIBA event of their own
SKIP_TYPES = {"headcoachchallenge"}
SKIP = {("timeout", "officials")}


def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _secs(clock) -> int:
    m = re.match(r"^\s*(\d+):(\d+)", str(clock or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _pair(v) -> Tuple[int, int]:
    """'25/54' -> (25, 54)."""
    m = re.match(r"^\s*(\d+)\s*/\s*(\d+)", str(v or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _val(row: dict, key: str):
    x = (row or {}).get(key)
    return x.get("value") if isinstance(x, dict) else x


def _mmss(seconds) -> str:
    s = int(seconds or 0)
    return f"{s // 60}:{s % 60:02d}"


def _norm(name) -> str:
    """A club name as a matching key: accents, case and punctuation away."""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def vilnius_to_utc(stamp: str) -> Optional[str]:
    """'20260917T183000' (Vilnius) -> '2026-09-17T15:30:00+00:00'."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})", stamp or "")
    if not m or _VILNIUS is None:
        return None
    local = datetime(*map(int, m.groups()), tzinfo=_VILNIUS)
    return local.astimezone(timezone.utc).isoformat()


def parse_calendar(text: str) -> List[dict]:
    """[{id, local, tip, home, away}] from the league's iCal feed, in the feed's order."""
    out = []
    for block in (text or "").split("BEGIN:VEVENT")[1:]:
        uid = re.search(r"UID:lkl-game-(\d+)", block)
        st = re.search(r"DTSTART(?:;TZID=[^:]+)?:(\d{8}T\d{6})", block)
        sm = re.search(r"SUMMARY:(.*)", block)
        if not (uid and sm):
            continue
        summary = _html.unescape(sm.group(1).strip().replace("\\,", ","))
        home, _, away = summary.partition(" vs ")
        out.append({"id": uid.group(1), "local": st.group(1) if st else None,
                    "tip": vilnius_to_utc(st.group(1)) if st else None,
                    "home": home.strip(), "away": away.strip()})
    return out


def parse_schedule_page(text: str) -> dict:
    """The clubs the schedule pages know: {"ids": {norm name: id}, "clubs": {norm name: {name,
    code, logo}}, "venues": {game id: hall}}."""
    ids, clubs, venues = {}, {}, {}
    for value, label in re.findall(r'<option value="(\d+)">([^<]+)</option>', text or ""):
        ids.setdefault(_norm(_html.unescape(label)), value)
    for row in re.findall(r'<div class="sm:flex justify-between items-center w-full">(.*?)(?=<div class="sm:flex justify-between items-center w-full">|\Z)',
                          text or "", re.S):
        gid = re.search(r"/rungtynes/(\d+)", row)
        hall = re.search(r'<div class="location[^"]*">.*?</div>\s*<div>\s*([^<]+?)\s*</div>', row, re.S)
        if gid and hall:
            venues[gid.group(1)] = _html.unescape(re.sub(r"\s+,", ",", hall.group(1))).strip()
        for code, logo, alt in re.findall(r'<strong[^>]*>\s*([A-Z]{2,4})\s*</strong>\s*<img src="([^"]+)" alt="([^"]+)"', row) + \
                [(c, l, a) for l, a, c in re.findall(r'<img src="([^"]+)" alt="([^"]+)">\s*<strong[^>]*>\s*([A-Z]{2,4})\s*</strong>', row)]:
            logo = logo if logo.startswith("http") else SITE + logo
            clubs.setdefault(_norm(_html.unescape(alt)), {"name": _html.unescape(alt), "code": code, "logo": logo})
    # the site header lists every club with its crest (a club with no game on the page included)
    for logo, alt in re.findall(r'<a href="https?://(?:www\.|en\.)?lkl\.lt/komandos/[a-z0-9-]+"><img src="([^"]+)" alt="([^"]+)"></a>',
                                text or ""):
        logo = logo if logo.startswith("http") else SITE + logo
        c = clubs.setdefault(_norm(_html.unescape(alt)), {"name": _html.unescape(alt), "code": None, "logo": logo})
        c["logo"] = c.get("logo") or logo
    return {"ids": ids, "clubs": clubs, "venues": venues}


def playoff_ids(games: List[dict], meetings: int = MEETINGS) -> set:
    """The calendar does not label rounds: a pair's meetings after the `meetings`-th are play-offs."""
    seen: Dict[frozenset, int] = {}
    out = set()
    for g in sorted(games, key=lambda g: (g.get("local") or "", int(g["id"]))):
        pair = frozenset((_norm(g["home"]), _norm(g["away"])))
        seen[pair] = seen.get(pair, 0) + 1
        if seen[pair] > meetings:
            out.add(g["id"])
    return out


def regular_meetings(games: List[dict]) -> int:
    """How often each pair met in a FINISHED season's regular season: the count most pairs share.

    Only a few pairs meet again in the play-offs, so the commonest count is the round robin's (2024-25:
    37 of 45 pairs met 4 times; 2023-24: 47 of 55 met 3 times). A tie goes to the smaller count, which
    files a doubtful game as a play-off rather than a play-off as a league game."""
    per: Dict[frozenset, int] = {}
    for g in games:
        pair = frozenset((_norm(g["home"]), _norm(g["away"])))
        per[pair] = per.get(pair, 0) + 1
    if not per:
        return MEETINGS
    counts: Dict[int, int] = {}
    for n in per.values():
        counts[n] = counts.get(n, 0) + 1
    return min(counts, key=lambda n: (-counts[n], n))


def past_playoff_ids(games: List[dict], meetings: int) -> set:
    """A FINISHED season's play-off games: from the first meeting past the round robin's on, everything.

    Counting meetings alone is not enough once a season is over: a regular-season game that was never
    played leaves its pair one meeting short, and that pair's first play-off game then counts as its
    last league game (2023-24: Wolves and Lietkabelis met twice, not three times, before the bronze
    series, whose opener 11110 on 4 Jun 2024 would have been filed as Round 30). The league does not
    play league games once its play-offs have begun, so the first game past the round robin starts
    them for every pair."""
    first = playoff_ids(games, meetings)
    if not first:
        return set()
    start = min(g["local"] or "" for g in games if g["id"] in first)
    return {g["id"] for g in games if (g["local"] or "") >= start} | first


def parse_seasons(text: str) -> dict:
    """The league's seasons as the schedule pages list them: {"ids": {start year: season id},
    "current": the selected one's start year}. Only the LKL's own <select>: the page carries the
    King Mindaugas Cup's next to it, with a "selected" of its own."""
    m = re.search(r'<select id="season-lkl"[^>]*>(.*?)</select>', text or "", re.S)
    ids, current = {}, None
    for value, selected, y1, y2 in re.findall(r'<option value="(\d+)"\s*(selected)?\s*>\s*(\d{4})-(\d{4}) m\. sezonas',
                                               m.group(1) if m else ""):
        if int(y2) == int(y1) + 1:
            ids[int(y1)] = value
            if selected:
                current = int(y1)
    return {"ids": ids, "current": current}


def _results_side(anchor: str) -> dict:
    """One club of a results row: its link, three-letter code and crest."""
    slug = re.search(r"/komandos/([a-z0-9-]+)", anchor)
    code = re.search(r"<strong[^>]*>\s*([^<]+?)\s*</strong>", anchor)
    img = re.search(r'<img src="([^"]+)" alt="([^"]+)"', anchor)
    logo = img.group(1) if img else None
    return {"slug": slug.group(1) if slug else "", "code": code.group(1) if code else None,
            "name": _html.unescape(img.group(2)).strip() if img else "",
            "logo": (logo if logo.startswith("http") else SITE + logo) if logo else None}


def parse_results_page(text: str) -> Tuple[List[dict], int]:
    """([{id, local, tip, home, away, venue, scored}], the last page number) from one page of the
    results list. home / away are _results_side's {slug, code, name, logo}."""
    out = []
    parts = re.split(r'<div class="font-semibold text-2xl[^"]*">([^<]+)</div>', text or "")
    for i in range(1, len(parts), 2):
        d = re.match(r"\s*(\d{4}) m\. (\S+) (\d{1,2}) d\.", _html.unescape(parts[i]))
        mo = LT_MONTHS.get(d.group(2).lower()) if d else None
        if not mo:
            continue
        for row in parts[i + 1].split('<div class="result-item">')[1:]:
            gid = re.search(r"/rungtynes/(\d+)", row)
            sides = re.findall(r'<a href="[^"]*/komandos/[a-z0-9-]+"[^>]*>.*?</a>', row, re.S)
            if not gid or len(sides) != 2:
                continue
            hhmm = re.search(r'<div class="text-lg font-bold">\s*(\d{1,2}):(\d{2})\s*</div>', row)
            local = "%s%02d%02dT%02d%s00" % (d.group(1), mo, int(d.group(3)),
                                              int(hhmm.group(1)) if hhmm else 12, hhmm.group(2) if hhmm else "00")
            hall = re.search(r'<div class="location[^"]*">.*?</div>\s*<div>\s*([^<]+?)\s*</div>', row, re.S)
            score = re.search(r"/rungtynes/\d+\">(.*?)</a>", row, re.S)
            out.append({"id": gid.group(1), "local": local, "tip": vilnius_to_utc(local),
                        "home": _results_side(sides[0]), "away": _results_side(sides[1]),
                        "venue": re.sub(r"\s+,", ",", re.sub(r"\s+", " ", _html.unescape(hall.group(1)))).strip() if hall else None,
                        "scored": bool(score and len(re.findall(r"\d+", re.sub(r"<[^>]+>", " ", score.group(1)))) == 2)})
    pages = [int(x) for x in re.findall(r"loadResults\?page=(\d+)", text or "")]
    return out, max(pages or [1])


def season_window(start_year: int) -> Tuple[str, str]:
    """The UTC dates a season's games fall between, as run_ingest reads them (July to mid-August)."""
    return f"{start_year}-07-01", f"{start_year + 1}-08-15T23:59:59"


# ============================================================================ one game
def _periods(pbp_reply: dict) -> List[Tuple[int, List[dict]]]:
    """[(period number, actions in entry order)] - the regular quarters as keyed, overtimes split
    out of their one list at their own period-start markers."""
    q = (pbp_reply or {}).get("quarters") or {}
    out = []
    reg = q.get("regular") or {}
    if isinstance(reg, dict):
        for k in sorted(reg, key=lambda x: _num(x)):
            out.append((_num(k), list(reversed(reg[k] or []))))
    ot = list(reversed(q.get("overtime") or []))          # entry order
    if ot:
        # A NEW OVERTIME BEGINS ONLY AFTER THE LAST ONE ENDED: the period's opening substitutions
        # are typed before its own start marker (11580), so a start marker alone splits nothing
        n, cur, ended = 4, [], False
        for e in ot:
            if e.get("type") == "period" and e.get("subtype") == "start" and ended:
                n += 1
                out.append((n, cur))
                cur, ended = [], False
            if e.get("type") == "period" and e.get("subtype") == "end":
                ended = True
            cur.append(e)
        out.append((n + 1, cur))
    return out


def _home_away(box_reply: dict, pbp_reply: dict, score_reply: dict) -> Tuple[Optional[str], Optional[str]]:
    """(home team id, away team id) from gameStatistics: the side whose points are the home score,
    then whose quarter scores are the home side's, then the feed's own order."""
    gs = (box_reply or {}).get("gameStatistics") or {}
    ids = list(gs.keys())
    if len(ids) != 2:
        return (ids[0] if ids else None), None
    home_pts = _num((score_reply or {}).get("home"))
    away_pts = _num((score_reply or {}).get("away"))
    a, b = ids
    pa, pb = _num(gs[a].get("points")), _num(gs[b].get("points"))
    if pa != pb:
        if (pa, pb) == (home_pts, away_pts):
            return a, b
        if (pb, pa) == (home_pts, away_pts):
            return b, a
    # level (a live game): the quarter scores the play-by-play gives the home side
    home_q = {}
    last = 0
    for n, acts in _periods(pbp_reply):
        end = max([_num((e.get("score") or {}).get("home")) for e in acts] or [last])
        home_q[str(n)] = end - last
        last = end
    qa = {str(k): _num(v) for k, v in (gs[a].get("quarter_scores") or {}).items()}
    qb = {str(k): _num(v) for k, v in (gs[b].get("quarter_scores") or {}).items()}
    if qa != qb:
        if all(qa.get(k) == v for k, v in home_q.items() if k in qa):
            return a, b
        if all(qb.get(k) == v for k, v in home_q.items() if k in qb):
            return b, a
    return a, b


def raw_from_game(box_reply: dict, pbp_reply: dict, shots_reply: Optional[dict] = None,
                  score_reply: Optional[dict] = None, clubs: Optional[dict] = None,
                  game_id: str = "") -> Optional[dict]:
    """One LKL game -> FIBA data.json shape: play-by-play OLDEST first, actionNumber 1..n, periods
    and the final whistle written once each. Pure. `clubs` maps a team id to {name, code, logo}.

    None when there is nothing to show yet (not one action)."""
    periods = _periods(pbp_reply)
    if not any(acts for _, acts in periods):
        return None
    clubs = clubs or {}
    home_id, away_id = _home_away(box_reply, pbp_reply, score_reply)
    box = (box_reply or {}).get("boxscore") or {}

    # WHO PLAYED, per side, from the box: older games put the HEAD COACH's slug on team actions
    # (team rebounds, timeouts, period markers - 11305), and a slug no player row carries is the
    # team, never a player
    rostered = {1: set(), 2: set()}
    for tno, side in ((1, "home"), (2, "away")):
        for r in (box.get(side) or {}).get("players") or []:
            if r.get("slug"):
                rostered[tno].add(r["slug"])

    # full names from the play-by-play, by slug
    full = {}
    for _, acts in periods:
        for e in acts:
            p = e.get("player") or {}
            if p.get("slug") and p.get("name"):
                full.setdefault(p["slug"], p["name"].strip())

    # ------------------------------------------------------------------ the play-by-play
    keyed, closed, unknown = [], set(), []
    whistle = False
    for n, acts in periods:
        plen = 600 if n <= 4 else 300
        for i, e in enumerate(acts):
            at, sub = (e.get("type") or "").strip(), (e.get("subtype") or "").strip()
            if at == "period":
                if sub == "end":
                    closed.add(n)
                continue
            if at == "game":
                whistle = whistle or sub == "end"
                continue
            if at in SKIP_TYPES or (at, sub) in SKIP:
                continue
            sub = SUBTYPE_FIX.get(sub, sub)
            if not at:
                unknown.append(f"action:{e.get('description')}")
                continue
            slug = (e.get("player") or {}).get("slug") or ""
            tno = 1 if e.get("is_home") else 2
            if (at == "foul" and sub in BENCH_FOULS) or (slug and slug not in rostered[tno]):
                slug = ""
            team_event = not slug
            if at == "jumpball" and team_event:
                tno = 0
            sc = e.get("score") or {}
            quals = ["team"] if team_event and at in ("rebound", "turnover") else []
            name = full.get(slug, (e.get("player") or {}).get("name") or "")
            first, _, last = name.partition(" ")
            remain = _secs(e.get("clock"))
            ev = {"actionNumber": 0, "period": n if n <= 4 else n - 4,
                  "periodType": "REGULAR" if n <= 4 else "OVERTIME",
                  "gt": f"{remain // 60:02d}:{remain % 60:02d}",
                  "s1": str(_num(sc.get("home"))), "s2": str(_num(sc.get("away"))),
                  "tno": tno, "pno": slug, "actionType": at, "subType": sub, "qualifier": quals,
                  "success": 1 if e.get("success") else 0,
                  "scoring": 1 if (at in ("2pt", "3pt", "freethrow") and e.get("success")) else 0,
                  "shirtNumber": "", "firstName": first if slug else "", "familyName": last if slug else "",
                  "player": name if slug else ""}
            keyed.append(((n, plen - remain, i), ev))
    if not keyed:
        return None
    keyed.sort(key=lambda t: t[0])
    chrono = _group_substitutions([ev for _, ev in keyed])

    def pnum(ev):
        return ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)

    last_q = max(max(pnum(ev) for ev in chrono), max(closed) if closed else 1)
    finished = whistle
    closed |= set(range(1, last_q))
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

    events, period_end = [], {}
    for qn in range(1, last_q + 1):
        events.append(marker(qn, "period", "start", "10:00" if qn <= 4 else "05:00"))
        for ev in by_q.get(qn, []):
            events.append(ev)
            score = [ev["s1"], ev["s2"]]
        period_end[qn] = (int(score[0]), int(score[1]))
        if qn in closed:
            events.append(marker(qn, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for k, ev in enumerate(events, start=1):
        ev["actionNumber"] = k

    # drawn fouls: the other side's foul at the same clock time (typed just before, else after)
    fouls: Dict[tuple, List[int]] = {}
    for i, ev in enumerate(events):
        if ev["actionType"] == "foul" and ev["tno"] in (1, 2):
            fouls.setdefault((ev["period"], ev["periodType"], ev["gt"], ev["tno"]), []).append(i)
    for i, ev in enumerate(events):
        if ev["actionType"] == "foulon" and ev["tno"] in (1, 2):
            c = fouls.get((ev["period"], ev["periodType"], ev["gt"], 3 - ev["tno"])) or []
            before, after = [j for j in c if j < i], [j for j in c if j > i]
            j = before[-1] if before else (after[0] if after else None)
            if j is not None:
                ev["previousAction"] = events[j]["actionNumber"]

    # ------------------------------------------------------------------ the box
    tm, shirts = _box_teams(box_reply, home_id, away_id, full, clubs)

    # STARTERS: older boxes flag nobody (11305). The five is who acts in the first quarter before
    # being substituted in, plus anyone substituted out before ever coming in
    for tno in (1, 2):
        pl = tm[str(tno)]["pl"]
        if sum(p["starter"] for p in pl.values()) == 5:
            continue
        came_in, five = set(), []
        for ev in chrono:
            if pnum(ev) != 1 or ev["tno"] != tno or not ev["pno"] or ev["pno"] not in pl:
                continue
            if ev["actionType"] == "substitution" and ev["subType"] == "in":
                came_in.add(ev["pno"])
            elif ev["pno"] not in came_in and ev["pno"] not in five:
                five.append(ev["pno"])
        if len(five) == 5:
            for slug, p in pl.items():
                p["starter"] = 1 if slug in five else 0

    # shirts onto the play-by-play
    for ev in chrono:
        if ev["pno"]:
            ev["shirtNumber"] = shirts.get((ev["tno"], ev["pno"]), "")

    # the score line: the league's box once it is over, the play-by-play's until then - and the
    # play-by-play's for a side the box has no lines for at all. Some 2020-21 games keep one side's box
    # empty (9714: no away players, the away team line 0, even the score reply 79-0), while their plays,
    # like the results list, say 79-68; the box's 0 is a gap, not a score
    short = [s for s in ("1", "2") if not tm[s]["pl"]]
    if not finished:
        tm["1"]["score"], tm["2"]["score"] = int(score[0]), int(score[1])
    for s in short:
        tm[s]["score"] = int(score[int(s) - 1])
    prev = (0, 0)
    for qn in range(1, last_q + 1):
        h, v = period_end.get(qn, prev)
        tm["1"][f"p{qn}_score"], tm["2"][f"p{qn}_score"] = h - prev[0], v - prev[1]
        prev = (h, v)
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(tm[s].get(f"p{qn}_score", 0) for qn in range(5, last_q + 1))
        tm[s]["full_score"] = tm[s]["score"]

    # ------------------------------------------------------------------ the shot chart
    joined = _join_shots(chrono, shots_reply)
    for ev, shot in joined:
        tm[str(ev["tno"])]["shot"].append({
            "r": ev["success"], "x": shot["x"], "y": shot["y"],
            "actionType": ev["actionType"], "subType": ev["subType"],
            "actionNumber": ev["actionNumber"], "pno": ev["pno"],
            "per": ev["period"], "perType": ev["periodType"],
            "player": ev["player"], "shirtNumber": ev["shirtNumber"]})

    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    else:
        raw["clock"] = last_play["gt"] if last_play and pnum(last_play) == last_q else (
            "10:00" if last_q <= 4 else "05:00")
    raw["lkl"] = {"gameId": str(game_id), "homeTeamId": str(home_id or ""), "awayTeamId": str(away_id or ""),
                  "shotsJoined": len(joined), "unknown": sorted(set(unknown)), "boxShort": short}
    return raw


def box_only_raw(box_reply: dict, score_reply: dict, clubs: Optional[dict] = None,
                 game_id: str = "") -> Optional[dict]:
    """A FINISHED game the feed kept the box of and not the plays (2021-22 to 2023-24, see the module
    docstring) in data.json's shape: both clubs' lines and team lines, the quarters from gameStatistics,
    the final score, and no play-by-play. Pure; the caller publishes it as a result.

    None unless it is unmistakably a result: two clubs, each with players, home and away told apart by
    the score the game reply gives (whose clock on these games is the default "1 KĖLINYS - 10:00", so it
    is the points alone that are read), both team lines agreeing with it, and the two scores different."""
    gs = (box_reply or {}).get("gameStatistics") or {}
    box = (box_reply or {}).get("boxscore") or {}
    if len(gs) != 2 or not all((box.get(s) or {}).get("players") for s in ("home", "away")):
        return None
    if any((score_reply or {}).get(k) in (None, "") for k in ("home", "away")):
        return None
    hs, vs = _num(score_reply["home"]), _num(score_reply["away"])
    if hs == vs:
        return None
    home_id, away_id = _home_away(box_reply, {}, score_reply)
    if (_num(gs[str(home_id)].get("points")), _num(gs[str(away_id)].get("points"))) != (hs, vs):
        return None
    tm, _ = _box_teams(box_reply, home_id, away_id, {}, clubs or {})
    if (tm["1"]["score"], tm["2"]["score"]) != (hs, vs):
        return None                       # the box's own sides the other way round from its ids
    last_q = 4
    for s, tid in (("1", home_id), ("2", away_id)):
        qs = {_num(k): _num(v) for k, v in (gs[str(tid)].get("quarter_scores") or {}).items() if _num(k) >= 1}
        last_q = max([last_q] + list(qs))
        for q, v in qs.items():
            tm[s][f"p{q}_score"] = v
        tm[s]["ot_score"] = sum(v for q, v in qs.items() if q > 4)
        tm[s]["full_score"] = tm[s]["score"]
        if not any(p["starter"] for p in tm[s]["pl"].values()):
            # nobody flagged a starter and there is no first quarter to find the five in: the bench's
            # points are not known, and "everybody's" would be wrong
            tm[s]["tot_sBenchPoints"] = _num(gs[str(tid)].get("bench_points"))
    return {"tm": tm, "pbp": [], "period": last_q, "periodType": "REGULAR" if last_q <= 4 else "OVERTIME",
            "inOT": 1 if last_q > 4 else 0, "clock": "00:00",
            "lkl": {"gameId": str(game_id), "homeTeamId": str(home_id or ""), "awayTeamId": str(away_id or ""),
                    "shotsJoined": 0, "unknown": [], "boxOnly": True}}


def _box_teams(box_reply: dict, home_id, away_id, full: dict, clubs: dict) -> Tuple[Dict[str, dict], dict]:
    """({"1": home, "2": away} in data.json's tm shape, {(tno, slug): shirt}) from the league's box: every
    player's line and each club's own team line. `full` is {slug: full name} where a play-by-play gave one
    (the box itself only prints "G. Vasiliauskas"); `clubs` maps a team id to {name, code, logo}."""
    box = (box_reply or {}).get("boxscore") or {}
    gs = (box_reply or {}).get("gameStatistics") or {}
    shirts = {}
    tm: Dict[str, dict] = {}
    for tno, side, tid in ((1, "home", home_id), (2, "away", away_id)):
        b = box.get(side) or {}
        pl = {}
        bench = 0
        for r in b.get("players") or []:
            slug = r.get("slug") or ""
            if not slug:
                continue
            fg2, fg3, ft = _pair(_val(r, "fg2")), _pair(_val(r, "fg3")), _pair(_val(r, "ft"))
            name = full.get(slug) or str(_val(r, "name") or "").strip()
            first, _, last = name.partition(" ")
            shirt = str(_val(r, "jersey") or "").strip()
            shirts[(tno, slug)] = shirt
            p = {"firstName": first, "familyName": last, "name": name,
                 "internationalFirstName": first, "internationalFamilyName": last,
                 "scoreboardName": str(_val(r, "name") or name), "shirtNumber": shirt, "playingPosition": "",
                 "starter": 1 if r.get("is_starter") else 0, "active": 1,
                 "sMinutes": _mmss(_secs(_val(r, "time"))),
                 "sPoints": _num(_val(r, "points")),
                 "sTwoPointersMade": fg2[0], "sTwoPointersAttempted": fg2[1],
                 "sThreePointersMade": fg3[0], "sThreePointersAttempted": fg3[1],
                 "sFieldGoalsMade": fg2[0] + fg3[0], "sFieldGoalsAttempted": fg2[1] + fg3[1],
                 "sFreeThrowsMade": ft[0], "sFreeThrowsAttempted": ft[1],
                 "sReboundsOffensive": _num(_val(r, "offensive_rebounds")),
                 "sReboundsDefensive": _num(_val(r, "defensive_rebounds")),
                 "sReboundsTotal": _num(_val(r, "total_rebounds")),
                 "sAssists": _num(_val(r, "assists")), "sSteals": _num(_val(r, "steals")),
                 "sTurnovers": _num(_val(r, "turnovers")), "sBlocks": _num(_val(r, "blocks")),
                 "sBlocksReceived": _num(_val(r, "blocks_received")),
                 "sFoulsPersonal": _num(_val(r, "fouls")), "sFoulsOn": _num(_val(r, "fouls_on")),
                 "sPlusMinusPoints": _num(_val(r, "plus_minus")), "eff_1": _num(_val(r, "efficiency")),
                 "sPointsSecondChance": 0, "sPointsFastBreak": 0, "sPointsFromTurnovers": 0,
                 "sPointsInThePaint": 0}
            if not p["starter"]:
                bench += p["sPoints"]
            pl[slug] = p
        t = b.get("team") or {}
        fg2, fg3, ft = _pair(_val(t, "fg2")), _pair(_val(t, "fg3")), _pair(_val(t, "ft"))
        st = gs.get(str(tid)) or {}
        tot = {"tot_sPoints": _num(_val(t, "points")),
               "tot_sTwoPointersMade": fg2[0], "tot_sTwoPointersAttempted": fg2[1],
               "tot_sThreePointersMade": fg3[0], "tot_sThreePointersAttempted": fg3[1],
               "tot_sFieldGoalsMade": fg2[0] + fg3[0], "tot_sFieldGoalsAttempted": fg2[1] + fg3[1],
               "tot_sFreeThrowsMade": ft[0], "tot_sFreeThrowsAttempted": ft[1],
               "tot_sReboundsOffensive": _num(_val(t, "offensive_rebounds")),
               "tot_sReboundsDefensive": _num(_val(t, "defensive_rebounds")),
               "tot_sReboundsTotal": _num(_val(t, "total_rebounds")),
               "tot_sAssists": _num(_val(t, "assists")), "tot_sSteals": _num(_val(t, "steals")),
               "tot_sTurnovers": _num(_val(t, "turnovers")), "tot_sBlocks": _num(_val(t, "blocks")),
               "tot_sBlocksReceived": _num(_val(t, "blocks_received")),
               "tot_sFoulsPersonal": sum(p["sFoulsPersonal"] for p in pl.values()),
               "tot_sFoulsOn": _num(_val(t, "fouls_on")),
               "tot_sPointsInThePaint": _num(st.get("points_in_paint")),
               "tot_sPointsFastBreak": _num(st.get("fast_break_points")),
               "tot_sPointsSecondChance": _num(st.get("second_chance_points")),
               "tot_sPointsFromTurnovers": _num(st.get("points_off_turnovers")),
               "tot_sBenchPoints": _num(st.get("bench_points")) or bench,
               "tot_sBiggestLead": _num(st.get("biggest_lead")),
               "tot_sLeadChanges": _num(st.get("lead_changes"))}
        # team rebounds and team turnovers: the team line less its players
        tot["tot_sReboundsTeamOffensive"] = tot["tot_sReboundsOffensive"] - sum(p["sReboundsOffensive"] for p in pl.values())
        tot["tot_sReboundsTeamDefensive"] = tot["tot_sReboundsDefensive"] - sum(p["sReboundsDefensive"] for p in pl.values())
        tot["tot_sTurnoversTeam"] = tot["tot_sTurnovers"] - sum(p["sTurnovers"] for p in pl.values())
        club = clubs.get(str(tid)) or {}
        name = club.get("name") or ""
        tt = {"name": name, "nameInternational": name, "shortName": club.get("code") or name,
              "code": str(tid or ""), "score": tot["tot_sPoints"], "pl": pl, "shot": [], **tot}
        if (club.get("logo") or "").startswith("https://"):
            tt["logoT"] = {"url": club["logo"]}
            tt["logoS"] = {"url": club["logo"]}
        tm[str(tno)] = tt
    return tm, shirts


def _join_shots(chrono: List[dict], shots_reply: Optional[dict]) -> List[Tuple[dict, dict]]:
    """Pair every charted attempt with its play-by-play attempt, side by side and period by period.

    The chart carries the league's internal player id and no slug, and its order (by id) can differ
    from the play's (a correction). So the join is by kind, result and player, in order: the
    slug -> chart-id link is learnt first from every side-period whose attempts agree one to one,
    then each attempt takes the first unused charted attempt of the same kind, result and (where
    known) player. An attempt with no agreeing chart row keeps no coordinates rather than a guess."""
    q = (shots_reply or {}).get("quarters") or {}
    chart: Dict[Tuple[int, int], List[dict]] = {}
    reg = q.get("regular") or {}
    for k, shots in (reg.items() if isinstance(reg, dict) else []):
        for s in shots or []:
            chart.setdefault((_num(k), 1 if s.get("is_home") else 2), []).append(s)
    for s in q.get("overtime") or []:
        per = _num(s.get("period") or 1)                    # the chart numbers overtimes 5, 6 ...
        chart.setdefault((per if per > 4 else 4 + per, 1 if s.get("is_home") else 2), []).append(s)
    for v in chart.values():
        v.sort(key=lambda s: _num(s.get("id")))
    pbp: Dict[Tuple[int, int], List[dict]] = {}
    for ev in chrono:
        if ev["actionType"] in ("2pt", "3pt") and ev["tno"] in (1, 2):
            n = ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)
            pbp.setdefault((n, ev["tno"]), []).append(ev)

    def agrees(e, s):
        return e["actionType"] == s.get("type") and bool(e["success"]) == bool(s.get("success"))

    votes: Dict[str, Dict[int, int]] = {}
    for key, evs in pbp.items():
        shots = chart.get(key) or []
        if len(shots) == len(evs) and all(agrees(e, s) for e, s in zip(evs, shots)):
            for e, s in zip(evs, shots):
                if e["pno"]:
                    cell = votes.setdefault(e["pno"], {})
                    cell[_num(s.get("player_id"))] = cell.get(_num(s.get("player_id")), 0) + 1
    pid_of = {slug: max(v.items(), key=lambda kv: kv[1])[0] for slug, v in votes.items()}
    out = []
    for key, evs in pbp.items():
        free = list(chart.get(key) or [])
        for e in evs:
            want = pid_of.get(e["pno"])
            if want is not None:
                pick = next((s for s in free if agrees(e, s) and _num(s.get("player_id")) == want), None)
            else:
                pick = next((s for s in free if agrees(e, s)), None)
            if pick is None:
                continue
            free.remove(pick)
            try:
                out.append((e, {"x": float(pick["x"]), "y": float(pick["y"])}))
            except (TypeError, ValueError, KeyError):
                pass
    return out


def _group_substitutions(chrono: List[dict]) -> List[dict]:
    """A substitution split around another action in the same second is put back together: every
    substitution of a second moves up to where the first one of that second was typed (11420: an
    IN, a free throw, then its OUT - six on the floor for that free throw)."""
    out: List[dict] = []
    i, n = 0, len(chrono)
    while i < n:
        ev = chrono[i]
        if ev["actionType"] != "substitution":
            out.append(ev)
            i += 1
            continue
        key = (ev["period"], ev["periodType"], ev["gt"])
        j, subs, others = i, [], []
        while j < n and (chrono[j]["period"], chrono[j]["periodType"], chrono[j]["gt"]) == key:
            (subs if chrono[j]["actionType"] == "substitution" else others).append(chrono[j])
            j += 1
        out.extend(subs)
        out.extend(others)
        i = j
    return out


# ============================================================================ the adapter
class LklAdapter(FibaLiveStatsAdapter):
    """The LKL. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "lkl"
    min_request_gap_s = 1.0
    _pages: dict = {}           # url -> (fetched_at, text)
    TTL_S = 300.0
    # A PAST SEASON IS READ ONCE PER PROCESS: it is over, and a backfill discovers it twice (the
    # regular-season row, then the play-offs row a game-fetching pass later, long after TTL_S)
    _seasons: dict = {}         # season id -> [results-list games]
    _team_ids: dict = {}        # club slug -> league team id ("" when its page names none)
    _past_clubs: dict = {}      # team id -> {name, code, logo}, the clubs of the past seasons read
    _past_games: dict = {}      # game id -> its results-list row, for fetch's names and tip-off

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"lkl: stage must be 'regular' or 'playoffs', not {stage!r}")
        m = re.match(r"\s*(\d{4})", str(config.get("season") or ""))
        want = int(m.group(1)) if m else None
        if want is not None:
            seasons = parse_seasons(self._text(SCHEDULE_PAGES[1]))
            if seasons["current"] is not None and want != seasons["current"]:
                return self._past_season(want, seasons["ids"].get(want), stage, config)
        games = parse_calendar(self._text(CALENDAR))
        if want is not None:
            # THE CALENDAR IS ONLY EVER THE SEASON BEING PLAYED. Asked for a season by name, a game
            # dated outside it is not this season's, whatever the season filter says is selected
            lo, hi = season_window(want)
            games = [g for g in games if g["tip"] and lo <= g["tip"] <= hi]
        if not games:
            print("     LKL: the calendar feed has no games" + (f" of {want}-{str(want + 1)[2:]}" if want else ""))
            return []
        clubs = self._clubs()
        po = playoff_ids(games, int(config.get("meetings") or MEETINGS))
        out = []
        for g in games:
            st = "playoffs" if g["id"] in po else "regular"
            if stage and st != stage:
                continue
            h, a = clubs["by_name"].get(_norm(g["home"]), {}), clubs["by_name"].get(_norm(g["away"]), {})
            out.append(ScheduleGame(
                external_id=g["id"], home_name=h.get("name") or g["home"], away_name=a.get("name") or g["away"],
                tipoff_at=g["tip"], status="scheduled",
                extra={"home_code": h.get("id"), "away_code": a.get("id"),
                       "home_logo": h.get("logo"), "away_logo": a.get("logo"),
                       "home_short": h.get("code"), "away_short": a.get("code"),
                       "venue": clubs["venues"].get(g["id"]), "stage": st}))
        unknown = sorted({g.home_name for g in out if not g.extra["home_code"]} | {g.away_name for g in out if not g.extra["away_code"]})
        print(f"     LKL {stage or 'all stages'}: {len(out)} games" + (f" - no team id for {unknown}" if unknown else ""))
        return out

    def _clubs(self) -> dict:
        """{by_name: {norm: {id, name, code, logo}}, by_id: {id: {...}}, venues}, from both pages."""
        ids, clubs, venues = {}, {}, {}
        for url in SCHEDULE_PAGES:
            try:
                got = parse_schedule_page(self._text(url))
            except Exception:
                continue
            for k, v in got["ids"].items():
                ids.setdefault(k, v)
            for k, v in got["clubs"].items():
                clubs.setdefault(k, v)
            venues.update(got["venues"])
        by_name, by_id = {}, {}
        for key, tid in ids.items():
            c = clubs.get(key, {})
            rec = {"id": tid, "name": c.get("name"), "code": c.get("code"), "logo": c.get("logo")}
            by_name[key] = rec
            by_id[tid] = rec
        return {"by_name": by_name, "by_id": by_id, "venues": venues}

    # ------------------------------------------------------------------ a past season
    def _past_season(self, want: int, season_id: Optional[str], stage: str, config: dict) -> List[ScheduleGame]:
        """A finished season's games, off the results list (see the module docstring)."""
        label = f"{want}-{str(want + 1)[2:]}"
        if not season_id:
            print(f"     LKL {label}: the site lists no such season - nothing read")
            return []
        games = self._season_results(season_id)
        lo, hi = season_window(want)
        inside = [g for g in games if g["tip"] and lo <= g["tip"] <= hi]
        if len(inside) < len(games):
            # the site answering with another season's list (the filter ignored, the ids renumbered)
            # is refused whole rather than trimmed: a list that is not this season's is not trusted
            print(f"     LKL {label}: season {season_id} answered with {len(games) - len(inside)} game(s) "
                  f"outside {label} - nothing read")
            return []
        if not games:
            print(f"     LKL {label}: no results listed for season {season_id}")
            return []
        clubs = self._clubs()["by_name"]
        for g in games:
            for side in ("home", "away"):
                c = g[side]
                known = clubs.get(_norm(c["name"])) or {}
                c["id"] = known.get("id") or self._team_id(c["slug"])
                # a club still in the league keeps today's crest: the list shows the season's own
                # (Hipocredit's 2023-24 games carry Jonava's), which would fill a blank crest with an old one
                c["logo"] = known.get("logo") or c["logo"]
                if c["id"]:
                    LklAdapter._past_clubs[c["id"]] = {"name": c["name"], "code": c["code"], "logo": c["logo"]}
            LklAdapter._past_games[g["id"]] = g
        # the pairs keyed on the clubs' own links, which outlive a renamed club's name
        keyed = [{"id": g["id"], "local": g["local"], "home": g["home"]["slug"], "away": g["away"]["slug"]} for g in games]
        meetings = int(config.get("meetings") or regular_meetings(keyed))
        po = past_playoff_ids(keyed, meetings)
        out = []
        for g in games:
            st = "playoffs" if g["id"] in po else "regular"
            if stage and st != stage:
                continue
            h, a = g["home"], g["away"]
            out.append(ScheduleGame(
                external_id=g["id"], home_name=h["name"], away_name=a["name"], tipoff_at=g["tip"],
                status="final" if g["scored"] else "scheduled",
                extra={"home_code": h["id"] or None, "away_code": a["id"] or None,
                       "home_logo": h["logo"], "away_logo": a["logo"],
                       "home_short": h["code"], "away_short": a["code"], "venue": g["venue"], "stage": st}))
        out.sort(key=lambda g: (g.tipoff_at or "", int(g.external_id)))
        unknown = sorted({g.home_name for g in out if not g.extra["home_code"]} | {g.away_name for g in out if not g.extra["away_code"]})
        print(f"     LKL {label} {stage or 'all stages'}: {len(out)} games (regular season: {meetings} meetings a pair)"
              + (f" - no team id for {unknown}" if unknown else ""))
        return out

    def _season_results(self, season_id: str) -> List[dict]:
        """Every game of one season's results list, each once, oldest first."""
        if season_id in LklAdapter._seasons:
            return LklAdapter._seasons[season_id]
        seen, out, page, last = set(), [], 1, 1
        while page <= min(last, MAX_PAGES):
            r = self._get(f"{RESULTS}?team=-&opponent=-&month=-&season={season_id}&page={page}")
            if r is None:
                # a season read in part is not a season: the next pass reads it whole
                print(f"     LKL: results page {page} of season {season_id} unreachable - nothing read")
                return []
            r.encoding = "utf-8"
            rows, last = parse_results_page(r.text)
            for g in rows:
                if g["id"] not in seen:
                    seen.add(g["id"])
                    out.append(g)
            page += 1
        out.sort(key=lambda g: (g["local"], int(g["id"])))
        LklAdapter._seasons[season_id] = out
        return out

    def _team_id(self, slug: str) -> str:
        """The league team id of a club the team filter no longer lists, off its own page."""
        if not slug:
            return ""
        if slug not in LklAdapter._team_ids:
            r = self._get(TEAM_PAGE.format(slug=slug))
            m = re.search(r'teamId(?:&quot;|")\s*:\s*(\d+)', r.text if r is not None else "")
            LklAdapter._team_ids[slug] = m.group(1) if m else ""
        return LklAdapter._team_ids[slug]

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        tip = config.get("_tipoff_at")
        if not gid.isdigit() or _too_early(tip):
            return None
        score = self._json("game-score", gid)
        pbp = self._json("play-by-play", gid)
        if not isinstance(pbp, dict):
            return None
        box = self._json("boxscore", gid)
        shots = self._json("shot-chart", gid)
        # a club of a past season that has left the league is named by that season's results list;
        # one still in it by the schedule pages, as every current game is
        clubs = {**LklAdapter._past_clubs, **self._clubs()["by_id"]}
        names = {}
        past = LklAdapter._past_games.get(gid)
        if past:
            names = {"home": past["home"]["name"], "away": past["away"]["name"]}
            tip = tip or past["tip"]
        else:
            for g in parse_calendar(self._text(CALENDAR, fresh=False)):
                if g["id"] == gid:
                    names = {"home": g["home"], "away": g["away"]}
        raw = raw_from_game(box or {}, pbp, shots, score or {}, clubs, gid)
        if raw is None:
            raw = box_only_raw(box or {}, score or {}, clubs, gid) if _long_over(tip) else None
            if raw is None:
                return None
            print(f"     LKL {gid}: no play-by-play in the feed - published as a result, from the league's box")
        for tno in ("1", "2"):                  # a club the schedule pages do not know still gets a name
            if not raw["tm"][tno]["name"]:
                raw["tm"][tno]["name"] = names.get("home" if tno == "1" else "away", "")
        if raw["lkl"]["unknown"]:
            print(f"     LKL {gid}: {raw['lkl']['unknown'][:4]} left out")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = tip
        if raw["lkl"].get("boxOnly"):
            b.translate = False
            b.status = "final"
            b.stints, b.lineups = [], {}
        elif raw["lkl"].get("boxShort") and b.status == "final" and _long_over(tip):
            # ONE SIDE'S BOX EMPTY ON A FINISHED GAME (see raw_from_game): that side's plays name players
            # the box does not have, so its log cannot be put on anybody and every lineup it would give
            # has nobody on court for that club. Published as a result - the right score, the lines there
            # are - as ncaa.py does with a log that does not add up; old games only, as with box-only ones
            print(f"     LKL {gid}: the league's box has no lines for side {'/'.join(raw['lkl']['boxShort'])} - "
                  f"published as a result, its score from the play-by-play")
            b.translate = False
            b.stints, b.lineups = [], {}
        return b

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(LklAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        LklAdapter._last_req = time.time()

    def _get(self, url: str, accept: str = "*/*"):
        for attempt in range(3):
            self._pause()
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": accept}, timeout=60)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                return r
            time.sleep(1.5 * (attempt + 1))
        return None

    def _text(self, url: str, fresh: bool = False) -> str:
        at, cached = self._pages.get(url, (0.0, None))
        if cached is not None and not fresh and time.time() - at < self.TTL_S:
            return cached
        r = self._get(url)
        if r is None:
            raise RuntimeError(f"lkl: {url} unreachable")
        r.encoding = "utf-8"
        self._pages[url] = (time.time(), r.text)
        return r.text

    def _json(self, kind: str, gid: str):
        r = self._get(LIVESTREAM.format(kind=kind, gid=gid), accept="application/json")
        if r is None:
            return None
        try:
            return r.json()
        except ValueError:
            return None


def _long_over(tip, now: Optional[datetime] = None) -> bool:
    """Did this game tip off BOX_ONLY_AFTER_S ago? An unknown tip-off is not known to be over."""
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - t).total_seconds() >= BOX_ONLY_AFTER_S


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S
