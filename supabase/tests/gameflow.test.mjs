/* ============================================================================
   GAME FLOW AND CONNECTIONS — GAMEVIS's two tabs, on the EPINOIA box score.

   epinoia/game/flow.js and connections.js replay window.S the way GAMEVIS
   replays a FIBA play-by-play page. These check the replay on a log small
   enough to work out by hand, then on a real LiveStats game translated by the
   ingest's own translator, where the tabs must agree with the engine's box
   score about every point and every assist.

     node supabase/tests/gameflow.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Flow = require(path.join(ROOT, 'epinoia', 'game', 'flow.js'));
const Conn = require(path.join(ROOT, 'epinoia', 'game', 'connections.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* ---- a game small enough to do by hand ------------------------------------ */
const player = (t, i, name) => ({ id: (t ? 'a' : 'h') + i, name, num: String(i) });
const S = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6].map(i => player(0, i, ['', 'Ada Stone', 'Bea Moss', 'Cy Hart', 'Dee Lowe', 'Eve Park', 'Flo <b>Ray</b>'][i])) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5, 6].map(i => player(1, i, ['', 'Gus Roe', 'Hal Fox', 'Ian Pike', 'Jo Kent', 'Kit Lane', 'Lou Dale'][i])) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  events: []
};
const P1 = 600000;
let seq = 0;
const ev = (t, team, pid, clock, extra) => S.events.push(Object.assign({ seq: ++seq, t, team, pid, period: 1, clock }, extra || {}));
ev('period_start', null, null, P1);
ev('p2_made', 0, 'h1', 590000); ev('ast', 0, 'h2', 590000);            // 2-0, h2 -> h1 (2)
ev('p3_made', 1, 'a1', 570000); ev('ast', 1, 'a2', 570000);            // 2-3, a2 -> a1 (3): lead change
ev('p2_miss', 0, 'h3', 550000); ev('reb', 0, 'h4', 548000, { off: true });
ev('p2_made', 0, 'h1', 547000);                                        // 4-3 putback, unassisted: lead change
ev('to', 1, 'a1', 530000);                                             // away turnover
ev('p3_made', 0, 'h1', 520000); ev('ast', 0, 'h2', 520000);            // 7-3, h2 -> h1 (3)
ev('ast', 0, 'h3', 520000);                                            // a second assist on the same basket: ignored
ev('sub', 0, null, 515000, { in: 'h6', out: 'h5' });
ev('foul', 1, 'a3', 510000); ev('ft_made', 0, 'h1', 510000); ev('ft_made', 0, 'h1', 510000);   // 9-3
ev('ft_miss', 1, 'a2', 500000);
ev('p2_made', 0, 'h6', 490000); ev('ast', 1, 'a4', 490000);            // 11-3, an away "assist" on a home basket: ignored
ev('p2_made', 1, 'a2', 480000);                                        // 11-5: ends home's run of 9

console.log('\nthe flow points, worked out by hand');
{
  const F = Flow.compute(S);
  const pts = F.points;
  /* a point after every score, every field-goal attempt and every turnover:
     h1 2, a1 3, h3 miss, h1 2, a1 TO, h1 3, h1 FT, h1 FT, h6 2, a2 2  (the FT miss and the OREB are not points) */
  ok('one point per score, field-goal attempt and turnover', pts.length === 10, pts.length);
  const last = pts[pts.length - 1];
  ok('the running score is the game\'s', last.homePoints === 11 && last.awayPoints === 5, last.homePoints + '-' + last.awayPoints);
  /* home: FGA 5 (h1,h3,h1,h1,h6), TOV 0, FTA 2, OREB 1 -> 0.96*(5+0+0.88-1)
     away: FGA 2, TOV 1, FTA 1, OREB 0 -> 0.96*(2+1+0.44) */
  ok('possessions are 0.96 x (FGA + TOV + 0.44 FTA - OREB)',
     near(last.homePoss, 0.96 * 4.88) && near(last.awayPoss, 0.96 * 3.44), last.homePoss + ' ' + last.awayPoss);
  ok('PPP is points over those possessions', near(last.homePPP, 11 / (0.96 * 4.88)) && near(last.awayPPP, 5 / (0.96 * 3.44)));
  ok('EPA is (TO margin + OREB margin) x 1.05', near(last.epa, (1 - 0 + 1 - 0) * 1.05), last.epa);
  const toPoint = pts[4];
  ok('a turnover is counted in its own point (GAMEVIS counted it one point late)', toPoint.awayTov === 1 && near(toPoint.epa, 2.1), JSON.stringify(toPoint));
  /* eFG home (4 made, 1 three, 5 FGA) = 90; away (2 made, 1 three, 2 FGA) = 125; FT rate home 2/5 = 40, away 0 */
  ok('eFG% and FT-rate margins', near(last.efgMargin, 90 - 125) && near(last.ftRateMargin, 40), last.efgMargin + ' ' + last.ftRateMargin);
  ok('elapsed is game seconds', pts[0].elapsed === 10 && last.elapsed === 120, pts[0].elapsed + ' ' + last.elapsed);

  const s = F.summary;
  ok('lead changes: home, away, home', s.leadChanges === 2, s.leadChanges);
  ok('biggest runs are read off the margin, as GAMEVIS reads them', s.biggestHomeRun === 9 && s.biggestAwayRun === 3, s.biggestHomeRun + ' ' + s.biggestAwayRun);

  ok('the home run of 9 is a team momentum run', F.teamRuns.length === 1 && F.teamRuns[0].teamIdx === 0 && F.teamRuns[0].points === 9,
     JSON.stringify(F.teamRuns));
  const tr = F.teamRuns[0];
  ok('...shown as 9-0', tr.scoreDiff === '9-0');
  ok('...with the lineup on the floor when it began', tr.lineup.slice().sort().join() === 'h1,h2,h3,h4,h5', tr.lineup.join());
  ok('...and its top scorer, by surname', tr.topScorer === 'Stone' && tr.topScorerPoints === 7, tr.topScorer + ' ' + tr.topScorerPoints);
  ok('...timed from its first basket to its last', tr.seconds === 57 && tr.duration === '0\'57"', tr.seconds + ' ' + tr.duration);
  ok('a player with 6+ inside that run is a player run', F.playerRuns.length === 1 && F.playerRuns[0].pid === 'h1' && F.playerRuns[0].points === 7,
     JSON.stringify(F.playerRuns));
  ok('...showing the score before and after', F.playerRuns[0].startScore === '2-3' && F.playerRuns[0].endScore === '11-3',
     F.playerRuns[0].startScore + ' ' + F.playerRuns[0].endScore);
  ok('formatDuration is GAMEVIS\'s', Flow.formatDuration(83) === '1\'23"' && Flow.formatDuration(5) === '0\'05"');

  /* out of order in the array, in order in the game: the engine's ordering wins */
  const shuffled = Object.assign({}, S, { events: S.events.slice().reverse() });
  const R = Flow.compute(shuffled);
  ok('the log is replayed in game order, not array order',
     R.points.length === 10 && R.points[0].homePoints === 2 && R.summary.leadChanges === 2);
}

console.log('\nthe charts');
{
  const html = Flow.render(S);
  ok('all six charts and the summary strip are drawn', (html.match(/class="gf-card[ "]/g) || []).length === 6 && /gf-summary/.test(html),
     (html.match(/class="gf-card[ "]/g) || []).length);
  ok('...under GAMEVIS\'s titles', ['Player Scoring Runs', 'Team Momentum Runs', 'Scoring Development (Score Margin)',
     'Expected Points Added (EPA)', 'Scoring Battle (eFG% + FT Rate)', 'Points Per Possession Development'].every(t => html.includes(t)));
  ok('the margin line changes colour where it crosses zero', /class="gf-line home"/.test(html) && /class="gf-line away"/.test(html));
  /* THE RUNS READ AS TEXT. What GAMEVIS hid in a hover tooltip (and a phone never
     showed) is a row under the strip, numbered to match its bar. */
  const bars = html.match(/<span class="gf-bar [^"]+" data-run="[pm]\d+"/g) || [];
  const rows = html.match(/<li class="gf-runrow [^"]+" data-run="[pm]\d+"/g) || [];
  ok('every run is one bar and one row, under one id', bars.length === 2 && rows.length === 2 &&
     bars.every(b => rows.some(r => r.endsWith(b.slice(b.indexOf('data-run'))))), bars.join(' | '));
  ok('a team run row says the run, the team, and when on the game clock',
     /data-run="m0"><span class="gf-runno">1<\/span><span class="gf-runbig">9–0<\/span><span class="gf-runmain"><b>Leeds Force<\/b><span class="gf-runwhen">Q1 9:07 – 8:10 · 0'57"<\/span>/.test(html));
  ok('...its top scorer, the score either side, and the five on the floor',
     html.includes('Top scorer <b>Stone</b> 7') && html.includes('2–3 → 11–3') &&
     html.includes('On court: Ada Stone, Bea Moss, Cy Hart, Dee Lowe, Eve Park'));
  ok('a player run row names the player in full, with the team',
     /data-run="p0">[\s\S]*?<span class="gf-runbig">7<small> pts<\/small><\/span><span class="gf-runmain"><b>Ada Stone<\/b><span class="gf-runwhen">Leeds Force<\/span>/.test(html));
  ok('home bars stand above the line, and are as wide as the run lasted',
     /class="gf-bar home" data-run="m0"[^>]*style="--x:44\.17%;--w:47\.50%;/.test(html), (html.match(/class="gf-bar home" data-run="m0"[^>]*style="[^"]*"/) || [])[0]);
  ok('the game clock is the box score\'s: remaining time, rounded up', Flow.clockText(1, 547000) === 'Q1 9:07' && Flow.clockText(5, 59100) === 'OT1 1:00');
  {
    /* two players each with 6 inside one home run share its width instead of overlapping */
    const T = JSON.parse(JSON.stringify(S));
    T.events = [
      { t: 'period_start', period: 1, clock: P1 },
      { t: 'p3_made', team: 0, pid: 'h1', period: 1, clock: 590000 }, { t: 'p3_made', team: 0, pid: 'h2', period: 1, clock: 570000 },
      { t: 'p3_made', team: 0, pid: 'h1', period: 1, clock: 550000 }, { t: 'p3_made', team: 0, pid: 'h2', period: 1, clock: 530000 },
      { t: 'p2_made', team: 1, pid: 'a1', period: 1, clock: 500000 }
    ];
    const two = Flow.render(T);
    const xs = [...two.matchAll(/class="gf-bar home" data-run="p(\d)"[^>]*style="--x:([\d.]+)%;--w:([\d.]+)%/g)].map(m => [+m[2], +m[3]]);
    ok('two player runs in one team run sit side by side, not on top of each other',
       xs.length === 2 && Math.abs(xs[1][0] - (xs[0][0] + xs[0][1])) < 0.02 && Math.abs(xs[0][1] - xs[1][1]) < 0.02, JSON.stringify(xs));
  }
  ok('the summary strip reads 11 - 5, two lead changes, +2.1 EPA',
     html.includes('>11 - 5<') && /Lead Changes<\/span><span class="gf-stat-value">2</.test(html) && html.includes('+2.1 pts'));
  const evil = JSON.parse(JSON.stringify(S));
  evil.teams[0].name = '<img src=x onerror=alert(1)>';
  evil.teams[0].players[0].name = 'Ada <script>alert(1)</script>';
  const bad = Flow.render(evil);
  ok('names are escaped wherever they are drawn', !/<img src=x|<script>/.test(bad) && bad.includes('&lt;img'));
  const a1 = Flow.symAxis(143, 5), a2 = Flow.symAxis(11, 4), a3 = Flow.symAxis(30, 10);
  ok('an axis never carries more than a dozen gridlines', a1.step === 25 && a1.yMax === 150, JSON.stringify(a1));
  ok('...keeps the GAMEVIS step when that is few enough, rounded out so zero is a line',
     a2.step === 4 && a2.yMax === 12 && a3.step === 10 && a3.yMax === 30, JSON.stringify([a2, a3]));
  ok('the margin axis labels zero, in the label column', /class="gf-yt" style="top:50\.000%">0<\/span>/.test(html));
  ok('a game without enough play-by-play says so', /Game flow is not available yet/.test(Flow.render({ teams: S.teams, starters: S.starters, events: S.events.slice(0, 2) })));
  ok('...as does an empty one', /not available/.test(Flow.render({ teams: S.teams, events: [] })));
}

console.log('\nconnections, worked out by hand');
{
  const C = Conn.compute(S);
  ok('two pairs, one a side', C.all.length === 2 && C.byTeam[0].length === 1 && C.byTeam[1].length === 1, JSON.stringify(C.all));
  const h = C.byTeam[0][0];
  ok('h2 -> h1: 2 assists, 5 points, a three and a two',
     h.assister === 'h2' && h.scorer === 'h1' && h.count === 2 && h.points === 5 && h.threes === 1 && h.twos === 1, JSON.stringify(h));
  ok('a second assist on one basket is not counted, and neither is the other side\'s', C.all.every(c => c.assister !== 'h3' && c.assister !== 'a4'));
  ok('the most frequent pair first, and the bar scale is the game\'s', C.all[0] === h && C.maxCount === 2);
  const html = Conn.render(S);
  ok('cards and table are both drawn, cards showing', /class="cx-cards"/.test(html) && /class="cx-tables" hidden/.test(html));
  ok('a card shows assists, PTS, PPP, 3PT and 2PT', /cx-count">2</.test(html) && />2\.50</.test(html));
  ok('the bar is scaled against the busiest pair in the game', /cx-bar home" style="width:100\.0%"/.test(html) && /cx-bar away" style="width:50\.0%"/.test(html));
  ok('non-uuid players are not linked to a profile', !/href="\.\.\/p\//.test(html));
  const uu = JSON.parse(JSON.stringify(S));
  const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
  uu.teams[0].players[1].id = id; uu.events.forEach(e => { if (e.pid === 'h2') e.pid = id; });
  ok('a league player is linked to their profile', Conn.render(uu).includes('href="../p/?p=' + id + '"'));
  Conn.setView('table');
  ok('the chosen view survives a redraw', /class="cx-cards" hidden/.test(Conn.render(S)) && /class="cx-tables">/.test(Conn.render(S)));
  Conn.setView('cards');
  ok('a game with no assists says so', /No connection data available/.test(Conn.render({ teams: S.teams, events: S.events.filter(e => e.t !== 'ast') })));
}

/* ---- a real game, through the ingest's own translator ---------------------- */
console.log('\na real LiveStats game agrees with the box score');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    'sys.stdout.write(json.dumps(T))',
  ].join('\n');
  let T = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'),
                              path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json')], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
  }
  ok('the fixture translates', !!T);
  if (T) {
    const G = {
      teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0,
      events: T.events.map(e => Object.assign({ id: 'e' + e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    const F = Flow.compute(G);
    const last = F.points[F.points.length - 1];
    ok('the last flow point is the box score\'s score', last.homePoints === d.score[0] && last.awayPoints === d.score[1],
       last.homePoints + '-' + last.awayPoints + ' vs ' + d.score.join('-'));
    const adv = [0, 1].map(t => E.teamAdv(G, d, t));
    ok('the last point\'s possessions are the engine\'s', near(last.homePoss, adv[0].possessions, 1e-6) && near(last.awayPoss, adv[1].possessions, 1e-6),
       last.homePoss + '/' + adv[0].possessions + ' ' + last.awayPoss + '/' + adv[1].possessions);
    ok('every team run is 6+ and every player run sits inside one', F.teamRuns.every(r => r.points >= 6) &&
       F.playerRuns.every(p => F.teamRuns.some(r => r.teamIdx === p.teamIdx && r.startElapsed === p.startElapsed && p.points <= r.points)));
    const C = Conn.compute(G);
    [0, 1].forEach(t => {
      const ast = G.teams[t].players.reduce((a, p) => a + (d.stats[p.id] ? d.stats[p.id].ast : 0), 0);
      const ptsAst = G.teams[t].players.reduce((a, p) => a + (d.stats[p.id] ? d.stats[p.id].ptsAst : 0), 0);
      const n = C.byTeam[t].reduce((a, c) => a + c.count, 0);
      const pts = C.byTeam[t].reduce((a, c) => a + c.points, 0);
      ok('team ' + t + ': every assist is in a pair, worth the engine\'s points assisted', n === ast && pts === ptsAst,
         n + '/' + ast + ' assists, ' + pts + '/' + ptsAst + ' points');
    });
    const html = Flow.render(G) + Conn.render(G);
    ok('both tabs render the real game', /gf-summary/.test(html) && /cx-card/.test(html));
  }
}

/* ---- a run, on video ----------------------------------------------------- */
console.log('\na run goes to the video, first basket to last');
{
  /* a stream that started ten minutes before the tip, and every play stamped two seconds
     after it happened, as the ingest's poll would */
  const STREAM = Date.parse('2026-09-12T18:50:00Z'), TIP = Date.parse('2026-09-12T19:00:00Z');
  const G = JSON.parse(JSON.stringify(S));
  G.events.forEach(e => {
    const el = (600000 - e.clock);                          // all in the first period
    e.wall = TIP + el + 2000; e.wall_err = 10000;
    e.id = e.seq;                                          // as the page loads them (game.js, live.js)
  });
  G.video = { provider: 'youtube', url: 'https://youtu.be/AbCdEfGhIjK', video_ref: 'AbCdEfGhIjK',
              stream_started_at: new Date(STREAM).toISOString(), tip_at: new Date(TIP + 2000).toISOString(),
              tip_wall: TIP + 2000, trim_ms: 0 };

  const F = Flow.compute(G);
  const tr = F.teamRuns[0], pr = F.playerRuns[0];
  ok('a team run is named by its first basket, and lists its baskets', tr.key === 'm8' && JSON.stringify(tr.ids) === '[8,10,15,16,18]', tr.key + ' ' + JSON.stringify(tr.ids));
  ok('a player run is named by his first basket in it, and lists only his', pr.key === 'p8-h1' && JSON.stringify(pr.ids) === '[8,10,15,16]', pr.key + ' ' + JSON.stringify(pr.ids));
  ok('every run row offers WATCH VIDEO when the game has footage',
     (Flow.render(G).match(/class="gf-watch" data-watch="(m8|p8-h1)"/g) || []).length === 2);
  ok('...and none when it has no video to go to', !/gf-watch/.test(Flow.render(S)) &&
     !/gf-watch/.test(Flow.render(Object.assign({}, G, { video: { live_src: 'https://www.youtube.com/embed/live_stream?channel=x' } }))));

  /* the real video tab, on a page with nothing but a stage and a body in it */
  globalThis.EpinoiaVideo = require(path.join(ROOT, 'epinoia', 'video.js'));
  globalThis.EpinoiaEngine = E;
  globalThis.EpinoiaGameFlow = Flow;
  const Tab = require(path.join(ROOT, 'epinoia', 'game', 'video.js'));
  const stage = { dataset: {}, innerHTML: '', querySelector: () => null };
  const body = { innerHTML: '' };
  const hostEl = {
    set innerHTML(_) { /* mount(): the stage and body below stand in for what it writes */ },
    querySelector: sel => sel === '.vidstage' ? stage : sel === '.vidbody' ? body : null,
    querySelectorAll: () => []
  };
  const d = E.deriveGame(Object.assign({ period: 1, clockMs: 480000 }, G));
  Tab.render({ host: hostEl, video: G.video, events: G.events, S: G, d, focus: { run: 'm8' } });

  const plays = globalThis.EpinoiaVideo.index(G.events, G.video, { skipStructural: true });
  ok('every basket of the run can be placed', tr.ids.every(id => plays.some(p => p.id === id)));
  const mine = plays.filter(p => tr.ids.includes(p.id));
  const want0 = Math.min(...mine.map(p => p.start)), want1 = Math.max(...mine.map(p => p.end));
  const m = /embed\/AbCdEfGhIjK\?start=(\d+)&amp;autoplay=1[^"]*&amp;end=(\d+)/.exec(stage.innerHTML);
  ok('the player opens at the run\'s first basket, playing', !!m && +m[1] === Math.floor(want0 / 1000), stage.innerHTML.slice(0, 200));
  ok('...and stops after its last', !!m && +m[2] === Math.ceil(want1 / 1000), m && m[2] + ' vs ' + Math.ceil(want1 / 1000));
  ok('...which is the first basket\'s position less its run-up', near(want0, 10 * 60000 + (600000 - 547000) + 2000 - (8500 + 2000 + 10000), 1),
     String(want0));
  ok('the runs list is showing, with this run marked as playing',
     /class="viditem vidrun home on"[^>]*data-run="m8"/.test(body.innerHTML) && /data-runs="1">runs</.test(body.innerHTML));
  ok('...the runs chip is on, beside the kinds of play', /class="vidchip on" data-runs="1"/.test(body.innerHTML));
  ok('...and the Runs tab is offered with it', />Runs<\/button>/.test(body.innerHTML));
  const st = Tab.state();
  ok('a redraw for a new event does not rewind it', (() => {
    const before = stage.innerHTML;
    Tab.render({ host: hostEl, video: G.video, events: G.events, S: G, d, focus: { run: 'm8' } });
    return stage.innerHTML === before && st.current === 'run@m8';
  })());
  Tab.render({ host: hostEl, video: G.video, events: G.events, S: G, d, focus: { run: 'p8-h1' } });
  ok('asking for another run moves to it', Tab.state().current === 'run@p8-h1');
  Tab.reset();
}

/* ---- the charts on the rotations' time axis ---------------------------------- */
console.log('\nthe stack: rotations, then the charts on their minutes');
{
  const Rot = require(path.join(ROOT, 'epinoia', 'rotation.js'));
  globalThis.EpinoiaRotation = Rot;
  try {
    /* ONE AXIS: the number of periods and their lengths are rotation.js's, in seconds */
    const OT = { events: [{ t: 'period_start', period: 1, clock: 600000 }, { t: 'p2_made', team: 0, pid: 'h1', period: 5, clock: 200000 }], period: 5, teams: S.teams, starters: S.starters };
    [S, OT, { events: [], teams: S.teams }, Object.assign({}, S, { period: 6 })].forEach((g, i) => {
      const a = Flow.timeline(g).periods, b = Rot.compute(g).periods;
      ok('the flow timeline is the rotations\' timeline (game ' + i + ': ' + a.length + ' periods)',
         a.length === b.length && a.every((p, k) => p.n === b[k].n && p.label === b[k].label && near(p.from / 60, b[k].from) && near(p.to / 60, b[k].to)),
         JSON.stringify([a, b]));
    });
    ok('...four periods of 10 minutes, then 5 a period of overtime', Flow.timeline(S).total === 2400 && Flow.timeline(OT).total === 2700);

    const html = Flow.render(S);
    const at = (needle) => html.indexOf(needle);
    ok('Rotations comes after the runs and before every chart, which follow it in one stack',
       at('class="gf-card gf-rot"') > at('Team Momentum Runs') && at('class="gf-stack"') > at('class="gf-card gf-rot"') &&
       ['margin', 'epa', 'battle', 'ppp'].every(k => at('data-chart="' + k + '"') > at('class="gf-stack"')) && at('class="gf-summary"') > at('data-chart="ppp"'));
    ok('...in the order Scoring Development, EPA, Scoring Battle, PPP', ['margin', 'epa', 'battle', 'ppp'].map(k => at('data-chart="' + k + '"')).every((v, i, a) => !i || v > a[i - 1]));
    {
      /* the Scoring Battle chart read a value called "battle" that the points do not have (they call it scoringBattle), so it was drawn at zero */
      const pts = Flow.compute(S).points, lastPt = pts[pts.length - 1];
      const card = html.slice(at('data-chart="battle"'), at('data-chart="ppp"'));
      const label = (/class="gf-endl[^"]*"[^>]*>([^<]*)</.exec(card) || [])[1];
      const want = (lastPt.scoringBattle >= 0 ? '+' : '') + lastPt.scoringBattle.toFixed(1);
      ok('the Scoring Battle chart draws the game\'s scoring battle, not zero: its end label is the last point\'s value (' + want + ')',
         Math.abs(lastPt.scoringBattle) >= 0.05 && label === want, [label, want]);
    }
    ok('...each chart a card of its own with buttons to move it: the first cannot go up, the last cannot go down',
       (html.match(/class="gf-card gf-chart"/g) || []).length === 4 && (html.match(/data-mv="up"/g) || []).length === 4 &&
       /data-chart="margin"[\s\S]*?data-mv="up"[^>]*disabled/.test(html) && /data-chart="ppp"[\s\S]*?data-mv="down"[^>]*disabled/.test(html) &&
       !/data-chart="epa"[\s\S]{0,900}?data-mv="up"[^>]*disabled/.test(html.slice(at('data-chart="epa"'), at('data-chart="battle"'))));
    ok('the rotations say the charts beneath use their minutes', /The charts beneath use these same minutes: move one up to read it against the rotations\./.test(html));

    /* THE PLOT IS THE GAME: x is the share of it, the whole of it */
    const first = html.slice(at('data-chart="margin"'), at('data-chart="epa"'));
    ok('a play at 10 seconds is 10/2400 of the way across the plot, not across the plays', /d="M 4\.2 [\d.]+ L/.test(first), (first.match(/class="gf-line[^>]*>/g) || []).join(' '));
    ok('a period break is a quarter of the way across, and the periods are named inside the plot, along its top',
       /x1="250\.0"/.test(first) && /<span class="gf-pl" style="left:12\.500%">Q1<\/span>/.test(first) && /<span class="gf-pl" style="left:87\.500%">Q4<\/span>/.test(first));
    ok('a plot is one stretched svg with its words in HTML: labels in the label column, the axis title, no svg text',
       /viewBox="0 0 1000 200" preserveAspectRatio="none"/.test(first) && /class="gf-yt" style="top:50\.000%">0<\/span>/.test(first) && /class="gf-ytitle">Score Margin</.test(first) && !/<text/.test(first));

    /* THE READER'S ORDER */
    ok('an order is made whole: unknown names and repeats go, missing charts come back in the default order',
       JSON.stringify(Flow.normaliseOrder(['ppp', 'nope', 'ppp', 'epa'])) === '["ppp","epa","margin","battle"]' && JSON.stringify(Flow.normaliseOrder(null)) === '["margin","epa","battle","ppp"]'
       && JSON.stringify(Flow.normaliseOrder('ppp')) === '["margin","epa","battle","ppp"]');
    Flow.keepOrder(['battle', 'margin']);
    const moved = Flow.render(S);
    ok('a kept order is the order drawn (a chart can sit directly under the rotations)',
       ['battle', 'margin', 'epa', 'ppp'].map(k => moved.indexOf('data-chart="' + k + '"')).every((v, i, a) => !i || v > a[i - 1]));
    Flow.keepOrder(['margin', 'epa', 'battle', 'ppp']);

    /* WHO WAS ON THE FLOOR, AT A MOMENT */
    const F = Flow.compute(S);
    const M = { tl: Flow.timeline(S), points: F.points, lineups: F.lineups, until: 2400 };
    ok('the lineups start with the starters', F.lineups[0].sec === 0 && F.lineups[0].on[0].join() === 'Ada Stone,Bea Moss,Cy Hart,Dee Lowe,Eve Park', JSON.stringify(F.lineups[0]));
    const s84 = Flow.stateAt(M, 84), s85 = Flow.stateAt(M, 85);
    ok('before a substitution the old five, at the second of it the new five (Flo comes on for Eve at 1:25)',
       s84.on[0].includes('Eve Park') && !s84.on[0].includes('Flo <b>Ray</b>') && s85.on[0].includes('Flo <b>Ray</b>') && !s85.on[0].includes('Eve Park') && s85.on[0].length === 5, JSON.stringify([s84.on[0], s85.on[0]]));
    ok('...the other side is untouched, and there are always five', s84.on[1].join() === s85.on[1].join() && s84.on[1].length === 5);
    ok('the clock is the box score\'s: what is left in the period', s85.clock === 'Q1 8:35' && Flow.stateAt(M, 0).clock === 'Q1 10:00' && Flow.stateAt(M, 600).clock === 'Q2 10:00' && Flow.stateAt(M, 2400).clock === 'Q4 0:00', [s85.clock, Flow.stateAt(M, 600).clock, Flow.stateAt(M, 2400).clock].join());
    ok('the score is the last one on or before the moment', Flow.stateAt(M, 5).score.join('-') === '0-0' && Flow.stateAt(M, 30).score.join('-') === '2-3' && s85.score.join('-') === '7-3' && s85.margin === 4 && Flow.stateAt(M, 90).score.join('-') === '9-3');
    ok('a moment a live game has not got to has nothing', Flow.stateAt(Object.assign({}, M, { until: 100 }), 200) === null && Flow.stateAt(M, -1) === null && Flow.stateAt(null, 5) === null);

    /* the tie between the two pictures: a player's minutes from the lineups are his minutes in the rotations */
    const G = { teams: S.teams, starters: S.starters, events: S.events, status: 'final', period: 1, clockMs: 0 };
    const RM = Rot.compute(G), FG = Flow.compute(G);
    const floor = {};
    FG.lineups.forEach((l, i) => {
      const end = i + 1 < FG.lineups.length ? FG.lineups[i + 1].sec : RM.now * 60;
      [0, 1].forEach(t => l.on[t].forEach(n => { floor[t + n] = (floor[t + n] || 0) + Math.max(0, end - l.sec); }));
    });
    const bad = [];
    RM.teams.forEach((T, t) => T.rows.forEach(r => { const a = Math.round((floor[t + r.name] || 0)), b = Math.round(r.ms / 1000); if (Math.abs(a - b) > 1) bad.push(r.name + ' ' + a + ' vs ' + b); }));
    ok('every player\'s time on the floor from the lineups is his time in the rotations', !bad.length, bad.join('; '));

    /* THE ALIGNMENT CONTRACT, in the stylesheets: a plot's row is the rotations' own two columns */
    const rcss = fs.readFileSync(path.join(ROOT, 'epinoia', 'kit', 'rotation.css'), 'utf8').replace(/\r\n/g, '\n');
    const fcss = fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'flow.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = (css, sel) => (css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [, ''])[1];
    const decl = (body, prop) => ((body.match(new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)')) || [, ''])[1] || '').trim();
    const rrow = rule(rcss, '.rot-row'), arow = rule(fcss, '.gf-al'), rroot = rule(rcss, '.rot');
    ok('a chart row has the rotations\' columns and gap: a label column, then the plot',
       decl(rrow, 'grid-template-columns') === 'var(--rot-nw) minmax(0,1fr)' && decl(arow, 'grid-template-columns') === 'var(--gf-lw) minmax(0,1fr)' && decl(rrow, 'gap') === '8px' && decl(arow, 'gap') === '8px', [rrow, arow].join(' | '));
    ok('...centred and capped at the same width as the rotations', decl(rroot, 'max-width') === '1100px' && decl(arow, 'max-width') === '1100px' && /margin:0 auto/.test(rroot) && /margin:0 auto/.test(arow));
    ok('...and the rotations\' label column IS the charts\' (--rot-nw is --gf-lw inside the card), on a phone too',
       /\.gf-rot \.rot\{ --rot-nw:var\(--gf-lw\) \}/.test(fcss) && /--gf-lw:150px/.test(fcss) && /--gf-lw:96px/.test(fcss) && /\.rot\{--rot-nw:96px/.test(rcss));
    ok('...a phone gives both the same width of their own, and they scroll together',
       /\.rot-team,\.rot-margin,\.rot-legend\{min-width:420px\}/.test(rcss) && /\.gf-scroll \.gf-al\{ min-width:420px \}/.test(fcss) && /host\.addEventListener\('scroll'/.test(fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'flow.js'), 'utf8')));
    ok('the stack is compact: no axis row per chart, a small title with its legend and buttons on one line, close cards, a short plot',
       !/gf-xrow|gf-xax/.test(first) && /\.gf-stack \.gf-card\{ padding:8px 16px 8px/.test(fcss) && /\.gf-stack \.gf-card\{ padding:8px 12px \}/.test(fcss) && /\.gf-stack \.gf-card-head\{ margin-bottom:0;[^}]*flex-wrap:nowrap/.test(fcss)
       && /\.gf-stack\{ display:grid; gap:4px/.test(fcss) && /--gf-h:120px/.test(fcss) && /\.gf-rot \+ \.gf-stack\{ margin-top:-14px \}/.test(fcss));
    ok('the plot\'s lines keep their width when the svg is stretched', /\.gf-plot \.gf-line[^{]*\{ vector-effect:non-scaling-stroke \}/.test(fcss));

    /* THE HOVER'S PLACING is the modern box score's: in screen pixels, divided back by the zoom */
    const fjs = fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'flow.js'), 'utf8');
    ok('the card is placed by the pointer in screen pixels and divided back by the page\'s zoom (theme.css zooms the body 1.5 from 1200px)',
       /const k = tip\.offsetWidth \? \(box\.width \/ tip\.offsetWidth\) \|\| 1 : 1;/.test(fjs) && /tip\.style\.left = \(x \/ k\)/.test(fjs) && /body\{ zoom:1\.5 \}/.test(fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'theme.css'), 'utf8')));
    ok('a mouse hovers, a finger taps; the moment goes with the page\'s scroll or Escape', /e\.pointerType === 'touch'/.test(fjs) && /document\.addEventListener\('scroll'/.test(fjs) && /e\.key === 'Escape'/.test(fjs));
    ok('names in the card are escaped', /st\.on\[i\]\.map\(esc\)\.join/.test(fjs) && /esc\(st\.clock\)/.test(fjs));
    const evil2 = JSON.parse(JSON.stringify(S));
    evil2.teams[0].players[0].name = 'Ada <img src=x onerror=1>';
    ok('a name is escaped in the rotations and nowhere raw in the flow model', !/<img src=x/.test(Flow.render(evil2)));
  } finally {
    delete globalThis.EpinoiaRotation;
  }
}

console.log('\nwired into the game page');
{
  const game = fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'game.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'index.html'), 'utf8');
  ok('the two tabs are offered', /\['flow', 'game flow'\]/.test(game) && /\['connections', 'connections'\]/.test(game));
  ok('...drawn', /flow:\s+\(\) => window\.EpinoiaGameFlow/.test(game) && /connections: \(\) => window\.EpinoiaConnections/.test(game));
  ok('...and bound after every redraw', /fTab === 'flow' && window\.EpinoiaGameFlow\) window\.EpinoiaGameFlow\.mounted\(el\)/.test(game) &&
     /fTab === 'connections' && window\.EpinoiaConnections\) window\.EpinoiaConnections\.mounted\(el\)/.test(game));
  ok('the page loads both modules and their styles before game.js',
     ['flow.css', 'connections.css'].every(f => page.includes('href="' + f + '?v=')) &&
     page.indexOf('src="flow.js?v=') > 0 && page.indexOf('src="connections.js?v=') > 0 &&
     page.indexOf('src="connections.js?v=') < page.indexOf('src="game.js?v='));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
