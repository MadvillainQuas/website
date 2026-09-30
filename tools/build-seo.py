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

GAMES. The box score page (/epinoia/game/?g=<id>) is one file too, and the most searched thing there is, so it
gets the same treatment: for the games of PUBLIC leagues in a bounded window (finals of the last 30 days, live
games, and games scheduled within the next 30 days; at most MAX_GAMES, live first, then the newest finals and
the soonest fixtures) a copy of epinoia/game/index.html at /epinoia/game/<id>.html, its head naming the two
clubs, the league, the date and - only for a final - the score, with SportsEvent structured data. A live or
scheduled game says so and never shows a score it does not have. game/game.js reads the id from
<meta name="epinoia-entity"> when the address has no ?g=. Games are a nicety: a night on which they cannot be
read writes no game pages (and says so) instead of failing the deploy.

THE SITEMAP is an index (sitemap.xml) of three files: sitemap-static.xml (the site's own entry points, from
epinoia/sitemap.xml in the repository), sitemap-entities.xml (leagues, clubs, players, with the hreflang
alternates of the Japanese and Spanish copies) and sitemap-games.xml. Every address has a <lastmod> taken from
the data (a club's standings row, a game's finish), never the build clock alone.

RICHER MARKUP, ONLY FROM WHAT IS PUBLIC. A player's Person carries a photograph only when a moderated (approved)
upload exists, a height only when the profile holds one, his club and league; a club's SportsTeam its crest,
up to 15 athletes, league, home venue; a league its logo, clubs and country. Every entity has a link-preview
picture (its own crest / photo / logo, else the site's 1200x630 share image). Everything below is behind the
minor rule: a minor is not a page, not a name in a list, not a top scorer, and not the reason someone else is
named "top scorer" (a run of leaders stops at the first person who may not be named).

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
import datetime as dt
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
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://prophesyscouting.co.uk"
BASE = "/epinoia"
SITE_NAME = "Epinoia"
# the picture a link preview falls back on (tools/build-share-image.py), and what a crawler is told it may do with a page
SHARE_IMG = "/brand/epinoia-share-1200x630.png"
SHARE_ALT = "EPINOIΛ: live basketball scores, fixtures, standings and advanced stats"
ROBOTS = "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"
MAX_GAMES = 2500                   # hard cap on game pages
MAX_FINALS = 1400                  # of which at most this many finished games (the rest of the room is for fixtures)
WINDOW_DAYS = 30                   # finals of the last 30 days, fixtures of the next 30
LIVE_STALE_H = 36                  # a game "live" for longer than this is a stuck record, not a live game
MAX_ATHLETES = 15                  # players named in a club's structured data
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


def media_url(supa: str, path) -> str | None:
    """A crest, logo or photograph as an absolute https URL, the way epinoia/config.js resolves it: a stored
    upload is a path in the public media bucket, a feed's crest is already an address. Nothing that is not
    https (a browser would block it, and so would a crawler's preview), nothing that is not a picture."""
    p = str(path or "").strip()
    if p.startswith("{"):
        try:
            p = str((json.loads(p) or {}).get("url") or "").strip()
        except ValueError:
            return None
    if not p or p.lower().startswith("http://"):
        return None
    if p.lower().startswith("https://"):
        return p
    return f"{supa}/storage/v1/object/public/media-public/" + "/".join(urllib.parse.quote(x) for x in p.split("/"))


def og_ok(url) -> bool:
    """A link preview cannot draw an SVG (Facebook, X, WhatsApp, iMessage all skip it)."""
    return bool(url) and not re.search(r"\.svg(\?|#|$)", url, re.I)


def iso(v) -> str | None:
    """A database timestamp as ISO 8601 with its offset, or None."""
    try:
        d = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.isoformat(timespec="seconds")


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


class Model:
    def __init__(self, leagues, competitions, teams, stats, standings=(), venues=(), photos=(), profiles=(), supa=""):
        self.supa = supa
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
        # everybody who may not be named, kept ONLY to know whether a leader list has been interrupted by one
        self.unnameable = dropped
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
        self.team_rows = defaultdict(list)               # nameable people only
        self.team_lead = defaultdict(list)               # everybody, to see who leads: (comp, ppg, gp, pid)
        for pid, rows in by_player.items():
            for r in rows:
                self.team_lead[r["team_id"]].append((r["competition_id"], num(r.get("ppg")), num(r.get("gp")), pid))
        for p in self.players.values():
            for r in p["rows"]:
                self.team_rows[r["team_id"]].append(r)
        # standings: (competition, team) -> row; the newest update per team, for <lastmod>
        self.standing = {}
        self.team_updated = {}
        for r in standings:
            self.standing[(r.get("competition_id"), r.get("team_id"))] = r
            u = iso(r.get("updated_at"))
            if u and u > self.team_updated.get(r.get("team_id"), ""):
                self.team_updated[r.get("team_id")] = u
        self.data_ts = max(self.team_updated.values(), default=None)
        self.venue = {v["id"]: v for v in venues if v.get("id")}
        # a photograph: the newest APPROVED upload of a person who may be named (a minor is never here)
        self.photo = {}
        for r in sorted(photos, key=lambda r: str(r.get("created_at") or "")):
            if r.get("owner_id") in self.players and r.get("storage_path"):
                self.photo[r["owner_id"]] = media_url(supa, r["storage_path"])
        self.height = {}
        for r in profiles:
            if r.get("id") in self.players and not r.get("is_minor") and isinstance(r.get("height_cm"), (int, float)) \
                    and 100 <= r["height_cm"] <= 260:
                self.height[r["id"]] = int(r["height_cm"])

    def league_of_comp(self, comp_id):
        return self.leagues.get((self.comp.get(comp_id) or {}).get("league_id"))

    def logo_of_team(self, t):
        return media_url(self.supa, t.get("logo_path"))

    def logo_of_league(self, lg):
        return media_url(self.supa, lg.get("logo_path"))

    def venue_of_team(self, t):
        """(name, city, country) of a club's home ground, if the database knows one."""
        v = self.venue.get(t.get("home_venue_id")) or {}
        name = v.get("name") or t.get("home_venue")
        return (name, v.get("city"), v.get("country")) if name else (None, None, None)

    def leaders(self, team_id, comp_ids, n=3):
        """The team's top scorers of these competitions, as [(name, ppg)] - the LEADING RUN of people who may be
        named: a list that starts with somebody who may not be (a minor, a masked name) is empty, because
        naming the next player 'top scorer' would be false."""
        rows = sorted((x for x in self.team_lead.get(team_id, []) if x[0] in comp_ids and x[2] > 0),
                      key=lambda x: (-x[1], x[3]))
        out, seen = [], set()
        for _c, ppg, _g, pid in rows:
            if pid in seen:
                continue
            seen.add(pid)
            if pid not in self.players or ppg <= 0:
                break
            out.append((self.players[pid]["name"], ppg))
            if len(out) == n:
                break
        return out


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


def best(candidates: list, hi: int = 160) -> str:
    """The richest wording that fits a search result's snippet (about 160 characters); a last resort is clipped."""
    for c in candidates:
        c = re.sub(r"\s+", " ", c).strip()
        if len(c) <= hi:
            return c
    return clip(candidates[-1], hi)


def pct(made, att, floor) -> str | None:
    made, att = num(made), num(att)
    return f"{round(100 * made / att)}%" if att >= floor else None


def player_head(m: Model, p: dict, tag: str = "") -> dict:
    cur = p["rows"][0]
    c = m.comp.get(cur["competition_id"], {})
    lg = m.league_of_comp(cur["competition_id"])
    team, league = cur.get("team_name") or "", (lg or {}).get("name") or c.get("name") or ""
    name = p["name"]
    nm = name + tag                       # tag: " (No. 7)" - told apart from another profile with the very same name and club
    title = fit_title([f"{nm} – {team}, {league} stats | {SITE_NAME}", f"{nm} – {team} stats | {SITE_NAME}",
                       f"{nm} – {league} stats | {SITE_NAME}", f"{nm} stats | {SITE_NAME}"] if team else
                      [f"{nm} – {league} stats | {SITE_NAME}", f"{nm} stats | {SITE_NAME}"])
    gp = num(cur["gp"])
    season = c.get("season", "")
    if gp > 0:
        lead = (f"{name}{' (' + team + ')' if team else ''} averages {fmt1(cur['ppg'])} points, {fmt1(cur['rpg'])} rebounds and "
                f"{fmt1(cur['apg'])} assists in {int(gp)} {'game' if gp == 1 else 'games'} of {league} {season}")
        fg, p3 = pct(cur.get("fgm"), cur.get("fga"), 20), pct(cur.get("p3m"), cur.get("p3a"), 15)
        shoots = []
        if fg and p3:
            shoots = [f", shooting {fg} from the field and {p3} from three", f", shooting {fg} FG and {p3} from three"]
        elif fg:
            shoots = [f", shooting {fg} from the field"]
        cands = []
        for shoot in shoots:
            cands += [f"{lead}{shoot}. Game log, shot chart and career stats on {SITE_NAME}.", f"{lead}{shoot}. Game log and shot chart on {SITE_NAME}.",
                      f"{lead}{shoot}. Stats on {SITE_NAME}.", f"{lead}{shoot}."]
        cands += [f"{lead}. Season stats, game log and shot chart on {SITE_NAME}.",
                  f"{lead}. Stats and game log on {SITE_NAME}.", f"{lead}."]
        d = best(cands)
    else:
        d = best([f"{name}{' plays for ' + team if team else ''} in {league} {season}. Season stats, game log and shot chart on {SITE_NAME}.",
                  f"{name}{' plays for ' + team if team else ''} in {league} {season}. Season stats and game log on {SITE_NAME}."])
    path = f"{BASE}/p/{p['slug']}.html"
    team_obj = m.teams.get(cur["team_id"])
    trail = [(SITE_NAME, f"{BASE}/home/")]
    if lg:
        trail.append((league, league_path(m, lg)))
    if team_obj:
        trail.append((team, team_path(team_obj)))
    trail.append((name, None))
    person = {"@context": "https://schema.org", "@type": "Person", "name": name, "jobTitle": "Basketball player",
              "description": d, "url": ORIGIN + path, "mainEntityOfPage": ORIGIN + path}
    photo = m.photo.get(p["id"])
    if photo:
        person["image"] = photo
    if m.height.get(p["id"]):
        person["height"] = {"@type": "QuantitativeValue", "value": m.height[p["id"]], "unitCode": "CMT", "unitText": "cm"}
    if team:
        tm = {"@type": "SportsTeam", "name": team, "sport": "Basketball",
              **({"url": ORIGIN + team_path(team_obj)} if team_obj else {})}
        if team_obj and m.logo_of_team(team_obj):
            tm["logo"] = m.logo_of_team(team_obj)
        person["memberOf"] = tm
        person["affiliation"] = tm
    # the picture of a link preview: his approved photograph, else his club's crest, else the site's own
    img = photo if og_ok(photo) else (m.logo_of_team(team_obj) if team_obj and og_ok(m.logo_of_team(team_obj)) else None)
    return {"title": title, "desc": d, "path": path, "entity": p["id"], "og": "profile",
            "image": img, "image_alt": f"{name}, {team or league}" if photo and img == photo else (f"{team} crest" if img else ""),
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


def team_head(m: Model, t: dict, lang: str = "", tagged: bool = False) -> dict:
    cur = latest_rows(m, m.team_rows.get(t["id"], []))
    lg = m.leagues.get(t["league_id"])
    lname = (lg or {}).get("name") or ""
    league = shown(lang, lname) if lang else lname
    season = (m.comp.get(cur[0]["competition_id"], {}) if cur else {}).get("season", "")
    name = t["name"]
    n = len({r["player_id"] for r in cur})
    comp_ids = {r["competition_id"] for r in cur}
    # this season's row of the table (the newest competition the club has one in)
    stand = None
    for (cid, tid), row in m.standing.items():
        if tid == t["id"] and (stand is None or m.comp.get(cid, {}).get("starts", "") > m.comp.get(stand["competition_id"], {}).get("starts", "")):
            stand = row
    if stand and not cur:
        season = m.comp.get(stand["competition_id"], {}).get("season", "")
    if stand and comp_ids and stand["competition_id"] not in comp_ids:
        stand = None                                     # a table from another season than the roster: say neither
    limit = 65
    if lang == "ja":
        opts = [f"{name}｜{league}のロスターと成績 | {SITE_NAME}", f"{name}｜{lname}のロスターと成績 | {SITE_NAME}",
                f"{name}｜{lname} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name}の{league} {season}：所属{n}選手のロスター、1試合平均の得点・リバウンド・アシスト、試合日程・結果、順位表を{SITE_NAME}で。" if n else
             f"{name}の{league}での試合日程・結果、順位表、選手成績を{SITE_NAME}で。")
    elif lang == "es":
        opts = [f"{name} – plantilla y estadísticas de {league} | {SITE_NAME}", f"{name} – plantilla y estadísticas | {SITE_NAME}",
                f"{name} – plantilla | {SITE_NAME}", f"{name} – {lname} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        d = (f"{name} en {league} {season}: plantilla, puntos, rebotes y asistencias por partido de {n} jugadores, "
             f"más calendario, resultados y clasificación en {SITE_NAME}." if n else
             f"{name} en {league}: calendario, resultados, clasificación y estadísticas de jugadores en {SITE_NAME}.")
    else:
        opts = [f"{name} – {league} roster and stats | {SITE_NAME}", f"{name} – {league} | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        if tagged:            # another club of the same name (in another league): the league's initials tell them apart
            ini = "".join(w[0] for w in lname.split() if w[0].isalnum()).upper()
            opts = [f"{name} – {league} roster and stats | {SITE_NAME}", f"{name} – {league} | {SITE_NAME}",
                    f"{name} ({ini or lname[:6]}) | {SITE_NAME}", f"{name} | {SITE_NAME}"]
        w, l_ = (int(num(stand.get("w"))), int(num(stand.get("l")))) if stand and num(stand.get("gp")) > 0 else (None, None)
        ranked = int(stand["rank"]) if stand and w is not None and not stand.get("group_name") and stand.get("rank") else None
        rec = "" if w is None else (f": {w}-{l_}" + (f" and {ordinal(ranked)}" if ranked else "") + f" in {league} {season}")
        lead = rec or f" in {league} {season}"
        top = m.leaders(t["id"], comp_ids) if comp_ids else []
        cands = []
        for k in (3, 2, 1, 0):
            sc = top[:k]
            scorers = ""
            if sc:
                scorers = (" Top scorers " if len(sc) > 1 else " Top scorer ") + ", ".join(f"{a} {fmt1(b)} ppg" for a, b in sc) + "."
            for tail in (f" Roster, fixtures, results and standings on {SITE_NAME}.", f" Fixtures and standings on {SITE_NAME}.", ""):
                cands.append(f"{name}{lead}.{scorers}{tail}")
        d = best(cands) if (n or stand) else f"{name} in {league}: fixtures, results, standings and player statistics on {SITE_NAME}."
    title = fit_title(opts, limit)
    path = team_path(t, lang)
    org = {"@context": "https://schema.org", "@type": "SportsTeam", "name": name, "sport": "Basketball", "url": ORIGIN + path}
    org["description"] = clip(d, 300)
    logo = m.logo_of_team(t)
    if logo:
        org["logo"] = logo
        org["image"] = logo
    if lang:
        org["inLanguage"] = lang
    if lg:
        org["memberOf"] = {"@type": "SportsOrganization", "name": lname, "sport": "Basketball", "url": ORIGIN + league_path(m, lg, lang)}
        lgo = m.logo_of_league(lg)
        if lgo:
            org["memberOf"]["logo"] = lgo
    vname, vcity, vcc = m.venue_of_team(t)
    if vname:
        place = {"@type": "Place", "name": vname}
        addr = {k: v for k, v in (("addressLocality", vcity), ("addressCountry", vcc)) if v}
        if addr:
            place["address"] = {"@type": "PostalAddress", **addr}
        org["location"] = place
    # the roster, best scorers first: only people who may be named (nobody flagged as a minor is in m.players at all)
    latest = {}
    for r in cur:
        if num(r["gp"]) > 0 and (r["player_id"] not in latest or num(r["ppg"]) > num(latest[r["player_id"]]["ppg"])):
            latest[r["player_id"]] = r
    roster = sorted(latest.values(), key=lambda r: (-num(r["ppg"]), person_name(r).lower()))[:MAX_ATHLETES]
    ath = [{"@type": "Person", "name": m.players[r["player_id"]]["name"],
            "url": ORIGIN + f"{BASE}/p/{m.players[r['player_id']]['slug']}.html"} for r in roster if r["player_id"] in m.players]
    if ath and not lang and team_ok(m, t):
        org["athlete"] = ath
    trail = [(SITE_NAME, f"{BASE}/home/")] + ([(lname, league_path(m, lg, lang))] if lg else []) + [(name, None)]
    h = {"title": title, "desc": clip(d, 300), "path": path, "entity": t["id"], "og": "website",
         "image": logo if og_ok(logo) else None, "image_alt": f"{name} crest",
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
    # the current competition of the league: its table leader and its scoring leader
    lcomp = None
    for cid, c in m.comp.items():
        if c.get("league_id") == lg["id"] and (lcomp is None or c["starts"] > m.comp[lcomp]["starts"]):
            lcomp = cid
    if lcomp and not season:
        season = m.comp[lcomp]["season"]
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
        lead = (f"{name}{' (' + country + ')' if country else ''}{' ' + season if season else ''}: fixtures, results, standings, "
                f"box scores and player stats{' for ' + str(len(clubs)) + ' clubs' if clubs else ''}.")
        # who leads the table, and who the scoring: only said when it is certain and the person may be named
        top_club = ""
        if lcomp:
            first = [r for (cid, tid), r in m.standing.items() if cid == lcomp and tid in m.teams and not r.get("group_name")]
            if first and any(num(r.get("gp")) > 0 for r in first):
                one = [r for r in first if r.get("rank") == 1]
                if len(one) == 1:
                    top_club = f" {m.teams[one[0]['team_id']]['name']} lead the table."
        scoring = ""
        pool = [x for t in clubs for x in m.team_lead.get(t["id"], []) if lcomp and x[0] == lcomp]
        if pool:
            gmax = max(x[2] for x in pool)
            eligible = [x for x in pool if x[2] >= max(3, round(gmax * 0.5))]
            if eligible:
                _c, ppg, _g, pid = sorted(eligible, key=lambda x: (-x[1], x[3]))[0]
                if pid in m.players:
                    scoring = f" {m.players[pid]['name']} leads the scoring at {fmt1(ppg)} points a game."
        d = best([lead + top_club + scoring, lead + scoring, lead + top_club, lead,
                  f"{name}{' (' + country + ')' if country else ''} on {SITE_NAME}: fixtures, results, standings and player stats."])
    title = fit_title(opts, limit)
    path = league_path(m, lg, lang)
    org = {"@context": "https://schema.org", "@type": "SportsOrganization", "name": lname, "sport": "Basketball", "url": ORIGIN + path}
    nat = NATIVE_NAME.get(lang, {}).get(lname) if lang else None
    if nat:
        org["alternateName"] = nat
    org["description"] = clip(d, 300)
    logo = m.logo_of_league(lg)
    if logo:
        org["logo"] = logo
        org["image"] = logo
    named = [COUNTRY[c] for c in codes if c in COUNTRY]
    if named:
        org["areaServed"] = [{"@type": "Country", "name": n} for n in named]
    if clubs:
        org["member"] = [{"@type": "SportsTeam", "name": t["name"], "sport": "Basketball", "url": ORIGIN + team_path(t, lang if lang_of(lg) == lang else ""),
                          **({"logo": m.logo_of_team(t)} if m.logo_of_team(t) else {})}
                         for t in sorted(clubs, key=lambda t: t["name"].lower())[:80]]
    if lang:
        org["inLanguage"] = lang
    lds = [org, breadcrumb([(SITE_NAME, f"{BASE}/home/"), (lname, None)])]
    if clubs and not lang:
        lds.append({"@context": "https://schema.org", "@type": "ItemList", "name": f"{lname} clubs", "numberOfItems": len(clubs),
                    "itemListElement": [{"@type": "ListItem", "position": i, "name": t["name"], "url": ORIGIN + team_path(t)}
                                        for i, t in enumerate(sorted(clubs, key=lambda t: t["name"].lower())[:80], start=1)]})
    h = {"title": title, "desc": clip(d, 300), "path": path, "entity": lg["slug"], "og": "website",
         "image": logo if og_ok(logo) else None, "image_alt": f"{lname} logo",
         "ld": lds, "lang": lang, "base": f"{BASE}/l/" if lang else ""}
    if lang_of(lg):
        h["alts"] = alts({"en": league_path(m, lg), lang_of(lg): league_path(m, lg, lang_of(lg))})
    return h


def preview(h: dict) -> str:
    """og:image / twitter:image: the entity's own picture (crest, photograph, logo) as a small square card, else the
    site's 1200x630 share image as a large one; each with its alt text."""
    own = h.get("image")
    if own:
        alt = esc(h.get("image_alt") or h["title"])
        return (f'<meta property="og:image" content="{esc(own)}">\n<meta property="og:image:alt" content="{alt}">\n'
                f'<meta name="twitter:card" content="summary">\n<meta name="twitter:image" content="{esc(own)}">\n'
                f'<meta name="twitter:image:alt" content="{alt}">\n')
    share = ORIGIN + BASE + SHARE_IMG
    return (f'<meta property="og:image" content="{share}">\n<meta property="og:image:width" content="1200">\n'
            f'<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="{esc(SHARE_ALT)}">\n'
            f'<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="{share}">\n'
            f'<meta name="twitter:image:alt" content="{esc(SHARE_ALT)}">\n')


# ============================================================================ the games
def team_ok(m: Model, t) -> bool:
    """A club whose game may have a page: in a public league, and not a youth side (age_group is a number of
    years or 'U16'-style; a league that protects its youth is dropped as a whole below)."""
    if not t:
        return False
    ag = str(t.get("age_group") or "").strip().lower()
    if ag:
        n = re.search(r"\d+", ag)
        if not n or int(n.group()) <= 18 or "youth" in ag or "junior" in ag:
            return False
    return True


def when(g: dict, lg: dict) -> tuple[dt.datetime | None, str]:
    """The tip-off in the league's own time zone, and the words for it ('Sat 17 Oct 2026, 19:00 BST')."""
    try:
        d = dt.datetime.fromisoformat(str(g.get("tipoff_at")).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None, ""
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    try:
        d = d.astimezone(ZoneInfo(str((lg or {}).get("timezone") or "UTC")))
    except Exception:                                            # noqa: BLE001 - an unknown zone: UTC
        d = d.astimezone(dt.timezone.utc)
    return d, f"{d.strftime('%a')} {d.day} {d.strftime('%b %Y, %H:%M %Z')}"


def game_head(m: Model, g: dict, tops: dict, dated: bool = False) -> dict | None:
    """The head of one game's page, or None when the game may not have one. tops: game id -> {0: [(name, pts)], 1: [...]}."""
    home, away = m.teams.get(g.get("home_team_id")), m.teams.get(g.get("away_team_id"))
    lg = m.league_of_comp(g.get("competition_id"))
    if not (home and away and lg) or lg.get("youth_protected") or not (team_ok(m, home) and team_ok(m, away)):
        return None
    if home["league_id"] != lg["id"] or away["league_id"] != lg["id"]:
        return None
    status = g.get("status")
    d, when_s = when(g, lg)
    start = d.isoformat(timespec="seconds") if d else None        # the league's own offset: 2026-10-03T19:30:00+02:00
    if status not in ("final", "live", "scheduled") or not d or not start:
        return None
    hn, an, ln = home["name"], away["name"], lg["name"]
    hs, as_ = int(num(g.get("home_score"))), int(num(g.get("away_score")))
    day = f"{d.day} {d.strftime('%B %Y')}"
    short = f"{d.day} {d.strftime('%b')}"                        # '3 Oct': told apart from the same two clubs' other game
    vname = (g.get("venue") or "").strip() or None
    v = m.venue.get(g.get("venue_id")) or {}
    vname = vname or v.get("name") or m.venue_of_team(home)[0]
    vcity, vcc = v.get("city"), v.get("country")
    if status == "final":
        title = fit_title(([f"{hn} {hs}–{as_} {an} – box score, {short} | {SITE_NAME}", f"{hn} {hs}–{as_} {an}, {short} | {SITE_NAME}"] if dated else [])
                          + [f"{hn} {hs}–{as_} {an} – box score | {ln} | {SITE_NAME}", f"{hn} {hs}–{as_} {an} – box score | {SITE_NAME}",
                             f"{hn} {hs}–{as_} {an} | {SITE_NAME}", f"{hn} {hs}–{as_} {an}"])
        if hs == as_:
            res = f"{hn} and {an} finished level, {hs}-{as_}"
        else:
            (w, wl), (lo, ll) = ((hn, hs), (an, as_)) if hs > as_ else ((an, as_), (hn, hs))
            res = f"{w} beat {lo} {wl}-{ll}"
        tp = tops.get(g["id"]) or {}
        parts, bare = [], []
        for idx, nm in ((0, hn), (1, an)):
            run = tp.get(idx) or []
            if run:
                parts.append(f"{run[0][0]} {run[0][1]} ({nm})")
                bare.append(f"{run[0][0]} {run[0][1]}")
        s1 = (" Top scorers: " if len(parts) > 1 else " Top scorer: ") + ", ".join(parts) + "." if parts else ""
        s2 = " Top scorers: " + ", ".join(bare) + "." if len(bare) == 2 else s1       # both sides: home first, as in the title
        at = f" at {vname}" if vname else ""
        tail = f" Full box score, play-by-play and shot chart on {SITE_NAME}."
        base = f"{res} in {ln} on {day}"
        cands = []
        if parts:
            cands += [f"{base}{at}.{s1}{tail}", f"{base}{at}.{s1}", f"{base}.{s1}{tail}", f"{base}.{s1}", f"{base}.{s2}{tail}", f"{base}.{s2}"]
        cands += [f"{base}{at}.{tail}", f"{base}.{tail}", f"{base}{at}.", f"{base}."]
        d_ = best(cands)
        crumb = f"{hn} {hs}–{as_} {an}"
    elif status == "live":
        title = fit_title(([f"{hn} v {an} – live box score, {short} | {SITE_NAME}", f"{hn} v {an} – live, {short} | {SITE_NAME}", f"{hn} v {an}, {short} | {SITE_NAME}"] if dated else [])
                          + [f"{hn} v {an} – live score & box score | {ln} | {SITE_NAME}", f"{hn} v {an} – live box score | {SITE_NAME}",
                             f"{hn} v {an} | {SITE_NAME}"])
        d_ = best([f"{hn} v {an} in {ln}, live now{' at ' + vname if vname else ''}. Follow the box score, play-by-play and shot chart as it happens on {SITE_NAME}.",
                   f"{hn} v {an} in {ln}, live now. Box score and play-by-play on {SITE_NAME}."])
        crumb = f"{hn} v {an}"
    else:
        title = fit_title(([f"{hn} v {an} – preview & lineups, {short} | {SITE_NAME}", f"{hn} v {an} – preview, {short} | {SITE_NAME}", f"{hn} v {an}, {short} | {SITE_NAME}"] if dated else [])
                          + [f"{hn} v {an} – preview & lineups | {ln} | {SITE_NAME}", f"{hn} v {an} – preview & lineups | {SITE_NAME}",
                             f"{hn} v {an} | {SITE_NAME}"])
        d_ = best([f"{hn} host {an} in {ln} on {when_s}{' at ' + vname if vname else ''}. Preview, lineups and the full box score on {SITE_NAME}.",
                   f"{hn} host {an} in {ln} on {when_s}. Preview, lineups and box score on {SITE_NAME}.",
                   f"{hn} v {an} in {ln}, {when_s}. Preview and lineups on {SITE_NAME}.", f"{hn} v {an} in {ln}, {when_s}."])
        crumb = f"{hn} v {an}"
    path = f"{BASE}/game/{g['id']}.html"
    ev = {"@context": "https://schema.org", "@type": "SportsEvent", "name": f"{hn} v {an}", "url": ORIGIN + path,
          "description": d_, "sport": "Basketball", "startDate": start,
          # schema.org has no 'in progress' or 'played' status: a game that is on or was played IS EventScheduled
          "eventStatus": "https://schema.org/EventScheduled",
          "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
          "organizer": {"@type": "SportsOrganization", "name": ln, "url": ORIGIN + league_path(m, lg)}}
    for key, t in (("homeTeam", home), ("awayTeam", away)):
        o = {"@type": "SportsTeam", "name": t["name"], "sport": "Basketball", "url": ORIGIN + team_path(t)}
        if m.logo_of_team(t):
            o["logo"] = m.logo_of_team(t)
        ev[key] = o
    ev["competitor"] = [ev["homeTeam"], ev["awayTeam"]]
    if vname:
        place = {"@type": "Place", "name": vname}
        addr = {k: x for k, x in (("addressLocality", vcity), ("addressCountry", vcc)) if x}
        if addr:
            place["address"] = {"@type": "PostalAddress", **addr}
        ev["location"] = place
    imgs = [x for x in (m.logo_of_team(home), m.logo_of_team(away)) if og_ok(x)]
    ev["image"] = imgs or [ORIGIN + BASE + SHARE_IMG]
    trail = [(SITE_NAME, f"{BASE}/home/"), (ln, league_path(m, lg)), (crumb, None)]
    # lastmod: when the record last changed (a finish, a revert), never later than now; a live game is now
    stamps = [x for x in (iso(g.get("finalised_at")), iso(g.get("reverted_at")), iso(g.get("created_at"))) if x]
    return {"title": title, "desc": d_, "path": path, "entity": g["id"], "og": "website",
            "image": None, "ld": [ev, breadcrumb(trail)], "status": status, "start": start,
            "lastmod": max(stamps) if stamps else start}


def pick_games(m: Model, rows: list, now: dt.datetime) -> list:
    """The games that get a page, in the order they are written: live (newest first), then finished games (newest
    first, at most MAX_FINALS) and fixtures (soonest first) filling what is left of MAX_GAMES. Anything outside
    the window, of a private league, or stuck 'live' for days is dropped here whatever the database returned."""
    lo, hi = now - dt.timedelta(days=WINDOW_DAYS), now + dt.timedelta(days=WINDOW_DAYS)
    live, fin, sch = [], [], []
    for g in rows:
        try:
            t = dt.datetime.fromisoformat(str(g.get("tipoff_at")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        st = g.get("status")
        if st == "live" and now - dt.timedelta(hours=LIVE_STALE_H) <= t <= now + dt.timedelta(hours=6):
            live.append((t, g))
        elif st == "final" and lo <= t <= now:
            fin.append((t, g))
        elif st == "scheduled" and now - dt.timedelta(hours=2) <= t <= hi:
            sch.append((t, g))
    live.sort(key=lambda x: (x[0], x[1]["id"]), reverse=True)
    fin.sort(key=lambda x: (x[0], x[1]["id"]), reverse=True)
    sch.sort(key=lambda x: (x[0], x[1]["id"]))
    out = [g for _t, g in live]
    fin = [g for _t, g in fin][:MAX_FINALS]
    room = max(0, MAX_GAMES - len(out))
    # finals and fixtures share what is left: the soonest fixtures are as searched-for as the newest results
    n_fin = min(len(fin), max(room // 2, room - len(sch)))
    out += fin[:n_fin]
    out += [g for _t, g in sch][: max(0, MAX_GAMES - len(out))]
    return out[:MAX_GAMES]


def top_scorers(m: Model, game_ids: list, source) -> dict:
    """game id -> {0: [(name, points)], 1: [...]}: the leading run of people who may be named on each side (see
    Model.leaders: a side whose top scorer may not be named gets nobody). From the box score rows of the finals."""
    out = defaultdict(lambda: {0: [], 1: []})
    by_game = defaultdict(lambda: {0: [], 1: []})
    for i in range(0, len(game_ids), 60):
        chunk = game_ids[i:i + 60]
        rows = optional(source, "player_game_stats", {"select": "game_id,player_id,team_idx,pts:stats->pts",
                                                       "game_id": "in.(" + ",".join(chunk) + ")"}, "box-score rows")
        for r in rows:
            if r.get("game_id") in chunk and r.get("team_idx") in (0, 1) and isinstance(r.get("pts"), (int, float)):
                by_game[r["game_id"]][r["team_idx"]].append((int(r["pts"]), r["player_id"]))
    for gid, sides in by_game.items():
        for idx, lst in sides.items():
            lst.sort(key=lambda x: (-x[0], x[1]))
            run = []
            for pts, pid in lst:
                if pid not in m.players or pts <= 0:
                    break
                run.append((m.players[pid]["name"], pts))
                if len(run) == 3:
                    break
            out[gid][idx] = run
    return out


def bake(shell: str, h: dict) -> str:
    """The full page's own HTML with this entity's head. The description, canonical and link-preview tags
    are replaced if the page has any and added if not; nothing else in the page is touched."""
    url = ORIGIN + h["path"]
    s = re.sub(r'<meta[^>]*\bname="(?:description|epinoia-entity|robots)"[^>]*>\s*', "", shell)
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
             f'<meta name="robots" content="{ROBOTS}">\n'
             f'<link rel="canonical" href="{esc(url)}">\n'
             f'<meta name="epinoia-entity" content="{esc(h["entity"])}">\n'
             f'<meta property="og:type" content="{h["og"]}">\n<meta property="og:site_name" content="{SITE_NAME}">\n'
             f'<meta property="og:title" content="{esc(h["title"])}">\n<meta property="og:description" content="{esc(h["desc"])}">\n'
             f'<meta property="og:url" content="{esc(url)}">\n'
             + hre
             + preview(h)
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


def optional(source, name: str, params: dict, what: str) -> list:
    """A read the pages are better for but do not need (photographs, heights, games, the table): if it cannot be
    made, say so and carry on without it rather than fail a deploy over a decoration."""
    try:
        return source.get(name, params)
    except FileNotFoundError:                                    # a fixture set with no such table (the tests)
        return []
    except (SystemExit, OSError, ValueError) as exc:
        print(f"build-seo: warning: {what} not read ({exc}); pages are written without them", file=sys.stderr)
        return []


def xml_url(loc: str, lastmod: str | None = None, alts: list | None = None, extra: str = "") -> str:
    out = f"<url><loc>{esc(loc)}</loc>"
    if lastmod:
        out += f"<lastmod>{esc(lastmod)}</lastmod>"
    out += extra
    for code, href in alts or []:
        out += f'<xhtml:link rel="alternate" hreflang="{esc(code)}" href="{esc(href)}"/>'
    return out + "</url>"


def write_xml(site: str, name: str, entries: list, hreflang: bool = False) -> None:
    if len(entries) > 50000:
        raise SystemExit(f"build-seo: {name}: over 50,000 URLs - split it before this many pages")
    ns = ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' if hreflang else ""
    out = os.path.join(site, "epinoia", name)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"{ns}>\n'
                + "\n".join(entries) + "\n</urlset>\n")


def sitemap(site: str, ents: list, games: list, data_ts: str | None, now_iso: str) -> dict:
    """sitemap.xml is an INDEX of three: sitemap-static.xml (the site's own entry points, epinoia/sitemap.xml in the
    repository, each with the newest data timestamp where it changes with the data), sitemap-entities.xml (every
    league, club and player written here, with the hreflang alternates of the Japanese and Spanish copies) and
    sitemap-games.xml (absent when there are no game pages). ents: [(path, lastmod, alts)]; games: [(path, lastmod)]."""
    static = []
    src = os.path.join(ROOT, "epinoia", "sitemap.xml")
    if os.path.exists(src):
        with open(src, encoding="utf-8") as f:
            text = f.read()
        for blk in re.findall(r"<url>(.*?)</url>", re.sub(r"<!--.*?-->", "", text, flags=re.S), flags=re.S):
            loc = re.search(r"<loc>(.*?)</loc>", blk)
            if not loc:
                continue
            kv = dict(re.findall(r"<(changefreq|priority|lastmod)>(.*?)</\1>", blk))
            # what changes with the data says so; a page that changes with a commit says nothing rather than guess
            last = kv.get("lastmod") or (data_ts if kv.get("changefreq") in ("hourly", "daily") else None)
            static.append(xml_url(html.unescape(loc.group(1)), last,
                                  extra="".join(f"<{k}>{kv[k]}</{k}>" for k in ("changefreq", "priority") if k in kv)))
    have = {re.search(r"<loc>(.*?)</loc>", e).group(1) for e in static}
    seen, entries = set(), []
    for path, last, alts in ents:
        loc = ORIGIN + path
        if loc in have or loc in seen:
            continue
        seen.add(loc)
        entries.append(xml_url(loc, last or data_ts, alts))
    write_xml(site, "sitemap-static.xml", static)
    write_xml(site, "sitemap-entities.xml", entries, hreflang=True)
    files = [("sitemap-static.xml", data_ts or now_iso), ("sitemap-entities.xml", data_ts or now_iso)]
    if games:
        write_xml(site, "sitemap-games.xml", [xml_url(ORIGIN + p, last) for p, last in games])
        files.append(("sitemap-games.xml", max(l for _p, l in games)))
    idx = os.path.join(site, "epinoia", "sitemap.xml")
    with open(idx, "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(f"<sitemap><loc>{ORIGIN}{BASE}/{n}</loc><lastmod>{esc(l)}</lastmod></sitemap>" for n, l in files)
                + "\n</sitemapindex>\n")
    return {"sitemap_urls": len(static) + len(entries) + len(games), "static": len(static), "entities": len(entries), "games": len(games)}


def shells() -> dict:
    out = {}
    for kind in ("p", "t", "l", "game"):
        with open(os.path.join(ROOT, "epinoia", kind, "index.html"), encoding="utf-8") as f:
            out[kind] = f.read()
    return out


def build(site: str, source, min_players: int, min_teams: int = 50, min_leagues: int = 5, now: dt.datetime | None = None,
          supa: str = "https://fixtures.supabase.co") -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    leagues = source.get("leagues", {"select": "id,slug,name,country,logo_path,timezone,youth_protected",
                                     "visibility": "eq.public", "order": "name"})
    comps = source.get("competitions", {"select": "id,name,seasons(id,name,starts_on,leagues(id,name,slug))"})
    teams = source.get("teams", {"select": "id,slug,name,short_name,league_id,logo_path,home_venue,home_venue_id,age_group"})
    stats = source.get("player_season_stats", {"select": STAT_COLS, "order": "player_id.asc,season_id.asc,competition_id.asc"})
    standings = optional(source, "standings", {"select": "competition_id,team_id,gp,w,l,rank,group_name,updated_at",
                                               "order": "competition_id.asc,team_id.asc"}, "the standings")
    venues = optional(source, "venues", {"select": "id,name,city,country", "order": "id.asc"}, "the venues")
    photos = optional(source, "media", {"select": "owner_id,storage_path,created_at", "owner_type": "eq.player",
                                        "kind": "eq.photo", "status": "eq.approved", "order": "created_at.asc,id.asc"}, "the approved photographs")
    m = Model(leagues, comps, teams, stats, standings, venues, photos, (), supa)
    if len(m.players) < min_players or len(m.teams) < min_teams or len(m.leagues) < min_leagues:
        raise SystemExit(f"build-seo: read {len(m.players)} players, {len(m.teams)} teams, {len(m.leagues)} leagues "
                         f"(need {min_players}, {min_teams}, {min_leagues}) - not publishing a thin site")
    # heights: the profile rows of the people who have a page, a batch at a time (the table is guarded per row, so a
    # whole-table read times out; a few hundred ids at a time is quick)
    ids, profiles = sorted(m.players), []
    for i in range(0, len(ids), 150):
        profiles += optional(source, "players", {"select": "id,is_minor,height_cm", "id": "in.(" + ",".join(ids[i:i + 150]) + ")"}, "player heights")
        if i and not profiles:
            break                                                # the first batches failed: do not retry 50 more times
    m.height = {}
    for r in profiles:
        if r.get("id") in m.players and not r.get("is_minor") and isinstance(r.get("height_cm"), (int, float)) and 100 <= r["height_cm"] <= 260:
            m.height[r["id"]] = int(r["height_cm"])
    sh = shells()
    ents = []                                                    # (path, lastmod, hreflang alternates)
    lg_updated = defaultdict(str)
    for t in m.teams.values():
        lg_updated[t["league_id"]] = max(lg_updated[t["league_id"]], m.team_updated.get(t["id"], ""))
    for lg in m.leagues.values():
        h = league_head(m, lg)
        write(site, h["path"], bake(sh["l"], h))
        ents.append((h["path"], lg_updated.get(lg["id"]) or None, h.get("alts")))
    for lg in m.leagues.values():
        if lang_of(lg):
            h = league_head(m, lg, lang_of(lg))
            write(site, h["path"], bake(sh["l"], h))
            ents.append((h["path"], lg_updated.get(lg["id"]) or None, h.get("alts")))
    theads = {t["id"]: team_head(m, t) for t in m.teams.values()}
    tcount = defaultdict(list)
    for tid, h in theads.items():
        tcount[h["title"]].append(tid)
    for tids in (v for v in tcount.values() if len(v) > 1):
        for tid in tids:
            theads[tid] = team_head(m, m.teams[tid], tagged=True)
    for t in m.teams.values():
        h = theads[t["id"]]
        write(site, h["path"], bake(sh["t"], h))
        ents.append((h["path"], m.team_updated.get(t["id"]), h.get("alts")))
        lang = lang_of(m.leagues.get(t["league_id"]))
        if lang:
            h = team_head(m, t, lang)
            write(site, h["path"], bake(sh["t"], h))
            ents.append((h["path"], m.team_updated.get(t["id"]), h.get("alts")))
    # two profiles with one name and one club (a duplicate the league has not merged) would share a title: tell them apart
    heads = {p["id"]: player_head(m, p) for p in m.players.values()}
    count = defaultdict(list)
    for pid, h in heads.items():
        count[h["title"]].append(pid)
    for pids in (v for v in count.values() if len(v) > 1):
        for pid in pids:
            jersey = str(m.players[pid]["rows"][0].get("jersey") or "").strip()
            mates = [str(m.players[q]["rows"][0].get("jersey") or "").strip() for q in pids]
            tag = f" (No. {jersey})" if jersey and mates.count(jersey) == 1 else f" (ID {pid[:4]})"
            heads[pid] = player_head(m, m.players[pid], tag)
    for p in m.players.values():
        h = heads[p["id"]]
        write(site, h["path"], bake(sh["p"], h))
        ents.append((h["path"], m.team_updated.get(p["rows"][0]["team_id"]), None))
    # the games of the window
    lo, hi = (now - dt.timedelta(days=WINDOW_DAYS)).isoformat(timespec="seconds"), (now + dt.timedelta(days=WINDOW_DAYS)).isoformat(timespec="seconds")
    rows = []
    gcols = "id,competition_id,home_team_id,away_team_id,tipoff_at,venue,venue_id,status,home_score,away_score,finalised_at,reverted_at,created_at"
    for status, extra in (("final", {"and": f"(tipoff_at.gte.{lo},tipoff_at.lte.{now.isoformat(timespec='seconds')})", "order": "tipoff_at.desc,id.desc"}),
                          ("live", {"order": "tipoff_at.desc,id.desc"}),
                          ("scheduled", {"and": f"(tipoff_at.gte.{(now - dt.timedelta(hours=2)).isoformat(timespec='seconds')},tipoff_at.lte.{hi})",
                                         "order": "tipoff_at.asc,id.asc"})):
        rows += optional(source, "games", {"select": gcols, "status": f"eq.{status}", **extra}, f"the {status} games")
    rows = list({g["id"]: g for g in rows if g.get("id")}.values())      # one row per game whatever the reads returned
    picked = [g for g in pick_games(m, rows, now)
              if m.league_of_comp(g.get("competition_id")) and g.get("home_team_id") in m.teams and g.get("away_team_id") in m.teams]
    finals = [g["id"] for g in picked if g.get("status") == "final"]
    tops = top_scorers(m, finals, source) if finals else {}
    games, seen_g = [], set()
    gheads = {}
    for g in picked:
        h = game_head(m, g, tops) if g["id"] not in gheads else None
        if h:
            gheads[g["id"]] = (g, h)
    gcount = defaultdict(list)
    for gid, (_g, h) in gheads.items():
        gcount[h["title"]].append(gid)
    for gids in (v for v in gcount.values() if len(v) > 1):          # the same two clubs meeting twice in the window
        for gid in gids:
            gheads[gid] = (gheads[gid][0], game_head(m, gheads[gid][0], tops, dated=True))
    for g in picked:
        if g["id"] not in gheads or g["id"] in seen_g:
            continue
        h = gheads[g["id"]][1]
        seen_g.add(g["id"])
        write(site, h["path"], bake(sh["game"], h))
        last = h["lastmod"] if g["status"] != "live" else now.isoformat(timespec="seconds")
        games.append((h["path"], min(last, now.isoformat(timespec="seconds")) if g["status"] != "scheduled" else last))
    sm = sitemap(site, ents, games, m.data_ts, now.isoformat(timespec="seconds"))
    return {"players": len(m.players), "left_out_minor_or_masked": m.dropped, "teams": len(m.teams),
            "leagues": len(m.leagues), "games": len(games), "photos": sum(1 for p in m.players if m.photo.get(p)),
            "heights": len(m.height), **sm}


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

    res = build(a.site, Source(), a.min_players, a.min_teams, a.min_leagues, supa="https://fixtures.supabase.co" if a.fixtures else url)
    print("build-seo:", json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
