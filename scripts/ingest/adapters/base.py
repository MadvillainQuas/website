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

from dataclasses import dataclass, field
from typing import Any, Iterable, Optional


@dataclass
class ScheduleGame:
    """One game as discovered on a schedule page."""
    external_id: str
    home_name: str = ""
    away_name: str = ""
    tipoff_at: Optional[str] = None          # ISO-8601 UTC if the schedule exposes it
    status: str = "scheduled"                # scheduled | live | final
    extra: dict = field(default_factory=dict)


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
