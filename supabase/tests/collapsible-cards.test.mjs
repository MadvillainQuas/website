/* ============================================================================
   COLLAPSIBLE CARDS (epinoia/cards.js) and their two users: the player profile's league
   percentile bars (p/player.js) and the club page's team statistics (t/team.js).

     * the average and the gap to it: above / below in words, good / bad in colour, and the
       lower-is-better statistics turned the right way round;
     * a card folds and unfolds, remembers it, draws its body only once it is open, and
       "expand all / collapse all" reaches the folds inside cards;
     * the player profile: TPC per game under ASSISTED% in scoring, the shooting distances
       grouped in the one card, impact carrying every on/off four factor (offence and defence)
       plus BPM, OBPM, DBPM and VORP with only the four-factor blocks folding, and the sense
       (lower is better) of every one of them;
     * the club page: four factors, the season line, shot zones and events are cards; the
       players' table is not;
     * both pages load the styles and the script before their own.

     node supabase/tests/collapsible-cards.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

/* a small DOM: enough for the card (createElement, classList, attributes, listeners, querySelectorAll) */
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.attrs = {}; this.handlers = {}; this._cls = new Set(); this._text = ''; this.id = ''; this.type = ''; }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  click() { (this.handlers.click || []).forEach(f => f({ target: this })); }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, ''); const out = [];
    const walk = n => n.children.forEach(c => { if (c._cls.has(cls)) out.push(c); walk(c); });
    walk(this); return out;
  }
}
const doc = { createElement: t => new N(t) };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };

const C = require(path.join(ROOT, 'epinoia', 'cards.js'));

console.log('the average, and the gap to it');
const rows = [{ x: 10 }, { x: 20 }, { x: 30 }, { x: null }, {}];
ok('the average is over the players who have the statistic', C.mean(rows, 'x') === 20);
ok('...and under three values there is no average to compare with', C.mean([{ x: 1 }, { x: 2 }], 'x') === null);
let d = C.delta(25, 20, false, 1);
ok('above the average: +5.0 above league avg, good news', d.text === '+5.0 above league avg' && d.dir === 'above' && d.tone === 'good', d);
d = C.delta(15, 20, false, 1);
ok('below it: 5.0 below, and that is bad', d.text === '-5.0 below league avg' && d.dir === 'below' && d.tone === 'bad', d);
d = C.delta(15, 20, true, 1);
ok('a lower-is-better statistic below the average: still "below" in the words, but good news', d.dir === 'below' && d.tone === 'good', d);
d = C.delta(25, 20, true, 1);
ok('...and above the average is bad', d.dir === 'above' && d.tone === 'bad', d);
d = C.delta(20.04, 20, false, 1);
ok('a gap that rounds to nothing is level, not +0.0', d.dir === 'level' && d.tone === 'level' && /level/.test(d.text), d);
ok('no value, or no average, gives no delta', C.delta(null, 20, false, 1) === null && C.delta(5, null, false, 1) === null);
ok('two places for the ratios', C.delta(2.5, 2.0, false, 2).text === '+0.50 above league avg');

console.log('\na card');
const Body = () => { const b = new N('div'); b.textContent = 'the body'; b.built = true; return b; };
let built = 0;
const card = C.collapsible({ doc, key: 'test_a', title: 'scoring', summary: 'avg 71st', open: true, body: () => { built++; return Body(); } });
const head = card.children[0], wrap = card.children[1];
ok('open by default: a header button says so, and the body is there', head.tag === 'button' && head.getAttribute('aria-expanded') === 'true' && !card.classList.contains('shut') && built === 1);
ok('the header carries the title, the summary chip and the chevron', /scoring/.test(head.textContent) && /avg 71st/.test(head.textContent) && head.children.some(c => c._cls.has('xc-c')));
head.click();
ok('a click folds it: shut, aria says so, the body is inert (out of the tab order)', card.classList.contains('shut') && head.getAttribute('aria-expanded') === 'false' && wrap.getAttribute('inert') === '');
ok('...and the choice is remembered in this browser', store['epinoia_card_test_a'] === '0');
head.click();
ok('a second click opens it again, and the body is drawn once, not again', !card.classList.contains('shut') && wrap.getAttribute('inert') === null && built === 1 && store['epinoia_card_test_a'] === '1');
const again = C.collapsible({ doc, key: 'test_b', title: 'x', open: true, body: Body });
store['epinoia_card_test_c'] = '0';
let lazy = 0;
const shut = C.collapsible({ doc, key: 'test_c', title: 'shooting', open: true, body: () => { lazy++; return Body(); } });
ok('a card the reader left shut opens shut, and draws nothing until it is opened', shut.classList.contains('shut') && lazy === 0);
shut.children[0].click();
ok('...then draws its body, once', lazy === 1 && !shut.classList.contains('shut'));
const dflt = C.collapsible({ doc, key: 'test_d', title: 'four factors', open: false, sub: true, body: Body });
ok('a card told to start shut does, and a nested one is the quieter form', dflt.classList.contains('shut') && dflt.classList.contains('sub'));

console.log('\nexpand all / collapse all');
const outer = C.collapsible({ doc, key: 'test_o', title: 'impact', open: true, body: () => {
  const b = new N('div');
  b.appendChild(C.collapsible({ doc, key: 'test_o_ff', title: 'offence four factors', sub: true, open: false, body: Body }));
  return b;
} });
const root = new N('div'); root.appendChild(outer);
ok('the fold inside starts shut', outer.querySelectorAll('.xc')[0].classList.contains('shut'));
C.setAll(root, true);
ok('"expand all" opens the card and the fold inside it', !outer.classList.contains('shut') && !outer.querySelectorAll('.xc')[0].classList.contains('shut'));
C.setAll(root, false);
ok('"collapse all" shuts both', outer.classList.contains('shut') && outer.querySelectorAll('.xc')[0].classList.contains('shut'));
const shutOuter = C.collapsible({ doc, key: 'test_o2', title: 'impact', open: false, body: () => {
  const b = new N('div');
  b.appendChild(C.collapsible({ doc, key: 'test_o2_ff', title: 'defence four factors', sub: true, open: false, body: Body }));
  return b;
} });
const root2 = new N('div'); root2.appendChild(shutOuter);
C.setAll(root2, true);
ok('"expand all" reaches a fold that only exists once its card is opened', shutOuter.querySelectorAll('.xc').every(c => !c.classList.contains('shut')) && shutOuter.querySelectorAll('.xc').length === 1);

console.log('\nthe player profile');
const pjs = rd('epinoia', 'p', 'player.js');
const blockOf = key => { const i = pjs.indexOf("{ key: '" + key + "'"); return pjs.slice(i, pjs.indexOf('  ]}', i)); };
const scoring = blockOf('scoring');
ok('scoring: TPC per game is there, straight after ASSISTED%', scoring.indexOf("['ev_ast_pts_sh','ASSISTED%']") > 0 && scoring.indexOf("['contrib_pg','TPC / GAME']") > scoring.indexOf("['ev_ast_pts_sh','ASSISTED%']"));
ok('...the figure is season.js’s points scored plus points off assists, per game', /contrib_pg: r1\(\(A\.pts \+ A\.ptsAst\) \/ g\)/.test(rd('epinoia', 'season.js')));
const shooting = blockOf('shooting');
const titles = [...shooting.matchAll(/title: '([^']+)'/g)].map(m => m[1]).slice(1);      // the first is the card's own
ok('shooting: the four distances are groups in the one card', JSON.stringify(titles) === JSON.stringify(['at the rim', 'mid-range', 'three-pointers', 'free throws']), titles);
ok('...each with its rate, its volume and its assisted share together', ['rim_pct', 'rim_apg', 'ev_rim_astp'].every(k => /title: 'at the rim'[^\]]*\]/.test(shooting) && shooting.indexOf(k) > 0)
   && /title: 'at the rim'.*\['rim_pct'.*\['rim_apg'.*\['ev_rim_astp'/.test(shooting.replace(/\n/g, ' ')));
ok('...and none of them folds (grouped, not another collapsible card)', !/fold:/.test(shooting));
const impact = blockOf('impact');
const off4 = ['diff_efg', 'diff_tov', 'diff_oreb', 'diff_ftr'], def4 = ['diff_vs_efg', 'diff_vs_tov', 'diff_vs_oreb', 'diff_vs_ftr'];
ok('impact: net, offensive and defensive rating', ['diff_net', 'diff_ortg', 'diff_drtg'].every(k => impact.includes("'" + k + "'")));
ok('impact: BPM, OBPM, DBPM and VORP', ['bpm', 'obpm', 'dbpm', 'vorp'].every(k => impact.includes("['" + k + "'")));
ok('impact: all four offensive on/off factors and all four defensive', off4.concat(def4).every(k => impact.includes("'" + k + "'")));
const foldedBlocks = [...impact.matchAll(/\{ title: '([^']+)', fold: true/g)].map(m => m[1]);
ok('only the two four-factor blocks fold; the BPM block and the on/off block do not', JSON.stringify(foldedBlocks) === JSON.stringify(['offence four factors', 'defence four factors']), foldedBlocks);
const low = pjs.slice(pjs.indexOf('const BAR_LOW'), pjs.indexOf('];', pjs.indexOf('const BAR_LOW')));
ok('lower-is-better: turnovers, DRTG, the opponents’ eFG%, OREB% and free-throw rate', ['tov_pct', 'diff_drtg', 'diff_tov', 'diff_vs_efg', 'diff_vs_oreb', 'diff_vs_ftr'].every(k => low.includes("'" + k + "'")));
ok('...but opponent turnovers going up is the good direction, so diff_vs_tov is not among them', !low.includes("'diff_vs_tov'"));
ok('the defence card no longer repeats the opponents’ eFG% (it is in impact)', !/key: 'defence'[^\]]*diff_vs_efg/.test(pjs.replace(/\n/g, ' ')));
ok('every section is a card, and every bar a card with its delta', /C\.collapsible\(\{ key: 'p_' \+ s\.key/.test(pjs) && /C\.delta\(v, C\.mean\(pool, k\)/.test(pjs) && /el\('div', 'bc'\)/.test(pjs));
ok('the average is over the same pool the bar is ranked in (his position when adjusted)', /pool = group \? field\.filter/.test(pjs) && /barCard\(k, label, mine, ranks, pool\)/.test(pjs));
ok('expand all / collapse all are on the switch row', /'expand all'/.test(pjs) && /'collapse all'/.test(pjs));

console.log('\nthe club page');
const tjs = rd('epinoia', 't', 'team.js');
const ts = tjs.slice(tjs.indexOf('async function teamStats'), tjs.indexOf('async function zoneStats') > 0 ? tjs.indexOf('/* ------------------------------------------------------------- shot zones --- */') : undefined);
for (const k of ['ff', 'line', 'zones', 'events']) ok('team statistics: "' + k + '" is a card', new RegExp("card\\('" + k + "'").test(ts));
const tab = ts.slice(ts.indexOf('T.render'));
ok('the players’ table is not in a card: it is rendered straight into the page', /const sub = el\('div'\);\s*host\.appendChild\(sub\);/.test(ts) && !/card\('players|card\('roster/.test(ts) && tab.length > 0);
ok('the shot zones and the events are only read once their card is opened', /card\('zones', 'shot zones', \(\) =>/.test(ts) && /card\('events', 'events', \(\) =>/.test(ts));

console.log('\nthe pages load it');
for (const [who, file, own] of [['player page', 'p/index.html', 'player.js'], ['club page', 't/index.html', 'team.js']]) {
  const h = rd('epinoia', ...file.split('/'));
  const css = h.indexOf('href="../kit/cards.css?v='), js = h.indexOf('<script src="../cards.js?v='), mine = h.indexOf('<script src="' + own);
  ok(who + ': kit/cards.css in the head', css > 0 && css < h.indexOf('</head>'));
  ok(who + ': cards.js before ' + own, js > 0 && mine > js);
}
const css = rd('epinoia', 'kit', 'cards.css');
ok('the cards wear the page’s club colours, with the site’s own as the fallback', /var\(--team-a,var\(--lume\)\)/.test(css) && /var\(--team-b,var\(--aqua\)\)/.test(css) && /--team-a-ink/.test(css));
ok('good and bad stay green and red whatever the club wears', /\.bc-d\.good\{--d:var\(--good\)\}/.test(css) && /\.bc-d\.bad\{--d:var\(--bad\)\}/.test(css));
ok('a reader who asked for reduced motion gets no fold animation', /prefers-reduced-motion:reduce\)\{\.xc-b,\.xc-c\{transition:none\}/.test(css));

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
