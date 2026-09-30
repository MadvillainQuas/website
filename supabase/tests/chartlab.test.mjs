// The chart lab's pure parts (epinoia/chartlab.js): value transforms, regression, the address round trip and the edited text,
// search, the column catalogue and the membership lock, label placement, keyboard neighbours and the export's geometry.
//   node supabase/tests/chartlab.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };
const near = (a, b, e = 1e-9) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= e;
let seed = 20260930;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const C = require(path.join(ROOT, 'chartlab.js'));
const TB = require(path.join(ROOT, 'fulltable.js'));
const SE = require(path.join(ROOT, 'season.js'));
const SI = require(path.join(ROOT, 'statinfo.js'));
const SP = require(path.join(ROOT, 'statpop.js'));
const AC = require(path.join(ROOT, 'access.js'));
const src = readFileSync(path.join(ROOT, 'chartlab.js'), 'utf8');

/* ============================================================================================ transforms === */
console.log('-- value transforms: absolute, delta, % difference, z-score, percentile');
{
  const v = [10, 20, 30, null, 40];
  const a = C.transformValues(v, 'a', false);
  ok('absolute keeps the values and the gaps', JSON.stringify(a.out) === JSON.stringify([10, 20, 30, null, 40]), a.out);
  ok('the average is over the values that exist (25)', near(a.mean, 25) && a.n === 4, [a.mean, a.n]);
  const d = C.transformValues(v, 'd', false);
  ok('delta is the value minus the average', JSON.stringify(d.out) === JSON.stringify([-15, -5, 5, null, 15]), d.out);
  const p = C.transformValues(v, 'p', false);
  ok('% difference is (value - avg) / avg', near(p.out[0], -60) && near(p.out[4], 60) && p.out[3] === null, p.out);
  const z = C.transformValues(v, 'z', false);
  const sd = Math.sqrt((225 + 25 + 25 + 225) / 4);
  ok('z-score divides by the standard deviation', near(z.out[0], -15 / sd) && near(z.out[4], 15 / sd) && z.out[3] === null, z.out);
  ok('z-scores of the values that exist sum to zero', near(z.out.filter(x => x != null).reduce((s, x) => s + x, 0), 0, 1e-9));
  const zl = C.transformValues(v, 'z', true);
  ok('lower is better turns a z-score round: the lowest value is the highest z', near(zl.out[0], 15 / sd) && near(zl.out[4], -15 / sd), zl.out);
  const dl = C.transformValues(v, 'd', true);
  ok('a difference keeps the statistic\'s own sign even when lower is better', JSON.stringify(dl.out) === JSON.stringify(d.out));
  const r = C.transformValues(v, 'r', false);
  ok('percentile: the lowest is 0, the highest 100, the gap stays a gap', r.out[0] === 0 && r.out[4] === 100 && r.out[3] === null && near(r.out[1], 100 / 3) && near(r.out[2], 200 / 3), r.out);
  const rl = C.transformValues(v, 'r', true);
  ok('percentile of a lower-is-better statistic: the lowest value is the 100th', rl.out[0] === 100 && rl.out[4] === 0, rl.out);
  ok('percentile needs three values', C.transformValues([1, 2], 'r', false).out.every(x => x === null));
  ok('all missing: nothing, no NaN', (() => { const t = C.transformValues([null, NaN, undefined, Infinity], 'z', false); return t.n === 0 && t.out.every(x => x === null); })());
  ok('no spread: every z is 0, not NaN', C.transformValues([5, 5, 5], 'z', false).out.every(x => x === 0));
  ok('a % difference from an average of 0 says nothing', C.transformValues([-1, 0, 1], 'p', false).out.every(x => x === null));
  ok('an unknown mode reads as absolute', JSON.stringify(C.transformValues([1, 2, 3], 'x', false).out) === '[1,2,3]');
  ok('strings and NaN are not values', JSON.stringify(C.transformValues(['3', NaN, 4], 'a', false).out) === '[null,null,4]');
}
console.log('-- percentiles agree with the site\'s own (season.js percentiles)');
{
  let bad = 0, runs = 0;
  for (let t = 0; t < 40; t++) {
    const n = 5 + Math.floor(rnd() * 60), low = rnd() < 0.5;
    const vals = Array.from({ length: n }, () => (rnd() < 0.1 ? null : Math.round(rnd() * 40) / 2));   // ties on purpose
    const rows = vals.map((x, i) => ({ id: i, k: x }));
    const site = SE.percentiles(rows, ['k'], low ? ['k'] : [], () => 'all').get('k');
    const mine = C.transformValues(vals, 'r', low).out;
    if (!site) { if (mine.some(x => x != null)) bad++; continue; }
    runs++;
    rows.forEach((r, i) => { if (r.k == null) return; if (!near(site.get(r.id), mine[i], 1e-9)) bad++; });
  }
  ok('the same percentile as the tables give, ties and lower-is-better included (' + runs + ' random columns)', bad === 0, bad);
}
console.log('-- rank and percentile for a tooltip');
{
  const vals = [3, 9, 5, null, 7];
  const r = C.rankOf(vals, 9, false), l = C.rankOf(vals, 3, true);
  ok('rank 1 of 4 for the highest', r.rank === 1 && r.n === 4 && near(r.pct, 100), r);
  ok('rank 1 for the lowest when lower is better, and the 100th percentile', l.rank === 1 && near(l.pct, 100), l);
  ok('no value, no rank', C.rankOf(vals, null, false) === null);
}

/* ============================================================================================ regression === */
console.log('-- least-squares trend and r');
{
  const xs = [1, 2, 3, 4, 5], ys = [3, 5, 7, 9, 11];
  const g = C.regress(xs, ys);
  ok('an exact line: slope 2, intercept 1, r 1', near(g.slope, 2) && near(g.intercept, 1) && near(g.r, 1) && g.n === 5, g);
  const n = C.regress(xs, [11, 9, 7, 5, 3]);
  ok('a falling line has r -1', near(n.r, -1) && near(n.slope, -2), n);
  const h = C.regress([1, 2, 3, 4], [2, 1, 4, 3]);
  ok('hand-worked: slope 0.6, r 0.6', near(h.slope, 0.6) && near(h.r, 0.6, 1e-9), h);
  const m = C.regress([1, null, 3, 4, NaN, 6], [2, 5, 6, 8, 1, 12]);
  ok('pairs with a missing side are left out', m.n === 4 && near(m.slope, 2) && near(m.r, 1, 1e-9), m);
  ok('fewer than three pairs: no line', C.regress([1, 2], [1, 2]) === null);
  ok('no spread in x: no line', C.regress([2, 2, 2], [1, 2, 3]) === null);
  ok('no spread in y: a flat line and r null', (() => { const q = C.regress([1, 2, 3], [4, 4, 4]); return q && near(q.slope, 0) && q.r === null; })());
  let bad = 0;
  for (let t = 0; t < 50; t++) {
    const k = 5 + Math.floor(rnd() * 40), a = rnd() * 4 - 2, b0 = rnd() * 10;
    const x = Array.from({ length: k }, () => rnd() * 10), y = x.map(v => a * v + b0 + (rnd() - 0.5) * 3);
    const q = C.regress(x, y);
    const mx = x.reduce((s, v) => s + v, 0) / k, my = y.reduce((s, v) => s + v, 0) / k;
    let sxy = 0, sxx = 0; x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) * (v - mx); });
    if (!near(q.slope, sxy / sxx, 1e-9) || !near(q.intercept, my - (sxy / sxx) * mx, 1e-9) || Math.abs(q.r) > 1) bad++;
  }
  ok('random data: the slope and intercept are the least-squares ones, |r| <= 1', bad === 0, bad);
}

/* ============================================================================================ address === */
console.log('-- the chart in the address (?cl=) round trips');
{
  const d = C.defaultState('p');
  ok('a plain chart is a short link', C.encodeState(d).length <= 12, C.encodeState(d));
  ok('...and comes back as itself', JSON.stringify(C.decodeState(C.encodeState(d))) === JSON.stringify(d));
  const s = C.defaultState('t');
  s.a = { x: 'ortg', y: 'drtg', xm: 'z', ym: 'r', y2: '', xl: 0, yl: 0 };
  s.b = { x: 'pace', y: 'net', xm: 'd', ym: 'p', y2: 'ortg', xl: 1, yl: 1 };
  s.sz = 'gp'; s.co = 'n'; s.nm = 'a'; s.qd = 0; s.qc = 1; s.tr = 1; s.tb = 1; s.cr = 0; s.gp = 4; s.mn = 120;
  s.pin = ['a-b-c', 'id with space', 'x:y,z~w', 'éè']; s.hl = [];
  s.tx = { ti: 'A title <b>&amp; "quotes"', su: 'Sub', aq1: 'top right', bx: 'Assists a night' };
  s.lb = { 'a-b-c': 'Nelson', 'x:y,z~w': 'Z' };
  const back = C.decodeState(C.encodeState(s));
  ok('every field survives: entity, both charts, modes, overlay, log, size, colour, names, flags, filters, pins, texts, labels', JSON.stringify(back) === JSON.stringify(C.sanitizeState(s)), back);
  ok('the address holds only URL-safe characters (no chat app re-encodes it)', /^[A-Za-z0-9._-]+$/.test(C.encodeState(s)), C.encodeState(s));
  let bad = 0;
  const modes = ['a', 'd', 'p', 'z', 'r'], keys = ['ppg', 'ts', 'usg', 'ev_second_ppg', 'z_rim_efg', 'p3_pct'];
  for (let t = 0; t < 200; t++) {
    const e = rnd() < 0.5 ? 'p' : 't', q = C.defaultState(e);
    q.a = { x: keys[Math.floor(rnd() * keys.length)], y: keys[Math.floor(rnd() * keys.length)], xm: modes[Math.floor(rnd() * 5)], ym: modes[Math.floor(rnd() * 5)], y2: rnd() < 0.3 ? 'usg' : '', xl: rnd() < 0.2 ? 1 : 0, yl: rnd() < 0.2 ? 1 : 0 };
    if (rnd() < 0.4) q.b = { x: keys[Math.floor(rnd() * keys.length)], y: keys[Math.floor(rnd() * keys.length)], xm: 'a', ym: 'a', y2: '', xl: 0, yl: 0 };
    ['qd', 'qc', 'tr', 'tb', 'cr'].forEach(k => { q[k] = rnd() < 0.5 ? 1 : 0; });
    q.co = ['c', 'p', 'n'][Math.floor(rnd() * 3)]; q.nm = ['s', 'a', 'n'][Math.floor(rnd() * 3)];
    q.gp = rnd() < 0.5 ? null : Math.floor(rnd() * 30); q.mn = Math.floor(rnd() * 500);
    q.ps = e === 'p' ? ['', 'G', 'F', 'C'][Math.floor(rnd() * 4)] : '';
    q.pin = Array.from({ length: Math.floor(rnd() * 6) }, () => 'id' + Math.floor(rnd() * 99));
    q.hl = e === 'p' ? Array.from({ length: Math.floor(rnd() * 3) }, () => 't' + Math.floor(rnd() * 20)) : [];
    if (rnd() < 0.5) q.tx = { ti: 'T' + rnd(), fo: 'F’s 日本' };
    if (rnd() < 0.5) q.lb = { id5: 'Lbl ' + Math.floor(rnd() * 100) };
    const r = C.decodeState(C.encodeState(q));
    if (JSON.stringify(r) !== JSON.stringify(C.sanitizeState(q))) bad++;
  }
  ok('200 random charts round trip exactly', bad === 0, bad);
  ok('a link that is not ours decodes to nothing', C.decodeState('nonsense') === null && C.decodeState('') === null && C.decodeState('2.eyJ2IjoxfQ') === null && C.decodeState(null) === null);
  ok('a damaged link decodes to nothing, never throws', (() => { try { return C.decodeState('1.@@@@') === null || typeof C.decodeState('1.@@@@') === 'object'; } catch (_) { return false; } })());
  ok('a huge link is refused', C.decodeState('1.' + 'A'.repeat(9000)) === null);
  const bogus = C.decodeState('1.' + C.toB64u(JSON.stringify({ v: 1, e: 'q', a: { x: '../../etc', y: 'ts<script>', xm: 'zz' }, co: 'x', nm: '!', gp: -5, mn: 1e12, pin: [1, {}, 'ok'], tx: { ti: 5, nope: 'x' }, lb: 'no' })));
  ok('nonsense inside a valid link is put right: unknown entity, bad keys and modes, out-of-range numbers, wrong types',
    bogus.ent === 'p' && bogus.a.x === 'ppg' && bogus.a.y === 'ts' && bogus.a.xm === 'a' && bogus.co === 'c' && bogus.nm === 's' && bogus.gp === 0 && bogus.mn === 99999 && JSON.stringify(bogus.pin) === '["1","ok"]' && !('ti' in bogus.tx) && !('nope' in bogus.tx) && Object.keys(bogus.lb).length === 0, bogus);
  ok('other parameters of the page are kept and ?cl= is replaced', (() => { const q = C.withQuery('?l=nbl&s=2026-27&cl=old', s, false); return /l=nbl/.test(q) && /s=2026-27/.test(q) && !/old/.test(q) && C.readQuery(q).a.x === 'ortg'; })());
  ok('a plain chart takes ?cl= off the address', C.withQuery('?l=nbl&cl=old', d, true) === '?l=nbl');
  ok('reading the query of a page with none', C.readQuery('?l=nbl') === null);
}
console.log('-- statistics a link names that the page cannot give');
{
  const cat = C.buildCatalogue('player', TB.PLAYER_COLS, TB.PRESETS.player, [], null, { zones: true });
  const locked = { locked: true, isPremium: AC.isPremiumColumn }, open = { locked: false, isPremium: AC.isPremiumColumn };
  const s = C.defaultState('p'); s.a.x = 'ev_second_ppg'; s.a.y = 'not_a_column'; s.sz = 'ev_half_ppg'; s.a.y2 = 'z_rim_efg';
  const f = C.fitState(s, cat, locked);
  ok('a locked events column, a missing one, a locked size and a locked overlay all fall back', f.a.x === 'ppg' && f.a.y === 'ts' && f.sz === '' && f.a.y2 === '', f);
  const g = C.fitState(s, cat, open);
  ok('the same link keeps its events columns for a member (only the missing one falls back)', g.a.x === 'ev_second_ppg' && g.a.y === 'ts' && g.sz === 'ev_half_ppg', g);
  const same = C.defaultState('p'); same.a.x = 'ppg'; same.a.y = 'ppg';
  ok('the same statistic on both axes is separated', C.fitState(same, cat, open).a.x !== C.fitState(same, cat, open).a.y);
}

/* ============================================================================================ text === */
console.log('-- edited text: capped, cleaned, never markup');
{
  ok('white space is folded and trimmed', C.sanitizeText('  a \t b\n\nc  ', 50) === 'a b c');
  ok('control characters go', C.sanitizeText('a\u0000b\u0007c\u001Fd\u007Fe\u0085f', 50) === 'abcdef');
  ok('zero-width and bidi-override characters go (they spoof names and break SVG)', C.sanitizeText('ab​‎‮⁦cd﻿e', 50) === 'abcde');
  ok('capped by characters, not by UTF-16 units: an emoji is never cut in half', (() => { const t = C.sanitizeText('🏀🏀🏀', 2); return Array.from(t).length === 2 && !/[\uD800-\uDFFF]$/.test(t.slice(-1)) || t === '🏀🏀'; })());
  ok('lone surrogates go', C.sanitizeText('a\uD800b\uDC00c', 50) === 'abc');
  ok('the cap trims the end', C.sanitizeText('abcdefghij', 4) === 'abcd' && C.sanitizeText('abc def', 4) === 'abc');
  ok('markup is kept as plain characters: it is only ever set with textContent', C.sanitizeText('<img src=x onerror=alert(1)> & "q"', 60) === '<img src=x onerror=alert(1)> & "q"');
  ok('nothing in, nothing out', C.sanitizeText(null, 9) === '' && C.sanitizeText(undefined, 9) === '' && C.sanitizeText(42, 9) === '42');
  ok('every editable text has a cap, and the caps are modest', C.TEXT_KEYS.every(k => C.TEXT_CAPS[k] >= 30 && C.TEXT_CAPS[k] <= 200) && C.TEXT_KEYS.indexOf('ti') >= 0 && C.TEXT_KEYS.indexOf('bq3') >= 0);
  const long = 'x'.repeat(500);
  const s = C.sanitizeState({ tx: { ti: long, su: long, fo: long, ax: long, aq0: long, nope: 'x' }, lb: { id1: long, id2: '   ' } });
  ok('over-long text in a link is capped to each key\'s limit', s.tx.ti.length === C.TEXT_CAPS.ti && s.tx.su.length === C.TEXT_CAPS.su && s.tx.fo.length === C.TEXT_CAPS.fo && s.tx.ax.length === C.TEXT_CAPS.ax && s.tx.aq0.length === C.TEXT_CAPS.aq0 && !s.tx.nope, Object.keys(s.tx));
  ok('a label is capped at 28 and a blank label is dropped', s.lb.id1.length === 28 && !('id2' in s.lb), s.lb);
  const many = {}; for (let i = 0; i < 100; i++) many['id' + i] = 'L' + i;
  ok('at most 40 renamed labels and 30 pins are kept', Object.keys(C.sanitizeState({ lb: many }).lb).length === 40 && C.sanitizeState({ pin: Object.keys(many) }).pin.length === 30);
  const rt = C.decodeState(C.encodeState(Object.assign(C.defaultState('p'), { tx: { ti: 'Points – 日本語 é <b>&', fo: 'Source: "Epinoia" ©' }, lb: { p1: 'O’Neal' } })));
  ok('edited text with quotes, markup and non-Latin letters comes back unchanged', rt.tx.ti === 'Points – 日本語 é <b>&' && rt.tx.fo === 'Source: "Epinoia" ©' && rt.lb.p1 === 'O’Neal', rt);
  ok('the module never builds markup from text: no innerHTML, insertAdjacentHTML, document.write or eval', !/\.innerHTML\s*[+]?=|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src));
}

/* ============================================================================================ search === */
console.log('-- search and type-ahead');
{
  const list = [
    { id: 1, name: 'Luke Nelson', clubName: 'Sydney Kings', clubShort: 'SYD' }, { id: 2, name: 'José Nelsen', clubName: 'Perth Wildcats', clubShort: 'PER' },
    { id: 3, name: 'Nelson Mandela', clubName: 'Adelaide 36ers', clubShort: 'ADL' }, { id: 4, name: 'Bryce Cotton', clubName: 'Adelaide 36ers', clubShort: 'ADL' },
    { id: 5, name: 'Anne O’Connor', clubName: 'Nelson Bay', clubShort: 'NEL' }, { id: 6, name: 'Łukasz Kowalski', clubName: 'Warsaw', clubShort: 'WAR' }];
  const ids = q => C.matchEntities(list, q, 8).map(e => e.id);
  ok('a name that starts with the query comes first', ids('nelson')[0] === 3 && ids('nelson').indexOf(1) > 0, ids('nelson'));
  ok('a word inside a name beats the club', ids('nelson').indexOf(1) < ids('nelson').indexOf(5), ids('nelson'));
  ok('the club is searched too', ids('36ers').slice().sort().join() === '3,4', ids('36ers'));
  ok('every word must match', ids('luke syd').join() === '1' && ids('luke perth').length === 0, ids('luke syd'));
  ok('diacritics and case do not matter', ids('JOSE').join() === '2' && ids('nelsen').join() === '2', ids('JOSE'));
  ok('an apostrophe is not needed', ids('oconnor').length === 0 || ids('o connor').join() === '5', ids('o connor'));
  ok('nothing typed, nothing offered', ids('').length === 0 && ids('   ').length === 0);
  ok('the number of results is capped', C.matchEntities(list, 'a', 2).length === 2);
  ok('a partial name works', ids('cot').join() === '4' && ids('bry cot').join() === '4');
  let bad = 0;
  const big = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: 'Player' + i + ' Name' + (i % 37), clubName: 'Club' + (i % 12) }));
  const t0 = Date.now(); for (let i = 0; i < 40; i++) if (C.matchEntities(big, 'name' + (i % 37), 8).length > 8) bad++;
  ok('2000 rows are searched in a blink (40 searches ' + (Date.now() - t0) + ' ms)', bad === 0 && Date.now() - t0 < 1500);
}

/* ============================================================================================ columns === */
console.log('-- the catalogue is the tables\' own columns');
const rowsFor = (cols, n) => Array.from({ length: n }, (_, i) => { const r = { id: 'r' + i }; cols.forEach(c => { if (c.k && !c.text) r[c.k] = Math.round(rnd() * 5000) / 100; }); Object.assign(r, { gp: 10 + (i % 5), min: 200 + i, fgm: 300, fga: 700, p3m: 90, p3a: 250, ftm: 120, fta: 160, fgm_pg: 5.5, fga_pg: 12, p3m_pg: 2.25, p3a_pg: 6, ftm_pg: 3, fta_pg: 4, diff_net: -3.5, pm: 12 }); return r; });
const pcat = C.buildCatalogue('player', TB.PLAYER_COLS, TB.PRESETS.player, rowsFor(TB.PLAYER_COLS, 40), k => SI.info(k, 'player'), { zones: false });
const tcatz = C.buildCatalogue('team', TB.TEAM_COLS, TB.PRESETS.team, rowsFor(TB.TEAM_COLS, 12), k => SI.info(k, 'team'), { zones: true });
const tcat = C.buildCatalogue('team', TB.TEAM_COLS, TB.PRESETS.team, rowsFor(TB.TEAM_COLS, 12), k => SI.info(k, 'team'), { zones: false });
{
  ok('players: a couple of hundred columns, in the tables\' groups', pcat.list.length > 150 && pcat.groups.length >= 10, [pcat.list.length, pcat.groups.length]);
  ok('teams: more still with the zones', tcatz.list.length > tcat.list.length && tcatz.list.some(c => /^z_/.test(c.k)) && !tcat.list.some(c => /^z_/.test(c.k)));
  ok('the group labels are the tables\' preset labels', pcat.groups.some(g => g.label === 'per game') && pcat.groups.some(g => g.label === 'on / off') && tcat.groups.some(g => g.label === 'four factors'), pcat.groups.map(g => g.label));
  ok('GP and MPG sit in a group of their own, first', pcat.groups[0].key === 'context' && pcat.groups[0].items.map(c => c.k).join() === 'gp,mpg', pcat.groups[0].items.map(c => c.k));
  const by = (cat, k) => cat.byKey.get(k);
  ok('lower-is-better is the table\'s: turnovers, opponent eFG%, DRTG', by(pcat, 'topg').low && by(pcat, 'tov_pct').low && by(tcat, 'drtg').low && by(tcat, 'dff_efg').low && !by(pcat, 'ppg').low);
  ok('signed statistics are the table\'s: net, diff, +/-', by(tcat, 'net').signed && by(pcat, 'diff_net').signed && by(pcat, 'pm').signed && !by(pcat, 'ppg').signed);
  ok('decimals come from the table\'s own formatter: GP 0, PPG 1, PPP 2, NET 1', by(pcat, 'gp').dp === 0 && by(pcat, 'ppg').dp === 1 && by(pcat, 'ppp').dp === 2 && by(tcat, 'net').dp === 1, [by(pcat, 'gp').dp, by(pcat, 'ppg').dp, by(pcat, 'ppp').dp, by(tcat, 'net').dp]);
  ok('a made-attempted pair is charted as the made half, and says so', by(pcat, 'fgm_pg').label === 'FG made / G' && by(pcat, 'fgm_pg').get({ fgm_pg: 6.2 }) === 6.2 && !!by(pcat, 'fga_pg') && !!by(pcat, 'p3a_pg'));
  ok('the four-factor eFG% and the shot chart\'s eFG% are told apart', tcatz.byKey.get('ff_efg').name !== tcatz.byKey.get('efg_sh').name && /four factors|shooting/.test(tcatz.byKey.get('efg_sh').name + tcatz.byKey.get('ff_efg').name), [tcatz.byKey.get('ff_efg').name, tcatz.byKey.get('efg_sh').name]);
  ok('events columns carry their situation in the name: "Second chance · points per game"', /^Second chance · points per game$/.test(by(pcat, 'ev_second_ppg').name), by(pcat, 'ev_second_ppg').name);
  ok('no identity or text column is offered', !pcat.byKey.has('rank') && !pcat.byKey.has('name') && !pcat.byKey.has('teamName') && !pcat.byKey.has('rapm'));
  ok('every column has a name, a group that exists, a getter and a plain title', pcat.list.concat(tcat.list).every(c => c.name && c.title && typeof c.get === 'function' && (pcat.groups.concat(tcat.groups).some(g => g.key === c.g))));
  ok('names are unique within a catalogue (the picker never shows two the same)', new Set(pcat.list.map(c => c.name)).size === pcat.list.length && new Set(tcatz.list.map(c => c.name)).size === tcatz.list.length,
    pcat.list.map(c => c.name).filter((n, i, a) => a.indexOf(n) !== i));
  ok('statinfo\'s plain title is used where there is one, our own where not', by(pcat, 'ts').title === 'True shooting %' && by(pcat, 'topg').title === 'Turnovers per game', [by(pcat, 'ts').title, by(pcat, 'topg').title]);
  const sparse = C.buildCatalogue('player', TB.PLAYER_COLS, TB.PRESETS.player, rowsFor(TB.PLAYER_COLS, 10).map(r => { const o = Object.assign({}, r); Object.keys(o).forEach(k => { if (/^ev_/.test(k)) delete o[k]; }); return o; }), null, { zones: false });
  ok('a column with no data in this competition is not offered', !sparse.byKey.has('ev_second_ppg') && sparse.byKey.has('ppg'));
}
console.log('-- membership: events and zone columns are locked when analytics are');
{
  const locked = { locked: true, isPremium: AC.isPremiumColumn }, open = { locked: false, isPremium: AC.isPremiumColumn };
  ok('open for a member and where memberships are off', C.columnState('ev_second_ppg', open) === 'open' && C.columnState('z_rim_efg', open) === 'open');
  ok('locked when analytics are locked: every events split, the opponent\'s, the zones, the shot-diet columns',
    ['ev_second_ppg', 'ev_assist_ast_sh', 'evd_half_ppp', 'z_c3_att100', 'pred_efg', 'efg_sh', 'efg_vs', 'morey'].every(k => C.columnState(k, locked) === 'locked'));
  ok('ordinary columns stay open when locked', ['ppg', 'ts', 'usg', 'bpm', 'gp', 'mpg', 'net', 'pace', 'ff_efg', 'diff_net'].every(k => C.columnState(k, locked) === 'open'));
  ok('the rule is access.js\'s own (isPremiumColumn / CATALOGUE), not a list of ours', AC.CATALOGUE.columnPrefixes.every(p => C.columnState(p + 'x', locked) === 'locked') && AC.CATALOGUE.columns.every(k => C.columnState(k, locked) === 'locked'));
  ok('no access module: nothing is locked', C.columnState('ev_second_ppg', { locked: true }) === 'open' && C.columnState('ev_second_ppg', null) === 'open');
  const gs = pcat.groups.map(g => [g.key, C.groupState(g, locked)]);
  ok('the six events groups are locked whole, the rest are open', gs.filter(x => x[1] === 'locked').map(x => x[0]).join() === 'ev_second,ev_transition,ev_offTo,ev_ato,ev_half,ev_assist' && gs.filter(x => x[1] === 'open').length === gs.length - 6, gs.filter(x => x[1] === 'locked').map(x => x[0]));
  const tg = tcatz.groups.map(g => [g.key, C.groupState(g, locked)]).filter(x => x[1] === 'locked').map(x => x[0]);
  ok('a club\'s zone groups are locked whole too, and the shot-diet columns inside the open groups are locked one by one', ['z_rim', 'z_mid', 'z_three', 'z_cuts'].every(k => tg.indexOf(k) >= 0) && tg.indexOf('scoring') < 0 && tg.indexOf('shooting') < 0 && C.columnState('morey', locked) === 'locked' && C.columnState('efg_vs', locked) === 'locked', tg);
  ok('GP and MPG never make a group locked', C.groupState({ items: [tcatz.byKey.get('gp')] }, locked) === 'open');
  ok('a locked statistic is not a usable one', C.usableKey(pcat, 'ev_second_ppg', locked, 'ppg') === 'ppg' && C.usableKey(pcat, 'ev_second_ppg', open, 'ppg') === 'ev_second_ppg' && C.usableKey(pcat, 'gone', open, 'ppg') === 'ppg');
  const ps = C.presetsFor('p', pcat, locked);
  ok('presets whose columns exist and are open are offered: players', ps.length >= 8 && ps.every(p => p.ent === 'p') && ps.some(p => p.id === 'score-eff'), ps.map(p => p.id));
  ok('...and teams', C.presetsFor('t', tcat, locked).some(p => p.id === 'pace-net') && C.presetsFor('t', tcat, locked).every(p => p.ent === 't'));
  function sparseCat() { return C.buildCatalogue('player', TB.PLAYER_COLS, TB.PRESETS.player, rowsFor(TB.PLAYER_COLS, 10).map(r => { const o = Object.assign({}, r); delete o.p3a_pg; delete o.p3_pct; return o; }), null, { zones: false }); }
  ok('a preset with a column the competition has no data for is left out', !C.presetsFor('p', sparseCat(), open).some(p => p.id === 'three') && C.presetsFor('p', sparseCat(), open).some(p => p.id === 'score-eff'));
  ok('a preset lists only columns of the catalogue', C.PRESET_DEFS.filter(p => p.ent === 'p').every(p => [p.a.x, p.a.y, p.a.y2, p.b && p.b.x, p.b && p.b.y].filter(Boolean).every(k => pcat.byKey.has(k))) &&
    C.PRESET_DEFS.filter(p => p.ent === 't').every(p => [p.a.x, p.a.y, p.a.y2, p.b && p.b.x, p.b && p.b.y].filter(Boolean).every(k => tcat.byKey.has(k))), C.PRESET_DEFS.filter(p => p.ent === 'p').map(p => [p.a.x, p.a.y]).filter(a => !a.every(k => pcat.byKey.has(k))));
  const p0 = C.PRESET_DEFS.find(p => p.id === 'p-overlay'), st = C.presetState(p0);
  ok('a preset is a state, and is recognised as that preset', st.a.y2 === 'ast_pct' && st.a.ym === 'z' && C.matchPreset(st, C.presetsFor('p', pcat, open)) === 'p-overlay' && C.matchPreset(C.defaultState('p'), C.presetsFor('p', pcat, open)) === 'score-eff');
  ok('the dual preset sets the second chart', C.presetState(C.PRESET_DEFS.find(p => p.id === 'p-dual')).b.x === 'apg');
}
console.log('-- a club\'s per-game columns are derived as the table does');
{
  const r = C.deriveRow('team', { gp: 10, fgm: 300, fga: 700, p3m: 90, p3a: 250, ftm: 120, fta: 160, poss: 800, paint: 200, fast: 50, second_chance: 40, pts_off_to: 60, bench: 100 });
  ok('per-game forms of the totals', near(r.fgm_pg, 30) && near(r.fga_pg, 70) && near(r.p3a_pg, 25) && near(r.fta_pg, 16) && near(r.poss_pg, 80) && near(r.second_pg, 4) && near(r.bench_pg, 10), r);
  ok('the shot-zone expectation needs the zone read', r.pred_efg === null && C.deriveRow('team', { gp: 4, z_all_att: 100, z_rim_att: 40, z_paint_att: 10, z_mid_att: 10, z_c3_att: 10, z_w3_att: 15, z_t3_att: 15, z_three_att: 40, z_all_madeG: 12, z_three_madeG: 4 }).pred_efg > 0);
  ok('the row given is not changed', (() => { const o = { gp: 2, fgm: 10 }; C.deriveRow('team', o); return !('fgm_pg' in o); })());
  ok('a player gets possessions per game', near(C.deriveRow('player', { gp: 4, poss: 200 }).poss_pg, 50));
}

/* ============================================================================================ one chart === */
console.log('-- one chart\'s numbers');
{
  const cat = C.buildCatalogue('player', TB.PLAYER_COLS, TB.PRESETS.player, rowsFor(TB.PLAYER_COLS, 5), null, {});
  const mk = (id, ppg, ts, apg) => ({ id, get: k => ({ ppg, ts, apg })[k] });
  const pool = [mk('a', 10, 50, 2), mk('b', 20, 60, 4), mk('c', 30, null, 6), mk('d', 40, 70, null), mk('e', 0, 40, 1)];
  const D = C.computeChart(pool, cat, { x: 'ppg', y: 'ts', xm: 'a', ym: 'a', y2: '', xl: 0, yl: 0 }, { trend: true });
  ok('points are the rows with both numbers; the rest are counted', D.pts.length === 4 && D.noValue === 1 && D.n === 5, [D.pts.length, D.noValue]);
  ok('a trend is drawn with its r', D.trend.length === 1 && D.trend[0].r > 0.9, D.trend);
  const Z = C.computeChart(pool, cat, { x: 'ppg', y: 'ts', xm: 'z', ym: 'd', y2: '', xl: 0, yl: 0 }, {});
  ok('modes are per axis: x as z-score over ALL the x values, y as a difference over all the y values', near(Z.tx.mean, 20) && near(Z.ty.mean, 55) && near(Z.pts[0].y, -5) && near(Z.pts[0].x, (10 - 20) / Z.tx.sd), [Z.tx.mean, Z.ty.mean, Z.pts[0]]);
  const O = C.computeChart(pool, cat, { x: 'ppg', y: 'ts', xm: 'a', ym: 'a', y2: 'apg', xl: 0, yl: 0 }, { trend: true });
  ok('an overlay reads both y statistics as z-scores and needs both', O.overlay && O.pts.length === 3 && O.pts.every(p => isFinite(p.y) && isFinite(p.y2)) && O.trend.length === 2 && O.ym === 'z', [O.pts.length, O.ym]);
  ok('an overlay\'s two series share one scale (both are z-scores)', (() => { const mean = a => a.reduce((s, v) => s + v, 0) / a.length; return Math.abs(mean(O.ty.out.filter(x => x != null))) < 1e-9 && Math.abs(mean(O.ty2.out.filter(x => x != null))) < 1e-9; })());
  const L = C.computeChart([mk('a', 10, 50), mk('b', 0, 60), mk('c', 100, 70), mk('d', -5, 40)], cat, { x: 'ppg', y: 'ts', xm: 'a', ym: 'a', y2: '', xl: 1, yl: 0 }, {});
  ok('a log axis drops what is not above zero, and says how many', L.xlog && L.pts.length === 2 && L.logDropped === 2, [L.pts.length, L.logDropped]);
  ok('log needs the plain values: it is ignored in another mode', !C.computeChart(pool, cat, { x: 'ppg', y: 'ts', xm: 'z', ym: 'a', y2: '', xl: 1, yl: 0 }, {}).xlog);
}
console.log('-- ranges, ticks, formats, sizes');
{
  const r = C.axisRange([1, 5, 9], 'a', false);
  ok('an axis has room round the data', r[0] < 1 && r[1] > 9);
  ok('delta, % and z always take in the origin', C.axisRange([2, 4], 'd', false)[0] <= 0 && C.axisRange([-4, -2], 'z', false)[1] >= 0 && C.axisRange([2, 4], 'p', false)[0] <= 0);
  ok('percentiles take in 0 to 100 with a little room, so a point on the edge is not cut in half', (() => { const q = C.axisRange([12, 40], 'r', false); return q[0] < 0 && q[0] > -10 && q[1] > 100 && q[1] < 110; })());
  ok('a log axis stays positive', C.axisRange([1, 1000], 'a', true)[0] > 0);
  ok('one value still has a range', (() => { const q = C.axisRange([5, 5], 'a', false); return q[1] > q[0]; })());
  const t = C.niceTicks(0, 100, 5);
  ok('nice ticks: 0, 20, ... 100', t.ticks.join() === '0,20,40,60,80,100' && t.step === 20, t);
  ok('ticks are clean numbers, few, and inside the range', (() => { let bad = 0; for (let i = 0; i < 100; i++) { const lo = rnd() * 50 - 25, hi = lo + 0.1 + rnd() * 200; const q = C.niceTicks(lo, hi, 6); if (q.ticks.length < 2 || q.ticks.length > 14 || q.ticks.some(v => v < lo - 1e-9 || v > hi + 1e-9)) bad++; } return bad === 0; })());
  ok('log ticks are 1-2-5 in each decade', C.logTicks(1, 100).ticks.join() === '1,2,5,10,20,50,100', C.logTicks(1, 100).ticks);
  ok('decimals for a tick follow its step', C.tickDp(20, 1) === 0 && C.tickDp(0.5, 1) === 1 && C.tickDp(0.05, 1) === 2);
  ok('values are printed for their mode', C.fmtMode(3.14159, 'a', 1) === '3.1' && C.fmtMode(3.14159, 'd', 1) === '+3.1' && C.fmtMode(-3.1, 'd', 1) === '-3.1' && C.fmtMode(12.34, 'p', 1) === '+12.3%' && C.fmtMode(1.234, 'z', 1) === '+1.23' && C.fmtMode(87.4, 'r', 1) === '87' && C.fmtMode(null, 'a', 1) === '—' && C.fmtMode(4, 'a', 1, true) === '+4.0');
  const sc = C.sizeScale(Array.from({ length: 60 }, (_, i) => i + 1).concat([5000]));
  ok('a size scale is 0..1 and one giant does not flatten the rest', sc(1) === 0 && sc(5000) === 1 && sc(30) > 0.3 && sc(30) < 0.7 && sc(null) === 0.5, [sc(1), sc(30), sc(5000)]);
  ok('the both-better quarter: high-is-better both -> top right; lower-is-better y -> bottom right; z and percentile are already turned', C.goodQuadrant({ low: false }, { low: false }, 'a', 'a') === 1 && C.goodQuadrant({ low: false }, { low: true }, 'a', 'a') === 3 && C.goodQuadrant({ low: true }, { low: true }, 'a', 'a') === 2 && C.goodQuadrant({ low: true }, { low: true }, 'z', 'r') === 1);
  ok('axis titles say the mode', /league avg/.test(C.axisTitleText({ title: 'Points' }, 'd')) && /z-score/.test(C.axisTitleText({ title: 'X' }, 'z')) && /flipped/.test(C.axisTitleText({ title: 'X', low: true }, 'r')) && C.axisTitleText({ title: 'Points' }, 'a') === 'Points');
}
console.log('-- colour: a club\'s colour as a mark');
{
  ok('a kit that is nearly the ground\'s colour is moved off it', C.contrast(C.parseHex(C.markColour('#191919', '#04100b')), C.parseHex('#04100b')) >= 2.6 && C.contrast(C.parseHex(C.markColour('#f8f8f0', '#f3faf6')), C.parseHex('#f3faf6')) >= 2.6);
  ok('a colour that already stands off the ground is left exactly as it is', C.markColour('#d61f26', '#f3faf6') === '#d61f26' && C.markColour('#EEAA00', '#04100b') === '#eeaa00');
  ok('short hex works and rubbish gives nothing', C.markColour('#fff', '#04100b') === '#ffffff' && C.markColour('red', '#04100b') === null && C.markColour(null, '#fff') === null);
  ok('initials are white on a dark disc and black on a light one', C.inkOn('#191919') === '#ffffff' && C.inkOn('#ffe44d') === '#0b0b0b');
}

/* ============================================================================================ names === */
console.log('-- names never overlap (random layouts, statpop.js\'s placer and the built-in one)');
{
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const run = (placer, label, dense) => {
    let bad = 0, placed = 0, trials = 250, sideBad = 0;
    for (let t = 0; t < trials; t++) {
      const W = 220 + Math.floor(rnd() * 500), H = 200 + Math.floor(rnd() * 260), n = 5 + Math.floor(rnd() * (dense ? 160 : 30));
      const items = [];
      const cx = rnd() * W, cy = rnd() * H;
      for (let i = 0; i < n; i++) items.push({ id: 'p' + i, x: i % 3 ? cx + (rnd() - 0.5) * 60 : rnd() * W, y: i % 3 ? cy + (rnd() - 0.5) * 60 : rnd() * H, r: 4 + Math.floor(rnd() * 8), w: 24 + Math.floor(rnd() * 70), h: 14, must: i < 2, text: 't' });
      // keep-out markers as the chart offers them
      items.push({ id: '~k0', x: 20, y: 10, r: 8, w: 0, h: 0, must: true }, { id: '~k1', x: W - 30, y: H - 10, r: 8, w: 0, h: 0, must: true });
      const max = 4 + Math.floor(rnd() * 12);
      const out = C.placeNames(items, { width: W, height: H, gap: 3, max }, placer).filter(o => o.id[0] !== '~');
      placed += out.length;
      const byId = new Map(items.map(i => [i.id, i]));
      const markers = items.map(p => ({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r }));
      if (out.filter(o => !byId.get(o.id).must).length > max) bad++;
      for (let i = 0; i < out.length; i++) {
        const b = out[i].box;
        if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) bad++;
        if (markers.some(m => hit(b, m))) bad++;
        for (let j = i + 1; j < out.length; j++) if (hit(b, out[j].box)) bad++;
        const want = { r: 'start', tr: 'start', br: 'start', l: 'end', tl: 'end', bl: 'end', t: 'middle', b: 'middle' }[out[i].side];
        if (out[i].anchor !== want) sideBad++;
      }
    }
    ok(label + ': no overlaps, no escapes, nothing over a marker, the cap held (' + trials + ' layouts, ' + placed + ' labels)', bad === 0, bad);
    ok(label + ': the text anchor always matches the side (r start, l end, t/b middle)', sideBad === 0, sideBad);
  };
  run(SP.placeLabels, 'statpop.js placeLabels', false);
  run(C.basicPlaceLabels, 'the built-in placer', false);
  run(SP.placeLabels, 'every name, a crowd', true);
  ok('the anchors: r and its diagonals start, l and its diagonals end, t and b centre', ['r', 'tr', 'br'].every(s => C.anchorFor(s) === 'start') && ['l', 'tl', 'bl'].every(s => C.anchorFor(s) === 'end') && ['t', 'b'].every(s => C.anchorFor(s) === 'middle'));
  const cheat = () => [{ id: 'a', box: { x: 0, y: 0, w: 50, h: 14 }, side: 'r' }, { id: 'b', box: { x: 20, y: 5, w: 50, h: 14 }, side: 'r' }, { id: 'c', box: { x: -5, y: 40, w: 20, h: 14 }, side: 'l' }, { id: 'd', box: { x: 200, y: 200, w: 40, h: 14 }, side: 't' }];
  const items = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: 100 + i * 5, y: 100, r: 5, w: 40, h: 14 }));
  ok('whatever a placer answers, an overlapping, escaping or marker-covering label is dropped', C.placeNames(items, { width: 220, height: 210 }, cheat).map(o => o.id).join() === 'a', C.placeNames(items, { width: 220, height: 210 }, cheat).map(o => o.id));
}
console.log('-- the arrow keys find the next point');
{
  const P = (id, px, py) => ({ id, px, py });
  const c = P('c', 100, 100), pts = [c, P('r1', 140, 102), P('r2', 200, 100), P('up', 101, 60), P('dn', 98, 150), P('l', 30, 95), P('far', 400, 400)];
  ok('right finds the nearest to the right, not the far one', C.neighbourInDirection(pts, c, 'right').id === 'r1');
  ok('left, up and down find their neighbours', C.neighbourInDirection(pts, c, 'left').id === 'l' && C.neighbourInDirection(pts, c, 'up').id === 'up' && C.neighbourInDirection(pts, c, 'down').id === 'dn');
  ok('the edge of the chart has no neighbour beyond it', C.neighbourInDirection([c, P('x', 90, 100)], c, 'right') === null);
  ok('a point off to the side is reached when nothing is in the cone', C.neighbourInDirection([c, P('diag', 105, 300)], c, 'down').id === 'diag');
  let bad = 0;
  for (let t = 0; t < 100; t++) {
    const pp = Array.from({ length: 30 }, (_, i) => P('n' + i, rnd() * 400, rnd() * 300));
    const cur = pp[0], seen = new Set([cur.id]);
    let x = cur;
    for (let s = 0; s < 40; s++) { const nx = C.neighbourInDirection(pp, x, ['left', 'right', 'up', 'down'][s % 4]); if (!nx) continue; if (nx === x) bad++; x = nx; seen.add(x.id); }
  }
  ok('walking the keys never stays on the same point', bad === 0);
}

/* ============================================================================================ export === */
console.log('-- export geometry: sizes, layout, wrapping, file names');
{
  const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01 && r.w > 0 && r.h > 0;
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const sizes = { '1200x675': [1200, 675], '1080x1080': [1080, 1080], '1080x1350': [1080, 1350] };
  let bad = 0, n = 0;
  Object.keys(sizes).forEach(k => {
    [1, 2].forEach(charts => [0, 1, 2, 3].forEach(tl => [0, 1, 2].forEach(sl => [0, 2].forEach(fl => [false, true].forEach(credit => {
      const L = C.exportLayout({ size: k, charts, titleLines: tl, subLines: sl, footLines: fl, credit });
      n++;
      if (L.w !== sizes[k][0] || L.h !== sizes[k][1]) bad++;
      if (L.charts.length !== charts) bad++;
      L.charts.forEach(r => { if (!inside(r, L.w, L.h)) bad++; });
      if (charts === 2 && hit(L.charts[0], L.charts[1])) bad++;
      const top = Math.min.apply(null, L.charts.map(r => r.y)), bot = Math.max.apply(null, L.charts.map(r => r.y + r.h));
      if (top < L.title.y + tl * L.title.lh - 0.5) bad++;                                       // the charts start below the title lines
      if (sl && top < L.sub.y + sl * L.sub.lh - 0.5) bad++;
      if (fl && L.foot.y < bot - 0.01) bad++;                                                    // the footnote is under the charts
      if (fl && L.foot.y + fl * L.foot.lh > (credit ? L.credit.y : L.h) + 0.5) bad++;
      if (credit && (L.credit.y + L.credit.h !== L.h || bot > L.credit.y + 0.5)) bad++;          // the credit bar is the bottom edge
      if (charts === 2 && L.side !== (L.w / L.h >= 1.25)) bad++;
      if (charts === 2 && L.side && L.charts[0].y !== L.charts[1].y) bad++;
      if (charts === 2 && !L.side && L.charts[0].x !== L.charts[1].x) bad++;
      if (L.charts.some(r => r.h < 100 || r.w < 200)) bad++;
    })))));
  });
  ok('every fixed size: exact dimensions, every chart inside and clear of the texts and of each other (' + n + ' layouts)', bad === 0, bad);
  ok('two charts sit side by side in the wide size and stacked in the square and portrait ones', C.exportLayout({ size: '1200x675', charts: 2 }).side === true && C.exportLayout({ size: '1080x1080', charts: 2 }).side === false && C.exportLayout({ size: '1080x1350', charts: 2 }).side === false);
  const sh = C.exportLayout({ size: 'shown', charts: 1, shown: { w: 700, chartH: [400] }, titleLines: 1, subLines: 1, footLines: 0, credit: true });
  ok('"as shown" takes the page\'s width and the chart\'s own height', sh.w === 700 && sh.charts[0].h === 400 && sh.charts[0].w === 700 - 2 * sh.pad && sh.h > 400 + 60, [sh.w, sh.h, sh.charts[0]]);
  const sh2 = C.exportLayout({ size: 'shown', charts: 2, shown: { w: 900, chartH: [380, 400], side: true }, titleLines: 2, credit: true });
  ok('"as shown" with two charts side by side keeps them level; stacked, one under the other', sh2.charts[0].y === sh2.charts[1].y && sh2.charts[0].h === 400 && C.exportLayout({ size: 'shown', charts: 2, shown: { w: 500, chartH: [380, 400], side: false } }).charts[1].y > 380);
  const px = C.exportPixels(C.exportLayout({ size: '1200x675', charts: 1 }), 2);
  ok('PNG pixels are the size times the scale: 1x, 2x, 3x', px.join() === '2400,1350' && C.exportPixels(C.exportLayout({ size: '1080x1350', charts: 1 }), 3).join() === '3240,4050' && C.exportPixels(C.exportLayout({ size: '1080x1080', charts: 1 }), 1).join() === '1080,1080');
  ok('the size choices are the ones promised', Object.keys(C.EXPORT_SIZES).join() === 'shown,1200x675,1080x1080,1080x1350');
  const meas = s => s.length * 7;
  ok('wrapping: words break on spaces within the width', C.wrapLines('one two three four five six', 100, meas, 5).every(l => meas(l) <= 100) && C.wrapLines('one two three four five six', 100, meas, 5).join(' ') === 'one two three four five six');
  ok('wrapping: a word wider than the line is cut', C.wrapLines('abcdefghijklmnopqrstuvwxyz', 70, meas, 5).every(l => meas(l) <= 70) && C.wrapLines('abcdefghijklmnopqrstuvwxyz', 70, meas, 5).join('') === 'abcdefghijklmnopqrstuvwxyz');
  ok('wrapping: past the line limit the last line ends in an ellipsis and still fits', (() => { const l = C.wrapLines('aaaa bbbb cccc dddd eeee ffff gggg hhhh', 60, meas, 2); return l.length === 2 && /…$/.test(l[1]) && l.every(x => meas(x) <= 60); })());
  ok('wrapping: nothing in, nothing out', C.wrapLines('', 100, meas, 3).length === 0 && C.wrapLines('   ', 100, meas, 3).length === 0);
  ok('file names are plain ascii: league, season, title', C.exportFileName('NBL', '2026-27', 'Points per game vs TS% – Élan!', 'png') === 'nbl-2026-27-points-per-game-vs-ts-elan.png' && C.exportFileName('', '', '', 'svg') === 'chart.svg' && C.exportFileName('a', 'b', 'x'.repeat(300), 'png').length < 100);
}

/* the text boxes debounce their typing, each with its own timer: one shared timer let a quick edit in the next box cancel the last */
ok('each text box keeps its own typing timer', (() => { const m = /const field = \(label, k, auto, cap\) => \{\s*let t;/.test(src); return m; })());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
