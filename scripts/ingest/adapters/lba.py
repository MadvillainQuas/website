# -*- coding: utf-8 -*-
"""Lega Basket Serie A (LBA, Italy), from legabasket.it's own JSON API.

WHERE THE DATA IS. legabasket.it is a Next.js site whose pages fetch everything through the site's
own API routes, and those answer a plain GET - no key, no cookie, no browser:

    /api/championships/get-championships?s=YYYY&cs_id=1&items=1000
        the season's Serie A championships, one per phase: ctype RS (the regular season) and PO
        (the play-offs, once they exist). The Coppa Italia, the Supercoppa and the Next Gen Cup
        are other series (cs_id 5, 6, 21) and are never asked for.
    /api/championships/get-championships-calendar-by-id?id=C[&ph_id=P]
        a championship's games. Without ph_id it answers one matchday and NAMES THE PHASES in
        filters.phases; with ph_id it answers a whole phase - the regular season is Andata (1) +
        Ritorno (2), all 240 games of 2026/27 in two calls; the play-offs are Quarti (5),
        Semifinali (6), Finale (7).
    /api/teams/get-teams?year=YYYY&items=50
        the season's clubs: the team id (a NEW one every season), the club_id (the club's own,
        the same every season), name, crest.
    /api/championships/get-championships-matches-by-id?id=M
        one game's header and the league's own box score (scores.ht / scores.vt: a row per
        player, the team row, the totals).
    /api/championships/get-championships-matches-play-by-play?id=M&info=true&sort=asc
        every action in play order: an Italian description, the player and team, period (OT is
        5, 6 ...), minute + seconds run off the period, print_time (the clock left), the score,
        x/y, qualifier codes, and linked_action_id - which ties a rebound to its miss, a steal to
        its turnover, a drawn foul to its foul and the turnover of an offensive foul to that foul.

THE NUMBERS AGREE WITH THEMSELVES. On 21 games (2024/25 and 2025/26, overtime and double
overtime, every play-off round) every player's box line equals the count of his own actions in
the play-by-play for all 15 counting stats, the team totals are the players plus the team row, and
there are five starters a side.

THE KEY is the LBA match id. Every fixture has it from the day the calendar is published (all 240
of 2026/27 on 2026-09-23) and it is the id of the game page (/game/25015/...).

TEAM IDENTITY. The club code is club_id, never the team id: a club gets a new team id every season
(Olimpia Milano was 1649, then 1714, then 1751) and even its short code moves (Treviso TVB -> TVU,
Trentino TRN -> TN), while club_id stays put (Milano is 28 in 2025/26 and in 2026/27). Names and
crests are the league's own for that season.

TIP-OFF TIMES. A fixture whose time is not set yet says 00:00 Italian time (200 of the 240 on
2026-09-23). That is not a midnight tip, and read as one it lands on the previous day in UTC, so it
becomes noon UTC on the local date with extra["time_tbc"] - the U SPORTS / PLK convention - until
the league publishes the real time.

THE GAME is translated into FIBA LiveStats data.json shape and handed to bundle_from_raw like every
other translated league: FORWARDS, actionNumber 1..n in play order (stints.py and translate() both
replay a game by actionNumber), each period opened and closed once, the final whistle written when
the league says the game is over (game_status 2), and each drawn foul pointing at its foul
(previousAction) through the league's own link. A description the tables do not know is not
guessed: it is kept on raw["lba"]["unknown"] and printed.

SHOT CHART. x/y copied as they are: the LBA frame IS FIBA's - full court 0-100 along x with the rims
near 7 and 93 (596 lay-ups and dunks from 21 games), 0-100 across.

WHAT IS AND IS NOT THERE. Paint points (a made 2 flagged in_area) and fast-break points (qualifier
500 on the shot or free throw) are in the play-by-play, so they are carried as FIBA's own
qualifiers and totals; second-chance and off-turnover points are not labelled and stay 0. Box
minutes are whole minutes (the league rounds them); stints come from the play-by-play clock.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA
from .twobbl import current_season, normalize_season

API = "https://www.legabasket.it/api"
CDN = "https://lba-media.s3.eu-south-1.amazonaws.com"
SERIE_A = 1
#: championship type per stage
STAGE_CTYPE = {"regular": "RS", "playoffs": "PO"}
#: game_status as the site reads it
SCHEDULED, LIVE, ENDED = "0", "1", "2"
#: fetchwindow's lead: before it, the game endpoints have nothing to say about a game
FETCH_LEAD_S = 30 * 60


# ============================================================================ the vocabulary
SHOT = {"2 punti segnato": ("2pt", 1), "2 punti sbagliato": ("2pt", 0),
        "3 punti segnato": ("3pt", 1), "3 punti sbagliato": ("3pt", 0)}
FREE_THROW = {"Tiro libero segnato": 1, "Tiro libero sbagliato": 0}
#: action_1_qualifier_code of a shot -> FIBA subType (distances from 21 games: "Tiro in corsa" is a
#: runner at 1.7 m median, "Da penetrazione" a driving lay-up at 1.2 m, "Giro e Tiro" 2.6 m)
SHOT_KIND = {"1": "jumpshot", "2": "floatingjumpshot", "3": "fadeawayjumpshot", "4": "turnaroundjumpshot",
             "5": "stepbackjumpshot", "6": "pullupjumpshot", "7": "layup", "8": "drivinglayup",
             "9": "dunk", "10": "alleyoop", "11": "hookshot"}
FAST_BREAK = "500"                     # contropiede, on a shot or a free throw
PLAYER = {
    "Ingresso": ("substitution", "in"), "Uscita": ("substitution", "out"),
    "Rimbalzo offensivo": ("rebound", "offensive"), "Rimbalzo difensivo": ("rebound", "defensive"),
    "Assist": ("assist", ""), "Palla recuperata": ("steal", ""), "Stoppata": ("block", ""),
    "Fallo Subito": ("foulon", ""),
}
TEAM = {"Rimbalzi offensivi di squadra": ("rebound", "offensive"),
        "Rimbalzi difensivi di squadra": ("rebound", "defensive"),
        "Time Out": ("timeout", "full")}
#: recorded, deliberately not translated: the box carries blocks received, and a steal nobody made
#: is no player's stat (FIBA has no team steal)
SKIP = {"Stoppata subita", "Palle recuperate di squadra", "Inizio Tempo", "Fine Tempo"}
TURNOVER_KIND = {"50": "badpass", "51": "ballhandling", "52": "doubledribble", "53": "travel",
                 "54": "outofbounds", "55": "backcourt", "56": "3sec", "57": "5sec",
                 "58": "other", "59": "other"}
TEAM_TURNOVER_KIND = {"600": "5sec", "601": "8sec", "602": "shotclock", "603": "other", "1006": "shotclock"}
#: every player foul counts in the box's falli_c (all 919 of 21 games); the kind is FIBA's
FOUL_KIND = {"100": ("personal", []), "103": ("personal", ["shooting"]), "104": ("personal", []),
             "109": ("personal", []), "123": ("personal", []), "106": ("offensive", []),
             "101": ("technical", []), "121": ("technical", []), "122": ("technical", []),
             "102": ("unsportsmanlike", []), "105": ("unsportsmanlike", ["shooting"]),
             "124": ("unsportsmanlike", []), "107": ("disqualifying", []), "108": ("disqualifying", ["shooting"])}
TEAM_FOUL_KIND = {"201": "coachtechnical", "207": "coachdisqualifying", "209": "coachtechnical",
                  "301": "benchtechnical", "309": "benchtechnical"}


def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _mmss(seconds) -> str:
    s = int(seconds or 0)
    return f"{s // 60}:{s % 60:02d}"


def _clock(print_time) -> int:
    """'09:42' (the clock left) -> 582."""
    m = re.match(r"^\s*(\d+):(\d+)", str(print_time or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _score(s) -> Tuple[int, int]:
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def utc_iso(date_str) -> Optional[str]:
    """'2026-09-26T19:30:00.000+02:00' -> '2026-09-26T17:30:00+00:00'."""
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
    """(tip-off in UTC, time still to be confirmed). 00:00 Italian time is the league's "no time
    yet": noon UTC on that local date keeps the calendar day everywhere."""
    s = str(row.get("match_datetime") or "")
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T00:00", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T12:00:00+00:00", True
    return utc_iso(s), False


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S


def logo_url(key) -> Optional[str]:
    key = str(key or "").strip()
    return f"{CDN}/{key}" if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", key) else None


# ============================================================================ one game
def classify(a: dict, by_id: Dict[int, dict]) -> Tuple[Optional[str], str, Optional[int], List[str], Optional[str]]:
    """(actionType, subType, success, qualifier, unknown) for one LBA action.
    actionType None = an action that records nothing (skipped on purpose, or not known)."""
    d = (a.get("description") or "").strip()
    q1 = str(a.get("action_1_qualifier_code") or "")
    q2 = str(a.get("action_2_qualifier_code") or "")
    fast = FAST_BREAK in (q1, q2)
    if d in SHOT:
        at, made = SHOT[d]
        if a.get("dunk"):
            kind = "alleyoopdunk" if q1 == "10" else "dunk"
        else:
            kind = SHOT_KIND.get(q1, "jumpshot")
        quals = (["fastbreak"] if fast else []) + (["pointsinthepaint"] if a.get("in_area") and made and at == "2pt" else [])
        return at, kind, made, quals, None
    if d in FREE_THROW:
        return "freethrow", "", FREE_THROW[d], (["fastbreak"] if fast else []), None
    if d in PLAYER:
        at, sub = PLAYER[d]
        return at, sub, None, [], None
    if d == "Palla persa":
        if q1 in TURNOVER_KIND:
            return "turnover", TURNOVER_KIND[q1], None, [], None
        link = by_id.get(a.get("linked_action_id")) or {}
        if link.get("description") == "Fallo commesso" and str(link.get("action_1_qualifier_code")) == "106":
            return "turnover", "offensive", None, [], None
        return "turnover", "other", None, [], (None if not q1 else f"turnover:{q1}")
    if d == "Palle perse di squadra":
        return "turnover", TEAM_TURNOVER_KIND.get(q1, "other"), None, ["team"], None
    if d == "Fallo commesso":
        kind, quals = FOUL_KIND.get(q1, ("personal", []))
        return "foul", kind, None, list(quals), (None if q1 in FOUL_KIND else f"foul:{q1}")
    if d == "Falli di squadra":
        return "foul", TEAM_FOUL_KIND.get(q1, "benchtechnical"), None, [], (None if q1 in TEAM_FOUL_KIND else f"teamfoul:{q1}")
    if d in TEAM:
        at, sub = TEAM[d]
        return at, sub, None, (["team"] if at == "rebound" else []), None
    if d == "Palla contesa":
        return "jumpball", "lost" if q1 == "2002" else "won", None, [], None
    if d in SKIP:
        return None, "", None, [], None
    return None, "", None, [], f"action:{d}|{q1}"


def raw_from_game(match_reply: dict, pbp_reply: dict, clubs: Optional[Dict[int, dict]] = None) -> Optional[dict]:
    """One LBA game (the match reply + the play-by-play reply) -> FIBA data.json shape: play-by-play
    OLDEST first, actionNumber 1..n, periods and the final whistle written once each. Pure: same
    input, same output. `clubs` maps a team id to its club ({"club_id": 28, ...}) for the code.

    None when there is nothing to show yet (no game, or not one action)."""
    m = (match_reply or {}).get("match") or {}
    acts = (((pbp_reply or {}).get("pbp") or {}).get("actions")) or []
    if not m or not acts:
        return None
    clubs = clubs or {}
    home_tid, away_tid = _num(m.get("h_team_id")), _num(m.get("v_team_id"))
    tno_of = {home_tid: 1, away_tid: 2}
    by_id = {a.get("action_id"): a for a in acts if a.get("action_id") is not None}
    finished = str(m.get("game_status")) == ENDED

    # the pbp spells names properly ("Booker"); the box writes some surnames in capitals
    pbp_name = {}
    for a in acts:
        if a.get("player_id") and a.get("player_surname"):
            pbp_name.setdefault(_num(a["player_id"]), ((a.get("player_name") or "").strip(),
                                                      (a.get("player_surname") or "").strip()))

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    keyed = []
    closed = set()
    for i, a in enumerate(acts):
        qn = _num(a.get("period")) or 1
        if (a.get("description") or "").strip() == "Fine Tempo":
            closed.add(qn)
        at, sub, success, quals, unk = classify(a, by_id)
        if unk:
            unknown.append(unk)
        if not at:
            continue
        tno = tno_of.get(_num(a.get("team_id")), 0)
        pid = _num(a.get("player_id"))
        if quals and "team" in quals:
            pid = 0
        first, last = pbp_name.get(pid, ((a.get("player_name") or "").strip(), (a.get("player_surname") or "").strip()))
        plen = 600 if qn <= 4 else 300
        remain = _clock(a.get("print_time"))
        s1, s2 = _score(a.get("score"))
        ev = {
            "actionNumber": 0,
            "period": qn if qn <= 4 else qn - 4,
            "periodType": "REGULAR" if qn <= 4 else "OVERTIME",
            "gt": f"{remain // 60:02d}:{remain % 60:02d}",
            "s1": str(s1), "s2": str(s2),
            "tno": tno, "pno": str(pid) if pid else "",
            "actionType": at, "subType": sub, "qualifier": quals,
            "success": success if success is not None else 0,
            "scoring": 1 if (at in ("2pt", "3pt", "freethrow") and success == 1) else 0,
            "shirtNumber": str(a.get("player_number") or "") if pid else "",
            "firstName": first if pid else "", "familyName": last if pid else "",
            "player": f"{first} {last}".strip() if pid else "",
        }
        keyed.append(((qn, plen - remain, i), ev, a))
    if not keyed:
        return None
    keyed.sort(key=lambda t: t[0])

    # free-throw trips: one shooter at one clock time, "k of n"
    chrono = [ev for _, ev, _ in keyed]
    trips: Dict[tuple, List[dict]] = {}
    for ev in chrono:
        if ev["actionType"] == "freethrow":
            trips.setdefault((ev["period"], ev["periodType"], ev["gt"], ev["tno"], ev["pno"]), []).append(ev)
    for trip in trips.values():
        for k, ev in enumerate(trip, start=1):
            ev["subType"] = f"{k}of{len(trip)}"

    # periods: one start for every period played, one end for every one closed or left behind
    def pnum(ev):
        return ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)

    last_q = max(max(pnum(ev) for ev in chrono), max(closed) if closed else 1)
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

    events: List[dict] = []
    period_end_score: Dict[int, Tuple[int, int]] = {}
    for qn in range(1, last_q + 1):
        events.append(marker(qn, "period", "start", "10:00" if qn <= 4 else "05:00"))
        for ev in by_q.get(qn, []):
            events.append(ev)
            score = [ev["s1"], ev["s2"]]
        period_end_score[qn] = (int(score[0]), int(score[1]))
        if qn in closed:
            events.append(marker(qn, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n

    # drawn fouls: the league links each "Fallo Subito" to its "Fallo commesso"
    new_number = {id(ev): ev["actionNumber"] for ev in events}
    number_of_action = {a.get("action_id"): new_number[id(ev)] for _, ev, a in keyed}
    for _, ev, a in keyed:
        if ev["actionType"] == "foulon" and a.get("linked_action_id") in number_of_action:
            ev["previousAction"] = number_of_action[a["linked_action_id"]]

    # ------------------------------------------------------------------ the box
    scores = (match_reply or {}).get("scores") or {}
    paint: Dict[Tuple[int, str], int] = {}
    fastbreak: Dict[Tuple[int, str], int] = {}
    for ev in chrono:
        if not ev["scoring"] or ev["tno"] not in (1, 2):
            continue
        pts = {"2pt": 2, "3pt": 3, "freethrow": 1}[ev["actionType"]]
        if "pointsinthepaint" in ev["qualifier"]:
            paint[(ev["tno"], ev["pno"])] = paint.get((ev["tno"], ev["pno"]), 0) + pts
        if "fastbreak" in ev["qualifier"]:
            fastbreak[(ev["tno"], ev["pno"])] = fastbreak.get((ev["tno"], ev["pno"]), 0) + pts

    tm: Dict[str, dict] = {}
    for tno, side, tid, name_key, logo_key in ((1, "ht", home_tid, "h_team_name", "home_logo_key"),
                                               (2, "vt", away_tid, "v_team_name", "v_logo_key")):
        box = scores.get(side) or {}
        pl: Dict[str, dict] = {}
        bench = 0
        for r in box.get("rows") or []:
            pid = _num(r.get("player_id"))
            first, last = pbp_name.get(pid, ((r.get("player_name") or "").strip(), (r.get("player_surname") or "").strip()))
            starter = 1 if str(r.get("sf")) == "1" else 0
            p = {"firstName": first, "familyName": last, "name": f"{first} {last}".strip(),
                 "internationalFirstName": first, "internationalFamilyName": last,
                 "scoreboardName": (f"{first[:1]}. {last}" if first else last).strip(),
                 "shirtNumber": str(r.get("player_num") if r.get("player_num") is not None else ""),
                 "playingPosition": "", "starter": starter, "active": 1, "sMinutes": _mmss(r.get("sec")),
                 **_stats(r),
                 "sPointsInThePaint": paint.get((tno, str(pid)), 0),
                 "sPointsFastBreak": fastbreak.get((tno, str(pid)), 0),
                 "sPointsSecondChance": 0, "sPointsFromTurnovers": 0,
                 "eff_1": _num(r.get("val_lega"))}
            if not starter:
                bench += p["sPoints"]
            pl[str(pid)] = p
        totals, team_row = box.get("totals") or {}, box.get("team") or {}
        tot = {"tot_" + k: v for k, v in _stats(totals).items()}
        # PF is the players' own: the team row's fouls are the bench's and the coach's
        tot["tot_sFoulsPersonal"] = sum(p["sFoulsPersonal"] for p in pl.values())
        tot["tot_sFoulsTeam"] = _num(team_row.get("falli_c"))
        tot["tot_sReboundsTeamOffensive"] = _num(team_row.get("rimbalzi_o"))
        tot["tot_sReboundsTeamDefensive"] = _num(team_row.get("rimbalzi_d"))
        tot["tot_sReboundsTeam"] = _num(team_row.get("rimbalzi_t"))
        tot["tot_sTurnoversTeam"] = _num(team_row.get("palle_p"))
        tot["tot_sPointsInThePaint"] = sum(v for (t, _), v in paint.items() if t == tno)
        tot["tot_sPointsFastBreak"] = sum(v for (t, _), v in fastbreak.items() if t == tno)
        tot["tot_sPointsSecondChance"] = 0
        tot["tot_sPointsFromTurnovers"] = 0
        tot["tot_sBenchPoints"] = bench
        club = clubs.get(tid) or {}
        name = (m.get(name_key) or club.get("name") or "").strip()
        t = {"name": name, "nameInternational": name, "shortName": name,
             "code": str(club.get("club_id") or tid or ""),
             "score": _num(m.get("home_final_score" if tno == 1 else "visitor_final_score")),
             "pl": pl, "shot": [], **tot}
        logo = logo_url(m.get(logo_key))
        if logo:
            t["logoT"] = {"url": logo}
            t["logoS"] = {"url": logo}
        tm[str(tno)] = t

    # the score line: the league's final score once it is final, the play-by-play's until then (the
    # header's final_score fields are not a live score); periods from the play-by-play
    if not finished or not (tm["1"]["score"] or tm["2"]["score"]):
        tm["1"]["score"], tm["2"]["score"] = (int(score[0]), int(score[1]))
    prev = (0, 0)
    for qn in range(1, last_q + 1):
        h, v = period_end_score.get(qn, prev)
        tm["1"][f"p{qn}_score"], tm["2"][f"p{qn}_score"] = h - prev[0], v - prev[1]
        prev = (h, v)
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(tm[s].get(f"p{qn}_score", 0) for qn in range(5, last_q + 1))
        tm[s]["full_score"] = tm[s]["score"]

    # biggest lead and lead changes, from the running score
    lead = {1: 0, 2: 0}
    changes, leader = 0, 0
    for ev in chrono:
        diff = int(ev["s1"]) - int(ev["s2"])
        lead[1], lead[2] = max(lead[1], diff), max(lead[2], -diff)
        now = (diff > 0) - (diff < 0)
        if now and leader and now != leader:
            changes += 1
        if now:
            leader = now
    for s, k in (("1", 1), ("2", 2)):
        tm[s]["tot_sBiggestLead"] = lead[k]
        tm[s]["tot_sLeadChanges"] = changes

    # the shot chart, joined to its action
    for _, ev, a in keyed:
        if ev["actionType"] not in ("2pt", "3pt") or ev["tno"] not in (1, 2):
            continue
        if a.get("x") is None or a.get("y") is None:
            continue
        tm[str(ev["tno"])]["shot"].append({
            "r": ev["success"], "x": a["x"], "y": a["y"],
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
    raw["lba"] = {"matchId": str(m.get("id") or ""), "championshipId": _num(m.get("championship_id")),
                  "year": _num(m.get("year")), "round": m.get("day_name"), "status": str(m.get("game_status")),
                  "date": utc_iso(m.get("match_datetime")),
                  "venue": (m.get("plant_name") or "").strip() or None, "unknown": sorted(set(unknown))}
    return raw


def _stats(r: dict) -> dict:
    """One LBA box line (a player's row or the totals) -> FIBA's stat names."""
    g = lambda k: _num(r.get(k))  # noqa: E731
    return {
        "sPoints": g("pun"),
        "sTwoPointersMade": g("t2_r"), "sTwoPointersAttempted": g("t2_t"),
        "sThreePointersMade": g("t3_r"), "sThreePointersAttempted": g("t3_t"),
        "sFieldGoalsMade": g("t2_r") + g("t3_r"), "sFieldGoalsAttempted": g("t2_t") + g("t3_t"),
        "sFreeThrowsMade": g("tl_r"), "sFreeThrowsAttempted": g("tl_t"),
        "sReboundsOffensive": g("rimbalzi_o"), "sReboundsDefensive": g("rimbalzi_d"),
        "sReboundsTotal": g("rimbalzi_t"),
        "sAssists": g("ass"), "sTurnovers": g("palle_p"), "sSteals": g("palle_r"),
        "sBlocks": g("stoppate_dat"), "sBlocksReceived": g("stoppate_sub"),
        "sFoulsPersonal": g("falli_c"), "sFoulsOn": g("falli_sf"),
        "sPlusMinusPoints": g("plus_minus"),
    }


# ============================================================================ the adapter
class LbaAdapter(FibaLiveStatsAdapter):
    """Lega Basket Serie A. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "lba"
    #: a league's own website, not a CDN built to be polled
    min_request_gap_s = 1.0

    # shared across instances: the two sources (regular + playoffs) and the live lane's fetches
    _replies: dict = {}          # url -> (fetched_at, reply)
    TTL_S = 300.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"lba: stage must be 'regular' or 'playoffs', not {stage!r}")
        year = int(season[:4])
        champs = self._championships(year)
        if champs is None:
            raise RuntimeError("lba: championships API unreachable")
        want = {STAGE_CTYPE[stage]} if stage else set(STAGE_CTYPE.values())
        picked = [c for c in champs if c.get("ctype_code") in want]
        if not picked:
            print(f"     LBA {season} {stage or 'all stages'}: no Serie A championship of that kind yet "
                  f"(the league lists {', '.join(sorted({str(c.get('ctype_code')) for c in champs})) or 'none'} for {year})")
            return []
        clubs = self._clubs(year)
        now = datetime.now(timezone.utc)
        out = []
        for c in picked:
            st = "regular" if c.get("ctype_code") == "RS" else "playoffs"
            for r in self._season_matches(_num(c["id"])):
                gid = str(r.get("id") or "").strip()
                h, v = _num(r.get("h_team_id")), _num(r.get("v_team_id"))
                if not gid or not h or not v:
                    continue
                tip, tbc = fixture_tip(r)
                status = str(r.get("game_status"))
                extra = {"home_code": str((clubs.get(h) or {}).get("club_id") or h),
                         "away_code": str((clubs.get(v) or {}).get("club_id") or v),
                         "home_logo": logo_url(r.get("home_logo_key")), "away_logo": logo_url(r.get("v_logo_key")),
                         "round": (r.get("day_name") or "").strip(), "stage": st,
                         "venue": (r.get("plant_name") or "").strip() or None}
                if tbc:
                    extra["time_tbc"] = True
                out.append(ScheduleGame(
                    external_id=gid, home_name=(r.get("h_team_name") or "").strip(),
                    away_name=(r.get("v_team_name") or "").strip(), tipoff_at=tip,
                    status="final" if status == ENDED else "live" if status == LIVE else "scheduled",
                    extra=extra))
        print(f"     LBA {season} {stage or 'all stages'}: {len(out)} games "
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
            raise ValueError(f"lba: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    def _championships(self, year: int) -> Optional[list]:
        got = self._get_json(f"{API}/championships/get-championships", s=year, cs_id=SERIE_A, items=1000)
        if not isinstance(got, dict):
            return None
        return [c for c in got.get("competitions") or []
                if _num(c.get("year")) == year and _num(c.get("championship_series_id")) == SERIE_A]

    def _season_matches(self, champ_id: int) -> list:
        """Every game of one championship: its phases, then one call per phase."""
        base = self._get_json(f"{API}/championships/get-championships-calendar-by-id", id=champ_id)
        if not isinstance(base, dict):
            raise RuntimeError(f"lba: calendar API unreachable for championship {champ_id}")
        seen, out = set(), []
        for ph in (base.get("filters") or {}).get("phases") or []:
            got = self._get_json(f"{API}/championships/get-championships-calendar-by-id", id=champ_id, ph_id=ph.get("id"))
            if not isinstance(got, dict):
                raise RuntimeError(f"lba: calendar API unreachable for championship {champ_id} phase {ph.get('id')}")
            for r in got.get("matches") or []:
                if r.get("id") not in seen:
                    seen.add(r.get("id"))
                    out.append(r)
        return out

    def _clubs(self, year: int) -> Dict[int, dict]:
        """team id -> {club_id, name, club_code} for one season (one call)."""
        got = self._get_json(f"{API}/teams/get-teams", year=year, items=50)
        out = {}
        for t in (got.get("teams") or []) if isinstance(got, dict) else []:
            if t.get("id"):
                out[_num(t["id"])] = {"club_id": _num(t.get("club_id")) or None, "name": (t.get("name") or "").strip(),
                                      "club_code": t.get("club_code")}
        return out

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit() or _too_early(config.get("_tipoff_at")):
            return None                   # decided before a single request is made
        match = self._get_json(f"{API}/championships/get-championships-matches-by-id", id=gid, fresh=True)
        if not isinstance(match, dict) or not match.get("match"):
            return None
        if str(match["match"].get("game_status")) == SCHEDULED:
            return None
        pbp = self._get_json(f"{API}/championships/get-championships-matches-play-by-play",
                             id=gid, info="true", sort="asc", fresh=True)
        if not isinstance(pbp, dict):
            return None
        raw = raw_from_game(match, pbp, self._clubs(_num(match["match"].get("year"))))
        if raw is None:
            return None
        if raw["lba"]["unknown"]:
            print(f"     LBA {gid}: {len(raw['lba']['unknown'])} action kind(s) the adapter does not know, "
                  f"left out: {raw['lba']['unknown'][:4]}")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = config.get("_tipoff_at") or raw["lba"]["date"]
        return b

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(LbaAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        LbaAdapter._last_req = time.time()

    def _get_json(self, url: str, fresh: bool = False, **params):
        key = url + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        at, cached = self._replies.get(key, (0.0, None))
        if cached is not None and not fresh and time.time() - at < self.TTL_S:
            return cached
        for attempt in range(3):
            self._pause()
            try:
                r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=60)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                try:
                    got = r.json()
                except ValueError:
                    return None
                self._replies[key] = (time.time(), got)
                return got
            time.sleep(1.5 * (attempt + 1))
        return None
