/* ============================================================================
   THE LEAGUE NEWSDESK (epinoia/narrative.js) SAYS TRUE THINGS, AND KEEPS ITS STORYLINES STRAIGHT.

   A storyline is a claim about many games, so the tests hold: which storylines open (and on how much evidence), the
   threading from one build to the next (developing with a note of what changed, resolved with how it ended, kept and
   then dropped), the ranking (no club crowding the top), the rule that no sentence goes out with an empty slot, and the
   coverage plan the creator hub draws (the slate in order of what is at stake, the recaps, the calendar).

       node supabase/tests/narrative.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, 'epinoia', 'narrative.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.error('  FAIL  ' + n + (d ? '  -> ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500) : '')); } };

/* ------------------------------------------------------------ a league --- */
const T = ['t1', 't2', 't3', 't4', 't5', 't6'];
const teams = {}; T.forEach((id, i) => { teams[id] = { name: ['Ash', 'Birch', 'Cedar', 'Damson', 'Elm', 'Fir'][i] + ' City', slug: 'club' + i }; });
const NOW = Date.UTC(2026, 10, 30, 12);
const at = d => new Date(NOW - d * 86400000).toISOString();
let n = 0;
const games = [];
const g = (d, h, a, hs, as) => { const x = { id: 'g' + (++n), home_team_id: h, away_team_id: a, home_score: hs, away_score: as, tipoff_at: at(d) }; games.push(x); return x; };
/* t1: lost once early, then won five straight (the run); t6: lost everything (winless); t2 good; the rest mixed */
g(40, 't1', 't2', 70, 80);
g(38, 't3', 't1', 70, 85); g(33, 't1', 't4', 90, 70); g(26, 't5', 't1', 66, 80); g(19, 't1', 't6', 95, 60); g(3, 't1', 't3', 88, 86);
g(39, 't2', 't3', 82, 70); g(32, 't4', 't2', 70, 75); g(25, 't2', 't6', 90, 50); g(18, 't5', 't2', 80, 78); g(4, 't2', 't4', 85, 80);
g(37, 't3', 't6', 80, 60); g(31, 't6', 't5', 60, 70); g(24, 't4', 't6', 90, 70); g(17, 't6', 't3', 70, 72); g(2, 't5', 't6', 81, 79);
g(30, 't4', 't5', 77, 75); g(23, 't3', 't4', 69, 71); g(16, 't5', 't3', 72, 70); g(1, 't4', 't3', 70, 74);
const fixtures = [{ id: 'f1', home_team_id: 't1', away_team_id: 't2', tipoff_at: new Date(NOW + 2 * 86400000).toISOString() },
                  { id: 'f2', home_team_id: 't6', away_team_id: 't5', tipoff_at: new Date(NOW + 3 * 86400000).toISOString() }];
/* the table after these games */
const C = {};
games.forEach(x => { [x.home_team_id, x.away_team_id].forEach(id => { C[id] = C[id] || { w: 0, l: 0 }; }); const hw = x.home_score > x.away_score;
  C[x.home_team_id][hw ? 'w' : 'l']++; C[x.away_team_id][hw ? 'l' : 'w']++; });
const table = { comp: { id: 'c1', name: 'The League' }, rows: T.map(id => ({ team_id: id, gp: C[id].w + C[id].l, w: C[id].w, l: C[id].l, rank: null, group_name: null })) };
/* a scorer on t1 with 20+ in his last four */
const lines = [];
games.filter(x => x.home_team_id === 't1' || x.away_team_id === 't1').forEach((x, i) => {
  lines.push({ game_id: x.id, team_idx: x.home_team_id === 't1' ? 0 : 1, pid: 'p1', min: 1800000, pts: i >= 2 ? 24 : 12, reb: 5, ast: 3, stl: 1, blk: 0, p3m: 2 });
});
const names = { p1: { name: 'Pat Archer', slug: 'pat-archer' } };
const base = { now: new Date(NOW), league: { id: 'L', slug: 'test', name: 'Test League', timezone: 'Europe/London' }, season: { id: 'S', name: '2026-27' },
  comp: table.comp, table, teams, games, fixtures, lines, names, recaps: { g6: { headline: 'Ash City edge Cedar City 88–86', standfirst: 'It went to the last shot.', arc: 'tight', moment: { kind: 'gameWinner', name: 'Pat Archer' } } } };

const b1 = N.build(base);
const byId = id => b1.stories.find(s => s.id === id);
console.log('\nthe storylines that open');
ok('a winning run after a defeat is a storyline', byId('run:t1') && byId('run:t1').tracks.value === 5, b1.stories.map(s => s.id));
ok('...with the games it rests on', byId('run:t1') && byId('run:t1').games.length === 5);
ok('the race at the top is a storyline', !!byId('race:top'));
ok('a winless side is a storyline', !!byId('winless:t6'));
ok('a run of 20-point games is a storyline', byId('scoring:p1') && byId('scoring:p1').tracks.value === 4, byId('scoring:p1'));
ok('the game of the week comes from the match report’s recap', b1.stories.some(s => s.kind === 'gotw' && s.head === 'Ash City edge Cedar City 88–86'));
ok('every storyline is new on a first build', b1.stories.every(s => s.status === 'new' && s.version === 1));
{
  const texts = b1.stories.flatMap(s => [s.head, s.dek, s.why, s.counter, s.next].concat(s.body || []).concat((s.numbers || []).map(x => x.label + ' ' + x.value))).filter(t => t != null);
  const bad = texts.filter(t => /\b(undefined|NaN|null|Infinity)\b|\[object/.test(String(t)));
  ok('no sentence carries an empty slot', !bad.length, bad);
}
ok('every headline starts with a capital', b1.stories.every(s => /^[A-Z0-9“"‘']/.test(s.head)), b1.stories.map(s => s.head));
ok('the copy carries the why and what is next', byId('run:t1') && /Why it matters: /.test(byId('run:t1').copy));
/* best effort: a third storyline about the same club waits behind every storyline that does not crowd it (here the
   league is too small to fill six without one, so it is the sixth at the earliest) */
ok('a club’s third storyline waits behind the others', (() => { const c = {}; return b1.stories.slice(0, 5).every(s => (s.teams || []).every(t => { c[t] = (c[t] || 0) + 1; return c[t] <= 2; })); })(), b1.stories.slice(0, 6).map(s => s.id + ':' + s.teams));

console.log('\nwho is missing, and how many of a kind');
{
  /* p9 played 30 minutes in t1's first four games and none of the last two */
  const t1g = games.filter(x => x.home_team_id === 't1' || x.away_team_id === 't1');
  const extra = t1g.slice(0, 4).map(x => ({ game_id: x.id, team_idx: x.home_team_id === 't1' ? 0 : 1, pid: 'p9', min: 1800000, pts: 11, reb: 4, ast: 2, stl: 0, blk: 0, p3m: 1 }));
  const bm = N.build(Object.assign({}, base, { lines: lines.concat(extra), names: Object.assign({}, names, { p9: { name: 'Mo Ash' } }) }));
  const ab = bm.stories.find(s => s.id === 'absence:p9');
  ok('a rotation player who has missed the last two games is a storyline', ab && ab.tracks.value === 2, bm.stories.map(s => s.id));
  ok('...said as not playing, never as a reason', ab && /has not played in Ash City’s last two games/.test(ab.head) && !/injur|hurt|ill\b/i.test(JSON.stringify(ab)), ab && ab.head);
  /* a suspension the league has recorded is the one reason that is said */
  const bb = N.build(Object.assign({}, base, { lines: lines.concat(extra), names: Object.assign({}, names, { p9: { name: 'Mo Ash' } }), bans: { p9: { games: 3, served: 2, endsOn: null } } }));
  const sb = bb.stories.find(s => s.id === 'absence:p9');
  ok('a recorded suspension is said, with the games left', sb && sb.kicker === 'Serving a suspension' && sb.head === 'Mo Ash is suspended, with one game left to serve', sb && [sb.kicker, sb.head]);
  ok('...and how long it is', sb && /^Out of Ash City’s last two games: a suspension of three games\. Ash City are /.test(sb.dek), sb && sb.dek);
  ok('...with the record without them', ab && ab.numbers.some(x => x.label === 'record without' && x.value === '2–0'), ab && ab.numbers);
  /* forty upsets do not make a desk: no kind past its cap, no more than two dozen running */
  const many = N.build(Object.assign({}, base, { now: new Date(NOW) }));
  const counts = {};
  many.stories.filter(s => s.status !== 'resolved').forEach(s => { counts[s.kind] = (counts[s.kind] || 0) + 1; });
  ok('no kind past its cap, and no more than 24 running', Object.keys(counts).every(k => counts[k] <= 4) && many.stories.filter(s => s.status !== 'resolved').length <= 24, counts);
}

console.log('\nthreading, from one build to the next');
{
  /* an hour later t1 has won again: the run is the same storyline, developing, version 2 */
  const g2 = games.concat([{ id: 'g99', home_team_id: 't1', away_team_id: 't5', home_score: 90, away_score: 80, tipoff_at: new Date(NOW + 3600000).toISOString() }]);
  const b2 = N.build(Object.assign({}, base, { now: new Date(NOW + 2 * 3600000), games: g2, previous: b1 }));
  const r = b2.stories.find(s => s.id === 'run:t1');
  ok('a run that grew is the same storyline, developing', r && r.status === 'developing' && r.version === 2 && r.tracks.value === 6, r);
  ok('...with a note of what changed', r && /six straight \(was five\)/.test(r.change || ''), r && r.change);
  ok('...and keeps the time it first opened', r && r.first === byId('run:t1').first);
  /* and then it ends */
  const g3 = g2.concat([{ id: 'g100', home_team_id: 't2', away_team_id: 't1', home_score: 81, away_score: 79, tipoff_at: new Date(NOW + 5 * 3600000).toISOString() }]);
  const b3 = N.build(Object.assign({}, base, { now: new Date(NOW + 6 * 3600000), games: g3, previous: b2 }));
  const e = b3.stories.find(s => s.id === 'run:t1');
  ok('a run that ended is resolved, not dropped', e && e.status === 'resolved', e);
  ok('...and says how it ended', e && /Ended at six by Birch City, 81–79/.test(e.change || ''), e && e.change);
  ok('...ranked below what is still running', e && b3.stories.indexOf(e) > b3.stories.findIndex(s => s.status !== 'resolved'));
  const b4 = N.build(Object.assign({}, base, { now: new Date(NOW + 6 * 3600000 + 4 * 86400000), games: g3, previous: b3 }));
  ok('a resolved storyline is dropped after three days', !b4.stories.some(s => s.id === 'run:t1'));
}

{
  /* a storyline an older engine wrote is not "resolved" by a new engine that does not write it */
  const old = Object.assign({}, b1, { engine: N.VERSION - 1, stories: b1.stories.concat([Object.assign({}, b1.stories[0], { id: 'identity:gone', kind: 'identity', status: 'new' })]) });
  const bv = N.build(Object.assign({}, base, { previous: old }));
  ok('an engine change resolves nothing it did not write', !bv.stories.some(s => s.id === 'identity:gone'), bv.stories.filter(s => s.status === 'resolved').map(s => s.id));
  ok('...and carries the storylines it still writes', bv.stories.some(s => s.id === 'run:t1'));
}

console.log('\nthe closer (clutch time, from the replayed recaps)');
{
  const rc = Object.assign({}, base.recaps, { g6: Object.assign({}, base.recaps.g6, { clutch: { sec: 240, pts: [12, 9], players: [{ pid: 'p1', side: 0, pts: 9, name: 'Pat Archer' }] } }) });
  const bc = N.build(Object.assign({}, base, { recaps: rc }));
  const c = bc.stories.find(s => s.kind === 'closer');
  ok('the week’s points in clutch time make a storyline', c && c.head === 'Pat Archer scored 9 points in clutch time this week', c && c.head);
  ok('...against the club’s in the same minutes', c && c.dek === 'That is 9 of Ash City’s 12 points in the closing minutes of a close game they won.', c && c.dek);
  ok('...and not from a handful of points', !N.build(Object.assign({}, base, { recaps: Object.assign({}, rc, { g6: Object.assign({}, rc.g6, { clutch: { sec: 240, pts: [5, 4], players: [{ pid: 'p1', side: 0, pts: 4 }] } }) }) })).stories.some(s => s.kind === 'closer'));
}

console.log('\nthe storylines each game touches (the preview’s threads)');
{
  const f1 = b1.coverage.slate.find(s => s.game === 'f1');
  ok('a fixture carries the running storylines of its clubs', f1 && f1.threads.some(t => t.story === 'run:t1' && /^Ash City’s run of five straight wins is on the line$/.test(t.line)), f1 && f1.threads);
  ok('...and of their players', f1 && f1.threads.some(t => t.story === 'scoring:p1' && /^Pat Archer’s run of four straight 20-point games is on the line$/.test(t.line)), f1 && f1.threads);
  /* a later game of the same club does not: by then the run may be over */
  const later = N.build(Object.assign({}, base, { fixtures: base.fixtures.concat([{ id: 'f9', home_team_id: 't3', away_team_id: 't1', tipoff_at: new Date(NOW + 6 * 86400000).toISOString() }]) }));
  const f9 = later.coverage.slate.find(s => s.game === 'f9');
  ok('...only on the club’s next game', f9 && !f9.threads.some(t => t.story === 'run:t1'), f9 && f9.threads);
}

console.log('\nthe briefing and the coverage plan');
ok('the briefing leads with the top storyline and ends', b1.briefing.lead === b1.stories[0].id && /^The story: /.test(b1.briefing.lines[0]) && !!b1.briefing.end);
ok('the slate is in order of what is at stake', b1.coverage.slate.length === 2 && b1.coverage.slate[0].stakes >= b1.coverage.slate[1].stakes, b1.coverage.slate.map(s => s.title + ' ' + s.stakes));
ok('...each with a plan for covering it', b1.coverage.slate.every(s => Array.isArray(s.plan) && s.plan.length));
ok('the big picture says who leads', b1.coverage.bigPicture.some(p => /lead at/.test(p)), b1.coverage.bigPicture);
ok('the calendar has the preview the day before the big game', b1.coverage.calendar.some(d => d.items.some(i => i.kind === 'preview' && i.game === 'f1')), b1.coverage.calendar);
ok('...and a round-up of the week', b1.coverage.calendar.some(d => d.items.some(i => i.kind === 'roundup')));
ok('the recaps worth writing are ranked, the close one first', b1.coverage.recaps.length > 0 && b1.coverage.recaps[0].game === 'g6', b1.coverage.recaps.map(r => r.game + ':' + r.score));
ok('clubs to feature carry their storylines', b1.coverage.teams.some(t => t.id === 't1' && t.stories.indexOf('run:t1') >= 0));

console.log('\nthe facets of a game, valued (What Wins)');
{
  const teamLines = [];
  games.forEach(x => {
    const hw = x.home_score > x.away_score;
    teamLines.push({ game_id: x.id, team_idx: 0, adv: { efg: hw ? 55 : 45, tovp: 13, orebp: 28, ftr: 25, possessions: 72, fga: 64, fgm: 30, fg3a: 22, fg3m: 8, fta: 16, ftm: 12, oreb: 10, dreb: 26, tov: 11 } });
    teamLines.push({ game_id: x.id, team_idx: 1, adv: { efg: hw ? 45 : 55, tovp: 13, orebp: 28, ftr: 25, possessions: 72, fga: 64, fgm: 30, fg3a: 22, fg3m: 8, fta: 16, ftm: 12, oreb: 10, dreb: 26, tov: 11 } });
  });
  const bf = N.build(Object.assign({}, base, { teamLines, model: { n: 50, home: 1, b: { efg: 1, tovp: -1, orebp: 0.4, ftr: 0.15 } } }));
  ok('every game’s deciding facet is found (here: shooting)', /shooting has been the deciding facet 100%/.test(bf.coverage.bigPicture.join(' ')), bf.coverage.bigPicture);
  ok('the slate says what the matchup turns on', bf.coverage.slate.every(s => s.turn === null || typeof s.turn.label === 'string'));
  /* every game here was decided by shooting, so every club wins and loses on it: true of everybody, news about nobody */
  ok('a facet that decides every club’s games is nobody’s story', !bf.stories.some(s => s.kind === 'identity'), bf.stories.filter(s => s.kind === 'identity').map(s => s.head));
}

console.log('\nthe competitions: the regular season, the play-offs, a two-legged tie');
{
  const comps = [{ id: 'c1', kind: 'league', name: 'The League' }, { id: 'po', kind: 'playoff', name: 'Play-offs' }];
  const reg = games.map(x => Object.assign({}, x, { competition_id: 'c1' }));
  /* Game 1: Damson City (4th) win at Ash City (1st); Game 2 is filed under the league, as several feeds file a fixture */
  const po1 = { id: 'po1', home_team_id: 't1', away_team_id: 't4', home_score: 70, away_score: 75, tipoff_at: new Date(NOW - 6 * 3600000).toISOString(), competition_id: 'po' };
  const fx = [{ id: 'po2', home_team_id: 't1', away_team_id: 't4', tipoff_at: new Date(NOW + 2 * 86400000).toISOString(), competition_id: 'c1' }];
  const bp = N.build(Object.assign({}, base, { comps, games: reg.concat([po1]), fixtures: fx, rest: [{ h: 't1', a: 't4', at: fx[0].tipoff_at }] }));
  const ser = bp.stories.find(s => s.kind === 'series');
  ok('a play-off game is a series, not a regular-season result', ser && ser.head === 'Damson City take Game 1 against Ash City', bp.stories.map(s => s.head));
  ok('...and a game filed under the league after it is Game 2', ser && /^Game 2 is on .*, with Ash City at home\.$/.test(ser.next || ''), ser && ser.next);
  ok('...the lower seed leading is why it matters', ser && /^The lower seed has the lead: Ash City finished three places above them\.$/.test(ser.why), ser && ser.why);
  ok('the regular season is over: who finished top, and no race', bp.stories.some(s => s.kind === 'final') && !bp.stories.some(s => s.kind === 'race'), bp.stories.map(s => s.id));
  ok('...on the regular season’s record (the play-off defeat is not in it)', bp.stories.some(s => s.kind === 'final' && s.head === 'Ash City finish top at 5–1'), bp.stories.filter(s => s.kind === 'final').map(s => s.head));
  ok('...and no run or slide carries over into the play-offs', !bp.stories.some(s => ['run', 'skid', 'perfect', 'winless'].includes(s.kind)), bp.stories.map(s => s.id));
  ok('the slate says which game of the series', bp.coverage.slate.some(s => s.series && s.series.game === 2 && /^Game 2: Damson City lead Ash City 1–0/.test(s.angle)), bp.coverage.slate.map(s => s.angle));
  ok('the big picture starts with the play-offs', /^The play-offs: Damson City lead Ash City 1–0/.test(bp.coverage.bigPicture[0] || ''), bp.coverage.bigPicture);

  /* a qualifying tie over two legs: 80-67 and 61-73 is 141-140 on aggregate, never "level at 1-1" */
  const q = [{ id: 'c1', kind: 'league' }, { id: 'q', kind: 'playoff', name: 'Qualifiers' }];
  const leg1 = { id: 'q1', home_team_id: 't3', away_team_id: 't6', home_score: 80, away_score: 67, tipoff_at: at(9), competition_id: 'q' };
  const leg2 = { id: 'q2', home_team_id: 't6', away_team_id: 't3', home_score: 73, away_score: 61, tipoff_at: at(6), competition_id: 'q' };
  const ties = [{ competition_id: 'q', label: 'Qualifiers', home_team_id: 't3', away_team_id: 't6', winner_team_id: 't3', legs: 2, decider: 'aggregate' }];
  const bq = N.build(Object.assign({}, base, { comps: q, games: reg.concat([leg1, leg2]), ties }));
  const tie = bq.stories.find(s => s.kind === 'series');
  ok('a two-legged tie is decided on aggregate, not by wins', tie && tie.head === 'Cedar City go through on aggregate, 141–140', tie && tie.head);
  ok('...told leg by leg', tie && tie.dek === 'First leg: Cedar City 80–67 Fir City; second leg: Fir City 73–61 Cedar City.', tie && tie.dek);
  ok('...with how close it was', tie && tie.why === 'Decided by one point over two legs.', tie && tie.why);
  ok('...under the bracket’s own name', tie && tie.kicker === 'Qualifiers', tie && tie.kicker);
}

console.log('\nthe season’s shape: how far through it, who can still catch whom');
{
  /* a 40-game season eight games in */
  const early = N.build(Object.assign({}, base, { remaining: { t1: 34, t2: 34, t3: 32, t4: 33, t5: 34, t6: 33 }, lastRegularAt: at(-150) }));
  const race = early.stories.find(s => s.kind === 'race');
  ok('early on, the race says how far through the season it is', race && /^Seven games into a 40-game season, the table is a first draft/.test(race.why), race && race.why);
  ok('...and the big picture says it too', early.coverage.bigPicture.some(p => /^Seven games into a 40-game regular season/.test(p)), early.coverage.bigPicture);
  /* the run-in: one game each left, the top three go through */
  const late = N.build(Object.assign({}, base, { comp: { id: 'c1', name: 'The League', qualifiers: 3 }, remaining: { t1: 1, t2: 1, t3: 0, t4: 1, t5: 1, t6: 1 },
    lastRegularAt: at(-7), lastTotal: 8 }));
  const r2 = late.stories.find(s => s.kind === 'race');
  ok('in the run-in, the race says who can still catch the leaders', r2 && r2.why === 'With one game left, two clubs can still catch them.', r2 && r2.why);
  ok('a club nobody can push out of the top three is through', ['through:t1', 'through:t2'].every(id => late.stories.some(s => s.id === id)), late.stories.map(s => s.id));
  ok('...one that can no longer reach it is out of it', late.stories.some(s => s.id === 'out:t3') && !late.stories.some(s => s.id === 'out:t4'), late.stories.map(s => s.id));
  /* the same counts from a feed that loads a fortnight ahead, with no season to compare: not trusted, so no run-in claims */
  const partial = N.build(Object.assign({}, base, { comp: { id: 'c1', name: 'The League', qualifiers: 3 }, remaining: { t1: 1, t2: 1, t3: 0, t4: 1, t5: 1, t6: 1 }, lastRegularAt: at(-7) }));
  ok('...but never on a schedule that may be half loaded', !partial.stories.some(s => s.kind === 'through' || s.kind === 'out') && !/can still catch/.test((partial.stories.find(s => s.kind === 'race') || {}).why || ''),
    partial.stories.map(s => s.id));
}

console.log('\nthe week’s results, read as a desk reads them');
{
  /* Elm City beat Fir City twice in two days: one storyline, not two */
  const two = games.concat([{ id: 'gx', home_team_id: 't6', away_team_id: 't5', home_score: 70, away_score: 77, tipoff_at: at(1.5) }]);
  const bw = N.build(Object.assign({}, base, { games: two }));
  ok('two games against the same side in a few days are one storyline: a sweep', bw.stories.some(s => s.kind === 'sweep' && s.head === 'Elm City sweep Fir City'), bw.stories.map(s => s.head));
  /* an upset by the numbers: the match report's season context had Damson City by six at home */
  const bu = N.build(Object.assign({}, base, { recaps: Object.assign({}, base.recaps, { g20: { headline: 'Cedar City stun Damson City 74–70', expect: 6, decisive: { key: 'efg', label: 'the shots that fell', pts: 7 } } }) }));
  const u = bu.stories.find(s => s.id === 'upset:g20');
  ok('an upset by the numbers says what the numbers said before the tip', u && /The season’s numbers had Damson City by about six before the tip\./.test(u.dek), u && u.dek);
  ok('...and a plural facet takes a plural verb', u && /The shots that fell were worth about 7 points to them\./.test(u.dek), u && u.dek);
  /* a run's next game away from home reads as a sentence */
  const ba = N.build(Object.assign({}, base, { fixtures: [{ id: 'f9', home_team_id: 't2', away_team_id: 't1', tipoff_at: new Date(NOW + 2 * 86400000).toISOString() }] }));
  const run = ba.stories.find(s => s.id === 'run:t1');
  ok('“It goes on the line away at …” reads as a sentence', run && /^It goes on the line away at Birch City on /.test(run.next || ''), run && run.next);
}

console.log('\neverything else the site publishes: coverage, significance, highlights, the schedule, ages, the fans');
{
  const news = { reports: { g6: { title: 'Ash City edge Cedar City 88–86', href: 'news/?l=test&a=report-g6', at: at(2.9) } },
    pieces: [{ kind: 'creator', id: 'c1', title: 'How Pat Archer became unstoppable', summary: '', at: at(1), href: 'creators/?l=test&o=desk&p=archer' },
             { kind: 'news', id: 'n1', title: 'Ash City keep winning', summary: 'A fifth straight for Ash City.', at: at(1.5), href: 'news/?i=n1' },
             { kind: 'news', id: 'n2', title: 'Elm City sign a guard', summary: '', at: at(2), href: 'news/?i=n2' }] };
  const bn = N.build(Object.assign({}, base, { news }));
  const sc = bn.stories.find(s => s.id === 'scoring:p1'), rn = bn.stories.find(s => s.id === 'run:t1');
  ok('a player’s storyline cites the piece that names the player', sc && sc.pieces.some(p => p.href === 'creators/?l=test&o=desk&p=archer'), sc && sc.pieces);
  ok('...and not a piece that only names the club', sc && !sc.pieces.some(p => p.href === 'news/?i=n1'), sc && sc.pieces);
  ok('a club’s storyline cites the piece that names the club, and the match report of its games', rn && rn.pieces.some(p => p.href === 'news/?i=n1') && rn.pieces.some(p => p.kind === 'report'), rn && rn.pieces);
  ok('the race needs two of its clubs named', (() => { const r = bn.stories.find(s => s.id === 'race:top'); return r && !r.pieces.some(p => p.href === 'news/?i=n1'); })());
  ok('the plan lists what has been written, with the storylines each covers', (bn.coverage.written || []).some(w => w.href === 'news/?i=n1' && w.stories.includes('run:t1')), bn.coverage.written);
  ok('...and the storylines nobody has written about', Array.isArray(bn.coverage.gaps) && bn.coverage.gaps.length > 0 && !bn.coverage.gaps.includes('run:t1'), bn.coverage.gaps);
  ok('without the news read, no gaps are claimed', b1.coverage.gaps === null);

  /* the site's significance lifts a game up the recaps and says why; its highlights are linked */
  const bs = N.build(Object.assign({}, base, { significance: { g20: { points: 60, reasons: ['52-point game: Pat Archer'] } }, highlights: { g6: true } }));
  const r20 = bs.coverage.recaps.find(r => r.game === 'g20');
  ok('a significant game is ranked higher among the recaps', r20 && bs.coverage.recaps.indexOf(r20) <= 1, bs.coverage.recaps.map(r => r.game + ':' + r.score));
  ok('...with the reasons the site gives', r20 && r20.reasons && r20.reasons[0] === '52-point game: Pat Archer');
  ok('the game of the week links its highlights', bs.stories.some(s => s.kind === 'gotw' && s.links.some(l => l.href === 'watch/?g=g6')), bs.stories.filter(s => s.kind === 'gotw').map(s => s.links));

  /* the schedule so far: Elm City (4-2) have had the hardest opponents; Birch City have the best adjusted margins */
  const sos = { t1: { sosNet: -2, adjNet: 4, games: 6 }, t2: { sosNet: 1, adjNet: 9, games: 6 }, t3: { sosNet: 0, adjNet: -2, games: 8 },
    t4: { sosNet: 0.5, adjNet: -1, games: 7 }, t5: { sosNet: 3, adjNet: 2, games: 6 }, t6: { sosNet: 2, adjNet: -12, games: 7 } };
  const bo = N.build(Object.assign({}, base, { sos }));
  ok('a winning record against the hardest schedule is a storyline', bo.stories.some(s => s.kind === 'schedule' && s.head === 'Elm City’s 4–2 has come against the hardest schedule in the league'),
    bo.stories.filter(s => s.kind === 'schedule').map(s => s.head));
  ok('the best side by adjusted margins, when it is not the leader, is a storyline', bo.stories.some(s => s.kind === 'adjusted' && /Birch City are the best side in the league$/.test(s.head)),
    bo.stories.filter(s => s.kind === 'adjusted').map(s => s.head));
  ok('a run against the easiest schedule hears "yes, but"', (() => { const r = bo.stories.find(s => s.id === 'run:t1'); return r && /easier schedule/.test(r.counter || '') || (r && /above them/.test(r.counter || '')); })());

  /* a fresh blowout is a team record; the best player aged 21 or under; the fans' vote from a real number of ballots */
  const blow = games.concat([{ id: 'gb', home_team_id: 't2', away_team_id: 't6', home_score: 110, away_score: 60, tipoff_at: at(0.5) }]);
  const bt = N.build(Object.assign({}, base, { games: blow }));
  ok('the season’s biggest win, set this week, is a team record', bt.stories.some(s => s.kind === 'teambest' && s.head === 'Birch City’s 50-point win over Fir City is the biggest of the season'),
    bt.stories.filter(s => s.kind === 'teambest').map(s => s.head));
  const by = N.build(Object.assign({}, base, { players: [{ id: 'p1', gp: 6, mpg: 30, bpm: 5.2, ppg: 20, rpg: 5, apg: 3 }], bio: { p1: { age: 20 } } }));
  ok('the best player aged 21 or under is a storyline, with the age', by.stories.some(s => s.kind === 'youth' && s.head === 'Pat Archer, 20, is the best young player in the league by the numbers'),
    by.stories.filter(s => s.kind === 'youth').map(s => s.head));
  const fv = { week: '2026-11-23', endsAt: at(1), ballots: 30, player: { id: 'p1', name: 'Pat Archer', team: 't1', share: 47, line: { bpm: 3.1, ppg: 22 } },
    others: [{ id: 'p2', name: 'Bo Birch', share: 30, line: { bpm: 6.0 } }] };
  const bf = N.build(Object.assign({}, base, { fanvote: fv }));
  const f = bf.stories.find(s => s.kind === 'fans');
  ok('the fans’ player of the week, beside the numbers’ pick', f && f.head === 'The fans’ player of the week: Pat Archer' && /Bo Birch’s BPM was \+6\.0/.test(f.why), f && [f.head, f.why]);
  ok('...but never from a handful of ballots', !N.build(Object.assign({}, base, { fanvote: Object.assign({}, fv, { ballots: 5 }) })).stories.some(s => s.kind === 'fans'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
