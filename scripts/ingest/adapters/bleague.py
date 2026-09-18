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
            # NO CLUB NAMES: the card abbreviates them in Japanese and a club created from that is
            # stuck with it (see the module docstring). The payload names both clubs properly.
            home_name="", away_name="",
            tipoff_at=tip,
            status="final" if "FINAL" in state.upper() else "scheduled",
            extra={"venue": venue[-1] if venue else None,
                   # kept for the day the fixture rows can be written: the crest file name is the
                   # club's own code on this site (at = Alvark Tokyo, hd = Hiroshima).
                   "home_crest": _crest(card, 0), "away_crest": _crest(card, 1),
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

        shots = self._shot_chart(blob.get("PlayByPlays") or [])
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
        # The pipeline reads "is this over?" off the pbp sentinel alone, so a game still being
        # played needs at least one event to be called live rather than never-started.
        marker = None if played or not blob.get("PlayByPlays") else [
            {"actionType": "period", "subType": "start", "period": S.num(game.get("GameCurrentPeriod"), 1)}]
        raw = S.game(tm[0], tm[1], played=played, pbp=marker)
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
    def _shot_chart(pbp: list) -> dict:
        """{TeamID: [shot…]} — x/y are already a percentage of the full court.

        ATTRIBUTION IS BY TeamID AND NEVER BY `Side`: 'left'/'right' is which basket the club was
        attacking, and it flips at half time, so half of every club's shots would be filed against
        its opponent."""
        out: dict = {}
        for e in pbp or []:
            kind = SHOTS.get(e.get("ActionCD1"))
            if not kind or e.get("X") is None or e.get("Y") is None:
                continue
            three, made = kind
            out.setdefault(str(e.get("TeamID") or ""), []).append(
                S.shot(S.num(e.get("X")), S.num(e.get("Y")), made=made, three=three,
                       pno=str(e.get("PlayerID1") or "").strip() or None,
                       period=S.num(e.get("Period"), 1)))
        return out


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
