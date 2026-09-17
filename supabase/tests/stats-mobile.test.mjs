/* ============================================================================
   THE STATISTICS PAGE WORKS ON A PHONE.

   Measured live at 360px before this: the header's two links laid the page out
   504px wide; the column-resize grips escaped the table into one strip down the
   page's right edge that ate vertical swipes; the table started 899px down; the
   header row scrolled away; and every row was built on every keystroke.

   This pins the fixes that can be read without a browser:

     1. no resize grip is made for a coarse pointer or at phone width, and the
        phone CSS keeps every header cell positioned so a grip cannot escape
     2. pageSize draws that many rows with a 'show more' for the next lot, ranks
        the heat map over the whole filtered table, and a sort or a filter goes
        back to the first page; a caller without pageSize gets every row
     3. the search is debounced
     4. the phone header strip carries the header row, the body table does not
     5. the stats page header wraps on a phone, and the page asks for pages

   fulltable.js is run for real against a DOM stub small enough to reason about.

     node supabase/tests/stats-mobile.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

/* ---------------------------------------------------------------- DOM stub --- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this._text = '';
    this.style = { cssText: '' }; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this._cls = new Set(); this.hidden = false;
    this.scrollLeft = 0; this.offsetLeft = 0; this.offsetWidth = 50; this.clientWidth = 360;
    this.isConnected = false;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)),
      remove: (...c) => c.forEach(x => self._cls.delete(x)),
      contains: c => self._cls.has(c),
      toggle: (c, force) => { const on = force === undefined ? !self._cls.has(c) : !!force;
        if (on) self._cls.add(c); else self._cls.delete(c); return on; }
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  appendChild(n) {
    if (n.isFragment) { [...n.children].forEach(c => this.appendChild(c)); n.children = []; return n; }
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n);
    n.parentNode = this; this.children.push(n); return n;
  }
  append(...ns) { ns.forEach(n => this.appendChild(n)); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n);
    const i = this.children.indexOf(ref);
    n.parentNode = this;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  fire(t, e) { (this.listeners[t] || []).forEach(fn => fn(Object.assign({ preventDefault () {}, stopPropagation () {} }, e || {}))); }
  matches(sel) {
    const m = /^([a-z]+)?((?:\.[\w-]+)*)$/i.exec(sel.trim());
    if (!m) throw new Error('stub selector not supported: ' + sel);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    return (m[2] || '').split('.').filter(Boolean).every(c => this._cls.has(c));
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

let PHONE = false, COARSE = false;
const media = [];
const TIMERS = [];
const document = {
  createElement: t => t === 'canvas'
    ? { getContext: () => ({ font: '', measureText: s => ({ width: String(s).length * 7 }) }) }
    : new El(t),
  createElementNS: (_, t) => new El(t),
  createDocumentFragment: () => Object.assign(new El('#fragment'), { isFragment: true }),
  querySelector: () => null,
  body: new El('body')
};
const RANKED = [];
const window = {
  matchMedia: q => { const m = { media: q, get matches () { return /pointer:coarse/.test(q) ? COARSE : PHONE; },
    addEventListener () {}, removeEventListener () {} }; media.push(m); return m; },
  EpinoiaSeason: { percentiles: (v, keys) => { RANKED.push(v.length); return new Map(); } }
};
Object.assign(globalThis, {
  window, document,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
/* timers under test control: a cleared one never runs, as in a browser */
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let timerId = 0;
globalThis.setTimeout = (fn, ms) => { TIMERS.push({ fn, ms, id: ++timerId }); return timerId; };
globalThis.clearTimeout = id => { const i = TIMERS.findIndex(t => t.id === id); if (i > -1) TIMERS[i].cleared = true; };
const flushTimers = () => TIMERS.splice(0).forEach(t => { if (!t.cleared) t.fn(); });

const require = createRequire(import.meta.url);
const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));

const players = n => Array.from({ length: n }, (_, i) => ({
  id: 'p' + i, name: 'Player ' + i, teamName: 'T' + (i % 4), gp: 10, min: 200 + i,
  pts: 100 + i, ppg: (100 + i) / 10
}));
const draw = o => { const host = new El('div'); Table.render(Object.assign({ host, kind: 'player', rows: players(120) }, o)); return host; };
const bodyRows = h => h.querySelector('div.ft-wrap').querySelectorAll('tr').length;

/* ---- 1. grips ------------------------------------------------------------ */
console.log('\nresize grips are a mouse control');
PHONE = false; COARSE = false;
let h = draw({});
ok('a fine pointer on a wide screen still gets grips (the stub can see them)',
   h.querySelectorAll('span.ft-grip').length > 0, h.querySelectorAll('span.ft-grip').length);
PHONE = false; COARSE = true;
h = draw({});
ok('a coarse pointer gets none, whatever the width',
   h.querySelectorAll('span.ft-grip').length === 0, h.querySelectorAll('span.ft-grip').length);
PHONE = true; COARSE = false;
h = draw({});
ok('phone width gets none, whatever the pointer',
   h.querySelectorAll('span.ft-grip').length === 0);

const tableCss = rd('epinoia', 'kit', 'table.css').replace(/\/\*[\s\S]*?\*\//g, '');
const phoneCss = tableCss.slice(tableCss.indexOf('@media (max-width:820px)'));
ok('the phone CSS hides any grip that is made', /\.ft-grip\{\s*display:none\s*\}/.test(phoneCss));
ok('...and keeps every header cell positioned, so a grip anchors inside its cell',
   /table\.ft thead th:not\(\.stick\)\{\s*position:relative\s*\}/.test(phoneCss) &&
   !/thead th\{\s*position:static/.test(tableCss));

/* ---- 4. phone header strip ------------------------------------------------ */
console.log('\nthe phone header sticks');
ok('on a phone the header row is drawn into .ft-head',
   h.querySelector('div.ft-head').querySelectorAll('th').length > 0);
ok('...and the body table has no header row of its own',
   h.querySelector('div.ft-wrap').querySelectorAll('thead').length === 0);
ok('...both tables share a colgroup, so the columns line up',
   h.querySelector('div.ft-head').querySelectorAll('col').length ===
   h.querySelector('div.ft-wrap').querySelectorAll('col').length &&
   h.querySelector('div.ft-wrap').querySelectorAll('col').length > 0);
ok('...and the strip is paired with the wrap for xscroll.js',
   h.querySelector('div.ft-wrap').__ftMirror === h.querySelector('div.ft-head'));
const nameCol = h.querySelector('div.ft-head').querySelectorAll('col')[1];
ok('the name column is the phone width kit/table.css gives it (132px)',
   nameCol && nameCol.style.width === '132px', nameCol && nameCol.style.width);
PHONE = false;
h = draw({});
ok('on a wide screen the strip stays empty and the table keeps its own header',
   h.querySelector('div.ft-head').children.length === 0 &&
   h.querySelector('div.ft-wrap').querySelectorAll('thead').length === 1);

/* ---- 2. pages ------------------------------------------------------------- */
console.log('\nrows in pages, ranked over the whole table');
PHONE = true;
RANKED.length = 0;
h = draw({ pageSize: 50 });
const more = h.querySelector('button.ft-morerows');
const tally = h.querySelector('span.ft-tally');
ok('pageSize 50 draws 50 rows', bodyRows(h) === 50, bodyRows(h));
ok('...says how many of how many', tally.textContent === '50 of 120 players', tally.textContent);
ok("...and offers the next 50", more && !more.hidden && more.textContent === 'show 50 more', more && more.textContent);
ok('the heat map ranks all 120 filtered rows, not the 50 on screen', RANKED[RANKED.length - 1] === 120, RANKED.join(','));
more.fire('click');
ok('show more adds the next 50', bodyRows(h) === 100, bodyRows(h));
ok('...and offers the last 20', !more.hidden && more.textContent === 'show 20 more', more.textContent);
more.fire('click');
ok('the last press shows every row and the button goes', bodyRows(h) === 120 && more.hidden);
ok('...and the tally is the plain total again', tally.textContent === '120 players', tally.textContent);

const ppgTh = h.querySelector('div.ft-head').querySelectorAll('th').find(t => t.textContent === 'GP');
ppgTh.fire('click');
ok('a sort goes back to the first page', bodyRows(h) === 50, bodyRows(h));

h = draw({});
ok('without pageSize every row is drawn, as before', bodyRows(h) === 120, bodyRows(h));
ok('...and there is nothing to show more of', h.querySelector('button.ft-morerows').hidden === true);

/* ---- 3. debounced search -------------------------------------------------- */
console.log('\nthe search waits for a pause');
TIMERS.length = 0;
h = draw({ pageSize: 50 });
const q = h.querySelector('input.grow');
const before = RANKED.length;
q.value = 'player 11';
q.fire('input'); q.fire('input'); q.fire('input');
ok('typing does not redraw on each key', RANKED.length === before, `${before} -> ${RANKED.length}`);
const waits = TIMERS.map(t => t.ms);
ok('...it waits about 150ms', waits.length > 0 && waits.every(ms => ms >= 100 && ms <= 250), waits.join(','));
flushTimers();
ok('...and draws once the pause comes', bodyRows(h) === 11 && RANKED.length === before + 1,
   `rows ${bodyRows(h)}, draws ${RANKED.length - before}`);

/* ---- controls ------------------------------------------------------------- */
console.log('\nthe controls fold on a phone');
const ft = rd('epinoia', 'fulltable.js');
ok('no control sizes itself with an inline style any more',
   !/style\.cssText\s*=\s*'font-size/.test(ft) && !/style\.width\s*=\s*'78px'/.test(ft));
ok("the secondary controls sit in .ft-more behind a 'filters' button",
   h.querySelector('button.ft-filters') && h.querySelector('div.ft-more').children.length >= 6);
ok('min gp is one label holding its box', (() => { const f = h.querySelector('label.ft-field');
  return !!(f && f.querySelector('input.ft-num')); })());
ok('above the breakpoint .ft-more is display:contents, so the desktop bar is unchanged',
   /\.ft-more\{\s*display:contents\s*\}/.test(tableCss) && /\.ft-filters\{\s*display:none\s*\}/.test(tableCss));
ok('the phone presets are one row', /\.ft-pills\{[^}]*flex-wrap:nowrap/.test(phoneCss));
ok('phone inputs are 16px (no iOS focus zoom)',
   /\.ft-bar \.grow\{[^}]*font-size:16px/.test(phoneCss) && /\.ft-sel[^{]*\{[^}]*font-size:16px/.test(phoneCss));

/* ---- 5. the page ---------------------------------------------------------- */
console.log('\nthe statistics page itself');
const page = rd('epinoia', 'stats', 'index.html');
const at = page.indexOf('@media (max-width:820px)');
const block = at < 0 ? '' : page.slice(at, page.indexOf('</style>', at));
ok('the page has a phone block at the shared 820px breakpoint', at > -1);
ok('...the header wraps', /\.ep-hdr\{[^}]*flex-wrap:wrap/.test(block));
ok('...the header links stop pushing right', /\.subpage\{[^}]*margin-left:0/.test(block));
ok('...the title may shrink', /h2\{[^}]*min-width:0/.test(block));
ok('...and the frame clips rather than widening the page', /\.ep-frame\{[^}]*overflow-x:clip/.test(block));
ok('the page asks for 50 rows at a time', /pageSize:\s*50/.test(rd('epinoia', 'stats', 'stats.js')));
ok('no other caller opts in by accident',
   !/pageSize/.test(rd('epinoia', 'l', 'league.js')) && !/pageSize/.test(rd('epinoia', 'p', 'player.js')));

/* ---- 6. review fixes ------------------------------------------------------ */
console.log('\nother tables keep their 640px form');
const at640 = tableCss.indexOf('@media (max-width:640px)');
const shared = at640 < 0 ? '' : tableCss.slice(at640, tableCss.indexOf('@media (max-width:820px)'));
ok('the shared 640px block still carries .ft-wrap for the hand-built tables',
   at640 > -1 && /\n\s*\.ft-wrap\{[^}]*overflow:hidden/.test(shared));
ok('...and the 820px block reaches .ft-wrap only inside .ft-host',
   /\.ft-host \.ft-wrap\{/.test(phoneCss) && !/[\n}]\s*\.ft-wrap\{/.test(phoneCss));
ok('the larger phone heading is scoped to the header strip',
   /\.ft-head table\.ft thead th\{[^}]*font-size:9\.5px/.test(phoneCss) &&
   !/[\n}]\s*table\.ft thead th\{[^}]*font-size:9\.5px/.test(tableCss));
ok('the kit scrollers switch at 640px again',
   /@media \(max-width:640px\)\{\s*\.ep-xscroll, \.ep-xtabs\{/.test(rd('epinoia', 'kit', 'epinoia-kit.css').replace(/\/\*[\s\S]*?\*\//g, '')));
PHONE = false;
h = draw({});
ok('a rendered host is marked .ft-host', h.classList.contains('ft-host'));

console.log('\none breakpoint listener for every table');
/* a fresh copy of the module, so no subscription is left over from the renders above */
const LISTENERS = new Set();
const baseMm = window.matchMedia;
window.matchMedia = q => { const m = baseMm(q);
  m.addEventListener = (t, fn) => LISTENERS.add(fn);
  m.removeEventListener = (t, fn) => LISTENERS.delete(fn);
  return m; };
const ftPath = require.resolve(path.join(ROOT, 'epinoia', 'fulltable.js'));
delete require.cache[ftPath];
const Fresh = require(ftPath);
/* elements that know whether they are in the page, by walking up to a root */
class PEl extends El {
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n._root) return true; return false; }
  set isConnected(_) {}
}
const baseCreate = document.createElement;
document.createElement = t => t === 'canvas' ? baseCreate(t) : new PEl(t);
const pageRoot = new PEl('body'); pageRoot._root = true;
/* twelve flicks into new hosts, as the league page does on each scope change: each new
   board is put in the page and drawn, and the old one taken out */
let prevHost = null;
for (let i = 0; i < 12; i++) {
  if (prevHost) prevHost.remove();
  const hh = new PEl('div'); pageRoot.appendChild(hh);
  Fresh.render({ host: hh, kind: 'player', rows: players(5) });
  prevHost = hh;
}
ok('twelve renders into fresh hosts hold one breakpoint listener, not twelve',
   LISTENERS.size === 1, LISTENERS.size);
const drawsBefore = RANKED.length;
[...LISTENERS].forEach(fn => fn());
ok('...and a crossing redraws only the table still in the page, the rest let go',
   RANKED.length - drawsBefore === 1, RANKED.length - drawsBefore);
/* once no table is left in the page, the listener is handed back */
prevHost.remove();
[...LISTENERS].forEach(fn => fn());
ok('...and with no table left, the listener itself is removed', LISTENERS.size === 0, LISTENERS.size);
window.matchMedia = baseMm;
document.createElement = baseCreate;

console.log('\nthe TEAM column, show more and the sorted column');
const crest = (n, withCrest) => players(n).map((r, i) => Object.assign(r, withCrest(i) ? { colour: '#123456' } : {}));
PHONE = true;
let hc = new El('div');
Table.render({ host: hc, kind: 'player', rows: crest(10, i => i !== 3) });
ok('a phone keeps TEAM when any row has no crest',
   hc.querySelector('div.ft-head').querySelectorAll('th').some(t => t.textContent === 'TEAM'));
hc = new El('div');
Table.render({ host: hc, kind: 'player', rows: crest(10, () => true) });
ok('...and drops it when every row shows its club as a crest',
   !hc.querySelector('div.ft-head').querySelectorAll('th').some(t => t.textContent === 'TEAM'));
ok('column widths are measured over the whole filtered table, not the page on screen',
   /measure\(cols, all, phone\)/.test(ft));
ok('a sort on a pinned header does not pan the table',
   /th\.classList\.contains\('stick'\)\)\s*return/.test(ft));
const hp = new El('div');
Table.render({ host: hp, kind: 'player', rows: players(10) });
const wrapP = hp.querySelector('div.ft-wrap');
wrapP.scrollLeft = 300;
const nameTh = hp.querySelector('div.ft-head').querySelectorAll('th')[1];
nameTh.fire('click');
ok('...tapping PLAYER after panning right leaves the pan where it was', wrapP.scrollLeft === 300, wrapP.scrollLeft);
ok('a phone heading is measured with its letter-spacing and may pass the 96px cap',
   /HEAD_MAX = phone \? 120 : MAX/.test(ft) && /length \* TRACK/.test(ft));
ok('phone rows are 40px tall, a thumb-sized name link',
   /\.ft-host table\.ft tbody td\{\s*height:40px/.test(phoneCss));

globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
