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
| D10 | The map drawn on EPINOIA GO: our own SVG (no dependency, no key in the page, no CSP change) with "open in Google Maps" links, vs an embedded Google map | our own SVG, 2026-09-24 (4.3): the journey itself, points and trips on a grid; no coastlines yet (no map data in the repo) |
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
      0165 is pushed it says EPINOIA GO opens soon. ja/es (pack `go`). Not in the rail yet (6.3). Chromium:
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
- [ ] **6.3** EPINOIA GO in the rail and the phone bar; docs. **Louie's call**: it is a launch decision
      (the rail and the phone bar are on every page), best made once 0163-0167 are live.
