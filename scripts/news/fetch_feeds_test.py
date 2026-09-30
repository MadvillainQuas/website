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


print("\na run")
asked = []
def get(url, etag=None, modified=None):
    asked.append((url, etag, modified))
    if url.endswith("/same"):
        return 304, b"", {}
    if url.endswith("/broken"):
        raise OSError("connection reset")
    return 200, RSS, {"etag": 'W/"new"', "last-modified": "Wed, 30 Sep 2026 10:00:00 GMT"}
db = FakeDb([{"id": "s1", "name": "Hoops", "feed_url": "https://hoops.example/feed", "etag": 'W/"old"', "last_modified": "x"},
             {"id": "s2", "name": "Broken", "feed_url": "https://b.example/broken"},
             {"id": "s3", "name": "Same", "feed_url": "https://s.example/same", "logo_url": "https://s.example/l.png", "etag": 'W/"s"'}])
logs = []
r = F.run(db, get=get, log=logs.append, now=lambda: NOW, sleep=lambda s: None)
ok("every source asked once, with its last ETag and Last-Modified", asked[0] == ("https://hoops.example/feed", 'W/"old"', "x") and len(asked) == 3, asked)
ok("its items written with their source, and old ones pruned", len(db.rows) == 3 and all(x["source_id"] == "s1" for x in db.rows) and db.pruned == ["s1"])
ok("...each with the leagues it is about (the fixture's first story names the EuroLeague in a category)",
   next(x for x in db.rows if x["guid"] == "https://hoops.example/?p=1")["league_ids"] == ["EL"] and
   next(x for x in db.rows if x["title"] == "Second")["league_ids"] == [], [x["league_ids"] for x in db.rows])
ok("...the read recorded: ok, the new ETag, the count, and the feed's own picture while it has none",
   db.marks["s1"]["last_error"] is None and db.marks["s1"]["etag"] == 'W/"new"' and db.marks["s1"]["item_count"] == 3 and
   db.marks["s1"]["logo_url"] == "https://hoops.example/logo.png", db.marks["s1"])
ok("a source that fails has its error recorded, and the next is still read",
   "connection reset" in db.marks["s2"]["last_error"] and "last_ok_at" not in db.marks["s2"] and db.marks["s3"]["last_error"] is None, db.marks["s2"])
ok("a 304 is an ok read that writes nothing", "logo_url" not in db.marks["s3"] and r == {"read": 1, "unchanged": 1, "failed": 1, "items": 3, "tagged": 1}, r)
dry = FakeDb([{"id": "s1", "name": "Hoops", "feed_url": "https://hoops.example/feed"}])
F.run(dry, get=get, dry_run=True, log=lambda m: None, now=lambda: NOW, sleep=lambda s: None)
ok("a dry run reads and writes nothing", dry.rows == [] and dry.marks == {} and dry.pruned == [])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
