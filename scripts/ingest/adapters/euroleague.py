"""EuroLeague — its own API, shaped into the payload the platform already reads.

THREE FEEDS PER GAME, which is what the scraper has always used (LINEUPDATASCRAPE
fetch_euroleague_game_via_api):

    live.euroleague.net/api/Boxscore?gamecode=&seasoncode=     the box score
    live.euroleague.net/api/PlayByPlay?gamecode=&seasoncode=   team names/codes AND the events
    live.euroleague.net/api/Points?gamecode=&seasoncode=       the shot chart (optional)

and one feed for the whole season's schedule, which also carries the crests:

    feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/E<year>/games

THE SEASON IS E + THE START YEAR. E2026 is 2026-27, and the platform's own season name is the only
thing every source here agrees on, so it is derived from that rather than configured.

THE PLAY-BY-PLAY WAS ALREADY BEING DOWNLOADED AND THROWN AWAY — the feed was fetched for two team
names and then dropped, so EuroLeague and EuroCup shipped no stints and no lineups at all. Its
PLAYTYPE rows are now translated into the event contract scripts/ingest/stints.py replays
(_events below); LINEUPDATASCRAPE._parse_euroleague_pbp_json is the specification for the mapping
and for the extra-time splitter.

WHAT IS DELIBERATELY NOT PORTED is the scraper's substitution repair — the operators enter the IN
before the matching OUT and leave six men on court until it lands. stints.py holds an IN that
would make six and releases it when an OUT frees a slot, which is the same repair done once for
every league instead of again for this one, so the translation here stays a translation: it emits
the subs in the order the feed states them and does not second-guess them.

THE SHOT CHART is the reason the Points feed is worth a third request: EuroLeague coordinates are
centimetres from the basket, and fibashape.at_rim_offset turns them into the chart percentages the
rim/mid/three split is measured in. A Points failure degrades to no shot chart, never to no game.

THE SHOT CHART is the reason the Points feed is worth a third request: EuroLeague coordinates are
centimetres from the basket, and fibashape.at_rim_offset turns them into the chart percentages the
rim/mid/three split is measured in. A Points failure degrades to no shot chart, never to no game.
It is also where a shot's rim/fast-break/second-chance classification comes from (_pbp_join), so a
Points failure degrades those stint columns to zero and nothing else.
"""
from __future__ import annotations

import re
import time
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter
import names as _names                  # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"
SCHEDULE = ("https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/"
            "{comp}/seasons/{season}/games?limit=500")
LIVE = "https://live.euroleague.net/api/{feed}?gamecode={code}&seasoncode={season}"

# Boxscore player row -> the FIBA stat names. Everything the pipeline reads, nothing it does not.
PLAYER_STATS = {
    "sPoints": "Points",
    "sTwoPointersMade": "FieldGoalsMade2", "sTwoPointersAttempted": "FieldGoalsAttempted2",
    "sThreePointersMade": "FieldGoalsMade3", "sThreePointersAttempted": "FieldGoalsAttempted3",
    "sFreeThrowsMade": "FreeThrowsMade", "sFreeThrowsAttempted": "FreeThrowsAttempted",
    "sReboundsOffensive": "OffensiveRebounds", "sReboundsDefensive": "DefensiveRebounds",
    "sReboundsTotal": "TotalRebounds",
    "sAssists": "Assistances", "sTurnovers": "Turnovers", "sSteals": "Steals",
    "sBlocks": "BlocksFavour", "sBlocksReceived": "BlocksAgainst",
    "sFoulsPersonal": "FoulsCommited", "sFoulsOn": "FoulsReceived",
    "sPlusMinusPoints": "Plusminus",
}

# The feed's own quarter keys, INCLUDING ITS SPELLING of the fourth one. "ForthQuarter" is not a
# typo here; it is the typo in the API, and correcting it silently drops a quarter of the game.
QUARTERS = (("FirstQuarter", 1), ("SecondQuarter", 2), ("ThirdQuarter", 3), ("ForthQuarter", 4))

# PLAYTYPE -> the event contract, from LINEUPDATASCRAPE._parse_euroleague_pbp_json's action map.
# The scraper renders each one as an English sentence for its own text parser; these are the same
# rows in FIBA's vocabulary instead, because that is what stints.py replays.
SHOT_PLAYS = {"2FGM": ("2pt", 1), "2FGA": ("2pt", 0), "3FGM": ("3pt", 1), "3FGA": ("3pt", 0),
              "FTM": ("freethrow", 1), "FTA": ("freethrow", 0)}
PLAYS = {"D": ("rebound", "defensive"), "O": ("rebound", "offensive"),
         "TO": ("turnover", ""), "ST": ("steal", ""), "FV": ("block", ""), "AS": ("assist", ""),
         "RV": ("foulon", ""),          # "Foul Drawn": no stint column, but it proves he was on court
         "IN": ("substitution", "in"), "OUT": ("substitution", "out")}
# Fouls keep their own kind, because the stint builder drops the ones that belong to nobody on the
# floor (anything technical / bench / coach). CMTI is NOT one of those: it is a throw-in foul, an
# ordinary personal that only looks technical because its code starts CMT.
FOUL_PLAYS = {"CM": "personal", "OF": "offensive", "CMU": "unsportsmanlike",
              "CMD": "disqualifying", "CMT": "technical", "CMTI": "personal",
              "B": "bench", "C": "coach"}
# Everything else the feed carries — TOUT / TOUT_TV timeouts, CCH coach challenges, JB jump balls,
# AG "Shot Rejected" (the blocked shooter, already counted as the miss itself) — is not a stat and
# not a lineup change, and is dropped exactly as the scraper drops it.

#: centimetres from the basket inside which a two is a rim attempt. The PBP carries NO shot subtype
#: ("Two Pointer (1/1 - 2 pt)" is the whole of it), which is what used to leave EuroLeague with
#: RIM_ATT=0, so rim is decided geometrically off the Points feed. 200 is the scraper's calibrated
#: cut: the 2pt distance histogram falls off sharply past it, and it puts EuroLeague's rim share at
#: 64.5% against 60.8% in LNB, the nearest league that publishes true subtypes.
RIM_CM = 200


def _season(config: dict, comp: str = "E") -> str:
    """"2026-27" -> "E2026", or "U2026" for the EuroCup.

    THE SEASON CODE CARRIES THE COMPETITION. Both competitions run on the same two hosts and the
    same field names; what separates them is one letter, in the feeds path AND in the season code
    (E2026 is the EuroLeague, U2026 the EuroCup). Hard-coding the E here was the only thing
    stopping the EuroCup being a config entry."""
    raw = str(config.get("season") or "")
    m = re.match(r"[A-Z]?(\d{4})", raw)
    return comp + (m.group(1) if m else str(time.gmtime().tm_year))


def _stats(row: dict) -> dict:
    out = {k: S.num(row.get(v)) for k, v in PLAYER_STATS.items()}
    out["sFieldGoalsMade"] = out["sTwoPointersMade"] + out["sThreePointersMade"]
    out["sFieldGoalsAttempted"] = out["sTwoPointersAttempted"] + out["sThreePointersAttempted"]
    return out


class EuroLeagueAdapter(FibaLiveStatsAdapter):
    name = "euroleague"
    min_request_gap_s = 0.4
    competition = "E"        # "U" is the EuroCup: same hosts, same fields, one letter apart

    # ---------------------------------------------------------------- schedule ---
    def _json(self, url: str):
        gap = time.time() - getattr(self, "_last_api", 0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last_api = time.time()
        r = requests.get(url, headers={"User-Agent": UA}, timeout=45)
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        if not r.content.strip():
            return None              # a game not started yet: live.euroleague.net answers 200 with nothing
        return r.json()

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        comp = config.get("competition_code") or self.competition
        season = _season(config, comp)
        data = self._json(SCHEDULE.format(comp=comp, season=season)) or {}
        out = []
        for g in data.get("data") or []:
            code = g.get("code")
            if code is None:
                continue
            home, away = g.get("home") or {}, g.get("away") or {}
            # THE CRESTS ARE ON THE SCHEDULE, one per club, so a club has its badge on the site
            # before its first game is even played (run_ingest.sync_logos reads these).
            out.append(ScheduleGame(
                external_id=f"{season}_{code}",
                home_name=home.get("name") or "", away_name=away.get("name") or "",
                tipoff_at=g.get("date"),
                status="final" if g.get("played") else "scheduled",
                extra={"home_logo": (home.get("imageUrls") or {}).get("crest"),
                       "away_logo": (away.get("imageUrls") or {}).get("crest"),
                       "home_code": (home.get("code") or home.get("tla") or "").strip(),
                       "away_code": (away.get("code") or away.get("tla") or "").strip(),
                       # the arena (0162, EPINOIA GO): {"code": "AUM6", "name": "TELEKOM CENTER ATHENS", "address": ...}
                       "venue": ((g.get("venue") or {}).get("name") or "").strip() or None,
                       "venue_address": ((g.get("venue") or {}).get("address") or "").strip() or None}))
        self.last_competitions = []
        return out

    # ------------------------------------------------------------------- game ---
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        m = re.match(r"([A-Z]\d{4})_(\d+)$", str(external_id))
        if not m:
            return None
        season, code = m.group(1), m.group(2)
        box = self._json(LIVE.format(feed="Boxscore", code=code, season=season))
        stats = (box or {}).get("Stats") or []
        if len(stats) != 2:
            return None                      # not played, or half-published: try again next pass
        pbp = self._json(LIVE.format(feed="PlayByPlay", code=code, season=season)) or {}
        points = self._json(LIVE.format(feed="Points", code=code, season=season)) or {}

        # The PBP feed is where the club's own spelling and its three-letter code live; the
        # Boxscore shouts the name ("ANADOLU EFES ISTANBUL") and carries no code at all.
        sides = [
            {"name": (pbp.get("TeamA") or stats[0].get("Team") or "").strip(),
             "code": (pbp.get("CodeTeamA") or "").strip(), "box": stats[0]},
            {"name": (pbp.get("TeamB") or stats[1].get("Team") or "").strip(),
             "code": (pbp.get("CodeTeamB") or "").strip(), "box": stats[1]},
        ]
        quarters = self._quarters(box)
        joined = self._pbp_join(points)

        rosters = []
        for side in sides:
            players = {}
            for row in side["box"].get("PlayersStats") or []:
                # Player_ID is the one stable handle in this feed. THE NAME IS SHOUTED AND
                # COMMA-FLIPPED ("OKOBO, ELIE"), and it is turned into the platform's form HERE, in
                # the payload, because the payload is what the game page reads: its roster, its
                # court and its box score come from games.roster_snapshot and game_advanced, built
                # straight from these fields, not from the players table names.py fills. Passed
                # through raw, every EuroLeague game page read "OKOBO, ELIE" (reported 24 Sep
                # 2026). The feed's own form stays as scoreboardName, so it is still an alias.
                pno = (row.get("Player_ID") or "").strip() or str(len(players) + 1)
                shouted = (row.get("Player") or "").strip()
                first, last, _ = _names.person(shouted)
                players[pno] = S.player(
                    first=first, last=last, name=f"{first} {last}".strip() or shouted,
                    shirt=(row.get("Dorsal") or "").strip(),
                    starter=row.get("IsStarter"), active=1,
                    minutes=(row.get("Minutes") or "0:00").strip() or "0:00",
                    stats=_stats(row))
                if shouted:
                    players[pno]["scoreboardName"] = shouted
            rosters.append(players)

        # the plays first: each is numbered, and the shot chart joins its dots to those numbers
        numbered: dict = {}
        events = self._events(pbp, sides, rosters, joined, numbered)
        shots = self._shots_by_code(points, numbered)

        tm = []
        for i, side in enumerate(sides):
            totals = self._team_totals(side["box"], rosters[i])
            tm.append(S.team(side["name"], side["code"],
                             score=totals.get("sPoints"),
                             quarters=quarters[i], players=rosters[i],
                             shots=shots.get(side["code"], []), totals=totals))

        played = self._played(box, pbp, tm)
        raw = S.game(tm[0], tm[1], played=played, pbp=events)
        # S.game closes a finished game whose log never did with a game-end of its own; it is a
        # play like the others and needs its number, or the translator drops it with the rest
        top = max((e.get("actionNumber") or 0 for e in raw["pbp"]), default=0)
        for e in raw["pbp"]:
            if e.get("actionNumber") is None:
                top += 1
                e["actionNumber"] = top
        b = self.bundle_from_raw(raw, str(external_id), config)
        if config.get("_tipoff_at"):
            b.tipoff_at = config["_tipoff_at"]
        return b

    @staticmethod
    def _played(box: dict, pbp: dict, tm: list) -> bool:
        """Is the game over? Read from the feed, never assumed.

        THIS WAS `played=True`, from when this adapter only ever fetched finished games. The live
        lane fetches a game from twenty minutes before its tip-off, and the Boxscore carries both
        clubs as soon as the line-ups are entered, so on 24 Sep 2026 - EuroLeague's opening night -
        the first look at each game, six minutes before tip-off, came back "final": the lane never
        looked at it again and the site sat at 0-0 while it was played.

        Over is the End Game play in the play-by-play (_events turns it into the game-end event),
        or the Boxscore no longer flagging the game live once points are on the board - the second
        for a finished game whose log lacks the play. Live, or not started, is neither."""
        rows = [e for key, _ in QUARTERS for e in pbp.get(key) or []] + list(pbp.get("ExtraTime") or [])
        if any((e.get("PLAYTYPE") or "").strip() == "EG" for e in rows):
            return True
        scored = any(S.num(t.get("score")) for t in tm)
        return (box or {}).get("Live") is False and scored

    # ----------------------------------------------------------------- pieces ---
    @staticmethod
    def _quarters(box: dict) -> list:
        """[[q1..q4], [q1..q4]] from ByQuarter, which is per team and per quarter.

        ByQuarter is the points scored IN each quarter; EndOfQuarter is the running score, and
        reading that one instead would put 85 in the fourth column of a 25-point quarter."""
        out = [[], []]
        for i, row in enumerate((box.get("ByQuarter") or [])[:2]):
            out[i] = [S.num(row.get("Quarter%d" % q)) for q in range(1, 5)]
        return out

    @staticmethod
    def _team_totals(side_box: dict, players: dict) -> dict:
        """The club's own totals row where it has one, summed from its players where it does not."""
        tot = side_box.get("totr") or {}
        if not tot:
            return S.totals_of(players)
        out = {k: S.num(tot.get(v)) for k, v in PLAYER_STATS.items() if v in tot}
        base = S.totals_of(players)
        for k in S.STATS:
            out.setdefault(k, base.get(k, 0))
        out["sFieldGoalsMade"] = out.get("sTwoPointersMade", 0) + out.get("sThreePointersMade", 0)
        out["sFieldGoalsAttempted"] = out.get("sTwoPointersAttempted", 0) + out.get("sThreePointersAttempted", 0)
        return out

    @staticmethod
    def _shots_by_code(points: dict, numbered: Optional[dict] = None) -> dict:
        """The Points rows as chart-percentage shots, per team code.

        Free throws are sentinel-coded (-1, -1) and are not shots on a chart; everything else is
        an offset in centimetres from the basket it was taken at. `numbered` (NUMBEROFPLAY ->
        actionNumber, from _events) gives each dot the number of its play, which is how the event
        translator puts a shot on the game page's chart."""
        out: dict = {}
        for r in (points or {}).get("Rows") or []:
            act = (r.get("ID_ACTION") or "").strip()
            if act not in ("2FGM", "2FGA", "3FGM", "3FGA"):
                continue
            cx, cy = S.num(r.get("COORD_X"), -1), S.num(r.get("COORD_Y"), -1)
            if cx == -1 and cy == -1:
                continue
            x, y = S.at_rim_offset(cx, cy)
            code = (r.get("TEAM") or "").strip()
            s = S.shot(x, y, made=act.endswith("M"), three=act.startswith("3"),
                       period=S.num(r.get("MINUTE")) // 10 + 1)
            an = (numbered or {}).get(S.num(r.get("NUM_ANOT"), -1))
            if an is not None:
                s["actionNumber"] = an
            out.setdefault(code, []).append(s)
        return out

    # ----------------------------------------------------------- play-by-play ---
    @staticmethod
    def _pbp_join(points: dict) -> dict:
        """What the Points feed knows about a scoring play, keyed by the play number.

        TWO THINGS THE PLAY-BY-PLAY ITSELF CANNOT ANSWER. Whether a two was taken at the rim,
        which is decided from the centimetre offsets because the PBP carries no shot subtype at
        all; and whether points came in transition, off the glass or off a turnover, which the
        feed classifies itself in FASTBREAK / SECOND_CHANCE / POINTS_OFF_TURNOVER and which are
        otherwise three columns of honest zeroes in every EuroLeague stint.

        Join key: Points.NUM_ANOT == PlayByPlay.NUMBEROFPLAY, the scraper's own join."""
        out: dict = {}
        for r in (points or {}).get("Rows") or []:
            n = r.get("NUM_ANOT")
            if n is None:
                continue                  # nothing to join on; a shared "missing" key would file
                                          # this row's rim flag onto some other team's shot
            act = (r.get("ID_ACTION") or "").strip()
            x, y = S.num(r.get("COORD_X")), S.num(r.get("COORD_Y"))
            quals = [q for q, key in (("fastbreak", "FASTBREAK"), ("2ndchance", "SECOND_CHANCE"),
                                      ("fromturnover", "POINTS_OFF_TURNOVER"))
                     if str(r.get(key) or "0").strip() == "1"]
            out[S.num(n, -1)] = {
                # Free throws are sentinel-coded (-1, -1), which is a centimetre and a half from
                # the basket by arithmetic and no kind of rim attempt, so the action gates it.
                "rim": act in ("2FGM", "2FGA") and (x * x + y * y) ** 0.5 <= RIM_CM,
                "qualifier": quals}
        return out

    @staticmethod
    def _ot_periods(events: list) -> list:
        """The period each ExtraTime row belongs to — 5, 6, … — since the feed pools every
        overtime into one block.

        THE MINUTE IS THE SPLITTER the scraper uses (41-45 is the first overtime, 46-50 the
        second). What it cannot do is place the rows that carry no clock: "End Period" for OT1 is
        stamped minute 46, and by that arithmetic the end of the first overtime files itself
        inside the second — and then the clock, which every stint's length is measured from, jumps
        five minutes. A period start belongs with the play that follows it and an end with the
        play before it, so a clockless row takes its period from its neighbours."""
        per = [5 + max(0, (S.num(e.get("MINUTE"), 41) - 41) // 5)
               if (e.get("MARKERTIME") or "").strip() else None for e in events]
        for i, p in enumerate(per):
            if p is not None:
                continue
            after = next((q for q in per[i + 1:] if q is not None), None)
            before = next((q for q in reversed(per[:i]) if q is not None), None)
            start = (events[i].get("PLAYTYPE") or "").strip() == "BP"
            per[i] = (after if start else before) or before or after or 5
        return per

    @classmethod
    def _events(cls, pbp: dict, sides: list, rosters: list, joined: dict, numbered: Optional[dict] = None) -> list:
        """The PlayByPlay feed as the event stream scripts/ingest/stints.py replays.

        EVERY EVENT IS NUMBERED, actionNumber 1..n in play order, as every other adapter's are:
        the event translator (translate/fiba_events.py) sorts by it and drops an event without
        one. These had none, so no EuroLeague game ever had an event log on the site - the page's
        box score, built from that log, read 0-0 at the end of the first quarter with every
        player on ten minutes (24 Sep 2026). `numbered`, when given, is filled with the feed's
        NUMBEROFPLAY -> actionNumber, for the shot chart's join; a "foul drawn" row carries the
        number of the foul it answers (previousAction), which the translator needs to credit it.

        THE CLOCK IS THE POINT OF THIS, more than the stats are. MARKERTIME is time REMAINING in
        the period, which is already FIBA's convention, so `gt` is passed straight through; what
        has to be added is the boundaries. "Begin Period" and "End Period" carry no clock of their
        own, and the stint builder moves its clock on EVERY event, so they are stamped at the top
        and the bottom of the period deliberately: without the end marker the last stint of each
        quarter would stop at the last shot and the dead tail would belong to nobody.

        A row whose clock is blank keeps the clock where the previous play left it rather than
        defaulting to 00:00, which would otherwise teleport the game to the end of the period."""
        where = {}
        for i, side in enumerate(sides):
            for key in (side.get("code"), side.get("name")):
                if key:
                    where[key.strip()] = i + 1        # tno: 1 home, 2 away, matching raw["tm"]
        # Shirt numbers as the fallback handle, built once per game rather than per event.
        shirts = [{str(p.get("shirtNumber") or ""): pno for pno, p in r.items()} for r in rosters]

        rows = [(period, e) for key, period in QUARTERS for e in pbp.get(key) or []]
        extra = pbp.get("ExtraTime") or []
        rows += list(zip(cls._ot_periods(extra), extra))

        out: list = []

        def add(ev: dict, row: dict) -> dict:
            ev["actionNumber"] = len(out) + 1
            out.append(ev)
            n = S.num(row.get("NUMBEROFPLAY"), -1)
            if numbered is not None and n != -1:
                numbered[n] = ev["actionNumber"]
            return ev

        # the foul a "foul drawn" row answers: the feed writes the drawn row straight after its
        # foul (24 of 32 on opening night), or a row or two later behind the turnover an
        # offensive foul also is - never before it, and never further than this
        last_foul = None
        FOUL_REACH = 3
        period, gt = 0, "10:00"
        for p, e in rows:
            play = (e.get("PLAYTYPE") or "").strip()
            full = "10:00" if p <= 4 else "05:00"     # an overtime is five minutes, not ten
            if p != period:
                period, gt = p, full
            gt = (e.get("MARKERTIME") or "").strip() or gt
            if play == "BP":
                add({"actionType": "period", "subType": "start", "period": p,
                     "gt": full, "tno": 0}, e)
                continue
            if play in ("EP", "EG"):
                add({"actionType": "game" if play == "EG" else "period", "subType": "end",
                     "period": p, "gt": "00:00", "tno": 0}, e)
                continue

            tno = where.get((e.get("CODETEAM") or "").strip()) or \
                where.get((e.get("TEAM") or "").strip()) or 0
            if not tno:
                continue                             # no club: a neutral row, and no stat either
            pno = (e.get("PLAYER_ID") or "").strip()
            if pno not in rosters[tno - 1]:
                # A COACH IS NOT A PLAYER. Bench and coach fouls are logged under CO_A / CO_B, and
                # an id that is not on the roster must never reach the stint builder attached to a
                # pno: it reads "acted before his side's first substitution" as proof of having
                # started, so a coach would be put on the floor and a real starter pushed off it.
                pno = shirts[tno - 1].get(str(e.get("DORSAL") or "").strip(), "")
            ev = {"period": p, "gt": gt, "tno": tno, "pno": pno}

            if play in SHOT_PLAYS:
                kind, made = SHOT_PLAYS[play]
                info = joined.get(S.num(e.get("NUMBEROFPLAY"), -1)) or {}
                ev["actionType"], ev["success"] = kind, made
                if kind != "freethrow":
                    # "jumpshot" is the neutral label on purpose: it is neither a rim type nor an
                    # off-the-dribble one, so a shot the Points feed never saw is counted as
                    # attempted and left unclassified instead of being guessed at.
                    ev["subType"] = "layup" if info.get("rim") else "jumpshot"
                if info.get("qualifier"):
                    ev["qualifier"] = info["qualifier"]
            elif play in FOUL_PLAYS:
                ev["actionType"], ev["subType"] = "foul", FOUL_PLAYS[play]
            elif play in PLAYS:
                ev["actionType"], ev["subType"] = PLAYS[play]
                if play == "RV" and last_foul is not None and len(out) + 1 - last_foul <= FOUL_REACH:
                    ev["previousAction"] = last_foul
            else:
                continue
            add(ev, e)
            if play in FOUL_PLAYS:
                last_foul = ev["actionNumber"]
        return out
