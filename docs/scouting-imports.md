# Global scouting: the Imports tab

The Imports tab turns the files a scouting extension saves into one table to sort and filter. Those files are `fa_results_<date>.csv`, one row per player on a team's roster.

- **Where:** global scouting (`scouting/`), on a **Leagues / Imports** switch under the page's head. **Leagues** is the page as it was. An address ending `#imports` opens on the tab.
- **The code:** `epinoia/scouting/imports.js` (`window.EpinoiaScoutImports`).
- **The styles:** `kit/scouting.css`. The table is the scouting table's own `table.ft` from `kit/table.css`.

## Who sees it

Scouts and platform administrators. Every platform administrator is a scout already.

The page asks `scout_access()` once somebody is signed in, with their own token. The switch is drawn only when the answer is yes. A visitor who is signed out never triggers the check.

### Naming a scout (migration 0210)

In the platform console's **Accounts** pane:

- **Grant a role** has **scout**, by email address. The address does not need an account yet: the role holds from the moment they sign in with it.
- The **Scouts** list under it shows every scout, whether the address has signed in, and an **end** button.

A grant needs a **confirmed** address. Somebody who signs up with an address they do not own is not a scout, whatever the grant says.

| Function | Who may call it | What it does |
| --- | --- | --- |
| `is_scout()` | signed in | the caller is a scout or a platform administrator |
| `scout_access()` | signed in | `{scout, platform}`, for the page |
| `grant_scout(email, note)` | platform admin | names a scout. The same address twice is one grant. Audit-logged |
| `revoke_scout(email)` | platform admin | ends it. The row stays, as the record. Audit-logged |
| `scouts_list()` | platform admin | every live grant, with whether the address has a confirmed account and when it was last seen |

`platform_scouts` has row-level security on and no policy. It is read and written through these functions only.

## The files stay in the browser

The files are read in the scout's browser and kept there, in IndexedDB (`epinoia-scout-imports`), so they come back the next time the tab is opened. Nothing of them is sent to Epinoia. The role guards the tool, not data on the server.

The filters and the sort are remembered on the device too (`localStorage`, `epinoia.scout.imports.view`). If the browser keeps nothing (a private window), the tab still works for that visit, and says so.

## Reading a file

The extension's columns are:

`country, league_tab, team, player, url, height_cm, pos, born, eb_height_cm, eb_weight_kg, agent, last_season, _json`

`_json` repeats all of it, with the player's last-season lines. Each line is a season, team, league, games and per-game numbers (MPG PPG RPG APG SPG BPG TPG 2P% 3P%).

- The table is built from `_json` where it is there, and from the columns where it is not. Without `_json`, the lines come from `last_season` ("25-26 Argentino Junin (ARG-1); 25-26 Argentino (ARG-4)"), with no numbers.
- The stat columns are whichever stats the files carry, in their order. A stat the extension adds later becomes a column with no change here.
- A file saved again by a spreadsheet with `;` between its fields reads as well.
- A CSV that is not the extension's is refused with the reason. A file that is not a CSV is not read.

### What is tidied

- **A birth year run into the position.** Australia's rosters give "G2000": a guard born in 2000.
- **A height only on the Eurobasket profile** (`eb_height_cm`) is the height.
- **Seasons written "25-26" and "2026"** are compared by the year they end (2026).
- **The current season** is the one most players' numbers are from, not simply the newest: a few players already have lines for next season's first games.
- **A player's line in the table** is his latest season's, the one with the most games. "+1" by his name means another line that season. Every line opens under his row (the ▸ button).
- **A season only just begun** (fewer than 5 games) gives way to the full season before it.

### Several files

Several files are one table:

- A player in two files (the same profile link) is there from the file loaded last only.
- Within one file every row stays: a player on two rosters, his league's and a European cup's, is on both.
- The same file loaded twice is one file. It is known by its text.

## The table

**Columns:** `#`, player (his profile in a new tab), position, born, age (the age he turns this year), height (cm), weight (kg), country, league tab, team, agent (his page), then the line the numbers are from (season, team, competition), games, and every stat.

- **Sorting.** A header sorts by its column; press again for the other way. Numbers sort high first, and words A to Z. An empty value is always last.
- **Shading.** Each stat is shaded by where it ranks, as on the scouting table: green from the 60th percentile, nothing between 40 and 60, red under 25. Turnovers rank the other way. The ranking is among players with 5 games or more, so one game's 80% does not set the scale; every row is still shaded.
- **Paging.** 100 rows at a time, with **Show more**.

**Filters:**

- words in the name, team, agent, country or league;
- the country, and the league within it;
- guards, forwards, centres (a G/F counts as both);
- with an agent, or without.

Behind **more filters**, which shows how many of them are set:

- born, height and weight ranges, with "keep players with no record of it";
- this season's numbers only;
- up to six stat filters (a stat, at least or at most, a value).

**download these as a CSV** saves what is shown, in its order, with the profile and agent links.

## Words

Spanish and Japanese, in the core packs' own `imports` context (`data-i18n-ctx="imports"`). The names, teams, leagues and agents in the table are never translated.

## Tests

`supabase/tests/scout-imports.test.mjs` uses a made-up file in the extension's shape (no real player or agent is in the repository). It checks:

- the reader and the tidying;
- several files as one table;
- the filters, the sort, the shading and the CSV;
- the tab on a stand-in document;
- the page's wiring and words;
- the platform console's scout;
- on PGlite, migration 0210.

It runs in `guard.yml`.
