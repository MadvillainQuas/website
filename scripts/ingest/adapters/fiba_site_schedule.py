"""FIBA LiveStats games, discovered from the league's OWN site rather than a Genius tenant page.

Some FIBA LiveStats leagues never publish a hosted.geniussports.com schedule: the Czech NBL and
the Slovak SBL run their own websites and link out to the LiveStats webcast per game. The GAME
data is the identical data.json the existing adapter already reads — one request, box score, play
by play and shot chart — so the only thing missing is the list of match ids.

That is all this file adds. discover() is overridden per site; fetch(), bundle_from_raw(), the
stint pipeline and everything else is inherited from FibaLiveStatsAdapter unchanged.

WHERE THIS CAME FROM. Both recipes are lifted from the scrapers that already do this every week —
czech_scraper.py (the /zapas/ review-page hop) and slovakia_scraper.py (the ten monthly tabs) —
and nothing about the parsing is new. What is new is that the SEASON is resolved from the site
instead of a constant: both scrapers pin last season in a literal (nbl.basketball?y=2025,
match-list/11613), which a site that ingests every night cannot afford.

THE SEASON IS READ OFF THE PAGE. Each site publishes its own season list, so the current season is
whatever the site says it is against the platform's season name (2026-27):
  · the Czech NBL takes ?y=<start year>, so 2026-27 is y=2026;
  · the Slovak SBL takes a tournament id in the path, and its own <select> maps
    11641 -> "Sezóna 2026/2027" — that mapping is read, never hard-coded.

CZECH DISCOVERY COSTS A SECOND REQUEST PER GAME, once. The schedule lists /zapas/<siteId>, and the
LiveStats id only appears on the game's own page. That page is opened once per fixture and the
answer is kept in data/feed/<CODE>/idmap.json, because a game's LiveStats id never changes — so a
season costs ~130 extra requests on the first pass and none afterwards.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Iterable, Optional

import requests

from .base import ScheduleGame
from .fiba_livestats import FIBA_DATA_URL, FibaLiveStatsAdapter, UA, ZoneInfo

CZECH_BASE = "https://nbl.basketball"
CZECH_SCHEDULE = CZECH_BASE + "/zapasy?y={year}&p1=0&c=0&d_od=&d_do=&k=0"
# THE OTHER CZECH LEAGUES RUN ON THE SAME SYSTEM (the federation's, ČBF). A league with its own site
# (ŽBL: zbl.basketball) has the identical /zapasy page, so it is NBL with another address
# ("czech_base"). A league without one (1. liga mužů) lives on the federation's site, cz.basketball,
# one page per PART of the competition (its two groups, later its play-off): "czech_competition" names
# it as the site's competitions page does, and its id and parts are read off that page each season.
CZ_FED = "https://cz.basketball"
CZ_COMPETITIONS = "{base}/soutez?y={year}"
# <h2 class="gamma">1. liga mužů</h2> ... <a href="/soutez/5404?p=10223" ...><div class="font-weight-bold mb-1">Skupina VÝCHOD</div>
_CZ_COMP_H2 = re.compile(r'<h2 class="gamma">\s*([^<]+?)\s*</h2>')
_CZ_PART = re.compile(r'href="/soutez/(\d+)\?p=(\d+)"[^>]*>\s*<div class="font-weight-bold mb-1">\s*([^<]+?)\s*</div>')
# a first-phase group is "Skupina VÝCHOD"; a later placement group carries its places ("Skupina C 1.-6.")
_CZ_GROUP = re.compile(r"skupina\s+([^\d]+?)\s*$", re.I)
SLOVAK_BASE = "https://sbl.slovakbasket.sk"
SLOVAK_LIST = (SLOVAK_BASE + "/sk/stats/match-list/{sid}/tipos-slovenska-basketbalova-liga"
               "?month={month}&listtype=grid&tournamentpartid=0&competitorid=0")

# the webcast link both sites publish, whatever competition letters it carries
_WEBCAST = re.compile(r"livestats\.dcd\.shared\.geniussports\.com/webcast/[^/]+/(\d+)", re.I)
_WEBCAST_ANY = re.compile(r"fibalivestats\.com/webcast/[A-Za-z]+/(\d+)", re.I)
_ZAPAS = re.compile(r"/zapas/(\d+)")
# <option value="11641">Sezóna 2026/2027</option>
_SEASON_OPT = re.compile(r"<option[^>]*value=\"(\d+)\"[^>]*>\s*([^<]*?)\s*</option>", re.I)

# --- what each site's own fixture row says, which is more than an id ---------------------
# nbl.basketball prints one <tr> per fixture: a sortable timestamp, both clubs in their own
# divs, and the link to the game. Everything a fixture needs is there before any hop.
_CZ_ROW = re.compile(r"<tr\b.*?</tr>", re.S)
_CZ_WHEN = re.compile(r'data-sort="(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})"')
_CZ_TEAM = re.compile(r"<div[^>]*>\s*([^<>\d][^<>]{2,60}?)\s*</div>")
_CZ_TEAM_HREF = re.compile(r'href="/tym/([a-z0-9-]+)"')
# BOTH CRESTS ARE ON THE ROW, home first, in the same cell as the names -- served through the
# site's own resizer, which is the only way to have them at all: the file the resizer reads
# (cbf.cz/files/<id>.png) answers 403 to anything but nbl.basketball itself, over http or https.
# The resizer hands back a 42px thumbnail and takes no size parameter, so that is the size a
# Czech crest comes in at: enough for a card and for reading the club's colours off, not enough
# to enlarge. Without this a Czech club had no crest and therefore no colour at all, on a league
# whose fixtures are otherwise complete (reported 2026-09-18).
_CZ_LOGO = re.compile(r'<img[^>]+src="(/min\.php\?[^"]*file=[^"]+)"')

# sbl.slovakbasket.sk draws a card per fixture: both crests carry the club's name in alt=, the
# header carries the date and the hall, and the club's own id is in the crest URL.
_SK_CARD = re.compile(r'class="match-ticket-inner".*?(?=class="match-ticket-inner"|\Z)', re.S)
_SK_TEAM = re.compile(r'<img[^>]+src="([^"]*Competitor/(\d+)/[^"]*)"[^>]*alt="([^"]*)"')
_SK_WHEN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})\s*o\s*(\d{1,2}):(\d{2})")
_SK_VENUE = re.compile(r'class="match-ticket-header">.*?<span>\s*([^<]+?)\s*</span>', re.S)


# --- nkl.lt (Lithuania's NKL, on FIBA LiveStats from 2026/27) -------------------------------
# The schedule page carries the whole season as one inline array:
#   const allMatches = [{"id":125745,"season":2026,"stage_id":2673,"stage_name":"Reguliarusis
#   sezonas","stage_type_id":1,"round_no":1,"date_label":"2026-09-28","time":"18:15","arena":...,
#   "home_team_id":3386,"home_name":"Alytaus Patriotai","home_logo":"http:\/\/nkl.lt\/...png", ...
#   "is_result":0,"is_running":0, ...}, ...]
# and the LiveStats id is NOT in it: the homepage's match strip links a window of games to their
# webcast (www.fibalivestats.com/u/BNW/<id>, behind the TV icon), and on all 15 games of the first
# strip read (2026-09-23) the LiveStats id was the site id + 2769710 - the season's webcasts were
# created in the league's own order. So: the strip's links are cached as they appear, and the
# offset they share is only ever TRIED, and kept once the feed itself names the fixture's clubs.
# basketbolli.com (the Kosovo federation): the Superliga on FIBA LiveStats (client KOS). No robots.txt
# (404), so nothing is disallowed. The league gets a NEW leagueId every season and the old season's
# page is purged, so the current id is read off the site's own menu, never kept in a constant.
KOS_SITE = "https://basketbolli.com"
KOS_MENU_LABEL = "PROCREDIT SUPERLIGA"
_KOS_ROW = re.compile(r'<div class="match-row">')
_KOS_WEEK = re.compile(r"<h2>\s*JAVA\s+([IVXLC]+)", re.I)
_KOS_SIDE = re.compile(r'<div class="team(?: team-(?:home|away))?">(.*?)</div>', re.S)
_KOS_H4 = re.compile(r"<h4[^>]*>(.*?)</h4>", re.S)
_KOS_WHEN = re.compile(r"(\d{2})/(\d{2})/(\d{4})\s+(\d{1,2}):(\d{2})")
_KOS_CREST = re.compile(r'<img[^>]*src="(?:\.\./)?(images/[^"]+)"', re.I)
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


# swiss.basketball (Swiss Basketball): the SB League and NLB, men and women, on FIBA LiveStats (client SUI).
# The schedule pages are empty shells drawn in the browser from Basketplan, the federation's own match
# database (Orcasys), which the site proxies as XML at /basketplan/ - basketplan.ch itself disallows
# every path in its robots.txt, swiss.basketball disallows none, so the proxy is what is read.
#   <league>/schedule                    window.seasons = {'2026-2027': 31, ...}: the season ids
#   findAllLeagueHoldings.do?seasonId=   the season's phases (PRELIMINARY_ROUND, PLAYOFF ...)
#   showLeagueSchedule.do?leagueHoldingId=  every game of one phase, played and to come
# The ?gid= a schedule row links to is BASKETPLAN's game id, not a LiveStats one (data/367239 is a
# 403); the LiveStats id is the row's liveStatsLink, which appears around game day, and the site's own
# JSON widget (/app-basketball/schedule?widget=N) names it weeks ahead for the leagues it covers.
SWISS_SITE = "https://swiss.basketball"
SWISS_PAGE = SWISS_SITE + "/national-competitions/{path}/schedule"
SWISS_HOLDINGS = (SWISS_SITE + "/basketplan/findAllLeagueHoldings.do?lang=en&xmlView=rss&leagueId={league}"
                  "&federationId=12&seasonId={season}")
SWISS_SCHEDULE = (SWISS_SITE + "/basketplan/showLeagueSchedule.do?lang=en&xmlView=rss&leagueId={league}"
                  "&leagueHoldingId={holding}&daysBack=2500&daysFuture=2250&totalGames=1000&resultType=big")
SWISS_WIDGET = SWISS_SITE + "/app-basketball/schedule?widget={widget}"
SWISS_LOGO = "https://www.basketplan.ch/"
_SWISS_SEASON = re.compile(r"'(\d{4})-(\d{4})'\s*:\s*(\d+)")
_SWISS_LS = re.compile(r"/u/[A-Za-z]+/(\d+)")


def swiss_season_ids(page: str) -> dict:
    """{start year: Basketplan season id} from a schedule page's window.seasons."""
    return {int(a): b for a, _y, b in _SWISS_SEASON.findall(page or "")}


def swiss_holdings(xml_text: str) -> list[dict]:
    """[{id, name, phase}] - the phases of one league's season."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring((xml_text or "").encode("utf-8"))
    except ET.ParseError:
        return []
    return [{"id": h.get("id"), "name": h.get("name") or "", "phase": h.get("phaseId") or ""}
            for h in root.iter("LeagueHoldingRSS") if h.get("id")]


def swiss_games(xml_text: str) -> list[dict]:
    """Every game of one phase's schedule XML, as plain dicts."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring((xml_text or "").encode("utf-8"))
    except ET.ParseError:
        return []
    phase = next((h.get("phaseId") or "" for h in root.iter("LeagueHoldingRSS")), "")
    out, seen = [], set()
    for g in root.iter("GameRSS"):
        gid = g.get("id")
        if not gid or gid in seen:
            continue
        seen.add(gid)
        h, a = g.find("homeTeam"), g.find("guestTeam")
        if h is None or a is None:
            continue

        def side(t):
            r = (t.get("result") or "").strip()
            logo = (t.get("pathToLogo") or "").strip()
            return {"id": t.get("id"), "name": (t.get("name") or "").strip(),
                    "score": int(r) if r.isdigit() else None,
                    "logo": (SWISS_LOGO + logo.lstrip("/")) if logo else None}
        ls = _SWISS_LS.search(g.get("liveStatsLink") or "")
        venue = " ".join(x for x in ((g.get("locationName") or "").strip(),) if x)
        city = (g.get("locationCity") or "").strip()
        out.append({"gid": gid, "date": g.get("date") or "", "time": g.get("time") or "",
                    "home": side(h), "away": side(a), "fiba_id": ls.group(1) if ls else None,
                    "venue": venue or None, "city": city or None,
                    "round": (g.get("matchDayName") or "").strip(), "phase": phase})
    return out


def _roman(s: str) -> int:
    total, prev = 0, 0
    for ch in reversed(str(s or "").upper()):
        v = _ROMAN.get(ch, 0)
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


def _kos_slug(name: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def kosovo_rows(page: str) -> list[dict]:
    """Every fixture on a basketbolli.com Results page, with the week it sits under. Each side is a
    <div class="team ..."> whose first <h4> is the club (names carry digits: "Rahoveci 029") and
    second its score; only a game set up on LiveStats has a webcast link."""
    import html as _html
    T = lambda x: re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", x or ""))).strip()  # noqa: E731
    weeks = [(m.start(), _roman(m.group(1)), m.group(0)) for m in _KOS_WEEK.finditer(page)]
    starts = [m.start() for m in _KOS_ROW.finditer(page)]
    out = []
    for i, st in enumerate(starts):
        chunk = page[st:(starts[i + 1] if i + 1 < len(starts) else st + 5000)]
        sides = _KOS_SIDE.findall(chunk)[:2]
        cells = [[T(h) for h in _KOS_H4.findall(s)] for s in sides]
        if len(cells) < 2 or not cells[0] or not cells[1]:
            continue
        crests = [(_KOS_CREST.search(s) or [None, None])[1] for s in sides]
        wk = next(((n, lbl) for pos, n, lbl in reversed(weeks) if pos < st), (0, ""))
        when = _KOS_WHEN.search(T(chunk))
        link = _WEBCAST.search(chunk) or re.search(r"geniussports\.com/webcast/[A-Za-z]+/(\d+)", chunk)
        sc = lambda c: int(c[1]) if len(c) > 1 and c[1].isdigit() else None  # noqa: E731
        out.append({"home": cells[0][0], "away": cells[1][0], "home_score": sc(cells[0]), "away_score": sc(cells[1]),
                    "home_crest": crests[0], "away_crest": crests[1], "week": wk[0],
                    "date": when.groups() if when else None, "fiba_id": link.group(1) if link else None})
    return out


# basketligaen.dk (Denmark's men's league, on FIBA LiveStats, client DBBF). The site is a Sportality
# single-page app in front of a plain JSON API, and robots.txt on it publishes no rules (every path
# answers with the app itself). Genius's hosted schedule for DBBF is EMPTY (0 bytes), and the site
# links a game to LiveStats only once the operator opens it - but the API already names the LiveStats
# game id of EVERY game, from the day the schedule exists: gameInfo.extId of
# GET /api/sports-v2/game-info/<gameUuid> (all 132 games of 2026-27 had one on 2026-09-27, all
# different, and a played game's id opens its box and play-by-play at once). So nothing here waits for
# a link or watches a game centre: the id is read once per game and remembered.
#   GET /season-series-game-types-filter      the seasons, the series and the game types (Grundspil = regular)
#   GET /game-schedule?seasonUuid&seriesUuid&gameTypeUuid&completeSeason=all&homeAway=all&allGames=all
#                                              every game of a game type: uuid, UTC start, state, both clubs
#   GET /game-info/<gameUuid>                 gameInfo.extId = the LiveStats id, arenaName
DBL_SITE = "https://www.basketligaen.dk"
DBL_API = DBL_SITE + "/api/sports-v2"

# api.data.cebl.ca - THE CANADIAN ELITE BASKETBALL LEAGUE's own schedule, the JSON behind cebl.ca/games. The key
# is the public one the site's own script sends (the scraper pipeline's cebl_scraper.py reads the same API).
#   GET /games/<year>/     every game of a season: id, start_time_utc, status (COMPLETE, CANELLED [sic]),
#                          competition (REGULAR, FINALS), both clubs (id, name, logo), scores, venue_name,
#                          stats_url_en -> fibalivestats.dcd.shared.geniussports.com/u/CEBL/<LiveStats id>/
CEBL_API = "https://api.data.cebl.ca"
CEBL_KEY = "800chyzv2hvur3z0ogh39cve2zok0c"
# THE CLUBS' OWN ABBREVIATIONS, by the league's team id: the codes the league's LiveStats feed prints (read from the
# 2026 season's games). The schedule API names a club and its id but no abbreviation, and a club's short_name is set
# once, when its first fixture creates it -- so without these the id key ("CEBL24") was the short name, and the
# leaders tables read CEBL24 for Winnipeg (reported 2026-09-30). A club not listed here (a new one) is given its own
# name, cut to fit, until it is added.
CEBL_ABBR = {14: "NRL", 16: "VAN", 17: "CGY", 18: "EDM", 19: "BHB", 20: "OTT", 21: "MTL", 22: "SSS", 24: "WPG", 56: "SSK"}


def _fold(s) -> str:
    """A club name as letters and digits only, accents dropped: the feed and the site agree on the club, not
    on the spelling of its punctuation ("Holbæk-Stenhus" / "Holbaek Stenhus")."""
    import unicodedata
    t = str(s or "").replace("æ", "ae").replace("Æ", "AE").replace("ø", "o").replace("Ø", "O").replace("å", "a").replace("Å", "A")
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", t)


# Puls Basketu (pulsbasketu.com): the Polish federation's leagues below the PLK, from the site's own
# JSON API. robots.txt on pulsbasketu.com allows every path to every agent; api.pulsbasketu.com
# publishes none (404), so nothing is disallowed there either.
PULS_API = "https://api.pulsbasketu.com/api/v1"
NKL_SITE = "https://nkl.lt"
NKL_MATCHES = NKL_SITE + "/matches/?type=schedule"
_NKL_ALL = re.compile(r"const allMatches\s*=\s*(\[.*?\]);\s*\n", re.S)
_NKL_STRIP = re.compile(r"<a\s+href=[\"']?https?://nkl\.lt/matches/(\d+)/[\"']?\s+class=[\"']?nkl-match-item(.*?)"
                        r"(?=<a\s+href=[\"']?https?://nkl\.lt/matches/|\Z)", re.S)
_NKL_WEBCAST = re.compile(r"livestats\.com/u/[A-Za-z]+/(\d+)", re.I)


def _name_tokens(name) -> set:
    import unicodedata
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    return {t for t in re.split(r"[^a-z0-9]+", s) if len(t) >= 4}


# online.basket.ee (the Estonian federation's live scores, BestIT's "basketis"): the ESTONIAN-LATVIAN league on FIBA
# LiveStats (client EBF). The league's own site (estlatbl.com) and the federation's (basket.ee) both disallow every
# crawler but the search engines in robots.txt; this portal publishes none (404) and serves each date's games as JSON,
# every game with its LiveStats id (sporting_id_live), upcoming ones included. BUT only for the dates its own menu
# offers - 13 days back to 7 ahead - and a date outside them answers an error page that e-mails their webmaster. So:
# the menu is read first and only its dates, a day inside each end, are ever asked for; one request every 30 s (the
# federation's crawl delay on its other sites); and each date is cached in data/feed/<CODE>/days.json, where a
# finished day is never asked for again. A pass after the first is the menu and a day or two.
BASKETEE = "https://online.basket.ee"
BASKETEE_HOME = BASKETEE + "/en"
BASKETEE_DAY = BASKETEE + "/s2/list/{date}/data.json"
BASKETEE_GAP_S = 30
BASKETEE_MENU_TTL_S = 6 * 3600
_BEE_SELECT = re.compile(r'<select\b[^>]*name="(date|chid)"[^>]*>(.*?)</select>', re.S)
_BEE_OPTION = re.compile(r'<option[^>]*value="([^"]*)"[^>]*>\s*([^<]*?)\s*</option>', re.S)


def basketee_menu(page: str) -> dict:
    """{"dates": [ISO date, ...], "chids": {championship name: id}} off the portal's two menus."""
    import html as _html
    out = {"dates": [], "chids": {}}
    for which, body in _BEE_SELECT.findall(page or ""):
        for value, label in _BEE_OPTION.findall(body):
            if which == "date":
                m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", value.strip())
                if m:
                    out["dates"].append(f"{m.group(3)}-{m.group(2)}-{m.group(1)}")
            elif value.strip():
                out["chids"][_html.unescape(label).strip()] = value.strip()
    return out


def basketee_rows(payload, chid: str) -> Optional[list]:
    """One date's games of one championship, slimmed to what a fixture needs. None when the payload is not the list
    (the portal's error page is HTML)."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return None
    out = []
    for r in payload["data"]:
        if str(r.get("chid")) != str(chid) or not r.get("gid"):
            continue
        out.append({"gid": str(r["gid"]), "date": r.get("date") or "", "time": r.get("time") or "",
                    "home": (r.get("team_home") or "").strip(), "away": (r.get("team_visitor") or "").strip(),
                    "h_tid": str(r.get("h_tid") or ""), "v_tid": str(r.get("v_tid") or ""),
                    "place": (r.get("place") or "").strip() or None,
                    "fls": str(r["sporting_id_live"]) if r.get("sporting_id_live") else None,
                    "over": str(r.get("is_over")) == "1"})
    return out


def _tallinn_today():
    """The portal's own date: Estonian time (the Latvian clubs' is the same)."""
    if ZoneInfo is None:
        return datetime.now(timezone.utc).date()
    return datetime.now(ZoneInfo("Europe/Tallinn")).date()


# legabasketfemminile.it (Lega Basket Femminile: Serie A1 and A2, women): games on FIBA LiveStats (client LEGBF). The
# site is a SvelteKit front on its own JSON API, and robots.txt allows every path to a general crawler (it closes the
# team and player PAGES to AI crawlers only; neither is read here):
#   /rm/v1/competitions/<serie-a1|serie-a2>/<2026-27>/calendar-index.json   every round and game of a season: the
#        game's id (a uuid), start_at (UTC), both clubs (id, slug, name, short_name, crest), status, points
#   /rm/v1/competitions/<...>/<season>/overview.json    the phases (Serie A2: "Girone A" and "Girone B", each a
#        round robin; a play-off phase is another format)
#   /rm/v1/matches/<id>.json                             one game: genius_id (the LiveStats id, null until the game
#        is set up), the officials, and a venue that is not to be trusted (see _lbf_fetch)
# The LiveStats id is asked for once per game, when the game is fetched, and kept in data/feed/<CODE>/games.json with
# its clubs; a game not set up yet is asked about again at most every 10 minutes. Clubs are keyed on the league's own
# team slug ("costa-masnaga"): its three-letter codes are not unique (two Cagliari clubs are both CAG in 2026-27, three
# clubs have none) and are not FIBA's (San Martino: SAN here, SML in the feed).
LBF_API = "https://www.legabasketfemminile.it/rm/v1"
LBF_GAP_S = 2.0
LBF_RECHECK_S = 600


def lbf_games(calendar: dict, overview: dict, stage: str = "regular") -> list[dict]:
    """The games of one stage off a calendar index: {id, start, status, home, away (club dicts), group}. Regular =
    the round-robin phases; a phase is a GROUP when there is more than one of them (Serie A2's two gironi)."""
    phases = {p.get("id"): p for p in (overview or {}).get("phases") or []}
    rr = [p for p in phases.values() if (p.get("format") or "round_robin") == "round_robin"]
    out = []
    for rnd in (calendar or {}).get("rounds") or []:
        ph = phases.get(rnd.get("phase_id")) or {}
        regular = (ph.get("format") or "round_robin") == "round_robin"
        if regular != (stage != "playoffs"):
            continue
        name = ph.get("name") or {}
        group = (name.get("it") or name.get("en") or "").strip() if regular and len(rr) > 1 else None
        for m in rnd.get("matches") or []:
            if not (m.get("id") and m.get("home") and m.get("away")):
                continue
            out.append({"id": m["id"], "start": m.get("start_at"), "status": m.get("status") or "scheduled",
                        "home": m["home"], "away": m["away"], "group": group or None})
    return out


def _utc(tz_name, y, mo, d, h, mi):
    """A local kick-off as an ISO instant, or None where the zone database is unavailable.

    The whole platform stores UTC; a fixture written in local time is an hour or two wrong for
    half the season, which is exactly long enough for nobody to notice until a play-off."""
    if ZoneInfo is None:
        return None
    try:
        local = datetime(int(y), int(mo), int(d), int(h), int(mi), tzinfo=ZoneInfo(tz_name))
        return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _slug_of(row: str, i: int):
    """The i-th club's own slug on nbl.basketball (/tym/bk-armex-energy-decin), as its code."""
    found = _CZ_TEAM_HREF.findall(row or "")
    return found[i] if len(found) > i else None


def livestats_crest(t: dict) -> Optional[str]:
    """A club's crest in a LiveStats payload's tm: logo / logoS / logoT (the largest first), an https URL only
    (feedplatform.Platform.logo_url reads the same fields the same way)."""
    for k in ("logo", "logoS", "logoT"):
        v = t.get(k)
        if isinstance(v, dict):
            v = v.get("url")
        if isinstance(v, str) and v.startswith("https://"):
            return v
    return None


def _start_year(season: str) -> int:
    """"2026-27" -> 2026. The platform's season name is the one thing every source agrees on."""
    m = re.match(r"(\d{4})", str(season or ""))
    if m:
        return int(m.group(1))
    # NO SEASON CONFIGURED = THE CURRENT ONE, by the platform's own cut-over (August, as
    # feedplatform.season_name_for): the calendar year alone asked for NEXT season every January
    # to July - 2027 in March 2027, when the season being played started in 2026
    now = time.gmtime()
    return now.tm_year if now.tm_mon >= 8 else now.tm_year - 1


def czech_rows(page: str, base: str, competition_page: bool = False) -> list[dict]:
    """Every fixture row on a ČBF schedule page: an NBL-style /zapasy page, or the "Zápasy" tab of a
    federation competition page (which also carries the part's name in its first cell and the hall
    after the kick-off). A row names the fixture (/zapas/<id>), both clubs, the kick-off, and - once the
    game is set up - its LiveStats webcast, which saves the hop to the game's own page."""
    import html as _html
    i = page.find('id="tab-pane-one"') if competition_page else -1
    if i >= 0:                                              # a competition page: its fixtures tab only (the
        j = page.find('id="tab-pane-two"', i)               # table and the records tabs link games too)
        page = page[i:j if j > i else None]
    out, seen = [], set()
    for row in _CZ_ROW.findall(page):
        m = _ZAPAS.search(row)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.S)
        text = lambda c: re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", c or ""))).strip()  # noqa: E731
        names_ = [n.strip() for n in _CZ_TEAM.findall(row) if n.strip()]
        when = _CZ_WHEN.search(row)
        web = _WEBCAST.search(row) or _WEBCAST_ANY.search(row)
        # the hall: a plain cell straight after the kick-off's (a competition page has one; NBL's page has the clubs there)
        venue = None
        dt = next((k for k, c in enumerate(re.findall(r"<td\b[^>]*>", row)) if _CZ_WHEN.search(c)), None)
        if dt is not None and dt + 1 < len(cells) and "<" not in cells[dt + 1] and re.search(r"[^\W\d_]", cells[dt + 1]):
            venue = text(cells[dt + 1]) or None
        part = text(cells[0]) if cells and re.match(r"\s*(skupina|z[áa]kladn|nadstavb|play|baráž|final)", text(cells[0]), re.I) else None
        out.append({"sid": m.group(1), "home": names_[0] if names_ else "", "away": names_[1] if len(names_) > 1 else "",
                    "when": when.groups() if when else None, "crests": [base + u for u in _CZ_LOGO.findall(row)],
                    "fiba_id": web.group(1) if web else None, "venue": venue, "part": part})
    return out


class FibaSiteScheduleAdapter(FibaLiveStatsAdapter):
    name = "fiba_site_schedule"
    min_request_gap_s = 0.6          # somebody's own website, not a CDN: slower than the feed host

    # ------------------------------------------------------------------ plumbing ---
    def _page(self, url: str) -> str:
        gap = time.time() - getattr(self, "_last_page", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_page = time.time()
        r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
        r.raise_for_status()
        return r.text

    @staticmethod
    def _map_path(config: dict) -> Optional[str]:
        code = config.get("code") or config.get("client_code")
        if not code:
            return None
        root = config.get("repo_root") or os.getcwd()
        return os.path.join(root, "data", "feed", str(code), "idmap.json")

    def _idmap(self, config: dict) -> dict:
        p = self._map_path(config)
        if p and os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_idmap(self, config: dict, m: dict) -> None:
        p = self._map_path(config)
        if not p:
            return
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(m, f, indent=1, sort_keys=True)
        except Exception:
            pass                      # a cache that cannot be written is a slow pass, not a failure

    def fetch(self, external_id: str, config: dict):
        """The FIBA fetch, with the Czech id translated to the LiveStats one on the way in."""
        site = (config.get("site") or "").lower()
        if site in ("czech", "czech_nbl", "cbffe"):
            mid = self._czech_match_id(str(external_id), config)
            if not mid:
                return None        # the fixture exists, its webcast does not yet
            b = super().fetch(mid, config)
            # THE GAME KEEPS THE FIXTURE'S ID. Handed back under the LiveStats id, every game was
            # written to a second external_games row and a second game (18-25 Sep 2026), and the
            # fixture row never became final - so each catch-up and discovery pass fetched and
            # rewrote every finished Czech game again. The NKL, Puls Basketu and Kosovo paths
            # already re-key this way. scripts/ingest/repair_czech_split.py mends the old rows.
            if b is not None:
                b.external_id = str(external_id)
            return b
        if site == "nkl":
            return self._nkl_fetch(str(external_id), config)
        if site == "pulsbasketu":
            return self._puls_fetch(str(external_id), config)
        if site == "kosovo":
            return self._kos_fetch(str(external_id), config)
        if site == "basketligaen":
            return self._dbl_fetch(str(external_id), config)
        if site == "basketee":
            return self._bee_fetch(str(external_id), config)
        if site == "lbf":
            return self._lbf_fetch(str(external_id), config)
        if site == "swiss":
            return self._swiss_fetch(str(external_id), config)
        if site == "cebl":
            return self._cebl_fetch(str(external_id), config)
        return super().fetch(external_id, config)

    # ---------------------------------------------------------------- the sites ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        site = (config.get("site") or "").lower()
        if site in ("czech", "czech_nbl", "cbffe"):
            return self._czech(config)
        if site in ("slovakia", "slovakia_sbl", "sba"):
            return self._slovakia(config)
        if site == "nkl":
            return self._nkl(config)
        if site == "pulsbasketu":
            return self._puls(config)
        if site == "kosovo":
            return self._kos(config)
        if site == "basketligaen":
            return self._dbl(config)
        if site == "basketee":
            return self._bee(config)
        if site == "lbf":
            return self._lbf(config)
        if site == "swiss":
            return self._swiss(config)
        if site == "cebl":
            return self._cebl(config)
        # not one of ours: let the Genius behaviour have it (a hosted URL still works)
        return super().discover(schedule_url, config)

    # ------------------------------------------------------------ basketbolli.com ---
    # THE KOSOVO SUPERLIGA. The Results page lists the whole season (112 games, 8 clubs x 28) under
    # its weeks ("JAVA I" ...), played and to come; a game gets a LiveStats link once the federation
    # sets it up. A fixture has no id of its own before that, so it is keyed on the season's
    # leagueId, the week and the two clubs - "KOS150-W1-rahoveci-029-trepca" - which holds from the
    # fixture to the final, and the LiveStats id is remembered against the key when it appears.
    # A 20-0 forfeit has no LiveStats data and is left out (it would sit as "scheduled" for good).
    # A row with no date yet is left out until the federation dates it.
    _kos_cache: tuple = (0.0, "", "")      # (fetched_at, url, page)

    def _kos_url(self, config: dict) -> Optional[str]:
        label = (config.get("menu_label") or KOS_MENU_LABEL).upper()
        try:
            home = self._page(KOS_SITE + "/")
        except Exception as exc:
            print(f"     KOS: the site's menu could not be read ({exc})")
            return None
        import html as _html
        for href, text in re.findall(r'href="(/Results\?leagueId=\d+)"[^>]*>([^<]+)</a>', home):
            if _html.unescape(text).strip().upper() == label:
                return KOS_SITE + href
        print(f"     KOS: no '{label}' in the site's menu")
        return None

    def _kos_page(self, config: dict) -> tuple[Optional[str], str]:
        at, url, page = FibaSiteScheduleAdapter._kos_cache
        if page and time.time() - at < 300:
            return url, page
        url = self._kos_url(config)
        if not url:
            return None, ""
        page = self._page(url)
        FibaSiteScheduleAdapter._kos_cache = (time.time(), url, page)
        return url, page

    @staticmethod
    def _kos_key(league_id: str, r: dict) -> str:
        return f"KOS{league_id}-W{r['week']}-{_kos_slug(r['home'])}-{_kos_slug(r['away'])}"

    def _kos(self, config: dict) -> list[ScheduleGame]:
        stage = (config.get("stage") or "").strip().lower()
        want_year = _start_year(config.get("season") or "")
        now_year = _start_year("")
        if want_year != now_year:
            print(f"     KOS: only the current season is on the site ({now_year}/{now_year + 1}); "
                  f"{want_year}/{want_year + 1} has been purged")
            return []
        url, page = self._kos_page(config)
        if not page:
            return []
        league_id = (re.search(r"leagueId=(\d+)", url or "") or [None, "0"])[1]
        known = self._idmap(config)
        out, changed = [], False
        for r in kosovo_rows(page):
            st = "regular" if r["week"] else "playoffs"
            if stage and st != stage:
                continue
            if {r["home_score"], r["away_score"]} == {20, 0}:
                continue                      # a forfeit: no game to show
            if not r["date"]:
                continue                      # not dated yet
            key = self._kos_key(league_id, r)
            if r["fiba_id"] and known.get(key) != r["fiba_id"]:
                known[key] = r["fiba_id"]
                changed = True
            d, mo, y, h, mi = r["date"]
            tip = _utc("Europe/Belgrade", y, mo, d, h, mi)
            played = r["home_score"] is not None and r["away_score"] is not None and (r["home_score"] or r["away_score"])
            crest = lambda c: f"{KOS_SITE}/{c}" if c else None  # noqa: E731
            out.append(ScheduleGame(
                external_id=key, home_name=r["home"], away_name=r["away"], tipoff_at=tip,
                status="final" if played else "scheduled",
                extra={"home_code": _kos_slug(r["home"]), "away_code": _kos_slug(r["away"]),
                       "home_logo": crest(r["home_crest"]), "away_logo": crest(r["away_crest"]),
                       "round": f"Java {r['week']}" if r["week"] else "", "stage": st}))
        if changed:
            self._save_idmap(config, known)
        print(f"     KOS leagueId {league_id} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _kos_fetch(self, key: str, config: dict):
        known = self._idmap(config)
        fid = known.get(key)
        # the row names the clubs (the feed's codes are three letters an operator typed) and, for a
        # game set up since the last pass, carries its LiveStats id; the page is cached for 5 minutes
        url, page = self._kos_page(config)
        league_id = (re.search(r"leagueId=(\d+)", url or "") or [None, "0"])[1]
        row = next((r for r in kosovo_rows(page or "") if self._kos_key(league_id, r) == key), None)
        if row and row["fiba_id"] and not fid:
            fid = row["fiba_id"]
            known[key] = fid
            self._save_idmap(config, known)
        if not fid:
            return None                    # not set up on LiveStats yet
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=fid))
        if not raw or "tm" not in raw:
            return None
        if row:
            for tno, side in (("1", "home"), ("2", "away")):
                if isinstance(raw["tm"].get(tno), dict):
                    raw["tm"][tno]["code"] = _kos_slug(row[side])
                    raw["tm"][tno]["name"] = row[side]
        b = self.bundle_from_raw(raw, key, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------ basketligaen.dk ---
    # THE DANISH MEN'S LEAGUE. A fixture is keyed on its LiveStats id (gameInfo.extId), so the ordinary
    # data.json fetch serves it and the game keeps one identity from the first sighting to the final. The id
    # is asked for once per game (the schedule list does not carry it) and kept in data/feed/DBL/idmap.json,
    # so a pass after the first is one schedule request. A game with no id yet is left out until it has one.
    # Not yet scored, data.json answers 403 and fetch() returns None: the next poll asks again.
    _dbl_cache: dict = {}            # "filter" / "clubs" -> (fetched_at, payload) - shared by every source row

    def _dbl_json(self, url: str):
        gap = time.time() - getattr(self, "_last_page", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_page = time.time()
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=40)
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        return r.json()

    def _dbl_filter(self):
        at, cached = FibaSiteScheduleAdapter._dbl_cache.get("filter", (0.0, None))
        if cached is None or time.time() - at > 300:
            cached = self._dbl_json(DBL_API + "/season-series-game-types-filter")
            if cached:
                FibaSiteScheduleAdapter._dbl_cache["filter"] = (time.time(), cached)
        return cached

    def _dbl_schedule(self, config: dict) -> tuple[list, list, Optional[str]]:
        """(games, clubs, why-not): the season's games of the configured stage, and the site's club list."""
        stage = (config.get("stage") or "regular").strip().lower()
        want = _start_year(config.get("season") or "")
        filt = self._dbl_filter()
        if not filt:
            return [], [], "the season filter could not be read"
        series = config.get("series_uuid") or next(
            (x["uuid"] for x in filt.get("series") or [] if x.get("code") == "DBL"), None) \
            or next((x["uuid"] for x in filt.get("series") or []), None)
        season = next((x["uuid"] for x in filt.get("season") or [] if str(x.get("code")) == str(want)), None)
        if not (series and season):
            return [], [], f"no {want}/{want + 1} season on the site"
        types = [t for t in filt.get("gameType") or [] if (t.get("code") == "regular") == (stage == "regular")]
        games, clubs = [], {}
        for t in types:
            reply = self._dbl_json(f"{DBL_API}/game-schedule?seasonUuid={season}&seriesUuid={series}&gameTypeUuid={t['uuid']}"
                                   "&completeSeason=all&homeAway=all&allGames=all") or {}
            for g in reply.get("gameInfo") or []:
                games.append(dict(g, _gt=t.get("code")))
            for c in reply.get("teamList") or []:
                clubs[c.get("uuid")] = c
        return games, list(clubs.values()), None

    def _dbl_clubs(self, config: dict) -> list:
        """The site's clubs (uuid, code, names), cached five minutes: what a game's feed names are read against."""
        at, cached = FibaSiteScheduleAdapter._dbl_cache.get("clubs", (0.0, None))
        if cached is None or time.time() - at > 300:
            games, clubs, _ = self._dbl_schedule(config)
            seen = {}
            for g in games:
                for side in ("homeTeamInfo", "awayTeamInfo"):
                    t = g.get(side) or {}
                    if t.get("uuid"):
                        seen[t["uuid"]] = t
            cached = list(seen.values())
            if cached:
                FibaSiteScheduleAdapter._dbl_cache["clubs"] = (time.time(), cached)
        return cached or []

    def _dbl(self, config: dict) -> list[ScheduleGame]:
        games, _clubs, why = self._dbl_schedule(config)
        if why:
            print(f"     DBL: {why}")
            return []
        stage = (config.get("stage") or "regular").strip().lower()
        known = self._idmap(config)
        out, changed, no_id = [], False, 0
        for g in games:
            uuid = g.get("uuid")
            ext = known.get(uuid)
            if not ext:
                info = self._dbl_json(f"{DBL_API}/game-info/{uuid}") or {}
                ext = str((info.get("gameInfo") or {}).get("extId") or "").strip()
                if not ext.isdigit():
                    no_id += 1
                    continue
                known[uuid] = ext
                changed = True
            h, a = g.get("homeTeamInfo") or {}, g.get("awayTeamInfo") or {}
            hn, an = h.get("names") or {}, a.get("names") or {}
            state = str(g.get("state") or "").lower().replace("_", "-")
            status = "final" if state.startswith("post") else ("live" if "live" in state else "scheduled")
            rnd = (g.get("roundLabel") or "").strip() or (f"Round {g['roundNumber']}" if g.get("roundNumber") else "")
            tip = g.get("rawStartDateTime")                    # UTC already ("2026-09-17T17:00:00.000Z"): the platform's own form
            try:
                tip = datetime.strptime(tip, "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%dT%H:%M:%SZ")
            except (TypeError, ValueError):
                pass
            out.append(ScheduleGame(
                external_id=ext, home_name=hn.get("short") or hn.get("full") or "", away_name=an.get("short") or an.get("full") or "",
                tipoff_at=tip, status=status,
                extra={"home_code": h.get("code"), "away_code": a.get("code"), "home_logo": h.get("icon"), "away_logo": a.get("icon"),
                       "venue": (g.get("venueInfo") or {}).get("name"), "round": rnd, "stage": stage}))
        if changed:
            self._save_idmap(config, known)
        print(f"     DBL {stage}: {len(out)} games ({sum(1 for x in out if x.status == 'final')} final)"
              + (f", {no_id} without a LiveStats id yet" if no_id else ""))
        return out

    def _dbl_fetch(self, external_id: str, config: dict):
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=external_id))
        if not raw or "tm" not in raw:
            return None                    # not scored yet (403 before the operator opens it)
        # THE SITE NAMES THE CLUBS: the feed's codes are typed by an operator per game ("Hol" here, "HOL" on
        # the site; "Sko" for a club the site calls SKO), which would file one club under two codes.
        try:
            clubs = self._dbl_clubs(config)
        except Exception:
            clubs = []
        for tno in ("1", "2"):
            t = raw["tm"].get(tno)
            if not isinstance(t, dict) or not clubs:
                continue
            keys = {_fold(t.get("name")), _fold(t.get("shortName")), _fold(t.get("code"))} - {""}
            hit = next((c for c in clubs if keys & {_fold((c.get("names") or {}).get(k)) for k in ("short", "full", "long", "code")} - {""}
                        or _fold(t.get("code")) == _fold(c.get("code"))), None)
            if hit:
                t["code"] = hit.get("code") or t.get("code")
                t["name"] = (hit.get("names") or {}).get("short") or t.get("name")
        b = self.bundle_from_raw(raw, external_id, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------------ cebl.ca ---
    # THE CEBL: a summer league (May to August), so a calendar-year season ("season_calendar" on its rows),
    # scored on FIBA LiveStats. Every game on the league's own API names its LiveStats match, so a fixture is
    # keyed on that id from its first listing to its final, and is fetched as any LiveStats game is. The
    # regular season and the finals (competition FINALS) are two sources, like every league here with
    # play-offs; a cancelled game is left out (it would sit as "scheduled" for good). The clubs are coded by
    # the league's own team id ("CEBL18"), on the fixture and on the feed alike, so a club is one club
    # whatever an operator types into a game's team code.
    # THE ELAM ENDING: a CEBL fourth quarter ends on a target score, not the clock. Every basket is in the
    # box score; the clock stands still through the Elam segment, so minutes and stints undercount it.
    _cebl_cache: dict = {}           # year -> (fetched_at, games)

    def _cebl_games(self, config: dict) -> list:
        year = _start_year(config.get("season") or "")
        at, games = FibaSiteScheduleAdapter._cebl_cache.get(year, (0.0, None))
        if games is None or time.time() - at > 300:
            gap = time.time() - getattr(self, "_last_page", 0)
            if gap < self.min_request_gap_s:
                time.sleep(self.min_request_gap_s - gap)
            self._last_page = time.time()
            r = requests.get(f"{CEBL_API}/games/{year}/", headers={"User-Agent": UA, "x-api-key": CEBL_KEY}, timeout=40)
            r.raise_for_status()
            games = r.json()
            if isinstance(games, dict):
                games = games.get("games") or games.get("data") or []
            FibaSiteScheduleAdapter._cebl_cache[year] = (time.time(), games)
        return games or []

    @staticmethod
    def _cebl_id(g: dict) -> Optional[str]:
        m = re.search(r"/u/CEBL/(\d+)", str(g.get("stats_url_en") or g.get("stats_url_fr") or ""))
        return m.group(1) if m else None

    def _cebl(self, config: dict) -> list[ScheduleGame]:
        stage = (config.get("stage") or "regular").strip().lower()
        finals = stage.startswith("play") or stage.startswith("final")
        try:
            games = self._cebl_games(config)
        except Exception as exc:
            print(f"     CEBL: the league's schedule could not be read ({exc})")
            return []
        out, no_id = [], 0
        for g in games:
            comp = str(g.get("competition") or "").upper()
            if comp not in (("FINALS", "PLAYOFFS", "PLAYOFF") if finals else ("REGULAR",)):
                continue
            st = str(g.get("status") or "").upper()
            if st.startswith("CAN") or st == "POSTPONED":
                continue
            mid = self._cebl_id(g)
            if not mid:
                no_id += 1
                continue
            status = "final" if st == "COMPLETE" else ("live" if st in ("IN_PROGRESS", "INPROGRESS", "LIVE") else "scheduled")
            out.append(ScheduleGame(
                external_id=mid, home_name=g.get("home_team_name") or "", away_name=g.get("away_team_name") or "",
                tipoff_at=g.get("start_time_utc"), status=status,
                extra={"home_code": f"CEBL{g.get('home_team_id')}" if g.get("home_team_id") is not None else None,
                       "away_code": f"CEBL{g.get('away_team_id')}" if g.get("away_team_id") is not None else None,
                       "home_short": CEBL_ABBR.get(g.get("home_team_id")), "away_short": CEBL_ABBR.get(g.get("away_team_id")),
                       "home_logo": g.get("home_team_logo_url"), "away_logo": g.get("away_team_logo_url"),
                       "venue": g.get("venue_name"), "stage": stage}))
        print(f"     CEBL {stage}: {len(out)} games ({sum(1 for x in out if x.status == 'final')} final)"
              + (f", {no_id} without a LiveStats id yet" if no_id else ""))
        return out

    def _cebl_fetch(self, external_id: str, config: dict):
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=external_id)
                                   + (f"?_={int(time.time() * 1000)}" if config.get("_fresh") else ""))
        if not raw or "tm" not in raw:
            return None                    # not scored yet (403 before the operator opens it)
        try:
            g = next((x for x in self._cebl_games(config) if self._cebl_id(x) == str(external_id)), None)
        except Exception:
            g = None
        if g:
            sides = {"home": (g.get("home_team_id"), g.get("home_team_name")), "away": (g.get("away_team_id"), g.get("away_team_name"))}
            teams = {tno: raw["tm"].get(tno) for tno in ("1", "2") if isinstance(raw["tm"].get(tno), dict)}
            # by name first (the feed's team 1 is the home side by LiveStats' convention, not by rule)
            by_name = {}
            for tno, t in teams.items():
                keys = {_fold(t.get("name")), _fold(t.get("shortName"))} - {""}
                for side, (_, nm) in sides.items():
                    if _fold(nm) in keys:
                        by_name[tno] = side
            if len(set(by_name.values())) != len(teams):
                by_name = {"1": "home", "2": "away"}
            for tno, side in by_name.items():
                tid, nm = sides[side]
                if tno in teams and tid is not None:
                    teams[tno]["code"] = f"CEBL{tid}"
                    teams[tno]["name"] = nm or teams[tno].get("name")
        b = self.bundle_from_raw(raw, external_id, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------ swiss.basketball ---
    # A fixture is keyed on its Basketplan game id ("BP367239"), which exists from the day the schedule
    # is published and is what the site itself links. Its LiveStats id is looked for on every fetch
    # until one is found whose feed names the fixture's two clubs, and then kept for good in
    # data/feed/<CODE>/idmap.json. THE CHECK IS NOT A FORMALITY: on 2026-09-27 Basketplan gave one
    # LiveStats id (2909496) to two different games, an SBL men's and an SBL women's, and the site's
    # widget had the right one for the men's. So both candidates are tried, the widget's first, and a
    # feed naming other clubs is never kept. Not yet started, data.json answers 403 and fetch() is None.
    _swiss_cache: dict = {}          # url -> (fetched_at, text), shared by every Swiss source row

    def _swiss_text(self, url: str, ttl: float = 300.0) -> str:
        at, text = FibaSiteScheduleAdapter._swiss_cache.get(url, (0.0, None))
        if text is None or time.time() - at > ttl:
            text = self._page(url)
            FibaSiteScheduleAdapter._swiss_cache[url] = (time.time(), text)
        return text

    def _swiss_rows(self, config: dict) -> tuple[list, Optional[str]]:
        """(every game of the configured league's season, each with its phase; why-not)."""
        league = str(config.get("basketplan_league") or "").strip()
        path = str(config.get("league_path") or "sbl/men").strip("/")
        if not league:
            return [], "adapter_config needs basketplan_league"
        want = _start_year(config.get("season") or "")
        season = str(config.get("basketplan_season") or "") or swiss_season_ids(
            self._swiss_text(SWISS_PAGE.format(path=path), ttl=3600)).get(want)
        if not season:
            return [], f"no {want}/{want + 1} season on the site yet"
        holdings = swiss_holdings(self._swiss_text(SWISS_HOLDINGS.format(league=league, season=season)))
        if not holdings:
            return [], f"no phases published for {want}/{want + 1} yet"
        rows = []
        for h in holdings:
            for r in swiss_games(self._swiss_text(SWISS_SCHEDULE.format(league=league, holding=h["id"]))):
                r["phase"] = r["phase"] or h["phase"]
                rows.append(r)
        return rows, None

    def _swiss_widget_ids(self, config: dict) -> dict:
        """{(date, folded home, folded away): LiveStats id} from the site's widget, where it has one."""
        w = str(config.get("widget") or "").strip()
        if not w:
            return {}
        try:
            data = json.loads(self._swiss_text(SWISS_WIDGET.format(widget=w)) or "{}")
        except Exception:
            return {}
        out = {}
        for day, games in (data.items() if isinstance(data, dict) else []):
            for g in games or []:
                if g.get("match_id"):
                    out[(str(day), _fold(g.get("home_team_name")), _fold(g.get("guest_team_name")))] = str(g["match_id"])
        return out

    @staticmethod
    def _swiss_stage(r: dict) -> str:
        return "playoffs" if str(r.get("phase") or "").upper().startswith("PLAYOFF") else "regular"

    def _swiss(self, config: dict) -> list[ScheduleGame]:
        rows, why = self._swiss_rows(config)
        if why:
            print(f"     {config.get('code') or 'SUI'}: {why}")
            return []
        stage = (config.get("stage") or "").strip().lower()
        out = []
        for r in rows:
            st = self._swiss_stage(r)
            if stage and st != stage:
                continue
            m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", r["date"])
            t = re.match(r"(\d{1,2}):(\d{2})", r["time"])
            if not m:
                continue                              # not dated yet
            tip = _utc("Europe/Zurich", *m.groups(), *(t.groups() if t else ("12", "00")))
            h, a = r["home"], r["away"]
            played = h["score"] is not None and a["score"] is not None and (h["score"] or a["score"])
            extra = {"home_code": _kos_slug(h["name"]), "away_code": _kos_slug(a["name"]),
                     "home_logo": h["logo"], "away_logo": a["logo"],
                     "venue": ", ".join(x for x in (r["venue"], r["city"]) if x) or None,
                     "round": r["round"], "stage": st}
            if not t:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id="BP" + r["gid"], home_name=h["name"], away_name=a["name"],
                                    tipoff_at=tip, status="final" if played else "scheduled", extra=extra))
        print(f"     {config.get('code') or 'SUI'} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    @staticmethod
    def _swiss_same_clubs(raw: dict, row: dict) -> bool:
        """The feed names the fixture's two clubs, home as home - by a shared word of four letters or more."""
        tm = (raw or {}).get("tm") or {}
        for tno, side in (("1", "home"), ("2", "away")):
            t = tm.get(tno) or {}
            feed = _name_tokens(t.get("name")) | _name_tokens(t.get("shortName"))
            if not (feed & _name_tokens(row[side]["name"])) and _fold(t.get("name")) != _fold(row[side]["name"]):
                return False
        return True

    def _swiss_fetch(self, key: str, config: dict):
        gid = re.sub(r"\D", "", key)
        known = self._idmap(config)
        rows, _why = self._swiss_rows(config)
        row = next((r for r in rows if r["gid"] == gid), None)
        fid, raw, meta = known.get(gid), None, None
        if fid:
            raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=fid))
        elif row:
            wid = self._swiss_widget_ids(config).get((row["date"], _fold(row["home"]["name"]), _fold(row["away"]["name"])))
            for cand in dict.fromkeys(x for x in (wid, row["fiba_id"]) if x):
                got, got_meta = self._get_meta(FIBA_DATA_URL.format(game_id=cand))
                if not got or "tm" not in got:
                    continue                          # not started yet, or not this id
                if not self._swiss_same_clubs(got, row):
                    print(f"     SUI {key}: LiveStats {cand} names other clubs - not kept")
                    continue
                fid, raw, meta = cand, got, got_meta
                known[gid] = cand
                self._save_idmap(config, known)
                break
        if not raw or "tm" not in raw:
            return None
        if row:
            # THE SCHEDULE NAMES THE CLUBS, as it did when the fixture was filed: the same name and the
            # same code on both, whatever an operator typed into the feed for this game
            for tno, side in (("1", "home"), ("2", "away")):
                if isinstance(raw["tm"].get(tno), dict):
                    raw["tm"][tno]["code"] = _kos_slug(row[side]["name"])
                    raw["tm"][tno]["name"] = row[side]["name"]
        b = self.bundle_from_raw(raw, key, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------ pulsbasketu.com ---
    # THE POLISH LEAGUES BELOW THE PLK (1 Liga Mężczyzn, 1 Liga Kobiet). The federation scores them
    # on FIBA LiveStats (client POL), but its own sites (1lm.pzkosz.pl, rozgrywki.pzkosz.pl) never
    # link a game to LiveStats, and POL's hosted Genius site is switched off (every page empty). Puls
    # Basketu keeps the link: its API names every game's LiveStats id (fiba_game_id).
    #   GET /league-seasons/<abbr>/games?season=<end year>   the season, one request, every stage
    #   GET /games/<id>                                      one game, with fiba_game_id
    # A fixture is keyed on the Puls game id, which exists from the day the schedule is published;
    # its LiveStats id appears only once the federation has set the game up (none on 2026-09-24 for
    # a game six days away), so fetch() asks for it until it is there and remembers it for good.
    _puls_cache: dict = {}            # (abbr, season) -> (fetched_at, schedule) - shared by both stages

    def _puls_json(self, url: str):
        gap = time.time() - getattr(self, "_last_page", 0.0)
        if gap < 1.0:
            time.sleep(1.0 - gap)
        self._last_page = time.time()
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=40)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def _puls_games(self, config: dict) -> list:
        """Every game of the configured league's season, each tagged with its schedule stage key."""
        abbr = str(config.get("league") or "").strip().lower()
        if not abbr:
            raise ValueError("pulsbasketu: adapter_config needs league (e.g. \"1lm\")")
        season = str(_start_year(config.get("season") or "") + 1)      # the site names a season by its end year
        key = (abbr, season)
        at, cached = FibaSiteScheduleAdapter._puls_cache.get(key, (0.0, None))
        if cached is None or time.time() - at > 300:
            reply = self._puls_json(f"{PULS_API}/league-seasons/{abbr}/games?season={season}") or {}
            cached = []
            for stage_key, stage in (reply.get("schedule") or {}).items():
                for line in (stage.get("lines") or {}).values():
                    for g in line.get("games") or []:
                        cached.append(dict(g, _stage_key=stage_key))
            FibaSiteScheduleAdapter._puls_cache[key] = (time.time(), cached)
        return cached

    def _puls(self, config: dict) -> list[ScheduleGame]:
        """stage "regular" is the REGULAR_SEASON block, "playoffs" every other block."""
        stage = (config.get("stage") or "").strip().lower()
        out = []
        for g in self._puls_games(config):
            st = "regular" if g.get("_stage_key") == "REGULAR_SEASON" else "playoffs"
            if stage and st != stage:
                continue
            home, away = g.get("home_team") or {}, g.get("away_team") or {}
            m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", str(g.get("date") or ""))
            tbc = not m or (m.group(4), m.group(5)) == ("00", "00")   # 00:00 local = no time set yet
            if m and not tbc:
                tip = _utc("Europe/Warsaw", *m.groups())
            else:
                tip = f"{m.group(1)}-{m.group(2)}-{m.group(3)}T12:00:00Z" if m else None
            logo = lambda t: (t.get("logo_url") if str(t.get("logo_url") or "").startswith("https://") else None)  # noqa: E731
            extra = {"home_code": str(home.get("team_id") or "") or None,
                     "away_code": str(away.get("team_id") or "") or None,
                     "home_logo": logo(home), "away_logo": logo(away),
                     "round": " · ".join(x for x in (g.get("stage"), g.get("round")) if x), "stage": st}
            grp = str((g.get("league") or {}).get("group") or "").strip()
            if grp:
                extra["home_group"] = extra["away_group"] = grp
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(
                external_id=str(g["game_id"]), home_name=(home.get("name") or "").strip(),
                away_name=(away.get("name") or "").strip(), tipoff_at=tip,
                status="final" if g.get("finished") else "live" if g.get("in_progress") else "scheduled",
                extra=extra))
        print(f"     Puls Basketu {config.get('league')} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _puls_fiba_id(self, gid: str, config: dict) -> Optional[str]:
        known = self._idmap(config)
        if known.get(gid):
            return known[gid]
        reply = self._puls_json(f"{PULS_API}/games/{gid}") or {}
        fid = str(reply.get("fiba_game_id") or "").strip()
        if not fid.isdigit():
            return None                   # the federation has not set this game up on LiveStats yet
        known[gid] = fid
        self._save_idmap(config, known)
        return fid

    def _puls_fetch(self, gid: str, config: dict):
        """The FIBA fetch for a Puls Basketu fixture, with the site's own club ids and names put on
        the payload - LiveStats' team codes are three letters the operator types, not an identity."""
        fid = self._puls_fiba_id(gid, config)
        if not fid:
            return None
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=fid))
        if not raw or "tm" not in raw:
            return None
        fixture = next((g for g in self._puls_games(config) if str(g.get("game_id")) == gid), None)
        if fixture:
            for tno, side in (("1", "home_team"), ("2", "away_team")):
                t = fixture.get(side) or {}
                if isinstance(raw["tm"].get(tno), dict):
                    raw["tm"][tno]["code"] = str(t.get("team_id") or raw["tm"][tno].get("code") or "")
                    raw["tm"][tno]["name"] = (t.get("name") or "").strip() or raw["tm"][tno].get("name") or ""
        b = self.bundle_from_raw(raw, gid, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------------ nkl.lt ---
    _nkl_cache: tuple = (0.0, [])        # (fetched_at, allMatches) - shared: two sources, many fetches

    def _nkl_matches(self) -> list:
        at, cached = FibaSiteScheduleAdapter._nkl_cache
        if cached and time.time() - at < 300:
            return cached
        m = _NKL_ALL.search(self._page(NKL_MATCHES))
        rows = json.loads(m.group(1)) if m else []
        FibaSiteScheduleAdapter._nkl_cache = (time.time(), rows)
        return rows

    def _nkl(self, config: dict) -> list[ScheduleGame]:
        """nkl.lt: the season's every game from the schedule page's own array, keyed on the site's
        match id (a fixture's LiveStats id is not known for most of the season - see _nkl_fiba_id).
        stage "regular" is stage_type_id 1, "playoffs" everything else."""
        stage = (config.get("stage") or "").strip().lower()
        year = _start_year(config.get("season") or "")
        rows = [r for r in self._nkl_matches() if int(r.get("season") or 0) == year]
        out = []
        for r in rows:
            st = "regular" if int(r.get("stage_type_id") or 0) == 1 else "playoffs"
            if stage and st != stage:
                continue
            d = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(r.get("date_label") or ""))
            t = re.match(r"(\d{1,2}):(\d{2})", str(r.get("time") or ""))
            tbc = not t or t.group(0) in ("0:00", "00:00")
            if d and not tbc:
                tip = _utc("Europe/Vilnius", *d.groups(), *t.groups())
            else:
                tip = f"{d.group(1)}-{d.group(2)}-{d.group(3)}T12:00:00Z" if d else None
            logo = lambda u: (str(u or "").replace("http://", "https://", 1) or None)  # noqa: E731
            extra = {"home_code": str(r.get("home_team_id") or "") or None,
                     "away_code": str(r.get("away_team_id") or "") or None,
                     "home_logo": logo(r.get("home_logo")), "away_logo": logo(r.get("away_logo")),
                     "venue": (r.get("arena") or "").strip() or None,
                     "round": f"{r.get('stage_name') or ''} · {r.get('round_no') or ''}".strip(" ·"), "stage": st}
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(
                external_id=str(r["id"]), home_name=(r.get("home_name") or "").strip(),
                away_name=(r.get("away_name") or "").strip(), tipoff_at=tip,
                status="final" if r.get("is_result") else "live" if r.get("is_running") else "scheduled",
                extra=extra))
        print(f"     NKL {year}/{year + 1} {stage or 'all stages'}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)")
        return out

    def _nkl_fiba_id(self, sid: str, fixture: Optional[dict], config: dict) -> Optional[str]:
        """The LiveStats id behind an nkl.lt match id: remembered, else read off the homepage's
        match strip, else the offset the known pairs share - tried, and kept only when the feed
        itself names the fixture's two clubs."""
        known = self._idmap(config)
        if known.get(sid):
            return known[sid]
        try:
            home = self._page(NKL_SITE + "/")
        except Exception:
            home = ""
        found = {}
        for m in _NKL_STRIP.finditer(home):
            w = _NKL_WEBCAST.search(m.group(2)[:8000])
            if w:
                found[m.group(1)] = w.group(1)
        if found:
            known.update(found)
            self._save_idmap(config, known)
        if known.get(sid):
            return known[sid]
        if not fixture:
            return None
        from collections import Counter
        offsets = Counter(int(f) - int(s) for s, f in known.items() if str(s).isdigit() and str(f).isdigit())
        if not offsets:
            return None
        offset, votes = offsets.most_common(1)[0]
        if votes < 3:
            return None
        cand = str(int(sid) + offset)
        raw, _ = self._get_meta(FIBA_DATA_URL.format(game_id=cand))
        if not raw or not self._nkl_same_clubs(raw, fixture):
            return None
        known[sid] = cand
        self._save_idmap(config, known)
        return cand

    @staticmethod
    def _nkl_same_clubs(raw: dict, fixture: dict) -> bool:
        """Does a data.json name the fixture's home club as home and away club as away?"""
        tm = raw.get("tm") or {}
        for tno, side in (("1", "home"), ("2", "away")):
            t = tm.get(tno) or {}
            feed = _name_tokens(t.get("name")) | _name_tokens(t.get("nameInternational")) | _name_tokens(t.get("shortName"))
            if not (feed & _name_tokens(fixture.get(f"{side}_name"))):
                return False
        return True

    def _nkl_fetch(self, sid: str, config: dict):
        """The FIBA fetch for an nkl.lt fixture, with the league's own club ids and names put on the
        payload - so a club is the same club from the fixture list to the final box."""
        fixture = next((r for r in self._nkl_matches() if str(r.get("id")) == sid), None)
        fid = self._nkl_fiba_id(sid, fixture, config)
        if not fid:
            return None               # no webcast known for this fixture yet
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=fid))
        if not raw or "tm" not in raw:
            return None
        if fixture:
            for tno, side in (("1", "home"), ("2", "away")):
                if isinstance(raw["tm"].get(tno), dict):
                    raw["tm"][tno]["code"] = str(fixture.get(f"{side}_team_id") or raw["tm"][tno].get("code") or "")
                    raw["tm"][tno]["name"] = fixture.get(f"{side}_name") or raw["tm"][tno].get("name") or ""
        b = self.bundle_from_raw(raw, sid, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------ legabasketfemminile.it ---
    _lbf_last = 0.0

    def _lbf_json(self, path: str):
        gap = time.time() - FibaSiteScheduleAdapter._lbf_last
        if gap < LBF_GAP_S:
            time.sleep(LBF_GAP_S - gap)
        FibaSiteScheduleAdapter._lbf_last = time.time()
        try:
            r = requests.get(LBF_API + path, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=40)
        except requests.RequestException:
            return None
        if r.status_code != 200:
            return None
        try:
            return r.json()
        except ValueError:
            return None

    @staticmethod
    def _lbf_season(config: dict) -> str:
        y = _start_year(config.get("season") or "")
        return f"{y}-{str(y + 1)[2:]}"

    def _lbf_cache(self, config: dict) -> tuple[Optional[str], dict]:
        p = self._map_path(config)
        p = os.path.join(os.path.dirname(p), "games.json") if p else None
        try:
            with open(p, encoding="utf-8") as f:
                return p, json.load(f)
        except (OSError, TypeError, ValueError):
            return p, {}

    @staticmethod
    def _lbf_save(p: Optional[str], games: dict) -> None:
        if not p:
            return
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(games, f, ensure_ascii=False, indent=1, sort_keys=True)
        except OSError:
            pass

    def _lbf(self, config: dict) -> list[ScheduleGame]:
        comp, season = config.get("lbf_competition") or "serie-a1", self._lbf_season(config)
        stage = (config.get("stage") or "regular").lower()
        cal = self._lbf_json(f"/competitions/{comp}/{season}/calendar-index.json")
        ov = self._lbf_json(f"/competitions/{comp}/{season}/overview.json")
        if not cal:
            print(f"     LBF {comp} {season}: no calendar")
            return []
        games = lbf_games(cal, ov or {}, stage)
        shorts: dict = {}
        for g in games:                                  # a league abbreviation is a short name only if it is unique
            for side in ("home", "away"):
                c = g[side]
                if c.get("short_name"):
                    shorts.setdefault(c["short_name"], set()).add(c.get("slug"))
        p, cache = self._lbf_cache(config)
        changed, out = False, []
        for g in games:
            h, a = g["home"], g["away"]
            ent = cache.setdefault(g["id"], {})
            want = {"home": h.get("slug"), "away": a.get("slug"), "home_name": h.get("name"), "away_name": a.get("name")}
            if any(ent.get(k) != v for k, v in want.items()):
                ent.update(want)
                changed = True
            extra = {"home_code": h.get("slug"), "away_code": a.get("slug"),
                     "home_logo": h.get("logo_url"), "away_logo": a.get("logo_url")}
            for side, c in (("home", h), ("away", a)):
                if c.get("short_name") and len(shorts.get(c["short_name"], ())) == 1:
                    extra[f"{side}_short"] = c["short_name"]
            if g["group"]:
                extra["home_group"] = extra["away_group"] = g["group"]
            start = (g["start"] or "").replace(".000Z", "Z") or None
            out.append(ScheduleGame(external_id=g["id"], home_name=h.get("name") or "", away_name=a.get("name") or "",
                                    tipoff_at=start, status={"final": "final", "live": "live"}.get(g["status"], "scheduled"),
                                    extra=extra))
        if changed:
            self._lbf_save(p, cache)
        return out

    def _lbf_fetch(self, mid: str, config: dict):
        """A game by the league's id: its LiveStats id asked for once (again after LBF_RECHECK_S while there is none), and
        the feed under the league's club names and slugs."""
        p, cache = self._lbf_cache(config)
        ent = cache.get(mid)
        if ent is None:
            self._lbf(config)
            p, cache = self._lbf_cache(config)
            ent = cache.get(mid)
        if ent is None:
            return None
        if not ent.get("fls"):
            if time.time() - ent.get("checked", 0) < LBF_RECHECK_S:
                return None
            m = self._lbf_json(f"/matches/{mid}.json") or {}
            ent["checked"] = time.time()
            if m.get("genius_id"):
                ent["fls"] = str(m["genius_id"])
            # NOT its venue: on the two games checked (2026-09-27) it named another club's arena (Sassari at home in
            # "Palaleonessa", Brescia's; Costa Masnaga in "La Molisana Arena", Campobasso's)
            self._lbf_save(p, cache)
            if not ent.get("fls"):
                return None                        # not set up on LiveStats yet
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=ent["fls"]))
        if not raw or "tm" not in raw:
            return None
        for tno, side in (("1", "home"), ("2", "away")):
            if isinstance(raw["tm"].get(tno), dict):
                raw["tm"][tno]["name"] = ent.get(f"{side}_name") or raw["tm"][tno].get("name") or ""
                raw["tm"][tno]["code"] = ent.get(side) or raw["tm"][tno].get("code") or ""
        b = self.bundle_from_raw(raw, mid, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    # ------------------------------------------------------------ online.basket.ee ---
    _bee_last = 0.0                          # one request every BASKETEE_GAP_S, whichever source row asks
    _bee_menu_at: tuple = (0.0, None)        # (read at, basketee_menu())

    def _bee_get(self, url: str, want_json: bool = True):
        """One polite GET on the portal: JSON (or the page), None for anything else. The server drops a connection now
        and then, so a reset is tried again (three times in all); an answer that is not JSON is never retried - on
        this portal that is the error page."""
        for _ in range(3):
            gap = time.time() - FibaSiteScheduleAdapter._bee_last
            if gap < BASKETEE_GAP_S:
                time.sleep(BASKETEE_GAP_S - gap)
            FibaSiteScheduleAdapter._bee_last = time.time()
            try:
                r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
            except requests.RequestException:
                continue
            if r.status_code != 200:
                return None
            if not want_json:
                return r.text
            try:
                return r.json()
            except ValueError:
                return None
        return None

    def _bee_menu(self) -> dict:
        at, menu = FibaSiteScheduleAdapter._bee_menu_at
        if menu is None or time.time() - at > BASKETEE_MENU_TTL_S:
            page = self._bee_get(BASKETEE_HOME, want_json=False)
            got = basketee_menu(page or "")
            if got["dates"]:
                FibaSiteScheduleAdapter._bee_menu_at = (time.time(), got)
                menu = got
        return menu or {"dates": [], "chids": {}}

    @staticmethod
    def _bee_path(config: dict) -> Optional[str]:
        p = FibaSiteScheduleAdapter._map_path(config)
        return os.path.join(os.path.dirname(p), "days.json") if p else None

    def _bee_days(self, config: dict) -> dict:
        p = self._bee_path(config)
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, TypeError, ValueError):
            return {}

    def _bee_save(self, config: dict, days: dict) -> None:
        p = self._bee_path(config)
        if not p:
            return
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(days, f, ensure_ascii=False, indent=1, sort_keys=True)
        except OSError:
            pass

    # THE CRESTS. The portal's day list names no crest, so a club first met on the schedule had none, and the crest
    # in a game's LiveStats data (tm.logoS) never reached it (feedplatform.take_crest now takes it from the payload
    # too). Every crest a payload shows is kept here under the federation's club id, and the schedule hands it on
    # (home_logo / away_logo, run_ingest.sync_logos), so a club has its crest from the fixture list onwards.
    @staticmethod
    def _bee_crest_path(config: dict) -> Optional[str]:
        p = FibaSiteScheduleAdapter._map_path(config)
        return os.path.join(os.path.dirname(p), "crests.json") if p else None

    def _bee_crests(self, config: dict) -> dict:
        try:
            with open(self._bee_crest_path(config), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, TypeError, ValueError):
            return {}

    def _bee_keep_crests(self, config: dict, raw: dict, g: dict) -> None:
        crests = self._bee_crests(config)
        new = {}
        for tno, tid in (("1", g.get("h_tid")), ("2", g.get("v_tid"))):
            url = livestats_crest((raw.get("tm") or {}).get(tno) or {})
            if tid and url and crests.get(str(tid)) != url:
                new[str(tid)] = url
        p = self._bee_crest_path(config)
        if new and p:
            crests.update(new)
            try:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(crests, f, ensure_ascii=False, indent=1, sort_keys=True)
            except OSError:
                pass

    def _bee(self, config: dict) -> list[ScheduleGame]:
        """The league's games on the dates the portal offers, and every game read before (from the day cache)."""
        from datetime import timedelta
        label = config.get("basketee_league") or ""
        want_year, now_year = _start_year(config.get("season") or ""), _start_year("")
        if want_year != now_year:          # a backfill: the portal shows the last two weeks, never another season
            print(f"     {label}: the portal only shows the current season ({now_year}/{now_year + 1}); "
                  f"{want_year}/{want_year + 1} cannot be read from it")
            return []
        menu = self._bee_menu()
        chid = next((cid for name, cid in menu["chids"].items() if name.casefold() == label.casefold()),
                    str(config.get("basketee_chid") or ""))
        days = self._bee_days(config)
        if not chid:
            print(f"     {label}: not on the portal's menu, and no basketee_chid configured")
        else:
            today = _tallinn_today()
            lo, hi = (today - timedelta(days=12)).isoformat(), (today + timedelta(days=6)).isoformat()
            ttl = {-1: 3 * 3600, 0: 1800, 1: 12 * 3600}
            changed = False
            for d in sorted(x for x in menu["dates"] if lo <= x <= hi):     # never a date the menu does not offer
                ent = days.get(d)
                when = (d > today.isoformat()) - (d < today.isoformat())
                if ent and (ent.get("final") or time.time() - ent.get("t", 0) < ttl[when]):
                    continue
                rows = basketee_rows(self._bee_get(BASKETEE_DAY.format(date=d)), chid)
                if rows is None:
                    continue                  # not read this time: the cache keeps what it had
                days[d] = {"t": time.time(), "games": rows, "final": when < 0 and all(g["over"] for g in rows)}
                changed = True
            if changed:
                self._bee_save(config, days)
        best: dict = {}
        for d, ent in days.items():                   # a game moved to another date: its newest reading wins
            for g in ent.get("games") or []:
                if g["gid"] not in best or ent.get("t", 0) >= best[g["gid"]][0]:
                    best[g["gid"]] = (ent.get("t", 0), g)
        out = []
        crests = self._bee_crests(config)
        for _, g in sorted(best.values(), key=lambda x: (x[1]["date"], x[1]["time"], x[1]["gid"])):
            dm = re.match(r"(\d{4})-(\d{2})-(\d{2})", g["date"])
            tm = re.match(r"(\d{1,2}):(\d{2})", g["time"])
            extra = {"venue": g["place"], "home_code": g["h_tid"], "away_code": g["v_tid"]}
            for side, tid in (("home", g["h_tid"]), ("away", g["v_tid"])):
                if crests.get(str(tid)):
                    extra[side + "_logo"] = crests[str(tid)]
            out.append(ScheduleGame(
                external_id=g["gid"], home_name=g["home"], away_name=g["away"],
                tipoff_at=_utc("Europe/Tallinn", *dm.groups(), *tm.groups()) if dm and tm else None,
                status="final" if g["over"] else "scheduled", extra=extra))
        return out

    def _bee_fetch(self, gid: str, config: dict):
        """A game by the league's own id: its LiveStats id and clubs from the day cache (read once more if this machine
        has not seen the game), the feed under the schedule's names and club ids, so a club is one club whichever
        side of the pipeline met it first."""
        def row():
            for ent in self._bee_days(config).values():
                for g in ent.get("games") or []:
                    if g["gid"] == gid:
                        return g
            return None
        g = row()
        if g is None:
            self._bee(config)
            g = row()
        if not g or not g.get("fls"):
            return None                        # not set up on LiveStats yet
        raw, meta = self._get_meta(FIBA_DATA_URL.format(game_id=g["fls"]))
        if not raw or "tm" not in raw:
            return None
        self._bee_keep_crests(config, raw, g)
        for tno, name, code in (("1", g["home"], g["h_tid"]), ("2", g["away"], g["v_tid"])):
            if isinstance(raw["tm"].get(tno), dict):
                raw["tm"][tno]["name"] = name or raw["tm"][tno].get("name") or ""
                raw["tm"][tno]["code"] = code or raw["tm"][tno].get("code") or ""
        b = self.bundle_from_raw(raw, gid, config)
        b.feed_lm_ms, b.feed_recv_ms = meta["lm_ms"], meta["recv_ms"]
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    def _czech(self, config: dict) -> list[ScheduleGame]:
        """A ČBF league: nbl.basketball (or a site built the same way, "czech_base": zbl.basketball) prints one
        <tr> per fixture - id, both clubs and the kick-off - in one request. A league on the federation's own
        site ("czech_competition", on cz.basketball) is read one competition part at a time, the same rows.

        THE FIXTURE IS KEYED ON THE SITE'S OWN ID, not on the LiveStats id. The LiveStats id is
        the one thing the schedule does NOT always carry (it appears once the game is set up, and for a
        fixture far out it does not exist yet), so keying on it meant two thirds of the season
        was invisible — 37 fixtures out of 132 — and a game that gained its id later would have
        arrived as a SECOND row beside the one already written. The site id is on every row from
        the moment a fixture exists and never changes, so it is the id; resolving it to a
        LiveStats id is fetch()'s problem, once, and cached. A row that already links its webcast
        hands the id over here, so that game never needs the hop at all.

        FIRST-PHASE GROUPS ("Skupina VÝCHOD", "Skupina ZÁPAD") name each fixture's group (home_group /
        away_group), which a source with groups_from_feed ranks in separate tables; every later part
        (placement groups, play-out, play-off) is read into the same competition, as NBL's are."""
        year = _start_year(config.get("season") or "")
        base = (config.get("czech_base") or CZECH_BASE).rstrip("/")
        comp = config.get("czech_competition")
        pages = []
        if comp:
            for pid, label in self._czech_parts(base, comp, year):
                try:
                    pages.append((label, self._page(f"{base}/soutez/{pid}")))
                except Exception as exc:
                    print(f"     {comp}: part '{label}' could not be read ({exc})")
        else:
            pages.append((None, self._page(f"{base}/zapasy?y={year}&p1=0&c=0&d_od=&d_do=&k=0")))
        out, seen = [], set()
        known, learnt = self._idmap(config), 0
        for label, html in pages:
            for r in czech_rows(html, base, competition_page=bool(comp)):
                if r["sid"] in seen:
                    continue
                seen.add(r["sid"])
                if r["fiba_id"] and known.get(r["sid"]) != r["fiba_id"]:
                    known[r["sid"]] = r["fiba_id"]
                    learnt += 1
                grp = _CZ_GROUP.match(r["part"] or label or "") if comp else None
                extra = {"home_logo": r["crests"][0] if len(r["crests"]) > 0 else None,
                         "away_logo": r["crests"][1] if len(r["crests"]) > 1 else None}
                if r["venue"]:
                    extra["venue"] = r["venue"]
                if grp:
                    extra["home_group"] = extra["away_group"] = grp.group(1).strip().title()
                out.append(ScheduleGame(
                    external_id=r["sid"], home_name=r["home"], away_name=r["away"],
                    tipoff_at=_utc("Europe/Prague", *r["when"]) if r["when"] else None,
                    # no code: this site names no club code anywhere, and the clubs already written
                    # were keyed on the slug of their name (feedplatform's own fallback), so inventing
                    # one now would strand every fixture already filed against them.
                    extra=extra))
        if learnt:
            self._save_idmap(config, known)
        return out

    def _czech_parts(self, base: str, comp: str, year: int) -> list:
        """[(competition id?p=part id, part name)] of one competition on the federation's site, for one season,
        read off its competitions page (the ids are new every season)."""
        try:
            page = self._page(CZ_COMPETITIONS.format(base=base, year=year))
        except Exception as exc:
            print(f"     {comp}: the competitions page could not be read ({exc})")
            return []
        import html as _html
        want = re.sub(r"\s+", " ", comp).strip().casefold()
        heads = list(_CZ_COMP_H2.finditer(page))
        for k, h in enumerate(heads):
            if re.sub(r"\s+", " ", _html.unescape(h.group(1))).strip().casefold() != want:
                continue
            block = page[h.end():heads[k + 1].start() if k + 1 < len(heads) else None]
            return [(f"{cid}?p={pid}", _html.unescape(label)) for cid, pid, label in _CZ_PART.findall(block)]
        print(f"     no '{comp}' on {CZ_COMPETITIONS.format(base=base, year=year)}")
        return []

    def _czech_match_id(self, sid: str, config: dict) -> Optional[str]:
        """The LiveStats id behind a Czech fixture id, learnt once and remembered.

        A game's LiveStats id never changes, so the map is written to data/feed/<CODE>/idmap.json
        and a fixture costs this hop exactly once in its life (none, if its schedule row linked it)."""
        known = self._idmap(config)
        if known.get(sid):
            return known[sid]
        base = (config.get("czech_base") or CZECH_BASE).rstrip("/")
        try:
            page = self._page(f"{base}/zapas/{sid}")
        except Exception:
            return None
        w = _WEBCAST.search(page) or _WEBCAST_ANY.search(page)
        if not w:
            return None            # no webcast published for this fixture yet
        known[sid] = w.group(1)
        self._save_idmap(config, known)
        return known[sid]

    def _slovakia(self, config: dict) -> list[ScheduleGame]:
        """sbl.slovakbasket.sk: one page per month, each linking every game's webcast directly."""
        season = str(config.get("season") or "")
        year = _start_year(season)
        sid = self._slovak_season_id(config, season, year)
        if not sid:
            return []
        months = [f"{year}-{m:02d}" for m in range(9, 13)] + [f"{year + 1}-{m:02d}" for m in range(1, 7)]
        seen, out = set(), []
        for month in months:
            try:
                html = self._page(SLOVAK_LIST.format(sid=sid, month=month))
            except Exception:
                continue
            # EACH CARD CARRIES THE WHOLE FIXTURE: both clubs (named in the crest's alt text, with
            # the club's own id in the crest URL), the hall, and the kick-off. Taking only the
            # webcast link out of it threw all of that away and left the fixture unwritable.
            for card in _SK_CARD.findall(html):
                m = _WEBCAST.search(card)
                if not m or m.group(1) in seen:
                    continue
                seen.add(m.group(1))
                teams = _SK_TEAM.findall(card)
                when = _SK_WHEN.search(card)
                venue = _SK_VENUE.search(card)
                out.append(ScheduleGame(
                    external_id=str(m.group(1)),
                    home_name=teams[0][2].strip() if len(teams) > 0 else "",
                    away_name=teams[1][2].strip() if len(teams) > 1 else "",
                    tipoff_at=(_utc("Europe/Bratislava", when.group(3), when.group(2), when.group(1),
                                    when.group(4), when.group(5)) if when else None),
                    extra={"venue": venue.group(1).strip() if venue else None,
                           "home_logo": teams[0][0] if len(teams) > 0 else None,
                           "away_logo": teams[1][0] if len(teams) > 1 else None,
                           "home_code": teams[0][1] if len(teams) > 0 else None,
                           "away_code": teams[1][1] if len(teams) > 1 else None}))
        return out

    def _slovak_season_id(self, config: dict, season: str, year: int) -> Optional[str]:
        """The tournament id for OUR season, read off the site's own season menu.

        The scraper keeps a map of ids by year and it is already a season out of date. The page
        lists every season it has as "Sezóna 2026/2027" against its id, so the id is looked up
        rather than remembered; the configured map is only the fallback for a page that will not
        load."""
        fixed = (config.get("season_ids") or {}).get(season)
        try:
            html = self._page(SLOVAK_LIST.format(sid=fixed or "11641", month=f"{year}-09"))
        except Exception:
            return fixed
        want = {f"{year}/{year + 1}", f"{year}/{str(year + 1)[2:]}", f"{year}-{str(year + 1)[2:]}"}
        for value, label in _SEASON_OPT.findall(html):
            text = label.replace(" ", " ").strip()
            if any(w in text for w in want):
                return value
        return fixed
