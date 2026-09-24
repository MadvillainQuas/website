# -*- coding: utf-8 -*-
"""BNXT League (Belgium + the Netherlands), from the league's own API (bnxt.sportpress.info).

THE API is the one bnxtleague.com's own pages read; every call carries the public token its app
script sends (headers["X-Authorization"]="..." in /js/app.<hash>.js - re-read from there if the
stored one is ever refused). robots.txt on the API host disallows nothing; the site has none.

    GET /phase/season/<season>                              the season's phases (+ competition id)
    GET /schedule/club/<season>?clubs[0]=1&clubs[1]=2&phase_id=<p>&month=-1
                                                            every game of a phase (1 = Belgium,
                                                            2 = the Netherlands, -1 = every month)
    GET /schedule/find/<game>                               one game: status, competition, clubs
    GET /boxscore/game/<competition>/<game>                 the box
    GET /film/game/<competition>/<game>                     the play-by-play

THE API NUMBERS A SEASON BY ITS END YEAR: 2027 is "BNXT League 2026 - 2027" (competition 25). The
platform's season is its start year, so 2026-27 asks for 2027.

STAGES. "Regular season 2026-27" is the regular source; the national play-offs ("Playoffs Belgium",
"Playoffs Netherlands") are play-off sources of their own (config phase_match), and a Supercup
phase is never read as the league's.

THE PLAY-BY-PLAY ("film") is translated into the FIBA LiveStats shape the platform reads, on the
event decoding the scraper validated in July 2026 by matching film counts to the box, 20 of 20
games exact (LINEUPDATASCRAPE, parse_bnxt_api_game):
    1000 made shot / 1001 missed shot - subcode 3 = three, 4 = free throw, else two (1 jump shot,
         2 lay-up, 5 tip-in); 1002 defensive / 1003 offensive rebound; 1004 steal; 1005 turnover;
    1006 foul drawn (the mirror of the foul: a foulon here); 1007 foul; 1008 assist; 1009 block;
    1011 substitution (player = in, player2 = out); codes from 1100 are team/period markers.
    The clock counts UP within a period (minute:second to 10:00); `order` is the chronological key.
The league PURGES a season's film once it is over (every 2025-26 game had none by August 2026), so
only a game with film is fetched: a game without one returns nothing and stays a fixture.
NOT YET SEEN ON A REAL 2026-27 GAME (the season opens 2 October 2026): shot positions are not
read (the film's coordinate fields, if it has any, are unverified), and team events are skipped
as the scraper skips them. Check the first round before trusting more than the box.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

import requests

from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA, ZoneInfo
from .plk import _group_substitutions, _mmss

API = "https://bnxt.sportpress.info/api/v1"
SITE = "https://bnxtleague.com"
TOKEN = "BWSyE7sgg9QAurh2JX9cpjzjGc652BWLuNUS"
LIVE_GUARD_S = 3 * 3600
FETCH_LEAD_S = 30 * 60
CUP = re.compile(r"super\s*cup|\bcup\b", re.I)
REGULAR = re.compile(r"regular", re.I)
FINISHED = {"finished", "complete", "closed", "played", "confirmed"}
SHOT2 = {1: "jumpshot", 2: "layup", 5: "tipin"}


def _start_year(season) -> int:
    m = re.match(r"(\d{4})", str(season or ""))
    if m:
        return int(m.group(1))
    now = time.gmtime()
    return now.tm_year if now.tm_mon >= 8 else now.tm_year - 1


def club_name(name: str) -> str:
    """A play-off entry is the club with " playoff" on it ("Windrose Giants Antwerp playoff")."""
    return re.sub(r"\s+", " ", re.sub(r"\bplayoff\b", "", name or "", flags=re.I)).strip()


def local_to_utc(s: str) -> Optional[str]:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})", str(s or ""))
    if not m or ZoneInfo is None:
        return None
    y, mo, d, h, mi = (int(x) for x in m.groups())
    t = datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("Europe/Brussels"))
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pname(pl: Optional[dict]):
    pl = pl or {}
    return (pl.get("first_name") or "").strip(), (pl.get("last_name") or "").strip()


def raw_from_bnxt(box: list, film: list, finished: bool, meta: Optional[dict] = None) -> Optional[dict]:
    """One game's box + film -> FIBA LiveStats data.json shape (as plk.raw_from_game writes it):
    play-by-play oldest first, actionNumber 1..n, periods opened and closed once each, drawn fouls
    linked, the final whistle on a finished game. None without film or without both clubs."""
    teams = {1 if t.get("is_home") else 2: t for t in box or []}
    if set(teams) != {1, 2} or not film:
        return None
    people: Dict[str, dict] = {}
    tm: Dict[str, dict] = {}
    for tno, t in teams.items():
        pl = {}
        for p in t.get("players") or []:
            pid = str((p.get("player") or {}).get("id") or "")
            if not pid:
                continue
            first, last = _pname(p.get("player"))
            shirt = str(p.get("jersey") if p.get("jersey") is not None else "").strip()
            people[pid] = {"tno": tno, "first": first, "last": last, "shirt": shirt}
            n = lambda k: int(p.get(k) or 0)  # noqa: E731
            pl[pid] = {"firstName": first, "familyName": last, "name": f"{first} {last}".strip(),
                       "internationalFirstName": first, "internationalFamilyName": last,
                       "scoreboardName": f"{first[:1]}. {last}".strip(". "), "shirtNumber": shirt,
                       "playingPosition": ((p.get("position") or {}).get("name") or ""),
                       "starter": 1 if p.get("starter") else 0, "active": 1,
                       "sMinutes": _mmss(n("minute") * 60),
                       "sPoints": n("points"),
                       "sFieldGoalsMade": n("throw_made"), "sFieldGoalsAttempted": n("throw_all"),
                       "sTwoPointersMade": n("two_point_made"), "sTwoPointersAttempted": n("two_point_all"),
                       "sThreePointersMade": n("three_point_made"), "sThreePointersAttempted": n("three_point_all"),
                       "sFreeThrowsMade": n("free_throw_made"), "sFreeThrowsAttempted": n("free_throw_all"),
                       "sReboundsOffensive": n("offensive_rebound"), "sReboundsDefensive": n("defensive_rebound"),
                       "sReboundsTotal": n("total_rebound"), "sAssists": n("assist"), "sTurnovers": n("turnover"),
                       "sSteals": n("steal"), "sBlocks": n("block"), "sBlocksReceived": n("block_against"),
                       "sFoulsPersonal": n("foul"), "sFoulsOn": n("defensive_foul"),
                       "sFoulsTechnical": 0, "sFoulsUnsportsmanlike": 0, "sFoulsDisqualifying": 0,
                       "sPlusMinusPoints": n("plusminus"),
                       "sPointsSecondChance": 0, "sPointsFastBreak": 0, "sPointsFromTurnovers": 0, "sPointsInThePaint": 0}
        tot = {}
        for k in ("sPoints", "sFieldGoalsMade", "sFieldGoalsAttempted", "sTwoPointersMade", "sTwoPointersAttempted",
                  "sThreePointersMade", "sThreePointersAttempted", "sFreeThrowsMade", "sFreeThrowsAttempted",
                  "sReboundsOffensive", "sReboundsDefensive", "sReboundsTotal", "sAssists", "sTurnovers", "sSteals",
                  "sBlocks", "sBlocksReceived", "sFoulsPersonal", "sFoulsOn", "sPlusMinusPoints"):
            tot["tot_" + k] = sum(r[k] for r in pl.values())
        team = t.get("team") or {}
        name = club_name(team.get("name") or "")
        logo = ((team.get("team_logo") or {}).get("public_url") or "").strip()
        tm[str(tno)] = {"name": name, "nameInternational": name, "shortName": (team.get("short_name") or name).strip(),
                        "code": str(team.get("id") or ""), "score": int((t.get("total") or {}).get("points") or tot["tot_sPoints"]),
                        "coachDetails": [], "pl": pl, "shot": [], **tot}
        if logo.startswith("https://"):
            tm[str(tno)]["logoT"] = {"url": logo}
            tm[str(tno)]["logoS"] = {"url": logo}

    score = [0, 0]
    chrono: List[dict] = []
    unknown: List[str] = []
    fouls: List[dict] = []

    def ev(e, tno, pid, action, sub="", success=0, quals=None):
        per = int(e.get("period") or 1)
        plen = 600 if per <= 4 else 300
        left = max(0, plen - (int(e.get("minute") or 0) * 60 + int(e.get("second") or 0)))
        who = people.get(pid, {})
        x = {"actionNumber": 0, "period": per if per <= 4 else per - 4,
             "periodType": "REGULAR" if per <= 4 else "OVERTIME", "gt": f"{left // 60:02d}:{left % 60:02d}",
             "s1": str(score[0]), "s2": str(score[1]), "tno": tno, "pno": pid, "actionType": action, "subType": sub,
             "qualifier": quals or [], "success": 1 if success else 0,
             "scoring": 1 if (action in ("2pt", "3pt", "freethrow") and success) else 0,
             "shirtNumber": who.get("shirt", ""), "firstName": who.get("first", ""), "familyName": who.get("last", ""),
             "player": f"{who.get('first', '')} {who.get('last', '')}".strip() if pid else ""}
        chrono.append(x)
        return x

    for e in sorted(film, key=lambda x: (x.get("order") or 0)):
        code, sub = int(e.get("event_code") or 0), e.get("event_subcode")
        tno = 1 if e.get("is_home") else 2
        pid = str((e.get("player") or {}).get("id") or "")
        if pid and pid in people:
            tno = people[pid]["tno"]
        if code in (1000, 1001):
            if not pid:
                continue
            made = code == 1000
            if sub == 4:
                if made:
                    score[tno - 1] += 1
                ev(e, tno, pid, "freethrow", "", made)
            elif sub == 3:
                if made:
                    score[tno - 1] += 3
                ev(e, tno, pid, "3pt", "jumpshot", made)
            else:
                if made:
                    score[tno - 1] += 2
                ev(e, tno, pid, "2pt", SHOT2.get(sub, "jumpshot"), made)
        elif code in (1002, 1003):
            ev(e, tno, pid, "rebound", "defensive" if code == 1002 else "offensive", quals=[] if pid else ["team"])
        elif code == 1004 and pid:
            ev(e, tno, pid, "steal")
        elif code == 1005:
            ev(e, tno, pid, "turnover", "", quals=[] if pid else ["team"])
        elif code == 1007 and pid:
            fouls.append(ev(e, tno, pid, "foul", "personal"))
        elif code == 1006 and pid:
            f = ev(e, tno, pid, "foulon")
            f["_drawn"] = True
        elif code == 1008 and pid:
            ev(e, tno, pid, "assist")
        elif code == 1009 and pid:
            ev(e, tno, pid, "block")
        elif code == 1011:
            out_pid = str((e.get("player2") or {}).get("id") or "")
            if out_pid:
                ev(e, people.get(out_pid, {}).get("tno", tno), out_pid, "substitution", "out")
            if pid:
                ev(e, tno, pid, "substitution", "in")
        elif code >= 1100 and not pid:
            continue                             # team/period markers: periods are written below
        else:
            unknown.append(f"{code}/{sub}")      # never guessed: reported, and left out

    # free throws: 1of2, 2of2 ... by shooter and clock
    trips: Dict[tuple, List[dict]] = {}
    for x in chrono:
        if x["actionType"] == "freethrow":
            trips.setdefault((x["pno"], x["period"], x["periodType"], x["gt"]), []).append(x)
    for fts in trips.values():
        for i, x in enumerate(fts, start=1):
            x["subType"] = f"{i}of{len(fts)}"
    chrono = _group_substitutions(chrono)

    def qnum(x):
        return x["period"] + (4 if x["periodType"] == "OVERTIME" else 0)

    last_q = max((qnum(x) for x in chrono), default=1)
    by_q: Dict[int, List[dict]] = {}
    for x in chrono:
        by_q.setdefault(qnum(x), []).append(x)
    cur = ["0", "0"]

    def marker(q, action, subtype, clock):
        return {"actionNumber": 0, "period": q if q <= 4 else q - 4, "periodType": "REGULAR" if q <= 4 else "OVERTIME",
                "gt": clock, "s1": cur[0], "s2": cur[1], "tno": 0, "pno": "", "actionType": action, "subType": subtype,
                "qualifier": [], "success": 0, "scoring": 0, "shirtNumber": "", "firstName": "", "familyName": "", "player": ""}

    events: List[dict] = []
    for q in range(1, last_q + 1):
        events.append(marker(q, "period", "start", "10:00" if q <= 4 else "05:00"))
        for x in by_q.get(q, []):
            events.append(x)
            cur = [x["s1"], x["s2"]]
        if q < last_q or finished:
            events.append(marker(q, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for i, x in enumerate(events, start=1):
        x["actionNumber"] = i
    # a drawn foul points at the other side's foul at the same clock - the one just before, else after
    for i, x in enumerate(events):
        if not x.pop("_drawn", False):
            continue
        cands = [j for j, y in enumerate(events) if y["actionType"] == "foul" and y["tno"] == 3 - x["tno"]
                 and y["period"] == x["period"] and y["periodType"] == x["periodType"] and y["gt"] == x["gt"]]
        before = [j for j in cands if j < i]
        after = [j for j in cands if j > i]
        j = before[-1] if before else (after[0] if after else None)
        if j is not None:
            x["previousAction"] = events[j]["actionNumber"]
    for s in ("1", "2"):
        tm[s]["full_score"] = tm[s]["score"]
        tm[s]["ot_score"] = 0
    last_play = next((x for x in reversed(events) if x["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q, "periodType": "REGULAR" if last_q <= 4 else "OVERTIME",
           "inOT": 1 if last_q > 4 else 0,
           "clock": "00:00" if finished else (last_play["gt"] if last_play else "10:00"),
           "bnxt": {**(meta or {}), "unknown": sorted(set(unknown))}}
    return raw


class BnxtAdapter(FibaLiveStatsAdapter):
    """BNXT League. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "bnxt"
    min_request_gap_s = 1.0
    _token = TOKEN
    _games: dict = {}          # game id -> competition id, from discovery
    _last: float = 0.0

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"bnxt: stage must be 'regular' or 'playoffs', not {stage!r}")
        season = _start_year(config.get("season")) + 1         # the API's end-year season
        match = re.compile(config.get("phase_match") or ("regular" if stage == "regular" else "playoff"), re.I)
        blocks = self._get(f"/phase/season/{season}") or []
        out, seen = [], set()
        now = datetime.now(timezone.utc)
        for block in blocks:
            comp_id = str((block.get("competition") or {}).get("id") or "")
            for ph in block.get("phases") or []:
                name = ph.get("name") or ""
                if CUP.search(name) or not match.search(name):
                    continue
                for g in self._get(f"/schedule/club/{season}", {"clubs[0]": 1, "clubs[1]": 2,
                                                                  "phase_id": ph["id"], "month": -1}) or []:
                    gid = str(g.get("id") or "")
                    if not gid or gid in seen:
                        continue
                    seen.add(gid)
                    comps = sorted(g.get("competitors") or [], key=lambda c: c.get("side") or 9)
                    if len(comps) != 2:
                        continue
                    BnxtAdapter._games[gid] = comp_id
                    tip = local_to_utc(g.get("game_time"))
                    st = (g.get("status") or "").lower()
                    status = "final" if st in FINISHED else "scheduled"
                    if status == "scheduled" and tip:
                        t = datetime.fromisoformat(tip.replace("Z", "+00:00"))
                        if t <= now and (now - t).total_seconds() < LIVE_GUARD_S:
                            status = "live"
                    ct = [c.get("competition_team") or {} for c in comps]
                    logo = lambda t: ((t.get("team_logo") or {}).get("public_url") or None)  # noqa: E731
                    out.append(ScheduleGame(
                        external_id=gid, home_name=club_name(ct[0].get("name")), away_name=club_name(ct[1].get("name")),
                        tipoff_at=tip, status=status,
                        extra={"home_code": str(ct[0].get("id") or ""), "away_code": str(ct[1].get("id") or ""),
                               "home_logo": logo(ct[0]), "away_logo": logo(ct[1]),
                               "venue": ((g.get("arena") or {}).get("name") or None), "round": name.strip(),
                               "stage": "regular" if REGULAR.search(name) else "playoffs"}))
        print(f"     BNXT {season - 1}/{season} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit() or self._too_early(config.get("_tipoff_at")):
            return None
        info = self._get(f"/schedule/find/{gid}") or {}
        comp_id = str((info.get("competition") or {}).get("id") or BnxtAdapter._games.get(gid) or "")
        if not comp_id:
            return None
        film = self._get(f"/film/game/{comp_id}/{gid}") or []
        if not film:
            return None                          # not started, or purged: nothing to show but the fixture
        box = self._get(f"/boxscore/game/{comp_id}/{gid}") or []
        finished = (info.get("status") or "").lower() in FINISHED
        raw = raw_from_bnxt(box, film, finished, {"gameId": gid, "competition": comp_id,
                                                  "date": local_to_utc(info.get("game_time"))})
        if raw is None:
            return None
        if raw["bnxt"]["unknown"]:
            print(f"     BNXT {gid}: event codes the adapter does not know, left out: {raw['bnxt']['unknown'][:6]}")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = config.get("_tipoff_at") or raw["bnxt"]["date"]
        return b

    @staticmethod
    def _too_early(tip, now: Optional[datetime] = None) -> bool:
        try:
            t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
        except ValueError:
            return False
        if t is None:
            return False
        return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S

    # ------------------------------------------------------------------ plumbing
    def _headers(self):
        return {"User-Agent": UA, "Accept": "application/json", "Origin": SITE, "Referer": SITE + "/",
                "X-Authorization": BnxtAdapter._token, "X-Localization": "en"}

    def _refresh_token(self) -> bool:
        """The token the site's own app script sends, re-read when the stored one is refused."""
        try:
            page = requests.get(SITE + "/", headers={"User-Agent": UA}, timeout=30).text
            js = re.search(r'src="(/js/app\.[0-9a-f]+\.js)"', page)
            if not js:
                return False
            src = requests.get(SITE + js.group(1), headers={"User-Agent": UA}, timeout=30).text
            m = re.search(r'\["X-Authorization"\]="([A-Za-z0-9]+)"', src)
            if m and m.group(1) != BnxtAdapter._token:
                BnxtAdapter._token = m.group(1)
                return True
        except requests.RequestException:
            pass
        return False

    def _get(self, path: str, params: Optional[dict] = None):
        for attempt in range(3):
            gap = time.time() - BnxtAdapter._last
            if gap < self.min_request_gap_s:
                time.sleep(self.min_request_gap_s - gap)
            BnxtAdapter._last = time.time()
            try:
                r = requests.get(f"{API}{path}", headers=self._headers(), params={**(params or {}), "lang": "en"}, timeout=60)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code in (401, 403) and attempt == 0 and self._refresh_token():
                continue
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                try:
                    return r.json().get("data")
                except ValueError:
                    return None
            time.sleep(1.5 * (attempt + 1))
        return None
