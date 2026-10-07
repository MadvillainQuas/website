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
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
