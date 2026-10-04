// THE PLAYER REPORT'S SITUATION STATS (2026-10-03; report.js, season.js). What is held here, with no browser and no
// database (the pages were drawn against live data and read by eye):
//   * HALF-COURT AST% is blank under ten of his teammates' half-court baskets, not twenty (a rotation guard two games into a
//     season had fifteen and a dash);
//   * THE RIM BY SITUATION, worked out on any season row from the events lines: transition rim attempts per 100 of his team's
//     possessions while he is on the floor (not under 20 possessions), and the share of his rim attempts that came in the
//     half court; the two rim percentages beside them are the row's own (ev_transition_rim_pct, ev_half_rim_pct);
//   * HALF-COURT USAGE (ev_half_usg), season.js: the plays he ended in the half court (shots, 0.44 of his free throws,
//     turnovers) over his team's half-court chances while he was on the floor, each game's weighted by his share of its floor
//     time as USG%'s are, only the games whose side line is there, blank under ten chances;
//   * the templates: the two rim stats sit beside the rim stats in every SHOT PROFILE (player report and club report's
//     player cards), the transition rim stats are in every position's SITUATIONS (a big has one now), half-court usage
//     follows USG% in every SCORING group; every key has its label and, the new ones, their definition for the legend;
//   * THE SHOT PROFILE IN ITS PARTS (2026-10-03): a group about several kinds of shot is drawn under a heading for each (at the
//     rim, mid-range, three-point) with its rows on a bar of the kind's colour, its cells under a bar with a gap between the
//     parts; a group about one kind, or none, is drawn as it was; the report's zone tables are cut by shotchart.js parts.
//
//   node supabase/tests/report-situation-stats.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const SE = globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const E = require(path.join(ROOT, 'epinoia', 'report.js'));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };

console.log('\nhalf-court AST%: ten baskets are enough');
{
  ok('the line is ten', E.HC_MIN === 10, E.HC_MIN);
  ok('one assist on fourteen half-court baskets is 7.1% (the guard in the report that showed a dash)', E.hcAstOf({ a: 1, m: 14 }) === 7.1, E.hcAstOf({ a: 1, m: 14 }));
  ok('three on ten is 30%; three on nine is blank', E.hcAstOf({ a: 3, m: 10 }) === 30 && E.hcAstOf({ a: 3, m: 9 }) === null);
  ok('nobody (not on the floor for any), and a tally never made, are blank', E.hcAstOf(undefined) === null && E.hcAstOf(null) === null && E.hcAstOf({ a: 0, m: 0 }) === null);
  ok('the legend says ten, not twenty', /blank under 10 such baskets/.test(E.DEFS.hc_ast_pct[1]) && !/under 20/.test(E.DEFS.hc_ast_pct[1]));
}

console.log('\nthe rim by situation, on any season row');
{
  const d = r => E.derive(Object.assign({}, r));
  const a = d({ ev_transition_rimA: 5, on_poss: 100, ev_half_rimA: 3, ev_all_rimA: 6 });
  ok('five transition rim attempts over a hundred possessions on the floor is 5.0 a hundred', a.ev_transition_rim_a100 === 5, a.ev_transition_rim_a100);
  ok('three of his six rim attempts in the half court is 50%', a.rim_half_sh === 50, a.rim_half_sh);
  const b = d({ ev_transition_rimA: 7, on_poss: 73.5, ev_half_rimA: 1, ev_all_rimA: 3 });
  ok('to one decimal (7 over 73.5 possessions is 9.5; one of three is 33.3)', b.ev_transition_rim_a100 === 9.5 && b.rim_half_sh === 33.3, [b.ev_transition_rim_a100, b.rim_half_sh]);
  const c = d({ ev_transition_rimA: 0, on_poss: 73.5, ev_half_rimA: 0, ev_all_rimA: 2 });
  ok('none in transition is a real zero; none of his rim attempts in the half court is a real zero', c.ev_transition_rim_a100 === 0 && c.rim_half_sh === 0, [c.ev_transition_rim_a100, c.rim_half_sh]);
  const e = d({ ev_transition_rimA: 2, on_poss: 19.9, ev_half_rimA: 0, ev_all_rimA: 0 });
  ok('under 20 possessions on the floor the volume is noise and blank; no rim attempts at all gives no share', e.ev_transition_rim_a100 == null && e.rim_half_sh == null, [e.ev_transition_rim_a100, e.rim_half_sh]);
  const f = d({ ev_transition_rimA: null, on_poss: 90, ev_half_rimA: null, ev_all_rimA: null });
  ok('a season with no events lines (no coverage) is blank, never zero', f.ev_transition_rim_a100 == null && f.rim_half_sh == null);
  const g = d({ ev_transition_rimA: 4, on_poss: 80, ev_transition_rim_a100: 9.9 });
  ok('a value the row already carries is left as it is', g.ev_transition_rim_a100 === 9.9);
  /* ranked among a pool like any other, and drawn with their labels */
  const field = Array.from({ length: 12 }, (_, i) => d({ id: 'p' + i, ev_transition_rimA: i, on_poss: 100, ev_half_rimA: i, ev_all_rimA: 12, ev_half_usg: 10 + i }));
  const R = E.ranker(field, ['ev_transition_rim_a100', 'rim_half_sh', 'ev_half_usg']);
  ok('the new keys are ranked (the highest of twelve is the 100th)', R.pct('ev_transition_rim_a100', 'p11') === 100 && R.pct('rim_half_sh', 'p0') === 0 && R.pct('ev_half_usg', 'p11') === 100);
  const html = k => E.statRowHTML(k, field[5], R);
  ok('a row names the stat and prints its value', /TRANSITION RIM VOL \/ 100/.test(html('ev_transition_rim_a100')) && />5\.0</.test(html('ev_transition_rim_a100'))
     && /% OF RIM ATT IN HALF COURT/.test(html('rim_half_sh')) && /HALF-COURT USG%/.test(html('ev_half_usg')) && />15\.0</.test(html('ev_half_usg')));
  ok('volumes and shares are a style, with no good end (one neutral tone); the percentages are not',
     E.STATS.ev_transition_rim_a100.style && E.STATS.rim_half_sh.style && E.STATS.ev_half_usg.style && !E.STATS.ev_transition_rim_pct.style && !E.STATS.ev_half_rim_pct.style);
}

console.log('\nthe templates');
{
  const T = E.TPL;
  const all = [['main', 'guard'], ['main', 'wing'], ['main', 'big'], ['players', 'guard'], ['players', 'wing'], ['players', 'big']];
  const keys = (set, pos, title) => { const g = T[set][pos].find(x => x[0] === title); return g ? g[1] : null; };
  ok('every SHOT PROFILE has the half-court share and the half-court rim% right beside the rim stats (after rim assisted%)',
     all.every(([s, p]) => { const k = keys(s, p, 'SHOT PROFILE'), i = k.indexOf('ev_rim_astp'); return i >= 0 && k[i + 1] === 'rim_half_sh' && k[i + 2] === 'ev_half_rim_pct'; }));
  ok('every SCORING has half-court usage straight after USG%', all.every(([s, p]) => { const k = keys(s, p, 'SCORING'), i = k.indexOf('usg'); return i >= 0 && k[i + 1] === 'ev_half_usg'; }));
  ok('the guard\'s and the wing\'s SITUATIONS carry the two transition rim stats, TRANSITION %PTS first', ['guard', 'wing'].every(p => {
    const k = keys('main', p, 'SITUATIONS'); return k[0] === 'ev_transition_pts_sh' && k.includes('ev_transition_rim_a100') && k.includes('ev_transition_rim_pct'); }));
  /* (the Synergy drives, a category drawn only for a player with a file, sit between the shot profile and what follows it) */
  const real = g => T.main.big.filter(x => !/SYNERGY/.test(x[0])).findIndex(x => x[0] === g);
  ok('the big has a SITUATIONS group now: the two transition rim stats, after the shot profile and before the rim protection',
     JSON.stringify(keys('main', 'big', 'SITUATIONS')) === JSON.stringify(['ev_transition_rim_a100', 'ev_transition_rim_pct'])
     && real('SITUATIONS') === real('SHOT PROFILE') + 1 && real('RIM PROTECTION') === real('SITUATIONS') + 1);
  ok('the club report\'s player cards take the half-court rim stats and half-court usage, and no transition rim stats (not asked for there)',
     ['guard', 'wing', 'big'].every(p => !T.players[p].some(g => g[1].some(k => /^ev_transition_rim/.test(k)))));
  ok('nothing the templates held is gone (the older keys are all still there)',
     ['vorp', 'obpm', 'orapm', 'drapm', 'usg', 'ts', 'efg', 'ftr', 'ft_pct', 'au', 'hc_ast_pct', 'ast3_sh', 'ast2_sh', 'tov_pct', 'rim_a100', 'rim_pct', 'ev_rim_astp', 'mid_a100', 'mid_pct', 'p3_a100', 'p3_pct', 'ev_p3_astp', 'ev_transition_pts_sh', 'ev_half_efg', 'ev_half_tov_pct', 'stl_pct', 'dreb_pct', 'diff_efg', 'diff_tov'].every(k => T.main.guard.some(g => g[1].includes(k)))
     && ['def_rim_fg_pm', 'def_rim_vol_pm', 'oreb_pct', 'blk_pct', 'pf_pg', 'diff_oreb', 'diff_vs_oreb'].every(k => T.main.big.some(g => g[1].includes(k))));
  const used = new Set(); Object.values(T).forEach(set => Object.values(set).forEach(groups => groups.forEach(g => g[1].forEach(k => used.add(k)))));
  ok('every key a template prints has a label', [...used].every(k => E.STATS[k] && E.STATS[k].l), [...used].filter(k => !(E.STATS[k] && E.STATS[k].l)));
  const fresh = ['ev_half_usg', 'ev_transition_rim_a100', 'ev_transition_rim_pct', 'rim_half_sh', 'ev_half_rim_pct'];
  ok('the new ones are defined for the legend (a title and what it means)', fresh.every(k => E.DEFS[k] && E.DEFS[k][0] && E.DEFS[k][1].length > 40), fresh.filter(k => !E.DEFS[k]));
  ok('no two labels are the same (the editor\'s list of stats is read by label)', new Set(Object.values(E.STATS).map(s => s.l)).size === Object.values(E.STATS).length);
}

console.log('\nhalf-court usage in the season line (season.js)');
{
  const HC = (fga, fta, tov, ch) => [0, 0, fga, 0, 0, 0, 0, 0, 0, 0, fta, tov].concat(ch == null ? [] : [ch]);
  const team = (ch, withSit = true) => ({ adv: { fga: 60, fgm: 25, fta: 20, tov: 12, oreb: 8, dreb: 25, minutes: 200, fg3m: 5, fg3a: 15, ftm: 14, pts: 70 },
    sit: withSit ? { v: 1, half: HC(28, 8, 5, ch), all: HC(60, 20, 12, 70) } : undefined });
  const row = (game, id, min, half) => ({ game_id: game, player_id: id, team_idx: 0, stats: { min: min * 60000, pts: 10, p2a: 8, p2m: 4, fta: 2, to: 1, sit: half ? { v: 1, half } : undefined } });
  const pgs = [
    row('g1', 'P', 30, HC(10, 5, 2)),      // 30 of 40 minutes: 0.75 of the team's 40 half-court chances = 30, he ended 10 + 2.2 + 2 = 14.2
    row('g2', 'P', 20, HC(6, 0, 1)),       // 20 minutes: 0.5 of 50 = 25, he ended 7
    row('g3', 'P', 10, null),              // no side line this game: it is in neither count
    row('g1', 'Q', 4, HC(1, 0, 0)),        // 4 minutes: 0.1 of 40 = 4 chances, under ten
    row('g3', 'R', 25, null)               // a player of a game with no events lines at all
  ];
  const tgs = ['g1', 'g2', 'g3'].flatMap(g => [{ game_id: g, team_idx: 0, stats: team(g === 'g1' ? 40 : 50, g !== 'g3') }, { game_id: g, team_idx: 1, stats: team(40, g !== 'g3') }]);
  const rows = SE.players(pgs, tgs, {});
  const P = rows.find(r => r.id === 'P'), Q = rows.find(r => r.id === 'Q'), Rr = rows.find(r => r.id === 'R');
  const want = Math.round(10 * 100 * (14.2 + 7) / (0.75 * 40 + 0.5 * 50)) / 10;
  ok('the plays he ended over the half-court chances while he played, each game by his share of its floor time (38.5)', P.ev_half_usg === want && want === 38.5, [P.ev_half_usg, want]);
  ok('a game with no events lines is in neither count (its minutes do not thin the figure)', P.gp === 3 && P.ev_gp === 2);
  ok('under ten chances while he was on the floor it is blank', Q.ev_half_usg === null, Q.ev_half_usg);
  ok('a player with no events coverage at all is blank, not zero', Rr.ev_half_usg === null, Rr.ev_half_usg);
  ok('his own USG% is still its own (not changed by it)', typeof P.usg === 'number' && P.usg > 0);
  const probe = SE.finishPlayers(SE.addPlayers(new Map(), [{ game_id: 'g', player_id: 'p', team_idx: 0, stats: { min: 60000 } }], []))[0];
  ok('it is a key of every season line, so the version of the code that sums a season changes with it (a season file from before is not read)', 'ev_half_usg' in probe && /^s\d+\.[0-9a-f]{8}$/.test(SE.version()), Object.keys(probe).length);
  const sh = read('supabase', 'functions', '_shared', 'season.js');
  ok('the Edge Function\'s copy of season.js has it too (extract-shared.mjs)', /ev_half_usg/.test(sh) && /A\.den\.hcCh \+= share/.test(sh));
}

console.log('\nthe shot profile in its parts');
{
  const SC = globalThis.EpinoiaShotChart = require(path.join(ROOT, 'epinoia', 'shotchart.js'));
  const guard = E.TPL.main.guard.find(g => g[0] === 'SHOT PROFILE')[1];
  const row = { id: 'x', rim_a100: 4.1, rim_pct: 66.7, ev_rim_astp: 50, rim_half_sh: 50, ev_half_rim_pct: 100, mid_a100: 2.7, mid_pct: 50, p3_a100: 16.3, p3_pct: 50, ev_p3_astp: 83.3, ev_half_efg: 84.6 };
  const field = Array.from({ length: 12 }, (_, i) => Object.assign({}, row, { id: 'p' + i, rim_pct: 40 + i }));
  field.push(row);
  const R = E.ranker(field, guard);
  const kinds = ks => E.shotRuns(ks);
  /* the stats a player with no Synergy file is drawn with: the templates' optional ones (DRIVE L / R) left out */
  const base = ks => ks.filter(k => !(E.STATS[k] && E.STATS[k].optional));
  ok('the guard\'s shot profile is three parts, in order', JSON.stringify(kinds(guard)) === '["rim","mid","three"]', kinds(guard));
  ok('a group about one kind of shot, or none, is not cut (SITUATIONS, RIM PROTECTION, SCORING, a lone rim group)',
     [['ev_transition_pts_sh', 'ev_transition_rim_a100', 'ev_transition_rim_pct', 'ev_half_efg'], ['def_rim_fg_pm', 'def_rim_vol_pm'], ['usg', 'ts'], ['rim_a100', 'rim_pct', 'ev_rim_astp'], []].every(ks => kinds(ks) === null));
  ok('the wing\'s and the big\'s shot profiles are cut too: the rim, then the three (with no Synergy file)',
     JSON.stringify(kinds(base(E.TPL.main.wing.find(g => g[0] === 'SHOT PROFILE')[1]))) === '["rim","three"]' && JSON.stringify(kinds(base(E.TPL.main.big.find(g => g[0] === 'SHOT PROFILE')[1]))) === '["rim","three"]'
     && ['guard', 'wing', 'big'].every(p => kinds(E.TPL.players[p].find(g => g[0] === 'SHOT PROFILE')[1])));
  ok('...the Synergy drives are a category of their own, straight after the shot profile, in every template - and none of them in the shot profile',
     ['main', 'players'].every(set => ['guard', 'wing', 'big'].every(p => {
       const g = E.TPL[set][p], i = g.findIndex(x => x[0] === 'SHOT PROFILE'), d = g.findIndex(x => /DRIVES L\/R/.test(x[0]));
       return d === i + 1 && g[d][1].join() === 'drv_rim_fg,drv_rim_att,drv_mid_fg,drv_mid_att,drv_3_fg,drv_3_att' && !g[i][1].some(k => /^drv_/.test(k)); })));
  const html = E.groupRowsHTML(guard, row, R);
  const heads = html.match(/<div class="rp-zh" data-z="[a-z]+"><i><\/i>[^<]+<\/div>/g) || [];
  ok('the rows: a heading for each part (at the rim, mid-range, three-point), a row for every stat, each on its kind',
     heads.length === 3 && /data-z="rim"><i><\/i>at the rim/.test(heads[0]) && /data-z="mid"><i><\/i>mid-range/.test(heads[1]) && /data-z="three"><i><\/i>three-point/.test(heads[2])
     && (html.match(/<div class="rp-st"/g) || []).length === base(guard).length && (html.match(/<div class="rp-st"[^>]* data-z="rim"/g) || []).length === 5
     && (html.match(/<div class="rp-st"[^>]* data-z="mid"/g) || []).length === 2 && (html.match(/<div class="rp-st"[^>]* data-z="three"/g) || []).length === 3, heads);
  ok('...a heading comes before the first row of its part and after the last of the one before',
     html.indexOf('at the rim') < html.indexOf('RIM VOL / 100') && html.indexOf('HALF-COURT RIM%') < html.indexOf('mid-range') && html.indexOf('mid-range') < html.indexOf('MID VOL / 100')
     && html.indexOf('MID%') < html.indexOf('three-point') && html.indexOf('three-point') < html.indexOf('3PT VOL / 100'));
  ok('...every row is the row it was (label, value, percentile)', /RIM VOL \/ 100/.test(html) && />4\.1</.test(html) && /% OF RIM ATT IN HALF COURT/.test(html) && />100\.0</.test(html));
  const one = E.groupRowsHTML(['usg', 'ts'], { id: 'x', usg: 20, ts: 55 }, E.ranker(field, ['usg', 'ts']));
  ok('a group that is not cut is drawn exactly as before: no heading, no part on a row',
     !/rp-zh|data-z/.test(one) && (one.match(/<div class="rp-st"/g) || []).length === 2 && one === ['usg', 'ts'].map(k => E.statRowHTML(k, { id: 'x', usg: 20, ts: 55 }, E.ranker(field, ['usg', 'ts']))).join(''));
  const mixed = E.groupRowsHTML(['rim_a100', 'ev_half_efg', 'rim_pct', 'mid_a100'], row, R);
  ok('a reader\'s own mixture is drawn in order, every stat once, the parts named where the kind changes', (mixed.match(/<div class="rp-st"/g) || []).length === 4 &&
     mixed.indexOf('RIM VOL / 100') < mixed.indexOf('HALF-COURT eFG%') && mixed.indexOf('HALF-COURT eFG%') < mixed.indexOf('RIM%') && /data-z="mid"><i><\/i>mid-range/.test(mixed) && !/<div class="rp-st"[^>]*data-z="[^"]*"[^>]*>(?:(?!<div class="rp-st").)*HALF-COURT eFG%/.test(mixed.replace(/\n/g, '')));
  const cells = E.groupCellsHTML(guard, row, R);
  const runs = cells.match(/<div class="rp-run" data-z="[a-z]+"><em>[^<]+<\/em>/g) || [];
  ok('the cells: every stat a cell, on its kind, each kind\'s cells in a box of their own named over them (Rim, Mid-range, Three)',
     (cells.match(/<div class="rp-cell/g) || []).length === base(guard).length && runs.length === 3
     && /data-z="rim"><em>Rim</.test(runs[0]) && /data-z="mid"><em>Mid-range</.test(runs[1]) && /data-z="three"><em>Three</.test(runs[2])
     && (cells.match(/<div class="rp-cell[^"]*" data-b="\d" data-z="rim"/g) || []).length === 5 && (cells.match(/<div class="rp-cell[^"]*" data-b="\d" data-z="mid"/g) || []).length === 2
     && (cells.match(/<div class="rp-cell[^"]*" data-b="\d" data-z="three"/g) || []).length === 3, runs);
  const plain = E.groupCellsHTML(['usg', 'ts'], { id: 'x', usg: 20, ts: 55 }, E.ranker(field, ['usg', 'ts']));
  ok('a group of cells that is not cut is as before', !/data-z|zn/.test(plain) && plain === ['usg', 'ts'].map(k => E.statCellHTML(k, { id: 'x', usg: 20, ts: 55 }, E.ranker(field, ['usg', 'ts']))).join(''));
  ok('a part\'s heading is height the page\'s two columns are cut by: a row each, the group\'s title, and a heading a part',
     Math.abs(E.groupWeight(guard) - (guard.length + 1.6 + 0.9 * 3)) < 1e-9 && E.groupWeight(['usg', 'ts', 'efg']) === 3 + 1.6 && E.groupWeight([]) === 1.6, E.groupWeight(guard));
  /* the report's own zone tables, cut by the same parts as the pages' */
  const shot = (x, y, three, made) => ({ x: x / 1500, y: y / 1400, three: !!three, made: !!made });
  const shots = [shot(750, 170, false, true), shot(750, 170, false, false), shot(30, 100, true, true), shot(750, 700, false, true), shot(1300, 960, true, false)];
  const Z = E.zoneColumnsHTML(shots, 2);
  const zk = Z.match(/<tr class="rp-zk"[^>]*>.*?<\/tr>/g) || [];
  ok('the report\'s zone tables: a heading row for each part (three and two), each across the table, and the rows on their kind',
     zk.length === 5 && /data-k="paint"><td colspan="5"><i><\/i>rim &amp; paint/.test(zk[0]) && /data-k="mid"><td colspan="5"><i><\/i>mid-range/.test(zk[1]) && /data-k="three"><td colspan="5"><i><\/i>threes/.test(zk[2])
     && /<tr class="rp-zk"><td colspan="5"><i><\/i>by side of the floor/.test(zk[3]) && /by kind of shot/.test(zk[4]) && /<tr data-k="paint"><td class="l">at the rim/.test(Z) && /<tr data-k="three"><td class="l">corner 3/.test(Z)
     && /<tr class="none" data-k="three"><td class="l">top 3/.test(Z) && (Z.match(/<tr( class="none")?( data-k="[a-z]+")?><td class="l">/g) || []).length === 15, zk);
  const css = read('epinoia', 'kit', 'report.css');
  ok('the stylesheet: the kinds\' colours (the club\'s, 62%, 34%), the heading, the bar on a row, the bar over a cell and the gap between parts, the zone table\'s heading band',
     /\.rp-zh\[data-z="mid"\][^{]*\{ --zc:color-mix\(in srgb,var\(--rp-a,#08603f\) 62%,#ffffff\) \}/.test(css) && /\.rp-zh\[data-z="three"\][^{]*\{ --zc:color-mix\(in srgb,var\(--rp-a,#08603f\) 34%,#ffffff\) \}/.test(css)
     && /\.rp-st\[data-z\]\{ padding-left:7px; box-shadow:inset 3px 0 0 var\(--zc\) \}/.test(css) && /\.rp-cell\[data-z\]\{ box-shadow:inset 0 3px 0 var\(--zc\)/.test(css) && /\.rp-cell\.zn\{ margin-left:6px \}/.test(css)
     && /\.rp-zt tr\.rp-zk td\{/.test(css) && /\.rp-zt tr\[data-k\] > td\.l\{ box-shadow:inset 3px 0 0 var\(--zc\) \}/.test(css));
  ok('and a label may wrap, so the larger cuts\' table (its "jump shots (outside the paint)") is no longer wider than its page', /\.rp-zt td\.l\{[^}]*white-space:normal/.test(css) && !/\.rp-zt td\.l\{[^}]*nowrap/.test(css));
  const pp = read('epinoia', 'report-playerpages.js'), tp = read('epinoia', 'report-teampages.js');
  ok('the pages draw their groups through it: the player report\'s rows (and cut its columns by the weight), the club report\'s player cards\' cells',
     /E\.groupRowsHTML\(ks, mine, Rk\)/.test(pp) && /\(\[, ks\]\) => E\.groupWeight\(ks\)/.test(pp) && /E\.groupCellsHTML\(ks, r, Rk\)/.test(tp) && !/ks\.map\(k => E\.statCellHTML/.test(tp));
}

console.log('\nthe pages');
{
  const src = read('epinoia', 'report.js');
  ok('the minimum is the one constant, in the source', /const HC_MIN = 10;/.test(src));
  const pp = read('epinoia', 'report-playerpages.js'), tp = read('epinoia', 'report-teampages.js');
  ok('both reports rank the field after derive (the new figures are on every row before they are ranked)', /field\.forEach\(E\.derive\)/.test(pp) && /field\.forEach\(E\.derive\)/.test(tp));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
