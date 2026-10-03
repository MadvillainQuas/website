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
//     follows USG% in every SCORING group; every key has its label and, the new ones, their definition for the legend.
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
  ok('the big has a SITUATIONS group now: the two transition rim stats, after the shot profile and before the rim protection',
     JSON.stringify(keys('main', 'big', 'SITUATIONS')) === JSON.stringify(['ev_transition_rim_a100', 'ev_transition_rim_pct'])
     && T.main.big.findIndex(x => x[0] === 'SITUATIONS') === T.main.big.findIndex(x => x[0] === 'SHOT PROFILE') + 1
     && T.main.big.findIndex(x => x[0] === 'RIM PROTECTION') === T.main.big.findIndex(x => x[0] === 'SITUATIONS') + 1);
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

console.log('\nthe pages');
{
  const src = read('epinoia', 'report.js');
  ok('the minimum is the one constant, in the source', /const HC_MIN = 10;/.test(src));
  const pp = read('epinoia', 'report-playerpages.js'), tp = read('epinoia', 'report-teampages.js');
  ok('both reports rank the field after derive (the new figures are on every row before they are ranked)', /field\.forEach\(E\.derive\)/.test(pp) && /field\.forEach\(E\.derive\)/.test(tp));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
