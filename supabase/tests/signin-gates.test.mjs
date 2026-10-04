/* ============================================================================
   WHAT A MEMBERSHIP WILL OPEN NEEDS AN ACCOUNT FIRST (access.js signinFirst, memlock.js, 2026-10-04).

     * signed out, every lockable feature (WOWY and the lineups, the reports, shot zones, the premium table columns, the
       CSV...) is locked whether memberships are switched on or not, and says why: 'signin';
     * never on a game page or an embed (the box score and the game report stay as they are), never the box score's own
       tabs, and never a members-only league's own wall; signed in (or holding a token a refresh can renew) nothing
       changes;
     * the card: a picture, "Sign in to see this", what needs the account ("Pairs need an EPINOIA account."), what an
       account opens, one button to the sign-in page that brings the reader back; the compact line; the placeholder over
       the blurred rows; the box a press on a locked control opens (Esc and "Not now" close it);
     * every statistics table's views past MISC (players) and TOTALS (clubs) are part of the lock, on the league tables,
       the player profile's and global scouting's (fulltable.js presetLocked, global.js lockedColumns);
     * the wording: the console can edit it, Japanese and Spanish have it.

     node supabase/tests/signin-gates.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(d).slice(0, 600) : '')); } };

/* ------------------------------------------------------------------ a page --- */
const REF = 'hhvofgqqadtyvcjudhjx';
function page({ path: p = '/epinoia/t/', session = null } = {}) {
  const store = new Map(), sess = new Map();
  if (session) store.set('sb-' + REF + '-auth-token', JSON.stringify(session));
  const mk = tag => {
    const e = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, dataset: {}, style: {}, _text: '', className: '', listeners: {},
      get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }, set textContent(v) { this._text = String(v); this.children = []; },
      innerHTML: '', setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {}, focus() { doc.activeElement = this; },
      contains(x) { return x === this || this.children.some(c => c.contains && c.contains(x)); },
      classList: null };
    const cls = new Set();
    e.classList = { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; } };
    Object.defineProperty(e, 'className', { get: () => [...cls].join(' '), set: v => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); } });
    return e;
  };
  const docListeners = {};
  const doc = {
    readyState: 'complete', currentScript: { src: 'https://example.test/epinoia/access.js?v=1' },
    createElement: mk, body: null, head: mk('head'), activeElement: null,
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); }, removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
  };
  doc.body = mk('body');
  const win = {
    location: { pathname: p, search: '', href: 'https://example.test' + p, origin: 'https://example.test' },
    EPINOIA_CONFIG: { supabaseUrl: 'https://' + REF + '.supabase.co', supabaseAnonKey: 'k' },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: k => sess.has(k) ? sess.get(k) : null, setItem: (k, v) => sess.set(k, String(v)), removeItem: k => sess.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    getComputedStyle: () => ({ zoom: '1' }), innerWidth: 1200, innerHeight: 800,
    setTimeout, clearTimeout, setInterval: () => 0, URL, URLSearchParams, console: { warn() {}, log() {} }
  };
  win.window = win; win.document = doc; win.self = win;
  const ctx = vm.createContext(Object.assign(win, { Object, String, Number, Array, Map, Set, WeakMap, Promise, RegExp, Error, JSON, Date, Math, Symbol }));
  ctx.globalThis = ctx;
  vm.runInContext(rd('epinoia', 'access.js'), ctx, { filename: 'access.js' });
  vm.runInContext(rd('epinoia', 'memlock.js'), ctx, { filename: 'memlock.js' });
  return { A: ctx.EpinoiaAccess, M: ctx.EpinoiaMemLock, doc, docListeners };
}
const valid = { access_token: 'a.b.c', refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'x@example.invalid' } };
const stale = { access_token: 'a.b.c', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) - 60, user: { id: 'u1', email: 'x@example.invalid' } };

console.log('who must sign in first');
{
  const { A } = page();
  ok('signed out on a club page: an account comes first', A.signinFirst() === true);
  const keys = Object.keys(A.CATALOGUE.locks).filter(k => ['gameFlow', 'gameConnections', 'gameAdvanced', 'gameReport'].indexOf(k) < 0);
  ok('...every lockable feature is locked and says sign in (WOWY, lineups, both reports, shot zones, the columns, the CSV, What wins...)',
     keys.length >= 12 && keys.every(k => A.featureLocked(k, 'L1') && A.lockReason(k, 'L1') === 'signin') && ['wowy', 'lineups', 'clubReport', 'playerReport', 'statColumns', 'csv', 'model'].every(k => keys.includes(k)),
     keys.filter(k => !A.featureLocked(k, 'L1')).join());
  ok('...but never the box score\'s own tabs', ['gameFlow', 'gameConnections', 'gameAdvanced'].every(k => !A.featureLocked(k, 'L1') && A.lockReason(k, 'L1') === null));
  ok('...and an unknown key stays free', A.featureLocked('nothing-like-this', 'L1') === false && A.signinFirst('league') === false);
}
{
  const { A } = page({ path: '/epinoia/game/' });
  ok('on the game page nothing asks for an account (the box score and the game report stay as they are)', A.signinFirst() === false && !A.featureLocked('clubReport', 'L1') && !A.featureLocked('events', 'L1'));
  const e = page({ path: '/epinoia/embed/game/' }).A;
  ok('...nor in an embed', e.signinFirst() === false && !e.featureLocked('wowy', 'L1'));
}
{
  const { A } = page({ session: valid });
  ok('signed in: nothing asks, and a feature is what the membership answer says (fails open with no answer)', A.signinFirst() === false && !A.featureLocked('wowy', 'L1') && A.lockReason('wowy', 'L1') === null);
  const s = page({ session: stale }).A;
  ok('a token that has run out but can be refreshed counts as signed in (no flash of the prompt)', s.signinFirst() === false && !s.featureLocked('lineups', 'L1'));
  const dead = page({ session: Object.assign({}, stale, { refresh_token: '' }) }).A;
  ok('...one that cannot be refreshed does not', dead.signinFirst() === true);
}

console.log('\nthe card');
{
  const { A } = page();
  const h = A.teaserHTML({ leagueSlug: 'slb-men', title: 'Pairs are for members', lines: ['Pick two players.'] });
  ok('a teaser, signed out, is the sign-in card: the picture, the title, what needs the account, what an account opens, the button',
     /class="ep-lock ep-lock-signin"/.test(h) && /<svg class="ep-in-art"/.test(h) && />Sign in to see this</.test(h) && /Pairs need an EPINOIA account\./.test(h)
     && /An account opens WOWY and the lineups/.test(h) && /class="ep-in-go" href="\/epinoia\/signin\/\?next=%2Fepinoia%2Ft%2F"/.test(h) && /Pick two players\./.test(h), h);
  ok('...and nothing for sale on it (one thing to do)', !/ep-lock-go/.test(h) && !/data-lock=/.test(h));
  ok('"is for members" names one thing: needs', /The club report needs an EPINOIA account\./.test(A.teaserHTML({ title: 'The club report is for members' })));
  ok('a section named by its key reads the lock\'s label', /Shot zones need an EPINOIA account\./.test(A.teaserHTML({ key: 'shotZones', title: 'Shot zones' })));
  ok('the page may name it outright', /The everything view needs an EPINOIA account\./.test(A.teaserHTML({ title: 'everything', what: 'The everything view' })));
  const c = A.teaserHTML({ compact: true, title: 'A preview: 1 player at a time. Members compare up to 4 at once.', signinTitle: 'A preview: 1 player at a time. Sign in to compare up to 4 at once.' });
  ok('the compact line says its own sign-in words and carries the button', /ep-lock-compact ep-lock-signin/.test(c) && /Sign in to compare up to 4 at once\./.test(c) && /class="ep-in-go"/.test(c), c);
  ok('a members-only league\'s own banner (key "league") stays the membership teaser', !/ep-lock-signin/.test(A.teaserHTML({ compact: true, key: 'league', title: 'Results and box scores for X are for members. Upcoming fixtures stay free to everyone.' })));
  const signedIn = page({ session: valid }).A.teaserHTML({ title: 'Pairs are for members' });
  ok('signed in, the membership teaser as before', !/ep-lock-signin/.test(signedIn) && /Pairs are for members/.test(signedIn));
  ok('the words are the console\'s to change (COPY), with a label each', ['signinTitle', 'signinLead', 'signinAll', 'signinTip'].every(k => typeof A.COPY[k] === 'string' && A.COPY[k])
     && ['signinTitle:', 'signinLead:', 'signinAll:', 'signinTip:'].every(k => rd('epinoia', 'admin', 'platform', 'platform.js').includes('  ' + k)));
}

console.log('\nthe placeholder, the popup and the box');
{
  const { A, M, doc, docListeners } = page();
  const ph = M.placeholder({ what: 'Lineups', plural: true, rows: 4 });
  const text = JSON.stringify(ph, (k, v) => (k === 'parentNode' ? undefined : v));
  ok('the placeholder, signed out: the picture, "Sign in to see this", what needs the account, the button',
     ph.classList.contains('mem-ph-in') && /ep-in-art/.test(text) && /Sign in to see this/.test(text) && /Lineups need an EPINOIA account\./.test(text) && /ep-in-go/.test(text), text.slice(0, 400));
  const btn = doc.createElement('button'); btn._text = 'CSV';
  M.lock(btn, { what: 'CSV download' });
  ok('a locked control, signed out, is a way in (pointer, not the stop sign)', btn.classList.contains('mem-lock') && btn.classList.contains('mem-in'));
  /* the lock's own listener is the last one on the document (access.js has its payment window's before it) */
  const click = (docListeners.click || []).slice(-1)[0];
  try { click({ target: btn, preventDefault() {}, stopImmediatePropagation() {} }); } catch (e) { console.log('  (press threw: ' + e.message + ')'); }
  const box = doc.body.children.find(c => c.className === 'mem-ask-back');
  const bt = box ? JSON.stringify(box, (k, v) => (k === 'parentNode' ? undefined : v)) : '';
  ok('pressing it opens the sign-in box: a dialog with the picture, what needs the account, what an account opens, Sign in and Not now',
     !!box && /"role":"dialog"/.test(bt) && /ep-in-art/.test(bt) && /CSV download needs an EPINOIA account\./.test(bt) && /An account opens WOWY/.test(bt) && /Sign in/.test(bt) && /Not now/.test(bt), bt.slice(0, 300));
  const esc = (docListeners.keydown || []).slice(-1)[0];
  esc({ key: 'Escape', preventDefault() {} });
  ok('...Esc closes it', !doc.body.children.some(c => c.className === 'mem-ask-back'));
  M.askSignIn({ what: 'Rotations', plural: true });
  const again = doc.body.children.find(c => c.className === 'mem-ask-back');
  const no = again && again.children[0].children.find(c => c.className === 'mem-ask-row').children[1];
  no.listeners.click[0]();
  ok('...and so does "Not now"', !doc.body.children.some(c => c.className === 'mem-ask-back'));
  const signedIn = page({ session: valid });
  const ph2 = signedIn.M.placeholder({ what: 'Lineups' });
  ok('signed in, the placeholder is the membership one as before', !ph2.classList.contains('mem-ph-in') && /ACCESS IS MEMBERSHIP-ONLY/.test(JSON.stringify(ph2, (k, v) => (k === 'parentNode' ? undefined : v))));
}

console.log('\nthe statistics tables');
{
  const { A } = page();
  const ft = rd('epinoia', 'fulltable.js'), gl = rd('epinoia', 'global.js');
  ok('the catalogue says where the free views end: MISC for players, TOTALS for clubs', A.CATALOGUE.freeThrough.player === 'misc' && A.CATALOGUE.freeThrough.team === 'totals');
  ok('every table locks the views past it (league tables, the player profile\'s, scouting\'s), everything included',
     /C\.freeThrough\[isTeam \? 'team' : 'player'\]/.test(ft) && /if \(cut >= 0 && at > cut\) return true;\s*\n\s*if \(key === '\*'\) return false;/.test(ft));
  ok('global scouting locks its premium columns for a signed-out reader too', /A\.signinFirst\('statColumns'\)/.test(gl) && /const locks = signin \|\| /.test(gl));
  ok('a club table\'s views past TOTALS are the zones, the events and everything', (() => {
    const src = ft.slice(ft.indexOf('  team: ['), ft.indexOf(']\n};', ft.indexOf('  team: [')));
    const keys = [...src.matchAll(/\['([^']+)',/g)].map(m => m[1]);
    const cut = keys.indexOf('totals');
    return cut > 0 && keys.slice(cut + 1).join() === 'z_rim,z_mid,z_three,z_cuts,z_rate,*' && /\.\.\.EV_PRESETS,\s*\n\s*\['\*',\s+'everything'\]\s*\n\s*\]\s*$/.test(src.trim() + '\n]');
  })());
}

console.log('\nthe pages');
{
  const wowy = rd('epinoia', 'stats', 'wowy', 'wowyui.js'), rep = rd('epinoia', 'report.js'), fix = rd('epinoia', 'fixtures', 'fixtures.js');
  ok('WOWY\'s own lock notes say sign in, signed out', /sign in to see it\./.test(wowy) && /Play-by-play stats: sign in to see them/.test(wowy));
  ok('the report tab\'s hint says why it is shut', /why === 'signin' \? ': sign in to see it' : ': for members'/.test(rep));
  ok('the fixtures\' members-only banner keeps the membership words', /key: 'league'/.test(fix));
  const css = rd('epinoia', 'kit', 'access.css');
  ok('the sign-in button is never hidden in the iPhone app (it sells nothing)', /\.ep-in-go\{/.test(css) && !/m-ios-app[^{]*\.ep-in-go/.test(css));
  for (const L of ['ja', 'es']) {
    const core = rd('epinoia', 'i18n', L + '.js');
    ok(L + ': the card, the box and the refusal are translated, and the sentence "X needs an EPINOIA account."',
       ['Sign in to see this', 'Sign in to use this', 'Not now', 'This account has been disabled'].every(s => core.toLowerCase().includes("'" + s.toLowerCase() + "'")) && /needs\? an EPINOIA account/.test(core));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
