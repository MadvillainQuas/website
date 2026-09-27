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
  korisliiga, naisten-korisliiga, i-divisioona-a / -b
                         TorneoPal's getTeams + getTeam (a roster per club): birth YEAR as printed, height (weight is 0 throughout)
  slovak-sbl             each club's Súpiska (Roster) tab: date of birth; height and weight from the player's page, opened per new player
  nbl-bulgaria           the league site's player list filtered by club (Cyrillic, transliterated as the game feed is); date, height,
                         weight from the player's page, opened per new player
  greek-elite-league     stats.basket.gr's player page, opened only for players already known by the feed's own player GUID and
                         still without a date: date of birth only (no height or weight anywhere on the site)
  lnb-espoirs-elite / -2 the same LNB API as lnb-elite, divisions 3 and 4 (date; height for ~40%; no weight). Refuses a GitHub runner
  u-sports               each club's own roster page (PrestoSports table or Sidearm list): height, weight where the club prints it; no date
  lnbp                   the Sportradar EUI embed's players page (website 14): height, weight for ~96%, date for about a third; keyed
  lkl                    each player's page on lkl.lt, by the slug the game feed keys him by (date, height, weight)
  nkl                    each club's page on nkl.lt (height, weight); the date from the player's page, only when missing
  orlen-basket-liga, 1-liga-mezczyzn, 1-liga-kobiet
                         the federation's club pages on rozgrywki.pzkosz.pl, this season and last (date, height; no weight anywhere);
                         PLK rows keyed by the federation person id = the PLK feed's player id
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


# ------------------------------------------------------------ Finland (TorneoPal) ---
def torneopal(category: int) -> Callable[..., Iterator[dict]]:
    """basket.fi's result service: getTeams lists a league's clubs, getTeam a club's registered players with the birth YEAR the service
    prints (it has no date), a height (0 when not given) and a weight (0 throughout, 2026-27). The game feed is Sportradar's EUI, whose
    person ids are not TorneoPal's, so players are matched by name and club (TorneoPal and the EUI name the clubs identically)."""
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        from adapters.basketfi import TORNEOPAL, TP_HEADERS
        y = _season_start(today)
        for year in (y, y - 1):                          # this season's rosters first; last season's catches a club not registered yet
            comp = f"huki{year % 100:02d}{(year + 1) % 100:02d}"
            teams = (get_json(f"{TORNEOPAL}/getTeams", {"competition_id": comp, "category_id": category}, TP_HEADERS) or {}).get("teams") or []
            got = 0
            for t in teams:
                team = (get_json(f"{TORNEOPAL}/getTeam", {"team_id": t["team_id"], "competition_id": comp, "category_id": category},
                                 TP_HEADERS) or {}).get("team") or {}
                for p in team.get("players") or []:
                    if str(p.get("inactive") or "0") != "0":
                        continue
                    by = str(p.get("birthyear") or "")
                    got += 1
                    yield {"first": p.get("first_name"), "last": p.get("last_name"), "team": team.get("team_name") or t.get("team_name"),
                           "number": p.get("shirt_number"), "height_cm": p.get("height"), "weight_kg": p.get("weight"),
                           "birth_year": int(by) if re.fullmatch(r"(19|20)\d{2}", by) else None,
                           "label": f"{p.get('first_name')} {p.get('last_name')}"}
            log(f"     TorneoPal {comp}/{category}: {got} players on {len(teams)} clubs")
    return read


# ------------------------------------------------------------------- Slovak SBL ---
SBL = "https://sbl.slovakbasket.sk"
_SBL_SEED = "11641"                                       # any season's tournament id: its page carries the whole season menu


def sbl(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    """The player page gives an AGE (not used: a year from an age is a year out half the time), height and weight; the club's Súpiska
    (Roster) tab gives every player's date of birth. So: the roster tab per club, and the player's page only for a player still
    missing height or weight."""
    menu = get_text(f"{SBL}/sk/stats/match-list/{_SBL_SEED}/tipos-slovenska-basketbalova-liga") or ""
    seasons = {_html.unescape(lbl): sid for sid, lbl in re.findall(r'<option[^>]*value="(\d+)"[^>]*>\s*([^<]*?)\s*</option>', menu)}
    y = _season_start(today)
    for year in (y, y - 1):
        sid = next((v for k, v in seasons.items() if f"{year}/{year + 1}" in k), None)
        if not sid:
            continue
        page = get_text(f"{SBL}/sk/stats/teams/{sid}/tipos-slovenska-basketbalova-liga") or ""
        clubs = list(dict.fromkeys(re.findall(r'href="(/sk/stats/teams/' + sid + r'/[^"/]+/team/\d+/[^"/?#]+)"', page)))
        got = 0
        for path in clubs:
            roster = get_text(f"{SBL}{path}/Roster") or ""
            tm = re.search(r"<title>\s*([^<|]+?)\s*\|", roster)
            club = _txt(tm.group(1)) if tm else _title(path.rsplit("/", 1)[-1])
            for card in roster.split('class="p-name"')[1:]:
                m = re.search(r'<a href="(/sk/stats/players/\d+/[^"]*/player/(\d+)/[^"]*)">(.*?)<span class="p-lastname">(.*?)</span>', card, re.S)
                if not m:
                    continue
                born = re.search(r'Narodený</td>\s*<td[^>]*>\s*([\d.\s]+?)\s*</td>', card)
                first, last = _txt(m.group(3)), _txt(m.group(4)).title()

                def detail(url=m.group(1)):
                    t = _txt(get_text(SBL + url) or "")
                    h, w = re.search(r"Výška\s*(\d{3})\s*cm", t), re.search(r"Váha\s*(\d{2,3})\s*kg", t)
                    return {"height_cm": h.group(1) if h else None, "weight_kg": w.group(1) if w else None}
                got += 1
                yield {"first": first, "last": last, "team": club, "birth": born.group(1) if born else None, "detail": detail,
                       "label": f"{first} {last}"}
        log(f"     SBL {year}/{year + 1}: {got} players on {len(clubs)} clubs")


# ----------------------------------------------------------------- NBL Bulgaria ---
BGNBL = "https://nbl.basketball.bg"


def bgnbl(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    """The league site's player search, one club at a time (the list names no club otherwise); the player's own page gives date,
    height and weight. All in Cyrillic: names and clubs are transliterated by the same standard as the game feed (names.bulgarian_latin)."""
    import names as _names
    tr = _names.bulgarian_latin
    menu = get_text(f"{BGNBL}/players") or ""
    seasons = {lbl.strip(): sid for sid, lbl in re.findall(r'<option value="(\d+)"[^>]*>\s*([^<]+)', menu)}
    y = _season_start(today)
    for year in (y, y - 1):
        sid = seasons.get(f"{year}/{year + 1}")
        if not sid:
            continue
        q = f"{BGNBL}/players.inc.php?bg_id=1&act=&season={sid}&age_id=&gender=&region_id=&position_id=&player_id=&team_id="
        clubs = dict(re.findall(r"dropdown_slct\(this, '(\d+)', '([^']+)'\)", (get_text(q) or "").split('id="position_id"')[0]))
        got = 0
        for tid, club in clubs.items():
            for href, name in re.findall(r'<a href="(player-\d+-[^"]*)" class="itm">.*?<div class="name">(.*?)</div>', get_text(q + tid) or "", re.S):
                first, _, last = (_html.unescape(x).strip() for x in re.sub(r"\s+", " ", name).partition("<br>"))

                def detail(href=href):
                    t = _txt(get_text(f"{BGNBL}/{href}") or "")
                    b = re.search(r"Рождена дата\s*(\d{4}-\d{2}-\d{2})", t)
                    h, w = re.search(r"Ръст\s*(\d{3})\s*см", t), re.search(r"Тегло\s*(\d{2,3})\s*кг", t)
                    return {"birth": b.group(1) if b else None, "height_cm": h.group(1) if h else None, "weight_kg": w.group(1) if w else None}
                got += 1
                yield {"first": tr(first), "last": tr(last), "team": tr(_html.unescape(club)), "detail": detail, "label": tr(f"{first} {last}")}
        log(f"     NBL Bulgaria {year}/{year + 1}: {got} players on {len(clubs)} clubs")


# ------------------------------------------------------------ Greek Elite League ---
GREL_PLAYER = "https://stats.basket.gr/{y}-{y1}/elite-league/playerdetails/id/{gid}"
_GUID = re.compile(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}")


def grel(today: date | None = None, log: Callable = print, players: list | None = None, **_) -> Iterator[dict]:
    """The feed keys a player by stats.basket.gr's own GUID, which is the address of his page; the page gives a date of birth and
    nothing else (no height, no weight). A page is ~0.4 MB gzipped, and because height and weight never fill, bio.sync would reopen
    every page every week: so a page is offered only for a player still without a date (a minor's year already on file is the most
    that will ever be written for him)."""
    y = _season_start(today)
    on = (today or date.today()).year
    n = 0
    for p in players or []:
        row = p.get("row") or {}
        if row.get("birth_date"):
            continue
        yr = row.get("birth_year")
        if yr and ("birth_date" not in row or yr + 18 > on):     # no date column yet, or a minor: the year is all there is
            continue
        gid = next((k.rsplit(":", 1)[-1] for k in sorted(p["keys"]) if _GUID.fullmatch(k.rsplit(":", 1)[-1])), None)
        if not gid:
            continue

        def detail(gid=gid):
            h = get_text(GREL_PLAYER.format(y=y, y1=y + 1, gid=gid), {"Accept": "text/html"}) or ""
            b = re.search(r"Ημερ\.Γεν\.:\s*</div>\s*<div[^>]*>\s*<b>\s*(\d{1,2}/\d{1,2}/\d{4})", h)
            return {"birth": b.group(1) if b else None}
        n += 1
        yield {"key": gid, "label": f"{p['first_name']} {p['last_name']}", "detail": detail}
    log(f"     Greek Elite League: {n} players without a date, a page each")


# ------------------------------------------------------------------------ U SPORTS ---
# en.usports.ca's player pages carry no bio at all (name, shirt, stats); the conference sites (oua.ca, canadawest.org, AUS) are the same
# PrestoSports stats pages. Height and weight are only on each university's own roster page: a PrestoSports table (height, most without
# weight) or a Sidearm list (height, weight on some). No club prints a date of birth; the class year is never read as an age.
# The game feed keys a player by his shirt ("j5"), so rows are matched by name and club. The club is named as the box score names it.
USPORTS_PRESTO = "/sports/mbkb/{this}/roster", "/sports/mbkb/{last}/roster"
USPORTS_SIDEARM = "/sports/mens-basketball/roster", "/sports/mens-basketball/roster/{last}"
USPORTS_CLUBS = {
    "Acadia": ("https://acadiaathletics.ca", USPORTS_PRESTO),
    "Alberta": ("https://bearsandpandas.ca", USPORTS_SIDEARM),
    "Algoma": ("https://algomathunderbirds.ca", USPORTS_SIDEARM),
    "Bishop's": ("https://gaiters.ca", USPORTS_SIDEARM),
    "Brandon": ("https://gobobcats.ca", USPORTS_SIDEARM),
    "Brock": ("https://gobadgers.ca", USPORTS_SIDEARM),
    "Calgary": ("https://godinos.com", USPORTS_SIDEARM),
    "Carleton": ("https://goravens.ca", USPORTS_PRESTO),
    "Concordia": ("https://stingers.ca", ("/mbasketball/roster.php",)),
    "Guelph": ("https://gryphons.ca", ("/sports/mbball/roster", "/sports/mbball/roster/{last}")),
    "Laurentian": ("https://luvoyageurs.com", USPORTS_PRESTO),
    "Laurier": ("https://laurierathletics.com", USPORTS_SIDEARM),
    "Lethbridge": ("https://gohorns.ca", USPORTS_SIDEARM),
    "MacEwan": ("https://macewangriffins.ca", USPORTS_PRESTO),
    "Manitoba": ("https://gobisons.ca", USPORTS_SIDEARM),
    "McGill": ("https://mcgillathletics.ca", USPORTS_SIDEARM),
    "McMaster": ("https://marauders.ca", USPORTS_SIDEARM),
    "Memorial": ("https://goseahawks.ca", USPORTS_PRESTO),
    "Mount Royal": ("https://mrucougars.com", USPORTS_SIDEARM),
    "Nipissing": ("https://nulakers.ca", USPORTS_SIDEARM),
    "Ontario Tech": ("https://goridgebacks.com", USPORTS_PRESTO),
    "Queen's": ("https://gogaelsgo.com", USPORTS_SIDEARM),
    "Regina": ("https://cougarsandrams.com", USPORTS_SIDEARM),
    "Saint Mary's": ("https://smuhuskies.ca", USPORTS_PRESTO),
    "Saskatchewan": ("https://huskies.usask.ca", USPORTS_SIDEARM),
    "StFX": ("https://goxgo.ca", USPORTS_PRESTO),
    "Thompson Rivers": ("https://gowolfpack.ca", USPORTS_SIDEARM),
    "Toronto": ("https://varsityblues.ca", USPORTS_SIDEARM),
    "Toronto Metropolitan": ("https://tmubold.ca", USPORTS_SIDEARM),
    "Trinity Western": ("https://gospartans.ca", USPORTS_SIDEARM),
    "UBC": ("https://gothunderbirds.ca", USPORTS_SIDEARM),
    "UBCO": ("https://goheat.ca", USPORTS_SIDEARM),
    "UFV": ("https://gocascades.ca", USPORTS_SIDEARM),
    "UNB": ("https://goredsgo.ca", USPORTS_PRESTO),
    "UNBC": ("https://unbctimberwolves.com", USPORTS_SIDEARM),
    "UPEI": ("https://gopanthersgo.ca", USPORTS_PRESTO),
    "Victoria": ("https://govikesgo.com", USPORTS_SIDEARM),
    "Waterloo": ("https://athletics.uwaterloo.ca", USPORTS_SIDEARM),
    "Western": ("https://westernmustangs.ca", USPORTS_SIDEARM),
    "Windsor": ("https://golancers.ca", USPORTS_SIDEARM),
    "Winnipeg": ("https://wesmen.ca", USPORTS_SIDEARM),
    "York": ("https://yorkulions.ca", USPORTS_SIDEARM),
}
# Not read (2026-09-27): Cape Breton, Dalhousie, Lakehead, Laval, Ottawa, UQAM - no roster page found, or one without height. Algoma and
# Nipissing are read but print no height yet.


def _ft_in(s: str) -> int | None:
    """6'7", 6-7, 6' 7'', 6ft 7 or 201 cm -> centimetres."""
    m = re.search(r"\b(\d{3})\s*cm\b", s or "")
    if m:
        return int(m.group(1))
    m = re.search(r"\b([4-7])\s*(?:'|’|′|-|ft\.?)\s*(\d{1,2})(?:\.\d+)?(?!\d)", s or "")
    if not m or int(m.group(2)) > 11:
        return None
    return round(int(m.group(1)) * 30.48 + int(m.group(2)) * 2.54)


def _lbs(s: str) -> int | None:
    """'215', '215 lbs' -> kg; '98 kg' stays kg."""
    m = re.search(r"\b(\d{2,3})\s*kg\b", s or "", re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"\b(\d{3})\b", s or "")
    return round(int(m.group(1)) * 0.45359237) if m else None


def _roster_table(page: str) -> Iterator[dict]:
    """A roster table (PrestoSports, and Concordia's list of <ul> rows): the header row names the columns."""
    if 'class="numroster"' in page:                         # Concordia: a <ul> per row, an <li> per cell
        page = "<table>" + re.sub(r"<(/?)li\b", r"<\1td", re.sub(r"<(/?)ul\b", r"<\1tr", page.split('class="numroster"', 1)[1])) + "</table>"
    for table in re.findall(r"<table\b.*?</table>", page, re.S | re.I):
        col: dict = {}
        for row in _rows(table):
            cells = _cells(row)
            if not col:
                heads = [re.sub(r"[^a-z]", "", _txt(c).lower()) for c in cells]
                if "name" in heads and ({"ht", "height"} & set(heads)):
                    col = {k: next((i for i, h in enumerate(heads) if h in names), None)
                           for k, names in (("name", ("name",)), ("ht", ("ht", "height")), ("wt", ("wt", "weight")), ("no", ("no", "number")))}
                continue
            if len(cells) <= max(v for v in col.values() if v is not None):
                continue
            a = re.search(r"<a\b[^>]*>(.*?)</a>", cells[col["name"]], re.S)
            who = _txt(a.group(1) if a else cells[col["name"]])
            if not who:
                continue
            no = _txt(cells[col["no"]]) if col["no"] is not None else ""
            yield {"name": who, "number": no if re.fullmatch(r"\d{1,2}", no) else None,
                   "height_cm": _ft_in(_txt(cells[col["ht"]])), "weight_kg": _lbs(_txt(cells[col["wt"]])) if col["wt"] is not None else None}
        if col:
            return


def _roster_sidearm(page: str) -> Iterator[dict]:
    """A Sidearm roster: one li.sidearm-roster-player per player, height and weight in their own spans."""
    for blk in re.split(r'<li class="sidearm-roster-player[" ]', page)[1:]:
        blk = blk.split('<div class="sidearm-roster-player-extra', 1)[0]

        def span(cls, blk=blk):
            m = re.search(r'class="sidearm-roster-player-' + cls + r'"[^>]*>(.*?)</', blk, re.S)
            return _txt(m.group(1)) if m else ""
        nm = re.search(r'class="sidearm-roster-player-name".*?<a\b[^>]*>(.*?)</a>', blk, re.S)
        who = _txt(nm.group(1)) if nm else f"{span('first-name')} {span('last-name')}".strip()
        if who:
            no = span("jersey-number")
            yield {"name": who, "number": no if re.fullmatch(r"\d{1,2}", no) else None,
                   "height_cm": _ft_in(span("height")), "weight_kg": _lbs(span("weight"))}


def usports(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    y = _season_start(today)
    this, last = f"{y}-{str(y + 1)[2:]}", f"{y - 1}-{str(y)[2:]}"
    got = 0
    for club, (site, paths) in USPORTS_CLUBS.items():
        for p in paths:                                    # this season's roster first; last season's catches a club not posted yet
            page = get_text(site + p.format(this=this, last=last)) or ""
            for r in (_roster_sidearm(page) if "sidearm-roster-player" in page else _roster_table(page)):
                if r["height_cm"] or r["weight_kg"]:
                    got += 1
                    yield {**r, "team": club, "label": f"{r['name']} ({club})"}
    log(f"     U SPORTS: {got} players with a height or weight on {len(USPORTS_CLUBS)} club sites")


# ---------------------------------------------------------------------------- LNBP ---
def lnbp(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
    """The EUI embed's players page ("Jugadores") lists a season's whole league in one request: height, weight, and a date of birth for
    about a third (the player page has no more than the list). Its id is the box score's personId, the game feed's own key.
    The season is the calendar year (July to November)."""
    from adapters import lnbp as M
    from adapters.lnb import EUI_EMBED, page_state
    url = f"{EUI_EMBED}/{M.LnbpAdapter.eui_site}/persons"
    first = (get_json(url, {"state": page_state({"l": M.LnbpAdapter.locale})}, M.HEADERS) or {}).get("data") or {}
    seasons = [s for s in (first.get("seasons") or {}).get("seasons") or [] if s.get("competitionId") == M.LEAGUE_COMPETITION]
    y = (today or date.today()).year
    for year in (y, y - 1):
        for s in (s for s in seasons if s.get("year") == year):
            data = first if s["seasonId"] == first.get("seasonId") else \
                (get_json(url, {"state": page_state({"s": s["seasonId"], "l": M.LnbpAdapter.locale})}, M.HEADERS) or {}).get("data") or {}
            rows = (data.get("persons") or {}).get("rows") or []
            log(f"     LNBP {year} ({s.get('nameLocal')}): {len(rows)} players")
            for r in rows:
                yield {"name": r.get("name"), "team": r.get("teamName"), "key": r.get("id"), "number": r.get("bib"),
                       "height_cm": r.get("height"), "weight_kg": r.get("weight"), "birth": r.get("Date of birth"), "label": r.get("name")}


# ------------------------------------------------------------------------- LKL ---
LKL = "https://lkl.lt"


def _lkl_page(slug: str) -> dict:
    """lkl.lt/zaidejai/<slug>: 'Amžius 1994-04-26 (32 m.) ... Svoris 93 kg Ūgis 198 cm'."""
    t = _txt(get_text(f"{LKL}/zaidejai/{slug}") or "")
    b = re.search(r"Amžius\s+(\d{4}-\d{2}-\d{2})", t)
    w = re.search(r"Svoris\s+(\d{2,3})\s*kg", t)
    h = re.search(r"Ūgis\s+(\d{3})\s*cm", t)
    return {"birth": b.group(1) if b else None, "weight_kg": w.group(1) if w else None, "height_cm": h.group(1) if h else None}


def lkl(today: date | None = None, log: Callable = print, players: list | None = None, **_) -> Iterator[dict]:
    """The game feed keys an LKL player by his lkl.lt slug (the box score's `slug`), and the slug IS his page: /zaidejai/<slug>
    gives date, height and weight. A club page lists only its leaders (the squad is a lazy Livewire component), so no roster is
    read: one record per player already on the site, his page opened only if something is missing."""
    n = 0
    for p in players or []:
        for k in sorted(p["keys"]):
            slug = k.rsplit(":", 1)[-1]
            if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", slug):
                n += 1
                yield {"key": slug, "label": f"{p['first_name']} {p['last_name']}", "detail": (lambda slug=slug: _lkl_page(slug))}
                break
    log(f"     LKL: {n} players keyed by their lkl.lt slug")


# ------------------------------------------------------------------------- NKL ---
NKL = "https://nkl.lt"
_NKL_PLAYER = re.compile(r"""href=["']?https?://nkl\.lt/zaidejai/(\d+)/?["']?\s*>([^<]+)</a>""")


def _nkl_page(pid: str) -> dict:
    t = _txt(get_text(f"{NKL}/zaidejai/{pid}/") or "")
    b = re.search(r"Amžius\s+(\d{4}-\d{2}-\d{2})", t)
    w = re.search(r"Svoris\s+(\d{2,3})\s*kg", t)
    h = re.search(r"Ūgis\s+(\d{3})\s*cm", t)
    return {"birth": b.group(1) if b else None, "weight_kg": w.group(1) if w else None, "height_cm": h.group(1) if h else None}


def nkl(today: date | None = None, log: Callable = print, teams: list | None = None, **_) -> Iterator[dict]:
    """nkl.lt/komandos/<club id>/ (the club id is the schedule's home_team_id, the feed's club code) is a roster table: shirt, name,
    position, height, weight and an AGE, not a date. The date is on the player's page (/zaidejai/<id>/, 'Amžius 2004-08-30'), opened
    only for a player still missing something. The page shows the current squad only; there is no season switch."""
    clubs = [(t["code"], t.get("name")) for t in teams or [] if re.fullmatch(r"\d{1,6}", t.get("code") or "")]
    if not clubs:                                         # no clubs on the site yet: the homepage's club strip
        clubs = [(c, None) for c in dict.fromkeys(re.findall(r"nkl\.lt/komandos/(\d+)/", get_text(NKL + "/") or ""))]
    log(f"     NKL: {len(clubs)} clubs")
    for code, name in clubs:
        page = get_text(f"{NKL}/komandos/{code}/") or ""
        h1 = re.search(r'<h1[^>]*nkl-team-title[^>]*>(.*?)</h1>', page, re.S)
        club = name or (_txt(h1.group(1)) if h1 else None)
        seen: set = set()
        for row in _rows(page):
            m = _NKL_PLAYER.search(row)
            if not m or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            cells = [_txt(c) for c in _cells(row)]
            num = re.search(r'nkl-roster-num[^>]*>\s*(\d{1,2})\s*<', row)
            height = next((c[:-3] for c in cells if re.fullmatch(r"\d{3} cm", c)), None)
            weight = next((c[:-3] for c in cells if re.fullmatch(r"\d{2,3} kg", c)), None)
            who = _txt(m.group(2))
            yield {"name": who, "team": club, "number": num.group(1) if num else None, "height_cm": height, "weight_kg": weight,
                   "detail": (lambda pid=m.group(1): _nkl_page(pid)), "label": who}


# ------------------------------------------------- the federation's 1 Liga (PZKosz) ---
PZKOSZ = "https://rozgrywki.pzkosz.pl"
_PZ_ROW = re.compile(r'<tr[^>]*data-href="/liga/\d+/(?:sezon/\d+/)?zawodnicy/p/(\d+)/[^"]*"[^>]*>(.*?)</tr>', re.S | re.I)


def pzkosz(liga: int, keyed: bool = False) -> Callable[..., Iterator[dict]]:
    """rozgrywki.pzkosz.pl, the federation's competition site: each club's page is a squad table - shirt, name, date of birth (with
    the age beside it), height, position; no weight. League 2 = the PLK (ORLEN Basket Liga), 1 = 1 Liga Mężczyzn, 16 = 1 Liga Kobiet.
    The season switch on the clubs page names each season's id, so this season and last are both read (this season's row wins).
    The player id in a row is the federation's (esor) person id, which IS the PLK game feed's player id (plk.pl/api/webpage/game
    players[].id): `keyed` sends it as the key. The 1 Ligas' game feed is FIBA LiveStats, keyed by the game's own pno, so there it
    is not a key and the match is by name and club (the federation's club names are the ones Puls Basketu prints)."""
    def read(today: date | None = None, log: Callable = print, **_) -> Iterator[dict]:
        y = _season_start(today)
        opts = dict((int(yr), sid) for sid, yr in re.findall(rf'value="/liga/{liga}/sezon/(\d+)/druzyny\.html"[^>]*>\s*(\d{{4}})/',
                                                               get_text(f"{PZKOSZ}/liga/{liga}/druzyny.html") or ""))
        seen: set = set()
        for year in (y, y - 1):
            sid = opts.get(year)
            if not sid:
                log(f"     PZKosz liga {liga}: no {year}/{year + 1} season on the site")
                continue
            clubs = dict.fromkeys(re.findall(rf'href="(/liga/{liga}/(?:sezon/{sid}/)?druzyny/d/\d+/[^"]+\.html)"',
                                             get_text(f"{PZKOSZ}/liga/{liga}/sezon/{sid}/druzyny.html") or ""))
            n = 0
            for url in clubs:
                page = get_text(PZKOSZ + url) or ""
                h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
                club = _txt(h1.group(1)) if h1 else None
                for pid, row in _PZ_ROW.findall(page):
                    if pid in seen:
                        continue
                    h3 = re.search(r"<h3[^>]*>(.*?)</h3>", row, re.S)
                    if not h3:
                        continue
                    first, _, last = _html.unescape(re.sub(r"<[^>]+>", "", h3.group(1))).strip().partition("\xa0")   # 'Julia&nbsp;Jeleńczak'
                    cells = [_txt(c) for c in _cells(row)]
                    born = next((re.match(r"\d{2}\.\d{2}\.\d{4}", c).group(0) for c in cells if re.match(r"\d{2}\.\d{2}\.\d{4}", c)), None)
                    height = next((c[:-3] for c in cells if re.fullmatch(r"\d{3} cm", c)), None)
                    seen.add(pid)
                    n += 1
                    yield {"first": first.strip(), "last": _txt(last), "team": club, "key": pid if keyed else None, "number": cells[0] if cells and cells[0].isdigit() else None,
                           "height_cm": height, "birth": born, "label": f"{first.strip()} {_txt(last)}"}
            log(f"     PZKosz liga {liga}, {year}/{year + 1}: {n} players on {len(clubs)} clubs")
    return read


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
    "korisliiga": torneopal(4),
    "naisten-korisliiga": torneopal(1),
    "i-divisioona-a": torneopal(2),
    "i-divisioona-b": torneopal(29461),
    "slovak-sbl": sbl,
    "nbl-bulgaria": bgnbl,
    "greek-elite-league": grel,
    "lnb-espoirs-elite": lnb(3),
    "lnb-espoirs-elite-2": lnb(4),
    "u-sports": usports,
    "lnbp": lnbp,
    "lkl": lkl,
    "nkl": nkl,
    "orlen-basket-liga": pzkosz(2, keyed=True),
    "1-liga-mezczyzn": pzkosz(1),
    "1-liga-kobiet": pzkosz(16),
}

# Leagues whose reader goes club by club through the feed's own club ids (bio_sync loads the clubs for them).
NEEDS_TEAMS = {"primera-feb", "segunda-feb", "liga-femenina-endesa", "liga-femenina-2", "liga-femenina-challenge", "liga-u", "nkl"}
# Leagues whose site refuses a GitHub runner: the weekly workflow leaves them out, run them by hand from a home connection.
HOME_ONLY = {"lnb-elite", "lnb-elite-2", "lnb-espoirs-elite", "lnb-espoirs-elite-2"}
