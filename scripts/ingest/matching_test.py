"""matching_test.py — two brothers are not one player.

Marcus and Malcolm Delpeche (Bristol Flyers, SLB Men) got silently merged into one canonical
`players` row on 2026-09-18: surname (0.58) + club (0.16) + "initial-only" (0.08, two full,
genuinely different first names that merely share a letter) landed exactly on the 0.82
auto-match threshold, with no shirt number yet in the feed to catch the mismatch. These tests
hold the fix in matching.py (and its JS mirror, epinoia/match.js, kept in step by hand) so a
future pair of same-surname, same-club teammates whose first names merely share an initial are
left as two candidates -- "weak", not "match" -- rather than silently becoming one player.

    python scripts/ingest/matching_test.py
"""
from matching import match_player

pass_n = fail_n = 0


def ok(name, cond, extra=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print(f"  PASS  {name}")
    else:
        fail_n += 1
        print(f"  FAIL  {name}" + (f"  -> {extra}" if extra else ""))


BRISTOL = "Bristol Flyers"

marcus = {"id": "marcus", "first_name": "Marcus", "last_name": "Delpeche", "team": BRISTOL, "aliases": []}

# --- the incident itself: no shirt number known yet (the state the feed was actually in) ---
res = match_player({"name": {"first": "Malcolm", "last": "Delpeche"}, "team": BRISTOL, "number": None}, [marcus])
ok("two brothers, same surname and club, no shirt number yet: never auto-matched",
   res["status"] != "match", res)
ok("...the reason names exactly what was distrusted",
   "initial-only-unconfirmed" in (res["best"]["reasons"] if res["best"] else []), res)

# --- a shirt number that actively DISAGREES is (and was already) even more clearly a reject ---
res = match_player({"name": {"first": "Malcolm", "last": "Delpeche"}, "team": BRISTOL, "number": "22"},
                    [{**marcus, "number": "21"}])
ok("a shirt number that disagrees is never overridden by a shared initial",
   res["status"] != "match", res)

# --- the safeguard is specific to "initial-only": a real nickname/variant spelling still wins ---
res = match_player({"name": {"first": "Alexsander", "last": "Petrov"}, "team": "Riga", "number": "9"},
                    [{"id": "p1", "first_name": "Aleksandr", "last_name": "Petrov", "team": "Riga",
                      "number": "9", "aliases": []}])
ok("a genuine variant spelling, confirmed by a shirt number, still auto-matches",
   res["status"] == "match", res)

# --- and an exact match is completely unaffected ---
res = match_player({"name": {"first": "Marcus", "last": "Delpeche"}, "team": BRISTOL, "number": "21"},
                    [{**marcus, "number": "21"}])
ok("an exact forename match is not touched by this rule at all", res["status"] == "match", res)

# --- initial-only WITH a matching shirt number is real, independent evidence and should still win ---
res = match_player({"name": {"first": "Malcolm", "last": "Delpeche"}, "team": BRISTOL, "number": "21"},
                    [{**marcus, "number": "21"}])
ok("initial-only backed by an actual matching shirt number is trusted",
   res["status"] == "match", res)

print(f"\n{pass_n} passed, {fail_n} failed")
raise SystemExit(1 if fail_n else 0)
