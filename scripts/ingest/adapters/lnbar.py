"""Argentina's leagues - laliganacional.com.ar, translated into the shape the platform already reads.

ONE SITE, FOUR LEAGUES, ONE FORMAT. The Asociación de Clubes runs La Liga Nacional (men, first tier), La Liga
Argentina (men, second), La Liga Femenina (women) and the Liga Desarrollo (its development league) on one
ASP.NET site, each under its own path - the site calls it the "delegación": laliga, laligaargentina, lfb and
ligaproximo. Every page is plain server-rendered HTML; there is no JSON API and no robots.txt (the address
redirects to the home page), and the pages say Index,Follow.

    /<key>/fixture?handler=ProximosPartidos&fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD
        the schedule between two dates: the table the fixture page fills by XHR from its two date inputs
        (#fecha-inicio / #fecha-fin). One request covers the whole season.
    /<key>/partido/<token>/<slug>
        one game: the scoreboard, the box score (Estadísticas) and the play-by-play (En Vivo) are all in
        the page's own HTML - the tabs only show and hide them. No XHR is needed for a finished game.

ONLY THE SEASON BEING PLAYED. The fixture answers nothing for any earlier date (2025-08-01..2026-07-31 came
back "No se encontraron partidos" on 2026-10-15, while 2020-01-01..2027-12-31 gave exactly 2026-27's games),
and no other page links to a past season's games: a past season cannot be read, so the adapter is not
season-aware (run_ingest.NO_PAST says so on the console). The season is the split year - "2026-27" - for all
four: La Liga's format page has the regular season to April and the finals in June-July, and La Liga
Femenina's names itself "Liga Femenina 2026/27" (it starts in October). A source pinned to any other season
discovers nothing, loudly, rather than filing this season's games under it.

THE GAME'S LINK IS NOT AN ID. The token in /partido/<token>/ is encrypted afresh on every page view - the same
game had three different tokens in three requests on one evening, each of them still good hours later - and
the page carries no numeric game id anywhere. So the external id is built from what IS stable:
    "<key>-<home IdEquipo>-<away IdEquipo>-<n>"        e.g. laliga-112600-112553-1
IdEquipo is a club's entry in one league and one season (Lanús is 112600 in La Liga 2026-27 and 112601 in the
Liga Desarrollo), so the pair names one fixture of one league's season, and n is that ordered pair's 1st, 2nd,
... game by date (a play-off series meets the same home side more than once). The date is left out on purpose:
a postponed game keeps its id. fetch() finds the token again from that day's fixture (one small request; the
whole season's when the tip-off is not known) and keeps it for the life of the process, so the live lane's
polls are one request each.

CLUBS are named as the league writes them, with the town in brackets ("GIMNASIA (CR)", "PEÑAROL (MDP)"),
latinised and un-shouted by names.team_name. The code is the club's own IdClub (Boca is 19 in every league),
which names the same club in its fixtures and in its games; the crest is /escudos/<IdClub>/<IdEquipo>.

PLAYERS. Each box-score row carries the player's whole record as JSON in its onclick -
EstadisticasComponente({"IdJugador":219791,"NombreCompleto":"FRANCHINO, MARTIN","CincoInicial":true,
"TiempoJuego":"33:41",...}, '63','112600', ...) - and the team's totals the same way with IdClub 0. IdJugador is
the pno, and the photo in every play-by-play line is /fotos/<IdJugador>, which is how an event finds its player.
"FRANCHINO, MARTIN" is passed through as the feed wrote it; names.py decides it is Martin Franchino.

THE PLAY-BY-PLAY, as the site lists it (newest first; read oldest first here):
  * "Cuarto 4 - 00:00:09" is the period and the time REMAINING (FIBA's own gt). Overtimes run on as Cuarto 5,
    6 with five minutes. "local" is the home side, and a scoring line's "74 - 92" is home - away;
  * the list's order is the site's chronology, and it is kept: the action numbers (accion-573) are the order
    things were TYPED, and a change entered late (out and in at 05:07 after a basket at 05:05) sorts in its
    right place only by the list. The events are numbered afresh in that order;
  * EACH PERIOD OPENS WITH TEN "CAMBIO-JUGADOR-ENTRA" LINES BEFORE ITS INICIO-PERIODO, five a side at
    10:00 (5:00 in overtime), and no period ever ends with players taken off: it is the announcement of who
    is on court, not ten substitutions. The first period's is the starting five, which the box score already
    flags (CincoInicial). A later period's becomes ONE balanced change at the period's first second: whoever
    was on court at the end of the last period and is not announced goes off, whoever is announced and was
    not on comes on. Read as substitutions, every player would have "come on" five times a game and the
    translator would have found five ins and no outs at every period's 10:00;
  * a foul is two lines, FALTA-COMETIDA (the foul) and FALTA-RECIBIDA (who drew it), in either order at one
    clock: the drawn half is put after its foul and points back at it (FIBA's foulon / previousAction);
  * TBANQUILLO-C is a technical on the bench (the coach's photo, no player); "2-TIROS-LIBRES" only announces
    free throws, CANASTA-1P / TIRO1-FALLADO are the throws themselves; TAPON-RECIBIDO is the block's other
    half and is not an event of its own; the possession arrow's first setting says who lost the opening tip.
There are no shot coordinates on the site: its shot map is zones and percentages.
"""
from __future__ import annotations

import html as _html
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import requests

from . import fibashape as S
from .base import GameBundle, ScheduleGame
from .fiba_livestats import FibaLiveStatsAdapter

import names as N                       # noqa: E402  (scripts/ingest is on sys.path via fiba_livestats)

SITE = "https://www.laliganacional.com.ar"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "es-AR,es;q=0.9"}
# Argentina keeps UTC-3 all year (no summer time since 2009)
ART = timezone(timedelta(hours=-3))
#: the league keys the site serves, and what each is
LEAGUES = {"laliga": "La Liga Nacional", "laligaargentina": "La Liga Argentina",
           "lfb": "La Liga Femenina", "ligaproximo": "Liga Desarrollo"}
#: a game is "live" on the schedule from its tip-off until this long after it (the fixture says no status)
LIVE_GUARD_S = 3.5 * 3600
#: how long a season's fixture, read for fetch(), is good for in this process
FIXTURE_TTL_S = 600
XID = re.compile(r"^([a-z]+)-(\d+)-(\d+)-(\d+)$")
MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
          "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}

# the token of each game this process has seen, by external id - kept across adapter objects (the live lane
# makes one per source) because a token stays good once issued
_TOKENS: dict = {}

# site action code -> (actionType, subType, success), the FIBA event shape scripts/ingest/stints.py and
# translate/fiba_events.py read. Checked against four games' box scores (2026-10-15): every made and missed
# shot, rebound, assist, steal, turnover and block adds up to the player's line; fouls do too, but for the
# lines the site leaves out (LnbArAdapter._pair_fouls).
ACTIONS = {
    "CANASTA-1P": ("freethrow", None, 1), "TIRO1-FALLADO": ("freethrow", None, 0),
    "CANASTA-2P": ("2pt", None, 1), "TIRO2-FALLADO": ("2pt", None, 0),
    "CANASTA-3P": ("3pt", "jumpshot", 1), "TIRO3-FALLADO": ("3pt", "jumpshot", 0),
    "REBOTE-OFENSIVO": ("rebound", "offensive", None), "REBOTE-DEFENSIVO": ("rebound", "defensive", None),
    "ASISTENCIA": ("assist", None, None),
    "RECUPERACION": ("steal", None, None),
    "PERDIDA": ("turnover", None, None),
    "TAPON-COMETIDO": ("block", None, None),
    "FALTA-COMETIDA": ("foul", "personal", None),
    "FALTA-RECIBIDA": ("foulon", None, None),
    "TIEMPO-MUERTO-SOLICITADO": ("timeout", None, None),
}
#: lines that are not events of their own (see the docstring)
SILENT = {"1-TIRO-LIBRE", "2-TIROS-LIBRES", "3-TIROS-LIBRES", "TAPON-RECIBIDO", "INICIO-PARTIDO"}


def foul_kind(code: str) -> Optional[str]:
    """A foul code other than FALTA-COMETIDA -> FIBA's subType: the bench's technical (TBANQUILLO-C, the coach's;
    -B, the bench's), and the player's technical, unsportsmanlike or disqualifying foul by the word in the code.
    None: not a foul."""
    c = code.upper()
    if c.startswith("TBANQUILLO"):
        return "coachtechnical" if c.endswith("-C") else "benchtechnical"
    if "FALTA" not in c and "TECNICA" not in c:
        return None
    if "DESCALIFICANTE" in c or "EXPULS" in c:
        return "disqualifying"
    if "ANTIDEPORTIVA" in c:
        return "unsportsmanlike"
    if "TECNICA" in c:
        return "technical"
    if "OFENSIVA" in c or "ATAQUE" in c:
        return "offensive"
    return "personal"


# ------------------------------------------------------------------------------ helpers ---
def text(s: str) -> str:
    """Markup -> its words, entities undone and spaces collapsed."""
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


#: the initials among the site's club names that have a vowel in them, so names.team_name cannot tell them from
#: a word: La Unión de Formosa writes itself "LA UNION FSA"
ACRONYMS = {"FSA"}


def club_name(raw: str) -> str:
    """The league's club name, latinised and un-shouted. The site shouts EVERY club, so a short one-word name is
    its habit too, not an acronym: "BOCA" is Boca (names.team_name keeps four capitals as an abbreviation)."""
    name = N.team_name(_html.unescape(raw or "").strip())
    if name.isalpha() and name.isupper() and re.search(r"[AEIOU]", name):
        name = name.capitalize()
    return " ".join(w.upper() if w.upper().strip(".") in ACRONYMS else w for w in name.split(" "))


def place(raw: str) -> Optional[str]:
    """An arena, as shouted as the clubs ("TEMPLO DEL ROCK"): written the way a name is written."""
    s = _html.unescape(raw or "").strip()
    return N.team_name(s) if s else None


def current_season(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    y = now.year if now.month >= 8 else now.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def normalize_season(tok) -> Optional[str]:
    """'2026-27', '2026/27', '2026-2027' -> '2026-27'; None when it is not a split year."""
    m = re.fullmatch(r"\s*(\d{4})\s*[-/]\s*(\d{2}|\d{4})\s*", str(tok or ""))
    if not m:
        return None
    y = int(m.group(1))
    return f"{y}-{str(y + 1)[2:]}"


def season_dates(season: str) -> tuple:
    """'2026-27' -> ('2026-08-01', '2027-07-31'): the whole season in one fixture request."""
    y = int(season[:4])
    return f"{y}-08-01", f"{y + 1}-07-31"


def league_key(schedule_url: str, config: dict) -> str:
    """The site's key for a source: adapter_config.league, else the first segment of its schedule URL."""
    k = str(config.get("league") or "").strip().lower()
    if not k:
        m = re.search(r"laliganacional\.com\.ar/([a-z]+)", str(schedule_url or ""))
        k = m.group(1) if m else ""
    if k not in LEAGUES:
        raise ValueError(f"lnbar: league {k!r} is not one of {', '.join(LEAGUES)}")
    return k


def tipoff(day: str, hhmm: str) -> tuple:
    """'15/10/2026', '21:00' (Argentina) -> ('2026-10-16T00:00:00Z', False). 00:00 is the site's "no time yet"
    (most of a fixture published ahead): noon UTC on that date with time_tbc, the PLK convention."""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(day or "").strip())
    if not m:
        return None, False
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    t = re.fullmatch(r"(\d{1,2}):(\d{2})", str(hhmm or "").strip())
    if not t or (t.group(1) in ("0", "00") and t.group(2) == "00"):
        return f"{y:04d}-{mo:02d}-{d:02d}T12:00:00Z", True
    local = datetime(y, mo, d, int(t.group(1)), int(t.group(2)), tzinfo=ART)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False


def crest(club, team) -> Optional[str]:
    return f"{SITE}/escudos/{club}/{team}" if club and team else None


# ----------------------------------------------------------------------------- schedule ---
ROW = re.compile(r'<tr class="fila-tabla-calendarios[^"]*">(.*?)</tr>', re.S)
TEAM_LINK = re.compile(r'/equipo/(\d+)/(\d+)/')


def fixture_rows(page: str) -> list:
    """Every game row of a fixture table (the XHR fragment, or the whole saved page around it), as dicts."""
    out = []
    for tr in ROW.findall(page or ""):
        names = re.findall(r'class="text-(start|end) celda-nombre">.*?href="[^"]*/equipo/(\d+)/(\d+)/[^"]*".*?'
                           r'class="nombre-equipo">([^<]*)<', tr, re.S)
        side = {k: (club, team, nm) for k, club, team, nm in names}
        if "start" not in side or "end" not in side:
            continue
        scores = re.findall(r'class="resultados">\s*<strong>\s*(\d*)\s*</strong>', tr)
        when = re.search(r'fecha-campo[^>]*>\s*<strong>\s*([\d/]+)\s*([\d:]*)\s*</strong>\s*(?:<small>([^<]*)</small>)?', tr)
        link = re.search(r'btn-estadisticas"\s+href="([^"]*/partido/([^/"]+)/[^"]*)"', tr)
        hc, ht, hn = side["start"]
        ac, at, an = side["end"]
        out.append({"home_club": hc, "home_team": ht, "home": _html.unescape(hn).strip(),
                    "away_club": ac, "away_team": at, "away": _html.unescape(an).strip(),
                    "home_score": int(scores[0]) if len(scores) > 0 and scores[0] else 0,
                    "away_score": int(scores[1]) if len(scores) > 1 and scores[1] else 0,
                    "date": when.group(1) if when else "", "time": when.group(2) if when else "",
                    "venue": _html.unescape(when.group(3) or "").strip() if when else "",
                    "token": link.group(2) if link else None})
    return out


def _sort_key(r: dict):
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", r.get("date") or "")
    d = (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else (9999, 0, 0)
    return d, r.get("time") or ""


def with_ids(rows: list, key: str) -> list:
    """The rows in date order, each with its external id (see the docstring: the ordered pair's n-th game)."""
    seen: dict = {}
    out = []
    for r in sorted(rows, key=_sort_key):
        pair = (r["home_team"], r["away_team"])
        seen[pair] = seen.get(pair, 0) + 1
        out.append(dict(r, xid=f"{key}-{pair[0]}-{pair[1]}-{seen[pair]}"))
    return out


def status_of(r: dict, tip: Optional[str], tbc: bool, now: datetime) -> str:
    """The fixture shows a score and nothing else: 0-0 until a game starts, the result once it has. So a score
    and a tip-off more than LIVE_GUARD_S ago is final; anything from tip-off until then is live."""
    try:
        t = datetime.fromisoformat(str(tip).replace("Z", "+00:00")) if tip and not tbc else None
    except ValueError:
        t = None
    scored = bool(r.get("home_score") or r.get("away_score"))
    if t is None:
        return "final" if scored and _sort_key(r)[0] < (now.year, now.month, now.day) else "scheduled"
    if t > now:
        return "scheduled"
    if (now - t).total_seconds() < LIVE_GUARD_S:
        return "live"
    return "final" if scored else "scheduled"


# ---------------------------------------------------------------------------- game page ---
LI = re.compile(r'<li class="accion\s*([^"]*)">(.*?)</li>', re.S)
CLOCK = re.compile(r'([A-Za-zÁÉÍÓÚáéíóúñ]+)\s+(\d+)\s*-\s*(\d{1,2}):(\d{2}):(\d{2})')


def parse_actions(page: str) -> list:
    """The play-by-play, OLDEST FIRST (the page lists it newest first), one dict a line."""
    out, seen = [], set()
    for cls, body in LI.findall(page or ""):
        toks = cls.split()
        num = next((int(t[7:]) for t in toks if re.fullmatch(r"accion-\d+", t)), None)
        if num is None or num in seen:
            continue
        seen.add(num)
        side = 1 if "local" in toks else 2 if "visitante" in toks else 0
        code = next((t for t in toks if t not in ("local", "visitante") and not re.fullmatch(r"accion-\d+", t)), "")
        title = re.search(r'<strong class="titulo">(.*?)</strong>', body, re.S)
        tspan = text(re.sub(r"^\s*[^<]*", "", title.group(1))) if title else ""
        info = [text(x) for x in re.findall(r'<span class="informacion">(.*?)</span>\s*(?:<br|</div>)', body, re.S)]
        clock = CLOCK.search(text(body))
        score = re.search(r'informacionAdicional">\s*(\d+)\s*-\s*(\d+)\s*<', body)
        photo = re.search(r'/fotos/(\d+)', body)
        dorsal = re.search(r"#\s*(-?\d+)", text(body))
        name = ""
        for s in info:
            s2 = re.sub(r"#\s*-?\d+\s*-?", "", s).strip()
            if s2 and not CLOCK.search(s) and not re.search(r"\d+:\d+:\d+\s*h", s) and "," in s2:
                name = s2
                break
        period = None
        if clock:
            period = int(clock.group(2))
        elif code in ("INICIO-PERIODO", "FINAL-PERIODO", "FINAL-PARTIDO"):
            m = re.search(r"(\d+)", tspan)
            period = int(m.group(1)) if m else None
        out.append({"n": num, "side": side, "code": code, "period": period,
                    "clock": (int(clock.group(3)) * 3600 + int(clock.group(4)) * 60 + int(clock.group(5))) if clock else None,
                    "score": (int(score.group(1)), int(score.group(2))) if score else None,
                    "pid": photo.group(1) if photo else "", "shirt": dorsal.group(1) if dorsal else "", "name": name})
    out.reverse()
    return out


def box_rows(page: str) -> list:
    """Every EstadisticasComponente record on the page: (record, the call's remaining arguments)."""
    dec = json.JSONDecoder()
    out = []
    for m in re.finditer(r'onclick="EstadisticasComponente\(([^"]*)"', page or ""):
        s = _html.unescape(m.group(1))
        try:
            rec, end = dec.raw_decode(s)
        except ValueError:
            continue
        args = re.findall(r"'([^']*)'", s[end:])
        out.append((rec, args))
    return out


def header(page: str) -> dict:
    """The scoreboard: each side's IdClub, IdEquipo, name and score; the date, time and venue; the status."""
    out = {}
    block = page or ""
    a = block.find("COMPONENTE MARCADOR COMPLETO")
    if a >= 0:
        b = block.find("FIN COMPONENTE MARCADOR COMPLETO", a)
        block = block[a:b if b > a else a + 20000]
    for vis, club, team, title in re.findall(r'<a class="text-decoration-none( a-visitante)?"\s+href="[^"]*/equipo/(\d+)/(\d+)/[^"]*"\s+title="([^"]*)"', block):
        side = "away" if vis else "home"
        out.setdefault(side, {"club": club, "team": team, "name": _html.unescape(title).strip()})
    for side, sid in (("home", "score-local"), ("away", "score-visitante")):
        m = re.search(r'id="' + sid + r'"[^>]*>\s*(\d+)\s*<', block)
        if m and side in out:
            out[side]["score"] = int(m.group(1))
    info = re.search(r'<div class="info-fecha-campo">(.*?)</div>', block, re.S)
    spans = [text(x) for x in re.findall(r"<span>(.*?)</span>", info.group(1), re.S)] if info else []
    out["date"], out["time"], out["venue"] = (spans + ["", "", ""])[:3]
    st = re.search(r'id="status-partido" class="banner-status-partido\s+([a-z-]+)', page or "")
    out["status"] = st.group(1) if st else ""
    idenc = re.search(r"var idEnc\s*=\s*'([^']+)'", page or "")
    out["token"] = idenc.group(1) if idenc else None
    return out


def page_tipoff(h: dict) -> Optional[str]:
    """'28 septiembre 2026', '22:05' -> UTC."""
    m = re.fullmatch(r"(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})", (h.get("date") or "").strip().lower())
    if not m or m.group(2) not in MONTHS:
        return None
    tip, tbc = tipoff(f"{m.group(1)}/{MONTHS[m.group(2)]}/{m.group(3)}", h.get("time") or "")
    return None if tbc else tip


def _minutes(t: str) -> str:
    m = re.fullmatch(r"\s*(\d+):(\d{2})\s*", str(t or ""))
    return f"{int(m.group(1))}:{m.group(2)}" if m else "0:00"


def _stats(rec: dict) -> dict:
    two, three, ft = rec.get("TirosDos") or {}, rec.get("TirosTres") or {}, rec.get("TirosLibres") or {}
    n = S.num
    return {
        "sPoints": n(rec.get("Puntos")),
        "sTwoPointersMade": n(two.get("Aciertos")), "sTwoPointersAttempted": n(two.get("Totales")),
        "sThreePointersMade": n(three.get("Aciertos")), "sThreePointersAttempted": n(three.get("Totales")),
        "sFieldGoalsMade": n(two.get("Aciertos")) + n(three.get("Aciertos")),
        "sFieldGoalsAttempted": n(two.get("Totales")) + n(three.get("Totales")),
        "sFreeThrowsMade": n(ft.get("Aciertos")), "sFreeThrowsAttempted": n(ft.get("Totales")),
        "sReboundsOffensive": n(rec.get("ReboteOfensivo")), "sReboundsDefensive": n(rec.get("ReboteDefensivo")),
        "sReboundsTotal": n(rec.get("RebotesTotales")),
        "sAssists": n(rec.get("Asistencias")), "sSteals": n(rec.get("Recuperaciones")), "sTurnovers": n(rec.get("Perdidas")),
        "sBlocks": n(rec.get("TaponCometido")), "sBlocksReceived": n(rec.get("TaponRecibido")),
        "sFoulsPersonal": n(rec.get("FaltaCometida")), "sFoulsOn": n(rec.get("FaltaRecibida")),
        "sPlusMinusPoints": n(rec.get("MasMenos")),
    }


def _gt(seconds: Optional[int]) -> str:
    s = max(0, int(seconds or 0))
    return f"{s // 60:02d}:{s % 60:02d}"


def plen(period: int) -> int:
    """A period's length in seconds: ten-minute quarters, five-minute overtimes."""
    return 600 if period <= 4 else 300


class LnbArAdapter(FibaLiveStatsAdapter):
    name = "lnbar"
    min_request_gap_s = 1.0

    def __init__(self):
        super().__init__()
        self._fixtures: dict = {}           # (key, lo, hi) -> (read at, rows)

    def _get(self, url: str, params: Optional[dict] = None) -> Optional[str]:
        gap = time.time() - getattr(self, "_last", 0.0)
        if gap < self.min_request_gap_s:
            time.sleep(self.min_request_gap_s - gap)
        self._last = time.time()
        r = requests.get(url, params=params, headers=HEADERS, timeout=60)
        if r.status_code in (404, 429, 500, 502, 503):
            return None
        r.raise_for_status()
        r.encoding = "utf-8"
        return r.text

    def _fixture(self, key: str, lo: str, hi: str) -> list:
        """One fixture read (cached FIXTURE_TTL_S), as rows."""
        hit = self._fixtures.get((key, lo, hi))
        if hit and time.time() - hit[0] < FIXTURE_TTL_S:
            return hit[1]
        page = self._get(f"{SITE}/{key}/fixture", {"handler": "ProximosPartidos", "fechaInicio": lo, "fechaFin": hi})
        if page is None:
            return []
        rows = fixture_rows(page)
        self._fixtures[(key, lo, hi)] = (time.time(), rows)
        return rows

    # ----------------------------------------------------------------- schedule ---
    @staticmethod
    def schedule_games(rows: list, key: str, now: Optional[datetime] = None) -> list:
        now = now or datetime.now(timezone.utc)
        out = []
        for r in with_ids(rows, key):
            tip, tbc = tipoff(r["date"], r["time"])
            extra = {"home_code": r["home_club"], "away_code": r["away_club"],
                     "home_logo": crest(r["home_club"], r["home_team"]), "away_logo": crest(r["away_club"], r["away_team"]),
                     "home_team_id": r["home_team"], "away_team_id": r["away_team"],
                     "venue": place(r["venue"]),
                     "league": key}
            if tbc:
                extra["time_tbc"] = True
            if r["home_score"] or r["away_score"]:
                extra["home_score"], extra["away_score"] = r["home_score"], r["away_score"]
            out.append(ScheduleGame(external_id=r["xid"], home_name=club_name(r["home"]), away_name=club_name(r["away"]),
                                    tipoff_at=tip, status=status_of(r, tip, tbc, now), extra=extra))
        return out

    def discover(self, schedule_url: str, config: dict) -> Iterable[ScheduleGame]:
        key = league_key(schedule_url, config)
        season = current_season()
        asked = normalize_season(config.get("season")) if config.get("season") else season
        self.last_competitions = []
        if asked != season:
            print(f"     {LEAGUES[key]}: the site lists only {season}, not {config.get('season')} - nothing discovered")
            return []
        lo, hi = season_dates(season)
        page = self._get(f"{SITE}/{key}/fixture", {"handler": "ProximosPartidos", "fechaInicio": lo, "fechaFin": hi})
        if page is None:
            raise RuntimeError(f"lnbar: {key} fixture did not answer")
        rows = fixture_rows(page)
        self._fixtures[(key, lo, hi)] = (time.time(), rows)
        out = self.schedule_games(rows, key)
        for r, g in zip(with_ids(rows, key), out):
            if r.get("token"):
                _TOKENS[g.external_id] = r["token"]
        print(f"     {LEAGUES[key]} {season}: {len(out)} games ({sum(1 for g in out if g.status == 'final')} final, "
              f"{sum(1 for g in out if g.status == 'live')} live)")
        return out

    # --------------------------------------------------------------------- game ---
    def token_for(self, xid: str, config: dict) -> Optional[str]:
        """The game's link token: kept from discovery, else found in its day's fixture, else in the season's."""
        if xid in _TOKENS:
            return _TOKENS[xid]
        m = XID.match(xid)
        if not m:
            return None
        key, home, away, nth = m.group(1), m.group(2), m.group(3), int(m.group(4))
        tip = config.get("_tipoff_at")
        if tip:
            try:
                day = datetime.fromisoformat(str(tip).replace("Z", "+00:00")).astimezone(ART).date().isoformat()
            except ValueError:
                day = None
            if day:
                hits = [r for r in self._fixture(key, day, day) if (r["home_team"], r["away_team"]) == (home, away)]
                if len(hits) == 1 and hits[0].get("token"):
                    _TOKENS[xid] = hits[0]["token"]
                    return _TOKENS[xid]
        lo, hi = season_dates(current_season())
        for r in with_ids(self._fixture(key, lo, hi), key):
            if r.get("token"):
                _TOKENS.setdefault(r["xid"], r["token"])
        return _TOKENS.get(xid)

    def fetch(self, external_id: str, config: dict) -> Optional[GameBundle]:
        xid = str(external_id).strip()
        m = XID.match(xid)
        if not m or m.group(1) not in LEAGUES:
            return None
        if config.get("league") and str(config["league"]).lower() != m.group(1):
            return None                       # another league's game: never filed under this source
        tip = config.get("_tipoff_at")
        if tip:
            try:
                if datetime.fromisoformat(str(tip).replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(minutes=10):
                    return None               # not tipped off: no request at all
            except ValueError:
                pass
        token = self.token_for(xid, config)
        if not token:
            return None
        page = self._get(f"{SITE}/{m.group(1)}/partido/{token}/x")
        if page is None:
            _TOKENS.pop(xid, None)            # a token that stopped working is found again next time
            return None
        raw = self.translate(page, m.group(2), m.group(3))
        if raw is None:
            return None
        b = self.bundle_from_raw(raw, xid, config)
        h = header(page)
        b.tipoff_at = page_tipoff(h) or tip
        if h.get("venue"):
            b.venue = place(h["venue"])
        return b

    @staticmethod
    def translate(page: str, home_team: str = "", away_team: str = "") -> Optional[dict]:
        """One game page -> the FIBA data.json shape (fibashape). None for a game with nothing on it yet."""
        h = header(page)
        rows = box_rows(page)
        acts = parse_actions(page)
        if not rows and not acts:
            return None
        home_team = home_team or (h.get("home") or {}).get("team", "")
        away_team = away_team or (h.get("away") or {}).get("team", "")
        side_of_team = {str(home_team): 1, str(away_team): 2}
        side_of_club = {str((h.get("home") or {}).get("club", "")): 1, str((h.get("away") or {}).get("club", "")): 2}

        players = {1: {}, 2: {}}
        totals = {1: None, 2: None}
        for rec, args in rows:
            if "IdJugador" not in rec:
                tno = side_of_club.get(str(args[0]) if args else "")
                if tno:
                    totals[tno] = rec
                continue
            tno = side_of_team.get(str(rec.get("IdEquipo")))
            if not tno:
                continue
            pno = str(rec.get("IdJugador"))
            st = _stats(rec)
            mins = _minutes(rec.get("TiempoJuego"))
            played = mins != "0:00" or any(st[k] for k in ("sPoints", "sFieldGoalsAttempted", "sFreeThrowsAttempted",
                                                          "sReboundsTotal", "sAssists", "sFoulsPersonal", "sTurnovers"))
            full = (rec.get("NombreCompleto") or rec.get("Nombre") or "").strip()
            first, last = N.split_display(full)
            p = S.player(first=first, last=last, name=full, shirt=str(rec.get("Dorsal") or "").strip(),
                         starter=1 if rec.get("CincoInicial") else 0, active=1 if played else 0,
                         minutes=mins if played else "0:00", stats=st)
            p["photoT"] = f"{SITE}/fotos/{pno}"
            players[tno][pno] = p

        # a box that flags fewer than five starters (early in a live game) takes them from the first period's
        # announcement, which is exactly the five on court at the start
        for tno in (1, 2):
            if sum(1 for p in players[tno].values() if p["starter"]) < 5:
                five = [a["pid"] for a in acts if a["code"] == "CAMBIO-JUGADOR-ENTRA" and a["side"] == tno and a["period"] == 1
                        and a["clock"] == plen(1)][:5]
                if len(five) == 5 and all(x in players[tno] for x in five):
                    for pno, p in players[tno].items():
                        p["starter"] = 1 if pno in five else 0

        events, quarters, last_period = LnbArAdapter.events(acts, players)
        status = h.get("status") or ""
        played = status == "finalizado" or any(a["code"] == "FINAL-PARTIDO" for a in acts)

        tm = []
        for tno, side in ((1, "home"), (2, "away")):
            hs = h.get(side) or {}
            club = hs.get("club") or ""
            team_id = hs.get("team") or (home_team if tno == 1 else away_team)
            tot = _stats(totals[tno]) if totals[tno] else None
            score = hs.get("score")
            if score is None and totals[tno]:
                score = S.num(totals[tno].get("Puntos"))
            name = club_name(hs.get("name") or "")
            t = S.team(name, club or str(team_id), score=score, quarters=quarters[tno][:4], players=players[tno],
                       logo=crest(club, team_id), totals=tot, short_name=name)
            for i in range(len(quarters[tno]), 4):
                t.pop(f"p{i + 1}_score", None)
            for i, v in enumerate(quarters[tno][4:], start=1):
                t[f"ot{i}_score"] = v
            tm.append(t)
        if played and events:
            events.append({"actionNumber": events[-1]["actionNumber"] + 1, "actionType": "game", "subType": "end",
                           "period": last_period, "gt": "00:00", "tno": 0, "pno": ""})
        return S.game(tm[0], tm[1], played=played, pbp=events)

    @staticmethod
    def events(acts: list, players: dict) -> tuple:
        """The site's lines -> (FIBA events oldest first, each side's points per period, the last period).
        See the module docstring for the period announcements and the fouls."""
        known = {tno: set(players[tno]) for tno in (1, 2)}
        on = {tno: {pno for pno, p in players[tno].items() if p["starter"]} for tno in (1, 2)}
        started, ended = set(), set()
        announce = {1: [], 2: []}
        out = []                                   # events in order; numbered at the end
        cum = {}                                   # period -> (home, away) running score at its last line
        last_period = 1
        arrow_seen = False

        def ev(action, sub, success, a, tno, pno, period, clock):
            e = {"actionType": action, "period": period, "gt": _gt(clock), "tno": tno, "pno": pno or ""}
            if sub:
                e["subType"] = sub
            if success is not None:
                e["success"] = success
            out.append(e)
            return e

        def open_period(p):
            """A period's start: its event, and (after the first) the announcement as one balanced change."""
            if p in started:
                return
            started.add(p)
            out.append({"actionType": "period", "subType": "start", "period": p, "gt": _gt(plen(p)), "tno": 0, "pno": ""})
            for tno in (1, 2):
                five = [x for x in dict.fromkeys(announce[tno]) if x in known[tno]]
                announce[tno] = []
                if p == 1 or len(five) != 5:
                    continue
                outs, ins = sorted(on[tno] - set(five)), [x for x in five if x not in on[tno]]
                if len(outs) != len(ins):
                    continue
                for x in outs:
                    ev("substitution", "out", None, None, tno, x, p, plen(p))
                for x in ins:
                    ev("substitution", "in", None, None, tno, x, p, plen(p))
                on[tno] = set(five)

        for a in acts:
            code, tno, p = a["code"], a["side"], a["period"] or last_period
            pno = a["pid"] if a["pid"] in known.get(tno, ()) else ""
            if code == "INICIO-PARTIDO":
                continue                           # the game's opening line: before the first announcement
            if code == "INICIO-PERIODO":
                open_period(p)
                last_period = max(last_period, p)
                continue
            if code in ("FINAL-PERIODO", "FINAL-PARTIDO"):
                if code == "FINAL-PERIODO" and p not in ended:
                    ended.add(p)
                    out.append({"actionType": "period", "subType": "end", "period": p, "gt": "00:00", "tno": 0, "pno": ""})
                continue
            if code == "CAMBIO-JUGADOR-ENTRA" and p not in started and a["clock"] == plen(p):
                announce[tno].append(a["pid"])     # the period's announcement, before its start
                continue
            if p not in started:
                open_period(p)                     # a period whose start line is missing
            last_period = max(last_period, p)
            if a["score"]:
                cum[p] = a["score"]
            if code in SILENT or not tno:
                continue
            if code in ("CAMBIO-JUGADOR-ENTRA", "CAMBIO-JUGADOR-SALE"):
                if not pno:
                    continue
                sub = "in" if code.endswith("ENTRA") else "out"
                ev("substitution", sub, None, a, tno, pno, p, a["clock"])
                (on[tno].add if sub == "in" else on[tno].discard)(pno)
                continue
            if code.startswith("FLECHA-ALTERNANCIA"):
                # the arrow's first setting points at the side that LOST the opening tip (it has the next
                # alternating possession); every later one is a held ball and says nothing new
                if not arrow_seen and p == 1:
                    arrow_seen = True
                    ev("jumpball", "lost", None, a, tno, "", p, a["clock"])
                    ev("jumpball", "won", None, a, 3 - tno, "", p, a["clock"])
                continue
            spec = ACTIONS.get(code)
            if spec is None:
                kind = foul_kind(code)
                if kind is None:
                    continue
                spec = ("foul", kind, None)
                if kind in ("coachtechnical", "benchtechnical"):
                    pno = ""
            action, sub, success = spec
            e = ev(action, sub, success, a, tno, pno, p, a["clock"])
            e["_clock"] = (p, a["clock"])
            if action == "foulon":
                e["_opp_on"] = set(on[3 - tno])    # who could have committed it, should its foul line be missing
            if action == "rebound" and not pno:
                e["qualifier"] = ["team"]
            if action == "turnover" and not pno:
                e["qualifier"] = ["team"]

        LnbArAdapter._pair_fouls(out, players)
        for i, e in enumerate(out, start=1):
            e["actionNumber"] = i
        for e in out:
            ref = e.pop("_ref", None)
            if ref is not None:
                e["previousAction"] = ref["actionNumber"]
            e.pop("_clock", None)
            e.pop("_opp_on", None)
        # each side's points in each period, from the running score at the period's last scoring line
        quarters = {1: [], 2: []}
        prev = (0, 0)
        for p in range(1, last_period + 1):
            now = cum.get(p, prev)
            quarters[1].append(now[0] - prev[0])
            quarters[2].append(now[1] - prev[1])
            prev = now
        return out, quarters, last_period

    @staticmethod
    def _pair_fouls(out: list, players: dict) -> None:
        """Each FALTA-RECIBIDA (foulon) after the foul it was drawn from - the other side's, at the same clock -
        and pointing back at it.

        A DRAWN FOUL WHOSE FOUL LINE IS NOT THERE. The site leaves a foul's own line out now and then - the
        action number is skipped (Lanús v Gimnasia: accion-408 at 2:19 of the third, where Chacón Tirado drew a
        foul and went to the line), while the box score counts the foul against the player who made it. One in
        forty fouls, in three games of four. The foul is put back where its drawn half says it was, on the one
        player of the other side who was on the floor then and whose box-score fouls the log is short of; with
        none or several such players it is the team's foul, never a guess between two."""
        fouls = [e for e in out if e["actionType"] == "foul"]
        used = set()
        moves = []
        for e in [x for x in out if x["actionType"] == "foulon"]:
            foul = None
            for f in fouls:
                if id(f) in used or f["tno"] == e["tno"] or f.get("_clock") != e.get("_clock"):
                    continue
                foul = f
                break
            if foul is not None:
                used.add(id(foul))
            e["_ref"] = foul
            moves.append((e, foul))
        logged = {}
        for f in fouls:
            if f.get("pno"):
                logged[(f["tno"], f["pno"])] = logged.get((f["tno"], f["pno"]), 0) + 1
        for e, foul in moves:
            at = out.index(e)
            out.pop(at)
            if foul is None:
                opp = 3 - e["tno"]
                short = [x for x in sorted(e.get("_opp_on") or ())
                         if S.num((players.get(opp) or {}).get(x, {}).get("sFoulsPersonal")) > logged.get((opp, x), 0)]
                who = short[0] if len(short) == 1 else ""
                if who:
                    logged[(opp, who)] = logged.get((opp, who), 0) + 1
                foul = {"actionType": "foul", "subType": "personal", "period": e["period"], "gt": e["gt"],
                        "tno": opp, "pno": who}
                if not who:
                    foul["qualifier"] = ["team"]
                out.insert(at, foul)                 # where its drawn half was
                e["_ref"] = foul
            out.insert(out.index(foul) + 1, e)

    def _stints_via_pipeline(self, raw: dict, gid: str, config: dict, team_rows: dict) -> list:
        """A translated feed is built forwards; the scraper's builder reads a real data.json backwards
        (see bleague.py). Nothing here hands the game to scripts/ingest/stints.py."""
        return []
