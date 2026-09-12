/* ============================================================================
   THE SIMULATOR MUST NOT BE ABLE TO REACH A REAL GAME.

   `simulate a full game` fills the log with test data, and the way it does that
   is `S.events = []`. On the practice game that is exactly right. On a fixture
   being scored for real it is a deletion: the next publish compares what has been
   sent against what is now held, diffLog finds they disagree at the very first
   id, and live.js asks the database to DELETE every row it had already written.
   The policy permits it, because the statistician is precisely who may retract on
   an unfinished game. Several hundred rows of a league fixture, gone, with the
   simulator's invention written over the top.

   It was an ordinary entry in the slide-up sheet, two along from `end game`,
   behind a single confirm.

   Two locks, because one is a button and buttons come back:

     1. the button is removed from any page that is not the practice game
     2. simulateGame itself refuses unless EP_TRAIN

   And a note on a fix that would NOT have worked: leaving evSeq alone so the
   simulator "can only append". diffLog matches from index 0, so an emptied array
   disagrees at the first id however the new ones are numbered, and every
   previously-sent row is retracted regardless.

     node supabase/tests/scorer-simulate.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const scorer = readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');
const L = (await import('file://' + path.join(ROOT, 'epinoia', 'live.js'))).default
        || globalThis.EpinoiaLive;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

console.log('\nthe simulator cannot reach a real game');

ok('simulateGame refuses unless this is the practice game',
   /if\(!EP_TRAIN\)\{\s*toast\([^)]*\);\s*return;\s*\}/.test(scorer));

ok('...and it refuses BEFORE it empties the log',
   scorer.indexOf('if(!EP_TRAIN){ toast(') < scorer.indexOf('S.events=[]; S.redo=[]; S.evSeq=0;'));

ok('the button is removed on anything that is not the practice game',
   /_sim\s*&&\s*!EP_TRAIN.*_sim\.remove\(\)/s.test(scorer));

ok('...and only wired up when it is',
   /else if\(_sim\)\{ _sim\.addEventListener/.test(scorer));

/* orderSheet lists btnSim and must survive the node being gone. */
ok('the sheet tolerates the missing button',
   /want\.forEach\(\(id, i\) => \{ const b = \$\('#' \+ id\); if\(b\)/.test(scorer));

/* ---- why "just do not reset evSeq" was not the fix ------------------------ */
console.log('\nand the reason the obvious fix was not one');

const sent = [1, 2, 3, 4, 5].map(id => L.logKey({ id }));
const emptiedThenRefilledFromScratch = [{ id: 1 }];          // evSeq reset to 0
const emptiedThenRefilledContinuing  = [{ id: 6 }];          // evSeq left alone
ok('emptying the log retracts everything when ids restart',
   L.diffLog(sent, emptiedThenRefilledFromScratch).removed.length === 4,
   JSON.stringify(L.diffLog(sent, emptiedThenRefilledFromScratch).removed));
ok('...and retracts everything when they carry on too — diffLog matches from the front',
   L.diffLog(sent, emptiedThenRefilledContinuing).removed.length === 5,
   JSON.stringify(L.diffLog(sent, emptiedThenRefilledContinuing).removed));
ok('whereas a genuine append retracts nothing',
   L.diffLog(sent, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }]).removed.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
