# The creator hub

Migration **0200**. The hub is at `creators/hub/`. It is reached from **your hub** on the rail, from the **your hub** page (`me/`) and from the studio.

- **For a creator:** how their work does on the site, and their writing desk.
- **For anybody:** a league's storylines, a plan for covering it, its week as graphics to post, and a set of basketball icons.

The same migration rebuilt the studio's editor. It is laid out like a newsroom's (WordPress is the model), and kept simple.

## The page (`creators/hub/`, `hub.js`, `kit/creatorhub.css`)

The page is built to the page standard (`docs/page-standard.md`). It wears the chosen league's colours (`teamcolour.js`).

| Section | What it shows |
| --- | --- |
| **Your numbers** | For the outlets the account writes for (a switch when there is more than one), over 7, 30 or 90 days. Seven cards: **seen**, **opened**, **clicked out**, **opened when seen** (the share), **readers**, **followers**, and pieces **published**. Each card shows its change against the same stretch before. Below the cards: <ul><li>a day-by-day chart;</li><li>the pieces that did best;</li><li>where readers came from: a page of this site (the News page, HOME, a league's pages, a club's…) or another site (its host only);</li><li>the devices they read on.</li></ul> Signed out, the section offers to sign in. Signed in without an outlet, it says how to get one: a league opens it. |
| **Writing desk** | The outlet's latest four drafts, its scheduled pieces and its latest four published pieces. Each opens in the editor. Buttons start a new article, video, episode or post. |
| **Storylines** | Any league, chosen from a list. The creator's own leagues come first. The choice is kept in the address (`?l=`) and in the browser. The page shows up to ten cards made from the league's public numbers (`storylines.js`): <ul><li>who is top, and by how much;</li><li>the race at the competition's play-off line (`competitions.qualifiers`), or else the bunch at the top;</li><li>the longest winning and losing runs;</li><li>the scoring, rebounding and assists leaders;</li><li>the season's single-game highs (`records.js`);</li><li>form over the last five games;</li><li>the latest upset: a winner four places or more below the loser;</li><li>the big game of the next fortnight;</li><li>a points milestone in reach;</li><li>the league's scoring.</li></ul> **Copy** puts a card's headline and lines on the clipboard. **Write about it** opens a new article in the studio with that headline. |
| **Coverage plan** | How a desk that followed the chosen league would cover it this week, from the league's newsdesk (`narrative.js`, built hourly into `snapshots/narrative/<league>.json` by `tools/build-narratives.mjs`; drawn by `newsdesk.js`; see `docs/newsdesk.md`): <ul><li>the big picture: the race, home win rate and scoring, what wins in this league, and how often each facet decided a game;</li><li>today: the results since yesterday and the games to watch;</li><li>the storylines to run, in full: why each matters, its numbers, the "yes, but", what comes next and ways to cover it, each marked new, developing or resolved;</li><li>under the radar: the best player the box plus-minus finds that the points do not;</li><li>the week ahead, game by game, biggest first: the stakes, form, what the season's numbers expect and the facet it turns on, the meetings, the fans' picks, a player to watch on each side, and how to cover it;</li><li>the recaps worth writing, from the week's games replayed through the match report engine;</li><li>players and clubs to feature, data notes and a calendar.</li></ul> A league with no hourly file yet gets a lighter plan built in the page from the table and the results, and it says so. **Copy** takes one storyline, **Copy the whole plan** the lot; **Write about it** opens a new article with the storyline's headline. |
| **Graphics** | The league's week as posts: results, each game day's scores and leaders, the table, what is coming up, and each game and its player of the game (the best BPM of the game among those who played 18 minutes, from both sides' box score lines: `bpm.js` `gameFromBox`; see `docs/graphics.md`). They are drawn by `socialcard.js`, the same way the league's own console draws them, in square (1:1), portrait (4:5) or story (9:16). Each graphic can be downloaded, and its words to post copied. **Download all** gives one ZIP, with the words as `.txt` files. Three backgrounds in the league's colours (gradient, mosaic, court) take a creator's own words and pictures. |
| **Icons** | Thirty basketball icons (`icons.js`): the ball, the hoop, the court, the shot clock, a trophy, a jersey, streaks, fixtures, the arena, a podcast, a transfer, an injury… They come in the league's two colours, white or ink, in a light, regular or bold line. Each downloads as SVG or as a PNG of 256, 512 or 1024 px. **Download all** gives both formats as one ZIP. |

## How pieces are counted (`track.js`, `newscard.js`)

| What | When |
| --- | --- |
| `seen` | A creator's card is half on screen: on the News page, in HOME's feed, on a league's pages, on the creators' pages. It counts once per page. |
| `open` | The piece's own page is opened. It records the page of the site the reader came from, or the other site's host. |
| `out` | The piece's link is followed, to its video, episode or post where it lives. This is sent at once, kept alive while the page leaves. |

**What is sent.** The piece's id, the kind, where it happened, a random per-tab token (the one visits use) and the device class (phone, tablet or computer). Nothing about the reader.

**When nothing is sent.** The same opt-outs apply as for a visit:

- Global Privacy Control;
- Do Not Track;
- the privacy page's switch;
- `analytics` off in `config.js`;
- an automated browser;
- staff who are signed in.

One more rule: an outlet's own people are never counted on their own outlet's pieces. `nav.js` keeps the outlets the account writes for, in `epinoia_my_outlets`.

**What the server keeps (`creator_track`).**

- Only published, unhidden pieces of active outlets count.
- A tab counts the same piece and kind once in 30 minutes.
- At most 50 events are taken per call, and 300 per tab in 10 minutes.
- Rows go after 400 days (`creator_events_prune`, a daily job).

**What the hub reads (`creator_stats(outlet, days)`).**

- The totals, and the same stretch before them.
- Readers: tabs that opened at least one piece.
- The day-by-day counts, the top ten pieces, the sources and other sites (eight of each), and the devices.
- Followers, and the pieces by state.

Only the outlet's people, the league's administrators and the platform's can read an outlet's figures.

## The editor (`creators/studio/editor.js`, `kit/creatoreditor.css`)

**The top bar.** Back to the pieces; where the piece stands (draft, saved at…, unsaved changes); **Settings** (shows or hides the panels); **Preview**; **Save draft**; and one button that does what the Status panel says: **Publish**, **Schedule** or **Update**.

**The page.**

- The kind: an article, or a video, episode, post or link that lives elsewhere.
- The headline.
- For an article, the text, with a toolbar:
  - the block: paragraph, heading, subheading, quote, pull quote, bulleted or numbered list;
  - bold, italic and a link;
  - a picture and an embed;
  - a rule;
  - undo, redo, and clear formatting.
- Words and reading time, as you type.

**Shortcuts.** Typed at the start of a line and followed by a space:

- `## ` makes a heading, `### ` a subheading;
- `> ` makes a quote, `" ` a pull quote;
- `- ` or `* ` makes a list, `1. ` a numbered list.

Ctrl/⌘ B, I, K and S do what they say.

**Paste** keeps the headings, lists, bold, italic and links of what was copied, and nothing else.

**Pictures.**

- **From the computer.** A picture is uploaded, or dropped on the text. It is resized to 1600 px in the browser (`upload.js`), which drops its EXIF. It goes into the public `creator-media` bucket, under the outlet's own folder.
- **By address.** An https address works too.
- **Description and caption.** Each picture has a description for screen readers and a caption.

**Embeds.** Any address the pieces play in place: YouTube, TikTok, Instagram, X, Threads, Spotify, SoundCloud, Apple Podcasts or Twitch. They sit in the text as a block, with a caption.

**The panels.**

- **Status:** draft, publish now, or schedule for a date and time.
- **Permalink.**
- **Featured image.**
- **Excerpt.**
- **Tags:** eight at most, shown as the database will keep them.
- **Search & social:**
  - the title (70 characters at most) and description (160) that search engines and link previews show;
  - a preview of the search result;
  - the post card as it will look.
- **Outline:** the headings, to jump between.
- **Revisions:** every save that changed the words. Up to 25 are kept, to look at or bring back.

**Autosave.** The piece is saved on the device every few seconds. When a newer autosave than the saved piece exists, it is offered back.

**Before 0200 is on the server.** The editor still saves, the old way: without tags, the search fields or a schedule.

## The database (0200)

**`creator_posts`** gains:

- `tags`, one form of each (`creator_tags`: trimmed, once whatever the case, GO's word list refused, eight at most);
- `seo_title` and `seo_description`;
- `edited_name`;
- the status `scheduled`.

**`upsert_creator_post`** takes the tags, the search fields and `p_publish_at`.

- A time already past publishes the piece now.
- A time more than a year ahead is refused.
- A new argument sent as null leaves what is there, so 0194's callers change nothing new.

**Scheduled pieces.** `creator_publish_due()` publishes the pieces whose time has come, and tells their followers, once.

- A pg_cron job, `epinoia-creator-publish`, runs it every five minutes.
- The hub and the studio also call it when they open.

**Revisions.** `creator_post_revisions` is filled by a trigger on every update that changes the words. It keeps 25 per piece. Only the outlet's people and the league can read them (`creator_post_revisions(post)`, `creator_post_revision(id)`).

**Article blocks.** `clean_creator_body` adds three to what the league news cleaner keeps: the pull quote (and who said it), the embed (an https address), and a picture's description. League news itself is unchanged.

**Tracking.** `creator_events`, `creator_track` (for anon), `creator_stats`, and the prune job.

**The `creator-media` bucket.**

- It is public, with files up to 3 MB, in WebP, JPEG or PNG.
- Files are named `<outlet id>/<name>.<ext>`.
- Only that outlet's people may write into its folder (`may_write_creator_media`).

## Languages

The hub is in Spanish and Japanese, in its own `creatorhub` context in `i18n/es.js` and `i18n/ja.js`. Here "Weight" is a line's weight, "Light" a weight, and "Home" the front page.

Some things stay in English, as the league's news copy does: the storylines' sentences, the graphics, and the studio's editor.

## Tests

- **`supabase/tests/creator-hub.test.mjs`** checks the pages first:
  - the editor's rules;
  - `storylines.js` on a season;
  - the icons;
  - the hub on the standard and in the rail;
  - the counting hooks;
  - the words in both languages.

  Then it runs 0200 on PGlite, including a check that the editor's tags agree with `creator_tags`.
- **`supabase/tests/track.test.mjs`** checks how a piece is counted.

Both run in `guard.yml`.

## To apply

Run `npx supabase@latest db push` (0200 comes after 0197–0199). Until it is applied:

- the hub says the numbers arrive with 0200;
- the editor saves the old way;
- nothing is counted: `track.js` stops at the first refusal.
