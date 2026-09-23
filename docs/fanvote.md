# The weekly fans' vote

"Make your voice heard" on a league's front page: the fans pick last week's best player (1st,
2nd, 3rd) and the club with the best performance. The winners go above the Stars, every week's
winners have their own page, and the league's admins see every tally.

Migration `0148_fan_vote.sql`; the Edge Function `supabase/functions/fanvote`; the page is
`epinoia/fanvote.js` + `epinoia/kit/fanvote.css`. Tests: the migration's own self-test, and
`supabase/tests/fanvote.test.mjs` (the page's rules, the ballot picker, the wiring).

## The week

| | when (the league's clock) |
|---|---|
| the week voted on | Monday 00:00 to the next Monday 00:00 |
| the vote opens | the Monday after, 06:00 (Sunday night's games are finalised by then) |
| the vote closes | the end of that Thursday (Friday 00:00) |
| the winners go up | as it closes, before the weekend's games |

The clock is the league's country (`fanvote_zone`, London when it has none), converted once
per wall time, so a clock change inside the week moves nothing. A week with no finished game
has no round. A game still `live` or `finalising` holds the round back for the first six hours
of the window and no longer, so one game stuck on a scorer's table cannot cost the week its vote.

## Who is on the ballot

**Players: the fifteen best of the week by BPM.** This is the Stars podium's own rule
(`epinoia/stars.js`, window `week`: at least one game and twenty minutes, best BPM first). The
server decides it, not a browser: the `fanvote` Edge Function runs the same `stars.js`, `season.js`
and `bpm.js` the league page runs (copied by `supabase/tests/extract-shared.mjs`), and hands the
top twenty-five to `fanvote_open`. The database drops anybody withheld (a minor without consent,
0049) or unknown, and keeps the first fifteen. Asking for twenty-five means a withheld player costs
the ballot nobody.

**Clubs: every club that won a game that week.** Ordered by wins, then the week's total margin,
then the name. Each card carries its results ("W 80–70 v Owls", or "2–0 · +24"). A tie is nobody's
win. The database keeps up to 32 clubs as a guard; no league on the platform comes near that in a week.

A round is opened once. Two pages asking at the same moment get the same round, and its cards
never change after that.

## How a round gets opened

Nothing is scheduled. `fanvote_state` (which every league page asks for) says `due: true` when
the window is open, the league wants the vote, no round exists yet and the week had a finished game.
The page then POSTs `{ league }` to `functions/v1/fanvote`. The function asks `fanvote_due` itself
(it trusts nothing the page says), reads the week's games and box scores, picks the ballot and
calls `fanvote_open`. `fanvote_due` and `fanvote_open` are the service role's only.

So the first visitor of the week opens it. A league nobody visits has no round, and nothing is lost.

## Voting

- **Anyone may vote, once per browser.** A signed-out ballot is keyed to the browser's random key
  (`epinoia.ballot.voter`, the Team of the Year ballot's), stored only as its md5. A signed-in ballot
  is keyed to the account, and it **absorbs** the ballot that browser cast before signing in, so
  signing in is never a second vote.
- A ballot can be changed until the round closes. Players and club are saved separately, so a
  fan who stops after the players has still voted for them.
- The players need three different players from the ballot (fewer only when fewer are on it).
  The club must be on the ballot, or skipped.
- At most 30 new signed-out ballots from one network address in ten minutes (`PT429`).
- This stops the accidental double vote and the idle refresh, not somebody with two browsers.
  The console shows how many ballots came from accounts, which is the harder number.

## The score

3 points for a 1st, 2 for a 2nd, 1 for a 3rd. Ties go to more 1sts, then more 2nds, then the
better BPM rank on the ballot. The club with the most votes wins, ties to the better-placed card.
A round nobody voted in has no winner, and a club with no votes never wins.

## The panel

It unrolls out of the rule under the hero, in the league's colour, and asks the two questions in
turn. The cards sit on one strip with ‹ › buttons (a swipe on a phone). A card goes onto the
podium by dragging it (a press and hold on touch) or by tapping cards in order. A placed card can
be dragged to another place to swap. The club question has a Skip button.

**When it opens by itself (`shouldAutoOpen`):** only on the first visit to that league in a round.
Closing it with the ×, voting, or just seeing it all count as seen. The exceptions:

- **Remind me later** brings it back on the first visit six hours on.
- **Don't show this again** turns it off. Signed in, that is the account's switch
  (`fan_prefs.want_fanvote`), which the profile page can turn back on, on every device. Signed out,
  it is this browser's own note.
- A finished ballot never opens it again that round.

The browser keeps its notes in `localStorage['epinoia.fanvote']` (`{ never, rounds: { <round>:
{ shown | closed | later, at } } }`). A round's note is forgotten after two months. The panel can
always be opened by hand from the Fans' picks section.

## Where it shows

| | |
|---|---|
| league page | the panel (under the hero) and **Fans' picks** above the Stars: last week's winners with the laurels, and the way into the open vote |
| `epinoia/votes/?l=<league>` | every week's winners, and the most weekly wins; in the league menu once the league has held a vote |
| profile | "Weekly fans' vote" switch |
| league admin → Fans' vote | every week's tally (ballots, from accounts, each player's 1sts/2nds/3rds/points, each club's votes, skips) and the season's totals with weeks won |
| league admin → Appearance | **Fans' vote** turns the whole thing off: no rounds opened, no panel, no section |

## Privacy

Every read and every vote asks `league_visible` first, so a private league's vote is its invited
fans' and a members-only league's is its members'. Only the rounds' dates are readable through
the table (for the menu's probe). Candidates, ballots and tallies come out only through the
functions. No ballot is ever shown to anybody but the browser or account that cast it.

## Deploying

1. `npx supabase@latest db push` (0148 after 0147).
2. `npx supabase@latest functions deploy fanvote` (it is `verify_jwt = false` in `config.toml`:
   a signed-out page calls it, and it decides everything itself).
3. The site.

A round can only open inside its window, so a deploy on a Friday, Saturday or Sunday shows
nothing until Monday 06:00.
