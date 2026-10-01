/* ============================================================================
   A GAME NIGHT, FROM THE SCORER'S SIDE: SAVING, RESUMING, PUBLISHING, FINISHING.

   score/bootstrap.js is where the scorer meets the league, and most of what went
   wrong on a real night went wrong here. Each block below runs the code itself —
   lifted out of the file and given a fake league — rather than reading it:

     1. a takeover keeps the phone's copy first, and puts the league's log in
        GAME order, so a play added late is not replayed after the buzzer
     2. the gate's three answers: signed out is no, an expired token on dead
        wifi is "could not ask" (it used to be no, and locked the scorer out
        mid-game), a real answer is the answer
     3. resume routes a saved game to its own fixture rather than to a scratch
        room that would orphan it
     4. the bar says what is true: halted is red and says why, no signal is
        not a refusal, a failure stays until a frame lands
     5. who won the tip reaches the games row — the claim always went out before
        the answer did
     6. finalise: one at a time, a lost answer read back from the status, the
        digest sent, the result kept on the game; and reopen publishes again
     7. the wiring that cannot be run here: training, the tab lock, the bar

     node supabase/tests/scorer-reliability.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}
const between = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i + 1);
  if (i < 0 || j < 0) throw new Error('markers: ' + a + ' / ' + b);
  return src.slice(i, j);
};
const memStore = () => {
  const m = new Map();
  const ls = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
  return new Proxy(ls, { ownKeys: () => [...m.keys()],
    getOwnPropertyDescriptor: (t, k) => (m.has(k) ? { enumerable: true, configurable: true, value: m.get(k) }
                                                   : Object.getOwnPropertyDescriptor(t, k)) });
};

/* ---- 1. takeover -------------------------------------------------------------- */
console.log('\n1. a takeover keeps the phone\'s copy, and reads the league\'s in game order');
{
  /* seq order is not game order: #6 is a substitution added afterwards at Q1 5:00 */
  const rows = [
    { seq: 1, t: 'period_start', period: 1, clock: 600000, payload: {} },
    { seq: 2, t: 'p2_made', team: 0, pid: 'h0', period: 1, clock: 580000, payload: {} },
    { seq: 3, t: 'period_start', period: 2, clock: 600000, payload: {} },
    { seq: 4, t: 'foul', team: 1, pid: 'a1', period: 2, clock: 590000, payload: {} },
    { seq: 5, t: 'ft_made', team: 0, pid: 'h0', period: 2, clock: 590000, payload: {} },
    { seq: 6, t: 'sub', team: 0, pid: null, period: 1, clock: 300000, payload: { out: 'h1', in: 'h5' } }
  ];
  const sb = { from: () => ({ select: () => ({ eq: () => ({
    order: () => ({ range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }) }),
    maybeSingle: async () => ({ data: null }) }) }) }) };
  const ls = memStore();
  ls.setItem('epinoia_v1', JSON.stringify({ phase: 'game', events: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 9 }] }));
  ls.setItem('epinoia_v1:backup:2026-01-01T00:00:00.000Z', '{"old":true}');
  const S = { phase: 'pregame', events: [], redo: [], evSeq: 0, teams: [{ players: [] }, { players: [] }],
              starters: [[], []] };
  const load = new Function('epinoiaClient', 'gameId', 'S', 'window',
    lift(src, 'async function loadRecorded()') + '\nreturn loadRecorded;')(
      () => sb, 'g1', S, { localStorage: ls, EP_KEY: 'epinoia_v1', buildPmap() {}, save() {}, renderAll() {} });
  await load();
  ok('the late substitution is replayed where it happened, not after the last play',
     S.events.map(e => e.id).join(',') === '1,2,6,3,4,5', S.events.map(e => e.id).join(','));
  ok('...and a free throw at the same clock as its foul keeps its place behind it',
     S.events.findIndex(e => e.id === 4) < S.events.findIndex(e => e.id === 5));
  ok('the next id is still past the highest one recorded', S.evSeq === 6, String(S.evSeq));
  const backups = Object.keys(ls).filter(k => k.indexOf('epinoia_v1:backup:') === 0);
  ok('the phone\'s own game was kept before it was replaced — the newest backup only',
     backups.length === 1 && JSON.parse(ls.getItem(backups[0])).events.length === 4 &&
     backups[0] !== 'epinoia_v1:backup:2026-01-01T00:00:00.000Z', JSON.stringify(backups));
}

{
  /* halves: a second-half play at 15:00 comes after a first-half play at 2:00 */
  const rows = [
    { seq: 1, t: 'period_start', period: 1, clock: 1200000, payload: {} },
    { seq: 2, t: 'p2_made', team: 0, pid: 'h0', period: 2, clock: 900000, payload: {} },
    { seq: 3, t: 'p2_made', team: 1, pid: 'a0', period: 1, clock: 120000, payload: {} }
  ];
  const sb = { from: () => ({ select: () => ({ eq: () => ({
    order: () => ({ range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }) }),
    maybeSingle: async () => ({ data: null }) }) }) }) };
  const S = { phase: 'pregame', events: [], redo: [], evSeq: 0, teams: [{ players: [] }, { players: [] }], starters: [[], []] };
  await new Function('epinoiaClient', 'gameId', 'S', 'window',
    lift(src, 'async function loadRecorded()') + '\nreturn loadRecorded;')(
      () => sb, 'g1', S, { buildPmap() {}, save() {}, renderAll() {} })();
  ok('a game in halves is ordered in halves, not in ten-minute quarters',
     S.events.map(e => e.id).join(',') === '1,3,2', S.events.map(e => e.id).join(','));
}

/* ---- 2. the gate --------------------------------------------------------------- */
console.log('\n2. "could not ask" is not "no"');
{
  const body = lift(src, 'function heldSession(sb)') + '\n' +
    src.slice(src.indexOf('  const retryable = e =>'), src.indexOf('  async function mayScoreThis(sb)')) +
    lift(src, 'async function mayScoreThis(sb)') + '\nreturn mayScoreThis;';
  const ask = (session, err, stored, rpc) => {
    const ls = memStore();
    if (stored) ls.setItem('sb-x-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 }));
    const sb = { auth: { storageKey: 'sb-x-auth-token',
                         getSession: async () => ({ data: { session }, error: err || null }) },
                 rpc: async () => rpc };
    return new Function('gameId', 'window', body)('g1', { localStorage: ls })(sb);
  };
  ok('nothing stored at all: signed out, a real no', await ask(null, null, false) === false);
  ok('a stored session whose token could not be refreshed offline: could not ask',
     await ask(null, { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }, true) === null);
  ok('...even when the library reports no error with it', await ask(null, null, true) === null);
  ok('a retryable refresh error with the store already cleared: still could not ask',
     await ask(null, { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }, false) === null);
  ok('a session, and may_score_game says yes', await ask({ access_token: 'a' }, null, true, { data: true, error: null }) === true);
  ok('a session, and may_score_game says no: that is the refusal',
     await ask({ access_token: 'a' }, null, true, { data: false, error: null }) === false);
  ok('a session, and the question fails: could not ask',
     await ask({ access_token: 'a' }, null, true, { data: null, error: { message: 'Failed to fetch' } }) === null);
}

/* ---- 3. resume ---------------------------------------------------------------- */
console.log('\n3. a saved game goes back to its own fixture');
{
  const body = src.slice(src.indexOf('  const afterResume = [], afterDiscard = [];'),
                         src.indexOf('  /* ------------------------------------------- resume, where it can be seen ---')) +
    '\nreturn { resumeSaved, afterResume };';
  const FX = '6f1c2a9e-1111-4222-8333-944455556666', OTHER = '7f1c2a9e-1111-4222-8333-944455556666';
  const run = (isFixture, gameId, saved, answer) => {
    const seen = { applied: 0, alerted: null, asked: null, href: null };
    const win = { applySaved: () => { seen.applied++; } };
    const loc = { set href(v) { seen.href = v; } };
    const m = new Function('isFixture', 'gameId', 'isUuid', 'window', 'alert', 'confirm', 'location', body)(
      isFixture, gameId, v => /^[0-9a-f-]{36}$/i.test(String(v || '')), win,
      t => { seen.alerted = t; }, t => { seen.asked = t; return answer; }, loc);
    seen.result = m.resumeSaved(saved);
    return seen;
  };
  let r = run(true, FX, { fixtureId: FX, phase: 'game', events: [{}] });
  ok('its own fixture: resumed', r.result === true && r.applied === 1);
  r = run(true, FX, { fixtureId: OTHER, phase: 'game' }, true);
  ok('another fixture\'s game: offered ITS address, not a scratch room',
     r.result === false && r.applied === 0 && /different fixture/.test(r.asked) &&
     r.href === '?g=' + OTHER + '&mode=supabase', JSON.stringify(r));
  r = run(true, FX, { phase: 'game' });
  ok('a game that does not say which fixture: refused, as before', r.result === false && /not say which fixture/.test(r.alerted));
  r = run(false, 'scratch-1', { fixtureId: FX, phase: 'game' }, true);
  ok('a league game opened on a scratch page is offered its fixture first',
     r.result === false && r.href === '?g=' + FX + '&mode=supabase');
  r = run(false, 'scratch-1', { fixtureId: FX, phase: 'game' }, false);
  ok('...and can still be resumed there on purpose', r.result === true && r.applied === 1);
  ok('attaching stamps only a fixture, and never over another fixture\'s id',
     /if \(isFixture && !isUuid\(S\.fixtureId\)\) \{\s*\n\s*if \(S\.fixtureId !== gameId\) \{ S\.fixtureId = gameId;/.test(src));
}

/* ---- 4. health ---------------------------------------------------------------- */
console.log('\n4. the bar says what is true');
{
  const body = lift(src, 'function paintHealth()') + '\nreturn paintHealth;';
  const paint = (st, opts = {}) => {
    const said = [];
    const bar = { style: {} };
    const f = new Function('window', 'say', 'bar', 'training', 'authOk', 'mode', 'shortId', body)(
      { EpinoiaSync: { status: () => st } }, (t, c) => said.push([t, c]), bar,
      () => !!opts.training, opts.authOk === undefined ? true : opts.authOk, 'supabase', 'abc12345');
    f();
    return said[said.length - 1] || [];
  };
  let s = paint({ halted: true, haltReason: 'another device is scoring', pending: 0 });
  ok('halted: red, and says why', s[1] === '#ff5f6b' && /not publishing · another device is scoring/.test(s[0]), JSON.stringify(s));
  s = paint({ halted: false, failing: true, failKind: 'network', pending: 3 });
  ok('no signal: amber, "offline — will retry"', s[1] === '#ffd166' && /offline — will retry · 3 held/.test(s[0]), JSON.stringify(s));
  s = paint({ halted: false, failing: true, failKind: 'refused', failCode: '42501', pending: 1 });
  ok('a refusal: red, with its code', s[1] === '#ff5f6b' && /not saving · 42501/.test(s[0]), JSON.stringify(s));
  s = paint({ halted: false, failing: false, pending: 0 }, { training: true });
  ok('a training game says it is not published', /training · not published/.test(s[0]));
  s = paint({ halted: false, failing: false, pending: 0 });
  ok('only then green', s[1] === '#93f2bf' && /^live · abc12345$/.test(s[0]), JSON.stringify(s));
  ok('the slow beat repaints from that, instead of guessing from the backlog',
     /setInterval\(paintHealth, 3000\);/.test(src));
  ok('a network failure never raises the "refusing to save" alert',
     /if \(kind === 'network'\) return;\s*\n\s*if \(count < 5 \|\| writeWarned\) return;/.test(src));
}

/* ---- 5. the tip ---------------------------------------------------------------- */
console.log('\n5. who won the tip reaches the games row');
{
  const body = 'let claimed = true, tipSent = null, tipPushing = false;\n' + lift(src, 'async function pushTip()') +
    '\nreturn { pushTip, get tipSent() { return tipSent; } };';
  const writes = [];
  let refuse = true;
  const sb = { from: () => ({ update: patch => ({ eq: async () => { writes.push(patch); return refuse ? { error: { message: 'Failed to fetch' } } : { error: null }; } }) }) };
  const S = { tipWinner: 1, arrowInit: 0 };
  const m = new Function('isFixture', 'S', 'training', 'readOnly', 'otherFixture', 'window', 'epinoiaClient', 'gameId', body)(
    true, S, () => false, false, () => false, { EpinoiaSync: { halted: false }, epinoiaClient: () => sb }, () => sb, 'g1');
  await m.pushTip();
  ok('written once the tip is decided', writes.length === 1 && writes[0].tip_winner === 1 && writes[0].arrow_init === 0);
  await m.pushTip();
  ok('a refused write is tried again', writes.length === 2 && m.tipSent === null);
  refuse = false;
  await m.pushTip(); await m.pushTip();
  ok('...until one lands, and then left alone', writes.length === 3 && m.tipSent === '1/0', String(writes.length));
  S.tipWinner = 0; S.arrowInit = 1;
  await m.pushTip();
  ok('a corrected tip is written again', writes.length === 4 && writes[3].tip_winner === 0);
  ok('it runs on the same beat as the pre-tip priming', /primeFixture\(\); \} catch[\s\S]{0,80}pushTip\(\);/.test(src));
}

/* ---- 6. finalise and reopen ------------------------------------------------------ */
console.log('\n6. finalise: one at a time, a lost answer read back, the digest sent; reopen');
{
  const body = between('  let finaliseBusy = false, finalisedHere = false, finaliseNote = null;',
                       '  /* renderFinal() rebuilds #finalview wholesale') +
    '\nreturn { finaliseGame, markFinal, get busy() { return finaliseBusy; }, get note() { return finaliseNote; } };';
  const world = (opts) => {
    const st = { status: opts.status0 || 'live', saved: 0, rendered: 0, calls: [], restarted: 0, reconciled: [] };
    const S = { events: [{ id: 1 }, { id: 2 }] };
    const sb = {
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      from: t => ({
        select: (c, o) => ({ eq: () => (o && o.head ? Promise.resolve({ count: 2, error: null })
                                                     : { maybeSingle: async () => ({ data: { status: st.status }, error: null }) }) })
      })
    };
    const Sy = { settle: async () => true, reconcile: async (o) => { st.reconciled.push(o || {}); return { ok: true }; },
                 expectation: () => ({ events: 2, digest: 'abcdef0123456789', score: [2, 0] }),
                 finalise() {}, flush() {}, restart() { st.restarted++; }, status: () => ({ attached: true }) };
    const fv = { classList: { contains: () => false } };
    const doc = { getElementById: id => (id === 'finalview' ? fv : null) };
    const win = { EPINOIA_CONFIG: { supabaseUrl: 'http://x' }, EpinoiaSync: Sy, save: () => { st.saved++; },
                  renderFinal: () => { st.rendered++; }, epinoiaClient: () => sb };
    const fetchFn = async (u, init) => {
      st.calls.push(JSON.parse(init.body));
      return opts.fetch(st, JSON.parse(init.body));
    };
    const quickTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5));
    const m = new Function('window', 'document', 'S', 'gameId', 'training', 'readOnly', 'epinoiaClient', 'fetch',
                           'AbortController', 'setTimeout', 'clearTimeout', 'paintHealth', 'isFixture', body)(
      win, doc, S, 'g1', () => false, false, () => sb, fetchFn, AbortController, quickTimeout, clearTimeout,
      () => {}, true);
    return { m, st, S, win };
  };
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });

  let w = world({ fetch: (st) => { st.status = 'final'; return resp(200, { ok: true }); } });
  await w.m.finaliseGame();
  ok('a clean finalise: the result is kept on the game and saved',
     !!w.S.finalisedAt && w.st.saved === 1 && /final — the box score is public/.test(w.m.note.text), JSON.stringify(w.m.note));
  ok('...after a repair by content, and with the digest for the league to check',
     w.st.reconciled.some(o => o.force && o.wait) &&
     w.st.calls[0].expect && w.st.calls[0].expect.digest === 'abcdef0123456789' && w.st.calls[0].gameId === 'g1',
     JSON.stringify(w.st.calls));

  w = world({ fetch: (st) => { st.status = 'final'; throw new TypeError('Failed to fetch'); } });
  await w.m.finaliseGame();
  ok('the answer lost on the way back, the game final: told it is final, not "network error"',
     !!w.S.finalisedAt && !/network error/.test(w.m.note.text), JSON.stringify(w.m.note));

  w = world({ status0: 'final', fetch: () => resp(409, { error: 'already final' }) });
  await w.m.finaliseGame();
  ok('"already final" is success, read from the status', !!w.S.finalisedAt, JSON.stringify(w.m.note));

  w = world({ fetch: () => resp(422, { error: 'sanity gate failed', blocking: ['scores are level — play overtime'] }) });
  await w.m.finaliseGame();
  ok('a refusal says what it objected to, and the game is not marked final',
     !w.S.finalisedAt && /refused: scores are level/.test(w.m.note.text), JSON.stringify(w.m.note));

  w = world({ fetch: () => resp(409, { error: 'the league copy differs', code: 'log_mismatch', blocking: ['differs'] }) });
  await w.m.finaliseGame();
  ok('a log mismatch sets a repair going, so that trying again works',
     !w.S.finalisedAt && w.st.reconciled.length >= 2, JSON.stringify(w.st.reconciled));

  let release;
  w = world({ fetch: (st) => new Promise(r => { release = () => { st.status = 'final'; r(resp(200, { ok: true })); }; }) });
  const first = w.m.finaliseGame();
  await new Promise(r => setTimeout(r, 30));
  await w.m.finaliseGame();
  ok('a second press while the first is out does not send a second request',
     w.st.calls.length === 1 && /already finalising/.test(w.m.note.text), JSON.stringify([w.st.calls.length, w.m.note]));
  release(); await first;
  ok('...and the first one\'s answer is the one kept', !!w.S.finalisedAt && !w.m.busy);

  const reopenBody = between('  /* --------------------------------------------------------------- reopen ---',
                             '  /* renderFinal() rebuilds #finalview wholesale');
  ok('reopen asks finalise-game to reopen, clears the mark, restarts publishing and repairs by content',
     /reopen: 1/.test(reopenBody) && /delete S\.finalisedAt/.test(reopenBody) &&
     /Sy\.restart\(\);/.test(reopenBody) && /reconcile\(\{ force: true, wait: true \}\)/.test(reopenBody) &&
     /window\.epReopenFixture = async function \(\)/.test(src));
  ok('the finalise button is drawn from the game\'s state, not from scratch',
     /else if \(S && S\.finalisedAt\) \{\s*\n\s*btn\.textContent = 'finalised ✓';/.test(src) &&
     /btn\.disabled = finaliseBusy \|\| readOnly;/.test(src));
  ok('the watchdog\'s final marks it too, and is loud when this device did not finalise',
     /if \(status === 'final'\) markFinal\(/.test(src) && /banner\('ep-closed'/.test(src));
}

/* ---- 7. wiring ------------------------------------------------------------------- */
console.log('\n7. the parts that need a browser, checked at the source');
{
  ok('no training mode on a fixture\'s page', /if \(isFixture\) \{[\s\S]{0,200}getElementById\('trainB'\)[\s\S]{0,80}display = 'none'/.test(src));
  for (const fn of ['claimFixture', 'primeFixture', 'pushTip']) {
    ok(fn + ' never runs for a training game, a read-only tab or another fixture\'s game',
       /if \(training\(\) \|\| readOnly \|\| otherFixture\(\)\) return;/.test(lift(src, 'async function ' + fn + '()')));
  }
  ok('nothing attaches for a training game', /if \(training\(\)\) \{[^\n]*say\('training · not published'/.test(src));
  ok('one tab per game: a Web Lock, taken if free, and read-only otherwise',
     /navigator\.locks\.request\(name, \{ ifAvailable: true \}/.test(src) && /window\.epReadOnly = true;/.test(src) &&
     /'epinoia-scorer:' \+ gameId/.test(src));
  ok('...with a localStorage heartbeat where there are no locks', /'epinoia\.tab:' \+ gameId/.test(src));
  ok('the resume card appears on the setup screen and the picker, and survives the picker redrawing',
     /\['startersview', 'setup'\]/.test(src) && /new MutationObserver\(place\)\.observe\(sv, \{ childList: true \}\)/.test(src));
  ok('the bar is a pill: watch, copy and hide are one tap further, in a panel',
     /panel\.append\(full, watch, copy, hide\);/.test(src) && /bar\.append\(dot, label, more\);/.test(src));
  ok('...every target in it at least 32px tall', /min-height:40px/.test(src) && /'min-height:34px'/.test(src));
  ok('...and on a phone\'s game screen it does not float at all: the lip carries the state',
     /const away = onGame && !corner;/.test(src) && /function tintLip\(colour\)/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
