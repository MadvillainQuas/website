"""A merged club keeps the feed codes of both (0188, mirroring 0183 for players), offline:

    python scripts/ingest/team_merge_test.py

platform_team_merge (0188) keeps the survivor's own code under external_ids.fiba_livestats and the merged-away row's under
external_ids.also. team_code() (feedplatform.py) is the only thing a feed's own code can be missing from -- a league whose
game payload carries no club code at all falls to slugifying the club's name, which the schedule and the live payload can
spell differently for one club (NBL Division One's "London Elite" / "London Elite Senior Men I": see names.py's club_core
and 0188's own docstring), each giving a different slug. So the ingest has to look for both the survivor's code AND
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

print("\n-- the merged-away club's NAME alone (a feed that sends a code the platform has never seen)")


class NameSB(SB):
    def select(self, table, q):
        if table == "teams" and "select=id,slug,name,aliases,external_ids" in q:
            return [{"id": "t1", "slug": "cardiff-met-archers", "name": "Cardiff Met Archers", "aliases": ["Cardiff Met Archers Senior Men 1"],
                     "external_ids": {}, "logo_path": None}]
        return []

    def patch(self, *a, **k):
        pass

    def insert(self, *a, **k):
        raise AssertionError("a second club was created")


for spelling in ("Cardiff Met Archers Senior Men 1", "CARDIFF MET ARCHERS SENIOR MEN 1", "Cardiff Met Archers Senior Men I"):
    for code in ("", "cardiff-met-archers-senior-men-1"):
        try:
            got = plat(NameSB([])).team("L1", {"name": spelling, "code": code})
        except AssertionError as e:
            got = str(e)
        ok(f"{spelling!r} (code {code!r}) is the club it was merged into, never a second one", isinstance(got, dict) and got["id"] == "t1", got)

# 2026-10-15: "I merge once and if that team name pops up again it comes under the merged team". The payload of a game
# already filed under its two clubs named them its own way ("Nottingham Academy Wildcats U19 Men", WIL) and a twin with
# no games was made every time; now a side that matches no club is the game's own club, which learns the spelling
print("\n-- the game's own side (Platform.side_club)")


class SideSB:
    def __init__(self, rows):
        self.rows, self.patches = rows, []

    def select(self, table, q):
        if table != "teams":
            return []
        if q.startswith("slug=eq."):
            want = q.split("slug=eq.")[1].split("&")[0]
            return [r for r in self.rows if r.get("slug") == want]
        if "&or=(" in q or "fiba_livestats=eq." in q:
            d = unquote(q)
            return [r for r in self.rows if ('"' + str((r.get("external_ids") or {}).get("fiba_livestats")) + '"') in d
                    or any(('["' + a + '"]') in d for a in ((r.get("external_ids") or {}).get("also") or []))]
        return [dict(r) for r in self.rows]

    def one(self, table, q):
        got = self.select(table, q)
        return got[0] if got else None

    def patch(self, table, q, body):
        self.patches.append((table, q, body))
        rid = q.split("id=eq.")[1]
        for r in self.rows:
            if r["id"] == rid:
                r.update(body)

    def insert(self, *a, **k):
        raise AssertionError("a second club was created")

    upsert = insert


def side_plat(rows):
    sb = SideSB(rows)
    p = feedplatform.Platform(sb, dry=False, auto_create=True, log=lambda m: None)
    p.one = sb.one
    return p, sb


WILD = {"id": "w1", "slug": "nottingham-wildcats", "name": "Nottingham Wildcats", "aliases": [], "external_ids": {"fiba_livestats": "nottingham-wildcats"}}
READ = {"id": "r1", "slug": "reading-rockets", "name": "Reading Rockets", "aliases": [], "external_ids": {"fiba_livestats": "reading-rockets"}}
p, sb = side_plat([dict(WILD), dict(READ)])
try:
    got = p.side_club("L1", {"name": "Nottingham Academy Wildcats U19 Men", "code": "WIL"}, dict(WILD))
except AssertionError as e:
    got = str(e)
ok("a payload side matching no club is the game's own club on that side - no second club", isinstance(got, dict) and got["id"] == "w1", got)
ok("...which learns the payload's spelling as an alias and its code beside its own",
   sb.patches and sb.patches[0][2].get("aliases") == ["Nottingham Academy Wildcats U19 Men"]
   and sb.patches[0][2].get("external_ids", {}).get("also") == ["WIL"] and sb.patches[0][2]["external_ids"]["fiba_livestats"] == "nottingham-wildcats", sb.patches)
p2, sb2 = side_plat([r for r in sb.rows])
again = p2.team("L1", {"name": "Nottingham Academy Wildcats U19 Men", "code": "WIL"})
ok("...so the next pass finds it by that code at once, as a merge would have left it", again is not None and again["id"] == "w1", again)
p3, sb3 = side_plat([dict(WILD), dict(READ)])
other = p3.side_club("L1", {"name": "Reading Rockets", "code": "reading-rockets"}, dict(WILD))
ok("a payload side that names a different existing club keeps it (a wrong schedule is never welded on)",
   other["id"] == "r1" and not sb3.patches, (other, sb3.patches))
p4, sb4 = side_plat([dict(WILD), dict(READ)])
try:
    made = p4.side_club("L1", {"name": "Brand New Club", "code": "BNC"}, None)
except AssertionError as e:
    made = "created"
ok("...and with no game to go by, a new club is made as before", made == "created", made)
ok("the payload's sides read the other way round from the game's: positions are not trusted",
   feedplatform.swapped_sides({"tm": {"1": {"name": "HHS Reading Rockets U19 Women"}, "2": {"name": "Nottingham Academy Wildcats U19 Men"}}},
                              {"1": WILD, "2": READ}) is True and
   feedplatform.swapped_sides({"tm": {"1": {"name": "Nottingham Academy Wildcats U19 Men"}, "2": {"name": "HHS Reading Rockets U19 Women"}}},
                              {"1": WILD, "2": READ}) is False and
   feedplatform.swapped_sides({"tm": {"1": {"name": "SGS College U19 Men"}, "2": {"name": "The Canterbury Academy U19 Men"}}},
                              {"1": WILD, "2": READ}) is False)
SRC = open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read()
ok("write_platform hands the game's own two clubs to ensure_game_people", "group_fields(src, *n)) if groups.spec_for(src) else None, sides=sides)" in SRC
   and 'sides = {"1": rows_[ids_[0]], "2": rows_[ids_[1]]}' in SRC)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
