/* ============================================================================
   A SECOND DEVICE MUST NOT PUBLISH AN EMPTY GAME OVER A LIVE ONE.

   The scorer never read an existing log back: loadFixture fetches the squads
   and nothing else. So a phone opening a fixture that is already being scored
   started at seq 1 with no events, and three things followed, none of them
   visible from that phone:

     * its events collided with the real ones and were DISCARDED, because the
       durable write is an upsert on (game_id, seq) with ignoreDuplicates
     * it published its own 0-0 over games.home_score / away_score, so every
       homepage, ticker and strip showing that fixture snapped back to nil-nil
     * both devices broadcast on one channel, so viewers watched the score flip

   Not an exotic case: a private window, cleared storage, a colleague taking
   over at half-time, a spare tablet opened to check. Rare at one game a week
   and inevitable at six a Saturday.

   These assert the recovery — the part with real logic in it. The guard that
   halts publishing is asserted in scale.test.mjs.

     node supabase/tests/takeover.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
const src = readFileSync('C:/Users/Admin/Documents/website_repo/epinoia/score/bootstrap.js', 'utf8');
function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* 2400 recorded actions: three pages, and seq numbers that do not start at 1
   because the other device has already had events deleted out of the middle. */
const rows = Array.from({ length: 2400 }, (_, i) => ({
  seq: i + 7, t: i % 5 === 0 ? 'p3_made' : 'p2_miss', team: i % 2, pid: 'p' + (i % 10),
  period: 1 + Math.floor(i / 600), clock: 600000 - (i % 600) * 1000,
  payload: i % 5 === 0 ? { tag: 'transition' } : {}
}));

/* The squad as this device holds it: the frozen roster_snapshot loadFixture
   returned, which is the same one the other device wrote its starters against. */
const squads = () => [
  { name: 'home', players: [0,1,2,3,4,5,6,7].map(i => ({ id: 'h' + i, name: 'home ' + i, num: i })) },
  { name: 'away', players: [0,1,2,3,4,5,6,7].map(i => ({ id: 'a' + i, name: 'away ' + i, num: i })) }
];
/* The table matters now: loadRecorded reads game_state for the clock AND games
   for the three things the log cannot tell it — who started, who won the tip and
   which way the arrow was pointing. */
const client = game => ({
  from: table => ({
    select: () => ({
      eq: () => ({
        order: () => ({ range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }) }),
        maybeSingle: async () => ({ data: table === 'games'
          ? game
          : { period: 3, clock_ms: 412000, running: true } })
      })
    })
  })
});
const sb = client({ starters: [['h2','h3','h4','h5','h6'], ['a1','a2','a3','a4','a5']],
                    tip_winner: 1, arrow_init: 0 });
const S = { phase: 'pregame', events: [], redo: [{ junk: 1 }], evSeq: 0,
            period: 1, clockMs: 600000, running: true, teams: squads(),
            /* what the picker on THIS device defaulted to: the first five */
            starters: [['h0','h1','h2','h3','h4'], ['a0','a1','a2','a3','a4']],
            tipWinner: null, arrowInit: null };
let built = 0, saved = 0, rendered = 0;

const loadRecorded = new Function('epinoiaClient', 'gameId', 'S', 'window',
  lift(src, 'async function loadRecorded()') + '\nreturn loadRecorded;')(
    () => sb, 'g1', S,
    { buildPmap: () => built++, save: () => saved++, renderAll: () => rendered++ });

const n = await loadRecorded();

ok('every page of the recorded log is pulled', n === 2400, String(n));
ok('...in order, with the payload merged back onto the event',
   S.events[0].id === 7 && S.events[0].t === 'p3_made' && S.events[0].tag === 'transition');
ok('...and team and pid restored', S.events[1].team === 1 && S.events[1].pid === 'p1');
ok('the next id continues past the highest recorded one, never reusing it',
   S.evSeq === 2406, String(S.evSeq));
ok('the clock is taken from the device that has been keeping it',
   S.period === 3 && S.clockMs === 412000);
ok('but the clock is NOT inherited running — two devices ticking is how the game clock drifts',
   S.running === false);
ok('the game is put into play, not left mid-setup', S.phase === 'game');
ok('any pending redo is cleared, because it belonged to a different history',
   S.redo.length === 0);
ok('the player map, the save and the redraw all happen',
   built === 1 && saved === 1 && rendered === 1);

/* ---- the log says who subbed; it does not say who started ---------------- */
/* derive() seeds onCourt from S.starters and the arrow from S.tipWinner /
   S.arrowInit, then replays the substitutions on top. Pulling the recorded log
   without those three replays real subs against an invented five — and the five
   on a fresh device is whatever the picker defaulted to, which is the first
   players in the squad.

   That is not a display bug. One wrong starter is on court for every possession
   until they are subbed, so every plus-minus, stint, lineup row and on/off number
   in the game is computed against a lineup that never took the floor. */
ok('the five that actually started is taken from the league copy, not this device',
   JSON.stringify(S.starters) ===
   JSON.stringify([['h2','h3','h4','h5','h6'], ['a1','a2','a3','a4','a5']]),
   JSON.stringify(S.starters));
ok('...and who won the tip', S.tipWinner === 1, String(S.tipWinner));
ok('...and which way the arrow was pointing', S.arrowInit === 0, String(S.arrowInit));

/* A reverted fixture can hold starters belonging to a squad this device is not
   holding. Putting an unknown id on court would be worse than the default five,
   so the ids are checked against the squad before they are trusted. */
{
  const S2 = { phase: 'pregame', events: [], redo: [], evSeq: 0, period: 1,
               clockMs: 600000, running: true, teams: squads(),
               starters: [['h0','h1','h2','h3','h4'], ['a0','a1','a2','a3','a4']],
               tipWinner: null, arrowInit: null };
  const strange = client({ starters: [['x1','x2','x3','x4','x5'], ['y1','y2','y3','y4','y5']],
                           tip_winner: 0, arrow_init: 1 });
  const load2 = new Function('epinoiaClient', 'gameId', 'S', 'window',
    lift(src, 'async function loadRecorded()') + '\n' + 'return loadRecorded;')(
      () => strange, 'g2', S2, { buildPmap: () => {}, save: () => {}, renderAll: () => {} });
  await load2();
  ok('starters belonging to another squad are refused, not put on court',
     JSON.stringify(S2.starters) ===
     JSON.stringify([['h0','h1','h2','h3','h4'], ['a0','a1','a2','a3','a4']]),
     JSON.stringify(S2.starters));
}

/* And a fixture that never recorded them — an older game, a reverted one — must
   leave what this device has alone rather than blanking the five. */
{
  const S3 = { phase: 'pregame', events: [], redo: [], evSeq: 0, period: 1,
               clockMs: 600000, running: true, teams: squads(),
               starters: [['h0','h1','h2','h3','h4'], ['a0','a1','a2','a3','a4']],
               tipWinner: 1, arrowInit: 0 };
  const empty = client({ starters: null, tip_winner: null, arrow_init: null });
  const load3 = new Function('epinoiaClient', 'gameId', 'S', 'window',
    lift(src, 'async function loadRecorded()') + '\n' + 'return loadRecorded;')(
      () => empty, 'g3', S3, { buildPmap: () => {}, save: () => {}, renderAll: () => {} });
  await load3();
  ok('a fixture with nothing recorded leaves the five on this device alone',
     S3.starters[0][0] === 'h0' && S3.tipWinner === 1 && S3.arrowInit === 0);
}

/* ---- the guard has to survive the connection it exists to survive --------- */
/* guardAgainstOverwrite counts the league's copy of the log before publishing, and
   stops if the server holds more than this device does. It latched its "already
   ran" flag BEFORE making the request, and three paths then returned without
   clearing it: no client, an error in the response, a thrown fetch. The three-second
   poll then returned at the first line for the rest of the session.

   So the guard was disabled by exactly the condition it is there for — hall wifi
   down at page load, which is the normal case after the crash that flaky connection
   caused. The device then scores a parallel copy of a game the league already has.

   Only an answer may retire it. */
ok('the overwrite guard latches only after the count is in hand',
   src.indexOf('count = res.count || 0;') < src.indexOf('guarded = true;'),
   'count at ' + src.indexOf('count = res.count || 0;') + ', latch at ' + src.indexOf('guarded = true;'));
ok('...so a refused read leaves it armed for the next poll',
   /if \(res\.error\) return;[\s\S]*?guarded = true;/.test(src));
ok('...and so does a thrown one',
   /catch \(_\) \{ return; \}[\s\S]*?guarded = true;/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
