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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
