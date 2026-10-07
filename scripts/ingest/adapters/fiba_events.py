"""FIBA's own competitions — fiba.basketball event pages, shaped into the payload the platform reads.

WHICH COMPETITIONS. Everything FIBA runs itself and publishes on its Next.js site: the Basketball
Champions League (www.championsleague.basketball/en/games) and the FIBA Europe Cup
(www.fiba.basketball/en/events/fiba-europe-cup-26-27/games), and by the same pages any other FIBA
event (World Cup qualifiers, continental cups, youth championships). The games are scored on FIBA
LiveStats ("statisticSystem": "FLS") but the site never names a LiveStats id, so the Genius
data.json the rest of fiba_livestats.py reads is out of reach. It does not matter: the site's own
game page carries the same data, already rendered.

THE DATA IS IN THE PAGE, NOT BEHIND AN API. The pages are React Server Components: every piece of
data the page shows is serialised into `self.__next_f.push([1,"..."])` script chunks. Clicking the
Boxscore or Play-by-play tab fetches nothing (checked 2026-10-07 with every request recorded); the
game page's flight payload already holds
    game            the fixture: ids, clubs (teamA / teamB with organisationId and code), score,
                    round {roundId, roundName, gameSystem ...}, groupPairingCode, venue, tip-off
    playersTeamA/B  the rosters: personId, firstName, lastName, uniformNumber, position
    gameDetails     the box score: teamA/teamB.Children[] = {Id: "P_<personId>", Stats: {...}},
                    team Stats (with points in the paint, second chance, bench ...), quartersScores
    playByPlay      every action, by period: {act, ac, txt, Time, SA, SB, oId, pId, made, pts, x, y}
so ONE request per game is the whole game. rsc_rows() below decodes the flight rows.

ONE REQUEST IS THE WHOLE SEASON'S SCHEDULE as well: the competition's /games page carries every
fixture of every round (136 for the 2026-27 BCL, 308 for the Europe Cup), with the day picker a
client-side filter over it. Fixtures whose clubs are not yet known (later rounds) carry no teamA
and a 0001-01-01 date, and are skipped until they have both.

THE GAME URL NEEDS ITS SLUG, <gameId>-<codeA>-<codeB>. Any other form answers 308 to the right one,
and on www.fiba.basketball that redirect's Location is the URL twice, comma-joined - which is why
requests' own redirect-following cannot be used and _game_url() reads the header itself.

THE CLOCK. "Time" is remaining in the period, FIBA's own convention, so it is the event's `gt`.
Periods are keyed Q1..Q4 then OT1.. and the actions inside one are in play order ("order").

THE SHOT CHART IS A HALF COURT, 280 units across (15 m) with y measured out from the baseline, the
rim at (140, 29.4): fitted 2026-10-07 to the three-point line, every three at 6.96 m or more and
every two at 6.10 m or less, with 6.75 m between them. fibashape.at_rim_offset turns that into the
full-court percentages the zones are measured in. Free throws are plotted at (0, 0) and are not
shots on a chart.

THE FORMAT. The competition's /standings page is the competition's structure: every stage (group
phase, second-round groups, play-ins, quarter-finals, final four) with its rounds, groups,
pairings, game system and feeder labels ("1st of group A"). competition_format() reads it into a
plain description that run_ingest stores beside the competition (see fiba_format below).
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import urlparse

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

# A browser's agent, because the site answers anything else with a bare shell page.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0 Safari/537.36")
CREST = ("https://assets.fiba.basketball/image/upload/d_.logoflag--light--organisation_{org}.webp/"
         "w_256/f_auto/q_auto/.logoflag--light--organisation_{org}--competition_{comp}")
# the game centre's own live feed: box score, plays and rosters, on any FIBA event host
DETAIL = "https://www.fiba.basketball/en/events/api/game-live-info/{gid}/detail"

_PUSH = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')
_ROW = re.compile(r"([0-9a-f]+):")
_UNSET = "$undefined"

# --- the half-court chart -----------------------------------------------------------------------
CHART_UNITS_ACROSS = 280.0                 # 15 m
_M_PER_UNIT = 15.0 / CHART_UNITS_ACROSS
RIM_UX, RIM_UY = 140.0, 1.575 / _M_PER_UNIT  # the rim, 1.575 m out from the baseline

# --- play-by-play: the feed's codes in FIBA LiveStats' vocabulary, which is what stints.py and
# translate/fiba_events.py replay. The text is the only place a shot's kind and a turnover's or
# foul's reason are written, so those are read from it (FIBA's own English, the same every game).
SHOT_CODES = {"P2": "2pt", "P3": "3pt", "FT": "freethrow"}
# the last clause of a shot's text is its kind: "2PtsFG under the basket, fast break, driving layup"
SHOT_KINDS = (
    ("alley oop dunk", "alleyoopdunk"), ("alley oop", "alleyoop"), ("tip in dunk", "tipindunk"),
    ("tip in", "tipin"), ("tip-in", "tipin"), ("putback dunk", "dunk"), ("dunk", "dunk"),
    ("driving layup", "drivinglayup"), ("driving lay-up", "drivinglayup"),
    ("reverse layup", "reverselayup"), ("reverse lay-up", "reverselayup"),
    ("eurostep", "eurostep"), ("euro step", "eurostep"), ("hook shot", "hookshot"),
    ("layup", "layup"), ("lay-up", "layup"),
    ("pullup jump shot", "pullupjumpshot"), ("pull-up jump shot", "pullupjumpshot"),
    ("step back jump shot", "stepbackjumpshot"), ("step-back jump shot", "stepbackjumpshot"),
    ("fadeaway jump shot", "fadeawayjumpshot"), ("fade away jump shot", "fadeawayjumpshot"),
    ("turnaround jump shot", "turnaroundjumpshot"), ("floating jump shot", "floatingjumpshot"),
    ("jump shot", "jumpshot"),
)
# what FIBA tags a scoring play with itself, as the qualifiers stints.py buckets
QUALIFIERS = (("points from second chance", "2ndchance"), ("second chance", "2ndchance"),
              ("points from fastbreak", "fastbreak"), ("fast break", "fastbreak"),
              ("fastbreak", "fastbreak"), ("after turnover", "fromturnover"))
TURNOVERS = (("bad pass", "badpass"), ("ball handling", "ballhandling"), ("travel", "travel"),
             ("double dribble", "doubledribble"), ("out of bounds", "outofbounds"),
             ("backcourt", "backcourt"), ("shot clock", "shotclock"), ("24 sec", "shotclock"),
             ("8 sec", "8sec"), ("5 sec", "5sec"), ("3 sec", "3sec"), ("offensive foul", "offensive"))
FOULS = (("unsportsmanlike", "unsportsmanlike"), ("disqualifying", "disqualifying"),
         ("technical foul bench", "benchTechnical"), ("technical foul coach", "coachTechnical"),
         ("coach", "coachTechnical"), ("bench", "benchTechnical"), ("technical", "technical"),
         ("offensive", "offensive"))
PLAIN = {"ASS": ("assist", ""), "ST": ("steal", ""), "BS": ("block", ""), "RFOUL": ("foulon", "")}
# JB / JS (jump balls), TIMO (timeouts), VTR (coach's challenge) are not stats and not lineup
# changes, and are dropped as the other translated adapters drop them.

# Box score: the feed's player Stats keys -> FIBA's names
PLAYER_STATS = {
    "sPoints": "PTS", "sFieldGoalsMade": "FGM", "sFieldGoalsAttempted": "FGA",
    "sTwoPointersMade": "FG2M", "sTwoPointersAttempted": "FG2A",
    "sThreePointersMade": "FG3M", "sThreePointersAttempted": "FG3A",
    "sFreeThrowsMade": "FTM", "sFreeThrowsAttempted": "FTA",
    "sReboundsOffensive": "OR", "sReboundsDefensive": "DR", "sReboundsTotal": "REB",
    "sAssists": "AS", "sTurnovers": "TO", "sSteals": "ST", "sBlocks": "BS", "sBlocksReceived": "BSR",
    "sFoulsPersonal": "PF", "sFoulsOn": "FD", "sPlusMinusPoints": "PM",
}
# ...and the team's own extras, which no player has
TEAM_STATS = {"sPointsInThePaint": ("A_PIP",), "sPointsSecondChance": ("A_SCP",),
              "sPointsFastBreak": ("A_FBP",), "sPointsFromTurnovers": ("A_PAT",),
              # the page writes bench points twice (A_PFB and T_PFB), the live-info feed only as T_PFB
              "sBenchPoints": ("A_PFB", "T_PFB"), "sBiggestLead": ("A_BL",)}


# ================================================================== the page's flight payload ===
def rsc_text(page: str) -> str:
    """Every `self.__next_f.push([1, "..."])` chunk of a page, joined and unescaped."""
    return "".join(json.loads('"' + c + '"') for c in _PUSH.findall(page or ""))


def rsc_rows(s: str) -> dict:
    """The flight payload as {row id: value}. A row is `<hex id>:<JSON>`, `<hex id>:T<hex len>,<text>`
    (a text row: its length is in UTF-8 bytes), or a module/hint row (I[...], HL[...]) that holds
    no data and is skipped."""
    out, i, n = {}, 0, len(s)
    dec = json.JSONDecoder()
    while i < n:
        m = _ROW.match(s, i)
        if not m:
            j = s.find("\n", i)
            if j < 0:
                break
            i = j + 1
            continue
        rid, i = m.group(1), m.end()
        if s.startswith("T", i):
            c = s.find(",", i)
            if c < 0:
                break
            try:
                ln = int(s[i + 1:c], 16)
            except ValueError:
                i = c + 1
                continue
            text = s[c + 1:c + 1 + ln * 4].encode("utf-8")[:ln].decode("utf-8", "ignore")
            out[rid] = text
            i = c + 1 + len(text)
            continue
        if s.startswith(("I[", "HL[", "E{"), i):
            j = s.find("\n", i)
            i = (j + 1) if j >= 0 else n
            continue
        try:
            v, k = dec.raw_decode(s, i)
            out[rid] = v
            i = k
        except ValueError:
            j = s.find("\n", i)
            i = (j + 1) if j >= 0 else n
        while i < n and s[i] == "\n":
            i += 1
    return out


def _walk(v, fn):
    stack = [v]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            fn(x)
            stack.extend(x.values())
        elif isinstance(x, list):
            stack.extend(x)


def find_dicts(rows: dict, key: str) -> list:
    """Every object anywhere in the payload that has `key`."""
    hits: list = []
    for v in rows.values():
        _walk(v, lambda d: hits.append(d) if key in d else None)
    return hits


def resolve_paths(rows: dict, v, root_id: Optional[str] = None, root=None, depth: int = 0):
    """Undo the payload's de-duplication. A value that already appeared is written again as a path
    to its first appearance, "$1c:props:gameDetails:c:0:Children:0:Stats"; this puts the value back.
    Component references ($L.., $@..) are left alone: following them drags whole page trees in."""
    if depth > 40:
        return v
    if isinstance(v, str) and re.match(r"^\$[0-9a-f]+:", v):
        parts = v[1:].split(":")
        cur = rows.get(parts[0])
        if parts[0] == root_id and root is not None:
            cur, parts = root, parts[1:]
            if parts and parts[0] == "props":
                parts = parts[1:]
        else:
            parts = parts[1:]
            if isinstance(cur, list) and len(cur) == 4 and cur[0] == "$" and parts and parts[0] == "props":
                cur, parts = cur[3], parts[1:]
        for p in parts:
            if isinstance(cur, list):
                try:
                    cur = cur[int(p)]
                except (ValueError, IndexError):
                    return None
            elif isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
        return resolve_paths(rows, cur, root_id, root, depth + 1)
    if isinstance(v, list):
        return [resolve_paths(rows, x, root_id, root, depth + 1) for x in v]
    if isinstance(v, dict):
        return {k: resolve_paths(rows, x, root_id, root, depth + 1) for k, x in v.items()}
    return v


def game_props(page: str) -> Optional[dict]:
    """The game centre's data, from a game page: {game, playersTeamA/B, gameDetails, playByPlay,
    pageStatus}, with de-duplicated paths put back. None for a page without it (not a game page)."""
    rows = rsc_rows(rsc_text(page))
    for rid, v in rows.items():
        if isinstance(v, list) and len(v) == 4 and v[0] == "$" and isinstance(v[3], dict) \
                and "game" in v[3] and ("gameDetails" in v[3] or "playByPlay" in v[3] or "playersTeamA" in v[3]):
            return resolve_paths(rows, v[3], rid, v[3])
    for d in find_dicts(rows, "game"):
        if isinstance(d.get("game"), dict) and "gameId" in d["game"]:
            return d
    return None


#: game.content.status of a game that is over: 5 on the live-info feed, 999 on the page's copy
FINAL_STATUSES = {5, 999}


def props_from_detail(d: dict) -> Optional[dict]:
    """The live-info JSON in the game page's shape, so one translation serves both:
        game.content          -> gameDetails   (c[] carries each club's Name / Code / Id "T_<org>")
        periodActions.content -> playByPlay
        gameCompetitors       -> playersTeamA / playersTeamB
    None for an empty answer (a game the live cache no longer holds, or one not yet opened)."""
    gc = ((d or {}).get("game") or {}).get("content") or {}
    if not gc.get("c"):
        return None
    pa = ((d.get("periodActions") or {}).get("content")) or {}
    comp = ((d.get("gameCompetitors") or {}).get("content")) or {}
    by_id = {str(c.get("Id")): c for c in gc["c"] if isinstance(c, dict)}

    def club(side: str) -> dict:
        tid = str((gc.get(side) or {}).get("Id") or comp.get(side + "Id") or "")
        c = by_id.get(tid) or {}
        return {"organisationId": re.sub(r"^T_", "", tid) or None, "code": (c.get("Code") or "").strip(),
                "officialName": (c.get("Name") or "").strip(), "shortName": (c.get("Name") or "").strip(),
                "logo": c.get("TeamLogoUrlLight") or c.get("TeamLogoUrl")}

    status = _num(gc.get("status"), 0)
    final = status in FINAL_STATUSES
    game = {"teamA": club("teamA"), "teamB": club("teamB"),
            "teamAScore": (gc.get("teamA") or {}).get("Score"), "teamBScore": (gc.get("teamB") or {}).get("Score"),
            "isLive": (not final) and bool(pa.get("items")), "currentPeriodStatus": gc.get("CurrentPeriodStatus"),
            "competition": {}}
    return {"game": game, "gameDetails": gc, "playByPlay": pa,
            "playersTeamA": comp.get("playersTeamA") or [], "playersTeamB": comp.get("playersTeamB") or [],
            "pageStatus": "AFTER" if final else ("LIVE" if pa.get("items") else "BEFORE")}


def club_name(t: dict) -> str:
    """The name FIBA shows: shortName ("SL Benfica", "Surne Bilbao"). officialName is the club's
    registered company ("Sport Lisboa e Benfica", "C.D. Basket Bilbao Berri S.A.D."), and the
    live-info feed, which is what a game is built from, only ever carries the short one."""
    return ((t or {}).get("shortName") or (t or {}).get("officialName") or "").strip()


def schedule_games(page: str) -> list:
    """Every fixture object on a competition's /games page, once each."""
    seen: dict = {}
    for d in find_dicts(rsc_rows(rsc_text(page)), "gameId"):
        if "gameDateTime" in d and "round" in d and d.get("gameId") not in seen:
            seen[d["gameId"]] = d
    return list(seen.values())


# ===================================================================== small readers ===
def _undef(v):
    return None if v == _UNSET else v


def _num(v, default=0):
    return S.num(_undef(v), default)


def _utc(s) -> Optional[str]:
    """'2026-10-06T15:45:00' (already UTC, unmarked) -> ISO with +00:00; FIBA's 0001-01-01 is 'no date'."""
    s = str(_undef(s) or "")
    if not s or s.startswith("0001"):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "")[:19])
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


def _clock(t) -> str:
    """'9:27' -> '09:27', the MM:SS every other adapter's gt is in."""
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", str(t or ""))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else ""


def period_number(key: str) -> int:
    """Q1..Q4 -> 1..4, OT1/OT2 (or a bare OT) -> 5, 6 ..."""
    k = str(key or "").upper()
    m = re.match(r"Q(\d)", k)
    if m:
        return int(m.group(1))
    m = re.match(r"OT(\d*)", k)
    if m:
        return 4 + int(m.group(1) or 1)
    return 0


def _pick(text: str, table) -> str:
    t = (text or "").lower()
    for needle, value in table:
        if needle in t:
            return value
    return ""


def shot_kind(text: str) -> str:
    """The FIBA subType of a shot, from the last clause of its text. 'jumpshot' when it names none."""
    clause = re.sub(r"\b(made|missed)\s*$", "", (text or "").lower()).strip().rstrip(",")
    last = clause.split(",")[-1]
    return _pick(last, SHOT_KINDS) or _pick(clause, SHOT_KINDS) or "jumpshot"


def qualifiers(text: str) -> list:
    t = (text or "").lower()
    out = []
    for needle, q in QUALIFIERS:
        if needle in t and q not in out:
            out.append(q)
    return out


def chart_pct(x, y) -> Optional[tuple]:
    """The half-court units (280 across, y from the baseline) -> the full-court percentages, placed
    against the left rim. None for a shot with no marker (free throws are drawn at 0, 0)."""
    x, y = _num(x, None), _num(y, None)
    if x is None or y is None or (x == 0 and y == 0):
        return None
    across_cm = (x - RIM_UX) * _M_PER_UNIT * 100.0
    toward_cm = (y - RIM_UY) * _M_PER_UNIT * 100.0
    return S.at_rim_offset(across_cm, toward_cm)


def _minutes(tp) -> str:
    m = re.match(r"^\s*(\d+):(\d{1,2})", str(_undef(tp) or ""))
    return f"{int(m.group(1))}:{int(m.group(2)):02d}" if m else "0:00"


def _pid(v) -> str:
    v = _undef(v)
    if v in (None, ""):
        return ""
    return re.sub(r"^P_", "", str(v))


# ============================================================================ the adapter ===
class FibaEventsAdapter(FibaLiveStatsAdapter):
    name = "fiba_events"
    min_request_gap_s = 1.0          # one page per game; the site is a CDN, but it is FIBA's
    _slugs: dict = {}                # gameId -> the game page's URL, learnt from the schedule

    # ------------------------------------------------------------------- fetching ---
    def _get(self, url: str, redirects: bool = True):
        gap = time.time() - getattr(self, "_last_get", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_get = time.time()
        return requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en"},
                            timeout=45, allow_redirects=redirects)

    @staticmethod
    def schedule_url(schedule_url: str, config: dict) -> str:
        """The configured /games URL with its season filled in: '{season}' -> '26-27' for 2026-27,
        because the Europe Cup's address carries the season (fiba-europe-cup-26-27) and a URL that
        is edited by hand every summer is one that is wrong every autumn."""
        m = re.match(r"(\d{4})", str(config.get("season") or ""))
        if m:
            y = int(m.group(1))
        else:
            try:
                from feedplatform import season_name_for     # the platform's own idea of "this season"
                y = int(season_name_for()[:4])
            except Exception:                                 # pragma: no cover - outside the ingest
                now = datetime.now(timezone.utc)
                y = now.year - (0 if now.month >= 7 else 1)
        url = (schedule_url or "").split("#")[0]              # a stage source's #<stage> marker
        return url.replace("{season}", f"{y % 100:02d}-{(y + 1) % 100:02d}").replace("{year}", str(y)).rstrip("/")

    def follow(self, url: str, hops: int = 4):
        """GET a URL, following redirects by hand: www.fiba.basketball's Location header is the
        target twice, comma-joined, which requests' own following turns into a 404. Returns
        (final url, response)."""
        r = None
        for _ in range(hops + 1):
            r = self._get(url, redirects=False)
            loc = (r.headers.get("location") or "").split(",")[0].strip()
            if r.status_code not in (301, 302, 303, 307, 308) or not loc:
                return url, r
            if loc.startswith("/"):
                u = urlparse(url)
                loc = f"{u.scheme}://{u.netloc}{loc}"
            url = loc
        return url, r

    _bases: dict = {}                # (schedule url, season) -> the /games page that holds that season

    def games_base(self, schedule_url: str, config: dict) -> str:
        """The /games page for the season asked for.

        The ordinary pass reads the configured page as it is. A pass for a named season (a backfill:
        adapter_config.season) reads adapter_config.season_url instead when the source has one,
        because the Champions League's own site shows its season being played only: a past season
        lives on www.fiba.basketball, whose /events/basketball-champions-league-25-26/games answers
        308 to the competition's history page (/en/history/112-.../208962/games), the whole season
        on it. The Europe Cup needs none: its address carries the season ({season})."""
        key = (schedule_url, str(config.get("season") or ""), config.get("season_url"))
        if key in self._bases:
            return self._bases[key]
        base = self.schedule_url(schedule_url, config)
        if config.get("season") and config.get("season_url"):
            url, r = self.follow(self.schedule_url(config["season_url"], config))
            if r is not None and r.status_code == 200 and schedule_games(r.text):
                self._pages[url.rstrip("/")] = (time.time(), r.text)
                base = url.rstrip("/")
        self._bases[key] = base
        return base

    def standings_url(self, schedule_url: str, config: dict) -> str:
        return re.sub(r"/games$", "", self.games_base(schedule_url, config)) + "/standings"

    def _game_url(self, gid: str, config: dict) -> Optional[str]:
        """The game page's own URL: from the schedule when it has been read this run, otherwise
        from the site's redirect of /games/<id> (fetch() is handed the adapter config, not the
        source row, so the page comes from adapter_config.games_url)."""
        gid = str(gid)
        if gid in self._slugs:
            return self._slugs[gid]
        if not config.get("games_url"):
            return None
        base = self.games_base(config["games_url"], config)
        url, r = self.follow(f"{base}/{gid}")
        if r is not None and r.status_code == 200:
            self._slugs[gid] = url
            self._pages[url] = (time.time(), r.text)      # the page itself: fetch() reads it next
            return url
        return None

    # ------------------------------------------------------------------- schedule ---
    _pages: dict = {}                # url -> (fetched at, text): a pass reads one page per stage source

    def page(self, url: str, ttl: float = 120.0) -> Optional[str]:
        """A schedule or standings page, read once per couple of minutes however many stage sources
        (fiba_format.stage_sources) ask for it in one pass."""
        hit = self._pages.get(url)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        _, r = self.follow(url)
        if r is None or r.status_code in (403, 404):
            return None
        r.raise_for_status()
        self._pages[url] = (time.time(), r.text)
        return r.text

    def season_games(self, schedule_url: str, config: dict) -> list:
        """Every fixture object of the season, placeholders included."""
        page = self.page(self.games_base(schedule_url, config))
        return schedule_games(page) if page else []

    def competition_format_for(self, schedule_url: str, config: dict) -> Optional[dict]:
        """The competition's structure (competition_format) with each pairing's feeders filled in
        from the fixtures. None when the standings page cannot be read this pass (a history
        page's standings carry no stages: a past season is ingested as one competition)."""
        page = self.page(self.standings_url(schedule_url, config), ttl=600.0)
        if not page:
            return None
        fmt = competition_format(page)
        if not fmt["stages"]:
            return None
        return format_with_games(fmt, self.season_games(schedule_url, config))

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        """The season's fixtures with both clubs known - or, for a stage source
        (adapter_config.round_ids, see fiba_format.py), that stage's."""
        base = self.games_base(schedule_url, config)
        rounds = {int(x) for x in (config.get("round_ids") or [])}
        out = []
        for g in self.season_games(schedule_url, config):
            a, b = _undef(g.get("teamA")) or {}, _undef(g.get("teamB")) or {}
            if not club_name(a) or not club_name(b):
                continue                      # a later round whose clubs are not known yet
            if rounds and _num((_undef(g.get("round")) or {}).get("roundId"), -1) not in rounds:
                continue
            gid = str(g["gameId"])
            self._slugs[gid] = f"{base}/{gid}-{a.get('code') or 'A'}-{b.get('code') or 'B'}"
            out.append(self.schedule_game(g))
        self.last_competitions = []
        return out

    @staticmethod
    def schedule_game(g: dict) -> ScheduleGame:
        a, b = _undef(g.get("teamA")) or {}, _undef(g.get("teamB")) or {}
        rnd = _undef(g.get("round")) or {}
        comp = _undef(g.get("competition")) or {}
        live = bool(g.get("isLive"))
        played = (not live) and _num(g.get("liveGameStatus")) == 999 and \
            (g.get("teamAScore") is not None) and (_num(g.get("teamAScore")) + _num(g.get("teamBScore")) > 0)
        status = "live" if live else ("final" if played else "scheduled")
        if g.get("isPostponed"):
            status = "scheduled"

        def crest(t):
            org = _undef(t.get("organisationId"))
            return CREST.format(org=org, comp=comp.get("competitionId")) if org and comp.get("competitionId") else None

        group = str(_undef(g.get("groupPairingCode")) or "").strip()
        in_group = rnd.get("roundType") == "G" and group
        return ScheduleGame(
            external_id=str(g["gameId"]),
            home_name=club_name(a), away_name=club_name(b),
            tipoff_at=_utc(g.get("gameDateTimeUTC")),
            status=status,
            extra={"home_code": (a.get("code") or "").strip(), "away_code": (b.get("code") or "").strip(),
                   "home_logo": crest(a), "away_logo": crest(b),
                   "home_score": g.get("teamAScore") if status != "scheduled" else None,
                   "away_score": g.get("teamBScore") if status != "scheduled" else None,
                   "venue": (str(_undef(g.get("venueName")) or "")).strip() or None,
                   "venue_city": (str(_undef(g.get("hostCity")) or "")).strip() or None,
                   "venue_country": (str(_undef(g.get("hostCountry")) or "")).strip() or None,
                   "timezone": _undef(g.get("ianaTimeZone")),
                   # the stage the game belongs to, as the site names it
                   "round_id": _undef(rnd.get("roundId")), "round_name": (rnd.get("roundName") or "").strip(),
                   "round_code": rnd.get("roundCode"), "round_type": rnd.get("roundType"),
                   "game_system": rnd.get("gameSystemCode"),
                   "group": group if in_group else "",
                   "pairing": group if not in_group else "",
                   # what groups.learn reads (adapter_config.groups_from_feed): a group-phase game
                   # is between two members of its group
                   "home_group": group if in_group else "", "away_group": group if in_group else "",
                   "home_official": (a.get("officialName") or "").strip(),
                   "away_official": (b.get("officialName") or "").strip(),
                   "game_number": _undef(g.get("gameNumber")),
                   "home_team_id": _undef(a.get("teamId")), "away_team_id": _undef(b.get("teamId")),
                   "competition_id": comp.get("competitionId"), "competition_code": comp.get("competitionCode")})

    # ----------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        """The live-info JSON first (one request, 20 s cache, and the only thing that has the box
        score and the plays WHILE a game is being played - the page has neither until it is over),
        then the game page for a game the live cache has let go of (it answers an empty {"game": {}}
        for the September qualifiers already)."""
        p, recv = None, None
        url = DETAIL.format(gid=external_id)
        if config.get("_fresh"):
            url += f"?_={int(time.time() * 1000)}"
        try:
            r = self._get(url)
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                recv = int(time.time() * 1000)
                p = props_from_detail(r.json())
        except (requests.RequestException, ValueError):
            p = None
        if p is None:
            page_url = self._game_url(external_id, config)
            text = self.page(page_url, ttl=5.0) if page_url else None
            if not text:
                return None
            recv = int(time.time() * 1000)
            p = game_props(text)
        if not p:
            return None
        raw = self.payload(p)
        if raw is None:
            return None
        b = self.bundle_from_raw(raw, str(external_id), config)
        b.feed_recv_ms = recv
        g = p.get("game") or {}
        b.venue = (str(_undef(g.get("venueName")) or "")).strip() or None
        b.tipoff_at = config.get("_tipoff_at") or _utc(g.get("gameDateTimeUTC"))
        return b

    @classmethod
    def payload(cls, p: dict) -> Optional[dict]:
        """The game centre's data as a FIBA LiveStats data.json. None before the line-ups exist."""
        g = p.get("game") or {}
        gd = _undef(p.get("gameDetails")) or {}
        sides_gd = [_undef(gd.get("teamA")) or {}, _undef(gd.get("teamB")) or {}]
        if not any(s.get("Children") for s in sides_gd):
            return None
        clubs = [_undef(g.get("teamA")) or {}, _undef(g.get("teamB")) or {}]
        rosters_in = [p.get("playersTeamA") or [], p.get("playersTeamB") or []]
        comp = _undef(g.get("competition")) or {}

        rosters = []
        for i in (0, 1):
            people = {str(x.get("personId")): x for x in rosters_in[i] if isinstance(x, dict)}
            players = {}
            for child in sides_gd[i].get("Children") or []:
                pno = _pid(child.get("Id"))
                if not pno:
                    continue
                st = _undef(child.get("Stats")) or {}
                who = people.get(pno, {})
                stats = {k: _num(st.get(v)) for k, v in PLAYER_STATS.items()}
                players[pno] = S.player(
                    first=(who.get("firstName") or "").strip(), last=(who.get("lastName") or "").strip(),
                    shirt=str(_undef(who.get("uniformNumber")) or ""),
                    starter=1 if st.get("Starter") is True else 0, active=1,
                    minutes=_minutes(st.get("TP")), position=(who.get("position") or "").strip(),
                    stats=stats)
                players[pno]["eff_1"] = _num(st.get("EFF"))
                if who.get("isCaptain"):
                    players[pno]["captain"] = 1
            # a player on the team sheet who never reached the box score (not dressed in time)
            for pno, who in people.items():
                if pno not in players:
                    players[pno] = S.player(first=(who.get("firstName") or "").strip(),
                                            last=(who.get("lastName") or "").strip(),
                                            shirt=str(_undef(who.get("uniformNumber")) or ""),
                                            active=1, position=(who.get("position") or "").strip())
            rosters.append(players)

        orgs = {str(_undef(c.get("organisationId")) or ""): i + 1 for i, c in enumerate(clubs)}
        numbered: dict = {}
        shots: list = [[], []]
        events = cls.events(p.get("playByPlay") or {}, orgs, rosters, shots)
        quarters = cls.quarters(gd)

        tm = []
        for i in (0, 1):
            tst = _undef(sides_gd[i].get("Stats")) or {}
            totals = {k: _num(tst.get(v)) for k, v in PLAYER_STATS.items() if v in tst}
            for k in S.STATS:
                totals.setdefault(k, S.totals_of(rosters[i]).get(k, 0))
            for k, keys in TEAM_STATS.items():
                v = next((x for x in keys if x in tst), None)
                if v:
                    totals[k] = _num(tst.get(v))
            org = _undef(clubs[i].get("organisationId"))
            logo = CREST.format(org=org, comp=comp.get("competitionId")) if org and comp.get("competitionId") \
                else clubs[i].get("logo")
            score = _undef(sides_gd[i].get("Score"))
            if score is None:
                score = g.get("teamAScore" if i == 0 else "teamBScore")
            tm.append(S.team(club_name(clubs[i]), (clubs[i].get("code") or "").strip(),
                             score=score, quarters=quarters[i], players=rosters[i], shots=shots[i],
                             logo=logo, totals=totals, short_name=club_name(clubs[i])))
        played = cls.played(p, events)
        raw = S.game(tm[0], tm[1], played=played, pbp=events)
        top = max((e.get("actionNumber") or 0 for e in raw["pbp"]), default=0)
        for e in raw["pbp"]:
            if e.get("actionNumber") is None:
                top += 1
                e["actionNumber"] = top
        lc = _num((_undef(gd.get("Stats")) or {}).get("A_LC"), None)
        if lc is not None:
            for t in tm:
                t["tot_sLeadChanges"] = lc
        # the scoreboard, where a data.json keeps it: run_ingest's live checks (_looks_finished,
        # feed_abandoned) and the game state read clock / period / periodType off the top level
        per = period_number(_undef(gd.get("CurrentPeriod")) or g.get("currentPeriod") or "")
        if per:
            raw["period"] = per - 4 if per > 4 else per
            raw["periodType"] = "OVERTIME" if per > 4 else "REGULAR"
        clock = _clock(_undef(gd.get("RC")) or g.get("chrono"))
        if clock:
            raw["clock"] = clock
        return raw

    @staticmethod
    def quarters(gd: dict) -> list:
        """[[q1..q4], [q1..q4]], points scored IN each quarter (quartersScores), not the running score."""
        out = [[], []]
        for row in _undef(gd.get("quartersScores")) or []:
            if period_number(row.get("period")) <= 4:
                out[0].append(_num(row.get("teamA")))
                out[1].append(_num(row.get("teamB")))
        return out

    @staticmethod
    def played(p: dict, events: list) -> bool:
        """Over is the feed's own End of game. Without one, a page past its game ('AFTER') with the
        last period ended and somebody ahead - never the live flag alone (see euroleague._played)."""
        if any(e.get("actionType") == "game" and e.get("subType") == "end" for e in events):
            return True
        g = p.get("game") or {}
        gd = _undef(p.get("gameDetails")) or {}
        if g.get("isLive") or p.get("pageStatus") != "AFTER":
            return False
        ended = str(_undef(gd.get("CurrentPeriodStatus")) or g.get("currentPeriodStatus") or "") == "E"
        return ended and _num(g.get("teamAScore")) != _num(g.get("teamBScore"))

    @classmethod
    def events(cls, pbp: dict, orgs: dict, rosters: list, shots: Optional[list] = None) -> list:
        """The play-by-play as the event stream stints.py replays, numbered 1..n in play order.

        A shot's marker goes onto its club's chart carrying the number of its play, which is how
        stints.py finds a shot's location and the game page puts a dot under a play."""
        items = _undef(pbp.get("items")) or {}
        blocks = sorted(((period_number(k), v) for k, v in items.items() if period_number(k)), key=lambda x: x[0])
        out: list = []
        last_foul = None
        FOUL_REACH = 3

        def add(ev: dict) -> dict:
            ev["actionNumber"] = len(out) + 1
            out.append(ev)
            return ev

        for period, blk in blocks:
            full = "10:00" if period <= 4 else "05:00"
            gt = full
            rows = [a for a in (_undef(blk.get("items")) or []) if isinstance(a, dict)]
            rows.sort(key=lambda a: _num(a.get("order"), 0))
            for a in rows:
                ac = str(a.get("ac") or "").upper()
                gt = _clock(a.get("Time")) or gt
                if ac in ("STARTG", "STARTP"):
                    add({"actionType": "period", "subType": "start", "period": period, "gt": full, "tno": 0})
                    continue
                if ac in ("ENDP", "ENDG"):
                    add({"actionType": "game" if ac == "ENDG" else "period", "subType": "end",
                         "period": period, "gt": "00:00", "tno": 0})
                    continue
                tno = orgs.get(str(_undef(a.get("oId")) or ""), 0)
                if not tno:
                    continue
                pno = _pid(a.get("pId"))
                if pno and pno not in rosters[tno - 1]:
                    pno = ""                   # a coach or a staff member: never a player on court
                ev = {"period": period, "gt": gt, "tno": tno, "pno": pno,
                      "s1": _num(a.get("SA")), "s2": _num(a.get("SB"))}
                txt = str(a.get("txt") or "")
                if ac in SHOT_CODES:
                    kind = SHOT_CODES[ac]
                    made = 1 if a.get("made") is True or re.search(r"\bmade\b", txt, re.I) else 0
                    ev["actionType"], ev["success"] = kind, made
                    if kind != "freethrow":
                        ev["subType"] = shot_kind(txt)
                    q = qualifiers(txt)
                    if q:
                        ev["qualifier"] = q
                    add(ev)
                    pct = chart_pct(a.get("x"), a.get("y")) if kind != "freethrow" else None
                    if pct and shots is not None:
                        s = S.shot(pct[0], pct[1], made=bool(made), three=kind == "3pt",
                                   pno=pno or None, period=period)
                        s["actionNumber"] = ev["actionNumber"]
                        if ev.get("subType"):
                            s["subType"] = ev["subType"]
                        shots[tno - 1].append(s)
                    continue
                if ac == "SUBST":
                    if not pno:
                        continue
                    ev["actionType"] = "substitution"
                    ev["subType"] = "in" if str(a.get("in") or "").upper() == "IN" else "out"
                elif ac in ("REB", "TREB"):
                    ev["actionType"] = "rebound"
                    ev["subType"] = "offensive" if "offensive" in txt.lower() else "defensive"
                    if ac == "TREB":
                        ev["qualifier"], ev["pno"] = ["team"], ""
                elif ac in ("TO", "TTO"):
                    ev["actionType"], ev["subType"] = "turnover", _pick(txt, TURNOVERS) or "other"
                    if ac == "TTO":
                        ev["pno"] = ""
                elif ac in ("FOUL", "CFOUL"):
                    sub = _pick(txt, FOULS) or "personal"
                    if ac == "CFOUL" and sub in ("personal", "technical"):
                        sub = "benchTechnical"
                    ev["actionType"], ev["subType"] = "foul", sub
                elif ac in PLAIN:
                    ev["actionType"], ev["subType"] = PLAIN[ac]
                    if ac == "RFOUL" and last_foul is not None and len(out) + 1 - last_foul <= FOUL_REACH:
                        ev["previousAction"] = last_foul
                else:
                    continue
                add(ev)
                if ac in ("FOUL", "CFOUL"):
                    last_foul = ev["actionNumber"]
        return out


# ======================================================================= the format ===
def _stage_kind(st: dict) -> str:
    t = str(st.get("type") or "").lower()
    if t == "groups":
        return "groups"
    if t == "bracket":
        return "bracket"
    return "pairings"


def competition_format(page: str) -> dict:
    """A competition's structure, from its /standings page:

        {"stages": [{"name": "Regular Season", "code": "RS", "kind": "groups"|"pairings"|"bracket",
                     "status": "PROGR", "current": true, "start": "2026-10-06", "end": "2026-12-23",
                     "round_ids": [31110],
                     "groups": [{"name": "A", "teams": [teamId, ...] (in table order),
                                 "from": ["1st of group A", ...], "qualify": 2, "game_ids": [...]}],
                     "rounds": [{"round_id": 31113, "name": "Quarter-Finals", "system": "BOF3",
                                 "system_name": "Best of 3",
                                 "pairings": [{"code": "33", "team_a": id|None, "team_b": id|None,
                                               "winner": id|None, "game_ids": [...]}]}],
                     "third_place": {...same as a round...} or None}],
         "teams": {teamId: {"name", "short", "code", "org"}}}

    Every competition FIBA publishes is one of these three kinds of stage, so this one reader is
    the format of all of them; nothing here is particular to the Champions League."""
    rows = rsc_rows(rsc_text(page))
    stages = []
    for st in find_dicts(rows, "standingHeaderName"):
        if "roundIds" not in st:
            continue
        data = _undef(st.get("data")) or {}
        kind = _stage_kind(st)
        out = {"name": (st.get("standingHeaderName") or "").strip(), "code": st.get("standingHeaderCode"),
               "kind": kind, "status": st.get("roundStatusCode"), "current": bool(st.get("current")),
               "start": (_utc(st.get("startDate")) or "")[:10] or None,
               "end": (_utc(st.get("endDate")) or "")[:10] or None,
               "round_ids": list(st.get("roundIds") or []), "groups": [], "rounds": [], "third_place": None}
        for g in _undef(data.get("groups")) or []:
            ts = sorted((t for t in g.get("teamsStats") or [] if isinstance(t, dict)),
                        key=lambda t: _num(t.get("rank"), 99))
            out["groups"].append({
                "name": str(g.get("groupName") or "").strip(),
                "teams": [_undef(t.get("team")) for t in ts if _undef(t.get("team")) is not None],
                "slots": len(ts),
                "from": [str(x) for x in (g.get("teamFroms") or []) if x],
                "qualify": _undef(g.get("numberOfTeamsQualifying")),
                "game_ids": list(g.get("gameIds") or [])})

        def rnd(r: dict) -> dict:
            return {"round_id": r.get("roundId"), "name": (r.get("roundName") or r.get("roundKindName") or out["name"]).strip(),
                    "system": r.get("gameSystemCode"), "system_name": r.get("gameSystem"),
                    "pairings": [{"code": str(x.get("groupCode") or ""), "team_a": _undef(x.get("teamA")),
                                  "team_b": _undef(x.get("teamB")), "winner": _undef(x.get("winnerTeamId")),
                                  "game_ids": list(x.get("gamesIds") or [])}
                                 for x in r.get("groups") or [] if isinstance(x, dict)]}

        out["rounds"] = [rnd(r) for r in _undef(data.get("rounds")) or [] if isinstance(r, dict)]
        sf = _undef(data.get("smallFinalRound"))
        if isinstance(sf, dict):
            out["third_place"] = rnd(sf)
        stages.append(out)
    teams = {}
    for d in find_dicts(rows, "officialName"):
        tid = _undef(d.get("teamId"))
        if tid is not None and "code" in d and tid not in teams:
            teams[tid] = {"name": (d.get("officialName") or "").strip(), "short": (d.get("shortName") or "").strip(),
                          "code": (d.get("code") or "").strip(), "org": _undef(d.get("organisationId"))}
    # Stages in the order the competition plays them: dated ones by date, then the undated ones by
    # round id (FIBA numbers a competition's rounds as it creates them, in playing order; the page's
    # own order does not survive the payload's row layout).
    stages.sort(key=lambda s: (s["start"] is None, s["start"] or "", min(s["round_ids"] or [10 ** 9])))
    _qualifying(stages)
    return {"stages": stages, "teams": teams}


_FROM = re.compile(r"^\s*(\d+)(?:st|nd|rd|th)\s+of\s+group\s+(\S+)\s*$", re.I)


def _qualifying(stages: list, game_froms=()) -> None:
    """How many go through from each group, where FIBA leaves numberOfTeamsQualifying empty (it
    always does, so far): the deepest place any LATER stage names as a feeder - "2nd of group H"
    in a play-in means at least two leave group H. A stage's `qualifiers` is the most from any of
    its groups, which is what competitions.qualifiers holds (the line drawn under the table)."""
    froms: list = list(game_froms)
    for st in stages:
        for g in st["groups"]:
            froms.extend(g["from"])
        for r in st["rounds"] + ([st["third_place"]] if st["third_place"] else []):
            froms.extend(r.get("from") or [])
    deepest: dict = {}
    for f in froms:
        m = _FROM.match(str(f))
        if m:
            k = m.group(2).upper()
            deepest[k] = max(deepest.get(k, 0), int(m.group(1)))
    for st in stages:
        for g in st["groups"]:
            if not g.get("qualify") and g["name"].upper() in deepest:
                g["qualify"] = deepest[g["name"].upper()]
        st["qualifiers"] = max((g.get("qualify") or 0 for g in st["groups"]), default=0)


def format_with_games(fmt: dict, games: list) -> dict:
    """Fill in what only the fixtures know: each pairing's feeders ("Winner of Game 157",
    "2nd of group H" - the schedule's teamAFrom / teamBFrom) and how many leave each group
    when the feeders are on games rather than on later groups (the BCL's play-ins)."""
    by_id = {g.get("gameId"): g for g in games}
    froms = []
    for st in fmt["stages"]:
        for r in st["rounds"] + ([st["third_place"]] if st["third_place"] else []):
            for p in r["pairings"]:
                g = next((by_id[i] for i in p["game_ids"] if i in by_id), None)
                if g:
                    a, b = _undef(g.get("teamAFrom")), _undef(g.get("teamBFrom"))
                    p["from_a"], p["from_b"] = a, b
                    froms += [x for x in (a, b) if x]
    _qualifying(fmt["stages"], froms)
    return fmt
