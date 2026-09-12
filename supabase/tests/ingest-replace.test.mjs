/* ============================================================================
   A CORRECTED FEED MUST NOT EMPTY THE GAME, OR UN-TIME IT.

   When the Genius feed revises something, run_ingest cannot append — the
   existing log is no longer a prefix of the new one — so it rewrites. Three
   faults, all watched happening on live fixtures on 2026-09-12.

   Caught three times in fifteen minutes, not twice: 82 -> 0, 114 -> 0, 154 -> 0.

   1. THE GAME WENT EMPTY. It was `delete everything, then insert everything`:
      two requests with no transaction around them, so between them the game had
      no play-by-play at all. Caught twice inside five minutes on two different
      live games — 82 events then zero, 114 events then zero — while games.
      home_score still read 2-16. Anything reading the log in that gap (the
      public game page, the box score, the broadcast endpoint, finalise-game)
      saw a game that had not been played. It heals a second later, which is
      exactly why nobody had seen it.

   2. THE WALL STAMPS WENT WITH IT. The stamps already earned are carried across
      by matching the old rows against the new, and the key included `pid` — the
      one component that is a PLATFORM id rather than feed data. Player rows are
      minted during a game as substitutes appear, so a pid that is re-resolved
      between two polls changes for every event naming a player while the play
      itself has not moved. The carry then matches nothing, and because only rows
      past len(existing) get a fresh stamp, everything before that point is left
      permanently unstamped: it cannot be re-stamped on any later pass, and every
      replace after it has nothing left to carry. A ratchet.

      Measured the same evening: all four live games ended up largely un-timed.
      One of them held 251 of 251 for as long as it went uncorrected and then
      dropped to 67 of 325 the moment it was, which is the clearest statement of
      the mechanism there is. Translating a feed afresh and
      comparing field by field found t, team, period and clock IDENTICAL across
      all 144 rows — so the four fields describing the PLAY are stable, and the
      one that broke the carry describes our database.

   There is no Python test harness in this repo, so these assert the source.
   The behaviour above was established by watching production, not by this file.

     node supabase/tests/ingest-replace.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'scripts', 'ingest', 'run_ingest.py'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

console.log('\nthe game is never empty');

ok('the log is upserted over itself rather than deleted and rebuilt',
   /sb\.upsert\("game_events", rows\[i:i \+ 400\], "game_id,seq"\)/.test(src));
ok('...so there is no unconditional delete of the game left',
   !/sb\.delete\("game_events", f"game_id=eq\.\{game_id\}"\)/.test(src));
ok('...and only a log that got SHORTER deletes anything, and then only the surplus',
   /if existing and len\(rows\) < len\(existing\):/.test(src) &&
   /sb\.delete\("game_events", f"game_id=eq\.\{game_id\}&seq=gt\.\{len\(rows\)\}"\)/.test(src));
ok('...which works because the rows are keyed on (game_id, seq)',
   /"game_id,seq"/.test(src));
ok('...and the reason is written down where the next reader will need it',
   /there must be no instant at which the league's copy of the game is empty/.test(src));

console.log('\nand it is not un-timed');

ok('the carry key no longer contains pid',
   /carry\.setdefault\(\(e\["t"\], e\.get\("team"\), e\["period"\], e\["clock"\]\)/.test(src) &&
   !/carry\.setdefault\(\(e\["t"\], e\.get\("team"\), e\.get\("pid"\)/.test(src));
ok('...on both sides of the comparison',
   /k = \(r\["t"\], r\["team"\], r\["period"\], r\["clock"\]\)/.test(src));
ok('...and the reason is recorded: pid is ours, the other four are the feed\'s',
   /the only component of that key which is a PLATFORM id/.test(src));
ok('...with the measurement that established it',
   /t,\s*\n\s*# team, period and clock IDENTICAL across all 144 rows/.test(src) ||
   /team, period and clock IDENTICAL across all 144 rows/.test(src));

ok('anything the key still missed is carried by position, as the comment always claimed',
   /if kept < len\(existing\):/.test(src) &&
   /for i, r in enumerate\(rows\):/.test(src));
ok('...only onto a row that is still the same play',
   /!=\s*\(r\["t"\], r\["team"\], r\["period"\], r\["clock"\]\)/.test(src) &&
   /continue/.test(src));
ok('...and never over a stamp already carried',
   /if "wall" in \(r\.get\("payload"\) or \{\}\):\s*\n\s*continue/.test(src));

/* The ratchet is the reason this matters more than one lost stamp: the branch
   that hands out fresh stamps only reaches rows past the old length. */
ok('the fresh stamp still only goes to rows past the old length',
   /for r in rows\[len\(existing\):\]:/.test(src));
ok('...which is why the carry has to work, and is said so',
   /A\s*\n?\s*# ratchet, not a blip\./.test(src) || /ratchet, not a blip/.test(src));

console.log('\nand the error bar says what it means');

/* observed[1] is built in live_keeper as the CONFIGURED interval plus the fetch
   duration, and the comment there is right about the meaning while the
   arithmetic is not: the previous poll of THIS game was not `every` seconds ago,
   because live_keeper walks the due set in one serialised loop doing a fetch and
   a whole write pass per game before sleeping.

   Measured across four simultaneous live games, 46 intervals: median 37.9 s
   against a claimed 10.5 s, 40 of 46 wider than claimed, worst 18.9x. Every row
   of a batch is stamped with the poll's instant, so the earliest play in it is
   that much earlier than its stamp — and video.js spends wall_err as run-up when
   it cuts a clip, so an understated bar puts the play in front of its own
   window. The page prints the number too: "plays placed to within +/-N s". */
ok('the stamp widens its error to the real gap when the log knows better',
   /const newest = max/.test(src) === false &&   /* python, not js */
   /newest = max\(\(int\(\(e\.get\("payload"\) or \{\}\)\.get\("wall"\)\)/.test(src));
ok('...which is the previous poll of this game, by definition',
   /the newest\s*\n?\s*# wall in the existing log IS when this game was last polled/.test(src));
ok('...and never narrows it', /if real > err:\s*\n\s*err = real/.test(src));
ok('...covering a pass handover, which the loop cannot see at all',
   /a process that has already exited/.test(src));
ok('past three minutes it declines to stamp rather than claim a bound it has not got',
   /if err <= 180_000:/.test(src) &&
   /an unstamped row is better than a confidently wrong one/.test(src));
ok('the measurement that justifies it is recorded',
   /median 37\.9 s against a claimed 10\.5 s/.test(src));

/* And the one other reader of observed[1] asks a different question. */
ok('the running heuristic keeps the CONFIGURED value on purpose',
   /DELIBERATELY THE CONFIGURED INTERVAL/.test(src) &&
   /fast = bool\(observed and observed\[1\] is not None and observed\[1\] <= 6000\)/.test(src));
ok('...and says why, so nobody widens it to match the stamp',
   /would make a slow pass look like a fast one/.test(src));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
