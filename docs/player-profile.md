# The player profile

A player's page (`p/`). Its code is `p/player.js`, with `p/withui.js` (on the floor with), `shotchart.js` (the shot chart) and `fulltable.js` (the career table). It predates the page standard (`docs/page-standard.md`), so it keeps its own sections.

## Shot chart: the zones as a table

Under the court, every zone and then the larger cuts (the sides, the paint, jump shots, every shot), in the club page's table dress (`kit/clubstats.css` `table.czt`): a heading row over each group, each zone's swatch by kind, and the share of the shots as a bar in the club's colour. Each row has its makes of attempts, its share, its attempts and makes per game, its FG% and its eFG%.

**The colours are the court's.** FG% and eFG% sit on pills tinted on the same diverging scale as the zones above them: blue below the break-even, orange above, grey within two points, three steps a side. The gap to the break-even is under each pill.

- A zone's break-even is its kind's: paint 58%, mid-range 40%, three 35%.
- A cut of several kinds is held to the mix it was shot from, weighted by attempts. So "every shot" taken mostly at the rim is not judged against the three's 35%.
- eFG% counts a three as one and a half makes, and so does its break-even (35% from three is 52.5% eFG).
- A row under the court's attempt floor is hatched, as its zone is: too few to rate is not average.

Below 600 px of the table's own width, every row is a card with its figures on one line. Code: `shotchart.js` `zoneRows` and `zoneTableHTML`, `kit/shotchart.css` (`.scz`). Test: `supabase/tests/zone-table.test.mjs`.
