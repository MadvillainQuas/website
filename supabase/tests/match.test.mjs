/* ============================================================================
   TWO BROTHERS ARE NOT ONE PLAYER.

   Marcus and Malcolm Delpeche (Bristol Flyers, SLB Men) got silently merged into
   one canonical player on 2026-09-18: surname + club + "initial-only" (two full,
   genuinely different first names that merely share a letter) landed exactly on
   the 0.82 auto-match threshold, with no shirt number yet in the feed to catch
   the mismatch. This is the JS mirror of scripts/ingest/matching_test.py, kept
   in step by hand the way match.js itself is kept in step with matching.py.

     node supabase/tests/match.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../../epinoia/match.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); } };

const BRISTOL = 'Bristol Flyers';
const marcus = { id: 'marcus', first_name: 'Marcus', last_name: 'Delpeche', team: BRISTOL, aliases: [] };

let res = M.matchPlayer({ name: { first: 'Malcolm', last: 'Delpeche' }, team: BRISTOL, number: null }, [marcus]);
ok('two brothers, same surname and club, no shirt number yet: never auto-matched', res.status !== 'match', res);
ok('...the reason names exactly what was distrusted',
   (res.best && res.best.reasons || []).includes('initial-only-unconfirmed'), res);

res = M.matchPlayer({ name: { first: 'Malcolm', last: 'Delpeche' }, team: BRISTOL, number: '22' },
  [Object.assign({}, marcus, { number: '21' })]);
ok('a shirt number that disagrees is never overridden by a shared initial', res.status !== 'match', res);

res = M.matchPlayer({ name: { first: 'Alexsander', last: 'Petrov' }, team: 'Riga', number: '9' },
  [{ id: 'p1', first_name: 'Aleksandr', last_name: 'Petrov', team: 'Riga', number: '9', aliases: [] }]);
ok('a genuine variant spelling, confirmed by a shirt number, still auto-matches', res.status === 'match', res);

res = M.matchPlayer({ name: { first: 'Marcus', last: 'Delpeche' }, team: BRISTOL, number: '21' },
  [Object.assign({}, marcus, { number: '21' })]);
ok('an exact forename match is not touched by this rule at all', res.status === 'match', res);

res = M.matchPlayer({ name: { first: 'Malcolm', last: 'Delpeche' }, team: BRISTOL, number: '21' },
  [Object.assign({}, marcus, { number: '21' })]);
ok('initial-only backed by an actual matching shirt number is trusted', res.status === 'match', res);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
