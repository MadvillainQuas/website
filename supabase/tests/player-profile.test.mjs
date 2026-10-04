/* ============================================================================
   THE PLAYER PROFILE'S UPGRADES (2026-10-02), run on a small stand-in for the page.

     node supabase/tests/player-profile.test.mjs

   What is held here:
     * THE GAME LOG (p/gamelog.js): a statistic picked by a chip or by its column's heading is charted game by game,
       oldest first; a shooting percentage is makes over attempts over whatever stretch a figure covers (never an
       average of percentages) and a game without an attempt has no bar; the running line is the last five games';
       the facts are the season, the last five, the two halves and the best game (a percentage's from his usual
       number of attempts); the table names each game's competition, lights the charted column and tints its cells
       against his season; the game's BPM is a statistic and game score is not;
     * EACH GAME'S BPM (bpm.js gameFromBox): from both sides' lines, nothing from one side's alone, nothing for a
       player without a minute, and the team adjustment holds (the roster's minutes-weighted BPM is 1.2 x net);
     * ON THE FLOOR WITH (wowy.js deltaCell / onOffTiles, p/withui.js): a gap is green where it is better, red where
       it is worse (a lower defensive rating is better), grey where more is only a style, with a bar from the centre
       to the right for better; the teammates come most minutes together first, ten and "more";
     * THE POSITION BREAKDOWN (p/player.js paintPosBreakdown): his minutes at each position from the games' position
       files, or from their lineups ranked as the depth chart ranks them (the newest three files are asked first,
       and no more when none exist), drawn on a half court, each spot coloured by its share, his main one ringed;
     * CAREER STATS (p/player.js paintCareer): every season and competition of his and his linked profiles', a row
       each with its competition, each row a link that shows that season and competition on the page;
     * the competition's short name (seasonbar.js compLabel) and the page's wiring.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d).slice(0, 500) : '')); } };
const near = (a, b, e) => a != null && Math.abs(a - b) <= (e == null ? 1e-9 : e);

/* ------------------------------------------------------------------ a stand-in page --- */
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this._html = null;
    this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this._cls = new Set(); this.clientWidth = 640;
    const self = this;
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.classList = { add: (...c) => c.forEach(x => self._cls.add(x)), remove: (...c) => c.forEach(x => self._cls.delete(x)),
      contains: c => self._cls.has(c), toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; if (on) self._cls.add(c); else self._cls.delete(c); return on; } };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); this._html = null; }
  set innerHTML(v) { this.textContent = ''; this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? Object.assign(new Node('#text'), { _text: n }) : n)); }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this;
    const i = this.children.indexOf(ref); if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  setAttribute(k, v) { if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); else this.attrs[k] = String(v); }
  getAttribute(k) { if (k.startsWith('data-')) { const v = this.dataset[camel(k.slice(5))]; return v == null ? null : v; } return this.attrs[k] != null ? this.attrs[k] : null; }
  removeAttribute(k) { if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))]; else delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { const e = { target: this, preventDefault() {}, stopPropagation() {} }; if (this.onclick) this.onclick(e); (this.listeners.click || []).forEach(f => f(e)); }
  matches(sel) { return sel.split(',').some(s => matchSel(this, s.trim())); }
  closest(sel) { let n = this; while (n && n.tagName) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { const out = []; const walk = n => n.children.forEach(c => { if (c.tagName !== '#TEXT' && c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function matchOne(n, comp) {
  const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(comp);
  if (!m) throw new Error('the stand-in cannot read ' + comp);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  if (!m[2].split('.').filter(Boolean).every(c => n._cls.has(c))) return false;
  return [...m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) => { const x = n.getAttribute(k); return v === undefined ? x != null : x === v; });
}
function matchSel(n, sel) {
  const parts = sel.split(/\s+/);
  if (!matchOne(n, parts[parts.length - 1])) return false;
  let a = n.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (a && !(a.tagName && a.tagName !== '#TEXT' && matchOne(a, parts[i]))) a = a.parentNode;
    if (!a) return false;
    a = a.parentNode;
  }
  return true;
}
const STORE = {};
globalThis.document = { createElement: t => new Node(t), createTextNode: t => Object.assign(new Node('#text'), { _text: String(t) }), querySelector: () => null };
globalThis.localStorage = { getItem: k => (k in STORE ? STORE[k] : null), setItem: (k, v) => { STORE[k] = String(v); } };
globalThis.location = { href: 'http://x/epinoia/p/?p=A', pathname: '/epinoia/p/', search: '?p=A', hash: '' };
globalThis.window = globalThis;
const all = (n, sel) => n.querySelectorAll(sel);

/* ------------------------------------------------------------------ the game log --- */
console.log('the game log');
const GL = require(path.join(ROOT, 'epinoia', 'p', 'gamelog.js'));
const game = (i, comp, s, res, bpm) => ({ game_id: 'g' + i, team_idx: 0, player_uuid: 'A', __res: res, __home: true, __opp: { name: 'Opp ' + i, slug: 'o' + i }, __bpm: bpm,
  games: { tipoff_at: '2026-0' + (1 + Math.floor(i / 10)) + '-' + String(10 + (i % 10)).padStart(2, '0') + 'T18:00:00Z', competition_id: comp }, stats: s });
/* oldest first in the season, newest first in the log, as seasonLog gives it */
const SEASON = [
  game(0, 'lg', { pts: 10, p3m: 1, p3a: 1, p2m: 3, p2a: 6, ftm: 1, fta: 2, or: 1, dr: 3, ast: 2, stl: 1, to: 2, pf: 3, min: 1500000, pm: 4 }, 'W 80-70', 3.1),
  game(1, 'lg', { pts: 4, p3m: 0, p3a: 0, p2m: 2, p2a: 7, ftm: 0, fta: 0, or: 0, dr: 2, ast: 1, stl: 0, to: 3, pf: 2, min: 1200000, pm: -8 }, 'L 60-75', -6.4),
  game(2, 'cup', { pts: 14, p3m: 2, p3a: 10, p2m: 3, p2a: 5, ftm: 2, fta: 2, or: 2, dr: 4, ast: 3, stl: 2, to: 1, pf: 1, min: 1800000, pm: 9 }, 'W 90-77', 6.2),
  game(3, 'lg', { pts: 8, p3m: 0, p3a: 3, p2m: 4, p2a: 6, ftm: 0, fta: 1, or: 1, dr: 1, ast: 0, stl: 1, to: 1, pf: 4, min: 1400000, pm: -2 }, 'L 70-72', -1.0),
  game(4, 'lg', { pts: 21, p3m: 3, p3a: 6, p2m: 5, p2a: 8, ftm: 2, fta: 3, or: 2, dr: 5, ast: 4, stl: 1, to: 2, pf: 2, min: 2100000, pm: 12 }, 'W 88-70', 11.8),
  game(5, 'lg', { pts: 16, p3m: 2, p3a: 5, p2m: 4, p2a: 7, ftm: 2, fta: 2, or: 1, dr: 4, ast: 5, stl: 0, to: 2, pf: 2, min: 1900000, pm: 5 }, 'W 79-74', 4.4),
  game(6, 'lg', { pts: 18, p3m: 2, p3a: 4, p2m: 5, p2a: 9, ftm: 2, fta: 4, or: 3, dr: 5, ast: 3, stl: 2, to: 1, pf: 3, min: 2000000, pm: 7 }, 'W 85-80', 7.5)
];
const LOG = SEASON.slice().reverse();
const S3 = GL.STATS.find(s => s.k === 'p3'), SP = GL.STATS.find(s => s.k === 'pts');
const ser3 = GL.series(LOG, 'p3');
ok('a statistic is drawn oldest first', GL.series(LOG, 'pts').map(p => p.v).join() === '10,4,14,8,21,16,18');
ok('a shooting percentage is a game\'s makes over its attempts, and a game without an attempt has none (not a zero)',
   ser3[0].v === 100 && ser3[1].v === null && near(ser3[2].v, 20) && ser3[3].v === 0, ser3.map(p => p.v));
ok('...over a stretch it is the makes over the attempts, never an average of the games\' percentages: 10 of 29 is 34.5%, not 44.6%',
   near(GL.over(ser3, S3), 100 * 10 / 29) && !near(GL.over(ser3, S3), (100 + 20 + 0 + 50 + 40 + 50) / 6));
const roll = GL.rolling(GL.series(LOG, 'pts'), SP, 5);
ok('the running line is each game\'s last five, fewer at the start', near(roll[0], 10) && near(roll[1], 7) && near(roll[4], 57 / 5) && near(roll[6], (14 + 8 + 21 + 16 + 18) / 5), roll);
const sm = GL.summary(GL.series(LOG, 'pts'), SP);
ok('the facts: the season, the last five (only once there are more than five), the two halves, the best game',
   near(sm.season, 91 / 7) && near(sm.last, 77 / 5) && near(sm.halves[0], 28 / 3) && near(sm.halves[1], 63 / 4) && sm.best.v === 21 && sm.best.row.game_id === 'g4', sm);
const sm3 = GL.summary(ser3, S3);
ok('a percentage\'s best game needs his usual number of attempts: 1 of 1 is not the season\'s best', sm3.best && sm3.best.row.game_id !== 'g0' && sm3.best.a >= 4, sm3.best && sm3.best.row.game_id);
const SB = GL.STATS.find(s => s.k === 'bpm');
ok('the game\'s BPM is a statistic, read off the row; game score is not one any more', SB && SB.col === 'BPM' && GL.series(LOG, 'bpm').map(p => p.v).join() === '3.1,-6.4,6.2,-1,11.8,4.4,7.5' &&
   !GL.STATS.some(s => /gs|gmsc/i.test(s.k) || /game score/i.test(s.t)) && !/gameScore|Hollinger/.test(rd('epinoia', 'p', 'gamelog.js')));
const svg = GL.chartSVG(ser3, S3, { width: 600, height: 230, comps: new Map([['lg', 0], ['cup', 1]]) });
const count = (re) => (svg.match(re) || []).length;
ok('the chart: a bar a game that has a figure, a dash for one that has none, a column to point at for every game',
   count(/<rect class="glc-b /g) === 6 && count(/class="glc-na"/g) === 1 && count(/class="glc-hit"/g) === 7, [count(/<rect class="glc-b /g), count(/glc-na/g), count(/glc-hit/g)]);
ok('...the season dashed, the running line, a result tick under each game, the cup\'s bars a shade of their own',
   count(/class="glc-avg"/g) === 1 && /class="glc-roll"/.test(svg) && count(/class="glc-wl w"/g) === 5 && count(/class="glc-wl l"/g) === 2 && count(/class="glc-b c1/g) === 1);
const svgPm = GL.chartSVG(GL.series(LOG, 'pm'), GL.STATS.find(s => s.k === 'pm'), { width: 600 });
ok('a figure below nothing goes down from the zero line', /class="glc-b c0 neg"/.test(svgPm) && /class="glc-g z"/.test(svgPm));
{
  const ns = [[0, 21], [-8, 12], [0, 0.62], [12.5, 74]].map(([a, b]) => [a, b, GL.niceScale(a, b, 4)]);
  ok('round steps for the scale (1, 2, 2.5 or 5 of a power of ten) that take in every figure, from and to a step',
     ns.every(([a, b, n]) => n.lo <= a && n.hi >= b && /^(1|2|2\.5|5)$/.test(String(+(n.step / Math.pow(10, Math.floor(Math.log10(n.step)))).toFixed(6))) &&
       near(n.lo / n.step, Math.round(n.lo / n.step), 1e-6) && near(n.hi / n.step, Math.round(n.hi / n.step), 1e-6)) &&
     JSON.stringify(GL.niceScale(-8, 12, 4)) === '{"lo":-10,"hi":15,"step":5}', ns.map(x => x[2]));
}
{
  const host = new Node('div');
  GL.render({ host, rows: LOG, comps: new Map([['lg', 'SLB'], ['cup', 'SLB Cup']]), boxHref: id => '../game/?g=' + id });
  const chips = all(host, 'button.glc-chip');
  ok('the chips: every statistic, the one charted pressed (points the first time)', chips.length === GL.STATS.length && chips.find(b => b.classList.contains('on')).dataset.k === 'pts');
  const heads = all(host, 'table.glt thead th').map(t => t.textContent);
  ok('the table: date, opponent, competition, result, then the line, BPM at the end', heads.slice(0, 4).join() === 'DATE,OPP,COMP,RES' && heads[heads.length - 1] === 'BPM', heads.join(' '));
  const rows = all(host, 'table.glt tbody tr');
  ok('...each game names its competition, newest first', rows.map(r => r.children[2].textContent).join() === 'SLB,SLB,SLB,SLB,SLB Cup,SLB,SLB');
  ok('...its BPM signed and toned', rows[0].children[16].textContent === '+7.5' && rows[0].children[16].classList.contains('pos') && rows[5].children[16].classList.contains('neg'));
  all(host, 'table.glt thead th').find(t => t.dataset.k === 'reb').click();
  ok('pressing a column\'s heading charts it: its chip pressed, its heading lit, remembered on this device',
     all(host, 'button.glc-chip').find(b => b.classList.contains('on')).dataset.k === 'reb' && host.querySelector('th.sel').dataset.k === 'reb' && STORE.epinoia_log_stat === 'reb');
  const lit = all(host, 'td.sel');
  ok('...its cells lit, the ones far from his season tinted (better green, worse red)', lit.length === 7 && lit.every(td => td.dataset.k === 'reb') &&
     lit.some(td => /^up/.test(td.dataset.h || '')) && lit.some(td => /^dn/.test(td.dataset.h || '')), lit.map(td => td.dataset.h || '-'));
  ok('...the facts over the chart are the rebounds\'', /REB/.test(host.querySelector('div.glc-t').textContent) && /season/.test(host.querySelector('div.glc-facts').textContent));
  ok('the newest game is pointed at first, its row lit and its box score linked', rows[0].classList.contains('lit') && host.querySelector('a.glc-box').attrs.href === undefined &&
     host.querySelector('a.glc-box').href === '../game/?g=g6');
  ok('two competitions in the log: the key names both', all(host, 'span.glc-k').map(k => k.textContent).slice(0, 2).join() === 'SLB,SLB Cup');
}

/* ------------------------------------------------------------------ each game's BPM --- */
console.log('\neach game\'s BPM (bpm.js gameFromBox)');
const BPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
const line = (id, side, s) => ({ id, side, stats: s });
const box = [
  line('a1', 0, { min: 1800000, pts: 22, p2m: 6, p2a: 11, p3m: 2, p3a: 5, ftm: 4, fta: 5, or: 1, dr: 5, ast: 6, stl: 2, blk: 0, to: 3, pf: 2 }),
  line('a2', 0, { min: 1700000, pts: 15, p2m: 6, p2a: 9, p3m: 1, p3a: 3, ftm: 0, fta: 0, or: 3, dr: 6, ast: 1, stl: 0, blk: 2, to: 1, pf: 4 }),
  line('a3', 0, { min: 1500000, pts: 9, p2m: 1, p2a: 3, p3m: 2, p3a: 6, ftm: 1, fta: 2, or: 0, dr: 2, ast: 3, stl: 1, blk: 0, to: 2, pf: 1 }),
  line('a4', 0, { min: 1300000, pts: 12, p2m: 5, p2a: 8, p3m: 0, p3a: 1, ftm: 2, fta: 2, or: 2, dr: 4, ast: 0, stl: 1, blk: 1, to: 1, pf: 3 }),
  line('a5', 0, { min: 1200000, pts: 6, p2m: 3, p2a: 6, p3m: 0, p3a: 2, ftm: 0, fta: 0, or: 1, dr: 2, ast: 2, stl: 0, blk: 0, to: 2, pf: 2 }),
  line('a6', 0, { min: 0, pts: 0 }),
  line('b1', 1, { min: 1900000, pts: 18, p2m: 5, p2a: 12, p3m: 2, p3a: 7, ftm: 2, fta: 2, or: 1, dr: 3, ast: 4, stl: 1, blk: 0, to: 4, pf: 3 }),
  line('b2', 1, { min: 1800000, pts: 10, p2m: 5, p2a: 10, p3m: 0, p3a: 2, ftm: 0, fta: 1, or: 2, dr: 5, ast: 1, stl: 0, blk: 1, to: 2, pf: 4 }),
  line('b3', 1, { min: 1600000, pts: 12, p2m: 3, p2a: 6, p3m: 2, p3a: 6, ftm: 0, fta: 0, or: 0, dr: 3, ast: 2, stl: 1, blk: 0, to: 1, pf: 2 }),
  line('b4', 1, { min: 1200000, pts: 8, p2m: 4, p2a: 7, p3m: 0, p3a: 0, ftm: 0, fta: 2, or: 3, dr: 2, ast: 0, stl: 0, blk: 1, to: 2, pf: 3 }),
  line('b5', 1, { min: 1000000, pts: 4, p2m: 2, p2a: 5, p3m: 0, p3a: 2, ftm: 0, fta: 0, or: 0, dr: 1, ast: 3, stl: 1, blk: 0, to: 1, pf: 1 })
];
const m = BPM.gameFromBox(box);
ok('every player with a minute has one, nobody without', m.size === 10 && !m.has('a6') && [...m.values()].every(v => typeof v.bpm === 'number'), [...m.keys()]);
ok('...and one side\'s lines alone have no team ratings to adjust to: nothing', BPM.gameFromBox(box.filter(l => l.side === 0)).size === 0);
const sideTot = t => { const T = { pts: 0, fga: 0, fta: 0, or: 0, to: 0 };
  box.filter(l => l.side === t).forEach(({ stats: s }) => { T.pts += s.pts || 0; T.fga += (s.p2a || 0) + (s.p3a || 0); T.fta += s.fta || 0; T.or += s.or || 0; T.to += s.to || 0; });
  return Object.assign(T, { poss: 0.96 * (T.fga + T.to + 0.44 * T.fta - T.or) }); };
const T0 = sideTot(0), T1 = sideTot(1), net0 = 100 * T0.pts / T0.poss - 100 * T1.pts / T1.poss;
const mins0 = box.filter(l => l.side === 0 && l.stats.min > 0).map(l => [l.id, l.stats.min / 60000]);
const total0 = mins0.reduce((a, x) => a + x[1], 0);
const weighted = mins0.reduce((a, [id, mn]) => a + (mn / (total0 / 5)) * m.get(id).bpm, 0);
ok('the team adjustment holds: the roster\'s BPM weighted by its share of five positions\' minutes is 1.2 x its net rating',
   near(weighted, 1.2 * net0, 0.3), [weighted, 1.2 * net0]);
ok('the box score page, the graphics and the game log read the same function: bpm.js game, forTeam over teamInputs on each side', /teamInputs\(T\[t\], sides\[t\]\)/.test(rd('epinoia', 'bpm.js')) &&
   /B\.game\(\{ lines: rows\.map/.test(rd('epinoia', 'socialcard.js')) && /B\.game\(\{ lines: byGame\.get\(r\.game_id\) \|\| \[\]/.test(rd('epinoia', 'p', 'player.js')));
ok('the Edge copy is regenerated from the page\'s (supabase/functions/_shared/bpm.js)', rd('supabase', 'functions', '_shared', 'bpm.js').includes('function gameFromBox(lines)'));

/* ------------------------------------------------------------------ on the floor with --- */
console.log('\non the floor with');
globalThis.EpinoiaLineups = require(path.join(ROOT, 'epinoia', 'lineups.js'));
const WY = require(path.join(ROOT, 'epinoia', 'wowy.js'));
const cell = (d, dir, scale, dp) => { const c = WY.deltaCell(d, dir, scale, dp); const pill = c.children[0], bar = c.children[1], fill = bar.children[0];
  return { tone: pill.className.replace('dpill ', ''), text: pill.textContent, left: fill && fill.style.left, width: fill && fill.style.width }; };
const up = cell(5, 1, 20), lowGood = cell(-5, -1, 20), lowBad = cell(5, -1, 20), style = cell(2, 0, 10), flat = cell(0.01, 1, 10), none = cell(null, 1, 10);
ok('more and better: green, the arrow up, a bar from the centre to the right, a quarter of the way at a quarter of the scale',
   up.tone === 'gd' && up.text === '▲+5.0' && up.left === '50.0%' && up.width === '12.5%', up);
ok('a lower defensive rating is better: green, the arrow down, the bar to the right', lowGood.tone === 'gd' && lowGood.text === '▼−5.0' && lowGood.left === '50.0%', lowGood);
ok('...and a higher one worse: red, the bar to the left of the centre', lowBad.tone === 'bd' && lowBad.left === '37.5%' && lowBad.width === '12.5%', lowBad);
ok('a style is grey, nothing is nothing, and no number is a dash', style.tone === 'st' && flat.tone === 'nt' && flat.text === '±0.0' && flat.left === undefined &&
   none.text === '—' && none.left === undefined, [style, flat, none]);
{
  /* the team with him on (two stints) and off (one) */
  const bx = pts => ({ pts, fga: 20, fgm: 9, f3m: 2, fta: 4, tov: 3, or: 2, dr: 6 });
  const st = (ids, dur, pf, pa) => ({ game_id: 'g', team_idx: 0, player_ids: ids, stats: { dur, pf, pa, off: bx(pf), def: bx(pa) } });
  const host = new Node('div');
  WY.onOffTiles(host, [st(['A', 'b', 'c', 'd', 'e'], 600000, 24, 18), st(['A', 'b', 'c', 'd', 'f'], 480000, 20, 16), st(['g', 'b', 'c', 'd', 'e'], 600000, 14, 22)], 'A');
  const labels = all(host, 'span.dl-t').map(x => x.textContent);
  const lows = all(host, 'div.dl-l').filter(x => x.querySelector('em.lo')).map(x => x.querySelector('span.dl-t').textContent);
  ok('on / off: the net ratings large with the swing between them, then the ratings, both ends\' four factors and the pace, a row each', host.querySelector('div.oo-sw') && labels.length === 13 &&
     labels[0] === 'net rating' && labels.indexOf('defensive rating') === 2 && labels.indexOf('pace') === 12 && all(host, 'div.dl-g').length === 4, labels);
  ok('...every figure where less is better says so (DRTG, TO%, the opponents\' eFG%, OREB%, FTr), turnovers forced does not', lows.join('|') ===
     ['defensive rating', 'turnover %', 'opponents\u2019 effective fg%', 'opponents\u2019 offensive rebound %', 'opponents\u2019 free-throw rate'].join('|'), lows);
  const sw = host.querySelector('div.oo-sw'), ons = all(host, 'div.oo-s').map(x => x.children[1].textContent);
  ok('...the swing is green, the arrow up, when the team is better with him on (+2.0 a minute on, -0.8 off)', sw.classList.contains('gd') && /^\u25b2 \+/.test(sw.children[1].textContent) &&
     +ons[0] > +ons[1], [sw.className, sw.children[1].textContent, ons]);
  const host2 = new Node('div');
  WY.onOffTiles(host2, [st(['A', 'b', 'c', 'd', 'e'], 600000, 14, 22), st(['g', 'b', 'c', 'd', 'e'], 600000, 24, 18)], 'A');
  ok('...and red, the arrow down, when it is worse', host2.querySelector('div.oo-sw').classList.contains('bd') && /^\u25bc /.test(host2.querySelector('div.oo-sw').children[1].textContent));
}
{
  const UI = require(path.join(ROOT, 'epinoia', 'p', 'withui.js'));
  const mates = Array.from({ length: 13 }, (_, i) => 'm' + i);
  const shared = Object.fromEntries(mates.map((id, i) => [id, (i * 37) % 13 * 10]));
  const lineOf = k => ({ mins: 100, pts36: 15, fga36: 12, p3a36: 4, reb36: 6, ast36: 3, tov36: 2, fg_pct: 45, p3_pct: 35, ft_pct: 75, efg: 50, ts: 55, ast_to: 1.5 });
  globalThis.EpinoiaWith = { sharedMinutes: (st, ids) => shared[ids[1]] || 0,
    split: (r, s, p, picked) => ({ all: lineOf(), withMates: picked.length ? Object.assign(lineOf(), { pts36: 18, tov36: 1, fga36: 14, mins: 60 }) : null, without: picked.length ? lineOf() : null }) };
  globalThis.EpinoiaWowy = WY;
  const host = new Node('div');
  UI.render({ host, recs: [{}], stints: [{}], playerId: 'A', meta: Object.fromEntries(mates.map(id => [id, { name: 'Mate ' + id }])), teammates: mates });
  const chips = all(host, 'button.wchip');
  const mins = chips.map(b => +b.querySelector('span.wc-m').textContent.replace("'", ''));
  ok('the teammates: most minutes together first, the first ten, the rest a press away', chips.length === 10 && mins.every((v, i) => !i || v <= mins[i - 1]) &&
     host.querySelector('button.wmore').textContent === '+3 more', mins);
  host.querySelector('button.wmore').click();
  ok('...pressing "more" shows them all', all(host, 'button.wchip').length === 13 && host.querySelector('button.wmore').textContent === 'fewer');
  all(host, 'button.wchip')[0].click();
  const rows = all(host, 'div.dl-l').map(x => x.textContent);
  const deltas = all(host, 'div.dl-d').map(d => d.children[0].className.replace('dpill ', ''));
  ok('a teammate picked: with, without, the gap and his overall line, a statistic a row (minutes are in the head)', rows.length === 12 && rows[0] === 'points / 36' &&
     host.querySelector('div.wcmp-h') && /60\.0 min/.test(host.querySelector('div.wcmp-h').textContent), rows);
  ok('...more points green, fewer turnovers green, more shots only a style (grey)', deltas[0] === 'gd' && deltas[rows.indexOf('turnovers / 36')] === 'gd' &&
     deltas[rows.indexOf('shots / 36')] === 'st' && deltas[rows.indexOf('FG%')] === 'nt', deltas);
}

/* ------------------------------------------------------------------ the position breakdown --- */
console.log('\nthe position breakdown');
globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const X = require(path.join(ROOT, 'epinoia', 't', 'depth.js'));
const PJS = rd('epinoia', 'p', 'player.js');
function lift(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced ' + signature);
}
const BREAK = lift(PJS, 'async function paintPosBreakdown(rows, field)');
function breakdown(o) {
  const host = new Node('div');
  const asked = [];
  const D = { posFiles: async ids => { asked.push(ids.slice()); return new Map(ids.map(id => [id, (o.files || {})[id] || null])); },
              stints: async ids => (o.stints || []).filter(s => ids.indexOf(s.game_id) >= 0), playerMeta: async () => ({}) };
  const fn = new Function('window', '$', 'el', 'api', 'SCOPE_IDS', 'console', 'rpGive',
    'let POS_RUN = 0; const CLUB_STINTS = new Map();\n' + BREAK + '\nreturn paintPosBreakdown;')(
    { EpinoiaDepth: X, EpinoiaData: D, EpinoiaBox: { courtSVG: () => '<svg/>' } }, s => (s === '#idpos' ? host : null),
    (t, c, x) => { const n = new Node(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }, async () => [], o.scope || null, { warn: () => {} }, () => {});
  return fn(o.rows, o.field || []).then(() => ({ host, asked, spots: all(host, 'span.ip-spot').map(s => s.querySelector('b').textContent + ':' + s.querySelector('i').textContent + ':' + s.className) }));
}
const prow = (i, comp, side) => ({ game_id: 'p' + i, team_idx: side == null ? 0 : side, player_uuid: 'A', games: { competition_id: comp || 'lg', tipoff_at: '2026-02-' + String(10 + i) + 'T18:00:00Z' } });
const file = (id, sec) => ({ v: 1, game: id, f: null, t: [{ A: [0].concat(sec), Z: [600, 600, 0, 0, 0, 0] }, {}] });
{
  const r = await breakdown({ rows: [prow(1), prow(2), prow(3), prow(4)],
    files: { p1: file('p1', [0, 0, 120, 300, 30]), p2: file('p2', [0, 0, 60, 120, 0]), p3: file('p3', [0, 0, 0, 180, 0]), p4: file('p4', [0, 0, 120, 0, 70]) } });
  ok('from the files: his seconds at each position summed, as shares (SF 30%, PF 60%, C 10%)', r.spots.map(x => x.split(':').slice(0, 2).join(':')).join() === 'PG:0%,SG:0%,SF:30%,PF:60%,C:10%', r.spots);
  ok('...each spot coloured by its share, his main position ringed', r.spots[3].includes('b4') && r.spots[3].includes('top') && r.spots[2].includes('b3') && r.spots[4].includes('b2') && r.spots[0].includes('b0'), r.spots);
  ok('...on the half court, with how many games and minutes it is over', /<svg/.test(r.host.querySelector('div.ip-court').innerHTML) && /4 games · 17 min/.test(r.host.querySelector('span.ip-n').textContent) && !r.host.hidden,
     r.host.querySelector('span.ip-n').textContent);
  ok('...the newest three files asked first, then the rest', r.asked.length === 2 && r.asked[0].join() === 'p4,p3,p2' && r.asked[1].join() === 'p1', r.asked);
}
{
  /* no file anywhere: the lineups, each five ranked by its players' positions on the season line */
  const five = (gid, ids, ms) => ({ game_id: gid, team_idx: 0, player_ids: ids, stats: { dur: ms } });
  const field = ['V', 'W', 'A', 'Y', 'Z', 'Q'].map((id, i) => ({ id, bpm_pos: [1.2, 2.0, 3.9, 3.0, 4.8, 3.5][i], min: 600 }));
  const r = await breakdown({ rows: [prow(1), prow(2), prow(3), prow(4)], field,
    stints: [five('p1', ['V', 'W', 'A', 'Y', 'Z'], 600000), five('p2', ['V', 'W', 'A', 'Y', 'Z'], 300000), five('p3', ['V', 'W', 'A', 'Q', 'Z'], 300000),
             five('p4', ['V', 'W', 'Y', 'Q', 'Z'], 600000)] });
  ok('no file at all: from the lineups, each five ranked point guard to centre (his 3.9 is the four beside a 3.0, the three beside a 3.5 and a 4.8... the four)',
     r.spots.map(x => x.split(':').slice(0, 2).join(':')).join() === 'PG:0%,SG:0%,SF:0%,PF:100%,C:0%', r.spots);
  ok('...and when the newest three have no file, no more are asked for', r.asked.length === 1 && r.asked[0].length === 3, r.asked);
}
{
  const r = await breakdown({ rows: [prow(1, 'cup'), prow(2, 'lg')], scope: ['lg'], files: { p1: file('p1', [600, 0, 0, 0, 0]), p2: file('p2', [0, 0, 600, 0, 0]) } });
  ok('only the competition shown: the cup\'s games are left out of the league\'s breakdown', r.spots.map(x => x.split(':').slice(0, 2).join(':')).join() === 'PG:0%,SG:0%,SF:100%,PF:0%,C:0%', r.spots);
  const e = await breakdown({ rows: [], files: {} });
  ok('...and a season with nothing to read is no breakdown at all', e.host.hidden === true && !e.spots.length);
}
ok('the estimated-position chip is gone from the hero', !/EST POS|paintEstPos|EST_POS/.test(PJS) && !/est-pos\{/.test(rd('epinoia', 'p', 'index.html')));

/* ------------------------------------------------------------------ career stats --- */
console.log('\ncareer stats');
const career = lift(PJS, 'async function paintCareer(pl, team, scopes, hooks)');
ok('every season and competition of the page\'s own scopes (his and his linked profiles\'), three read at a time, no longer cut at eight',
   /\(\(scopes && scopes\.seasons\) \|\| \[\]\)\.forEach\(sn => sn\.comps\.forEach\(c => items\.push\(\{ sn, c \}\)\)\)/.test(career) && /const CAREER_CAP = 60;/.test(PJS) &&
   !/CAREER_MAX/.test(PJS) && /await Promise\.all\(\[work\(\), work\(\), work\(\)\]\);/.test(career));
ok('...each row the club he played it for (not today\'s), the competition\'s short name, the season as the name', /compLabel: short/.test(career) && /teamName: cl\.length \? cl\.map/.test(career) &&
   /name: sn\.label,/.test(career));
const rcr = lift(PJS, 'function renderCareerRows(host, rows, pl)');
ok('the table: the competition column locked beside the club, newest first, each season a link to it on this page', /compColumn: true/.test(rcr) && /sortKey: 'rank', sortDir: 1/.test(rcr) &&
   /playerHref: r => r\._href \|\| null/.test(rcr) && /onDraw: markCareer/.test(rcr) && /_href: scopeHref\(sn, c\.id\)/.test(career));
ok('...a plain press shows that season and competition here (a modified one opens a tab), and the row shown is marked',
   /e\.target\.closest\('#seasons table\.ft \.ft-name a'\)/.test(PJS) && /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey \|\| e\.button\) return;/.test(PJS) &&
   /CAREER\.hooks\.pick\(r\._season, r\._cid\)/.test(PJS) && /chooseSeason\(sn, cid, true\)\.then/.test(PJS) && /tr\.classList\.toggle\('cur', on\)/.test(PJS) && /markCareer\(\);\n/.test(PJS));

/* ------------------------------------------------------------------ the names --- */
console.log('\na competition\'s short name (seasonbar.js)');
const SBar = require(path.join(ROOT, 'epinoia', 'seasonbar.js'));
const slb = { name: 'Super League Basketball Men', slug: 'slb-men' }, feb = { name: 'Primera FEB', slug: 'primera-feb' };
ok('a league in a few letters: its own initials, a short name as it is, a short slug in capitals, else the initials', SBar.leagueAbbr(slb) === 'SLB' && SBar.leagueAbbr({ name: 'EuroCup' }) === 'EuroCup' &&
   SBar.leagueAbbr({ name: 'WNBL Division One', slug: 'wnbl-d1' }) === 'WNBL D1' && SBar.leagueAbbr({ name: 'Azerbaijan Basketball League', slug: 'azerbaijan-basketball-league' }) === 'ABL' &&
   SBar.leagueAbbr({ name: 'Super League Basketball Men', initials: 'BBL' }) === 'BBL');
ok('a competition: its league, then its kind; a cup with a name of its own keeps it', SBar.compLabel({ name: 'Championship 26-27', kind: 'league', league: slb }) === 'SLB' &&
   SBar.compLabel({ name: 'Cup 26-27', kind: 'cup', league: slb }) === 'SLB Cup' && SBar.compLabel({ name: 'Copa Princesa', kind: 'cup', league: feb }) === 'Copa Princesa' &&
   SBar.compLabel({ name: 'Playoffs 25-26', kind: 'playoff', league: feb }) === 'Primera FEB Playoffs');
ok('...two that would read the same say their own names after the league\'s', [...SBar.compLabels([{ id: 1, name: 'Championship 26-27', kind: 'league', league: slb },
   { id: 2, name: 'Super League Basketball Men', kind: 'league', league: slb }]).values()].join() === 'SLB · Championship,SLB · Super League Basketball Men');

/* ------------------------------------------------------------------ the page --- */
console.log('\nthe page');
const HTML = rd('epinoia', 'p', 'index.html');
const at = s => HTML.indexOf(s);
ok('"Career stats" in place of "Season"', /<h2>Career stats<\/h2>/.test(HTML) && !/<h2>Season<\/h2>/.test(HTML));
ok('the scripts the upgrades need, before player.js: BPM, the depth chart\'s ranking, the game log', at('src="../bpm.js') > 0 && at('src="../t/depth.js') > 0 && at('src="gamelog.js') > 0 &&
   [at('src="../bpm.js'), at('src="../t/depth.js'), at('src="gamelog.js')].every(i => i < at('src="player.js')));
ok('their styles before the teletext and legibility sheets', at('kit/gamelog.css') > 0 && at('kit/onfloor.css') > 0 && at('kit/gamelog.css') < at('kit/teletext.css') &&
   at('kit/onfloor.css') < at('kit/legibility.css'));
ok('the position breakdown is the hero\'s own block, beside or under the rest', /<div class="idpos" id="idpos" hidden><\/div>\s*<\/div>/.test(HTML) && at('id="idpos"') > at('class="idmeta"') &&
   /@media \(min-width:1800px\)\{ \.idband:has\(> \.idpos:not\(\[hidden\]\)\)\{grid-template-columns:auto minmax\(0,1fr\) auto\} \}/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
