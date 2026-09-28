"""A merged club keeps the feed codes of both (0187, mirroring 0183 for players), offline:

    python scripts/ingest/team_merge_test.py

platform_team_merge (0187) keeps the survivor's own code under external_ids.fiba_livestats and the merged-away row's under
external_ids.also. team_code() (feedplatform.py) is the only thing a feed's own code can be missing from -- a league whose
game payload carries no club code at all falls to slugifying the club's name, which the schedule and the live payload can
spell differently for one club (NBL Division One's "London Elite" / "London Elite Senior Men I": see names.py's club_core
and 0187's own docstring), each giving a different slug. So the ingest has to look for both the survivor's code AND
whatever the merged-away row's was, or the next fetch of the old spelling makes the duplicate all over again. What this
holds Platform.team() to:
  * the lookup asks for a club whose fiba_livestats code OR whose also list holds this fixture's code, quoted and encoded;
  * a club found through the also list is used exactly as one found by its own code;
  * if the server does not understand the combined filter, the plain one is asked, as before.
"""
import os
import sys
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import feedplatform  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


class SB:
    def __init__(self, teams, reject_combined=False):
        self.teams, self.asked, self.reject = teams, [], reject_combined

    def select(self, table, q):
        self.asked.append((table, q))
        if table != "teams":
            return []
        if q.startswith("league_id=eq.L1&or="):
            if self.reject:
                raise RuntimeError("400 bad filter")
            d = unquote(q)
            hits = [t for t in self.teams if ("eq.\"" + t["k"] + "\"") in d or any(("[\"" + a + "\"]") in d for a in t.get("also", []))]
            return [{"id": t["id"], "slug": t["slug"], "name": t["name"], "aliases": t.get("aliases", []), "logo_path": None} for t in hits]
        return [{"id": t["id"], "slug": t["slug"], "name": t["name"], "aliases": t.get("aliases", []), "logo_path": None}
                for t in self.teams if ("external_ids->>fiba_livestats=eq." + t["k"] + "&") in q]


def plat(sb):
    return feedplatform.Platform(sb, dry=False, auto_create=True, log=lambda m: None)


SURVIVOR = {"id": "t1", "slug": "london-elite", "name": "London Elite", "k": "london-elite", "also": ["london-elite-senior-men-i"]}

print("-- the lookup")
sb = SB([SURVIVOR])
p = plat(sb)
hit = p.team("L1", {"name": "London Elite Senior Men I", "code": "london-elite-senior-men-i"})
ok("a code the merged-away row had finds the survivor", hit is not None and hit["id"] == "t1", hit)
ok("...asking for the code as its own or as one of its others, quoted and encoded",
   sb.asked[0][0] == "teams" and sb.asked[0][1].startswith("league_id=eq.L1&or=(external_ids->>fiba_livestats.eq.")
   and "external_ids->also.cs." in sb.asked[0][1] and "%22london-elite-senior-men-i%22" in sb.asked[0][1], sb.asked[0])
ok("its own code still finds it", plat(SB([SURVIVOR])).team("L1", {"name": "London Elite", "code": "london-elite"}) is not None)

print("\n-- a server that does not know the filter")
sb2 = SB([dict(SURVIVOR, also=[])], reject_combined=True)
hit2 = plat(sb2).team("L1", {"name": "London Elite", "code": "london-elite"})
ok("the plain filter is asked instead, and still finds it",
   hit2 is not None and hit2["id"] == "t1" and len(sb2.asked) >= 2 and sb2.asked[1][1].startswith("league_id=eq.L1&external_ids->>fiba_livestats=eq.london-elite"), sb2.asked)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
