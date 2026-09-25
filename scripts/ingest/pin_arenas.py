"""Every arena on the map (EPINOIA GO, docs/epinoia-go.md step 1.4).

Asks Google Maps (Places API "Text Search") where each arena is, and stores the answer on its `venues` row
(0162): coordinates, Google's place id (so "open in Google Maps" is exact), address and city. A match this
script is not sure of is stored WITH A NOTE (`pin_note`): the arena editor (1.5) lists those first, and a
stamp is never checked against a pin that has a note until a person has looked at it.

    python scripts/ingest/pin_arenas.py --worker-config                       5 arenas, nothing written
    python scripts/ingest/pin_arenas.py --worker-config --write               pin 5
    python scripts/ingest/pin_arenas.py --worker-config --write --all         pin every one not tried yet
    python scripts/ingest/pin_arenas.py --worker-config --clubs [--write]     clubs whose feed names no venue
    python scripts/ingest/pin_arenas.py --worker-config --merge [--write]     two spellings, one place: merge
    python scripts/ingest/pin_arenas.py --worker-config --hinted [--write]    arenas asked by their full names
    python scripts/ingest/pin_arenas.py --worker-config --recheck [--write]   today's rules on unchecked pins
    python scripts/ingest/pin_arenas.py --worker-config --venue ID [--write]  one arena, looked up again
    python scripts/ingest/pin_arenas.py --worker-config --merge-into KEEP OTHER [--write]
    python scripts/ingest/pin_arenas.py --usage                               lookups used today and this month

THE PASSES
  arenas  every venue a game names, not pinned and not tried, the busiest first. A doubtful answer is asked
          again with the home club's name ("トヨタA" alone finds a car dealer; with "Alvark Tokyo", the arena).
  --clubs clubs with home games that name no arena (Liga Endesa, ProA/ProB... 0162 game_venue_id). The
          club's own "home venue" text is used where the club has one; otherwise Google is asked for the
          club's basketball arena and the answer becomes the club's home arena - always worth a look.
  --merge venues that landed on one Google place are one arena when one name holds the other: their
          spellings, games and clubs move to the busier row, and the other row goes. Pins with a note are
          never merged; two names that only share a place are listed for a person (--merge-into).
  --hinted  the arenas arena_hints.json names, asked by their full names ("盛岡" -> 盛岡タカヤアリーナ);
          a hint marked unsure keeps a note on the pin it finds.
  --recheck every Google pin nobody has checked, judged again by the current rules FROM THE CACHE: it
          never sends a lookup. A pin with checked_at set is left alone.

A CHECKED PIN (checked_at set) was read by a person, or in the review of 2026-09-24 (checked_by empty):
every run leaves it as it is. A pin with a NOTE is never trusted by a stamp until a person clears it.

THE KEY AND THE CAP
  The key is read from %APPDATA%\\epinoia\\google.json ({"maps_key": "..."}) and never printed. Every lookup
  is counted BEFORE it is sent, in %APPDATA%\\epinoia\\google_usage.json: at most 1,000 a day (Google's day,
  Pacific time) and 4,000 a calendar month, well inside the free monthly allowance for Text Search. At the
  cap the run stops, whatever was asked; --cap can lower the daily figure, never raise it. Answers are kept
  30 days in %APPDATA%\\epinoia\\google_cache.json, so asking the same question again costs nothing.
"""
import argparse
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

DAY_CAP = 1000
MONTH_CAP = 4000
SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# what is asked for decides the price: these are the "Pro" fields, nothing from the dearer tier
FIELDS = "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents"


def appdata(*p) -> Path:
    return Path(os.environ.get("APPDATA") or Path.home()).joinpath("epinoia", *p)


# ─────────────────────────────────────────────────────────── the cap
class CapReached(Exception):
    pass


def google_day(now=None) -> datetime:
    """Google's quota day runs on Pacific time."""
    now = now or datetime.now(timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return now.astimezone(ZoneInfo("America/Los_Angeles"))
    except Exception:
        return now.astimezone(timezone(timedelta(hours=-8)))


class Budget:
    """Lookups counted in a file, so the cap holds across runs. Taken before each request is sent: a request
    that fails still counts, which errs on the side of the bill."""

    def __init__(self, path: Path, day_cap: int = DAY_CAP, month_cap: int = MONTH_CAP, clock=None):
        self.path, self.clock = Path(path), clock
        self.day_cap, self.month_cap = min(day_cap, DAY_CAP), min(month_cap, MONTH_CAP)

    def _now(self):
        return google_day(self.clock() if self.clock else None)

    def state(self) -> dict:
        t = self._now()
        day, month = t.strftime("%Y-%m-%d"), t.strftime("%Y-%m")
        try:
            s = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            s = {}
        if s.get("month") != month:
            s = {"month": month, "month_count": 0}
        if s.get("day") != day:
            s.update(day=day, day_count=0)
        return s

    def take(self) -> dict:
        s = self.state()
        if s["day_count"] >= self.day_cap:
            raise CapReached(f"{s['day_count']} lookups today (cap {self.day_cap}); Google's day starts at midnight Pacific")
        if s["month_count"] >= self.month_cap:
            raise CapReached(f"{s['month_count']} lookups this month (cap {self.month_cap})")
        s["day_count"] += 1
        s["month_count"] += 1
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".usage")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(s, f)
        os.replace(tmp, self.path)
        return s


def load_key(path: Path = None) -> str:
    path = path or appdata("google.json")
    try:
        k = (json.loads(path.read_text(encoding="utf-8-sig")).get("maps_key") or "").strip()
    except (OSError, ValueError) as exc:
        raise SystemExit(f"cannot read {path}: {type(exc).__name__}")
    if not k:
        raise SystemExit(f'{path} has no "maps_key"')
    return k


class GoogleError(Exception):
    pass


class Cache:
    """Answers kept 30 days (as long as Google's terms allow coordinates to be kept), so a dry run followed by
    the same run with --write asks Google once."""
    DAYS = 30

    def __init__(self, path: Path):
        self.path = Path(path)
        try:
            self.d = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.d = {}
        cut = (datetime.now(timezone.utc) - timedelta(days=self.DAYS)).isoformat()
        self.d = {k: v for k, v in self.d.items() if v.get("at", "") >= cut}

    def get(self, k):
        return (self.d.get(k) or {}).get("places")

    def put(self, k, places):
        self.d[k] = {"at": datetime.now(timezone.utc).isoformat(), "places": places}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".cache")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.d, f, ensure_ascii=False)
        os.replace(tmp, self.path)


def text_search(key: str, budget: Budget, query: str, region: str = None, lang: str = "en", session=None,
                cache: Cache = None, cache_only: bool = False):
    """Places API (New) Text Search: up to 5 candidates. One request, one count against the cap.
    With cache_only, an answer not in the cache is None and nothing is sent."""
    body = {"textQuery": query, "languageCode": lang, "pageSize": 5}
    if real_country(region):
        body["regionCode"] = region.lower()
    ck = json.dumps(body, sort_keys=True, ensure_ascii=False)
    if cache is not None and cache.get(ck) is not None:
        return cache.get(ck)
    if cache_only:
        return None
    budget.take()
    r = (session or requests).post(SEARCH_URL, json=body, timeout=30,
                                   headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS})
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", "")
        except ValueError:
            msg = ""
        raise GoogleError(f"Google answered {r.status_code}: {msg[:200]}")
    places = r.json().get("places") or []
    if cache is not None:
        cache.put(ck, places)
    return places


# the leagues' own region codes that are not countries: EuroLeague and EuroCup, the ABA leagues
PSEUDO_COUNTRIES = {"EU", "XB"}


def real_country(c) -> bool:
    return bool(c) and bool(re.fullmatch(r"[A-Z]{2}", c)) and c not in PSEUDO_COUNTRIES


# Google answers in the language asked for, and a feed names an arena in its country's language
# ("Pyynikin palloiluhalli", not "Pyynikki Indoor Sports Center"). Countries in another script keep
# English, the script the feeds write in.
LANGS = {"JP": "ja", "FI": "fi", "ES": "es", "MX": "es", "AR": "es", "IT": "it", "FR": "fr", "DE": "de",
         "AT": "de", "LT": "lt", "LV": "lv", "EE": "et", "PL": "pl", "CZ": "cs", "SK": "sk", "SI": "sl",
         "HR": "hr", "BA": "bs", "TR": "tr", "HU": "hu", "RO": "ro", "PT": "pt", "BR": "pt", "NL": "nl",
         "BE": "nl", "SE": "sv", "NO": "no", "DK": "da", "XK": "sq", "AL": "sq"}


# ─────────────────────────────────────────────────────────── judging a match
_FOLD_FROM = "àáâãäåāăąçćčĉċďđèéêëēėęěĕğģĝġĥħìíîïīįıĩĵķłľĺļñńňņòóôõöøōőŏŕřŗśšşșŝßťţțùúûüūůűųũŭýÿŷźżžŵ"
_FOLD_TO = "aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiijkllllnnnnooooooooorrrsssssstttuuuuuuuuuuyyyzzzw"
_FOLD = str.maketrans(_FOLD_FROM, _FOLD_TO)


def fold(s: str) -> str:
    """venue_key (0162) in Python: lower case, the same Latin letters folded, punctuation and space made one."""
    s = (s or "").lower().translate(_FOLD)
    return re.sub(r"[\W_]+", " ", s).strip()


# words every arena has, which say nothing about which one it is
GENERIC = set("""
arena areena hall halle hala hali sala salle sport sports sporto sportu sportovni sportowa sportiva sportivo
center centre centro centrum palacio palazzetto palasport pavilion pabellon pavello pavillon polideportivo
deportes deportivo municipal municipale comunale gym gymnasium gimnasio complex complejo kompleksas stadium
stadion dvorana liikuntahalli urheilutalo urheiluhalli idrottshall palais espace parc expositions omnisports
centras centar keskus halli sale leisure rajono savivaldybes
of the and de del la le los las el di dello della des du y i e und am im an na olimpico olympic olympia
indoor city
""".split())

AREA_TYPES = {"locality", "political", "route", "postal_code", "administrative_area_level_1",
              "administrative_area_level_2", "administrative_area_level_3", "country", "sublocality",
              "neighborhood", "street_address", "premise", "subpremise", "geocode", "plus_code"}
# a place games can be played in. Not "sports_club": that is a club's office as often as its hall (a match
# for "Sendai 89ers" is the company's office), and a shop, a mall or a car dealer never is (all seen in the
# first B.LEAGUE lookups, whose feed shortens its arenas to "ゼビオ", "立川立飛", "トヨタA")
VENUE_TYPES = {"arena", "stadium", "sports_complex", "gym", "athletic_field", "event_venue",
               "sports_activity_location", "fitness_center", "school", "secondary_school", "university",
               "community_center", "convention_center", "auditorium", "amphitheatre", "swimming_pool"}


def is_venue(p) -> bool:
    return bool(p) and bool(set(p.get("types") or []) & VENUE_TYPES)


def has_cjk(s: str) -> bool:
    return any(unicodedata.east_asian_width(c) in ("W", "F") for c in s or "")


def core(s: str) -> str:
    """What names this arena and no other: folded, the bracketed town ("La Meilleraie (Cholet)") and the
    words every arena has taken out."""
    return " ".join(w for w in fold(re.sub(r"\([^)]*\)|（[^）]*）", " ", s or "")).split() if w not in GENERIC)


def _not_town(words: str, town: str) -> str:
    """Words without the town's name, in any of its cases ("Jurbarko" for Jurbarkas, "Šakių" for Šakiai):
    a hall and the town's gym, pool or theatre share it, so it says nothing about which building. A word
    much longer than the town's is a place of its own ("Espoonlahden" is a district of Espoo)."""
    tw = [w for w in fold(town).split() if len(w) >= 4]
    return " ".join(w for w in words.split()
                    if not any(w == t or (len(w) >= 4 and w[:4] == t[:4] and len(w) <= len(t) + 3) for t in tw))


def _plain(s: str) -> str:
    """Folded, without brackets and without a feed's ", Town" ending ("Arena Vilnius, Vilnius")."""
    return fold(re.sub(r"\([^)]*\)|（[^）]*）", " ", re.sub(r",[^,]*$", "", s or "")))


def similar(a: str, b: str, town: str = None) -> bool:
    fa, fb = fold(a), fold(b)
    if not fa or not fb:
        return False
    if has_cjk(fa) or has_cjk(fb):
        if fa in fb or fb in fa:
            return True
        grams = lambda s: {s[i:i + 2] for i in range(len(s) - 1)} - {"アリ", "リー", "ーナ", "体育", "育館"}
        return bool(grams(fa.replace(" ", "")) & grams(fb.replace(" ", "")))
    ca, cb = core(a), core(b)
    if town:
        ca, cb = _not_town(ca, town), _not_town(cb, town)
    if not ca or not cb:
        # nothing but common words once the town is out ("Reims Arena (Reims)" / "Reims Arena"): the
        # common words themselves must agree - "arena" and "arena", not "arena" and "stadionas"
        pa, pb = (_not_town(_plain(a), town), _not_town(_plain(b), town)) if town else (_plain(a), _plain(b))
        if not pa or not pb:
            return pa == pb
        short = min(pa, pb, key=len)
        if all(w in GENERIC for w in short.split()):
            # "arena" names no arena: "Sportima arena" holds it and is another building
            return sorted(pa.split()) == sorted(pb.split())
        return (len(short) >= 4 and (pa in pb or pb in pa)) or SequenceMatcher(None, pa, pb).ratio() >= 0.85
    if ca in cb or cb in ca or SequenceMatcher(None, ca, cb).ratio() >= 0.75:
        return True
    ta = {w for w in ca.split() if len(w) >= 3}
    tb = {w for w in cb.split() if len(w) >= 3}
    # one word in two grammatical cases ("Pyynikin" / "Pyynikki", "Žalgirio" / "Žalgiris") shares its start
    return bool(ta & tb) or any(len(x) >= 5 and len(y) >= 5 and x[:5] == y[:5] for x in ta for y in tb)


def same_arena(a: str, b: str) -> bool:
    """Two spellings of one arena, strictly: one holds the other ("IGアリ" / "IGアリーナ", "ANTARES ARENA" /
    "Antares (Le Mans)"). Merging deletes a row, so two names that only share a word ("山形県総" / "山形スポ",
    both pinned on one park) are left for a person."""
    fa, fb = fold(search_name(a)).replace(" ", ""), fold(search_name(b)).replace(" ", "")
    if has_cjk(fa) or has_cjk(fb):
        return bool(fa and fb) and (fa in fb or fb in fa)
    ca, cb = core(a), core(b)
    if not ca or not cb:
        return fa == fb
    return ca in cb or cb in ca or SequenceMatcher(None, ca, cb).ratio() >= 0.85


def search_name(name: str) -> str:
    """B.LEAGUE's schedule shortens アリーナ to アリ ("IGアリ", "沖アリ"): asked in full, Google finds it."""
    return name + "ーナ" if has_cjk(name) and name.endswith("アリ") else name


def km(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["latitude"], a["longitude"], b["latitude"], b["longitude"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(h))


def component(place: dict, *kinds) -> str:
    for kind in kinds:
        for c in place.get("addressComponents") or []:
            if kind in (c.get("types") or []):
                return c.get("shortText") if kind == "country" else c.get("longText")
    return None


def place_name(p: dict) -> str:
    return ((p.get("displayName") or {}).get("text") or "").strip()


def judge(name: str, country, places: list, has_address: bool = False, club: bool = False):
    """(the place to pin or None, a note for a person or None). A note means: stored, but look at it.
    `country` is one code or a set of them: a BNXT arena may be in BE or NL, and "Dôme" in London is not it."""
    allowed = {c for c in ([country] if isinstance(country, str) else (country or [])) if real_country(c)}
    places = [p for p in places if (p.get("location") or {}).get("latitude") is not None]
    if not places:
        return None, "not found on Google Maps"
    # the first candidate that is a venue and has the name; else the first venue; else Google's first
    venues = [p for p in places if is_venue(p)]
    town = lambda p: component(p, "locality", "postal_town", "administrative_area_level_3")
    if club:
        best = venues[0] if venues else places[0]
    else:
        best = next((p for p in venues if similar(name, place_name(p), town(p))), venues[0] if venues else places[0])
    types = set(best.get("types") or [])
    gname = place_name(best)
    where = component(best, "country")
    if types and types <= AREA_TYPES | {"point_of_interest", "establishment"} and types & AREA_TYPES:
        return best, f"Google found only a place name, not a building ({gname})"
    if allowed and where and where.upper() not in allowed:
        return best, f"Google's best match is in {where.upper()}: {gname}"
    if not venues:
        kind = (best.get("types") or ["place"])[0].replace("_", " ")
        return best, (f"found from the club's name; " if club else "") + f"Google's match is a {kind}: {gname}"
    if club:
        return best, None
    # a different name is a different arena as often as it is a sponsor's new one: a person decides
    if not similar(name, gname, town(best)):
        return best, f"Google calls it {gname}"
    if not has_address:
        for other in venues:
            if other is not best and similar(name, place_name(other), town(other)) and km(best["location"], other["location"]) > 1.5:
                return best, f"two places match: {gname} and {place_name(other)}"
    return best, None


def pin_fields(place: dict, venue: dict, note: str) -> dict:
    """The venues columns a Google answer fills. The address, city and country are only filled if empty."""
    loc = place["location"]
    out = {"lat": round(loc["latitude"], 7), "lng": round(loc["longitude"], 7), "place_id": place["id"],
           "pin_source": "google", "pin_note": note, "pinned_at": datetime.now(timezone.utc).isoformat()}
    if not venue.get("address") and place.get("formattedAddress"):
        out["address"] = place["formattedAddress"]
    city = component(place, "locality", "postal_town", "administrative_area_level_3", "administrative_area_level_2")
    if not venue.get("city") and city:
        out["city"] = city
    cc = component(place, "country")
    if not real_country(venue.get("country")) and cc and real_country(cc.upper()):
        out["country"] = cc.upper()          # a EuroLeague arena's "EU" becomes the country it is in
    return out


# ─────────────────────────────────────────────────────────── reading the database
def select_all(sb, table: str, query: str, page: int = 1000) -> list:
    rows, start = [], 0
    while True:
        got = sb.select(table, f"{query}&limit={page}&offset={start}")
        rows += got
        if len(got) < page:
            return rows
        start += page


def games_per_venue(sb, clubs: dict = None) -> dict:
    """{venue: games}; with `clubs` given, fills it with {venue: its most frequent home club's id}."""
    n, homes = {}, {}
    for r in select_all(sb, "games", "select=venue_id,home_team_id&venue_id=not.is.null&order=id"):
        n[r["venue_id"]] = n.get(r["venue_id"], 0) + 1
        if r.get("home_team_id"):
            h = homes.setdefault(r["venue_id"], {})
            h[r["home_team_id"]] = h.get(r["home_team_id"], 0) + 1
    if clubs is not None:
        clubs.update({v: max(h, key=h.get) for v, h in homes.items()})
    return n


def venue_addresses(sb) -> dict:
    """The address a feed printed for an arena (EuroLeague, EuroCup...), the most frequent one."""
    seen = {}
    for r in select_all(sb, "games", "select=venue_id,venue_address&venue_id=not.is.null&venue_address=not.is.null&order=id"):
        c = seen.setdefault(r["venue_id"], {})
        c[r["venue_address"]] = c.get(r["venue_address"], 0) + 1
    return {v: max(c, key=c.get) for v, c in seen.items()}


def lang_for(name: str, country: str = None) -> str:
    if has_cjk(name):
        return "ja"
    if any("Ͱ" <= c <= "Ͽ" for c in name or ""):
        return "el"                      # a hint in Greek ("Κλειστό Γυμναστήριο ..."), answered in Greek
    return LANGS.get(country or "", "en")


def load_hints(path: Path = HERE / "arena_hints.json") -> dict:
    """{feed spelling: {"ask": the arena's full name, "sure": bool}} (arena_hints.json)."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in d.items() if not k.startswith("_") and isinstance(v, dict) and v.get("ask")}


# ─────────────────────────────────────────────────────────── the passes
def pin_venues(sb, key, budget, limit, write, retry=False, out=print, cache=None, venue=None, recheck=False,
               hinted=False, hints=None):
    hints = load_hints() if hints is None else hints
    replace = bool(venue or recheck or hinted)
    if venue:
        # one arena, whatever its state: its pin is looked up again and replaced
        todo = sb.select("venues", f"id=eq.{venue}&select=*")
    elif hinted:
        # the arenas arena_hints.json names, unless a person has checked the pin since
        todo = [v for v in select_all(sb, "venues", "select=*&checked_at=is.null&order=created_at") if v["name"] in hints]
    elif recheck:
        # every pin from Google no person has checked, judged again by today's rules (from the cache: free)
        todo = select_all(sb, "venues", "select=*&pin_source=eq.google&checked_at=is.null&order=created_at")
    else:
        q = "select=*&pin_source=is.null&order=created_at" + ("" if retry else "&pin_note=is.null")
        todo = select_all(sb, "venues", q)
    home = {}
    busy = games_per_venue(sb, home)
    addr = venue_addresses(sb)
    teams = {t["id"]: t for t in select_all(sb, "teams", "select=id,name,league_id&order=id")}
    lcountry = {l["id"]: l.get("country") or "" for l in select_all(sb, "leagues", "select=id,country&order=id")}
    todo.sort(key=lambda v: -busy.get(v["id"], 0))
    what = ("pinned from Google, unchecked" if recheck else "to look up again" if venue else
            "with a hint" if hinted else "to try again" if retry else "not pinned yet")
    out(f"{len(todo)} arenas {what}; this run: {min(limit, len(todo))}")
    done = flagged = 0
    skipped = 0
    for v in todo[:limit]:
        # the address a FEED printed, never venues.address: once pinned that is Google's own, and asking with
        # it is a new question (and a street address for an answer)
        a = addr.get(v["id"])
        t = teams.get(home.get(v["id"])) or {}
        club = t.get("name")
        # the arena's country, else its home club's league's ("BE+NL"), else anywhere
        where = ({v["country"]} if real_country(v.get("country"))
                 else {c for c in lcountry.get(t.get("league_id"), "").split("+") if real_country(c)})
        region = next(iter(where)) if len(where) == 1 else None
        hint = hints.get(v["name"])
        # the arena's full name where the feed's finds the wrong place (arena_hints.json), asked on its own:
        # a feed address would pull the answer back to where the feed's name led
        ask = hint["ask"] if hint else search_name(v["name"])
        a = None if hint else a
        lang = lang_for(ask, region)
        # a recheck asks Google nothing: an answer not in the cache is skipped, never bought
        places = text_search(key, budget, ask + (", " + a if a else ""), region, lang, cache=cache, cache_only=recheck)
        if places is None:
            skipped += 1
            continue
        best, note = judge(ask, where, places, has_address=bool(a))
        if hint and best and not note and not hint.get("sure"):
            note = f"found by asking for {ask}, a best guess at what the feed's \"{v['name']}\" means"
        if note and club and not a and not hint:
            # a feed's short form ("トヨタA") or a name shared by two towns: the home club says which one
            p2 = text_search(key, budget, f"{ask} {club}", region, lang, cache=cache, cache_only=recheck)
            b2, n2 = judge(ask, where, p2 or [])
            if b2 and best and b2["id"] == best["id"] and is_venue(b2) and (not n2 or n2.startswith("Google calls it")):
                # asked two ways, one arena both times ("ハピアリ" -> HAPPINESS ARENA, by name and by club)
                note = None
            elif b2 and (not n2 or (is_venue(b2) and not is_venue(best))):
                # sure this time, or at least an arena where the first answer was not ("TOYOTA ARENA
                # TOKYO" for "トヨタA", where the name alone found a car dealer): a person confirms that one
                best, note = b2, n2 and n2 + " (found with the home club's name)"
        if recheck and best and best["id"] == v.get("place_id") and note == v.get("pin_note"):
            continue
        tag = "PIN " if best and not note else ("LOOK" if best else "MISS")
        out(f"  {tag} {v['name'][:44]:<44} {v.get('country') or '--'}  {busy.get(v['id'], 0):>3} games  "
            + (f"-> {place_name(best)[:40]}, {component(best, 'locality', 'postal_town') or ''}" if best else "")
            + (f"   [{note}]" if note else ""))
        if write and not replace:
            body = pin_fields(best, v, note) if best else {"pin_note": note}
            sb.patch("venues", f"id=eq.{v['id']}&pin_source=is.null", body)
        elif write:
            # a pin replaced: the old pin's address and city go with it, and a person's check no longer holds
            body = (pin_fields(best, {"country": v.get("country")}, note) if best else
                    {"lat": None, "lng": None, "place_id": None, "pin_source": None, "pinned_at": None, "pin_note": note})
            sb.patch("venues", f"id=eq.{v['id']}", dict(body, checked_by=None, checked_at=None))
        done += 1
        flagged += bool(note)
    out(f"{done} {'changed' if recheck else 'looked up'}, {done - flagged} pinned outright, {flagged} left for a person"
        + (f", {skipped} not in the cache (skipped)" if skipped else "")
        + ("" if write else " (nothing written: --write)"))


def clubs_needing_arena(sb) -> list:
    """Clubs with a home game that names no arena and no home arena of their own."""
    homes = {}
    for r in select_all(sb, "games", "select=home_team_id&venue_id=is.null&home_team_id=not.is.null&order=id"):
        homes[r["home_team_id"]] = homes.get(r["home_team_id"], 0) + 1
    teams = select_all(sb, "teams", "select=id,name,league_id,home_venue,home_venue_address&home_venue_id=is.null&order=id")
    leagues = {l["id"]: l for l in select_all(sb, "leagues", "select=id,name,country&order=id")}
    out = []
    for t in teams:
        if homes.get(t["id"]):
            lg = leagues.get(t["league_id"]) or {}
            c = lg.get("country") if re.fullmatch(r"[A-Z]{2}", lg.get("country") or "") else None
            out.append(dict(t, games=homes[t["id"]], country=c, league=lg.get("name")))
    out.sort(key=lambda t: -t["games"])
    return out


def pin_clubs(sb, key, budget, limit, write, out=print, cache=None):
    clubs = clubs_needing_arena(sb)
    out(f"{len(clubs)} clubs play home games that name no arena; this run: {min(limit, len(clubs))}")
    by_place = {v["place_id"]: v for v in select_all(sb, "venues", "select=id,name,place_id,pin_note&place_id=not.is.null&order=id")}
    for t in clubs[:limit]:
        own = (t.get("home_venue") or "").strip()
        if own:
            # the club's own word for its arena: made a venue like any feed's spelling, pinned by the arenas pass
            out(f"  OWN  {t['name'][:40]:<40} {t['country'] or '--'}  {t['games']:>3} games -> {own}")
            if write:
                vid = sb.rpc("venue_link", {"p_name": own, "p_country": t["country"]})
                if vid:
                    sb.patch("teams", f"id=eq.{t['id']}&home_venue_id=is.null", {"home_venue_id": vid})
            continue
        places = text_search(key, budget, f"{t['name']} basketball arena", t["country"],
                             lang_for(t["name"], t["country"]), cache=cache)
        best, note = judge(t["name"], t["country"], places, club=True)
        if not best:
            out(f"  MISS {t['name'][:40]:<40} {t['country'] or '--'}  {t['games']:>3} games   [{note}]")
            continue
        known = by_place.get(best["id"])
        out(f"  {'LOOK' if note else 'PIN '} {t['name'][:40]:<40} {t['country'] or '--'}  {t['games']:>3} games -> "
            f"{place_name(best)[:40]}, {component(best, 'locality', 'postal_town') or ''}"
            + (" (an arena already on file)" if known else "") + (f"   [{note}]" if note else ""))
        if not write:
            continue
        if known:
            vid = known["id"]
        else:
            vid = sb.rpc("venue_link", {"p_name": place_name(best), "p_country": t["country"]})
            if not vid:
                continue
            row = (sb.select("venues", f"id=eq.{vid}&select=*") or [{}])[0]
            if not row.get("pin_source"):
                sb.patch("venues", f"id=eq.{vid}&pin_source=is.null", pin_fields(best, row, note))
            by_place[best["id"]] = {"id": vid, "place_id": best["id"], "pin_note": note}
        sb.patch("teams", f"id=eq.{t['id']}&home_venue_id=is.null", {"home_venue_id": vid})


# ─────────────────────────────────────────────────────────── the place at a pin
NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
ARENA_TYPES = ["stadium", "arena", "sports_complex", "sports_activity_location", "gym", "sports_club"]
REACH_M = 150      # the same reach as supabase/functions/_shared/arenaplace.js: the arena the person meant


def metres_between(a_lat, a_lng, b_lat, b_lng) -> float:
    r = math.radians
    h = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lng - a_lng) / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(h))


def pick_at_pin(places: list, lat: float, lng: float):
    """The arena-kind place nearest the pin within REACH_M, as the fields a venue row stores; None if none is.
    The same choice arena-place makes (supabase/functions/_shared/arenaplace.js has the tests)."""
    best = None
    for p in places or []:
        loc = p.get("location") or {}
        name = ((p.get("displayName") or {}).get("text") or "").strip()
        if not (p.get("id") and name and "latitude" in loc) or not set(p.get("types") or []) & set(ARENA_TYPES):
            continue
        d = metres_between(lat, lng, loc["latitude"], loc["longitude"])
        if d <= REACH_M and (best is None or d < best[0]):
            best = (d, p, name)
    if not best:
        return None
    d, p, name = best
    cc = component(p, "country")
    return {"place_id": p["id"], "name": name, "address": p.get("formattedAddress"),
            "city": component(p, "locality", "postal_town", "administrative_area_level_3", "administrative_area_level_2") or None,
            "country": None, "distance_m": round(d), "_cc": cc}


def nearby_search(key: str, budget: Budget, lat: float, lng: float, lang: str = "en", session=None):
    """Places API (New) Nearby Search around a pin: arena kinds, nearest first. One request, one count."""
    budget.take()
    r = (session or requests).post(NEARBY_URL, timeout=30, json={
        "includedTypes": ARENA_TYPES, "maxResultCount": 10, "rankPreference": "DISTANCE", "languageCode": lang,
        "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(REACH_M)}}},
        headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS, "Content-Type": "application/json"})
    if r.status_code != 200:
        raise GoogleError(f"Google answered {r.status_code}: {r.text[:160]}")
    return r.json().get("places") or []


def fill_from_pins(sb, key, budget, ids, write, out=print):
    """What is at each arena's OWN pin (never moved): its name, address, town, country and Google place put
    on the row. For an arena whose pin was corrected by hand and whose place data still describes the old
    spot (0175 stops that happening; this mends the ones from before, and is what the console's "read the
    name and address at this pin" does, through the arena-place function)."""
    for vid in ids:
        rows = sb.select("venues", f"id=eq.{vid}&select=id,name,country,city,address,lat,lng,place_id")
        if not rows or rows[0].get("lat") is None:
            out(f"  {vid}: no such arena, or no pin")
            continue
        v = rows[0]
        got = pick_at_pin(nearby_search(key, budget, v["lat"], v["lng"], LANGS.get(v.get("country") or "", "en")), v["lat"], v["lng"])
        if not got:
            out(f"  NONE {v['name']}: no arena within {REACH_M} m of its pin")
            continue
        cc = (got.pop("_cc", None) or "").upper()
        patch = {"address": got["address"], "city": got["city"], "place_id": got["place_id"]}
        if real_country(cc):
            patch["country"] = cc
        if got["name"].strip().lower() != v["name"].strip().lower():
            patch["name"] = got["name"]
        out(f"  {'SET ' if write else 'WOULD'} {v['name']}  ->  {got['name']} | {got['city']} | {patch.get('country', v['country'])} | "
            f"{got['distance_m']} m from the pin | {(got['address'] or '')[:70]}")
        if not write:
            continue
        sb.patch("venues", f"id=eq.{v['id']}", patch)
        if "name" in patch:
            k = sb.rpc("venue_key", {"p_name": patch["name"]})
            if k and not sb.select("venue_aliases", f"key=eq.{k}&select=venue_id"):
                sb.insert("venue_aliases", {"key": k, "venue_id": v["id"], "spelling": patch["name"]})


def merge_rows(sb, keep: str, other: str):
    """One arena under two rows: `other`'s spellings, games and clubs move to `keep`, then `other` goes.
    Everything that points at the row first: deleting it first would null the links (on delete set null)."""
    if keep == other:
        raise ValueError("an arena cannot be merged into itself")
    sb.patch("venue_aliases", f"venue_id=eq.{other}", {"venue_id": keep})
    sb.patch("games", f"venue_id=eq.{other}", {"venue_id": keep})
    sb.patch("teams", f"home_venue_id=eq.{other}", {"home_venue_id": keep})
    sb.delete("venues", f"id=eq.{other}")


def merge_same_places(sb, write, out=print):
    rows = select_all(sb, "venues", "select=id,name,place_id,pin_note,created_at&place_id=not.is.null&pin_note=is.null&order=created_at")
    groups = {}
    for v in rows:
        groups.setdefault(v["place_id"], []).append(v)
    groups = [g for g in groups.values() if len(g) > 1]
    busy = games_per_venue(sb) if groups else {}
    out(f"{len(groups)} Google places named by more than one arena row")
    merged = left = 0
    for g in groups:
        g.sort(key=lambda v: (-busy.get(v["id"], 0), v["created_at"]))
        keep, rest = g[0], [v for v in g[1:] if same_arena(g[0]["name"], v["name"])]
        others = [v for v in g[1:] if v not in rest]
        if rest:
            out(f"  MERGE {keep['name']}  <-  " + " | ".join(v["name"] for v in rest))
        if others:
            out(f"  LOOK  {keep['name']}  ?  " + " | ".join(v["name"] for v in others) + "   [one place, different names]")
        merged += len(rest)
        left += len(others)
        if not write:
            continue
        for v in rest:
            merge_rows(sb, keep["id"], v["id"])
    out(f"{merged} rows {'merged' if write else 'to merge'}, {left} left for a person"
        + ("" if write else " (nothing written: --write)"))


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # arena names in Japanese and Greek, on a Windows console too
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--write", action="store_true", help="store the pins (without it, only report)")
    ap.add_argument("--limit", type=int, default=5, help="how many to look up (default 5)")
    ap.add_argument("--all", action="store_true", help="every one still to do (the cap still applies)")
    ap.add_argument("--clubs", action="store_true", help="the clubs pass instead of the arenas pass")
    ap.add_argument("--merge", action="store_true", help="merge rows that are one Google place (no lookups)")
    ap.add_argument("--retry", action="store_true", help="arenas pass: try again the ones not found before")
    ap.add_argument("--venue", help="one arena's id: look it up again and replace its pin")
    ap.add_argument("--merge-into", nargs=2, metavar=("KEEP_ID", "OTHER_ID"),
                    help="a person's merge: OTHER's spellings, games and clubs move to KEEP (with --write)")
    ap.add_argument("--hinted", action="store_true",
                    help="look up again, by their full names, the arenas arena_hints.json names (replaces their pins)")
    ap.add_argument("--recheck", action="store_true",
                    help="judge every unchecked Google pin again by the current rules; list (or --write) the changes")
    ap.add_argument("--from-pin", nargs="+", metavar="ID",
                    help="arenas by id: read what is at each one's own pin (name, address, town, country, place) and put it on the row")
    ap.add_argument("--cap", type=int, default=DAY_CAP, help=f"lookups a day, at most {DAY_CAP}")
    ap.add_argument("--usage", action="store_true", help="print the lookups used and stop")
    args = ap.parse_args(argv)
    budget = Budget(appdata("google_usage.json"), day_cap=args.cap)
    if args.usage:
        s = budget.state()
        print(f"today {s['day_count']}/{budget.day_cap}, this month {s['month_count']}/{budget.month_cap}")
        return 0
    if args.worker_config:
        cfg = json.load(open(appdata("worker.json")))
        os.environ.setdefault("SUPABASE_URL", cfg["supabase_url"])
        os.environ.setdefault("SUPABASE_SERVICE_KEY", cfg["service_key"])
    url, skey = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and skey):
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (use --worker-config)")
        return 2
    import run_ingest as RI
    sb = RI.Supabase(url, skey)
    if args.merge:
        merge_same_places(sb, args.write)
        return 0
    if args.merge_into:
        keep, other = (sb.select("venues", f"id=eq.{i}&select=id,name") for i in args.merge_into)
        if not keep or not other:
            print("no such arena")
            return 2
        print(f"{keep[0]['name']}  <-  {other[0]['name']}" + ("" if args.write else "   (nothing written: --write)"))
        if args.write:
            merge_rows(sb, keep[0]["id"], other[0]["id"])
        return 0
    key = load_key()
    limit = 10 ** 6 if args.all else max(0, args.limit)
    cache = Cache(appdata("google_cache.json"))
    try:
        if args.from_pin:
            fill_from_pins(sb, key, budget, args.from_pin, args.write)
        elif args.clubs:
            pin_clubs(sb, key, budget, limit, args.write, cache=cache)
        else:
            pin_venues(sb, key, budget, limit, args.write, retry=args.retry, cache=cache, venue=args.venue,
                       recheck=args.recheck, hinted=args.hinted)
    except CapReached as exc:
        print(f"STOPPED at the cap: {exc}")
    except GoogleError as exc:
        print(f"STOPPED: {exc}")
        return 1
    s = budget.state()
    print(f"lookups: today {s['day_count']}/{budget.day_cap}, this month {s['month_count']}/{budget.month_cap}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
