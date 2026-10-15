"""Hungary's NB I/A, men and women (MKOSZ), translated into the shape the platform already reads.

TWO HOSTS, PLAIN `requests`, NO KEY. The federation (MKOSZ) runs both leagues on one system, written by
webpont.com, which also serves the "netcasting" live page every game centre links to:

    https://mkosz.hu/bajnoksag-musor/<season>/<nat>/        every game of one competition and season, one page
    https://netcasting4.webpont.com/storage/full<code>.html  one game: rosters, minutes and the whole event log

hunbasket.hu (the league's own site) shows only the last and the next round, and its "bajnoksag-musor"
link is a 404; the federation's site, mkosz.hu, still serves the full programme at that address - but
only WITH the trailing slash (without it, a 500). Neither host has a robots.txt.

THE ADDRESSES. A season is "x" + its two years (x2627 = 2026-27, the season selector's own values, back to
x0809). A competition is a "nat": hun the men's regular season, hun_ply its play-offs ("rájátszás az 1-8.
helyért"), hun_plo its play-out; whun the women's, whun_ply and whun_plya (play-out) theirs. A game is
<nat>_<number> (hun_134745, whun_135517, hun_ply_134267) - THE SAME KEY on the schedule's result link
(/merkozes/x2627/hun/hun_134745), on the game centre, and on the netcasting page (?hun_134745), so the
schedule gives the feed's address straight away: no game-centre hop.

THE GAME FEED IS JSON IN DISGUISE. The netcasting page draws its box score in the browser from
/storage/full<code>.html, a JSON document with its punctuation swapped to save bytes: '#' for '","',
'|' for '":"', '%' for '"},{"' (the page's own jsonDecode, undone the same way here). Its tweets are cut
off first: they are the one part written by the public, the one most likely to break the decoding, and
nothing here reads them. In it:
  i        the game: hid/aid (the clubs' federation ids, which are also their codes), h/a (full names),
           h2/a2 (shouted short names), hp/vp (the score), arena, date, round
  p        the rosters, {code: "starter:shirt:short name:SECONDS PLAYED:home"} - "A441829":
           "0:0:Pierre-Louis&nbsp;J.:1181:1" is a home bench player who played 19:41. The players' codes
           (A... men, B... women) are the federation's, and the box score's rows are keyed on them
  players  {home, away: [{Jatekos: code, nev: "PIERRE-LOUIS&nbsp;Josh" (family name, then given), mez}]}
  f        the event log, oldest first - see below
  jr       2 = over (0 not started)

THERE IS NO BOX SCORE IN THE FEED: the page counts every column from the event log, as this does, so the
two cannot disagree. Only the minutes come ready-made (p's seconds), and they are the console's own count.

THE EVENT LOG. Each event: '1' the side ("1" home, "0" away), '2' a code, '3'/'4' the player(s), 'gt' the
GAME TIME ELAPSED in seconds from the opening tip (600 = end of the first quarter, 2400 = end of the
fourth; the page prints it per quarter, "Q4 09:58" being 9:58 played in the fourth - elapsed, not left),
and on a shot '4'/'5' its place and '6' its kind. The codes, as the page's own tables name them:

    1000 / 1001  made / missed ("Sikeres" / "Kihagyott"), '6' = 1 close ("közeli"), 2 mid-range
                 ("középtávoli"), 3 three ("hárompontos"), 4 free throw ("büntető"), 5 dunk ("zsákolás")
    1002 / 1003  defensive / offensive rebound ("Védőlepattanó" / "Támadólepattanó")
    1004 steal ("Szerzett labda")   1005 turnover ("Eladott labda")   1008 assist ("Gólpassz")
    1006 foul drawn ("Kiharcolt fault")   1007 foul ("Fault")   1020 technical ("Technikai fault")
    1009 block ("Blokk")   1010 block received ("Kapott blokk")
    1011 substitution ("A <--> B"): '3' COMES ON, '4' GOES OFF - checked against the minutes: replayed
         that way, every player of four games comes to his p seconds exactly; the other way round, 19 to 23
         players a game are minutes out
    2002 / 2003 / 2005  the club's own rebound (def / off) and turnover; 2004 / 2006 its steal / foul drawn;
         2007 a foul on the club (no player); 2020 a bench technical; 2011 a time-out ("Időkérés")
    1101 end of a period ("Vége a játékrésznek") - sometimes twice at the final buzzer
    1102 start of a period (not every game has them)   1100 a minute gone   6001 the clock
    2 a player on the roster   9999 written before each substitution   2000 a minutes list - none of
    these is a play

A close shot is NOT called a lay-up here: 331 "közeli" attempts in five games ran from the rim out to
6 m (131 of them inside 1.25 m), so "close" says less than its place does, and its place is known.

THE CLOCK, AND WHICH PERIOD A PLAY BELONGS TO. gt is elapsed game time, so the clock FIBA wants (time
REMAINING in the period, "MM:SS") is the period's end minus gt. Quarters are 600 s, overtimes 300 s. A
play at a period's boundary (gt 600) is the old period's last second until that period's end (1101) has
been read, and the new period's first after it: the changes made in the break are written after the
1101 at the same gt, and they are the next period's 10:00, where FIBA puts them. Once a final game's
last 1101 is read nothing after it is a change - the operator takes everybody off after the buzzer, and
replayed the game would end with nobody on court (as on the KBL).

THE SHOT CHART is the full court, 360 x 240 pixels for 28 x 15 m: the dunks sit at (19, 119), the rim
being 1.575 m in (20.25 px); with that frame 663 of 664 attempts in five games fall on their own side of
FIBA's line (twos to 6.61 m, threes from 6.59 m - one corner three, where the line is 6.60 m). So a place
is simply x/360, y/240 of FIBA's chart. A shot at (0, 0) has no place (every free throw, some others).

A LOG THAT LOST ITS SUBSTITUTIONS. The season's opening game (hun_134745, Szolnok 104-93 OSE Lions) has
second-quarter changes missing from its log: players act for minutes after the log took them off, and
later changes take off players who were never on. The p seconds are right (the console counted them
itself), so replaying the log gives Goodwin 10:57 against his 22:10. A final game whose log cannot
reproduce its own minutes (to two seconds) is published as a result - box, score and quarters, no event
log and no lineups (translate False, as ncaa.py and lkl.py do with a log that cannot stand) - rather than
as lineups that never played.

...AND IS REBUILT (2026-10-16). Four of the season's openers (hun_134745, hun_134747, whun_135471,
whun_135473) have such logs, and their console minutes cannot be the target: they add up to 228:37,
212:27, 209:20... a side, more than five players can play in 40 minutes. What the log still tells is who
acts when, so rebuild() reads the changes leniently and keeps each side at five: an impossible half is
dropped, a side left with four is joined by the next of its players to act while off, a side left with
six loses the one who does nothing until he is next put on. Every rebuilt game is five a side for all
2400 seconds and 200:00 a side, and is published with its log and lineups - the minutes of the broken
stretch an estimate, the rest the log's own. A clean log is never rebuilt (replay finds nothing wrong);
a log that cannot be rebuilt (a side with no player left to come on) is still published as a result.
"""
from __future__ import annotations

import html as _html
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, ZoneInfo

import names as N                       # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

SITE = "https://mkosz.hu"
SCHEDULE = SITE + "/bajnoksag-musor/{season}/{nat}/"     # the trailing slash matters: without it, a 500
NETCASTING = "https://netcasting4.webpont.com"
FEED = "{host}/storage/full{code}.html"
LOGO = "https://hunbasketimg.webpont.com/art/logo/{season}-{club}.gif"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
TZ = "Europe/Budapest"

#: a stage's competition when the source row names none ("nat" in adapter_config wins)
STAGE_NAT = {("men", "regular"): "hun", ("men", "playoffs"): "hun_ply", ("men", "playout"): "hun_plo",
             ("women", "regular"): "whun", ("women", "playoffs"): "whun_ply", ("women", "playout"): "whun_plya"}

MONTHS = {"január": 1, "február": 2, "március": 3, "április": 4, "május": 5, "június": 6, "július": 7,
          "augusztus": 8, "szeptember": 9, "október": 10, "november": 11, "december": 12}

QUARTER_S, OT_S, QUARTERS = 600, 300, 4

#: a shot's kind ('6') -> (FIBA actionType, subType)
SHOT_KIND = {1: ("2pt", None), 2: ("2pt", "jumpshot"), 3: ("3pt", "jumpshot"), 4: ("freethrow", None),
             5: ("2pt", "dunk")}
SHOT_POINTS = {1: 2, 2: 2, 3: 3, 4: 1, 5: 2}
#: a play's code -> (actionType, subType, a club's own event)
ACTIONS = {
    1002: ("rebound", "defensive", False), 1003: ("rebound", "offensive", False),
    1004: ("steal", None, False), 1005: ("turnover", None, False), 1008: ("assist", None, False),
    1009: ("block", None, False), 1007: ("foul", "personal", False), 1020: ("foul", "technical", False),
    2002: ("rebound", "defensive", True), 2003: ("rebound", "offensive", True), 2005: ("turnover", None, True),
    2007: ("foul", "personal", True), 2020: ("foul", "benchtechnical", True), 2011: ("timeout", None, True),
}
FOULS = (1007, 1020)
#: codes that are not plays (see the docstring)
NOT_PLAYS = (1, 2, 1100, 1102, 6001, 9999, 2000, 1010, 2004, 2006)
#: per-player box columns, from the codes that count them
COUNT = {1002: ("sReboundsDefensive",), 1003: ("sReboundsOffensive",), 1004: ("sSteals",), 1005: ("sTurnovers",),
         1006: ("sFoulsOn",), 1007: ("sFoulsPersonal",), 1020: ("sFoulsPersonal",), 1008: ("sAssists",),
         1009: ("sBlocks",), 1010: ("sBlocksReceived",)}

CHART_W, CHART_H = 360.0, 240.0


# ------------------------------------------------------------------ small helpers ---
def season_token(config: dict) -> str:
    """'2026-27', '2026/27', '2026' or 'x2627' -> 'x2627'; none -> the season being played (from August)."""
    s = str((config or {}).get("season") or "").strip().lower()
    m = re.fullmatch(r"x(\d{2})(\d{2})", s)
    if m:
        return s
    m = re.search(r"(\d{4})", s)
    if m:
        y = int(m.group(1))
    else:
        now = datetime.now(timezone.utc)
        y = now.year if now.month >= 8 else now.year - 1
    return f"x{y % 100:02d}{(y + 1) % 100:02d}"


def season_name(token: str) -> str:
    m = re.fullmatch(r"x(\d{2})(\d{2})", str(token or ""))
    return f"20{m.group(1)}-{m.group(2)}" if m else ""


def nat_of(config: dict) -> str:
    c = config or {}
    if c.get("nat"):
        return str(c["nat"]).strip().lower()
    return STAGE_NAT.get((str(c.get("gender") or "men").lower(), str(c.get("stage") or "regular").lower()), "hun")


def decode(text) -> Optional[dict]:
    """The netcasting storage file -> its JSON (the page's own jsonDecode; the tweets cut off first)."""
    if not text:
        return None
    s = text if isinstance(text, str) else text.decode("utf-8", "replace")
    cut = s.find('"twitter"')
    if cut > 0:
        s = s[:cut].rstrip().rstrip(",").rstrip("#") + "}"
    s = s.replace("#", '","').replace("|", '":"').replace("%", '"},{"')
    try:
        d = json.loads(s)
    except ValueError:
        return None
    return d if isinstance(d, dict) and isinstance(d.get("i"), dict) else None


def unescape(s) -> str:
    return re.sub(r"\s+", " ", _html.unescape(str(s or "")).replace("\xa0", " ")).strip()


def tipoff(year, month, day, hh=None, mm=None) -> Optional[str]:
    """A Budapest date and time -> ISO UTC. No time on the page: local noon, as kbl.py does."""
    try:
        y, mo, d = int(year), int(month), int(day)
        h, mi = (int(hh), int(mm)) if hh is not None and mm is not None else (12, 0)
        local = datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(TZ)) if ZoneInfo else \
            datetime(y, mo, d, h, mi, tzinfo=timezone(timedelta(hours=1)))
    except (TypeError, ValueError):
        return None
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def period_bounds(p: int) -> tuple[int, int]:
    """(start, end) of period p in elapsed game seconds."""
    if p <= QUARTERS:
        return (p - 1) * QUARTER_S, p * QUARTER_S
    s = QUARTERS * QUARTER_S + (p - QUARTERS - 1) * OT_S
    return s, s + OT_S


def period_at(g: int, closed: set) -> int:
    """The period a play at elapsed second g belongs to: at a boundary, the old period until its end has
    been read, the new one after (see the docstring)."""
    p = 1
    while p < 30:
        _, e = period_bounds(p)
        if g < e:
            return p
        if g == e:
            return p + 1 if p in closed else p
        p += 1
    return p


def ended_period(g: int) -> Optional[int]:
    """The period whose end is elapsed second g, if g is one."""
    p = 1
    while p < 30:
        _, e = period_bounds(p)
        if e == g:
            return p
        if e > g:
            return None
        p += 1
    return None


def clock_left(g: int, p: int) -> str:
    s, e = period_bounds(p)
    left = max(0, min(e - s, e - g))
    return f"{left // 60:02d}:{left % 60:02d}"


def mmss(secs) -> str:
    s = int(S.num(secs))
    return f"{s // 60}:{s % 60:02d}"


def _code(e: dict) -> int:
    return int(S.num(e.get("2")))


def _gt(e: dict) -> int:
    return int(S.num(e.get("gt")))


def _who(e: dict, k: str = "3") -> str:
    return str(e.get(k) or "").strip()


def roster(d: dict) -> dict:
    """{code: {starter, shirt, short, secs, tno}} from the feed's p."""
    out = {}
    for code, val in (d.get("p") or {}).items():
        parts = str(val or "").split(":")
        if len(parts) < 5:
            continue
        out[str(code).strip()] = {"starter": parts[0] == "1", "shirt": parts[1].strip(),
                                  "short": unescape(":".join(parts[2:-2])), "secs": int(S.num(parts[-2])),
                                  "tno": 1 if parts[-1].strip() == "1" else 2}
    return out


def full_names(d: dict) -> dict:
    """{code: (given, family, photo)} from the feed's players list ("FAMILY&nbsp;Given")."""
    out = {}
    for side in ("home", "away"):
        for r in ((d.get("players") or {}).get(side) or []):
            if not isinstance(r, dict):
                continue
            nev = str(r.get("nev") or "")
            if "&nbsp;" in nev:
                family, _, given = nev.partition("&nbsp;")
            else:
                family, _, given = nev.strip().partition(" ")
            img = str(r.get("image") or "").strip()
            if img.startswith("http://"):
                img = "https://" + img[len("http://"):]
            out[str(r.get("Jatekos") or "").strip()] = (unescape(given), unescape(family), img or None)
    return out


def final_end(rows: list, final: bool) -> Optional[int]:
    """Index of a finished game's last period end - after which no change counts."""
    if not final:
        return None
    ends = [j for j, e in enumerate(rows) if _code(e) == 1101]
    return ends[-1] if ends else None


def rebuild(d: dict) -> Optional[dict]:
    """A log that lost its changes, read as the floor it can only have been (module docstring): {row index
    of a change: [(on, off), ...]} with every half possible, and how many places it had to repair - or None
    when even that leaves a side other than five (no player left to come on), or one change uneven.

    Read leniently: an ON for a player already on, and an OFF for one not on, are the lost halves' traces
    and are dropped. A side left with four at a change was joined, at that change, by the next of its
    players to act while off; a side left with six lost, at that change, the one who does nothing until he
    is next put on (or never acts again) - the player the log forgot to take off."""
    ros = roster(d)
    rows = [e for e in (d.get("f") or []) if isinstance(e, dict)]
    last = final_end(rows, str(d.get("jr")) == "2")
    ev = []                                  # ("sub", tno, j, on, off) / ("act", tno, who), in log order
    for j, e in enumerate(rows):
        c, tno = _code(e), 1 if str(e.get("1")) == "1" else 2
        if c == 1011:
            if last is None or j <= last:
                ev.append(("sub", tno, j, _who(e, "3"), _who(e, "4")))
        elif c not in (2, 1101):             # anything a player of the side is named for, bar the roster rows
            w = _who(e)
            if w in ros and ros[w]["tno"] == tno:
                ev.append(("act", tno, w))
    on = {t: {c for c, r in ros.items() if r["starter"] and r["tno"] == t} for t in (1, 2)}
    if any(len(s) != 5 for s in on.values()):
        return None
    subs, fixes = {}, 0

    def seen_next(k, t, p):
        """the next thing the log says of p after event k: ("act",...) or the change that names him"""
        return next((x for x in ev[k + 1:] if x[1] == t and ((x[0] == "act" and x[2] == p)
                                                           or (x[0] == "sub" and p in (x[3], x[4])))), None)

    for k, x in enumerate(ev):
        if x[0] != "sub":
            continue
        _, t, j, i, o = x
        o_ok, i_ok = o in on[t], bool(i) and i not in on[t]
        here = subs.setdefault(j, [])
        if o_ok:
            on[t].discard(o)
        if i_ok:
            on[t].add(i)
        if o_ok or i_ok:
            here.append((i if i_ok else "", o if o_ok else ""))
        fixes += not (o_ok and i_ok)
        while len(on[t]) < 5:
            a = next((y for y in ev[k + 1:] if y[0] == "act" and y[1] == t and y[2] not in on[t]), None)
            if not a:
                return None
            on[t].add(a[2]); here.append((a[2], "")); fixes += 1
        while len(on[t]) > 5:
            idle = [p for p in sorted(on[t]) if p != i and (lambda n: n is None or (n[0] == "sub" and n[3] == p))(seen_next(k, t, p))]
            p = (idle or sorted(p for p in on[t] if p != i))[0]
            on[t].discard(p); here.append(("", p)); fixes += 1
        if sum(bool(a) for a, _ in here) != sum(bool(b) for _, b in here):
            return None                      # the translation pairs a change's halves: an odd one would be lost
    return {"subs": subs, "fixes": fixes}


def replay(d: dict) -> dict:
    """The floor, replayed from the log the way the translation reads it: each player's seconds, his
    plus/minus, and the contradictions (a change taking off a player not on, or putting on one already on).
    A log with contradictions is replayed as rebuild() reads it, its changes under "subs"."""
    ros = roster(d)
    rows = [e for e in (d.get("f") or []) if isinstance(e, dict)]
    last = final_end(rows, str(d.get("jr")) == "2")

    def run(fixed):
        on = {1: {c for c, r in ros.items() if r["starter"] and r["tno"] == 1},
              2: {c for c, r in ros.items() if r["starter"] and r["tno"] == 2}}
        since = {c: 0 for side in on.values() for c in side}
        played, pm, bad = {}, {c: 0 for c in ros}, 0
        end = max([_gt(e) for e in rows] or [0])
        for j, e in enumerate(rows):
            c = _code(e)
            tno = 1 if str(e.get("1")) == "1" else 2
            if c == 1011:
                if last is not None and j > last:
                    continue
                i, o = _who(e, "3"), _who(e, "4")
                if o not in on[tno] or i in on[tno]:
                    bad += 1
                for i, o in (fixed.get(j, []) if fixed is not None else [(i, o)]):
                    if o in since:
                        played[o] = played.get(o, 0) + _gt(e) - since.pop(o)
                    on[tno].discard(o)
                    if i and i not in on[tno]:
                        on[tno].add(i)
                        since[i] = _gt(e)
            elif c == 1000:
                pts = SHOT_POINTS.get(int(S.num(e.get("6"))), 0)
                for p in on[tno]:
                    pm[p] = pm.get(p, 0) + pts
                for p in on[3 - tno]:
                    pm[p] = pm.get(p, 0) - pts
        for c, t0 in since.items():
            played[c] = played.get(c, 0) + end - t0
        return {"played": played, "pm": pm, "bad": bad, "end": end}

    rp = run(None)
    if rp["bad"]:
        rb = rebuild(d)
        if rb:
            bad = rp["bad"]
            rp = run(rb["subs"])
            rp.update(bad=bad, subs=rb["subs"], repaired=rb["fixes"])
    return rp


def schedule_rows(page: str, season: str, nat: str) -> list:
    """The programme page -> [{code, home, away, home_id, away_id, date, time, score, venue}]."""
    if not page:
        return []
    m = re.search(r'id="year"\s+value="([^"]*)"', page)
    if m and m.group(1) != season:
        return []                              # the site answered with another season: never file it under this one
    out = []
    for ch in page.split("<tr>"):
        teams = re.findall(r'/csapat/[^/"]+/[^/"]+/(\d+)/[^"]*"\s+title="([^"]*)"', ch)
        game = re.search(r'/merkozes/([^/"]+)/([^/"]+)/([a-z0-9_]+)"\s*>\s*([^<]*?)\s*</a>', ch)
        if len(teams) < 2 or not game or game.group(2) != nat or game.group(1) != season:
            continue
        dt = re.search(r"<b>\s*(\d{4})\.\s*([^\s\d<]+)\s+(\d{1,2})\.\s*</b>", ch)
        tm = re.search(r">\s*(\d{1,2}):(\d{2})\s*<", ch)
        sc = re.fullmatch(r"(\d+)\s*-\s*(\d+)", game.group(4).strip())
        venue = re.search(r'non-breaking"\s+title="([^"]*)"', ch)
        out.append({"code": game.group(3), "home_id": teams[0][0], "home": unescape(teams[0][1]),
                    "away_id": teams[1][0], "away": unescape(teams[1][1]),
                    "date": (dt.group(1), MONTHS.get(dt.group(2).lower()), dt.group(3)) if dt else None,
                    "time": (tm.group(1), tm.group(2)) if tm else None,
                    "score": (int(sc.group(1)), int(sc.group(2))) if sc else None,
                    "venue": unescape(venue.group(1)) if venue else None})
    return out


def status_of(tip: Optional[str], score, now: Optional[datetime] = None) -> str:
    """From the programme: a played game shows its score, one to come "0 - 0"."""
    now = now or datetime.now(timezone.utc)
    t = datetime.fromisoformat(tip.replace("Z", "+00:00")) if tip else None
    if t and t > now:
        return "scheduled"
    played = bool(score) and score != (0, 0)
    if t and now - t < timedelta(hours=3):
        return "live"
    return "final" if played else "scheduled"


class MkoszAdapter(FibaLiveStatsAdapter):
    name = "mkosz"
    min_request_gap_s = 0.5

    def _get(self, url: str) -> Optional[str]:
        """One GET (polite.py paces the host); None on a 404 or after three tries."""
        for attempt in range(3):
            gap = time.time() - getattr(self, "_last", 0.0)
            if gap < self.min_request_gap_s:
                time.sleep(self.min_request_gap_s - gap)
            self._last = time.time()
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=40)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                r.encoding = "utf-8"
                return r.text
            if r is not None and r.status_code == 429:
                return None                   # polite.py has the host cooling down: not this pass
            time.sleep(1.5 * (attempt + 1))
        return None

    # ----------------------------------------------------------------- schedule ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season, nat = season_token(config), nat_of(config)
        rows = schedule_rows(self._get(SCHEDULE.format(season=season, nat=nat)) or "", season, nat)
        stage = str((config or {}).get("stage") or "regular").lower()
        out = []
        for r in rows:
            tip = tipoff(*r["date"], *(r["time"] or (None, None))) if r["date"] and r["date"][1] else None
            out.append(ScheduleGame(
                external_id=r["code"], home_name=r["home"], away_name=r["away"], tipoff_at=tip,
                status=status_of(tip, r["score"]),
                extra={"home_code": r["home_id"], "away_code": r["away_id"],
                       "home_logo": LOGO.format(season=season, club=r["home_id"]),
                       "away_logo": LOGO.format(season=season, club=r["away_id"]),
                       "venue": r["venue"] or None, "stage": stage, "nat": nat}))
        print(f"     MKOSZ {nat} {season_name(season)}: {len(out)} games ({sum(1 for g in out if g.status == 'final')} final)")
        self.last_competitions = []
        return out

    # --------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        code = str(external_id).strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_]*_\d+", code):
            return None
        tip = (config or {}).get("_tipoff_at")
        if tip:
            try:
                if datetime.fromisoformat(str(tip).replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(minutes=10):
                    return None               # not tipped off: no request at all
            except ValueError:
                pass
        d = decode(self._get(FEED.format(host=(config or {}).get("netcasting") or NETCASTING, code=code)))
        if not d or not self.started(d):
            return None
        raw = self.translate(d, code, season_token(config) if (config or {}).get("season") else None)
        b = self.bundle_from_raw(raw, code, config)
        b.tipoff_at = tip or raw["mkosz"].get("tipoff_at")
        b.venue = raw["mkosz"].get("arena") or None
        if b.status == "final" and not raw["mkosz"]["log_ok"]:
            print(f"     MKOSZ {code}: {raw['mkosz']['why']} - published as a result (box and score, no event log)")
            b.translate = False
            b.stints, b.lineups = [], {}
        return b

    @staticmethod
    def started(d: dict) -> bool:
        """Anything played yet: a finished game, or a play past the rosters and the clock."""
        if str(d.get("jr")) == "2":
            return True
        return any(_code(e) not in NOT_PLAYS + (1101,) for e in d.get("f") or [] if isinstance(e, dict))

    @staticmethod
    def translate(d: dict, code: str = "", season: Optional[str] = None) -> dict:
        """The netcasting feed -> the FIBA data.json shape (fibashape)."""
        info = d.get("i") or {}
        ros, names = roster(d), full_names(d)
        final = str(d.get("jr")) == "2"
        rows = [e for e in (d.get("f") or []) if isinstance(e, dict)]
        if not season:
            ts = ((d.get("team_standings") or {}).get("home_team") or [{}])
            season = str((ts[0] if ts else {}).get("year") or "")
            if not re.fullmatch(r"x\d{4}", season):
                dm = re.match(r"(\d{4})-(\d{2})", str(info.get("date") or ""))
                season = season_token({"season": str(int(dm.group(1)) - (int(dm.group(2)) < 8))}) if dm else ""
        rp = replay(d)
        pbp, shots, by_period = MkoszAdapter.events(d, rp.get("subs"))

        # the box, counted from the log as the page counts it
        stats = {c: {k: 0 for k in S.STATS} for c in ros}
        team_extra = {1: {"sReboundsOffensive": 0, "sReboundsDefensive": 0, "sTurnovers": 0},
                      2: {"sReboundsOffensive": 0, "sReboundsDefensive": 0, "sTurnovers": 0}}
        for e in rows:
            c, who = _code(e), _who(e)
            tno = 1 if str(e.get("1")) == "1" else 2
            if c in (1000, 1001) and who in stats:
                kind, made = int(S.num(e.get("6"))), c == 1000
                st = stats[who]
                if kind == 4:
                    st["sFreeThrowsAttempted"] += 1; st["sFreeThrowsMade"] += made
                elif kind in SHOT_KIND:
                    three = kind == 3
                    st["sThreePointersAttempted" if three else "sTwoPointersAttempted"] += 1
                    st["sThreePointersMade" if three else "sTwoPointersMade"] += made
                    st["sFieldGoalsAttempted"] += 1; st["sFieldGoalsMade"] += made
                st["sPoints"] += SHOT_POINTS.get(kind, 0) if made else 0
            elif c in COUNT and who in stats:
                for k in COUNT[c]:
                    stats[who][k] += 1
            elif c in (2002, 2003, 2005):
                team_extra[tno][{2002: "sReboundsDefensive", 2003: "sReboundsOffensive", 2005: "sTurnovers"}[c]] += 1
        for st in stats.values():
            st["sReboundsTotal"] = st["sReboundsOffensive"] + st["sReboundsDefensive"]
        players = {1: {}, 2: {}}
        for c, r in ros.items():
            st = dict(stats[c])
            st["sPlusMinusPoints"] = rp["pm"].get(c, 0)
            given, family, photo = names.get(c, ("", "", None))
            if not family:
                family = r["short"].rsplit(" ", 1)[0] if re.search(r" \w\.$", r["short"]) else r["short"]
            played = r["secs"] > 0 or any(st[k] for k in ("sPoints", "sFieldGoalsAttempted", "sFreeThrowsAttempted",
                                                        "sReboundsTotal", "sAssists", "sFoulsPersonal", "sTurnovers"))
            p = S.player(given, family, shirt=r["shirt"], starter=1 if r["starter"] else 0,
                         active=1 if played else 0, minutes=mmss(r["secs"]), stats=st)
            if photo:
                p["photoT"] = photo
            players[r["tno"]][c] = p

        tm = []
        for tno, letter, pts in ((1, "h", "hp"), (2, "a", "vp")):
            club = str(info.get(letter + "id") or "").strip()
            totals = S.totals_of(players[tno])
            for k, v in team_extra[tno].items():
                totals[k] += v
            totals["sReboundsTotal"] = totals["sReboundsOffensive"] + totals["sReboundsDefensive"]
            score = int(S.num(info.get(pts))) if info.get(pts) not in (None, "") else totals["sPoints"]
            t = S.team(unescape(info.get(letter)), club, score=score,
                       quarters=[by_period[tno].get(i, 0) for i in range(1, QUARTERS + 1)],
                       players=players[tno], logo=LOGO.format(season=season, club=club) if (club and season) else None,
                       totals=totals, short_name=N.team_name(unescape(info.get(letter + "2"))) or unescape(info.get(letter)))
            for i, p in enumerate(sorted(k for k in by_period[tno] if k > QUARTERS), start=1):
                t[f"ot{i}_score"] = by_period[tno][p]
            t["shot"] = shots[tno]
            tm.append(t)

        raw = S.game(tm[0], tm[1], played=final, pbp=pbp)
        # can this log stand for the game? (module docstring: a log that lost its substitutions)
        off = {c: (rp["played"].get(c, 0), r["secs"]) for c, r in ros.items() if abs(rp["played"].get(c, 0) - r["secs"]) > 2}
        why = ""
        if rp["bad"] and "subs" not in rp:
            why = f"{rp['bad']} substitution(s) contradict the floor"
        elif final and off and "subs" not in rp:
            c0 = next(iter(off))
            why = f"its changes give {len(off)} player(s) other minutes than the console's (e.g. {c0}: {mmss(off[c0][0])} v {mmss(off[c0][1])})"
        dm = re.match(r"(\d{4})-(\d{2})-(\d{2})$", str(info.get("date") or ""))
        raw["mkosz"] = {"code": code, "nat": str(info.get("nat") or ""), "season": season, "round": info.get("round"),
                        "arena": unescape(info.get("arena")), "date": info.get("date"),
                        "tipoff_at": tipoff(*dm.groups()) if dm else None,
                        "log_ok": not why, "why": why, "repaired": rp.get("repaired", 0), "unknown": sorted({e["pno"] for e in pbp if e.get("pno") and e["pno"] not in ros})}
        return raw

    @staticmethod
    def events(d: dict, subs: Optional[dict] = None) -> tuple[list, dict, dict]:
        """The event log -> (FIBA pbp oldest first, {tno: [shot]}, {tno: {period: points}}). `subs`: a
        rebuilt log's changes (rebuild()), written in place of the log's own."""
        ros = roster(d)
        rows = [e for e in (d.get("f") or []) if isinstance(e, dict)]
        final = str(d.get("jr")) == "2"
        last = final_end(rows, final)
        # a drawn foul is the other club's foul at the same second, nearest in the log
        drawn_of, used = {}, set()
        for j, e in enumerate(rows):
            if _code(e) != 1006:
                continue
            side, g = str(e.get("1")), _gt(e)
            cands = [k for k, f in enumerate(rows) if _code(f) in FOULS and k not in used
                     and str(f.get("1")) != side and _gt(f) == g]
            if cands:
                k = min(cands, key=lambda k: abs(k - j))
                used.add(k); drawn_of[k] = j
        out, shots, by_period = [], {1: [], 2: []}, {1: {}, 2: {}}
        closed, cur = set(), 0

        def add(ev):
            ev["actionNumber"] = len(out) + 1
            out.append(ev)
            return ev["actionNumber"]

        def open_to(p):
            nonlocal cur
            while cur < p:
                if cur >= 1 and cur not in closed:
                    closed.add(cur)
                    add({"actionType": "period", "subType": "end", "period": cur, "gt": "00:00", "tno": 0, "pno": ""})
                cur += 1
                s, e = period_bounds(cur)
                add({"actionType": "period", "subType": "start", "period": cur, "gt": clock_left(s, cur), "tno": 0, "pno": ""})

        for j, e in enumerate(rows):
            c, g = _code(e), _gt(e)
            tno = 1 if str(e.get("1")) == "1" else 2
            after = last is not None and j > last
            if c == 1101:
                p = ended_period(g)
                if p is None or p in closed or after:
                    continue                                  # a second end marker at the same buzzer
                open_to(p)
                closed.add(p)
                add({"actionType": "period", "subType": "end", "period": p, "gt": "00:00", "tno": 0, "pno": ""})
                continue
            if c in NOT_PLAYS or c == 1006:
                continue
            if after and c == 1011:
                continue                                      # everybody off after the final buzzer
            p = max(closed) if (after and closed) else period_at(g, closed)
            open_to(p)
            gt = clock_left(g, p)
            if c in (1000, 1001):
                kind = int(S.num(e.get("6")))
                if kind not in SHOT_KIND:
                    continue
                at, sub = SHOT_KIND[kind]
                ev = {"actionType": at, "period": p, "gt": gt, "tno": tno, "pno": _who(e), "success": 1 if c == 1000 else 0}
                if sub:
                    ev["subType"] = sub
                n = add(ev)
                if c == 1000:
                    by_period[tno][p] = by_period[tno].get(p, 0) + SHOT_POINTS[kind]
                x, y = S.num(e.get("4")), S.num(e.get("5"))
                if at != "freethrow" and (x or y):
                    shots[tno].append({"actionNumber": n, "x": round(min(100.0, max(0.0, x / CHART_W * 100)), 2),
                                       "y": round(min(100.0, max(0.0, y / CHART_H * 100)), 2),
                                       "r": 1 if c == 1000 else 0, "pno": _who(e), "tno": tno, "per": p, "actionType": at})
            elif c == 1011:
                # one change, its two halves at one clock: off first, then on
                pairs = [(_who(e, "3"), _who(e, "4"))] if subs is None else subs.get(j, [])
                for o in [o for _, o in pairs if o or subs is None]:
                    add({"actionType": "substitution", "subType": "out", "period": p, "gt": gt, "tno": tno, "pno": o})
                for i in [i for i, _ in pairs if i or subs is None]:
                    add({"actionType": "substitution", "subType": "in", "period": p, "gt": gt, "tno": tno, "pno": i})
            elif c in ACTIONS:
                at, sub, team = ACTIONS[c]
                ev = {"actionType": at, "period": p, "gt": gt, "tno": tno, "pno": "" if team else _who(e)}
                if sub:
                    ev["subType"] = sub
                if team and at in ("rebound", "turnover"):
                    ev["qualifier"] = ["team"]
                n = add(ev)
                if j in drawn_of:
                    dj = rows[drawn_of[j]]
                    add({"actionType": "foulon", "period": p, "gt": gt, "tno": 1 if str(dj.get("1")) == "1" else 2,
                         "pno": _who(dj), "previousAction": n})
        if final:
            if cur and cur not in closed:
                add({"actionType": "period", "subType": "end", "period": cur, "gt": "00:00", "tno": 0, "pno": ""})
            add({"actionType": "game", "subType": "end", "period": cur or QUARTERS, "gt": "00:00", "tno": 0, "pno": ""})
        return out, shots, by_period

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """A translated feed is built forwards; the scraper's builder reads a real data.json backwards
        (see bleague.py). Nothing here hands the game to scripts/ingest/stints.py."""
        return []
