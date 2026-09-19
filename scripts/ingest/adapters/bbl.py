# -*- coding: utf-8 -*-
"""easycredit-bbl.de - the German Basketball Bundesliga.

WHERE THE DATA IS, AND WHY IT IS NOT THE API. api.basketball-bundesliga.de answers 401 to
everyone: the Next.js server holds the credentials and nobody else gets a key. Its usual JSON
route, /_next/data/<buildId>/..., answers 404 as well. What IS reachable is the page the server
renders, which embeds that API's own reply verbatim in <script id="__NEXT_DATA__">. So this
adapter is API-first in the only sense available - it reads the API's JSON, one plain GET per
page, no browser and no key - and never parses a single div. The old scraper did parse divs, and
that is exactly why it broke twice: once when past-games-table became future-games-table, and
once when the play-by-play stopped being server-rendered at all.

WHAT A GAME PAGE GIVES. pageProps.initialGameStats holds `actions` (the full play-by-play, with
coordinates and qualifiers) and, per club, `playerStats` with the box score and secondsPlayed.
Both sides join on seasonPlayer.id, which is also what an action's seasonPlayerId carries.

THE SUBSTITUTIONS ARE THE INTERESTING PART, and they are read, not guessed:

  * one SUBSTITUTION event names TWO players - seasonPlayerId and assistingSeasonPlayerId -
    and they are never the same person (0 of 74 on the game this was built against).
  * isSuccessful is False on every one of them and the qualifiers are empty, so neither says
    which way round it goes.
  * seasonPlayerId is the player going OFF. Read against ALBA's opening five, the first five
    substitutions of the game take Mattisseck, Agbakoko, Hermannsson, Griesel and Wieskamp off
    one at a time, each paired with a bench player coming on. Every period-1 change is
    consistent with that and with no other reading.
  * A LINEUP IS NOT CARRIED ACROSS A PERIOD BREAK. Both clubs put a fresh five on at the start
    of a period and the feed does not report those as substitutions at all, which is why
    replaying subs alone ends the game with eight men on court. That is not repaired here:
    in/out are emitted as separate contract events and scripts/ingest/stints.py infers each
    period's opening five from who acts, which is the one place that logic should live.

Logos come back through the site's own image proxy. The api.basketball-bundesliga.de URL a
club carries is 401 like everything else on that host; /_next/image?url=... serves the same
file publicly, and is what the league's own pages use.
"""
from __future__ import annotations

import json
import re
import time
from typing import Iterable, Optional
from urllib.parse import quote

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA

SITE = "https://easycredit-bbl.de"
SCHEDULE_URL = f"{SITE}/saison/aktuelle-spiele"
GAME_URL = SITE + "/spiele/{gid}"
IMAGE_PROXY = SITE + "/_next/image?url={url}&w=384&q=75"

#: The site's OWN client calls this directly - found by hooking fetch() in a real page load,
#: not documented anywhere. It is the same API that answers 401 to a bare GET on any other
#: path (/, /v1/matches, /_next/data/...); this specific path is public and CORS-open, proven
#: from a real browser: GET .../games?currentPage=1&pageSize=9&gameType=scheduled&competition=BBL
#: -> 200, cache-control: public, max-age=900. gameType is "scheduled" or "finished"; pageSize
#: above the site's own default (9) was not proven safe (one probe at 20-200 came back 401
#: together with the plain default call, which reads as a rate limit tripped by testing, not a
#: size rejection - but nothing here relies on that guess, since GAMES_PAGE_SIZE stays 9).
GAMES_API = "https://api.basketball-bundesliga.de/games"
GAMES_PAGE_SIZE = 9
#: 34 pages was the season's real total when this was measured (18 clubs, ~306 fixtures). Capped
#: well above that so a longer season does not go quietly incomplete, and far below "walk forever"
#: so a server that never says done cannot turn one poll into thousands of requests.
GAMES_PAGE_CAP = 60

_NEXT = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)

#: BBL event type -> (actionType, subType, whether isSuccessful means anything).
#: SUBSTITUTION is absent on purpose: it becomes two events, so it is handled on its own.
EVENTS = {
    "TWO_POINT_THROW":   ("2pt", True),
    "THREE_POINT_THROW": ("3pt", True),
    "FREE_THROW":        ("freethrow", True),
    "REBOUND":           ("rebound", False),
    "TEAM_REBOUND":      ("rebound", False),
    "TURN_OVER":         ("turnover", False),
    "TEAM_TURN_OVER":    ("turnover", False),
    "STEAL":             ("steal", False),
    "BLOCK":             ("block", False),
    "FOUL":              ("foul", False),
    "RECEIVED_FOUL":     ("foulon", False),
    "TIME_OUT":          ("timeout", False),
}

#: A club-level event has no player to charge, and an empty pno is how the stint builder knows.
TEAM_EVENTS = {"TEAM_REBOUND", "TEAM_TURN_OVER", "TIME_OUT"}

#: qualifier -> the shot subType stints.py families already recognise. BBL names only four
#: finishes and one catch-all jump shot; it has no pull-up/step-back vocabulary, so the
#: off-the-dribble columns stay an honest zero rather than being invented from JUMP_SHOT.
SHOT_SUBTYPE = {"LAYUP": "layup", "DUNK": "dunk", "TIP_IN": "tipin",
                "ALLEY_OOP": "alleyoop", "JUMP_SHOT": "jumpshot"}
REBOUND_SUBTYPE = {"OFFENSIVE": "offensive", "DEFENSIVE": "defensive"}
TURNOVER_SUBTYPE = {"BAD_PASS": "badpass", "BALL_CONTROL": "ballhandling"}
FOUL_SUBTYPE = {"PERSONAL_FOUL": "personal", "OFFENSIVE": "offensive"}

#: playerStats field -> the FIBA stat name fibashape stores.
BOX = {
    "points": "sPoints",
    "fieldGoalsMade": "sFieldGoalsMade", "fieldGoalsAttempted": "sFieldGoalsAttempted",
    "twoPointShotsMade": "sTwoPointersMade", "twoPointShotsAttempted": "sTwoPointersAttempted",
    "threePointShotsMade": "sThreePointersMade",
    "threePointShotsAttempted": "sThreePointersAttempted",
    "freeThrowsMade": "sFreeThrowsMade", "freeThrowsAttempted": "sFreeThrowsAttempted",
    "offensiveRebounds": "sReboundsOffensive", "defensiveRebounds": "sReboundsDefensive",
    "totalRebounds": "sReboundsTotal", "assists": "sAssists", "turnovers": "sTurnovers",
    "steals": "sSteals", "blocks": "sBlocks", "foulsCommitted": "sFoulsPersonal",
    "foulsReceived": "sFoulsOn", "plusMinus": "sPlusMinusPoints",
}


def _nextdata(html: str) -> dict:
    m = _NEXT.search(html or "")
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except ValueError:
        return {}


def _props(html: str) -> dict:
    return (_nextdata(html).get("props") or {}).get("pageProps") or {}


def proxied(url: str) -> str:
    """A club crest, served by the league's own image proxy instead of its walled API."""
    if not url:
        return ""
    if url.startswith(SITE) or not url.startswith("http"):
        return url
    return IMAGE_PROXY.format(url=quote(url, safe=""))


def _mmss(game_time: str) -> str:
    """gameTime is HH:MM:SS REMAINING in the period; the contract wants M:SS remaining."""
    parts = [int(x or 0) for x in str(game_time or "0:0:0").split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    _, mm, ss = parts[-3:]
    return "%d:%02d" % (mm, ss)


class BBLAdapter(FibaLiveStatsAdapter):
    """FibaLiveStatsAdapter for bundle_from_raw and nothing else: once the page's JSON has been
    shaped into a FIBA payload, the box score, four factors, shot zones and stints are the same
    code every other league already runs."""

    name = "bbl"
    #: Slower than the base default: one probe at pageSize>9 came back 401 together with a plain
    #: default-sized call, which is what a tripped rate limit looks like, not a size rejection.
    #: The season's whole schedule is walked in one poll, so it is worth the extra patience.
    min_request_gap_s = 0.8

    # ------------------------------------------------------------------ schedule
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        """Every fixture, scheduled and finished, from the same API the site's own client calls.

        THE SEASON PAGE ALONE IS A WINDOW, NOT THE FIXTURE LIST - it renders nine games and turns
        further pages by calling this endpoint itself, client-side. Reading that call rather than
        the page it is embedded in is what turns nine fixtures into the whole season: paged with
        the site's own page size, both gameTypes, until a page comes back short or the safety cap
        is reached.

        NOT EVERY NETWORK CAN REACH IT. This host answers 401 to a request it does not like, and
        which requests it likes is not fully known - a browser succeeded and a script from this
        machine did not, which reads as IP reputation rather than headers or TLS (curl, requests
        and a Chrome-impersonating client all failed alike; changing User-Agent or adding
        Origin/Referer changed nothing). lnb.fr already blocks GitHub's runners the same way
        (docs/README notes it), so this may or may not clear from Actions - it will from a
        residential connection. Either way the adapter must not go quiet: if the bulk endpoint
        gives back nothing at all, this falls back to the season page's own embedded window
        rather than returning zero fixtures.
        """
        seen, out = set(), []
        bulk_ok = False
        for kind in ("finished", "scheduled"):
            for page in self._walk_games(kind):
                bulk_ok = True
                for item in page:
                    g = self._fixture(item)
                    if g and g.external_id not in seen:
                        seen.add(g.external_id)
                        out.append(g)

        if bulk_ok:
            return out

        # THE FALLBACK. Whatever blocked the bulk call almost certainly blocks the season page's
        # own SSR request too, since both are the same host - but that request is one GET, costs
        # nothing extra to try, and on a network the bulk endpoint refuses but the site itself
        # still answers (a CDN edge, a different block rule per path) it recovers a small window
        # instead of an empty league.
        html = self._text(schedule_url or SCHEDULE_URL)
        if not html:
            return []
        for block in self._schedule_blocks(_props(html)):
            for item in block:
                g = self._fixture(item)
                if g and g.external_id not in seen:
                    seen.add(g.external_id)
                    out.append(g)
        return out

    def _walk_games(self, game_type: str) -> Iterable[list]:
        """Pages of the bulk endpoint for one gameType, oldest call first. Yields each page's
        items; stops on a short page (the last one), an unparsable reply (blocked or erroring),
        or the safety cap. A page that fails outright is not retried - the season poll runs every
        30 minutes on its own, and a game missed this pass is not missed for long."""
        for page_no in range(1, GAMES_PAGE_CAP + 1):
            data = self._games_page(game_type, page_no)
            if data is None:
                return
            items = data.get("items") or []
            if items:
                yield items
            if len(items) < GAMES_PAGE_SIZE or page_no >= S.num(data.get("totalPages"), page_no):
                return

    def _games_page(self, game_type: str, page_no: int) -> Optional[dict]:
        gap = time.time() - getattr(self, "_last_page", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_page = time.time()
        try:
            r = requests.get(GAMES_API, params={"currentPage": page_no, "pageSize": GAMES_PAGE_SIZE,
                                                "gameType": game_type, "competition": "BBL"},
                             headers={"User-Agent": UA, "Accept": "application/json",
                                      "Origin": SITE, "Referer": SITE + "/"}, timeout=30)
        except requests.RequestException:
            return None
        if r.status_code != 200:
            return None
        try:
            return r.json()
        except ValueError:
            return None

    @staticmethod
    def _schedule_blocks(props: dict) -> Iterable[list]:
        """The widget's key is a JSON blob of its own block config, so it is found by shape."""
        for holder in ((props.get("preloadedWidgetData") or {}).values()):
            if not isinstance(holder, dict):
                continue
            for key in ("finishedGames", "scheduledGames", "games"):
                blk = holder.get(key)
                if isinstance(blk, dict) and isinstance(blk.get("items"), list):
                    yield blk["items"]
                elif isinstance(blk, list):
                    yield blk
        # a club page carries the same two lists at the top level instead
        for key in ("finishedGames", "games", "scheduledGames"):
            blk = props.get(key)
            if isinstance(blk, dict) and isinstance(blk.get("items"), list):
                yield blk["items"]
            elif isinstance(blk, list):
                yield blk

    @classmethod
    def _fixture(cls, item: dict) -> Optional[ScheduleGame]:
        gid = str(item.get("id") or item.get("sourceId") or "").strip()
        if not gid.isdigit():
            return None
        home, away = item.get("homeTeam") or {}, item.get("guestTeam") or {}
        status = str(item.get("status") or "").upper()
        return ScheduleGame(
            external_id=gid,
            home_name=(home.get("name") or "").strip(),
            away_name=(away.get("name") or "").strip(),
            tipoff_at=item.get("scheduledTime") or None,
            # OFFICIAL is the feed's word for a result that has been signed off; PRE is a fixture
            # that has not tipped. Anything else is a game in progress.
            status={"OFFICIAL": "final", "PRE": "scheduled"}.get(status, "live"),
            extra={"home_logo": proxied(home.get("logoUrl") or ""),
                   "away_logo": proxied(away.get("logoUrl") or ""),
                   "home_code": (home.get("tlc") or "").strip(),
                   "away_code": (away.get("tlc") or "").strip(),
                   "venue": (item.get("venue") or {}).get("name") if isinstance(item.get("venue"), dict) else None,
                   "matchday": item.get("matchDay"),
                   "competition": item.get("competition")})

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        if not re.fullmatch(r"\d{4,9}", str(external_id)):
            return None
        html = self._text(GAME_URL.format(gid=external_id))
        gs = (_props(html) or {}).get("initialGameStats") or {}
        actions = gs.get("actions") or []
        if not actions:
            return None                    # not tipped off, or the page served no stats

        finished = str(gs.get("status") or "").upper() == "OFFICIAL"
        sides, team_no, starters = [], {}, {}
        for key, tno in (("homeTeam", 1), ("guestTeam", 2)):
            rows = (gs.get(key) or {}).get("playerStats") or []
            club = (rows[0].get("seasonTeam") or {}) if rows else {}
            team_no[str(club.get("seasonTeamId") or "")] = tno
            players = {}
            for r in rows:
                sp = r.get("seasonPlayer") or {}
                pid = str(sp.get("id") or "")
                if not pid:
                    continue
                stats = {BOX[k]: S.num(v) for k, v in r.items() if k in BOX}
                players[pid] = S.player(
                    first=(sp.get("firstName") or "").strip(),
                    last=(sp.get("lastName") or "").strip(),
                    shirt=str(r.get("shirtNumber") or sp.get("shirtNumber") or ""),
                    starter=1 if r.get("isStartingFive") else 0, active=1,
                    minutes=_clock(r.get("secondsPlayed")),
                    position=(sp.get("position") or "").strip(),
                    stats=stats)
            starters[tno] = {pid for pid, p in players.items() if p.get("starter")}
            totals = S.totals_of(players)
            sides.append(S.team((club.get("name") or "").strip(), (club.get("tlc") or "").strip(),
                                score=totals.get("sPoints"), players=players, shots=[],
                                totals=totals, logo=proxied(club.get("logoUrl") or "")))

        raw = S.game(sides[0], sides[1], played=finished,
                     pbp=self._events(actions, team_no, finished, starters))
        last = max(actions, key=lambda a: a.get("orderId") or 0)
        raw["period"] = max(1, S.num(last.get("period"), 1))
        raw["clock"] = _mmss(last.get("gameTime"))
        b = self.bundle_from_raw(raw, str(external_id), config)
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        elif gs.get("scheduledTime"):
            b.tipoff_at = gs["scheduledTime"]
        return b

    # ------------------------------------------------------------------ the period lineups
    @staticmethod
    def _period_fives(actions: list, team_no: dict) -> dict:
        """Who each club had on court when a period began, inferred from what they then did.

        THE FEED NEVER SAYS. Both clubs put a fresh five out after a break and none of it is
        reported as a substitution, so replaying substitutions alone drifts: on the game this was
        built against it ended with eight men on court for ALBA, and left 15 stints that were not
        five a side. The evidence is in the period itself:

          * a player SUBSTITUTED OUT before he was ever substituted in was on court at the break;
          * a player who DOES anything - a shot, a rebound, a foul - before coming on was too.

        Five is the cap, and the first five names the period produces are the ones taken. A period
        that never yields five (a quiet quarter for a club, or a period with no events at all)
        keeps whoever was already on, which is the safest reading rather than an invented one."""
        fives: dict = {}
        for a in sorted(actions, key=lambda x: x.get("orderId") or 0):
            period = max(1, S.num(a.get("period"), 1))
            tno = team_no.get(str(a.get("seasonTeamId") or ""), 0)
            if not tno:
                continue
            slot = fives.setdefault((period, tno), {"on": [], "in": set()})
            if str(a.get("type")) == "SUBSTITUTION":
                out_p = str(a.get("seasonPlayerId") or "")
                in_p = str(a.get("assistingSeasonPlayerId") or "")
                if out_p and out_p not in slot["in"] and out_p not in slot["on"] and len(slot["on"]) < 5:
                    slot["on"].append(out_p)
                if in_p:
                    slot["in"].add(in_p)
            else:
                pid = str(a.get("seasonPlayerId") or "")
                if pid and pid not in slot["in"] and pid not in slot["on"] and len(slot["on"]) < 5:
                    slot["on"].append(pid)
        return {k: v["on"] for k, v in fives.items()}

    # ------------------------------------------------------------------ the events
    @classmethod
    def _events(cls, actions: list, team_no: dict, finished: bool, starters: dict) -> list:
        """The same actions in the platform's FIBA event shape, oldest first.

        orderId is the feed's own sequence and it does not repeat, so it is what the stream is
        sorted by. actionNumber is this list's index: a substitution becomes two events and they
        must not share a number, or a sort that ties on it can put the man on court before the
        man he replaced is off."""
        ordered = sorted(actions, key=lambda x: x.get("orderId") or 0)
        fives = cls._period_fives(ordered, team_no)
        on = {tno: set(pids) for tno, pids in starters.items()}
        out, opened = [], set()
        for a in ordered:
            kind = str(a.get("type") or "")
            tno = team_no.get(str(a.get("seasonTeamId") or ""), 0)
            period = max(1, S.num(a.get("period"), 1))
            gt = _mmss(a.get("gameTime"))

            # A NEW PERIOD: reconcile each club to the five the period's own evidence names,
            # before anything in it is counted. Period 1 is left alone - the box score's
            # starting five is stated there and is better evidence than inference.
            if period > 1 and period not in opened:
                opened.add(period)
                for t in sorted(on):
                    want = set(fives.get((period, t)) or ())
                    if len(want) != 5:
                        continue                      # not enough evidence: keep what is on
                    for gone in sorted(on[t] - want):
                        out.append({"actionNumber": len(out) + 1, "actionType": "substitution",
                                    "subType": "out", "period": period, "gt": _mmss("00:10:00"),
                                    "tno": t, "pno": gone})
                    for came in sorted(want - on[t]):
                        out.append({"actionNumber": len(out) + 1, "actionType": "substitution",
                                    "subType": "in", "period": period, "gt": _mmss("00:10:00"),
                                    "tno": t, "pno": came})
                    on[t] = set(want)

            def ev(action, sub, pno, success=None):
                e = {"actionNumber": len(out) + 1, "actionType": action, "subType": sub,
                     "period": period, "gt": gt, "tno": tno, "pno": pno}
                if success is not None:
                    e["success"] = 1 if success else 0
                out.append(e)
                return e

            if kind == "SUBSTITUTION":
                # seasonPlayerId leaves, assistingSeasonPlayerId arrives - see the module note.
                gone = str(a.get("seasonPlayerId") or "")
                came = str(a.get("assistingSeasonPlayerId") or "")
                ev("substitution", "out", gone)
                ev("substitution", "in", came)
                if tno in on:
                    on[tno].discard(gone)
                    on[tno].add(came)
                continue

            if kind in ("START", "END"):
                # The last END of a finished game is the whistle; the rest close their period.
                if kind == "END" and finished and a is max(
                        (x for x in actions if str(x.get("type")) == "END"),
                        key=lambda x: x.get("orderId") or 0):
                    ev("game", "end", "")
                else:
                    ev("period", "start" if kind == "START" else "end", "")
                continue

            spec = EVENTS.get(kind)
            if spec is None:
                continue                      # jump balls: no stat, no lineup change
            action, uses_success = spec
            quals = [str(q) for q in (a.get("qualifiers") or [])]
            sub = ""
            if action in ("2pt", "3pt"):
                sub = next((SHOT_SUBTYPE[q] for q in quals if q in SHOT_SUBTYPE), "")
            elif action == "rebound":
                sub = next((REBOUND_SUBTYPE[q] for q in quals if q in REBOUND_SUBTYPE), "")
            elif action == "turnover":
                sub = next((TURNOVER_SUBTYPE[q] for q in quals if q in TURNOVER_SUBTYPE), "")
            elif action == "foul":
                sub = next((FOUL_SUBTYPE[q] for q in quals if q in FOUL_SUBTYPE), "personal")
            elif action == "freethrow":
                sub = next((q.lower() for q in quals if q.startswith("ATTEMPT_")), "")

            pno = "" if kind in TEAM_EVENTS else str(a.get("seasonPlayerId") or "")
            e = ev(action, sub, pno, a.get("isSuccessful") if uses_success else None)
            if kind in TEAM_EVENTS:
                e["qualifiers"] = ["team"]
            # an assisted basket names its passer the way FIBA does
            if action in ("2pt", "3pt") and a.get("isSuccessful") and a.get("assistingSeasonPlayerId"):
                ev("assist", "", str(a["assistingSeasonPlayerId"]))
        return out

    # ------------------------------------------------------------------ plumbing
    def _text(self, url: str) -> str:
        """One page, politely. Same request gap the other translated adapters keep, because this
        is a league's own website rather than a feed built to be polled."""
        gap = time.time() - getattr(self, "_last_page", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_page = time.time()
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9"},
                         timeout=60)
        if r.status_code in (401, 403, 404):
            return ""                       # not published: not an error, and not "no games"
        r.raise_for_status()
        return r.text


def _clock(seconds) -> str:
    s = int(S.num(seconds))
    return "%d:%02d" % (s // 60, s % 60)
