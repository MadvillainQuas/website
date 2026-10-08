"""North Macedonia's Super League (MSL, "МТЕЛ Супер Лига") on Genius Sports' hosted pages, offline:

    python scripts/ingest/macedonia_test.py

The federation's site (man.mkd.basketball) lists the season in pages of 45 and links every game to its FIBA
LiveStats webcast (client MSL), so the games are the ordinary fiba_livestats path. The schedule is taken from
Genius's hosted page for the season's competition, which lists all 90 games of 2026-27 on one page with their
LiveStats ids - no pages to walk. As in Romania, the client's competition picker calls this season's competition
"English", so the row names the competition outright and is NOT expanded. The hosted page prints no club codes;
sync_clubs reads each club's feed code (STP, TIK ...) and crest off a LiveStats preview page before its first
game, so a fixture and its box score land on one club. What this holds it to:
  * the row: fiba_livestats on client MSL, Skopje time, country MK, slug macedonian-super-league, sync_clubs on,
    the competition pinned so expand_competition_sources leaves it alone;
  * a finished game and a scheduled one read with their LiveStats ids, both clubs, crests, the score, and the
    tip-off in Skopje time -> UTC (CEST in October, CET in March);
  * the flag is there and listed, and the game page knows the LiveStats client.

Fixture scripts/ingest/data/macedonia/schedule-50171.html (captured 2026-10-08 from competition 50171, MSL
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

DATA = os.path.join(HERE, "data", "macedonia")
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
rows = [s for s in reg["sources"] if s.get("code") == "MSL"]
ok("one MSL row", len(rows) == 1, len(rows))
row = rows[0] if rows else {}
ac = row.get("adapter_config") or {}
ok("fiba_livestats on client MSL", row.get("adapter") == "fiba_livestats" and ac.get("client_code") == "MSL", (row.get("adapter"), ac.get("client_code")))
ok("Skopje time", ac.get("timezone") == "Europe/Skopje", ac.get("timezone"))
ok("country MK, slug macedonian-super-league", row.get("league_country") == "MK" and row.get("league_slug") == "macedonian-super-league",
   (row.get("league_country"), row.get("league_slug")))
url = (row.get("scheduleUrls") or [""])[0]
ok("the schedule pins a competition, the whole season", re.search(r"/MSL/en/competition/\d+/schedule\?roundNumber=-1", url) is not None, url)
ok("not a client_is_league row (the client's picker calls this season 'English')", not ac.get("client_is_league"))
# the hosted schedule prints no club codes (as SLB's); sync_clubs takes each club's code and crest off a preview page
ok("sync_clubs on (the schedule has no club codes)", ac.get("sync_clubs") is True)

import run_ingest  # noqa: E402
src = dict(row, schedule_url=url)
ok("expand_competition_sources leaves a pinned competition alone", run_ingest.expand_competition_sources([src]) == [src])

print("hosted schedule")
html = read(DATA, "schedule-50171.html")
games = {g.external_id: g for g in FibaLiveStatsAdapter().parse_schedule(html, "Europe/Skopje")}
ok("two games, keyed on their LiveStats ids", sorted(games) == ["2923574", "2923645"], sorted(games))
fin = games.get("2923574")
ok("finished: GKK Stip v Tikves Golden Eagle, final", fin and fin.home_name == "GKK Stip" and fin.away_name == "Tikves Golden Eagle" and fin.status == "final",
   fin and (fin.home_name, fin.away_name, fin.status))
ok("finished: 65-93", fin and (fin.extra.get("home_score"), fin.extra.get("away_score")) == ("65", "93"), fin and fin.extra)
ok("each club its own crest", fin and fin.extra.get("home_logo") and fin.extra.get("away_logo") and fin.extra["home_logo"] != fin.extra["away_logo"], fin and fin.extra)
ok("no club codes on the hosted page (why sync_clubs is on)", fin and not fin.extra.get("home_code") and not fin.extra.get("away_code"), fin and fin.extra)
ok("6:00 PM Skopje (CEST) is 16:00 UTC", fin and fin.tipoff_at == "2026-10-03T16:00:00+00:00", fin and fin.tipoff_at)
nxt = games.get("2923645")
ok("scheduled: MZT Skopje - Aerodrom v Tikves Golden Eagle", nxt and nxt.home_name == "MZT Skopje - Aerodrom" and nxt.away_name == "Tikves Golden Eagle" and nxt.status == "scheduled",
   nxt and (nxt.home_name, nxt.away_name, nxt.status))
ok("...6:00 PM Skopje in March (CET) is 17:00 UTC", nxt and nxt.tipoff_at == "2027-03-06T17:00:00+00:00", nxt and nxt.tipoff_at)
comps = FibaLiveStatsAdapter().parse_competitions(html)
ok("the picker names this season's competition 'English' (why the row pins it)", any(c["id"] == "50171" and c["name"] == "English" for c in comps), comps)
ok("...the row pins exactly that competition", "/competition/50171/" in url, url)

print("site")
ok("brand/flags/mk.svg", os.path.exists(os.path.join(ROOT, "epinoia", "brand", "flags", "mk.svg")))
for rel in ("epinoia/country.js", "epinoia/nav.js"):
    m = re.search(r"HAVE_FLAG = \[([^\]]*)\]", read(ROOT, *rel.split("/")))
    ok(f"MK in HAVE_FLAG ({rel})", m is not None and "'MK'" in m.group(1))
clients = json.loads(read(ROOT, "epinoia", "livestats-clients.json"))["clients"]
ok("livestats-clients.json: MSL -> MSL", clients.get("MSL") == "MSL", clients)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
