/* ============================================================================
   LEFT V RIGHT (epinoia/lvr.js): a player's shooting from each side of the floor, by distance, all of it or only his
   unassisted shots, over his whole career.

     node supabase/tests/lvr.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const LV = require(path.join(ROOT, 'epinoia', 'lvr.js'));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => a != null && Math.abs(a - b) <= e;

/* the court: 1500 x 1400 cm, the ring at (750, 157.5); x and y as fractions */
const at = (cmX, cmY) => ({ x: cmX / 1500, y: cmY / 1400 });

console.log('\nsides and distances');
{
  ok('x under the middle is his left, the middle and over it his right',
     LV.sideOf({ x: 0.49 }) === 'L' && LV.sideOf({ x: 0.5 }) === 'R' && LV.sideOf({ x: 0.8 }) === 'R');
  ok('a layup is at the rim', LV.bandOf(Object.assign(at(760, 200), { three: false })) === 'rim');
  ok('two metres out is a short two', LV.bandOf(Object.assign(at(750, 357.5), { three: false })) === 'short');
  ok('four metres out is mid-range', LV.bandOf(Object.assign(at(750, 557.5), { three: false })) === 'mid');
  ok('six metres out, inside the line, is a long two', LV.bandOf(Object.assign(at(750, 757.5), { three: false })) === 'long');
  ok('a three from the corner is a corner three', LV.bandOf(Object.assign(at(60, 150), { three: true })) === 'c3');
  ok('a three from the top is above the break', LV.bandOf(Object.assign(at(750, 900), { three: true })) === 'ab3');
  ok('the distance is metres from the ring', near(LV.distM(at(750, 457.5)), 3, 1e-9));
}

console.log('\nthe split, worked out by hand');
{
  const L = x => Object.assign(at(400, 600), x), Rr = x => Object.assign(at(1100, 600), x);
  const three = (side, x) => Object.assign(side === 'L' ? at(200, 900) : at(1300, 900), { three: true }, x);
  const shots = [
    L({ made: true, ast: true, ak: true }),          // left, assisted make
    L({ made: true, ast: false, ak: true }),         // left, his own make
    L({ made: false, ak: true }),                    // left miss
    three('L', { made: true, ast: false, ak: true }),// left three, his own
    Rr({ made: false, ak: true }),                   // right miss
    Rr({ made: true, ast: true, ak: true }),         // right, assisted
    Rr({ made: false, ak: false }),                  // right miss, a game with no assists logged
  ];
  const A = LV.split(shots);
  ok('every shot on its side', A.L.fga === 4 && A.R.fga === 3 && A.n === 7, JSON.stringify([A.L.fga, A.R.fga, A.n]));
  ok('eFG% counts a three as one and a half makes', near(A.L.efg, (3 + 0.5) / 4) && near(A.R.efg, 1 / 3), A.L.efg + ' ' + A.R.efg);
  ok('the left three is above the break, on the left', A.L.bands.ab3.a === 1 && A.L.bands.ab3.m === 1 && A.R.bands.ab3.a === 0);
  const U = LV.split(shots, { unassisted: true });
  /* of his four makes in games that log assists, two were his own: a miss of no telling type counts as half an attempt */
  ok('unassisted: his own makes whole, an assisted make not at all, a miss of no telling type at his makes’ rate, nothing from a game without assists',
     near(U.L.fga, 2.5) && U.L.fgm === 2 && near(U.R.fga, 0.5) && U.R.fgm === 0, JSON.stringify([U.L.fga, U.L.fgm, U.R.fga, U.R.fgm]));
  ok('...its eFG% from those shots', near(U.L.efg, (2 + 0.5) / 2.5) && near(U.R.efg, 0));
  const typed = shots.concat([L({ made: false, ak: true, st: 'pull-up' }), Rr({ made: false, ak: true, st: 'alley-oop' })]);
  const T = LV.split(typed, { unassisted: true });
  ok('a pull-up miss is wholly his own, an alley-oop miss not at all', near(T.L.fga, 3.5) && near(T.R.fga, 0.5), JSON.stringify([T.L.fga, T.R.fga]));
  ok('the unassisted shot chart draws every shot at least half his own',
     LV.unassistedShots(typed).length === 5, LV.unassistedShots(typed).length);
  const html = LV.cardHTML(A);
  ok('the card: both sides’ eFG% at the head, a row per distance with shots, the better side marked',
     /Left side/.test(html) && /Right side/.test(html) && /87\.5%/.test(html) && (html.match(/class="lvr-row"/g) || []).length === 2 &&
     /lvr-efg w/.test(html));
  ok('...nothing to draw says so', /lvr-none/.test(LV.cardHTML(LV.split([]), { empty: 'nothing' })));
  const mini = LV.miniHTML(A, U);
  ok('the condensed one: all shots and unassisted, each side’s eFG%', /All shots/.test(mini) && /Unassisted/.test(mini) && /87\.5%/.test(mini) && /83\.3%/.test(mini));
}

console.log('\nhis career, read from every game of his');
{
  /* two games: in g1 he (p1, and his linked profile p2 in g2) shoots twice; g2 logs no assists */
  const ev = (gameId, seq, t, extra) => Object.assign({ gameId, id: seq, seq, t, period: 1, clock: 500000 - seq * 1000 }, extra || {});
  const logs = {
    g1: [ev('g1', 1, 'p2_made', { pid: 'p1', team: 0 }), ev('g1', 2, 'loc', { ref: 1, x: 0.3, y: 0.3 }), ev('g1', 3, 'ast', { pid: 'p9', team: 0 }),
         ev('g1', 4, 'p3_miss', { pid: 'p1', team: 0 }), ev('g1', 5, 'loc', { ref: 4, x: 0.8, y: 0.6 }),
         ev('g1', 6, 'p2_made', { pid: 'p7', team: 1 }), ev('g1', 7, 'loc', { ref: 6, x: 0.5, y: 0.2 })],
    g2: [ev('g2', 1, 'p2_made', { pid: 'p2', team: 1 }), ev('g2', 2, 'loc', { ref: 1, x: 0.2, y: 0.25 })]
  };
  const asked = [];
  const D = {
    all: async q => { asked.push(q); return /player_uuid=in\.\(p1,p2\)|player_uuid=in\.\(p1,p7\)/.test(q)
      ? [{ game_id: 'g1', player_uuid: 'p1' }, { game_id: 'g2', player_uuid: 'p2' }, { game_id: 'g1', player_uuid: 'p7' }] : []; },
    events: async ids => ids.flatMap(id => logs[id] || [])
  };
  const SI = require(path.join(ROOT, 'epinoia', 'situations.js'));
  globalThis.window = globalThis.window || {};
  const SC = require(path.join(ROOT, 'epinoia', 'shotchart.js'));
  const C = await LV.career({ D, pids: ['p2', 'p1'], SI, SC });
  ok('both his profiles’ shots, from both games, and nobody else’s', C.shots.length === 3 && C.games === 2, JSON.stringify(C));
  ok('the assisted make is marked; the game without assists is known to have none',
     C.shots.filter(s => s.ast).length === 1 && C.shots.filter(s => !s.ak).length === 1 && C.gamesWithAssists === 1);
  ok('his games are asked for once, final games only', asked.length === 1 && /games\.status=eq\.final/.test(asked[0]), asked.join(' | '));
  const C2 = await LV.career({ D, pids: ['p1', 'p2'], SI, SC });
  ok('...and kept for the visit', C2 === C && asked.length === 1);
  const M = await LV.careers({ D, pids: ['p1', 'p7'], SI, SC });
  ok('a squad at once: each player’s own shots, the game read once', M.get('p1').shots.length === 2 && M.get('p7').shots.length === 1 && M.get('p1').games === 1 && M.get('p7').games === 1,
     JSON.stringify([...M.entries()].map(([k, v]) => [k, v.shots.length, v.games])));
}

console.log('\nwhere it is drawn');
{
  const html = read('epinoia', 'p', 'index.html'), pjs = read('epinoia', 'p', 'player.js');
  ok('the profile loads it, and its card sits in Full advanced stats',
     /lvr\.js\?v=\d+/.test(html) && /kit\/lvr\.css\?v=\d+/.test(html) && /data-pgrp-key="advanced"[\s\S]*id="lvrSec"[\s\S]*data-pgrp-key="career"/.test(html));
  ok('...always his career, whatever the scope; read when it comes on screen; the shot zones’ lock',
     /CAREER_SRC = \{ me: pl\.id, pids: careerIds \}/.test(pjs) && /new IntersectionObserver/.test(pjs) && /pLocked\('shotZones'\)/.test(pjs));
  ok('the bars switch between this season and all seasons, his career line in his season line’s place',
     /\['season', 'this season'\], \['career', 'all seasons'\]/.test(pjs) && /field\.map\(r => \(r\.id === mine\.id \? c : r\)\)/.test(pjs) &&
     /gameIds: gids, alias, allowBig: true/.test(pjs));
  const pr = read('epinoia', 'report-playerpages.js'), tr = read('epinoia', 'report-teampages.js');
  ok('the player report has a page of its own: all shots, unassisted, the unassisted shot chart',
     /key: 'lvr', title: 'Left v right', page: 'LEFT V RIGHT'/.test(pr) && /return \[cover, main, shots, lvr, conn, floor, wkg, week, ins, legend\]/.test(pr) &&
     /Unassisted shot chart/.test(pr));
  ok('the club report’s player cards: the condensed one where there is no Synergy file',
     /LV\.careers\(\{ D: root\.EpinoiaData, pids: noSyn \}\)/.test(tr) && /\|\| lvMini \|\|/.test(tr) && /lvr\.js\?v=\d+/.test(read('epinoia', 't', 'index.html')));
  const dj = read('epinoia', 'data.js');
  ok('a long list of games is read a hundred at a time', /only && only\.length > 100/.test(dj));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
