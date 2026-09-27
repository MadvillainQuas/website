"""A merged profile keeps the feed keys of both (0183), offline:

    python scripts/ingest/player_merge_test.py

platform_player_merge keeps the survivor's own feed key under external_ids.fiba_livestats and the merged-away profile's under
external_ids.also. The ingest finds a player by the key a feed gives him (Platform.by_feed_key), so it has to look in both, or the
next game of the old feed would make the duplicate all over again. What this holds it to:
  * the lookup asks for a player whose fiba_livestats key OR whose also list holds the key, with the key quoted and encoded;
  * a profile found through the also list is used exactly as one found by its own key: the surname check still applies;
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
    def __init__(self, players, reject_combined=False):
        self.players, self.asked, self.reject = players, [], reject_combined

    def select(self, table, q):
        self.asked.append((table, q))
        if table == "players":
            if q.startswith("or="):
                if self.reject:
                    raise RuntimeError("400 bad filter")
                d = unquote(q)
                keys = [p for p in self.players if ("eq.\"" + p["k"] + "\"") in d or ("[\"" + p["k"] + "\"]") in d or any(("[\"" + a + "\"]") in d for a in p.get("also", []))]
                return [{"id": p["id"], "slug": p["slug"], "first_name": p["first"], "last_name": p["last"]} for p in keys]
            return [{"id": p["id"], "slug": p["slug"], "first_name": p["first"], "last_name": p["last"]} for p in self.players if ("=eq." + p["k"] + "&") in q]
        if table == "roster_entries":
            return [{"player_id": pid, "team_id": "t1", "teams": {"league_id": "L1"}} for pid in [x for x in ("p1",)]]
        if table == "teams":
            return [{"league_id": "L1"}]
        return []


def plat(sb):
    return feedplatform.Platform(sb, dry=False, auto_create=True, log=lambda m: None)


TEAM = {"id": "t1", "name": "Brisbane Bullets"}
SURVIVOR = {"id": "p1", "slug": "max-mackinnon", "first": "Max", "last": "Mackinnon", "k": "BRI:7", "also": ["NBL:23"]}

print("-- the lookup")
sb = SB([SURVIVOR])
p = plat(sb)
hit = p.by_feed_key(TEAM, "NBL:23", "Mackinnon")
ok("a key the merged-away profile had finds the survivor", hit is not None and hit["id"] == "p1", hit)
ok("...asking for the key as his own or as one of his others, quoted and encoded",
   sb.asked[0][0] == "players" and sb.asked[0][1].startswith("or=(external_ids->>fiba_livestats.eq.") and "external_ids->also.cs." in sb.asked[0][1] and "%22NBL%3A23%22" in sb.asked[0][1], sb.asked[0])
ok("his own key still finds him", plat(SB([SURVIVOR])).by_feed_key(TEAM, "BRI:7", "Mackinnon") is not None)
ok("a key nobody has finds nobody", plat(SB([SURVIVOR])).by_feed_key(TEAM, "XXX:1", "Mackinnon") is None)
ok("the surname check still applies to a key found in the also list (a reassigned slot is not him)",
   plat(SB([SURVIVOR])).by_feed_key(TEAM, "NBL:23", "Someoneelse") is None)

print("\n-- a server that does not know the filter")
sb2 = SB([dict(SURVIVOR, also=[])], reject_combined=True)
hit2 = plat(sb2).by_feed_key(TEAM, "BRI:7", "Mackinnon")
ok("the plain filter is asked instead, and still finds him", hit2 is not None and hit2["id"] == "p1" and len(sb2.asked) >= 2 and sb2.asked[1][1].startswith("external_ids->>fiba_livestats=eq.BRI:7"), sb2.asked)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
