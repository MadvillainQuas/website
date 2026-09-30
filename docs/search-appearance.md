# How EPINOIA looks in Google and Bing

What a search result for anything under `https://prophesyscouting.co.uk/epinoia/` shows, what this
repository controls, what it does not, and what to do in Search Console. Written 2026-09-30.

## What produces a result

| Piece of a result | Where it comes from | Written by |
|---|---|---|
| Title line | the page's `<title>` | `tools/apply-page-heads.py` (site pages), `tools/build-seo.py` (players, clubs, leagues, games) |
| Snippet | `<meta name="description">` (Google may swap in text from the page) | same |
| Address / breadcrumb trail | `BreadcrumbList` JSON-LD: `Epinoia > League > Club > Player` | same |
| Large preview picture (Discover, Bing, X, WhatsApp, iMessage, Slack) | `og:image` / `twitter:image` | same; the 1200x630 share image comes from `tools/build-share-image.py` |
| Site links under the home result | Google's own choice (see "not in our control") | nobody; the markup below only helps |
| Search box under the home result | `WebSite` + `SearchAction` in `epinoia/index.html` | `apply-page-heads.py` |
| Event / team / person rich data | `SportsEvent`, `SportsTeam`, `SportsOrganization`, `Person` JSON-LD | `build-seo.py` |

Every entry page carries: one `<title>` (60-65 characters wide at most), one description of 140-160
characters, one canonical address that is its own, Open Graph and a `summary_large_image` Twitter card (or a
`summary` card with the club crest / player photo / league logo where the entity has its own picture),
`robots: index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1`, and JSON-LD.

## What each kind of page shows

**Front page** `/epinoia/` (the splash)
- Title: `Epinoia – live basketball scores, fixtures & advanced stats`
- Snippet: "Follow live basketball scores, fixtures, standings and box scores for leagues around the world, with advanced player stats, scouting tools and shot charts."
- JSON-LD: `WebSite` (name `Epinoia`, alternate names `EPINOIΛ`, `Epinoia Basketball`, `SearchAction` whose address is
  `https://prophesyscouting.co.uk/epinoia/home/?q={search_term_string}`), `Organization` (512 px logo, `sameAs`
  = `https://x.com/Prophesy_Scout` only), and an `ItemList` of `SiteNavigationElement`s (home, fixtures, stats,
  scouting, injuries, news, fans' vote, video, about) that says which sections matter.
- The search address really works: `/epinoia/home/?q=name` opens HOME with the search box open and the words typed
  (`nav.js` `openSearch(preset)`, `search.js` `open(preset)`). It is only read on HOME; `?q=` on scouting is that page's own filter.

**HOME** `/epinoia/home/`: `Basketball Scores Today, Results & Top Players | Epinoia`.

**Site sections**, each with its own title, snippet, canonical, card and `WebPage`/`CollectionPage` + breadcrumb:
fixtures & results (`games/`), league fixtures (`fixtures/`), player stats (`stats/`), WOWY (`stats/wowy/`),
scouting, news, injury report, fans' vote, video, learn, API, embeds, contact, privacy. `join/` and `go/` get a
tidy title and card but are disallowed in `robots.txt` (a page a crawler may not fetch cannot show a snippet, and
its `robots` line is left out on purpose). The exact copy is the table `PAGES` in `tools/apply-page-heads.py`.

**Player** `/epinoia/p/<name>.html`
- `Jordan Reed – Red Lions, Test League stats | Epinoia`
- "Jordan Reed (Red Lions) averages 12.5 points, 5.1 rebounds and 3.2 assists in 10 games of Test League 2026-27, shooting 44% FG and 33% from three. Game log and shot chart on Epinoia."
- `Person`: name, jobTitle, description (the stat line), url, `image` only if a moderated (approved) upload exists,
  `height` (QuantitativeValue, cm) only if the profile holds a credible one (100-260), `memberOf` / `affiliation` = the
  club (with its crest). Preview picture: his photo, else his club's crest, else the share image.

**Club** `/epinoia/t/<slug>.html`
- `Bristol Flyers – Super League Basketball Men | Epinoia`
- "Bristol Flyers: 1-2 and 3rd in Super League Basketball Men 2026-27. Top scorers Davion Bailey 16.0 ppg, ..." (record and
  place come from the public `standings` table; the place is left out for grouped tables).
- `SportsTeam`: crest as `logo`/`image`, league (`memberOf`, with its logo), home ground as a `Place` (city and
  country only when the database has them), `athlete[]` (the 15 best scorers who may be named).

**League** `/epinoia/l/<slug>.html`
- `B.LEAGUE One – fixtures, standings and player stats | Epinoia`
- "B.LEAGUE One (Japan) 2026-27: fixtures, results, standings, box scores and player stats for 25 clubs. Kumamoto Volters lead the table."
- `SportsOrganization`: logo, `areaServed` country, `member[]` (clubs with crests) and an `ItemList` of the clubs.
- Japan and Spain also have `/ja/` and `/es/` copies of leagues and clubs, with `hreflang` in the page head and in the sitemap.

**Game** `/epinoia/game/<id>.html` (new): the full box score page, for games of public leagues in a window: live games,
finals of the last 30 days, fixtures of the next 30 (at most 2,500; live first, then a share of the newest finals and
the soonest fixtures).
- Final: `Surne Bilbao 107–92 Kids&Us Manresa – box score | Epinoia`, "Surne Bilbao beat Kids&Us Manresa 107-92 in Liga Endesa on 26 September 2026. Top scorers: Darrun Hilliard 19 (Surne Bilbao), Nick Ongenda 17 (Kids&Us Manresa)."
- Fixture: `BBA Hagen v SC Rist Wedel – preview & lineups | ProB | Epinoia`, "BBA Hagen host SC Rist Wedel in ProB on Sat 3 Oct 2026, 19:30 CEST. Preview, lineups and the full box score on Epinoia."
- Live: `Sydney Kings v Brisbane Bullets – live box score | Epinoia`; the score of a game that is not over is never written into a head.
- `SportsEvent`: start date with the league's own UTC offset, home/away `SportsTeam` with crests, `Place`, organiser league, sport.
  `eventStatus` is `EventScheduled` for all three states: schema.org has no "in progress" or "played" value, and inventing one
  would be ignored. Two games of the same clubs on the same title get the date added.
- The address `/epinoia/game/?g=<id>` still works and is what every link inside the site uses; the static copy reads the id from
  `<meta name="epinoia-entity">` (`game.js`, `go/fans.js`, `track.js`) and keeps its baked title and markup instead of rewriting them.

## Safeguarding: nobody flagged as a minor

The rule from `tools/build-seo.py` is kept and extended. A person with any minor-flagged or masked ("#14", no name) row gets no
page, no photo, no height, no name in a club's athlete list, in a description, in a game's top scorers, in a sitemap. A "top scorer"
or "scoring leader" is only named when the leading person may be named: a list that starts with somebody who may not be is empty,
so nobody is falsely promoted to "top scorer". Games of leagues with `youth_protected`, and of clubs whose `age_group` is 18 or under,
get no page. `tools/build_seo_test.py` builds a fixture with a minor as a top scorer, a photograph and a height and checks none of it
appears anywhere. Against the live database the anonymous API returned no minor rows at all (0), so the rule is enforced twice.

## The sitemap and robots.txt

`/epinoia/sitemap.xml` is an index of `sitemap-static.xml` (the entry points; source `epinoia/sitemap.xml`), `sitemap-entities.xml`
(leagues, clubs, players, with `xhtml:link` hreflang alternates) and `sitemap-games.xml` (omitted when there are no games). Every
entity has a `<lastmod>` from the data (a club's newest standings update; a game's finish, or its record's creation for a fixture;
"now" for a live game). `robots.txt` keeps its single `Sitemap:` line, the index. Nothing noindex, admin, embed or blocked is listed
(`build_seo_test.py` checks the static list against `robots.txt`).

## What is and is not in our control

**Ours:** everything under `/epinoia/`: titles, descriptions, canonicals, cards, structured data, sitemaps, which pages exist, and
which pages say noindex.

**Google's, not ours**
- *Sitelinks* (the extra links under the home result) are chosen by Google from the site's structure and how people use it. The
  `ItemList` of sections and clear titles/breadcrumbs help; nothing forces it. They appear once the home result is trusted; the old
  title `Epinoia - epinoiΛ` will be replaced when Google recrawls (request indexing, below).
- *Site name* and *favicon* are decided from the **domain's root page** (`https://prophesyscouting.co.uk/`), not from `/epinoia/`.
  Google's site-name feature covers domain and subdomain roots only, so a `WebSite` on `/epinoia/` does not name the site by itself.
- *The search box* under a result is now rarely shown by Google, whatever the markup; `SearchAction` is still correct and harmless.
- *Rich results*: `SportsEvent` is not a rich-result type Google promises to show for every game; `Person`/`SportsTeam` mainly feed the
  knowledge graph. The data is right; the display is Google's.

**At the root site, if the owner wants it** (this repository's `/index.html` is the Prophesy sign-in and says `noindex, nofollow`;
`epinoia/` cannot change it):
1. *Favicon.* Google takes it from the root page. The root has only `<link rel="apple-touch-icon" href="logo.jpg">` and no
   `rel="icon"`; whatever `/favicon.ico` or that touch icon is (currently the binoculars) is what shows. To show the EPINOIΛ mark for
   the whole domain add to the root `<head>`: `<link rel="icon" type="image/png" sizes="48x48" href="/epinoia/brand/epinoia-mark-192.png">`
   (a square, at least 48 px, a multiple of 48 is best) and `<link rel="icon" href="/favicon.ico">` with the same artwork. If the
   binoculars should stay, nothing to do: they are the brand of the root site.
2. *Site name and the ` - PROPHESY` suffix.* Add to the root page `WebSite` JSON-LD with `"name": "Prophesy Scouting"` (or whatever the
   short name should be) and `"alternateName"`, and make the root `<title>` say the same; a `noindex` root page may not be read for this
   at all, so if the root is meant to be found, remove `noindex, nofollow` from it first. The suffix seen on EPINOIA results is
   Google appending the domain's site name; it changes only when the root changes.
3. Cross-link: a plain link from the root page to `/epinoia/` helps Google associate the two.

## Search Console checklist

1. Add the property `https://prophesyscouting.co.uk/` (Domain property via DNS if possible, so http/www variants and `/epinoia/` are one).
2. **Sitemaps** > submit `https://prophesyscouting.co.uk/epinoia/sitemap.xml` (the index). Expect three child files read; check
   "Discovered URLs" (about 11,000 today: 10 static, 8,565 entities, up to 2,500 games) and any "Couldn't fetch". Bing Webmaster Tools:
   import from Search Console or submit the same address.
3. **URL Inspection**, then "Request indexing", for: `/epinoia/`, `/epinoia/home/`, `/epinoia/games/`, one league, one club, one player
   and one game page (`/epinoia/l/slb-men.html` etc.). "View crawled page" > screenshot confirms the page renders; "More info" shows
   the rendered HTML has the new title. Do this after each deploy that changes the home head; it is what removes `Epinoia - epinoiΛ`.
4. **Rich Results Test** (`search.google.com/test/rich-results`): paste the home URL (WebSite, Organization), a game URL (Event),
   a player URL (profile/Person). "Missing field" warnings on `SportsEvent` for games with no venue are expected: a game whose venue
   is unknown is not given an invented one. Also the Schema Markup Validator (`validator.schema.org`) for the full shape.
5. **Enhancements / Experience** reports: read *Breadcrumbs* (should equal the number of entity pages once crawled), *Sitelinks search box*
   (informational), *Events* (games; errors are real, warnings about optional fields are not), *Logos* (Organization). A drop in valid
   items after a deploy means a template regression: run `python3 tools/build_seo_test.py`.
6. **Pages** report: "Crawled - currently not indexed" for many player pages is normal early on (new domain section, crawl delay of
   10 s in `robots.txt`); "Duplicate, Google chose different canonical" for a same-name player means the league has two profiles of one
   person (merge them). "Blocked by robots.txt" for `join/` and `go/` is intended.
7. **Performance** > filter Page contains `/epinoia/game/` to see the game pages separately; watch the first 4 weeks, then re-check the
   30-day window still yields fresh pages (the window rolls each night).
8. **Removals** only for a person who asks to be taken out: remove the address, then unpublish the profile; the nightly build will not
   recreate a page for a minor or a masked name.
9. Bing: `Sitemaps`, `URL Submission` for the home; Bing reads `robots.txt`'s `Crawl-delay`.

## Running it

- `python3 tools/build_seo_test.py`: 230 offline checks (no minor anywhere, JSON-LD shape, titles <= 65, no duplicate titles,
  every written page in a sitemap, static heads, robots consistency).
- `python3 tools/apply-page-heads.py [--check]`: rewrite / measure the static heads. `python3 tools/build-share-image.py`: redraw the share image.
- `python3 tools/build-seo.py <dir>`: the real generator against the public database (about a minute; `--fixtures <dir>` offline).
  The Pages workflow already runs it nightly; no workflow change is needed for the games or the sitemap index.

## Known limits

- Duplicate titles remain only where two clubs' or players' names are so long that only the bare name fits, and for two games of
  the same clubs on the same day. The same page in English and Spanish shares a title in the same case.
- `startDate` uses the league's time zone from `leagues.timezone`; a league without one is shown in UTC.
- Game pages are a window, not an archive: a result older than 30 days keeps its `?g=` address but loses its own page and sitemap
  entry at the next build. Google may keep the URL indexed for a while; it still opens the full page.
- Descriptions are Google's to rewrite; expect it to do so for long-tail queries.
