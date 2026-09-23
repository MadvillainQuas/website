# -*- coding: utf-8 -*-
"""Australia's NBL, WNBL and NBL1, from the NBL's own data service.

WHERE THE DATA IS. nbl.com.au, the WNBL's site and nbl1.com.au draw their fixtures, box scores and
play-by-play from one JSON service the NBL runs in front of the leagues' stats platform. It answers
a plain request that carries the NBL site's Origin and Referer - no key, no cookie:

    GET https://prod.rosetta.nbl.com.au/get/{nbl|wnbl|nbl1}/seasons
        every season of one organisation: id, year, type (regular / preseason / in_season / test)
        and, for NBL1, the conference and the division (South Men, Central Women ...) it is
    GET .../get/matches/in/season/{seasonId}?limit=2000
        every game of one season: id, start_time (UTC), round, match_type, status, the two clubs
        (name, code, crest, the stats platform's club id) and the result
    GET .../get/match/{matchId}/live/all
        one game: the league's box score (player_match_statistics; team_match_statistics per
        period, "0" = the game, "11" = the first overtime) and the play-by-play, every action with
        its period, clock, both scores, club, player, success and court coordinates.
The WNBL and NBL1 game centres are the stats platform's own widgets over the same data, so one
adapter reads all three organisations; adapter_config["org"] says which.

WHAT IS DISCOVERED, per config row (`stage`):
    NBL, WNBL   the season's main competition (NBL27, WNBL27 - never the pre-season, the Blitz,
                exhibitions or a cup final): "regular" = the numbered rounds, "finals" = the
                play-in and play-off series. The WNBL files its finals with no match_type at all,
                so a game's stage is read from match_type first and its round name second.
    NBL1        one season per conference and gender ("2026 South Men"); a config row is ONE
                gender over all five conferences: "regular", "finals" (each conference's own
                finals) or "national" (the National Finals, a season of its own).
Seasons: NBL and WNBL run across the new year and are named the site's way, 2026-27 = NBL27 (the
season whose year is 2026). NBL1 is played inside a calendar year (March to August), so its
seasons are calendar years: "2026". adapter_config["season"] pins one (run_ingest sets it to the
current year, with "season_auto", for a source with "season_calendar"); a season the service does
not have is said so, never read as an empty one. adapter_config["first_season"] keeps a row quiet
until that season comes round, so NBL1 is configured months before it tips off without reading
last year's games - a season written into the row itself is read whatever first_season says.

THE KEY is the service's match id, the same from fixture to final (and the stats platform's own
fixture id). A club's code is the stats platform's club id - never the three-letter code, which
NBL1 repeats (MAN is Manly Warringah and Mandurah) - and its three letters become the short name.

NBL1'S CONFERENCES. Every NBL1 fixture carries its conference ("NBL1 South"), which is the group
its clubs are ranked in: ScheduleGame.extra["home_group"] / ["away_group"], read by groups.learn
for a source with "groups_from_feed". Nobody keeps a file of a hundred and forty clubs by hand.

THE GAME PAYLOAD is translated into FIBA LiveStats data.json shape and handed to
FibaLiveStatsAdapter.bundle_from_raw, like every other translated league. Its repairs, from an
inventory of 20 games (NBL, WNBL, NBL1 men and women, regular season, finals, three overtimes;
18,513 actions) - scripts/ingest/nbl_test.py holds five of them:
  * ORDER IS REBUILT, NEVER TRUSTED. Some games list their actions oldest first, some newest first
    (the way the game centre shows them), and in the second kind action_id restarts inside a
    period (243 is a rebound in Q4 and a clock stop in Q2). Actions are sorted by (period, time run
    off, the time they were typed) and numbered 1..n. Within one second the typing order is the
    operator's, not the play's: a block is typed before the shot it stopped (107 of 133), so the
    shot is moved back in front of its block, and a drawn foul before the foul it mirrors, so it is
    moved in behind it (FIBA's foulon points back at its foul, and translate() folds it into a foul
    already written).
  * A TEAM ACTION CAN ARRIVE WITHOUT ITS TEAM (team rebounds, shot-clock and 8-second violations,
    in 9 of the 20 games). A team rebound belongs to the side that missed (offensive) or the other
    side (defensive); a team turnover to the side in possession, followed from the actions that do
    name a club. All 87 inferred in the sample land where the league's own team totals put them.
  * THE TWO SCORE COLUMNS follow the stats platform's order of the clubs, which is not always home
    first (7 of 20 games): read from the scoring plays and turned home first.
  * TYPED TWICE: a substitution (Adelaide v Sydney, 1 Apr 2026: three of Sydney's four changes at
    7:10 of Q4) or a drawn foul (twice with one timestamp). A change that changes nothing and
    repeats one already made at that moment, or unbalances it, is dropped; a drawn foul with no
    foul left to mirror is the second copy of one that has one, and is dropped.
  * A DNP CAN CARRY THE STARTER FLAG (Cairns v Brisbane, 26 Sep 2025: six "starters" a side): only
    a player who took part starts; a side still without five is read from its first quarter.
  * THE LEAGUE'S PLAYER BOX CAN STOP UPDATING. WNBL26's decider (Perth Lynx 105-108 Townsville
    Fire, overtime) has a player box frozen with 3:19 left - Miela Sowah on 16 points where the
    play-by-play and the final score give her 18. So every counting stat is read from the
    play-by-play, which is what the site's own event log is built from as well; the league's box
    gives the roster, shirt numbers, positions and starters, and - while it is current, its points
    adding up to the score and its minutes to the game - the minutes and the plus-minus, which its
    finer clock gets closer than whole-second substitutions can. A frozen box gives neither.
    On 17 of the 20 games the play-by-play box IS the league's, to the last point, rebound, foul,
    minute and plus-minus; on two more the league's box puts one foul (or one rebound) on a
    team-mate of the player its own play-by-play names, the team totals agreeing.
  * FOULS: the league's "fouls" column (FLS) is every foul a player committed - personal,
    offensive, technical ("Category One Technical"), unsportsmanlike ("Flagrant"), and the NBL's
    "Disruptive" take foul - which is FIBA's PF; its "personal_fouls" leaves the offensive and
    technical ones out. sFoulsPersonal is the first. A coach's or bench technical is the club's:
    tot_sFoulsTeam, and in the club's total, as the league's own total has it from NBL27.
Every action string is mapped explicitly; one the tables do not know is not guessed - it is kept on
raw["nbl"]["unknown"] and printed.

SHOT CHART. x/y copied as they are: the service's frame IS FIBA's - full court 0-100 along x, 0-100
across (1,039 lay-ups, dunks and tip-ins from 20 games sit at x 8.5 / 91.5, y 50).

WHAT THE FEED DOES NOT HAVE: second-chance / fast-break / paint / off-turnover points (the site's
engine derives its own from the event log), fouls drawn and blocks received in the box (counted
from the play-by-play), and coaches.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA

API = "https://prod.rosetta.nbl.com.au"
HEADERS = {"Accept": "application/json", "Origin": "https://www.nbl.com.au", "Referer": "https://www.nbl.com.au/"}
ORGS = ("nbl", "wnbl", "nbl1")
#: an unfinished game that tipped this recently may be in progress
LIVE_GUARD_S = 3 * 3600
#: before this lead, the game endpoint has nothing to say about a game
FETCH_LEAD_S = 30 * 60

# The organisation's main competition, by season name: NBL27 / "NBL" (older years); WNBL27 /
# "WNBL 2024/25". Everything else the organisation runs (pre-season, the Blitz, the NBL x NBA
# games, the Ignite Cup final, test seasons) is a different season and never read.
MAIN_SEASON = {
    "nbl": re.compile(r"^NBL\s*\d{0,2}$", re.I),
    "wnbl": re.compile(r"^WNBL\s*(\d{2}|\d{4}(\s*/\s*\d{2,4})?)?$", re.I),
}
STATUS_FINAL = {"complete", "completed", "final", "finished", "ended", "confirmed"}
STATUS_LIVE = {"live", "in_progress", "inprogress", "active", "started"}
STATUS_DROPPED = {"cancelled", "canceled", "abandoned", "forfeit", "forfeited", "void"}
# Finals rounds as the organisations name them: NBL (SEEDING, QUALIFIER, ELIMINATION, PLAYOFF 1,
# CHAMPIONSHIP), WNBL (SEMI FINAL SERIES 1, CHAMPIONSHIP), NBL1 (EF, QF, SF, PF, GF, 5v6).
FINALS_ROUND = re.compile(r"final|semi|champion|play-?off|play-?in|qualif|elimin|seeding|"
                          r"^(ef|qf|sf|pf|gf|prelim\w*|\d+\s*v\s*\d+)$", re.I)


# ============================================================================ the vocabulary
# the service's action types that record nothing: clock starts / stops and possession changes
SKIP = {"main", "possession", "possessionarrow"}
# shot sub-types -> FIBA's; every other one is its own name folded ("Driving Layup" -> drivinglayup)
SHOT_SUBTYPES = {"layup", "drivinglayup", "reverselayup", "eurostep", "dunk", "alleyoopdunk", "alleyoop",
                 "tipin", "tipinlayup", "tipindunk", "putback", "jumpshot", "pullupjumpshot",
                 "stepbackjumpshot", "turnaroundjumpshot", "fadeawayjumpshot", "floatingjumpshot",
                 "hookshot", "hookjumpshot", ""}
SHOT_RENAME = {"fadeaway": "fadeawayjumpshot", "turnaround": "turnaroundjumpshot", "floater": "floatingjumpshot",
               "hook": "hookshot", "tipinshot": "tipin", "putbacklayup": "putback"}
TURNOVER_SUBTYPES = {"badpass", "ballhandling", "travel", "outofbounds", "offensive", "shotclock", "3sec",
                     "5sec", "8sec", "doubledribble", "other", "backcourt", "lostball", "24sec", "palming",
                     "carrying", "kickedball", "offensivegoaltending", "goaltending"}
TURNOVER_RENAME = {"traveling": "travel", "travelling": "travel", "24second": "shotclock", "24sec": "shotclock",
                   "shotclockviolation": "shotclock", "3second": "3sec", "5second": "5sec", "8second": "8sec",
                   "3secondviolation": "3sec", "5secondviolation": "5sec", "8secondviolation": "8sec",
                   "ballhandlingviolation": "ballhandling", "offensiveviolation": "offensive",
                   "otherturnover": "other", "backcourtviolation": "backcourt"}
# fouls: the player's own, and those a team or its bench is charged with (no player)
FOUL_SUBTYPES = {"personal": "personal", "offensive": "offensive", "technical": "technical",
                 "unsportsmanlike": "unsportsmanlike", "disqualifying": "disqualifying",
                 "disruptive": "personal",                       # the NBL's take foul: a personal foul
                 # the NBL's own names for the heavier ones (NBL27, from the first week): a technical
                 # of either category is a technical; a flagrant foul is FIBA's unsportsmanlike, and
                 # a flagrant two - an ejection - its disqualifying
                 "categoryonetechnical": "technical", "categorytwotechnical": "technical",
                 "category1technical": "technical", "category2technical": "technical",
                 "doubletechnical": "technical", "flagrant": "unsportsmanlike", "flagrantone": "unsportsmanlike",
                 "flagrant1": "unsportsmanlike", "flagranttwo": "disqualifying", "flagrant2": "disqualifying",
                 "fighting": "disqualifying",
                 "coachtechnical": "coachtechnical", "benchtechnical": "benchtechnical",
                 "coachdisqualifying": "coachdisqualifying", "benchdisqualifying": "coachdisqualifying",
                 "coachunsportsmanlike": "coachdisqualifying", "admintechnical": "benchtechnical"}
TEAM_FOULS = {"coachtechnical", "benchtechnical", "coachdisqualifying"}


def fold(s) -> str:
    """'Pull Up Jump Shot' -> 'pullupjumpshot', '2Of3' -> '2of3'."""
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def classify(e: dict) -> Tuple[Optional[str], str, Optional[int], List[str], Optional[str]]:
    """(FIBA actionType, subType, success, qualifier, unknown) for one of the service's actions.
    actionType None = an action that records nothing (skipped on purpose, or not known)."""
    at = fold(e.get("action_type"))
    sub = fold(e.get("sub_type"))
    succ = e.get("success")
    player = bool(e.get("player"))
    if at in SKIP:
        return None, "", None, [], None
    if at == "fixture":
        return ("game", "end", None, [], None) if sub == "end" else (None, "", None, [], None)
    if at == "period":
        if sub in ("start", "end"):
            return "period", sub, None, [], None
        return None, "", None, [], None                     # pending / confirmed
    if at in ("2pt", "3pt"):
        st = SHOT_RENAME.get(sub, sub)
        return at, st, 1 if succ else 0, [], (None if st in SHOT_SUBTYPES else f"shot:{e.get('sub_type')}")
    if at == "freethrow":
        m = re.fullmatch(r"(\d)of(\d)", sub)
        return ("freethrow", sub, 1 if succ else 0, [], None) if m else \
            ("freethrow", "1of1", 1 if succ else 0, [], f"freethrow:{e.get('sub_type')}")
    if at == "rebound":
        if sub not in ("offensive", "defensive"):
            return None, "", None, [], f"rebound:{e.get('sub_type')}"
        return "rebound", sub, None, ([] if player else ["team"]), None
    if at in ("assist", "steal", "block"):
        return (at, "", None, [], None) if player else (None, "", None, [], f"{at}:no player")
    if at == "turnover":
        st = TURNOVER_RENAME.get(sub, sub)
        unk = None if st in TURNOVER_SUBTYPES else f"turnover:{e.get('sub_type')}"
        return "turnover", (st if not unk else "other"), None, ([] if player else ["team"]), unk
    if at == "foul":
        if sub == "drawn":
            return ("foulon", "", None, [], None) if player else (None, "", None, [], "foul:drawn, no player")
        st = FOUL_SUBTYPES.get(sub)
        if st is None:
            return "foul", "personal", None, [], f"foul:{e.get('sub_type')}"
        if not player and st not in TEAM_FOULS:
            st = "benchtechnical" if st == "technical" else st
        return "foul", st, None, [], None
    if at == "substitution":
        return (("substitution", sub, None, [], None) if sub in ("in", "out") and player
                else (None, "", None, [], f"substitution:{e.get('sub_type')}"))
    if at == "jumpball":
        return ("jumpball", sub, None, [], None) if sub in ("won", "lost") else (None, "", None, [], None)
    if at == "timeout":
        return ("timeout", "full", None, [], None) if sub != "officials" else (None, "", None, [], None)
    return None, "", None, [], f"{e.get('action_type')}:{e.get('sub_type')}"


# ============================================================================ small helpers
def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _secs(clock) -> Optional[float]:
    """'09:46' -> 586.0 (time LEFT in the period); None when there is no clock."""
    s = str(clock or "").strip()
    if not s:
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(parts[0])
    except ValueError:
        return None


def _gt(seconds: float) -> str:
    s = int(round(max(0.0, seconds)))
    return f"{s // 60:02d}:{s % 60:02d}"


def _mmss(seconds: float) -> str:
    s = int(round(max(0.0, seconds)))
    return f"{s // 60}:{s % 60:02d}"


def _plen(qn: int) -> int:
    return 600 if qn <= 4 else 300


def qnum(e: dict) -> int:
    """1-4 for the quarters, 5, 6 ... for the overtimes (the service writes OT1 as period "1",
    period_type "overtime")."""
    p = _num(e.get("period")) or 1
    return p + 4 if str(e.get("period_type") or "").lower() == "overtime" else p


def utc_iso(s) -> Optional[str]:
    """'2026-09-23T09:30:00' (the service's start_time, UTC without a zone) -> ISO with +00:00."""
    s = str(s or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S


def club_id(team: dict) -> str:
    """The stats platform's club id: the schedule's external_id, the game payload's id - one value."""
    return str((team or {}).get("external_id") or (team or {}).get("id") or "").strip()


def crest(team: dict) -> Optional[str]:
    """The club's crest: the NBL's own PNG where it has one (its clubs' square app tiles - colour
    all the way to the edge, so a crest and a club colour at once), else the stats platform's
    crest, asked for as a 200px PNG (its image service serves any size and format; webp, which it
    gives by default, is not a format every reader of a crest takes)."""
    t = team or {}
    u = str(t.get("team_logo") or "").strip()
    if u.startswith("https://") and u.split("?")[0].lower().endswith(".png"):
        return u
    for k in ("external_team_logo", "team_logo", "team_logo_transparent"):
        u = str(t.get(k) or "").strip()
        if not u.startswith("https://"):
            continue
        if "images.dc." in u:
            base = u.split("?")[0]
            return f"{base}?size=200&format=png"
        return u
    return None


# ============================================================================ seasons + schedule
def season_start_year(token, calendar: bool) -> Optional[int]:
    """'2026-27' -> 2026 (NBL / WNBL); '2026' -> 2026 (NBL1, a calendar year). A split token for a
    calendar league, or anything else that is not a season, -> None."""
    t = str(token or "").strip()
    m = re.fullmatch(r"(\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?", t)
    if not m:
        return None
    y = int(m.group(1))
    if m.group(2):
        if calendar:
            return None
        y2 = int(m.group(2)) % 100
        return y if y2 == (y + 1) % 100 else None
    return y


def current_year(calendar: bool, now: Optional[datetime] = None) -> int:
    """The season being played: the calendar year for NBL1; for NBL / WNBL the one that starts that
    year from August on (feedplatform.season_name_for's cut-over)."""
    now = now or datetime.now(timezone.utc)
    if calendar:
        return now.year
    return now.year if now.month >= 8 else now.year - 1


def season_label(year: int, calendar: bool) -> str:
    return str(year) if calendar else f"{year}-{str(year + 1)[2:]}"


def _division(season: dict) -> dict:
    div = ((season.get("competition") or {}).get("division") or [])
    return div[0] if isinstance(div, list) and div else (div if isinstance(div, dict) else {})


def gender_of(season: dict) -> Optional[str]:
    """'men' / 'women' for an NBL1 season, from its division, its competition or its name."""
    comp = season.get("competition") or {}
    for v in (_division(season).get("gender"), comp.get("gender"), season.get("gender")):
        v = str(v or "").strip().lower()
        if v in ("male", "men", "m"):
            return "men"
        if v in ("female", "women", "w", "f"):
            return "women"
    name = " ".join(str(x or "") for x in (_division(season).get("name"), comp.get("name"), season.get("name")))
    if re.search(r"\bwomen'?s?\b", name, re.I):
        return "women"
    if re.search(r"\bmen'?s?\b", name, re.I):
        return "men"
    return None


def conference_of(season: dict) -> Optional[str]:
    """'NBL1 South' - the conference an NBL1 season is played in (its league's name)."""
    lg = ((season.get("competition") or {}).get("league") or {}).get("name")
    lg = str(lg or "").strip()
    if lg:
        return lg
    conf = (_division(season).get("conference") or {}).get("name")
    return f"NBL1 {conf}".strip() if conf else None


def is_national_finals(season: dict) -> bool:
    lg = str(((season.get("competition") or {}).get("league") or {}).get("name") or "")
    return bool(re.search(r"\bfinals?\b", lg, re.I) or re.search(r"national finals", str(season.get("name") or ""), re.I))


def pick_seasons(seasons: List[dict], org: str, year: int, stage: str, gender: Optional[str]) -> List[dict]:
    """The service's seasons one config row reads for one year."""
    out = []
    for s in seasons or []:
        if str(s.get("year") or "").strip() != str(year):
            continue
        if org in MAIN_SEASON:
            if (s.get("season_type") or "").lower() == "regular" and MAIN_SEASON[org].match(str(s.get("name") or "").strip()):
                out.append(s)
            continue
        # NBL1: one gender, and either the five conferences or the National Finals
        if (s.get("season_type") or "").lower() in ("test", "preseason"):
            continue
        if gender and gender_of(s) != gender:
            continue
        if is_national_finals(s) != (stage == "national"):
            continue
        out.append(s)
    return out


def row_stage(row: dict) -> str:
    """regular | finals | preseason | cup | other, from match_type first and the round second."""
    mt = str(row.get("match_type") or "").strip().lower()
    rnd = str(row.get("round") or "").strip()
    if "cup" in rnd.lower():
        return "cup"                      # the Ignite Cup final: neither the ladder nor the finals
    if mt in ("preseason", "pre_season", "pre-season", "exhibition", "friendly") or \
            re.search(r"pre-?\s*season|exhibition|all.?star", rnd, re.I):
        return "preseason"
    if mt == "regular":
        return "regular"
    if mt in ("final", "finals", "playoff", "playoffs", "postseason"):
        return "finals"
    if rnd.isdigit():
        return "regular"
    if FINALS_ROUND.search(rnd):
        return "finals"
    return "other"


def row_status(row: dict, tip: Optional[str], now: datetime) -> str:
    ms = str(row.get("match_status") or "").strip().lower()
    st = str(row.get("status") or "").strip().lower()
    if ms in STATUS_LIVE or st in STATUS_LIVE:
        return "live"
    if ms in STATUS_FINAL or st in STATUS_FINAL:
        return "final"
    try:
        t = datetime.fromisoformat(tip) if tip else None
    except ValueError:
        t = None
    if t and t <= now and (now - t).total_seconds() < LIVE_GUARD_S:
        return "live"
    return "scheduled"


def round_label(row: dict) -> str:
    """'Round 12' for a numbered round; the finals' own names otherwise, CHAMPIONSHIP as Championship."""
    rnd = str(row.get("override_round") or row.get("round") or "").strip()
    if rnd.isdigit():
        return f"Round {rnd}"
    return rnd.title() if rnd.isupper() and len(rnd) > 3 else rnd


# ============================================================================ one game
def _order_key(e: dict, i: int):
    """(period, seconds run off, typed at, action id, position): play order, whichever way the list
    came. An action with no clock (the bookkeeping kind) sorts by when it was typed."""
    q = qnum(e)
    left = _secs(e.get("clock"))
    run = (_plen(q) - left) if left is not None else -1.0
    return (q, run, str(e.get("timestamp") or ""), _num(e.get("action_id")), i)


def _missed(ev: dict) -> bool:
    """A miss that leaves a ball to rebound: a field goal, or the last free throw of a trip."""
    if ev["success"] or ev["tno"] not in (1, 2):
        return False
    if ev["actionType"] in ("2pt", "3pt"):
        return True
    m = re.fullmatch(r"(\d)of(\d)", ev["subType"]) if ev["actionType"] == "freethrow" else None
    return bool(m and m.group(1) == m.group(2))


def _blocked_shot_first(chrono: List[dict]) -> Tuple[List[dict], int]:
    """A blocked shot put back in front of its block.

    The operators type a block first and the shot it stopped after it (107 of 133 blocks in the
    sample, within the same second), and a team rebound can sit between the two. Read in that
    order the ball is rebounded before it is shot. The shot moves to just before the block: the
    nearest miss by the other side in the same second, after the block."""
    out = list(chrono)
    moved = 0
    i = 0
    while i < len(out):
        e = out[i]
        if e["actionType"] == "block" and e["tno"] in (1, 2):
            for j in range(i + 1, len(out)):
                f = out[j]
                if (f["_q"], f["gt"]) != (e["_q"], e["gt"]):
                    break
                if f["actionType"] in ("2pt", "3pt") and f["tno"] == 3 - e["tno"] and not f["success"]:
                    out.insert(i, out.pop(j))
                    moved += 1
                    i += 1                      # the block is now one further on
                    break
        i += 1
    return out, moved


def _infer_teams(chrono: List[dict]) -> Tuple[List[str], List[str]]:
    """A team rebound or team turnover the feed left without its club gets one.

    A rebound belongs to the side that missed (offensive) or the other one (defensive) - the last
    miss before it, or failing that a miss typed after it in the same second; a team turnover (shot
    clock, 8 / 5 / 3 seconds) to the side in possession, followed from every action that names a
    club. Returns (inferred, unresolved) descriptions."""
    inferred, unresolved = [], []
    poss = miss = None
    cur_q = None
    for i, ev in enumerate(chrono):
        q = ev["_q"]
        if q != cur_q:
            cur_q, poss, miss = q, None, None
        a, tno = ev["actionType"], ev["tno"]
        if tno not in (1, 2) and a in ("rebound", "turnover"):
            guess = None
            if a == "rebound":
                shooter = miss
                if shooter not in (1, 2):
                    later = next((f for f in chrono[i + 1:i + 8] if (f["_q"], f["gt"]) == (q, ev["gt"]) and _missed(f)), None)
                    shooter = later["tno"] if later else None
                if shooter in (1, 2):
                    guess = shooter if ev["subType"] == "offensive" else 3 - shooter
            elif a == "turnover" and poss in (1, 2):
                guess = poss
            if guess:
                ev["tno"] = tno = guess
                inferred.append(f"{a}/{ev['subType']} Q{q} {ev['gt']} -> team {guess}")
            else:
                unresolved.append(f"{a}/{ev['subType']} Q{q} {ev['gt']}")
                continue
        if tno not in (1, 2):
            continue
        if a in ("2pt", "3pt"):
            if ev["success"]:
                poss, miss = 3 - tno, None
            else:
                miss = tno
        elif a == "freethrow":
            m = re.fullmatch(r"(\d)of(\d)", ev["subType"])
            last = bool(m and m.group(1) == m.group(2))
            if last:
                if ev["success"]:
                    poss, miss = 3 - tno, None
                else:
                    miss = tno
        elif a == "rebound":
            poss, miss = tno, None
        elif a == "turnover":
            poss, miss = 3 - tno, None
        elif a == "steal":
            poss = tno
        elif a == "jumpball" and ev["subType"] == "won":
            poss = tno
    return inferred, unresolved


def _clean_substitutions(chrono: List[dict], starters: Dict[int, set]) -> Tuple[List[dict], List[str]]:
    """A substitution the feed has twice is taken once.

    An operator can enter one change twice (Adelaide v Sydney, 1 Apr 2026: Isaac White off twice
    at 5:46 of Q2; at 7:10 of Q4 three of Sydney's four changes typed twice), which leaves the
    substitutions of that moment unbalanced - three off, two on - and a translator that pairs them
    off and on puts the wrong man on the floor. Replaying the lineups from the opening fives, a
    change is dropped when it changes nothing (on for a player already on, off for one already off)
    AND it either repeats a change already made at that moment or is on the side the moment has
    too many of. Every balanced change stands as the feed has it."""
    on = {1: set(starters.get(1) or ()), 2: set(starters.get(2) or ())}
    bal: Dict[tuple, int] = {}
    for ev in chrono:
        if ev["actionType"] == "substitution" and ev["tno"] in (1, 2) and ev["pno"]:
            k = (ev["tno"], ev["_q"], ev["gt"])
            bal[k] = bal.get(k, 0) + (1 if ev["subType"] == "in" else -1)
    seen: Dict[tuple, set] = {}
    out, dropped = [], []
    for ev in chrono:
        if ev["actionType"] == "substitution" and ev["tno"] in (1, 2) and ev["pno"]:
            k = (ev["tno"], ev["_q"], ev["gt"])
            s = on[ev["tno"]]
            going_in = ev["subType"] == "in"
            idle = (ev["pno"] in s) if going_in else (ev["pno"] not in s)
            repeat = (ev["pno"], ev["subType"]) in seen.setdefault(k, set())
            surplus = bal[k] > 0 if going_in else bal[k] < 0
            if idle and (repeat or surplus):
                if surplus:
                    bal[k] += -1 if going_in else 1
                dropped.append(f"{ev['player']} {ev['subType']} Q{ev['_q']} {ev['gt']}")
                continue
            seen[k].add((ev["pno"], ev["subType"]))
            (s.add if going_in else s.discard)(ev["pno"])
        out.append(ev)
    return out, dropped


def _starters_from_pbp(chrono: List[dict], tno: int) -> set:
    """One side's opening five from the first quarter: a player whose first substitution takes him
    OFF, or who does something before any substitution brings him on."""
    first_sub: Dict[str, str] = {}
    acted = set()
    for ev in chrono:
        if ev["_q"] != 1:
            break
        if ev["tno"] != tno or not ev["pno"]:
            continue
        if ev["actionType"] == "substitution":
            first_sub.setdefault(ev["pno"], ev["subType"])
        elif ev["pno"] not in first_sub:
            acted.add(ev["pno"])
    return {p for p, s in first_sub.items() if s == "out"} | acted


def _pair_drawn_fouls(chrono: List[dict]) -> Tuple[List[dict], int]:
    """Every foulon joined to the foul it mirrors - the other side's foul at the same clock, the
    nearest one in the list - and placed straight AFTER it.

    The service types the drawn half first (the drawn foul and the foul are a few milliseconds
    apart, drawn first), but FIBA's foulon points BACK at its foul, and translate() only folds a
    foulon into a foul it has already written: in the service's order every "fouled by" would be
    lost from the event log. A foulon with no such foul is left where it is (and counted).
    Returns (the list, how many were left unpaired)."""
    fouls: Dict[tuple, List[int]] = {}
    for i, e in enumerate(chrono):
        if e["actionType"] == "foul" and e["tno"] in (1, 2):
            fouls.setdefault((e["_q"], e["gt"], e["tno"]), []).append(i)
    used, follow, moved = set(), {}, set()
    unpaired = 0
    for i, e in enumerate(chrono):
        if e["actionType"] != "foulon" or e["tno"] not in (1, 2):
            continue
        cands = [j for j in fouls.get((e["_q"], e["gt"], 3 - e["tno"])) or [] if j not in used]
        if not cands:
            unpaired += 1
            continue
        j = min(cands, key=lambda j: (abs(j - i), j < i))
        used.add(j)
        e["_foul"] = chrono[j]
        follow.setdefault(j, []).append(e)
        moved.add(i)
    out: List[dict] = []
    for i, e in enumerate(chrono):
        if i in moved:
            continue
        out.append(e)
        out.extend(follow.get(i, []))
    return out, unpaired


def _scores_away_first(chrono: List[dict]) -> bool:
    """Whether this game's score_1 is the AWAY side's score. The service's two score columns follow
    the stats platform's own order of the two clubs, which is not always home first (7 of 20
    sampled games are the other way round). Read from the scoring plays: whichever column moves
    when the home side scores."""
    votes = 0
    prev = (0, 0)
    for ev in chrono:
        cur = (_num(ev["s1"]), _num(ev["s2"]))
        if ev["scoring"] and ev["tno"] in (1, 2) and cur != prev:
            d1, d2 = cur[0] - prev[0], cur[1] - prev[1]
            if d1 > 0 and d2 == 0:
                votes += 1 if ev["tno"] == 1 else -1
            elif d2 > 0 and d1 == 0:
                votes += 1 if ev["tno"] == 2 else -1
        prev = cur
    return votes < 0


BOX_KEYS = ("sPoints", "sFieldGoalsMade", "sFieldGoalsAttempted", "sTwoPointersMade", "sTwoPointersAttempted",
            "sThreePointersMade", "sThreePointersAttempted", "sFreeThrowsMade", "sFreeThrowsAttempted",
            "sReboundsOffensive", "sReboundsDefensive", "sReboundsTotal", "sAssists", "sTurnovers", "sSteals",
            "sBlocks", "sBlocksReceived", "sFoulsPersonal", "sFoulsOn", "sFoulsTechnical",
            "sFoulsUnsportsmanlike", "sFoulsDisqualifying")
#: the league's box field -> FIBA's, for the comparison against the play-by-play
LEAGUE_BOX = {"points": "sPoints", "field_goals_made": "sFieldGoalsMade", "field_goals_attempted": "sFieldGoalsAttempted",
              "two_points_made": "sTwoPointersMade", "two_points_attempted": "sTwoPointersAttempted",
              "three_points_made": "sThreePointersMade", "three_points_attempted": "sThreePointersAttempted",
              "free_throws_made": "sFreeThrowsMade", "free_throws_attempted": "sFreeThrowsAttempted",
              "offensive_rebounds": "sReboundsOffensive", "defensive_rebounds": "sReboundsDefensive",
              "rebounds": "sReboundsTotal", "assists": "sAssists", "turnovers": "sTurnovers", "steals": "sSteals",
              # the league's "fouls" (FLS): every foul the player committed - personal, offensive,
              # technical, unsportsmanlike, disruptive - which is FIBA's PF. Its "personal_fouls" is
              # the personal ones alone.
              "blocks": "sBlocks", "fouls": "sFoulsPersonal"}
ZERO_SPLITS = ("sPointsSecondChance", "sPointsFastBreak", "sPointsFromTurnovers", "sPointsInThePaint")


def _count(box: dict, ev: dict) -> None:
    """Add one FIBA-shaped action to its player's counting stats."""
    a, st, ok = ev["actionType"], ev["subType"], ev["success"]
    if a in ("2pt", "3pt"):
        three = a == "3pt"
        box["sFieldGoalsAttempted"] += 1
        box["sThreePointersAttempted" if three else "sTwoPointersAttempted"] += 1
        if ok:
            box["sFieldGoalsMade"] += 1
            box["sThreePointersMade" if three else "sTwoPointersMade"] += 1
            box["sPoints"] += 3 if three else 2
    elif a == "freethrow":
        box["sFreeThrowsAttempted"] += 1
        if ok:
            box["sFreeThrowsMade"] += 1
            box["sPoints"] += 1
    elif a == "rebound":
        box["sReboundsOffensive" if st == "offensive" else "sReboundsDefensive"] += 1
        box["sReboundsTotal"] += 1
    elif a == "assist":
        box["sAssists"] += 1
    elif a == "turnover":
        box["sTurnovers"] += 1
    elif a == "steal":
        box["sSteals"] += 1
    elif a == "block":
        box["sBlocks"] += 1
    elif a == "foul":
        box["sFoulsPersonal"] += 1
        if st == "technical":
            box["sFoulsTechnical"] += 1
        elif st == "unsportsmanlike":
            box["sFoulsUnsportsmanlike"] += 1
        elif st == "disqualifying":
            box["sFoulsDisqualifying"] += 1
    elif a == "foulon":
        box["sFoulsOn"] += 1


def raw_from_match(match: dict) -> Optional[dict]:
    """One /live/all game -> FIBA data.json shape: play-by-play OLDEST first, actionNumber 1..n,
    every period opened and closed once, the box counted from the play-by-play. Pure: the same
    input gives the same output.

    None when there is nothing to show yet (no game, or not one action that records anything)."""
    m = (match.get("data") or [None])[0] if isinstance(match, dict) and isinstance(match.get("data"), list) else match
    if not isinstance(m, dict) or not m.get("home_team") or not m.get("away_team"):
        return None
    home, away = m["home_team"], m["away_team"]
    ids = {club_id(home): 1, club_id(away): 2}
    for t, n in ((home, 1), (away, 2)):          # the payload may use either of a club's two ids
        if t.get("id"):
            ids.setdefault(str(t["id"]), n)

    def tno_of(team) -> int:
        if not isinstance(team, dict):
            return 0
        return ids.get(str(team.get("id") or ""), 0) or ids.get(str(team.get("external_id") or ""), 0)

    # ------------------------------------------------------------------ the roster (the league's box)
    league_rows: Dict[Tuple[int, str], dict] = {}
    for r in m.get("player_match_statistics") or []:
        if str(r.get("period", "0")) != "0":
            continue
        tno = tno_of(r.get("team"))
        pid = str(((r.get("player") or {}).get("id")) or "").strip()
        if tno and pid:
            league_rows[(tno, pid)] = r
    people: Dict[Tuple[int, str], dict] = {}
    for (tno, pid), r in league_rows.items():
        p = r.get("player") or {}
        people[(tno, pid)] = {"first": (p.get("first_name") or "").strip(), "last": (p.get("last_name") or "").strip(),
                              "shirt": str(r.get("jersey_number") or p.get("jersey_number") or "").strip(),
                              "position": (r.get("playing_position") or p.get("playing_position") or "").strip(),
                              # a DNP can carry the starter flag (Cairns v Brisbane, 26 Sep 2025: six
                              # "starters" a side, two of them never on court): it counts only for a
                              # player who took part
                              "starter": bool(r.get("starter")) and r.get("participated") is not False
                              and _secs(r.get("minutes")) != 0}

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    feed = [e for e in (m.get("play_by_play") or []) if isinstance(e, dict)]
    keyed = []
    closed = set()
    whistle = False
    for i, e in enumerate(feed):
        a, st, success, quals, unk = classify(e)
        if unk:
            unknown.append(unk)
        if not a:
            continue
        q = qnum(e)
        if a == "period":
            if st == "end":
                closed.add(q)
            continue                                # written once each, below
        if a == "game":
            whistle = True
            continue
        tno = tno_of(e.get("team"))
        p = e.get("player") or {}
        pid = str(p.get("id") or e.get("personId") or "").strip()
        if pid and tno and (tno, pid) not in people:
            # a player the league's box has not listed (yet): kept, named from the action itself
            people[(tno, pid)] = {"first": (p.get("first_name") or "").strip(), "last": (p.get("last_name") or "").strip(),
                                  "shirt": str(p.get("jersey_number") or "").strip(),
                                  "position": (p.get("playing_position") or "").strip(), "starter": False}
        who = people.get((tno, pid)) if pid else None
        if a in ("jumpball", "timeout") and not tno:
            continue                                # no club, nothing to record
        left = _secs(e.get("clock"))
        ev = {
            "actionNumber": 0,
            "period": q if q <= 4 else q - 4,
            "periodType": "REGULAR" if q <= 4 else "OVERTIME",
            "gt": _gt(left if left is not None else _plen(q)),
            "s1": str(_num(e.get("score_1"))), "s2": str(_num(e.get("score_2"))),
            "tno": tno, "pno": pid if (pid and who) else "",
            "actionType": a, "subType": st, "qualifier": quals,
            "success": success if success is not None else 0,
            "scoring": 1 if (a in ("2pt", "3pt", "freethrow") and success == 1) else 0,
            "shirtNumber": (who or {}).get("shirt", ""),
            "firstName": (who or {}).get("first", ""), "familyName": (who or {}).get("last", ""),
            "player": f"{(who or {}).get('first', '')} {(who or {}).get('last', '')}".strip() if who else "",
            "_q": q, "_xy": e.get("coordinates") or {},
        }
        keyed.append((_order_key(e, i), ev))
    if not keyed:
        return None
    keyed.sort(key=lambda kv: kv[0])
    chrono, blocks_moved = _blocked_shot_first([ev for _, ev in keyed])
    inferred, unresolved = _infer_teams(chrono)
    flipped = _scores_away_first(chrono)
    if flipped:
        for ev in chrono:
            ev["s1"], ev["s2"] = ev["s2"], ev["s1"]
    chrono, unpaired = _pair_drawn_fouls(chrono)
    if unpaired:
        # a "fouled by" with no foul to mirror is the same one typed twice (both in the sample: the
        # second at the same clock, one with the very same timestamp) - it is not counted twice
        chrono = [ev for ev in chrono if not (ev["actionType"] == "foulon" and "_foul" not in ev)]
    starters_inferred = []
    for tno in (1, 2):
        mine = [k for k, who in people.items() if k[0] == tno and who["starter"]]
        if len(mine) != 5:
            guess = _starters_from_pbp(chrono, tno)
            if len(guess) == 5:
                for k, who in people.items():
                    if k[0] == tno:
                        who["starter"] = k[1] in guess
                starters_inferred.append(tno)
    chrono, subs_dropped = _clean_substitutions(
        chrono, {t: {pid for (s_, pid), who in people.items() if s_ == t and who["starter"]} for t in (1, 2)})

    # periods: one start for every period played, one end for every period closed or left behind
    played = {ev["_q"] for ev in chrono} | closed
    last_q = max(played)
    status_txt = {str(m.get("match_status") or "").lower(), str(m.get("status") or "").lower()}
    finished = whistle or bool(status_txt & STATUS_FINAL)
    closed |= set(range(1, last_q))
    if finished:
        closed.add(last_q)
    by_q: Dict[int, List[dict]] = {}
    for ev in chrono:
        by_q.setdefault(ev["_q"], []).append(ev)
    score = ["0", "0"]

    def marker(qn, action, sub, clock):
        return {"actionNumber": 0, "period": qn if qn <= 4 else qn - 4,
                "periodType": "REGULAR" if qn <= 4 else "OVERTIME", "gt": clock,
                "s1": score[0], "s2": score[1], "tno": 0, "pno": "",
                "actionType": action, "subType": sub, "qualifier": [], "success": 0, "scoring": 0,
                "shirtNumber": "", "firstName": "", "familyName": "", "player": "", "_q": qn, "_xy": {}}

    events: List[dict] = []
    for qn in range(1, last_q + 1):
        events.append(marker(qn, "period", "start", _gt(_plen(qn))))
        for ev in by_q.get(qn, []):
            events.append(ev)
            score = [ev["s1"], ev["s2"]]
        if qn in closed:
            events.append(marker(qn, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n
    for ev in events:
        foul = ev.pop("_foul", None)
        if foul is not None:
            ev["previousAction"] = foul["actionNumber"]

    # ------------------------------------------------------------------ the box, from the play-by-play
    box: Dict[Tuple[int, str], dict] = {k: {s: 0 for s in BOX_KEYS} for k in people}
    shooter_of = {}                                  # the last missed field goal of each side
    for ev in events:
        if not ev["pno"] or ev["tno"] not in (1, 2):
            if ev["actionType"] in ("2pt", "3pt") and not ev["success"]:
                shooter_of[ev["tno"]] = None
            continue
        key = (ev["tno"], ev["pno"])
        _count(box[key], ev)
        if ev["actionType"] in ("2pt", "3pt"):
            shooter_of[ev["tno"]] = None if ev["success"] else (key, ev["_q"], ev["gt"])
        elif ev["actionType"] == "block":
            shot = shooter_of.get(3 - ev["tno"])
            if shot and shot[1] == ev["_q"]:
                box[shot[0]]["sBlocksReceived"] += 1
                shooter_of[3 - ev["tno"]] = None

    # minutes and plus-minus: who was on court for every second and every point
    on = {1: {pid for (t, pid), who in people.items() if t == 1 and who["starter"]},
          2: {pid for (t, pid), who in people.items() if t == 2 and who["starter"]}}
    secs: Dict[Tuple[int, str], float] = {k: 0.0 for k in people}
    pm: Dict[Tuple[int, str], int] = {k: 0 for k in people}
    last_t, last_s = 0.0, (0, 0)
    not_five = 0
    for ev in events:
        q = ev["_q"]
        t = sum(_plen(i) for i in range(1, q)) + _plen(q) - (_secs(ev["gt"]) or 0.0)
        for s in (1, 2):
            for pid in on[s]:
                secs[(s, pid)] += t - last_t
        last_t = t
        sc = (_num(ev["s1"]), _num(ev["s2"]))
        if sc != last_s:
            d = (sc[0] - last_s[0]) - (sc[1] - last_s[1])
            for pid in on[1]:
                pm[(1, pid)] += d
            for pid in on[2]:
                pm[(2, pid)] -= d
            last_s = sc
        if ev["actionType"] == "substitution" and ev["pno"] and ev["tno"] in (1, 2):
            (on[ev["tno"]].add if ev["subType"] == "in" else on[ev["tno"]].discard)(ev["pno"])
        elif ev["actionType"] not in ("substitution", "period", "game") and (len(on[1]) != 5 or len(on[2]) != 5):
            not_five += 1

    # THE LEAGUE'S MINUTES AND PLUS-MINUS, when its box is current: its players' points add up to
    # the score and its minutes to the game (5 x 40 minutes a side, give or take the seconds each
    # row is rounded to - 4 to 12 of them in the sample). Its clock is finer than the play-by-play's
    # whole seconds, so its minutes are the better ones then; a frozen box (WNBL26's decider, 3:19
    # a side short) keeps the ones replayed from the substitutions above.
    length = sum(_plen(q_) for q_ in range(1, last_q + 1)) * 5
    team_pts = {t: sum(b["sPoints"] for (s_, _), b in box.items() if s_ == t) for t in (1, 2)}
    league_current = bool(league_rows) and all(
        abs(sum(_secs(r.get("minutes")) or 0 for (s_, _), r in league_rows.items() if s_ == t) - length) <= 30
        and sum(_num(r.get("points")) for (s_, _), r in league_rows.items() if s_ == t) == team_pts[t]
        for t in (1, 2))
    if league_current:
        for key, r in league_rows.items():
            if _secs(r.get("minutes")) is not None:
                secs[key] = _secs(r.get("minutes"))
            if r.get("plus_minus") is not None:
                pm[key] = _num(r.get("plus_minus"))

    # the league's own box, beside ours: where they differ the play-by-play is taken, and said so
    differs = []
    for key, r in league_rows.items():
        mine = box.get(key) or {}
        bad = [f"{fiba} {mine.get(fiba, 0)}/{_num(r.get(k))}" for k, fiba in LEAGUE_BOX.items()
               if mine.get(fiba, 0) != _num(r.get(k))]
        if bad:
            who = people.get(key) or {}
            differs.append(f"{who.get('first', '')} {who.get('last', '')}: " + ", ".join(bad))

    # ------------------------------------------------------------------ the two clubs
    periods_pts = {1: {}, 2: {}}
    for ev in events:
        if ev["scoring"] and ev["tno"] in (1, 2):
            pts = 3 if ev["actionType"] == "3pt" else (2 if ev["actionType"] == "2pt" else 1)
            periods_pts[ev["tno"]][ev["_q"]] = periods_pts[ev["tno"]].get(ev["_q"], 0) + pts
    team_events = {1: {"oreb": 0, "dreb": 0, "tov": 0}, 2: {"oreb": 0, "dreb": 0, "tov": 0}}
    for ev in events:
        if not ev["pno"] and ev["tno"] in (1, 2) and "team" in ev["qualifier"]:
            k = {"rebound": "oreb" if ev["subType"] == "offensive" else "dreb", "turnover": "tov"}.get(ev["actionType"])
            if k:
                team_events[ev["tno"]][k] += 1
    final_home = _num(m.get("home_score")) if finished and m.get("home_score") not in (None, "") else None
    final_away = _num(m.get("away_score")) if finished and m.get("away_score") not in (None, "") else None

    tm: Dict[str, dict] = {}
    for tno, t in ((1, home), (2, away)):
        pl: Dict[str, dict] = {}
        for (s, pid), who in people.items():
            if s != tno:
                continue
            b = box[(s, pid)]
            first, last = who["first"], who["last"]
            row = {"firstName": first, "familyName": last, "name": f"{first} {last}".strip(),
                   "internationalFirstName": first, "internationalFamilyName": last,
                   "scoreboardName": (f"{first[:1]}. {last}" if first else last).strip(),
                   "shirtNumber": who["shirt"], "playingPosition": who["position"],
                   "starter": 1 if who["starter"] else 0, "active": 1,
                   "sMinutes": _mmss(secs[(s, pid)]), "sPlusMinusPoints": pm[(s, pid)]}
            row.update(b)
            for k in ZERO_SPLITS:
                row[k] = 0
            row["eff_1"] = (b["sPoints"] + b["sReboundsTotal"] + b["sAssists"] + b["sSteals"] + b["sBlocks"]
                            - (b["sFieldGoalsAttempted"] - b["sFieldGoalsMade"])
                            - (b["sFreeThrowsAttempted"] - b["sFreeThrowsMade"]) - b["sTurnovers"])
            pl[pid] = row
        tot = {"tot_" + k: sum(p[k] for p in pl.values()) for k in BOX_KEYS}
        te = team_events[tno]
        tot["tot_sReboundsOffensive"] += te["oreb"]
        tot["tot_sReboundsDefensive"] += te["dreb"]
        tot["tot_sReboundsTotal"] += te["oreb"] + te["dreb"]
        tot["tot_sTurnovers"] += te["tov"]
        tot["tot_sReboundsTeamOffensive"] = te["oreb"]
        tot["tot_sReboundsTeamDefensive"] = te["dreb"]
        tot["tot_sReboundsTeam"] = te["oreb"] + te["dreb"]
        tot["tot_sTurnoversTeam"] = te["tov"]
        # a coach's or the bench's technical is the club's: in its team total (the league's own from
        # NBL27 - NBL26's left it out) and on its own as tot_sFoulsTeam
        tot["tot_sFoulsTeam"] = sum(1 for ev in events if ev["actionType"] == "foul" and ev["tno"] == tno
                                    and not ev["pno"])
        tot["tot_sFoulsPersonal"] += tot["tot_sFoulsTeam"]
        for k in ZERO_SPLITS:
            tot["tot_" + k] = 0
        tot["tot_sBenchPoints"] = sum(p["sPoints"] for p in pl.values() if not p["starter"])
        name = (t.get("name") or t.get("external_team_name") or "").strip()
        code3 = (t.get("team_code") or t.get("team_nickname") or "").strip()
        points = sum(periods_pts[tno].values())
        entry = {"name": name, "nameInternational": name, "shortName": code3 or name,
                 "code": club_id(t), "score": points, "pl": pl, "shot": [], **tot}
        logo = crest(t)
        if logo:
            entry["logoT"] = {"url": logo}
            entry["logoS"] = {"url": logo}
        for qn, v in sorted(periods_pts[tno].items()):
            entry[f"p{qn}_score"] = v
        for qn in range(1, last_q + 1):
            entry.setdefault(f"p{qn}_score", 0)
        entry["ot_score"] = sum(v for q_, v in periods_pts[tno].items() if q_ > 4)
        entry["full_score"] = points
        tm[str(tno)] = entry

    # the shot chart, joined to its action by number
    for ev in events:
        if ev["actionType"] not in ("2pt", "3pt") or ev["tno"] not in (1, 2):
            continue
        xy = ev["_xy"]
        if xy.get("x") is None or xy.get("y") is None:
            continue
        tm[str(ev["tno"])]["shot"].append({
            "r": ev["success"], "x": xy["x"], "y": xy["y"],
            "actionType": ev["actionType"], "subType": ev["subType"],
            "actionNumber": ev["actionNumber"], "pno": ev["pno"],
            "per": ev["period"], "perType": ev["periodType"],
            "player": ev["player"], "shirtNumber": ev["shirtNumber"]})
    for ev in events:
        ev.pop("_q", None)
        ev.pop("_xy", None)

    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    else:
        raw["clock"] = last_play["gt"] if last_play and (last_play["period"] + (4 if last_play["periodType"] == "OVERTIME" else 0)) == last_q \
            else _gt(_plen(last_q))
    season = m.get("season") or {}
    raw["nbl"] = {
        "matchId": str(m.get("id") or ""), "slug": m.get("match_slug"),
        "season": season.get("name") or season.get("year"), "round": m.get("round"),
        "matchType": m.get("match_type"), "date": utc_iso(m.get("start_time_datetime") or m.get("start_time")),
        "finished": finished, "venue": ((m.get("venue") or {}).get("name") or "").strip() or None,
        "attendance": _num(m.get("attendance")) or None,
        "final": [final_home, final_away], "unknown": sorted(set(unknown)),
        "teamInferred": len(inferred), "teamUnresolved": unresolved, "scoresAwayFirst": flipped,
        "drawnUnpaired": unpaired, "startersInferred": starters_inferred, "blocksReordered": blocks_moved,
        "subsDropped": subs_dropped, "leagueBoxCurrent": league_current,
        "leagueBoxDiffers": differs, "notFive": not_five,
    }
    return raw


# ============================================================================ the adapter
class NblAdapter(FibaLiveStatsAdapter):
    """NBL, WNBL and NBL1. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "nbl"
    #: the league's own service, not a CDN built to be polled
    min_request_gap_s = 0.75

    # shared across instances: a run reads NBL1's ten seasons for two or three sources
    _cache: dict = {}            # path -> (fetched_at, reply)
    SEASONS_TTL_S = 3600.0
    MATCHES_TTL_S = 300.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        org = str(config.get("org") or "").strip().lower()
        if org not in ORGS:
            raise ValueError(f"nbl: adapter_config.org must be one of {', '.join(ORGS)}, not {org!r}")
        calendar = org == "nbl1"
        stage = str(config.get("stage") or "regular").strip().lower()
        allowed = ("regular", "finals", "national") if calendar else ("regular", "finals")
        if stage not in allowed:
            raise ValueError(f"nbl: stage for {org} must be one of {', '.join(allowed)}, not {stage!r}")
        gender = str(config.get("gender") or "").strip().lower() or None
        if calendar and gender not in ("men", "women"):
            raise ValueError("nbl: an NBL1 row needs adapter_config.gender 'men' or 'women'")
        year = self._year(config, calendar)
        if year is None:
            return []
        seasons = pick_seasons(self._seasons(org), org, year, stage, gender)
        label = f"{org.upper()} {season_label(year, calendar)}" + (f" {gender}" if gender else "") + f" {stage}"
        if not seasons:
            print(f"     {label}: the service has no such season yet")
            return []
        now = datetime.now(timezone.utc)
        want = "finals" if stage == "national" else stage
        out: Dict[str, ScheduleGame] = {}
        for s in seasons:
            conf = conference_of(s) if calendar and stage != "national" else None
            for r in self._matches(s["id"]):
                if row_stage(r) != want:
                    continue
                g = self._schedule_game(r, want, conf, now)
                if g:
                    out[g.external_id] = g
        games = sorted(out.values(), key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     {label}: {len(games)} games from {len(seasons)} season(s) "
              f"({sum(1 for g in games if g.status == 'final')} final, "
              f"{sum(1 for g in games if g.status == 'live')} live)")
        return games

    @staticmethod
    def _year(config: dict, calendar: bool) -> Optional[int]:
        tok = config.get("season")
        if tok:
            y = season_start_year(tok, calendar)
            if y is None:
                want = "a calendar year, e.g. 2027" if calendar else "e.g. 2026-27"
                raise ValueError(f"nbl: season {tok!r} not understood ({want})")
        else:
            y = current_year(calendar)
        first = config.get("first_season")
        if first and (not tok or config.get("season_auto")):
            f = season_start_year(first, calendar)
            if f is not None and y < f:
                print(f"     not reading {season_label(y, calendar)}: this source starts with "
                      f"{season_label(f, calendar)} (adapter_config.first_season)")
                return None
        return y

    def _schedule_game(self, r: dict, stage: str, conference: Optional[str], now: datetime) -> Optional[ScheduleGame]:
        gid = str(r.get("id") or "").strip()
        home, away = r.get("home_team") or {}, r.get("away_team") or {}
        if not gid or not club_id(home) or not club_id(away):
            return None
        status_words = {str(r.get("match_status") or "").lower(), str(r.get("status") or "").lower()}
        if status_words & STATUS_DROPPED:
            return None
        tip = utc_iso(r.get("start_time_datetime") or r.get("start_time"))
        extra = {"home_code": club_id(home), "away_code": club_id(away),
                 "home_logo": crest(home), "away_logo": crest(away),
                 "round": round_label(r), "stage": stage,
                 "venue": ((r.get("venue") or {}).get("name") or "").strip() or None}
        if conference:
            extra["home_group"] = extra["away_group"] = conference
        if r.get("home_score") not in (None, ""):
            extra["home_score"], extra["away_score"] = r.get("home_score"), r.get("away_score")
        return ScheduleGame(external_id=gid,
                            home_name=(home.get("name") or home.get("external_team_name") or "").strip(),
                            away_name=(away.get("name") or away.get("external_team_name") or "").strip(),
                            tipoff_at=tip, status=row_status(r, tip, now), extra=extra)

    def _seasons(self, org: str) -> List[dict]:
        reply = self._cached(f"/get/{org}/seasons", self.SEASONS_TTL_S)
        if not isinstance(reply, dict) or not isinstance(reply.get("data"), list):
            raise RuntimeError(f"nbl: the season list for {org} is unreachable")
        return reply["data"]

    def _matches(self, season_id: str) -> List[dict]:
        reply = self._cached(f"/get/matches/in/season/{season_id}?limit=2000", self.MATCHES_TTL_S)
        if not isinstance(reply, dict) or not isinstance(reply.get("data"), list):
            raise RuntimeError(f"nbl: the games of season {season_id} are unreachable")
        return reply["data"]

    def _cached(self, path: str, ttl: float):
        at, reply = self._cache.get(path, (0.0, None))
        if reply is not None and time.time() - at < ttl:
            return reply
        reply = self._get_json(API + path)
        if reply is not None:
            self._cache[path] = (time.time(), reply)
        return reply

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not re.fullmatch(r"[0-9a-fA-F-]{16,40}", gid) or _too_early(config.get("_tipoff_at")):
            return None                   # decided before a single request is made
        reply = self._get_json(f"{API}/get/match/{gid}/live/all")
        if not isinstance(reply, dict):
            return None
        raw = raw_from_match(reply)
        if raw is None:
            return None
        meta = raw["nbl"]
        if meta["unknown"]:
            print(f"     NBL {gid}: {len(meta['unknown'])} action string(s) the adapter does not know, "
                  f"left out: {meta['unknown'][:4]}")
        if meta["teamUnresolved"]:
            print(f"     NBL {gid}: {len(meta['teamUnresolved'])} team action(s) with no club to give them: "
                  f"{meta['teamUnresolved'][:3]}")
        if meta["leagueBoxDiffers"] and meta["finished"]:
            print(f"     NBL {gid}: the league's box differs from its play-by-play for "
                  f"{len(meta['leagueBoxDiffers'])} player(s); the play-by-play is used "
                  f"({meta['leagueBoxDiffers'][0][:120]})")
        fin = meta["final"]
        if meta["finished"] and fin[0] is not None and [raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]] != fin:
            print(f"     NBL {gid}: the play-by-play scores {raw['tm']['1']['score']}-{raw['tm']['2']['score']}, "
                  f"the result says {fin[0]}-{fin[1]}")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = config.get("_tipoff_at") or meta["date"]
        return b

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(NblAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        NblAdapter._last_req = time.time()

    def _get_json(self, url: str):
        self._pause()
        for attempt in range(3):
            try:
                r = requests.get(url, headers={**HEADERS, "User-Agent": UA}, timeout=40)
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
