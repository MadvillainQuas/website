"""FIBA's own competitions (adapters/fiba_events.py + fiba_format.py), offline, over pages captured
on 2026-10-07 from www.championsleague.basketball and www.fiba.basketball:

    python scripts/ingest/fiba_events_test.py

What it holds them to:
  * the schedule: the whole season from one page (136 BCL fixtures, 96 with both clubs known), names
    as FIBA shows them (shortName: "Asisa Joventut", not "Club Joventut Badalona SAD"), tip-offs in
    UTC, every group-phase game naming its group, a stage source seeing only its own rounds;
  * a game, from the live-info JSON and again from the game page's flight data: the box exactly
    FIBA's, the quarters, stints covering the 40 minutes and summing to the score, five a side,
    the shot chart on the full-court frame (no two inside 6.1 m filed as threes), the play-by-play
    translated whole with every player's line equal to his box;
  * a game being played: live, with the scoreboard's clock and period;
  * the format, for both competitions: every stage in playing order with its kind, groups, game
    system and how many go through (read from the later stages' feeders); one source per stage with
    the main group phase under the league's own label; a final four's ties with the final fed by
    the semi-finals and the third-place game beside it, and every game on its tie and leg.

Fixtures: scripts/ingest/data/fiba_events/ (the pages' flight data, gzipped; *.json.gz as served).
"""
import collections
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import REGISTRY  # noqa: E402
from adapters import fiba_events as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter, shot_dist_to_nearest_rim  # noqa: E402
from translate.fiba_events import translate  # noqa: E402
import fiba_format as FF  # noqa: E402

DATA = os.path.join(HERE, "data", "fiba_events")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def text(name):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return f.read()


def page(name):
    """A captured page's flight data, wrapped back into the script push the site serves it in."""
    return "<script>self.__next_f.push([1," + json.dumps(text(name)) + "])</script>"


class Resp:
    def __init__(self, status, body="", location=None):
        self.status_code, self.text, self.headers = status, body, ({"location": location} if location else {})

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Offline(F.FibaEventsAdapter):
    """Every request answered from the captured pages; anything else is a 404."""
    ROUTES = {
        "https://www.championsleague.basketball/en/games": lambda: Resp(200, page("schedule-bcl.rsc.txt.gz")),
        "https://www.championsleague.basketball/en/standings": lambda: Resp(200, page("standings-bcl.rsc.txt.gz")),
        "https://www.fiba.basketball/en/events/fiba-europe-cup-26-27/games": lambda: Resp(200, page("schedule-fec.rsc.txt.gz")),
        "https://www.fiba.basketball/en/events/fiba-europe-cup-26-27/standings": lambda: Resp(200, page("standings-fec.rsc.txt.gz")),
        "https://www.championsleague.basketball/en/games/136283": lambda: Resp(
            308, "", "https://www.championsleague.basketball/en/games/136283-HOLO-CHO, "
                     "https://www.championsleague.basketball/en/games/136283-HOLO-CHO"),
        "https://www.championsleague.basketball/en/games/136283-HOLO-CHO": lambda: Resp(200, page("page-136283.rsc.txt.gz")),
    }

    def __init__(self, detail=None):
        super().__init__()
        self.asked = []
        self.detail = detail or {}
        self._slugs, self._pages, self._bases = {}, {}, {}
        self.min_request_gap_s = 0

    def _get(self, url, redirects=True):
        self.asked.append(url)
        if "/game-live-info/" in url:
            gid = url.split("/game-live-info/")[1].split("/")[0]
            name = self.detail.get(gid)
            return Resp(200, text(name) if name else '{"game":{}}')
        route = self.ROUTES.get(url.split("?")[0])
        return route() if route else Resp(404)


FibaLiveStatsAdapter._pipeline = False          # the in-repo stint builder, as on the Actions runner
FibaLiveStatsAdapter._pipeline_warned = True
BCL = "https://www.championsleague.basketball/en/games"
FEC = "https://www.fiba.basketball/en/events/fiba-europe-cup-{season}/games"

print("-- registration")
ok("fiba_events is registered, a FibaLiveStatsAdapter (so live and translated)",
   REGISTRY.get("fiba_events") is F.FibaEventsAdapter and issubclass(F.FibaEventsAdapter, FibaLiveStatsAdapter))
cfg = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = {s["code"]: s for s in cfg if s["adapter"] == "fiba_events"}
ok("the Champions League and the Europe Cup are configured, as European leagues of their own",
   set(rows) == {"BCL", "FEC"} and all(r["league_country"] == "EU" and r["create_league"] for r in rows.values())
   and {r["league_slug"] for r in rows.values()} == {"basketball-champions-league", "fiba-europe-cup"}, rows.keys())
ok("...each naming its game pages for fetch(), the Europe Cup's by season",
   all(r["adapter_config"].get("games_url") for r in rows.values()) and "{season}" in rows["FEC"]["scheduleUrls"][0])

print("\n-- the Champions League's season, from one page")
a = Offline()
games = list(a.discover(BCL, {}))
ok("96 fixtures with both clubs known (the 40 later-round placeholders wait)", len(games) == 96, len(games))
ok("one request", a.asked == [BCL], a.asked)
ok("every tip-off in UTC, every club coded",
   all(g.tipoff_at and g.tipoff_at.endswith("+00:00") and g.extra["home_code"] and g.extra["away_code"] for g in games))
hol = next(g for g in games if g.external_id == "136283")
ok("Hapoel Holon v Cholet: final, 15:45 UTC (18:45 in Samokov), group F, crest by organisation",
   (hol.status, hol.tipoff_at, hol.extra["group"], hol.extra["home_group"], hol.extra["venue"]) ==
   ("final", "2026-10-06T15:45:00+00:00", "F", "F", "Arena SamElyon") and "organisation_560" in hol.extra["home_logo"],
   (hol.status, hol.tipoff_at, hol.extra))
names = {n for g in games for n in (g.home_name, g.away_name)}
ok("clubs named as FIBA shows them, never the registered company",
   "Asisa Joventut" in names and not any(n.endswith(("SAD", "S.A.D.", "GmbH", "e.V.")) for n in names),
   sorted(n for n in names if n.endswith(("SAD", "GmbH")))[:4])
ok("32 clubs, 6 group games each", len(names) == 32 and set(collections.Counter(
    n for g in games for n in (g.home_name, g.away_name)).values()) == {6})
stage = list(Offline().discover(BCL, {"round_ids": [31111]}))
ok("a stage source sees its own rounds only (no play-in has its clubs yet)", stage == [], len(stage))

print("\n-- the Europe Cup: the season in the address")
e = Offline()
fec = list(e.discover(FEC, {"season": "2026-27"}))
ok("2026-27 is fiba-europe-cup-26-27", e.asked[0] == "https://www.fiba.basketball/en/events/fiba-europe-cup-26-27/games", e.asked)
ok("246 fixtures with clubs: the qualifiers and all 240 group games",
   len(fec) == 246 and sum(g.extra["round_name"] == "Regular Season" for g in fec) == 240, len(fec))


def check_game(b, what):
    raw = b.raw
    ok(what + ": final, 79-99, Hapoel Maoz Daniel Holon v Cholet Basket",
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"]) ==
       ("final", "Hapoel Maoz Daniel Holon", "Cholet Basket", 79, 99),
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"]))
    ok("...the quarters, 23-19 9-33 23-23 24-24",
       (b.team["home"]["q_scores"], b.team["away"]["q_scores"]) == ([23, 9, 23, 24], [19, 33, 23, 24]),
       (b.team["home"]["q_scores"], b.team["away"]["q_scores"]))
    med = next(p for p in raw["tm"]["1"]["pl"].values() if p["familyName"] == "Medford")
    ok("...Lester Medford #00: 15 points, 4/11, 6/7 FT, 23:20, +/- and efficiency kept",
       (med["shirtNumber"], med["sPoints"], med["sFieldGoalsMade"], med["sFieldGoalsAttempted"], med["sFreeThrowsMade"],
        med["sFreeThrowsAttempted"]) == ("00", 15, 4, 11, 6, 7) and med["sMinutes"].count(":") == 1,
       {k: med[k] for k in ("shirtNumber", "sPoints", "sFieldGoalsMade", "sFieldGoalsAttempted", "sMinutes")})
    ok("...five starters a side", [sum(p["starter"] for p in raw["tm"][t]["pl"].values()) for t in "12"] == [5, 5])
    ok("...team extras: paint 30-38, bench 32-42",
       (b.team["home"]["pts_paint"], b.team["away"]["pts_paint"], b.team["home"]["pts_bench"], b.team["away"]["pts_bench"]) == (30, 38, 32, 42))
    dur = sum(r["duration"] for r in b.stints)
    ok("...stints cover 2400 s and sum to the score, five a side",
       abs(dur - 2400) < 1 and (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (79, 99)
       and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints),
       (dur, len(b.stints)))
    shots = [s for t in "12" for s in raw["tm"][t]["shot"]]
    ok("...126 field goals on the chart, each joined to its play",
       len(shots) == 126 and all(s.get("actionNumber") for s in shots), len(shots))
    twos = [shot_dist_to_nearest_rim(s["x"], s["y"]) for s in shots if s["actionType"] == "2pt"]
    threes = [shot_dist_to_nearest_rim(s["x"], s["y"]) for s in shots if s["actionType"] == "3pt"]
    ok("...the half court mapped onto the full-court frame: every two inside the line, every three outside",
       max(twos) < 6.75 < min(threes), (round(max(twos), 2), round(min(threes), 2)))
    ok("...rim attempts 15 and 11 (layups and dunks at the basket)",
       (b.shots["home"]["rim"]["att"], b.shots["away"]["rim"]["att"]) == (15, 11), b.shots)
    subs = collections.Counter(e["subType"] for e in raw["pbp"] if e.get("actionType") == "substitution")
    kinds = collections.Counter(e.get("subType") for e in raw["pbp"] if e.get("actionType") in ("2pt", "3pt"))
    ok("...the play-by-play: 90 subs each way, shot kinds read off the text",
       subs == {"in": 90, "out": 90} and kinds["drivinglayup"] == 16 and kinds["pullupjumpshot"] == 16, (subs, kinds))
    ok("...numbered 1..n in play order, opened and closed",
       [e["actionNumber"] for e in raw["pbp"]] == list(range(1, len(raw["pbp"]) + 1))
       and raw["pbp"][0]["actionType"] == "period" and raw["pbp"][-1]["actionType"] == "game")
    tr = translate(raw)
    tally = collections.defaultdict(collections.Counter)
    for ev in tr["events"]:
        if ev["pid"]:
            s, t = tally[ev["pid"]], ev["t"]
            if t in ("p2_made", "p3_made", "ft_made"):
                s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
            if t in ("ast", "stl", "blk", "to"):
                s[t] += 1
            if t == "reb":
                s["oreb" if ev["payload"]["off"] else "dreb"] += 1
    diffs = [(p["name"], k, v, tally.get(f"{i}:{pno}", {}).get(k, 0)) for i, t in enumerate("12") for pno, p in raw["tm"][t]["pl"].items()
             for k, v in (("pts", p["sPoints"]), ("ast", p["sAssists"]), ("stl", p["sSteals"]), ("blk", p["sBlocks"]),
                          ("to", p["sTurnovers"]), ("oreb", p["sReboundsOffensive"]), ("dreb", p["sReboundsDefensive"]))
             if tally.get(f"{i}:{pno}", {}).get(k, 0) != v]
    ok("...the event log drops nothing and every player's line equals his box",
       not tr["report"]["dropped"] and not tr["report"]["unmatched"] and not diffs, (tr["report"]["dropped"], diffs[:5]))
    return raw


print("\n-- a finished game, from the live-info feed")
d = Offline({"136283": "detail-136283.json.gz"})
b1 = d.fetch("136283", {"games_url": BCL, "_tipoff_at": "2026-10-06T15:45:00+00:00"})
ok("one request: the live-info JSON", len(d.asked) == 1 and "/game-live-info/136283/detail" in d.asked[0], d.asked)
raw1 = check_game(b1, "detail")
ok("...the scoreboard: fourth quarter, 00:00", (raw1.get("period"), raw1.get("periodType"), raw1.get("clock")) == (4, "REGULAR", "00:00"))

print("\n-- the same game from its page, when the live cache has let it go")
p = Offline()                                   # the live-info feed answers {"game": {}}
b2 = p.fetch("136283", {"games_url": BCL})
ok("live-info, then /games/136283 (a 308 whose Location is doubled), then the page",
   [u.split("championsleague.basketball")[-1] for u in p.asked[1:]] == ["/en/games/136283", "/en/games/136283-HOLO-CHO"], p.asked)
raw2 = check_game(b2, "page")
ok("...the same box either way", all(raw1["tm"][t]["pl"][k]["sPoints"] == raw2["tm"][t]["pl"][k]["sPoints"]
                                     for t in "12" for k in raw1["tm"][t]["pl"]))

print("\n-- a game being played")
lv = Offline({"135845": "detail-135845-live.json.gz"})
b3 = lv.fetch("135845", {})
ok("LANDAU Lions v Lions de Geneve: live, 14-18, first quarter, 03:34 on the clock",
   (b3.status, b3.home_name, b3.team["home"]["points"], b3.team["away"]["points"], b3.raw.get("period"), b3.raw.get("clock"))
   == ("live", "LANDAU Lions", 14, 18, 1, "03:34"),
   (b3.status, b3.home_name, b3.team["home"]["points"], b3.raw.get("period"), b3.raw.get("clock")))

print("\n-- the format: the Champions League")
fb = Offline().competition_format_for(BCL, {})
st = [(s["name"], s["kind"]) for s in fb["stages"]]
ok("five stages in playing order",
   st == [("Regular Season", "groups"), ("Play-ins", "pairings"), ("Round of 16", "groups"),
          ("Quarter-Finals", "pairings"), ("Final Four", "bracket")], st)
rs = fb["stages"][0]
ok("eight groups of four, three going through (the play-ins name 2nd and 3rd; the winners go straight on)",
   [g["name"] for g in rs["groups"]] == list("ABCDEFGH") and all(g["slots"] == 4 for g in rs["groups"]) and rs["qualifiers"] == 3,
   (rs["qualifiers"], [g.get("qualify") for g in rs["groups"]]))
pi = fb["stages"][1]
ok("eight best-of-three play-ins, each fed by a group's 2nd and another's 3rd",
   len(pi["rounds"][0]["pairings"]) == 8 and pi["rounds"][0]["system"] == "BOF3"
   and all(str(x["from_a"]).endswith(tuple("ABCDEFGH")) for x in pi["rounds"][0]["pairings"]),
   pi["rounds"][0]["pairings"][0])
ok("best of three: 3 legs, first to two; home-and-away: 2 on aggregate; a single game",
   (FF.legs_of("BOF3"), FF.legs_of("HA"), FF.legs_of("S")) == ((3, "wins"), (2, "aggregate"), (1, "wins")))
f4 = fb["stages"][4]
plan = FF.tie_plan(f4)
ok("the final four: two semi-finals, the final and the third-place game beside it",
   [(t["round"], t["slot"], t["label"]) for t in plan] ==
   [(1, 0, "Semi-Finals"), (1, 1, "Semi-Finals"), (2, 0, "Final"), (2, 1, "3rd Place Game")],
   [(t["round"], t["slot"], t["label"]) for t in plan])
ok("...the final fed by both semi-finals (\"Winner of Game 157/158\" - pairings 37 and 38), the third-place game by neither",
   plan[2]["from"] == {"home": (1, 0), "away": (1, 1)} and plan[3]["from"] == {},
   [(t["code"], t["feeds"], t["from"]) for t in plan])

print("\n-- the format: the Europe Cup")
ff = Offline().competition_format_for(FEC, {"season": "2026-27"})
st = [(s["name"], s["kind"], s.get("qualifiers")) for s in ff["stages"]]
ok("qualifiers, eight groups (two go through), the second round's four groups (fed '1st of group A'...), the play-offs",
   [x[:2] for x in st] == [("Qualifiers", "pairings"), ("Regular Season", "groups"), ("Second Round", "groups"), ("Play-Offs", "bracket")]
   and st[1][2] == 2 and ff["stages"][2]["groups"][0]["from"][:2] == ["1st of group A", "1st of group H"], st)
po = FF.tie_plan(ff["stages"][3])
ok("play-offs: 4 + 2 + 1 two-legged ties on aggregate",
   collections.Counter(t["round"] for t in po) == {1: 4, 2: 2, 3: 1} and all((t["legs"], t["decider"]) == (2, "aggregate") for t in po),
   [(t["round"], t["legs"]) for t in po])
ok("...every semi-final and the final fed by two ties of the round before (\"Winner of Game 6\" is pairing 6)",
   all(len(t["from"]) == 2 and all(r == t["round"] - 1 for r, _ in t["from"].values()) for t in po if t["round"] > 1)
   and len({v for t in po if t["round"] == 2 for v in t["from"].values()}) == 4,
   [(t["round"], t["code"], t["feeds"], t["from"]) for t in po])
q = FF.tie_plan(ff["stages"][0])
ok("the qualifiers: three two-legged ties labelled 'Qualifiers', each with its two games in order",
   [(t["label"], len(t["game_ids"])) for t in q] == [("Qualifiers", 2)] * 3 and q[0]["game_ids"] == [135468, 135469],
   [(t["label"], t["game_ids"]) for t in q])

print("\n-- one source per stage")
src = {"code": "FEC", "label": "FIBA Europe Cup", "adapter": "fiba_events", "schedule_url": FEC,
       "adapter_config": {"season": "2026-27", "code": "FEC"}, "competition_id": "x"}
one = Offline()
out = FF.stage_sources([src], lambda name: one, log=lambda *_: None)
ok("the Europe Cup's two stages with fixtures: the qualifiers, and the groups under the league's own name",
   [(s["competition_label"], s["competition_kind"], s["adapter_config"]["competition_format"]) for s in out] ==
   [("Qualifiers", "playoff", "knockout"), ("FIBA Europe Cup", "league", "groups")],
   [(s["competition_label"], s["competition_kind"]) for s in out])
ok("...each its own rounds, its own schedule key, no inherited competition, groups from the feed for the groups",
   out[0]["adapter_config"]["round_ids"] == [31168] and out[1]["adapter_config"]["round_ids"] == [31174]
   and out[0]["schedule_url"] != out[1]["schedule_url"] and all(s["competition_id"] is None for s in out)
   and (out[0]["adapter_config"]["groups_from_feed"], out[1]["adapter_config"]["groups_from_feed"]) == (False, True))
ok("...the schedule and standings read once for both", len(one.asked) == 2, one.asked)
grp = list(one.discover(out[1]["schedule_url"], out[1]["adapter_config"]))
ok("...the group stage's source discovers its 240 games", len(grp) == 240, len(grp))
ok("a source that is already a stage, or another adapter's, passes through untouched",
   FF.stage_sources([out[0], {"adapter": "euroleague", "code": "EL"}], lambda n: one, log=lambda *_: None) ==
   [out[0], {"adapter": "euroleague", "code": "EL"}])


class FakeSB:
    """Enough of the REST client for write_ties: external_games, games, bracket_ties."""

    def __init__(self, ext, games):
        self.ext, self.games, self.ties, self.n = ext, games, {}, 0

    def select(self, table, q):
        if table == "external_games":
            ids = q.split("external_id=in.(")[1].split(")")[0].split(",")
            return [{"external_id": i, "game_id": self.ext[i]} for i in ids if i in self.ext]
        if table == "games":
            ids = q.split("id=in.(")[1].split(")")[0].split(",")
            return [dict(self.games[i]) for i in ids if i in self.games]
        if table == "bracket_ties":
            return [dict(t) for t in self.ties.values()]
        return []

    def upsert(self, table, row, on):
        key = (row["round"], row["slot"])
        cur = self.ties.get(key)
        if not cur:
            self.n += 1
            cur = {"id": f"tie{self.n}", "home_from_tie": None, "away_from_tie": None}
        cur.update(row)
        self.ties[key] = cur
        return [dict(cur)]

    def patch(self, table, q, body):
        rid = q.split("id=eq.")[1]
        if table == "bracket_ties":
            next(t for t in self.ties.values() if t["id"] == rid).update(body)
        else:
            self.games[rid].update(body)

    def delete(self, table, q):
        rid = q.split("id=eq.")[1]
        self.ties = {k: t for k, t in self.ties.items() if t["id"] != rid}


print("\n-- the qualifiers written as a bracket")
qst = ff["stages"][0]
ext = {"135468": "g1", "135469": "g2"}
gms = {"g1": {"id": "g1", "home_team_id": "SMB", "away_team_id": "BCPD", "tie_id": None, "leg": None},
       "g2": {"id": "g2", "home_team_id": "BCPD", "away_team_id": "SMB", "tie_id": None, "leg": None}}
sb = FakeSB(ext, gms)
run = {}
FF.write_ties(sb, {"adapter": "fiba_events"}, "comp", qst, run, log=lambda *_: None)
t1 = sb.ties[(1, 0)]
ok("three ties; the first between its first leg's clubs, two legs on aggregate",
   len(sb.ties) == 3 and (t1["home_team_id"], t1["away_team_id"], t1["legs"], t1["decider"]) == ("SMB", "BCPD", 2, "aggregate"), t1)
ok("...both games filed on it, legs 1 and 2, and the competition queued for advance_bracket",
   (gms["g1"]["tie_id"], gms["g1"]["leg"], gms["g2"]["tie_id"], gms["g2"]["leg"]) == (t1["id"], 1, t1["id"], 2)
   and "comp" in run.get("_recompute", set()))
n_before = sb.n
FF.write_ties(sb, {"adapter": "fiba_events"}, "comp", qst, {}, log=lambda *_: None)
ok("a second pass writes nothing new", sb.n == n_before and len(sb.ties) == 3)

print("\n-- the final four written as a bracket, before anybody is in it")
sb = FakeSB({}, {})
FF.write_ties(sb, {"adapter": "fiba_events"}, "f4", f4, {}, log=lambda *_: None)
fin = sb.ties[(2, 0)]
ok("four ties, sides unknown, the final pointing at both semi-finals",
   len(sb.ties) == 4 and fin["home_team_id"] is None
   and {fin["home_from_tie"], fin["away_from_tie"]} == {sb.ties[(1, 0)]["id"], sb.ties[(1, 1)]["id"]},
   {k: (t["id"], t.get("home_from_tie"), t.get("away_from_tie")) for k, t in sb.ties.items()})

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
