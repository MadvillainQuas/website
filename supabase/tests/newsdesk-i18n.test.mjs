/* ============================================================================
   EVERY SENTENCE THE LEAGUE NEWSDESK WRITES COMES BACK WHOLE IN EVERY VISIBLE LANGUAGE.

   The newsdesk (epinoia/narrative.js) writes in English from templates; newsdesk.js draws it inside the 'newsdesk'
   sentence context, and each language's pack (epinoia/i18n/<code>/newsdesk.js) translates one sentence at a time with
   one anchored pattern per template, so a sentence is translated whole or left whole in English, never half. This builds
   the newsdesk on fixture leagues shaped to open every kind of storyline (runs and slides, the unbeaten and the winless,
   the race and the line, the play-offs and a two-legged tie, the season's shape, upsets and sweeps, the site's coverage
   and significance, the schedule, team records, the young, the fans' vote, threading from one build to the next), takes
   every string the page shows outside translate="no", and asks each language for it.

   "Fully translated": the engine returns something for it, and what comes back has no run of four English words left in
   it (names are the reader's own, so a sentence keeps its clubs and players in the original).

       node supabase/tests/newsdesk-i18n.test.mjs             every language
       node supabase/tests/newsdesk-i18n.test.mjs ja          one language, and its misses in full
       node supabase/tests/newsdesk-i18n.test.mjs --list      the English strings, grouped (to write patterns from)
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const require = createRequire(import.meta.url);
const core = require(path.join(EP, 'i18n.js'));
const N = require(path.join(EP, 'narrative.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

function registered(file) {
  const got = [];
  if (!fs.existsSync(file)) return got;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, pack) => got.push({ code: c, dict: d, pack: pack || null }) } } });
  return got;
}
/* the packs the front page and the creator hub load: core, report, newsdesk */
function dictFor(code) {
  const c = registered(path.join(EP, 'i18n', code + '.js')).find(x => x.code === code && !x.pack);
  const r = registered(path.join(EP, 'i18n', code, 'report.js')).find(x => x.code === code && x.pack === 'report');
  const n = registered(path.join(EP, 'i18n', code, 'newsdesk.js')).find(x => x.code === code && x.pack === 'newsdesk');
  return core.compile(code, core.merge([c && c.dict, r && r.dict, n && n.dict].filter(Boolean)));
}

/* ------------------------------------------------------------ the leagues --- */
const T = ['t1', 't2', 't3', 't4', 't5', 't6'];
const CLUBS = ['Ash City', 'Birch City', 'Cedar City', 'Damson City', 'Elm City', 'Fir City'];
const teams = {}; T.forEach((id, i) => { teams[id] = { name: CLUBS[i], slug: 'club' + i }; });
const NOW = Date.UTC(2026, 10, 30, 12);
const at = d => new Date(NOW - d * 86400000).toISOString();
let gn = 0;
const games = [];
const g = (d, h, a, hs, as) => { const x = { id: 'g' + (++gn), home_team_id: h, away_team_id: a, home_score: hs, away_score: as, tipoff_at: at(d), competition_id: 'c1' }; games.push(x); return x; };
g(40, 't1', 't2', 70, 80);
g(38, 't3', 't1', 70, 85); g(33, 't1', 't4', 90, 70); g(26, 't5', 't1', 66, 80); g(19, 't1', 't6', 95, 60); g(3, 't1', 't3', 88, 86);
g(39, 't2', 't3', 82, 70); g(32, 't4', 't2', 70, 75); g(25, 't2', 't6', 90, 50); g(18, 't5', 't2', 80, 78); g(4, 't2', 't4', 85, 80);
g(37, 't3', 't6', 80, 60); g(31, 't6', 't5', 60, 70); g(24, 't4', 't6', 90, 70); g(17, 't6', 't3', 70, 72); g(2, 't5', 't6', 81, 79);
g(30, 't4', 't5', 77, 75); g(23, 't3', 't4', 69, 71); g(16, 't5', 't3', 72, 70); g(1, 't4', 't3', 70, 74);
const fixtures = [{ id: 'f1', home_team_id: 't1', away_team_id: 't2', tipoff_at: new Date(NOW + 2 * 86400000).toISOString(), competition_id: 'c1' },
                  { id: 'f2', home_team_id: 't6', away_team_id: 't5', tipoff_at: new Date(NOW + 3 * 86400000).toISOString(), competition_id: 'c1' },
                  { id: 'f3', home_team_id: 't3', away_team_id: 't4', tipoff_at: new Date(NOW + 5 * 86400000).toISOString(), competition_id: 'c1' }];
const tableOf = gs => {
  const C = {};
  gs.forEach(x => { [x.home_team_id, x.away_team_id].forEach(id => { C[id] = C[id] || { w: 0, l: 0 }; }); const hw = x.home_score > x.away_score;
    C[x.home_team_id][hw ? 'w' : 'l']++; C[x.away_team_id][hw ? 'l' : 'w']++; });
  return { comp: { id: 'c1', name: 'The League' }, rows: T.map(id => ({ team_id: id, gp: C[id].w + C[id].l, w: C[id].w, l: C[id].l, rank: null, group_name: null })) };
};
const lines = [];
games.filter(x => x.home_team_id === 't1' || x.away_team_id === 't1').forEach((x, i) => {
  lines.push({ game_id: x.id, team_idx: x.home_team_id === 't1' ? 0 : 1, pid: 'p1', min: 1800000, pts: i >= 2 ? 24 : 12, reb: 5, ast: 3, stl: 1, blk: 0, p3m: 2 });
});
/* a rotation player of Ash City who has missed the last two games; a scorer of Elm City whose form jumped */
games.filter(x => x.home_team_id === 't1' || x.away_team_id === 't1').slice(0, 4).forEach(x => lines.push({ game_id: x.id, team_idx: x.home_team_id === 't1' ? 0 : 1, pid: 'p9', min: 1800000, pts: 11, reb: 4, ast: 2, stl: 0, blk: 0, p3m: 1 }));
const names = { p1: { name: 'Pat Archer' }, p9: { name: 'Mo Ash' }, p2: { name: 'Bo Birch' }, p3: { name: 'Cy Cedar' } };
const teamLines = [];
games.forEach(x => {
  const hw = x.home_score > x.away_score;
  const L = (w, s) => ({ efg: w ? 55 : 45, tovp: w ? 12 : 15, orebp: w ? 30 : 26, ftr: w ? 27 : 22, possessions: 72, fga: 64, fgm: w ? 31 : 27, fg3a: 22, fg3m: w ? 9 : 6, fta: 16, ftm: 12, oreb: 10, dreb: 26, tov: 11 });
  teamLines.push({ game_id: x.id, team_idx: 0, adv: L(hw) }); teamLines.push({ game_id: x.id, team_idx: 1, adv: L(!hw) });
});
const recaps = {
  g6: { headline: 'Ash City edge Cedar City 88–86', standfirst: 'It went to the last shot.', arc: 'tight', moment: { kind: 'gameWinner', name: 'Pat Archer' }, decisive: { key: 'efg', label: 'the shots that fell', pts: 7 } },
  g20: { headline: 'Cedar City stun Damson City 74–70', expect: 6, decisive: { key: 'tovp', label: 'turnovers', pts: 6 } },
  g16: { headline: 'Elm City hold off Fir City 81–79', arc: 'heldOn', decisive: { key: 'orebp', label: 'the offensive glass', pts: 5 } }
};
const base = { now: new Date(NOW), league: { id: 'L', slug: 'test', name: 'Test League', timezone: 'Europe/London' }, season: { id: 'S', name: '2026-27' },
  comp: { id: 'c1', name: 'The League' }, comps: [{ id: 'c1', kind: 'league', name: 'The League' }], table: tableOf(games), teams, games, fixtures, lines, names, recaps,
  teamLines, model: { n: 120, home: 1.2, b: { efg: 1.1, tovp: -0.9, orebp: 0.4, ftr: 0.2 } },
  players: [{ id: 'p1', gp: 6, mpg: 31, bpm: 6.1, ppg: 20, rpg: 5, apg: 3 }, { id: 'p2', gp: 6, mpg: 24, bpm: 4.8, ppg: 7, rpg: 8, apg: 4 },
            { id: 'p3', gp: 6, mpg: 22, bpm: 3.0, ppg: 9, rpg: 3, apg: 2 }, { id: 'p9', gp: 4, mpg: 30, bpm: 1, ppg: 11, rpg: 4, apg: 2 },
            ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12', 'q13', 'q14', 'q15', 'q16'].map((id, i) => ({ id, gp: 6, mpg: 25, bpm: -1 + i * 0.1, ppg: 12 + i, rpg: 3, apg: 2 }))],
  bio: { p2: { age: 20 } },
  news: { reports: { g6: { title: 'Ash City edge Cedar City 88–86', href: 'news/?l=test&a=report-g6', at: at(2.9) } },
    pieces: [{ kind: 'creator', id: 'c1', title: 'How Pat Archer became unstoppable', summary: '', at: at(1), href: 'creators/?l=test&o=desk&p=archer' },
             { kind: 'news', id: 'n1', title: 'Ash City keep winning', summary: 'A fifth straight for Ash City.', at: at(1.5), href: 'news/?i=n1' }] },
  significance: { g6: { points: 40, reasons: ['Overtime', 'Decided by 2 points', '36-point game: Pat Archer'] }, g20: { points: 18, reasons: ['Upset'] } },
  highlights: { g6: true },
  tallies: { f1: { home: 30, away: 20 } }
};
['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12', 'q13', 'q14', 'q15', 'q16'].forEach((id, i) => { names[id] = { name: 'Q Player ' + (i + 1) }; });

const builds = [];
const add = (label, input) => { const b = N.build(input); builds.push({ label, b }); return b; };
const b1 = add('base', base);
/* threading: the run grows, then it ends */
const g2 = games.concat([{ id: 'gx1', home_team_id: 't2', away_team_id: 't1', home_score: 70, away_score: 80, tipoff_at: new Date(NOW + 6 * 3600000).toISOString(), competition_id: 'c1' }]);
const b2 = add('a run that grew', Object.assign({}, base, { now: new Date(NOW + 9 * 3600000), games: g2, table: tableOf(g2), previous: b1 }));
const g3 = g2.concat([{ id: 'gx2', home_team_id: 't1', away_team_id: 't5', home_score: 60, away_score: 75, tipoff_at: new Date(NOW + 30 * 3600000).toISOString(), competition_id: 'c1' }]);
add('a run that ended', Object.assign({}, base, { now: new Date(NOW + 33 * 3600000), games: g3, table: tableOf(g3), previous: b2 }));
/* the play-offs: Game 1 played, Game 2 filed under the league */
{
  const po1 = { id: 'po1', home_team_id: 't1', away_team_id: 't4', home_score: 70, away_score: 75, tipoff_at: new Date(NOW - 6 * 3600000).toISOString(), competition_id: 'po' };
  const po2 = { id: 'po3', home_team_id: 't2', away_team_id: 't5', home_score: 90, away_score: 70, tipoff_at: new Date(NOW - 7 * 3600000).toISOString(), competition_id: 'po' };
  const po4 = { id: 'po4', home_team_id: 't5', away_team_id: 't2', home_score: 88, away_score: 80, tipoff_at: new Date(NOW - 30 * 3600000).toISOString(), competition_id: 'po' };
  const fx = [{ id: 'po2', home_team_id: 't1', away_team_id: 't4', tipoff_at: new Date(NOW + 2 * 86400000).toISOString(), competition_id: 'c1' },
              { id: 'po5', home_team_id: 't2', away_team_id: 't5', tipoff_at: new Date(NOW + 3 * 86400000).toISOString(), competition_id: 'po' }];
  add('the play-offs', Object.assign({}, base, { comps: [{ id: 'c1', kind: 'league' }, { id: 'po', kind: 'playoff', name: 'Play-offs' }], games: games.concat([po1, po2, po4]),
    fixtures: fx, rest: fx.map(f => ({ h: f.home_team_id, a: f.away_team_id, at: f.tipoff_at })), ties: [{ competition_id: 'po', home_team_id: 't2', away_team_id: 't5', legs: 5, decider: 'wins' }] }));
  /* a best of three nearly over, and a series a later round settled */
  const s1 = { id: 'po6', home_team_id: 't3', away_team_id: 't6', home_score: 80, away_score: 70, tipoff_at: new Date(NOW - 50 * 3600000).toISOString(), competition_id: 'po' };
  const s2 = { id: 'po7', home_team_id: 't6', away_team_id: 't3', home_score: 66, away_score: 77, tipoff_at: new Date(NOW - 26 * 3600000).toISOString(), competition_id: 'po' };
  const s3 = { id: 'po8', home_team_id: 't3', away_team_id: 't2', home_score: 70, away_score: 72, tipoff_at: new Date(NOW - 3 * 3600000).toISOString(), competition_id: 'po' };
  add('a series settled', Object.assign({}, base, { comps: [{ id: 'c1', kind: 'league' }, { id: 'po', kind: 'playoff' }], games: games.concat([s1, s2, s3]), fixtures: [] }));
  /* two legs: decided, and halfway */
  const leg1 = { id: 'q1', home_team_id: 't3', away_team_id: 't6', home_score: 80, away_score: 67, tipoff_at: at(9), competition_id: 'q' };
  const leg2 = { id: 'q2', home_team_id: 't6', away_team_id: 't3', home_score: 73, away_score: 61, tipoff_at: at(6), competition_id: 'q' };
  const leg3 = { id: 'q3', home_team_id: 't1', away_team_id: 't2', home_score: 90, away_score: 81, tipoff_at: at(2), competition_id: 'q' };
  add('two legs', Object.assign({}, base, { comps: [{ id: 'c1', kind: 'league' }, { id: 'q', kind: 'playoff', name: 'Qualifiers' }], games: games.concat([leg1, leg2, leg3]),
    fixtures: fixtures.concat([{ id: 'q4', home_team_id: 't2', away_team_id: 't1', tipoff_at: new Date(NOW + 4 * 86400000).toISOString(), competition_id: 'q' }]),
    ties: [{ competition_id: 'q', label: 'Qualifiers', home_team_id: 't3', away_team_id: 't6', winner_team_id: 't3', legs: 2, decider: 'aggregate' },
           { competition_id: 'q', label: 'Qualifiers', home_team_id: 't1', away_team_id: 't2', legs: 2, decider: 'aggregate' }] }));
}
/* the season's shape: early, and the run-in with a line */
add('early in a long season', Object.assign({}, base, { remaining: { t1: 34, t2: 34, t3: 32, t4: 33, t5: 34, t6: 33 }, lastRegularAt: at(-150) }));
add('the run-in', Object.assign({}, base, { comp: { id: 'c1', name: 'The League', qualifiers: 3 }, remaining: { t1: 1, t2: 1, t3: 0, t4: 1, t5: 1, t6: 1 }, lastRegularAt: at(-7), lastTotal: 8 }));
add('last season’s line', Object.assign({}, base, { lastLine: { n: 4, of: 6 } }));
/* a sweep, a split, a blowout, the schedule, the fans */
add('a sweep and a split', Object.assign({}, base, { games: games.concat([{ id: 'gs1', home_team_id: 't6', away_team_id: 't5', home_score: 70, away_score: 77, tipoff_at: at(1.5), competition_id: 'c1' },
  { id: 'gs2', home_team_id: 't3', away_team_id: 't4', home_score: 90, away_score: 66, tipoff_at: at(0.5), competition_id: 'c1' }]) }));
add('a team record', Object.assign({}, base, { games: games.concat([{ id: 'gb', home_team_id: 't2', away_team_id: 't6', home_score: 110, away_score: 60, tipoff_at: at(0.5), competition_id: 'c1' }]) }));
add('the schedule', Object.assign({}, base, { sos: { t1: { sosNet: -2, adjNet: 4 }, t2: { sosNet: 1, adjNet: 9 }, t3: { sosNet: 0, adjNet: -2 }, t4: { sosNet: 0.5, adjNet: -1 }, t5: { sosNet: 3, adjNet: 2 }, t6: { sosNet: 2, adjNet: -12 } } }));
add('the fans', Object.assign({}, base, { fanvote: { week: '2026-11-23', endsAt: at(1), ballots: 30, player: { id: 'p1', name: 'Pat Archer', team: 't1', share: 47, line: { bpm: 3.1, ppg: 22 } },
  others: [{ id: 'p2', name: 'Bo Birch', share: 30, line: { bpm: 6.0 } }] } }));
/* the closer (one close finish, and two), a suspension, the award races */
add('the closer', Object.assign({}, base, { recaps: Object.assign({}, recaps, { g6: Object.assign({}, recaps.g6, { clutch: { sec: 240, pts: [12, 9], players: [{ pid: 'p1', side: 0, pts: 9, name: 'Pat Archer' }] } }) }) }));
add('the closer, twice', Object.assign({}, base, { recaps: Object.assign({}, recaps, {
  g6: Object.assign({}, recaps.g6, { clutch: { sec: 240, pts: [12, 9], players: [{ pid: 'p1', side: 0, pts: 7, name: 'Pat Archer' }] } }),
  g20: Object.assign({}, recaps.g20, { clutch: { sec: 240, pts: [6, 11], players: [{ pid: 'p3', side: 1, pts: 6, name: 'Cy Cedar' }] } }),
  g16: Object.assign({}, recaps.g16, { clutch: { sec: 200, pts: [10, 4], players: [{ pid: 'p3', side: 0, pts: 5, name: 'Cy Cedar' }] } }) }) }));
add('a suspension', Object.assign({}, base, { bans: { p9: { games: 3, served: 2, endsOn: '2026-12-12' } } }));
add('the award races', Object.assign({}, base, { awards: [
  { code: 'mvp', player: 'p1', team: 't1', value: 18.0, detail: 'efficiency per game · minimum 13 games' },
  { code: 'scorer', player: 'p1', team: 't1', value: 20.1, detail: 'points per game · minimum 13 games' },
  { code: 'rebounder', player: 'p2', team: 't2', value: 8.0, detail: 'rebounds per game · minimum 13 games' },
  { code: 'playmaker', player: 'p2', team: 't2', value: 4.0, detail: 'assists per game · minimum 13 games' },
  { code: 'defender', player: 'p3', team: 't3', value: 2.3, detail: 'steals and blocks per game · minimum 13 games' },
  { code: 'marksman', player: 'p3', team: 't3', value: 51.1, detail: 'three-point percentage · minimum 13 games' },
  { code: 'best_offence', team: 't1', value: 89.8, detail: 'points scored per game' },
  { code: 'best_defence', team: 't2', value: 73.5, detail: 'points allowed per game' }] }));

/* ------------------------------------------------- what the page translates --- */
/* the strings newsdesk.js draws outside translate="no", by where they show */
const S = {};
const put = (group, s) => { if (s == null || s === '') return; const t = String(s).trim(); if (!t) return; (S[group] = S[group] || new Set()).add(t); };
const parts = s => String(s).split(/ · /);
builds.forEach(({ b }) => {
  b.stories.forEach(s => {
    put('heads', s.head); put('deks', s.dek); put('why', s.why); put('yes, but', s.counter); put('next', s.next); put('changes', s.change);
    (s.body || []).forEach(x => put('body', x)); (s.angles || []).forEach(x => put('angles', x)); put('kickers', s.kicker);
    (s.numbers || []).forEach(n => { put('labels', n.label); put('values', n.value); });
    (s.questions || []).forEach(x => { put('questions', x.to); put('questions', x.q); });
    (s.history || []).forEach(h => put('timeline', h.what));
  });
  const B = b.briefing;
  (B.results || []).forEach(r => { put('briefing', r.line); put('briefing', r.sub); });
  (B.watch || []).forEach(r => { put('briefing', r.line); put('briefing', r.sub); });
  (B.milestones || []).forEach(r => { put('briefing', r.line); put('briefing', r.sub); });
  const C = b.coverage;
  (C.bigPicture || []).forEach(p => put('big picture', p));
  (C.slate || []).forEach(x => {
    put('slate', x.angle); put('dates', x.day); (x.plan || []).forEach(p => put('slate', p));
    [x.home, x.away].forEach(t => { [t.rank ? ord(t.rank) : null, t.rec, t.streak].filter(Boolean).forEach(v => put('slate', v)); if (t.watch) put('slate', t.watch.line); });
    if (x.expect) put('slate', 'by about ' + Math.abs(x.expect.margin).toFixed(1));
    if (x.meetings) put('slate', 'meetings this season: ' + x.meetings.winsHome + '–' + x.meetings.winsAway);
    (x.threads || []).forEach(t => put('threads', t.line));
  });
  (C.recaps || []).forEach(r => { put('recaps', r.angle); (r.reasons || []).forEach(x => put('recaps', x)); });
  (C.players || []).forEach(p => { put('heads', p.head); put('deks', p.dek); put('angles', p.angle); });
  (C.teams || []).forEach(t => { put('clubs', t.identity); if (t.luck != null && Math.abs(t.luck) >= 1) put('clubs', (t.luck > 0 ? '+' : '') + t.luck + ' wins against what their points say');
    put('clubs', 'close games ' + t.close); if (t.next) put('clubs', 'next: ' + t.next); if (t.rank) put('clubs', ord(t.rank)); });
  (C.notes || []).forEach(n => { put('labels', n.head); put('notes', n.line); });
  (C.calendar || []).forEach(d => { put('dates', d.day); d.items.forEach(i => put('calendar', i.what)); });
  /* the award races: the label is the core dictionary's; the number and its measure are one text node, as the page draws them */
  (C.awards || []).forEach(a => { if (a.value != null) put('awards', String(a.value) + (a.detail ? ' · ' + a.detail : '')); });
});
function ord(n) { const v = Math.round(+n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); }

if (process.argv.includes('--list')) {
  Object.keys(S).forEach(k => { console.log('\n## ' + k + ' (' + S[k].size + ')'); [...S[k]].sort().forEach(x => console.log('  ' + x)); });
  process.exit(0);
}

/* a translation that still carries four English words in a row has left part of the sentence behind */
/* an English word no other language here uses, and three more words after it (the report test's rule; Spanish is in
   Latin letters too, so four words in a row alone is not English) */
const ENGLISH_RUN = /\b(?:the|and|of|to|in|for|with|was|were|their|they|points|game|games|season|league|won|lost|have|has|is|are|on|at|by)\b(?:\W+[a-z’']+){3}/i;
const NAMES = CLUBS.concat(['Pat Archer', 'Mo Ash', 'Bo Birch', 'Cy Cedar', 'Test League', 'The League', 'Qualifiers', 'Play-offs']).concat(Object.values(names).map(n => n.name))
  .sort((a, b) => b.length - a.length);
/* a string with its names taken out: what is left is what a language has to say */
const NAME_RE = new RegExp(NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
const bare = s => String(s).replace(NAME_RE, '');
function leftover(out) {
  let s = String(out);
  NAMES.forEach(n => { s = s.split(n).join(' '); });
  return ENGLISH_RUN.test(s) ? s : null;
}

const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const CODES = core.LANGS.filter(l => l.code !== 'en' && !l.hidden && (!only || l.code === only)).map(l => l.code);
console.log('the newsdesk, ' + builds.length + ' fixture builds, ' + Object.values(S).reduce((a, x) => a + x.size, 0) + ' strings');
for (const code of CODES) {
  console.log('\n' + code);
  const D = dictFor(code);
  Object.keys(S).forEach(group => {
    const misses = [];
    S[group].forEach(en => {
      /* as the engine does: the whole string first, then, when nothing takes it, part by part at " · ". A part with no letters
         (a record "5–1", a score) needs no words: left as it is, it reads the same in every language; a name alone is a name */
      const whole = core.translateText(D, en, ['newsdesk']);
      const out = whole != null ? [whole] : parts(en).map(p => { const t = core.translateText(D, p, ['newsdesk']); return t == null && !/[A-Za-z]/.test(bare(p)) ? p : t; });
      if (whole != null) { if (leftover(whole)) misses.push('English left: ' + en + '\n            -> ' + whole); return; }
      if (out.some((o, i) => o == null || (o === parts(en)[i] && /[a-z]{3,}/.test(o.replace(new RegExp(NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), ''))))) misses.push('untranslated: ' + en);
      else if (leftover(out.join(' · '))) misses.push('English left: ' + en + '\n            -> ' + out.join(' · '));
    });
    ok(code + ' ' + group + ': every string translates (' + S[group].size + ')', !misses.length,
      misses.length + ' not: ' + (only ? '\n          ' + misses.join('\n          ') : misses.slice(0, 3).join(' | ')));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
