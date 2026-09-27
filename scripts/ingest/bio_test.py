"""Bio from the feeds, offline:

    python scripts/ingest/bio_test.py

What this holds bio.py to (the rules are written at the top of that file):
  * the cleaners: metres become centimetres, a feed's 0 is 'not given', absurd numbers are dropped, dates in the shapes feeds use parse;
  * only blanks are filled; a hand-typed height, weight or year is never replaced, and a year that disagrees is reported, not fixed;
  * an adult's date is sent (the database keeps it secret), a minor's is NOT (his year is), and nobody is asked for a date the column
    cannot take yet (0184 unapplied -> the year alone);
  * a feed key (EuroLeague's person code) finds a player by itself; a name finds him only on an outright match; a stranger is left;
  * a detail page is fetched only for a player who has something missing, and one that fails does not stop the run;
  * the log never prints a date of birth.
"""
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bio  # noqa: E402
import bio_sources  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


TODAY = date(2026, 9, 27)

print("-- the cleaners")
ok("metres become centimetres", bio.clean_height(1.98) == 198 and bio.clean_height("1,85 m") == 185)
ok("centimetres pass, with text around them", bio.clean_height("201 cm") == 201 and bio.clean_height(185) == 185)
ok("0, blank and nonsense are 'not given'", bio.clean_height(0) is None and bio.clean_height(None) is None and bio.clean_height(50) is None and bio.clean_height(400) is None)
ok("weight in kilograms; 0 and absurd are dropped", bio.clean_weight(96) == 96 and bio.clean_weight("88 kg") == 88 and bio.clean_weight(0) is None and bio.clean_weight(20) is None and bio.clean_weight(900) is None)
ok("dates in the shapes feeds use", bio.parse_birth("2004-08-28") == date(2004, 8, 28) and bio.parse_birth("1992-02-23T00:00:00") == date(1992, 2, 23)
   and bio.parse_birth("28.08.2004") == date(2004, 8, 28) and bio.parse_birth("28/08/2004") == date(2004, 8, 28))
ok("an impossible or missing date is None", bio.parse_birth("2004-02-31") is None and bio.parse_birth("") is None and bio.parse_birth(None) is None and bio.parse_birth("n/a") is None)
ok("age counts the birthday", bio.age_on(date(2000, 9, 28), TODAY) == 25 and bio.age_on(date(2000, 9, 27), TODAY) == 26)

print("\n-- what is written")
p, n = bio.plan({}, {"height_cm": 198, "weight_kg": 95, "birth": "1996-03-14"}, TODAY)
ok("an adult with nothing on file gets height, weight and his date", p == {"height_cm": 198, "weight_kg": 95, "birth_date": "1996-03-14"}, p)
p, n = bio.plan({"height_cm": 200, "weight_kg": 90, "birth_year": 1996}, {"height_cm": 198, "weight_kg": 95, "birth": "1996-03-14"}, TODAY)
ok("hand-typed height and weight are never replaced; the date is filled beside his year", p == {"birth_date": "1996-03-14"}, p)
p, n = bio.plan({"birth_year": 1995}, {"birth": "1996-03-14"}, TODAY)
ok("a year that disagrees is left alone and reported, and no date is stored against it", p == {} and len(n) == 1 and "1995" in n[0] and "1996" in n[0], (p, n))
p, n = bio.plan({}, {"birth": "2010-06-01"}, TODAY)
ok("a minor gets his YEAR only, never the date", p == {"birth_year": 2010}, p)
p, n = bio.plan({}, {"birth": "2008-09-28"}, TODAY)
ok("...even one who turns 18 tomorrow (17 today)", p == {"birth_year": 2008}, p)
p, n = bio.plan({}, {"birth": "2008-09-27"}, TODAY)
ok("...and one who is 18 today gets his date", p == {"birth_date": "2008-09-27"}, p)
p, n = bio.plan({}, {"birth": "1996-03-14"}, TODAY, has_dob=False)
ok("with no date column yet (0184 unapplied) an adult gets his year", p == {"birth_year": 1996}, p)
p, n = bio.plan({"birth_date": "1996-03-14", "birth_year": 1996}, {"birth": "1996-03-14", "height_cm": 190}, TODAY)
ok("a date already stored is not written again", p == {"height_cm": 190}, p)
p, n = bio.plan({}, {"birth": "1900-01-01"}, TODAY)
ok("an implausible age is dropped and noted", p == {} and len(n) == 1, (p, n))
p, n = bio.plan({}, {"height_cm": 0, "weight_kg": 0}, TODAY)
ok("a feed's zeros write nothing", p == {}, p)


class SB:
    def __init__(self):
        self.patched = []

    def patch(self, table, q, body):
        self.patched.append((table, q, body))


def pl(pid, first, last, teams, keys=(), **row):
    return {"id": pid, "first_name": first, "last_name": last, "aliases": [], "teams": list(teams), "keys": set(keys),
            "row": dict({"id": pid, "first_name": first, "last_name": last}, **row)}


PLAYERS = [
    pl("p1", "Moustapha", "Fall", ["Olympiacos Piraeus"], ["OLY:P008811"]),
    pl("p2", "Aske", "Saugstrup", ["Bears Academy"]),
    pl("p3", "Mads", "Larsen", ["Bakken Bears"], height_cm=190, weight_kg=85, birth_year=1999),
    pl("p4", "Jonas", "Nielsen", ["Svendborg Rabbits"]),
    pl("p5", "Jonas", "Nielsen", ["Horsens IC"]),
]

print("\n-- matching and writing")
sb = SB()
log = []
recs = [
    {"first": "Moustapha", "last": "Fall", "team": "Olympiacos Piraeus", "key": "P008811", "height_cm": 218, "weight_kg": 127, "birth": "1992-02-23T00:00:00"},
    {"first": "Someone", "last": "Else", "team": "Olympiacos Piraeus", "key": "P999999", "height_cm": 200, "birth": "1990-01-01"},
]
st = bio.sync(sb, PLAYERS, recs, dry=False, log=log.append, today=TODAY)
ok("a feed key finds the player by itself and his blanks are written", sb.patched == [("players", "id=eq.p1", {"height_cm": 218, "weight_kg": 127, "birth_date": "1992-02-23"})], sb.patched)
ok("a key nobody has, and a name nobody has, is left", st["matched"] == 1 and st["unmatched"] == 1, st)
ok("the log does not print the date of birth", not any("1992" in l for l in log) and any("<date>" in l for l in log), log)

sb = SB()
st = bio.sync(sb, PLAYERS, [{"first": "Aske", "last": "Saugstrup", "team": "Bears Academy", "height_cm": 185, "weight_kg": 80, "birth": "2004-08-28"}], dry=False, log=log.append, today=TODAY)
ok("a name and club found in the players' table is matched", st["matched"] == 1 and sb.patched and sb.patched[0][1] == "id=eq.p2", (st, sb.patched))

sb = SB()
st = bio.sync(sb, PLAYERS, [{"first": "Jonas", "last": "Nielsen", "team": None, "height_cm": 190}], dry=False, log=log.append, today=TODAY)
ok("two players of one name with no club to tell them apart: neither is touched", not sb.patched and st["ambiguous"] + st["unmatched"] == 1, (st, sb.patched))
sb = SB()
st = bio.sync(sb, PLAYERS, [{"first": "Jonas", "last": "Nielsen", "team": "Svendborg Rabbits", "height_cm": 190}], dry=False, log=log.append, today=TODAY)
ok("...and the club settles it", sb.patched and sb.patched[0][1] == "id=eq.p4", (st, sb.patched))

sb = SB()
st = bio.sync(sb, PLAYERS, [{"first": "Mads", "last": "Larsen", "team": "Bakken Bears", "height_cm": 192, "weight_kg": 90, "birth": "1999-05-05"}], dry=False, log=log.append, today=TODAY)
ok("a player with height, weight and year on file: only his date is added", sb.patched == [("players", "id=eq.p3", {"birth_date": "1999-05-05"})], sb.patched)

sb = SB()
st = bio.sync(sb, PLAYERS, [{"first": "Jonas", "last": "Nielsen", "team": "Horsens IC", "height_cm": 185, "birth": "2004-08-28"}], dry=True, log=log.append, today=TODAY)
ok("a dry run writes nothing but counts what it would", not sb.patched and st["written"] == 1, (st, sb.patched))

print("\n-- detail pages")
calls = []


def det():
    calls.append(1)
    return {"height_cm": 185, "weight_kg": 80, "birth": "2004-08-28"}


PLAYERS2 = [pl("q1", "Aske", "Saugstrup", ["Bears Academy"]), pl("q2", "Mads", "Larsen", ["Bakken Bears"], height_cm=190, weight_kg=85, birth_year=1999, birth_date="1999-05-05"),
            pl("q3", "Kid", "Young", ["Bakken Bears"], height_cm=190, weight_kg=85, birth_year=2010)]
sb = SB()
st = bio.sync(sb, PLAYERS2, [{"first": "Aske", "last": "Saugstrup", "team": "Bears Academy", "detail": det},
                              {"first": "Mads", "last": "Larsen", "team": "Bakken Bears", "detail": det},
                              {"first": "Kid", "last": "Young", "team": "Bakken Bears", "detail": det}], dry=False, log=log.append, today=TODAY)
ok("a page is fetched only for the player who has something missing (not the complete one, not the minor whose year is all he can have)", len(calls) == 1 and st["detail_calls"] == 1, (calls, st))
ok("...and what it gave is written", sb.patched == [("players", "id=eq.q1", {"height_cm": 185, "weight_kg": 80, "birth_date": "2004-08-28"})], sb.patched)


def boom():
    raise RuntimeError("503")


sb = SB()
st = bio.sync(sb, PLAYERS2, [{"first": "Aske", "last": "Saugstrup", "team": "Bears Academy", "detail": boom},
                              {"first": "Mads", "last": "Larsen", "team": "Bakken Bears", "height_cm": 190}], dry=False, log=log.append, today=TODAY)
ok("a page that fails does not stop the run", st["records"] == 2 and st["matched"] == 2, st)

print("\n-- the readers")
ok("every reader is registered under the league's slug", set(bio_sources.READERS) >= {"euroleague", "eurocup", "basketligaen", "bnxt-league"})
ok("'LAST, FIRST' is turned round and cased", bio_sources._el_name("DE COLO, NANDO") == ("Nando", "De Colo") and bio_sources._el_name("FALL, MOUSTAPHA") == ("Moustapha", "Fall"))
ok("the season starts in August", bio_sources._season_start(date(2026, 9, 27)) == 2026 and bio_sources._season_start(date(2027, 3, 1)) == 2026)

feed_calls = []


def fake_get(url, params=None, headers=None):
    feed_calls.append((url, dict(params or {})))
    off = (params or {}).get("offset", 0)
    people = [{"type": "J", "person": {"code": "008811", "name": "FALL, MOUSTAPHA", "height": 218, "weight": 127, "birthDate": "1992-02-23T00:00:00"}, "club": {"name": "Olympiacos Piraeus"}},
              {"type": "A", "person": {"code": "CTB", "name": "COLLET, VINCENT", "height": 0, "weight": 0, "birthDate": "1963-06-06T00:00:00"}, "club": {"name": "ASVEL"}}]
    return {"data": people[off:off + 1], "total": 2}


real = bio_sources.get_json
bio_sources.get_json = fake_get
try:
    got = list(bio_sources.euroleague("E")(TODAY, log=lambda m: None))
finally:
    bio_sources.get_json = real
ok("the EuroLeague reader pages through the feed and keeps players, not coaches", [g["key"] for g in got][:1] == ["P008811"] and all(g["key"] != "PCTB" for g in got), got)
ok("...and asks for this season, then last", {u.split("/seasons/")[1].split("/")[0] for u, _ in feed_calls} == {"E2026", "E2025"}, feed_calls)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
