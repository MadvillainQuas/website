"""The Czech leagues on the federation's system (adapters/fiba_site_schedule.py, site=czech), offline:

    python scripts/ingest/czech_test.py

What this holds the discovery to:
  * NBL and ŽBL: one /zapasy page each, the same rows, on their own address ("czech_base");
  * 1. liga mužů: the competition found by name on the federation's competitions page, every part of it read
    (its two groups, later the rest), only the fixtures tab of each part, each fixture tagged with its group;
  * a row that links its LiveStats webcast hands the id to the id map, so the game never needs the hop;
  * the hop, when it is needed, goes to the league's own site;
  * every source in the config that says site=czech is one of these shapes.
"""
import json
import os
import sys
import tempfile

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


NBL_ROW = """<tr><td class="text-gray ">1.</td><td class="text-gray ">2</td>
<td class="text-gray " data-sort="2026-09-17-18-00">17. 9. 2026<br>Čt 18:00</td>
<td class=""><div class="d-flex align-items-center">
<img src="/min.php?exact&topcut&file=http://cbf.cz/files/247505ZGN.png" class="d-none d-lg-block mr-2"  alt="">
<img src="/min.php?exact&topcut&file=http://cbf.cz/files/435934OTA.png" class="d-none d-lg-block mr-2"  alt="">
<div class=""><div class="">BK Loko BaliMania Plzeň</div><div class="font-weight-bold">BK ARMEX ENERGY Děčín</div></div></div></td>
<td class=""><a href="/zapas/544547#tab-pane-one" class="text-primary d-block">79<div class="font-weight-bold">109</div></a></td>
<td class=""><a href="https://www.fibalivestats.com/webcast/CBFFE/2890468/" target="_blank" class="text-gray">
<span class="d-flex text-gray"><div class="mr-4">13<br>20</div></span></a></td>
<td class="text-right "><a href="/zapas/544547" class="btn btn-gray text-nowrap">Review</a></td></tr>
<tr><td class="text-gray ">2.</td><td class="text-gray ">3</td>
<td class="text-gray " data-sort="2026-10-01-18-00">1. 10. 2026<br>St 18:00</td>
<td class=""><div class=""><div class="">USK Praha</div><div class="font-weight-bold">NH Ostrava</div></div></td>
<td class=""><a href="/zapas/544600" class="btn btn-gray">Preview</a></td></tr>"""


def cz_row(sid, part, home, away, when, hall, webcast=None):
    web = (f'<td class=""><a href="https://www.fibalivestats.com/webcast/CBFFE/{webcast}/" target="_blank">'
           '<span class="d-flex text-gray"><div class="mr-4">17<br>23</div></span></a></td>') if webcast else '<td class=""></td>'
    return (f'<tr><td class="">{part}</td><td class="text-gray " data-sort="10224">1. kolo</td><td class="">95</td>'
            f'<td class=""><div class=" text-nowrap">{home}</div><div class="font-weight-bold text-nowrap">{away}</div></td>'
            f'<td class="text-gray " data-sort="{when}">20. 9. 2026<br>17:00</td><td class="">{hall}</td>'
            f'<td class="">Michaela Scholzová<br>Michal Kult<br></td><td class="">Marek Vondráček</td>'
            f'<td class=""><a href="/zapas/{sid}#tab-pane-one" class="text-primary">68<div class="font-weight-bold">80</div></a></td>'
            f'{web}<td class="text-right "><a href="/zapas/{sid}" class="btn btn-gray text-nowrap">Review</a></td></tr>')


def cz_page(rows, table_rows=""):
    return ('<html><form action="/soutez?competitionView-id=5404&amp;do=x"></form>'
            '<a href="#tab-pane-one">Zápasy</a><a href="#tab-pane-two">Tabulka</a>'
            f'<div role="tab-pane" id="tab-pane-one"><table>{rows}</table></div>'
            f'<div role="tab-pane" id="tab-pane-two"><table>{table_rows}</table></div></html>')


COMPS = """<h2 class="gamma">Maxa NBL</h2><a href="https://nbl.basketball/zapasy?y=2026&amp;p1[]=10310" class="x">
<div class="font-weight-bold mb-1">Základní část</div></a>
<h2 class="gamma">1. liga mužů</h2>
<div><a href="/soutez/5404?p=10223" class="text-primary">
  <div class="font-weight-bold mb-1">Skupina VÝCHOD</div></a></div>
<div><a href="/soutez/5404?p=10224" class="text-primary">
  <div class="font-weight-bold mb-1">Skupina ZÁPAD</div></a></div>
<div><a href="/soutez/5404?p=10300" class="text-primary">
  <div class="font-weight-bold mb-1">Skupina C 1.-6.</div></a></div>
<h2 class="gamma">1. liga žen</h2><a href="/soutez/5425?p=10228" class="x"><div class="font-weight-bold mb-1">Základní část</div></a>"""

EAST = cz_page(cz_row("535540", "skupina VÝCHOD", "BK NAPOS Vysoká n. L.", "BC Nový Jičín", "2026-09-20-17-00", "hala Sokol Hradec Králové", "2890489")
               + cz_row("535541", "skupina VÝCHOD", "Tuři Svitavy", "SK Žabovřesky", "2026-10-04-18-00", "Sportovní hala Svitavy"),
               # the table tab links a game too: it must not be read as a fixture
               '<tr><td><a href="/zapas/999999">x</a></td><td data-sort="2026-01-01-00-00"></td></tr>')
WEST = cz_page(cz_row("535429", "skupina ZÁPAD", "Slavoj BK Litoměřice", "GBA Lions Jindřichův Hradec", "2026-09-18-19-00", "Hala 6. ZŠ", "2890502"))
PLACE = cz_page(cz_row("539001", "skupina C 1.-6.", "SK Žabovřesky", "Slavoj BK Litoměřice", "2027-02-10-18-00", "Hala Rosnička"))


class Fake(FibaSiteScheduleAdapter):
    min_request_gap_s = 0

    def __init__(self, pages):
        super().__init__()
        self.pages, self.asked = pages, []

    def _page(self, url):
        self.asked.append(url)
        if url not in self.pages:
            raise RuntimeError("404 " + url)
        return self.pages[url]


ROOT = tempfile.mkdtemp(prefix="czech_test_")          # the id maps are written here, never into the repo


def cfg(**kw):
    return dict({"site": "czech", "season": "2026-27", "repo_root": ROOT}, **kw)


def clean():
    import shutil
    shutil.rmtree(ROOT, ignore_errors=True)


print("-- NBL and ŽBL: the /zapasy page, on each league's own site")
clean()
A = Fake({"https://nbl.basketball/zapasy?y=2026&p1=0&c=0&d_od=&d_do=&k=0": NBL_ROW})
g = A.discover("https://nbl.basketball/zapasy", cfg(code="CBFFE"))
ok("NBL: both fixtures, keyed on the site's own ids, clubs and kick-off (Prague time to UTC)",
   [x.external_id for x in g] == ["544547", "544600"] and g[0].home_name == "BK Loko BaliMania Plzeň" and g[0].away_name == "BK ARMEX ENERGY Děčín"
   and g[0].tipoff_at == "2026-09-17T16:00:00Z", [(x.external_id, x.home_name, x.away_name, x.tipoff_at) for x in g])
ok("...both crests, through the site's own resizer", g[0].extra["home_logo"] == "https://nbl.basketball/min.php?exact&topcut&file=http://cbf.cz/files/247505ZGN.png"
   and g[0].extra["away_logo"].endswith("435934OTA.png"), g[0].extra)
ok("...no hall and no group on an NBL row", "venue" not in g[0].extra and "home_group" not in g[0].extra, g[0].extra)
ok("a row that links its webcast gives the LiveStats id to the id map; one without does not",
   A._idmap(cfg(code="CBFFE")) == {"544547": "2890468"}, A._idmap(cfg(code="CBFFE")))
B = Fake({"https://zbl.basketball/zapasy?y=2026&p1=0&c=0&d_od=&d_do=&k=0": NBL_ROW.replace("544547", "546879")})
gz = B.discover("https://zbl.basketball/zapasy", cfg(code="ZBL", czech_base="https://zbl.basketball"))
ok("ŽBL: the same page on zbl.basketball, crests from zbl.basketball", gz[0].external_id == "546879" and gz[0].extra["home_logo"].startswith("https://zbl.basketball/min.php"),
   B.asked)
ok("...and its own id map", B._idmap(cfg(code="ZBL")) == {"546879": "2890468"} and "546879" not in A._idmap(cfg(code="CBFFE")))

print("\n-- 1. liga mužů: the competition, by name, one part at a time")
C = Fake({"https://cz.basketball/soutez?y=2026": COMPS, "https://cz.basketball/soutez/5404?p=10223": EAST,
          "https://cz.basketball/soutez/5404?p=10224": WEST, "https://cz.basketball/soutez/5404?p=10300": PLACE})
c1 = cfg(code="CZ1L", czech_base="https://cz.basketball", czech_competition="1. liga mužů", groups_from_feed=True)
g1 = C.discover("https://cz.basketball/soutez#1-liga-muzu", c1)
ok("every part of the competition is read (and nothing of 1. liga žen or NBL)",
   C.asked == ["https://cz.basketball/soutez?y=2026", "https://cz.basketball/soutez/5404?p=10223",
               "https://cz.basketball/soutez/5404?p=10224", "https://cz.basketball/soutez/5404?p=10300"], C.asked)
ok("the fixtures of both groups and of the later part; not the game the table tab links",
   sorted(x.external_id for x in g1) == ["535429", "535540", "535541", "539001"], [x.external_id for x in g1])
by = {x.external_id: x for x in g1}
ok("each first-phase fixture carries its group, East or West", by["535540"].extra.get("home_group") == "Východ" and by["535540"].extra.get("away_group") == "Východ"
   and by["535429"].extra.get("home_group") == "Západ", {k: v.extra.get("home_group") for k, v in by.items()})
ok("...a placement group ('Skupina C 1.-6.') is not a group of its own", "home_group" not in by["539001"].extra, by["539001"].extra)
ok("the hall is read off the row", by["535540"].extra.get("venue") == "hala Sokol Hradec Králové" and by["535429"].extra.get("venue") == "Hala 6. ZŠ", by["535540"].extra)
ok("clubs and kick-off", by["535540"].home_name == "BK NAPOS Vysoká n. L." and by["535540"].away_name == "BC Nový Jičín"
   and by["535540"].tipoff_at == "2026-09-20T15:00:00Z", (by["535540"].home_name, by["535540"].tipoff_at))
ok("the webcast ids the rows link are remembered", C._idmap(c1) == {"535540": "2890489", "535429": "2890502"}, C._idmap(c1))
D = Fake({"https://cz.basketball/soutez?y=2026": COMPS.replace("1. liga mužů", "Něco jiného")})
ok("a competition the page does not name gives no fixtures (and says so), not an error",
   D.discover("x", cfg(code="CZ1L", czech_base="https://cz.basketball", czech_competition="1. liga mužů")) == [])

print("\n-- the hop to a game's own page, when a row did not link it")
E = Fake({"https://cz.basketball/zapas/535541": '<a href="https://www.fibalivestats.com/webcast/CBFFE/2890777/">x</a>'})
ok("goes to the league's own site, and is remembered", E._czech_match_id("535541", c1) == "2890777" and E.asked == ["https://cz.basketball/zapas/535541"]
   and E._idmap(c1).get("535541") == "2890777", E.asked)
ok("...and never asked twice", E._czech_match_id("535541", c1) == "2890777" and len(E.asked) == 1)
N = Fake({"https://nbl.basketball/zapas/1": '<a href="https://www.fibalivestats.com/webcast/CBFFE/5/">x</a>'})
ok("NBL (no czech_base) still hops to nbl.basketball", N._czech_match_id("1", cfg(code="NBLTEST")) == "5" and N.asked == ["https://nbl.basketball/zapas/1"], N.asked)
clean()

print("\n-- the config")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
cz = {s["league_slug"]: s for s in src if (s.get("adapter_config") or {}).get("site") == "czech"}
ok("NBL, ŽBL and 1. liga are the Czech sources", set(cz) == {"czech-nbl", "czech-zbl", "czech-1-liga"}, sorted(cz))
ok("ŽBL: zbl.basketball, a women's league, its own code", cz["czech-zbl"]["adapter_config"]["czech_base"] == "https://zbl.basketball"
   and cz["czech-zbl"].get("league_gender") == "women" and cz["czech-zbl"]["code"] == cz["czech-zbl"]["adapter_config"]["code"] == "ZBL")
l1 = cz["czech-1-liga"]["adapter_config"]
ok("1. liga: the federation's site, the competition by name, groups from the feed", l1["czech_base"] == "https://cz.basketball"
   and l1["czech_competition"] == "1. liga mužů" and l1.get("groups_from_feed") is True and l1.get("competition_format") == "groups")
ok("every Czech source has a code of its own (each has its own id map)", len({s["code"] for s in cz.values()}) == 3)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
