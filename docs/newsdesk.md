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
- who carries each side's form, and a milestone in reach;
- how each side comes in (the wire services' opening line): its last game in the fortnight, the score winner first,
  where, against whom, and whoever carried it ("with 31 from X"; "despite" only for a line that stood out); a run says
  its latest game; two who met last time out get that game once;
- home and road records when they are all one way or far apart, close-game records when a close game is expected,
  the only meeting's top scorer.

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

**The competitions.** Records, runs, the table and the luck are the league competitions' (the table the league page
shows counts nothing else). A `playoff` competition's games are series: who leads, Game N and where, the seeds (only when
the regular season came first), the regular-season meetings, the facet the matchup turns on, the lower seed leading. A
fixture a feed files under the league inside a running series (within ten days of the pair's last play-off game) is the
next game of that series. The bracket (`bracket_ties`) says a tie's legs and decider: `aggregate` is two legs, told leg
by leg and decided on points ("go through on aggregate, 141–140"); `wins` with N legs is a best of N ("one win from going
through"). When the play-offs have begun and nothing of the regular season is left, the race becomes who finished top,
and runs and slides stop.

**The season's shape.** From every regular-season game still to play: "Seven games into a 40-game season, the table is a
first draft; by the margins, X have been the best side". In the run-in: who can still catch the leaders, who is sure of a
top-N finish and who is out of it, against the competition's own `qualifiers` or, said as that, last season's play-offs.
Only on a schedule known to be whole: it runs well past three weeks, or its total is last season's games a club or a
whole number of round robins. A feed that loads a fortnight ahead is never read as a run-in.

**What the site publishes, read in.** The builder also reads, each part on its own: the match reports filed for the
league's games and the fortnight's pieces from creators, outlets and channels (this league's own); `game_significance`
(the site's measure of a finished game, with its reasons); `league_videos` (which games have highlights: `watch/?g=`);
`fanvote_winners` (a story from 25 ballots up); `sos.js` on the season's team lines (the schedule so far, and margins
adjusted for it); `player_bio` (ages). Each storyline cites what has been written about it: the match report of the
games it rests on, and the pieces that name its player (a player's storyline), both clubs (a game's), the club (a club's)
or two of its clubs (the race). The coverage plan lists what has been written, with the storylines each piece covers, and
"Not yet covered": the openings.

**The closer and suspensions.** The recaps carry clutch time (clutch.js: the last four minutes of a close game, and
overtime) per side and player; the week's leader, from seven points, is "The closer", against the club's points in the same
minutes. A player not playing is said as that, and a reason is given only when the league has recorded one: the builder
asks `player_ban` for the players the newsdesk says are not playing, and a suspension is said ("serving a suspension, with
one game left to serve").

**Questions to ask.** Each storyline carries one or two questions a desk would take to the press conference, to a club's
coach or to a player by name, grounded in the storyline's own numbers ("Your shooting has been worth +11.0 points a game in
the run, against −3.7 before it: what changed?"), never in anything the numbers do not show.

**Timelines.** Each storyline keeps how it has developed: when it opened and each change since, dated by the game that made
it (the last six); a resolved one ends with how it ended.

**The award races.** The coverage plan lists the site's own season awards as they stand (`season_awards_resolved`), each
leader with the number the award is decided on.

**Threads.** Each game of the week ahead carries the running storylines it touches, said as what the game means for each
("X put their unbeaten record on the line", "Y's run of five straight 20-point games is on the line"). A storyline rides
on its club's next game only. The game page's preview shows them as "On the newsdesk".

**The engine's version.** `VERSION` in narrative.js is written into each file and the index; a file from an older engine
is rebuilt on the next run, and the first build on a new engine resolves nothing it did not write.

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

## 8. The newsroom (newsroom.js): articles the newsdesk writes itself

Beside the storylines, every hour, the newsroom looks for what deserves a whole article, scores each candidate for
SALIENCE (0-1: how far from normal, how much rides on it, how fresh) and writes the ones at 0.6 or above - two new an
hour at most, eight a week, one a fortnight on the same subject. A piece, once written, is kept as it was for three
weeks (a reader's link never changes under them), in the league's own newsdesk file (`articles`).
A correction is the one exception: when a format's writer is fixed, its `WRITER` version in newsroom.js goes up, and
the pieces the older writer wrote are written again from their candidate under the same id - the link, the date and the
headlines being tested kept - or dropped when the candidate has gone (`five` 2, 2026-10-08: the club's rate per 40 and
the five's share of its minutes had been divided by five twice).

| kind | what | the deep numbers it uses |
|---|---|---|
| `watch` | the week's games to watch | the slate's stakes; for each game the reasons (below), the season's lean, a player to watch |
| `slump` | a key scorer gone cold (four games well under his standard) | his game lines (shooting, minutes, the shots that are not falling), shot profile, half court against transition, on/off, the team's record |
| `mvp` | the MVP case (the box plus-minus leader of a top side) | BPM and the gap, usage and true shooting, on/off said for what it is (the case made, a deep side, or the number against), the four factors with and without, shot profile, rim protection on/off, the rival's case |
| `prospect` | a player under 22 near the top by BPM | per 36, true shooting against the regulars, usage, shot profile, on/off, "every one better is older", the sample |
| `identity` | what a club is built on, or its problem (the league's best or worst on a facet) | transition, half court for and against, second chances, rim protection, turnovers forced and given: the zones in that situation, who does it, what it is worth (points a game, or the league's model), the other side of them, the next opponent's matching number |
| `run` / `skid` | a run of five, from the inside | the four factors in the run against before, points for and against, the player up or down, the five on the floor, close games |
| `five` | the best five of the fortnight | the replayed games' lineups: minutes, plus-minus, per 40 against the club |
| `clock` | the late-clock specialists | the replayed games' shot clock: points a chance past 16 seconds against the league, what a long possession costs them |
| `absence` | a star missing | his share of the club's value (box plus-minus above replacement x minutes, VORP's own baseline), the record and scoring without him, on/off, who has had his minutes; a suspension only when the league recorded one |

Every figure comes from what the hourly build already holds (the season file's club and player rows with the events
splits and on/off, the game lines, the last fortnight's replays' `deep` numbers, the league's What Wins model): nothing
more is read for an article. Pronouns follow the league (leagues.gender, else the women's markers in its name).

**Where they are read**: three on the league's front page ("From the newsdesk", in the Storylines section), each whole
on the news page at `news/?l=<league>&d=<article>`.

**The game to watch** (`gameCard`, open above the folded storylines): the slate's highest stakes in the next week as a
card - crests, records, places, form, the season's lean as a chance, why it matters, where it will be decided (the
reasons, each with both sides' figures and a meter of where each stands), a player on each side with the on/off, the
week's article and "Follow this game" (follow.js). The reasons are said as a preview writer would: a clash of tempos,
the mismatch inside or from three, open court, the battle of the boards, look after the ball, the matchup at the point,
on the wing or at the big spot (positional BPM and VORP), the form they bring - and the rivalry first, when the two are
rivals.

## 9. What it learns

**The style library** (platform console, Newsroom tab; table `newsroom_style`, migration 0252, platform admins only).
Paste an article: the newsroom digests it for its phrasing - the verb between two clubs before a score (filed by the
score's margin: a rout, a narrow win), the scoring verb before "N points", the predicate of a hot or a cold hand, the
connectives that turn or add to an argument, the shape of a question headline - and writes in it from the next build.
It learns short, generic phrasing, never a sentence or a name or a figure, and every slot is filled from the data.

**The click-through model** (migration 0252; `feedrank.js`). Every visit counts which feed cards and newsroom pieces it
was shown (half on screen for a second) and which it opened, as anonymous daily counts (`feed_track`: no visitor, no
session, no address; only where the site counts visits at all - analytics on, not Do Not Track or GPC, not opted out,
not staff, not a robot). Every hour the build reads the decayed counts (`feed_ctr_totals`, service role), fits a
logistic regression of opens on showings over the headline's words and pairs, its shape (a question, a number, its
length, a name), its kind and its league (`ctrFit`), and publishes it as `snapshots/feed/model.json`, with each recent
story's own counts as `snapshots/feed/salience.json`. Then:
- **every feed** multiplies a story's base by its salience: its expected click-through (the model's guess for its
  headline, blended with its own record) against the platform's, held between 0.7 and 1.3, with room for a new story to
  be tried (exploration) - beside what a game's significance already gave a match report;
- **the newsroom** orders a new piece's headlines by the model and keeps three for a **headline test**: each reader is
  shown one (the same for their tab), and once they have been shown 300 times between them the best click-through wins
  for good;
- **the formats** readers open more are weighed up (0.75 to 1.3) in the salience that decides what is written.

The console's Newsroom tab shows what the library has taught and what works: the platform's rate, the headline features
that lift and sink a story, and the formats against each other.

## 10. Rivals

A platform administrator names two clubs rivals from a club's page ("edit links": `team_rivals`, `team_rival_set`,
migration 0252). A rivalry raises its games' stakes on the slate (said first, "a rivalry"), leads the game to watch's
reasons, makes the week's article more salient, and gives a match report of one 20 points more in the feed
(`news_report_significance`).

## 11. Tests

| file | what |
|---|---|
| `supabase/tests/report.test.mjs` | the report's claims and wording rules |
| `supabase/tests/context.test.mjs` | context.js, the season facts, the ledger, the preview |
| `supabase/tests/narrative.test.mjs` | storylines, threading, caps, the coverage plan |
| `supabase/tests/report-i18n.test.mjs` | every new template comes back fully translated in each visible language |
| `supabase/tests/newsdesk-i18n.test.mjs [ja\|es] [--list]` | every string the newsdesk draws, from fixture leagues that open every kind of storyline, comes back whole in each language (the `newsdesk` pack: `epinoia/i18n/<code>/newsdesk.js`, one anchored pattern per template) |
| `supabase/tests/report-eval.mjs --ctx [--league <slug>] [--show N]` | real games: coverage, repetition, stock phrases, logic |
| `supabase/tests/newsroom.test.mjs` | the newsroom on a synthetic league (`newsroom-fixture.mjs`, `full`: every format open, the run and the slide, a star missing, the replays' shot clock and fives): whole articles with no empty slot, her pronouns, salience, persistence, the headline test, the game to watch, rivals; digest/learn, the click-through model |
| `supabase/tests/newsdesk-i18n.test.mjs` (the newsroom groups) | every newsroom string - each format over half a season of weeks, every headline it could test, every pairing's reasons, the card and the page's own words - whole in each language |
| `node tools/build-narratives.mjs --local --league <slug> --articles all [--input-out f.json]` | every candidate article a real league offers, with its salience (and the newsroom's input saved, to work on the writing without reading the league again) |
