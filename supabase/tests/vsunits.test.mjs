/* ============================================================================
   THE PLAYER PROFILE'S LEAGUE PERCENTILE: SCOUTING VIEW AND SIMPLE VIEW, AND ALL,
   AGAINST THE STARTERS AND AGAINST THE BENCH (epinoia/vsunits.js, p/player.js).

     node supabase/tests/vsunits.test.mjs

   What would go wrong quietly:
     1. a per-75 figure on the wrong possessions (his own, or per game), which
        index_9 puts on his team's possessions while he is on the floor
     2. a split that does not add up to his game: minutes, points, his box or the
        on-court block lost or counted twice at a change of five
     3. the club page and the profile disagreeing about who a starter is
     4. a split rate worked out by a formula of its own instead of the season line's
     5. a split figure placed in the league by a count of its own
     6. the profile reading anything more than it did before somebody asks
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + JSON.stringify(detail).slice(0, 400) : '')); }
};

globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const S = globalThis.EpinoiaSeason;
const E = require(path.join(ROOT, 'epinoia', 'engine.js'));
const V = require(path.join(ROOT, 'epinoia', 'vsunits.js'));
const SL = require(path.join(ROOT, 'epinoia', 't', 'seasonline.js'));

/* ---- 1. per 75 ---------------------------------------------------------------- */
console.log('\n1. per 75 of his team\'s possessions while he is on the floor');
{
  const oc = { tFGA: 100, tFGM: 45, t3M: 10, tFTA: 25, tTOV: 10, tOR: 10, tPTS: 110, tDR: 30,
               oFGA: 90, oFGM: 40, o3M: 8, oFTA: 20, oTOV: 12, oOR: 8, oDR: 28, oPTS: 100 };
  const game = { game_id: 'g1', player_uuid: 'P', team_idx: 0, stats: { min: 30 * 60000, pts: 21, p2a: 10, p2m: 6, p3a: 5, p3m: 2, fta: 4, ftm: 3,
    or: 2, dr: 6, ast: 4, stl: 2, blk: 1, to: 3, pf: 2, oc } };
  const tg = [{ game_id: 'g1', team_idx: 0, stats: { adv: { pts: 110, fga: 100, fta: 25, tov: 10, oreb: 10, minutes: 200 } } },
              { game_id: 'g1', team_idx: 1, stats: { adv: { pts: 100, fga: 90, fta: 20, tov: 12, oreb: 8, minutes: 200 } } }];
  const row = S.players([game], tg)[0];
  const poss = S.POSS(oc.tFGA, oc.tFTA, oc.tTOV, oc.tOR);
  ok('season.js carries the possessions every per-100 divides by (on_poss)', row.on_poss === Math.round(poss * 10) / 10, [row.on_poss, poss]);
  V.per75(row);
  const p75 = n => Math.round(75 * n / row.on_poss * 10) / 10;
  ok('each count x 75 / those possessions: points, rebounds, assists, steals, blocks, turnovers, fouls',
     row.pts_p75 === p75(21) && row.reb_p75 === p75(8) && row.oreb_p75 === p75(2) && row.dreb_p75 === p75(6) && row.ast_p75 === p75(4) &&
     row.stl_p75 === p75(2) && row.blk_p75 === p75(1) && row.tov_p75 === p75(3) && row.pf_p75 === p75(2), row);
  ok('...and the shots: FGM / FGA, 3PM / 3PA, FTM / FTA',
     row.fgm_p75 === p75(8) && row.fga_p75 === p75(15) && row.p3m_p75 === p75(2) && row.p3a_p75 === p75(5) && row.ftm_p75 === p75(3) && row.fta_p75 === p75(4));
  ok('...not per his own possessions (season.js pts75 is that, and stays as it was)', row.pts_p75 !== row.pts75);
  const again = JSON.stringify(row); V.per75(row);
  ok('putting them on twice changes nothing', JSON.stringify(row) === again);
  const thin = V.per75({ pts: 10, on_poss: 19.9 });
  ok('under 20 possessions it is noise, and left blank, as the per-100s are', thin.pts_p75 === null && V.per75({ pts: 10 }).pts_p75 === null);
  ok('fifteen figures, the box score', V.P75.length === 15 && V.P75.every(([t, k]) => k === t + '_p75'));
}

/* ---- 2. who is a starter -------------------------------------------------------- */
console.log('\n2. a starter is what the club page says it is');
{
  const games = [];
  for (let i = 0; i < 12; i++) {
    games.push({ id: 'g' + i, home_team_id: 'A', away_team_id: i % 2 ? 'B' : 'C',
      starters: [['a1', 'a2', 'a3', 'a4', i < 9 ? 'a5' : 'a6'], ['b1', 'b2', 'b3', i < 3 ? 'b4' : 'b9', 'b5']] });
  }
  const mine = V.regularStarters(games, 10), theirs = SL.regularStarters(games, 10);
  const flat = m => JSON.stringify([...m].map(([t, s]) => [t, [...s].sort()]).sort());
  ok('the regular starters are seasonline.js\'s own count (N starts or more for his club)', flat(mine) === flat(theirs), [flat(mine), flat(theirs)]);
  ok('...a5 started 9 of 12, under N = 10; a1 started all 12', mine.get('A').has('a1') && !mine.get('A').has('a5'));
  const game5 = ['x1', 'x2', 'x3', 'x4', 'x5'];
  ok('4 of that game\'s starting five on: against the starters', V.unitOf(['x1', 'x2', 'x3', 'x4', 'y1'], game5, null) === 'start');
  ok('3 of them and nobody regular: against the bench', V.unitOf(['x1', 'x2', 'x3', 'y1', 'y2'], game5, new Set()) === 'bench');
  ok('3 of them but 4 regular starters on: against the starters', V.unitOf(['x1', 'x2', 'x3', 'r1', 'y2'], game5, new Set(['x1', 'x2', 'x3', 'r1'])) === 'start');
  ok('a five that is not five (short-handed) is counted on its regular starters only, as lineupevents.js does',
     V.unitOf(['x1', 'x2', 'x3', 'x4'], game5, null) === 'bench' && V.unitOf(['x1', 'x2', 'x3', 'x4'], game5, new Set(['x1', 'x2', 'x3', 'x4'])) === 'start');
  ok('the club page splits its minutes by the same rule', /\(r\.ost != null && r\.ost >= 4\) \|\| regularOn\(r\) >= 4 \? start : bench/.test(rd('epinoia', 't', 'seasonline.js')));
}

/* ---- 3. the replay ---------------------------------------------------------------- */
console.log('\n3. one game, cut where either five changes');
const st = [['H1', 'H2', 'H3', 'H4', 'H5'], ['A1', 'A2', 'A3', 'A4', 'A5']];
let id = 0;
const ev = o => Object.assign({ id: ++id, seq: id, period: 1 }, o);
const events = [
  ev({ t: 'period_start', clock: 600000 }),
  ev({ t: 'p2_made', team: 0, pid: 'H1', clock: 590000 }),
  ev({ t: 'p3_miss', team: 1, pid: 'A1', clock: 580000 }),
  ev({ t: 'reb', team: 0, pid: 'H1', clock: 579000, off: false }),
  ev({ t: 'p3_made', team: 0, pid: 'H1', clock: 570000 }),
  ev({ t: 'ast', team: 0, pid: 'H2', clock: 570000 }),
  ev({ t: 'sub', team: 1, in: 'A6', out: 'A1', clock: 300000 }),
  ev({ t: 'sub', team: 1, in: 'A7', out: 'A2', clock: 300000 }),
  ev({ t: 'p2_miss', team: 0, pid: 'H1', clock: 290000 }),
  ev({ t: 'reb', team: 1, pid: 'A6', clock: 289000, off: false }),
  ev({ t: 'p2_made', team: 1, pid: 'A6', clock: 280000 }),
  ev({ t: 'foul', team: 1, pid: 'A7', clock: 275000, kind: 'shooting', drawn: 'H1' }),
  ev({ t: 'ft_made', team: 0, pid: 'H1', clock: 275000 }),
  ev({ t: 'ft_miss', team: 0, pid: 'H1', clock: 275000 }),
  ev({ t: 'sub', team: 0, in: 'H6', out: 'H1', clock: 200000 }),
  ev({ t: 'foul', team: 0, pid: 'H1', clock: 150000, kind: 'tech' }),          // on the bench: nobody's split
  ev({ t: 'p2_made', team: 0, pid: 'H6', clock: 100000 }),
  ev({ t: 'sub', team: 1, in: 'A1', out: 'A6', clock: 60000 }),
  ev({ t: 'sub', team: 0, in: 'H1', out: 'H6', clock: 60000 }),
  ev({ t: 'to', team: 0, pid: 'H1', clock: 30000 })
];
const G = { id: 'g1', starters: st, events, period: 1, home_team_id: 'TH', away_team_id: 'TA' };
{
  const r = V.gameSplit(G, 'H1', { Engine: E, regular: new Map() });
  const min = x => Math.round(x / 600) / 100;
  ok('his side, and both parts', r.ok && r.side === 0, r);
  ok('against the starters: 10:00 to 5:00, and again from 1:00 (A1 back: 4 of their five)', min(r.start.min) === 6, min(r.start.min));
  ok('against the bench: 5:00 to 3:20, when he went off (A1 and A2 off: 3 of their five)', min(r.bench.min) === 1.67, min(r.bench.min));
  ok('his box goes to the part it happened in: a 2 and a 3 against the starters, a 2-point miss and 1-of-2 at the line against the bench',
     r.start.box.pts === 5 && r.start.box.p3m === 1 && r.bench.box.pts === 1 && r.bench.box.fta === 2 && r.bench.box.p2a === 1, [r.start.box, r.bench.box]);
  ok('...the turnover after he came back is against the starters', r.start.box.to === 1 && !r.bench.box.to);
  ok('...a technical while he sat is in neither', !r.start.box.pf && !r.bench.box.pf, [r.start.box.pf, r.bench.box.pf]);
  ok('the on-court block (both sides while he was on) is split the same way',
     r.start.box.oc.tPTS === 5 && r.start.box.oc.oFGA === 1 && r.bench.box.oc.oPTS === 2 && r.bench.box.oc.tFTA === 2, [r.start.box.oc, r.bench.box.oc]);
  ok('the threes the on-court block has no column for are counted beside it', r.start.t3a === 1 && r.start.o3a === 1 && r.bench.t3a === 0);
  const d = E.deriveGame({ teams: [{ players: [{ id: 'H1' }] }, { players: [] }], starters: st, events, period: 1, clockMs: 0 });
  const H = d.stats.H1;
  ok('the two parts add up to the engine\'s own box for the game (points, attempts, plus-minus, on-court points)',
     r.start.box.pts + r.bench.box.pts === H.pts && r.start.box.fta + r.bench.box.fta === H.fta &&
     r.start.box.pm + r.bench.box.pm === H.pm && r.start.box.oc.tPTS + r.bench.box.oc.tPTS === H.oc.tPTS, [H.pts, H.pm]);
  ok('...and the minutes to the engine\'s minutes', Math.abs(r.start.min + r.bench.min - H.min) < 1, [r.start.min + r.bench.min, H.min]);
  const late = V.gameSplit(G, 'H6', { Engine: E, regular: new Map() });
  ok('a player who did not start is found by his first substitution', late.ok && late.side === 0 && min(late.start.min + late.bench.min) === 2.33,
     late.ok && min(late.start.min + late.bench.min));
  ok('a game without both starting fives cannot be replayed, and says so', V.gameSplit({ id: 'x', starters: [st[0], []], events }, 'H1', { Engine: E }).why === 'starters');
  ok('nor one he never appeared in', V.gameSplit(G, 'Z9', { Engine: E }).why === 'absent');
  ok('without the engine nothing is guessed', V.gameSplit(G, 'H1', {}).why === 'engine');
}

/* ---- 4. the parts as season lines --------------------------------------------------- */
console.log('\n4. each part is a season line, by season.js itself');
{
  const sp = V.split([G, Object.assign({}, G, { id: 'g2' })], 'H1', { Engine: E, regular: new Map() });
  const L = V.lines(sp, S);
  ok('ALL is the two parts together', sp.all.min === sp.start.min + sp.bench.min && sp.all.box.pts === sp.start.box.pts + sp.bench.box.pts && sp.games === 2);
  ok('every part carries the season line\'s keys', ['ts', 'efg', 'usg', 'ast_pct', 'tov_pct', 'rim_a100', 'team_spacing', 'pf30', 'pts_p75'].every(k => k in L.start), Object.keys(L.start).length);
  const tsa = b => b.p2a + b.p3a + 0.44 * b.fta;
  const ts = b => Math.round(1000 * b.pts / (2 * tsa(b))) / 10;
  ok('a rate is the season line\'s formula over the part (TS%)', L.start.ts === ts(sp.start.box) && L.bench.ts === ts(sp.bench.box), [L.start.ts, ts(sp.start.box)]);
  const mpg = sp.all.min / 60000 / sp.games;
  ok('a per-game figure is his rate a minute times his minutes a game, so the parts compare with ALL',
     L.all.ppg === Math.round(10 * sp.all.box.pts / sp.games) / 10 &&
     L.start.ppg === Math.round(10 * sp.start.box.pts / (sp.start.min / 60000) * mpg) / 10, [L.all.ppg, L.start.ppg]);
  ok('minutes a game: ALL is his average; a part is the minutes of it against that unit', L.all.mpg === Math.round(10 * mpg) / 10 &&
     L.start.mpg === Math.round(10 * sp.start.min / 60000 / sp.games) / 10);
  ok('on/off, box plus/minus, the events splits and the rim defence are not split',
     ['diff_net', 'diff_ortg', 'bpm', 'vorp', 'ev_rim_astp', 'ev_ast_pts_sh', 'def_rim_fg_pm'].every(k => !V.splitable(k)) &&
     ['ts', 'pts_p75', 'usg', 'rim_a100', 'ppg', 'fg_pct'].every(k => V.splitable(k)));
  ok('a part he never played in is no line at all', V.lineOf({ min: 0, box: { oc: {} }, t3a: 0, o3a: 0, games: new Set() }, { min: 1, games: 1 }, S) === null);
}

/* ---- 5. placing a part in the league ------------------------------------------------- */
console.log('\n5. a part is ranked by season.js\'s own count');
{
  const rows = [3, 9, 1, 7, 7, 5, 12].map((v, i) => ({ id: 'p' + i, x: v }));
  const r = S.percentiles(rows, ['x'], [], null).get('x');
  const vals = V.sortedOf(rows, 'x');
  ok('a member\'s value lands where season.js percentiles() puts it', rows.every(q => Math.abs(V.placeIn(vals, q.x, false) - r.get(q.id)) < 1e-9));
  const rl = S.percentiles(rows, ['x'], ['x'], null).get('x');
  ok('...the other way up when less is better', rows.every(q => Math.abs(V.placeIn(vals, q.x, true) - rl.get(q.id)) < 1e-9));
  ok('a value that is nobody\'s is placed between them, and nothing is ranked against under three', V.placeIn(vals, 8, false) > V.placeIn(vals, 7, false) &&
     V.placeIn([1, 2], 1, false) === null && V.placeIn(vals, null, false) === null);
}

/* ---- 6. the profile -------------------------------------------------------------- */
console.log('\n6. the profile');
{
  const pjs = rd('epinoia', 'p', 'player.js');
  const html = rd('epinoia', 'p', 'index.html');
  const simple = pjs.slice(pjs.indexOf('const SIMPLE_SECTIONS = ['), pjs.indexOf('const BAR_GROUPS'));
  const keys = [...simple.matchAll(/\['([a-z0-9_]+)','([^']+)'\]/g)].map(m => m[1]);
  ok('simple view: the per-75 box score and the three shooting percentages (' + keys.length + ' bars)',
     JSON.stringify(keys.sort()) === JSON.stringify(V.P75.map(x => x[1]).concat(['fg_pct', 'p3_pct', 'ft_pct']).sort()), keys);
  ok('...in the same cards as the scouting view: scoring (with field goals, threes and free throws), rebounding, playmaking, defence',
     ["key: 'simple_scoring'", "title: 'field goals'", "key: 'simple_rebounding'", "key: 'simple_playmaking'", "key: 'simple_defence'"].every(s => simple.includes(s)));
  ok('scouting view is the bars as they were', /\(barsView === 'simple' \? SIMPLE_SECTIONS : BAR_SECTIONS\)\.map/.test(pjs) &&
     /\['ppg','PTS \/ GAME'\],\['ts','TS%'\]/.test(pjs));
  ok('turnovers and fouls per 75 rank lower-is-better', /'def_rim_fg_pm', 'def_rim_vol_pm', 'tov_p75', 'pf_p75'\];/.test(pjs));
  ok('every bar opens its chart: the per-75 figures are on every line of the league before it is ranked',
     /if \(VU\) field\.forEach\(VU\.per75\);/.test(pjs) && pjs.indexOf('field.forEach(VU.per75)') < pjs.indexOf('SE.percentiles(field, keys'));
  ok('...and a split bar\'s chart puts him at the split figure, the league at theirs',
     /statBind\(card, k, label, mine, pool, r => \(r\.id === mine\.id \? v : r\[k\]\)\)/.test(pjs) && /value: value \|\| k/.test(pjs));
  ok('the two switches: scouting / simple view, and all / vs. starters / vs. bench, each remembered',
     /\['scout', 'scouting view'\], \['simple', 'simple view'\]/.test(pjs) && /\['all', 'all'\], \['start', 'vs\. starters'\], \['bench', 'vs\. bench'\]/.test(pjs) &&
     /keep\('epinoia_bars_view', v\)/.test(pjs) && /keep\('epinoia_bars_vs', v\)/.test(pjs));
  ok('a split card: the part ranked among the same pool, a tick where all his minutes sit, the gap under it',
     /const p = VU\.placeIn\(vals, v, low\), pa = VU\.placeIn\(vals, a, low\);/.test(pjs) && /el\('b', 'bc-tick'\)/.test(pjs) && /' vs all his minutes'/.test(pjs));

  console.log('   nothing more is read until somebody asks');
  ok('the engine is not on the page; vsunits.js loads it from beside itself, with its stamp, on the first ask',
     !/src="\.\.\/engine\.js/.test(html) && /<script src="\.\.\/vsunits\.js\?v=\d+" defer><\/script>/.test(html) &&
     /s\.src = SELF\.replace\(\/vsunits\\\.js\(\\\?\.\*\)\?\$\/, 'engine\.js\$1'\)/.test(rd('epinoia', 'vsunits.js')));
  /* the player report's own read of the whole competition's logs (half-court AST%, ranked among the field) is set
     aside: it is made once, and only when the report asks for it */
  const pjsPage = pjs.replace(/fieldGames: \(\) => RP_FIELD[\s\S]*?\}\)\(\)\.catch\(\(\) => null\)\),/, '');
  ok('the split replays the games "on the floor with" already read: one read of the logs on the page',
     pjsPage !== pjs && (pjsPage.match(/D\.events\(/g) || []).length === 1 && /clubLogsDone\(\{ games: gs, byGame: logsOf/.test(pjs));
  ok('...the report reads the competition\'s logs once, and only when it is asked (half-court AST%)', /fieldGames: \(\) => RP_FIELD \|\| \(RP_FIELD = /.test(pjs));
  ok('...which now name their competition (for the scope) and period', /select=id,home_team_id,away_team_id,starters,tipoff_at,competition_id,period/.test(pjs));
  ok('the scope\'s starters are one read, kept for the page, and none for a competition past ' + 800 + ' games',
     /const VS_BIG = 800;/.test(pjs) && /if \(SCOPE_GAME_COUNT <= VS_BIG\)/.test(pjs) && /STARTERS_READ\.set\(key, p\)/.test(pjs));
  ok('worked out once per scope, then kept', /if \(VS_DONE\.has\(key\)\) return VS_DONE\.get\(key\);/.test(pjs));
  ok('the bars are drawn as ALL until the split is ready, and again when it is',
     /const vsOn = V && V\.state === 'ready' \? V : null;/.test(pjs) && /if \(LAST_BARS && barsVs !== 'all'\) paintBars\(LAST_BARS\.mine, LAST_BARS\.field\);/.test(pjs));
  ok('the wait always ends: the boot settles the logs whatever path it took', /\} finally \{\s*clubLogsDone\(null\);/.test(pjs));
  ok('without analytics, the switch shows what it would add instead', /if \(pLocked\('splits'\)\) \{\s*box\.innerHTML = accessTeaser\(/.test(pjs) &&
     /const unit = barsVs !== 'all' && !pLocked\('splits'\) && VU \? barsVs : null;/.test(pjs));
  ok('the club card\'s N is the profile\'s N', /localStorage\.getItem\('epinoia_vs_starters'\)/.test(pjs) && /'epinoia_vs_starters'/.test(rd('epinoia', 't', 'seasonline.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
