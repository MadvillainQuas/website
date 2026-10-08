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
  ok('...minutes a game at the position: his share of a 40-minute game', Math.abs(cs.slots[0].players[0].perGame - Math.round(cs.slots[0].players[0].share * 400) / 10) < 1e-9);
  ok('...every position adds up to the game (40, or the league\'s own length)', cs.slots.every(s => Math.abs(s.total - 40) < 1e-9) &&
     X.slotChart(Object.assign({ pos, gameMin: 48 }, base)).slots.every(s => Math.abs(s.total - 48) < 1e-9));
  ok('...a player with no minutes in the file is a reserve; the missing are out', X.slotChart(Object.assign({ pos, out: new Set(['a']) }, base)).reserves.some(p => p.id === 'a' && p.role === 'out') && cs.reserves.some(p => p.id === 'g'));
  ok('no stints: null (the page draws the blend)', X.slotChart(Object.assign({ pos: { players: [] } }, base)) === null && X.slotChart(base) === null);
  const h = X.chartHTML(cs);
  ok('drawn with share bars, five columns, and its source said', /dc-share/.test(h) && (h.match(/class="dc-col"/g) || []).length === 5 && /every five on the floor ranked point guard to centre/.test(h) && /30\.8 min a game · 77%/.test(h) && /40\.0 \/ 40 min/.test(h));
  ok('...positionOf, projectedMinutes and chart are unchanged (the builder relies on positionOf)', X.positionOf({}, null) === 3 && X.projectedMinutes({ mpg: 20 }, { mpg: 30 }, false) === 26);
  /* THE PROFILE'S FOLD (Louie, 2026-10-08: "too many players shown"): under 5% of a position's minutes goes into 'others' */
  const pos2 = { w: 1, games: 10, min: 400, players: pos.players.concat([{ id: 'g', pos: 1.5, min: [6, 0, 0, 0, 0] }]) };
  const cf = X.slotChart(Object.assign({ pos: pos2 }, base)), ca = X.slotChart(Object.assign({ pos: pos2, all: true }, base));
  const pg = cf.slots[0], pgAll = ca.slots[0];
  ok('a player with under 5% of a position\'s minutes is folded into its others line (6 of 266 at the 1)',
     !pg.players.some(p => p.id === 'g') && pg.others && pg.others.n === 1 && pg.others.names[0] === 'Player g' && cf.hidden === 1 && cf.minShare === 0.05, [pg.players.map(p => p.id), pg.others]);
  ok('...the column still adds up to the game, the others\' minutes in it', Math.abs(pg.players.reduce((a, p) => a + p.perGame, 0) + pg.others.perGame - 40) < 1e-9);
  ok('...and he is placed, never a reserve', !cf.reserves.some(p => p.id === 'g'));
  ok('...all: true shows every player, nothing folded', pgAll.players.some(p => p.id === 'g') && !pgAll.others && ca.hidden === 0);
  const hf = X.chartHTML(cf);
  ok('...drawn as one line, its minutes and share, and the note says so', /<span class="dc-n">1 other<\/span><span class="dc-m">0\.9 min a game · 2%<\/span>/.test(hf) &&
     /a share under 5% is folded into others/.test(hf) && !/a share under 5%/.test(X.chartHTML(ca)), hf.slice(0, 400));
}


console.log('\nthe depth chart that adds up (before the stints are built)');
{
  const mk = (id, pos, proj, st) => ({ id, name: id, num: id, pos, proj, out: false, recentStarts: st ? 4 : 0, role: 'rotation' });
  const ps = [mk('pg1', 1.3, 23, 1), mk('pg2', 1.4, 10), mk('g2', 1.9, 21.9, 1), mk('w1', 2.8, 18.9, 1), mk('w2', 2.6, 19.3), mk('w3', 3.0, 18.1),
              mk('f1', 3.9, 24.7, 1), mk('f2', 3.6, 16.8), mk('f3', 3.8, 16.4), mk('c1', 4.6, 19.2, 1), mk('c2', 4.4, 14.4)];
  const hurt = Object.assign(mk('x', 2, 0), { out: true, role: 'out' });
  const base = { slots: [{ players: ps }], reserves: [hurt], starters: ps.filter(p => p.recentStarts), games: 4, out: [hurt], total: 12 };
  const c = X.splitChart(base, 40);
  ok('every position adds up to exactly 40 minutes', c.slots.every(s => Math.abs(s.total - 40) < 1e-9 &&
     Math.abs(s.players.reduce((a, p) => a + p.slotMin, 0) - 40) < 1e-9), c.slots.map(s => s.total).join(' '));
  ok('...and the club to 200, each player\'s positions adding up to his own game', (() => {
    const t = new Map(); c.slots.forEach(s => s.players.forEach(p => t.set(p.id, (t.get(p.id) || 0) + p.slotMin)));
    return Math.abs([...t.values()].reduce((a, b) => a + b, 0) - 200) < 1e-9 && [...t.values()].every(v => v <= 40); })());
  ok('...a player whose minutes cross a cut stands at both positions, the next one up', c.slots[0].players.some(p => p.id === 'g2') && c.slots[1].players.some(p => p.id === 'g2'));
  ok('...the smallest leads the point guards, the biggest the centres', c.slots[0].players[0].id === 'pg1' && c.slots[4].players[0].id === 'c1');
  ok('...the missing are not given minutes', c.reserves.some(p => p.id === 'x' && p.role === 'out') && c.slots.every(s => !s.players.some(p => p.id === 'x')));
  ok('...a 48-minute league adds up to 48', X.splitChart(base, 48).slots.every(s => Math.abs(s.total - 48) < 1e-9));
  ok('...nobody past the game: a short rotation is capped at 40 each', (() => {
    const six = [mk('a', 1, 40), mk('b', 2, 40), mk('c', 3, 40), mk('d', 4, 40), mk('e', 5, 40), mk('f', 3, 30)];
    const k = X.splitChart({ slots: [{ players: six }], reserves: [], starters: [], games: 4, out: [], total: 6 }, 40);
    const t = new Map(); k.slots.forEach(s => s.players.forEach(p => t.set(p.id, (t.get(p.id) || 0) + p.slotMin)));
    return [...t.values()].every(v => v <= 40) && k.slots.every(s => Math.abs(s.total - 40) < 1e-9); })());
  ok('the game\'s length from the rules: 4 x 10 is 40, 4 x 12 is 48, nothing is 40', X.gameMinutes({ periods: 4, period_ms: 600000 }) === 40 &&
     X.gameMinutes({ periods: 4, period_ms: 720000 }) === 48 && X.gameMinutes({}) === 40);
  const h = X.chartHTML(c);
  ok('drawn with each position\'s total and the rule said', (h.match(/40\.0 \/ 40 min/g) || []).length === 5 && /each position adds up to the 40-minute game/.test(h) && /of his 21\.\d/.test(h));
}


console.log('\nthe depth chart from the club\'s own lineups (no model file)');
{
  const val = { a: 1.4, b: 1.6, c: 3, d: 4, e: 5, f: 2.5, x: 1 };
  const five = ids => ids;
  const st = [
    { game_id: 'g1', team_idx: 0, player_ids: five(['e', 'b', 'a', 'd', 'c']), dur: 600000 },   // a at the 1, b at the 2
    { game_id: 'g1', team_idx: 0, player_ids: five(['e', 'b', 'f', 'd', 'c']), dur: 300000 },   // b at the 1, f at the 2
    { game_id: 'g1', team_idx: 1, player_ids: five(['x', 'b', 'f', 'd', 'c']), dur: 900000 },   // the other side: not the club's
    { game_id: 'g2', team_idx: 1, player_ids: five(['a', 'b', 'c', 'd', 'e']), dur: 600000 },   // the club was the away side in g2
    { game_id: 'g2', team_idx: 1, player_ids: five(['a', 'b', 'c', 'd']), dur: 600000 }          // four known: left out
  ];
  const fp = X.floorPos(st, { g1: 0, g2: 1 }, id => val[id]);
  const m = id => fp.players.find(p => p.id === id).min;
  ok('each five ranked point guard to centre: the 1.4 at the 1, the 1.6 at the 2 while they share the floor',
     m('a')[0] === 20 && m('b')[1] === 20 && m('b')[0] === 5 && m('f')[1] === 5, JSON.stringify(fp.players));
  ok('...only the club\'s own side, only fives of five known players', !fp.players.some(p => p.id === 'x') && fp.games === 2 && Math.abs(fp.min - 25) < 1e-9);
  const cs = X.slotChart(Object.assign({ pos: fp, gameMin: 40 }, { roster: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id })), season: new Map(), recent: new Map() }));
  ok('...and the chart drawn from it adds up to the game at every position', cs && cs.slots.every(s => Math.abs(s.total - 40) < 1e-9), cs && cs.slots.map(s => s.total).join(' '));
  ok('no stints: null', X.floorPos([], {}, () => 1) === null);
  const h = X.chartHTML(cs, { static: true });
  ok('the profile\'s copy: positions are headings, not buttons, and no league-view hint', !/data-slot/.test(h) && !/dc-hint/.test(h) && /dc-hs/.test(h));
}

console.log('\none row a player, of the season shown (squad)');
{
  /* Grupo Alega Cantabria, Primera FEB, after its 2025-26 season was filled in (1 Oct 2026): every player of both
     seasons had two active rows, and German Martinez Diaz wore #7 in 2026-27 and #10 in 2025-26 */
  const S27 = 'b96f68c6', S26 = 'b681ac15', T = 'c3f03e9d';
  const row = (pid, season, name, jersey, at) => ({ team_id: T, season_id: season, created_at: at, seasons: season ? { name } : null, jersey, players: { id: pid } });
  const rows = [
    row('german', S27, '2026-27', '7', '2026-09-26T19:57:27Z'), row('german', S26, '2025-26', '10', '2026-10-01T09:19:35Z'),
    row('miha', S27, '2026-27', '31', '2026-09-26T19:57:38Z'), row('miha', S26, '2025-26', '31', '2026-10-01T09:52:49Z'),
    row('only26', S26, '2025-26', '4', '2026-10-01T09:20:00Z'), row('hand', null, '', '99', '2026-09-30T10:00:00Z')
  ];
  const now = X.squad(rows, S27);
  ok('the season shown (2026-27): one row a player, its own jersey - German Martinez Diaz is #7, once',
     now.filter(r => r.players.id === 'german').length === 1 && now.find(r => r.players.id === 'german').jersey === '7'
     && now.filter(r => r.players.id === 'miha').length === 1, JSON.stringify(now.map(r => r.players.id + '#' + r.jersey)));
  ok('...last season\'s players are not on this season\'s squad, a row filed under no season is',
     !now.some(r => r.players.id === 'only26') && now.some(r => r.players.id === 'hand'));
  const old = X.squad(rows, S26);
  ok('the 2025-26 season shown: #10, and last season\'s players back', old.find(r => r.players.id === 'german').jersey === '10' && old.some(r => r.players.id === 'only26'));
  const any = X.squad(rows, null);
  ok('no season chosen (a league with one): one row a player, the newest season\'s - though written first',
     any.length === 4 && any.find(r => r.players.id === 'german').jersey === '7', JSON.stringify(any.map(r => r.players.id + '#' + r.jersey)));
  ok('...two clubs\' rows (the league view) are kept apart, a player at each', X.squad([row('miha', S27, '2026-27', '31', 'x'), Object.assign(row('miha', S27, '2026-27', '8', 'y'), { team_id: 'other' })], S27).length === 2);
  ok('...rows naming no player are dropped, the order kept', X.squad([{ team_id: T, players: null }, row('b', S27, '2026-27', '2', 'x'), row('a', S27, '2026-27', '1', 'x')], S27).map(r => r.players.id).join() === 'b,a');
  ok('whole numbers that add up: 63.2 / 24.4 / 11.6 / 0.8 -> 63 / 24 / 12 / 1', X.apportion([63.2, 24.4, 11.6, 0.8], 100).join() === '63,24,12,1');
}

console.log('\nthe profile\'s depth chart: each position\'s minutes and who took them (shareChart)');
{
  /* two games of floorPos minutes: at the point, p1 30 + p2 10 (+ a duplicate row for p1, as two roster rows gave),
     a gone man and a man out at the wing, and a 0.3% sliver at centre */
  const pos = { games: 2, min: 400, players: [
    { id: 'p1', min: [30, 10, 0, 0, 0] }, { id: 'p1', min: [0, 0, 0, 0, 0] }, { id: 'p2', min: [10, 25, 5, 0, 0] },
    { id: 'p3', min: [0, 5, 30, 10, 0] }, { id: 'gone', min: [0, 0, 5, 0, 0] }, { id: 'hurt', min: [0, 0, 0, 25, 4] },
    { id: 'big', min: [0, 0, 0, 5, 35.88] }, { id: 'sliver', min: [0, 0, 0, 0, 0.12] }] };
  const names = { p1: ['Point One', '1'], p2: ['Two Guard', '2'], p3: ['Wing Three', '3'], gone: ['Gone Man', ''], hurt: ['Hurt Four', '4'], big: ['Big Five', '5'], sliver: ['Tiny Sliver', '9'] };
  const who = id => ({ name: names[id][0], num: names[id][1], out: id === 'hurt', left: id === 'gone' });
  const c = X.shareChart({ pos, who, starts: new Map([['p1', 2], ['big', 1]]), window: 'season', games: 2 });
  const col = k => c.slots.find(s => s.key === k);
  ok('each column adds up to 100%, folded tail included', c.slots.every(s => s.players.reduce((a, p) => a + p.pct, 0) + (s.others ? s.others.pct : 0) === 100),
     c.slots.map(s => s.players.map(p => p.pct).join('+') + (s.others ? '+' + s.others.pct : '')).join(' | '));
  ok('a player stands once at a position, however many rows the file has for him: Point One 75% of the point',
     col('PG').players.filter(p => p.id === 'p1').length === 1 && col('PG').players[0].pct === 75 && col('PG').players[1].pct === 25);
  ok('...and at every position he played: Two Guard at the 1, the 2 and the 3', ['PG', 'SG', 'SF'].every(k => col(k).players.some(p => p.id === 'p2')));
  ok('the minutes of a man out or gone stay his, and say so', col('PF').players.find(p => p.id === 'hurt').out && col('SF').players.find(p => p.id === 'gone').left
     && col('PF').players[0].id === 'hurt');
  ok('a share under one percent is folded into one others line', !col('C').players.some(p => p.id === 'sliver') && col('C').others && col('C').others.n === 1 && col('C').others.names[0] === 'Tiny Sliver');
  ok('the first choice at each position is its biggest share', c.slots.every(s => !s.players.length || s.players[0].role === 'starter'));
  const h = X.shareHTML(c, { link: p => '../p/?p=' + p.id });
  ok('drawn: the share first, the minutes, the starts, 100% under each column, the rule said',
     /<b class="dc-pct">75%<\/b> · 30 min · 2 starts/.test(h) && (h.match(/100% · \d+ min/g) || []).length === 5 && /share of the minutes played at each position in this season \(2 games\)/.test(h), h.slice(0, 400));
  ok('...out and gone marked and dimmed, the others line titled with who they are', /· out</.test(h) && /· left the club</.test(h) && /dc-gone/.test(h) && /title="Tiny Sliver"/.test(h));
  ok('...names escaped', !/<script>/.test(X.shareHTML(X.shareChart({ pos, who: () => ({ name: '<script>x</script>' }) }))));
  const l5 = X.shareHTML(X.shareChart({ pos: Object.assign({}, pos, { games: 4 }), who, starts: new Map([['p1', 4]]), window: 'last5', games: 5 }));
  ok('the last five: starts out of five, and how many of the five carry lineups', /4\/5 starts/.test(l5) && /in the club's last 5 games \(4 of the 5 games have lineups\)/.test(l5));
  ok('no minutes at all: null, and the page says there are no lineups', X.shareChart({ pos: { players: [{ id: 'a', min: [0, 0, 0, 0, 0] }] } }) === null && /No lineups/.test(X.shareHTML(null)));

  /* SHOW ALL: under 5% is folded by default; the reader's button shows everyone */
  const pos2 = { games: 3, players: [{ id: 'a', min: [80, 0, 0, 0, 0] }, { id: 'b', min: [16, 0, 0, 0, 0] }, { id: 'c', min: [3.7, 0, 0, 0, 0] }, { id: 'd', min: [0.3, 0, 0, 0, 0] }] };
  const nm = id => ({ name: 'Player ' + id.toUpperCase() });
  const few = X.shareChart({ pos: pos2, who: nm }), all = X.shareChart({ pos: pos2, who: nm, all: true });
  const pg = c => c.slots[0];
  ok('by default a share under 5% is folded: 80% and 16% shown, the 3.7% and the 0.3% are "2 others · 4%"',
     pg(few).players.map(p => p.pct).join() === '80,16' && pg(few).others.n === 2 && pg(few).others.pct === 4 && few.hidden === 2,
     JSON.stringify(pg(few).players.map(p => p.pct)) + ' ' + JSON.stringify(pg(few).others));
  ok('...and the rule is said', /a share under 5% is folded into others/.test(X.shareHTML(few)));
  ok('show all: every player who played there, the column still 100%, the sliver "under 1%", no others line, no rule',
     pg(all).players.length === 4 && !pg(all).others && all.hidden === 0 && pg(all).players.reduce((a, p) => a + p.pct, 0) === 100
     && /under 1%<\/b>/.test(X.shareHTML(all)) && !/is folded into others/.test(X.shareHTML(all)), JSON.stringify(pg(all).players.map(p => p.pct)));
}

console.log('\neach game\'s minutes at each position, as a file (posFile, posFromFiles, posLines)');
{
  /* a home side of seven and an away side of six, three and two stints; a stint of four is a feed's gap */
  const val = { h1: 1.2, h2: 1.9, h3: 2.6, h4: 3.4, h5: 4.6, h6: 2.0, h7: 4.9, a1: 1.1, a2: 2.2, a3: 3.1, a4: 4.0, a5: 4.8, a6: 1.5 };
  const valueOf = id => val[id];
  const st = (game, side, ids, s) => ({ game_id: game, team_idx: side, player_ids: ids, dur: s * 1000 });
  const g1 = [st('g1', 0, ['h1', 'h2', 'h3', 'h4', 'h5'], 600), st('g1', 0, ['h6', 'h2', 'h3', 'h4', 'h7'], 420.4),
              st('g1', 0, ['h1', 'h6', 'h3', 'h4', 'h5'], 179.6), st('g1', 0, ['h1', 'h2', 'h3', 'h4'], 90),
              st('g1', 1, ['a1', 'a2', 'a3', 'a4', 'a5'], 900), st('g1', 1, ['a6', 'a2', 'a3', 'a4', 'a5'], 300)];
  const line = (game, side, id, sec) => ({ game_id: game, team_idx: side, player_uuid: id, player_id: id, min: sec * 1000 });
  const box1 = [line('g1', 0, 'h1', 1300), line('g1', 0, 'h2', 1100), line('g1', 0, 'h3', 1200), line('g1', 0, 'h4', 1290),
                line('g1', 0, 'h5', 780), line('g1', 0, 'h6', 600), line('g1', 0, 'h7', 420), line('g1', 0, 'h8', 0), line('g1', 0, 'h9', 75),
                line('g1', 1, 'a1', 900), line('g1', 1, 'a2', 1200), line('g1', 1, 'a3', 1200), line('g1', 1, 'a4', 1200), line('g1', 1, 'a5', 1200), line('g1', 1, 'a6', 300)];
  const f1 = X.posFile({ game: 'g1', finalised_at: '2026-10-02T10:00:00Z', stints: g1, lines: box1, valueOf });
  ok('a file: this layout, its game and the finalisation it was written from, a side each', f1.v === X.POS_FILE_V && f1.v === 1 &&
     f1.game === 'g1' && f1.f === '2026-10-02T10:00:00Z' && Array.isArray(f1.t) && f1.t.length === 2);
  ok('...every player on the floor or with box minutes, his box seconds first and then PG..C',
     Object.keys(f1.t[0]).sort().join() === 'h1,h2,h3,h4,h5,h6,h7,h9' && Object.keys(f1.t[1]).sort().join() === 'a1,a2,a3,a4,a5,a6' &&
     Object.values(f1.t[0]).concat(Object.values(f1.t[1])).every(a => a.length === 6 && a.every(x => Number.isInteger(x) && x >= 0)), JSON.stringify(f1.t[0]));
  ok('...a player who did not play is not in it, one with minutes and no lineup is [box, 0, 0, 0, 0, 0]',
     !('h8' in f1.t[0]) && JSON.stringify(f1.t[0].h9) === '[75,0,0,0,0,0]');
  ok('...each five laid point guard to centre by its positions (h6 at 2.0 is the shooting guard beside h2 at 1.9)',
     f1.t[0].h1[1] === 780 && f1.t[0].h2[1] === 420 && f1.t[0].h2[2] === 600 && f1.t[0].h6[2] === 600 && f1.t[0].h5[5] === 780 && f1.t[0].h7[5] === 420 && f1.t[0].h6[1] === 0,
     JSON.stringify({ h1: f1.t[0].h1, h2: f1.t[0].h2, h6: f1.t[0].h6 }));
  const posSec = t => Object.values(t).reduce((a, x) => a + x.slice(1).reduce((b, y) => b + y, 0), 0);
  ok('...five on the floor: a side\'s position seconds are five times its stints\' (the stint of four left out), to the rounding',
     Math.abs(posSec(f1.t[0]) - 5 * 1200) <= 3 && posSec(f1.t[1]) === 5 * 1200, posSec(f1.t[0]) + ' / ' + posSec(f1.t[1]));
  ok('...and small: a game\'s file is under 2 KB', JSON.stringify(f1).length < 2048, JSON.stringify(f1).length + ' bytes');

  /* the page's sums from the files are floorPos's from the lineups */
  const g2 = [st('g2', 1, ['h1', 'h2', 'h3', 'h4', 'h5'], 1000), st('g2', 1, ['h1', 'h6', 'h3', 'h7', 'h5'], 1400),
              st('g2', 0, ['a1', 'a2', 'a3', 'a4', 'a5'], 2400)];
  const f2 = X.posFile({ game: 'g2', finalised_at: null, stints: g2, lines: [], valueOf });
  const f3 = X.posFile({ game: 'g3', stints: [], lines: [line('g3', 0, 'h1', 2000)], valueOf });     // a feed with no lineups
  const sideOf = { g1: 0, g2: 1, g3: 0 };
  const fromFiles = X.posFromFiles([f1, f2, f3], sideOf), fromStints = X.floorPos(g1.concat(g2), sideOf, valueOf);
  const near = (a, b) => [...new Set(a.players.map(p => p.id).concat(b.players.map(p => p.id)))].every(id => {
    const x = a.players.find(p => p.id === id), y = b.players.find(p => p.id === id);
    return x && y && x.min.every((m, k) => Math.abs(m - y.min[k]) < 1 / 60 + 1e-9);
  });
  ok('the club\'s side of its files, summed, is floorPos on its lineups: the same players, each position to the second',
     fromFiles && fromStints && near(fromFiles, fromStints) && fromFiles.players.length === fromStints.players.length,
     JSON.stringify(fromFiles && fromFiles.players.slice(0, 3)));
  ok('...the same games (a game whose file has no lineups adds none) and the same minutes on the floor',
     fromFiles.games === 2 && fromStints.games === 2 && Math.abs(fromFiles.min - fromStints.min) < 0.05, fromFiles.games + ' ' + fromFiles.min + ' ' + fromStints.min);
  ok('...the other side is not the club\'s', !fromFiles.players.some(p => /^a/.test(p.id)));
  ok('...and the share chart draws it as it draws floorPos', JSON.stringify(X.shareChart({ pos: fromFiles }).slots.map(s => s.players.map(p => p.id + p.pct))) ===
     JSON.stringify(X.shareChart({ pos: fromStints }).slots.map(s => s.players.map(p => p.id + p.pct))));
  ok('no files, or none with the club\'s lineups: null', X.posFromFiles([], sideOf) === null && X.posFromFiles([f3], sideOf) === null && X.posFromFiles(null) === null);
  ok('a file this code cannot read is skipped: another layout, another game, a broken shape',
     X.posFileOk(f1, 'g1') && !X.posFileOk(f1, 'g2') && !X.posFileOk(Object.assign({}, f1, { v: 2 })) && !X.posFileOk({ v: 1, game: 'g1', t: [{}] }) &&
     X.posFromFiles([Object.assign({}, f1, { v: 2 })], sideOf) === null);

  /* who played: the box minutes, as injuries.js reads them */
  const rows = X.posLines([f1, f2, f3]);
  ok('posLines: the box minutes as player_game_stats rows (stats.min in milliseconds, both sides)',
     rows.length === 8 + 6 + 1 && rows.every(r => r.player_uuid && (r.team_idx === 0 || r.team_idx === 1) && r.stats.min > 0) &&
     rows.find(r => r.game_id === 'g1' && r.player_uuid === 'h9').stats.min === 75000 && !rows.some(r => r.game_id === 'g2'), rows.length);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia/injuries.js'), 'utf8'), ctx, { filename: 'injuries.js' });
  const INJ = sandbox.EpinoiaInjuries;
  /* five games of a club: its starter h1 plays the first three heavily and none of the last two */
  const games = ['k1', 'k2', 'k3', 'k4', 'k5'].map((id, i) => ({ id, tipoff_at: '2026-09-0' + (i + 1), home_team_id: 'T', away_team_id: 'U' }));
  const files = games.map((g, i) => X.posFile({ game: g.id, stints: [], valueOf,
    lines: [line(g.id, 0, 'h2', 1500)].concat(i < 3 ? [line(g.id, 0, 'h1', 1800)] : []).concat([line(g.id, 0, 'h3', i === 4 ? 0 : 900)]) }));
  const pgs = games.flatMap((g, i) => [line(g.id, 0, 'h2', 1500), line(g.id, 0, 'h1', i < 3 ? 1800 : 0), line(g.id, 0, 'h3', i === 4 ? 0 : 900)])
    .map(r => ({ game_id: r.game_id, player_uuid: r.player_uuid, team_idx: r.team_idx, stats: { min: r.min } }));
  const fromBox = INJ.report({ games, pgs }), fromPos = INJ.report({ games, pgs: X.posLines(files) });
  const ids = rep => (rep.byTeam.get('T') || []).map(e => e.playerId + ':' + e.missed).sort().join();
  ok('...and the injury report reads them as it reads the box score: the same players missing, the same games missed',
     ids(fromPos) === ids(fromBox) && /h1:2/.test(ids(fromPos)), ids(fromPos) + ' | ' + ids(fromBox));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
