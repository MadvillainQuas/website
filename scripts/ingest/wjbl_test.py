# -*- coding: utf-8 -*-
"""The W League (adapters/wjbl.py), offline, over captured wjbl.org API replies:

    python scripts/ingest/wjbl_test.py

What it holds the adapter to:
  * the vocabulary: every Japanese action word of five games translated, a word it does not know
    reported rather than guessed;
  * names, the B.LEAGUE way: the league's own romaji where it has one (family name first, in
    capitals, turned into a name), the kana reading spelt out where it has not, a checked spelling
    where the reading is a foreign name, the Japanese kept as familyName and as an alias - and not
    one player of five games left in Japanese;
  * the schedule: a season found by its own title, Premier and Future and the play-offs kept
    apart, the summer camp / United Cup / promotion series never read, clubs by team id in English
    (Himeji Egrets becoming Hiroshima Egrets under one id), tip-offs from Japan time to UTC;
  * one game: every player's box exactly the league's own, the clubs' totals exactly its totals
    row, the score and the periods adding up to it, the play-by-play numbered 1..n in play order
    with each period opened and closed once and the final whistle last, five a side at every
    action, every player's minutes from the substitutions equal to the box's, plus/minus balancing
    to the margin, stints covering the whole game and summing to the score, and the event log
    translate() builds dropping nothing and summing to the same box;
  * a game still being played: live, clock and period from the feed, the score from the
    play-by-play, no final whistle invented;
  * the name cache: a player's page read once, then never again.

Fixtures live in scripts/ingest/data/wjbl/ (captured 2026-09-24, trimmed to what the adapter
reads): five 2025/26 games - a Premier game, a Premier overtime game, a Future overtime game and
the first two games of the 2026 final (the second with an unsportsmanlike foul) - the 2025/26 and
2026/27 schedules, and the pages of the players in those games.
"""
import copy
import json
import os
import re
import shutil
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import wjbl as W  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402
import names  # noqa: E402

DATA = os.path.join(HERE, "data", "wjbl")
PASS = FAIL = 0
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def load(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


GAMES = ("7800", "7877", "7932", "7987", "7988")
PEOPLE = load("players.json")
TMP = tempfile.mkdtemp(prefix="wjbl_test_")


class Offline(W.WjblAdapter):
    """The real adapter - its reply cache included - with the network served from the fixtures."""
    requests_made: list = []

    def _request(self, path, params):
        self.requests_made.append((path, dict(params)))
        if path == "/leagues":
            return load("leagues.json")
        if path == "/play-schedule-months":
            return load(f"months{params['league_id']}.json")
        if path == "/play-schedules":
            return load(f"sched{params['league_id']}_{params['game_month']}.json")
        if path == "/player":
            p = PEOPLE.get(str(params["player_id"]))
            return None if p is None else {"player_id": int(params["player_id"]), "player_name": p["name"],
                                           "player_name_en": p["en"], "player_furigana": p["kana"],
                                           "player_foreign_national_flg": p["foreign"]}
        game = load(f"game-{params.get('play_schedule_id')}.json")
        if game is None:
            return None
        return {"/play-schedule": game["header"], "/play-schedule/detail": game["detail"],
                "/boxscore": game["box"], "/pbp/play-by-play": game["pbp"]}.get(path)


def fresh(seed_names=True):
    """A new adapter, and a clean name cache in a temp repo (seeded from the fixtures unless asked
    not to be), so nothing here touches data/feed."""
    Offline.requests_made = []
    W.WjblAdapter._people = {}
    W.WjblAdapter._replies = {}
    root = os.path.join(TMP, "seeded" if seed_names else "empty")
    shutil.rmtree(root, ignore_errors=True)
    if seed_names:
        os.makedirs(os.path.join(root, "data", "feed", "WJBL"))
        with open(os.path.join(root, "data", "feed", "WJBL", "players.json"), "w", encoding="utf-8") as f:
            json.dump(PEOPLE, f, ensure_ascii=False)
    # the production path: the Actions runner has no scraper folder, so stints come from stints.py
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline(), {"repo_root": root}


def secs(mmss):
    m, s = str(mmss).split(":")[:2]
    return int(m) * 60 + int(s)


# ============================================================================ the vocabulary
print("-- the vocabulary")


def row(a1, a2="", a3="", pid=17454):
    return {"action1": a1, "action2": a2, "action3": a3, "player_id1": pid}


cases = [
    (row("2Pシュート アウトサイドペイント○", "ジャンプショット"), ("2pt", "", 1, [])),
    (row("2Pシュート アウトサイドペイント×", "ジャンプショット"), ("2pt", "", 0, [])),
    (row("2Pシュート インサイドペイント○", "レイアップ"), ("2pt", "layup", 1, ["pointsinthepaint"])),
    (row("3Pシュート○", "ジャンプショット"), ("3pt", "", 1, [])),
    (row("3Pシュート×", "ジャンプショット"), ("3pt", "", 0, [])),
    (row("フリースロー○"), ("freethrow", "", 1, [])),
    (row("フリースロー×"), ("freethrow", "", 0, [])),
    (row("アシスト"), ("assist", "", None, [])),
    (row("オフェンスリバウンド"), ("rebound", "offensive", None, [])),
    (row("ディフェンスリバウンド"), ("rebound", "defensive", None, [])),
    (row("チームオフェンスリバウンド", pid=None), ("rebound", "offensive", None, ["team"])),
    (row("チームディフェンスリバウンド", pid=None), ("rebound", "defensive", None, ["team"])),
    (row("スティール"), ("steal", "", None, [])),
    (row("ブロックショット"), ("block", "", None, [])),
    (row("ターンオーバー"), ("turnover", "", None, [])),
    (row("チームターンオーバー", pid=None), ("turnover", "", None, ["team"])),
    (row("タイムアウト", pid=None), ("timeout", "full", None, [])),
    (row("パーソナルファウル", "フリースローオンファウル2", "シュートファウル"), ("foul", "personal", None, ["shooting"])),
    (row("パーソナルファウル", "フリースローオンファウル0", "ファウルアウト"), ("foul", "personal", None, [])),
    (row("オフェンスファウル", "フリースローオンファウル0"), ("foul", "offensive", None, [])),
]
for r, want in cases:
    at, sub, succ, quals, unk = W.classify(r)
    ok(f"{r['action1']} / {r['action2'] or '-'} / {r['action3'] or '-'} -> {want}",
       (at, sub, succ, quals) == want and unk is None, (at, sub, succ, quals, unk))
got = W.classify(row("アンスポーツマンライク・ファウル"))
ok("a foul word it has not seen is still a foul, of the kind its words say, and is reported",
   got[:2] == ("foul", "unsportsmanlike") and got[4] == "foul:アンスポーツマンライク・ファウル", got)
got = W.classify(row("コーチテクニカルファウル", pid=None))
ok("...and one with no player is the bench's", got[:2] == ("foul", "coachtechnical"), got)
got = W.classify(row("ジャンプボール"))
ok("a word the tables do not know records nothing and is reported", got[0] is None and got[4] == "action:ジャンプボール||", got)

# ============================================================================ names
print("\n-- names: the B.LEAGUE way, with the kana spelt out")
k = names.kana_romaji
ok("kana_romaji: やまもと まい -> yamamoto mai", k("やまもと まい") == "yamamoto mai", k("やまもと まい"))
ok("...long vowels written once: さとう Sato, おおわき Owaki, とうどう Todo, ゆうき Yuki",
   [k(x) for x in ("さとう", "おおわき", "とうどう", "ゆうき")] == ["sato", "owaki", "todo", "yuki"])
ok("...but not the ue of 上: いのうえ Inoue", k("いのうえ") == "inoue", k("いのうえ"))
ok("...ん before b/m/p is m: なんば Namba, ほんま Homma; before anything else n: こんの Konno",
   [k(x) for x in ("なんば", "ほんま", "こんの")] == ["namba", "homma", "konno"])
ok("...small kana: しょう Sho, きょうこ Kyoko, ちひろ Chihiro, じゅな Juna",
   [k(x) for x in ("しょう", "きょうこ", "ちひろ", "じゅな")] == ["sho", "kyoko", "chihiro", "juna"])
ok("...っ doubles: はっとり Hattori, いっち Itchi", [k(x) for x in ("はっとり", "いっち")] == ["hattori", "itchi"])
ok("...katakana and the sounds foreign names need: ディマロ Dimaro, ファトゥ Fatu, ジェシカ Jeshika, カイリー Kairi",
   [k(x) for x in ("ディマロ", "ファトゥ", "ジェシカ", "カイリー")] == ["dimaro", "fatu", "jeshika", "kairi"])
ok("...kanji is not kana and comes back untouched", k("山本") == "山本")

lat = W.latin_name
ok("the league's own romaji, family name first in capitals -> Mai Yamamoto's form",
   lat({"id": "1", "name": "馬瓜 エブリン", "en": "MAWULI EVELYN", "kana": "まうり えぶりん"}) == ("Evelyn", "Mawuli", "league"))
ok("...several given names stay given names", lat({"id": "1", "en": "OKONKWO SUSAN AMAKA"}) == ("Susan Amaka", "Okonkwo", "league"))
ok("no romaji: the reading, spelt (山本 麻衣 やまもと まい -> Mai Yamamoto)",
   lat({"id": "1443", "name": "山本 麻衣", "en": "", "kana": "やまもと まい"}) == ("Mai", "Yamamoto", "kana"))
ok("...a foreign name in katakana is marked for a real spelling",
   lat({"id": "9", "name": "シュック カイリー アネット", "en": "", "kana": "しゅっく かいりー あねっと", "foreign": 1})[2] == "katakana")
ok("...and katakana alone says foreign even when the flag does not (カサンドラ・ブラウン, written given name first)",
   lat({"id": "9", "name": "カサンドラ・ブラウン", "en": "", "kana": "かさんどら・ぶらうん", "foreign": 0}) == ("Kasandora", "Buraun", "katakana"))
ok("a checked spelling wins over everything (20544 is Cassandra Brown)",
   lat({"id": "20544", "name": "カサンドラ・ブラウン", "en": "", "kana": "かさんどら・ぶらうん"}) == ("Cassandra", "Brown", "override"))
ok("nothing to go on -> nothing invented", lat({"id": "1", "name": "山本 麻衣"}) == ("", "", "none"))
first, last, aliases = names.person({"firstName": "", "familyName": "山本 麻衣", "internationalFirstName": "Mai",
                                     "internationalFamilyName": "Yamamoto", "name": "Mai Yamamoto"})
ok("names.person takes the Latin form and keeps the Japanese as an alias",
   (first, last) == ("Mai", "Yamamoto") and "山本 麻衣" in aliases, (first, last, aliases))

# ============================================================================ discover()
print("\n-- seasons and discover()")
ok("no season configured = the current season", W.WjblAdapter._season({}) == W.current_season())
ok("the league titles 2026/27 '26-27'", W.league_title("2026/2027") == "26-27")
ok("a Saturday 12:00 in Japan is 03:00 UTC", W.fixture_tip({"game_year": "2026", "game_date": "10.31",
                                                            "game_start_time": "12:00"}) == ("2026-10-31T03:00:00+00:00", False))
ok("a fixture with no time yet is noon UTC on its own date, time_tbc",
   W.fixture_tip({"game_year": "2027", "game_date": "01.09", "game_start_time": ""}) == ("2027-01-09T12:00:00+00:00", True))
ok("the season kinds, in the league's own words",
   [W.season_kind({"season_title": t, "season_full_name": f}) for t, f in (
       ("レギュラーシーズン", "25-26 Wリーグ レギュラーシーズン プレミア"),
       ("レギュラーシーズン", "25-26 Wリーグ レギュラーシーズン フューチャー"),
       ("プレーオフ　ファイナル", "25-26 Wリーグ プレーオフ　ファイナル"),
       ("入替戦", "25-26 Wリーグ 入替戦"),
       ("大樹生命 Wリーグ ユナイテッドカップ 2025-26 グループステージ", "…"),
       ("サマーキャンプ in いしかわ", "…"))]
   == [("premier", "regular"), ("future", "regular"), ("premier", "playoffs"), None, None, None])

a, cfg = fresh()
new = list(a.discover("https://www.wjbl.org/schedule_result/", dict(cfg, season="2026-27")))
ok("2026/27 Premier regular season: 112 fixtures (8 clubs, 28 games each)", len(new) == 112, len(new))
per = defaultdict(int)
for g in new:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
ok("...8 clubs by team id, 28 games each", set(per) == {"8", "10", "11", "12", "13", "26", "30", "31"}
   and set(per.values()) == {28}, dict(per))
ok("...read with the league list, the season's months and one request a month (7 requests)",
   [r[0] for r in Offline.requests_made] == ["/leagues", "/play-schedule-months"] + ["/play-schedules"] * 5
   and Offline.requests_made[1][1] == {"league_id": 47}, Offline.requests_made)
g0 = next((g for g in new if g.external_id == "7994"), None)
ok("the saved fixture 7994: ENEOS Sunflowers v Aisin Wings... in English, codes the team ids, 31 Oct 12:00 JST = 03:00 UTC",
   g0 is not None and (g0.home_name, g0.away_name, g0.extra["home_code"], g0.extra["away_code"], g0.tipoff_at, g0.status)
   == (W.club_name(load("sched47_2026-10.json")["seasons"]["179"]["play_schedules"][0]["home_season_team_name"])[0],
       W.club_name(load("sched47_2026-10.json")["seasons"]["179"]["play_schedules"][0]["away_season_team_name"])[0],
       str(load("sched47_2026-10.json")["seasons"]["179"]["play_schedules"][0]["home_team_id"]),
       str(load("sched47_2026-10.json")["seasons"]["179"]["play_schedules"][0]["away_team_id"]),
       "2026-10-31T03:00:00+00:00", "scheduled"),
   g0 and (g0.home_name, g0.away_name, g0.extra, g0.tipoff_at))
ok("every club named in English, none in Japanese", all(not names.has_cjk(g.home_name) and not names.has_cjk(g.away_name)
                                                     for g in new), {g.home_name for g in new if names.has_cjk(g.home_name)})
ok("crests are the league's own https URLs", all((g.extra["home_logo"] or "").startswith("https://www.wjbl.org/") for g in new))
fut = list(a.discover("x", dict(cfg, season="2026-27", division="future")))
ok("2026/27 Future: 84 fixtures, 7 clubs, and no Premier club among them",
   len(fut) == 84 and len({g.extra["home_code"] for g in fut}) == 7 and not ({g.extra["home_code"] for g in fut} & set(per)), len(fut))
hiro = {g.home_name for g in fut if g.extra["home_code"] == "232"}
ok("team 232 is Hiroshima Egrets in 2026/27", hiro == {"Hiroshima Egrets"}, hiro)
ok("the 2026/27 play-offs find nothing yet", list(a.discover("x", dict(cfg, season="2026-27", stage="playoffs"))) == [])

a, cfg = fresh()
reg = list(a.discover("x", dict(cfg, season="2025-26")))
po = list(a.discover("x", dict(cfg, season="2025/26", stage="playoffs")))
f25 = list(a.discover("x", dict(cfg, season="2025", division="future")))
ok("2025/26 Premier: 112 games, all final", len(reg) == 112 and {g.status for g in reg} == {"final"}, len(reg))
rounds = defaultdict(int)
for g in po:
    rounds[g.extra["round"]] += 1
ok("2025/26 play-offs: semi-finals 6 + final 4 = 10",
   dict(rounds) == {"プレーオフ セミファイナル": 6, "プレーオフ　ファイナル": 4}, dict(rounds))
ok("2025/26 Future: 84 games", len(f25) == 84, len(f25))
ok("team 232 was Himeji Egrets in 2025/26", {g.home_name for g in f25 if g.extra["home_code"] == "232"} == {"Himeji Egrets"})
ids = {int(g.external_id) for g in reg + po + f25}
ok("the summer camp, the United Cup and the promotion series are never read",
   not (ids & set(range(7745, 7778))) and not (ids & set(range(7974, 7978))) and not (ids & {7984, 7985, 7986}))
ok("...the monthly schedules were read once for three sources (the replies are shared)",
   sum(1 for r in Offline.requests_made if r[0] == "/play-schedules") == 9, Offline.requests_made)
a, cfg = fresh()
ok("a season the league has no schedule for is empty, not an error", list(a.discover("x", dict(cfg, season="2031-32"))) == [])
for bad, c in (("a season token that is not a season", {"season": "twenty"}),
               ("a division that is neither premier nor future", {"division": "b2"}),
               ("a stage that is neither regular nor playoffs", {"stage": "cup"})):
    try:
        list(fresh()[0].discover("x", c))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)
ok("the registry knows it, and a backfill can read a season",
   type(get_adapter("wjbl")).__name__ == "WjblAdapter"
   and '"wjbl"' in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS =", 1)[1][:500])
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if s.get("adapter") == "wjbl"]
ok("the source rows: Premier (regular season + play-offs) and Future, two women's leagues filed under Japan",
   sorted((s["league_slug"], s["adapter_config"]["division"], s["adapter_config"]["stage"]) for s in rows)
   == [("w-league-future", "future", "regular"), ("w-league-premier", "premier", "playoffs"),
       ("w-league-premier", "premier", "regular")]
   and all(s["league_country"] == "JP" and s["league_gender"] == "women" for s in rows)
   and [s.get("competition_kind") for s in rows if s["adapter_config"]["stage"] == "playoffs"] == ["playoff"]
   and len({s["scheduleUrls"][0] for s in rows}) == 3, rows)

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the league's own box")
BOX = {"pts": "sPoints", "p2m": "sTwoPointersMade", "p2a": "sTwoPointersAttempted", "p3m": "sThreePointersMade",
       "p3a": "sThreePointersAttempted", "ftm": "sFreeThrowsMade", "fta": "sFreeThrowsAttempted",
       "off": "sReboundsOffensive", "def": "sReboundsDefensive", "tot": "sReboundsTotal", "ast": "sAssists",
       "to": "sTurnovers", "stl": "sSteals", "blk": "sBlocks", "f": "sFoulsPersonal"}


def check(label, b, game):
    raw, box, det = b.raw, game["box"], game["detail"]
    # (1) every player of the league's box, every field, and a Latin name
    diffs = []
    for s, side in (("1", "home"), ("2", "away")):
        for r in box[side]["players"]:
            p = raw["tm"][s]["pl"].get(str(r["player_id"]))
            if p is None:
                diffs.append(f"{r['player_id']} missing")
                continue
            for k_, fiba in BOX.items():
                if p[fiba] != (r.get(k_) or 0):
                    diffs.append(f"{p['name']} {fiba} {p[fiba]} != {r.get(k_)}")
            if secs(p["sMinutes"]) != secs(r["min"]) or p["starter"] != r["gs"]:
                diffs.append(f"{p['name']} minutes / starter")
    ok(f"{label}: every player's box = the league's box", not diffs, diffs[:5])
    named = [row_["player_name"] for s in ("home", "away") for row_ in b.box[s]]
    ok(f"{label}: every player named in Latin letters, none left in Japanese",
       named and not [n for n in named if names.has_cjk(n) or not re.fullmatch(r"[A-Za-z' -]+", n)],
       [n for n in named if names.has_cjk(n) or not re.fullmatch(r"[A-Za-z' -]+", n)])
    # (2) the clubs' totals = the league's totals row (players + the team row)
    tdiffs = [f"team{s} {fiba}" for s, side in (("1", "home"), ("2", "away")) for k_, fiba in BOX.items()
              if raw["tm"][s]["tot_" + fiba] != (box[side]["total"].get(k_) or 0)]
    ok(f"{label}: both clubs' totals = the league's totals rows (team rebounds and turnovers included)", not tdiffs, tdiffs[:4])
    # (3) the scoreboard
    sc = {"1": det["home"]["score"], "2": det["away"]["score"]}
    ok(f"{label}: final score {sc['1']}-{sc['2']}, quarters and overtimes as the league scores them, the periods adding up",
       all(raw["tm"][s]["score"] == sc[s] and sum(v for k_, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k_)) == sc[s]
           for s in "12")
       and all((raw["tm"]["1"][f"p{q}_score"], raw["tm"]["2"][f"p{q}_score"]) == (det["home"][f"score_p{q}"], det["away"][f"score_p{q}"])
               for q in range(1, 5)))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    ok(f"{label}: tip-off from the game's own date, Japan time to UTC", b.tipoff_at == W.header_tip(game["header"]) and b.tipoff_at,
       b.tipoff_at)
    # (4) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order", an == list(range(1, len(an) + 1)))
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -secs(e["gt"])) for e in raw["pbp"]]
    ok(f"{label}: ...and the clock never runs backwards", all(x <= y for x, y in zip(el, el[1:])))
    ok(f"{label}: success 1/0, tno 0/1/2, pno a string, no private key",
       all(e["success"] in (0, 1) and not isinstance(e["success"], bool) and e["tno"] in (0, 1, 2)
           and isinstance(e["pno"], str) and not any(k_.startswith("_") for k_ in e) for e in raw["pbp"]))
    npers = raw["period"]
    starts = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"]
    ends = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
    ok(f"{label}: {npers} periods, each started and ended once, one final whistle, last",
       len(starts) == len(ends) == npers and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1
       and raw["pbp"][-1]["actionType"] == "game")
    ok(f"{label}: no action kind the adapter does not know", not raw["wjbl"]["unknown"], raw["wjbl"]["unknown"])
    ok(f"{label}: the ten announced starters are the box's ten, and none of them is a substitution",
       raw["wjbl"]["startersAnnounced"] and not [e for e in raw["pbp"] if e["actionType"] == "substitution"
                                                 and e["period"] == 1 and e["gt"] == "10:00" and e["periodType"] == "REGULAR"])
    ok(f"{label}: a team's own rebounds, turnovers and time-outs charge no player (the coach is named, not counted)",
       all(e["pno"] == "" for e in raw["pbp"] if "team" in e["qualifier"] or e["actionType"] == "timeout"))
    # (5) five a side, minutes, plus/minus, stints
    on = {s: {k_ for k_, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
    ok(f"{label}: five starters a side", all(len(on[s]) == 5 for s in "12"), {s: len(on[s]) for s in "12"})
    sec_on, last, bad = defaultdict(float), 0.0, []
    for e in raw["pbp"]:
        q = e["period"] + (4 if e["periodType"] == "OVERTIME" else 0)
        t = sum(600 if i <= 4 else 300 for i in range(1, q)) + (600 if q <= 4 else 300) - secs(e["gt"])
        for s in "12":
            for k_ in on[s]:
                sec_on[(s, k_)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["actionType"] != "substitution" and any(len(on[s]) != 5 for s in "12"):
            bad.append(e["actionNumber"])
    ok(f"{label}: five a side at every action", not bad, bad[:5])
    mdiff = [f"{p['name']} {sec_on[(s, k_)]:.0f}s != {p['sMinutes']}" for s in "12"
             for k_, p in raw["tm"][s]["pl"].items() if abs(sec_on[(s, k_)] - secs(p["sMinutes"])) > 1]
    ok(f"{label}: every player's minutes from the substitutions = the box's, to the second", not mdiff, mdiff[:4])
    margin = sc["1"] - sc["2"]
    ok(f"{label}: plus/minus counted from the floor, balancing to five times the margin ({margin:+d})",
       raw["wjbl"]["plusMinus"] and sum(p["sPlusMinusPoints"] for p in raw["tm"]["1"]["pl"].values()) == 5 * margin
       and sum(p["sPlusMinusPoints"] for p in raw["tm"]["2"]["pl"].values()) == -5 * margin)
    length = 2400 + 300 * max(0, npers - 4)
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
    ok(f"{label}: stints cover the whole game ({length}s)", abs(sum(r["duration"] for r in b.stints) - length) < 0.01,
       sum(r["duration"] for r in b.stints))
    hp, ap = sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)
    ok(f"{label}: stint points add up to the final score", (hp, ap) == (sc["1"], sc["2"]), (hp, ap))
    # (6) the event log the site will store
    tr = translate(raw)
    rep = tr["report"]
    ok(f"{label}: translate() drops nothing and matches every player", not rep["dropped"] and rep["unmatched"] == 0,
       (rep["dropped"], rep["unmatched"]))
    ok(f"{label}: translate() raises no warning", not rep["warnings"], rep["warnings"][:3])
    tally = defaultdict(lambda: defaultdict(int))
    for e in tr["events"]:
        if not e["pid"]:
            continue
        s, t = tally[e["pid"]], e["t"]
        if t in ("p2_made", "p3_made", "ft_made"):
            s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
        if t.startswith("p2") or t.startswith("p3"):
            s["fga"] += 1
            s["fgm"] += t.endswith("made")
        if t.startswith("ft"):
            s["fta"] += 1
            s["ftm"] += t == "ft_made"
        if t == "reb":
            s["oreb" if e["payload"]["off"] else "dreb"] += 1
        for k_ in ("ast", "stl", "blk", "to"):
            if t == k_:
                s[k_] += 1
        if t == "foul":
            s["pf"] += 1
    ediff = []
    for i, s in enumerate("12"):
        for pno, p in raw["tm"][s]["pl"].items():
            e = tally.get(f"{i}:{pno}", {})
            want = {"pts": p["sPoints"], "fga": p["sFieldGoalsAttempted"], "fgm": p["sFieldGoalsMade"],
                    "fta": p["sFreeThrowsAttempted"], "ftm": p["sFreeThrowsMade"],
                    "oreb": p["sReboundsOffensive"], "dreb": p["sReboundsDefensive"],
                    "ast": p["sAssists"], "stl": p["sSteals"], "blk": p["sBlocks"],
                    "to": p["sTurnovers"], "pf": p["sFoulsPersonal"]}
            for k_, v in want.items():
                if e.get(k_, 0) != v:
                    ediff.append(f"{p['name']} {k_} log={e.get(k_, 0)} box={v}")
    ok(f"{label}: the event log sums to every player's box", not ediff, ediff[:6])


LABELS = {"7800": "a Premier game (ENEOS v Toyota)", "7877": "a Premier overtime game",
          "7932": "a Future overtime game", "7987": "the first game of the 2026 final",
          "7988": "the second game of the final (an unsportsmanlike foul)"}
for gid in GAMES:
    a, cfg = fresh()
    game = load(f"game-{gid}.json")
    b = a.fetch(gid, cfg)
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    check(f"{gid} {LABELS[gid]}", b, game)
    ok(f"{gid}: no player's page was read (every name was in the cache)",
       not [r for r in Offline.requests_made if r[0] == "/player"])
    if gid == "7877":
        ok("7877: the overtime is period 1 OVERTIME, scored p5 (12-5), ot_score the same",
           b.raw["period"] == 5 and {e["period"] for e in b.raw["pbp"] if e["periodType"] == "OVERTIME"} == {1}
           and (b.raw["tm"]["1"]["p5_score"], b.raw["tm"]["2"]["p5_score"]) == (12, 5)
           and b.raw["tm"]["1"]["ot_score"] == 12)
        ok("7877: the clubs are Toyota Boshoku Sunshine Rabbits (31) and Chanson V-Magic (11), the Japanese kept",
           (b.raw["tm"]["1"]["name"], b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["name"], b.raw["tm"]["2"]["code"],
            b.raw["tm"]["2"]["nameInternational"])
           == ("Toyota Boshoku Sunshine Rabbits", "31", "Chanson V-Magic", "11", "シャンソン化粧品 シャンソンVマジック"))
        chidom = b.raw["tm"]["1"]["pl"]["18969"]
        ok("7877: チドム オデラ is Oderah Chidom (a checked spelling), her katakana still her familyName",
           (chidom["internationalFirstName"], chidom["internationalFamilyName"], chidom["familyName"])
           == ("Oderah", "Chidom", "チドム オデラ"), chidom.get("internationalFirstName"))
    if gid == "7987":
        by = {r["player_id"]: r for s in ("home", "away") for r in b.box[s]}
        ok("7987: オコンクウォ スーザン アマカ is Susan Amaka Okonkwo (the league's romaji); 山本 麻衣 is Mai Yamamoto (her reading)",
           by["17454"]["player_name"] == "Susan Amaka Okonkwo" and by["1443"]["player_name"] == "Mai Yamamoto",
           (by["17454"]["player_name"], by["1443"]["player_name"]))
        o = by["17454"]
        ok("7987: Okonkwo's line is the row on the league's own page: 13 pts, 2P 4-8, 3P 0-0, FT 5-6, "
           "3 PF, 6+13 = 19 reb, 2 TO, 32:14",
           (o["sPoints"], o["sTwoPointersMade"], o["sTwoPointersAttempted"], o["sThreePointersAttempted"],
            o["sFreeThrowsMade"], o["sFreeThrowsAttempted"], o["sFoulsPersonal"], o["sReboundsOffensive"],
            o["sReboundsDefensive"], o["sReboundsTotal"], o["sTurnovers"], o["sMinutes"])
           == (13, 4, 8, 0, 5, 6, 3, 6, 13, 19, 2, "32:14"))

print("\n-- stable payloads, and what is never fetched")
a, cfg = fresh()
h1 = a.fetch("7987", cfg).payload_hash
a, cfg = fresh()
h2 = a.fetch("7987", cfg).payload_hash
ok("the same replies twice are the same payload (the worker skips an unchanged game)", h1 == h2)
a, cfg = fresh()
ok("a fixture weeks away is not fetched at all",
   a.fetch("7994", dict(cfg, _tipoff_at="2099-10-31T03:00:00+00:00")) is None and Offline.requests_made == [])
ok("a key that is not a W League game id is not fetched", fresh()[0].fetch("bleague-506001", {}) is None)

print("\n-- the name cache")
a, cfg = fresh(seed_names=False)
b = a.fetch("7987", cfg)
reads = [r for r in Offline.requests_made if r[0] == "/player"]
nplayers = sum(len(b.raw["tm"][s]["pl"]) for s in "12")
ok(f"an empty cache: each of the game's {nplayers} players' pages read once", len(reads) == nplayers == len({r[1]["player_id"] for r in reads}),
   len(reads))
path = os.path.join(cfg["repo_root"], "data", "feed", "WJBL", "players.json")
with open(path, encoding="utf-8") as f:
    written = json.load(f)
ok("...and written to data/feed/WJBL/players.json", len(written) == nplayers and written["1443"]["kana"] == "やまもと まい")
W.WjblAdapter._people, W.WjblAdapter._replies = {}, {}
Offline.requests_made = []
a.fetch("7987", cfg)
ok("...so the next fetch reads none", not [r for r in Offline.requests_made if r[0] == "/player"], Offline.requests_made)
written["1443"]["at"] = "2020-01-01"
with open(path, "w", encoding="utf-8") as f:
    json.dump(written, f, ensure_ascii=False)
W.WjblAdapter._people, W.WjblAdapter._replies = {}, {}
Offline.requests_made = []
a.fetch("7987", cfg)
ok("...except a name with no romaji, asked for again once it is old", [r[1]["player_id"] for r in Offline.requests_made
                                                                        if r[0] == "/player"] == ["1443"])

# ============================================================================ a game in progress
print("\n-- a game still being played")
live = copy.deepcopy(load("game-7987.json"))
live["header"]["game_status"] = "playing"
live["box"]["game_status"] = "playing"
rows = live["pbp"]["play_by_plays"]
cut = next(i for i, x in enumerate(rows) if x["period"] == 3 and secs(x["rest_time"]) <= 300)
live["pbp"]["play_by_plays"] = rows[:cut]
raw = W.raw_from_game(live["header"], live["detail"], live["box"], live["pbp"], PEOPLE)
last_score = next(W._score(x["score"]) for x in reversed(rows[:cut]) if W._score(x["score"]))
last_play = rows[cut - 1]
ok("halfway through Q3: live, period 3, the clock of the last action",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 3 and secs(raw["clock"]) == secs(last_play["rest_time"]),
   (raw["period"], raw["clock"], last_play["rest_time"]))
ok("...Q1 and Q2 closed, Q3 open, no final whistle invented",
   [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1, 2]
   and not any(e["actionType"] == "game" for e in raw["pbp"]))
ok("...the score is the play-by-play's, not the league's final line",
   (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == last_score != (66, 75), (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]))
ok("...three quarter scores, the third still running, and no fourth",
   "p4_score" not in raw["tm"]["1"] and raw["tm"]["1"]["p1_score"] + raw["tm"]["1"]["p2_score"] + raw["tm"]["1"]["p3_score"] == last_score[0])
ok("a game with no box line and no action has no payload",
   W.raw_from_game(live["header"], {}, {"home": {"players": []}, "away": {"players": []}}, {"play_by_plays": []}) is None)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
