"""Korea's KBL (adapters/kbl.py), offline:

    python scripts/ingest/kbl_test.py

kbl.or.kr is a single-page app over api.kbl.or.kr; the adapter reads the season's match list, and a
game's header, box score, team totals and play-by-play, and translates them into the FIBA shape the
pipeline already reads. What this holds it to:
  * the season read off each game's own seasonName1 and the first division only; a source's stage
    picks the competitions (regular 01, play-offs 03+04, pre-season Open Match Day 14);
  * clubs in English from the logo class (which is also the code), KST -> UTC, the English venue;
  * players named from the league's own Latin spelling (family name first for a Korean, last for an
    import), the Hangul kept as the native name, initials-only spellings spelt from the Hangul;
  * the box score and the clubs' own totals, the quarter lines, a DNP left inactive;
  * the play-by-play in the FIBA event shape: the first period's opening "sub in" announcement left
    out (the starters come from the box), players found by club + name, the post-buzzer mass
    substitution dropped, and the lineups replayed without anyone missing from the court.

Fixtures in scripts/ingest/data/kbl/ (captured 2026-09-27): a slice of the match list (2026-27
pre-season and regular season, 2025-26, a D-League game) and every payload of S49G14N1, the Open
Match Day opener (Daegu KOGAS 82-87 Ulsan Hyundai Mobis, 24 Sep 2026).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import kbl as K  # noqa: E402

DATA = os.path.join(HERE, "data", "kbl")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


class Offline(K.KblAdapter):
    def __init__(self):
        super().__init__()
        self.asked = []

    def _json(self, path):
        self.asked.append(path)
        if path.startswith("/match/list"):
            return load("match-list.json")
        key = path.split("/")[2].split("?")[0] if path.startswith("/match/S") else ""
        if key != "S49G14N1":
            return None
        if path.endswith("/player-stat"):
            return load("player-stat_S49G14N1.json")
        if path.endswith("/team-record"):
            return load("team-record_S49G14N1.json")
        if "/text-cast" in path:
            return load("text-cast_S49G14N1.json")
        return load("match_S49G14N1.json")


print("-- the season's fixtures")
a = Offline()
pre = a.discover("", {"stage": "preseason", "season": "2026-27"})
reg = a.discover("", {"stage": "regular", "season": "2026-27"})
ok("pre-season: the Open Match Day games of 2026-27 only", [g.external_id for g in pre] == ["S49G14N1", "S49G14N2", "S49G14N3"],
   [g.external_id for g in pre])
ok("regular season: 2026-27's, not last season's nor the D-League's", [g.external_id for g in reg] == [f"S49G01N{i}" for i in range(1, 5)],
   [g.external_id for g in reg])
ok("an explicit game_codes wins over the stage", len(a.discover("", {"game_codes": ["1", "14"], "season": "2026-27"})) == 7)
ok("2025-26 is its own season", [g.external_id for g in a.discover("", {"stage": "regular", "season": "2025-26"})][:1] == ["S47G01N1"])
g = pre[0]
ok("clubs in English", (g.home_name, g.away_name) == ("Daegu KOGAS Pegasus", "Ulsan Hyundai Mobis Phoebus"), (g.home_name, g.away_name))
ok("the logo class is the club's code", (g.extra["home_code"], g.extra["away_code"]) == ("pega", "hd"), g.extra)
ok("crests from the site", g.extra["home_logo"] == "https://www.kbl.or.kr/assets/img/logo/logo-pega.svg", g.extra["home_logo"])
ok("14:00 KST is 05:00 UTC", g.tipoff_at == "2026-09-24T05:00:00Z", g.tipoff_at)
ok("the venue in English", g.extra["venue"] == "Daegue Gymnasium", g.extra["venue"])
ok("a finished game is final", g.status == "final")
ok("a game to come is scheduled", reg[0].status == "scheduled" and reg[0].home_name == "Busan KCC Egis", (reg[0].status, reg[0].home_name))

print("\n-- names")
ok("a Korean: family name first in the feed", K.english_name("KIM KYUNG WON", "김경원", "0") == ("Kyung-won", "Kim"))
ok("...run together", K.english_name("JUNG JOONWON", "정준원", "0") == ("Joonwon", "Jung"))
ok("...mixed case", K.english_name("Kwon Soon Woo", "권순우", "0") == ("Soon-woo", "Kwon"))
ok("an import: given name first", K.english_name("Gaige Colburn Prim", "게이지 프림", "1") == ("Gaige Colburn", "Prim"))
ok("initials only: spelt from the Hangul", K.english_name("KIM S C", "김세창", "0") == ("Se-chang", "Kim"))
ok("no Latin spelling at all: from the Hangul", K.english_name("", "최승욱", "0") == ("Seung-uk", "Choi"))

print("\n-- a game")
a = Offline()
b = a.fetch("S49G14N1", {"stage": "preseason"})
ok("fetched", b is not None)
tm = b.raw["tm"] if b else {}
h, w = tm.get("1", {}), tm.get("2", {})
ok("the score", (h.get("score"), w.get("score")) == (82, 87), (h.get("score"), w.get("score")))
ok("the quarter lines", [h.get(f"p{i}_score") for i in range(1, 5)] == [25, 20, 14, 23], [h.get(f"p{i}_score") for i in range(1, 5)])
ok("the club's code and name", (h.get("code"), h.get("name")) == ("pega", "Daegu KOGAS Pegasus"))
ok("the club's own totals (team rebounds included where it counts them)", w.get("tot_sPoints") == 87 and w.get("tot_sReboundsTotal") == 38,
   (w.get("tot_sPoints"), w.get("tot_sReboundsTotal")))
ok("bench and fast-break points from the team row", w.get("tot_sBenchPoints") == 47 and w.get("tot_sPointsFastBreak") == 8,
   (w.get("tot_sBenchPoints"), w.get("tot_sPointsFastBreak")))
pl = w.get("pl", {}).get("290489", {})
ok("a player keyed on his pcode", bool(pl))
ok("...named in English, the Hangul kept", (pl.get("internationalFirstName"), pl.get("internationalFamilyName"), pl.get("familyName"))
   == ("Joonwon", "Jung", "정준원"), (pl.get("internationalFirstName"), pl.get("internationalFamilyName"), pl.get("familyName")))
ok("...his line", (pl.get("sMinutes"), pl.get("sPoints"), pl.get("sTwoPointersMade"), pl.get("sThreePointersAttempted"))
   == ("14:48", 4, 2, 3), (pl.get("sMinutes"), pl.get("sPoints"), pl.get("sTwoPointersMade"), pl.get("sThreePointersAttempted")))
starters = [sum(1 for p in t.get("pl", {}).values() if p.get("starter")) for t in (h, w)]
ok("five starters a side, from the box", starters == [5, 5], starters)
ok("the points add up", sum(p.get("sPoints", 0) for p in h.get("pl", {}).values()) == 82)

ev = b.raw["pbp"] if b else []
ok("events oldest first", [e["actionNumber"] for e in ev] == sorted(e["actionNumber"] for e in ev))
ok("the first period's announcement is not ten substitutions", not any(e["actionType"] == "substitution" and e["actionNumber"] <= 10 for e in ev))
ok("it opens with the period", ev and ev[0]["actionType"] == "period" and ev[0]["subType"] == "start", ev[:1])
ok("every player event names a player", all(e["pno"] for e in ev
                                            if e["actionType"] not in ("period", "game", "timeout") and "team" not in e.get("qualifier", [])),
   [e for e in ev if not e["pno"] and e["actionType"] not in ("period", "game", "timeout") and "team" not in e.get("qualifier", [])][:3])
made = {1: 0, 2: 0}
for e in ev:
    if e.get("success") == 1:
        made[e["tno"]] += {"2pt": 2, "3pt": 3, "freethrow": 1}[e["actionType"]]
ok("the made shots add up to the score", made == {1: 82, 2: 87}, made)
ok("nobody substituted after the final buzzer", not any(e["actionType"] == "substitution" and e["period"] == 4 and e["gt"] == "00:00"
                                                         and e["actionNumber"] > max(x["actionNumber"] for x in ev if x["actionType"] == "period"
                                                                                    and x.get("subType") == "end") for e in ev))
ok("the game ends", ev and ev[-1]["actionType"] == "game" and ev[-1]["subType"] == "end")
ok("final", b and b.status == "final", b and b.status)
ok("the lineups replay (stints built)", b and len(b.stints or []) > 10, b and len(b.stints or []))

a = Offline()
ok("a game not yet tipped off: no request", a.fetch("S49G01N1", {"_tipoff_at": "2099-10-03T05:00:00Z"}) is None and a.asked == [], a.asked)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
