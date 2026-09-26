// The language model of the match report (epinoia/game/language.js): every rule of the English it is written in, held to its
// exceptions; the critic that scores a text and the reviser that improves it until it is good enough; and the report itself,
// held to the rules end to end on invented games.
//
//   node supabase/tests/language.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = path.join(ROOT, 'epinoia', 'game');
const L = require(path.join(G, 'language.js'));
globalThis.EpinoiaLanguage = L;
globalThis.EpinoiaStory = require(path.join(G, 'story.js'));
const Report = require(path.join(G, 'report.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 200))); } };
const eq = (what, got, want) => ok(what, got === want, got);

console.log('-- a and an follow the sound');
eq('an hour', L.an('hour'), 'an'); eq('an honest man', L.an('honest'), 'an');
eq('a university', L.an('university'), 'a'); eq('a one-point game', L.an('one-point'), 'a'); eq('a European side', L.an('European'), 'a');
eq('an eighth', L.an('eighth'), 'an'); eq('an umbrella', L.an('umbrella'), 'an'); eq('a unit', L.an('unit'), 'a');
eq('an 8-0 run', L.an('8–0'), 'an'); eq('an 11-point lead', L.an('11-point'), 'an'); eq('an 18-point lead', L.an('18'), 'an');
eq('an 80-point night', L.an('80'), 'an'); eq('an 800 ...', L.an('800'), 'an');
eq('a 12-0 run', L.an('12–0'), 'a'); eq('a 110-point night', L.an('110'), 'a'); eq('a 1-0 start', L.an('1–0'), 'a'); eq('a 7-0 run', L.an('7–0'), 'a');
eq('an NBA side', L.an('NBA'), 'an'); eq('an MVP', L.an('MVP'), 'an'); eq('a BCB game', L.an('BCB'), 'a'); eq('a FIBA game', L.an('FIBA'), 'a');
eq('a run', L.an('run'), 'a'); eq('an elite side', L.an('elite'), 'an');

console.log('-- plurals and counted nouns');
eq('possession', L.plural('possession'), 'possessions'); eq('foul', L.plural('foul'), 'fouls'); eq('miss', L.plural('miss'), 'misses');
eq('buzzer-beater', L.plural('buzzer-beater'), 'buzzer-beaters'); eq('assist', L.plural('assist'), 'assists'); eq('man', L.plural('man'), 'men');
eq('supply', L.plural('supply'), 'supplies'); eq('day', L.plural('day'), 'days'); eq('half', L.plural('half'), 'halves'); eq('pace has no plural', L.plural('pace'), 'pace');
eq('1 point', L.count(1, 'point'), '1 point'); eq('0 points', L.count(0, 'point'), '0 points'); eq('1.5 points', L.count(1.5, 'point'), '1.5 points');
eq('one point in words', L.count(1, 'point', { words: true }), 'one point'); eq('no points in words', L.count(0, 'point', { words: true }), 'no points');
eq('fewer for what is counted', L.fewer('turnovers'), 'fewer'); eq('less for what is measured', L.fewer('time'), 'less');

console.log('-- possessives and agreement');
eq('Flyers’', L.possessive('Bristol Flyers'), 'Bristol Flyers’'); eq('James’', L.possessive('James'), 'James’');
eq('Jordan’s', L.possessive('Jordan'), 'Jordan’s'); eq('the winners’', L.possessive('the winners'), 'the winners’');
eq('a wrapped name keeps its tags', L.possessive('<b>Eagles</b>'), '<b>Eagles</b>’'); eq('already possessive is left alone', L.possessive('Flyers’'), 'Flyers’');
ok('a team is plural (Hyeres-Toulon were)', L.isPlural('Hyères-Toulon') && L.isPlural('the winners') && L.isPlural('They'));
ok('a person and "it" are singular', !L.isPlural('nobody') && !L.isPlural('it') && !L.isPlural('the game'));
eq('be, past, plural', L.be(true, 'past'), 'were'); eq('be, past, singular', L.be(false, 'past'), 'was'); eq('be, present, singular', L.be(false, 'present'), 'is');
eq('win / won', L.verb('win', { tense: 'past' }), 'won'); eq('lose / lost', L.verb('lose', { tense: 'past' }), 'lost'); eq('score, singular, present', L.verb('score', { plural: false, tense: 'present' }), 'scores');
eq('shoot / shot', L.verb('shoot', { tense: 'past' }), 'shot'); eq('carry / carried', L.verb('carry', { tense: 'past' }), 'carried'); eq('drop / dropped', L.verb('drop', { tense: 'past' }), 'dropped');
eq('have, perfect, singular', L.verb('take', { plural: false, tense: 'perfect' }), 'has taken'); eq('trim / trimming', L.verb('trim', { tense: 'ing' }), 'trimming'); eq('make / making', L.verb('make', { tense: 'ing' }), 'making');
eq('pass, singular, present', L.verb('pass', { plural: false, tense: 'present' }), 'passes');

console.log('-- lists, numbers, ordinals');
eq('two items', L.list(['a', 'b']), 'a and b'); eq('three items, no comma before "and"', L.list(['a', 'b', 'c']), 'a, b and c'); eq('one item', L.list(['a']), 'a'); eq('none', L.list([]), '');
eq('an item with a comma makes it a semicolon list', L.list(['a, x', 'b', 'c']), 'a, x; b; and c');
eq('zero is "no"', L.spell(0), 'no'); eq('twelve', L.spell(12), 'twelve'); eq('thirteen stays digits', L.spell(13), '13');
ok('one style for a set of figures', L.spellSet([3, 9]).join() === 'three,nine' && L.spellSet([18, 37, 8, 28]).join() === '18,37,8,28');
eq('twenty-one', L.spellFull(21), 'twenty-one'); eq('ninety', L.spellFull(90), 'ninety');
eq('first', L.ordinalWord(1), 'first'); eq('twelfth', L.ordinalWord(12), 'twelfth'); eq('13th', L.ordinalWord(13), '13th'); eq('21st', L.ordinalNum(21), '21st'); eq('112th', L.ordinalNum(112), '112th'); eq('22nd', L.ordinalNum(22), '22nd');
eq('the second overtime', L.periodName(6), 'second overtime'); eq('the fourth', L.periodName(4), 'fourth');
eq('a score has an en dash', L.score(94, 68), '94–68'); eq('a clock', L.clock(6 * 60000 + 33000), '6:33'); eq('a signed figure', L.signed(-4.25, 1), '−4.3');
eq('just over four minutes', L.approxMinutes(4.2 * 60000), 'just over four minutes'); eq('nearly nine minutes', L.approxMinutes(8.9 * 60000), 'nearly nine minutes'); eq('twelve minutes', L.approxMinutes(12 * 60000), 'twelve minutes');

console.log('-- names in capitals');
eq('a shouted name is set as a name', L.titleCase('FUERZA REGIA'), 'Fuerza Regia');
eq('particles stay small in a shouted name', L.titleCase('EL CALOR DE CANCÚN'), 'El Calor de Cancún');
eq('...both of them', L.titleCase('SANTOS DEL POTOSI'), 'Santos del Potosi');
eq('an abbreviation is kept (BC)', L.titleCase('BC ZALGIRIS'), 'BC Zalgiris'); eq('a suffix is set as one (Jr)', L.titleCase('JOSEPH THOMASSON JR'), 'Joseph Thomasson Jr');
eq('a doubled space goes', L.titleCase('JIMOND  IVEY'), 'Jimond Ivey'); eq('lower case is capitalised', L.titleCase('soft club'), 'Soft Club');
eq('a lower-case particle in a typed name is capitalised as before', L.titleCase('de la cruz'), 'De La Cruz');
eq('McBride is left', L.titleCase('McBride'), 'McBride'); eq('mccormack is McCormack', L.titleCase('mccormack'), 'McCormack'); eq('a roman numeral is capitals', L.titleCase('bristol flyers ii'), 'Bristol Flyers II');
eq('KK Split is left', L.titleCase('KK Split'), 'KK Split');

console.log('-- polish repairs what a paragraph got wrong');
eq('doubled space and space before a comma', L.polish('It was  close , tight.'), 'It was close, tight.');
eq('a doubled word', L.polish('They won the the game.'), 'They won the game.'); eq('"had had" is English', L.polish('They had had enough.'), 'They had had enough.');
eq('the winners’s -> the winners’', L.polish('in the winners’s favour'), 'in the winners’ favour'); eq('Flyers’s -> Flyers’', L.polish('Bristol Flyers’s bench'), 'Bristol Flyers’ bench');
eq('a 8-0 run -> an 8-0 run', L.polish('It was a 8–0 run.'), 'It was an 8–0 run.'); eq('an 7-0 run -> a 7-0 run', L.polish('It was an 7–0 run.'), 'It was a 7–0 run.'); eq('An at the start keeps its capital', L.polish('An 7–0 run'), 'A 7–0 run');
eq('1 points -> 1 point', L.polish('He had 1 points.'), 'He had 1 point.'); eq('2 point -> 2 points', L.polish('He had 2 point.'), 'He had 2 points.');
eq('a compound is not a plural (15 second-chance points)', L.polish('They found 15 second-chance points.'), 'They found 15 second-chance points.');
eq('a straight apostrophe is curled', L.polish("They didn't quit."), 'They didn’t quit.'); eq('a sentence starts with a capital', L.polish('They won. it was close.'), 'They won. It was close.');
eq('an abbreviation does not start a sentence', L.polish('Joseph Thomasson Jr. scored 20.'), 'Joseph Thomasson Jr. scored 20.');
eq('a tag is never touched', L.polish('<span class="x">a 8–0</span>'), '<span class="x">an 8–0</span>');
eq('a comma gets its space', L.polish('It was 5,and 6.'), 'It was 5, and 6.');

console.log('-- lint reports what is wrong');
const kinds = t => L.lint(t).map(i => i.rule);
ok('a clean sentence has no findings', kinds('Newcastle Eagles won 94–68 on Friday.').length === 0, kinds('Newcastle Eagles won 94–68 on Friday.'));
ok('a double space', kinds('It was  close.').includes('double-space')); ok('a wrong article', kinds('It was a 8–0 run.').includes('article'));
ok('a wrong possessive', kinds('the winners’s favour').includes('possessive')); ok('number agreement', kinds('He had 1 points.').includes('number-agreement'));
ok('a lower-case sentence start', kinds('They won. it was close.').includes('sentence-capital')); ok('a leaked value', kinds('scored undefined points').includes('leaked-value'));
ok('unbalanced brackets', kinds('He scored (twice.').includes('unbalanced-brackets'));

console.log('-- the register of grammar rules, each held to its own examples');
ok('the register carries a full set of rules', L.GRAMMAR.length >= 45, L.GRAMMAR.length);
ok('every rule has an id, a level, a message and an example both ways', L.GRAMMAR.every(r => r.id && ['error', 'style', 'hint'].includes(r.level) && r.msg && r.bad && r.good));
ok('ids are unique', new Set(L.GRAMMAR.map(r => r.id)).size === L.GRAMMAR.length);
L.GRAMMAR.forEach(r => {
  ok(r.id + ': the wrong form is found', L.grammar(r.bad).some(f => f.id === r.id), r.bad);
  ok(r.id + ': the right form is not', !L.grammar(r.good).some(f => f.id === r.id), r.good);
  if (r.fix) ok(r.id + ': and it is repaired', !L.grammar(L.polish(r.bad)).some(f => f.id === r.id), L.polish(r.bad));
});
eq('a club is plural: Bristol Flyers were', L.polish('Bristol Flyers was ahead and Newcastle Eagles has won.', { names: ['Bristol Flyers', 'Newcastle Eagles'] }), 'Bristol Flyers were ahead and Newcastle Eagles have won.');
ok('...and reported when it is not repaired', L.grammar('Bristol Flyers was ahead.', { names: ['Bristol Flyers'] }).some(f => f.id === 'team-agreement'));
eq('a date is not a score', L.polish('On 2026-09-26 they won 94-68.'), 'On 2026-09-26 they won 94\u201368.');
eq('a season is a range', L.polish('The 2025-26 season.'), 'The 2025\u201326 season.');
eq('several repairs at once', L.polish('They scored 15 second chance points, alot of it in a 11 point lead on saturday.'), 'They scored 15 second-chance points, a lot of it in an 11-point lead on Saturday.');
eq('one of the ... was', L.polish('One of the best players were hurt.'), 'One of the best players was hurt.');
eq('there were two', L.polish('There was three runs.'), 'There were three runs.'); eq('there was one', L.polish('There were a run.'), 'There was a run.');
eq('a hyphen is kept where it belongs', L.polish('a full-court press and a two-point game'), 'a full-court press and a two-point game');
ok('hints are reported only on request', L.lint('They didn\u2019t score.').every(i => i.rule !== 'contraction') && L.lint('They didn\u2019t score.', { hints: true }).some(i => i.rule === 'contraction'));
ok('the critic prices a grammar error above a hint', L.critique('They lost there lead.', {}).score < L.critique('They didn\u2019t score.', {}).score);

console.log('-- the critic scores on a 0-100 scale');
const sc = t => L.critique(t, {}).score;
ok('a clean sentence scores 100', sc('Newcastle won the game on Friday night.') === 100, sc('Newcastle won the game on Friday night.'));
ok('a run-on with three "and"s is marked down', sc('They scored 12, and they took 14 boards, and they forced 9 turnovers, and they won.') < 100);
ok('a filler is marked down', sc('They played very well in the first half.') < sc('They played well in the first half.'));
ok('a repeated opener is marked down', L.critique('Newcastle won the boards. Newcastle won the game.', {}).score < 100);
ok('a phrase said twice is marked down', L.critique('It was a share few sides in this league ever reach. Then another share few sides in this league ever reach.', {}).notes.some(n => /twice/.test(n.why)));
ok('digits and number words in one breath are marked down', L.critique('They won 18 of their 37, against eight of 28.', {}).notes.some(n => /number words/.test(n.why)));
ok('a sentence dense with numbers is marked down', sc('They shot 5 of 9, 4 of 7, 3 of 8, 6 of 10 and 2 of 3.') < 100);

console.log('-- the reviser improves the text until it is satisfied');
{
  const bad = 'Newcastle Eagles took the period 29–16 and they scored 12 on the break, and they forced 14 turnovers, and they shot very well from three. Newcastle Eagles won the boards. Newcastle Eagles led.';
  const r = L.revise(bad, { names: ['Newcastle Eagles', 'Bristol Flyers'] });
  ok('it scores the text before and after, and the second is higher', r.score > r.initial, [r.initial, r.score]);
  ok('it says what it did', r.log.length >= 1 && r.log.every(x => x.to > x.from), r.log);
  ok('it stops at the target', r.score >= L.TARGET || r.log.length >= 1);
  const again = L.revise(r.text, { names: ['Newcastle Eagles', 'Bristol Flyers'] });
  ok('a text that is already satisfied is left alone', again.log.length === 0 && again.text === r.text);
  ok('it is deterministic: the same text always comes out the same', L.revise(bad, { names: ['Newcastle Eagles', 'Bristol Flyers'] }).text === r.text);
  ok('a run-on is split, and a claim is not changed', /29–16/.test(r.text) && /12 on the break/.test(r.text) && /14 turnovers/.test(r.text));
  const t2 = L.revise('Santos won the ball back on 18 of their 37 misses, against eight of 28 for Abejas.', { names: [] });
  ok('figures in one breath are written one way', /against 8 of 28/.test(t2.text), t2.text);
  const t3 = L.revise('They lived on second chances: 19% of their chances came that way, a share few sides in this league ever reach. Off turnovers it was 25–8, a share few sides in this league ever reach.', { names: [] });
  ok('a clause said twice in a paragraph is cut back', (t3.text.match(/a share few sides/g) || []).length === 1, t3.text);
  ok('a sentence said twice is dropped', L.revise('The game was decided by shooting in the second half. The game was decided by shooting in the second half.', {}).text.split('decided').length === 2);
}
console.log('-- choosing between phrasings by score, not by luck');
{
  const opts = ['They shot very well and they really scored a total of 30, and they won, and they led.', 'They shot well and scored 30.', 'They won, and they led, and they scored.'];
  eq('the best-scoring option wins, whatever the seed', [0, 1, 2, 3, 4].map(s => L.choose(s, opts, [])).filter(x => x === opts[1]).length, 5);
  ok('the same seed always gives the same option', L.choose(7, ['A one.', 'A two.'], []) === L.choose(7, ['A one.', 'A two.'], []));
  ok('a phrasing that opens the way the last sentence did is avoided', L.choose(0, ['Newcastle won the boards.', 'The boards went to Newcastle.'], [L.opener('Newcastle won it.')]) === 'The boards went to Newcastle.');
}

console.log('-- the facts from the connections, play type + rebounds and shot clock tabs');
{
  const Story = globalThis.EpinoiaStory;
  const conn = (a, s, n, pts, th) => ({ assisterName: a, scorerName: s, count: n, points: pts, threes: th, twos: n - th });
  const base = () => ({ names: ['neon city', 'harbour bay'], score: [80, 70], players: [], byId: {}, team: [{}, {}], perQ: [[0, 10, 10, 10, 10], [0, 10, 10, 10, 10]], periods: 4, events: [],
    adv: [{ efg: 55, tovp: 12, orebp: 30, ftr: 30, possessions: 80, pts: 80, pace: 80 }, { efg: 48, tovp: 16, orebp: 25, ftr: 25, possessions: 80, pts: 70, pace: 80 }], lineups: [[], []], stints: [[], []] });
  const g = base();
  g.connections = [[conn('ann lee', 'bo kim', 4, 9, 3), conn('ann lee', 'cy dow', 3, 6, 0), conn('ann lee', 'di fox', 2, 4, 0), conn('bo kim', 'ann lee', 1, 2, 0)], [conn('ed roe', 'fay gil', 2, 4, 0), conn('gus ho', 'ed roe', 2, 5, 1), conn('ed roe', 'gus ho', 1, 3, 1)]];
  const duo = Story.facts(g).find(f => f.kind === 'duo' && f.side === 0);
  ok('the best pairing on a side is a fact, with its assists and points', duo && duo.data.assister === 'ann lee' && duo.data.scorer === 'bo kim' && duo.data.count === 4 && duo.data.points === 9 && duo.data.threes === 3, duo && duo.data);
  const hub = Story.facts(g).find(f => f.kind === 'passingHub');
  ok('a passer who made most of a side\u2019s assists is its hub', hub && hub.data.name === 'ann lee' && hub.data.count === 9 && hub.data.total === 10 && hub.data.targets === 3, hub && hub.data);
  ok('a side with fewer than five assists has no connection facts', !Story.facts(g).some(f => (f.kind === 'duo' || f.kind === 'passingHub') && f.side === 1));

  const g2 = base();
  const z = (a, m, o) => ({ a, m, o, d: a - m - o });
  g2.sits = [{ all: { zones: { rim: z(20, 10, 6), mid: z(9, 1, 1), three: z(20, 8, 2) } }, transition: { pts: 14 }, second: { pts: 4 }, offTo: { pts: 3 } },
             { all: { zones: { rim: z(20, 10, 1), mid: z(9, 2, 1), three: z(20, 8, 2) } }, transition: { pts: 6 }, second: { pts: 2 }, offTo: { pts: 2 } }];
  g2.sitPlayers = [{ p1: { name: 'ann lee', sits: { transition: { pts: 9 }, second: { pts: 2 }, offTo: { pts: 3 } } }, p2: { name: 'bo kim', sits: { transition: { pts: 5 } } } }, {}];
  const f2 = Story.facts(g2);
  const lead = f2.find(f => f.kind === 'sitLeader');
  ok('the player who scored most of a side\u2019s breaks is named', lead && lead.data.name === 'ann lee' && lead.data.pts === 9 && lead.data.teamPts === 14, lead && lead.data);
  const zb = f2.find(f => f.kind === 'zoneBoards');
  ok('the zone where a side got its misses back far more often is a fact', zb && zb.side === 0 && zb.data.zone === 'rim' && zb.data.mine.o === 6 && zb.data.mine.miss === 10, zb && zb.data);
  ok('a side that made one of nine from mid-range is cold there', f2.filter(f => f.kind === 'midCold').length === 1 && f2.find(f => f.kind === 'midCold').side === 0);

  const g3 = base();
  const ch = (team, dur, pts, second) => ({ team, second: !!second, dur, pts, fga: 1, fgm: pts ? 1 : 0, tov: 0 });
  g3.clock = { chances: [].concat(
    Array.from({ length: 10 }, (_, i) => ch(0, 5, i < 7 ? 2 : 0)), Array.from({ length: 10 }, (_, i) => ch(1, 5, i < 3 ? 2 : 0)),
    Array.from({ length: 10 }, (_, i) => ch(0, 12, i < 5 ? 2 : 0)), Array.from({ length: 10 }, (_, i) => ch(1, 12, i < 8 ? 2 : 0)),
    Array.from({ length: 7 }, () => ch(1, 20, 0)), Array.from({ length: 3 }, () => ch(1, 20, 2)), Array.from({ length: 2 }, () => ch(0, 20, 2))) };
  const f3 = Story.facts(g3);
  const early = f3.find(f => f.kind === 'clockEarly');
  ok('the side that scored more early in the clock is a fact', early && early.side === 0 && Math.abs(early.data.mine.ppp - 1.4) < 1e-9 && Math.abs(early.data.theirs.ppp - 0.6) < 1e-9, early && early.data);
  const late = f3.find(f => f.kind === 'clockLate');
  ok('a side that ran the clock down and scored less for it is a fact', late && late.side === 1 && late.data.late.n === 10 && late.data.share > 30, late && late.data);
  ok('second chances are never counted in a clock window', !Story.facts(Object.assign(base(), { clock: { chances: Array.from({ length: 30 }, () => ch(0, 5, 2, true)) } })).some(f => f.kind === 'clockEarly'));

  const g4 = base();
  const pa = Story.facts(g4).find(f => f.kind === 'pointsAdded');
  ok('every factor is worked for both sides, with what it was worth', pa && pa.data.rows.length === 4 && pa.data.rows.every(r => r.pts.length === 2 && isFinite(r.net)), pa && pa.data);
  const efg = pa.data.rows.find(r => r.key === 'efg');
  ok('the efg row is (efg - the average) x 2.0 x possessions / 100 for each side', efg && Math.abs(efg.pts[0] - (55 - 51.5) * 2 * 0.8) < 1e-9, efg && efg.pts);
  const rep4 = Report.report(g4);
  ok('the report has a section for the four factors, with its card', rep4.sections.some(s => /four factors were worth/i.test(s.heading) && s.card === 'pointsAdded'), rep4.sections.map(s => s.heading));
  const rep1 = Report.report(Object.assign(base(), { connections: g.connections }));
  const moved = rep1.sections.filter(s => /ball moved/i.test(s.heading))[0];
  ok('and one for how the ball moved, naming a club with every player', moved && moved.paras.every(p => /Neon City|Harbour Bay/.test(p)), moved && moved.paras);
  const rep3 = Report.report(Object.assign(base(), { clock: g3.clock }));
  ok('and one for the shot clock', rep3.sections.some(s => /shot clock/i.test(s.heading)));
}

console.log('-- the lede: the headline and the standfirst lead with the sharpest thing the game did');
{
  const mkp = (id, name, team, o) => Object.assign({ id, name, team, num: '4', min: 600000, pts: 0, or: 0, dr: 0, ast: 0, stl: 0, blk: 0, pf: 0, to: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 }, o);
  const mkg = (players, over) => {
    const byId = {}; players.forEach(p => { byId[p.id] = p; });
    return Object.assign({ names: ['brisbane bullets', 'illawarra hawks'], score: [96, 84], players, byId, team: [{ paint: 40, fast: 10, sc: 8, pot: 10, bench: 20 }, { paint: 38, fast: 9, sc: 7, pot: 9, bench: 19 }],
      adv: [{ efg: 52, tovp: 14, orebp: 28, ftr: 25, possessions: 90, pts: 96, pace: 90 }, { efg: 50, tovp: 15, orebp: 27, ftr: 24, possessions: 90, pts: 84, pace: 90 }],
      lineups: [[], []], stints: [[], []], perQ: [[0, 24, 24, 24, 24], [0, 21, 21, 21, 21]], periods: 4, events: [] }, over || {});
  };
  const quiet = () => [mkp('a1', 'max mackinnon', 0, { pts: 31, p2m: 9, p2a: 14, p3m: 3, p3a: 5, dr: 4 }), mkp('a2', 'cy dow', 0, { pts: 12, dr: 4 }), mkp('b1', 'leo nakamura', 1, { pts: 20, dr: 4 })];
  const A = Report.report(mkg(quiet()));
  ok('a big night by a winner is the headline: his name and his points', /Max Mackinnon|Max MacKinnon/i.test(A.headline) && /31/.test(A.headline), A.headline);
  ok('...and the standfirst does not say it again', !/31/.test(A.standfirst), A.standfirst);

  const B = Report.report(mkg([mkp('a1', 'max mackinnon', 0, { pts: 14, dr: 49 }), mkp('b1', 'leo nakamura', 1, { pts: 14, dr: 32 })]));
  ok('a rebounding gap of 17 is a lede: 49\u201332 is in the headline or the standfirst', /49\u201332/.test(B.headline + ' ' + B.standfirst), [B.headline, B.standfirst]);
  ok('...and said once, not again in the body', (B.sections.flatMap(x => x.paras).join(' ').match(/49\u201332/g) || []).length === 0, B.sections.flatMap(x => x.paras).filter(p => /49\u201332/.test(p)));

  const C = Report.report(mkg([mkp('a1', 'max mackinnon', 0, { pts: 14 }), mkp('b1', 'leo nakamura', 1, { pts: 36, p2m: 12, p2a: 18, p3m: 4, p3a: 8 })]));
  ok('a big night in defeat is a headline too, and says so', /Leo Nakamura/.test(C.headline) && /not enough/.test(C.headline), C.headline);

  const D = Report.report(mkg(quiet(), { team: [{ paint: 60, fast: 25, sc: 8, pot: 10, bench: 20 }, { paint: 30, fast: 9, sc: 7, pot: 9, bench: 19 }] }));
  const kinds = [D.headline, D.standfirst].join(' | ');
  ok('a paint gap and a fast-break gap both count, and the lede names two different things', /paint/.test(kinds) || /fast-break|on the break/.test(kinds), kinds);
  ok('a headline never carries the same fact as the standfirst', !(/31/.test(D.headline) && /31/.test(D.standfirst)), kinds);

  const E = Report.report(mkg([mkp('a1', 'max mackinnon', 0, { pts: 9 }), mkp('b1', 'leo nakamura', 1, { pts: 9 })], { score: [80, 78], perQ: [[0, 20, 20, 20, 20], [0, 20, 20, 19, 19]] }));
  ok('a game with nothing standing out still gets a plain headline and a standfirst', E.headline.length > 10 && E.standfirst.length > 5, [E.headline, E.standfirst]);
  ok('the turnovers and free throws agree with their verb: "were", not "was"', !/(turnovers|free throws) alone was/i.test(A.standfirst + B.standfirst + C.standfirst + D.standfirst + E.standfirst));
}

console.log('-- the report, end to end');
{
  const mk = (id, name, team, o) => Object.assign({ id, name, team, num: '4', min: 600000, pts: 0, or: 0, dr: 0, ast: 0, stl: 0, blk: 0, pf: 0, to: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 }, o);
  const players = [mk('a1', 'TOBY ASHWORTH', 0, { pts: 24, p2m: 6, p2a: 10, p3m: 4, p3a: 7, dr: 6, ast: 5 }), mk('b1', 'leo  nakamura', 1, { pts: 18, p2m: 7, p2a: 14, p3m: 1, p3a: 3, dr: 11 })];
  const byId = {}; players.forEach(p => { byId[p.id] = p; });
  const ev = []; let q = 0;
  for (let i = 0; i < 7; i++) ev.push({ id: q++, t: 'p2_made', team: 1, period: 1 });
  for (let i = 0; i < 8; i++) ev.push({ id: q++, t: 'p2_made', team: 0, period: 2 });
  const g = { names: ['NEON CITY', 'HARBOUR BAY'], score: [42, 38], players, byId, team: [{ bench: 28, pot: 18, paint: 30, sc: 16 }, { bench: 12, pot: 6, paint: 16, sc: 4 }],
    adv: [{ efg: 56.2, tovp: 11, orebp: 34, ftr: 26, possessions: 70, pts: 42, pace: 72 }, { efg: 47.1, tovp: 18.5, orebp: 22, ftr: 19, possessions: 70, pts: 38, pace: 72 }],
    lineups: [[{ ids: ['a1'], dur: 600000, pf: 28, pa: 14, net: 18.2 }], [{ ids: ['b1'], dur: 540000, pf: 14, pa: 26, net: -15 }]], stints: [[{ ids: ['a1'], dur: 280000, pf: 19, pa: 5 }], []],
    perQ: [[0, 10, 18, 8, 6], [0, 16, 6, 7, 9]], periods: 4, events: ev };
  const rep = Report.report(g);
  const text = [rep.headline, rep.standfirst].concat(rep.sections.flatMap(s => s.paras)).join(' ');
  ok('a shouted name is set as a name in the prose', /Neon City/.test(text) && !/NEON CITY/.test(text.replace(rep.headline, '')), text.slice(0, 120));
  ok('a stray space in a name is gone', !/Leo  Nakamura/.test(text));
  ok('the finished report has no grammar findings', rep.sections.flatMap(s => s.paras).every(p => L.lint(p, { allowEntities: true }).length === 0), rep.sections.flatMap(s => s.paras).flatMap(p => L.lint(p, { allowEntities: true })));
  ok('the report says how it was revised, on the scale', rep.quality && rep.quality.target === L.TARGET && rep.quality.score >= rep.quality.initial - 0.001 && Array.isArray(rep.quality.revisions), rep.quality);
  ok('the four factors are added up when the brief has the possessions', rep.sections.some(s => s.paras.some(p => /four factors|factor by factor/.test(p))), rep.sections.flatMap(s => s.paras).join(' | ').slice(0, 300));
  const once = Report.report(g), twice = Report.report(g);
  ok('the same game reads the same way twice', JSON.stringify(once.sections) === JSON.stringify(twice.sections));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
