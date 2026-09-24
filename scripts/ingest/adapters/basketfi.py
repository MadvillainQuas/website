"""Finland (basket.fi) — Korisliiga, Naisten Korisliiga, I divisioona A and B: TorneoPal's schedule,
Sportradar's EUI game feed.

TWO HOSTS, ONE ADAPTER, ONE CONFIG ROW PER LEAGUE AND STAGE. The federation's result service,
tulospalvelu.basket.fi, is TorneoPal. It holds the fixtures, venues, tip-offs and the OFFICIAL results.
Every match page on it embeds Sportradar's "EUI Connect" widget as website 322, and that is where the
box score and the play-by-play live: the same feed LnbAdapter already translates for France and
Mexico, so the game side is inherited unchanged.

    GET koripallo-api.torneopal.net/taso/rest/getMatches?competition_id=huki2627&category_id=4
        -> one league's season: every fixture, played or not. competition_id is the season's top
           series ("huki" + the two years); a category is one league (4 Korisliiga, 1 Naisten
           Korisliiga, 2 Miesten I divisioona A, 29461 Miesten I divisioona B). The API answers only
           the site's own Origin, with the site's own Accept "key" (from its bundle).
    GET embed-api.eui.connect.sportradar.com/v1/embed/322/fixtures?state=<{"l","s","z"}>
        -> the same season in the EUI's words: club codes (KTP, SEA) and each fixture's status
    GET .../322/fixture_detail?state=...&fixtureId=...   (LnbAdapter.fetch)
        -> the game, twice: the play-by-play and the box score

THE TWO ARE JOINED BY TORNEOPAL'S OWN FIELDS: a category's category_external_id IS the EUI season id,
and a match's match_external_id IS the EUI fixture id. So a game is keyed "<season>_<fixture>", as
LNB's are, and LnbAdapter.fetch reads it as it stands.

TORNEOPAL LEAVES SOME LINKS BLANK. In 2026-27, 18 of Naisten Korisliiga's 108 fixtures and 15 of
I divisioona A's 132 have no match_external_id, while the EUI lists every one of them. Those are
joined on the two clubs and the local date. That is safe because the two systems name the clubs
identically: every linked fixture of all four leagues in 2026-27 was compared, and none differs.
A fixture that still finds no partner is left off, and printed; it is listed once the link appears.

THE STAGE COMES FROM TORNEOPAL'S GROUP. group_type knockout_* is the play-offs ("Pudotuspelit",
one group per round in the divisions). group_stage is the regular season, and so is
additional_group_stage: Korisliiga 2025-26 split into an upper and a lower "jatkosarja" after 22
rounds with the points carried over, and that is still its regular season. A match_type "series"
row is a play-off series' own summary line (7 of Korisliiga 2025-26's 50 play-off rows), not a
game, and is skipped. adapter_config.stage picks which of the two a source row takes, as with PLK's.

THE OFFICIAL RESULT IS TORNEOPAL'S, AND A GAME THE TWO DISAGREE ON IS HELD. Checked on six played
pre-season games: five matched exactly, but in Leppävaaran Pyrintö v Puhuttaret (4 Sep 2026) the
stats feed ends at 63-63 after four periods and holds no overtime at all, while the official result
is 64-63 after overtime. Filing the feed's version would put a draw in a table. So when TorneoPal
calls a game played and the feed's final differs, fetch returns nothing and says so; the game stays
a fixture until the feed is corrected, as a CIBA game with no stats does.

CLUB CODES come from the EUI listing (KTP, SEA, KAT). Some clubs have none (Kipinä Basket, Karkkila,
BC Nokia's men) and are found by name, which the two systems agree on. A code is only believed when it
reads as an abbreviation of its club, its letters in order within the name: KTP, SEA (Helsinki
SEAgulls) and KHJ (Kauhajoki) do, but the EUI gives Kouvottaret "SAL" and ACO Basket "OUL", and a
club's code becomes its short name on every fixture card. A code two clubs of one league share would
make them one club (a club is keyed on its code). Either kind is dropped on both sides, here and in the
game feed (_club_code), so the club is keyed and shown by its name.

TIP-OFFS are TorneoPal's local date and time with the match's own UTC offset (+03:00 in September,
+02:00 from late October), so the clock change needs no rule here. The offset is written "+0200" in
the fixture list and "+03:00" in a single match; both are read.

THE PRE-SEASON GAMES ("Valmistavat ottelut", categories 39227 and 42825) are not a league and have no
config row. Six of them are the offline test's games (basketfi_test.py); publishing them would mix
friendlies into each league's whole-season numbers.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Iterable, Optional

from .base import ScheduleGame
from .lnb import EUI_EMBED, FINAL_STATUS, LnbAdapter, _season_year, page_state

TORNEOPAL = "https://koripallo-api.torneopal.net/taso/rest"
SITE = "https://tulospalvelu.basket.fi"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"
#: TorneoPal answers only its own site, and only with this Accept value (it is in the site's bundle)
TP_HEADERS = {"Accept": "json/df8e84j9xtdz269euy3h", "Origin": SITE, "Referer": SITE + "/", "User-Agent": UA}
EUI_HEADERS = {"User-Agent": UA, "Referer": SITE + "/", "Origin": SITE}
LIVE_STATUS = {"IN_PROGRESS", "INPROGRESS", "LIVE", "STARTED", "HALFTIME", "BREAK"}
#: an unlinked fixture's EUI partner may sit this many days from TorneoPal's date (a moved game)
LINK_WINDOW_DAYS = 21


def competition_id(config: dict) -> str:
    """TorneoPal's id for a season's top series: "huki" + the two years (2026-27 -> huki2627)."""
    if config.get("torneopal_competition"):
        return str(config["torneopal_competition"])
    y = _season_year(config)
    return f"huki{y % 100:02d}{(y + 1) % 100:02d}"


def stage_of(m: dict) -> str:
    """ "playoffs" for a knock-out group, "regular" for the rest (the jatkosarja included)."""
    gt = str(m.get("group_type") or "").lower()
    return "playoffs" if gt.startswith("knockout") or "playoff" in gt else "regular"


def _key(name) -> str:
    """A club's name as a join key: case, spacing and hyphens do not make a different club."""
    return re.sub(r"[\s\-]+", " ", str(name or "")).strip().casefold()


def _fold(s) -> str:
    """Lower case without accents: "Äänekosken" -> "aanekosken"."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(ch)).casefold()


def plausible(code, name) -> bool:
    """Is a code an abbreviation of its club: two to five letters, in order within the name?"""
    c = _fold(code)
    if not re.fullmatch(r"[a-z]{2,5}", c):
        return False
    rest = iter(_fold(name))
    return all(ch in rest for ch in c)


def _int(v) -> Optional[int]:
    s = str(v if v is not None else "").strip()
    return int(s) if s.isdigit() else None


def _offset(v) -> str:
    """"+0200" or "+02:00" -> "+02:00"; Helsinki's winter offset when the match gives none."""
    m = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", str(v or "").strip())
    return f"{m.group(1)}{m.group(2)}:{m.group(3)}" if m else "+02:00"


def tipoff(m: dict) -> tuple:
    """(ISO UTC, time_tbc) from TorneoPal's local date, time and offset; (None, False) with no date."""
    d = str(m.get("date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        return None, False
    t = str(m.get("time") or "").strip()
    if not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", t) or t.startswith("00:00"):
        # a date without its time: noon UTC on the local date, the PLK / U SPORTS convention
        return f"{d}T12:00:00Z", True
    if len(t) == 5:
        t += ":00"
    dt = datetime.fromisoformat(f"{d}T{t}{_offset(m.get('time_zone_offset'))}")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False


def status_of(m: dict, fx: dict) -> str:
    """final / live / scheduled, from TorneoPal's word first and the EUI's second."""
    st = str(m.get("status") or "").strip().lower()
    eui = str(((fx or {}).get("status") or {}).get("value") or "").upper()
    if st == "played" or eui in FINAL_STATUS:
        return "final"
    if st in ("live", "playing", "ongoing", "started") or eui in LIVE_STATUS:
        return "live"
    return "scheduled"


class BasketFiAdapter(LnbAdapter):
    name = "basketfi"
    eui_site = 322
    locale = "en-EN"
    headers = EUI_HEADERS

    # ---------------------------------------------------------------- the reads ---
    def _category(self, config: dict) -> int:
        cat = config.get("category")
        if cat in (None, ""):
            raise ValueError("basketfi: adapter_config.category (TorneoPal's category id) is required")
        return int(cat)

    def _matches(self, comp: str, cat: int) -> list:
        """A league's season on TorneoPal, read once per adapter."""
        memo = self.__dict__.setdefault("_tp_matches", {})
        if (comp, cat) not in memo:
            reply = self._req("GET", f"{TORNEOPAL}/getMatches", headers=TP_HEADERS,
                              params={"competition_id": comp, "category_id": cat}) or {}
            memo[(comp, cat)] = reply.get("matches") or []
        return memo[(comp, cat)]

    def _season_id(self, comp: str, cat: int, matches: list) -> str:
        """The league's EUI season id: on every match, and on the category itself when none is listed."""
        for m in matches:
            if str(m.get("category_external_id") or "").strip():
                return m["category_external_id"].strip()
        reply = self._req("GET", f"{TORNEOPAL}/getCategories", headers=TP_HEADERS,
                          params={"competition_id": comp}) or {}
        for c in reply.get("categories") or []:
            if str(c.get("category_id")) == str(cat):
                return str(c.get("category_external_id") or "").strip()
        return ""

    def _listing(self, season: str) -> dict:
        """fixtureId -> the EUI's own row for it (clubs, codes, status), both tabs, read once."""
        memo = self.__dict__.setdefault("_eui_listing", {})
        if season not in memo:
            out = {}
            for tab in ("RESULTS", "FIXTURES"):
                reply = self._req("GET", f"{EUI_EMBED}/{self.eui_site}/fixtures", headers=self.headers,
                                  params={"state": page_state({"l": self.locale, "s": season, "z": tab})}) or {}
                for f in (reply.get("data") or {}).get("fixtures") or []:
                    if f.get("fixtureId"):
                        out[f["fixtureId"]] = f
            memo[season] = out
            self._shared_codes(out)
        return memo[season]

    def _shared_codes(self, listing: dict) -> None:
        """Remember every code two clubs of this league share: it identifies neither of them."""
        names = defaultdict(set)
        for f in listing.values():
            for c in f.get("competitors") or []:
                code = (c.get("code") or "").strip()
                if code:
                    names[code].add(_key(c.get("name")))
        shared = self.__dict__.setdefault("_shared", set())
        for code, who in names.items():
            if len(who) > 1:
                shared.add(code)
                print(f"     basketfi: code {code} is worn by {len(who)} clubs ({', '.join(sorted(who))}); "
                      "they are matched by name instead")

    def _club_code(self, competitor: dict) -> str:
        code = super()._club_code(competitor)
        if code in self.__dict__.get("_shared", set()) or not plausible(code, competitor.get("name")):
            return ""
        return code

    @staticmethod
    def link(matches: list, listing: dict) -> dict:
        """match_id -> EUI fixture id: TorneoPal's own link, else the EUI fixture between the same two
        clubs (same way round) on the same local date, else the one nearest in date within
        LINK_WINDOW_DAYS when exactly one is. A fixture already linked is never offered twice."""
        linked, used = {}, set()
        for m in matches:
            fx = str(m.get("match_external_id") or "").strip()
            if fx:
                linked[str(m.get("match_id"))] = fx
                used.add(fx)
        spare = defaultdict(list)                 # (home, away) -> [(local date, fixture id)]
        for fx, f in listing.items():
            if fx in used:
                continue
            cs = f.get("competitors") or []
            h = next((c for c in cs if c.get("isHome")), None)
            a = next((c for c in cs if c is not h), None)
            day = str(f.get("startTimeLocal") or f.get("startTimeUTC") or "")[:10]
            if h and a and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                spare[(_key(h.get("name")), _key(a.get("name")))].append((day, fx))
        for m in matches:
            mid = str(m.get("match_id"))
            day = str(m.get("date") or "")[:10]
            if mid in linked or str(m.get("match_type") or "").lower() == "series" \
                    or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                continue
            cands = [(d, fx) for d, fx in spare.get((_key(m.get("team_A_name")), _key(m.get("team_B_name"))), [])
                     if fx not in used]
            exact = [fx for d, fx in cands if d == day]
            if len(exact) == 1:
                pick = exact[0]
            else:
                near = [fx for d, fx in cands
                        if abs((date.fromisoformat(d) - date.fromisoformat(day)).days) <= LINK_WINDOW_DAYS]
                pick = near[0] if len(near) == 1 and not exact else None
            if pick:
                linked[mid] = pick
                used.add(pick)
        return linked

    # ----------------------------------------------------------------- schedule ---
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        comp, cat = competition_id(config), self._category(config)
        stage = (config.get("stage") or "regular").strip().lower()
        if stage not in ("regular", "playoffs"):
            raise ValueError(f"basketfi: stage must be 'regular' or 'playoffs', not {stage!r}")
        matches = self._matches(comp, cat)
        if not matches:
            print(f"     basketfi {comp}/{cat}: no fixtures published")
            return []
        season = self._season_id(comp, cat, matches)
        listing = self._listing(season) if season else {}
        links = self.link(matches, listing)
        by_fixture = self.__dict__.setdefault("_by_fixture", {})
        league = next((str(m.get("category_name") or "").strip() for m in matches if m.get("category_name")), "")
        out, unlinked = [], []
        for m in matches:
            if str(m.get("match_type") or "").lower() == "series" or stage_of(m) != stage:
                continue
            home, away = str(m.get("team_A_name") or "").strip(), str(m.get("team_B_name") or "").strip()
            tip, tbc = tipoff(m)
            fixture = links.get(str(m.get("match_id")))
            if not (home and away and tip):
                continue                            # a round with its date or clubs still to be set
            if not (season and fixture):
                unlinked.append(f"{home} v {away} {str(m.get('date') or '')[:10]}")
                continue
            by_fixture[fixture] = m
            fx = listing.get(fixture) or {}
            codes = {("home" if c.get("isHome") else "away"): self._club_code(c) for c in fx.get("competitors") or []}
            extra = {"venue": str(m.get("venue_name") or "").strip() or None,
                     "home_code": codes.get("home", ""), "away_code": codes.get("away", ""),
                     "home_logo": str(m.get("club_A_crest") or "").strip() or None,
                     "away_logo": str(m.get("club_B_crest") or "").strip() or None,
                     "round": str(m.get("group_name") or "").strip() or None,
                     "stage": stage, "competition": league, "torneopal": str(m.get("match_id"))}
            if tbc:
                extra["time_tbc"] = True
            out.append(ScheduleGame(external_id=f"{season}_{fixture}", home_name=home, away_name=away,
                                    tipoff_at=tip, status=status_of(m, fx), extra=extra))
        self.last_competitions = [league] if league else []
        out.sort(key=lambda g: (g.tipoff_at or "", g.external_id))
        print(f"     basketfi {league or cat} {comp} {stage}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final)"
              + (f"; {len(unlinked)} with no stats fixture yet: " + "; ".join(unlinked[:5]) if unlinked else ""))
        return out

    # --------------------------------------------------------------------- game ---
    def _official(self, season: str, fixture: str, config: dict) -> Optional[dict]:
        """The TorneoPal match behind an EUI fixture: from this adapter's discovery, else read cold
        (the live lane fetches with no discovery pass) when the row says which league it is."""
        by_fixture = self.__dict__.setdefault("_by_fixture", {})
        if fixture not in by_fixture and config.get("category") not in (None, ""):
            comp, cat = competition_id(config), self._category(config)
            matches = self._matches(comp, cat)
            by_id = {str(m.get("match_id")): m for m in matches}
            for mid, fx in self.link(matches, self._listing(season)).items():
                by_fixture.setdefault(fx, by_id.get(mid))
        return by_fixture.get(fixture)

    def fetch(self, external_id: str, config: dict):
        m = re.match(r"([0-9a-f-]+)_([0-9a-f-]{20,})$", str(external_id))
        if not m:
            return None
        season, fixture = m.group(1), m.group(2)
        official = self._official(season, fixture, config)
        if season not in self.__dict__.get("_eui_listing", {}):
            self._listing(season)                  # the league's shared codes, before the clubs are named
        b = super().fetch(external_id, config)
        if not b or not official:
            return b
        if str(official.get("status") or "").strip().lower() == "played" and b.status == "final":
            off = (_int(official.get("fs_A")), _int(official.get("fs_B")))
            got = (_int(b.raw["tm"]["1"].get("score")), _int(b.raw["tm"]["2"].get("score")))
            if _key(b.home_name) == _key(official.get("team_B_name")) and _key(b.away_name) == _key(official.get("team_A_name")):
                off = (off[1], off[0])              # the feed has the clubs the other way round
            if None not in off and off != got:
                print(f"     basketfi: {b.home_name} v {b.away_name} ({official.get('date')}): the stats feed's final is "
                      f"{got[0]}-{got[1]}, the official result {off[0]}-{off[1]}; held until they agree")
                return None
        return b
