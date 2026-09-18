# The injury report / waiver wire

**Who is missing, worked out rather than typed in.** No league on this platform files an
injury list and none of them will start. But every finalised game already says who was on
the sheet and for how long, so a player the club was playing who has not taken the floor
since is a fact the box scores already hold.

| | |
|---|---|
| The rules | [`epinoia/injuries.js`](../epinoia/injuries.js) — pure, no requests of its own |
| The page | [`epinoia/injuries/`](../epinoia/injuries/) — `?l=<slug>` for a league, nothing for the global wire |
| On a preview | `EpinoiaPreview.injuriesHTML` in [`epinoia/game/preview.js`](../epinoia/game/preview.js), fed by `outFor()` in `game.js` |
| Releases | [`supabase/migrations/0132_player_releases.sql`](../supabase/migrations/0132_player_releases.sql) |
| Held by | [`supabase/tests/injuries.test.mjs`](../supabase/tests/injuries.test.mjs) |

## 1. What counts as missing

Two kinds of absence, which are the same thing to a reader:

- **OUT** — no row in the box score at all. Not on the sheet.
- **DNP** — a row, nought minutes. Dressed and did not play.

Neither means anything on its own: a twelfth man missing a game is not news. An absence is
only reported for somebody the club **was playing**:

| Threshold | Default | What it means |
|---|---|---|
| `MIN_GP` | 2 | appearances for **this club** before an absence counts |
| `HEAVY_MIN` | 20 | minutes last time out → `reason: 'starter'` |
| `ROTATION_MPG` | 15 | minutes a game over his appearances → `reason: 'rotation'` |
| `SHARE` | 0.6 | share of the club's games since his first → `reason: 'regular'` |
| `REGULAR_MPG` | 8 | …and the minutes that share has to be made of |
| `STALE_GAMES` | 10 | beyond this it is waiver-wire history, not a fresh absence (`stale: true`, and off the previews) |

Pass `opts` to `report()` to move any of them for a league that wants them elsewhere.

**Judged on the games before the absence, never on the season average.** Reading it off the
season would let the absence answer the question about itself: three weeks out drops a
28-minute starter under every line you can draw, and the longer somebody is hurt the less
hurt they look.

## 2. It resolves itself

There is no "resolved" flag, because there is nothing stored to clear. The report is
computed from the games every time it is drawn, so the first game a player records a minute
in he is off the league's report, off the global wire and off the previews **together** —
none of the three is holding a judgement of its own.

## 3. The two things it must not call an injury

**A transfer.** A player who left is missing from his old club's box scores forever. If he
turns out for anybody else after his last game here, he is gone, not hurt, and the report
drops him. A game for another club *before* he arrived proves nothing and is ignored.

**A release.** This is the one thing the box scores cannot hold: a released player never
appears again, so without being told, the report would keep him forever. So the club says
so — one row in `player_releases`, whose presence means released:

```
set_player_released(p_team, p_player, p_released, p_note)  ->  'released' | 'active'
```

Written by a **team manager or their league's administrator** (`is_team_manager`, 0001),
from the wire itself or from the player's own profile page. Un-releasing deletes the row; a
player who comes back is just a player again and the report picks him up the moment he
plays. Every call writes an `audit_log` row. `teams_i_manage(uuid[])` answers "which of
these clubs do I manage?" in one call, so a page of twenty clubs does not make twenty.

A signed-out reader never loads the Supabase SDK for any of this
(`window.epinoiaMaybeSignedIn()` looks at the stored token first).

## 4. Where it appears

- **A league's report** — `/epinoia/injuries/?l=<slug>`, on that league's rail. One
  expandable dropdown per club, the clubs with somebody missing first. **Every** club is
  listed: a club left off the page reads as "not checked" rather than "nobody out".
- **The global wire** — `/epinoia/injuries/`, on HOME's rail. A dropdown per league, its
  clubs inside.
- **A game preview** — an `INJURY REPORT` section between the starting five and the venue:
  each side's unresolved absences as question marks (a dash for a DNP), capped at five a
  side, stale ones left off. "Nobody missing." where there are none, and no section at all
  when neither club has anybody.

## 5. What it costs

Nothing that was not already being read. `EpinoiaData.season()` and `statsForGames()` both
return `pgs` (the per-game player rows) alongside the season totals, which with `games` is
everything `report()` needs. The only request the feature adds is `player_releases` for the
clubs on screen — and a database that has not taken 0132 yet answers empty rather than
breaking the page, so the report works read-only before the migration is applied.

## 6. Applying it

```
cd /d C:\Users\Admin\Documents\website_membership
```

```
npx supabase@latest db push
```

Never `supabase db query`. `db push` is not transactional: if it stops half way, fix the
file and push again.
