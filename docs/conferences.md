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

## Reading it

`epinoia/standings.js` (shared) — `epinoia/l/league.js` draws a conference league as
**By conference** (a table per conference, divisions inside, CONFERENCE W-L/PCT then OVERALL
W-L/PCT, PF, PA, DIFF, STREAK) or **Overall** (the whole league ranked by the complete schedule).
The standings embed draws a table per group (`?g=<name>` for one). Both ask for the conference
columns only on a `conferences` competition, so nothing changes for any other league.

## Deploying (order matters)

1. `npx supabase@latest db push` — applies 0144. Its self-tests run first against temporary
   copies and prove every existing table comes out identical before anything live is replaced.
2. Then deploy the code and enable the sources. Before 0144, setting format `conferences` or
   writing `division_name` / `conference_game` is refused by the database.

See also the `college-conference-standings` skill (NCAA notes: realignment, multi-team events,
conference tournaments, halves).
