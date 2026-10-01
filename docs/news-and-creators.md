# News, publishers and creators

Migrations **0194** (the schema), **0195** (the sources to start with) and **0198** (adding by link). What the site carries besides a league's own news:

- **Publishers.** A news site read by its feed: Eurohoops, BasketNews, a federation's site.
- **Creators.** Two kinds:
  - a YouTube channel, a podcast or a Bluesky account read by its feed, added by its link (0198);
  - an independent podcast, channel or writer that a league gives an outlet of its own, where they publish by hand.

Both appear on the platform's **News** page, in **HOME's FEED**, on each league's news page and on the league's front page. Readers can follow either one.

## Where things are

| Page | What it is |
| --- | --- |
| `news/` | Everything on the post card, **For you** (ranked on the reader's device, the default for everyone; an explicit choice is remembered under `epinoia.news.order2`) or **Newest**. Switches for Everything, Publishers, Creators, League news and Following; the ranking applies within each. A row of the publishers, and **Personalise**. |
| `news/?s=<slug>` | A publisher's page: its head in its colours, the way to its site, a follow bell, its stories. |
| `news/?i=<id>` | One story, where a notification lands. The publisher's colourway, the headline centred, the opening lines, and a button to read it on their site. |
| `news/?l=<league>` | The league's own archive as before. Under it, **Around the league**: the publishers' stories about the league (its league tags), every story of the platform's sources the league picked (0209), and its creators' pieces. |
| `creators/?l=<league>` | The league's creators as tiles, and their latest pieces. |
| `creators/?l=&o=<outlet>` | An outlet's page: head, platforms, bell, bio. Its videos, episodes and posts play in their cards. |
| `creators/?l=&o=&p=<piece>` | One piece in the outlet's colourway. An article, or the video / episode / post itself with its caption. |
| `creators/studio/` | Where an outlet's people write (the editor: `docs/creator-hub.md`). |
| `creators/hub/` | The creator hub (0200): a creator's numbers and writing desk; a league's storylines, graphics and icons for anybody. See `docs/creator-hub.md`. |
| HOME, **Feed** | Six cards, under My followed. **For you** (the default) is the ranked feed below; **Followed** shows what the reader follows (leagues, clubs' leagues, publishers, creators), newest first; **Newest** shows everything, newest first. The choice is remembered under `epinoia.home.feed2` (a new key: everyone starts on For you again, and an explicit choice after that sticks). **Personalise** sits beside them. |
| A league's front page, **Creators** | The three latest pieces and a row of the outlets. Absent while creators are off or nothing is published. |
| The rail | **News** on the platform panel. **Creators** on a league with some (probed). **Creator studio** in the hub for an outlet's people, and **creator hub** for everybody. |

## The post card (`epinoia/newscard.js`, `kit/newscard.css`)

The card uses the brand's colour, and its logo on a disc when there is no picture, or as a badge over the picture when there is. Under that: who, when, the headline, and the first line or two of the excerpt.

The headline is the card's one link, and it covers the card. The league tags and the foot (the publisher's or creator's page here) are links of their own that sit above it. A link is never nested inside another.

A logo ending `#fill` fills its square, and is drawn to the edge of the disc. The fetcher decides this: see `fills_square`.

## A match report's card and head (`epinoia/news.js`, `kit/news.css`)

A league's own news (its front page's headlines and its news page) has a card of its own. A **match report** without a cover photograph shows the result, as a broadcast puts it up:

- **The halves.** Each half is one club's colour, with the halftone over it, cut on a diagonal. A club still on the default colour takes the headline's tint.
- **The stripe.** The cut is a stripe in the league's colour. Only the league's own colour counts (`colour_source` is `logo` or `manual`); with the platform's default, the stripe is the kit's own.
- **The crests.** Each crest sits on a white disc ringed in its club's colour, with three letters under it (`codeOf`):
  - the short name when that is a code already (CHE);
  - otherwise the first word that names the club, past a prefix (KK, BC, CB) or a Le / La;
  - two clubs with the same letters use their last words instead (London Lions v London City Royals: LIO v ROY).
- **The score.** The score sits on a black slab, with FINAL above it on the league's colour, in black or white, whichever reads better. The losing figure is dimmed.
- **The league.** Its logo sits on a white chip above the score, where no crest can run into it however narrow the card. Without a logo, or when it does not load, the chip shows its monogram on its colour. A card seen on its own says whose game it was.
- **The edge.** The card's edge and shadow are the winner's colour. A colour too pale for a white card gives way to the other club's, then to the tint.
- **The flag.** *Latest* or *Pinned* is a tab on the line under the picture, at the right. In a corner of the picture it ran into a crest on a narrow card. Any other card keeps its flag on its picture.
- **The sizes.** The crests, the score and the chip are sized by the card's own width (`cqw`; the plate is the container `mtplate`), so a wide lead and a narrow card are each in proportion.

**The row.** From 1000px to 1399px, the first two cards share the first row (three of six columns each). The lead used to take three columns and the next card two, which left one column empty. From 1400px all go three across. The pictures in a row are cut alike, so they line up.

**The article's head.** The article page of a report without a cover opens with the same result, wide (`plate()`):

- the clubs named in full, wrapping to two lines if they must, and their codes under 560px (`@container artslot`);
- FINAL and the day above the score (the day goes under 420px), or LIVE if the game was opened again after the report was filed;
- a link to the box score.

Its height follows its width, from 190px to 380px. A fixed phone shape and desktop shape would be wrong at some widths, because the site zooms the page (1.25 from 1000px, 1.5 from 1200px).

The head's place is kept while the game is read, so the words under it do not jump. The game's row now brings each club's short name, colours and crest.

The front page and the news page hand the card their league's row (`league`). The news page reads `colour_source` and `logo_path` with it. Nothing new is asked of the database.

## Adding a publisher or a creator by its link (0198)

In the platform console's **News** tab, or a league console's **Creators & news sources**, paste one link. The console says what the link is before anything is sent, and suggests publisher or creator. You can change that, add a name, and press **Add**.

At its next read (within half an hour), the reader finds the feed behind the link. From then on every new post arrives, and its followers are told.

| Paste | What is read |
| --- | --- |
| A feed (RSS, Atom, JSON Feed) | itself |
| A website | the feed it names in its page, or one in the usual places (`/feed`, `/rss`, `/feed.xml`…) |
| A YouTube channel (`/@handle`, `/channel/UC…`) or playlist | YouTube's own feed of its videos, with the channel's name and picture |
| An Apple Podcasts show | the show's own feed, from Apple's public lookup, with its artwork |
| Substack, Medium, Bluesky, Mastodon | each one's public feed; Bluesky and Mastodon with the account's name and picture |

Until the first read, the source keeps a stand-in name (`@handle`, or the site's name) and shows as waiting. The first read replaces the name with the feed's own. A link where no feed is found says so, and is tried again every six hours. A link whose feed is already a source is switched off, with the reason.

**Instagram, TikTok, X, Threads and Facebook cannot be added this way.** None of them publishes a feed that can be read without the account owner's permission, and the site never scrapes them. The console and the database refuse them, and say what to do instead:
- add the same creator's YouTube channel, podcast, website, Substack or Bluesky;
- or embed single posts in a creator's outlet on a league.

Reading those accounts automatically would need each owner to connect their account through the platform's own API. That means a Meta developer app (Instagram, Threads, Facebook) or a TikTok developer app, each with the platform's app review.

**Spotify** shows no public feed of a show either. Most podcasts are on Apple Podcasts too: paste that link, or the podcast's own feed.

**On the site.** A creator's posts come out of the feeds as `channel`, under **Creators** rather than **Publishers**, and the News page has a row of the creators. A post opens on its story page here (`news/?i=`), where a video, an episode or a post plays in place, with the way to it on its platform. A source can be switched between publisher and creator at any time.

A long feed (a podcast with years of episodes) is cut after its last whole episode within 3 MB. The newest come first, and only the newest 40 are kept anyway.

## Official partners (0201)

The platform can name a news source or a creator outlet an **official partner**. Only a platform administrator can; a league can add a source or open an outlet but not call it a partner.

- **The flag.** `news_sources.official_partner` and `creator_outlets.official_partner`, default false, set by `set_official_partner(kind, id, on)` (platform administrators only, audit-logged as `set_official_partner`). The tables stay closed (RLS on, no grant).
- **The list.** `official_partners()` (open to everyone) returns `[{kind, slug}]` for sources that are on, and `[{kind, slug, league}]` for outlets that are active and shown (an outlet's slug is unique only within its league, so its league's slug is part of its key). The keys are `source:<slug>` and `outlet:<league>/<slug>`. Every page that shows a card asks once per page; the answer is cached for an hour.
- **The console.** Platform console, **News** tab, **Official partners**: every source and every outlet with an *Official partner* switch. It asks before it changes anything (`official_partners_admin()`, platform administrators only, lists them).
- **The card's key.** A card carries the key it is known by: `source:<slug>` for a publisher's story and for a creator's channel post (both are news sources), `outlet:<league>/<slug>` for an outlet's piece. `newscard.js` `fromFeed` and `feedrank.js` `pkeyOf` follow the same rule. Before 2026-10-01 a creator's channel post had no key, so it never wore the pill.
- **The pill.** A small gold teletext block, *Official partner* (`.pc-partner`, `kit/newscard.css`), black on gold in both themes. On a card it sits on the plate at the bottom left, away from the headline and under the headline link's cover, so the card is still pressed anywhere; a card with no plate carries it in its kicker. It is also in the head of a publisher's page, a creator outlet's page and a story or piece, in the row of publishers, and on a creators' tile.

## A league's content creators (0207)

The platform says which leagues each creator covers. The league's Community page (`community/?l=`) then shows the newest from them, under **Content creators**.

- **Assigning.** Platform console, **News** tab, **Publishers & creators for every reader**. Each source has a **COVERS** row: a chip for each league it covers (its × takes it off), and a list of the other leagues to add one. Since 0209 a publisher has one too, and a league's own console writes the same list for its own league (below).
- **The database.**
  - `news_sources.assigned_leagues` (`uuid[]`, empty by default).
  - `set_news_source_leagues(id, leagues)` sends the whole list each time. Only a platform administrator can call it, and only for a source for every reader (a league's own source already belongs to its league). The leagues are kept once each, in the order given; a league that does not exist is dropped. It is audit-logged and returns what was kept.
  - `news_sources_admin(league)` now carries `assigned_leagues`: `[{id, slug, name}]`.
- **What the section shows** (`league_creator_feed(league, before, limit)`, open to everyone, in `news_feed`'s rows):
  - the posts of the creators assigned to the league;
  - the posts of the league's own creators (a source of kind *creator* that the league added itself);
  - the pieces of the league's creator outlets, where the league shows its creators.

  Never a publisher, assigned or not (switch it to a creator and it shows; the assignment is kept across the switch). Never a source that is off, a suspended outlet, a hidden piece or draft, or a league the reader may not see.
- **The section.** The feed's post card, nine at a time, with **Show more** while there are more. The league's own tag is left off each card, and an official partner wears its pill. Nothing is played on the page: a card opens its story here (`news/?i=`, `creators/`), where a video or an episode plays. So the page's Content-Security-Policy is unchanged. The section stays away while there is nothing to show, and before 0207 is applied.
- **Not changed by 0207.** `news_feed` and `news_feed_mine`. 0209 changes both: a source on the list reads on the league's news page as one of its own.

## A league picks from the platform's list (0209)

A league's administrators could only add sources of their own, by link. When the platform already read that feed, it was read twice, and every story of it showed twice in every reader's News. Now the league's console lists the platform's publishers and creators, and the league picks the ones it wants.

- **Where.** League console, **Settings**, **Creators & news sources**, under the league's own sources: **From the platform's list**.
  - The league's picks come first, each with **take off**.
  - The rest sit behind a fold, eight at a time with **Show more**. They can be found by name or site, and narrowed to publishers or creators.
  - A link pasted into the add box that the platform reads already (its site, its feed, or the link it was added by) is named, with a button to pick it instead.
- **What a pick does.** The league goes into the source's `assigned_leagues`: the same list as the platform's COVERS row. Whoever put a league there, the source then reads on that league's pages as one of the league's own:
  - every story of it under **Around the league** on the league's news page, not only the ones that name the league (`news_feed`);
  - in the row of the league's sources there (`news_sources_public`);
  - in the feed of everyone who follows the league (`news_feed_mine`);
  - a creator's posts under **Content creators** on the Community page (`league_creator_feed`, as in 0207). Never a publisher's.

  A story's league tags are not changed: a site that covers everything does not wear the badge of every league that picked it. Nothing new is fetched, and nobody new is notified (a source's notices go to its own followers).
- **The database.**
  - `news_sources_offered(league)` lists the platform's sources for a league's administrators (or the platform's). It has every source that is on, plus any the league picked that the platform has since switched off, so it can be taken off. Each row says whether the league has it (`picked`); those come first.
  - `set_league_news_source(league, id, on)` adds or removes that one league, never another's.
    - Only a source for every reader: a league's own source already belongs to its league.
    - Not one the platform has switched off.
    - Audit-logged when it changes. Returns whether the league has it now.
  - `news_feed`, `news_feed_mine` and `news_sources_public` are 0198's, with one condition each, tagged `-- 0209`. Same signatures and grants.
- **One list, two hands.** The platform's COVERS row sends the whole list, so a league it leaves out is off. A league can take off a source the platform gave it: the league's pages are the league's. The source itself stays the platform's, its feed read once and looked after there.

## The ranked feed (`epinoia/feedrank.js`)

**For you** puts the newest posts in an order made for the reader. The ranking is done in the browser, from a profile that is kept **only in the browser** (`localStorage`, `epinoia_feed_v1`) and is **never sent** to the server: not the points, not what was opened, not the reader's country. The calls it makes are the same for every reader: the newest 60 posts (and, signed in, the newest 60 of what they follow: `news_feed_mine`, which already knows their follows), `official_partners()`, the leagues' countries (`leagues?select=id,slug,country`) and `news_report_significance()` for the match reports among the candidates. The big RPCs are unchanged.

**What is learned** (only while personalisation is on):

| | |
| --- | --- |
| Dwell | time on a league's own pages (`interest.js`: front page, table, club, player, game, stats, fixtures, news, creators). Counted only while the tab is visible and the reader has touched, scrolled or typed in the last 30 s; flushed when the tab is hidden or closed; a point a minute; at most 15 minutes a league per session. |
| Location | the country, from the device's time zone (a compact table in `feedrank.js`), else the region of its first language (`en-GB` gives GB). No prompt, no IP lookup, no geolocation. A league in it counts in full; one in a region-mate's country (Nordics, the Balkans, the British Isles...) counts 0.4. |
| Affinity | a story or piece opened: 4 points to its publisher or outlet, 1.5 to each of its leagues. A publisher's or outlet's page visited: 3. A follow: 6. |
| Reads | the ids of what was opened (and, for a piece or an article, an address made of its slugs, so its own page counts as much as its card): capped at 600, forgotten after 60 days. Impressions (what was shown) are kept apart. |

Learned points halve every 30 days.

**The score** of a candidate. Every number is a named constant in `W` at the top of `feedrank.js`.

```
recency  = 0.03 + 0.97 * 2^(-age / 18 h)
personal = 1 + 1.2 * L + 0.6 * C + 0.8 * P        L, P = 1 - e^(-points/20 or /10);  C = 1 home, 0.4 region
base     = TIER + 0.85 * min(1, significance / 60)     (the lift is for match reports only)
score    = base * recency * personal * (0.85 after 3 sightings never opened, 0.7 after 6)
           + 0.5 * sqrt(recency)          if it is from what they follow
           + 3 * fade(age)                if it is an official partner's and UNREAD
```

The partner boost is in full for a week from publication, then fades to nothing over two days, and is larger than the whole personal multiplier's range, so an unread partner story outranks an ordinary story of the same age. A read one is an ordinary story.

**The tiers** (`TIER`): a publisher's story = a creator's piece (1.0) > a league's own article (0.8) > the site's own **match report** (0.35). A match report is the article `finalise-game` files for each game, signed `Epinoia match report` (its slug is `report-` and the first 8 hex digits of the game's id). Its base is lifted by what the game is worth:

**What a game is worth** (`game_significance(game ids)`, `news_report_significance(article ids)`, 0202; up to 60 games a call, only for leagues the caller may see; a withheld player is never named):

| | points | reason |
| --- | --- | --- |
| Table (each club has played 3 games, same group) | 30 / 22 / 10 / 18 | 1st v 2nd / a top-three clash / a top-four club against one within two places / a top-three club beaten by the bottom third of a table of six or more |
| Players | 25 / 40 · 28 · 14 / 18 / 4 / 10 | triple-double / 50+, 40+, 30+ points / 20 points and 20 rebounds / a double-double (only when there is neither of the first) / a 30+ game nobody in the competition has beaten or matched |
| Stage | 50 / 30 / 18 / 8 | a cup or playoff final / semi-final / quarter-final / any other tie (or a playoff game with no tie) |
| Extras | 14 or 8 / 6 | double overtime or overtime / decided by 1 to 3 points |

The groups are capped (table 30, players 45, stage 50, extras 30) and the game at 100. The reasons are short strings, the most valuable first (`Cup final`, `Top-of-the-table clash: 1st v 2nd`, `34-point game: <name>`). A plain report is under a publisher's story; a cup final, or the top two meeting with a big night, can outrank an ordinary story; a very fresh report for a league the reader follows or has spent time on can surface. These are weights, not a filter: the weights in `feedrank.js` can be tuned without a migration, the points in `0202`.

**Language (0204).** A story in a language the reader does not read is multiplied by `LANG_PENALTY` (0.3): it sinks, it does not go, and a much fresher one can still beat a stale story. The score becomes `base * recency * personal * imp * langFactor + follow + boost`, with `langFactor = 0.3 + 0.7 * relief` for a foreign story and 1 otherwise. What counts as read:
- **Read from the start:** the site's language (the EN / 日本語 / ES switch: `EpinoiaI18n.lang`, else `epinoia_lang`, else `<html lang>`) and every entry of `navigator.languages`. A reader on the English site with `es` in their browser is never penalised for Spanish.
- **Engagement (`relief`, graded):** each *new* story or piece opened gives its language `OPEN_LANG_PTS` (3) and each publisher's page visited `VISIT_LANG_PTS` (2) in the profile (`g`, halving every 30 days like the rest); the language is `sat(points, LANG_SCALE = 12)` unlocked: one accidental open is ~22% (the factor stays under 0.5), five or six a habit (~75%), a dozen nearly all. Opening the same story twice counts once.
- **Leagues:** a story from a league the reader follows, or one in their followed feed, has `LANG_FOLLOW_RELIEF` (0.85) of the penalty lifted; a league they have points for lifts it by `LANG_LEAGUE_RELIEF` (0.7) x its 0..1 share. A Spanish-league fan reading in English still sees ACB's news.
- **Official partners:** held back only mildly (`LANG_PARTNER_FLOOR` 0.75); the additive boost is untouched.
- **Never held back:** a league's own article and a match report (the site's, in the site's language), a source or outlet with no language on record, a reader whose languages are unknown, and everything when *Show every language* is on.
- **The chip:** a story in a language other than the site's carries a small `ES` chip in its kicker (`pc-lang`, `newscard.js langChip`) with the language's name as its title, and `lang=` on its headline. It shows in every view (For you, Newest, Following).

*Where a publisher's language comes from.* `news_sources.language` and `creator_outlets.language` (0204: lower-case ISO 639-1 or NULL; the seeded sources are back-filled) through `news_source_languages()`, a small public function the page calls once and keeps half a day. `news_feed` and `news_feed_mine` are unchanged (no `lang` column: adding one means dropping and re-creating both), the page joins by `source_slug` (and an outlet's league and slug). **0204 need not be applied for the feature to work**: without it (404, offline) `feedrank.js` uses `SOURCE_LANG`, the map of the sources 0195 seeded (a test holds it equal to the migration); a source added later has no language until 0204 is applied and an administrator sets it (`update news_sources set language = 'de' where slug = ...`), and is never held back meanwhile. A row that carries its own `lang` wins over its publisher's.

**Variety.** Never more than two in a row from one source, and no more than two boosted partner items in the first six.

**Why.** Each ranked card has a line saying why (*Official partner*, *Cup final*, *You follow NBL*, *Because you read a lot about NBL*, *Because you read Eurohoops*, *Popular where you are*, *From a publisher*...).

**Personalise** (the button in the feed's heading on HOME and the News page, and the privacy page): a switch, the **languages** (the ones counted as the reader's, with *Remove* on those learned from what they opened, and *Show every language*, kept through a reset like the switch: `epinoia_feed_v1_langall`), and *Reset what the site has learned* (which clears the language points too). Off means the feed is the newest first, nothing is recorded, and what was learned before is left as it is; the switch (`epinoia_feed_v1_off`) survives a reset. A reset deletes the profile; what the reader follows belongs to their account and is untouched. The privacy page says all of this in plain words.

**With no storage** (a private window, blocked site data) everything still works, in memory for the page.

## Publishers: the news sources

- **Who adds them.**
  - The platform console, **News** tab: sources every reader sees (the league is null).
  - A league console, **Creators & news sources**: a league's own sources. They appear on that league's news page and in every reader's News.
- **Reading.** `scripts/news/fetch_feeds.py`, run every half hour by `.github/workflows/news-feeds.yml` with the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` secrets.
  - Formats: RSS 2.0, RSS 1.0, Atom and JSON Feed, fetched with a conditional GET.
  - It keeps the headline, a plain-text excerpt of up to 320 characters, an https picture, the author, the categories and the date. Never the article itself.
  - Stories are kept 120 days.
  - A re-read may correct a story but never moves it up the page (`news_items_keep_time`).
- **League tags.** Each story is tagged with the leagues it is about (`LeagueMatcher`). It scores:
  - the league's names (including other names: the Euroliga, the ACB, LBA, GBL…), in the categories, headline and excerpt;
  - the league's clubs, at most 2 each, so one club named however often is never enough.

  Two exceptions:
  - A youth or academy league is never tagged by its clubs alone.
  - A women's league is tagged by its clubs only when the story says it is about women's basketball.

  A story lands on every tagged league's news page, and its card shows the tags.
- **Logos.** A source with none gets one from its own site. The fetcher tries these in order:
  1. the apple-touch-icon;
  2. the web app manifest's icons;
  3. the Windows tile;
  4. the sized icons;
  5. the feed's picture.

  Each is read to confirm it is a picture of at least 64 px. It retries a week later if nothing was found. A logo set by hand is never touched, and clearing one makes it look again.
- **The starting set (0195).** 16 news sites and 14 of the leagues' own feeds, each checked on 2026-09-30. The list is in the migration.
  - Left out: FEB's all-competitions feed, and the sites that refused a reader that day (the EuroLeague's among them).
  - U SPORTS is in, and quiet until its season starts in November.

## Load articles now (the `news-refresh` function)

A publisher's articles arrive every half hour. An administrator who does not want to wait presses **Load now**: that source's feed is read at once and its stories are on the site a second later, with what came in said under the button (`+7 new · 12 total · 1.2 s`).

- **Where the button is.**
  - Platform console, **News** tab: a **Load now** on every source, and **Load all now** above them (platform administrators).
  - A league console, **Creators & news sources**: a **Load now** on each of the league's own sources.
  - The public **News** page: on a publisher's page (`news/?s=<slug>`), and under the **Publishers** switch (**Load all publishers now** for a platform administrator, **Load my publishers now** for a league's administrators). Nobody else is shown it, and the page asks the database (`is_platform_admin()`, `can_manage_news_sources(league)`, the console's own checks) before drawing it. After a load the list is drawn again with the new stories.
- **Who may.** A platform administrator: any source, or all. A league's administrator: a source that is their league's own (`news_sources.league_id`); a platform source (league null) is the platform's alone. Anonymous callers and readers who administer nothing get 403, and a slug that does not exist answers them the same as one that does.
- **How it is done, and why.** `supabase/functions/news-refresh` (Deno), wired in `index.ts`, decided in `_shared/newsrefresh.js`, parsed by `_shared/newsfeed.js`. A browser cannot hold the service key, and a GitHub token to start `news-feeds.yml` would be no safer (nor would the stories appear for minutes). The function runs where the service key already is, checks the caller's own JWT against the database's own rules, reads **only the `feed_url` stored for that source** (the request names a source by slug and no more), and writes with the service role. It needs no migration: it uses the tables and functions of 0194 and the existing `audit_log`.
- **What it reads.** https only, the ordinary port, no password in the address, a public host (private IPv4 and IPv6 ranges, the odd spellings of 127.0.0.1, `localhost`, `.local`, `.internal` and single-label names are refused; a name that resolves to a private address is refused when the runtime can resolve names, or always when `NEWS_REFRESH_DNS_STRICT=1`). Redirects are followed by hand, at most three, each hop checked again. 10 s in all, 2 MB at the most.
- **What it writes.** The same stories the half-hourly reader would (`newsfeed.js` is held to `fetch_feeds.py` by `scripts/news/fixtures/parity/`: the Python writes `expected.json`, both must read it identically: RSS 2.0, Atom, RDF, JSON Feed, the 40-item cap, dedupe by guid, the excerpt, the picture, the date rules), by `(source_id, guid)`: new ones inserted, changed ones corrected, unchanged ones not touched, so pressing twice adds nothing. Stories older than 120 days are not loaded. It sets the source's `last_fetched_at`, `last_ok_at`, `last_error` and `item_count`.
  - **League tags are not matched here.** The matcher (`LeagueMatcher`) is Python-only. A story loaded by hand shows on its publisher's page and in News straight away, but on a league's own news page only after the next half-hourly read, which tags it. So that read fetches the feed afresh rather than taking a 304, the function clears the source's ETag and Last-Modified when it added anything.
  - Followers are notified as they would be for any new story (`notify_news_items`).
- **How often.** A source once in 60 s, whoever asks; a caller ten requests in 60 s. Counted in `audit_log`; an in-process claim closes the gap between two requests arriving together.
- **The audit log.** `news_refresh_call` (one per request that got past the limits: actor, source or `all`) and `news_refresh` (one per source read: actor, source id, ok, code, added, updated, total, took_ms).
- **The answer.** `200 { ok, slug, name, added, updated, total, fetched, last_error, took_ms }`, or `{ ok: false, code, error, retry_after? }` with `auth` 401, `forbidden` 403, `no_source` 404, `bad_request` 400, `off` 409 (a source that is switched off), `rate` and `rate_caller` 429, `blocked` 422, `unreachable`, `not_feed`, `too_big` 502, `server` 500. `{ all: true }` answers `{ ok, all, sources, read, failed, waiting, skipped, added, total, took_ms, results: [...] }`, four sources at a time, none started after 100 s.
- **When it is not deployed.** The gateway answers 404 (or the browser gets no answer): the button says **needs the news-refresh function deployed** and nothing else changes. The page never breaks.
- **Deploy.** `npx supabase functions deploy news-refresh` (default `verify_jwt`, so the gateway checks the JWT too; nothing to add to `config.toml`). No secrets to set: it uses the project's own `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. No migration.
- **Changing the reader.** Change `fetch_feeds.py` and `_shared/newsfeed.js` together, run `python scripts/news/fetch_feeds_test.py --write-parity` only when the change is meant, and check `node supabase/tests/news-refresh.test.mjs`.

## Creators

- **Opening an outlet.** The league switches creators on and opens an outlet, naming its owner by email. The email can be given before that person has ever signed in.
- **Running it.** The owner edits the page and adds writers. Owners and writers publish from `creators/studio/`:
  - an **article**, written in the league's news format (the same editor walk and the same cleaning);
  - or a **video, podcast, social post or link**: its address, with a caption.
- **Embeds.** YouTube, TikTok, Instagram, X, Threads, Spotify, SoundCloud, Apple Podcasts and Twitch play in place. Each is built from the platform's own embed address in a sandboxed frame. Any other address is a link card.
- **Pictures.** Since 0200 the editor uploads an outlet's own pictures into the public `creator-media` bucket, in the outlet's folder. They are resized in the browser and their EXIF is dropped. An https address still works. Photographs of the platform's players and clubs still go through the approval queue.
- **The league keeps the last word.** It can suspend an outlet or hide a piece. Either one leaves every public page at once.

## Follows and notifications

- `follow.js` has two new kinds:
  - `source`, stored in `fan_prefs.fav_source_ids`;
  - `outlet`, stored in `fav_outlet_ids`.
- The profile has a switch for them, `want_news`.
- A new story from a followed publisher becomes one notice: the headline and a line of the excerpt, linking to its story page. Several at once become one notice: "Eurohoops · 3 new stories", linking to the publisher's page.
- A source's first read is its back catalogue, and nobody is told about it.
- A creator's piece becomes a notice when it is first published:
  - an article gives its headline and standfirst;
  - a video or post gives its caption.

  Either way it links to the piece's page.
- The minute tick's `notify` function sends these like any other notice (in-app, push and email).

## Tests

- `supabase/tests/creators.test.mjs`: 0194, 0195 and 0198 on PGlite.
- `supabase/tests/creator-hub.test.mjs`: the creator hub and 0200 (`docs/creator-hub.md`).
- `scripts/news/fetch_feeds_test.py`: the reader, and finding the feed behind a link.
- `supabase/tests/newscard.test.mjs`: the card, the pill, the "why" line and the pages' wiring.
- `supabase/tests/match-plate.test.mjs`: a league's match report card and its article's head (the letters, the league's colour and logo, the score, the card's colour, the wiring).
- `supabase/tests/official-partners.test.mjs`: 0201 on PGlite (who may name a partner, what the list carries).
- `supabase/tests/game-significance.test.mjs`: 0202 on PGlite (the points and the reasons for a game).
- `supabase/tests/feedrank.test.mjs`: the ranking, the learning, the storage, and that nothing about the reader is sent.
- `supabase/tests/news-languages.test.mjs`: 0204 on PGlite (the column, the backfill, the public list, `SOURCE_LANG` in step).
- `supabase/tests/partners-ui.test.mjs`: the console's Official partner switches.
- `supabase/tests/league-creators.test.mjs`: 0207 on PGlite (who may assign, what the Community page's section shows), the console's COVERS row, the section on a stand-in page, and a creator's channel wearing its pill.
- `supabase/tests/league-picks.test.mjs`: 0209. On PGlite: who may pick for which league, and where a pick shows. On a stand-in page: the league console's list, and a pasted link the platform reads already. Also that 0209's three readers are 0198's but for the one condition.
- `supabase/tests/news-refresh.test.mjs`: the `news-refresh` function on a fake database and network: the parser held to the Python's fixtures, the address guard, who may call, the rate limits, the audit rows, idempotence.
- `supabase/tests/news-refresh-ui.test.mjs`: the **Load now** button: its words, the console's rows, who is shown it, the function missing.

All of them run in `guard.yml`.
