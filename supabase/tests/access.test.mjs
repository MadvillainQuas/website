/* ============================================================================
   Memberships in the browser — epinoia/access.js (docs/memberships.md §6).

   What fails quietly here is the WRONG DIRECTION of a failure. Analytics must
   fail OPEN: a missing migration, a 401, a dropped connection or a slow answer
   has to leave the analytics on screen, because hiding them protects nothing
   and locks members out. A league must fail closed ONLY on a known answer: the
   paywall is drawn when the server said can_view = false and never on a guess.
   Neither mistake throws; both just draw the wrong page for everybody.

   Also pinned: the simulation switch, what counts as a premium column (against
   the real column keys in fulltable.js, so moving a column cannot silently leave
   it free or lock a free one), escaping in the teaser and the paywall (a league
   name is typed by a league admin), the join link's encoding, that a token rides
   on reads only for a members-only league the viewer may see, and that
   CATALOGUE.presets is exactly the wholly-premium presets of fulltable.js.

   And three that were found by using the site rather than reading it:
   - an EXPIRED access token with a refresh token is refreshed before anything
     is asked, and written back in the SDK's own shape, under a lock, never over
     a sign-out — otherwise a member opening a page an hour later is a stranger;
   - a FAILED re-ask keeps a known answer and announces nothing;
   - ?next= cannot leave the site, in access.js, join.js and signin.js alike
     (the latter two are read out of their source and run on the same strings).

   No network: a fake transport stands in for fetch.
   Run: node supabase/tests/access.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);

/* ---- a browser's worth of storage and config, before the module is loaded ---- */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}
const LS = memStore(), SS = memStore();
Object.defineProperty(globalThis, 'localStorage', { value: LS, configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: SS, configurable: true, writable: true });
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://abcref.supabase.co', supabaseAnonKey: 'sb_publishable_test' };

const A = require(path.join(ROOT, 'epinoia', 'access.js'));
const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};

const TOKEN_KEY = 'sb-abcref-auth-token';
const future = () => Math.floor(Date.now() / 1000) + 3600;
const signIn = (id = 'u1', tok = 'tok-' + id, exp = future()) =>
  LS.setItem(TOKEN_KEY, JSON.stringify({ access_token: tok, expires_at: exp, user: { id, email: id + '@example.org' } }));
const signOut = () => LS.removeItem(TOKEN_KEY);
/* what supabase-js leaves behind an hour after sign-in: the whole session, its
   access token run out, its refresh token still good */
const signInExpired = (id = 'u1', tok = 'old-' + id, refresh = 'r-' + id) =>
  LS.setItem(TOKEN_KEY, JSON.stringify({
    access_token: tok, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: refresh,
    user: { id, email: id + '@example.org' }
  }));
const setSim = v => (v ? LS.setItem('epinoia_access_sim', v) : LS.removeItem('epinoia_access_sim'));
const LOCK_KEY = A._test.LOCK_KEY;
const pause = ms => new Promise(r => setTimeout(r, ms));
function fresh() {
  A._test.reset(); A._test.transport(null); A._test.deadline(4000); SS.clear(); setSim(''); signOut();
  LS.removeItem(LOCK_KEY);
  delete globalThis.supabase; delete globalThis.epinoiaClientReady;
}

/* A fake Supabase: leagues by slug, access_state from a table of league entries,
   and the auth token endpoint. Records every call so request shapes and counts
   can be asserted.
     opts.status/code   access_state answers this error
     opts.hang          nothing ever answers (until the caller aborts)
     opts.throws        every request fails like a dropped connection
     opts.top           merged into access_state's top level
     opts.canViewIf     (Authorization header) -> can_view for members leagues
     opts.refreshStatus the token endpoint refuses with this status
     opts.refreshDelay  ms before the token endpoint answers
     opts.refreshHang   the token endpoint never answers
     opts.noUser        the token endpoint leaves the user off its answer */
function fakeServer(entries, opts = {}) {
  const calls = [];
  const hang = init => new Promise((_, reject) => {
    if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    if (opts.throws) throw new TypeError('Failed to fetch');
    if (opts.hang) return hang(init);
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
      if (opts.refreshHang) return hang(init);
      if (opts.refreshDelay) await pause(opts.refreshDelay);
      if (opts.refreshStatus) return json(opts.refreshStatus, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      const n = ++fn.refreshes;
      const body = JSON.parse(init.body);
      const out = { access_token: 'new-' + n, token_type: 'bearer', expires_in: 3600,
                    refresh_token: body.refresh_token + '-next' };
      if (!opts.noUser) out.user = { id: 'u1', email: 'u1@example.org' };
      return json(200, out);
    }
    if (url.includes('/rest/v1/leagues?')) {
      const slug = decodeURIComponent(url.match(/slug=eq\.([^&]*)/)[1]);
      const e = entries.find(x => x.slug === slug);
      return json(200, e ? [{ id: e.id, slug: e.slug, name: e.name }] : []);
    }
    if (url.endsWith('/rest/v1/rpc/access_state')) {
      if (opts.status) return json(opts.status, { code: opts.code || null, message: 'nope' });
      const body = JSON.parse(init.body);
      const auth = init.headers && init.headers.Authorization;
      return json(200, Object.assign({
        signed_in: !!auth, analytics_default: 'free', subscriptions: opts.subs || 0,
        leagues: (body.p_leagues || []).map(id => entries.find(x => x.id === id)).filter(Boolean)
          .map(e => (opts.canViewIf && e.access_mode === 'members'
            ? Object.assign({}, e, { can_view: !!opts.canViewIf(auth) }) : e))
      }, opts.top || {}));
    }
    return json(404, {});
  };
  fn.calls = calls;
  fn.refreshes = 0;
  fn.count = part => calls.filter(c => c.url.includes(part)).length;
  return fn;
}
const entry = (id, over) => Object.assign({
  id, slug: id, name: 'League ' + id, access_mode: 'open', fixtures_public: true,
  analytics: 'free', features: [], can_view: true, analytics_ok: true, has_plans: true,
  has_league_plans: true
}, over || {});

/* ============================================================== fail open === */
console.log('\nfail-open defaults');
fresh();
{
  const s = A.get('never-loaded');
  ok('an unloaded league is unknown', s.known === false);
  ok('unknown: canView true', A.canView('never-loaded') === true && s.canView === true);
  ok('unknown: analyticsOk true', A.analyticsOk('never-loaded') === true && s.analyticsOk === true);
  ok('no league at all: both true', A.analyticsOk() === true && A.canView() === true);
  eq('the state has the contract\'s keys', ['known', 'signedIn', 'accessMode', 'fixturesPublic', 'analytics', 'features', 'canView', 'analyticsOk', 'hasPlans'].every(k => k in s), true);
  const t0 = Date.now();
  const st = await A.load({ leagueSlug: 'slb' });
  ok('under node with no transport, load() resolves the fail-open state at once', st.known === false && st.canView && st.analyticsOk && Date.now() - t0 < 500);
  ok('load() with nothing resolves too', (await A.load()).known === false);
}

console.log('\nfailures of every kind fail open');
for (const [what, opts] of [['404 PGRST202 (migration not applied)', { status: 404, code: 'PGRST202' }],
                            ['401 (token refused)', { status: 401 }], ['500', { status: 500 }]]) {
  fresh(); signIn();
  const srv = fakeServer([entry('L1', { access_mode: 'members', can_view: false, analytics_ok: false })], opts);
  A._test.transport(srv);
  const st = await A.load({ leagueId: 'L1' });
  ok(what + ': unknown, canView and analyticsOk true', st.known === false && A.canView('L1') && A.analyticsOk('L1'), JSON.stringify(st));
}
{
  fresh();
  A._test.transport(async () => { throw new TypeError('Failed to fetch'); });
  const st = await A.load({ leagueId: 'L1' });
  ok('a network error fails open', st.known === false && A.canView('L1') && A.analyticsOk('L1'));
}
{
  fresh(); A._test.deadline(60);
  const srv = fakeServer([entry('L1', { access_mode: 'members', can_view: false })], { hang: true });
  A._test.transport(srv);
  const t0 = Date.now();
  const st = await A.load({ leagueSlug: 'L1' });
  ok('a request that never answers gives up at the deadline and fails open', st.known === false && A.canView('L1') && Date.now() - t0 < 1000, (Date.now() - t0) + 'ms');
}
{
  fresh();
  const srv = fakeServer([entry('L1'), entry('L2')], { status: 404, code: 'PGRST202' });
  A._test.transport(srv);
  await A.load({ leagueId: 'L1' });
  const n = srv.calls.length;
  await A.load({ leagueId: 'L2' });
  ok('a missing RPC is remembered: the next league does not ask again', srv.calls.length === n);
  A.forget();
  await A.load({ leagueId: 'L2' });
  ok('forget() clears that memory', srv.calls.length === n + 1);
}

/* ============================================================== mapping === */
console.log('\nstate from an access_state payload');
{
  const p = { signed_in: true, analytics_default: 'members', subscriptions: 2,
    leagues: [entry('L9', { slug: 'nbl', name: 'NBL', access_mode: 'members', fixtures_public: false,
                            analytics: 'members', features: ['analytics', 'league', 7], can_view: true, analytics_ok: true, has_plans: true })] };
  const s = A.fromPayload(p, 'L9');
  eq('every field mapped', s, { known: true, signedIn: true, leagueId: 'L9', slug: 'nbl', name: 'NBL', accessMode: 'members',
    fixturesPublic: false, analytics: 'members', features: ['analytics', 'league'], canView: true, analyticsOk: true,
    hasPlans: true, hasLeaguePlans: true, subscriptions: 2, analyticsDefault: 'members', membershipsEnabled: true });
  ok('has_league_plans is its own answer, not has_plans', A.fromPayload({ leagues: [entry('X', { has_plans: true, has_league_plans: false })] }, 'X').hasLeaguePlans === false &&
     A.fromPayload({ leagues: [entry('X', { has_plans: false, has_league_plans: true })] }, 'X').hasPlans === false);
  ok('an older payload without has_league_plans shows the link (unknown is not "none")',
     A.fromPayload({ leagues: [{ id: 'X', has_plans: false }] }, 'X').hasLeaguePlans === true);
  ok('no league: the top-level analytics_ok is the answer',
     A.fromPayload({ analytics_default: 'members', analytics_ok: false }, null).analyticsOk === false &&
     A.fromPayload({ analytics_default: 'members', analytics_ok: true }, null).analyticsOk === true);
  ok('no league, analytics_ok left off: fails open', A.fromPayload({ analytics_default: 'members' }, null).analyticsOk === true);
  const miss = A.fromPayload(p, 'other');
  ok('a league not in the payload is unknown (fail open)', miss.known === false && miss.canView && miss.analyticsOk);
  ok('garbage is unknown', A.fromPayload('x', 'L9').known === false && A.fromPayload(null, 'L9').known === false && A.fromPayload([], 'L9').known === false);
  const plat = A.fromPayload({ signed_in: false, analytics_default: 'free', subscriptions: 0 }, null);
  ok('no league asked: known, open, with the subscription count', plat.known && plat.canView && plat.analyticsOk && plat.subscriptions === 0);
  const old = A.fromPayload({ leagues: [{ id: 'X', access_mode: 'members', analytics: 'members', features: ['league'] }] }, 'X');
  ok('without can_view / analytics_ok: worked out from mode and features', old.canView === true && old.analyticsOk === false);
  const unknownMode = A.fromPayload({ leagues: [{ id: 'X', access_mode: 'weird', analytics: 'weird' }] }, 'X');
  ok('unknown words fall to open / free', unknownMode.accessMode === 'open' && unknownMode.analytics === 'free' && unknownMode.fixturesPublic === true);
}

/* ======================================================= combinations === */
console.log('\nopen / members / analytics-members');
{
  fresh(); signIn();
  const srv = fakeServer([
    entry('open-free'),
    entry('open-an', { analytics: 'members', analytics_ok: false }),
    entry('open-an-paid', { analytics: 'members', features: ['analytics'], analytics_ok: true }),
    entry('mem-out', { access_mode: 'members', can_view: false, analytics_ok: true }),
    entry('mem-in', { access_mode: 'members', features: ['league'], can_view: true }),
    entry('mem-in-an', { access_mode: 'members', analytics: 'members', features: ['league'], can_view: true, analytics_ok: false }),
    entry('mem-staff', { access_mode: 'members', analytics: 'members', features: ['analytics', 'league'], can_view: true, analytics_ok: true })
  ]);
  A._test.transport(srv);
  const want = { 'open-free': [true, true], 'open-an': [true, false], 'open-an-paid': [true, true],
                 'mem-out': [false, true], 'mem-in': [true, true], 'mem-in-an': [true, false], 'mem-staff': [true, true] };
  for (const id of Object.keys(want)) await A.load({ leagueId: id });
  for (const [id, [cv, ao]] of Object.entries(want)) {
    ok(id + ': canView ' + cv + ', analyticsOk ' + ao, A.canView(id) === cv && A.analyticsOk(id) === ao && A.get(id).known,
       JSON.stringify(A.get(id)));
  }
  ok('the request is a POST of p_leagues with apikey and the bearer token', (() => {
    const c = srv.calls.find(x => x.url.endsWith('/rpc/access_state'));
    return c.init.method === 'POST' && JSON.parse(c.init.body).p_leagues[0] === 'open-free' &&
      c.init.headers.apikey === 'sb_publishable_test' && c.init.headers.Authorization === 'Bearer tok-u1';
  })());
}
{
  fresh();
  const srv = fakeServer([entry('slb', { name: 'Super League', access_mode: 'members', can_view: false })]);
  A._test.transport(srv);
  const [a, b] = await Promise.all([A.load({ leagueSlug: 'slb' }), A.load({ leagueSlug: 'slb' })]);
  const slugCalls = srv.calls.filter(c => c.url.includes('/rest/v1/leagues?'));
  const stateCalls = srv.calls.filter(c => c.url.endsWith('/rpc/access_state'));
  ok('two concurrent loads share one request each', slugCalls.length === 1 && stateCalls.length === 1, srv.calls.length + ' calls');
  ok('the slug read is anonymous (apikey only)', slugCalls[0].init.headers.apikey && !slugCalls[0].init.headers.Authorization);
  ok('signed out, access_state carries no Authorization', !stateCalls[0].init.headers.Authorization);
  ok('both callers get the known answer', a.known && b.known && a.canView === false && a.name === 'Super League');
  ok('a loaded slug answers like its id', A.canView('slb') === false && A.get('slb').leagueId === 'slb');
  await A.load({ leagueId: 'slb' });
  ok('loading it again asks nothing', srv.calls.length === 2);
  A._test.reset();
  A._test.transport(srv);
  await A.load({ leagueId: 'slb' });
  ok('a new page within 60 s reads sessionStorage, not the network', srv.calls.length === 2 && A.canView('slb') === false);
  const key = [...Array(SS.length).keys()].map(i => SS.key(i)).find(k => k.startsWith('epinoia_access:anon:'));
  const j = JSON.parse(SS.getItem(key)); j.at -= 61000; SS.setItem(key, JSON.stringify(j));
  A._test.reset(); A._test.transport(srv);
  await A.load({ leagueId: 'slb' });
  ok('after 60 s it asks again', srv.calls.length === 3);
  await A.load({ leagueId: 'slb', force: true });
  ok('force asks again at once', srv.calls.length === 4);
}
{
  fresh();
  const srv = fakeServer([entry('L1', { access_mode: 'members', can_view: false })]);
  A._test.transport(srv);
  const seen = [];
  A.onChange(d => seen.push(d.reason + ':' + d.leagueId));
  await A.load({ leagueId: 'L1' });
  await A.load({ leagueId: 'L1', force: true });
  eq('onChange fires on a load that changed the answer, not on one that did not', seen, ['load:L1']);
  const off = A.onChange(() => seen.push('x'));
  off();
  A._test.reset(); A._test.transport(srv); SS.clear();
  await A.load({ leagueId: 'L1' });
  ok('an unsubscribed listener hears nothing', !seen.includes('x'));
}
{
  fresh(); signIn('u1');
  const srv = fakeServer([entry('L1', { access_mode: 'members', features: ['league'], can_view: true })]);
  A._test.transport(srv);
  await A.load({ leagueId: 'L1' });
  ok('a member sees the league', A.canView('L1') === true);
  signIn('u2');
  const st = A.get('L1');
  ok('another account signed in: the first account\'s answer no longer counts', st.known === false);
}

/* ============================================================= simulation === */
console.log('\nsimulation');
{
  fresh(); signIn();
  A._test.transport(fakeServer([
    entry('open'), entry('mem-in', { access_mode: 'members', features: ['league'], can_view: true }),
    entry('mem-out', { access_mode: 'members', can_view: false })
  ]));
  for (const id of ['open', 'mem-in', 'mem-out']) await A.load({ leagueId: id });
  setSim('locked');
  ok('locked: analyticsOk false on an open league', A.analyticsOk('open') === false);
  ok('locked: analyticsOk false on a league never loaded, and with no league', A.analyticsOk('nowhere') === false && A.analyticsOk() === false);
  ok('locked: canView false on a members league the server lets you see', A.canView('mem-in') === false);
  ok('locked: canView stays true on an open league and an unknown one', A.canView('open') === true && A.canView('nowhere') === true);
  ok('locked: get() says so', A.get('mem-in').simulated === 'locked' && A.get('mem-in').canView === false && A.get('open').analyticsOk === false);
  ok('locked: authHeaders still follow the server (a member keeps the token)', !!A.authHeaders('mem-in').Authorization);
  setSim('member');
  ok('member: both true where the server said no', A.canView('mem-out') === true && A.analyticsOk('mem-out') === true);
  ok('member: authHeaders do not pretend', Object.keys(A.authHeaders('mem-out')).length === 0);
  setSim('nonsense');
  ok('any other value is ignored', A.canView('mem-out') === false && A.analyticsOk('open') === true && !('simulated' in A.get('open')));
  setSim('');
}

/* ======================================================= premium columns === */
console.log('\npremium columns against fulltable.js');
{
  const all = Table.PLAYER_COLS.concat(Table.TEAM_COLS);
  const byRule = k => /^(ev_|evd_|z_)/.test(k) || ['pred_efg', 'efg_sh', 'efg_vs', 'morey'].includes(k);
  const wrong = all.filter(c => A.isPremiumColumn(c.k) !== byRule(c.k)).map(c => c.k);
  ok('every column key in both catalogues classified by the rule (' + all.length + ' columns)', wrong.length === 0, wrong.join());
  const evCount = all.filter(c => /^ev_|^evd_/.test(c.k)).length, zCount = all.filter(c => /^z_/.test(c.k)).length;
  ok('the premium families are really there (' + evCount + ' events, ' + zCount + ' zone columns)', evCount > 40 && zCount >= 80);
  for (const k of ['ev_second_ppg', 'evd_transition_ppp', 'ev_gp', 'z_rim_efg', 'z_all_att100', 'pred_efg', 'efg_sh', 'efg_vs', 'morey', 'ev_ast_pts_sh']) {
    ok(k + ' is premium', A.isPremiumColumn(k) === true && all.some(c => c.k === k));
  }
  for (const k of ['gp', 'ppg', 'fg_pct', 'rim_pct', 'rim_apg', 'mid_pct', 'paint', 'fast', 'sc', 'rapm', 'diff_net', 'efg', 'ff_efg', 'p3_share', 'name', 'rank']) {
    ok(k + ' is free', A.isPremiumColumn(k) === false && all.some(c => c.k === k));
  }
  ok('nonsense is free', A.isPremiumColumn(null) === false && A.isPremiumColumn('') === false && A.isPremiumColumn('evening') === false);
  ok('CATALOGUE.columns all exist in the team table', A.CATALOGUE.columns.every(k => Table.TEAM_COLS.some(c => c.k === k)));
  ok('barKeys: the player bars\' events keys only', A.CATALOGUE.barKeys('ev_ast_pts_sh') && A.CATALOGUE.barKeys('ev_rim_astp') && !A.CATALOGUE.barKeys('rim_pct') && !A.CATALOGUE.barKeys(undefined));
  eq('gameTabs', A.CATALOGUE.gameTabs, ['flow', 'connections', 'events', 'shotclock']);
  eq('columnPrefixes', A.CATALOGUE.columnPrefixes, ['ev_', 'evd_', 'z_']);
  ok('wowyPreviewMax is 1', A.CATALOGUE.wowyPreviewMax === 1);
}

console.log('\nCATALOGUE.presets is exactly the wholly-premium presets');
{
  const context = new Set(A.CATALOGUE.contextColumns);
  const whollyPremium = kind => {
    const CAT = kind === 'team' ? Table.TEAM_COLS : Table.PLAYER_COLS;
    return Table.PRESETS[kind].map(p => p[0]).filter(id => id !== '*').filter(id => {
      const cols = CAT.filter(c => !c.g.includes('id') && c.g.includes(id) && !context.has(c.k));
      return cols.length > 0 && cols.every(c => A.isPremiumColumn(c.k));
    });
  };
  const computed = [...new Set(whollyPremium('player').concat(whollyPremium('team')))].sort();
  eq('computed from fulltable.js', [...A.CATALOGUE.presets].sort(), computed);
  const ids = new Set(Table.PRESETS.player.concat(Table.PRESETS.team).map(p => p[0]));
  ok('every listed id is a real preset', A.CATALOGUE.presets.every(id => ids.has(id)));
  ok('gp is the only free column riding in them', A.CATALOGUE.presets.every(id =>
    Table.PLAYER_COLS.concat(Table.TEAM_COLS).filter(c => c.g.includes(id) && !A.isPremiumColumn(c.k)).every(c => c.k === 'gp')));
  ok('the everything preset is not locked', !A.CATALOGUE.presets.includes('*'));
  ok('the catalogue cannot be edited by a page', Object.isFrozen(A.CATALOGUE) && Object.isFrozen(A.CATALOGUE.presets));
}

console.log('\nFEATURES');
{
  ok('analytics and league, each with a label, a blurb and what it includes',
     ['analytics', 'league'].every(k => A.FEATURES[k] && A.FEATURES[k].label && A.FEATURES[k].blurb && A.FEATURES[k].includes.length >= 3));
}

/* ================================================================ teaser === */
console.log('\nteaserHTML');
{
  fresh();
  A._test.transport(fakeServer([entry('slb', { analytics: 'members', analytics_ok: false, has_plans: true }),
                                entry('bare', { analytics: 'members', analytics_ok: false, has_plans: false })]));
  await A.load({ leagueSlug: 'slb' });
  await A.load({ leagueSlug: 'bare' });
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const h = A.teaserHTML({ leagueSlug: 'slb', title: evil, lines: [evil, 'two', 'three', 'four'] });
  ok('a hostile title and line are escaped', !h.includes('<img') && h.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  ok('at most three lines', (h.match(/class="ep-lock-l"/g) || []).length === 3);
  ok('with plans: the join link for that league', h.includes('href="/epinoia/join/?l=slb') && h.includes('See membership'));
  ok('signed out: a sign-in link back here', h.includes('href="/epinoia/signin/'));
  ok('the padlock is decorative', h.includes('aria-hidden="true"') && h.includes('stroke="currentColor"'));
  const d = A.teaserHTML({ leagueSlug: 'slb' });
  ok('default title', d.includes('Advanced analytics are for members'));
  const none = A.teaserHTML({ leagueSlug: 'bare', title: 'Game flow is for members' });
  ok('no plans: "Members only" and no join link', none.includes('Members only') && !none.includes('/join/') && !none.includes('See membership'));
  ok('no plans, signed out: the way in is still offered (a grant counts once you sign in)', none.includes('/signin/'));
  const c = A.teaserHTML({ leagueSlug: 'slb', compact: true, lines: ['ignored'] });
  ok('compact: one line with the link, no paragraphs', c.includes('ep-lock-compact') && c.includes('/join/?l=slb') && !c.includes('ep-lock-l') && !c.includes('ep-lock-tx'));
  const cn = A.teaserHTML({ leagueSlug: 'bare', compact: true });
  ok('compact with no plans: "Members only", no link', cn.includes('Members only') && !cn.includes('<a '));
  const hs = A.teaserHTML({ leagueSlug: '"><script>x</script>' });
  ok('a hostile slug cannot break out of the href', !hs.includes('<script>') && hs.includes('%22%3E%3Cscript%3Ex%3C%2Fscript%3E'));
  /* signing in makes the signed-out answers stale (they belong to nobody now), so ask again */
  signIn();
  await A.load({ leagueSlug: 'slb' });
  await A.load({ leagueSlug: 'bare' });
  const inn = A.teaserHTML({ leagueSlug: 'slb' });
  ok('signed in: no sign-in link, join link kept', !inn.includes('/signin/') && inn.includes('/join/?l=slb'));
  const innNone = A.teaserHTML({ leagueSlug: 'bare' });
  ok('signed in, no plans: no links at all', !innNone.includes('<a '));
  signOut();
  ok('an answer given to another account is no answer: unknown means the link shows', A.teaserHTML({ leagueSlug: 'bare' }).includes('/join/'));
}

/* =============================================================== paywall === */
console.log('\npaywallHTML');
{
  fresh();
  const h = A.paywallHTML({ league: { id: 'L1', slug: 'nbl', name: '<b>Evil</b> League', fixturesPublic: true, hasLeaguePlans: true } });
  ok('the league name is escaped', !h.includes('<b>Evil') && h.includes('&lt;b&gt;Evil&lt;/b&gt; League'));
  ok('says its results and statistics are for members', h.includes('keeps its results and statistics for its members'));
  ok('fixtures public: upcoming fixtures listed as free', h.includes('Upcoming fixtures'));
  ok('clubs and squads listed as free', h.includes('clubs, their crests and squads'));
  ok('join and sign-in', h.includes('/epinoia/join/?l=nbl') && h.includes('/epinoia/signin/'));
  ok('labelled by its heading', /aria-labelledby="(ep-paywall-\d+)"[\s\S]*id="\1"/.test(h));
  const p = A.paywallHTML({ league: { name: 'Closed', slug: 'c', fixtures_public: false, has_league_plans: false } });
  ok('fixtures private: not listed', !p.includes('Upcoming fixtures'));
  ok('no plans: no join link, and it says so', !p.includes('/join/') && p.includes('not on sale'));
  signIn();
  ok('signed in: no sign-in link, and it says the account is not a member', !A.paywallHTML({ league: { name: 'X', slug: 'x' } }).includes('/signin/') &&
     A.paywallHTML({ league: { name: 'X', slug: 'x' } }).includes('not a member here yet'));
}
{
  /* Epinoia's analytics plan applies in every league (has_plans) but opens none
     of them, so a closed league that sells nothing of its own offers nothing */
  fresh();
  A._test.transport(fakeServer([
    entry('nbl', { name: 'NBL', access_mode: 'members', can_view: false, has_plans: true, has_league_plans: false }),
    entry('bbl', { name: 'BBL', access_mode: 'members', can_view: false, has_plans: true, has_league_plans: true })
  ]));
  await A.load({ leagueSlug: 'nbl' });
  await A.load({ leagueSlug: 'bbl' });
  const only = A.paywallHTML({ league: { id: 'nbl', slug: 'nbl', name: 'NBL' } });
  ok('paywall, only a platform analytics plan applies: no join link, "not on sale"', !only.includes('/join/') && only.includes('not on sale') &&
     !only.includes('Membership plans and prices'));
  const own = A.paywallHTML({ league: { id: 'bbl', slug: 'bbl', name: 'BBL' } });
  ok('paywall, the league sells its own plan: the join link', own.includes('/epinoia/join/?l=bbl') && !own.includes('not on sale'));
  ok('the analytics teaser in the first league still offers the analytics plan', A.teaserHTML({ leagueSlug: 'nbl' }).includes('/join/?l=nbl'));
}

/* ================================================================= links === */
console.log('\njoinHref');
{
  fresh();
  eq('root falls back to /epinoia/ with no script URL', A._test.ROOT_PATH, '/epinoia/');
  eq('league and next, encoded', A.joinHref({ leagueSlug: 'slb', next: '/epinoia/l/?l=slb&tab=leaders' }),
     '/epinoia/join/?l=slb&next=%2Fepinoia%2Fl%2F%3Fl%3Dslb%26tab%3Dleaders');
  eq('a slug is encoded', A.joinHref({ leagueSlug: 'a b&c', next: '/epinoia/' }), '/epinoia/join/?l=a%20b%26c&next=%2Fepinoia%2F');
  eq('an off-site next is dropped', A.joinHref({ leagueSlug: 'slb', next: '//evil.example/x' }), '/epinoia/join/?l=slb');
  eq('an absolute URL next is dropped', A.joinHref({ next: 'https://evil.example/' }), '/epinoia/join/');
  eq('a backslash trick is dropped', A.joinHref({ next: '/\\evil.example' }), '/epinoia/join/');
  eq('signinHref', A.signinHref('/epinoia/game/?g=1'), '/epinoia/signin/?next=%2Fepinoia%2Fgame%2F%3Fg%3D1');
}

console.log('\nprices');
{
  eq('a month', A.priceText(499, 'gbp', 'month'), '£4.99 a month');
  eq('a year', A.priceText(4999, 'GBP', 'year'), '£49.99 a year');
  eq('euro', A.priceText(500, 'eur', 'month'), '€5.00 a month');
  eq('an unknown currency by its code', A.amountText(1234, 'sek'), 'SEK 12.34');
  eq('nonsense is zero, not NaN', A.amountText('x', 'gbp'), '£0.00');
}

/* ============================================== the master switch, off === */
/* Memberships ship switched off for the whole platform. While they are off the
   database refuses nothing, so a page that still drew a paywall or a teaser from
   a league's stored settings would lock everybody out of something anyone can
   read. The switch wins over whatever else a payload carries — except the
   simulation, which is how an admin previews the gating before switching on. */
console.log('\nmemberships switched off');
{
  const closed = entry('M', { slug: 'mem', access_mode: 'members', fixtures_public: false, analytics: 'members',
                              can_view: false, analytics_ok: false });
  const off = A.fromPayload({ memberships_enabled: false, analytics_default: 'members', leagues: [closed] }, 'M');
  ok('off: canView and analyticsOk true even where the entry says false',
     off.known && off.canView === true && off.analyticsOk === true, JSON.stringify(off));
  ok('off: the state says so, and still names the stored mode',
     off.membershipsEnabled === false && off.accessMode === 'members' && off.fixturesPublic === false);
  const offTop = A.fromPayload({ memberships_enabled: false, analytics_default: 'members', analytics_ok: false }, null);
  ok('off, no league: analyticsOk true even where analytics_ok says false', offTop.known && offTop.analyticsOk === true && offTop.membershipsEnabled === false);
  const on = A.fromPayload({ memberships_enabled: true, leagues: [closed] }, 'M');
  ok('on: the payload\'s own answers stand', on.membershipsEnabled === true && on.canView === false && on.analyticsOk === false);
  const older = A.fromPayload({ leagues: [closed] }, 'M');
  ok('an older payload without the key reads as on, and its answers stand', older.membershipsEnabled === true && older.canView === false && older.analyticsOk === false);
  const odd = A.fromPayload({ memberships_enabled: 'false', leagues: [closed] }, 'M');
  ok('a non-boolean memberships_enabled is not "off": the answers stand', odd.membershipsEnabled === true && odd.canView === false);
  ok('the unknown state is switched on (it is fail-open anyway)', A.get('never').membershipsEnabled === true);

  fresh(); signIn('u1', 'tok-1');
  const srv = fakeServer([entry('mem-out', { access_mode: 'members', analytics: 'members', can_view: false, analytics_ok: false }),
                          entry('open-an', { analytics: 'members', analytics_ok: false })],
                         { top: { memberships_enabled: false, analytics_default: 'members', analytics_ok: false } });
  A._test.transport(srv);
  await A.load({ leagueId: 'mem-out' });
  await A.load({ leagueId: 'open-an' });
  await A.load({});
  ok('loaded while off: a members league the server says no to is viewable', A.canView('mem-out') === true && A.get('mem-out').canView === true);
  ok('loaded while off: members analytics are shown, in a league and with none', A.analyticsOk('mem-out') && A.analyticsOk('open-an') && A.analyticsOk());
  ok('loaded while off: get() reports the switch and the stored mode', A.get('mem-out').membershipsEnabled === false && A.get('mem-out').accessMode === 'members');
  eq('while off, a signed-in viewer\'s token still rides for a members-mode league (ready for the switch)', A.authHeaders('mem-out'), { Authorization: 'Bearer tok-1' });

  A._test.reset(); A._test.transport(srv);
  const n = srv.calls.length;
  await A.load({ leagueId: 'mem-out' });
  ok('the next page reads it from sessionStorage and it is still off, still open',
     srv.calls.length === n && A.get('mem-out').known && A.get('mem-out').membershipsEnabled === false && A.canView('mem-out') === true);

  setSim('locked');
  ok('the simulation still previews the gating while off: locked', A.canView('mem-out') === false && A.analyticsOk('mem-out') === false && A.analyticsOk() === false);
  setSim('member');
  ok('...and member', A.canView('mem-out') === true && A.analyticsOk('mem-out') === true);
  setSim('');

  /* a platform admin switches memberships on: the next answer gates again */
  A._test.transport(fakeServer([entry('mem-out', { access_mode: 'members', analytics: 'members', can_view: false, analytics_ok: false })],
                               { top: { memberships_enabled: true } }));
  const seen = [];
  A.onChange(d => seen.push(d.reason));
  await A.load({ leagueId: 'mem-out', force: true });
  ok('switched on: the same league is walled and its analytics locked', A.canView('mem-out') === false && A.analyticsOk('mem-out') === false && A.get('mem-out').membershipsEnabled === true);
  ok('...and the page is told the answer moved', seen.includes('load'));
}

/* ============================================================ authHeaders === */
console.log('\nauthHeaders');
{
  fresh(); signIn('u1', 'tok-1');
  A._test.transport(fakeServer([entry('open'), entry('mem-in', { access_mode: 'members', features: ['league'], can_view: true }),
                                entry('mem-out', { access_mode: 'members', can_view: false })]));
  await A.load({ leagueId: 'open' });
  eq('only an open league loaded: nothing', A.authHeaders(), {});
  await A.load({ leagueId: 'mem-out' });
  eq('a members league this account may not see: nothing', A.authHeaders(), {});
  eq('scoped to it: nothing', A.authHeaders('mem-out'), {});
  await A.load({ leagueId: 'mem-in' });
  eq('a members league this account may see: the bearer token', A.authHeaders(), { Authorization: 'Bearer tok-1' });
  eq('scoped to it, by id', A.authHeaders('mem-in'), { Authorization: 'Bearer tok-1' });
  eq('scoped to the open league: nothing', A.authHeaders('open'), {});
  signIn('u1', 'tok-1', Math.floor(Date.now() / 1000) - 5);
  eq('the token expired: nothing', A.authHeaders(), {});
  ok('and an expired token is no session', A.session() === null);
  signOut();
  eq('signed out: nothing', A.authHeaders(), {});
  signIn('u1', 'tok-2');
  eq('the same account with a refreshed token sends the new one', A.authHeaders(), { Authorization: 'Bearer tok-2' });
  signIn('u2', 'tok-3');
  eq('a different account does not inherit the first one\'s access', A.authHeaders(), {});
  LS.setItem(TOKEN_KEY, JSON.stringify({ currentSession: { access_token: 'old-shape', expires_at: future(), user: { id: 'u1' } } }));
  eq('the older stored-session shape is read too', A.session() && A.session().token, 'old-shape');
  LS.setItem(TOKEN_KEY, '{not json');
  ok('an unreadable token is signed out', A.session() === null && Object.keys(A.authHeaders()).length === 0);
}

/* =============================================== no league: platform answer === */
console.log('\nno league: the platform answer');
{
  fresh();
  A._test.transport(fakeServer([], { top: { analytics_default: 'members', analytics_ok: false } }));
  const st = await A.load();
  ok('a game or player with no league follows the top-level analytics_ok', st.known && A.analyticsOk() === false &&
     A.analyticsOk(null) === false && A.analyticsOk('') === false);
  ok('a league never loaded still fails open', A.analyticsOk('nowhere') === true);
  fresh();
  A._test.transport(fakeServer([], { top: { analytics_default: 'members', analytics_ok: true } }));
  await A.load();
  ok('a platform analytics member with no league: analyticsOk()', A.analyticsOk() === true);
}

/* ========================================================== safe next paths === */
console.log('\n?next= cannot leave the site (access.js, join.js, signin.js)');
{
  const LOC = { origin: 'https://prophesyscouting.co.uk' };
  /* CRLF on a Windows checkout (core.autocrlf), LF in CI: read both the same way */
  const src = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
  const joinSrc = src('epinoia', 'join', 'join.js');
  const signSrc = src('epinoia', 'signin', 'signin.js');
  const jm = joinSrc.match(/\n  function safeNext\(n\) \{\n[\s\S]*?\n  \}\n/);
  const sm = signSrc.match(/\nfunction safePath\(n\) \{\n[\s\S]*?\n\}\n/);
  ok('join.js still has function safeNext(n)', !!jm);
  ok('signin.js still has function safePath(n)', !!sm);
  const joinSafe = jm ? new Function('location', jm[0] + '\nreturn safeNext;')(LOC) : () => 'MISSING';
  const signSafe = sm ? new Function('location', sm[0] + '\nreturn safePath;')(LOC) : () => 'MISSING';
  const attacks = [
    '/%09/evil.com', '//evil.com', '/\\evil.com', '/epinoia/..//evil.com',
    '/epinoia/\\\\evil.com', '/epinoia/%5cevil.com', '/epinoia/%5C%5Cevil.com',
    '/\t/evil.com', '/epinoia/\n/x', '/epinoia/ x', ' /epinoia/', '/epinoia/\x00', '/epinoia/\x7f',
    'https://evil.com/epinoia/', 'javascript:alert(1)//', '/epinoia/../admin/', '/epinoia/%2e%2e/admin/',
    '/elsewhere/', '/epinoiaX/', '/epinoia', '', null, undefined
  ];
  const good = ['/epinoia/', '/epinoia/l/?l=slb&tab=leaders', '/epinoia/game/?g=1#box', '/epinoia/join/?next=%2Fepinoia%2F'];
  for (const [who, fn] of [['access.js', A.safePath], ['join.js', joinSafe], ['signin.js', signSafe]]) {
    const leaked = attacks.filter(a => fn(a) !== '');
    ok(who + ' refuses all ' + attacks.length + ' attack strings', leaked.length === 0, JSON.stringify(leaked));
    const lost = good.filter(g => fn(g) !== g);
    ok(who + ' keeps every real /epinoia/ path', lost.length === 0, JSON.stringify(lost));
  }
  eq('joinHref drops a %09 trick', A.joinHref({ leagueSlug: 'slb', next: '/%09/evil.com' }), '/epinoia/join/?l=slb');
  eq('signinHref drops a ..// trick', A.signinHref('/epinoia/..//evil.com'), '/epinoia/signin/');
}

/* ================================================== refreshing the session === */
console.log('\nan expired token is refreshed before it is believed');
{
  fresh();
  const now = Date.now(), sec = Math.floor(now / 1000);
  const raw = o => JSON.stringify(Object.assign({ access_token: 'a', user: { id: 'u1' } }, o));
  eq('nothing stored: none', A._test.refreshPlan(null, now), 'none');
  eq('a live token: valid', A._test.refreshPlan(raw({ expires_at: sec + 3600, refresh_token: 'r' }), now), 'valid');
  eq('expired, with a refresh token: refresh', A._test.refreshPlan(raw({ expires_at: sec - 5, refresh_token: 'r' }), now), 'refresh');
  eq('ten seconds or less left: refresh', A._test.refreshPlan(raw({ expires_at: sec + 5, refresh_token: 'r' }), now), 'refresh');
  eq('expired, no refresh token: none', A._test.refreshPlan(raw({ expires_at: sec - 5 }), now), 'none');
  eq('no expiry recorded: valid', A._test.refreshPlan(raw({ refresh_token: 'r' }), now), 'valid');
  eq('unreadable: none', A._test.refreshPlan('{nope', now), 'none');
  eq('the older currentSession shape too', A._test.refreshPlan(JSON.stringify({ currentSession:
    { access_token: 'a', expires_at: sec - 5, refresh_token: 'r', user: { id: 'u1' } } }), now), 'refresh');
}
{
  fresh(); signInExpired('u1', 'old-u1', 'r-u1');
  const srv = fakeServer([entry('L1', { access_mode: 'members', features: ['league'], can_view: true })],
                         { canViewIf: auth => /^Bearer new-/.test(auth || '') });
  A._test.transport(srv);
  ok('an hour on, the stored token is no session by itself', A.session() === null);
  const st = await A.load({ leagueId: 'L1' });
  const tok = srv.calls.filter(c => c.url.includes('/auth/v1/token'));
  ok('load() refreshed first: one request', tok.length === 1);
  ok('a POST to /auth/v1/token?grant_type=refresh_token with the apikey and the stored refresh token',
     !!tok[0] && tok[0].url === 'https://abcref.supabase.co/auth/v1/token?grant_type=refresh_token' && tok[0].init.method === 'POST' &&
     tok[0].init.headers.apikey === 'sb_publishable_test' && JSON.parse(tok[0].init.body).refresh_token === 'r-u1');
  const saved = JSON.parse(LS.getItem(TOKEN_KEY));
  ok('written back in the SDK\'s own shape, expires_at worked out', saved.access_token === 'new-1' && saved.refresh_token === 'r-u1-next' &&
     saved.token_type === 'bearer' && saved.expires_in === 3600 &&
     Math.abs(saved.expires_at - (Math.floor(Date.now() / 1000) + 3600)) <= 2 && saved.user && saved.user.id === 'u1',
     JSON.stringify(saved));
  ok('access_state was asked with the NEW token', srv.calls.find(c => c.url.endsWith('/rpc/access_state')).init.headers.Authorization === 'Bearer new-1');
  ok('so a member is still a member', st.known && st.canView === true && A.canView('L1') === true && A.session().token === 'new-1');
  ok('the lock is released', LS.getItem(LOCK_KEY) === null);
  await A.load({ leagueId: 'L1', force: true });
  ok('a live token is not refreshed again', srv.count('/auth/v1/token') === 1);
}
{
  fresh(); signInExpired();
  const srv = fakeServer([entry('L1'), entry('L2')], { refreshDelay: 30, noUser: true });
  A._test.transport(srv);
  await Promise.all([A.load({ leagueId: 'L1' }), A.load({ leagueId: 'L2' }), A.sessionReady()]);
  ok('three callers at once share one refresh', srv.count('/auth/v1/token') === 1);
  ok('an answer without the user keeps the stored user', JSON.parse(LS.getItem(TOKEN_KEY)).user.id === 'u1' && A.session().userId === 'u1');
}
{
  fresh(); signInExpired(); A._test.deadline(1500);
  LS.setItem(LOCK_KEY, JSON.stringify({ id: 'another-tab', at: Date.now() }));
  const srv = fakeServer([]);
  A._test.transport(srv);
  setTimeout(() => { signIn('u1', 'from-another-tab'); LS.removeItem(LOCK_KEY); }, 120);
  const s = await A.sessionReady();
  ok('another tab holds the lock: this one waits and takes what that tab wrote, asking nothing',
     s && s.token === 'from-another-tab' && srv.count('/auth/v1/token') === 0);
}
{
  fresh(); signInExpired();
  LS.setItem(LOCK_KEY, JSON.stringify({ id: 'a-tab-that-died', at: Date.now() - 11000 }));
  const srv = fakeServer([]);
  A._test.transport(srv);
  const s = await A.sessionReady();
  ok('a lock older than ten seconds is taken over', s && s.token === 'new-1' && srv.count('/auth/v1/token') === 1 && LS.getItem(LOCK_KEY) === null);
}
{
  fresh(); signInExpired();
  const srv = fakeServer([], { refreshDelay: 80 });
  A._test.transport(srv);
  const p = A.sessionReady();
  setTimeout(signOut, 20);
  const s = await p;
  ok('signed out in another tab mid-refresh: the answer does not sign them back in', s === null && LS.getItem(TOKEN_KEY) === null);
}
{
  fresh(); signInExpired();
  const srv = fakeServer([entry('L1', { access_mode: 'members', can_view: false })], { refreshStatus: 400 });
  A._test.transport(srv);
  const st = await A.load({ leagueId: 'L1' });
  ok('a refused refresh token: signed out, the stored session left exactly as it was',
     A.session() === null && JSON.parse(LS.getItem(TOKEN_KEY)).access_token === 'old-u1' && LS.getItem(LOCK_KEY) === null);
  ok('...and the state asked as the stranger this tab now is', st.known && !srv.calls.find(c => c.url.endsWith('/rpc/access_state')).init.headers.Authorization);
  await A.load({ leagueId: 'L1', force: true });
  ok('the refused token is not offered again from this page', srv.count('/auth/v1/token') === 1);
}
{
  fresh(); signInExpired(); A._test.deadline(80);
  const srv = fakeServer([entry('L1')], { refreshHang: true });
  A._test.transport(srv);
  const t0 = Date.now();
  const st = await A.load({ leagueId: 'L1' });
  ok('a refresh that never answers gives up inside the deadline', Date.now() - t0 < 1000 && st.analyticsOk === true, (Date.now() - t0) + 'ms');
  ok('...leaving storage alone and the lock free', JSON.parse(LS.getItem(TOKEN_KEY)).access_token === 'old-u1' && LS.getItem(LOCK_KEY) === null);
  const t1 = Date.now();
  await A.load({ leagueId: 'L1', force: true });
  ok('the next load within thirty seconds does not wait on the same dead server again',
     srv.count('/auth/v1/token') === 1 && Date.now() - t1 < 1000);
}
{
  fresh(); signInExpired();
  const srv = fakeServer([entry('L1')]);
  A._test.transport(srv);
  let asked = 0;
  globalThis.supabase = {};
  globalThis.epinoiaClientReady = async () => ({ auth: { getSession: async () => { asked++; signIn('u1', 'sdk-token'); return { data: { session: {} } }; } } });
  const s = await A.sessionReady();
  ok('a page carrying the SDK lets getSession() refresh, and sends nothing of its own',
     asked === 1 && s && s.token === 'sdk-token' && srv.count('/auth/v1/token') === 0);
  delete globalThis.supabase; delete globalThis.epinoiaClientReady;
}
{
  /* the auth-change check: an hour-old token is not a sign-out */
  fresh(); signIn('u1', 'tok-a');
  const srv = fakeServer([entry('L1', { access_mode: 'members', features: ['league'], can_view: true })], { canViewIf: auth => !!auth });
  A._test.transport(srv);
  await A.load({ leagueId: 'L1' });
  A._test.setAuthSig(A._test.sig());
  const seen = [];
  A.onChange(d => seen.push(d.reason));
  signInExpired('u1', 'tok-a', 'r-u1');
  eq('a refreshable expired token signs as expired, not signed-out', A._test.sig(), 'u1|expired');
  ok('the check takes it as handled and announces nothing yet', A._test.checkAuth() === true && seen.length === 0);
  await pause(60);                       // nobody else asks: the check itself must refresh
  ok('the check itself refreshed: one request', srv.count('/auth/v1/token') === 1);
  ok('once refreshed: no sign-out was announced', !seen.includes('auth'), JSON.stringify(seen));
  ok('...the member is still a member, on the new token', A.canView('L1') === true && A.get('L1').known && A.session().token === 'new-1');
  ok('...and access_state was never asked as a stranger meanwhile',
     srv.calls.filter(c => c.url.endsWith('/rpc/access_state')).every(c => c.init.headers.Authorization));

  fresh(); signIn('u1', 'tok-a');
  const srv2 = fakeServer([entry('L1', { access_mode: 'members', features: ['league'], can_view: true })],
                          { canViewIf: auth => !!auth, refreshStatus: 400 });
  A._test.transport(srv2);
  await A.load({ leagueId: 'L1' });
  A._test.setAuthSig(A._test.sig());
  const seen2 = [];
  A.onChange(d => seen2.push(d.reason));
  signInExpired('u1', 'tok-a', 'r-u1');
  A._test.checkAuth();
  await pause(60);
  ok('a refresh the server refuses IS a sign-out: announced, and asked again as a stranger',
     seen2.includes('auth') && A.canView('L1') === false && A.get('L1').signedIn === false, JSON.stringify(seen2));
}

/* ================================================ a failed re-ask changes nothing === */
console.log('\na failed re-ask keeps the known answer');
for (const [what, opts] of [['a 500', { status: 500 }], ['a timeout', { hang: true }], ['a dropped connection', { throws: true }],
                            ['a 404 (as if the function vanished)', { status: 404, code: 'PGRST202' }]]) {
  fresh(); signIn(); A._test.deadline(80);
  const walled = [entry('L1', { access_mode: 'members', can_view: false, analytics: 'members', analytics_ok: false })];
  A._test.transport(fakeServer(walled));
  await A.load({ leagueId: 'L1' });
  const seen = [];
  A.onChange(d => seen.push(d.reason));
  A._test.transport(fakeServer(walled, opts));
  const st = await A.load({ leagueId: 'L1', force: true });
  ok(what + ': still known, still walled, analytics still locked', st.known && A.get('L1').known &&
     A.canView('L1') === false && A.analyticsOk('L1') === false, JSON.stringify(st));
  eq(what + ': nothing announced', seen, []);
}
{
  fresh(); A._test.deadline(80);
  A._test.transport(fakeServer([], { status: 500 }));
  const st = await A.load({ leagueId: 'L1' });
  ok('with no known answer to keep, a failure is still the fail-open state', st.known === false && A.canView('L1') && A.analyticsOk('L1'));
  A._test.transport(fakeServer([entry('L1', { access_mode: 'members', can_view: false })]));
  await A.load({ leagueId: 'L1', force: true });
  ok('...and a later success replaces it', A.get('L1').known && A.canView('L1') === false);
}

A._test.transport(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
