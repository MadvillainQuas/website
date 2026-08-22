/* ============================================================================
   A COLUMN THE DATABASE HAS NOT GOT MUST COST THE GARNISH, NOT THE GAME.

   game_state carries the score, the clock, the period, the arrow and the last
   sequence number. The interval added two more — break_ms, break_running —
   and the migration that creates them had not been applied.

   Postgres refuses a ROW, not a field. So the whole state row was rejected on
   every tick: no score, no clock, no possession written for the length of a
   fixture, and the statistician told "the league database is refusing to save
   this game" over two fields that decorate a caption.

   These run the real writeState against a database that has not got the
   column, and check the game is still recorded.

     node supabase/tests/statewrite.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'epinoia', 'live.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}
/* The array literal, sliced at its own closing bracket rather than at a line
   that looks like the end — the declaration spans two lines. */
const coreFrom = src.indexOf('const STATE_CORE');
const coreTo = src.indexOf('];', coreFrom) + 2;
const parts = [
  src.slice(coreFrom, coreTo),
  lift(src, 'function isUnknownColumn(err)'),
  lift(src, 'async function writeState(sb, gameId, st)')
].join('\n');
const mod = new Function('console', parts + '\nreturn { writeState, isUnknownColumn, STATE_CORE };')(
  { warn() {} });

/* A database that has the essential columns and not the new ones — which is
   exactly what a platform one migration behind looks like. */
function fakeDb(known) {
  const written = [];
  return {
    written,
    from: () => ({
      upsert: async row => {
        const unknown = Object.keys(row).find(k => !known.includes(k));
        if (unknown) {
          return { error: { code: 'PGRST204',
            message: "Could not find the '" + unknown + "' column of 'game_state' in the schema cache" } };
        }
        written.push(row);
        return { error: null, data: [row] };
      }
    })
  };
}

const CORE = ['game_id', 'period', 'clock_ms', 'running', 'score_home', 'score_away',
              'possession', 'arrow', 'last_seq', 'updated_at'];
const state = {
  game_id: 'g1', period: 2, clock_ms: 0, running: false,
  break_ms: 900000, break_running: true,
  score_home: 41, score_away: 38, possession: 0, arrow: 1,
  last_seq: 123, updated_at: '2026-08-22T15:00:00Z'
};

/* ---- the database that is behind ---------------------------------------- */
console.log('\na database one migration behind still records the game');
{
  const db = fakeDb(CORE);
  const res = await mod.writeState(db, 'g1', Object.assign({}, state));
  ok('the write succeeds rather than failing the frame', !res.error);
  ok('...and the score reached the table', db.written.length === 1 &&
     db.written[0].score_home === 41 && db.written[0].score_away === 38);
  ok('...along with the clock, the period and the arrow',
     db.written[0].clock_ms === 0 && db.written[0].period === 2 &&
     db.written[0].arrow === 1 && db.written[0].last_seq === 123);
  ok('only the interval was dropped',
     !('break_ms' in db.written[0]) && !('break_running' in db.written[0]));
}

/* ---- the database that is up to date ------------------------------------ */
console.log('\nand an up-to-date one writes everything, in one go');
{
  const db = fakeDb(CORE.concat(['break_ms', 'break_running']));
  const res = await mod.writeState(db, 'g1', Object.assign({}, state));
  ok('no retry is needed', !res.error && db.written.length === 1);
  ok('the interval is written too', db.written[0].break_ms === 900000 &&
     db.written[0].break_running === true);
}

/* ---- every other refusal is still the caller's to hear about ------------- */
console.log('\na real refusal is not worked around');
{
  const db = { from: () => ({ upsert: async () => ({
    error: { code: '42501', message: 'new row violates row-level security policy' } }) }) };
  const res = await mod.writeState(db, 'g1', Object.assign({}, state));
  ok('a policy refusal is returned unchanged',
     !!res.error && res.error.code === '42501');
}
{
  let calls = 0;
  const db = { from: () => ({ upsert: async () => {
    calls++;
    return { error: { code: 'PGRST204', message: "Could not find the 'break_ms' column" } };
  } }) };
  const res = await mod.writeState(db, 'g1', Object.assign({}, state));
  ok('a retry that also fails is reported rather than looping',
     !!res.error && calls === 2, 'attempts ' + calls);
}

/* ---- the detection itself ------------------------------------------------ */
console.log('\nan unknown column is recognised however it is worded');
ok('PostgREST schema-cache wording',
   mod.isUnknownColumn({ code: 'PGRST204',
     message: "Could not find the 'break_ms' column of 'game_state' in the schema cache" }));
ok('the raw Postgres code', mod.isUnknownColumn({ code: '42703' }));
ok('the raw Postgres wording',
   mod.isUnknownColumn({ message: 'column "break_ms" does not exist' }));
ok('and a policy failure is NOT mistaken for one',
   mod.isUnknownColumn({ code: '42501',
     message: 'new row violates row-level security policy' }) === false);
ok('nor is a dead connection', mod.isUnknownColumn(null) === false);

/* The essentials must never be in the droppable half. */
console.log('\nthe columns that are never dropped');
for (const k of ['period', 'clock_ms', 'score_home', 'score_away', 'last_seq']) {
  ok('kept on the retry: ' + k, mod.STATE_CORE.includes(k));
}
ok('the interval is not in the core, because it is the garnish',
   !mod.STATE_CORE.includes('break_ms'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
