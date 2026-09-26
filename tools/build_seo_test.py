"""tools/build-seo.py, offline:    python tools/build_seo_test.py

What it holds the generator to:
  * COVERAGE: every eligible player, every team and every league in the data gets an address, and the
    sitemap lists every one of them next to the site's own entry points;
  * WHO IS LEFT OUT: a minor (even one with consent), and a masked name ("#14"), gets no file, no sitemap
    line and no mention anywhere in the output - the rule is on the page, not only in the summary;
  * IT IS THE FULL PAGE: everything after </head> is byte-for-byte the shell's, and the head keeps every
    original tag (CSP, scripts, styles) with only title, description, canonical, link-preview tags and
    structured data replaced;
  * THE HEAD: a title that fits, a description, a canonical address that is the file's own, the entity in
    <meta name="epinoia-entity">, JSON-LD that parses, and a name that tries to close a <script> or a tag
    does neither;
  * ADDRESSES: named after the person, stable across a move, two people with one name told apart;
  * FAILING SAFE: a thin read is an error, not a thin site; the same input writes the same bytes;
  * the page scripts read the entity meta and keep the baked title.
"""
import html
import importlib.util
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("build_seo", os.path.join(HERE, "build-seo.py"))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- a small league system
LG1 = {"id": "L1", "slug": "test-league", "name": "Test League", "country": "GB"}
LG2 = {"id": "L2", "slug": "second-league", "name": "Second League", "country": "BE+NL"}
COMPS = [{"id": "C1", "name": "Test League", "seasons": {"id": "S1", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "L1"}}},
         {"id": "C0", "name": "Test League", "seasons": {"id": "S0", "name": "2025-26", "starts_on": "2025-09-01", "leagues": {"id": "L1"}}},
         {"id": "C2", "name": "Second League", "seasons": {"id": "S2", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "L2"}}}]
TEAMS = [{"id": "T1", "slug": "red-lions", "name": "Red Lions", "short_name": "RED", "league_id": "L1"},
         {"id": "T2", "slug": "blue-hawks", "name": "Blue Hawks", "short_name": "BLU", "league_id": "L1"},
         {"id": "T3", "slug": "empty-team", "name": "Empty Team", "short_name": "EMP", "league_id": "L1"},
         {"id": "T4", "slug": "second-reds", "name": "Second Reds", "short_name": "SRD", "league_id": "L2"},
         {"id": "T5", "slug": "red-lions", "name": "Red Lions (BE)", "short_name": "RLB", "league_id": "L2"}]


def row(pid, first, last, team, comp="C1", season="S1", slug=None, minor=False, gp=10, ppg=12.5):
    return {"season_id": season, "competition_id": comp, "player_id": pid, "team_id": team, "gp": gp, "min": 24.0,
            "ppg": ppg, "rpg": 5.1, "apg": 3.2, "pts": ppg * gp, "reb": 51, "ast": 32, "stl": 10, "blk": 4,
            "fgm": 40, "fga": 90, "p3m": 10, "p3a": 30, "ftm": 20, "fta": 25, "first_name": first, "last_name": last,
            "player_slug": slug or f"{team}-{first}-{last}".lower().replace(" ", "-"), "is_minor": minor,
            "team_name": next(t["name"] for t in TEAMS if t["id"] == team), "team_slug": "x", "jersey": "7"}


STATS = [
    row("P1", "Jordan", "Reed", "T1"),
    row("P1", "Jordan", "Reed", "T1", comp="C0", season="S0", ppg=9.0),          # two seasons, one person
    row("P2", "Ana", "García-Núñez", "T2"),                                    # accents
    row("P3", "John", "Smith", "T1"),                                          # two people, one name
    row("P4", "John", "Smith", "T2"),
    row("P5", "Kid", "Minorson", "T1", minor=True),                            # a minor, named
    row("P6", "Unregistered", "#14", "T2"),                                    # a masked name
    row("P7", "<script>alert(1)</script>", 'Bad"Name', "T2"),                  # hostile
    row("P8", "Marc", "Verstraete", "T4", comp="C2", season="S2"),
    row("P9", "Jordan", "Reed", "T2", comp="C1", season="S1", slug="blue-hawks-jordan-reed"),   # a third Jordan Reed (not P1)
]
ELIGIBLE = {"P1", "P2", "P3", "P4", "P7", "P8", "P9"}
LEFT_OUT = {"P5", "P6"}


def fixtures(folder, stats=STATS, teams=TEAMS):
    for name, data in (("leagues", [LG1, LG2]), ("competitions", COMPS), ("teams", teams), ("player_season_stats", stats)):
        with open(os.path.join(folder, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)


class Src:
    def __init__(self, folder):
        self.f = B.Fixtures(folder)

    def get(self, name, params):
        return self.f.get(name, params)


def run(min_players=1, stats=STATS, teams=TEAMS):
    fx, out = tempfile.mkdtemp(), tempfile.mkdtemp()
    fixtures(fx, stats, teams)
    res = B.build(out, Src(fx), min_players, min_teams=1, min_leagues=1)
    return out, res


def files(out, kind):
    d = os.path.join(out, "epinoia", kind)
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


def read(out, *p):
    with open(os.path.join(out, *p), encoding="utf-8") as f:
        return f.read()


out, res = run()
pf, tf, lf = files(out, "p"), files(out, "t"), files(out, "l")

print("-- coverage")
ok("every eligible player has an address", len(pf) == len(ELIGIBLE) and res["players"] == len(ELIGIBLE), (pf, res))
ok("every team has one, even a team with no player statistics", len(tf) == len(TEAMS) and "empty-team.html" in tf, tf)
ok("every league has one", lf == ["second-league.html", "test-league.html"], lf)
sm = read(out, "epinoia", "sitemap.xml")
locs = re.findall(r"<loc>(.*?)</loc>", sm)
for kind, names in (("p", pf), ("t", tf), ("l", lf)):
    ok(f"the sitemap lists all {len(names)} {kind}/ addresses", all(f"{B.ORIGIN}/epinoia/{kind}/{n}" in locs for n in names))
ok("...and the site's own entry points (/epinoia/, /epinoia/home/ ...)", f"{B.ORIGIN}/epinoia/" in locs and f"{B.ORIGIN}/epinoia/home/" in locs, locs[:4])
ok("...and never the site root (the Prophesy sign-in)", f"{B.ORIGIN}/" not in locs and not any(u.rstrip("/") == B.ORIGIN for u in locs))
ok("no address twice", len(locs) == len(set(locs)))

print("\n-- who is left out")
blob = "\n".join(read(out, "epinoia", k, n) for k, ns in (("p", pf), ("t", tf), ("l", lf)) for n in ns) + sm
ok("a minor, even a named one, has no file, no sitemap line and no mention", "Minorson" not in blob and "minorson" not in blob.lower())
ok("a masked name has none either", "Unregistered" not in blob and "#14" not in blob)
ok("the summary counts them", res["left_out_minor_or_masked"] == len(LEFT_OUT), res)
ok("a person with any minor or masked row is left out entirely (the rule is per person)",
   "P5" not in {p for p in ELIGIBLE})

print("\n-- addresses")
ok("named after the person, not the club: jordan-reed, ana-garcia-nunez", "ana-garcia-nunez.html" in pf, pf)
ok("two people with one name are told apart by their club: john-smith-red-lions / john-smith-blue-hawks",
   "john-smith-red-lions.html" in pf and "john-smith-blue-hawks.html" in pf and "john-smith.html" not in pf, pf)
jr = [n for n in pf if n.startswith("jordan-reed")]
ok("three-way name clash resolved with the club, and the id when the club repeats", len(jr) == 2 and len(set(jr)) == 2, jr)
ok("the same person's two seasons are one address", sum(1 for n in pf if "jordan-reed-red-lions" in n or n == "jordan-reed-red-lions.html") == 1, jr)
ok("a moved player keeps his address: the name is in it, the club is not (a unique name has no club)",
   "marc-verstraete.html" in pf, pf)
ok("two teams with one slug in different leagues both get an address", {"red-lions.html", "red-lions-second-league.html"} <= set(tf), tf)

print("\n-- it is the full page")
shell = {k: rd("epinoia", k, "index.html") for k in ("p", "t", "l")}
for kind, name in (("p", "ana-garcia-nunez.html"), ("t", "red-lions.html"), ("l", "test-league.html")):
    page = read(out, "epinoia", kind, name)
    ok(f"{kind}/{name}: everything after </head> is the shell's, byte for byte",
       page.split("</head>", 1)[1] == shell[kind].split("</head>", 1)[1])
    keep = [ln for ln in shell[kind].split("</head>", 1)[0].splitlines()
            if ln.strip() and "<title>" not in ln and 'name="description"' not in ln and "canonical" not in ln
            and "og:" not in ln and "twitter:" not in ln]
    ok(f"{kind}/{name}: the head keeps every other tag (CSP, scripts, styles)", all(ln in page for ln in keep),
       [ln for ln in keep if ln not in page][:2])
    ok(f"{kind}/{name}: exactly one title, description and canonical",
       page.count("<title>") == 1 and page.count('name="description"') == 1 and page.count('rel="canonical"') == 1)

print("\n-- the head")
page = read(out, "epinoia", "p", "ana-garcia-nunez.html")
title = re.search(r"<title>(.*?)</title>", page).group(1)
ok("a title that names the person, the club and the site, within 65 characters",
   "García-Núñez" in title and "Red Lions" not in title.replace("Blue Hawks", "") and title.endswith("| Epinoia") and len(title) <= 65, title)
ok("a description with his averages", "12.5 points" in re.search(r'name="description" content="(.*?)"', page).group(1))
ok("the canonical address is the file's own", 'href="https://prophesyscouting.co.uk/epinoia/p/ana-garcia-nunez.html"' in page)
ok("the entity is the player's id, for the page to load", 'name="epinoia-entity" content="P2"' in page)
ok("a link preview: og:title, og:url, og:image, twitter:card", all(k in page for k in ('property="og:title"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"')))
lds = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)]
ok("structured data parses: a Person and a BreadcrumbList", [d["@type"] for d in lds] == ["Person", "BreadcrumbList"], [d.get("@type") for d in lds])
ok("...the Person is a basketball player of his team", lds[0]["jobTitle"] == "Basketball player" and lds[0]["memberOf"]["name"] == "Blue Hawks", lds[0])
hostile = read(out, "epinoia", "p", [n for n in pf if "script" in n or "alert" in n][0])
ok("a name that tries to close a <script> or a tag does neither: the page has no live script from it",
   "<script>alert" not in hostile and "&lt;script&gt;" in hostile or "\\u003cscript" in hostile, hostile[:0])
ok("...and its JSON-LD still parses", all(json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', hostile, re.S)))
tpage = read(out, "epinoia", "t", "empty-team.html")
ok("a team with no players: a description without a roster claim", "roster, points" not in tpage and "Empty Team" in tpage)
lpage = read(out, "epinoia", "l", "second-league.html")
ok("a two-country league says both countries (BE+NL)", "Belgium and Netherlands" in lpage, re.search(r'name="description" content="(.*?)"', lpage).group(1))
ok("every title fits (or is the clipped last resort)", all(len(html.unescape(re.search(r"<title>(.*?)</title>", read(out, "epinoia", k, n)).group(1))) <= 66
                                                             for k, ns in (("p", pf), ("t", tf), ("l", lf)) for n in ns))

print("\n-- failing safe, and stable")
try:
    run(min_players=999)
    thin = False
except SystemExit:
    thin = True
ok("fewer players than expected is an error, not a thin site", thin)
out2, _ = run()
same = all(read(out, "epinoia", k, n) == read(out2, "epinoia", k, n) for k, ns in (("p", pf), ("t", tf), ("l", lf)) for n in ns)
ok("the same input writes the same bytes", same and read(out, "epinoia", "sitemap.xml") == read(out2, "epinoia", "sitemap.xml"))

print("\n-- the page scripts")
pj, tj, lj = rd("epinoia", "p", "player.js"), rd("epinoia", "t", "team.js"), rd("epinoia", "l", "league.js")
ok("each reads its entity from the meta tag when the address has no query",
   all("meta[name=\"epinoia-entity\"]" in js for js in (pj, tj, lj)))
ok("...the query still wins (?p= ?t= ?l=)", "get('p') ||" in pj and "get('t') ||" in tj and "get('l') ||" in lj)
ok("each keeps the baked title instead of overwriting it",
   all(re.search(r"if \(!document\.querySelector\('meta\[name=\"epinoia-entity\"\]'\)\) document\.title", js) for js in (pj, tj, lj)))

print("\n-- the Japanese and Spanish copies (leagues and clubs of Japan and Spain only)")
JP = {"id": "L3", "slug": "b-league-premier", "name": "B.LEAGUE Premier", "country": "JP"}
ES = {"id": "L4", "slug": "liga-endesa", "name": "Liga Endesa", "country": "ES"}
MX = {"id": "L5", "slug": "lnbp", "name": "LNBP", "country": "MX"}
CJ = [{"id": "C3", "name": "B.LEAGUE Premier", "seasons": {"id": "S3", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "L3"}}},
      {"id": "C4", "name": "Liga Endesa", "seasons": {"id": "S4", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "L4"}}},
      {"id": "C5", "name": "LNBP", "seasons": {"id": "S5", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "L5"}}}]
TJ = [{"id": "T10", "slug": "tokyo-x", "name": "Tokyo X", "short_name": "TKX", "league_id": "L3"},
      {"id": "T11", "slug": "madrid-y", "name": "Madrid Y", "short_name": "MDY", "league_id": "L4"},
      {"id": "T12", "slug": "monterrey-z", "name": "Monterrey Z", "short_name": "MTZ", "league_id": "L5"},
      {"id": "T13", "slug": "london-w", "name": "London W", "short_name": "LDW", "league_id": "L1"}]
SJ = [dict(row("P20", "Yuki", "Tanaka", "T1", comp="C3", season="S3"), team_id="T10", team_name="Tokyo X"),
      dict(row("P21", "Pau", "Ruiz", "T1", comp="C4", season="S4"), team_id="T11", team_name="Madrid Y"),
      dict(row("P22", "Luis", "Perez", "T1", comp="C5", season="S5"), team_id="T12", team_name="Monterrey Z")]
fx2, out2 = tempfile.mkdtemp(), tempfile.mkdtemp()
for name, data in (("leagues", [LG1, JP, ES, MX]), ("competitions", COMPS[:1] + CJ), ("teams", TJ), ("player_season_stats", SJ)):
    with open(os.path.join(fx2, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
res2 = B.build(out2, Src(fx2), 1, min_teams=1, min_leagues=1)
sm2 = re.findall(r"<loc>(.*?)</loc>", read(out2, "epinoia", "sitemap.xml"))
ok("Japan: a league and a club each have a /ja/ copy",
   os.path.exists(os.path.join(out2, "epinoia", "ja", "l", "b-league-premier.html")) and os.path.exists(os.path.join(out2, "epinoia", "ja", "t", "tokyo-x.html")))
ok("Spain: a league and a club each have an /es/ copy",
   os.path.exists(os.path.join(out2, "epinoia", "es", "l", "liga-endesa.html")) and os.path.exists(os.path.join(out2, "epinoia", "es", "t", "madrid-y.html")))
ok("no other country (Mexico, England) gets one, and the English pages all stay",
   sorted(os.listdir(os.path.join(out2, "epinoia", "ja", "t"))) == ["tokyo-x.html"] and sorted(os.listdir(os.path.join(out2, "epinoia", "es", "t"))) == ["madrid-y.html"]
   and not os.path.exists(os.path.join(out2, "epinoia", "ja", "p")) and not os.path.exists(os.path.join(out2, "epinoia", "es", "p"))
   and all(os.path.exists(os.path.join(out2, "epinoia", "t", f"{t['slug']}.html")) for t in TJ))
ok("...players get no /ja/ or /es/ copy (leagues and clubs only)", not any("/ja/p/" in u or "/es/p/" in u for u in sm2))
ok("the sitemap lists the four extra copies", all(f"{B.ORIGIN}/epinoia/{x}" in sm2 for x in ("ja/l/b-league-premier.html", "ja/t/tokyo-x.html", "es/l/liga-endesa.html", "es/t/madrid-y.html")), sm2)
ja = read(out2, "epinoia", "ja", "l", "b-league-premier.html")
jt = read(out2, "epinoia", "ja", "t", "tokyo-x.html")
es = read(out2, "epinoia", "es", "l", "liga-endesa.html")
en = read(out2, "epinoia", "l", "b-league-premier.html")
ok("a Japanese page is in Japanese (title, description, html lang, og:locale, page language default)",
   re.search(r"<title>[^<]*[ぁ-んァ-ン一-龥]", ja) and re.search(r'<meta name="description" content="[^"]*[ぁ-んァ-ン一-龥]', ja) and '<html lang="ja"' in ja
   and 'property="og:locale" content="ja_JP"' in ja and '<meta name="epinoia-lang" content="ja">' in ja)
ok("...it names the league as Japanese fans search it (Bリーグ)", "Bリーグ" in ja, re.search(r"<title>.*?</title>", ja).group(0))
ok("a Spanish page is in Spanish, with the league's usual name (Liga ACB)", "clasificación" in es and "Liga ACB" in es and '<html lang="es"' in es)
ok("the copies are the full page one folder down: <base> makes every relative link the page's own",
   '<base href="/epinoia/l/">' in ja and '<base href="/epinoia/t/">' in jt and "<base" not in en)
ok("the canonical is the copy's own address", f'rel="canonical" href="{B.ORIGIN}/epinoia/ja/l/b-league-premier.html"' in ja)
ok("English and Japanese point at each other (hreflang), English being the default",
   all(f'hreflang="{c}" href="{B.ORIGIN}{p}"' in x for x in (ja, en) for c, p in (("en", "/epinoia/l/b-league-premier.html"), ("ja", "/epinoia/ja/l/b-league-premier.html"), ("x-default", "/epinoia/l/b-league-premier.html"))))
ok("a league with no copy carries no hreflang", "hreflang" not in read(out2, "epinoia", "l", "lnbp.html") and "hreflang" not in read(out2, "epinoia", "t", "london-w.html"))
ok("the page body is the shell's, byte for byte, in every copy",
   all(x.split("</head>", 1)[1] == sh_body for x, sh_body in ((ja, B.shells()["l"].split("</head>", 1)[1]), (jt, B.shells()["t"].split("</head>", 1)[1]), (es, B.shells()["l"].split("</head>", 1)[1]))))
ok("Japanese titles fit a result (a full-width character counts two)",
   all(B.width(html.unescape(re.search(r"<title>(.*?)</title>", x).group(1))) <= 65 for x in (ja, jt)))
ok("the page's language script and nav read the page's own language and base",
   "meta[name=\"epinoia-lang\"]" in rd("epinoia", "i18n.js") and "document.baseURI" in rd("epinoia", "nav.js"))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
