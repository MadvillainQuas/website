/* ============================================================================
   CLUTCH TIME, WORKED OUT FROM THE PLAY-BY-PLAY (epinoia/clutch.js) AND THE
   CLUB REPORT'S CLUTCH PAGE (report-teampages.js, migration 0238).

     node supabase/tests/clutch.test.mjs

   What would go wrong quietly:
     1. the rule read the wrong way round: the clock (ms LEFT), the margin GOING IN
        to a play rather than after it, overtime left out
     2. clutch seconds and minutes on the floor not adding up (a change of five in
        clutch time, the time after the last play)
     3. usage worked out on the whole game instead of the time the player was on
     4. a blowout counted as a clutch game
     5. the page not loading the module, or the career FT% open to anyone
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
const near = (a, b, e) => a != null && Math.abs(a - b) <= (e || 0.05);

const C = require(path.join(ROOT, 'epinoia', 'clutch.js'));

/* ---- 1. the rule ------------------------------------------------------------- */
console.log('\n1. the rule: last four minutes of the fourth or overtime, within five');
ok('4th, 3:59 left, up 5: clutch', C.isClutch(4, 239000, 5));
ok('4th, 4:00 left exactly: clutch', C.isClutch(4, 240000, -3));
ok('4th, 4:01 left: not yet', !C.isClutch(4, 241000, 0));
ok('4th, up 6: not close', !C.isClutch(4, 60000, 6));
ok('3rd, last minute, tied: not the 4th', !C.isClutch(3, 30000, 0));
ok('overtime, the whole of it', C.isClutch(5, 300000, -4) && C.isClutch(6, 10000, 0));
ok('a rule of its own (2:00, within 3)', C.isClutch(4, 110000, 3, { fromMs: 120000, margin: 3 }) &&
   !C.isClutch(4, 130000, 0, { fromMs: 120000, margin: 3 }));
ok('a game in halves: the last four minutes of the second half', C.isClutch(2, 200000, 0, null, 2) && !C.isClutch(2, 300000, 0, null, 2) && C.isClutch(3, 300000, 0, null, 2));

/* ---- 2. one close game ------------------------------------------------------- */
console.log('\n2. a close game, replayed');
const H = ['a1', 'a2', 'a3', 'a4', 'a5'], A = ['b1', 'b2', 'b3', 'b4', 'b5'];
let seq = 0;
const ev = (period, clock, team, t, more) => Object.assign({ id: 'e' + (++seq), seq, period, clock, team, t }, more || {});
const close = {
  id: 'g1', starters: [H, A], period: 4,
  events: [
    ev(1, 500000, 0, 'p2_made', { pid: 'a1' }),                // 2-0, not clutch (1st)
    ev(4, 300000, 1, 'p3_made', { pid: 'b1' }),                // 2-3, not clutch (5:00 left)
    ev(4, 200000, 0, 'p3_made', { pid: 'a2' }),                // going in -1: clutch, 5-3
    ev(4, 200000, 0, 'loc', { ref: 'e3', x: 0.5, y: 0.5 }),    // a descriptor, never a play
    ev(4, 180000, 0, 'sub', { out: 'a5', in: 'a6' }),
    ev(4, 150000, 1, 'to', { pid: 'b2' }),                      // clutch
    ev(4, 100000, 0, 'ft_made', { pid: 'a6' }),                 // going in 2: 6-3
    ev(4, 100000, 0, 'ft_made', { pid: 'a6' }),                 // going in 3: 7-3
    ev(4, 60000, 0, 'p2_miss', { pid: 'a1' }),
    ev(4, 59000, 1, 'reb', { pid: 'b3' }),
    ev(4, 30000, 1, 'p2_made', { pid: 'b3' })                   // 7-5
  ]
};
const G = C.clutchGame(close, 0);
ok('the replay worked', G.ok, G.reason);
ok('four minutes of clutch time (4:00 to the buzzer)', near(G.dur, 240), G.dur);
ok('the plays before 4:00 left are not in it', !G.seqs.has(1) && !G.seqs.has(2), [...G.seqs]);
ok('the clutch plays are (the descriptor is not)', [3, 6, 7, 8, 9, 10, 11].every(s => G.seqs.has(s)) && !G.seqs.has(4), [...G.seqs]);
ok('own box: 5 pts, 2 FGA (1 made, a three), 2/2 FT',
   G.own.pts === 5 && G.own.fga === 2 && G.own.fgm === 1 && G.own.p3m === 1 && G.own.fta === 2 && G.own.ftm === 2, G.own);
ok('their box: 2 pts, a turnover, a defensive rebound', G.opp.pts === 2 && G.opp.tov === 1 && G.opp.dr === 1, G.opp);
ok('a5 played the first minute of it, a6 the other three', near(G.players.a5.sec, 60) && near(G.players.a6.sec, 180), [G.players.a5.sec, G.players.a6.sec]);
ok('a1 played all four', near(G.players.a1.sec, 240), G.players.a1.sec);
ok('a1\'s usage: 1 of the 2.88 plays while on', near(C.usage(G.players.a1), 100 / 2.88, 0.1), C.usage(G.players.a1));
ok('a6\'s usage: 0.88 of the 1.88 while on (the three before he came on is not his)', near(C.usage(G.players.a6), 100 * 0.88 / 1.88, 0.1), C.usage(G.players.a6));
const fives = Object.values(G.fives);
ok('two fives, their seconds add up to the clutch time', fives.length === 2 && near(fives.reduce((s, f) => s + f.sec, 0), 240), fives.map(f => [f.ids.join(), f.sec]));
const late = fives.find(f => f.ids.includes('a6'));
ok('the second five: 2 for, 2 against (a6\'s free throws, b3\'s two); the first had the three', late && late.own.pts === 2 && late.opp.pts === 2 && fives.find(f => f.ids.includes('a5')).own.pts === 3,
   fives.map(f => [f.ids.join(), f.own.pts, f.opp.pts]));
const G1 = C.clutchGame(close, 1);
ok('the other side sees the same time and the boxes the other way round', near(G1.dur, 240) && G1.own.pts === 2 && G1.opp.pts === 5, [G1.dur, G1.own.pts, G1.opp.pts]);

/* ---- 3. a blowout, a late comeback, overtime --------------------------------- */
console.log('\n3. a blowout, a late comeback into range, overtime');
seq = 0;
const blow = { id: 'g2', starters: [H, A], period: 4, events: [
  ev(1, 500000, 0, 'p3_made', { pid: 'a1' }), ev(1, 400000, 0, 'p3_made', { pid: 'a1' }), ev(1, 300000, 0, 'p3_made', { pid: 'a1' }),
  ev(2, 300000, 0, 'p3_made', { pid: 'a2' }), ev(3, 300000, 0, 'p3_made', { pid: 'a2' }),
  ev(4, 100000, 1, 'p2_made', { pid: 'b1' }), ev(4, 20000, 0, 'p2_miss', { pid: 'a3' })
] };
const B = C.clutchGame(blow, 0);
ok('15-0 into the last minutes: no clutch time, no clutch plays', B.ok && B.dur === 0 && B.seqs.size === 0, [B.dur, [...B.seqs]]);
seq = 0;
const back = { id: 'g3', starters: [H, A], period: 4, events: [
  ev(4, 300000, 0, 'p3_made', { pid: 'a1' }), ev(4, 290000, 0, 'p3_made', { pid: 'a1' }),   // 6-0 at 4:50
  ev(4, 120000, 1, 'p2_made', { pid: 'b1' }),                                                // going in 6: not clutch, now 6-2
  ev(4, 60000, 0, 'p2_miss', { pid: 'a2' })                                                  // going in 4: clutch
] };
const K = C.clutchGame(back, 0);
ok('a 6-point game is not clutch until it is within 5: 2:00 of clutch time from the basket', near(K.dur, 120), K.dur);
ok('only the play after the cut counts', K.seqs.size === 1 && K.seqs.has(4) && K.own.fga === 1 && K.opp.pts === 0, [[...K.seqs], K.own, K.opp]);
seq = 0;
const ot = { id: 'g4', starters: [H, A], period: 5, events: [
  ev(4, 1000, 1, 'p2_made', { pid: 'b1' }),
  ev(5, 200000, 0, 'p2_made', { pid: 'a1' }),
  ev(5, 100000, 1, 'p3_made', { pid: 'b2' })
] };
const O = C.clutchGame(ot, 0);
ok('overtime is clutch from the start to its buzzer: 4:00 + 5:00', near(O.dur, 540), O.dur);
ok('and its plays count', O.own.pts === 2 && O.opp.pts === 5, [O.own.pts, O.opp.pts]);
seq = 0;
const halves = { id: 'g5', starters: [H, A], period: 2, events: [
  ev(1, 1100000, 0, 'p2_made', { pid: 'a1' }),                // a 20-minute half: the log says halves
  ev(2, 300000, 1, 'p2_made', { pid: 'b1' }),                 // 5:00 left: not yet
  ev(2, 200000, 1, 'p3_made', { pid: 'b2' })                  // 3:20 left: clutch
] };
const Hv = C.clutchGame(halves, 0);
ok('a game in halves: clutch time is the last four minutes of the second half', Hv.ok && near(Hv.dur, 240) && Hv.seqs.size === 1 && Hv.opp.pts === 3, [Hv.dur, [...Hv.seqs], Hv.opp.pts]);

/* ---- 4. the season ----------------------------------------------------------- */
console.log('\n4. a season of them');
const S = C.season([{ game: close, side: 0 }, { game: blow, side: 0, won: true }, { game: back, side: 0, won: true },
                    { game: { id: 'bad', starters: [[], []], events: [] }, side: 0 }]);
ok('three games read, two with clutch time, the broken one skipped', S.of === 3 && S.games === 2, [S.of, S.games]);
ok('the time and the boxes are summed', near(S.dur, 360) && S.own.pts === 5 && S.own.fga === 3, [S.dur, S.own]);
ok('a player\'s clutch games are the ones he played clutch time in', S.players.a6.games === 1 && S.players.a1.games === 2, [S.players.a6.games, S.players.a1.games]);
ok('the clutch record counts only clutch games (a result not given is read off the log: 7-5)', S.wins === 2 && S.losses === 0, [S.wins, S.losses]);
ok('the log\'s final score', G.final[0] === 7 && G.final[1] === 5 && G1.final[0] === 5, [G.final, G1.final]);
const R = C.ratings({ pts: 10, fga: 8, or: 0, tov: 2, fta: 0 }, { pts: 8, fga: 9, or: 1, tov: 0, fta: 0 });
ok('ratings per 100 on the average of both sides\' possessions', near(R.poss, 9) && near(R.ortg, 111.1, 0.1) && near(R.drtg, 88.9, 0.1) && near(R.net, 22.2, 0.1), R);
const sh = C.shooting({ pts: 10, fga: 6, fgm: 3, p3m: 1, fta: 4, ftm: 3 });
ok('shooting: eFG%, TS%, FT%', near(sh.efg, 58.3, 0.1) && near(sh.ts, 100 * 10 / (2 * 7.76), 0.1) && near(sh.ft, 75), sh);
ok('nothing to read is no number, not zero', C.ratings({ pts: 0, fga: 0, or: 0, tov: 0, fta: 0 }, { pts: 0, fga: 0, or: 0, tov: 0, fta: 0 }).ortg === null &&
   C.shooting({ pts: 0, fga: 0, fta: 0 }).ts === null && C.usage({ use: 0 }) === null);

/* ---- 5. the page and the database -------------------------------------------- */
console.log('\n5. the club report and the career free-throw %');
const TP = rd('epinoia', 'report-teampages.js');
ok('the report has a clutch page', /key:\s*'clutch'/.test(TP));
ok('it reads EpinoiaClutch', /EpinoiaClutch/.test(TP));
ok('it draws the career FT% from player_career_ft', /player_career_ft/.test(TP));
ok('the career FT% is entered through set_career_ft', /set_career_ft/.test(TP));
const pages = ['epinoia/t/report/index.html', 'epinoia/t/index.html'].filter(p => fs.existsSync(path.join(ROOT, p)) && /report-teampages\.js/.test(rd(p)));
ok('every page that loads the club report loads clutch.js first', pages.length > 0 && pages.every(p => {
  const s = rd(p), i = s.indexOf('clutch.js'), j = s.indexOf('report-teampages.js');
  return i > 0 && i < j;
}), pages);
const M = rd('supabase', 'migrations', '0238_career_ft.sql');
ok('0238: anyone can read a career FT%', /for select to anon, authenticated using \(true\)/.test(M));
ok('0238: nobody writes the table directly', /revoke all on public\.player_career_ft from anon, authenticated/.test(M) && !/grant (insert|update|delete)/i.test(M));
ok('0238: only a platform administrator can set one', /is_platform_admin\(\)/.test(M) && /security definer/.test(M));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
