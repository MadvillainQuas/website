"""Korea's KBL - kbl.or.kr's own API, translated into the shape the platform already reads.

ONE HOST, PLAIN `requests`. kbl.or.kr is a single-page app over a JSON API at api.kbl.or.kr, which
wants two headers and nothing else (no cookie, no key): `Channel: WEB` and `TeamCode: XX`. Without
them every call is a 400 ("필수 헤더 정보가 누락되었습니다" - a required header is missing).

    /match/list?fromDate=YYYYMMDD&toDate=YYYYMMDD&tcodeList=all   the season, one request
    /match/<gmkey>                                                header: quarters, venue, crowd
    /match/<gmkey>/player-stat                                    the box score, both clubs
    /match/<gmkey>/team-record                                    each club's own totals
    /match/<gmkey>/text-cast?quarterList=Q1,Q2,...                the play-by-play

THE GAME KEY IS THE SEASON, THE COMPETITION AND THE GAME. "S49G14N1" is season code 49 (2026-27; the
first division's seasons are the odd codes, the D-League's the even ones), game code 14 and game 1.
The game code is the competition: 01 the regular season, 03 the play-offs, 04 the championship
final, 14 the pre-season Open Match Day, 07 the EASL, 10 the All-Star game. A source row names the
codes it takes (adapter_config.game_codes) or its stage does: regular = 01, playoffs = 03 + 04,
preseason = 14. The season is read off each game's own seasonName1 ("2026-2027"), never pinned.

NAMES, AS ON THE B.LEAGUE. The feed writes every player twice: pname in Hangul ("최승욱") and ename in
the league's own Latin spelling ("CHOI SEUNG WOOK"), family name first and shouted for a Korean,
given name first for an import ("Gaige Colburn Prim"). The Latin spelling is the one a Korean player
uses himself - it is on his registration, not a guess - so it is preferred, family and given names
split the way the flag says (playerFlag 0 domestic, 1 import, 2 Asian quota), and the Hangul goes
through as the native name, which names.py keeps as an alias. Nine of 186 players in 2026-27 have
only initials in ename ("KIM S C"); for those, and any player with no ename, the Hangul is spelt by
rule (names.korean_name: the Revised Romanization, passport family names). A CLUB is named from
EN_NAME below, keyed on the club's own logo class ("kcc", "pega"), which is also its code, so a club
created from a fixture and the same club named by a played game are one row.

THE PLAY-BY-PLAY NAMES A PLAYER, NOT AN ID. Each event carries the club code and the Korean name
(p) - no pcode - so it is matched to the box score's rows by (club, name) and given the pcode the
box keys that player on. Two things decide whether the lineups come out right:
  * each period opens with ten "sub in" rows (101) with no `c`, BEFORE the period-start row (001):
    the announcement of who is on court, not substitutions. The first period's is the starting
    five, which comes from the box score's startFlag instead; a later period's is kept, because the
    matching "sub out" rows after the previous period's end (009) took everybody off;
  * m:s is time REMAINING, which is FIBA's own gt.
There is no running score in the events; the box score's quarter lines give the result.

NO SHOT CHART. match-chart's shootLog places a shot in pixels on the site's court drawing without
saying which drawing, so no coordinate here can be trusted to be a percentage of anything.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

import names as N                       # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

API = "https://api.kbl.or.kr"
SITE = "https://www.kbl.or.kr"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept": "application/json", "Channel": "WEB", "TeamCode": "XX",
           "Referer": SITE + "/"}
KST = timezone(timedelta(hours=9))               # Korea keeps no summer time
LOGO = SITE + "/assets/img/logo/logo-{cls}.svg"

STAGE_CODES = {"regular": ("01",), "playoffs": ("03", "04"), "preseason": ("14",)}

# Each club's English name, keyed on its logo class - the one code the schedule, the game header and
# the club list all carry. The API's own teamNameFullEn is shouted ("SUWON KT SONICBOOM") and runs
# a sponsor together ("DAEGU KOREAGASCORPORATION PEGASUS"), so these are written out as the clubs
# write them. A club not listed (a new or renamed one) falls back to that field, un-shouted.
EN_NAME = {
    "db": ("Wonju DB Promy", "DB"),
    "ss": ("Seoul Samsung Thunders", "Samsung"),
    "sono": ("Goyang Sono Skygunners", "Sono"),
    "sk": ("Seoul SK Knights", "SK"),
    "lg": ("Changwon LG Sakers", "LG"),
    "kgc": ("Anyang Jung Kwan Jang Red Boosters", "Jung Kwan Jang"),
    "kcc": ("Busan KCC Egis", "KCC"),
    "kt": ("Suwon KT Sonicboom", "KT"),
    "pega": ("Daegu KOGAS Pegasus", "KOGAS"),
    "hd": ("Ulsan Hyundai Mobis Phoebus", "Hyundai Mobis"),
}

# text-cast `a` -> (actionType, subType, success), in the FIBA event shape scripts/ingest/stints.py
# replays. Codes from kbl.or.kr's own gameActionCodeList; checked against a whole game's box score
# (201+202 = 2PA, 207 counts in 2PM, 215+216 = PF).
ACTIONS = {
    "001": ("period", "start", None),
    "009": ("period", "end", None),
    "003": ("timeout", None, None),
    "101": ("substitution", "in", None),
    "102": ("substitution", "out", None),
    "201": ("2pt", "jumpshot", 1), "202": ("2pt", "jumpshot", 0),
    "203": ("freethrow", None, 1), "204": ("freethrow", None, 0),
    "205": ("3pt", "jumpshot", 1), "206": ("3pt", "jumpshot", 0),
    "207": ("2pt", "dunk", 1), "208": ("2pt", "dunk", 0),
    "209": ("rebound", "offensive", None), "210": ("rebound", "defensive", None),
    "211": ("assist", None, None),
    "212": ("steal", None, None),
    "213": ("block", None, None),
    "214": ("turnover", None, None),
    "215": ("foul", "personal", None),           # a foul that gave free throws
    "216": ("foul", "personal", None),
    "218": ("rebound", "defensive", None),       # the club's own; which end the feed does not say
    "223": ("turnover", None, None),             # the club's own
    "224": ("foul", "personal", None),
}
TEAM_EVENTS = ("218", "223")
#: `f` on a foul: what kind it was
FOUL_KIND = {"TCF": "technical", "FRF": "unsportsmanlike", "FTF": "disqualifying", "PCF": "disqualifying",
             "EBF": "unsportsmanlike", "PNF": "personal"}


def season_year(config: dict) -> int:
    m = re.search(r"(\d{4})", str(config.get("season") or ""))
    if m:
        return int(m.group(1))
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 8 else now.year - 1


def club(cls: Optional[str], fallback: str = "") -> tuple[str, str]:
    """(English name, short name) for a club's logo class."""
    if cls and cls in EN_NAME:
        return EN_NAME[cls]
    name = N.team_name(fallback) if fallback else (cls or "").upper()
    return name, name


def tipoff(date: str, start: str) -> Optional[str]:
    """"20261003", "1400" (KST) -> "2026-10-03T05:00:00Z"."""
    d, t = str(date or ""), str(start or "")
    if not re.fullmatch(r"\d{8}", d):
        return None
    hh, mm = (t[:2], t[2:4]) if re.fullmatch(r"\d{4}", t) else ("12", "00")
    local = datetime(int(d[:4]), int(d[4:6]), int(d[6:]), int(hh), int(mm), tzinfo=KST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cap(w: str) -> str:
    return "-".join(p[:1].upper() + p[1:].lower() for p in w.split("-"))


def english_name(ename: str, pname: str, flag) -> tuple[str, str]:
    """(given, family) for one player, from the league's Latin spelling where it is a spelling.

    A Korean's ename is family name first ("KIM KYUNG WON" -> "Kyung-won", "Kim"); an import's is
    given name first ("Gaige Colburn Prim" -> "Gaige Colburn", "Prim"). An ename of initials ("KIM S C")
    or none at all is not a spelling of anything, and the Hangul is spelt by rule instead."""
    words = [w for w in re.split(r"\s+", str(ename or "").strip()) if w]
    initials = any(len(w.rstrip(".")) == 1 for w in words[1:])
    if len(words) < 2 or initials:
        given, family = N.korean_name(pname)
        if family and N.is_hangul(pname):
            return given, family
        if len(words) == 1:
            return "", _cap(words[0])
        return given, family
    if str(flag or "0") in ("1", "2"):
        return " ".join(_cap(w) for w in words[:-1]), _cap(words[-1])
    return "-".join(w.lower() for w in words[1:]).capitalize() if len(words) > 2 else _cap(words[1]), _cap(words[0])


def _minutes(rec: dict) -> str:
    m, s = int(S.num(rec.get("playMin"))), int(S.num(rec.get("playSec")))
    return f"{m}:{s:02d}"


def _stats(rec: dict) -> dict:
    pm = S.num(rec.get("marginCn"))
    return {
        "sPoints": S.num(rec.get("score")),
        "sTwoPointersMade": S.num(rec.get("fg")), "sTwoPointersAttempted": S.num(rec.get("fgA")),
        "sThreePointersMade": S.num(rec.get("threep")), "sThreePointersAttempted": S.num(rec.get("threepA")),
        "sFieldGoalsMade": S.num(rec.get("fgt")), "sFieldGoalsAttempted": S.num(rec.get("fgtA")),
        "sFreeThrowsMade": S.num(rec.get("ft")), "sFreeThrowsAttempted": S.num(rec.get("ftA")),
        "sReboundsOffensive": S.num(rec.get("offr")), "sReboundsDefensive": S.num(rec.get("defr")),
        "sReboundsTotal": S.num(rec.get("rb")),
        "sAssists": S.num(rec.get("ast")), "sTurnovers": S.num(rec.get("to")), "sSteals": S.num(rec.get("stl")),
        "sBlocks": S.num(rec.get("bs")), "sFoulsPersonal": S.num(rec.get("foul")), "sFoulsOn": S.num(rec.get("fo")),
        "sPointsInThePaint": S.num(rec.get("pscore")),
        # 999 is the feed's "no value" (a player who never came on)
        "sPlusMinusPoints": 0 if pm in (999, -999) else pm,
    }


def _period(q: str) -> int:
    q = str(q or "").upper()
    m = re.fullmatch(r"([QX])(\d+)", q)
    if not m:
        return 1
    return int(m.group(2)) + (4 if m.group(1) == "X" else 0)


class KblAdapter(FibaLiveStatsAdapter):
    name = "kbl"
    min_request_gap_s = 0.4

    def _json(self, path: str):
        gap = time.time() - getattr(self, "_last_api", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.get(API + path, headers=HEADERS, timeout=40)
        if r.status_code in (400, 403, 404, 500):
            return None
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            return None

    # ----------------------------------------------------------------- schedule ---
    @staticmethod
    def codes_for(config: dict) -> tuple:
        if config.get("game_codes"):
            return tuple(str(c).zfill(2) for c in config["game_codes"])
        return STAGE_CODES.get(str(config.get("stage") or "regular").lower(), ("01",))

    @staticmethod
    def schedule_rows(rows: list, year: int, codes: tuple) -> list:
        """The first division's games of one season and the given competitions, in date order."""
        want = f"{year}-{year + 1}"
        out = [g for g in rows or [] if isinstance(g, dict)
               and str(g.get("seasonGrade")) == "1"
               and str(g.get("seasonName1") or g.get("seasonName") or "") == want
               and str(g.get("gameCode") or "").zfill(2) in codes]
        return sorted(out, key=lambda g: (str(g.get("gameDate")), str(g.get("gameStart")), S.num(g.get("gameNo"))))

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        year = season_year(config)
        rows = self._json(f"/match/list?fromDate={year}0801&toDate={year + 1}0731&tcodeList=all") or []
        games = self.schedule_rows(rows, year, self.codes_for(config))
        out = []
        for g in games:
            hn, hs = club(g.get("logoH"), g.get("tnameFH") or g.get("tnameH") or "")
            an, as_ = club(g.get("logoA"), g.get("tnameFA") or g.get("tnameA") or "")
            ended, started = S.num(g.get("isEnded")) == 1, S.num(g.get("isStarted")) == 1
            out.append(ScheduleGame(
                external_id=str(g["gmkey"]), home_name=hn, away_name=an,
                tipoff_at=tipoff(g.get("gameDate"), g.get("gameStart")),
                status="final" if ended else ("live" if started else "scheduled"),
                extra={"home_code": g.get("logoH"), "away_code": g.get("logoA"),
                       "home_logo": LOGO.format(cls=g["logoH"]) if g.get("logoH") else None,
                       "away_logo": LOGO.format(cls=g["logoA"]) if g.get("logoA") else None,
                       "home_short": hs, "away_short": as_,
                       "venue": (g.get("stadiumnameEn") or g.get("stadiumnameF") or "").strip() or None,
                       "stage": str(config.get("stage") or "regular").lower()}))
        print(f"     KBL {year}-{str(year + 1)[2:]} games {','.join(self.codes_for(config))}: {len(out)} "
              f"({sum(1 for x in out if x.status == 'final')} final)")
        self.last_competitions = []
        return out

    # --------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        key = str(external_id).strip()
        if not re.fullmatch(r"S\d+G\d+N\d+", key):
            return None
        tip = config.get("_tipoff_at")
        if tip:
            try:
                if datetime.fromisoformat(str(tip).replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(minutes=10):
                    return None               # not tipped off: no request at all
            except ValueError:
                pass
        head = self._json(f"/match/{key}") or {}
        game = head.get("game") or {}
        if not game or not S.num(game.get("isStarted")):
            return None
        box = self._json(f"/match/{key}/player-stat") or []
        if not box:
            return None
        teamrec = {str(r.get("tcode")): r.get("records") or {} for r in (self._json(f"/match/{key}/team-record") or [])
                   if isinstance(r, dict)}
        quarters = ",".join([f"Q{i}" for i in range(1, 5)] + [f"X{i}" for i in range(1, 5)])
        plays = self._json(f"/match/{key}/text-cast?quarterList={quarters}") or []
        raw = self.translate(game, head.get("teamrecords") or {}, box, teamrec, plays)
        b = self.bundle_from_raw(raw, key, config)
        b.tipoff_at = tipoff(game.get("gameDate"), game.get("gameStart")) or tip
        return b

    @staticmethod
    def translate(game: dict, teamrecords: dict, box: list, teamrec: dict, plays: list) -> dict:
        """The KBL's four payloads -> the FIBA data.json shape (fibashape)."""
        side_of = {str(game.get("tcodeH")): 1, str(game.get("tcodeA")): 2}
        players = {1: {}, 2: {}}
        by_name = {}                                    # (club, Korean name) -> pno
        for row in box:
            if not isinstance(row, dict):
                continue
            pl, rec = row.get("player") or {}, row.get("records") or {}
            tno = 1 if str(row.get("homeAway")) == "1" else 2
            pno = str(pl.get("pcode") or "").strip() or f"{tno}-{len(players[tno]) + 1}"
            mins = _minutes(rec)
            played = mins != "0:00" or any(S.num(rec.get(k)) for k in ("score", "fgtA", "ftA", "rb", "ast", "foul", "to"))
            given, family = english_name(pl.get("ename"), pl.get("pname"), pl.get("playerFlag"))
            p = S.player(last=(pl.get("pname") or "").strip(), name=(pl.get("ename") or "").strip(),
                         shirt=str(pl.get("backNum") or "").strip(), starter=1 if S.num(row.get("startFlag")) == 1 else 0,
                         active=1 if played else 0, minutes=mins if played else "0:00",
                         position=str(pl.get("pos") or ""), stats=_stats(rec))
            p["internationalFirstName"], p["internationalFamilyName"] = given, family
            if pl.get("img"):
                p["photoT"] = pl["img"]
            players[tno][pno] = p
            by_name[(str(pl.get("tcode") or ""), (pl.get("pname") or "").strip())] = pno

        tm = []
        for tno, side, letter in ((1, "home", "H"), (2, "away", "A")):
            cls = game.get("tlogo" + letter) or game.get("logo" + letter)
            name, short = club(cls, game.get("tnameF" + letter) or game.get("tname" + letter) or "")
            tr = teamrecords.get(side) or {}
            rec = teamrec.get(str(game.get("tcode" + letter))) or {}
            totals = _stats(rec) if rec else None
            if totals is not None:
                totals.update({"sPointsFastBreak": S.num(rec.get("fbScoreCn")),
                               "sPointsFromTurnovers": S.num(rec.get("turnoverScoreCn")),
                               "sPointsSecondChance": S.num(rec.get("secChanceScoreCn")),
                               "sBenchPoints": S.num(rec.get("benchScoreCn")),
                               "sBiggestLead": S.num(rec.get("maxLeadScoreCn"))})
            score = game.get("score" + letter)
            t = S.team(name, cls or str(game.get("tcode" + letter) or ""),
                       score=score if score is not None else (rec.get("score") if rec else None),
                       quarters=[tr.get(f"scoreq{i}") for i in range(1, 5)],
                       players=players[tno], logo=LOGO.format(cls=cls) if cls else None,
                       totals=totals, short_name=short)
            t["nameInternational"] = (game.get("tnameF" + letter) or "").strip()
            for i in range(1, 5):
                if tr.get(f"scoreq{i}") is None:
                    t.pop(f"p{i}_score", None)
            for i, v in enumerate(tr.get("scoreeq") or [], start=1):
                t[f"ot{i}_score"] = S.num(v)
            tm.append(t)

        played = S.num(game.get("isEnded")) == 1
        raw = S.game(tm[0], tm[1], played=played, pbp=KblAdapter.events(plays, side_of, by_name, played))
        return raw

    @staticmethod
    def events(plays: list, side_of: dict, by_name: dict, played: bool) -> list:
        """text-cast -> the platform's FIBA event shape, oldest first (see the module docstring)."""
        rows = sorted([e for e in plays or [] if isinstance(e, dict)], key=lambda e: S.num(e.get("n")))
        # after the LAST period's end the feed takes all ten players off; replayed, the game would
        # finish with nobody on court, so a finished game's substitutions stop at its final buzzer
        ends = [i for i, e in enumerate(rows) if str(e.get("a") or "").zfill(3) == "009"]
        last_end = ends[-1] if (played and ends) else None
        out, opened = [], False
        for i, e in enumerate(rows):
            a = str(e.get("a") or "").zfill(3)
            if last_end is not None and i > last_end and a in ("101", "102"):
                continue
            if a == "001":
                opened = True
            spec = ACTIONS.get(a)
            if spec is None:
                continue
            action, sub, success = spec
            if a == "101" and not e.get("c") and not opened:
                continue                                  # the opening announcement: the box has the starters
            n = int(S.num(e.get("n")))
            team = str(e.get("t") or "")
            teamless = action == "period"
            ev = {"actionNumber": n, "actionType": action, "period": _period(e.get("q")),
                  "gt": f"{int(S.num(e.get('m'))):02d}:{int(S.num(e.get('s'))):02d}",
                  "tno": 0 if teamless else side_of.get(team, 0),
                  "pno": "" if teamless or a in TEAM_EVENTS else by_name.get((team, str(e.get("p") or "").strip()), "")}
            if action == "foul":
                sub = FOUL_KIND.get(str(e.get("f") or "").upper(), sub)
            if sub:
                ev["subType"] = sub
            if success is not None:
                ev["success"] = success
            if a in TEAM_EVENTS:
                ev["qualifier"] = ["team"]
            out.append(ev)
        if played:
            out.append({"actionNumber": (out[-1]["actionNumber"] + 1) if out else 1, "actionType": "game",
                        "subType": "end", "period": out[-1]["period"] if out else 4, "gt": "00:00", "tno": 0, "pno": ""})
        return out

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """A translated feed is built forwards; the scraper's builder reads a real data.json backwards
        (see bleague.py). Nothing here hands the game to scripts/ingest/stints.py."""
        return []
