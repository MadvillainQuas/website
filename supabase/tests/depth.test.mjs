/* ============================================================================
   THE FRONT OFFICE (epinoia/t/depth.js): the projected depth chart and the GM's view, with no browser.

     node supabase/tests/depth.test.mjs

   What is held here:
     * projected minutes lean on the last five games (60 / 40), a player missing now projects to nothing, and one
       who has not played lately keeps a discounted season;
     * where a player plays: the box score's estimate counts only as far as his minutes do, the listing and his
       height carry the rest, and with nothing at all he is a forward;
     * the five who start are the five with the most recent starts (then minutes), laid on PG..C from small to
       big; the bench joins the starter each plays most like, three deep, the rest are reserves; the missing are
       named and the released are gone; a feed with no starters starts its five heaviest-minute players;
     * the GM's view ranks the club against its own league: the top quarter are strengths, the bottom quarter
       weaknesses, three needs at most (never the same player twice), styles read as choices, and the roster's
       shape (rotation, minutes to the top five, the star's share, age, height, the on/off arguments);
     * both views draw, escape names, and say when a reading rests on only a few games.
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
for (const f of ['epinoia/season.js', 'epinoia/t/depth.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const X = sandbox.EpinoiaDepth;

console.log('\nminutes and positions');
ok('projected minutes: 60% the last five, 40% the season', X.projectedMinutes({ mpg: 20 }, { mpg: 30 }, false) === 26);
ok('...missing now: nothing', X.projectedMinutes({ mpg: 30 }, { mpg: 30 }, true) === 0);
ok('...not in the last five: his season, discounted', X.projectedMinutes({ mpg: 20 }, null, false) === 8);
ok('...never played: nothing', X.projectedMinutes(null, null, false) === 0);
ok('a 1.84 m guard with no box score yet is a point guard, a 2.09 m man a centre',
   X.positionOf({ height: 184 }, null) < 1.3 && X.positionOf({ height: 209 }, null) === 5);
ok('...the listing counts ("Centre" beats a 1.98 m height)', X.positionOf({ height: 198, position: 'Centre' }, null) > 4);
ok('...the box score counts as far as the minutes do: 20 minutes barely, 600 minutes mostly',
   Math.abs(X.positionOf({ height: 209 }, { bpm_pos: 2, min: 20 }) - 5) < 0.6 && X.positionOf({ height: 209 }, { bpm_pos: 2, min: 600 }) < 3.5,
   X.positionOf({ height: 209 }, { bpm_pos: 2, min: 20 }).toFixed(2) + ' / ' + X.positionOf({ height: 209 }, { bpm_pos: 2, min: 600 }).toFixed(2));
ok('...nothing at all: a forward (3)', X.positionOf({}, null) === 3);

console.log('\nthe depth chart');
const P = (id, name, height, mpg, recent, extra) => ({ p: { id, name, num: id.slice(1), height, position: '' }, s: { mpg, gp: 10, min: mpg * 10 }, r: recent == null ? null : { mpg: recent }, ...(extra || {}) });
const squad = [
  P('p1', 'Point One', 184, 30, 31), P('p2', 'Guard Two', 192, 28, 29), P('p3', 'Wing Three', 198, 27, 26), P('p4', 'Four Big', 204, 26, 27),
  P('p5', 'Five Centre', 211, 25, 24), P('p6', 'Backup Point', 185, 18, 20), P('p7', 'Backup Big', 208, 16, 15), P('p8', 'Sixth Wing', 199, 20, 22),
  P('p9', 'Stretch Four', 205, 12, 11), P('p10', 'Third Guard', 190, 9, 10), P('p11', 'Deep Bench', 196, 3, null), P('p12', 'Hurt Star', 200, 29, 0),
  P('p13', 'Let Go', 195, 10, 10), P('p14', 'Big Three', 210, 8, 8), P('p15', 'Fourth Guard', 188, 6, 7), P('p16', 'Extra Big', 212, 5, 5),
  P('p17', 'Two-Way Wing', 197, 4, 4), P('p18', 'Camp Body', 201, 3, 3)
];
const roster = squad.map(x => x.p);
const season = new Map(squad.map(x => [x.p.id, x.s]));
const recent = new Map(squad.filter(x => x.r).map(x => [x.p.id, x.r]));
const starts = { season: new Map([['p1', 10], ['p2', 9], ['p3', 10], ['p4', 8], ['p5', 10], ['p12', 6]]),
                 recent: new Map([['p1', 5], ['p2', 5], ['p3', 4], ['p4', 5], ['p5', 5], ['p8', 1]]), games: 5 };
const c = X.chart({ roster, season, recent, starts, out: new Set(['p12']), released: new Set(['p13']) });
const at = k => c.slots.find(s => s.key === k).players.map(p => p.id);
ok('the five who start, laid small to big: PG p1, SG p2, SF p3, PF p4, C p5', ['PG', 'SG', 'SF', 'PF', 'C'].map(k => at(k)[0]).join() === 'p1,p2,p3,p4,p5',
   ['PG', 'SG', 'SF', 'PF', 'C'].map(k => at(k)[0]).join());
ok('...the missing star is not among them, and is named', !c.starters.some(p => p.id === 'p12') && c.out.map(p => p.id).join() === 'p12'
   && c.reserves.some(p => p.id === 'p12' && p.role === 'out'));
ok('the released are gone from the chart altogether', !c.slots.some(s => s.players.some(p => p.id === 'p13')) && !c.reserves.some(p => p.id === 'p13') && c.total === 17);
ok('the backup point guard backs up the point guard, the backup big the centre', at('PG').includes('p6') && at('C').includes('p7'), JSON.stringify(c.slots.map(s => s.key + ':' + s.players.map(p => p.id).join('/'))));
ok('three deep at most, the rest reserves', c.slots.every(s => s.players.length <= 3) && c.reserves.filter(p => p.role === 'reserve').length > 0);
ok('...each slot in the order of the minutes it is projected to give', c.slots.every(s => s.players.slice(1).every((p, i, a) => i === 0 || a[i - 1].proj >= p.proj)));
ok('the rotation: everyone projected ten minutes or more, the missing excluded', c.rotation === squad.filter(x => x.p.id !== 'p12' && x.p.id !== 'p13' && X.projectedMinutes(x.s, x.r, false) >= 10).length, String(c.rotation));
const noStarts = X.chart({ roster, season, recent, starts: { season: new Map(), recent: new Map(), games: 0 }, out: new Set(), released: new Set() });
/* the hurt star has no minutes in the last five: 0.4 of his season (11.6) is not a starter's */
ok('a feed with no starters starts its five heaviest-minute players', noStarts.starters.map(p => p.id).sort().join() === ['p1', 'p2', 'p3', 'p4', 'p5'].sort().join(),
   noStarts.starters.map(p => p.id).join());
const html = X.chartHTML(X.chart({ roster: [{ id: 'x', name: '<b>Evil</b>', num: '0', height: 190 }], season: new Map(), recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } }), { link: p => '/p/?p=' + p.id });
ok('the chart escapes names and links each player', !/<b>Evil/.test(html) && /&lt;b&gt;Evil/.test(html) && /href="\/p\/\?p=x"/.test(html));
ok('...five columns, point guard to centre', (X.chartHTML(c).match(/class="dc-col"/g) || []).length === 5 && /PG.*SG.*SF.*PF.*<b>C<\/b>/s.test(X.chartHTML(c)));
ok('no roster: says so', /No players/.test(X.chartHTML(X.chart({ roster: [] }))));

console.log('\nthe GM\'s view');
const clubs = Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, gp: 10, ortg: 100 + i, drtg: 110 - i * 0.5, net: i * 1.5 - 8, ff_efg: 48 + i * 0.5, dff_efg: 54 - i * 0.4,
  ff_tov: 12 + (i % 5), dff_tov: 13 + (i % 4), ff_oreb: 25 + i, dff_oreb: 28 - (i % 6), ff_ftr: 25 + (i % 7), dff_ftr: 22 + (i % 3), p3_pct: 30 + i * 0.6,
  ft_pct: 70 + (i % 9), rim_pct: 55 + (i % 8), pace: 68 + i, p3_share: 30 + i * 1.5, rim_share: 30 - i }));
const best = X.gm({ team: { id: 't11' }, teams: clubs, players: [] });
ok('the league\'s best offence: offensive rating a strength, 1st of 12', best.strengths.some(s => /Offensive rating/.test(s.text) && /1st of 12/.test(s.detail)), JSON.stringify(best.strengths));
ok('...and the fastest, the most threes: styles, read as identity, not graded', best.identity.some(x => x.text === 'Plays fast') && best.identity.some(x => x.text === 'Lives beyond the arc')
   && !best.strengths.concat(best.weaknesses).some(x => /pace|share/i.test(x.text)));
const worst = X.gm({ team: { id: 't0' }, teams: clubs, players: [] });
ok('the worst offence: weaknesses from the bottom quarter only', worst.weaknesses.length > 0 && worst.weaknesses.every(w => { const r = +/(\d+)(st|nd|rd|th) of 12/.exec(w.detail)[1]; return r >= 10; }),
   worst.weaknesses.map(w => w.detail).join(' | '));
ok('...three needs at most, each a different player', worst.needs.length <= 3 && new Set(worst.needs.map(n => n.text)).size === worst.needs.length && worst.needs.length > 0);
ok('...and a need says which weakness it answers', worst.needs.every(n => / of 12$/.test(n.why)));
ok('a league of three clubs is too small to rank against', !X.gm({ team: { id: 't0' }, teams: clubs.slice(0, 3), players: [] }).graded);

const players = [
  { id: 'a', name: 'Star Scorer', min: 340, mpg: 34, pts: 250, usg: 31.2, diff_net: 2 },
  { id: 'b', name: 'Second', min: 300, mpg: 30, pts: 120, diff_net: -1 },
  { id: 'c', name: 'Third', min: 290, mpg: 29, pts: 100, diff_net: -12.5 },
  { id: 'd', name: 'Fourth', min: 280, mpg: 28, pts: 90, diff_net: 0 },
  { id: 'e', name: 'Fifth', min: 250, mpg: 25, pts: 80, diff_net: 1 },
  { id: 'f', name: 'Bench Spark', min: 150, mpg: 15, pts: 70, diff_net: 11.4 },
  { id: 'g', name: 'Seventh', min: 120, mpg: 12, pts: 40, diff_net: -3 },
  { id: 'h', name: 'Eighth', min: 60, mpg: 6, pts: 10, diff_net: 0 }
];
const g = X.gm({ team: { id: 't5' }, teams: clubs, players, ages: new Map([['a', 31], ['b', 30], ['c', 29], ['d', 32], ['e', 28], ['f', 22], ['g', 24], ['h', 20]]),
                 heights: new Map([['a', 196], ['b', 190], ['c', 203], ['d', 206], ['e', 211], ['f', 198], ['g', 201], ['h', 185]]) });
const has = (re) => g.roster.some(x => re.test(x.text + ' ' + x.detail));
ok('the roster: a short rotation (seven play ten minutes)', has(/A short rotation.*7 players/));
ok('...leans on its starters (the five most-used take 82% of the minutes)', has(/Leans on its starters.*82%/), g.roster.map(x => x.text + ': ' + x.detail).join(' | '));
ok('...runs through its star, with his share and usage', has(/Runs through Star Scorer.*33% of the team's points, a usage of 31\.2%/));
ok('...a veteran side, by minutes-weighted age', has(/A veteran side.*minutes-weighted age 29\.\d/) || has(/In its prime years/));
ok('...its minutes\' height in metres', has(/stand 2\.\d\d m tall/));
ok('...more minutes for the bench spark, a question over the minus', has(/More minutes for Bench Spark.*11\.4 points per 100 better/) && has(/A question over Third's minutes.*12\.5 points per 100 worse/));
const gh = X.gmHTML(Object.assign({}, X.gm({ team: { id: 't11' }, teams: clubs, players }), { gp: 2 }));
ok('the view: a block for each thing there is to say (the best club has no weaknesses), and after two games it says so first', /gm-early/.test(gh) && gh.indexOf('gm-early') < gh.indexOf('class="gm"') && /after 2 games/.test(gh)
   && ['strengths', 'identity', 'the roster'].every(t => gh.includes('>' + t + '<')) && !gh.includes('>weaknesses<'));
ok('...a club read against too few: says so', /too few clubs/.test(X.gmHTML(X.gm({ team: { id: 't0' }, teams: [], players: [] }))));


/* THE WIN MODEL (docs/what-wins-model.md §12, WP5): without a model every output above is byte for byte what it was
   before the model existed (a hash of the chart and five GM readings, taken from the file before the change); with
   one, the same measures are picked, ordered by |wins|, each carries its wins, and the needs follow that order */
console.log('\nthe win model in the GM\'s view');
{
  const crypto = await import('node:crypto');
  const P2 = (id, name, height, mpg, recent) => ({ p: { id, name, num: id.slice(1), height, position: '' }, s: { mpg, gp: 10, min: mpg * 10 }, r: recent == null ? null : { mpg: recent } });
  const sq = [P2('p1','Point One',184,30,31),P2('p2','Guard Two',192,28,29),P2('p3','Wing Three',198,27,26),P2('p4','Four Big',204,26,27),P2('p5','Five Centre',211,25,24),P2('p6','Backup Point',185,18,20),
    P2('p7','Backup Big',208,16,15),P2('p8','Sixth Wing',199,20,22),P2('p9','Stretch Four',205,12,11),P2('p10','Third Guard',190,9,10),P2('p11','Deep Bench',196,3,null),P2('p12','Hurt Star',200,29,0),
    P2('p13','Let Go',195,10,10),P2('p14','Big Three',210,8,8)];
  const st = { season: new Map([['p1',10],['p2',9],['p3',10],['p4',8],['p5',10],['p12',6]]), recent: new Map([['p1',5],['p2',5],['p3',4],['p4',5],['p5',5],['p8',1]]), games: 5 };
  const cc = X.chart({ roster: sq.map(x => x.p), season: new Map(sq.map(x => [x.p.id, x.s])), recent: new Map(sq.filter(x => x.r).map(x => [x.p.id, x.r])), starts: st, out: new Set(['p12']), released: new Set(['p13']) });
  const outs = [X.chartHTML(cc, { link: p => '/p/?p=' + p.id }), JSON.stringify(cc)];
  for (const id of ['t0', 't3', 't5', 't8', 't11']) { const gg = X.gm({ team: { id }, teams: clubs, players: [] }); outs.push(JSON.stringify(gg), X.gmHTML(gg)); }
  ok('without a model: the chart and the GM\'s view byte for byte as before the model', crypto.createHash('sha256').update(outs.join('\n')).digest('hex') === '4b9fb4ad539923ce1189527d182b7beb43067ba43a912192d9ed3770647e54ec');
  ok('...and model: undefined or {} is no model', JSON.stringify(X.gm({ team: { id: 't0' }, teams: clubs, players: [], model: undefined })) === JSON.stringify(X.gm({ team: { id: 't0' }, teams: clubs, players: [] })));
  const plain = X.gm({ team: { id: 't0' }, teams: clubs, players: [] });
  const wins = { ff_efg: -0.2, ff_tov: -1.4, p3_pct: -0.9, ff_oreb: -0.05, dff_efg: 0.3 };
  const mod = X.gm({ team: { id: 't0' }, teams: clubs, players: [], model: { wins } });
  const keys = a => a.map(x => x.key).sort().join();
  ok('a model keeps the selection (the same strengths and weaknesses)', keys(mod.strengths) === keys(plain.strengths) && keys(mod.weaknesses) === keys(plain.weaknesses));
  const valued = mod.weaknesses.filter(x => x.wins != null);
  ok('...reorders by |wins|, the ones it values first, the rest after in rank order', valued.every((x, i) => !i || Math.abs(valued[i - 1].wins) >= Math.abs(x.wins)) &&
     mod.weaknesses.findIndex(x => x.wins == null) === -1 || mod.weaknesses.slice(mod.weaknesses.findIndex(x => x.wins == null)).every(x => x.wins == null),
     mod.weaknesses.map(x => x.key + ':' + x.wins).join(' '));
  ok('...entries gain wins (null where the model has none)', mod.weaknesses.concat(mod.strengths).every(x => 'wins' in x) && mod.weaknesses.some(x => x.wins === wins[x.key]));
  const order = mod.weaknesses.map(x => x.key);
  ok('...the needs follow the new order', mod.needs.map(n => n.key).every((k, i, a) => !i || order.indexOf(a[i - 1]) <= order.indexOf(k) || order.indexOf(k) < 0 || order.indexOf(a[i - 1]) < 0) && mod.needs.every(n => 'wins' in n));
  ok('...a valued measure goes ahead of the unvalued (ff_efg before ortg, drtg, net); the needs by |wins| over every weakness (p3_pct, dff_efg, ff_efg)', order.join() === 'ff_efg,ortg,drtg,net' && mod.needs.map(n => n.key).join() === 'p3_pct,dff_efg,ff_efg', order.join() + ' / ' + mod.needs.map(n => n.key).join());
  const t4 = X.gm({ team: { id: 't4' }, teams: clubs, players: [], model: { wins: { ff_tov: -0.2, dff_tov: -1.4 } } });
  ok('...the larger |wins| first (dff_tov −1.4 before ff_tov −0.2; rank order had it second), the needs following', t4.weaknesses.map(x => x.key).join() === 'dff_tov,ff_tov' &&
     t4.needs.map(n => n.key).join() === 'dff_tov,ff_tov' && X.gm({ team: { id: 't4' }, teams: clubs, players: [] }).weaknesses.map(x => x.key).join() === 'ff_tov,dff_tov');
  const mh = X.gmHTML(mod);
  ok('the view says what each valued entry is worth, and how it is ordered', /<em class="gm-w">worth −1\.4 wins per 30 games<\/em>/.test(mh) && /ordered by what each is worth in wins/.test(mh) && !/gm-w/.test(X.gmHTML(plain)));
}

/* THE DEPTH CHART BY THE FLOOR (A.1): the pos file's minutes at each position fill the chart */
console.log('\nthe depth chart by the floor');
{
  const roster2 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ id, name: 'Player ' + id, num: String(i), height: 185 + 4 * i }));
  const pos = { w: 1, games: 10, min: 400, players: [
    { id: 'a', pos: 1.40, min: [200, 0, 0, 0, 0] }, { id: 'b', pos: 1.41, min: [60, 140, 0, 0, 0] }, { id: 'c', pos: 3, min: [0, 40, 160, 0, 0] },
    { id: 'd', pos: 4, min: [0, 0, 40, 160, 0] }, { id: 'e', pos: 5, min: [0, 0, 0, 40, 200] }, { id: 'f', pos: 2.5, min: [0, 20, 0, 0, 0] } ] };
  const base = { roster: roster2, season: new Map(roster2.map(p => [p.id, { mpg: 20, gp: 10, min: 200 }])), recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } };
  const cs = X.slotChart(Object.assign({ pos }, base));
  ok('each position led by the player with the most minutes at it (the 1.41 at the 2)', ['a', 'b', 'c', 'd', 'e'].every((id, i) => cs.slots[i].players[0].id === id));
  ok('...a player at two positions stands at both, each with its share', cs.slots[0].players.some(p => p.id === 'b' && Math.abs(p.share - 60 / 260) < 1e-12) && cs.slots[1].players[0].id === 'b');
  ok('...minutes a game at the position', Math.abs(cs.slots[0].players[0].perGame - 20) < 1e-12);
  ok('...a player with no minutes in the file is a reserve; the missing are out', X.slotChart(Object.assign({ pos, out: new Set(['a']) }, base)).reserves.some(p => p.id === 'a' && p.role === 'out') && cs.reserves.some(p => p.id === 'g'));
  ok('no stints: null (the page draws the blend)', X.slotChart(Object.assign({ pos: { players: [] } }, base)) === null && X.slotChart(base) === null);
  const h = X.chartHTML(cs);
  ok('drawn with share bars, five columns, and its source said', /dc-share/.test(h) && (h.match(/class="dc-col"/g) || []).length === 5 && /every five on the floor ranked point guard to centre/.test(h) && /20\.0 min a game · 77%/.test(h));
  ok('...positionOf, projectedMinutes and chart are unchanged (the builder relies on positionOf)', X.positionOf({}, null) === 3 && X.projectedMinutes({ mpg: 20 }, { mpg: 30 }, false) === 26);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
