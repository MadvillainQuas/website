/* ============================================================================
   EVERY WAY HOME LEADS HOME.

   The logotype means one place: /epinoia/home/, on the web and in the app. The
   splash is still at /epinoia/ for anybody who types it, but nothing the
   platform draws should send a reader back to the water. This holds that in
   place across the files that draw a way home:

     1. every top-left EPINOIΛ wordmark that is a link, on every page under
        /epinoia/ (the league front page's hero and the fixture strip's plate
        included), resolves to /epinoia/home/, and none of them is an
        inline-styled chip that the light theme cannot reach;
     2. the rail (nav.js, run in node against a stub DOM): the HOME heading,
        highlighted on HOME; the country header to HOME's leagues; the foot's
        HOME row first in the foot; the platform tab bar on pages with no league;
        the league's own tab renamed "league"; HOME, games and scouting never
        treated as a league's pages, even with ?l= in the address;
     3. what tests elsewhere pin in nav.js is still byte-identical;
     4. "all games" and "box scores" go to the global fixtures page;
     5. the old countries addresses redirect to HOME's leagues, and the splash's
        "Browse leagues" goes there too;
     6. links in our own embeds navigate the page when one of our pages frames
        them, and open a tab on anybody else's site.

     node supabase/tests/home-links.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
/* line endings folded to \n: the checkout may carry CRLF, and a pinned line is the same line either way */
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* ------------------------------------------------------------------ 1 --- */
console.log('\n-- every wordmark link goes to HOME');

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...htmlFiles(p));
    else if (name === 'index.html') out.push(p);
  }
  return out;
}

const EP = path.join(ROOT, 'epinoia');
const ANCHOR = /<a\b([^>]*)>((?:(?!<\/a>)[\s\S])*?)<\/a>/g;
const marks = [];
for (const file of htmlFiles(EP)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = readFileSync(file, 'utf8');
  let m;
  ANCHOR.lastIndex = 0;
  while ((m = ANCHOR.exec(src))) {
    const [, attrs, inner] = m;
    if (!/EPINOIΛ/.test(inner)) continue;
    if (!/epinoia-mark/.test(attrs + inner)) continue;
    const href = (/\bhref="([^"]*)"/.exec(attrs) || [])[1];
    const page = new URL('https://prophesyscouting.co.uk/' + rel);
    const to = href == null ? null : new URL(href, page).pathname;
    marks.push({ rel, href, to, attrs, inner });
  }
}

ok('found every wordmark link (22 pages, the league hero and the strip plate)', marks.length >= 24,
   marks.length + ': ' + marks.map(x => x.rel).join(', '));
const wrong = marks.filter(x => x.to !== '/epinoia/home/');
ok('each one resolves to /epinoia/home/', wrong.length === 0,
   wrong.map(x => x.rel + ' -> ' + x.href).join('\n          '));
[
  'epinoia/index.html', 'epinoia/fixtures/index.html', 'epinoia/stats/index.html',
  'epinoia/stats/wowy/index.html', 'epinoia/l/index.html', 'epinoia/t/index.html',
  'epinoia/p/index.html', 'epinoia/news/index.html', 'epinoia/signin/index.html',
  'epinoia/contact/index.html', 'epinoia/me/index.html', 'epinoia/join/index.html',
  'epinoia/learn/index.html', 'epinoia/privacy/index.html', 'epinoia/prophesy/index.html',
  'epinoia/api/index.html', 'epinoia/admin/index.html', 'epinoia/admin/platform/index.html',
  'epinoia/app/index.html', 'epinoia/edit/index.html', 'epinoia/clockcam/index.html',
  'epinoia/broadcast/help/index.html', 'epinoia/game/index.html', 'epinoia/embed/strip/index.html'
].forEach(f => ok(f + ' has a wordmark link to HOME', marks.some(x => x.rel === f && x.to === '/epinoia/home/')));

/* THE FIVE INLINE CHIPS. A style attribute carries its own colour, so the light theme's
   ":root[data-theme=light] .wm" could never reach them. */
const chips = ['stats', 'l', 't', 'me', 'app'].map(d => marks.find(x => x.rel === 'epinoia/' + d + '/index.html'));
chips.forEach((x, i) => {
  const d = ['stats', 'l', 't', 'me', 'app'][i];
  const markTag = x && (/<span\b[^>]*epinoia-mark[^>]*>/.exec(x.inner) || [])[0] || (x && '<a' + x.attrs + '>');
  ok(d + '/: the chip is class="wm epinoia-mark" with no inline style',
     !!markTag && /class="wm epinoia-mark"/.test(markTag) && !/style=/.test(markTag), markTag);
});

/* ------------------------------------------------------------------ 2 --- */
console.log('\n-- the rail (nav.js in a stub DOM)');

const NAV = rd('epinoia', 'nav.js');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parent = null;
    this.cls = new Set(); this.dataset = {}; this.attrs = {}; this.hidden = false;
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
  querySelectorAll(sel) { return this.all().filter(n => sel === 'a.item' ? n.tagName === 'A' && n.cls.has('item') : false); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest() { return null; }
  focus() {}
  click() { (this.listeners.click || []).forEach(f => f({ defaultPrevented: false, button: 0, preventDefault() {} })); }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
const byClass = (root, c) => root.all().filter(n => n.cls.has(c));

function rail(url, o = {}) {
  const u = new URL(url, 'https://prophesyscouting.co.uk');
  const body = new El('body');
  const htmlCls = new Set(o.htmlClasses || []);
  const store = new Map();
  const ctx = {
    URLSearchParams, JSON, Number, Date, String, RegExp, Object, Promise, Math, Array, Error,
    console,
    location: { pathname: u.pathname, search: u.search, hash: u.hash, protocol: 'https:', origin: u.origin },
    navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false }),
    fetch: () => Promise.reject(new Error('offline')),
    addEventListener() {},
    document: {
      querySelector: () => null,
      getElementById: () => null,
      createElement: t => new El(t),
      documentElement: { classList: { contains: c => htmlCls.has(c) }, style: {}, setAttribute() {}, removeAttribute() {} },
      body,
      head: new El('head'),
      currentScript: { src: 'https://prophesyscouting.co.uk/epinoia/nav.js?v=272' },
      addEventListener() {},
      hidden: false
    }
  };
  ctx.window = ctx;
  ctx.window.matchMedia = ctx.matchMedia;
  vm.createContext(ctx);
  if (o.before) o.before(ctx);
  vm.runInContext(NAV, ctx, { filename: 'nav.js' });
  if (o.after) o.after(ctx);
  const nav = body.children.find(n => n.cls.has('ep-nav')) || null;
  const tabbar = nav && byClass(nav, 'ep-tabbar')[0];
  const tabs = tabbar ? tabbar.children.map(a => ({
    href: a.href, tx: (byClass(a, 'tx')[0] || {}).textContent, on: a.cls.has('on')
  })) : [];
  const foot = nav && byClass(nav, 'ep-nav-foot')[0];
  const ptitles = nav ? byClass(nav, 'ptitle') : [];
  /* the country panel's heading, wherever it sits inside that panel — it is in
     a head beside a back chevron since the platform layer went in front */
  const within = (n, c) => { for (let x = n; x; x = x.parent) if (x.cls.has(c)) return true; return false; };
  const heading = ptitles.find(p => within(p, 'countrypanel'));
  const homeTitle = ptitles.find(p => within(p, 'homepanel'));
  const homeRows = nav
    ? (byClass(nav, 'homepanel')[0] || { all: () => [] }).all()
        .filter(n => n.tagName === 'A' && n.cls.has('item'))
        .map(a => ({ href: a.href, tx: (byClass(a, 'tx')[0] || {}).textContent, on: a.cls.has('on') }))
    : [];
  const cname = nav ? byClass(nav, 'lname').find(a => a.parent && a.parent.parent && a.parent.parent.cls.has('rootpanel')) : null;
  return { ctx, nav, tabs, foot, heading, homeTitle, homeRows, cname, hasTabbar: !!(nav && nav.cls.has('has-tabbar')) };
}

const PLATFORM = ['home', 'games', 'scouting', 'leagues', 'profile'];
{
  const r = rail('/epinoia/home/');
  ok('HOME: the rail is built', !!r.nav);
  eq('HOME: the tab bar is the platform\'s five places', r.tabs.map(t => t.tx), PLATFORM);
  eq('HOME: ...pointing at home, games, scouting, HOME\'s leagues and the profile',
     r.tabs.map(t => t.href), ['../home/', '../games/', '../scouting/', '../home/#leagues', '../me/']);
  eq('HOME: only the home tab is lit', r.tabs.filter(t => t.on).map(t => t.tx), ['home']);
  ok('HOME: the bar is drawn rather than removed (has-tabbar)', r.hasTabbar);
  ok('HOME: the country panel heading reads HOME', r.heading && r.heading.textContent === 'HOME', r.heading && r.heading.textContent);
  ok('HOME: ...links to HOME', r.heading && r.heading.href === '../home/', r.heading && r.heading.href);
  ok('HOME: ...and is highlighted there', r.heading && r.heading.cls.has('on') && r.heading.attrs['aria-current'] === 'page');
  const first = r.foot && r.foot.children[0];
  ok('HOME: the HOME row is the FIRST row of the foot', first && first.cls.has('home-row'), first && first.className);
  ok('HOME: ...links to HOME with the title HOME', first && first.href === '../home/' && first.title === 'HOME');
  ok('HOME: ...in the logotype, after a ⌂',
     first && first.children[0].textContent === '⌂' && first.children[1].cls.has('epinoia-mark') && first.children[1].textContent === 'EPINOIΛ');
  ok('HOME: the country header links to HOME\'s leagues', r.cname && r.cname.href === '../home/#leagues', r.cname && r.cname.href);
}
{
  /* THE PLATFORM LAYER, in front of the countries: what belongs to no league.
     Global scouting used to be a row in the foot, among the rows about YOU. */
  const r = rail('/epinoia/home/');
  ok('the rail starts with a home panel', !!r.homeTitle);
  ok('...headed with the logotype, linking HOME',
     r.homeTitle.href === '../home/' && r.homeTitle.cls.has('epinoia-mark'), r.homeTitle && r.homeTitle.href);
  eq('...holding home, global fixtures, global scouting, the waiver wire, then the leagues',
     r.homeRows.map(x => x.tx), ['home', 'fixtures', 'scouting', 'injury report', 'leagues']);
  eq('...pointing at HOME, global fixtures, global scouting, the wire and the leagues on HOME',
     r.homeRows.map(x => x.href),
     ['../home/', '../games/', '../scouting/', '../injuries/', '../home/#leagues']);
  eq('...with the home row lit on HOME', r.homeRows.filter(x => x.on).map(x => x.tx), ['home']);
  ok('the foot no longer carries a scouting row',
     !r.foot.all().some(n => n.tagName === 'A' && /\/scouting\//.test(n.href || '')));
}
{
  const r = rail('/epinoia/games/');
  eq('global fixtures lights its own row in the home panel',
     r.homeRows.filter(x => x.on).map(x => x.tx), ['fixtures']);
}
{
  const r = rail('/epinoia/scouting/');
  eq('global scouting lights its own row', r.homeRows.filter(x => x.on).map(x => x.tx), ['scouting']);
}
{
  const r = rail('/epinoia/stats/wowy/?l=bcb');
  eq('two folders down, the rows in the home panel climb with it',
     r.homeRows.map(x => x.href),
     ['../../home/', '../../games/', '../../scouting/', '../../injuries/', '../../home/#leagues']);
}
{
  const r = rail('/epinoia/home/?l=bcb');
  eq('HOME with ?l=bcb: still the platform tabs, never a league\'s', r.tabs.map(t => t.tx), PLATFORM);
}
{
  const r = rail('/epinoia/home/', { after: ctx => { ctx.window.__CS_LEAGUE_SLUG = 'bcb'; } });
  eq('HOME: a script naming a league does not turn it into a league page', r.tabs.map(t => t.tx), PLATFORM);
}
{
  const r = rail('/epinoia/games/');
  eq('games: platform tabs, games lit', [r.tabs.map(t => t.tx), r.tabs.filter(t => t.on).map(t => t.tx)], [PLATFORM, ['games']]);
  ok('games: the heading is not highlighted', r.heading && !r.heading.cls.has('on'));
}
{
  const r = rail('/epinoia/scouting/?l=slb');
  eq('scouting with ?l=: platform tabs, scouting lit', [r.tabs.map(t => t.tx), r.tabs.filter(t => t.on).map(t => t.tx)], [PLATFORM, ['scouting']]);
}
{
  const r = rail('/epinoia/me/');
  eq('a page with no league (profile): platform tabs, profile lit', [r.tabs.map(t => t.tx), r.tabs.filter(t => t.on).map(t => t.tx)], [PLATFORM, ['profile']]);
  eq('...hrefs one folder down', r.tabs.map(t => t.href), ['../home/', '../games/', '../scouting/', '../home/#leagues', '../me/']);
}
{
  const r = rail('/epinoia/stats/?l=bcb');
  eq('a league page keeps its own tabs, the first now called "league"', r.tabs.map(t => t.tx),
     ['league', 'fixtures', 'table', 'teams', 'statistics', 'news']);
  eq('...the league tab opens the league front page', r.tabs[0].href, '../?l=bcb');
  eq('...statistics lit', r.tabs.filter(t => t.on).map(t => t.tx), ['statistics']);
  const first = r.foot && r.foot.children[0];
  ok('a league page: the foot\'s first row is HOME', first && first.cls.has('home-row') && first.href === '../home/');
  ok('a league page: the heading is not highlighted', r.heading && !r.heading.cls.has('on'));
}
{
  const r = rail('/epinoia/stats/wowy/?l=bcb');
  const first = r.foot && r.foot.children[0];
  ok('two folders down (wowy): HOME is ../../home/', first && first.href === '../../home/' && r.heading.href === '../../home/');
}
{
  const r = rail('/epinoia/?l=bcb');
  eq('the league front page: its tab is "league" and lit', [r.tabs[0].tx, r.tabs[0].on, r.tabs[0].href], ['league', true, './?l=bcb']);
  ok('the league front page: HOME is ./home/', r.foot.children[0].href === './home/');
}
{
  const r = rail('/epinoia/', { htmlClasses: ['m-splash'], before: ctx => { ctx.document.getElementById = id => (id === 'splash' ? {} : null); } });
  ok('the splash still has no rail', r.nav === null);
}
{
  const r = rail('/epinoia/stats/', { after: ctx => { ctx.window.__CS_LEAGUE_SLUG = 'bcb'; } });
  eq('a league page that learns its league late swaps the platform tabs for the league\'s', r.tabs.map(t => t.tx),
     ['league', 'fixtures', 'table', 'teams', 'statistics', 'news']);
}

/* ------------------------------------------------------------------ 3 --- */
console.log('\n-- what other tests pin in nav.js is unchanged');
ok('the worker registration call', NAV.includes("navigator.serviceWorker.register(root + 'sw.js', { scope: root }).catch(() => {});"));
/* WHICH PATHS ARE IN IT IS league-theme-pages.test.mjs's TO SAY. Pinned here as the literal
   source line, adding a league page (the injury report, 2026-09-18) went red in two files for
   one deliberate change — and this file's interest is only that the rail still has a painter
   and still knows HOME is not a league. */
ok('LEAGUE_PAGE', /const LEAGUE_PAGE = \/\\\/epinoia\\\/\([a-z|]+\)\\\/\/;/.test(NAV));
ok('the splash skip', NAV.includes("const atSplash = document.documentElement.classList.contains('m-splash')\n                   && !!document.getElementById('splash');\n  if (atSplash) return;"));
ok('drawLeagues(); themeLeague();', /drawLeagues\(\);\s*\n\s*themeLeague\(\);/.test(NAV));
ok('nothing in the rail links to countries/ any more', !/'countries\/'/.test(NAV));
{
  /* nav.js's own regex, read out of it rather than copied, so it is the live one being asked */
  const LP = new RegExp((/const LEAGUE_PAGE = \/(.+)\/;/.exec(NAV) || [])[1] || 'x^');
  ok('HOME, games and scouting are not league pages', ['/epinoia/home/', '/epinoia/games/', '/epinoia/scouting/'].every(p => !LP.test(p)));
  ok('the video hub is one', LP.test('/epinoia/video/'));
}
{
  /* THE VIDEO HUB'S ROW IS NOT IN THE PHONE BAR and starts hidden in the rail:
     most leagues have no read broadcast, and nav.js only shows the row once its
     probe finds one (here fetch rejects, which is the offline case). */
  const r = rail('/epinoia/stats/?l=bcb');
  eq('the league tab bar is unchanged by the video hub', r.tabs.map(t => t.tx),
     ['league', 'fixtures', 'table', 'teams', 'statistics', 'news']);
  const video = r.nav && r.nav.all().find(n => n.tagName === 'A' && /\/video\//.test(n.href || ''));
  ok('the video hub row exists in the rail', !!video, video && video.href);
  ok('...and starts hidden, so a league with no read video never shows it', !!video && video.hidden === true);
  ok('...pointing at the league it is showing', !!video && video.href === '../video/?l=bcb', video && video.href);
}

/* ------------------------------------------------------------------ 4 --- */
console.log('\n-- all games, box scores');
ok('game/: "all games" goes to the global fixtures page', /<a href="\.\.\/games\/">← all games<\/a>/.test(rd('epinoia', 'game', 'index.html')));
ok('p/: "all games" goes to the global fixtures page', /<a href="\.\.\/games\/">← all games<\/a>/.test(rd('epinoia', 'p', 'index.html')));
{
  const b = rd('epinoia', 'score', 'bootstrap.js');
  ok('the scorer\'s bar: "box scores" goes to games/', b.includes("link('box scores', '../games/'"));
  ok('the scorer\'s bar: "← Epinoia" goes to HOME', b.includes("link('← Epinoia', '../home/'"));
}

/* ------------------------------------------------------------------ 5 --- */
console.log('\n-- the countries addresses');
{
  const c = rd('epinoia', 'countries', 'index.html');
  ok('countries/: a meta refresh to ../home/#leagues', /<meta http-equiv="refresh" content="0; url=\.\.\/home\/#leagues">/.test(c));
  ok('countries/: a plain link there too', /<a href="\.\.\/home\/#leagues"/.test(c));
  const firstScript = (/<script\b[^>]*>/.exec(c) || [])[0] || '';
  ok('countries/: appmode.js is the first script, blocking', /src="\.\.\/appmode\.js\?v=\d+"/.test(firstScript) && !/defer/.test(firstScript), firstScript);
  ok('countries/: ...before the manifest link', c.indexOf('appmode.js') < c.indexOf('rel="manifest"'));
  ok('countries/: no water (no pool, no splash.css, no splash-body)', !/class="pool|splash\.css|splash-body/.test(c));
  ok('countries/: no script of its own beyond appmode.js', (c.match(/<script\b/g) || []).length === 1);
}
if (existsSync(path.join(ROOT, 'league', 'countries', 'index.html'))) {
  const c = rd('league', 'countries', 'index.html');
  ok('league/countries/: straight to /epinoia/home/#leagues', /url=\/epinoia\/home\/#leagues/.test(c) && /location\.replace\('\/epinoia\/home\/'/.test(c));
  ok('league/countries/: never via /epinoia/countries/',
     !/(url=|href="|replace\(')\/epinoia\/countries\//.test(c));
}
{
  const s = rd('epinoia', 'splash.js');
  ok('splash.js: "Browse leagues" goes to home/#leagues', /a\.href = 'home\/#leagues';/.test(s) && !/'countries\/'/.test(s));
}

/* ------------------------------------------------------------------ 6 --- */
console.log('\n-- framed links');
{
  const strip = rd('epinoia', 'embed', 'strip', 'strip.js');
  const from = strip.indexOf('let framedByUsMemo');
  const to = strip.indexOf('\n', strip.indexOf('const linkTarget'));
  ok('strip.js carries one same-origin parent test', from > 0 && to > from);
  const target = (parent, self, origin) => {
    const win = { parent: null };
    win.parent = parent === 'self' ? win : parent;
    return new Function('window', 'location', strip.slice(from, to) + '\nreturn linkTarget();')(win, { origin: origin || 'https://prophesyscouting.co.uk' });
  };
  eq('framed by one of our pages: _top', target({ location: { origin: 'https://prophesyscouting.co.uk' } }), '_top');
  const foreign = {}; Object.defineProperty(foreign, 'location', { get() { throw new Error('SecurityError'); } });
  eq('framed by a club\'s site (reading its location throws): _blank', target(foreign), '_blank');
  eq('not framed at all: _blank', target('self'), '_blank');
  ok('strip cards use it', /a\.target = linkTarget\(\); a\.rel = 'noopener';/.test(strip));
  ok('the league name uses it', /const ours = framedByUs\(\);\n\s*a\.target = ours \? '_top' : '_blank';\n\s*a\.hidden = false;/.test(strip));
  ok('the plate uses it', /\$\('#plate'\)[\s\S]{0,40}p\.target = linkTarget\(\)/.test(strip));
  const html = rd('epinoia', 'embed', 'strip', 'index.html');
  ok('the plate is the wordmark and opens HOME', /id="plate" href="\.\.\/\.\.\/home\/"/.test(html));
}
[['game', 'full'], ['table', 'more']].forEach(([d, id]) => {
  const js = rd('epinoia', 'embed', d, d + '.js');
  const re = new RegExp("window\\.parent !== window && window\\.parent\\.location\\.origin === location\\.origin[\\s\\S]{0,120}getElementById\\('" + id + "'\\)[\\s\\S]{0,40}ours \\? '_top' : '_blank'");
  ok('embed/' + d + ': #' + id + ' targets _top on our pages, _blank elsewhere', re.test(js));
});

/* ------------------------------------------------------------------ 7 --- */
console.log('\n-- the foot\'s way back, and the platform tabs land somewhere');
{
  /* "← Epinoia" and "Back to Epinoia" are the words for going home: never the water */
  const BACK = /<a\b[^>]*\bhref="([^"]*)"[^>]*>\s*(?:←|&larr;|Back to)\s*Epinoia\s*<\/a>/g;
  const backs = [];
  for (const file of htmlFiles(EP)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const src = readFileSync(file, 'utf8');
    let m;
    BACK.lastIndex = 0;
    while ((m = BACK.exec(src))) backs.push({ rel, href: m[1], to: new URL(m[1], 'https://prophesyscouting.co.uk/' + rel).pathname });
  }
  ok('found the foot links back to Epinoia (10 across 9 pages)', backs.length >= 10, backs.length + ': ' + backs.map(x => x.rel).join(', '));
  const astray = backs.filter(x => x.to !== '/epinoia/home/');
  ok('each "← Epinoia" / "Back to Epinoia" link resolves to /epinoia/home/', astray.length === 0,
     astray.map(x => x.rel + ' -> ' + x.href).join('\n          '));
}
{
  /* every platform tab is a real page in this release (scouting is a placeholder until R4) */
  ['home', 'games', 'scouting', 'me'].forEach(d =>
    ok('epinoia/' + d + '/index.html exists (a platform tab points at it)', existsSync(path.join(EP, d, 'index.html'))));
  const sc = rd('epinoia', 'scouting', 'index.html');
  ok('scouting/: loads appmode.js blocking and nav.js, links back to HOME',
     /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>/.test(sc) && /<script src="\.\.\/nav\.js\?v=\d+" defer><\/script>/.test(sc)
     && /href="\.\.\/home\/"/.test(sc));
  const map = rd('epinoia', 'sitemap.xml');
  ok('sitemap: HOME and games listed', map.includes('/epinoia/home/</loc>') && map.includes('/epinoia/games/</loc>'));
  if (/coming soon/.test(sc)) {
    ok('sitemap: the scouting placeholder is not submitted, and it is noindex',
       !map.includes('/epinoia/scouting/</loc>') && /<meta name="robots" content="noindex">/.test(sc));
  }
  const manifest = JSON.parse(rd('epinoia', 'manifest.webmanifest'));
  const fx = (manifest.shortcuts || []).find(s => s.name === 'Fixtures');
  ok('manifest: the Fixtures shortcut opens the global fixtures page', !!fx && fx.url === '/epinoia/games/', fx && fx.url);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
