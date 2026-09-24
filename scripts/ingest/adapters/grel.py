# -*- coding: utf-8 -*-
"""Greek Elite League (Elite League, the second tier under the GBL), from stats.basket.gr.

WHERE THE DATA IS. stats.basket.gr is the Hellenic Basketball Federation's statistics site, one
server-rendered page per thing, with the data written into the page as JavaScript calls:
loadDoc("<html>", "targetId"). A plain GET returns all of it - no browser, no key:

    /{2025-2026}/elite-league/games-regular-season/gamelevel/{1|2}/gamedate/{n}
        one round of fixtures. gamelevel is the HALF of the season (1 = first meeting, 2 = return
        fixture, same clubs), gamedate the round; each page links every other round, so the season
        is read from its own navigation rather than guessed. The whole 2026-27 schedule is up
        before a ball is thrown (16 clubs, from 3 Oct 2026).
    /{season}/elite-league/games-playoffs-playouts/... and /games-final4/...   the post-season
    /{season}/elite-league/gamedetails/id/{GUID}
        one game: quarter scores (scores1), the box score of each club (statistics1 home,
        statistics2 away: a row per player, a "Team/Coaches" row, TOTALS) and the play-by-play of
        each period (playbyplayNo1.., NEWEST FIRST).

EVERYTHING IS IN GREEK, IN CAPITALS, SURNAME FIRST ("ΠΑΠΑΓΙΑΝΝΗΣ ΜΗΝΑΣ-ΡΑΦΑΗΛ"; foreign players in
Latin capitals, also surname first: "SLATER II COLIN EDWARDEUX"). Names are spelt by Greece's own
standard, ELOT 743 (names.greek_latin - the passport system: Antetokounmpo, Evangelos,
Angelopoulos), after repairing the data entry's mixed-script words ("ΕVERTECH" with a Greek
Epsilon), and turned into first name / family name: Minas-Rafail Papagiannis, Colin Edwardeux
Slater II. The Greek original is kept on the player (displayName) so it stays searchable. Clubs keep
their initials in capitals: "ΚΟΡΟΙΒΟΣ ΑΣ ΑΜΑΛΙΑΔΑΣ" -> Koroivos AS Amaliadas. The scraper spells
every name the same way (scraper files/gr_translit.py).

THE PLAY-BY-PLAY, as it has to be read:
  * newest first within each period, so each period is reversed (and stable-sorted on its clock);
  * the CLUB of an action is its crest (the feed item's small_flag image): the border colour the
    scraper reads from a rendered page is white for both clubs in the page as served;
  * a player is her shirt number on that club (every action carries "#n"), keyed through the box
    score to the player's own id, so two players who share a surname are never merged;
  * a substitution ("Αλλαγή|Change") lists the club's WHOLE NEW FIVE by name, not who went off and
    who came on; the off/on pairs are the difference from the five on court. The first one of each
    period restates the five that start it;
  * "Fast Break Success" follows the basket it describes, so that basket is tagged fastbreak;
  * "Foul On" is the drawn foul, paired with the foul it mirrors (previousAction);
  * "ΤΕΛΟΣ ΠΕΡΙΟΔΟΥ" closes a period.
A description the tables do not know is not guessed: it is kept on raw["grel"]["unknown"].

A GAME IS FINAL when its last period has been closed, it has at least four, the two scores differ
(a tie after Q4 is overtime still to come) and it tipped off hours ago: the page itself has no
status.

ROUND PAGES ARE ~800 KB and a season is ~30 of them, so they are cached in
data/feed/GREL/rounds.json (committed with the other feed caches): a round whose games are all
final is never read again, and a round with nothing near today is re-read at most once a day.
"""
from __future__ import annotations

import html as _html
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

import names as _names                  # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA
from .twobbl import current_season, normalize_season

SITE = "https://stats.basket.gr"
COMP = "elite-league"
HEADERS = {"User-Agent": UA, "Accept": "text/html"}
REGULAR, POSTSEASON = ("games-regular-season",), ("games-playoffs-playouts", "games-final4")
PLAYED_AFTER = timedelta(hours=3)
ROUND_TTL = timedelta(hours=24)            # a round with nothing near today, re-read at most daily
NEAR = timedelta(days=3)
FETCH_LEAD = timedelta(minutes=30)

CALL = re.compile(r'loadDoc\("((?:[^"\\]|\\.)*)",\s*"([^"]+)"\)', re.S)
CARD_SPLIT = '<div class="row borderfull overflowHide">'
NAV = re.compile(r"href='/(\d{4}-\d{4})/" + COMP + r"/(games-[a-z0-9-]+)/gamelevel/(\d+)/gamedate/(\d+)'")
GUID = r"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"
GREEK_MONTHS = {"ιανουαριου": 1, "φεβρουαριου": 2, "μαρτιου": 3, "απριλιου": 4, "μαιου": 5,
                "ιουνιου": 6, "ιουλιου": 7, "αυγουστου": 8, "σεπτεμβριου": 9, "οκτωβριου": 10,
                "νοεμβριου": 11, "δεκεμβριου": 12}

SHOT = {"two points": ("2pt", 1), "two point lost": ("2pt", 0),
        "three points": ("3pt", 1), "three point lost": ("3pt", 0)}
FREE_THROW = {"free throw": 1, "free throw lost": 0}
PLAYER = {"assist": ("assist", ""), "defensive rebound": ("rebound", "defensive"),
          "offensive rebound": ("rebound", "offensive"), "steal": ("steal", ""), "block": ("block", ""),
          "personal foul": ("foul", "personal"), "technical foul": ("foul", "technical"),
          "unsportsmanlike foul": ("foul", "unsportsmanlike"), "disqualifying foul": ("foul", "disqualifying"),
          "foul on": ("foulon", ""), "turnover": ("turnover", "")}
SHOT_KIND = {"jump shot": "jumpshot", "layup": "layup", "driving layup": "drivinglayup", "dunk": "dunk",
             "tip in": "tipin", "hook shot": "hookshot", "alley oop": "alleyoop", "fade away": "fadeawayjumpshot",
             "step back": "stepbackjumpshot", "pull up": "pullupjumpshot", "floating jump shot": "floatingjumpshot"}
TURNOVER_KIND = {"bad pass": "badpass", "ball handling": "ballhandling", "traveling": "travel", "travelling": "travel",
                 "offensive foul turnover": "offensive", "out of bounds": "outofbounds", "3-seconds": "3sec",
                 "3 seconds": "3sec", "back court": "backcourt", "5-seconds": "5sec", "8-seconds": "8sec",
                 "24-seconds": "shotclock", "shot clock": "shotclock", "double dribble": "doubledribble"}
IGNORED = {"fast break lost"}


# ============================================================================ small pieces
def _num(v) -> int:
    try:
        return int(str(v).strip() or 0)
    except (TypeError, ValueError):
        return 0


def _text(h: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def _ma(cell: str) -> Tuple[int, int]:
    m = re.search(r"(\d+)\s*/\s*(\d+)", _text(cell))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _secs(clock: str) -> int:
    m = re.match(r"\s*(\d{1,2}):(\d{2})", clock or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _bare(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if not unicodedata.combining(c))


def sections(page: str) -> Dict[str, str]:
    """{targetId: html} of every loadDoc call on a page."""
    out = {}
    for v, k in CALL.findall(page or ""):
        out[k] = v.replace('\\"', '"').replace("\\/", "/").replace("\\\\", "\\")
    return out


def athens_to_utc(y: int, mo: int, d: int, hhmm: str) -> Tuple[Optional[str], bool]:
    """Greek local time (EET, EEST from the last Sunday of March to the last Sunday of October)
    -> (UTC ISO, time still to be confirmed). No time: noon UTC on the local date."""
    m = re.match(r"\s*(\d{1,2}):(\d{2})", hhmm or "")
    if not m:
        return f"{y:04d}-{mo:02d}-{d:02d}T12:00:00+00:00", True

    def last_sunday(month):
        x = datetime(y, month, 31)
        return x - timedelta(days=(x.weekday() + 1) % 7)
    local = datetime(y, mo, d, int(m.group(1)), int(m.group(2)))
    offset = 3 if last_sunday(3) <= local < last_sunday(10) else 2
    return (local - timedelta(hours=offset)).replace(tzinfo=timezone.utc).isoformat(), False


def person_parts(raw: str) -> Tuple[str, str]:
    """'SURNAME GIVEN NAMES' (Greek or Latin, capitals) -> (given, family) in Latin title case."""
    s = re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", str(raw or "").replace(".", " "))).strip()
    words = [w for w in _names.greek_latin(s).split(" ") if w]
    if not words:
        return "", ""
    if len(words) == 1:
        return "", _cap(words[0])
    k = 1
    while k < len(words) - 1 and words[k - 1].lower() in {"de", "di", "da", "del", "van", "von", "le", "la", "dos", "st"}:
        k += 1
    while k < len(words) - 1 and words[k].lower() in {"ii", "iii", "iv", "jr", "sr"}:
        k += 1
    return " ".join(_cap(w) for w in words[k:]), " ".join(_cap(w) for w in words[:k])


def _cap(w: str) -> str:
    low = w.lower()
    if low in {"ii", "iii", "iv"}:
        return low.upper()
    if low in {"jr", "sr"}:
        return low.capitalize()
    out = []
    for p in low.split("-"):
        p = "'".join(x[:1].upper() + x[1:] for x in p.split("'"))
        if p.startswith("Mc") and len(p) > 2:
            p = "Mc" + p[2:3].upper() + p[3:]
        out.append(p)
    return "-".join(out)


#: Greek club-type initials longer than three letters (the three-letter ones are caught by length)
LONG_INITIALS = {"ΑΕΠΣ", "ΠΑΟΚ", "ΓΑΣΚ", "ΑΕΚΑ", "ΑΣΠΑ"}


def club_name(raw: str) -> str:
    """A club in Latin: initials (ΑΕ, ΓΣ, ΑΕΟ, ΑΕΠΣ) stay capitals, the rest title case."""
    src = re.sub(r"\s+", " ", raw or "").strip().split(" ")
    out = []
    for w in src:
        if not w:
            continue
        lat = _names.greek_latin(w)
        out.append(lat.upper() if ((len(lat) <= 3 and lat.isalpha()) or w.upper() in LONG_INITIALS) else _cap(lat))
    return " ".join(out)


def short_club(name: str) -> str:
    """A club's SHORT name from its Latin name: the first word that says WHICH club, not what kind
    of club - GAS Komotini -> Komotini, AS Papagou -> Papagou, AEPS Machites Peiramatiko -> Machites,
    Protefs AEO Voulas -> Protefs. Initials (all capitals), numbers and abbreviations ending in a
    full stop are skipped; a name that is nothing else keeps its first word.

    Without one the platform fell back to the club's code, which here is the federation's team GUID,
    and the fixture strip printed its first three characters: "72C" v "5C2" (reported 2026-09-24)."""
    words = [w for w in re.sub(r"\s+", " ", name or "").strip().split(" ") if w]
    for w in words:
        if w.isupper() or w.endswith(".") or any(c.isdigit() for c in w):
            continue
        return w
    return words[0] if words else ""


# ============================================================================ the schedule
def parse_round(page: str) -> List[dict]:
    """Every fixture card on a round page."""
    out = []
    for card in (page or "").split(CARD_SPLIT)[1:]:
        teams = re.findall(r"teamdetails/id/" + GUID + r"'>\s*<img src='([^']+)'[^>]*>\s*<br\s*/?>\s*"
                           r"<span class=\"fnt1em[^\"]*\">([^<]*)</span>", card)
        if len(teams) < 2:
            continue
        date = re.search(r"fnt100[^\"]*\">\s*(\d{1,2})/(\d{1,2})/(\d{4})", card)
        tim = re.search(r"fnt80[^\"]*\">\s*(\d{1,2}:\d{2})", card)
        venue = re.search(r"fnt60[^\"]*\">([^<]*)<", card)
        score = re.search(r"colorWhite\">\s*(\d+)\s*-\s*(\d+)", card)
        gid = re.search(r"gamedetails/id/" + GUID, card)
        if not gid:
            continue
        (hid, hlogo, hname), (aid, alogo, aname) = teams[0], teams[1]
        tip, tbc = (athens_to_utc(int(date.group(3)), int(date.group(2)), int(date.group(1)),
                                  tim.group(1) if tim else "") if date else (None, False))
        out.append({"id": gid.group(1).upper(), "home": {"id": hid.upper(), "name": hname.strip(), "logo": hlogo},
                    "away": {"id": aid.upper(), "name": aname.strip(), "logo": alogo},
                    "tip": tip, "tbc": tbc, "venue": _text(venue.group(1)) if venue else "",
                    "score": [int(score.group(1)), int(score.group(2))] if score else None,
                    "final": bool(score) and "ΤΕΛΙΚΟ" in card})
    return out


def round_links(page: str, sections_: Tuple[str, ...]) -> List[Tuple[str, str, int, int]]:
    return sorted({(s, sec, int(lv), int(d)) for s, sec, lv, d in NAV.findall(page or "") if sec in sections_},
                  key=lambda x: (x[1], x[2], x[3]))


# ============================================================================ one game
def _crest(logo: str) -> str:
    """A crest file as a key: 'team-00701.png' and '1-100-team-00701.png' are one crest."""
    f = (logo or "").rsplit("/", 1)[-1]
    return f.split("team-", 1)[-1] if "team-" in f else f


def game_teams(page: str) -> List[dict]:
    """[home, away] from the page header's country_1 / country_2 blocks: id, Greek name, crest.

    Read block by block, not off the image's alt text: the away block has its name BEFORE its
    crest, and its alt text names the home club ("Team symbolof ΑΟ ΔΑΦΝΗΣ" on Psychikou's crest)."""
    got = []
    for n in (1, 2):
        i = (page or "").find(f'class="country_{n}"')
        if i < 0:
            return []
        block = page[i:i + 1500].split("</div>", 1)[0]
        tid = re.search(r"teamdetails/id/" + GUID, block)
        name = re.search(r"<span>([^<]+)</span>", block)
        logo = re.search(r"<img[^>]*src=\"([^\"]+)\"", block)
        if not (tid and name and logo):
            return []
        got.append({"id": tid.group(1).upper(), "logo": logo.group(1), "crest": _crest(logo.group(1)),
                    "name": _html.unescape(name.group(1)).strip()})
    return got


def box_side(sec: str) -> Tuple[Dict[str, dict], dict, dict]:
    """(players by id, the Team/Coaches row, the TOTALS row) of one statistics section."""
    players, team, totals = {}, {}, {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", sec or "", re.S):
        tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)     # the Team/Coaches row is <th>
        cells = [_text(c) for c in tds]
        if not cells:
            continue
        if cells[0] == "Team/Coaches":
            i = next((k for k, c in enumerate(cells) if c.startswith("Fast Breaks")), None)
            if i is not None:
                fb = _ma(tds[i + 1])
                team = {"oreb": _num(cells[i - 2]), "dreb": _num(cells[i - 1]), "fb_made": fb[0], "fb_att": fb[1],
                        "tov": _num(cells[i + 2]) if len(cells) > i + 2 else 0,
                        "pf": _num(cells[i + 3]) if len(cells) > i + 3 else 0}
            continue
        if cells[0] == "TOTALS" and len(cells) >= 17:
            ft, p2, p3 = _ma(tds[3]), _ma(tds[4]), _ma(tds[5])
            totals = {"pts": _num(cells[2]), "ftm": ft[0], "fta": ft[1], "p2m": p2[0], "p2a": p2[1], "p3m": p3[0],
                      "p3a": p3[1], "oreb": _num(cells[7]), "dreb": _num(cells[8]), "reb": _num(cells[9]),
                      "ast": _num(cells[10]), "stl": _num(cells[11]), "blk": _num(cells[12]), "tov": _num(cells[13]),
                      "pf": _num(cells[14]), "fo": _num(cells[15]), "eff": _num(cells[16])}
            continue
        if not cells[0].isdigit() or len(cells) < 19:
            continue
        pid = re.search(r"playerdetails/id/" + GUID, tds[1])
        if not pid:
            continue
        ft, p2, p3 = _ma(tds[5]), _ma(tds[6]), _ma(tds[7])
        players[pid.group(1).upper()] = {
            "shirt": cells[0], "name": cells[1], "starter": "*" in cells[2], "min": cells[3], "pts": _num(cells[4]),
            "ftm": ft[0], "fta": ft[1], "p2m": p2[0], "p2a": p2[1], "p3m": p3[0], "p3a": p3[1],
            "oreb": _num(cells[9]), "dreb": _num(cells[10]), "reb": _num(cells[11]), "ast": _num(cells[12]),
            "stl": _num(cells[13]), "blk": _num(cells[14]), "tov": _num(cells[15]), "pf": _num(cells[16]),
            "fo": _num(cells[17]), "eff": _num(cells[18])}
    return players, team, totals


def _stats(r: dict) -> dict:
    g = lambda k: _num(r.get(k))  # noqa: E731
    return {"sPoints": g("pts"), "sTwoPointersMade": g("p2m"), "sTwoPointersAttempted": g("p2a"),
            "sThreePointersMade": g("p3m"), "sThreePointersAttempted": g("p3a"),
            "sFieldGoalsMade": g("p2m") + g("p3m"), "sFieldGoalsAttempted": g("p2a") + g("p3a"),
            "sFreeThrowsMade": g("ftm"), "sFreeThrowsAttempted": g("fta"),
            "sReboundsOffensive": g("oreb"), "sReboundsDefensive": g("dreb"), "sReboundsTotal": g("reb"),
            "sAssists": g("ast"), "sTurnovers": g("tov"), "sSteals": g("stl"), "sBlocks": g("blk"),
            "sFoulsPersonal": g("pf"), "sFoulsOn": g("fo")}


def feed_items(sec: str) -> List[dict]:
    """One period's feed items, OLDEST first."""
    out = []
    for it in (sec or "").split("<div class='feed_item'")[1:]:
        clock = re.search(r"col-sm-1'>\s*<span class='fnt12'>([^<]*)<", it)
        jersey = re.search(r"class='fnt26'>\s*#?(\d+)", it)
        names_ = re.search(r"col-sm-8[^']*'>\s*<span class='fnt12'>(.*?)</span>", it, re.S)
        act = re.search(r"<p class='fnt12'>\s*<b>(.*?)</b>\s*</p>", it, re.S)
        sub = re.search(r"<p class='fnt10'>([^<]*)</p>", it)
        score = re.search(r"colorRed'>\s*(\d+)\s*-\s*(\d+)", it)
        crest = re.search(r"small_flag' src='([^']+)'", it)
        parts = [_text(p) for p in re.split(r"<br\s*/?>", act.group(1))] if act else []
        out.append({"clock": _text(clock.group(1)) if clock else "", "jersey": jersey.group(1) if jersey else "",
                    "names": [_text(n) for n in re.split(r"<br\s*/?>", names_.group(1))] if names_ else [],
                    "greek": parts[0] if parts else "", "english": (parts[1] if len(parts) > 1 else "").lower(),
                    "sub": _text(sub.group(1)).lower() if sub else "",
                    "score": (int(score.group(1)), int(score.group(2))) if score else None,
                    "crest": _crest(crest.group(1)) if crest else ""})
    out.reverse()
    return out


def raw_from_page(page: str, now: Optional[datetime] = None, club_names: Optional[Dict[str, str]] = None) -> Optional[dict]:
    """One stats.basket.gr game page -> FIBA data.json shape (forward, actionNumber 1..n). Pure.
    None when the page has no box score yet (not played).

    club_names ({team id: Greek name}) are the schedule's: the game page's header ABBREVIATES a
    club ("ΠΡΩΤΕΥΣ ΑΕΟ ΒΟΥΛΑ", "ΝΕΑΝΙΚΗ ΕΣΤΙΑ ΜΕΓ") where the fixture card has it whole."""
    sec = sections(page)
    teams = game_teams(page)
    if len(teams) < 2:
        return None
    boxes = [box_side(sec.get("statistics1", "")), box_side(sec.get("statistics2", ""))]
    if not boxes[0][0] or not boxes[1][0]:
        return None
    crest_tno = {teams[0]["crest"]: 1, teams[1]["crest"]: 2}
    shirt_pno = {t: {p["shirt"]: pid for pid, p in boxes[t - 1][0].items()} for t in (1, 2)}
    name_pno = {t: {re.sub(r"\s+", " ", p["name"]).strip().upper(): pid for pid, p in boxes[t - 1][0].items()}
                for t in (1, 2)}
    on = {t: {pid for pid, p in boxes[t - 1][0].items() if p["starter"]} for t in (1, 2)}

    # ------------------------------------------------------------------ date and time
    tip = None
    dm = re.search(r"(\d{1,2})\s+([^\s\d]+)\s+(\d{4})", _text(sec.get("gameDate", "")))
    if dm and GREEK_MONTHS.get(_bare(dm.group(2))):
        tip = athens_to_utc(int(dm.group(3)), GREEK_MONTHS[_bare(dm.group(2))], int(dm.group(1)),
                            _text(sec.get("gameTime", "")))[0]

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    events: List[dict] = []
    closed = set()
    score = [0, 0]
    last_q = 0
    for q in range(1, 9):
        items = feed_items(sec.get(f"playbyplayNo{q}", ""))
        if not items:
            continue
        last_q = q
        plen = 600 if q <= 4 else 300
        keyed = []
        for i, it in enumerate(items):
            keyed.append(((plen - _secs(it["clock"]) if it["clock"] else plen), i, it))
        keyed.sort(key=lambda k: (k[0], k[1]))
        per, ptype = (q, "REGULAR") if q <= 4 else (q - 4, "OVERTIME")
        events.append({"actionType": "period", "subType": "start", "period": per, "periodType": ptype,
                       "gt": "10:00" if q <= 4 else "05:00", "tno": 0, "pno": "", "qualifier": [], "success": 0})
        for elapsed, _, it in keyed:
            if "ΤΕΛΟΣ" in it["greek"]:
                closed.add(q)
                if it["score"]:
                    score = list(it["score"])
                continue
            rem = max(0, plen - elapsed)
            gt = f"{rem // 60:02d}:{rem % 60:02d}"
            tno = crest_tno.get(it["crest"], 0)
            base = {"period": per, "periodType": ptype, "gt": gt, "tno": tno, "qualifier": [], "success": 0}
            eng = it["english"]
            if eng == "change" or it["greek"].lower().startswith("αλλαγ"):
                if tno not in (1, 2):
                    unknown.append("change: no club")
                    continue
                new = {name_pno[tno].get(re.sub(r"\s+", " ", n).strip().upper()) for n in it["names"] if n.strip()}
                new.discard(None)
                if len(new) != 5 or new == on[tno]:
                    if len(new) != 5:
                        unknown.append(f"change: {len(new)} of 5 named")
                    continue
                for pid in sorted(on[tno] - new):
                    events.append(dict(base, actionType="substitution", subType="out", pno=pid))
                for pid in sorted(new - on[tno]):
                    events.append(dict(base, actionType="substitution", subType="in", pno=pid))
                on[tno] = new
                continue
            if eng in IGNORED:
                continue
            pno = shirt_pno.get(tno, {}).get(it["jersey"], "")
            if eng == "fast break success":
                # It is logged a few seconds AFTER the play it describes (basket 06:06, success
                # 06:03) by the same player, and after free throws when the break drew a foul: the
                # same player's latest made basket - or made free throws - within 15 s is the break.
                for ev in reversed(events):
                    if ev["period"] != per or ev["periodType"] != ptype or _secs(ev["gt"]) - rem > 15:
                        break
                    if ev.get("pno") != pno or ev["tno"] != tno or not ev.get("success"):
                        continue
                    if ev["actionType"] in ("2pt", "3pt"):
                        ev["qualifier"].append("fastbreak")
                        break
                    if ev["actionType"] == "freethrow":
                        for ft in events:
                            if (ft["actionType"] == "freethrow" and ft.get("success") and ft["pno"] == pno
                                    and ft["gt"] == ev["gt"] and ft["period"] == per and "fastbreak" not in ft["qualifier"]):
                                ft["qualifier"].append("fastbreak")
                        break
                continue
            if eng in SHOT:
                at, made = SHOT[eng]
                ev = dict(base, actionType=at, subType=SHOT_KIND.get(it["sub"], ""), success=made, pno=pno)
            elif eng in FREE_THROW:
                ev = dict(base, actionType="freethrow", subType="", success=FREE_THROW[eng], pno=pno)
            elif eng in PLAYER:
                at, sub = PLAYER[eng]
                if at == "turnover":
                    sub = TURNOVER_KIND.get(it["sub"], "other" if it["sub"] else "")
                ev = dict(base, actionType=at, subType=sub, pno=pno)
            else:
                unknown.append(f"action:{it['greek']}|{eng}|{it['sub']}")
                continue
            if it["score"]:
                score = list(it["score"])
            ev["s1"], ev["s2"] = str(score[0]), str(score[1])
            ev["scoring"] = 1 if (ev["actionType"] in ("2pt", "3pt", "freethrow") and ev["success"]) else 0
            events.append(ev)
        if q in closed:
            events.append({"actionType": "period", "subType": "end", "period": per, "periodType": ptype,
                           "gt": "00:00", "tno": 0, "pno": "", "qualifier": [], "success": 0})

    # the running score on every event, free-throw trips, drawn fouls
    running = ["0", "0"]
    for ev in events:
        if "s1" in ev:
            running = [ev["s1"], ev["s2"]]
        else:
            ev["s1"], ev["s2"] = running
        ev.setdefault("scoring", 0)
    trips: Dict[tuple, List[dict]] = {}
    for ev in events:
        if ev["actionType"] == "freethrow":
            trips.setdefault((ev["period"], ev["periodType"], ev["gt"], ev["tno"], ev["pno"]), []).append(ev)
    for trip in trips.values():
        for k, ev in enumerate(trip, start=1):
            ev["subType"] = f"{k}of{len(trip)}"

    home_score = _num(_text(sec.get("gameScoreHome", ""))) or boxes[0][2].get("pts", 0)
    away_score = _num(_text(sec.get("gameScoreVisitor", ""))) or boxes[1][2].get("pts", 0)
    t_now = now or datetime.now(timezone.utc)
    tip_dt = datetime.fromisoformat(tip) if tip else None
    finished = (last_q >= 4 and last_q in closed and home_score != away_score
                and (tip_dt is None or t_now - tip_dt > PLAYED_AFTER))
    if finished:
        events.append({"actionType": "game", "subType": "end", "period": events[-1]["period"],
                       "periodType": events[-1]["periodType"], "gt": "00:00", "tno": 0, "pno": "",
                       "qualifier": [], "success": 0, "s1": str(home_score), "s2": str(away_score), "scoring": 0})
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n
    # A DRAWN FOUL IS NOT LOGGED BESIDE ITS FOUL: 4 s away is typical, and in some games (C032E1B5)
    # most are 10-30 s away with other plays between - yet club by club and period by period the
    # counts agree. So within a period, when one club's fouls and the other club's drawn fouls are
    # equally many, they are paired in order; otherwise each drawn foul takes the nearest unpaired
    # foul by the other club within 10 s.
    groups: Dict[tuple, Tuple[list, list]] = {}
    for ev in events:
        if ev["tno"] not in (1, 2):
            continue
        if ev["actionType"] == "foul":
            groups.setdefault((ev["period"], ev["periodType"], 3 - ev["tno"]), ([], []))[0].append(ev)
        elif ev["actionType"] == "foulon":
            groups.setdefault((ev["period"], ev["periodType"], ev["tno"]), ([], []))[1].append(ev)
    for fouls, drawn in groups.values():
        if fouls and len(fouls) == len(drawn):
            for f, d in zip(fouls, drawn):
                d["previousAction"] = f["actionNumber"]
            continue
        paired = set()
        for d in drawn:
            best = None
            for f in fouls:
                gap = abs(_secs(f["gt"]) - _secs(d["gt"]))
                if gap <= 10 and f["actionNumber"] not in paired and (best is None or gap < best[0]):
                    best = (gap, f)
            if best:
                paired.add(best[1]["actionNumber"])
                d["previousAction"] = best[1]["actionNumber"]

    # ------------------------------------------------------------------ the box
    fastbreak: Dict[Tuple[int, str], int] = {}
    for ev in events:
        if ev["scoring"] and "fastbreak" in ev["qualifier"]:
            fastbreak[(ev["tno"], ev["pno"])] = fastbreak.get((ev["tno"], ev["pno"]), 0) + {"3pt": 3, "2pt": 2}.get(ev["actionType"], 1)
    quarters = {1: {}, 2: {}}
    for i, row in enumerate(re.findall(r"<tr[^>]*>(.*?)</tr>", sec.get("scores1", ""), re.S)):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 3:
            quarters[1][i + 1], quarters[2][i + 1] = _num(cells[0]), _num(cells[2])
    tm = {}
    for t in (1, 2):
        players, team_row, totals = boxes[t - 1]
        pl = {}
        bench = 0
        for pid, r in players.items():
            given, family = person_parts(r["name"])
            p = S.player(first=given, last=family, name=f"{given} {family}".strip(), shirt=r["shirt"],
                         starter=1 if r["starter"] else 0, active=1 if _secs(r["min"]) > 0 else 0,
                         minutes=f"{_secs(r['min']) // 60}:{_secs(r['min']) % 60:02d}", stats=_stats(r))
            p["displayName"] = r["name"]            # the Greek original, kept searchable (names.person alias)
            p["sPointsFastBreak"] = fastbreak.get((t, pid), 0)
            p["eff_1"] = r["eff"]
            if not p["starter"]:
                bench += p["sPoints"]
            pl[pid] = p
        greek = (club_names or {}).get(teams[t - 1]["id"]) or teams[t - 1]["name"]
        tt = S.team(club_name(greek), teams[t - 1]["id"], short_name=short_club(club_name(greek)), score=home_score if t == 1 else away_score,
                    quarters=[quarters[t].get(q) for q in range(1, min(last_q, 4) + 1)], players=pl, shots=[],
                    logo=teams[t - 1]["logo"], totals=_stats(totals) if totals else None)
        tt["nameInternational"] = greek
        for q in range(5, last_q + 1):
            tt[f"p{q}_score"] = quarters[t].get(q, 0)
        tt["ot_score"] = sum(quarters[t].get(q, 0) for q in range(5, last_q + 1))
        tt["full_score"] = tt["score"]
        # the league's TOTALS row is the players alone; FIBA's club totals include the team row's
        # rebounds and turnovers (a team rebound is still a possession ended), so they are added
        tt["tot_sReboundsOffensive"] += team_row.get("oreb", 0)
        tt["tot_sReboundsDefensive"] += team_row.get("dreb", 0)
        tt["tot_sReboundsTotal"] += team_row.get("oreb", 0) + team_row.get("dreb", 0)
        tt["tot_sTurnovers"] += team_row.get("tov", 0)
        tt["tot_sReboundsTeamOffensive"] = team_row.get("oreb", 0)
        tt["tot_sReboundsTeamDefensive"] = team_row.get("dreb", 0)
        tt["tot_sReboundsTeam"] = team_row.get("oreb", 0) + team_row.get("dreb", 0)
        tt["tot_sTurnoversTeam"] = team_row.get("tov", 0)
        tt["tot_sFoulsTeam"] = team_row.get("pf", 0)
        tt["tot_sPointsFastBreak"] = sum(p["sPointsFastBreak"] for p in pl.values())
        tt["tot_sBenchPoints"] = bench
        tm[str(t)] = tt
    lead = {1: 0, 2: 0}
    changes, leader = 0, 0
    for ev in events:
        diff = int(ev["s1"]) - int(ev["s2"])
        lead[1], lead[2] = max(lead[1], diff), max(lead[2], -diff)
        now_ = (diff > 0) - (diff < 0)
        if now_ and leader and now_ != leader:
            changes += 1
        if now_:
            leader = now_
    for t in (1, 2):
        tm[str(t)]["tot_sBiggestLead"] = lead[t]
        tm[str(t)]["tot_sLeadChanges"] = changes
    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q, "periodType": "REGULAR" if last_q <= 4 else "OVERTIME",
           "inOT": 1 if last_q > 4 else 0,
           "clock": "00:00" if (finished or last_q in closed) else (last_play["gt"] if last_play else "10:00")}
    venue = re.sub(r"^\s*Γήπεδο\s*:\s*", "", _text(sec.get("stadiumname", "")))
    raw["grel"] = {"date": tip, "venue": club_name(venue) if venue else None, "finished": finished,
                   "fastBreaks": [boxes[0][1].get("fb_made", 0), boxes[1][1].get("fb_made", 0)],
                   "unknown": sorted(set(unknown))}
    return raw


# ============================================================================ the adapter
class GrelAdapter(FibaLiveStatsAdapter):
    """The Greek Elite League. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "grel"
    min_request_gap_s = 1.0
    _rounds: dict = {}          # cache path -> {url: {"at", "games", "final"}}

    # ------------------------------------------------------------------ discovery
    @staticmethod
    def _season(config: dict) -> str:
        tok = config.get("season")
        if not tok:
            return current_season()
        season = normalize_season(tok)
        if not season:
            raise ValueError(f"grel: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        y = int(season[:4])
        path = f"{y}-{y + 1}"
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"grel: stage must be 'regular' or 'playoffs', not {stage!r}")
        wanted = REGULAR if stage == "regular" else POSTSEASON
        cache = self._round_cache(config)
        seen_pages, pages = set(), [(path, sec, 1, 1) for sec in wanted]
        games: Dict[str, dict] = {}
        rounds_per_level = {}
        changed = False
        while pages:
            key = pages.pop(0)
            if key in seen_pages:
                continue
            seen_pages.add(key)
            _, sec, lv, d = key
            url = f"{SITE}/{path}/{COMP}/{sec}/gamelevel/{lv}/gamedate/{d}"
            cards, nav, fresh = self._round(url, cache, wanted)
            changed |= fresh
            for link in nav:
                if link not in seen_pages:
                    pages.append(link)
            for c in cards:
                c = dict(c, section=sec, level=lv, gamedate=d)
                games.setdefault(c["id"], c)
            if sec == "games-regular-season":
                rounds_per_level[lv] = max(rounds_per_level.get(lv, 0), d)
        if stage == "playoffs":
            # A POST-SEASON PAGE THAT DOES NOT EXIST YET SHOWS ROUND 1 INSTEAD: 2026-27's Final Four
            # page, a month before the season, listed the 8 opening-round fixtures, which would have
            # filed regular-season games under the play-offs. So a game that is on any regular-season
            # page is never a post-season game.
            regular, todo = set(), [(path, REGULAR[0], 1, 1)]
            done_ = set()
            while todo:
                key = todo.pop(0)
                if key in done_:
                    continue
                done_.add(key)
                url = f"{SITE}/{path}/{COMP}/{key[1]}/gamelevel/{key[2]}/gamedate/{key[3]}"
                cards, nav, fresh = self._round(url, cache, REGULAR)
                changed |= fresh
                regular |= {c["id"] for c in cards}
                todo += [link for link in nav if link not in done_]
            games = {k: v for k, v in games.items() if k not in regular}
        if changed:
            self._save_round_cache(config, cache)
        out = []
        for c in games.values():
            if not (c["home"]["name"] and c["away"]["name"]):
                continue
            rnd = c["gamedate"] + (sum(rounds_per_level.get(l, 0) for l in range(1, c["level"]))
                                   if c["section"] == "games-regular-season" else 0)
            extra = {"home_code": c["home"]["id"], "away_code": c["away"]["id"],
                     "home_short": short_club(club_name(c["home"]["name"])),
                     "away_short": short_club(club_name(c["away"]["name"])),
                     "home_logo": c["home"]["logo"], "away_logo": c["away"]["logo"],
                     "round": (f"Round {rnd}" if c["section"] == "games-regular-season"
                               else ("Final Four" if c["section"] == "games-final4" else "Play-offs / play-outs")),
                     "stage": stage, "venue": club_name(c["venue"]) if c["venue"] else None}
            if c["tbc"]:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id=f"{path}_{c['id']}", home_name=club_name(c["home"]["name"]),
                                    away_name=club_name(c["away"]["name"]), tipoff_at=c["tip"],
                                    status="final" if c["final"] else "scheduled", extra=extra))
        out.sort(key=lambda g: (g.tipoff_at or "", g.external_id))
        if not out:
            print(f"     Greek Elite League {season} {stage}: nothing published yet")
        else:
            print(f"     Greek Elite League {season} {stage}: {len(out)} games "
                  f"({sum(1 for g in out if g.status == 'final')} final) from {len(seen_pages)} round pages")
        self.last_competitions = ["Greek Elite League"]
        return out

    def _round(self, url: str, cache: dict, wanted: Tuple[str, ...]) -> Tuple[List[dict], list, bool]:
        """(fixture cards, round links, read afresh?) for one round page, from the cache when it
        can be trusted: every game final, or nothing near today and read within ROUND_TTL."""
        now = datetime.now(timezone.utc)
        hit = cache.get(url)
        if hit:
            near = any(g.get("tip") and abs(datetime.fromisoformat(g["tip"]) - now) < NEAR for g in hit["games"])
            age = now - datetime.fromisoformat(hit["at"])
            if hit["final"] or (not near and age < ROUND_TTL):
                return hit["games"], [tuple(x) for x in hit["nav"]], False
        page = self._get(url)
        if page is None:
            return (hit or {}).get("games", []), [tuple(x) for x in (hit or {}).get("nav", [])], False
        cards = parse_round(page)
        nav = round_links(page, wanted)
        cache[url] = {"at": now.isoformat(), "games": cards, "nav": [list(x) for x in nav],
                      "final": bool(cards) and all(c["final"] for c in cards)}
        return cards, nav, True

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        m = re.match(r"^(\d{4}-\d{4})_" + GUID + "$", str(external_id))
        if not m:
            return None
        tip = config.get("_tipoff_at")
        if tip:
            try:
                if datetime.fromisoformat(str(tip).replace("Z", "+00:00")) - datetime.now(timezone.utc) > FETCH_LEAD:
                    return None
            except ValueError:
                pass
        page = self._get(f"{SITE}/{m.group(1)}/{COMP}/gamedetails/id/{m.group(2)}")
        raw = raw_from_page(page, club_names=self._card_names(m.group(2).upper(), config)) if page else None
        if raw is None:
            return None
        if raw["grel"]["unknown"]:
            print(f"     Greek Elite League {external_id}: not translated: {raw['grel']['unknown'][:4]}")
        b = self.bundle_from_raw(raw, str(external_id), config)
        b.tipoff_at = raw["grel"]["date"] or tip
        return b

    def _card_names(self, gid: str, config: dict) -> Dict[str, str]:
        """{team id: full Greek name} from this game's fixture card in the round cache."""
        for hit in self._round_cache(config).values():
            for c in hit.get("games") or []:
                if c.get("id") == gid:
                    return {c["home"]["id"]: c["home"]["name"], c["away"]["id"]: c["away"]["name"]}
        return {}

    # ------------------------------------------------------------------ plumbing
    @staticmethod
    def _cache_path(config: dict) -> str:
        return os.path.join(config.get("repo_root") or os.getcwd(), "data", "feed", "GREL", "rounds.json")

    def _round_cache(self, config: dict) -> dict:
        p = self._cache_path(config)
        if p not in GrelAdapter._rounds:
            try:
                with open(p, encoding="utf-8") as f:
                    GrelAdapter._rounds[p] = json.load(f)
            except (OSError, ValueError):
                GrelAdapter._rounds[p] = {}
        return GrelAdapter._rounds[p]

    def _save_round_cache(self, config: dict, cache: dict) -> None:
        p = self._cache_path(config)
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
        except OSError:
            pass

    def _get(self, url: str) -> Optional[str]:
        for attempt in range(3):
            gap = time.time() - getattr(GrelAdapter, "_last_req", 0.0)
            if gap < self.min_request_gap_s:
                time.sleep(self.min_request_gap_s - gap)
            GrelAdapter._last_req = time.time()
            try:
                r = requests.get(url, headers=HEADERS, timeout=60)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                r.encoding = "utf-8"
                return r.text
            time.sleep(1.5 * (attempt + 1))
        return None

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        return []                   # a forward stream: never the scraper's reversed builder (bleague.py)
