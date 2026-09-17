/* ============================================================================
   THE FULL TABLE ACROSS LEAGUES (global scouting, roadmap Phase 5).

   fulltable.js gained options a table over several leagues needs, every one of
   them opt-in. This pins:

     1. a caller that passes none of them gets the table it had: no LEAGUE column,
        no league select, a club select keyed by name, no pick buttons, no tray,
        no stat filters, and the RAPM button where a rapm function is given
     2. leagueColumn puts LEAGUE after GP in every preset; leagueSelect narrows
        to one league
     3. the club select is keyed by team id and labelled "LEI · SLB W", so two
        clubs with one short name stay two options
     4. rankWithinLeague: the same player id in two leagues is ranked in each
        league separately (percentiles, heat and position groups), and the
        toggle ranks across leagues instead
     5. locked(): a locked column is in no preset, not in the column drawer,
        not a stat filter and not a sort
     6. filters: two lines (3P% percentile >= 80 and 3PA/G >= 3) keep exactly
        the rows meeting both, the rate brings a volume floor of max(1, 25% of
        the median) stated in the count, and heat is ranked over the population
     7. selectable {max:5}: a sixth pick is refused, onCompare gets the picks
        and the visible preset's stat keys
     8. setRows league by league keeps the sort, the filters and the picks, and
        rebuilds the league and club lists
     9. state / onState round-trip; searchLeagues; noRapm
    10. the phone CSS: 16px inputs, 40px targets, the tray above the tab bar

   fulltable.js and season.js are run for real against a small DOM stub.

     node supabase/tests/fulltable-global.test.mjs
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

/* ---------------------------------------------------------------- helpers --- */
const heads = h => h.querySelector('div.ft-wrap').querySelectorAll('th').map(t => t.textContent);
const bodyRows = h => h.querySelector('div.ft-wrap').querySelector('tbody').querySelectorAll('tr');
const pill = (h, key) => h.querySelectorAll('button.ft-pill').find(b => b.dataset.g === key);
const cellOf = (h, name, label) => {
  const i = heads(h).indexOf(label);
  const tr = bodyRows(h).find(r => r.children[1].textContent === name);
  return tr && i > -1 ? tr.children[i] : null;
};
const draw = o => { const host = new El('div'); const api = Table.render(Object.assign({ host, kind: 'player' }, o)); return { host, api }; };
const pick = (sel, v) => { sel.value = v; sel.fire('change'); };
const optionsOf = sel => sel.querySelectorAll('option').map(o => [o.value, o.textContent]);

const LG = {
  bcb:  { leagueId: 'L-bcb', leagueSlug: 'bcb', leagueName: 'British Champions', leagueShort: 'BCB' },
  slbm: { leagueId: 'L-slbm', leagueSlug: 'slb-men', leagueName: 'Super League Basketball', leagueShort: 'SLB M' },
  slbw: { leagueId: 'L-slbw', leagueSlug: 'slb-women', leagueName: 'Super League Basketball Women', leagueShort: 'SLB W' }
};
/* a row as global.js makes it: id = league:player, the league on the row */
const gRow = (lg, pid, x) => Object.assign({
  id: LG[lg].leagueId + ':' + pid, playerId: pid, name: 'Name ' + lg + ' ' + pid,
  gp: 10, min: 250, ppg: 10, qualified: true
}, LG[lg], x);

/* ---- 1. callers without the options ------------------------------------------- */
console.log('\na caller without the new options gets the table it had');
const plain = n => Array.from({ length: n }, (_, i) => ({
  id: 'p' + i, name: 'Player ' + i, teamName: 'T' + (i % 3), gp: 10 - (i % 4), min: 200 + i, ppg: 5 + i, pts: 50 + i
}));
let { host: h, api } = draw({ rows: plain(12) });
const basicCols = Table.PLAYER_COLS.filter(c => c.g.includes('id') || (c.g.includes('basic'))).map(c => c.l);
ok('the per-game headers are exactly the catalogue order, with no LEAGUE', same(heads(h), basicCols), heads(h).join(' '));
ok('no league select, no rank-within-league, no qualified switch',
   !h.querySelector('select.ft-leaguesel') && !h.querySelector('button.ft-within') && !h.querySelector('button.ft-qual'));
ok('no stat filters and no tray', !h.querySelector('button.ft-statbtn') && !h.querySelector('div.ft-filt') && !h.querySelector('div.ft-tray'));
ok('the rank cell is plain text, not a pick button, and the host is not marked selectable',
   !h.querySelector('button.ft-pick') && bodyRows(h)[0].children[0].textContent === '1' && !h.classList.contains('ft-selectable'));
const plainTeamSel = h.querySelectorAll('select.ft-sel').find(s => !s.classList.contains('ft-possel'));
ok('the club select is keyed by name, as before', plainTeamSel && same(optionsOf(plainTeamSel).map(o => o[0]), ['', 'T0', 'T1', 'T2']),
   plainTeamSel && JSON.stringify(optionsOf(plainTeamSel)));
ok('the RAPM button is there when a rapm function is passed',
   draw({ rows: plain(4), rapm: async () => new Map() }).host.querySelectorAll('button.ft-btn').some(b => b.textContent === 'calc RAPM'));
ok('the tally is the plain count', h.querySelector('span.ft-tally').textContent === '12 players');
ok('render still returns redraw and setRows, plus the new readers',
   ['redraw', 'setRows', 'getView', 'getPool', 'getRanks', 'getSelected', 'getState'].every(k => typeof api[k] === 'function'));
({ host: h } = draw({ rows: plain(12), sortKey: 'no_such_column' }));
const gps = bodyRows(h).map(r => +r.children[heads(h).indexOf('GP')].textContent);
ok('an unknown sort falls back to GP, found by key', gps.every((g, i) => i === 0 || gps[i - 1] >= g), gps.join(','));
const T = draw({ kind: 'team', rows: [{ id: 't1', name: 'A', gp: 3, ppg: 80 }, { id: 't2', name: 'B', gp: 5, ppg: 90 }], sortKey: 'nope' });
ok('...and a team table keeps PPG, its fourth column, as that fallback',
   bodyRows(T.host)[0].children[1].textContent === 'B' && bodyRows(T.host).length === 2);
ok('fulltable.js no longer reaches for CAT[3] on a player table', /isTeam \? CAT\[3\] : CAT\.find\(x => x\.k === 'gp'\)/.test(rd('epinoia', 'fulltable.js')));

/* ---- 2 + 3. league column, league select, clubs keyed by id ---------------------- */
console.log('\nthe league column and the league and club selects');
const leagueRows = () => [
  gRow('bcb', 'a', { teamId: 'tb1', teamName: 'LEI', ppg: 20 }),
  gRow('bcb', 'b', { teamId: 'tb2', teamName: 'NOT', ppg: 18 }),
  gRow('slbm', 'c', { teamId: 'tm1', teamName: 'LEI', ppg: 16 }),
  gRow('slbm', 'd', { teamId: 'tm2', teamName: 'LON', ppg: 14 }),
  gRow('slbw', 'e', { teamId: 'tw1', teamName: 'LEI', ppg: 12 }),
  gRow('slbw', 'f', { teamId: 'tw1', teamName: 'LEI', ppg: 11 }),
  gRow('slbw', 'g', { teamId: 'tw2', teamName: 'LON', ppg: 10 })
];
({ host: h, api } = draw({ rows: leagueRows(), leagueColumn: true, leagueSelect: true, searchLeagues: true }));
let hd = heads(h);
ok('LEAGUE sits right after GP', hd[hd.indexOf('GP') + 1] === 'LEAGUE', hd.join(' '));
ok('...and shows the short name', cellOf(h, 'Name slbw e', 'LEAGUE').textContent === 'SLB W');
pill(h, 'totals').fire('click');
hd = heads(h);
ok('...in the totals preset too', hd[hd.indexOf('GP') + 1] === 'LEAGUE', hd.join(' '));
pill(h, '*').fire('click');
hd = heads(h);
ok('...and in everything, once', hd.filter(x => x === 'LEAGUE').length === 1 && hd[hd.indexOf('GP') + 1] === 'LEAGUE');
ok('LEAGUE is not a column-drawer toggle', !h.querySelector('div.ft-colgrid').children.some(b => b.textContent === 'LEAGUE'));
pill(h, 'basic').fire('click');
const lsel = h.querySelector('select.ft-leaguesel');
ok('a league select lists every league', lsel && same(optionsOf(lsel).map(o => o[1]), ['every league', 'BCB', 'SLB M', 'SLB W']),
   lsel && JSON.stringify(optionsOf(lsel)));
const tsel = h.querySelectorAll('select.ft-sel').find(s => !s.classList.contains('ft-possel') && !s.classList.contains('ft-leaguesel'));
const tOpts = optionsOf(tsel);
ok('the club select is keyed by team id', same(tOpts.map(o => o[0]).sort(), ['', 'tb1', 'tb2', 'tm1', 'tm2', 'tw1', 'tw2']), JSON.stringify(tOpts));
ok('...and the three LEIs are three options, labelled with their league',
   ['LEI · BCB', 'LEI · SLB M', 'LEI · SLB W'].every(l => tOpts.some(o => o[1] === l)) && tOpts.filter(o => /^LEI/.test(o[1])).length === 3);
pick(tsel, 'tw1');
ok('choosing LEI · SLB W shows only that club, not the other Leicesters',
   same(api.getView().map(r => r.id).sort(), ['L-slbw:e', 'L-slbw:f']), api.getView().map(r => r.id).join(','));
pick(lsel, 'L-slbm');
ok('choosing a league shows only its rows', api.getView().every(r => r.leagueId === 'L-slbm') && api.getView().length === 2);
ok('...drops a club from another league', api.getState().team === '');
ok('...and lists only that league’s clubs', same(optionsOf(tsel).map(o => o[0]).sort(), ['', 'tm1', 'tm2']), JSON.stringify(optionsOf(tsel)));
pick(lsel, '');
const q = h.querySelector('input.grow');
q.value = 'women'; q.fire('input'); flushTimers();
ok('searchLeagues: the search matches a league name', api.getView().length === 3 && api.getView().every(r => r.leagueId === 'L-slbw'),
   api.getView().map(r => r.id).join(','));
({ host: h, api } = draw({ rows: leagueRows(), leagueColumn: true }));
const q2 = h.querySelector('input.grow');
q2.value = 'women'; q2.fire('input'); flushTimers();
ok('...and only when asked', api.getView().length === 0);

/* ---- 4. within-league percentiles ----------------------------------------------- */
console.log('\nranked within league');
/* the same player, 'p1', in two leagues: top of a weak league, bottom of a strong one */
const twoLeagues = () => [
  gRow('bcb', 'p1', { ppg: 40, bpm_pos: 1.0 }), gRow('bcb', 'x1', { ppg: 10, bpm_pos: 1.2 }),
  gRow('bcb', 'x2', { ppg: 20, bpm_pos: 1.4 }), gRow('bcb', 'x3', { ppg: 30, bpm_pos: 1.6 }),
  gRow('bcb', 'x4', { ppg: 12, bpm_pos: 1.8 }), gRow('bcb', 'x5', { ppg: 14, bpm_pos: 2.0 }),
  gRow('slbm', 'p1', { ppg: 50, bpm_pos: 4.0 }), gRow('slbm', 'y1', { ppg: 60, bpm_pos: 4.2 }),
  gRow('slbm', 'y2', { ppg: 70, bpm_pos: 4.4 }), gRow('slbm', 'y3', { ppg: 80, bpm_pos: 4.6 }),
  gRow('slbm', 'y4', { ppg: 55, bpm_pos: 4.8 }), gRow('slbm', 'y5', { ppg: 65, bpm_pos: 5.0 })
];
({ host: h, api } = draw({ rows: twoLeagues(), leagueColumn: true, leagueSelect: true }));
let rk = api.getRanks(['ppg']).get('ppg');
ok('on by default with a league column: two rows for one player id', api.getView().filter(r => r.playerId === 'p1').length === 2);
ok('...the BCB row is ranked against BCB (100th)', rk.get('L-bcb:p1') === 100, rk.get('L-bcb:p1'));
ok('...the SLB row against SLB (0th)', rk.get('L-slbm:p1') === 0, rk.get('L-slbm:p1'));
ok('...and the heat says so: top shade for one, bottom for the other',
   /var\(--good\) 34%/.test(cellOf(h, 'Name bcb p1', 'PPG').style.cssText) &&
   /var\(--flare\) 24%/.test(cellOf(h, 'Name slbm p1', 'PPG').style.cssText),
   cellOf(h, 'Name bcb p1', 'PPG').style.cssText + ' | ' + cellOf(h, 'Name slbm p1', 'PPG').style.cssText);
const posSel = h.querySelector('select.ft-possel');
pick(posSel, 'C');
ok('position groups are cut per league: the bigs are the top third of EACH league',
   same(api.getView().map(r => r.leagueId).sort(), ['L-bcb', 'L-bcb', 'L-slbm', 'L-slbm']), api.getView().map(r => r.id).join(','));
const within = h.querySelector('button.ft-within');
ok('the toggle is on and pressed', within && within.classList.contains('pri') && within.getAttribute('aria-pressed') === 'true');
within.fire('click');
ok('toggled off, the position groups are cut over every league', api.getView().every(r => r.leagueId === 'L-slbm') && api.getView().length === 4,
   api.getView().map(r => r.id).join(','));
pick(posSel, '');
rk = api.getRanks(['ppg']).get('ppg');
ok('...and the same player is ranked across both leagues',
   /* 12 values: 40 has five below it, 50 has six */
   Math.abs(rk.get('L-bcb:p1') - 500 / 11) < 1e-9 && Math.abs(rk.get('L-slbm:p1') - 600 / 11) < 1e-9,
   rk.get('L-bcb:p1') + ' / ' + rk.get('L-slbm:p1'));
ok('rankWithinLeague:false starts it off', draw({ rows: twoLeagues(), leagueColumn: true, rankWithinLeague: false }).api.getState().withinLeague === false);

/* ---- 5. locked columns -------------------------------------------------------- */
console.log('\nlocked columns');
const LOCKED = k => k === 'bpm' || k === 'ts' || /^ev_/.test(k);
({ host: h, api } = draw({ rows: twoLeagues(), leagueColumn: true, locked: LOCKED, filters: true, state: { sort: 'bpm' } }));
pill(h, '*').fire('click');
hd = heads(h);
const lockedLabels = Table.PLAYER_COLS.filter(c => LOCKED(c.k)).map(c => c.l);
ok('everything shows no locked column', !hd.includes('BPM') && !hd.includes('TS%') && hd.length === 3 + Table.PLAYER_COLS.filter(c => !c.g.includes('id') && !LOCKED(c.k)).length + 1,
   hd.length);
pill(h, 'advanced').fire('click');
ok('advanced leaves BPM and TS% out', !heads(h).includes('BPM') && !heads(h).includes('TS%') && heads(h).includes('OBPM'));
ok('a preset made only of locked columns is marked locked', pill(h, 'ev_second').classList.contains('locked') && !pill(h, 'basic').classList.contains('locked'));
pill(h, 'ev_second').fire('click');
ok('...and pressing it does not open an empty view', pill(h, 'advanced').classList.contains('on'));
const drawerCount = h.querySelector('div.ft-colgrid').children.length;
ok('the column drawer has every column but the locked ones',
   drawerCount === Table.PLAYER_COLS.filter(c => !c.g.includes('id') && !LOCKED(c.k)).length, drawerCount);
h.querySelector('button.ft-statbtn').fire('click');
h.querySelector('button.ft-fadd').fire('click');
const statOpts = optionsOf(h.querySelector('select.ft-fstat')).map(o => o[0]);
ok('the stat filter offers no locked stat', statOpts.length > 20 && !statOpts.some(LOCKED) && statOpts.includes('ppg') && statOpts.includes('p3a_pg'),
   statOpts.length);
ok('a sort by a locked column falls back to GP', api.getState().sort === 'bpm' && heads(h).includes('GP'));
const lockedState = draw({ rows: twoLeagues(), locked: LOCKED, filters: true,
  state: { filters: [{ k: 'ts', op: 'ge', mode: 'pct', x: 50 }, { k: 'ppg', op: 'ge', mode: 'val', x: 30 }] } }).api.getState();
ok('a filter on a locked column restored from a URL is dropped', same(lockedState.filters.map(f => f.k), ['ppg']), JSON.stringify(lockedState.filters));

/* ---- 6. stat filters and the volume floor --------------------------------------- */
console.log('\nstat filters');
/* 20 BCB players: 3P% rising with i, attempts varied; two traps -- a perfect shooter on 0.4
   attempts (under the floor) and a fine shooter on 2 attempts (under the 3 asked for) */
const shooters = () => Array.from({ length: 20 }, (_, i) => gRow('bcb', 's' + i, {
  p3_pct: 20 + i * 2, p3a_pg: [4, 5, 1.5, 3.5, 6, 2, 3, 4.5, 1, 5.5][i % 10], ppg: 5 + i
})).concat([gRow('bcb', 'perfect', { p3_pct: 100, p3a_pg: 0.4, ppg: 3 }), gRow('bcb', 'twoAtt', { p3_pct: 70, p3a_pg: 2, ppg: 4 })]);
const TWO = [{ k: 'p3_pct', op: 'ge', mode: 'pct', x: 80 }, { k: 'p3a_pg', op: 'ge', mode: 'val', x: 3 }];
POOLS.length = 0;
({ host: h, api } = draw({ rows: shooters(), leagueColumn: true, filters: true, state: { filters: TWO } }));
/* the expectation, worked out here rather than read back from the table */
const pop = shooters();
const vols = pop.map(r => r.p3a_pg).filter(v => v > 0).sort((a, b) => a - b);
const floor = Math.max(1, Math.ceil(0.25 * vols[Math.floor(vols.length / 2)] * 10 - 1e-9) / 10);
const clear = pop.filter(r => r.p3a_pg >= floor);
const pct = Season.percentiles(clear, ['p3_pct'], [], r => r.leagueId).get('p3_pct');
const expected = clear.filter(r => pct.get(r.id) >= 80 && r.p3a_pg >= 3).map(r => r.id).sort();
const got = api.getView().map(r => r.id).sort();
ok('two lines keep exactly the rows meeting both', expected.length > 0 && same(got, expected), got.join(',') + ' vs ' + expected.join(','));
ok('...the perfect shooter on 0.4 attempts is not one of them', !got.includes('L-bcb:perfect'));
ok('...nor the good one on 2 attempts', !got.includes('L-bcb:twoAtt'));
ok('the floor is max(1, a quarter of the median volume)', floor === 1, floor);
const tally = h.querySelector('span.ft-tally').textContent;
ok('the count names the volume minimum', tally.includes('min 3PA/G ' + floor.toFixed(1) + ' for 3P%') && tally.startsWith(got.length + ' players'), tally);
const heatPools = POOLS.filter(p => p.keys.includes('ppg'));
ok('heat is ranked over the population (22), not the survivors', heatPools.length && heatPools[heatPools.length - 1].n === 22,
   heatPools.map(p => p.n).join(','));
const p3Pools = POOLS.filter(p => p.keys.length === 1 && p.keys[0] === 'p3_pct');
ok('...but the floored rate’s heat is ranked as the filter ranked it: among the players who clear the floor',
   p3Pools.length && p3Pools[p3Pools.length - 1].n === clear.length, p3Pools.map(p => p.n).join(',') + ' vs ' + clear.length);
const chartRanks = api.getRanks(['p3_pct', 'ppg']);
ok('getRanks agrees with the filter on the floored rate, so the chart cannot contradict it',
   got.every(id => chartRanks.get('p3_pct').get(id) === pct.get(id) && pct.get(id) >= 80),
   got.map(id => chartRanks.get('p3_pct').get(id) + '/' + pct.get(id)).join(' '));
ok('the filters button counts the lines', /stat filters · 2/.test(h.querySelector('button.ft-statbtn').textContent) &&
   /filters · 2/.test(h.querySelector('button.ft-filters').textContent));
/* a high floor: the median volume of a heavy-shooting pool lifts the minimum above 1 */
const heavy = Array.from({ length: 9 }, (_, i) => gRow('bcb', 'h' + i, { p3_pct: 30 + i, p3a_pg: 8 + i }));
({ api } = draw({ rows: heavy.concat([gRow('bcb', 'light', { p3_pct: 60, p3a_pg: 2.5 })]), filters: true,
  state: { filters: [{ k: 'p3_pct', op: 'ge', mode: 'val', x: 0 }] } }));
ok('a quarter of a 12-attempt median is 3.0: a 2.5-attempt shooter is under it',
   api.getView().length === 9 && !api.getView().some(r => r.playerId === 'light'), api.getView().length);
({ host: h, api } = draw({ rows: shooters(), filters: true }));
h.querySelector('button.ft-statbtn').fire('click');
h.querySelectorAll('button.ft-fset').find(b => b.textContent === 'shooters').fire('click');
ok('the "shooters" quick set is those same two lines', same(api.getState().filters, TWO), JSON.stringify(api.getState().filters));
ok('...and a table without a league column ranks the whole table', same(api.getView().map(r => r.id).sort(), expected));
h.querySelector('button.ft-fclear').fire('click');
ok('clear takes every line away', api.getView().length === 22 && api.getState().filters.length === 0);
h.querySelector('button.ft-fadd').fire('click');
const line = h.querySelector('div.ft-fline');
pick(line.querySelector('select.ft-fstat'), 'ppg');
line.querySelector('button.ft-fmode').fire('click');         // pctl -> value
const val = line.querySelector('input.ft-fval');
val.value = '20'; val.fire('input');
ok('a typed number waits for the pause', api.getView().length === 22);
flushTimers();
ok('...then keeps PPG >= 20', api.getView().length === 5 && api.getView().every(r => r.ppg >= 20), api.getView().map(r => r.ppg).join(','));
line.querySelector('button.ft-fop').fire('click');
ok('the op toggles to <=', api.getView().every(r => r.ppg <= 20) && api.getView().length === 18, api.getView().length);

/* ---- 7. picks and compare --------------------------------------------------------- */
console.log('\npicks and the compare tray');
let compared = null;
({ host: h, api } = draw({ rows: twoLeagues(), leagueColumn: true, selectable: { max: 5 },
  onCompare: (rows, keys) => { compared = { rows, keys }; } }));
ok('the host is marked selectable and the rank cell is a 44px pick button',
   h.classList.contains('ft-selectable') && bodyRows(h)[0].children[0].querySelector('button.ft-pick'));
const tray = h.querySelector('div.ft-tray');
ok('the tray is hidden with nothing picked', tray && tray.hidden === true);
const picks = () => bodyRows(h).map(r => r.children[0].querySelector('button.ft-pick'));
picks().slice(0, 6).forEach(b => b.fire('click'));
ok('five picks are taken', api.getSelected().length === 5);
ok('...the sixth is refused and said so', picks()[5].getAttribute('aria-pressed') === 'false' &&
   /5 players at most/.test(tray.textContent) && tray.hidden === false);
ok('...picked rows are pressed and marked', picks().slice(0, 5).every(b => b.getAttribute('aria-pressed') === 'true') &&
   bodyRows(h)[0].classList.contains('picked'));
ok('the tray lists them numbered 1-5 with their league', tray.querySelectorAll('span.ft-chip').length === 5 &&
   tray.querySelectorAll('b.ft-chipn').map(b => b.textContent).join('') === '12345' && /· SLB M|· BCB/.test(tray.textContent));
const go = tray.querySelector('button.ft-compare');
go.fire('click');
const basicHeat = Table.PLAYER_COLS.filter(c => c.g.includes('basic') && c.heat).map(c => c.k);
ok('Compare hands over the picked rows in order', compared && same(compared.rows.map(r => r.id), bodyRows(h).slice(0, 5).map(r => r.children[0].querySelector('button.ft-pick').dataset.id)));
ok('...and the visible preset’s stat keys', compared && same(compared.keys, basicHeat), compared && compared.keys.join(','));
tray.querySelector('button.ft-chipx').fire('click');
ok('a chip’s × takes that player out', api.getSelected().length === 4 && h.querySelector('div.ft-tray').querySelectorAll('span.ft-chip').length === 4);
pill(h, 'shooting').fire('click');
compared = null;
h.querySelector('div.ft-tray').querySelector('button.ft-compare').fire('click');
ok('after a preset change, the keys are that preset’s', compared && same(compared.keys,
   Table.PLAYER_COLS.filter(c => c.g.includes('shooting') && c.heat).map(c => c.k)), compared && compared.keys.join(','));
ok('picks survive a redraw', picks().filter(b => b.getAttribute('aria-pressed') === 'true').length === 4);
h.querySelector('div.ft-tray').querySelector('button.ft-trayclear').fire('click');
picks()[0].fire('click');
compared = null;
const go1 = h.querySelector('div.ft-tray').querySelector('button.ft-compare');
go1.fire('click');
ok('with one pick Compare is disabled and does nothing', go1.disabled === true && compared === null);
ok('getRanks gives a picked player a rank even when a filter has left him out', (() => {
  const r = api.getRanks(['ppg']); return r.get('ppg') && r.get('ppg').has(api.getSelected()[0].id); })());
ok('the body is marked while the tray shows, so the bell can move above it', document.body.classList.contains('ft-tray-open'));
h.querySelector('div.ft-tray').querySelector('button.ft-trayclear').fire('click');
ok('...and unmarked once it hides', !document.body.classList.contains('ft-tray-open'));

/* a pick from a league the league select has since left out */
({ host: h, api } = draw({ rows: twoLeagues(), leagueColumn: true, leagueSelect: true, selectable: { max: 5 } }));
const pickId = id => picks().find(b => b.dataset.id === id).fire('click');
pickId('L-bcb:p1'); pickId('L-bcb:x1');
pick(h.querySelector('select.ft-leaguesel'), 'L-slbm');
pickId('L-slbm:y1');
let crossRk = api.getRanks(['ppg']).get('ppg');
ok('a pick outside the chosen league keeps his own league’s rank (not alone in a group, not "no data")',
   crossRk.get('L-bcb:p1') === 100 && crossRk.get('L-bcb:x1') === 0 && crossRk.get('L-slbm:y1') === 40,
   [crossRk.get('L-bcb:p1'), crossRk.get('L-bcb:x1'), crossRk.get('L-slbm:y1')].join(' / '));
h.querySelector('button.ft-within').fire('click');
crossRk = api.getRanks(['ppg']).get('ppg');
ok('...and ranked across every league with the toggle off, not against the chosen league alone',
   Math.abs(crossRk.get('L-bcb:p1') - 500 / 11) < 1e-9 && crossRk.get('L-bcb:x1') === 0,
   [crossRk.get('L-bcb:p1'), crossRk.get('L-bcb:x1')].join(' / '));

/* a lock that arrives later takes the preset and a filter away, and says so */
let lateLock = false;
const lateStates = [];
({ host: h, api } = draw({ rows: twoLeagues(), filters: true, locked: k => lateLock && (k === 'ts' || /^ev_/.test(k)),
  state: { preset: 'ev_second', filters: [{ k: 'ts', op: 'ge', mode: 'val', x: 0 }, { k: 'ppg', op: 'ge', mode: 'val', x: 0 }] },
  onState: s => lateStates.push(s) }));
ok('before the lock: the preset and both filters stand', api.getState().preset === 'ev_second' && api.getState().filters.length === 2,
   JSON.stringify(api.getState()));
lateLock = true;
api.setRows(twoLeagues());
ok('a relock that changes the preset or the filters reports the state once',
   lateStates.length === 1 && lateStates[0].preset !== 'ev_second' && same(lateStates[0].filters.map(f => f.k), ['ppg']),
   JSON.stringify(lateStates));
api.setRows(twoLeagues());
ok('...and a setRows that changes nothing reports nothing', lateStates.length === 1, lateStates.length);

/* ---- 8. setRows league by league --------------------------------------------------- */
console.log('\nrows that arrive league by league');
const all = twoLeagues().concat([gRow('slbw', 'z1', { ppg: 45, teamId: 'tw1', teamName: 'LEI' }),
  gRow('slbw', 'z2', { ppg: 25, teamId: 'tw1', teamName: 'LEI' }), gRow('slbw', 'z3', { ppg: 35, teamId: 'tw2', teamName: 'LON' })]);
const bcbOnly = all.filter(r => r.leagueId === 'L-bcb').map(r => Object.assign({}, r, { teamId: 'tb1', teamName: 'LEI' }));
const later = all.map(r => r.leagueId === 'L-bcb' ? Object.assign({}, r, { teamId: 'tb1', teamName: 'LEI' }) : r);
const states = [];
({ host: h, api } = draw({ rows: bcbOnly, leagueColumn: true, leagueSelect: true, filters: true, selectable: { max: 5 },
  state: { sort: 'ppg', dir: -1, filters: [{ k: 'ppg', op: 'ge', mode: 'val', x: 12 }] }, onState: s => states.push(s) }));
ok('first league: filtered and sorted', same(api.getView().map(r => r.ppg), [40, 30, 20, 14, 12]), api.getView().map(r => r.ppg).join(','));
picks()[1].fire('click');
const pickedId = api.getSelected()[0].id;
api.setRows(later.filter(r => r.leagueId !== 'L-slbw'));
api.setRows(later);
ok('after two more leagues the filter still holds and the sort is kept',
   same(api.getView().map(r => r.ppg), [80, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 14, 12]), api.getView().map(r => r.ppg).join(','));
ok('...the pick is kept, and still pressed in the redrawn table', api.getSelected().length === 1 && api.getSelected()[0].id === pickedId &&
   picks().find(b => b.dataset.id === pickedId).getAttribute('aria-pressed') === 'true');
ok('...the league select now lists all three', optionsOf(h.querySelector('select.ft-leaguesel')).length === 4);
const tsel2 = h.querySelectorAll('select.ft-sel').find(s => !s.classList.contains('ft-possel') && !s.classList.contains('ft-leaguesel'));
ok('...and the club select, absent with one club, is added with the new clubs',
   tsel2 && tsel2.parentNode && same(optionsOf(tsel2).map(o => o[1]).slice(1), ['LEI · BCB', 'LEI · SLB W', 'LON · SLB W']),
   tsel2 && JSON.stringify(optionsOf(tsel2)));
ok('setRows did not report a state change of its own', states.length === 0, states.length);
ok('the tally counts the new rows', h.querySelector('span.ft-tally').textContent === '14 players', h.querySelector('span.ft-tally').textContent);
ok('a restored league not yet arrived is kept, not dropped',
   draw({ rows: bcbOnly, leagueSelect: true, state: { league: 'L-slbw' } }).api.getState().league === 'L-slbw');

/* ---- 9. state, onState, noRapm ------------------------------------------------------ */
console.log('\nstate for the URL');
states.length = 0;
({ host: h, api } = draw({ rows: all, leagueColumn: true, leagueSelect: true, filters: true, pageSize: 5, onState: s => states.push(s) }));
heads(h); h.querySelector('div.ft-wrap').querySelectorAll('th').find(t => t.textContent === 'GP').fire('click');
ok('a sort reports the state', states.length === 1 && states[0].sort === 'gp' && states[0].dir === -1, JSON.stringify(states[0]));
pick(h.querySelector('select.ft-leaguesel'), 'L-slbm');
h.querySelector('button.ft-within').fire('click');
h.querySelector('button.ft-morerows').fire('click');
pill(h, 'advanced').fire('click');
const st = api.getState();
ok('league, within-league, page and preset are all in it',
   st.league === 'L-slbm' && st.withinLeague === false && st.page === 2 && st.preset === 'advanced' && states.length === 5,
   JSON.stringify(st) + ' after ' + states.length);
const back = draw({ rows: all, leagueColumn: true, leagueSelect: true, filters: true, pageSize: 5,
  state: Object.assign({}, st, { search: 'Name', filters: TWO }) }).api.getState();
ok('the state a page stored draws the same table back', same(back, Object.assign({}, st, { search: 'Name', filters: TWO })), JSON.stringify(back));
({ host: h } = draw({ rows: all, rapm: async () => new Map(), noRapm: true }));
ok('noRapm: no RAPM button though a rapm function was passed', !h.querySelectorAll('button.ft-btn').some(b => b.textContent === 'calc RAPM'));
pill(h, 'onoff').fire('click');
ok('...and no RAPM columns', !heads(h).some(x => /RAPM/.test(x)) && heads(h).includes('NET ±'));
({ host: h, api } = draw({ rows: all.map((r, i) => Object.assign({}, r, { qualified: i % 2 === 0 })), leagueColumn: true }));
ok('rows that say who qualified: a switch, on by default', h.querySelector('button.ft-qual').classList.contains('pri') && api.getView().length === 8);
h.querySelector('button.ft-qual').fire('click');
ok('...and off shows everyone', api.getView().length === 15);

/* ---- 10. the stylesheet ------------------------------------------------------------ */
console.log('\nthe phone stylesheet');
const css = rd('epinoia', 'kit', 'table.css').replace(/\/\*[\s\S]*?\*\//g, '');
const phoneBlocks = css.split('@media (max-width:820px)').slice(1).join('\n');
ok('filter inputs are 16px on a phone (no focus zoom)', /\.ft-bar \.ft-fstat, \.ft-bar \.ft-fval\{[^}]*font-size:16px/.test(phoneBlocks));
ok('filter buttons and quick sets are 40px or more', /\.ft-bar \.ft-fop, \.ft-bar \.ft-fx\{[^}]*min-height:44px/.test(phoneBlocks) &&
   /\.ft-fquick \.ft-col\{[^}]*min-height:40px/.test(phoneBlocks));
ok('the stat takes its own line on a phone', /\.ft-fline \.ft-fstat\{\s*grid-column:1 \/ -1/.test(phoneBlocks));
ok('the tray sticks above the bar at its measured height, 58px and the inset only as a fallback',
   /body\.has-nav \.ft-tray\{[^}]*bottom:var\(--ep-nav-h, calc\(58px \+ env\(safe-area-inset-bottom,0px\)\)\)/.test(phoneBlocks));
ok('the bell is lifted above the tray while it shows', /body\.has-nav\.ft-tray-open \.ep-bell\{[^}]*bottom:calc\(var\(--ep-nav-h,[^}]*var\(--ft-tray-h/.test(phoneBlocks));
ok('fulltable.js measures the bar and the tray into those variables',
   /setProperty\('--ep-nav-h', hOf\(nav\) \+ 'px'\)/.test(rd('epinoia', 'fulltable.js')) &&
   /setProperty\('--ft-tray-h', hOf\(tray\) \+ 'px'\)/.test(rd('epinoia', 'fulltable.js')) &&
   /Math\.ceil\(n\.getBoundingClientRect/.test(rd('epinoia', 'fulltable.js')));
ok('...and keeps the inset itself where there is no tab bar', /\.ft-tray\{[^}]*padding:[^;]*env\(safe-area-inset-bottom,0px\)/.test(css));
ok('tray chips, their × and the pick cell are 40px on a phone',
   /\.ft-chipx\{[^}]*min-height:40px/.test(phoneBlocks) && /\.ft-host \.ft-pick\{\s*height:40px/.test(phoneBlocks));
ok('the pinned name moves right of the wider pick cell', /\.ft-host\.ft-selectable table\.ft td\.c1\{\s*left:44px/.test(css));
ok('series colours match the compare chart and avoid --good and --flare',
   /data-n="2"\] \.ft-chipn\{\s*background:var\(--aqua\)/.test(css) && /data-n="5"\] \.ft-chipn\{\s*background:var\(--ink-2\)/.test(css) &&
   !/ft-chip[^{]*\{[^}]*var\(--(good|flare)\)/.test(css));
ok('the tray has a light-theme surface', /:root\[data-theme="light"\] \.ft-tray\{/.test(css));

globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
