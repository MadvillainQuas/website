"""Who a box-score line belongs to (identity.py, and feedplatform.Platform.team_players), offline:

    python scripts/ingest/identity_test.py

The case this exists for: CIBACOPA 2026, Halcones de Obregon. The process cache was keyed on the feed's slot, so in a
pass over many games every later slot 15 went to whoever held slot 15 first (Keith Higgins), and the whole team shifted
one person along - Justin Moss's 27 points against Frayles filed under Higgins, two opponents written as "1:13" and
"1:6", and duplicate profiles ("Alejandro Reyna" beside "Alejandro Reyna Martinez") made when the real player's place
was already taken. What this holds the resolver to:
  * the canonical name: the fullest compatible spelling the feed gives (Justin / Moss + JUSTIN TREVON / MOSS);
  * the hierarchy: canonical name > name + shirt > the only compatible name on the club > name + shirt at another
    club > name score; a stale slot stamp only ever breaks a tie inside a tier;
  * two profiles of one person resolve to the fuller one; two people of one name are told apart by shirt, by who is
    already on the sheet, or left unmatched - never guessed;
  * a slot that changes hands between two games of one process goes to the new holder.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import identity as I  # noqa: E402
from feedplatform import Platform  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def line(first, last, shirt, i_first=None, i_last=None):
    d = {"firstName": first, "familyName": last, "shirtNumber": shirt}
    if i_first:
        d.update(internationalFirstName=i_first, internationalFamilyName=i_last)
    return d


HAL = "Halcones de Obregon"
ROSTER = [dict(id="higg", first_name="Keith Shondwell", last_name="Higgins Jr", number="13", team=HAL),
          dict(id="moss", first_name="Justin Trevon", last_name="Moss", number="4", team=HAL),
          dict(id="reyA", first_name="Alejandro", last_name="Reyna", number="17", team=HAL),
          dict(id="reyB", first_name="Alejandro", last_name="Reyna Martinez", number="17", team=HAL),
          dict(id="jm1", first_name="Jose", last_name="Martinez", number="5", team=HAL),
          dict(id="jm2", first_name="Juan", last_name="Martinez", number="9", team=HAL),
          dict(id="tw1", first_name="Jordan", last_name="Smith", number="", team=HAL),
          dict(id="tw2", first_name="Jalen", last_name="Smith", number="", team=HAL),
          dict(id="ham", first_name="Isaac", last_name="Hamilton", number="18", team="Caballeros de Culiacan")]

print("-- the canonical name")
c = I.canonical_name(line("Justin ", "Moss", "4", "JUSTIN TREVON", "MOSS"))
ok("the registration's fuller, compatible spelling", (c["first"], c["last"]) == ("Justin Trevon", "Moss"), c)
ok("...the short one kept as an alias", "Justin Moss" in c["aliases"], c["aliases"])
c = I.canonical_name(line("Alejandro", "Reyna ", "17", "ALEJANDRO", "REYNA MARTINEZ"))
ok("a double surname completed", (c["first"], c["last"]) == ("Alejandro", "Reyna Martinez"), c)
c = I.canonical_name(line("Tony", "Farmer", "55", "ANTHONY", "FARMER"))
ok("an incompatible registration name (a nickname) is not taken", (c["first"], c["last"]) == ("Tony", "Farmer"), c)
ok("compatible: an initial", I.compatible("A.", "Reyna", "Alejandro", "Reyna Martinez"))
ok("compatible: a suffix", I.compatible("Keith", "Higgins", "Keith Shondwell", "Higgins Jr"))
ok("not compatible: another forename", not I.compatible("Antonio", "Martinez", "Alejandro", "Reyna Martinez"))
ok("not compatible: another surname", not I.compatible("Justin", "Moss", "Keith", "Higgins"))

print("\n-- the hierarchy")
r = I.resolve(line("Justin ", "Moss", "4", "JUSTIN TREVON", "MOSS"), ROSTER, HAL, stamped="higg")
ok("a stale slot stamp never outranks the name", r["status"] == "match" and r["player"]["id"] == "moss" and r["tier"] == 1, r)
r = I.resolve(line("A.", "Reyna", "17"), ROSTER, HAL)
ok("one person filed twice resolves to the fuller profile", r["status"] == "match" and r["player"]["id"] == "reyB", r)
r = I.resolve(line("J.", "Martinez", "9"), ROSTER, HAL)
ok("two teammates of one name: the shirt decides (tier 2)", r["player"] and r["player"]["id"] == "jm2" and r["tier"] == 2, r)
r = I.resolve(line("J.", "Smith", ""), ROSTER, HAL)
ok("two teammates of one name and no shirt: ambiguous, not a guess", r["status"] == "ambiguous", r)
r = I.resolve(line("J.", "Smith", ""), ROSTER, HAL, stamped="tw2")
ok("...where the slot stamp breaks the tie inside the tier", r["status"] == "match" and r["player"]["id"] == "tw2", r)
r = I.resolve(line("Isaac", "Hamilton", "18"), ROSTER, HAL)
ok("a player who moved clubs: name + shirt in the league (tier 4)", r["player"] and r["player"]["id"] == "ham" and r["tier"] == 4, r)
r = I.resolve(line("Brand", "New", "21"), ROSTER, HAL)
ok("nobody fits: a new player", r["status"] == "none", r)

print("\n-- a whole club at once")
out = I.assign([("7", line("J.", "Martinez", "9")), ("8", line("J.", "Martinez", "")), ("15", line("Justin", "Moss", "4"))],
               ROSTER, HAL, stamps={"15": "higg", "8": "jm2"})
ok("the shirt-confirmed line is placed first", out["7"]["player"]["id"] == "jm2", out["7"])
ok("...so the one without a shirt is the other J. Martinez, whatever its stale stamp says",
   out["8"]["status"] == "match" and out["8"]["player"]["id"] == "jm1", out["8"])
ok("and slot 15 is Moss", out["15"]["player"]["id"] == "moss")


print("\n-- two games in one process: slot 15 changes hands")


class SB:
    """Just the queries Platform.team_players makes."""
    def __init__(self):
        self.players = {r["id"]: dict(r, external_ids={}) for r in ROSTER if r["team"] == HAL}
        self.players["higg"]["external_ids"] = {"fiba_livestats": "HAL:15"}    # game 1 put Higgins in slot 15
        self.patches = []

    def select(self, table, q):
        if table == "roster_entries" and q.startswith("team_id=eq."):
            return [{"player_id": p["id"], "jersey": p["number"], "position": None,
                     "players": {k: p[k] for k in ("id", "first_name", "last_name")} | {"slug": p["id"], "aliases": []}}
                    for p in self.players.values()]
        if table == "roster_entries" and q.startswith("teams.league_id"):
            return []
        if table == "roster_entries" and q.startswith("player_id=in."):
            ids = re.search(r"in\.\(([^)]*)\)", q).group(1).split(",")
            return [{"player_id": i, "team_id": "T", "jersey": self.players[i]["number"], "teams": {"league_id": "L"}} for i in ids]
        if table == "players" and "fiba_livestats" in q:
            from urllib.parse import unquote
            want = re.search(r'"([A-Z]+:\d+)"', unquote(q)).group(1)
            return [{k: p[k] for k in ("id", "first_name", "last_name")} | {"slug": p["id"]}
                    for p in self.players.values() if p["external_ids"].get("fiba_livestats") == want]
        if table == "players" and "select=external_ids" in q:
            pid = re.search(r"id=eq\.([^&]+)", q).group(1)
            return [{"external_ids": self.players[pid]["external_ids"]}]
        if table == "teams":
            return [{"league_id": "L"}]
        return []

    def patch(self, table, q, body):
        pid = re.search(r"id=eq\.([^&]+)", q).group(1)
        self.players[pid].update(body)
        self.patches.append((pid, body))


sb = SB()
plat = Platform(sb, dry=False, auto_create=False, log=lambda *a: None)
plat.photo = lambda *a, **k: None
team = {"id": "T", "name": HAL, "slug": "halcones", "league_id": "L"}
g1 = plat.team_players(team, "HAL", {"15": line("Keith", "Higgins", "13"), "12": line("Justin", "Moss", "4")})
ok("game 1: slot 15 is Higgins", g1["15"]["id"] == "higg" and g1["12"]["id"] == "moss", {k: v["id"] for k, v in g1.items()})
g2 = plat.team_players(team, "HAL", {"15": line("Justin ", "Moss", "4", "JUSTIN TREVON", "MOSS"), "13": line("Juan", "Martinez", "9")})
ok("game 2, same process: slot 15 is Moss now", g2["15"]["id"] == "moss", {k: v["id"] for k, v in g2.items()})
ok("...Higgins is not in game 2 at all", "higg" not in {v["id"] for v in g2.values()})
ok("...and the stamp followed Moss", sb.players["moss"]["external_ids"].get("fiba_livestats") == "HAL:15", sb.players["moss"]["external_ids"])
again = plat.team_players(team, "HAL", {"15": line("Justin ", "Moss", "4", "JUSTIN TREVON", "MOSS"), "13": line("Juan", "Martinez", "9")})
ok("a second poll of game 2 is a cache hit (no new patches)", again is g2)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
