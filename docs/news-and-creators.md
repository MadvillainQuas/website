# News, publishers and creators

Migrations **0194** (the schema) and **0195** (the sources to start with). What the site carries besides a league's own news:

- **Publishers.** A news site read by its feed: Eurohoops, BasketNews, a federation's site.
- **Creators.** An independent podcast, channel or writer that a league gives a page of its own.

Both appear on the platform's **News** page, in **HOME's FEED**, on each league's news page and on the league's front page. Readers can follow either one.

## Where things are

| Page | What it is |
| --- | --- |
| `news/` | Everything, newest first, on the post card. Switches for Everything, Publishers, Creators, League news and Following. A row of the publishers. |
| `news/?s=<slug>` | A publisher's page: its head in its colours, the way to its site, a follow bell, its stories. |
| `news/?i=<id>` | One story, where a notification lands. The publisher's colourway, the headline centred, the opening lines, and a button to read it on their site. |
| `news/?l=<league>` | The league's own archive as before. Under it, **Around the league**: the publishers' stories about the league (its league tags) and its creators' pieces. |
| `creators/?l=<league>` | The league's creators as tiles, and their latest pieces. |
| `creators/?l=&o=<outlet>` | An outlet's page: head, platforms, bell, bio. Its videos, episodes and posts play in their cards. |
| `creators/?l=&o=&p=<piece>` | One piece in the outlet's colourway. An article, or the video / episode / post itself with its caption. |
| `creators/studio/` | Where an outlet's people write. |
| HOME, **Feed** | The six newest cards, under My followed. **Followed** shows what the reader follows (leagues, clubs' leagues, publishers, creators). **Newest** shows everything. The choice is remembered. |
| A league's front page, **Creators** | The three latest pieces and a row of the outlets. Absent while creators are off or nothing is published. |
| The rail | **News** on the platform panel. **Creators** on a league with some (probed). **Creator studio** in the hub for an outlet's people. |

## The post card (`epinoia/newscard.js`, `kit/newscard.css`)

The card uses the brand's colour, and its logo on a disc when there is no picture, or as a badge over the picture when there is. Under that: who, when, the headline, and the first line or two of the excerpt.

The headline is the card's one link, and it covers the card. The league tags and the foot (the publisher's or creator's page here) are links of their own that sit above it. A link is never nested inside another.

A logo ending `#fill` fills its square, and is drawn to the edge of the disc. The fetcher decides this: see `fills_square`.

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
- `supabase/tests/newscard.test.mjs`: the card and the pages' wiring.

All three run in `guard.yml`.
