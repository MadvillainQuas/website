"""
Adapter contract for the ingest worker.

One adapter per *kind of source*, not per league. A league is just a row in
config/ingest-sources.json (or public.schedule_sources) that names an adapter
and a schedule URL. FIBA LiveStats leagues (SLB, BBE, EABL, SBF, CEBL, CIBA …)
share one adapter; 2BBL, EuroLeague, Eurobasket and the bcb_scraper-backed
leagues each get their own, all returning the same GameBundle.

The GameBundle deliberately mirrors the existing 13-CSV scraper output
(team_totals / player_boxscore_api / stints / lineup rows) so that both the
Supabase `game_advanced` row and index_9's engines are fed by ONE shape.
"""
from __future__ import annotations

import html
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------- what the page said ---
# MOST OF THESE ADAPTERS READ HTML, AND HTML SPELLS AN AMPERSAND "&amp;". A venue came
# through as "M&amp;S Bank Arena" and every page then drew exactly that, because the text
# was never wrong on the way in — it was HTML, stored as if it were words (reported
# 2026-09-18). The same is true of an apostrophe from a JSON array of labels
# ("Men&#039;s National Cup"), which one adapter had already learned to undo on its own.
#
# So it is undone HERE, once, where a page's text becomes a field: every adapter is covered,
# including the next one somebody writes, and nobody has to remember. Unescaping twice is
# harmless for real names — "&amp;amp;" is the only string that would lose a level, and it is
# not a venue — but text that is genuinely blank stays blank rather than becoming "None".
_TEXT_FIELDS = ('home_name', 'away_name', 'venue')


def _text(v):
    """One field of human-readable text, as the page meant it rather than as it spelt it."""
    return html.unescape(v) if isinstance(v, str) and '&' in v else v


def _clean(obj):
    for f in _TEXT_FIELDS:
        if hasattr(obj, f):
            setattr(obj, f, _text(getattr(obj, f)))
    ex = getattr(obj, 'extra', None)
    if isinstance(ex, dict):
        for f in _TEXT_FIELDS:
            if f in ex:
                ex[f] = _text(ex[f])


@dataclass
class ScheduleGame:
    """One game as discovered on a schedule page."""
    external_id: str
    home_name: str = ""
    away_name: str = ""
    tipoff_at: Optional[str] = None          # ISO-8601 UTC if the schedule exposes it
    status: str = "scheduled"                # scheduled | live | final
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        _clean(self)


@dataclass
class GameBundle:
    """Everything the platform stores for one game. Keys mirror the CSV pipeline."""
    external_id: str
    status: str                              # live | final
    home_name: str
    away_name: str
    tipoff_at: Optional[str]
    team: dict                               # {"home": team_totals-row, "away": team_totals-row}
    box: dict                                # {"home": [player_boxscore_api rows], "away": [...]}
    stints: list                             # stints.csv rows (home_/away_ prefixed columns)
    lineups: dict = field(default_factory=dict)      # {"home": [...], "away": [...]}
    four_factors: dict = field(default_factory=dict)
    shots: dict = field(default_factory=dict)
    transition: dict = field(default_factory=dict)
    pbp: Optional[list] = None               # normalised events (optional, large)
    payload_hash: str = ""                   # sha1 of the raw payload — worker skips unchanged
    raw: Any = None                          # raw payload for archiving (never written to Postgres)
    feed_lm_ms: Optional[int] = None         # data.json Last-Modified, epoch ms (None: header absent)
    feed_recv_ms: Optional[int] = None       # when that response arrived, epoch ms

    def __post_init__(self):
        _clean(self)


class BaseAdapter:
    """Subclass per source kind. All methods must be polite (rate-limited) and idempotent."""
    name: str = "base"
    #: minimum seconds between outbound requests for this adapter
    min_request_gap_s: float = 0.3

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        """Read a schedule page and yield the games on it (ids + names + status)."""
        raise NotImplementedError

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        """Fetch one game and normalise it. Return None if the game has no data yet."""
        raise NotImplementedError

    # --- helpers every adapter can use --------------------------------------
    @staticmethod
    def four_factors_from_team_rows(home: dict, away: dict) -> dict:
        def ff(me: dict, opp: dict) -> dict:
            fga, fgm, tpm = me.get("fga", 0), me.get("fgm", 0), me.get("fg3m", 0)
            fta, tov, oreb = me.get("fta", 0), me.get("tov", 0), me.get("oreb", 0)
            odreb = opp.get("dreb", 0)
            tsa = fga + 0.44 * fta + tov
            return {
                "efg": ((fgm + 0.5 * tpm) / fga * 100) if fga else None,
                "tov": (tov / tsa * 100) if tsa else None,
                "oreb": (oreb / (oreb + odreb) * 100) if (oreb + odreb) else None,
                "ftr": (fta / fga * 100) if fga else None,
            }
        return {"home": ff(home, away), "away": ff(away, home)}
