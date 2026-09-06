"""
Adapter registry. A source row names one of these keys; the worker never
branches on league names. Adding a non-FIBA league = adding one adapter class
here (see pbp-scraper-builder for the parsing conventions) and one config row.

Stubs raise NotImplementedError with a pointer to the pipeline module that
already parses that source in the bcb_scraper / LINEUPDATASCRAPE project, so
wiring them is a bridge, not a rewrite.
"""
from __future__ import annotations

from .base import BaseAdapter, GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter


class _PipelineBridge(BaseAdapter):
    """Generic bridge: delegate to an importable pipeline module exposing
    discover(schedule_url, config) -> [ScheduleGame-like dicts] and
    fetch(external_id, config) -> 13-CSV dict. Used for 2BBL, EuroLeague,
    Eurobasket and any bcb_scraper league until a native adapter exists."""
    name = "bcb_pipeline"
    module = "bcb_scraper.bridge"

    def _mod(self):
        import importlib
        try:
            return importlib.import_module(self.module)
        except Exception as exc:  # pragma: no cover
            raise NotImplementedError(f"{self.name}: pipeline module {self.module} not importable ({exc}). "
                                      "Run on the worker with the scraper project on PYTHONPATH.")

    def discover(self, schedule_url, config):
        for g in self._mod().discover(schedule_url, config):
            yield ScheduleGame(**g) if isinstance(g, dict) else g

    def fetch(self, external_id, config):
        b = self._mod().fetch(external_id, config)
        if not b:
            return None
        return GameBundle(external_id=str(external_id), status=b.get("status", "final"),
                          home_name=b.get("home_name", ""), away_name=b.get("away_name", ""), tipoff_at=b.get("tipoff_at"),
                          team=b.get("team", {}), box=b.get("box", {}), stints=b.get("stints", []), lineups=b.get("lineups", {}),
                          four_factors=b.get("four_factors", {}), shots=b.get("shots", {}), transition=b.get("transition", {}),
                          pbp=b.get("pbp"), payload_hash=b.get("payload_hash", ""), raw=b.get("raw"))


class Bbl2BblAdapter(_PipelineBridge):
    name = "bbl_2bbl"
    module = "bcb_scraper.bbl_2bbl"


class EuroLeagueApiAdapter(_PipelineBridge):
    name = "euroleague_api"
    module = "bcb_scraper.euroleague_api"


class EurobasketHtmlAdapter(_PipelineBridge):
    name = "eurobasket_html"
    module = "bcb_scraper.eurobasket_html"


class GeniusHtmlAdapter(_PipelineBridge):
    name = "genius_html"
    module = "bcb_scraper.genius_html"


REGISTRY: dict[str, type[BaseAdapter]] = {
    FibaLiveStatsAdapter.name: FibaLiveStatsAdapter,
    Bbl2BblAdapter.name: Bbl2BblAdapter,
    EuroLeagueApiAdapter.name: EuroLeagueApiAdapter,
    EurobasketHtmlAdapter.name: EurobasketHtmlAdapter,
    GeniusHtmlAdapter.name: GeniusHtmlAdapter,
    _PipelineBridge.name: _PipelineBridge,
}


def get_adapter(name: str) -> BaseAdapter:
    try:
        return REGISTRY[name]()
    except KeyError:
        raise KeyError(f"unknown adapter '{name}'. Known: {', '.join(REGISTRY)}")
