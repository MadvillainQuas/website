// The play-by-play cards (epinoia/game/pbp.js): which plays are combined into one card. No browser.
//
//   node supabase/tests/pbp-cards.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const P = createRequire(import.meta.url)(path.join(here, '..', '..', 'epinoia', 'game', 'pbp.js'))._test;
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

/* a log: [t, team, pid, clockSeconds, extra] in the order the feed sent it */
function run(rows) {
  const byId = {}, lines = [];
  rows.forEach(([t, team, pid, sec, x], i) => {
    const ev = Object.assign({ id: 'e' + i, t, team, pid, period: (x && x.period) || 1, clock: sec * 1000 }, x || {});
    byId[ev.id] = ev;
    lines.push({ id: ev.id, period: ev.period, clock: ev.clock, s: [0, i] });
  });
  return P.group(lines, byId).map(g => [g.main.ev.t].concat(g.extras.map(x => x.role + ':' + x.ev.t)).join(' + '));
}

console.log('-- what goes together');
ok('a basket and its assist are one card', JSON.stringify(run([['p2_made', 0, 'a', 590], ['ast', 0, 'b', 590]])) === JSON.stringify(['p2_made + assist:ast']));
ok('...with the assist logged first, too', JSON.stringify(run([['ast', 0, 'b', 590], ['p3_made', 0, 'a', 590]])) === JSON.stringify(['p3_made + assist:ast']));
ok('a miss and its rebound are one card', JSON.stringify(run([['p3_miss', 0, 'a', 570], ['reb', 1, 'c', 568, { off: false }]])) === JSON.stringify(['p3_miss + rebound:reb']));
ok('a missed free throw and its rebound too', JSON.stringify(run([['ft_miss', 0, 'a', 300], ['reb', 1, 'c', 300]])) === JSON.stringify(['ft_miss + rebound:reb']));
ok('a miss, the block on it and the rebound: one card, block first', JSON.stringify(run([['p2_miss', 0, 'a', 552], ['blk', 1, 'd', 552], ['reb', 0, 'e', 551, { off: true }]])) === JSON.stringify(['p2_miss + block:blk + rebound:reb']));
ok('a block logged before its miss is still that miss\'s', JSON.stringify(run([['blk', 1, 'd', 552], ['p2_miss', 0, 'a', 552]])) === JSON.stringify(['p2_miss + block:blk']));
ok('a turnover and the steal', JSON.stringify(run([['to', 0, 'a', 400], ['stl', 1, 'f', 400]])) === JSON.stringify(['to + steal:stl']));
ok('a substitution between a miss and the rebound does not split them', JSON.stringify(run([['p2_miss', 0, 'a', 500], ['sub', 1, null, 500, { in: 'x', out: 'y' }], ['reb', 1, 'c', 499]])) === JSON.stringify(['p2_miss + rebound:reb', 'sub']));

console.log('-- what does not');
ok('an assist from the other side is not an assist on this basket', JSON.stringify(run([['p2_made', 0, 'a', 590], ['ast', 1, 'b', 590]])) === JSON.stringify(['p2_made', 'ast']));
ok('an assist seven seconds later is not this basket\'s', JSON.stringify(run([['p2_made', 0, 'a', 590], ['ast', 0, 'b', 583]])) === JSON.stringify(['p2_made', 'ast']));
ok('a rebound after a foul is not the miss\'s (something else happened first)', JSON.stringify(run([['p2_miss', 0, 'a', 500], ['foul', 1, 'z', 499], ['reb', 1, 'c', 499]])) === JSON.stringify(['p2_miss', 'foul', 'reb']));
ok('a rebound in the next period is not the miss\'s', JSON.stringify(run([['p3_miss', 0, 'a', 1], ['reb', 1, 'c', 600, { period: 2 }]])) === JSON.stringify(['p3_miss', 'reb']));
ok('one assist is never given to two baskets', JSON.stringify(run([['p2_made', 0, 'a', 590], ['ast', 0, 'b', 590], ['p2_made', 0, 'c', 589]])) === JSON.stringify(['p2_made + assist:ast', 'p2_made']));
ok('the assister cannot be the scorer', JSON.stringify(run([['p2_made', 0, 'a', 590], ['ast', 0, 'a', 590]])) === JSON.stringify(['p2_made', 'ast']));
ok('every event appears exactly once, whatever is combined', (() => {
  const rows = [['p2_miss', 0, 'a', 552], ['blk', 1, 'd', 552], ['reb', 0, 'e', 551], ['p2_made', 0, 'e', 550], ['ast', 0, 'a', 550], ['to', 1, 'g', 530], ['stl', 0, 'a', 530], ['foul', 1, 'h', 520], ['ft_made', 0, 'a', 520], ['ft_miss', 0, 'a', 520], ['reb', 1, 'i', 519]];
  const n = run(rows).join(' + ').split(' + ').length;
  return n === rows.length;
})());

console.log('-- the kind of card');
const k = t => P.kindOf({ main: { ev: { t } }, extras: [] });
ok('baskets and free throws made score; misses miss; subs and timeouts are slim; quarters are markers',
   k('p3_made') === 'score' && k('ft_made') === 'score' && k('p2_miss') === 'miss' && k('ft_miss') === 'miss' && k('sub') === 'slim' && k('timeout') === 'slim' && k('period_start') === 'marker' && k('to') === 'to');
ok('a made three is worth 3, a free throw 1', P.actionParts({ t: 'p3_made' }).pts === 3 && P.actionParts({ t: 'ft_made' }).pts === 1 && !P.actionParts({ t: 'p2_miss' }).pts);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
