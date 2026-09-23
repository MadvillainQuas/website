/* ============================================================================
   SHOT CLOCK — when each side gained the ball, when its chance ended, and what
   the chances ending in a window of the clock produced (epinoia/shotclock.js,
   on possessions.js's gain timing).

   First a game small enough to work out by hand, where every rule has a play:
   the period's first possession, a made basket, a defensive rebound, a turnover
   with its steal, an and-one, a free-throw trip whose missed last free throw the
   offence won back, a log gap, a new period. Then three real LiveStats games
   through the ingest's own translator, where the points, attempts and turnovers
   of the chances must be the engine's box score to the unit, and the chances
   must be the events tab's chances.

     node supabase/tests/shotclock.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
globalThis.EpinoiaPossessions = require(path.join(ROOT, 'epinoia', 'possessions.js'));
globalThis.EpinoiaSituations = require(path.join(ROOT, 'epinoia', 'situations.js'));
const SC = require(path.join(ROOT, 'epinoia', 'shotclock.js'));
const Sit = globalThis.EpinoiaSituations;
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) <= e;

/* ---- a game small enough to do by hand ------------------------------------ */
const S = { teams: [{ name: 'Home', players: [] }, { name: 'Away', players: [] }], starters: [[], []], events: [] };
let seq = 0;
const ev = (t, team, clock, extra, period) => {
  const s = ++seq;
  S.events.push(Object.assign({ id: s, seq: s, t, team, pid: team == null ? null : (team ? 'a1' : 'h1'), period: period || 1, clock }, extra || {}));
  return s;
};
ev('period_start', null, 600000);
ev('p2_made', 0, 590000);                              // A1  first of the period: 10 s from 10:00
ev('p3_miss', 1, 575000);                              // B1  15 s after the basket
ev('reb', 0, 573000, { off: false });                  //     ... won by the defence
ev('to', 0, 565000);                                   // A2  8 s after that defensive rebound
ev('stl', 1, 565000);
ev('p2_made', 1, 562000);                              // B2  3 s after the steal
ev('p2_miss', 0, 550000);                              // A3  12 s after the basket
ev('reb', 0, 548000, { off: true });                   //     won back by the offence
ev('p2_made', 0, 547000);                              // A3b a second chance: never in a window
ev('foul', 1, 547000, { kind: 'shooting' });           //     and one
ev('ft_made', 0, 547000);                              //     ... the free throw is the basket's
ev('foul', 0, 530000, { kind: 'personal' });           // B3  a trip to the line, 17 s after the and-one
ev('ft_made', 1, 530000);
ev('ft_miss', 1, 530000);                              //     the last one missed
ev('reb', 1, 529000, { off: true });                   //     ... and won back: the trip is still a chance
ev('p3_made', 1, 520000);                              // B3b the second chance, 9 s after that rebound
ev('p2_miss', 0, 460000);                              // A4  60 s after the three: a gap in the log
ev('reb', 1, 458000, { off: false });
ev('p2_made', 1, 440000);                              // B4  18 s after the defensive rebound
ev('period_start', null, 600000, null, 2);
ev('p2_miss', 1, 595000, null, 2);                     // B5  a new period's first: 5 s from 10:00
ev('reb', 0, 593000, { off: false }, 2);
ev('game_end', null, 0, null, 2);

console.log('a game worked out by hand');
{
  const R = SC.compute(S);
  const mine = t => R.chances.filter(r => r.team === t);
  const firsts = t => mine(t).filter(r => !r.second);
  const durs = t => firsts(t).map(r => r.dur);
  ok('home first chances run 10, 8 and 12 s, and the one after a 60 s gap is untimed',
     JSON.stringify(durs(0)) === JSON.stringify([10, 8, 12, null]), JSON.stringify(durs(0)));
  ok('away first chances run 15, 3, 17, 18 and 5 s',
     JSON.stringify(durs(1)) === JSON.stringify([15, 3, 17, 18, 5]), JSON.stringify(durs(1)));
  ok('where each began: the period, the basket, the rebound, the steal',
     JSON.stringify(firsts(0).map(r => r.gainedBy)) === JSON.stringify(['period', 'dreb', 'change', 'change']) &&
     JSON.stringify(firsts(1).map(r => r.gainedBy)) === JSON.stringify(['change', 'change', 'change', 'dreb', 'period']),
     JSON.stringify([firsts(0).map(r => r.gainedBy), firsts(1).map(r => r.gainedBy)]));
  const sec = t => mine(t).filter(r => r.second);
  ok('each side has one second chance, clocked from its offensive rebound (1 s and 9 s)',
     sec(0).length === 1 && sec(1).length === 1 && sec(0)[0].dur === 1 && sec(1)[0].dur === 9,
     JSON.stringify([sec(0).map(r => r.dur), sec(1).map(r => r.dur)]));
  ok('the and-one free throw belongs to the basket: a 3-point second chance',
     sec(0)[0].pts === 3 && sec(0)[0].ftm === 1 && sec(0)[0].fgm === 1);
  const trip = firsts(1)[2];
  ok('a free-throw trip whose last free throw was rebounded by the offence is a chance of its own (1 pt, 2 FTA)',
     trip.pts === 1 && trip.fta === 2 && trip.fga === 0 && trip.reb === 'off', JSON.stringify(trip));
  ok('... and its free throws are not counted into an earlier chance of the side',
     firsts(1)[1].fta === 0 && firsts(1)[0].fta === 0);
  ok('who won each miss: A3 and the trip by the offence, B1, A4 and B5 by the defence',
     firsts(0)[2].reb === 'off' && firsts(0)[3].reb === 'def' && firsts(1)[0].reb === 'def' && firsts(1)[4].reb === 'def' &&
     firsts(0)[0].reb === null && firsts(1)[1].reb === null);
  ok('the chances\' points are the score (5-8)',
     mine(0).reduce((n, r) => n + r.pts, 0) === 5 && mine(1).reduce((n, r) => n + r.pts, 0) === 8);

  /* windows */
  const win = (t, lo, hi) => mine(t).filter(r => SC.inWindow(r, lo, hi));
  ok('8-16 s keeps both its ends (A2 at 8) and never a second chance',
     win(0, 8, 16).map(r => r.dur).join() === '10,8,12' && win(1, 8, 16).map(r => r.dur).join() === '15');
  ok('16-24 s holds B3 and B4; an untimed chance is in no window',
     win(1, 16, 24).map(r => r.dur).join() === '17,18' && !mine(0).some(r => r.dur == null && SC.inWindow(r, 0, 24)));
  ok('the top of the slider has no ceiling', SC.inWindow({ second: false, dur: 31 }, 20, 24) && !SC.inWindow({ second: false, dur: 31 }, 20, 23));
  ok('the histogram counts first chances by the second', (() => { const h = SC.histogram(mine(1)); return h[3] === 1 && h[5] === 1 && h[15] === 1 && h[17] === 1 && h[18] === 1 && h.reduce((a, b) => a + b, 0) === 5; })());

  /* the four factors of a window */
  const s = SC.summary(win(0, 8, 16));
  ok('home 8-16 s: 3 chances, 2 pts, eFG 50%, a turnover in three, every miss won back, no free throws',
     s.n === 3 && s.pts === 2 && near(s.ppp, 2 / 3) && near(s.efg, 0.5) && near(s.tovPct, 1 / 3) && near(s.orebPct, 1) && near(s.ftr, 0) && near(s.avgDur, 10),
     JSON.stringify(s));
  const all0 = SC.summary(firsts(0));
  ok('home first chances overall: one miss won back and one lost, so 50% offensive rebounds', near(all0.orebPct, 0.5));

  /* the average time of possession: second chances inside it, gaps out of it */
  const A = SC.averages(S);
  ok('average time of possession: home 11 s (10, 8, 15; the gap left out), away 13.6 s (15, 3, 27, 18, 5)',
     near(A[0], 11) && near(A[1], 13.6), JSON.stringify(A));
}

/* ---- possessions.js is unchanged where it was right ------------------------ */
console.log('\npossessions.js');
{
  const P = globalThis.EpinoiaPossessions.enumerate({ events: Sit.inGameOrder(S.events).filter(e => !['loc', 'tag', 'stype'].includes(e.t)) });
  ok('the trip and its rebound are two chances in one possession',
     P.possessions.some(p => p.team === 1 && p.chances.length === 2 && P.chances.find(c => c.index === p.chances[0]).outcome === 'shooting_foul'));
  ok('every possession knows when it was gained and it is never after its first action',
     P.possessions.every(p => p.gainClock != null && p.gainPeriod === p.period && p.gainClock >= p.startClock),
     JSON.stringify(P.possessions.map(p => [p.gainClock, p.startClock])));
}

/* ---- real games, through the ingest's own translator ----------------------- */
console.log('\nreal LiveStats games agree with the box score');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    'sys.stdout.write(json.dumps(T))',
  ].join('\n');
  const feeds = [
    path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702542.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702545.json')
  ];
  for (const f of feeds) {
    let T = null;
    for (const exe of ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), f], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
    }
    const name = path.basename(f);
    ok(name + ' translates', !!T);
    if (!T) continue;
    const G = {
      teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0,
      events: T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    const R = SC.compute(G);
    const C = Sit.compute(G);
    [0, 1].forEach(t => {
      const mine = R.chances.filter(r => r.team === t);
      const sum = k => mine.reduce((n, r) => n + r[k], 0);
      const P = G.teams[t].players.map(p => d.stats[p.id]).filter(Boolean);
      const box = k => P.reduce((n, x) => n + (x[k] || 0), 0);
      ok(name + ' team ' + t + ': points, field goals, free throws and turnovers are the box score\'s',
         sum('pts') === d.score[t] && sum('fga') === box('p2a') + box('p3a') && sum('fgm') === box('p2m') + box('p3m') &&
         sum('fta') === box('fta') && sum('ftm') === box('ftm') && sum('tov') === d.team[t].toTot,
         [sum('pts'), d.score[t], sum('fga'), box('p2a') + box('p3a'), sum('fta'), box('fta'), sum('tov'), d.team[t].toTot].join(' '));
      ok(name + ' team ' + t + ': the chances are the events tab\'s', mine.length === C.side[t].sits.all.chances,
         mine.length + ' v ' + C.side[t].sits.all.chances);
      const timed = mine.filter(r => r.dur != null);
      ok(name + ' team ' + t + ': every timed chance is between 0 and 48 s, and nearly all are timed',
         timed.every(r => r.dur >= 0 && r.dur <= SC.LONGEST) && timed.length >= mine.length - 2,
         timed.length + ' of ' + mine.length);
      const a = SC.averages(G)[t];
      ok(name + ' team ' + t + ': average time of possession is a basketball number (8-22 s)', a > 8 && a < 22, String(a));
    });
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
