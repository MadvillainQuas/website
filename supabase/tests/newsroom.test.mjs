/* ============================================================================
   THE NEWSROOM (epinoia/newsroom.js) AND WHAT IT LEARNS FROM (feedrank.js's click-through model).

     * digest / learn: a fed article teaches phrasing, filed by what it is for (a rout's verb by the score's margin, a
       scoring verb, a cold and a hot hand, a turning connective, a question headline's shape), never a name or a figure;
     * the formats, on a synthetic league: each writes whole articles - a headline, a standfirst, three paragraphs or
       more, the figures - with no empty slot, in a women's league with her pronouns;
     * salience: nothing under SALIENCE is written, two new an hour at most, a piece once written is kept as it was,
       one a fortnight on the same subject, and a format readers open more is weighed up;
     * the headline test: a piece keeps up to three headlines, ordered by the model when there is one, and the counts
       decide it once it has been shown enough (a headline barely shown cannot win);
     * the game to watch: reasons said as a preview writer would (a clash of styles, the mismatch, the matchup at a
       spot), a rivalry first when the two clubs are rivals;
     * the click-through model: the same features in the build and on the page, a word readers open learns a positive
       weight, salience held between its bounds, a new story given room to be tried.

       node supabase/tests/newsroom.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.EpinoiaNarrative = require(path.join(ROOT, 'epinoia', 'narrative.js'));
globalThis.EpinoiaFeedRank = require(path.join(ROOT, 'epinoia', 'feedrank.js'));
const NR = require(path.join(ROOT, 'epinoia', 'newsroom.js'));
const FR = globalThis.EpinoiaFeedRank;
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500) : '')); } };
const LEAK = /\b(?:undefined|NaN|Infinity|null)\b|\[object |\{[a-zA-Z]+\}/;

console.log('digest and learn');
{
  const art = `Northside routed Harbour City 101-74 on Saturday night.
Still, Harbour City edged Valley Kings 80-78 on Wednesday, and Riverside beat Northside 88-80 in the cup.
Meanwhile, Jordan Price poured in 31 points and Sam Lee finished with 22 points.
Price has hit a rough patch since the break, but Lee is red-hot.
In fact, the league has never looked so open.`;
  const d = NR.digest(art, 'Is Jordan Price the real deal?');
  ok('a rout is filed by its margin (27: a big win), a narrow win by its (2), the rest as a win', (d.lex.winBig || []).includes('routed') && (d.lex.winClose || []).includes('edged') && (d.lex.win || []).includes('beat'), d.lex);
  ok('...the scoring verbs before "N points"', (d.lex.score || []).includes('poured in') && (d.lex.score || []).includes('finished with'), d.lex.score);
  ok('...a cold hand and a hot one, from the auxiliary', (d.lex.cold || []).some(p => /rough patch/.test(p)) && (d.lex.hot || []).some(p => /red-hot/.test(p)), [d.lex.cold, d.lex.hot]);
  ok('...the connectives, turning and adding', (d.lex.turn || []).includes('still,') && (d.lex.add || []).includes('meanwhile,'), [d.lex.turn, d.lex.add]);
  ok('...a question headline, its subject made {X}, by theme', d.heads.length === 1 && d.heads[0].shape === 'Is {X} the real deal?' && d.heads[0].theme === 'prospect', d.heads);
  ok('...and never a name or a figure', !JSON.stringify(d.lex).match(/Price|Northside|Harbour|\d/), d.lex);
  const st = NR.learn([d, NR.digest('Westgate routed Eastfield 99-70. Northside routed Rivers 90-71.', '')]);
  ok('learn: the digests merged, each phrase with the articles it came from, most used first', st.articles === 2 && st.lex.winBig[0].p === 'routed' && st.lex.winBig[0].n === 2, st.lex.winBig);
}

/* ------------------------------------------------------------ a synthetic league --- */
const DAY = 86400000, NOW = Date.parse('2026-10-08T12:00:00Z');
const uuid = (n, k) => (k + '0000000-0000-4000-8000-' + String(n).padStart(12, '0')).slice(-36).replace(/^.{8}/, (k + '0000000').slice(0, 8));
const T = Array.from({ length: 8 }, (_, i) => ({ id: uuid(i + 1, 'a'), name: ['Northside', 'Harbour City', 'Valley Kings', 'Riverside', 'Westgate', 'Eastfield', 'Hilltop', 'Lakeshore'][i] }));
const teams = Object.fromEntries(T.map(t => [t.id, { name: t.name, slug: t.name.toLowerCase().replace(/\s+/g, '-') }]));
function build(gender) {
  const games = [], lines = [], players = [], names = {};
  /* three players a club: the first the star */
  T.forEach((t, i) => [0, 1, 2].forEach(k => { const id = uuid(i * 10 + k + 1, 'b'); names[id] = { name: ['Ada', 'Bo', 'Cy'][k] + ' ' + t.name.split(' ')[0] + 'son', slug: 'p' + i + k }; }));
  let n = 0;
  for (let r = 0; r < 12; r++) T.forEach((h, i) => {
    if (i % 2) return;
    const a = T[(i + 1 + r) % 8];
    if (a.id === h.id) return;
    const at = new Date(NOW - (40 - r * 3) * DAY).toISOString(), hs = 70 + ((i * 7 + r * 5) % 25), as = 68 + ((i * 3 + r * 11) % 25);
    const id = uuid(++n, 'c');
    games.push({ id, home_team_id: h.id, away_team_id: a.id, home_score: hs, away_score: as, tipoff_at: at, competition_id: 'lg' });
    [h, a].forEach((t, side) => [0, 1, 2].forEach(k => {
      const pi = T.indexOf(t), pid = uuid(pi * 10 + k + 1, 'b');
      /* Northside's star goes cold over the last four */
      const cold = pi === 0 && k === 0 && r >= 8;
      lines.push({ game_id: id, team_idx: side, pid, min: (30 - k * 5) * 60000, pts: cold ? 6 : 22 - k * 6, reb: 6, ast: 4, stl: 1, blk: 0, p3m: 2, fgm: cold ? 2 : 8, fga: 15, p3a: 5, ftm: 2, fta: 3, tov: 2 });
    }));
  });
  T.forEach((t, i) => [0, 1, 2].forEach(k => { const id = uuid(i * 10 + k + 1, 'b');
    players.push({ id, _teamId: t.id, gp: 12, min: (30 - k * 5) * 12, mpg: 30 - k * 5, ppg: 22 - k * 6, rpg: 6, apg: 4, bpm: (k === 0 ? 6 - i * 0.6 : 1 - k), vorp: 1.5 - k * 0.5, ts: 58 - k * 2, usg: 26 - k * 4,
      bpm_pos: [1.5, 2.8, 4.4][k], on_poss: 500, on_net: 8 - k * 4 - i * 0.5, off_net: -2, diff_net: 10 - k * 4 - i * 0.5, rim_rate: 30, mid_rate: 25, p3_rate: 45 }); }));
  const teamRows = T.map((t, i) => ({ id: t.id, gp: 12, pace: 68 + i * 1.5, rim_share: 30 + i * 2, p3_share: 45 - i * 2, ff_oreb: 25 + i, dff_oreb: 30 - i * 0.5, ff_tov: 12 + i * 0.5, dff_tov: 13 + (7 - i) * 0.4,
    evd_all_rim_pct: 55 + i * 1.5, evd_all_p3_pct: 33 + (i % 3), ev_transition_freq: 12 + i, ev_transition_ppp: 1.0 + i * 0.03, ev_transition_ch_pg: 12, evd_transition_ppp: 1.0 + (7 - i) * 0.03,
    ev_half_ppp: 0.85 + i * 0.01, ev_half_ch_pg: 60, evd_half_ppp: 0.85 + (7 - i) * 0.012, evd_half_ch_pg: 60, ev_offTo_ppg: 14, ev_offTo_ppp: 1.0 }));
  const fixtures = [{ id: 'fx1', home_team_id: T[0].id, away_team_id: T[1].id, tipoff_at: new Date(NOW + 2 * DAY).toISOString() },
                    { id: 'fx2', home_team_id: T[2].id, away_team_id: T[3].id, tipoff_at: new Date(NOW + 3 * DAY).toISOString() },
                    { id: 'fx3', home_team_id: T[4].id, away_team_id: T[5].id, tipoff_at: new Date(NOW + 4 * DAY).toISOString() }];
  const table = { comp: { id: 'lg' }, rows: T.map((t, i) => ({ team_id: t.id, rank: i + 1, gp: 12, w: 10 - i, l: 2 + i })) };
  return { now: new Date(NOW), league: { id: uuid(1, 'e'), slug: 'test-league', name: 'Test League', gender }, season: { id: 's', name: '2026-27' }, comp: { id: 'lg' },
    comps: [{ id: 'lg', kind: 'league' }], table, teams, games, fixtures, lines, teamLines: [], names, players, teamRows, recaps: {}, model: null, tallies: {}, previous: null,
    bio: Object.fromEntries(players.map((p, j) => [p.id, { age: j === 1 ? 19 : 27 }])), rivals: [[T[0].id, T[1].id]] };
}

console.log('\nthe formats, on a synthetic league');
{
  const input = build('women');
  const b = globalThis.EpinoiaNarrative.build(input);
  const cs = NR.candidates(input, b, { nowMs: NOW });
  const kinds = [...new Set(cs.map(c => c.kind))];
  ok('the league offers candidates of several kinds', kinds.length >= 3, kinds);
  const arts = NR.publish(input, b, { nowMs: NOW, all: true });
  ok('every article has a headline, a standfirst, three paragraphs or more and its figures', arts.length > 0 && arts.every(a => a.head && a.dek && a.body.filter(x => typeof x === 'string').length >= 3 && (a.facts || []).length), arts.map(a => a.kind + ':' + a.body.length));
  ok('...and no empty slot anywhere', arts.every(a => !LEAK.test(JSON.stringify([a.head, a.dek, a.body, a.facts]))), arts.map(a => JSON.stringify([a.head, a.dek, a.body]).match(LEAK)).filter(Boolean));
  const text = JSON.stringify(arts.map(a => [a.dek, a.body]));
  ok('a women\'s league is written with her pronouns', /\b(her|she)\b/.test(text) && !/\b(his|him|he)\b/.test(text), (text.match(/\b(his|him|he)\b.{0,40}/) || [])[0]);
  const slump = arts.find(a => a.kind === 'slump');
  ok('the star gone cold gets a slump piece, with the shots that are not falling', slump && /not falling|from the field/.test(slump.body.join(' ')), slump && slump.body);
  const card = NR.gameCard(input, b, { nowMs: NOW });
  ok('the game to watch: the slate\'s highest stakes and its clubs (its lean only where the season\'s numbers expect one)', card && card.home && card.away && card.game === 'fx1' && (!card.lean || (card.lean.chance >= 50 && card.lean.chance <= 100)), card);
  ok('...a rivalry leads its reasons when the two are rivals', card && card.rival === true && card.reasons[0] && card.reasons[0].title === 'The rivalry', card && card.reasons.map(r => r.title));
  ok('...every other reason said with both sides\' figures', card && card.reasons.slice(1).every(r => r.off && r.def && r.text), card && card.reasons);
  const L = NR.__x.league(input, b, { nowMs: NOW });
  const rs = NR.__x.reasons(L, T[0].id, T[7].id, 'x');
  ok('a reason is a sentence with a why, not a figure beside a figure', rs.length && rs.every(r => /[.?]$/.test(r.text) && r.title), rs.map(r => r.title + ': ' + r.text));
  ok('...and "nobody" is said only of the league\'s last', rs.filter(r => /^Nobody has been easier/.test(r.text)).every(r => r.b && r.b.rank === r.b.of), rs.map(r => r.text));
}

console.log('\nsalience, persistence and the headline test');
{
  const input = build('men');
  const b = globalThis.EpinoiaNarrative.build(input);
  const first = NR.publish(input, b, { nowMs: NOW });
  ok('nothing under the salience bar is written, and two at most an hour', first.length <= 2 && first.every(a => a.salience >= NR.SALIENCE), first.map(a => a.salience));
  const later = NR.publish(input, b, { nowMs: NOW + 3600000, previous: first });
  ok('a piece once written is kept as it was', first.every(a => later.some(x => x.id === a.id && x.head === a.head && JSON.stringify(x.body) === JSON.stringify(a.body))));
  ok('...and the same subject waits a fortnight for its next piece of the same kind', later.filter(a => first.some(f => f.kind === a.kind && f.subject === a.subject)).length === first.length);
  const cs = NR.candidates(input, b, { nowMs: NOW });
  const low = cs.filter(c => c.salience < NR.SALIENCE && c.salience * 1.3 >= NR.SALIENCE)[0];
  if (low) ok('a format readers open more is weighed up past the bar, and ahead of those they open less', NR.publish(input, b, { nowMs: NOW, kindW: Object.fromEntries(cs.map(c => [c.kind, c.kind === low.kind ? 1.3 : 0.5])) }).some(a => a.kind === low.kind));
  else ok('a format readers open more is weighed up past the bar (no candidate near the bar here)', true);
  const all = NR.publish(input, b, { nowMs: NOW, all: true });
  const t = all.find(a => (a.heads || []).length > 1);
  ok('a piece keeps up to three headlines to test, its headline the first', t && t.heads.length <= 3 && t.head === t.heads[0], t && t.heads);
  if (t) {
    const decided = NR.publish(input, b, { nowMs: NOW + 3600000, previous: [t], ctr: { [t.id]: [{ variant: 0, shown: 200, opened: 4 }, { variant: 1, shown: 180, opened: 12 }] } }).find(a => a.id === t.id);
    ok('the counts decide the test once it has been shown enough: the better headline, for good', decided.head === t.heads[1] && decided.heads.length === 1 && decided.locked.v === 1, decided);
    const early = NR.publish(input, b, { nowMs: NOW + 3600000, previous: [t], ctr: { [t.id]: [{ variant: 0, shown: 50, opened: 1 }, { variant: 1, shown: 40, opened: 5 }] } }).find(a => a.id === t.id);
    ok('...not before', early.heads.length === t.heads.length && !early.locked);
  }
  const fake = { v: 1, base: 0.05, bias: Math.log(0.05 / 0.95), w: { 's:question': 1.5 } };
  const ordered = NR.publish(input, b, { nowMs: NOW, all: true, model: fake });
  const q = ordered.find(a => (a.heads || []).some(h => /\?$/.test(h)));
  ok('with a model, the headline it expects to be opened most goes first', !q || /\?$/.test(q.head), q && q.heads);
}

console.log('\nthe click-through model');
{
  const row = { kind: 'league', id: 'x', title: 'Is Ada Northson the best player in the league?', league_slug: 'test-league' };
  const f = FR.ctrFeatures(row);
  ok('the features: words, pairs, the shape, the kind and the league', f.includes('w:northson') && f.includes('b:best_player') && f.includes('s:question') && f.includes('k:league') && f.includes('l:test-league'), f);
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ shown: 100, opened: i % 2 ? 9 : 3, title: (i % 2 ? 'Collapse at ' : 'Win for ') + ['Northside', 'Westgate', 'Hilltop'][i % 3] + ' ' + i, kind: 'league', league_slug: 'test-league' });
  const m = FR.ctrFit(rows);
  ok('fitted on the counts: a word readers open more gets a positive weight, one they open less a negative', m && m.w['w:collapse'] > 0 && m.w['w:win'] < 0, m && { collapse: m.w['w:collapse'], win: m.w['w:win'] });
  ok('...its prediction follows', m && FR.ctrPredict(m, { kind: 'league', title: 'Collapse at Lakeshore' }) > FR.ctrPredict(m, { kind: 'league', title: 'Win for Lakeshore' }));
  ok('...and nothing is fitted on too little', FR.ctrFit(rows.slice(0, 5)) === null);
  const S = { model: m, items: {} };
  const sNew = FR.salienceOf({ row: { kind: 'league', id: 'n1', title: 'Collapse at Riverside' } }, S);
  const sOld = FR.salienceOf({ row: { kind: 'league', id: 'n2', title: 'Collapse at Riverside' } }, Object.assign({}, S, { items: { 'league:n2': [400, 10] } }));
  ok('salience is held between its bounds', [sNew, sOld].every(v => v >= FR.W.SAL_MIN && v <= FR.W.SAL_MAX), [sNew, sOld]);
  ok('...a story with its own poor record sinks below the same headline new (which is given room to be tried)', sOld < sNew, [sNew, sOld]);
  ok('no model, no salience: every story stands at 1', FR.salienceOf({ row }, null) === 1);
  ok('an unread partner piece still leads: its boost is above the most any other story can score', FR.W.PARTNER_BOOST > FR.scoreMax());
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
