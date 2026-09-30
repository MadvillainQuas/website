# -*- coding: utf-8 -*-
"""Brazil's Liga Nacional de Basquete: NBB and Liga Ouro, from lnb.com.br.

WHERE THE DATA IS. A WordPress site, server-rendered, no robots.txt (/robots.txt redirects to the 404 page), behind
Cloudflare's Rocket Loader but not its bot check - a plain GET answers.

    /<nbb|liga-ouro|ldb>/tabela-de-jogos/[?season[]=<id>]
        a season's whole schedule, one <tr> per game: data-real-id (the league's game id), date and time (Brasilia),
        both clubs (name, crest, three-letter code), the round, the stage ("1º TURNO" ... "OITAVAS", "FINAL") and one
        link: /partidas/<slug>/ until the game's report is published, then /noticias/<slug>/. The season shown is the
        current one (the filter's checked radio); `season_id` in adapter_config picks another, and so does a season
        asked for by name (a console backfill: "2024-25" is the filter's "NBB 2024/2025", "2025" Liga Ouro's "Liga
        Ouro 2025") - one that is not on the filter (Liga Ouro held none from 2020 to 2024) is said so and read as
        nothing, never as the season on show.
    /noticias/<slug>/   the game's report: the score and quarters, the hall, and two tabs - #stats (a box score per
        club) and #movethemove (the play-by-play, NEWEST FIRST, clock counting down). About one report in twelve is an
        article with no stats at all and no link to any (Liga Ouro 2026 game 26825; 9 of 78 NBB 2025-26 games sampled,
        mostly play-offs): the fetch notes it and reads it again at most every 12 hours.

THE PLAY-BY-PLAY, in Portuguese, as it has to be read: each event has its quarter (idq; 5+ is overtime), its club (idt:
1 home, 2 away), the clock, the running score ("78 x 87", home first), a title and a sentence naming the player by the
display name the box score uses ("G. Basílio", "Jeanzinho"). Substitutions log BOTH sides ("Entra Magna", "Sai Elias"),
and each club's five "Entra" lines at 10:00 before the first play are its starters. Team rebounds name the club
("Vasco da Gama pega rebote ofensivo."), a timeout its coach ("Técnico da equipe ... pede tempo."), the shot clock its
violation ("Estouro dos 24s."), a coach's technical its coach ("Técnico do Minas comete falta técnica."); a lost ball
or a 5 s / 8 s violation can name nobody. A sentence the tables do not know is kept on raw["lnbbr"]["unknown"], never
guessed. The changes made between quarters are never logged (restate_fives), a change entered the wrong way round is
put right by entering its reverse at the same clock (opening_five), and a change can be written in two halves with plays
between them (close_gaps).

CHECKED against every Liga Ouro 2026 report and 78 NBB 2025-26 ones (113 with stats): every sentence translated, the
play-by-play's points equal to the box score's for both clubs in every game, five starters, no lineup warnings.

THE SHOT CHART (the report's #graphic tab) places every shot on the court, in FIBA's own chart frame, and is what tells a
shot at the rim from a mid-range one (the box score's zones, the stints and the game stream all measure it from the ring).
Each dot is its play-by-play shot's by quarter, clock, club, two or three, and made or missed (shot_chart, place_shots):
all 15,043 shots of the 113 games are placed, none left over - 4,222 twos at the rim (61.7%), 4,407 mid-range (37.9%).
A shot the scorers put on the ring itself, right after its club's offensive rebound or missed shot, is a putback
(is_putback: 635, and 3 dunks there stay dunks).

PLAYERS have no id in the box score or the play-by-play: a player is his display name and shirt within his club (pno
"pedro-nunes-11"). The play-by-play names him as the box score does, mostly: where it does not ("Gama" for the box
score's "Juan"), the name is given the box line its own plays add up to (reconcile: 22 such names in the sample, from
"Vitinho" = Vitor to Paulistano's two Gabriels, "Joaquim" = 14 and "Macedo" = 11). The shot chart does carry the site's
player id (idj, the same in every game), beside the play-by-play's names; here it only tells two shots of one second
apart. Clubs are keyed on the league's three-letter code, which follows a club through a rename ("Paulistano" /
"Paulistano/CORPe" are both CAP).

GITHUB'S RUNNERS ARE REFUSED (403, 2026-09-27: the first run read no fixture at all), as lnb.fr refuses them for the
French leagues. The two sources are read from the processing PC instead: scripts/ingest/home_sources.bat (a normal
pass for NBB and Liga Ouro, straight to Supabase), and the PC's live lane follows a game once it is on the schedule.

LDB IS NOT HERE: its games (2025 and 2026, the final included) have a result and nothing else - the game page's tabs
are empty and no report is ever published - so there is no box score to ingest.
"""
from __future__ import annotations

import html as _html
import itertools
import json
import os
import re
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter, UA, ZoneInfo

SITE = "https://lnb.com.br"
GAP_S = 3.0
SCHEDULE_TTL_S = 1800              # a fetch that needs a report link re-reads the schedule at most this often
NOBOX_RECHECK_S = 12 * 3600        # a report published without its stats (an article only) is read again at most this often
REGULAR_STAGE = re.compile(r"turno|classifica|grupo|regular", re.I)

_ROW = re.compile(r'<tr\b[^>]*>\s*<td class="position_value[^>]*data-real-id="(\d+)"(.*?)</tr>', re.S)
_SEASON = re.compile(r"filterBySeason\('(\d+)'\);\"[^>]*>\s*<input[^>]*value=\"\d+\"\s*(checked)?\s*>\s*<label[^>]*>([^<]+)</label>")
_TAG = re.compile(r"<[^>]+>")


def _text(h: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(_TAG.sub(" ", h or ""))).strip()


def slug(s: str) -> str:
    t = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def _utc_brasilia(d: str, hm: str) -> Optional[str]:
    m, t = re.match(r"(\d{2})/(\d{2})/(\d{4})", d or ""), re.match(r"(\d{1,2}):(\d{2})", hm or "")
    if not m:
        return None
    hh, mm = (int(t.group(1)), int(t.group(2))) if t else (12, 0)
    local = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), hh, mm)
    if ZoneInfo is not None:
        local = local.replace(tzinfo=ZoneInfo("America/Sao_Paulo"))
    else:                                   # Brasilia has kept UTC-3 all year since 2019
        from datetime import timedelta
        local = local.replace(tzinfo=timezone(timedelta(hours=-3)))
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================================ the schedule
def schedule_rows(page: str) -> List[dict]:
    """Every game on a season's schedule page."""
    out = []
    for rid, r in _ROW.findall(page or ""):
        names = [_text(x) for x in re.findall(r'<span class="team-shortname">(.*?)</span>', r, re.S)]
        date = re.search(r'data-label="DATA">\s*<span class="">(\d{2}/\d{2}/\d{4})</span>\s*<span class="">([^<]*)</span>', r)
        home_logo = re.search(r'class="logo_home_team[^"]*">\s*<img[^>]*src="([^"]+)"', r)
        away_logo = re.search(r'class="logo_visitor_team[^"]*">\s*<img[^>]*src="([^"]+)"', r)
        small = re.search(r'matche_for_small">\s*<strong[^>]*>\s*([A-Z0-9]{2,6})\b.*?</a>\s*<strong[^>]*>.*?<img[^>]*>\s*([A-Z0-9]{2,6})\s*</strong>', r, re.S)
        link = re.search(r'<a\s+href="([^"]+)"\s+class="[^"]*match_score_relatorio', r)
        score = re.search(r'<span class="home">\s*(\d*)\s*</span>\s*X\s*<span class="away">\s*(\d*)\s*</span>', r)
        rnd = re.search(r'data-label="RODADA"><span class="number">\s*(\d+)', r)
        stage = re.search(r'class="stage_value hide_value" data-label="FASE">([^<]+)<', r)
        if len(names) < 2 or not link:
            continue
        out.append({"id": rid, "home": names[0], "away": names[1],
                    "tip": _utc_brasilia(date.group(1), date.group(2)) if date else None,
                    "home_code": small.group(1) if small else slug(names[0]), "away_code": small.group(2) if small else slug(names[1]),
                    "home_logo": home_logo.group(1) if home_logo else None, "away_logo": away_logo.group(1) if away_logo else None,
                    "url": link.group(1), "report": "/noticias/" in link.group(1),
                    "score": (int(score.group(1)), int(score.group(2))) if score and score.group(1) and score.group(2) else None,
                    "round": int(rnd.group(1)) if rnd else None, "stage": _text(stage.group(1)) if stage else ""})
    return out


def season_menu(page: str) -> List[tuple]:
    """[(season id, label, checked)] off the schedule's season filter."""
    return [(sid, _html.unescape(label).strip(), bool(chk)) for sid, chk, label in _SEASON.findall(page or "")]


def season_wanted(menu: List[tuple], token) -> Optional[str]:
    """The filter's id for a season the platform names "2024-25" (NBB: "NBB 2024/2025") or "2025" (Liga Ouro, a
    calendar year: "Liga Ouro 2025"); None when the site has no such season. A split season never matches a
    single-year label, nor a year a split one: the two leagues' seasons are not each other's."""
    m = re.fullmatch(r"(\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?", str(token or "").strip())
    if not m:
        return None
    y = int(m.group(1))
    if m.group(2) and int(m.group(2)) % 100 != (y + 1) % 100:
        return None
    for sid, label, _ in menu:
        years = [int(x) for x in re.findall(r"\b(\d{4})\b", label)]
        if (years == [y, y + 1]) if m.group(2) else (years == [y]):
            return sid
    return None


# ============================================================================ one game
def _pair(cell: str) -> tuple:
    m = re.search(r"(\d+)\s*/\s*(\d+)", cell or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _num(v) -> float:
    try:
        return float(str(v).strip() or 0)
    except ValueError:
        return 0.0


def box_side(pane: str) -> tuple:
    """([(name, shirt, stats)], team totals) of one club's box score table."""
    tb = re.search(r"<table\b.*?</table>", pane or "", re.S)
    if not tb:
        return [], {}
    players, totals = [], {}
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", tb.group(0), re.S):
        cells = [_text(c) for c in re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.S)]
        if not cells:
            continue
        if cells[0].lower() == "equipe":                     # the club's totals: one cell fewer (no shirt)
            cells = [""] + cells
        if len(cells) < 18:
            continue
        reb = re.match(r"(\d+)\s*\+\s*(\d+)\s+(\d+)", cells[5])
        p3, p2, ft = _pair(cells[7]), _pair(cells[8]), _pair(cells[9])
        st = {"min": _num(cells[3]), "pts": int(_pair(cells[4])[0] or _num(cells[4].split("/")[0])),
              "dreb": int(reb.group(1)) if reb else 0, "oreb": int(reb.group(2)) if reb else 0,
              "reb": int(reb.group(3)) if reb else 0, "ast": int(_num(cells[6])),
              "p3m": p3[0], "p3a": p3[1], "p2m": p2[0], "p2a": p2[1], "ftm": ft[0], "fta": ft[1],
              "stl": int(_num(cells[10])), "blk": int(_num(cells[11])), "pf": int(_num(cells[12])), "fo": int(_num(cells[13])),
              "tov": int(_num(cells[14])), "dunks": int(_num(cells[15])), "pm": int(_num(cells[16])), "eff": int(_num(cells[17]))}
        if cells[1].lower() == "equipe":
            totals = st
        else:
            players.append((cells[1], cells[0].lstrip("#"), st))
    return players, totals


def _fiba(st: dict) -> dict:
    return {"sPoints": st["pts"], "sTwoPointersMade": st["p2m"], "sTwoPointersAttempted": st["p2a"],
            "sThreePointersMade": st["p3m"], "sThreePointersAttempted": st["p3a"],
            "sFieldGoalsMade": st["p2m"] + st["p3m"], "sFieldGoalsAttempted": st["p2a"] + st["p3a"],
            "sFreeThrowsMade": st["ftm"], "sFreeThrowsAttempted": st["fta"],
            "sReboundsOffensive": st["oreb"], "sReboundsDefensive": st["dreb"], "sReboundsTotal": st["reb"],
            "sAssists": st["ast"], "sTurnovers": st["tov"], "sSteals": st["stl"], "sBlocks": st["blk"],
            "sFoulsPersonal": st["pf"], "sFoulsOn": st["fo"], "sPlusMinusPoints": st["pm"]}


def feed_events(page: str) -> List[dict]:
    """The play-by-play, OLDEST first: {q, tno, clock, score, title, text, i}."""
    out = []
    for i, b in enumerate(re.split(r'<div class="move_action ', page or "")[1:]):
        b = b[:6000]
        q, tm = re.search(r'idq="(\d+)"', b), re.search(r'idt="(\d+)"', b)
        clock = re.search(r'<strong class="time">\s*([0-9:]*)\s*</strong>', b)
        pts = re.search(r'<strong class="points">\s*(\d+)\s*x\s*(\d+)\s*</strong>', b)
        cont = re.search(r'class="move_action_content_text">\s*<strong[^>]*>(.*?)</strong>\s*<p[^>]*>(.*?)</p>', b, re.S)
        if not (q and cont):
            continue
        out.append({"q": int(q.group(1)), "tno": int(tm.group(1)) if tm else 0, "clock": clock.group(1) if clock else "",
                    "score": (int(pts.group(1)), int(pts.group(2))) if pts else None,
                    "title": _text(cont.group(1)), "text": _text(cont.group(2)), "i": i})
    out.reverse()                                           # the page is newest first
    return out


def _secs(clock: str) -> int:
    m = re.match(r"\s*(\d{1,2}):(\d{2})", clock or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


# (regex on the sentence, actionType, subType, success). Group 1, where there is one, is who did it: a player, or the
# club itself (a team rebound or turnover names the club; a violation, a lost ball can name nobody).
_ACTIONS = [
    (r"^entra (.+)$", "substitution", "in", 0),
    (r"^sai (.+)$", "substitution", "out", 0),
    (r"^(?:é de três! )?(.+?) acerta arremesso de três pontos", "3pt", "", 1),
    (r"^(.+?) erra tentativa para três pontos", "3pt", "", 0),
    (r"^(?:cravada! ?)?(.+?) acerta enterrada", "2pt", "dunk", 1),
    (r"^(.+?) erra (?:tentativa de )?enterrada", "2pt", "dunk", 0),
    (r"^(.+?) acerta arremesso de dois pontos", "2pt", "", 1),
    (r"^(.+?) erra tentativa para dois pontos", "2pt", "", 0),
    (r"^(.+?) acerta o lance livre", "freethrow", "", 1),
    (r"^(.+?) erra o lance livre", "freethrow", "", 0),
    (r"^(.+?) pega rebote defensivo", "rebound", "defensive", 0),
    (r"^(.+?) pega rebote ofensivo", "rebound", "offensive", 0),
    (r"^assistência d[oae] (.+)$", "assist", "", 0),
    (r"^(.+?) recupera a bola", "steal", "", 0),
    (r"^(.+?) dá um toco", "block", "", 0),
    (r"^(.+?) sofre falta", "foulon", "", 0),
    (r"^técnico d[aoe] (?:equipe )?(.+?) comete falta técnica", "foul", "coachtechnical", 0),
    (r"^técnico d[aoe] (?:equipe )?(.+?) comete falta (?:desqualificante|antidesportiva)", "foul", "coachdisqualifying", 0),
    (r"^(.+?) comete falta ofensiva", "foul", "offensive", 0),
    (r"^(.+?) comete falta antidesportiva", "foul", "unsportsmanlike", 0),
    (r"^(.+?) comete falta técnica", "foul", "technical", 0),
    (r"^(.+?) comete falta desqualificante", "foul", "disqualifying", 0),
    (r"^(.+?) comete falta", "foul", "personal", 0),
    (r"^(?:(.+?) )?perde posse de bola", "turnover", "ballhandling", 0),
    (r"^(?:(.+?) )?andou com a bola", "turnover", "travel", 0),
    (r"^(.+?) (?:pisou fora|saiu pela linha|pisou na linha)", "turnover", "outofbounds", 0),
    (r"^(.+?) (?:comete )?(?:violação de )?(?:condução|dois dribles)", "turnover", "doubledribble", 0),
    (r"^(.+?) (?:comete )?(?:violação de )?(?:3|três) segundos", "turnover", "3sec", 0),
    (r"^(?:(.+?) )?comete violação de saída de quadra", "turnover", "outofbounds", 0),
    (r"^(?:(.+?) )?comete violação de (?:3|três) ?s", "turnover", "3sec", 0),
    (r"^(?:(.+?) )?comete violação de (?:5|cinco) ?s", "turnover", "5sec", 0),
    (r"^(?:(.+?) )?comete violação de (?:8|oito) ?s", "turnover", "8sec", 0),
    (r"^(?:(.+?) )?comete violação de 24 ?s", "turnover", "shotclock", 0),
    (r"^(?:(.+?) )?comete violação", "turnover", "other", 0),
    (r"^estouro dos 24s", "turnover", "shotclock", 0),
    (r"^(?:violação d[eo]s? )?(?:5|cinco) segundos", "turnover", "5sec", 0),
    (r"^(?:violação d[eo]s? )?(?:8|oito) segundos", "turnover", "8sec", 0),
    (r"^técnico da equipe (.+?) pede tempo", "timeout", "full", 0),
]
#: acts whose name is the club's even when it is written (its coach's timeout, its coach's technical)
_CLUB_ACTS = {("timeout", "full"), ("foul", "coachtechnical"), ("foul", "coachdisqualifying")}
#: a player's box line, as the play-by-play can add it up
_LINE = ("p2m", "p2a", "p3m", "p3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "pf", "fo", "tov")


def translate(text: str) -> Optional[tuple]:
    """One sentence -> (actionType, subType, success, who), or None for a sentence the table does not know."""
    for pat, at, sub, ok in _ACTIONS:
        m = re.match(pat, (text or "").strip(), re.I)
        if m:
            actor = (m.group(1) or "") if m.groups() else ""
            return at, sub, ok, actor.strip().rstrip(".").strip()
    return None


def _count(line: dict, at: str, sub: str, ok: int) -> None:
    if at in ("2pt", "3pt", "freethrow"):
        k = {"2pt": "p2", "3pt": "p3", "freethrow": "ft"}[at]
        line[k + "a"] += 1
        line[k + "m"] += ok
    elif at == "rebound":
        line["oreb" if sub == "offensive" else "dreb"] += 1
    elif at == "foul":
        line["pf"] += 1
    elif at in ("assist", "steal", "block", "foulon", "turnover"):
        line[{"assist": "ast", "steal": "stl", "block": "blk", "foulon": "fo", "turnover": "tov"}[at]] += 1


_CLUB_WORDS = {"basquete", "basket", "basketball", "clube", "club", "esporte", "time", "equipe", "nbb", "ldb"}


def club_words(*names: str) -> set:
    """The words a club's names are made of, to tell the club itself from a player where the play-by-play names it
    ('Brusque Basquete LO', 'Basket Joaçaba LO', 'IVV/CETAF')."""
    return {w for n in names for w in slug(n).split("-") if len(w) >= 3} | _CLUB_WORDS


def is_club(actor: str, words: set) -> bool:
    ws = [w for w in slug(actor).split("-") if len(w) >= 3]
    return bool(ws) and all(w in words for w in ws)


def on_court(subs: List[tuple]) -> int:
    """Seconds a name was on court by its own substitutions [(quarter, clock seconds, "in" | "out")], quarter by quarter:
    out first = on from the quarter's start, in last = on to its end (the changes between quarters are not logged, so a
    quarter it has no substitution in counts nothing)."""
    total, by_q = 0, {}
    for q, secs, sub in subs:
        by_q.setdefault(q, []).append((secs, sub))
    for q, lst in by_q.items():
        since = (600 if q <= 4 else 300) if lst[0][1] == "out" else None
        for secs, sub in lst:
            if sub == "in":
                since = secs if since is None else since
            elif since is not None:
                total += max(0, since - secs)
                since = None
        if since is not None:
            total += since
    return total


def reconcile(acts: List[tuple], lines: Dict[int, dict], who, clubs: Optional[Dict[int, set]] = None) -> dict:
    """THE PLAY-BY-PLAY DOES NOT ALWAYS NAME A PLAYER AS THE BOX SCORE DOES. It writes the name the game's scorers used
    ('Gama', 'JV Martins', 'G. Cruz', 'Sbardelotti'), the box score the site's own ('Juan', 'Martins', 'Guilherme',
    'Thiago'): Liga Ouro 2026, IVV/CETAF, most games. So a name the box score does not have is given the box line its own
    plays add up to: its shots made and missed, free throws, rebounds, assists, steals, blocks, fouls both ways and
    turnovers, against every box line of its club that no name claimed and that has minutes. Where more than one line
    fits exactly (quiet players: all zeros), the one whose name shares a word with it, else the one whose minutes are its
    own time on court by its substitutions (within 15 s, the next at least 20 s further). A pair is made only when the
    name has one fit left and no other name has only that one; each pair made takes that line from the others, and so on.
    A name seen only in rebounds and turnovers, or made of its club's words, is the club itself, never a player.
    acts: [(club, quarter, clock seconds, translate())]; lines: {club: {pno: box line}}; clubs: {club: club_words()}.
    Returns {(club, name.casefold()): pno}."""
    out: dict = {}
    for t in (1, 2):
        words = (clubs or {}).get(t) or set()
        named: Dict[str, dict] = {}
        subs: Dict[str, list] = {}
        playerlike, claimed = set(), set()
        for tt, q, secs, (at, sub, ok, actor) in acts:
            if tt != t or not actor or (at, sub) in _CLUB_ACTS:
                continue
            p = who(t, actor)
            if p:
                claimed.add(p)
                continue
            key = actor.casefold()
            _count(named.setdefault(key, dict.fromkeys(_LINE, 0)), at, sub, ok)
            if at == "substitution":
                subs.setdefault(key, []).append((q, secs, sub))
            if at not in ("rebound", "turnover") and not is_club(actor, words):
                playerlike.add(key)
        free = {p: st for p, st in (lines.get(t) or {}).items() if p not in claimed and st.get("min", 0) > 0}
        cands = {a: [p for p, st in free.items() if all(named[a][k] == st.get(k, 0) for k in _LINE)] for a in playerlike}
        while True:
            for a, ps in cands.items():
                if len(ps) > 1:
                    share = [p for p in ps if {w for w in slug(a).split("-") if len(w) >= 3} & set(p.split("-"))]
                    if len(share) == 1:
                        cands[a] = share
                    elif a in subs:
                        est = on_court(subs[a])
                        d = sorted((abs(round(free[p]["min"] * 60) - est), p) for p in ps)
                        if d[0][0] <= 15 and d[1][0] >= d[0][0] + 20:
                            cands[a] = [d[0][1]]
            sole: Dict[str, list] = {}
            for a, ps in cands.items():
                if len(ps) == 1:
                    sole.setdefault(ps[0], []).append(a)
            new = {p: names[0] for p, names in sole.items() if len(names) == 1}
            if not new:
                break
            for p, a in new.items():
                out[(t, a)] = p
                del cands[a]
            for a in cands:
                cands[a] = [p for p in cands[a] if p not in new]
    return out


def raw_from_report(page: str, fixture: Optional[dict] = None, now: Optional[datetime] = None) -> Optional[dict]:
    """One lnb.com.br game report -> FIBA data.json shape (forward, actionNumber 1..n). Pure. None without a box score."""
    fixture = fixture or {}
    hs, as_ = re.search(r'id="home_score">\s*(\d+)', page or ""), re.search(r'id="away_score">\s*(\d+)', page or "")
    panes = {}
    for side, pid in ((1, "team_home_stats"), (2, "team_away_stats")):
        i = (page or "").find(f'id="{pid}"')
        panes[side] = page[i:i + 150000] if i >= 0 else ""
    boxes = {t: box_side(panes[t]) for t in (1, 2)}
    if not boxes[1][0] or not boxes[2][0]:
        return None
    head = re.search(r'class="score_header(.*?)class="score_for_quarter"', page, re.S)
    head = head.group(1) if head else ""
    names = [_text(x) for x in re.findall(r'<span class="show-for-large"[^>]*>(.*?)</span>', head, re.S)]
    abbrs = [_text(x) for x in re.findall(r'<span class="hide-for-large">(.*?)</span>', head, re.S)]
    logos = re.findall(r'<img src="([^"]+)"', head)
    qh = [int(x) for x in re.findall(r'numbers_home"[^>]*>\s*<strong>(\d+)</strong>', page)]
    qa = [int(x) for x in re.findall(r'numbers_away"[^>]*>\s*<strong>(\d+)</strong>', page)]
    venue = re.search(r'<p class="score_header_place">(.*?)</p>', page, re.S)

    # ---- players: a display name and a shirt within a club. The pno (the feed key's slot) is both, "gabriel-14": a club
    # can have two players of one display name (Paulistano 2025-26: Gabriel 14 and Gabriel 11), and a key that followed
    # the box score's order would hand one's games to the other. A name two box lines share names neither of them: the
    # play-by-play's lines for them are told apart by reconcile().
    pl: Dict[int, dict] = {1: {}, 2: {}}
    by_name: Dict[int, dict] = {1: {}, 2: {}}
    for t in (1, 2):
        twice = {k for k, c in Counter(slug(n) for n, _s, _st in boxes[t][0]).items() if c > 1}
        for name, shirt, st in boxes[t][0]:
            pno = "-".join(x for x in (slug(name), shirt) if x) or "x"
            while pno in pl[t]:
                pno += "-x"
            pl[t][pno] = (name, shirt, st)
            if slug(name) not in twice:
                by_name[t][name.lower()] = pno
                by_name[t][slug(name)] = pno

    def who(t: int, name: str) -> str:
        n = (name or "").strip().rstrip(".")
        return by_name.get(t, {}).get(n.lower()) or by_name.get(t, {}).get(slug(n)) or ""

    # ---- the play-by-play: every sentence read first, then who each name is (reconcile)
    feed = feed_events(page)
    feed.sort(key=lambda e: (e["q"], (600 if e["q"] <= 4 else 300) - _secs(e["clock"])))   # stable: same clock keeps page order
    unknown: List[str] = []
    read: List[tuple] = []                                  # (event, "start" | "end" | "final" | None, translate())
    for e in feed:
        title = e["title"].upper()
        marker = ("start" if title.startswith("INÍCIO") else "end" if title.startswith("FIM DE QUARTO")
                  else "final" if title.startswith("FIM DE PARTIDA") else None)
        hit = None if marker else translate(e["text"])
        if not marker and hit is None:
            unknown.append(f"{e['title']}|{e['text']}")
            continue
        read.append((e, marker, hit))
    acts = [(e["tno"], e["q"], _secs(e["clock"]), hit) for e, _m, hit in read if hit]
    clubs = {t: club_words(fixture.get("home" if t == 1 else "away") or "", names[t - 1] if len(names) >= t else "",
                           abbrs[t - 1] if len(abbrs) >= t else "") for t in (1, 2)}
    alias = reconcile(acts, {t: {pno: st for pno, (_n, _s, st) in pl[t].items()} for t in (1, 2)}, who, clubs)
    players_named = {(t, h[3].casefold()) for t, _q, _c, h in acts
                     if h[3] and h[0] not in ("rebound", "turnover") and (h[0], h[1]) not in _CLUB_ACTS and not is_club(h[3], clubs[t])}

    def pno_of(t: int, actor: str) -> str:
        return who(t, actor) or alias.get((t, actor.casefold()), "")

    starters: Dict[int, List[str]] = {1: [], 2: []}
    events: List[dict] = []
    score = ["0", "0"]
    opened_q1 = False
    last_q, closed, finished = 0, set(), False
    for e, marker, hit in read:
        q = e["q"]
        per, ptype = (q, "REGULAR") if q <= 4 else (q - 4, "OVERTIME")
        last_q = max(last_q, q)
        base = {"period": per, "periodType": ptype, "gt": e["clock"] or ("10:00" if q <= 4 else "05:00"),
                "tno": e["tno"], "pno": "", "qualifier": [], "success": 0}
        if e["score"]:
            score = [str(e["score"][0]), str(e["score"][1])]
        if marker == "start":
            events.append(dict(base, actionType="period", subType="start", tno=0))
            continue
        if marker == "end":
            events.append(dict(base, actionType="period", subType="end", tno=0, gt="00:00"))
            closed.add(q)
            continue
        if marker == "final":
            finished = True
            continue
        at, sub, ok, actor = hit
        t = e["tno"]
        if at == "substitution":
            pno = pno_of(t, actor)
            if not pno:
                unknown.append(f"sub:{e['text']}")
                continue
            # THE OPENING FIVES: "Entra" at the start of the first quarter, before any play, are the starters
            if q == 1 and sub == "in" and not opened_q1 and _secs(e["clock"]) == 600:
                starters[t].append(pno)
                continue
            events.append(dict(base, actionType="substitution", subType=sub, pno=pno))
            continue
        opened_q1 = opened_q1 or q > 1 or at not in ("timeout",)
        pno = "" if (at, sub) in _CLUB_ACTS else (pno_of(t, actor) if actor else "")
        if actor and not pno and at == "foul" and is_club(actor, clubs[t]):
            sub = "benchtechnical" if sub == "technical" else sub      # the club's bench, named as the club
        elif actor and not pno and (at, sub) not in _CLUB_ACTS:
            if at not in ("rebound", "turnover") or (t, actor.casefold()) in players_named:
                unknown.append(f"player:{e['text']}")       # a player the box score does not have: left out, not guessed
                continue
            # else the club itself: a team rebound, a team turnover
        ev = dict(base, actionType=at, subType=sub, success=ok, pno=pno)
        ev["s1"], ev["s2"] = score
        ev["scoring"] = 1 if (at in ("2pt", "3pt", "freethrow") and ok) else 0
        events.append(ev)
    minutes = {t: {pno: st["min"] for pno, (_n, _s, st) in pl[t].items()} for t in (1, 2)}
    events, starters = restate_fives(events, starters, minutes)
    events = close_gaps(events, starters)
    running = ["0", "0"]
    for ev in events:
        if "s1" in ev:
            running = [ev["s1"], ev["s2"]]
        else:
            ev["s1"], ev["s2"] = running
        ev.setdefault("scoring", 0)
    trips: Dict[tuple, List[dict]] = {}
    for ev in events:
        if ev["actionType"] == "freethrow":
            trips.setdefault((ev["period"], ev["periodType"], ev["gt"], ev["tno"], ev["pno"]), []).append(ev)
    for trip in trips.values():
        for k, ev in enumerate(trip, start=1):
            ev["subType"] = f"{k}of{len(trip)}"
    home_score = int(hs.group(1)) if hs else sum(qh)
    away_score = int(as_.group(1)) if as_ else sum(qa)
    finished = finished or (last_q >= 4 and last_q in closed and home_score != away_score)
    if finished:
        events.append({"actionType": "game", "subType": "end", "period": events[-1]["period"] if events else 4,
                       "periodType": events[-1]["periodType"] if events else "REGULAR", "gt": "00:00", "tno": 0, "pno": "",
                       "qualifier": [], "success": 0, "s1": str(home_score), "s2": str(away_score), "scoring": 0})
    for n, ev in enumerate(events, start=1):
        ev["actionNumber"] = n
    # a drawn foul follows the foul it mirrors: the nearest unpaired foul by the other club at the same clock
    for d in (ev for ev in events if ev["actionType"] == "foulon"):
        for f in reversed(events[:d["actionNumber"] - 1]):
            if (f["actionType"] == "foul" and f["tno"] == 3 - d["tno"] and f["period"] == d["period"]
                    and f["periodType"] == d["periodType"] and abs(_secs(f["gt"]) - _secs(d["gt"])) <= 3 and not f.get("_paired")):
                f["_paired"] = True
                d["previousAction"] = f["actionNumber"]
                break
    for ev in events:
        ev.pop("_paired", None)

    # ---- the shot chart: each shot's place on the court, which is what tells a shot at the rim from a mid-range one
    dots, chart_names = shot_chart(page)
    idj_pno = {idj: pno_of(t, n) for t in (1, 2) for idj, n in chart_names[t].items()}
    placed = place_shots(events, dots, lambda d: idj_pno.get(d["idj"], ""))
    shots: Dict[int, List[dict]] = {1: [], 2: []}
    putbacks = 0
    for i, ev in enumerate(events):
        d = placed.get(ev["actionNumber"])
        if d is None:
            continue
        if ev["actionType"] == "2pt" and not ev["subType"] and (d["x"], d["y"]) in RIM_SPOT and is_putback(events, i):
            ev["subType"] = "putback"
            putbacks += 1
        shots[ev["tno"]].append({"r": int(ev["success"]), "x": d["x"], "y": d["y"], "actionType": ev["actionType"],
                                 "subType": ev["subType"], "actionNumber": ev["actionNumber"], "pno": ev["pno"],
                                 "per": ev["period"], "perType": ev["periodType"]})
    n_shots = sum(1 for ev in events if ev["actionType"] in ("2pt", "3pt"))

    # ---- the clubs
    tm = {}
    for t in (1, 2):
        players = {}
        bench = 0
        five = set(starters[t]) if len(starters[t]) == 5 else set()
        for pno, (name, shirt, st) in pl[t].items():
            secs = int(round(st["min"] * 60))
            p = S.player(name=name, shirt=shirt, starter=1 if pno in five else 0, active=1 if secs > 0 else 0,
                         minutes=f"{secs // 60}:{secs % 60:02d}", stats=_fiba(st))
            p["firstName"], p["familyName"] = _split(name)
            p["eff_1"] = st["eff"]
            if not p["starter"]:
                bench += p["sPoints"]
            players[pno] = p
        name = (fixture.get("home" if t == 1 else "away") or (names[t - 1] if len(names) >= t else ""))
        code = fixture.get("home_code" if t == 1 else "away_code") or (abbrs[t - 1] if len(abbrs) >= t else slug(name))
        quarters = qh if t == 1 else qa
        tot = _fiba(boxes[t][1]) if boxes[t][1] else None
        tt = S.team(name, code, short_name=abbrs[t - 1] if len(abbrs) >= t else "", score=home_score if t == 1 else away_score,
                    quarters=quarters[:4], players=players, shots=shots[t], logo=logos[t - 1] if len(logos) >= t else None,
                    totals=tot)
        for k, v in enumerate(quarters[4:], start=5):
            tt[f"p{k}_score"] = v
        tt["tot_sBenchPoints"] = bench
        if tot:                                             # the club's own row beyond its players: team rebounds and turnovers
            sums = S.totals_of(players)
            tt["tot_sReboundsTeamOffensive"] = max(0, tot["sReboundsOffensive"] - sums["sReboundsOffensive"])
            tt["tot_sReboundsTeamDefensive"] = max(0, tot["sReboundsDefensive"] - sums["sReboundsDefensive"])
            tt["tot_sReboundsTeam"] = tt["tot_sReboundsTeamOffensive"] + tt["tot_sReboundsTeamDefensive"]
            tt["tot_sTurnoversTeam"] = max(0, tot["sTurnovers"] - sums["sTurnovers"])
        tm[str(t)] = tt
    lead, changes, leader = {1: 0, 2: 0}, 0, 0
    for ev in events:
        diff = int(ev["s1"]) - int(ev["s2"])
        lead[1], lead[2] = max(lead[1], diff), max(lead[2], -diff)
        now_ = (diff > 0) - (diff < 0)
        if now_ and leader and now_ != leader:
            changes += 1
        if now_:
            leader = now_
    for t in (1, 2):
        tm[str(t)]["tot_sBiggestLead"] = lead[t]
        tm[str(t)]["tot_sLeadChanges"] = changes
    last_play = next((ev for ev in reversed(events) if ev["actionType"] not in ("period", "game")), None)
    periods = max(4, last_q)
    return {"tm": tm, "pbp": events, "period": periods, "periodType": "REGULAR" if periods <= 4 else "OVERTIME",
            "inOT": 1 if periods > 4 else 0,
            "clock": "00:00" if finished else (last_play["gt"] if last_play else "10:00"),
            "lnbbr": {"venue": _text(venue.group(1)) if venue else None, "finished": finished,
                      "starters": {str(t): starters[t] for t in (1, 2)}, "unknown": sorted(set(unknown)),
                      "renamed": {f"{t}:{a}": p for (t, a), p in sorted(alias.items())},
                      "shots": {"placed": len(placed), "unplaced": n_shots - len(placed), "putbacks": putbacks},
                      "pbp_points": {str(t): sum({"3pt": 3, "2pt": 2}.get(ev["actionType"], 1) for ev in events
                                                 if ev.get("scoring") and ev["tno"] == t) for t in (1, 2)}}}


def opening_five(evs: List[dict], t: int, prev: set, minutes: dict) -> Optional[set]:
    """Who of club t was on court when this quarter began: of every five of its players, the one its own lines in the
    quarter contradict least - a play by someone not on court costs 3, a substitution that cannot be (off for a player
    not on, on for one already there) costs 1 - then the most of those whose first line in the quarter says so (a play,
    or going off before coming on), then the most of the previous quarter's closing five, then the most minutes.
    A play outweighs a substitution line because the scorers put a change entered wrong right by entering its reverse
    at the same clock ('Sai L. Muller, Entra Emerson, Sai Emerson, Entra L. Muller', Liga Ouro 2026 game 26873, third
    quarter): the plays around it are what tell who was there."""
    seq = [(ev["actionType"] == "substitution", ev.get("subType"), ev["pno"]) for ev in evs if ev["tno"] == t and ev.get("pno")]
    first: Dict[str, str] = {}
    for is_sub, sub, p in seq:
        first.setdefault(p, sub if is_sub else "act")
    said = {p for p, k in first.items() if k in ("act", "out")}
    pool = sorted({p for p, m in minutes.items() if m > 0} | set(first))
    if len(pool) < 5:
        return None
    best = None
    for combo in itertools.combinations(pool, 5):
        cur, cost = set(combo), 0
        for is_sub, sub, p in seq:
            if not is_sub:
                cost += 0 if p in cur else 3
            elif sub == "in":
                cost += 1 if p in cur else 0
                cur.add(p)
            else:
                cost += 0 if p in cur else 1
                cur.discard(p)
        key = (cost, -len(said.intersection(combo)), -len(prev.intersection(combo)), -sum(minutes.get(p, 0) for p in combo), combo)
        if best is None or key < best:
            best = key
    return set(best[-1])


def restate_fives(events: List[dict], starters: Dict[int, List[str]], minutes: Dict[int, dict]) -> tuple:
    """THE BREAKS ARE NOT LOGGED. The site writes each club's opening five of the GAME ("Entra" x5 at 10:00 of the
    first quarter) and every substitution made while the clock runs, but nothing for the changes made between quarters:
    a player who starts the second quarter is simply there. So each later quarter's opening five is worked out from the
    quarter's own lines (opening_five), and where it differs from the previous quarter's closing five the substitutions
    are written at the quarter's start, marked inferred. The substitution lines themselves are kept as logged.
    Also gives the game's starters when the opening lines were not exactly five. Returns (events, starters)."""
    periods: List[tuple] = []
    for ev in events:
        key = (ev["periodType"] != "REGULAR", ev["period"])
        if not periods or periods[-1][0] != key:
            periods.append((key, []))
        periods[-1][1].append(ev)
    on = {t: set(starters[t]) if len(starters[t]) == 5 else None for t in (1, 2)}
    starters = {t: list(starters[t]) for t in (1, 2)}
    out: List[dict] = []
    for pi, (_key, evs) in enumerate(periods):
        inserts: List[dict] = []
        for t in (1, 2):
            prev = on[t] if on[t] is not None else set()
            five = set(prev) if pi == 0 and on[t] is not None else opening_five(evs, t, prev, minutes.get(t, {}))
            if five and len(five) == 5:
                if on[t] is None:
                    starters[t] = sorted(five)        # the game's starters, worked out
                elif five != prev and pi > 0:
                    lead = next((e for e in evs if e["actionType"] == "period" and e["subType"] == "start"), evs[0])
                    base = {"period": lead["period"], "periodType": lead["periodType"], "gt": lead["gt"], "tno": t,
                            "qualifier": [], "success": 0, "inferred": 1}
                    inserts += [dict(base, actionType="substitution", subType="out", pno=p) for p in sorted(prev - five)]
                    inserts += [dict(base, actionType="substitution", subType="in", pno=p) for p in sorted(five - prev)]
                cur = set(five)
            else:
                cur = set(prev)
            for ev in evs:
                if ev["tno"] == t and ev["actionType"] == "substitution":
                    (cur.add if ev["subType"] == "in" else cur.discard)(ev["pno"])
            on[t] = cur
        if inserts:
            k = next((i for i, e in enumerate(evs) if e["actionType"] == "period" and e["subType"] == "start"), -1)
            evs = evs[:k + 1] + inserts + evs[k + 1:]
        out += evs
    return out, starters


def close_gaps(events: List[dict], starters: Dict[int, List[str]]) -> List[dict]:
    """A change written in two halves at one clock with plays between them ('Sai Baralle', a foul, a block, then 'Entra
    Negrete': NBB 2025-26 game 26897) leaves the club four on court for those plays. The second half is moved up to
    stand beside the first - only then, and only within the same clock (a change made before the free throws and one
    made after them stay where they are)."""
    out = list(events)
    on = {t: set(starters.get(t) or []) for t in (1, 2)}
    i = 0
    while i < len(out):
        ev = out[i]
        t = ev["tno"]
        if ev["actionType"] == "substitution" and t in on:
            (on[t].add if ev["subType"] == "in" else on[t].discard)(ev["pno"])
            want = "in" if len(on[t]) < 5 else "out" if len(on[t]) > 5 else None
            j, between = i + 1, False
            while want and j < len(out) and (out[j]["period"], out[j]["periodType"], out[j]["gt"]) == (ev["period"], ev["periodType"], ev["gt"]):
                if out[j]["actionType"] == "substitution" and out[j]["tno"] == t:
                    if out[j]["subType"] == want and between:
                        out.insert(i + 1, out.pop(j))
                    break
                between = between or out[j]["actionType"] != "substitution"
                j += 1
        i += 1
    return out


# ============================================================================ the shot chart
_DOT = re.compile(r'<li\s+idj="(\d*)"\s+idp="(\d+)"\s+ide="(\d)"\s+class="([^"]*)"\s+'
                  r'style="top:\s*([\d.]*)%;\s*left:\s*([\d.]*)%;"\s+time="([^"]*)"')
_CHART_PLAYER = re.compile(r'<li\s+idj="(\d+)"[^>]*>\s*<div class="number">#?\d*</div>\s*<div class="name">([^<]*)</div>')
#: where the scorers' quick button puts a shot: on the ring itself (the chart's own spot, to the hundredth)
RIM_SPOT = {(6.0, 50.0), (94.0, 50.0)}
PUTBACK_S = 5
#: plays that ride on a shot or stop the clock, passed over looking for what came before a putback
_BESIDE = {"substitution", "assist", "block", "timeout"}


def shot_chart(page: str) -> tuple:
    """The report's shot chart (the #graphic tab, "GRÁFICO DE ARREMESSO") -> ([dot], {club: {idj: name}}), the dots
    OLDEST first. A dot: {idj, q, tno, kind ("2pt" | "3pt" | "ll"), made, x, y, clock}; q is the quarter (5+ overtime),
    the clock counts down as the play-by-play's, x and y are the dot's left and top as percentages of the court drawing -
    which is FIBA's own chart frame (28 x 15 m, the rims at x 6 and 94, y 50): of 8,629 two-point attempts in 113 games
    none is placed beyond 6.75 m of its rim, and 4 of 6,414 threes are inside 6.6 m. A free throw ("ll") has no place.
    The players beside the court are named as the play-by-play names them ("Gama", "JV Martins"), each with the site's
    player id (idj), the same in every game."""
    page = page or ""
    g = page.find('class="graphic_gym"')
    if g < 0:
        return [], {1: {}, 2: {}}
    end = page.find("</ul>", g)
    end = end if end > 0 else len(page)
    dots = []
    for idj, idp, ide, cls, top, left, clock in _DOT.findall(page[g:end]):
        c = cls.split()
        dots.append({"idj": idj, "q": int(idp), "tno": int(ide), "kind": c[0] if c else "", "made": int("correct" in c),
                     "x": float(left) if left else None, "y": float(top) if top else None, "clock": clock})
    dots.reverse()                                          # the page is newest first
    li, ri = page.rfind("players_block_left", 0, g), page.find("players_block_right", end)
    ri_end = page.find("</ul>", ri) if ri >= 0 else -1
    blocks = {1: page[li:g] if li >= 0 else "", 2: page[ri:ri_end if ri_end > 0 else ri + 20000] if ri >= 0 else ""}
    return dots, {t: {idj: _html.unescape(n).strip() for idj, n in _CHART_PLAYER.findall(blocks[t])} for t in (1, 2)}


def place_shots(events: List[dict], dots: List[dict], dot_pno) -> Dict[int, dict]:
    """Each shot of the play-by-play and its dot -> {actionNumber: dot}. A dot is its shot's by quarter, clock, club, two
    or three, and made or missed: in the 113 games each of 15,043 shots has exactly one, and none is left over. Where two
    shots share all five (a miss and a tap in the same second) the dot of the shot's own player is taken first
    (dot_pno(dot) -> pno, or ''), then the rest in order."""
    pool: Dict[tuple, List[dict]] = {}
    for d in dots:
        if d["kind"] in ("2pt", "3pt") and d["x"] is not None and d["y"] is not None:
            pool.setdefault((d["q"], _secs(d["clock"]), d["tno"], d["kind"], d["made"]), []).append(d)
    shots: Dict[tuple, List[dict]] = {}
    for ev in events:
        if ev["actionType"] in ("2pt", "3pt"):
            q = ev["period"] + (4 if ev["periodType"] == "OVERTIME" else 0)
            shots.setdefault((q, _secs(ev["gt"]), ev["tno"], ev["actionType"], int(ev["success"])), []).append(ev)
    out: Dict[int, dict] = {}
    for key, evs in shots.items():
        free = list(pool.get(key) or [])
        for ev in evs:
            d = next((d for d in free if ev["pno"] and dot_pno(d) == ev["pno"]), None)
            if d is not None:
                out[ev["actionNumber"]] = d
                free.remove(d)
        for ev in evs:
            if ev["actionNumber"] not in out and free:
                out[ev["actionNumber"]] = free.pop(0)
    return out


def is_putback(events: List[dict], i: int) -> bool:
    """THE RING ITSELF IS A BUTTON, NOT A PLACE A THUMB LANDED. The scorers' tool puts a tap-in exactly on the rim
    (x 6 or 94, y 50 to the hundredth: 639 shots in 113 games, 5.7 a game, where no other spot is used three times in a
    game), and 622 of the 639 follow the shooter's own club's offensive rebound, 613 of them in the same second. Such a
    shot is a putback when the play before it - substitutions, assists, blocks and timeouts passed over - is its own
    club's offensive rebound or its own missed shot (a tip with no rebound written), in the same quarter and at most
    PUTBACK_S s earlier: 638 of the 639, 3 of them dunks that keep their label. It is labelled so because the place alone
    would not be believed: a spot used three times or more in a game is how a quick-tap default looks
    (translate/fiba_events.py), and a shot there keeps its place only with a label that says the rim."""
    ev = events[i]
    j = i - 1
    while j >= 0 and events[j]["actionType"] in _BESIDE:
        j -= 1
    if j < 0:
        return False
    pv = events[j]
    if (pv["tno"], pv["period"], pv["periodType"]) != (ev["tno"], ev["period"], ev["periodType"]):
        return False
    if not 0 <= _secs(pv["gt"]) - _secs(ev["gt"]) <= PUTBACK_S:
        return False
    return ((pv["actionType"], pv["subType"]) == ("rebound", "offensive")
            or (pv["actionType"] in ("2pt", "3pt") and not pv.get("success")))


def _split(name: str) -> tuple:
    try:
        import names as _names
        return _names.split_display(name)
    except Exception:
        parts = (name or "").rsplit(" ", 1)
        return (parts[0], parts[1]) if len(parts) == 2 else ("", name or "")


# ============================================================================ the adapter
class LnbBrAdapter(FibaLiveStatsAdapter):
    """NBB and Liga Ouro. FibaLiveStatsAdapter for bundle_from_raw and nothing else."""

    name = "lnbbr"
    min_request_gap_s = GAP_S
    _last_req = 0.0
    _schedule_at: dict = {}             # league path (or "path?season id", an older season) -> (read at, rows)
    _season_ids: dict = {}              # (league path, season asked for) -> the filter's id ("" = none)
    _refused = False                    # the site has answered 403 in this process

    def _get(self, url: str) -> Optional[str]:
        if LnbBrAdapter._refused:
            return None                     # refused once, refused again: a runner the site blocks is not asked twice
        for attempt in range(3):
            gap = time.time() - LnbBrAdapter._last_req
            if gap < GAP_S:
                time.sleep(GAP_S - gap)
            LnbBrAdapter._last_req = time.time()
            try:
                r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/html"}, timeout=60)
            except requests.RequestException:
                r = None
            if r is not None and r.status_code in (403, 404, 410):
                if r.status_code == 403 and not LnbBrAdapter._refused:
                    LnbBrAdapter._refused = True       # said once per run: every request after it is refused alike
                    print("     LNB: lnb.com.br answered 403 Forbidden" + (
                        " - it refuses GitHub's runners (as lnb.fr does); NBB and Liga Ouro are read from the processing"
                        " PC: scripts/ingest/home_sources.bat" if os.environ.get("GITHUB_ACTIONS") else ""))
                return None
            if r is not None and r.status_code == 200:
                r.encoding = "utf-8"
                return r.text
            time.sleep(2 * (attempt + 1))
        return None

    @staticmethod
    def _cache_path(config: dict) -> str:
        code = config.get("code") or "LNBBR"
        return os.path.join(config.get("repo_root") or os.getcwd(), "data", "feed", str(code), "games.json")

    def _cache(self, config: dict) -> dict:
        try:
            with open(self._cache_path(config), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save(self, config: dict, cache: dict) -> None:
        p = self._cache_path(config)
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
        except OSError:
            pass

    def _season_id(self, path: str, config: dict) -> tuple:
        """(the filter's id to read, why nothing can be read). A season asked for by name - a backfill; never the
        year run_ingest writes onto a calendar league by itself (season_auto) - is looked up on the filter once
        per process; everything else reads the season on show, as it always has."""
        if config.get("season_id"):
            return str(config["season_id"]), None
        token = str(config.get("season") or "").strip()
        if not token or config.get("season_auto"):
            return "", None
        memo = LnbBrAdapter._season_ids
        if (path, token) not in memo:
            page = self._get(f"{SITE}/{path}/tabela-de-jogos/")
            if page is None:
                return "", f"the schedule could not be read to find {token}"
            menu = season_menu(page)
            sid = season_wanted(menu, token)
            memo[("on_show", path)] = next((x for x, _, c in menu if c), "")
            if sid and sid == memo[("on_show", path)]:
                LnbBrAdapter._schedule_at[path] = (time.time(), schedule_rows(page))   # the page just read is it
            memo[(path, token)] = sid or ""
        sid = memo[(path, token)]
        return (sid, None) if sid else ("", f"the site has no {token} season (its filter holds no such label)")

    def _rows(self, config: dict, fresh: bool = True) -> List[dict]:
        path = (config.get("league_path") or "nbb").strip("/")
        sid, missing = self._season_id(path, config)
        if missing:
            print(f"     LNB {path}: {missing}")
            return []
        key = path if not sid or sid == LnbBrAdapter._season_ids.get(("on_show", path)) else f"{path}?{sid}"
        at, rows = LnbBrAdapter._schedule_at.get(key, (0.0, None))
        if rows is not None and (not fresh or time.time() - at < SCHEDULE_TTL_S):
            return rows
        url = f"{SITE}/{path}/tabela-de-jogos/"
        if sid:
            url += f"?season%5B%5D={sid}"
        page = self._get(url)
        if page is None:
            print(f"     LNB {path}: the schedule could not be read ({url})")
            # AN UNREADABLE SCHEDULE IS NOT ASKED FOR AGAIN AT ONCE: a live lane polls a due game every few seconds,
            # and each fetch without a report would otherwise be one more request to a site that just said no
            LnbBrAdapter._schedule_at[key] = (time.time(), rows or [])
            return rows or []
        rows = schedule_rows(page)
        LnbBrAdapter._schedule_at[key] = (time.time(), rows)
        return rows

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        stage = (config.get("stage") or "regular").lower()
        rows = [r for r in self._rows(config) if bool(REGULAR_STAGE.search(r["stage"] or "")) == (stage != "playoffs")]
        cache = self._cache(config)
        changed = False
        out = []
        for r in rows:
            keep = {k: r[k] for k in ("url", "home", "away", "home_code", "away_code", "tip", "stage")}
            old = cache.get(r["id"]) or {}
            if any(old.get(k) != v for k, v in keep.items()):
                cache[r["id"]] = dict(old, **keep)          # what the fetch noted (a report with no stats) stays
                changed = True
            extra = {"home_code": r["home_code"], "away_code": r["away_code"], "home_logo": r["home_logo"], "away_logo": r["away_logo"]}
            out.append(ScheduleGame(external_id=r["id"], home_name=r["home"], away_name=r["away"], tipoff_at=r["tip"],
                                    status="final" if r["report"] else "scheduled", extra=extra))
        if changed:
            self._save(config, cache)
        print(f"     LNB {config.get('league_path') or 'nbb'} {stage}: {len(out)} games ({sum(1 for g in out if g.status == 'final')} with a report)")
        return out

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        gid = str(external_id)
        cache = self._cache(config)
        ent = cache.get(gid)
        if ent is None or "/noticias/" not in (ent.get("url") or ""):
            row = next((r for r in self._rows(config) if r["id"] == gid), None)     # the report may be out since
            if row:
                ent = dict(ent or {}, **{k: row[k] for k in ("url", "home", "away", "home_code", "away_code", "tip", "stage")})
                cache[gid] = ent
                self._save(config, cache)
        if not ent or "/noticias/" not in (ent.get("url") or ""):
            return None                                     # no report yet: nothing to read
        if time.time() - float(ent.get("nobox") or 0) < NOBOX_RECHECK_S:
            return None                                     # read lately and it had no stats: not again yet
        page = self._get(ent["url"])
        raw = raw_from_report(page, ent) if page else None
        if raw is None:
            if page:                                        # an article with no box score (Liga Ouro 2026, game 26825)
                ent["nobox"] = int(time.time())
                cache[gid] = ent
                self._save(config, cache)
                print(f"     LNB {gid}: the report has no box score; read again in {NOBOX_RECHECK_S // 3600} h")
            return None
        if ent.pop("nobox", None) is not None:
            cache[gid] = ent
            self._save(config, cache)
        if raw["lnbbr"]["unknown"]:
            print(f"     LNB {gid}: not translated: {raw['lnbbr']['unknown'][:4]}")
        short = [f"{raw['tm'][t]['name']} {raw['lnbbr']['pbp_points'][t]} of {raw['tm'][t]['score']}" for t in ("1", "2")
                 if raw["lnbbr"]["pbp_points"][t] != raw["tm"][t]["score"]]
        if short:
            print(f"     LNB {gid}: the play-by-play's points are not the box score's: {'; '.join(short)}")
        sh = raw["lnbbr"]["shots"]
        if sh["unplaced"]:
            print(f"     LNB {gid}: {sh['unplaced']} of {sh['placed'] + sh['unplaced']} shots have no place on the shot chart")
        b = self.bundle_from_raw(raw, gid, config)
        b.tipoff_at = ent.get("tip") or config.get("_tipoff_at")
        if raw["lnbbr"]["venue"]:
            b.venue = raw["lnbbr"]["venue"]
        return b

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        return []                   # a forward stream: never the scraper's reversed builder (as grel.py)
