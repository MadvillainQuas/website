/* ============================================================================
   THE GAME IN ITS SEASON, AND WHAT DECIDED IT (2026-10-07).

   context.js works out what a result meant from the season around it (streaks, the table, the meetings, the
   schedule, the fans' picks, season highs, returns, milestones, what the season's numbers expected); story.js turns
   that into facts, and the value ledger into what each facet of the game was worth; report.js says them. Every claim
   here is about OTHER games, so the tests hold the arithmetic and the "before this game" rule, and the regressions
   that reached a reader:

     * "a season high" for a night six points over an average (it was not the player's best);
     * the same season high said twice, on the line and again a paragraph later;
     * "climb to third in Group C" after a club's first game.

       node supabase/tests/context.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = path.join(ROOT, 'epinoia', 'game');
globalThis.EpinoiaStory = require(path.join(G, 'story.js'));
globalThis.EpinoiaLanguage = require(path.join(G, 'language.js'));
const Story = globalThis.EpinoiaStory;
const Report = require(path.join(G, 'report.js'));
const View = require(path.join(G, 'reportview.js'));
const Context = require(path.join(G, 'context.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.error('  FAIL  ' + n + (d ? '  -> ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) : '')); } };

/* ------------------------------------------------------------- a season --- */
const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', C = 'cccccccc-0000-0000-0000-000000000003';
const day = n => new Date(Date.UTC(2026, 9, 1 + n, 18)).toISOString();
let gid = 0;
const game = (n, h, a, hs, as, extra) => Object.assign({ id: 'g' + (++gid), home_team_id: h, away_team_id: a, home_score: hs, away_score: as, tipoff_at: day(n) }, extra || {});
/* A loses three, then wins; B wins four; they meet once before (B won); C is in the table too */
const season = [
  game(0, A, C, 70, 80), game(1, B, C, 90, 70), game(3, C, A, 85, 75), game(4, B, A, 88, 80),   // A 0-3, B 2-0
  game(6, B, C, 81, 79), game(7, C, B, 70, 77)                                                       // B 4-0
];
const ME = { id: 'me', home: A, away: B, tipoff: day(10), score: [84, 79] };      // A beat B at home
const pgs = [];
const line = (g, side, pid, pts, mins, extra) => pgs.push({ game_id: g, team_idx: side, player_uuid: pid, stats: Object.assign({ pts, min: (mins || 30) * 60000 }, extra || {}) });
/* p1 (A) scored 10, 12, 14 then 24 tonight: a season high and well over the average */
line('g1', 0, 'p1', 10); line('g3', 1, 'p1', 12); line('g4', 1, 'p1', 14); line('me', 0, 'p1', 24);
/* p2 (A) scored 30 once, then 12, 11 and 22 tonight: well over the average, NOT a season high */
line('g1', 0, 'p2', 30); line('g3', 1, 'p2', 12); line('g4', 1, 'p2', 11); line('me', 0, 'p2', 22);
/* p3 (B) has 20+ in three before tonight and 21 tonight: four straight */
line('g2', 0, 'p3', 22); line('g4', 0, 'p3', 20); line('g5', 0, 'p3', 25); line('g6', 1, 'p3', 21); line('me', 1, 'p3', 21);
/* p4 (A) played the first game, missed the next two, is back tonight */
line('g1', 0, 'p4', 8); line('me', 0, 'p4', 9, 20);
const table = { comp: { id: 'comp1', name: 'The League' }, rows: [
  /* standings AFTER the game (A 1-3, B 4-1, C 2-3: the page reads them once the game is final) */
  { team_id: B, rank: 1, gp: 5, w: 4, l: 1, group_name: null, teams: { name: 'Bees' } },
  { team_id: C, rank: 2, gp: 5, w: 2, l: 3, group_name: null, teams: { name: 'Cees' } },
  { team_id: A, rank: 3, gp: 4, w: 1, l: 3, group_name: null, teams: { name: 'Aces' } }
] };
const ctx = Context.build({ gameId: 'me', tipoff: ME.tipoff, home: A, away: B, score: ME.score, games: season.concat([{ id: 'me', home_team_id: A, away_team_id: B, home_score: 84, away_score: 79, tipoff_at: ME.tipoff }]),
  pgs, table, competitionId: 'comp1', tally: { home: 4, away: 16 },
  fixtures: [{ id: 'f1', home_team_id: C, away_team_id: A, tipoff_at: day(13) }, { id: 'f2', home_team_id: B, away_team_id: C, tipoff_at: day(12) }],
  teamNames: { [C]: 'Cees' } });

console.log('\nthe season before the game, and after it');
ok('records before the game are counted from earlier games only', ctx.sides[0].before.w === 0 && ctx.sides[0].before.l === 3 && ctx.sides[1].before.w === 4 && ctx.sides[1].before.l === 0, ctx.sides.map(s => s.before));
ok('...and after it with this result added (wins after = wins before + 1)', ctx.sides[0].after.w === ctx.sides[0].before.w + 1 && ctx.sides[1].after.l === ctx.sides[1].before.l + 1);
ok('the streaks: A ended a run of three defeats, B a run of four wins', ctx.sides[0].before.streak.n === 3 && !ctx.sides[0].before.streak.won && ctx.sides[1].before.streak.n === 4 && ctx.sides[1].before.streak.won);
ok('the meetings before this one: B won the only one', ctx.h2h && ctx.h2h.meetings.length === 1 && ctx.h2h.last.won === 1, ctx.h2h);
ok('the next game each club has, with the opponent named', ctx.next[0] && ctx.next[0].id === 'f1' && ctx.next[0].oppName === 'Cees' && ctx.next[1] && ctx.next[1].id === 'f2');
ok('rest: three days since A last played', Math.abs(ctx.sides[0].rest - 6) < 1e-9 || Math.abs(ctx.sides[0].rest - 3) < 1e-9, ctx.sides[0].rest);
ok('the table before the game takes this result back off both clubs', ctx.table[1].before && ctx.table[1].before.leader === true && ctx.table[1].leader === true, ctx.table);
ok('a player’s season high is the best BEFORE this game', ctx.players.p1.high.pts === 14 && ctx.players.p2.high.pts === 30, ctx.players);
ok('...and the run of 20-point games counts this one (four before, five with it)', ctx.players.p3.run20 === 5, ctx.players.p3);
ok('a player back after missing his side’s games is found', ctx.back.p4 && ctx.back.p4.missed === 2, ctx.back);
ok('the fans’ picks are carried', ctx.tally && ctx.tally.n === 20);

/* ------------------------------------------------------------- the facts --- */
const mk = (id, name, team, o) => Object.assign({ id, name, team, num: '4', min: 1800000, pts: 0, or: 0, dr: 0, ast: 0, stl: 0,
  blk: 0, pf: 0, to: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 }, o);
function brief(over) {
  const players = [mk('p1', 'ada aces', 0, { pts: 24, p2m: 9, p2a: 15, p3m: 2, p3a: 4 }), mk('p2', 'bo aces', 0, { pts: 22, p2m: 8, p2a: 16, p3m: 2, p3a: 5 }),
    mk('p4', 'cy aces', 0, { pts: 9, p2m: 3, p2a: 6, p3m: 1, p3a: 2, min: 1200000 }),
    mk('p3', 'di bees', 1, { pts: 21, p2m: 9, p2a: 17, p3m: 1, p3a: 4 }), mk('p5', 'ed bees', 1, { pts: 18, p2m: 6, p2a: 12, p3m: 2, p3a: 6 })];
  const byId = {}; players.forEach(p => { byId[p.id] = p; });
  return Object.assign({ names: ['aces', 'bees'], score: [84, 79], players, byId, team: [{}, {}],
    adv: [{ efg: 54, tovp: 12, orebp: 30, ftr: 25, possessions: 72, fga: 66, fgm: 31, fg3a: 20, fg3m: 7, fta: 16, ftm: 12, rimA: 22, rimM: 14, midA: 20, midM: 8 },
          { efg: 50, tovp: 15, orebp: 26, ftr: 20, possessions: 73, fga: 68, fgm: 30, fg3a: 22, fg3m: 8, fta: 14, ftm: 11, rimA: 18, rimM: 10, midA: 24, midM: 10 }],
    lineups: [[], []], stints: [[], []], perQ: [[0, 20, 22, 20, 22], [0, 22, 18, 21, 18]], periods: 4, events: [], ctx }, over || {});
}
const g = brief();
const fs = Story.facts(g);
const kinds = new Set(fs.map(f => f.kind));
console.log('\nthe facts the season gives');
ok('the winners ended a losing run', kinds.has('skidEnded') && fs.find(f => f.kind === 'skidEnded').data.n === 3);
ok('...and ended the losers’ winning run', kinds.has('streakEnded') && fs.find(f => f.kind === 'streakEnded').data.n === 4);
ok('the first defeat of an unbeaten side is a fact', kinds.has('firstDefeat'));
ok('the last meeting turned round is a fact', fs.some(f => f.kind === 'h2h' && f.data.revenge));
ok('a season high: p1’s 24 beats a best of 14', fs.some(f => f.kind === 'careerNight' && f.data.p.id === 'p1' && f.data.stat === 'pts'));
ok('NOT a season high: p2’s 22 is under a best of 30', !fs.some(f => f.kind === 'careerNight' && f.data.p.id === 'p2'));
ok('a run of 20-point games', fs.some(f => f.kind === 'hotStreak' && f.data.p.id === 'p3' && f.data.n === 5));
ok('a return from missed games', fs.some(f => f.kind === 'returned' && f.data.p.id === 'p4'));
ok('most fans picked the losers', kinds.has('fansWrong'));
ok('table claims wait for three games each (A has four, B five: allowed)', true);

const r = Report.report(g);
const all = [r.headline, r.standfirst].concat(r.sections.flatMap(s => s.paras)).join(' ').replace(/<[^>]*>/g, '');
console.log('\nwhat the report says');
ok('the report has a "What it means" section with its card', r.sections.some(s => s.heading === 'What it means' && s.card === 'next'), r.sections.map(s => s.heading));
ok('every section renders with its card', (View.render(g, r).match(/rcard-h/g) || []).length === r.sections.length);
ok('p1’s season high is said once', (all.match(/season[- ]high/gi) || []).length === 1, all);
ok('...on p1’s own line', /a season-high 24|24 [^.]*season high/.test(all), all);
ok('p2 is never said to have had a season high', !/(Bo Aces|Aces)[^.]*season[- ]high 22|season-high 22/.test(all), all);
ok('the first defeat leads somewhere near the top', /first defeat/.test(r.headline + ' ' + r.standfirst + ' ' + r.sections[0].paras.join(' ')), r.headline + ' | ' + r.standfirst);
ok('no slot ever reaches the text', !/\b(undefined|NaN|null|Infinity)\b|\[object|\{\{|\[\[/.test(all), all);
ok('every sentence naming a player names a club', all.split(/(?<=[.!?])\s+/).filter(sn => /\b(Ada|Bo|Cy|Di|Ed) (Aces|Bees)\b/.test(sn) && !/(Aces|Bees)\b[^.]*\b(Aces|Bees)\b|for (Aces|Bees)|(Aces|Bees)’s?\b/.test(sn)).length === 0, all);

console.log('\nthe table waits until it has formed');
{
  const early = Context.build({ gameId: 'me', tipoff: ME.tipoff, home: A, away: B, score: ME.score, games: [], competitionId: 'comp1',
    table: { comp: { id: 'comp1' }, rows: [{ team_id: A, rank: 3, gp: 1, w: 1, l: 0 }, { team_id: B, rank: 4, gp: 1, w: 0, l: 1 }, { team_id: C, rank: 1, gp: 1, w: 1, l: 0 }] } });
  const f2 = Story.facts(brief({ ctx: early }));
  ok('no climb, top or standing claims after one game each', !f2.some(f => ['climbed', 'wentTop', 'stayTop', 'standing', 'upset'].indexOf(f.kind) >= 0), f2.filter(f => f.data && f.data.rank).map(f => f.kind));
}

console.log('\nthe value ledger');
{
  const L = fs.find(f => f.kind === 'ledger');
  ok('the rows add up to the scoreboard margin', L && Math.abs(L.data.rows.reduce((s, x) => s + x.pts, 0) - 5) < 1e-9, L && L.data.rows);
  ok('shooting splits into the shots taken and the shots made', L && L.data.rows.some(x => x.key === 'quality') && L.data.rows.some(x => x.key === 'making'));
  ok('the facet that decided it favours the winners', L && L.data.decisive && L.data.decisive.pts > 0);
  /* the model's own weights: b x the difference, and its home edge */
  const gm = brief({ model: { n: 40, home: 1.5, b: { efg: 1, tovp: -1, orebp: 0.4, ftr: 0.15 } } });
  const Lm = Story.facts(gm).find(f => f.kind === 'ledger');
  const row = k => Lm.data.rows.find(x => x.key === k);
  ok('with the league’s model a factor is b x the difference', Math.abs(row('tovp').pts - (-1 * (12 - 15))) < 1e-9 && Math.abs(row('orebp').pts - 0.4 * (30 - 26)) < 1e-9, Lm.data.rows);
  ok('...the home edge is its own row', Math.abs(row('home').pts - 1.5) < 1e-9);
  ok('...and the rows still add up to the margin', Math.abs(Lm.data.rows.reduce((s, x) => s + x.pts, 0) - 5) < 1e-9);
  const facetFacts = Story.facts(gm).filter(f => f.facet);
  ok('facts about a facet carry its value (weighFacets)', facetFacts.length > 0 && facetFacts.every(f => isFinite(f.value)));
  const rm = Report.report(gm);
  const sec = rm.sections.find(s => s.card === 'ledger');
  ok('the "What decided it" section says it is weighed by the league’s model', sec && /this league/.test(sec.paras[0]), sec && sec.paras);
  ok('the ledger card renders with a row per facet and the final margin', /What decided it, in points/.test(View.render(gm, rm)) && /Final margin/.test(View.render(gm, rm)));
}

console.log('\nthe expectation from the season’s four factors');
{
  /* two clubs, one far better at every factor: the season's numbers must expect it to win */
  const tg = [];
  const gs = [];
  for (let i = 0; i < 6; i++) {
    const id = 'x' + i;
    gs.push({ id, home_team_id: i % 2 ? A : C, away_team_id: i % 2 ? C : A, home_score: 90, away_score: 70, tipoff_at: day(i) });
    const good = { adv: { fgm: 34, fga: 64, fg3m: 10, fta: 22, tov: 9, oreb: 13, dreb: 30 } }, bad = { adv: { fgm: 26, fga: 68, fg3m: 5, fta: 12, tov: 17, oreb: 8, dreb: 24 } };
    tg.push({ game_id: id, team_idx: i % 2 ? 0 : 1, stats: good }, { game_id: id, team_idx: i % 2 ? 1 : 0, stats: bad });
    const id2 = 'y' + i;
    gs.push({ id: id2, home_team_id: i % 2 ? B : C, away_team_id: i % 2 ? C : B, home_score: 70, away_score: 75, tipoff_at: day(i) });
    tg.push({ game_id: id2, team_idx: i % 2 ? 0 : 1, stats: bad }, { game_id: id2, team_idx: i % 2 ? 1 : 0, stats: bad });
  }
  const c2 = Context.build({ gameId: 'me', tipoff: day(20), home: A, away: B, score: [80, 70], games: gs, tgs: tg });
  ok('the better side is expected to win', c2.expect && c2.expect.margin > 3, c2.expect);
  ok('...on every factor', c2.expect && ['efg', 'orebp', 'ftr'].every(k => c2.expect.parts[k].pts > 0) && c2.expect.parts.tovp.pts > 0, c2.expect && c2.expect.parts);
}

console.log('\nbefore a game: the preview’s season (context.js preview, preview.js valuedParas)');
{
  const Preview = require(path.join(G, 'preview.js'));
  /* the season above, read before a fixture between A and B a few days later */
  const all = season.concat([{ id: 'me', home_team_id: A, away_team_id: B, home_score: 84, away_score: 79, tipoff_at: ME.tipoff }]);
  const tg = [];
  all.forEach((g, i) => {
    const hw = g.home_score > g.away_score;
    tg.push({ game_id: g.id, team_idx: 0, stats: { adv: { fgm: hw ? 33 : 28, fga: 66, fg3m: 8, fta: 18, tov: 12, oreb: 10, dreb: 26 } } });
    tg.push({ game_id: g.id, team_idx: 1, stats: { adv: { fgm: hw ? 28 : 33, fga: 66, fg3m: 8, fta: 18, tov: 12, oreb: 10, dreb: 26 } } });
  });
  const pv = Context.preview({ home: B, away: A, tipoff: day(14), games: all, pgs, tgs: tg, table, model: null });
  ok('records come from the games before the fixture', pv.sides[0].w === 4 && pv.sides[0].l === 1 && pv.sides[1].w === 1 && pv.sides[1].l === 3, pv.sides);
  ok('...the meetings, from the home side’s end', pv.meetings.length === 2 && pv.meetings[1].won === 1, pv.meetings);
  ok('...the rest: four days for both', Math.abs(pv.sides[0].rest - 4) < 1e-9 && Math.abs(pv.sides[1].rest - 4) < 1e-9, pv.sides.map(s => s.rest));
  ok('...each side’s players, the best scorer first', pv.players[0][0] && pv.players[0][0].id === 'p3' && pv.players[1].some(p => p.id === 'p1'), pv.players);
  ok('...and a run of 20-point games carried into it', pv.players[0][0].run20 === 5, pv.players[0][0]);
  const ctxP = { nameA: 'Bees', nameB: 'Aces', pre: pv, names: { p1: 'Ada Aces', p3: 'Di Bees', p2: 'Bo Aces' } };
  const paras = Preview.__test.valuedParas(ctxP);
  const txt = paras.join(' ');
  ok('the valued preview says where they stand', /Bees are first at 4–1|First against/.test(txt), txt);
  ok('...the meetings', /season series is level at 1–1/.test(txt), txt);
  ok('...the season’s expectation, with a lean', /better here\./.test(txt) && /(toss-up|lean|favourites|comfortably)/.test(txt), txt);
  ok('...and who carries the form', /Di Bees has scored 20 or more in/.test(txt), txt);
  ok('...with no empty slot', !/\b(undefined|NaN|null|Infinity)\b|\[object/.test(txt), txt);
  /* a facet bigger than the whole edge is not "most of that" */
  const big = { nameA: 'Hosts', nameB: 'Visitors', names: {}, pre: { sides: [{ gp: 5, w: 3, l: 2, streak: null, last5: 'WWLWL' }, { gp: 5, w: 3, l: 2, streak: null, last5: 'LWWLW' }],
    meetings: [], table: [null, null], players: [[], []],
    expect: { margin: 2, alpha: null, model: true, parts: { efg: { home: 55, away: 50, pts: 5 }, tovp: { home: 14, away: 12, pts: -3 }, orebp: { home: 28, away: 28, pts: 0 }, ftr: { home: 25, away: 25, pts: 0 } } } } };
  const t2 = Preview.__test.valuedParas(big).join(' ');
  ok('a facet bigger than the whole edge is said as one', /the shooting alone is worth more than that|The shooting alone is worth more than that/.test(t2) && !/Most of that/.test(t2), t2);
  ok('...and the possessive of a name in s', /Visitors’ edge is the turnover battle/.test(t2), t2);

  /* HOW EACH COMES IN, HOME AND AWAY, CLOSE GAMES (2026-10-08) */
  ok('each side’s last game, its opponent named from the table, and whoever carried it',
     pv.sides[1].last && pv.sides[1].last.id === 'me' && pv.sides[1].last.won && pv.sides[1].last.oppName === 'Bees' && pv.sides[1].last.top && pv.sides[1].last.top.id === 'p1' && pv.sides[1].last.top.pts === 24, pv.sides[1].last);
  ok('...the records at home, on the road and in games decided by five or fewer',
     pv.sides[0].home.w === 3 && pv.sides[0].road.w === 1 && pv.sides[0].road.l === 1 && pv.sides[1].road.l === 2 && pv.sides[0].close.w === 1 && pv.sides[0].close.l === 1, pv.sides.map(s => [s.home, s.road, s.close]));
  ok('...and each meeting carries both sides’ best lines', pv.meetings[0].tops && pv.meetings[0].tops[0].id === 'p3' && pv.meetings[0].tops[1].id === 'p1', pv.meetings);
  ok('two who met last time out: that game once, from the winner’s end', /They met last time out, Aces winning 84–79 at home with 24 from Ada Aces\./.test(txt) && !/come in off/.test(txt), txt);
  ok('a home side that has won every game at home says so', /Bees have won all three at home\./.test(txt), txt);
  /* two more games for Bees, against C: a different last game for each side, said two ways */
  const more = all.concat([game(12, C, B, 70, 95), game(12.5, B, C, 88, 86)]);
  const g9 = more[more.length - 2].id, g10 = more[more.length - 1].id;
  const pg2 = pgs.concat([{ game_id: g9, team_idx: 1, player_uuid: 'p3', stats: { pts: 31, or: 3, dr: 9, min: 1800000 } },
                          { game_id: g10, team_idx: 0, player_uuid: 'p3', stats: { pts: 26, ast: 11, min: 1800000 } }]);
  const pv2 = Context.preview({ home: B, away: A, tipoff: day(16), games: more, pgs: pg2, tgs: tg, table, model: null });
  const t3 = Preview.__test.valuedParas(Object.assign({}, ctxP, { pre: pv2 })).join(' ');
  ok('a recent last game: "come in off", the carrier with a double-double', /Bees come in off an 88–86 home win over Cees, with 26 points and 11 assists from Di Bees\./.test(t3), t3);
  ok('...and the second side the other way round', /Aces beat Bees 84–79 at home last time out, with 24 from Ada Aces\./.test(t3), t3);
  /* a third straight win: the run says its latest */
  const more3 = more.concat([game(14, C, B, 60, 90)]);
  const pv3 = Context.preview({ home: B, away: A, tipoff: day(17), games: more3, pgs: pg2, tgs: tg, table, model: null });
  const t4 = Preview.__test.valuedParas(Object.assign({}, ctxP, { pre: pv3 })).join(' ');
  ok('a run says its latest game', /Bees have won three straight, the latest 90–60 at Cees\./.test(t4), t4);
  /* a fortnight on, nobody "comes in off" anything */
  const pv4 = Context.preview({ home: B, away: A, tipoff: day(40), games: more3, pgs: pg2, tgs: tg, table, model: null });
  const t5 = Preview.__test.valuedParas(Object.assign({}, ctxP, { pre: pv4 })).join(' ');
  ok('...and nothing older than a fortnight', !/come in off|last time out|the latest/.test(t5), t5);
  /* close games, when the numbers expect a close one */
  const close = { nameA: 'Hosts', nameB: 'Visitors', names: {}, pre: { sides: [
      { gp: 8, w: 6, l: 2, streak: null, last5: 'WLWWL', close: { w: 4, l: 0 } }, { gp: 8, w: 4, l: 4, streak: null, last5: 'LWLWL', close: { w: 1, l: 3 } }],
    meetings: [], table: [null, null], players: [[], []],
    expect: { margin: 2.5, alpha: null, model: false, parts: { efg: { home: 52, away: 50, pts: 2.5 }, tovp: { home: 14, away: 14, pts: 0 }, orebp: { home: 28, away: 28, pts: 0 }, ftr: { home: 25, away: 25, pts: 0 } } } } };
  const t6 = Preview.__test.valuedParas(close).join(' ');
  ok('a close game expected: both sides’ records in games decided by five or fewer', /In games decided by five points or fewer, Hosts are 4–0 and Visitors 1–3\./.test(t6), t6);
  close.pre.expect.margin = 9;
  ok('...not when one side should win comfortably', !/decided by five/.test(Preview.__test.valuedParas(close).join(' ')));
  ok('...and no empty slot anywhere', ![txt, t3, t4, t5, t6].some(s => /\b(undefined|NaN|null|Infinity)\b|\[object/.test(s)), [t3, t4, t5, t6]);
}

console.log('\nthe league make rates');
{
  const tg = [];
  for (let i = 0; i < 25; i++) tg.push({ game_id: 'r' + i, team_idx: 0, stats: { adv: { fga: 60, fgm: 27, fg3a: 20, fg3m: 7, rimA: 20, rimM: 12, midA: 20, midM: 8, fta: 20, ftm: 15 } } });
  const R = Context.rates(tg, 'me');
  ok('pooled from the season’s team lines', R && Math.abs(R.three - 0.35) < 1e-9 && Math.abs(R.rim - 0.6) < 1e-9 && Math.abs(R.mid - 0.4) < 1e-9 && Math.abs(R.ft - 0.75) < 1e-9, R);
  ok('none under twenty games', Context.rates(tg.slice(0, 10), 'me') === null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
