"""CIBACOPA (Mexico) on the FIBA LiveStats adapter, offline, over captured Genius hosted pages:

    python scripts/ingest/cibacopa_test.py

What it holds the shared hosted-schedule code to, with the league's own rows from
config/ingest-sources.json:
  * CIBA's dates, "14 Feb 2026, 7:00 pm" (day first, 12-hour clock), read at all;
  * each game read in its VENUE's zone: the page prints local times, and CIBACOPA spans three
    (Tijuana UTC-8 in winter, Sinaloa and Sonora UTC-7, Mexico City, Jalisco and Torreón UTC-6);
  * one Genius competition holding the whole year split by its phase menu: the regular-season
    row takes every game but the play-off phases' games, the play-off row only those, and a
    play-off phase page that cannot be read files nothing that pass (never a play-off game in
    the league table, and never a fallback to the unsplit list);
  * the season's competition expanded into the two rows' competitions, "CIBACOPA 2026" (league)
    and "CIBACOPA 2026 Playoffs" (playoff), picked by the tenant's own year.

Fixtures live in scripts/ingest/data/ciba/ (captured 2026-09-23): the 2026 competition page cut to
seven real games (four regular-season games in four zones, one from each play-off phase), each
play-off phase's page, and the client's bare schedule page (its competition picker).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_ingest as RI  # noqa: E402
from adapters import fiba_livestats as FL  # noqa: E402

DATA = os.path.join(HERE, "data", "ciba")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def page(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


class Reply:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


ASKED = []


def fake_get(fail_phase=None):
    def get(url, params=None, headers=None, timeout=None, **kw):
        ASKED.append((url, dict(params or {})))
        if url.split("#")[0].endswith("/CIBA/en/schedule"):
            return Reply(page("bare-schedule.html"))
        if "/competition/48341/schedule" in url:
            ph = (params or {}).get("phaseName")
            if ph is None:
                return Reply(page("schedule-48341.html"))
            if ph == fail_phase:
                return Reply("", 500)
            return Reply(page("phase-" + ph.lower().replace(" ", "-") + ".html"))
        return Reply("", 404)
    return get


rows = [s for s in json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
        if s["code"] == "CIBA"]
ok("two CIBA rows, a regular season and a play-off row", sorted(r["adapter_config"]["stage"] for r in rows) == ["playoffs", "regular"])
AC = {r["adapter_config"]["stage"]: dict(r["adapter_config"], season="2026") for r in rows}
REG, PO = "2817622 2814189 2817621 2813695".split(), "2851029 2854276 2857895".split()

print("\n-- dates, in each venue's own zone")
games = {g.external_id: g for g in FL.FibaLiveStatsAdapter().parse_schedule(
    page("schedule-48341.html"), AC["regular"]["timezone"], AC["regular"]["venue_timezones"])}
ok("all seven games read, every one dated", len(games) == 7 and all(g.tipoff_at for g in games.values()), len(games))
for gid, local, want in (("2817622", "Culiacán 21 Feb, 6:20 pm (UTC-7)", "2026-02-22T01:20:00+00:00"),
                         ("2814189", "Tijuana 17 Feb, 8:00 pm (UTC-8 in winter)", "2026-02-18T04:00:00+00:00"),
                         ("2817621", "Mexico City 20 Feb, 8:15 pm (UTC-6)", "2026-02-21T02:15:00+00:00"),
                         ("2813695", "Torreón 14 Feb, 7:00 pm (UTC-6)", "2026-02-15T01:00:00+00:00"),
                         ("2857895", "Jalisco 16 Jun, 8:15 pm (UTC-6)", "2026-06-17T02:15:00+00:00")):
    ok(f"{local} -> {want}", games[gid].tipoff_at == want, games[gid].tipoff_at)
ok("with no venue zones, every game is read in the source's zone (the old behaviour)",
   FL.FibaLiveStatsAdapter().parse_schedule(page("schedule-48341.html"), "America/Mazatlan")[1].tipoff_at
   == "2026-02-18T03:00:00+00:00")

print("\n-- one competition, split by phase")
orig_get = FL.requests.get
try:
    FL.requests.get = fake_get()
    url = "https://hosted.wh.geniussports.com/CIBA/en/competition/48341/schedule?roundNumber=-1&"
    ASKED.clear()
    reg = [g.external_id for g in FL.FibaLiveStatsAdapter().discover(url, dict(AC["regular"], code="CIBA"))]
    ok("the regular-season row takes the four regular-season games", sorted(reg) == sorted(REG), reg)
    phases = [p.get("phaseName") for u, p in ASKED if p.get("phaseName")]
    ok("...after reading the three play-off phases, each whole (roundNumber=-1) from the wh host",
       sorted(phases) == ["Final", "PlayOff Ronda 1", "Semifinal"]
       and all(p.get("roundNumber") == -1 and u.startswith("https://hosted.wh.geniussports.com/") for u, p in ASKED if p), ASKED)
    po = [g.external_id for g in FL.FibaLiveStatsAdapter().discover(url, dict(AC["playoffs"], code="CIBA"))]
    ok("the play-off row takes one game from each play-off phase", sorted(po) == sorted(PO), po)

    FL.requests.get = fake_get(fail_phase="Semifinal")
    ok("a play-off phase that cannot be read: the regular-season row files nothing this pass",
       list(FL.FibaLiveStatsAdapter().discover(url, dict(AC["regular"], code="CIBA"))) == [])
    ok("...and neither does the play-off row",
       list(FL.FibaLiveStatsAdapter().discover(url, dict(AC["playoffs"], code="CIBA"))) == [])

    print("\n-- the season's competition, expanded into the two rows' competitions")
    FL.requests.get = fake_get()
    orig_tenant = FL.FibaLiveStatsAdapter.tenant_competitions
    FL.FibaLiveStatsAdapter.tenant_competitions = lambda self, code: [
        {"id": "48341", "name": "CIBACOPA 2026", "year": 2026}, {"id": "40777", "name": "CIBACOPA 2025", "year": 2025},
        {"id": "38082", "name": "CIBACOPA 2024", "year": 2024}, {"id": "20579", "name": "CIBACOPA", "year": 2018}]
    try:
        srcs = [{**r, "schedule_url": r["scheduleUrls"][0], "id": None, "adapter_config": AC[r["adapter_config"]["stage"]]}
                for r in rows]
        out = RI.expand_competition_sources(srcs)
    finally:
        FL.FibaLiveStatsAdapter.tenant_competitions = orig_tenant
    got = sorted((s["competition_label"], s["competition_kind"], s["adapter_config"]["stage"], s["schedule_url"]) for s in out)
    whole = "https://hosted.wh.geniussports.com/CIBA/en/competition/48341/schedule?roundNumber=-1&"
    ok("CIBACOPA 2026 [league] for the regular season, CIBACOPA 2026 Playoffs [playoff] for the play-offs",
       got == [("CIBACOPA 2026", "league", "regular", whole), ("CIBACOPA 2026 Playoffs", "playoff", "playoffs", whole)], got)
finally:
    FL.requests.get = orig_get

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
