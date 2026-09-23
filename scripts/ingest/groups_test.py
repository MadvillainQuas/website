"""Groups, conferences and divisions: python scripts/ingest/groups_test.py

Holds groups.py to its promises (a source with no file writes exactly what it always did; names
match folded; divisions are written only where a file has them) and checks every file in
config/groups/ the way a reader of the table would notice a mistake: a club in two groups at once,
a club listed twice, a format the database refuses.
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import groups  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
fails = 0


def check(ok, what):
    global fails
    if not ok:
        fails += 1
        print("  FAIL ", what)


# ---- folding --------------------------------------------------------------------------------
check(groups.fold("St. Francis Xavier") == groups.fold("St Francis Xavier"), "full stops matter")
check(groups.fold("Université Laval") == groups.fold("Universite Laval"), "accents matter")
check(groups.fold("Bishop's") == groups.fold("Bishops") == groups.fold("Bishop’s"),
      "an apostrophe, straight or curly, joins rather than splits")
check(groups.fold("St. Mary's") == groups.fold("St Marys"), "St. Mary's is St Marys")
check(groups.fold("Mount Royal  ") == "mount royal", "spaces and case matter")
check(groups.fold("A & M") == groups.fold("A and M"), "'&' and 'and' differ")
check(groups.fold("TSG Schöller SI Ravens Reutlingen") == "tsg scholler si ravens reutlingen",
      "an umlaut folds to its base letter")

# ---- a source with no groups file writes what it always did ---------------------------------
check(groups.entry({"code": "SLB"}, "2026-27", "London Lions") == {}, "no file: no group fields")
check(groups.same_group({"code": "SLB"}, "2026-27", "A", "B") is None, "no file: no opinion")
check(groups.competition_format({"code": "SLB"}) is None, "no file: no format")

# ---- a file, read in memory -----------------------------------------------------------------
spec = {
    "format": "conferences",
    "default": {
        "OUA": {"divisions": {"East": [["Toronto Metropolitan", "TMU"], "Carleton"],
                              "West": ["Western"]}},
        "RSEQ": {"teams": ["Bishop's", "McGill"]},
    },
    "seasons": {"2024-25": {"OUA": {"teams": ["Carleton", "Western"]}}},
}
groups._FILES["mem://spec"] = spec
src = {"code": "USPORTS", "groups_file": "mem://spec"}

check(groups.entry(src, "2026-27", "TMU") == {"group_name": "OUA", "division_name": "East"},
      "a second spelling finds the club, with its division")
check(groups.entry(src, "2026-27", "Bishops") == {"group_name": "RSEQ", "division_name": None},
      "a conference without divisions writes division_name = null where the file has divisions")
check(groups.entry(src, "2026-27", "Nobody", "Toronto Metropolitan") ==
      {"group_name": "OUA", "division_name": "East"}, "the club's stored name is tried after the feed's")
check(groups.entry(src, "2026-27", "Gonzaga") == {}, "an unknown club is entered with no group")
check(groups.entry(src, "2024-25", "Carleton") == {"group_name": "OUA", "division_name": None},
      "a season block replaces the default for that season")
check(groups.entry(src, "2024-25", "Bishop's") == {}, "...entirely, not merged with it")
check(groups.same_group(src, "2026-27", "Carleton", "Western") is True,
      "two divisions of one conference are one conference")
check(groups.same_group(src, "2026-27", "Carleton", "McGill") is False, "two conferences are not")
check(groups.same_group(src, "2026-27", "Carleton", "Gonzaga") is None,
      "an unknown opponent is left to the database")
check(groups.competition_format(src) == "conferences", "the file's format is the competition's")
check(groups.has_divisions(spec), "a file with divisions says so")

flat = {"format": "groups", "default": {"Nord": ["A", "B"], "Süd": ["C"]}}
groups._FILES["mem://flat"] = flat
fsrc = {"code": "PROB", "groups_file": "mem://flat"}
check(groups.entry(fsrc, "2026-27", "C") == {"group_name": "Süd"},
      "a file without divisions never writes division_name (it needs 0144)")
check(not groups.has_divisions(flat), "a flat file has no divisions")

# ---- every file in config/groups ------------------------------------------------------------
FORMATS = {"table", "groups", "knockout", "groups_knockout", "conferences"}
files = sorted(glob.glob(os.path.join(ROOT, "config", "groups", "*.json")))
check(files, "config/groups has files")
for path in files:
    name = os.path.relpath(path, ROOT)
    doc = json.load(open(path, encoding="utf-8"))
    check(doc.get("format") in FORMATS, f"{name}: format {doc.get('format')!r} is one the database takes")
    blocks = [("default", doc.get("default") or {})] + list((doc.get("seasons") or {}).items())
    check(any(b for _, b in blocks), f"{name}: names no clubs at all")
    for label, block in blocks:
        where: dict = {}                  # folded spelling -> (group, the club entry it belongs to)
        for gname, g in block.items():
            entries = g if isinstance(g, list) else (g.get("teams") or []) + [
                e for d in (g.get("divisions") or {}).values() for e in d]
            for i, e in enumerate(entries):
                # one club's own spellings may fold alike ("UBC-Okanagan", "UBC Okanagan"); two
                # DIFFERENT clubs answering to one name is the mistake - one would take the other's games
                for s in ([e] if isinstance(e, str) else e):
                    f = groups.fold(s)
                    if f in where and where[f][0] != gname:
                        check(False, f"{name} {label}: {s} is in both {where[f][0]} and {gname}")
                    elif f in where and where[f][1] != i:
                        check(False, f"{name} {label}: {s} names two different clubs in {gname}")
                    where[f] = (gname, i)
        if doc.get("format") == "conferences":
            check(len(block) >= 2, f"{name} {label}: a conference league of one conference")

print(f"groups_test: {'OK' if not fails else str(fails) + ' failure(s)'} ({len(files)} file(s) checked)")
sys.exit(1 if fails else 0)
