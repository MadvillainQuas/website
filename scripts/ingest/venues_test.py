"""Arenas for EPINOIA GO (docs/epinoia-go.md steps 1.2-1.3), offline:

    python scripts/ingest/venues_test.py

  * venue_of: a game's arena from the bundle, else from the adapter's metadata block in the raw payload
    (raw["aba"], raw["plk"], raw["nbl"], raw["feb"]); nothing invented where nothing names one;
  * the ABA game pages captured for aba_test.py each give their arena;
  * EuroLeague and EuroCup schedule rows carry the venue and its address;
  * write_platform takes the schedule's venue at all three of its call sites, writes it on a new game and
    patches it onto a stored one, and never clears one; write_fixture stores the address too;
  * migration 0162: the venues and aliases tables, the linking trigger on games.venue, placeholders, the
    home-club fallback (game_venue_id), who may write, and its own check. (0162 itself was run on a real
    Postgres, PGlite, with 25 checks before it was committed; that harness lives outside the repo.)
"""
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from adapters import aba as A  # noqa: E402
from adapters import euroleague as E  # noqa: E402
from adapters.base import GameBundle  # noqa: E402
import run_ingest as RI  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def bundle(raw=None, venue=None):
    return GameBundle(external_id="x", status="final", home_name="h", away_name="a", tipoff_at=None,
                      team={"home": {}, "away": {}}, box={}, stints=[], raw=raw, venue=venue)


print("-- venue_of")
ok("the bundle's own venue first, trimmed", RI.venue_of(bundle({"aba": {"venue": "B"}}, venue="  A  ")) == "A")
ok("else the adapter's metadata block", [RI.venue_of(bundle({k: {"venue": "Hall " + k}})) for k in ("aba", "plk", "nbl", "feb")]
   == ["Hall aba", "Hall plk", "Hall nbl", "Hall feb"])
ok("nothing named, nothing invented", [RI.venue_of(bundle({"tm": {"1": {}, "2": {}}})), RI.venue_of(bundle(None)),
                                       RI.venue_of(bundle({"aba": {"venue": "   "}})), RI.venue_of(bundle({"aba": {"venue": 7}}))]
   == [None, None, None, None])
ok("a venue's HTML entities are undone like the club names' (the dataclass's own clean-up)",
   bundle(venue="Palau Blaugrana &amp; Annex").venue == "Palau Blaugrana & Annex")

print("\n-- the ABA game pages")
want = {"1-25-3": "J.U. Sportska dvorana Laktaši", "1-25-6": "Sportski centar Morača", "1-25-251": "Beogradska Arena",
        "1-25-170": "Sportski centar Morača", "2-25-84": "Gradski Park KK Rabotnički", "7-25-36": "Košarkaška dvorana Aleksandar Nikolić"}
got = {}
for key in want:
    page = gzip.open(os.path.join(HERE, "data", "aba", f"game-{key}.html.gz"), "rt", encoding="utf-8").read()
    shots = json.load(open(os.path.join(HERE, "data", "aba", f"shots-{key}.json"), encoding="utf-8"))
    got[key] = RI.venue_of(bundle(A.raw_from_page(page, shots)))
ok("each of the six captured games names its arena", got == want, got)

print("\n-- EuroLeague and EuroCup schedules")


class Offline(E.EuroleagueAdapter if hasattr(E, "EuroleagueAdapter") else E.EuroLeagueAdapter):
    def _json(self, url, *a, **k):
        return {"data": [
            {"code": 1, "date": "2025-10-01T18:00:00Z", "played": True,
             "home": {"name": "Panathinaikos", "code": "PAN"}, "away": {"name": "Real Madrid", "code": "MAD"},
             "venue": {"code": "AUM6", "name": "TELEKOM CENTER ATHENS", "address": "37 Kifisias Avenue, 15123 Marousi"}},
            {"code": 2, "date": "2025-10-02T18:00:00Z", "played": False,
             "home": {"name": "Olympiacos", "code": "OLY"}, "away": {"name": "Barcelona", "code": "BAR"}, "venue": None}]}


rows = list(Offline().discover("", {"season": "2025-26"}))
ok("a row carries the arena's name and address",
   (rows[0].extra.get("venue"), rows[0].extra.get("venue_address")) == ("TELEKOM CENTER ATHENS", "37 Kifisias Avenue, 15123 Marousi"),
   rows[0].extra if rows else None)
ok("...and a row with no venue carries none", rows[1].extra.get("venue") is None and rows[1].extra.get("venue_address") is None)

print("\n-- the pipeline")
src = open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read()
ok("write_platform takes the schedule's venue", re.search(r"def write_platform\([^)]*venue: str \| None = None\)", src) is not None)
ok("...at all three call sites", len(re.findall(r'write_platform\([^\n]*venue=\(g\.extra or \{\}\)\.get\("venue"\)\)', src)) == 3)
ok("...falling back on the game's own page", 'venue = (venue or "").strip() or venue_of(b)' in src)
ok("...written on a new game", '**({"venue": venue} if venue else {})}, "id")' in src)
ok("...patched onto a stored one only when it differs, never cleared",
   'if venue and cur and cur[0].get("venue") != venue:\r\n            extra["venue"] = venue' in src
   or 'if venue and cur and cur[0].get("venue") != venue:\n            extra["venue"] = venue' in src)
ok("...a final game takes it too (the final branch writes `extra`)", "elif cur and cur[0].get(\"status\") == \"final\":" in src)
ok("write_fixture stores the address as well", '"venue_address": ex.get("venue_address")}' in src)

print("\n-- migration 0162")
sql = open(os.path.join(ROOT, "supabase", "migrations", "0162_venues.sql"), encoding="utf-8").read()
for what, rx in [
    ("the venues table, a pin being both halves or neither", r"create table if not exists public\.venues[\s\S]*venues_pin_whole check \(\(lat is null\) = \(lng is null\)\)"),
    ("the aliases table, keyed on the folded spelling", r"key\s+text primary key check \(key = public\.venue_key\(key\)\)"),
    ("games.venue_id and teams.home_venue_id", r"alter table public\.games add column if not exists venue_id[\s\S]*alter table public\.teams add column if not exists home_venue_id"),
    ("the trigger links on every write of games.venue", r"create trigger games_link_venue before insert or update of venue on public\.games"),
    ("...only when the text changed", r"if tg_op = 'INSERT' or new\.venue is distinct from old\.venue then"),
    ("a new spelling waits on a lock, so two writers make one arena", r"pg_advisory_xact_lock\(hashtext\('venue_link:' \|\| k\)\)"),
    ("B.LEAGUE's '調整中' and 'TBD' are placeholders", r"'調整中'[\s\S]*|'tbd'[\s\S]*'調整中'"),
    ("anybody reads the arenas; only a platform admin writes", r"create policy venues_read on public\.venues for select using \(true\)[\s\S]*create policy venues_admin on public\.venues for all\s+using \(public\.is_platform_admin\(\)\)"),
    ("venue_link is not a public function", r"revoke all on function public\.venue_link\(text, text\) from public, anon, authenticated"),
    ("the home-club fallback is the one definition", r"create or replace function public\.game_venue_id\(p_game uuid\)[\s\S]*coalesce\(g\.venue_id, t\.home_venue_id\)"),
    ("every game already stored is linked", r"update public\.games g\s+set venue_id = public\.venue_link\(g\.venue"),
    ("a club's home arena is learnt, and not guessed from one game", r"c\.rk = 1 and c\.n >= 2 and c\.n \* 3 > c\.total"),
    ("its own check refuses an unlinked game", r"0162: a game with a venue was left unlinked"),
]:
    ok(what, re.search(rx, sql) is not None)
nums = sorted(f[:4] for f in os.listdir(os.path.join(ROOT, "supabase", "migrations")) if re.match(r"\d{4}_", f))
ok("0162 is the only 0162", nums.count("0162") == 1)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
