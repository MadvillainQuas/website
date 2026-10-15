/* ============================================================================
   A PLAYER'S RATES AS IF PLAYED IN ANOTHER LEAGUE -- epinoia/transferadjust.js, on a small scale of its own.

     1. the blend: measured moves trusted as far as their number allows (n / (n + 30)), the network for the rest
     2. the same league is no change; only the nine rates move; a rate the file cannot move is said to be
     3. figures are held inside their bounds (the file's, else the defaults)
     4. the Spanish ladder: an estimate moves with its rung's net (halves between, extrapolated past Segunda FEB), never
        with measured moves, and says it is estimated
     5. a women's league, or one the matrix cannot place, moves nothing
     6. the file's own order of rates and its kBlend are honoured
     7. members only: access.js's lock, and until access.js names the key, the premium columns' lock stands in
     8. the page's copy: the file is read once, a failure is not asked for again at once, the menu needs no file
     9. the file on disk (a fixture until the matrix's real one replaces it) has the shape this reads

     node supabase/tests/transfer-adjust.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const TA = require(path.join(ROOT, 'epinoia', 'transferadjust.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const near = (a, b, e = 0.011) => typeof a === 'number' && Math.abs(a - b) <= e;

/* ------------------------------------------------------------------ the scale --- */
const STATS = ['BPM', 'TS_pct', 'USG_pct', 'ORB_pct', 'DRB_pct', 'AST_pct', 'TOV_pct', 'STL_pct', 'BLK_pct'];
const row = (net, extra) => Object.assign({ net, mean: STATS.map(() => 10), strength: [net[0], 100 + 10 * net[0]], stints: 100, seasons: [2017, 2025] }, extra || {});
const SCALE = {
  version: 1, built: '2026-10-15', seasons: [2017, 2025],
  settings: { mode: 'blend', robust: true, talent: false, kBlend: 30, anchor: 'Spanish ACB' },
  stats: STATS,
  meta: [{ k: 'BPM', lab: 'BPM', dec: 1, lo: -30, hi: 30, signed: true }, { k: 'TS_pct', lab: 'TS%', dec: 1, lo: 0, hi: 100 },
         { k: 'USG_pct', lab: 'USG%', dec: 1, lo: 0, hi: 60 }, { k: 'ORB_pct', lab: 'ORB%', dec: 1, lo: 0, hi: 35 },
         { k: 'DRB_pct', lab: 'DRB%', dec: 1, lo: 0, hi: 50 }, { k: 'AST_pct', lab: 'AST%', dec: 1, lo: 0, hi: 70 },
         { k: 'TOV_pct', lab: 'TOV%', dec: 1, lo: 0, hi: 60, inverse: true }, { k: 'STL_pct', lab: 'STL%', dec: 1, lo: 0, hi: 12 },
         { k: 'BLK_pct', lab: 'BLK%', dec: 1, lo: 0, hi: 18 }],
  leagues: {
    'Spanish ACB':         row([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    'Spanish Primera FEB': row([-2, -2, -1, -0.2, -0.5, -1, 0.6, -0.1, -0.1]),
    'Spanish Segunda FEB': row([-4, -3.5, -2, -0.4, -1, -2, 1.2, -0.2, -0.2]),
    'Lithuanian LKL':      row([-1.5, -1, -0.8, -0.1, -0.3, -0.6, 0.4, -0.05, -0.05]),
    'Euroleague':          row([3, 2.5, 1.5, 0.3, 0.6, 1.2, -0.8, 0.15, 0.15]),
    'Kosovo FBK':          row([-5, -4, -2.5, -0.5, -1.2, -2.2, 1.4, -0.3, null])
  },
  pairs: {
    'Lithuanian LKL>Spanish ACB': [[-2.5, 30], [-1, 30], [-1, 30], [0, 30], [0, 30], [0, 30], [0.5, 30], [0, 30], [0, 30]],
    'Spanish Segunda FEB>Spanish ACB': [[-9, 300], null, null, null, null, null, null, null, null]
  }
};
const SITE = [
  { slug: 'liga-endesa', name: 'Liga Endesa', country: 'ES' }, { slug: 'primera-feb', name: 'Primera FEB', country: 'ES' },
  { slug: 'segunda-feb', name: 'Segunda FEB', country: 'ES' }, { slug: 'lkl', name: 'LKL', country: 'LT' },
  { slug: 'nkl', name: 'NKL', country: 'LT' }, { slug: 'b-league-one', name: 'B.LEAGUE One', country: 'JP' },
  { slug: 'eabl', name: 'Elite Academy Basketball League', country: 'GB' }, { slug: 'euroleague', name: 'EuroLeague', country: 'EU' },
  { slug: 'kosovo-superliga', name: 'Kosovo Superliga', country: 'XK' }, { slug: 'slb-women', name: 'Super League Basketball Women', country: 'GB', gender: 'women' },
  { slug: 'i-divisioona-b', name: 'I-divisioona B', country: 'FI' }, { slug: 'mystery', name: 'Mystery League', country: 'ZZ' }
];
const TIERS = { 'liga-endesa': [1, 'm'], 'primera-feb': [2, 'm'], 'segunda-feb': [3, 'm'], lkl: [1, 'm'], nkl: [2, 'm'],
  'b-league-one': [2, 'm'], eabl: ['y1', 'm'], euroleague: [1, 'm'], 'kosovo-superliga': [1, 'm'], 'slb-women': [1, 'w'],
  'i-divisioona-b': [3, 'm'] };
const X = TA.create(SCALE, SITE, TIERS);
const LINE = { bpm: 4.0, ts: 58.0, usg: 24.0, oreb_pct: 5.0, dreb_pct: 14.0, ast_pct: 22.0, tov_pct: 12.0, stl_pct: 1.8, blk_pct: 0.9, ppg: 17.5, gp: 30 };

console.log('\n1. the blend');
{
  const r = X.adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' });
  /* BPM: 30 moves -> w = 30/60 = 0.5; diff = 0.5 * -2.5 + 0.5 * (-1.5 - 0) = -2.0 */
  ok('LKL -> Liga Endesa, BPM: half the 30 measured moves (-2.5), half the network (-1.5): -2.0', near(r.changed.bpm, -2) && near(r.values.bpm, 2),
     JSON.stringify(r.changed));
  ok('TS%: 0.5 * -1 + 0.5 * -1 = -1.0', near(r.values.ts, 57));
  ok('TOV% (lower is better) goes up a stronger league: 0.5 * 0.5 + 0.5 * 0.4 = +0.45', near(r.changed.tov_pct, 0.45));
  ok('the basis: 30 moves, w 0.5, the blend', r.basis.n === 30 && near(r.basis.w, 0.5) && r.basis.method === 'blend' && r.ok && !r.estimated);
  const back = X.adjust({ stats: LINE, from: 'liga-endesa', to: 'lkl' });
  ok('no measured moves the other way: the network alone (+1.5 BPM), basis "network"', near(back.changed.bpm, 1.5) && back.basis.method === 'network' && back.basis.n === 0);
  const up = X.adjust({ stats: LINE, from: 'lkl', to: 'euroleague' });
  ok('LKL -> EuroLeague: the network, -4.5 BPM', near(up.changed.bpm, -4.5));
  const many = X.adjust({ stats: LINE, from: 'segunda-feb', to: 'liga-endesa' });
  ok('300 moves are trusted far more than 30: w = 300/330', near(many.basis.w, 300 / 330, 0.01) &&
     near(many.changed.bpm, (300 / 330) * -9 + (30 / 330) * -4, 0.02));
  ok('a measured pair with no figure for a rate leaves that rate to the network', near(many.changed.ts, -3.5));
}

console.log('\n2. what moves, and what does not');
{
  const same = X.adjust({ stats: LINE, from: 'lkl', to: 'lkl' });
  ok('the same league: no change, nothing marked', same.ok && same.same && Object.keys(same.changed).length === 0 && same.values.bpm === 4);
  const r = X.adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' });
  ok('only the nine rates: points a game and games are not in the answer', !('ppg' in r.values) && !('gp' in r.values) &&
     Object.keys(r.changed).sort().join() === TA.KEYS.slice().sort().join());
  ok('the line handed in is not changed', LINE.bpm === 4 && LINE.ts === 58);
  const k = X.adjust({ stats: LINE, from: 'kosovo-superliga', to: 'liga-endesa' });
  ok('a rate the file has no figure for (Kosovo BLK%) stays as played, and is said to', k.unavailable.join() === 'blk_pct' &&
     k.values.blk_pct === 0.9 && !('blk_pct' in k.changed) && 'bpm' in k.changed);
  const gaps = X.adjust({ stats: { bpm: 2, ts: null, usg: NaN }, from: 'lkl', to: 'liga-endesa' });
  ok('a rate the player has no figure for is not invented', Object.keys(gaps.values).join() === 'bpm' && !gaps.unavailable.length);
}

console.log('\n3. bounds');
{
  const r = X.adjust({ stats: { bpm: -29.5, ts: 0.4, stl_pct: 11.9 }, from: 'liga-endesa', to: 'kosovo-superliga' });
  ok('held inside the file\'s bounds (BPM up to 30, TS% 0-100, STL% 0-12)', r.values.bpm <= 30 && r.values.ts <= 100 && r.values.stl_pct <= 12 && r.values.stl_pct === 12);
  const lo = X.adjust({ stats: { bpm: -29.5, ts: 0.4 }, from: 'liga-endesa', to: 'euroleague' });
  ok('...and never below the floor', lo.values.bpm === -30 && lo.values.ts === 0);
  const noMeta = TA.create(Object.assign({}, SCALE, { meta: undefined }), SITE, TIERS);
  ok('a file without bounds uses the nine\'s own (STL% 0-12)', noMeta.adjust({ stats: { stl_pct: 11.9 }, from: 'liga-endesa', to: 'kosovo-superliga' }).values.stl_pct === 12);
}

console.log('\n4. the Spanish ladder');
{
  const nkl = X.adjust({ stats: LINE, from: 'nkl', to: 'liga-endesa' });
  ok('NKL (rung 3) moves as Segunda FEB does, by the network: -4 BPM', near(nkl.changed.bpm, -4) && nkl.estimated && nkl.basis.method === 'estimate');
  ok('...never with the measured Segunda FEB moves (-9 over 300 moves)', !near(nkl.changed.bpm, -8.6, 0.5));
  const half = TA.ladderNet(SCALE, 2.5);
  ok('a half rung is halfway: 2.5 = between Primera FEB and Segunda FEB', near(half[0], -3) && near(half[1], -2.75));
  ok('rungs 1, 2 and 3 are the three leagues themselves', TA.ladderNet(SCALE, 1)[0] === 0 && near(TA.ladderNet(SCALE, 2)[0], -2) && near(TA.ladderNet(SCALE, 3)[0], -4));
  ok('past Segunda FEB the step from Primera FEB is taken again, rate by rate (rung 6: -4 + 3 x -2 = -10; TOV% 1.2 + 3 x 0.6)',
     near(TA.ladderNet(SCALE, 6)[0], -10) && near(TA.ladderNet(SCALE, 6)[6], 3));
  const deep = X.adjust({ stats: LINE, from: 'i-divisioona-b', to: 'liga-endesa' });
  ok('I-divisioona B (rung 5.5) to Liga Endesa: -4 + 2.5 x -2 = -9 BPM, estimated', near(deep.changed.bpm, -9) && deep.estimated);
  ok('a youth league is never adjusted, from or to (EABL)', !X.canAdjust('eabl') &&
     !X.adjust({ stats: LINE, from: 'eabl', to: 'liga-endesa' }).ok && !X.adjust({ stats: LINE, from: 'liga-endesa', to: 'eabl' }).ok);
  const into = X.adjust({ stats: LINE, from: 'lkl', to: 'nkl' });
  ok('into an estimated league: estimated too', into.estimated && near(into.changed.bpm, 2.5));
  const bl = X.adjust({ stats: LINE, from: 'b-league-one', to: 'segunda-feb' });
  ok('B.LEAGUE One (rung 2.5) to Segunda FEB: half a step, +1 BPM', near(bl.changed.bpm, 1));
  ok('the menu says which are estimated', X.estimated('nkl') && !X.estimated('lkl') && X.entry('i-divisioona-b').extrapolated === true);
  ok('measured first, then estimated', X.targets.map(t => t.slug).join() === 'euroleague,kosovo-superliga,liga-endesa,lkl,primera-feb,segunda-feb,b-league-one,i-divisioona-b,nkl',
     X.targets.map(t => t.slug).join());
}

console.log('\n5. leagues that cannot move');
{
  const w = X.adjust({ stats: LINE, from: 'slb-women', to: 'liga-endesa' });
  ok('a women\'s league: nothing moves, every rate unavailable', !w.ok && Object.keys(w.changed).length === 0 && w.unavailable.length === 9 && w.values.bpm === 4);
  ok('...and is never a target', !X.canAdjust('slb-women') && !X.adjust({ stats: LINE, from: 'lkl', to: 'slb-women' }).ok);
  ok('a league with no match and no rung: the same', !X.canAdjust('mystery') && !X.adjust({ stats: LINE, from: 'mystery', to: 'lkl' }).ok);
  ok('nothing at all: nothing', !X.adjust().ok && !X.adjust({}).ok);
  const empty = TA.create(null, SITE, TIERS);
  ok('a menu without the file knows the leagues, and moves nothing', !empty.ready && empty.canAdjust('lkl') && !empty.adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' }).ok);
}

console.log('\n6. the file\'s own order and settings');
{
  const order = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const flip = a => order.map(i => a[i]);
  const rev = JSON.parse(JSON.stringify(SCALE));
  rev.stats = flip(SCALE.stats); rev.meta = flip(SCALE.meta);
  Object.values(rev.leagues).forEach(L => { L.net = flip(L.net); });
  Object.keys(rev.pairs).forEach(k => { rev.pairs[k] = flip(rev.pairs[k]); });
  const a = X.adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' }), b = TA.create(rev, SITE, TIERS).adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' });
  ok('the rates are found by name, not by place', JSON.stringify(a.values) === JSON.stringify(b.values));
  const k0 = TA.create(Object.assign({}, SCALE, { settings: Object.assign({}, SCALE.settings, { kBlend: 0 }) }), SITE, TIERS);
  ok('kBlend 0: the measured moves alone', near(k0.adjust({ stats: LINE, from: 'lkl', to: 'liga-endesa' }).changed.bpm, -2.5));
}

console.log('\n7. members only');
{
  const g = globalThis;
  const was = g.EpinoiaAccess;
  delete g.EpinoiaAccess;
  ok('no access.js (node, an embed): open', TA.locked(null) === false);
  const asked = [];
  g.EpinoiaAccess = { CATALOGUE: { locks: { transferMatrix: {} } }, featureLocked: (k, l) => { asked.push([k, l]); return true; } };
  ok('the lock asked is transferMatrix, with the league', TA.locked('L1') === true && asked[0][0] === 'transferMatrix' && asked[0][1] === 'L1' &&
     TA.lockKey() === 'transferMatrix');
  g.EpinoiaAccess = { CATALOGUE: { locks: { transferMatrix: {} } }, featureLocked: k => k !== 'transferMatrix' };
  ok('...and open when that key is', TA.locked() === false);
  const accessSrc = rd('epinoia', 'access.js');
  ok('access.js names the key', /transferMatrix\s*:/.test(accessSrc));
  g.EpinoiaAccess = { CATALOGUE: { locks: { transferMatrix: {} } }, featureLocked: () => false };
  ok('a member: open', TA.locked() === false);
  g.EpinoiaAccess = { featureLocked: () => { throw new Error('x'); } };
  ok('an access.js that throws: open, as analytics always fail open', TA.locked() === false);
  if (was) g.EpinoiaAccess = was; else delete g.EpinoiaAccess;
}

console.log('\n8. the page\'s copy');
{
  const g = globalThis;
  const keep = { fetch: g.fetch, D: g.EpinoiaData, tiers: g.EPINOIA_LEAGUE_TIERS, TD: g.EpinoiaTransferData };
  let files = 0, reads = 0, gated = [];
  g.EPINOIA_LEAGUE_TIERS = TIERS;
  g.EpinoiaData = { get: async q => { reads++; if (/gender/.test(q) && g.__noGender) throw new Error('400'); return SITE; } };
  /* the members' file comes through the gate (transferdata.js), never from an address of its own */
  g.fetch = async () => { files++; throw new Error('a page must not fetch the scale itself'); };
  g.EpinoiaTransferData = { load: async scope => { gated.push(scope); return SCALE; } };
  TA._reset();
  const menu = await TA.catalogue();
  ok('the menu reads the leagues, not the file', gated.length === 0 && reads === 1 && menu.canAdjust('nkl') && !menu.ready);
  const a = await TA.load(), b = await TA.load();
  ok('the scale is asked of the gate once, as tscale; the leagues not again',
     gated.join() === 'tscale' && reads === 1 && a === b && a.ready && TA.current() === a);
  ok('...and nothing is fetched directly', files === 0);
  ok('a loaded copy answers the menu too', (await TA.catalogue()) === a);
  for (const reason of ['signin', 'members', 'rate', 'none']) {
    TA._reset(); gated = [];
    g.EpinoiaTransferData = { load: async () => { gated.push(1); const e = new Error(reason); e.reason = reason; throw e; } };
    ok(`the gate says ${reason}: no adjustment (null)`, (await TA.load()) === null && gated.length === 1);
  }
  ok('...and it is not asked again at once', (await TA.load()) === null && gated.length === 1);
  TA._reset();
  g.EpinoiaTransferData = { load: async () => ({ version: 2, leagues: {} }) };
  ok('a file of another shape: null', (await TA.load()) === null);
  TA._reset(); delete g.EpinoiaTransferData;
  ok('no loader on the page: null, and nothing fetched', (await TA.load()) === null && files === 0);
  TA._reset(); reads = 0; g.__noGender = true;
  g.EpinoiaTransferData = { load: async () => SCALE };
  const old = await TA.load();
  ok('a database without the gender column (before 0131): asked again without it', !!old && reads === 2);
  TA._reset(); delete g.__noGender;
  const given = await TA.load({ leagues: SITE.slice(0, 4) });
  ok('a page that has the leagues already hands them over: not read again', given.canAdjust('lkl') && !given.canAdjust('nkl'));
  TA._reset();
  g.fetch = keep.fetch; if (keep.D) g.EpinoiaData = keep.D; else delete g.EpinoiaData;
  if (keep.TD) g.EpinoiaTransferData = keep.TD; else delete g.EpinoiaTransferData;
  if (keep.tiers) g.EPINOIA_LEAGUE_TIERS = keep.tiers; else delete g.EPINOIA_LEAGUE_TIERS;
}

console.log('\n9. the scale is never a public file');
{
  ok('no transfer-scale.json under epinoia/ (members\' data comes through the analytics gate)',
     !existsSync(path.join(ROOT, 'epinoia', 'transfer-scale.json')));
  const src = rd('epinoia', 'transferadjust.js');
  ok('transferadjust.js names no file address of its own', !/transfer-scale\.json['"]/.test(src) && !/\bfetch\(/.test(src));
}

console.log('\n10. nothing of where the numbers came from');
{
  const src = rd('epinoia', 'transferadjust.js');
  const names = /basketball-?reference|bbref|kenpom|torvik|cleaning ?the ?glass|nba\.com|real ?gm|eurobasket|sports-reference|proballers|flashscore|synergy/i;
  ok('no stats site is named in the file', !names.test(src), (src.match(names) || [])[0]);
  ok('UMD: module.exports and window.EpinoiaTransferAdjust', /module\.exports = api/.test(src) && /root\.EpinoiaTransferAdjust = api/.test(src));
  ok('the reader\'s sentence for what moves is fixed', TA.WHAT === 'Adjusted: BPM, TS%, USG%, OREB%, DREB%, AST%, TOV%, STL% and BLK%. Every other figure is as played.');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
