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
| D10 | The map drawn on EPINOIA GO: our own SVG (no dependency, like the country outlines) with "open in Google Maps" links, vs an embedded Google map (API key in the page, CSP change) | decide at 4.3 |
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
- [ ] **1.5 Arena editor** in the platform console: the list, unpinned and flagged first, move a pin, merge two
      names that are one arena.

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
      with no name (3.4). Driven in Chromium against the real Supabase SDK: 18 checks.

## Phase 3 — Stamping

- [ ] **3.1 Stamps** (migration): fan, arena, game, time, accuracy. Only the fan reads their own; deleting the
      account deletes them.
- [ ] **3.2 The check** (server side): within the arena's radius allowing for the reported accuracy, a game on
      there (D1), one stamp per game, no impossible travel between two stamps, rate-limited. Every refusal
      says why.
- [ ] **3.3 Location in the apps**: the Android app (location permission, WebView geolocation prompt) and the
      iPhone app (location usage text). Needs a new app release each.
- [ ] **3.4 The GO page, "Stamp this venue"**: the games on now or soon near you, one button, the result.

## Phase 4 — Passport and leaderboards

- [ ] **4.1 The numbers** (SQL): arenas stamped and journey distance (D2) per fan, per league and overall.
- [ ] **4.2 Leaderboards**: Overall and one button per league, arenas or distance, opt-in (D6).
- [ ] **4.3 My passport**: every arena stamped on a map (D10), the journey, the distance, per league.
- [ ] **4.4 Badges** (optional): first stamp, 10 arenas, every arena in a league, 1,000 km.

## Phase 5 — Games been to

- [ ] **5.1 Photo upload** from a stamped game (D8): re-encoded in the browser (D9), size-limited, a caption.
- [ ] **5.2 Moderation** (D7): the approval queue in the console, a report button, auto-hide on reports.
- [ ] **5.3 The feed**: the thumbnail wall, filters (league, club, arena, fan), newest / most liked, likes, a
      page per photo.
- [ ] **5.4 Where it shows**: "Fans at this game" on the game page, a fan's photos on their GO profile.

## Phase 6 — Finish

- [ ] **6.1** Japanese and Spanish throughout.
- [ ] **6.2** The privacy page (location stamps, photos) and account deletion covering both.
- [ ] **6.3** EPINOIA GO in the rail and the phone bar; docs.
