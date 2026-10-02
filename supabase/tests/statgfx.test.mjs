/* ============================================================================
   THE STATS PAGE'S GRAPHIC, THE NAMES IN FULL AND THE COMPARISON'S PICTURE.

     node supabase/tests/statgfx.test.mjs

   What is held here:
     * the graphic (statgfx.js -> socialcard.js 'statboard') is of the table as it stands: the column it is sorted by,
       the top N rows in the table's own order (a real fulltable.js, sorted by a header press), the figures as the
       table prints them, and the stats chosen beside it (never the board's own, never more than four, unknown ones
       dropped);
     * its layout fits every count from 3 to 20, with 0 to 4 stats beside it, on all three shapes: every row's box
       inside the page and clear of the heading, the footer and each other, every word drawn on the page and, on a
       story, out of the strips Instagram covers; one column while rows stay readable, then two;
     * the player or team circles: a photo the model brings is drawn in the player's circle, the team choice draws
       the crest alone and never asks for the photo;
     * every name cell of the stats table carries the full name: the link's title and aria-label, or a title and
       hidden full text where there is no link;
     * the comparison's picture holds every stat chosen (not only those on screen), each player's value and
       percentile, and grows to fit them; its file is compare-<one>-<two>.png.
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------------- DOM stub --- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this._text = '';
    this.style = { cssText: '' }; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this._cls = new Set(); this.hidden = false; this.disabled = false;
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

let PHONE = false;
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
const require = createRequire(import.meta.url);
const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
/* the real percentiles, with a note of every pool they were asked to rank */
const POOLS = [];
const window = {
  matchMedia: q => ({ media: q, get matches () { return /pointer:coarse/.test(q) ? false : PHONE; },
    addEventListener () {}, removeEventListener () {} }),
  EpinoiaSeason: Object.assign({}, Season, {
    percentiles: (rows, keys, low, groupOf) => { POOLS.push({ n: rows.length, keys, grouped: !!groupOf });
      return Season.percentiles(rows, keys, low, groupOf); }
  })
};
Object.assign(globalThis, { window, document, getComputedStyle: () => ({ getPropertyValue: () => '' }) });
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let timerId = 0;
globalThis.setTimeout = (fn, ms) => { TIMERS.push({ fn, ms, id: ++timerId }); return timerId; };
globalThis.clearTimeout = id => { const i = TIMERS.findIndex(t => t.id === id); if (i > -1) TIMERS[i].cleared = true; };
const flushTimers = () => TIMERS.splice(0).forEach(t => { if (!t.cleared) t.fn(); });


const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));
/* socialcard.js and reportcard.js in their own context, as socialcard.test.mjs runs them */
const sandbox = { console, module: undefined, setTimeout: realSetTimeout, clearTimeout: realClearTimeout, Intl, TextEncoder };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const vctx = vm.createContext(sandbox);
for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/statgfx.js', 'epinoia/compare.js']) {
  vm.runInContext(rd(f), vctx, { filename: f });
}
const SC = sandbox.EpinoiaSocialCard, G = sandbox.EpinoiaStatGfx, CMP = sandbox.EpinoiaCompare;

/* ------------------------------------------------------------ the table --- */
console.log('\nthe graphic is of the table as it is sorted');
const teams = [['Leicester Riders', 'LEI', '#c8102e'], ['Surrey 89ers', 'SUR', '#0a7a3a'], ['Newcastle Eagles', 'NEW', '#111111']];
const rows = Array.from({ length: 30 }, (_, i) => {
  const t = teams[i % 3];
  return { id: 'p' + i, name: (i === 4 ? 'Christopherson-Montgomery Bartholomew ' : 'Player ') + i, first_name: i === 7 ? 'Jo' : undefined, last_name: i === 7 ? 'Smith-Jones' : undefined,
    teamName: t[1], teamFull: t[0], teamShort: t[1], colour: t[2], teamLogo: 'crests/' + t[1] + '.png',
    gp: 10, min: 200 + i, mpg: 20 + (i % 7), ppg: 5 + ((i * 7) % 23), rpg: 2 + (i % 5), apg: 1 + (i % 4), fg_pct: 40 + (i % 9),
    bpm: (i % 11) - 5, rapm: i === 3 ? null : ((i * 13) % 17) - 8, photo_url: i === 2 ? 'https://example.org/p2.jpg' : null };
});
const { host, api } = (() => { const host = new El('div'); const api = Table.render({ host, kind: 'player', rows, sortKey: 'ppg', minGames: 1, playerHref: r => '../p/?p=' + r.id, graphic: () => {} }); return { host, api }; })();
flushTimers();
const crestOf = p => 'https://cdn.example/' + p;
const league = { name: 'Super League Basketball Men', slug: 'slb-men', colour_a: '#e63c2f', colour_b: '#7f8c8d', logo_path: 'l.png' };
{
  const got = G.modelFrom(api, { n: 10, secs: ['gp', 'mpg'], league, season: '2026-27', crestOf });
  const want = api.getView().slice(0, 10).map(r => r.name);
  ok('sorted by PPG: the board is about PPG', got.sorted && got.model.stat.key === 'ppg' && got.model.stat.label === 'PPG', got.model.stat.key);
  ok('...the top ten rows in the table\'s own order, ranked 1 to 10', same(got.model.rows.map(r => r.name), want) && same(got.model.rows.map(r => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  ok('...each figure as the table prints it', got.model.rows.every((r, i) => r.value === Number(api.getView()[i].ppg).toFixed(1)));
  ok('...the club\'s crest from the table\'s own logo path, and the league\'s colours', got.model.rows[0].team.crestUrl.startsWith('https://cdn.example/crests/') && got.model.league.colour === '#e63c2f' && got.model.league.logoUrl === 'https://cdn.example/l.png');
  ok('...titled from the sort: "PPG leaders", the season in the heading', got.model.title === 'PPG leaders' && got.model.range === '2026-27');
}
/* a press on the RAPM header sorts by it, as a reader would */
const th = label => host.querySelectorAll('th').find(t => t.textContent === label);
{
  const pill = host.querySelectorAll('button.ft-pill').find(b => b.dataset.g === 'advanced');
  if (pill) pill.fire('click');
  const h = th('RAPM');
  ok('the RAPM header is there to press', !!h);
  if (h) h.fire('click');
  const got = G.modelFrom(api, { n: 5, secs: ['ppg', 'bpm', 'rapm', 'nope', 'mpg', 'rpg', 'apg'], league, crestOf });
  const view = api.getView();
  ok('sorted by RAPM: the board is about RAPM, the best first', got.model.stat.key === 'rapm' && got.model.title === 'RAPM leaders');
  ok('...its top five are the table\'s top five', same(got.model.rows.map(r => r.name), view.slice(0, 5).map(r => r.name)));
  ok('...the signed figures as the table prints them (+8.0)', got.model.rows[0].value === '+' + Number(view[0].rapm).toFixed(1), got.model.rows[0].value);
  ok('the stats beside it: the board\'s own and an unknown key dropped, four at most, in the order chosen',
     same(got.model.secs.map(s => s.key), ['ppg', 'bpm', 'mpg', 'rpg']), got.model.secs.map(s => s.key).join());
  ok('...each row\'s figures for them, as the table prints them', same(got.model.rows[0].secs, [Number(view[0].ppg).toFixed(1), (view[0].bpm > 0 ? '+' : '') + Number(view[0].bpm).toFixed(1), Number(view[0].mpg).toFixed(1), Number(view[0].rpg).toFixed(1)]));
  h.fire('click');                                        // the other way: the lowest first
  const low = G.modelFrom(api, { n: 3, secs: [], league });
  ok('pressed again, the lowest first: "Lowest RAPM" and the table\'s bottom three', low.model.title === 'Lowest RAPM' && same(low.model.rows.map(r => r.name), api.getView().slice(0, 3).map(r => r.name)));
  ok('no stats beside it when none are chosen', low.model.secs.length === 0 && low.model.rows.every(r => r.secs.length === 0));
  ok('a player photo the register has rides on the row (https only)', SC.statboard({ rows: [{ name: 'a', photoUrl: 'https://x/y.jpg' }, { name: 'b', photoUrl: 'http://x/y.jpg' }] }).rows.map(r => r.photoUrl).join() === 'https://x/y.jpg,');
  th('PLAYER').fire('click');
  const byName = G.modelFrom(api, { n: 4, secs: ['gp'], league });
  ok('sorted by name: no figure to lead with, so PPG, the rows still in the table\'s order', !byName.sorted && byName.model.stat.key === 'ppg' && same(byName.model.rows.map(r => r.name), api.getView().slice(0, 4).map(r => r.name)));
  ok('the count is held to 3..20', G.modelFrom(api, { n: 99 }).model.rows.length === 20 && G.modelFrom(api, { n: 1 }).model.rows.length === 3);
  ok('the default stats beside it are the next two of the view', same(G.defaultSecs('ppg', [{ k: 'rank' }, { k: 'name', text: true, g: ['id'] }, { k: 'gp', g: ['basic'] }, { k: 'ppg', g: ['basic'] }, { k: 'mpg', g: ['basic'] }, { k: 'rpg', g: ['basic'] }]), ['gp', 'mpg']));
}

/* ------------------------------------------------------- the full names --- */
console.log('\nthe full name, on hover and to a screen reader');
{
  const cells = host.querySelectorAll('div.ft-name');
  const links = cells.map(c => c.children.find(x => x.tagName === 'A')).filter(Boolean);
  ok('every name is a link with the whole name as its title and its aria-label', links.length === cells.length && links.length > 0 &&
     links.every(a => a.title && a.getAttribute('aria-label') === a.title && a.title === a.textContent || (a.title === 'Jo Smith-Jones')));
  const jo = links.find(a => a.textContent === 'Player 7');
  ok('...the stored first and last name when the row carries them (Jo Smith-Jones)', jo && jo.title === 'Jo Smith-Jones' && jo.getAttribute('aria-label') === 'Jo Smith-Jones', jo && jo.title);
  const h2 = new El('div');
  Table.render({ host: h2, kind: 'player', rows: rows.slice(0, 9), sortKey: 'ppg' });
  flushTimers();
  const spans = h2.querySelectorAll('div.ft-name').map(c => c.children);
  const joCell = spans.find(ch => ch.some(x => x.textContent === 'Player 7'));
  const plainCell = spans.find(ch => ch.some(x => x.textContent === 'Player 1'));
  ok('without a link: the title on the name, and the whole name in hidden text where it differs',
     joCell && joCell.some(x => x._cls.has('ep-sr') && x.textContent === 'Jo Smith-Jones') && joCell.some(x => x.title === 'Jo Smith-Jones' && x.getAttribute('aria-hidden') === 'true'));
  ok('...and no doubled reading where it is the same', plainCell && !plainCell.some(x => x._cls.has('ep-sr')) && plainCell.some(x => x.title === 'Player 1' && x.getAttribute('aria-hidden') == null));
  ok('the hidden-text class is in the kit', /\.ep-sr\{position:absolute!important/.test(rd('epinoia', 'kit', 'epinoia-kit.css')));
  ok('the lineup tables\' surnames carry the full name too (wowy)', /function shortEl\(ctx, id, tag, cls\)/.test(rd('epinoia', 'stats', 'wowy', 'wowyui.js')) && /s\.title = full/.test(rd('epinoia', 'stats', 'wowy', 'wowyui.js')));
}

/* ------------------------------------------------------------ the pictures --- */
console.log('\nevery count on every shape: nothing overlaps, nothing leaves the page');
function recorder() {
  const log = [], saved = [];
  let size = 10, fill = '';
  const c = {
    log, strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    save() { saved.push([size, fill, c.textAlign, c.globalAlpha]); },
    restore() { const s = saved.pop(); if (s) { [size, fill, c.textAlign, c.globalAlpha] = s; } },
    set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; },
    measureText(t) { return { width: String(t).length * size * 0.56 }; },
    fillText(t, x, y) {
      const w = String(t).length * size * 0.56;
      const left = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x;
      log.push({ kind: 'text', t: String(t), x0: left, x1: left + w, y0: y - size * 0.8, y1: y + size * 0.2, size });
    },
    fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h, fill }); },
    createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, clip() {},
    setLineDash() {}, scale() {},
    drawImage(img, x, y, w, h) { log.push({ kind: 'image', img, x0: x, x1: x + w, y0: y, y1: y + h }); }
  };
  return c;
}
const img = (w, h, tag) => ({ width: w, height: h, naturalWidth: w, naturalHeight: h, tag });
const longName = i => (i % 4 === 0 ? 'Christopherson-Montgomery Bartholomew Jr ' : 'Player Number ') + i;
const board = (n, k) => SC.statboard({
  league: { name: 'Super League Basketball Men', colour: '#e63c2f', colour2: '#7f8c8d', logo: img(200, 100, 'league') }, comp: 'Super League Basketball Men', range: '2026-27',
  title: 'RAPM leaders', sub: 'Whole season · min 5 GP', stat: { key: 'rapm', label: 'RAPM' },
  secs: ['gp', 'mpg', 'ppg', 'ts'].slice(0, k).map(x => ({ key: x, label: x.toUpperCase() })),
  rows: Array.from({ length: n }, (_, i) => ({ name: longName(i), team: { name: teams[i % 3][0], short_name: teams[i % 3][1], colour: teams[i % 3][2] },
    value: '+' + (12 - i / 2).toFixed(1), secs: ['10', '31.2', '18.4', '61.0'].slice(0, k) }))
});
let bad = [], sawTwo = false, sawOne = false;
for (const size of Object.keys(SC.SIZES)) {
  const S = SC.SIZES[size];
  for (let n = 3; n <= 20; n++) for (let k = 0; k <= 4; k++) {
    const c = recorder();
    let res, threw = null;
    try { res = SC.draw(c, board(n, k), { size }); } catch (e) { threw = e.message; }
    if (threw) { bad.push(`${size} n${n} k${k}: ${threw}`); continue; }
    const L = SC.statLayout(S, n, k);
    if (L.cols === 2) sawTwo = true; else sawOne = true;
    const top = res.at[1];                               // the rows block, after the title
    const boxes = L.boxes.map(b => ({ x0: b.x, x1: b.x + b.w, y0: top + b.y, y1: top + b.y + b.h }));
    const lo = S.top + 40, hi = S.h - S.bottom - 70;     // under the heading, above the footer's rule
    if (boxes.length !== n) bad.push(`${size} n${n} k${k}: ${boxes.length} boxes`);
    if (res.at[1] < res.at[0] + 128) bad.push(`${size} n${n} k${k}: rows under the title`);
    boxes.forEach((b, i) => {
      if (b.x0 < 64 - 0.5 || b.x1 > S.w - 64 + 0.5 || b.y0 < lo || b.y1 > hi) bad.push(`${size} n${n} k${k}: row ${i + 1} off its room ${Math.round(b.y0)}-${Math.round(b.y1)}`);
      boxes.forEach((o, j) => { if (j > i && b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 - 0.5 && o.y0 < b.y1 - 0.5) bad.push(`${size} n${n} k${k}: rows ${i + 1} and ${j + 1} overlap`); });
    });
    if (L.rowH < (L.cols === 2 ? 56 : 56)) bad.push(`${size} n${n} k${k}: rows ${L.rowH}px`);
    const drawn = c.log.filter(e => !(e.kind === 'rect' && (e.x1 - e.x0 >= S.w || e.x0 === 0)));
    const off = drawn.filter(e => e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5);
    if (off.length) bad.push(`${size} n${n} k${k}: off the page ${off[0].t || off[0].kind}`);
    if (size === 'story') { const cov = drawn.filter(e => e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)); if (cov.length) bad.push(`story n${n} k${k}: under Instagram's bars ${cov[0].t}`); }
    /* every row's words stay inside its own box */
    const texts = c.log.filter(e => e.kind === 'text' && e.y0 >= top + L.headH - 2);
    texts.forEach(e => { const inBox = boxes.some(b => e.x0 >= b.x0 - 1 && e.x1 <= b.x1 + 1 && e.y0 >= b.y0 - 2 && e.y1 <= b.y1 + 2); if (!inBox && e.y1 < hi) bad.push(`${size} n${n} k${k}: "${e.t}" outside its row`); });
  }
}
ok('3 to 20 players, 0 to 4 stats beside, square / portrait / story: every row in its room, none overlapping, every word in its row and on the page', bad.length === 0, bad.slice(0, 6).join(' | '));
ok('...one column while the rows read, two once they would not', sawOne && sawTwo);
ok('a square takes ten to a column and eleven in two', SC.statLayout('square', 10, 2).cols === 1 && SC.statLayout('square', 11, 2).cols === 2);
ok('a story holds twenty in two columns of rows at least 90px tall', SC.statLayout('story', 20, 4).cols === 2 && SC.statLayout('story', 20, 4).rowH >= 90, SC.statLayout('story', 20, 4).rowH);
{
  const c = recorder();
  SC.draw(c, board(10, 2), { size: 'square' });
  const names = c.log.filter(e => e.kind === 'text' && /^(Player Number|Christopherson)/.test(e.t));
  ok('a square of ten: the names at a size a phone reads (17px or more), a long one cut rather than run over', names.length === 10 && names.every(e => e.size >= 17), Math.min(...names.map(e => e.size)));
  ok('...the board\'s stat over its column in the league\'s colour, each other stat over its own', c.log.some(e => e.kind === 'text' && e.t === 'RAPM') && c.log.some(e => e.kind === 'text' && e.t === 'GP') && c.log.some(e => e.kind === 'text' && e.t === 'MPG'));
  ok('...the league\'s logo in the heading and the footer', c.log.filter(e => e.kind === 'image' && e.img.tag === 'league').length === 2);
}
console.log('\nplayer circles or team circles, as Graphics offers them');
{
  const m = board(5, 2);
  m.rows[0].photo = img(300, 400, 'photo');
  m.rows.forEach(r => { r.team.crest = img(128, 128, 'crest'); });
  const p = recorder();
  SC.draw(p, m, { size: 'square' });
  ok('player circles: his photo in his circle, his club\'s crest small on its edge, initials for the rest',
     p.log.filter(e => e.kind === 'image' && e.img.tag === 'photo').length === 1 && p.log.filter(e => e.kind === 'image' && e.img.tag === 'crest').length === 5
     && p.log.some(e => e.kind === 'text' && e.t === 'P1'));
  const t = recorder();
  SC.draw(t, m, { size: 'square', modules: { discs: 'team' } });
  ok('team circles: the crest alone, no photo and no initials', !t.log.some(e => e.kind === 'image' && e.img.tag === 'photo') && t.log.filter(e => e.kind === 'image' && e.img.tag === 'crest').length === 5
     && !t.log.some(e => e.kind === 'text' && e.t === 'P1'));
  const crest = p.log.filter(e => e.kind === 'image' && e.img.tag === 'crest')[0], photo = p.log.find(e => e.kind === 'image' && e.img.tag === 'photo');
  const d = photo.x1 - photo.x0, cx = (photo.x0 + photo.x1) / 2;          // a portrait fills the circle's width
  ok('...the crest is small beside the photo, at its lower right edge', crest.x1 - crest.x0 < d * 0.6 && (crest.x0 + crest.x1) / 2 > cx + d * 0.25, [crest.x1 - crest.x0, d].join());
}
ok('the file names the league, the count, the stat and the shape', SC.filename(board(10, 2), 'story') === 'super-league-basketball-men-top-10-rapm-story.png', SC.filename(board(10, 2), 'story'));
ok('its caption lists the board', /^RAPM leaders in the Super League Basketball Men \(2026-27\):\n\n1\. Christopherson/.test(SC.caption(board(3, 0))));

/* ------------------------------------------------------ the comparison --- */
console.log('\nthe comparison\'s picture');
{
  const cols = Table.PLAYER_COLS;
  const picks = rows.slice(0, 2);
  const keys = ['ppg', 'rpg', 'apg', 'fg_pct', 'bpm', 'mpg', 'ts', 'efg', 'usg', 'ast_pct', 'blk_pct', 'stl_pct', 'tov_pct', 'trb_pct'];
  const ranks = new Map(keys.map((k, j) => [k, new Map(picks.map((r, i) => [r.id, (j * 7 + i * 40) % 100]))]));
  const o = CMP.fromTable({ picks, statKeys: keys, cols, ranks, groups: Table.PRESETS.player, league });
  /* every stat the reader has chosen, not only what the panel has scrolled to */
  const shown = Object.assign({}, o, { stats: keys.map(k => o.allStats.concat(o.stats).find(s => s.key === k) || CMP.statFrom(cols.find(c => c.k === k))).filter(Boolean) });
  const ex = CMP.exportModel(shown, { colours: ['#ff0000', '#00ffaa'] });
  const m = SC.compare(ex);
  ok('every stat chosen is in the picture, in order', same(m.stats.map(s => s.key), shown.stats.map(s => s.key)) && m.stats.length === shown.stats.length, m.stats.length + ' of ' + shown.stats.length);
  ok('...each player\'s value as the table prints it and his percentile', m.stats.every(s => s.cells.length === 2) && m.stats[0].cells[0].text === Number(picks[0].ppg).toFixed(1) && m.stats[0].cells[1].pct === ranks.get('ppg').get(picks[1].id));
  ok('...in the colours the popup paints them, his club beside him', m.players[0].colour === '#ff0000' && m.players[1].colour === '#00ffaa' && m.players[0].team.name === 'Leicester Riders');
  const L = SC.compareLayout(m, null);
  const c = recorder();
  const res = SC.draw(c, m, { size: 'auto' });
  const labels = c.log.filter(e => e.kind === 'text' && shown.stats.some(s => s.label.toUpperCase() === e.t));
  ok('...drawn whole, every stat\'s label on a page as tall as they need', labels.length === shown.stats.length && res.S.h === L.S.h && c.log.every(e => e.y1 <= L.S.h + 0.5), labels.length + ' labels, ' + L.S.h + 'px');
  const last = c.log.filter(e => e.kind === 'text' && /(st|nd|rd|th)$/.test(e.t)).reduce((a, e) => Math.max(a, e.y1), 0);
  ok('...the last bar above the footer', last < L.S.h - L.S.bottom - 70, last + ' vs ' + (L.S.h - L.S.bottom - 70));
  const few = SC.compare(Object.assign({}, ex, { stats: ex.stats.slice(0, 5) }));
  ok('a few stats fit a square; many grow the page', SC.compareLayout(few, null).S.w === 1080 && SC.compareLayout(few, null).S.h === 1080 && L.S.h > 1350, SC.compareLayout(few, null).S.h + ' / ' + L.S.h);
  const v = SC.compare(Object.assign({}, ex, { mode: 'value' }));
  const vc = recorder(); SC.draw(vc, v, { size: 'auto' });
  ok('value mode: the figures, no percentiles', !vc.log.some(e => e.kind === 'text' && /^\d+(st|nd|rd|th)$/.test(e.t)) && vc.log.some(e => e.kind === 'text' && e.t === Number(picks[0].ppg).toFixed(1)));
  ok('the file is compare-<one>-<two>.png', CMP.exportName(o) === 'compare-player-0-player-1.png', CMP.exportName(o));
  const tc = recorder(); SC.draw(tc, Object.assign({}, m, { players: m.players.map(p => Object.assign({}, p, { photo: img(10, 10, 'photo') })) }), { size: 'auto', modules: { discs: 'team' } });
  ok('the team circles choice reaches the comparison too: no photo drawn', !tc.log.some(e => e.kind === 'image' && e.img.tag === 'photo'));
  const sheet = rd('epinoia', 'compare.js'), css = rd('epinoia', 'kit', 'compare.css');
  ok('the popup has the export button and the circles choice', /cmp-sheet-export">Export image</.test(sheet) && /data-cmp-discs="team">Team circles</.test(sheet));
  ok('the popup fits the screen: the bars scroll inside it, its height divided by the page zoom', /\.cmp-sheet-body > \.cmp > \.cmp-chart\{ flex:1 1 auto; min-height:140px; overflow-x:hidden; overflow-y:auto/.test(css)
     && /min-width:1200px\)\{ \.cmp-sheet\{ max-height:min\(calc\(86vh \/ 1\.5\)/.test(css));
}

console.log('\nthe page');
{
  const html = rd('epinoia', 'stats', 'index.html');
  const at = f => html.indexOf('src="../' + f);
  ok('the stats page loads reportcard, socialcard and statgfx before its own script, and the panel\'s sheet', at('reportcard.js') > 0 && at('reportcard.js') < at('socialcard.js') && at('socialcard.js') < at('statgfx.js') && at('statgfx.js') < html.indexOf('src="stats.js') && /kit\/statgfx\.css/.test(html));
  const js = rd('epinoia', 'stats', 'stats.js');
  ok('the table is given the graphic button and follows every draw', /graphic: G \? \(api, b\) => G\.toggle\(api, b\) : null/.test(js) && /onDraw: G \? \(\) => G\.refresh\(\) : null/.test(js) && /G\.bind\(T\)/.test(js));
  ok('statgfx reads nothing: no fetch, no database call', !/fetch\(|supabase|\.from\(|D\.get|getCounted/.test(rd('epinoia', 'statgfx.js')));
  ok('the button is in the bar itself, not folded into the phone\'s filters', /gfxBtn = el\('button', 'ep-btn ft-btn ft-gfx', 'graphic'\);[\s\S]{0,400}bar\.appendChild\(gfxBtn\)/.test(rd('epinoia', 'fulltable.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
