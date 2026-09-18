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
from typing import Iterable, Optional

import requests

from .base import ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA

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
        """nbl.basketball: the season page lists /zapas/<siteId>; the id is on the game's page."""
        year = _start_year(config.get("season") or "")
        html = self._page(CZECH_SCHEDULE.format(year=year))
        site_ids = list(dict.fromkeys(_ZAPAS.findall(html)))
        known = self._idmap(config)
        out, learned = [], False
        for sid in site_ids:
            mid = known.get(sid)
            if not mid:
                try:
                    page = self._page(f"{CZECH_BASE}/zapas/{sid}")
                except Exception:
                    continue
                m = _WEBCAST.search(page) or _WEBCAST_ANY.search(page)
                if not m:
                    continue           # a fixture with no webcast yet: nothing to ingest
                mid = m.group(1)
                known[sid] = mid
                learned = True
            out.append(ScheduleGame(external_id=str(mid), extra={"site_id": sid}))
        if learned:
            self._save_idmap(config, known)
        return out

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
            for mid in _WEBCAST.findall(html):
                if mid not in seen:
                    seen.add(mid)
                    out.append(ScheduleGame(external_id=str(mid)))
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
