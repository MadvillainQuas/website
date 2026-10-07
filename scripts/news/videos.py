"""A channel's videos, put on the games they are of.  (migration 0237; called from fetch_feeds.run)

WHAT A VIDEO IS, from its title (classify):
    'highlights'  the title says so, in any of the leagues' languages: "Highlights", "Resumen", "Mejores momentos",
                  "Skrót meczu", "Höjdpunkter", "Kohokohdat", "Zusammenfassung", "Temps forts", "ハイライト" ...
    'press'       a press conference, before or after a game: "Press conference", "Rueda de prensa", "Pressekonferenz",
                  "Konferencja prasowa", "記者会見" ...
    'full'        a whole game: "Full game", "Partido completo", "LIVE", "En directo", "Livestream", "ライブ配信" ...
    'video'       anything else (an interview, a preview, a feature)
A highlight word wins over a press word, and a press word over a live word ("Highlights | LIVE from Tokyo" is
highlights, "LIVE: post-game press conference" a press conference).

WHICH GAME (match_videos): the clubs the title names (ClubFinder, over the leagues the channel and the video are
about), taken two at a time, best first; the pair that played each other at the right time is the game:
    highlights   tipped off up to six days before the video was published (never after: a preview is no highlight)
    press        tipped off up to two days before it (after the game) or three days after it (the one before)
    full game    within four days either side (a stream is published when it is scheduled, a replay when uploaded)
and among those (pick_game): a date the title gives must be the game's ("05/10/2026", "5 Oct", "10月5日"); then the
soonest before the video went up (a highlight is posted within hours of the final buzzer), the one in the leagues
the channel and the video are about, and the one whose competition the title names (a cup tie and a league game
between the same clubs in one week: "Copa" says which). A pair that never met in that window is no game, so a title
naming three clubs, or one club twice in two languages, still finds the one game it is of. Nothing is guessed: no
pair, no game.

A CHANNEL'S OWN NAMES (0240 news_video_clubs, set in the console beside the channel): "Flyers" is Bristol Flyers on
this channel, "Leicester" is nobody (the presenter). They are read before the clubs' own names and win over them;
a phrase for nobody hides its words from every club. What was found and where the matcher stopped is written on the
video (match_clubs, match_note) for the console to show.

WHAT IT BECOMES (the channel's news_sources.video_mode):
    'highlights'  a matched video is the game's highlights, unless its title says it is the whole game (a press
                  conference is a press conference on either mode: the game page plays it after the game's others)
    'seeking'     a matched video is the game's broadcast (unless its title says highlights), and becomes the
                  game's primary video when the game has none - the game page then seeks it to each play once its
                  clock is read, as it does for a stream the ingest found
    'off'         left alone
A link made by hand (news_items.game_locked) is never touched. A video that found no game is tried again on the
reads after GAP_RETRY, for RETRY_DAYS after it was published (a highlight is often up before the result is in).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

RETRY_DAYS = 10
GAP_RETRY = timedelta(hours=3)
HIGHLIGHT_WINDOW = (timedelta(days=6), timedelta(hours=1))      # (before publication, after it)
FULL_WINDOW = (timedelta(days=4), timedelta(days=4))
PRESS_WINDOW = (timedelta(days=2), timedelta(days=3))
MAX_PAIRS = 6


def wide_fold(text: str | None) -> str:
    """lower case, accents off, any script's letters and digits kept (kana, kanji, Greek, Cyrillic), one space
    between words, a space at each end"""
    t = unicodedata.normalize("NFKC", text or "")
    # accents off letters, never off kana: NFKD would split ビ into ヒ and its voicing mark
    t = "".join(ch if has_cjk(ch) else "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
                for ch in t).lower()
    t = t.replace("ł", "l").replace("ø", "o").replace("đ", "d").replace("ß", "ss").replace("æ", "ae")
    return " " + " ".join(re.sub(r"[\W_]+", " ", t).split()) + " "


def has_cjk(s: str) -> bool:
    return bool(re.search(r"[぀-ヿ㐀-鿿가-힯]", s or ""))


# ------------------------------------------------------------------------------------------- the video id ---
_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


def video_id(url: str | None, guid: str | None = None) -> str | None:
    """A YouTube video's id from its watch link, short link, embed link or its feed's guid (yt:video:ID)."""
    g = str(guid or "")
    if g.startswith("yt:video:") and _ID.match(g[9:]):
        return g[9:]
    try:
        u = urlparse(str(url or ""))
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    cand = None
    if host.endswith("youtu.be"):
        cand = u.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if u.path == "/watch":
            cand = (parse_qs(u.query).get("v") or [None])[0]
        else:
            m = re.match(r"^/(?:embed|shorts|live|v)/([^/?#]+)", u.path)
            cand = m.group(1) if m else None
    return cand if cand and _ID.match(cand) else None


# ------------------------------------------------------------------------------------- what the video is ---
# as the leagues' own channels write it; folded (wide_fold), whole words unless marked as a CJK fragment
HIGHLIGHT_WORDS = [
    "highlights", "highlight", "hl", "extended highlights", "game recap", "match recap", "recap",
    "resumen", "resumen del partido", "mejores momentos", "lo mejor del partido", "resumo", "melhores momentos",
    "temps forts", "resume du match", "le resume", "faits saillants",
    "zusammenfassung", "spielzusammenfassung", "die highlights",
    "sintesi", "gli highlights", "momenti salienti",
    "skrot", "skrot meczu", "najlepsze akcje", "najciekawsze akcje",
    "hojdpunkter", "sammandrag", "hoydepunkter", "hojdepunkter", "sammendrag",
    "kohokohdat", "kooste", "koosteet", "ottelukooste",
    "hoogtepunten", "samenvatting", "samenvattingen",
    "sazetak", "najbolji trenuci", "rezime", "highlajti", "сажетак",
    "ozet", "mac ozeti", "ozetler",
    "apzvalga", "rungtyniu apzvalga", "akimirkos", "kokkuvote", "parskats", "labakie momenti",
    "sestrih", "zostrih", "osszefoglalo", "rezumat", "povzetek",
    "στιγμιοτυπα", "περιληψη", "highlights αγωνα", "акценти", "обзор", "огляд", "основни моменти",
]
HIGHLIGHT_CJK = ["ハイライト", "ダイジェスト", "하이라이트", "集锦", "精华", "精華", "集錦"]
FULL_WORDS = [
    "full game", "full match", "full broadcast", "whole game", "live", "livestream", "live stream", "en vivo",
    "en directo", "directo", "partido completo", "retransmision", "transmision", "jogo completo", "ao vivo",
    "match complet", "en direct", "direct", "ganzes spiel", "komplettes spiel", "partita completa", "diretta",
    "caly mecz", "transmisja", "na zywo", "hela matchen", "direktsandning", "koko ottelu", "suora", "suorana",
    "volledige wedstrijd", "cijela utakmica", "uzivo", "canli", "tiesiogiai", "visos rungtynes", "prenos",
    "ζωντανα", "πληρης αγωνας", "на живо", "цял мач",
]
FULL_CJK = ["ライブ", "生中継", "生配信", "フルマッチ", "配信", "생중계", "직캐", "直播", "全场", "全場"]
PRESS_WORDS = [
    "press conference", "press conferences", "presser", "post game press", "postgame press", "pre game press",
    "pregame press", "rueda de prensa", "conferencia de prensa", "conferencia de imprensa", "entrevista coletiva", "conference de presse",
    "pressekonferenz", "conferenza stampa", "konferencja prasowa", "presskonferens", "pressekonferanse", "pressemode",
    "lehdistotilaisuus", "persconferentie", "tiskovna konferencija", "tiskova konferenca", "basin toplantisi", "spaudos konferencija",
    "pressikonverents", "preses konference", "sajtotajekoztato", "conferinta de presa", "συνεντευξη τυπου", "пресс конференция",
    "прес конференция", "пресконференција", "пресконференция",
]
PRESS_CJK = [
    "記者会見", "会見", "기자회견", "发布会", "新闻发布会", "記者會", "记者会",
]
NOT_A_GAME_WORDS = [
    "press conference", "post game press", "postgame press", "rueda de prensa", "conferencia de prensa", "entrevista",
    "interview", "interviews", "preview", "previa", "avance", "trailer", "podcast", "behind the scenes", "vlog",
    "konferencja", "konferencja prasowa", "presskonferens", "pressekonferenz", "conferenza stampa", "conference de presse",
    "lehdistotilaisuus", "persconferentie",
]
NOT_A_GAME_CJK = ["記者会見", "インタビュー", "会見", "프리뷰", "인터뷰", "기자회견", "采访", "发布会"]


def _has(F: str, words, cjk=()) -> bool:
    return any(" " + w + " " in F for w in words) or any(c in F for c in cjk)


def classify(title: str | None) -> str:
    F = wide_fold(title)
    if _has(F, HIGHLIGHT_WORDS, HIGHLIGHT_CJK):
        return "highlights"
    if _has(F, PRESS_WORDS, PRESS_CJK):
        return "press"
    if _has(F, FULL_WORDS, FULL_CJK):
        return "full"
    return "video"


def title_passes(title: str | None, include=None, exclude=None) -> bool:
    """A SOURCE'S TITLE FILTER (0246, news_title_passes): KEEP ONLY a title with one of `include` (none: every title),
    NEVER one with any of `exclude`; a word or a phrase found as words, whatever the case and the accents
    ("betclic elite" finds "Betclic ÉLITE | Paris - Monaco", never "elitebasket")"""
    F = wide_fold(title)
    inc = [w for w in (wide_fold(x).strip() for x in (include or [])) if w]
    exc = [w for w in (wide_fold(x).strip() for x in (exclude or [])) if w]
    if inc and not any(" " + w + " " in F for w in inc):
        return False
    return not any(" " + w + " " in F for w in exc)


def not_a_game(title: str | None) -> bool:
    """a press conference, an interview, a preview: about a game, not of it"""
    return _has(wide_fold(title), NOT_A_GAME_WORDS, NOT_A_GAME_CJK)


# ------------------------------------------------------------------------------------ the clubs it names ---
CLUB_TAIL = {"bc", "bk", "kk", "cb", "fc", "sc", "sk", "ks", "basket", "basketball", "baloncesto", "pallacanestro",
             "club", "cd", "ud", "sad", "bbc", "kb", "ssd", "asd", "rb"}
GENERIC = {"basket", "basketball", "club", "united", "city", "stars", "team", "real", "sporting", "atletico", "athletic",
           "union", "olimpia", "dynamo", "dinamo", "spartak", "slavia", "academy", "women", "men", "juniors", "royals",
           "lions", "tigers", "eagles", "kings", "warriors", "giants", "falcons", "hawks", "bulls", "bears", "wolves",
           "sharks", "rockets", "storm", "thunder", "heat", "flames", "knights", "titans", "phoenix", "dragons"}


class ClubFinder:
    """The clubs a title names. Each club is known by its name, its short name and its aliases (the native
    spellings the ingest keeps: "千葉ジェッツ", "Nässjö Basket"), each also without a club word at either end
    ("PAOK BC" is "PAOK", "FC Barcelona" "Barcelona"), and by its last word when that is a place of at least five
    letters ("Casademont Zaragoza" is "Zaragoza"), and by any other word of six letters or more ("Movistar
    Estudiantes Madrid" is "Estudiantes", "Olympiacos Piraeus" "Olympiacos").
    A phrase two clubs share is nobody's (Madrid, in a league with two Madrid clubs), unless it is one's full name.
    A Latin phrase counts as whole words; a kana or kanji one anywhere (Japanese runs its words together)."""

    def __init__(self, teams: list[dict]):
        owners: dict[tuple[str, str], set] = {}          # (league, phrase) -> team ids
        full: dict[tuple[str, str], set] = {}
        self.league_of: dict[str, str] = {}
        for t in teams or []:
            tid, lid = str(t.get("id") or ""), str(t.get("league_id") or "")
            if not tid:
                continue
            self.league_of[tid] = lid
            names = [t.get("name"), t.get("short_name")] + list(t.get("aliases") or [])
            for n in names:
                F = wide_fold(n).strip()
                if not F:
                    continue
                cands = {F}
                full.setdefault((lid, F), set()).add(tid)
                words = F.split()
                while words and words[-1] in CLUB_TAIL:
                    words = words[:-1]
                while words and words[0] in CLUB_TAIL:
                    words = words[1:]
                if words:
                    cands.add(" ".join(words))
                    if len(words) > 1 and len(words[-1]) >= 5 and words[-1] not in GENERIC and not words[-1].isdigit():
                        cands.add(words[-1])
                    if len(words) > 1:                     # "Movistar Estudiantes Madrid" is also "Estudiantes"
                        cands.update(w for w in words if len(w) >= 6 and w not in GENERIC and w not in CLUB_TAIL
                                     and not w.isdigit() and not has_cjk(w))
                for c in cands:
                    if c in GENERIC:
                        continue
                    if has_cjk(c):
                        if len(c.replace(" ", "")) < 2:
                            continue
                    elif len(c) < 4:                       # "RMB", "BAR": three letters are anything in a title
                        continue
                    owners.setdefault((lid, c), set()).add(tid)
        self.phrases: list[tuple[str, str, str, bool]] = []    # (phrase, team id, league id, cjk)
        for (lid, c), tids in owners.items():
            for tid in tids:
                mine_fully = tid in full.get((lid, c), set()) and len(full[(lid, c)]) == 1
                if len(tids) == 1 or mine_fully:
                    self.phrases.append((c, tid, lid, has_cjk(c)))
        self.phrases.sort(key=lambda p: -len(p[0]))

    @staticmethod
    def _span(F: str, flat: str, phrase: str, cjk: bool) -> tuple[int, int] | None:
        if cjk:
            i = flat.find(phrase.replace(" ", ""))
            return None if i < 0 else (i + 10_000, i + 10_000 + len(phrase))
        i = F.find(" " + phrase + " ")
        return None if i < 0 else (i, i + len(phrase) + 1)

    def find(self, title: str | None, leagues: set | None = None, rules: list | None = None) -> list[tuple[str, float]]:
        """[(team id, strength)] for every club the title names, strongest first; within `leagues` when given.
        Strength is the length of the longest phrase found, so a full name beats a city.
        rules: the channel's own names (prep_rules, 0240), read first: a phrase found is its club, stronger than any
        name found by the clubs' own; a phrase for no club takes its words away from every club."""
        F = wide_fold(title)
        flat = F.replace(" ", "")
        got: dict[str, float] = {}
        taken: list[tuple[int, int]] = []
        blocked: list[tuple[int, int]] = []
        for phrase, tid, cjk in rules or []:
            span = self._span(F, flat, phrase, cjk)
            if not span or any(not (span[1] <= a or b <= span[0]) for a, b in blocked):
                continue
            if tid and any(a <= span[0] and span[1] <= b for a, b in taken) and tid not in got:
                continue                               # inside a longer name of another club
            if tid:
                taken.append(span)
                got[tid] = max(got.get(tid, 0.0), RULE_STRENGTH + len(phrase.replace(" ", "")))
            else:
                blocked.append(span)
        for phrase, tid, lid, cjk in self.phrases:
            if leagues and lid not in leagues:
                continue
            span = self._span(F, flat, phrase, cjk)
            if not span:
                continue
            # words the channel says are no club's are nobody's
            if any(not (span[1] <= a or b <= span[0]) for a, b in blocked):
                continue
            # a phrase inside a longer one already taken by another club is that club's word, not a second club
            if any(a <= span[0] and span[1] <= b for a, b in taken) and tid not in got:
                continue
            taken.append(span)
            got[tid] = max(got.get(tid, 0.0), float(len(phrase.replace(" ", ""))))
        return sorted(got.items(), key=lambda kv: -kv[1])


RULE_STRENGTH = 100.0


def prep_rules(rows: list[dict] | None) -> list[tuple[str, str | None, bool]]:
    """a channel's names (news_video_clubs rows: phrase, team_id) as find() reads them: folded as titles are, the
    longest first (so "Bristol Flyers" is read before "Flyers")"""
    out = []
    for r in rows or []:
        F = wide_fold(r.get("phrase")).strip()
        if F:
            out.append((F, str(r["team_id"]) if r.get("team_id") else None, has_cjk(F)))
    out.sort(key=lambda p: -len(p[0]))
    return out


def pairs(found: list[tuple[str, float]], limit: int = MAX_PAIRS) -> list[tuple[str, str]]:
    out = []
    for i in range(len(found)):
        for j in range(i + 1, len(found)):
            out.append((found[i][1] + found[j][1], found[i][0], found[j][0]))
    out.sort(key=lambda x: -x[0])
    return [(a, b) for _, a, b in out[:limit]]


def _iso(v) -> datetime | None:
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else None
    except ValueError:
        return None


# ------------------------------------------------------------------------------------- a date in the title ---
MONTHS = {}
for _i, _names in enumerate([
        "jan january enero ene janvier janv januar gennaio gen janeiro styczen styczna sty januari tammikuu tammi",
        "feb february febrero fevrier fev februar febbraio fevereiro luty lutego lut februari helmikuu helmi",
        "mar march marzo mars marz maerz marco marca marzec kesakuu maaliskuu maalis",
        "apr april abril avril aprile kwiecien kwietnia kwi huhtikuu huhti",
        "may mayo mai maggio maio maj maja toukokuu touko mei",
        "jun june junio juin juni giugno junho czerwiec czerwca cze kesakuu",
        "jul july julio juillet juli luglio julho lipiec lipca lip heinakuu heina",
        "aug august agosto aout ago sierpien sierpnia sie elokuu elo augusti",
        "sep sept september septiembre septembre settembre setembro wrzesien wrzesnia wrz syyskuu syys",
        "oct october octubre octobre okt oktober ottobre outubro pazdziernik pazdziernika paz lokakuu loka",
        "nov november noviembre novembre novemb novembro listopad listopada lis marraskuu marras",
        "dec december diciembre dic decembre dezember dicembre dezembro grudzien grudnia gru joulukuu joulu"], start=1):
    for _n in _names.split():
        MONTHS.setdefault(_n, _i)


def title_dates(title: str | None, near: datetime) -> set:
    """the calendar days a title names ("05/10/2026", "2026.10.05", "5 Oct", "October 5th", "5 de octubre",
    "10月5日"), read both ways round where the order is not certain (5/10 is 5 October or 10 May), with the year
    of `near` where none is given. Empty when it names none."""
    from datetime import date
    F = wide_fold(title)
    out = set()

    def add(y, m, d):
        try:
            y = int(y)
            y = y + 2000 if y < 100 else y
            out.add(date(y, int(m), int(d)))
        except (ValueError, TypeError):
            pass
    raw = unicodedata.normalize("NFKC", title or "")
    for y, m, d in re.findall(r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})", raw):
        add(y, m, d)
    for a, b, y in re.findall(r"(?<![\d.])(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?![\d.])", raw):
        add(y, b, a); add(y, a, b)
    for a, b in re.findall(r"(?<![\d./-])(\d{1,2})[./](\d{1,2})\.?(?![\d/-])(?!\.\d)", raw):
        add(near.year, b, a); add(near.year, a, b)
    for m, d in re.findall(r"(\d{1,2})月(\d{1,2})日", raw):
        add(near.year, m, d)
    words = F.split()
    for i, w in enumerate(words):
        m = MONTHS.get(w)
        if not m:
            continue
        nums = [x for x in words[max(0, i - 2):i] + words[i + 1:i + 3] if re.fullmatch(r"\d{1,2}(st|nd|rd|th)?", x)]
        yrs = [x for x in words[i + 1:i + 4] if re.fullmatch(r"(19|20)\d\d", x)]
        for n in nums[:2]:
            add(yrs[0] if yrs else near.year, m, re.sub(r"\D", "", n))
    # a year given only by the season around it: a date a year off "near" belongs to the year that brings it closest
    fixed = set()
    for d in out:
        best = min((d.replace(year=y) for y in (d.year - 1, d.year, d.year + 1) if _valid(d, y)),
                   key=lambda x: abs((x - near.date()).days))
        fixed.add(best if abs((best - near.date()).days) < abs((d - near.date()).days) else d)
    return {d for d in fixed if abs((d - near.date()).days) <= 45}


def _valid(d, y) -> bool:
    try:
        d.replace(year=y)
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------------------- the competition ---
CUP_WORDS = {"cup", "copa", "coupe", "pokal", "coppa", "puchar", "cupen", "cupa", "kupa", "kup", "trophy", "taca", "taça",
             "supercopa", "supercup", "supercoppa", "beker", "pokalen"}
PLAYOFF_WORDS = {"playoff", "playoffs", "play", "final", "finals", "semifinal", "semi", "quarterfinal", "eliminatoria",
                 "finale", "halbfinale", "playout"}
COMP_GENERIC = {"league", "liga", "lega", "ligue", "season", "regular", "temporada", "saison", "stagione", "men", "women",
                "mens", "womens", "basketball", "basket", "division", "group", "grupo", "phase", "fase", "the", "and", "de", "del"}


def competition_fit(title: str | None, comp: str | None, kind: str | None = None) -> float:
    """how well a game's competition fits what the title says: its own words in the title count for it (the
    'Championship', 'Copa del Rey', 'EuroCup'), and a title about a cup is no league game's, nor the other way"""
    if not comp:
        return 0.0
    T, C = set(wide_fold(title).split()), set(wide_fold(comp).split())
    s = 0.0
    shared = {w for w in (C & T) if len(w) >= 4 and w not in COMP_GENERIC}
    if shared:
        s += 1.5
    t_cup, c_cup = bool(T & CUP_WORDS), bool(C & CUP_WORDS) or kind == "cup"
    if t_cup != c_cup:
        s -= 2.0 if t_cup else 1.0
    if (T & PLAYOFF_WORDS) and ((C & PLAYOFF_WORDS) or kind == "playoff"):
        s += 0.5
    return s


def pick_game(games: list[dict], published: datetime, kind: str, title: str | None = None,
              leagues: set | None = None) -> dict | None:
    """THE GAME OF A VIDEO, from the games its two clubs played around the time it was published:
      * inside the kind's window (a highlight after tip-off, at most six days after; a full game four days either
        side), and for a highlight only a game that has been played;
      * a date the title gives decides: the game must be within a day of it, or there is no game;
      * then the best by score: the sooner after the game the video went up the better (a highlight is posted
        within hours: a day later costs a point, six days later almost three), its league among the video's
        leagues (the channel's, the ones it is tagged with) +2, its competition named by the title +1.5, a cup game
        under a title that names no cup -1; and a title that names a cup is never a league game's."""
    before, after = HIGHLIGHT_WINDOW if kind == "highlights" else PRESS_WINDOW if kind == "press" else FULL_WINDOW
    days = title_dates(title, published) if title else set()
    best, best_s = None, None
    for g in games or []:
        t = _iso(g.get("tipoff_at"))
        if not t or not (published - before <= t <= published + after):
            continue
        if kind == "highlights" and g.get("status") not in ("live", "finalising", "final"):
            continue
        if days and not any(abs((t.date() - d).days) <= 1 for d in days):
            continue
        comp = g.get("competitions") or {}
        cname = comp.get("name") or g.get("competition")
        ckind = comp.get("kind")
        if cname and set(wide_fold(title).split()) & CUP_WORDS and not set(wide_fold(cname).split()) & CUP_WORDS and ckind != "cup":
            continue                                   # a cup's highlights are of no league game (the cup may not be here at all)
        gap_h = abs((published - t).total_seconds()) / 3600
        score = -min(gap_h, 24 * 7) / 24 * (1.0 if kind in ("highlights", "press") else 0.5)
        lg = str(((comp.get("seasons") or {}).get("league_id")) or g.get("league_id") or "")
        if leagues and lg and lg in leagues:
            score += 2.0
        score += competition_fit(title, cname, ckind)
        if best_s is None or score > best_s:
            best, best_s = g, score
    return best


def outcome(classified: str, mode: str) -> str | None:
    """what a matched video becomes on a channel in `mode`: 'highlights', 'press', 'full', or None (left alone)"""
    if mode == "off":
        return None
    if classified == "highlights":
        return "highlights"
    if classified == "press":
        return "press"
    if classified == "full":
        return "full"
    return "highlights" if mode == "highlights" else "full"


# ----------------------------------------------------------------------------------- the YouTube Data API ---
# YOUTUBE'S RSS SERVER ANSWERS 404 (2026-10-07: every channel, Google's own included, from here and the runners),
# so a channel is read through the Data API whenever YOUTUBE_API_KEY is set: its uploads playlist, the fifteen
# newest, one quota unit a read (10,000 a day are free; auto_video's searches cost 100 each). The items come out
# exactly as parse_feed's do, so everything after the read is the same. Without the key the RSS is tried as before.
YT_API = "https://www.googleapis.com/youtube/v3/"
_UC = re.compile(r"[?&]channel_id=(UC[A-Za-z0-9_-]{22})")
_PL = re.compile(r"[?&]playlist_id=([A-Za-z0-9_-]{10,64})")


def playlist_of(feed_url: str | None) -> str | None:
    """the playlist the API reads for a channel's or a playlist's feed address (a channel's uploads: UU + its id)"""
    m = _UC.search(feed_url or "")
    if m:
        return "UU" + m.group(1)[2:]
    m = _PL.search(feed_url or "")
    return m.group(1) if m else None


def is_short(url: str | None) -> bool:
    """a YouTube Short (a vertical clip): its feed's link is a /shorts/ address. The site takes none of them."""
    return bool(re.search(r"^https?://(www\.|m\.)?youtube\.com/shorts/", url or "", re.I))


def shorts_of(pl: str, key: str, get_json) -> set:
    """the ids of a channel's newest Shorts: YouTube keeps them in a playlist of their own beside its uploads (UU... is
    every upload, UUSH... the Shorts alone). One more read of the API's cheapest kind; a channel with none answers
    'not found', and nothing is taken out."""
    if not pl or not pl.startswith("UU") or pl.startswith("UUSH"):
        return set()
    try:
        j = get_json(YT_API + "playlistItems?part=contentDetails&maxResults=50&playlistId=UUSH%s&key=%s" % (pl[2:], key))
    except Exception:
        return set()
    return {(it.get("contentDetails") or {}).get("videoId") for it in (j or {}).get("items") or []} - {None}


def api_items(feed_url: str, key: str, get_json, now: datetime | None = None) -> list[dict]:
    """parse_feed's items for a channel's (or playlist's) newest uploads, read with the Data API; its Shorts left out"""
    pl = playlist_of(feed_url)
    if not pl or not key:
        return []
    j = get_json(YT_API + "playlistItems?part=snippet,contentDetails&maxResults=15&playlistId=%s&key=%s" % (pl, key))
    shorts = shorts_of(pl, key, get_json) if (j or {}).get("items") else set()
    out = []
    for it in (j or {}).get("items") or []:
        sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
        vid = cd.get("videoId") or ((sn.get("resourceId") or {}).get("videoId"))
        title = (sn.get("title") or "").strip()
        if not vid or not _ID.match(vid) or not title or title in ("Private video", "Deleted video") or vid in shorts:
            continue
        th = sn.get("thumbnails") or {}
        img = next(((th.get(k) or {}).get("url") for k in ("high", "medium", "standard", "default") if (th.get(k) or {}).get("url")), None)
        desc = re.sub(r"\s+", " ", sn.get("description") or "").strip()
        out.append({"guid": "yt:video:" + vid, "url": "https://www.youtube.com/watch?v=" + vid, "title": title[:300],
                    "summary": (desc[:319].rsplit(" ", 1)[0] + "…") if len(desc) > 320 else desc,
                    "image_url": img if (img or "").startswith("https://") else None,
                    "author": (sn.get("videoOwnerChannelTitle") or sn.get("channelTitle") or None),
                    "tags": [], "published_at": cd.get("videoPublishedAt") or sn.get("publishedAt") or (now or datetime.now(timezone.utc)).isoformat()})
    out.sort(key=lambda x: x["published_at"], reverse=True)
    return out


def api_channel(link: str, key: str, get_json) -> dict | None:
    """{feed_url, name, logo, site_url} for a YouTube link (/@handle, /channel/UC…, /c/name, /user/name, a playlist),
    found with the Data API (a channel's page is behind a consent wall from here). None when it names no channel."""
    if not key:
        return None
    try:
        u = urlparse((link or "").strip())
    except ValueError:
        return None
    if not (u.hostname or "").lower().endswith("youtube.com"):
        return None
    parts = [p for p in u.path.split("/") if p]
    lst = (parse_qs(u.query).get("list") or [""])[0]
    if parts[:1] == ["playlist"] and re.fullmatch(r"[A-Za-z0-9_-]{10,64}", lst):
        j = get_json(YT_API + "playlists?part=snippet&id=%s&key=%s" % (lst, key))
        it = ((j or {}).get("items") or [None])[0]
        if not it:
            return None
        sn = it.get("snippet") or {}
        return {"feed_url": "https://www.youtube.com/feeds/videos.xml?playlist_id=" + lst, "name": sn.get("title"),
                "logo": ((sn.get("thumbnails") or {}).get("high") or {}).get("url"), "site_url": link}
    q = None
    if parts and parts[0].startswith("@"):
        q = "forHandle=" + parts[0]
    elif len(parts) >= 2 and parts[0] == "channel" and re.fullmatch(r"UC[A-Za-z0-9_-]{22}", parts[1]):
        q = "id=" + parts[1]
    elif len(parts) >= 2 and parts[0] in ("user", "c"):
        q = "forUsername=" + parts[1]
    if not q:
        return None
    j = get_json(YT_API + "channels?part=snippet&%s&key=%s" % (q, key))
    it = ((j or {}).get("items") or [None])[0]
    if not it or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", it.get("id") or ""):
        return None
    sn = it.get("snippet") or {}
    th = sn.get("thumbnails") or {}
    logo = next(((th.get(k) or {}).get("url") for k in ("high", "medium", "default") if (th.get(k) or {}).get("url")), None)
    return {"feed_url": "https://www.youtube.com/feeds/videos.xml?channel_id=" + it["id"], "name": sn.get("title"),
            "logo": logo, "site_url": "https://www.youtube.com/channel/" + it["id"]}


def note_of(becomes: str | None, found: list, game: dict | None) -> str:
    """where the matcher stopped with a video, for the console (news_items.match_note, 0240)"""
    if game:
        return "matched"
    if not becomes:
        return "not_a_game"
    if not found:
        return "no_clubs"
    return "one_club" if len(found) == 1 else "no_game"


def match_videos(db, now: datetime | None = None, log=print, dry_run: bool = False) -> dict:
    """The pass: every video of the last RETRY_DAYS with no game, not locked, not tried in GAP_RETRY."""
    now = now or datetime.now(timezone.utc)
    done = {"tried": 0, "matched": 0, "highlights": 0, "full": 0, "press": 0, "attached": 0}
    try:
        items = db.videos_to_match(now - timedelta(days=RETRY_DAYS), now - GAP_RETRY)
    except Exception as e:
        log("  (videos: none read: %s)" % e)
        return done
    if not items:
        return done
    sources = db.video_sources([i["source_id"] for i in items])
    finder = ClubFinder(db.teams_full())
    # the channels' own names for clubs (0240), and a note on each video of what was found: before 0240, neither
    notes_on = bool(getattr(db, "has_video_rules", None)) and db.has_video_rules()
    rules: dict = {}
    if notes_on:
        try:
            rules = {sid: prep_rules(rows) for sid, rows in db.video_rules([i["source_id"] for i in items]).items()}
        except Exception as e:
            log("  (videos: the channels' club names not read: %s)" % e)
    games_cache: dict = {}
    # a press conference is a kind of its own once 0244 is applied; before it, a video on no game as it always was
    try:
        press_on = bool(getattr(db, "has_press_kind", None)) and db.has_press_kind()
    except Exception:
        press_on = False
    for it in items:
        src = sources.get(str(it["source_id"])) or {}
        mode = src.get("video_mode") or "highlights"
        if mode == "off":
            continue
        done["tried"] += 1
        title = it.get("title") or ""
        patch = {"matched_at": now.isoformat()}
        kind = classify(title)
        if kind == "press" and not press_on:
            kind = "video"
        if not_a_game(title) and kind not in ("highlights", "press"):
            kind = None
        game = None
        becomes = outcome(kind, mode) if kind else None
        published = _iso(it.get("published_at")) or now
        found: list = []
        R = rules.get(str(it["source_id"]))
        if becomes:
            leagues = {str(x) for x in ([src.get("league_id")] + list(src.get("assigned_leagues") or [])
                                        + list(it.get("league_ids") or [])) if x}
            found = finder.find(title, leagues or None, R)
            if len(found) < 2 and leagues:
                found = finder.find(title, None, R)            # a channel of one league showing another's game
            for a, b in pairs(found):
                key = tuple(sorted((a, b)))
                if key not in games_cache:
                    try:
                        games_cache[key] = db.games_between(a, b, published - timedelta(days=7), published + timedelta(days=5))
                    except Exception as e:
                        log("  (videos: games of a pair not read: %s)" % e)
                        games_cache[key] = []
                game = pick_game(games_cache[key], published, becomes, title, leagues)
                if game:
                    break
        if game:
            patch.update({"game_id": game["id"], "video_kind": becomes})
            done["matched"] += 1
            done[becomes if becomes in ("highlights", "press") else "full"] += 1
            log("    ~ video %s -> %s game %s" % (title[:60], becomes, game["id"]))
        elif kind == "press":
            patch["video_kind"] = "press"                 # a press conference on no game is still one (HOME's PRESS)
        if notes_on:
            patch["match_clubs"] = [t for t, _ in found][:6]
            patch["match_note"] = note_of(becomes, found, game)
        if dry_run:
            continue
        try:
            db.patch_item(it["id"], patch)
        except Exception as e:
            log("  (videos: %s not recorded: %s)" % (it["id"], e))
            continue
        if game and becomes == "full" and mode == "seeking":
            try:
                if db.attach_broadcast(game["id"], it):
                    done["attached"] += 1
                    log("    + broadcast attached to game %s" % game["id"])
            except Exception as e:
                log("  (videos: broadcast not attached: %s)" % e)
    if done["tried"]:
        log("videos: %(tried)d looked at, %(matched)d put on a game (%(highlights)d highlights, %(full)d full games, %(press)d press conferences), "
            "%(attached)d attached for seeking" % done)
    return done
