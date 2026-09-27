"""Where each league's bio comes from. One reader per league, keyed by the league's slug; a reader yields records for bio.sync():

    {name | first+last, team, key?, height_cm?, weight_kg?, birth?, detail?: () -> {height_cm, weight_kg, birth}, label}

Every reader is polite (one request at a time, a gap between them) and bounded: a league is a few hundred players, never a crawl.
What each source gives, found by looking, not assumed (2026-09-27):

  euroleague / eurocup   one feed for the season's whole people list: height, weight, date of birth for every player (~97% with all three)
  basketligaen (men)     the site's own API: a roster per club (name, shirt), then one athlete page per NEW player (height, weight, date)
  bnxt-league            date of birth only (no height, no weight anywhere in the feed), read out of recent box scores, capped

A league that is not here has no reader yet; docs/league-feeds.md lists what each remaining one publishes.
"""
from __future__ import annotations

import time
from datetime import date
from typing import Callable, Iterator

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
GAP_S = 0.5
_last = [0.0]


def get_json(url: str, params: dict | None = None, headers: dict | None = None):
    """One polite GET: at most one request per GAP_S, JSON or None (404 / 400 / not JSON)."""
    wait = GAP_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    r = requests.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})}, timeout=40)
    if r.status_code in (400, 404):
        return None
    r.raise_for_status()
    try:
        return r.json()
    except ValueError:
        return None


def _season_start(today: date | None = None) -> int:
    t = today or date.today()
    return t.year if t.month >= 8 else t.year - 1


# ------------------------------------------------------- EuroLeague / EuroCup ---
EL_FEED = "https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/{c}/seasons/{c}{y}/people"


def _el_name(s: str) -> tuple[str, str]:
    """'DE COLO, NANDO' -> ('Nando', 'De Colo')."""
    last, _, first = (s or "").partition(",")
    return first.strip().title(), last.strip().title()


def euroleague(letter: str) -> Callable[..., Iterator[dict]]:
    def read(today: date | None = None, log: Callable = print) -> Iterator[dict]:
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
def basketligaen(today: date | None = None, log: Callable = print) -> Iterator[dict]:
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
def bnxt(today: date | None = None, log: Callable = print, max_games: int = 40) -> Iterator[dict]:
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


# Keyed by the league's slug (config/ingest-sources.json league_slug).
READERS: dict[str, Callable[..., Iterator[dict]]] = {
    "euroleague": euroleague("E"),
    "eurocup": euroleague("U"),
    "basketligaen": basketligaen,
    "bnxt-league": bnxt,
}
