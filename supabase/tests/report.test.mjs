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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
