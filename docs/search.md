# The rail's search

The first row of the rail (where HOME used to be) is a search box: teams, players and leagues across the whole
site, with a completion as you type. Code: `epinoia/search.js` (fetched the first time the row is used), the row
itself in `epinoia/nav.js` (`navFoot`), styles at the end of `epinoia/kit/nav.css`. Migrations `0179` (the search)
and `0180` (what is searched, for the console).

## What it matches

Everything is folded first: lower case, accents off, punctuation dropped (`B.League` = `bleague`, `Łukasz` =
`lukasz`). Then, in SQL (`site_search`, `site_musts` pre-filters, `site_rank` orders):

- **Words in any order, any of them missing.** `michael diggins`, `diggins michael`, `m diggins`, `mich dig` all find
  Michael Ray Diggins Jr. A middle name, a `jr`/`sr`, a particle (`de`, `van`) is never needed.
- **Nicknames** (`mike` = Michael, `yannis` = Giannis), by a small class table in `site_nicks`.
- **A club without its brand.** Only the words typed have to be there, not the whole name: `udine` finds *OLD WILD
  WEST Udine*. A typed word may also come from the club's league (`newcastle women` picks the women's club), as long
  as at least one of the words is in the club's own name. `aliases` on a club or player (another script, an old
  name) are searched; the name shown is always the real one.
- **Typos, only when asked.** The client asks again with `p_fuzzy = true` when the first answer is empty and the
  text has four letters or more (`site_close`: one letter missing, extra or swapped). Those rows are marked
  `close` and the panel says so.
- **Rank**: exact name, then starts-with, then all words, then the rest; shorter names first inside a tier.

## What may not be found

The same rules as the pages: a league that is not `league_visible` (0139) with its clubs and players; a player
under 18 with no consent (`player_withheld`, 0049); a player whose **latest** club is in a hidden league. A free
agent (no club) is found. A row is a kind, an id, a name, a slug, where it is, a colour, a crest: no account id, no
birth year, no minor flag.

## Before 0179 is applied

`search.js` sees the function is not there (404/400 once, remembered) and asks the tables through PostgREST
instead - the same idea with less smartness (`restQueries`, `fromRest`), drawn as the answers come. Nothing to
switch.

## What is recorded (0180)

Each finished search (a result picked, or the box closed after typing) goes to `EpinoiaTrack.search` →
`analytics_search`: the folded words, how many results, which kind and page was picked, and the coarse device,
language and app. **No session token, no account, no address**. Anything that looks like an email, a phone number
(six digits or more) or a web address is never sent (`NOT_A_QUERY` in `track.js`) or kept (checked again in SQL).
The whole table takes at most 200 rows a minute, is read only by `analytics_search_report` (platform
administrators) and is pruned with the visits after 400 days. The same off switches as the visits apply
(`config.analytics`, Global Privacy Control, Do Not Track, the privacy page's switch). The privacy page says so
("What you search for"); keep it in step.

## Tests

- `supabase/tests/site-search.test.mjs` - the client, both migrations' text, the fallback, the analytics UI (no
  database needed).
- `supabase/tests/site-search-db.test.mjs` - both migrations on PGlite over stand-in tables (skipped without it).
- `supabase/tests/track.test.mjs`, `analytics-ui.test.mjs` - the tracker's `search` and the console's card.

Rules of thumb when changing it: a new word class or brand rule goes in `site_nicks` / the club-context step with a
case in `site-search-db.test.mjs`; anything that widens what is stored needs the privacy page changed in the same
commit.
