/* ============================================================================
   THE HOUSE VOICE (epinoia/voice.js) AND THE EDITOR (epinoia/scrutiny.js).

     * the grammar: a club takes the plural ("Panathinaikos have"), a player the singular; a/an by sound; "1 point";
       possessives; a numeral never opens a sentence; British spelling; a doubled word or "in the league" said twice;
     * the planner: two clauses joined by what links them - a contrast is never "although" (that is a concession), a
       participle phrase only with the same subject (no dangling modifier), a relative clause between its commas, and the
       form varies from one sentence to the next;
     * references: a club or a player named in full first, then a role or a surname, then "they" / "she" only as the
       subject after a sentence about them alone; a section names everybody again;
     * the editor: each finding located and fixed - a role before the name in its section, a paragraph opening on the
       writer's pronoun, a record claimed for a game another comes before, a claim made twice by two statements (not one
       statement of two sentences), a section with nothing to say (and a piece held back when too little is left), the
       standfirst's count, a headline's full stop, model-speak - and its quality, which the newsroom multiplies into the
       salience that decides what is posted.

       node supabase/tests/voice.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const V = require(path.join(ROOT, 'epinoia', 'voice.js'));
const E = require(path.join(ROOT, 'epinoia', 'scrutiny.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500) : '')); } };

console.log('the grammar (jsRealB loaded: ' + V.grammar + ')');
{
  const pr = (t, clubs) => V.proof(t, { clubs: clubs || [] }).text;
  ok('a club in canned text takes the plural, as British English does', pr('Panathinaikos has won three straight', ['Panathinaikos']) === 'Panathinaikos have won three straight.');
  ok('...a player\'s pronoun the singular', pr('she have been the best player') === 'She has been the best player.');
  ok('a or an by the sound: an 8-point win, a one-sided game, an NBA scout, a European night', pr('a 8-point win, an one-sided game, a NBA scout, an European night') === 'An 8-point win, a one-sided game, an NBA scout, a European night.', pr('a 8-point win, an one-sided game, a NBA scout, an European night'));
  ok('one point is a point; 2.1 assists stay assists', pr('she had 1 points and 2.1 assists') === 'She had 1 point and 2.1 assists.', pr('she had 1 points and 2.1 assists'));
  ok('a numeral never opens a sentence', pr('12 games into the season, it holds') === 'Twelve games into the season, it holds.');
  ok('British spelling, a doubled word, "in the league" said twice', pr('the best defense in the league, the the best offense in the league') === 'The best defence in the league, the best offence.', pr('the best defense in the league, the the best offense in the league'));
  ok('a possessive of a name ending in s', pr('Panathinaikos’s night') === 'Panathinaikos’ night.');
  ok('a share said as a fan says it', V.frac(47.2) === 'nearly half' && V.frac(40.5) === 'two in five' && V.frac(52) === 'just over half');
}

console.log('\nthe planner');
if (V.grammar) {
  const FEN = V.club('Fenerbahce', { role: 'the visitors', id: 'f' }), PAN = V.club('Panathinaikos', { role: 'the hosts', id: 'p' });
  const forms = new Set(), texts = [];
  for (let i = 0; i < 12; i++) {
    const W = V.writer('plan' + i);
    W.options = null;
    const t = W.say('reason.rimWall', { O: FEN, D: PAN, rimFrac: 'two in five', dBest: true });
    texts.push(t);
    forms.add((W.state().conj || [])[0] || 'two');
  }
  ok('a clash said in more than one form across pieces', forms.size >= 2, [...forms]);
  ok('...never "although" (a contrast is not a concession)', texts.every(t => !/^Although\b/.test(t)), texts);
  ok('...with the club plural throughout ("Fenerbahce attack", never "attacks")', texts.every(t => !/Fenerbahce (attacks|takes|goes)\b/.test(t)), texts);
  const W2 = V.writer('rel');
  const VK = V.club('Valley Kings', { id: 'vk' }), HT = V.club('Hilltop', { id: 'ht' });
  const B = { cl: V.cl, rel: V.rel, part: V.part };
  W2.say('x', {});
  const t1 = (() => { const w = V.writer('r1'); return w.say('game.lean', { band: 'tossup' }); })();
  ok('a canned option still said without the grammar\'s plan', !!t1);
  const BANK = V.BANK;
  BANK['test.rel'] = [{ say: [(c, b) => b.rel(b.cl(c.T, 'win', 'five straight', { perf: true }), b.cl(c.T, 'come', 'to Hilltop in form'))] }];
  BANK['test.part'] = [{ say: [(c, b) => b.part(b.cl(c.T, 'win', 'five straight', { perf: true }), b.cl(c.T, 'arrive', 'in form'))] }];
  BANK['test.dangle'] = [{ say: [(c, b) => b.part(b.cl(c.T, 'win', 'five straight', { perf: true }), b.cl(c.U, 'wait', 'for them'))] }];
  const w3 = V.writer('rp');
  const r = w3.say('test.rel', { T: VK });
  ok('a relative clause between its commas: "Valley Kings, who have won five straight, come..."', /^Valley Kings, who have won five straight, come to Hilltop in form\.$/.test(r), r);
  const p = V.writer('pp').say('test.part', { T: VK });
  ok('a participle phrase with its own subject: "Having won five straight, Valley Kings arrive in form."', p === 'Having won five straight, Valley Kings arrive in form.', p);
  ok('...and none with another subject (no dangling modifier)', V.writer('dd').say('test.dangle', { T: VK, U: HT }) === null);
  ['test.rel', 'test.part', 'test.dangle'].forEach(k => { delete BANK[k]; });
} else ok('the planner needs jsRealB (tools/vendor/jsrealb/jsRealB.js)', false);

console.log('\nreferences');
{
  const ADA = V.person('Ada Northsideson', { g: 'f', id: 'ada' }), NS = V.club('Northside', { id: 'ns' });
  const W = V.writer('ref');
  const P = { P: ADA, T: NS, he: 'she', his: 'her', him: 'her', He: 'She', His: 'Her' };
  const a = W.say('slump.lede', Object.assign({ pts: '6 points', fg: '2-of-15', result: '78–76 defeat at Westgate', day: 'Thursday 1 October' }, P));
  const b = W.say('slump.onoff', Object.assign({ better: true }, P));
  ok('named in full the first time', /^(It was another quiet night for Ada Northsideson|Ada Northsideson had)/.test(a), a);
  ok('...by surname after that, never by first name', /Northsideson/.test(b) && !/\bAda\b/.test(b), b);
  W.section('next');
  const c = W.say('slump.onoff', Object.assign({ better: true }, P));
  ok('a new section names her in full again', /Ada Northsideson/.test(c), c);
  const H = W.say('slump.head', Object.assign({ cold: 'has gone cold' }, P));
  ok('a headline is said without a full stop', H && !/\.$/.test(H), H);
}

console.log('\nthe editor');
{
  const PAN = { id: 'p', ent: 'club', name: 'Panathinaikos', role: 'the hosts' }, FEN = { id: 'f', ent: 'club', name: 'Fenerbahce', role: 'the visitors' };
  const log = [
    { slot: 'game.stakes', text: 'Both still unbeaten. Only one of them will be by the final buzzer.', section: 2, ents: [PAN, FEN], claims: [{ k: 'record', ids: ['p', 'f'] }] },
    { slot: 'reason.rim', text: 'The visitors live at the rim.', section: 1, ents: [FEN], subj: 'f' },
    { slot: 'reason.three', text: 'Fenerbahce shoot it from everywhere, and the hosts give up open looks.', section: 1, ents: [FEN, PAN] },
    { slot: 'game.lean', text: 'Too close to call.', section: 3, ents: [] }
  ];
  const piece = { kind: 'watch', head: 'Big week.', heads: ['Big week.', 'The games that matter'], dek: 'The three games worth your time this week.',
    body: ['Panathinaikos v Fenerbahce is the one to circle.',
      { h: 'Panathinaikos v Olympiacos · Thursday' }, 'The visitors live at the rim. Fenerbahce shoot it from everywhere, and the hosts give up open looks.',
      { h: 'Panathinaikos v Fenerbahce · Tuesday' }, 'Both still unbeaten. Only one of them will be by the final buzzer.',
      { h: 'Valencia v Real · Sunday' }, 'Too close to call.'] };
  const q = E.scrutinise(piece, { log, clubs: ['Panathinaikos', 'Fenerbahce'], schedule: { p: 'g1', f: 'g2' }, sectionGame: { 1: 'g1', 2: 'g2', 3: 'g3' } });
  const R = q.report, by = rule => R.fixes.filter(f => f.rule === rule);
  ok('a role before the name in its section: named, at its place', by('reference').some(f => /^p2\.s1/.test(f.at) && /^Fenerbahce live at the rim/.test(f.after)), R.fixes);
  ok('a record claimed for a game another comes before: it goes (illogical, located)', by('time').some(f => f.kind === 'illogical' && /^p3/.test(f.at)), R.fixes);
  ok('a section with nothing to say beyond a lean goes', by('thin').length >= 1, R.fixes);
  ok('...and with fewer than two sections left the piece is held back', !R.ok && R.held.some(h => h.rule === 'thin'), R.held);
  const two = E.scrutinise({ kind: 'watch', head: 'x', dek: 'The three games worth your time this week.', body: ['A lede.', { h: 'A v B' }, 'Fenerbahce shoot it from everywhere, and the hosts give up open looks.',
    { h: 'C v D' }, 'Valencia crash the offensive glass, and Real struggle to finish possessions.', { h: 'E v F' }, 'Too close to call.'] },
    { log: [Object.assign({}, log[2], { section: 1 }), { slot: 'reason.glass', text: 'Valencia crash the offensive glass, and Real struggle to finish possessions.', section: 2, ents: [] }, log[3]], clubs: ['Panathinaikos', 'Fenerbahce'], schedule: {}, sectionGame: {} });
  ok('the standfirst\'s count follows the piece ("The three games" with two left)', /^The two games/.test(two.piece.dek), [two.piece.dek, two.report.fixes.map(f => f.rule)]);
  ok('a headline loses its full stop', q.piece.heads.every(h => !/\.$/.test(h)), q.piece.heads);
  ok('quality and substance reported for the salience that decides what is posted', R.quality >= 0.4 && R.quality <= 1 && typeof R.substance === 'number', [R.quality, R.substance]);
  const same = E.scrutinise({ kind: 'watch', head: 'x', dek: 'y', body: ['Both still unbeaten. Only one of them will be by the final buzzer.', 'b c d.', 'e f g.'] },
    { log: [log[0]], clubs: ['Panathinaikos', 'Fenerbahce'], schedule: {}, sectionGame: {} });
  ok('one statement of two sentences is not a claim made twice', !same.report.fixes.some(f => f.rule === 'claim-twice') && /Only one of them/.test(same.piece.body[0]), same.report.fixes);
  const ms = E.scrutinise({ kind: 'mvp', head: 'x', dek: 'y', body: ['The numbers say it turns on shooting.', 'They score 1.1 points a chance in transition.', 'c d e.'] }, { log: [], clubs: [] });
  ok('model-speak: a sentence of it goes, a phrase of it is said as a writer would', !/numbers say|a chance/.test(JSON.stringify(ms.piece.body)) && ms.report.fixes.some(f => f.rule === 'model-speak'), ms.piece.body);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
