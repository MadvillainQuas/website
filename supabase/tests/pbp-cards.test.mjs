// The play-by-play cards (epinoia/game/pbp.js): which plays are combined into one card. No browser.
//
//   node supabase/tests/pbp-cards.test.mjs
import fs from 'node:fs';
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

console.log('-- a three-play chain: the shot, the block, the rebound');
ok('a miss, the block on it and the rebound eight seconds later are one card (the feed stamps a rebound when it is entered: 3PT missed, block, offensive rebound)',
   JSON.stringify(run([['p3_miss', 0, 'a', 572], ['blk', 1, 'd', 572], ['reb', 0, 'e', 564, { off: true }]])) === JSON.stringify(['p3_miss + block:blk + rebound:reb']));
ok('...up to fifteen seconds after the shot', JSON.stringify(run([['p2_miss', 0, 'a', 500], ['reb', 1, 'c', 486]])) === JSON.stringify(['p2_miss + rebound:reb']));
ok('...but a rebound half a minute later is not this miss\'s', JSON.stringify(run([['p2_miss', 0, 'a', 500], ['reb', 1, 'c', 470]])) === JSON.stringify(['p2_miss', 'reb']));
ok('...and the rebound after ANOTHER shot is never the first miss\'s, however near', JSON.stringify(run([['p2_miss', 0, 'a', 500], ['p2_miss', 1, 'b', 497], ['reb', 0, 'c', 496]])) === JSON.stringify(['p2_miss', 'p2_miss + rebound:reb']));
ok('...a block and a substitution between the miss and its rebound do not split the chain', JSON.stringify(run([['p3_miss', 0, 'a', 572], ['blk', 1, 'd', 572], ['sub', 0, null, 570, { in: 'x', out: 'y' }], ['reb', 0, 'e', 565]])) === JSON.stringify(['p3_miss + block:blk + rebound:reb', 'sub']));

console.log('-- substitutions: a card per team per stoppage');
const sub = (team, sec, i, o, extra) => ['sub', team, null, sec, Object.assign({ in: i, out: o }, extra || {})];
function runSubs(rows) {
  const byId = {}, lines = [];
  rows.forEach(([t, team, pid, sec, x], i) => {
    const ev = Object.assign({ id: 'e' + i, t, team, pid, period: (x && x.period) || 1, clock: sec * 1000 }, x || {});
    byId[ev.id] = ev;
    lines.push({ id: ev.id, period: ev.period, clock: ev.clock, s: [0, i] });
  });
  return P.group(lines, byId).map(g => g.subs ? 'sub:' + g.main.ev.team + ':' + g.subs.map(x => x.ev.in).join('+') : g.main.ev.t);
}
ok('one team\'s substitutions at one stoppage are one card', JSON.stringify(runSubs([sub(0, 300, 'a', 'b'), sub(0, 300, 'c', 'd'), sub(0, 300, 'e', 'f')])) === JSON.stringify(['sub:0:a+c+e']));
ok('a lone substitution is a card too', JSON.stringify(runSubs([sub(1, 300, 'a', 'b')])) === JSON.stringify(['sub:1:a']));
ok('the other team\'s substitutions at that moment are a card of their own, and sitting between do not split the first', JSON.stringify(runSubs([sub(0, 300, 'a', 'b'), sub(1, 300, 'x', 'y'), sub(0, 300, 'c', 'd')])) === JSON.stringify(['sub:0:a+c', 'sub:1:x']));
ok('a timeout between two subs does not split them', JSON.stringify(runSubs([sub(0, 300, 'a', 'b'), ['timeout', 1, null, 300], sub(0, 300, 'c', 'd')])) === JSON.stringify(['sub:0:a+c', 'timeout']));
ok('any other play between does: a free throw is a different stoppage', JSON.stringify(runSubs([sub(0, 300, 'a', 'b'), ['ft_made', 1, 'z', 300], sub(0, 300, 'c', 'd')])) === JSON.stringify(['sub:0:a', 'ft_made', 'sub:0:c']));
ok('a substitution at another clock is another card', JSON.stringify(runSubs([sub(0, 300, 'a', 'b'), sub(0, 299, 'c', 'd')])) === JSON.stringify(['sub:0:a', 'sub:0:c']));
ok('...and in another period', JSON.stringify(runSubs([sub(0, 300, 'a', 'b', { period: 1 }), sub(0, 300, 'c', 'd', { period: 2 })])) === JSON.stringify(['sub:0:a', 'sub:0:c']));
ok('every event still appears exactly once', (() => {
  const rows = [sub(0, 300, 'a', 'b'), sub(1, 300, 'x', 'y'), sub(0, 300, 'c', 'd'), ['p2_made', 0, 'a', 290], ['ast', 0, 'c', 290], sub(0, 250, 'e', 'f')];
  const byId = {}, lines = [];
  rows.forEach(([t, team, pid, sec, x], i) => { const ev = Object.assign({ id: 'e' + i, t, team, pid, period: 1, clock: sec * 1000 }, x || {}); byId[ev.id] = ev; lines.push({ id: ev.id, period: 1, clock: ev.clock, s: [0, 0] }); });
  const seen = [];
  P.group(lines, byId).forEach(g => { seen.push(g.main.ev.id); g.extras.forEach(z => seen.push(z.ev.id)); (g.subs || []).slice(1).forEach(z => seen.push(z.ev.id)); });
  return seen.length === rows.length && new Set(seen).size === rows.length;
})());

console.log('-- who is on the floor after them');
function after(rows, starters) {
  const byId = {}, lines = [];
  rows.forEach(([t, team, pid, sec, x], i) => { const ev = Object.assign({ id: 'e' + i, t, team, pid, period: 1, clock: sec * 1000 }, x || {}); byId[ev.id] = ev; lines.push({ id: ev.id, period: 1, clock: ev.clock, s: [0, 0] }); });
  return P.lineupsAfter(lines, byId, starters);
}
const five = [['a', 'b', 'c', 'd', 'e'], ['v', 'w', 'x', 'y', 'z']];
ok('the player coming on takes the place of the one going off, so the row keeps its order', JSON.stringify(after([sub(0, 300, 'q', 'c')], five).e0) === JSON.stringify(['a', 'b', 'q', 'd', 'e']));
ok('a second substitution builds on the first (and a player who came on can go off again)', JSON.stringify(after([sub(0, 300, 'q', 'c'), sub(0, 300, 'r', 'a'), sub(0, 200, 'c', 'q')], five).e2) === JSON.stringify(['r', 'b', 'c', 'd', 'e']));
ok('the other side\'s row is not touched', JSON.stringify(after([sub(0, 300, 'q', 'c'), sub(1, 300, 'p', 'x')], five).e1) === JSON.stringify(['v', 'w', 'p', 'y', 'z']));
ok('somebody already on the floor "coming on" only takes the other off; a sub for nobody on the floor adds', JSON.stringify(after([sub(0, 300, 'b', 'c')], five).e0) === JSON.stringify(['a', 'b', 'd', 'e']) && JSON.stringify(after([sub(0, 300, 'q', 'nobody')], five).e0) === JSON.stringify(['a', 'b', 'c', 'd', 'e', 'q']));
ok('a team with no starters on record has no row to show (not a row of only the players who came on)', after([sub(0, 300, 'q', 'c')], [[], ['v']]).e0 === null && JSON.stringify(after([sub(1, 300, 'p', 'v')], [[], ['v']]).e0) === JSON.stringify(['p']));
ok('it does not change what it was given', (() => { const s = [['a', 'b', 'c', 'd', 'e'], ['v']]; after([sub(0, 300, 'q', 'c')], s); return JSON.stringify(s[0]) === JSON.stringify(['a', 'b', 'c', 'd', 'e']); })());

console.log('-- the card');
{
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  P.setBox({ esc, perName: p => 'Q' + p, fmtClock: ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') });
  const mk = (t, id, name, num) => ({ id, name, num });
  const S = { teams: [{ name: 'Home <b>', color: '#111111', players: [mk(0, 'a', 'Ann Bee', '1'), mk(0, 'b', 'Cy Dee', '2'), mk(0, 'c', 'Eve <i>Fox', '3'), mk(0, 'q', 'Gus Hall', '4'), mk(0, 'r', 'Ivy Jay', '5')] },
                     { name: 'Away', color: '#d6246e', players: [mk(1, 'v', 'Kit Lee', '6')] }] };
  const pm = {}; S.teams.forEach((tm, t) => tm.players.forEach(p => { pm[p.id] = { p, t }; }));
  const ctx = { S, d: { stypes: {} }, pm, col: ['#111111', '#d6246e'], on: ['#ffffff', '#ffffff'], tags: {}, label: pid => pm[pid].p.name.split(' ').pop() };
  const rows = [sub(0, 300, 'q', 'c'), sub(0, 300, 'r', 'a')];
  const byId = {}, lines = [];
  rows.forEach(([t, team, pid, sec, x], i) => { const ev = Object.assign({ id: 'e' + i, t, team, pid, period: 1, clock: sec * 1000 }, x || {}); byId[ev.id] = ev; lines.push({ id: ev.id, period: 1, clock: ev.clock, s: [3, 2] }); });
  const g = P.group(lines, byId)[0];
  g.lineup = ['r', 'b', 'q', 'd', 'e'];      // d and e are nobody on the roster: skipped, not a crash
  const html = P.cardHTML(ctx, g);
  ok('a substitution card names the team and each sub in its own line', /Substitutions<\/span> <span class="pb-bit" translate="no">Home &lt;b&gt;<\/span>/.test(html) && (html.match(/class="pb-row pb-sub"/g) || []).length === 2 && /Gus Hall/.test(html) && /Ivy Jay/.test(html));
  ok('...then the five on the floor as circles with the names under them, each one a link to the player', (html.match(/class="pb-lu-p/g) || []).length === 3 && /class="pb-lu-n">Hall</.test(html) && /href="\.\.\/p\/\?p=q"/.test(html));
  ok('...the ones who came on marked, the ones who did not not', /pb-lu-p new" translate="no" href="\.\.\/p\/\?p=r"/.test(html) && /pb-lu-p new" translate="no" href="\.\.\/p\/\?p=q"/.test(html) && /class="pb-lu-p" translate="no" href="\.\.\/p\/\?p=b"/.test(html) && (html.match(/class="pb-lu-in"/g) || []).length === 2);
  ok('...with the clock and the score at the last of them, and the team\'s colour', />Q1<\/span> 5:00/.test(html) && /<b>3<\/b>–<b>2<\/b>/.test(html) && /--c:#111111/.test(html));
  ok('names are escaped', !/<b>['"]|<i>Fox/.test(html) && !/Home <b>/.test(html));
  const one = P.cardHTML(ctx, P.group([lines[0]], { e0: byId.e0 })[0]);
  ok('one sub reads "Substitution", and with no five to show there is no row of them', /Substitution<\/span>/.test(one) && !/Substitutions/.test(one) && !/pb-lu-row/.test(one));
  P.setBox(null);
}

console.log('-- real games');
{
  const dir = path.join(here, 'fixtures', 'video-mapping');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.events.json'));
  ok('there are real logs to check against', files.length >= 3, files);
  files.forEach(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const evs = raw.filter(e => !['loc', 'stype', 'tag'].includes(e.t)).map(e => Object.assign({ id: 'e' + e.seq }, e));
    const byId = {}, lines = [];
    evs.forEach(e => { byId[e.id] = e; lines.push({ id: e.id, period: e.period, clock: e.clock, s: [0, 0] }); });
    const groups = P.group(lines, byId);
    const seen = [];
    groups.forEach(g => { seen.push(g.main.ev.id); g.extras.forEach(z => seen.push(z.ev.id)); (g.subs || []).slice(1).forEach(z => seen.push(z.ev.id)); });
    ok(f + ': every play is in exactly one card', seen.length === evs.length && new Set(seen).size === evs.length, [seen.length, evs.length]);
    ok('...no card carries more than three plays, and only a miss carries three (shot, block, rebound)',
       groups.every(g => g.extras.length <= 2 && (g.extras.length < 2 || /miss$/.test(g.main.ev.t))), groups.filter(g => g.extras.length > 2).length);
    /* the rule, read straight off the log: a rebound that follows a miss with nothing but blocks, subs and timeouts
       between, in the same period and within fifteen seconds, is that miss's */
    const cardOf = {}; groups.forEach(g => { cardOf[g.main.ev.id] = g; g.extras.forEach(z => { cardOf[z.ev.id] = g; }); });
    let due = 0, alone = [];
    evs.forEach((e, i) => {
      if (!/^(p[23]|ft)_miss$/.test(e.t)) return;
      for (let j = i + 1; j < evs.length && j <= i + 6; j++) {
        const y = evs[j];
        if (y.t === 'reb') { if (y.period === e.period && Math.abs(e.clock - y.clock) <= 15000) { due++; if (cardOf[y.id] !== cardOf[e.id]) alone.push(e.id + '>' + y.id); } break; }
        if (!['sub', 'timeout', 'blk'].includes(y.t)) break;
      }
    });
    ok('...every miss\'s rebound (' + due + ' of them) is on its miss\'s card, however long the feed took to log it', due > 20 && !alone.length, alone.slice(0, 3));
    const subCards = groups.filter(g => g.subs);
    ok('...a substitution card is one team\'s, one period\'s, one clock\'s', subCards.every(g => g.subs.every(x => x.ev.team === g.main.ev.team && x.ev.period === g.main.ev.period && x.ev.clock === g.main.ev.clock)));
    ok('...and there are fewer of them than substitutions', subCards.length > 0 && subCards.length < evs.filter(e => e.t === 'sub').length, [subCards.length, evs.filter(e => e.t === 'sub').length]);
  });
}

console.log('-- the kind of card');
const k = t => P.kindOf({ main: { ev: { t } }, extras: [] });
ok('baskets and free throws made score; misses miss; subs and timeouts are slim; quarters are markers',
   k('p3_made') === 'score' && k('ft_made') === 'score' && k('p2_miss') === 'miss' && k('ft_miss') === 'miss' && k('sub') === 'slim' && k('timeout') === 'slim' && k('period_start') === 'marker' && k('to') === 'to');
ok('a made three is worth 3, a free throw 1', P.actionParts({ t: 'p3_made' }).pts === 3 && P.actionParts({ t: 'ft_made' }).pts === 1 && !P.actionParts({ t: 'p2_miss' }).pts);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
