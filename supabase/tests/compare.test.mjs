/* ============================================================================
   THE COMPARE CHART — epinoia/compare.js, read without a browser.

   html(o) is a pure string, so everything the global scouting page promises
   about the chart can be pinned here:

     1. 3 players x 6 stats draws 18 bars, one per player and stat, each with a
        <title>, and the player's number on every row
     2. no NaN or Infinity anywhere, whatever the values (null, NaN, strings,
        a missing player, a formatter that throws)
     3. a null value is the hatched no-data stub and a dash, never a bar
     4. value mode draws a zero line for signed stats only (bpm, obpm, dbpm,
        pm, diff_*); percentile mode never draws one
     5. every piece of text is 11px or more
     6. below 560px each stat has its own label line and 16px player rows;
        from 560px the label sits in a 120px column; the viewBox is the width
     7. names, labels and keys are escaped
     8. render() draws legend + controls + chart, and its mode toggle and stat
        chips redraw and report the change; kit/compare.css uses the five
        series tokens and never --good or --flare
     9. fromTable() turns a table's own rows, columns, ranks and categories into
        the chart's input, and every category becomes a dropdown holding every
        stat in it — so a reader can compare on any stat the table has, not only
        the ones on screen
    10. every league's statistics table offers the comparison: the season
        statistics page and the league page's leaders both select, and both load
        compare.js and its stylesheet

     node supabase/tests/compare.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'epinoia', 'compare.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

const count = (s, re) => (s.match(re) || []).length;
const bars = s => s.match(/<rect class="cmp-bar[^"]*"[^>]*>/g) || [];
const attr = (tag, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(tag); return m ? m[1] : null; };

/* ------------------------------------------------------------------ fixture --- */
const players = [
  { id: 'bcb:p1', name: 'Ada Okafor', league: 'BCB' },
  { id: 'slb:p2', name: 'Bea Lund', league: 'SLB W' },
  { id: 'slb:p3', name: 'Cal Price', league: 'SLB M' }
];
const pctFmt = v => v.toFixed(1) + '%';
const stats = [
  { key: 'ppg', label: 'PPG', fmt: v => v.toFixed(1) },
  { key: 'ts', label: 'TS%', fmt: pctFmt },
  { key: 'rpg', label: 'RPG', fmt: v => v.toFixed(1) },
  { key: 'bpm', label: 'BPM', fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) },
  { key: 'diff_net', label: 'NET DIFF', fmt: v => v.toFixed(1) },
  { key: 'tov_pct', label: 'TOV%', fmt: pctFmt }
];
const values = {
  'bcb:p1': { ppg: 21.4, ts: 61.2, rpg: 5.1, bpm: 4.2, diff_net: 8.3, tov_pct: 11.0 },
  'slb:p2': { ppg: 14.0, ts: 55.0, rpg: 9.8, bpm: -1.6, diff_net: -3.1, tov_pct: 14.5 },
  'slb:p3': { ppg: 8.2, ts: 49.9, rpg: 3.0, bpm: 0.4, diff_net: 1.0, tov_pct: 18.2 }
};
const pcts = {
  'bcb:p1': { ppg: 96, ts: 83, rpg: 60, bpm: 91, diff_net: 88, tov_pct: 72 },
  'slb:p2': { ppg: 71, ts: 55, rpg: 94, bpm: 32, diff_net: 20, tov_pct: 45 },
  'slb:p3': { ppg: 22, ts: 12, rpg: 18, bpm: 50, diff_net: 51, tov_pct: 9 }
};
const base = extra => Object.assign({ players, stats, values, pcts }, extra || {});

/* ---------------------------------------------------------- 1. the bars --- */
console.log('\n1. one bar per player and stat');
{
  for (const mode of ['pct', 'value']) {
    for (const width of [375, 900]) {
      const s = C.html(base({ mode, width }));
      const b = bars(s);
      ok(`${mode} @${width}: 3 players x 6 stats = 18 bars`, b.length === 18, 'got ' + b.length);
      const pairs = new Set(b.map(t => attr(t, 'data-player') + '|' + attr(t, 'data-stat')));
      ok(`${mode} @${width}: every player x stat pair once`, pairs.size === 18 &&
        players.every(p => stats.every(st => pairs.has(p.id + '|' + st.key))));
      ok(`${mode} @${width}: each bar carries a <title>`,
        count(s, /<rect class="cmp-bar[^>]*><title>[^<]+<\/title><\/rect>/g) === 18);
      ok(`${mode} @${width}: each row shows the player's number`,
        [1, 2, 3].every(n => count(s, new RegExp('class="cmp-num cmp-s' + (n - 1) + '"[^>]*>' + n + '</text>', 'g')) === 6));
      ok(`${mode} @${width}: series classes s0..s2 on the bars`,
        [0, 1, 2].every(i => b.filter(t => / cmp-s/.test(t) && t.includes('cmp-s' + i)).length === 6));
    }
  }
  const s = C.html(base({ mode: 'pct', width: 375 }));
  ok('role="img" with an aria-label naming the players', /<svg[^>]* role="img"/.test(s) &&
    /aria-label="Comparison of Ada Okafor, Bea Lund, Cal Price across PPG/.test(s));
  ok('the title reads name, league, value and percentile',
    s.includes('<title>1 · Ada Okafor (BCB) · TS% 61.2% · 83rd percentile</title>'));
  ok('percentile mode is the default', /data-mode="pct"/.test(C.html(base({ width: 375 }))));
  const six = C.html(base({ width: 375, players: players.concat(players.map(p => ({ ...p, id: p.id + 'x' }))) }));
  ok('never more than five players', bars(six).length === 30 && !/cmp-s5/.test(six));
  ok('a percentile bar scales with the percentile', (() => {
    const b = bars(C.html(base({ mode: 'pct', width: 900 })));
    const w = (pl, k) => +attr(b.find(t => attr(t, 'data-player') === pl && attr(t, 'data-stat') === k), 'width');
    return w('bcb:p1', 'ppg') > w('slb:p2', 'ppg') && w('slb:p2', 'ppg') > w('slb:p3', 'ppg');
  })());
}

/* ------------------------------------------------------------- 2. no NaN --- */
console.log('\n2. no NaN anywhere');
{
  const hostile = {
    'bcb:p1': { ppg: NaN, ts: Infinity, rpg: '12', bpm: undefined, diff_net: null, tov_pct: -Infinity },
    'slb:p2': {}
  };
  const bad = [...stats.slice(0, 5), { key: 'tov_pct', label: 'TOV%', fmt: () => { throw new Error('x'); } }];
  for (const mode of ['pct', 'value']) {
    for (const width of [0, NaN, 320, 375, 1440]) {
      const s = C.html({ players, stats: bad, values: hostile, pcts: { 'bcb:p1': { ppg: NaN } }, mode, width });
      ok(`${mode} @${width}: no NaN / Infinity / undefined in markup`, !/NaN|Infinity|undefined/.test(s),
        (s.match(/.{30}(NaN|Infinity|undefined).{30}/) || [])[0]);
      ok(`${mode} @${width}: still 18 bars`, bars(s).length === 18);
    }
  }
  const allSame = C.html(base({ mode: 'value', width: 375, values: {
    'bcb:p1': { ppg: 0, ts: 0, rpg: 0, bpm: 0, diff_net: 0, tov_pct: 0 },
    'slb:p2': { ppg: 0, ts: 0, rpg: 0, bpm: 0, diff_net: 0, tov_pct: 0 },
    'slb:p3': { ppg: 0, ts: 0, rpg: 0, bpm: 0, diff_net: 0, tov_pct: 0 } } }));
  ok('value mode with every value zero: no NaN', !/NaN|Infinity/.test(allSame) && bars(allSame).length === 18);
  ok('a formatter printing NaN is not trusted', !/NaN/.test(C.html(base({ mode: 'value', width: 375,
    stats: [{ key: 'ppg', label: 'PPG', fmt: () => 'NaN' }] }))));
  const empty = C.html({ players: [], stats, width: 375 });
  ok('no players: an empty-state message, no bars, no NaN', bars(empty).length === 0 && /cmp-empty/.test(empty) && !/NaN/.test(empty));
  ok('no stats: an empty-state message', /Pick a stat/.test(C.html({ players, stats: [], width: 375 })));
  ok('no options at all: still an svg', /^<svg/.test(C.html()) && !/NaN/.test(C.html()));
}

/* ------------------------------------------------------ 3. no-data stubs --- */
console.log('\n3. null values give the no-data stub');
{
  const v = JSON.parse(JSON.stringify(values));
  const p = JSON.parse(JSON.stringify(pcts));
  v['slb:p2'].ts = null; p['slb:p2'].ts = null;
  delete p['slb:p3'];                                      /* a whole player missing from pcts */
  for (const mode of ['pct', 'value']) {
    const s = C.html(base({ mode, width: 375, values: v, pcts: p }));
    const stubs = bars(s).filter(t => t.includes('cmp-nodata'));
    const want = mode === 'pct' ? 1 + 6 : 1;
    ok(`${mode}: ${want} hatched stub(s)`, stubs.length === want, 'got ' + stubs.length);
    ok(`${mode}: stubs fill with the hatch pattern`, stubs.every(t => /fill="url\(#cmp-hatch-\d+\)"/.test(t)) &&
      /<pattern id="cmp-hatch-\d+"/.test(s));
    ok(`${mode}: the stub is the stub width, not a zero or full bar`, stubs.every(t => +attr(t, 'width') === 24));
    ok(`${mode}: a dash in the value gutter for each stub`, count(s, /class="cmp-val cmp-val-none"[^>]*>—<\/text>/g) === want);
    ok(`${mode}: the stub title says no data`, stubs.length && s.includes('no data</title>'));
  }
  const a = C.html(base({ width: 375 })), b = C.html(base({ width: 375 }));
  ok('two charts on one page get different hatch ids',
    /cmp-hatch-(\d+)/.exec(a)[1] !== /cmp-hatch-(\d+)/.exec(b)[1]);
}

/* --------------------------------------------------------- 4. zero line --- */
console.log('\n4. zero line only for signed stats, in value mode');
{
  const s = C.html(base({ mode: 'value', width: 375 }));
  const blocks = s.split('<g class="cmp-block"').slice(1);
  const zeroIn = key => blocks.find(b => b.startsWith(' data-stat="' + key + '"')).includes('class="cmp-zero"');
  ok('bpm has a zero line', zeroIn('bpm'));
  ok('diff_net has a zero line', zeroIn('diff_net'));
  ok('ppg, ts, rpg, tov_pct have none', ['ppg', 'ts', 'rpg', 'tov_pct'].every(k => !zeroIn(k)));
  ok('exactly two zero lines', count(s, /class="cmp-zero"/g) === 2);
  ok('percentile mode draws no zero line', count(C.html(base({ mode: 'pct', width: 375 })), /class="cmp-zero"/g) === 0);
  ok('isSigned: bpm obpm dbpm pm diff_*', ['bpm', 'obpm', 'dbpm', 'pm', 'diff_net', 'diff_pts'].every(k => C.isSigned(k)) &&
    !['ppg', 'ts', 'rapm_x', 'usg', 'opm'].some(k => C.isSigned(k)));
  ok('isSigned honours stat.signed', C.isSigned('rapm', { signed: true }));

  const b = bars(s);
  const bar = (pl, k) => b.find(t => attr(t, 'data-player') === pl && attr(t, 'data-stat') === k);
  const zx = +/<line class="cmp-zero" x1="([\d.]+)"/.exec(blocks.find(x => x.startsWith(' data-stat="bpm"')))[1];
  ok('a negative bpm grows left of zero, a positive one right',
    +attr(bar('slb:p2', 'bpm'), 'x') + +attr(bar('slb:p2', 'bpm'), 'width') <= zx + 0.11 &&
    Math.abs(+attr(bar('bcb:p1', 'bpm'), 'x') - zx) < 0.11);
  ok('the value gutter prints the formatted value', s.includes('>+4.2</text>') && s.includes('>-1.6</text>'));
}

/* --------------------------------------------------------- 5. text size --- */
console.log('\n5. text is 11px or more');
{
  for (const mode of ['pct', 'value']) for (const width of [320, 375, 560, 1440]) {
    const s = C.html(base({ mode, width }));
    const texts = s.match(/<text[^>]*>/g) || [];
    const sizes = texts.map(t => +attr(t, 'font-size'));
    ok(`${mode} @${width}: ${texts.length} text elements, all >= 11px`,
      texts.length > 0 && sizes.every(n => n >= 11), sizes.join(','));
  }
  const css = rd('epinoia', 'kit', 'compare.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const small = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => +m[1]).filter(n => n < 11);
  ok('compare.css sets no font-size below 11px', small.length === 0, small.join(','));
  ok('compare.css never sets a font-size on the svg text', !/\.cmp-(label|num|val|empty)\{[^}]*font-size/.test(css));
}

/* ------------------------------------------------------------ 6. layout --- */
console.log('\n6. narrow and wide layouts');
{
  const n = C.html(base({ mode: 'pct', width: 375 }));
  const w = C.html(base({ mode: 'pct', width: 900 }));
  ok('viewBox width is the width asked for (375)', /viewBox="0 0 375 \d+"/.test(n) && /width="375"/.test(n));
  ok('viewBox width is the width asked for (900)', /viewBox="0 0 900 \d+"/.test(w));
  ok('559 is narrow, 560 is wide', /cmp-narrow/.test(C.html(base({ width: 559 }))) && /cmp-wide/.test(C.html(base({ width: 560 }))));

  const h = s => +/viewBox="0 0 \d+ (\d+)"/.exec(s)[1];
  /* narrow: 6 x (18 label + 3 x 16 rows) + 5 x 14 gaps + 4 */
  ok('narrow height = label line + 16px per player, per stat', h(n) === 6 * (18 + 48) + 5 * 14 + 4, h(n));
  ok('wide height = 16px per player, per stat', h(w) === 6 * 48 + 5 * 14 + 4, h(w));

  const labelsN = (n.match(/<text class="cmp-label"[^>]*>/g) || []);
  const tracksN = (n.match(/<rect class="cmp-track"[^>]*>/g) || []);
  ok('narrow: labels at x=0 on their own line above the rows', labelsN.length === 6 &&
    labelsN.every((t, i) => attr(t, 'x') === '0' && +attr(t, 'y') < +attr(tracksN[i], 'y')));
  ok('narrow: the track starts after the number gutter', tracksN.every(t => +attr(t, 'x') === 16));
  ok('narrow: player rows are 16px apart', (() => {
    const ys = bars(n).filter(t => attr(t, 'data-stat') === 'ppg').map(t => +attr(t, 'y'));
    return ys[1] - ys[0] === 16 && ys[2] - ys[1] === 16;
  })());
  const tracksW = (w.match(/<rect class="cmp-track"[^>]*>/g) || []);
  const labelsW = (w.match(/<text class="cmp-label"[^>]*>/g) || []);
  ok('wide: the track starts after a 120px label column', tracksW.every(t => +attr(t, 'x') === 136));
  ok('wide: each label sits beside its rows', labelsW.every((t, i) => {
    const y = +attr(t, 'y'), top = +attr(tracksW[i], 'y'), hh = +attr(tracksW[i], 'height');
    return y > top && y <= top + hh;
  }));
  for (const [s, W] of [[n, 375], [w, 900], [C.html(base({ mode: 'value', width: 375 })), 375]]) {
    const rects = s.match(/<(rect|line|text)[^>]*>/g) || [];
    const over = rects.filter(t => {
      const x = +(attr(t, 'x') || attr(t, 'x1') || 0), ww = +(attr(t, 'width') || 0);
      return x < 0 || x + ww > W + 0.11;
    });
    ok(`nothing drawn outside 0..${W}`, over.length === 0, over[0]);
  }
  ok('text is right-aligned to the edge in the value gutter',
    (n.match(/<text class="cmp-val[^>]*>/g) || []).every(t => attr(t, 'x') === '375' && attr(t, 'text-anchor') === 'end'));
}

/* ------------------------------------------------------------ 7. escaping --- */
console.log('\n7. escaped names');
{
  const evil = [
    { id: 'x"><script>', name: '<img src=x onerror=alert(1)> & "Jo\'s"', league: '<b>L</b>' },
    { id: 'p2', name: 'Plain', league: 'BCB' }
  ];
  const st = [{ key: 'k"><x', label: '<svg onload=alert(1)>' }];
  const s = C.html({ players: evil, stats: st, values: { [evil[0].id]: { [st[0].key]: 5 } }, pcts: {}, mode: 'value', width: 375 });
  ok('no raw tags from data in the svg', !/<script|<img|<b>|<svg onload/.test(s));
  ok('names escaped in titles and aria-label', s.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Jo&#39;s&quot;'));
  ok('ids and keys escaped in attributes', s.includes('data-player="x&quot;&gt;&lt;script&gt;"') && s.includes('data-stat="k&quot;&gt;&lt;x"'));
  const l = C.legendHtml({ players: evil });
  ok('legend escapes names and leagues', !/<img|<b>/.test(l) && l.includes('&lt;b&gt;L&lt;/b&gt;'));
  ok('the legend numbers players 1..n with their series', /cmp-chip cmp-s0"><b class="cmp-chip-n"[^>]*>1<\/b>/.test(l) &&
    /cmp-chip cmp-s1"><b class="cmp-chip-n"[^>]*>2<\/b>/.test(l));
  const all = C.html(base({ width: 375 })) + C.legendHtml(base());
  ok('CSP-clean: no inline style or event handler attributes', !/\sstyle=|\son[a-z]+=/i.test(all));
}

/* ----------------------------------------------- 8. render() and the CSS --- */
console.log('\n8. render() and kit/compare.css');
{
  /* a host just big enough: innerHTML is a string, querySelector hands back a chart box */
  const mkHost = () => {
    const chart = { clientWidth: 375, innerHTML: '' };
    const host = {
      clientWidth: 375, _html: '', listeners: {},
      set innerHTML(v) { this._html = v; chart.innerHTML = ''; }, get innerHTML() { return this._html; },
      querySelector: sel => (sel === '.cmp-chart' ? chart : null),
      contains: () => true,
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); },
      click(attrName, value) {
        const btn = { getAttribute: k => (k === attrName ? value : null) };
        btn.closest = sel => (sel === '[' + attrName + ']' ? btn : null);
        (this.listeners.click || []).forEach(fn => fn({ target: btn }));
      }
    };
    return { host, chart };
  };
  const { host, chart } = mkHost();
  const changes = [];
  const allStats = stats.concat([{ key: 'apg', label: 'APG' }]);
  const api = C.render(host, base({ allStats, note: 'Ranked within own league', onChange: c => changes.push(c) }));
  ok('render draws the legend, controls and note', /cmp-legend/.test(host.innerHTML) && /data-cmp-mode="pct" aria-pressed="true"/.test(host.innerHTML) &&
    /Ranked within own league/.test(host.innerHTML));
  ok('a chip per available stat, drawn ones on', count(host.innerHTML, /data-cmp-stat=/g) === 7 &&
    /class="cmp-stat" data-cmp-stat="apg" aria-pressed="false"/.test(host.innerHTML));
  ok('the chart is measured from its box', /viewBox="0 0 375 /.test(chart.innerHTML) && bars(chart.innerHTML).length === 18);
  host.click('data-cmp-mode', 'value');
  ok('the mode toggle redraws in value mode', api.state.mode === 'value' && /data-mode="value"/.test(chart.innerHTML) &&
    changes.length === 1 && changes[0].mode === 'value');
  host.click('data-cmp-stat', 'rpg');
  ok('a stat chip removes that stat', bars(chart.innerHTML).length === 15 && !changes[1].stats.includes('rpg'));
  host.click('data-cmp-stat', 'apg');
  host.click('data-cmp-stat', 'rpg');
  ok('stats put back keep the pool order', api.state.keys.join() === 'ppg,ts,rpg,bpm,diff_net,tov_pct,apg');
  ok('a stat with no values is drawn as no-data stubs', bars(chart.innerHTML).filter(t => t.includes('cmp-nodata')).length === 3);
  chart.clientWidth = 900; api.redraw();
  ok('redraw at a new width switches layout', /viewBox="0 0 900 /.test(chart.innerHTML) && /cmp-wide/.test(chart.innerHTML));
  {
    /* on a phone the chart comes before the stat chips, which fold behind a closed button */
    const narrowHtml = host.innerHTML;
    const at = s => narrowHtml.indexOf(s);
    ok('narrow: legend, scale toggle, then the chart, then the note, then the chips',
       at('cmp-legend') < at('data-cmp-mode') && at('data-cmp-mode') < at('cmp-chart') && at('cmp-chart') < at('cmp-note') &&
       at('cmp-note') < at('data-cmp-stat='), [at('cmp-legend'), at('data-cmp-mode'), at('cmp-chart'), at('cmp-note'), at('data-cmp-stat=')].join(','));
    ok('narrow: the chips are behind a closed "stats · N" button', /data-cmp-fold="1"[^>]*aria-expanded="false">Stats · 7</.test(narrowHtml) &&
       /class="cmp-stats"[^>]*hidden>/.test(narrowHtml), narrowHtml.slice(at('cmp-statbox'), at('cmp-statbox') + 200));
    host.click('data-cmp-fold', '1');
    ok('narrow: the button opens them without a change event', /aria-expanded="true"/.test(host.innerHTML) &&
       !/class="cmp-stats"[^>]*hidden>/.test(host.innerHTML) && changes.length === 4, changes.length);
    const { host: wide } = mkHost();
    wide.clientWidth = 900;
    C.render(wide, base({ allStats, note: 'n' }));
    const w = wide.innerHTML, wat = s => w.indexOf(s);
    ok('wide: chips stay above the chart, never folded', wat('data-cmp-stat=') < wat('cmp-chart') && !/data-cmp-fold/.test(w));
  }
  const { host: h1 } = mkHost();
  const one = C.render(h1, { players, stats: stats.slice(0, 1), values, pcts });
  h1.click('data-cmp-stat', 'ppg');
  ok('the last stat cannot be removed', one.state.keys.length === 1);
  const again = C.render(h1, base());
  ok('rendering a host again replaces its listener, not stacks it', (h1.listeners.click || []).length === 1 && again);

  const src = rd('epinoia', 'kit', 'compare.css');
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('series s0..s4 are lume aqua amber violet ink-2', ['lume', 'aqua', 'amber', 'violet', 'ink-2']
    .every((t, i) => new RegExp('\\.cmp-s' + i + '\\{\\s*--cmp-c:var\\(--' + t + '\\)').test(css)));
  ok('compare.css never uses --good or --flare', !/--good|--flare/.test(css));
  ok('compare.css styles the legend, controls and the sheet', ['.cmp-legend', '.cmp-mode-btn', '.cmp-stat', '.cmp-sheet', '::backdrop']
    .every(k => css.includes(k)));
  ok('the phone sheet clears the gesture area', /safe-area-inset-bottom/.test(css));
  const js = rd('epinoia', 'compare.js');
  ok('compare.js is UMD: module.exports and window.EpinoiaCompare', /module\.exports = api/.test(js) && /root\.EpinoiaCompare = api/.test(js));
  ok('compare.js writes no colour into the markup', !/fill="(#|var|rgb)/.test(js) && !/stroke="(#|var|rgb)/.test(js));
}

/* -------------------------------------------- 9. fromTable and the categories --- */
console.log('\n9. a table\'s own rows, columns and categories');
{
  /* THE REAL CATALOGUE, not a fixture: what a league's statistics table actually holds.
     If a column is renamed, regrouped or dropped, this section reads the new one. */
  const T = require(path.join(ROOT, 'epinoia', 'fulltable.js'));
  const cols = T.PLAYER_COLS, presets = T.PRESETS.player;
  const keyOf = c => c.k;
  const heat = new Set(cols.filter(c => c.heat).map(keyOf));
  const perGame = cols.filter(c => c.heat && c.g.includes('basic')).map(keyOf);

  const picks = [
    { id: 'p1', name: 'Ada Okafor', teamName: 'York', ppg: 21.4, rpg: 5.1, apg: 3.2, ts: 0.612, p3_pct: 0.381, mpg: 33.1 },
    { id: 'p2', name: 'Bea Lund', teamName: 'Derby', ppg: 14.0, rpg: 9.8, apg: 6.4, ts: 0.55, mpg: 29.7 },
    { id: 'p3', name: 'Cal Price', teamName: 'Bristol', ppg: 8.2, rpg: 3.0, apg: 1.1, ts: 0.499, mpg: 12.0 }
  ];
  const ranks = new Map([['ppg', new Map([['p1', 96], ['p2', 71], ['p3', 22]])],
                         ['p3_pct', new Map([['p1', 84]])]]);

  const S = C.tableStats(perGame, cols, null);
  ok('the stats on screen are what the chart opens on', S.keys.every(k => perGame.includes(k)) && S.keys.length > 1);
  ok('at most eight bars', S.keys.length <= C.MAX_STATS && C.MAX_STATS === 8);
  ok('playing time, fouls and turnovers go behind the real stats', (() => {
    const first = S.keys.findIndex(k => C.DEMOTED.has(k));
    return first === -1 || S.keys.slice(first).every(k => C.DEMOTED.has(k));
  })(), S.keys.join(','));
  ok('a locked column is never offered', !C.tableStats(perGame, cols, k => k === 'ppg').pool.includes('ppg'));
  ok('RAPM is never compared — it has no meaning off one floor',
     !C.tableStats(['rapm', 'orapm', 'drapm'].concat(perGame), cols, null).pool.some(k => /rapm$/.test(k)));

  const groups = C.tableGroups(presets, cols, null);
  ok('one dropdown per category', groups.length === presets.filter(p => p[0] !== '*').length, groups.length + ' of ' + presets.length);
  ok('"everything" is not a category of its own', !groups.some(g => g.key === '*'));
  ok('each carries the table\'s own label and its own stats', groups.every(g =>
    g.label === (presets.find(p => p[0] === g.key) || [])[1] && g.stats.length > 0 &&
    g.stats.every(s => heat.has(s.key))));
  ok('between them the categories reach far more than the eight on screen',
     new Set(groups.flatMap(g => g.stats.map(s => s.key))).size > 60);
  ok('a locked column is dropped from the categories too',
     !C.tableGroups(presets, cols, k => k === 'ppg').some(g => g.stats.some(s => s.key === 'ppg')));

  const o = C.fromTable({ picks, statKeys: perGame, cols, ranks, groups: presets, max: 5,
                          note: 'Percentiles among the players this table covers.' });
  ok('the picks become the players, in their order', o.players.map(p => p.name).join() === 'Ada Okafor,Bea Lund,Cal Price');
  ok('max caps the picks', C.fromTable({ picks, statKeys: perGame, cols, groups: presets, max: 2 }).players.length === 2);
  ok('EVERY comparable column is valued, not only the ones on screen',
     Object.keys(o.values.p1).length > 100 && o.values.p1.ts === 0.612 && o.values.p1.p3_pct === 0.381);
  ok('a stat this player has no number for is null, never 0', o.values.p2.p3_pct === null);
  ok('the table\'s percentiles come through', o.pcts.p1.ppg === 96 && o.pcts.p3.ppg === 22 && o.pcts.p2.p3_pct === null);
  ok('percentile is the scale it opens on, with the table\'s note',
     o.mode === 'pct' && /players this table covers/.test(o.note));
  ok('the chart draws, with no NaN', (() => { const s = C.html(Object.assign({}, o, { width: 375 }));
    return /<svg/.test(s) && !/NaN|Infinity/.test(s); })());

  /* the dropdowns on screen, and what choosing a line does */
  const mkHost = () => {
    const chart = { clientWidth: 375, innerHTML: '' };
    const host = {
      clientWidth: 900, _html: '', listeners: {},
      set innerHTML(v) { this._html = v; chart.innerHTML = ''; }, get innerHTML() { return this._html; },
      querySelector: sel => (sel === '.cmp-chart' ? chart : null),
      contains: () => true,
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); },
      /* a <select> whose value is the chosen key, as the browser hands it over */
      pick(value) {
        const sel = { value, selectedIndex: 3, getAttribute: () => null };
        sel.closest = s => (s === '[data-cmp-group]' ? sel : null);
        (this.listeners.change || []).forEach(fn => fn({ target: sel }));
        return sel;
      },
      click(attrName, value) {
        const btn = { getAttribute: k => (k === attrName ? value : null) };
        btn.closest = s => (s === '[' + attrName + ']' ? btn : null);
        (this.listeners.click || []).forEach(fn => fn({ target: btn }));
      }
    };
    return { host, chart };
  };
  const { host } = mkHost();
  const seen = [];
  const api = C.render(host, Object.assign({}, o, { onChange: c => seen.push(c) }));
  ok('a select per category, each with a placeholder and its stats',
     count(host.innerHTML, /<select class="cmp-pick" data-cmp-group=/g) === groups.length &&
     /<option value="">per game/.test(host.innerHTML));
  /* on a wide screen the row of them is behind a button of its own: sixteen dropdowns above
     the chart put the bars off the bottom of the panel */
  ok('on a wide screen the categories are folded away, and the chart is not pushed down',
     /data-cmp-more="1"[^>]*aria-expanded="false">Every stat · by category</.test(host.innerHTML) &&
     /<div class="cmp-more"[^>]*hidden>/.test(host.innerHTML) &&
     host.innerHTML.indexOf('cmp-morebox') < host.innerHTML.indexOf('cmp-chart'));
  host.click('data-cmp-more', '1');
  ok('the button opens them, and closes them again, without redrawing the comparison',
     /aria-expanded="true"/.test(host.innerHTML) && !/<div class="cmp-more"[^>]*hidden>/.test(host.innerHTML) &&
     seen.length === 0);
  ok('a stat already drawn is ticked, the rest are offered with a +',
     /<option value="ppg">✓ /.test(host.innerHTML) && /<option value="[^"]+">\+ /.test(host.innerHTML));
  ok('the placeholder counts what the category has drawn', /<option value="">per game · \d+</.test(host.innerHTML));
  ok('the chips are still there — the dropdowns are beside them, not instead',
     count(host.innerHTML, /data-cmp-stat=/g) === o.allStats.length);

  const off = api.state.keys.slice();
  const chosen = groups.find(g => g.key === 'advanced').stats.map(s => s.key).find(k => !off.includes(k));
  const sel = host.pick(chosen);
  ok('choosing a line adds that stat', api.state.keys.includes(chosen) && seen.length === 1 && seen[0].stats.includes(chosen));
  ok('the dropdown is an action, not a setting — it goes back to its placeholder', sel.selectedIndex === 0);
  ok('it is now ticked in its category', new RegExp('<option value="' + chosen + '">✓ ').test(host.innerHTML));
  host.pick(chosen);
  ok('choosing it again takes it out', !api.state.keys.includes(chosen));
  host.click('data-cmp-stat', chosen);
  host.click('data-cmp-stat', chosen);
  ok('a stat added from a dropdown can be taken out by its chip', !api.state.keys.includes(chosen));
  const empty = mkHost();
  C.render(empty.host, Object.assign({}, o, { statGroups: [] }));
  ok('a table with no categories draws no dropdowns and no button for them',
     !/cmp-pick/.test(empty.host.innerHTML) && !/data-cmp-more/.test(empty.host.innerHTML));

  /* on a phone the chips already fold; the dropdowns ride inside that fold, not behind a second one */
  const narrow = mkHost();
  narrow.host.clientWidth = 375;
  C.render(narrow.host, o);
  const nh = narrow.host.innerHTML;
  ok('on a phone they are inside the chips\' own fold, with no button of their own',
     !/data-cmp-more/.test(nh) && nh.indexOf('cmp-more') > nh.indexOf('data-cmp-fold') &&
     nh.indexOf('cmp-more') < nh.lastIndexOf('</div></div>'));
  ok('...and the chart still comes first', nh.indexOf('cmp-chart') < nh.indexOf('cmp-more'));

  const css = rd('epinoia', 'kit', 'compare.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('compare.css styles the dropdowns', /\.cmp-pick\{/.test(css) && /\.cmp-more\{/.test(css));
  ok('no text under 11px', !(css.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || [])
    .some(m => parseFloat(m.replace(/[^\d.]/g, '')) < 11));
}

/* ------------------------------------ 10. every league's statistics table --- */
console.log('\n10. the comparison on every league\'s table');
{
  const ft = rd('epinoia', 'fulltable.js');
  ok('the tray falls back to the shared comparison when a page gives no onCompare',
     /if \(typeof opts\.onCompare === 'function'\)[\s\S]{0,80}openCompare\(\);/.test(ft));
  ok('openCompare hands over the picks, the stats on screen, the ranks and the categories',
     /C\.open\(C\.fromTable\(\{[\s\S]{0,200}picks: getSelected\(\), statKeys: keys, cols: CAT, ranks, groups: presets/.test(ft));
  ok('every comparable column is ranked, so a stat chosen from a dropdown has its percentile',
     /const rankable = CAT\.filter\(c => c\.heat && !absent\(c\.k\)\)\.map\(c => c\.k\);/.test(ft) &&
     /getRanksFor\(rankable\)/.test(ft));
  ok('getRanksFor is a function the table can call, not only an API method',
     /function getRanksFor\(keys\) \{/.test(ft) && /getRanks: getRanksFor,/.test(ft));
  ok('a team table never opens the player comparison', /typeof C\.open !== 'function' \|\| isTeam\) return;/.test(ft));
  ok('the compare script is reached through the global it is loaded as',
     /const api = factory\(root\);/.test(ft) && /const C = root\.EpinoiaCompare;/.test(ft));

  const pages = [
    ['the season statistics page', ['epinoia', 'stats', 'stats.js'], ['epinoia', 'stats', 'index.html']],
    ['the league page\'s leaders', ['epinoia', 'l', 'league.js'], ['epinoia', 'l', 'index.html']]
  ];
  pages.forEach(([what, js, html]) => {
    const src = rd(...js), page = rd(...html);
    ok(what + ' selects players to compare', /selectable: \{ max: 5 \}/.test(src));
    ok(what + ' loads compare.js', /<script src="\.\.\/compare\.js\?v=\d+" defer><\/script>/.test(page));
    ok(what + ' loads its stylesheet', /<link rel="stylesheet" href="\.\.\/kit\/compare\.css\?v=\d+">/.test(page));
    ok(what + ' loads it after the table it belongs to',
       page.indexOf('fulltable.js') < page.indexOf('compare.js'));
  });
  /* the league page draws a team table on another tab; only the players' one selects */
  const lg = rd('epinoia', 'l', 'league.js');
  ok('the team table is left alone', (lg.match(/selectable: \{ max: 5 \}/g) || []).length === 1 &&
     lg.indexOf('selectable') < lg.indexOf("kind: 'team'"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
