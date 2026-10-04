// ONE GAME'S BPM, AS BASKETBALL-REFERENCE ADAPTS BPM 2.0 TO A GAME (2026-10-04; epinoia/bpm.js game, about/bpm2.html "game-level BPM").
// What is held here:
//   * BBRef's own worked example: both sides' players at +10 by their season BPMs, a +12 margin with a +5 average lead ->
//     team ratings of +16.9 and +3.1 for the game (each side's minute-weighted mean BPM is its rating x 1.2 / 5, which the
//     team adjustment makes exactly so);
//   * position and offensive role are the SEASON's, not the game's;
//   * a season BPM from few minutes is regressed to the minutes' estimate, weighted (450 - minutes) / 3, and that estimate's
//     level is the competition's own (a season two games old does not drag every game's BPM down);
//   * no season at all: the game's own margin, as the box score estimate always was; one side's lines only: nothing;
//   * the engine keeps each side's average lead over the game (engine.js teamAdv avgLead), which the lead correction reads;
//   * every page that prints one game's BPM asks this one function: the game page's circles and the modern box, the player's
//     game log, the graphics' player of the game, stars and leaders.
//
//   node supabase/tests/game-bpm.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'epinoia', 'bpm.js'));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* five a side, forty minutes each (each a whole position's share), ordinary lines */
const line = (id, side, o = {}) => ({ id, side, stats: Object.assign({ min: 40 * 60000, pts: 14, p2m: 4, p2a: 9, p3m: 1, p3a: 4, ftm: 3, fta: 4, or: 1, dr: 4, ast: 3, stl: 1, blk: 0, to: 2, pf: 2 }, o) });
const lines = [0, 1, 2, 3, 4].map(i => line('h' + i, 0)).concat([0, 1, 2, 3, 4].map(i => line('a' + i, 1)));
const meanOf = (m, side) => { const ids = [0, 1, 2, 3, 4].map(i => (side ? 'a' : 'h') + i); return ids.reduce((a, id) => a + m.get(id).bpm, 0) / ids.length; };

console.log('\nBasketball-Reference\'s worked example');
{
  /* every player's season BPM +2 over 600 minutes (no regression): each side's players at 5 x 2 = +10 */
  const season = new Map(lines.map(l => [l.id, { bpm: 2, min: 600, gp: 20, bpm_pos: 3, bpm_role: 3 }]));
  const clubs = [{ pace: 100, ortg: 112, drtg: 100, avgLead: 5 }, { pace: 100, ortg: 100, drtg: 112, avgLead: -5 }];
  const m = B.game({ lines, clubs, season });
  const r0 = 10 + 12 / 2 + (0.35 / 2) * 5, r1 = 10 - 12 / 2 - (0.35 / 2) * 5;
  ok('the winning side\'s rating is +16.9 (BBRef: +10 + 12/2 + 0.35/2 x 5): its minute-weighted mean BPM is 16.9 x 1.2 / 5', Math.abs(r0 - 16.875) < 1e-9 && Math.abs(meanOf(m, 0) - r0 * 1.2 / 5) < 0.06, [meanOf(m, 0), r0 * 1.2 / 5]);
  ok('...and the losing side\'s +3.1 (+10 - 6 - 0.875)', Math.abs(meanOf(m, 1) - r1 * 1.2 / 5) < 0.06, [meanOf(m, 1), r1 * 1.2 / 5]);
  const noLead = B.game({ lines, clubs: clubs.map(c => Object.assign({}, c, { avgLead: 0 })), season });
  /* (a difference of two means of BPMs each rounded to 0.1: within 0.1) */
  ok('the lead correction: 0.35 per 100 possessions for every point of average lead, half to each side', Math.abs((meanOf(m, 0) - meanOf(noLead, 0)) - (0.35 / 2) * 5 * 1.2 / 5) <= 0.1 && meanOf(m, 0) > meanOf(noLead, 0) && meanOf(m, 1) < meanOf(noLead, 1), [meanOf(m, 0) - meanOf(noLead, 0), (0.35 / 2) * 5 * 1.2 / 5]);
  const better = new Map([...season].map(([k, v]) => [k, Object.assign({}, v, { bpm: k[0] === 'h' ? 4 : 2 })]));
  const mb = B.game({ lines, clubs, season: better });
  ok('the players who played decide the sides\' level: better home players (+20 against +10) lift both ratings by half the difference', Math.abs((meanOf(mb, 0) - meanOf(m, 0)) - 5 * 1.2 / 5) <= 0.1 && Math.abs((meanOf(mb, 1) - meanOf(m, 1)) - 5 * 1.2 / 5) <= 0.1, [meanOf(mb, 0) - meanOf(m, 0), meanOf(mb, 1) - meanOf(m, 1)]);
}

console.log('\nthe season\'s position and role');
{
  const big = lines.map(l => (l.id === 'h0' ? line('h0', 0, { or: 5, dr: 9, blk: 3, ast: 0 }) : l));
  const season = new Map(big.map(l => [l.id, { bpm: 0, min: 600, gp: 20, bpm_pos: 3, bpm_role: 3 }]));
  const clubs = [{ pace: 100, ortg: 105, drtg: 100, avgLead: 2 }, { pace: 100, ortg: 100, drtg: 105, avgLead: -2 }];
  const asGuard = B.game({ lines: big, clubs, season: new Map([...season].map(([k, v]) => [k, k === 'h0' ? Object.assign({}, v, { bpm_pos: 1, bpm_role: 2 }) : v])) }).get('h0').bpm;
  const asBig = B.game({ lines: big, clubs, season: new Map([...season].map(([k, v]) => [k, k === 'h0' ? Object.assign({}, v, { bpm_pos: 5, bpm_role: 4 }) : v])) }).get('h0').bpm;
  ok('the same game line reads differently for a season-long guard and a season-long centre (the season\'s position, not the game\'s)', asGuard !== asBig, [asGuard, asBig]);
}

console.log('\nfew minutes, regressed - at the competition\'s own level');
{
  ok('past 450 minutes a season BPM stands', B.regressedSeasonBPM({ bpm: 5, min: 600, gp: 20 }) === 5);
  ok('100 minutes in 10 games: (100 x 5 + 116.7 x (-4.75 + 0.175 x 100/14)) / 216.7 = +0.42', Math.abs(B.regressedSeasonBPM({ bpm: 5, min: 100, gp: 10 }) - 0.4231) < 0.001);
  ok('no season row: the estimate alone (-4.75)', B.regressedSeasonBPM(null) === -4.75);
  /* a season two games old: everyone under 450 minutes, the competition's mean BPM 0 */
  const early = new Map();
  for (let i = 0; i < 60; i++) early.set('p' + i, { bpm: (i % 7) - 3, min: 20 + (i % 5) * 10, gp: 2 });
  const c = B.calibration(early);
  let w = 0, e = 0, b = 0;
  early.forEach(r => { w += r.min; b += r.min * r.bpm; e += r.min * B.regressedSeasonBPM(Object.assign({}, r, { bpm: null }), c); });
  ok('the estimate\'s level is the competition\'s: its minute-weighted mean estimate is the mean season BPM', Math.abs(e / w - b / w) < 1e-9 && c > 2, [c, e / w, b / w]);
  const sides = lines.map(l => [l.id, { bpm: 0, min: 50, gp: 2, bpm_pos: 3, bpm_role: 3 }]);
  const flat = new Map(sides.concat([...early]));
  const m = B.game({ lines, clubs: [{ pace: 100, ortg: 100, drtg: 100, avgLead: 0 }, { pace: 100, ortg: 100, drtg: 100, avgLead: 0 }], season: flat });
  ok('...so an even game two games into a season reads level, not every player three points down', Math.abs(meanOf(m, 0)) < 0.6 && Math.abs(meanOf(m, 1)) < 0.6, [meanOf(m, 0), meanOf(m, 1)]);
}

console.log('\nwithout what it needs');
{
  const boxOnly = B.game({ lines });
  ok('no season and no club lines: the box score\'s own estimate, which gameFromBox still is', JSON.stringify([...boxOnly]) === JSON.stringify([...B.gameFromBox(lines)]) && boxOnly.size === 10);
  ok('one side\'s lines only: nothing', B.game({ lines: lines.filter(l => l.side === 0) }).size === 0);
  ok('a player who did not play has none', !B.game({ lines: lines.concat([line('dnp', 0, { min: 0 })]) }).has('dnp'));
}

console.log('\nthe average lead, kept by the engine');
{
  const eng = read('epinoia', 'engine.js');
  ok('every play adds the margin, times the game time it stood, to the home side\'s lead (to the end of the game)', /if \(cum > leadAt\) \{ d\.leadInt \+= \(d\.score\[0\] - d\.score\[1\]\) \* \(cum - leadAt\); leadAt = cum; \}/.test(eng) &&
     /if \(nowCum > leadAt\) \{ d\.leadInt \+= \(d\.score\[0\] - d\.score\[1\]\) \* \(nowCum - leadAt\); leadAt = nowCum; \}/.test(eng) && /d\.leadMs = leadAt;/.test(eng));
  ok('...and the club line says each side\'s average lead (home\'s, the away side\'s the other way)', /avgLead: d\.leadMs > 0 \? \(t === 0 \? 1 : -1\) \* d\.leadInt \/ d\.leadMs : 0/.test(eng));
  ok('the Edge Function\'s copy of the engine is the same (finalising a game stores the line with it)', read('supabase', 'functions', '_shared', 'engine.js').includes('avgLead: d.leadMs > 0'));
}

console.log('\nevery page asks the one function');
{
  const game = read('epinoia', 'game', 'game.js'), modern = read('epinoia', 'game', 'modern.js'), player = read('epinoia', 'p', 'player.js');
  const sc = read('epinoia', 'socialcard.js'), gfx = read('epinoia', 'admin', 'socialgfx-ui.js');
  ok('the game page: the game\'s lines, the engine\'s club lines and the competition\'s season', /BPM\.game\(\{ lines, clubs, season \}\)/.test(game) && /clubs = \[E\.teamAdv\(S, d, 0\), E\.teamAdv\(S, d, 1\)\]/.test(game) && /MB\.season \? MB\.season\(\)/.test(game));
  ok('...the season loaded for the report\'s circles too, and the page drawn again when it is here', /ensureSeasonPositions\(\);\n    const strip = squadsHTML\(d\);/.test(game) && /fTab === 'report'\)\) \{ lastBodyKey = ''; renderBody\(\); \}/.test(game));
  ok('the modern box prints the same figure (its own estimate only places the players)', /bpmByPid = window\.EpinoiaGameBPM\(d\)/.test(modern) && /season: \(\) => seasonRows/.test(modern));
  ok('the player\'s game log: with the clubs\' lines and each game\'s competition\'s season', /B\.game\(\{ lines: byGame\.get\(r\.game_id\) \|\| \[\], clubs: cl && cl\[0\] && cl\[1\] \? cl : null,/.test(player) && /avgLead:stats->adv->avgLead/.test(player));
  ok('the graphics (player of the game, stars, leaders): the same function, the season travelling with each game\'s club lines', /B\.game\(\{ lines: rows\.map/.test(sc) && /season = season \|\| \(teamAdv && teamAdv\.season\) \|\| null;/.test(sc) &&
     /await withSeasons\(out\.teamAdv, out\.finals\);/.test(gfx) && /player_uuid,player_id,/.test(gfx));
  ok('...the console page has the season reader (data.js)', /<script src="\.\.\/data\.js\?v=\d+" defer><\/script>/.test(read('epinoia', 'admin', 'index.html')));
  /* the graphics' gameBPMs is bpm.js game for the same game */
  const SC = (await import(path.join(ROOT, 'epinoia', 'socialcard.js'))).default || globalThis.EpinoiaSocialCard;
  globalThis.EpinoiaBPM = B;
  const rows = lines.map(l => ({ team_idx: l.side, player_uuid: l.id, stats: l.stats }));
  const season = new Map(lines.map(l => [l.id, { bpm: 1, min: 300, gp: 10, bpm_pos: 3, bpm_role: 3 }]));
  const adv = [{ pace: 90, ortg: 108, drtg: 101, avgLead: 3 }, { pace: 90, ortg: 101, drtg: 108, avgLead: -3 }];
  Object.defineProperty(adv, 'season', { value: season });
  const viaCard = SC && SC.gameBPMs ? SC.gameBPMs(rows, adv) : null, direct = B.game({ lines, clubs: adv, season });
  ok('a graphic\'s BPM for a player is the game page\'s, to the decimal', !!viaCard && rows.every(r => viaCard.get(r) === direct.get(r.player_uuid).bpm), viaCard && rows.map(r => [viaCard.get(r), direct.get(r.player_uuid).bpm]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
