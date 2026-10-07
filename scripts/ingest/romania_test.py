"""Romania's Liga Nationala de Baschet Masculin (LNBM) on Genius Sports' hosted pages, offline:

    python scripts/ingest/romania_test.py

The federation's own site (frbaschet.ro) draws its schedule and game centre with BasketHotel widgets whose game
ids (6189488) are not LiveStats ids and name none. The games are scored on FIBA LiveStats all the same (client
FRB), and Genius's hosted page for the season's competition lists every one of them with its LiveStats id. That
page is the source, on the ordinary fiba_livestats path. The client's own competition list is no help - its
archive names only 2016's league, and its picker calls this season's competition "English" - so the row names
the competition outright and is NOT expanded per competition. What this holds it to:
  * the row pins a competition page, so expand_competition_sources leaves it alone;
  * a finished game and a scheduled one read with their LiveStats ids, both clubs, the score, and the tip-off
    in Bucharest time -> UTC (EEST in October);
  * the flag is there and listed, and the game page knows the LiveStats client.

Fixture scripts/ingest/data/romania/schedule-50100.html (captured 2026-10-07 from competition 50100, LNBM
2026-27): the competition picker and two match blocks.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402

DATA = os.path.join(HERE, "data", "romania")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


print("config row")
reg = json.loads(read(ROOT, "config", "ingest-sources.json"))
rows = [s for s in reg["sources"] if s.get("code") == "LNBM"]
ok("one LNBM row", len(rows) == 1, len(rows))
row = rows[0] if rows else {}
ac = row.get("adapter_config") or {}
ok("fiba_livestats on client FRB", row.get("adapter") == "fiba_livestats" and ac.get("client_code") == "FRB", (row.get("adapter"), ac.get("client_code")))
ok("Bucharest time", ac.get("timezone") == "Europe/Bucharest", ac.get("timezone"))
ok("country RO, slug lnbm", row.get("league_country") == "RO" and row.get("league_slug") == "lnbm", (row.get("league_country"), row.get("league_slug")))
url = (row.get("scheduleUrls") or [""])[0]
ok("the schedule pins a competition, the whole season", re.search(r"/FRB/en/competition/\d+/schedule\?roundNumber=-1", url) is not None, url)
ok("not a client_is_league row (the client's list is not this league's)", not ac.get("client_is_league"))
# sync_clubs keys clubs on the hosted /team/<id> links, and FRB's schedule links none (<a href="">); the
# schedule's own codes and crests already make each club before its first game
ok("no sync_clubs (no team links to key on)", not ac.get("sync_clubs"))

import run_ingest  # noqa: E402
src = dict(row, schedule_url=url)
ok("expand_competition_sources leaves a pinned competition alone", run_ingest.expand_competition_sources([src]) == [src])

print("hosted schedule")
html = read(DATA, "schedule-50100.html")
games = {g.external_id: g for g in FibaLiveStatsAdapter().parse_schedule(html, "Europe/Bucharest")}
ok("two games, keyed on their LiveStats ids", sorted(games) == ["2910765", "2910767"], sorted(games))
fin = games.get("2910765")
ok("finished: Valcea v Steaua, final", fin and fin.home_name == "CS Valcea 1924 Ramnicu Valcea" and fin.away_name == "CSA Steaua Bucuresti" and fin.status == "final",
   fin and (fin.home_name, fin.away_name, fin.status))
ok("finished: 97-90", fin and (fin.extra.get("home_score"), fin.extra.get("away_score")) == ("97", "90"), fin and fin.extra)
# FRB prints the home code bare (</span>VAL</span>): each side is read inside its own div, or the home club
# takes the away club's code and score and the away club is nobody
ok("each club its own code: VAL v STE", fin and (fin.extra.get("home_code"), fin.extra.get("away_code")) == ("VAL", "STE"), fin and fin.extra)
ok("each club its own crest", fin and fin.extra.get("home_logo") and fin.extra.get("away_logo") and fin.extra["home_logo"] != fin.extra["away_logo"], fin and fin.extra)
ok("7:00 PM Bucharest (EEST) is 16:00 UTC", fin and fin.tipoff_at == "2026-10-06T16:00:00+00:00", fin and fin.tipoff_at)
nxt = games.get("2910767")
ok("scheduled: Steaua v Rapid", nxt and nxt.home_name == "CSA Steaua Bucuresti" and nxt.away_name == "CS Rapid Bucuresti" and nxt.status == "scheduled",
   nxt and (nxt.home_name, nxt.away_name, nxt.status))
comps = FibaLiveStatsAdapter().parse_competitions(html)
ok("the picker names this season's competition 'English' (why the row pins it)", any(c["id"] == "50100" and c["name"] == "English" for c in comps), comps)

print("site")
ok("brand/flags/ro.svg", os.path.exists(os.path.join(ROOT, "epinoia", "brand", "flags", "ro.svg")))
for rel in ("epinoia/country.js", "epinoia/nav.js"):
    m = re.search(r"HAVE_FLAG = \[([^\]]*)\]", read(ROOT, *rel.split("/")))
    ok(f"RO in HAVE_FLAG ({rel})", m is not None and "'RO'" in m.group(1))
clients = json.loads(read(ROOT, "epinoia", "livestats-clients.json"))["clients"]
ok("livestats-clients.json: LNBM -> FRB", clients.get("LNBM") == "FRB", clients.get("LNBM"))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
