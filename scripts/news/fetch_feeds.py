#!/usr/bin/env python3
"""THE NEWS SOURCES, READ - every enabled news_sources row's feed into news_items (migration 0194).

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python scripts/news/fetch_feeds.py
    ... python scripts/news/fetch_feeds.py --dry-run          # read and parse, write nothing
    ... python scripts/news/fetch_feeds.py --source <id>      # one source

Run every half hour by .github/workflows/news-feeds.yml. The News page (epinoia/news/) reads what this writes.

WHAT IS KEPT OF AN ARTICLE: its headline, a plain-text excerpt of at most 320 characters (the feed's own summary,
or the start of its text), the picture the feed names for it (https only: a page may not show an http one), its
author, its categories, its date - and its address, which is where every item on the page goes. Never the article
itself: the News page sends the reader to the source's own site, as a feed is published to allow.

ONE REQUEST A SOURCE A RUN, POLITELY: a conditional GET (the ETag and Last-Modified from the last read), so a feed
that has not changed costs its source a 304 and nothing more; 20 s, 3 MB at the most; half a second between
sources. RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed. Standard library only.

EACH SOURCE'S LAST READ is written on its row (last_fetched_at, last_ok_at, last_error, item_count), which is what
the consoles show; one source failing never stops the others.

WHICH LEAGUES A STORY IS ABOUT (news_items.league_ids): LeagueMatcher reads every league's name and every club's
name once a run, and scores each story's categories, headline and excerpt against them; the leagues it is about go
on the story, and each of them shows it on its own news page.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

UA = "EpinoiaNews/1.0 (+https://prophesyscouting.co.uk/epinoia/news/)"
MAX_BYTES = 3 * 1024 * 1024
TIMEOUT_S = 20
GAP_S = 0.5
PER_READ = 40                  # the newest this many items of a feed are kept each read
KEEP_DAYS = 120                # older items are removed
SUMMARY_MAX = 320

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rss1": "http://purl.org/rss/1.0/",
}


# ------------------------------------------------------------------------------------------------ text ---
class _Text(HTMLParser):
    """Markup to its words: tags gone, entities read, scripts and styles dropped, paragraphs a space."""
    SKIP = {"script", "style", "noscript", "iframe", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.imgs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "img":
            src = dict(attrs).get("src")
            if src:
                self.imgs.append(src)
        elif tag in ("p", "br", "div", "li", "h1", "h2", "h3", "h4", "tr"):
            self.out.append(" ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def text_of(markup: str | None) -> tuple[str, list[str]]:
    """(the plain text of some HTML, the img srcs in it)"""
    if not markup:
        return "", []
    p = _Text()
    try:
        p.feed(markup)
        p.close()
    except Exception:                                   # markup too broken to walk: its text, roughly
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", markup))).strip(), []
    return re.sub(r"\s+", " ", "".join(p.out)).strip(), p.imgs


def clip(text: str, n: int) -> str:
    """at most n characters, cut at a word where there is one, with an ellipsis"""
    text = (text or "").strip()
    if len(text) <= n:
        return text
    cut = text[: n - 1]
    sp = cut.rfind(" ")
    if sp > n * 0.6:
        cut = cut[:sp]
    return cut.rstrip(" ,.;:-–—") + "…"


def https_only(url: str | None, base: str) -> str | None:
    """an image the page may show: https, made absolute"""
    if not url:
        return None
    u = urllib.parse.urljoin(base, html.unescape(url.strip()))
    return u if u.lower().startswith("https://") and len(u) <= 500 and not re.search(r"[\s<>\"]", u) else None


def web_url(url: str | None, base: str) -> str | None:
    """an article's address: http(s), made absolute"""
    if not url:
        return None
    u = urllib.parse.urljoin(base, html.unescape(url.strip()))
    return u if re.match(r"^https?://", u, re.I) and len(u) <= 1000 and not re.search(r"[\s<>\"]", u) else None


# a date written as numbers: 9/30/2026, 30.09.2026, 9/30/2026 10:15:00 AM (FEB's feeds write the first)
NUMERIC_DATE = re.compile(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$")


def when(value: str | None, now: datetime) -> datetime | None:
    """RFC 822 (RSS), ISO 8601 (Atom, JSON Feed, dc:date), or a date in numbers (month first unless the first number
    cannot be a month); a date more than five minutes ahead is now. A day with no time: now when it is today (the
    story is as new as the read that found it), else that day's noon (UTC: the middle of the day anywhere near
    Europe, so the second-apart ordering below never carries it into the day before)."""
    if not value:
        return None
    v = value.strip()
    d = None
    try:
        d = parsedate_to_datetime(v)
    except Exception:
        d = None
    if d is None:
        m = NUMERIC_DATE.match(v)
        if m:
            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            mon, day = (b, a) if a > 12 else (a, b)
            try:
                if m.group(4) is None:
                    day_d = datetime(y, mon, day, 12, tzinfo=timezone.utc)
                    return now if day_d.date() == now.date() else day_d
                hh = int(m.group(4)) % 12 + (12 if (m.group(7) or "").lower() == "pm" else 0) if m.group(7) else int(m.group(4))
                d = datetime(y, mon, day, hh, int(m.group(5)), int(m.group(6) or 0), tzinfo=timezone.utc)
            except ValueError:
                return None
    if d is None:
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    d = d.astimezone(timezone.utc)
    return now if d > now + timedelta(minutes=5) else d      # a clock a little ahead is let be


# ---------------------------------------------------------------------------------------------- parsing ---
def _t(el) -> str:
    return (el.text or "").strip() if el is not None else ""


# WordPress ends every excerpt with "The post <title> appeared first on <site>." - the page names the site itself
WP_TAIL = re.compile(r"\s*The post .{1,300}? appeared first on .{1,120}?\.?\s*$", re.S)


def _item(title, link, guid, date, summary_html, content_html, author, tags, images, base, now):
    words, imgs = text_of(summary_html)
    if not words and content_html:
        words, imgs2 = text_of(content_html)
        imgs = imgs + imgs2
    elif content_html:
        imgs = imgs + text_of(content_html)[1]
    words = WP_TAIL.sub("", words).strip()
    url = web_url(link, base)
    ttl = clip(text_of(title)[0], 300)
    if not url or not ttl:
        return None
    image = next((u for u in (https_only(x, base) for x in images + imgs) if u), None)
    g = (guid or "").strip() or url
    return {
        "guid": g[:500],
        "url": url,
        "title": ttl,
        "summary": clip(words, SUMMARY_MAX),
        "image_url": image,
        "author": clip(text_of(author)[0], 80) or None,
        "tags": [clip(text_of(t)[0], 40) for t in tags if t and text_of(t)[0]][:8],
        "published_at": (lambda d: d.isoformat() if d else None)(when(date, now)),     # none: _newest dates it
    }


def parse_feed(body: bytes, base: str, now: datetime | None = None) -> tuple[dict, list[dict]]:
    """(the feed's own name, home and picture; its items, newest first, at most PER_READ). Raises ValueError
    when it is not a feed at all."""
    now = now or datetime.now(timezone.utc)
    head = body.lstrip()[:1]
    if head == b"{":                                      # JSON Feed
        j = json.loads(body.decode("utf-8", "replace"))
        if not isinstance(j, dict) or not isinstance(j.get("items"), list):
            raise ValueError("not a feed")
        items = []
        for it in j["items"]:
            if not isinstance(it, dict):
                continue
            authors = it.get("authors") or ([it["author"]] if isinstance(it.get("author"), dict) else [])
            x = _item(it.get("title") or "", it.get("url") or it.get("external_url"), str(it.get("id") or ""),
                      it.get("date_published") or it.get("date_modified"),
                      it.get("summary") or it.get("content_html") or html.escape(it.get("content_text") or ""), None,
                      ", ".join(a.get("name", "") for a in authors if isinstance(a, dict)), it.get("tags") or [],
                      [it.get("image"), it.get("banner_image")], base, now)
            if x:
                items.append(x)
        meta = {"title": j.get("title"), "home": web_url(j.get("home_page_url"), base), "image": https_only(j.get("icon") or j.get("favicon"), base)}
        return meta, _newest(items, now)

    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise ValueError("not a feed: " + str(e))
    tag = root.tag
    items = []
    if tag == "rss" or tag == "{%s}RDF" % NS["rdf"]:
        ch = root.find("channel") if tag == "rss" else root.find("rss1:channel", NS)
        nodes = (ch.findall("item") if tag == "rss" and ch is not None else root.findall("rss1:item", NS))
        for it in nodes:
            imgs = []
            for enc in it.findall("enclosure"):
                if (enc.get("type") or "").startswith("image/") or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", enc.get("url") or "", re.I):
                    imgs.append(enc.get("url"))
            for m in it.findall("media:content", NS) + it.findall("media:group/media:content", NS):
                if (m.get("medium") == "image") or (m.get("type") or "").startswith("image/") or \
                        (not m.get("medium") and not m.get("type") and re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", m.get("url") or "", re.I)):
                    imgs.append(m.get("url"))
            imgs += [m.get("url") for m in it.findall("media:thumbnail", NS)]
            imgs += [m.get("href") for m in it.findall("itunes:image", NS)]
            guid = _t(it.find("guid")) or it.get("{%s}about" % NS["rdf"]) or ""
            x = _item(_t(it.find("title")) if tag == "rss" else _t(it.find("rss1:title", NS)),
                      _t(it.find("link")) if tag == "rss" else _t(it.find("rss1:link", NS)), guid,
                      _t(it.find("pubDate")) or _t(it.find("dc:date", NS)),
                      _t(it.find("description")) if tag == "rss" else _t(it.find("rss1:description", NS)),
                      _t(it.find("content:encoded", NS)),
                      _t(it.find("dc:creator", NS)) or _t(it.find("author")),
                      [_t(c) for c in it.findall("category")] + [_t(c) for c in it.findall("dc:subject", NS)],
                      [u for u in imgs if u], base, now)
            if x:
                items.append(x)
        img = None
        if ch is not None:
            img = _t(ch.find("image/url")) or (ch.find("itunes:image", NS).get("href") if ch.find("itunes:image", NS) is not None else None)
        meta = {"title": _t(ch.find("title")) if ch is not None else None,
                "home": web_url(_t(ch.find("link")) if ch is not None else None, base), "image": https_only(img, base)}
        return meta, _newest(items, now)

    if tag == "{%s}feed" % NS["atom"]:
        def link_of(node):
            best = None
            for l in node.findall("atom:link", NS):
                if l.get("rel") in (None, "", "alternate"):
                    return l.get("href")
                best = best or (l.get("href") if l.get("rel") != "self" else None)
            return best
        for e in root.findall("atom:entry", NS):
            imgs = [m.get("url") for m in e.findall("media:thumbnail", NS)]
            imgs += [m.get("url") for m in e.findall("media:content", NS) if (m.get("medium") == "image") or (m.get("type") or "").startswith("image/")]
            imgs += [m.get("url") for m in e.findall("media:group/media:thumbnail", NS)]
            summ, cont = e.find("atom:summary", NS), e.find("atom:content", NS)
            def markup(node):
                if node is None:
                    return ""
                if node.get("type") == "xhtml":
                    return ET.tostring(node, encoding="unicode", method="html")
                return node.text or ""
            descr = _t(e.find("media:group/media:description", NS))
            x = _item(markup(e.find("atom:title", NS)), link_of(e), _t(e.find("atom:id", NS)),
                      _t(e.find("atom:published", NS)) or _t(e.find("atom:updated", NS)),
                      markup(summ) or html.escape(descr), markup(cont),
                      ", ".join(_t(a.find("atom:name", NS)) for a in e.findall("atom:author", NS)),
                      [c.get("term") or "" for c in e.findall("atom:category", NS)],
                      [u for u in imgs if u], base, now)
            if x:
                items.append(x)
        meta = {"title": text_of(_t(root.find("atom:title", NS)))[0] or None, "home": web_url(link_of(root), base),
                "image": https_only(_t(root.find("atom:logo", NS)) or _t(root.find("atom:icon", NS)), base)}
        return meta, _newest(items, now)

    raise ValueError("not a feed: <%s>" % tag)


def _newest(items: list[dict], now: datetime) -> list[dict]:
    """newest first, one of each, at most PER_READ. A story with no date is dated now, a second apart in the feed's
    own order (which is newest first), so a feed with no dates still reads in its order and pages cleanly; the
    database keeps the first reading's time (news_items_keep_time), so it does not climb the page every read."""
    for k, x in enumerate(i for i in items if not i["published_at"]):
        x["published_at"] = (now - timedelta(seconds=k)).isoformat()
    # AND NEVER TWO AT ONE MOMENT: stories dated only by the day, or all "now", are set a second apart in the feed's
    # order, so the page's "older" (strictly before the last one shown) never steps over one
    taken: dict[str, int] = {}
    for x in items:
        t = x["published_at"]
        k = taken.get(t, 0)
        taken[t] = k + 1
        if k:
            x["published_at"] = (datetime.fromisoformat(t) - timedelta(seconds=k)).isoformat()
    seen, out = set(), []
    for x in sorted(items, key=lambda i: i["published_at"], reverse=True):
        if x["guid"] in seen:
            continue
        seen.add(x["guid"])
        out.append(x)
    return out[:PER_READ]


# -------------------------------------------------------------------------------------------- leagues ---
def fold(text: str | None) -> str:
    """lower case, accents off, letters and digits only, one space between words, a space at each end - so a name
    is found as whole words: ' paok bc ' in ' donatas motiejunas strengthens paok bc '"""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    return " " + " ".join(re.sub(r"[^a-z0-9]+", " ", t).split()) + " "


class LeagueMatcher:
    """THE LEAGUES A STORY IS ABOUT, from what it says. Each league scores, over the story's categories, headline and
    excerpt:
        its own name                    3 in a category, 3 in the headline, 2 in the excerpt
        its short name (slug, 'acb')    3, but only as a whole category - three letters in running text are anything
        each of its clubs, once each    2 in the headline, 1 in a category or the excerpt, 2 at the most
    and a story is about every league that reaches 3 - the three that score most. So one club is never enough
    however often it is named (a city's name is a club's name as often as not, and a club plays in more than one
    league: Dubai in a EuroLeague round-up is not ABA League news); a club and its league are, two clubs of one
    league are, and a category naming the league is. A club in two leagues (the EuroLeague and its own) counts for both. Names too
    common to mean one league ('super league', 'basketball league') never count on their own.

    THE SAME CLUB IN ANOTHER LEAGUE is not always news of that league. A youth or academy league (Liga U, the ABA
    U19 League, the Espoirs, the EABL) is played by the senior clubs' own names, so a club counts for it only in a
    story that names the league; and a women's league shares its club names with the men's, so a club counts for it
    only in a story that says it is about women's basketball. A league is also known by its other names (ALIASES:
    the EuroLeague is the Euroliga in Spain, Liga Endesa the ACB), which count as its name."""
    ALIASES = {
        "euroleague": ["euroliga", "eurolega", "euroleague basketball"],
        "eurocup": ["eurocopa", "7days eurocup", "bkt eurocup"],
        "liga-endesa": ["liga acb", "endesa league"],
        "lega-basket-serie-a": ["legabasket", "lega basket", "serie a basket"],
        "bbl": ["basketball bundesliga"],
        "lnb-elite": ["betclic elite"],
        "greek-elite-league": ["stoiximan gbl", "greek basket league", "basket league greece", "a1 ethniki"],
        "aba-league": ["aba liga", "adriatic league", "admiralbet aba league"],
        "lkl": ["betsafe lkl"],
        "orlen-basket-liga": ["energa basket liga", "polska liga koszykowki"],
        "b-league-premier": ["b league", "b1 league"],
        "kbl": ["korean basketball league"],
        "nbl": ["nbl australia"],
        "estonian-latvian-basketball-league": ["latvian estonian basketball league"],
        "liga-femenina-endesa": ["lf endesa", "liga femenina"],
        "slovak-sbl": ["slovenska basketbalova liga"],
        "lnbp": ["liga nacional de baloncesto profesional"],
        "nbb": ["novo basquete brasil"],
    }
    # letters that are one league's alone in basketball writing, so they count in a headline as its name does (a
    # short name in general counts only as a whole category: 'BBL' is Germany's and Britain's, 'NBL' half the world's)
    ACRONYMS = {"liga-endesa": ["acb"], "lega-basket-serie-a": ["lba"], "greek-elite-league": ["gbl"],
                "orlen-basket-liga": ["plk"], "lkl": ["lkl"], "bnxt-league": ["bnxt"], "estonian-latvian-basketball-league": ["lelb"]}
    JUNIOR = re.compile(r"(^| )(u ?\d{2}|u(?! sports)|espoirs|academy|junior|juniors|youth|juvenil|next gen)( |$)")
    WOMEN_LEAGUE = re.compile(r"(^| )(women|womens|woman|femenina|femminile|feminine|kobiet|naisten|kvinde|damen|frauen|w league|wnbl|weabl|"
                              r"lf|zbl)( |$)")
    WOMEN_WORDS = re.compile(r" (women|womens|woman|female|ladies|femenina|femenino|femminile|feminine|feminin|kobiet|koszykarki|naisten|"
                             r"kvinde|kvinder|damen|frauen|damer|wnba|wnbl|zbl|zeny|zen|moterys|moteru|lf endesa|liga femenina) ")
    GENERIC = {"league", "liga", "lega", "ligue", "basketball", "basket", "super league", "premier league", "basketball league",
               "national basketball league", "first division", "second division", "division 1", "division one", "serie a",
               "serie a2", "a league", "b league", "pro a", "pro b", "cup", "playoffs", "women", "men", "national league",
               "championship", "club", "bc", "bk", "kk", "cb", "fc", "sc", "sk", "ks", "united", "city", "stars", "all stars"}
    CLUB_TAIL = {"bc", "bk", "kk", "cb", "fc", "sc", "sk", "ks", "basket", "basketball", "baloncesto", "pallacanestro", "club"}

    def __init__(self, leagues: list[dict], teams: list[dict]):
        self.phrases: list[tuple[str, str, str]] = []       # (folded phrase, league id, 'league' | 'short' | 'club')
        self.junior: set[str] = set()                       # leagues a club alone never names (see above)
        self.women: set[str] = set()
        seen = set()

        def add(text, lid, kind):
            f = fold(text).strip()
            if not f or f in self.GENERIC or (lid, f, kind) in seen:
                return
            if kind == "acronym":
                if not (2 < len(f) <= 6 and " " not in f):
                    return
                kind = "league"
            elif kind == "league" and len(f) < 5:
                kind = "short"
            if kind == "short" and not (2 < len(f) <= 6 and " " not in f):
                return
            if kind == "club" and len(f) < 5:
                return
            seen.add((lid, f, kind))
            self.phrases.append((f, lid, kind))

        for l in leagues or []:
            lid = str(l.get("id") or "")
            if not lid:
                continue
            add(l.get("name"), lid, "league")
            slug = str(l.get("slug") or "")
            add(slug.replace("-", " "), lid, "league" if "-" in slug else "short")
            for a in self.ALIASES.get(slug, []):
                add(a, lid, "league")
            for a in self.ACRONYMS.get(slug, []):
                add(a, lid, "acronym")
            who = fold(l.get("name")) + " " + fold(slug.replace("-", " "))
            if self.JUNIOR.search(who.strip()):
                self.junior.add(lid)
            if self.WOMEN_LEAGUE.search(who.strip()):
                self.women.add(lid)
        for t in teams or []:
            lid = str(t.get("league_id") or "")
            if not lid:
                continue
            for n in (t.get("name"), t.get("short_name")):
                words = fold(n).split()
                while words and words[-1] in self.CLUB_TAIL:        # "PAOK BC" is also "PAOK"
                    words = words[:-1]
                while words and words[0] in self.CLUB_TAIL:         # "FC Barcelona" is also "Barcelona"
                    words = words[1:]
                add(n, lid, "club")
                if words:
                    add(" ".join(words), lid, "club")
                    if len(words) > 1 and len(words[0]) >= 7:        # "Olympiacos Piraeus" is also "Olympiacos"
                        add(words[0], lid, "club")

    def match(self, title: str | None, summary: str | None, tags: list[str] | None) -> list[str]:
        T, S = fold(title), fold(summary)
        G = [fold(t) for t in (tags or [])]
        score: dict[str, float] = {}
        clubs: dict[str, set] = {}
        womens = bool(self.WOMEN_WORDS.search(" " + T + " " + S + " " + " ".join(G) + " "))
        for f, lid, kind in self.phrases:
            needle = " " + f + " "
            if kind == "short":
                if any(g.strip() == f for g in G):
                    score[lid] = score.get(lid, 0) + 3
                continue
            in_tag = any(needle in g for g in G)
            in_title, in_sum = needle in T, needle in S
            if not (in_tag or in_title or in_sum):
                continue
            if kind == "league":
                score[lid] = score.get(lid, 0) + (3 if in_tag else 0) + (3 if in_title else 0) + (2 if in_sum else 0)
            else:
                if lid in self.junior or (lid in self.women and not womens):
                    continue                                         # the senior men's club, most likely: see above
                named = clubs.setdefault(lid, set())
                club = f.split()[0]
                if club in named:                                    # "Olympiacos" and "Olympiacos Piraeus": one club
                    continue
                named.add(club)
                score[lid] = score.get(lid, 0) + min(2, (2 if in_title else 0) + (1 if in_tag else 0) + (1 if in_sum else 0))
        top = sorted(((v, k) for k, v in score.items() if v >= 3), key=lambda x: (-x[0], x[1]))
        return [k for _, k in top[:3]]


# ------------------------------------------------------------------------------------------- the logo ---
# A PUBLISHER'S OWN MARK, found on its own site once and kept (news_sources.logo_url): the icon it gives phones
# (apple-touch-icon, the web app manifest's icons, Windows' tile), then its other icons, then the feed's own
# picture - each one read to see it is a picture at all and how big it really is. The card draws it on a disc up to
# 132 px across, so a 16 px favicon is no logo: under LOGO_MIN it is left, and the card prints the initials in the
# publisher's colour instead. Tried again a week later when nothing was found (logo_checked_at).
LOGO_MIN = 64
LOGO_EVERY = timedelta(days=7)
LOGO_BYTES = 2 * 1024 * 1024


class _HeadTags(HTMLParser):
    """the <link> and <meta> tags before <body>: where a page names its icons and its manifest"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self.metas: list[dict] = []
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            self.links.append(a)
        elif tag == "meta":
            self.metas.append(a)
        elif tag == "body":
            self.done = True


def _declared(sizes: str | None, url: str) -> int:
    """the largest size a tag or a file name declares: sizes="180x180 32x32", ...-192x192.png; 0 when none"""
    best = 0
    for w, h in re.findall(r"(\d{2,4})\s*[xX×]\s*(\d{2,4})", (sizes or "") + " " + (url or "")):
        best = max(best, min(int(w), int(h)))
    return best


def logo_candidates(page: str, page_url: str, feed_image: str | None = None) -> tuple[list[tuple[int, str]], str | None]:
    """([(rank, https url)] best first, the manifest's address) from a home page's head. The rank is the size the
    page claims, with the phone icons (drawn for exactly this: a square mark on its own) ahead of any size the same."""
    p = _HeadTags()
    try:
        p.feed(page[:400000])
    except Exception:
        pass
    out: list[tuple[int, str]] = []
    manifest = None
    for a in p.links:
        rel = " " + a.get("rel", "").lower() + " "
        href = a.get("href", "").strip()
        if not href or href.startswith("data:"):
            continue
        u = https_only(href, page_url)
        if " manifest " in rel:
            manifest = urllib.parse.urljoin(page_url, href)
            continue
        if not u or " mask-icon " in rel:                        # Safari's one-colour stencil: no logo
            continue
        size = _declared(a.get("sizes"), u)
        svg = a.get("type", "").lower() == "image/svg+xml" or re.search(r"\.svg(\?|$)", u, re.I)
        if " apple-touch-icon " in rel or " apple-touch-icon-precomposed " in rel:
            out.append(((size or 180) + 2000, u))
        elif " icon " in rel:
            if svg or (a.get("sizes", "").lower() == "any"):
                out.append((1512, u))                           # drawn, so any size: after the phone icons
            elif re.search(r"\.ico(\?|$)", u, re.I):
                out.append((size or 32, u))
            else:
                out.append(((size or 32) + 500, u))
    for a in p.metas:
        if a.get("name", "").lower() == "msapplication-tileimage":
            u = https_only(a.get("content", ""), page_url)
            if u:
                out.append((_declared(None, u) or 144, u))
    if feed_image:
        u = https_only(feed_image, page_url)
        if u:
            out.append((_declared(None, u) or 100, u))
    seen, uniq = set(), []
    for r, u in sorted(out, key=lambda x: -x[0]):
        if u not in seen:
            seen.add(u)
            uniq.append((r, u))
    return uniq, manifest


def manifest_icons(body: bytes, manifest_url: str) -> list[tuple[int, str]]:
    """a web app manifest's icons, [(rank, https url)]: the plain ones ahead of the maskable (which are padded)"""
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return []
    out = []
    for ic in (j.get("icons") or []) if isinstance(j, dict) else []:
        if not isinstance(ic, dict):
            continue
        u = https_only(ic.get("src"), manifest_url)
        if not u:
            continue
        size = _declared(ic.get("sizes"), u) or (512 if "svg" in str(ic.get("type", "")) else 0)
        plain = "any" in str(ic.get("purpose") or "any").split()
        out.append((size + (2000 if plain else 1000), u))
    return sorted(out, key=lambda x: -x[0])


def image_size(body: bytes, ctype: str) -> int | None:
    """the smaller side of a picture, read from its header: PNG, GIF, ICO (its largest), JPEG, WebP; an SVG is
    any size (999); None when this is not a picture at all"""
    d = image_dims(body, ctype)
    return min(d) if d else None


def image_dims(body: bytes, ctype: str = "") -> tuple[int, int] | None:
    """(width, height) from a picture's header, as image_size reads it; an SVG is (999, 999)"""
    b = body or b""
    if b[:8] == b"\x89PNG\r\n\x1a\n" and len(b) >= 24:
        return int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")
    if b[:6] in (b"GIF87a", b"GIF89a") and len(b) >= 10:
        return int.from_bytes(b[6:8], "little"), int.from_bytes(b[8:10], "little")
    if b[:4] == b"\x00\x00\x01\x00" and len(b) >= 6:                  # ICO: a directory of images
        n, best = int.from_bytes(b[4:6], "little"), 0
        for i in range(min(n, 32)):
            e = 6 + 16 * i
            if len(b) < e + 16:
                break
            w, h = b[e] or 256, b[e + 1] or 256
            best = max(best, min(w, h))
        return (best, best) if best else None
    if b[:3] == b"\xff\xd8\xff":                                         # JPEG: the first frame header
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                i += 1
                continue
            m = b[i + 1]
            if m in (0xC0, 0xC1, 0xC2, 0xC3):
                return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
            i += 2 + int.from_bytes(b[i + 2:i + 4], "big")
        return None
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP" and len(b) >= 30:
        if b[12:16] == b"VP8X":
            return int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1
        if b[12:16] == b"VP8 ":
            return int.from_bytes(b[26:28], "little") & 0x3FFF, int.from_bytes(b[28:30], "little") & 0x3FFF
        if b[12:16] == b"VP8L" and len(b) >= 25:
            v = int.from_bytes(b[21:25], "little")
            return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
        return None
    head = b[:512].lstrip().lower()
    if "svg" in (ctype or "").lower() or head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in b[:2048].lower()):
        return 999, 999
    return None


def _unfilter(raw: bytes, w: int, h: int, bpp: int) -> list[bytearray] | None:
    """a PNG's decompressed scanlines, their filters undone"""
    stride = w * bpp
    if len(raw) < h * (stride + 1):
        return None
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                cur[i] = (cur[i] + ((cur[i - bpp] if i >= bpp else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                cur[i] = (cur[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            return None
        rows.append(cur)
        prev = cur
    return rows


def fills_square(body: bytes) -> bool:
    """a SQUARE picture with nothing see-through in its corners - a phone icon, a square badge on its own ground - so
    the card can draw it to the edge of its disc; a logo with a clear ground, or a wordmark, stays on the white disc. A JPEG has no clear
    ground; a PNG is read (8-bit, not interlaced; anything else is said not to fill, which only costs a margin)."""
    b = body or b""
    d = image_dims(b)
    if not d or abs(d[0] - d[1]) > 0.08 * max(d):
        return False                                                  # a wordmark, not a square: it keeps its margin
    if b[:3] == b"\xff\xd8\xff":
        return True
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    import zlib
    pos, w, h, depth, ctype, lace, trns, idat = 8, 0, 0, 0, 0, 0, None, []
    while pos + 8 <= len(b):
        ln = int.from_bytes(b[pos:pos + 4], "big")
        typ, data = b[pos + 4:pos + 8], b[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, depth, ctype, lace = int.from_bytes(data[0:4], "big"), int.from_bytes(data[4:8], "big"), data[8], data[9], data[12]
        elif typ == b"tRNS":
            trns = data
        elif typ == b"IDAT":
            idat.append(data)
        elif typ == b"IEND":
            break
    if ctype in (0, 2) and trns is None:
        return True                                                   # no transparency at all
    if depth != 8 or lace or not w or not h or w * h > 1100 * 1100 or ctype not in (3, 4, 6):
        return False
    bpp = {3: 1, 4: 2, 6: 4}[ctype]
    try:
        rows = _unfilter(zlib.decompress(b"".join(idat)), w, h, bpp)
    except Exception:
        return False
    if not rows:
        return False
    def alpha(x, y):
        px = rows[y][x * bpp:(x + 1) * bpp]
        if ctype == 3:
            return trns[px[0]] if trns is not None and px[0] < len(trns) else 255
        return px[-1]
    inset = max(0, min(w, h) // 25)                                  # a hair in from the very corner (a rounded icon)
    return all(alpha(x, y) >= 250 for x in (inset, w - 1 - inset) for y in (inset, h - 1 - inset))


def find_logo(site_url: str, fetch, feed_image: str | None = None, log=lambda *_: None) -> str | None:
    """the publisher's logo, an https address of a picture at least LOGO_MIN across, or None; ending #fill when it
    fills its square (fills_square), which the card reads to draw it to the edge of its disc. fetch(url) ->
    (status, body, headers), as http_page."""
    home = web_url(site_url, site_url)
    if not home:
        return None
    cands: list[tuple[int, str]] = []
    manifest = None
    try:
        st, body, h = fetch(home)
        if st == 200:
            cands, manifest = logo_candidates(body.decode("utf-8", "replace"), home, feed_image)
    except Exception as e:
        log("    (the home page could not be read for its logo: %s)" % e)
        if feed_image and https_only(feed_image, home):
            cands = [(_declared(None, feed_image) or 100, https_only(feed_image, home))]
    if manifest:
        try:
            st, body, h = fetch(manifest)
            if st == 200:
                cands = sorted(cands + manifest_icons(body, manifest), key=lambda x: -x[0])
        except Exception:
            pass
    root = urllib.parse.urljoin(home, "/apple-touch-icon.png")
    if root.startswith("https://") and not any(u == root for _, u in cands):
        cands.append((1900, root))                                  # the address phones ask for when a page names none
        cands.sort(key=lambda x: -x[0])
    best = None
    for _, u in cands[:6]:
        try:
            st, body, h = fetch(u)
        except Exception:
            continue
        if st != 200:
            continue
        size = image_size(body, h.get("content-type", ""))
        if size is None:
            continue                                                # an error page, not a picture
        if size >= LOGO_MIN:
            return u + ("#fill" if fills_square(body) else "")
        if best is None or size > best[0]:
            best = (size, u)
    if best:
        log("    (the largest mark on the site is %d px: too small to be the logo)" % best[0])
    return None


# --------------------------------------------------------------------------------------------- the web ---
def http_page(url: str) -> tuple[int, bytes, dict]:
    """(status, body, headers) for a page or a picture, at most LOGO_BYTES"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,image/*,application/manifest+json,*/*;q=0.5",
                                               "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        raw = r.read(LOGO_BYTES + 1)
        if len(raw) > LOGO_BYTES:
            raise ValueError("larger than %d MB" % (LOGO_BYTES // 1048576))
        if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return r.status, raw, {k.lower(): v for k, v in r.headers.items()}


def http_get(url: str, etag: str | None = None, modified: str | None = None) -> tuple[int, bytes, dict]:
    """(status, body, headers) - 304 with an empty body when nothing has changed"""
    h = {"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.5",
         "Accept-Encoding": "gzip"}
    if etag:
        h["If-None-Match"] = etag
    if modified:
        h["If-Modified-Since"] = modified
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            raw = r.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("larger than %d MB" % (MAX_BYTES // 1048576))
            if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, b"", {k.lower(): v for k, v in e.headers.items()}
        raise


class Supabase:
    """the service key's REST, for the three tables this writes"""

    def __init__(self, url: str, key: str):
        self.url, self.key = url.rstrip("/"), key

    def _req(self, method, path, body=None, headers=None):
        h = {"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + "/rest/v1/" + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8") or "null"
            return json.loads(txt), {k.lower(): v for k, v in r.headers.items()}

    def sources(self, only: str | None = None) -> list[dict]:
        q = "news_sources?enabled=eq.true&select=id,name,feed_url,site_url,logo_url,logo_checked_at,etag,last_modified&order=name"
        if only:
            q += "&id=eq." + urllib.parse.quote(only)
        return self._req("GET", q)[0] or []

    def leagues(self) -> list[dict]:
        return self._req("GET", "leagues?select=id,name,slug")[0] or []

    def teams(self) -> list[dict]:
        out: list[dict] = []
        for off in range(0, 20000, 1000):
            page = self._req("GET", "teams?select=league_id,name,short_name&league_id=not.is.null&order=id&offset=%d&limit=1000" % off)[0] or []
            out += page
            if len(page) < 1000:
                break
        return out

    def upsert_items(self, rows: list[dict]) -> None:
        if rows:
            self._req("POST", "news_items?on_conflict=source_id,guid", rows,
                      {"Prefer": "resolution=merge-duplicates,return=minimal"})

    def prune(self, source_id: str, before: datetime) -> None:
        self._req("DELETE", "news_items?source_id=eq.%s&published_at=lt.%s" % (source_id, urllib.parse.quote(before.isoformat())),
                  None, {"Prefer": "return=minimal"})

    def count(self, source_id: str) -> int:
        _, h = self._req("GET", "news_items?source_id=eq.%s&select=id&limit=1" % source_id, None, {"Prefer": "count=exact"})
        tail = (h.get("content-range") or "").split("/")[-1]
        return int(tail) if tail.isdigit() else 0

    def mark(self, source_id: str, fields: dict) -> None:
        self._req("PATCH", "news_sources?id=eq.%s" % source_id, fields, {"Prefer": "return=minimal"})


# ------------------------------------------------------------------------------------------------ a run ---
def _when_iso(v: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else None
    except ValueError:
        return None


def run(db, get=http_get, dry_run: bool = False, only: str | None = None, log=print, now=None, sleep=time.sleep,
        page=http_page) -> dict:
    now_f = now or (lambda: datetime.now(timezone.utc))
    done = {"read": 0, "unchanged": 0, "failed": 0, "items": 0, "tagged": 0, "logos": 0}
    try:
        matcher = LeagueMatcher(db.leagues(), db.teams())
    except Exception as e:                                     # no leagues to hand: the stories go in untagged
        log("  (the leagues could not be read, so no story is matched to one: %s)" % e)
        matcher = LeagueMatcher([], [])
    for i, s in enumerate(db.sources(only)):
        if i:
            sleep(GAP_S)
        t = now_f()
        mark = {"last_fetched_at": t.isoformat()}
        meta = {}
        try:
            status, body, headers = get(s["feed_url"], s.get("etag"), s.get("last_modified"))
            if status == 304:
                done["unchanged"] += 1
                mark.update({"last_ok_at": t.isoformat(), "last_error": None})
                log("  = %s: unchanged" % s["name"])
            else:
                meta, items = parse_feed(body, s["feed_url"], t)
                rows = [dict(x, source_id=s["id"], fetched_at=t.isoformat(),
                             league_ids=matcher.match(x["title"], x["summary"], x["tags"])) for x in items]
                done["tagged"] += sum(1 for r in rows if r["league_ids"])
                if not dry_run:
                    db.upsert_items(rows)
                    db.prune(s["id"], t - timedelta(days=KEEP_DAYS))
                mark.update({"last_ok_at": t.isoformat(), "last_error": None,
                             "etag": headers.get("etag"), "last_modified": headers.get("last-modified")})
                done["read"] += 1
                done["items"] += len(rows)
                log("  + %s: %d items%s" % (s["name"], len(rows), (", newest " + rows[0]["title"][:60]) if rows else ""))
            if not dry_run:
                mark["item_count"] = db.count(s["id"])
        except Exception as e:                                 # this source's trouble, and nobody else's
            done["failed"] += 1
            mark["last_error"] = clip(("%s: %s" % (type(e).__name__, e)), 300)
            log("  ! %s: %s" % (s["name"], mark["last_error"]))
        # ITS LOGO, found on its own site when it has none: once, then again a week later if nothing was found.
        # A logo somebody set is never touched.
        checked = _when_iso(s.get("logo_checked_at"))
        if not s.get("logo_url") and (checked is None or t - checked >= LOGO_EVERY):
            try:
                logo = find_logo(s.get("site_url") or s["feed_url"], page, meta.get("image"), log)
            except Exception as e:
                logo = None
                log("    (no logo: %s)" % e)
            mark["logo_checked_at"] = t.isoformat()
            if logo:
                mark["logo_url"] = logo
                done["logos"] += 1
                log("    logo: %s" % logo)
        if not dry_run:
            try:
                db.mark(s["id"], mark)
            except Exception as e:
                log("  ! %s: could not record the read: %s" % (s["name"], e))
    log("news sources: %(read)d read, %(unchanged)d unchanged, %(failed)d failed, %(items)d items (%(tagged)d about a league), "
        "%(logos)d logos found" % done)
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source")
    a = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("no SUPABASE_URL / SUPABASE_SERVICE_KEY: nothing to do")
        return 0
    run(Supabase(url, key), dry_run=a.dry_run, only=a.source)
    return 0


if __name__ == "__main__":
    sys.exit(main())
