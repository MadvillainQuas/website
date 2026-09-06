"""
FIBA LiveStats adapter (Genius Sports data.json).

Covers every league whose site embeds a FIBA LiveStats schedule (SLB, BBE,
EABL, SBF, CEBL, CIBA, NKL …). Discovery reuses the headless-Chrome routine
already proven in scripts/gamevis_schedule_scraper.py; fetching hits the public
data.json endpoint.

Normalisation to the GameBundle / 13-CSV shape:
  • box + team totals + shot zones + transition — self-contained here (pure
    transforms of `tm`), so the worker never blocks on the scraper project.
  • stints (+ vs_starters flags) — delegated to the scraper pipeline's
    `fiba_api_parser.APIBackedParser`, the same code that writes stints.csv for
    the analytics app, when the scraper folder is importable (config
    `scraper_dir`, default C:\\Users\\Admin\\Documents\\scraper files; on the
    Actions worker, the checked-out scraper repo on PYTHONPATH). Rows are
    produced through the pipeline's own StintCSVStreamer so the column
    contract is exactly stints.csv's.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable, Optional

import re
import urllib.parse

import requests

from .base import BaseAdapter, GameBundle, ScheduleGame

SCRIPTS_DIR = Path(__file__).resolve().parents[2]          # …/scripts (adapters → ingest → scripts)
sys.path.insert(0, str(SCRIPTS_DIR))
_GVS_IMPORT_ERROR = None
try:                                   # the schedule pre-scraper that already runs on GitHub Actions
    import gamevis_schedule_scraper as gvs   # noqa: E402
except Exception as _exc:              # pragma: no cover - headless Chrome may be unavailable locally
    gvs = None
    _GVS_IMPORT_ERROR = repr(_exc)

FIBA_DATA_URL = "https://fibalivestats.dcd.shared.geniussports.com/data/{game_id}/data.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ProphesyIngest/1.0"
DEFAULT_SCRAPER_DIR = os.environ.get("SCRAPER_DIR", r"C:\Users\Admin\Documents\scraper files")

# Shot-chart geometry — the calibrated constants from fiba_api_parser.py
# (full court 28 x 15 m drawn in a 0–100 x/y frame, rims at x=6 / x=94, y=50,
# "at the rim" = within 4 ft). Kept identical so zone counts match stints.csv.
CHART_W_M, CHART_H_M = 28.0, 15.0
RIM_X_LEFT, RIM_X_RIGHT, RIM_Y = 6.0, 94.0, 50.0
RIM_RADIUS_M = 1.22


def shot_dist_to_nearest_rim(x, y) -> float:
    try:
        x = float(x); y = float(y)
    except (TypeError, ValueError):
        return math.inf
    best = math.inf
    for rx in (RIM_X_LEFT, RIM_X_RIGHT):
        dx = (x - rx) / 100.0 * CHART_W_M
        dy = (y - RIM_Y) / 100.0 * CHART_H_M
        best = min(best, math.hypot(dx, dy))
    return best


class FibaLiveStatsAdapter(BaseAdapter):
    name = "fiba_livestats"
    min_request_gap_s = 0.3
    _last = 0.0
    _pipeline = None            # cached fiba_api_parser module (or False after a failed import)
    _pipeline_error = None
    _box_cache: dict = {}

    # ------------------------------------------------------------------ discovery
    # League sites embed the Genius Sports "hosted solution" widget: the page itself is an
    # SPA, but the widget's own pages at hosted.wh.geniussports.com/<CLIENT>/en/<WHurl> are
    # SERVER-RENDERED, so a plain GET returns every match id (verified 2026-09-06: 144 ids for
    # SLB in one request; headless Chrome on the Actions runner returned 0). Chrome is now the
    # fallback, not the road.
    ID_PATTERNS = [re.compile(p) for p in (
        r"extfix_(\d{5,10})", r"/match/(\d{5,10})/", r"/u/[A-Z]+/(\d{5,10})/",
        r"matchId[\"']?\s*[:=]\s*[\"']?(\d{5,10})", r"/data/(\d{6,10})/data\.json")]
    HOSTED = "https://hosted.wh.geniussports.com"

    def hosted_urls(self, schedule_url: str, config: dict) -> list[str]:
        """Candidate server-rendered schedule URLs for a league schedule URL."""
        u = urllib.parse.urlparse(schedule_url)
        if "geniussports.com" in u.netloc:
            return [schedule_url]
        qs = urllib.parse.parse_qs(u.query)
        wh = qs.get("WHurl", [None])[0]
        if not wh:
            return []
        wh = urllib.parse.unquote(wh)
        codes = [c for c in (config.get("client_code"), config.get("code")) if c]
        if not codes:
            try:                       # the page names its client code in the embed loader: //embed','SLB'
                page = requests.get(schedule_url, headers={"User-Agent": UA}, timeout=25, verify=False).text
                codes = re.findall(r"geniussports\.com//embed['\"]?\s*,\s*['\"]([A-Za-z0-9_]+)['\"]", page)
            except Exception:
                codes = []
        return [f"{self.HOSTED}/{c}/en{wh}" for c in dict.fromkeys(codes)]

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        found: set[str] = set()
        for hu in self.hosted_urls(schedule_url, dict(config, code=config.get("code") or self._code_hint)):
            try:
                gap = time.time() - self._last
                if gap < self.min_request_gap_s:
                    time.sleep(self.min_request_gap_s - gap)
                self._last = time.time()
                r = requests.get(hu, headers={"User-Agent": UA}, timeout=40)
                if r.status_code != 200:
                    continue
                for pat in self.ID_PATTERNS:
                    found.update(pat.findall(r.text))
                if found:
                    print(f"     hosted schedule: {len(found)} game ids ({hu[:80]}…)")
                    break
            except Exception as exc:
                print(f"     hosted schedule failed ({exc}); trying the next candidate")
        if not found:
            if gvs is None:
                raise RuntimeError(f"no ids from the hosted schedule and gamevis_schedule_scraper not importable ({_GVS_IMPORT_ERROR})")
            found.update(str(x) for x in gvs.discover_game_ids([schedule_url], headless=not config.get("headed", False)))
        for gid in sorted(found, key=lambda x: int(x)):
            yield ScheduleGame(external_id=str(gid))

    _code_hint = None

    # ------------------------------------------------------------------ fetch
    def _get(self, url: str) -> Optional[dict]:
        gap = time.time() - self._last
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last = time.time()
        r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
        if r.status_code in (403, 404):     # not published yet (403 is what the feed returns before tip) — try next poll
            return None
        r.raise_for_status()
        return r.json()

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        raw = self._get(FIBA_DATA_URL.format(game_id=external_id))
        if not raw or "tm" not in raw:
            return None
        return self.bundle_from_raw(raw, external_id, config)

    def bundle_from_raw(self, raw: dict, external_id: str, config: dict | None = None) -> GameBundle:
        config = config or {}
        payload_hash = hashlib.sha1(json.dumps(raw, sort_keys=True).encode()).hexdigest()
        tm = raw["tm"]
        home, away = tm.get("1", {}), tm.get("2", {})
        status = self._status(raw)
        team_rows = {"home": self._team_row(home, external_id), "away": self._team_row(away, external_id)}
        box_rows = {"home": self._box_rows(home, external_id), "away": self._box_rows(away, external_id)}
        self._box_cache = box_rows
        stints = self._stints_via_pipeline(raw, external_id, config, team_rows)
        return GameBundle(
            external_id=external_id, status=status,
            home_name=home.get("name", ""), away_name=away.get("name", ""),
            tipoff_at=None,
            team=team_rows, box=box_rows, stints=stints, lineups={},
            four_factors=self.four_factors_from_team_rows(team_rows["home"], team_rows["away"]),
            shots=self._shots(home, away), transition=self._transition(home, away),
            pbp=None, payload_hash=payload_hash, raw=raw,
        )

    # ------------------------------------------------------------------ status
    @staticmethod
    def _status(raw: dict) -> str:
        # The pbp carries an explicit "game end" action once the game is over;
        # period/clock alone cannot distinguish "end of Q4, OT coming" from final.
        for ev in raw.get("pbp") or []:
            if ev.get("actionType") == "game" and ev.get("subType") == "end":
                return "final"
        if not (raw.get("pbp") or []):
            return "scheduled"
        return "live"

    # ------------------------------------------------------------------ normalisers
    @staticmethod
    def _tot(t: dict, k: str) -> float:
        v = t.get("tot_" + k)
        if v is None:
            v = (t.get("tot") or {}).get(k) if isinstance(t.get("tot"), dict) else None
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    @classmethod
    def _team_row(cls, t: dict, gid: str) -> dict:
        g = lambda k: cls._tot(t, k)
        fga, oreb, tov, fta = g("sFieldGoalsAttempted"), g("sReboundsOffensive"), g("sTurnovers"), g("sFreeThrowsAttempted")
        pts = g("sPoints") or float(t.get("score") or 0)
        return {
            "game_id": gid, "team": t.get("name", ""), "team_code": t.get("code", ""), "points": pts,
            "fgm": g("sFieldGoalsMade"), "fga": fga,
            "fg2m": g("sTwoPointersMade"), "fg2a": g("sTwoPointersAttempted"),
            "fg3m": g("sThreePointersMade"), "fg3a": g("sThreePointersAttempted"),
            "ftm": g("sFreeThrowsMade"), "fta": fta,
            "oreb": oreb, "dreb": g("sReboundsDefensive"), "treb": g("sReboundsTotal"),
            "ast": g("sAssists"), "stl": g("sSteals"), "blk": g("sBlocks"), "tov": tov, "pf": g("sFoulsPersonal"),
            "pf_drawn": g("sFoulsOn"), "blk_against": g("sBlocksReceived"),
            "poss": fga - oreb + tov + 0.44 * fta,
            "pts_second_chance": g("sPointsSecondChance"), "pts_fast_break": g("sPointsFastBreak"),
            "pts_off_tov": g("sPointsFromTurnovers"), "pts_paint": g("sPointsInThePaint"), "pts_bench": g("sBenchPoints"),
            "biggest_lead": g("sBiggestLead"), "lead_changes": g("sLeadChanges"),
            "q_scores": [t.get("p%d_score" % i) for i in range(1, 5)],
        }

    @staticmethod
    def _full_name(p: dict) -> str:
        first = (p.get("firstName") or p.get("internationalFirstName") or "").strip()
        fam = (p.get("familyName") or p.get("internationalFamilyName") or "").strip()
        if first or fam:
            return (first + " " + fam).strip()
        return (p.get("name") or p.get("scoreboardName") or "").strip()

    @classmethod
    def _box_rows(cls, t: dict, gid: str) -> list:
        rows = []
        for pid, p in (t.get("pl") or {}).items():
            g = lambda k: p.get(k, 0) or 0
            rows.append({
                "game_id": gid, "team_name": t.get("name", ""), "player_id": str(pid), "pno": pid,
                "player_name": cls._full_name(p), "short_name": p.get("name", ""),
                "shirt": str(p.get("shirtNumber", "") or ""), "playing_position": p.get("playingPosition", ""),
                "starter": int(p.get("starter", 0) or 0), "active": int(p.get("active", 1) or 0), "sMinutes": p.get("sMinutes", "0:00"),
                "sPoints": g("sPoints"), "sFieldGoalsMade": g("sFieldGoalsMade"), "sFieldGoalsAttempted": g("sFieldGoalsAttempted"),
                "sThreePointersMade": g("sThreePointersMade"), "sThreePointersAttempted": g("sThreePointersAttempted"),
                "sTwoPointersMade": g("sTwoPointersMade"), "sTwoPointersAttempted": g("sTwoPointersAttempted"),
                "sFreeThrowsMade": g("sFreeThrowsMade"), "sFreeThrowsAttempted": g("sFreeThrowsAttempted"),
                "sReboundsOffensive": g("sReboundsOffensive"), "sReboundsDefensive": g("sReboundsDefensive"), "sReboundsTotal": g("sReboundsTotal"),
                "sAssists": g("sAssists"), "sTurnovers": g("sTurnovers"), "sSteals": g("sSteals"), "sBlocks": g("sBlocks"),
                "sBlocksReceived": g("sBlocksReceived"), "sFoulsPersonal": g("sFoulsPersonal"), "sFoulsOn": g("sFoulsOn"),
                "sPointsSecondChance": g("sPointsSecondChance"), "sPointsFastBreak": g("sPointsFastBreak"),
                "sPlusMinusPoints": g("sPlusMinusPoints"), "sPointsInThePaint": g("sPointsInThePaint"), "eff_1": g("eff_1"),
            })
        return rows

    @staticmethod
    def _shots(home: dict, away: dict) -> dict:
        def zones(t: dict) -> dict:
            z = {"rim": {"att": 0, "made": 0}, "mid": {"att": 0, "made": 0}, "three": {"att": 0, "made": 0}}
            for s in t.get("shot", []) or []:
                made = int(s.get("r", 0) or 0)
                if s.get("actionType") == "3pt":
                    k = "three"
                else:
                    k = "rim" if shot_dist_to_nearest_rim(s.get("x"), s.get("y")) <= RIM_RADIUS_M else "mid"
                z[k]["att"] += 1; z[k]["made"] += made
            return z
        return {"home": zones(home), "away": zones(away)}

    @classmethod
    def _transition(cls, home: dict, away: dict) -> dict:
        tr = lambda t: {"fb": cls._tot(t, "sPointsFastBreak"), "sc": cls._tot(t, "sPointsSecondChance"), "pot": cls._tot(t, "sPointsFromTurnovers")}
        return {"home": tr(home), "away": tr(away)}

    # ------------------------------------------------------------------ stints via the scraper pipeline
    @classmethod
    def _load_pipeline(cls, config: dict):
        if cls._pipeline is not None:
            return cls._pipeline or None
        sdir = config.get("scraper_dir") or DEFAULT_SCRAPER_DIR
        try:
            if sdir and sdir not in sys.path and os.path.isdir(sdir):
                sys.path.insert(0, sdir)
            import fiba_api_parser as fap   # noqa: E402  (pulls in bcb_scraper)
            cls._pipeline = fap
        except Exception as exc:            # pragma: no cover
            cls._pipeline = False
            cls._pipeline_error = repr(exc)
            return None
        return cls._pipeline

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        fap = self._load_pipeline(config)
        if not fap:
            if not getattr(FibaLiveStatsAdapter, "_pipeline_warned", False):
                FibaLiveStatsAdapter._pipeline_warned = True
                print(f"     (stints skipped: scraper pipeline not importable from {config.get('scraper_dir') or DEFAULT_SCRAPER_DIR}: {self._pipeline_error})")
            return []
        bcb = sys.modules.get("bcb_scraper")
        try:
            fap._set_pending_json(raw)
            parser = fap.APIBackedParser("<api/>", "<api/>", game_id=str(gid), game_date=config.get("game_date", ""))
            parser.parse_boxscore()
            parser.parse_playbyplay()
            stints = parser.get_stints()
        except Exception as exc:
            self._pipeline_error = repr(exc)
            print(f"     (stints failed for {gid}: {exc!r})")
            return []
        if not stints:
            return []
        # The parser keys lineups by shirt number when no player registry is attached;
        # stints.csv carries NAMES, so map them through the box rows (shirt -> full name).
        def name_map(side):
            m = {}
            for r in self._box_cache.get(side, []):
                if r.get("shirt") != "":
                    m[str(r["shirt"])] = r["player_name"]
            return m
        nm = {"home": name_map("home"), "away": name_map("away")}
        for st in stints:
            for side in ("home", "away"):
                st[side + "_lineup"] = [nm[side].get(str(x), str(x)) for x in st.get(side + "_lineup", [])]
        home_starters = set(stints[0].get("home_lineup", []))
        away_starters = set(stints[0].get("away_lineup", []))
        is_vs = getattr(bcb, "is_vs_starters", None) or (lambda lineup, starters, thr=0.8: len(set(lineup) & starters) / max(len(set(lineup)), 1) >= thr)
        enhanced = []
        for st in stints:
            e = dict(st)
            e["home_lineup"] = sorted(st.get("home_lineup", []))
            e["away_lineup"] = sorted(st.get("away_lineup", []))
            e["home_team"] = e.get("home_team") or team_rows["home"].get("team", "")
            e["away_team"] = e.get("away_team") or team_rows["away"].get("team", "")
            e["home_vs_starters"] = is_vs(e["away_lineup"], away_starters, 0.8)
            e["away_vs_starters"] = is_vs(e["home_lineup"], home_starters, 0.8)
            e["home_is_starters"] = is_vs(e["home_lineup"], home_starters, 0.8)
            e["away_is_starters"] = is_vs(e["away_lineup"], away_starters, 0.8)
            enhanced.append(e)
        # Serialise through the pipeline's own streamer so the columns ARE stints.csv's.
        Streamer = getattr(bcb, "StintCSVStreamer", None)
        if Streamer is None:
            return [{k: v for k, v in e.items() if k != "player_stats"} for e in enhanced]
        tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
        tmp.close()
        try:
            streamer = Streamer(tmp.name)
            for e in enhanced:
                streamer.write_stint(e)
            close = getattr(streamer, "close", None) or getattr(streamer, "finalize", None)
            if close:
                close()
            else:
                streamer.file.close()
            with open(tmp.name, newline="", encoding="utf-8") as f:
                rows = []
                for r in csv.DictReader(f):
                    out = {}
                    for k, v in r.items():
                        if k in ("home_lineup", "away_lineup", "home_team", "away_team", "game_id", "game_date"):
                            out[k] = v
                        else:
                            try:
                                out[k] = float(v) if v not in ("", None) else 0
                            except ValueError:
                                out[k] = v
                    rows.append(out)
                return rows
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
