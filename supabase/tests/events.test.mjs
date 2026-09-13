/* ============================================================================
   EVENTS — what second chances, breaks, turnovers and timeouts turned into.

   epinoia/game/events.js stamps every shot, free throw and turnover with the
   engine's own situation windows and hangs each on a possessions.js chance.
   These check it on a log small enough to work out by hand -- every rule, the
   timeout edge cases, the engine's free-throw quirk -- and then on three real
   LiveStats games through the ingest's translator, where second-chance,
   off-turnover and fast-break points must be the box score's to the point.

     node supabase/tests/events.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Ev = require(path.join(ROOT, 'epinoia', 'game', 'events.js'));
globalThis.EpinoiaBox = require(path.join(ROOT, 'epinoia', 'boxscore.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) <= e;

/* ---- a game small enough to do by hand ------------------------------------ */
const player = (t, i, name) => ({ id: (t ? 'a' : 'h') + i, name, num: String(i) });
const S = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6].map(i => player(0, i, ['', 'Ada Stone', 'Bea Moss', 'Cy Hart', 'Dee Lowe', 'Eve Park', 'Flo <b>Ray</b>'][i])) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5, 6].map(i => player(1, i, ['', 'Gus Roe', 'Hal Fox', 'Ian Pike', 'Jo Kent', 'Kit Lane', 'Lou Dale'][i])) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  period: 2, clockMs: 500000,
  events: []
};
let seq = 0;
/* as the page loads them: id is the seq, descriptors point at it */
const ev = (t, team, pid, clock, extra, period) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team, pid, period: period || 1, clock }, extra || {})); return s; };
const desc = (t, ref, extra) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team: null, pid: null, period: 1, clock: null, ref }, extra)); };

ev('period_start', null, null, 600000);
ev('p2_miss', 0, 'h1', 590000);                                   // A1  half court
ev('reb', 0, 'h2', 588000, { off: true });
const putback = ev('p2_made', 0, 'h2', 587000);                   // A2  second chance, 2
desc('stype', putback, { v: 'putback' });
ev('p3_miss', 1, 'a1', 570000);                                   // B1  half court
ev('reb', 0, 'h3', 568000, { off: false });                       //     the break opens
const layup = ev('p2_made', 0, 'h3', 563000);                     // A3  transition (5 s), 2, assisted
desc('stype', layup, { v: 'layup' });
ev('ast', 0, 'h1', 563000);
ev('p2_miss', 1, 'a2', 550000);                                   // B2  half court
ev('reb', 0, 'h4', 548000, { off: false });
const jumper = ev('p2_miss', 0, 'h4', 530000);                    // A4  18 s after the rebound: half court
desc('stype', jumper, { v: 'jump shot' }); desc('loc', jumper, { x: 0.5, y: 0.3 });   // in the paint, but a jump shot
ev('reb', 1, 'a3', 528000, { off: false });
ev('to', 1, 'a3', 515000);                                        // B3  half court turnover
ev('stl', 0, 'h5', 515000);
ev('p3_made', 0, 'h5', 505000);                                   // A5  off the turnover, 3 (10 s: not a break)
ev('timeout', 1, null, 505000);                                   //     Hull's timeout
ev('p2_miss', 1, 'a4', 490000);                                   // B4  after timeout (own)
ev('reb', 1, 'a5', 488000, { off: true });
ev('p2_made', 1, 'a5', 487000);                                   // B5  second chance, 2 -- the same set
ev('p2_miss', 0, 'h1', 470000);                                   // A6  half court
ev('reb', 0, 'h1', 468000, { off: true });
ev('foul', 1, 'a1', 466000, { kind: 'shooting' });
ev('ft_made', 0, 'h1', 466000);                                   // A7  second chance, 1
ev('timeout', 0, null, 466000);                                   //     Leeds' timeout between free throws
ev('ft_made', 0, 'h1', 466000);                                   //     the engine has shut the window: not second chance
ev('p3_made', 1, 'a1', 450000);                                   // B6  after timeout (theirs), 3, assisted
ev('ast', 1, 'a2', 450000);
ev('foul', 0, 'h2', 440000, { kind: 'shooting' });
ev('ft_made', 1, 'a3', 440000);                                   // B7  half court, 1
ev('ast', 1, 'a4', 440000);                                       //     a pass that drew free throws
ev('ft_miss', 1, 'a3', 440000);
ev('reb', 0, 'h2', 438000, { off: false });
ev('timeout', 1, null, 438000);                                   //     the last timeout of the period: sets nothing up
ev('period_start', null, null, 600000, null, 2);
const late = ev('p2_made', 0, 'h6', 590000, null, 2);             // A9  half court, 2
desc('loc', late, { x: 0.5, y: 0.2 });

console.log('\nthe situations, worked out by hand');
{
  const d = E.deriveGame(S);
  const C = Ev.compute(S);
  const [L, H] = C.side.map(x => x.sits);
  ok('the engine agrees with the hand count (11-6; Leeds sc 3 pot 3 fast 2; Hull sc 2)',
     d.score[0] === 11 && d.score[1] === 6 && d.team[0].sc === 3 && d.team[0].pot === 3 && d.team[0].fast === 2 &&
     d.team[1].sc === 2 && d.team[1].pot === 0 && d.team[1].fast === 0,
     JSON.stringify([d.score, [0, 1].map(t => [d.team[t].sc, d.team[t].pot, d.team[t].fast])]));
  [0, 1].forEach(t => {
    const s = C.side[t].sits;
    ok('team ' + t + ': all, second chance, off-turnover and transition points are the engine\'s',
       s.all.pts === d.score[t] && s.second.pts === d.team[t].sc && s.offTo.pts === d.team[t].pot && s.transition.pts === d.team[t].fast,
       [s.all.pts, s.second.pts, s.offTo.pts, s.transition.pts].join(','));
  });
  ok('Leeds: 8 chances with something in them (the rebound the period ended on is not one)', L.all.chances === 8, L.all.chances);
  ok('...11 points, 1.375 per chance, 4/7 FG with a three: eFG 64.3%', L.all.pts === 11 && near(L.all.ppp, 1.375) && L.all.fgm === 4 && L.all.fga === 7 && near(L.all.efg, 4.5 / 7));
  ok('second chance: the putback and ONE free throw -- the engine shuts the window on the first made free throw',
     L.second.chances === 2 && L.second.pts === 3 && L.second.fga === 1 && L.second.fta === 1 && near(L.second.ppp, 1.5),
     JSON.stringify({ ch: L.second.chances, pts: L.second.pts, fga: L.second.fga, fta: L.second.fta }));
  ok('transition: the layup five seconds after the rebound, not the jumper eighteen after', L.transition.chances === 1 && L.transition.pts === 2 && L.transition.fga === 1);
  ok('a steal ten seconds before the shot is off a turnover but not a break', L.offTo.chances === 1 && L.offTo.pts === 3 && L.offTo.p3m === 1 && near(L.offTo.efg, 1.5));
  ok('half court is whatever was none of the four: 4 chances, 2 points, 1/4', L.half.chances === 4 && L.half.pts === 2 && L.half.fgm === 1 && L.half.fga === 4);
  ok('zones follow the engine: putback and layup at the rim, a jump shot in the paint is not, an untyped shot in the paint is',
     L.all.zones.rim.a === 3 && L.all.zones.rim.m === 3 && L.all.zones.mid.a === 3 && L.all.zones.mid.m === 0 && L.all.zones.three.a === 1,
     JSON.stringify(L.all.zones));
  const rimA = S.teams[0].players.reduce((n, p) => n + d.stats[p.id].rimA, 0);
  ok('...and the rim count is the box score\'s', L.all.zones.rim.a === rimA, L.all.zones.rim.a + ' vs ' + rimA);
  ok('shot types are counted with their makes', L.all.types.some(T => T.type === 'putback' && T.a === 1 && T.m === 1) && L.all.types.some(T => T.three && T.a === 1));
  ok('the shot map knows which shots were located', L.all.shots.filter(x => x.x != null).length === 2);

  const [atoH1, atoH2] = C.side[1].ato;
  ok('Hull: two plays after a timeout, none for Leeds', C.side[1].ato.length === 2 && C.side[0].ato.length === 0, JSON.stringify(C.side.map(x => x.ato.length)));
  ok('after their own timeout: the miss AND the putback, one possession, 2 points',
     atoH1 && atoH1.calledBy === 'own' && atoH1.chances === 2 && atoH1.pts === 2 && atoH1.seq === 21 && /putback|two/.test(atoH1.how), JSON.stringify(atoH1));
  ok('a timeout between free throws sets up the other side\'s inbound (their timeout, a three)',
     atoH2 && atoH2.calledBy === 'opp' && atoH2.pts === 3 && atoH2.chances === 1 && /three · Roe/.test(atoH2.how), JSON.stringify(atoH2));
  ok('a timeout that ends a period sets up nothing', !C.side[0].ato.some(p => p.period === 2));
  ok('the after-timeout row counts possessions: 2, 5 points, 2.50 each', H.ato.chances === 2 && H.ato.pts === 5 && near(H.ato.ppp, 2.5));
  ok('Hull half court leaves out the after-timeout set, putback included', H.half.chances === 4 && H.half.pts === 1 && H.half.tov === 1 && H.second.chances === 1);

  const [AL, AH] = C.side.map(x => x.assists);
  ok('Leeds: 1 assisted basket, 3 unassisted for 7 points', AL.ast.fgm === 1 && AL.ast.pts === 2 && AL.unast.fgm === 3 && AL.unast.pts === 7);
  ok('...led by the unassisted three, then the rest in the order they came', AL.leaders.map(p => p.pid).join() === 'h5,h2,h6', AL.leaders.map(p => p.pid).join());
  ok('Hull: the assist on a pass that drew free throws is kept apart from assisted baskets',
     AH.ast.fgm === 1 && AH.ast.pts === 3 && AH.unast.fgm === 1 && AH.ftAssists === 1);
  [0, 1].forEach(t => {
    const ast = S.teams[t].players.reduce((n, p) => n + d.stats[p.id].ast, 0);
    ok('team ' + t + ': assisted baskets + free-throw assists = the box score\'s assists', C.side[t].assists.ast.fgm + C.side[t].assists.ftAssists === ast);
  });
}

console.log('\nthe tab, drawn');
{
  Ev.setView({ team: 0, side: 'off', sit: 'second' });
  let html = Ev.render(S);
  ok('six rows, the chosen one pressed', (html.match(/class="ev-row[ "]/g) || []).length === 6 && /ev-row on" data-evsit="second"/.test(html));
  ok('the lede reads the offence', /<b>Leeds Force<\/b> on offence: 8 chances, 11 points, <b>1\.38<\/b> points per chance/.test(html));
  ok('a situation with no located shots says so rather than drawing an empty court', /No shot locations were recorded for this shot\./.test(html) && !/ev-dot/.test(html));
  Ev.setView({ sit: 'all' });
  html = Ev.render(S);
  ok('a court is drawn with the located shots on it, made and missed', /<svg[^>]*>/.test(html) && (html.match(/ev-dot made/g) || []).length === 1 && (html.match(/ev-dot miss/g) || []).length === 1 && /2 of 7 shots located/.test(html));
  ok('a name with markup in it is escaped', html.includes('Flo &lt;b&gt;Ray&lt;/b&gt;') || !html.includes('<b>Ray</b>'));
  Ev.setView({ side: 'def' });
  html = Ev.render(S);
  ok('defence is the other side\'s offence against this one', /<b>Hull Pirates<\/b> against <b>Leeds Force<\/b>’s defence: 7 chances, 6 points/.test(html));
  Ev.setView({ team: 1, side: 'off', sit: 'ato' });
  html = Ev.render(S);
  ok('the after-timeout list names whose timeout it was', (html.match(/<li class="(scored|blank)">/g) || []).length === 2 &&
     html.includes('Hull Pirates timeout') && html.includes('Leeds Force timeout'));
  ok('no video, no WATCH VIDEO', !/ev-watch/.test(html));
  ok('the free-throw assist is explained under the split', /Plus 1 assist on a pass that drew free throws/.test(html));
  /* with footage that can place only the three */
  globalThis.EpinoiaVideo = { index: () => [{ id: 30 }] };
  const withVideo = Object.assign({}, S, { video: { url: 'https://youtu.be/AbCdEfGhIjK' } });
  html = Ev.render(withVideo);
  ok('WATCH VIDEO only on a play the footage has, naming that play',
     (html.match(/class="ev-watch"/g) || []).length === 1 && /data-evwatch="30"/.test(html), (html.match(/data-evwatch="[^"]*"/g) || []).join());
  delete globalThis.EpinoiaVideo;
  ok('a game with no plays says so', /No plays yet/.test(Ev.render({ teams: S.teams, events: [] })));
  Ev.setView({ team: 0, side: 'off', sit: 'second' });
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
    const C = Ev.compute(G);
    [0, 1].forEach(t => {
      const s = C.side[t].sits;
      ok(name + ' team ' + t + ': points, 2nd chance, off turnovers and fast break are the box score\'s',
         s.all.pts === d.score[t] && s.second.pts === d.team[t].sc && s.offTo.pts === d.team[t].pot && s.transition.pts === d.team[t].fast,
         [s.all.pts, d.score[t], s.second.pts, d.team[t].sc, s.offTo.pts, d.team[t].pot, s.transition.pts, d.team[t].fast].join(' '));
      const P = G.teams[t].players.map(p => d.stats[p.id]).filter(Boolean);
      const sum = k => P.reduce((n, x) => n + x[k], 0);
      ok(name + ' team ' + t + ': field goals, rim attempts and assists are the box score\'s',
         s.all.fga === sum('p2a') + sum('p3a') && s.all.fgm === sum('p2m') + sum('p3m') && s.all.zones.rim.a === sum('rimA') &&
         C.side[t].assists.ast.fgm + C.side[t].assists.ftAssists === sum('ast'),
         [s.all.fga, sum('p2a') + sum('p3a'), s.all.zones.rim.a, sum('rimA'), C.side[t].assists.ast.fgm, C.side[t].assists.ftAssists, sum('ast')].join(' '));
      ok(name + ' team ' + t + ': every situation is a subset of the whole',
         ['second', 'transition', 'offTo', 'ato', 'half'].every(k => s[k].chances <= s.all.chances && s[k].pts <= s.all.pts && s[k].fga <= s.all.fga));
    });
    const timeouts = G.events.filter(e => e.t === 'timeout').length;
    const atos = C.side[0].ato.length + C.side[1].ato.length;
    ok(name + ': no more after-timeout plays than timeouts (' + atos + ' of ' + timeouts + ')', atos <= timeouts && (timeouts === 0 || atos > 0));
    const html = Ev.render(G);
    ok(name + ': the tab renders', /class="ev-rows"/.test(html) && /ev-assist/.test(html));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
