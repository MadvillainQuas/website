/* ============================================================================
   The membership lock — epinoia/memlock.js over access.js CATALOGUE.locks.

   Pinned: (1) gating OFF -> nothing is locked, whatever else the state says (the master
   switch), and an unknown answer fails open; (2) gating ON + no access -> 'events' and
   'csv' are locked, the control is marked (aria-disabled, .mem-lock, explanatory label)
   and its click / Enter / Space action is suppressed; (3) gating ON + access -> normal:
   nothing marked, the action runs; (4) the popup words are exact; (5) an unknown feature
   key is never locked; (6) fulltable.js hides the switched-off advanced columns.
   No DOM: a tiny fake element stands in. Run: node supabase/tests/memlock.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
Object.defineProperty(globalThis, 'localStorage', { value: mem(), configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: mem(), configurable: true, writable: true });
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://abcref.supabase.co', supabaseAnonKey: 'k' };
const A = require(path.join(ROOT, 'epinoia', 'access.js'));
const M = require(path.join(ROOT, 'epinoia', 'memlock.js'));
const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));
globalThis.EpinoiaAccess = A;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

function fakeEl(text) {
  const attrs = new Map(), ls = {};
  return {
    dataset: {}, textContent: text || 'csv',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => (attrs.has(k) ? attrs.get(k) : null), removeAttribute: k => attrs.delete(k),
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
    /* dispatch: capture listeners of the element run first, in order, until one stops propagation */
    fire(t, e) { let stopped = false; const ev = Object.assign({ preventDefault() { this.prevented = true; }, stopImmediatePropagation() { stopped = true; } }, e);
      for (const f of (ls[t] || [])) { if (stopped) break; f(ev); } return ev; }
  };
}
const entry = (over) => ({ id: 'L1', slug: 'L1', name: 'L', access_mode: 'open', fixtures_public: true, analytics: 'members', features: [], can_view: true, analytics_ok: false, has_plans: true, has_league_plans: true, ...over });
async function state(top, e) {
  A._test.reset(); localStorage.clear(); sessionStorage.clear();
  A._test.transport(async (url, init = {}) => {
    const json = b => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith('/rest/v1/rpc/access_state')) return json({ signed_in: false, analytics_default: 'members', subscriptions: 0, leagues: [e], ...top });
    return { ok: false, status: 404, json: async () => ({}) };
  });
  await A.load({ leagueId: 'L1', force: true });
}
const press = (el, ran) => { const a = el.fire('click', {}); el.fire('keydown', { key: 'Enter' }); el.fire('keydown', { key: ' ' }); return a; };

console.log('\ncatalogue');
ok('CATALOGUE.locks names events, csv, the What wins model, the reports (docs/what-wins-model.md §10.3, 0220; the game\'s its own, 0231) and every section the platform can move (0222)',
   ['clubReport', 'csv', 'events', 'model', 'playerReport', 'gameReport', 'shotZones', 'shotClock', 'rotations', 'lineups', 'wowy', 'splits', 'statColumns',
    'gameFlow', 'gameConnections', 'gameAdvanced', 'videoRuns'].sort().join() === Object.keys(A.CATALOGUE.locks).sort().join() &&
   Object.values(A.CATALOGUE.locks).every(l => l.gate && l.label && l.what) &&
   A.CATALOGUE.locks.model.gate === 'analytics' && A.CATALOGUE.locks.model.label === 'What wins model' &&
   A.CATALOGUE.locks.clubReport.gate === 'club_report' && A.CATALOGUE.locks.playerReport.gate === 'player_report');
ok('the two reports are features a fan can read about (label, blurb, three lines)',
   ['club_report', 'player_report'].every(k => A.FEATURES[k] && A.FEATURES[k].label && A.FEATURES[k].blurb && A.FEATURES[k].includes.length >= 3));
ok('unknown feature keys are never locked', A.featureLocked('nonsense', 'L1') === false && M.locked('nonsense', 'L1') === false);
ok('the popup words are exact', M.tipText === 'ACCESS IS MEMBERSHIP-ONLY' && M.tipLink === 'Become a member');

console.log('\ngating OFF: nothing changes for anybody');
await state({ memberships_enabled: false }, entry());
for (const k of ['events', 'csv']) ok(k + ' not locked', M.locked(k, 'L1') === false && A.featureLocked(k, 'L1') === false);
{
  const el = fakeEl(); let ran = 0; el.addEventListener('click', () => ran++);
  ok('apply returns false, marks nothing', M.apply(el, 'csv', { league: 'L1' }) === false && !el.classList.contains('mem-lock') && el.getAttribute('aria-disabled') === null);
  el.fire('click', {}); ok('the action runs', ran === 1);
}
A._test.reset(); A._test.transport(null);
ok('no answer at all (fails open): not locked', M.locked('csv', 'never') === false && M.locked('events') === false);

console.log('\ngating ON, no access: locked and the action suppressed');
await state({ memberships_enabled: true }, entry());
for (const k of ['events', 'csv']) ok(k + ' locked', M.locked(k, 'L1') === true);
{
  const el = fakeEl('csv'); let ran = 0;
  // (in a browser the lock listens on the document in the capture phase, ahead of any page listener; the fake has no document)
  ok('apply locks', M.apply(el, 'csv', { league: 'L1' }) === true);
  el.addEventListener('click', () => ran++);
  ok('marked: class, aria-disabled, dataset', el.classList.contains('mem-lock') && el.getAttribute('aria-disabled') === 'true' && el.dataset.memLock === '1');
  ok('explanatory aria-label', /locked, access is membership-only/.test(el.getAttribute('aria-label')), el.getAttribute('aria-label'));
  const ev = press(el); ok('click prevented and the page listener never ran', ev.prevented === true && ran === 0);
  const k = el.fire('keydown', { key: 'Enter' }); ok('Enter prevented', k.prevented === true);
  const sp = el.fire('keydown', { key: ' ' }); ok('Space prevented', sp.prevented === true);
  ok('idempotent: locking twice does not double up', (M.apply(el, 'csv', { league: 'L1' }), true));
  let g = 0; const w = M.guard('csv', 'L1', () => { g++; return 1; }); w(); ok('guard(fn) does not run', g === 0);
  const pill = fakeEl('events'); let pr = 0; pill.addEventListener('click', () => pr++);
  M.lock(pill, { passive: true }); pill.fire('click', {});
  ok('passive lock: cursor class but the action (the teaser) still runs', pill.classList.contains('mem-lock') && pill.getAttribute('aria-disabled') === null && pr === 1);
}

console.log('\nthe reports: each its own feature (0220)');
await state({ memberships_enabled: false }, entry());
ok('switched off: neither report is locked', A.featureLocked('clubReport', 'L1') === false && A.featureLocked('playerReport', 'L1') === false);
await state({ memberships_enabled: true }, entry({ analytics_ok: true, features: ['analytics'] }));
ok('switched on, the analytics alone: both reports locked', A.featureLocked('clubReport', 'L1') === true && A.featureLocked('playerReport', 'L1') === true);
await state({ memberships_enabled: true }, entry({ features: ['club_report'] }));
ok('the club report alone: the club report open, the player report locked',
   A.featureLocked('clubReport', 'L1') === false && A.featureLocked('playerReport', 'L1') === true && M.locked('events', 'L1') === true);
await state({ memberships_enabled: true }, entry({ analytics_ok: true, features: ['analytics', 'league', 'club_report', 'player_report'] }));
ok('staff (every feature): both open', A.featureLocked('clubReport', 'L1') === false && A.featureLocked('playerReport', 'L1') === false);
A._test.reset(); A._test.transport(null);
ok('no answer (fails open): not locked', A.featureLocked('clubReport', 'never') === false);

console.log('\ngating ON, with access: normal');
await state({ memberships_enabled: true }, entry({ analytics_ok: true }));
for (const k of ['events', 'csv']) ok(k + ' open', M.locked(k, 'L1') === false);
{
  const el = fakeEl(); let ran = 0; el.addEventListener('click', () => ran++);
  ok('apply false, unmarked, runs', M.apply(el, 'csv', { league: 'L1' }) === false && !el.classList.contains('mem-lock') && (el.fire('click', {}), ran === 1));
  let g = 0; M.guard('csv', 'L1', () => g++)(); ok('guard runs', g === 1);
}

console.log('\nanswer changes: lock then unlock');
{
  const el = fakeEl(); let ran = 0; el.addEventListener('click', () => ran++);
  await state({ memberships_enabled: true }, entry()); M.apply(el, 'csv', { league: 'L1' });
  ok('locked first', el.classList.contains('mem-lock'));
  await state({ memberships_enabled: true }, entry({ analytics_ok: true })); M.apply(el, 'csv', { league: 'L1' });
  ok('unlocked after access arrives; label restored; action runs', !el.classList.contains('mem-lock') && el.getAttribute('aria-label') === null && (el.fire('click', {}), ran === 1));
  M.set(el, true, { what: 'x' }); ok('set(el, true) locks by the page\'s own decision', el.classList.contains('mem-lock'));
  M.set(el, false); ok('set(el, false) releases', !el.classList.contains('mem-lock'));
}

console.log('\nswitched-off advanced columns');
{
  const keys = Table.PLAYER_COLS.map(c => c.k);
  for (const k of ['total_s', 'ppr', 'pps', 'on_ortg', 'on_drtg']) ok(k + ' gone from the player columns', !keys.includes(k) && Table.HIDDEN_COLS.has(k));
  for (const k of ['ts', 'usg', 'bpm', 'ppp', 'pts75', 'poss', 'diff_ortg']) ok(k + ' still there', keys.includes(k));
  ok('the team table keeps its ORTG / DRTG', Table.TEAM_COLS.some(c => c.k === 'ortg') && Table.TEAM_COLS.some(c => c.k === 'drtg'));
}

A._test.transport(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
