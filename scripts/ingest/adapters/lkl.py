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
MEETINGS = 4
FETCH_LEAD_S = 30 * 60

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

    # the score line: the league's box once it is over, the play-by-play's until then
    if not finished:
        tm["1"]["score"], tm["2"]["score"] = int(score[0]), int(score[1])
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
                  "shotsJoined": len(joined), "unknown": sorted(set(unknown))}
    return raw


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

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"lkl: stage must be 'regular' or 'playoffs', not {stage!r}")
        games = parse_calendar(self._text(CALENDAR))
        if not games:
            print("     LKL: the calendar feed has no games")
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
        clubs = self._clubs()["by_id"]
        names = {}
        for g in parse_calendar(self._text(CALENDAR, fresh=False)):
            if g["id"] == gid:
                names = {"home": g["home"], "away": g["away"]}
        raw = raw_from_game(box or {}, pbp, shots, score or {}, clubs, gid)
        if raw is None:
            return None
        for tno in ("1", "2"):                  # a club the schedule pages do not know still gets a name
            if not raw["tm"][tno]["name"]:
                raw["tm"][tno]["name"] = names.get("home" if tno == "1" else "away", "")
        if raw["lkl"]["unknown"]:
            print(f"     LKL {gid}: {raw['lkl']['unknown'][:4]} left out")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = tip
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


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S
