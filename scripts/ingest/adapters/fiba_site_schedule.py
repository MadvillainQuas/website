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
from .fiba_livestats import FibaLiveStatsAdapter, UA, ZoneInfo

CZECH_BASE = "https://nbl.basketball"
CZECH_SCHEDULE = CZECH_BASE + "/zapasy?y={year}&p1=0&c=0&d_od=&d_do=&k=0"
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

# sbl.slovakbasket.sk draws a card per fixture: both crests carry the club's name in alt=, the
# header carries the date and the hall, and the club's own id is in the crest URL.
_SK_CARD = re.compile(r'class="match-ticket-inner".*?(?=class="match-ticket-inner"|\Z)', re.S)
_SK_TEAM = re.compile(r'<img[^>]+src="([^"]*Competitor/(\d+)/[^"]*)"[^>]*alt="([^"]*)"')
_SK_WHEN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})\s*o\s*(\d{1,2}):(\d{2})")
_SK_VENUE = re.compile(r'class="match-ticket-header">.*?<span>\s*([^<]+?)\s*</span>', re.S)


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


def _start_year(season: str) -> int:
    """"2026-27" -> 2026. The platform's season name is the one thing every source agrees on."""
    m = re.match(r"(\d{4})", str(season or ""))
    return int(m.group(1)) if m else time.gmtime().tm_year


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
            return super().fetch(mid, config)
        return super().fetch(external_id, config)

    # ---------------------------------------------------------------- the sites ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        site = (config.get("site") or "").lower()
        if site in ("czech", "czech_nbl", "cbffe"):
            return self._czech(config)
        if site in ("slovakia", "slovakia_sbl", "sba"):
            return self._slovakia(config)
        # not one of ours: let the Genius behaviour have it (a hosted URL still works)
        return super().discover(schedule_url, config)

    def _czech(self, config: dict) -> list[ScheduleGame]:
        """nbl.basketball: one <tr> per fixture — id, both clubs and the kick-off, in one request.

        THE FIXTURE IS KEYED ON THE SITE'S OWN ID, not on the LiveStats id. The LiveStats id is
        the one thing the schedule does NOT carry (it appears on the game's page, and for a
        fixture far out it does not exist yet), so keying on it meant two thirds of the season
        was invisible — 37 fixtures out of 132 — and a game that gained its id later would have
        arrived as a SECOND row beside the one already written. The site id is on every row from
        the moment a fixture exists and never changes, so it is the id; resolving it to a
        LiveStats id is fetch()'s problem, once, and cached.

        That also takes ~130 requests out of every discovery pass: nothing is hopped here at all."""
        year = _start_year(config.get("season") or "")
        html = self._page(CZECH_SCHEDULE.format(year=year))
        out, seen = [], set()
        for row in _CZ_ROW.findall(html):
            m = _ZAPAS.search(row)
            if not m or m.group(1) in seen:
                continue
            sid = m.group(1)
            seen.add(sid)
            names_ = [n.strip() for n in _CZ_TEAM.findall(row) if n.strip()]
            when = _CZ_WHEN.search(row)
            out.append(ScheduleGame(
                external_id=sid,
                home_name=names_[0] if len(names_) > 0 else "",
                away_name=names_[1] if len(names_) > 1 else "",
                tipoff_at=_utc("Europe/Prague", *when.groups()) if when else None))
        return out

    def _czech_match_id(self, sid: str, config: dict) -> Optional[str]:
        """The LiveStats id behind a Czech fixture id, learnt once and remembered.

        A game's LiveStats id never changes, so the map is written to data/feed/<CODE>/idmap.json
        and a fixture costs this hop exactly once in its life."""
        known = self._idmap(config)
        if known.get(sid):
            return known[sid]
        try:
            page = self._page(f"{CZECH_BASE}/zapas/{sid}")
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
