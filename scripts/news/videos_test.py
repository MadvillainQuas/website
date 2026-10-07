"""A channel's videos put on their games (videos.py, 0237), offline:    python scripts/news/videos_test.py

What it holds:
  * WHAT A VIDEO IS from its title, in the leagues' languages: highlights ("Resumen", "Skrót meczu", "ハイライト" ...)
    win over a live word; a whole game ("Partido completo", "LIVE", "ライブ配信"); a press conference or a preview
    is no game's video;
  * its YouTube id from every form of link and from the feed's guid;
  * THE CLUBS a title names: full names, short forms without a sponsor or a club word, native spellings (kanji,
    accents), never a phrase two clubs share, never a club word inside another club's name;
  * THE GAME: the pair that played at the right time (a highlight after tip-off, never before; a full game either
    side), the nearest of a series; no pair, no game;
  * WHAT IT BECOMES on each kind of channel, and the pass itself: matched, recorded, a broadcast attached for
    seeking only on a seeking channel and only where the game has no video, a channel switched off left alone;
  * fetch_feeds: every item of a read carries video_id and video_kind (one key set), and a video on a game is kept
    when the feed's old items are cleared.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import videos as V  # noqa: E402
import fetch_feeds as F  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


print("what a video is, from its title")
HL = ["Highlights | Real Madrid 89-76 FC Barcelona | Liga Endesa J5", "RESUMEN: Valencia Basket - Joventut (88-80)",
      "Mejores momentos del Unicaja - Baskonia", "Skrót meczu: Anwil Włocławek - Trefl Sopot", "Höjdpunkter: Borås - Nässjö",
      "Kohokohdat: Kataja - Karhu", "Zusammenfassung: ALBA Berlin vs. Bayern", "Temps forts : Monaco - ASVEL",
      "【ハイライト】千葉ジェッツ vs 宇都宮ブレックス｜B.LEAGUE", "Game Recap: Sydney Kings vs Perth Wildcats",
      "Sintesi: Virtus Bologna - Olimpia Milano", "Hoogtepunten Heroes Den Bosch - Leiden", "Highlights | LIVE from Tokyo"]
ok("highlights in every language the leagues use (and a highlight word wins over a live one)",
   all(V.classify(t) == "highlights" for t in HL), [t for t in HL if V.classify(t) != "highlights"])
FULL = ["FULL GAME: Real Madrid vs Barcelona", "Partido completo | Gran Canaria - Murcia", "LIVE: London Lions v Cheshire Phoenix",
        "En directo: Oviedo vs Palencia", "千葉ジェッツ vs 宇都宮 ライブ配信", "Transmisja: Legia - Śląsk", "Livestream | Borås vs Nässjö"]
ok("a whole game", all(V.classify(t) == "full" for t in FULL), [t for t in FULL if V.classify(t) != "full"])
ok("anything else is a video", V.classify("Meet our new point guard") == "video" and V.classify("Top 10 dunks of the season") == "video")
ok("a word inside another is not the word ('live' in 'delivered', 'hl' in 'hlavni')",
   V.classify("Delivered: the trophy") == "video" and V.classify("Hlavni trener") == "video")
ok("a press conference, an interview, a preview are about a game, not of it",
   all(V.not_a_game(t) for t in ("Rueda de prensa post partido Real Madrid - Barça", "Post game press conference",
                                  "Previa: Valencia vs Joventut", "Interview with the coach", "試合後インタビュー")))
ok("...a highlight is of it", not V.not_a_game("Highlights: Valencia vs Joventut"))

print("\nthe video's id")
ok("from a watch link, a short link, an embed, a short, a live link and the feed's guid",
   [V.video_id(u) for u in ("https://www.youtube.com/watch?v=abcDEF12345&t=3", "https://youtu.be/abcDEF12345?si=x",
                            "https://www.youtube-nocookie.com/embed/abcDEF12345", "https://youtube.com/shorts/abcDEF12345",
                            "https://www.youtube.com/live/abcDEF12345")] == ["abcDEF12345"] * 5
   and V.video_id(None, "yt:video:abcDEF12345") == "abcDEF12345")
ok("...and nothing from anything else", V.video_id("https://vimeo.com/1234567") is None and V.video_id("https://www.youtube.com/@acb") is None
   and V.video_id("https://www.youtube.com/watch?v=<script>") is None)

print("\nthe clubs a title names")
TEAMS = [
    {"id": "RM", "league_id": "ES", "name": "Real Madrid", "short_name": "RMB", "aliases": []},
    {"id": "FCB", "league_id": "ES", "name": "FC Barcelona", "short_name": "BAR", "aliases": ["Barça"]},
    {"id": "EST", "league_id": "ES", "name": "Movistar Estudiantes Madrid", "short_name": "EST", "aliases": []},
    {"id": "ZAR", "league_id": "ES", "name": "Casademont Zaragoza", "short_name": "ZAR", "aliases": []},
    {"id": "VAL", "league_id": "ES", "name": "Valencia Basket", "short_name": "VBC", "aliases": []},
    {"id": "JOV", "league_id": "ES", "name": "Joventut Badalona", "short_name": "JOV", "aliases": []},
    {"id": "CHI", "league_id": "JP", "name": "Chiba Jets", "short_name": "Chiba", "aliases": ["千葉ジェッツ", "千葉J"]},
    {"id": "UTS", "league_id": "JP", "name": "Utsunomiya Brex", "short_name": "Utsunomiya", "aliases": ["宇都宮ブレックス", "宇都宮"]},
    {"id": "BOR", "league_id": "SE", "name": "Boras Basket", "short_name": "Boras", "aliases": ["Borås Basket"]},
    {"id": "NAS", "league_id": "SE", "name": "Nassjo Basket", "short_name": "Nassjo", "aliases": ["Nässjö Basket"]},
    {"id": "UPP", "league_id": "SE", "name": "Uppsala Basket", "short_name": "Uppsala", "aliases": []},
    {"id": "SLO", "league_id": "SE", "name": "Sloga Uppsala", "short_name": "Sloga", "aliases": []},
]
CF = V.ClubFinder(TEAMS)
ids = lambda t, lg=None: [k for k, _ in CF.find(t, lg)]
ok("two clubs by their full names", sorted(ids("Highlights | Real Madrid 89-76 FC Barcelona")) == ["FCB", "RM"], ids("Highlights | Real Madrid 89-76 FC Barcelona"))
ok("...by their short forms (a sponsor and a club word dropped): Zaragoza, Barcelona, Valencia",
   sorted(ids("Resumen: Zaragoza - Barcelona")) == ["FCB", "ZAR"] and sorted(ids("Valencia vs Joventut")) == ["JOV", "VAL"],
   (ids("Resumen: Zaragoza - Barcelona"), ids("Valencia vs Joventut")))
ok("...by an alias with its accents (Barça), and by the spelling the feed itself used (Borås, Nässjö)",
   "FCB" in ids("Real Madrid - Barça") and sorted(ids("Höjdpunkter: Borås Basket - Nässjö Basket")) == ["BOR", "NAS"],
   (ids("Real Madrid - Barça"), ids("Höjdpunkter: Borås Basket - Nässjö Basket")))
ok("...in kanji and kana, run together as Japanese writes them", sorted(ids("【ハイライト】千葉ジェッツvs宇都宮ブレックス")) == ["CHI", "UTS"],
   ids("【ハイライト】千葉ジェッツvs宇都宮ブレックス"))
ok("'Madrid' alone is nobody's (two Madrid clubs), but Real Madrid's full name is Real Madrid's",
   "EST" not in ids("Real Madrid vs Valencia") and "RM" in ids("Real Madrid vs Valencia") and ids("Madrid wins") == [],
   (ids("Real Madrid vs Valencia"), ids("Madrid wins")))
ok("'Uppsala' inside 'Sloga Uppsala' is Sloga's word, not a second club", ids("Highlights: Sloga Uppsala - Borås") == ["SLO", "BOR"] or
   sorted(ids("Highlights: Sloga Uppsala - Borås")) == ["BOR", "SLO"], ids("Highlights: Sloga Uppsala - Borås"))
ok("...while Uppsala Basket v Sloga Uppsala names both", sorted(ids("Uppsala Basket vs Sloga Uppsala")) == ["SLO", "UPP"], ids("Uppsala Basket vs Sloga Uppsala"))
ok("three letters are nobody's in a title (RMB, BAR)", ids("RMB vs BAR") == [])
ok("limited to the leagues asked about", ids("Real Madrid vs Chiba Jets", {"JP"}) == ["CHI"])
ok("the pairs to try, strongest first", V.pairs([("A", 10.0), ("B", 8.0), ("C", 4.0)]) == [("A", "B"), ("A", "C"), ("B", "C")])

print("\nthe game")
PUB = datetime(2026, 10, 5, 20, 0, tzinfo=timezone.utc)
G = [{"id": "g1", "status": "final", "tipoff_at": "2026-10-04T18:00:00+00:00"},
     {"id": "g2", "status": "final", "tipoff_at": "2026-09-20T18:00:00+00:00"},
     {"id": "g3", "status": "scheduled", "tipoff_at": "2026-10-07T18:00:00+00:00"}]
ok("a highlight: the game before it, inside six days (not the one a fortnight ago, not the one still to come)", V.pick_game(G, PUB, "highlights")["id"] == "g1")
ok("...and never a game that has not been played", V.pick_game([G[2]], PUB, "highlights") is None)
ok("a full game: either side, the nearest (a stream published two days ahead)", V.pick_game([G[2], G[1]], PUB, "full")["id"] == "g3")
ok("nothing in the window: no game", V.pick_game([G[1]], PUB, "highlights") is None and V.pick_game([], PUB, "full") is None)
print("\nthe date, the league and the competition")
from datetime import date  # noqa: E402
NEAR = datetime(2026, 10, 5, 20, 0, tzinfo=timezone.utc)
ok("a title's date in every form: 05/10/2026, 2026-10-05, 5.10., 5 Oct, October 5th, 5 de octubre, 10月5日",
   all(date(2026, 10, 5) in V.title_dates(t, NEAR) for t in ("Highlights 05/10/2026", "Highlights | 2026-10-05", "Resumen 5.10.",
                                                              "Highlights - 5 Oct", "October 5th highlights", "Resumen 5 de octubre",
                                                              "【ハイライト】10月5日 千葉 vs 宇都宮")),
   {t: V.title_dates(t, NEAR) for t in ("Resumen 5.10.", "October 5th highlights")})
ok("...a day/month that could be either way round is read both ways", {date(2026, 10, 5), date(2026, 5, 10)} & V.title_dates("5/10", NEAR) == {date(2026, 10, 5)})
ok("...no date, no days; a score is no date; a date far from the video is not this season's", V.title_dates("Highlights: A vs B", NEAR) == set()
   and V.title_dates("Real Madrid 89-76 Barcelona", NEAR) == set() and V.title_dates("Highlights 05/10/2019", NEAR) == set())
ok("...the year of a date given without one is the one that brings it nearest (a 30 December game, a 2 January video)",
   date(2025, 12, 30) in V.title_dates("Highlights 30 Dec", datetime(2026, 1, 2, tzinfo=timezone.utc)))
WEEK = [{"id": "league", "status": "final", "tipoff_at": "2026-10-04T18:00:00+00:00",
         "competitions": {"name": "Liga Endesa", "seasons": {"league_id": "ES"}}},
        {"id": "cup", "status": "final", "tipoff_at": "2026-10-01T18:00:00+00:00",
         "competitions": {"name": "Copa del Rey", "seasons": {"league_id": "ES"}}},
        {"id": "euro", "status": "final", "tipoff_at": "2026-10-03T18:00:00+00:00",
         "competitions": {"name": "EuroLeague Regular Season", "seasons": {"league_id": "EL"}}}]
ok("two clubs who met three times in a week: a plain highlight is of the latest, the one just before it went up",
   V.pick_game(WEEK, NEAR, "highlights", "Highlights: Real Madrid vs FC Barcelona")["id"] == "league")
ok("...'Copa' in the title: the cup tie, though it was four days earlier", V.pick_game(WEEK, NEAR, "highlights", "Resumen Copa del Rey: Real Madrid - Barça")["id"] == "cup")
ok("...'EuroLeague' in the title: the EuroLeague game", V.pick_game(WEEK, NEAR, "highlights", "EuroLeague Highlights: Real Madrid vs Barcelona")["id"] == "euro")
ok("...the channel's own league outweighs a day's difference (the EuroLeague's channel)",
   V.pick_game(WEEK, NEAR, "highlights", "Highlights: Real Madrid vs Barcelona", {"EL"})["id"] == "euro")
ok("...a date in the title decides (1 October: the cup tie), and a date none of them was played on is no game",
   V.pick_game(WEEK, NEAR, "highlights", "Highlights 01/10/2026 Real Madrid vs Barcelona")["id"] == "cup"
   and V.pick_game(WEEK, NEAR, "highlights", "Highlights 28/09/2026 Real Madrid vs Barcelona") is None)
ok("...a cup title is never a league game, even the only one (the cup tie may not be on the site at all)",
   V.pick_game(WEEK[:1], NEAR, "highlights", "Copa del Rey highlights: Real Madrid - Barça") is None)
ok("...a competition the schedule calls a cup is one, whatever its name ('Trophy' title, 'SLB Trophy' kind cup)",
   V.pick_game([{"id": "t", "status": "final", "tipoff_at": "2026-10-04T18:00:00+00:00", "competitions": {"name": "Knockout", "kind": "cup"}}],
               NEAR, "highlights", "Copa highlights")["id"] == "t")
ok("competition fit: shared words count, cup against league costs", V.competition_fit("SLB Championship highlights", "SLB Championship") > 0
   and V.competition_fit("Cup final highlights", "Liga Endesa") < 0 and V.competition_fit("Highlights", "Copa del Rey") < 0)
ok("what a matched video becomes on each channel",
   [V.outcome(k, m) for k, m in (("highlights", "highlights"), ("video", "highlights"), ("full", "highlights"),
                                 ("highlights", "seeking"), ("video", "seeking"), ("full", "seeking"), ("highlights", "off"))]
   == ["highlights", "highlights", "full", "highlights", "full", "full", None])


class FakeDb:
    def __init__(self, items, sources, games, have_video=()):
        self.items, self.srcs, self.games, self.have = items, sources, games, set(have_video)
        self.patched, self.attached, self.asked = {}, [], []

    def videos_to_match(self, since, tried_before):
        return self.items

    def video_sources(self, ids):
        return self.srcs

    def teams_full(self):
        return TEAMS

    def games_between(self, a, b, lo, hi):
        self.asked.append(tuple(sorted((a, b))))
        return self.games.get(tuple(sorted((a, b))), [])

    def patch_item(self, iid, fields):
        self.patched[iid] = fields

    def attach_broadcast(self, gid, item):
        if gid in self.have:
            return False
        self.attached.append((gid, item["id"]))
        return True


print("\nthe pass")
SRC = {"hl": {"video_mode": "highlights", "league_id": "ES", "assigned_leagues": []},
       "sk": {"video_mode": "seeking", "league_id": "ES", "assigned_leagues": []},
       "off": {"video_mode": "off", "league_id": "ES", "assigned_leagues": []},
       "glob": {"video_mode": "highlights", "league_id": None, "assigned_leagues": []}}
GAMES = {("FCB", "RM"): [{"id": "clasico", "status": "final", "tipoff_at": "2026-10-04T18:00:00+00:00"}],
         ("JOV", "VAL"): [{"id": "vj", "status": "scheduled", "tipoff_at": "2026-10-06T18:00:00+00:00"}],
         ("CHI", "UTS"): [{"id": "jp1", "status": "final", "tipoff_at": "2026-10-05T10:00:00+00:00"}]}
P = PUB.isoformat()
items = [
    {"id": "i1", "source_id": "hl", "title": "Real Madrid 89-76 FC Barcelona", "published_at": P, "league_ids": []},
    {"id": "i2", "source_id": "sk", "title": "Valencia vs Joventut", "published_at": P, "league_ids": []},
    {"id": "i3", "source_id": "sk", "title": "Highlights: Real Madrid vs FC Barcelona", "published_at": P, "league_ids": []},
    {"id": "i4", "source_id": "off", "title": "Highlights: Real Madrid vs FC Barcelona", "published_at": P, "league_ids": []},
    {"id": "i5", "source_id": "hl", "title": "Rueda de prensa: Real Madrid - FC Barcelona", "published_at": P, "league_ids": []},
    {"id": "i6", "source_id": "glob", "title": "【ハイライト】千葉ジェッツ vs 宇都宮ブレックス", "published_at": P, "league_ids": []},
    {"id": "i7", "source_id": "hl", "title": "Valencia vs Estudiantes", "published_at": P, "league_ids": []},
]
db = FakeDb(items, SRC, GAMES)
res = V.match_videos(db, PUB + timedelta(hours=1), log=lambda *a: None)
ok("a highlights channel's video of the Clásico: the game's highlights",
   db.patched["i1"].get("game_id") == "clasico" and db.patched["i1"]["video_kind"] == "highlights", db.patched.get("i1"))
ok("a seeking channel's untitled video of a game to come: its full game, attached for seeking",
   db.patched["i2"].get("game_id") == "vj" and db.patched["i2"]["video_kind"] == "full" and ("vj", "i2") in db.attached, (db.patched.get("i2"), db.attached))
ok("...a highlight reel on a seeking channel is the game's highlights, never its broadcast",
   db.patched["i3"]["video_kind"] == "highlights" and not any(i == "i3" for _, i in db.attached), db.patched.get("i3"))
ok("a channel switched off is left alone", "i4" not in db.patched)
ok("a press conference is put on no game (and is recorded as looked at)", "game_id" not in db.patched["i5"] and "matched_at" in db.patched["i5"], db.patched.get("i5"))
ok("a channel of no league finds a Japanese game by its kanji", db.patched["i6"].get("game_id") == "jp1", db.patched.get("i6"))
ok("two clubs that did not meet: no game, and the pair was asked once", "game_id" not in db.patched["i7"] and db.asked.count(("EST", "VAL")) == 1, db.patched.get("i7"))

print("\na source's title filter (0246)")
TF = [("Résumé | Paris - Monaco | Betclic ÉLITE (J3)", ["Betclic Elite"], [], True), ("Ligue 1 : PSG - OM", ["Betclic Elite"], [], False),
      ("Betclic ELITE Espoirs : Paris - Monaco", ["betclic elite"], ["Espoirs"], False), ("Anything at all", [], [], True),
      ("Visit elitebasket.fr", ["elite"], [], False), ("Pro B | Rouen - Fos", [], ["Pro B"], False)]
ok("KEEP ONLY one of, NEVER any of, as words, whatever the case and the accents (the same cases as the function's)",
   all(V.title_passes(t, i, e) == want for t, i, e, want in TF), [V.title_passes(t, i, e) for t, i, e, _ in TF])

print("\npress conferences (0244)")
ok("a press conference in the leagues' languages; a highlight word wins over it, it wins over a live word",
   all(V.classify(t) == "press" for t in ("Post-game Press Conference | Real Madrid", "Rueda de prensa: Real Madrid - Barça", "Pressekonferenz nach dem Spiel",
                                           "Konferencja prasowa po meczu", "【記者会見】千葉ジェッツ", "LIVE: postgame press conference"))
   and V.classify("Highlights + press conference") == "highlights")
ok("...a press conference is a press conference on either channel's mode, and nothing on one switched off",
   [V.outcome("press", m) for m in ("highlights", "seeking", "off")] == ["press", "press", None])
PG = [{"id": "after", "status": "final", "tipoff_at": "2026-10-04T18:00:00+00:00"},
      {"id": "before", "status": "scheduled", "tipoff_at": "2026-10-07T18:00:00+00:00"},
      {"id": "old", "status": "final", "tipoff_at": "2026-09-29T18:00:00+00:00"}]
ok("its game: the one just before it (after the game) or up to three days after it (the one before), never a week old",
   V.pick_game(PG[:1], PUB, "press")["id"] == "after" and V.pick_game(PG[1:2], PUB, "press")["id"] == "before" and V.pick_game(PG[2:], PUB, "press") is None)


class PressDb(FakeDb):
    def has_press_kind(self):
        return True


items_p = [dict(items[4]),
           {"id": "p2", "source_id": "sk", "title": "Rueda de prensa previa: Valencia - Joventut", "published_at": P, "league_ids": []},
           {"id": "p3", "source_id": "hl", "title": "Press conference: our new head coach", "published_at": P, "league_ids": []}]
dbp = PressDb(items_p, SRC, GAMES)
resp = V.match_videos(dbp, PUB + timedelta(hours=1), log=lambda *a: None)
ok("with 0244: the Clásico's press conference is on the Clásico, a press conference",
   dbp.patched["i5"].get("game_id") == "clasico" and dbp.patched["i5"]["video_kind"] == "press", dbp.patched.get("i5"))
ok("...the one before a game to come is that game's (a 'previa' too), and never attached for seeking on a seeking channel",
   dbp.patched["p2"].get("game_id") == "vj" and dbp.patched["p2"]["video_kind"] == "press" and not dbp.attached, (dbp.patched.get("p2"), dbp.attached))
ok("...one of no game is on no game, still a press conference (HOME's PRESS)", "game_id" not in dbp.patched["p3"] and dbp.patched["p3"].get("video_kind") == "press",
   dbp.patched.get("p3"))
ok("...and counted", resp.get("press") == 2, resp)
ok("the count", res["matched"] == 4 and res["attached"] == 1 and res["highlights"] == 3 and res["full"] == 1, res)
db2 = FakeDb([items[1]], SRC, GAMES, have_video={"vj"})
V.match_videos(db2, PUB + timedelta(hours=1), log=lambda *a: None)
ok("a game that already has a video keeps it", db2.attached == [] and db2.patched["i2"]["game_id"] == "vj")
db3 = FakeDb(items, SRC, GAMES)
V.match_videos(db3, PUB + timedelta(hours=1), log=lambda *a: None, dry_run=True)
ok("a dry run writes nothing", db3.patched == {} and db3.attached == [])
ok("before 0240 no note is written (the columns are not there)", "match_note" not in db.patched["i1"] and "match_clubs" not in db.patched["i7"])

print("\na channel's own names for clubs (0240)")
RULES = [{"phrase": "Los Blancos", "team_id": "RM"}, {"phrase": "Blaugrana", "team_id": "FCB"},
         {"phrase": "Valencia  Arena", "team_id": None}]
R = V.prep_rules(RULES)
ok("folded as titles are, the longest first", R[0] == ("valencia arena", None, False) and {r[0] for r in R} == {"los blancos", "blaugrana", "valencia arena"}, R)
f = CF.find("Highlights: Los Blancos vs Blaugrana", None, R)
ok("a channel's names find clubs the clubs' own names never would", sorted(k for k, _ in f) == ["FCB", "RM"], f)
ok("...and are the strongest findings there are", all(s > V.RULE_STRENGTH for _, s in f), f)
T3 = "Live from Valencia Arena: Joventut vs Zaragoza"
ok("a phrase for no club hides its words from every club ('Valencia' of 'Valencia Arena' is the venue)",
   sorted(ids(T3)) == ["JOV", "VAL", "ZAR"] and sorted(k for k, _ in CF.find(T3, None, R)) == ["JOV", "ZAR"], CF.find(T3, None, R))
ok("...a channel's name inside a longer one of another club is that club's",
   [k for k, _ in CF.find("Blaugrana Juniors vs Los Blancos", None, V.prep_rules([{"phrase": "Blaugrana Juniors", "team_id": "JOV"}] + RULES))]
   == ["JOV", "RM"] or sorted(k for k, _ in CF.find("Blaugrana Juniors vs Los Blancos", None, V.prep_rules([{"phrase": "Blaugrana Juniors", "team_id": "JOV"}] + RULES))) == ["JOV", "RM"])
ok("where the matcher stopped, in words the console shows",
   V.note_of("highlights", [("A", 1.0), ("B", 1.0)], {"id": "g"}) == "matched" and V.note_of(None, [], None) == "not_a_game"
   and V.note_of("highlights", [], None) == "no_clubs" and V.note_of("full", [("A", 1.0)], None) == "one_club"
   and V.note_of("highlights", [("A", 1.0), ("B", 1.0)], None) == "no_game")


class RulesDb(FakeDb):
    def has_video_rules(self):
        return True

    def video_rules(self, ids):
        return {"hl": RULES}


items4 = [
    {"id": "r1", "source_id": "hl", "title": "Los Blancos 89-76 Blaugrana", "published_at": P, "league_ids": []},
    {"id": "r2", "source_id": "hl", "title": "Valencia vs Estudiantes", "published_at": P, "league_ids": []},
    {"id": "r3", "source_id": "hl", "title": "Highlights: Real Madrid at home", "published_at": P, "league_ids": []},
    {"id": "r4", "source_id": "hl", "title": "Rueda de prensa: Real Madrid - FC Barcelona", "published_at": P, "league_ids": []},
    {"id": "r5", "source_id": "sk", "title": "Los Blancos vs Blaugrana", "published_at": P, "league_ids": []},
]
db4 = RulesDb(items4, SRC, GAMES)
V.match_videos(db4, PUB + timedelta(hours=1), log=lambda *a: None)
p = db4.patched
ok("the pass reads the channel's names: 'Los Blancos 89-76 Blaugrana' is the Clásico's highlights",
   p["r1"].get("game_id") == "clasico" and p["r1"]["match_note"] == "matched" and sorted(p["r1"]["match_clubs"]) == ["FCB", "RM"], p.get("r1"))
ok("...and notes where it stopped: no game between them, one club, not a game",
   p["r2"]["match_note"] == "no_game" and sorted(p["r2"]["match_clubs"]) == ["EST", "VAL"] and p["r3"]["match_note"] == "one_club"
   and p["r3"]["match_clubs"] == ["RM"] and p["r4"]["match_note"] == "not_a_game" and p["r4"]["match_clubs"] == [], p)
ok("...a channel's names are its own (another channel's titles do not read them)",
   p["r5"]["match_note"] == "no_clubs" and "game_id" not in p["r5"], p.get("r5"))

print("\nthe reader writes the video's id and kind")


class FeedDb:
    def __init__(self):
        self.rows, self.pruned, self.matched = [], [], False

    def has_videos(self):
        return True

    def leagues(self):
        return []

    def teams(self):
        return []

    def sources(self, only=None):
        return [{"id": "s1", "name": "Ch", "feed_url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCx"}]

    def upsert_items(self, rows):
        self.rows += rows

    def prune(self, sid, before, keep_linked=False):
        self.pruned.append(keep_linked)

    def count(self, sid):
        return len(self.rows)

    def mark(self, sid, fields):
        pass

    def videos_to_match(self, since, tried_before):
        self.matched = True
        return []


ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"
 xmlns:media="http://search.yahoo.com/mrss/"><title>Ch</title>
<entry><id>yt:video:abcDEF12345</id><title>Highlights: Real Madrid vs FC Barcelona</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abcDEF12345"/><published>2026-10-05T20:00:00+00:00</published></entry>
<entry><id>yt:video:zyxWVU98765</id><title>Our new signing</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=zyxWVU98765"/><published>2026-10-05T19:00:00+00:00</published></entry>
</feed>"""
fd = FeedDb()
F.run(fd, get=lambda u, e=None, m=None: (200, ATOM, {}), log=lambda *a: None, now=lambda: PUB + timedelta(hours=2),
      sleep=lambda s: None, page=lambda u, n=0: (404, b"", {}))
by = {r["video_id"]: r for r in fd.rows}
ok("each YouTube item with its id and its kind", by.get("abcDEF12345", {}).get("video_kind") == "highlights" and by.get("zyxWVU98765", {}).get("video_kind") == "video", fd.rows)
ok("...every row the same keys", len({tuple(sorted(r)) for r in fd.rows}) == 1)
ok("a video on a game survives the clearing of old items, and the matching pass ran", fd.pruned == [True] and fd.matched, (fd.pruned, fd.matched))

print("\nthe YouTube Data API (YouTube's RSS answers 404)")
ok("a channel's feed reads its uploads playlist (UC… -> UU…); a playlist's, itself",
   V.playlist_of(F.YT_FEED + "?channel_id=UCAsCfBvGdjAxOzqGOcCxkzg") == "UUAsCfBvGdjAxOzqGOcCxkzg"
   and V.playlist_of(F.YT_FEED + "?playlist_id=PLabcdefghij12") == "PLabcdefghij12" and V.playlist_of("https://x.example/feed") is None)
asked = []


def fake_json(url):
    asked.append(url)
    if "playlistId=UUSH" in url:                    # the channel's Shorts: the vertical clip below
        return {"items": [{"contentDetails": {"videoId": "sssssssssss"}}]}
    if "playlistItems" in url:
        return {"items": [
            {"snippet": {"title": "Older", "publishedAt": "2026-10-03T10:00:00Z", "channelTitle": "SLB",
                         "thumbnails": {"high": {"url": "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"}}, "description": "x " * 300},
             "contentDetails": {"videoId": "aaaaaaaaaaa", "videoPublishedAt": "2026-10-03T09:00:00Z"}},
            {"snippet": {"title": "CHAMPIONSHIP HIGHLIGHTS: Manchester Basketball vs. Liverpool Basketball", "publishedAt": "2026-10-05T10:00:00Z",
                         "videoOwnerChannelTitle": "Super League Basketball", "thumbnails": {"medium": {"url": "http://insecure/x.jpg"}}},
             "contentDetails": {"videoId": "bbbbbbbbbbb"}},
            {"snippet": {"title": "Dunk of the night #shorts", "publishedAt": "2026-10-05T12:00:00Z"}, "contentDetails": {"videoId": "sssssssssss"}},
            {"snippet": {"title": "Private video"}, "contentDetails": {"videoId": "ccccccccccc"}},
            {"snippet": {"title": "Bad id"}, "contentDetails": {"videoId": "<b>"}}]}
    if "channels?" in url:
        return {"items": [{"id": "UCAsCfBvGdjAxOzqGOcCxkzg", "snippet": {"title": "Super League Basketball",
                                                                         "thumbnails": {"high": {"url": "https://yt3.ggpht.com/a"}}}}]}
    return {"items": []}


A = V.api_items(F.YT_FEED + "?channel_id=UCAsCfBvGdjAxOzqGOcCxkzg", "KEY", fake_json)
ok("its uploads as parse_feed's items: newest first, private and bad ids left out, the video's own publish time",
   [x["guid"] for x in A] == ["yt:video:bbbbbbbbbbb", "yt:video:aaaaaaaaaaa"] and A[1]["published_at"] == "2026-10-03T09:00:00Z"
   and A[0]["url"] == "https://www.youtube.com/watch?v=bbbbbbbbbbb" and A[0]["author"] == "Super League Basketball", A)
ok("...an https thumbnail only, a description clipped like an excerpt, the same keys as a feed's item",
   A[0]["image_url"] is None and A[1]["image_url"].startswith("https://") and len(A[1]["summary"]) <= 320
   and set(A[0]) == {"guid", "url", "title", "summary", "image_url", "author", "tags", "published_at"}, A[1])
ok("...two requests: the uploads playlist, then the channel's Shorts (UUSH...)", len(asked) == 2 and "playlistId=UUAsCfBvGdjAxOzqGOcCxkzg" in asked[0]
   and "key=KEY" in asked[0] and "playlistId=UUSHAsCfBvGdjAxOzqGOcCxkzg" in asked[1], asked)
ok("a Short is never read: the API's Shorts left out; a feed's /shorts/ link is one, a watch link is not",
   V.is_short("https://www.youtube.com/shorts/aaaaaaaaaaa") and not V.is_short("https://www.youtube.com/watch?v=aaaaaaaaaaa"))
ok("a link by its handle: the channel, its name and picture",
   V.api_channel("https://www.youtube.com/@SuperLeagueBasketball", "KEY", fake_json) ==
   {"feed_url": F.YT_FEED + "?channel_id=UCAsCfBvGdjAxOzqGOcCxkzg", "name": "Super League Basketball",
    "logo": "https://yt3.ggpht.com/a", "site_url": "https://www.youtube.com/channel/UCAsCfBvGdjAxOzqGOcCxkzg"} and "forHandle=@SuperLeagueBasketball" in asked[-1])
ok("...nothing without a key, nor for a link that is not a channel's", V.api_channel("https://www.youtube.com/@x", None, fake_json) is None
   and V.api_channel("https://example.com/@x", "KEY", fake_json) is None and V.api_channel("https://www.youtube.com/watch?v=x", "KEY", fake_json) is None)


class ApiDb(FeedDb):
    def sources(self, only=None):
        return [{"id": "s1", "name": "YouTube channel", "name_auto": True, "resolve_from": "https://www.youtube.com/@SuperLeagueBasketball"}]

    def feed_taken(self, feed, league, but):
        return None


marks = []
ad = ApiDb()
ad.mark = lambda sid, f: marks.append(f)
F.run(ad, get=lambda *a, **k: (_ for _ in ()).throw(AssertionError("RSS asked")), log=lambda *a: None,
      now=lambda: PUB + timedelta(hours=2), sleep=lambda s: None, page=lambda u, n=0: (404, b"", {}), yt_key="KEY", get_json=fake_json)
ok("with a key, a channel added by its link is found and read through the API, never its RSS",
   len(ad.rows) == 2 and marks and marks[-1].get("feed_url", "").endswith("UCAsCfBvGdjAxOzqGOcCxkzg") and marks[-1].get("platform") == "youtube"
   and marks[-1].get("name") == "Super League Basketball", (ad.rows, marks))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
