/* ============================================================================
   THE MATCH REPORT SAYS TRUE THINGS.

   The report is generated prose sitting directly above the box score it
   describes, so a sentence that disagrees with the table underneath it is
   worse than no sentence at all. These tests hold the CLAIMS — which side won
   what, whether a run really happened, whether a lineup really swung it — and
   leave the wording alone, which is the whole reason facts and phrasing live
   in two files.

   Also held here are the three faults found by reading real output rather than
   by reasoning about it, because each was invisible in the code and obvious on
   the page:

     * names arrived lowercase from the scorer, which a stylesheet up-cases for
       a table heading and prose cannot;
     * a three-minute lineup was quoted at "106.8 points per 100 possessions",
       arithmetically correct and journalistically meaningless;
     * the deciding stretch, one side's best group and the other's worst were
       frequently the same passage of play, reported three times in a row.

       node supabase/tests/report.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = path.join(ROOT, 'epinoia', 'game');
globalThis.EpinoiaStory = require(path.join(G, 'story.js'));
const Story = globalThis.EpinoiaStory;
const Report = require(path.join(G, 'report.js'));
const View = require(path.join(G, 'reportview.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '  -> ' + d : '')); } };

const mk = (id, name, team, o) => Object.assign(
  { id, name, team, num: '4', min: 600000, pts: 0, or: 0, dr: 0, ast: 0, stl: 0,
    blk: 0, pf: 0, to: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 }, o);

/* a game built so every claim has a known right answer */
function game(over) {
  const players = [
    mk('a1', 'toby ashworth', 0, { pts: 24, p2m: 6, p2a: 10, p3m: 4, p3a: 7, dr: 6, ast: 5, ts: 66 }),
    mk('a2', 'marcus bell', 0, { pts: 12, p2m: 5, p2a: 9, dr: 9, or: 3, ts: 55 }),
    mk('b1', 'leo nakamura', 1, { pts: 18, p2m: 7, p2a: 14, p3m: 1, p3a: 3, dr: 11, or: 2, ast: 1, ts: 52 })
  ];
  const byId = {}; players.forEach(p => { byId[p.id] = p; });
  const ev = []; let q = 0;
  for (let i = 0; i < 7; i++) ev.push({ id: q++, t: 'p2_made', team: 1, period: 1 });
  for (let i = 0; i < 8; i++) ev.push({ id: q++, t: 'p2_made', team: 0, period: 2 });
  return Object.assign({
    names: ['neon city', 'harbour bay'], score: [42, 38], players, byId,
    team: [{ bench: 28, pot: 18, paint: 30, sc: 16 }, { bench: 12, pot: 6, paint: 16, sc: 4 }],
    adv: [{ efg: 56.2, tovp: 11, orebp: 34, ftr: 26 },
          { efg: 47.1, tovp: 18.5, orebp: 22, ftr: 19 }],
    lineups: [[{ ids: ['a1', 'a2'], dur: 600000, pf: 28, pa: 14, net: 18.2 }],
              [{ ids: ['b1'], dur: 540000, pf: 14, pa: 26, net: -15 }]],
    stints: [[{ ids: ['a1', 'a2'], dur: 280000, pf: 19, pa: 5 }], []],
    perQ: [[0, 10, 18, 8, 6], [0, 16, 6, 7, 9]], periods: 4, events: ev
  }, over || {});
}

const g = game();
const fs = Story.facts(g);
const rep = Report.report(g);
const text = rep.headline + ' ' + rep.standfirst + ' ' +
  rep.sections.flatMap(s => s.paras).join(' ');

/* ---- the claims ---------------------------------------------------------- */
const result = fs.find(f => f.kind === 'result');
ok('the winner is the side that scored more',
   result.data.winner === 0 && result.data.margin === 4);

const run = fs.find(f => f.kind === 'run');
ok('a run is attributed to the side that scored it', run && run.data.team === 0);
ok('...and counts only unanswered points', run && run.data.n === 16,
   run && String(run.data.n));

const cb = fs.find(f => f.kind === 'comeback');
ok('trailing then winning is reported as a comeback', cb && cb.side === 0);
ok('...by the size of the deficit actually faced', cb && cb.data.deficit === 14,
   cb && String(cb.data.deficit));

const q = fs.find(f => f.kind === 'quarter');
ok('the decisive period is the one with the largest margin',
   q && q.data.period === 2 && q.side === 0, q && JSON.stringify(q.data));

const factors = fs.filter(f => f.kind === 'factor');
ok('every four-factor edge is credited to the right side',
   factors.length > 0 && factors.every(f => f.side === 0),
   factors.map(f => f.data.factor + ':' + f.side).join(','));
ok('turnovers are read the right way round — lower is better',
   !!factors.find(f => f.data.factor === 'tov' && f.side === 0));

const stretch = fs.find(f => f.kind === 'stretch');
ok('the deciding stretch names the side it favoured',
   stretch && stretch.side === 0 && stretch.data.swing === 14,
   stretch && JSON.stringify(stretch.data));

/* ---- the three faults found by reading the output ------------------------ */
ok('names are capitalised for prose, not left as the scorer stored them',
   /Neon City/.test(text) && !/neon city/.test(text), text.slice(0, 90));
ok('player names too', /Toby Ashworth/.test(text) || /Ashworth/.test(text));

/* a short stint must not be quoted at a per-100 rate */
const shortRate = Report.report(game({
  lineups: [[{ ids: ['a1', 'a2'], dur: 120000, pf: 8, pa: 2, net: 140.5 }], []]
}));
const shortText = shortRate.sections.flatMap(s => s.paras).join(' ');
ok('a two-minute lineup is never quoted at a per-100 rate',
   !/140\.5/.test(shortText) && !/per 100 possessions/.test(shortText),
   shortText);

/* the same passage of play must be described once */
const dupe = Report.report(game({
  stints: [[{ ids: ['a1', 'a2'], dur: 600000, pf: 28, pa: 14 }], []],
  lineups: [[{ ids: ['a1', 'a2'], dur: 600000, pf: 28, pa: 14, net: 18.2 }], []]
}));
const lineSec = dupe.sections.find(s => s.card === 'lineups');
ok('one group, one sentence — the same minutes are not retold',
   !lineSec || lineSec.paras.length === 1,
   lineSec && lineSec.paras.join(' || '));

/* ---- structure and safety ------------------------------------------------ */
ok('a section always carries the card that evidences it',
   rep.sections.every(s => s.card && s.paras.length));
const html = View.render(g, rep);
ok('every section renders with its card',
   (html.match(/<section/g) || []).length === rep.sections.length &&
   (html.match(/rcard-h/g) || []).length === rep.sections.length);
ok('one bar per period', (html.match(/rq-col/g) || []).length === 4);

const evil = Report.report(game({ names: ['<img src=x onerror=alert(1)>', 'B'] }));
const evilHtml = View.render(game({ names: ['<img src=x onerror=alert(1)>', 'B'] }), evil);
ok('a club name cannot inject markup', !evilHtml.includes('<img src=x'));

/* a game with nothing remarkable still produces a readable report */
const dull = Report.report(game({
  score: [80, 78], perQ: [[0, 20, 20, 20, 20], [0, 20, 20, 19, 19]],
  adv: [{ efg: 50, tovp: 14, orebp: 28, ftr: 22 }, { efg: 50, tovp: 14, orebp: 28, ftr: 22 }],
  lineups: [[], []], stints: [[], []], events: [], team: [{}, {}]
}));
ok('an unremarkable game still gets a headline and a first section',
   !!dull.headline && dull.sections.length >= 1, JSON.stringify(dull.sections.map(s => s.heading)));

/* plain text, for a news body */
const txt = Report.plain(g);
ok('plain text carries no markup', !/[<>]/.test(txt));
ok('...and leads with the headline', txt.split('\n')[0] === rep.headline);

/* ---- the article the finaliser files ------------------------------------- */
/* matchreport.ts is the server side of this: it builds the same brief the
   browser builds, then converts the report into news blocks. Two things there
   can go quietly wrong and both ship a visibly broken article — HTML escaping
   surviving into a text column, and a slug that is not stable across a
   re-finalise (which would leave two reports for one game). */
const MR = await import(
  new URL('../functions/_shared/matchreport.ts', import.meta.url).href);

const body = MR.articleBody(rep, '6271d4ed-023d-4792-b65d-8bcf632f1b3f');
ok('the body is an array of blocks, as the column requires',
   Array.isArray(body) && body.length > 0);
ok('every block is a type the news renderer knows',
   body.every(b => ['p', 'h2', 'rule'].indexOf(b.type) >= 0),
   [...new Set(body.map(b => b.type))].join(','));
ok('each section becomes a heading',
   body.filter(b => b.type === 'h2').length === rep.sections.length);

const btext = JSON.stringify(body.filter(b => b.spans).map(b => b.spans[0].t));
ok('no HTML entity survives into the article text',
   !/&(amp|lt|gt|quot|#\d+);/.test(btext), btext.slice(0, 120));
ok('no markup survives either', !/[<>]/.test(btext));

const ampRep = Report.report(game({ names: ['a & b', 'c'] }));
const ampBody = MR.articleBody(ampRep, 'x');
const ampText = JSON.stringify(ampBody.filter(b => b.spans).map(b => b.spans[0].t));
ok('an ampersand in a club name arrives as itself, not as an entity',
   ampText.includes('A & B') && !ampText.includes('&amp;'), ampText.slice(0, 140));

ok('the slug is stable, so a re-finalise rewrites one article rather than adding one',
   MR.reportSlug('6271d4ed-023d-4792-b65d-8bcf632f1b3f') ===
   MR.reportSlug('6271d4ed-023d-4792-b65d-8bcf632f1b3f'));
ok('...and two different games do not collide',
   MR.reportSlug('6271d4ed-0000-0000-0000-000000000000') !==
   MR.reportSlug('aaaaaaaa-0000-0000-0000-000000000000'));
ok('the slug is URL-safe', /^[a-z0-9-]+$/.test(MR.reportSlug('6271d4ed-02-3d')));

const brief = MR.gameBrief(
  { teams: [{ name: 'a', players: [{ id: 'a1', name: 'one', num: '4' }] },
            { name: 'b', players: [{ id: 'b1', name: 'two', num: '5' }] }],
    events: [{ id: 0, t: 'p2_made', team: 0, period: 3 }] },
  { score: [2, 0], stats: { a1: { pts: 2, p2m: 1, p2a: 1 }, b1: { pts: 0 } },
    team: [{}, {}], perQ: [[0, 0, 0, 2], [0, 0, 0, 0]], lineups: [[], []] },
  [{ efg: 50 }, { efg: 40 }],
  () => []);
ok('the server brief carries every field the fact engine reads',
   ['names', 'score', 'players', 'byId', 'team', 'adv', 'lineups', 'stints',
    'perQ', 'periods', 'events'].every(k => k in brief),
   Object.keys(brief).join(','));
ok('...reads the period count off the log', brief.periods === 3, String(brief.periods));
ok('...and drives the same engine the browser does',
   !!Report.report(brief).headline);

/* ---- prose faults found by reading twelve real reports -------------------
   None of these were visible in the source. Each was obvious the moment the
   output was read, and each is the kind of thing that makes generated writing
   announce itself. */

/* A club opened eight sentences in one report before the referrer existed.
   Nothing should open more than a few. */
{
  const all = [rep.headline, rep.standfirst]
    .concat(rep.sections.flatMap(s => s.paras)).join(' ');
  const sentences = all.split(/(?<=[.!?])\s+/).filter(x => x.trim().length > 4);
  const opens = {};
  sentences.forEach(x => {
    const k = x.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
    opens[k] = (opens[k] || 0) + 1;
  });
  const worst = Math.max(...Object.values(opens));
  ok('no opener is used more than four times in one report', worst <= 4, 'worst ' + worst);

  /* a pronoun can never be the first thing in the article — there is nothing
     for it to refer back to */
  /* Only ANAPHORIC pronouns. "It finished 42-38 to Neon City" is a dummy
     subject and ordinary English; "They won it" as the first words of an
     article has nothing to refer back to and is the referrer misfiring. */
  ok('the report does not open on a pronoun with nothing to refer to',
     !/^(They|Them|Their)\b/.test(rep.sections[0].paras[0]),
     rep.sections[0].paras[0].slice(0, 60));

  /* the joiner lower-cases a clause it welds on, and must not do it to a name */
  ok('a club name is never lower-cased mid-sentence',
     !/\band (east|soft|neon|harbour) [A-Z]/.test(all), all.slice(0, 200));
  ok('a pronoun IS lower-cased when a clause is joined onto another',
     !/, and (They|There|It)\b/.test(all), all);

  /* the number budget */
  const dense = sentences.filter(x => (x.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length >= 5);
  ok('no sentence carries five or more figures', dense.length === 0,
     (dense[0] || '').slice(0, 120));
}

/* Only one player can lead a team. Two bigScore facts on the same side used to
   produce two players "leading" it. */
{
  const two = Report.report(game({
    players: (() => {
      const a = mk('a1', 'alpha one', 0, { pts: 24, p2m: 9, p2a: 17, dr: 4 });
      const b = mk('a2', 'alpha two', 0, { pts: 22, p2m: 8, p2a: 16, dr: 3 });
      const c = mk('b1', 'beta one', 1, { pts: 10, p2m: 4, p2a: 9 });
      return [a, b, c];
    })(),
    byId: {}
  }));
  const prose = two.sections.flatMap(s => s.paras).join(' ');
  const leads = (prose.match(/ (led|carried|top-scored)/g) || []).length;
  ok('at most one player leads each side', leads <= 2, prose);
}

/* "held to no" — the word for zero in a counting phrase is not the word for a
   scoreless night */
{
  const zero = Report.report(game({
    players: [mk('a1', 'quiet man', 0, { pts: 0, p2m: 0, p2a: 6, min: 1500000 }),
              mk('b1', 'beta one', 1, { pts: 20, p2m: 8, p2a: 14 })],
    season: { players: [{ id: 'a1', gp: 6, ppg: 14.2 }], teams: [], teamIndex: {} }
  }));
  const prose = zero.sections.flatMap(s => s.paras).join(' ');
  ok('a scoreless night is not described as "held to no"',
     !/held to no\b/.test(prose) && !/managed no\b/.test(prose), prose);
}

/* the indefinite article follows the sound of the numeral after it */
{
  const eight = Report.report(game({}));
  const all = eight.headline + ' ' + eight.standfirst + ' ' +
    eight.sections.flatMap(s => s.paras).join(' ');
  ok('the article agrees with the numeral it precedes',
     !/\ba (8|11|18)\b/.test(all), (all.match(/\ba (8|11|18)\b.{0,30}/) || [''])[0]);
}

/* variation: two players in the same report must not get the same sentence
   shape with the nouns swapped */
{
  const many = Report.report(game({
    players: [mk('a1', 'alpha one', 0, { pts: 21, p2m: 8, p2a: 14, dr: 5 }),
              mk('a2', 'alpha two', 0, { pts: 20, p2m: 8, p2a: 15, dr: 4 }),
              mk('b1', 'beta one', 1, { pts: 22, p2m: 9, p2a: 16, dr: 6 }),
              mk('b2', 'beta two', 1, { pts: 20, p2m: 7, p2a: 13, dr: 3 })]
  }));
  const sec = many.sections.find(s => s.card === 'players');
  if (sec && sec.paras.length >= 3) {
    const shapes = sec.paras.map(x => x.replace(/[A-Z][a-z]+ [A-Z][a-z]+/g, 'NAME')
                                       .replace(/\d+(\.\d+)?/g, 'N'));
    const uniq = new Set(shapes);
    ok('players in one report are not given the same sentence with names swapped',
       uniq.size > 1, shapes.join(' || '));
  } else ok('players in one report are not given the same sentence with names swapped', true);
}

/* ---- the statistics must mean what the prose says they mean --------------
   Three claims in the writer were not clumsy phrasing, they were wrong, and
   the only way to catch that class of fault is to assert against the DEFINITION
   in engine.js rather than against the field name:

     rimp = rimM / rimA   FG% AT THE RIM        (accuracy)
     rimr = rimA / fga    SHARE OF ATTEMPTS     (diet)
     p3p  = fg3m / fg3a   3PT%                  (accuracy)
     p3r  = fg3a / fga    share of attempts     (diet)
     ftr  = fta / fga     FREE THROWS PER FIELD-GOAL ATTEMPT — a ratio, not a
                          percentage of anything made.

   The report was reading the ACCURACIES and describing them as shot
   distribution ("57.7% of their shots from close"), and printing free-throw
   rate as a percentage. */
{
  /* a side that takes few shots at the rim but makes nearly all of them: the
     accuracy is high, the share is low, and a writer that confuses the two
     says the opposite of the truth */
  const sharp = game({
    adv: [{ efg: 50, tovp: 14, orebp: 28, ftr: 20,
            fga: 60, fg3a: 10, rimA: 8, rimM: 7, midA: 42,
            rimr: 13.3, rimp: 87.5, p3r: 16.7, p3p: 30 },
          { efg: 50, tovp: 14, orebp: 28, ftr: 20,
            fga: 60, fg3a: 10, rimA: 40, rimM: 20, midA: 10,
            rimr: 66.7, rimp: 50, p3r: 16.7, p3p: 30 }]
  });
  const facts = Story.facts(sharp);
  const rim = facts.find(f => f.kind === 'atRim');
  ok('the side that ATTEMPTS more at the rim is the one said to go inside',
     !rim || rim.side === 1, rim && JSON.stringify({ side: rim.side, data: rim.data }));
  ok('...and the figure quoted is the share, not the accuracy',
     !rim || Math.abs(rim.data.share - 66.7) < 0.5, rim && String(rim.data.share));
}

/* shot diet needs the shots to have been LOCATED — engine.js isRim() reads
   locs[ev.id], so a game scored without shot positions has rimA at zero and
   would otherwise be described as never going inside */
{
  const unlocated = game({
    adv: [{ efg: 50, tovp: 14, orebp: 28, ftr: 20,
            fga: 60, fg3a: 10, rimA: 1, rimM: 1, midA: 1, rimr: 1.7, rimp: 100 },
          { efg: 50, tovp: 14, orebp: 28, ftr: 20,
            fga: 60, fg3a: 10, rimA: 0, rimM: 0, midA: 0, rimr: 0, rimp: 0 }]
  });
  const rim = Story.facts(unlocated).find(f => f.kind === 'atRim');
  ok('no claim about shot diet when the shots were never located', !rim,
     rim && JSON.stringify(rim.data));
}

/* free-throw rate is attempts per field-goal attempt, so it is never rendered
   as a percentage in prose */
{
  const line = Report.report(game({
    adv: [{ efg: 50, tovp: 14, orebp: 28, ftr: 44.4 },
          { efg: 50, tovp: 14, orebp: 28, ftr: 17.9 }]
  }));
  const prose = [line.standfirst].concat(line.sections.flatMap(x => x.paras)).join(' ');
  const badFtr = /free throw[s]?[^.]*\d+\.\d+%/i.test(prose) ||
                 /won free throws/i.test(prose);
  ok('free-throw rate is never printed as a percentage or "won free throws"',
     !badFtr, (prose.match(/[^.]*free throw[^.]*\./i) || [''])[0]);
}

/* a foul-out uses the engine's own disqualification flag */
{
  const dq = Story.facts(game({
    players: [mk('a1', 'sent off', 0, { pts: 6, pf: 4, dq: true, min: 900000 }),
              mk('b1', 'beta one', 1, { pts: 20, p2m: 8, p2a: 14 })],
    byId: {}
  })).find(f => f.kind === 'fouledOut');
  ok('a disqualification is read from the engine flag, not guessed from five fouls',
     !!dq, 'dq fact missing');
}

/* the card that follows the performances must not repeat its heading, and must
   actually render — a return followed by a multi-line comment silently
   returned undefined and the card disappeared from every report */
{
  const html = View.render(g, rep);
  ok('the players card renders', /rps/.test(html));
  ok('...and does not repeat the section heading',
     (html.match(/The performances/g) || []).length <= 1,
     String((html.match(/The performances/g) || []).length));
}

/* ---- the performances must read as a paragraph, not a list --------------
   This section emitted one sentence per fact in salience order, which put
   three separate foul-outs on three separate lines and a bare "shot no of
   eight" among them. The faults are structural, so the tests are too. */
{
  const many = Report.report(game({
    players: [
      mk('a1', 'alpha one', 0, { pts: 26, p2m: 9, p2a: 15, dr: 5 }),
      mk('a2', 'alpha two', 0, { pts: 21, p2m: 8, p2a: 14 }),
      mk('a3', 'alpha three', 0, { pts: 4, p2m: 0, p2a: 8, pf: 5, dq: true, min: 900000 }),
      mk('b1', 'beta one', 1, { pts: 22, p2m: 9, p2a: 16, dr: 6 }),
      mk('b2', 'beta two', 1, { pts: 2, p2m: 0, p2a: 9, pf: 5, dq: true, min: 900000 }),
      mk('b3', 'beta three', 1, { pts: 5, p2m: 1, p2a: 7, pf: 5, dq: true, min: 900000 })
    ],
    byId: {}
  }));
  const sec = many.sections.find(x => x.card === 'players');
  const prose = sec ? sec.paras.join(' ') : '';

  /* three foul-outs are one sentence, not three */
  const dqLines = (sec ? sec.paras : []).filter(x => /fouled out/.test(x));
  ok('however many foul out, it is one sentence', dqLines.length <= 1,
     dqLines.join(' || '));
  ok('...and it names them together',
     !dqLines.length || /all fouled out|both fouled out/.test(dqLines[0]),
     dqLines[0]);

  /* the zero-word bug, in every branch that prints a shooting line */
  ok('a scoreless line is never "no of eight"',
     !/\bno of \w+/.test(prose) && !/shot no\b/.test(prose), prose);
  ok('...it is phrased as missing them', !/\(no\b/.test(prose), prose);

  /* the section is composed: fewer paragraphs than players mentioned */
  const named = (prose.match(/Alpha|Beta/g) || []).length;
  ok('players are grouped rather than given a sentence each',
     !sec || sec.paras.length < named, (sec ? sec.paras.length : 0) + ' paras, ' + named + ' mentions');

  /* a verb is not repeated across an elided list */
  ok('a list does not repeat its verb',
     !/added \d+ and \w+ \w+ added \d+/.test(prose), prose);

  /* the higher scorer is named first where both leaders appear */
  const lead = (sec ? sec.paras[0] : '') || '';
  const nums = (lead.match(/\b\d+\b/g) || []).map(Number);
  ok('the leading scorer is named before the other side\'s',
     nums.length < 2 || nums[0] >= nums[1], lead);
}

/* a shooting line keeps one register — spell() stops at twelve, so a
   thirteen-attempt night must not come out as "two of 13" */
{
  const wide = Report.report(game({
    players: [mk('a1', 'alpha one', 0, { pts: 30, p2m: 12, p2a: 20 }),
              mk('b1', 'beta one', 1, { pts: 4, p2m: 2, p2a: 13 })],
    byId: {}
  }));
  const prose = wide.sections.flatMap(x => x.paras).join(' ');
  ok('a shooting line does not mix a spelled word with a numeral',
     !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) of \d+/.test(prose),
     (prose.match(/[^.]*of \d+[^.]*/) || [''])[0]);
}

/* ---- every player named carries his club --------------------------------
   A surname on its own is no use to a reader who does not already know the
   squads, and the report's whole subject is two teams. Names are grouped by
   side so the club can be named once per group rather than after every
   surname. */
{
  const rep2 = Report.report(game({
    players: [
      mk('a1', 'alpha one', 0, { pts: 26, p2m: 9, p2a: 15, dr: 5 }),
      mk('a2', 'alpha two', 0, { pts: 3, p2m: 1, p2a: 9 }),
      mk('b1', 'beta one', 1, { pts: 22, p2m: 9, p2a: 16, dr: 6 }),
      mk('b2', 'beta two', 1, { pts: 2, p2m: 0, p2a: 8 })
    ],
    byId: {}
  }));
  const sec = rep2.sections.find(x => x.card === 'players');
  const paras = sec ? sec.paras : [];

  /* every sentence that names a player must also name a club */
  const named = paras.filter(x => /Alpha|Beta/.test(x));
  const unattributed = named.filter(x => !/neon city|harbour bay/i.test(x));
  ok('no sentence names a player without naming a club',
     unattributed.length === 0, unattributed.join(' || '));

  /* clauses that already contain "and" are not joined with another "and" */
  const chained = paras.filter(x => (x.match(/ and /g) || []).length >= 3);
  ok('clauses are not chained with three or more "and"s',
     chained.length === 0, chained.join(' || '));

  /* a club that loses players to fouls says so in its own clause */
  const dqLine = paras.find(x => /to fouls/.test(x));
  if (dqLine && /;/.test(dqLine)) {
    ok('each club\'s foul-outs carry their own "to fouls"',
       (dqLine.match(/to fouls/g) || []).length >= 2, dqLine);
  } else ok('each club\'s foul-outs carry their own "to fouls"', true);
}

/* a player is described once per sentence, not once per thing he did */
{
  const dual = Report.report(game({
    players: [mk('a1', 'alpha one', 0, { pts: 20, p2m: 4, p2a: 8, p3m: 4, p3a: 6, ast: 8 }),
              mk('b1', 'beta one', 1, { pts: 10, p2m: 4, p2a: 9 })],
    byId: {}
  }));
  const prose = dual.sections.flatMap(x => x.paras).join(' ');
  const perSentence = prose.split(/(?<=\.)\s+/).map(sn =>
    (sn.match(/Alpha One/g) || []).length);
  ok('one man is not named twice in the same sentence',
     Math.max(0, ...perSentence) <= 1, prose);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
