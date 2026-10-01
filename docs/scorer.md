# The scoring app at the table

The scorer is `epinoia/score/`. Its logic is in `index.html`; `bootstrap.js` publishes the game, claims the fixture and finalises it; `sync.js` and `live.js` carry the events; `sw.js` keeps it working offline.

This page says how it applies the rules and what it does when something goes wrong at the table. It was written after a review on 2026-10-01 covering three things: the rules, what happens to a game when the phone or the network fails, and scoring a whole game by hand on a phone and a desktop.

## One set of numbers

The scorer works its box score out with `epinoia/engine.js`. That is the same function the public game page, the season tables and `finalise-game` use. Before this, the scorer had its own copy, and the two had drifted apart:

- minutes for a player sent on twice;
- points in the paint and fast-break points;
- the split between shots at the rim and mid-range.

So the numbers checked at the table were not always the numbers the league published. The page keeps its own copy only as a fallback, in case `engine.js` fails to load.

## The rules

| | What the scorer does |
| --- | --- |
| **A missed shot the shooter was fouled on** | Not a field goal attempt. FIBA statistics count only the free throws, and NBA statistics do the same. The foul records the shot it was on (`foul.shot`). While a shooting, unsportsmanlike or disqualifying foul stands, that shot is stored as `p2_fouled` / `p3_fouled`. Nothing counts that type, and the play-by-play still prints "2pt missed, fouled". If the foul is deleted, undone, or changed to a plain personal foul, the shot counts as a miss again. |
| **Team fouls** | A foul committed by a player counts, of any kind, technicals included. A bench foul does not: a coach's or substitute's technical, unsportsmanlike or disqualifying foul recorded with no player named. A team personal foul with no player named still counts. Overtime carries on the fourth quarter's count. |
| **A player who has fouled out** | Cannot come back on, by drag, tap or the substitutions panel. A foul by him while on the bench is recorded as a bench foul, which is the coach's, and notes who committed it (`by`). |
| **Running out of players** | A player can go off with nobody replacing him, but only when nobody eligible is left on the bench. That is recorded as `{t:'sub', out, in:null}`; `{out:null, in}` brings a player back to a team that was short. The team header shows "4 on court". The engine, RAPM and the rotation chart all accept this. |
| **Rebounds** | Offered only where the ball is live: after a missed field goal, or after the last free throw of a personal or shooting foul. Not after the first of two, and not after a technical, unsportsmanlike or disqualifying foul's free throws. |
| **Assists and blocks** | Never on a free throw. Gestures, chips and typed commands all use the same check (`followUpWhyNot`). |
| **Free throws in a window** | The window keeps its foul for the whole set. Changing the foul's type changes the recorded foul and the number of free throws due: a technical gives 1; a foul on the floor in the penalty gives 2. Before, the window lost the foul after the first free throw. |
| **Who was fouled** | Taken from the shooter in a shot's window. For a foul entered with the foul button, it is the player who takes the first free throw (not for a technical). |
| **The clock** | It stops on a held ball and on a violation turnover (travel, 24 seconds, out of bounds, double dribble). It also stops on fouls, free throws, timeouts and a made basket in the last two minutes, as before. |
| **The possession arrow** | It flips at every period start. Undoing a period start now undoes the period change too, and setting a later period with the adjust-clock control adds the missing period starts. Before, the arrow could end up one flip out. |

## At the table

**Recording a play**
- A missed shot shows a "rebound → tap" chip from its first step, and a made one shows "assist → tap". The type and the place of the shot are optional.
- A foul with no free throws due closes by itself. One with free throws says how many and counts them on the bar.
- After a tap on a row, a click on the team header within 0.45 s is ignored. That click came from the same touch after the screen had moved, and it recorded a team rebound.

**Correcting**
- **Undo** takes back a whole play. A shot's type and location come off with it, and an offensive foul comes off with its turnover. Redo puts the whole group back.
- **The play-by-play editor**:
  - It can add or move a **substitution** at a past time. It offers only the players on court at that moment, and checks the changes that come after it.
  - Deleting a substitution that later ones depend on says so.
  - Deleting a basket asks whether to delete its assist too. A missed shot asks about its block and rebound, and a turnover about its steal.
  - Times open as the log shows them. Saving without changing a time keeps the time and its video stamp as they were.

**Starting and ending**
- **Starting** needs a full set of starters. Two players with the same number on a team are flagged before the tip.
- **Ending at a level score** offers overtime instead. Ending early, or with a fouled-out player still on court, says so before it happens. The full-time question offers "end the game", and "end game" moves to the front of the menu once there is a winner.
- **The final screen**:
  - It can **reopen** the game. If the game has already been finalised, reopening it goes through `finalise-game`, which withdraws the published box score until it is finalised again.
  - It also opens the **scoresheet** and the **match details**. The scoresheet now lists each team's timeouts (when they were called) and its bench fouls (with who committed them).
  - Once the league has the game, the editor will not change it until it is reopened.

**Keys and screen**
- On a desktop, Enter answers the dialog on screen and Esc says no to a yes/no question. Before the tip, Enter begins the game.
- On a phone:
  - The chips scroll sideways in one row, and the location court opens over the bench, so the roster no longer jumps while a play is entered.
  - Toasts wrap and sit above the legend.
  - The done disc is readable, and the legend's "✓ done" and "✕ back" pills are real buttons.

## Saving

- A game in progress is never replaced without a question. "Start game" on the starter picker asks first, and keeps a copy of the old game under `epinoia_v1:replaced`.
- Every save records the time (`savedAt`). The game is also saved when the page is hidden or closed.
- A game restored with its clock running says how long ago that was, and offers the time the board should show. The clock stays stopped until the statistician checks it.
- A tab that is not the one scoring the game (`window.epReadOnly`, set by `bootstrap.js`) never writes.
- A game built by the practice button is marked `training`. It is never claimed, published or finalised.

## Not done yet

- **Other formats.** Quarters are 10 minutes and overtime 5 everywhere (`PLEN`), in the scorer, the engine and the game page's flow charts. The foul-out limit is 5, and `finalise-game` expects 10-minute quarters. Leagues with 8- or 12-minute quarters, or 20-minute halves, need a per-game period length passed through all of them.
- **Coaches.** There is no coach on the sheet. So there are no C/B technicals against the coach by name, and no disqualification after two C or three in all.
- **Fouls in an interval.** These count toward the period that just ended. FIBA counts them toward the next one.
- **Late arrivals.** The roster is frozen at the tip, so a player can't be added once the game has started.

## Tests

`supabase/tests/scorer-review.test.mjs` covers all of the above:

- the engine's rules on real calls;
- the scorer's functions, lifted out of the page and run on stand-ins;
- how they are wired in.

It runs in `guard.yml`, beside `scorer-foul.test.mjs` and `scorer-render.test.mjs`.
