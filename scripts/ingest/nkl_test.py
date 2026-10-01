"""Lithuania's NKL (adapters/fiba_site_schedule.py, site "nkl"), offline:

    python scripts/ingest/nkl_test.py

The NKL plays on FIBA LiveStats, but nkl.lt never lists a game's LiveStats id: while a game is being played its own
page (https://nkl.lt/matches/<id>/) answers 302 to the webcast, before that it is a preview, and once the result is
in it is the site's own box score (seen 2026-10-01). What this holds the adapter to:
  * the schedule: the season read from nkl.lt's own inline array (306 games, 18 clubs x 34), keyed on nkl.lt's
    match id, coded by nkl.lt's club ids, crested over https, tip-offs Vilnius -> UTC, "regular" and "playoffs"
    kept apart by the league's stage type, and the site's mojibake ('Å\\xa0akiÅ³') read back as Lithuanian;
  * a game being played: its page asked from five minutes before tip-off (its redirect not followed), the webcast
    it names used as the live feed under nkl.lt's club ids and names, remembered; never asked more than once a
    minute, nor held up for the crawl delay;
  * a finished game: the LiveStats feed only when it AGREES with the site's result (the same clubs, the same final
    score, the game over), else the page's box score - score, quarters, both clubs' players under nkl.lt's player
    ids, the Statistika tab's team lines - published as a result (no event log, no made-up lineup);
  * the fixtures nkl.lt takes off its schedule: named by withdrawn(), and removed by run_ingest.retire_withdrawn
    only while nothing has happened in them.

Fixtures in scripts/ingest/data/nkl/: matches.html as served 2026-09-23, and match-125745.html as served 2026-10-01,
trimmed to the match block (125745 finished 83-108; its webcast had stopped in the 2nd quarter at 15-16).
feed-standin.json is a GENUINE FIBA LiveStats data.json from another league (EABL 2759719) with its two club names
set to a fixture's: it exercises the redirect and the agreement rule, not NKL statistics.
"""
import copy
import json
import os
import re
import sys
import tempfile
import time as _time
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FIBA_DATA_URL, FibaLiveStatsAdapter  # noqa: E402
import run_ingest as RI  # noqa: E402

DATA = os.path.join(HERE, "data", "nkl")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def text(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


STANDIN = json.loads(text("feed-standin.json"))
MATCHES = text("matches.html")
MATCH = text("match-125745.html")
ROWS = json.loads(F._NKL_ALL.search(MATCHES).group(1))
MOJIBAKE = re.compile("[Â-Å]|â€")       # what UTF-8 read as Windows-1252 looks like
PREVIEW = "<span class=nkl-badge-status>Artėjančios Rungtynės</span>"      # a match page before tip-off


def feed(fid):
    return FIBA_DATA_URL.format(game_id=fid)


def page(sid):
    return F.NKL_MATCH.format(id=sid)


def schedule(change=None):
    """matches.html with its array changed by `change(rows)` - a result entered, a fixture withdrawn."""
    rows = copy.deepcopy(ROWS)
    if change:
        rows = change(rows) or rows
    return F._NKL_ALL.sub(lambda m: "const allMatches = " + json.dumps(rows) + ";\n", MATCHES, count=1)


def result(sid, home, away):
    def change(rows):
        for r in rows:
            if str(r["id"]) == str(sid):
                r.update(home_score=home, away_score=away, is_result=1)
    return change


def feed_as(home, away, score=None, final=True, clock=None, period=None):
    """The stand-in LiveStats payload under a fixture's club names: closed or not, at a score and a clock."""
    d = copy.deepcopy(STANDIN)
    d["tm"]["1"]["name"], d["tm"]["2"]["name"] = home, away
    for s in "12":
        d["tm"][s].pop("nameInternational", None)
        d["tm"][s]["shortName"] = ""
    if score:
        d["tm"]["1"]["score"], d["tm"]["2"]["score"] = score
    if not final:
        d["pbp"] = [e for e in d["pbp"] if not (e.get("actionType") == "game" and e.get("subType") == "end")]
    if clock is not None:
        d["clock"], d["period"] = clock, period
    return d


class Offline(F.FibaSiteScheduleAdapter):
    nkl_gap_s = 0.0
    requests_made: list = []
    pages: dict = {}
    redirects: dict = {}
    feeds: dict = {}

    def _page(self, url):
        self.requests_made.append(url)
        if url in self.pages:
            return self.pages[url]
        raise RuntimeError(url)

    def _nkl_open(self, url):
        self.requests_made.append(url)
        m = re.search(r"/matches/(\d+)/", url)
        if m and m.group(1) in self.redirects:
            return 302, self.redirects[m.group(1)], ""
        if url in self.pages:
            return 200, "", self.pages[url]
        raise RuntimeError(url)

    def _get_meta(self, url):
        self.requests_made.append(url)
        m = re.search(r"/data/(\d+)/data\.json", url)
        raw = self.feeds.get(m.group(1)) if m else None
        return (copy.deepcopy(raw) if raw else None), {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh(sched=None, feeds=None, redirects=None, idmap=None):
    Offline.requests_made = []
    Offline.pages = {F.NKL_MATCHES: sched or MATCHES, page("125745"): MATCH, page("125747"): PREVIEW}
    Offline.redirects = dict(redirects or {})
    Offline.feeds = feeds or {}
    Offline.nkl_gap_s = 0.0
    F.FibaSiteScheduleAdapter._nkl_cache = (0.0, [])
    F.FibaSiteScheduleAdapter._nkl_asked = {}
    F.FibaSiteScheduleAdapter._nkl_last = 0.0
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    a, cfg = Offline(), {"code": "NKL", "site": "nkl", "season": "2026-27", "repo_root": tempfile.mkdtemp()}
    if idmap:
        a._save_idmap(cfg, dict(idmap))
    return a, cfg


class Clock:
    """The adapter's clock, set by the test: whether a game's page is asked yet depends on what time it is."""
    def __init__(self, now):
        self.now = now

    def time(self):
        return self.now

    def sleep(self, s):
        self.now += s

    def gmtime(self, *a):
        return _time.gmtime(*a)


print("-- the site's mojibake")
for bad, good in (("Å\xa0akiÅ³ sporto centras", "Šakių sporto centras"),
                  ("KA â€žÅ½algirisâ€œ sporto kompleksas", "KA „Žalgiris“ sporto kompleksas"),
                  ("Jurbarko A.G.G. sporto salÄ—", "Jurbarko A.G.G. sporto salė"),
                  ("Karolis GuÅ¡Ä\x8dikas", "Karolis Guščikas"),          # č is C4 8D: 0x8D has no 1252 character
                  ("ÄŒepelevskij", "Čepelevskij")):
    ok(f"{bad!r} reads {good!r}", F.demojibake(bad) == good, F.demojibake(bad))
ok("text that was right to begin with is left exactly as it was",
   all(F.demojibake(s) == s for s in ("Kauno Žalgiris-2", "Šarūnas Valunta", "José Müller", "Vilnius", "", "Ä")))
ok("anything that is not text passes through", F.demojibake(None) is None and F.demojibake(7) == 7)

print("\n-- the schedule")
a, cfg = fresh()
reg = list(a.discover("https://nkl.lt/matches/", dict(cfg, stage="regular")))
per = defaultdict(int)
for g in reg:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
ok("2026/27 regular season: 306 games, 18 clubs x 34, every club coded by its nkl.lt id",
   len(reg) == 306 and len(per) == 18 and set(per.values()) == {34} and None not in per, (len(reg), len(per)))
g0 = next(g for g in reg if g.external_id == "125745")
ok("125745 Alytaus Patriotai v Kauno Žalgiris-2: codes 3386 / 266, 28 Sep 18:15 Vilnius = 15:15 UTC, in Alytus",
   (g0.home_name, g0.away_name, g0.extra["home_code"], g0.extra["away_code"], g0.tipoff_at, g0.extra["venue"])
   == ("Alytaus Patriotai", "Kauno Žalgiris-2", "3386", "266", "2026-09-28T15:15:00Z", "Alytaus sporto ir rekreacijos centras"),
   (g0.home_name, g0.away_name, g0.extra, g0.tipoff_at))
ok("every crest is https", all((g.extra["home_logo"] or "").startswith("https://nkl.lt/") for g in reg))
ok("nothing played yet: every game scheduled", {g.status for g in reg} == {"scheduled"})
ok("the play-off source finds nothing yet", list(a.discover("https://nkl.lt/matches/#playoffs", dict(cfg, stage="playoffs"))) == [])
ok("another season's games are not this season's", list(a.discover("x", dict(cfg, season="2025-26"))) == [])
ok("the whole season is one request", Offline.requests_made.count(F.NKL_MATCHES) == 1, Offline.requests_made)

# the arenas as nkl.lt served them on 2026-10-01: UTF-8 read as Windows-1252
SERVED = {"Šakių sporto centras": "Å\xa0akiÅ³ sporto centras", "KA „Žalgiris“ sporto kompleksas": "KA â€žÅ½algirisâ€œ sporto kompleksas",
          "Jurbarko A.G.G. sporto salė": "Jurbarko A.G.G. sporto salÄ—", "Plungės sporto arena": "PlungÄ—s sporto arena"}


def mangle(rows):
    for r in rows:
        r["arena"] = SERVED.get(r["arena"], r["arena"])


a, cfg = fresh(schedule(mangle))
reg2 = list(a.discover("https://nkl.lt/matches/", dict(cfg, stage="regular")))
venues = {g.extra["venue"] for g in reg2}
ok("arenas served as mojibake are read as Lithuanian: Šakių sporto centras, KA „Žalgiris“ sporto kompleksas",
   {"Šakių sporto centras", "KA „Žalgiris“ sporto kompleksas", "Jurbarko A.G.G. sporto salė"} <= venues
   and not any(MOJIBAKE.search(v or "") for v in venues), sorted(v for v in venues if MOJIBAKE.search(v or "")))
ok("...and the venues are the same as on the day they were served properly",
   [g.extra["venue"] for g in reg2] == [g.extra["venue"] for g in reg])

print("\n-- the match page (125745, 83-108)")
mp = F.nkl_match_page(MATCH)
ok("the score, the badge, the quarters and the clubs' abbreviations",
   mp["score"] == (83, 108) and mp["status"] == "Rungtynės Baigėsi" and mp["periods"] == ["Q1", "Q2", "Q3", "Q4"]
   and mp["quarters"] == ([16, 22, 19, 26], [32, 22, 28, 26]) and mp["abbr"] == ("PAT", "ŽAL"),
   {k: mp[k] for k in ("score", "status", "periods", "quarters", "abbr")})
ok("the arena and the referees, read back from the page's mojibake",
   mp["venue"] == "Alytaus sporto ir rekreacijos centras"
   and mp["referees"] == ["Milita Stalaučinskaitė", "Ernest Čepelevskij", "Simas Baranauskas"], (mp["venue"], mp["referees"]))
home_box, away_box = mp["teams"]
ok("both clubs' box scores: 12 + 12 players, home first", (home_box["name"], len(home_box["players"]), away_box["name"], len(away_box["players"]))
   == ("Alytaus Patriotai", 12, "Kauno Žalgiris-2", 12), (home_box["name"], away_box["name"]))
ok("Karolis Guščikas: #10, 29:13, 17 pts, 7/11 (7/11 two, 0/0 three), 3/8 FT, 18 reb, 3 ast, eff 29, nkl.lt id 7053",
   home_box["players"][0] == {"id": "7053", "name": "Karolis Guščikas", "shirt": "10", "min": "29:13", "pts": 17, "fg": (7, 11),
                              "fg2": (7, 11), "fg3": (0, 0), "ft": (3, 8), "reb": 18, "ast": 3, "stl": 0, "tov": 0, "blk": 0, "eff": 29},
   home_box["players"][0])
names = [p["name"] for t in mp["teams"] for p in t["players"]]
ok("no player's name is left in mojibake (Šarūnas Valunta, Ignas Štombergas, Titas Lavrinovič)",
   not any(MOJIBAKE.search(n) for n in names) and {"Šarūnas Valunta", "Ignas Štombergas", "Titas Lavrinovič"} <= set(names), names)
ok("each club's points add up to the score", [sum(p["pts"] for p in t["players"]) for t in mp["teams"]] == [83, 108])
hs, as_ = mp["stats"]
ok("the Statistika tab's team lines: 31/73 and 37/71, rebounds 39 (18 off, 21 def) and 35 (10, 25), fouls 27 and 20",
   (hs["sFieldGoalsMade"], hs["sFieldGoalsAttempted"], as_["sFieldGoalsMade"], as_["sFieldGoalsAttempted"],
    hs["sReboundsTotal"], hs["sReboundsOffensive"], hs["sReboundsDefensive"], as_["sReboundsTotal"], as_["sReboundsOffensive"],
    as_["sReboundsDefensive"], hs["sFoulsPersonal"], as_["sFoulsPersonal"]) == (31, 73, 37, 71, 39, 18, 21, 35, 10, 25, 27, 20), (hs, as_))
ok("...and what only a team has: points off turnovers 12/29, fast break 12/30, second chance 14/18, bench 36/53",
   [(hs[k], as_[k]) for k in ("sPointsFromTurnovers", "sPointsFastBreak", "sPointsSecondChance", "sBenchPoints")]
   == [(12, 29), (12, 30), (14, 18), (36, 53)])
blank = F.nkl_match_page("<html><body>nothing here</body></html>")
ok("a page with none of it reads as nothing, without an error", blank["score"] is None and blank["teams"] == [] and blank["stats"] == ({}, {}))
odd = {"teams": [{"name": "Kauno Žalgiris-2", "players": [{"id": "1", "name": "A B", "pts": 2}]},
                 {"name": "Alytaus Patriotai", "players": [{"id": "2", "name": "C D", "pts": 3}]}],
       "score": (2, 3), "quarters": ([2], [3]), "abbr": ("ŽAL", "PAT"), "stats": ({}, {})}
fx = next(r for r in ROWS if r["id"] == 125745)
ok("a page that draws the clubs the other way round from the fixture is refused (never filed under the wrong club)",
   F.nkl_payload(odd, fx) is None)
ok("a page with no box score for one of the clubs is not a result yet",
   F.nkl_payload(dict(odd, teams=[odd["teams"][1], {"name": "Kauno Žalgiris-2", "players": []}]), fx) is None)

print("\n-- a finished game with no feed that agrees: its page's box score")
a, cfg = fresh(schedule(result("125745", 83, 108)))
b = a.fetch("125745", cfg)
ok("125745 is fetched, keyed on the nkl.lt id, final", b is not None and b.external_id == "125745" and b.status == "final",
   b and (b.external_id, b.status))
ok("...published as a result: no event log to replay (translate False), and the arena from its page",
   b.translate is False and b.venue == "Alytaus sporto ir rekreacijos centras", (b.translate, b.venue))
ok("...nkl.lt's club ids as the codes and its names on both clubs",
   (b.team["home"]["team_code"], b.team["away"]["team_code"], b.home_name, b.away_name) == ("3386", "266", "Alytaus Patriotai", "Kauno Žalgiris-2"))
th, ta = b.team["home"], b.team["away"]
ok("...83-108, the quarters, and the team lines from the Statistika tab (fouls, the rebound split, bench points)",
   (th["points"], ta["points"], th["q_scores"], ta["q_scores"], th["oreb"], th["dreb"], ta["oreb"], ta["dreb"], th["pf"], ta["pf"], th["pts_bench"], ta["pts_bench"])
   == (83, 108, [16, 22, 19, 26], [32, 22, 28, 26], 18, 21, 10, 25, 27, 20, 36, 53), th)
gu = next(r for r in b.box["home"] if r["player_id"] == "7053")
ok("...12 + 12 box lines, each player under his nkl.lt id: 7053 Guščikas 17 pts, 18 reb, 29:13",
   len(b.box["home"]) == 12 and len(b.box["away"]) == 12 and gu["short_name"] == "Karolis Guščikas"
   and (gu["sPoints"], gu["sReboundsTotal"], gu["sMinutes"], gu["shirt"], gu["eff_1"]) == (17, 18, "29:13", "10", 29), gu)
ok("...a lead '0' off the minutes, as LiveStats writes them (03:09 -> 3:09)",
   next(r["sMinutes"] for r in b.box["home"] if r["player_id"] == "39726") == "3:09")
ok("...and NO stints: nobody started, nobody was subbed - a lineup would be made up", b.stints == [] and not any(b.lineups.values()),
   (len(b.stints), b.lineups))
ok("the requests: the schedule, the one feed the offset names (none there), then the match page",
   Offline.requests_made == [F.NKL_MATCHES, feed(125745 + F.NKL_OFFSET), page("125745")], Offline.requests_made)
b2 = a.fetch("125745", cfg)
ok("a second read of the same page is the same payload (an unchanged final is not written again)", b2.payload_hash == b.payload_hash)

print("\n-- a finished game whose LiveStats feed agrees with the site")
OFF = str(125745 + F.NKL_OFFSET)                       # 2895455
CLUBS = ("Alytaus Patriotai", "Kauno Žalgiris-2")
a, cfg = fresh(schedule(result("125745", 65, 95)), feeds={OFF: feed_as(*CLUBS)})
b = a.fetch("125745", cfg)
ok("the same clubs, closed, the same score (65-95 on both): the feed is used, for its play-by-play",
   b is not None and b.translate is None and b.status == "final" and b.stints and len(b.box["home"]) == len(STANDIN["tm"]["1"]["pl"])
   and (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"], b.home_name) == ("3386", "266", "Alytaus Patriotai"),
   b and (b.translate, b.status, len(b.stints)))
ok("...the match page never read, and the feed remembered for the game", page("125745") not in Offline.requests_made
   and a._idmap(cfg).get("125745") == OFF, (Offline.requests_made, a._idmap(cfg)))
a, cfg = fresh(schedule(result("125745", 65, 95)), feeds={"2899999": feed_as(*CLUBS)}, idmap={"125745": "2899999"})
b = a.fetch("125745", cfg)
ok("the feed its page sent us to while it was played comes first: 2899999, the offset never asked",
   b is not None and b.translate is None and feed("2899999") in Offline.requests_made and feed(OFF) not in Offline.requests_made,
   Offline.requests_made)
a, cfg = fresh(schedule(result("125745", 65, 95)), feeds={OFF: feed_as(*CLUBS, final=False)})
b = a.fetch("125745", cfg)
ok("a scorer who never sent the close (clock run out in the 4th, the same score): still the feed, and final",
   b is not None and b.translate is None and b.status == "final", b and (b.translate, b.status))
a, cfg = fresh(schedule(result("125745", 65, 95)), feeds={"126745": feed_as(*CLUBS)},
               idmap={"1": "1001", "2": "1002", "3": "1003"})
b = a.fetch("125745", cfg)
ok("the offset the remembered pairs share (three or more of them) is the one tried: 125745 + 1000",
   b is not None and b.translate is None and feed("126745") in Offline.requests_made, Offline.requests_made)
for label, site, fd in (
        ("a webcast that stopped (the site says 83-108, the feed 65-95)", (83, 108), feed_as(*CLUBS)),
        ("a webcast stopped in the 2nd quarter at the very score", (65, 95), feed_as(*CLUBS, final=False, clock="07:10", period=2)),
        ("a feed of two other clubs (126051 + the offset: a Chilean game)", (65, 95), feed_as("Somebody Else", "Another Club"))):
    a, cfg = fresh(schedule(result("125745", *site)), feeds={OFF: fd})
    b = a.fetch("125745", cfg)
    ok(f"{label}: passed over for nkl.lt's own box score, and not remembered", b is not None and b.translate is False
       and (b.team["home"]["points"], b.team["away"]["points"]) == (83, 108) and page("125745") in Offline.requests_made
       and "125745" not in a._idmap(cfg), b and (b.translate, b.team["home"]["points"], a._idmap(cfg)))
a, cfg = fresh(schedule(result("125745", 83, 108)), redirects={"125745": "http://www.fibalivestats.com/u/NKLNBL/2895455"})
ok("a result the site has entered while its page still sends the game to LiveStats: nothing yet, asked again later",
   a.fetch("125745", cfg) is None)

print("\n-- a game being played: its page sends it to LiveStats")
TIP = datetime(2026, 10, 1, 16, 0, tzinfo=timezone.utc).timestamp()     # 125747, 19:00 in Vilnius
WEBCAST = "http://www.fibalivestats.com/u/NKLNBL/2895457"
LIVE = feed_as("Jurbarko Jurbarkas-Karys-Manvesta", "Alytaus Patriotai", final=False, clock="07:10", period=2)
clock = Clock(TIP - 600)
F.time = clock
try:
    a, cfg = fresh(feeds={"2895457": LIVE})
    ok("ten minutes before tip-off: nothing to ask - the page is a preview - and only the schedule read",
       a.fetch("125747", cfg) is None and Offline.requests_made == [F.NKL_MATCHES], Offline.requests_made)
    clock.now = TIP - 120
    ok("two minutes before: its page asked, still the preview (no redirect) - nothing yet",
       a.fetch("125747", cfg) is None and Offline.requests_made.count(page("125747")) == 1, Offline.requests_made)
    clock.now += 30
    ok("...not asked again inside the minute", a.fetch("125747", cfg) is None and Offline.requests_made.count(page("125747")) == 1)
    Offline.redirects = {"125747": WEBCAST}
    clock.now += 31
    b = a.fetch("125747", cfg)
    ok("tip-off: the page answers 302 to u/NKLNBL/2895457, and that feed is the game - live, with its event log",
       b is not None and b.external_id == "125747" and b.status == "live" and b.translate is None and b.stints,
       b and (b.external_id, b.status, b.translate))
    ok("...under nkl.lt's club ids and names (Jurbarkas 2250 at home, Alytus 3386 away)",
       (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"], b.home_name, b.away_name)
       == ("2250", "3386", "Jurbarko Jurbarkas-Karys-Manvesta", "Alytaus Patriotai"), (b.raw["tm"]["1"]["code"], b.home_name))
    ok("...and remembered", a._idmap(cfg).get("125747") == "2895457", a._idmap(cfg))
    n = len(Offline.requests_made)
    a.fetch("125747", cfg)
    ok("every poll after that is the feed alone: no request to nkl.lt", Offline.requests_made[n:] == [feed("2895457")],
       Offline.requests_made[n:])

    a, cfg = fresh(feeds={"2895999": feed_as("Somebody Else", "Another Club", final=False)},
                   redirects={"125747": "http://www.fibalivestats.com/u/NKLNBL/2895999"})
    clock.now = TIP + 60
    ok("a page that sends the game to a feed of two other clubs: not used", a.fetch("125747", cfg) is None)

    a, cfg = fresh(feeds={"2895457": LIVE}, redirects={"125747": WEBCAST})
    a._nkl_matches()
    Offline.nkl_gap_s = 10.0
    F.FibaSiteScheduleAdapter._nkl_last = clock.now     # another game's page has just been asked
    n = len(Offline.requests_made)
    ok("the live lane, the crawl delay not up: nothing asked, an answer of None, and the lane not held up",
       a.fetch("125747", dict(cfg, _live=True)) is None and Offline.requests_made[n:] == []
       and clock.now == F.FibaSiteScheduleAdapter._nkl_last)
    clock.now += 10
    ok("...its next pass, ten seconds on, asks", a.fetch("125747", dict(cfg, _live=True)) is not None)
    a, cfg = fresh(feeds={"2895457": LIVE}, redirects={"125747": WEBCAST})
    a._nkl_matches()
    Offline.nkl_gap_s = 10.0
    F.FibaSiteScheduleAdapter._nkl_last = t0 = clock.now
    ok("a catch-up or discovery pass waits the crawl delay out (ten seconds), then asks",
       a.fetch("125747", cfg) is not None and clock.now == t0 + 10, clock.now - t0)

    a, cfg = fresh()
    clock.now = TIP + 40 * 60
    a.fetch("125747", cfg)
    clock.now += 5 * 60
    a.fetch("125747", cfg)
    clock.now += 5 * 60 + 1
    a.fetch("125747", cfg)
    ok("forty minutes on and still no webcast: its page asked every ten minutes, not every minute",
       Offline.requests_made.count(page("125747")) == 2, Offline.requests_made)
    ok("a game nkl.lt no longer lists (126055, entered and deleted): None, its page never asked",
       a.fetch("126055", cfg) is None and page("126055") not in Offline.requests_made)
finally:
    F.time = _time

print("\n-- fixtures nkl.lt takes off its schedule")


def rewrite(rows):
    # 125746 deleted (re-entered as 126051), one more game added; 126055 never on it
    rows[:] = [r for r in rows if r["id"] != 125746]
    rows.append(dict(next(r for r in ROWS if r["id"] == 125746), id=126051))


a, cfg = fresh(schedule(rewrite))
stored = {"125746": {"external_id": "125746", "tipoff_at": "2026-09-30T17:00:00+00:00"},
          "126055": {"external_id": "126055", "tipoff_at": "2026-10-01T13:30:00+00:00"},
          "126051": {"external_id": "126051", "tipoff_at": "2026-09-30T17:00:00+00:00"},
          "125745": {"external_id": "125745", "tipoff_at": "2026-09-28T15:15:00+00:00"},
          "111111": {"external_id": "111111", "tipoff_at": "2026-03-01T15:00:00+00:00"}}
ok("withdrawn(): the two fixtures no longer listed (125746, 126055) - not a listed one, not last season's (March 2026)",
   a.withdrawn(cfg, stored) == ["125746", "126055"], a.withdrawn(cfg, stored))
ok("...every other site cannot say (its schedule is a window): []", a.withdrawn(dict(cfg, site="czech"), stored) == [])
a, cfg = fresh("<html>the schedule page did not load</html>")
ok("...a schedule that did not load says nothing is gone", a.withdrawn(cfg, stored) == [])


class Sb:
    """games, game_events and external_games, and every delete asked for."""
    def __init__(self, games, events=()):
        self.games, self.events, self.deletes = {g["id"]: dict(g) for g in games}, set(events), []

    def select(self, table, q):
        gid = re.search(r"(?:^|&)(?:game_)?id=eq\.([^&]+)", q).group(1)
        if table == "games":
            return [dict(self.games[gid])] if gid in self.games else []
        if table == "game_events":
            return [{"seq": 1}] if gid in self.events else []
        raise AssertionError(table)

    def delete(self, table, q):
        self.deletes.append((table, q))
        if table == "games":
            self.games.pop(re.search(r"id=eq\.([^&]+)", q).group(1), None)
        return True


class Says:
    """An adapter whose schedule no longer lists the ids it is given."""
    def __init__(self, ids):
        self.ids = ids

    def withdrawn(self, config, stored):
        return list(self.ids)


SRC = {"adapter": "fiba_site_schedule", "code": "NKL", "label": "NKL", "adapter_config": {"site": "nkl"}}


def ext(xid, gid, **kw):
    return dict({"external_id": xid, "game_id": gid, "external_status": "scheduled", "payload_hash": None,
                 "home_name": "Alytaus Patriotai", "away_name": "Jurbarko Jurbarkas-Karys-Manvesta", "tipoff_at": "2026-10-01T13:30:00+00:00"}, **kw)


many = {str(i): ext(str(i), f"g{i}") for i in range(100)}
sb = Sb([{"id": "g1", "status": "scheduled", "home_score": None, "away_score": None},
         {"id": "g2", "status": "scheduled", "home_score": None, "away_score": None}])
st = dict(many, a=ext("a", "g1"), b=ext("b", "g2"))
got = RI.retire_withdrawn(sb, SRC, Says(["a", "b"]), st)
ok("retire_withdrawn: a scheduled, scoreless fixture with no play is removed - its game, then its feed row",
   got == ["a", "b"] and sb.deletes[:2] == [("games", "id=eq.g1&status=eq.scheduled"),
                                            ("external_games", "adapter=eq.fiba_site_schedule&competition_code=eq.NKL&external_id=eq.a")],
   (got, sb.deletes))
sb = Sb([{"id": "g1", "status": "final", "home_score": 80, "away_score": 70},
         {"id": "g2", "status": "scheduled", "home_score": None, "away_score": None},
         {"id": "g3", "status": "scheduled", "home_score": 2, "away_score": 0},
         {"id": "g4", "status": "void", "home_score": None, "away_score": None}], events={"g2"})
st = dict(many, a=ext("a", "g1"), b=ext("b", "g2"), c=ext("c", "g3"), d=ext("d", "g4"),
          e=ext("e", "g5", payload_hash="abc"), f=ext("f", "g6", external_status="final"))
ok("...but never one that was played, has a play recorded, a score, was voided, or was ever fetched",
   RI.retire_withdrawn(sb, SRC, Says(["a", "b", "c", "d", "e", "f"]), st) == [] and sb.deletes == [], sb.deletes)
sb = Sb([])
ok("...a fixture whose game is already gone loses its feed row",
   RI.retire_withdrawn(sb, SRC, Says(["x"]), dict(many, x=ext("x", None))) == ["x"]
   and sb.deletes == [("external_games", "adapter=eq.fiba_site_schedule&competition_code=eq.NKL&external_id=eq.x")])
sb = Sb([{"id": f"g{i}", "status": "scheduled", "home_score": None, "away_score": None} for i in range(100)])
ok("...a schedule that seems to have lost dozens of games is a page that did not load: nothing removed",
   RI.retire_withdrawn(sb, SRC, Says([str(i) for i in range(30)]), many) == [] and sb.deletes == [])
ok("...and an adapter that cannot say (no withdrawn()) removes nothing", RI.retire_withdrawn(Sb([]), SRC, object(), many) == [])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
