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

const sb = {
  from: table => ({
    select: () => ({
      eq: () => ({
        order: () => ({ range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }) }),
        maybeSingle: async () => ({ data: { period: 3, clock_ms: 412000, running: true } })
      })
    })
  })
};
const S = { phase: 'pregame', events: [], redo: [{ junk: 1 }], evSeq: 0,
            period: 1, clockMs: 600000, running: true, teams: [] };
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
