# EPINOIA GO — the tracker

Fans stamp the arenas they go to, **at a game**, with their phone's location. Leaderboards rank fans by
arenas stamped and distance travelled, per league and across every league. "Games been to" is a public
feed of the photos fans took at the games they stamped, browsed like Spore's Sporepedia: a wall of
thumbnails with filters, sorting and a page for each one.

This file is the plan and the progress. Each step is ticked when it is on main and tested; a step that
needs Louie says so.

## Decisions

| | decision | status |
|---|---|---|
| D1 | A stamp needs a game at that arena: from two hours before tip-off to one hour after the end | agreed 2026-09-24 |
| D2 | Distance is the fan's journey: great-circle distance between consecutive stamps, in the order made, summed. Arenas are counted once; distance grows with every trip | proposed |
| D3 | Arenas are located with Google Maps; each venue keeps its Google place ID, so "open in Google Maps" is exact | agreed 2026-09-24 |
| D4 | Pinning at scale uses a Google Maps Platform key (Geocoding + Places, restricted, Louie's account): 700–900 lookups sit inside the monthly free credit. Without one, pins are looked up by hand, far slower | **Louie** |
| D5 | Only the stamp is stored (arena, game, time, reported accuracy), never the raw GPS reading | proposed |
| D6 | Leaderboards are opt-in, by username only; under-18 profiles never appear publicly | proposed |
| D7 | Photos: pre-moderated (an admin approves each before it is public) to start, relaxed to post-then-report for trusted fans later | **Louie** |
| D8 | A photo can only be posted for a game the fan stamped, which keeps the feed real and spam-free | proposed |
| D9 | Photos are re-encoded in the browser before upload, which strips the EXIF data (including the phone's GPS) | proposed |
| D10 | The map drawn on EPINOIA GO: our own SVG (no dependency, no key in the page, no CSP change) with "open in Google Maps" links, vs an embedded Google map | our own SVG, 2026-09-24 (4.3): the journey itself, points and trips on a grid. **Superseded the same day (7.6)**: Louie asked for a real map, so OpenStreetMap's raster tiles with our own pins and trip line (`go/map.js`: no library, no key, the tiles' attribution shown); journey.js removed |
| D11 | A game's arena is its own venue, else its home club's arena (`game_venue_id`, 0162). Seven feeds never name a venue, and their leagues play at fixed home arenas | done 2026-09-24 |

## Where we start (inventory, 2026-09-24)

- 46 leagues, 683 clubs. 4 clubs have a home venue on file.
- 4,850 games carry a venue name: 424 distinct strings across 24 leagues. They include duplicates, feed short
  forms (B.LEAGUE's "トヨタa", "igアリ") and placeholders ("調整中" = to be decided).
- 22 leagues store no venue at all: EuroLeague, EuroCup, Liga Endesa, the three ABA leagues, ProA, ProB,
  Kooperativa NBL, ORLEN Basket Liga, 1 Liga Mężczyzn, LNBP, U SPORTS, NBL1 Men and Women, the FEB leagues,
  Kosovo Superliga. Most of their feeds do print a venue; the adapters drop it.
- Realistic total after merging and filling: 700–900 arenas.
- Profiles have a private `display_name` (only its owner can read it); there are no public usernames.
- User photos already have a pipeline (media table, approval, public bucket, 0017) that the feed can reuse.

## Phase 1 — Arenas

- [x] **1.1 Inventory** what the database knows (above).
- [x] **1.2 The venues table** — migration `0162_venues.sql`: `venues` (name, country, address, pin, radius,
      Google place id, who checked it) and `venue_aliases` (every spelling, folded); `games.venue_id` linked by a
      trigger whenever `games.venue` is written, so the ingest, the scorer and the console all link without
      knowing; `teams.home_venue_id` learnt from home games; `game_venue_id()`, the arena of a game (D11).
      Placeholders ("調整中", "TBD") link nothing. Run on a real Postgres (PGlite) with 25 checks, twice over.
      **Live once Louie runs `db push`.**
- [x] **1.3 Venue names from every feed** — the pipeline now stores the venue on games first seen already
      played (it only did for fixtures still to come), from the schedule or else the game's own page (ABA,
      PLK, NBL, FEB keep it there). EuroLeague and EuroCup now carry venue and address. Checked every other
      feed: Liga Endesa, ProA/ProB, LNBP, Kooperativa NBL, 1 Liga Mężczyzn, Kosovo and the FEB fixture lists
      name no venue anywhere (D11 covers them). `venue_backfill.py` (schedules only, never a game) filled 615
      games (EuroLeague 380, EuroCup 224, BCB 9, LKL 2); every other league already had its venues.
- [ ] **1.4 Pin every arena** with Google Maps (D3, D4): place ID and coordinates, low-confidence matches
      flagged for a human. Two passes: the venues games name, and **the home arena of every club** in the
      leagues whose feeds name none (D11), found by the club's name and city. Two spellings that land on the
      same place id are one arena (their aliases merge).
      *Progress 2026-09-24:* `scripts/ingest/pin_arenas.py` (Places API Text Search; the key in
      `%APPDATA%\epinoia\google.json`; every lookup counted before it is sent, 1,000 a day and 4,000 a month;
      answers cached 30 days). All 488 venues looked up; 47 rows merged (one arena under a feed's short form
      and another league's full name: "トヨタA" = TOYOTA ARENA TOKYO, "大田総合" = EBARA WAVE アリーナおおた).
      Then **every pin read by hand**: 378 arenas, 86% of games, are right and marked checked; 58 carry a
      note (a car dealer, a ramen shop, a park for its gymnasium...) and 4 were not found - for most of those
      the arena's full name is now in `scripts/ingest/arena_hints.json`, to be asked with `--hinted` once the
      day's lookups allow (the first day's went on the full pass). Still to do: the hinted run, then the
      clubs pass (`--clubs`) for the leagues whose feeds name no venue. Offline tests: `pin_arenas_test.py`.
- [x] **1.5 Arena editor** — the platform console's **Arenas** tab (`epinoia/admin/platform/arenas-ui.js`):
      counts, the list with the ones that need a look first (busiest first; search by arena, town, club or
      spelling), and a card per arena: its spellings and clubs, "open in Google Maps", **right as it is**,
      **move the pin** by pasting the Google Maps address of the right place (the place's own point is read,
      not the map's centre; a nudge keeps the Google place id), flag for a look, the stamp radius, the name,
      **merge** two rows, and the command to ask Google again. Works on 0162 as it is live; the merge needs
      migration `0164_arena_editor.sql` (`merge_venues`, and a trigger that audits every change by hand and
      makes "checked by" the person signed in) - **live once Louie runs `db push`**; until then the merge says
      so. PGlite: 19 checks; Chromium: 41 (en/ja/es, phone, dark); `arena-editor.test.mjs`: 35.

## Phase 2 — Usernames

- [x] **2.1 Username** — migration `0163_usernames.sql`: its own table (profiles is writable by its owner,
      every column, so a name there could be anything), read only by its owner, written only by
      `set_username()`. Unique whatever the case, 3–20 letters, digits and underscores starting with a letter,
      the platform's own words reserved, an abuse list that sees through 0/1/3/4/5 disguises but leaves
      Dickson, Peacock and Fagerlund alone (the admin can add words), once in 30 days (case changes free).
      Leaderboards will publish names through their own functions, so a name is never tied to an account
      id in public. PGlite: 24 checks. **Live once Louie runs `db push`.**
- [x] **2.2 Asking for one** — on the profile page, first section: checked as it is typed, saved, every
      refusal in words, ja/es. `/epinoia/me/#username` opens it, which is where EPINOIA GO will send a fan
      with no name (3.4). Driven in Chromium against the real Supabase SDK: 22 checks (en/ja/es).

## Phase 3 — Stamping

- [x] **3.1 Stamps** — migration `0165_stamps.sql`: `stamps` (fan, arena, game, league, time, the accuracy the
      phone reported; never the location, D5), one per fan per game; only the fan reads theirs and may take
      one back; nobody writes one but the check; deleting the account deletes them. `stamp_attempts` logs
      every try and its reason, without a location, for the rate limit and for looking into "it would not
      stamp me" (administrators only; a fan's tries are forgotten after 30 days).
- [x] **3.2 The check** — `stamp_venue(game, lat, lng, accuracy)`: signed in; six tries a minute, thirty an
      hour; a game the fan may see, not void, inside its window (D1: two hours before tip-off to an hour
      after the end - the end is when it was finalised, else 2½ hours after tip-off, 5 while live); its arena
      (its own, else its home club's, D11) pinned and without a note; the phone inside the radius, its
      reported doubt allowed for up to 200 m; no faster than a plane (900 km/h) since the fan's last stamp.
      Every refusal has a reason and the number that goes with it (how far, when it opens, the last arena).
      `go_games_now()` lists the games a fan can stamp now or in the next day with their pins, and takes no
      location: the phone measures, so the location leaves it only at the moment of stamping. A merge moves
      stamps. PGlite: 40 checks; `stamps.test.mjs`: 30. **Live once Louie runs `db push`.**
- [x] **3.3 Location in the apps** — Android (a Trusted Web Activity: Chrome delegates the site's location
      question to the app): `locationdelegation` 1.1.2 registered in `EpinoiaDelegationService`, the two
      location permissions in the manifest. iPhone (WKWebView): `NSLocationWhenInUseUsageDescription` in
      `Info.plist`. In a phone's browser the page works already. **Needs a new release of each app
      (Louie)**: bump `epinoia/android/version.json` and `epinoia/ios/version.json`, and in App Store
      Connect's privacy answers, location is used for app functionality and not collected (never stored).
- [x] **3.4 The GO page** — `/epinoia/go/`: one button, "find the game I'm at"; the phone says where it is,
      once, and the games on now or soon are listed nearest first, measured on the phone: the one at this
      arena with **stamp this venue**, the others with how far, when stamping opens, or that the arena's pin
      is being checked. The stamp lands like a passport stamp, with whether the arena is new and the fan's
      counts; every refusal in words, with its numbers. Below, the fan's stamps. Signed out it still finds
      the game and asks for a sign-in to stamp; a fan with no username is sent to the profile (2.2). Before
      0165 is pushed it says EPINOIA GO opens soon. ja/es (pack `go`). In the rail since 6.3. Chromium:
      56 checks; `go-page.test.mjs`: 28.

## Phase 4 — Passport and leaderboards

- [x] **4.1 The numbers** — migration `0166_go_leaderboards.sql`: `go_numbers()` (internal) gives each fan's
      arenas, stamps and journey (D2: from each stamp's arena to the next one's in the order made, summed),
      overall or over one league's stamps; `go_my_numbers()` the fan's own, with their ranks if public.
- [x] **4.2 Leaderboards** — `go_leaderboard(league, by)`: overall or one league, by arenas (then distance)
      or by distance; names and numbers only, never an id or which arenas; a private league's board only
      for those who may see the league. Opt-in (D6): `set_go_public()` needs a username and "I am 18 or
      over" confirmed once (fans' ages are not otherwise recorded), and the table itself refuses a public
      row without it. On the GO page: Overall and a button per league (`go_leagues()`, with each league's
      arenas), by arenas or by distance, the fan's own row lit. PGlite: 31 checks. **Live once Louie runs
      `db push`**; until then the page shows no boards and no offer.
- [x] **4.3 My passport** — on the GO page: arenas, stamps and kilometres; the journey drawn (D10, our own
      SVG: every arena a point opening in Google Maps, every trip a line, names placed so none overlaps);
      the numbers per league with the fan's rank; the offer to go on the boards; every stamp. Worked out
      on the phone from the fan's stamps, so it stands on 0165 alone. Chromium: 58 checks (en/ja/es);
      `go-boards.test.mjs`: 35.
- [x] **4.4 Badges** — on the passport, under the counts: the first stamp, 10 arenas, 1,000 km, and every
      arena a league has played in over the last 13 months (0166's `go_leagues` counts them; a league with
      a single arena has none). An earned badge is lit like a stamp; the others show the way there (3/10,
      129 km, 3/16). Worked out on the phone from the fan's stamps, so nothing new on the server; before
      0166 is pushed the league badges are left out. `go-boards.test.mjs`: 35; Chromium: 58 (en/ja/es).

## Phase 5 — Games been to

- [x] **5.1 Photo upload** — migration `0167_go_photos.sql` and the GO page's passport: "add a photo" on
      each stamped game (D8), re-encoded in the browser to WebP at 1600 px with a 480 px tile, which drops
      every EXIF field, the phone's GPS among them (D9: proved with a real JPEG carrying a make and a GPS
      position), into the fan's own private folder; a caption checked against 0163's blocklist; three a
      game, ten a day. Never at a youth league's game (`leagues.go_photos`, closed for ABA U19, NBL U18s and
      the two Espoirs leagues) or a game with a player flagged under 18, and only by a fan with a username
      who confirmed 18 or over. The fan's own photographs, every state, each removable.
- [x] **5.2 Moderation** (D7, pre-moderation until Louie decides) — the console's Moderation tab has a
      queue of fans' photographs: approve moves both files to names that carry the photograph's id, never
      the fan's (so no public address ties a username to an account), then records it; reject records it,
      then removes the files. Three reports take an approved photograph down until a person looks.
- [x] **5.3 The feed** — `/epinoia/go/photos/`, "Games been to": a wall of square tiles, newest or most
      liked, by league, fan, arena or game, a page more at a time; a photograph whole with who took it and
      where, a like, a report, and more from the same game, arena or fan; every photograph its own link.
- [x] **5.4 Where it shows** — a fan's photographs are the wall's `?u=<username>`, a game's are `?g=<id>`.
      The game page has a "Fans at this game" strip under the game (`epinoia/go/fans.js`): up to eight
      tiles, each opening its photograph on the wall, and a link to them all; nothing at all when a game has
      none, which is most games, or before 0167 is pushed.
- [x] **Files nobody needs** — a photograph's row deleted (an account erased, most often) leaves its files'
      names in `go_photo_trash`; the list also takes a fan's upload that never became a photograph once it
      is a day old. The Moderation tab offers them ("Photograph files left behind") and removes them.

  0167: PGlite 53 checks; Chromium: posting 29, the wall 24, the queue and the sweep 16, the game page's
  strip 8; `go-photos.test.mjs`: 47. **Live once Louie runs `db push`**; until then the page and the wall
  say it opens soon, and the game page is as it was.

## Phase 6 — Finish

- [x] **6.1** Japanese and Spanish throughout: packs `go` (the GO page, the wall), `game` (the strip),
      `platform` (Arenas, the queue, the sweep), `account` (the username), `info` (the privacy page). Every
      surface driven in Chromium in ja and es with the engine's list of misses: nothing left in English but
      names.
- [x] **6.2** The privacy page, section 08 "EPINOIA GO": the location (used when a button is pressed; the
      games near you worked out on the phone; sent once to stamp and not stored), what a stamp keeps, the
      tries (the game and the reason, never the location; forgotten after 30 days, now for everybody,
      nightly, by a pg_cron job in 0165), the leaderboards (a choice, 18 or over, username and numbers only),
      the photographs (stamped games, hidden details removed on the phone, a person looks first, removable,
      never at youth leagues), and deleting the account. The Android and iPhone sections answer Location;
      the account-deletion note names the stamps and photographs. The GO page's location note links to it.
      A stamp can now be taken back from the passport ("take back"), as 0165 always allowed and the page
      says. Chromium: 17 checks (en/ja/es, a phone's width).
- [x] **6.3** EPINOIA GO in the rail - Louie, 2026-09-24, once 0163-0167 were live: the row under
      "leagues" in the first rail (and so in the phone's menu sheet), EPINOIΛ in the logotype and GO in
      Orbitron 700, his pick of four Y2K faces (Google Fonts, SIL OFL; `kit/fonts/orbitron.woff2`, 6.5 KB,
      declared in the kit and in nav.css, which loads without it). Lit on the GO pages; never
      translated. The phone's bottom bar is unchanged (not asked for). Chromium: 17 checks (desktop
      light and dark, the GO page, ja/es, the phone's sheet); `go-page.test.mjs`: 31.

## Phase 7 — The redesign (Louie, 2026-09-24)

Louie's brief, in order down the page. Styles in `go/go.css` (shared by the GO page and its stamps page).

- [x] **7.1 The intro** — on a first visit, the screen fades to black (white on the dark theme) and asks
      "Please Enter A Username." in the site's sans serif; a signed-in fan types one there (0163's
      `username_check` as they type, `set_username` to save), then "Have Fun!" takes the prompt's place in the
      middle, holds, and the page comes back. A fan without a username is asked on every visit until they
      choose one or say "later" (for that visit). Signed out, it says why an account comes first, with sign
      in and "just looking". A fan who has a name sees only "Have Fun!", once. Reduced motion: the same, fast.
- [x] **7.2 The hero** — EPINOIΛ GO blown up in the top middle with a drop shadow, GO in neon green with a
      glow (it flickers on, then breathes); under it, on the same panel (a third of the screen at least),
      the Milky Way photograph Louie chose (`go/img/stars-2400.jpg`, 1200 on a phone), inverted on the dark
      theme; "find the game I'm at" restyled as a neon pill under the logo, and today's counts. The logo is
      sized from the panel's own width (container units), so it fits beside the rail and under the kit's
      zoom. **Louie: the photograph's licence** (from rawpixel).
- [x] **7.3 Arenas to tick off** — cards on a strip that slides across the screen (paused on hover; still
      with reduced motion): the arenas of the fan's country that have a club and that the fan has not
      stamped, each in its club's colours with its crest, or the arena's photograph where a fan's approved
      one exists; each opens in Google Maps. The country: the one picked before (a picker beside the
      title), else the country of the clubs and leagues the fan follows, else where their stamps are, else
      the time zone, else the language's region.
- [x] **7.4 The leaderboard** — three ways, each explained on its own button: distance (kilometres between
      arenas, in the order made), games (every game stamped) and venues (each arena once); overall or by
      league; the podium in gold, silver and bronze, the fan's own row lit. By games is new: migration
      `0168_go_notes_and_games_board.sql` ranks it on the server, and the page ranks again, so it is right
      before 0168 is pushed too.
- [x] **7.5 THE FEED** — two rows of the fans' approved photographs (0167), one card changing at a time; with
      none, the card outlines faded and "Prove your fandom — show your pictures of games". Two small buttons:
      "add yours" (the stamps page, where each game takes a photograph) and "see the full feed" (the wall).
      **Louie: the brief's sentence about a small button was cut off** — this is a guess.
- [x] **7.6 Your stamps** — the latest six as cards like the strip's: the date, which game of the fan's it was
      (#4), the teams with their crests and the score, and the trip that led there (115 km · from which
      arena). "all your games" opens `/epinoia/go/stamps/`: the numbers and badges (4.4, moved here), the
      map (D10: every arena pinned and numbered in the order gone, the trips drawn; zoom, pan, fit), and
      every game, newest first, with the distance from the one before, the note, a photograph, take back.
- [x] **7.7 A note about the occasion** — after a stamp, an optional note (and the photograph form); on the
      stamps page, add or edit one per game. 0168: `stamps.note`, 280 characters, read only by the fan
      (0165's own-read policy), written only by `set_stamp_note()`. Before 0168 is pushed the page asks
      once, finds no column, and offers no note.
- [x] **7.8 The logo wherever the name is written** — `go/logo.js` turns every "EPINOIA GO" in a page's
      text into the logo (EPINOIΛ in the logotype, GO in Orbitron, the rail's pair; the kit styles it),
      after translation, so Japanese and Spanish keep it too: the GO pages, the wall, the privacy page and
      the platform console. Not in a browser tab's title, which cannot take a font.

  Japanese and Spanish throughout (packs `go`, `info`, core for the rail's tooltip): every state harvested
  in Chromium, nothing left in English but names. The privacy page's "What a stamp keeps" names the note,
  and "The leaderboards" the games. 0168: PGlite 28 checks. Chromium: the intro 29, a stamp with its note
  and the stamps page 20 (with and without 0168), screenshots light and dark, desktop and phone, en/ja/es.
  `go-page.test.mjs`: 61, `go-boards.test.mjs`: 36. **0168 is live once Louie runs `db push`.**

- [x] **7.9 GO's own rail and bar** (Louie: "Home (typical Epinoia GO page), FEED + Your Stamps pages be an
      additional rail coming off of EPINOIA GO") - "EPINOIΛ GO ›" in the rail now opens GO's own layer, a
      seventh panel on the deck (`nav.js` goPanel): the way back, the logo (the GO page), then **home** (the
      GO page), **feed** (the wall) and **your stamps**; GO's pages open the rail on it with their own row
      lit. On a phone the bar on GO's pages is GO's: home, feed, stamps, profile, and the menu opens on GO's
      layer. GO's pages are nobody's league now (`PLATFORM_PAGE`), which also fixes the wall's own `?l=`
      filter drawing a league's tab bar with dead links. The wall is called **THE FEED** throughout, as the
      GO page calls it ("Games been to" before). Chromium: 29 checks (desktop, phone, the sheet, ja/es).
- [x] **7.10 Demo clubs gone; one arena, every club on its card** - the demo league (0004) had been deleted,
      but its four clubs were left with no league, 22 games and 48 players, and still the home clubs of four
      REAL arenas (0035 gave them real addresses to test the map), so Neon City showed on the Emirates
      Arena's card. Migration `0170_go_demo_clubs_gone.sql` deletes exactly those (the demo slugs with no
      league; their games only where both sides are demo clubs, else it stops; their players by the demo
      prefix with no club) and makes `go_games_now()` offer only a league's games; the arenas stay (real,
      pinned, checked). The strip also shows only clubs whose league the reader can see (the embed of the
      club's league, so a private league's clubs stay private too). Two clubs sharing a building - the
      Sharks and the Hatters at the Canon Medical Arena - were already one arena (one venue row: a stamp at
      either club's game ticks it off, and the Venues count counts it once); the card now shows both
      crests and both names, and one club in two competitions (London Lions, SLB and EuroCup) once. A
      league's own board and badge still count that league's games. 0170: PGlite 15 checks (the live state
      reproduced first; a mixed game stops it). **Live once Louie runs `db push`**; the strip already hides
      the demo clubs without it.
- [x] **7.11 Today's games as a list; the intro at once; "Have Fun!" once** (Louie, the same night) - "Games
      open to stamp now" and "Today and tomorrow" are buttons: a hover (where a pointer can hover) or a press
      lists their games - league, tip-off, open now or when stamping opens, the teams (a link to the game),
      the arena, and how far each one is from the fan, nearest first for the open ones; at the arena with its
      window open, "stamp this venue" is right there. A drop-down under the chips on a desktop, a sheet from
      the foot of the screen on a phone; the list scrolls. How far is worked out on the phone from the list
      `go_games_now` already sent - the location still goes to the server only in the stamp call; a press asks
      the phone (the browser asks the fan first), a hover only uses a location the site may already have. The
      privacy notice's three location answers say so (en/ja/es). The intro now comes up before the page
      paints: `go/intro-early.js` (head, not deferred) decides from this browser's storage alone - the session,
      the first-visit mark, and whether this account has a username (a yes/no, never the name, remembered
      by go.js) - and every mode's words are in the page, so nothing waits for a script or the database.
      "Have Fun!" is the first visit's only: on a later visit the question (a fan still without a username)
      gives the page straight back. Chromium: the list 21, the intro 18 (four with go.js blocked);
      `go-page.test.mjs`: 90.
- [x] **7.12 The arenas strip is the fan's to move** (Louie, the same night) - draggable with the mouse (a drag
      over a card does not open it), swipeable, and an arrow at each end that moves it by most of a screen; it
      still slides on its own, waiting while a pointer is over it, something in it has focus, or the fan has
      just moved it. With three or more arenas it is a ring (going past either end comes round; enough copies
      of the cards, the extra ones hidden from readers, that the window always has cards under it); fewer is a
      plain row with arrows only if it overflows. Under reduced motion it does not slide and the arrows jump.
      Real browser scrolling underneath (`go.js` mountStrip), so touch, trackpad and keyboard focus all work.
      Chromium: 19 checks (desktop, phone, a short list, reduced motion, redrawing on a country change).
