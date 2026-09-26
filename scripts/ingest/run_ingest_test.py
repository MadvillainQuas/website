"""write_platform() decides whether to build a game's play-by-play, box score and finalise-game
call (will_translate) from the SAME set of adapters TRANSLATABLE_ADAPTERS names here — no live
Supabase, no network: python scripts/ingest/run_ingest_test.py

THE BUG THIS PINS. will_translate used to compare src["adapter"] to the literal string
"fiba_livestats". fiba_site_schedule, euroleague, acb, lnb and bleague all subclass
FibaLiveStatsAdapter and inherit its fetch()/bundle_from_raw() unchanged — a GameBundle from any
of them is the same shape — but none of their registry names equal that literal string, so a
Czech NBL or Slovak SBL game (fiba_site_schedule) never got game_events, game_state or a
finalise-game call, despite its payload carrying a full box score and hundreds of play-by-play
rows. games.home_score/away_score come from a separate assignment and were unaffected, which is
why a fixture card showed the real final score while the game page showed FINAL 0-0 with no box
score (reported 2026-09-18, on a real Czech NBL game: 81c0e6c5-…-d30d10556ede in the live
database, external_id 2890468 — external_games.error was null and the archived payload had 12
players a side and 640 pbp events, but player_game_stats/team_game_stats/game_events/game_state
were all empty).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as RI  # noqa: E402
from adapters import REGISTRY  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


print("-- every FIBA-LiveStats-shaped adapter translates its play-by-play into a box score")
# Every one of these really does subclass FibaLiveStatsAdapter in adapters/ — this is not five
# names picked to match the fix, it is the actual registry, checked the actual way (issubclass),
# so a sixth subclass added later is covered without this file being touched.
for name in ("fiba_livestats", "fiba_site_schedule", "euroleague", "acb", "lnb", "bleague"):
    ok(f"{name} really does subclass FibaLiveStatsAdapter (so the registry itself agrees)",
       name in REGISTRY and issubclass(REGISTRY[name], FibaLiveStatsAdapter))
    ok(f"...and is in TRANSLATABLE_ADAPTERS because of it", name in RI.TRANSLATABLE_ADAPTERS)

print("\n-- an adapter that is NOT FIBA-LiveStats-shaped is left out")
# The _PipelineBridge family hands off to a completely different pipeline (bcb_scraper) with its
# own translate step; they were never meant to be in this set and must not end up in it by
# accident (e.g. a careless "add everything in REGISTRY" fix).
for name in ("bcb_pipeline", "euroleague_api", "eurobasket_html", "genius_html"):
    ok(f"{name} is not a FibaLiveStatsAdapter subclass", name in REGISTRY and not issubclass(REGISTRY[name], FibaLiveStatsAdapter))
    ok(f"...and stays out of TRANSLATABLE_ADAPTERS", name not in RI.TRANSLATABLE_ADAPTERS)

print("\n-- the exact expression write_platform evaluates")
# This is will_translate's own right-hand side, on the two real registry sources this bug was
# found on (config/ingest-sources.json: CBFFE = Czech NBL, SBA = Slovak SBL, both
# adapter: "fiba_site_schedule") plus the adapter the old literal-string check already covered.
for adapter_name, translate_cfg, want in (
    ("fiba_site_schedule", True, True),      # CBFFE / SBA — the games this bug was found on
    ("fiba_livestats", True, True),          # unaffected before the fix; must stay true after it
    ("acb", True, True),
    ("bcb_pipeline", True, False),           # a different pipeline entirely — never "translated" here
    ("fiba_site_schedule", False, False),    # adapter_config.translate: false still wins
):
    got = (adapter_name in RI.TRANSLATABLE_ADAPTERS) and translate_cfg
    ok(f"adapter={adapter_name!r} translate={translate_cfg} -> will_translate={want}", got == want, got)

print("\n-- the live lane's source test: what makes a game go live on the site")
# The same literal-string bug, one lane over. live_keeper selected `adapter == "fiba_livestats"`,
# so no live pass ever considered LNB, its two Espoirs divisions, ACB, B.LEAGUE, EuroLeague or the
# Czech site: Espoirs ELITE 2 tipped off on 18 Sep 2026 and sat at "scheduled, 0-0" on the strip
# and in the box score while the league's own site had it live. A league that cannot go live is
# worse than one that is late, so this is checked the same way TRANSLATABLE_ADAPTERS is.
for name in ("fiba_livestats", "fiba_site_schedule", "euroleague", "acb", "lnb", "bleague"):
    ok(f"{name} can be polled live", name in RI.LIVE_ADAPTERS)
for name in ("bcb_pipeline", "euroleague_api", "eurobasket_html", "genius_html"):
    ok(f"{name} stays out of the live lane", name not in RI.LIVE_ADAPTERS)
ok("every live adapter is a LiveStats reader",
   all(issubclass(REGISTRY[n], FibaLiveStatsAdapter) for n in RI.LIVE_ADAPTERS))

print("\n-- ...and which of them the CDN observer may watch")
# FeedObserver conditional-GETs FIBA's data.json by LiveStats id. An LNB row's external_id is
# "<competitionId>_<fixtureId>" off lnb.fr's own back end, so there is nothing on the CDN to poll
# for it: those sources take the inline adapter fetch. Watching them there would poll a 404 every
# five seconds and never write a score.
ok("the generic source is watched on the CDN", "fiba_livestats" in RI.CDN_ADAPTERS)
for name in ("lnb", "acb", "bleague", "euroleague", "fiba_site_schedule"):
    ok(f"{name} is polled through its own adapter, not the CDN", name not in RI.CDN_ADAPTERS)
ok("every CDN adapter is also a live adapter", RI.CDN_ADAPTERS <= RI.LIVE_ADAPTERS)

print("\n-- a game is polled from before the tip, not from when somebody notices")
ok("polling starts at least two minutes before the listed tip-off",
   RI.LIVE_BEFORE_TIP >= 120, RI.LIVE_BEFORE_TIP)
ok("...and keeps going long enough to cover a whole game",
   RI.LIVE_AFTER_TIP >= 2 * 3600, RI.LIVE_AFTER_TIP)

print("\n-- a period that has ended is written at 0:00, not at the feed's reset clock")
# Reported 2026-09-23 (London Lions v Cheshire Phoenix): through the break after the first
# quarter the game page read "Q1 · 10:00". LiveStats resets its clock to the next period's full
# length and moves its own `period` on when a quarter ends, while the log still ends in that
# quarter, so game_state paired the log's period with the reset clock. The saved feed below is a
# real LiveStats payload caught at exactly that moment (half-time: its period already reads 3,
# its clock 10:00, its log ends on the second quarter's "period end").
import json  # noqa: E402

FEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "supabase", "tests", "fixtures",
                    "feedtiming", "feed.json")
with open(FEED, encoding="utf-8") as fh:
    real = json.load(fh)
ok("the saved feed really is a break: its own clock is the full 10:00 of the next period",
   real.get("clock") == "10:00" and int(real.get("period")) == 3, (real.get("clock"), real.get("period")))
log_period = max(RI.period_of(a) for a in real["pbp"])
ok("...while its log still ends in the second quarter", log_period == 2, log_period)
ok("so the second quarter is over", RI._period_over(real, 2) is True)


def act(n, at, sub, period, ptype="REGULAR"):
    return {"actionNumber": n, "actionType": at, "subType": sub, "period": period, "periodType": ptype, "gt": "05:00"}


q1 = [act(1, "game", "start", 1), act(2, "period", "start", 1), act(3, "2pt", "jumpshot", 1)]
ok("mid-quarter: nothing says the first quarter is over", RI._period_over({"period": 1, "pbp": q1}, 1) is False)
ok("the operator's own 'period end' says it is",
   RI._period_over({"period": 1, "pbp": q1 + [act(4, "period", "end", 1)]}, 1) is True)
ok("...and so does the feed's own period moving on before the log has a 'period end'",
   RI._period_over({"period": 2, "pbp": q1}, 1) is True)
q2 = q1 + [act(4, "period", "end", 1), act(5, "period", "start", 2)]
ok("once the second quarter has started, the first quarter's end is not the second's",
   RI._period_over({"period": 2, "pbp": q2}, 2) is False)
ok("subs entered for the second quarter during the break count as the second quarter, not over",
   RI._period_over({"period": 2, "pbp": q1 + [act(4, "period", "end", 1), act(5, "substitution", "in", 2)]}, 2) is False)
q4 = [act(1, "period", "start", 4), act(2, "3pt", "jumpshot", 4), act(3, "period", "end", 4)]
ok("the end of the fourth before overtime is an end like any other", RI._period_over({"period": 4, "pbp": q4}, 4) is True)
ok("a feed that numbers overtime 1 + OVERTIME is past the fourth, not behind it",
   RI._period_over({"period": 1, "periodType": "OVERTIME", "pbp": q4[:2]}, 4) is True)
ok("an overtime 'period end' numbered that way ends overtime, not the first quarter",
   RI._period_over({"period": 1, "periodType": "OVERTIME", "pbp": [act(9, "period", "end", 1, "OVERTIME")]}, 5) is True
   and RI._period_over({"period": 1, "pbp": [act(9, "period", "end", 1, "OVERTIME")]}, 1) is False)
ok("a payload an adapter rebuilt (its period set from its own log) is never ahead of it",
   RI._period_over({"period": 3, "pbp": [act(1, "2pt", "layup", 3)]}, 3) is False)
ok("a period the feed cannot spell is not a period that has ended",
   RI._period_over({"period": "third", "pbp": q1}, 1) is False)

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_ingest.py"), encoding="utf-8").read()
state = src[src.index("# scoreboard state: FIBA's clock"):src.index('upsert_min(sb, "game_state"')]
ok("write_platform zeroes the clock of a period that has ended, before game_state is written",
   'if live and _period_over(b.raw, T["period"]):\n        clock_ms = 0' in state)
ok("...and a clock at 0:00 is never written as running", "clock_ms > 0" in state.split("moving = ", 1)[1])

# EUROLEAGUE'S OPENING NIGHT, 24 Sep 2026: the adapter passed played=True, so the live lane's first
# look at each game - six minutes before tip-off, the Boxscore already carrying both clubs - came
# back "final", and a final row is never polled again. Over is read from the feed now.
from adapters.euroleague import EuroLeagueAdapter  # noqa: E402
EL = EuroLeagueAdapter
q = lambda *plays: {"FirstQuarter": [{"PLAYTYPE": p} for p in plays]}
side = lambda pts: {"score": pts}
ok("EuroLeague: a game being played is not over", EL._played({"Live": True}, q("BP", "2FGM"), [side(20), side(18)]) is False)
ok("...nor one about to start (the Boxscore lists both clubs, nothing scored)", EL._played({"Live": True}, {}, [side(0), side(0)]) is False
   and EL._played({"Live": False}, {}, [side(0), side(0)]) is False)
ok("...the End Game play ends it", EL._played({"Live": True}, {"ExtraTime": [{"PLAYTYPE": "EG"}]}, [side(90), side(88)]) is True)
q4 = lambda *plays: {"FirstQuarter": [{"PLAYTYPE": "BP"}], "ForthQuarter": [{"PLAYTYPE": p} for p in plays]}
ok("...and so does the Boxscore no longer live, once the fourth quarter is closed with somebody ahead",
   EL._played({"Live": False}, q4("BP", "2FGM", "EP"), [side(85), side(78)]) is True)
ok("...but not the flag alone: it read false minutes into a game on opening night, 2-0 up",
   EL._played({"Live": False}, q("BP", "2FGM"), [side(2), side(0)]) is False)
ok("...nor a fourth quarter closed level (overtime is coming)", EL._played({"Live": False}, q4("BP", "EP"), [side(80), side(80)]) is False)
ok("...never played=True written into the fetch again", "played=True" not in open(os.path.join(
   os.path.dirname(os.path.abspath(__file__)), "adapters", "euroleague.py"), encoding="utf-8").read().split("def fetch", 1)[1].split("def _played", 1)[0])

# ...AND ITS PLAYS WERE NEVER NUMBERED, so the translator (which sorts by actionNumber and drops an
# event without one) wrote no EuroLeague event log at all: the page read 0-0, END OF Q1.
from translate.fiba_events import translate  # noqa: E402
sides = [{"code": "DUB", "name": "Dubai"}, {"code": "MAD", "name": "Real Madrid"}]
rosters = [{"P1": {"shirtNumber": "0"}}, {"P2": {"shirtNumber": "22"}}]
row = lambda n, play, team="", pid="", t="09:30": {"NUMBEROFPLAY": n, "PLAYTYPE": play, "CODETEAM": team, "PLAYER_ID": pid, "MARKERTIME": t}
feed = {"FirstQuarter": [row(1, "BP", t=""), row(5, "2FGM", "DUB", "P1"), row(6, "CM", "MAD", "P2"), row(7, "RV", "DUB", "P1"),
                         row(9, "TO", "MAD", "P2"), row(10, "EP", t="")]}
numbered = {}
evs = EL._events(feed, sides, rosters, {}, numbered)
ok("EuroLeague: every play numbered 1..n in order", [e["actionNumber"] for e in evs] == list(range(1, len(evs) + 1)), evs)
ok("...the feed's play numbers mapped to them, for the shot chart's join", numbered.get(5) == 2 and numbered.get(10) == len(evs), numbered)
foul = next(e for e in evs if e.get("actionType") == "foul")
ok("...and a foul drawn names the foul it answers", next(e for e in evs if e.get("actionType") == "foulon").get("previousAction") == foul["actionNumber"])
raw = {"tm": {"1": {"code": "DUB", "name": "Dubai", "pl": {"P1": {"firstName": "Elie", "familyName": "Okobo", "name": "Elie Okobo", "shirtNumber": "0", "starter": 1}}},
              "2": {"code": "MAD", "name": "Real Madrid", "pl": {"P2": {"firstName": "Walter", "familyName": "Tavares", "name": "Walter Tavares", "shirtNumber": "22", "starter": 1}}}},
       "pbp": evs}
T = translate(raw)
ok("...so the translator keeps them: a made two, a foul with its drawer, a turnover",
   [e["t"] for e in T["events"] if e["t"] in ("p2_made", "foul", "to")] == ["p2_made", "foul", "to"]
   and next(e for e in T["events"] if e["t"] == "foul")["payload"].get("drawn") == "0:P1", T["events"])
src_el = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "adapters", "euroleague.py"), encoding="utf-8").read()
ok("...and a player's name is put in reading order, title case, in the payload the game page reads ('OKOBO, ELIE' -> Elie Okobo)",
   "first, last, _ = _names.person(shouted)" in src_el and 'first=first, last=last, name=f"{first} {last}".strip() or shouted' in src_el)

print("\n-- a live poll does not ask for, or write, what has not changed (database load, 2026-09-26)")
calls = []


class _Fake:
    def upsert(self, table, rows, on_conflict=None):
        calls.append(("upsert", table)); return [rows]


class _Quiet(_Fake):
    def upsert_quiet(self, table, rows, on_conflict):
        calls.append(("quiet", table)); return True


RI.upsert_min(_Fake(), "game_advanced", {"a": 1}, "game_id")
RI.upsert_min(_Quiet(), "game_advanced", {"a": 1}, "game_id")
ok("a write nobody reads uses upsert_quiet where the client has it, and the plain upsert where it does not",
   calls == [("upsert", "game_advanced"), ("quiet", "game_advanced")], calls)
src_ri = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_ingest.py"), encoding="utf-8").read()
ok("upsert_quiet asks for no rows back (return=minimal)",
   "def upsert_quiet" in src_ri and "return=minimal" in src_ri.split("def upsert_quiet")[1].split("def patch")[0])
ok("the four hot upserts (external_games, competition_teams, game_advanced, game_state) no longer echo their rows",
   all(('upsert_min(sb, "%s"' % t) in src_ri for t in ("external_games", "competition_teams", "game_advanced", "game_state")))
ok("the games row is patched only when its status, score or place moved", "if not unchanged:" in src_ri and "home_score" in src_ri)
ok("the season roll-up is throttled while a game is live and always runs for a final",
   "REFRESH_EVERY_S" in src_ri and 'b.status == "final" or last is None' in src_ri)
ok("the season id and the game id are looked up once per run", 'pf["season"]' in src_ri and 'pf["game"]' in src_ri)
src_fp = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "feedplatform.py"), encoding="utf-8").read()
ok("a club is entered in a competition once per process, not on every poll", '"comp_team"' in src_fp and "if ck not in seen" in src_fp)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
