/* ============================================================================
   THE RAIL'S BACK VIEW NAMES THE RIGHT COUNTRY, EVEN FOR A PAGE THAT LEARNS ITS
   LEAGUE LATE.

   `country` starts at `null` — the sentinel drawLeagues() reads as "every league of
   every country" and fillCountryHead() labels "Not yet filed" — and fillLeagues()
   only resolves it away from null when (lg || pageLeague) already names a real
   league AT FETCH TIME. Most pages have ?l= in the address before nav.js runs, so
   this settles immediately. The game page does not: it resolves its league from the
   network and only then sets window.__CS_LEAGUE_SLUG, which can land after nav.js's
   own leagues fetch has already finished and drawn the panel with `country` still
   null. Scrolling back out of the league rail then landed on "Not yet filed",
   showing every league on the platform rather than the one the page is actually
   about (reported 2026-09-18).

   Run against nav.js in a stub DOM, in the order the bug actually needs: the
   leagues fetch resolves FIRST (with no league named yet), and __CS_LEAGUE_SLUG is
   set only AFTER — the ordering the synchronous rail() helper in home-links.test.mjs
   cannot reach, because its `after` hook runs before any pending fetch settles.

     node supabase/tests/rail-country-settle.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const NAV = rd('epinoia', 'nav.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const tick = () => new Promise(r => setTimeout(r, 0));

/* -------------------------------------------------------- a bare-bones stub DOM --
   Just enough of the DOM for nav.js's one big IIFE to run start to finish: element
   creation, classList, append/query, and a body to hold what it builds. Modelled on
   home-links.test.mjs's own El/rail() — this file needs its own copy because it
   drives a real, controllable fetch and awaits it before the rest of the test runs,
   which that file's synchronous `after` hook cannot do. */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parent = null;
    this.cls = new Set(); this.dataset = {}; this.attrs = {};
    this.ownText = ''; this.listeners = {};
    this.style = { setProperty() {}, transition: '', height: '' };
    this.offsetHeight = 0; this.scrollWidth = 0; this.clientWidth = 0; this.scrollTop = 0;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self.cls.add(x)),
      remove: (...c) => c.forEach(x => self.cls.delete(x)),
      contains: c => self.cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on;
        if (want) self.cls.add(c); else self.cls.delete(c); return want; }
    };
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.ownText + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.ownText = v == null ? '' : String(v); }
  set innerHTML(v) { this.textContent = ''; this.html = v; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? Object.assign(new El('#text'), { ownText: n }) : n)); }
  appendChild(n) { if (n.parent) n.remove(); n.parent = this; this.children.push(n); return n; }
  insertBefore(n, ref) { if (n.parent) n.remove(); n.parent = this; const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parent) { const p = this.parent; p.children = p.children.filter(c => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  querySelector() { return null; }
  querySelectorAll(sel) { return this.all().filter(n => sel === 'a[data-league-slug]' ? n.tagName === 'A' && 'leagueSlug' in n.dataset : false); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest() { return null; }
  focus() {}
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
const byClass = (root, c) => root.all().filter(n => n.cls.has(c));

/* Two leagues, two countries — so "every league" and "just this one's country"
   are observably different results, and one league (the-page-s-own) is what a
   page that resolves its league from the network eventually names. */
const LEAGUES = [
  { id: '1', slug: 'czech-nbl', name: 'Kooperativa NBL', colour_a: '#111', colour_b: '#222',
    colour_source: 'default', theme: null, logo_path: null, country: 'CZ', nav: null },
  { id: '2', slug: 'euroleague', name: 'EuroLeague', colour_a: '#333', colour_b: '#444',
    colour_source: 'default', theme: null, logo_path: null, country: 'ES', nav: null }
];

function rail(url, { fetchImpl } = {}) {
  const u = new URL(url, 'https://prophesyscouting.co.uk');
  const body = new El('body');
  const store = new Map();
  const ctx = {
    URLSearchParams, JSON, Number, Date, String, RegExp, Object, Promise, Math, Array, Error, Intl,
    console,
    location: { pathname: u.pathname, search: u.search, hash: u.hash, protocol: 'https:', origin: u.origin },
    navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false }),
    fetch: fetchImpl || (() => Promise.reject(new Error('offline'))),
    addEventListener() {},
    EPINOIA_CONFIG: { supabaseUrl: 'https://ref.supabase.co', supabaseAnonKey: 'anon' },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      createElement: t => new El(t),
      documentElement: { classList: { contains: () => false }, style: {}, setAttribute() {}, removeAttribute() {} },
      body,
      head: new El('head'),
      currentScript: { src: 'https://prophesyscouting.co.uk/epinoia/nav.js?v=301' },
      addEventListener() {},
      hidden: false
    }
  };
  ctx.window = ctx;
  ctx.window.matchMedia = ctx.matchMedia;
  vm.createContext(ctx);
  vm.runInContext(NAV, ctx, { filename: 'nav.js' });
  const nav = body.children.find(n => n.cls.has('ep-nav')) || null;
  const cname = nav ? byClass(nav, 'lname').find(a => a.parent && a.parent.parent && a.parent.parent.cls.has('rootpanel')) : null;
  /* two elements carry class "leagues": clist (the country picker) and list (the leagues
     UNDER one country) — list is rootpanel's own child, clist is countrypanel's. */
  const list = nav ? byClass(nav, 'leagues').find(n => n.parent && n.parent.cls.has('rootpanel')) : null;
  return { ctx, nav, cname, list };
}

console.log('\n-- a page that names its league only AFTER the leagues fetch has already resolved');

/* THE GAME PAGE'S OWN SHAPE: no ?l= in the address, so nav.js's fetch resolves with
   (lg || pageLeague) === '' — country cannot settle from fillLeagues() alone, exactly
   as it could not for the real Czech NBL game this bug was found on. */
{
  const r = rail('/epinoia/game/?g=81c0e6c5-5701-47fb-a36a-5639e612db6b', {
    fetchImpl: async () => ({ ok: true, json: async () => LEAGUES })
  });
  await tick(); await tick(); await tick();     // let fillLeagues()'s fetch resolve fully

  ok('before the page names its league: the header already reads "Not yet filed"',
     r.cname && r.cname.textContent.includes('Not yet filed'), r.cname && r.cname.textContent);
  const rowsBefore = r.list ? byClass(r.list, 'lrow').length : -1;
  ok('...and the list holds every league on the platform, not one country\'s',
     rowsBefore === LEAGUES.length, rowsBefore);

  /* the page's own script resolves its league from the network, late */
  r.ctx.window.__CS_LEAGUE_SLUG = 'czech-nbl';
  await tick();

  const czName = new Intl.DisplayNames(undefined, { type: 'region' }).of('CZ');
  ok('once the page names its league: the header settles to THAT league\'s country',
     r.cname && r.cname.textContent.includes(czName), r.cname && r.cname.textContent);
  const rowsAfter = r.list ? byClass(r.list, 'lrow').length : -1;
  ok('...and the list narrows to just that country\'s leagues (one, not two)',
     rowsAfter === 1, rowsAfter);
  const only = r.list ? byClass(r.list, 'lrow')[0] : null;
  ok('...specifically the page\'s own league',
     only && only.dataset.leagueSlug === 'czech-nbl', only && only.dataset);
}

console.log('\n-- unaffected: a page with ?l= in the address settles immediately, as before');
{
  const r = rail('/epinoia/game/?g=x&l=czech-nbl', {
    fetchImpl: async () => ({ ok: true, json: async () => LEAGUES })
  });
  await tick(); await tick(); await tick();
  ok('the header is already the right country before anything sets __CS_LEAGUE_SLUG',
     r.cname && !r.cname.textContent.includes('Not yet filed'), r.cname && r.cname.textContent);
  const rows = r.list ? byClass(r.list, 'lrow').length : -1;
  ok('...and the list is already narrowed to one league', rows === 1, rows);
}

console.log('\n-- unaffected: a page never told a league at all stays on "every league"');
{
  const r = rail('/epinoia/home/', {
    fetchImpl: async () => ({ ok: true, json: async () => LEAGUES })
  });
  await tick(); await tick(); await tick();
  const rows = r.list ? byClass(r.list, 'lrow').length : -1;
  ok('HOME never narrows the rail to one country on its own',
     rows === LEAGUES.length, rows);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
