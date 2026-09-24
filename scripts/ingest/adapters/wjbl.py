# -*- coding: utf-8 -*-
"""W League (Women's Japan Basketball League, WJBL), from wjbl.org's own JSON API.

WHERE THE DATA IS. www.wjbl.org is a static front end whose pages fetch everything from one API
host, and that answers a plain GET - no key, no cookie, no browser:

    /leagues?target=play_schedule
        every season the site has a schedule for: "26-27 Wリーグ" is league 47, "25-26 Wリーグ"
        league 45. The all-star games, the SUPERGAMES and old cups are leagues of their own and are
        never asked for.
    /play-schedule-months?league_id=L, then /play-schedules?league_id=L&game_month=YYYY-MM
        a season's games, one month at a time, grouped by "season": in 2025/26 Premier regular
        season (169), Future regular season (170), play-off semi-finals (175) and final (176), and
        besides those a summer camp, the United Cup and the promotion/relegation series (入替戦),
        which are not the league and are not read.
    /play-schedule?play_schedule_id=G      the game's header (status, date, venue, clubs)
    /play-schedule/detail?play_schedule_id=G   the score by period, overtimes included
    /boxscore?play_schedule_id=G           the league's own box: a row per player, the team row
                                           (team rebounds and turnovers), the totals
    /pbp/play-by-play?play_schedule_id=G   every action, in Japanese, oldest first
    /player?player_id=P                    the player's page: her name in the league's own romaji
                                           (player_name_en), and its reading in kana (furigana)

TWO DIVISIONS, TWO LEAGUES. Premier (8 clubs in 2026/27) and Future (7) keep separate tables, as
the B.LEAGUE's B1 and B2 do here, so they are two sources - `division` in adapter_config - with the
play-offs as a third stage row of the division they belong to.

NAMES, THE B.LEAGUE WAY. The box and the play-by-play name a player only in Japanese ("山本 麻衣",
"オコンクウォ スーザン アマカ"), so everything is keyed on player_id and names.py gets both forms:
the Japanese in familyName, undivided (telling it "山本" is a given name is how it comes back out
reversed), and a Latin form in internationalFirstName / internationalFamilyName, which names.py
prefers over CJK while keeping the Japanese as a searchable alias. The Latin form is:
  1. the league's own romaji, player_name_en ("YAMAMOTO MAI" - capitals, family name FIRST, the
     order the Japanese is written in) - on 98 of 116 players checked;
  2. failing that, her kana reading spelt out by names.kana_romaji ("やまもと まい" -> Mai
     Yamamoto). Kana are sounds, so this is a spelling rather than a guess: on the 80 Japanese
     players who have both, it equals the league's romaji on 79 (the league writes one "Yuuna");
  3. except where PLAYER_EN below says otherwise. A foreign name in katakana only approximates the
     real one (オコンクウォ comes back "Okonkuwo", not Okonkwo), so a player the league gives no
     romaji for AND whose reading is not Japanese is printed once per game ("romanised from
     katakana") for a correct spelling to be added there.
The player's page is read once and kept in data/feed/WJBL/players.json (committed with the other
feed caches), so a season costs ~200 small requests, once; a name with no romaji yet is asked for
again after NAME_RECHECK_DAYS, in case the league adds one.

CLUBS by team_id (the league's own, the same every season), named in English from EN_CLUB, keyed on
the Japanese name so that a club which moves keeps its id and gets its new name (姫路イーグレッツ,
Himeji Egrets in 2025/26, is 広島イーグレッツ, Hiroshima Egrets, in 2026/27 - team 232 both times).

THE GAME is translated into FIBA LiveStats data.json shape and handed to bundle_from_raw, as every
translated league is: FORWARDS, actionNumber 1..n in play order, each period opened and closed once,
the final whistle written only when the league has signed the game off (game_status "fixed").
Four things about this feed decide whether that comes out right:
  * the ten "プレイヤーイン" rows at Q1 10:00 are the STARTER ANNOUNCEMENT (exactly the box's gs
    players), not substitutions - replaying them would put ten on court;
  * a substitution is ONE row, "#15 安間 → #7 横山": player 1 goes OFF, player 2 comes ON (a player
    who fouls out is player 1 of the row after her fifth foul);
  * the score is written only on a scoring row, "home-away", and carried forward here;
  * a team's rebound, turnover or time-out names the COACH as player 1 with no player_id - so a
    team action is recognised by its own word ("チーム…", "タイムアウト"), never by who it names.
A description the tables do not know is not guessed: it is kept on raw["wjbl"]["unknown"] and
printed.

WHAT IS AND IS NOT THERE. No shot chart (the play-by-play has no coordinates) and no shot location:
every 2-point attempt of five games checked is "アウトサイドペイント ジャンプショット", which is a
default rather than an observation, so it is not carried as a jump shot and paint points stay 0
(an "インサイドペイント" shot, if the league starts recording one, becomes points in the paint).
No fouls drawn, no fast-break or second-chance tags. Plus/minus is not in the box, so it is counted
here from the play-by-play (five a side at every basket, or it is left at 0), and EFF is the usual
PTS+REB+AST+STL+BLK-missed FG-missed FT-TOV.
"""
from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA
from .twobbl import current_season, normalize_season

import names as _names                  # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

API = "https://api.wjbl.01core.app/api"
SITE = "https://www.wjbl.org"
HEADERS = {"User-Agent": UA, "Accept": "application/json", "Origin": SITE, "Referer": SITE + "/"}
JST = timezone(timedelta(hours=9))       # Japan keeps no summer time: +09:00 is exact
FINAL = "fixed"                          # game_status once the league has signed the game off
SCHEDULED = "scheduled"
#: fetchwindow's lead: before it, a game has nothing to say
FETCH_LEAD_S = 30 * 60
#: a name the league has no romaji for is asked for again after this many days
NAME_RECHECK_DAYS = 14
DIVISIONS = ("premier", "future")
STAGES = ("regular", "playoffs")

# A CLUB'S NAME IN ENGLISH, keyed on its Japanese name for the season. The league publishes clubs
# only in Japanese (SMBC TOKYO SOLUA apart); these are the clubs' own English names. A name not in
# here is printed and kept in Japanese until it is added - never transliterated, because
# "アイシン ウィングス" spelt out by sound is not what Aisin Wings are called.
EN_CLUB: Dict[str, Tuple[str, str]] = {
    "ENEOSサンフラワーズ": ("ENEOS Sunflowers", "ENEOS"),
    "アイシン ウィングス": ("Aisin Wings", "Aisin"),
    "シャンソン化粧品 シャンソンVマジック": ("Chanson V-Magic", "Chanson"),
    "デンソー アイリス": ("Denso Iris", "Denso"),
    "トヨタ自動車 アンテロープス": ("Toyota Antelopes", "Toyota"),
    "東京羽田ヴィッキーズ": ("Tokyo Haneda Vickies", "Haneda"),
    "山梨クィーンビーズ": ("Yamanashi Queen Bees", "Yamanashi"),
    "三菱電機 コアラーズ": ("Mitsubishi Electric Koalas", "Mitsubishi"),
    "日立ハイテク クーガーズ": ("Hitachi High-Tech Cougars", "Hitachi"),
    "富士通 レッドウェーブ": ("Fujitsu Red Wave", "Fujitsu"),
    "トヨタ紡織 サンシャインラビッツ": ("Toyota Boshoku Sunshine Rabbits", "Boshoku"),
    "新潟アルビレックスBBラビッツ": ("Niigata Albirex BB Rabbits", "Niigata"),
    "プレステージインターナショナル アランマーレ": ("Prestige International Aranmare", "Aranmare"),
    "姫路イーグレッツ": ("Himeji Egrets", "Himeji"),
    "広島イーグレッツ": ("Hiroshima Egrets", "Hiroshima"),
    "SMBC TOKYO SOLUA": ("SMBC Tokyo Solua", "SMBC"),
}

# A PLAYER'S NAME where the league has no romaji and her kana reading is not a Japanese name, as
# player_id -> "Given Family". Only ever a spelling somebody has checked (the club's own roster,
# a national federation, the player's college): an entry here is shown on every page she is on.
# The six below are every such player of five 2025/26 games, checked 2026-09-24 against her club,
# college or national federation - the katakana gave "Odera Chidomu" for Oderah Chidom.
PLAYER_EN: Dict[str, str] = {
    "14393": "Jessica Dimaro",          # ディマロ ジェシカ ワリエビモ エレ, Toyota Boshoku (now Virginia Tech)
    "18968": "Kylee Shook",             # シュック カイリー アネット, Toyota Antelopes (Louisville)
    "18969": "Oderah Chidom",           # チドム オデラ, Toyota Boshoku (Duke)
    "18973": "Jack Animam",             # アニマム ジャックダニエル, Denso Iris (Philippines)
    "20544": "Cassandra Brown",         # カサンドラ・ブラウン, Chanson V-Magic (Canada)
    "20552": "Evelyn Akhator",          # アカトー オーサリテン エブリン, Fujitsu Red Wave (Kentucky)
}


# ============================================================================ small pieces
def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _secs(clock) -> int:
    """'9:38' / '10:00' / '22:19' -> seconds; anything unreadable is 0."""
    m = re.match(r"^\s*(\d+):(\d{1,2})", str(clock or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _mmss(clock) -> str:
    s = _secs(clock)
    return f"{s // 60}:{s % 60:02d}"


def _score(s) -> Optional[Tuple[int, int]]:
    """'12-9' (home-away) -> (12, 9); None on a row that did not score."""
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def club_name(japanese: str) -> Tuple[str, str]:
    """(English name, short name) for a club's Japanese name, or the name itself where EN_CLUB has
    none - latinised by names.team_name only if it is Latin already."""
    ja = re.sub(r"\s+", " ", str(japanese or "").strip())
    if ja in EN_CLUB:
        return EN_CLUB[ja]
    return ja, ja


def logo_url(path) -> Optional[str]:
    p = str(path or "").strip()
    if p.startswith("http"):
        return p
    return SITE + p if p.startswith("/") else None


def jst_to_utc(year, month, day, hhmm) -> Tuple[Optional[str], bool]:
    """(tip-off in UTC, time still to be confirmed). A fixture with no time yet is noon UTC on its
    local date (21:00 in Japan, the same day), marked time_tbc - the U SPORTS / LBA convention."""
    try:
        y, mo, d = int(year), int(month), int(day)
    except (TypeError, ValueError):
        return None, False
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", str(hhmm or ""))
    if not m:
        return f"{y:04d}-{mo:02d}-{d:02d}T12:00:00+00:00", True
    local = datetime(y, mo, d, int(m.group(1)), int(m.group(2)), tzinfo=JST)
    return local.astimezone(timezone.utc).isoformat(), False


def fixture_tip(row: dict) -> Tuple[Optional[str], bool]:
    """A schedule row: game_year "2026", game_date "10.31", game_start_time "12:00" (Japan)."""
    m = re.match(r"^\s*(\d{1,2})\.(\d{1,2})", str(row.get("game_date") or ""))
    if not m:
        return None, False
    return jst_to_utc(row.get("game_year"), m.group(1), m.group(2), row.get("game_start_time"))


def header_tip(h: dict) -> Optional[str]:
    """A game header: game_date "2026年1月31日(土)", game_start_time "13:00" (Japan)."""
    m = re.match(r"^\s*(\d{4})年(\d{1,2})月(\d{1,2})日", str(h.get("game_date") or ""))
    if not m:
        return None
    return jst_to_utc(m.group(1), m.group(2), m.group(3), h.get("game_start_time"))[0]


def _too_early(tip, now: Optional[datetime] = None) -> bool:
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip else None
    except ValueError:
        return False
    if t is None:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t - (now or datetime.now(timezone.utc))).total_seconds() > FETCH_LEAD_S


def season_kind(season: dict) -> Optional[Tuple[str, str]]:
    """(division, stage) for one of the league's "seasons", or None for one that is not the league
    (the summer camp, the United Cup, the promotion/relegation series, an all-star game).

    Read from the league's own words: レギュラーシーズン is the regular season, プレーオフ the
    play-offs, and the division is フューチャー (Future) or, otherwise, the top flight - which is
    what a season from before the split (one division, no word) was too."""
    words = f"{season.get('season_title') or ''} {season.get('season_full_name') or ''}"
    if "レギュラーシーズン" in words:
        stage = "regular"
    elif "プレーオフ" in words:
        stage = "playoffs"
    else:
        return None
    return ("future" if "フューチャー" in words else "premier"), stage


def league_title(season: str) -> str:
    """'2026/2027' -> '26-27', how the league titles its seasons ("26-27 Wリーグ")."""
    y = int(season[:4])
    return f"{y % 100:02d}-{(y + 1) % 100:02d}"


# ============================================================================ names
def latin_name(info: Optional[dict]) -> Tuple[str, str, str]:
    """(given, family, how) in Latin for one player, from what her page says.

    how: "override" (PLAYER_EN), "league" (player_name_en), "kana" (her reading, spelt by
    names.kana_romaji), "katakana" (the same, from a name that is not Japanese - an approximation
    worth correcting), or "none" when there is nothing to go on."""
    info = info or {}
    pid = str(info.get("id") or "")
    if pid in PLAYER_EN:                        # "Given Family": the family name is the last word
        parts = PLAYER_EN[pid].split()
        return " ".join(parts[:-1]), parts[-1], "override"
    en = re.sub(r"\s+", " ", str(info.get("en") or "").strip())
    if en:
        words = en.split(" ")
        if len(words) == 1:
            given, family = "", words[0]
        else:                                   # family name first, as the Japanese is written
            given, family = " ".join(words[1:]), words[0]
        given, family, _ = _names.person({"firstName": given, "familyName": family})
        return given, family, "league"
    kana = str(info.get("kana") or "").strip()
    if not kana or not _names.is_kana(kana):
        return "", "", "none"
    if "・" in kana and not re.search(r"[\s　]", kana):
        parts = [p for p in kana.split("・") if p]      # カサンドラ・ブラウン: written given-first
        given_k, family_k = " ".join(parts[:-1]), parts[-1]
    else:
        parts = [p for p in re.split(r"[\s　]+", kana) if p]
        family_k, given_k = parts[0], " ".join(parts[1:])

    def spell(k):
        return " ".join(w.capitalize() for w in _names.kana_romaji(k).split())
    # NOT A JAPANESE NAME when the league says so, or when it is written in katakana alone (no
    # kanji, no hiragana): カサンドラ・ブラウン is flagged 0 and is Cassandra Brown
    native = str(info.get("name") or "")
    katakana_only = bool(re.search("[ァ-ヺ]", native)) and not re.search("[ぁ-ゖ一-鿿]", native)
    foreign = bool(_num(info.get("foreign"))) or katakana_only
    return spell(given_k), spell(family_k), ("katakana" if foreign else "kana")


# ============================================================================ the vocabulary
SHOT = re.compile(r"^([23])Pシュート(?:\s*(インサイド|アウトサイド)ペイント)?\s*([○×])$")
FREE_THROW = re.compile(r"^フリースロー\s*([○×])$")
#: action2 on a shot. ジャンプショット is not here on purpose: it is on every shot (see the top)
SHOT_KIND = {"レイアップ": "layup", "レイアップシュート": "layup", "ダンク": "dunk", "ダンクシュート": "dunk",
             "フックショット": "hookshot", "ティップイン": "tipin", "アリウープ": "alleyoop"}
PLAYER = {"アシスト": ("assist", ""), "オフェンスリバウンド": ("rebound", "offensive"),
          "ディフェンスリバウンド": ("rebound", "defensive"), "スティール": ("steal", ""),
          "ブロックショット": ("block", ""), "ターンオーバー": ("turnover", "")}
TEAM = {"チームオフェンスリバウンド": ("rebound", "offensive"), "チームディフェンスリバウンド": ("rebound", "defensive"),
        "チームターンオーバー": ("turnover", ""), "タイムアウト": ("timeout", "full")}
#: every one of these counts in the box's PF. The league writes an unsportsmanlike foul
#: "アンスポーツマンファウル" (game 7988), not the rulebook's "…ライクファウル"; both are here
FOUL = {"パーソナルファウル": "personal", "オフェンスファウル": "offensive", "テクニカルファウル": "technical",
        "アンスポーツマンファウル": "unsportsmanlike", "アンスポーツマンライクファウル": "unsportsmanlike",
        "ディスクォリファイングファウル": "disqualifying"}
SUB_IN, SUB_SWAP = "プレイヤーイン", "プレイヤーインアウト"
PERIOD_END, GAME_END = "クォーターエンド", "試合終了"


def classify(r: dict) -> Tuple[Optional[str], str, Optional[int], List[str], Optional[str]]:
    """(actionType, subType, success, qualifier, unknown) for one row that is not a substitution,
    a period end or the final whistle. actionType None = records nothing (and `unknown` says why
    when it is a word the tables do not know)."""
    a1 = str(r.get("action1") or "").strip()
    a2 = str(r.get("action2") or "").strip()
    a3 = str(r.get("action3") or "").strip()
    m = SHOT.match(a1)
    if m:
        made = 1 if m.group(3) == "○" else 0
        at = "3pt" if m.group(1) == "3" else "2pt"
        quals = ["pointsinthepaint"] if at == "2pt" and made and m.group(2) == "インサイド" else []
        return at, SHOT_KIND.get(a2, ""), made, quals, None
    m = FREE_THROW.match(a1)
    if m:
        return "freethrow", "", 1 if m.group(1) == "○" else 0, [], None
    if a1 in PLAYER:
        at, sub = PLAYER[a1]
        return at, sub, None, [], None
    if a1 in TEAM:
        at, sub = TEAM[a1]
        return at, sub, None, (["team"] if at in ("rebound", "turnover") else []), None
    if a1.endswith("ファウル"):
        quals = ["shooting"] if a3 == "シュートファウル" else []
        if a1 in FOUL:
            return "foul", FOUL[a1], None, quals, None
        # a foul word the five games did not show: its kind by its own words, and reported
        kind = ("technical" if "テクニカル" in a1 else "unsportsmanlike" if "アンスポ" in a1
                else "disqualifying" if ("ディスクォ" in a1 or "失格" in a1) else "offensive" if "オフェンス" in a1
                else "personal")
        if not r.get("player_id1"):
            kind = "coachtechnical" if "コーチ" in a1 else "benchtechnical"
        return "foul", kind, None, quals, f"foul:{a1}"
    return None, "", None, [], f"action:{a1}|{a2}|{a3}"


# ============================================================================ one game
def raw_from_game(header: dict, detail: dict, box: dict, pbp: dict,
                  people: Optional[Dict[str, dict]] = None) -> Optional[dict]:
    """One W League game (header, period scores, box, play-by-play, and each player's page as
    {"name", "en", "kana", "foreign"} by player_id) -> FIBA data.json shape: play-by-play OLDEST
    first, actionNumber 1..n, periods and the final whistle written once each. Pure: same input,
    same output.

    None when there is nothing to show yet (no box line and not one action)."""
    header, detail, box = header or {}, detail or {}, box or {}
    people = people or {}
    rows = [r for r in ((pbp or {}).get("play_by_plays") or []) if isinstance(r, dict)]
    side_box = {1: box.get("home") or {}, 2: box.get("away") or {}}
    if not rows and not any((side_box[t].get("players") or []) for t in (1, 2)):
        return None
    finished = str(header.get("game_status") or box.get("game_status") or "") == FINAL
    tid = {t: _num((header.get(k) or {}).get("team_id") or side_box[t].get("team_id"))
           for t, k in ((1, "home"), (2, "away"))}
    tno_of = {tid[1]: 1, tid[2]: 2}
    starters = {t: {str(p.get("player_id")) for p in side_box[t].get("players") or [] if _num(p.get("gs")) == 1}
                for t in (1, 2)}

    def tno(r) -> int:
        ha = _num(r.get("home_away"))
        return ha if ha in (1, 2) else tno_of.get(_num(r.get("team_id")), 0)

    # ------------------------------------------------------------------ the play-by-play
    unknown: List[str] = []
    keyed = []
    closed = set()
    announced = {1: set(), 2: set()}
    played_yet = False
    for i, r in enumerate(rows):
        qn = _num(r.get("period")) or 1
        a1 = str(r.get("action1") or "").strip()
        plen = 600 if qn <= 4 else 300
        remain = _secs(r.get("rest_time"))
        key = (qn, plen - remain, i)
        base = {"period": qn if qn <= 4 else qn - 4, "periodType": "REGULAR" if qn <= 4 else "OVERTIME",
                "gt": f"{remain // 60:02d}:{remain % 60:02d}", "tno": tno(r), "qualifier": [], "success": 0,
                "scoring": 0, "_score": _score(r.get("score"))}
        if a1 == PERIOD_END or _num(r.get("end_period_flg")):
            closed.add(qn)
            if base["_score"]:
                keyed.append((key + (0,), dict(base, actionType="_score", subType="", pno="", tno=0), r))
            continue
        if a1 == GAME_END or _num(r.get("end_game_flg")):
            continue                     # written below, and only once the league signs it off
        if a1 == SUB_IN and qn == 1 and remain == 600 and not played_yet:
            announced.setdefault(base["tno"], set()).add(str(r.get("player_id1") or ""))
            continue                     # the starter announcement, not a substitution
        if a1 in (SUB_IN, SUB_SWAP):
            out_id, in_id = (None, r.get("player_id1")) if a1 == SUB_IN else (r.get("player_id1"), r.get("player_id2"))
            for n, (pid, sub) in enumerate(((out_id, "out"), (in_id, "in"))):
                if pid:
                    keyed.append((key + (n,), dict(base, actionType="substitution", subType=sub, pno=str(pid)), r))
            continue
        played_yet = True
        at, sub, success, quals, unk = classify(r)
        if unk:
            unknown.append(unk)
        if not at:
            continue
        team_action = "team" in quals or at == "timeout" or (at == "foul" and sub in ("coachtechnical", "benchtechnical"))
        pid = "" if team_action else str(r.get("player_id1") or "")
        ev = dict(base, actionType=at, subType=sub, pno=pid, qualifier=quals,
                  success=success if success is not None else 0,
                  scoring=1 if (at in ("2pt", "3pt", "freethrow") and success == 1) else 0)
        keyed.append((key + (0,), ev, r))
    if not keyed and not any((side_box[t].get("players") or []) for t in (1, 2)):
        return None
    keyed.sort(key=lambda t: t[0])

    # the running score, which the feed writes only on the row that changed it
    score = (0, 0)
    for _, ev, _r in keyed:
        if ev.pop("_score", None) is not None and _r is not None:
            score = _score(_r.get("score")) or score
        ev["s1"], ev["s2"] = str(score[0]), str(score[1])
    period_close = [ev for _, ev, _ in keyed if ev["actionType"] == "_score"]
    chrono = [ev for _, ev, _ in keyed if ev["actionType"] != "_score"]

    # free-throw trips: one shooter at one clock time, "k of n"
    trips: Dict[tuple, List[dict]] = {}
    for ev in chrono:
        if ev["actionType"] == "freethrow":
            trips.setdefault((ev["period"], ev["periodType"], ev["gt"], ev["tno"], ev["pno"]), []).append(ev)
    for trip in trips.values():
        for k, ev in enumerate(trip, start=1):
            ev["subType"] = f"{k}of{len(trip)}"

    def pnum(ev):
        return ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)

    last_q = max([pnum(ev) for ev in chrono] + [max(closed) if closed else 1])
    closed |= set(range(1, last_q))
    if finished:
        closed.add(last_q)
    by_q: Dict[int, List[dict]] = {}
    for ev in chrono:
        by_q.setdefault(pnum(ev), []).append(ev)
    end_score = {pnum(ev): (int(ev["s1"]), int(ev["s2"])) for ev in period_close}
    running = ["0", "0"]

    def marker(qn, action, sub, clock):
        return {"actionNumber": 0, "period": qn if qn <= 4 else qn - 4,
                "periodType": "REGULAR" if qn <= 4 else "OVERTIME", "gt": clock,
                "s1": running[0], "s2": running[1], "tno": 0, "pno": "",
                "actionType": action, "subType": sub, "qualifier": [], "success": 0, "scoring": 0}

    events: List[dict] = []
    period_end_score: Dict[int, Tuple[int, int]] = {}
    for qn in range(1, last_q + 1):
        events.append(marker(qn, "period", "start", "10:00" if qn <= 4 else "05:00"))
        for ev in by_q.get(qn, []):
            events.append(ev)
            running = [ev["s1"], ev["s2"]]
        if qn in end_score:
            running = [str(end_score[qn][0]), str(end_score[qn][1])]
        period_end_score[qn] = (int(running[0]), int(running[1]))
        if qn in closed:
            events.append(marker(qn, "period", "end", "00:00"))
    if finished:
        events.append(marker(last_q, "game", "end", "00:00"))
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n

    # ------------------------------------------------------------------ plus/minus, from the floor
    pm, pm_ok = _plus_minus(events, starters)
    paint: Dict[Tuple[int, str], int] = {}
    for ev in chrono:
        if ev["scoring"] and "pointsinthepaint" in ev["qualifier"]:
            paint[(ev["tno"], ev["pno"])] = paint.get((ev["tno"], ev["pno"]), 0) + 2
    # the league's own period scores once it has signed the game off, the play-by-play's until then
    league_line = finished and all((detail.get(s) or {}).get("score") is not None for s in ("home", "away"))

    # ------------------------------------------------------------------ the box
    names_how: Dict[str, List[str]] = {"league": [], "kana": [], "katakana": [], "override": [], "none": []}
    tm: Dict[str, dict] = {}
    for t, side in ((1, "home"), (2, "away")):
        b = side_box[t]
        h = header.get(side) or {}
        d = detail.get(side) or {}
        pl: Dict[str, dict] = {}
        bench = 0
        for r in b.get("players") or []:
            pid = str(r.get("player_id") or "").strip()
            if not pid:
                continue
            native = re.sub(r"\s+", " ", str(r.get("player_name") or "").strip())
            info = dict(people.get(pid) or {}, id=pid)
            info.setdefault("name", native)
            given, family, how = latin_name(info)
            names_how[how].append(f"{native} ({pid})")
            mins = _mmss(r.get("min"))
            st = _stats(r)
            p = S.player(last=native, name=f"{given} {family}".strip() or native,
                         shirt=str(r.get("player_number") or "").strip(),
                         starter=1 if _num(r.get("gs")) == 1 else 0,
                         active=1 if _secs(mins) > 0 else 0, minutes=mins, stats=st)
            if family:
                p["internationalFirstName"], p["internationalFamilyName"] = given, family
            p["sPlusMinusPoints"] = pm.get((t, pid), 0) if pm_ok else 0
            p["sPointsInThePaint"] = paint.get((t, pid), 0)
            p["eff_1"] = (st["sPoints"] + st["sReboundsTotal"] + st["sAssists"] + st["sSteals"] + st["sBlocks"]
                          - (st["sFieldGoalsAttempted"] - st["sFieldGoalsMade"])
                          - (st["sFreeThrowsAttempted"] - st["sFreeThrowsMade"]) - st["sTurnovers"])
            if not p["starter"]:
                bench += st["sPoints"]
            pl[pid] = p
        team_row = b.get("team") or {}
        totals = _stats(b.get("total") or {}) if b.get("total") else None
        ja = str(h.get("season_team_name") or b.get("season_team_name") or d.get("season_team_name") or "").strip()
        name, short = club_name(ja)
        # A QUARTER NOT PLAYED YET IS LEFT ABSENT, not written as 0 (see bleague.py)
        quarters = [d.get(f"score_p{q}") for q in range(1, 5)] if league_line else \
            [period_end_score.get(q, (0, 0))[t - 1] - (period_end_score.get(q - 1, (0, 0))[t - 1] if q > 1 else 0)
             for q in range(1, min(last_q, 4) + 1)]
        tt = S.team(name, str(tid[t] or ""), score=None, quarters=quarters, players=pl, shots=[],
                    logo=logo_url(h.get("team_logo_image") or b.get("team_logo_image")), totals=totals,
                    short_name=short)
        tt["nameInternational"] = ja
        tt["tot_sFoulsPersonal"] = sum(p["sFoulsPersonal"] for p in pl.values())
        tt["tot_sFoulsTeam"] = _num(team_row.get("f"))
        tt["tot_sReboundsTeamOffensive"] = _num(team_row.get("off"))
        tt["tot_sReboundsTeamDefensive"] = _num(team_row.get("def"))
        tt["tot_sReboundsTeam"] = _num(team_row.get("tot"))
        tt["tot_sTurnoversTeam"] = _num(team_row.get("to"))
        tt["tot_sBenchPoints"] = bench
        tt["tot_sPointsInThePaint"] = sum(p["sPointsInThePaint"] for p in pl.values())
        tm[str(t)] = tt

    if league_line:
        tm["1"]["score"], tm["2"]["score"] = _num(detail["home"]["score"]), _num(detail["away"]["score"])
        for s, side in (("1", "home"), ("2", "away")):
            for k in range(1, 5):
                v = (detail.get(side) or {}).get(f"score_ot{k}")
                if v is not None:
                    tm[s][f"p{4 + k}_score"] = _num(v)
    else:
        tm["1"]["score"], tm["2"]["score"] = period_end_score.get(last_q, (0, 0))
        for qn in range(5, last_q + 1):
            for s in ("1", "2"):
                i = int(s) - 1
                tm[s][f"p{qn}_score"] = period_end_score.get(qn, (0, 0))[i] - period_end_score.get(qn - 1, (0, 0))[i]
    for s in ("1", "2"):
        tm[s]["ot_score"] = sum(v for k, v in tm[s].items() if re.fullmatch(r"p([5-9]|\d\d)_score", k))
        tm[s]["full_score"] = tm[s]["score"]

    # biggest lead and lead changes, from the running score
    lead = {1: 0, 2: 0}
    changes, leader = 0, 0
    for ev in chrono:
        diff = int(ev["s1"]) - int(ev["s2"])
        lead[1], lead[2] = max(lead[1], diff), max(lead[2], -diff)
        now = (diff > 0) - (diff < 0)
        if now and leader and now != leader:
            changes += 1
        if now:
            leader = now
    for s, k in (("1", 1), ("2", 2)):
        tm[s]["tot_sBiggestLead"] = lead[k]
        tm[s]["tot_sLeadChanges"] = changes

    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    raw = {"tm": tm, "pbp": events, "period": last_q,
           "periodType": "REGULAR" if last_q <= 4 else "OVERTIME", "inOT": 1 if last_q > 4 else 0}
    if finished or last_q in closed:
        raw["clock"] = "00:00"
    else:
        raw["clock"] = last_play["gt"] if last_play and pnum(last_play) == last_q else (
            "10:00" if last_q <= 4 else "05:00")
    announced_ok = all(not announced[t] or announced[t] == starters[t] for t in (1, 2))
    raw["wjbl"] = {"gameId": str(header.get("play_schedule_id") or box.get("play_schedule_id") or ""),
                   "leagueId": _num(header.get("league_id")), "seasonId": _num(header.get("season_id")),
                   "season": (header.get("season_full_name") or "").strip() or None,
                   "status": str(header.get("game_status") or ""), "date": header_tip(header),
                   "venue": (header.get("venue") or "").strip() or None,
                   "plusMinus": bool(pm_ok), "startersAnnounced": announced_ok,
                   "names": {k: v for k, v in names_how.items() if v},
                   "unknown": sorted(set(unknown))}
    return raw


def _plus_minus(events: List[dict], starters: Dict[int, set]) -> Tuple[Dict[Tuple[int, str], int], bool]:
    """Each player's +/- from the floor: every point scored while she was on it, for or against.
    (…, False) the moment either side is not five - a number off by one lineup is worse than none."""
    on = {1: set(starters[1]), 2: set(starters[2])}
    pm: Dict[Tuple[int, str], int] = {}
    if len(on[1]) != 5 or len(on[2]) != 5:
        return pm, False
    for ev in events:
        t = ev.get("tno")
        if ev["actionType"] == "substitution" and t in (1, 2):
            (on[t].discard if ev["subType"] == "out" else on[t].add)(ev["pno"])
            continue
        if not ev.get("scoring") or t not in (1, 2):
            continue
        if len(on[1]) != 5 or len(on[2]) != 5:
            return pm, False
        pts = {"2pt": 2, "3pt": 3, "freethrow": 1}[ev["actionType"]]
        for side in (1, 2):
            for pid in on[side]:
                pm[(side, pid)] = pm.get((side, pid), 0) + (pts if side == t else -pts)
    return pm, True


def _stats(r: dict) -> dict:
    """One box line (a player, or the totals) -> FIBA's stat names."""
    g = lambda k: _num(r.get(k))  # noqa: E731
    return {
        "sPoints": g("pts"),
        "sTwoPointersMade": g("p2m"), "sTwoPointersAttempted": g("p2a"),
        "sThreePointersMade": g("p3m"), "sThreePointersAttempted": g("p3a"),
        "sFieldGoalsMade": g("p2m") + g("p3m"), "sFieldGoalsAttempted": g("p2a") + g("p3a"),
        "sFreeThrowsMade": g("ftm"), "sFreeThrowsAttempted": g("fta"),
        "sReboundsOffensive": g("off"), "sReboundsDefensive": g("def"), "sReboundsTotal": g("tot"),
        "sAssists": g("ast"), "sTurnovers": g("to"), "sSteals": g("stl"), "sBlocks": g("blk"),
        "sFoulsPersonal": g("f"),
    }


# ============================================================================ the adapter
class WjblAdapter(FibaLiveStatsAdapter):
    """The W League. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "wjbl"
    #: a league's own website, not a CDN built to be polled
    min_request_gap_s = 1.0

    # shared across instances: the division / play-off sources and the live lane's fetches
    _replies: dict = {}          # url -> (fetched_at, reply)
    TTL_S = 300.0
    _people: dict = {}           # cache path -> {player_id: {...}}

    # ------------------------------------------------------------------ discovery
    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        season = self._season(config)
        division = (config.get("division") or "premier").strip().lower()
        stage = (config.get("stage") or "regular").strip().lower()
        if division not in DIVISIONS:
            raise ValueError(f"wjbl: division must be one of {DIVISIONS}, not {division!r}")
        if stage not in STAGES:
            raise ValueError(f"wjbl: stage must be one of {STAGES}, not {stage!r}")
        lid = self._league_id(season)
        if lid is None:
            print(f"     W League {season}: the league lists no season \"{league_title(season)} Wリーグ\" yet")
            return []
        months = self._get_json("/play-schedule-months", league_id=lid)
        if not isinstance(months, dict):
            raise RuntimeError("wjbl: schedule months unreachable")
        out, seen, names_unknown = [], set(), set()
        for m in sorted(x.get("game_month") for x in months.get("game_months") or [] if x.get("game_month")):
            got = self._get_json("/play-schedules", league_id=lid, game_month=m)
            if not isinstance(got, dict):
                raise RuntimeError(f"wjbl: schedule for {m} unreachable")
            for sid, s in sorted((got.get("seasons") or {}).items()):
                if season_kind(s) != (division, stage):
                    continue
                for r in s.get("play_schedules") or []:
                    g = self._schedule_game(r, stage, division)
                    if g and g.external_id not in seen:
                        seen.add(g.external_id)
                        out.append(g)
                        for side in ("home", "away"):
                            ja = (r.get(f"{side}_season_team_name") or "").strip()
                            if ja and ja not in EN_CLUB:
                                names_unknown.add(ja)
        if names_unknown:
            print(f"     W League: no English name for {', '.join(sorted(names_unknown))} - add to wjbl.EN_CLUB")
        print(f"     W League {season} {division} {stage}: {len(out)} games "
              f"({sum(1 for g in out if g.status == 'final')} final, {sum(1 for g in out if g.status == 'live')} live)")
        return out

    @staticmethod
    def _schedule_game(r: dict, stage: str, division: str) -> Optional[ScheduleGame]:
        gid = str(r.get("play_schedule_id") or "").strip()
        h, a = _num(r.get("home_team_id")), _num(r.get("away_team_id"))
        if not gid or not h or not a or _num(r.get("cancel_flg")):
            return None                 # a cancelled game is no game (NBL's rule)
        tip, tbc = fixture_tip(r)
        st = str(r.get("game_status") or "")
        status = "final" if st == FINAL else "scheduled" if (st == SCHEDULED or not r.get("started_at")) else "live"
        extra = {"home_code": str(h), "away_code": str(a),
                 "home_logo": logo_url(r.get("home_team_logo_image")), "away_logo": logo_url(r.get("away_team_logo_image")),
                 "round": (r.get("season_title") or "").strip(), "stage": stage, "division": division,
                 "season_id": _num(r.get("season_id")), "venue": (r.get("venue") or "").strip() or None}
        if tbc:
            extra["time_tbc"] = True
        return ScheduleGame(external_id=gid, home_name=club_name(r.get("home_season_team_name"))[0],
                            away_name=club_name(r.get("away_season_team_name"))[0],
                            tipoff_at=tip, status=status, extra=extra)

    @staticmethod
    def _season(config: dict) -> str:
        tok = config.get("season")
        if not tok:
            return current_season()
        season = normalize_season(tok)
        if not season:
            raise ValueError(f"wjbl: season {tok!r} not understood (want e.g. 2026-27)")
        return season

    def _league_id(self, season: str) -> Optional[int]:
        got = self._get_json("/leagues", target="play_schedule")
        if not isinstance(got, list):
            raise RuntimeError("wjbl: league list unreachable")
        want = league_title(season)
        for x in got:
            # NFKC: the league titles its older seasons in full-width ("Ｗリーグ") as well
            t = unicodedata.normalize("NFKC", str(x.get("league_title") or ""))
            if re.fullmatch(rf"\s*{want}\s*Wリーグ\s*", t):
                return _num(x.get("league_id")) or None
        return None

    # ------------------------------------------------------------------ one game
    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id).strip()
        if not gid.isdigit() or _too_early(config.get("_tipoff_at")):
            return None                   # decided before a single request is made
        header = self._get_json("/play-schedule", play_schedule_id=gid, fresh=True)
        if not isinstance(header, dict) or not header.get("play_schedule_id") or _num(header.get("cancel_flg")):
            return None
        pbp = self._get_json("/pbp/play-by-play", play_schedule_id=gid, fresh=True)
        box = self._get_json("/boxscore", play_schedule_id=gid, fresh=True)
        if str(header.get("game_status")) == SCHEDULED and not ((pbp or {}).get("play_by_plays") if isinstance(pbp, dict) else None):
            return None
        detail = self._get_json("/play-schedule/detail", play_schedule_id=gid, fresh=True)
        box = box if isinstance(box, dict) else {}
        ids = {str(p["player_id"]) for side in ("home", "away")
               for p in (box.get(side) or {}).get("players") or [] if p.get("player_id")}
        raw = raw_from_game(header, detail if isinstance(detail, dict) else {}, box,
                            pbp if isinstance(pbp, dict) else {}, self._names(ids, config))
        if raw is None:
            return None
        info = raw["wjbl"]
        if info["unknown"]:
            print(f"     W League {gid}: {len(info['unknown'])} action kind(s) the adapter does not know: {info['unknown'][:4]}")
        if info["names"].get("katakana"):
            print(f"     W League {gid}: romanised from katakana, worth a real spelling in wjbl.PLAYER_EN: "
                  f"{', '.join(info['names']['katakana'][:6])}")
        if info["names"].get("none"):
            print(f"     W League {gid}: no Latin name at all (kept in Japanese): {', '.join(info['names']['none'][:6])}")
        if not info["startersAnnounced"]:
            print(f"     W League {gid}: the announced starters are not the box's - lineups follow the box")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = config.get("_tipoff_at") or info["date"]
        return b

    # ------------------------------------------------------------------ names, read once
    @staticmethod
    def _names_path(config: dict) -> str:
        # ONE file for both divisions: a player promoted with her club is the same player
        root = config.get("repo_root") or os.getcwd()
        return os.path.join(root, "data", "feed", "WJBL", "players.json")

    def _names(self, ids: Iterable[str], config: dict) -> Dict[str, dict]:
        """{player_id: {"name", "en", "kana", "foreign", "at"}} for every id, from the cache, reading
        the player's page for an id it does not have (or one with no romaji, every
        NAME_RECHECK_DAYS). A page that cannot be read leaves that player out, and she is named in
        Japanese until it can."""
        path = self._names_path(config)
        cache = WjblAdapter._people.get(path)
        if cache is None:
            cache = {}
            try:
                with open(path, encoding="utf-8") as f:
                    cache = json.load(f)
            except (OSError, ValueError):
                cache = {}
            WjblAdapter._people[path] = cache
        today = datetime.now(timezone.utc).date()
        changed = False
        for pid in sorted(ids, key=lambda x: int(x) if x.isdigit() else 0):
            have = cache.get(pid)
            stale = False
            if have is not None and not have.get("en"):
                try:
                    stale = (today - datetime.fromisoformat(have.get("at") or "2000-01-01").date()).days >= NAME_RECHECK_DAYS
                except ValueError:
                    stale = True
            if have is not None and not stale:
                continue
            got = self._get_json("/player", player_id=pid)
            if not isinstance(got, dict) or not got.get("player_id"):
                continue
            cache[pid] = {"name": (got.get("player_name") or "").strip(), "en": (got.get("player_name_en") or "").strip(),
                          "kana": (got.get("player_furigana") or "").strip(),
                          "foreign": _num(got.get("player_foreign_national_flg")), "at": today.isoformat()}
            changed = True
        if changed:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
            except OSError:
                pass                       # a cache that cannot be written is a slow pass, not a failure
        return {pid: cache[pid] for pid in ids if pid in cache}

    # ------------------------------------------------------------------ plumbing
    def _pause(self):
        gap = time.time() - getattr(WjblAdapter, "_last_req", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        WjblAdapter._last_req = time.time()

    def _get_json(self, path: str, fresh: bool = False, **params):
        """One API reply, shared for TTL_S between the sources (a schedule month is read once per
        pass, not once per division); `fresh` for a game, which changes while it is played."""
        key = path + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        at, cached = self._replies.get(key, (0.0, None))
        if cached is not None and not fresh and time.time() - at < self.TTL_S:
            return cached
        got = self._request(path, params)
        if got is not None:
            self._replies[key] = (time.time(), got)
        return got

    def _request(self, path: str, params: dict):
        for attempt in range(3):
            self._pause()
            try:
                r = requests.get(API + path, params=params, headers=HEADERS, timeout=45)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code == 404:
                return None
            if r is not None and r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    return None
            time.sleep(1.5 * (attempt + 1))
        return None

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """Never the scraper's builder for a translated feed: see bleague.py. (bundle_from_raw's
        _pbp_newest_first already keeps a forward stream away from it; this says so twice.)"""
        return []
