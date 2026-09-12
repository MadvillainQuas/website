/* ============================================================================
   A CORRECTION MUST NOT DELETE THE GAME IT WAS CORRECTING.

   When a statistician changes something in the middle of the log, diffLog
   retracts everything from that point and republishes it — reusing the same
   sequence numbers, because they are the same actions.

   The durable write pushed the upsert onto a jobs array, then the delete after
   it, and fired both together with Promise.allSettled. Two requests leaving in
   the same tick, ordered by the server. And the upsert runs with
   ignoreDuplicates, which means that if it arrives while the old rows are still
   there it is a NO-OP for every one of them; the delete then removes the rows it
   did not replace.

   So correcting the clock on an action with three hundred plays after it deleted
   three hundred rows from the league's copy and wrote none of them back. Not
   intermittently — whenever the server happened to order the two that way, which
   for two requests sent together is most of the time. Nothing said so. The
   scorer's badge stayed green, the public page was still self-correcting off the
   socket, and the only intact copy of the game was the phone.

   The local transport has always applied retractions first, and says why.

     node supabase/tests/retraction-order.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'epinoia', 'live.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* A database that records the order it was asked to do things in, and takes a
   moment over each — so a delete fired alongside an upsert would be seen to
   interleave rather than accidentally passing because it happened to be quick. */
function fakeDb(opts = {}) {
  const log = [];
  const sb = {
    channel: () => ({ send: () => {}, subscribe: () => {}, unsubscribe: () => {} }),
    from: () => ({
      upsert: async rows => { await wait(5); log.push({ op: 'upsert', seqs: rows.map(r => r.seq) });
        return { error: opts.upsertError || null }; },
      delete: () => ({
        eq: () => ({
          in: async (col, vals) => { await wait(5); log.push({ op: 'delete', seqs: vals.slice() });
            return { error: opts.deleteError || null }; }
        })
      })
    })
  };
  return { sb, log };
}

/* publisher() is the only way in, so the real makeTransport chooses the real
   supabase transport — the code under test is the shipped one. */
function pubOn(sb, onError) {
  return L.publisher({ gameId: 'g-retract', mode: 'supabase', supabase: sb, onError });
}

console.log('\nthe retraction goes first');

{
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  /* the shape a mid-log correction makes: retract 40..44, republish 40..44 */
  const evs = [40, 41, 42, 43, 44].map(seq => ({ seq, id: seq, t: 'p2_made', team: 0, pid: 'h4', period: 1, clock: 500000 }));
  await p.pushEvents(evs, [40, 41, 42, 43, 44]);
  await wait(120);

  ok('both the delete and the write happened', log.length === 2, JSON.stringify(log.map(l => l.op)));
  ok('...and the delete was first', log[0] && log[0].op === 'delete',
     JSON.stringify(log.map(l => l.op)));
  ok('...retracting exactly the rows being replaced',
     JSON.stringify(log[0].seqs) === JSON.stringify([40, 41, 42, 43, 44]));
  ok('...and the write puts every one of them back',
     JSON.stringify(log[1].seqs) === JSON.stringify([40, 41, 42, 43, 44]));
}

{
  /* A correction early in a long game retracts everything after it. This is a
     query string, so one `in` list of several hundred values is a URL long
     enough to be refused by the edge in front of PostgREST — and a refused
     retraction is the whole fault above, with a different cause. */
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  const many = Array.from({ length: 450 }, (_, i) => i + 1);
  await p.pushEvents(many.map(seq => ({ seq, id: seq, t: 'to', team: 0, period: 1, clock: 1 })), many);
  await wait(200);

  const deletes = log.filter(l => l.op === 'delete');
  ok('a long retraction is broken into several requests', deletes.length === 3,
     'got ' + deletes.length);
  ok('...none of them longer than the chunk', deletes.every(d => d.seqs.length <= 200));
  ok('...and between them they name every row once',
     JSON.stringify(deletes.flatMap(d => d.seqs)) === JSON.stringify(many));
  ok('...all of them before the write',
     log.findIndex(l => l.op === 'upsert') === deletes.length);
}

{
  /* If the retraction is refused the frame must not go on to insert rows that
     the upsert would decline to replace anyway. It is backlogged and retried. */
  const { sb, log } = fakeDb({ deleteError: { message: 'refused' } });
  let told = null;
  const p = pubOn(sb, e => { told = e; });
  await p.pushEvents([{ seq: 9, id: 9, t: 'to', team: 0, period: 1, clock: 1 }], [9]);
  await wait(120);

  ok('a refused retraction stops the frame', !log.some(l => l.op === 'upsert'),
     JSON.stringify(log.map(l => l.op)));
  ok('...and the scorer is told', told && /refused/.test(told.message || ''));
}

{
  /* The ordinary case — an append with nothing retracted — must still be one
     write and must not have grown a round trip. */
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  await p.pushEvents([{ seq: 12, id: 12, t: 'p3_made', team: 1, pid: 'a7', period: 2, clock: 300000 }], []);
  await wait(120);
  ok('an ordinary append is still a single write',
     log.length === 1 && log[0].op === 'upsert', JSON.stringify(log.map(l => l.op)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
