# Who's your favourite?

HOME's prompt for a fan who follows no club: a panel unrolls out of the line under the daily
fixtures, black in the light theme and white in the dark, and asks which leagues they prefer to
watch, then which clubs they back. **What they pick is followed**, in the same lists every bell
writes, so it is on their profile, in the rail's "your follows" and in MY FOLLOWED at once.

Migration `0161_favourites_prompt.sql`; the page is `epinoia/home/favourites.js` +
`epinoia/home/favourites.css`, mounted into `#favourites` in `epinoia/home/index.html`. Tests:
`supabase/tests/favourites.test.mjs` (the once rule, the rows, the store, follow.js's new options,
the wiring, the migration, the words).

## Who is asked, and when

Anybody **signed in who follows no club** (`fan_prefs.fav_team_ids` is empty), **once**: a first
sign-in, and everybody already signed in when this arrived. Following leagues, players or games and
no club still counts as no club. It opens by itself as the line scrolls into view, half a second
after, and never takes the reader's scroll position or keyboard.

A fan who follows leagues but no club opens **straight onto "Who do you back?"** for those leagues
(one click, "Add more leagues", back to the countries). A fan who follows nothing starts at the
countries. Opened by hand from the line, it always starts at the countries.

The logic is the fans' vote's (`shouldAutoOpen`, run by the test):

- **Seen** is a note in this browser for this account: closing with the ×, finishing, or just
  scrolling past all count. It does not open by itself again.
- **Remind me later** brings it back on the first visit six hours on.
- **Don't show this again** turns it off for good. Signed in, that is the account's switch
  (`fan_prefs.want_favourites`, 0161), which the profile page can turn back on, on every device;
  the browser keeps its own note too, and where the database has not taken 0161 yet it is the
  browser's note that holds (the page asks for the column tolerantly, and `set_fan_prefs`, which
  reads only the keys it knows, ignores the one it has not been taught).
- A club followed ends it: nothing is asked of somebody who follows a club.

Notes are in `localStorage['epinoia.favourites']` as `{ users: { <account id>: { at, later? |
never? } } }`, one per account so a shared browser asks each account once, the newest twelve kept.
"Once" is per browser, as the fans' vote's is: a fan on two devices who follows no club on either
sees it once on each unless they say never.

## The line

The line under the daily fixtures (a 3px bar, the panel's colour) is the handle, always there,
for everybody: hover or focus shows its tab, "Who's your favourite?", and on a touch screen the tab
is simply there. It opens the panel by hand at any time, to add another favourite, and closes it
again while it is out. **Signed out**, it leads to sign-in with `next=…#favourites` and comes back
with the panel open (`#favourites` in the address opens it by hand for a signed-in reader too).

## The screens

A deck of four, sliding as the rail's panels do (the deck's height follows the one in view):

1. **Countries** — "Who's your favourite? / Which leagues do you prefer to watch?" A strip of
   country cards, **ten in view** where the panel is wide enough (the widths are the kit's own
   pixels: the body is zoomed 1.25 from a 1000px viewport and 1.5 from 1200px, so a 1910px screen
   gives the panel about 1090), with ‹ › buttons (a swipe on a phone, where the buttons go). Each
   card is the flag on a paper tile (the drawn flags of `brand/flags`; a league in two countries
   shows both), the count of leagues, and how many are followed. "Other leagues" holds the unfiled.
   Private leagues are never offered.
2. **A country's leagues** — the country, a way back, and its league cards (logo or monogram, club
   count). Tap to follow, tap again to stop. Then **Pick another league** or **Advance**.
3. **Who do you back?** — one strip of every club in the leagues followed (each league's clubs by
   name, the league on the card's band where leagues are mixed). Tap to follow. **Add more
   leagues** or **Done**.
4. **You're in** — what is followed, closing itself after a few seconds unless touched.

**Skip** is the one button in the place of Advance/Done until something is picked, and closes the
panel as seen (from the countries or leagues) or finishes (from the clubs). The × and **Remind me
later** / **Don't show this again** are on every screen.

Picks are shown at once and saved one after another (`follow.js` `toggle(kind, id, name,
{ want, quiet })`: set rather than flip, no push offer per pick), so the last tap is what the
database ends up holding; a save that fails is put back with a word on the screen's hint line.
When the panel closes on a change, **MY FOLLOWED is drawn again** (`EpinoiaHome.refresh('followed')`)
and the push offer is made **once**, for the first club followed (or league), unless the fan said
later or never. Every follow that saves says so on the window (`epinoia:follows`), which the rail
listens for.

## Reading the data

The public leagues come from `EpinoiaGlobalGames.leagues()` (already read for the fixtures), the
club counts from one small `teams?select=league_id`, the clubs of the followed leagues from one
`teams?league_id=in.(…)`. The follow lists come through `follow.js`, never `access.js`, which sends
no token on HOME. The account's switch is one tolerant read of `fan_prefs?select=want_favourites`.
No request is made for a signed-out visitor, and none beyond the follow lists for a fan who
follows a club.

## Words

Japanese and Spanish are in `ctx.favourites` (the anchor carries `data-i18n-ctx="favourites"`), so
the panel's "Done", "Skip" and "Following" cannot disagree with the scorer's or the API page's.
League and club names are `translate="no"`. The profile's switch is in the `account` pack.

## Deploying

1. `npx supabase@latest db push` (0161 after 0160). It adds `fan_prefs.want_favourites` and
   re-creates `set_fan_prefs` (0150's, plus one line). Until then everything works, and "don't show
   this again" is per browser.
2. The site.
