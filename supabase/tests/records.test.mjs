/* ============================================================================
   THE SEASON'S RECORDS (epinoia/records.js) AND THE SECTION SKIP KEYS (nav.js).

     * settle(): the top value, a tie shared and credited to whoever set it first,
       a line the reader cannot be shown passed over, nothing for an empty list;
     * load(): the player records from server-sorted lines (rebounds made exact
       from the offensive and defensive lists), the team records from both sides;
     * the page: the section sits under the Stars, loads records.js, and nav.js
       puts a skip key on every section heading but the last.

     node supabase/tests/records.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const R = require(path.join(ROOT, 'epinoia', 'records.js'));

console.log('\nsettle');
{
  const rows = [
    { v: 30, at: '2026-10-05', game_id: 'c', pid: 'x' },
    { v: 42, at: '2026-10-09', game_id: 'b', pid: 'y' },
    { v: 42, at: '2026-10-02', game_id: 'a', pid: 'z' },
  ];
  const s = R.settle(rows);
  ok('the top value', s.v === 42, s);
  ok('a tie is shared', s.shared === 2, s);
  ok('and credited to whoever set it first', s.holder.pid === 'z', s.holder);
  const hidden = R.settle(rows, r => r.pid !== 'z');
  ok('a line the reader cannot be shown passes the record on', hidden.holder.pid === 'y' && hidden.shared === 1, hidden);
  ok('nothing for an empty list, or only zeros', R.settle([]) === null && R.settle([{ v: 0 }]) === null);
}

console.log('\nload');
{
  const games = [
    { id: 'g1', tipoff_at: '2026-10-01T10:00:00Z', home_team_id: 'H', away_team_id: 'A', home_score: 101, away_score: 70 },
    { id: 'g2', tipoff_at: '2026-10-08T10:00:00Z', home_team_id: 'A', away_team_id: 'H', home_score: 88, away_score: 90 },
  ];
  const lines = {
    pts: [{ game_id: 'g2', player_uuid: 'p1', team_idx: 1, v: 35, games: { tipoff_at: games[1].tipoff_at } }],
    or:  [{ game_id: 'g1', player_uuid: 'p2', team_idx: 0, v_or: 6, v_dr: 5, v: 6, games: { tipoff_at: games[0].tipoff_at } }],
    dr:  [{ game_id: 'g1', player_uuid: 'p3', team_idx: 1, v_or: 1, v_dr: 9, v: 9, games: { tipoff_at: games[0].tipoff_at } }],
  };
  const asked = [];
  globalThis.EpinoiaData = {
    all: async q => { asked.push(q);
      if (q.startsWith('games?')) return games;
      if (q.startsWith('team_game_stats?')) return [
        { game_id: 'g1', team_idx: 0, t_pts: 101, t_p3m: 12, t_ast: 25, t_oreb: 14, t_dreb: 30 },
        { game_id: 'g1', team_idx: 1, t_pts: 70,  t_p3m: 5,  t_ast: 11, t_oreb: 8,  t_dreb: 22 },
        { game_id: 'g2', team_idx: 0, t_pts: 88,  t_p3m: 13, t_ast: 20, t_oreb: 10, t_dreb: 25 },
        { game_id: 'g2', team_idx: 1, t_pts: 90,  t_p3m: 9,  t_ast: 21, t_oreb: 9,  t_dreb: 27 }];
      return []; },
    get: async q => { asked.push(q);
      const k = (q.match(/order=stats->(\w+)\./) || [])[1];
      return lines[k] || []; },
    playerMeta: async ids => Object.fromEntries(ids.map(id => [id, { name: 'P ' + id, slug: id }]))
  };
  const d = await R.load({ comps: ['c1'] });
  const P = Object.fromEntries(d.player.map(r => [r.cat.k, r])), T = Object.fromEntries(d.team.map(r => [r.cat.k, r]));
  ok('points: the line, its club and its opponent', P.pts && P.pts.v === 35 && P.pts.teamId === 'H' && P.pts.oppId === 'A', P.pts);
  ok('rebounds: offensive and defensive added, the best of either list', P.reb && P.reb.v === 11 && P.reb.holder.pid === 'p2', P.reb);
  ok('a record with no lines is left out', !P.stl && !P.blk, Object.keys(P));
  ok('team points and winning margin from the scores', T.pts.v === 101 && T.margin.v === 31 && T.margin.teamId === 'H', [T.pts, T.margin]);
  ok('team threes from the team line', T.p3m.v === 13 && T.p3m.teamId === 'A', T.p3m);
  ok('rebound margin is one side against the other', T.reb.v === 14 && T.reb.teamId === 'H' && T.reb.game.id === 'g1', T.reb);
  ok('the season is its competitions\' finals', asked.every(q => /c1/.test(q) && /status=eq\.final/.test(q)), asked);
  ok('player lines are sorted and cut on the server', asked.filter(q => q.startsWith('player_game_stats')).every(q => /order=stats->\w+\.desc/.test(q) && /limit=\d+/.test(q)));
}

console.log('\nthe page');
{
  const html = rd('epinoia', 'index.html');
  const stars = html.indexOf('id="starsSec"'), recs = html.indexOf('id="recordsSec"'), games = html.indexOf('id="gamesSec"');
  ok('Records sits under the Stars and above the Games', stars > 0 && recs > stars && games > recs);
  ok('the page loads records.js', /<script src="records\.js\?v=\d+" defer><\/script>/.test(html));
  const home = rd('epinoia', 'home.js');
  ok('home.js draws it with the rest of the league page, not behind a members wall', /wall\.walled \? null : records\(\)/.test(home));
  const nav = rd('epinoia', 'nav.js');
  ok('nav.js puts a skip key on each section but the last', /tt-skip/.test(nav) && /if \(!next\) \{ if \(b\) b\.remove\(\); return; \}/.test(nav));
  ok('the key moves focus to the section it lands on', /to\.focus\(\{ preventScroll: true \}\)/.test(nav));
  ok('the key is styled in the teletext layer', /\.tt-skip\{/.test(rd('epinoia', 'kit', 'teletext.css')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
