// THE BRIDGE FROM THE REPORT TO THE TABS. The match report reads the connections, play type + rebounds and shot clock tabs, and the
// edge function that files the article has to see exactly what the tabs show. Both build the report's brief with gamefacts.js
// tabInputs(); this runs the edge function's own copies (supabase/functions/_shared) on a real game, and requires them to give the
// browser's answers and to write the sections that depend on them.
//
//   node supabase/tests/tabbridge.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 240))); } };

const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
const load = async name => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(SHARED, name), 'utf8')).toString('base64'));

/* the edge function's imports, in its order: side effects put each calculator on globalThis */
await load('gamepct-data.js'); await load('gamepct.js'); await load('language.js'); await load('story.js');
const { report } = await load('report.js');
await load('possessions.js');
const SIT = await load('situations.js');
await load('connections.js'); await load('shotclock.js');
const { tabInputs } = await load('gamefacts.js');
const E = await load('engine.js');
const shared = { Sit: globalThis.EpinoiaSituations, Cn: globalThis.EpinoiaConnections, SC: globalThis.EpinoiaShotClock };

const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'game.json'), 'utf8'));

console.log('-- the shared copies are the tabs’ own calculators');
const T = tabInputs(game);
ok('the bridge answers for every tab on a real game', T.sits && T.sitPlayers && T.assists && T.connections && T.clock && T.atop, Object.keys(T).filter(k => !T[k]));
ok('connections: the pairs the tab draws', T.connections[0].length + T.connections[1].length > 5 && T.connections[0].every(c => c.assisterName && c.scorerName && c.count > 0));
ok('play type: each side’s buckets, and a line for every player', T.sits[0].all.chances > 0 && Object.keys(T.sitPlayers[0]).length > 5);
ok('shot clock: the first chances with the seconds they took, and each side’s time of possession', T.clock.chances.length > 100 && T.clock.chances.some(r => r.dur != null) && T.atop.every(x => x > 5 && x < 30), T.atop);
ok('the shared calculators are the browser’s (the same file, generated)', shared.Sit.compute === SIT.compute || typeof shared.Sit.compute === 'function');

console.log('-- and they give the browser’s answers');
{
  const B = {};
  B.Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
  const gf = require(path.join(ROOT, 'epinoia', 'game', 'gamefacts.js'));
  const browser = gf.tabInputs(game, { Sit: B.Sit, Cn: require(path.join(ROOT, 'epinoia', 'game', 'connections.js')), SC: require(path.join(ROOT, 'epinoia', 'shotclock.js')) });
  ok('sits and assists', JSON.stringify(browser.sits) === JSON.stringify(T.sits) && JSON.stringify(browser.assists) === JSON.stringify(T.assists));
  ok('connections', JSON.stringify(browser.connections) === JSON.stringify(T.connections));
  ok('shot clock and time of possession', JSON.stringify(browser.clock) === JSON.stringify(T.clock) && JSON.stringify(browser.atop) === JSON.stringify(T.atop));
}

console.log('-- a calculator that is missing leaves its field out and nothing else');
{
  const none = tabInputs(game, { Sit: {}, Cn: {}, SC: {} });
  ok('nothing loaded: every field null, no throw', Object.values(none).every(v => v === null), none);
  const broken = tabInputs(game, { Sit: { compute() { throw new Error('boom'); } }, Cn: shared.Cn, SC: shared.SC });
  ok('one that throws: only its fields are null', broken.sits === null && broken.connections && broken.clock, Object.keys(broken).filter(k => broken[k] === null));
}

console.log('-- the edge function’s brief and the report written from it');
{
  const { gameBrief } = await import(new URL('../functions/_shared/matchreport.ts', import.meta.url));
  const d = E.deriveGame(game);
  const TA = [E.teamAdv(game, d, 0), E.teamAdv(game, d, 1)];
  const brief = gameBrief(game, d, TA, E.lineupAgg, { leagueSlug: 'slb-men', competition: 'Championship', league: 'SLB', sits: T.sits }, T);
  ok('the brief carries the tabs’ inputs', brief.connections && brief.sitPlayers && brief.clock && brief.assists && brief.atop && brief.sits, Object.keys(brief).filter(k => brief[k] == null));
  const withTabs = report(brief);
  const headings = withTabs.sections.map(s => s.heading);
  ok('with them the report has the sections that read the tabs', ['How the ball moved', 'Play types and rebounds', 'The shot clock', 'What the four factors were worth'].every(h => headings.includes(h)), headings);
  const without = report(gameBrief(game, d, TA, E.lineupAgg, { leagueSlug: 'slb-men', competition: 'Championship', league: 'SLB' }, null));
  const h2 = without.sections.map(s => s.heading);
  ok('without them it does not write them, and still has the four factors', !h2.includes('How the ball moved') && !h2.includes('The shot clock') && h2.includes('What the four factors were worth'), h2);
  const { articleBody } = await import(new URL('../functions/_shared/matchreport.ts', import.meta.url));
  const strip = x => String(x).replace(/<[^>]*>/g, '');
  ok('the filed article leads with the lede: a specific headline and a standfirst that adds to it', /\d/.test(strip(withTabs.headline)) && strip(withTabs.standfirst).length > 20 && strip(withTabs.standfirst) !== strip(withTabs.headline), [withTabs.headline, withTabs.standfirst]);
  ok('...and the article body carries every section, starting with the headline’s own game', articleBody(withTabs, 'g1').filter(b => b.type === 'h2').length === withTabs.sections.length);
  ok('the article the server files is the article the page shows: same words for the same brief', JSON.stringify(report(brief).sections) === JSON.stringify(withTabs.sections));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
