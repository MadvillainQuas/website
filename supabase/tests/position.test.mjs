/* ============================================================================
   ONE POSITION AGAINST THE LEAGUE (epinoia/t/position.js), with no browser.

     node supabase/tests/position.test.mjs

   What is held here:
     * a group's numbers are its own sums: per game over the CLUB's games, true shooting from the group's shots
       together (never an average of percentages), impact and on/off weighted by minutes;
     * every club goes through the same depth chart, the club being read keeps the one on its page;
     * each measure is ranked among the clubs (turnovers the other way), with its median and percentile, and the
       players are placed among everyone the league plays at the position (never above 99th, never below 1st,
       never against themselves);
     * the verdict says where the group stands, where it leads and trails, how its starter compares, and what the
       bench gives; the drawings (radar, strips, men) come out whole, in the club's colour, names escaped;
     * the sheet opens and closes (×, Escape, the backdrop) and gives focus back.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sandbox = { console, module: undefined };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/season.js', 'epinoia/t/depth.js', 'epinoia/t/position.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const P = sandbox.EpinoiaPosition, X = sandbox.EpinoiaDepth;

console.log('\na group');
const g = P.group([
  { pts: 100, oreb: 10, dreb: 30, ast: 40, stl: 8, blk: 2, p3a: 50, tov: 20, fga: 80, fta: 20, min: 300, bpm: 4, diff_net: 10 },
  { pts: 50, oreb: 5, dreb: 15, ast: 10, stl: 2, blk: 8, p3a: 10, tov: 10, fga: 45, fta: 10, min: 100, bpm: -4, diff_net: -10 }
], 10);
ok('per game over the club\'s games: 15 points, 6 rebounds, 5 assists, 2 steals and blocks, 6 threes, 3 turnovers',
   [g.pts, g.reb, g.ast, g.stocks, g.p3a, g.tov].join() === '15,6,5,2,6,3', [g.pts, g.reb, g.ast, g.stocks, g.p3a, g.tov].join());
ok('true shooting from the group\'s own shots: 150 / 2(125 + 13.2)', Math.abs(g.ts - 100 * 150 / (2 * (125 + 0.44 * 30))) < 1e-9, g.ts.toFixed(2));
ok('impact and on/off by minutes (300 to 100): +2 and +5', g.bpm === 2 && g.onoff === 5, g.bpm + ' ' + g.onoff);
ok('a group with no shots has no true shooting (not nought)', P.group([{ pts: 0, min: 10 }], 1).ts === null);

console.log('\nthe league');
/* twelve clubs of eight players, heights PG small to C tall, the numbers rising with the club's number */
const players = [], teamOf = new Map(), rosters = [], meta = [], teams = [];
for (let c = 0; c < 12; c++) {
  const tid = 't' + c;
  teams.push({ id: tid, gp: 10 });
  meta.push({ id: tid, name: 'Club ' + c, short_name: 'C' + c, colour: '#' + (100000 + c * 7777).toString(16).slice(0, 6) });
  [183, 190, 197, 203, 210, 186, 205, 199].forEach((h, i) => {
    const id = tid + 'p' + i, starter = i < 5;
    players.push({ id, name: 'Player ' + c + '-' + i, min: starter ? 280 + c : 120, mpg: starter ? 28 + c / 10 : 12, gp: 10,
      pts: (starter ? 120 : 50) + c * (i === 0 ? 8 : 2), ppg: ((starter ? 120 : 50) + c * (i === 0 ? 8 : 2)) / 10, oreb: 5 + i, dreb: 20 + i * 5, rpg: (25 + i * 6) / 10,
      ast: i === 0 ? 60 + c * 3 : 15, apg: i === 0 ? (60 + c * 3) / 10 : 1.5, stl: 5, blk: i >= 3 ? 8 : 1, p3a: 30, tov: i === 0 ? 30 - c : 10,
      fga: 90, fta: 20, ts: 52 + c / 2, bpm: -3 + c / 2 + (i === 0 ? 2 : 0), diff_net: -6 + c });
    teamOf.set(id, tid);
    rosters.push({ team_id: tid, position: '', players: { id, height_cm: h } });
  });
}
const S = { players, teams, teamOfPlayer: teamOf };
/* the club being read: its own chart, as its page drew it */
const own = X.chart({ roster: players.filter(p => teamOf.get(p.id) === 't11').map(p => ({ id: p.id, name: p.name, height: rosters.find(r => r.players.id === p.id).players.height_cm })),
  season: new Map(players.map(p => [p.id, p])), recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } });
const C = P.context({ season: S, rosters, meta, own: { teamId: 't11', chart: own } });
ok('every club that has played goes through the chart', C.clubs.length === 12 && C.clubs.every(c => ['PG', 'SG', 'SF', 'PF', 'C'].every(k => c.slots[k])));
ok('...the club being read keeps the chart on its page', C.byId.get('t11').slots.PG.members[0].id === own.slots[0].players[0].id);
ok('...the smallest starter is every club\'s point guard, the tallest its centre',
   C.clubs.every(c => c.slots.PG.members[0].id.endsWith('p0') && c.slots.C.members[0].id.endsWith('p4')),
   C.clubs.map(c => c.slots.PG.members[0].id + '/' + c.slots.C.members[0].id).slice(0, 3).join(' '));

/* POS2-1: a chart with a player at two or more slots (the slot chart) is never the club's in the league view: its groups
   would add a player's whole season at each slot, against every other club's disjoint ones */
{
  const twice = JSON.parse(JSON.stringify(own));
  const star = twice.slots[0].players[0];
  twice.slots.forEach((sl, i) => { if (i > 0) sl.players.unshift(Object.assign({}, star)); });
  const C2 = P.context({ season: S, rosters, meta, own: { teamId: 't11', chart: twice } });
  const club = C2.byId.get('t11'), slotMin = Object.values(club.slots).reduce((a, sl) => a + sl.stats.min, 0);
  const team = players.filter(p => teamOf.get(p.id) === 't11').reduce((a, p) => a + p.min, 0) / 10;
  ok('a club chart listing a player at every slot is not used for the league view: the groups\' minutes add up to no more than the club\'s',
     slotMin <= team + 1e-9 && Object.values(club.slots).filter(sl => sl.members.some(mm => mm.id === star.id)).length === 1, slotMin.toFixed(1) + ' of ' + team.toFixed(1));
  const teamSrc = fs.readFileSync(path.join(ROOT, 'epinoia/t/team.js'), 'utf8');
  ok('...and the team page hands it the chart() it drew, never the slot chart (no reset of the league view to the slot chart)',
     /own: \{ teamId: team\.id, chart: cLeague \}/.test(teamSrc) && /const cLeague = c;/.test(teamSrc) && !/c = cs; ctxP = null;/.test(teamSrc));
}

const rep = P.report(C, 't11', 'PG');
const m = k => rep.metrics.find(x => x.k === k);
ok('the best club\'s point guards: 1st in scoring and playmaking of 12', m('pts').rank === 1 && m('ast').rank === 1 && m('pts').of === 12, m('pts').rank + ' ' + m('ast').rank);
ok('...turnovers ranked the other way (fewest is 1st)', m('tov').low && m('tov').rank === 1);
ok('...a percentile with each rank: 1st of 12 is the 100th', m('pts').pct === 100 && m('pts').median != null);
ok('...and every club\'s value kept for the strips', m('pts').vals.length === 12);
const worst = P.report(C, 't0', 'PG');
ok('the weakest club\'s: 12th, the 0th percentile', worst.metrics.find(x => x.k === 'pts').rank === 12 && worst.metrics.find(x => x.k === 'pts').pct === 0);
ok('players placed among the league\'s point guards, 1st to 99th, never against themselves',
   rep.men.every(x => Object.values(x.pct).every(v => v == null || (v >= 1 && v <= 99))) && rep.men[0].pct.ppg === 99, JSON.stringify(rep.men[0].pct));
ok('a club with nobody at a position: no report', P.report(C, 'nobody', 'PG') === null);

console.log('\nthe words');
ok('where the group stands: among the best, 1st of 12 for overall impact', /among the best in the league: 1st of 12 for overall impact/.test(rep.verdict[0]), rep.verdict[0]);
ok('...where it leads', rep.verdict.some(t => /^They lead in/.test(t)));
ok('...its starter against the other starters', rep.verdict.some(t => /the best starting point guard in the league by box plus-minus/.test(t)), rep.verdict.join(' | '));
ok('...what the bench gives against the league\'s middle', rep.verdict.some(t => /minutes a game/.test(t)));
ok('the weakest: among the weakest, and where it trails', /among the weakest/.test(worst.verdict[0]) && worst.verdict.some(t => /^They trail in/.test(t)));

console.log('\nthe drawings');
const html = P.html(rep, { close: true, link: p => '/p/?p=' + p.id });
ok('the sheet: the position\'s code, the club, the radar, a strip per measure, the men, a close button',
   /class="pv-code">PG</.test(html) && /class="pv-radar"/.test(html) && (html.match(/class="pv-row"/g) || []).length === 9 &&
   (html.match(/class="pv-man/g) || []).length === rep.men.length && /data-pv-close/.test(html));
ok('the radar: a polygon of nine points, rings, and the league\'s middle', (/<polygon points="([^"]+)" class="pv-shape"/.exec(html) || [, ''])[1].split(' ').length === 9 && /class="pv-mid"/.test(html));
ok('each strip: this club once, lit; the others as dots', (html.match(/class="pv-me"/g) || []).length === 9 && (html.match(/class="pv-o"/g) || []).length === 9 * 11);
const evil = P.html(Object.assign({}, rep, { club: Object.assign({}, rep.club, { name: '<script>x</script>' }) }), {});
ok('names are text, never markup', !/<script>x/.test(evil) && /&lt;script&gt;/.test(evil));
ok('with nothing to show: says so', /No players/.test(P.html(null)));

console.log('\nthe sheet');
{
  const listeners = {};
  const made = [];
  const node = (tag) => {
    const n = { tag, className: '', attrs: {}, children: [], innerHTML: '', removed: false,
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.l = this.l || {})[t] = f; },
      appendChild(c) { this.children.push(c); return c; }, remove() { this.removed = true; },
      querySelector(sel) { return sel === '[data-pv-close]' ? closeBtn : null; }, focus() { focused = this; } };
    made.push(n);
    return n;
  };
  let focused = null;
  const closeBtn = { focus() { focused = closeBtn; }, closest: s => (s === '[data-pv-close]' ? closeBtn : null) };
  const classes = new Set();
  sandbox.document = { createElement: node, body: { appendChild() {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
    addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const opener = { focus() { focused = opener; } };
  const ov = P.open(html, opener);
  ok('it opens as a modal dialog over the page, the page held still, focus on ×', ov.attrs.role === 'dialog' && ov.attrs['aria-modal'] === 'true' && classes.has('pv-open') && focused === closeBtn);
  listeners.keydown({ key: 'Escape' });
  ok('Escape closes it and gives focus back to the position pressed', ov.removed && !classes.has('pv-open') && focused === opener && !listeners.keydown);
  const ov2 = P.open(html, opener);
  ov2.l.click({ target: ov2 });
  ok('...and so does the backdrop', ov2.removed);
  const ov3 = P.open(html, opener);
  ov3.l.click({ target: { closest: s => (s === '[data-pv-close]' ? closeBtn : null) } });
  ok('...and ×', ov3.removed);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
