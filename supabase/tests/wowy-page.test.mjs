/* ============================================================================
   THE WOWY / LINEUPS PAGE'S LOGIC (epinoia/wowylogic.js over epinoia/lineups.js), pure.

     node supabase/tests/wowy-page.test.mjs

   Held: the colour scale is the league's own distribution and direction-aware (a low turnover rate is green);
   small samples are labelled with thresholds the reader can move; the four pair buckets add up to the team's
   whole line; units of a size are every group inside each five; the column picker's caps and defaults by width;
   the preview gate follows CATALOGUE.wowyPreviewMax; the address round-trips; the page stays inside the site's
   contracts (page standard head, stylesheet order, no inline script, no third-party fetch, no export module).
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
globalThis.EpinoiaLineups = require(path.join(ROOT, 'epinoia/lineups.js'));
const L = globalThis.EpinoiaLineups;
const W = require(path.join(ROOT, 'epinoia/wowylogic.js'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 200) : ''}`); };

/* a tiny league of stints: players A..G, boxes chosen so the sums are easy */
const box = (pts, fga, fgm, f3m, fta, tov, or, dr) => ({ pts, fga, fgm, f3m, fta, tov, or, dr });
const st = (ids, mins, off, def) => ({ player_ids: ids, stats: { dur: mins * 60000, pf: off.pts, pa: def.pts, off, def } });
const stints = [
  st(['A', 'B', 'C', 'D', 'E'], 10, box(24, 20, 9, 2, 6, 3, 2, 8), box(18, 20, 7, 1, 4, 5, 2, 7)),
  st(['A', 'B', 'C', 'D', 'E'], 8, box(16, 16, 6, 1, 4, 4, 1, 6), box(20, 18, 8, 2, 4, 3, 3, 5)),
  st(['A', 'B', 'C', 'D', 'F'], 6, box(14, 12, 6, 1, 2, 2, 1, 4), box(10, 12, 4, 0, 3, 4, 1, 5)),
  st(['A', 'C', 'D', 'E', 'G'], 5, box(9, 10, 4, 0, 2, 3, 1, 3), box(12, 11, 5, 1, 2, 2, 1, 4)),
  st(['B', 'C', 'D', 'F', 'G'], 4, box(6, 8, 3, 0, 1, 2, 0, 3), box(11, 9, 5, 1, 2, 1, 1, 3))
];

console.log('COLS: one list, the engine\'s keys');
const line = L.filter(stints, []);
ok('every column key is a field of the engine\'s line', W.COLS.every(c => c.key in line), W.COLS.filter(c => !(c.key in line)).map(c => c.key));
ok('keys are unique', new Set(W.COLS.map(c => c.key)).size === W.COLS.length);
ok('lower-is-better stats point the right way: TOV%, DRTG, opp eFG%, opp OREB%, opp FTr',
   ['tov', 'drtg', 'defg', 'doreb', 'dftr'].every(k => W.col(k).dir === -1) && ['net', 'ortg', 'efg', 'dtov', 'oreb'].every(k => W.col(k).dir === 1));
ok('pace has no good end', W.col('pace').dir === 0);
ok('no stat the stint boxes cannot give (3P%, assists, steals, blocks) is offered', !W.COLS.some(c => /3P%|AST|STL|BLK|STEAL|BLOCK|ASSIST/i.test(c.label + ' ' + c.name)));
ok('TS% from points: pts / (2 (fga + .44 fta))', Math.abs(line.ts - 100 * line._off.pts / (2 * (line._off.fga + 0.44 * line._off.fta))) < 0.06, line.ts);
ok('pace is possessions per 48', Math.abs(line.pace - Math.round(line.poss / line.mins * 48 * 10) / 10) < 0.11);

console.log('\nscale and tone');
const sc = W.scaleOf([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
ok('percentile: the top value is above 90%, the bottom below 10%', W.percentile(sc, 100) > 0.9 && W.percentile(sc, 10) < 0.1);
ok('ties split: a value equal to all is 50%', W.percentile(W.scaleOf([5, 5, 5, 5]), 5) === 0.5);
ok('tone of the best is about +1, of the worst about -1, of the middle about 0', W.tone(sc, 100, 1) > 0.8 && W.tone(sc, 10, 1) < -0.8 && Math.abs(W.tone(sc, 55, 1)) < 0.15);
ok('DIRECTION-AWARE: the same high value is red where lower is better', W.tone(sc, 100, -1) < -0.8 && W.tone(sc, 10, -1) > 0.8);
ok('no tone for a stat with no good end, or for a spread of fewer than four', W.tone(sc, 50, 0) === null && W.tone(W.scaleOf([1, 2, 3]), 2, 1) === null);
ok('bands: worst is 1, best is 5, nothing is 0', W.band(-1) === 1 && W.band(1) === 5 && W.band(null) === 0 && W.band(0) === 3);
ok('tint: green for good, red for bad, none near the middle, at most 40%', /var\(--good\) 40%/.test(W.tint(1)) && /var\(--bad\) 40%/.test(W.tint(-1)) && W.tint(0.02) === '');
const refs = W.referenceScales([{ mins: 30, poss: 60, net: 5, tov: 10 }, { mins: 30, poss: 60, net: 6, tov: 11 }, { mins: 30, poss: 60, net: 7, tov: 12 }, { mins: 30, poss: 60, net: 8, tov: 13 }, { mins: 1, poss: 2, net: 500, tov: 0 }], ['net', 'tov', 'pace'], {});
ok('a tiny sample does not stretch the reference', refs.net.max === 8 && refs.net.n === 4, refs.net);
ok('...and a stat with no good end has no scale', refs.pace === undefined);

console.log('\nreliability, thresholds the reader moves');
ok('ok at the floor, thin at half, tiny below', W.reliability({ mins: 10, poss: 20 }) === 'ok' && W.reliability({ mins: 5, poss: 10 }) === 'thin' && W.reliability({ mins: 4.9, poss: 30 }) === 'tiny');
ok('raising the minutes turns an ok unit thin', W.reliability({ mins: 10, poss: 25 }, { minMinutes: 15 }) === 'thin');
ok('a unit without numbers is tiny', W.reliability(null) === 'tiny' && W.reliability({}) === 'tiny');
ok('thresholds are cleaned: junk falls back, negatives too, and they are capped', W.normThr('x', -3).minMinutes === 10 && W.normThr('12', '30').minPoss === 30 && W.normThr(1e9, 1e9).minMinutes === 2000);

console.log('\nunits of a size');
const fives = L.sized(stints, 5);
ok('fives: stints with the same five are summed (ABCDE: 10 + 8 min)', fives.length === 4 && fives[0].mins === 18 && fives[0].ids.join('') === 'ABCDE');
const pairs = L.sized(stints, 2);
ok('pairs: a five holds ten, so 5 stints of five give 50 pair-stints', pairs.reduce((a, u) => a + u.stints, 0) === 50);
const ab = pairs.find(u => u.ids.join('') === 'AB');
ok('a pair is every stretch the two shared, whoever the others were (A+B: 10 + 8 + 6 min)', ab && ab.mins === 24, ab && ab.mins);
ok('a size is clamped to 1..5, and a five is whole', L.sized(stints, 9)[0].ids.length === 5 && L.sized(stints, 1).length === 7);
ok('rates come from summed boxes: A+B ortg = 54 pts over .96 (48 fga + 9 tov + .44 x 12 fta - 4 or) possessions = 96.5', Math.abs(ab.ortg - 96.5) < 0.06, ab.ortg);

console.log('\nfilters, sorting');
const units = L.sized(stints, 5);
ok('with: keeps units holding every chosen player', W.filterUnits(units, { inc: ['A', 'B'] }).every(u => u.ids.includes('A') && u.ids.includes('B')));
ok('without: drops units holding any excluded player', W.filterUnits(units, { exc: ['E'] }).every(u => !u.ids.includes('E')));
ok('minutes and possessions floors apply', W.filterUnits(units, { minMinutes: 6 }).length === 2);
const gated = W.sortRows(units, 'net', 'desc', { minMinutes: 10, minPoss: 20 }, true);
ok('best/worst leaves out the small samples', gated.every(u => W.reliability(u, { minMinutes: 10, minPoss: 20 }) === 'ok') && gated.length < units.length);
ok('sort ascending reverses descending', W.sortRows(units, 'mins', 'asc')[0].mins <= W.sortRows(units, 'mins', 'asc')[1].mins && W.sortRows(units, 'mins', 'desc')[0].mins === 18);
ok('cycle: none -> with -> without -> none', (() => { let s = { inc: [], exc: [] }; s = W.cycleFilter(s.inc, s.exc, 'A'); const a = s.inc.join() === 'A'; s = W.cycleFilter(s.inc, s.exc, 'A'); const b = s.exc.join() === 'A' && !s.inc.length; s = W.cycleFilter(s.inc, s.exc, 'A'); return a && b && !s.inc.length && !s.exc.length; })());

console.log('\nwith or without');
const pb = W.pairBuckets(stints, 'A', 'B');
ok('four buckets in order both, only A, only B, neither, with the rings', pb.map(b => b.key).join() === 'both,aOnly,bOnly,neither' && pb[0].a && pb[0].b && !pb[3].a && !pb[3].b && pb[1].a && !pb[1].b);
ok('the four buckets add up to the team\'s whole minutes and possessions', Math.abs(pb.reduce((a, b) => a + b.line.mins, 0) - line.mins) < 0.2 && Math.abs(pb.reduce((a, b) => a + b.line.poss, 0) - line.poss) < 0.5);
ok('both = 24 min, only A = 5, only B = 4, neither = 0 (by hand)', pb[0].line.mins === 24 && pb[1].line.mins === 5 && pb[2].line.mins === 4 && pb[3].line.stints === 0);
const parts = W.partners(stints, 'A', 0);
ok('partners: every teammate who shared a stint, swing = both minus him-without-mate', parts.length === 6 && parts.every(p => p.swing == null || Math.abs(p.swing - (p.both.net - p.subjOnly.net)) < 0.11));
const sp = W.splitRows(line, L.filter(stints, ['A']), ['net', 'tov']);
ok('split: delta is on minus off, and good is turned by direction', sp[0].delta === Math.round((line.net - L.filter(stints, ['A']).net) * 10) / 10 && sp[1].good === sp[1].delta * -1);
const uv = W.unitVsRest(stints, ['A', 'B', 'C', 'D', 'E']);
ok('unit against the rest: their minutes add to the team\'s', Math.abs(uv.on.mins + uv.off.mins - line.mins) < 0.2);
const b5 = W.build(stints, ['A', 'B', 'C', 'D', 'E']);
ok('builder: an exact five reads as exact', b5.mode === 'exact' && b5.line.mins === 18);
const bn = W.build(stints, ['A', 'B', 'E', 'F', 'G']);
ok('builder: a five that never played falls back to the fours that did, and says so', bn.mode === 'never' || (bn.mode === 'nearest' && bn.near.every(n => n.ids.length === 4)), bn.mode);
ok('builder: three players read every stint holding all three', W.build(stints, ['A', 'C', 'D']).mode === 'containing');
ok('builder: players who never met say never', W.build(stints, ['E', 'F']).mode === 'never');
const sfive = W.startingFive([{ home_team_id: 't', away_team_id: 'u', starters: [['A', 'B', 'C', 'D', 'E'], ['V', 'W', 'X', 'Y', 'Z']] }, { home_team_id: 'u', away_team_id: 't', starters: [['V', 'W', 'X', 'Y', 'Z'], ['A', 'B', 'C', 'D', 'E']] }, { home_team_id: 't', away_team_id: 'u', starters: [['A', 'B', 'C', 'D', 'F'], []] }], 't');
ok('starting five: the most common, from the side the team was on', sfive && sfive.games === 2 && sfive.ids.join('') === 'ABCDE', sfive);

console.log('\ncolumn picker');
ok('defaults by width: wide 12, mid 8, phone 4', W.pickColumns(null, 'wide').length === 12 && W.pickColumns(null, 'mid').length === 8 && W.pickColumns(null, 'phone').length === 4 && W.pickColumns(null, true).length === 4);
ok('width classes: 400 phone, 700 mid, 1000 wide', W.sizeKind(400) === 'phone' && W.sizeKind(700) === 'mid' && W.sizeKind(1000) === 'wide');
ok('a saved choice is capped, deduped, filtered to real keys, in catalogue order', (() => { const r = W.pickColumns(['ts', 'nope', 'net', 'net', 'mins', 'efg', 'tov', 'oreb', 'ftr', 'pace', 'drtg', 'ortg'], 'phone'); return r.length === 6 && r[0] === 'mins' && r.indexOf('nope') === -1; })());
ok('toggle refuses to go over the cap and to empty the table', (() => { const full = W.pickColumns(W.COLS.map(c => c.key), 'phone'); const same = W.toggleColumn(full, 'ts', 'phone'); const one = W.toggleColumn(['net'], 'net', 'phone'); return same.length === 6 && one.join() === 'net'; })());
ok('toggle adds and removes inside the cap', W.toggleColumn(['net'], 'ts', 'wide').join() === 'net,ts'.split(',').sort((a, b) => W.COLS.findIndex(c => c.key === a) - W.COLS.findIndex(c => c.key === b)).join() && W.toggleColumn(['net', 'ts'], 'ts', 'wide').join() === 'net');
ok('search finds by label, name and group, and groups the result', W.searchColumns('turnover').some(g => g.cols.some(c => c.key === 'tov')) && W.searchColumns('').length === W.GROUPS.length && W.searchColumns('zzzz').length === 0);

console.log('\nthe gate (membership preview)');
const gm = W.gate(false, 1), gp = W.gate(true, 1), gp2 = W.gate(true, 2);
ok('a member keeps everything', gm.players === 5 && gm.rows === Infinity && gm.sizes.length === 4 && gm.pair && gm.builder && gm.matrixMax === 5);
ok('a non-member: five rows of fives, one player at a time, no pair, no builder', gp.rows === 5 && gp.sizes.join() === '5' && gp.matrixMax === 1 && !gp.pair && !gp.builder && gp.players === 1);
ok('the cap follows wowyPreviewMax: two players opens the pair, not the builder', gp2.pair && !gp2.builder && gp2.matrixMax === 2);
const access = read('epinoia/access.js');
ok('access.js still says wowyPreviewMax: 1 and the page reads it', /wowyPreviewMax:\s*1/.test(access) && /wowyPreviewMax/.test(read('epinoia/stats/wowy/wowy.js')));

console.log('\nthe address');
const rt = { v: 'pair', t: 'efes', sz: 3, sort: 'net', dir: 'asc', best: 'worst', p: 'P1', a: 'A1', b: 'B2', u: ['a', 'b', 'c'], inc: ['x'], exc: ['y', 'z'], mm: 4, mp: 9 };
const enc = W.encodeState(rt, '?l=nbl&s=2026-27');
const dec = W.decodeState(enc);
ok('round trip: every field survives and l and s are kept', JSON.stringify(dec) === JSON.stringify(Object.assign({}, W.DEFAULT_STATE, rt)) && /l=nbl/.test(enc) && /s=2026-27/.test(enc), [enc, dec]);
ok('the default view writes nothing but the league', W.encodeState(W.DEFAULT_STATE, '?l=nbl') === '?l=nbl');
ok('junk is ignored, not trusted: a bad view, size, sort and ids', (() => { const d = W.decodeState('?v=hack&sz=99&sort=__proto__&p=<script>&u=a,<b>,c&mm=abc'); return d.v === 'overview' && d.sz === 5 && d.sort === 'mins' && d.p === '' && d.u.join() === 'a,c' && d.mm === 10; })());
ok('at most five ids in a list', W.decodeState('?u=a,b,c,d,e,f,g').u.length === 5);

console.log('\nthe page keeps the site\'s contracts');
const html = read('epinoia/stats/wowy/index.html');
const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m => m[1]);
ok('legibility.css is the last stylesheet; page.css, wowy.css, sectitle.css, teletext.css in order', sheets[sheets.length - 1].endsWith('kit/legibility.css') && sheets.findIndex(s => s.endsWith('page.css')) < sheets.findIndex(s => s.endsWith('wowy.css')) && sheets.findIndex(s => s.endsWith('wowy.css')) < sheets.findIndex(s => s.endsWith('sectitle.css')) && sheets.findIndex(s => s.endsWith('teletext.css')) < sheets.length - 1, sheets);
ok('no inline script (CSP), every script external with a stamp, nav.js last', !/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>[^<]/.test(html) && [...html.matchAll(/<script src="([^"]+)"/g)].every(m => /\?v=\d+$/.test(m[1])) && [...html.matchAll(/<script src="([^"?]+)/g)].pop()[1].endsWith('nav.js'));
ok('the logic loads before the parts, the parts before the page', html.indexOf('src="../../wowylogic.js') < html.indexOf('src="wowyui.js') && html.indexOf('src="wowyui.js') < html.indexOf('src="wowy.js'));
ok('access.js loads before data.js (the gate reads first)', html.indexOf('src="../../access.js') < html.indexOf('src="../../data.js'));
const files = ['epinoia/wowylogic.js', 'epinoia/stats/wowy/wowyui.js', 'epinoia/stats/wowy/wowy.js', 'epinoia/kit/wowy.css'];
ok('no third-party fetch or host in the new files', files.every(f => !/https?:\/\/(?!hhvofgqqadtyvcjudhjx)/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))));
ok('no export module: no canvas drawing, no download', files.every(f => !/toBlob|toDataURL|\.download\s*=|createElement\('canvas'\)/.test(read(f))) && !fs.existsSync(path.join(ROOT, 'epinoia/stats/wowy/wowyexport.js')));
ok('pixel-font letter-spacing stays at or under .2em in the new stylesheet', [...read('epinoia/kit/wowy.css').matchAll(/letter-spacing:\s*([.\d]+)em/g)].every(m => parseFloat(m[1]) <= 0.2));
ok('the engine\'s old API is intact for the team page and the box score', ['filter', 'all', 'wowy', 'onOff', 'pairs', 'combo', 'matrix', 'finish', 'blank', 'add', 'poss'].every(k => typeof L[k] === 'function'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
