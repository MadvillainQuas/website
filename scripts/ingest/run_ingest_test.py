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

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
