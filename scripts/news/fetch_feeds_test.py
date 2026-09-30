"""The news sources' reader, offline:

    python scripts/news/fetch_feeds_test.py

What this holds:
  * RSS 2.0, RSS 1.0, Atom and JSON Feed are read to the same item: its headline and a plain-text excerpt (no
    markup, entities read, WordPress's "The post ... appeared first on ..." gone, at most 320 characters), its
    address (made absolute), its picture (enclosure, media, itunes, or the first <img>; https only), its author,
    its categories and its date (RFC 822 or ISO 8601; a date in the future is now);
  * the newest first, each once, forty at the most; an HTML page is not a feed;
  * a run: every enabled source read with its last ETag and Last-Modified, a 304 costs nothing, the items written
    with their source, each source's read recorded (and its picture taken from the feed when it has none), one
    source failing never stopping the next, and a dry run writing nothing.
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_feeds as F  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)

RSS = b"""<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>Hoops Site</title><link>https://hoops.example</link><image><url>https://hoops.example/logo.png</url></image>
<item><title>Big &amp; bold: a &#8216;signing&#8217;</title><link>/news/1</link><guid isPermaLink="false">https://hoops.example/?p=1</guid>
<pubDate>Wed, 30 Sep 2026 10:08:40 +0000</pubDate><dc:creator>A Writer</dc:creator><category>EuroLeague</category><category>Transfers</category>
<description><![CDATA[<p>The club has <b>signed</b> a centre.</p><script>alert(1)</script> The post Big &amp; bold appeared first on Hoops Site.]]></description>
<enclosure url="https://img.example/1.jpg" length="1" type="image/jpeg"/></item>
<item><title>Second</title><link>https://hoops.example/news/2</link><pubDate>Tue, 29 Sep 2026 09:00:00 GMT</pubDate>
<description>Plain words.</description><media:content url="http://img.example/insecure.jpg" medium="image"/>
<content:encoded><![CDATA[<p>Body</p><img src="https://img.example/2.jpg"/>]]></content:encoded></item>
<item><title>Future</title><link>https://hoops.example/news/3</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Twice</title><link>https://hoops.example/news/1b</link><guid>https://hoops.example/?p=1</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title></title><link>https://hoops.example/news/empty</link></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<title>A Channel</title><link rel="alternate" href="https://www.youtube.com/channel/UC1"/><logo>https://yt.example/logo.jpg</logo>
<entry><id>yt:video:abc</id><title>Highlights: Game 3</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
<published>2026-09-29T18:00:00+00:00</published><author><name>The Channel</name></author>
<media:group><media:thumbnail url="https://i.ytimg.com/vi/abc/hqdefault.jpg"/><media:description>Every bucket from game three.</media:description></media:group></entry>
<entry><id>tag:x,2026:2</id><title type="html">&lt;b&gt;Bold&lt;/b&gt; title</title><link href="https://x.example/2"/><updated>2026-09-28T08:00:00Z</updated>
<summary type="html">&lt;p&gt;An &amp;amp; excerpt&lt;/p&gt;</summary><category term="NBA"/></entry>
</feed>"""

RDF = b"""<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://old.example"><title>Old</title><link>https://old.example</link></channel>
<item rdf:about="https://old.example/a"><title>Old style</title><link>https://old.example/a</link><description>Words</description><dc:date>2026-09-27T10:00:00Z</dc:date></item>
</rdf:RDF>"""

JSONF = b"""{"version":"https://jsonfeed.org/version/1.1","title":"J","home_page_url":"https://j.example","items":[
{"id":"1","url":"https://j.example/1","title":"From JSON","content_text":"Text <b>not</b> markup","image":"https://j.example/1.png",
 "date_published":"2026-09-26T10:00:00Z","authors":[{"name":"J Writer"}],"tags":["a","b"]}]}"""

print("\nreading a feed")
meta, items = F.parse_feed(RSS, "https://hoops.example/feed/", NOW)
first = next(x for x in items if x["guid"] == "https://hoops.example/?p=1")
ok("RSS: the feed's own name, home and picture", meta == {"title": "Hoops Site", "home": "https://hoops.example", "image": "https://hoops.example/logo.png"}, meta)
ok("...a headline with its entities read", first["title"] == "Big & bold: a ‘signing’", first["title"])
ok("...an excerpt of plain words: no markup, no script, no WordPress tail", first["summary"] == "The club has signed a centre.", first["summary"])
ok("...its address made absolute, its guid, author, categories and picture",
   first["url"] == "https://hoops.example/news/1" and first["guid"] == "https://hoops.example/?p=1" and first["author"] == "A Writer" and
   first["tags"] == ["EuroLeague", "Transfers"] and first["image_url"] == "https://img.example/1.jpg", first)
second = next(x for x in items if x["title"] == "Second")
ok("an http picture is passed over for the https one in the text", second["image_url"] == "https://img.example/2.jpg", second["image_url"])
fut = next(x for x in items if x["title"] == "Future")
ok("a date in the future is now", fut["published_at"] == NOW.isoformat(), fut["published_at"])
ok("a date in numbers: month first (9/30/2026, FEB's), day first when it must be (30.09.2026), a day alone at its noon, with a time and AM/PM",
   F.when("9/29/2026", NOW).isoformat() == "2026-09-29T12:00:00+00:00" and F.when("28.09.2026", NOW).isoformat() == "2026-09-28T12:00:00+00:00" and
   F.when("9/29/2026 3:05:00 PM", NOW).isoformat() == "2026-09-29T15:05:00+00:00" and F.when("13/13/2026", NOW) is None,
   [str(F.when(x, NOW)) for x in ("9/29/2026", "28.09.2026", "9/29/2026 3:05:00 PM", "13/13/2026")])
ok("...and a day with no time that is today is as new as the read that found it", F.when(NOW.strftime("%-m/%-d/%Y"), NOW) == NOW)
FEB = b"""<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>FEB</title><link>https://www.feb.es</link>
<item><title>Uno</title><link>https://www.feb.es/2026/9/29/a/1.aspx</link><description>Primera.</description><pubDate>9/29/2026</pubDate>
<media:content format="XL" url="https://www.feb.es/Imagenes/1_1.jpg" /><media:content format="S" url="https://www.feb.es/Imagenes/1_4.jpg" /></item>
<item><title>Dos</title><link>https://www.feb.es/2026/9/29/a/2.aspx</link><description>Segunda.</description><pubDate>9/29/2026</pubDate></item>
<item><title>Tres</title><link>https://www.feb.es/2026/9/28/a/3.aspx</link><description>Tercera.</description><pubDate>9/28/2026</pubDate></item></channel></rss>"""
_, feb = F.parse_feed(FEB, "https://www.feb.es/Servicios/RSS.ASPX?c=5", NOW)
ok("a feed dated by the day (FEB): in its order, a second apart within a day, and its picture from media:content by the file's name",
   [x["title"] for x in feb] == ["Uno", "Dos", "Tres"] and len({x["published_at"] for x in feb}) == 3 and
   feb[0]["published_at"].startswith("2026-09-29T12:00:00") and feb[1]["published_at"].startswith("2026-09-29T11:59:59") and
   feb[0]["image_url"] == "https://www.feb.es/Imagenes/1_1.jpg", [(x["title"], x["published_at"], x["image_url"]) for x in feb])
UNDATED = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>No dates</title><link>https://nd.example</link>
<item><title>Top of the feed</title><link>https://nd.example/3</link></item>
<item><title>Middle</title><link>https://nd.example/2</link></item>
<item><title>Bottom</title><link>https://nd.example/1</link></item></channel></rss>"""
_, nd = F.parse_feed(UNDATED, "https://nd.example/feed", NOW)
ok("a feed with no dates reads in its own order, a second apart, never tied (the page pages on the time)",
   [x["title"] for x in nd] == ["Top of the feed", "Middle", "Bottom"] and len({x["published_at"] for x in nd}) == 3 and
   nd[0]["published_at"] == NOW.isoformat(), [(x["title"], x["published_at"]) for x in nd])
ok("the newest first, each guid once, an item with no headline left out",
   [x["title"] for x in items] == ["Future", "Big & bold: a ‘signing’", "Second"], [x["title"] for x in items])
m2, a = F.parse_feed(ATOM, "https://www.youtube.com/feeds/videos.xml?channel_id=UC1", NOW)
ok("Atom (a YouTube channel's): the alternate link, the thumbnail, the description, the author",
   a[0]["url"] == "https://www.youtube.com/watch?v=abc" and a[0]["image_url"] == "https://i.ytimg.com/vi/abc/hqdefault.jpg" and
   a[0]["summary"] == "Every bucket from game three." and a[0]["author"] == "The Channel" and m2["image"] == "https://yt.example/logo.jpg", a[0])
ok("...an html title and summary read as words", a[1]["title"] == "Bold title" and a[1]["summary"] == "An & excerpt" and a[1]["tags"] == ["NBA"], a[1])
_, r = F.parse_feed(RDF, "https://old.example/rss", NOW)
ok("RSS 1.0 (RDF)", len(r) == 1 and r[0]["title"] == "Old style" and r[0]["published_at"].startswith("2026-09-27T10:00"), r)
m4, j = F.parse_feed(JSONF, "https://j.example/feed.json", NOW)
ok("JSON Feed: text kept as text, picture, authors, tags", j[0]["summary"] == "Text <b>not</b> markup" and j[0]["image_url"] == "https://j.example/1.png" and
   j[0]["author"] == "J Writer" and j[0]["tags"] == ["a", "b"] and m4["home"] == "https://j.example", j[0])
try:
    F.parse_feed(b"<!doctype html><html><body>not a feed</body></html>", "https://x.example/", NOW)
    ok("an HTML page is not a feed", False)
except ValueError:
    ok("an HTML page is not a feed", True)
long = F.clip("word " * 200, 320)
ok("an excerpt is at most 320 characters, cut at a word", len(long) <= 320 and long.endswith("…") and not long.endswith(" …"), long[-20:])


print("\nwhich leagues a story is about")
LG = [{"id": "EL", "name": "EuroLeague", "slug": "euroleague"}, {"id": "EC", "name": "EuroCup", "slug": "eurocup"},
      {"id": "GR", "name": "Stoiximan GBL", "slug": "gbl"}, {"id": "ES", "name": "Liga Endesa", "slug": "acb"},
      {"id": "UK", "name": "Super League Basketball", "slug": "slb"}, {"id": "AU", "name": "National Basketball League", "slug": "nbl"}]
TM = [{"league_id": "EL", "name": "Olympiacos Piraeus", "short_name": "OLY"}, {"league_id": "GR", "name": "Olympiacos Piraeus", "short_name": "OLY"},
      {"league_id": "EL", "name": "Panathinaikos AKTOR Athens", "short_name": "PAO"}, {"league_id": "GR", "name": "Panathinaikos", "short_name": "PAO"},
      {"league_id": "GR", "name": "PAOK BC", "short_name": "PAOK"}, {"league_id": "EC", "name": "PAOK BC", "short_name": "PAOK"},
      {"league_id": "EL", "name": "Real Madrid", "short_name": "RMB"}, {"league_id": "ES", "name": "Real Madrid", "short_name": "RMB"},
      {"league_id": "ES", "name": "FC Barcelona", "short_name": "FCB"}, {"league_id": "EL", "name": "FC Barcelona", "short_name": "FCB"},
      {"league_id": "UK", "name": "London Lions", "short_name": "LON"}]
M = F.LeagueMatcher(LG, TM)
ok("a category naming the league is enough", M.match("Donatas Motiejunas officially strengthens PAOK", "The Lithuanian has signed a one-year contract.",
                                                      ["BKT EuroCup", "donatas motiejunas", "PAOK BC"]) == ["EC"], M.match("Donatas Motiejunas officially strengthens PAOK", "", ["BKT EuroCup", "PAOK BC"]))
ok("two clubs in the headline: every league they are both in", sorted(M.match("Olympiacos beat Panathinaikos in the derby", "", [])) == ["EL", "GR"],
   M.match("Olympiacos beat Panathinaikos in the derby", "", []))
ok("a league's own name in the headline, accents and case as they come", M.match("The EUROLEAGUE's best guards", "", []) == ["EL"] and
   M.match("Crónica: la Liga Endesa arranca", "", []) == ["ES"])
ok("one club named once is not enough (a city is a club's name as often as not)", M.match("Real Madrid signs a guard", "", []) == [] and
   M.match("A night out in London", "The Lions of the zoo", []) == [])
ok("one club however often it is named: still not enough (Dubai in a EuroLeague round-up is not ABA League news)",
   M.match("Real Madrid wins again", "Real Madrid were too good.", ["Real Madrid"]) == [])
ok("...a club with its league is", M.match("Real Madrid signs a guard", "The Liga Endesa side moved quickly.", []) == ["ES"],
   M.match("Real Madrid signs a guard", "The Liga Endesa side moved quickly.", []))
ok("a short name counts only as a whole category", M.match("The ACB's new rules", "", ["ACB"]) == ["ES"] and M.match("acb news today", "", []) == [])
ok("a name too common to mean one league never counts on its own", M.match("Super League round-up", "", ["National Basketball League"]) == [],
   M.match("Super League round-up", "", ["National Basketball League"]))
ok("nothing about any league: none", M.match("Motor racing results", "Nothing here.", ["F1"]) == [])
LG2 = [{"id": "EL", "name": "EuroLeague", "slug": "euroleague"}, {"id": "ES", "name": "Liga Endesa", "slug": "liga-endesa"},
       {"id": "LU", "name": "Liga U", "slug": "liga-u"}, {"id": "LF", "name": "Liga Femenina Endesa", "slug": "liga-femenina-endesa"},
       {"id": "US", "name": "U SPORTS", "slug": "u-sports"}, {"id": "ZB", "name": "Chance ŽBL", "slug": "czech-zbl"}]
TM2 = [{"league_id": l, "name": n, "short_name": None} for l, n in
       [("EL", "Real Madrid"), ("EL", "FC Barcelona"), ("ES", "Real Madrid"), ("ES", "FC Barcelona"), ("ES", "Valencia Basket"),
        ("LU", "Real Madrid"), ("LU", "FC Barcelona"), ("LF", "Valencia Basket"), ("LF", "Perfumerias Avenida"),
        ("US", "Carleton Ravens"), ("US", "Ottawa Gee-Gees")]]
M2 = F.LeagueMatcher(LG2, TM2)
ok("a league by its other names (the Euroliga), and a youth league never by its clubs alone (Real Madrid's U-team is not the story)",
   sorted(M2.match("Qué ha pasado en la Euroliga: Real Madrid y Barcelona caen fuera de casa", "", [])) == ["EL", "ES"],
   M2.match("Qué ha pasado en la Euroliga: Real Madrid y Barcelona caen fuera de casa", "", []))
ok("a women's league by its clubs only when the story says it is women's basketball; the men's league otherwise",
   M2.match("Valencia Basket y Real Madrid, duelo en la cumbre", "", []) == ["ES"] and
   M2.match("Liga Femenina: Valencia Basket y Perfumerías Avenida, duelo en la cumbre", "", []) == ["LF"] and
   M2.match("Valencia Basket beat Perfumerias Avenida in the women's final", "", []) == ["LF"],
   [M2.match("Valencia Basket y Real Madrid, duelo en la cumbre", "", []), M2.match("Liga Femenina: Valencia Basket y Perfumerías Avenida, duelo en la cumbre", "", [])])
ok("letters that are one league's alone count in a headline (the ACB); 'U SPORTS' is no youth league; ŽBL is a women's league",
   M2.match("La ACB aprueba el nuevo calendario", "", []) == ["ES"] and M2.match("Carleton Ravens beat Ottawa Gee-Gees", "", []) == ["US"] and
   "ZB" in M2.women and "LU" in M2.junior and "US" not in M2.junior, [M2.match("La ACB aprueba el nuevo calendario", "", []), sorted(M2.women), sorted(M2.junior)])


class FakeDb:
    def __init__(self, sources):
        self.src, self.rows, self.marks, self.pruned = sources, [], {}, []

    def leagues(self):
        return [{"id": "EL", "name": "EuroLeague", "slug": "euroleague"}]

    def teams(self):
        return []

    def sources(self, only=None):
        return [s for s in self.src if not only or s["id"] == only]

    def upsert_items(self, rows):
        self.rows += rows

    def prune(self, sid, before):
        self.pruned.append(sid)

    def count(self, sid):
        return len([r for r in self.rows if r["source_id"] == sid])

    def mark(self, sid, fields):
        self.marks[sid] = fields

    def feed_taken(self, feed, league, but):
        return getattr(self, "taken", {}).get(feed)


print("\na publisher's logo")
def png(w, h):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + w.to_bytes(4, "big") + h.to_bytes(4, "big") + b"\x08\x06\x00\x00\x00" + b"\x00" * 20
def ico(*sizes):
    d = b"\x00\x00\x01\x00" + len(sizes).to_bytes(2, "little")
    return d + b"".join(bytes([sz % 256, sz % 256, 0, 0]) + b"\x00" * 12 for sz in sizes)
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\xff\xc0\x00\x11\x08" + (300).to_bytes(2, "big") + (400).to_bytes(2, "big") + b"\x03" + b"\x00" * 12
ok("a picture's real size is read from its header: PNG, ICO (its largest), JPEG, GIF, SVG",
   F.image_size(png(180, 180), "image/png") == 180 and F.image_size(ico(16, 32, 48), "image/x-icon") == 48 and
   F.image_size(JPG, "image/jpeg") == 300 and F.image_size(b"GIF89a" + (120).to_bytes(2, "little") + (90).to_bytes(2, "little"), "image/gif") == 90 and
   F.image_size(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml") == 999 and F.image_size(ico(0), "") == 256,
   [F.image_size(png(180, 180), ""), F.image_size(ico(16, 32, 48), ""), F.image_size(JPG, "")])
ok("...and an error page is no picture", F.image_size(b"<!doctype html><html>not found</html>", "text/html") is None)
HOME = """<!doctype html><html><head><title>Hoops</title>
<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" sizes="32x32" href="/fav-32.png">
<link rel="mask-icon" href="/safari.svg" color="#000"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="http://hoops.example/insecure.png" sizes="512x512"><link rel="manifest" href="/site.webmanifest">
<meta name="msapplication-TileImage" content="/mstile-144x144.png"></head><body><link rel="icon" href="/late.png"></body></html>"""
cands, man = F.logo_candidates(HOME, "https://hoops.example/")
ok("the page's marks, best first: the phone icon, then Windows' tile, then the sized icon; never the one-colour stencil, "
   "an http address, or anything after <body>",
   [u for _, u in cands] == ["https://hoops.example/apple-touch-icon.png", "https://hoops.example/fav-32.png",
                             "https://hoops.example/mstile-144x144.png", "https://hoops.example/favicon.ico"] and
   man == "https://hoops.example/site.webmanifest", cands)
MANIFEST = b'{"icons":[{"src":"/m-512.png","sizes":"512x512","purpose":"maskable"},{"src":"/a-192.png","sizes":"192x192"}]}'
ok("the manifest's icons: the plain ones ahead of the padded (maskable) ones",
   [u for _, u in F.manifest_icons(MANIFEST, "https://hoops.example/site.webmanifest")] == ["https://hoops.example/a-192.png", "https://hoops.example/m-512.png"])
PAGES = {"https://hoops.example": (200, HOME.encode(), {}),
         "https://hoops.example/site.webmanifest": (200, MANIFEST, {}),
         "https://hoops.example/a-192.png": (404, b"", {}),
         "https://hoops.example/apple-touch-icon.png": (200, png(180, 180), {"content-type": "image/png"}),
         "https://small.example": (200, b'<html><head><link rel="icon" href="/f.ico"></head></html>', {}),
         "https://small.example/f.ico": (200, ico(16, 32), {"content-type": "image/x-icon"}),
         "https://errors.example": (200, b'<html><head><link rel="apple-touch-icon" href="/gone.png"></head></html>', {}),
         "https://errors.example/gone.png": (200, b"<html>soft 404</html>", {"content-type": "text/html"})}
pages_asked = []
def page(url):
    pages_asked.append(url)
    if url in PAGES:
        return PAGES[url]
    return 404, b"", {}
ok("the logo: the best mark that is really there and really a picture (a manifest icon that is gone is passed over)",
   F.find_logo("https://hoops.example", page) == "https://hoops.example/apple-touch-icon.png", pages_asked)
ok("...a site with only a favicon has no logo (the card prints the initials in its colour)", F.find_logo("https://small.example", page) is None)
ok("...nor one whose icon is an error page", F.find_logo("https://errors.example", page) is None)
ok("...and where the page names none, the address phones ask for anyway",
   F.find_logo("https://quiet.example", lambda u: (200, png(152, 152), {}) if u == "https://quiet.example/apple-touch-icon.png" else (200, b"<html></html>", {}))
   == "https://quiet.example/apple-touch-icon.png")

import struct, zlib
def real_png(w, h, clear_corners, filt=0):
    """an RGBA PNG, its corners see-through or not, its rows under one filter (0 none, 1 sub, 2 up, 4 paeth)"""
    rows, prev = [], bytes(w * 4)
    raw = b""
    for y in range(h):
        px = bytearray()
        for x in range(w):
            corner = (x < 10 or x >= w - 10) and (y < 10 or y >= h - 10)
            px += bytes([(x * 7) % 256, (y * 5) % 256, 90, 0 if (corner and clear_corners) else 255])
        out = bytearray(px)
        for i in range(len(px)):
            a = px[i - 4] if i >= 4 else 0
            b, c = prev[i], (prev[i - 4] if i >= 4 else 0)
            if filt == 1: out[i] = (px[i] - a) & 255
            elif filt == 2: out[i] = (px[i] - b) & 255
            elif filt == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                out[i] = (px[i] - (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        raw += bytes([filt]) + bytes(out)
        prev = bytes(px)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
ok("A MARK THAT FILLS ITS SQUARE is drawn to the edge of the disc: nothing see-through in its corners, whatever the row filters",
   all(F.fills_square(real_png(80, 80, False, f)) for f in (0, 1, 2, 4)))
ok("...a logo on a clear ground is not (it stays on the white disc)", not any(F.fills_square(real_png(80, 80, True, f)) for f in (0, 1, 2, 4)))
SQJPG = JPG.replace((300).to_bytes(2, "big") + (400).to_bytes(2, "big"), (400).to_bytes(2, "big") + (400).to_bytes(2, "big"))
ok("...a square JPEG has no clear ground; a wordmark (not square) keeps its margin; a picture that cannot be read is said not to fill",
   F.fills_square(SQJPG) and not F.fills_square(JPG) and not F.fills_square(real_png(120, 60, False)) and not F.fills_square(png(180, 180)))
ok("...and the logo says so, for the card", F.find_logo("https://full.example", lambda u: (200, real_png(96, 96, False), {}) if u.endswith(".png") else (200, b"<html></html>", {}))
   == "https://full.example/apple-touch-icon.png#fill")

print("\na run")
asked = []
def get(url, etag=None, modified=None):
    asked.append((url, etag, modified))
    if url.endswith("/same"):
        return 304, b"", {}
    if url.endswith("/broken"):
        raise OSError("connection reset")
    return 200, RSS, {"etag": 'W/"new"', "last-modified": "Wed, 30 Sep 2026 10:00:00 GMT"}
db = FakeDb([{"id": "s1", "name": "Hoops", "feed_url": "https://hoops.example/feed", "site_url": "https://hoops.example", "etag": 'W/"old"', "last_modified": "x"},
             {"id": "s2", "name": "Broken", "feed_url": "https://b.example/broken", "logo_checked_at": (NOW - F.timedelta(days=2)).isoformat()},
             {"id": "s3", "name": "Same", "feed_url": "https://s.example/same", "logo_url": "https://s.example/l.png", "etag": 'W/"s"'}])
logs = []
pages_asked.clear()
r = F.run(db, get=get, log=logs.append, now=lambda: NOW, sleep=lambda s: None, page=page)
ok("every source asked once, with its last ETag and Last-Modified", asked[0] == ("https://hoops.example/feed", 'W/"old"', "x") and len(asked) == 3, asked)
ok("its items written with their source, and old ones pruned", len(db.rows) == 3 and all(x["source_id"] == "s1" for x in db.rows) and db.pruned == ["s1"])
ok("...each with the leagues it is about (the fixture's first story names the EuroLeague in a category)",
   next(x for x in db.rows if x["guid"] == "https://hoops.example/?p=1")["league_ids"] == ["EL"] and
   next(x for x in db.rows if x["title"] == "Second")["league_ids"] == [], [x["league_ids"] for x in db.rows])
ok("...the read recorded: ok, the new ETag, the count, and the logo found on its own site while it has none",
   db.marks["s1"]["last_error"] is None and db.marks["s1"]["etag"] == 'W/"new"' and db.marks["s1"]["item_count"] == 3 and
   db.marks["s1"]["logo_url"] == "https://hoops.example/apple-touch-icon.png" and db.marks["s1"]["logo_checked_at"] == NOW.isoformat(), db.marks["s1"])
ok("...a logo looked for two days ago and not found is not looked for again until the week is out; one somebody set, never",
   "logo_checked_at" not in db.marks["s2"] and "logo_checked_at" not in db.marks["s3"] and
   not any("//b.example" in u or "//s.example" in u for u in pages_asked), pages_asked)
ok("a source that fails has its error recorded, and the next is still read",
   "connection reset" in db.marks["s2"]["last_error"] and "last_ok_at" not in db.marks["s2"] and db.marks["s3"]["last_error"] is None, db.marks["s2"])
ok("a 304 is an ok read that writes nothing", "logo_url" not in db.marks["s3"] and r == {"read": 1, "unchanged": 1, "failed": 1, "items": 3, "tagged": 1, "logos": 1, "found": 0}, r)
dry = FakeDb([{"id": "s1", "name": "Hoops", "feed_url": "https://hoops.example/feed"}])
F.run(dry, get=get, dry_run=True, log=lambda m: None, now=lambda: NOW, sleep=lambda s: None, page=page)
ok("a dry run reads and writes nothing", dry.rows == [] and dry.marks == {} and dry.pruned == [])


print("\na link, to its feed (0198)")
ok("the links whose feed follows from the address: a YouTube channel or playlist by id, Bluesky, Substack, Medium",
   F.direct_feed("https://www.youtube.com/channel/UCWJ2lWNubArHWmf3FIHbfcQ") == ("https://www.youtube.com/feeds/videos.xml?channel_id=UCWJ2lWNubArHWmf3FIHbfcQ", "youtube") and
   F.direct_feed("https://m.youtube.com/playlist?list=PLabcdefghijkl") == ("https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdefghijkl", "youtube") and
   F.direct_feed("https://bsky.app/profile/nba.com") == ("https://bsky.app/profile/nba.com/rss", "bluesky") and
   F.direct_feed("https://hoops.substack.com/p/some-post") == ("https://hoops.substack.com/feed", "substack") and
   F.direct_feed("https://medium.com/@coach") == ("https://medium.com/feed/@coach", "medium") and
   F.direct_feed("https://coach.medium.com/") == ("https://coach.medium.com/feed", "medium") and
   F.direct_feed("https://www.youtube.com/@NBA") is None and F.direct_feed("https://www.eurohoops.net/") is None)
YT_XML = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Hoops Channel</title>
<entry><id>yt:video:abcdefghijk</id><title>Game 3 breakdown</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
<published>2026-09-30T10:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/>
<media:description>Every possession of the fourth quarter</media:description></media:group></entry></feed>"""
RSS2 = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Basket News</title><link>https://news.example/</link>
<item><title>Trade done</title><link>https://news.example/a/1</link><pubDate>Wed, 30 Sep 2026 09:00:00 GMT</pubDate></item></channel></rss>"""
POD = b"""<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>The Hoops Pod</title>
<item><title>Episode 12</title><link>https://pod.example/12</link><enclosure url="https://pod.example/12.mp3" type="audio/mpeg" length="1"/></item></channel></rss>"""
BSKY = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>@hoops.example - Hoops</title><link>https://bsky.app/profile/hoops.example</link>
<item><link>https://bsky.app/profile/hoops.example/post/3k</link><description>Tip-off in ten minutes. Full house tonight!</description>
<pubDate>Wed, 30 Sep 2026 11:00:00 GMT</pubDate></item></channel></rss>"""
YT_PAGE = (b"<!doctype html><html><head><title>NBA - YouTube</title><meta property='og:site_name' content='YouTube'></head><body>" + b"x" * 5000 +
           b'<link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCWJ2lWNubArHWmf3FIHbfcQ">'
           b'<meta property="og:title" content="Hoops Channel"><meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c-k-c0x00ffffff-no-rj">'
           b"</body></html>")
SITE = (b"<html><head><meta property='og:site_name' content='Basket News'>"
        b"<link rel='alternate' type='application/rss+xml' title='Comments Feed' href='/comments/feed'>"
        b"<link rel='alternate' type='application/rss+xml' title='Basket News' href='/feed.xml'></head><body></body></html>")
WEB = {
    "https://www.youtube.com/@HoopsChannel": YT_PAGE,
    "https://www.youtube.com/@Legacy": b"<html><body>" + b'{"externalId":"UCabcdefghijklmnopqrstuv"}' + b"</body></html>",
    "https://itunes.apple.com/lookup?id=1384802639&entity=podcast": b'{"resultCount":1,"results":[{"collectionName":"The Hoops Pod","feedUrl":"https://pod.example/feed","artworkUrl600":"https://is1.mzstatic.com/a/600x600bb.jpg"}]}',
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=hoops.example": b'{"handle":"hoops.example","displayName":"Hoops","avatar":"https://cdn.bsky.app/img/avatar/plain/x/y@jpeg"}',
    "https://news.example/": SITE,
    "https://quiet.example/": b"<html><head><title>Quiet</title></head><body>no feed named here</body></html>",
    "https://nothing.example/": b"<html><head><title>Nothing</title></head><body></body></html>",
    "https://mastodon.example/@hoops": b"<html><head><meta property='og:title' content='Hoops (@hoops@mastodon.example)'><meta property='og:image' content='https://files.mastodon.example/a.png'>"
                                        b"<link rel='alternate' type='application/rss+xml' href='https://mastodon.example/@hoops.rss'></head></html>",
}
FEEDS = {"https://www.youtube.com/feeds/videos.xml?channel_id=UCWJ2lWNubArHWmf3FIHbfcQ": YT_XML,
         "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv": YT_XML,
         "https://pod.example/feed": POD, "https://bsky.app/profile/hoops.example/rss": BSKY,
         "https://news.example/feed.xml": RSS2, "https://news.example/comments/feed": RSS2, "https://quiet.example/rss": RSS2,
         "https://direct.example/rss.xml": RSS2, "https://mastodon.example/@hoops.rss": BSKY}
looked, fetched = [], []
def look(u):
    looked.append(u)
    if u in WEB: return 200, WEB[u], {}
    if u in FEEDS: return 200, FEEDS[u], {}
    return 404, b"", {}
def fetch(u):
    fetched.append(u)
    return (200, FEEDS[u], {}) if u in FEEDS else (404, b"", {})
def res(u):
    try:
        return F.resolve(u, look, fetch)
    except F.NoFeed as e:
        return "NoFeed: %s" % e
yt = res("https://www.youtube.com/@HoopsChannel")
ok("a YouTube channel by its @handle: the feed its page names (in the body), its name and its picture",
   yt["feed_url"] == "https://www.youtube.com/feeds/videos.xml?channel_id=UCWJ2lWNubArHWmf3FIHbfcQ" and yt["platform"] == "youtube" and
   yt["name"] == "Hoops Channel" and yt["logo"] == "https://yt3.googleusercontent.com/abc=s240-c-k-c0x00ffffff-no-rj#fill", yt)
ok("...or, where the page names no feed, the channel's id in it", res("https://www.youtube.com/@Legacy")["feed_url"].endswith("channel_id=UCabcdefghijklmnopqrstuv"))
ap = res("https://podcasts.apple.com/us/podcast/the-hoops-pod/id1384802639")
ok("an Apple Podcasts show: its feed from Apple's lookup, checked, with its name and artwork",
   ap["feed_url"] == "https://pod.example/feed" and ap["platform"] == "podcast" and ap["name"] == "The Hoops Pod" and ap["logo"].endswith("600x600bb.jpg#fill"), ap)
bs = res("https://bsky.app/profile/hoops.example")
ok("a Bluesky account: its feed, its name and its picture from the public profile",
   bs["feed_url"] == "https://bsky.app/profile/hoops.example/rss" and bs["platform"] == "bluesky" and bs["name"] == "Hoops" and bs["logo"].endswith("@jpeg#fill"), bs)
nw = res("https://news.example/")
ok("a website: the feed its head names (its comments feed passed over), under the site's own name",
   nw["feed_url"] == "https://news.example/feed.xml" and nw["platform"] == "website" and nw["name"] == "Basket News", nw)
ok("...one that names none: the usual places, tried in turn", res("https://quiet.example/")["feed_url"] == "https://quiet.example/rss")
ok("a feed pasted as it is: itself; a podcast's feed: a podcast", res("https://direct.example/rss.xml")["platform"] == "feed" and
   res("https://pod.example/feed")["platform"] == "podcast")
ms = res("https://mastodon.example/@hoops")
ok("a Mastodon account: the feed its page names, its picture", ms["feed_url"] == "https://mastodon.example/@hoops.rss" and ms["platform"] == "mastodon" and
   ms["logo"] == "https://files.mastodon.example/a.png#fill", ms)
looked.clear(); fetched.clear()
ok("Instagram, TikTok and X are refused without a single request",
   res("https://www.instagram.com/hoopsfan/").startswith("NoFeed: Instagram publishes no feed") and res("https://www.tiktok.com/@hoopsfan").startswith("NoFeed: TikTok") and
   res("https://x.com/hoopsfan").startswith("NoFeed: X publishes") and not looked and not fetched)
ok("a page with no feed anywhere is said so", res("https://nothing.example/") == "NoFeed: no feed found at this address")
ok("an untitled post (Bluesky, Mastodon) takes its first words as its headline",
   F.parse_feed(BSKY, "https://bsky.app/")[1][0]["title"] == "Tip-off in ten minutes. Full house tonight!")

long_pod = POD.replace(b"</channel></rss>", b"") + b"".join(b"<item><title>Old %d</title><link>https://pod.example/%d</link></item>" % (i, i) for i in range(3000))
cut = F.trim_feed(long_pod[:40000])
ok("a feed too long to keep whole is cut after its last whole item and closed again; a JSON Feed is not",
   cut is not None and cut.endswith(b"</item></channel></rss>") and len(F.parse_feed(cut, "https://pod.example/")[1]) == F.PER_READ and
   F.trim_feed(b'{"items": [') is None and F.trim_feed(YT_XML[:300]) is None)

print("\na source added by its link, read")
def get2(u, etag=None, modified=None):
    fetched.append(u)
    return (200, FEEDS[u], {"etag": 'W/"1"'}) if u in FEEDS else (404, b"", {})
db = FakeDb([{"id": "n1", "name": "@HoopsChannel", "feed_url": "https://www.youtube.com/@HoopsChannel", "site_url": "https://www.youtube.com/@HoopsChannel",
              "resolve_from": "https://www.youtube.com/@HoopsChannel", "name_auto": True, "kind": "creator"}])
r = F.run(db, get=get2, log=lambda m: None, now=lambda: NOW, sleep=lambda s: None, page=lambda u, *a: (404, b"", {}), look=look)
m1 = db.marks["n1"]
ok("found and read in the same run: the feed, the platform, the link let go, its posts written",
   m1["feed_url"] == "https://www.youtube.com/feeds/videos.xml?channel_id=UCWJ2lWNubArHWmf3FIHbfcQ" and m1["platform"] == "youtube" and
   m1["resolve_from"] is None and len(db.rows) == 1 and db.rows[0]["title"] == "Game 3 breakdown" and r["found"] == 1 and r["read"] == 1, m1)
ok("...its stand-in name gives way to the channel's own, and its picture is the channel's", m1["name"] == "Hoops Channel" and m1["name_auto"] is False and
   m1["logo_url"].endswith("#fill"), m1)
db = FakeDb([{"id": "n2", "name": "news.example", "feed_url": "https://news.example/", "resolve_from": "https://news.example/", "name_auto": True}])
db.taken = {"https://news.example/feed.xml": "Basket News"}
F.run(db, get=get2, log=lambda m: None, now=lambda: NOW, sleep=lambda s: None, page=lambda u, *a: (404, b"", {}), look=look)
ok("a link to a feed that is a source here already: switched off, and said so", db.marks["n2"]["enabled"] is False and
   "same feed as Basket News" in db.marks["n2"]["last_error"] and db.rows == [], db.marks["n2"])
db = FakeDb([{"id": "n3", "name": "nothing.example", "feed_url": "https://nothing.example/", "resolve_from": "https://nothing.example/"}])
F.run(db, get=get2, log=lambda m: None, now=lambda: NOW, sleep=lambda s: None, page=lambda u, *a: (404, b"", {}), look=look)
first = db.marks["n3"]
db2 = FakeDb([dict(db.src[0], last_error=first["last_error"], last_fetched_at=first["last_fetched_at"])])
looked.clear()
F.run(db2, get=get2, log=lambda m: None, now=lambda: NOW + F.timedelta(hours=1), sleep=lambda s: None, page=lambda u, *a: (404, b"", {}), look=look)
ok("a link with no feed: the reason recorded, and not tried again for six hours", first["last_error"] == "no feed found at this address" and
   "enabled" not in first and db2.marks == {} and not looked, first)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
