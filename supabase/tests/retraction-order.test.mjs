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
    channel: () => ({
      /* supabase-js answers 'ok' | 'error' | 'timed out'; the real one is
         awaited now, so the fake has to answer like it. */
      send: async f => {
        log.push({ op: 'broadcast', full: !!(f && f.payload && f.payload.full),
                   events: ((f && f.payload && f.payload.events) || []).length });
        return opts.castAnswers ? opts.castAnswers.shift() || 'ok' : 'ok';
      },
      subscribe: () => { log.push({ op: 'subscribe' }); }, unsubscribe: () => {}
    }),
    /* the table matters: game_events takes an array of rows, game_state one object */
    from: table => ({
      upsert: async rows => {
        await wait(5);
        log.push(Array.isArray(rows)
          ? { op: 'upsert', table, seqs: rows.map(r => r.seq) }
          : { op: 'state', table, clock: rows && rows.clock_ms });
        return { error: (table === 'game_events' ? opts.upsertError : null) || null };
      },
      delete: () => ({
        eq: () => ({
          in: async (col, vals) => { await wait(5); log.push({ op: 'delete', table, seqs: vals.slice() });
            return { error: opts.deleteError || null }; }
        })
      })
    })
  };
  /* what actually reached the database, with the socket traffic set aside */
  log.db = () => log.filter(l => l.op === 'upsert' || l.op === 'delete' || l.op === 'state');
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

  const db = log.db();
  ok('both the delete and the write happened', db.length === 2, JSON.stringify(db.map(l => l.op)));
  ok('...and the delete was first', db[0] && db[0].op === 'delete',
     JSON.stringify(db.map(l => l.op)));
  ok('...retracting exactly the rows being replaced',
     JSON.stringify(db[0].seqs) === JSON.stringify([40, 41, 42, 43, 44]));
  ok('...and the write puts every one of them back',
     JSON.stringify(db[1].seqs) === JSON.stringify([40, 41, 42, 43, 44]));
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

  const db = log.db();
  const deletes = db.filter(l => l.op === 'delete');
  ok('a long retraction is broken into several requests', deletes.length === 3,
     'got ' + deletes.length);
  ok('...none of them longer than the chunk', deletes.every(d => d.seqs.length <= 200));
  ok('...and between them they name every row once',
     JSON.stringify(deletes.flatMap(d => d.seqs)) === JSON.stringify(many));
  ok('...all of them before the write',
     db.findIndex(l => l.op === 'upsert') === deletes.length);
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
     log.db().length === 1 && log.db()[0].op === 'upsert',
     JSON.stringify(log.db().map(l => l.op)));
}

/* ---------------------------------------------------------------------------
   A SNAPSHOT IS FOR THE SOCKET, NOT FOR POSTGRES.

   sync.js publishes the whole log every ten seconds, and says why: somebody
   opening the public page at the start of the third quarter needs the whole
   game, over the BROADCAST, with no credentials and no table read.

   The durable write did not know a snapshot from a delta and fired the events
   upsert for it too. Every ten seconds, for the rest of the game, the complete
   log went to the database again — at eight hundred events, eight hundred rows
   of conflict checking and eighty kilobytes off a phone on a hall's uplink, six
   times a minute, to change nothing, because ignoreDuplicates makes it a no-op
   for every row already there, which by then is all of them.
   --------------------------------------------------------------------------- */
console.log('\na snapshot is for the socket');

{
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  const evs = Array.from({ length: 40 }, (_, i) => ({
    seq: i + 1, id: i + 1, t: 'p2_made', team: 0, pid: 'h4', period: 1, clock: 600000 - i * 1000 }));
  await p.pushSnapshot(evs, { clock_ms: 400000, running: false }, null);
  await wait(150);

  const casts = log.filter(l => l.op === 'broadcast');
  ok('the whole log still reaches the socket', casts.length === 1 && casts[0].events === 40,
     JSON.stringify(casts));
  ok('...marked as a snapshot, which is what a late joiner reads', casts[0].full === true);
  ok('...and none of it is written to the database again',
     !log.some(l => l.op === 'upsert'), JSON.stringify(log.map(l => l.op)));
}

{
  /* The delta is what makes the log durable and must be untouched. */
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  await p.pushEvents([{ seq: 7, id: 7, t: 'p3_made', team: 1, pid: 'a9', period: 2, clock: 300000 }], []);
  await wait(150);
  ok('a delta is still written', log.some(l => l.op === 'upsert'),
     JSON.stringify(log.map(l => l.op)));
  ok('...and still broadcast', log.some(l => l.op === 'broadcast' && l.full === false));
}

{
  /* A snapshot still carries the state row, which is how a viewer's clock and
     score correct themselves — only the event log is spared. */
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  await p.pushSnapshot([{ seq: 1, id: 1, t: 'period_start', period: 1, clock: 600000 }],
                       { clock_ms: 123000, running: true }, null);
  await wait(150);
  ok('a snapshot still writes the durable state row, which is how a clock corrects itself',
     log.some(l => l.op === 'state' && l.clock === 123000),
     JSON.stringify(log.db()));
  ok('...and still no event rows', !log.some(l => l.op === 'upsert'));
}

/* And the repair that the wasteful write was accidentally providing is now
   deliberate, in sync.js: a COUNT once a minute, and a resend only if short. */
{
  const fs6 = require('node:fs');
  const sy = fs6.readFileSync(path.join(ROOT, 'epinoia', 'score', 'sync.js'), 'utf8');

  ok('the repair asks for a count rather than sending the log',
     /select\('seq', \{ count: 'exact', head: true \}\)/.test(sy));
  ok('...once a minute, not on every snapshot pass',
     /if \(\(\+\+snapPass % 6\) === 0\) healDurable\(S\);/.test(sy));
  ok('...and sends nothing when the server is not short',
     /if \(error \|\| count == null \|\| count >= mine\) return;/.test(sy));
  ok('...resending through the ordinary upsert, which ignores what is already there',
     /pub\.pushEvents\(\(S\.events \|\| \[\]\)\.map/.test(sy));
  ok('...never overlapping itself on a slow connection',
     /if \(healing \|\| halted/.test(sy) && /finally \{ healing = false; \}/.test(sy));
  ok('...and it is one-directional: a server holding MORE is the takeover guard\'s question',
     /belongs to guardAgainstOverwrite/.test(sy));
}

/* ---------------------------------------------------------------------------
   THE PUBLISHER'S CHANNEL WAS NEVER JOINED.

   send() did `channel || (channel = sb.channel(...))` and nothing subscribed
   it, because subscribe lived in listen() and listen is only called by a
   SUBSCRIBER — and the scorer builds a publisher and nothing else.

   supabase-js does not fail on an unjoined channel. It falls back to a fresh
   HTTPS POST to /realtime/v1/api/broadcast, one per frame, which is the slowest
   path there is: several times a second, off a phone on a sports hall's uplink,
   for the length of a game, carrying something the socket was sitting there
   ready to take. And the answer — 'ok', 'error' or 'timed out' — was discarded,
   so a broadcast that never left was indistinguishable from one that did.
   --------------------------------------------------------------------------- */
console.log('\nthe publisher joins the channel it is shouting down');

{
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  await p.pushEvents([{ seq: 1, id: 1, t: 'period_start', period: 1, clock: 600000 }], []);
  await wait(120);
  ok('the channel is subscribed, so the frame goes over the socket',
     log.some(l => l.op === 'subscribe'), JSON.stringify(log.map(l => l.op)));
  ok('...once, not on every frame', log.filter(l => l.op === 'subscribe').length === 1);
}

{
  const { sb, log } = fakeDb();
  const p = pubOn(sb);
  for (let i = 0; i < 4; i++) {
    await p.pushEvents([{ seq: i + 1, id: i + 1, t: 'to', team: 0, period: 1, clock: 1 }], []);
  }
  await wait(200);
  ok('still once after several frames', log.filter(l => l.op === 'subscribe').length === 1,
     String(log.filter(l => l.op === 'subscribe').length));
}

{
  /* A broadcast that says it failed is retried over the socket. */
  const { sb, log } = fakeDb({ castAnswers: ['error', 'ok'] });
  const p = pubOn(sb);
  const landed = await p.pushEvents([{ seq: 3, id: 3, t: 'p2_made', team: 0, pid: 'h4', period: 1, clock: 9 }], []);
  await wait(150);
  ok('a lost broadcast is sent again', log.filter(l => l.op === 'broadcast').length === 2,
     String(log.filter(l => l.op === 'broadcast').length));
  ok('...and the durable write still happened', log.db().some(l => l.op === 'upsert'));
}

{
  /* But it must NOT fail the frame. The two halves answer different questions:
     the durable write is whether the league has the game, and a failure there
     backlogs everything behind it — correctly, because a game the database does
     not have cannot be finalised. The broadcast is whether people watching right
     now saw the play, and the ten-second snapshot repairs that by itself. Tying
     the important half to the less important one would let a channel that is
     rate limited or mid-reconnect stop every durable write for the rest of the
     game. */
  const { sb, log } = fakeDb({ castAnswers: ['error', 'error'] });
  const p = pubOn(sb);
  await p.pushEvents([{ seq: 4, id: 4, t: 'to', team: 1, period: 1, clock: 8 }], []);
  await wait(150);
  ok('a broadcast that stays lost does not stop the durable write',
     log.db().some(l => l.op === 'upsert'), JSON.stringify(log.map(l => l.op)));
  ok('...and is not retried for ever', log.filter(l => l.op === 'broadcast').length === 2,
     String(log.filter(l => l.op === 'broadcast').length));
}

{
  /* An answer of neither kind is a supabase-js that does not answer at all;
     treating silence as failure would double every frame on the wire for a
     whole game to fix a problem that may not exist. */
  const { sb, log } = fakeDb({ castAnswers: [undefined, undefined] });
  const p = pubOn(sb);
  await p.pushEvents([{ seq: 5, id: 5, t: 'to', team: 0, period: 1, clock: 7 }], []);
  await wait(150);
  ok('a channel that answers nothing is taken at its word, not retried',
     log.filter(l => l.op === 'broadcast').length === 1,
     String(log.filter(l => l.op === 'broadcast').length));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
