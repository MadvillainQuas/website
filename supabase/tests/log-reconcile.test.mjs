/* ============================================================================
   THE LEAGUE'S COPY OF A GAME MUST AGREE WITH THE PHONE BY CONTENT, NOT COUNT.

   A correction is a delete followed by an insert, and it travels in a backlog
   that lives in memory. A tab that died with one queued came back with sentIds
   empty, republished everything with ignoreDuplicates — and the server kept the
   row it already had: the basket that was undone, the scorer before the edit.
   healDurable and the finalise gate both compared COUNTS, which an edit does not
   change, so the box score published at the final whistle was the one the
   statistician had corrected an hour earlier.

   What is asserted here, against an in-memory table that behaves like the real
   one (upsert on (game_id, seq) with ignoreDuplicates, deletes by seq, counts,
   1000-row pages, jsonb handing objects back in its own key order):

     1. live.js durableRow / rowKey / logDigest: one canonical shape, the same
        for an event and for the row it became
     2. sync.js reconcile: retracts what the phone no longer has or has
        differently, re-sends the phone's version, and never touches a row this
        device did not write
     3. the watchdog: 'finalising' is a wait; final or void is a loud stop even
        before the game was seen live; a revert after live still revokes
     4. health: a failure stays a failure until a frame lands, and no signal is
        told apart from a refusal
     5. a training game or a read-only tab publishes nothing; restart() after a
        reopen publishes again

     node supabase/tests/log-reconcile.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = path.join(ROOT, 'epinoia', 'live.js');
const SYNC = path.join(ROOT, 'epinoia', 'score', 'sync.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const Live = require(LIVE);
globalThis.EpinoiaLive = Live;

/* ---- 1. the canonical row ------------------------------------------------- */
console.log('\n1. one shape for an event and for the row it became');
{
  const ev = { id: 7, t: 'p2_made', team: 1, pid: 'p1_3', period: 2, clock: 431288.6, wall: 1712345678901,
               tag: undefined, ref: null, loc: { y: 0.25, x: 0.5 } };
  const row = Live.durableRow(ev);
  ok('the columns are the table\'s, whole where the column is an int',
     row.seq === 7 && row.team === 1 && row.period === 2 && row.clock === 431289 && row.t === 'p2_made',
     JSON.stringify(row));
  ok('everything else is payload', row.payload.wall === 1712345678901 && row.payload.loc.x === 0.5 &&
     !('id' in row.payload) && !('clock' in row.payload));
  /* what the table hands back: JSON round trip, keys in another order, the
     undefined dropped, an absent pid as null */
  const back = JSON.parse(JSON.stringify(Object.assign({ game_id: 'g', id: 99, created_at: 'x' }, row)));
  back.payload = { loc: { x: 0.5, y: 0.25 }, ref: null, wall: 1712345678901 };
  ok('the row read back keys identically to the event it came from',
     Live.rowKey(back) === Live.rowKey(row), Live.rowKey(back) + '\n          ' + Live.rowKey(row));
  const noTeam = Live.durableRow({ id: 1, t: 'period_start', period: 1, clock: 600000 });
  ok('a missing team or pid is the null the column stores',
     Live.rowKey(noTeam) === Live.rowKey({ seq: 1, t: 'period_start', team: null, pid: null, period: 1, clock: 600000, payload: {} }));
  const edited = Live.durableRow(Object.assign({}, ev, { pid: 'p1_4' }));
  ok('an edit in place changes the key — the thing a count could not see',
     Live.rowKey(edited) !== Live.rowKey(row));
  const a = Live.logDigest([row, noTeam]), b = Live.logDigest([back, noTeam]);
  ok('the digest is order-free and the same for the event and its row',
     a.digest === b.digest && a.events === 2 && Live.logDigest([noTeam, row]).digest === a.digest, JSON.stringify([a, b]));
  ok('...and different for a different log', Live.logDigest([edited, noTeam]).digest !== a.digest);
  ok('it is 64 bits of hex', /^[0-9a-f]{16}$/.test(a.digest), a.digest);
}

/* ---- an in-memory league ---------------------------------------------------- */
function fakeDb() {
  const T = { game_events: [], game_state: [], games: [] };
  const hooks = { refuse: null, calls: [] };
  const jsonb = v => JSON.parse(JSON.stringify(v));
  /* jsonb hands an object back in its own key order — reversed here, to prove
     nothing depends on ours */
  const reorder = o => (o && typeof o === 'object' && !Array.isArray(o))
    ? Object.keys(o).reverse().reduce((m, k) => (m[k] = reorder(o[k]), m), {}) : o;
  class Q {
    constructor(table) { this.table = table; this.op = null; this.f = []; this.single = false; }
    select(cols, opts) {
      if (this.op) this.returning = true; else { this.op = 'select'; this.opts = opts || {}; }
      return this;
    }
    upsert(rows, opts) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.uopts = opts || {}; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push(r => r[c] === v); return this; }
    in(c, vs) { this.f.push(r => vs.includes(r[c])); return this; }
    gt(c, v) { this.f.push(r => r[c] > v); return this; }
    order(c) { this.ord = c; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.single = true; return this; }
    match() { return T[this.table].filter(r => this.f.every(f => f(r))); }
    run() {
      hooks.calls.push({ table: this.table, op: this.op });
      if (hooks.refuse) { const e = hooks.refuse(this.table, this.op); if (e) return { data: null, error: e }; }
      if (this.op === 'select') {
        let rows = this.match();
        if (this.opts.head) return { data: null, count: rows.length, error: null };
        if (this.ord) rows = rows.slice().sort((a, b) => a[this.ord] - b[this.ord]);
        if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
        rows = rows.map(r => Object.assign({}, r, { payload: reorder(jsonb(r.payload || {})) }));
        return { data: this.single ? (rows[0] || null) : rows, error: null };
      }
      if (this.op === 'upsert') {
        for (const r0 of this.rows) {
          const r = jsonb(r0);
          if (this.table === 'game_events') {
            const at = T.game_events.findIndex(x => x.game_id === r.game_id && x.seq === r.seq);
            if (at >= 0) { if (this.uopts.ignoreDuplicates) continue; throw new Error('UPDATE is forbidden'); }
            T.game_events.push(r);
          } else {
            const at = T[this.table].findIndex(x => x.game_id === r.game_id);
            if (at >= 0) T[this.table][at] = r; else T[this.table].push(r);
          }
        }
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        const gone = new Set(this.match());
        T[this.table] = T[this.table].filter(r => !gone.has(r));
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        const rows = this.match();
        rows.forEach(r => Object.assign(r, this.patch));
        return { data: this.returning ? rows.map(r => ({ id: r.id })) : null, error: null };
      }
      return { data: null, error: null };
    }
    then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
  }
  return {
    T, hooks, supabaseUrl: 'http://x',
    from: t => new Q(t),
    channel: () => ({ send: async () => 'ok', subscribe() { return this; }, on() { return this; } })
  };
}

/* A fresh sync.js each time — it is a singleton per page — with its timers
   captured rather than run, so the watchdog can be stepped by hand. */
function freshSync() {
  delete require.cache[require.resolve(SYNC)];
  const timers = [];
  const realSI = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const api = require(SYNC);
  return { api, timers, restore: () => { globalThis.setInterval = realSI; } };
}

const GID = '6f1c2a9e-1111-4222-8333-944455556666';
const ev = (id, t, more) => Object.assign({ id, t, period: 1, clock: 600000 - id * 1000 }, more || {});
const serverRow = e => Object.assign({ game_id: GID }, Live.durableRow(Object.assign({ seq: e.id }, e)));

/* ---- 2. reconcile ---------------------------------------------------------- */
console.log('\n2. reconcile brings the league\'s copy into line, by content');
{
  const db = fakeDb();
  db.T.games.push({ id: GID, status: 'live' });
  /* what the league holds: written before an outage */
  const before = [ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'a' }),
                  ev(3, 'p3_made', { team: 1, pid: 'x' }), ev(4, 'foul', { team: 1, pid: 'y', kind: 'personal' })];
  db.T.game_events.push(...before.map(serverRow));
  /* what the phone holds after the reload: #2 was credited to the wrong player
     and fixed, #3 was undone, #5 was scored — and none of it reached the league */
  globalThis.S = { phase: 'game', period: 1, clockMs: 500000, running: false, evSeq: 5,
                   teams: [{ name: 'h', players: [] }, { name: 'a', players: [] }], starters: [[], []],
                   events: [ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'b' }),
                            ev(4, 'foul', { team: 1, pid: 'y', kind: 'personal' }), ev(5, 'ft_made', { team: 0, pid: 'b' })] };
  const { api, restore } = freshSync();
  api.attach({ gameId: GID, mode: 'supabase', supabase: db });
  restore();
  await tick(400);
  const countBefore = db.T.game_events.length;
  ok('the attach top-up alone leaves the stale rows standing (the old fault)',
     db.T.game_events.find(r => r.seq === 2).pid === 'a' && db.T.game_events.some(r => r.seq === 3),
     JSON.stringify(db.T.game_events.map(r => [r.seq, r.pid])));
  ok('...and the count already says nothing is wrong', countBefore >= S.events.length, String(countBefore));
  const notArmed = await api.reconcile();
  ok('a repair waits for the takeover guard to say this device is the one scoring',
     notArmed.ok === false && notArmed.why === 'not armed', JSON.stringify(notArmed));
  await api.armReconcile();
  await api.settle(3000);
  const keys = rows => rows.map(r => Live.rowKey(r)).sort();
  ok('afterwards the league holds exactly what the phone holds',
     JSON.stringify(keys(db.T.game_events)) === JSON.stringify(keys(S.events.map(e => Live.durableRow(Object.assign({ seq: e.id }, e))))),
     JSON.stringify(db.T.game_events.map(r => [r.seq, r.t, r.pid])));
  ok('the undone basket is gone', !db.T.game_events.some(r => r.seq === 3));
  ok('the edit arrived', db.T.game_events.find(r => r.seq === 2).pid === 'b');
  const exp = api.expectation();
  ok('the digest finalise sends matches the digest of what the league now holds',
     exp.digest === Live.logDigest(db.T.game_events).digest && exp.events === 4, JSON.stringify(exp));
  ok('status says it reconciled', api.status().reconciled === true);
  api.halt('test over');
}

console.log('\n2b. a row this device never wrote is not this device\'s to delete');
{
  const db = fakeDb();
  db.T.games.push({ id: GID, status: 'live' });
  db.T.game_events.push(...[ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'a' }),
                            ev(9, 'p3_made', { team: 1, pid: 'z' })].map(serverRow));
  globalThis.S = { phase: 'game', period: 1, clockMs: 500000, evSeq: 3, teams: [{ players: [] }, { players: [] }],
                   starters: [[], []], events: [ev(1, 'period_start'), ev(3, 'to', { team: 0 })] };
  let foreign = null;
  const { api, restore } = freshSync();
  api.attach({ gameId: GID, mode: 'supabase', supabase: db, onForeign: (n, m, k) => { foreign = [n, m, k]; } });
  restore();
  await tick(300);
  const res = await api.reconcile({ force: true, wait: true });
  ok('a seq past this device\'s own ids is somebody else\'s: nothing is retracted',
     res.ok === false && res.why === 'foreign' && db.T.game_events.some(r => r.seq === 2) && db.T.game_events.some(r => r.seq === 9),
     JSON.stringify(res));
  ok('...and the page is told, with the counts (the league\'s rows, this device\'s, the foreign ones)',
     foreign && foreign[0] >= 3 && foreign[1] === 2 && foreign[2] === 1, JSON.stringify(foreign));
  api.halt('test over');
}

console.log('\n2c. the comparison on its own');
{
  const { api, restore } = freshSync(); restore();
  const plan = api._planReconcile(
    [serverRow(ev(1, 'a')), serverRow(ev(2, 'b')), serverRow(ev(3, 'c'))],
    [ev(1, 'a'), ev(2, 'b', { pid: 'q' }), ev(4, 'd')], 4);
  ok('retract: absent here, or here differently', JSON.stringify(plan.removed.sort()) === '[2,3]', JSON.stringify(plan.removed));
  ok('send: absent there, or there differently', JSON.stringify(plan.added.map(e => e.seq).sort()) === '[2,4]', JSON.stringify(plan.added));
  ok('an identical log needs nothing',
     (p => !p.removed.length && !p.added.length)(api._planReconcile([serverRow(ev(1, 'a'))], [ev(1, 'a')], 1)));
}

/* ---- 3. the watchdog -------------------------------------------------------- */
console.log('\n3. the watchdog');
async function watchdog(statuses, opts = {}) {
  const db = fakeDb();
  db.T.games.push({ id: GID, status: statuses[0] });
  globalThis.S = { phase: 'game', period: 1, clockMs: 500000, evSeq: 0, teams: [{ players: [] }, { players: [] }],
                   starters: [[], []], events: [] };
  const seen = { closed: null, revoked: 0 };
  const { api, timers, restore } = freshSync();
  api.attach({ gameId: GID, mode: 'supabase', supabase: db,
               onClosed: s => { seen.closed = s; }, onRevoked: () => { seen.revoked++; } });
  restore();
  const wd = timers.find(t => t.ms === 8000);
  for (const st of statuses) { db.T.games[0].status = st; wd.fn(); await tick(5); }
  return { api, seen };
}
{
  const { api, seen } = await watchdog(['live', 'finalising', 'finalising']);
  ok('finalising is a wait: still publishing, nobody told anything',
     !api.halted && seen.closed === null && seen.revoked === 0);
  api.halt('test over');
}
{
  const { api, seen } = await watchdog(['live', 'finalising', 'final']);
  ok('...and the final that follows stops it and says so', api.halted && seen.closed === 'final' && seen.revoked === 0,
     JSON.stringify([api.status().haltReason, seen]));
}
{
  const { api, seen } = await watchdog(['void']);
  ok('a void game stops it even before it was ever seen live',
     api.halted && seen.closed === 'void' && /void/.test(api.status().haltReason), JSON.stringify(seen));
}
{
  const { api, seen } = await watchdog(['scheduled', 'scheduled']);
  ok('a fixture not yet tipped is left alone', !api.halted && seen.revoked === 0);
  api.halt('test over');
}
{
  const { api, seen } = await watchdog(['live', 'scheduled']);
  ok('a revert after it was live still revokes', api.halted && seen.revoked === 1);
}

/* ---- 4. health -------------------------------------------------------------- */
console.log('\n4. a failure is kept until a frame lands, and says which kind');
{
  const { api, restore } = freshSync(); restore();
  const isNet = api._isNetworkError;
  ok('a fetch that never got an answer is a network error',
     isNet({ message: 'TypeError: Failed to fetch', code: '' }) && isNet({ name: 'AbortError', message: 'aborted' }) &&
     isNet({ message: 'Load failed' }));
  ok('a database refusal is not', !isNet({ code: '42501', message: 'new row violates row-level security policy' }) &&
     !isNet({ code: '22P02', message: 'invalid input syntax for type integer' }));
}
{
  const db = fakeDb();
  db.T.games.push({ id: GID, status: 'live' });
  globalThis.S = { phase: 'game', period: 1, clockMs: 500000, evSeq: 1, teams: [{ players: [] }, { players: [] }],
                   starters: [[], []], events: [ev(1, 'period_start')] };
  let mode = 'net';
  db.hooks.refuse = (table, op) => (table === 'game_events' && op === 'upsert')
    ? (mode === 'net' ? { message: 'TypeError: Failed to fetch', code: '' }
       : mode === 'policy' ? { code: '42501', message: 'new row violates row-level security policy' } : null)
    : null;
  const kinds = [];
  const { api, restore } = freshSync();
  api.attach({ gameId: GID, mode: 'supabase', supabase: db, onWriteFail: (e, n, kind) => kinds.push(kind) });
  restore();
  await tick(400);
  let st = api.status();
  ok('no signal: failing, and called a network failure', st.failing && st.failKind === 'network' && kinds[0] === 'network',
     JSON.stringify(st));
  mode = 'policy';
  S.events.push(ev(2, 'to', { team: 0 }));
  api.flush(); await tick(400);
  st = api.status();
  ok('a refusal: failing, and called one, with its code', st.failing && st.failKind === 'refused' && st.failCode === '42501',
     JSON.stringify(st));
  mode = 'ok';
  await api.settle(3000);
  st = api.status();
  ok('a frame that lands clears it, and the count starts again', !st.failing && st.writeFails === 0 && st.pending === 0,
     JSON.stringify(st));
  api.halt('test over');
}

/* ---- 5. quiet, and publishing again ------------------------------------------ */
console.log('\n5. nothing goes out from a training game or a read-only tab; a reopen publishes again');
{
  const db = fakeDb();
  db.T.games.push({ id: GID, status: 'live' });
  globalThis.S = { phase: 'game', training: true, period: 1, clockMs: 500000, evSeq: 2,
                   teams: [{ players: [] }, { players: [] }], starters: [[], []],
                   events: [ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'a' })] };
  const { api, timers, restore } = freshSync();
  api.attach({ gameId: GID, mode: 'supabase', supabase: db });
  restore();
  await tick(300);
  timers.filter(t => t.ms === 2000 || t.ms === 10000).forEach(t => t.fn());
  await tick(300);
  ok('a training game writes nothing at all — no event, no state, no score',
     db.T.game_events.length === 0 && db.T.game_state.length === 0 && api.status().quiet === true,
     JSON.stringify(db.hooks.calls));
  S.training = false;
  globalThis.epReadOnly = true;
  timers.filter(t => t.ms === 2000).forEach(t => t.fn());
  await tick(300);
  ok('a read-only tab writes nothing either', db.T.game_events.length === 0);
  globalThis.epReadOnly = false;
  timers.filter(t => t.ms === 2000).forEach(t => t.fn());
  await tick(400);
  ok('once it is a real game in the tab that holds it, it publishes', db.T.game_events.length === 2,
     String(db.T.game_events.length));

  api.halt('the league has this game as final');
  ok('halted, with the reason kept for the bar', api.halted && api.status().haltReason === 'the league has this game as final');
  S.events.push(ev(3, 'to', { team: 1 }));
  const { restore: r2 } = (() => { const real = globalThis.setInterval; globalThis.setInterval = () => 0; return { restore: () => { globalThis.setInterval = real; } }; })();
  const again = api.restart();
  r2();
  await api.settle(3000);
  ok('restart() after a reopen publishes again — and what was scored meanwhile arrives',
     again === true && !api.halted && db.T.game_events.some(r => r.seq === 3), JSON.stringify(db.T.game_events.map(r => r.seq)));
  api.halt('test over');
}

/* ---- 7. finalise-game computes the same digest ----------------------------------- */
console.log('\n7. finalise-game\'s copy of the digest is the same function');
{
  const ts = readFileSync(path.join(ROOT, 'supabase', 'functions', 'finalise-game', 'index.ts'), 'utf8');
  const from = ts.indexOf('const wholeN = ');
  const to = ts.indexOf('\n}\n', ts.indexOf('function logDigestOf(')) + 3;
  /* only `: any` annotations are allowed in it, so stripping them leaves plain JavaScript */
  const js = ts.slice(from, to).replace(/: any(\[\])?/g, '');
  const fn = new Function(js + '\nreturn { logDigestOf, rowKeyOf };')();
  const rows = [
    { game_id: 'g', id: 41, seq: 3, t: 'p2_made', team: 0, pid: 'b', period: 1, clock: 581000,
      payload: { wall: 1712345678901, loc: { y: 0.25, x: 0.5 }, tags: ['paint', null] }, created_at: 'x' },
    { game_id: 'g', id: 40, seq: 1, t: 'period_start', team: null, pid: null, period: 1, clock: 600000, payload: {} },
    { game_id: 'g', id: 42, seq: 7, t: 'foul', team: 1, pid: 'y', period: 2, clock: 431288, payload: { kind: 'personal', ref: null } }
  ];
  const live = Live.logDigest(rows), edge = fn.logDigestOf(rows);
  ok('the same rows, the same digest, in the browser and in the edge function',
     live.digest === edge.digest && live.events === edge.events, JSON.stringify([live, edge]));
  ok('...row by row too', rows.every(r => Live.rowKey(r) === fn.rowKeyOf(r)));
  /* and from the scorer's own events, the way the page sends it */
  const evs = [ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'a', loc: { x: 0.1, y: 0.2 } }),
               ev(3, 'ft_made', { team: 1, pid: 'z', clock: 431288.7 })];
  const fromPage = Live.logDigest(evs.map(e => Live.durableRow(Object.assign({ seq: e.id }, e))));
  const asStored = evs.map(e => JSON.parse(JSON.stringify(Object.assign({ game_id: 'g' }, Live.durableRow(Object.assign({ seq: e.id }, e))))));
  ok('what the page sends matches what finalise-game reads back from the table',
     fromPage.digest === fn.logDigestOf(asStored).digest, JSON.stringify([fromPage, fn.logDigestOf(asStored)]));
  ok('finalise-game refuses a different log before it locks anything, and says so in words',
     ts.indexOf("code: 'log_mismatch'") > 0 && ts.indexOf("code: 'log_mismatch'") < ts.indexOf("update({ status: 'finalising'") &&
     /expect && typeof expect === 'object' && typeof expect\.digest === 'string'/.test(ts) &&
     /const \{ gameId, reopen, competitionId, awards, expect \} = await req\.json\(\)/.test(ts));
}

/* ---- 8. the ?train=1 demo: this browser's other tabs, and nothing else ----------- */
console.log('\n8. a training game in a scratch room reaches this browser\'s other tabs, and nothing else');
{
  /* the local transport's store, which a watch tab in the same browser reads */
  const store = {};
  const realLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  const game = (training) => ({ phase: 'game', training, period: 1, clockMs: 500000, evSeq: 2,
    teams: [{ name: 'h', players: [] }, { name: 'a', players: [] }], starters: [[], []],
    events: [ev(1, 'period_start'), ev(2, 'p2_made', { team: 0, pid: 'a' })] });
  const run = async (gameId, mode, training) => {
    const db = fakeDb(), topics = [];
    db.channel = topic => ({ send: async () => { topics.push(topic); return 'ok'; }, subscribe() { return this; }, on() { return this; } });
    globalThis.S = game(training);
    const { api, timers, restore } = freshSync();
    api.attach({ gameId, mode, supabase: db });
    restore();
    await tick(400);
    timers.filter(t => t.ms === 2000 || t.ms === 10000).forEach(t => t.fn());
    await tick(400);
    const st = api.status();
    api.halt('test over');
    return { st, db, topics };
  };

  const ROOM = 'scratch-demo1234';
  let r = await run(ROOM, 'local', true);
  const mirror = JSON.parse(store['eplive:' + ROOM] || 'null');
  ok('the demo publishes, on the local transport', r.st.quiet === false && r.st.transport === 'local', JSON.stringify(r.st));
  ok('...so its watch tab has the game', !!mirror && mirror.events.length === 2, JSON.stringify(mirror));
  ok('...and the league hears nothing: no table touched, nothing announced', r.db.hooks.calls.length === 0 && r.topics.length === 0,
     JSON.stringify([r.db.hooks.calls, r.topics]));

  r = await run(GID, 'local', true);
  ok('a training game on a fixture\'s address stays quiet, on any transport', r.st.quiet === true && r.db.hooks.calls.length === 0,
     JSON.stringify([r.st, r.db.hooks.calls]));
  r = await run('scratch-elsewhere', 'supabase', true);
  ok('...and in a scratch room on the league\'s transport', r.st.quiet === true && r.topics.length === 0, JSON.stringify(r.st));

  r = await run('scratch-real0001', 'local', false);
  ok('a scratch room is never announced to the platform (no row to re-read, no slugs to scope it)', r.topics.length === 0, JSON.stringify(r.topics));
  r = await run(GID, 'supabase', false);
  ok('a fixture on the league\'s transport still is', r.topics.includes('epinoia:live'), JSON.stringify(r.topics));

  if (realLS) Object.defineProperty(globalThis, 'localStorage', realLS); else delete globalThis.localStorage;
}

/* ---- the source agrees with itself ---------------------------------------------- */
console.log('\n6. wiring');
{
  const live = readFileSync(LIVE, 'utf8'), sync = readFileSync(SYNC, 'utf8');
  ok('send() writes with durableRow, the same mapping everything compares with',
     /Object\.assign\(\{ game_id: gameId \}, durableRow\(e\)\)/.test(live));
  ok('the heartbeat asks paused() before it sends', /if \(typeof opts\.paused === 'function' && opts\.paused\(\)\) return;/.test(live));
  ok('a delivered frame is reported', /return delivered\(true\);/.test(live) && /onDelivered/.test(sync));
  ok('every sender in sync.js goes through quiet()',
     (sync.match(/quiet\(\)/g) || []).length >= 8, String((sync.match(/quiet\(\)/g) || []).length));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
