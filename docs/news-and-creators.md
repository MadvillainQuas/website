# News, publishers and creators

Migrations **0194** (the schema) and **0195** (the sources to start with). What the site carries besides a league's own news:

- **Publishers.** A news site read by its feed: Eurohoops, BasketNews, a federation's site.
- **Creators.** An independent podcast, channel or writer that a league gives a page of its own.

Both appear on the platform's **News** page, in **HOME's FEED**, on each league's news page and on the league's front page. Readers can follow either one.

## Where things are

| Page | What it is |
| --- | --- |
| `news/` | Everything on the post card, **For you** (ranked on the reader's device) or **Newest**. Switches for Everything, Publishers, Creators, League news and Following; the ranking applies within each. A row of the publishers, and **Personalise**. |
| `news/?s=<slug>` | A publisher's page: its head in its colours, the way to its site, a follow bell, its stories. |
| `news/?i=<id>` | One story, where a notification lands. The publisher's colourway, the headline centred, the opening lines, and a button to read it on their site. |
| `news/?l=<league>` | The league's own archive as before. Under it, **Around the league**: the publishers' stories about the league (its league tags) and its creators' pieces. |
| `creators/?l=<league>` | The league's creators as tiles, and their latest pieces. |
| `creators/?l=&o=<outlet>` | An outlet's page: head, platforms, bell, bio. Its videos, episodes and posts play in their cards. |
| `creators/?l=&o=&p=<piece>` | One piece in the outlet's colourway. An article, or the video / episode / post itself with its caption. |
| `creators/studio/` | Where an outlet's people write. |
| HOME, **Feed** | Six cards, under My followed. **For you** (the default) is the ranked feed below; **Followed** shows what the reader follows (leagues, clubs' leagues, publishers, creators), newest first; **Newest** shows everything, newest first. The choice is remembered. **Personalise** sits beside them. |
| A league's front page, **Creators** | The three latest pieces and a row of the outlets. Absent while creators are off or nothing is published. |
| The rail | **News** on the platform panel. **Creators** on a league with some (probed). **Creator studio** in the hub for an outlet's people. |

## The post card (`epinoia/newscard.js`, `kit/newscard.css`)

The card uses the brand's colour, and its logo on a disc when there is no picture, or as a badge over the picture when there is. Under that: who, when, the headline, and the first line or two of the excerpt.

The headline is the card's one link, and it covers the card. The league tags and the foot (the publisher's or creator's page here) are links of their own that sit above it. A link is never nested inside another.

A logo ending `#fill` fills its square, and is drawn to the edge of the disc. The fetcher decides this: see `fills_square`.

## Official partners (0197)

The platform can name a news source or a creator outlet an **official partner**. Only a platform administrator can; a league can add a source or open an outlet but not call it a partner.

- **The flag.** `news_sources.official_partner` and `creator_outlets.official_partner`, default false, set by `set_official_partner(kind, id, on)` (platform administrators only, audit-logged as `set_official_partner`). The tables stay closed (RLS on, no grant).
- **The list.** `official_partners()` (open to everyone) returns `[{kind, slug}]` for sources that are on, and `[{kind, slug, league}]` for outlets that are active and shown (an outlet's slug is unique only within its league, so its league's slug is part of its key). The keys are `source:<slug>` and `outlet:<league>/<slug>`. Every page that shows a card asks once per page; the answer is cached for an hour.
- **The console.** Platform console, **News** tab, **Official partners**: every source and every outlet with an *Official partner* switch. It asks before it changes anything (`official_partners_admin()`, platform administrators only, lists them).
- **The pill.** A small gold teletext block, *Official partner* (`.pc-partner`, `kit/newscard.css`), black on gold in both themes. On a card it sits on the plate at the bottom left, away from the headline and under the headline link's cover, so the card is still pressed anywhere; a card with no plate carries it in its kicker. It is also in the head of a publisher's page, a creator outlet's page and a story or piece, in the row of publishers, and on a creators' tile.

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

**What a game is worth** (`game_significance(game ids)`, `news_report_significance(article ids)`, 0198; up to 60 games a call, only for leagues the caller may see; a withheld player is never named):

| | points | reason |
| --- | --- | --- |
| Table (each club has played 3 games, same group) | 30 / 22 / 10 / 18 | 1st v 2nd / a top-three clash / a top-four club against one within two places / a top-three club beaten by the bottom third of a table of six or more |
| Players | 25 / 40 · 28 · 14 / 18 / 4 / 10 | triple-double / 50+, 40+, 30+ points / 20 points and 20 rebounds / a double-double (only when there is neither of the first) / a 30+ game nobody in the competition has beaten or matched |
| Stage | 50 / 30 / 18 / 8 | a cup or playoff final / semi-final / quarter-final / any other tie (or a playoff game with no tie) |
| Extras | 14 or 8 / 6 | double overtime or overtime / decided by 1 to 3 points |

The groups are capped (table 30, players 45, stage 50, extras 30) and the game at 100. The reasons are short strings, the most valuable first (`Cup final`, `Top-of-the-table clash: 1st v 2nd`, `34-point game: <name>`). A plain report is under a publisher's story; a cup final, or the top two meeting with a big night, can outrank an ordinary story; a very fresh report for a league the reader follows or has spent time on can surface. These are weights, not a filter: the weights in `feedrank.js` can be tuned without a migration, the points in `0198`.

**Variety.** Never more than two in a row from one source, and no more than two boosted partner items in the first six.

**Why.** Each ranked card has a line saying why (*Official partner*, *Cup final*, *You follow NBL*, *Because you read a lot about NBL*, *Because you read Eurohoops*, *Popular where you are*, *From a publisher*...).

**Personalise** (the button in the feed's heading on HOME and the News page, and the privacy page): a switch and *Reset what the site has learned*. Off means the feed is the newest first, nothing is recorded, and what was learned before is left as it is; the switch (`epinoia_feed_v1_off`) survives a reset. A reset deletes the profile; what the reader follows belongs to their account and is untouched. The privacy page says all of this in plain words.

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

## Creators

- **Opening an outlet.** The league switches creators on and opens an outlet, naming its owner by email. The email can be given before that person has ever signed in.
- **Running it.** The owner edits the page and adds writers. Owners and writers publish from `creators/studio/`:
  - an **article**, written in the league's news format (the same editor walk and the same cleaning);
  - or a **video, podcast, social post or link**: its address, with a caption.
- **Embeds.** YouTube, TikTok, Instagram, X, Threads, Spotify, SoundCloud, Apple Podcasts and Twitch play in place. Each is built from the platform's own embed address in a sandboxed frame. Any other address is a link card.
- **Pictures are https links.** An outlet has no uploads; photographs on the platform go through the approval queue.
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

- `supabase/tests/creators.test.mjs`: 0194 and 0195 on PGlite.
- `scripts/news/fetch_feeds_test.py`: the reader.
- `supabase/tests/newscard.test.mjs`: the card, the pill, the "why" line and the pages' wiring.
- `supabase/tests/official-partners.test.mjs`: 0197 on PGlite (who may name a partner, what the list carries).
- `supabase/tests/game-significance.test.mjs`: 0198 on PGlite (the points and the reasons for a game).
- `supabase/tests/feedrank.test.mjs`: the ranking, the learning, the storage, and that nothing about the reader is sent.
- `supabase/tests/partners-ui.test.mjs`: the console's Official partner switches.

All of them run in `guard.yml`.
