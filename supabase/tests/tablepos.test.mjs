/* ============================================================================
   WHERE THE TWO CLUBS STAND (epinoia/tablepos.js): the line under each club's
   name on the box score and the preview, and the preview's table.

     node supabase/tests/tablepos.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const TP = require(path.join(ROOT, 'epinoia', 'tablepos.js'));

console.log('\nordinal');
ok('1st 2nd 3rd 4th', ['1st', '2nd', '3rd', '4th'].every((x, i) => TP.ordinal(i + 1) === x));
ok('11th 12th 13th, then 21st 22nd 23rd, 101st, 111th', TP.ordinal(11) === '11th' && TP.ordinal(12) === '12th' && TP.ordinal(13) === '13th' &&
   TP.ordinal(21) === '21st' && TP.ordinal(22) === '22nd' && TP.ordinal(23) === '23rd' && TP.ordinal(101) === '101st' && TP.ordinal(111) === '111th');
ok('no place for nought or nothing', TP.ordinal(0) === '' && TP.ordinal(null) === '');

console.log('\nplace');
const row = (id, rank, gp, g) => ({ team_id: id, rank, gp, w: gp, l: 0, diff: 0, league_points: gp * 2, group_name: g || null, teams: { name: 'Club ' + id, slug: 's' + id } });
const T = { comp: { name: 'B.LEAGUE One' }, rows: [row('a', 1, 2), row('b', 2, 2), row('c', 3, 1)] };
ok('a club in a played table: its place, in the league', (TP.place(T, 'b') || {}).text === '2nd in B.LEAGUE One', TP.place(T, 'b'));
ok('nothing before anybody has played', TP.place({ comp: T.comp, rows: [row('a', 1, 0), row('b', 2, 0)] }, 'a') === null);
ok('nothing for a club not in the table, or no table', TP.place(T, 'z') === null && TP.place(null, 'a') === null);
const G = { comp: { name: 'ProB' }, rows: [row('a', 1, 3, 'Nord'), row('b', 1, 0, 'Süd'), row('c', 2, 0, 'Süd'), row('d', 1, 2, 'NBL1 South')] };
ok('a league with groups: the place in the club\'s own group', (TP.place(G, 'a') || {}).text === '1st in Group Nord');
ok('a group named for itself keeps its name', (TP.place(G, 'd') || {}).text === '1st in NBL1 South');
ok('a group where nobody has played says nothing, whatever the other groups have done', TP.place(G, 'b') === null);

console.log('\ntableHTML');
{
  const rows = Array.from({ length: 20 }, (_, i) => row('t' + i, i + 1, 3));
  const html = TP.tableHTML({ comp: { name: 'L' }, rows }, ['t9', 't17'], { base: '../', colours: { t9: '#ff0000' } });
  ok('both clubs lit, the first in the colour it was given', /<tr class="lit" style="--tc:#ff0000">[\s\S]*?Club t9/.test(html) && (html.match(/class="lit"/g) || []).length === 2);
  ok('a long table is cut to the top and the stretch around the two clubs, with a gap row', /tp-gap/.test(html) && !/Club t5</.test(html) && /Club t0</.test(html) && /Club t11</.test(html));
  ok('clubs link to their pages', /href="\.\.\/t\/\?t=st9"/.test(html));
  ok('no table before anybody has played', TP.tableHTML({ comp: {}, rows: [row('a', 1, 0), row('b', 2, 0)] }, ['a', 'b']) === '');
}

console.log('\nthe pages');
{
  const game = rd('epinoia', 'game', 'game.js'), idx = rd('epinoia', 'game', 'index.html'), pv = rd('epinoia', 'game', 'preview.js');
  ok('the game page loads tablepos.js before game.js', idx.indexOf('tablepos.js') > 0 && idx.indexOf('tablepos.js') < idx.indexOf('src="game.js'));
  ok('the scoreboard\'s line is only on the scoreboard', /if \(!node\.closest\('\.bx-scorehead'\) \|\| node\.querySelector\('\.bt-pos'\)\) return;/.test(game));
  ok('the table is read once, not on every live redraw', /let TABLE = null, tableAsked = false;/.test(game));
  ok('the preview gets both places and the table', /placeA: pA && pA\.text, placeB: pB && pB\.text/.test(game) && /tableHTML: TP && table/.test(game));
  ok('the preview draws the table section only when there is one', /\(ctx\.tableHTML\s*\n?\s*\? '<section class="pv-sec pv-table">'/.test(pv));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
