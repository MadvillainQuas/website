/* ============================================================================
   HOME'S DAILY FIXTURES WITH A LEAGUE GROUP (NCAA D2, 2026-10-14): epinoia/globalgames.js THE GROUPS helpers and
   epinoia/home/daily.js THE GROUPS, run for real (config.js, globalgames.js, daily.js in one sandbox) against a small
   PostgREST stand-in and a stand-in DOM. Nothing touches the network.

   What would go wrong quietly:
     1. D2's hundred live games filling the forty-row live read (or the results, or the fixtures) - the grouped leagues
        must be left out of the main reads, by address, and of anything held from before;
     2. the closed block reading games: until a part is opened only COUNTS are read, until a conference is opened no
        game is read in full;
     3. a game filed under the wrong conference: the same conference on both sides is that conference, two different
        ones or a club with none is non-conference (listed last);
     4. a refresh closing what the reader opened, or reading again what is shut;
     5. a reader who ticked D2 by name in CHECK VIA LEAGUE not seeing its games in the list.

     TZ=UTC node supabase/tests/home-groups-d2.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const GG = require(path.join(ROOT, 'epinoia', 'globalgames.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 900) : '')); } };
const section = s => console.log('\n' + s);
const flush = () => new Promise(r => setImmediate(r));

/* ------------------------------------------------------------------ the world --- */
const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOW = Date.parse('2026-10-14T20:00:00Z');
const at = h => new Date(NOW + h * 3600e3).toISOString();
const LG = {
  slb: { id: U(1), slug: 'slb-men', name: 'Super League Basketball', country: 'GB', colour_source: 'default', periods: 4 },
  bcb: { id: U(2), slug: 'bcb', name: 'BCB', country: 'GB', colour_source: 'default', periods: 4 },
  dm: { id: U(3), slug: 'ncaa-d2-men', name: 'NCAA Division II Men', country: 'US', gender: 'men', colour_source: 'default', periods: 2 },
  dw: { id: U(4), slug: 'ncaa-d2-women', name: 'NCAA Division II Women', country: 'US', gender: 'women', colour_source: 'default', periods: 4 }
};
const COMP = { slb: U(11), bcb: U(12), dm: U(13), dw: U(14) };
const team = (id, name) => ({ id, slug: id, name, short_name: name.slice(0, 3).toUpperCase(), colour: '#123456', colour_2: null, logo_path: null });
const T = {};
['n1h', 'n1a', 'n2h', 'n2a', 'u1h', 'u1a', 'u2h', 'u2a', 'r1h', 'r1a', 'r2h', 'r2a'].forEach(id => { T[id] = team(id, 'Club ' + id); });
/* D2 men: GLIAC m1-m4, PSAC m5-m6, NE10 m7-m8, m9 an opponent from outside the division (no conference). Women: GLIAC w1-w4, SAC w5-w6 */
['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'].forEach(id => { T[id] = team(id, 'College ' + id); });
const CTEAMS = [];
['m1', 'm2', 'm3', 'm4'].forEach(t => CTEAMS.push({ competition_id: COMP.dm, team_id: t, group_name: 'GLIAC' }));
['m5', 'm6'].forEach(t => CTEAMS.push({ competition_id: COMP.dm, team_id: t, group_name: 'PSAC' }));
['m7', 'm8'].forEach(t => CTEAMS.push({ competition_id: COMP.dm, team_id: t, group_name: 'NE10' }));
CTEAMS.push({ competition_id: COMP.dm, team_id: 'm9', group_name: null });
['w1', 'w2', 'w3', 'w4'].forEach(t => CTEAMS.push({ competition_id: COMP.dw, team_id: t, group_name: 'GLIAC' }));
['w5', 'w6'].forEach(t => CTEAMS.push({ competition_id: COMP.dw, team_id: t, group_name: 'SAC' }));

function world() {
  const games = [];
  const add = (id, lg, h, home, away, status) => games.push({ id, lg, tipoff_at: at(h), status, home: T[home], away: T[away],
    home_score: status === 'scheduled' ? null : 60, away_score: status === 'scheduled' ? null : 55, venue: 'Hall ' + id });
  /* LIVE: two of the ordinary leagues', seven of D2 (men 5: GLIAC 2, PSAC 1, non-conference 2; women 2: GLIAC 1, SAC 1) */
  add('n1', 'slb', -0.5, 'n1h', 'n1a', 'live'); add('n2', 'bcb', -1, 'n2h', 'n2a', 'live');
  add('dm1', 'dm', -1, 'm1', 'm2', 'live'); add('dm2', 'dm', -0.8, 'm3', 'm4', 'live'); add('dm3', 'dm', -0.7, 'm5', 'm6', 'live');
  add('dm4', 'dm', -0.6, 'm7', 'm5', 'live');           // NE10 v PSAC: two conferences
  add('dm5', 'dm', -0.5, 'm8', 'm9', 'live');           // a club with no conference
  add('dw1', 'dw', -1, 'w1', 'w2', 'live'); add('dw2', 'dw', -0.9, 'w5', 'w6', 'live');
  /* UPCOMING: two ordinary; D2 men one within the day, one 30 hours on (outside the block's window) */
  add('u1', 'slb', 2, 'u1h', 'u1a', 'scheduled'); add('u2', 'bcb', 3, 'u2h', 'u2a', 'scheduled');
  add('dmu1', 'dm', 10, 'm2', 'm1', 'scheduled'); add('dmu2', 'dm', 30, 'm3', 'm4', 'scheduled');
  /* RESULTS: two ordinary; D2 men one 5 h ago and one 40 h ago (outside); women two (6 h, 20 h) */
  add('r1', 'slb', -3, 'r1h', 'r1a', 'final'); add('r2', 'bcb', -4, 'r2h', 'r2a', 'final');
  add('dmr1', 'dm', -5, 'm1', 'm3', 'final'); add('dmr2', 'dm', -40, 'm2', 'm4', 'final');
  add('dwr1', 'dw', -6, 'w5', 'w6', 'final'); add('dwr2', 'dw', -20, 'w3', 'w4', 'final');
  const state = {};
  games.filter(g => g.status === 'live').forEach(g => { state[g.id] = { game_id: g.id, period: 2, score_home: 40, score_away: 38, updated_at: at(0), clock_ms: 300000, running: false, break_ms: 0 }; });
  return { games, state };
}

/* --------------------------------------------------------- PostgREST stand-in --- */
function rest(W, log) {
  const lgOf = g => LG[g.lg];
  const full = g => ({ id: g.id, tipoff_at: g.tipoff_at, status: g.status, home_score: g.home_score, away_score: g.away_score, venue: g.venue,
    competition_id: COMP[g.lg], home: g.home, away: g.away,
    competitions: { id: COMP[g.lg], name: 'Regular season', kind: 'league', seasons: { id: 's-' + g.lg, name: '2026-27', leagues: lgOf(g) } } });
  const test = (v, raw) => {
    const m = /^(not\.)?(eq|neq|gte|gt|lte|lt|in|is)\.(.*)$/.exec(raw);
    if (!m) throw new Error('filter ' + raw);
    const [, not, op, arg] = m;
    const num = x => (/^\d{4}-\d\d-\d\dT/.test(String(x)) ? Date.parse(x) : x);
    let r;
    if (op === 'in') r = arg.slice(1, -1).split(',').includes(String(v));
    else if (op === 'eq') r = String(v) === arg;
    else if (op === 'neq') r = String(v) !== arg;
    else if (op === 'is') r = arg === 'null' ? v == null : String(v) === arg;
    else { const a = num(v), b = num(arg); r = op === 'gte' ? a >= b : op === 'gt' ? a > b : op === 'lte' ? a <= b : a < b; }
    return not ? !r : r;
  };
  return async (url, init) => {
    const u = new URL(url);
    const table = u.pathname.split('/rest/v1/')[1];
    const counted = !!(init && init.headers && init.headers.Prefer === 'count=exact');
    log.push({ table, url: decodeURIComponent(u.search), counted });
    const P = [...u.searchParams.entries()];
    const sel = u.searchParams.get('select') || '';
    const filters = P.filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
    let rows;
    if (table === 'leagues') rows = Object.values(LG);
    else if (table === 'league_next_games') rows = [{ league_id: LG.slb.id, game_id: 'u1' }, { league_id: LG.dm.id, game_id: 'dmu1' }];
    else if (table === 'competition_teams') {
      rows = CTEAMS.filter(r => filters.every(([k, v]) => test(r[k], v)));
    } else if (table === 'game_state') {
      rows = Object.values(W.state).filter(r => filters.every(([k, v]) => test(r[k], v)));
    } else if (table === 'games') {
      const col = (g, k) => (k === 'competitions.seasons.league_id' ? lgOf(g).id : g[k]);
      rows = W.games.filter(g => filters.every(([k, v]) => test(col(g, k), v)));
      const order = (u.searchParams.get('order') || '').split(',').filter(Boolean).map(o => o.split('.'));
      rows.sort((a, b) => { for (const [k, d] of order) { const x = k === 'tipoff_at' ? Date.parse(a[k]) : a[k], y = k === 'tipoff_at' ? Date.parse(b[k]) : b[k];
        if (x !== y) return (x < y ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
      if (sel.startsWith('id,competitions!inner')) rows = rows.map(g => ({ id: g.id, competitions: { seasons: { league_id: lgOf(g).id } } }));
      else if (sel.startsWith('id,competition_id,home_team_id')) rows = rows.map(g => ({ id: g.id, competition_id: COMP[g.lg], home_team_id: g.home.id, away_team_id: g.away.id,
        tipoff_at: g.tipoff_at, status: g.status, competitions: { seasons: { league_id: lgOf(g).id } } }));
      else rows = rows.map(full);
    } else rows = [];
    const total = rows.length;
    const off = +(u.searchParams.get('offset') || 0), lim = u.searchParams.has('limit') ? +u.searchParams.get('limit') : Infinity;
    rows = rows.slice(off, off + lim);
    const range = counted ? (rows.length ? off + '-' + (off + rows.length - 1) : '*') + '/' + total : null;
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(rows)), headers: { get: k => (String(k).toLowerCase() === 'content-range' ? range : null) } };
  };
}

/* --------------------------------------------------------------- stand-in DOM --- */
function simple(el, s) {
  if (!el || el.tag === '#text' || /:/.test(s)) return false;
  const m = s.match(/^([a-z]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
  if (!m) return false;
  if (m[1] && el.tag !== m[1].toLowerCase()) return false;
  return (m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []).every(p => {
    if (p[0] === '.') return (' ' + el.className + ' ').includes(' ' + p.slice(1) + ' ');
    if (p[0] === '#') return el.id === p.slice(1);
    const a = p.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
    const v = el.getAttribute(a[1]);
    return a[2] == null ? v != null : v === a[2];
  });
}
function matches(el, sel) {
  return sel.split(',').some(one => {
    const parts = one.trim().split(/\s+/);
    if (!simple(el, parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    for (let x = el.parentNode; x && i >= 0; x = x.parentNode) if (simple(x, parts[i])) i--;
    return i < 0;
  });
}
let doc;
class El {
  constructor(tag) {
    this.tag = tag; this.childNodes = []; this.attrs = {}; this.className = ''; this.id = ''; this._text = ''; this._html = '';
    this.listeners = {}; this.hidden = false; this.parentNode = null; this.dataset = {}; this.open = false; this.scrollLeft = 0; this.tabIndex = 0;
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
  }
  get children() { return this.childNodes.filter(c => c.tag !== '#text'); }
  get nextSibling() { const s = this.parentNode ? this.parentNode.childNodes : []; const i = s.indexOf(this); return i >= 0 ? s[i + 1] || null : null; }
  get classList() { const e = this; return {
    add: c => { if (!(' ' + e.className + ' ').includes(' ' + c + ' ')) e.className = (e.className + ' ' + c).trim(); },
    remove: c => { e.className = e.className.split(' ').filter(x => x && x !== c).join(' '); },
    toggle: (c, on) => { (on === undefined ? !e.classList.contains(c) : on) ? e.classList.add(c) : e.classList.remove(c); },
    contains: c => (' ' + e.className + ' ').includes(' ' + c + ' ') }; }
  set textContent(v) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; this._text = String(v); this._html = ''; }
  get textContent() { return this._text + this.childNodes.map(c => c.textContent).join(''); }
  set innerHTML(v) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; this._text = ''; this._html = String(v); }
  get innerHTML() { return this._html; }
  _out() { if (this.parentNode) { const s = this.parentNode.childNodes; s.splice(s.indexOf(this), 1); this.parentNode = null; } }
  appendChild(c) { c._out(); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c)); }
  insertBefore(c, ref) { if (ref == null) return this.appendChild(c); c._out(); const i = this.childNodes.indexOf(ref); c.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); return c; }
  removeChild(c) { if (c.parentNode === this) c._out(); return c; }
  remove() { this._out(); }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); this._out(); } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className; if (k === 'hidden') return this.hidden ? '' : null;
    if (k === 'href' && this.href != null) return this.href; return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatch(t) { (this.listeners[t] || []).forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} })); }
  click() { const ev = { target: this, preventDefault() {}, stopPropagation() {} }; for (let x = this; x; x = x.parentNode) (x.listeners.click || []).forEach(f => f(ev)); }
  all() { return this.childNodes.filter(c => c.tag !== '#text').flatMap(c => [c].concat(c.all())); }
  querySelectorAll(sel) { return this.all().filter(e => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(e) { for (let x = e; x; x = x.parentNode) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.parentNode) if (matches(x, sel)) return x; return null; }
  focus() { doc.activeElement = this; }
  get offsetHeight() { return 40 + 100 * this.querySelectorAll('.fxc').length; }
  getBoundingClientRect() { return { top: 10, left: 0, right: 100, bottom: 50, width: 100, height: 40 }; }
  scrollIntoView() {}
  animate() { return { finish() {} }; }
}
/* the reader opening or shutting a dropdown: the browser sets `open` and fires 'toggle' */
const toggle = async (det, open) => { det.open = open; det.dispatch('toggle'); await flush(); await flush(); };

/* ------------------------------------------------- one HOME, config.js + globalgames.js + daily.js --- */
function page(o) {
  const W = o.world || world();
  const log = [];
  const timers = [];
  const store = Object.assign({}, o.session || {});
  const sandbox = {
    localStorage: { getItem: () => null },
    location: { search: '' }, URLSearchParams, console,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    matchMedia: q => ({ matches: /reduce/.test(q), addEventListener() {} }),
    Intl, encodeURIComponent, decodeURIComponent, isFinite, parseInt, parseFloat
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  /* config.js as the existing tests run it: a document just big enough for its theme lines */
  const attrs = {};
  sandbox.document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] },
    querySelector: () => null, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } };
  sandbox.fetch = () => { throw new Error('config.js must not fetch'); };
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'config.js'), sandbox, { filename: 'config.js' });
  sandbox.Date = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => NOW : t[k]) });
  sandbox.fetch = rest(W, log);
  /* the page */
  const seg = new El('div'); seg.id = 'fxSeg';
  const tab = (fx, id) => { const b = new El('button'); b.setAttribute('data-fx', fx); b.id = id; seg.appendChild(b); return b; };
  const lb = tab('live', 'fxTabLive'); lb.hidden = true; const n = new El('b'); n.className = 'fx-n'; lb.appendChild(n);
  tab('up', 'fxTabUp'); tab('res', 'fxTabRes');
  const sayEl = new El('span'); sayEl.id = 'fxSay';
  const sec = new El('section');
  const host = new El('div'); host.id = 'homeDaily'; sec.appendChild(host);
  doc = { visibilityState: 'visible', activeElement: null, createElement: t => new El(t),
    createTextNode: t => { const e = new El('#text'); e._text = String(t); return e; },
    getElementById: id => (id === 'fxSeg' ? seg : id === 'fxSay' ? sayEl : null), addEventListener() {}, querySelectorAll: () => [] };
  sandbox.document = doc;
  let reg = null, pickOpts = null;
  sandbox.EpinoiaHome = { register: (k, f) => { if (k === 'fixtures') reg = f; }, fadeIn: e => e };
  sandbox.EpinoiaLeaguePick = { mount: x => { pickOpts = x; return { ids: () => null }; } };
  vm.runInContext(rd('epinoia', 'globalgames.js'), sandbox, { filename: 'globalgames.js' });
  vm.runInContext(rd('epinoia', 'home', 'daily.js'), sandbox, { filename: 'daily.js' });
  const P = {
    W, log, sec, host, seg, lb, sandbox, store,
    G: sandbox.EpinoiaGlobalGames,
    start: async () => { await reg({ host, base: '../' }); await flush(); await flush(); },
    tick: async () => { const t = timers.filter(x => x.ms >= 15000).pop(); timers.length = 0; await t.f(); await flush(); await flush(); await flush(); },
    tabTo: async fx => { seg.querySelector('button[data-fx="' + fx + '"]').click(); await flush(); await flush(); await flush(); },
    pick: async (ids, sel) => { pickOpts.onChange(ids ? new Set(ids) : null, { sel }); await flush(); await flush(); await flush(); },
    sel: () => (seg.querySelector('button[aria-selected="true"]') || {}).dataset.fx,
    cards: () => host.querySelectorAll('.fxc').map(c => c.getAttribute('data-game')),
    block: () => sec.querySelector('.fxg'),
    grp: () => sec.querySelector('details.fxg-grp'),
    parts: () => sec.querySelectorAll('details.fxg-part'),
    part: id => sec.querySelector('details.fxg-part[data-part="' + id + '"]'),
    confs: part => part.querySelectorAll('details.fxg-conf'),
    conf: (part, name) => part.querySelector('details.fxg-conf[data-conf="' + name + '"]'),
    count: det => { const s = det.querySelector('summary .hmf-n'); return s ? s.textContent : null; },
    name: det => { const s = det.querySelector('summary .fxg-nm'); return s ? s.textContent : null; },
    reads: re => log.filter(r => re.test(r.table + '?' + r.url))
  };
  return P;
}
const isLite = r => r.table === 'games' && /select=id,competition_id,home_team_id/.test(r.url);
const isCount = r => r.table === 'games' && /select=id,competitions!inner\(seasons!inner\(league_id\)\)/.test(r.url);
const isFull = r => r.table === 'games' && /select=id,tipoff_at,status,home_score/.test(r.url);
const byIds = r => isFull(r) && /[?&]id=in\./.test(r.url);
const notIn = (...ids) => '&competitions.seasons.league_id=not.in.(' + ids.join(',') + ')';

/* =============================================================================================== */
section('globalgames.js: the pure parts');
{
  ok('scopeQuery: exclude is a not.in on the season\'s league, only an eq / in; anything not a league id is left out',
     GG.scopeQuery({ exclude: [LG.dm.id, LG.dw.id] }) === notIn(LG.dm.id, LG.dw.id)
     && GG.scopeQuery({ only: [LG.slb.id] }) === '&competitions.seasons.league_id=eq.' + LG.slb.id
     && GG.scopeQuery({ exclude: ["x');drop", 'nope'] }) === '' && GG.scopeQuery(null) === '');
  ok('scoped() with nothing to scope is the module itself; with something, the same API with the three reads scoped',
     GG.scoped({}) === GG && GG.scoped({ exclude: [LG.dm.id] }).pickLive === GG.pickLive && GG.scoped({ exclude: [LG.dm.id] }).live !== GG.live
     && GG.scoped({ exclude: [LG.dm.id] }).scope.exclude[0] === LG.dm.id);
  const w = t => { const x = GG.groupWindow(t, NOW); return [x.status, x.from - NOW, x.to == null ? null : x.to - NOW]; };
  ok('the block\'s windows: live as the live read (8 h back), upcoming from 2 h back to 24 h on, results the last 36 h',
     JSON.stringify(w('live')) === JSON.stringify(['live', -8 * 3600e3, null]) && JSON.stringify(w('up')) === JSON.stringify(['scheduled', -2 * 3600e3, 24 * 3600e3])
     && JSON.stringify(w('res')) === JSON.stringify(['final', -36 * 3600e3, 0]));
  const confs = new Map([[COMP.dm, new Map([['m1', 'GLIAC'], ['m2', 'GLIAC'], ['m5', 'PSAC'], ['m7', 'NE10']])]]);
  const g = (id, h, a) => ({ id, competition_id: COMP.dm, home_team_id: h, away_team_id: a });
  ok('conferenceOf: both clubs in one conference is that conference', GG.conferenceOf(g('a', 'm1', 'm2'), confs) === 'GLIAC');
  ok('...two conferences is non-conference (\'\')', GG.conferenceOf(g('b', 'm7', 'm5'), confs) === '');
  ok('...a club with no conference (from outside the division), or a competition nobody filed, is non-conference',
     GG.conferenceOf(g('c', 'm1', 'm9'), confs) === '' && GG.conferenceOf(Object.assign(g('d', 'm1', 'm2'), { competition_id: 'other' }), confs) === '');
  ok('...and a full row (home / away objects) reads the same', GG.conferenceOf({ id: 'e', competition_id: COMP.dm, home: { id: 'm1' }, away: { id: 'm2' } }, confs) === 'GLIAC');
  const list = GG.byConference([g('1', 'm1', 'm2'), g('2', 'm2', 'm1'), g('3', 'm5', 'm7'), g('4', 'm1', 'm9'), g('5', 'm5', 'm6'), g('6', 'm7', 'm8'), g('1', 'm1', 'm2')],
    new Map([[COMP.dm, new Map([['m1', 'GLIAC'], ['m2', 'GLIAC'], ['m5', 'PSAC'], ['m6', 'PSAC'], ['m7', 'NE10'], ['m8', 'NE10']])]]));
  ok('byConference: most games first, then by name, non-conference last whatever its count, each game once',
     list.map(c => c.conf + ':' + c.n).join() === 'GLIAC:2,NE10:1,PSAC:1,:2', list.map(c => c.conf + ':' + c.n).join());
}

/* =============================================================================================== */
section('LIVE: the grouped leagues out of the list, one closed block after it, counts only');
const A = page({});
await A.start();
{
  const liveRead = A.log.find(r => r.table === 'games' && isFull(r) && /status=eq\.live/.test(r.url) && /limit=40/.test(r.url));
  ok('the main live read leaves both D2 leagues out, by address (it cannot be filled by them)',
     !!liveRead && liveRead.url.includes(notIn(LG.dm.id, LG.dw.id)), liveRead && liveRead.url);
  ok('LIVE is the tab, its badge counting the ordinary live games and D2\'s (2 + 7)', A.sel() === 'live' && A.lb.querySelector('.fx-n').textContent === '9' && !A.lb.hidden);
  ok('the list holds the ordinary live games only', A.cards().join() === 'n2,n1', A.cards().join());
  const blk = A.block();
  ok('ONE block, just after the tab panel (outside it, so the panel\'s redraws never take it)',
     !!blk && A.sec.children[1] === blk && A.sec.children[0] === A.host && !A.host.contains(blk) && A.sec.querySelectorAll('details.fxg-grp').length === 1);
  const grp = A.grp();
  ok('the block: NCAA D2 on a league badge (never translated), "7 live", shut',
     grp.getAttribute('data-grp') === 'ncaa-d2' && /<span class="lgb-name" translate="no">NCAA D2<\/span>/.test(grp.querySelector('.fxg-badge').innerHTML)
     && A.count(grp) === '7 live' && grp.open === false && /\bep-acc\b/.test(grp.className) && /\bfxc-lgrp\b/.test(grp.className), A.count(grp));
  const counts = A.log.filter(isCount);
  ok('closed, it is two counted reads (a part each), one row apiece, and no game is read',
     counts.length === 2 && counts.every(r => r.counted && /limit=1$/.test(r.url) && /status=eq\.live/.test(r.url))
     && counts.some(r => r.url.includes('league_id=eq.' + LG.dm.id)) && counts.some(r => r.url.includes('league_id=eq.' + LG.dw.id))
     && !A.log.some(isLite) && !A.log.some(byIds) && !A.log.some(r => r.table === 'competition_teams'), counts.map(r => r.url));
}

section('opening it, level by level: each reads only what it shows');
{
  const grp = A.grp();
  await toggle(grp, true);
  const parts = A.parts();
  ok('opened: its parts, Men then Women, each with its count', parts.length === 2 && A.name(parts[0]) === 'Men' && A.name(parts[1]) === 'Women'
     && A.count(parts[0]) === '5 live' && A.count(parts[1]) === '2 live', parts.map(p => A.name(p) + ' ' + A.count(p)));
  ok('...worded as the rail\'s MEN / WOMEN (the side context), with a link to the league',
     parts[0].querySelector('.fxg-nm').getAttribute('data-i18n-ctx') === 'side' && parts[0].querySelector('a.hmf-go').href === '../?l=ncaa-d2-men');
  ok('...and still no game read', !A.log.some(isLite) && !A.log.some(byIds));

  const men = A.part(LG.dm.id);
  await toggle(men, true);
  const lite = A.log.filter(isLite);
  ok('a part opened reads its games LITE (no names, no crests), that league alone, in the tab\'s window',
     lite.length === 1 && lite[0].url.includes('league_id=eq.' + LG.dm.id) && /status=eq\.live/.test(lite[0].url) && !A.log.some(byIds), lite.map(r => r.url));
  const ct = A.log.filter(r => r.table === 'competition_teams');
  ok('...and its clubs\' conferences, once, for the competition its games are in', ct.length === 1 && ct[0].url.includes('competition_id=in.(' + COMP.dm + ')')
     && /select=competition_id,team_id,group_name/.test(ct[0].url), ct.map(r => r.url));
  const cs = A.confs(men);
  ok('its conferences like leagues: most games first, non-conference last (two games, after PSAC\'s one), each with its count',
     cs.map(c => A.name(c) + ':' + A.count(c)).join() === 'GLIAC:2 live,PSAC:1 live,Non-conference:2 live', cs.map(c => A.name(c) + ':' + A.count(c)).join());
  ok('...a conference\'s name is never translated; "Non-conference" is a word, and is',
     cs[0].querySelector('.fxg-nm').getAttribute('translate') === 'no' && cs[2].querySelector('.fxg-nm').getAttribute('translate') == null && cs[2].getAttribute('data-conf') === 'none');
  ok('...every conference shut, and still no game read in full', cs.every(c => !c.open) && !A.log.some(byIds));
  ok('the women\'s part, shut, read nothing', !A.log.some(r => isLite(r) && r.url.includes(LG.dw.id)));

  const gl = A.conf(men, 'GLIAC');
  await toggle(gl, true);
  const full = A.log.filter(byIds);
  ok('a conference opened reads ITS games in full, by id, and the live ones\' state',
     full.length === 1 && /id=in\.\(dm1,dm2\)/.test(full[0].url) && A.log.some(r => r.table === 'game_state' && /dm1/.test(r.url) && /dm2/.test(r.url)), full.map(r => r.url));
  const cards = gl.querySelectorAll('.fxc');
  ok('...shown as the cards everywhere else, without a league badge, live with the scorer\'s score',
     cards.map(c => c.getAttribute('data-game')).join() === 'dm1,dm2' && !gl.querySelector('.fxc-lg') && /\bis-live\b/.test(cards[0].className)
     && cards[0].querySelector('.fxc-sc').textContent === '40', cards.map(c => c.getAttribute('data-game')).join());
  ok('...on the rail every league\'s cards are on', !!gl.querySelector('.fxg-games .fxc-rail'));
}

section('the 15-second refresh: what is open stays open, and only that is read again');
{
  const blk = A.block(), grp = A.grp(), men = A.part(LG.dm.id), gl = A.conf(men, 'GLIAC');
  /* meanwhile: PSAC's game ends, GLIAC's first game scores, the ordinary list's score moves (so the panel redraws) */
  A.W.games.find(g => g.id === 'dm3').status = 'final';
  A.W.state.dm1.score_home = 44;
  A.W.state.n1.score_home = 77;
  const before = A.log.length;
  await A.tick();
  const fresh = A.log.slice(before);
  ok('the panel redrew (a score changed) and the block is the same element, still just after it',
     A.block() === blk && A.sec.children[1] === blk && A.host.querySelector('.fxc[data-game="n1"] .fxc-sc').textContent === '77');
  ok('the group, the part and the conference are the same dropdowns, still open',
     A.grp() === grp && grp.open && A.part(LG.dm.id) === men && men.open && A.conf(men, 'GLIAC') === gl && gl.open);
  ok('the counts follow (7 -> 6 live, men 5 -> 4) and the conference whose games ended is gone',
     A.count(grp) === '6 live' && A.count(men) === '4 live' && !A.conf(men, 'PSAC')
     && A.confs(men).map(c => A.name(c)).join() === 'GLIAC,Non-conference', A.confs(men).map(c => A.name(c)).join());
  ok('the open conference\'s cards are read again (live) and show the new score',
     fresh.some(byIds) && gl.querySelector('.fxc[data-game="dm1"] .fxc-sc').textContent === '44');
  ok('only the open part is read again: the men\'s games, never the women\'s; the conferences are not read again (kept for the session)',
     fresh.filter(isLite).length === 1 && fresh.some(r => isLite(r) && r.url.includes(LG.dm.id)) && !fresh.some(r => isLite(r) && r.url.includes(LG.dw.id))
     && !fresh.some(r => r.table === 'competition_teams'), fresh.filter(isLite).map(r => r.url));
  ok('...and the conferences are kept in sessionStorage for the next page of the visit',
     Object.keys(A.store).some(k => k === 'epinoia_conf:' + COMP.dm) && /GLIAC/.test(A.store['epinoia_conf:' + COMP.dm]));
  await toggle(gl, false);
  const shutAt = A.log.length;
  await A.tick();
  ok('a conference shut is not read again', !A.log.slice(shutAt).some(byIds) && A.log.slice(shutAt).some(isLite));
  await toggle(gl, true);
  ok('...and opened again shows its games at once', gl.querySelectorAll('.fxc').length === 2);
}

section('RESULTS and UPCOMING: the same, in their windows, each tab its own open state');
{
  const before = A.log.length;
  await A.tabTo('res');
  const fresh = A.log.slice(before);
  const resRead = fresh.find(r => isFull(r) && /status=eq\.final/.test(r.url) && /limit=40/.test(r.url));
  ok('RESULTS: the list\'s read leaves D2 out too, and holds the ordinary finals only',
     A.sel() === 'res' && !!resRead && resRead.url.includes(notIn(LG.dm.id, LG.dw.id)) && A.cards().join() === 'r1,r2', A.cards().join());
  const grp = A.grp();
  ok('...its block counts the last 36 hours\' finals (4, with the PSAC game that ended at the tick; the 40-hour-old one is not one) and opens shut (each tab its own)',
     A.count(grp) === '4 results' && !grp.open, A.count(grp));
  const rc = fresh.filter(r => isCount(r) && /status=eq\.final/.test(r.url));
  ok('...counted in that window', rc.length === 2 && rc.every(r => r.url.includes('tipoff_at=gte.' + new Date(NOW - 36 * 3600e3).toISOString())
     && r.url.includes('tipoff_at=lt.' + new Date(NOW).toISOString())), rc.map(r => r.url));
  await toggle(grp, true);
  ok('...opened: Men "2 results", Women "2 results"', A.parts().map(p => A.name(p) + ' ' + A.count(p)).join() === 'Men 2 results,Women 2 results',
     A.parts().map(p => A.name(p) + ' ' + A.count(p)).join());

  await A.tabTo('up');
  const ug = A.grp();
  ok('UPCOMING: the list without D2 - not even the league\'s next game from league_next_games',
     A.sel() === 'up' && A.cards().length > 0 && !A.cards().some(id => /^dm|^dw/.test(id)), A.cards().join());
  ok('...its block: the coming day\'s games (1: the game 30 hours on is not one)', !!ug && A.count(ug) === '1 upcoming', ug && A.count(ug));
  await toggle(ug, true);
  ok('...opened: only the part with a game (Men), not an empty Women', A.parts().length === 1 && A.name(A.parts()[0]) === 'Men');

  await A.tabTo('live');
  const lg = A.grp(), men = A.part(LG.dm.id);
  ok('back on LIVE: the group, the men and GLIAC open as they were left, GLIAC\'s cards there',
     A.sel() === 'live' && lg.open && !!men && men.open && A.conf(men, 'GLIAC').open && A.conf(men, 'GLIAC').querySelectorAll('.fxc').length === 2);
}

section('CHECK VIA LEAGUE: a grouped league ticked by name joins the list; picked by its country it stays a block');
{
  const S = { epinoia_home_fxpick: JSON.stringify({ sel: { cont: [], cty: [], lg: [LG.dm.id] }, ids: [LG.dm.id] }) };
  const B = page({ session: S });
  await B.start();
  const lr = B.log.find(r => isFull(r) && /status=eq\.live/.test(r.url) && /limit=40/.test(r.url));
  ok('D2 men ticked by name: the live read is of D2 men (not excluded), the women still out',
     !!lr && lr.url.includes('league_id=eq.' + LG.dm.id) && lr.url.includes(notIn(LG.dw.id)) && !lr.url.includes('not.in.(' + LG.dm.id), lr && lr.url);
  ok('...its live games are the list\'s cards, and there is no block (the women are not picked)',
     B.cards().slice().sort().join() === 'dm1,dm2,dm3,dm4,dm5' && !B.block() && B.lb.querySelector('.fx-n').textContent === '5', B.cards().join());
  await B.tabTo('res');
  ok('...and on RESULTS the picked read holds its finals', B.cards().includes('dmr1') && !B.block(), B.cards().join());

  const C = page({ session: { epinoia_home_fxpick: JSON.stringify({ sel: { cont: [], cty: ['US'], lg: [] }, ids: [LG.dm.id, LG.dw.id] }) } });
  await C.start();
  const cr = C.log.find(r => isFull(r) && /status=eq\.live/.test(r.url) && /limit=40/.test(r.url));
  ok('picked through its COUNTRY (United States): D2 is not read into the list, it is the block',
     !!cr && cr.url.includes(notIn(LG.dm.id, LG.dw.id)) && C.cards().length === 0 && !!C.grp() && C.count(C.grp()) === '7 live', cr && cr.url);
  ok('...with nothing else live, LIVE is still the tab (D2\'s live games count), and says nothing is live only when nothing is',
     C.sel() === 'live' && !C.host.querySelector('.empty') && C.lb.querySelector('.fx-n').textContent === '7');
  await C.pick([LG.dm.id], { cont: [], cty: [], lg: [LG.dm.id] });
  ok('then ticking D2 men by name (leaguepick.js hands daily.js what is ticked): its games join the list and the block goes',
     C.cards().slice().sort().join() === 'dm1,dm2,dm3,dm4,dm5' && !C.block(), C.cards().join());
  await C.pick(null, { cont: [], cty: [], lg: [] });
  ok('...and clearing the pick puts every league back: the ordinary games listed, D2 its block again',
     C.cards().join() === 'n2,n1' && !!C.grp() && C.count(C.grp()) === '7 live', C.cards().join());
  const lp = rd('epinoia', 'home', 'leaguepick.js');
  ok('leaguepick.js passes the dropdowns\' choice with the ids', /o\.onChange\(pick, \{ sel: \{ cont: sel\.cont\.slice\(\), cty: sel\.cty\.slice\(\), lg: sel\.lg\.slice\(\) \} \}\)/.test(lp));
}

section('wiring');
{
  const dj = rd('epinoia', 'home', 'daily.js'), css = rd('epinoia', 'kit', 'home.css'), gj = rd('epinoia', 'globalgames.js');
  ok('daily.js never names a grouped league: groups come from config.js (epinoiaLeagueGroup through globalgames.js groups())',
     !/ncaa/i.test(dj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')) && /root\.epinoiaLeagueGroup/.test(gj) && /G0\.groups\(\)/.test(dj));
  ok('the block uses the kit\'s accordion (ep-acc, the live split\'s fxc-lgrp) and its own few rules in home.css',
     /'ep-acc hmf-acc fxg-acc '/.test(dj) && /\.fxg\{border-top:1px solid var\(--rule\)\}/.test(css) && /#homeDaily\[aria-busy="true"\] \+ \.fxg\{/.test(css));
  ok('"Non-conference" is in both core dictionaries', ['ja', 'es'].every(c => /'Non-conference': '[^']+'/.test(rd('epinoia', 'i18n', c + '.js'))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
