"""Where each league's bio comes from. One reader per league, keyed by the league's slug; a reader yields records for bio.sync():

    {name | first+last, team, key?, number?, height_cm?, weight_kg?, birth?, birth_year?, detail?: () -> {height_cm, weight_kg, birth}, label}

Every reader is polite (one request at a time, half a second apart) and bounded: a league is a few hundred players, never a crawl.
A reader is called as reader(today=, log=, players=, teams=) - the players and clubs already on the site for that league - and takes
what it needs (**_ for the rest).

What each source gives, found by looking, not assumed (2026-09-27):

  euroleague / eurocup   one feed for the season's whole people list: height, weight, date of birth (~97% with all three)
  basketligaen (men)     the site's own API: a roster per club, then one athlete page per NEW player (height, weight, date)
  lega-basket-serie-a    the league's API: one roster per club (date, height, weight, shirt)
  lnb-elite / -2         the league's API: one roster per club (date, height; no weight anywhere). Refuses a GitHub runner
  nbl / wnbl / nbl1-*    the NBL service's players-in-season list (date, height, weight; NBL1 often has no height)
  aba-league(-2, -u19)   each club's page on the league's site: a roster table (date, height; no weight)
  bbl                    the league site's players page: date, height, weight for every player, in one request
  proa / prob            each club's Kader page on the 2. Bundesliga site: date, height, weight
  czech-nbl              each club's page: date (a bare year for some minors), height
  liga-endesa            each player's page on acb.com (date, height; no weight): a request per player still missing something
  the six FEB leagues    each club's page on the federation site: date, height, weight where given
  b-league-*, w-league-* the leagues' own player pages, opened only for players already known by the league's player id
  bnxt-league            date of birth only (no height, no weight anywhere in the feed), read out of recent box scores, capped

A league that is not here has no reader yet; docs/player-bio.md lists what each remaining one publishes.
"""
from __future__ import annotations

import html as _html
import json
import re
import time
from datetime import date
from typing import Callable, Iterator

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
GAP_S = 0.5
_last = [0.0]


def _wait() -> None:
    gap = GAP_S - (time.time() - _last[0])
    if gap > 0:
        time.sleep(gap)
    _last[0] = time.time()


def get_json(url: str, params: dict | None = None, headers: dict | None = None):
    """One polite GET: at most one request per GAP_S, JSON or None (404 / 400 / not JSON)."""
    _wait()
    r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})}, timeout=40)
    if r.status_code in (400, 404):
        return None
    r.raise_for_status()
    try:
        return r.json()
    except ValueError:
        return None


def get_text(url: str, headers: dict | None = None) -> str | None:
    """One polite GET of a page: its HTML, or None (403 / 404 / 410)."""
    _wait()
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en", **(headers or {})}, timeout=40)
    if r.status_code in (403, 404, 410):
        return None
    r.raise_for_status()
    return r.text


_TAG = re.compile(r"<[^>]+>")


def _txt(h: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(_TAG.sub(" ", h or ""))).strip()


def _rows(h: str) -> list:
    return re.findall(r"<tr\b[^>]*>(.*?)</tr>", h or "", re.S | re.I)


def _cells(row: str) -> list:
    return re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", row or "", re.S | re.I)


def _title(slug: str) -> str:
    return " ".join(w.capitalize() for w in re.sub(r"-+", " ", slug or "").split())


def _season_start(today: date | None = None) -> int:
    t = today or date.today()
    return t.year if t.month >= 8 else t.year - 1


# ------------------------------------------------------- EuroLeague / EuroCup ---
EL_FEED = "https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/{c}/seasons/{c}{y}/people"


def _el_name(s: str) -> tuple:
    """'DE COLO, NANDO' -> ('Nando', 'De Colo')."""
    last, _, first = (s or "").partition(",")
    return first.strip().title(), last.strip().title()


def euroleague(letter: str) -> Callable[..., Iterator[dict]]:
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        y = _season_start(today)
        for year in (y, y - 1):                              # this season's list first; last season's catches players not registered yet
            got, offset, total = 0, 0, None
            while total is None or offset < total:
                page = get_json(EL_FEED.format(c=letter, y=year), {"limit": 1000, "offset": offset})
                if not page or not page.get("data"):
                    break
                total = page.get("total") or 0
                offset += len(page["data"])
                for it in page["data"]:
                    if it.get("type") != "J":                # J = player; A, C, Z... are coaches, staff, crews
                        continue
                    pr = it.get("person") or {}
                    first, last = _el_name(pr.get("name") or "")
                    got += 1
                    yield {"first": first, "last": last, "team": (it.get("club") or {}).get("name"), "key": "P" + str(pr.get("code") or ""),
                           "height_cm": pr.get("height"), "weight_kg": pr.get("weight"), "birth": pr.get("birthDate"),
                           "label": f"{first} {last}"}
            log(f"     {letter}{year}: {got} players in the feed")
    return read


# ------------------------------------------------------------------ Basketligaen ---
def basketligaen(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    from adapters.fiba_site_schedule import DBL_API
    filt = get_json(DBL_API + "/season-series-game-types-filter") or {}
    want = str(_season_start(today))
    season = next((x["uuid"] for x in filt.get("season") or [] if str(x.get("code")) == want), None)
    series = next((x["uuid"] for x in filt.get("series") or [] if x.get("code") == "DBL"), None)
    gtype = next((x["uuid"] for x in filt.get("gameType") or [] if x.get("code") == "regular"), None)
    if not (season and series and gtype):
        log(f"     Basketligaen: no {want} season on the site yet")
        return
    sched = get_json(f"{DBL_API}/game-schedule", {"seasonUuid": season, "seriesUuid": series, "gameTypeUuid": gtype,
                                                   "completeSeason": "all", "homeAway": "all", "allGames": "all"}) or {}
    teams = sched.get("teamList") or []
    log(f"     Basketligaen {want}: {len(teams)} clubs")
    for t in teams:
        names = t.get("teamNames") or {}
        club = names.get("long") or names.get("short")
        for grp in get_json(f"{DBL_API}/athletes/by-team-uuid/{t['uuid']}") or []:
            for pl in grp.get("players") or []:
                uid = pl.get("uuid")
                if not uid:
                    continue

                def detail(uid=uid):
                    d = (get_json(f"{DBL_API}/athlete-details/{uid}") or {}).get("athleteData") or {}
                    return {"height_cm": d.get("height"), "weight_kg": d.get("weight"), "birth": d.get("dateOfBirth") or d.get("birthDate")}
                yield {"first": pl.get("firstName"), "last": pl.get("lastName"), "team": club, "number": pl.get("jerseyNumber"),
                       "label": pl.get("fullName") or f"{pl.get('firstName')} {pl.get('lastName')}", "detail": detail}


# ------------------------------------------------------------------------- BNXT ---
def bnxt(today: date | None = None, log: Callable = print, max_games: int = 40, **_) -> Iterator[dict]:
    """Date of birth only. The box score of a game carries it for each player who played; the newest games are read first, until
    max_games have been, so every club's rotation is seen and the league is not crawled."""
    from adapters.bnxt import BnxtAdapter, club_name
    a = BnxtAdapter.__new__(BnxtAdapter)
    a.min_request_gap_s = GAP_S
    read = 0
    for year in (_season_start(today), _season_start(today) - 1):
        games = [g for g in a.discover("https://bnxtleague.com/en/calendar", {"season": f"{year}-{str(year + 1)[2:]}", "stage": "regular"})
                 if g.status == "final"]
        games.sort(key=lambda g: g.tipoff_at or "", reverse=True)
        for g in games:
            if read >= max_games:
                return
            comp = BnxtAdapter._games.get(str(g.external_id))
            box = a._get(f"/boxscore/game/{comp}/{g.external_id}") or []
            read += 1
            for side in box:
                club = club_name(((side.get("team") or {}).get("name")) or "")
                for p in side.get("players") or []:
                    pl = p.get("player") or {}
                    if not pl.get("birthdate"):
                        continue
                    yield {"first": pl.get("first_name"), "last": pl.get("last_name"), "team": club, "number": p.get("jersey"),
                           "birth": pl.get("birthdate"), "label": f"{pl.get('first_name')} {pl.get('last_name')}"}
    log(f"     BNXT: {read} box scores read")


# ---------------------------------------------------------------------- Lega Basket ---
LBA_API = "https://www.legabasket.it/api"


def lba(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    y = _season_start(today)
    for year in (y, y - 1):
        teams = (get_json(f"{LBA_API}/teams/get-teams", {"year": year, "items": 50}) or {}).get("teams") or []
        log(f"     LBA {year}: {len(teams)} clubs")
        for t in teams:
            for p in (get_json(f"{LBA_API}/teams/get-team-roster", {"id": t["id"]}) or {}).get("players") or []:
                yield {"first": p.get("name"), "last": p.get("surname"), "team": p.get("team_name") or t.get("name"),
                       "number": p.get("player_number"), "height_cm": p.get("height"), "weight_kg": p.get("weight"),
                       "birth": p.get("birth_date"), "label": f"{p.get('name')} {p.get('surname')}"}


# ------------------------------------------------------------------------------ LNB ---
def lnb(division: int) -> Callable[..., Iterator[dict]]:
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        from adapters import lnb as L                       # the site's own headers; the API refuses a bare client
        seen: set = set()
        y = _season_start(today)
        for year in (y, y - 1):
            comps = (get_json(L.LNB_API + "/competition/getDivisionCompetitionByYear",
                              {"year": year, "division_external_id": division}, L.HEADERS) or {}).get("data") or []
            n = 0
            for c in comps:
                if c.get("external_id") is None or "star game" in (c.get("competition_name") or "").lower():
                    continue
                teams = (get_json(L.LNB_API + "/competition/getCompetitionTeams", {"competition_external_id": c["external_id"]}, L.HEADERS) or {}).get("data") or []
                for t in teams:
                    if t["external_id"] in seen:
                        continue
                    seen.add(t["external_id"])
                    n += 1
                    for r in (get_json(L.LNB_API + "/teams/getRoster", {"team_external_id": t["external_id"]}, L.HEADERS) or {}).get("data") or []:
                        pr = r.get("person") or {}
                        yield {"first": pr.get("first_name"), "last": pr.get("family_name"), "team": t.get("team_name"),
                               "height_cm": pr.get("height"), "weight_kg": pr.get("weight"), "birth": pr.get("dob"),
                               "label": f"{pr.get('first_name')} {pr.get('family_name')}"}
            log(f"     LNB division {division}, {year}: {n} clubs")
    return read


# ----------------------------------------------------------- NBL / WNBL / NBL1 ---
def nbl_family(org: str, gender: str | None = None) -> Callable[..., Iterator[dict]]:
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        from adapters import nbl as N
        y = (today or date.today()).year
        years = (y, y - 1) if org == "nbl1" else (_season_start(today), _season_start(today) - 1)
        for year in years:
            got, offset, n = 0, 0, 500
            while True:
                page = get_json(f"{N.API}/get/{org}/players/in/season/{year}", {"limit": n, "offset": offset}, N.HEADERS) or {}
                rows = page.get("data") or []
                for r in rows:
                    pl = r.get("player") or {}
                    if gender and (pl.get("gender") or "").upper() != gender:
                        continue
                    got += 1
                    yield {"first": pl.get("first_name"), "last": pl.get("last_name"), "team": (r.get("team") or {}).get("name"),
                           "number": r.get("jersey_number"), "height_cm": pl.get("height"), "weight_kg": pl.get("weight"),
                           "birth": pl.get("date_of_birth"), "label": f"{pl.get('first_name')} {pl.get('last_name')}"}
                if len(rows) < n:
                    break
                offset += n
            log(f"     {org.upper()} {year}: {got} players")
    return read


# ------------------------------------------------------------------------- ABA ---
ABA_HOSTS = {1: "https://www.aba-liga.com", 2: "https://druga.aba-liga.com", 7: "https://www.aba-liga.com"}
ABA_CAL = {1: "calendar", 2: "calendar", 7: "calendar-u19"}
ABA_CLUB = re.compile(r"""<a[^>]+href=["'](https?://[a-z.]*aba-liga\.com/team/(\d+)/(\d+)/(\d+)/\d+/[^/"']*/)["'][^>]*>(.*?)</a>""", re.S)


def aba(league: int) -> Callable[..., Iterator[dict]]:
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        host = ABA_HOSTS[league]
        yy = _season_start(today) % 100
        for season in (yy, yy - 1):
            cal = get_text(f"{host}/{ABA_CAL[league]}/{season}/{league}/") or ""
            clubs: dict = {}
            for m in ABA_CLUB.finditer(cal):
                if int(m.group(4)) == league and int(m.group(3)) == season:
                    clubs.setdefault(m.group(2), (m.group(1), _txt(m.group(5))))
            log(f"     ABA league {league}, 20{season}: {len(clubs)} clubs")
            for _tid, (url, name) in clubs.items():
                page = get_text(url) or ""
                club = name or _title(url.rstrip("/").rsplit("/", 1)[-1])
                for row in _rows(page):
                    pm = re.search(r"/player/(\d+)/", row)
                    if not pm:
                        continue
                    cells = [_txt(c) for c in _cells(row)]
                    who = next((c for c in cells if c and not c.isdigit() and not re.search(r"\d{2}\.\d{2}\.\d{4}", c)), "")
                    height = next((c for c in cells if re.fullmatch(r"\d{3}", c)), None)
                    born = next((c for c in cells if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", c)), None)
                    yield {"name": who, "team": club, "key": pm.group(1), "height_cm": height, "birth": born, "label": who}
    return read


# ------------------------------------------------------------------------- BBL ---
def bbl(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    """Each club's page on the league site carries its squad in its page data: date, height (metres), weight."""
    teams = get_text("https://easycredit-bbl.de/saison/teams") or ""
    ids = dict.fromkeys(re.findall(r'href="/teams/(\d+/\d{4})"', teams))
    log(f"     BBL: {len(ids)} clubs")
    seen: set = set()

    def walk(x, out):
        if isinstance(x, dict):
            if "playerId" in x and "birthDate" in x:
                out.append(x)
            else:
                for v in x.values():
                    walk(v, out)
        elif isinstance(x, list):
            for v in x:
                walk(v, out)
    for path in ids:
        page = get_text(f"https://easycredit-bbl.de/teams/{path}") or ""
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
        if not m:
            continue
        got: list = []
        walk(json.loads(m.group(1)), got)
        for p in got:
            if p.get("playerId") in seen:
                continue
            seen.add(p.get("playerId"))
            yield {"first": p.get("firstName"), "last": p.get("lastName"), "key": str(p.get("playerId") or ""),
                   "height_cm": p.get("height"), "weight_kg": p.get("weight"), "birth": p.get("birthDate"),
                   "label": f"{p.get('firstName')} {p.get('lastName')}"}


# --------------------------------------------------------------------- ProA / ProB ---
_bbl2: dict = {}


def _bbl2_rows(log: Callable) -> list:
    """Every club of the 2. Bundesliga, ProA (/teams) and ProB (/ProB), one site; read once, whichever league asks first."""
    if "rows" in _bbl2:
        return _bbl2["rows"]
    out: list = []
    site = "https://www.2basketballbundesliga.de"
    clubs: dict = {}
    for blk in (get_text(site + "/teams") or "").split("team-img-container")[1:]:      # ProA: a block per club
        name, kid = re.search(r'alt="([^"]+)"', blk), re.search(r"/kader/(\d+)", blk)
        if name and kid:
            clubs.setdefault(kid.group(1), _html.unescape(name.group(1)))
    for kid, name in re.findall(r"/teams/kader/(\d+)'[^>]*data-avia-tooltip='([^']+)'", get_text(site + "/ProB") or ""):   # ProB: a logo per club
        clubs.setdefault(kid, _html.unescape(name))
    blocks = list(clubs)
    for kid, club in clubs.items():
        page = get_text(f"{site}/kader/{kid}") or ""
        for row in _rows(page):
            sp = re.search(r"/teams/kader/spieler/(\d+)", row)
            bd = re.search(r"data-birthdate='(\d{8})'", row)
            cells = [_txt(c) for c in _cells(row)]
            if not (sp and bd and len(cells) >= 8):
                continue
            joined = " ".join(cells)
            hm = re.search(r"\b(\d),(\d{2})\s*m\b", joined)
            wt = re.search(r"\b(\d{2,3})\s*kg\b", joined)
            out.append({"first": cells[1], "last": cells[2], "team": club, "key": sp.group(1), "birth": bd.group(1),
                        "height_cm": int(hm.group(1)) * 100 + int(hm.group(2)) if hm else None,
                        "weight_kg": wt.group(1) if wt else None, "label": f"{cells[1]} {cells[2]}"})
    log(f"     2. Bundesliga: {len(out)} players on {len(blocks)} clubs")
    _bbl2["rows"] = out
    return out


def twobbl(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    yield from _bbl2_rows(log)


# ------------------------------------------------------------------- Czech NBL ---
def czech_nbl(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    site = "https://nbl.basketball"
    slugs = sorted(set(re.findall(r'href="\s*(/tym/[^"\s]+)', get_text(site + "/") or "")))
    log(f"     Czech NBL: {len(slugs)} clubs")
    for sl in slugs:
        page = get_text(site + sl) or ""
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
        club = _txt(h1.group(1)) if h1 else _title(sl.rsplit("/", 1)[-1])
        for row in _rows(page):
            cells = [_txt(c) for c in _cells(row)]
            if len(cells) < 6 or not re.fullmatch(r"\d{1,2}", cells[0]) or not re.search(r"\d+ cm", " ".join(cells)):
                continue
            born = next((c for c in cells[2:] if re.fullmatch(r"\d{1,2}\.\s*\d{1,2}\.\s*\d{4}", c)), None)
            year = next((c for c in cells[2:] if re.fullmatch(r"(19|20)\d{2}", c)), None)
            height = next((re.match(r"(\d+)", c).group(1) for c in cells if re.fullmatch(r"\d{3} cm", c)), None)
            yield {"name": cells[1], "team": club, "height_cm": height, "birth": born,
                   "birth_year": int(year) if year and not born else None, "label": cells[1]}


# --------------------------------------------------------------- Liga Endesa (ACB) ---
ACB = "https://acb.com"


def acb(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    """Squads from each club's plantilla page; date and height from the player's own page (in its page data), opened only for a
    player still missing something."""
    teams = sorted(set(re.findall(r'href="(/es/liga/equipos/[a-z0-9\-]+-\d+)"', get_text(ACB + "/es/liga/equipos") or "")))
    log(f"     ACB: {len(teams)} clubs")
    for t in teams:
        club = _title(re.sub(r"-\d+$", "", t.rsplit("/", 1)[-1]))
        for slug in dict.fromkeys(re.findall(r"/es/liga/jugadores/([a-z0-9\-]+-\d{6,9})", get_text(ACB + t + "/plantilla") or "")):
            def detail(slug=slug):
                h = get_text(f"{ACB}/es/liga/jugadores/{slug}") or ""
                b = re.search(r'birthDate\\+":\\+"(\d{2}-\d{2}-\d{4})', h)
                ht = re.search(r'height\\+":\\+"(\d,\d{2})', h)
                return {"birth": b.group(1) if b else None, "height_cm": ht.group(1) if ht else None}
            yield {"name": _title(re.sub(r"-\d+$", "", slug)), "team": club, "detail": detail, "label": slug}


# ---------------------------------------------------------- the federation's FEB ---
FEB = "https://baloncestoenvivo.feb.es"


def feb(today: date | None = None, log: Callable = print, teams: list | None = None, **_) -> Iterator[dict]:
    """A club's page on the federation's site is a table: name, position, shirt, date of birth and birthplace, height, weight. The club's
    page number is the feed's own club id, which the ingest stored on the team; the player's number is the feed's player key."""
    codes = [t for t in (teams or []) if re.fullmatch(r"\d{5,8}", t.get("code") or "")]
    log(f"     FEB: {len(codes)} clubs")
    for t in codes:
        page = get_text(f"{FEB}/equipo/{t['code']}") or ""
        for row in re.findall(r'<tr[^>]*>(?:(?!</tr>).)*?class="nombre jugador".*?</tr>', page, re.S | re.I):
            m = re.search(r"""[?&](?:amp;)?c=(\d+)[^'"]*['"]>([^<]+)</a>""", row)
            if not m:
                continue

            def cell(cls, row=row):
                c = re.search(r'class="' + cls + r'"[^>]*>(.*?)</td>', row, re.S | re.I)
                return _txt(c.group(1)) if c else ""
            yield {"name": _txt(m.group(2)), "team": t["name"], "key": m.group(1), "birth": cell("fecha nacimiento").split(" ")[0],
                   "height_cm": cell("altura"), "weight_kg": cell("peso"), "label": _txt(m.group(2))}


# ------------------------------------------- readers that open a page per known player ---
def by_player_page(fetch: Callable[[str], dict]) -> Callable[..., Iterator[dict]]:
    """For a league whose players are keyed by the league's own player id, the id IS the address of his page: no roster to read, no name to
    match. One record per player already on the site; his page is opened only if something is missing (bio.sync calls `detail`)."""
    def read(today: date | None = None, log: Callable = print, players: list | None = None, **_) -> Iterator[dict]:
        for p in players or []:
            for k in sorted(p["keys"]):
                pid = k.rsplit(":", 1)[-1]
                if pid.isdigit():
                    yield {"key": pid, "label": f"{p['first_name']} {p['last_name']}", "detail": (lambda pid=pid: fetch(pid))}
                    break
    return read


def _bleague_page(pid: str) -> dict:
    t = _txt(get_text(f"https://www.bleague.jp/roster_detail/?PlayerID={pid}") or "")
    b = re.search(r"生年月日\s*(\d{4}年\d{1,2}月\d{1,2}日)", t)
    hw = re.search(r"身長／体重\s*(\d+)\s*cm／\s*(\d+)\s*kg", t)
    return {"birth": b.group(1) if b else None, "height_cm": hw.group(1) if hw else None, "weight_kg": hw.group(2) if hw else None}


def _wjbl_page(pid: str) -> dict:
    from adapters import wjbl as W
    d = get_json(W.API + "/player", {"player_id": pid}, W.HEADERS) or {}
    return {"birth": d.get("player_birthday"), "height_cm": d.get("player_height"), "weight_kg": d.get("player_weight")}


# Keyed by the league's slug (config/ingest-sources.json league_slug).
READERS: dict = {
    "euroleague": euroleague("E"),
    "eurocup": euroleague("U"),
    "basketligaen": basketligaen,
    "bnxt-league": bnxt,
    "lega-basket-serie-a": lba,
    "lnb-elite": lnb(1),
    "lnb-elite-2": lnb(2),
    "nbl": nbl_family("nbl"),
    "wnbl": nbl_family("wnbl"),
    "nbl1-men": nbl_family("nbl1", "MALE"),
    "nbl1-women": nbl_family("nbl1", "FEMALE"),
    "aba-league": aba(1),
    "aba-league-2": aba(2),
    "aba-u19-league": aba(7),
    "bbl": bbl,
    "proa": twobbl,
    "prob": twobbl,
    "czech-nbl": czech_nbl,
    "liga-endesa": acb,
    "primera-feb": feb,
    "segunda-feb": feb,
    "liga-femenina-endesa": feb,
    "liga-femenina-2": feb,
    "liga-femenina-challenge": feb,
    "liga-u": feb,
    "b-league-premier": by_player_page(_bleague_page),
    "b-league-one": by_player_page(_bleague_page),
    "w-league-premier": by_player_page(_wjbl_page),
    "w-league-future": by_player_page(_wjbl_page),
}

# Leagues whose reader goes club by club through the feed's own club ids (bio_sync loads the clubs for them).
NEEDS_TEAMS = {"primera-feb", "segunda-feb", "liga-femenina-endesa", "liga-femenina-2", "liga-femenina-challenge", "liga-u"}
# Leagues whose site refuses a GitHub runner: the weekly workflow leaves them out, run them by hand from a home connection.
HOME_ONLY = {"lnb-elite", "lnb-elite-2"}
