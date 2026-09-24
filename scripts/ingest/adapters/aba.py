"""The ABA League, ABA League 2 ("Druga") and the ABA U19 league (the Balkans) - aba-liga.com's own pages.

ONE SITE, THREE LEAGUES, ONE ADAPTER. Every league is the same server-rendered site, told apart by a
league number in the URL and the host it lives on:

    league 1  ABA League      https://www.aba-liga.com/calendar/<season>/1/
    league 2  ABA League 2    https://druga.aba-liga.com/calendar/<season>/2/
    league 7  ABA U19         https://www.aba-liga.com/calendar-u19/<season>/7/

The season number is the start year less 2000: 2026-27 is 26, 2025-26 is 25 (the site's own season
picker says so, "25/1/" = Season 2025/26). A game is https://<host>/match/<id>/<season>/<league>/ - the
tab and the slug after it are decoration, and the page carries every tab at once: the header (clubs,
final and quarter scores, date, venue, attendance, group), the official box score, and the play-by-play
of every period. Games are keyed "<league>-<season>-<id>".

THERE IS NO FEED BEHIND THE PAGE except for the shot chart, which the page draws from
/live-match/rezultati-1718/create_shooting_chart.php?id=&sez=&lea=: every shot as x/y PERCENT of the
full court (Chart.js 0-100 axes), the club (1 home, 2 away), made or not, and the player's id. It has no
clock and no shot type, so each shot is joined to the play-by-play's shots of the same player and result,
in order.

THE PLAY-BY-PLAY IS FIBA LIVESTATS WRITTEN OUT IN ENGLISH ("made 2 points (drivinglayup)", "turnover
(bad pass)", "foul on"): the league scores on LiveStats and publishes the text. So the translation is
almost mechanical: the words give FIBA's actionType, the bracket its subType once spaces are dropped
("pullupjump shot" -> pullupjumpshot, "tip inlayup" -> tipinlayup, both FIBA's own), and "foul on" is
FIBA's foulon. Each period's table is NEWEST FIRST with the clock as time REMAINING, home actions in the
left column and away actions in the right. A team action has no player and no verb, only the bracket:
" (defensive)" is a team rebound, " (outofbounds)" a team turnover. Starting fives are written as
"in starting lineup" before the first action; later periods open with substitutions at 10:00.
Each table is drawn twice (desktop and phone); only the desktop one (match_table_play_by_play) is read.

TIMES are Central European. The main league prints "CET", the others "Local time", and every club but
Dubai plays in that zone; the site prints Dubai's games on the same clock. So the date and time are read
in Europe/Belgrade, which also gets the summer offset right. A date with no time is noon UTC with
time_tbc, the PLK convention.

STAGES: the play-offs are the headings that say so (Play-in, Quarter-finals, Semi-finals, "Finals, Round
2", the U19's classification games and places); every other heading is the regular season: "ROUND n",
"WEEK n", and a second league phase (ABA 2025-26's "Top8 - R1" and "Play-out - R1" after its groups, as
Korisliiga has its jatkosarja). adapter_config.stage picks one, as PLK's rows do. GROUPS come from the calendar's own column
("A", or "Round 3, Group B" in the second league), written onto each regular-season fixture for
groups.learn (groups_from_feed): ABA 2026-27 is two groups of ten, the U19 four of four.

CLUBS: names are the calendar's (the sponsor's form, "Igokea m:tel"), codes the calendar's own phone
column ("IGO", "FMP"), and crests https://www.aba-liga.com/images/club/150x150/<club id>.png, the club id
read off the site's club menu (/team/<id>/<season>/<league>/...) and joined on the name. Every league's
crests are on the main host, the second league's included.

PLAYERS are keyed by the site's own player id. The box and the play-by-play only print "Jovanović Đ." and
"JOVANOVIĆ Đ", so the full name comes from whatever prints it: the shot feed's player_name (everyone who
took a shot), the leader tables ("Sulaimon Rasheed"), and, for the two or three a game who did neither,
the player's own page, read once a process. The family name is always the box's, accents and all.
"""
from __future__ import annotations

import html as _html
import json
import re
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, shot_dist_to_nearest_rim
from .lnb import _season_year

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"
HOSTS = {1: "https://www.aba-liga.com", 2: "https://druga.aba-liga.com", 7: "https://www.aba-liga.com"}
CALENDAR = {1: "calendar", 2: "calendar", 7: "calendar-u19"}
LOGO = "https://www.aba-liga.com/images/club/150x150/{}.png"
SHOTS = "/live-match/rezultati-1718/create_shooting_chart.php"
TZ = ZoneInfo("Europe/Belgrade")
NAMES: Dict[str, str] = {}          # player id -> full name from his own page, for the life of the process
NAME_PAGES = 8                      # at most this many player pages asked for one game

# ---------------------------------------------------------------------------- text ---
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def text(fragment) -> str:
    """HTML to the words a reader sees."""
    # the icon font's glyphs (a heading's chevron is U+F107) are no words
    s = _html.unescape(_TAG.sub(" ", str(fragment or "")))
    return _WS.sub(" ", re.sub("[\ue000-\uf8ff]", "", s)).strip()


def fold(name) -> str:
    """A name as a join key: no accents, no case, no club-form prefix ("KK Borac WWIN" is "Borac WWIN")."""
    s = "".join(c for c in unicodedata.normalize("NFKD", str(name or "")) if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    s = re.sub(r"^(kk|hkk|kd|bc|kos|okk)\s+", "", _WS.sub(" ", s).strip())
    return s


def season_number(config: dict) -> int:
    """The site's season number: 2026-27 -> 26."""
    if config.get("aba_season"):
        return int(config["aba_season"])
    return _season_year(config) - 2000


def stage_of(heading: str) -> str:
    """The play-offs by their own words; everything else is the regular season, which includes a second
    league phase: ABA 2025-26 split into "Top8 - R1" and "Play-out - R1" after its two groups, as
    Korisliiga does into its jatkosarja."""
    playoff = re.search(r"play-?in|quarter|semi|final|classification|place\b|third|3rd", heading or "", re.I)
    return "playoffs" if playoff else "regular"


def group_of(cell: str) -> str:
    """ "A" or "Round 3, Group B" -> "Group A" / "Group B"; nothing -> ""."""
    t = text(cell)
    m = re.search(r"group\s*([A-Z0-9]+)\b", t, re.I) or re.fullmatch(r"([A-Z])", t)
    return f"Group {m.group(1).upper()}" if m else ""


def tipoff(when: str) -> Tuple[Optional[str], bool]:
    """ "Friday, 25.09.2026 18:00 CET" -> ("2026-09-25T16:00:00Z", False); a date alone -> noon UTC, tbc."""
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?", when or "")
    if not m:
        return None, False
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if m.group(4) is None:
        return f"{y:04d}-{mo:02d}-{d:02d}T12:00:00Z", True
    local = datetime(y, mo, d, int(m.group(4)), int(m.group(5)), tzinfo=TZ)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False


# ------------------------------------------------------------------------ calendar ---
_PANEL = re.compile(r'<h4 class="panel-title">(.*?)</h4>(.*?)(?=<h4 class="panel-title">|\Z)', re.S)
_ROW = re.compile(r"<tr>\s*<td>\s*<p class=\"visible-xs\">.*?</tr>", re.S)
_MATCH = re.compile(r"/match/(\d+)/(\d+)/(\d+)/")
_PAIR = r'<p class="{}">\s*<a[^>]*>(.*?)<span>:</span>(.*?)</a>'
_CLUB_LINK = re.compile(r"""<a[^>]+href=["']https?://[a-z.]*aba-liga\.com/team/(\d+)/(\d+)/(\d+)/\d+/[^/"']*/["'][^>]*>(.*?)</a>""", re.S)


def calendar_rows(page: str) -> List[dict]:
    """Every game row of a calendar page, with its round heading."""
    out = []
    for panel in _PANEL.finditer(page or ""):
        heading = text(panel.group(1))
        for row in _ROW.findall(panel.group(2)):
            m = _MATCH.search(row)
            names = re.search(_PAIR.format("hidden-xs"), row, re.S)
            codes = re.search(_PAIR.format("visible-xs"), row, re.S)
            tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            score = re.search(r"(\d+)\s*:\s*(\d+)", text(re.search(r'<td class="scoretable">(.*?)</td>', row, re.S).group(1))
                              if '<td class="scoretable">' in row else "")
            when = re.search(r'<td class="locationtable">(.*?)</td>', row, re.S)
            out.append({
                "round": heading,
                "id": int(m.group(1)) if m else None, "sez": int(m.group(2)) if m else None,
                "lea": int(m.group(3)) if m else None,
                "home": text(names.group(1)) if names else "", "away": text(names.group(2)) if names else "",
                "home_code": text(codes.group(1)) if codes else "", "away_code": text(codes.group(2)) if codes else "",
                "score": (int(score.group(1)), int(score.group(2))) if score else None,
                "when": text(when.group(1)) if when else "",
                "group": group_of(tds[-1]) if len(tds) >= 5 else "",
            })
    return out


def club_ids(page: str, league: int) -> Dict[str, int]:
    """{folded club name: club id} from the site's club menu, this league's clubs only."""
    out = {}
    for m in _CLUB_LINK.finditer(page or ""):
        if int(m.group(3)) == league and text(m.group(4)):
            out[fold(text(m.group(4)))] = int(m.group(1))
    return out


def _covers(words: List[str], menu: List[str]) -> bool:
    """Every word of a calendar name is in the menu's name, or is the initials of a run of its words:
    "GGD Šenčur" is "Gorenjska gradbena družba Šenčur", "Cedevita Olimpija U19" is
    "Cedevita Olimpija Ljubljana U19"."""
    runs = {"".join(w[0] for w in menu[i:j]) for i in range(len(menu)) for j in range(i + 2, len(menu) + 1)}
    return bool(words) and all(w in menu or w in runs for w in words)


def club_id_for(name: str, ids: Dict[str, int]) -> Optional[int]:
    """A calendar name's club id: the same folded name, else the one menu name that covers it."""
    f = fold(name)
    if f in ids:
        return ids[f]
    hits = {cid for k, cid in ids.items() if k and f and _covers(f.split(), k.split())}
    return hits.pop() if len(hits) == 1 else None


# ------------------------------------------------------------------------ the game ---
BOX_COLS = ("min", "pts", "fgp", "p2m", "p2a", "p2p", "p3m", "p3a", "p3p", "ftm", "fta", "ftp",
            "dreb", "oreb", "reb", "ast", "stl", "tov", "blk", "blka", "pf", "pfd",
            "paint", "second", "fast", "pm", "val")
TO_FIBA = {"pts": "sPoints", "p2m": "sTwoPointersMade", "p2a": "sTwoPointersAttempted",
           "p3m": "sThreePointersMade", "p3a": "sThreePointersAttempted", "ftm": "sFreeThrowsMade",
           "fta": "sFreeThrowsAttempted", "dreb": "sReboundsDefensive", "oreb": "sReboundsOffensive",
           "reb": "sReboundsTotal", "ast": "sAssists", "stl": "sSteals", "tov": "sTurnovers",
           "blk": "sBlocks", "blka": "sBlocksReceived", "pf": "sFoulsPersonal", "pfd": "sFoulsOn",
           "paint": "sPointsInThePaint", "second": "sPointsSecondChance", "fast": "sPointsFastBreak",
           "pm": "sPlusMinusPoints"}
_PLAYER = re.compile(r"""href=["'][^"']*/player/(\d+)/[^"']*["'][^>]*>(.*?)</a>""", re.S)


def _stats(v: dict) -> dict:
    out = {TO_FIBA[k]: S.num(v.get(k)) for k in TO_FIBA}
    out["sFieldGoalsMade"] = out["sTwoPointersMade"] + out["sThreePointersMade"]
    out["sFieldGoalsAttempted"] = out["sTwoPointersAttempted"] + out["sThreePointersAttempted"]
    return out


def _cells(row: str) -> List[str]:
    return re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)


def box_tables(page: str) -> Tuple[List[dict], List[dict], List[dict]]:
    """The official box score: (home players, away players, [home total, away total]). Each player is
    {pid, shirt, short, starter, stats{...}}. The live box ("UnofficialBoxscore") stands in while the
    official one is empty."""
    for tab, nxt in (("Boxscore", "UnofficialBoxscore"), ("UnofficialBoxscore", "Comments")):
        a = page.find(f'id="{tab}"')
        b = page.find(f'id="{nxt}"', a) if a >= 0 else -1
        if a < 0:
            continue
        tables = re.findall(r"<table[^>]*>(.*?)</table>", page[a:b if b > a else len(page)], re.S)
        if len(tables) < 3:
            continue
        players = []
        for t in (tables[0], tables[2]):
            rows = []
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
                m = _PLAYER.search(r)
                cells = _cells(r)
                if not m or len(cells) < 4:
                    continue
                # the cells after the name's: an optional starter mark, then the numbers from Min on
                i = next(i for i, c in enumerate(cells) if "/player/" in c)
                starter = "*" in text(cells[i]) or (len(cells) > i + 1 and text(cells[i + 1]) == "*")
                vals = [text(c) for c in cells[i + 1:]]
                if vals and vals[0] in ("*", ""):
                    vals = vals[1:]
                row = dict(zip(BOX_COLS, vals))
                rows.append({"pid": m.group(1), "shirt": text(cells[0]), "short": text(m.group(2)),
                             "starter": starter, "min": row.get("min") or "0:00", "stats": _stats(row)})
            players.append(rows)
        totals = []
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", tables[1], re.S):
            cells = _cells(r)
            if len(cells) < len(BOX_COLS) or not re.search(r"\d+:\d+", text(cells[1]) if len(cells) > 1 else ""):
                continue
            row = dict(zip(BOX_COLS, [text(c) for c in cells[1:]]))
            totals.append({"name": text(cells[0]), "stats": _stats(row)})
        # the totals table repeats its header and first row for the phone; the last two rows are the clubs
        totals = totals[-2:]
        if any(players) or totals:
            return players[0], players[1], totals
    return [], [], []


def header(page: str) -> dict:
    """The clubs (name, club id), the final, each period's score, date, venue, attendance, round and group."""
    a = page.find('id="basic_match_info"')
    b = page.find('id="matchTabs"', a)
    hdr = page[page.find(">", a) + 1:page.rfind("<", a, b) if b > a else len(page)] if a >= 0 else ""
    info = text(hdr[:hdr.find('id="match_clubs_and_results_info_table"')]) if hdr else ""
    clubs = re.findall(r"""<span class=["']club["']>\s*<a href=["'][^"']*/team/(\d+)/[^"']*["']>(.*?)</a>""", hdr)
    final = re.search(r'<td class="gameScore">\s*(\d+)\s*:\s*(\d+)', hdr)
    per = re.search(r'id="match_cetrtine_rezultat".*?</tr>\s*<tr>(.*?)</tr>', hdr, re.S)
    periods = [tuple(int(x) for x in re.findall(r"\d+", c)[:2]) for c in _cells(per.group(1))] if per else []
    heads = re.search(r'id="match_cetrtine_rezultat".*?<tr>(.*?)</tr>', hdr, re.S)
    rnd = re.search(r'<span class="roundNumber">(.*?)</span>', hdr, re.S)
    venue = re.search(r"Venue:\s*(.*?)\s*(?:</div>|<br)", hdr, re.S)
    crowd = re.search(r'fa-users"></i>\s*([\d.,]+)', hdr)
    return {"clubs": [(int(i), text(n)) for i, n in clubs[:2]],
            "final": (int(final.group(1)), int(final.group(2))) if final else None,
            "periods": [p for p in periods if len(p) == 2],
            "period_names": [text(c) for c in _cells(heads.group(1))] if heads else [],
            "round": text(rnd.group(1)) if rnd else "",
            "when": info,
            "venue": text(venue.group(1)) if venue else None,
            "attendance": S.num(crowd.group(1).replace(".", "").replace(",", "")) if crowd else None}


_SLUG = re.compile(r"""/player/(\d+)/\d+/\d+/([^/"']+)/""")
_INITIAL = re.compile(r"\s+\S{1,2}\.$")          # the box's "Jovanović Đ." -> "Jovanović"


def family_names(page: str) -> Dict[str, str]:
    """{player id: family name} as the box score writes it, in its own case and accents ("Ferrell Jr K." ->
    "Ferrell Jr"); the play-by-play's capitals ("FERRELL JR K") are the fallback."""
    out, caps = {}, {}
    for pid, name in _PLAYER.findall(page or ""):
        t = text(name)
        if _INITIAL.search(t):
            out.setdefault(pid, _INITIAL.sub("", t))
        elif t and t == t.upper() and re.search(r"\s\S{1,2}$", t):
            caps.setdefault(pid, re.sub(r"\s+\S{1,2}$", "", t).title())
    return {**caps, **out}


def full_names(page: str, shots: Optional[list] = None) -> Dict[str, str]:
    """{player id: "Given Family"} from everything that prints a name in full: the shot chart's feed
    ("Juwan Morgan", every player who took a shot), the page's leader tables ("Sulaimon Rasheed", family
    name first) and the chart's player lists, which only a browser fills in (a saved page has them). A
    player who did none of those is not here: AbaAdapter asks his own page."""
    out: Dict[str, str] = {}
    fam = family_names(page)
    for pid, name in _PLAYER.findall(page or ""):
        t, f = text(name), fam.get(pid, "")
        if f and t.lower().startswith(f.lower() + " ") and not _INITIAL.search(t) and t != t.upper():
            out.setdefault(pid, f"{t[len(f):].strip()} {t[:len(f)]}")
    for side in ("players_home_team", "players_away_team"):
        a = (page or "").find(f'id="{side}"')
        if a >= 0:
            for pid, name in re.findall(r"""data-player_id=["'](\d+)["'][^>]*>(.*?)</a>""", page[a:page.find("</div>", a)], re.S):
                if pid != "0" and text(name):
                    out[pid] = text(name)
    for s in shots or []:
        if str(s.get("player_id") or "") not in ("", "0") and text(s.get("player_name")):
            out[str(s["player_id"])] = text(s["player_name"])
    return out


def split_name(full: str, family: str) -> Tuple[str, str]:
    """ "Kevin Duane Ferrell Jr" with the box's "Ferrell Jr" -> ("Kevin Duane", "Ferrell Jr"): the family
    name is the box's, the given name what is left in front of it. A full name that does not end in it
    splits at its last word."""
    fw, n = full.split(), len(family.split())
    if family and 0 < n < len(fw) and [fold(w) for w in fw[-n:]] == [fold(w) for w in family.split()]:
        return " ".join(fw[:-n]), family
    if family and fold(full) == fold(family):
        return "", family
    return " ".join(fw[:-1]), fw[-1] if fw else family


def player_page_name(page: str) -> str:
    """A player's own page: its heading is the name in full ("Uroš Banjac")."""
    m = re.search(r'<h1 class="main_title">(.*?)</h1>', page or "", re.S)
    if m and text(m.group(1)):
        return text(m.group(1))
    t = re.search(r"<title>(.*?)</title>", page or "", re.S)          # "Uroš Banjac > Player : ABA League"
    t = text(t.group(1)) if t else ""
    return t.split(" > Player")[0].strip() if " > Player" in t else ""


def period_tables(page: str) -> List[Tuple[int, List[List[str]]]]:
    """[(period, rows)] - each row its three cells [home, clock|marker, away], NEWEST FIRST as printed."""
    a = page.find('id="PlayByPlay"')
    if a < 0:
        return []
    b = page.find('id="Overview"', a)
    pbp = page[a:b if b > a else len(page)]
    out = []
    for m in re.finditer(r'id="q(\d+)"', pbp):
        qn = int(m.group(1))
        start = m.end()
        t = re.search(r'<table class="[^"]*match_table_play_by_play[^"]*">(.*?)</table>', pbp[start:], re.S)
        if not t:
            continue
        nxt = re.search(r'id="q\d+"', pbp[start:])
        if nxt and nxt.start() < t.start():
            continue                               # this period's panel has no table of its own
        rows = []
        for r in re.findall(r"<tr>(.*?)</tr>", t.group(1), re.S):
            cells = _cells(r)
            if len(cells) == 3 and "Minute | Score" not in text(cells[1]):
                rows.append(cells)
        out.append((qn, rows))
    return out


# a player's action: what follows the name link, "made 2 points (layup)" -> ("made 2 points", "layup")
_ACTION = re.compile(r"^\.?\s*(.*?)\s*(?:\((.*)\))?\s*$")


def classify(words: str, bracket: str) -> Tuple[Optional[str], str, Optional[int]]:
    """(actionType, subType, success) for one action's words; (None, "", None) when it is not one."""
    w = words.lower().strip()
    sub = re.sub(r"\s+", "", (bracket or "").lower())
    m = re.match(r"^(made|missed) ([23]) points?$", w)
    if m:
        return f"{m.group(2)}pt", sub, 1 if m.group(1) == "made" else 0
    m = re.match(r"^(made|missed) free throw$", w)
    if m:
        return "freethrow", sub, 1 if m.group(1) == "made" else 0
    table = {"rebound": "rebound", "assist": "assist", "steal": "steal", "block": "block",
             "turnover": "turnover", "foul": "foul", "foul on": "foulon", "substitution": "substitution",
             "jumpball": "jumpball", "timeout": "timeout"}
    if w in table:
        return table[w], sub, None
    return None, sub, None


def raw_from_page(page: str, shots: Optional[list] = None, names: Optional[Dict[str, str]] = None) -> Optional[dict]:
    """A game page (and its shot chart) -> the FIBA data.json shape: box, play-by-play OLDEST first with
    actionNumber 1..n, periods written once each, and the shots joined to their actions. None when the
    page has no clubs or nothing has happened yet. `names` = {player id: full name} known from elsewhere
    (the players' own pages); raw["aba"]["unnamed"] lists the players still without one."""
    h = header(page)
    if len(h["clubs"]) < 2:
        return None
    home_rows, away_rows, totals = box_tables(page)
    tables = period_tables(page)
    if not (home_rows or away_rows) and not any(rows for _, rows in tables):
        return None

    # ---------------------------------------------------------------- the players, as the box has them
    full = {**(names or {}), **full_names(page, shots)}
    family = family_names(page)
    slugs = dict(_SLUG.findall(page))
    unnamed: List[Tuple[str, str]] = []

    def person(pid: str, short: str) -> Tuple[str, str]:
        last = family.get(pid) or _INITIAL.sub("", short)
        if full.get(pid):
            return split_name(full[pid], last)
        # nobody printed him in full: the link's slug ("uros-banjac") less the family name, unaccented,
        # until his own page is read
        unnamed.append((pid, slugs.get(pid, "")))
        words = [w for w in slugs.get(pid, "").split("-") if w]
        n = len(last.split())
        given = words[:-n] if n and len(words) > n and words[-n:] == [fold(w).replace(" ", "") for w in last.split()] else []
        return " ".join(w.capitalize() for w in given), last

    pl_of = {}
    tm = {}
    starters = {"1": set(), "2": set()}
    for tno, rows, cid_name in (("1", home_rows, h["clubs"][0]), ("2", away_rows, h["clubs"][1])):
        pl = {}
        for r in rows:
            first, last = person(r["pid"], r["short"])
            pl[r["pid"]] = S.player(first, last, shirt=r["shirt"], starter=1 if r["starter"] else 0,
                                    active=1, minutes=r["min"], stats=r["stats"])
            pl_of[r["pid"]] = tno
            if r["starter"]:
                starters[tno].add(r["pid"])
        tot = totals[int(tno) - 1]["stats"] if len(totals) == 2 else None
        cid, cname = cid_name
        score = (h["final"] or (None, None))[int(tno) - 1]
        tm[tno] = S.team(cname, "", score=score, quarters=[p[int(tno) - 1] for p in h["periods"][:4]],
                         players=pl, logo=LOGO.format(cid), totals=tot)
        tm[tno]["clubId"] = cid
        for i, p in enumerate(h["periods"], start=1):
            tm[tno][f"p{i}_score"] = p[int(tno) - 1]
        tm[tno]["ot_score"] = sum(p[int(tno) - 1] for p in h["periods"][4:])
        tm[tno]["full_score"] = tm[tno]["score"]

    # ---------------------------------------------------------------- the play-by-play
    unknown: List[str] = []
    events: List[dict] = []
    score = ["0", "0"]
    closed, finished, last_q = set(), False, 0

    def ev(qn, gt, tno, pid, at, st, success=None):
        e = {"actionNumber": 0, "period": qn if qn <= 4 else qn - 4,
             "periodType": "REGULAR" if qn <= 4 else "OVERTIME", "gt": gt,
             "s1": score[0], "s2": score[1], "tno": tno, "pno": pid or "",
             "actionType": at, "subType": st, "qualifier": [], "success": success if success is not None else 0,
             "scoring": 1 if (at in ("2pt", "3pt", "freethrow") and success == 1) else 0,
             "shirtNumber": "", "player": ""}
        if pid:
            p = tm[str(tno)]["pl"].get(pid) if tno in (1, 2) else None
            if p:
                e["shirtNumber"] = p["shirtNumber"]
                e["firstName"], e["familyName"] = p["firstName"], p["familyName"]
                e["player"] = p["name"]
        return e

    for qn, rows in sorted(tables):
        if not rows:
            continue
        plen = "10:00" if qn <= 4 else "05:00"
        chrono = list(reversed(rows))
        body: List[dict] = []
        for cells in chrono:
            mid = text(cells[1])
            clock = re.match(r"^(\d{1,2}):(\d{2})", mid)
            gt = f"{int(clock.group(1)):02d}:{clock.group(2)}" if clock else None
            after = re.search(r"(\d+)\s*:\s*(\d+)\s*$", mid[clock.end():] if clock else "")
            low = mid.lower()
            if not clock or not (text(cells[0]) or text(cells[2])):
                if re.search(r"end of \d+\. (quarter|overtime)", low):
                    closed.add(qn)
                if "game finished" in low:
                    finished = True
                    closed.add(qn)
                if clock and re.match(r"^timeout", low):
                    pass                              # a timeout with no side: officials'
                continue
            for side, cell in ((1, cells[0]), (2, cells[2])):
                if not text(cell):
                    continue
                m = _PLAYER.search(cell)
                if m:
                    pid = m.group(1)
                    rest = text(cell[m.end():])
                    if "starting lineup" in rest:
                        starters[str(side)].add(pid)
                        continue
                    a = _ACTION.match(rest)
                    at, st, success = classify(a.group(1) if a else rest, a.group(2) if a else "")
                else:
                    pid = ""
                    t = text(cell)
                    if re.match(r"^timeout", low):
                        at, st, success = "timeout", "full", None
                    else:
                        br = re.fullmatch(r"\(?\s*(.*?)\s*\)?", t)
                        word = re.sub(r"\s+", "", (br.group(1) if br else t).lower())
                        if word in ("offensive", "defensive"):
                            at, st, success = "rebound", word, None
                        elif t.lower() == text(tm[str(side)]["name"]).lower():
                            at, st, success = "timeout", "full", None        # the club's name beside "Timeout mm:ss"
                        else:
                            at, st, success = "turnover", word, None
                if not at:
                    unknown.append(text(cell))
                    continue
                if at == "jumpball":
                    continue
                if after and at in ("2pt", "3pt", "freethrow") and success == 1:
                    score[0], score[1] = after.group(1), after.group(2)
                body.append(ev(qn, gt, side, pid, at, st, success))
        if not body and qn not in closed:
            continue
        last_q = max(last_q, qn)
        start = ev(qn, plen, 0, "", "period", "start")
        start["s1"], start["s2"] = body[0]["s1"] if body else score[0], body[0]["s2"] if body else score[1]
        events.append(start)
        # a basket carries the score AFTER it; everything before it in the period carries the one before
        running = [start["s1"], start["s2"]]
        for e in body:
            if e["scoring"]:
                running = [e["s1"], e["s2"]]
            else:
                e["s1"], e["s2"] = running
            events.append(e)
        if qn in closed:
            end = ev(qn, "00:00", 0, "", "period", "end")
            end["s1"], end["s2"] = running
            events.append(end)
    if finished and events:
        g = ev(last_q or 4, "00:00", 0, "", "game", "end")
        g["s1"], g["s2"] = events[-1]["s1"], events[-1]["s2"]
        events.append(g)
    for n, e in enumerate(events, start=1):
        e["actionNumber"] = n
    _link_drawn_fouls(events)

    # the starting fives: the play-by-play's own "in starting lineup", else the box's stars
    for tno in ("1", "2"):
        for pid, p in tm[tno]["pl"].items():
            p["starter"] = 1 if pid in starters[tno] else 0

    # ---------------------------------------------------------------- the shots
    # Joined per player and result, and first to a shot of the kind its spot says (beyond 6.75 m a three):
    # the chart is not always in the order the shots were taken, so a player's made two and made three
    # could otherwise swap places (seen: a "three" 2.4 m from the rim in 1-25-6).
    by_key: Dict[tuple, List[dict]] = defaultdict(list)
    for e in events:
        if e["actionType"] in ("2pt", "3pt") and e["pno"]:
            by_key[(e["tno"], e["pno"], e["success"], e["actionType"])].append(e)
    joined = 0
    for s in shots or []:
        try:
            tno, pid, made = int(s.get("ekipa")), str(s.get("player_id")), int(s.get("koordinata_uspeh"))
            x, y = float(s.get("koordinata_x")), float(s.get("koordinata_y"))
        except (TypeError, ValueError):
            continue
        kind = "3pt" if shot_dist_to_nearest_rim(x, y) > 6.75 else "2pt"
        queue = by_key.get((tno, pid, made, kind)) or by_key.get((tno, pid, made, "2pt" if kind == "3pt" else "3pt"))
        if not queue:
            continue
        e = queue.pop(0)
        joined += 1
        tm[str(tno)]["shot"].append({"r": made, "x": x, "y": y, "actionType": e["actionType"], "subType": e["subType"],
                                     "actionNumber": e["actionNumber"], "pno": pid, "per": e["period"],
                                     "perType": e["periodType"], "player": e["player"], "shirtNumber": e["shirtNumber"]})

    raw = {"tm": tm, "pbp": events, "period": last_q or 1,
           "periodType": "REGULAR" if (last_q or 1) <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0,
           "clock": "00:00" if finished or last_q in closed else next(
               (e["gt"] for e in reversed(events) if e["actionType"] not in ("period", "game")), "10:00")}
    raw["aba"] = {"round": h["round"], "venue": h["venue"], "attendance": h["attendance"], "when": h["when"],
                  "finished": finished, "unknown": sorted(set(unknown)), "shots": len(shots or []), "shots_joined": joined,
                  "unnamed": unnamed}
    return raw


def _link_drawn_fouls(events: List[dict]) -> None:
    """previousAction on every foulon: the other side's foul at the same clock time, the one typed just
    before it, else the one just after (plk.py's rule, and FIBA's own)."""
    fouls: Dict[tuple, List[int]] = {}
    for i, e in enumerate(events):
        if e["actionType"] == "foul" and e["tno"] in (1, 2):
            fouls.setdefault((e["period"], e["periodType"], e["gt"], e["tno"]), []).append(i)
    for i, e in enumerate(events):
        if e["actionType"] != "foulon" or e["tno"] not in (1, 2):
            continue
        cands = fouls.get((e["period"], e["periodType"], e["gt"], 3 - e["tno"])) or []
        before = [j for j in cands if j < i]
        after = [j for j in cands if j > i]
        j = before[-1] if before else (after[0] if after else None)
        if j is not None:
            e["previousAction"] = events[j]["actionNumber"]


# ---------------------------------------------------------------------------- adapter ---
class AbaAdapter(FibaLiveStatsAdapter):
    name = "aba"
    min_request_gap_s = 1.0

    def _get(self, url: str, **kw):
        gap = time.time() - getattr(self, "_last", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last = time.time()
        r = requests.get(url, headers={"User-Agent": UA, "Referer": url.split("/", 3)[0] + "//" + url.split("/")[2] + "/"},
                         timeout=60, **kw)
        if r.status_code in (403, 404):
            print(f"   (aba: {r.status_code} on {url})")
            return None
        r.raise_for_status()
        return r

    @staticmethod
    def _league(config: dict) -> int:
        lea = config.get("league")
        if lea in (None, ""):
            raise ValueError("aba: adapter_config.league (1 ABA, 2 ABA 2, 7 U19) is required")
        return int(lea)

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        lea, sez = self._league(config), season_number(config)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"aba: stage must be 'regular' or 'playoffs', not {stage!r}")
        host = config.get("host") or HOSTS.get(lea, HOSTS[1])
        r = self._get(f"{host}/{config.get('calendar') or CALENDAR.get(lea, 'calendar')}/{sez}/{lea}/")
        page = r.text if r is not None else ""
        rows = [x for x in calendar_rows(page) if x["id"] and x["sez"] == sez and x["lea"] == lea]
        ids = club_ids(page, lea)
        shared = self._shared_codes(rows)
        out = []
        for x in rows:
            if stage_of(x["round"]) != stage or not (x["home"] and x["away"]):
                continue                             # a play-off slot whose clubs are not known yet
            tip, tbc = tipoff(x["when"])
            if not tip:
                continue
            extra = {"round": x["round"], "stage": stage,
                     "home_code": "" if x["home_code"] in shared else x["home_code"],
                     "away_code": "" if x["away_code"] in shared else x["away_code"]}
            for side in ("home", "away"):
                cid = club_id_for(x[side], ids)
                if cid:
                    extra[f"{side}_logo"] = LOGO.format(cid)
            if stage == "regular" and x["group"]:
                extra["home_group"] = extra["away_group"] = x["group"]
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id=f"{lea}-{sez}-{x['id']}", home_name=x["home"], away_name=x["away"],
                                    tipoff_at=tip, status="final" if x["score"] else "scheduled", extra=extra))
        out.sort(key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     aba league {lea} season {sez} {stage}: {len(out)} games ({sum(1 for g in out if g.status == 'final')} final)")
        self.__dict__.setdefault("_codes_read", set()).add((lea, sez))
        self.__dict__.setdefault("_codes", {}).update(
            {fold(x[s]): x[f"{s}_code"] for x in rows for s in ("home", "away") if x[f"{s}_code"] and x[f"{s}_code"] not in shared})
        return out

    @staticmethod
    def _shared_codes(rows: List[dict]) -> set:
        """A code two clubs of one calendar wear keys neither of them (a club is found by its code)."""
        who = defaultdict(set)
        for x in rows:
            for s in ("home", "away"):
                if x[f"{s}_code"] and x[s]:
                    who[x[f"{s}_code"]].add(fold(x[s]))
        return {c for c, names in who.items() if len(names) > 1}

    def _codes_for(self, lea: int, sez: int, config: dict) -> Dict[str, str]:
        """The clubs' codes as the calendar prints them. A game fetched with no discovery pass first (the
        live lane) reads its calendar once, so a club is named with the same code either way."""
        read = self.__dict__.setdefault("_codes_read", set())
        if (lea, sez) not in read:
            read.add((lea, sez))                     # once, even if the calendar will not answer
            try:
                self.discover("", dict(config, league=lea, aba_season=sez, stage=config.get("stage") or "regular"))
            except Exception as exc:
                print(f"   (aba: club codes unread: {exc})")
        return self.__dict__.get("_codes", {})

    def _ask_names(self, host: str, lea: int, sez: int, unnamed: List[Tuple[str, str]]) -> bool:
        """The full names nobody on the game page printed: each player's own page, once a process (NAMES),
        at most NAME_PAGES a game. A player a name is not found for is asked again next time."""
        got = False
        for pid, slug in [u for u in unnamed if u[0] not in NAMES][:NAME_PAGES]:
            try:
                r = self._get(f"{host}/player/{pid}/{sez}/{lea}/{slug or 'player'}/")
            except Exception as exc:
                print(f"   (aba: player {pid} unread: {exc})")
                continue
            name = player_page_name(r.text) if r is not None else ""
            if name:
                NAMES[pid] = name
                got = True
        return got

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        m = re.fullmatch(r"(\d+)-(\d+)-(\d+)", str(external_id))
        if not m:
            return None
        lea, sez, gid = int(m.group(1)), int(m.group(2)), int(m.group(3))
        host = config.get("host") or HOSTS.get(lea, HOSTS[1])
        r = self._get(f"{host}/match/{gid}/{sez}/{lea}/")
        if r is None:
            return None
        shots = []
        try:
            s = self._get(f"{host}{SHOTS}", params={"id": gid, "sez": sez, "lea": lea})
            shots = json.loads(s.text) if s is not None and s.text.strip().startswith("[") else []
        except Exception:
            shots = []
        raw = raw_from_page(r.text, shots, NAMES)
        if not raw:
            return None
        if self._ask_names(host, lea, sez, raw["aba"]["unnamed"]):
            raw = raw_from_page(r.text, shots, NAMES)
        codes = self._codes_for(lea, sez, config)
        for t in ("1", "2"):
            code = codes.get(fold(raw["tm"][t]["name"]), "")
            raw["tm"][t]["code"] = code
            raw["tm"][t]["shortName"] = code or raw["tm"][t]["name"]
        b = self.bundle_from_raw(raw, str(external_id), config)
        tip, _ = tipoff(raw["aba"]["when"])
        b.tipoff_at = tip or config.get("_tipoff_at")
        return b
