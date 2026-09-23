# -*- coding: utf-8 -*-
"""U SPORTS men's basketball (en.usports.ca: PrestoSports, StatCrew play-by-play).

WHERE THE DATA IS. One host, public, no key, no browser, no JSON: every page is server-rendered
HTML (verified 2026-09-23). The site sits behind a CloudFront WAF: python-requests' own
User-Agent is refused (403), a browser User-Agent is served, and a burst of roughly 25 quick
requests draws a 202 JavaScript challenge (header x-amzn-waf-action: challenge) or a 459. The
challenge is never solved here - the adapter waits it out (30 s, 60 s, ...) and keeps a few
seconds between requests.

  * A SEASON is three "season paths", each with its own schedule, team ids and box scores:
        /sports/mbkb/2025-26/schedule     regular season (conference games + exhibitions)
        /sports/mbkb/2025-26p/schedule    the four conferences' playoffs
        /sports/mbkb/2025-26c/schedule    the U SPORTS Final 8
    (/sports/mbkb/<season>/composite is a 404 since 2026, and /sports/mbkb/composite shows the
    current season only.) Each game is a div.event-row with data-event-id (the PrestoSports
    event id - it exists from the moment the fixture is published), data-boxscore once a box
    is posted, and classes that say what kind of game it is: conf, division, exhibition,
    regional, postseason, neutral, result.
  * THE LIST STOPS AT 500 EVENTS (2025-26: 698 regular-season events, the list ends at
    15 Jan 2026). The iCal feed of the same path (?print=ical) is complete - every event's
    UID (= event id), DTSTART in UTC (or a bare date when no time is set), LOCATION - so it is
    both the tip-off source and the check that nothing is missing; the events past the cap are
    read from the per-club pages (?teamId=), fetched in the order that covers the missing
    events fastest (35 of 49 pages for 2025-26).
  * ONE GAME is one page, /sports/mbkb/<path>/boxscores/<YYYYMMDD>_<first 4 of event id>.xml:
    the box score (STARTERS / RESERVES / TEAM / TOTALS), the line score and its "Final", the
    play-by-play (#pbp-tabpanel, StatCrew text: 'O'CONNOR,BENNETT made 3-pt. jump shot',
    names only, no shirt numbers) and one box score per period (with minutes). Fetched once.

THE STABLE KEY is the PrestoSports event id (16 characters, e.g. cfrm4zwonl577zdh): listed with
the fixture, unchanged when the game is played, the box posted or the date moved. fetch() finds
the game's page through what discover() saw in this process, else through the season paths'
iCal feeds (cached 10 minutes): the event's URL there is its box score once one is posted, live
games included. (The event's details page, ?eid=, is no use: it is capped at 500 like the list.)

TEAM IDENTITY. PrestoSports' team ids differ between the three season paths (Carleton is
jc89ovc3loiuxh62, vkke7tu41uurz2r0 and s02ci3hnscb08l1s in 2025-26) and the organisation code
(CA007) is only printed on game pages, so neither can key a club at discovery time. The code is
the club's display name folded to letters and digits - which is exactly the site's own stats
slug (/sports/mbkb/<season>/teams/torontometropolitan; true for all 48 clubs of 2025-26) and the
same in discover(), fetch(), every path and every season in which the club keeps its name.
Lower case on purpose: feedplatform then shortens the club's name for short_name instead of
printing the code.

THE GAME is translated into FIBA LiveStats data.json shape and handed to
FibaLiveStatsAdapter.bundle_from_raw. The translation is a port of the scraper's U SPORTS
parser (LINEUPDATASCRAPE, validated on 25 games of 2024-26: every player's box exact, five a
side always, player_stints reconciling) and its repairs carry over:
  * PBP names ('LAST,FIRST (NICK)') are matched to box players per team (folded full name, then
    last name, then fuzzy). A name in neither box is a StatCrew ghost entry whose stats are in
    no player's line: its plays stay team plays (its points still score).
  * StatCrew never logs a quarter-break substitution. Each period's opening five is the one
    that best reproduces that period's own box minutes given the logged substitutions; the
    change is emitted as substitutions at the period start.
  * Substitution batches are reduced to real, balanced changes (5 on court, always); a play by
    a player the log has on the bench puts him on (a late entry pulled forward, else a
    temporary entry ended at the next clock value, else a forced entry).
  * All substitutions at one clock value form ONE block, so no lineup lives zero seconds.
  * A technical foul counts in the box PF for some crews and not others: the box decides.
  * A shot the site prints with no type ('{JUMPER=missed jump shot, 3PTR=...}') is settled
    from the score change (made) or the shooter's box 3PA/FTA (missed).
  * A player's dead-ball rebound is in his box REB: defensive after an opponent's miss.

WHAT THE FEED DOES NOT HAVE: shot locations, fast-break / second-chance / paint / points-off-
turnover qualifiers, fouls drawn, and minutes finer than the whole minute (sMinutes is the box's
own). Those stay honest zeros.
"""
from __future__ import annotations

import html as _html
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
from itertools import combinations
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

try:                                     # scripts/ingest/groups.py: only to REPORT flag disagreements
    import groups as _groups             # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)
except Exception:                        # pragma: no cover
    _groups = None

SITE = "https://en.usports.ca"
SPORT = "/sports/mbkb"
#: a browser's User-Agent: the WAF refuses python-requests' and unknown bots'
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
           "Accept-Language": "en-CA,en;q=0.9"}
STAGES = {"regular": "", "playoffs": "p", "final8": "c"}
LIST_CAP = 500
#: a played-looking fixture this soon after tip-off may still be going on
LIVE_GUARD_S = 4 * 3600
#: before this lead nothing on the site can be a result (same idea as fetchwindow.FETCH_LEAD_S)
FETCH_LEAD_S = 30 * 60
#: longest the adapter waits out the WAF for one request before giving up on it this run
WAF_MAX_WAIT_S = 240

STAT_KINDS = {"shot", "unknown_shot", "reb", "assist", "steal", "block", "turnover", "foul"}
SHOT_SUBTYPE = {"3-pt. jump shot": "jumpshot", "jump shot": "jumpshot", "layup": "layup",
                "dunk": "dunk", "tip-in": "tipin", "2-pt. field goal": ""}


# ============================================================================ a small HTML tree
class _El:
    """Just enough DOM for these pages (the standard library's parser, no dependency)."""
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.children, self.parent = tag, attrs, [], parent

    def get(self, k, d=None):
        return self.attrs.get(k, d)

    @property
    def classes(self) -> list:
        return (self.attrs.get("class") or "").split()

    def iter(self):
        stack = [self]
        while stack:
            el = stack.pop()
            yield el
            stack.extend(c for c in reversed(el.children) if isinstance(c, _El))

    def find_all(self, tag=None, cls=None, **attrs) -> list:
        want = set(cls.split()) if cls else set()
        out = []
        for el in self.iter():
            if el is self:
                continue
            if tag and el.tag != tag:
                continue
            if want and not want <= set(el.classes):
                continue
            if any(el.attrs.get(k.replace("_", "-")) != v for k, v in attrs.items()):
                continue
            out.append(el)
        return out

    def find(self, tag=None, cls=None, **attrs):
        for el in self.find_all(tag, cls, **attrs):
            return el
        return None

    def parent_with(self, tag=None, cls=None):
        p = self.parent
        while p is not None:
            if (not tag or p.tag == tag) and (not cls or cls in p.classes):
                return p
            p = p.parent
        return None

    def text(self) -> str:
        parts = []
        stack = [(self, 0)]
        while stack:                      # document order, without recursion
            el, i = stack.pop()
            while i < len(el.children):
                c = el.children[i]
                i += 1
                if isinstance(c, _El):
                    stack.append((el, i))
                    el, i = c, 0
                else:
                    parts.append(c)
        return re.sub(r"\s+", " ", " ".join(parts)).strip()


_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
         "source", "track", "wbr"}


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _El("#root", {}, None)
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        el = _El(tag, {k: (v or "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(el)
        if tag not in _VOID:
            self.stack.append(el)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(_El(tag, {k: (v or "") for k, v in attrs}, self.stack[-1]))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1].children.append(data)


def dom(html: str) -> _El:
    b = _Builder()
    b.feed(html or "")
    b.close()
    return b.root


def _txt(el) -> str:
    return el.text() if el is not None else ""


# ============================================================================ seasons, names
def season_code(start_year: int) -> str:
    return f"{int(start_year)}-{(int(start_year) + 1) % 100:02d}"


def normalize_season(token) -> Optional[str]:
    """'2026-27' | '2026/27' | '2026/2027' | '2026' (= season START year) -> '2026-27'."""
    t = str(token or "").strip()
    m = re.match(r"^(\d{4})(?:\s*[-/_]\s*(\d{2}|\d{4}))?$", t)
    if not m:
        return None
    y1 = int(m.group(1))
    if m.group(2):
        y2 = int(m.group(2))
        if y2 < 100:
            y2 += y1 - y1 % 100 + (100 if y2 < y1 % 100 else 0)
        if y2 != y1 + 1:
            return None
    return season_code(y1)


def current_season(now: Optional[datetime] = None) -> str:
    """The season the website shows: from August on, the one that starts that year."""
    now = now or datetime.now(timezone.utc)
    return season_code(now.year if now.month >= 8 else now.year - 1)


def season_of_tip(tip) -> Optional[str]:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return season_code(t.year if t.month >= 8 else t.year - 1)


def team_code(name: str) -> str:
    """A club's code: its display name folded to letters and digits - the site's stats slug."""
    s = re.sub(r"['‘’`]", "", str(name or ""))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s.replace("&", "and"))


def _fold(s) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


def _strip_rank(name: str) -> str:
    return re.sub(r"^#\d+\s+", "", (name or "").strip()).strip()


def parse_source_url(url: str) -> dict:
    """{'base', 'stage', 'season'} from a configured schedule URL.

    Season-less URLs keep the config the same every year: .../sports/mbkb/schedule is the
    regular season, the same URL with '#playoffs' or '#final8' the other two paths (run_ingest
    keys sources by URL, so each needs its own). A URL that names a season path
    (.../sports/mbkb/2025-26p/schedule) pins that season and stage."""
    u = str(url or "")
    path, _, frag = u.partition("#")
    frag = frag.strip().lower()
    by_frag = {"playoffs": "playoffs", "playoff": "playoffs", "final8": "final8", "final-8": "final8",
               "championship": "final8"}.get(frag)
    if frag and by_frag is None:
        raise ValueError(f"usports: schedule URL fragment #{frag} not understood (#playoffs or #final8)")
    m = re.search(r"/mbkb/(\d{4})-(\d{2})([pc]?)(?:/|$)", path.split("?", 1)[0])
    if m:
        return {"stage": {"p": "playoffs", "c": "final8"}.get(m.group(3), "regular"),
                "season": f"{m.group(1)}-{m.group(2)}"}
    return {"stage": by_frag or "regular", "season": None}


# ============================================================================ the schedule
_MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                       "august", "september", "october", "november", "december"], 1)}


def parse_schedule_rows(html, season_path: str, page_team: Optional[tuple] = None) -> list:
    """Every event row of a schedule page (the season list, or a ?teamId= page whose rows name
    only the opponent: page_team=(team_id, name)). `html` may be an already parsed tree."""
    root = html if isinstance(html, _El) else dom(html)
    sm = re.match(r"(\d{4})-\d{2}", season_path)
    start_year = int(sm.group(1)) if sm else None
    out = []
    for row in root.find_all("div", cls="event-row"):
        cls = row.classes
        eid = row.get("data-event-id", "")
        box = row.get("data-boxscore") or ""
        label = ""
        for a in row.find_all("a"):
            if "/boxscores/" in a.get("href", ""):
                box = box or a.get("href", "")
                label = a.get("aria-label", "") or label
        if box.startswith("/"):
            box = SITE + box
        rec = {"eid": eid, "box_url": box, "classes": cls, "season_path": season_path,
               "status_text": _txt(row.find(cls="status")), "notes": _txt(row.find(cls="event-notes")),
               "away": {}, "home": {}, "neutral": "neutral" in cls, "label": label}
        for side in ("away", "home"):
            tn = row.find(cls=f"event-team-name {side}-team")
            if tn is None:
                continue
            a = next((x for x in tn.find_all("a") if "teamId=" in x.get("href", "")), None)
            line = tn.parent_with("div", "flex-row")
            sc = line.find("div", cls="flex-shrink-1") if line else None
            img = line.find("img") if line else None
            digits = re.sub(r"\D", "", _txt(sc))
            rec[side] = {"name": _strip_rank(_txt(tn.find(cls="team-name"))),
                         "team_id": re.search(r"teamId=([a-z0-9]+)", a.get("href")).group(1) if a else "",
                         "score": int(digits) if digits else None,
                         "logo": img.get("src", "") if img else ""}
        if page_team and not rec["away"] and not rec["home"]:
            opp_el = row.find(cls="event-opponent-name")
            a = next((x for x in (opp_el.find_all("a") if opp_el else []) if "teamId=" in x.get("href", "")), None)
            img = row.find(cls="event-logo")
            img = img.find("img") if img else None
            opp = {"name": _strip_rank(_txt(opp_el.find(cls="team-name") if opp_el else None)),
                   "team_id": re.search(r"teamId=([a-z0-9]+)", a.get("href")).group(1) if a else "",
                   "score": None, "logo": img.get("src", "") if img else ""}
            me = {"name": page_team[1], "team_id": page_team[0], "score": None,
                  "logo": f"https://cdn.prestosports.com/action/cdn/logos/id/{page_team[0]}.png"}
            rm = re.search(r"\b([WLT])\b\W*(\d+)\s*-\s*(\d+)", _txt(row.find(cls="event-result")))
            if rm:
                hi, lo = int(rm.group(2)), int(rm.group(3))
                me["score"], opp["score"] = (hi, lo) if rm.group(1) == "W" else (lo, hi)
            if "home" in cls:
                rec["home"], rec["away"] = me, opp
            elif "away" in cls:
                rec["home"], rec["away"] = opp, me
            else:
                lm = re.search(r": (.+?) (?:vs\.|at) (.+?)(?::|$)", label)
                first = _strip_rank(lm.group(1)) if lm else ""
                rec["away"], rec["home"] = (me, opp) if first == me["name"] else (opp, me)
        bm = re.search(r"/boxscores/(\d{4})(\d{2})(\d{2})_", box)
        rec["date"] = f"{bm.group(1)}-{bm.group(2)}-{bm.group(3)}" if bm else ""
        if not rec["date"]:
            mon = row.parent_with("div", "section-event-month")
            dm = re.search(r"(\d{1,2})", _txt(row.find(cls="date")))
            mo = next((_MONTHS[c] for c in (mon.classes if mon else []) if c in _MONTHS), None)
            if mo and dm and start_year:
                yr = start_year if mo >= 7 else start_year + 1
                rec["date"] = f"{yr:04d}-{mo:02d}-{int(dm.group(1)):02d}"
        tm = re.search(r"\b(\d{1,2}:\d{2} [AP]M)\b", label)
        rec["time"] = tm.group(1) if tm else ""
        out.append(rec)
    return out


def team_filter(html) -> list:
    """[(team_id, name)] from the schedule page's 'filter by team' drop-down."""
    out = []
    for o in (html if isinstance(html, _El) else dom(html)).find_all("option"):
        m = re.search(r"teamId=([a-z0-9]+)", o.get("value", ""))
        if m:
            out.append((m.group(1), _txt(o)))
    return out


def _ical_unescape(v: str) -> str:
    return v.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").replace("\\N", " ").replace("\\\\", "\\")


def parse_ical(text: str) -> dict:
    """{event_id: {tip, time_tbc, venue, summary, description, url, teams}} from ?print=ical."""
    lines = []
    for ln in (text or "").splitlines():
        if ln[:1] in (" ", "\t") and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    out, cur = {}, None
    for ln in lines:
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT" and cur is not None:
            uid = re.match(r"([a-z0-9]+)@", cur.get("UID", ""))
            if uid:
                start = cur.get("DTSTART", "")
                tip, tbc = None, False
                m = re.match(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$", start)
                d = re.match(r"(\d{4})(\d{2})(\d{2})$", start)
                if m:
                    tip = datetime(*map(int, m.groups()), tzinfo=timezone.utc).isoformat()
                elif d:
                    # no time set: noon UTC keeps the calendar date in every Canadian time zone
                    tip, tbc = datetime(*map(int, d.groups()), 12, tzinfo=timezone.utc).isoformat(), True
                summ = _ical_unescape(cur.get("SUMMARY", ""))
                summ = re.sub(r"^\([^)]*\)\s*", "", summ)
                tm = re.match(r"^(.*?) (?:at|vs\.) (.*?)(?: \(\d+-\d+\))?$", summ)
                out[uid.group(1)] = {
                    "tip": tip, "time_tbc": tbc, "venue": _ical_unescape(cur.get("LOCATION", "")).strip() or None,
                    "summary": summ, "description": _ical_unescape(cur.get("DESCRIPTION", "")),
                    "url": cur.get("URL", ""),
                    "teams": (_strip_rank(tm.group(1)), _strip_rank(tm.group(2))) if tm else ("", "")}
            cur = None
        elif cur is not None and ":" in ln:
            k, v = ln.split(":", 1)
            k = k.split(";", 1)[0]
            cur.setdefault(k, v)
            if k == "DTSTART":
                cur["DTSTART"] = v
    return out


def is_exhibition(rec: dict, ical: Optional[dict] = None) -> bool:
    """The row's own flag, or its notes saying so (UQAM v St Michael's, 2025-10-08: 'Exhibition:
    NCAA Division II' in the notes, no exhibition class - the site's standings even count it)."""
    if "exhibition" in rec.get("classes", ()):
        return True
    text = (rec.get("notes") or "") + " " + ((ical or {}).get("description") or "")
    return bool(re.search(r"\b(exhibition|scrimmage)\b", text, re.I))


# ============================================================================ one game page
def _box_table(panel) -> tuple:
    """One team's box table -> (players, team_row, totals_cells)."""
    def ma(t):
        m = re.match(r"\s*(\d+)\s*-\s*(\d+)", t or "")
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

    def n(t):
        t = (t or "").strip()
        return int(t) if re.fullmatch(r"-?\d+", t) else 0

    players, team_row, totals = [], None, None
    group, seen = None, {}
    table = panel.find("table") if panel is not None else None
    if table is None:
        return players, team_row, totals
    for tr in table.find_all("tr"):
        cls = tr.classes
        if "group-head" in cls:
            g = _txt(tr).upper()
            group = "S" if "STARTER" in g else ("R" if "RESERVE" in g else group)
            continue
        cells = [c for c in tr.children if isinstance(c, _El) and c.tag == "td"]
        if "totals" in cls:
            if totals is None and len(cells) >= 13:
                totals = [_txt(c) for c in cells[:13]]
            continue
        th = next((c for c in tr.children if isinstance(c, _El) and c.tag == "th"), None)
        if th is None or len(cells) < 13:
            continue
        uni, a = th.find("span", cls="uniform"), th.find(cls="player-name")
        v = [_txt(c) for c in cells[:13]]
        fgm, fga = ma(v[1])
        tpm, tpa = ma(v[2])
        ftm, fta = ma(v[3])
        stat = {"min": n(v[0]), "fgm": fgm, "fga": fga, "fg3m": tpm, "fg3a": tpa, "ftm": ftm, "fta": fta,
                "oreb": n(v[4]), "dreb": n(v[5]), "treb": n(v[6]), "ast": n(v[7]), "stl": n(v[8]),
                "blk": n(v[9]), "tov": n(v[10]), "pf": n(v[11]), "pts": n(v[12])}
        shirt = _txt(uni)
        if uni is None or a is None or not shirt or shirt.upper() == "TM":
            team_row = stat
            continue
        key = _norm_shirt(shirt)
        seen[key] = seen.get(key, 0) + 1
        # the pno: "j" + shirt (never a bare "0" - translate and stints read pno "0" as "no
        # player"); #0 and #00 stay two players, and a shirt printed twice gets its own slot
        pno = f"j{key}" if seen[key] == 1 else f"j{key}-{seen[key]}"
        stat.update({"jersey": pno, "shirt": shirt, "raw_name": _txt(a),
                     "name": re.sub(r"\s+", " ", _txt(a)).strip(), "starter": group == "S"})
        players.append(stat)
    return players, team_row, totals


def _norm_shirt(s: str) -> str:
    s = str(s).strip()
    if s.isdigit():
        return s if set(s) == {"0"} and len(s) <= 2 else str(int(s))
    return s


def parse_box(html: str) -> dict:
    """Box score, line score, status and per-period minutes. teams[0] visitor, teams[1] home
    (the page's order)."""
    root = dom(html)
    out = {"teams": [], "date": "", "time": "", "location": "", "n_periods": 0, "period_min": {},
           "status_text": "", "linescore": {0: {}, 1: {}}, "org": ["", ""], "team_ids": ["", ""]}
    for side, key in ((0, "v"), (1, "h")):
        panel = root.find(data_panel_for=f"team-label-boxscore-{key}")
        name = _txt(root.find(id=f"team-label-boxscore-{key}"))
        cap = panel.find(cls="team-name") if panel is not None else None
        if cap is not None and _txt(cap):
            name = _txt(cap)
        sc = root.find(cls="team-score " + ("visitor" if side == 0 else "home"))
        digits = re.sub(r"\D", "", _txt(sc))
        players, team_row, totals = _box_table(panel)
        out["teams"].append({"name": _strip_rank(name), "score": int(digits) if digits else None,
                             "players": players, "team_row": team_row, "totals": totals})
    article = root.find("article", cls="game-boxscore") or root
    head = article.find("div", cls="head")
    if head is not None:
        for side, cls in ((0, "visitor"), (1, "home")):
            t = head.find("div", cls=f"team {cls}")
            img = t.find("img") if t is not None else None
            m = re.search(r"/logos/rpi/([A-Za-z0-9]+)/", img.get("src", "") if img else "")
            out["org"][side] = m.group(1) if m else ""
    ls = article.find("div", cls="linescore")
    if ls is not None:
        rows = ls.find_all("tr")
        if rows:
            hdr = [_txt(c) for c in rows[0].children if isinstance(c, _El) and c.tag in ("th", "td")]
            out["status_text"] = hdr[0] if hdr else ""
            cols = hdr[1:]
            for side, tr in enumerate(rows[1:3]):
                cells = [_txt(c) for c in tr.children if isinstance(c, _El) and c.tag in ("th", "td")]
                a = tr.find("a")
                m = re.search(r"teams\?id=([a-z0-9]+)", a.get("href", "") if a else "")
                if m:
                    out["team_ids"][side] = m.group(1)
                for col, val in zip(cols, cells[1:]):
                    if re.fullmatch(r"\d+", col) and re.fullmatch(r"\d+", val):
                        out["linescore"][side][int(col)] = int(val)
                    elif re.fullmatch(r"(\d*)OT", col.upper()) and re.fullmatch(r"\d+", val):
                        k = re.fullmatch(r"(\d*)OT", col.upper()).group(1)
                        out["linescore"][side][4 + (int(k) if k else 1)] = int(val)
    info = {}
    for tr in root.find_all("tr"):
        th = next((c for c in tr.children if isinstance(c, _El) and c.tag == "th"), None)
        k = _txt(th) if th is not None else ""
        if k in ("Date/Time", "Location") and k not in info:
            info[k] = _txt(tr.find("td"))
    dm = re.match(r"([A-Z][a-z]+ \d{1,2}, \d{4})(?:\s*-\s*(.*))?", info.get("Date/Time", ""))
    if dm:
        try:
            out["date"] = datetime.strptime(dm.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
        out["time"] = (dm.group(2) or "").strip()
    out["location"] = info.get("Location", "")
    prds = [int(e.get("id")[3:]) for e in root.find_all("span") if re.fullmatch(r"prd\d+", e.get("id", ""))]
    out["n_periods"] = max(prds or [0])
    for p in range(1, out["n_periods"] + 1):
        for side, key in ((0, "v"), (1, "h")):
            panel = root.find(data_panel_for=f"team-label-period{p}-{key}")
            if panel is not None:
                pl, _, _ = _box_table(panel)
                out["period_min"].setdefault(p, {})[side] = {x["jersey"]: x["min"] for x in pl}
    out["_root"] = root
    return out


def parse_pbp_rows(html_or_root) -> list:
    """Play-by-play rows in page order: {'period','clock','side' (0 visitor/1 home),'text','vs','hs'}."""
    root = html_or_root if isinstance(html_or_root, _El) else dom(html_or_root)
    sec = root.find(id="pbp-tabpanel") or root
    period, rows = 0, []
    for el in sec.iter():
        if el.tag == "span":
            m = re.fullmatch(r"prd(\d+)", el.get("id", ""))
            if m:
                period = int(m.group(1))
            continue
        if el.tag != "tr":
            continue
        cls = el.classes
        if not period or "row" not in cls:
            continue
        side = 1 if "home" in cls else (0 if "visitor" in cls else None)
        if side is None:
            continue
        texts = [t for t in (_txt(s) for td in el.find_all("td", cls="play") for s in td.find_all("span", cls="text")) if t]
        if not texts:
            continue
        vs, hs = el.find(cls="v-score"), el.find(cls="h-score")
        vt, ht = re.sub(r"\D", "", _txt(vs)), re.sub(r"\D", "", _txt(hs))
        rows.append({"period": period, "clock": _txt(el.find("td", cls="time")), "side": side, "text": texts[0],
                     "vs": int(vt) if vt else None, "hs": int(ht) if ht else None})
    return rows


# StatCrew play grammar (every template seen in a 25-game inventory, 2024-26):
#   'X made|missed 3-pt. jump shot|jump shot|layup|dunk|tip-in|free throw'
#   'X {JUMPER=missed jump shot, 3PTR=..., ...}'  (a shot with no type: a renderer bug)
#   'X offensive|defensive|deadball rebound'      (X may be TEAM)
#   'Assist|Steal|Block|Turnover|Foul|Technical Foul by X'
#   'X enters the game' / 'X goes to the bench'
#   'FULL|TEAM|30SEC TIMEOUT by <club>'
# A charge has no text of its own: it is 'Foul by X' + 'Turnover by X', and the box counts both.
_RE_SHOT = re.compile(r"^(?P<who>.+?) (?P<mm>made|missed) (?P<kind>3-pt\. jump shot|jump shot|layup|"
                      r"dunk|tip-in|2-pt\. field goal|free throw)$")
_RE_UNTYPED = re.compile(r"^(?P<who>.+?) \{JUMPER=(?P<mm>made|missed) jump shot,.*\}$")
_RE_REB = re.compile(r"^(?P<who>.+?) (?P<kind>offensive|defensive|deadball) rebound$")
_RE_BY = re.compile(r"^(?P<kind>Assist|Steal|Block|Turnover|Foul|Technical Foul) by (?P<who>.+)$")
_RE_SUB = re.compile(r"^(?P<who>.+?) (?P<kind>enters the game|goes to the bench)$")
_RE_TIMEOUT = re.compile(r"^(?P<kind>[A-Z0-9]+ )?TIMEOUT\b", re.I)


def classify(text: str) -> tuple:
    """-> (kind, who, detail); kind: shot / unknown_shot / reb / sub / assist / steal / block /
    turnover / foul / tech / timeout / UNKNOWN."""
    m = _RE_SHOT.match(text)
    if m:
        return "shot", m.group("who"), (m.group("mm"), m.group("kind"))
    m = _RE_UNTYPED.match(text)
    if m:
        return "unknown_shot", m.group("who"), (m.group("mm"), None)
    m = _RE_REB.match(text)
    if m:
        return "reb", m.group("who"), m.group("kind")
    m = _RE_SUB.match(text)
    if m:
        return "sub", m.group("who"), "in" if m.group("kind").startswith("enters") else "out"
    m = _RE_BY.match(text)
    if m:
        k = m.group("kind").lower()
        return ("tech" if k == "technical foul" else k), m.group("who"), None
    m = _RE_TIMEOUT.match(text)
    if m:
        return "timeout", None, (m.group("kind") or "").strip().upper()
    return "UNKNOWN", None, text


def _resolve_name(raw: str, players: list, cache: dict):
    """PBP 'LAST,FIRST (NICK)' -> the box player (same club), or None."""
    if raw in cache:
        return cache[raw]
    clean = re.sub(r"\s*\([^)]*\)", "", raw).strip()
    if "," in clean:
        last, first = clean.split(",", 1)
    else:
        parts = clean.split()
        last, first = (parts[-1], " ".join(parts[:-1])) if len(parts) > 1 else (clean, "")
    fl, ff = _fold(last), _fold(first)
    best = None
    for p in players:
        fb = _fold(re.sub(r"\s*\([^)]*\)", "", p["raw_name"]))
        if fb and fb in (ff + fl, fl + ff):
            best = p
            break
    if best is None and fl:
        hits = [p for p in players if _fold(p["raw_name"]).endswith(fl)]
        if len(hits) > 1 and ff:
            hits = [p for p in hits if _fold(p["raw_name"]).startswith(ff[:3])]
        if len(hits) == 1:
            best = hits[0]
    if best is None and players:
        scored = sorted(((SequenceMatcher(None, ff + fl, _fold(p["raw_name"])).ratio(), i)
                         for i, p in enumerate(players)), reverse=True)
        if scored[0][0] >= 0.75 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.1):
            best = players[scored[0][1]]
    cache[raw] = best
    return best


def period_len(p: int) -> int:
    return 600 if p <= 4 else 300


def period_base(p: int) -> int:
    return (p - 1) * 600 if p <= 4 else 2400 + (p - 5) * 300


def elapsed_of(period: int, clock: str) -> int:
    m = re.match(r"(\d+):(\d+)", clock or "")
    rem = int(m.group(1)) * 60 + int(m.group(2)) if m else 0
    return period_base(period) + period_len(period) - min(rem, period_len(period))


def gt_of(period: int, elapsed: float) -> str:
    rem = int(max(0, min(period_len(period), period_base(period) + period_len(period) - elapsed)))
    return "%02d:%02d" % (rem // 60, rem % 60)


def resolve_events(box: dict, rows: list) -> tuple:
    """PBP rows -> events with the actor resolved to a box player (jersey key) per club.

    A name in neither box is a StatCrew ghost entry (verified: its stats are in no player's box
    line, and its points are in the final score): jersey None, kept as a team-level play."""
    caches = {0: {}, 1: {}}
    events, unknown, ghosts = [], [], {}
    for r in rows:
        kind, who, det = classify(r["text"])
        e = {"period": r["period"], "clock": r["clock"], "elapsed": elapsed_of(r["period"], r["clock"]),
             "team_idx": r["side"], "kind": kind, "detail": det, "jersey": None, "team": False,
             "raw": r["text"], "vs": r["vs"], "hs": r["hs"], "who": who}
        if kind == "UNKNOWN":
            unknown.append(r["text"])
        if who and who.strip().upper() == "TEAM":
            e["team"] = True
        elif who:
            s = r["side"]
            hit = _resolve_name(who, box["teams"][s]["players"], caches[s])
            if hit is None:
                other = _resolve_name(who, box["teams"][1 - s]["players"], caches[1 - s])
                if other is not None:
                    hit, e["team_idx"] = other, 1 - s
            if hit is not None:
                e["jersey"] = hit["jersey"]
            else:
                ghosts[(s, who)] = ghosts.get((s, who), 0) + 1
        events.append(e)
    return events, unknown, ghosts


def box_guided(box: dict, events: list) -> tuple:
    """(tech_budget, notes): what the text cannot say, settled by the site's own box.
    Technical fouls count in PF for some crews and not others (verified both ways); an untyped
    shot is settled by the score change (made) or the shooter's missing 3PA/FTA (missed)."""
    known = {}
    for e in events:
        if e["jersey"] is None:
            continue
        c = known.setdefault((e["team_idx"], e["jersey"]), {"pf": 0, "tech": 0, "fta": 0, "fg3a": 0})
        if e["kind"] == "foul":
            c["pf"] += 1
        elif e["kind"] == "tech":
            c["tech"] += 1
        elif e["kind"] == "shot":
            if e["detail"][1] == "free throw":
                c["fta"] += 1
            elif e["detail"][1].startswith("3-pt"):
                c["fg3a"] += 1
    boxp = {(s, p["jersey"]): p for s in (0, 1) for p in box["teams"][s]["players"]}
    tech_budget, notes = {}, []
    for key, c in known.items():
        if c["tech"]:
            bp = boxp.get(key)
            tech_budget[key] = c["tech"] if bp is None else max(0, min(c["tech"], bp["pf"] - c["pf"]))
            if tech_budget[key] != c["tech"]:
                notes.append(f"#{key[1]} {box['teams'][key[0]]['name']}: {c['tech'] - tech_budget[key]} "
                             f"technical foul(s) not in the box PF")
    prev = (0, 0)
    for e in events:
        if e["kind"] == "unknown_shot":
            mm, kind = e["detail"][0], None
            if mm == "made" and e["vs"] is not None and e["hs"] is not None:
                delta = (e["vs"], e["hs"])[e["team_idx"]] - prev[e["team_idx"]]
                kind = {3: "3-pt. jump shot", 2: "jump shot", 1: "free throw"}.get(delta)
            if kind is None and e["jersey"] is not None:
                bp = boxp.get((e["team_idx"], e["jersey"]))
                c = known.setdefault((e["team_idx"], e["jersey"]), {"pf": 0, "tech": 0, "fta": 0, "fg3a": 0})
                if bp and bp["fg3a"] - c["fg3a"] > 0:
                    kind = "3-pt. jump shot"
                    c["fg3a"] += 1
                elif bp and bp["fta"] - c["fta"] > 0:
                    kind = "free throw"
                    c["fta"] += 1
            e["kind"], e["detail"] = "shot", (mm, kind or "2-pt. field goal")
            e["untyped"] = True
        if e["vs"] is not None and e["hs"] is not None:
            prev = (e["vs"], e["hs"])
    return tech_budget, notes


# ---------------------------------------------------------------------------- lineups
def _start_cost(S5, pev, p, s, pmin, prior, prior_w, end) -> float:
    """Replay a period's logged substitutions from opening five S5; the cost is how far the
    minutes that gives are from the period's own box minutes (StatCrew computes those from the
    crew's lineup, including the quarter-break change it never prints), plus light penalties for
    contradicted evidence."""
    on = set(S5)
    secs = {}
    base = period_base(p)
    last, conflicts, size_err = base, 0, 0.0
    for e in pev:
        if e["team_idx"] != s or e["jersey"] is None:
            continue
        t = e["elapsed"]
        if t > last:
            for j in on:
                secs[j] = secs.get(j, 0) + t - last
            size_err += (t - last) * abs(len(on) - 5)
            last = t
        if e["kind"] == "sub":
            if (e["jersey"] in on) == (e["detail"] == "in"):
                conflicts += 1
            (on.add if e["detail"] == "in" else on.discard)(e["jersey"])
        elif e["kind"] in STAT_KINDS and e["jersey"] not in on:
            conflicts += 1
    if end > last:
        for j in on:
            secs[j] = secs.get(j, 0) + end - last
        size_err += (end - last) * abs(len(on) - 5)
    merr = sum(max(0.0, abs(secs.get(j, 0) / 60.0 - pmin.get(j, 0)) - 0.5) for j in set(pmin) | set(secs))
    return merr + 0.5 * conflicts + 5.0 * size_err / 60.0 + prior_w * len(set(S5) - set(prior))


def _next_evidence(pev, k0, s, j) -> int:
    """+2: the next thing the log says about j (after k0) puts him on court; -2: off; 0: nothing."""
    for e in pev[k0:]:
        if e["team_idx"] != s or e["jersey"] != j:
            continue
        if e["kind"] == "sub":
            return 2 if e["detail"] == "out" else -2
        if e["kind"] in STAT_KINDS:
            return 2
    return 0


def _reorder_same_clock(pev: list) -> list:
    """Within one clock value: a LEAVING player's plays before the sub rows, an ENTERING player's
    after them (operators type the two in either order; at one clock value order is not time)."""
    out, i = [], 0
    while i < len(pev):
        j = i
        while j < len(pev) and pev[j]["elapsed"] == pev[i]["elapsed"]:
            j += 1
        run = pev[i:j]
        ins = {(e["team_idx"], e["jersey"]) for e in run if e["kind"] == "sub" and e["detail"] == "in"}
        outs = {(e["team_idx"], e["jersey"]) for e in run if e["kind"] == "sub" and e["detail"] == "out"}
        if ins or outs:
            def grp(e):
                if e["kind"] == "sub" or e["jersey"] is None:
                    return 1
                key = (e["team_idx"], e["jersey"])
                if key in outs and key not in ins:
                    return 0
                if key in ins and key not in outs:
                    return 2
                return 1
            run = sorted(run, key=grp)
        out.extend(run)
        i = j
    return out


def _one_flush_per_clock(events: list) -> list:
    """Each (period, clock) run as: plays by players leaving, other plays, ALL substitutions of
    both clubs as one block, plays by players entering. One block = one lineup change per clock
    value, so no lineup is ever zero seconds long."""
    out, i = [], 0
    while i < len(events):
        j = i
        while j < len(events) and (events[j]["period"], events[j]["elapsed"]) == \
                (events[i]["period"], events[i]["elapsed"]):
            j += 1
        run = events[i:j]
        subs = [e for e in run if e["kind"] == "sub"]
        if subs:
            ins = {(e["team_idx"], e["jersey"]) for e in subs if e["detail"] == "in"}
            outs = {(e["team_idx"], e["jersey"]) for e in subs if e["detail"] == "out"}

            def grp(e):
                if e["kind"] == "sub":
                    return 2
                key = (e["team_idx"], e["jersey"])
                if e["jersey"] is not None and key in outs and key not in ins:
                    return 0
                if e["jersey"] is not None and key in ins and key not in outs:
                    return 3
                return 1
            run = sorted(run, key=grp)
        out.extend(run)
        i = j
    return out


def repair_lineups(box: dict, events: list, live_end: Optional[int] = None,
                   tech_budget: Optional[dict] = None) -> tuple:
    """(events, notes): the play-by-play with every substitution a real, balanced change and
    every period opening with its inferred five (see the module note). `live_end`: the elapsed
    second the play has reached in a game still in progress (the current period is only that
    long so far). `tech_budget`: box_guided's count of each player's technicals that are PF."""
    notes = {}
    fouls: dict = {}                       # (side, jersey) -> fouls so far (5 = disqualified)
    techs = dict(tech_budget or {})
    starters = {s: {p["jersey"] for p in box["teams"][s]["players"] if p["starter"]} for s in (0, 1)}
    roster = {s: [p["jersey"] for p in box["teams"][s]["players"]] for s in (0, 1)}
    for s in (0, 1):
        if len(starters[s]) != 5:
            ranked = sorted(box["teams"][s]["players"], key=lambda p: -p["min"])
            starters[s] = {p["jersey"] for p in ranked[:5]}
            notes["starters_from_minutes"] = notes.get("starters_from_minutes", 0) + 1
    n_periods = max([box.get("n_periods") or 0] + [e["period"] for e in events])
    on = {s: set(starters[s]) for s in (0, 1)}
    out = []
    for p in range(1, n_periods + 1):
        pev = _reorder_same_clock([e for e in events if e["period"] == p])
        base = period_base(p)
        end = base + period_len(p)
        if live_end is not None and base <= live_end < end:
            end = live_end
        for s in (0, 1):
            pmin = box.get("period_min", {}).get(p, {}).get(s, {})
            first = {}
            for e in pev:
                if e["team_idx"] != s or e["jersey"] is None:
                    continue
                d = first.setdefault(e["jersey"], {"sub": None, "sub_t": None, "stat_t": None, "n": 0})
                if e["kind"] == "sub" and d["sub"] is None:
                    d["sub"], d["sub_t"] = e["detail"], e["elapsed"]
                elif e["kind"] in STAT_KINDS:
                    d["n"] += 1
                    if d["stat_t"] is None:
                        d["stat_t"] = e["elapsed"]
            st_on, st_off = set(), set()
            for j, d in first.items():
                if d["sub"] is not None and (d["stat_t"] is None or d["stat_t"] >= d["sub_t"]):
                    (st_on if d["sub"] == "out" else st_off).add(j)
                elif d["stat_t"] is not None:
                    st_on.add(j)
            for j in roster[s]:
                if pmin.get(j, 0) > 0 and j not in first:
                    st_on.add(j)
            prior = starters[s] if p == 1 else on[s]
            if len(st_on) < 5:
                fill = [j for j in sorted(prior, key=lambda j: -pmin.get(j, 0)) if j not in st_on and j not in st_off]
                fill += [j for j in sorted(roster[s], key=lambda j: -pmin.get(j, 0))
                         if j not in st_on and j not in st_off and j not in fill]
                for j in fill[:5 - len(st_on)]:
                    st_on.add(j)
            if len(st_on) > 5:
                # sorted() first everywhere a set is ranked: ties must not follow the hash seed,
                # or the same page gives a different payload (and hash) in the next process
                st_on = set(sorted(sorted(st_on), key=lambda j: ((first.get(j) or {}).get("sub") == "out", j in prior,
                                                                 pmin.get(j, 0), (first.get(j) or {}).get("n", 0)),
                                   reverse=True)[:5])
            if pmin:
                involved = {e["jersey"] for e in pev if e["team_idx"] == s and e["jersey"] is not None}
                pool = [j for j in roster[s] if j in involved or pmin.get(j, 0) > 0 or j in prior or j in st_on]
                if len(pool) > 14:
                    pool = sorted(pool, key=lambda j: (-pmin.get(j, 0), j not in st_on))[:14]
                if len(pool) >= 5:
                    best, best_c = None, None
                    for S5 in combinations(sorted(pool), 5):
                        c = _start_cost(S5, pev, p, s, pmin, prior, 1.0 if p == 1 else 0.05, end)
                        if best_c is None or c < best_c - 1e-9 or (
                                abs(c - best_c) < 1e-9 and len(set(S5) & st_on) > len(set(best) & st_on)):
                            best, best_c = S5, c
                    st_on = set(best)
            if p == 1 and st_on != starters[s]:
                notes["p1_five_differs_from_box_starters"] = notes.get("p1_five_differs_from_box_starters", 0) + 1
            for j, det in [(j, "out") for j in sorted(on[s] - st_on)] + [(j, "in") for j in sorted(st_on - on[s])]:
                out.append({"period": p, "clock": gt_of(p, base), "elapsed": base, "team_idx": s, "kind": "sub",
                            "detail": det, "jersey": j, "team": False, "raw": "period-start five (inferred)",
                            "vs": None, "hs": None, "synthetic": True, "period_start": True})
            if st_on != on[s]:
                notes["period_start_changes"] = notes.get("period_start_changes", 0) + 1
            on[s] = set(st_on)
        groups = {}
        for k, e in enumerate(pev):
            if e["kind"] == "sub" and e["jersey"] is not None:
                groups.setdefault((e["team_idx"], e["elapsed"]), []).append(k)
        first_k = {v[0]: key for key, v in groups.items()}
        pm_p = box.get("period_min", {}).get(p, {})
        swap_back = []

        def _sub(e0, s, j, det, why):
            return dict(e0, kind="sub", detail=det, jersey=j, team_idx=s, synthetic=True, raw=why)

        run_start, t_prev, n_ins, run_batches = len(out), base, 0, set()
        for k, e in enumerate(pev):
            if k == 0 or e["elapsed"] != pev[k - 1]["elapsed"]:
                # a new clock value: entries forced by a play at this clock are back-dated to the
                # previous clock value, so the play never sits in a zero-second lineup
                run_start, n_ins, run_batches = len(out), 0, set()
                t_prev = pev[k - 1]["elapsed"] if k > 0 else base
            # a temporary entry ends at the next clock value
            for sb in [x for x in swap_back if e["elapsed"] > x["t"]]:
                swap_back.remove(sb)
                s = sb["s"]
                if sb["j"] in on[s] and sb["k"] not in on[s]:
                    pair = [_sub(e, s, sb["j"], "out", "temporary entry ends"),
                            _sub(e, s, sb["k"], "in", "temporary entry ends")]
                    for sd in pair:
                        sd["elapsed"] = t_prev
                    out[run_start + n_ins:run_start + n_ins] = pair
                    n_ins += 2
                    on[s] = (on[s] - {sb["j"]}) | {sb["k"]}
            if not (e["kind"] == "sub" and e["jersey"] is not None):
                s, j = e["team_idx"], e["jersey"]
                if j is not None and (e["kind"] == "foul" or (e["kind"] == "tech" and techs.get((s, j), 0) > 0)):
                    if e["kind"] == "tech":
                        techs[(s, j)] -= 1
                    fouls[(s, j)] = fouls.get((s, j), 0) + 1
                if j is not None and e["kind"] in STAT_KINDS and j not in on[s]:
                    # a play by a player the reconstruction has on the bench. What the log says
                    # next about him decides how he gets on:
                    #  - his next sub is an ENTRY within 45 s: the entry was logged late - pull
                    #    it forward, pairing him with a player that batch takes off
                    #  - his next sub is an entry later, or none and no minutes this period: the
                    #    crew credited a player who was not on (its own minutes agree) - a
                    #    TEMPORARY entry, ended at the next clock value
                    #  - otherwise (the log has him on): on court from here (forced entry)
                    nxt = None
                    for x in range(k + 1, len(pev)):
                        f = pev[x]
                        if f["team_idx"] == s and f["jersey"] == j and f["kind"] == "sub":
                            nxt = f
                            break
                    cand = sorted(on[s])
                    rank = lambda c: (_next_evidence(pev, k + 1, s, c), pm_p.get(s, {}).get(c, 0))  # noqa: E731
                    kout, temporary = None, False
                    if nxt is not None and nxt["detail"] == "in" and nxt["elapsed"] - e["elapsed"] <= 45:
                        bkey = (s, nxt["elapsed"])
                        b_outs = [pev[x]["jersey"] for x in groups.get(bkey, [])
                                  if pev[x]["detail"] == "out" and pev[x]["jersey"] in on[s]]
                        kout = min(b_outs, key=rank) if b_outs else None
                        notes["late_entries_pulled_forward"] = notes.get("late_entries_pulled_forward", 0) + 1
                    elif (nxt is not None and nxt["detail"] == "in") or fouls.get((s, j), 0) >= 5 or (
                            nxt is None and pm_p.get(s, {}).get(j, 0) == 0):
                        # (five fouls: he is disqualified, so the play cannot be his for long)
                        temporary = True
                        notes["temporary_entries"] = notes.get("temporary_entries", 0) + 1
                    else:
                        notes["forced_entries"] = notes.get("forced_entries", 0) + 1
                    if kout is None and cand:
                        kout = min(cand, key=rank)
                    if kout is not None:
                        pair = [_sub(e, s, kout, "out", "play by off-court player"),
                                _sub(e, s, j, "in", "play by off-court player")]
                        if s in run_batches:
                            out.extend(pair)
                        else:
                            for sd in pair:
                                sd["elapsed"] = t_prev
                            out[run_start + n_ins:run_start + n_ins] = pair
                            n_ins += 2
                        on[s] = (on[s] - {kout}) | {j}
                        swap_back = [x for x in swap_back if x["s"] != s or kout not in (x["j"], x["k"])]
                        if temporary:
                            swap_back.append({"s": s, "j": j, "k": kout, "t": e["elapsed"]})
                out.append(e)
                continue
            key = first_k.get(k)
            if key is None:
                continue
            s = key[0]
            run_batches.add(s)
            bplayers = {pev[x]["jersey"] for x in groups[key]}
            swap_back = [x for x in swap_back if x["s"] != s or not ({x["j"], x["k"]} & bplayers)]
            batch = [pev[x] for x in groups[key]]
            after = groups[key][-1] + 1
            ins = [b["jersey"] for b in batch if b["detail"] == "in"]
            outs = [b["jersey"] for b in batch if b["detail"] == "out"]
            for j in sorted(set(ins) & set(outs)):
                ci, co = ins.count(j), outs.count(j)
                ins = [x for x in ins if x != j] + [j] * max(0, ci - co)
                outs = [x for x in outs if x != j] + [j] * max(0, co - ci)
            eff_in = [j for j in dict.fromkeys(ins) if j not in on[s]]
            eff_out = [j for j in dict.fromkeys(outs) if j in on[s]]
            dropped = (len(ins) - len(eff_in)) + (len(outs) - len(eff_out))
            if dropped:
                notes["noop_subs_dropped"] = notes.get("noop_subs_dropped", 0) + dropped
            new = (on[s] - set(eff_out)) | set(eff_in)
            if len(new) > 5:
                notes["sub_batches_rebalanced"] = notes.get("sub_batches_rebalanced", 0) + 1
                for j in sorted(sorted(new), key=lambda j: (_next_evidence(pev, after, s, j), j in eff_in))[:len(new) - 5]:
                    if j in eff_in:
                        eff_in.remove(j)
                    else:
                        eff_out.append(j)
            elif len(new) < 5:
                notes["sub_batches_rebalanced"] = notes.get("sub_batches_rebalanced", 0) + 1
                pool = [j for j in roster[s] if j not in new]
                pm = pm_p.get(s, {})
                for j in sorted(pool, key=lambda j: (_next_evidence(pev, after, s, j), j in eff_out,
                                                     pm.get(j, 0)), reverse=True)[:5 - len(new)]:
                    if j in eff_out:
                        eff_out.remove(j)
                    else:
                        eff_in.append(j)
            for j in eff_out:
                out.append(dict(e, detail="out", jersey=j, synthetic=j not in outs))
            for j in eff_in:
                out.append(dict(e, detail="in", jersey=j, synthetic=j not in ins))
            on[s] = (on[s] - set(eff_out)) | set(eff_in)
    return _one_flush_per_clock(out), notes


# ---------------------------------------------------------------------------- FIBA shape
def _split_name(display: str, pbp_forms: list) -> tuple:
    """(first, last) of a box name, the family name taken from the play-by-play's 'LAST,FIRST'."""
    display = re.sub(r"\s*\([^)]*\)", "", display or "").strip()
    words = display.split()
    for form in pbp_forms:
        last = re.sub(r"\s*\([^)]*\)", "", form.split(",", 1)[0]).strip()
        fl = _fold(last)
        if not fl:
            continue
        for i in range(len(words) - 1, 0, -1):
            if _fold(" ".join(words[i:])) == fl:
                return " ".join(words[:i]), " ".join(words[i:])
    if len(words) > 1:
        return " ".join(words[:-1]), words[-1]
    return "", display


def _mmss(minutes) -> str:
    return "%d:00" % int(S.num(minutes))


def raw_from_page(html: str, *, event_id: str = "", season_path: str = "", box_url: str = "",
                  final: Optional[bool] = None) -> Optional[dict]:
    """One U SPORTS game page -> FIBA data.json shape (tm["1"] = HOME). Pure: same page, same
    payload. None when the page has no box score or no play yet.

    `final`: None = what the page says (the line score's 'Final ...'); a caller can only ever
    make it stricter (False), never declare a game over that the page does not."""
    box = parse_box(html)
    if len(box["teams"]) != 2 or not all(t["players"] for t in box["teams"]):
        return None
    for t in box["teams"]:                 # a box that does not list five starters: the five who played most
        if sum(1 for p in t["players"] if p["starter"]) != 5:
            top = {id(p) for p in sorted(t["players"], key=lambda p: -p["min"])[:5]}
            for p in t["players"]:
                p["starter"] = id(p) in top
    rows = parse_pbp_rows(box.pop("_root"))
    if not rows:
        return None
    says_final = box["status_text"].lower().startswith("final")
    finished = says_final if final is None else (says_final and bool(final))
    events, unknown, ghosts = resolve_events(box, rows)
    tech_budget, tech_notes = box_guided(box, events)
    live_end = None if finished else max(e["elapsed"] for e in events)
    events, notes = repair_lineups(box, events, live_end=live_end, tech_budget=tech_budget)
    tno_of = {1: 1, 0: 2}                  # page side (0 visitor, 1 home) -> FIBA tno (1 home)
    players = {s: {p["jersey"]: p for p in box["teams"][s]["players"]} for s in (0, 1)}

    def pno_of(s, j):
        return str(j) if (s is not None and j is not None and j in players[s]) else ""

    # free-throw trips: one shooter at one clock time, in page order
    trips: dict = {}
    for i, e in enumerate(events):
        if e["kind"] == "shot" and e["detail"][1] == "free throw":
            trips.setdefault((e["team_idx"], e["jersey"] or e.get("who") or "", e["period"], e["elapsed"]), []).append(i)
    ft_label = {i: (n, len(v)) for v in trips.values() for n, i in enumerate(v, 1)}

    pbp: list = []

    def ev(period, elapsed, s, action, sub="", j=None, success=None, **extra):
        e = {"actionType": action, "subType": sub, "period": period, "gt": gt_of(period, elapsed),
             "tno": tno_of[s] if s is not None else 0, "pno": pno_of(s, j)}
        if success is not None:
            e["success"] = 1 if success else 0
        e.update(extra)
        pbp.append(e)
        return e

    n_periods = max([box["n_periods"] or 0] + [e["period"] for e in events])
    cur = 1
    ev(1, 0, None, "period", "start")
    last_miss_team = None
    for i, e in enumerate(events):
        p = e["period"]
        while p > cur:
            ev(cur, period_base(cur) + period_len(cur), None, "period", "end")
            cur += 1
            ev(cur, period_base(cur), None, "period", "start")
        k, d, s, j, t = e["kind"], e["detail"], e["team_idx"], e["jersey"], e["elapsed"]
        if k == "sub":
            if j is not None:
                ev(p, t, s, "substitution", d, j)
        elif k == "shot":
            mm, kind = d
            made = mm == "made"
            if kind == "free throw":
                n, m = ft_label.get(i, (1, 1))
                ev(p, t, s, "freethrow", f"{n}of{m}", j, success=made)
            else:
                ev(p, t, s, "3pt" if kind.startswith("3-pt") else "2pt", SHOT_SUBTYPE.get(kind, ""), j, success=made)
                if not made:
                    last_miss_team = s
        elif k == "reb":
            kind = d
            if kind == "deadball":
                # a TEAM dead-ball rebound is no stat and no possession change; a PLAYER's is in
                # his box REB (8 of 8 checked: all defensive, after an opponent's miss)
                kind = None if j is None else ("offensive" if last_miss_team == s else "defensive")
            if kind and j is not None:
                ev(p, t, s, "rebound", kind, j)
            elif kind:
                ev(p, t, s, "rebound", kind, qualifier=["team"])
        elif k in ("assist", "steal", "block"):
            if j is not None:
                ev(p, t, s, k, "", j)
        elif k == "turnover":
            if j is not None:
                ev(p, t, s, "turnover", "", j)
            else:
                ev(p, t, s, "turnover", "", qualifier=["team"])
        elif k == "foul":
            if j is not None:
                ev(p, t, s, "foul", "personal", j)
            elif e["team"]:
                ev(p, t, s, "foul", "personal", qualifier=["team"])       # 'Foul by TEAM' (the box's TM row)
        elif k == "tech":
            key = (s, j)
            if j is not None and tech_budget.get(key, 0) > 0:
                tech_budget[key] -= 1
                ev(p, t, s, "foul", "technical", j)
            elif j is not None:
                ev(p, t, s, "foul", "technical")                           # the crew did not count it as his PF
            else:
                ev(p, t, s, "foul", "benchtechnical")
        elif k == "timeout":
            ev(p, t, s, "timeout", "short" if (d or "").startswith(("30", "20")) else "full")
    if finished:
        ev(cur, period_base(cur) + period_len(cur), None, "period", "end")
        ev(cur, period_base(cur) + period_len(cur), None, "game", "end")
    for n, e in enumerate(pbp, start=1):
        e["actionNumber"] = n

    # what the box does not carry, read off the stream: +/-, blocks received
    on = {1: set(), 2: set()}
    for s in (0, 1):
        on[tno_of[s]] = {p["jersey"] for p in box["teams"][s]["players"] if p["starter"]}
        if len(on[tno_of[s]]) != 5:
            on[tno_of[s]] = {x["jersey"] for x in sorted(box["teams"][s]["players"], key=lambda p: -p["min"])[:5]}
    pm, br = {}, {}
    for idx, e in enumerate(pbp):
        at, tno, pn = e["actionType"], e["tno"], e["pno"]
        if at == "substitution" and pn:
            (on[tno].discard if e["subType"] == "out" else on[tno].add)(pn)
        elif at in ("2pt", "3pt", "freethrow") and e.get("success") == 1 and tno:
            pts = {"2pt": 2, "3pt": 3, "freethrow": 1}[at]
            for q in on[tno]:
                pm[(tno, q)] = pm.get((tno, q), 0) + pts
            for q in on[3 - tno]:
                pm[(3 - tno, q)] = pm.get((3 - tno, q), 0) - pts
        elif at == "block" and tno:
            for back in pbp[max(0, idx - 4):idx][::-1]:
                if back["actionType"] in ("2pt", "3pt") and back["tno"] == 3 - tno and back.get("success") == 0 \
                        and back["period"] == e["period"] and back["gt"] == e["gt"] and back["pno"]:
                    br[(back["tno"], back["pno"])] = br.get((back["tno"], back["pno"]), 0) + 1
                    break

    # the shots no box player owns (TEAM, ghost names): in the final score, not in TOTALS
    unowned = {1: {}, 2: {}}
    for e in pbp:
        if e["actionType"] in ("2pt", "3pt", "freethrow") and not e["pno"] and e["tno"]:
            c = unowned[e["tno"]]
            made = e.get("success") == 1
            if e["actionType"] == "freethrow":
                c["fta"] = c.get("fta", 0) + 1
                c["ftm"] = c.get("ftm", 0) + made
            else:
                c["fga"] = c.get("fga", 0) + 1
                c["fgm"] = c.get("fgm", 0) + made
                if e["actionType"] == "3pt":
                    c["fg3a"] = c.get("fg3a", 0) + 1
                    c["fg3m"] = c.get("fg3m", 0) + made

    forms: dict = {}
    for e in events:
        if e.get("who") and e["jersey"] is not None and "," in e["who"]:
            forms.setdefault((e["team_idx"], e["jersey"]), []).append(e["who"])

    tm = {}
    for s in (0, 1):
        tno = tno_of[s]
        team = box["teams"][s]
        pl = {}
        for p in team["players"]:
            first, last = _split_name(p["name"], sorted(sorted(set(forms.get((s, p["jersey"]), []))),
                                                         key=lambda f: -forms[(s, p["jersey"])].count(f)))
            stats = {"sPoints": p["pts"], "sFieldGoalsMade": p["fgm"], "sFieldGoalsAttempted": p["fga"],
                     "sTwoPointersMade": p["fgm"] - p["fg3m"], "sTwoPointersAttempted": p["fga"] - p["fg3a"],
                     "sThreePointersMade": p["fg3m"], "sThreePointersAttempted": p["fg3a"],
                     "sFreeThrowsMade": p["ftm"], "sFreeThrowsAttempted": p["fta"],
                     "sReboundsOffensive": p["oreb"], "sReboundsDefensive": p["dreb"], "sReboundsTotal": p["treb"],
                     "sAssists": p["ast"], "sTurnovers": p["tov"], "sSteals": p["stl"], "sBlocks": p["blk"],
                     "sFoulsPersonal": p["pf"], "sBlocksReceived": br.get((tno, p["jersey"]), 0),
                     "sPlusMinusPoints": pm.get((tno, p["jersey"]), 0)}
            pl[p["jersey"]] = S.player(first, last, shirt=p["shirt"], starter=1 if p["starter"] else 0,
                                       active=1, minutes=_mmss(p["min"]), stats=stats, name=p["name"])
        totals = S.totals_of(pl)
        tc = team["totals"]
        if tc:
            def ma(x):
                m = re.match(r"\s*(\d+)\s*-\s*(\d+)", x or "")
                return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
            fgm, fga = ma(tc[1])
            tpm, tpa = ma(tc[2])
            ftm, fta = ma(tc[3])
            totals.update({"sFieldGoalsMade": fgm, "sFieldGoalsAttempted": fga,
                           "sThreePointersMade": tpm, "sThreePointersAttempted": tpa,
                           "sTwoPointersMade": fgm - tpm, "sTwoPointersAttempted": fga - tpa,
                           "sFreeThrowsMade": ftm, "sFreeThrowsAttempted": fta,
                           "sReboundsOffensive": S.num(tc[4]), "sReboundsDefensive": S.num(tc[5]),
                           "sReboundsTotal": S.num(tc[6]), "sAssists": S.num(tc[7]), "sSteals": S.num(tc[8]),
                           "sBlocks": S.num(tc[9]), "sTurnovers": S.num(tc[10]), "sFoulsPersonal": S.num(tc[11]),
                           "sPoints": S.num(tc[12])})
        u = unowned[tno]
        for k_fiba, k_u in (("sFieldGoalsMade", "fgm"), ("sFieldGoalsAttempted", "fga"),
                            ("sThreePointersMade", "fg3m"), ("sThreePointersAttempted", "fg3a"),
                            ("sFreeThrowsMade", "ftm"), ("sFreeThrowsAttempted", "fta")):
            totals[k_fiba] += u.get(k_u, 0)
        totals["sTwoPointersMade"] = totals["sFieldGoalsMade"] - totals["sThreePointersMade"]
        totals["sTwoPointersAttempted"] = totals["sFieldGoalsAttempted"] - totals["sThreePointersAttempted"]
        totals["sPoints"] = 2 * totals["sFieldGoalsMade"] + totals["sThreePointersMade"] + totals["sFreeThrowsMade"]
        score = team["score"] if team["score"] is not None else totals["sPoints"]
        quarters = [box["linescore"][s].get(q, 0) for q in range(1, 5)]
        logo = f"https://cdn.prestosports.com/action/cdn/logos/rpi/{box['org'][s]}/mbkb.png" if box["org"][s] else None
        t = S.team(team["name"], team_code(team["name"]), score=score, quarters=quarters, players=pl,
                   shots=[], logo=logo, totals=totals, short_name=team["name"])
        for q in range(5, n_periods + 1):
            t[f"p{q}_score"] = S.num(box["linescore"][s].get(q, 0))
        tm[str(tno)] = t
    raw = {"tm": tm, "pbp": pbp, "period": cur,
           "clock": "00:00" if finished else (pbp[-1]["gt"] if pbp else "10:00")}
    raw["usports"] = {"eventId": str(event_id), "seasonPath": season_path, "boxUrl": box_url,
                      "date": box["date"], "time": box["time"], "location": box["location"],
                      "status": box["status_text"], "orgCodes": {"home": box["org"][1], "away": box["org"][0]},
                      "teamIds": {"home": box["team_ids"][1], "away": box["team_ids"][0]},
                      "repairs": {**{k: v for k, v in notes.items() if v},
                                  **({"ghost_names": sorted({w for _, w in ghosts})} if ghosts else {}),
                                  **({"unrecognised_plays": unknown[:10]} if unknown else {}),
                                  **({"technicals_not_pf": tech_notes} if tech_notes else {})}}
    return raw


def _too_early(tip) -> bool:
    if not tip:
        return False
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00"))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t - datetime.now(timezone.utc)).total_seconds() > FETCH_LEAD_S


# ============================================================================ the adapter
class USportsAdapter(FibaLiveStatsAdapter):
    """U SPORTS men. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "usports"
    #: a league website behind a WAF that challenges bursts: a few seconds between requests
    min_request_gap_s = 3.0

    # shared across instances: the live lane calls fetch() without a discover() in-process
    _events: dict = {}          # event id -> what discover()/resolution learnt about the game
    _last_req: float = 0.0
    _pace: float = 0.0

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        src = parse_source_url(schedule_url)
        season = self._season(config, src)
        sp = season + STAGES[src["stage"]]
        base = f"{SITE}{SPORT}/{sp}/schedule"
        html = self._get_text(base)
        if html is None:
            print(f"     U SPORTS {sp}: no schedule page (not published yet?)")
            return []
        root = dom(html)
        rows = parse_schedule_rows(root, sp)
        ical_text = self._get_text(base + "?print=ical", encoding="cp1252")
        ical = parse_ical(ical_text) if ical_text else {}
        USportsAdapter._icals[sp] = (time.time(), ical)
        if len(rows) >= LIST_CAP:
            rows = self._complete(rows, root, ical, sp)
        elif ical and len({r["eid"] for r in rows} | set(ical)) > len(rows):
            print(f"     U SPORTS {sp}: the iCal lists {len(set(ical) - {r['eid'] for r in rows})} "
                  f"event(s) the page does not")
        now = datetime.now(timezone.utc)
        games, flags, n_exh = [], [], 0
        for r in rows:
            ic = ical.get(r["eid"]) or {}
            if not r["eid"]:
                continue
            if is_exhibition(r, ic):
                n_exh += 1
                continue
            home, away = r.get("home") or {}, r.get("away") or {}
            hn, an = home.get("name") or ic.get("teams", ("", ""))[1], away.get("name") or ic.get("teams", ("", ""))[0]
            tip = ic.get("tip") or (f"{r['date']}T12:00:00+00:00" if r.get("date") else None)
            postseason = src["stage"] != "regular" or "postseason" in r["classes"]
            extra = {"venue": ic.get("venue"), "home_code": team_code(hn) or None, "away_code": team_code(an) or None,
                     "home_logo": _https(home.get("logo")), "away_logo": _https(away.get("logo")),
                     "stage": src["stage"], "season_path": sp, "box_url": r["box_url"] or None,
                     "notes": r["notes"] or None, "neutral": bool(r["neutral"])}
            if ic.get("time_tbc"):
                extra["time_tbc"] = True
            if postseason:
                extra["conference_game"] = False
            elif "conf" in r["classes"]:
                extra["conference_game"] = True
            if not postseason:
                flags.append((r, hn, an))
            status = self._fixture_status(r, tip, now)
            self._events[r["eid"]] = {"season_path": sp, "box_url": r["box_url"], "home": hn, "away": an,
                                      "tip": tip, "status": status}
            games.append(ScheduleGame(external_id=r["eid"], home_name=hn, away_name=an, tipoff_at=tip,
                                      status=status, extra=extra))
        self._report_flags(flags, config, season)
        print(f"     U SPORTS {sp}: {len(games)} games ({sum(1 for g in games if g.status == 'final')} final, "
              f"{sum(1 for g in games if g.status == 'live')} live), {n_exh} exhibitions left out")
        return games

    @staticmethod
    def _season(config: dict, src: Optional[dict] = None) -> str:
        tok = config.get("season")
        if tok:
            season = normalize_season(tok)
            if not season:
                raise ValueError(f"usports: season {tok!r} not understood (want e.g. 2026-27)")
            return season
        if src and src.get("season"):
            return src["season"]
        return current_season()

    def _complete(self, rows: list, html: str, ical: dict, sp: str) -> list:
        """The events past the list's 500 cap, from the per-club pages - chosen by how many of the
        still-missing events (the iCal's) each club plays in, so the fewest pages are read."""
        have = {r["eid"]: r for r in rows}
        teams = team_filter(html)
        missing = set(ical) - set(have) if ical else None
        fetched = set()
        while True:
            if missing is not None:
                if not missing:
                    break
                need = {}
                for eid in missing:
                    for nm in ical[eid]["teams"]:
                        need[nm] = need.get(nm, 0) + 1
                order = sorted((t for t in teams if t[0] not in fetched and need.get(t[1], 0) > 0),
                               key=lambda t: (-need[t[1]], t[1]))
                if not order:
                    break
                tid, tname = order[0]
            else:
                rest = [t for t in teams if t[0] not in fetched]
                if not rest:
                    break
                tid, tname = rest[0]
            fetched.add(tid)
            th = self._get_text(f"{SITE}{SPORT}/{sp}/schedule?teamId={tid}")
            if not th:
                continue
            for r in parse_schedule_rows(th, sp, page_team=(tid, tname)):
                if r["eid"] and r["eid"] not in have:
                    have[r["eid"]] = r
                if missing is not None:
                    missing.discard(r["eid"])
        print(f"     U SPORTS {sp}: list capped at {LIST_CAP}; {len(fetched)} club pages read"
              + (f"; {len(missing)} iCal event(s) still not found: {sorted(missing)[:6]}" if missing else ""))
        return list(have.values())

    @staticmethod
    def _fixture_status(r: dict, tip: Optional[str], now: datetime) -> str:
        if (r.get("status_text") or "").lower().startswith("final"):
            return "final"
        try:
            t = datetime.fromisoformat(tip) if tip else None
        except ValueError:
            t = None
        if t is not None and t <= now and (now - t).total_seconds() < LIVE_GUARD_S and r.get("box_url"):
            return "live"
        return "scheduled"

    @staticmethod
    def _report_flags(flags: list, config: dict, season: str) -> None:
        """The site's conference flag against the groups file, for the regular-season games: a
        disagreement is printed (the flag is what the game carries)."""
        if _groups is None or not flags:
            return
        gf = config.get("groups_file") or "config/groups/usports.json"
        src = {"groups_file": gf}
        try:
            _groups.spec_for(src)
        except Exception:
            return
        agree, unknown, bad = 0, 0, []
        for r, hn, an in flags:
            same = _groups.same_group(src, season, hn, an)
            flag = "conf" in r["classes"]
            if same is None:
                unknown += 1
            elif same == flag:
                agree += 1
            else:
                bad.append(f"{an} @ {hn} {r.get('date')} (site {'conf' if flag else 'non-conf'}, groups "
                           f"{'same' if same else 'different'} conference)")
        print(f"     conference flag vs {gf}: {agree} agree, {len(bad)} disagree, {unknown} with a club "
              f"the file does not know" + ("".join(f"\n       ! {b}" for b in bad[:20])))

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        eid = str(external_id)
        tip = config.get("_tipoff_at")
        if _too_early(tip):
            return None                   # decided before a single request is made
        info = self._events.get(eid)
        if not info or not info.get("box_url"):
            # not seen, or seen before its box was posted: the season path's iCal says where it is
            info = self._resolve(eid, config, hint=(info or {}).get("season_path")) or info
        if not info or not info.get("box_url"):
            return None
        tip = tip or info.get("tip")
        if _too_early(tip):
            return None
        page, url = None, None
        for url in [info["box_url"]] + [u for u in info.get("box_urls", []) if u != info["box_url"]]:
            page = self._get_text(url)
            if page:
                if url != info["box_url"]:
                    info["box_url"] = url        # a derived address that turned out right: keep it
                break
        if not page:
            return None
        raw = raw_from_page(page, event_id=eid, season_path=info.get("season_path", ""), box_url=url)
        if raw is None:
            return None
        cfg = dict(config)
        cfg.setdefault("game_date", raw["usports"].get("date") or "")
        b = self.bundle_from_raw(raw, eid, cfg)
        b.tipoff_at = tip
        return b

    _icals: dict = {}           # season path -> (fetched_at, parse_ical(...))
    ICAL_TTL_S = 600.0

    def _ical(self, sp: str) -> dict:
        at, data = USportsAdapter._icals.get(sp, (0.0, None))
        if data is None or time.time() - at > self.ICAL_TTL_S:
            text = self._get_text(f"{SITE}{SPORT}/{sp}/schedule?print=ical", encoding="cp1252")
            data = parse_ical(text) if text else {}
            USportsAdapter._icals[sp] = (time.time(), data)
        return data

    def _resolve(self, eid: str, config: dict, hint: Optional[str] = None) -> Optional[dict]:
        """An event id -> its season path and box URL, from the season paths' iCal feeds (the live
        lane fetches without a discover() in the same process; unlike the list and the event's
        details page, the iCal is not capped at 500 events). Its URL is the box score's once one
        is posted - including while the game is live; where the event's link is something else
        (a video, 23 of 698 in 2025-26) the box address is derived from the event id and the
        game's local date, which is the UTC date or the day before."""
        seasons = []
        for s in (normalize_season(config.get("season")) if config.get("season") else None,
                  season_of_tip(config.get("_tipoff_at")), current_season()):
            if s and s not in seasons:
                seasons.append(s)
        paths = [hint] if hint else [s + suffix for s in seasons for suffix in STAGES.values()]
        for sp in paths:
            ev = self._ical(sp).get(eid)
            if not ev:
                continue
            tip = config.get("_tipoff_at") or ev.get("tip") or (self._events.get(eid) or {}).get("tip")
            urls = []
            if "/boxscores/" in (ev.get("url") or ""):
                urls.append(SITE + ev["url"] if ev["url"].startswith("/") else ev["url"])
            elif ev.get("summary") and re.search(r"\(\d+-\d+\)\s*$", ev["summary"]) or (tip and not _too_early(tip)):
                try:
                    t = datetime.fromisoformat(str(ev.get("tip") or tip).replace("Z", "+00:00"))
                    for d in (t, t - timedelta(days=1)):
                        urls.append(f"{SITE}{SPORT}/{sp}/boxscores/{d:%Y%m%d}_{eid[:4]}.xml")
                except (TypeError, ValueError):
                    pass
            info = {"season_path": sp, "box_url": urls[0] if urls else "", "box_urls": urls, "tip": tip}
            if urls:
                self._events[eid] = info
            return info
        return None

    # ------------------------------------------------------------------ plumbing
    def _get_text(self, url: str, encoding: str = "utf-8") -> Optional[str]:
        """GET with a browser UA and polite spacing; the WAF's 202 / 429 / 459 answers are waited
        out (never solved), up to WAF_MAX_WAIT_S; 404 is None."""
        waited, delay, net_fail = 0, 30, 0
        while True:
            gap = time.time() - USportsAdapter._last_req
            pace = max(self.min_request_gap_s, USportsAdapter._pace)
            if gap < pace:
                time.sleep(pace - gap)
            USportsAdapter._last_req = time.time()
            try:
                r = requests.get(url, headers=HEADERS, timeout=40)
            except requests.RequestException as exc:
                net_fail += 1
                if net_fail >= 3:
                    raise RuntimeError(f"usports: {url} unreachable ({exc})")
                time.sleep(5 * net_fail)
                continue
            if r.status_code == 200:
                return r.content.decode(encoding, errors="replace")
            if r.status_code == 404:
                return None
            if r.status_code == 403:
                raise RuntimeError(f"usports: 403 from {url} (User-Agent refused?)")
            if waited >= WAF_MAX_WAIT_S:
                raise RuntimeError(f"usports: HTTP {r.status_code} for {waited}s from {url} - the site's "
                                   f"rate limit; next run")
            USportsAdapter._pace = min(max(USportsAdapter._pace * 1.5, 4.0), 10.0)
            print(f"     (usports: HTTP {r.status_code} - the site's rate limit; waiting {delay}s)")
            time.sleep(delay)
            waited += delay
            delay = min(delay * 2, 120)


def _https(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    url = url.strip()
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("http://"):
        url = "https://" + url[7:]
    return url if url.startswith("https://") else None
