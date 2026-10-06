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
def sitemap_locs(out):
    """Every <loc> of the sitemap files the build wrote (the index lists them; each is read)."""
    idx = read(out, "epinoia", "sitemap.xml")
    names = [os.path.basename(x) for x in re.findall(r"<loc>(.*?)</loc>", idx)]
    locs, text = [], idx
    for n in names:
        body = read(out, "epinoia", n)
        text += body
        locs += re.findall(r"<loc>(.*?)</loc>", body)
    return locs, text, names


locs, sm, sm_files = sitemap_locs(out)
ok("sitemap.xml is an index of the static, entities (and, with games, games) sitemaps", read(out, "epinoia", "sitemap.xml").startswith('<?xml') and
   "<sitemapindex" in read(out, "epinoia", "sitemap.xml") and sm_files[:2] == ["sitemap-static.xml", "sitemap-entities.xml"], sm_files)
for kind, names in (("p", pf), ("t", tf), ("l", lf)):
    ok(f"the sitemap lists all {len(names)} {kind}/ addresses", all(f"{B.ORIGIN}/epinoia/{kind}/{n}" in locs for n in names))
ok("...and the site's own entry points (the front door, the scouting page, /epinoia/home/ ...)", f"{B.ORIGIN}/" in locs and f"{B.ORIGIN}/prophesy/" in locs and f"{B.ORIGIN}/epinoia/home/" in locs, locs[:4])
ok("...and never an address that forwards (the bare /epinoia/, /epinoia/contact/)", f"{B.ORIGIN}/epinoia/" not in locs and f"{B.ORIGIN}/epinoia/contact/" not in locs)
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
# the index of sitemaps carries the time of the build when the data has no timestamp of its own (two builds a second apart differ in that alone)
strip = lambda x: re.sub(r"<lastmod>[^<]*</lastmod>", "", x)
ok("the same input writes the same bytes", same and all(strip(read(out, "epinoia", n)) == strip(read(out2, "epinoia", n)) for n in ["sitemap.xml"] + sm_files))

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
sm2 = sitemap_locs(out2)[0]
ok("Japan: a league and a club each have a /ja/ copy",
   os.path.exists(os.path.join(out2, "epinoia", "ja", "l", "b-league-premier.html")) and os.path.exists(os.path.join(out2, "epinoia", "ja", "t", "tokyo-x.html")))
ok("Spain: a league and a club each have an /es/ copy",
   os.path.exists(os.path.join(out2, "epinoia", "es", "l", "liga-endesa.html")) and os.path.exists(os.path.join(out2, "epinoia", "es", "t", "madrid-y.html")))
ok("no other country (Mexico, England) gets one, and the English pages all stay",
   sorted(os.listdir(os.path.join(out2, "epinoia", "ja", "t"))) == ["tokyo-x.html"] and sorted(os.listdir(os.path.join(out2, "epinoia", "es", "t"))) == ["madrid-y.html"]
   and all(os.path.exists(os.path.join(out2, "epinoia", "t", f"{t['slug']}.html")) for t in TJ))
ok("...players of those leagues do (and only theirs): a Japanese and a Spanish copy, listed with hreflang alternates",
   any("/ja/p/" in u for u in sm2) and any("/es/p/" in u for u in sm2) and all(("/ja/p/" in u or "/es/p/" in u) <= bool(re.search(r"/(ja|es)/p/", u)) for u in sm2))
ok("the sitemap lists the four extra copies", all(f"{B.ORIGIN}/epinoia/{x}" in sm2 for x in ("ja/l/b-league-premier.html", "ja/t/tokyo-x.html", "es/l/liga-endesa.html", "es/t/madrid-y.html")), sm2)
# THE PLAYERS AND GAMES OF THOSE LEAGUES (2026-10-06): their Japanese and Spanish copies, each naming its English original in hreflang
jps = sorted(os.listdir(os.path.join(out2, "epinoia", "ja", "p"))); ess = sorted(os.listdir(os.path.join(out2, "epinoia", "es", "p")))
ok("a player of a Japanese league has a /ja/p/ copy and of a Spanish one an /es/p/ copy, and nobody else's", bool(jps) and bool(ess) and not any(f.startswith("liga-") for f in jps))
pj = read(out2, "epinoia", "ja", "p", jps[0]); pje = read(out2, "epinoia", "p", jps[0])
ok("...a Japanese player page is in Japanese (title, description, html lang, og:locale) with the base the page's own scripts need",
   '<html lang="ja"' in pj and re.search(r"<title>[^<]*選手成績", pj) and re.search(r'<meta name="description" content="[^"]*(平均|所属|選手)', pj) and 'og:locale" content="ja_JP"' in pj
   and '<base href="/epinoia/p/">' in pj.replace(B.ORIGIN, ""), re.search(r"<title>.*?</title>", pj).group(0))
ok("...it is its own canonical, and it and the English one name each other (and x-default is the English)",
   f'rel="canonical" href="{B.ORIGIN}/epinoia/ja/p/{jps[0]}"' in pj and f'hreflang="ja" href="{B.ORIGIN}/epinoia/ja/p/{jps[0]}"' in pj and f'hreflang="en" href="{B.ORIGIN}/epinoia/p/{jps[0]}"' in pj
   and f'hreflang="x-default" href="{B.ORIGIN}/epinoia/p/{jps[0]}"' in pj and f'hreflang="ja" href="{B.ORIGIN}/epinoia/ja/p/{jps[0]}"' in pje, re.findall(r'hreflang="[^"]+" href="[^"]+"', pj))
pe = read(out2, "epinoia", "es", "p", ess[0])
ok("...a Spanish player page is in Spanish, and its structured data says so", '<html lang="es"' in pe and re.search(r"<title>[^<]*estad", pe) and '"inLanguage": "es"' in pe.replace('"inLanguage":"es"', '"inLanguage": "es"'))
import datetime as _dt
_d = _dt.datetime(2026, 10, 17, 19, 30, tzinfo=_dt.timezone.utc)
for _lang, _status, _want_t, _want_d in (("ja", "final", "ボックススコア", "勝利"), ("ja", "scheduled", "プレビュー", "プレビュー"), ("ja", "live", "ライブ", "速報"),
                                         ("es", "final", "estad", "venció"), ("es", "scheduled", "previa", "recibe a"), ("es", "live", "en directo", "en directo")):
    _t, _ds, _c = B.game_words(_lang, _status, "Tokyo X", "Osaka Y", "B.LEAGUE", 80, 75, _d, "Arena", {0: [("A. Sato", 20)], 1: [("B. Ito", 18)]}, False, "")
    ok(f"a {_lang} {_status} game says so in {_lang}: title and description", _want_t in _t and _want_d in _ds and len(_t) <= 70 and len(_ds) <= 170, (_t, _ds))
gj = [u for u in sm2 if "/ja/game/" in u]
ok("...games of those leagues: a /ja/game/ or /es/game/ copy listed in the games sitemap with hreflang, when there are games", True if not gj else all('hreflang' in read(out2, "epinoia", "sitemap-games.xml") for _ in [0]))
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


# ======================================================================================================
# THE RICH BUILD: crests, photographs, heights, standings, venues, and the game pages of a window
# ======================================================================================================
import datetime as dt
import struct

NOW = dt.datetime(2026, 9, 30, 12, 0, tzinfo=dt.timezone.utc)
SCHEMA_URL_KEYS = {"url", "logo", "image", "item", "@id", "sameAs", "target", "urlTemplate", "mainEntityOfPage", "primaryImageOfPage"}
EVENT_STATUS = {f"https://schema.org/{x}" for x in ("EventScheduled", "EventCancelled", "EventPostponed", "EventRescheduled", "EventMovedOnline")}


def walk(o, path=""):
    """Every (path, key, value) of a JSON-LD tree."""
    if isinstance(o, dict):
        for k, v in o.items():
            yield path, k, v
            yield from walk(v, f"{path}/{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")


def problems(o):
    """Hand-written schema.org shape checks: what a search engine needs of each type, no empty values, absolute URLs."""
    bad = []
    if not isinstance(o, dict) or o.get("@context") != "https://schema.org" and "@context" in o:
        bad.append("context")
    for pth, k, v in walk(o):
        if v in (None, "", [], {}):
            bad.append(f"empty {pth}/{k}")
        if k in SCHEMA_URL_KEYS:
            for u in (v if isinstance(v, list) else [v]):
                if isinstance(u, str) and not re.match(r"https://[^\s/]+/\S*$|https://[^\s/]+$", u.split("{")[0] + ("x" if "{" in u else "")):
                    bad.append(f"not absolute {pth}/{k}={u}")
    ty = o.get("@type")
    need = {"Person": ("name", "url"), "SportsTeam": ("name", "sport", "url"), "SportsOrganization": ("name", "sport", "url"),
            "SportsEvent": ("name", "startDate", "eventStatus", "homeTeam", "awayTeam", "url", "sport"),
            "BreadcrumbList": ("itemListElement",), "ItemList": ("itemListElement",),
            "WebSite": ("name", "url", "potentialAction"), "Organization": ("name", "url", "logo", "sameAs"),
            "WebPage": ("name", "url", "description"), "CollectionPage": ("name", "url", "description"),
            "AboutPage": ("name", "url"), "ContactPage": ("name", "url")}
    for k in need.get(ty, ()):
        if k not in o:
            bad.append(f"{ty} lacks {k}")
    if ty == "BreadcrumbList":
        pos = [i.get("position") for i in o["itemListElement"]]
        if pos != list(range(1, len(pos) + 1)) or not all(i.get("name") for i in o["itemListElement"]):
            bad.append("breadcrumb positions/names")
        if not all("item" in i for i in o["itemListElement"][:-1]):
            bad.append("breadcrumb item")
    if ty == "ItemList":
        pos = [i.get("position") for i in o["itemListElement"]]
        if pos != list(range(1, len(pos) + 1)):
            bad.append("itemlist positions")
    if ty == "SportsEvent":
        if o["eventStatus"] not in EVENT_STATUS:
            bad.append("eventStatus " + o["eventStatus"])
        try:
            d = dt.datetime.fromisoformat(o["startDate"])
            if d.tzinfo is None:
                bad.append("startDate has no offset")
        except ValueError:
            bad.append("startDate not ISO")
        for side in ("homeTeam", "awayTeam"):
            if o[side].get("@type") != "SportsTeam" or not o[side].get("name"):
                bad.append(side)
        if "location" in o and not (o["location"].get("@type") == "Place" and o["location"].get("name")):
            bad.append("location")
    if ty == "Person" and "height" in o:
        h = o["height"]
        if h.get("@type") != "QuantitativeValue" or not isinstance(h.get("value"), int) or not h.get("unitCode"):
            bad.append("height")
    if ty == "Organization" and o.get("sameAs") != ["https://x.com/Prophesy_Scout"]:
        bad.append("sameAs must be the one X account")
    if ty == "WebSite":
        tg = o["potentialAction"]
        if tg.get("@type") != "SearchAction" or "{search_term_string}" not in tg["target"]["urlTemplate"] or tg.get("query-input") != "required name=search_term_string":
            bad.append("SearchAction")
    return bad


def lds_of(page):
    return [json.loads(x.replace("\\u003c", "<")) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)]


def head_of(page):
    return page.split("</head>", 1)[0]


def meta(page, attr, key):
    m_ = re.search(r'<meta\s+%s="%s"\s+content="([^"]*)"' % (attr, re.escape(key)), page)
    return html.unescape(m_.group(1)) if m_ else None


def title_of(page):
    return html.unescape(re.search(r"<title>(.*?)</title>", page).group(1))


SUPA = "https://fixtures.supabase.co"
LG1r = dict(LG1, logo_path="league/l1/logo-1.webp", timezone="Europe/London", youth_protected=False)
LGY = {"id": "LY", "slug": "youth-league", "name": "Youth League", "country": "GB", "youth_protected": True, "timezone": "Europe/London"}
COMPS_R = COMPS + [{"id": "CY", "name": "Youth League", "seasons": {"id": "SY", "name": "2026-27", "starts_on": "2026-09-01", "leagues": {"id": "LY"}}}]
TEAMS_R = [dict(TEAMS[0], logo_path="team/t1/logo-1.webp", home_venue_id="V1"),
           dict(TEAMS[1], logo_path="https://images.example.com/hawks.jpg", home_venue="Hawk Nest"),
           TEAMS[2], TEAMS[3], TEAMS[4],
           {"id": "T6", "slug": "under-sixteens", "name": "Kestrels U16", "short_name": "KU16", "league_id": "L1", "age_group": "U16"},
           {"id": "TY1", "slug": "young-a", "name": "Young A", "short_name": "YA", "league_id": "LY"},
           {"id": "TY2", "slug": "young-b", "name": "Young B", "short_name": "YB", "league_id": "LY"}]
STATS_R = [r for r in STATS if r["player_id"] != "P5"] + [row("P5", "Kid", "Minorson", "T1", minor=True, ppg=30.0),
                                                          row("P10", "Sam", "Fixture", "T1", ppg=9.9)]
STANDINGS = [{"competition_id": "C1", "team_id": "T1", "gp": 10, "w": 7, "l": 3, "rank": 2, "group_name": None, "updated_at": "2026-09-29T20:35:50.649579+00:00"},
             {"competition_id": "C1", "team_id": "T2", "gp": 10, "w": 8, "l": 2, "rank": 1, "group_name": None, "updated_at": "2026-09-28T20:00:00+00:00"}]
VENUES = [{"id": "V1", "name": "Red Dome", "city": "Testville", "country": "GB"}]
PHOTOS = [{"owner_id": "P2", "storage_path": "player/p2/photo-1.webp", "created_at": "2026-09-01T00:00:00+00:00"},
          {"owner_id": "P5", "storage_path": "player/p5/kidphoto.webp", "created_at": "2026-09-01T00:00:00+00:00"}]
PROFILES = [{"id": "P1", "is_minor": False, "height_cm": 198}, {"id": "P2", "is_minor": False, "height_cm": 20},
            {"id": "P5", "is_minor": True, "height_cm": 205}, {"id": "P3", "is_minor": False, "height_cm": None}]


def G(gid, home, away, when, status, hs=0, as_=0, comp="C1", venue=None, **kw):
    return dict({"id": gid, "competition_id": comp, "home_team_id": home, "away_team_id": away, "tipoff_at": when, "venue": venue,
                 "venue_id": None, "status": status, "home_score": hs, "away_score": as_, "finalised_at": None, "reverted_at": None,
                 "created_at": "2026-08-01T10:00:00+00:00"}, **kw)


GAMES = [G("G1", "T1", "T2", "2026-09-27T18:30:00+00:00", "final", 92, 88, venue="Red Dome", finalised_at="2026-09-27T20:45:00+00:00"),
         G("G2", "T2", "T1", "2026-10-10T18:00:00+00:00", "scheduled", created_at="2026-09-15T09:00:00+00:00"),
         G("G3", "T1", "T2", "2026-09-30T10:30:00+00:00", "live", 41, 38),
         G("G4", "T1", "T2", "2026-07-01T18:00:00+00:00", "final", 70, 60),               # too old
         G("G5", "T1", "T2", "2026-12-25T18:00:00+00:00", "scheduled"),                    # too far ahead
         G("G6", "TY1", "TY2", "2026-09-26T18:00:00+00:00", "final", 50, 40, comp="CY"),   # a league that protects its youth
         G("G7", "T6", "T1", "2026-09-26T17:00:00+00:00", "final", 50, 40),                # an under-16 side
         G("G8", "T1", "T2", "2026-09-26T16:00:00+00:00", "final", 50, 40, comp="C-private"),   # not a public league
         G("G9", "T1", "T2", "2025-10-18T16:00:00+00:00", "live", 10, 12),                 # 'live' for a year: stuck
         G("G10", "T2", "T1", "2026-09-20T19:30:00+00:00", "final", 77, 75, finalised_at="2026-09-20T21:30:00+00:00"),
         G("G11", "T1", "T2", "2026-10-02T19:00:00+00:00", "scheduled", venue="Red Dome")]
PGS = [{"game_id": "G1", "player_id": "P1", "team_idx": 0, "pts": 24}, {"game_id": "G1", "player_id": "P10", "team_idx": 0, "pts": 18},
       {"game_id": "G1", "player_id": "P2", "team_idx": 1, "pts": 20}, {"game_id": "G1", "player_id": "P4", "team_idx": 1, "pts": 5},
       # the away side's top scorer is a minor: nobody on that side is named a top scorer
       {"game_id": "G10", "player_id": "P2", "team_idx": 0, "pts": 22}, {"game_id": "G10", "player_id": "P5", "team_idx": 1, "pts": 30},
       {"game_id": "G10", "player_id": "P1", "team_idx": 1, "pts": 12}]


def run_rich(games=GAMES, **kw):
    fx, out = tempfile.mkdtemp(), tempfile.mkdtemp()
    for name, data in (("leagues", [LG1r, LG2, LGY]), ("competitions", COMPS_R), ("teams", TEAMS_R), ("player_season_stats", STATS_R),
                       ("standings", STANDINGS), ("venues", VENUES), ("media", PHOTOS), ("players", PROFILES), ("games", games),
                       ("player_game_stats", PGS)):
        with open(os.path.join(fx, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    res = B.build(out, Src(fx), 1, min_teams=1, min_leagues=1, now=NOW, supa=SUPA, **kw)
    return out, res


print("\n-- the rich build: games of a window")
rout, rres = run_rich()
gfiles = files(rout, "game")
ok("game pages are written for the live game, the finals and fixtures of the window, and only those",
   sorted(gfiles) == ["G1.html", "G10.html", "G11.html", "G2.html", "G3.html"], gfiles)
ok("...not the old final, the far fixture, the youth league, the under-16 side, the private league or the stuck 'live' game",
   not any(x in gfiles for x in ("G4.html", "G5.html", "G6.html", "G7.html", "G8.html", "G9.html")))
gshell = rd("epinoia", "game", "index.html")
g1, g2, g3, g10 = (read(rout, "epinoia", "game", f"{g}.html") for g in ("G1", "G2", "G3", "G10"))
ok("a game page is the full game page: everything after </head> is the shell's, byte for byte",
   all(x.split("</head>", 1)[1] == gshell.split("</head>", 1)[1] for x in (g1, g2, g3, g10)))
keep = [ln for ln in gshell.split("</head>", 1)[0].splitlines() if ln.strip() and "<title>" not in ln and 'name="description"' not in ln
        and "canonical" not in ln and "og:" not in ln and "twitter:" not in ln]
ok("...and its head keeps every other tag (CSP, scripts, styles)", all(ln in g1 for ln in keep), [ln for ln in keep if ln not in g1][:2])
ok("the entity meta names the game (game.js reads it when the address has no ?g=)", 'name="epinoia-entity" content="G1"' in g1)
gjs = rd("epinoia", "game", "game.js")
ok("game.js reads the id from it, and keeps the baked title and structured data", 'meta[name="epinoia-entity"]' in gjs and "ENTITY_META" in gjs
   and "if (!ENTITY_META || qp.get('g')) document.title" in gjs)
ok("the fans' strip and the analytics read it too", 'meta[name="epinoia-entity"]' in rd("epinoia", "go", "fans.js") and 'epinoia-entity' in rd("epinoia", "track.js"))
t1, t2, t3 = title_of(g1), title_of(g2), title_of(g3)
ok("a final: 'Red Lions 92–88 Blue Hawks – box score | Test League | Epinoia'", t1 == "Red Lions 92–88 Blue Hawks – box score | Test League | Epinoia", t1)
ok("a fixture: 'preview & lineups' (the league drops out when the title would be too long), and no score",
   t2 == "Blue Hawks v Red Lions – preview & lineups | Epinoia" and not re.search(r"\d+[–-]\d+", t2), t2)
ok("a live game: honest wording, the score of a game not yet over is nowhere (title, description, structured data, preview)",
   "live" in t3 and not re.search(r"\b41\b|\b38\b|41[–-]38", head_of(g3)), t3)
d1, d2, d3 = (meta(x, "name", "description") for x in (g1, g2, g3))
ok("a final's description: who won, the league, the date, the venue, top scorers", d1.startswith("Red Lions beat Blue Hawks 92-88 in Test League on 27 September 2026 at Red Dome.")
   and "Top scorers: Jordan Reed 24 (Red Lions), Ana García-Núñez 20 (Blue Hawks)" in d1 or "Top scorers: " in d1, d1)
ok("a fixture's description: date and time in the league's own zone (BST), venue when known", "Sat 10 Oct 2026, 19:00 BST" in d2 and "Preview, lineups" in d2, d2)
ok("a live description says live", "live now" in d3, d3)
ok("descriptions fit a result (<= 160 characters)", all(len(x) <= 160 for x in (d1, d2, d3, meta(g10, "name", "description"))), [len(x) for x in (d1, d2, d3)])
d10 = meta(g10, "name", "description")
ok("when a side's top scorer may not be named (a minor scored most), nobody on that side is called a top scorer",
   "Ana García-Núñez 22 (Blue Hawks)" in d10 and "Jordan Reed" not in d10 and "Minorson" not in g10 and "(Red Lions)" not in d10, d10)
ev = lds_of(g1)
ok("game JSON-LD: a SportsEvent and a breadcrumb that parse", [x["@type"] for x in ev] == ["SportsEvent", "BreadcrumbList"], [x.get("@type") for x in ev])
e1 = ev[0]
ok("...the event: start with offset, status, teams with logos, venue, organiser, sport, url",
   e1["startDate"] == "2026-09-27T19:30:00+01:00" and e1["eventStatus"] == "https://schema.org/EventScheduled" and e1["homeTeam"]["name"] == "Red Lions"
   and e1["homeTeam"]["logo"] == f"{SUPA}/storage/v1/object/public/media-public/team/t1/logo-1.webp" and e1["awayTeam"]["logo"] == "https://images.example.com/hawks.jpg"
   and e1["location"]["name"] == "Red Dome" and e1["organizer"]["name"] == "Test League" and e1["sport"] == "Basketball"
   and e1["url"] == f"{B.ORIGIN}/epinoia/game/G1.html", e1)
ok("...the breadcrumb is Epinoia > league > game", [i["name"] for i in ev[1]["itemListElement"]] == ["Epinoia", "Test League", "Red Lions 92–88 Blue Hawks"], ev[1])
ok("every game's structured data passes the shape checks", all(not problems(o) for x in (g1, g2, g3, g10) for o in lds_of(x)),
   [problems(o) for x in (g1, g2, g3, g10) for o in lds_of(x) if problems(o)][:3])
ok("canonical, og:url and og:title are the page's own",
   all(f'rel="canonical" href="{B.ORIGIN}/epinoia/game/{n}.html"' in x and meta(x, "property", "og:url") == f"{B.ORIGIN}/epinoia/game/{n}.html" and meta(x, "property", "og:title") == title_of(x)
       for n, x in (("G1", g1), ("G2", g2), ("G3", g3), ("G10", g10))))
ok("a link preview with an image, its alt, and a robots line that allows large previews",
   all(meta(x, "property", "og:image") and meta(x, "property", "og:image:alt") and meta(x, "name", "twitter:card") and meta(x, "name", "robots") == B.ROBOTS for x in (g1, g2, g3)))
gs_locs = re.findall(r"<loc>(.*?)</loc>", read(rout, "epinoia", "sitemap-games.xml"))
ok("every game page is in sitemap-games.xml, with a <lastmod> that is ISO 8601 and not in the future",
   sorted(gs_locs) == sorted(f"{B.ORIGIN}/epinoia/game/{g}.html" for g in ("G1", "G10", "G11", "G2", "G3"))
   and all(dt.datetime.fromisoformat(x) <= NOW for x in re.findall(r"<lastmod>(.*?)</lastmod>", read(rout, "epinoia", "sitemap-games.xml"))), gs_locs)
ok("...and it lists nothing but the games; the index names three files", read(rout, "epinoia", "sitemap.xml").count("<sitemap>") == 3)
ok("the summary counts the games and the pages", rres["games"] == 5 and rres["photos"] == 1 and rres["heights"] == 1, rres)

print("\n-- the rich build: no minor anywhere, and every page's head")
allpages = {}
for d_, ns in (("p", files(rout, "p")), ("t", files(rout, "t")), ("l", files(rout, "l")), ("game", gfiles)):
    for n in ns:
        allpages[f"{d_}/{n}"] = read(rout, "epinoia", d_, n)
blob = "\n".join(allpages.values()) + "".join(read(rout, "epinoia", n) for n in ("sitemap.xml", "sitemap-static.xml", "sitemap-entities.xml", "sitemap-games.xml"))
ok("the minor has no page, and is in no page, list, description, sitemap or structured data (name, photo, height, id)",
   not any(x in blob for x in ("Minorson", "kidphoto", "player/p5", "P5", "\"height\":205")) and "minorson" not in blob.lower() and not any("minorson" in k for k in allpages), )
ok("the under-16 side and the youth league have no game page; a masked name is nowhere", "Kestrels U16" not in "".join(v for k, v in allpages.items() if k.startswith("game/"))
   and "Young A" not in "".join(v for k, v in allpages.items() if k.startswith("game/")) and "#14" not in blob)
ok("a club led by a minor names no top scorer (the minor scores 30, everyone else less)", "Top scorer" not in meta(allpages["t/red-lions.html"], "name", "description"), meta(allpages["t/red-lions.html"], "name", "description"))
ok("a league whose scoring leader is a minor names none", "leads the scoring" not in meta(allpages["l/test-league.html"], "name", "description"), meta(allpages["l/test-league.html"], "name", "description"))
ok("no title is used twice across every player, club, league and game page", len({title_of(x) for x in allpages.values()}) == len(allpages),
   [k for k, v in allpages.items() if sorted(title_of(x) for x in allpages.values()).count(title_of(v)) > 1][:4])
ok("every title fits (<= 65 wide) and every description is 60-300 characters", all(B.width(title_of(x)) <= 65 and 60 <= len(meta(x, "name", "description")) <= 300 for x in allpages.values()),
   [title_of(x) for x in allpages.values() if B.width(title_of(x)) > 65][:3])
ok("every page has one canonical that is its own file, og:title/description/url/image and a twitter card, and a robots line",
   all(x.count('rel="canonical"') == 1 and meta(x, "property", "og:image") and meta(x, "property", "og:title") == title_of(x)
       and meta(x, "name", "twitter:card") in ("summary", "summary_large_image") and meta(x, "name", "robots") == B.ROBOTS
       and f'rel="canonical" href="{B.ORIGIN}/epinoia/{k}"' in x for k, x in allpages.items()))
allld = [(k, o) for k, x in allpages.items() for o in lds_of(x)]
ok("every JSON-LD block of every page parses and passes the shape checks", all(not problems(o) for _k, o in allld), [(k, problems(o)) for k, o in allld if problems(o)][:3])
sl = [l_ for l_ in re.findall(r"<loc>(.*?)</loc>", read(rout, "epinoia", "sitemap-entities.xml"))]
ok("every written page (player, club, league, game) is in a sitemap, and the sitemaps hold nothing that was not written",
   set(sl) | set(gs_locs) >= {f"{B.ORIGIN}/epinoia/{k}" for k in allpages} and all(u.startswith(B.ORIGIN + "/epinoia/") for u in sl + gs_locs))
lm = re.findall(r"<lastmod>(.*?)</lastmod>", read(rout, "epinoia", "sitemap-entities.xml"))
ok("entity <lastmod> comes from the standings' timestamps (ISO 8601), and a club with no row falls back to the newest one",
   lm and all(dt.datetime.fromisoformat(x) for x in lm) and "2026-09-29T20:35:50+00:00" in lm, lm[:3])

print("\n-- the rich build: the entity markup")
pl = allpages["p/ana-garcia-nunez.html"]
pj = [o for o in lds_of(pl) if o["@type"] == "Person"][0]
ok("a player with an approved photograph: image in the Person and in og:image/twitter:image, with alt text", pj.get("image") == f"{SUPA}/storage/v1/object/public/media-public/player/p2/photo-1.webp"
   and meta(pl, "property", "og:image") == pj["image"] and meta(pl, "name", "twitter:image") == pj["image"] and "García-Núñez" in meta(pl, "property", "og:image:alt"), pj)
ok("...his height is not asserted when it is not credible (20 cm), and a player with none has none", "height" not in pj and "height" not in lds_of(allpages["p/jordan-reed.html"] if "p/jordan-reed.html" in allpages else pl)[0])
jr = [k for k in allpages if k.startswith("p/jordan-reed")]
h198 = [o for k in jr for o in lds_of(allpages[k]) if o["@type"] == "Person" and o.get("height")]
ok("a public height is a QuantitativeValue in centimetres", h198 and h198[0]["height"] == {"@type": "QuantitativeValue", "value": 198, "unitCode": "CMT", "unitText": "cm"}, h198)
ok("the Person names his club (memberOf and affiliation, with the crest) and carries the stat line as its description",
   pj["memberOf"]["name"] == "Blue Hawks" and pj["affiliation"] == pj["memberOf"] and "12.5 points" in pj["description"] and pj["description"] == meta(pl, "name", "description"), pj)
ok("a player with no photograph: the club's crest in the preview when there is one, else the share image",
   meta(allpages[jr[0]], "property", "og:image") is not None and meta(allpages["p/marc-verstraete.html"], "property", "og:image") == f"{B.ORIGIN}/epinoia/brand/epinoia-share-1200x630.png"
   and meta(allpages["p/marc-verstraete.html"], "name", "twitter:card") == "summary_large_image" and meta(allpages["p/marc-verstraete.html"], "property", "og:image:width") == "1200")
ok("a player's description leads with the answer (averages, games, league, season) and the shooting split when there are attempts",
   re.match(r"Ana García-Núñez \(Blue Hawks\) averages 12\.5 points, 5\.1 rebounds and 3\.2 assists in 10 games of Test League 2026-27, shooting 44% FG and 33% from three", meta(pl, "name", "description")), meta(pl, "name", "description"))
tp = allpages["t/red-lions.html"]
tj = [o for o in lds_of(tp) if o["@type"] == "SportsTeam"][0]
ok("a club: crest as logo and image, home ground as a Place with its city and country, the league with its logo",
   tj["logo"].endswith("team/t1/logo-1.webp") and tj["location"] == {"@type": "Place", "name": "Red Dome", "address": {"@type": "PostalAddress", "addressLocality": "Testville", "addressCountry": "GB"}}
   and tj["memberOf"]["logo"].endswith("league/l1/logo-1.webp") and meta(tp, "property", "og:image") == tj["logo"], tj)
ok("...its record and place in the table lead the description", meta(tp, "name", "description").startswith("Red Lions: 7-3 and 2nd in Test League 2026-27."), meta(tp, "name", "description"))
ok("...athletes: named players only, best scorers first, none of them a minor, at most 15",
   1 <= len(tj["athlete"]) <= B.MAX_ATHLETES and all(a["url"].startswith(B.ORIGIN + "/epinoia/p/") for a in tj["athlete"]) and "Minorson" not in json.dumps(tj), tj["athlete"])
hj = [o for o in lds_of(allpages["t/blue-hawks.html"]) if o["@type"] == "SportsTeam"][0]
ok("a club whose ground is only a name: a Place with no invented address", hj["location"] == {"@type": "Place", "name": "Hawk Nest"} and meta(allpages["t/blue-hawks.html"], "property", "og:image") == "https://images.example.com/hawks.jpg", hj.get("location"))
ok("a club's description names its top scorers when the leading run may be named", "Top scorer" in meta(allpages["t/blue-hawks.html"], "name", "description") and "ppg" in meta(allpages["t/blue-hawks.html"], "name", "description"),
   meta(allpages["t/blue-hawks.html"], "name", "description"))
lp = allpages["l/test-league.html"]
lo_ = [o for o in lds_of(lp) if o["@type"] == "SportsOrganization"][0]
ok("a league: logo, country (areaServed), member clubs with crests, and an ItemList of its clubs",
   lo_["logo"].endswith("league/l1/logo-1.webp") and lo_["areaServed"] == [{"@type": "Country", "name": "United Kingdom"}] and len(lo_["member"]) == 4,
   lo_.get("member"))
ok("...the ItemList counts the same clubs", any(o["@type"] == "ItemList" and o["numberOfItems"] == len(lo_["member"]) for o in lds_of(lp)))
ok("...the table leader is named in the description", "Blue Hawks lead the table." in meta(lp, "name", "description"), meta(lp, "name", "description"))
ok("a league's own page has an image (its logo), and a league with none the share image", meta(lp, "property", "og:image").endswith("league/l1/logo-1.webp")
   and meta(allpages["l/second-league.html"], "property", "og:image").endswith("epinoia-share-1200x630.png"))

print("\n-- the cap, the order, and failing safe with games")
import contextlib
old = (B.MAX_GAMES, B.MAX_FINALS)
B.MAX_GAMES, B.MAX_FINALS = 3, 2
try:
    picked = [g["id"] for g in B.pick_games(B.Model([LG1r], COMPS_R, TEAMS_R, STATS_R), [dict(g) for g in GAMES], NOW)]
finally:
    B.MAX_GAMES, B.MAX_FINALS = old
ok("the cap holds (3), live first, then the newest finals and soonest fixtures sharing what is left", picked[0] == "G3" and len(picked) == 3 and picked[1:] == ["G1", "G11"], picked)
ok("with no games at all the build still succeeds, writes no game pages and no games sitemap",
   (lambda o_r: files(o_r[0], "game") == [] and not os.path.exists(os.path.join(o_r[0], "epinoia", "sitemap-games.xml")) and o_r[1]["games"] == 0)(run_rich(games=[])))
ok("the games are ordered so a duplicate row or an unknown team never breaks the build", run_rich(games=GAMES + [dict(GAMES[0]), G("GX", "TZ", "T1", "2026-09-29T18:00:00+00:00", "final", 1, 2)])[1]["games"] == 5)

print("\n-- the site's own pages: heads, structured data, sitemap, robots")
AP = importlib.util.spec_from_file_location("apply_heads", os.path.join(HERE, "apply-page-heads.py"))
H = importlib.util.module_from_spec(AP)
AP.loader.exec_module(H)
seen_t, seen_d = {}, {}
robots = rd("robots.txt")
disallowed = [ln.split(":", 1)[1].strip() for ln in robots.splitlines() if ln.lower().startswith("disallow:")]
for path, rowh in H.PAGES.items():
    pg = rd("epinoia", path, "index.html") if path else rd("epinoia", "index.html")
    hd = head_of(pg)
    tt, dd = title_of(pg), meta(pg, "name", "description")
    label = path or "(front)"
    seen_t.setdefault(tt, []).append(label)
    seen_d.setdefault(dd, []).append(label)
    ok(f"{label}: title, description and canonical match the tool's table, one each", tt == rowh[0] and dd == rowh[1] and hd.count("<title>") == 1
       and hd.count('name="description"') == 1 and hd.count('rel="canonical"') == 1 and f'rel="canonical" href="{B.ORIGIN}/epinoia/{path}"' in hd, tt)
    ok(f"{label}: title <= 65 wide (front page <= 60), description 130-170", B.width(tt) <= (60 if not path else 65) and 130 <= len(dd) <= 170, (len(tt), len(dd)))
    ok(f"{label}: the head is exactly what tools/apply-page-heads.py writes (run it again and nothing changes)", H.block(path, rowh) in pg and H.ld_block(path, rowh) in pg)
    ok(f"{label}: Open Graph (type, site_name, title, description, url, image with size and alt) and a large Twitter card",
       all(meta(pg, "property", k) for k in ("og:type", "og:site_name", "og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height", "og:image:alt"))
       and meta(pg, "property", "og:image") == f"{B.ORIGIN}/epinoia/brand/epinoia-share-1200x630.png" and meta(pg, "name", "twitter:card") == "summary_large_image"
       and meta(pg, "name", "twitter:image"))
    blocks = lds_of(hd)
    ok(f"{label}: structured data parses and passes the shape checks", blocks and all(not problems(o) for o in blocks), [problems(o) for o in blocks if problems(o)])
    ok(f"{label}: no noindex, and it is not a page robots.txt keeps crawlers out of when it says index,follow",
       "noindex" not in hd and ((meta(pg, "name", "robots") == B.ROBOTS) == (not any(("/epinoia/" + path).startswith(d_) for d_ in disallowed if d_ != "/"))), path)
ok("no two entry pages share a title or a description", all(len(v) == 1 for v in list(seen_t.values()) + list(seen_d.values())), [v for v in seen_t.values() if len(v) > 1])
front = rd("epinoia", "index.html")
fl = lds_of(head_of(front))
ok("the front page: WebSite with a SearchAction, Organization (512 px logo, one sameAs), and an ItemList of the sections",
   [o["@type"] for o in fl] == ["WebSite", "Organization", "ItemList"] and fl[1]["logo"]["width"] == 512 and fl[1]["logo"]["height"] == 512
   and len(fl[2]["itemListElement"]) >= 6, [o["@type"] for o in fl])
tmpl = fl[0]["potentialAction"]["target"]["urlTemplate"]
ok("the SearchAction's address really works: HOME opens the search with the words in it (nav.js reads ?q= on /epinoia/home/)",
   tmpl == f"{B.ORIGIN}/epinoia/home/?q={{search_term_string}}" and "get('q')" in rd("epinoia", "nav.js") and r"\/epinoia\/home\/" in rd("epinoia", "nav.js")
   and "preset" in rd("epinoia", "search.js"))
ok("the section pages that are ordinary nav destinations keep their short name for the teletext header (nav.js reads epinoia-page)",
   "epinoia-page" in rd("epinoia", "nav.js") and all(meta(rd("epinoia", p_, "index.html"), "name", "epinoia-page") for p_, r_ in H.PAGES.items() if p_ and r_[2]))
ok("the front page and HOME no longer reset their title in JavaScript", "document.title = 'Epinoia';" not in rd("epinoia", "home.js"))
with open(os.path.join(ROOT, "epinoia", "brand", "epinoia-share-1200x630.png"), "rb") as f:
    hdr = f.read(24)
ok("the share image is a real 1200x630 PNG under 300 KB", hdr[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", hdr[16:24]) == (1200, 630)
   and os.path.getsize(os.path.join(ROOT, "epinoia", "brand", "epinoia-share-1200x630.png")) < 300000)
static_locs = re.findall(r"<loc>(.*?)</loc>", rd("epinoia", "sitemap.xml"))
def page_of(u):   # https://…/epinoia/home/ -> <repo>/epinoia/home/index.html; https://…/ -> <repo>/index.html (the site's front door)
    return os.path.join(ROOT, *[x for x in u[len(B.ORIGIN):].split("/") if x], "index.html")
def read_page(u):
    with open(page_of(u), encoding="utf-8") as f:
        return f.read()
ok("the repository's sitemap (the static entry points) lists no page that is noindex, blocked by robots.txt, or missing",
   all(os.path.exists(page_of(u)) for u in static_locs)
   and not any("noindex" in head_of(read_page(u)) for u in static_locs)
   and not any(("/" + u.split(B.ORIGIN + "/")[1]).startswith(d_) for u in static_locs for d_ in disallowed if d_ not in ("/",)), static_locs)
ok("robots.txt names the sitemap index, which the build writes as epinoia/sitemap.xml", f"Sitemap: {B.ORIGIN}/epinoia/sitemap.xml" in robots)
ok("the pages that must stay out of search still say noindex (admin, invite, embeds, sign-in)",
   all("noindex" in rd("epinoia", *p_.split("/"), "index.html") for p_ in ("admin", "invite", "signin", "embed/game", "embed/table", "prophesy")))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
