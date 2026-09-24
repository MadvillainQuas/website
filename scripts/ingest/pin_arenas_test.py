"""Arena pins for EPINOIA GO (docs/epinoia-go.md step 1.4), offline - no Google, no database:

    python scripts/ingest/pin_arenas_test.py

  * the cap: counted before a request is sent, 1,000 a day on Google's (Pacific) day and 4,000 a month,
    never raised by --cap, kept across runs; the cache: a cached answer costs nothing, a recheck never sends;
  * the key: read from its file, never in an error message;
  * judging an answer, on the shapes of real answers from the first run (2026-09-24): a car dealer in England
    for a Tokyo arena, a shopping mall, a street address, a club's office before its arena, a hall that only
    shares its town's name, a BNXT arena that may be in BE or NL, the leagues' "EU"/"XB" pseudo-countries;
  * B.LEAGUE short forms asked in full, the hints table, two spellings merged only when one holds the other;
  * a merge moves everything before it deletes; the arenas pass writes what it judged, and nothing on a dry run.
"""
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import pin_arenas as P  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")      # arena names in Japanese, on a Windows console too
except (AttributeError, ValueError):
    pass

PASS = FAIL = 0


def ok(name, cond, detail=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + name)
    else:
        FAIL += 1
        print("  FAIL  " + name + (f"\n          {detail}" if detail is not None else ""))


def place(pid, name, types, country, town=None, lat=35.0, lng=139.0):
    comps = [{"types": ["country", "political"], "shortText": country, "longText": country}]
    if town:
        comps.append({"types": ["locality", "political"], "longText": town, "shortText": town})
    return {"id": pid, "displayName": {"text": name}, "types": types + ["point_of_interest", "establishment"],
            "location": {"latitude": lat, "longitude": lng}, "addressComponents": comps,
            "formattedAddress": f"{name}, {town or ''}, {country}"}


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class FakeGoogle:
    """Stands in for requests: records every request, answers from a table keyed by the query text."""
    def __init__(self, answers=None, status=200):
        self.calls, self.answers, self.status = [], answers or {}, status

    def post(self, url, json=None, timeout=None, headers=None):
        self.calls.append((url, json, headers))
        if self.status != 200:
            return FakeResponse(self.status, {"error": {"message": "API key not valid"}})
        return FakeResponse(200, {"places": self.answers.get(json["textQuery"], [])})


tmp = Path(tempfile.mkdtemp(prefix="pin_arenas_test"))

print("\nthe cap")
now = [datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)]
b = P.Budget(tmp / "usage.json", day_cap=3, clock=lambda: now[0])
for _ in range(3):
    b.take()
try:
    b.take()
    ok("the fourth lookup on a cap of three is refused", False)
except P.CapReached as exc:
    ok("the fourth lookup on a cap of three is refused", "cap 3" in str(exc))
ok("the count is kept in the file, for the next run", P.Budget(tmp / "usage.json", day_cap=3, clock=lambda: now[0]).state()["day_count"] == 3)
ok("--cap can lower the daily cap, never raise it", P.Budget(tmp / "u2.json", day_cap=50000).day_cap == P.DAY_CAP == 1000)
ok("the month is capped too, below Google's free allowance", P.MONTH_CAP == 4000)
now[0] = datetime(2026, 9, 25, 6, 59, tzinfo=timezone.utc)          # 23:59 on the 24th in California
ok("Google's day is Pacific: 06:59 UTC is still yesterday", b.state()["day_count"] == 3)
now[0] = datetime(2026, 9, 25, 7, 1, tzinfo=timezone.utc)           # 00:01 on the 25th in California
ok("...and 07:01 UTC is a new day", b.state()["day_count"] == 0 and b.state()["month_count"] == 3)
now[0] = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
ok("a new month starts at nought", b.state()["month_count"] == 0)

print("\nevery lookup counted before it is sent")
g = FakeGoogle({"Steveco Areena": [place("p1", "Steveco Arena", ["sports_complex"], "FI", "Kotka")]})
b = P.Budget(tmp / "u3.json", day_cap=1)
P.text_search("KEY", b, "Steveco Areena", "FI", "fi", session=g)
try:
    P.text_search("KEY", b, "Steveco Areena", "FI", "fi", session=g)
    ok("at the cap nothing is sent", False)
except P.CapReached:
    ok("at the cap nothing is sent", len(g.calls) == 1)
url, body, headers = g.calls[0]
ok("the key travels in a header, never in the address", "KEY" not in url and headers.get("X-Goog-Api-Key") == "KEY")
ok("only the fields that are needed are asked for (the price is set by them)",
   headers.get("X-Goog-FieldMask") == P.FIELDS and "rating" not in P.FIELDS and "reviews" not in P.FIELDS)
ok("the region is the arena's country, the language its feed's", body.get("regionCode") == "fi" and body["languageCode"] == "fi")
g2 = FakeGoogle()
P.text_search("K", P.Budget(tmp / "u4.json"), "BELGRADE ARENA", "EU", "en", session=g2)
ok("a pseudo-country (EU, XB) is never sent as a region", "regionCode" not in g2.calls[0][1])
try:
    P.text_search("K", P.Budget(tmp / "u5.json"), "x", "FI", "fi", session=FakeGoogle(status=403))
    ok("a refusal from Google stops the run with its reason", False)
except P.GoogleError as exc:
    ok("a refusal from Google stops the run with its reason", "403" in str(exc) and "K" not in str(exc).replace("key", ""))

print("\nthe cache")
c = P.Cache(tmp / "cache.json")
g = FakeGoogle({"Luhta Areena": [place("p2", "Luhta Areena", ["sports_complex"], "FI", "Lahti")]})
b = P.Budget(tmp / "u6.json")
first = P.text_search("K", b, "Luhta Areena", "FI", "fi", session=g, cache=c)
again = P.text_search("K", b, "Luhta Areena", "FI", "fi", session=g, cache=P.Cache(tmp / "cache.json"))
ok("the same question twice asks Google once, and costs one lookup", len(g.calls) == 1 and b.state()["day_count"] == 1 and again == first)
ok("a recheck never sends: an answer not in the cache is None",
   P.text_search("K", b, "Not asked yet", "FI", "fi", session=g, cache=c, cache_only=True) is None and len(g.calls) == 1)
old = json.loads((tmp / "cache.json").read_text(encoding="utf-8"))
for v in old.values():
    v["at"] = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
(tmp / "cache.json").write_text(json.dumps(old), encoding="utf-8")
ok("answers older than 30 days are dropped (Google's terms on keeping coordinates)", P.Cache(tmp / "cache.json").d == {})

print("\nthe key")
kf = tmp / "google.json"
kf.write_text('{"maps_key": "AIzaTESTKEY0123456789"}', encoding="utf-8")
ok("read from its file", P.load_key(kf) == "AIzaTESTKEY0123456789")
kf.write_text('AIzaTESTKEY0123456789 is not json', encoding="utf-8")
try:
    P.load_key(kf)
    ok("a broken file is reported without its contents", False)
except SystemExit as exc:
    ok("a broken file is reported without its contents", "AIza" not in str(exc) and "JSONDecodeError" in str(exc))
src = Path(HERE, "pin_arenas.py").read_text(encoding="utf-8")
ok("the script never prints the key", not re.search(r"print\([^)]*\bkey\b", src))

print("\njudging an answer (shapes from the first run)")
fold_sql = re.search(r"translate\(lower\(coalesce\(p_name, ''\)\),\s*'([^']+)',\s*'([^']+)'\)",
                     Path(ROOT, "supabase", "migrations", "0162_venues.sql").read_text(encoding="utf-8"))
ok("the Python fold is 0162's venue_key, letter for letter",
   fold_sql and fold_sql.group(1) == P._FOLD_FROM and fold_sql.group(2) == P._FOLD_TO)
ok("...and folds as 0162's own check expects",
   P.fold("Šiaulių Arena") == "siauliu arena" and P.fold("KA „Žalgiris“ sporto kompleksas") == "ka zalgiris sporto kompleksas")
best, note = P.judge("トヨタA", "JP", [place("d", "スティーブン・イーゲル・トヨタ", ["car_dealer", "store"], "GB", "Frogmore")])
ok("a car dealer in England for a Tokyo arena: kept for a person", best and note and "GB" in note)
best, note = P.judge("立川立飛", "JP", [place("m", "ららぽーと立川立飛", ["shopping_mall"], "JP", "立川市")])
ok("a shopping mall is never an arena", note and "shopping mall" in note)
best, note = P.judge("横浜BT", "JP", [place("s", "BT二俣川", ["premise", "street_address"], "JP", "横浜市")])
ok("a street address is a place name, not a building", note and "place name" in note)
best, note = P.judge("ゼビオ", "JP", [place("o", "株式会社 仙台89ERS", ["corporate_office", "sports_club"], "JP", "仙台市"),
                                     place("a", "ゼビオアリーナ仙台", ["arena", "event_venue"], "JP", "仙台市")])
ok("a club's office before its arena: the arena is taken", best["id"] == "a" and note is None)
best, note = P.judge("Jurbarko A.G.G. sporto salė", "LT", [place("j", "Jurbarko kultūrizmo centras", ["gym"], "LT", "Jurbarkas")])
ok("sharing only the town's name is not a match (\"Jurbarko\" for Jurbarkas)", note and note.startswith("Google calls it"))
best, note = P.judge("Reims Arena (Reims)", "FR", [place("r", "Reims Arena", ["arena"], "FR", "Reims")])
ok("...but the same words and the town are (\"Reims Arena (Reims)\")", note is None)
best, note = P.judge("Arena Vilnius, Vilnius", "LT", [place("v", "ARENA VILNIUS", ["arena"], "LT", "Vilnius", 54.7, 25.3),
                                                     place("w", "Sportima arena", ["arena"], "LT", "Vilnius", 54.66, 25.29)])
ok("a bare \"arena\" does not make another building a second candidate", note is None and best["id"] == "v")
best, note = P.judge("Espoonlahden urheiluhalli", "FI", [place("e", "Espoonlahden liikuntahalli", ["sports_complex"], "FI", "Espoo")])
ok("a district is not its town (\"Espoonlahden\" is not Espoo)", note is None)
best, note = P.judge("Pyynikin palloiluhalli", "FI", [place("t", "Pyynikin palloiluhalli", ["sports_complex"], "FI", "Tampere")])
ok("the arena by its own name: pinned outright", note is None)
best, note = P.judge("Dôme", {"BE", "NL"}, [place("l", "The Dome", ["concert_hall", "event_venue"], "GB", "London")])
ok("a BNXT arena may be in BE or NL, and London is neither", note and "GB" in note)
best, note = P.judge("BELGRADE ARENA", "EU", [place("b", "Belgrade Arena", ["arena"], "RS", "Beograd")])
ok("a EuroLeague arena's \"EU\" is no country to disagree with", note is None)
ok("...and the pin gives it its real one", P.pin_fields(best, {"country": "EU"}, None)["country"] == "RS")
ok("a real country on file is never replaced", "country" not in P.pin_fields(best, {"country": "RS"}, None))
best, note = P.judge("Nowhere", "FI", [])
ok("nothing found: no pin, and why", best is None and note == "not found on Google Maps")
best, note = P.judge("Kataja", "FI", [place("k", "Kataja Basket ry", ["sports_club"], "FI", "Joensuu")], club=True)
ok("clubs pass: a club's office is not its arena", note and "sports club" in note)
best, note = P.judge("Kataja", "FI", [place("k", "Motonet Areena", ["arena"], "FI", "Joensuu")], club=True)
ok("clubs pass: an arena found from the club's name is taken", note is None)

print("\nnames")
ok("B.LEAGUE's アリ is asked as アリーナ", P.search_name("IGアリ") == "IGアリーナ" and P.search_name("トヨタA") == "トヨタA")
ok("two spellings are one arena when one holds the other",
   P.same_arena("IGアリ", "IGアリーナ") and P.same_arena("ANTARES ARENA", "Antares (Le Mans)")
   and P.same_arena("Adidas Arena (Paris)", "ADIDAS ARENA"))
ok("...and not when they only share a word (山形県総 / 山形スポ, pinned on one park)",
   not P.same_arena("山形県総", "山形スポ") and not P.same_arena("WA刈谷", "ウィングアリーナ刈谷"))
hints = P.load_hints()
ok("the hints table reads, every entry asks for something",
   len(hints) >= 40 and all(h.get("ask") and isinstance(h.get("sure"), bool) for h in hints.values()))
ok("a hint in Greek is asked in Greek, one in Japanese in Japanese",
   P.lang_for("Κλειστό Γυμναστήριο Σοφάδων", "GR") == "el" and P.lang_for("盛岡タカヤアリーナ", "JP") == "ja")


class FakeDB:
    """Enough of RI.Supabase for the passes: tables in memory, PostgREST filters eq / is.null / in."""
    def __init__(self, tables):
        self.t, self.log = tables, []

    @staticmethod
    def _match(row, cond):
        col, _, rest = cond.partition("=")
        if rest == "is.null":
            return row.get(col) is None
        if rest == "not.is.null":
            return row.get(col) is not None
        if rest.startswith("eq."):
            return str(row.get(col)) == rest[3:]
        if rest.startswith("in.("):
            return str(row.get(col)) in rest[4:-1].split(",")
        return True

    def _rows(self, table, query):
        conds = [c for c in query.split("&") if c.split("=")[0] not in ("select", "order", "limit", "offset")]
        return [r for r in self.t.get(table, []) if all(self._match(r, c) for c in conds)]

    def select(self, table, query):
        q = dict(p.split("=", 1) for p in query.split("&") if p.startswith(("limit=", "offset=")))
        rows = self._rows(table, query)
        off = int(q.get("offset", 0))
        return [dict(r) for r in rows[off: off + int(q.get("limit", 10 ** 6))]]

    def patch(self, table, query, body):
        self.log.append(("patch", table, query, body))
        for r in self._rows(table, query):
            r.update(body)

    def delete(self, table, query):
        self.log.append(("delete", table, query))
        doomed = self._rows(table, query)
        self.t[table] = [r for r in self.t[table] if r not in doomed]

    def rpc(self, fn, body=None):
        self.log.append(("rpc", fn, body))


print("\nmerging and writing")
db = FakeDB({"venue_aliases": [{"key": "ig", "venue_id": "B"}], "games": [{"id": "g1", "venue_id": "B"}],
             "teams": [{"id": "t1", "home_venue_id": "B"}], "venues": [{"id": "A"}, {"id": "B"}]})
P.merge_rows(db, "A", "B")
order = [(e[0], e[1]) for e in db.log]
ok("a merge moves spellings, games and clubs, and deletes the row last",
   order == [("patch", "venue_aliases"), ("patch", "games"), ("patch", "teams"), ("delete", "venues")]
   and db.t["games"][0]["venue_id"] == "A" and db.t["teams"][0]["home_venue_id"] == "A" and [v["id"] for v in db.t["venues"]] == ["A"])
try:
    P.merge_rows(db, "A", "A")
    ok("an arena is never merged into itself", False)
except ValueError:
    ok("an arena is never merged into itself", True)


def world():
    return FakeDB({
        "venues": [{"id": "v1", "name": "Steveco Areena", "country": "FI", "address": None, "city": None,
                    "pin_source": None, "pin_note": None, "checked_at": None, "place_id": None, "created_at": "1"},
                   {"id": "v2", "name": "Feeniks", "country": "FI", "address": None, "city": None,
                    "pin_source": None, "pin_note": None, "checked_at": None, "place_id": None, "created_at": "2"}],
        "games": [{"id": "g1", "venue_id": "v1", "home_team_id": "t1", "venue_address": None},
                  {"id": "g2", "venue_id": "v2", "home_team_id": "t1", "venue_address": None}],
        "teams": [{"id": "t1", "name": "KTP-Basket", "league_id": "l1"}],
        "leagues": [{"id": "l1", "country": "FI"}]})


answers = {"Steveco Areena": [place("p1", "Steveco Arena", ["sports_complex"], "FI", "Kotka", 60.47, 26.94)],
           "Feeniks": [place("p9", "Eläinpalvelu Feeniks", ["pet_care"], "FI", "Vantaa")],
           "Feeniks KTP-Basket": [place("p9", "Eläinpalvelu Feeniks", ["pet_care"], "FI", "Vantaa")]}
db = world()
out = []
g = FakeGoogle(answers)
orig_post = P.requests.post
P.requests.post = g.post
try:
    P.pin_venues(db, "K", P.Budget(tmp / "u7.json"), 10, False, out=out.append, cache=P.Cache(tmp / "c7.json"), hints={})
    ok("a dry run writes nothing", not [e for e in db.log if e[0] != "rpc"])
    db = world()
    P.pin_venues(db, "K", P.Budget(tmp / "u8.json"), 10, True, out=out.append, cache=P.Cache(tmp / "c8.json"), hints={})
    v1, v2 = db.t["venues"]
    ok("a sure answer is pinned: coordinates, place id, address, town, no note",
       v1["place_id"] == "p1" and v1["lat"] == 60.47 and v1["pin_source"] == "google" and v1["pin_note"] is None
       and v1["city"] == "Kotka" and v1["address"])
    ok("a pet shop is pinned with its note, for a person", v2["place_id"] == "p9" and "pet care" in (v2["pin_note"] or ""))
    ok("a doubtful answer is asked again with the home club's name", any(c[1]["textQuery"] == "Feeniks KTP-Basket" for c in g.calls))
    n = len(g.calls)
    db2 = world()
    db2.t["venues"][0].update(place_id="p1", pin_source="google", lat=60.47, lng=26.94)
    P.pin_venues(db2, "K", P.Budget(tmp / "u9.json"), 10, True, out=out.append, cache=P.Cache(tmp / "c9.json"),
                 recheck=True, hints={})
    ok("a recheck asks Google nothing", len(g.calls) == n)
    db3 = world()
    P.pin_venues(db3, "K", P.Budget(tmp / "u10.json"), 10, True, out=out.append, cache=P.Cache(tmp / "c10.json"),
                 hinted=True, hints={"Feeniks": {"ask": "Feeniks areena Vantaa", "sure": False}})
    ok("--hinted asks for the full name, only for the hinted arenas",
       [c[1]["textQuery"] for c in g.calls[n:]] == ["Feeniks areena Vantaa"])
finally:
    P.requests.post = orig_post

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
