"""Search-engine addresses for every player, team and league: the REAL page, with its own head.

    python tools/build-seo.py <site dir>            (the Pages workflow runs it after build-site.py)
    python tools/build-seo.py <site dir> --fixtures <dir>     offline, from JSON files (the tests)

THE PROBLEM. The player, team and league pages (/epinoia/p/?p=, /t/?t=, /l/?l=) are one HTML file each
that fills itself from the database in the browser, so every player shares one title ("Player · Epinoia"),
no description and no structured data, and none of the addresses is anywhere a crawler looks. A search
for a player's name finds nothing of ours.

THE FIX IS NOT ANOTHER KIND OF PAGE. What a visitor should land on is the full page, so that is what is
written: for each player a copy of epinoia/p/index.html at /epinoia/p/<name>.html (a team: t/<slug>.html, a
league: l/<slug>.html) whose <head> carries that entity's title, description, canonical address, link
preview and JSON-LD, and a <meta name="epinoia-entity"> naming who it is (p/player.js, t/team.js and
l/league.js read it when the address has no ?p= / ?t= / ?l=). The copy sits in the SAME folder as the page
it copies on purpose: every relative link, script and stylesheet resolves exactly as before, and nav.js,
which finds its way back to /epinoia/ by counting folders, still finds it. Nothing else changes: the body,
the scripts, the rail, the theme.

All of them are listed in /epinoia/sitemap.xml with the site's own entry points, which is how a search
engine finds them.

WHO IS NOT HERE. Read with the public (anon) key - exactly what any visitor can read - so a private or
members-only league is never here. Nobody flagged as a minor (player_season_stats.is_minor) gets an address
at all, not even one the site names on its own pages, and a name the database has masked ("#14", or none)
gets none. A page nobody asked for on a search engine is not one to make for a child. Change that rule
here and in tools/build_seo_test.py, deliberately.

COVERAGE. Every public league and every team of one gets an address. A player gets one once he has a
finished game (player_season_stats is where the public database keeps players); the summary line says how
many were written and how many were left out and why, and the test checks that no eligible player is missing.

FAILING SAFE. A deploy replaces the whole site, so a night on which the database could not be read must not
deploy a site with no player pages. Reads are retried, and fewer than --min-players players is treated as a
failure (exit 1), so the workflow falls back to the last good copy (see pages.yml).

Standard library only: the runner may be a bare VPS.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://prophesyscouting.co.uk"
BASE = "/epinoia"
SITE_NAME = "Epinoia"
STAT_COLS = ("season_id,competition_id,player_id,team_id,gp,min,ppg,rpg,apg,pts,reb,ast,stl,blk,fgm,fga,"
             "p3m,p3a,ftm,fta,first_name,last_name,player_slug,is_minor,team_name,team_slug,jersey")

COUNTRY = {
    "AU": "Australia", "BE": "Belgium", "BG": "Bulgaria", "CA": "Canada", "CZ": "Czechia", "DE": "Germany",
    "ES": "Spain", "EU": "Europe", "FI": "Finland", "FR": "France", "GB": "United Kingdom", "GR": "Greece",
    "IE": "Ireland", "IT": "Italy", "JP": "Japan", "LT": "Lithuania", "MX": "Mexico", "NL": "Netherlands",
    "PL": "Poland", "SK": "Slovakia", "US": "United States", "XK": "Kosovo", "XB": "the Balkans",
    "HR": "Croatia", "RS": "Serbia", "SI": "Slovenia", "BA": "Bosnia and Herzegovina", "ME": "Montenegro",
    "MK": "North Macedonia", "AL": "Albania", "HU": "Hungary", "RO": "Romania", "TR": "Turkey", "IL": "Israel",
    "PT": "Portugal", "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "IS": "Iceland", "AT": "Austria",
    "CH": "Switzerland", "EE": "Estonia", "LV": "Latvia", "UA": "Ukraine", "BR": "Brazil", "AR": "Argentina",
    "NZ": "New Zealand", "KR": "South Korea", "CN": "China", "PH": "Philippines", "TW": "Taiwan",
}

# The language a league's own country reads, for the extra copies at /epinoia/<lang>/l/ and /epinoia/<lang>/t/
# (Japan and Spain only, and only their leagues and clubs). The page then opens in that language, and the
# title and description a search engine shows are written in it.
LANG_OF_COUNTRY = {"JP": "ja", "ES": "es"}
OG_LOCALE = {"ja": "ja_JP", "es": "es_ES"}
COUNTRY_LOCAL = {"ja": {"JP": "日本"}, "es": {"ES": "España"}}
# what people search a league as, where it is not the name the site holds
NATIVE_NAME = {
    "ja": {"B.LEAGUE Premier": "Bリーグ", "B.LEAGUE One": "Bリーグ", "W League Premier": "Wリーグ", "W League Future": "Wリーグ"},
    "es": {"Liga Endesa": "Liga ACB", "Liga Femenina Endesa": "Liga Femenina", "Primera FEB": "Primera Federación",
           "Segunda FEB": "Segunda Federación"},
}


def lang_of(lg) -> str:
    """'ja' or 'es' for a league whose country is exactly Japan or Spain, else ''."""
    return LANG_OF_COUNTRY.get(str((lg or {}).get("country") or ""), "")


def shown(lang: str, name: str) -> str:
    """A league's name as its own country's fans write it: 'B.LEAGUE Premier（Bリーグ）'."""
    nat = NATIVE_NAME.get(lang, {}).get(name)
    if not nat or nat.lower() in name.lower():
        return name
    return f"{name}（{nat}）" if lang == "ja" else f"{name} ({nat})"



# ============================================================================ reading the database
def read_config() -> tuple[str, str]:
    """The public URL and anon key the site's own pages use: one source, never copied here."""
    with open(os.path.join(ROOT, "epinoia", "config.js"), encoding="utf-8") as f:
        src = f.read()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", src)
    key = re.search(r"supabaseAnonKey:\s*'([^']+)'", src)
    if not (url and key):
        raise SystemExit("build-seo: supabaseUrl / supabaseAnonKey not found in epinoia/config.js")
    return url.group(1).rstrip("/"), key.group(1)


class Reader:
    """Paged, retried reads of the public REST API."""

    def __init__(self, url: str, key: str):
        self.url, self.key = url, key

    def get(self, path: str, params: dict, page: int = 1000) -> list:
        out, off = [], 0
        while True:
            q = urllib.parse.urlencode(params, safe=",().*")
            req = urllib.request.Request(f"{self.url}/rest/v1/{path}?{q}", headers={
                "apikey": self.key, "Accept": "application/json", "Range-Unit": "items",
                "Range": f"{off}-{off + page - 1}", "User-Agent": "EpinoiaSeoBuild/1.0"})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(req, timeout=90) as r:
                        rows = json.load(r)
                    break
                except Exception as exc:                       # noqa: BLE001 - retried, then reported
                    if attempt == 3:
                        raise SystemExit(f"build-seo: {path} failed at {off}: {exc}")
                    time.sleep(2 * (attempt + 1))
            out += rows
            if len(rows) < page:
                return out
            off += page


class Fixtures:
    """The same reads from JSON files (tests)."""

    def __init__(self, folder: str):
        self.folder = folder

    def get(self, path: str, params: dict, page: int = 1000) -> list:
        with open(os.path.join(self.folder, path + ".json"), encoding="utf-8") as f:
            return json.load(f)


# ============================================================================ the model
def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def person_name(r: dict) -> str:
    return re.sub(r"\s+", " ", f"{r.get('first_name') or ''} {r.get('last_name') or ''}").strip()


def nameable(r: dict) -> bool:
    """A row that may have an address: not a minor, and a real name (the database masks a withheld one)."""
    n = person_name(r)
    return bool(n) and not r.get("is_minor") and "#" not in n and bool(r.get("player_slug"))


def num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fmt1(v) -> str:
    return f"{num(v):.1f}"


class Model:
    def __init__(self, leagues, competitions, teams, stats):
        self.leagues = {l["id"]: l for l in leagues if l.get("slug") and l.get("name")}
        self.comp = {}                                   # competition id -> {name, season, starts, league_id}
        for c in competitions:
            s = c.get("seasons") or {}
            lg = (s.get("leagues") or {})
            self.comp[c["id"]] = {"name": c.get("name") or "", "season": s.get("name") or "",
                                  "starts": s.get("starts_on") or "", "league_id": lg.get("id")}
        # a team of a public league only (RLS already hides the others; this states it)
        self.teams = {t["id"]: t for t in teams if t.get("slug") and t.get("name") and t.get("league_id") in self.leagues}
        by_player = defaultdict(list)
        dropped = set()
        for r in stats:
            if not nameable(r):
                dropped.add(r["player_id"])
            by_player[r["player_id"]].append(r)
        people = []
        for pid, rows in by_player.items():
            if pid in dropped:
                continue
            rows.sort(key=lambda r: (self.comp.get(r["competition_id"], {}).get("starts", ""), r["season_id"]), reverse=True)
            people.append({"id": pid, "name": person_name(rows[0]), "rows": rows})
        # THE ADDRESS IS THE NAME ("/p/nicklaus-william-reid.html"), not the database slug, which starts with
        # the club and changes when he moves. Two people with one name get the club added, then the id.
        people.sort(key=lambda p: (p["name"].lower(), p["id"]))
        base = defaultdict(list)
        for p in people:
            base[slugify(p["name"])[:80] or p["id"][:8]].append(p)
        used, self.players = set(), {}
        for slug, group in base.items():
            for p in group:
                s = slug
                if len(group) > 1:
                    s = f"{slug}-{slugify(p['rows'][0].get('team_name') or '')}"[:90].rstrip("-")
                if s in used:
                    s = f"{s}-{p['id'][:6]}"
                used.add(s)
                p["slug"] = s
                self.players[p["id"]] = p
        self.dropped = len(dropped)
        # each team's slug is unique in its address; a repeat across leagues gets the league added
        seen = set()
        for t in sorted(self.teams.values(), key=lambda t: (t["slug"], t["id"])):
            s = slugify(t["slug"]) or t["id"][:8]
            if s in seen:
                s = f"{s}-{slugify(self.leagues[t['league_id']]['slug'])}"
            if s in seen:
                s = f"{s}-{t['id'][:6]}"
            seen.add(s)
            t["file"] = s
        self.team_rows = defaultdict(list)
        for p in self.players.values():
            for r in p["rows"]:
                self.team_rows[r["team_id"]].append(r)

    def league_of_comp(self, comp_id):
        return self.leagues.get((self.comp.get(comp_id) or {}).get("league_id"))


# ============================================================================ the head of each address
def esc(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=True)


def ld(obj) -> str:
    """JSON-LD for a <script>: '<' escaped so no value can close the tag."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:- ") + "…"


def width(s: str) -> int:
    """Display width: a full-width (Japanese) character takes two places, as it does in a search result."""
    return sum(2 if ord(c) >= 0x2E80 else 1 for c in s)


def fit_title(options: list, limit: int = 65) -> str:
    """The first title that fits (a search result shows about 60 characters): the fullest wording that
    still ends with the brand, and only as a last resort a clipped one."""
    for t in options:
        if width(t) <= limit:
            return t
    return clip(options[-1], limit)


def breadcrumb(items) -> dict:
    """[(label, path or None)] -> BreadcrumbList JSON-LD."""
    out = []
    for i, (label, path) in enumerate(items, start=1):
        item = {"@type": "ListItem", "position": i, "name": label}
        if path:
            item["item"] = ORIGIN + path
        out.append(item)
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": out}


def league_path(m: Model, lg, lang: str = "") -> str:
    return f"{BASE}/{lang + '/' if lang else ''}l/{slugify(lg['slug'])}.html"


def team_path(t: dict, lang: str = "") -> str:
    return f"{BASE}/{lang + '/' if lang else ''}t/{t['file']}.html"


def player_head(m: Model, p: dict) -> dict:
    cur = p["rows"][0]
    c = m.comp.get(cur["competition_id"], {})
    lg = m.league_of_comp(cur["competition_id"])
    team, league = cur.get("team_name") or "", (lg or {}).get("name") or c.get("name") or ""
    name = p["name"]
    title = fit_title([f"{name} – {team}, {league} stats | {SITE_NAME}", f"{name} – {team} stats | {SITE_NAME}",
                       f"{name} – {league} stats | {SITE_NAME}", f"{name} stats | {SITE_NAME}"] if team else
                      [f"{name} – {league} stats | {SITE_NAME}", f"{name} stats | {SITE_NAME}"])
    gp = num(cur["gp"])
    if gp > 0:
        d = (f"{name}{' (' + team + ')' if team else ''} averages {fmt1(cur['ppg'])} points, {fmt1(cur['rpg'])} rebounds and "
             f"{fmt1(cur['apg'])} assists in {int(gp)} {'game' if gp == 1 else 'games'} of {league} {c.get('season', '')}. "
             f"Season stats, game log and shot chart on {SITE_NAME}.")
    else:
        d = f"{name}{' plays for ' + team if team else ''} in {league} {c.get('season', '')}. Season stats and game log on {SITE_NAME}."
    path = f"{BASE}/p/{p['slug']}.html"
    team_obj = m.teams.get(cur["team_id"])
    trail = [(SITE_NAME, f"{BASE}/home/")]
    if lg:
        trail.append((league, league_path(m, lg)))
    if team_obj:
        trail.append((team, team_path(team_obj)))
    trail.append((name, None))
    person = {"@context": "https://schema.org", "@type": "Person", "name": name, "jobTitle": "Basketball player",
              "url": ORIGIN + path, "mainEntityOfPage": ORIGIN + path}
    if team:
        person["memberOf"] = {"@type": "SportsTeam", "name": team, "sport": "Basketball",
                              **({"url": ORIGIN + team_path(team_obj)} if team_obj else {})}
    return {"title": title, "desc": clip(d, 300), "path": path, "entity": p["id"], "og": "profile",
            "ld": [person, breadcrumb(trail)]}


def latest_rows(m: Model, rows: list) -> list:
    """The rows of the newest season among them (by the season's start date)."""
    if not rows:
        return []
    best = max(m.comp.get(r["competition_id"], {}).get("starts", "") for r in rows)
    return [r for r in rows if m.comp.get(r["competition_id"], {}).get("starts", "") == best]


def alts(path_by_lang: dict) -> list:
    """The same page in each language, for hreflang: [(code, absolute url)], x-default being the English one."""
    out = [(c, ORIGIN + p) for c, p in path_by_lang.items()]
    out.append(("x-default", ORIGIN + path_by_lang["en"]))
    return out


def team_head(m: Model, t: dict, lang: str = "") -> dict:
    cur = latest_rows(m, m.team_rows.get(t["id"], []))
    lg = m.leagues.get(t["league_id"])
    lname = (lg or {}).get("name") or ""
    league = shown(lang, lname) if lang else lname
    season = (m.comp.get(cur[0]["competition_id"], {}) if cur else {}).get("season", "")
    name = t["name"]
    n = len({r["player_id"] for r in cur})
    limit = 65
    if lang == "ja":
        opts = [f"{name}｜{league}のロスターと成績 | {SITE_NAME}", f"{name}｜{lname}のロスターと成績 | {SITE_NAME}",
                f"{name}｜{lname} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name}の{league} {season}：所属{n}選手のロスター、1試合平均の得点・リバウンド・アシスト、試合日程・結果、順位表を{SITE_NAME}で。" if n else
             f"{name}の{league}での試合日程・結果、順位表、選手成績を{SITE_NAME}で。")
    elif lang == "es":
        opts = [f"{name} – plantilla y estadísticas de {league} | {SITE_NAME}", f"{name} – plantilla y estadísticas | {SITE_NAME}",
                f"{name} – {lname} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name} en {league} {season}: plantilla, puntos, rebotes y asistencias por partido de {n} jugadores, "
             f"más calendario, resultados y clasificación en {SITE_NAME}." if n else
             f"{name} en {league}: calendario, resultados, clasificación y estadísticas de jugadores en {SITE_NAME}.")
    else:
        opts = [f"{name} – {league} roster and stats | {SITE_NAME}", f"{name} – {league} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name} in {league} {season}: roster, points, rebounds and assists per game for {n} players, "
             f"plus fixtures, results and standings on {SITE_NAME}." if n else
             f"{name} in {league}: fixtures, results, standings and player statistics on {SITE_NAME}.")
    title = fit_title(opts, limit)
    path = team_path(t, lang)
    org = {"@context": "https://schema.org", "@type": "SportsTeam", "name": name, "sport": "Basketball", "url": ORIGIN + path}
    if lang:
        org["inLanguage"] = lang
    if lg:
        org["memberOf"] = {"@type": "SportsOrganization", "name": lname, "sport": "Basketball", "url": ORIGIN + league_path(m, lg, lang)}
    trail = [(SITE_NAME, f"{BASE}/home/")] + ([(lname, league_path(m, lg, lang))] if lg else []) + [(name, None)]
    h = {"title": title, "desc": clip(d, 300), "path": path, "entity": t["id"], "og": "website",
         "ld": [org, breadcrumb(trail)], "lang": lang, "base": f"{BASE}/t/" if lang else ""}
    if lang_of(lg):
        h["alts"] = alts({"en": team_path(t), lang_of(lg): team_path(t, lang_of(lg))})
    return h


def league_head(m: Model, lg: dict, lang: str = "") -> dict:
    lname = lg["name"]
    name = shown(lang, lname) if lang else lname
    codes = str(lg.get("country") or "").split("+")
    country = " and ".join(COUNTRY[c] for c in codes if c in COUNTRY)
    if lang:
        country = COUNTRY_LOCAL[lang].get(codes[0], country)
    clubs = [t for t in m.teams.values() if t["league_id"] == lg["id"]]
    rows = [r for t in clubs for r in m.team_rows.get(t["id"], [])]
    cur = latest_rows(m, rows)
    season = (m.comp.get(cur[0]["competition_id"], {}) if cur else {}).get("season", "")
    limit = 65
    if lang == "ja":
        opts = [f"{name}｜日程・順位表・選手成績 | {SITE_NAME}", f"{name}｜日程・順位表 | {SITE_NAME}", f"{lname}｜日程・順位表・成績 | {SITE_NAME}",
                f"{lname}｜日程と成績 | {SITE_NAME}", f"{lname} | {SITE_NAME}"]
        d = (f"{name}の試合日程・結果、順位表、ボックススコア、選手成績{'（' + season + '）' if season else ''}"
             f"を{'全' + str(len(clubs)) + 'クラブ分、' if clubs else ''}{SITE_NAME}で。")
    elif lang == "es":
        opts = [f"{name} – calendario, clasificación y estadísticas | {SITE_NAME}", f"{lname} – calendario y estadísticas | {SITE_NAME}",
                f"{lname} | {SITE_NAME}"]
        d = (f"{name}{' (' + country + ')' if country else ''} en {SITE_NAME}: calendario y resultados, clasificación, boxscores "
             f"y estadísticas de jugadores{' de la temporada ' + season if season else ''}{' de ' + str(len(clubs)) + ' clubes' if clubs else ''}.")
    else:
        opts = [f"{name} – fixtures, standings and player stats | {SITE_NAME}", f"{name} – fixtures and stats | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name}{' (' + country + ')' if country else ''} on {SITE_NAME}: fixtures and results, standings, box scores "
             f"and player statistics{' for ' + season if season else ''}{' across ' + str(len(clubs)) + ' clubs' if clubs else ''}.")
    title = fit_title(opts, limit)
    path = league_path(m, lg, lang)
    org = {"@context": "https://schema.org", "@type": "SportsOrganization", "name": lname, "sport": "Basketball", "url": ORIGIN + path}
    nat = NATIVE_NAME.get(lang, {}).get(lname) if lang else None
    if nat:
        org["alternateName"] = nat
    if lang:
        org["inLanguage"] = lang
    h = {"title": title, "desc": clip(d, 300), "path": path, "entity": lg["slug"], "og": "website",
         "ld": [org, breadcrumb([(SITE_NAME, f"{BASE}/home/"), (lname, None)])], "lang": lang, "base": f"{BASE}/l/" if lang else ""}
    if lang_of(lg):
        h["alts"] = alts({"en": league_path(m, lg), lang_of(lg): league_path(m, lg, lang_of(lg))})
    return h


def bake(shell: str, h: dict) -> str:
    """The full page's own HTML with this entity's head. The description, canonical and link-preview tags
    are replaced if the page has any and added if not; nothing else in the page is touched."""
    url = ORIGIN + h["path"]
    s = re.sub(r'<meta[^>]*\bname="(?:description|epinoia-entity)"[^>]*>\s*', "", shell)
    s = re.sub(r'<link[^>]*\brel="canonical"[^>]*>\s*', "", s)
    s = re.sub(r'<meta[^>]*\bproperty="og:[^"]*"[^>]*>\s*', "", s)
    s = re.sub(r'<meta[^>]*\bname="twitter:[^"]*"[^>]*>\s*', "", s)
    lang = h.get("lang") or ""
    extra = ""
    if lang:
        # a copy one folder down: its relative links and scripts are the page's own through <base>; the
        # language is stated for the page itself (i18n.js reads epinoia-lang) and for the crawler
        s = re.sub(r'<html lang="[^"]*"', f'<html lang="{lang}"', s, count=1)
        extra = (f'<base href="{esc(h["base"])}">\n<meta name="epinoia-lang" content="{lang}">\n'
                 f'<meta property="og:locale" content="{OG_LOCALE[lang]}">\n')
    hre = "".join(f'<link rel="alternate" hreflang="{c}" href="{esc(u)}">\n' for c, u in h.get("alts", []))
    block = (extra + f'<title>{esc(h["title"])}</title>\n'
             f'<meta name="description" content="{esc(h["desc"])}">\n'
             f'<link rel="canonical" href="{esc(url)}">\n'
             f'<meta name="epinoia-entity" content="{esc(h["entity"])}">\n'
             f'<meta property="og:type" content="{h["og"]}">\n<meta property="og:site_name" content="{SITE_NAME}">\n'
             f'<meta property="og:title" content="{esc(h["title"])}">\n<meta property="og:description" content="{esc(h["desc"])}">\n'
             f'<meta property="og:url" content="{esc(url)}">\n'
             + hre +
             f'<meta property="og:image" content="{ORIGIN}{BASE}/brand/epinoia-mark-512.png">\n<meta name="twitter:card" content="summary">\n'
             + "".join(f'<script type="application/ld+json">{ld(o)}</script>\n' for o in h["ld"]))
    out, n = re.subn(r"<title>.*?</title>\s*", lambda _m: block, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("build-seo: a page shell has no <title> to replace")
    return out


# ============================================================================ writing
def write(site: str, path: str, text: str) -> None:
    out = os.path.join(site, path.strip("/").replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def sitemap(site: str, urls: list) -> int:
    """The site's own entry points (epinoia/sitemap.xml in the repository) plus every address written here."""
    entries = []
    src = os.path.join(ROOT, "epinoia", "sitemap.xml")
    if os.path.exists(src):
        with open(src, encoding="utf-8") as f:
            text = f.read()
        for blk in re.findall(r"<url>(.*?)</url>", re.sub(r"<!--.*?-->", "", text, flags=re.S), flags=re.S):
            loc = re.search(r"<loc>(.*?)</loc>", blk)
            if loc:
                entries.append(f"<url><loc>{loc.group(1)}</loc>" + "".join(
                    f"<{k}>{v}</{k}>" for k, v in re.findall(r"<(changefreq|priority)>(.*?)</\1>", blk)) + "</url>")
    have = {re.search(r"<loc>(.*?)</loc>", e).group(1) for e in entries}
    for u in urls:
        if ORIGIN + u not in have:
            entries.append(f"<url><loc>{esc(ORIGIN + u)}</loc></url>")
    if len(entries) > 50000:
        raise SystemExit("build-seo: over 50,000 URLs - split the sitemap (an index of sitemaps) before this many pages")
    out = os.path.join(site, "epinoia", "sitemap.xml")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(entries) + "\n</urlset>\n")
    return len(entries)


def shells() -> dict:
    out = {}
    for kind in ("p", "t", "l"):
        with open(os.path.join(ROOT, "epinoia", kind, "index.html"), encoding="utf-8") as f:
            out[kind] = f.read()
    return out


def build(site: str, source, min_players: int, min_teams: int = 50, min_leagues: int = 5) -> dict:
    leagues = source.get("leagues", {"select": "id,slug,name,country", "visibility": "eq.public", "order": "name"})
    comps = source.get("competitions", {"select": "id,name,seasons(id,name,starts_on,leagues(id,name,slug))"})
    teams = source.get("teams", {"select": "id,slug,name,short_name,league_id"})
    stats = source.get("player_season_stats", {"select": STAT_COLS, "order": "player_id.asc,season_id.asc,competition_id.asc"})
    m = Model(leagues, comps, teams, stats)
    if len(m.players) < min_players or len(m.teams) < min_teams or len(m.leagues) < min_leagues:
        raise SystemExit(f"build-seo: read {len(m.players)} players, {len(m.teams)} teams, {len(m.leagues)} leagues "
                         f"(need {min_players}, {min_teams}, {min_leagues}) - not publishing a thin site")
    sh = shells()
    urls = []
    for lg in m.leagues.values():
        h = league_head(m, lg)
        write(site, h["path"], bake(sh["l"], h))
        urls.append(h["path"])
    for lg in m.leagues.values():
        if lang_of(lg):
            h = league_head(m, lg, lang_of(lg))
            write(site, h["path"], bake(sh["l"], h))
            urls.append(h["path"])
    for t in m.teams.values():
        h = team_head(m, t)
        write(site, h["path"], bake(sh["t"], h))
        urls.append(h["path"])
        lang = lang_of(m.leagues.get(t["league_id"]))
        if lang:
            h = team_head(m, t, lang)
            write(site, h["path"], bake(sh["t"], h))
            urls.append(h["path"])
    for p in m.players.values():
        h = player_head(m, p)
        write(site, h["path"], bake(sh["p"], h))
        urls.append(h["path"])
    n = sitemap(site, urls)
    return {"players": len(m.players), "left_out_minor_or_masked": m.dropped, "teams": len(m.teams),
            "leagues": len(m.leagues), "sitemap_urls": n}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("site")
    ap.add_argument("--fixtures")
    ap.add_argument("--min-players", type=int, default=500)
    ap.add_argument("--min-teams", type=int, default=50)
    ap.add_argument("--min-leagues", type=int, default=5)
    a = ap.parse_args()
    if a.fixtures:
        get = Fixtures(a.fixtures).get
    else:
        url, key = read_config()
        get = Reader(url, key).get

    class Source:
        def get(self, name, params):
            return get(name, params)

    res = build(a.site, Source(), a.min_players, a.min_teams, a.min_leagues)
    print("build-seo:", json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
