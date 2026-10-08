# -*- coding: utf-8 -*-
"""Israel's Winner League (the Israel Basketball Super League), from basket.co.il and Segev Stats.

WHERE THE DATA IS. Two sources, both answering a plain GET with no key:

    basket.co.il/ws/ws.asmx/Games?league_id=0&team_uid=0&cYear=Y&board_id=0&board_round=0&team_id=0&game_id=0
        EVERY game of a season, every competition ("board"), as JSON: the site's game id (game-zone.asp?GameId=),
        the date (dd/mm/yyyy) and time (Israel time), both clubs (team1 is the home club) with English names and
        crests, the score once it is played, the venue, the board (5 Winner League, 16/26/17 its quarter-finals,
        semi-finals and final series, 10 Winner Cup, 34 Supercup) - and ExternalID, THE GAME'S SEGEV ID, the key
        to its box score and play-by-play. cYear is the season's END year (2026-27 is cYear 2027). A game's
        ExternalID is filled in some days before it is played (21 of the 182 of 2026-27 on 8 Oct 2026).
    basket.co.il/ws/ws.asmx/Teams?board_id=5&cYear=Y
        the season's clubs: TeamUID, the club's own id, THE SAME EVERY SEASON (Maccabi Tel Aviv is 10, Hapoel Holon
        7 through its sponsor's change), against team_year_id, the id Games uses, which is NEW every season (Ramat
        Gan 1111, then 2113); the club's English short name ("M. Rishon") and crest.
    stats.segevstats.com/realtimestat_heb/api/?method=getActions&game_id=S
        the game's header (the clubs, every player on the sheet with a Latin and a Hebrew name, the jersey) and its
        play-by-play: every action with its quarter, the clock LEFT (quarterTime), the player and club, the score
        after a scoring play, and parentActionId, which ties an assist, a rebound, a block, a steal or a drawn foul
        to its shot, miss, turnover or foul. Shots carry coordinates (below).
    stats.segevstats.com/realtimestat_heb/api/?method=getBoxScore&game_id=S
        the box: per player minutes (mm:ss), starter, +/-, made and MISSED twos, threes and free throws, rebounds,
        fouls and fouls drawn, steals, turnovers, assists, blocks and blocks received, fast-break and second-chance
        points, the rating ("rate", the index); per club the team row (team rebounds, team turnovers) and totals with
        the biggest lead and lead changes; per game the quarter scores, paint points, points off turnovers and
        bench points, and gameFinished.
    This is what basket.co.il's own LIVESTATS page reads (basket.co.il/livestats/game.html?game_id=S).

THE NUMBERS AGREE WITH THEMSELVES. On 15 games of 2025-26 (the regular season across the year, three overtime games
- one of them double - a quarter-final, a semi-final, the final series and two cup games), every player's box line
equals the count of his own actions for all 17 counting stats (352 lines, none off), five starters a side, and the
minutes add to 200 a side (225 and 250 with overtime).

THE KEY is basket.co.il's game id: every fixture has it from the day the calendar is published, while the Segev id
arrives later. fetch() finds the Segev id on the season's Games list (one read, kept five minutes). A game with no
Segev id yet, or one Segev does not have (2025's Supercup: "game not found"), is not fetched.

THE CLUB CODE is TeamUID, so a club is the same club every season and through a sponsor's rename. Names, short
names and crests are basket.co.il's, the same on the fixture and on the box score, so the two meet on one club.

TIP-OFF. dd/mm/yyyy + HH:MM in Israel time (Asia/Jerusalem). A game with no time yet is noon UTC on its local date
with extra["time_tbc"] - the U SPORTS / PLK / LBA convention.

FINAL. Segev's gameFinished, or its end-of-game action, or basket.co.il's posted score with the game over three
hours: one 2025-26 game (Segev 224) still says gameFinished false with no end-of-game, months after it was played.
AN OFFICIAL RESULT THE FEED DOES NOT HAVE IS HELD, as Finland's: a 2025-26 semi-final stands as 20-1 on basket.co.il
(awarded) while Segev holds three quarters played to 77-67; a final whose score differs from basket.co.il's is not
written, and said so.

THE GAME is translated into FIBA LiveStats data.json shape and handed to bundle_from_raw like every other translated
league (fibashape.py): FORWARDS, actionNumber 1..n in play order (quarter, clock run off, then Segev's own order),
each period opened and closed once, the final whistle written once the game is final, each drawn foul pointing at
its foul (previousAction), each substitution its own in or out. Clock ticks and deflections record nothing the
pipeline reads and are left out; an action kind the tables do not know is kept on raw["ibsl"]["unknown"].

SHOT CHART. Segev's coordinates are centimetres on a half court (basket.co.il's chart says so and draws them that
way): coordY is the depth from the attacking baseline (the basket at 157.5, the top of the arc at 832), coordX the
position across the 15 m width - which basket.co.il finds compressed in the tracked data and stretches by 1.12 from
the centreline. They go onto the pipeline's frame with fibashape.at_rim_offset, stretched the same way.

WHAT IS AND IS NOT THERE. Fast breaks are flagged on each scoring play (carried as FIBA's "fastbreak"); second-chance
and off-turnover points are not flagged in the play-by-play, so their stint buckets stay 0 (stints.py's honest
zero), while the box carries Segev's own per-player fast-break and second-chance points and the club's published
paint points, points off turnovers and bench points.
"""
from __future__ import annotations

import html as _html
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA
from .fibashape import at_rim_offset
from .twobbl import current_season, normalize_season

try:
    from zoneinfo import ZoneInfo
except ImportError:                                   # pragma: no cover
    ZoneInfo = None

SITE = "https://basket.co.il"
SEGEV = "https://stats.segevstats.com/realtimestat_heb/api/"
TZ = "Asia/Jerusalem"
#: which boards a source reads, by the board's English name (the ids have been stable, the names say what they are)
STAGE_BOARDS = {"regular": r"^Winner League$", "playoffs": r"^Winner League\s+\S", "cup": r"^Winner Cup$"}
#: before this long ahead of tip-off a game's Segev pages have nothing to say
FETCH_LEAD_S = 30 * 60
#: a game posted with a score this long after tip-off is over, whatever Segev's flag says
FINAL_AFTER_S = 3 * 3600
#: basket.co.il's chart: the basket's depth from the baseline, the court's width, the width stretch
BASKET_DEPTH_CM, COURT_W_CM, WIDTH_STRETCH = 157.5, 1500.0, 1.12

# ============================================================================ the vocabulary
SHOT_KIND = {"jump-shot": "jumpshot", "lay-up": "layup", "dunk": "dunk", "allyhoop": "alleyoop",
             "alley-oop": "alleyoop", "hook-shot": "hookshot", "tip-in": "tipin"}
TURNOVER_KIND = {"bad-pass": "badpass", "ball-handling": "ballhandling", "travelling": "travel",
                 "out-of-bounds": "outofbounds", "backcourt-violation": "backcourt", "double-dribble": "doubledribble",
                 "24-seconds-violation": "shotclock", "8-seconds-violation": "8sec", "5-seconds-violation": "5sec",
                 "3-seconds-violation": "3sec", "offensive-foul": "offensive", "other": "other"}
FOUL_KIND = {"personal": "personal", "technical": "technical", "unsportsmanlike": "unsportsmanlike",
             "OffensiveFoulUnsportsmanlike": "unsportsmanlike", "disqualifying": "disqualifying",
             "disqualification": "disqualifying"}
#: recorded by Segev, deliberately not translated: nothing the pipeline reads (deflections are no box stat here; a coach's
#: challenge and an official review are the instant-replay calls of 2026-27, which change nothing on their own)
SKIP = {"clock", "deflection", "game", "quarter", "challenge", "officialReview"}


def foul_kind(kind: str) -> Optional[str]:
    """Segev's foul type -> FIBA's. 2026-27 brought kinds with a reason after them (unsportsmanlike-flagrant,
    unsportsmanlike-disruptive, technical-administrative): the family is what FIBA's subType is."""
    if kind in FOUL_KIND:
        return FOUL_KIND[kind]
    for fam in ("unsportsmanlike", "technical", "disqualifying"):
        if kind.lower().startswith(fam):
            return FOUL_KIND[fam]
    return None


def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _txt(s) -> str:
    return _html.unescape(str(s or "")).strip()


def _clock(s) -> int:
    """'09:42' (the clock left) -> 582."""
    m = re.match(r"^\s*(\d+):(\d+)", str(s or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _score(s) -> Optional[Tuple[int, int]]:
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def season_year(season: str) -> int:
    """'2026/2027' (or '2026-27') -> 2027, basket.co.il's cYear: a season goes by its END year."""
    return int(str(season)[:4]) + 1


def fixture_tip(row: dict) -> Tuple[Optional[str], bool]:
    """(tip-off in UTC, time still to be confirmed) from basket.co.il's dd/mm/yyyy + HH:MM, Israel time."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", str(row.get("game_date_txt") or "").strip())
    if not m:
        return None, False
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    t = re.match(r"^(\d{1,2}):(\d{2})", str(row.get("TimeOfGame") or "").strip())
    if not t or (int(t.group(1)), int(t.group(2))) == (0, 0):
        return f"{y:04d}-{mo:02d}-{d:02d}T12:00:00+00:00", True
    local = datetime(y, mo, d, int(t.group(1)), int(t.group(2)))
    if ZoneInfo:
        aware = local.replace(tzinfo=ZoneInfo(TZ))
    else:                                              # pragma: no cover - Israel time, summer or not, as a fallback
        aware = local.replace(tzinfo=timezone(timedelta(hours=3 if 4 <= mo <= 10 else 2)))
    return aware.astimezone(timezone.utc).replace(microsecond=0).isoformat(), False


def segev_id(row: dict) -> Optional[str]:
    """A game's Segev id, or None while it has none: basket.co.il writes "0" until it is assigned (161 of the 182
    Winner League games of 2026-27 on 8 Oct 2026), and "0" is no game."""
    s = str((row or {}).get("ExternalID") or "").strip()
    return s if s.isdigit() and int(s) > 0 else None


def posted_score(row: dict) -> Optional[Tuple[int, int]]:
    """basket.co.il's score for a game, once there is one ('' / '0'-'0' before)."""
    a, b = str(row.get("score_team1") or "").strip(), str(row.get("score_team2") or "").strip()
    if not a.isdigit() or not b.isdigit() or (int(a) == 0 and int(b) == 0):
        return None
    return int(a), int(b)


def _ago(iso: Optional[str], now: Optional[datetime] = None) -> Optional[float]:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00")) if iso else None
    except ValueError:
        return None
    return None if t is None else ((now or datetime.now(timezone.utc)) - t).total_seconds()


def club_of(row: dict, side: int, teams: Dict[str, dict]) -> dict:
    """{code, name, short, logo} for team1 (side 1, home) or team2 of a Games row."""
    tid = str(row.get("team%d" % side) or "")
    t = teams.get(tid) or {}
    name = _txt(row.get("team%d_name_eng" % side)) or t.get("name") or _txt(row.get("team%d_name" % side))
    logo = str(row.get("team%d_logo" % side) or "").strip() or t.get("logo") or None
    return {"code": t.get("uid") or "", "name": name, "short": t.get("short") or "", "logo": logo, "season_id": tid}


#: a shot the operator calls a finish at the basket
RIM_KINDS = {"lay-up", "dunk", "allyhoop", "alley-oop", "tip-in"}
#: how far from the basket such a shot is put, at most: just inside the pipeline's 1.22 m "at the rim"
RIM_PULL_CM = 120.0


def shot_xy(params: dict) -> Optional[Tuple[float, float]]:
    """Segev's half-court centimetres -> the pipeline's chart percentages (against the left rim).

    A LAY-UP IS AT THE RIM, WHEREVER IT WAS TAPPED. Segev's operators tap on a coarse grid (28 cm deep, 15 cm
    across) and tap a finish by its area, not its spot: over 15 games of 2025-26 the dunks sit on the basket (median
    depth 140 cm, centred) while the lay-ups' median is 1.85 m from it and only 14% fall inside 1.22 m - read as
    tapped, six lay-ups in seven would count as mid-range attempts. So a lay-up, dunk or alley-oop tapped further out
    is drawn back along its own line to 1.2 m from the basket: its side of the floor kept, its distance the one its
    label says. Every other shot stays where it was tapped."""
    try:
        depth, across = float(params.get("coordY")), float(params.get("coordX"))
    except (TypeError, ValueError):
        return None
    dx, dy = (across - COURT_W_CM / 2) * WIDTH_STRETCH, depth - BASKET_DEPTH_CM
    if str(params.get("type") or "") in RIM_KINDS:
        d = (dx * dx + dy * dy) ** 0.5
        if d > RIM_PULL_CM:
            dx, dy = dx * RIM_PULL_CM / d, dy * RIM_PULL_CM / d
    return at_rim_offset(dx, dy)


# ============================================================================ one game
def classify(a: dict) -> Tuple[Optional[str], str, Optional[int], List[str], Optional[str]]:
    """(actionType, subType, success, qualifier, unknown) for one Segev action. actionType None = recorded nothing
    (skipped on purpose, or not known - then `unknown` says what it was)."""
    t = a.get("type") or ""
    p = a.get("parameters") or {}
    team_only = not _num(a.get("playerId"))
    if t == "shot":
        pts = _num(p.get("points"))
        made = 1 if p.get("made") == "made" else 0
        kind = SHOT_KIND.get(str(p.get("type") or ""))
        quals = ["fastbreak"] if p.get("fastBreak") else []
        if p.get("secondChancePoints"):
            quals.append("2ndchance")
        if p.get("pointsFromTurnover"):
            quals.append("fromturnover")
        return ("3pt" if pts == 3 else "2pt"), (kind or "jumpshot"), made, quals, (None if kind else f"shot:{p.get('type')}")
    if t == "freeThrow":
        n, of = _num(p.get("freeThrowNumber")) or 1, _num(p.get("freeThrowsAwarded")) or 1
        quals = ["fastbreak"] if p.get("fastBreak") else []
        if p.get("secondChancePoints"):
            quals.append("2ndchance")
        if p.get("pointsFromTurnover"):
            quals.append("fromturnover")
        return "freethrow", f"{n}of{of}", (1 if p.get("made") == "made" else 0), quals, None
    if t == "rebound":
        sub = "offensive" if p.get("type") == "offensive" else "defensive"
        return "rebound", sub, None, (["team"] if team_only else []), None
    if t in ("assist", "steal", "block"):
        return t, "", None, [], None
    if t == "foul-drawn":
        return "foulon", "", None, [], None
    if t == "foul":
        kind = str(p.get("type") or "")
        if team_only:                                  # a coach's or the bench's
            return "foul", ("coachtechnical" if _num(p.get("isCoachFoul")) or not _num(p.get("isBenchFoul")) else "benchtechnical"), None, [], \
                (None if foul_kind(kind) == "technical" else f"teamfoul:{kind}")
        if kind == "personal" and p.get("kind") == "offensive":
            return "foul", "offensive", None, [], None
        sub = foul_kind(kind)
        quals = ["shooting"] if (p.get("kind") == "shooting" and str(p.get("freeThrows") or "0") not in ("0", "")) else []
        return "foul", (sub or "personal"), None, quals, (None if sub else f"foul:{kind}")
    if t == "turnover":
        kind = str(p.get("type") or "")
        sub = TURNOVER_KIND.get(kind)
        return "turnover", (sub or "other"), None, (["team"] if team_only else []), (None if sub else f"turnover:{kind}")
    if t == "timeout":
        return "timeout", "full", None, [], None
    if t == "substitution":
        if p.get("playerIn") is not None:
            return "substitution", "in", None, [], None
        if p.get("playerOut") is not None:
            return "substitution", "out", None, [], None
        return None, "", None, [], "substitution:neither"
    if t in SKIP:
        return None, "", None, [], None
    return None, "", None, [], f"action:{t}|{p.get('type')}"


def _stats(r: dict) -> dict:
    """One Segev box line (a player's, the team row or the totals) -> FIBA's stat names. Segev counts MISSES."""
    g = lambda k: _num(r.get(k))  # noqa: E731
    two_m, two_a = g("fg_2m"), g("fg_2m") + g("fg_2mis")
    three_m, three_a = g("fg_3m"), g("fg_3m") + g("fg_3mis")
    return {
        "sPoints": g("points"),
        "sTwoPointersMade": two_m, "sTwoPointersAttempted": two_a,
        "sThreePointersMade": three_m, "sThreePointersAttempted": three_a,
        "sFieldGoalsMade": two_m + three_m, "sFieldGoalsAttempted": two_a + three_a,
        "sFreeThrowsMade": g("ft_m"), "sFreeThrowsAttempted": g("ft_m") + g("ft_mis"),
        "sReboundsOffensive": g("reb_o"), "sReboundsDefensive": g("reb_d"), "sReboundsTotal": g("reb_o") + g("reb_d"),
        "sAssists": g("ast"), "sTurnovers": g("to"), "sSteals": g("stl"),
        "sBlocks": g("blk"), "sBlocksReceived": g("blk_against"),
        "sFoulsPersonal": g("f"), "sFoulsOn": g("f_drawn"),
        "sPointsFastBreak": g("fb"), "sPointsSecondChance": g("sc"),
    }


def raw_from_game(row: dict, teams: Dict[str, dict], actions_reply: dict, box_reply: dict,
                  finished: Optional[bool] = None) -> Optional[dict]:
    """One game (its Games row, the season's clubs, Segev's getActions and getBoxScore replies) -> FIBA data.json
    shape: play-by-play OLDEST first, actionNumber 1..n, each period opened and closed once, the final whistle once.
    Pure: the same input gives the same output. `finished` overrides the feed's own idea of whether it is over
    (fetch() decides it from Segev and basket.co.il together).

    None when there is nothing to show yet (no header, or not one action that records anything)."""
    res = (actions_reply or {}).get("result") or {}
    info, acts = res.get("gameInfo") or {}, res.get("actions") or []
    box = ((box_reply or {}).get("result") or {}).get("boxscore") or {}
    if not info or not acts:
        return None
    bgi = box.get("gameInfo") or {}
    home_sid, away_sid = str((info.get("homeTeam") or {}).get("id") or ""), str((info.get("awayTeam") or {}).get("id") or "")
    tno_of = {home_sid: 1, away_sid: 2}
    n_q = _num(info.get("numberOfQuarters")) or 4
    plen = lambda q: 600 if q <= n_q else 300  # noqa: E731
    if finished is None:
        finished = bool(bgi.get("gameFinished") or info.get("gameFinished")) or any(
            a.get("type") == "game" and (a.get("parameters") or {}).get("type") == "end-of-game" for a in acts)

    # the sheet: Segev's player id -> (first, last, jersey) per side
    people: Dict[str, Tuple[str, str, str]] = {}
    for side in ("homeTeam", "awayTeam"):
        for pl in (info.get(side) or {}).get("players") or []:
            people[str(pl.get("id"))] = ((pl.get("firstName") or "").strip(), (pl.get("lastName") or "").strip(),
                                         str(pl.get("jerseyNumber") if pl.get("jerseyNumber") is not None else ""))

    # ONE CHANGE, ONE MOMENT. Since 2026-27 the operators type a change's outs and ins one by one while the clock
    # still shows the seconds ticking (a 2026-27 cup game: out 5:20, out 5:19, in 5:17, in 5:16), so read as written
    # the side has three on the floor for three seconds. An unbroken run of a side's substitutions (only clock ticks
    # between them, one quarter) is one change, at the clock of its first; the engine takes a same-second batch of
    # outs and ins as one change, as FIBA's own feed writes them. 2025-26's changes were written at one clock already.
    sub_clock: Dict[int, str] = {}
    run: List[int] = []

    def close_run():
        if len(run) > 1:
            for k in run[1:]:
                sub_clock[k] = acts[run[0]].get("quarterTime")
        run.clear()

    for i, a in enumerate(acts):
        if a.get("type") == "clock":
            continue
        if a.get("type") == "substitution" and run and a.get("teamId") == acts[run[0]].get("teamId") \
                and a.get("quarter") == acts[run[0]].get("quarter"):
            run.append(i)
            continue
        close_run()
        if a.get("type") == "substitution":
            run.append(i)
    close_run()

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    keyed = []
    closed = set()
    for i, a in enumerate(acts):
        q = _num(a.get("quarter")) or 1
        p = a.get("parameters") or {}
        if a.get("type") == "quarter" and p.get("type") == "end-of-quarter":
            closed.add(_num(p.get("quarter")) or q)
        at, sub, success, quals, unk = classify(a)
        if unk:
            unknown.append(unk)
        if not at:
            continue
        tno = tno_of.get(str(a.get("teamId") or ""), 0)
        pid = str(_num(a.get("playerId")) or "")
        if "team" in quals:
            pid = ""
        first, last, shirt = people.get(pid, ("", "", "")) if pid else ("", "", "")
        remain = _clock(sub_clock.get(i, a.get("quarterTime")))
        # A CHANGE MADE IN A BREAK BELONGS TO THE NEXT PERIOD, as FIBA records it. Segev's operators sometimes take a
        # whole five off at the 0:00 of a period and put the next five on at the 10:00 of the next (a 2025-26
        # quarter-final, Jerusalem at half-time): read where they were written, the floor is empty between the two
        if at == "substitution" and remain == 0 and q < max(_num(x.get("quarter")) for x in acts):
            q, remain = q + 1, plen(q + 1)
        ev = {
            "actionNumber": 0,
            "period": q if q <= n_q else q - n_q,
            "periodType": "REGULAR" if q <= n_q else "OVERTIME",
            "gt": f"{remain // 60:02d}:{remain % 60:02d}",
            "s1": "", "s2": "",
            "tno": tno, "pno": pid,
            "actionType": at, "subType": sub, "qualifier": quals,
            "success": success if success is not None else 0,
            "scoring": 1 if (at in ("2pt", "3pt", "freethrow") and success == 1) else 0,
            "shirtNumber": shirt if pid else "",
            "firstName": first, "familyName": last,
            "player": f"{first} {last}".strip(),
        }
        # within one second, Segev's own list order: it puts a change before the free throws it was made for (an
        # out at 0:07, the in, then the shots), where its ids put one of the shots between the two
        keyed.append(((q, plen(q) - remain, i), ev, a))
    if not keyed:
        return None
    keyed.sort(key=lambda t: t[0])

    # the running score: Segev's own after each scoring play, carried forward
    score = [0, 0]
    for _, ev, a in keyed:
        if ev["scoring"]:
            got = _score(a.get("score"))
            if got:
                score = list(got)
            else:                                      # a basket the feed wrote no score on: added up
                score[ev["tno"] - 1] += {"2pt": 2, "3pt": 3, "freethrow": 1}[ev["actionType"]]
        ev["s1"], ev["s2"] = str(score[0]), str(score[1])
    chrono = [ev for _, ev, _ in keyed]

    def qnum(ev):
        return ev["period"] + (n_q if ev["periodType"] == "OVERTIME" else 0)

    last_q = max(max(qnum(ev) for ev in chrono), max(closed) if closed else 1, _num(bgi.get("currentQuarter")))
    closed |= set(range(1, last_q))
    if finished:
        closed.add(last_q)
    by_q: Dict[int, List[dict]] = {}
    for ev in chrono:
        by_q.setdefault(qnum(ev), []).append(ev)
    run = ["0", "0"]

    def marker(q, action, sub, clock):
        return {"actionNumber": 0, "period": q if q <= n_q else q - n_q,
                "periodType": "REGULAR" if q <= n_q else "OVERTIME", "gt": clock,
                "s1": run[0], "s2": run[1], "tno": 0, "pno": "",
                "actionType": action, "subType": sub, "qualifier": [], "success": 0, "scoring": 0,
                "shirtNumber": "", "firstName": "", "familyName": "", "player": ""}

    events: List[dict] = []
    period_end: Dict[int, Tuple[int, int]] = {}
    for q in range(1, last_q + 1):
        events.append(marker(q, "period", "start", "10:00" if q <= n_q else "05:00"))
        for ev in by_q.get(q, []):
            events.append(ev)
            run = [ev["s1"], ev["s2"]]
        period_end[q] = (int(run[0]), int(run[1]))
        if q in closed:
            events.append(marker(q, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n

    # drawn fouls point at their foul (Segev's parentActionId). On an and-one Segev ties the drawn foul to the fouled
    # player's own shot instead (3 of 38 in a 2025-26 game), and the foul to that same shot, often a second apart on
    # the running clock: then it is the other side's foul on the same shot, else its foul nearest in time (3 s at
    # most) - the one whose fouledOn is this player's shirt first
    number_of = {_num(a.get("id")): ev["actionNumber"] for _, ev, a in keyed}
    kind_of = {_num(a.get("id")): ev["actionType"] for _, ev, a in keyed}
    fouls = [(ev, a) for _, ev, a in keyed if ev["actionType"] == "foul"]

    def at_s(e):
        return (qnum(e), (600 if qnum(e) <= n_q else 300) - _clock(e["gt"]))

    for _, ev, a in keyed:
        if ev["actionType"] != "foulon":
            continue
        parent = _num(a.get("parentActionId"))
        if kind_of.get(parent) == "foul":
            ev["previousAction"] = number_of[parent]
            continue
        q0, t0 = at_s(ev)
        other = [(f, fa) for f, fa in fouls if f["tno"] != ev["tno"] and at_s(f)[0] == q0 and abs(at_s(f)[1] - t0) <= 3]
        same = [(f, fa) for f, fa in other if parent and _num(fa.get("parentActionId")) == parent]
        pool = same or other
        pool.sort(key=lambda fx: (str((fx[1].get("parameters") or {}).get("fouledOn") or "") != ev["shirtNumber"], abs(at_s(fx[0])[1] - t0)))
        if pool:
            ev["previousAction"] = pool[0][0]["actionNumber"]

    # ------------------------------------------------------------------ the box
    tm: Dict[str, dict] = {}
    for tno, side, gs_key in ((1, "homeTeam", "homeGameStats"), (2, "awayTeam", "awayGameStats")):
        bt = box.get(side) or {}
        club = club_of(row, tno, teams)
        pl: Dict[str, dict] = {}
        for r in bt.get("players") or []:
            pid = str(_num(r.get("playerId")))
            first, last, shirt = people.get(pid, ("", "", str(r.get("jerseyNumber") or "")))
            p = {"firstName": first, "familyName": last, "name": f"{first} {last}".strip(),
                 "internationalFirstName": first, "internationalFamilyName": last,
                 "scoreboardName": (f"{first[:1]}. {last}" if first else last).strip(),
                 "shirtNumber": str(r.get("jerseyNumber") if r.get("jerseyNumber") is not None else shirt),
                 "playingPosition": "", "starter": 1 if r.get("starter") else 0, "active": 1,
                 "sMinutes": str(r.get("minutes") or "0:00"),
                 **_stats(r),
                 "sPointsInThePaint": 0, "sPointsFromTurnovers": 0,
                 "sPlusMinusPoints": _num(r.get("plusMinus")), "eff_1": _num(r.get("rate"))}
            pl[pid] = p
        totals, team_row = bt.get("teamActionsTotal") or {}, bt.get("teamActions") or {}
        gs = bgi.get(gs_key) or {}
        tot = {"tot_" + k: v for k, v in _stats(totals).items()}
        tot["tot_sFoulsPersonal"] = sum(x["sFoulsPersonal"] for x in pl.values())
        tot["tot_sFoulsTeam"] = _num(team_row.get("f"))
        tot["tot_sReboundsTeamOffensive"] = _num(team_row.get("reb_o"))
        tot["tot_sReboundsTeamDefensive"] = _num(team_row.get("reb_d"))
        tot["tot_sReboundsTeam"] = _num(team_row.get("reb_o")) + _num(team_row.get("reb_d"))
        tot["tot_sTurnoversTeam"] = _num(team_row.get("to"))
        tot["tot_sPointsInThePaint"] = _num(gs.get("Points_in_the_paint"))
        tot["tot_sPointsFromTurnovers"] = _num(gs.get("Points_from_turnovers"))
        tot["tot_sBenchPoints"] = _num(gs.get("bench_points"))
        tot["tot_sBiggestLead"] = _num(totals.get("BLead"))
        tot["tot_sLeadChanges"] = _num(totals.get("LeadChange"))
        t = {"name": club["name"], "nameInternational": club["name"], "shortName": club["short"] or club["name"],
             "code": club["code"], "score": _num(bgi.get("homeScore" if tno == 1 else "awayScore")),
             "pl": pl, "shot": [], **tot}
        if club["logo"]:
            t["logoT"] = {"url": club["logo"]}
            t["logoS"] = {"url": club["logo"]}
        tm[str(tno)] = t

    # the score line: the box's own; the play-by-play's while the box has none yet
    if not (tm["1"]["score"] or tm["2"]["score"]):
        tm["1"]["score"], tm["2"]["score"] = int(score[0]), int(score[1])
    qs = (bgi.get("homeQuarterScores") or [], bgi.get("awayQuarterScores") or [])
    prev = (0, 0)
    for q in range(1, last_q + 1):
        if len(qs[0]) >= q and len(qs[1]) >= q and (bgi.get("homeQuarterScores") is not None):
            tm["1"][f"p{q}_score"], tm["2"][f"p{q}_score"] = _num(qs[0][q - 1]), _num(qs[1][q - 1])
        else:
            h, v = period_end.get(q, prev)
            tm["1"][f"p{q}_score"], tm["2"][f"p{q}_score"] = h - prev[0], v - prev[1]
        prev = period_end.get(q, prev)
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(tm[s].get(f"p{q}_score", 0) for q in range(n_q + 1, last_q + 1))
        tm[s]["full_score"] = tm[s]["score"]

    # the shot chart, joined to its action
    for _, ev, a in keyed:
        if ev["actionType"] not in ("2pt", "3pt") or ev["tno"] not in (1, 2):
            continue
        xy = shot_xy(a.get("parameters") or {})
        if xy is None:
            continue
        tm[str(ev["tno"])]["shot"].append({
            "r": ev["success"], "x": round(xy[0], 2), "y": round(xy[1], 2),
            "actionType": ev["actionType"], "subType": ev["subType"],
            "actionNumber": ev["actionNumber"], "pno": ev["pno"],
            "per": ev["period"], "perType": ev["periodType"],
            "player": ev["player"], "shirtNumber": ev["shirtNumber"]})

    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= n_q else "OVERTIME", "inOT": 1 if last_q > n_q else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    else:
        qt = bgi.get("currentQuarterTime") or info.get("currentQuarterTime") or {}
        if isinstance(qt, dict) and ("m" in qt or "s" in qt):
            raw["clock"] = f"{_num(qt.get('m')):02d}:{_num(qt.get('s')):02d}"
        else:
            raw["clock"] = last_play["gt"] if last_play and qnum(last_play) == last_q else ("10:00" if last_q <= n_q else "05:00")
    tip, _ = fixture_tip(row)
    raw["ibsl"] = {"gameId": str(row.get("game_id") or ""), "segevId": segev_id(row) or str(info.get("gameId") or ""),
                   "board": _txt(row.get("board_name_eng")), "round": str(row.get("gameNumber") or ""),
                   "date": tip, "venue": _txt(row.get("PlaceOfGame")) or None, "finished": bool(finished),
                   "unknown": sorted(set(unknown))}
    return raw


def decide(row: dict, actions_reply: dict, box_reply: dict, since_tip_s: Optional[float]) -> Tuple[bool, Optional[str]]:
    """(finished, why it is held - or None) for one game. Finished: Segev says so (gameFinished, or its end-of-game
    action), or basket.co.il has posted the same score and the game tipped off over three hours ago (Segev's flag is
    sometimes never set). Held: basket.co.il's result differs from the feed's final - an awarded game (a 2025-26
    semi-final stands 20-1, the feed has three quarters to 77-67) or a feed not yet corrected."""
    info = ((actions_reply or {}).get("result") or {}).get("gameInfo") or {}
    acts = ((actions_reply or {}).get("result") or {}).get("actions") or []
    bgi = (((box_reply or {}).get("result") or {}).get("boxscore") or {}).get("gameInfo") or {}
    posted = posted_score(row)
    over = since_tip_s is not None and since_tip_s > FINAL_AFTER_S
    feed_final = bool(bgi.get("gameFinished") or info.get("gameFinished")) or any(
        a.get("type") == "game" and (a.get("parameters") or {}).get("type") == "end-of-game" for a in acts)
    got = (_num(bgi.get("homeScore")), _num(bgi.get("awayScore")))
    finished = feed_final or bool(posted and posted == got and over)
    if posted and (finished or over) and posted != got:
        return finished, (f"the stats feed's final is {got[0]}-{got[1]}, basket.co.il's result {posted[0]}-{posted[1]}; "
                          f"held until they agree")
    return finished, None


# ============================================================================ the adapter
class IbslAdapter(FibaLiveStatsAdapter):
    """Israel's Winner League (IBSL). FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "ibsl"
    #: a league's own website and its stats provider, not a CDN built to be polled
    min_request_gap_s = 0.6

    # shared across instances: the sources (regular, play-offs, cup) and the live lane's fetches read one list
    _replies: dict = {}          # url -> (fetched_at, reply)
    _fresh_at: dict = {}         # cYear -> when its Games list was last read fresh for a missing Segev id
    TTL_S = 300.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        year = season_year(season)
        rx = self._boards(config)
        games = self._games(year)
        if games is None:
            raise RuntimeError("ibsl: basket.co.il's Games service unreachable")
        teams = self._teams(year)
        now = datetime.now(timezone.utc)
        out = []
        for r in games:
            if not rx.search(_txt(r.get("board_name_eng"))):
                continue
            gid = str(r.get("game_id") or "").strip()
            if not gid.isdigit():
                continue
            home, away = club_of(r, 1, teams), club_of(r, 2, teams)
            if not home["name"] or not away["name"]:
                continue
            tip, tbc = fixture_tip(r)
            sc = posted_score(r)
            ago = _ago(tip, now)
            status = "scheduled"
            if sc:
                status = "final" if (ago is None or ago > FINAL_AFTER_S) else "live"
            extra = {"home_code": home["code"], "away_code": away["code"],
                     "home_short": home["short"], "away_short": away["short"],
                     "home_logo": home["logo"], "away_logo": away["logo"],
                     "venue": _txt(r.get("PlaceOfGame")) or None,
                     "round": str(r.get("gameNumber") or ""), "stage": _txt(r.get("board_name_eng")),
                     "segev_id": segev_id(r)}
            if sc:
                extra["home_score"], extra["away_score"] = str(sc[0]), str(sc[1])
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id=gid, home_name=home["name"], away_name=away["name"],
                                    tipoff_at=tip, status=status, extra=extra))
        print(f"     IBSL {season} /{rx.pattern}/: {len(out)} games ({sum(1 for g in out if g.status == 'final')} final, "
              f"{sum(1 for g in out if (g.extra or {}).get('segev_id'))} with a Segev id)")
        return out

    @staticmethod
    def _season(config: dict) -> str:
        tok = config.get("season")
        if not tok:
            return current_season()
        season = normalize_season(tok)
        if not season:
            raise ValueError(f"ibsl: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    @staticmethod
    def _boards(config: dict) -> "re.Pattern":
        if config.get("board_match"):
            return re.compile(str(config["board_match"]), re.I)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in STAGE_BOARDS:
            raise ValueError(f"ibsl: stage must be one of {', '.join(STAGE_BOARDS)}, not {stage!r}")
        return re.compile(STAGE_BOARDS[stage], re.I)

    def _games(self, year: int, fresh: bool = False) -> Optional[list]:
        got = self._get_json(f"{SITE}/ws/ws.asmx/Games", fresh=fresh, league_id=0, team_uid=0, cYear=year,
                             board_id=0, board_round=0, team_id=0, game_id=0)
        return got.get("games") if isinstance(got, dict) and isinstance(got.get("games"), list) else None

    def _teams(self, year: int) -> Dict[str, dict]:
        """season team id (Games' team1/team2) -> {uid, name, short, logo}, from the Winner League's club list."""
        got = self._get_json(f"{SITE}/ws/ws.asmx/Teams", board_id=5, cYear=year)
        out = {}
        for t in (got.get("teams") or []) if isinstance(got, dict) else []:
            if t.get("team_year_id") is None:
                continue
            logo = str(t.get("team_icon2") or "").strip() or None
            out[str(t["team_year_id"])] = {"uid": str(t.get("TeamUID") or ""), "name": _txt(t.get("teamEng")),
                                           "short": _txt(t.get("team_shortNameEng")), "logo": logo}
        return out

    def _row(self, gid: str, config: dict) -> Tuple[Optional[dict], Optional[int]]:
        """basket.co.il's row for a game, from the season's list (the source's season, then the one either side)."""
        year = season_year(self._season(config))
        for y in (year, year - 1, year + 1):
            for r in self._games(y) or []:
                if str(r.get("game_id")) == gid:
                    return r, y
        return None, None

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit():
            return None
        tip_cfg = config.get("_tipoff_at")
        ahead = _ago(tip_cfg)
        if ahead is not None and -ahead > FETCH_LEAD_S:
            return None                                # decided before a single request is made
        row, year = self._row(gid, config)
        if row is None:
            return None
        sid = segev_id(row)
        if not sid:
            # the Segev id arrives some days ahead: once more with a fresh list before giving up - at most once a
            # minute however many such games a pass asks about (the list is a quarter of a megabyte)
            if time.time() - self._fresh_at.get(year, 0.0) > 60:
                self._fresh_at[year] = time.time()
                fresh = [r for r in (self._games(year, fresh=True) or []) if str(r.get("game_id")) == gid]
                row = fresh[0] if fresh else row
                sid = segev_id(row)
            if not sid:
                return None
        acts = self._segev("getActions", sid)
        if not isinstance(acts, dict) or not ((acts.get("result") or {}).get("actions")):
            return None
        info = (acts.get("result") or {}).get("gameInfo") or {}
        if not _num(info.get("currentQuarter")) and not any(a.get("type") not in ("clock", "game", "quarter", "substitution")
                                                             for a in acts["result"]["actions"]):
            return None                                # not started
        box = self._segev("getBoxScore", sid)
        if not isinstance(box, dict) or not ((box.get("result") or {}).get("boxscore")):
            return None
        tip, _ = fixture_tip(row)
        finished, hold = decide(row, acts, box, _ago(tip_cfg or tip))
        if hold:
            print(f"     IBSL {gid} (Segev {sid}): {hold}")
            return None
        raw = raw_from_game(row, self._teams(year), acts, box, finished=finished)
        if raw is None:
            return None
        if raw["ibsl"]["unknown"]:
            print(f"     IBSL {gid}: {len(raw['ibsl']['unknown'])} action kind(s) the adapter does not know, "
                  f"left out: {raw['ibsl']['unknown'][:4]}")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = tip_cfg or tip
        return b

    # ------------------------------------------------------------------ plumbing
    def _segev(self, method: str, sid: str):
        got = self._get_json(SEGEV, fresh=True, method=method, game_id=sid)
        if isinstance(got, dict) and got.get("error"):
            return None
        return got

    def _pause(self):
        gap = time.time() - getattr(IbslAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        IbslAdapter._last_req = time.time()

    def _get_json(self, url: str, fresh: bool = False, **params):
        key = url + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        at, cached = self._replies.get(key, (0.0, None))
        if cached is not None and not fresh and time.time() - at < self.TTL_S:
            return cached
        for attempt in range(3):
            self._pause()
            try:
                r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json",
                                                              "Referer": SITE + "/"}, timeout=60)
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
