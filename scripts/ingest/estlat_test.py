"""The Estonian-Latvian league from the Estonian federation's live-score portal (fiba_site_schedule site "basketee"),
offline:

    python scripts/ingest/estlat_test.py

What this holds the source to:
  * only dates the portal's own menu offers are ever asked for, and not its first or last day (a date outside the
    menu answers an error page that e-mails their webmaster);
  * the league is found on the menu by name; other championships' games on the same day are left alone;
  * a finished day is read once and never again; today, the days ahead and a past day still being played are re-read
    only after their time; an answer that is not the list (the error page) is not cached;
  * each game: the league's own id, both clubs with their federation ids, the kick-off in UTC, the hall, final or not;
    a game moved to another date is the newest reading of it, once;
  * a game is fetched from LiveStats under its cached id, keeps the league's id, and carries the schedule's names and
    club ids; a game not set up on LiveStats yet is not fetched.
"""
import json
import os
import sys
import tempfile
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_site_schedule import FibaSiteScheduleAdapter  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


TODAY = date(2026, 9, 27)
F._tallinn_today = lambda: TODAY

MENU = ('<form id="myForm"><select style="max-width:90vw" name="chid" onchange="x"><option value="2">Saku I liiga</option>'
        '<option value="212" selected>Estonian-Latvian Basketball League</option><option value="3">Saku II liiga</option></select>'
        '<select name="date" onchange="x">'
        + "".join(f'<option value="{d:02d}.{m:02d}.2026">x</option>' for d, m in
                  [(4, 10), (3, 10), (2, 10), (1, 10), (30, 9), (29, 9), (28, 9), (27, 9), (26, 9), (25, 9), (24, 9), (23, 9),
                   (22, 9), (21, 9), (20, 9), (19, 9), (18, 9), (17, 9), (16, 9), (15, 9), (14, 9)])
        + '</select></form>')


def row(gid, day, home, away, h, v, fls, over, chid="212", time_="19:00:00", place="Hall"):
    return {"gid": gid, "date": day, "time": time_, "chid": chid, "h_tid": h, "v_tid": v, "place": place,
            "team_home": home, "team_visitor": away, "sporting_id_live": fls, "is_over": 1 if over else 0}


DAYS = {
    "2026-09-22": [row("2027212141", "2026-09-22", "Rigas Ekselences Juniori", "Valmiera Glass VIA", "10028", "9897", "2904663", True)],
    "2026-09-26": [row("2027212001", "2026-09-26", "TalTech/ALEXELA", "Rīgas Zeļļi", "9896", "9898", "2910161", True,
                       time_="17:00:00", place="Tallinn, TalTech Spordihoone"),
                   row("2019002001", "2026-09-26", "Some Club", "Other Club", "1", "2", "2910000", True, chid="2")],
    "2026-10-01": [row("2027212142", "2026-10-01", "Rigas Ekselences Juniori", "Latvijas Universitāte", "10028", "9903", "2918501", False)],
    "2026-10-02": [row("2027212150", "2026-10-02", "BC Pärnu", "BK Ogre", "9893", "9902", None, False)],
}


class Fake(FibaSiteScheduleAdapter):
    def __init__(self, days=None):
        super().__init__()
        self.asked, self.days_ = [], dict(DAYS if days is None else days)
        F.FibaSiteScheduleAdapter._bee_menu_at = (0.0, None)

    def _bee_get(self, url, want_json=True):
        self.asked.append(url)
        if url == F.BASKETEE_HOME:
            return MENU
        d = url.split("/list/")[1].split("/")[0]
        if d == "2026-09-24":
            return None                                   # the error page (HTML, not JSON)
        return {"action": "list", "filter_date": d, "data": self.days_.get(d, [])}


ROOT = tempfile.mkdtemp(prefix="estlat_test_")
CFG = {"site": "basketee", "code": "ESTLAT", "basketee_league": "Estonian-Latvian Basketball League", "basketee_chid": "999",
       "season": "2026-27", "repo_root": ROOT}

print("-- the portal's menu")
m = F.basketee_menu(MENU)
ok("its dates, as ISO dates, and its championships by name", m["dates"][0] == "2026-10-04" and m["dates"][-1] == "2026-09-14" and len(m["dates"]) == 21
   and m["chids"]["Estonian-Latvian Basketball League"] == "212", m)
ok("a payload that is not the day's list (the error page) is None, not an empty day", F.basketee_rows(None, "212") is None and F.basketee_rows("<html>", "212") is None)

print("\n-- the first pass")
A = Fake()
games = A.discover("https://online.basket.ee/en", CFG)
days_asked = [u.split("/list/")[1][:10] for u in A.asked if "/list/" in u]
ok("the menu is read first", A.asked[0] == F.BASKETEE_HOME)
ok("only the menu's dates are asked for, a day inside each end (15.09 to 03.10, not 14.09 or 04.10)",
   days_asked == [f"2026-09-{d:02d}" for d in range(15, 31)] + ["2026-10-01", "2026-10-02", "2026-10-03"], days_asked)
by = {g.external_id: g for g in games}
ok("the league is found on the menu by NAME (the configured id 999 is only the fallback), other championships left alone",
   set(by) == {"2027212141", "2027212001", "2027212142", "2027212150"}, sorted(by))
g = by["2027212001"]
ok("a game: the league's id, the clubs, the kick-off (17:00 in Tallinn = 14:00 UTC), final",
   g.home_name == "TalTech/ALEXELA" and g.away_name == "Rīgas Zeļļi" and g.tipoff_at == "2026-09-26T14:00:00Z" and g.status == "final", g)
ok("...the hall and both clubs' federation ids", g.extra == {"venue": "Tallinn, TalTech Spordihoone", "home_code": "9896", "away_code": "9898"}, g.extra)
ok("a game still to come is scheduled", by["2027212142"].status == "scheduled")
cache = json.load(open(os.path.join(ROOT, "data", "feed", "ESTLAT", "days.json"), encoding="utf-8"))
ok("the days are cached: a finished past day is final, a day with nothing on is final once past, today and ahead are not",
   cache["2026-09-26"]["final"] and cache["2026-09-20"]["final"] and not cache["2026-09-27"]["final"] and not cache["2026-10-01"]["final"],
   {k: v["final"] for k, v in cache.items()})
ok("the error page is not cached (that date is asked again next time)", "2026-09-24" not in cache)

print("\n-- the next pass, straight after")
B = Fake()
B.discover("https://online.basket.ee/en", CFG)
again = [u.split("/list/")[1][:10] for u in B.asked if "/list/" in u]
ok("a finished day is never asked for again; nothing read within its time is either; the error day is tried again",
   again == ["2026-09-24"], again)

print("\n-- later: today's time runs out, then the days ahead")
cache = json.load(open(os.path.join(ROOT, "data", "feed", "ESTLAT", "days.json"), encoding="utf-8"))
cache["2026-09-27"]["t"] -= 1801
cache["2026-10-01"]["t"] -= 12 * 3600 + 1
json.dump(cache, open(os.path.join(ROOT, "data", "feed", "ESTLAT", "days.json"), "w", encoding="utf-8"))
C = Fake()
C.discover("https://online.basket.ee/en", CFG)
later = [u.split("/list/")[1][:10] for u in C.asked if "/list/" in u]
ok("today after half an hour, a day ahead after twelve hours", later == ["2026-09-24", "2026-09-27", "2026-10-01"], later)

print("\n-- a game moved to another day")
moved = dict(DAYS)
moved["2026-10-03"] = [row("2027212142", "2026-10-03", "Rigas Ekselences Juniori", "Latvijas Universitāte", "10028", "9903", "2918501", False)]
moved["2026-10-01"] = []
cache = json.load(open(os.path.join(ROOT, "data", "feed", "ESTLAT", "days.json"), encoding="utf-8"))
for d in ("2026-10-01", "2026-10-03"):
    cache[d]["t"] -= 12 * 3600 + 1
json.dump(cache, open(os.path.join(ROOT, "data", "feed", "ESTLAT", "days.json"), "w", encoding="utf-8"))
D = Fake(moved)
gm = [x for x in D.discover("https://online.basket.ee/en", CFG) if x.external_id == "2027212142"]
ok("it is there once, on its new day", len(gm) == 1 and gm[0].tipoff_at.startswith("2026-10-03"), [x.tipoff_at for x in gm])

print("\n-- one game, from LiveStats")
seen = {}


class FetchFake(Fake):
    def _get_meta(self, url):
        seen["url"] = url
        return {"tm": {"1": {"name": "TalTech", "code": "TAL"}, "2": {"name": "Riga Zelli", "code": "ZEL"}}}, {"lm_ms": 1, "recv_ms": 2}

    def bundle_from_raw(self, raw, external_id, config):
        seen["raw"], seen["id"] = raw, external_id

        class B:
            pass
        b = B()
        b.external_id, b.tipoff_at = external_id, None
        return b


E = FetchFake()
b = E.fetch("2027212001", dict(CFG, _tipoff_at="2026-09-26T14:00:00Z"))
ok("the feed is read under the cached LiveStats id, and the game keeps the league's id",
   seen["url"].endswith("/2910161/data.json") and b.external_id == "2027212001" and seen["id"] == "2027212001", seen.get("url"))
ok("...with the schedule's club names and federation ids, so a club is one club", seen["raw"]["tm"]["1"] == {"name": "TalTech/ALEXELA", "code": "9896"}
   and seen["raw"]["tm"]["2"] == {"name": "Rīgas Zeļļi", "code": "9898"}, seen["raw"]["tm"])
ok("...and its kick-off", b.tipoff_at == "2026-09-26T14:00:00Z")
ok("the fetch asked the portal nothing (the cache had the game)", E.asked == [], E.asked)
seen.clear()
ok("a game not set up on LiveStats yet is not fetched", E.fetch("2027212150", CFG) is None and "url" not in seen)

print("\n-- the config")
src = [s for s in json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
       if (s.get("adapter_config") or {}).get("site") == "basketee"]
ok("one source: the league by its portal name, its code of its own, both countries", len(src) == 1
   and src[0]["adapter_config"]["basketee_league"] == "Estonian-Latvian Basketball League" and src[0]["code"] == src[0]["adapter_config"]["code"] == "ESTLAT"
   and src[0]["league_country"] == "EE+LV", src)
ok("the portal is never asked more than once every 30 s", F.BASKETEE_GAP_S >= 30)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
