# EPINOIA Manager (individual mode, built 2026-10-09; live play 2026-10-14)

A Football Manager-style game on EPINOIA. The reader takes a club into a real league: they name it and its manager,
draw or upload a badge, choose the country and league, and draft a squad of real players within a budget. Then they set
lineups, team instructions and each player's instructions, and play the league's real clubs on the real calendar, every
club three times: live (managing the game as it happens, full screen, on a 2D court where every possession is drawn as
a set from a real playbook) or straight to the result, any time in its week. Real form moves the players during the
season (the fantasy element).

**Modes.** Individual mode is built. Friends mode (shared leagues, a creator who starts the league, join requests) is
next. Global mode was scrapped (Louie, 2026-10-09).

## Where it lives
| Part | Files |
|---|---|
| The way in | HOME's third strip tab, MANAGER (`home/index.html`, `kit/home.css` `.mg-warp`, `home/vhmode.js` `toManager`): a royal-blue wipe, then `manager/` |
| The page | `manager/index.html`, `boot.js`, `app.js` (router, rail, shared builders, catch-up, saving, the game in hand), `manager.css` (the royal blue, soft-glass skin; dark navy and light sky-blue) |
| The screens | `manager/views/`: `onboard.js` (login, black transition, team name, manager name, badge, country and league, mode); `squad.js` (draft pool, filters, shortlist, hover cards, 1–20 attributes, confirm); `tactics.js` (the court, drag and drop, up to 4 lineups, minutes to 40, the team's instructions in a pop-up at the top, a player's on a press); `ui.js` (the two pop-ups the tactics and the live game share); `match.js` (match day, the live game full screen, a game played again, practice games); `season.js` (home with the match-day panel, fixtures, table, statistics); `pages.js` (player pages with Real season / Manager season tabs, each with Scouting and Simple views; team pages); `trade.js`; `game.js`; `boards.js` (leaderboards, club settings) |
| The game itself | `manager/core/` (UMD, no DOM, no site: `root.Mgr.*`): `value.js`, `ratings.js`, `schedule.js`, `names.js`, `badge.js`, `cards.js`, `roles.js` (the positional roles, their categories, alignment and fit), `engine.js`, `instruct.js` (player instructions, roles, fit), `match.js` (the possession engine), `plays.js` (each possession drawn as a playbook set for the live court), `season.js`, `scorer.js` |
| The site, from the game | `manager/adapters/epinoia.js` (`Mgr.site`): the **only** file that knows EPINOIA. It provides the leagues, the season files, the values and boosts, form windows, each real club's starting fives (`starts`), the clubs (`manager_*` RPCs) and badges. Swap it and the game runs elsewhere. |
| EPINOIA GO | `go/leaderboards/` `#manager` and a teaser on GO's home (`leaderboards/managerboard.js`, `kit/mgboard.css`): the promise, the realism marks, your clubs, and the boards (global and league by league) |
| The platform console | the Manager tab (`admin/platform/manager-ui.js`): each league's value range and continental boost |
| The marks | `tools/manager-validate.mjs` writes `manager/validation.json` |
| The database | `supabase/migrations/0259_manager.sql` |
| Tests | `supabase/tests/manager-core.test.mjs` (163), `manager-db.test.mjs` (35, PGlite: `PGLITE_DIR=<…>/node_modules/@electric-sql/pglite`); both in guard.yml |
| Languages | the `manager` pack (`i18n/ja/manager.js`, `i18n/es/manager.js`) exists but is empty: the Manager is English only for now |

## Everything is played in the reader's browser
Louie's instruction: only the reader's chosen league is simulated, and only on their device. Rounds fall on Wednesday
and Saturday (two a week) or Saturday only (one a week). Before each round the form windows from `player_game_stats`
are read, so real form moves the players. The database keeps only what has to outlive a visit:

- the club, its squad (with each man's instructions on his roster entry: `u` touches −2..2, `ins` keys, `role`) and
  lineups;
- the season's compact state: fixtures and results, every player's line in `season.LINE` order, club totals with the
  opponents' side, the reader's own games' boxes with plus-minus, and their play-by-play (about 4 KB a game, base 36);
  and the game in hand (`S.live`, below);
- the summary the boards rank.

A **scouting network** widens the draft and trade pool. The reader adds leagues to it, and their players can be signed,
but only the chosen league is simulated.

## Match week (Louie, 2026-10-14: "can the user choose to play the game anytime on that day"; 2026-10-15: "play the two weekly games whenever they want, but has to be within the week (otherwise auto simmed)")
- A game is the reader's to play any time in its week, Monday 00:00 to the next Monday 00:00 in their browser
  (`season.weekStart` / `weekEnd`). `season.matchday(S, now, me)` is their first unplayed game whose week is under way:
  the week's two games are played in their order, never the second before the first.
- `season.due` plays the rounds in order and stops at the first that is not due: a round of the reader's once its week
  is over, any other once its day has begun. The form window is the seven days before the game is played, capped at the
  end of its week.
- On that day HOME's match-day panel (`views/match.js` `A.livePanel`) and `#/match` offer **Play it live** or
  **Straight to the result**. Either one plays the round's other games at that moment
  (`app.js` `A.startMatch(mode)`); their results stay hidden (`A.view()`) until the reader's own game ends.
- **The game in hand** is `S.live = {r, started, mode, plan: {h, a}, form, snap}`. Each side's plan (its rotation and
  tactics) and the form are kept as they were at tip-off. `snap` is `match.snapshot`. It is kept in the browser
  (`mgr_live_<club>`) every couple of seconds and in the database at the breaks, on a pause and on leaving; the newer
  of the two is taken up again (`A.liveSnap`). The game moves only while the match screen is open.
- **Nobody choosing:** `catchUp` plays a round once its day is over (`season.due`), and a round without the reader's
  club once its day has begun. A game in hand whose day is over is played out by the assistant (`finishLive`). If it
  cannot be taken up again, it is let go and played from the start, never left unplayed.
- A season is redrawn (a club of the real league added or dropped) only before its first match day begins, and keeps
  its own start date (`season.redrawable`; the cause of the "skipped Saturday" on 2026-10-14).
- **The schedule** alternates every pairing's home and away by round (`schedule.roundRobin`). The old rule
  (round + place) kept a club at one end all along its side of the circle: 16 away games in a row in a 17-club league.
  The tests cap runs at four.

## The engine (core/cards.js, core/engine.js, core/match.js)
- **Players become cards.** Each card holds league-relative deltas, shrunk toward positional priors by minutes. Where the
  individual stats have gaps, on/off figures weigh in lightly, and less at low minutes. The card is also adjusted for the
  opposition faced, for the league's strength, and for current form.
- **Fives become winsim profiles** (`engine.sideOf`). The usage sim adds the plays up to 100%, on the skill curve. Taking
  more shots from a zone costs efficiency, less for players used to creating unassisted. Spacing, added up over the
  five, decides how packed the paint is. Passing synergy, out-of-position play, fatigue, the team's instructions and each
  man's instructions all apply. **Instructions change what a man tries; his own numbers decide how it goes** (FM's
  rule). For example, green light is +0.84 points per 100 possessions for a good shooter and −0.46 for a poor one; push
  in transition is +1.30 for a runner and −0.78 for a walker.
- **The team's instructions** (`E.TACTICS`, FM's three phases):
  - *In possession:* guard, wing and big play; **Ball handlers: Get downhill ↔ Punish from deep** (one slider, for the
    ball handlers only); off-ball cutting ↔ space the floor; hit the screener ↔ hit the shooters (the screener as his
    role plays it: a roller at the rim, a popping big from three, a short roller from the middle; a real club's bigs
    inside, as before).
  - *In transition:* leak out; attack the offensive boards.
  - *Out of possession:* funnel to rim protection ↔ no paint touches; gamble for steals.
- **Each player's instructions** (`core/instruct.js`), by role:
  - Guards: be more passive / aggressive, push in transition / slow it down, punish behind the arc / put pressure
    downhill, kick-outs, dump-offs, gamble for steals / stay solid.
  - Wings: handle the ball more / less, only spot-ups and cuts, push, cut more / space more, green light / rip through,
    crash the glass, gamble / stay solid, more aggressive rim protection.
  - Bigs: handle more / less, finisher only, roller big (short roll / dive) / pick and pop, post more / less / don't post
    up, hedge / contain / drop, defend the rim aggressively / be foul-conservative.
  - Touches run −2..2. Every instruction shows the player's fit for it (Natural, Good, Workable, Poor), with the reason
    in plain words ("He blocks shots a bit less often than most small forwards"), never a ratio of rates. Green light and
    rip through are rated by what the shot is worth to him: ripping through trades an open catch-and-shoot three for a
    drive at a closing defender (a tracked league's drives: a shot on 0.45 of them at 49%, a foul on 7%, a pass on half),
    so a real shooter rates the green light well above it.
  - The family of instructions a man takes is his role's at the place he plays (a guard's, a wing's, a big's), and the
    ones his role rules out are greyed with the reason (`roles.locks`). They are stored unfiltered on his roster entry;
    the engine keeps to each five's roles itself. One exception: **a big's coverage on a ball screen goes wherever he
    plays** (a big in a 3&D role at the four still guards his screener), so the panel offers and keeps it at a wing's
    place too (`instruct.COVER`, `app.js` `screenBig`) and the engine follows it there.
- **The coverage on a ball screen against whom it meets** (`engine.coverage`, inside `interact`; Louie, 2026-10-15:
  "drop coverage hurts rim-bound players with no inbetween game who are set to slashing", "how hedging affects ball
  handlers w/ weaker handles", "opponent has a good drop big with good rim defense, I currently have a rim roller big
  which isn't doing much, so I bring in a good pick and pop big to stretch out the defense").
  - **Each big's coverage:** his instruction (hedge, contain, drop), else the one his game suits (`inferCover`, card
    position 3.5 and up): a rim protector (blocks 1.2× his position's, or 2.5+ rim points saved per 100) without quick
    feet drops; quick feet (steals 1.2× his position's) without the blocks hedges; the rest contain. Real clubs' bigs play
    theirs; the reader's play theirs until the reader sets one. How well he plays it: a drop as well as he protects the
    rim, a hedge as quick as his feet (`coverQ`).
  - **Measured against the league's own coverage** (`coverMix`: the drop and the hedge its bigs play, on their minutes,
    about 0.36 and 0.07 in the four validation leagues), because the clubs' numbers already hold it: a five that covers
    as the league does changes nothing, so real clubs' calibration stands.
  - **Each man by how much of his game comes off ball screens** (`covTraits`): as the handler (x, his time on the ball)
    and as the screener (y: rolling, popping, short-rolling, handing off, from his role), with his ball security for that
    time on the ball, his passing, how rim-bound he is, his mid-range and his pull-up three, each scaled to the league's
    handlers (measured on four leagues' rotations, 17,100 stints).
  - **Drop:** the handler's rim finishes are harder (less when his screener pops and drags the big out), the pull-up and
    the floater are there for him, the pull-up three for a man who takes it; a rim-bound driver with no in-between game
    pays. As the screener: a roller finishes into the rim protector, a popper is open behind him. **Hedge:** loose
    handles and poor passers turn it over (a sure-handed passer hardly), the pull-up is taken away, the roller gets the
    4-on-3, a short roller who passes makes the play. **Contain:** the even middle. Strengths (logit, a unit of exposure):
    `COVK` rim .30, mid .12, pull-up three .06, hedge turnovers .30, pull-ups .06, roll .35, pop .30, the 4-on-3 .20,
    short roll .12.
  - The five's change goes into the matchup's rates; each man's difference from it into his own (`core/match.js`
    `menOf`: his turnovers and his makes by zone).
  - **Checked:** over the four validation leagues' real pairings the effect is centred (mean about 0, spread 0.2–0.6
    points per 100). Louie's example holds in all four (ORLEN, FEB, NBL D1, CEBL): against a club whose centre drops, a
    pick-and-pop centre does better than a rim roller (NBL D1: −1.99 per 100 of his chances for the roller, −0.74 for the
    popper). Core tests: a hedge against a loose and a sure handler, a drop at the rim and for a pull-up shooter, the
    roller and the popper, the popper's pull-out, the 4-on-3, nothing moved without a league mix, the inferred drop, and
    the end-to-end popper-over-roller.
- **Every game is played possession by possession** (`core/match.js`, also for the games nobody watches) by the ten men
  on the floor: the winsim matchup of the two fives, then each man's own turnovers, trips, shot mix and makes; the
  assist, the board, the steal and the block by the right men.
  - FM's additions: each man's condition (energy falls on the floor, faster with more of the ball, and returns on the
    bench and at the breaks); fouls (five and out); the assistant's substitutions at dead balls (the plan's rotation,
    changed for fouls, legs and a decided game); timeouts.
  - Every change is logged at the possession it took effect, and the same seed plays the same game.
- **The whistle.** A dead-ball turnover is an offensive foul 20% of the time. The fouls without free throws are the
  league's own fouls a team-game (`ref.five.pf40`), less what the trips, and-ones, offensive fouls and late fouling
  give. A man one or two fouls from the limit draws 0.6 or 0.85 of his share.
  - Checked against real 2025-26 seasons, fouls per team-game: 20.7 (real 21.5) ORLEN, 21.3 (21.6) FEB, 16.8 (17.0)
    NBL D1.
  - Foul-outs per team-game: 0.46 (0.45), 0.47 (0.39), 0.26 (0.28).
- **Real clubs play their real style and rotation.** `engine.identityOf` edits style first (three-point rate, rim and
  mid-range share, transition and pace, relative to the league's own), then the four factors. Each club opens with its
  real starters (`adapters/epinoia.js` `starts`, recent games counting most), but only among its eight most-used men:
  a late signing or a man who lost his place is not made to start. Without that guard, CEBL's summer roster churn
  wrecked its players-only mark (0.26).
- **No event after the engine's clock** (2026-10-16, the freeze "after a missed shot on x2 speed"): event times round to
  whole seconds, and a late miss's board could round past its possession's end; the live screen shows events up to the
  engine's clock before it asks for the next possession, so at low speeds it waited for ever (16x usually jumped the
  gap: the "little weird pauses"). Events are now clamped to the possession, the screen never holds its clock below an
  event still to show, and a possession the court cannot draw is skipped rather than stopping the game (core test).
- **Shot tendencies bend a role** (`engine.sideOf`, Louie 2026-10-16): what a role asks MORE of at a zone, a man takes
  only as far as his comfort there goes (the square root of his aptitude: volume x make rate) - a slasher in a shooting
  role takes part of its threes and keeps driving; a shooter takes them all.
- **A man with no threes in his season** keeps them under 2% of his shots (bigs shoot them or they do not: his position's
  share is no prior for him), and the league's unassisted share for his threes falls with his volume - a non-shooting
  centre's rare three is off a pass, never a step-back (`cards.js`).
- **A signing with no minutes yet** has no card from his league's file (cards come from minutes played): he plays as
  a replacement-level man at his listed position (`app.js` `loadMine`), and the engine only ever sends on a man with a
  card (2026-10-15: a game froze when a painted lineup held one with none - "a five is missing a player").
- **Real clubs play like themselves** (Louie, 2026-10-16: "make opposition teams more realistic to their irl
  counterparts, using their rotation charts, and player stats etc. to alter their own style, tactics"):
  - *Their rotation chart* (`site.rotation`, `engine.realRotation`): before a game with a real club, its last 10 finals
    (any competition, so last season covers a young one) are replayed by `rotation.js` into each man's share of every
    regulation minute, kept a week in the browser. The plan follows it: each man keeps his season's minutes, his chart
    says when (paced so a closer keeps his minutes for the end), changes every two minutes at most (a coach subs in
    groups). Checked on ORLEN clubs: every man within a minute of his real minutes a game (the minutes-only plan had
    one at 36 for a real 25), starters opening and closing the quarters, ~16 changes a game. A club with fewer than 3
    logged games, or a chart that knows too few of its men, keeps the minutes-only plan.
  - *Their tactics* (`engine.tacticsOf`): defensive scheme from the shot mix it allows (pack the paint vs funnel to the
    rim protector; play-by-play splits where readable, else the fitted What wins file), gambling from turnovers forced
    and steals, crashing from its offensive glass, leaking from how often it runs, its handlers' style from its three
    appetite - each a z-score against its league's clubs at 0.45 a standard deviation, shrunk by its games, last
    season's numbers leading while this one is young. Its identity is measured with them on (its totals stay its own);
    they change how it plays against the reader's five (the paint packed against a five that cannot space, gambles
    against loose handles, the glass). A small league's are trusted more slowly (z-scores among ten clubs are noisy:
    the games shrink grows as (14 / clubs)^3 - at full strength CEBL 2026 fell to r 0.83). Validation, tactics on
    (off): ORLEN 0.973 (0.965), FEB 0.987 (0.987), NBL D1 0.959 (0.963), CEBL 0.913 (0.896).
  - The Opposition tab says how they play ("Pack the paint", "Gamble for steals", ...).
- **The play-by-play's clock.** Fast breaks shoot 3.5–7 s in (the length of the floor to cover: at 2 s the live court drew shots from half court), put-backs 2–5 s after the board, set plays late. The
  transition and shot-clock tabs of the box score read it.

## Roles (core/roles.js, engine.js `ROLEK`; Louie, 2026-10-14)
"For each position set ... force the user to select their role [which is applied regardless if one is selected - if not
it just goes to default] ... similar to player roles in football manager". 60 roles: PG 13, SG 12, SF 11, PF 14, C 10,
Louie's own list.
- **Grouped by category at each position** (`roles.CATS`; Louie, 2026-10-15): PG Floor general · Scorer · Combo ·
  All-round; SG Combo · Secondary handler · Off-ball scorer · 3&D; SF Point forward · Secondary handler · Shot creator ·
  Off-ball scorer · Role player; PF Playmaking forward · Secondary handler · Shot creator · Stretch & glue · Dual big;
  C Stretch five · Post · Roll man · Playmaking big. The PG has the six combo roles too. Every label ends with its
  position ("Slashing Passer PG").
- **The descriptions** say what the player does in scouting language: the actions he lives in, where his shots come
  from, what he does off the ball and what he needs from the others ("an isolation scorer: little pick-and-roll, he
  scores in space one-on-one").
- **Secondary ball handlers** handle more (their `init` 0.22–0.29, their pick-and-roll share up); **shooting roles ask
  for volume** as well as accuracy: `traits.vol3P`, his three-point share against his own position's, counts in the
  spot-up, off-screen and pop fits.
- **Position** (Louie: "position itself not have much of a docking of stats unless it's a position 2 positions up from
  them or more"): within a position and a quarter of his own, nothing (`roles.posGap`, `engine.oopGap`); past it
  (d − 1.25) × 1.33 positions of cost, so an SG at PF pays and an SG at SF does not.

- **A role is a play-type diet** (the share of the plays he finishes from each kind of play: pick-and-roll handler,
  isolation, post-up, handoff, transition, spot-up, off screens, cut, roll, pop, short roll, put-back) **and loads**:
  `init` his share of the five's time on the ball, `use` the scoring it asks, `pass`, `screen`, `crash`, `run`, `def`,
  `hub`, `rip`, a shooting style for his on-ball plays, and `rho` how far it moves his shots. `gen` marks the two
  general roles (Mixed PG, Combo Mixed SG): his own game, shaped by his instructions; they rule nothing out.
- **Every individual effect is relative to his natural role** (`roles.bestFor`: the role his own numbers suit best). His
  numbers already play that role, so a role moves him by what it asks *beyond* it: the diet's shot mix and assisted
  shares, its turnover and foul rates, its loads. Choosing his natural role is exactly his own game (a test holds it),
  and a role nobody chose (the default) is too (`ROLEK.dflt` 0). Every move is paid at his own numbers (KAPPA volume
  costs, DIFF for pull-ups/drives/post-ups he does not usually make, the skill curve).
- **The five's roles meet** (centred on what the real clubs' default fives add up to, so a club left alone neither
  gains nor loses; four leagues, then SLB held out: −0.08% points a chance on average):
  - **One ball:** time on the ball is time of possession, not usage (a pass-first point guard has the ball as long as a
    scoring one and ends far fewer plays; a movement shooter ends many on seconds of it). A five's roles may ask for
    0.72–1.20 of one ball (the real fives: 0.82–1.22, the middle 0.98). Past it each gets his share, the rest is lost
    on-ball time (his make logit −0.55 a unit × how on-ball his plays are) and the five stagnates (−0.08 makes, +0.25
    turnovers a unit past); short of it the best creator is forced to run it (his usage, his turnovers, the five's
    creation gap).
  - **Downhill pressure opens the threes** (Louie: "a certain amount of downhill pressure is needed in order to generate
    good 3pt looks"): drives, rolls, cuts and post-ups at each man's finishing; a handler's on all his time on the ball.
    Within the usual range it moves catch-and-shoot threes a little (0.1 logit a unit); well short of it (0.2 under) every
    possession suffers (0.35 a unit on catch-and-shoot threes, half on assisted twos, 0.3 on turnovers).
  - **Screens** for the pick-and-roll and off-screen shooters; **the pick-and-roll's partners** (a roller, popper or short
    roller needs a handler running it, and finishes better off a passer); **the post** needs spacing; **the cut** needs
    passers - for its volume, not its finishing; **connectors** make the extra pass (their teammates' assisted shots);
    **3-and-D** effort contests threes; **crashing** gets boards and gives up a little transition.
- **True usage** (`men[].tusg`): the plays he ends plus every shot off his passes (made or not), shared by assists - what
  a scouting service counts as potential assists.
- **Notes** (`engine.roleNotes`) say in plain words what is wrong or right with a five: too many ball handlers, nobody
  to run it, scorers everywhere, not enough pressure on the rim, few screens, a screener with no handler, a post-up
  into a crowded paint, a cutter with no passer, a cramped floor, a connector moving the ball.
- **What a manager can gain**: optimising roles on real clubs' starting fives gains +0.3% to +2.8% points a chance
  over the defaults; poor fits cost in proportion to fit (a non-shooting PF as a stretch four −2.8%).
- Live: `match.js` `rolesAt` gives each place on the floor its role (a role changed in the game, `act {type: 'role'}`,
  else the plan's, else the man's role at that place in any lineup, else the default); kept in the snapshot (`roleOv`).

**The research behind the numbers** (2026-10-14/15; sources here, never in the shipped files):
- Play types, league totals 2021-25 (NBA.com Synergy and tracking endpoints, all 30 teams): frequency, PPP, TOV%, FT
  frequency, 3PA and rim shares, assisted makes. E.g. spot-up 23.6% of plays, 1.04 PPP, 5.4% TOV, 74% threes; PnR handler
  16.6%, 0.90, 14.9% TOV, 30% threes; cut 6.9%, 1.30. Roll and pop are one bucket there (about 29% of its shots are
  popped threes): split in `PT`. EuroLeague 2017-18 hand-coded possessions (Int. J. Environ. Res. Public Health 18:1083)
  give the same order (PnR handler TOV 19%, post 18%, spot-up 7%).
- Catch-and-shoot vs pull-up 3P%: 37.1 vs 33.2 (NBA 2021-25), 39 vs 31 (EuroLeague 2022-23).
- Archetypes 2025-26 (NBA.com play types and touches, players grouped by role): play-type mixes and time on the ball
  (PnR engine 22% of his minutes, pass-first PG 22% at 18 usage, combo 15%, movement shooter 6% at 18 usage, 3-and-D 7%,
  connector 10%, hub big 12%, post scorer 10%, rim runner 5%; the median rotation player 8%). `init` is these as shares of
  a five's 57%. Taxonomies checked: Nylon Calculus 2017-19, BBall Index, CraftedNBA, arXiv 2403.13821, Hack a Stat.
- Interactions: 3P% by closest defender (6+ ft 38.6%, 4-6 ft 35.0%, 2-4 ft 29.9%); more drives, more wide-open threes
  (+10 drives/100 → +4-6 points of wide-open share); ShotTracker college half-court PPP 0.706 with no paint touch and
  no reversal, 1.061 with a paint touch; lineup summed usage (APBRmetrics: under 80% −7.1, 120%+ +2.8); two elite ball
  handlers lose about 9% of the pair's value (Maymin, Maymin and Shen); team assist rate goes with cut frequency (r .5),
  not cut efficiency (r 0); crashing (Wiens et al., Sloan 2013) and its faded transition cost; screen assists 8.3 a team-game.
- Calibration scripts (scratchpad, not kept): `roles_calib.mjs` (default fives on real rotations: the references),
  `roles_real.mjs` (role scenarios and a greedy optimiser on real starting fives), `hurley.mjs` (Thomas Hurley, SLB
  2026-27: rip 0.55 above green 0.52 before, green 0.74 Natural, rip 0.45 Workable after).

## The tactics screen (views/tactics.js, `#/tactics`)
- The five as **circles** on the court, **standing where their roles put them** (`roles.layout`, Louie: "player roles
  imply team spacing"): each role has a home off the ball (the top, a slot, a wing, a corner outside; an elbow, a block,
  the dunker spot inside) and the five's homes are its alignment, named in the court's header: 5-out, 4-out 1-in,
  3-out 2-in (two post or rolling bigs: 3-out 2-in; two perimeter bigs: 5-out). The colour is his share of the plays
  (cool few, hot many), the ring his time on the ball, the bar where his shots come from (rim · other twos · threes),
  badges for out of position (two positions away or more), wanting the ball more than the five can give, being forced
  to run it. His role under him (dashed: none chosen, the default plays). Hover: his 1-20 attributes. Press: his role
  at that place (the position's roles by category, each with its fit stars; what it asks, why he suits it, an animated
  demonstration from `roles.SCENES`) and his instructions.
- **The court to scale, laid out like a playbook** (Louie, 2026-10-15: "much more adaptive and look nicer", "this
  doesn't look like a basketball set up"). The half court is drawn in FIBA's measures on the same feet as the roles'
  spots, basket at the top as coaching diagrams have it (`tactics.js` `COURT_SVG`: 15 m wide, 14 m deep, the lane
  4.9 × 5.8 m, the three-point line 6.75 m and 6.6 m in the corners), in a box of the drawing's own shape so nothing
  stretches. The alignment spaces the men outside the way a set does, not each to his favourite spot (`roles.layout`):
  5-out = top, both wings, both corners; 4-out 1-in = top, both wings and the corner away from the big (both corners
  for two corner shooters; slots and corners with nobody at the point); 3-out 2-in = top and the wings, or the corners
  for corner shooters; each man to the spot nearest his role's depth (top, slot, wing, corner) on his own side. The
  live court starts its half-court possessions from the same alignment.
- Each man is a disc and a **nameplate** (FM's player tile: place, name, role, shot bar, his heat as its top edge).
  `fitCourt` places them after measuring the court, and again whenever its size changes: discs too close are eased
  apart, and every arrangement of the five plates (below, above, either slid a little, beside, a corner: 100,000 in
  all) is scored for overlap with the other discs, plates and the court's edge, the clearest kept. Narrow courts get
  smaller discs and plates; a court still too crowded drops the role line, then shrinks to name plates; a plate set
  off its disc is tied to it by a line in his colour. Checked at 1600, 1280, 1000, 820 and 390 px wide, both themes,
  in 4-out 1-in, 3-out 2-in and 5-out: no plate over another man (one 120 px² touch left in the phone's 3-out 2-in).
- The **bench beside the court**: drag a man onto a place (the role stays with the place, FM's way), or press. When
  the tactics area is too narrow for both (a container query), the bench goes under the court, its men side by side.
- **How this five plays**: gauges (time on the ball, pressure on the rim, spacing, screens, passing) and the notes; each
  man's plays, true usage, time on the ball and shot mix.
- **The rotation**, a box-score rotation chart at lineup granularity, by quarter (10:00 → 0:00), a cell a minute,
  painted with a lineup brush (named lineups: Starters, Bench, Second unit, Closers - each renamable), with Undo.
  **Patterns** a coach would use (Louie: "lineup 1 plays 5 minutes in the 1st then gets subbed out, has to close out
  the game in the 4th"), each previewed as a bar: *Classic* (the starters open each half for 6, come back at 14 and 34
  and close), *Five-minute stints*, *Ride the starters* (about 31 minutes), *Platoon* (every lineup in turn) and
  *Closers* (the last lineup takes the end of each half). Each man's minutes, a starter marker and his legs. A lineup's
  `when` holds its painted minutes (`engine.rotation` plays them; a minute nobody was given is lineup 1's); a plan from
  before the chart is painted as it was played (`engine.paintOf`).
- The Simulated panel is gone (Louie, 2026-10-14).

## The squad's views (views/squad.js)
Attributes, Stats (every row of the profile's simple view), Advanced (every row of its scouting view) and Manager season,
each value coloured by where it sits among his own league's players, every column sortable (`A.statViews` from pages.js).

## The live game (views/match.js, `#/match`)
FM's match screen, full screen (the rail and tab bar hidden):
- **Along the top:** the scoreboard (score, period and clock with tenths in the last minute, timeouts, team fouls), the
  speed (pause, 1× real time to 16×), and leave (the game is kept).
- **Down the left:** your five, each man with his energy, fouls, line and match rating (Game Score on a 1–10 scale).
  Under it, the bench.
  - Press a man for his instructions (for this game, from the next possession) and his substitution (at the next dead
    ball); dragging a bench man onto a man also works.
- **In the middle:** the court in 2D (below), or the shot chart. Under it the commentary and the margin's path.
- **Down the right:** Match (the clubs compared: shooting, boards, paint, fast break, second chance, off turnovers,
  biggest lead), Box score, Plays, Assistant (his notes on legs, foul trouble, runs, hot hands, the glass, plus the
  assistant-subs switch), Opposition.
- **Along the foot:** team instructions (for every lineup, the rest of the game), player instructions, **screen
  defence**, timeout, assistant subs on/off, the rest of the game now.
- **Screen D** (Louie, 2026-10-15: "can these screen defense options be able to be changed on the fly during games"):
  all your bigs' coverage at once, from the next possession - hedge, contain, drop, or each his own game's. The bigs are
  the men offered a coverage (`app.js` `screenBig`: a big by his listed position, or a man whose own game is a big's
  coverage) and whoever plays a big's role at his place now (a wing at the five). The button shows the floor's
  (Hedge, Contain, Drop, Own or Mixed). One man's is in his own instructions.
- **Each big's coverage on his row** (Hedges, Contains, Drops; both clubs): his instruction, else his own game's. The
  opposition's tells the reader what they meet: a rim protector who drops, a quick big who hedges.
- **The assistant reads the coverage** (`coverNotes`): the man of ours it hurts most (a roller into a dropping rim
  protector: "a big who pops would drag him out of the paint"; a loose handle against a hedge; a rim-bound driver into
  a drop), and the coverage that suits our bigs against their handlers and screeners when it beats the one played.

The engine is never more than one possession ahead of the clock on screen. So a period's end and the reader's own
timeout (`match.js` halts before the next possession) show before the next possession is played, and a change made
then counts in it. Quarter breaks pause briefly; half-time and the reader's timeouts wait for them. At full time the
game goes into the season (`A.endLive`).

`#/live/<round>` plays a game already played again, on the same screen, from its kept play-by-play.

**Practice games** (`#/practice`, administrators; Louie, 2026-10-15: "As admin, can I also have access to the ability to
do practice games too?"): the reader's club as it stands (lineups, roles, instructions) against any club of the league,
home or away, live on the match screen, any time. Nothing in it counts or is kept: no season, table, form or statistics;
the game lives in the page (`app.js` `startPractice`), and leaving ends it. Administrators are `is_platform_admin`
(local mode counts as one). The rail has "Practice game" (not on the phone's tab bar), and match day links to it.

### The court in 2D (views/match.js `makeCourt`, core/plays.js; Louie, 2026-10-15)
"Watching the game, it gives a good visual representation of how the team would play in real life with the set roles",
"use real life plays from playbooks ... assign them properly according to the player roles, position and what the
playing engine needs", "instead of being an SVG can it instead be rendered in 2D", "use football manager precedence for
rendering".

- **FM's 2D pitch, as a basketball court:** a canvas drawn frame by frame, top-down with the whole court in view. A FIBA
  court (28 × 15 m: the three-point arc 6.75 m, 6.60 m in the corners; the lane 4.90 m; the no-charge semicircle) in
  hardwood, the home club's colour in the keys and the centre circle. Each man is a disc in his club's **kit** (the
  reader's badge colours, a real club's colour with white or navy on it) with his number, his name under it (moved over
  it, or left off, rather than written over another; on a phone only the man with the ball's). On a colour clash the
  home side changes into white with its colour as the trim (FIBA's light-shirt rule and FM's change of kit). The screen's
  own colours (the comparison bars, the plays list) follow the kits. The ball carrier is ringed in gold; the ball has
  its shadow and grows as it rises (passes low, lobs and shots high); a screen is a bar at the screener's front as it is
  set; the play called is shown top left as the set starts (FM's set-piece label), with the men in it.
- **The engine has already played the possession** (`core/match.js`, a whole possession a step), so when its start is
  shown its end is known: who finished it and how (the zone, the shot's spot - the same as the shot chart's - the pass
  that made it, a break, an offensive board, a turnover, a trip to the line). `core/plays.js` draws backwards from it:
  1. **The kind of play** behind the finish, from the finisher's role: its play-type diet × each kind's measured shot
     mix (bent by the role's shooting style) × its assisted share (a turnover by each kind's turnover rate, a trip by its
     foul rate). A rim roller's assisted dunk is a roll or a dunker-spot cut; a movement shooter's assisted three comes
     off screens; a post scorer's own hook is a post-up; a Euro PG's pull-up comes out of the pick-and-roll (tests).
  2. **A set from the playbook** with a finish of that kind, zone and pass (`plays.BOOK`, 26 sets): high pick-and-roll
     (4-out 1-in), side pick-and-roll with a ram screen, Horns, pick-and-pop, the short roll against a trap, Spain,
     the drag screen and Pistol (early offence only), the Horns elbow handoff with its high-low, Chicago (pin-down into
     a handoff), Delay (the big at the top: handoff or backdoor), Horns flare, the zipper, Floppy, stagger screens,
     elevator doors, Hammer (the baseline drive, the skip to the weak corner), the Iverson cut, the UCLA cut, Chin,
     Flex, the post entry and split, high-low, the isolation and the clear-out, swing-and-attack-the-closeout; and the
     break (outlet, wide lanes, rim runner, trailer), the put-back, the kick-out off an offensive board, the foul to stop
     the clock. Each set is **cast** from the five: the finisher and the engine's passer where the finish puts them, the
     rest each to the place that suits him (ball handler, screener, hub big, post, shooter); weighed by how often a FIBA
     side runs it × how well the men suit its places × the clock (the drag and Pistol in the first seconds, an isolation
     and a side pick-and-roll late in the clock). A man not in the action keeps his role's own kind of spot, so the
     spacing is the roles'.
  3. **Its frames** from where everybody is: the inbound under the basket after a make (from out of bounds), the outlet
     after a board (the defence's guards leak out for it), the throw-in from the side; the advance straight into the
     set's alignment; the screens, cuts, passes and handoffs; the shot from the engine's spot. Each step takes at least
     the time its busiest man needs at a jog, and nobody runs faster than a sprint (a spacer short of time trails; in a
     break too quick for the floor the shot goes up from where the shooter got to - about 6% of shots, the shot chart
     keeping the engine's spot). The men carry their speed through gentle turns and stop and go on sharp cuts.
  4. **The defence** each moment, a step behind the offence: on the ball a yard off, between him and the basket
     (picked up near half court in the backcourt); one pass away up the line; two passes away the help "i" (the top man
     toward the nail, the low man on the weak-side block); on a drive the nail man digs and the low man meets it at the
     rim. Defenders run at a man's speed.
     - **The ball screen as the screener's man was told** (Louie, 2026-10-15: "hedge big = hedging, contain = show and
       recover, drop big = drop"): a hedge jumps out in front of the handler and recovers to his man (against the short
       roll it stays: a trap, the nail man taking the roller); a contain shows level with the screen and recovers; a drop
       sits back between the ball and the rim. The handler's man trails over the screen; the low man tags the roller
       while the big is out. Each set's screens and handoffs carry the hint (`plays.js` `defOf`, `cover`): his
       instruction this game, else his own game's coverage.
     - **The team's out of possession:** no paint touches packs the lane, funnel leaves the shooters' men home and the
       centre at the rim; men told to gamble play tighter, stay solid looser; rim protectors help harder on a drive.
  5. **Basketball logic in the movement** (Louie, 2026-10-16): the five's primary handler brings the ball up, enters
     it to the man who runs the set and, with time, swings it first (about three passes a half-court possession, under
     one in five with one or none); a point or combo guard runs the middle ball screens, a secondary handler or point
     forward the side pick-and-roll, off-ball scorers are run off screens (`roleW`); a drive or cut to the rim attacks a
     gap and turns the corner (a waypoint off the straight line, baseline from the corner) and a beaten defender goes
     hip to hip instead of standing in the driver's path; a teammate where the shooter is going lifts or drifts
     (`makeRoom`); a pull-up three goes up above the break - a corner three is a catch-and-shoot (`shotSpot`).
  5. **A trip to the line stops the clock** while it is shown (the shooter at the line, two of his men on the lane's
     second places, the defence on the first, the rest behind the arc; each free throw in the air), as a whistle does.
- Checked over whole simulated games (the core tests and a harness): every possession planned, nobody off the court,
  no number lost, the shooter at the engine's spot as the ball leaves his hand nine times in ten, nobody faster than a
  sprinting man; the calls' mix about a third from the pick-and-roll family and 8% post-ups, as the research's
  European shares.

**The research behind the plays** (2026-10-15; sources here, never in the shipped files). Set mechanics and options
from coaching sources and film breakdowns: The Hoops Geek, HoopStudent, Hooper University, Basketball For Coaches,
Breakthrough Basketball, Coach's Clipboard, Slappin' Glass, Squared2020, FastModel playbook diagrams, NBC Sports'
glossary, NBA.com film study, NABC clinic notes, team blogs (Denver Stiffs, Raptors Republic, CelticsBlog). Spacing:
Breakthrough (5-out), The Hoops Geek (4-out), Hooper University and HoopStudent (the dunker spot). Help defence: Low
Man Help, Slappin' Glass (the tag), Del Harris's pick-and-roll defence, Human Kinetics (the closeout), Hooper University
(drop coverage). Frequencies: NBA.com/Synergy play types 2024-25 summed over the 30 teams; ESPN's GeniusIQ tracking
(picks, handoffs, isolations, post-ups per 100 half-court possessions); EuroLeague/Sportradar and Eurohoops stats
reviews (ball screens about 39% of possessions, post-ups about 7%, transition about 10%); Nunes et al. 2022 (ACB ball
screens: side 48%, a second screener 15%, coverages), Amatria et al. 2025 (Final Four ball screens), Foteinakis et al.
2024 (end of close games), Akinci 2023, Gómez et al. 2015, Morillo-Baro 2021. No public source counts individual sets:
the set weights are fitted to those shares.

## The economy (core/value.js)
1. A player's index weighs points most, values minutes, and weights bigs (and athletic, shot-blocking bigs most).
2. The index becomes a percentile p in the league.
3. The value is `min + (max − min) · p³`, inside the league's range. The best go up to 12% over the range and the
   fringe up to 12% under.
4. A club linked (in Links) to a side in a boosted league adds that league's boost.

Wages are 16% of value, and the squad budget is 12 × the league's average wage. A trade may bring in any value as long
as the wages stay within budget. Leagues without a range take the middle league's range (`medianRange`).

## Box scores
A game's box score is EPINOIA's own game page drawing it.
- `core/scorer.js` turns the play-by-play into the scorer's event log: shots placed in their zones, assists, blocks,
  fouls (offensive among them) and free throws, turnovers and steals, boards, substitutions, timeouts.
- The log is handed over in `sessionStorage` (`mgr_game`) to `game/?mgr=1` and embedded with `&embed=1` (no rail).
- Every tab works: the traditional and modern box, the play-by-play with linked plays and faces, shot charts, lineups,
  full stats, game flow, connections, play types and the shot clock.

A Manager game has no match report, no league table and no PDFs. The core tests replay the converted log through
`epinoia/engine.js` back to the Manager's own box, player by player, fouls included.

## The realism marks (tools/manager-validate.mjs → manager/validation.json, shown on GO)
Four complete seasons were replayed with the possession engine, every club against every other, home and away, six
times (6,384 games). Each club was built the way the Manager builds it, with its real starters.

| League | r (identity) | r (players alone) | Points a game, sim (real) | Home wins, sim (real) |
|---|---|---|---|---|
| ORLEN Basket Liga 2025-26 | 0.97 | 0.70 | 86.0 (85.5) | 62% (60%) |
| Primera FEB 2025-26 | 0.98 | 0.94 | 82.2 (80.9) | 60% (61%) |
| NBL Division One 2025-26 | 0.96 | 0.77 | 76.1 (75.9) | 59% (58%) |
| CEBL 2026 | 0.94 | 0.66 | 94.4 (92.7) | 62% (61%) |

Re-run on 2026-10-15 after the position rule (no cost within one position): r 0.949 (0.941 before), points a game
0.7 from real (0.9), players alone 0.768 (0.789). Then with the ball-screen coverage (every real club's bigs playing
the coverage their game suits, against the league's own mix): r 0.958, players alone 0.773, points a game 0.6 from
real; `--no-cover` reproduces the marks before it exactly (the games are seeded). With the real clubs' tactics (2026-10-16): r 0.964, players alone 0.770, points a game 0.9 from real; `--no-tactics` plays without them.

"r" is the correlation of each club's simulated margin with its real point difference. Run the tool again
(`node tools/manager-validate.mjs`) whenever the engine changes, and commit the file.
- `--dry` prints the diagnostics against the real season: possessions, eFG%, turnovers, free-throw rate, the glass,
  free throws, fouls and foul-outs.
- `--engine stretch` uses the older engine; `--no-starters` and `--decay` vary the real starters; `--no-cover` plays
  without the ball-screen coverage.

## The database (0259)
- `manager_teams`: owner-only RLS. Written only through `manager_create`, `manager_save` (sizes checked) and
  `manager_delete`.
- `manager_league_values`: public read, written by `manager_set_values` (platform administrators only).
- `manager_boosts(league)`: each club's continental boost, through the 0178 links.
- `manager_leaderboard(league?, limit?)`, `manager_board_leagues()` and `manager_badges(ids)`: a club's own names, badge
  and record only, never the account.
- Names are checked against the username blocklist, including disguised letters.

**Until Louie runs `supabase db push` for 0259:**
- the Manager cannot save a club;
- GO's boards say they are on their way;
- the console's tab saves nothing.

`?local=1` runs the whole game against this browser's storage for trying it out.

## Next
- Friends mode: shared leagues with a creator, join requests accepted or rejected, public or private leagues, "please
  wait for friends" until the creator starts the league, and head-to-head records. Also the GO "Leagues" list of
  friends' leagues that want players.
- The Manager's languages: the `manager` pack (ja, es) for the whole game.
