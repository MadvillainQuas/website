"""stints.py — who was on the floor, for how long, and what happened while they were.

WHY THIS EXISTS AT ALL. The adapter used to build stints by importing `fiba_api_parser` out of
Louie's scraper folder. That folder is on his PC and is simply absent on the GitHub Actions runner
where the ingest actually runs, so every league on the platform shipped `stints: []` and
`lineups: {}` — the lineup table, the margin-by-stint timeline and the starters/bench split on the
feed tab all rendered empty, silently, because an empty list is not an error. This is the same
logic, living in the repo, depending on nothing but the payload it is handed.

WHAT IT IS A PORT OF, so the two stay comparable:
  bcb_scraper.StintTrackerEnhanced   the stint record, Dean Oliver possessions, the <1s fold
  bcb_scraper.BasketballParser       substitution BUFFERING: every sub at one clock time is one
                                     lineup change, or a double substitution makes two stints and
                                     a zero-second one between them
  bcb_scraper.StintCSVStreamer       the column contract — these rows ARE stints.csv's rows
  LINEUPDATASCRAPE (EL sub repair)   the held-IN queue described below
  translate/fiba_events.py           period/clock arithmetic, imported rather than re-derived so a
                                     stint's idea of "when" can never drift from the event log's

THE INPUT is bundle.raw["pbp"], FIBA-shaped: actionType, subType, success, period, gt (clock
REMAINING as "MM:SS"), tno (1 home / 2 away) and pno (the key into raw["tm"][tno]["pl"]). Players
are tracked by pno, never by shirt number: #0 and #00 are two legal jerseys and the scraper had to
grow a special case for exactly that.

THE THREE THINGS THAT GO WRONG, all of them observed in real feeds:

  1. NOBODY SAYS WHO STARTED. The `starter` flag is missing or wrong on plenty of feeds, and a
     period's opening five is never restated. Where the flag does not give exactly five we infer
     them: the players who ACT before their side's first substitution were on court, and so was
     anyone substituted OUT before they were ever substituted IN.

  2. THE IN ARRIVES BEFORE THE OUT. EuroLeague operators do this constantly — six men on court
     until the matching OUT lands, which corrupts every lineup in between. IN/OUT are set
     operations, so only ORDER matters: an IN that would make six is HELD and released the moment
     an OUT frees a slot, and a held IN whose own OUT arrives first cancels (that player never
     actually entered).

  3. A LINEUP OF FOUR OR SIX IS A BUG, NOT A ROW. Anything that is not five a side is counted and
     reported on `.warnings` for the caller to print. Storing it quietly is how a season of
     lineup data becomes quietly wrong.

TWO DELIBERATE DEPARTURES from the scraper, both so the arithmetic closes:

  · THE CLOCK ADVANCES ON PERIOD AND GAME END. The scraper only moves time on stat events, so its
    last stint ends at the last shot (2382s in a 2400s game) and the dead tail of every period
    belongs to nobody. Here every event moves the clock, so a side's stint seconds sum to the
    game length — which is the only way "this five played 6:20" is checkable.
  · A SUB-SECOND STINT AT THE VERY START IS CARRIED FORWARD. The scraper folds a <1s stint into
    the previous one and drops it when there is no previous one (game start). Dropped points
    break the one invariant worth having — that stint plus/minus sums to the final margin — so
    with no previous stint its stats are carried into the next.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Optional

# …/scripts/ingest, so `translate` resolves however this module was reached — the adapter imports
# it after its own path setup, but bootstrap_league and build_dataset import the adapter directly.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate.fiba_events import PLEN, clock_ms, period_of, team_idx  # noqa: E402

#: stints.csv's columns, in order, from bcb_scraper.StintCSVStreamer.FIELDNAMES. Anything the feed
#: does not say stays 0 rather than absent, because index_9's engines sum columns blind.
FIELDNAMES = (
    "game_id", "game_date", "period", "home_team", "away_team", "home_lineup", "away_lineup",
    "start_time", "end_time", "duration", "possessions", "home_possessions", "away_possessions",
    "home_score", "away_score", "home_score_end", "away_score_end", "home_points", "away_points",
    "home_fga", "home_fgm", "home_fg3a", "home_fg3m", "home_fta", "home_ftm", "home_oreb",
    "home_dreb", "home_ast", "home_stl", "home_blk", "home_tov", "home_pf",
    "away_fga", "away_fgm", "away_fg3a", "away_fg3m", "away_fta", "away_ftm", "away_oreb",
    "away_dreb", "away_ast", "away_stl", "away_blk", "away_tov", "away_pf",
    "home_rim_att", "home_rim_made", "home_otd_2pt_att", "home_otd_2pt_made",
    "home_otd_3pt_att", "home_otd_3pt_made",
    "away_rim_att", "away_rim_made", "away_otd_2pt_att", "away_otd_2pt_made",
    "away_otd_3pt_att", "away_otd_3pt_made",
    "home_pass_to", "home_dribble_to", "home_defense_to", "home_misc_to",
    "away_pass_to", "away_dribble_to", "away_defense_to", "away_misc_to",
    "home_second_chance_pts", "home_fast_break_pts", "home_pts_off_tov",
    "away_second_chance_pts", "away_fast_break_pts", "away_pts_off_tov",
)

#: the counting columns, i.e. everything a fold may add together (metadata, scores, times and
#: possessions are recomputed instead) — StintTrackerEnhanced._STINT_ADDITIVE_KEYS
_ADDITIVE = tuple(c for c in FIELDNAMES if c.split("_", 1)[0] in ("home", "away")
                  and not c.endswith(("_team", "_lineup", "_score", "_score_end", "_possessions")))

# Shot-chart geometry, the calibrated constants shared with the adapter (full court 28 x 15 m drawn
# in a 0-100 frame, rims at x=6 / x=94, "at the rim" = within 4 ft).
_CHART_W_M, _CHART_H_M, _RIM_Y, _RIM_RADIUS_M = 28.0, 15.0, 50.0, 1.22

# fiba_api_parser's own two families. `tipinlayup` and `alleyoopdunk` are NOT off the dribble —
# they are follow-ups and lobs — and the rim list is only the fallback for a shot with no
# coordinates, because a "jumpshot" taken under the basket is still a rim attempt.
_OTD_SUBTYPES = {"pullupjumpshot", "stepbackjumpshot", "fadeawayjumpshot", "turnaroundjumpshot",
                 "fallawayjumpshot", "floatingjumpshot", "stepback", "fadeaway", "turnaround", "pullup"}
_RIM_SUBTYPES = {"layup", "drivinglayup", "reverselayup", "tipin", "tipinlayup", "tipindunk",
                 "dunk", "alleyoop", "alleyoopdunk", "eurostep", "hookshot"}


def _rim_dist_m(x, y) -> float:
    """Court metres from a shot marker to whichever rim is nearer, or inf if it has no marker."""
    try:
        x, y = float(x), float(y)
    except (TypeError, ValueError):
        return float("inf")
    best = float("inf")
    for rx in (6.0, 94.0):
        dx = (x - rx) / 100.0 * _CHART_W_M
        dy = (y - _RIM_Y) / 100.0 * _CHART_H_M
        best = min(best, (dx * dx + dy * dy) ** 0.5)
    return best


def _tov_bucket(subtype: str) -> str:
    """A turnover's subType into the four buckets stints.csv carries (fiba_api_parser._tov_bucket)."""
    s = (subtype or "").lower()
    if any(t in s for t in ("badpass", "bad_pass", "pass", "inbound")):
        return "pass_to"
    if any(t in s for t in ("dribble", "handling", "travel", "doubledribble", "lostball")):
        return "dribble_to"
    if any(t in s for t in ("shotclock", "24sec", "10sec", "8sec", "5sec", "3sec", "secondviolation")):
        return "defense_to"
    return "misc_to"


def _possessions(fga, fgm, fta, oreb, opp_dreb, tov) -> float:
    """Dean Oliver in full, as StintTrackerEnhanced computes it — NOT the 0.96 short form.

    Poss = FGA + 0.44*FTA - 1.07 * OREB% * (FGA - FGM) + TOV, with OREB% taken from the two sides'
    rebounds inside this stint. Over a handful of possessions that rate is noisy, which is exactly
    why the lineups table sorts by possessions rather than trusting any one stint's rating."""
    rebs = oreb + opp_dreb
    rate = oreb / rebs if rebs > 0 else 0.0
    return max(fga + 0.44 * fta - 1.07 * rate * max(fga - fgm, 0) + tov, 0.0)


def _elapsed(ev: dict) -> float:
    """Seconds of basketball played when this event happened, counting from tip.

    gt is time REMAINING in the period (FIBA's convention) so this is the sum of the periods
    already finished plus what has run off this one; PLEN knows a quarter is 10 minutes and an
    overtime 5. Periods, not quarters, because period_of has already folded OVERTIME into 5+."""
    p = period_of(ev)
    before = sum(PLEN(i) for i in range(1, p))
    return (before + PLEN(p) - clock_ms(ev.get("gt"))) / 1000.0


def _period_from_elapsed(t: float) -> int:
    """The period a timestamp falls in. Derived from the clock, never from the event's own
    `period`: a substitution flushed at a period boundary is stamped by whichever event triggered
    the flush, which is how a Q1 stint used to come out labelled Q2."""
    if t < 2400:
        return int(t // 600) + 1
    return 5 + int((t - 2400) // 300)


def ordered(raw: dict) -> list:
    """The play-by-play oldest first, whatever order the feed handed it over in.

    data.json is NEWEST first — the widget renders it as a reverse-chronological ticker — while a
    translated league (fibashape.game) builds its list forwards. actionNumber settles it when the
    feed has one; otherwise a stream whose first event sits later in the game than its last is
    reversed. Getting this wrong does not fail loudly: it produces a full set of stints in which
    every substitution is backwards."""
    pbp = [e for e in (raw.get("pbp") or []) if isinstance(e, dict)]
    if pbp and all(e.get("actionNumber") is not None for e in pbp):
        return sorted(pbp, key=lambda e: int(e["actionNumber"]))
    if len(pbp) > 1 and _elapsed(pbp[0]) > _elapsed(pbp[-1]):
        return list(reversed(pbp))
    return pbp


def starting_five(raw: dict, events: list, side: int) -> list:
    """The five on court at tip for one side (0 home / 1 away), as pno strings.

    THE FLAG FIRST, because a feed that states its starters is telling the truth more often than
    any inference. Where it does not name exactly five we read the game: a player who does
    anything before his side's first substitution was on court, and so was a player substituted
    OUT who had not been substituted IN — an OUT is itself evidence. Minutes played break any
    remaining tie, so a short-handed inference still fills with the people who actually played."""
    pl = ((raw.get("tm") or {}).get(str(side + 1)) or {}).get("pl") or {}
    flagged = [str(k) for k, p in pl.items() if str(p.get("starter", "0")) in ("1", "True", "true")]
    if len(flagged) == 5:
        return flagged

    five: list = []
    came_on: set = set()
    for ev in events:
        if team_idx(ev) != side:
            continue
        pno = ev.get("pno")
        if pno in (None, "", 0, "0"):
            continue
        pno, at = str(pno), str(ev.get("actionType") or "").lower()
        sub = str(ev.get("subType") or "").lower()
        if at == "substitution":
            if sub == "in":
                came_on.add(pno)            # arrived later: not a starter, and not evidence
            elif pno not in came_on and pno not in five:
                five.append(pno)            # went off without having come on -> he started
        elif pno not in came_on and pno not in five:
            five.append(pno)
        if len(five) >= 5:
            return five[:5]

    for pno in flagged:                      # the flag as a filler once the game has run out
        if pno not in five and len(five) < 5:
            five.append(pno)
    rest = sorted((k for k in pl if str(k) not in five),
                  key=lambda k: clock_ms(pl[k].get("sMinutes") or "0:00"), reverse=True)
    while len(five) < 5 and rest:
        five.append(str(rest.pop(0)))
    return five[:5]


class _Stint:
    """One unbroken spell of ten specific players, and everything that happened during it."""

    __slots__ = ("row", "start")

    def __init__(self, game_id, game_date, teams, on_court, start):
        self.start = start
        self.row = {k: 0 for k in FIELDNAMES}
        self.row.update(game_id=game_id, game_date=game_date,
                        home_team=teams[0], away_team=teams[1],
                        home_lineup=sorted(on_court[0]), away_lineup=sorted(on_court[1]),
                        start_time=start, period=_period_from_elapsed(start))

    def add(self, side: int, stat: str, value=1) -> None:
        key = ("home_" if side == 0 else "away_") + stat
        if key in self.row:
            self.row[key] += value


class Builder:
    """Replays one game's play-by-play and hands back its stints.

    Deliberately a class and not a generator: the substitution buffer, the held-IN queue and the
    running score are all state that a caller would otherwise have to hold for it."""

    def __init__(self, raw: dict, game_id: str = "", game_date: str = "",
                 teams: tuple = ("home", "away"), name_of: Optional[Callable[[int, str], str]] = None):
        self.raw, self.game_id, self.game_date, self.teams = raw, str(game_id), game_date, teams
        self.name_of = name_of or (lambda side, pno: str(pno))
        self.events = ordered(raw)
        self.shots = {}                      # actionNumber -> shot marker, for the rim split
        for k in ("1", "2"):
            for s in ((raw.get("tm") or {}).get(k) or {}).get("shot", []) or []:
                if s.get("actionNumber") is not None:
                    self.shots[int(s["actionNumber"])] = s
        self.on_court = [set(starting_five(raw, self.events, 0)), set(starting_five(raw, self.events, 1))]
        self.held = [[], []]                 # INs waiting for a slot on court, oldest first
        self.pending: list = []              # substitutions at one clock time, applied as one change
        self.pending_at: Optional[float] = None
        self.clock = 0.0
        self.score = [0, 0]
        self.stints: list = []
        self.carry: Optional[dict] = None    # a sub-second stint with nothing behind it yet
        self.warnings: list = []
        self.current: _Stint
        self._start(0.0)                     # the opening five is a lineup like any other: checked

    # ---------------------------------------------------------------- substitutions ---
    def _flush(self) -> None:
        """Apply every buffered substitution as ONE lineup change, then open the next stint.

        Buffering is the whole point: a double substitution arrives as four events at one clock
        time, and applying them one at a time invents three lineups that never played — two of
        them wrong, all three zero seconds long."""
        if not self.pending:
            return
        at = self.pending[0]["at"]
        self._end(at)
        for side in (0, 1):
            outs = [s["pno"] for s in self.pending if s["side"] == side and not s["in"]]
            ins = [s["pno"] for s in self.pending if s["side"] == side and s["in"]]
            for pno in outs:
                if pno in self.held[side]:
                    self.held[side].remove(pno)  # his own IN was still waiting: he never came on
                    continue
                self.on_court[side].discard(pno)
            for pno in ins:
                if pno in self.on_court[side]:
                    continue                      # a repeated IN for someone already on court
                if len(self.on_court[side]) >= 5:
                    self.held[side].append(pno)   # the OUT is late; hold rather than play six
                else:
                    self.on_court[side].add(pno)
            while self.held[side] and len(self.on_court[side]) < 5:
                self.on_court[side].add(self.held[side].pop(0))
        self.pending.clear()
        self.pending_at = None
        self._start(at)

    # -------------------------------------------------------------------- stint life ---
    def _start(self, at: float) -> None:
        for side in (0, 1):
            if len(self.on_court[side]) != 5:
                self.warnings.append(
                    f"{self.game_id}: {self.teams[side]} had {len(self.on_court[side])} on court "
                    f"at {at:.0f}s (expected 5)")
        self.current = _Stint(self.game_id, self.game_date, self.teams, self.on_court, at)

    def _end(self, at: float) -> None:
        r, st = self.current.row, self.current
        r["end_time"] = at
        r["duration"] = at - st.start
        r["period"] = _period_from_elapsed(st.start)
        if self.carry:                        # a micro-stint from before this one had a home
            for k in _ADDITIVE:
                r[k] += self.carry.get(k, 0)
            self.carry = None
        # A stint shorter than a second is the artifact of a substitution window bracketing a
        # scoring play (sub -> free throw -> sub, all at one clock time). Dropping it would delete
        # those points while leaving them in the running score — measured at ~1.7% of all points
        # in the scraper — so its counting stats are folded into the neighbouring stint instead.
        if r["duration"] < 1 and self.stints:
            prev = self.stints[-1]
            for k in _ADDITIVE:
                prev[k] += r[k]
            prev["end_time"] = r["end_time"]
            prev["duration"] = prev["end_time"] - prev["start_time"]
            prev["home_score_end"] += r["home_points"]
            prev["away_score_end"] += r["away_points"]
            self.score[0] += r["home_points"]
            self.score[1] += r["away_points"]
            self._recount(prev)
            return
        if r["duration"] < 1:
            # Nothing behind it to fold into (the game has only just started), so it rides
            # forwards into the next stint instead of being dropped as the scraper drops it. Its
            # points are NOT banked here — they are banked by the stint that ends up carrying them.
            self.carry = {k: r[k] for k in _ADDITIVE}
            return
        r["home_score"], r["away_score"] = self.score[0], self.score[1]
        self.score[0] += r["home_points"]
        self.score[1] += r["away_points"]
        r["home_score_end"], r["away_score_end"] = self.score[0], self.score[1]
        # Sorted by NAME, not by the pno order they happen to be keyed under: the lineup string is
        # the join key a season's worth of stints is grouped on, and two spellings of one five
        # would split it in half.
        r["home_lineup"] = ",".join(sorted(self.name_of(0, p) for p in r["home_lineup"]))
        r["away_lineup"] = ",".join(sorted(self.name_of(1, p) for p in r["away_lineup"]))
        self._recount(r)
        self.stints.append(r)

    @staticmethod
    def _recount(r: dict) -> None:
        h = _possessions(r["home_fga"], r["home_fgm"], r["home_fta"], r["home_oreb"], r["away_dreb"], r["home_tov"])
        a = _possessions(r["away_fga"], r["away_fgm"], r["away_fta"], r["away_oreb"], r["home_dreb"], r["away_tov"])
        r["home_possessions"], r["away_possessions"] = round(h, 2), round(a, 2)
        r["possessions"] = round((h + a) / 2.0, 2)

    # ------------------------------------------------------------------------- replay ---
    def run(self) -> "Builder":
        for ev in self.events:
            at = _elapsed(ev)
            # Never let the clock walk backwards. A feed that back-dates a correction would
            # otherwise hand a stint a negative duration, and the seconds would stop summing to
            # the game — the one number that says this replay is complete.
            at = self.clock = max(at, self.clock)
            side = team_idx(ev)
            action = str(ev.get("actionType") or "").lower()

            if action == "substitution":
                if side is None or ev.get("pno") in (None, "", 0, "0"):
                    continue
                if self.pending and self.pending_at != at:
                    self._flush()
                self.pending.append({"side": side, "pno": str(ev["pno"]),
                                     "in": str(ev.get("subType") or "").lower() == "in", "at": at})
                self.pending_at = at
                continue
            if self.pending:
                self._flush()
            if side is not None:
                self._apply(ev, side, action)
        self._flush()
        self._end(self.clock)
        return self

    def _apply(self, ev: dict, side: int, action: str) -> None:
        """One stat event onto the stint in progress. A port of fiba_api_parser._apply_event with
        everything that is not a stint — clutch buckets, assist combinations, per-player rows —
        left out; the box score already arrives from `tm` and does not need replaying."""
        st = self.current
        sub = str(ev.get("subType") or "").lower()
        made = str(ev.get("success", "0")) == "1"
        quals = {str(q).lower() for q in (ev.get("qualifier") or [])}

        if action == "freethrow":
            st.add(side, "fta")
            if made:
                st.add(side, "ftm")
                self._score(st, side, 1, quals)
        elif action in ("2pt", "3pt"):
            three = action == "3pt"
            st.add(side, "fga")
            if three:
                st.add(side, "fg3a")
            if made:
                st.add(side, "fgm")
                if three:
                    st.add(side, "fg3m")
                self._score(st, side, 3 if three else 2, quals)
            self._shot_type(st, ev, side, three, made)
        elif action == "rebound":
            # A team rebound belongs to no player and to no lineup's rebounding rate; the
            # qualifier says so, and on some feeds a missing pno is the only sign.
            if "team" in quals or ev.get("pno") in (None, "", 0, "0"):
                return
            if sub == "offensive":
                st.add(side, "oreb")
            elif sub == "defensive":
                st.add(side, "dreb")
        elif action == "turnover":
            if ev.get("pno") in (None, "", 0, "0"):
                return                        # team turnover: a possession, nobody's stat
            st.add(side, "tov")
            st.add(side, _tov_bucket(sub))
        elif action == "assist":
            st.add(side, "ast")
        elif action == "steal":
            st.add(side, "stl")
        elif action == "block":
            st.add(side, "blk")
        elif action == "foul" and not any(w in sub for w in ("technical", "bench", "coach")):
            # benchTechnical / coachTechnical / coachDisqualifying belong to nobody on the floor,
            # and FIBA spells them several ways, so this matches the word rather than the string.
            st.add(side, "pf")

    def _score(self, st: _Stint, side: int, points: int, quals: set) -> None:
        """Points, plus the three situational buckets the feed tags them with itself.

        FIBA classifies its own scoring plays (`fastbreak`, `2ndchance`, `fromturnover`), which is
        why the API path in the scraper overrides the parent's 8-second-window guesswork with
        exactly this. Where a league's translation carries no qualifiers the buckets stay 0 —
        better an honest zero than a heuristic that differs per league."""
        st.add(side, "points", points)
        if quals & {"2ndchance", "secondchance"}:
            st.add(side, "second_chance_pts", points)
        if quals & {"fastbreak", "transition"}:
            st.add(side, "fast_break_pts", points)
        if quals & {"fromturnover", "pointsofftov", "offturnover"}:
            st.add(side, "pts_off_tov", points)

    def _shot_type(self, st: _Stint, ev: dict, side: int, three: bool, made: bool) -> None:
        """The rim and off-the-dribble splits, location-bound where the chart has the shot.

        Coordinates beat labels: a "jumpshot" tipped in from under the basket is a rim attempt and
        a "driving" attempt that ends in a kick-out is not, which is why subType is only the
        fallback for a shot the chart never recorded."""
        sub = str(ev.get("subType") or "").lower()
        marker = self.shots.get(int(ev["actionNumber"])) if ev.get("actionNumber") is not None else None
        dist = _rim_dist_m(marker.get("x"), marker.get("y")) if marker else float("inf")
        if (dist <= _RIM_RADIUS_M) or (dist == float("inf") and sub in _RIM_SUBTYPES):
            st.add(side, "rim_att")
            if made:
                st.add(side, "rim_made")
        if sub in _OTD_SUBTYPES:
            kind = "otd_3pt_" if three else "otd_2pt_"
            st.add(side, kind + "att")
            if made:
                st.add(side, kind + "made")


def lineups_from_stints(rows: list) -> dict:
    """The per-five totals the feed tab's lineup table reads, summed from the stints.

    Keys are the ones docs/prototypes/epinoia-feed-tab/advanced.js already sums for itself when
    this is absent (lineup, poss, oposs, pts, ptsA, …) — computing them here means one lineup
    table instead of one per consumer, and it is the only place that knows a lineup's OPPONENT
    possessions, which is what makes a defensive rating possible."""
    out = {"home": {}, "away": {}}
    for r in rows:
        for side, opp in (("home", "away"), ("away", "home")):
            # The scraper branch hands its lineups back as a LIST when bcb_scraper's own CSV
            # streamer was not reachable (it is loaded under a private spec, so sys.modules has no
            # 'bcb_scraper' to fetch it from) and as a comma string when it was. Both spell the
            # same five; only one of them can key a dict.
            key = r.get(side + "_lineup") or ""
            key = ",".join(str(x) for x in key) if isinstance(key, (list, tuple)) else str(key)
            if not key:
                continue
            a = out[side].setdefault(key, {"lineup": key, "poss": 0.0, "oposs": 0.0, "pts": 0, "ptsA": 0,
                                           "fga": 0, "fgm": 0, "fg3m": 0, "tov": 0, "fta": 0,
                                           "oreb": 0, "odreb": 0, "dur": 0.0})
            a["poss"] += r.get(side + "_possessions", 0)
            a["oposs"] += r.get(opp + "_possessions", 0)
            a["pts"] += r.get(side + "_points", 0)
            a["ptsA"] += r.get(opp + "_points", 0)
            a["dur"] += r.get("duration", 0)
            for k in ("fga", "fgm", "fg3m", "tov", "fta", "oreb"):
                a[k] += r.get(f"{side}_{k}", 0)
            a["odreb"] += r.get(opp + "_dreb", 0)
    for side in out:
        for a in out[side].values():
            a["poss"], a["oposs"] = round(a["poss"], 2), round(a["oposs"], 2)
    return {side: sorted(out[side].values(), key=lambda a: -a["poss"]) for side in out}


def build(raw: dict, team_rows: dict, names: Optional[dict] = None,
          game_id: str = "", game_date: str = "", warnings: Optional[list] = None) -> tuple:
    """(stints_rows, lineups) for one game.

    `names` is {"home": {pno: full name}, "away": {…}} — the adapter's own box rows, already put
    through names.py, so a lineup is spelled the same here as in the box score beside it. Without
    it the lineups come back as pno, which is still joinable but is not a name.

    `warnings` collects the lineups that were not five a side. A caller that passes a list gets
    them to print; the rows are returned either way, because a game with one bad lineup is still
    worth 40 good ones."""
    teams = (team_rows.get("home", {}).get("team", "") or "home",
             team_rows.get("away", {}).get("team", "") or "away")
    lookup = names or {}

    def name_of(side: int, pno: str) -> str:
        return (lookup.get("home" if side == 0 else "away") or {}).get(str(pno), str(pno))

    b = Builder(raw, game_id=game_id, game_date=game_date, teams=teams, name_of=name_of).run()
    if warnings is not None:
        warnings.extend(b.warnings)
    return b.stints, lineups_from_stints(b.stints)
