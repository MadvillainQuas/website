# The player profile's League percentile

Every bar on the profile is a statistic ranked against the rest of the competition. Two switches sit above the bars.

## Scouting view and simple view

- **Scouting view** is the bars as they always were: scoring, shooting by distance, playmaking, rebounding, defence and impact.
- **Simple view** is the box score per 75 possessions. It also shows the three shooting percentages (FG%, 3P%, FT%).
  - The per-75 figures are PTS, FGM, FGA, 3PM, 3PA, FTM, FTA, REB, OREB, DREB, AST, TOV, STL, BLK and PF.
  - Each count is × 75 ÷ the possessions his team had while he was on the floor. This is index_9's "per 75 lineup possessions". The season line carries those possessions as `on_poss`.
  - So twelve minutes a night and thirty-six read at the same rate, and nobody is flattered by his team's pace.
  - Under 20 possessions on the floor a figure is left blank.

Every bar in both views has its percentile, the gap to the league average, and the chart behind a tap. Each Simple View stat has its own explainer in `statinfo.js`. Turnovers and fouls rank lower-is-better.

## All, vs. starters and vs. bench

**All** is the baseline. The other two show his own numbers in the minutes he played against the other side's starters, or against its bench. The rule is the club page's own, and index_9's:

- **Against the starters:** the other side had 4+ of its regular starters on, or 4+ of that game's starting five. A regular starter is a player with N starts or more for his club in the scope; N is the club card's choice (10 by default).
- **Against the bench:** every other minute.

On each bar:

- the fill is the split figure, ranked where it would sit among the same players as in All;
- the tick is where all his minutes in the same games sit;
- under it is the gap to them ("−1.5 vs all his minutes").

The note above the bars gives the rule and how much of his season it covers (e.g. "138 of his 299 minutes, over 12 games with play-by-play").

### How it is worked out

`epinoia/vsunits.js` replays each of his club's games with the engine. Wherever either five changes, it takes his box and both sides' totals while he was on the floor, and files them under the other side's unit. So the two parts always add up to his game. Each part then becomes a season line through `season.js`, so every rate is the season line's own formula over the minutes it covers. A per-game figure in a part is his rate per minute × his minutes per game.

Some things cannot be split, and say so:

- on/off (a part is all minutes on the floor);
- box plus/minus (it needs a whole squad's season);
- the assisted shares (they come from per-game situation lines);
- the rim defence (it needs his minutes off).

### What it loads

Nothing more than before, until somebody presses vs. starters or vs. bench:

- the games come from "On the floor with", which has already read his club's last 40 game logs;
- the engine (`engine.js`, 38 KB) is fetched on the first press;
- the scope's starting fives are one small read, about 25 KB for a season of LNBP;
- a competition past 800 games skips that read and uses only each game's own starting five.

The split is worked out once per scope and kept for the page's life.

Without analytics, the switch shows what it would add instead.

## Tests

`supabase/tests/vsunits.test.mjs` checks:

- the per-75 figures and their possessions;
- the starters rule, against the club page's own count;
- a game cut at each change of five, adding up to the engine's own box;
- the parts as season lines;
- the ranking, against `season.js`;
- that the profile reads nothing more until asked.

`statpop.test.mjs` checks every simple-view bar has an explainer and the right lower-is-better flag.
