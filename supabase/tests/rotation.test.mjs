/* ============================================================================
   ROTATIONS — epinoia/rotation.js. Who was on the floor must be the engine's
   answer to the millisecond, or the chart and the box score beside it disagree
   about a player's minutes. Checked on a log small enough to do by hand and on
   three real LiveStats games through the ingest's translator.

     node supabase/tests/rotation.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, 'epinoia', 'rotation.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

console.log('a game worked out by hand');
{
  const pl = (t, i) => ({ id: (t ? 'a' : 'h') + i, name: (t ? 'Away ' : 'Home ') + i, num: String(i) });
  const S = {
    status: 'final', period: 4, clockMs: 0,
    teams: [{ name: 'Home', players: [1, 2, 3, 4, 5, 6, 7].map(i => pl(0, i)) },
            { name: 'Away', players: [1, 2, 3, 4, 5, 6].map(i => pl(1, i)) }],
    starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
    events: []
  };
  let seq = 0;
  const ev = (t, team, period, clock, extra) => S.events.push(Object.assign({ id: ++seq, seq, t, team, period, clock }, extra || {}));
  ev('period_start', null, 1, 600000);
  ev('p2_made', 0, 1, 570000, { pid: 'h1' });                 // home 2-0 at 0:30
  ev('sub', 0, 1, 450000, { out: 'h5', in: 'h6' });           // h6 on at 2:30
  ev('p3_made', 1, 1, 420000, { pid: 'a1' });                 // 2-3 at 3:00
  ev('sub', 0, 2, 300000, { out: 'h6', in: 'h5' });           // back at 15:00 (Q2 5:00)
  const M = R.compute(S);
  const row = (t, pid) => M.teams[t].rows.find(r => r.pid === pid);
  ok('a regulation game is forty minute columns in four periods', M.minutes === 40 && M.periods.length === 4 && M.periods[3].label === 'Q4');
  ok('a starter who never left played all forty minutes', row(0, 'h1').ms === 2400000);
  ok('h5 played 2:30 then 25:00 from the fifteenth minute: 27:30', row(0, 'h5').ms === 150000 + 1500000, row(0, 'h5').ms);
  ok('h6 played the 12:30 between', row(0, 'h6').ms === 750000, row(0, 'h6').ms);
  ok('a player who never came on is DNP and sorts last', row(0, 'h7').dnp && M.teams[0].rows[M.teams[0].rows.length - 1].pid === 'h7');
  ok('the minute h6 came on is half his: 0.5 in the third minute, all of the fourth',
     near(row(0, 'h6').cells[2], 0.5) && near(row(0, 'h6').cells[3], 1) && row(0, 'h6').cells[1] === 0);
  ok('rows are longest first', M.teams[0].rows[0].ms >= M.teams[0].rows[1].ms);
  ok('the margin steps with every basket and ends on the score (2-3)',
     M.margin.length === 3 && M.margin[1][1] === 2 && M.margin[2][1] === -1 && M.score[0] === 2 && M.score[1] === 3);
  const html = R.html(M, { colours: ['#112233', '#445566'] });
  ok('it draws both sides, the margin and the key', /Home 1/.test(html) && /Away 1/.test(html) && /rot-margin/.test(html) && /rot-legend/.test(html) && /DNP/.test(html));
  ok('names are escaped', !R.html({ minutes: 40, periods: M.periods, now: 40, teams: [{ name: '<b>x', rows: [] }], margin: [] }, {}).includes('<b>x'));

  const Z = R.season([{ model: M, side: 0 }, { model: M, side: 1 }], 'Home');
  const h6 = Z.teams[0].rows.find(r => r.pid === 'h6');
  ok('a season averages over every game, a missed one as none of it', Z.games === 2 && near(h6.cells[3], 0.5) && h6.gp === 1,
     JSON.stringify([Z.games, h6 && h6.cells[3], h6 && h6.gp]));
  ok('the season margin is the club\'s own: +2 at a minute in the one, -2 in the other, 0 on average',
     near(Z.margin[1][1], 0) && Z.margin.length === 41);
}

console.log('\nreal LiveStats games: every bar is the box score\'s minutes');
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
      status: 'final', teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0,
      events: T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    const M = R.compute(G);
    const bad = [];
    [0, 1].forEach(t => M.teams[t].rows.forEach(r => {
      const x = d.stats[r.pid];
      if (x && x.min !== r.ms) bad.push(r.pid + ' ' + r.ms + ' v ' + x.min);
      const cellMs = Math.round(r.cells.reduce((a, b) => a + b, 0) * 60000);
      if (Math.abs(cellMs - r.ms) > 1) bad.push(r.pid + ' cells ' + cellMs + ' v ' + r.ms);
    }));
    ok(name + ': every player\'s bar is his minutes in the box score, and its cells add up to it', !bad.length, bad.slice(0, 4).join('; '));
    ok(name + ': the margin ends on the final score', M.margin[M.margin.length - 1][1] === d.score[0] - d.score[1],
       M.margin[M.margin.length - 1][1] + ' v ' + (d.score[0] - d.score[1]));
    /* sampled inside the time actually played: one of these feeds stops in the second quarter */
    const onFloor = m => [0, 1].map(t => M.teams[t].rows.reduce((n, r) => n + r.cells[m], 0));
    const played = Math.floor(M.now);
    const sample = [0, 1, 2, Math.floor(played / 2), played - 1];
    const five = sample.every(m => onFloor(m).every(v => near(v, 5, 1e-6)));
    ok(name + ': five a side on the floor in every sampled minute', five, JSON.stringify(sample.map(onFloor)));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
