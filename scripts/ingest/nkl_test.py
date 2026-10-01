"""Lithuania's NKL (adapters/fiba_site_schedule.py, site "nkl"), offline:

    python scripts/ingest/nkl_test.py

The NKL's games are read off nkl.lt. What this holds the adapter to:
  * the schedule: the season read from nkl.lt's own inline array (306 games, 18 clubs x 34), keyed
    on nkl.lt's match id, coded by nkl.lt's club ids, crested over https, tip-offs Vilnius -> UTC,
    "regular" and "playoffs" kept apart by the league's stage type, and the site's mojibake
    ('Å\\xa0akiÅ³ sporto centras') read back as Lithuanian;
  * the game: its own match page's box score - score, quarters, both clubs' players under nkl.lt's
    player ids, the Statistika tab's team lines - in the FIBA shape, published as a result (no
    play-by-play to replay, so no event log and no made-up lineup); a LiveStats feed only when
    nkl.lt itself links one AND it agrees with the site (the same clubs, final, the same score);
  * a game in progress: read at most once a minute, and never held up for the crawl delay;
  * the fixtures nkl.lt takes off its schedule: named by withdrawn(), and removed by
    run_ingest.retire_withdrawn only while nothing has happened in them.

Fixtures in scripts/ingest/data/nkl/: matches.html and home.html as served 2026-09-23 (the strip
then linked 15 games to their webcasts); home-strip-2026-10-01.html and match-125745.html as served
2026-10-01, trimmed to the parts read (the strip links no webcast any more; 125745 finished 83-108).
feed-standin.json is a GENUINE FIBA LiveStats data.json from another league (EABL 2759719) with its
two club names set to a fixture's: it exercises the agreement rule, not NKL statistics.
"""
import copy
import json
import os
import re
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
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
ROWS = json.loads(F._NKL_ALL.search(MATCHES).group(1))
MOJIBAKE = re.compile("[Â-Å]|â€")       # what UTF-8 read as Windows-1252 looks like


def schedule(change=None):
    """matches.html with its array changed by `change(rows)` - a result, a game on, a fixture withdrawn."""
    rows = copy.deepcopy(ROWS)
    if change:
        rows = change(rows) or rows
    return F._NKL_ALL.sub(lambda m: "const allMatches = " + json.dumps(rows) + ";\n", MATCHES, count=1)


def result(sid, home, away, running=False):
    def change(rows):
        for r in rows:
            if str(r["id"]) == str(sid):
                r.update(home_score=home, away_score=away, is_result=0 if running else 1, is_running=1 if running else 0)
    return change


def feed_as(home, away, score=None, final=True):
    d = copy.deepcopy(STANDIN)
    d["tm"]["1"]["name"], d["tm"]["2"]["name"] = home, away
    for s in "12":
        d["tm"][s].pop("nameInternational", None)
        d["tm"][s]["shortName"] = ""
    if score:
        d["tm"]["1"]["score"], d["tm"]["2"]["score"] = score
    if not final:
        d["pbp"] = [e for e in d["pbp"] if not (e.get("actionType") == "game" and e.get("subType") == "end")]
    return d


class Offline(F.FibaSiteScheduleAdapter):
    nkl_gap_s = 0.0
    requests_made: list = []
    pages: dict = {}
    feeds: dict = {}

    def _page(self, url):
        self.requests_made.append(url)
        if url in self.pages:
            return self.pages[url]
        raise RuntimeError(url)

    def _get_meta(self, url):
        self.requests_made.append(url)
        m = re.search(r"/data/(\d+)/data\.json", url)
        raw = self.feeds.get(m.group(1)) if m else None
        return (copy.deepcopy(raw) if raw else None), {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh(sched=None, home=None, match=None, feeds=None, root=None):
    Offline.requests_made = []
    Offline.pages = {F.NKL_MATCHES: sched or MATCHES, F.NKL_SITE + "/": home if home is not None else text("home-strip-2026-10-01.html")}
    if match is not None:
        Offline.pages[F.NKL_MATCH.format(id="125745")] = match
    Offline.feeds = feeds or {}
    F.FibaSiteScheduleAdapter._nkl_cache = (0.0, [])
    F.FibaSiteScheduleAdapter._nkl_strip_at = (0.0, None)
    F.FibaSiteScheduleAdapter._nkl_read = {}
    F.FibaSiteScheduleAdapter._nkl_last = 0.0
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline(), {"code": "NKL", "site": "nkl", "season": "2026-27", "repo_root": root or tempfile.mkdtemp()}


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

print("\n-- the homepage strip")
old = F.nkl_strip(text("home.html"))
ok("the 23 Sep strip (an <a class=nkl-match-item> per game): 15 games linked to their webcasts, 125745 -> 2895455",
   len(old) == 15 and old.get("125745") == "2895455", old)
strip = text("home-strip-2026-10-01.html")
ok("the 1 Oct strip (a <div> per game): 15 games, none linked to a webcast",
   strip.count("nkl-match-item") == 15 and F.nkl_strip(strip) == {}, F.nkl_strip(strip))
item = strip.index("matches/125748/")
linked = strip[:item] + "matches/125748/ ><a href=https://www.fibalivestats.com/u/BNW/2895999/ class=x>LS</a" + strip[item + len("matches/125748/"):]
ok("...a webcast link added to one of its games is read, for that game alone",
   F.nkl_strip(linked) == {"125748": "2895999"}, F.nkl_strip(linked))

print("\n-- the match page (125745, 83-108)")
page = F.nkl_match_page(text("match-125745.html"))
ok("the score, the badge, the quarters and the clubs' abbreviations",
   page["score"] == (83, 108) and page["status"] == "Rungtynės Baigėsi" and page["periods"] == ["Q1", "Q2", "Q3", "Q4"]
   and page["quarters"] == ([16, 22, 19, 26], [32, 22, 28, 26]) and page["abbr"] == ("PAT", "ŽAL"),
   {k: page[k] for k in ("score", "status", "periods", "quarters", "abbr")})
ok("the arena and the referees, read back from the page's mojibake",
   page["venue"] == "Alytaus sporto ir rekreacijos centras"
   and page["referees"] == ["Milita Stalaučinskaitė", "Ernest Čepelevskij", "Simas Baranauskas"], (page["venue"], page["referees"]))
home_box, away_box = page["teams"]
ok("both clubs' box scores: 12 + 12 players, home first", (home_box["name"], len(home_box["players"]), away_box["name"], len(away_box["players"]))
   == ("Alytaus Patriotai", 12, "Kauno Žalgiris-2", 12), (home_box["name"], away_box["name"]))
ok("Karolis Guščikas: #10, 29:13, 17 pts, 7/11 (7/11 two, 0/0 three), 3/8 FT, 18 reb, 3 ast, eff 29, nkl.lt id 7053",
   home_box["players"][0] == {"id": "7053", "name": "Karolis Guščikas", "shirt": "10", "min": "29:13", "pts": 17, "fg": (7, 11),
                              "fg2": (7, 11), "fg3": (0, 0), "ft": (3, 8), "reb": 18, "ast": 3, "stl": 0, "tov": 0, "blk": 0, "eff": 29},
   home_box["players"][0])
names = [p["name"] for t in page["teams"] for p in t["players"]]
ok("no player's name is left in mojibake (Šarūnas Valunta, Ignas Štombergas, Titas Lavrinovič)",
   not any(MOJIBAKE.search(n) for n in names) and {"Šarūnas Valunta", "Ignas Štombergas", "Titas Lavrinovič"} <= set(names), names)
ok("each club's points add up to the score", [sum(p["pts"] for p in t["players"]) for t in page["teams"]] == [83, 108])
hs, as_ = page["stats"]
ok("the Statistika tab's team lines: 31/73 and 37/71, rebounds 39 (18 off, 21 def) and 35 (10, 25), fouls 27 and 20",
   (hs["sFieldGoalsMade"], hs["sFieldGoalsAttempted"], as_["sFieldGoalsMade"], as_["sFieldGoalsAttempted"],
    hs["sReboundsTotal"], hs["sReboundsOffensive"], hs["sReboundsDefensive"], as_["sReboundsTotal"], as_["sReboundsOffensive"],
    as_["sReboundsDefensive"], hs["sFoulsPersonal"], as_["sFoulsPersonal"]) == (31, 73, 37, 71, 39, 18, 21, 35, 10, 25, 27, 20), (hs, as_))
ok("...and what only a team has: points off turnovers 12/29, fast break 12/30, second chance 14/18, bench 36/53",
   [(hs[k], as_[k]) for k in ("sPointsFromTurnovers", "sPointsFastBreak", "sPointsSecondChance", "sBenchPoints")]
   == [(12, 29), (12, 30), (14, 18), (36, 53)])
blank = F.nkl_match_page("<html><body>nothing here</body></html>")
ok("a page with none of it reads as nothing, without an error", blank["score"] is None and blank["teams"] == [] and blank["stats"] == ({}, {}))

print("\n-- fetch(): a finished game, from its page")
MATCH = text("match-125745.html")
a, cfg = fresh(schedule(result("125745", 83, 108)), match=MATCH)
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
ok("the requests: the schedule, the homepage strip (no webcast) and the match page - no LiveStats feed asked for",
   Offline.requests_made == [F.NKL_MATCHES, F.NKL_SITE + "/", F.NKL_MATCH.format(id="125745")], Offline.requests_made)
b2 = a.fetch("125745", cfg)
ok("a second read of the same page is the same payload (an unchanged final is not written again)", b2.payload_hash == b.payload_hash)

print("\n-- fetch(): a LiveStats feed nkl.lt links, used only when it agrees")
home_linked = text("home.html")                                           # the 23 Sep strip: 125745 -> 2895455
a, cfg = fresh(schedule(result("125745", 65, 95)), home=home_linked, match=MATCH,
               feeds={"2895455": feed_as("Alytaus Patriotai", "Kauno Žalgiris-2")})
b = a.fetch("125745", cfg)
ok("the same clubs, final, the same score (65-95 on both): the feed is used, for its play-by-play",
   b is not None and b.translate is None and b.status == "final" and b.stints and len(b.box["home"]) == len(STANDIN["tm"]["1"]["pl"])
   and (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"], b.home_name) == ("3386", "266", "Alytaus Patriotai"),
   b and (b.translate, b.status, len(b.stints)))
ok("...without the match page ever being read", F.NKL_MATCH.format(id="125745") not in Offline.requests_made, Offline.requests_made)
for label, score_on_site, feed in (
        ("a webcast that stopped (the site says 83-108, the feed 65-95)", (83, 108), feed_as("Alytaus Patriotai", "Kauno Žalgiris-2")),
        ("a webcast never closed (no game end in its log)", (65, 95), feed_as("Alytaus Patriotai", "Kauno Žalgiris-2", final=False)),
        ("a webcast of two other clubs", (65, 95), feed_as("Somebody Else", "Another Club"))):
    a, cfg = fresh(schedule(result("125745", *score_on_site)), home=home_linked, match=MATCH, feeds={"2895455": feed})
    b = a.fetch("125745", cfg)
    ok(f"{label}: passed over for nkl.lt's own box score", b is not None and b.translate is False
       and (b.team["home"]["points"], b.team["away"]["points"]) == (83, 108) and F.NKL_MATCH.format(id="125745") in Offline.requests_made,
       b and (b.translate, b.team["home"]["points"]))
a, cfg = fresh(schedule(result("125745", 83, 108)), home=home_linked, match=MATCH)
a.fetch("125745", cfg)
Offline.requests_made.clear()
ok("a fixture the strip does not link is never guessed at (the 23 Sep offset named a Chilean game): no feed asked for",
   a._nkl_fiba_id("125770", cfg) is None and not any("/data/" in u for u in Offline.requests_made), Offline.requests_made)
ok("...and the strip's links are remembered, so the next game costs no read of it",
   a._nkl_fiba_id("125748", cfg) == "2895458" and Offline.requests_made == [], Offline.requests_made)

print("\n-- fetch(): before, during, and off the schedule")
a, cfg = fresh(match=MATCH)
ok("a game not started has nothing to read: None, and only the schedule asked for",
   a.fetch("125747", cfg) is None and Offline.requests_made == [F.NKL_MATCHES], Offline.requests_made)
ok("a game nkl.lt no longer lists (126055, entered and deleted): None", a.fetch("126055", cfg) is None)
a, cfg = fresh(schedule(result("125745", 40, 38, running=True)), match=MATCH)
b = a.fetch("125745", cfg)
ok("a game in progress reads its page and is live (the page's own score and box), still no event log",
   b is not None and b.status == "live" and b.translate is False and b.stints == [], b and (b.status, b.translate))
n = len(Offline.requests_made)
ok("...and is not read again inside a minute", a.fetch("125745", cfg) is None and len(Offline.requests_made) == n, Offline.requests_made[n:])
F.FibaSiteScheduleAdapter._nkl_read = {}
Offline.nkl_gap_s = 3600.0
F.FibaSiteScheduleAdapter._nkl_last = __import__("time").time()
ok("...nor held up for the crawl delay: an answer of None, the next pass asks again",
   a.fetch("125745", cfg) is None and len(Offline.requests_made) == n)
Offline.nkl_gap_s = 0.0
odd = {"teams": [{"name": "Kauno Žalgiris-2", "players": [{"id": "1", "name": "A B", "pts": 2}]},
                 {"name": "Alytaus Patriotai", "players": [{"id": "2", "name": "C D", "pts": 3}]}],
       "score": (2, 3), "quarters": ([2], [3]), "abbr": ("ŽAL", "PAT"), "stats": ({}, {})}
fx = next(r for r in ROWS if r["id"] == 125745)
ok("a page that draws the clubs the other way round from the fixture is refused (never filed under the wrong club)",
   F.nkl_payload(odd, fx, True) is None)
ok("a page with no box score for one of the clubs is not a result yet",
   F.nkl_payload(dict(odd, teams=[odd["teams"][1], {"name": "Kauno Žalgiris-2", "players": []}]), fx, True) is None)

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
   RI.retire_withdrawn(sb, SRC, Says(["x"]), dict(many, x=ext("x", None))) == ["x"] and sb.deletes == [("external_games", "adapter=eq.fiba_site_schedule&competition_code=eq.NKL&external_id=eq.x")])
sb = Sb([{"id": f"g{i}", "status": "scheduled", "home_score": None, "away_score": None} for i in range(100)])
ok("...a schedule that seems to have lost dozens of games is a page that did not load: nothing removed",
   RI.retire_withdrawn(sb, SRC, Says([str(i) for i in range(30)]), many) == [] and sb.deletes == [])
ok("...and an adapter that cannot say (no withdrawn()) removes nothing", RI.retire_withdrawn(Sb([]), SRC, object(), many) == [])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
