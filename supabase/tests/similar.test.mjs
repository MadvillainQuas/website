/* ============================================================================
   SIMILAR PLAYERS (epinoia/similar.js, epinoia/p/similar-ui.js, tools/build-similar.mjs, the profile's button).

     * who may be compared: four games or fifty minutes;
     * the maths: a near-twin is nearer than a stranger, in either order, and the same line is as near as it gets;
       a rate over a handful of attempts is pulled toward the pool; a measure one side lacks sits out for the pair, and a
       group with too little in common is not scored; the percentage falls as the distance grows;
     * the file: the values round-trip, a file of another layout is refused, a miss is asked again, a hit once;
     * the page: the button is left of expand all, the scripts and style are on the profile in order, the builder and
       the new files never name another stats site.

     node supabase/tests/similar.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n     ' + JSON.stringify(d))); } };

const S = require(path.join(ROOT, 'epinoia', 'similar.js'));

/* a line with every measure at a plausible value, then moved */
const base = {
  gp: 20, min: 500, fga: 200, fta: 60, rimA: 80, rimM: 50, midA: 40, midM: 16, p3a: 80, p3m: 28, fgm: 94, tov: 40, on_poss: 900,
  usg: 22, au: 1.1, rim_rate: 40, mid_rate: 20, p3_rate: 40, ftr: 30,
  ev_rim_astp: 40, ev_mid_astp: 60, ev_p3_astp: 80, ev_ast_pts_sh: 50, ev_half_fga_sh: 80, ev_transition_fga_sh: 12,
  pos_pg: 0, pos_sg: 20, pos_sf: 60, pos_pf: 20, pos_c: 0,
  ts: 56, rim_pct: 62, mid_pct: 40, p3_pct: 35, ft_pct: 76, tov_pct: 13, ast_to: 1.8,
  oreb_pct: 4, dreb_pct: 14, stl_pct: 1.8, blk_pct: 1.2, pf30: 3.1, diff_drtg: -1, diff_vs_efg: -0.5
};
const mk = (over, seedShift) => Object.assign({}, base, over || {});
/* a pool with some spread, deterministic */
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const spread = () => {
  const r = mk();
  S.FEATURES.forEach(f => { if (typeof r[f.k] === 'number' && f.k.indexOf('pos_') !== 0) r[f.k] = r[f.k] * (0.6 + 0.8 * rnd()); });
  const p = [rnd(), rnd(), rnd(), rnd(), rnd()], t = p.reduce((a, b) => a + b, 0);
  ['pos_pg', 'pos_sg', 'pos_sf', 'pos_pf', 'pos_c'].forEach((k, i) => { r[k] = 100 * p[i] / t; });
  return r;
};
const pool = Array.from({ length: 60 }, spread);

console.log('-- who is compared');
ok('four games', S.eligible({ gp: 4, min: 10 }));
ok('fifty minutes', S.eligible({ gp: 2, min: 50 }));
ok('three games and forty-nine minutes is not enough', !S.eligible({ gp: 3, min: 49 }));
ok('no line is not eligible', !S.eligible(null) && !S.eligible({}));
ok('the page rule is the module rule', S.MIN_GP === 4 && S.MIN_MIN === 50);

console.log('-- what is measured');
const keys = S.FEATURES.map(f => f.k);
ok('every measure is named once', new Set(keys).size === keys.length);
ok('the three groups are style, efficiency and rebounding / defence', S.GROUPS.map(g => g.key).join('') === 'sed');
ok('every measure belongs to a group and has a weight, a scale and something it rests on',
  S.FEATURES.every(f => S.GROUPS.some(g => g.key === f.g) && f.w > 0 && f.mul > 0 && f.n && f.K > 0));
ok('assisted share by shot location is in (rim, mid-range, three)', ['ev_rim_astp', 'ev_mid_astp', 'ev_p3_astp'].every(k => keys.indexOf(k) >= 0));
ok('the share of minutes at each position is in, all five', ['pos_pg', 'pos_sg', 'pos_sf', 'pos_pf', 'pos_c'].every(k => keys.indexOf(k) >= 0));
ok('usage, assists per usage, the three distances, half-court and transition are in',
  ['usg', 'au', 'rim_rate', 'mid_rate', 'p3_rate', 'ev_half_fga_sh', 'ev_transition_fga_sh'].every(k => keys.indexOf(k) >= 0));
ok('the efficiency group has true shooting, the distances, free throws, turnovers and assist-to-turnover',
  ['ts', 'rim_pct', 'mid_pct', 'p3_pct', 'ft_pct', 'tov_pct', 'ast_to'].every(k => S.FEATURES[S.IDX[k]].g === 'e'));
ok('the rebounding / defence group has both rebound rates, steals, blocks, fouls and the two on/off',
  ['oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct', 'pf30', 'diff_drtg', 'diff_vs_efg'].every(k => S.FEATURES[S.IDX[k]].g === 'd'));
ok('the assisted and situation shares are the premium ones (the profile leaves them out where analytics are locked)',
  S.FEATURES.filter(f => f.premium).map(f => f.k).sort().join() === ['ev_ast_pts_sh', 'ev_half_fga_sh', 'ev_mid_astp', 'ev_p3_astp', 'ev_rim_astp', 'ev_transition_fga_sh'].sort().join());

console.log('-- the maths');
{
  const twin = mk({ usg: 22.4, ts: 56.5, p3_pct: 35.5 }), stranger = mk({ usg: 31, au: 0.3, rim_rate: 70, p3_rate: 10, mid_rate: 20, ts: 49, oreb_pct: 12, blk_pct: 4.5, pos_pg: 0, pos_sg: 0, pos_sf: 0, pos_pf: 20, pos_c: 80 });
  const P = S.prepare(pool.concat([base, twin, stranger]));
  const n = pool.length, a = n, b = n + 1, c = n + 2;
  const dTwin = S.distance(P.z[a], P.z[b]), dFar = S.distance(P.z[a], P.z[c]);
  ok('a near-twin is nearer than a stranger', dTwin.d < dFar.d, [dTwin.d, dFar.d]);
  ok('the distance is the same either way round', Math.abs(S.distance(P.z[b], P.z[a]).d - dTwin.d) < 1e-9);
  ok('a line is no distance from itself', S.distance(P.z[a], P.z[a]).d === 0);
  const near = S.nearest(P, a, 3);
  ok('nearest puts the twin first and never the line itself', near[0].j === b && near.every(x => x.j !== a), near.map(x => x.j));
  ok('nearest is in order', near.every((x, i) => i === 0 || near[i - 1].d <= x.d));
  ok('nearest can skip a line (the same person under another feed)', S.nearest(P, a, 3, j => j === b)[0].j !== b);
  const tau = S.calibrate(P);
  ok('every group has a scale', tau.all > 0 && tau.s > 0 && tau.e > 0 && tau.d > 0, tau);
  const pt = S.percent(dTwin.d, tau.all), pf = S.percent(dFar.d, tau.all);
  ok('a twin reads high, a stranger low, and the same line is capped under 100', pt > pf && pt >= 75 && S.percent(0, tau.all) === 99, [pt, pf]);
  ok('a percentage is a whole number from 0 to 99', Number.isInteger(pt) && pt >= 0 && pt <= 99 && S.percent(50, 1) === 0);
  ok('a distance that cannot be worked out has no percentage', S.percent(null, 1) === null && S.percent(1, 0) === null);

  /* a rate over a handful of attempts is not a trait */
  const few = mk({ rimA: 3, rimM: 3, rim_pct: 100 }), many = mk({ rimA: 400, rimM: 400, rim_pct: 100 });
  const Q = S.prepare(pool.concat([few, many]));
  const i = S.IDX.rim_pct;
  ok('3 of 3 at the rim counts for less than 400 of 400', Q.z[n][i] < Q.z[n + 1][i], [Q.z[n][i], Q.z[n + 1][i]]);

  /* measures one side lacks sit out; too little in common is not scored */
  const noEv = mk({}); S.FEATURES.filter(f => f.premium || f.k.indexOf('pos_') === 0).forEach(f => { noEv[f.k] = null; });
  const R = S.prepare(pool.concat([base, noEv]));
  const d1 = S.distance(R.z[n], R.z[n + 1]);
  ok('a pair where one has no play-by-play measures is still compared on the rest', d1.d != null && d1.g.s != null && d1.g.e != null && d1.g.d != null, d1);
  const bare = {}; ['gp', 'min', 'usg'].forEach(k => { bare[k] = base[k]; });
  const T = S.prepare(pool.concat([base, bare]));
  const d2 = S.distance(T.z[n], T.z[n + 1]);
  ok('a line with almost nothing has no score for the groups it cannot be compared in', d2.g.e === null && d2.g.d === null && d2.d === null, d2);
}

console.log('-- names');
ok('the same person under two feeds is one name', S.nameKey('José  Núñez Jr.') === S.nameKey('jose nunez') && S.nameKey('') === '');
ok('two people are two names', S.nameKey('Jon Smith') !== S.nameKey('John Smith'));

console.log('-- the file');
{
  const row = mk();
  const v = S.pack(row);
  ok('a line packs to one whole number a measure, in the measures\' order', v.length === S.FEATURES.length && v.every(x => x === null || Number.isInteger(x)));
  ok('a value comes back to the decimal it is shown at', S.FEATURES.every((f, i) => row[f.k] == null || Math.abs(S.unpackValue(i, v[i]) - row[f.k]) <= 0.5 / f.mul + 1e-9));
  ok('a missing value stays missing', S.pack({})[0] === null && S.unpackValue(0, null) === null && S.show(0, null) === '—');
  ok('a signed measure prints its sign', S.show(S.IDX.diff_drtg, 2.5) === '+2.5' && S.show(S.IDX.diff_drtg, -2.5) === '-2.5' && S.show(S.IDX.usg, 2.5) === '2.5');
  const good = { v: S.VERSION, n: [], me: { vals: v } };
  ok('a file of this layout is read', S.fileOk(good));
  ok('a file of another layout, or with another number of measures, is not', !S.fileOk(Object.assign({}, good, { v: S.VERSION + 1 })) && !S.fileOk({ v: S.VERSION, n: [], me: { vals: [1, 2] } }) && !S.fileOk(null));
  ok('a file lives under the layout, the competition and the player', S.filePath('c1', 'p1') === 'similar/v' + S.VERSION + '/c1/p1.json');
}

console.log('-- the page reads the file');
{
  globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://x.test' };
  globalThis.EpinoiaSimilar = S;
  const UI = require(path.join(ROOT, 'epinoia', 'p', 'similar-ui.js'));
  const fileBody = { v: S.VERSION, n: [], me: { vals: S.pack(mk()) } };
  let calls = [], answer = null;
  globalThis.fetch = async url => { calls.push(url); return answer ? { ok: true, json: async () => answer } : { ok: false, json: async () => null }; };
  ok('where the file is', UI.url('c1', 'p1') === 'https://x.test/storage/v1/object/public/snapshots/similar/v1/c1/p1.json');
  ok('nothing to look up, nothing asked', (await UI.load(null, 'p')) === null && calls.length === 0);
  ok('a missing file is null', (await UI.load('c1', 'p1')) === null && calls.length === 1);
  ok('and is asked again next time', (await UI.load('c1', 'p1')) === null && calls.length === 2);
  answer = fileBody;
  const first = await UI.load('c1', 'p1');
  ok('a file is read', first && first.v === S.VERSION && calls.length === 3);
  ok('and then kept for the page (the hover and the press ask once)', (await UI.load('c1', 'p1')) === first && calls.length === 3);
  answer = { v: 999, n: [], me: { vals: [] } };
  ok('a file of another layout is not used', (await UI.load('c2', 'p2')) === null);
  ok('a measure is placed on the pool\'s scale: the mean in the middle, three spreads at the edge', UI._test.zPos(10, [10, 2]) === 50 && UI._test.zPos(16, [10, 2]) === 100 && UI._test.zPos(-50, [10, 2]) === 0 && UI._test.zPos(null, [10, 2]) === null);
}

console.log('-- the profile page');
{
  const html = rd('epinoia', 'p', 'index.html');
  const at = s => html.indexOf(s);
  ok('the style is on the page', at('kit/similar.css') > -1 && at('kit/similar.css') > at('kit/cards.css'));
  ok('the module and the panel come before the page script, in that order',
    at('../similar.js') > -1 && at('../similar.js') < at('similar-ui.js') && at('similar-ui.js') < at('player.js?'));
  const js = rd('epinoia', 'p', 'player.js');
  ok('the button sits before expand all in the bars\' row', js.indexOf('sw.appendChild(sb)') > -1 && js.indexOf('sw.appendChild(sb)') < js.indexOf('sw.appendChild(all)'));
  ok('the button is switched off below four games or fifty minutes', /SS\.eligible\(mine\)/.test(js) && /sb\.disabled = true/.test(js));
  ok('a new scope closes the matches and forgets them', /simOpen = false; SIM_CTX = null; SIM_CTL = null;/.test(js));
  ok('expand all and collapse all follow whichever is showing', /simOpen && SIM_CTL\) SIM_CTL\.setAll\(true\)/.test(js) && /simOpen && SIM_CTL\) SIM_CTL\.setAll\(false\)/.test(js));
  ok('a reader who has to sign in first gets the site\'s sign-in card and nothing is fetched for them',
    /function simSigninFirst\(\)/.test(js) && /A\.signinFirst\(\)/.test(js) && /simSigninFirst\(\) \? simSigninPanel\(\) : await simPanel\(\)/.test(js) &&
    /A\.signinHTML\(\{ what: 'Similar players'/.test(js) && /if \(!simSigninFirst\(\)\) SU\.prefetch/.test(js));
  ok('the gate asks for an account only, never a membership (signinFirst, not a lock key)', !/featureLocked\('similar'|CATALOGUE\.locks\.similar/.test(js));
  const names = /basketball-?reference|bbref|kenpom|torvik|cleaning ?the ?glass|nba\.com|realgm|eurobasket|sports-reference/i;
  const files = [['epinoia', 'similar.js'], ['epinoia', 'p', 'similar-ui.js'], ['epinoia', 'kit', 'similar.css'], ['tools', 'build-similar.mjs']];
  ok('no new file names another stats site', files.every(f => !names.test(rd(...f))), files.filter(f => names.test(rd(...f))));
  /* 2026-10-08: the panel's title is a centred subtitle with the section title's mark, and an opened match says whose is whose */
  const ui = rd('epinoia', 'p', 'similar-ui.js'), css = rd('epinoia', 'kit', 'similar.css');
  ok('the panel\'s title is a centred subtitle (sectitle.css .sec-sub), not a small label at the left',
     /el\('h3', 'sec-sub sim-title', 'similar players'\)/.test(ui) && /\.sim-head\{[^}]*justify-items:center/.test(css) &&
     /body \.sec-sub\{/.test(rd('epinoia', 'kit', 'sectitle.css')) && /body \.sec-sub::after\{/.test(rd('epinoia', 'kit', 'teletext.css').replace(/body \.sec-h h2::after, body \.ep-hdr h2::after, /, '')));
  ok('an opened match starts with a key: both names and marks, each surname over its own column',
     /wrap\.appendChild\(key\(names\)\)/.test(ui) && /'sm-kc ' \+ c, shortName\(names\[i\]\)/.test(ui));
  ok('the two players never share a colour: the match is not drawn in the club\'s second colour, and is a ring',
     /--sm-them:var\(--aqua\)/.test(css) && !/\.sm-(dot|mv)\.them\{[^}]*team-b-ink/.test(css) &&
     /\.sm-dot\.them\{[^}]*border:2\.5px solid var\(--sm-them\)/.test(css));
  ok('the visible text says nothing of the player\'s gender', !/\b(his|him|her|she|he)\b/i.test(rd('epinoia', 'p', 'similar-ui.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
