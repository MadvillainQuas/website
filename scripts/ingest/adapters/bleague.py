"""Japan B.LEAGUE B1 — bleague.jp's own schedule JSON, and the Genius Sports blob its game page caches.

TWO HALVES, ONE HOST, plain `requests` (no Selenium, no auth), exactly as the scraper's BLJ path:

    www.bleague.jp/schedule/?data_format=json&year=<YYYY>&…&event=<E>&tab=1&index=<n>
        -> {"topics": [one <li> of HTML per game], "index": <next offset, or '' at the end>}
    www.bleague.jp/game_detail/?ScheduleKey=<key>&tab=1
        -> a ~940 KB page carrying `_contexts_s3id.data = {…};`, and that ONE blob holds Game,
           HomeBoxscores, AwayBoxscores and PlayByPlays — the box score AND the shot chart in a
           single request. This is NOT fibalivestats.dcd.shared.geniussports.com; nothing here
           talks to the FIBA LiveStats host at all, only to the shape its pipeline reads.

THE SEASON AXIS IS THE START YEAR, a plain integer: the platform's "2026-27" is year=2026. The
scraper pins `year=2025` in a constant (scrape-now.py:103) and, because a non-empty year makes its
own "a season opens in July" fallback unreachable, a bare run scrapes LAST season forever. That
pinned year is the one thing from the scraper that must not be copied, so the year here is derived
from the platform's season name and only falls back to the league's July rule.

WHY A FIXTURE THAT HAS NOT TIPPED OFF IS NEVER FETCHED. run_ingest re-fetches every game that is
not already final, which for most leagues is a small JSON per fixture; here it is 940 KB of HTML,
and a full B1 season is ~700 fixtures. A game that has not started has no box score to publish
anyway, so fetch() answers "nothing yet" from the tip-off time alone and sends no request.

NAMES. The box rows carry BOTH scripts — "PlayerNameE": "Ryo Terashima" beside "PlayerNameJ":
"寺嶋 良" — and the play-by-play carries only a Japanese surname form, so everything is keyed on
PlayerID and both spellings are handed to names.py: the kanji in familyName (undivided — splitting
a Japanese name into "given" and "family" here would only let something reassemble it in the wrong
order), the romaji in internationalFirstName/internationalFamilyName. names.py prefers the Latin
fields when the native ones are CJK and keeps the kanji as a searchable alias. Nothing is
romanised here: there is no safe rule for it, and the feed already did it.

SO IS THE EVENT STREAM. PlayByPlays was already being downloaded for the shot chart and then
dropped, which is why this league shipped no stints and no lineups; it is now translated whole and
handed over as raw["pbp"], which is the only thing scripts/ingest/stints.py reads. Three things
about this feed decide whether the lineups come out right, and all three are the scraper's findings
(LINEUPDATASCRAPE.parse_playbyplay_bleague), not new ones:
  · `Side` ('left'/'right') FLIPS AT HALF TIME and must never attribute anything — HomeAway (1/2)
    does, with TeamID as the fallback;
  · the array is chronological but corrections are APPENDED with early-game clocks, so it is
    stable-sorted by (period, elapsed) before anything reads it;
  · the ten CD1=86 "player in" rows at P1 10:00 carry Score=null and are the STARTER
    ANNOUNCEMENT, not substitutions — replaying them would put ten men on court.

THE SHOT CHART IS FREE, and the scraper throws it away. Every made/missed field-goal event carries
X and Y as a PERCENTAGE OF THE FULL COURT, which is already the frame shot_dist_to_nearest_rim
measures in — so the coordinates are passed straight through and at_rim_offset is NOT used;
converting a percentage as if it were centimetres would file every lay-up as a jump shot. Checked
on a real game: the 3pt attempts sit 6.85-12.41 m from the nearest rim and every 2pt attempt
inside 5.85 m, i.e. dead on the 6.75 m arc, and the per-club shot counts equal the box score's
attempts exactly.

WHAT THE SCHEDULE CANNOT DO, deliberately. A schedule card names a club only by a Japanese
ABBREVIATION ("広島", "A東京") — slugify() reduces kanji to nothing, so a club created from a card
would be filed under the slug "x" and keep that name for ever, because the game payload that knows
it as "HIROSHIMA DRAGONFLIES" would then find it by code and leave the name alone. So discover()
publishes ids, dates and status but NO club names: clubs (and their crests, which the game page
carries too) are created from the payload, which names them in English with the Japanese kept as
an alias. The cost is that an unplayed fixture is not shown on the site until it tips off; the
fix, when it is wanted, is a crest-code -> English-name map in adapter_config, since the card does
carry the club's crest code.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

SITE = "https://www.bleague.jp"
SCHEDULE = (SITE + "/schedule/?data_format=json&year={year}&mon=all&day=&event={event}"
                   "&club=&tab={tab}&ha=&fb=&index={index}")
GAME = SITE + "/game_detail/?ScheduleKey={key}&tab={tab}"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA}
XHR = {"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"}

# The page assigns the blob on one long line and nothing follows it there, which is what `\s*$`
# with re.M pins the non-greedy match to — without that anchor it stops at the first "}" inside.
BLOB = re.compile(r"_contexts_s3id\.data\s*=\s*(\{.*?\});?\s*$", re.M)

# Box row -> the FIBA stat names. Everything the pipeline reads, nothing it does not. There is no
# field-goal field in this feed at all: FG is 2pt + 3pt, computed below.
PLAYER_STATS = {
    "sPoints": "Point",
    "sTwoPointersMade": "PT2M", "sTwoPointersAttempted": "PT2A",
    "sThreePointersMade": "PT3M", "sThreePointersAttempted": "PT3A",
    "sFreeThrowsMade": "FTM", "sFreeThrowsAttempted": "FTA",
    "sReboundsOffensive": "RB_OFF", "sReboundsDefensive": "RB_DEF", "sReboundsTotal": "RB_TOT",
    "sAssists": "AS", "sTurnovers": "TO", "sSteals": "ST",
    "sBlocks": "BS", "sBlocksReceived": "BSON",
    "sFoulsPersonal": "FOUL", "sFoulsOn": "FOULON",
    "sPointsFastBreak": "PTFB", "sPointsInThePaint": "PT2IN", "sPointsSecondChance": "PT2ND",
    "sPlusMinusPoints": "PLUSMINUS",
}

# MADE OR MISSED IS THE ACTION CODE ITSELF, not the `Success` field beside it: 1=3pt made,
# 2=3pt missed, 3=2pt made outside the paint, 4=2pt made inside it, 5/6 the same two missed.
# ActionCD1 -> (is it a three, was it made).
SHOTS = {1: (True, True), 2: (True, False),
         3: (False, True), 4: (False, True), 5: (False, False), 6: (False, False)}

# ActionCD1 -> (actionType, subType, success) in the FIBA event shape scripts/ingest/stints.py
# replays. This is LINEUPDATASCRAPE's BLEAGUE_ACTIONCD1_MAP respelled: the codes, and the 10-game
# validation behind them (24/25/26 are fouls that count in the box; 15/16 carry no stat; 17/18/19
# belong to the club and not to a player), are the scraper's. Only the vocabulary differs, because
# the stint builder wants FIBA's words rather than the scraper's canonical event names.
#
# DELIBERATELY ABSENT, i.e. skipped: 16 (and-one marker — the free throws that follow carry the
# points), 80 (game start — FIBA has no such action; period/start is the one that opens a period),
# 84/85 (clock start/stop, pure noise: 164 of this game's 730 rows).
ACTIONS = {
    1:  ("3pt", None, 1),
    2:  ("3pt", None, 0),
    3:  ("2pt", None, 1),                       # made, outside the paint
    4:  ("2pt", None, 1),                       # made, inside it — PAINT adds the qualifier
    5:  ("2pt", None, 0),
    6:  ("2pt", None, 0),
    7:  ("freethrow", None, 1),
    8:  ("freethrow", None, 0),
    9:  ("rebound", "defensive", None),
    10: ("rebound", "offensive", None),
    11: ("block", None, None),
    12: ("assist", None, None),
    # KEPT, where the scraper suppresses it: an offensive foul (23) always arrives with its own
    # turnover (13) one row later, and the scraper drops the 13 because its single "Offensive Foul"
    # action already counts PF+TOV. Here a foul and a turnover are two events counted by two
    # different branches of stints._apply, so dropping the 13 would lose the turnover — and FIBA
    # itself files an offensive foul as both.
    13: ("turnover", None, None),
    14: ("steal", None, None),
    15: ("foulon", None, None),                 # the mirror of a foul; `previousAction` pairs them
    17: ("turnover", None, None),               # the club's own, credited to nobody
    18: ("rebound", "defensive", None),
    19: ("rebound", "offensive", None),
    22: ("foul", "personal", None),
    23: ("foul", "offensive", None),
    # A player technical lands in this feed's box FOUL column (which is read from the box rows and
    # is untouched by any of this) but NOT in a stint's pf: stints._apply excludes technicals by
    # name, as FIBA counts them. The two numbers differ by design, not by accident.
    24: ("foul", "technical", None),
    25: ("foul", "unsportsmanlike", None),
    26: ("foul", "disqualifying", None),
    81: ("game", "end", None),
    82: ("period", "start", None),
    83: ("period", "end", None),
    86: ("substitution", "in", None),
    87: ("substitution", "out", None),
    88: ("timeout", None, None),
}
GAME_END, SUB_IN = 81, 86
PAINT = (4, 6)                                  # "inside the paint" is the code itself
TEAM_EVENTS = (17, 18, 19)                      # no player: the stint builder must not charge one

#: ActionCD2 on a field goal. Three words is all this feed has, which is why the rim split is taken
#: from the shot's coordinates instead (see _shot_chart) and these only feed the event log's own
#: shot-type vocabulary (translate/fiba_events.STYPE).
SHOT_SUBTYPE = {27: "jumpshot", 28: "layup", 29: "dunk"}

#: ActionCD2/ActionCD3 -> FIBA's scoring qualifiers, which is how stints.csv's fast-break,
#: second-chance and points-off-turnover columns get filled at all. The scraper uses only 35/38 (it
#: had no override hook for the other two) and notes the rest exist; the feed's own PlayText names
#: each one, so 38 is a fast break off a turnover and 48 is a second chance off a turnover — both,
#: not either.
#:
#: THESE DO NOT SUM TO THE BOX COLUMNS, AND SHOULD NOT. On the game checked the tags reconcile with
#: PTFB / PT2ND exactly — but as a COUNT OF MADE SCORING PLAYS, not as points (home 4 tagged
#: fast-break scores = PTFB 4, worth 6 points; away 7 second-chance scores = PT2ND 7, worth 13).
#: The stint columns are points, because that is what a second-chance POINTS column means, so they
#: are deliberately larger than the club row beside them until PLAYER_STATS is re-read.
QUALIFIERS = {35: ("fastbreak",), 36: ("fromturnover",), 37: ("2ndchance",),
              38: ("fastbreak", "fromturnover"), 48: ("fromturnover", "2ndchance")}

#: a player row for the WHOLE game: Category 1 is a player (2/3 are team rows) and
#: PeriodCategory 18 is the game total (1-4 are quarters, 15/16 the halves).
PLAYER_ROW, TEAM_ROW, WHOLE_GAME = 1, 3, 18

# --- the schedule card, which is a fragment of HTML rather than data ----------------------------
CARD_KEY = re.compile(r'<li[^>]*class="[^"]*list-item[^"]*"[^>]*id="(\d+)"')
CARD_DATE = re.compile(r'<span class="title">\s*(\d{4})\.(\d{1,2})\.(\d{1,2})')
CARD_LOGO = re.compile(r'<img[^>]+src="([^"]*?/img/logo/[^"]+?\.png)"')
CARD_STATE = re.compile(r'class="info-scorestate"[^>]*><span>([^<]*)<')
CARD_ARENA = re.compile(r'class="info-arena"[^>]*>(.*?)</div>', re.S)
CARD_TIME = re.compile(r'<span>\s*(\d{1,2}):(\d{2})\s*</span>')
JST = timezone(timedelta(hours=9))


def _season_year(config: dict) -> int:
    """The platform's "2026-27" -> 2026, the season START YEAR bleague.jp's ?year= is keyed on.

    Only when no season is configured at all does this fall back to the league's own rule (a
    season opens in July, LINEUPDATASCRAPE :25968) — never to a pinned year."""
    m = re.search(r"(\d{4})", str(config.get("season") or ""))
    if m:
        return int(m.group(1))
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def _stats(row: dict) -> dict:
    out = {k: S.num(row.get(v)) for k, v in PLAYER_STATS.items()}
    out["sFieldGoalsMade"] = out["sTwoPointersMade"] + out["sThreePointersMade"]
    out["sFieldGoalsAttempted"] = out["sTwoPointersAttempted"] + out["sThreePointersAttempted"]
    return out


def _rest_secs(ev: dict) -> int:
    """RestTime ("M:SS", time REMAINING, no leading zero) as seconds. Anything unreadable is 0,
    which sorts to the END of its period — where a period-end row with "0:00" belongs anyway."""
    rt = str(ev.get("RestTime") or "")
    if ":" not in rt:
        return 0
    m, s = (rt.split(":") + ["0"])[:2]
    try:
        return int(m) * 60 + int(s)
    except ValueError:
        return 0


def _ordered(pbp: list) -> list:
    """The plays oldest first, which the array very nearly already is.

    PlayByPlays is written in play order, but a LATE CORRECTION IS APPENDED to the end of it with
    its own early-game period and clock — the scraper's 20-game validation caught this on 505235
    and 505253 — so one bad row would otherwise drag every lineup after it out of place. `No` is
    not monotonic and cannot settle it either. The sort is stable, so ties keep feed order, which
    is what preserves a free-throw trip and the in/out order inside one substitution window."""
    return sorted([e for e in (pbp or []) if isinstance(e, dict)],
                  key=lambda e: (S.num(e.get("Period"), 0), -_rest_secs(e)))


def _split_latin(name: str) -> tuple:
    """"Ryo Terashima" -> ("Ryo", "Terashima"); "Dwayne Evans II" -> ("Dwayne", "Evans II").

    The romaji field is written in Western order, so the first word is the given name. This is a
    split, not a transliteration: what the feed wrote is what goes through."""
    parts = re.split(r"\s+", str(name or "").strip(), maxsplit=1)
    return (parts[0], parts[1]) if len(parts) == 2 else ("", parts[0] if parts else "")


class BLeagueAdapter(FibaLiveStatsAdapter):
    name = "bleague"
    min_request_gap_s = 0.5      # the scraper sleeps 0.3 between schedule pages, ~0.65 per game
    #: WHICH DIVISION. tab IS the division on this site, not a display preference: tab=1 lists
    #: B1 (Premier, 26 clubs, ScheduleKeys in the 506xxx range), tab=2 lists B2 (B.League One,
    #: 24 clubs, 507xxx) and tab=3 a third tier. Same pagination, same game page, same blob -- so
    #: the second division is a config entry rather than a second adapter.
    tab = "1"
    #: 2 = regular season, 3 = Championship. Swept separately and deduped, as the scraper does.
    events = ("2", "3")
    #: runaway guard only (20 games a page, so 200 pages is many times a season) — never a cap on
    #: a real season. A schedule that stopped returning a falsy `index` would otherwise loop for ever.
    max_pages = 200

    # ---------------------------------------------------------------- transport ---
    def _read(self, url: str, headers: dict) -> Optional[str]:
        gap = time.time() - getattr(self, "_last_api", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.get(url, headers=headers, timeout=45)
        if r.status_code in (403, 404, 503):
            return None
        r.raise_for_status()
        r.encoding = "utf-8"          # the header says nothing; every page and card is UTF-8
        return r.text

    def _json(self, url: str):
        body = self._read(url, XHR)
        try:
            return json.loads(body) if body else None
        except ValueError:
            return None               # a WAF page instead of JSON: this pass simply finds no games

    # ----------------------------------------------------------------- schedule ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        """Every game of the configured season, from the paginated schedule JSON.

        The seed URL is deliberately ignored: the one in the scraper carries a pinned year, and a
        schedule read for the wrong season is worse than no schedule at all."""
        year = _season_year(config)
        tab = str(config.get("tab") or self.tab)
        events = [str(e) for e in (config.get("events") or self.events)]
        out, seen = [], set()
        for event in events:
            index, pages, date = 0, 0, None
            while index is not None and pages < self.max_pages:
                data = self._json(SCHEDULE.format(year=year, event=event, tab=tab, index=index))
                if not data:
                    break
                for card in data.get("topics") or []:
                    g, date = self._card(card, date, event)
                    # A game is listed under both event codes when it belongs to both; the
                    # ScheduleKey is what says it is the same game.
                    if g and g.external_id not in seen:
                        seen.add(g.external_id)
                        out.append(g)
                nxt = str(data.get("index") or "").strip()
                index = int(nxt) if nxt.isdigit() else None
                pages += 1
        self.last_competitions = []
        return out

    @staticmethod
    def _card(card: str, date: Optional[tuple], event: str) -> tuple:
        """One <li> fragment -> a ScheduleGame, and the date to carry to the next card.

        THE DATE IS A GROUP HEADER, not a field: only the first card of each day carries
        "2025.10.03(金)", so it is carried forward down the (chronological) page."""
        m = CARD_DATE.search(card)
        if m:
            date = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
        key = CARD_KEY.search(card)
        if not key:
            return None, date
        m_arena = CARD_ARENA.search(card)
        arena = m_arena.group(1) if m_arena else ""
        tip = None
        if date:
            hm = CARD_TIME.search(arena)
            h, mi = (int(hm.group(1)), int(hm.group(2))) if hm else (0, 0)
            # Japan keeps no summer time, so a fixed +09:00 is exact rather than approximate.
            tip = (datetime(date[0], date[1], date[2], h, mi, tzinfo=JST)
                   .astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        m_state = CARD_STATE.search(card)
        state = m_state.group(1) if m_state else ""
        # "第1節 | 東京都 | トヨタA | 19:05": the round, the prefecture, the arena, the tip. The
        # arena is the last thing that is not the clock.
        venue = [p.strip() for p in re.sub(r"<[^>]+>", "|", arena).split("|")
                 if p.strip() and not re.fullmatch(r"\d{1,2}:\d{2}", p.strip())
                 and not p.strip().startswith("第")]
        return ScheduleGame(
            external_id=key.group(1),          # the ScheduleKey alone addresses the game page
            # THE CARD DOES NAME BOTH CLUBS, in the abbreviation bleague.jp itself prints:
            # "A東京" for Alvark Tokyo, "琉球" for Ryukyu. Leaving them out meant no fixture could
            # be written until a game had been PLAYED, which is most of a season showing nothing.
            # An abbreviation is a poor name and a missing fixture list is a worse one — and the
            # club does not keep it: the first game fetched carries HomeTeamNameE, and
            # feedplatform replaces a club's native-script name with the Latin one when it comes.
            home_name=_team_name(card, 0), away_name=_team_name(card, 1),
            tipoff_at=tip,
            status="final" if "FINAL" in state.upper() else "scheduled",
            extra={"venue": venue[-1] if venue else None,
                   # the crest file name IS the club's own code on this site (at = Alvark Tokyo,
                   # hd = Hiroshima), which is what keeps the club created from an abbreviated
                   # schedule card and the club named by a played game the same row.
                   "home_crest": _crest(card, 0), "away_crest": _crest(card, 1),
                   "home_logo": _crest_url(card, 0), "away_logo": _crest_url(card, 1),
                   "home_code": _team_code(card, 0), "away_code": _team_code(card, 1),
                   "event": event}), date

    # --------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        key = re.sub(r"\D", "", str(external_id))
        if not key:
            return None
        # NOT TIPPED OFF YET -> no request at all. The page is ~940 KB and a season is ~700
        # fixtures, every one of which run_ingest would otherwise re-fetch on every pass.
        if _in_the_future(config.get("_tipoff_at")):
            return None
        page = self._read(GAME.format(key=key, tab=str(config.get("tab") or self.tab)), HEADERS)
        if not page:
            return None
        m = BLOB.search(page)
        if not m:
            return None
        try:
            blob = json.loads(m.group(1))
        except ValueError:
            return None
        game = blob.get("Game") or {}
        if not game.get("BoxscoreExistsFlg"):
            return None               # tipped off but nothing published yet: try again next pass

        # ONE ordered list feeds both the shot chart and the event stream, because the two are
        # joined on a position in it: a shot marker and the event that took the shot have to agree
        # on their actionNumber or the rim split silently falls back to a subType.
        plays = _ordered(blob.get("PlayByPlays") or [])
        shots = self._shot_chart(plays)
        crests = _crests(page)
        tm = []
        for side in ("Home", "Away"):
            rows = blob.get(side + "Boxscores") or []
            tid = str(game.get(side + "TeamID") or "")
            # The crest file name is the club's code on this site and is the same string the
            # schedule cards use; the numeric TeamID is the fallback if the page is ever redrawn.
            code, logo = crests.get(side.lower()) or (None, None)
            quarters = [game.get("%sTeamScore%02d" % (side, q)) for q in range(1, 5)]
            t = S.team(
                # The English name is the one the site can slug and search; the Japanese full name
                # is handed over as nameInternational, which feedplatform keeps as an alias.
                (game.get(side + "TeamNameE") or game.get(side + "TeamNameJ") or "").strip(),
                code or tid,
                score=game.get(side + "TeamScore"),          # the club's official final
                quarters=quarters,
                players=self._players(rows),
                shots=shots.get(tid, []),
                logo=logo,
                totals=self._totals(rows),
                short_name=(game.get(side + "TeamShortNameE") or "").strip())
            t["nameInternational"] = (game.get(side + "TeamNameJ") or "").strip()
            # A QUARTER THAT HAS NOT BEEN PLAYED IS LEFT ABSENT, not written as 0: while a game is
            # live the later quarters are null, and a zero there reads as a quarter the club failed
            # to score in, under a quarter line that then contradicts the score above it.
            for i, q in enumerate(quarters, start=1):
                if q is None:
                    t.pop("p%d_score" % i, None)
            tm.append(t)

        played = bool(game.get("GameEndedFlg"))
        # HomeAway (1/2) is on every player row of the game checked; TeamID is the fallback the
        # scraper leans on. Both exist because the third candidate, `Side`, is which basket the
        # club was attacking and flips at half time.
        tno_of = {str(game.get(side + "TeamID")): tno for tno, side in ((1, "Home"), (2, "Away"))
                  if game.get(side + "TeamID")}
        # The pipeline still reads "is this over?" off the pbp sentinel alone, and a game being
        # played now carries its real events, so it is called live rather than never-started.
        raw = S.game(tm[0], tm[1], played=played, pbp=self._events(plays, tno_of, played))
        b = self.bundle_from_raw(raw, str(external_id), config)
        # GameDateTime is a UNIX epoch STRING and is the authoritative tip-off; the schedule card's
        # time is only the announced one.
        b.tipoff_at = _epoch(game.get("GameDateTime")) or config.get("_tipoff_at")
        return b

    # ------------------------------------------------------------------ pieces ---
    @staticmethod
    def _players(rows: list) -> dict:
        players = {}
        for r in rows:
            if r.get("Category") != PLAYER_ROW or r.get("PeriodCategory") != WHOLE_GAME:
                continue
            # PlayerID is the stable handle across games and seasons; the shirt number is not, and
            # the pipeline keys rosters on "<club>:<pno>".
            pno = str(r.get("PlayerID") or "").strip() or str(len(players) + 1)
            mins = str(r.get("PlayTime") or "").strip()
            played = bool(mins) and mins.upper() != "DNP"
            p = S.player(
                # The kanji goes through undivided: the feed writes family name first, and telling
                # names.py that "寺嶋" is a given name is how it comes back out reversed.
                last=(r.get("PlayerNameJ") or "").strip(),
                name=(r.get("PlayerNameE") or "").strip(),
                shirt=str(r.get("PlayerNo") or "").strip(),
                starter=1 if S.num(r.get("StartingFlg")) == 1 else 0,
                # "PlayingFlg" is who was ON COURT at the final buzzer (five a side), NOT who
                # played — believing it would empty two thirds of the box score. "DNP" in PlayTime
                # is the one field that means what `active` means.
                active=1 if played else 0,
                minutes=mins if played else "0:00",
                stats=_stats(r))
            first, last = _split_latin(r.get("PlayerNameE"))
            p["internationalFirstName"], p["internationalFamilyName"] = first, last
            p["eff_1"] = S.num(r.get("EFF"))
            players[pno] = p
        return players

    @staticmethod
    def _totals(rows: list) -> Optional[dict]:
        """The club's own totals row, which is NOT the sum of its players: a rebound or a turnover
        credited to the TEAM lives in the Category 2 row, and the Category 3 row is the two added
        up (26 player + 3 team = 29 total rebounds on the game checked). Summing the box would
        quietly lose them."""
        for r in rows:
            if r.get("Category") == TEAM_ROW and r.get("PeriodCategory") == WHOLE_GAME:
                return _stats(r)
        return None                   # fibashape sums the players instead

    @staticmethod
    def _shot_chart(plays: list) -> dict:
        """{TeamID: [shot…]} — x/y are already a percentage of the full court.

        ATTRIBUTION IS BY TeamID AND NEVER BY `Side`: 'left'/'right' is which basket the club was
        attacking, and it flips at half time, so half of every club's shots would be filed against
        its opponent.

        `plays` must be the ORDERED list, because a marker is stamped with its position in it and
        that position is the only join between a shot and the event that took it."""
        out: dict = {}
        for n, e in enumerate(plays or [], start=1):
            kind = SHOTS.get(e.get("ActionCD1"))
            if not kind or e.get("X") is None or e.get("Y") is None:
                continue
            three, made = kind
            s = S.shot(S.num(e.get("X")), S.num(e.get("Y")), made=made, three=three,
                       pno=str(e.get("PlayerID1") or "").strip() or None,
                       period=S.num(e.get("Period"), 1))
            # THE SAME NUMBER THE EVENT CARRIES. stints._shot_type finds a shot's marker by
            # actionNumber and measures the distance to the rim from it; without the join it falls
            # back to subType, and this feed spells a shot three ways (jump shot / layup / dunk),
            # so every mid-range and every three would file as neither rim nor off-the-dribble.
            s["actionNumber"] = n
            out.setdefault(str(e.get("TeamID") or ""), []).append(s)
        return out

    @staticmethod
    def _events(plays: list, tno_of: dict, played: bool) -> list:
        """The same plays in the platform's FIBA event shape, oldest first.

        scripts/ingest/stints.py rebuilds the lineups from this and from nothing else, so what has
        to be right is the four fields that place a play — period, gt, tno, pno — and gt is time
        REMAINING, which is what RestTime already is.

        pno IS PlayerID, the same string _players keys tm[].pl by. The shirt number could not do
        it: the pipeline keys rosters on "<club>:<pno>", and #0 and #00 are two legal jerseys that
        any number-keyed lineup merges into one player.

        actionNumber is the play's position in the ordered list, INCLUDING the rows skipped here,
        so a skipped clock-stop leaves a gap rather than renumbering everything after it — which is
        what lets a shot marker and its event agree (see _shot_chart). stints.ordered() only sorts
        by it, so gaps cost nothing."""
        out, last_foul = [], None
        for n, e in enumerate(plays or [], start=1):
            cd1 = e.get("ActionCD1")
            spec = ACTIONS.get(cd1)
            if spec is None:
                continue                      # 16/80/84/85, and anything this feed grows later
            action, sub, success = spec
            if cd1 == GAME_END and not played:
                # GameEndedFlg is the one thing that decides live from final (fiba_livestats._status
                # looks for this sentinel first), so a game the club has not signed off does not
                # get to publish itself as over.
                continue
            if cd1 == SUB_IN and e.get("Score") is None:
                # The starter announcement: five "player in" rows a side at P1 10:00, with no score
                # because no basketball has been played. Replaying them as substitutions puts ten
                # men on court; the starters come from the box score's StartingFlg instead, which
                # named exactly five a side on the game checked.
                continue
            ha = e.get("HomeAway")
            teamless = action in ("period", "game")
            ev = {"actionNumber": n, "actionType": action,
                  "period": max(1, S.num(e.get("Period"), 1)),
                  "gt": str(e.get("RestTime") or "0:00"),
                  # tno 0 is FIBA's "this belongs to neither club" — a period end has no club
                  "tno": 0 if teamless else (ha if ha in (1, 2)
                                             else tno_of.get(str(e.get("TeamID") or ""), 0)),
                  # a club's own rebound or turnover names no player, and an empty pno is exactly
                  # how the stint builder knows not to charge one
                  "pno": "" if teamless or cd1 in TEAM_EVENTS else str(e.get("PlayerID1") or "").strip()}
            if action in ("2pt", "3pt"):
                sub = SHOT_SUBTYPE.get(e.get("ActionCD2"))
            if sub:
                ev["subType"] = sub
            if success is not None:
                ev["success"] = success
            quals = ["team"] if cd1 in TEAM_EVENTS else []
            if cd1 in PAINT:
                quals.append("pointsinthepaint")
            for cd in (e.get("ActionCD2"), e.get("ActionCD3")):
                quals.extend(q for q in QUALIFIERS.get(cd, ()) if q not in quals)
            if quals:
                ev["qualifier"] = quals
            if action == "foulon" and last_foul is not None:
                # The drawn foul follows the foul itself — one row later on 36 of 41 here, two
                # after an offensive foul, where the committing player's own turnover sits between
                # them. Only a foul moves the pointer, so both orders pair correctly.
                ev["previousAction"] = last_foul
            if action == "foul":
                last_foul = n
            out.append(ev)
        return out

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """NOT FOR A TRANSLATED FEED — the scraper's stint builder reads these backwards.

        fiba_livestats tries the scraper's fiba_api_parser before the in-repo builder, and it is
        the proven one for a REAL data.json, which is NEWEST FIRST: parse_playbyplay reverses the
        list before replaying it. Everything here is built FORWARDS (_ordered, fibashape.game), so
        the scraper would replay the game from the final buzzer back to the tip — and one wrong
        stint is worse than none, because it is a truthy answer that stops the in-repo builder ever
        running. Returning nothing hands the game to scripts/ingest/stints.py, which reads it
        forwards. (The scraper's own BLJ path is unaffected: it parses the game page itself.)"""
        return []


CARD_TEAM_NAME = re.compile(r'class="team-name"[^>]*>\s*([^<]+?)\s*<')


def _team_name(card: str, i: int) -> str:
    """The i-th club named on a schedule card (home first, away second).

    It is bleague.jp's own abbreviation and it is in Japanese, which is the site's own choice of
    how to print it; the alternative here is an unnamed fixture, and a club keeps this name only
    until one of its games is played."""
    found = CARD_TEAM_NAME.findall(card or "")
    return found[i].strip() if len(found) > i else ""


def _team_code(card: str, i: int) -> Optional[str]:
    """The club's code, which on this site is its crest's file name."""
    return _crest(card, i)


def _crest_url(card: str, i: int) -> Optional[str]:
    """The i-th crest as a URL the site can actually load."""
    found = CARD_LOGO.findall(card or "")
    if len(found) <= i:
        return None
    u = found[i]
    return u if u.startswith("http") else SITE + u


def _crest(card: str, i: int) -> Optional[str]:
    """The i-th crest on a schedule card (home first, away second) as its club code."""
    found = CARD_LOGO.findall(card or "")
    if len(found) <= i:
        return None
    return found[i].rsplit("/", 1)[-1].rsplit(".", 1)[0] or None


def _crests(page: str) -> dict:
    """{'home': (code, url), 'away': (code, url)} off the game page's own markup.

    The blob has no crest of any kind, but the page draws both clubs' badges in three places; the
    file name is the club's code on this site and is the same string the schedule cards carry, so
    a club discovered from a card and a club created from a payload are one club."""
    out = {}
    for side in ("home", "away"):
        for pat in (r'_shootchart_team%s\s*=\s*.{0,300}?src="([^"]*?/img/logo/[^"]+?\.png)"' % side,
                    r'club-name %s"><img[^>]*src="([^"]*?/img/logo/[^"]+?\.png)"' % side):
            m = re.search(pat, page or "")
            if m:
                out[side] = (m.group(1).rsplit("/", 1)[-1].rsplit(".", 1)[0], m.group(1))
                break
    return out


def _epoch(v) -> Optional[str]:
    s = str(v or "").strip()
    if not s.isdigit():
        return None
    return datetime.fromtimestamp(int(s), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _in_the_future(tipoff) -> bool:
    """Is this fixture still to come? An unparseable or absent time is never treated as future —
    a game is far better fetched twice than never."""
    s = str(tipoff or "").strip()
    if not s:
        return False
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt > datetime.now(timezone.utc)
