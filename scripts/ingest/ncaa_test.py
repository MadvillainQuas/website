"""NCAA D2/D3 (adapters/ncaa.py) and the platform's halves, end to end.

    python scripts/ingest/ncaa_test.py

1. A SYNTHETIC GAME IN HALVES, always: two 20-minute halves and an overtime, built as the scraper's parse
   hands one over (teams, box by shirt, starters, actions with seconds since tip). It goes through
   to_fiba -> FibaLiveStatsAdapter.bundle_from_raw (stints) -> translate -> the engine (node), and every
   clock-based number must come out in halves: periods 1, 2 and OT 3, a half's period_start at 20:00,
   2,700 seconds of stints, 225 player-minutes a side, the score the plays add up to.
2. THE SCRAPER'S CAPTURES, when the private scraper-pipeline checkout is there (SCRAPER_DIR, or
   ../scraper-pipeline): its 46 ncaa.com games through the same path. They are not copied into this public
   repository; without the checkout this part says it was skipped.
3. The pure pieces: period_clock, gt, action_of, the season, the scoreboard change test, the lanes.
"""
from __future__ import annotations

import glob
import io
import json
import os
import subprocess
import sys
import contextlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from adapters import REGISTRY  # noqa: E402
from adapters import ncaa as N  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate, fmt_of, period_of, PLEN, HALVES, QUARTERS  # noqa: E402
import stints as ST  # noqa: E402
import stuck  # noqa: E402

REPO = HERE.parents[1]
passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}" + (f"  -- {extra}" if extra != "" else ""))


# ------------------------------------------------------------------ the pure pieces
print("\nthe periods")
ok("halves: 20:00 into the game is the start of the second half", N.period_clock(1200, N.HALVES) == (2, "REGULAR", 1200000))
ok("halves: 19:59.5 is the first half with half a second left", N.period_clock(1199.5, N.HALVES) == (1, "REGULAR", 500))
ok("halves: 40:00 is overtime 1 with 5:00 left (FIBA numbers overtimes from 1)", N.period_clock(2400, N.HALVES) == (1, "OVERTIME", 300000))
ok("halves: the second overtime starts at 45:00", N.period_clock(2700, N.HALVES)[:2] == (2, "OVERTIME"))
ok("quarters (NCAA women): 10:00 into the game is the second quarter", N.period_clock(600, N.QUARTERS) == (2, "REGULAR", 600000))
ok("the translator puts an overtime after regulation: 3 after halves, 5 after quarters",
   period_of({"period": 1, "periodType": "OVERTIME"}, HALVES) == 3 and period_of({"period": 1, "periodType": "OVERTIME"}) == 5)
ok("a half is 20 minutes and its overtime 5", PLEN(2, HALVES) == 1200000 and PLEN(3, HALVES) == 300000 and PLEN(4) == 600000)
ok("gt writes data.json's clock", N.gt(1200000) == "20:00" and N.gt(65000) == "01:05" and N.gt(500) == "00:00.5")
ok("a payload that says nothing is quarters, as every feed before NCAA", fmt_of({"pbp": [{"period": 1, "gt": "09:59"}]}) == QUARTERS)
ok("...one whose first period shows a clock above 10:00 is halves", fmt_of({"pbp": [{"period": 1, "gt": "19:59"}]}) == HALVES)
ok("...and its own `format` wins over the clock", fmt_of({"format": {"periods": 2, "period_ms": 1200000, "ot_ms": 300000}, "pbp": []}) == HALVES)

print("\nthe scraper's actions")
ok("a made layup", N.action_of("2pt layup made by #7 Kye Robinson") == {"pno": 7, "actionType": "2pt", "subType": "layup", "success": 1})
ok("a missed three", N.action_of("3pt jump shot missed by #23 A B")["success"] == 0)
ok("free throw 2 of 2", N.action_of("Free Throw 2 of 2 made by #0 X Y") == {"pno": 0, "actionType": "freethrow", "subType": "2of2", "success": 1})
ok("rebounds, assists, fouls, subs", [N.action_of(t)["actionType"] for t in (
    "Offensive Rebound by #4 Q", "Assist by #4 Q", "Personal Foul by #4 Q", "Substitution Out by #4 Q")] == ["rebound", "assist", "foul", "substitution"])
ok("anything else is not an action", N.action_of("Timeout Mules") is None)

print("\nthe season and the source")
from datetime import date  # noqa: E402
ok("a season is named by its start year", N.season_year({"season": "2026-27"}) == 2026)
ok("in February the season being played started the autumn before", N.season_year({}, date(2027, 2, 14)) == 2026)
ok("in November it started this autumn", N.season_year({}, date(2026, 11, 20)) == 2026)
ok("men's division 3 from the scoreboard URL", N.sport_of("https://www.ncaa.com/scoreboard/basketball-men/d3", {}) == "MBB"
   and N.division_of("https://www.ncaa.com/scoreboard/basketball-men/d3", {}) == 3)
ok("women's division 2 from the config", N.sport_of("", {"sport": "wbb"}) == "WBB" and N.division_of("", {"division": "2"}) == 2)
ok("NCAA is a registered adapter that reads LiveStats' shape (so the live lane covers it)",
   REGISTRY.get("ncaa") is N.NcaaAdapter and issubclass(N.NcaaAdapter, FibaLiveStatsAdapter))
contest = {"contestId": 6511421, "gameState": "I", "startTimeEpoch": 1771088400, "hasStartTime": True, "currentPeriod": "2nd",
           "teams": [{"isHome": True, "seoname": "mt-st-vincent", "nameShort": "UMSV", "name6Char": "MT STV", "score": 40, "conferenceSeo": "skyline"},
                     {"isHome": False, "seoname": "mt-st-mary-ny", "nameShort": "Mt. St. Mary (NY)", "name6Char": "MSM NY", "score": 38, "conferenceSeo": "skyline"}]}
g = N.NcaaAdapter._game(contest)
ok("a scoreboard line is a fixture: ids, names, UTC tip-off, live, conference, crest",
   g.external_id == "6511421" and g.home_name == "UMSV" and g.tipoff_at == "2026-02-14T17:00:00Z" and g.status == "live"
   and g.extra["home_group"] == "Skyline" and g.extra["home_logo"].endswith("/mt-st-vincent.svg"), g)
ok("conference slugs read as names", [N.conference_name(x) for x in ("nescac", "great-lakes-valley", "ne-10", "uaa", "", "odac")]
   == ["NESCAC", "Great Lakes Valley", "Northeast-10", "UAA", None, "ODAC"])

print("\nthe scoreboard decides who is read again")
A = N.NcaaAdapter()
A.max_age_s = 90
k = ("MBB", 3, "02/14/2026")
A._boards[k] = (1e18, {"6511421": contest})              # a board read "now" (never stale in this test)
A._line_of["6511421"] = k
A._held["6511421"] = (N.NcaaAdapter._line_key(contest), 1e18, "held")
ok("nothing moved: the held bundle is kept (no request)", A.changed("6511421", "MBB", 3, date(2026, 2, 14)) is False)
moved = json.loads(json.dumps(contest)); moved["teams"][0]["score"] = 42
A._boards[k] = (1e18, {"6511421": moved})
ok("a score moved: read it again", A.changed("6511421", "MBB", 3, date(2026, 2, 14)) is True)
A._boards[k] = (1e18, {"6511421": contest})
A._held["6511421"] = (N.NcaaAdapter._line_key(contest), 0, "held")
ok("nothing moved but it is older than max_age_s: read it again", A.changed("6511421", "MBB", 3, date(2026, 2, 14)) is True)
ok("a game never read in full is read", A.changed("999", "MBB", 3, date(2026, 2, 14)) is True)

# ------------------------------------------------------------------ a synthetic game in halves
print("\na synthetic game in two halves and an overtime")


def box(names):
    return {str(n): {"name": nm, "pts": 0, "fg2m": 0, "fg2a": 0, "fg3m": 0, "fg3a": 0, "ftm": 0, "fta": 0, "oreb": 0,
                     "dreb": 0, "reb": 0, "ast": 0, "stl": 0, "blk": 0, "tov": 0, "pf": 0, "secs": 0, "starter": i < 5}
            for i, (n, nm) in enumerate(names)}


home = box([(0, "Zero Home"), (1, "One Home"), (2, "Two Home"), (3, "Three Home"), (4, "Four Home"), (5, "Five Home"), (21, "Sub Home")])
away = box([(10, "Ten Away"), (11, "Eleven Away"), (12, "Twelve Away"), (13, "Thirteen Away"), (14, "Fourteen Away"), (15, "Fifteen Away")])
acts = []
# first half: home 2+3, away 2; a change for home at 5:00 gone (IN logged before its OUT, 12 s apart)
acts += [("2pt layup made by #0 Zero Home", 0, 30), ("Assist by #1 One Home", 0, 30),
         ("3pt jump shot made by #2 Two Home", 0, 200), ("2pt jump shot made by #10 Ten Away", 1, 260),
         ("Substitution In by #5 Five Home", 0, 300), ("Substitution Out by #4 Four Home", 0, 312),
         ("Defensive Rebound by #11 Eleven Away", 1, 500), ("Personal Foul by #3 Three Home", 0, 1100)]
# second half: away 3+3+2; #21 comes on for #0 and goes 1 of 2 from the line
acts += [("3pt jump shot made by #12 Twelve Away", 1, 1300), ("3pt jump shot made by #12 Twelve Away", 1, 1500),
         ("Substitution Out by #0 Zero Home", 0, 1600), ("Substitution In by #21 Sub Home", 0, 1600),
         ("Free Throw 1 of 2 made by #21 Sub Home", 0, 1700), ("Free Throw 2 of 2 missed by #21 Sub Home", 0, 1700),
         ("Offensive Rebound by #3 Three Home", 0, 1701), ("2pt layup made by #13 Thirteen Away", 1, 2000),
         ("2pt layup made by #1 One Home", 0, 2390)]
# home 2+3+1+2 = 8, away 2+3+3+2 = 10: two free throws at the buzzer level it, and overtime follows
acts += [("Free Throw 1 of 1 made by #1 One Home", 0, 2399), ("Free Throw 1 of 1 made by #1 One Home", 0, 2399.5)]
# overtime: home 3
acts += [("3pt jump shot made by #2 Two Home", 0, 2550)]
home["0"].update(pts=2, fg2m=1, fg2a=1); home["1"].update(pts=4, fg2m=1, fg2a=1, ftm=2, fta=2, ast=1)
home["2"].update(pts=6, fg3m=2, fg3a=2); home["21"].update(pts=1, ftm=1, fta=2); home["3"].update(oreb=1, reb=1, pf=1)
away["10"].update(pts=2, fg2m=1, fg2a=1); away["11"].update(dreb=1, reb=1); away["12"].update(pts=6, fg3m=2, fg3a=2)
away["13"].update(pts=2, fg2m=1, fg2a=1)
parsed = {"teams": [{"name": "Home U", "total_points": 13}, {"name": "Away St.", "total_points": 10}],
          "site_box": {0: home, 1: away}, "starters": {0: ["0", "1", "2", "3", "4"], 1: ["10", "11", "12", "13", "14"]},
          "actions": acts, "unmapped": {}, "partial_box": [], "degraded_feed": []}
data = {"pbp": {"data": {"playbyplay": {"status": "final", "contestId": "1", "teams": [
            {"teamId": "1", "isHome": True, "nameShort": "Home U", "name6Char": "HOMEU", "seoname": "home-u"},
            {"teamId": "2", "isHome": False, "nameShort": "Away St.", "name6Char": "AWAYST", "seoname": "away-st"}]}}},
        "box": {"data": {"boxscore": {"status": "F", "teamBoxscore": []}}}}
raw = N.to_fiba(data, parsed, N.HALVES)
ok("the payload says it is played in halves", raw["format"] == {"periods": 2, "period_ms": 1200000, "ot_ms": 300000})
ok("its overtime is FIBA's OVERTIME 1", any(a.get("periodType") == "OVERTIME" and a.get("period") == 1 for a in raw["pbp"]))
ok("#0 is a player (slot 1), not 'no player'", raw["tm"]["1"]["pl"]["1"]["shirtNumber"] == "0" and all(a.get("pno") != 0 for a in raw["pbp"] if "pno" in a))
subs = [(a["subType"], a["pno"], a["gt"]) for a in raw["pbp"] if a.get("actionType") == "substitution" and a["tno"] == 1]
ok("an IN logged before its OUT is played as one change, at the OUT's moment",
   ("out", 5, "14:48") in subs and ("in", 6, "14:48") in subs, subs)
ok("the plays add up to the official score", N.log_disagrees(raw) is None, N.log_disagrees(raw))
with contextlib.redirect_stdout(io.StringIO()):
    b = N.NcaaAdapter().bundle_from_raw(raw, "1", {})
ok("final, and replayed (translate not refused)", b.status == "final" and b.translate is None)
dur = sum(s.get("duration", 0) for s in b.stints)
ok("stints cover the whole game: 2 x 20:00 + 5:00 = 2,700 s", round(dur) == 2700, dur)
ok("stints are labelled in halves (a stint is filed under the period it starts in)",
   {s["period"] for s in b.stints} == {1, 2}, sorted({s["period"] for s in b.stints}))
ok("...where 41:00 is the overtime, period 3, and 25:00 the second half",
   ST._period_from_elapsed(2460, HALVES) == 3 and ST._period_from_elapsed(1500, HALVES) == 2 and ST._period_from_elapsed(1500) == 3)
T = translate(raw)
ok("the log's periods are 1, 2 and 3", sorted({e["period"] for e in T["events"]}) == [1, 2, 3])
ok("a half starts at 20:00, the overtime at 5:00",
   [e["clock"] for e in T["events"] if e["t"] == "period_start"] == [1200000, 1200000, 300000])
ok("the translation says its format", T["format"] == {"periods": 2, "period_ms": 1200000, "ot_ms": 300000})
ok("no unpaired substitution, nobody unmatched", not T["report"]["warnings"] and T["report"]["unmatched"] == 0, T["report"])
ok("its score is the official one", (T["home_score"], T["away_score"]) == (13, 10))

# the engine, on exactly these rows
node = subprocess.run(["node", "-e", r"""
const E = require(process.argv[1]);
const T = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const evs = T.events.map(r => Object.assign({ id: r.seq, t: r.t, team: r.team, pid: r.pid, period: r.period, clock: r.clock }, r.payload));
const g = { teams: T.roster_snapshot.teams, starters: T.starters, events: evs, period: T.period, clockMs: 0 };
const d = E.deriveGame(g), ta = [E.teamAdv(g, d, 0), E.teamAdv(g, d, 1)];
const mins = t => g.teams[t].players.reduce((a, p) => a + d.stats[p.id].min, 0) / 60000;
console.log(JSON.stringify({ fmt: d.format, score: d.score, mins: [mins(0), mins(1)], tm: ta.map(x => x.minutes),
  label: [E.perName(1, d.format), E.perName(2, d.format), E.perName(3, d.format)], fouls: d.team[0].foulsP }));
""", str(REPO / "epinoia" / "engine.js")], input=json.dumps(T), capture_output=True, text=True)
try:
    R = json.loads(node.stdout)
except Exception:
    R = {}
ok("the engine reads the log as halves", R.get("fmt", {}).get("periods") == 2, node.stderr[-400:])
ok("the engine's score is the official one", R.get("score") == [13, 10], R.get("score"))
ok("225 player-minutes a side (five on the floor for 45 minutes)", [round(x, 6) for x in R.get("mins", [])] == [225, 225], R.get("mins"))
ok("team minutes 225 (the per-40 rates divide by these)", [round(x) for x in R.get("tm", [])] == [225, 225], R.get("tm"))
ok("labels h1, h2, ot1", R.get("label") == ["h1", "h2", "ot1"], R.get("label"))
ok("team fouls are kept per half", R.get("fouls") == {"1": 1}, R.get("fouls"))

print("\na game whose plays do not add up is published as a result, not replayed")
short = json.loads(json.dumps(raw))
short["pbp"] = [a for a in short["pbp"] if not (a.get("actionType") == "3pt" and a.get("tno") == 2)]
why = N.log_disagrees(short)
ok("the gap is named", why and "13-4" in why and "13-10" in why, why)
with contextlib.redirect_stdout(io.StringIO()):
    b2 = N.NcaaAdapter().bundle_from_raw(short, "2", {})
ok("...and the bundle says not to translate it", b2.translate is False)
ok("the run_ingest gate honours it", "and b.translate is not False" in (HERE / "run_ingest.py").read_text())

print("\nthe stuck-game rule knows halves")
ok("a game in halves whose second half ended is final", stuck.verdict(2, 0, 70, 65, None, periods=2)[0] == "final")
ok("...and one stopped at half-time is not", stuck.verdict(1, 0, 40, 35, None, periods=2)[0] == "void")
ok("quarters as before: period 2 at 0:00 is void, period 4 final", stuck.verdict(2, 0, 70, 65, None)[0] == "void"
   and stuck.verdict(4, 0, 70, 65, None)[0] == "final")

print("\nlanes and shards (run_ingest --lane / --shard)")
import run_ingest as RI  # noqa: E402
srcs = [{"code": "SLB", "adapter": "fiba_livestats"}, {"code": "NCAA_D3M", "adapter": "ncaa", "live_lane": "ncaa"},
        {"code": "NCAA_D2W", "adapter": "ncaa", "adapter_config": {"live_lane": "NCAA"}}]
ok("the default lane takes every source that names no lane, as before", [s["code"] for s in RI.lane_sources(srcs, None)] == ["SLB"])
ok("the ncaa lane takes the NCAA rows (top level or adapter_config, any case)",
   [s["code"] for s in RI.lane_sources(srcs, "ncaa")] == ["NCAA_D3M", "NCAA_D2W"])
ok("no shard, or 1/1, is every game", RI.parse_shard(None) is None and RI.parse_shard("1/1") is None)
ok("'2/4' is the second of four", RI.parse_shard("2/4") == (1, 4))
try:
    RI.parse_shard("5/4"); bad = False
except ValueError:
    bad = True
ok("'5/4' is refused", bad)
ids = [str(6500000 + i) for i in range(2000)]
parts = [[x for x in ids if RI.in_shard(x, (k, 4))] for k in range(4)]
ok("four shards split the games between them, each game exactly once",
   sum(len(p) for p in parts) == len(ids) and len(set().union(*map(set, parts))) == len(ids))
ok("...about evenly (each 20-30%)", all(0.2 * len(ids) < len(p) < 0.3 * len(ids) for p in parts), [len(p) for p in parts])
ok("a game's shard does not change from run to run (crc32, not Python's salted hash)", RI.in_shard("6511421", (0x6511421 % 1 or 0, 1)) and
   RI.in_shard("6511421", (__import__("zlib").crc32(b"6511421") % 4, 4)))

print("\nthe season roll-up for a big league (adapter_config.season_refresh_s)")
pf = {"refresh": {}}
ok("no setting: the rule as it was - a first write is due", RI.roll_up_due(pf, "c", "live", 0, 100.0))
pf["refresh"]["c"] = 100.0
ok("...a final is always due", RI.roll_up_due(pf, "c", "final", 0, 101.0))
ok("...a live write only after REFRESH_EVERY_S", not RI.roll_up_due(pf, "c", "live", 0, 101.0)
   and RI.roll_up_due(pf, "c", "live", 0, 100.0 + RI.REFRESH_EVERY_S))
ok("with a gap a final waits, and the competition is owed one", not RI.roll_up_due(pf, "c", "final", 600, 101.0) and pf["owed"] == {"c"})
ok("...paid once the gap has passed", RI.roll_up_due(pf, "c", "live", 600, 701.0))


class _Rpc:
    def __init__(self):
        self.calls = []

    def rpc(self, fn, body):
        self.calls.append((fn, body))


fk = _Rpc()
ok("...and by the pass's end at the latest", RI.flush_refresh(fk, {"X": {"_pf": pf}}) == 1
   and fk.calls == [("refresh_feed_team_season", {"p_competition": "c"})] and not pf["owed"])

print("\na league created for NCAA men says it plays halves (source row league_rules)")
from feedplatform import Platform  # noqa: E402


pl = Platform(None, dry=True)
made = {}
pl.one = lambda table, q: None
pl.insert = lambda table, row: made.setdefault("row", dict(row, id="L1"))
pl.league("NCAA_D3M", "NCAA Division III Men", "ncaa-d3-men", "US", "men", {"periods": 2, "period_ms": 1200000})
ok("its rules are the database's defaults with halves laid over them",
   made["row"]["rules"]["periods"] == 2 and made["row"]["rules"]["period_ms"] == 1200000 and made["row"]["rules"]["ot_ms"] == 300000
   and made["row"]["rules"]["win_points"] == 2, made.get("row"))
made.clear()
pl.league("SLB", "Super League", "slb")
ok("a league created without league_rules gets the database's own default (no rules column written)", "rules" not in made["row"])

# ------------------------------------------------------------------ the scraper's own captures
cands = [os.environ.get("SCRAPER_DIR") or "", str(REPO.parent / "scraper-pipeline")]
cap_dir = next((Path(c) / "validation" / "ncaa" / "captures" for c in cands
                if c and (Path(c) / "validation" / "ncaa" / "captures").is_dir()), None)
print("\nthe scraper's captures")
if cap_dir is None:
    print("  (skipped: the private scraper-pipeline checkout is not here - set SCRAPER_DIR)")
else:
    os.environ.setdefault("SCRAPER_DIR", str(cap_dir.parents[2]))
    N.NcaaAdapter._mod = None
    A = N.NcaaAdapter()
    mod = A._scraper({"scraper_dir": str(cap_dir.parents[2])})
    games = sorted(glob.glob(str(cap_dir / "*.json")))
    n = full = replayed = refused = halves_ok = 0
    sub_warn = 0
    for f in games:
        d = json.load(open(f, encoding="utf-8"))
        p = mod.parse_ncaa_game(d)
        if not p.get("actions"):
            continue
        r = N.to_fiba(d, p, N.HALVES)
        with contextlib.redirect_stdout(io.StringIO()):
            bb = A.bundle_from_raw(r, Path(f).stem, {})
        tt = translate(r)
        n += 1
        per = max(e["period"] for e in tt["events"])
        want = 2400 + max(0, per - 2) * 300
        halves_ok += round(sum(s.get("duration", 0) for s in bb.stints)) == want
        sub_warn += sum(1 for w in tt["report"]["warnings"] if w.startswith("unpaired"))
        if bb.translate is False:
            refused += 1
        else:
            replayed += 1
    ok(f"{n} captured games: stints cover every game exactly (2,400 s, +300 per overtime)", halves_ok == n, f"{halves_ok}/{n}")
    ok("no substitution left unpaired", sub_warn == 0, sub_warn)
    print(f"     {replayed} replayed, {refused} published as a result only (their plays do not add up to the score)")
    ok("the gate refuses some and replays the rest", replayed > 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
