# -*- coding: utf-8 -*-
"""The 2. Basketball Bundesliga: ProA and ProB (2basketballbundesliga.de and its live ticker).

WHERE THE DATA IS. Two hosts, both public, no key, no browser:

  * THE SCHEDULE is a WordPress page, fully server-rendered, one plain GET per season:
        ProA  https://www.2basketballbundesliga.de/spielplan/?season=YYYY/YYYY
        ProB  https://www.2basketballbundesliga.de/spielplaene-prob/?season=YYYY/YYYY
    Every round is a slide (div.slide-entry-wrap, h3.slide-entry-title "Spieltag 7",
    "PO-1/4 Finale Spiel 2", "BBL-Pokal 1. Pokalrunde") holding one table row per game:
        <tr class="myteam-table myteam-{homeTeamId} myteam-{awayTeamId}">
          date DD.MM.YYYY | "HH:MM Uhr" (Berlin) | home name | away name | "--:--" or
          <a href="http://live.2basketballbundesliga.de/g/{gameId}?s=boxscore">86:93</a>
    So every fixture carries both clubs' NUMERIC TEAM IDS from the moment it is published, but
    its game id only once it has been played. The ProA page has a second tab for the BBL-Pokal.
    A malformed season token ("2025/26") is not an error: the site answers 200 with "Der
    Spielplan befindet sich noch in Planung." and no slides - which is exactly how the scraper
    went quiet on 2026-09-18. Tokens are normalised and a page without slides is refused.

  * THE GAMES come from the lionkeen ticker behind live.2basketballbundesliga.de:
        GET  live.../init/{gameId}          clubs (id, letter, caption, coach), player dict, venue
        GET  api.../lt/info/{gameId}        season, league ("ProA", "ProB Nord", "ProB Süd"), round
        socket.io v4, emit('history', "{gameId}") on the game's own event name -> the whole game:
            [0, id, q, clockRemain, scoreA, scoreB]                    score series
            [1, id, q, team, p1, p2, clock, num1, num2, code, i1, i2, i3, result, sA, sB, x, y]
            [2, id, team, FTM, FTA, FT%, 2PM, 2PA, 2P%, 3PM, 3PA, 3P%, PF, DREB, OREB, BLK, STL, TO, ..]
            [3, id, q, clock, 0 start | 1 end | 2 GAME END, qPtsA, qPtsB]
            [4, id, team, playerId, _, shirt, PTS, FTM, FTA, FT%, 2PM, 2PA, 2P%, 3PM, 3PA, 3P%,
                PF, REB, AST, BLK, STL, TO, _, _, seconds, "mm:ss", DREB, OREB]   the site's box
            [5, id, ..] score delete   [6, actionId] action delete   [8, id] player row delete
            [7, q, team, pid x5]        the quarter's starting five (NOT present for every quarter)
            [20]                        a history section is complete; a full replay sends seven
    Game ids are pre-allocated for the whole season (/init and /lt/info already answer for a
    fixture months away), but nothing LISTS them: games.jsn / gamesLive.jsn on the ticker carry
    only the current matchday (with t1/t2 team ids). Hence the stable fixture key below.

THE STABLE KEY. external_id must not change between "fixture published" and "final", and an
unplayed row has no game id, so the key is built from what every row has from day one:

    regular   {league}-{seasonStart}-{homeTeamId}-{awayTeamId}                proa-2026-421-435
    playoffs  {league}-{seasonStart}-{slug(round label)}-{home}-{away}        proa-2025-po-1-4-finale-spiel-1-439-435

A home/away pair plays once per main round (double round robin, ProB within its group), so the
date - which moves - is never part of it; a playoff pair meets up to five times, so there the
round label ("PO-1/4 Finale Spiel 3") is. fetch() resolves a key to the real game id from the
schedule row's own link (played games), else from games.jsn/gamesLive.jsn (the current
matchday, including games that have not tipped), and caches the answer.

TEAM IDENTITY. The club code is the 2BBL numeric team id ("446") in discover() AND fetch() - the
same id is in the schedule row's class, in /init's teamA/teamB.id and in games.jsn t1/t2, and it
is stable across seasons (verified 2024/25-2026/27). Club names always come from the schedule
page, the source config/groups/prob.json was written from, never from /init's caption.

THE GAME PAYLOAD is translated into FIBA LiveStats data.json shape and handed to
FibaLiveStatsAdapter.bundle_from_raw like every other translated league. The translation is a
port of the scraper's validated 2BBL v2 model (LINEUPDATASCRAPE GermanV2GameModel: 23 cached
games, every player's box reconstructed exactly), and its repairs carry over:
  * actionIds are not chronological (late corrections) -> stable sort by (elapsed, actionId);
  * the event's own shirt number is authoritative; player id 0 is an "unbekannt" placeholder;
    a player the ticker never registered (pid 8888/9999 in events, a generated id in the box)
    is resolved by shirt number and keyed "u{shirt}" with the name "Unregistered #{shirt}";
  * quarter-break substitutions are often missing and the type-7 five is absent for some
    quarters (and was stale once) -> each period's opening five is INFERRED from what players do
    before they are subbed in, with type 7 as the prior, and balanced substitutions are emitted
    at the period start so every period opens with that five;
  * an offensive foul is PF + TO in the league's own box, so it becomes FIBA's pair of events
    (foul/offensive + turnover/offensive), exactly as a genuine data.json records it.

SHOT CHART. x/y are pixels on the ticker's 276x198 half-court picture (Spielfeld.png, basket at
the top). Calibrated on 2,884 shots: basket at (137, 31) and the 2/3 boundary 121 px from it,
which matches the picture's own 18.4 px per metre (276 px = 15 m) - 2 of 2,884 shots on the
wrong side of the arc. Converted to the chart percentages the pipeline measures in via
fibashape.at_rim_offset; (0, 0) means "not marked" and is skipped.

WHAT THE FEED DOES NOT HAVE: fast-break / second-chance / points-off-turnover / paint
qualifiers (those splits stay an honest 0), pull-up/step-back shot types (3pt is always
"jumpshot"), and a venue before a game id is known.
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
from .fiba_livestats import FibaLiveStatsAdapter, UA

try:
    from zoneinfo import ZoneInfo
    _BERLIN = ZoneInfo("Europe/Berlin")
except Exception:                       # pragma: no cover - no tz database: the EU rule below
    _BERLIN = None

SITE = "https://www.2basketballbundesliga.de"
SCHEDULE_URLS = {"proa": SITE + "/spielplan/", "prob": SITE + "/spielplaene-prob/"}
LIVE = "https://live.2basketballbundesliga.de"
API = "https://api.2basketballbundesliga.de"
LOGO_URL = API + "/pics/li/{team_id}"

#: a full history replay ends with seven [20] markers (verified on 23 of 23 games)
HISTORY_MARKERS = 7
#: lk.js itself calls the history finished at the fifth; fewer than that is an incomplete read
HISTORY_MIN_MARKERS = 5
HISTORY_TIMEOUT_S = 20.0
HISTORY_QUIET_S = 2.0
#: a played row whose tip-off is this recent may still be in progress
LIVE_GUARD_S = 3 * 3600
#: same lead as fetchwindow.FETCH_LEAD_S: before it, a ticker payload is the operators testing
#: the scoresheet (seen: a fixture two days out showing "E", 5:0), never a result
FETCH_LEAD_S = 30 * 60

#: shot chart calibration (see the module note)
PX_PER_M = 18.4
BASKET_PX = (137.0, 31.0)

PLAYOFF_SPIEL = re.compile(r"Spiel\s*(\d+)", re.I)
REGULAR_LABEL = re.compile(r"^\s*Spieltag\s*\d+\s*$", re.I)

TO_SUBTYPE = {10: "3sec", 11: "ballhandling", 12: "badpass", 13: "outofbounds",
              14: "travel", 15: "backcourt", 16: "5sec"}
TEAM_TO_SUBTYPE = {17: "8sec", 18: "shotclock"}
SHOT2_SUBTYPE = {51: "jumpshot", 52: "layup", 53: "dunk", 54: "alleyoopdunk", 55: "tipin"}
FOUL_SUBTYPE = {1: "offensive", 2: "personal", 3: "technical", 4: "unsportsmanlike",
                5: "disqualifying", 7: "personal", 19: "benchtechnical"}
#: codes whose actor proves he was on the floor (FT, shots, drawn foul, rebound, TO, steal, block)
EVIDENCE_CODES = {2, 3, 4, 6, 7, 9, 10, 11}


# ============================================================================ seasons, time
def normalize_season(token) -> Optional[str]:
    """'2026-27' | '2026/27' | '2026/2027' | '26/27' | '2026' (= season START year) -> '2026/2027'.
    None when the token is not season-shaped."""
    t = str(token or "").strip()
    m = re.match(r"^(\d{4})(?:\s*[-/_]\s*(\d{2}|\d{4}))?$", t) or \
        re.match(r"^(\d{2})\s*[-/_]\s*(\d{2})$", t)
    if not m:
        return None
    y1 = int(m.group(1))
    if y1 < 100:
        y1 += 2000
    if m.group(2):
        y2 = int(m.group(2))
        if y2 < 100:
            y2 += y1 - y1 % 100
            if y2 < y1:
                y2 += 100
        if y2 != y1 + 1:
            return None
    return f"{y1}/{y1 + 1}"


def current_season(now: Optional[datetime] = None) -> str:
    """The season the website is showing: from August on, the one that starts that year
    (the same cut-over feedplatform.season_name_for uses)."""
    now = now or datetime.now(timezone.utc)
    y = now.year if now.month >= 8 else now.year - 1
    return f"{y}/{y + 1}"


def _eu_offset_hours(local: datetime) -> int:
    """CET/CEST without a tz database: summer time from the last Sunday of March to the last
    Sunday of October (switch hours ignored - no game tips at 2-3 am)."""
    def last_sunday(year, month):
        d = datetime(year, month, 31)
        return d - timedelta(days=(d.weekday() + 1) % 7)
    y = local.year
    return 2 if last_sunday(y, 3) <= local < last_sunday(y, 10) else 1


def berlin_to_utc(date_str: str, time_str: str = "") -> Optional[str]:
    """'25.09.2026' + '20:00 Uhr' (Berlin local) -> '2026-09-25T18:00:00+00:00'."""
    dm = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", date_str or "")
    if not dm:
        return None
    tm = re.search(r"(\d{1,2}):(\d{2})", time_str or "")
    try:
        local = datetime(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)),
                         int(tm.group(1)) if tm else 0, int(tm.group(2)) if tm else 0)
    except ValueError:
        return None
    if _BERLIN is not None:
        aware = local.replace(tzinfo=_BERLIN)
    else:                                              # pragma: no cover
        aware = local.replace(tzinfo=timezone(timedelta(hours=_eu_offset_hours(local))))
    return aware.astimezone(timezone.utc).isoformat()


def _in_season(date_str: str, season: str) -> bool:
    """Is a DD.MM.YYYY date inside a YYYY/YYYY season (1 Aug .. 31 Jul)?"""
    dm = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", date_str or "")
    if not dm or not season:
        return True
    y1 = int(season[:4])
    d = (int(dm.group(3)), int(dm.group(2)))
    return (y1, 8) <= d <= (y1 + 1, 7)


# ============================================================================ the schedule page
def _text(fragment: str) -> str:
    """One table cell as the page means it: no tags, no responsive label, entities undone."""
    s = re.sub(r'<span class="responsive-table-tag">.*?</span>', "", fragment or "", flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", _html.unescape(s)).strip()


def slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")


def stage_of(label: str, in_cup_tab: bool = False) -> str:
    """'regular' (main round), 'playoffs' (everything post-season) or 'cup' (never ingested)."""
    if in_cup_tab or "pokal" in (label or "").lower():
        return "cup"
    if REGULAR_LABEL.match(label or ""):
        return "regular"
    return "playoffs"


_SLIDE = re.compile(r'<div[^>]*class="slide-entry-wrap[^"]*"[^>]*>')
_TITLE = re.compile(r'<h3[^>]*class="slide-entry-title[^"]*"[^>]*>(.*?)</h3>', re.S)
_ROW = re.compile(r'<tr\s+class="myteam-table([^"]*)"[^>]*>(.*?)</tr>', re.S)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_LINK = re.compile(r'<a[^>]+href="[^"]*/g/(\d+)[^"]*"[^>]*>(.*?)</a>', re.S)
_SELECT = re.compile(r'<select[^>]*name="season"[^>]*>(.*?)</select>', re.S)
_OPTION = re.compile(r"<option([^>]*)>", re.S)
_TAB_TITLE = re.compile(r"data-fake-id=['\"]#tab-id-(\d+)['\"][^>]*>\s*([^<]*?)\s*<", re.S)
_TAB_CONTENT = re.compile(r"aria-labelledby=['\"]tab-id-(\d+)-tab['\"]")


def parse_schedule(html: str) -> dict:
    """Everything one season page says: {seasons, selected, placeholder, rows}.

    rows: one dict per game table row, in page order - label, stage, date, time, tip (UTC ISO),
    home/away (names), home_id/away_id (numeric team ids, as strings), gid (game id or None) and
    score ((home, away) or None). Rows without two team ids cannot be keyed and are skipped."""
    html = html or ""
    seasons, selected = [], None
    sel = _SELECT.search(html)
    if sel:
        for attrs in _OPTION.findall(sel.group(1)):
            v = re.search(r'value="(\d{4}/\d{4})"', attrs)
            if v:
                seasons.append(v.group(1))
                if "selected" in attrs:
                    selected = v.group(1)
    # the BBL-Pokal lives in its own tab on the ProA page
    tab_title = {n: t for n, t in _TAB_TITLE.findall(html)}
    tab_starts = sorted((m.start(), tab_title.get(m.group(1), "")) for m in _TAB_CONTENT.finditer(html))

    def tab_at(pos):
        cur = ""
        for start, title in tab_starts:
            if start > pos:
                break
            cur = title
        return cur

    starts = [m.start() for m in _SLIDE.finditer(html)]
    rows = []
    for i, st in enumerate(starts):
        block = html[st: starts[i + 1] if i + 1 < len(starts) else len(html)]
        tm = _TITLE.search(block)
        label = _text(tm.group(1)) if tm else ""
        stage = stage_of(label, "pokal" in tab_at(st).lower())
        for classes, body in _ROW.findall(block):
            ids = re.findall(r"myteam-(\d+)", classes)
            cells = _CELL.findall(body)
            if len(ids) < 2 or len(cells) < 5:
                continue
            date, tip_time = _text(cells[0]), _text(cells[1])
            link = _LINK.search(cells[4])
            score = None
            if link:
                sm = re.search(r"(\d+)\s*:\s*(\d+)", _text(link.group(2)))
                if sm:
                    score = (int(sm.group(1)), int(sm.group(2)))
            rows.append({
                "label": label, "stage": stage, "date": date, "time": tip_time,
                "tip": berlin_to_utc(date, tip_time),
                "home": _text(cells[2]), "away": _text(cells[3]),
                "home_id": ids[0], "away_id": ids[1],
                "gid": link.group(1) if link else None, "score": score,
            })
    return {"seasons": seasons, "selected": selected, "rows": rows,
            "placeholder": "noch in Planung" in html}


def fixture_keys(rows: list, league: str, season: str) -> list:
    """[(key, row)] for the rows of ONE season page, in page order - see the module note.

    A main-round pair that appears twice (it never has, 2023/24-2026/27) would collide, so such
    a pair falls back to the label-qualified form rather than silently sharing one key."""
    start = season[:4]
    pairs: dict = {}
    for r in rows:
        if r["stage"] == "regular":
            pairs[(r["home_id"], r["away_id"])] = pairs.get((r["home_id"], r["away_id"]), 0) + 1
    out = []
    for r in rows:
        if r["stage"] == "regular" and pairs.get((r["home_id"], r["away_id"])) == 1:
            key = f"{league}-{start}-{r['home_id']}-{r['away_id']}"
        else:
            key = f"{league}-{start}-{slug(r['label'])}-{r['home_id']}-{r['away_id']}"
        out.append((key, r))
    return out


_KEY = re.compile(r"^(proa|prob)-(\d{4})-(?:(.+)-)?(\d+)-(\d+)$")


def parse_key(key: str) -> Optional[dict]:
    m = _KEY.match(str(key or ""))
    if not m:
        return None
    return {"league": m.group(1), "season": f"{m.group(2)}/{int(m.group(2)) + 1}",
            "label_slug": m.group(3) or "", "home_id": m.group(4), "away_id": m.group(5)}


def league_of_url(url: str) -> str:
    return "prob" if "spielplaene-prob" in (url or "").lower() else "proa"


# ============================================================================ the game model
def elapsed(quarter, clock_remain) -> int:
    q, c = int(quarter), max(0, int(clock_remain or 0))
    if q <= 4:
        return (q - 1) * 600 + (600 - min(c, 600))
    return 2400 + (q - 5) * 300 + (300 - min(c, 300))


def period_len(q: int) -> int:
    return 600 if int(q) <= 4 else 300


def gt(q: int, remain) -> str:
    r = max(0, min(int(remain or 0), period_len(q)))
    return "%02d:%02d" % (r // 60, r % 60)


def _mmss(seconds) -> str:
    s = int(S.num(seconds))
    return "%d:%02d" % (s // 60, s % 60)


def dedupe_socket(socket: list) -> dict:
    """The history as the ticker's own client would hold it: updates replace (last wins),
    deletes delete. Returned grouped by message type, deterministic order."""
    acts, box, team, times, scores, fives = {}, {}, {}, {}, {}, {}
    for m in socket or []:
        if not isinstance(m, list) or not m:
            continue
        t = m[0]
        if t == 1 and len(m) >= 14:
            acts[m[1]] = m
        elif t == 6 and len(m) >= 2:
            acts.pop(m[1], None)
        elif t == 4 and len(m) >= 28:
            box[(int(m[2]), str(m[3]))] = m
        elif t == 8 and len(m) >= 2:
            for k in [k for k, v in box.items() if v[1] == m[1] or str(v[3]) == str(m[1])]:
                box.pop(k)
        elif t == 2 and len(m) >= 18:
            team[int(m[2])] = m
        elif t == 3 and len(m) >= 5:
            times[m[1]] = m
        elif t == 0 and len(m) >= 6:
            scores[m[1]] = m
        elif t == 5 and len(m) >= 2:
            scores.pop(m[1], None)
        elif t == 7 and len(m) >= 4:
            fives[(int(m[1]), int(m[2]))] = m
    return {"acts": [acts[k] for k in sorted(acts)], "box": [box[k] for k in sorted(box)],
            "team": team, "times": [times[k] for k in sorted(times)],
            "scores": [scores[k] for k in sorted(scores)], "fives": fives}


class GameModel:
    """Jersey-space model of one ticker feed (port of the scraper's GermanV2GameModel).

    tidx 0 = the feed's team A (team code 1), 1 = team B."""

    def __init__(self, init: dict, feed: dict):
        self.players = init.get("player") or {}
        self.coach_ids = {str((init.get("teamA") or {}).get("coach", "")),
                          str((init.get("teamB") or {}).get("coach", ""))}
        self.site_box = {0: {}, 1: {}}
        for m in feed["box"]:
            tidx = 0 if int(m[2]) == 1 else 1
            pid, num = str(m[3]), str(m[5])
            # #00 IS NOT #0. The box's shirt field is an integer, so both read 0 - and keyed on it
            # the second silently replaced the first (2003296: Crailsheim's #00 Shahid, 21 points,
            # vanished under #0 Blunt). The player dict keeps the shirt as text, so it decides -
            # for "00" only, exactly as the scraper engine does: a "07" in the dict must stay the
            # "7" its events carry, or the box row and the events split into two players.
            reg = (self.players.get(pid) or {}).get("num")
            if self.registered(pid) and str(reg or "").strip() == "00" and S.num(m[5]) == 0:
                num = "00"
            self.site_box[tidx][num] = {"pid": pid, "row": m}
        self.acts = sorted(feed["acts"], key=lambda m: (elapsed(int(m[2]), m[6]), m[1]))
        self.q7 = {}
        for (q, team), m in sorted(feed["fives"].items()):
            tidx = 0 if team == 1 else 1
            five = []
            for pid in m[3:8]:
                p = self.players.get(str(pid))
                if p and str(pid) != "0":
                    five.append(str(p.get("num", "0")))
            self.q7.setdefault(q, {})[tidx] = five
        #: registered players the play-by-play names but the box does not list: num -> pid
        self.extra = {0: {}, 1: {}}

    def registered(self, pid) -> bool:
        pid = str(pid)
        return pid != "0" and pid not in self.coach_ids and self.pid_name(pid) is not None

    def pid_name(self, pid) -> Optional[str]:
        p = self.players.get(str(pid))
        if not p:
            return None
        name = (p.get("name") or "").strip()
        if not name or name == "unbekannt":
            name = (p.get("sname") or "").strip()
        if not name or name == "unbekannt":
            return None
        return re.sub(r"\s+", " ", name)

    def jersey(self, pid, num_field) -> Optional[str]:
        try:
            if num_field is not None and int(num_field) > 0:
                return str(int(num_field))
        except (TypeError, ValueError):
            pass
        p = self.players.get(str(pid))
        if p:
            try:
                if int(p.get("num", 0)) > 0:
                    return str(int(p["num"]))
            except (TypeError, ValueError):
                pass
            return str(p.get("num", "")) or None
        return None

    def actor(self, tidx: int, pid, num_field) -> Optional[str]:
        """The jersey of whoever an event names, or None when it cannot be told.

        pid 0 ("unbekannt") resolves ONLY through a real jersey in the event itself, and an
        UNREGISTERED stand-in (8888/9999) wearing #0 resolves to the box's #0 row only when that
        row is unregistered too - mapping either onto a registered #0 would corrupt a real
        player (scraper fix, validated on game 2006724)."""
        pid = str(pid)
        if pid in self.coach_ids:
            return None
        placeholder = pid == "0" or self.pid_name(pid) is None
        try:
            has_event_num = num_field is not None and int(num_field) > 0
        except (TypeError, ValueError):
            has_event_num = False
        if placeholder and not has_event_num:
            zero = self.site_box[tidx].get("0")
            if pid != "0" and str(num_field) == "0" and zero is not None \
                    and not self.registered(zero["pid"]):
                return "0"
            return None
        num = self.jersey(pid, num_field)
        if num is None:
            return None
        entry = self.site_box[tidx].get(num)
        if placeholder and entry is None:
            return None
        if entry is None and not placeholder:
            self.extra[tidx].setdefault(num, pid)
        return num


def infer_quarter_fives(model: GameModel, quarters: list) -> dict:
    """Evidence-based starting five per (quarter, team), jersey space.

    Certainty ladder: acting before one's own first sub-in > the feed's type-7 five >
    carry-over from the previous quarter (the scraper's validated german_v2_infer_quarter_fives)."""
    per_q = {}
    for q in quarters:
        ev, fin = {0: {}, 1: {}}, {0: {}, 1: {}}
        for m in model.acts:
            if int(m[2]) != q:
                continue
            t = elapsed(q, m[6])
            tidx = 0 if int(m[3]) == 1 else 1
            code = m[9]
            if code == 13:
                a_out = model.actor(tidx, m[4], m[7])
                a_in = model.actor(tidx, m[5], m[8])
                if a_out and a_out not in ev[tidx] and a_out not in fin[tidx]:
                    ev[tidx][a_out] = t
                if a_in and a_in not in fin[tidx] and a_in not in ev[tidx]:
                    fin[tidx][a_in] = t
            elif code in EVIDENCE_CODES:
                a1 = model.actor(tidx, m[4], m[7])
                if a1 and a1 not in ev[tidx] and a1 not in fin[tidx]:
                    ev[tidx][a1] = t
                if code in (2, 3, 4) and m[13] == 1:
                    a2 = model.actor(tidx, m[5], m[8])
                    if a2 and a2 not in ev[tidx] and a2 not in fin[tidx]:
                        ev[tidx][a2] = t
        per_q[q] = {"ev": ev, "fin": fin}

    fives: dict = {}
    prev = {0: [], 1: []}
    for q in quarters:
        fives[q] = {}
        for tidx in (0, 1):
            certain = sorted(per_q[q]["ev"][tidx], key=lambda n: (per_q[q]["ev"][tidx][n], n))
            entered = per_q[q]["fin"][tidx]
            five = list(certain[:5])
            for prior in (model.q7.get(q, {}).get(tidx, []), prev[tidx]):
                for num in prior:
                    if len(five) >= 5:
                        break
                    if num not in five and num not in entered:
                        five.append(num)
            for prior in (model.q7.get(q, {}).get(tidx, []), prev[tidx]):
                for num in prior:
                    if len(five) >= 5:
                        break
                    if num not in five:
                        five.append(num)
            fives[q][tidx] = five[:5]
        oncourt = {t: set(fives[q][t]) for t in (0, 1)}
        for m in model.acts:
            if int(m[2]) != q or m[9] != 13:
                continue
            tidx = 0 if int(m[3]) == 1 else 1
            a_out, a_in = model.actor(tidx, m[4], m[7]), model.actor(tidx, m[5], m[8])
            if a_out and a_in and a_out in oncourt[tidx] and a_in not in oncourt[tidx]:
                oncourt[tidx].discard(a_out)
                oncourt[tidx].add(a_in)
        prev = {t: sorted(oncourt[t]) for t in (0, 1)}
    return fives


def build_events(model: GameModel, fives: dict, quarters: list, tno_of: dict, pno_of,
                 finished: bool, ended_periods: set) -> list:
    """The game as FIBA data.json events, oldest first, actionNumber 1..n.

    Private helper keys _prev and _ftn are resolved and removed here; _shot and _blocked are
    left for raw_from_feed, which turns them into shot-chart markers and blocks received and
    removes them (the test suite fails if any "_" key reaches the payload)."""
    out: list = []
    on = {t: set(fives.get(quarters[0], {}).get(t, [])) for t in (0, 1)} if quarters else {0: set(), 1: set()}
    state = {"q": quarters[0] if quarters else 1}

    def ev(q, remain, tidx, action, sub="", num=None, success=None, **extra):
        e = {"actionType": action, "subType": sub, "period": q, "gt": gt(q, remain),
             "tno": tno_of[tidx] if tidx is not None else 0,
             "pno": pno_of(tidx, num) if (tidx is not None and num) else ""}
        if success is not None:
            e["success"] = 1 if success else 0
        e.update(extra)
        out.append(e)
        return e

    def period_start(q):
        ev(q, period_len(q), None, "period", "start")

    def period_end(q):
        ev(q, 0, None, "period", "end")

    def boundary(new_q):
        for qq in range(state["q"] + 1, new_q + 1):
            period_end(qq - 1)
            period_start(qq)
            for t in (0, 1):
                target = set(fives.get(qq, {}).get(t, [])) or on[t]
                for num in sorted(on[t] - target, key=_jersey_order):
                    ev(qq, period_len(qq), t, "substitution", "out", num)
                for num in sorted(target - on[t], key=_jersey_order):
                    ev(qq, period_len(qq), t, "substitution", "in", num)
                on[t] = set(target)
        state["q"] = new_q

    if quarters:
        period_start(quarters[0])
    last_foul: dict = {}                  # tidx -> the last foul event (for its foulon mirror)
    for m in model.acts:
        code, q = m[9], int(m[2])
        if q > state["q"]:
            boundary(q)
        tidx = 0 if int(m[3]) == 1 else 1
        other = 1 - tidx
        remain, result = m[6], m[13]
        num1 = model.actor(tidx, m[4], m[7])

        if code == 0:                     # the opening tip: won by this team
            ev(q, remain, tidx, "jumpball", "won", num1)
            ev(q, remain, other, "jumpball", "lost", model.actor(other, m[5], m[8]))
        elif code == 1:                   # "Ballbesitz": the arrow, at a period start or a held ball
            ev(q, remain, tidx, "jumpball",
               "startperiod" if int(remain) >= period_len(q) else "heldball")
        elif code == 2:
            if not num1:
                continue
            e = ev(q, remain, tidx, "freethrow", "", num1, success=result == 1,
                   _ftn={8: 1, 9: 2, 10: 3}.get(m[10], 1))
            num2 = model.actor(tidx, m[5], m[8]) if m[5] else None
            if result == 1 and num2:
                ev(q, remain, tidx, "assist", "", num2)
        elif code in (3, 4):
            if not num1:
                continue
            three = code == 4
            sub = "jumpshot" if three else SHOT2_SUBTYPE.get(m[12], "jumpshot")
            e = ev(q, remain, tidx, "3pt" if three else "2pt", sub, num1, success=result == 1)
            e["_shot"] = (m[16], m[17]) if len(m) > 17 else (0, 0)
            e["_blocked"] = result == 2
            num2 = model.actor(tidx, m[5], m[8]) if m[5] else None
            if result == 1 and num2:
                ev(q, remain, tidx, "assist", "", num2)
        elif code == 5:
            sub = FOUL_SUBTYPE.get(m[10], "personal")
            if sub == "benchtechnical":
                last_foul[tidx] = ev(q, remain, tidx, "foul", sub)
                continue
            if not num1:
                continue
            quals = ["shooting"] if sub == "personal" and len(m) > 11 and S.num(m[11]) > 0 else []
            e = ev(q, remain, tidx, "foul", sub, num1)
            if quals:
                e["qualifier"] = quals
            last_foul[tidx] = e
            if sub == "offensive":        # the league's box counts it as PF + TO, as FIBA records it
                ev(q, remain, tidx, "turnover", "offensive", num1)
        elif code == 6:                   # the fouled player: FIBA's foulon mirror
            if not num1:
                continue
            e = ev(q, remain, tidx, "foulon", "", num1)
            f = last_foul.get(other)
            if f is not None and f["period"] == q and f["gt"] == e["gt"]:
                e["_prev"] = f
        elif code == 7:
            if num1:
                ev(q, remain, tidx, "rebound", "offensive" if m[10] == 1 else "defensive", num1)
        elif code == 8:
            ev(q, remain, tidx, "rebound", "offensive" if m[10] == 1 else "defensive",
               qualifier=["team"])
        elif code == 9:
            if num1:
                ev(q, remain, tidx, "turnover", TO_SUBTYPE.get(m[10], ""), num1)
        elif code == 10:
            if num1:
                ev(q, remain, tidx, "steal", "", num1)
        elif code == 11:
            if num1:
                ev(q, remain, tidx, "block", "", num1)
        elif code == 12:
            ev(q, remain, tidx, "timeout", "full")
        elif code == 13:
            num_in = model.actor(tidx, m[5], m[8])
            # only state-changing, balanced pairs; the period boundaries repair the rest
            if num1 and num_in and num1 in on[tidx] and num_in not in on[tidx]:
                ev(q, remain, tidx, "substitution", "out", num1)
                ev(q, remain, tidx, "substitution", "in", num_in)
                on[tidx].discard(num1)
                on[tidx].add(num_in)
        elif code == 14:
            last_foul[tidx] = ev(q, remain, tidx, "foul", "coachtechnical")
        elif code == 15:
            ev(q, remain, tidx, "turnover", TEAM_TO_SUBTYPE.get(m[10], ""), qualifier=["team"])

    # the periods the feed has closed, and the whistle
    later = [q for q in sorted(ended_periods) if q > state["q"]]
    if later:
        boundary(max(later))
    if finished or state["q"] in ended_periods:
        period_end(state["q"])
    if finished:
        ev(state["q"], 0, None, "game", "end")

    # free throws: "k of n" per trip - one shooter at one clock time. Not by adjacency: the
    # bench changes between the first and the second shot all the time.
    trips: dict = {}
    for e in out:
        if e["actionType"] == "freethrow":
            trips.setdefault((e["period"], e["gt"], e["tno"], e["pno"]), []).append(e)
    for trip in trips.values():
        n = max(len(trip), max(t.get("_ftn", 1) for t in trip))
        for t in trip:
            t["subType"] = f"{t.pop('_ftn', 1)}of{n}"

    for n, e in enumerate(out, start=1):
        e["actionNumber"] = n
    for e in out:
        f = e.pop("_prev", None)
        if f is not None:
            e["previousAction"] = f["actionNumber"]
        e.pop("_ftn", None)
    return out


def _jersey_order(num: str):
    try:
        return (0, int(num), num)
    except (TypeError, ValueError):
        return (1, 0, str(num))


def shot_pct(x_px, y_px) -> Optional[tuple]:
    """Ticker pixels -> the chart percentages the pipeline measures in (None: not marked)."""
    x, y = S.num(x_px), S.num(y_px)
    if not x and not y:
        return None
    across_cm = (x - BASKET_PX[0]) / PX_PER_M * 100.0
    toward_cm = (y - BASKET_PX[1]) / PX_PER_M * 100.0
    cx, cy = S.at_rim_offset(across_cm, toward_cm)
    return (round(max(0.0, min(100.0, cx)), 2), round(max(0.0, min(100.0, cy)), 2))


def split_name(full: str, family: str) -> tuple:
    full = re.sub(r"\s+", " ", (full or "").strip())
    family = re.sub(r"\s+", " ", (family or "").strip())
    if family and full.endswith(family) and len(full) > len(family):
        return full[: -len(family)].strip(), family
    if " " in full:
        first, last = full.rsplit(" ", 1)
        return first, last
    return "", full or family


def raw_from_feed(init: dict, socket: list, info: dict, *, home_id: str, away_id: str,
                  home_name: str = "", away_name: str = "", game_id: str = "",
                  ended: bool = False) -> Optional[dict]:
    """One ticker game -> FIBA data.json shape. Pure: same input, same output.

    `ended`: the league says the game is over although the ticker never wrote its final
    whistle. It happens: 2003329 stops at Q4 0:04 - no quarter end, no game end, the last free
    throw only in the score series - and without this the game would read "live" for ever.

    None when the feed has no play yet (not tipped) or its clubs are not the fixture's."""
    feed = dedupe_socket(socket)
    if not feed["acts"]:
        return None
    a_id = str((init.get("teamA") or {}).get("id", ""))
    b_id = str((init.get("teamB") or {}).get("id", ""))
    if (a_id, b_id) == (str(home_id), str(away_id)):
        tno_of = {0: 1, 1: 2}
    elif (a_id, b_id) == (str(away_id), str(home_id)):
        tno_of = {0: 2, 1: 1}
    else:
        return None
    side_of = {v: k for k, v in tno_of.items()}              # tno -> tidx
    clubs = {0: init.get("teamA") or {}, 1: init.get("teamB") or {}}

    model = GameModel(init, feed)
    closed = {int(m[2]) for m in feed["times"] if len(m) > 4 and m[4] in (1, 2)}
    finished = bool(ended) or any(len(m) > 4 and m[4] == 2 for m in feed["times"])
    quarters = sorted({int(m[2]) for m in model.acts}
                      | {int(m[2]) for m in feed["times"] if len(m) > 4 and m[4] == 0}
                      | closed)
    quarters = list(range(1, max(quarters) + 1)) if quarters else [1]
    fives = infer_quarter_fives(model, quarters)

    # every player the payload will carry, keyed by a pno that does not move between games
    def pno_of(tidx, num):
        if num is None:
            return ""
        box = model.site_box[tidx].get(num)
        if box is not None:
            return box["pid"] if model.registered(box["pid"]) else f"u{num}"
        pid = model.extra[tidx].get(num)
        return str(pid) if pid else f"u{num}"

    events = build_events(model, fives, quarters, tno_of, pno_of, finished, closed)

    # what the box does not carry, read off the stream: +/-, blocks received, fouls drawn,
    # and (for a player the box forgot) everything
    starters = {tidx: {pno_of(tidx, n) for n in fives.get(quarters[0], {}).get(tidx, [])} for tidx in (0, 1)}
    on = {tno_of[t]: set(starters[t]) for t in (0, 1)}
    pm, br, fo, secs = {}, {}, {}, {}
    pbp_box: dict = {}
    last_t = 0

    def add(d, k, v=1):
        d[k] = d.get(k, 0) + v

    for e in events:
        t_now = elapsed(e["period"], _secs(e["gt"]))
        if t_now > last_t:
            for tno, players in on.items():
                for p in players:
                    add(secs, (tno, p), t_now - last_t)
            last_t = t_now
        at, tno, p = e["actionType"], e["tno"], e["pno"]
        if at == "substitution" and p:
            (on[tno].discard if e["subType"] == "out" else on[tno].add)(p)
            continue
        if tno and p:
            b = pbp_box.setdefault((tno, p), {})
            if at in ("2pt", "3pt", "freethrow"):
                pts = {"2pt": 2, "3pt": 3, "freethrow": 1}[at] if e.get("success") else 0
                kind = {"2pt": "2", "3pt": "3", "freethrow": "ft"}[at]
                add(b, kind + "a")
                if pts:
                    add(b, kind + "m")
                    add(b, "pts", pts)
                    for q in on[tno]:
                        add(pm, (tno, q), pts)
                    for q in on[3 - tno]:
                        add(pm, (3 - tno, q), -pts)
                if e.pop("_blocked", False):
                    add(br, (tno, p))
            elif at == "foulon":
                add(fo, (tno, p))
            elif at == "rebound":
                add(b, "oreb" if e["subType"] == "offensive" else "dreb")
            elif at in ("assist", "steal", "block", "turnover"):
                add(b, {"assist": "ast", "steal": "stl", "block": "blk", "turnover": "tov"}[at])
            elif at == "foul":
                add(b, "pf")
        e.pop("_blocked", None)

    shots = {1: [], 2: []}
    for e in events:
        xy = e.pop("_shot", None)
        if xy is None:
            continue
        pct = shot_pct(*xy)
        if pct is None:
            continue
        s = S.shot(pct[0], pct[1], made=e.get("success") == 1, three=e["actionType"] == "3pt",
                   pno=e["pno"], period=e["period"])
        s["actionNumber"] = e["actionNumber"]
        shots[e["tno"]].append(s)

    sides = {}
    for tidx in (0, 1):
        tno = tno_of[tidx]
        players = {}
        q1 = set(fives.get(quarters[0], {}).get(tidx, []))
        rows = sorted(model.site_box[tidx].items(), key=lambda kv: _jersey_order(kv[0]))
        for num, entry in rows:
            m, pid = entry["row"], entry["pid"]
            pno = pno_of(tidx, num)
            if model.registered(pid):
                p = model.players.get(pid) or {}
                first, last = split_name(p.get("name") or "", p.get("sname") or "")
            else:
                first, last = "Unregistered", f"#{num}"
            stats = {
                "sPoints": m[6], "sFreeThrowsMade": m[7], "sFreeThrowsAttempted": m[8],
                "sTwoPointersMade": m[10], "sTwoPointersAttempted": m[11],
                "sThreePointersMade": m[13], "sThreePointersAttempted": m[14],
                "sFieldGoalsMade": S.num(m[10]) + S.num(m[13]),
                "sFieldGoalsAttempted": S.num(m[11]) + S.num(m[14]),
                "sFoulsPersonal": m[16], "sReboundsTotal": m[17], "sAssists": m[18],
                "sBlocks": m[19], "sSteals": m[20], "sTurnovers": m[21],
                "sReboundsDefensive": m[26], "sReboundsOffensive": m[27],
                "sBlocksReceived": br.get((tno, pno), 0), "sFoulsOn": fo.get((tno, pno), 0),
                "sPlusMinusPoints": pm.get((tno, pno), 0),
            }
            players[pno] = S.player(first, last, shirt=num, starter=1 if num in q1 else 0,
                                    active=1, minutes=_mmss(m[24]), stats=stats)
        for num, pid in sorted(model.extra[tidx].items(), key=lambda kv: _jersey_order(kv[0])):
            pno = str(pid)
            if pno in players:
                continue
            b = pbp_box.get((tno, pno), {})
            p = model.players.get(pno) or {}
            first, last = split_name(p.get("name") or "", p.get("sname") or "")
            stats = {
                "sPoints": b.get("pts", 0), "sFreeThrowsMade": b.get("ftm", 0),
                "sFreeThrowsAttempted": b.get("fta", 0),
                "sTwoPointersMade": b.get("2m", 0), "sTwoPointersAttempted": b.get("2a", 0),
                "sThreePointersMade": b.get("3m", 0), "sThreePointersAttempted": b.get("3a", 0),
                "sFieldGoalsMade": b.get("2m", 0) + b.get("3m", 0),
                "sFieldGoalsAttempted": b.get("2a", 0) + b.get("3a", 0),
                "sReboundsOffensive": b.get("oreb", 0), "sReboundsDefensive": b.get("dreb", 0),
                "sReboundsTotal": b.get("oreb", 0) + b.get("dreb", 0),
                "sAssists": b.get("ast", 0), "sSteals": b.get("stl", 0),
                "sBlocks": b.get("blk", 0), "sTurnovers": b.get("tov", 0),
                "sFoulsPersonal": b.get("pf", 0), "sBlocksReceived": br.get((tno, pno), 0),
                "sFoulsOn": fo.get((tno, pno), 0), "sPlusMinusPoints": pm.get((tno, pno), 0),
            }
            players[pno] = S.player(first, last, shirt=num, starter=1 if num in q1 else 0,
                                    active=1, minutes=_mmss(secs.get((tno, pno), 0)), stats=stats)

        # the club's own totals row (type 2) wherever it has the number: it carries the team
        # rebounds, team turnovers and bench fouls no player row can
        totals = S.totals_of(players)
        t2 = feed["team"].get(1 if tidx == 0 else 2)
        if t2:
            ftm, fta, p2m, p2a, p3m, p3a = (S.num(t2[i]) for i in (3, 4, 6, 7, 9, 10))
            totals.update({
                "sFreeThrowsMade": ftm, "sFreeThrowsAttempted": fta,
                "sTwoPointersMade": p2m, "sTwoPointersAttempted": p2a,
                "sThreePointersMade": p3m, "sThreePointersAttempted": p3a,
                "sFieldGoalsMade": p2m + p3m, "sFieldGoalsAttempted": p2a + p3a,
                "sPoints": ftm + 2 * p2m + 3 * p3m,
                "sFoulsPersonal": S.num(t2[12]), "sReboundsDefensive": S.num(t2[13]),
                "sReboundsOffensive": S.num(t2[14]),
                "sReboundsTotal": S.num(t2[13]) + S.num(t2[14]),
                "sBlocks": S.num(t2[15]), "sSteals": S.num(t2[16]), "sTurnovers": S.num(t2[17]),
            })
        sides[tno] = {"tidx": tidx, "players": players, "totals": totals}

    # the scoreboard: the score series, else the per-period points the clock events carry
    per = {}
    for m in feed["times"]:
        if len(m) >= 7:
            per[int(m[2])] = (S.num(m[5]), S.num(m[6]))
    if feed["scores"]:
        last = max(feed["scores"], key=lambda m: (elapsed(int(m[2]), m[3]), m[1]))
        score_ab = (S.num(last[4]), S.num(last[5]))
    elif per:
        score_ab = (sum(v[0] for v in per.values()), sum(v[1] for v in per.values()))
    else:
        score_ab = (sides[tno_of[0]]["totals"]["sPoints"], sides[tno_of[1]]["totals"]["sPoints"])

    names = {1: home_name, 2: away_name}
    tm = {}
    for tno in (1, 2):
        tidx = side_of[tno]
        club = clubs[tidx]
        quarters_pts = [per.get(q, (0, 0))[tidx] for q in quarters]
        t = S.team(names[tno] or (club.get("caption") or "").strip(),
                   str(club.get("id") or (home_id if tno == 1 else away_id)),
                   score=score_ab[tidx], quarters=quarters_pts[:4],
                   players=sides[tno]["players"], shots=shots[tno],
                   logo=LOGO_URL.format(team_id=club.get("id") or (home_id if tno == 1 else away_id)),
                   totals=sides[tno]["totals"], short_name=(club.get("letter") or "").strip())
        for i, q in enumerate(quarters, start=1):
            if q > 4:
                t[f"p{q}_score"] = S.num(quarters_pts[i - 1])
        tm[str(tno)] = t

    raw = {"tm": tm, "pbp": events}
    max_q = quarters[-1]
    raw["period"] = max_q
    if finished:
        raw["clock"] = "00:00"
    else:
        in_q = [m for m in model.acts if int(m[2]) == max_q]
        raw["clock"] = gt(max_q, min((m[6] for m in in_q), default=0 if max_q in closed else period_len(max_q)))
    raw["twobbl"] = {"gameId": str(game_id), "homeTeamId": str(home_id), "awayTeamId": str(away_id),
                     **{k: (info or {}).get(k) for k in ("season", "league", "round", "day", "date", "time")}}
    return raw


def _too_early(tip) -> bool:
    """More than FETCH_LEAD_S before tip-off: nothing in the ticker can be a result yet."""
    if not tip:
        return False
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00"))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t - datetime.now(timezone.utc)).total_seconds() > FETCH_LEAD_S


def _whistled(socket: list) -> bool:
    """Has the ticker itself recorded the end of the game ([3, .., .., .., 2, ..])?"""
    return any(isinstance(m, list) and len(m) > 4 and m[0] == 3 and m[4] == 2 for m in socket or [])


def _secs(gt_str: str) -> int:
    m, s = (str(gt_str or "0:0").split(":") + ["0"])[:2]
    return int(S.num(m)) * 60 + int(S.num(s))


# ============================================================================ the adapter
class TwoBBLAdapter(FibaLiveStatsAdapter):
    """ProA and ProB. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "twobbl"
    #: a league's own website and a small ticker server, not a CDN built to be polled
    min_request_gap_s = 1.0

    # shared across instances: the live lane calls fetch() without a discover() in-process
    _pages: dict = {}           # url -> (fetched_at, html)
    _board_cache: tuple = (0.0, [])
    _ids: dict = {}             # fixture key -> game id
    _rows: dict = {}            # fixture key -> schedule row
    _inits: dict = {}           # game id -> (fetched_at, /init payload)
    _infos: dict = {}           # game id -> /lt/info payload (never changes)
    PAGE_TTL_S = 300.0
    BOARD_TTL_S = 15.0
    INIT_TTL_S = 120.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        league = league_of_url(schedule_url)
        season = self._season(config)
        stage = (config.get("stage") or "").strip().lower()
        if stage not in ("", "regular", "playoffs"):
            raise ValueError(f"twobbl: stage must be 'regular' or 'playoffs', not {stage!r}")
        page = self._schedule(league, season, schedule_url, fresh=True)
        if page is None:
            return []
        board = self._board()
        now = datetime.now(timezone.utc)
        out = []
        for key, r in fixture_keys(page["rows"], league, season):
            if r["stage"] == "cup" or (stage and r["stage"] != stage):
                continue
            self._rows[key] = r
            gid = r["gid"] or self._board_match(board, league, season, r)
            if gid:
                self._ids[key] = gid
            out.append(ScheduleGame(
                external_id=key, home_name=r["home"], away_name=r["away"], tipoff_at=r["tip"],
                status=self._fixture_status(r, gid, board, now),
                extra={"home_code": r["home_id"], "away_code": r["away_id"],
                       "home_logo": LOGO_URL.format(team_id=r["home_id"]),
                       "away_logo": LOGO_URL.format(team_id=r["away_id"]),
                       "round": r["label"], "game_id": gid}))
        print(f"     2BBL {league} {season} {stage or 'all stages'}: {len(out)} games "
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
            raise ValueError(f"twobbl: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    def _schedule(self, league: str, season: str, schedule_url: str = "", fresh: bool = False) -> Optional[dict]:
        """One season page, parsed - or None, loudly, when it has no schedule on it.

        The configured URL's query and fragment are ignored: run_ingest keys its sources by
        schedule URL, so the playoff source of a league has to differ from the main-round one
        ('.../spielplan/#playoffs') while reading the very same page."""
        base = re.split(r"[?#]", schedule_url or SCHEDULE_URLS[league])[0]
        if not base.endswith("/"):
            base += "/"
        url = f"{base}?season={season}"
        cached = self._pages.get(url)
        if cached and not fresh and time.time() - cached[0] < self.PAGE_TTL_S:
            html = cached[1]
        else:
            html = self._get_text(url)
            if html is None:
                raise RuntimeError(f"twobbl: schedule page unreachable: {url}")
            self._pages[url] = (time.time(), html)
        page = parse_schedule(html)
        if not page["rows"]:
            why = ("the site shows 'Der Spielplan befindet sich noch in Planung' - the season is "
                   "not published (or the token is unknown)" if page["placeholder"]
                   else "no schedule rows on the page - has the layout changed?")
            print(f"     2BBL {league} {season}: no schedule: {why}. "
                  f"Seasons offered: {', '.join(page['seasons'][:5]) or '?'}")
            return None
        if page["selected"] and page["selected"] != season:
            print(f"     2BBL {league}: asked for {season}, the page shows {page['selected']} - refused")
            return None
        return page

    @staticmethod
    def _fixture_status(r: dict, gid: Optional[str], board: list, now: datetime) -> str:
        # NOT _status: FibaLiveStatsAdapter.bundle_from_raw owns that name (status of a payload)
        tip = datetime.fromisoformat(r["tip"]) if r.get("tip") else None
        if tip and tip > now:
            return "scheduled"            # a pre-game ticker test is never a result
        entry = next((b for b in board if gid and str(b.get("g")) == str(gid)), None)
        q = str((entry or {}).get("q") or "")
        if q == "E":
            return "final"
        if q and q != "Q0":
            return "live"
        if r.get("score"):
            if tip and (now - tip).total_seconds() < LIVE_GUARD_S and entry is not None:
                return "live"
            return "final"
        return "scheduled"

    # ------------------------------------------------------------------ fixture key -> game id
    def _board(self) -> list:
        """The ticker's current matchday (games.jsn) merged with its live board (gamesLive.jsn)."""
        at, cached = TwoBBLAdapter._board_cache
        if cached and time.time() - at < self.BOARD_TTL_S:
            return cached
        merged: dict = {}
        for path in ("/games.jsn", "/gamesLive.jsn"):
            data = self._get_json(LIVE + path)
            for g in data if isinstance(data, list) else []:
                if isinstance(g, dict) and g.get("g"):
                    merged.setdefault(str(g["g"]), {}).update(g)
        TwoBBLAdapter._board_cache = (time.time(), list(merged.values()))
        return TwoBBLAdapter._board_cache[1]

    @staticmethod
    def _board_match(board: list, league: str, season: str, r: dict) -> Optional[str]:
        spiel = PLAYOFF_SPIEL.search(r.get("label") or "")
        hits = []
        for b in board:
            if str(b.get("t1")) != str(r["home_id"]) or str(b.get("t2")) != str(r["away_id"]):
                continue
            slot = str(b.get("l") or "")
            if (league == "proa") != (slot == "a") or "pokal" in slot:
                continue
            if not _in_season(str(b.get("d") or ""), season):
                continue
            if r["stage"] == "playoffs" and spiel and str(b.get("n") or "") != spiel.group(1):
                continue
            hits.append(str(b["g"]))
        return hits[0] if len(hits) == 1 else None

    def _row_and_id(self, key: str, k: dict) -> tuple:
        """(schedule row or None, game id or None) for a fixture key, however fetch() was reached."""
        row, gid = self._rows.get(key), self._ids.get(key)
        if row is None or not gid:
            try:
                page = self._schedule(k["league"], k["season"])
            except RuntimeError as exc:
                print(f"     ({exc})")
                page = None
            for kk, r in fixture_keys(page["rows"] if page else [], k["league"], k["season"]):
                self._rows[kk] = r
                if r["gid"]:
                    self._ids[kk] = r["gid"]
            row, gid = self._rows.get(key), self._ids.get(key)
        if row is not None and not gid:
            gid = self._board_match(self._board(), k["league"], k["season"], row)
            if gid:
                self._ids[key] = gid
        return row, gid

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        k = parse_key(external_id)
        if not k or _too_early(config.get("_tipoff_at")):
            return None                   # decided before a single request is made
        row, gid = self._row_and_id(str(external_id), k)
        tip = config.get("_tipoff_at") or (row or {}).get("tip")
        if not gid or _too_early(tip):
            return None
        # A LIVE POLL SHOULD COST ONE SOCKET READ, not two page requests and their politeness gaps
        # on top: the club/player dict barely changes during a game (a short TTL still picks up a
        # late registration) and the game's league/round/date never do.
        at, init = self._inits.get(gid, (0.0, None))
        if init is None or time.time() - at > self.INIT_TTL_S:
            init = self._get_json(f"{LIVE}/init/{gid}")
            if not isinstance(init, dict) or not init.get("teamA"):
                return None
            self._inits[gid] = (time.time(), init)
        info = self._infos.get(gid)
        if info is None:
            info = self._get_json(f"{API}/lt/info/{gid}")
            info = info if isinstance(info, dict) else {}
            if info:
                self._infos[gid] = info
        socket = self.history(gid)
        raw = raw_from_feed(init, socket, info,
                            home_id=k["home_id"], away_id=k["away_id"],
                            home_name=(row or {}).get("home", ""), away_name=(row or {}).get("away", ""),
                            game_id=gid,
                            ended=not _whistled(socket) and self._ended(gid, row, tip))
        if raw is None:
            return None
        b = self.bundle_from_raw(raw, str(external_id), config)
        b.tipoff_at = tip
        return b

    def _ended(self, gid: str, row: Optional[dict], tip) -> bool:
        """Does the LEAGUE say this game is over? A result on the schedule page more than
        LIVE_GUARD_S after tip-off, or 'E' on the ticker's live board once the game has tipped.
        Only ever used to close a game whose feed forgot its final whistle."""
        try:
            tip_dt = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
        except ValueError:
            tip_dt = None
        if tip_dt is None:
            return False
        since = (datetime.now(timezone.utc) - tip_dt).total_seconds()
        if since < 0:
            return False
        if (row or {}).get("score") and since > LIVE_GUARD_S:
            return True
        entry = next((b for b in self._board() if str(b.get("g")) == str(gid)), None)
        return str((entry or {}).get("q") or "") == "E"

    def history(self, gid: str) -> list:
        """The ticker's whole replay for one game, read with a hard time limit.

        Ends at the seventh [20] marker (a full replay), or once the stream has gone quiet after
        at least lk.js's own five; anything less is an incomplete read and raises, so a live poll
        retries next time instead of storing half a box score."""
        import socketio                     # python-socketio[client] (scripts/requirements.txt)
        gid = str(gid)
        got: list = []
        st = {"markers": 0, "last": time.time()}

        def on_game(data):
            got.append(data)
            st["last"] = time.time()
            if data == [20]:
                st["markers"] += 1

        sio = socketio.Client(logger=False, engineio_logger=False, reconnection=False)
        sio.on("connect", lambda: sio.emit("history", gid))
        sio.on(gid, on_game)
        try:
            sio.connect(f"{LIVE}?game={gid}", transports=["websocket", "polling"],
                        headers={"User-Agent": UA}, wait_timeout=10)
            t0 = time.time()
            while time.time() - t0 < HISTORY_TIMEOUT_S:
                if st["markers"] >= HISTORY_MARKERS:
                    break
                if st["markers"] >= HISTORY_MIN_MARKERS and time.time() - st["last"] >= HISTORY_QUIET_S:
                    break
                time.sleep(0.1)
        finally:
            try:
                sio.disconnect()
            except Exception:
                pass
        if st["markers"] < HISTORY_MIN_MARKERS:
            raise RuntimeError(f"twobbl: incomplete ticker history for {gid} "
                               f"({st['markers']} of {HISTORY_MARKERS} sections)")
        return got

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(TwoBBLAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        TwoBBLAdapter._last_req = time.time()

    def _get_text(self, url: str) -> Optional[str]:
        self._pause()
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9"}, timeout=40)
        if r.status_code != 200:
            return None
        r.encoding = r.encoding if (r.encoding or "").lower() not in ("", "iso-8859-1") else "utf-8"
        return r.text

    def _get_json(self, url: str):
        self._pause()
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
        except requests.RequestException:
            return None
        if r.status_code != 200:
            return None
        try:
            return json.loads(r.content.decode("utf-8"))
        except ValueError:
            return None
