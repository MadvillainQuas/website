/* ============================================================================
   A GAME THAT WAS SCORED MUST BE A GAME THAT WAS SAVED.

   A full game — 754 events, four quarters, a final score of 105–86 — was
   scored, and the league database ended up holding exactly ONE row of it. The
   public box score looked perfect throughout, because that arrives over the
   broadcast and the broadcast was fine. The loss surfaced only at the final
   whistle, when finalise refused to close a game the server could not
   reproduce, by which point the only copy was in one browser tab.

   Three faults, each of which alone would have been survivable:

   1. THE CLOCK WAS A FLOAT AND THE COLUMN IS AN INTEGER. The scorer's clock is
      real elapsed milliseconds, so a row carried clock 580270.8394733587.
      Postgres refuses that outright, and an upsert is one statement, so one
      such row failed the whole batch. The single surviving row was the opening
      period_start — the one event whose clock was exactly 600000.

   2. A REFUSED WRITE LOOKED LIKE A SUCCESSFUL ONE. supabase-js resolves with
      { data, error } rather than rejecting, so `every(r => r.status ===
      'fulfilled')` was true whether the rows went in or bounced. send()
      reported success, the frame was never put on the backlog to retry, and
      the buffer had already been emptied. Every event was discarded at the
      moment it failed.

   3. NOBODY WAS TOLD. Not the statistician, not the console.

   These tests hold all three, and they drive the real transport against a fake
   supabase client so the assertions are about what would actually be sent.

     node supabase/tests/durability.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Live = require(path.join(ROOT, 'epinoia', 'live.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* A supabase client that records what it was asked to write, and can be told
   to refuse the way PostgREST refuses: by RESOLVING with an error. */
function fakeSb(opts = {}) {
  const wrote = { game_events: [], game_state: [], deleted: [] };
  const sent = [];
  return {
    wrote, sent,
    channel: () => ({ send: m => sent.push(m), subscribe: () => {}, on: () => {} }),
    from(table) {
      return {
        upsert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (opts.refuse && opts.refuse(table, list)) {
            /* exactly how supabase-js reports a rejected write */
            return Promise.resolve({ data: null, error: {
              code: '22P02', message: 'invalid input syntax for type integer',
              details: null } });
          }
          wrote[table].push(...list);
          return Promise.resolve({ data: list, error: null });
        },
        delete() { return { eq() { return { in(_c, v) {
          wrote.deleted.push(...v); return Promise.resolve({ data: null, error: null }); } }; } }; }
      };
    }
  };
}

const frameOf = (events, state) => ({
  gameId: 'g1', events, removed: [], state, seq: 1, at: 1
});

/* ---- 1. the integer columns ----------------------------------------------- */
{
  const sb = fakeSb();
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  /* the exact row the simulator produced, fractional clock and all */
  pub.pushEvents([
    { id: 1, seq: 1, t: 'period_start', period: 1, clock: 600000 },
    { id: 2, seq: 2, t: 'foul', team: 1, pid: 'p1_3', period: 1,
      clock: 580270.8394733587, kind: 'personal' },
    { id: 3, seq: 3, t: 'p2_make', team: 0, pid: 'p0_1', period: 1.0,
      clock: 579911.22, x: 0.5, y: 0.1 }
  ]);
  await pub.flushNow();

  const rows = sb.wrote.game_events;
  ok('every event reaches the table', rows.length === 3, String(rows.length));
  ok('a fractional clock is written as a whole number — the column is an int',
     rows.every(r => r.clock == null || Number.isInteger(r.clock)),
     JSON.stringify(rows.map(r => r.clock)));
  ok('...rounded, not truncated', rows[1].clock === 580271, String(rows[1].clock));
  ok('seq, period and team are whole too',
     rows.every(r => [r.seq, r.period, r.team].every(v => v == null || Number.isInteger(v))),
     JSON.stringify(rows.map(r => [r.seq, r.period, r.team])));
  ok('the payload keeps its floats — only the columns are integers',
     rows[2].payload.x === 0.5 && rows[2].payload.y === 0.1,
     JSON.stringify(rows[2].payload));
  ok('nothing else about the row is changed',
     rows[1].t === 'foul' && rows[1].pid === 'p1_3' && rows[1].payload.kind === 'personal');
  pub.stop();
}

/* game_state has the same integer columns and was failing the same way */
{
  const sb = fakeSb();
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  await pub.pushState({ period: 2, clock_ms: 431288.6667, running: true,
                        score_home: 44, score_away: 41, last_seq: 312.0 });
  const st = sb.wrote.game_state[0];
  ok('the durable state rounds its clock as well',
     Number.isInteger(st.clock_ms) && st.clock_ms === 431289, JSON.stringify(st));
  ok('and keeps running, which is a boolean not a number', st.running === true);
  pub.stop();
}

/* ---- 2. a refused write must not report success ---------------------------- */
{
  const sb = fakeSb({ refuse: (table) => table === 'game_events' });
  const errs = [];
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb,
                               onError: e => errs.push(e) });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();

  ok('a refusal that RESOLVES is still a refusal', errs.length === 1,
     'onError calls: ' + errs.length);
  ok('...and the caller is given the database’s own message',
     errs[0] && /invalid input syntax/.test(errs[0].message || ''),
     errs[0] && errs[0].message);
  ok('the frame is kept for retry rather than dropped', pub.pending() > 0,
     'pending: ' + pub.pending());
  pub.stop();
}

/* and once the cause clears, the backlog goes in — the game is not lost */
{
  let refusing = true;
  const sb = fakeSb({ refuse: (table) => refusing && table === 'game_events' });
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();
  ok('nothing was written while the write was refused', sb.wrote.game_events.length === 0);

  refusing = false;
  pub.pushEvents([{ id: 2, seq: 2, t: 'p3_make', team: 1, period: 1, clock: 90 }]);
  await pub.flushNow();
  const seqs = sb.wrote.game_events.map(r => r.seq).sort((a, b) => a - b);
  ok('when it clears, the held frame goes in too — nothing is lost',
     seqs.join() === '1,2', seqs.join());
  ok('...and in order', sb.wrote.game_events[0].seq === 1);
  pub.stop();
}

/* ---- 3. the broadcast must still go out --------------------------------------
   The hot path is deliberately independent of the durable one: a database
   problem should not also blank the public box score. */
{
  const sb = fakeSb({ refuse: () => true });
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();
  ok('viewers are still served while the table refuses the write',
     sb.sent.length === 1 && sb.sent[0].event === 'frame', JSON.stringify(sb.sent));
}

/* ---- the scorer is told ----------------------------------------------------- */
{
  const src = require('node:fs').readFileSync(
    path.join(ROOT, 'epinoia', 'score', 'sync.js'), 'utf8');
  const boot = require('node:fs').readFileSync(
    path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8');
  ok('sync passes a write-failure hook to the publisher', /onError:\s*\(err\)/.test(src));
  ok('...and the scorer shows it on the bar', /not saving/.test(boot));
  ok('...and interrupts if failures keep stacking up',
     /writeWarned[\s\S]{0,400}alert\(/.test(boot));
}

/* ---- the announcement that makes a live game appear at once ----------------- */
{
  const fs = require('node:fs');
  const sync = fs.readFileSync(path.join(ROOT, 'epinoia', 'score', 'sync.js'), 'utf8');
  const strip = fs.readFileSync(path.join(ROOT, 'epinoia', 'embed', 'strip', 'strip.js'), 'utf8');
  ok('the scorer announces a status change on a fixed topic',
     /ANNOUNCE_TOPIC = 'epinoia:live'/.test(sync));
  ok('the strip listens on the same one',
     /ANNOUNCE_TOPIC = 'epinoia:live'/.test(strip));
  ok('...and never drops it when the watched games change',
     /only\(\[ANNOUNCE_TOPIC\]\.concat\(watchable\(gs\)\)/.test(strip));
  ok('an announcement causes a re-read rather than being believed',
     /onAnnounce[\s\S]{0,700}load\(\)/.test(strip));
  ok('the scorer announces the final whistle too, not just the tip',
     /finalise\(\)[\s\S]{0,220}maybeRoster\(S\)/.test(sync));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
