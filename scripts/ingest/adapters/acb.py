"""Liga Endesa (ACB) — its own API, shaped into the payload the platform already reads.

TWO SOURCES, ONE REQUEST EACH:

    acb.com/es/liga/calendario?temporada=<N>                     the whole season's fixtures
    api2.acb.com/api/matchdata/PlayByPlay/play-by-play?matchId=  one game, everything in it

THE SEASON AXIS IS AN OFFSET, NOT A YEAR. temporada = start year - 1935, so 2026-27 is 91 and
2025-26 is 90. It is derived from the platform's own season name here; every ACB scraper pins the
offset in a literal and the literal is always a year stale (scrape-now.py still says 90 today).

THE SCHEDULE NEEDS NO BROWSER, which is the one thing the scraper got wrong. acb.com is a Next.js
App Router site, and the rendered markup IS a skeleton — times come out as "XX:XX" and an
undetermined playoff game as "XXXXXXXX" — which is why the scraper drives Selenium at it. But the
server ships the data that hydrates that skeleton in the same response, inside the RSC flight
stream (self.__next_f.push([1,"…"])), and it is better than the DOM ever was: every match as
{id, homeTeam ref, awayTeam ref, homeTeamScore, awayTeamScore, startDateTime (UTC, with the
kick-off time the DOM hides), matchStatus, seasonStartYear}, with a teams[] table carrying each
club's fullName, abbreviatedName, crest and colours. So discovery is one plain GET.

THE GAME FEED PUBLISHES THE BOX SCORE, which is the other thing worth knowing: every play carries
`playerStats`, the actor's CUMULATIVE line after that play. A player's stats only ever move on a
play they are the actor of, so the LAST play each player appears in holds their final box row —
read, not recomputed. Verified against acb.com's own box score for matchId 104459: every player's
points, 2P, 3P, FT, OR/DR/TR, AST, TOV, STL, BLK, PF and fouls drawn agree exactly.

MINUTES ARE THE ONE FIELD THE FEED DOES NOT PUBLISH, and they are reconstructed from the
substitution stream (599 opening five, 112 in, 115 out) rather than left at 0:00, because a box
score with no minutes is a broken box score. This is cheap and checkable: ACB's sub stream is
clean (unlike the EuroLeague's, which emits the IN before the OUT), and the reconstruction totals
exactly 200.0 team-minutes a side and matches acb.com's published per-player minutes to the second
on 104459 (Perry 16:01, Balcerowski 20:29, Kalinoski 16:27). _minutes() re-checks the total and
gives up — leaving 0:00 rather than a lie — if a game's stream does not balance.

THE SAME PLAYS ARE THE EVENT LOG. Every play carries quarter, minute, second, playerLicenseId and
a playType code, which is everything needed to say who was on the floor when — so the stream is
translated into the platform's FIBA event shape (raw["pbp"]) and scripts/ingest/stints.py replays
it into stints and lineups. Before this the pbp held one marker event and a league with 91 clean
substitutions a game shipped no lineup data at all. The code list is the scraper's, re-verified
here; see PLAY_EVENTS for what each code is and for the ones deliberately dropped.

NO SHOT CHART EXISTS. The play keys are fixed and contain no x/y, no zone and no distance (all 675
plays of 104459 checked, and live.acb.com's own game page has no shot-chart component either), so
tm[].shot is empty and the rim/mid/three split is unavailable for this league. Inventing
coordinates from playType 100 "dunk" would fill the chart with fiction, so it is left empty — and
for the same reason a translated shot carries no subType. A dunk IS at the rim, but "dunk" is the
only shot ACB names, so passing it through would leave the lineup rows' rim column counting dunks
and calling them rim attempts, which reads as data rather than as the absence of it.

THERE IS NO WOMEN'S LEAGUE HERE TO PICK UP, which is worth writing down so nobody goes looking
again: the ACB runs the men's Liga Endesa and nothing else. Spain's women's top flight is the Liga
Femenina Endesa, run by the federation on feb.es — a different organisation, a different site and
no presence on api2.acb.com — so it is a separate adapter's job, not a config line on this one.
The ACB's own other competitions (Copa del Rey, Supercopa) are on acb.com under their own path
segment rather than /liga/ — NOT probed here, so not claimed — which is why a configured
scheduleUrl keeps its path and has only its ?temporada= rewritten: if those calendars render the
same way, a cup is a config line rather than code.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
# Hardcoded in the scraper (LINEUPDATASCRAPE:24049) and still live. It is a third-party key that
# can be rotated without notice, so a 401/403 must read as "no data this pass", never as "0 games".
APIKEY = "0dd94928-6f57-4c08-a3bd-b1b2f092976e"
CALENDAR = "https://www.acb.com/es/liga/calendario?temporada={temporada}"
PBP = "https://api2.acb.com/api/matchdata/PlayByPlay/play-by-play?matchId={match_id}"

SEASON_EPOCH = 1935          # temporada 1 = 1936-37; 2026-27 = 91

# playerStats -> the FIBA stat names. Everything the pipeline reads that ACB publishes.
# Not here because ACB's feed has no such field: sBlocksReceived (the official box's "TAPC"),
# sPlusMinusPoints, and the sPoints* transition splits.
PLAYER_STATS = {
    "sPoints": "points",
    "sTwoPointersMade": "twoPointersMade", "sTwoPointersAttempted": "twoPointersAttempted",
    "sThreePointersMade": "threePointersMade", "sThreePointersAttempted": "threePointersAttempted",
    "sFreeThrowsMade": "freeThrowsMade", "sFreeThrowsAttempted": "freeThrowsAttempted",
    "sReboundsOffensive": "offRebounds", "sReboundsDefensive": "defRebounds",
    "sReboundsTotal": "totalRebounds",
    "sAssists": "assists", "sTurnovers": "turnovers", "sSteals": "steals", "sBlocks": "blocks",
    "sFoulsPersonal": "personalFouls", "sFoulsOn": "foulsDrawn",
}

# THE BOX SCORE IS STILL playerStats AND ONLY playerStats. The codes below are read for WHEN and
# to WHOM a play happened, never for its effect on a stat line — counting them would be a second
# box score, disagreeing with the first the moment a code is missed.
#
# playType -> the event contract's (actionType, subType, success). The list is the scraper's
# (LINEUPDATASCRAPE:11680) and was re-verified here the way it was verified there: watch which
# playerStats field each code moves. Every code below moves exactly the stat its row implies. The
# ones NOT below move nothing at all — 105 player warning, 122 game start, 410/417 video review,
# 533 dunk highlight, 600 possession marker, 748 misc — so they are dropped rather than given a
# name they have not earned.
#
# 599 IS NOT A SUBSTITUTION. It is the opening five, which the pipeline reads off the `starter`
# flag instead; replaying it as five INs would put the starters on court a second time.
#
# THE FOUR FOUL CODES ALL MOVE personalFouls, which is the only thing the lineup rows count, and
# that is as far as their labels can honestly go. What 104459 does show: 109 is the offensive foul
# (the committing player's own turnover follows at the same clock, 6 times out of 6), and 160/161
# are the two that send a shooter to the line (24 x 2 + 2 x 1 = the game's 50 FTA, exactly). One
# game is not enough to stamp "shooting" on a foul in the data, so those stay plain personal ones.
PLAY_EVENTS = {
    92: ("freethrow", "", 1), 96: ("freethrow", "", 0),
    93: ("2pt", "", 1), 97: ("2pt", "", 0),
    100: ("2pt", "", 1),                      # a dunk; no subType — see NO SHOT CHART EXISTS above
    94: ("3pt", "", 1), 98: ("3pt", "", 0),
    101: ("rebound", "offensive", None), 104: ("rebound", "defensive", None),
    102: ("block", "", None), 103: ("steal", "", None), 106: ("turnover", "", None),
    107: ("assist", "", None), 108: ("assist", "", None), 119: ("assist", "", None),
    109: ("foul", "offensive", None), 159: ("foul", "personal", None),
    160: ("foul", "personal", None), 161: ("foul", "personal", None),
    110: ("foulon", "", None),                # the player who WAS fouled: sFoulsOn's own event
    113: ("timeout", "", None),
    178: ("jumpball", "lost", None), 179: ("jumpball", "won", None),
    121: ("period", "start", None), 116: ("period", "end", None),
}
PT_STARTERS, PT_IN, PT_OUT, PT_GAME_END = 599, 112, 115, 123

_FLIGHT = re.compile(r'self\.__next_f\.push\(\[1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\)')
_TEAM_REF = re.compile(r":(\d+)$")
# fallback only: the fixture links the skeleton DOM does render, /previa before a game and
# /estadisticas after it
_LINK_ID = re.compile(r"live\.acb\.com/(?:[a-z]{2}/)?partidos/[a-z0-9\-]+?-(\d{5,7})/")


def _start_year(config: dict) -> int:
    """The season's START year. "2026-27" -> 2026; absent -> the season we are in now."""
    m = re.match(r"(\d{4})", str(config.get("season") or ""))
    if m:
        return int(m.group(1))
    now = datetime.now(timezone.utc)                  # same rule as feedplatform.season_name_for
    return now.year if now.month >= 8 else now.year - 1


def _temporada(config: dict) -> int:
    return _start_year(config) - SEASON_EPOCH


def _flight(page: str) -> str:
    """The RSC payload as one string. Each push carries a JS string literal; json.loads unescapes
    it, and the chunks are concatenated because a single object can straddle two pushes."""
    out = []
    for m in _FLIGHT.finditer(page):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            continue
    return "".join(out)


def _arrays(flight: str, key: str, has: str) -> list:
    """Every JSON array published under `key` whose first element carries `has`.

    The flight stream is JSON objects glued together with React's own markers, so it cannot be
    parsed whole; but each array is valid JSON where it starts, and raw_decode reads exactly it."""
    dec, out = json.JSONDecoder(), []
    for m in re.finditer(re.escape('"%s":[' % key), flight):
        try:
            val, _ = dec.raw_decode(flight, m.end() - 1)
        except ValueError:
            continue
        if isinstance(val, list) and val and isinstance(val[0], dict) and has in val[0]:
            out.append(val)
    return out


def _clock(secs: int) -> str:
    return f"{secs // 60}:{secs % 60:02d}"


def _status(match: dict) -> str:
    st = str(match.get("matchStatus") or "").upper()
    if st in ("FINALIZED", "FINISHED", "FINAL", "ENDED"):
        return "final"
    if "PLAY" in st or "LIVE" in st or "PROGRESS" in st or "RESTING" in st:
        return "live"
    return "scheduled"


class ACBAdapter(FibaLiveStatsAdapter):
    name = "acb"
    min_request_gap_s = 0.5

    def _get(self, url: str, headers: dict | None = None):
        gap = time.time() - getattr(self, "_last_api", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.get(url, headers={"User-Agent": UA, **(headers or {})}, timeout=60)
        if r.status_code in (401, 403, 404):
            return None                      # key rotated / game not published: not "no games"
        r.raise_for_status()
        return r

    # ---------------------------------------------------------------- schedule ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        temporada = _temporada(config)
        url = CALENDAR.format(temporada=temporada)
        if schedule_url and "acb.com" in schedule_url:
            # a configured URL keeps its path (the cup calendars live under other segments) but
            # never its season: a pinned ?temporada= is how every ACB scraper ends up a year behind
            base = schedule_url.split("?")[0]
            url = f"{base}?temporada={temporada}"
        r = self._get(url)
        if r is None:
            self.last_competitions = []
            return []
        page = r.text
        games = list(self._parse_schedule(page, _start_year(config)))
        if not games:
            # the flight format is React's, not ACB's, and it can change under us; the rendered
            # fixture links still name every match id, so a season never comes back empty in silence
            games = [ScheduleGame(external_id=g) for g in dict.fromkeys(_LINK_ID.findall(page))]
        self.last_competitions = []
        return games

    @staticmethod
    def _parse_schedule(page: str, start_year: int) -> Iterable[ScheduleGame]:
        flight = _flight(page)
        # the page carries more than one teams[] (the navbar has one too); the clubs the match
        # references index into the longest, which is the season's full table
        teams = max(_arrays(flight, "teams", "abbreviatedName") or [[]], key=len)
        rounds = []
        for arr in _arrays(flight, "rounds", "matches"):
            rounds.extend(arr)

        def club(ref):
            # matches point at the teams table by reference ("$2d:props:data:teams:16")
            if isinstance(ref, dict):
                return ref
            m = _TEAM_REF.search(str(ref or ""))
            i = int(m.group(1)) if m else -1
            return teams[i] if 0 <= i < len(teams) else {}

        seen = set()
        for rnd in rounds:
            for g in rnd.get("matches") or []:
                gid = g.get("id")
                # an undetermined playoff slot has no id and no clubs yet — it is a bracket
                # placeholder, not a fixture, and the seasonStartYear guard keeps a stray
                # cross-season round out of this season's schedule
                if gid is None or str(gid) in seen:
                    continue
                if g.get("seasonStartYear") not in (None, start_year):
                    continue
                seen.add(str(gid))
                h, a = club(g.get("homeTeam")), club(g.get("awayTeam"))
                yield ScheduleGame(
                    external_id=str(gid),
                    home_name=(h.get("fullName") or "").strip(),
                    away_name=(a.get("fullName") or "").strip(),
                    tipoff_at=g.get("startDateTime"),          # already ISO-8601 UTC ("…Z")
                    status=_status(g),
                    extra={"home_code": (h.get("abbreviatedName") or "").strip(),
                           "away_code": (a.get("abbreviatedName") or "").strip(),
                           "home_logo": h.get("logo"), "away_logo": a.get("logo"),
                           "home_score": g.get("homeTeamScore"), "away_score": g.get("awayTeamScore"),
                           "round": rnd.get("roundNumber")})

    # ------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        if not re.fullmatch(r"\d{4,8}", str(external_id)):
            return None
        r = self._get(PBP.format(match_id=external_id),
                      {"X-APIKEY": APIKEY, "Accept": "application/json"})
        if r is None:
            return None
        try:
            data = r.json() or {}
        except ValueError:
            # A GAME THAT HAS NOT TIPPED OFF ANSWERS 200 WITH AN EMPTY BODY — which is every
            # fixture of a season until it is played, so this is the normal case, not an error.
            return None
        plays = sorted(data.get("plays") or [], key=lambda p: S.num(p.get("order")))
        if len(plays) <= 10:
            return None                      # not tipped off, or only the opening lineups published

        minutes = self._minutes(plays)
        quarters = self._quarters(plays)
        sides = []
        for local, feed_team in ((True, data.get("homeTeam")), (False, data.get("awayTeam"))):
            feed_team = feed_team or {}
            players = {}
            for lid, row in self._players(plays, local).items():
                players[str(lid)] = S.player(
                    # the feed writes natural Spanish "First Last" with diacritics and does not
                    # split it; names.py is what decides how it is stored
                    name=row["name"], shirt=row["shirt"], starter=row["starter"], active=1,
                    minutes=minutes.get(lid, "0:00"), stats=row["stats"])
                players[str(lid)]["licenseId"] = lid       # ACB's own stable per-player key
            totals = S.totals_of(players)
            score = quarters["final"][0 if local else 1]
            # THE SCOREBOARD IS THE SCORE. Summing players agreed exactly on the game verified
            # here, but a player whose events never reached the feed must not quietly cost his
            # club points, so the running score the feed itself publishes wins.
            totals["sPoints"] = score
            sides.append(S.team(
                (feed_team.get("fullName") or "").strip(),
                (feed_team.get("abbreviatedName") or "").strip(),
                score=score, quarters=quarters["home" if local else "away"],
                players=players, shots=[], totals=totals,
                logo=feed_team.get("logo"),
                short_name=(feed_team.get("shortName") or "").strip()))

        last, finished = plays[-1], bool(data.get("matchFinished"))
        # An EMPTY pbp reads as "not started" and a pbp with the game-end sentinel reads as final,
        # so the translated stream answers both by itself: a game in progress has its plays and no
        # sentinel. period/clock are the other two fields that rule uses — they are what closes a
        # game whose operator never taps the final whistle.
        raw = S.game(sides[0], sides[1], played=finished, pbp=self._events(plays, finished))
        raw["period"] = S.num(last.get("quarter"), 1)
        raw["clock"] = "%02d:%02d" % (S.num(last.get("minute")), S.num(last.get("second")))
        b = self.bundle_from_raw(raw, str(external_id), config)
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """NOT FOR A TRANSLATED FEED — the scraper's stint builder reads these backwards.

        fiba_livestats tries the scraper's fiba_api_parser before the in-repo builder, and it is
        the proven one for a REAL data.json, which is NEWEST FIRST: parse_playbyplay reverses the
        list before replaying it. Everything translated here is built FORWARDS (fibashape.game,
        stints.ordered), so the scraper replays the game from the final whistle backwards — on
        104459 that is a single zero-second stint holding all 86-68, and one wrong stint is worse
        than none, because it is a truthy answer that stops the in-repo builder ever running.
        Returning nothing hands the game to scripts/ingest/stints.py, which reads it forwards."""
        return []

    # ----------------------------------------------------------------- pieces ---
    @staticmethod
    def _players(plays: list, local: bool) -> dict:
        """{licenseId: {name, shirt, starter, stats}} for one side.

        playerStats is CUMULATIVE and only moves on a play its own player acts in, so the last
        play a player appears in carries his finished line."""
        out: dict = {}
        for p in plays:
            lid = p.get("playerLicenseId")
            if lid is None or bool(p.get("local")) is not local:
                continue
            row = out.setdefault(lid, {"name": "", "shirt": "", "starter": 0, "stats": {}})
            row["name"] = (p.get("playerName") or "").strip() or row["name"]
            # playerNumber is null on the opening-five plays and set everywhere after
            row["shirt"] = str(p.get("playerNumber") or "").strip() or row["shirt"]
            if p.get("playType") == PT_STARTERS:
                row["starter"] = 1
            ps = p.get("playerStats")
            if ps:
                stats = {k: S.num(ps.get(v)) for k, v in PLAYER_STATS.items()}
                stats["sFieldGoalsMade"] = stats["sTwoPointersMade"] + stats["sThreePointersMade"]
                stats["sFieldGoalsAttempted"] = (stats["sTwoPointersAttempted"]
                                                 + stats["sThreePointersAttempted"])
                row["stats"] = stats
        return out

    @classmethod
    def _events(cls, plays: list, finished: bool) -> list:
        """The same plays in the platform's FIBA event shape, oldest first.

        scripts/ingest/stints.py rebuilds the lineups from this and from nothing else, so the
        fields that matter are the four that place a play — period, gt, tno, pno — and gt is time
        REMAINING, which is already what ACB's minute/second are.

        pno IS THE LICENCE ID, because that is what tm[].pl is keyed by here. A shirt number could
        not do it: the feed leaves playerNumber null on every opening-five play, and #0 and #00 are
        two legal jerseys that any number-keyed lineup merges into one player.

        actionNumber is this list's own 1-based index rather than the feed's `order`, which
        REPEATS — all ten opening-five plays of 104459 are order 10. stints.ordered() sorts by
        actionNumber whenever every event carries one, and a key that repeats makes that sort a
        no-op at best: a mass substitution (five out, five in, one clock time) would then keep its
        order only for as long as the sort happens to be a stable one."""
        out, last_foul = [], None
        for p in plays:
            pt = S.num(p.get("playType"), -1)
            if pt in (PT_IN, PT_OUT):
                spec = ("substitution", "in" if pt == PT_IN else "out", None)
            elif pt == PT_GAME_END:
                # matchFinished stays the one thing that decides live from final (the sentinel is
                # what fiba_livestats._status looks for first), so a 123 in a feed that has not
                # flipped that flag closes the period and claims nothing more.
                spec = ("game", "end", None) if finished else ("period", "end", None)
            else:
                spec = PLAY_EVENTS.get(pt)
                if spec is None:
                    continue
            action, sub, success = spec
            lid = p.get("playerLicenseId")
            teamless = action in ("period", "game")
            ev = {"actionNumber": len(out) + 1, "actionType": action, "subType": sub,
                  "period": max(1, S.num(p.get("quarter"), 1)),
                  "gt": "%d:%02d" % (S.num(p.get("minute")), S.num(p.get("second"))),
                  # tno 0 is FIBA's "this belongs to neither club", and a quarter end arrives here
                  # as local=false, which would otherwise file the end of every period under away
                  "tno": 0 if teamless else (1 if p.get("local") else 2),
                  # a team rebound and a team turnover have no licence id, and an empty pno is
                  # exactly how the stint builder knows not to charge one to a player
                  "pno": "" if teamless or lid is None else str(lid)}
            if ev["pno"]:
                # FIBA's own actions carry the shirt number beside the pno, and a reader that keys
                # lineups by it falls back to the pno when it is absent — fiba_api_parser does
                # exactly that, which would make an 8-digit licence id somebody's jersey number.
                # It is never the key HERE (see pno above); the feed omits it only on the
                # opening-five plays, which are not translated.
                ev["shirtNumber"] = str(p.get("playerNumber") or "")
            if success is not None:
                ev["success"] = success
            if action == "foulon" and last_foul is not None:
                # the drawn foul always follows the foul itself (47 of 47 on 104459) — directly,
                # except after an offensive foul, where the committing player's own turnover sits
                # between the two. Only a foul moves the pointer, so both orders pair correctly.
                ev["previousAction"] = last_foul
            if action == "foul":
                last_foul = ev["actionNumber"]
            out.append(ev)
        return out

    @staticmethod
    def _elapsed(p: dict) -> int:
        """Seconds played when this play happened. minute/second are time REMAINING, quarters are
        10 minutes and overtimes 5 — read the other way round every clock runs backwards."""
        q = max(1, S.num(p.get("quarter"), 1))
        left = S.num(p.get("minute")) * 60 + S.num(p.get("second"))
        if q <= 4:
            return (q - 1) * 600 + (600 - left)
        return 2400 + (q - 5) * 300 + (300 - left)

    @classmethod
    def _minutes(cls, plays: list) -> dict:
        """{licenseId: "M:SS"} from the substitution stream; a side that does not balance is left out.

        Lineups carry across quarter breaks in the ACB as they do everywhere, so this is one
        timeline per player: on at the opening five (599) or a sub in (112), off at a sub out
        (115), and still on at the final whistle otherwise. The check that makes it safe to ship
        is that a side must come to exactly five men x the game's length; anything else means its
        stream is broken and every minute figure taken from it would be wrong, so that side gets
        0:00 rather than a plausible lie. The other side is unaffected — they are separate lineups."""
        if not plays:
            return {}
        periods = max(S.num(p.get("quarter"), 1) for p in plays)
        end = 2400 + max(0, periods - 4) * 300
        on, secs, side = {}, {}, {}
        for p in plays:
            lid, pt = p.get("playerLicenseId"), p.get("playType")
            if lid is None or pt not in (PT_STARTERS, PT_IN, PT_OUT):
                continue
            side[lid] = bool(p.get("local"))
            t = cls._elapsed(p)
            if pt in (PT_STARTERS, PT_IN):
                on.setdefault(lid, t)
            elif lid in on:
                secs[lid] = secs.get(lid, 0) + t - on.pop(lid)
        for lid, t0 in on.items():
            secs[lid] = secs.get(lid, 0) + end - t0
        out = {}
        for is_local in (True, False):
            mine = {lid: v for lid, v in secs.items() if side.get(lid) is is_local}
            if sum(mine.values()) == 5 * end:
                out.update({lid: _clock(v) for lid, v in mine.items()})
        return out

    @staticmethod
    def _quarters(plays: list) -> dict:
        """{"home": [q1..q4], "away": [...], "final": (home, away)} from the running score.

        scoreHome/scoreAway are cumulative, so a quarter's points are the difference between the
        last play of that quarter and the last play of the one before — reading the cumulative
        figure straight into p4_score would put the final score in the fourth column. Matches
        acb.com's own quarterScores for 104459 (15-18, 31-16, 20-23, 20-11)."""
        last: dict = {}
        for p in plays:
            last[S.num(p.get("quarter"), 1)] = (S.num(p.get("scoreHome")), S.num(p.get("scoreAway")))
        home, away = [], []
        prev = (0, 0)
        for q in range(1, 5):
            cur = last.get(q, prev)
            home.append(cur[0] - prev[0])
            away.append(cur[1] - prev[1])
            prev = cur
        final = last.get(max(last), (0, 0)) if last else (0, 0)
        return {"home": home, "away": away, "final": final}
