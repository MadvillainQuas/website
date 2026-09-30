# Conferences, groups and divisions

How a league whose table is more than one ladder is set up and read. Introduced 2026-09-23 with
migration 0144, for U SPORTS (conferences) and ProB (groups).

## The three shapes

| `competitions.format` | the table | ranked by | example |
|---|---|---|---|
| `table` | one table | league points, point difference, points for | SLB, BCB, ProA |
| `groups` | one table per `group_name` | the same, within each group | ProB Nord / Süd |
| `conferences` | one table per conference (`group_name`), divisions (`division_name`) inside it; two records per club | conference win %, conference wins, overall win %, then the above — within each division | U SPORTS |

A **conference game** is a game between two members of the same conference in the regular
season. The **overall** record is the complete schedule (conference, non-conference and
postseason games). Exhibitions count in neither and are never ingested.

`games.conference_game` decides per game: `null` = derive (both clubs entered under the same
`group_name`), `true`/`false` = stated by the feed or an administrator. Any postseason game is
`false` — a conference playoff is two members of one conference and is not a conference game.
Changing it on a game needs `can_manage_game` (0144's `games_write_guard` clause).

## Who is in which group

Not in any feed. Kept in `config/groups/<league>.json` and applied by the ingest
(`scripts/ingest/groups.py`) whenever it enters a club in the competition. The source row opts in:

```json
{ "code": "USPORTS", "groups_file": "config/groups/usports.json", ... }
```

- `config/groups/usports.json` — 48 clubs. Conferences from masseyratings.com's conference pages
  (2026-09-23), identical club for club to U SPORTS' own standings; divisions from U SPORTS' own
  2025-26 standings: Canada West Pacific (7) / Prairie (10), OUA Central / East / West (6 each),
  AUS (8) and RSEQ (5) undivided. masseyratings' sub-groups (OUA East/West of 9, AUS
  Baldwin/Nelson) are not the league's and are not used.
- `config/groups/prob.json` — ProB Nord / Süd, from the league's schedule pages, 2025-26 and 2026-27.

A new season with different membership gets a block under `seasons`. After the first ingest run
of a season, read the log for `is in no group of` lines: each is a club that will appear under no
conference until the file names it. `python scripts/ingest/groups_test.py` validates every file.

An administrator can still set groups by hand in the console (Formats) for a league whose source
has no groups file; the ingest never touches those.

### When the feed says so itself: NBL1

NBL1 (Australia) is served one season per conference and gender ("2026 South Men"), so every
fixture already knows its conference. Its source rows say `"groups_from_feed": true` (and
`"competition_format": "groups"` on the regular season): `adapters/nbl.py` puts each fixture's
conference on it (`extra.home_group` / `away_group`, e.g. "NBL1 South"), run_ingest hands the
discovered games to `groups.learn()`, and from then on the run treats that membership exactly as it
would a file's. No file to keep for ~140 clubs that change every year. A run that discovers nothing
(the live lane) learns nothing and leaves every club's group where the last discovery put it.

NBL1 is a `groups` competition, not `conferences`: its clubs only ever play their own conference
before the finals, so a conference record would repeat the overall one. The heading is the group's
own name: `groupLabel` writes "Group X" only for a one-word group ("Group Nord", "Group A"), so a
group named "NBL1 South" is headed "NBL1 South".

NBL1 is also the one calendar-year league (March to August): its rows say `"season_calendar": true`
and play in a season named for the year ("2027", 1 Jan - 31 Dec), not the August cut-over's
"2026-27", which would put its finals in a different season from its ladder. `"first_season":
"2027"` keeps the rows quiet until then; writing `"season": "2026"` into the rows reads a past one.

## Reading it

`epinoia/standings.js` (shared) — `epinoia/l/league.js` draws a conference league as
**By conference** (a table per conference, divisions inside, CONFERENCE W-L/PCT then OVERALL
W-L/PCT, PF, PA, DIFF, STREAK) or **Overall** (the whole league ranked by the complete schedule).
The standings embed draws a table per group (`?g=<name>` for one). Both ask for the conference
columns only on a `conferences` competition, so nothing changes for any other league.

## Box score: the DYNAMIC TABLES tab

`epinoia/game/dyntable.js` (+ `dyntable.css`) adds a tab after LINEUPS on every public box score. It shows the
league table as it would stand if the games being played right now ended on their current score, with each
club's movement against the official table (green up / red down / dash, places), the live game that moves it
(score, period and clock, linked to that game's box score), and the two clubs of the viewed game lit. It is not
membership-gated and is not in the "advanced stats" group.

- **No second standings engine.** The official table is the database's own `standings` rows (finished games only,
  sanctions applied, `recompute_standings`). Live games are laid over them and the rows are ranked with the same
  keys as 0144: league points, point difference, points for; a `conferences` competition ranks inside
  (group, division) by conference win %, conference wins, overall win % first, and a live game counts as a
  conference game per `games.conference_game`, else when both clubs share a group.
  `leagues.rules.tiebreak` (head-to-head) is declared but not applied by the database, so it is not applied here.
- **A level score is not a result.** A game level right now is listed as "level: projected as a tie" and changes
  nothing (no win, loss, points or game played) until one side leads.
- **Which competition.** The game's own. A pure `knockout` has no table (the tab says so); a group stage or a
  conference league is split as the league page splits it (`epinoia/standings.js`).
- **Live.** The viewed game's score comes from the page's own frames. The other live games: one query
  (`games?competition_id=eq.<id>&status=eq.live` with `game_state(period,clock_ms,...)` embedded) every 15 s
  while the tab is on screen and the document visible, 60 s when nothing is live, doubling to 2 min after
  errors, stopped when the tab or the document is hidden. The table is read once per page load.
- Test: `supabase/tests/dyntable.test.mjs` (the pure `project()` and the tab's place in `game.js`).

## Deploying (order matters)

1. `npx supabase@latest db push` — applies 0144. Its self-tests run first against temporary
   copies and prove every existing table comes out identical before anything live is replaced.
2. Then deploy the code and enable the sources. Before 0144, setting format `conferences` or
   writing `division_name` / `conference_game` is refused by the database.

See also the `college-conference-standings` skill (NCAA notes: realignment, multi-team events,
conference tournaments, halves).
