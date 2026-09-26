# Linking clubs and players across competitions (migration 0178)

London Lions in the SLB, in the EuroCup and the women's side are three team rows (one per league, as the feeds
bring them). A player written "L Adekeye" in one feed and "Lewis Adekeye" in another is two player rows. **A link is a
group the rows belong to.** Nothing is merged or repointed: every game, stat line and roster entry stays on the row it
was written against, so a link can be made, moved and undone at any size and nothing is re-scraped.

## What exists

| | |
|---|---|
| `team_groups`, `team_group_members` | a club and the team rows that are it (a women's side is a member like any other) |
| `player_groups`, `player_group_members` | a person and the player rows that are them; a member has `auto` + `auto_reason` when the link was made by the automatic pass |
| `team_flags` | "this side is / is not a women's team", set by hand where the names do not say so |
| `link_dismissals` | a set somebody said is **not** the same (an md5 of the sorted ids: a new member makes it a new candidate) |
| `team_is_women(team)` | the women indicator: the hand flag, then `teams.gender`, then **the league's gender** (0182), then the team / league names (English and the leagues' languages, diacritics folded) |
| `linked_teams(team)`, `linked_players(player)` | public reads for the team page and the profile: the other rows, with leagues, seasons, competitions, women flags; never a birth year |

Writers are the security-definer functions, each checking `is_platform_admin()`: `platform_link_apply / _remove / _rename /
_dismiss / _groups / _search / _suggestions / _filters / _auto`, `platform_team_set_women`. Browsers cannot write a table.

## Women's and youth sides (0181)

A side can be a women's team, a youth team, both, or neither; both are **told by name and settable by hand**.

* `team_is_women(team)` — the hand flag, then `teams.gender`, then the league's gender (0182, see below), then the team / league names.
* `team_is_youth(team)` / `team_age_group(team)` / `team_traits(team)` (women + youth + age in one public call) — the hand flag,
  then `teams.age_group` (0119: `senior`/`masters`/`open` mean not youth; `U18` means youth U18), then the names: the word
  (youth, junior(s), juniorit, junioren, juvenil, cadete, infantil, academy, akademie, nachwuchs, jugend, jeunes, espoirs, primavera,
  jong), **"Liga U"**, or an age (U19, U-21, Under 18, Sub-20; 12–25). "Liga U" says youth with no age; "ABA U19 League" says U19.
  Academy and junior sides that play inside senior leagues (Seawolves Academy, SKYLINERS Juniors, PuHu Juniorit) are youth sides.
* By hand (`platform_team_set_youth(team, youth, age)`, the second dropdown on every club row in the console): auto (the names),
  youth of any age, youth U14…U23, or not youth. `team_flags` holds both hand flags on one row and is removed when it says nothing.
* The club key ignores the youth words and ages (and the gender and legal-form words), so "London Lions U18" and "Real Madrid" in
  Liga U are flagged as possible matches for their club; a youth side links into the club's group like any other and is listed
  last, after the senior and women's sides. Players of a linked youth side are linked to the same person at the senior side by the
  automatic pass, exactly as for any linked club.
* Team page: a **WOMEN** and/or **YOUTH** (or the age group, U19) chip beside the league; the switcher shows the same chips. Before the
  database has the functions the page falls back on the same names, so the chips show straight away.

## One club sets its whole league (0182)

In the console the club row's first dropdown is **women · whole league / men · whole league** (or, for the odd side, **women /
not women · this team only**, or *auto*). Choosing a whole-league answer does two things: it sets the team's own flag, and it sets
**`leagues.gender`** (0131) of the team's league to `women` / `men`, so every team in that league counts as women's / men's whatever
its name says, and so does the rest of the site that reads the league's gender (the rail's W chip, HOME's league cards, the
favourites, the scouting filter). `team_is_women` reads the league step after the team's own flag and recorded gender, before the
names; a `mixed` or unset league says nothing.

* Hand flags on **other** teams of that league that say the opposite are handed back (the answer says how many); a team's own recorded
  `teams.gender` (0119) is left alone and is counted as "kept", since it is more specific than its league.
* *Auto* clears that team's flag only: a league is never un-set from a club. Change or clear the league itself in the league console.
* `platform_team_set_women(team, women, whole_league default true)` returns json `{ women, whole_league, league, teams, cleared, kept }`
  for the console to say ("Aussie Premier is now a women's league: all 12 of its teams count as women's."). The cards
  (`link_team_cards`) carry `league_gender` and `women_from` (`team` / `team_gender` / `league` / `names`).
* Audited twice: `team_women_flag` (the team) and `set_league_gender` (the league, with the team it came from).

## The possible matches (flagged, with a confidence and a reason)

`platform_link_suggestions(kind)` — computed from expression indexes on the folded names, so it is quick at thousands of rows.

* **Clubs** — *high*: the same name in more than one league. *medium*: the same club once the legal-form and gender words
  (`BC`, `FC`, `Women`, `Féminin`…) are set aside (this is where a women's side turns up). *low*: the same league twice.
* **Players** — the kinds, most exact first: `exact` (the same words in any order, a suffix such as Jr ignored), `core`
  (the same first and last word, **middle names and particles ignored**: "Juan Carlos Perez" = "Juan Perez"), `short`
  (surname + first initial where a feed abbreviates), `ambiguous` (an initial that fits several full first names: one
  candidate per full name, always *low*). A set inside a bigger set is shown once, as the bigger one.
  *high*: birth years agree, or two of them are at clubs that are already linked. *medium*: the name matches and nothing
  contradicts it. *low*: the birth years disagree, or the initial is ambiguous.

## Linking clubs links their players (`link_auto_players`)

When clubs are linked, the players on their rosters are read as identities (the same first and last word) and linked
across the clubs. Conservative on purpose — left for the flagged list, not linked:

* two rows of one name on the **same team** (two people)
* birth years that disagree
* an initial that could be two people (John or James Smith)
* a set that would merge two groups somebody made by hand
* a set somebody undid (an automatic link that is unlinked is remembered and not made again)

It runs when clubs are linked in the console (the answer says how many players), after every ingest discovery pass
(`link_sweep` in `scripts/ingest/run_ingest.py`, so a roster that arrives later is linked), and from the console's
"link the players of every linked club" button.

## The console (Platform → Links) and the public pages

* `epinoia/admin/platform/links-ui.js` — Clubs / Players; **possible matches** (each card flagged, rows ticked by
  confidence, "link the ticked ones" / "not the same"), **find and link** (type-ahead over the whole table, narrowed by
  league and season, picked into a basket), **linked** (searchable groups, rename, unlink, add from a search inside the card,
  women's flag per team, `auto` marker per player). Every dropdown is one component (`combo`): server-side search,
  arrows / Enter / Escape, a slow answer never replaces a newer one.
* `epinoia/linkswitch.js` + `epinoia/kit/linkswitch.css` — the team page's **WOMEN** indicator; under the header a small row with a
  **season drop-down (seasons only)** and **one button per league the club plays in** (each a link to that side's page, the one you
  are on filled, the competitions of each in its tooltip). A season picked out of several keeps the buttons of the sides that played
  it (yours always stays) and names the competitions under each; "all seasons" shows every side. It was one "competitions & seasons"
  button opening a panel of every side and season. Also the player profile's **other profiles** button, and the profile's career table running across the linked profiles
  (`player.js` reads `player_season_stats` for every id in the group). Two plain `fetch` calls, no SDK; a database without
  0178 answers 404 and the pages show nothing new.

## To switch it on

`npx supabase@latest db push` applies 0178. Until then the Links tab reports that the functions are missing and the public
pages are unchanged. Tests: `supabase/tests/entity-links.test.mjs` (PGlite), `links-ui.test.mjs`.
