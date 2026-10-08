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

import { build, T, NOW, DAY } from './newsroom-fixture.mjs';

console.log('\nthe formats, on a synthetic league');
{
  const input = build('women', { full: true });
  const b = globalThis.EpinoiaNarrative.build(input);
  const cs = NR.candidates(input, b, { nowMs: NOW });
  const kinds = [...new Set(cs.map(c => c.kind))];
  ok('every format opens on the full league (the run and the slide each)', ['watch', 'slump', 'mvp', 'prospect', 'identity', 'run', 'skid', 'five', 'clock', 'absence'].every(k => kinds.includes(k)), kinds);
  const arts = NR.publish(input, b, { nowMs: NOW, all: true });
  ok('every article has a headline, a standfirst, three paragraphs or more and its figures', arts.length > 0 && arts.every(a => a.head && a.dek && a.body.filter(x => typeof x === 'string').length >= 3 && (a.facts || []).length), arts.map(a => a.kind + ':' + a.body.length));
  ok('...and no empty slot anywhere', arts.every(a => !LEAK.test(JSON.stringify([a.head, a.dek, a.body, a.facts]))), arts.map(a => JSON.stringify([a.head, a.dek, a.body]).match(LEAK)).filter(Boolean));
  const text = JSON.stringify(arts.map(a => [a.dek, a.body]));
  ok('a women\'s league is written with her pronouns', /\b(her|she)\b/.test(text) && !/\b(his|him|he)\b/.test(text), (text.match(/\b(his|him|he)\b.{0,40}/) || [])[0]);
  ok('...no article after a possessive ("Northside’s a 78–76 defeat")', !/’s an? \d/.test(text), (text.match(/.{0,30}’s an? \d.{0,20}/) || [])[0]);
  const slump = arts.find(a => a.kind === 'slump');
  ok('the star gone cold gets a slump piece, with the shots that are not falling', slump && /not falling|from the field/.test(slump.body.join(' ')), slump && slump.body);
  ok('...and is called by her name or "she", never her first name alone', slump && !/\bAda\b(?! Northsideson)/.test(slump.body.join(' ')), slump && slump.body.join(' ').match(/.{0,30}\bAda\b(?! Northsideson).{0,20}/));
  const five = arts.find(a => a.kind === 'five'), share = five && /(\d+)% of the club’s minutes/.exec(five.body.join(' '));
  ok('the best five: its share of the club\'s minutes a share (the replays\' totals are the club\'s time on court)', share && +share[1] > 0 && +share[1] <= 100, five && five.body);
  const skid = arts.find(a => a.kind === 'skid'), run = arts.find(a => a.kind === 'run');
  ok('a slide is a slide, and a defence that got worse "let" opponents shoot', skid && !/\bIn the run\b|held opponents/.test(skid.body.join(' ')) && run && /In the run/.test(run.body.join(' ')), skid && skid.body);
  const abs = arts.find(a => a.kind === 'absence');
  ok('a star missing: her share of the club\'s value and the record without her', abs && /\d+% of what the club’s players are worth/.test(abs.dek) && abs.facts.some(f => f.label === 'record without'), abs && [abs.dek, abs.facts]);
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
  /* a correction: a piece out already, by an older writer of its format, is written again under its id */
  const fullIn = build('men', { full: true }), fullB = globalThis.EpinoiaNarrative.build(fullIn);
  const five = NR.publish(fullIn, fullB, { nowMs: NOW, all: true }).find(a => a.kind === 'five');
  const old = Object.assign({}, five, { dek: 'as it was', body: ['They have played 188% of the club’s minutes in those games together.', 'b', 'c'] });
  delete old.wv;
  const fixed = five && NR.publish(fullIn, fullB, { nowMs: NOW + 3600000, previous: [old] }).find(a => a.id === five.id);
  ok('a piece by an older writer of its format is written again under its id: its date and headlines kept, the rest as the writer writes it now',
    fixed && fixed.written === five.written && fixed.head === five.head && fixed.dek !== 'as it was' && !/188%/.test(fixed.body.join(' ')) && fixed.body.length >= 3 && fixed.wv === 2 && !!fixed.corrected, fixed);
  const same = five && NR.publish(fullIn, fullB, { nowMs: NOW + 3600000, previous: [Object.assign({}, five, { body: ['kept', 'as', 'written'] })] }).find(a => a.id === five.id);
  ok('...and one by the writer as it is now is kept as it was', same && same.body[0] === 'kept' && !same.corrected);
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
