"""The <head> of every public entry page of /epinoia/: title, description, canonical, link preview, structured data.

    python tools/apply-page-heads.py            rewrite the heads below in place (idempotent)
    python tools/apply-page-heads.py --check    print each title / description length and change nothing

WHY A TOOL, NOT HAND EDITS. What a search result shows for a page is its <title>, its description and the
site's structured data, and they have to say the same thing in the page, the Open Graph card and the JSON-LD.
The wording lives in PAGES below, one row per page, and this script writes it into each page's own head
between two marker comments, so running it twice changes nothing and the copy has one home. The player, team,
league and game pages are NOT here: tools/build-seo.py writes those from the database on every deploy.

ONLY THE STATIC HEAD IS TOUCHED. Nothing in a body, no script, no i18n pack. A page that sets its own title in
JavaScript for one league (fixtures/?l=x -> "Fixtures - X") still does; what is baked here is what a crawler
that does not run the page, and a result for the bare address, shows. <meta name="epinoia-page"> holds the
page's short name (what its <title> said before), which nav.js puts in the teletext header line so that a
longer title written for a search result does not end up in the page's own header.

Pages that robots.txt keeps crawlers out of (join/, go/) get the tidy title and preview card but no
"index,follow" line: that is robots.txt's decision, not this file's.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://prophesyscouting.co.uk"
BASE = "/epinoia"
SHARE = f"{ORIGIN}{BASE}/brand/epinoia-share-1200x630.png"
SHARE_ALT = "EPINOIΛ: live basketball scores, fixtures, standings and advanced stats"
ROBOTS = "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"
START, END = "<!-- seo:head -->", "<!-- /seo:head -->"
X = "https://x.com/Prophesy_Scout"

# path (under epinoia/, '' = the front page) -> (title, description, short name, robots-open?, breadcrumb label, type)
PAGES = {
    "": ("Epinoia – live basketball scores, fixtures & advanced stats",
         "Follow live basketball scores, fixtures, standings and box scores for leagues around the world, with advanced player stats, scouting tools and shot charts.",
         None, True, None, "WebPage"),
    "home/": ("Basketball Scores Today, Results & Top Players | Epinoia",
              "Today's live basketball scores and results from every league on Epinoia, plus the best-performing players, the leagues you follow and the standings.",
              "home · every league", True, "Home", "CollectionPage"),
    "games/": ("Basketball Fixtures & Results, All Leagues | Epinoia",
               "Every basketball fixture and result across all leagues on Epinoia, nearest to now first: live scores, tip-off times and a full box score for each game.",
               "Global fixtures", True, "Fixtures & results", "CollectionPage"),
    "fixtures/": ("League Fixtures, Results & Schedule | Epinoia",
                  "Upcoming fixtures and recent results for a basketball league on Epinoia: tip-off times, live scores, venues and the full box score of every finished game.",
                  "Fixtures", True, "League fixtures", "CollectionPage"),
    "stats/": ("Basketball Player Stats: Season Leaders | Epinoia",
               "Season statistics for every player in a league: points, rebounds, assists, shooting splits, percentiles and advanced numbers, sortable by any column.",
               "Season stats", True, "Season stats", "CollectionPage"),
    "stats/wowy/": ("WOWY & Lineup Stats: With or Without You | Epinoia",
                    "With-or-without-you basketball analysis: how a team performs with a player on the floor and off it, and its best lineups, from every game's play-by-play.",
                    "WOWY / Lineups", True, "WOWY & lineups", "WebPage"),
    "scouting/": ("Basketball Scouting Table: Filter & Compare Players | Epinoia",
                  "Every basketball league's current season in one scouting table: sort and filter on several stats at once, then compare up to five players side by side.",
                  "Global scouting", True, "Scouting", "CollectionPage"),
    "news/": ("Basketball News & Match Reports | Epinoia",
              "News from the leagues on Epinoia: match reports, standout performances and stories from the games, written from the box scores as they finish.",
              "News", True, "News", "CollectionPage"),
    "injuries/": ("Basketball Injury Report: Who Is Missing | Epinoia",
                  "Which players a club was using who have not played since, worked out from the box scores and listed by club: the injury and availability wire for a league.",
                  "Injury report", True, "Injury report", "CollectionPage"),
    "votes/": ("Fans' Vote: Player & Club of the Week | Epinoia",
               "Every week's fans' player of the week and club of the week in a basketball league, as the league's own fans voted them, with the running totals.",
               "Fans' vote", True, "Fans' vote", "CollectionPage"),
    "video/": ("Basketball Game Video & Highlights | Epinoia",
               "Game video and highlights for every league on Epinoia, linked to the play-by-play so you can jump to any basket, steal or block in the box score.",
               "Video hub", True, "Video", "CollectionPage"),
    "learn/": ("What Epinoia Is: Scoring, Stats & Leagues | Epinoia",
               "Epinoia is a basketball competition platform: one scoring app and one event log behind a public site, club pages, embeds, an API and phone apps for leagues.",
               "Learn more", True, "About", "AboutPage"),
    "join/": ("Membership: Advanced Basketball Analytics | Epinoia",
              "Box scores, tables and player pages are free. Membership adds the analysis on top: where points came from, where shots were taken and who plays well together.",
              "Membership", False, "Membership", "WebPage"),
    "go/": ("EPINOIA GO: Stamp the Arenas You Visit | Epinoia",
            "EPINOIA GO stamps the arenas you go to, at the game, with your phone: your travels on a map, the distance between them and the fans' photographs of each game.",
            "EPINOIA GO", False, "EPINOIA GO", "WebPage"),
    "api/": ("Epinoia API: Basketball Data for Developers | Epinoia",
             "The Epinoia JSON API serves a league's table, fixtures, season statistics, box scores, bracket and awards as JSON, with a key from the league administrator.",
             "API", True, "API", "WebPage"),
    "embed/": ("Embeddable Basketball Tables & Scores | Epinoia",
               "Put a live fixtures strip, box score or standings table from Epinoia on your own website with one line of code. It updates itself, in dark or light.",
               "Embeds", True, "Embeds", "WebPage"),
    "contact/": ("Contact Epinoia: Leagues, Clubs & Press | Epinoia",
                 "Get in touch with Epinoia about a league, a fixture, a wrong number in a box score or running your own competition, or make a data privacy request.",
                 "Contact", True, "Contact", "ContactPage"),
    "privacy/": ("Privacy: Your Data Protection Rights | Epinoia",
                 "Your data protection rights on Epinoia: how to see, correct or erase your data, object to its use or complain, and how long each request takes to answer.",
                 "Privacy", True, "Privacy", "WebPage"),
}

NAV = [  # the sections a searcher may be offered under the home result (sitelinks are Google's choice; this is a hint)
    ("home/", "Home", "Live scores and results from every league, and the best performers"),
    ("games/", "Fixtures & results", "Every fixture and result across all leagues, nearest to now first"),
    ("stats/", "Player stats", "Season statistics, percentiles and advanced numbers for every player"),
    ("scouting/", "Scouting", "Filter, sort and compare players across every league"),
    ("injuries/", "Injury report", "Who is missing, club by club, from the box scores"),
    ("news/", "News", "Match reports and stories from the games"),
    ("votes/", "Fans' vote", "The fans' player and club of the week"),
    ("video/", "Video", "Game video and highlights linked to the play-by-play"),
    ("learn/", "About Epinoia", "What the platform is and how to run a league on it"),
]


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def ld(o) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def url_of(path: str) -> str:
    return f"{ORIGIN}{BASE}/{path}"


def structured(path, title, desc, label, kind):
    """The JSON-LD blocks of one page."""
    site = f"{ORIGIN}{BASE}/#website"
    org = f"{ORIGIN}{BASE}/#organization"
    out = []
    if path == "":
        out.append({"@context": "https://schema.org", "@type": "WebSite", "@id": site, "name": "Epinoia",
                    "alternateName": ["EPINOIΛ", "Epinoia Basketball"], "url": url_of(""), "description": desc,
                    "inLanguage": "en", "publisher": {"@id": org},
                    "potentialAction": {"@type": "SearchAction",
                                        "target": {"@type": "EntryPoint", "urlTemplate": url_of("home/") + "?q={search_term_string}"},
                                        "query-input": "required name=search_term_string"}})
        out.append({"@context": "https://schema.org", "@type": "Organization", "@id": org, "name": "Epinoia",
                    "alternateName": "EPINOIΛ", "url": url_of(""),
                    "logo": {"@type": "ImageObject", "url": f"{ORIGIN}{BASE}/brand/epinoia-app-512.png", "width": 512, "height": 512},
                    "image": SHARE, "sameAs": [X],
                    "description": "Epinoia is a basketball competition platform: live scores, fixtures, standings, box scores and advanced statistics for leagues around the world."})
        out.append({"@context": "https://schema.org", "@type": "ItemList", "name": "Epinoia sections",
                    "itemListElement": [{"@type": "ListItem", "position": i, "item": {
                        "@type": "SiteNavigationElement", "name": n, "description": d, "url": url_of(p)}}
                        for i, (p, n, d) in enumerate(NAV, start=1)]})
        return out
    out.append({"@context": "https://schema.org", "@type": kind, "name": title, "description": desc, "url": url_of(path),
                "inLanguage": "en", "isPartOf": {"@id": site},
                "primaryImageOfPage": {"@type": "ImageObject", "url": SHARE, "width": 1200, "height": 630}})
    out.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Epinoia", "item": url_of("home/")},
        {"@type": "ListItem", "position": 2, "name": label}]})
    return out


def block(path, row) -> str:
    title, desc, short, open_, label, kind = row
    url = url_of(path)
    lines = [START, f"<title>{esc(title)}</title>", f'<meta name="description" content="{esc(desc)}">']
    if short:
        lines.append(f'<meta name="epinoia-page" content="{esc(short)}">')
    if open_:
        lines.append(f'<meta name="robots" content="{ROBOTS}">')
    lines += [f'<link rel="canonical" href="{esc(url)}">',
              '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Epinoia">',
              f'<meta property="og:title" content="{esc(title)}">', f'<meta property="og:description" content="{esc(desc)}">',
              f'<meta property="og:url" content="{esc(url)}">', f'<meta property="og:image" content="{SHARE}">',
              '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
              f'<meta property="og:image:alt" content="{esc(SHARE_ALT)}">', '<meta property="og:locale" content="en_GB">',
              '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:site" content="@Prophesy_Scout">',
              f'<meta name="twitter:title" content="{esc(title)}">', f'<meta name="twitter:description" content="{esc(desc)}">',
              f'<meta name="twitter:image" content="{SHARE}">', f'<meta name="twitter:image:alt" content="{esc(SHARE_ALT)}">']
    lines += [f'<script type="application/ld+json">{ld(o)}</script>' for o in structured(path, title, desc, label, kind)]
    lines.append(END)
    return "\n".join(lines) + "\n"


STRIP = [r'<meta[^>]*\bname="(?:description|epinoia-page|robots)"[^>]*>\s*', r'<link[^>]*\brel="canonical"[^>]*>\s*',
         r'<meta[^>]*\bproperty="og:[^"]*"[^>]*>\s*', r'<meta[^>]*\bname="twitter:[^"]*"[^>]*>\s*',
         r'<script type="application/ld\+json">.*?</script>\s*']


def apply(path, row) -> str:
    f = os.path.join(ROOT, "epinoia", path, "index.html")
    with open(f, encoding="utf-8") as fh:
        s = fh.read()
    head, sep, rest = s.partition("</head>")
    mark = "\x00SEO\x00"
    if START in head:                                  # a second run: the block is replaced where it stands
        head = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\s*", lambda _m: mark, head, count=1, flags=re.S)
    else:
        head, n = re.subn(r"<title>.*?</title>\s*", lambda _m: mark, head, count=1, flags=re.S)
        if n != 1:
            raise SystemExit(f"apply-page-heads: {path or 'index'}: no <title>")
    for pat in STRIP:
        head = re.sub(pat, "", head, flags=re.S)
    if not sep or mark not in head:
        raise SystemExit(f"apply-page-heads: {path or 'index'}: no </head>")
    head = head.replace(mark, block(path, row), 1)
    new = head + sep + rest
    if new != s:
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new)
    return "rewritten" if new != s else "unchanged"


def width(s: str) -> int:
    return len(s)


def main() -> int:
    check = "--check" in sys.argv
    bad = 0
    for path, row in PAGES.items():
        t, d = row[0], row[1]
        flag = "" if width(t) <= 65 and 140 <= len(d) <= 165 else "   <-- length"
        bad += bool(flag)
        print(f"{(path or '(front)'):<14} title {len(t):>3}  desc {len(d):>3}{flag}")
        if not check:
            print("   ", apply(path, row))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
