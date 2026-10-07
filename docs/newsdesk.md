# The newsdesk: match reports, previews and league storylines

Three writers share one set of judgements. They take numbers the site already has, decide what matters and say it.
Every figure in a sentence is computed by the writer, and every sentence is a template filled from those figures. A
sentence with a slot it could not fill is dropped, never printed.

| writer | where it shows | code |
|---|---|---|
| the match report (and the half-time report) | a finished game's REPORT tab; the news article finalise-game files | `epinoia/game/story.js` (facts) → `report.js` (prose) → `reportview.js` (cards) |
| the fixture preview | a scheduled game's page, "The story so far" | `epinoia/game/preview.js` |
| the league newsdesk | a league's front page ("Storylines"); the creator hub ("Coverage plan") | `epinoia/narrative.js` → `epinoia/newsdesk.js`; built hourly by `tools/build-narratives.mjs` |

All three read **the game in its season** (`epinoia/game/context.js`) and **What Wins** (the league's model:
`snapshots/whatwins-explain/<league>.json`, winmodel.js `explainOf`).

## 1. What decided it: the value ledger (story.js `factLedger`)

Every facet of a game is valued in points of the final margin, from the home side's view:

| facet | value |
|---|---|
| the shots they got | b_efg × (expected eFG of the shots taken − the other side's), with rim, mid-range and three at the league's make rates (`context.js rates`, pooled from the season's team lines; this game's own rates without them) |
| the shots that fell | the rest of the eFG difference: what was made beyond what those shots usually give |
| turnovers, the offensive glass, getting to the line | b × the difference (the league's model), else the fixed weights per 100 possessions |
| free-throw shooting | free throws made beyond the league's rate, in points |
| home court | the model's home edge, where it has one |
| everything else | what the margin was beyond all of that |

The rows add up to the margin exactly (the tests hold this). The facet worth most leads the second section of the
report, "What decided it", with what came next and what the losers won back. That section also says what the season's
four factors expected before the tip (§2) and what is left over; the leftover is only said with the league's own model.

Each other fact about a facet carries that facet's value and is promoted by its share of the margin (`weighFacets`).
The numbers section writes its paragraphs in that order. A game decided on turnovers is reported as one.

## 2. The game in its season (context.js)

`EpinoiaContext.build({ gameId, tipoff, home, away, score, games, pgs, tgs, table, fixtures, tally, records, bios,
model, competitionId, attendance, teamNames, rates })` works out from games that tipped off **before** this one:

- each club's record, run and last five, before and after;
- the table before and after, read as the league page reads it;
- the meetings so far, the rest days and the next fixture;
- the fans' picks for this game, and the crowd against the club's earlier ones;
- what the season's four factors expected. Each club's profile at both ends comes from its earlier games, blended a
  proportion's way (logit offence + logit defence − logit league) and weighed by the model (what-wins-model.md §7.8,
  its four-factor half);
- each player's season before tonight: average, highs, runs of 20-point games, absences, the points total.

`story.js factContext` turns these into facts: streaks made and ended, firsts, unbeaten and winless, going top,
climbing, upsets by the table and by the numbers, the meetings, back-to-backs, crowds, team season highs, season highs,
hot streaks, returns, milestones and the league's season bests. The table waits for three games a side.

`EpinoiaContext.preview(...)` is the same season read before a fixture, for the preview.

**Where it is read.** The game page builds it after the first paint (`game.js ensureGameContext`). The reads are
light: the two clubs' games only, the player lines by named keys and never the stats blob, and the latest season file.
It never calls `records_board`, which runs into the statement timeout for big competitions. finalise-game builds the
same thing for the filed article (`supabase/functions/_shared/gamecontext.ts`).

## 3. The report's writing

- **The moments**: the basket that put the winners ahead for good, a winner at the death, the player who closed it, a
  three at a period's buzzer (`factMoments`).
- **The shape** (`factArc`): overtime, collapse, heist, comeback, rout, wire, pulled away, held on, see-saw, grind,
  shootout, tight, control. The writer chooses its register by it.
- **Why it matters**: the strongest one or two season facts go near the top. **What it means**, near the end, says the
  rest, where both now stand and what comes next, with a form and next-games card.
- **Headlines** can lead with the season ("go top", "end X's run", "hand X their first defeat", "stun"), a league
  record or a winner at the death when it is the biggest thing about the night.
- **Names**: the full name the first time in the body, the surname after (unless two players share it).
- **Variety across a league's reports**: the critic (`language.js choose`) treats phrasings within three points of the
  best as a tie and the game picks among them. The evaluator counts five-word runs shared by 30% of reports
  (`node supabase/tests/report-eval.mjs --ctx`).
- **Never printed**: an empty slot ("undefined", "NaN", "[object…]", braces). `verifyClaims` drops the sentence.

## 4. The preview

"The story so far" (preview.js `valuedParas`, from `EpinoiaContext.preview`):
- where the two stand and how they come in: runs, unbeaten or winless, the last five, the meetings, a back-to-back
  against rest;
- the matchup valued: the expected margin, the facet worth most of it with both sides' expected figures, the
  underdog's edge, home court;
- an honest lean (a toss-up, a lean, clear favourites, comfortable) and what argues against it;
- who carries each side's form, and a milestone in reach.

Without three games a side it keeps the season-average observations it had before.

## 5. The league newsdesk (narrative.js)

`EpinoiaNarrative.build(input)` → `{ stories, briefing, coverage, clubs, stats }`.

**Storylines**:
- the race, the line (where a competition has a play-off line), runs and slides, the unbeaten and the winless, the foot
  of the table;
- the record against the points (Pythagorean, exponent 14), what wins for a club (the facet that separates its wins
  from its defeats, valued per game);
- players on a tear or in form, players not playing, milestones in reach, the season's bests;
- upsets, the game of the week (from the replayed recaps), the best player by box plus-minus and the one under the
  radar, and what wins in this league.

Each storyline has:
- a stable `id`, `kind`, `kicker`, `head`, `dek`;
- `why` (why it matters), `numbers`, `counter` (the "yes, but"), `next` (what comes next), `angles` (ways to cover it);
- `teams`, `players` and `games` (its evidence), `links`;
- `tracks` (the number it follows), `status`, `version`, `change`, `first`, `updated`, `score` and `copy`.

**Threading.** The previous build is read back. A storyline whose tracked number changed is DEVELOPING, with its
version up and a note of what changed. One no longer found is RESOLVED, says how it ended, and is kept for three days.
A new one is NEW.

**Ranking.** Newsworthiness = importance × size × stakes × a fade with the hours since its last evidence (an evergreen
fades less), a little more for new and less for resolved. On top of that:
- caps per kind and 24 running at most;
- a second and third of a kind ranked lower;
- no club in more than two of the top six when anything else can take the place.

**Opening rules.** A run opens at three after a defeat, an unbeaten start at four, a table story at three games a side,
box plus-minus at half the games and 20 minutes a night. A table where half the clubs are within a game and a half of
the top is "Nobody has broken away yet".

**The briefing**: the story, the results since yesterday, the games to watch, a milestone or two, and an end.

**The coverage plan** (creator hub):
- the big picture: the race, home win rate and scoring, what wins here, and how often each facet decided a game;
- today; the storylines to run (in full, with ways to cover them); under the radar;
- the week ahead, game by game, biggest first: stakes, form, what the season's numbers expect and the facet it turns
  on, the meetings, the fans' picks, a player to watch on each side, and how to cover it;
- the recaps worth writing, ranked by the shape the match report found, closeness, an upset and a late moment;
- players and clubs to feature, data notes (close games, fortress, road, crowd, highest score, home court, the fans'
  record) and a calendar for the week.

## 6. The builder (tools/build-narratives.mjs, .github/workflows/narratives.yml)

Hourly at :50. **Every read uses the publishable key**, so only what a signed-out reader may read reaches the public
file. The service key only writes:
- `snapshots/narrative/<league id>.json` (public, ten minutes in a browser);
- `snapshots/narrative/index.json`;
- the recap cache, `analytics/narrative-cache/<league id>.json` (private).

A league is built when it has a new result, when its file is six hours old, or when it has none. Each game of the last
week is replayed once from its events file through the match report engine, for its recap. Reads are light columns,
named keys out of the stats, and CDN files.

```
node tools/build-narratives.mjs --local --league euroleague            # real data, read-only, printed
node tools/build-narratives.mjs --local --league proa --out proa.json  # the file, to look at
```
To build one league now from GitHub: run the workflow by hand with its `league` input.

## 7. What it borrows, and the failures it guards against

The design follows what automated sports writing and news aggregation learned the hard way. In outline:
- angles with importance scores choose the lede;
- a storyline opens only on enough evidence, threads its updates with a version and a note, resolves with how it ended,
  and expires;
- a claim never outruns the data held ("this season", never "ever");
- no stock phrase is repeated across a league's pieces;
- no empty slot is ever published;
- no summary merges two stories;
- a counterpoint goes beside every storyline;
- a briefing has an end;
- "since your last visit" is kept on the reader's own device.

## 8. Tests

| file | what |
|---|---|
| `supabase/tests/report.test.mjs` | the report's claims and wording rules |
| `supabase/tests/context.test.mjs` | context.js, the season facts, the ledger, the preview |
| `supabase/tests/narrative.test.mjs` | storylines, threading, caps, the coverage plan |
| `supabase/tests/report-i18n.test.mjs` | every new template comes back fully translated in each visible language |
| `supabase/tests/report-eval.mjs --ctx [--league <slug>] [--show N]` | real games: coverage, repetition, stock phrases, logic |
