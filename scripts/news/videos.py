"""A channel's videos, put on the games they are of.  (migration 0237; called from fetch_feeds.run)

WHAT A VIDEO IS, from its title (classify):
    'highlights'  the title says so, in any of the leagues' languages: "Highlights", "Resumen", "Mejores momentos",
                  "Skrót meczu", "Höjdpunkter", "Kohokohdat", "Zusammenfassung", "Temps forts", "ハイライト" ...
    'full'        a whole game: "Full game", "Partido completo", "LIVE", "En directo", "Livestream", "ライブ配信" ...
    'video'       anything else (an interview, a preview, a feature)
A highlight word wins over a live word ("Highlights | LIVE from Tokyo" is highlights).

WHICH GAME (match_videos): the clubs the title names (ClubFinder, over the leagues the channel and the video are
about), taken two at a time, best first; the pair that played each other at the right time is the game:
    highlights   tipped off up to six days before the video was published (never after: a preview is no highlight)
    full game    within four days either side (a stream is published when it is scheduled, a replay when uploaded)
A pair that never met in that window is no game, so a title naming three clubs, or one club twice in two
languages, still finds the one game it is of. Nothing is guessed: no pair, no game.

WHAT IT BECOMES (the channel's news_sources.video_mode):
    'highlights'  a matched video is the game's highlights, unless its title says it is the whole game
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
    if _has(F, FULL_WORDS, FULL_CJK):
        return "full"
    return "video"


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

    def find(self, title: str | None, leagues: set | None = None) -> list[tuple[str, float]]:
        """[(team id, strength)] for every club the title names, strongest first; within `leagues` when given.
        Strength is the length of the longest phrase found, so a full name beats a city."""
        F = wide_fold(title)
        flat = F.replace(" ", "")
        got: dict[str, float] = {}
        taken: list[tuple[int, int]] = []
        for phrase, tid, lid, cjk in self.phrases:
            if leagues and lid not in leagues:
                continue
            if cjk:
                i = flat.find(phrase.replace(" ", ""))
                if i < 0:
                    continue
                span = (i + 10_000, i + 10_000 + len(phrase))
            else:
                i = F.find(" " + phrase + " ")
                if i < 0:
                    continue
                span = (i, i + len(phrase) + 1)
            # a phrase inside a longer one already taken by another club is that club's word, not a second club
            if any(a <= span[0] and span[1] <= b for a, b in taken) and tid not in got:
                continue
            taken.append(span)
            got[tid] = max(got.get(tid, 0.0), float(len(phrase.replace(" ", ""))))
        return sorted(got.items(), key=lambda kv: -kv[1])


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


def pick_game(games: list[dict], published: datetime, kind: str) -> dict | None:
    """the game of a video published at `published`: tipped off inside the kind's window, the nearest"""
    before, after = HIGHLIGHT_WINDOW if kind == "highlights" else FULL_WINDOW
    best, best_d = None, None
    for g in games or []:
        t = _iso(g.get("tipoff_at"))
        if not t or not (published - before <= t <= published + after):
            continue
        if kind == "highlights" and g.get("status") not in ("live", "finalising", "final"):
            continue
        d = abs((published - t).total_seconds())
        if best_d is None or d < best_d:
            best, best_d = g, d
    return best


def outcome(classified: str, mode: str) -> str | None:
    """what a matched video becomes on a channel in `mode`: 'highlights', 'full', or None (left alone)"""
    if mode == "off":
        return None
    if classified == "highlights":
        return "highlights"
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


def api_items(feed_url: str, key: str, get_json, now: datetime | None = None) -> list[dict]:
    """parse_feed's items for a channel's (or playlist's) newest uploads, read with the Data API"""
    pl = playlist_of(feed_url)
    if not pl or not key:
        return []
    j = get_json(YT_API + "playlistItems?part=snippet,contentDetails&maxResults=15&playlistId=%s&key=%s" % (pl, key))
    out = []
    for it in (j or {}).get("items") or []:
        sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
        vid = cd.get("videoId") or ((sn.get("resourceId") or {}).get("videoId"))
        title = (sn.get("title") or "").strip()
        if not vid or not _ID.match(vid) or not title or title in ("Private video", "Deleted video"):
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


def match_videos(db, now: datetime | None = None, log=print, dry_run: bool = False) -> dict:
    """The pass: every video of the last RETRY_DAYS with no game, not locked, not tried in GAP_RETRY."""
    now = now or datetime.now(timezone.utc)
    done = {"tried": 0, "matched": 0, "highlights": 0, "full": 0, "attached": 0}
    try:
        items = db.videos_to_match(now - timedelta(days=RETRY_DAYS), now - GAP_RETRY)
    except Exception as e:
        log("  (videos: none read: %s)" % e)
        return done
    if not items:
        return done
    sources = db.video_sources([i["source_id"] for i in items])
    finder = ClubFinder(db.teams_full())
    games_cache: dict = {}
    for it in items:
        src = sources.get(str(it["source_id"])) or {}
        mode = src.get("video_mode") or "highlights"
        if mode == "off":
            continue
        done["tried"] += 1
        title = it.get("title") or ""
        patch = {"matched_at": now.isoformat()}
        kind = classify(title)
        if not_a_game(title) and kind != "highlights":
            kind = None
        game = None
        becomes = outcome(kind, mode) if kind else None
        published = _iso(it.get("published_at")) or now
        if becomes:
            leagues = {str(x) for x in ([src.get("league_id")] + list(src.get("assigned_leagues") or [])
                                        + list(it.get("league_ids") or [])) if x}
            found = finder.find(title, leagues or None)
            if len(found) < 2 and leagues:
                found = finder.find(title)                     # a channel of one league showing another's game
            for a, b in pairs(found):
                key = tuple(sorted((a, b)))
                if key not in games_cache:
                    try:
                        games_cache[key] = db.games_between(a, b, published - timedelta(days=7), published + timedelta(days=5))
                    except Exception as e:
                        log("  (videos: games of a pair not read: %s)" % e)
                        games_cache[key] = []
                game = pick_game(games_cache[key], published, becomes)
                if game:
                    break
        if game:
            patch.update({"game_id": game["id"], "video_kind": becomes})
            done["matched"] += 1
            done["highlights" if becomes == "highlights" else "full"] += 1
            log("    ~ video %s -> %s game %s" % (title[:60], becomes, game["id"]))
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
        log("videos: %(tried)d looked at, %(matched)d put on a game (%(highlights)d highlights, %(full)d full games), "
            "%(attached)d attached for seeking" % done)
    return done
