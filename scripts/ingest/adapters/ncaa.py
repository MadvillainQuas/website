"""NCAA Division II and III (men and women) - ncaa.com's public scoreboard and game centre.

A THIN ADAPTER, ON PURPOSE. The parsing is the scraper pipeline's (the private scraper-pipeline repo,
checked out next to this one as `scraper/` by ingest.yml and put on PYTHONPATH as SCRAPER_DIR):
validation/ncaa/ncaa_adapter.py reads ncaa.com's persisted GraphQL (sdataprod.ncaa.com) and turns a
game's text play-by-play, in both of its dialects, into a validated action stream plus the box. None of
that code is copied here (this repository is public, that one is not). This file does three small
things with what it returns:

  1. load it at run time from the scraper checkout (`_scraper()`), and say plainly when it is missing;
  2. put its output into the FIBA LiveStats shape every other league already uses (`to_fiba`, built on
     fibashape), so translate/fiba_events.py, stints.py, feedplatform and finalise-game read an NCAA
     game exactly as they read a SLB one - nothing below this file learns a new league;
  3. say what the game's periods are (`format`): NCAA MEN play TWO 20-MINUTE HALVES and 5-minute
     overtimes; NCAA WOMEN play four 10-minute quarters (and 5-minute overtimes), as FIBA does.

    GET sdataprod.ncaa.com ?meta=GetContests_web {sportCode MBB|WBB, division 2|3, seasonYear <start year>,
        contestDate MM/DD/YYYY}                     -> one day's scoreboard: every game, state, score, clock,
                                                       both teams' seoname and conferenceSeo
    GET ... NCAA_GetGamecenterPbpBasketballById_web {contestId}       -> play-by-play (text)
    GET ... NCAA_GetGamecenterBoxscoreBasketballById_web {contestId}  -> box score

Measured 2026-10-01: a scoreboard is ~1 KB a game (180 KB for 182 games) with Cache-Control max-age=5,
an ETag and Last-Modified; a game's two documents are ~175 KB together (46 captures). ncaa.com's robots.txt
disallows none of these paths. The women's scoreboard has the same shape (WBB, 14 Feb 2026: D2 137 games,
D3 182).

THE LIVE LANE ASKS THE SCOREBOARD FIRST (`changed`). One scoreboard read covers every game of a division
on a date; a game whose state, period and score have not moved since its last full read is handed back as
the bundle already held (same payload hash: the lane writes nothing), and is read again in full only when
they move or `max_age_s` has passed. That is what makes several hundred simultaneous games affordable:
see docs/ncaa-readiness.md for the arithmetic.

Women's games need the scraper's period clock to know about quarters; until scraper-pipeline carries the
patch in docs/ncaa/scraper-ncaa-women.patch, `_elapsed` is supplied for a WBB parse from here (the same
clamp at a period's 0:00), which is a call into the scraper's own parse, not a copy of it.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import inspect
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import DEFAULT_SCRAPER_DIR, FibaLiveStatsAdapter

GQL_HOST = "https://sdataprod.ncaa.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/126.0 Safari/537.36", "Referer": "https://www.ncaa.com/"}
LOGO = "https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/{seo}.svg"
try:
    from zoneinfo import ZoneInfo
    US_EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - no tz database: five hours behind UTC is the winter offset
    US_EASTERN = timezone(timedelta(hours=-5))

#: (regulation periods, period ms, overtime ms) - translate/fiba_events.py QUARTERS / HALVES
HALVES = (2, 1200000, 300000)
QUARTERS = (4, 600000, 300000)
SPORTS = {"MBB": HALVES, "WBB": QUARTERS}

#: the scoreboard's gameState: P pre-game, I in progress, F final (and the odd postponement)
STATE = {"F": "final", "I": "live", "P": "scheduled"}

#: a season runs from early November to the national championships in March; discovery reads the
#: whole window only when asked to (`full_season`), otherwise the days around today
SEASON_START = (11, 1)
SEASON_END = (3, 31)


#: conference names the scoreboard's slug cannot spell (the rest: an acronym of up to six letters is upper case,
#: anything else is its words capitalised - "great-lakes-valley" is "Great Lakes Valley", "nescac" "NESCAC")
CONFERENCES = {"ne-10": "Northeast-10", "empire-8": "Empire 8", "skyline": "Skyline", "liberty": "Liberty League",
               "landmark": "Landmark", "centennial": "Centennial", "american-southwest": "American Southwest",
               "peach-belt": "Peach Belt", "sunshine-state": "Sunshine State", "gulf-south": "Gulf South",
               "lone-star": "Lone Star", "mountain-east": "Mountain East", "rocky-mountain": "Rocky Mountain",
               "south-atlantic": "South Atlantic", "great-american": "Great American", "dii-independent": "Independent",
               "diii-independent": "Independent", "independent": "Independent"}


def conference_name(seo: Optional[str]) -> Optional[str]:
    """The scoreboard's conferenceSeo as a name a table can head ('nescac' -> 'NESCAC')."""
    s = str(seo or "").strip().lower()
    if not s:
        return None
    if s in CONFERENCES:
        return CONFERENCES[s]
    if "-" not in s and len(s) <= 6:
        return s.upper()
    return " ".join(w.upper() if (len(w) <= 3 and not w.isdigit() and w not in ("of", "and")) else w.capitalize()
                    for w in s.split("-"))


def fmt_dict(fmt: tuple) -> dict:
    return {"periods": fmt[0], "period_ms": fmt[1], "ot_ms": fmt[2]}


def sport_of(schedule_url: str, config: dict) -> str:
    """MBB or WBB: adapter_config.sport, else the schedule URL (/basketball-men/ or /basketball-women/)."""
    s = str(config.get("sport") or "").upper()
    if s in SPORTS:
        return s
    return "WBB" if "basketball-women" in (schedule_url or "") else "MBB"


def division_of(schedule_url: str, config: dict) -> int:
    d = str(config.get("division") or "")
    m = re.search(r"/d([123])\b", schedule_url or "")
    v = int(d) if d.isdigit() else (int(m.group(1)) if m else 3)
    if v not in (2, 3):
        raise ValueError(f"ncaa: division must be 2 or 3, not {v}")
    return v


def season_year(config: dict, today: Optional[date] = None) -> int:
    """The START year: '2026-27' -> 2026. None: the season being played (a date before August is the
    season that started the previous autumn)."""
    m = re.search(r"(\d{4})", str(config.get("season") or ""))
    if m:
        return int(m.group(1))
    t = today or datetime.now(timezone.utc).date()
    return t.year if t.month >= 8 else t.year - 1


def period_clock(elapsed_s: float, fmt: tuple) -> tuple[int, str, int]:
    """Seconds since tip -> (FIBA period number, periodType, ms remaining). Overtimes are numbered from 1
    under periodType OVERTIME, as data.json numbers them (translate's period_of puts them after regulation)."""
    n, per, ot = fmt[0], fmt[1] / 1000.0, fmt[2] / 1000.0
    el = max(0.0, float(elapsed_s or 0))
    if el < n * per:
        p = int(el // per) + 1
        left = p * per - el
        return p, "REGULAR", int(round(left * 1000))
    k = int((el - n * per) // ot) + 1
    left = n * per + k * ot - el
    return k, "OVERTIME", int(round(left * 1000))


def gt(ms: int) -> str:
    """ms remaining -> data.json's 'MM:SS' (tenths kept under a minute, as LiveStats writes them)."""
    ms = max(0, int(ms))
    m, s = divmod(ms / 1000.0, 60)
    return f"{int(m):02d}:{s:04.1f}" if (ms % 1000) and ms < 60000 else f"{int(m):02d}:{int(round(s)) % 60:02d}"


_ACTION = re.compile(
    r"^(?P<kind>2pt layup|2pt jump shot|3pt jump shot|Free Throw (?P<n1>\d+) of (?P<n2>\d+)|Defensive Rebound|"
    r"Offensive Rebound|Assist|Steal|Block|Turnover|Personal Foul|Substitution In|Substitution Out)"
    r"(?: (?P<res>made|missed))? by #(?P<pno>\d+)\b")


def action_of(text: str) -> Optional[dict]:
    """One of the scraper's canonical action strings ('2pt layup made by #7 Kye Robinson') as a data.json
    action (actionType / subType / success / pno), or None for anything else."""
    m = _ACTION.match(text or "")
    if not m:
        return None
    k, made, pno = m.group("kind"), m.group("res") == "made", m.group("pno")
    a: dict = {"pno": int(pno)}
    if k.startswith(("2pt", "3pt")):
        a.update(actionType=k[:3], subType="layup" if "layup" in k else "jumpshot", success=1 if made else 0)
    elif k.startswith("Free Throw"):
        a.update(actionType="freethrow", subType=f"{m.group('n1')}of{m.group('n2')}", success=1 if made else 0)
    elif k.endswith("Rebound"):
        a.update(actionType="rebound", subType="defensive" if k.startswith("Defensive") else "offensive")
    elif k.startswith("Substitution"):
        a.update(actionType="substitution", subType="in" if k.endswith("In") else "out")
    else:
        a.update(actionType={"Assist": "assist", "Steal": "steal", "Block": "block", "Turnover": "turnover",
                             "Personal Foul": "foul"}[k], subType="personal" if k == "Personal Foul" else "")
    return a


def paired_subs(actions, starters: dict) -> list:
    """The scraper's actions as (text, team, seconds, data.json action), every substitution an OUT and an
    IN at one moment, and nobody sent off who is not on, or on who already is.

    ncaa.com's play-by-play logs a change as two rows that often do not meet: the IN at one clock and its
    OUT seconds (or minutes) later, a third player's change between them, an OUT nobody came on for. The
    scraper's own engine holds an unmatched half until its partner arrives; the platform's translator
    pairs halves only at the same side, period and clock, and drops what it cannot pair at the end of the
    log - which on 23 of 46 captured games left a side with four or six on the floor for minutes, and
    every minute and plus-minus of those players with it. So the halves are paired here, the way the
    scraper's engine does: in game order per side, an unmatched IN waits for the next OUT that has no IN
    (and an OUT for the next IN), and the pair is played at the later of the two moments - the earliest
    time the floor can honestly have changed. Players on the floor are tracked from the starters, so an
    OUT for someone already off, or an IN for someone already on, is dropped rather than applied."""
    out = []
    subs = {0: [], 1: []}
    for text, tidx, el in actions:
        a = action_of(text)
        if a is None:
            continue
        if a["actionType"] == "substitution":
            subs[int(tidx)].append((float(el), a))
        else:
            out.append((text, int(tidx), float(el), a))
    for side in (0, 1):
        on = {str(n) for n in (starters.get(side) or starters.get(str(side)) or [])}
        held_in: list = []                    # INs waiting for an OUT
        held_out: list = []                   # OUTs waiting for an IN
        i, rows = 0, subs[side]
        while i < len(rows):
            el = rows[i][0]
            group = []
            while i < len(rows) and rows[i][0] == el:
                group.append(rows[i][1]); i += 1
            ins = [str(a["pno"]) for a in group if a["subType"] == "in"]
            outs = [str(a["pno"]) for a in group if a["subType"] == "out"]
            # a player who goes off and comes back on at one instant has not changed anything
            both = set(ins) & set(outs)
            ins = [p for p in ins if p not in both]
            outs = [p for p in outs if p not in both]
            pend_in = held_in + [p for p in ins if p not in held_in]
            pend_out = held_out + [p for p in outs if p not in held_out]
            pend_in = [p for p in pend_in if p not in on]
            pend_out = [p for p in pend_out if p in on]
            while pend_in and pend_out:
                pi, po = pend_in.pop(0), pend_out.pop(0)
                on.discard(po); on.add(pi)
                for k, pno in (("out", po), ("in", pi)):
                    out.append((f"Substitution {k}", side, el, {"actionType": "substitution", "subType": k, "pno": int(pno)}))
            # a side short of five takes a waiting IN without an OUT; one with six never takes another
            while pend_in and len(on) < 5:
                pi = pend_in.pop(0)
                on.add(pi)
                out.append(("Substitution in", side, el, {"actionType": "substitution", "subType": "in", "pno": int(pi)}))
            held_in, held_out = pend_in, pend_out
    # game order; at one moment the play first and the change after it (the scraper's own tiebreak),
    # an OUT before its IN
    rank = {"out": 1, "in": 2}
    out.sort(key=lambda r: (r[2], rank.get(r[3].get("subType"), 0) if r[3]["actionType"] == "substitution" else 0))
    return out


def _player(row: dict) -> dict:
    """One box line of the scraper's site_box as pl[pno]."""
    first, _, last = str(row.get("name") or "").partition(" ")
    secs = int(row.get("secs") or 0)
    fgm, fga = int(row.get("fg2m", 0)) + int(row.get("fg3m", 0)), int(row.get("fg2a", 0)) + int(row.get("fg3a", 0))
    return S.player(first, last, shirt="", starter=1 if row.get("starter") else 0, active=1,
                    minutes=f"{secs // 60}:{secs % 60:02d}", stats={
                        "sPoints": row.get("pts", 0), "sFieldGoalsMade": fgm, "sFieldGoalsAttempted": fga,
                        "sTwoPointersMade": row.get("fg2m", 0), "sTwoPointersAttempted": row.get("fg2a", 0),
                        "sThreePointersMade": row.get("fg3m", 0), "sThreePointersAttempted": row.get("fg3a", 0),
                        "sFreeThrowsMade": row.get("ftm", 0), "sFreeThrowsAttempted": row.get("fta", 0),
                        "sReboundsOffensive": row.get("oreb", 0), "sReboundsDefensive": row.get("dreb", 0),
                        "sReboundsTotal": row.get("reb", 0), "sAssists": row.get("ast", 0),
                        "sTurnovers": row.get("tov", 0), "sSteals": row.get("stl", 0), "sBlocks": row.get("blk", 0),
                        "sFoulsPersonal": row.get("pf", 0)})


def to_fiba(data: dict, parsed: dict, fmt: tuple, final: Optional[bool] = None) -> dict:
    """The scraper's parse of one game as a data.json-shaped payload, with its `format` stated.

    data:   {'pbp', 'box'} as ncaa.com returned them (team ids, names, seonames, status);
    parsed: validation/ncaa/ncaa_adapter.parse_ncaa_game(data): teams, site_box (by jersey), starters,
            actions [(text, team index, seconds since tip)], home = 0.
    A synthetic player the scraper had to invent (in the play-by-play, missing from the box) keeps his
    place, so lineups stay five a side."""
    pbp_d = ((data.get("pbp") or {}).get("data") or {}).get("playbyplay") or {}
    box_d = ((data.get("box") or {}).get("data") or {}).get("boxscore") or {}
    meta = {0: {}, 1: {}}
    for t in pbp_d.get("teams") or box_d.get("teams") or []:
        meta[0 if t.get("isHome") else 1] = t
    totals = {}
    by_id = {str(t.get("teamId")): (0 if t.get("isHome") else 1) for t in pbp_d.get("teams") or box_d.get("teams") or []}
    for tb in box_d.get("teamBoxscore") or []:
        i = by_id.get(str(tb.get("teamId")))
        if i is not None:
            totals[i] = tb.get("teamStats") or {}

    pbp, an = [], 0
    per_pts = {0: {}, 1: {}}
    last_period = (1, "REGULAR")

    def add(a: dict) -> None:
        nonlocal an
        an += 1
        a["actionNumber"] = an
        pbp.append(a)

    # A PLAYER'S pno IS A SLOT, NOT HIS SHIRT. data.json numbers its players 1..n and keeps the shirt in
    # shirtNumber; the translator reads pno 0 as "no player" (a team action). NCAA rosters wear #0 and #00,
    # so every shirt is given a slot here, in box order, and the shirt rides along as shirtNumber.
    slots = {i: {str(num): k for k, num in enumerate(((parsed.get("site_box") or {}).get(i) or {}).keys(), start=1)}
             for i in (0, 1)}
    add({"actionType": "period", "subType": "start", "period": 1, "periodType": "REGULAR",
         "gt": gt(fmt[1]), "tno": 0})
    for text, tidx, el, a in paired_subs(parsed.get("actions") or [], parsed.get("starters") or {}):
        slot = slots[int(tidx)].get(str(a.get("pno")))
        if slot is None:
            continue                                   # a shirt the box does not know: no player to credit
        a["pno"] = slot
        p, ptype, left = period_clock(el, fmt)
        if (p, ptype) != last_period:
            add({"actionType": "period", "subType": "start", "period": p, "periodType": ptype,
                 "gt": gt(fmt[1] if ptype == "REGULAR" else fmt[2]), "tno": 0})
            last_period = (p, ptype)
        a.update(period=p, periodType=ptype, gt=gt(left), clock=gt(left), tno=int(tidx) + 1)
        add(a)
        if a["actionType"] in ("2pt", "3pt", "freethrow") and a.get("success"):
            key = p if ptype == "REGULAR" else fmt[0] + p
            v = 1 if a["actionType"] == "freethrow" else int(a["actionType"][0])
            per_pts[int(tidx)][key] = per_pts[int(tidx)].get(key, 0) + v

    status = str(pbp_d.get("status") or box_d.get("status") or "").lower()
    over = final if final is not None else status in ("final", "f")
    if over:
        add({"actionType": "game", "subType": "end", "period": last_period[0], "periodType": last_period[1],
             "gt": "00:00", "tno": 0})

    teams = {}
    for i in (0, 1):
        box = (parsed.get("site_box") or {}).get(i) or {}
        players = {}
        for num, row in box.items():
            pl = _player(row)
            # a pseudo-shirt the scraper made for a duplicate (#21 twice -> 921) is not a shirt anybody wore
            pl["shirtNumber"] = str(num) if not (len(str(num)) > 2 and str(num).startswith("9")) else ""
            players[str(slots[i][str(num)])] = pl
        m, tot = meta[i], totals.get(i) or {}
        tt = None
        if tot:
            oreb, treb = S.num(tot.get("offensiveRebounds")), S.num(tot.get("totalRebounds"))
            fgm, fga = S.num(tot.get("fieldGoalsMade")), S.num(tot.get("fieldGoalsAttempted"))
            f3m, f3a = S.num(tot.get("threePointsMade")), S.num(tot.get("threePointsAttempted"))
            tt = dict(S.totals_of(players), sPoints=S.num(tot.get("points")), sFieldGoalsMade=fgm,
                      sFieldGoalsAttempted=fga, sThreePointersMade=f3m, sThreePointersAttempted=f3a,
                      sTwoPointersMade=fgm - f3m, sTwoPointersAttempted=fga - f3a,
                      sFreeThrowsMade=S.num(tot.get("freeThrowsMade")), sFreeThrowsAttempted=S.num(tot.get("freeThrowsAttempted")),
                      sReboundsOffensive=oreb, sReboundsDefensive=treb - oreb, sReboundsTotal=treb,
                      sAssists=S.num(tot.get("assists")), sTurnovers=S.num(tot.get("turnovers")),
                      sSteals=S.num(tot.get("steals")), sBlocks=S.num(tot.get("blockedShots")),
                      sFoulsPersonal=S.num(tot.get("personalFouls")))
        name = (m.get("nameShort") or m.get("nameFull") or ((parsed.get("teams") or [{}, {}])[i] or {}).get("name") or "").strip()
        score = (tt or {}).get("sPoints") or ((parsed.get("teams") or [{}, {}])[i] or {}).get("total_points") or 0
        quarters = [per_pts[i].get(q, 0) for q in range(1, fmt[0] + 1)]
        t = S.team(name, (m.get("name6Char") or "").strip(), score=score, quarters=quarters, players=players,
                   totals=tt, logo=LOGO.format(seo=m["seoname"]) if m.get("seoname") else None,
                   short_name=(m.get("name6Char") or "").strip())
        t["full_name"] = (m.get("nameFull") or "").strip()
        teams[str(i + 1)] = t

    last = next((a for a in reversed(pbp) if a.get("actionType") not in ("game",)), None) or {}
    return {"tm": teams, "pbp": pbp, "format": fmt_dict(fmt),
            "period": last.get("period", 1), "periodType": last.get("periodType", "REGULAR"),
            "clock": "00:00" if over else (last.get("gt") or gt(fmt[1])),
            "ncaa": {"contestId": pbp_d.get("contestId") or box_d.get("contestId"), "status": status,
                     "unmapped": len(parsed.get("unmapped") or {}), "partial_box": parsed.get("partial_box") or [],
                     "degraded_feed": parsed.get("degraded_feed") or []}}


def log_disagrees(raw: dict) -> Optional[str]:
    """Why this payload's play-by-play cannot be replayed into its own final score, or None when it can:
    the made shots and free throws of each side must add up to that side's official points."""
    pts = {1: 0, 2: 0}
    for a in raw.get("pbp") or []:
        if a.get("success") and a.get("actionType") in ("2pt", "3pt", "freethrow") and a.get("tno") in (1, 2):
            pts[a["tno"]] += 1 if a["actionType"] == "freethrow" else int(a["actionType"][0])
    tm = raw.get("tm") or {}
    want = {k: int(S.num((tm.get(str(k)) or {}).get("score"))) for k in (1, 2)}
    if pts == want:
        return None
    return f"the play-by-play adds up to {pts[1]}-{pts[2]}, the official score is {want[1]}-{want[2]}"


def _quarters_elapsed(period_number, clock, *_):
    """The scraper's _elapsed for a game in four 10-minute quarters (NCAA women): the same clamp of a 0:00
    event half a second inside its period, so a buzzer substitution never opens a zero-second stint."""
    try:
        mm, ss = str(clock or "0:00").split(":")[:2]
        remaining = int(mm) * 60 + int(ss)
    except (ValueError, TypeError):
        remaining = 0
    p = int(period_number or 1)
    start, plen = ((p - 1) * 600, 600) if p <= 4 else (2400 + (p - 5) * 300, 300)
    return start + max(0, min(plen - remaining, plen - 0.5))


class NcaaAdapter(FibaLiveStatsAdapter):
    name = "ncaa"
    min_request_gap_s = 0.3
    #: a live game whose scoreboard line has not moved is read again in full at least this often
    max_age_s = 90
    #: a scoreboard is read at most this often (it is cached for 5 s at ncaa.com's edge)
    board_every_s = 20
    _mod = None
    _mod_error = None

    def __init__(self):
        self._last = 0.0
        self._boards: dict = {}        # (sport, division, MM/DD/YYYY) -> (read_at, {contestId: line})
        self._held: dict = {}          # contestId -> (line it was read at, read_at, GameBundle)
        self._line_of: dict = {}       # contestId -> (sport, division, date) it was discovered under

    # ------------------------------------------------------------------ the scraper's code
    @classmethod
    def _scraper(cls, config: Optional[dict] = None):
        """validation/ncaa/ncaa_adapter.py from the scraper checkout, or None (with the reason kept)."""
        if cls._mod is not None:
            return cls._mod or None
        roots = [(config or {}).get("scraper_dir"), os.environ.get("SCRAPER_DIR"), DEFAULT_SCRAPER_DIR]
        roots += [p for p in sys.path if p and os.path.isdir(os.path.join(p, "validation", "ncaa"))]
        for r in roots:
            path = os.path.join(r, "validation", "ncaa", "ncaa_adapter.py") if r else ""
            if path and os.path.isfile(path):
                try:
                    spec = importlib.util.spec_from_file_location("scraper_ncaa_adapter", path)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    cls._mod = mod
                    return mod
                except Exception as exc:          # pragma: no cover
                    cls._mod_error = repr(exc)
        cls._mod = False
        cls._mod_error = cls._mod_error or "validation/ncaa/ncaa_adapter.py not found under SCRAPER_DIR / PYTHONPATH"
        return None

    # ------------------------------------------------------------------ requests
    def _gql(self, meta: str, variables: dict) -> dict:
        """One persisted query, polite: the adapter's own gap between requests to one host. The hashes
        are the scraper's (ncaa.com ships them in its page settings and changes them with a release)."""
        mod = self._scraper()
        if not mod:
            raise RuntimeError(f"ncaa: the scraper's NCAA adapter is not importable ({self._mod_error})")
        gap = time.time() - self._last
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last = time.time()
        ext = json.dumps({"persistedQuery": {"version": 1, "sha256Hash": mod.SHAS[meta]}})
        url = (f"{GQL_HOST}?meta={meta}&extensions={urllib.parse.quote(ext)}"
               f"&variables={urllib.parse.quote(json.dumps(variables))}")
        r = requests.get(url, headers=HEADERS, timeout=(5, 30))
        r.raise_for_status()
        return r.json()

    def board(self, sport: str, division: int, day: date, max_age: Optional[float] = None) -> dict:
        """{contestId: scoreboard line} for one division and date, read at most every board_every_s."""
        key = (sport, division, day.strftime("%m/%d/%Y"))
        held = self._boards.get(key)
        if held and time.time() - held[0] < (self.board_every_s if max_age is None else max_age):
            return held[1]
        d = self._gql("GetContests_web", {"sportCode": sport, "division": int(division),
                                          "seasonYear": season_year({}, day), "contestDate": key[2], "week": None})
        lines = {str(c.get("contestId")): c for c in ((d.get("data") or {}).get("contests") or []) if c.get("contestId")}
        self._boards[key] = (time.time(), lines)
        for cid in lines:
            self._line_of[cid] = key
        return lines

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        sport, division = sport_of(schedule_url, config), division_of(schedule_url, config)
        start_year = season_year(config)
        today = datetime.now(timezone.utc).date()
        lo, hi = date(start_year, *SEASON_START), date(start_year + 1, *SEASON_END)
        if config.get("dates"):
            days = [datetime.strptime(d, "%Y-%m-%d").date() for d in str(config["dates"]).split(",") if d.strip()]
        else:
            # the days around today, for the season being played; a past season (a backfill) whole
            if not config.get("full_season") and start_year == season_year({}, today):
                lo = max(lo, today - timedelta(days=int(config.get("days_back", 3))))
                hi = min(hi, today + timedelta(days=int(config.get("days_ahead", 14))))
            days = [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]
        out = []
        for day in days:
            try:
                lines = self.board(sport, division, day, max_age=3600)
            except Exception as exc:
                print(f"     NCAA {sport} D{division} {day}: scoreboard unreadable ({exc})")
                continue
            for cid, c in lines.items():
                g = self._game(c)
                if g:
                    out.append(g)
        print(f"     NCAA {sport} D{division} {start_year}-{str(start_year + 1)[2:]}: {len(out)} games over {len(days)} day(s) "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    @staticmethod
    def _game(c: dict) -> Optional[ScheduleGame]:
        teams = c.get("teams") or []
        home = next((t for t in teams if t.get("isHome")), None)
        away = next((t for t in teams if t is not home), None)
        if not (home and away):
            return None
        tip = None
        if c.get("startTimeEpoch"):
            tip = datetime.fromtimestamp(int(c["startTimeEpoch"]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        extra = {"home_code": home.get("name6Char") or "", "away_code": away.get("name6Char") or "",
                 "home_logo": LOGO.format(seo=home["seoname"]) if home.get("seoname") else None,
                 "away_logo": LOGO.format(seo=away["seoname"]) if away.get("seoname") else None,
                 # the conference each school plays in, as the scoreboard names it (groups_from_feed)
                 "home_group": conference_name(home.get("conferenceSeo")), "away_group": conference_name(away.get("conferenceSeo")),
                 "stage": "playoffs" if c.get("isChampionship") or c.get("championshipId") else "regular"}
        if not c.get("hasStartTime", True) or c.get("tba"):
            extra["time_tbc"] = True
        return ScheduleGame(external_id=str(c["contestId"]), home_name=(home.get("nameShort") or "").strip(),
                            away_name=(away.get("nameShort") or "").strip(), tipoff_at=tip,
                            status=STATE.get(str(c.get("gameState") or "").upper(), "scheduled"), extra=extra)

    # ------------------------------------------------------------------ one game
    @staticmethod
    def _line_key(c: Optional[dict]) -> Optional[tuple]:
        """What a scoreboard line says that a full read would change: state, period and both scores."""
        if not c:
            return None
        return (c.get("gameState"), c.get("currentPeriod"),
                tuple(sorted((bool(t.get("isHome")), t.get("score")) for t in c.get("teams") or [])))

    def changed(self, contest_id: str, sport: str, division: int, day: date) -> bool:
        """Has this game moved on the scoreboard since it was last read in full (or gone stale)?"""
        held = self._held.get(str(contest_id))
        if not held:
            return True
        line = self.board(sport, division, day).get(str(contest_id))
        if line is None or self._line_key(line) != held[0]:
            return True
        return time.time() - held[1] >= self.max_age_s

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        xid = str(external_id)
        if not (config.get("division") or config.get("schedule_url")):
            # the live lane hands an adapter its adapter_config, not the schedule URL: a source row that
            # does not say its division would read every game as division 3
            raise ValueError("ncaa: adapter_config must name the division (2 or 3) and the sport (MBB or WBB)")
        sport = sport_of(config.get("schedule_url") or "", config)
        division = division_of(config.get("schedule_url") or "", config)
        fmt = SPORTS[sport]
        tip = config.get("_tipoff_at")
        day = None
        try:
            # the scoreboard is dated by the US day the game is played on: a 7 pm Pacific tip-off is 03:00 UTC
            # the next morning, and is on the evening's board
            day = datetime.fromisoformat(str(tip).replace("Z", "+00:00")).astimezone(US_EASTERN).date() if tip else None
        except ValueError:
            day = None
        if day and not config.get("_fresh") and xid in self._held:
            # US evening games tip after midnight UTC: the scoreboard is dated by the local day, so ask
            # for the line under whichever date it was discovered under first
            key = self._line_of.get(xid)
            d0 = datetime.strptime(key[2], "%m/%d/%Y").date() if key else day
            try:
                if not self.changed(xid, sport, division, d0):
                    return self._held[xid][2]
            except Exception:
                pass                                   # a scoreboard blip: read the game itself
        mod = self._scraper(config)
        if not mod:
            raise RuntimeError(f"ncaa: the scraper's NCAA adapter is not importable ({self._mod_error})")
        data = {"pbp": self._gql("NCAA_GetGamecenterPbpBasketballById_web", {"contestId": xid}),
                "box": self._gql("NCAA_GetGamecenterBoxscoreBasketballById_web", {"contestId": xid})}
        pbp_d = ((data["pbp"].get("data") or {}).get("playbyplay") or {})
        box_d = ((data["box"].get("data") or {}).get("boxscore") or {})
        if not (pbp_d.get("periods") or []) and str(box_d.get("status") or "").upper() != "F":
            return None                                # not started: nothing published yet
        # (a FINAL with a box and no play-by-play - some schools publish only the box - goes on: it has no
        # plays to add up to its score, so bundle_from_raw publishes it as a result, not as a replay)
        parsed = self.parse(mod, data, sport)
        raw = to_fiba(data, parsed, fmt)
        b = self.bundle_from_raw(raw, xid, config)
        if tip:
            b.tipoff_at = tip
        line = None
        key = self._line_of.get(xid)
        if key:
            line = (self._boards.get(key) or (0, {}))[1].get(xid)
        self._held[xid] = (self._line_key(line), time.time(), b)
        if b.status == "final":
            self._held.pop(xid, None)                  # nothing more will change; let it go
        return b

    @classmethod
    def parse(cls, mod, data: dict, sport: str) -> dict:
        """The scraper's parse, told the sport: directly once scraper-pipeline takes `sport` (the patch in
        docs/ncaa/scraper-ncaa-women.patch), else with the quarters clock lent for a women's game."""
        try:
            takes_sport = "sport" in inspect.signature(mod.parse_ncaa_game).parameters
        except (TypeError, ValueError):
            takes_sport = False
        if takes_sport:
            return mod.parse_ncaa_game(data, sport=sport)
        with cls._format(mod, SPORTS[sport]):
            return mod.parse_ncaa_game(data)

    @staticmethod
    @contextlib.contextmanager
    def _format(mod, fmt: tuple):
        """The scraper's parse measures its clock in halves; a women's game (quarters) is parsed with the
        quarters clock above for the length of the call, then the scraper's own is put back."""
        if fmt == HALVES or not hasattr(mod, "_elapsed"):
            yield
            return
        own = mod._elapsed
        mod._elapsed = _quarters_elapsed
        try:
            yield
        finally:
            mod._elapsed = own

    def bundle_from_raw(self, raw: dict, external_id: str, config: dict | None = None) -> GameBundle:
        b = super().bundle_from_raw(raw, external_id, config)
        why = log_disagrees(raw)
        if b.status == "final" and why:
            # A FINISHED GAME WHOSE PLAYS DO NOT ADD UP TO ITS SCORE IS PUBLISHED AS A RESULT, NOT REPLAYED.
            # finalise-game writes the score the log replays to, so a log short of a team's baskets would
            # publish the wrong score and, at worst, the wrong winner. The box and the result stand.
            b.translate = False
            print(f"     NCAA {external_id}: published as a result only - {why}")
        # the payload hash must not move with nothing but our own bookkeeping
        b.payload_hash = hashlib.sha1(json.dumps({k: v for k, v in raw.items() if k != "ncaa"},
                                                 sort_keys=True).encode()).hexdigest()
        return b
