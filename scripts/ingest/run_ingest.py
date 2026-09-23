#!/usr/bin/env python3
"""
run_ingest.py — poll every due schedule source, fetch new / live games through
the source's adapter, and publish them where index_9 (and, later, the Epinoia
site) read from:

  FEED  (always)      data/feed/index.json                 competitions
                      data/feed/<CODE>/index.json          games (id, teams, score, status, hash)
                      data/feed/<CODE>/games/<id>.json     the raw payload (data.json)
                      → committed by the Actions workflow; index_9's Advanced
                        Games View reads it (repo fallback when Supabase is down)
  SUPABASE (if keys)  external_games rows (competition_code, scores, status,
                      payload_hash, raw_ref = public storage URL) + the payload
                      in storage bucket `feed` + feed_competitions upsert
                      → index_9's primary source; realtime-capable
  PLATFORM (if the source has league_id) games + game_advanced rows for the
                      Epinoia site (Phase 2+ of the platform roadmap)

    python scripts/ingest/run_ingest.py                     # everything due (DB sources)
    python scripts/ingest/run_ingest.py --config --source SLB   # config/ingest-sources.json
    python scripts/ingest/run_ingest.py --config --source SLB --ids 2702542,2702560
    python scripts/ingest/run_ingest.py --config --source SLB --dry-run   # write nothing
    python scripts/ingest/run_ingest.py --backfill              # an older season somebody asked for
    python scripts/ingest/run_ingest.py --backfill --dry-run    # ...say which, and read nothing in

Idempotent: (adapter, external_id) is unique; unchanged payload hashes are
skipped; live games are re-fetched until final. Politeness is the adapter's
job (min gap between requests); this runner never fans out in parallel.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

for _stream in (sys.stdout, sys.stderr):        # Windows consoles default to cp1252
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters import get_adapter, REGISTRY  # noqa: E402
from adapters.base import GameBundle, ScheduleGame  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate, game_rows, period_of  # noqa: E402

# EVERY ADAPTER SHAPED LIKE FIBA LIVESTATS -- derived from the classes themselves, not typed out
# by hand. fiba_site_schedule, euroleague, acb, lnb and bleague all subclass FibaLiveStatsAdapter
# and inherit fetch()/bundle_from_raw() unchanged, so a GameBundle from any of them is the same
# shape a source literally named "fiba_livestats" produces. A hand-typed list is exactly how this
# broke once already: write_platform's will_translate compared src["adapter"] to the literal
# string "fiba_livestats", which none of these five subclasses' registry names equal, so a Czech
# NBL / Slovak SBL game never got game_events, game_state or a finalise-game call -- despite its
# payload carrying a full box score and hundreds of play-by-play rows. games.home_score /
# away_score come from a separate assignment in write_platform and were never affected, which is
# why a fixture card showed the real final score while the game page showed FINAL 0-0 with no box
# score (reported 2026-09-18). Deriving this set from REGISTRY means the next subclass is covered
# automatically instead of silently repeating the bug.
TRANSLATABLE_ADAPTERS = {name for name, cls in REGISTRY.items() if issubclass(cls, FibaLiveStatsAdapter)}
# THE SAME MISTAKE, IN THE LANE THAT MAKES A GAME LIVE. live_keeper picked its sources with the
# same `adapter == "fiba_livestats"` string, so the live lane covered the generic sources and
# skipped every league with an adapter of its own on the same feed. Espoirs ELITE 2 tipped off at
# 15:00Z on 18 Sep 2026 and read "PREVIEW & INFO, 0-0" on the strip and in the box score a quarter
# of the way through the game, because no live pass had ever considered it -- while the league's
# own site had it live from the first basket. Derived from REGISTRY for the same reason: the
# question is what an adapter IS, not what it is called.
LIVE_ADAPTERS = {name for name, cls in REGISTRY.items() if issubclass(cls, FibaLiveStatsAdapter)}
# ...but only these ids exist on FIBA's CDN, so only these can be watched by FeedObserver's
# conditional GET; the rest reach their own league's back end through their adapter's fetch().
CDN_ADAPTERS = {"fiba_livestats"}
from feedplatform import Platform, season_name_for  # noqa: E402
import groups  # noqa: E402
from fetchwindow import worth_fetching  # noqa: E402
import feedstamp  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "ingest-sources.json"
FEED_DIR = REPO_ROOT / "data" / "feed"
STORAGE_BUCKET = "feed"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────── Supabase (REST)
class Supabase:
    def __init__(self, url: str, key: str, session=None):
        self.url = url.rstrip("/")
        self.key = key
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        # ONE CONNECTION, NOT A NEW ONE PER CALL. Every method was a bare requests.post/get,
        # so each of the 17-19 round trips a changed live game costs opened its own TCP and
        # TLS connection. Once the feed observer polls between writes (docs/feed-timing.md,
        # step 2) the length of a write is the only thing left that stretches the gap between
        # two looks at a game, and a pooled keep-alive connection is the cheapest part of it
        # to remove. The live lane is single-threaded, so one Session is safe.
        #
        # The one thing a pool adds is a connection that died while it sat idle: the live lane
        # naps up to two minutes waiting for a tip-off, the server closes the socket, and the
        # next request on it fails before a byte of it is processed. urllib3 retries that for
        # GET but not for POST or PATCH. So select, patch and upsert - the calls that are safe
        # to send twice - get exactly one more try on a ConnectionError. insert, rpc and
        # function are never resent: a second insert is a duplicate row, and a second
        # finalise-game is a second pass over a closed game.
        self.s = session or requests.Session()

    def _again(self, send):
        """Send an idempotent request; once more if the pooled connection had gone away."""
        try:
            return send()
        except requests.ConnectionError:
            return send()

    @staticmethod
    def _ok(r):
        """raise_for_status, with PostgREST's own reason attached. "400 Client Error: Bad Request"
        is all 57 failed event writes said on 2026-09-12 (run 34708486251), and callers such as
        write_platform print the exception and carry on - so the body, which names the actual
        fault (mismatched keys, a trigger's message), is the only diagnosis a run log can hold."""
        try:
            r.raise_for_status()
        except requests.HTTPError as exc:
            raise requests.HTTPError(f"{exc} - {(r.text or '')[:300]}", response=r) from None
        return r

    def rpc(self, fn: str, body: dict | None = None):
        r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self.h, json=body or {}, timeout=30)
        self._ok(r); return r.json()

    def select(self, table: str, query: str):
        r = self._again(lambda: self.s.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30))
        self._ok(r); return r.json()

    def upsert(self, table: str, rows, on_conflict: str):
        h = dict(self.h, Prefer="resolution=merge-duplicates,return=representation")
        r = self._again(lambda: self.s.post(f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}", headers=h, json=rows, timeout=60))
        self._ok(r); return r.json()

    def patch(self, table: str, query: str, body: dict):
        r = self._again(lambda: self.s.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30))
        self._ok(r); return r.json() if r.text else None

    def delete(self, table: str, query: str):
        r = self.s.delete(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=60)
        self._ok(r); return True

    def insert(self, table: str, rows):
        h = dict(self.h, Prefer="return=minimal")
        r = self.s.post(f"{self.url}/rest/v1/{table}", headers=h, json=rows, timeout=120)
        self._ok(r); return True

    def function(self, name: str, body: dict):
        r = self.s.post(f"{self.url}/functions/v1/{name}", headers=dict(self.h, **{"x-ingest-worker": "1"}), json=body, timeout=120)
        return r.status_code, (r.json() if r.text and r.headers.get("content-type", "").startswith("application/json") else r.text)

    def storage_put(self, bucket: str, path: str, data: bytes, content_type="application/json") -> str:
        r = self.s.post(f"{self.url}/storage/v1/object/{bucket}/{path}",
                        headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": content_type, "x-upsert": "true"},
                        data=data, timeout=120)
        self._ok(r)
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"


# ─────────────────────────────────────────────────────────── feed (repo files)
class RepoFeed:
    def __init__(self, root: Path):
        self.root = root

    def index(self, code: str) -> dict:
        p = self.root / code / "index.json"
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"code": code, "games": []}

    def known(self, code: str) -> dict:
        return {str(g["id"]): g for g in self.index(code).get("games", [])}

    def write_game(self, code: str, b: GameBundle) -> None:
        d = self.root / code / "games"
        d.mkdir(parents=True, exist_ok=True)
        if b.raw is not None:
            (d / f"{b.external_id}.json").write_text(json.dumps(b.raw, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    def update_index(self, src: dict, entries: dict) -> None:
        code = src["code"]
        games = sorted(entries.values(), key=lambda g: (g.get("date") or "", str(g["id"])), reverse=True)
        (self.root / code).mkdir(parents=True, exist_ok=True)
        (self.root / code / "index.json").write_text(json.dumps({
            "code": code, "label": src.get("label", code), "adapter": src["adapter"], "updated": now_iso(), "games": games
        }, ensure_ascii=False, indent=0), encoding="utf-8")
        comps = []
        for d in sorted(self.root.iterdir()) if self.root.exists() else []:
            ip = d / "index.json"
            if d.is_dir() and ip.exists():
                try:
                    j = json.loads(ip.read_text(encoding="utf-8"))
                    comps.append({"code": j.get("code", d.name), "label": j.get("label", d.name), "adapter": j.get("adapter"),
                                  "games": len(j.get("games", [])), "updated": j.get("updated")})
                except Exception:
                    continue
        (self.root / "index.json").write_text(json.dumps({"updated": now_iso(), "competitions": comps}, ensure_ascii=False, indent=1), encoding="utf-8")


def entry_for(b: GameBundle, prev: dict | None, raw_ref: str | None, sched: ScheduleGame | None = None) -> dict:
    tip = (sched.tipoff_at if sched else None) or b.tipoff_at or (prev or {}).get("date")
    return {
        "id": b.external_id, "home": b.home_name, "away": b.away_name,
        "homeScore": int(b.team["home"].get("points", 0) or 0), "awayScore": int(b.team["away"].get("points", 0) or 0),
        "status": b.status, "date": tip, "hash": b.payload_hash,
        "venue": (sched.extra.get("venue") if sched else None) or (prev or {}).get("venue"),
        "raw_ref": raw_ref or (prev or {}).get("raw_ref"), "updated": now_iso(),
    }


def sched_entry(g: ScheduleGame, prev: dict | None) -> dict:
    """A game the schedule lists but the feed has not published yet (no payload): keep it in the
    index with its date, teams and venue so index_9 and Epinoia can show the fixture."""
    e = dict(prev or {})
    e.update({"id": g.external_id, "home": g.home_name or e.get("home"), "away": g.away_name or e.get("away"),
              "status": e.get("status") if e.get("hash") else (g.status or "scheduled"),
              "date": g.tipoff_at or e.get("date"), "venue": (g.extra or {}).get("venue") or e.get("venue")})
    return e


# ─────────────────────────────────────────────────────────── Supabase feed + platform writes
def write_supabase_feed(sb: Supabase, src: dict, b: GameBundle, entry: dict) -> str | None:
    raw_ref = None
    if b.raw is not None:
        raw_ref = sb.storage_put(STORAGE_BUCKET, f"{src['adapter']}/{b.external_id}.json", json.dumps(b.raw, ensure_ascii=False).encode("utf-8"))
    sb.upsert("external_games", {
        "adapter": src["adapter"], "external_id": b.external_id, "source_id": src.get("id"),
        "competition_code": src["code"], "home_name": b.home_name, "away_name": b.away_name,
        "home_score": entry["homeScore"], "away_score": entry["awayScore"], "game_date": (entry.get("date") or "")[:10] or None,
        "tipoff_at": entry.get("date"), "external_status": b.status, "payload_hash": b.payload_hash, "raw_ref": raw_ref, "last_fetched_at": now_iso(),
    }, "adapter,external_id")
    return raw_ref


def write_supabase_competition(sb: Supabase, src: dict, count: int) -> None:
    sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"],
                                    "league_id": src.get("league_id"), "games": count, "updated_at": now_iso()}, "code")


def resolve_league(sb: Supabase, src: dict, run: dict) -> str | None:
    """The platform league a source feeds: given in the registry, remembered on feed_competitions,
    or — for an entry that asks for its own league (create_league) — created now, once."""
    ac = src.get("adapter_config") or {}
    plat = run.setdefault("_platform", Platform(sb, dry=False, auto_create=bool(ac.get("auto_create", True))))
    league_id = src.get("league_id")
    if league_id or not src.get("create_league"):
        return league_id
    try:
        fc = sb.select("feed_competitions", f"code=eq.{src['code']}&select=league_id")
        league_id = fc[0]["league_id"] if fc and fc[0].get("league_id") else None
        if not league_id:
            lg = plat.league(src["code"], src.get("league_name") or src.get("label") or src["code"], src.get("league_slug"), src.get("league_country"))
            league_id = lg["id"]
            sb.upsert("feed_competitions", {"code": src["code"], "label": src.get("label", src["code"]), "adapter": src["adapter"], "league_id": league_id, "updated_at": now_iso()}, "code")
            print(f"    + league {src.get('league_slug') or src['code']} created for {src['code']}")
        elif src.get("league_country"):        # keep an existing league's country in step with the registry
            plat.league(src["code"], src.get("league_name") or src["code"], src.get("league_slug"), src["league_country"])
        src["league_id"] = league_id
    except Exception as exc:
        print(f"    (league creation failed: {exc})")
        return None
    return league_id


KIND_RULES = [
    (re.compile(r"play-?off|final four|finals?\b|post-?season", re.I), "playoff"),
    (re.compile(r"trophy", re.I), "trophy"),                  # a trophy is its own category on the site
    (re.compile(r"cup|shield|plate|knock-?out", re.I), "cup"),
    (re.compile(r"all.?star|exhibition|friendl|pre-?season|showcase", re.I), "friendly"),
]


def kind_of(name: str, overrides: dict | None = None) -> str:
    """What sort of competition a Genius phase name describes. adapter_config.competition_kinds
    ({"BCB Trophy 2027": "cup"}) wins over the words."""
    if overrides and name in overrides:
        return overrides[name]
    for rx, kind in KIND_RULES:
        if rx.search(name or ""):
            return kind
    return "league"


def season_match(name: str, season_name: str) -> bool:
    """Does a Genius phase name belong to this season? A name carrying a year RANGE (2025-2026,
    2025/26, 25-26) must carry ours; a name with a single year (BCB Trophy 2027, Pro Am 2026) may name
    either end of ours. '2026' inside '2025-2026' is last season, not this one. Super League
    Basketball names its seasons short ('Championship 26-27'), so a range may start with two digits."""
    m = re.match(r"(\d{4})-(\d{2})$", season_name or "")
    if not m:
        return bool(season_name) and season_name in (name or "")
    y1 = int(m.group(1)); y2 = y1 + 1
    century = str(y1)[:2]
    ranges = re.findall(r"(?<!\d)(\d{4}|\d{2})\s*[-/–]\s*(\d{4}|\d{2})(?!\d)", name or "")
    if ranges:
        for a, b in ranges:
            aa = int(a) if len(a) == 4 else int(century + a)
            bb = int(b) if len(b) == 4 else int(century + b)
            if aa == y1 and bb == y2:
                return True
        return False
    years = {int(y) for y in re.findall(r"(?<!\d)(\d{4})(?!\d)", name or "")}
    return bool(years & {y1, y2})


def whole_season_url(url: str) -> str:
    """A Genius hosted competition page lists only the CURRENT ROUND for some clients (SLB's
    Championship 26-27 page shows 4 of its 173 fixtures, WBBL's 5 of 86); roundNumber=-1 lists the
    whole season for every client (BCB's page is the same 182 games either way). Without it a
    league's fixtures would only ever appear one round ahead."""
    if "roundNumber=" in url:
        return url
    if "?" not in url:
        return url + "?roundNumber=-1&"
    return url + ("" if url.endswith(("?", "&")) else "&") + "roundNumber=-1&"


def expand_competition_sources(sources: list[dict]) -> list[dict]:
    """A FIBA source pointing at a client's whole schedule page becomes ONE SOURCE PER COMPETITION
    the page offers for the current season (league, cup/trophy, playoffs, an all-star game), each
    carrying the competition's own schedule URL, name and kind. That is what gives Epinoia the
    separate team lists and tables a cup has, straight from the feed. Names that carry none of
    the league's own words (a client also hosting somebody else's event) are left alone unless
    adapter_config.competitions_include names them; competitions_exclude drops any.

    adapter_config.client_is_league says the client hosts nothing but this league (SLB, WBBL),
    whose phases are named 'Championship 26-27' or 'Betty Codona Cup 2026-27' with no league word
    in them: every competition of the season is then the league's own. Such a client's bare page
    shows whatever competition Genius last defaulted to - still last season's Championship when
    the new one has already started - so when no competition of this season can be listed the
    source is skipped for the pass instead of polling that page into this season."""
    out = []
    for src in sources:
        ac = src.get("adapter_config") or {}
        url = src.get("schedule_url") or ""
        if src.get("adapter") != "fiba_livestats" or "/competition/" in url or ac.get("expand_competitions") is False:
            out.append(src); continue
        adapter = get_adapter(src["adapter"])
        try:
            list(adapter.discover(url, dict(ac, code=src.get("code"))))
            comps = getattr(adapter, "last_competitions", None) or []
        except Exception as exc:
            print(f"   (competition list unavailable for {src.get('code')}: {exc})"); comps = []
        whole_client = bool(ac.get("client_is_league"))
        if not comps:
            if whole_client:
                print(f"   {src.get('code')}: no competition list this pass - skipped (the bare page may be last season's)")
                continue
            out.append(src); continue
        season = ac.get("season") or season_name_for()
        y_start = int(str(season)[:4]) if str(season)[:4].isdigit() else None
        words = {w.lower() for w in re.findall(r"[A-Za-z]{3,}", f"{src.get('label', '')} {src.get('code', '')} {src.get('league_name', '')}")}
        inc = [re.compile(x, re.I) for x in (ac.get("competitions_include") or [])]
        exc_ = [re.compile(x, re.I) for x in (ac.get("competitions_exclude") or [])]
        # THE YEAR, WHERE THE CLIENT PUBLISHES IT. The <option> list on a schedule page gives names
        # only, and a name is a poor season: Basketball England has eight seasons of "NBL Division
        # One" and Sweden's current one is called "SBL Herr" with no year in it at all. The tenant's
        # landing page carries the year against each competition id, so it is asked once per pass
        # and the name is only fallen back on when the client does not publish it.
        years = {}
        if ac.get("client_code") and hasattr(adapter, "tenant_competitions"):
            try:
                years = {c["id"]: c["year"] for c in adapter.tenant_competitions(ac["client_code"])}
            except Exception:
                years = {}
        picked = []
        for c in comps:
            n = c["name"]
            if any(r.search(n) for r in exc_):
                continue
            # competitions_include NAMES what is ours; it does not excuse the season. Before, an
            # include matched every season the client had ever run — three EABLs, twenty-three
            # "NBL Division One"s, and the women's league along with them.
            named = any(r.search(n) for r in inc) if inc else (whole_client or any(w in n.lower() for w in words))
            yr = years.get(c.get("id"))
            in_season = (yr == y_start) if (yr and y_start) else season_match(n, season)
            wanted = named and in_season
            # an all-star game or exhibition is not a phase with a table; only when asked for by name
            if wanted and kind_of(n, ac.get("competition_kinds")) == "friendly" and not any(r.search(n) for r in inc):
                continue
            if wanted:
                picked.append(c)
        if not picked:
            # A source that KNOWS which competitions are its own (client_is_league, or an explicit
            # competitions_include) and finds none for this season has nothing to ingest yet: the
            # client has not published the season. Falling through to the bare page would poll
            # whatever Genius last defaulted to, which is last season - the one thing a site that
            # says "current season" must not do.
            if whole_client or inc:
                print(f"   {src.get('code')}: no {season} competition published yet - skipped")
                continue
            out.append(src); continue
        # A season that is ONE competition, play-offs included (CIBACOPA), comes as two sources - the
        # regular season and the play-offs - split by phase in FibaLiveStatsAdapter.stage_games. The
        # play-off source's games are a competition of their own, named for the season's.
        playoff_stage = bool(ac.get("playoff_phases")) and str(ac.get("stage") or "").lower().startswith("playoff")
        named = [(c, f"{c['name']} Playoffs" if playoff_stage else c["name"],
                  "playoff" if playoff_stage else kind_of(c["name"], ac.get("competition_kinds"))) for c in picked]
        print(f"-> {src.get('code')}: {len(picked)} competition(s) this season: " + ", ".join(f"{label} [{kind}]" for _, label, kind in named))
        for c, label, kind in named:
            out.append({**src, "schedule_url": whole_season_url(c["url"]), "competition_label": label,
                        "competition_kind": kind, "competition_id": None,
                        "label": src.get("label"), "_parent_url": url})
    return out


def source_competition(sb: Supabase, plat, src: dict, league_id: str, ac: dict) -> dict:
    """The competition this source's games belong to: the DB row's, else the feed's phase for
    this source (name + kind), else the league's default competition (the source label)."""
    if src.get("competition_id"):
        return {"id": src["competition_id"]}
    if src.get("competition_label"):
        comp = plat.ensure_competition(league_id, src["competition_label"], ac.get("season"), src.get("competition_kind"))
    else:
        comp = plat.ensure_competition(league_id, src.get("label") or src.get("code") or "League", ac.get("season"))
    src["competition_id"] = comp["id"]
    if src.get("id"):
        try:
            sb.patch("schedule_sources", f"id=eq.{src['id']}", {"competition_id": comp["id"]})
        except Exception:
            pass
    set_competition_format(sb, src, comp["id"])
    return comp


_FORMAT_SET: set = set()


def set_competition_format(sb: Supabase, src: dict, comp_id: str) -> None:
    """A source that plays in groups or conferences says so (groups.py), and its competition is
    given that format once per run: 'groups' (0018) draws a table per group, 'conferences' (0144)
    a table per conference with the conference record beside the overall one. A source that says
    nothing leaves the competition exactly as it is - including a format set in the console."""
    fmt = groups.competition_format(src)
    if not fmt or comp_id in _FORMAT_SET:
        return
    _FORMAT_SET.add(comp_id)
    try:
        cur = sb.select("competitions", f"id=eq.{comp_id}&select=format")
        if cur and cur[0].get("format") != fmt:
            sb.patch("competitions", f"id=eq.{comp_id}", {"format": fmt})
            print(f"   competition format -> {fmt}")
    except Exception as exc:
        # 'conferences' is refused by the format check until 0144 is applied
        print(f"   ! could not set the competition's format to {fmt} ({exc}) - is migration 0144 applied?")


def group_fields(src: dict, *names: str) -> dict:
    """{group_name, division_name} for a club's entry in this source's competition, or {} for a
    source without a groups file (groups.py)."""
    ac = src.get("adapter_config") or {}
    return groups.entry(src, ac.get("season") or season_name_for(), *names)


def enter_teams(sb: Supabase, src: dict, comp_id: str, pairs, run: dict) -> None:
    """Enter clubs in the competition - once per club per run - with their group and division
    where the source has a groups file. pairs: ((team row, the name the feed used), ...)."""
    done = run.setdefault("_entered", set())
    spec = groups.spec_for(src)
    current = None
    if spec:
        # the competition's entries as they stand, read once per run, so a club already filed where
        # the file says costs no write - and one that moves group triggers a recompute, because a
        # standings row carries its group only from the last rebuild
        cache = run.setdefault("_entries", {})
        if comp_id not in cache:
            cols = "team_id,group_name" + (",division_name" if groups.has_divisions(spec) else "")
            try:
                cache[comp_id] = {r["team_id"]: r for r in sb.select("competition_teams", f"competition_id=eq.{comp_id}&select={cols}")}
            except Exception:
                cache[comp_id] = {}
        current = cache[comp_id]
    for tm, fed in pairs:
        if not tm or (comp_id, tm["id"]) in done:
            continue
        done.add((comp_id, tm["id"]))
        fields = group_fields(src, fed, tm.get("name") or "")
        if current is not None:
            have = current.get(tm["id"])
            if have is not None and all(have.get(k) == v for k, v in fields.items()):
                continue
        sb.upsert("competition_teams", {"competition_id": comp_id, "team_id": tm["id"], **fields},
                  "competition_id,team_id")
        if current is not None and fields:
            current[tm["id"]] = {"team_id": tm["id"], **fields}
            run.setdefault("_recompute", set()).add(comp_id)


def default_competition_id(plat, src: dict, league_id: str, ac: dict) -> str | None:
    """The league's catch-all competition (named after the source), if it exists - the one games
    were filed under before the feed's phases were known."""
    try:
        s = plat.season(league_id, ac.get("season") or season_name_for())
        r = plat.one("competitions", f"season_id=eq.{s['id']}&name=eq.{src.get('label') or src.get('code')}&select=id")
        return r["id"] if r else None
    except Exception:
        return None


def sync_logos(sb: Supabase, src: dict, games: list, run: dict) -> None:
    """Every club on the schedule gets its crest from the schedule page itself (both sides of every
    fixture carry one), so a club's logo is on the site before its first game is fetched."""
    league_id = resolve_league(sb, src, run)
    if not league_id or not games:
        return
    plat = run["_platform"]
    seen = set(); n = 0
    for g in games:
        for side in ("home", "away"):
            code = (g.extra or {}).get(f"{side}_code"); logo = (g.extra or {}).get(f"{side}_logo")
            name = g.home_name if side == "home" else g.away_name
            # A CREST WITHOUT A CODE STILL BELONGS TO A CLUB. Some sites name no club code
            # anywhere -- the Czech NBL's schedule is one -- and their clubs were created under
            # the slug of their own name, which is feedplatform's fallback when `code` is blank.
            # Requiring a code here meant those crests were simply dropped, so the league had
            # neither a badge nor (a crest being where a colour comes from) a colour. The name
            # is passed through alone and Platform.team() does the same slug it did when it
            # created the club, so the crest lands on the row that is already there.
            key = code or ("name:" + (name or "").strip().lower())
            if not logo or not (code or name) or key in seen:
                continue
            seen.add(key)
            try:
                before = plat.cache["team"].get((league_id, code), {}) or {} if code else {}
                t_in = {"name": name, "logoT": {"url": logo}}
                if code:
                    t_in["code"] = code
                t = plat.team(league_id, t_in)
                if t and t.get("logo_path") == logo and before.get("logo_path") != logo:
                    n += 1
            except Exception:
                continue
    if n:
        print(f"   {n} club crest(s) taken from the schedule")
    # THE CREST SAYS WHAT COLOUR THE CLUB IS. Every team with a crest and no colour of its own
    # (colour_source 'default': never coloured, or its crest just changed) is read now; a team
    # already coloured from its crest, or by an admin, is left alone. Pillow or (for an SVG
    # crest) cairosvg/libcairo missing -> that team is skipped, not the whole sweep.
    # THE FANS' DIARY. A club's followers hear three days before it plays and again on the day
    # (notify_fixtures, 0106); the notify function then emails and pushes what is waiting.
    try:
        k = sb.rpc('notify_fixtures')
        if k:
            print(f"   {k} fixture reminder(s) written")
        sb.function('notify', {})
    except Exception as exc:
        print(f"   (notifications: {exc})")
    try:
        import team_colours
        c = team_colours.sweep(sb, log=lambda m: print(m))
        if c:
            print(f"   {c} club(s) coloured from their crest")
    except ImportError as exc:
        print(f"   (colours: {exc})")
    except Exception as exc:
        print(f"   (colours: {exc})")


def refile_from_catchall(sb: Supabase, src: dict, games: list, run: dict) -> None:
    """Games this phase's schedule lists that still sit in the league's catch-all competition (filed
    there before the feed's phases were known) move to the phase - fixtures and finished games alike.
    Discovery skips games it already holds, so this is a pass of its own. A game an administrator
    has placed in any OTHER competition is left exactly where it is."""
    if not src.get("competition_label") or not games:
        return
    league_id = resolve_league(sb, src, run)
    if not league_id:
        return
    plat = run["_platform"]; ac = src.get("adapter_config") or {}
    comp_id = source_competition(sb, plat, src, league_id, ac)["id"]
    dflt = default_competition_id(plat, src, league_id, ac)
    if not dflt or dflt == comp_id:
        return
    ids = [str(g.external_id) for g in games]
    game_ids: list[str] = []
    for i in range(0, len(ids), 100):
        try:
            rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=in.({','.join(ids[i:i + 100])})&game_id=not.is.null&select=game_id")
            game_ids += [r["game_id"] for r in rows if r.get("game_id")]
        except Exception:
            continue
    moved = 0; team_ids: set = set()
    for i in range(0, len(game_ids), 100):
        try:
            rows = sb.select("games", f"id=in.({','.join(game_ids[i:i + 100])})&competition_id=eq.{dflt}&select=id,home_team_id,away_team_id")
        except Exception:
            continue
        for r in rows:
            try:
                sb.patch("games", f"id=eq.{r['id']}", {"competition_id": comp_id})
                moved += 1; team_ids.update({r.get("home_team_id"), r.get("away_team_id")})
            except Exception:
                continue
    for tid in team_ids:
        if tid:
            try:
                sb.upsert("competition_teams", {"competition_id": comp_id, "team_id": tid}, "competition_id,team_id")
            except Exception:
                pass
    if moved:
        run.setdefault("_recompute", set()).update({dflt, comp_id})
        print(f"   {moved} game(s) filed under {src['competition_label']} (were in the catch-all)")


def sync_videos(sb: Supabase, src: dict, games: list, run: dict) -> None:
    """Recent games this schedule lists that have no video yet get their broadcast looked up on the
    league's channel (upcoming streams are scheduled days ahead, so a fixture can carry its stream
    before tip); rows attached earlier get their anchor completed once the stream has started."""
    ac = src.get("adapter_config") or {}
    if not ac.get("youtube_channel") and not os.environ.get("YOUTUBE_API_KEY"):
        return
    try:
        from auto_video import attach as attach_video, complete as complete_video
    except Exception:
        return
    now = datetime.now(timezone.utc)
    recent = []
    for g in games:
        if not g.tipoff_at:
            continue
        try:
            t = datetime.fromisoformat(str(g.tipoff_at).replace("Z", "+00:00"))
        except ValueError:
            continue
        if -14 * 86400 <= (now - t).total_seconds() <= 4 * 86400:
            recent.append(g)
    if not recent:
        return
    ids = [str(g.external_id) for g in recent]
    by_ext = {}
    for i in range(0, len(ids), 100):
        try:
            for r in sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=in.({','.join(ids[i:i + 100])})&game_id=not.is.null&select=external_id,game_id"):
                by_ext[str(r["external_id"])] = r["game_id"]
        except Exception:
            continue
    n_att = n_done = 0
    for g in recent:
        gid = by_ext.get(str(g.external_id))
        if not gid:
            continue
        try:
            if attach_video(sb, gid, g.home_name, g.away_name, g.tipoff_at, ac, log=lambda *a: None):
                n_att += 1
            elif complete_video(sb, gid, log=lambda *a: None):
                n_done += 1
        except Exception:
            continue
    if n_att or n_done:
        print(f"   videos: {n_att} attached, {n_done} anchored")


def write_fixture(sb: Supabase, src: dict, g: ScheduleGame, run: dict) -> None:
    """A scheduled game (no payload yet) becomes an Epinoia fixture with its date and venue, so the
    fixtures page shows what is coming. Clubs are matched by code/name; unknown clubs wait for the payload."""
    league_id = resolve_league(sb, src, run)
    if not league_id or not (g.home_name and g.away_name):
        return
    ac = src.get("adapter_config") or {}
    plat = run["_platform"]
    comp_id = source_competition(sb, plat, src, league_id, ac)["id"]
    ex = g.extra or {}
    home = plat.team(league_id, {"name": g.home_name, "code": ex.get("home_code") or ""})
    away = plat.team(league_id, {"name": g.away_name, "code": ex.get("away_code") or ""})
    if not (home and away):
        return
    existing = sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{g.external_id}&select=game_id")
    game_id = existing[0]["game_id"] if existing and existing[0].get("game_id") else None
    row = {"tipoff_at": g.tipoff_at, "venue": ex.get("venue")}
    # WHETHER THIS GAME COUNTS IN THE CONFERENCE TABLE (0144), when the adapter knows: False for a
    # conference playoff (two members of one conference, not a conference game), True/False where
    # the feed flags it. Absent = the database works it out from the clubs' groups. Kept out of
    # `row`, whose filter drops falsy values - and False is exactly the value that matters here.
    conf = {"conference_game": ex["conference_game"]} if "conference_game" in ex else {}
    if game_id:
        cur = sb.select("games", f"id=eq.{game_id}&select=status,tipoff_at,venue" + (",conference_game" if conf else ""))
        if cur and cur[0].get("status") in ("scheduled", None) and (cur[0].get("tipoff_at") != g.tipoff_at or (ex.get("venue") and cur[0].get("venue") != ex.get("venue"))):
            sb.patch("games", f"id=eq.{game_id}", {k: v for k, v in row.items() if v})
        if conf and cur and cur[0].get("conference_game") != conf["conference_game"]:
            # a game the schedule has since re-labelled; a finished one moves two tables
            sb.patch("games", f"id=eq.{game_id}", conf)
            if cur[0].get("status") == "final":
                run.setdefault("_recompute", set()).add(comp_id)
        if groups.spec_for(src):
            # a club already entered still takes a group the file has since learnt
            enter_teams(sb, src, comp_id, ((home, g.home_name), (away, g.away_name)), run)
        return
    gm = sb.upsert("games", {"competition_id": comp_id, "home_team_id": home["id"], "away_team_id": away["id"], "status": "scheduled", **{k: v for k, v in row.items() if v}, **conf}, "id")
    if src.get("competition_label") and gm and gm[0].get("competition_id") not in (None, comp_id):
        dflt = default_competition_id(plat, src, league_id, ac)
        if dflt and gm[0]["competition_id"] == dflt:
            sb.patch("games", f"id=eq.{gm[0]['id']}", {"competition_id": comp_id})
            run.setdefault("_recompute", set()).update({dflt, comp_id})
    enter_teams(sb, src, comp_id, ((home, g.home_name), (away, g.away_name)), run)
    sb.upsert("external_games", {"adapter": src["adapter"], "external_id": g.external_id, "competition_code": src["code"], "game_id": gm[0]["id"],
                                 "home_name": g.home_name, "away_name": g.away_name, "external_status": "scheduled",
                                 "tipoff_at": g.tipoff_at, "game_date": (g.tipoff_at or "")[:10] or None}, "adapter,external_id")
    run["fixtures"] = run.get("fixtures", 0) + 1


def match_team_id(sb: Supabase, league_id: str, name: str, cache: dict) -> str | None:
    key = (league_id, name.strip().lower())
    if key in cache:
        return cache[key]
    rows = sb.select("teams", f"league_id=eq.{league_id}&select=id,name,aliases")
    for r in rows:
        names = {r["name"].strip().lower()} | {a.strip().lower() for a in (r.get("aliases") or [])}
        if name.strip().lower() in names:
            cache[key] = r["id"]; return r["id"]
    cache[key] = None
    return None


def enqueue_video_job(sb: Supabase, game_id: str) -> bool:
    """Queue the footage of a final game for the vision worker, once. Needs a primary video with a
    link, no clock track yet, and no job for the game that is waiting, running, or already done
    (a failed or cancelled job is retried once by the ingest; after that the button on the page is
    the way). Returns True when a row was written. Needs migration 0100."""
    vids = sb.select("game_videos", f"game_id=eq.{game_id}&is_primary=eq.true&select=url,clock_track&limit=1")
    if not vids or not vids[0].get("url") or vids[0].get("clock_track"):
        return False
    jobs = sb.select("video_jobs", f"game_id=eq.{game_id}&select=status,video_url&order=requested_at.desc&limit=3")
    # a job counts against the footage it was for; a different video pasted over (0115 clears
    # the old track) is new footage and gets its own read
    jobs = [j for j in jobs if j.get("video_url") == vids[0]["url"]]
    if any(j.get("status") in ("queued", "claimed", "running", "done") for j in jobs):
        return False
    if len([j for j in jobs if j.get("status") in ("failed", "cancelled")]) >= 2:
        return False
    sb.insert("video_jobs", {"game_id": game_id, "video_url": vids[0]["url"], "mode_requested": "auto",
                             "requested_via": "ingest"})
    print("    + queued for the vision worker (AI process game)")
    return True


_CLOCK_SEEN: dict = {}      # game_id -> (clock_ms at the last read, when), for the running flag under the heartbeat


def _clock_ms(text) -> int | None:
    """"9:45" or "00:51:40" (mm:ss:cc) -> milliseconds remaining. None when it is not a clock."""
    parts = str(text or "").strip().split(":")
    if len(parts) < 2:
        return None
    try:
        return (int(parts[0]) * 60 + int(float(parts[1]))) * 1000
    except (TypeError, ValueError):
        return None


def _clock_from_log(actions) -> int | None:
    """The clock at the furthest point the log has reached.

    NOT "the last row in the list". The order a feed hands its actions over in is not something
    to rely on (see docs: the pbp-ordering trap), so this asks the question by value: the highest
    period, and within it the least time remaining. A log that arrives reversed, or with a
    correction appended out of order, gives the same answer."""
    best = None
    for a in actions or []:
        ms = _clock_ms(a.get("gt"))
        if ms is None:
            continue
        key = (int(a.get("period") or 0), -ms)
        if best is None or key > best[0]:
            best = (key, ms)
    return best[1] if best else None


def _period_over(raw: dict, period: int) -> bool:
    """Has the log's last period been played to its end?

    Two ways a feed says so, and neither is its clock: the operator's own "period end" action for
    that period, or the feed's own `period` already past it (LiveStats moves it on when a period
    ends, before any action of the next one exists). An adapter that rebuilds the payload from its
    own back end sets `period` from the log it built, so there it can never be ahead."""
    try:
        for a in raw.get("pbp") or []:
            if (str(a.get("actionType") or "").lower() == "period" and str(a.get("subType") or "").lower() == "end"
                    and period_of(a) == period):
                return True
        return period_of(raw) > period
    except (TypeError, ValueError):
        return False


def write_platform(sb: Supabase, src: dict, b: GameBundle, run: dict, observed: tuple | None = None,
                   stamps: dict | None = None) -> bool:
    """games + game_advanced (+ event log) for the Epinoia site — only when the source names a league.
    A league connected from the console (auto_create) has its clubs / players / rosters created
    from the payload the first time they appear; a hand-mapped league only matches, never invents."""
    ac = src.get("adapter_config") or {}
    league_id = resolve_league(sb, src, run)
    plat = run["_platform"]
    if not league_id or b.raw is None:
        return False
    comp = source_competition(sb, plat, src, league_id, ac)
    srow = sb.select("competitions", f"id=eq.{comp['id']}&select=season_id")
    season_id = srow[0]["season_id"] if srow else None
    people = plat.ensure_game_people(league_id, comp, season_id, b.raw,
                                     group_of=(lambda *n: group_fields(src, *n)) if groups.spec_for(src) else None)
    home, away = people.get("1"), people.get("2")
    if not (home and away):
        sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}",
                 {"error": f"unmatched team: {'' if home else b.home_name} {'' if away else b.away_name}".strip()})
        print(f"    !! unmatched team for {b.home_name} v {b.away_name} - add an alias in public.teams.aliases")
        return False
    existing = sb.select("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}&select=game_id")
    game_id = existing[0]["game_id"] if existing and existing[0].get("game_id") else None
    will_translate = src["adapter"] in TRANSLATABLE_ADAPTERS and ac.get("translate", True)
    # a game we are about to translate stays 'live' until finalise-game closes it — 'final' means
    # "log closed" to the platform (insert trigger refuses events, finalise refuses a second pass)
    status = ("live" if will_translate else "final") if b.status == "final" else ("live" if b.status == "live" else "scheduled")
    scores = {"home_score": int(b.team["home"].get("points", 0)), "away_score": int(b.team["away"].get("points", 0))}
    if not game_id:
        g = sb.upsert("games", {"competition_id": comp["id"], "home_team_id": home["id"], "away_team_id": away["id"],
                                "tipoff_at": b.tipoff_at, "status": status, **scores}, "id")
        game_id = g[0]["id"]
    else:
        cur = sb.select("games", f"id=eq.{game_id}&select=status,tipoff_at,competition_id")
        extra = {"tipoff_at": b.tipoff_at} if (b.tipoff_at and cur and cur[0].get("tipoff_at") != b.tipoff_at) else {}
        # A game filed under the league's catch-all competition before the feed's phases were known
        # moves to the phase this source is (Trophy, League, playoffs). A game an administrator has
        # already placed somewhere specific is never touched - only the catch-all is.
        if src.get("competition_label") and cur and cur[0].get("competition_id") not in (None, comp["id"]):
            dflt = default_competition_id(plat, src, league_id, ac)
            if dflt and cur[0]["competition_id"] == dflt:
                extra["competition_id"] = comp["id"]
                run.setdefault("_recompute", set()).update({dflt, comp["id"]})
                print(f"    -> filed under {src['competition_label']}")
        if cur and cur[0].get("status") == "final" and will_translate:
            # marked final without a scored log (an earlier run inserted it closed) → reopen it
            n_ev = sb.select("game_events", f"game_id=eq.{game_id}&select=seq&limit=1")
            if not n_ev:
                sb.patch("games", f"id=eq.{game_id}", {"status": "live", **scores, **extra})
            elif extra:
                sb.patch("games", f"id=eq.{game_id}", extra)
        elif cur and cur[0].get("status") == "final":
            if extra:
                sb.patch("games", f"id=eq.{game_id}", extra)
        else:
            sb.patch("games", f"id=eq.{game_id}", {"status": status, **scores, **extra})
    # THE BROADCAST, for a game being played or just finished: linked the moment the game is first
    # seen (so the page carries the stream while the game is on), and its anchor completed whenever
    # a stream start or a tip has since become known - whether or not the log is still open.
    if b.status in ("live", "final"):
        try:
            from auto_video import attach as attach_video, complete as complete_video
            if not attach_video(sb, game_id, b.home_name, b.away_name, b.tipoff_at, ac):
                complete_video(sb, game_id)
        except Exception as exc:
            print(f"    (auto video: {exc})")
    # AI PROCESS GAME, with nobody pressing anything: a final game with a stream attached and no
    # clock track yet is queued for the PC worker (scripts/worker/ai_worker.py), which reads the
    # clock or the score off the footage and places every play. A league can turn this off with
    # adapter_config.auto_process_video = false. docs/ai-process-game-roadmap.md, Phase 4.
    if b.status == "final" and ac.get("auto_process_video", True):
        try:
            enqueue_video_job(sb, game_id)
        except Exception as exc:
            print(f"    (auto process: {exc})")
    sb.upsert("game_advanced", {"game_id": game_id, "external_id": b.external_id, "adapter": src["adapter"], "status": b.status,
                                "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
                                "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition,
                                "pbp": b.pbp if ac.get("store_pbp") else None, "computed_at": now_iso()}, "game_id")
    sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}", {"game_id": game_id, "ingested_at": now_iso(), "error": None})
    if will_translate:
        try:
            write_event_log(sb, src, b, game_id, people["pids"], observed, stamps)
        except Exception as exc:
            print(f"    (event translation failed: {exc})")
    try:
        sb.rpc("refresh_feed_team_season", {"p_competition": comp["id"]})
    except Exception as exc:
        print(f"    (season roll-up skipped: {exc})")
    return True


def _elapsed_ms(row: dict) -> int:
    """How much basketball had been played by this row, from its period and the clock left in it."""
    try:
        per = max(1, int(row.get("period") or 1))
        clock = max(0, int(row.get("clock") or 0))
    except Exception:
        return 0
    played = 0
    for q in range(1, per):
        played += 600_000 if q <= 4 else 300_000
    full = 600_000 if per <= 4 else 300_000
    return played + max(0, full - min(full, clock))


def _same_row(e: dict, r: dict) -> bool:
    """Does a stored game_events row already hold exactly what this translation would write?
    Every column the ingest writes, the payload whole (so a stamp that moved is a change)."""
    return (e.get("seq") == r.get("seq") and e.get("t") == r.get("t") and e.get("team") == r.get("team")
            and e.get("pid") == r.get("pid") and e.get("period") == r.get("period") and e.get("clock") == r.get("clock")
            and (e.get("payload") or {}) == (r.get("payload") or {}))


def _iso_ms(s) -> int | None:
    try:
        return int(datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000) if s else None
    except Exception:
        return None


def discovery_observed(b, t_obs: float, every_s: float) -> tuple | None:
    """`observed` for a write made by the discovery lane, or None.

    A LIVE GAME IS TIMED WHICHEVER LANE SEES IT. Only live_keeper used to pass
    `observed`, so every row the half-hourly discovery pass wrote for a live game went
    in unstamped - and could never be stamped afterwards, because the live lane's next
    poll finds the log already that long and stamps only rows past it. When discovery
    was the first to see a game at all, the unstamped row was the TIP, and without a tip
    stamp auto_video writes no tip_wall and the whole game falls back to insert times.
    That is not rare: GitHub drops scheduled runs, and on 2026-09-12 none fired between
    17:48 and 19:22 UTC.

    Same shape as live_keeper's: the poll instant, and the configured interval plus the
    fetch as the error. write_event_log widens that to what the log itself knows, and
    declines past three minutes, so a lane that last saw this game half an hour ago
    stamps nothing it cannot bound. Finished and scheduled games get nothing: a backfill
    has no moment of observation worth the name.

    BOTH LANES STAMP ON THE SAME CLOCK. The live lane stamps with the response's
    Last-Modified (docs/feed-timing.md, step 1), which is on average 13 s earlier than
    receive time. This lane writes the same live games during the live pass (it never
    skips one), so if it kept receive time, a live-lane tail following a discovery write
    would find a newest wall LATER than its own stamp: `real` goes negative and the bar
    collapses to the configured interval, confidently, for every row of that batch. So
    this uses the same version_stamp, and receive time only for a bundle that carries no
    feed timing at all (another adapter)."""
    if getattr(b, "status", None) != "live":
        return None
    lm, recv = getattr(b, "feed_lm_ms", None), getattr(b, "feed_recv_ms", None)
    at = feedstamp.version_stamp(lm, recv, None)["stamp_ms"] if recv is not None else int(t_obs * 1000)
    return (at, int((every_s + (time.time() - t_obs)) * 1000))


def within_stamp(rows: list, stamp: dict | None) -> list:
    """The rows of one write that a single poll stamp can honestly cover.

    ONE STAMP CANNOT COVER MORE GAME THAN ITS ERROR BAR. Real time between two plays is
    never less than the game time between them, so a row keyed more than wall_err of game
    clock before the latest row in the same write happened more than wall_err before this
    poll, and the poll's instant is not its time. Those rows are left unstamped (the page
    interpolates them, marked approximate); the rest take the stamp as before.

    2026-09-12, measured against the footage: the old delete-then-insert rewrite lost
   its later batches, the next poll re-added 348 plays (a40d3cef) and 541 plays
   (8d63f891) as "new", and every one of them got that poll's instant with a
   10.5 s bar -- first-quarter plays placed up to 78 minutes late, confidently.
    In ordinary running a write holds the plays since the last poll, which span no more
    game than the poll gap the bar was widened to, so nothing changes there. The 3 s is a
    clock keyed in whole seconds plus a statistician's reaction."""
    if not stamp or not rows:
        return []
    err = int(stamp.get("wall_err") or 0)
    latest = max(_elapsed_ms(r) for r in rows)
    return [r for r in rows if latest - _elapsed_ms(r) <= err + 3000]


def _same_row(e: dict, r: dict) -> bool:
    """Does a stored game_events row already hold exactly what this translation would write?
    Every column the ingest writes, the payload whole (so a stamp that moved is a change)."""
    return (e.get("seq") == r.get("seq") and e.get("t") == r.get("t") and e.get("team") == r.get("team")
            and e.get("pid") == r.get("pid") and e.get("period") == r.get("period") and e.get("clock") == r.get("clock")
            and (e.get("payload") or {}) == (r.get("payload") or {}))


def first_write_stamp(rows: list, stamp: dict | None, fresh_ms: int = 90_000) -> dict | None:
    """Whether a game's FIRST write may carry the poll stamp, and with what error.

    THE FIRST WRITE IS THE ONE THAT CARRIES THE TIP, and the tip is the row everything
    else is measured against: auto_video reads its payload.wall to set tip_wall, and
    epinoia/video.js needs BOTH an event's wall and tip_wall before it will use the
    device clock at all. So a tip with no stamp does not cost one play — it turns the
    whole game back to insert times, for every clip and every highlight.

    But a first write can just as easily be a game the lane only found at half-time,
    forty minutes of plays arriving in one batch. Stamping those with `now` would put
    every one of them on the same frame and say so confidently.

    The log itself tells us which it is: if the last row is only a couple of minutes
    into the first period, everything in the batch happened within the last couple of
    minutes and `now` is a fair stamp for all of it. The error bar is widened to say
    exactly how fair — the poll's own error plus however much game the batch spans —
    and epinoia/game/video.js already surfaces the worst of those to the person
    deciding whether a clip is worth cutting.

    Note that a stamp which is slightly LATE costs nothing in placement: tip_at is
    derived from tip_wall, so the same error lands in the gap and in the offset from
    tip, and cancels. What must not happen is a batch wide enough that its rows
    disagree with each other, which is what fresh_ms bounds.

    Ninety seconds, because epinoia/game/video.js reports the WORST error in the log as
    the game's accuracy, and a generous bound here would let one early batch speak for a
    game that is otherwise timed to ten seconds."""
    if not stamp or not rows:
        return None
    span = _elapsed_ms(rows[-1])
    if span > fresh_ms:
        return None
    out = dict(stamp)
    out["wall_err"] = int(stamp.get("wall_err") or 0) + int(span)
    return out


def write_event_log(sb: Supabase, src: dict, b: GameBundle, game_id: str, pids: dict, observed: tuple | None = None,
                    stamps: dict | None = None) -> None:
    """Translate the FIBA payload into game_events and finalise the game (roadmap Phase B).
    `pids` maps "<teamcode>:<pno>" -> players.id (from Platform.ensure_game_people).
    `observed` = (epoch_ms, err_ms): WHEN THIS POLL SAW THE FEED, and how far back the play could
    really have happened (the poll interval + fetch time). The Genius payload carries no time of
    day for a play, so the only clock that saw it happen is ours. New events get payload.wall =
    epoch_ms (the device-stamp slot epinoia/video.js already prefers) and payload.wall_err =
    err_ms, which is what places a fed game's plays in a video - see
    docs/video-livestats-sync-roadmap.md, Phase 0. Backfilled logs get no stamp: their created_at
    is the import, and the page's timed-log test correctly refuses to anchor a video to them.
    `stamps` = the live lane observer's per-action memory ({actionNumber: [hi, lo] | None},
    docs/feed-timing.md step 3): when given, a play is stamped by the version it first appeared
    in, pulled by the game clock, and the poll stamp only covers what memory cannot."""
    tm = b.raw.get("tm") or {}
    codes = {0: (tm.get("1") or {}).get("code", ""), 1: (tm.get("2") or {}).get("code", "")}
    missing = set()

    def pid_for(team, pno):
        key = f"{codes[team]}:{pno}"
        if key in pids:
            return pids[key]
        missing.add(key)
        return f"{team}:{pno}"

    T = translate(b.raw, pid_for)
    if missing:
        print(f"    ! {len(missing)} players without a platform id: {sorted(missing)[:6]}…")
    g = sb.select("games", f"id=eq.{game_id}&select=status")
    if g and g[0].get("status") == "final":
        return                                              # a finalised log is closed (insert trigger refuses)
    # A GAME IS NOT LIVE BECAUSE SOMEBODY OPENED THE SCORING APP.
    #
    # This said 'live' the moment the feed published, which for LiveStats is when the
    # table opens the game — squads entered, starting five confirmed, ball not yet up.
    # Every listing, strip and game page then showed a live 0-0 with a running clock
    # for a fixture that had not started, which is the same fault epinoia/score/sync.js
    # calls out and refuses on the scorer's side ("A GAME IS NOT LIVE UNTIL IT HAS
    # TIPPED"). The two paths now agree.
    #
    # The roster and the starting five are still written straight away, because that is
    # the genuinely useful thing about a feed publishing early: the preview can show who
    # is starting before the ball goes up. One action in the log flips it to live, and
    # LiveStats emits from the jump ball, so the flip lands within a poll.
    # Deliberately generous about what counts as started, because the two mistakes are
    # not symmetrical: showing a preview for a minute longer than necessary costs
    # nothing, and showing a fixture as scheduled while it is being played is the fault
    # this change would otherwise introduce. A log with anything in it, a score on the
    # board, or a period past the first — any one of them and the ball has gone up.
    has_play = bool(T["events"]) or bool(T["home_score"]) or bool(T["away_score"]) or (T["period"] or 1) > 1
    sb.patch("games", f"id=eq.{game_id}", {"roster_snapshot": T["roster_snapshot"], "starters": T["starters"],
                                           "tip_winner": T["tip_winner"], "arrow_init": T["arrow_init"], "period": T["period"],
                                           "status": "live" if has_play else "scheduled"})
    rows = game_rows(game_id, T["events"])
    # LIVE GAMES GROW: if the existing log is a prefix of the new one, append only the tail — the
    # game page's gap check (last_seq) then pulls just the new rows, like a scorer's frames.
    existing = sb.select("game_events", f"game_id=eq.{game_id}&select=seq,t,team,pid,period,clock,payload,created_at&order=seq")
    same_prefix = len(existing) <= len(rows) and all(
        e["seq"] == r["seq"] and e["t"] == r["t"] and e.get("team") == r["team"] and e.get("pid") == r["pid"] and e["period"] == r["period"] and e["clock"] == r["clock"]
        for e, r in zip(existing, rows))
    # THE ERROR BAR IS WHAT THE LOG SAYS IT IS, NOT WHAT THE SCHEDULE HOPED.
    #
    # observed[1] is built in live_keeper as the CONFIGURED interval plus this
    # fetch's duration. The comment there is right about what it means - "a play
    # in this payload happened between the previous poll and this fetch" - and
    # the arithmetic does not implement it: the previous poll of THIS game was
    # not `every` seconds ago. live_keeper walks the due set in one serialised
    # for-loop, doing a fetch and then the whole of write_platform per game
    # before sleeping, so the real spacing is a function of how many games are
    # live.
    #
    # Measured on 2026-09-12 across four simultaneous live games, 46 intervals:
    # median 37.9 s against a claimed 10.5 s, and 40 of the 46 wider than
    # claimed, the worst by 18.9x (198.5 s real against 10.5 s claimed). Every
    # row of that poll's batch is stamped with the poll's instant, so the
    # earliest play in a batch is that far EARLIER than its stamp - and
    # epinoia/video.js spends wall_err as run-up when it cuts a clip, so an
    # understated bar puts the play in front of its own clip window. The page
    # also prints it: "plays placed to within +/-N s".
    #
    # No new bookkeeping is needed to fix it, because the log already knows. Every
    # stamped row carries the instant of the poll that wrote it, so the newest
    # wall in the existing log IS when this game was last polled - which also
    # covers the case the loop could never know about, a pass handover, where the
    # previous poll belongs to a process that has already exited.
    stamp = None
    if observed and observed[1] is not None:
        err = int(observed[1])
        newest = max((int((e.get("payload") or {}).get("wall")) for e in existing
                      if (e.get("payload") or {}).get("wall") is not None), default=None)
        # NO ROW STAMPED IS NOT NOTHING KNOWN. A log written by a lane that passed no
        # `observed` (or rewritten unstamped) still records when it was last written, and
        # every play in this tail arrived after that write saw the feed. So the latest
        # created_at bounds the error the same way the newest wall does - loosely, never
        # tightly: a carried row keeps its older created_at, which only widens the bar.
        # Without it, a tail on an unstamped log took the configured interval as its bar
        # however long ago the log was actually written.
        if newest is None:
            newest = max((ms for ms in (_iso_ms(e.get("created_at")) for e in existing) if ms is not None),
                         default=None)
        if newest is not None:
            real = int(observed[0]) - newest
            if real > err:
                err = real
        # Past three minutes nothing here can honestly bound when the play
        # happened, and an unstamped row is better than a confidently wrong one:
        # video.js interpolates it from its neighbours and marks it approximate.
        if err <= 180_000:
            stamp = {"wall": int(observed[0]), "wall_err": err}
    # MEMORY STAMPS (docs/feed-timing.md, step 3). A poll stamp is one instant for a whole batch:
    # every row it covers gets the moment this write's version was uploaded, and an error bar
    # back to the last write. The live lane's observer knows better for most plays - it looked
    # every few seconds, so it knows the version each action FIRST appeared in, and within that
    # version the game clock says how much earlier than the upload the play must have been.
    # feedstamp.row_stamp turns that memory into a verdict per row:
    #   mem      the row takes memory's wall and wall_err, in either write path, and over a
    #            carried stamp (memory is write-once, so a stamp carried FROM memory is the
    #            same value; one carried from anything else is the worse of the two);
    #   decline  a late entry - its upload says when it was typed, not when it happened - is
    #            left unstamped, and the poll stamp may not cover it either (a carried stamp
    #            it already has is kept: nothing here ever un-times a row);
    #   none     what memory cannot place (the first version this process saw, the sub the
    #            translator invents, a window past three minutes such as the tip against a
    #            pre-game upload) - today's logic, poll stamp, within_stamp and all.
    # REFILL: an existing row with no wall at all that memory CAN place (the discovery lane
    # wrote it, or a bar too wide to claim) sends the write down the rewrite branch, which
    # replaces the log from the first row that changes. Only rows with no wall trigger it, so
    # once refilled it never churns; poll stamps other writers left are not "upgraded".
    #
    # EPINOIA_STAMPS (a repository variable): unset or "on" writes them; "shadow" works them
    # out and prints what it would have done next to the poll stamp, writing exactly what it
    # would without them; "off" - or anything unrecognised, so a typo fails safe - skips them.
    #
    # EVERYTHING THAT CAN THROW IS INSIDE THE TRY. write_platform swallows this function's
    # exceptions and live_keeper marks the payload hash written regardless, so a raise here
    # would freeze a live log with nothing in the run log but one line. On any failure the log
    # is written exactly as it was before memory existed.
    mem, declined, refill = {}, set(), False
    stamps_mode = {"": "on", "on": "on", "1": "on", "true": "on", "shadow": "shadow"}.get(
        os.environ.get("EPINOIA_STAMPS", "").strip().lower(), "off")
    if stamps and stamps_mode in ("on", "shadow"):
        try:
            for ev in T["events"]:
                kind, val = feedstamp.row_stamp(ev.get("_ans"), stamps)
                if kind == "mem":
                    mem[ev["seq"]] = val
                elif kind == "decline":
                    declined.add(ev["seq"])
            refill = bool(same_prefix and any(e["seq"] in mem and (e.get("payload") or {}).get("wall") is None for e in existing))
            if stamps_mode == "shadow":
                start = len(existing) if (existing and same_prefix and not refill) else 0
                new_mem = [mem[r["seq"]] for r in rows[start:] if r["seq"] in mem]
                lead = sorted((stamp["wall"] - m["wall"]) / 1000 for m in new_mem) if stamp else []
                errs = sorted(m["wall_err"] / 1000 for m in new_mem)
                detail = ([f"median {lead[len(lead) // 2]:.1f} s before the poll stamp"] if lead else []) + \
                         ([f"median bar {errs[len(errs) // 2]:.1f} s"] if errs else [])
                n_refill = sum(1 for e in existing if e["seq"] in mem and (e.get("payload") or {}).get("wall") is None)
                print(f"    ~ feedstamp shadow: {len(new_mem)} of {len(rows) - start} rows by memory"
                      + (f" ({', '.join(detail)})" if detail else "")
                      + f", {sum(1 for s in declined if s > start)} declined, {n_refill} to refill; poll {stamp}")
                mem, declined, refill = {}, set(), False
        except Exception as exc:
            print(f"    ! feedstamp: {exc!r} - today's stamps")
            mem, declined, refill = {}, set(), False
    if existing and same_prefix and not refill:
        tail = rows[len(existing):]
        for r in tail:
            if r["seq"] in mem:
                r["payload"] = {**(r.get("payload") or {}), **mem[r["seq"]]}
        if stamp:
            # within_stamp still sees every tail row, memory's included, so `latest` is the
            # latest play of this write; only the rows memory did not place take the poll stamp
            for r in within_stamp(tail, stamp):
                if "wall" in (r.get("payload") or {}) or r["seq"] in declined:
                    continue
                r["payload"] = {**(r.get("payload") or {}), **stamp}
        for i in range(0, len(tail), 400):
            sb.insert("game_events", tail[i:i + 400])
        n_mem = sum(1 for r in tail if r["seq"] in mem)
        how = (f"+{len(tail)} events (now {len(rows)})" + (" stamped" if stamp and tail else "")
               + (f", {n_mem} by memory" if n_mem else ""))
    else:
        # A corrected feed = replace (the platform's own model). The stamps already earned are
        # carried across by matching the old rows in order - one Genius correction three plays
        # back must not un-time the whole game.
        #
        # PID IS NOT PART OF THE KEY, AND THAT MATTERS.
        #
        # It used to be. pid is the only component of that key which is a PLATFORM id
        # rather than feed data: ensure_game_people mints player rows, and a pid that
        # is re-minted or re-resolved between two polls changes for every event that
        # names a player while the play itself has not moved at all. The carry then
        # matches nothing, and because the branch below only stamps rows past
        # len(existing), every row before that point is left permanently unstamped -
        # they cannot be re-stamped on any later pass, so one bad replace un-times the
        # whole game so far and every replace after it has nothing left to carry. A
        # ratchet, not a blip.
        #
        # Watched on 2026-09-12: a live fixture went from 98 stamped of 98 to 3 of 120
        # in one rewrite (every row's created_at identical, so the whole log was
        # replaced), and the 117 rows before the tail can never be placed in footage
        # again. Translating that same feed afresh and comparing field by field found t,
        # team, period and clock IDENTICAL across all 144 rows - so the four fields that
        # describe the play are stable, and the one that is not describes our database.
        #
        # (t, team, period, clock) identifies a play within one game's log well enough,
        # and the list is popped in order so two rows sharing all four still take their
        # own stamps. Dropping pid can only ever match MORE rows than before.
        carry = {}
        for e in existing:
            p = e.get("payload") or {}
            if p.get("wall") is not None:
                carry.setdefault((e["t"], e.get("team"), e["period"], e["clock"]), []).append(
                    {"wall": p["wall"], "wall_err": p.get("wall_err"), "created_at": e.get("created_at")})
        kept = 0
        for r in rows:
            k = (r["t"], r["team"], r["period"], r["clock"])
            if carry.get(k):
                c = carry[k].pop(0)
                r["payload"] = {**(r.get("payload") or {}), "wall": c["wall"], **({"wall_err": c["wall_err"]} if c.get("wall_err") is not None else {})}
                if c.get("created_at"):
                    r["created_at"] = c["created_at"]
                kept += 1
        # AND BY POSITION, FOR ANYTHING THE KEY STILL MISSED.
        #
        # The comment above says "matching the old rows in order", which is what this
        # finally does. A correction usually revises a handful of plays and leaves the
        # rest where they were, so a row at the same index whose play still reads the
        # same is the same play whatever its key does. Belt and braces, and it is the
        # difference between losing a stamp and losing every stamp before the tail.
        if kept < len(existing):
            for i, r in enumerate(rows):
                if i >= len(existing):
                    break
                if "wall" in (r.get("payload") or {}):
                    continue
                e = existing[i]
                ep = e.get("payload") or {}
                if ep.get("wall") is None:
                    continue
                if (e["t"], e.get("team"), e["period"], e["clock"]) != (r["t"], r["team"], r["period"], r["clock"]):
                    continue
                r["payload"] = {**(r.get("payload") or {}), "wall": ep["wall"],
                                **({"wall_err": ep["wall_err"]} if ep.get("wall_err") is not None else {})}
                if e.get("created_at"):
                    r["created_at"] = e.get("created_at")
                kept += 1
        # MEMORY AFTER THE CARRY, AND OVER IT. Memory is write-once, so where the carried stamp
        # came from memory this writes the identical value (and _same_row below still leaves the
        # row alone); where it came from a poll, or from the wrong row sharing a carry key,
        # memory is the better answer. A declined row keeps whatever it carried.
        #
        # A REFILLED ROW KEEPS ITS INSERT TIME. The carry above moves created_at only with a
        # stamp, so a row that was in the log unstamped and gains a memory stamp would go back
        # in with a created_at of now - and created_at is what game_tip_wallclock and the page's
        # timed-log test read when a stamp is missing. The same play at the same position keeps
        # the one it had: a refill changes a row's time, never when it was first written.
        for i, r in enumerate(rows):
            if r["seq"] in mem:
                r["payload"] = {**(r.get("payload") or {}), **mem[r["seq"]]}
                if "created_at" not in r and i < len(existing) and existing[i].get("created_at") and \
                        (existing[i]["t"], existing[i].get("team"), existing[i]["period"], existing[i]["clock"]) == \
                        (r["t"], r["team"], r["period"], r["clock"]):
                    r["created_at"] = existing[i]["created_at"]
        how_first = ""
        if stamp and existing:
            for r in within_stamp(rows[len(existing):], stamp):
                if "wall" not in (r.get("payload") or {}) and r["seq"] not in declined:
                    r["payload"] = {**(r.get("payload") or {}), **stamp}
        elif stamp and not existing:
            # The first sight of this game. Stamp it only if the log is still short
            # enough that one stamp is honest for all of it — see first_write_stamp.
            fw = first_write_stamp(rows, stamp)
            if fw:
                for r in rows:
                    if "wall" not in (r.get("payload") or {}) and r["seq"] not in declined:
                        r["payload"] = {**(r.get("payload") or {}), **fw}
                how_first = f", first write stamped (±{fw['wall_err'] // 1000}s)"
            else:
                how_first = ", first write unstamped (log already deep)"
        # ONLY WHAT CHANGED IS REPLACED, AND NOTHING IS EVER UPDATED IN PLACE.
        #
        # This was `delete everything, then insert everything`, two requests with no
        # transaction around them - so between them the game had NO play-by-play at
        # all. Not a theoretical window: caught on 2026-09-12 at 17:4x, a live fixture
        # reading 82 events one moment and ZERO the next, with games.home_score still
        # saying 2-16. Anything reading the log in that gap - the public game page, the
        # box score, the broadcast endpoint, finalise-game - saw a game that had not
        # been played. It self-heals a second later, which is exactly why nobody had
        # seen it.
        #
        # The next attempt upserted the whole log over itself, and that can never
        # succeed: an upsert over an existing (game_id, seq) is an UPDATE, and
        # game_events_no_update (0001, recreated unchanged in 0030) raises on every
        # UPDATE for every role, the service role included. write_platform swallows the
        # exception, so the first Genius correction of a live game would have frozen its
        # log for the rest of the game - no new plays, no game_state, no finalise-game.
        # The old chunks also failed a second way on 2026-09-12 (run 34708486251, 57 x
        # "400 Client Error"): the carry above sets created_at on carried rows only, and
        # PostgREST refuses a bulk insert whose objects do not share one key set.
        #
        # So the rows that still read exactly as the database holds them - every column,
        # stamps included - are not touched at all. From the first row that differs, the
        # old rows are deleted (0030's forbid_event_delete lets a server role do that) and
        # the new ones inserted, and when any of them carries created_at they all do. A
        # correction a few plays back costs a few rows for the length of one request rather
        # than the game; only a correction to the very first row still empties the log for
        # that instant, and closing that needs a migration (a service-role function that
        # deletes and inserts in one transaction), not this file. The rule stays the one
        # from epinoia/live.js: there must be no instant at which the league's copy of the
        # game is empty, beyond the rows a correction actually changed.
        keep = 0
        for e, r in zip(existing, rows):
            if not _same_row(e, r):
                break
            keep += 1
        fresh = rows[keep:]
        if any("created_at" in r for r in fresh):
            now_ts = now_iso()
            for r in fresh:
                r.setdefault("created_at", now_ts)
        if existing and keep < len(existing):
            sb.delete("game_events", f"game_id=eq.{game_id}&seq=gte.{existing[keep]['seq']}")
        for i in range(0, len(fresh), 400):
            sb.insert("game_events", fresh[i:i + 400])
        how = f"{len(rows)} events written" + (f" (log rewritten from seq {keep + 1}, {len(fresh)} rows replaced, {kept} stamps kept)"
                                               if existing else how_first)
        if mem:
            how += f", {sum(1 for r in fresh if r['seq'] in mem)} by memory" + (" (refill)" if refill else "")
    # scoreboard state: FIBA's clock is mm:ss remaining in the current period
    live = b.status == "live"
    clock_ms = _clock_ms(str(b.raw.get("clock") or "")) or 0
    if not clock_ms:
        # NOT EVERY FEED PRINTS A CLOCK. FIBA's own data.json carries `clock` beside the score;
        # a league whose adapter rebuilds the payload from its own back end may carry only the
        # log and the two team blocks -- LNB and both Espoirs divisions hand over {'pbp', 'tm'}
        # and nothing else. The clock was read off the missing key, came out 0, and every French
        # game showed "Q1 0:00" from tip to final hooter while lnb.fr showed the real clock
        # (reported 2026-09-18). The log knows: every action carries the time it happened at.
        clock_ms = _clock_from_log(b.raw.get("pbp")) or 0
    # A PERIOD THAT HAS ENDED IS AT 0:00, WHATEVER THE FEED'S OWN CLOCK SAYS. When the operator
    # ends a quarter, LiveStats resets its clock to the next period's full length (10:00, or 5:00
    # before overtime) and moves its own `period` on, while the log still ends in the quarter just
    # played -- nothing of the next one exists yet. Written as it stood, that pairing was "Q1 ·
    # 10:00" for the whole break after the first quarter (reported 2026-09-23, London Lions v
    # Cheshire Phoenix), and it took the quarter's minutes off everyone on the floor at its end:
    # the engine runs each stint up to the clock it is given, and 10:00 of Q1 is its first
    # second. The log's own period at 0:00 is what a scorer writes at a break, and the reading
    # notify_halftime (0124) checks first.
    if live and _period_over(b.raw, T["period"]):
        clock_ms = 0
    # `running` is FALSE for a fed game on the ordinary cadence: the page would otherwise count
    # the clock down locally between ten-second polls, and a feed clock is only ever as current
    # as its last event. Under the BROADCAST HEARTBEAT (a read every couple of seconds) the
    # arithmetic changes: if the clock came down between two reads seconds apart, it is running,
    # and a scorebug that ticks from the last reading and is corrected two seconds later is
    # smoother and no less honest than one that jumps. A stopped clock (a timeout, a dead ball)
    # shows as stopped on the next read.
    prev = _CLOCK_SEEN.get(game_id)
    # DELIBERATELY THE CONFIGURED INTERVAL, not the measured one the stamp above
    # now uses. This asks "are we on the broadcast heartbeat?", which is a
    # question about how this pass was configured; widening it to the real gap
    # would make a slow pass look like a fast one and start ticking clocks that
    # are not being read often enough to tick.
    fast = bool(observed and observed[1] is not None and observed[1] <= 6000)
    # a clock at 0:00 is never running (the end of a period above reads as a drop to zero)
    moving = bool(live and fast and clock_ms > 0 and prev and prev[0] is not None and clock_ms < prev[0]
                  and (time.time() - prev[1]) < 15)
    _CLOCK_SEEN[game_id] = (clock_ms if live else None, time.time())
    sb.upsert("game_state", {"game_id": game_id, "period": T["period"], "clock_ms": clock_ms if live else 0, "running": moving,
                             "score_home": T["home_score"], "score_away": T["away_score"], "last_seq": len(rows), "updated_at": now_iso()}, "game_id")
    print(f"    = {how}" + (f", warnings: {'; '.join(T['report']['warnings'])}" if T["report"]["warnings"] else ""))
    if b.status == "final":
        code, body = sb.function("finalise-game", {"gameId": game_id})
        if code >= 300:
            msg = f"finalise-game {code}: {str(body)[:300]}"
            print(f"    ! {msg}")
            try:
                sb.patch("external_games", f"adapter=eq.{src['adapter']}&external_id=eq.{b.external_id}", {"error": msg[:500]})
            except Exception:
                pass
        else:
            print("    = finalised")


# ─────────────────────────────────────────────────────────── main loop
def load_sources(sb: Supabase | None, use_config: bool, only: str | None) -> list[dict]:
    """Config sources (config/ingest-sources.json, edited from the website admin) UNION the
    database's due sources (schedule_sources, connected from the Epinoia console). Same
    schedule URL in both → the DB row wins (it carries league_id + the poll bookkeeping)."""
    rows: dict[str, dict] = {}
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for s in cfg["sources"]:
            if not s.get("enabled", True):
                continue
            for url in s.get("scheduleUrls") or []:
                rows[url] = {**s, "schedule_url": url, "id": None}
    except Exception as exc:
        print(f"(config sources unavailable: {exc})")
    if sb and not use_config:
        try:
            for r in sb.rpc("due_schedule_sources"):
                ac = r.get("adapter_config") or {}
                code = ac.get("code") or r.get("label") or "FEED"
                rows[r["schedule_url"]] = {**rows.get(r["schedule_url"], {}), **r, "code": code,
                                           "scheduleUrls": [r["schedule_url"]], "adapter_config": ac,
                                           "league_id": r.get("league_id"), "competition_id": r.get("competition_id")}
        except Exception as exc:
            print(f"(database sources unavailable: {exc})")
    out = list(rows.values())
    if only:
        out = [r for r in out if r.get("label") == only or r.get("code") == only]
    # A CALENDAR-YEAR LEAGUE (NBL1: March to August) is not a 2026-27 season - read by the August
    # cut-over, its finals would land in the next season from its ladder. Such a source says
    # "season_calendar" and plays in the season named for the year (season_auto: the year it is,
    # not a season anybody asked for); a season written into the row, or a backfill, pins its own.
    for r in out:
        ac = r.get("adapter_config") or {}
        if ac.get("season_calendar") and not ac.get("season"):
            r["adapter_config"] = {**ac, "season": str(datetime.now(timezone.utc).year), "season_auto": True}
    return out


# ----------------------------------------------------------------------------
# THE LIVE LANE. GitHub's cron is best-effort (on 2026-09-06 the 10-minute lane never fired and the
# half-hourly one skipped three slots in a row), so live coverage cannot wait on it. One pass of the
# live lane is long-lived instead: it re-reads the due set every 2 minutes (a game that tips while we
# run is picked up), polls every due game every --live-every seconds, naps until the next listed
# tip-off when nothing is on, and at the end tells the workflow (GITHUB_OUTPUT chain=true) to start
# the next pass whenever games are live or a tip-off is near. The passes chain back to back, so the
# only cron that matters is the one that starts the first pass of the day - and the discovery lane
# starts one too whenever it sees a game due.
LIVE_BEFORE_TIP = 20 * 60      # start polling this long before the listed tip-off
LIVE_AFTER_TIP = 4 * 3600      # keep polling an unpublished game this long after its tip-off
LIVE_STALE = 7 * 3600          # a game still 'live' this long after tip is a log nobody closed - not a reason to keep a runner up
# OUTSTANDING: tipped off longer ago than the live window, and never finished in the database. That
# is what a game looks like when the PC was off (or asleep, or the lane was closed) while it was
# played: live_due stops considering it 4 h after tip, so nothing revisits it, and the site keeps
# showing "scheduled, 0-0" for a result that exists. --catch-up fetches each such game once.
# Capped at a week so a game that was postponed and never played cannot be asked about for ever.
OUTSTANDING_MAX_AGE = 7 * 24 * 3600
CHAIN_AHEAD = 8 * 3600         # the live lane re-dispatches itself when the next tip-off is within this
MAIN_CHAIN_AHEAD = 3 * 3600    # the discovery lane starts the live lane when the next tip-off is within this

# ───────────────────────────────── how long the PC's wrapper should sleep between passes
#
# WHY THIS EXISTS. live_lane.bat used to wait a flat 30 s and start again, all night. With no
# game live and the next tip-off 11 hours away that is ~1,300 pointless passes, each opening a
# Supabase connection and re-reading every source's schedule, to learn the same thing every
# time. The lane already worked out the answer before it stopped — it knew the next tip-off and
# whether anything was due — and then threw it away.
#
# So it writes the answer down. The rule is the one a person would apply: if a game is live or
# due NOW there is work, so come straight back; otherwise sleep until LIVE_LEAD before the next
# tip-off, which leaves the lane awake and polling well before anybody could be watching.
#
# The floor matters as much as the ceiling. Waking 30 minutes early is deliberate slack for a
# fixture that tips early or a clock that drifts, and the cap keeps a wrapper that has been up
# for days from sleeping past a schedule change it has not seen yet.
LIVE_LEAD = 30 * 60            # be awake this long before a tip-off
LIVE_RESTART = 30              # there is work now: the old flat wait, unchanged
LIVE_WAIT_CAP = 4 * 3600       # never sleep longer than this without re-reading the schedule
LIVE_WAIT_FILE = os.path.join(os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp",
                              "epinoia_live_wait")


def _hms(s: int) -> str:
    h, m = divmod(int(s) // 60, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def _live_wait_seconds(due, next_tip, now) -> int:
    """Seconds the wrapper should sleep before starting the next pass."""
    if due:
        return LIVE_RESTART                       # a game is live or due: no pause at all
    if next_tip is None:
        return LIVE_WAIT_CAP                      # nothing scheduled anywhere; re-read later
    ahead = (next_tip - now).total_seconds() - LIVE_LEAD
    if ahead <= LIVE_RESTART:
        return LIVE_RESTART                       # tip-off is near: behave exactly as before
    return int(min(ahead, LIVE_WAIT_CAP))


def _write_live_wait(seconds: int) -> None:
    """Leave the number where live_lane.bat can read it. Best effort on purpose: a wrapper that
    cannot read it falls back to its own 30 s, which is the behaviour this replaces."""
    try:
        with open(LIVE_WAIT_FILE, "w", encoding="ascii") as fh:
            fh.write(str(int(seconds)))
    except Exception:
        pass
STALE_FINAL_S = 15 * 60        # a payload unchanged this long at the end of P4+ with unequal scores is a finished game


def _looks_finished(raw: dict) -> bool:
    """End of the fourth period or later, clock at 0:00, scores not level: nothing but a scorer's
    'game end' tap is missing. Level scores mean overtime is coming, so never final."""
    try:
        period = int(raw.get("period") or 0)
        clock = str(raw.get("clock") or "").strip()
        tm = raw.get("tm") or {}
        s1 = int((tm.get("1") or {}).get("score") or 0)
        s2 = int((tm.get("2") or {}).get("score") or 0)
    except (TypeError, ValueError):
        return False
    return period >= 4 and clock in ("00:00", "0:00", "00:00:00") and s1 != s2


def gh_output(**kv) -> None:
    """Hand values to the workflow step (GITHUB_OUTPUT) - no-op locally."""
    p = os.environ.get("GITHUB_OUTPUT")
    if not p:
        return
    with open(p, "a", encoding="utf-8") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def _tip(r: dict):
    try:
        return datetime.fromisoformat(str(r.get("tipoff_at")).replace("Z", "+00:00")) if r.get("tipoff_at") else None
    except ValueError:
        return None


def live_due(sb: "Supabase", sources: list[dict], now: datetime) -> tuple[list[tuple[dict, dict]], datetime | None]:
    """(due, next_tip): the games to poll now - live, or inside the tip-off window - and the next
    listed tip-off beyond the window (so a quiet pass knows how long to wait)."""
    due, next_tip = [], None
    for src in sources:
        try:
            rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final"
                                               "&select=external_id,external_status,tipoff_at,game_date,home_name,away_name,payload_hash,game_id")
        except Exception as exc:
            print(f"   (live lookup failed for {src['code']}: {exc})"); continue
        today = now.date().isoformat(); yday = (now - timedelta(days=1)).date().isoformat()
        for r in rows:
            t = _tip(r); since = (now - t).total_seconds() if t else None
            # a game marked live is polled while its tip-off is recent - or, when the schedule never
            # gave one, while its game date is today/yesterday. A log nobody closed last season must
            # not keep a runner alive (and chaining) for ever.
            recent = (since is not None and since < LIVE_STALE) or (since is None and r.get("game_date") in (today, yday))
            if r.get("external_status") == "live" and recent:
                due.append((src, r))
            elif since is not None and -LIVE_BEFORE_TIP <= since < LIVE_AFTER_TIP:
                due.append((src, r))
            elif since is not None and since < -LIVE_BEFORE_TIP and (next_tip is None or t < next_tip):
                next_tip = t
    return due, next_tip


def outstanding_rows(sb: "Supabase", src: dict, now: datetime) -> list[dict]:
    """Games of one source that tipped off more than LIVE_AFTER_TIP ago (so the live lane has
    stopped looking), less than OUTSTANDING_MAX_AGE ago (so a postponed game is not chased for
    ever), and are still not final in the database. A game with no tip-off time is skipped: with
    nothing to date it by, there is no telling a missed game from one not yet played."""
    rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final"
                                       "&select=external_id,external_status,tipoff_at,home_name,away_name")
    out = []
    for r in rows:
        t = _tip(r)
        if t is None:
            continue
        since = (now - t).total_seconds()
        if LIVE_AFTER_TIP <= since < OUTSTANDING_MAX_AGE:
            out.append(r)
    return out


LIVE_MUTEX = "Global\\EpinoiaLiveLane"
_live_mutex_handle = None


def claim_live_lane() -> bool:
    """One live lane per machine. False when another already holds it.

    TWO LANES WRITE THE SAME ROWS, AND THE OLDER ONE WINS HALF THE TIME. On 18 Sep 2026 a lane
    started from this checkout and a second from another (behind by one commit, without the
    clock fix) polled the same games fifteen seconds apart: one wrote the real game clock and
    the other wrote zero, so every French game's clock sat at 0:00 for a stretch and then
    flashed back to a time. Nothing was broken in either copy -- they were simply both right
    about different code. The lane is a writer; there should only ever be one of it.

    A Windows named mutex, because that is what the dashboard already uses to keep one worker
    on a desktop. On anything else, and on a runner, this is a no-op: GitHub's own concurrency
    group does the same job there."""
    global _live_mutex_handle
    if _live_mutex_handle is not None:
        return True                             # this process already holds it
    try:
        import ctypes
        k = ctypes.windll.kernel32
        _live_mutex_handle = k.CreateMutexW(None, False, LIVE_MUTEX)
        if k.GetLastError() == 183:            # ERROR_ALREADY_EXISTS
            return False
    except Exception:
        pass                                    # not Windows: no mutex, no harm
    return True


def live_keeper(sb: "Supabase | None", sources: list[dict], args) -> tuple[int, bool]:
    """One long-lived live-lane pass (see the note above). Returns (exit_code, chain)."""
    if not claim_live_lane():
        print("live lane: another one is already running on this machine -- leaving it to it.\n"
              "  (two lanes poll the same games and write the same rows; the older copy's answer\n"
              "   wins half the time, which is how a game clock ends up flashing between a real\n"
              "   time and 0:00. Close the other window, or let this one exit.)")
        return 0, False
    # EVERY SOURCE THAT SPEAKS LIVESTATS, NOT ONLY THE ONE NAMED AFTER IT. This tested
    # `adapter == "fiba_livestats"`, so the live lane covered the generic sources and silently
    # skipped every league with its own adapter on top of the same feed -- LNB and its two
    # Espoirs divisions, ACB, B.LEAGUE, EuroLeague, the Czech site. Espoirs ELITE 2 tipped off on
    # 18 Sep 2026 and sat at "scheduled, 0-0" on the site while the game was in its first quarter,
    # because no live pass ever considered it. The question is what an adapter IS, not what it is
    # called: the same subclass test run_ingest already uses for translation.
    fiba, seen_codes = [], set()
    for s_ in sources:
        if s_["adapter"] in LIVE_ADAPTERS and s_["code"] not in seen_codes:
            seen_codes.add(s_["code"])
            fiba.append({**s_, "competition_label": None, "competition_kind": None})   # discovery decides the phase
    if sb is None or not fiba:
        print("live lane: needs Supabase and a source that reads a LiveStats feed"); return 0, False
    adapters = {s["code"]: get_adapter(s["adapter"]) for s in fiba}
    worker = os.environ.get("GITHUB_RUN_ID", "local")
    runs = {s["code"]: {"source_id": s.get("id"), "worker": f"gha:{worker}", "games_seen": 0, "games_fetched": 0, "games_written": 0} for s in fiba}
    hashes: dict[str, str] = {}
    finished: set[str] = set()
    unchanged_since: dict[str, float] = {}      # when each game's payload last changed (stale-final rule)
    last_lm: dict[str, int] = {}                # newest Last-Modified written per game (the inline path's older-copy rule)
    end = time.time() + max(60, args.live_loop); every = max(10, args.live_every)
    fast_every = max(1, min(10, int(getattr(args, "broadcast_every", 2) or 2)))
    # THE OBSERVER LOOKS, THIS LOOP WRITES (docs/feed-timing.md, step 2).
    #
    # This loop used to fetch a game, write it, fetch the next and write that, so the time
    # between two looks at one game was however long it took to write all the others:
    # 37.9 s median and 198.5 s worst across four live games on 2026-09-12. The CDN publishes
    # a new version every 26-35 s, so a version could be published and replaced unseen, and
    # the one that was seen was stamped as late as the loop came round to it.
    #
    # feed_observer.FeedObserver polls every due game with a conditional GET every
    # OBS_EVERY seconds (the armed ones every fast_every), at the top of every pass and again
    # after every write, and holds the newest version with its Last-Modified stamp. The loop
    # only takes what the observer holds, and writes a version it has not written yet. The
    # write itself (write_supabase_feed, write_platform, write_event_log) is exactly what it
    # was; bundle_from_raw, with its SHA-1 and the stints pipeline, now runs once per new
    # version instead of on every unchanged poll.
    #
    # KILL SWITCH: EPINOIA_OBSERVER=0 (a repository variable, no commit needed) runs the
    # inline fetch below instead, byte for byte the step-1 loop. So does any failure to build
    # the observer. Unset means on.
    # ...AND ONLY THE CDN'S OWN IDS GO TO THE OBSERVER. FeedObserver polls FIBA's data.json by
    # LiveStats id; a league whose adapter reaches its own back end for the same log (LNB's rows
    # are "<competitionId>_<fixtureId>", not a LiveStats id) has nothing there to conditionally
    # GET. Those sources take the inline fetch below, which is what their adapter is for.
    def on_cdn(src):
        return src["adapter"] in CDN_ADAPTERS

    observer = None
    if os.environ.get("EPINOIA_OBSERVER", "") != "0":
        try:
            from feed_observer import FeedObserver
            observer = FeedObserver()
        except Exception as exc:
            print(f"live lane: observer unavailable ({exc!r}) - polling inline")
    written: dict[str, int] = {}; last_bundle: dict[str, GameBundle] = {}; write_s: dict[str, list] = {}
    OBS_EVERY = 5

    def observer_line(xid: str) -> str:
        s, ws = observer.stats(xid), sorted(write_s.get(xid) or [])
        return (f"   observer {xid}: {s['polls']} polls, {s['share304'] * 100:.0f}% 304, max gap {s['max_poll_gap_ms'] / 1000:.1f} s, "
                f"gaps over 25 s {s['gaps_over_25s']}/{s['gaps']}, {s['versions']} versions, {s['older']} older copies, "
                f"{s['errors']} errors, {s['stamped']} actions in memory ({s['late']} late, {s['contra']} contradictions), "
                + (f"median write {ws[len(ws) // 2]:.1f} s over {len(ws)}" if ws else "no writes"))
    due, next_tip, recheck, exit_code = [], None, 0.0, 0
    # THE BROADCAST HEARTBEAT. A game somebody has armed (games.broadcast_until in the future,
    # set from the control room) is read every couple of seconds so a scorebug on a stream
    # follows the table; everything else keeps the ten-second cadence. The armed set is
    # re-read every 20 s so pressing the button takes effect within a poll or two.
    armed: set[str] = set(); armed_check = 0.0; slow_due = 0.0
    def armed_games():
        try:
            rows = sb.select("games", f"broadcast_until=gt.{datetime.now(timezone.utc).isoformat()}&select=id")
            return {str(x["id"]) for x in rows}
        except Exception:
            return set()
    print(f"live lane: up to {args.live_loop // 60} min, polling every {every} s ({fast_every} s while a game is armed for broadcast)"
          + (f"; the observer looks every {OBS_EVERY} s between writes" if observer else "; inline fetch (EPINOIA_OBSERVER=0)"))
    while time.time() < end:
        now = datetime.now(timezone.utc)
        if time.time() >= armed_check:
            was = armed; armed = armed_games(); armed_check = time.time() + 20
            if armed != was:
                print(f"{now.strftime('%H:%M:%S')}Z broadcast heartbeat: {len(armed)} armed game(s)")
        if time.time() >= recheck:
            due, next_tip = live_due(sb, fiba, now)
            due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
            for s, r in due:
                hashes.setdefault(str(r["external_id"]), r.get("payload_hash") or "")
                runs[s["code"]]["games_seen"] = max(runs[s["code"]]["games_seen"], len([1 for s2, _ in due if s2 is s]))
            recheck = time.time() + 120
            print(f"{now.strftime('%H:%M:%S')}Z {len(due)} live/due game(s)" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") +
                  ((": " + ", ".join(f"{r.get('home_name') or r['external_id']} v {r.get('away_name') or ''}" for _, r in due[:6])) if due else ""))
        # the slow set is read on the ordinary cadence; an armed game is read every pass
        slow_pass = time.time() >= slow_due
        if slow_pass:
            slow_due = time.time() + every
        armed_x = {str(r["external_id"]) for _, r in due if str(r.get("game_id") or "") in armed}
        cdn_due = [str(r["external_id"]) for s_, r in due if on_cdn(s_)]
        if observer and cdn_due:
            observer.observe_due(cdn_due, OBS_EVERY, armed_x, fast_every)
        wrote_any = False
        for src, r in due:
            xid = str(r["external_id"])
            is_armed = str(r.get("game_id") or "") in armed
            use_obs = observer is not None and on_cdn(src)
            if not use_obs and not slow_pass and not is_armed:
                continue
            g = ScheduleGame(external_id=xid, home_name=r.get("home_name") or "", away_name=r.get("away_name") or "",
                             tipoff_at=r.get("tipoff_at"), status=r.get("external_status") or "scheduled")
            if not use_obs:   # the kill switch (EPINOIA_OBSERVER=0), and every source off the CDN
                t_obs = time.time()
                try:
                    b = adapters[src["code"]].fetch(xid, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
                except Exception as exc:
                    print(f"    ! {xid}: {exc}"); exit_code = 1; continue
                if not b:
                    continue                                                  # not published yet
                vs = feedstamp.version_stamp(b.feed_lm_ms, b.feed_recv_ms or int(t_obs * 1000), last_lm.get(xid))
                if vs["older"]:
                    # AN OLDER CDN COPY IS NOT NEWS. data.json comes through CloudFront, and an
                    # edge can serve an upload older than one this pass has already written. Taken
                    # as a change it would rewrite the log backwards (plays vanish, then come back
                    # on the next poll, re-stamped late) and restart the stale-final timer below,
                    # so a finished game nobody closed might never close. Only STRICTLY older
                    # counts: S3 truncates Last-Modified to whole seconds, so new content can carry
                    # an equal header.
                    print(f"    ~ {xid}: older copy (Last-Modified {b.feed_lm_ms} < {last_lm[xid]}), skipped"); continue
                if hashes.get(xid) == b.payload_hash:
                    # NOTHING NEW - but a game a scorer never closed must still finish. Genius only
                    # marks a game final through an explicit 'game end' action; when the payload has
                    # sat unchanged for 15 min at the end of the fourth period (or later) with the
                    # scores not level, the game is over in every sense that matters and is finalised.
                    first_seen = unchanged_since.setdefault(xid, time.time())
                    if b.status == "live" and time.time() - first_seen >= STALE_FINAL_S and _looks_finished(b.raw):
                        print(f"    = {b.home_name} v {b.away_name}: unchanged {int((time.time() - first_seen) // 60)} min at the end of P{b.raw.get('period')} - treating as final")
                        b.status = "final"
                    else:
                        continue
                else:
                    unchanged_since[xid] = time.time()
                # a play in this payload happened between the previous upload and this one: the
                # stamp is when the CDN's copy was uploaded (Last-Modified + 999 ms), not when we
                # happened to ask; the error is still the configured interval plus the fetch
                observed = (vs["stamp_ms"], int(((fast_every if is_armed else every) + (time.time() - t_obs)) * 1000))
                snap = None
            else:
                snap = observer.take(xid)
                if snap is None:
                    continue                                                  # not published yet
                if snap.version == written.get(xid):
                    # Nothing new since the last write - the same stale-final rule as the inline
                    # path, timed from when the observer last saw the content change.
                    b = last_bundle.get(xid)
                    if not (b and b.status == "live" and time.time() * 1000 - snap.changed_at_ms >= STALE_FINAL_S * 1000
                            and _looks_finished(b.raw)):
                        continue
                    print(f"    = {b.home_name} v {b.away_name}: unchanged {int((time.time() * 1000 - snap.changed_at_ms) // 60000)} min at the end of P{b.raw.get('period')} - treating as final")
                    b.status = "final"
                else:
                    try:
                        b = adapters[src["code"]].bundle_from_raw(snap.raw, xid, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
                    except Exception as exc:
                        # a payload the adapter cannot read is skipped, not retried every second
                        print(f"    ! {xid}: {exc}"); exit_code = 1; written[xid] = snap.version; continue
                    if g.tipoff_at:
                        b.tipoff_at = g.tipoff_at
                    b.feed_lm_ms, b.feed_recv_ms = snap.lm_ms, snap.recv_ms
                    last_bundle[xid] = b
                    if hashes.get(xid) == b.payload_hash:      # pass handover: the DB already has this content
                        written[xid] = snap.version; continue
                # the version's upload stamp; the error stays the CONFIGURED interval plus the
                # poll's own duration, so the heartbeat's `fast` test reads exactly as before
                observed = (snap.stamp_ms, int((fast_every if is_armed else every) * 1000) + snap.fetch_ms)
            run = runs[src["code"]]; run["games_fetched"] += 1
            t_write = time.time()
            raw_ref = None
            try:
                raw_ref = write_supabase_feed(sb, src, b, entry_for(b, None, None, g))
            except Exception as exc:
                print(f"    (supabase feed write failed: {exc})")
            try:
                # the observer's per-action memory (step 3); the kill switch has none, and passes
                # None, which is exactly the write this lane made before memory existed
                write_platform(sb, src, b, run, observed, observer.stamps(xid) if use_obs else None); run["games_written"] += 1
            except Exception as exc:
                print(f"    (platform write failed: {exc})")
            if use_obs:
                write_s.setdefault(xid, []).append(time.time() - t_write)
                observer.observe_due(cdn_due, OBS_EVERY, armed_x, fast_every)
            hashes[xid] = b.payload_hash
            if snap:
                written[xid] = snap.version
            elif vs["basis"] == "lm":
                last_lm[xid] = max(last_lm.get(xid) or 0, b.feed_lm_ms)
            wrote_any = True
            e = entry_for(b, None, raw_ref, g)
            print(f"    ~ {b.home_name} {e['homeScore']}-{e['awayScore']} {b.away_name} ({b.status}) {datetime.now(timezone.utc).strftime('%H:%M:%S')}Z")
            if b.status == "final":
                finished.add(xid)
                if use_obs:
                    print(observer_line(xid))
                    observer.forget(xid); written.pop(xid, None); last_bundle.pop(xid, None)
        due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
        if due:
            if observer and any(on_cdn(s_) for s_, _ in due):
                # the observer keeps its own cadence; this only stops the loop spinning. The
                # sources off the CDN are held to `every` by the slow_pass gate above.
                time.sleep(0 if wrote_any else 1); continue
            hot = any(str(r.get("game_id") or "") in armed for _, r in due)
            time.sleep(fast_every if hot else every); continue
        # nothing on: wait for the next tip-off if this pass can still reach it (short naps - the
        # 2-minute recheck notices a schedule change or a game that goes live early)
        wait = ((next_tip - datetime.now(timezone.utc)).total_seconds() - LIVE_BEFORE_TIP) if next_tip else None
        if wait is None or time.time() + wait > end:
            break
        time.sleep(min(max(wait, 5), 120))
    if observer:
        # THE STEP-2 DECISION GATE, read off the run log: if more than about 5% of a game's poll
        # gaps are over 25 s, the writes are starving the observer - ship 2b, then a thread.
        for xid in list(observer.st):
            print(observer_line(xid))
    for s in fiba:
        if s.get("id"):
            try:
                sb.patch("schedule_sources", f"id=eq.{s['id']}", {"last_polled_at": now_iso(), "last_ok_at": now_iso()})
                if runs[s["code"]]["games_fetched"]:
                    sb.insert("ingest_runs", {**runs[s["code"]], "finished_at": now_iso(), "status": "ok"})
            except Exception:
                pass
    now = datetime.now(timezone.utc)
    due, next_tip = live_due(sb, fiba, now)
    due = [(s, r) for s, r in due if str(r["external_id"]) not in finished]
    chain = bool(due) or (next_tip is not None and (next_tip - now).total_seconds() < CHAIN_AHEAD)
    wait = _live_wait_seconds(due, next_tip, now)
    print(f"live lane done: {len(due)} still live/due" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") +
          (" - chaining the next pass" if chain else " - nothing near, stopping")
          + (f"; sleep {_hms(wait)} before the next pass" if wait > LIVE_RESTART else ""))
    _write_live_wait(wait)
    return exit_code, chain


# ────────────────────────────────────────────────────────── the backfill lane
# AN OLDER SEASON, ASKED FOR FROM THE CONSOLE (0135 season_backfills).
#
# There is no second ingest here and there must never be one. Every adapter
# already reads the season it is given out of adapter_config["season"] — acb's
# ?temporada=, B.LEAGUE's ?year=, EuroLeague's E<year>, the Czech and Slovak
# sites' own season lists, and for a Genius client the year
# expand_competition_sources matches each competition against. So a backfill is
# THIS pass with one string changed; everything below is about which sources it
# changes it on, and how the queued row is left afterwards.
#
# THE ADAPTER HAS TO BE ABLE TO READ A SEASON. The pipeline bridges (bbl_2bbl,
# euroleague_api, eurobasket_html, genius_html, bcb_pipeline) hand the config
# to a scraper module in the bcb_scraper project that may pin its own year, and
# a source that quietly re-read THIS season while filed under 2024-25 is the
# worst thing this feature could do — last season's table filled with this
# season's games, and no error anywhere. A source whose adapter is not on this
# list is skipped with a reason printed, never run on trust.
SEASON_AWARE_ADAPTERS = {"fiba_livestats", "fiba_site_schedule", "euroleague", "acb", "lnb", "bleague",
                         "twobbl", "usports", "plk", "lba", "lkl", "lnbp"}

_BEAT: dict | None = None      # set while a claimed backfill is running; see beat()


def beat() -> None:
    """Keep a claimed backfill's lease alive. 0135 re-queues a row whose worker has not been heard
    from for 90 minutes — that is what stops a killed runner blocking its league's season for ever —
    and a season is several hundred games, so the pass has to say it is still there. Throttled to
    once a minute, and a no-op for every other kind of pass, so the call in the game loop is free."""
    b = _BEAT
    if not b or time.time() - b["at"] < 60:
        return
    b["at"] = time.time()
    try:
        b["q"].rpc("heartbeat_season_backfill", {"p_id": b["id"]})
    except Exception:
        pass            # a missed heartbeat is not worth failing a season over; the lease is 90 min


def backfill_claim(args) -> tuple[dict | None, "Supabase | None"]:
    """Take the oldest queued backfill and say which league and season it is for.

    THE QUEUE IS READ EVEN ON A DRY RUN. It is this lane's INPUT, not an output, so it gets its own
    client rather than main()'s `sb`, which is deliberately None when nothing may be written. A dry
    run then PEEKS instead of claiming: --dry-run has always meant the database comes back exactly
    as it was, and the queue is part of the database."""
    global _BEAT
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("--backfill needs SUPABASE_URL / SUPABASE_SERVICE_KEY: the queue lives in the database")
        return None, None
    q = Supabase(url, key)
    job = None
    if args.dry_run:
        rows = q.select("season_backfills", "state=eq.queued&order=requested_at.asc&limit=1&select=*")
        job = dict(rows[0], _dry=True) if rows else None
        if job:
            print(f"[dry] claiming backfill {job['id']} - {job['season']} (nothing written: the row stays queued)")
    else:
        got = q.rpc("claim_season_backfill", {"p_worker": f"gha:{os.environ.get('GITHUB_RUN_ID', 'local')}"})
        if isinstance(got, list):
            got = got[0] if got else None
        # an empty queue comes back as null, or as a row of nulls - both mean "nothing to do"
        job = got if (got and got.get("id")) else None
        if job:
            print(f"claimed backfill {job['id']} - {job['season']}")
            _BEAT = {"q": q, "id": job["id"], "at": time.time()}
    if not job:
        print("no season backfill is queued")
        return None, q
    try:                                   # the league's slug is how a config source is recognised
        lg = q.select("leagues", f"id=eq.{job['league_id']}&select=slug,name")
        job["league_slug"] = (lg[0] if lg else {}).get("slug")
        job["league_name"] = (lg[0] if lg else {}).get("name") or job.get("league_slug")
    except Exception as exc:
        print(f"   (league lookup failed: {exc})")
    print(f"-> backfilling {job.get('league_name') or job['league_id']} {job['season']}")
    return job, q


def backfill_sources(job: dict, sources: list[dict]) -> list[dict]:
    """This league's sources from load_sources, pinned to the backfill's season.

    THREE FIELDS ARE DELIBERATELY REPLACED so an old season cannot land on top of the live one:

      adapter_config["season"]  the mechanism itself - every adapter reads it, and
                                expand_competition_sources picks the competitions of THAT season;
      competition_id            a registry row points at the competition of the season being
                                played, and would file 2024-25's games straight into it.
                                Cleared, so source_competition creates/uses the right one;
      id                        the schedule_sources row. A backfill that stamped last_polled_at
                                on the live source would push the next ordinary poll half an hour
                                out - an old season must never delay the current one."""
    lid, slug = job.get("league_id"), job.get("league_slug")
    out = []
    for s in sources:
        if not ((lid and s.get("league_id") == lid) or (slug and s.get("league_slug") == slug)):
            continue
        if s["adapter"] not in SEASON_AWARE_ADAPTERS:
            print(f"   {s.get('code')}: the {s['adapter']} adapter does not read a season - skipped rather than "
                  f"risk filing this season's games under {job['season']}")
            continue
        out.append({**s, "adapter_config": dict(s.get("adapter_config") or {}, season=job["season"]),
                    "competition_id": None, "id": None})
    print(f"   {len(out)} source(s) pinned to {job['season']}: " + (", ".join(s.get("code") or "?" for s in out) or "none"))
    return out


def backfill_finish(q: "Supabase | None", job: dict, state: str, sources_run: int,
                    seen: int, written: int, error: str | None) -> None:
    """Close the queued row. Always called - a pass that threw still has to say so, because a row
    left on `running` blocks its league's season until the 90-minute lease expires."""
    global _BEAT
    _BEAT = None
    line = f"backfill {job['season']} {state}: {sources_run} source(s), {seen} seen, {written} written" + (f" - {error}" if error else "")
    if not q or job.get("_dry"):
        print("[dry] " + line)
        return
    try:
        q.rpc("finish_season_backfill", {"p_id": job["id"], "p_state": state, "p_sources": sources_run,
                                         "p_seen": seen, "p_written": written, "p_error": error})
        print(line)
    except Exception as exc:
        print(f"(could not close the backfill row - the lease will re-queue it: {exc})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="label/code of one source")
    ap.add_argument("--dry-run", action="store_true", help="discover + fetch, write nothing")
    ap.add_argument("--config", action="store_true", help="(kept for compatibility) config sources are always read; with Supabase keys the database sources are merged in too")
    ap.add_argument("--max-games", type=int, default=400)
    ap.add_argument("--ids", help="comma-separated external ids: skip discovery and fetch just these (tests). "
                    "For the Czech NBL (fiba_site_schedule, site=czech) this is nbl.basketball's OWN /zapas/<id> "
                    "id, not the LiveStats id external_games.external_id ends up holding -- fetch() translates "
                    "one to the other on the way in (see data/feed/CBFFE/idmap.json for the mapping). Passing "
                    "the LiveStats id here fails silently: 'to (re)fetch' but 'fetched 0', no error printed "
                    "(reported 2026-09-18, cost a fetch() debugging session before the idmap gave up the real id)")
    ap.add_argument("--feed-out", default=str(FEED_DIR), help="repo feed directory (default data/feed); '' to disable")
    ap.add_argument("--fixture-out", help="also write each bundle (+ raw) as JSON test fixtures here")
    ap.add_argument("--no-supabase", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="re-process every game on the schedule even if already final (backfill stints / re-run translation)")
    ap.add_argument("--live-only", action="store_true", help="skip discovery; re-check only games live or due to tip (the frequent pass)")
    ap.add_argument("--catch-up", action="store_true", help="skip discovery; fetch once each game that tipped off more than 4 h ago (within a week) and is still not final - what a game looks like when it was played while the PC was off")
    ap.add_argument("--live-loop", type=int, default=0, help="after the pass, keep re-polling live games every --live-every seconds for this many seconds")
    ap.add_argument("--live-every", type=int, default=30)
    ap.add_argument("--broadcast-every", type=int, default=2, help="seconds between reads of a game armed for broadcast (games.broadcast_until)")
    ap.add_argument("--backfill", action="store_true", help="claim the oldest queued season backfill (0135) and run this same pass over that league's sources with that season pinned")
    # %% not %: argparse's --help formatter runs this help text through %-substitution
    # (for %(default)s and friends), so a literal %APPDATA% crashed --help outright --
    # the exact same bug already sitting in team_colours.py's own --worker-config, copied
    # forward here without noticing until --help was actually run (2026-09-18).
    ap.add_argument("--worker-config", action="store_true", help=r"take SUPABASE_URL / SUPABASE_SERVICE_KEY from %%APPDATA%%\epinoia\worker.json, same as team_colours.py / sync_clubs.py, for a one-off local run with nothing pasted into a shell")
    args = ap.parse_args()
    if args.backfill and args.live_only:
        print("--backfill and --live-only are different lanes: an old season has no live games")
        return 2

    # SET BEFORE ANYTHING ELSE READS THEM. Every other Supabase-credentialed helper in this file
    # (backfill_claim included) reads SUPABASE_URL / SUPABASE_SERVICE_KEY straight from the
    # environment rather than being passed a client, so filling the environment here -- once,
    # before the first read -- covers all of them without threading --worker-config through each
    # one by hand. setdefault, not assignment: an env var Louie already set (CI, a shell profile)
    # always wins over the file. Every OTHER ingest script (team_colours.py, sync_clubs.py,
    # repair_numeric_short_names.py) already offers this flag; this file was the one left needing
    # SUPABASE_URL / SUPABASE_SERVICE_KEY typed by hand for a local run (reported 2026-09-18).
    if args.worker_config:
        try:
            cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
            os.environ.setdefault('SUPABASE_URL', cfg['supabase_url'])
            os.environ.setdefault('SUPABASE_SERVICE_KEY', cfg['service_key'])
        except Exception as exc:
            print(f"--worker-config: {exc}")
            return 2

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = Supabase(url, key) if (url and key and not args.dry_run and not args.no_supabase) else None
    feed = RepoFeed(Path(args.feed_out)) if (args.feed_out and not args.dry_run) else None
    if sb is None:
        print("Supabase: off" + ("" if args.no_supabase or args.dry_run else " (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)") + " - repo feed only")

    sources = load_sources(sb, args.config and sb is None, args.source)
    # THE BACKFILL NARROWS THE SOURCE LIST BEFORE ANYTHING ELSE TOUCHES IT — the same load_sources,
    # then one league's rows with the season pinned. It has to happen here, ahead of
    # expand_competition_sources, because that is what turns a Genius client's page into one source
    # per competition OF A GIVEN SEASON: run it first and it would expand every league on the
    # registry against the season being played and then throw the work away.
    job, queue = None, None
    if args.backfill:
        job, queue = backfill_claim(args)
        if not job:
            return 0                       # an empty queue is a successful pass that did nothing
        sources = backfill_sources(job, sources)
        if not sources:
            backfill_finish(queue, job, "failed", 0, 0, 0,
                            "no season-aware source is configured for this league")
            return 1
    if not args.ids:
        sources = expand_competition_sources(sources)
    print(f"{len(sources)} source(s) due")
    if job and not sources:
        # the league has a source, but the site publishes no competition for that season: a real
        # answer ("we do not hold it") rather than a silent success the console cannot explain
        backfill_finish(queue, job, "failed", 0, 0, 0, f"the source publishes no {job['season']} competition")
        return 1
    if args.live_only and not args.ids:
        rc, chain = live_keeper(sb, sources, args)
        gh_output(chain="true" if chain else "false")
        return rc
    worker = os.environ.get("GITHUB_RUN_ID", "local")
    exit_code = 0
    tot = {"seen": 0, "written": 0, "error": None}      # the whole pass, for a backfill's row
    for src in sources:
        adapter = get_adapter(src["adapter"])
        run = {"source_id": src.get("id"), "worker": f"gha:{worker}", "games_seen": 0, "games_fetched": 0, "games_written": 0}
        run_id = None
        if sb and src.get("id"):
            try:
                run_id = sb.upsert("ingest_runs", {k: v for k, v in run.items()}, "id")[0]["id"]
            except Exception:
                run_id = None
        t0 = time.time(); err = None
        try:
            print(f"-> {src['label']} [{src['adapter']}] {src['schedule_url'][:90]}")
            if args.ids:
                games = [ScheduleGame(external_id=x.strip()) for x in args.ids.split(",") if x.strip()]
            elif args.catch_up:
                # games that were played while nothing was watching: see OUTSTANDING_MAX_AGE
                games = []
                try:
                    for r in (outstanding_rows(sb, src, datetime.now(timezone.utc)) if sb else []):
                        games.append(ScheduleGame(external_id=str(r["external_id"]), home_name=r.get("home_name") or "",
                                                  away_name=r.get("away_name") or "", tipoff_at=r.get("tipoff_at"),
                                                  status=r.get("external_status") or "scheduled"))
                except Exception as exc:
                    print(f"   (catch-up lookup failed: {exc})")
                if not games:
                    print("   no outstanding games"); continue
                print(f"   catching up: {len(games)} outstanding game(s): " + ", ".join(f"{g.home_name or g.external_id} v {g.away_name}" for g in games[:6]))
            elif args.live_only:
                # games live now, or due to tip within 20 min / tipped within the last 4 h (from the schedule dates)
                games = []
                now = datetime.now(timezone.utc)
                try:
                    rows_ = (sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final&select=external_id,external_status,tipoff_at,home_name,away_name")
                             if sb else [dict(external_id=k, external_status=v.get("status"), tipoff_at=v.get("date"), home_name=v.get("home"), away_name=v.get("away"))
                                         for k, v in (feed.known(src["code"]) if feed else {}).items() if v.get("status") != "final"])
                except Exception as exc:
                    print(f"   (live lookup failed: {exc})"); rows_ = []
                for r in rows_:
                    due = False
                    if r.get("external_status") == "live":
                        due = True
                    elif r.get("tipoff_at"):
                        try:
                            t = datetime.fromisoformat(str(r["tipoff_at"]).replace("Z", "+00:00"))
                            due = (t - now).total_seconds() < 20 * 60 and (now - t).total_seconds() < 4 * 3600
                        except ValueError:
                            due = False
                    if due:
                        games.append(ScheduleGame(external_id=str(r["external_id"]), home_name=r.get("home_name") or "", away_name=r.get("away_name") or "",
                                                  tipoff_at=r.get("tipoff_at"), status=r.get("external_status") or "scheduled"))
                if not games:
                    print("   no live or due games"); continue
                print(f"   {len(games)} live/due game(s): " + ", ".join(f"{g.home_name or g.external_id} v {g.away_name}" for g in games[:6]))
            else:
                games = list(adapter.discover(src["schedule_url"], dict(src.get("adapter_config", {}), code=src.get("code"))))
                # the groups a feed names on its own fixtures (groups.learn: NBL1's conferences),
                # known before a single club is entered
                learnt = groups.learn(src, (src.get("adapter_config") or {}).get("season") or season_name_for(), games)
                if learnt:
                    print(f"   groups from the feed: {len({g for g in (x.extra.get('home_group') for x in games) if g})} group(s)")
                if sb and not args.dry_run:
                    try:
                        sync_logos(sb, src, games, run)
                    except Exception as exc:
                        print(f"   (crests: {exc})")
                    try:
                        refile_from_catchall(sb, src, games, run)
                    except Exception as exc:
                        print(f"   (re-filing: {exc})")
                    try:
                        sync_videos(sb, src, games, run)
                    except Exception as exc:
                        print(f"   (videos: {exc})")
            run["games_seen"] = len(games)
            # What we already have. When Supabase is configured IT is the authority for "already
            # done" (a game only in the repo index still needs its Supabase rows + storage copy);
            # the repo index is merged in afterwards so index.json keeps every game it knew.
            known_repo = feed.known(src["code"]) if feed else {}
            known_db = {}
            if sb:
                try:
                    for r in sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&select=external_id,external_status,payload_hash,raw_ref,game_date,home_name,away_name,home_score,away_score"):
                        k = str(r["external_id"])
                        known_db[k] = {**known_repo.get(k, {"id": k}), "id": k, "home": r.get("home_name"), "away": r.get("away_name"),
                                       "homeScore": r.get("home_score"), "awayScore": r.get("away_score"),
                                       "status": r.get("external_status"), "hash": r.get("payload_hash"), "raw_ref": r.get("raw_ref"), "date": r.get("game_date")}
                except Exception as exc:
                    print(f"   (external_games unavailable: {exc})")
            known = known_db if sb else known_repo
            # A GAME THAT HAS NOT TIPPED OFF HAS NOTHING TO FETCH. The feed answers
            # 403/404 until the scoresheet is opened, so asking about a fixture three
            # weeks away buys a refusal and costs a request plus its politeness gap.
            # The schedule facts for those games are still written, just below — only
            # the game feed is left alone. See fetchwindow.py.
            def done(g):
                k = known.get(g.external_id, {})
                return k.get("status") == "final" and k.get("hash")

            now_utc = datetime.now(timezone.utc)
            if args.refresh:
                ready, waiting = list(games), 0
            else:
                unfinished = [g for g in games if not done(g)]
                ready = [g for g in unfinished if worth_fetching(g.tipoff_at, now_utc)]
                waiting = len(unfinished) - len(ready)
            todo = ready[: args.max_games]
            print(f"   {len(games)} on schedule, {len(todo)} to (re)fetch"
                  + (f" ({waiting} not tipped off yet)" if waiting else ""))
            entries = {**known_repo, **known}
            # schedule facts for every game (dates, venues, clubs) even before the feed publishes a payload
            for g in games:
                if g.tipoff_at or g.home_name:
                    entries[g.external_id] = sched_entry(g, entries.get(g.external_id))
                    if sb and not args.dry_run and not entries[g.external_id].get("hash"):
                        try:
                            write_fixture(sb, src, g, run)
                            sb.upsert("external_games", {"adapter": src["adapter"], "external_id": g.external_id, "competition_code": src["code"],
                                                         "home_name": g.home_name or None, "away_name": g.away_name or None,
                                                         "external_status": g.status or "scheduled", "tipoff_at": g.tipoff_at,
                                                         "game_date": (g.tipoff_at or "")[:10] or None}, "adapter,external_id")
                        except Exception as exc:
                            print(f"    (fixture {g.external_id}: {exc})")
            live_set = []
            for g in todo:
                t_obs = time.time()
                try:
                    b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
                except Exception as exc:                                 # one bad game never stops the league
                    print(f"    ! {g.external_id}: {exc}")
                    continue
                if not b:
                    continue
                run["games_fetched"] += 1
                beat()                      # a backfill's lease, kept alive through a long season
                prev = known.get(g.external_id)
                if prev and prev.get("hash") == b.payload_hash and b.status != "live" and not args.refresh:
                    continue
                if args.dry_run:
                    print(f"    [dry] {b.home_name} vs {b.away_name} ({b.status}) stints={len(b.stints)} box={len(b.box.get('home', []))}+{len(b.box.get('away', []))}"
                          + (f" lm={b.feed_lm_ms} recv-lm={(b.feed_recv_ms - b.feed_lm_ms) / 1000:.1f}s" if b.feed_lm_ms and b.feed_recv_ms else " lm=none"))
                    if args.fixture_out:
                        write_test_fixture(Path(args.fixture_out), src, b)
                    continue
                raw_ref = None
                if sb:
                    try:
                        raw_ref = write_supabase_feed(sb, src, b, entry_for(b, prev, None, g))
                    except Exception as exc:
                        print(f"    (supabase feed write failed: {exc})")
                entry = entry_for(b, prev, raw_ref, g)
                if feed:
                    feed.write_game(src["code"], b)
                entries[g.external_id] = entry
                if sb:
                    try:
                        write_platform(sb, src, b, run, discovery_observed(b, t_obs, args.live_every))
                    except Exception as exc:
                        print(f"    (platform write failed: {exc})")
                if args.fixture_out:
                    write_test_fixture(Path(args.fixture_out), src, b)
                run["games_written"] += 1
                if b.status == "live":
                    live_set.append(g)
                print(f"    + {b.home_name} {entry['homeScore']}-{entry['awayScore']} {b.away_name} ({b.status}, {len(b.stints)} stints)")
            # LIVE LOOP: keep the in-progress games moving every --live-every seconds until the budget
            # runs out or every one of them has finished (then the next scheduled pass takes over)
            deadline = time.time() + max(0, args.live_loop)
            while args.live_loop and live_set and time.time() < deadline and not args.dry_run:
                time.sleep(args.live_every)
                still = []
                for g in live_set:
                    t_obs = time.time()
                    try:
                        b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
                    except Exception as exc:
                        print(f"    ! {g.external_id}: {exc}"); still.append(g); continue
                    if not b:
                        still.append(g); continue
                    prev = entries.get(g.external_id)
                    if prev and prev.get("hash") == b.payload_hash:
                        still.append(g); continue                     # nothing new on the feed yet
                    raw_ref = None
                    if sb:
                        try:
                            raw_ref = write_supabase_feed(sb, src, b, entry_for(b, prev, None, g))
                        except Exception as exc:
                            print(f"    (supabase feed write failed: {exc})")
                    entries[g.external_id] = entry_for(b, prev, raw_ref, g)
                    if sb:
                        try:
                            write_platform(sb, src, b, run, discovery_observed(b, t_obs, args.live_every))
                        except Exception as exc:
                            print(f"    (platform write failed: {exc})")
                    print(f"    ~ {b.home_name} {entries[g.external_id]['homeScore']}-{entries[g.external_id]['awayScore']} {b.away_name} ({b.status}) {datetime.now(timezone.utc).strftime('%H:%M:%S')}")
                    if b.status == "live":
                        still.append(g)
                live_set = still
            if not args.dry_run:
                # games moved between phases: both tables are rebuilt, as the console does
                for cid in sorted(run.pop("_recompute", set()) or []):
                    for fn in ("recompute_standings", "compute_season_awards", "advance_bracket"):
                        try:
                            sb.rpc(fn, {"p_competition": cid})
                        except Exception:
                            pass
                if feed and not args.live_only and not args.catch_up:
                    feed.update_index(src, {k: v for k, v in entries.items() if v.get("hash") or v.get("date")})
                if sb:
                    try:
                        write_supabase_competition(sb, src, len([v for v in entries.values() if v.get("hash")]))
                    except Exception as exc:
                        print(f"    (feed_competitions upsert failed: {exc})")
        except Exception as exc:                                             # keep polling other sources
            err = f"{type(exc).__name__}: {exc}"[:500]; exit_code = 1
            print(f"   !! {err}")
        finally:
            if sb and src.get("id"):
                try:
                    sb.patch("schedule_sources", f"id=eq.{src['id']}", {"last_polled_at": now_iso(), **({"last_ok_at": now_iso(), "last_error": None} if not err else {"last_error": err})})
                    if run_id:
                        sb.patch("ingest_runs", f"id=eq.{run_id}", {"finished_at": now_iso(), "games_seen": run["games_seen"], "games_fetched": run["games_fetched"],
                                                                   "games_written": run["games_written"], "status": "failed" if err and not run["games_written"] else ("partial" if err else "ok"), "error": err})
                except Exception:
                    pass
            tot["seen"] += run["games_seen"]; tot["written"] += run["games_written"]
            if err:
                tot["error"] = err
            beat()
            print(f"   done in {time.time() - t0:.1f}s - seen {run['games_seen']}, fetched {run['games_fetched']}, written {run['games_written']}")
    # the queued row is closed whatever happened: `running` left behind is a league whose season
    # nobody can ask for again until the lease expires
    if job:
        backfill_finish(queue, job, "failed" if exit_code else "done", len(sources),
                        tot["seen"], tot["written"], tot["error"])
        return exit_code            # an old season has no live games - never chain the live lane
    # discovery is done - if a game is live or tips soon, ask the workflow to start the live lane
    if sb and not args.dry_run and not args.ids and not args.catch_up:
        try:
            now = datetime.now(timezone.utc)
            due, next_tip = live_due(sb, [s for s in sources if s["adapter"] == "fiba_livestats"], now)
            chain = bool(due) or (next_tip is not None and (next_tip - now).total_seconds() < MAIN_CHAIN_AHEAD)
            gh_output(chain="true" if chain else "false")
            if chain:
                print(f"{len(due)} live/due game(s)" + (f", next tip-off {next_tip.strftime('%d %b %H:%M')}Z" if next_tip else "") + " - asking the workflow to start the live lane")
        except Exception as exc:
            print(f"(live-lane check failed: {exc})")
    return exit_code


def write_test_fixture(d: Path, src: dict, b: GameBundle) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{b.external_id}.json").write_text(json.dumps({
        "external_id": b.external_id, "adapter": src["adapter"], "status": b.status, "home_name": b.home_name, "away_name": b.away_name,
        "tipoff_at": b.tipoff_at, "box": b.box, "team": b.team, "stints": b.stints, "lineups": b.lineups,
        "four_factors": b.four_factors, "shots": b.shots, "transition": b.transition, "pbp": b.pbp}, ensure_ascii=False), encoding="utf-8")
    if b.raw is not None:
        (d / f"{b.external_id}.raw.json").write_text(json.dumps(b.raw, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
