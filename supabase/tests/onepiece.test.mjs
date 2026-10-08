/* ============================================================================
   THE MATCH REPORT AS ONE PIECE (game/matchwriter.js through game/report.js, 2026-10-08).

   Louie: the report read "clunky and unlike a real game report" - headed sections of true sentences, and sections that had
   to be there whether the game gave them anything or not. The report is now written in the newsroom's voice (voice.js) as
   one story in paragraphs, each graphic after the paragraph it proves. These tests hold what that promises:

     1. the shape: a one-piece report, paragraphs in a match report's order, no headings on the page, in the plain text or in
        the filed article; the graphics after the paragraphs they belong to; the table after the opening paragraph
     2. the writing: no paragraph opens on "they", "he" or "she"; the first sentence about a side's players names the side;
        the standfirst is not the opening paragraph again; the facts check (verifyClaims) finds nothing to drop
     3. the story is told in the order it happened: a first-half run before the half-time score; a run by the side that lost
        is a fightback, never "the game turned"
     4. people: a women's league says "she", a league that does not say is never "he"; a club is called by its short name
        after the first time (Kėdainiai, Manresa, Bristol), never a sponsor's or a genitive's
     5. the sectioned report is still there for a tie and for its own tests (report(g, { legacy: true }))
     6. the page and the function load the voice, the editor and the writer before report.js

       node supabase/tests/onepiece.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = path.join(ROOT, 'epinoia', 'game');
globalThis.EpinoiaStory = require(path.join(G, 'story.js'));
globalThis.EpinoiaLanguage = require(path.join(G, 'language.js'));
globalThis.EpinoiaVoice = require(path.join(ROOT, 'epinoia', 'voice.js'));
globalThis.EpinoiaScrutiny = require(path.join(ROOT, 'epinoia', 'scrutiny.js'));
globalThis.EpinoiaMatchWriter = require(path.join(G, 'matchwriter.js'));
const MW = globalThis.EpinoiaMatchWriter;
const Report = require(path.join(G, 'report.js'));
const View = require(path.join(G, 'reportview.js'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

const mk = (id, name, team, o) => Object.assign({ id, name, team, num: '4', min: 600000, pts: 0, or: 0, dr: 0, ast: 0, stl: 0,
  blk: 0, pf: 0, to: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 }, o);
/* a game the writer has plenty to say about: the hosts win by 13, a 16-0 run in the second quarter, a star, a struggler */
function game(over) {
  const players = [
    mk('a1', 'toby ashworth', 0, { pts: 26, p2m: 7, p2a: 10, p3m: 4, p3a: 7, dr: 6, ast: 5 }),
    mk('a2', 'marcus bell', 0, { pts: 14, p2m: 6, p2a: 9, dr: 9, or: 3 }),
    mk('a3', 'cal dent', 0, { pts: 6, p2m: 3, p2a: 5, blk: 5, dr: 4 }),
    mk('b1', 'leo nakamura', 1, { pts: 18, p2m: 7, p2a: 14, p3m: 1, p3a: 3, dr: 11, or: 2, ast: 1 }),
    mk('b2', 'ivo petrov', 1, { pts: 6, p2m: 2, p2a: 9, p3m: 0, p3a: 6 })
  ];
  const byId = {}; players.forEach(p => { byId[p.id] = p; });
  /* a 14-0 run that starts late in the first quarter and runs into the second (each period opens with its event) */
  const ev = []; let q = 0;
  const at = (team, period, clock) => ev.push({ id: q++, t: 'p2_made', team, period, clock });
  ev.push({ id: q++, t: 'period_start', period: 1, clock: 600000 });
  [560000, 520000, 480000].forEach(c => at(0, 1, c));
  [420000, 380000].forEach(c => at(1, 1, c));
  at(0, 1, 100000);
  ev.push({ id: q++, t: 'period_start', period: 2, clock: 600000 });
  [560000, 520000, 480000, 440000, 400000, 360000].forEach(c => at(0, 2, c));
  [300000].forEach(c => at(1, 2, c));
  return Object.assign({
    names: ['neon city', 'harbour bay'], score: [71, 58], players, byId,
    team: [{ bench: 22, pot: 18, paint: 34, sc: 12, fast: 10 }, { bench: 14, pot: 6, paint: 20, sc: 6, fast: 8 }],
    adv: [{ efg: 54.2, tovp: 11, orebp: 30, ftr: 26 }, { efg: 44.1, tovp: 19.5, orebp: 22, ftr: 19 }],
    lineups: [[{ ids: ['a1', 'a2'], dur: 600000, pf: 28, pa: 14, net: 18.2 }], [{ ids: ['b1'], dur: 540000, pf: 14, pa: 26, net: -15 }]],
    stints: [[], []], perQ: [[0, 18, 22, 16, 15], [0, 14, 10, 17, 17]], periods: 4, reg: 4, events: ev,
    starters: [['a1', 'a2', 'a3'], ['b1', 'b2']],
    meta: { venue: 'the arena', day: 'Saturday', league: 'Test League', competition: 'Test League' }
  }, over || {});
}

console.log('1. the shape');
const g = game();
const rep = Report.report(g);
const beats = rep.sections.map(s => s.beat);
ok('the report is written as one piece', rep.onePiece === true && rep.sections.length >= 3, JSON.stringify(beats));
ok('in a match report\'s order: the result first, what comes next last',
   beats[0] === 'lede' && beats.indexOf('flow') > 0 && (beats.indexOf('stars') < 0 || beats.indexOf('stars') > beats.indexOf('flow')), JSON.stringify(beats));
ok('each paragraph still knows which part of the report it is (never shown)', rep.sections.every(s => s.heading && s.beat));
const html = View.render(g, rep, { tableHTML: '<table><tr><td>t</td></tr></table>' });
ok('the page draws one column of prose, with no headings in it',
   (html.match(/<section/g) || []).length === 1 && /rsec-flow/.test(html) && !/<h2/.test(html));
const flowAt = html.indexOf(rep.sections.find(s => s.beat === 'flow').paras[0].slice(0, 30));
ok('the scoring by period comes straight after the paragraph about how it went',
   flowAt > 0 && html.indexOf('Scoring by period') > flowAt);
ok('the table comes after the opening paragraph', html.indexOf('id="repTable"') > html.indexOf(rep.sections[0].paras[0].slice(0, 30)) &&
   html.indexOf('id="repTable"') < flowAt);
const plainText = Report.plain(g);
ok('the plain text (an article, a feed) has no headings either', !/HOW IT WAS WON|WHAT DECIDED IT|THE PERFORMANCES|WHAT IT MEANS/.test(plainText));
const mr = rd('supabase', 'functions', '_shared', 'matchreport.ts');
ok('nor the article finalise-game files', /if \(s\.heading && !rep\.onePiece\) blocks\.push\(h2\(s\.heading\)\)/.test(mr));

console.log('\n2. the writing');
const strip = s => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
const paras = rep.sections.map(s => strip(s.paras.join(' ')));
ok('no paragraph opens on "they", "he" or "she"', paras.every(p => !/^(They|He|She|Their|His|Her)\b/.test(p)), paras.map(p => p.slice(0, 40)).join(' | '));
const clubs = /Neon City|Harbour Bay|\bCity\b|\bBay\b/;
const starsP = rep.sections.find(s => s.beat === 'stars');
ok('the first sentence about a side\'s players names the side', !starsP || clubs.test(strip(starsP.paras[0]).split(/(?<=\.)\s/)[0]), starsP && strip(starsP.paras[0]));
ok('the standfirst is not the opening paragraph again', !!rep.standfirst && strip(rep.standfirst) !== paras[0] && paras[0].indexOf(strip(rep.standfirst)) < 0, rep.standfirst);
const facts = Report.report(g).facts;
const caught = rep.sections.flatMap(s => s.paras).concat([rep.headline, rep.standfirst]).flatMap(p => Report.verifyClaims(g, facts, p));
ok('the facts check finds nothing to drop', caught.length === 0, JSON.stringify(caught.slice(0, 2)));
ok('nothing in it reads like a model ("per 100 possessions", "box plus-minus", "points a chance")',
   !/per 100 possessions|box plus-minus|points a chance|the numbers say/i.test(paras.join(' ')));

console.log('\n3. the order it happened in');
const flowP = strip(rep.sections.find(s => s.beat === 'flow').paras[0]);
const runAt = flowP.search(/14–0|fourteen|14 straight|14 in a row|14 unanswered/i), halfAt = flowP.search(/half-time|the break/);
ok('a run in the first half is told before the half-time score', runAt >= 0 && halfAt > runAt, flowP);
ok('...and a first-half run of 14 is not claimed as the one that decided it', !/decided it|with it the game|game turned/i.test(flowP), flowP);
/* the side that lost had the run, late on: a fightback */
const fbEv = []; let fq = 0;
const fat = (team, period, clock) => fbEv.push({ id: fq++, t: 'p2_made', team, period, clock });
/* the winners' 12-0 run early, the losers' 14-0 run in the fourth: the longest run is the side that lost */
fbEv.push({ id: fq++, t: 'period_start', period: 1, clock: 600000 });
[550000, 500000, 450000, 400000].forEach(c => fat(0, 1, c)); fat(1, 1, 300000); [250000, 200000].forEach(c => fat(0, 1, c));
fbEv.push({ id: fq++, t: 'period_start', period: 4, clock: 600000 });
[560000, 520000, 480000, 440000, 400000, 360000, 320000].forEach(c => fat(1, 4, c)); fat(0, 4, 200000);
const fb = game({ events: fbEv });
const fbFlow = strip((Report.report(fb).sections.find(s => s.beat === 'flow') || { paras: [''] }).paras[0]);
ok('a run by the side that lost is never "the game turned" (and, where it did not make it close, is not said at all)',
   !/game turned|decided it|with it the game/i.test(fbFlow) && !/14–0|fourteen in a row|14 straight/.test(fbFlow), fbFlow);
/* SMALL RUNS ARE A DETAIL OF THE FLOW (Louie, 2026-10-08): never the headline, the standfirst or the opening paragraph */
const smallHead = strip(rep.headline + ' ' + rep.standfirst + ' ' + rep.sections[0].paras.join(' '));
ok('a 14-0 run in the first half is not in the headline, the standfirst or the opening paragraph', !/–0|in a row|unanswered|straight points/.test(smallHead), smallHead);
ok('...it is in the flow, in passing, with the score it moved', /\d+–\d+ into \d+–\d+|\d+–\d+ to \d+–\d+|ahead, \d+–\d+/.test(flowP), flowP);

console.log('\n4. people and clubs');
const women = Report.report(game({ meta: { league: 'Liga Femenina', competition: 'Liga Femenina', day: 'Saturday' } }));
const wt = strip([women.standfirst].concat(women.sections.flatMap(s => s.paras)).join(' '));
ok('a women\'s league: "she", never "he"', !/\b(he|his|him)\b/i.test(wt), wt.match(/[^.]*\b(he|his|him)\b[^.]*\./i));
const none = Report.report(game({ meta: { league: '', competition: '' } }));
const nt = strip(none.sections.flatMap(s => s.paras).join(' '));
ok('a league that does not say is never "he" or "she"', !/\b(he|his|him|she|her)\b/i.test(nt), nt.match(/[^.]*\b(he|his|him|she|her)\b[^.]*\./i));
const short = n => MW.clubShort(n);
ok('a club is called by its short name after the first time',
   short('Kids&Us Manresa') === 'Manresa' && short('Bristol Flyers') === 'Bristol' && short('FCC Baschet UAV Arad') === 'Arad' &&
   short('LDLC ASVEL Villeurbanne') === 'ASVEL' && short('Valencia Basket') === 'Valencia' && short('Telekom Baskets Bonn') === 'Bonn',
   ['Kids&Us Manresa', 'Bristol Flyers', 'FCC Baschet UAV Arad', 'LDLC ASVEL Villeurbanne', 'Valencia Basket', 'Telekom Baskets Bonn'].map(short).join(', '));
ok('a Baltic club: the town as it is said, or the club after the genitive town',
   JSON.stringify(MW.clubShorts(['Kėdainių Kėdainiai BC', 'Šilutės Šilutė-PDS.lt'])) === '["Kėdainiai","Šilutė"]' &&
   JSON.stringify(MW.clubShorts(['Kauno R. Atletas', 'Alytaus Patriotai'], { baltic: true })) === '["Atletas","Patriotai"]',
   JSON.stringify(MW.clubShorts(['Kėdainių Kėdainiai BC', 'Šilutės Šilutė-PDS.lt'])));
ok('a Greek club keeps its own name, not its town', MW.clubShort('Panathinaikos Athens') === 'Panathinaikos');
ok('two clubs that would share a short name keep their full names', JSON.stringify(MW.clubShorts(['Real Madrid', 'Madrid Lions'])) === JSON.stringify(['Real Madrid', 'Madrid Lions']) ||
   MW.clubShorts(['Real Madrid', 'Madrid Lions'])[0] !== MW.clubShorts(['Real Madrid', 'Madrid Lions'])[1]);
ok('a name with a nickname of two words (Gunma Crane Thunders) is the town', short('Gunma Crane Thunders') === 'Gunma');

console.log('\n5. the sectioned report');
const legacy = Report.report(g, { legacy: true });
ok('report(g, { legacy: true }) is the sectioned report, with its headings', !legacy.onePiece && legacy.sections.some(s => s.heading === 'How it was won'));
const tie = Report.report(game({ score: [70, 70] }));
ok('a tie is written the sectioned way (the writer has no winner to tell)', !tie.onePiece);

console.log('\n6. where it runs');
const page = rd('epinoia', 'game', 'index.html');
const at = s => page.indexOf(s);
ok('the game page loads the voice, the editor and the writer before report.js',
   at('../voice.js') > 0 && at('../scrutiny.js') > at('../voice.js') && at('matchwriter.js') > at('../scrutiny.js') && at('report.js?') > at('matchwriter.js'));
const fn = rd('supabase', 'functions', 'finalise-game', 'index.ts');
ok('finalise-game imports them before the report', fn.indexOf("'../_shared/matchwriter.js'") > 0 && fn.indexOf("'../_shared/matchwriter.js'") < fn.indexOf("'../_shared/report.js'"));
const ex = rd('supabase', 'tests', 'extract-shared.mjs');
ok('and the shared copies are generated from the page\'s files', /'voice\.js'/.test(ex) && /'scrutiny\.js'/.test(ex) && /'matchwriter\.js'/.test(ex));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
