/* ============================================================================
   THE TRANSFER MATRIX (epinoia/scouting/transfer/, 2026-10-15), held:

     1. the engine (engine.js) gives the ORIGINAL standalone app's numbers, digit for digit, on a made-up sample
        (fixtures/transfer/sample.mjs; the app's own answers in fixtures/transfer/orig.json): the network scale, the
        route evidence, the grades, the league averages, the Spanish scale, the League Index, the vote ledger, every
        translation the app drew and its player search - at its defaults, robust off, talent on, a season window and
        with leagues left out (the anchor among them);
     2. the store (engine.encodeStore, 'TMS2') round-trips the sample, and carries no address, source id or site name;
     3. the rules: the blend, a route nobody took, the Spanish scale's reach, the range a projection is held in,
        stabilise, how sure, robust weighting and the talent curve;
     4. tools/build-transfer.mjs: the scale in the shape the other pages read, both files gzipped and named by their
        hash, never written where the website is published from; and, when transfermatrix/build/ holds a real build,
        that build (skipped with a note where it does not: the data is never committed);
     5. NO PUBLIC DATA FILE: nothing of it under epinoia/, robots.txt has nothing to hide, the build folder is ignored;
     6. the page to the standard, members only (CATALOGUE.locks.transferMatrix; its data through transferdata.js), its
        views, the rail's row, the head, the sitemap and the old address.

     TZ=UTC node supabase/tests/transfer-matrix.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sampleCSVs } from './fixtures/transfer/sample.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const has = (...p) => fs.existsSync(path.join(ROOT, ...p));
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 600))); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const E = require(path.join(ROOT, 'epinoia', 'scouting', 'transfer', 'engine.js'));
const P = require(path.join(ROOT, 'epinoia', 'scouting', 'transfer', 'page.js'));
const B = await import('../../tools/build-transfer.mjs');
const FX = JSON.parse(rd('supabase', 'tests', 'fixtures', 'transfer', 'orig.json'));
const FNV = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
/* the names of other statistics sites, which no shipped file may carry (as profile-compare.test.mjs and similar.test.mjs) */
const SITES = /basketball-?reference|bbref|kenpom|torvik|cleaning ?the ?glass|nba\.com|realgm|eurobasket|sports-reference/i;

/* ======================================================================= 1. the original app's numbers === */
console.log('the engine against the original app, on the sample');
const RAW = E.ingestCSV(sampleCSVs().files);
ok('the sample reads as the app read it: 1,058 stints, two files merged, one archive identity matched',
   RAW.stints.length === 1058 && RAW.info.files === 2 && RAW.info.matched === 1 && RAW.info.dupes === 33, RAW.info);

/* the original's extraction (supabase/tests/fixtures/transfer: orig.json), from the engine */
const fmtSign = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
const fs2 = v => (v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2));
const LVL = { same: '—', nodirect: 'NO DIRECT DATA', notconnected: 'NOT CONNECTED', spain: 'SPAIN SCALE', high: 'HIGH SIGNAL', moderate: 'MODERATE SIGNAL', sparse: 'SPARSE SIGNAL', model: 'MODEL EXTRAPOLATION' };
function extract(R, sc, cfg) {
  const ex = sc.excluded === 'NCAA' ? R.allLeagues.filter(n => n.toUpperCase().includes('NCAA')) : sc.excluded.slice();
  const o = { robust: sc.robust, talent: sc.talent, excluded: ex };
  const d = E.deriveD(R, sc.lo, sc.hi, o), L = d.leagues;
  const byName = arr => Object.fromEntries(L.map((nm, i) => [nm, arr[i]]));
  const pairs = {};
  for (const key of Object.keys(d.pairs)) { const [i, j] = key.split('>').map(Number); pairs[L[i] + '>' + L[j]] = d.pairs[key]; }
  const players = d.players.map(p => [p[0], p[1], L[p[2]], p[3], p[4], p[5]].concat(p.slice(6, 15)));
  const ghosts = d.ghosts.map(g => [L[g[0]], L[g[1]]].concat(g.slice(2)));
  const out = { id: sc.id, excluded: ex.slice().sort(), d,
    D: { leagues: L, anchor: d.anchor, spainAnchor: d.spainAnchor, nTransfers: d.nTransfers, nPlayers: d.players.length, nGhosts: d.ghosts.length,
         unlinked: d.unlinked, net: byName(d.net), strength: byName(d.strength), means: byName(d.means), spain: d.spain ? byName(d.spain) : null, pairs,
         playersSig: FNV(JSON.stringify(players)), ghostsSig: FNV(JSON.stringify(ghosts)) } };
  const cache = new Map();
  const index = ix => { const k = [ix.win, ix.lo, ix.hi, ix.m].join('|'); if (!cache.has(k)) cache.set(k, E.computeIndex(R, ix.win, ix.lo, ix.hi, ix.m, o)); return cache.get(k); };
  out.index = (sc.index || []).map(ix => { const data = index(ix);
    return { win: ix.win, lo: ix.lo, hi: ix.hi, m: ix.m, leagues: data.leagues, per: data.per.map(p => ({ y: p.y, label: p.label, n: p.n, list: p.list.map(r => [r.league, r.grade, r.rank]) })) }; });
  out.ledger = [];
  for (const Lg of (sc.ledger || [])) for (const nm of Lg.leagues) {
    const r = E.ledger(R, index(Lg), nm, o);
    out.ledger.push({ league: nm, head: r && { label: r.label, rating: fs2(r.rating), rank: r.rank, of: r.of },
      rows: r ? r.rows.map(x => [x.league, (100 * x.share).toFixed(1) + '%', String(x.records), String(x.movers), fs2(x.d1), fs2(x.d2), fs2(x.rating), fs2(x.v)]) : [] });
  }
  if (sc.translate) {
    const resolve = r => L.indexOf(r);
    const tr = [], search = [];
    for (const [fr, to] of cfg.routes) {
      const F = resolve(fr), T = resolve(to);
      if (F < 0 || T < 0) continue;
      for (const mode of cfg.modes) for (const inp of cfg.inputs) for (const stab of [false, true]) {
        const strs = E.META.map((m, k) => (inp === 'means' ? d.means[F][k].toFixed(1) : (inp[k] === null ? '' : String(inp[k]))));
        const t = E.translate(d, F, T, strs.map(s => parseFloat(s)), { mode, minutes: stab ? 300 : 700, stabilise: stab });
        const outs = t.rows.map((r, k) => { const m = E.META[k]; return r.raw === null ? '—' : r.noData ? 'NO DATA' : (m.signed ? fmtSign(r.proj) : r.proj.toFixed(m.dec)); });
        const dels = t.rows.map((r, k) => { const m = E.META[k]; if (r.raw === null || r.noData) return '—'; return (r.d >= 0 ? '+' : '') + r.d.toFixed(m.dec) + (Math.abs(r.d) < 0.05 ? '' : (r.good > 0 ? ' ▲' : ' ▼')); });
        const rt = E.routeDiff(d, F, T, 0, mode);
        const basis = mode === 'direct' ? (rt ? 'BASIS: 100% direct route transfers — no model' : 'BASIS: NONE — zero transfers on this route')
          : mode === 'spain' ? (rt ? 'BASIS: in-app spain scale — graph solve anchored at ' + (d.spainAnchor || 'ACB') + ' (route transfers ignored)' : 'BASIS: NONE — league not connected to the spanish pyramid in this window')
          : 'BLEND: ' + (rt.w * 100).toFixed(0) + '% empirical / ' + (100 - rt.w * 100).toFixed(0) + '% network scale';
        const conf = t.same ? 'ROUTE: IDENTITY — pick two different leagues to translate.'
          : 'ROUTE SAMPLES: ' + t.n + ' ' + (sc.robust ? 'unique movers' : 'transfers') + ' (both directions' + (sc.talent ? ', talent-adjusted' : '') + ')' + basis + 'CONFIDENCE: ' + LVL[t.level];
        let g = [], note = '';
        if (F === T) note = '// SELECT A ROUTE TO PULL TRANSIT LOGS';
        else {
          const gh = E.ghostsFor(d, F, T, t.bpmIn);
          if (!gh.rows.length) {
            const nt = gh.reverse ? ' — projection uses ' + gh.reverse + ' reverse-route transfers' + (mode === 'blend' ? ' + network model' : '')
              : mode === 'direct' ? ' — no transfers either direction, DIRECT projection unavailable' : ' — projection is model-only';
            note = '// NO FORWARD TRANSIT LOGS ON THIS ROUTE' + (mode === 'spain' ? ' (SPAIN SCALE mode ignores them anyway)' : nt);
          } else {
            g = gh.rows.map(x => { const dd = x[9] - x[8]; return [x[2], x[3] + ' → ' + x[4], x[5], x[6] + ' → ' + x[7], fmtSign(x[8]) + ' → ' + fmtSign(x[9]) + ' (' + (dd >= 0 ? '+' : '') + dd.toFixed(1) + ')'].join('|'); });
            if (gh.rows.length > 8) note = '// SHOWING ALL ' + gh.rows.length + ' TRANSFERS ON THIS ROUTE▲ SHOW TOP 8';
          }
        }
        tr.push({ F: L[F], T: L[T], mode, stab, inputs: strs, out: outs, del: dels, hero: t.bpmOut === null ? '—' : fmtSign(t.bpmOut), conf,
          gap: t.same ? 'SAME GRID' : (t.climbing ? 'CLIMBING' : 'DESCENDING') + ' ' + Math.abs(t.gap).toFixed(1) + ' BPM',
          ghostsN: g.length, ghostsSig: FNV(JSON.stringify(g)), ghostNote: note });
      }
      for (const q of cfg.search) {
        const ids = E.searchPlayers(d, F, q, 14);
        search.push({ F: L[F], q, rows: ids.length ? ids.map(i => { const p = d.players[i]; return [p[0], p[1] + ' · ' + p[3] + ' · ' + p[4] + ' GP · ' + p[5] + ' MIN', 'BPM ' + (p[6] === null ? '?' : fmtSign(p[6]))]; })
          : [['', 'NO MATCH IN THIS LEAGUE\'S FEED', '']] });
      }
    }
    out.translateSig = FNV(JSON.stringify(tr)); out.translateN = tr.length; out.translateHead = tr.slice(0, 4);
    out.searchSig = FNV(JSON.stringify(search)); out.searchN = search.length;
  }
  return out;
}
const headOf = h => { const m = /· (\d{4}-\d{4}) · [\s\S]*→ ([+\-−]?\d+\.\d+) vs ACB \(rank (\d+)\/(\d+)\)/.exec(h || ''); return m ? { label: m[1], rating: m[2].replace('−', '-'), rank: +m[3], of: +m[4] } : null; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const runs = {};
for (const sc of FX.cfg.scenarios) {
  const want = FX.runs[sc.id], got = runs[sc.id] = extract(RAW, sc, FX.cfg);
  const tag = sc.id + ': ';
  ok(tag + 'the leagues, strongest first, the anchors, the moves and the player-seasons', same(got.excluded, want.excluded) && same(got.D.leagues, want.D.leagues) &&
     ['anchor', 'spainAnchor', 'nTransfers', 'nPlayers', 'nGhosts'].every(k => got.D[k] === want.D[k]) && same(got.D.unlinked, want.D.unlinked),
     [got.D.leagues, want.D.leagues, got.D.anchor, got.D.nTransfers, want.D.nTransfers]);
  for (const k of ['net', 'strength', 'means', 'spain', 'pairs']) ok(tag + k + ' to the digit', same(got.D[k], want.D[k]), [k, got.D[k], want.D[k]]);
  ok(tag + 'every player-season and every move listed, as the app listed them', got.D.playersSig === want.D.playersSig && got.D.ghostsSig === want.D.ghostsSig);
  ok(tag + 'the League Index (' + (sc.index || []).length + ' measures and windows) to the digit', same(got.index, want.index));
  if ((sc.ledger || []).length) ok(tag + 'the vote ledgers, row for row', got.ledger.every((l, i) => same(l.rows, want.ledger[i].rows) && same(l.head, headOf(want.ledger[i].head))),
     got.ledger.map((l, i) => [l.head, headOf(want.ledger[i].head)]));
  if (sc.translate) {
    ok(tag + 'every translation the app drew (' + want.translateN + ': routes x modes x inputs x stabilise), its words and its examples', got.translateSig === want.translateSig && got.translateN === want.translateN,
       [got.translateHead[0], want.translateHead[0]]);
    ok(tag + 'the player search', got.searchSig === want.searchSig && got.searchN === want.searchN);
  }
}
ok('the sample has what the rules below need: an unlinked league, the anchor left out, a league outside the Spanish scale',
   runs.default.D.unlinked.includes('Island League') && runs.exclude_acb.D.anchor !== 'Spanish ACB' && runs.default.d.spain[runs.default.d.leagues.indexOf('Island League')] === null);

/* ======================================================================= 2. the store === */
console.log('\nthe store (TMS2, the members\' file)');
const BIN = E.encodeStore(RAW, { built: '2026-10-15' });
const HEAD = B.storeHeader(BIN);
const R2 = E.decodeStore(BIN);
ok('binary, its own magic and layout: TMS2, layout ' + E.STORE_V + ', the build date in its header', String.fromCharCode(...BIN.subarray(0, 4)) === 'TMS2' && E.STORE_V === 2 &&
   JSON.parse(HEAD).v === 2 && JSON.parse(HEAD).built === '2026-10-15' && R2.info.built === '2026-10-15');
ok('it round-trips: every stint, in order, with its season, league, name, clubs, games and minutes',
   R2.stints.length === RAW.stints.length && R2.stints.every((s, i) => { const t = RAW.stints[i]; return s.season === t.season && s.league === t.league && s.name === t.name && s.teams === t.teams && s.GP === t.GP && s.MIN === t.MIN && s.y === t.y; }));
ok('...each stat to two decimals (exact where one club, within 0.005 where a season was split)',
   R2.stints.every((s, i) => s.vals.every((v, k) => { const t = RAW.stints[i].vals[k]; return v === null ? t === null : Math.abs(v - t) <= 0.005 + 1e-9; })));
ok('...a player is a number counted from 1, the source\'s ids gone', R2.stints.every(s => Number.isInteger(s.pid) && s.pid >= 1) && !/MSL-|\/player\//.test(HEAD) &&
   R2.stints.some(s => s.pid === 1) && Math.max(...R2.stints.map(s => s.pid)) === new Set(R2.stints.map(s => s.pid)).size);
ok('...no address and no other site\'s name (its strings are all in the header)', !/[a-z]+:\/\//i.test(HEAD) && !SITES.test(HEAD) && !B.leaks(HEAD).length);
ok('...the moves the engine finds in it are the CSVs\' moves', R2.allTransfers.length === RAW.allTransfers.length && R2.allLeagues.join() === RAW.allLeagues.join());
{
  let threw = false;
  try { const bad = BIN.slice(); bad[3] = 49; E.decodeStore(bad); } catch (_) { threw = true; }
  ok('a file that is not this layout is refused, not misread', threw);
  const again = E.encodeStore(R2, { built: '2026-10-15' });
  ok('...and the store written again from what it read is the same bytes (nothing drifts build to build)', Buffer.compare(Buffer.from(again), Buffer.from(BIN)) === 0);
}
{
  const d1 = runs.default.d, d2 = E.deriveD(R2, 2020, 2025, {});
  let mx = 0;
  d1.leagues.forEach((n, i) => { const j = d2.leagues.indexOf(n); d1.net[i].forEach((v, k) => { mx = Math.max(mx, Math.abs(v - d2.net[j][k])); }); });
  ok('...and the scale from it is the CSVs\' to within a hundredth (two decimals moved by a rounding at most)', mx <= 0.0100001 && d1.nTransfers === d2.nTransfers, mx);
  ok('the lazy Spanish scale: available at once, the same numbers once asked for',
     (() => { const dl = E.deriveD(R2, 2020, 2025, { lazySpain: true }); const avail = dl.spainAvailable, before = dl.spain; dl.ensureSpain(); return avail === true && before === undefined && same(dl.spain, d2.spain); })());
}

/* ======================================================================= 3. the rules === */
console.log('\nthe rules');
{
  const d = runs.default.d, I = n => d.leagues.indexOf(n);
  const F = I('Spanish Primera FEB'), T = I('Spanish ACB');
  const pair = d.pairs[F + '>' + T], back = d.pairs[T + '>' + F];
  ok('a route counts both ways: the move back is the same evidence, its sign turned round', pair && back && pair.every((x, k) => x[1] === back[k][1] && near(x[0], -back[k][0], 0.0100001)));
  const r = E.routeDiff(d, F, T, 0, 'blend'), w = pair[0][1] / (pair[0][1] + 30);
  ok('BLEND: w = n / (n + 30) of the route, the rest the network', near(r.w, w, 1e-12) && near(r.diff, w * pair[0][0] + (1 - w) * (d.net[F][0] - d.net[T][0]), 1e-12) && r.n === pair[0][1], r);
  ok('THIS ROUTE ONLY: the route alone, and nothing where nobody moved', (() => { const x = E.routeDiff(d, F, T, 0, 'direct'); return x.diff === pair[0][0] && x.w === 1; })() &&
     E.routeDiff(d, I('Island League'), I('German BBL'), 0, 'direct') === null);
  ok('BLEND with nobody on the route: the network alone (w 0)', (() => { const x = E.routeDiff(d, I('Island League'), I('German BBL'), 0, 'blend'); return x.w === 0 && x.n === 0 && near(x.diff, d.net[I('Island League')][0] - d.net[I('German BBL')][0], 1e-12); })());
  ok('SPANISH SCALE: a league with no chain of moves to the Spanish leagues has no answer', E.routeDiff(d, I('Island League'), T, 0, 'spain') === null &&
     near(E.routeDiff(d, F, T, 0, 'spain').diff, d.spain[F][0] - d.spain[T][0], 1e-12));
  const big = E.translate(d, F, I('Euroleague'), [29.5, 99.5, 59.9, 34.9, 49.9, 69.9, 0.1, 11.9, 17.9], { mode: 'blend' });
  ok('a projection is held inside each stat\'s range', big.rows.every((x, k) => x.proj >= E.META[k].lo && x.proj <= E.META[k].hi));
  const down = E.translate(d, I('Euroleague'), I('Irish Super League'), [29.5, null, null, null, null, null, null, null, null], { mode: 'blend' });
  const up = E.translate(d, I('Irish Super League'), I('Euroleague'), [-29.5, null, null, null, null, null, null, null, null], { mode: 'blend' });
  ok('...at both ends: BPM never past +30 or -30', down.rows[0].proj === 30 && up.rows[0].proj === -30 && near(down.rows[0].d, 0.5, 1e-9), [down.rows[0], up.rows[0]]);
  const st = E.translate(d, F, T, [4, null, null, null, null, null, null, null, null], { mode: 'blend', minutes: 350, stabilise: true });
  ok('stabilise: halfway to the old league\'s average at 350 minutes, then the route', near(st.rows[0].proj, d.means[F][0] + (4 - d.means[F][0]) * 0.5 + r.diff, 1e-9) && st.rows[1].raw === null);
  const sm = E.translate(d, F, F, [3, 50, null, null, null, null, null, null, null], { mode: 'direct' });
  ok('the same league: nothing moves, and it says so', sm.same && sm.level === 'same' && sm.rows[0].proj === 3 && sm.rows[0].d === 0);
  ok('TOV% is better lower: a rise is marked worse', (() => { const x = E.translate(d, F, T, [null, null, null, null, null, null, 10, null, null], { mode: 'blend' }).rows[6]; return x.d > 0.05 ? x.good === -1 : x.d < -0.05 ? x.good === 1 : true; })());
  /* how sure: 150 / 40 / 10, on a hand-made D */
  const mk = n => ({ leagues: ['A', 'B'], net: [[1, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]], strength: [[1, 110], [0, 100]], means: [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]],
    pairs: n ? { '0>1': E.STATS.map(() => [-2, n]), '1>0': E.STATS.map(() => [2, n]) } : {}, spain: null, ghosts: [], players: [] });
  ok('how sure: 150 players high, 40 moderate, 10 little evidence, fewer the network alone; no Spanish scale, not connected',
     [[150, 'high'], [149, 'moderate'], [40, 'moderate'], [39, 'sparse'], [10, 'sparse'], [9, 'model'], [0, 'model']].every(([n, l]) => E.confidence(mk(n), 0, 1, 'blend').level === l) &&
     E.confidence(mk(0), 0, 1, 'direct').level === 'nodirect' && E.confidence(mk(50), 0, 1, 'spain').level === 'notconnected');
  /* robust: one vote per player per route, and a route's weight levels off */
  const mv = (pid, w, d) => ({ F: 'A', T: 'B', w, pid, name: 'x', diffs: E.STATS.map(() => d), v1: E.STATS.map(() => 1) });
  const dd = E.dedupTransfers([mv(1, 100, 1), mv(1, 300, 3), mv(2, 200, 5)]);
  ok('robust: a player who made the same move twice counts once, his changes minutes-weighted, his weight their mean',
     dd.length === 2 && dd[0].w === 200 && near(dd[0].diffs[0], (100 * 1 + 300 * 3) / 400, 1e-12) && dd[1].w === 200);
  const sat = E.satScale([mv(1, 75000, 1), mv(2, 25000, 1)]);
  ok('...and a route\'s total weight levels off at 25,000 minutes (1 / (1/W + 1/25,000))', near(sat[0].w + sat[1].w, 1 / (1 / 100000 + 1 / 25000), 1e-6) && near(sat[0].w / sat[1].w, 3, 1e-9));
  ok('robust weighting and the talent curve each change the answer (and the defaults are the app\'s: blend, robust on, talent off)',
     !same(runs.default.D.net, runs.robust_off.D.net) && !same(runs.default.D.net, runs.talent_on.D.net) && same(E.DEFAULTS, { mode: 'blend', robust: true, talent: false }));
  const tb = E.talentBeta(RAW.allTransfers, RAW.globalMeans).beta;
  ok('the talent curve\'s slope is held between -0.9 and 0.3', tb.length === 9 && tb.every(b => b >= -0.9 && b <= 0.3));
  ok('leagues left out are out of everything: the window\'s leagues, its moves and the index', !runs.exclude_ncaa.D.leagues.some(n => /NCAA/.test(n)) &&
     runs.exclude_ncaa.index.every(ix => ix.leagues.every(n => !/NCAA/.test(n))) && runs.exclude_ncaa.D.nTransfers < runs.default.D.nTransfers);
  ok('the anchor left out: the league with the most minutes takes its place, at 0', (() => { const x = runs.exclude_acb.d; return x.anchorFallback && x.net[x.leagues.indexOf(x.anchor)].every(v => v === 0); })());
  ok('a season window keeps its seasons only', runs.window.d.players.every(p => { const y = +p[1].split('-')[1]; return y >= 2021 && y <= 2023; }));
}

/* ======================================================================= 4. what the build tool wrote === */
console.log('\nthe build tool');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-csv-'));
  ['player_stats10.csv', 'player_stats.csv', 'player_stats2.csv', 'other.csv', 'player_stats_old.csv'].forEach(n => fs.writeFileSync(path.join(tmp, n), ''));
  ok('the tool reads the files in the old app\'s order: player_stats.csv, then by number', B.csvFiles(tmp).join() === 'player_stats.csv,player_stats2.csv,player_stats10.csv', B.csvFiles(tmp));
  fs.rmSync(tmp, { recursive: true, force: true });
}
ok('...and refuses an address, a source page path or a source id in what it writes', B.leaks('https://x.example/a').length && B.leaks('www.x.example').length && B.leaks('MSL-12').length &&
   B.leaks('"/player/someone/summary"').length && !B.leaks(HEAD).length);
{
  const S = E.scaleFile(RAW, runs.default.d, { built: '2026-10-15' });
  const txt = B.scaleText(S);
  ok('the scale file\'s text is JSON, one league and one route to a line', same(JSON.parse(txt), S) && txt.split('\n').length > Object.keys(S.leagues).length + Object.keys(S.pairs).length);
}
{
  const out = B.build(RAW, '2026-10-15');
  ok('build(): the store gzipped (level 9) unzips to the store exactly', Buffer.compare(zlib.gunzipSync(out.transfer.gz), Buffer.from(BIN)) === 0 && out.transfer.gz.length < BIN.length / 1.5);
  ok('...the scale gzipped unzips to its text, which is the scale the engine makes from the store', zlib.gunzipSync(out.tscale.gz).toString('utf8') === out.tscale.text &&
     same(JSON.parse(out.tscale.text), E.scaleFile(R2, E.deriveD(R2, R2.years[R2.years.length - 1], R2.years[0], {}), { built: '2026-10-15' })));
  ok('...each named by its hash: the first 20 hex digits of the SHA-256 of the gzipped bytes, the same for the same data',
     /^[0-9a-f]{20}$/.test(B.tokenOf(out.transfer.gz)) && B.tokenOf(out.transfer.gz) === B.tokenOf(B.build(RAW, '2026-10-15').transfer.gz) &&
     B.tokenOf(out.transfer.gz) !== B.tokenOf(B.build(RAW, '2026-10-16').transfer.gz));
  ok('the files are written to transfermatrix/build/ by default', path.relative(ROOT, B.OUT_DEFAULT).replace(/\\/g, '/') === 'transfermatrix/build' &&
     B.FILES.transfer === 'transfer.bin.gz' && B.FILES.tscale === 'tscale.json.gz');
  const site = rd('tools', 'build-site.py'), pub = JSON.parse((/PUBLIC_DIRS = (\[[^\]]*\])/.exec(site) || [])[1] || '[]');
  ok('...and never where the website is published from: every PUBLIC_DIRS folder of build-site.py, and the root, refused',
     pub.length >= 4 && pub.every(d => !B.safeOut(path.join(ROOT, d)) && !B.safeOut(path.join(ROOT, d, 'sub'))) && !B.safeOut(ROOT) &&
     B.safeOut(B.OUT_DEFAULT) && B.safeOut(path.join(os.tmpdir(), 'tm')), pub);
}
function scaleShape(S, tag) {
  const L = Object.keys(S.leagues || {});
  ok(tag + 'version, date, seasons and the settings it was made with', S.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(S.built) && Array.isArray(S.seasons) && S.seasons.length === 2 &&
     same(S.settings, { mode: 'blend', robust: true, talent: false, kBlend: 30, anchor: S.settings.anchor }) && typeof S.settings.anchor === 'string' && L.includes(S.settings.anchor), [S.version, S.built, S.settings]);
  ok(tag + 'the nine stats, and the app\'s META for each', same(S.stats, E.STATS) && S.meta.length === 9 && S.meta.every((m, k) => m.k === E.META[k].k && m.lab === E.META[k].lab &&
     m.dec === E.META[k].dec && m.lo === E.META[k].lo && m.hi === E.META[k].hi && !!m.signed === !!E.META[k].signed && !!m.inverse === !!E.META[k].inverse &&
     Object.keys(m).every(k => ['k', 'lab', 'dec', 'lo', 'hi', 'signed', 'inverse'].includes(k))));
  const num9 = a => a === null || (Array.isArray(a) && a.length === 9 && a.every(v => v === null || Number.isFinite(v)));
  ok(tag + 'each league: net and mean nine numbers (or null), strength [bpm, grade = 100 + 10 x bpm], stints, first and last season', L.length > 0 && L.every(n => {
    const x = S.leagues[n];
    return num9(x.net) && num9(x.mean) && Array.isArray(x.strength) && x.strength.length === 2 && near(x.strength[1], 100 + 10 * x.strength[0], 0.051) &&
      Number.isInteger(x.stints) && x.stints >= 0 && (x.seasons === null || (x.seasons.length === 2 && x.seasons.every(s => /^\d{4}-\d{4}$/.test(s))));
  }));
  ok(tag + 'the anchor is 0 on every stat', S.leagues[S.settings.anchor].net.every(v => v === 0));
  const P2 = Object.keys(S.pairs || {});
  ok(tag + 'each route "F>T" between two of its leagues, nine [mean shift, n] or null, and its reverse beside it', P2.length > 0 && P2.every(k => {
    const [f, t] = k.split('>'), v = S.pairs[k];
    return L.includes(f) && L.includes(t) && f !== t && Array.isArray(v) && v.length === 9 && v.every(x => x === null || (x.length === 2 && Number.isFinite(x[0]) && Number.isInteger(x[1]) && x[1] > 0)) &&
      S.pairs[t + '>' + f] && S.pairs[t + '>' + f].every((y, i) => (y === null) === (v[i] === null));
  }));
}
scaleShape(E.scaleFile(RAW, runs.default.d, { built: '2026-10-15' }), 'the sample\'s scale: ');
console.log('\nthe real build (transfermatrix/build/)');
if (has('transfermatrix', 'build', 'manifest.json')) {
  const dir = path.join(ROOT, 'transfermatrix', 'build'), man = JSON.parse(rd('transfermatrix', 'build', 'manifest.json'));
  const gzT = fs.readFileSync(path.join(dir, man.transfer.file)), gzS = fs.readFileSync(path.join(dir, man.tscale.file));
  ok('manifest.json describes both files: their hash, gzipped size and layout', B.tokenOf(gzT) === man.transfer.token && gzT.length === man.transfer.bytes && man.transfer.layout === E.STORE_V &&
     B.tokenOf(gzS) === man.tscale.token && gzS.length === man.tscale.bytes && man.tscale.layout === 1);
  ok('the player store is well under 2 MB gzipped (' + (gzT.length / 1e6).toFixed(2) + ' MB)', gzT.length < 1.9e6, gzT.length);
  const bin = new Uint8Array(zlib.gunzipSync(gzT)), S = JSON.parse(zlib.gunzipSync(gzS).toString('utf8'));
  scaleShape(S, 'the built scale: ');
  /* a club may carry a site's word or a sponsor's domain in its own name ("Atlante Eurobasket Roma", "Sigortam.net iLab
     Bakiroy"): the clubs are checked for an address (B.leaks: ://, www.), everything else for the names themselves */
  const H = JSON.parse(B.storeHeader(bin)), noClubs = JSON.stringify(Object.assign({}, H, { teams: [] }));
  ok('the store: TMS2, its header names its blocks, and nothing that is not ours to hand out: no address, no source id, no other site named (a club\'s own name aside)',
     H.v === 2 && !B.leaks(B.storeHeader(bin)).length && !SITES.test(noClubs) && !SITES.test(zlib.gunzipSync(gzS).toString('utf8')),
     [B.leaks(B.storeHeader(bin)), (noClubs.match(SITES) || [])[0]]);
  /* the scale says what the engine says on the store, by the adjust rule the other pages use */
  const R3 = E.decodeStore(bin);
  const D3 = E.deriveD(R3, R3.years[R3.years.length - 1], R3.years[0], {});
  const adjust = (F, T, k, v) => { const p = S.pairs[F + '>' + T], e = p && p[k], n = e ? e[1] : 0, w = n / (n + S.settings.kBlend);
    const diff = (e ? w * e[0] : 0) + (1 - w) * (S.leagues[F].net[k] - S.leagues[T].net[k]); return Math.min(S.meta[k].hi, Math.max(S.meta[k].lo, v + diff)); };
  let worst = 0, cases = 0;
  for (const F of ['Spanish Primera FEB', 'NBA', 'Lithuanian LKL', 'NCAA Big Ten Conference']) for (const T of ['Spanish ACB', 'Euroleague', 'G-League', 'Irish Super League']) {
    const i = D3.leagues.indexOf(F), j = D3.leagues.indexOf(T);
    if (i < 0 || j < 0 || i === j) continue;
    const ins = D3.means[i].map(v => v + 1.3);
    const t = E.translate(D3, i, j, ins, { mode: 'blend' });
    t.rows.forEach((r, k) => { worst = Math.max(worst, Math.abs(r.proj - adjust(F, T, k, ins[k]))); cases++; });
  }
  ok('the scale, by the adjust rule, gives the page\'s own projections on the store (' + cases + ' stats checked)', cases > 50 && worst < 1e-9, worst);
  ok('...and it was made at the defaults from the whole store', S.seasons[0] === R3.yearLabel.get(R3.years[R3.years.length - 1]) && S.seasons[1] === R3.yearLabel.get(R3.years[0]) &&
     Object.keys(S.leagues).length === D3.leagues.length);
} else console.log('  SKIP  no transfermatrix/build/ here (the data is never committed): node tools/build-transfer.mjs makes one');

/* ======================================================================= 5. no public data file === */
console.log('\nno public data file');
{
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const pub = walk(path.join(ROOT, 'epinoia')).map(p => path.relative(ROOT, p).replace(/\\/g, '/'));
  ok('nothing of it under epinoia/: no stints.json, no transfer-scale.json, no store or scale file of any name', !has('epinoia', 'scouting', 'transfer', 'stints.json') &&
     !has('epinoia', 'transfer-scale.json') && !pub.some(p => /stints\.json|transfer-scale|tscale|\.bin\.gz$|\.json\.gz$|TMS2/.test(p)), pub.filter(p => /stints|scale|\.gz$/.test(p)));
  ok('...the page\'s folder holds the page, its script and the engine, nothing else', fs.readdirSync(path.join(ROOT, 'epinoia', 'scouting', 'transfer')).sort().join() === 'engine.js,index.html,page.js');
  ok('robots.txt has nothing of it to hide (a rule naming a file would only point at it)', !/stints|transfer-scale|tscale/.test(rd('robots.txt')));
  ok('the build folder is never committed (.gitignore) and transfermatrix/ never published (TOP_NEVER)', /^transfermatrix\/build\/$/m.test(rd('.gitignore')) &&
     /"transfermatrix"/.test(rd('tools', 'build-site.py').match(/TOP_NEVER = \{[^}]*\}/)[0]));
}

/* ======================================================================= 6. the page === */
console.log('\nthe page');
const html = rd('epinoia', 'scouting', 'transfer', 'index.html'), pjs = rd('epinoia', 'scouting', 'transfer', 'page.js');
const css = rd('epinoia', 'kit', 'transfer.css'), ejs = rd('epinoia', 'scouting', 'transfer', 'engine.js');
ok('built to the standard: data-std, the head with its one h1 and .pg-sub', /<div class="ep-frame[^"]*" id="tm" data-std>/.test(html) &&
   /<header class="hero pg-head">[\s\S]*?<h1>Transfer matrix<\/h1>[\s\S]*?class="pg-sub"/.test(html) && (html.match(/<h1[\s>]/g) || []).length === 1);
const secs = [...html.matchAll(/<section class="sec[^"]*" id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
ok('six sections, each with a title and a short subtitle with no full stop', secs.length === 6 && secs.every(m => {
  const n = (/<p class="note">([^<]*)<\/p>/.exec(m[2]) || [])[1] || ''; return /<h2[\s>]/.test(m[2]) && n.length > 5 && n.length <= 70 && !/\.$/.test(n); }), secs.map(m => m[1]));
ok('...all six members only, in order', same(P.MEMBER, ['data', 'translate', 'movers', 'index', 'ranks', 'ledger']) &&
   secs.map(m => m[1]).join() === 'data,translate,movers,index,ranks,ledger');
ok('no "How it is worked out" section, nor anything of it (Louie, 2026-10-15)', !/id="method"|worked out<\/h2>|tmAsof|tm-method/.test(html + pjs + css));
const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
ok('the sheets in the standard\'s order, the page\'s own (transfer.css) between page.css and sectitle.css', sheets[0] === 'kit/epinoia-kit.css' && sheets[sheets.length - 1] === 'kit/legibility.css' &&
   sheets.indexOf('kit/page.css') < sheets.indexOf('kit/transfer.css') && sheets.indexOf('kit/transfer.css') < sheets.indexOf('kit/sectitle.css') && sheets.indexOf('kit/sectitle.css') < sheets.indexOf('kit/teletext.css'), sheets);
const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
ok('nav.js last; the loader, then the engine, then the page; access, memlock, vizkit and teamcolour loaded', scripts[scripts.length - 1] === 'nav.js' &&
   scripts.indexOf('access.js') < scripts.indexOf('transferdata.js') && scripts.indexOf('transferdata.js') < scripts.indexOf('engine.js') && scripts.indexOf('engine.js') < scripts.indexOf('page.js') &&
   ['access.js', 'memlock.js', 'vizkit.js', 'teamcolour.js', 'config.js'].every(s => scripts.includes(s)), scripts);
ok('a CSP with script-src \'self\', and no inline script or <style> in the page', /script-src 'self'[;"]/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')) && !/<style/.test(html));
ok('i18n.js in the head after appmode.js, naming the analysis pack', /appmode\.js[\s\S]*<script src="\.\.\/\.\.\/i18n\.js\?v=\d+" data-i18n-packs="analysis"><\/script>[\s\S]*<\/head>/.test(html));
ok('members only: the page asks for its own lock and draws memlock\'s placeholder; the data is asked for only once open',
   /const KEY = 'transferMatrix'/.test(pjs) && /\.placeholder\(\{ rows: PH_ROWS\[id\], what: WHAT, key: KEY \}\)/.test(pjs) && /if \(lockedNow\(\)\)/.test(pjs) &&
   /onChange\(\(\) => settle\(\)\)/.test(pjs));
{
  const code = pjs.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('...its data only through the loader (EpinoiaTransferData.load(\'transfer\')), decoded by the engine; no file of its own, no fetch of its own',
     /TD\.load\('transfer'/.test(code) && /RAW = E\.decodeStore\(C\)/.test(code) && !/root\.fetch\(|stints\.json|ingestCompact/.test(code) &&
     code.indexOf("TD.load('transfer'") > code.indexOf('async function fetchStore'));
  ok('...the server\'s word drawn: members -> the lock, signin -> sign in again, rate -> the wait, and a way to try again',
     /why === 'members'\) \{ state = 'locked'; drawLocked\(\)/.test(code) && /Sign in again to load the player data/.test(code) && /Too many requests just now/.test(code) &&
     /not available just now/.test(code) && /cannot open the player data/.test(code));
  const A0 = require(path.join(ROOT, 'epinoia', 'access.js'));
  ok('...and no preview of it: a signed-out reader is asked to sign in (the server hands its data to an account only)', A0.PEEK_NEVER.includes('transferMatrix') &&
     A0.peekHTML('transferMatrix') === null && A0.previewActive('transferMatrix') === false);
}
ok('its address never uses ?t=, ?l= or ?mode= (a club, a league and robots\' rule)', /set\('from', st\.from\); set\('to', st\.to\); set\('by'/.test(pjs) && !/set\('(t|l|mode)'/.test(pjs));
ok('no other site named in any of its files', ![html, pjs, css, ejs].some(s => SITES.test(s)));
/* the views, in node */
{
  const d = runs.default.d, st = { mode: 'blend', robust: true, talent: false, excluded: new Set(), lo: 2020, hi: 2025, from: 'Spanish Primera FEB', to: 'Spanish ACB', min: 700, gp: 30, stab: false,
    inputs: E.META.map(() => ''), moversAll: false, exOpen: false, idx: { m: 'bpm', lo: 2020, hi: 2025, win: 3, picks: ['Euroleague', 'Spanish ACB'], custom: true, ledger: 'German BBL', allRanks: false } };
  const F = d.leagues.indexOf(st.from), T = d.leagues.indexOf(st.to);
  const tr = E.translate(d, F, T, d.means[F], { mode: 'blend' });
  const sum = P.summaryHTML(d, F, T, tr, st);
  ok('the route: both leagues, the step, the projected BPM with a true minus, how sure', /A step up of/.test(sum) && /Projected BPM/.test(sum) && /translate="no">Spanish ACB</.test(sum) &&
     (tr.bpmOut < 0 ? sum.includes('−' + Math.abs(tr.bpmOut).toFixed(1)) : true) && /data-tone="(good|ok|warn|bad)"/.test(sum));
  ok('a stat\'s cell: projected, the change with ▲ or ▼ for better or worse', (() => { const c = P.cellText(E.META[6], { raw: 10, proj: 12, d: 2, good: -1, noData: false }); return c.out === '12.0' && c.d === '+2.0 ▼' && c.cls === 'tm-dn'; })() &&
     P.cellText(E.META[0], { raw: 1, proj: -2.25, d: -3.25, good: -1 }).out === '−2.3' && P.cellText(E.META[0], { raw: null }).out === '–');
  const data = E.computeIndex(RAW, 3, 2020, 2025, 'bpm', {});
  const ranks = P.ranksHTML(data, st, RAW);
  ok('the ranks: table.ft with the heat lozenge (--heat), a chart toggle, the ledger link and leave-out per league', /<table class="ft tm-rt"/.test(ranks) && /class="heat" style="--heat:color-mix/.test(ranks) &&
     (ranks.match(/data-act="pick"/g) || []).length === data.leagues.length && /data-act="ledger"/.test(ranks) && /data-act="exclude"/.test(ranks));
  ok('the heat follows the fulltable\'s steps', P.heatVar(95).includes('--good') && P.heatVar(50) === '' && P.heatVar(5).includes('--flare') && P.heatVar(null) === '');
  const L = E.ledger(RAW, data, 'German BBL', {});
  const led = P.ledgerHTML(data, L, st);
  ok('the ledger: one row per neighbouring league, shares summing to 100%', (led.match(/<tr><th scope="row"/g) || []).length === L.rows.length && near(L.rows.reduce((a, r) => a + r.share, 0), 1, 1e-9));
  ok('the chart: one line per league picked, dashed past the third', (() => { const s = P.chartSeries(data, Object.assign({}, st, { idx: Object.assign({}, st.idx, { picks: data.leagues.slice(0, 5) }) })); return s.length === 5 && !s[2].dash && s[3].dash && s.every(x => x.pts.length > 0); })());
  const mv = P.moversHTML(d, F, T, 0, st);
  ok('the movers: the real players, eight and then all', /<table class="ww-tbl tm-movers">/.test(mv) && (mv.match(/<tr><th scope="row"/g) || []).length <= 8 &&
     (E.ghostsFor(d, F, T, 0).rows.length <= 8 || /data-act="moversall"/.test(mv)));
  ok('...and says so plainly where nobody moved', /Pick two different leagues/.test(P.moversHTML(d, F, F, 0, st)) && /class="pg-empty"/.test(P.moversHTML(d, d.leagues.indexOf('Island League'), T, 0, st)));
  ok('names are escaped', !/<script>/.test(P.ledgerHTML({ leagues: ['<script>x</script>'], per: [], metric: 'bpm' }, null, Object.assign({}, st, { idx: Object.assign({}, st.idx, { ledger: '' }) }))));
  ok('every subtitle-like note it writes has no full stop at its end', [P.MODE_HINT.blend, P.MODE_HINT.direct, P.MODE_HINT.spain, P.measureNote('bpm'), P.measureNote('c:phys'), P.measureNote('s:6'), P.measureNote('s:3')].every(s => !/\.$/.test(s)));
}

/* ======================================================================= the rail, the lock, the head, the old address === */
console.log('\nthe rail, the lock, the head and the old address');
const nav = rd('epinoia', 'nav.js');
ok('the rail: a Scouting row "transfer matrix" to scouting/transfer/, after what wins', /const transferRow = platformRow\('[^']+', 'transfer matrix', 'scouting\/transfer\/', \/\\\/epinoia\\\/scouting\\\/transfer\\\/\//.test(nav) &&
   /scoutlist\.append\(scoutingRow, injuriesRow, winsRow, transferRow\)/.test(nav));
{
  const m = /const scoutingRow = platformRow\('[^']+', 'scouting', 'scouting\/', (\/.*?\/),/.exec(nav);
  const re = m && new Function('return ' + m[1])();
  ok('...and global scouting\'s row no longer lights on it', re && re.test('/epinoia/scouting/') && re.test('/epinoia/scouting/index.html') && !re.test('/epinoia/scouting/transfer/'));
  ok('the teletext layer takes it as a page of the standard, not as global scouting', /\[\/\^scouting\\\/\$\/, 'scouting'\]/.test(nav) && /\/\\\/epinoia\\\/\(home\|games\|scouting\|go\|membership\|reports\|setup-league\)\\\/\//.test(nav));
}
const A = require(path.join(ROOT, 'epinoia', 'access.js'));
ok('the lock: CATALOGUE.locks.transferMatrix, on What wins\' gate (analytics), with a label and where it shows', A.CATALOGUE.locks.transferMatrix &&
   A.CATALOGUE.locks.transferMatrix.gate === A.CATALOGUE.locks.model.gate && A.CATALOGUE.locks.transferMatrix.gate === 'analytics' && A.CATALOGUE.locks.transferMatrix.label === 'Transfer matrix');
ok('...open under node (fails open), as every lock is', A.featureLocked('transferMatrix') === false);
ok('...seeded for the platform console by a migration', /insert into public\.access_gates \(key, gate\)\s*values \('transferMatrix', 'analytics'\)/.test(rd('supabase', 'migrations', '0265_transfer_matrix_gate.sql')));
ok('the head: a row in tools/apply-page-heads.py, written into the page', /"scouting\/transfer\/": \("Transfer Matrix/.test(rd('tools', 'apply-page-heads.py')) &&
   /<!-- seo:head -->[\s\S]*<link rel="canonical" href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/scouting\/transfer\/">[\s\S]*<!-- \/seo:head -->/.test(html) && /<meta name="epinoia-page" content="Transfer matrix">/.test(html));
ok('the sitemap lists it', rd('epinoia', 'sitemap.xml').includes('<loc>https://prophesyscouting.co.uk/epinoia/scouting/transfer/</loc>'));
const site = rd('tools', 'build-site.py');
ok('the old address sends readers to the new page: a redirect the site build GENERATES there',
   /REDIRECTS = \{"transfermatrix\/index\.html": "\/epinoia\/scouting\/transfer\/"\}/.test(site) && /n \+= write_redirects\(out\)/.test(site)
   && /r not in REDIRECTS/.test(site));
ok('...and nothing of transfermatrix/ itself is ever published', /"transfermatrix"/.test(site.match(/TOP_NEVER = \{[^}]*\}/)[0]));
ok('the scraped player-stats files are not in the repository', !fs.existsSync(path.join(ROOT, 'transfermatrix', 'player_stats.csv'))
   && !fs.existsSync(path.join(ROOT, 'transfermatrix', 'index.html')));
ok('the build tool asks where they are (--src or EPINOIA_TRANSFER_SRC)', /EPINOIA_TRANSFER_SRC/.test(rd('tools', 'build-transfer.mjs')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
