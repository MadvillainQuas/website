// The game page's cards (epinoia/game/cards.js): the points added by each factor are strength of schedule's, the
// renderers hand their rows to the cards only where the module is loaded, and the scorer's own screens stay tables.
//
//   node supabase/tests/cards.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };
const src = readFileSync(path.join(ROOT, 'game', 'cards.js'), 'utf8');

/* load cards.js the way the page does, with the little it reads from the page */
const G = require(path.join(ROOT, 'gamepct.js'));
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, document: {}, console };
ctx.window.EpinoiaGamePct = G; ctx.window.EpinoiaBox = { safeColour: (v, f) => v || f }; ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(src, ctx);
const C = ctx.window.EpinoiaCards;

console.log('-- the weights are strength of schedule\'s');
const SOS = require(path.join(ROOT, 'sos.js'));
for (const [k, f] of Object.entries(C.FACTOR)) ok(k + ' weighs ' + f.w + ' points per 100 possessions per 1%', SOS.POINTS_PER_PCT[f.sos] === f.w, SOS.POINTS_PER_PCT[f.sos]);
ok('only turnovers count the other way round', C.FACTOR.tovp.inv && !C.FACTOR.efg.inv && !C.FACTOR.orebp.inv && !C.FACTOR.ftr.inv);

console.log('-- points added, worked by hand');
const S = { leagueSlug: 'slb-men' };
const mu = k => G.mean('team', k, 'slb-men');
const TA = [{ efg: 56, tovp: 12, orebp: 30, ftr: 30, possessions: 100 }, { efg: 48, tovp: 18, orebp: 25, ftr: 40, possessions: 50 }];
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok('efg: (efg - league) x 2.0, at 100 possessions', near(C.pointsAdded(S, TA, 'efg', 0), (56 - mu('efg')) * 2.0), C.pointsAdded(S, TA, 'efg', 0));
ok('tov: (league - tov) x 1.4', near(C.pointsAdded(S, TA, 'tovp', 0), (mu('tovp') - 12) * 1.4));
ok('oreb: x 0.7 and ft rate: x 0.4', near(C.pointsAdded(S, TA, 'orebp', 0), (30 - mu('orebp')) * 0.7) && near(C.pointsAdded(S, TA, 'ftr', 0), (30 - mu('ftr')) * 0.4));
ok('scaled to the side\'s possessions (50 is half of 100)', near(C.pointsAdded(S, TA, 'efg', 1), (48 - mu('efg')) * 2.0 * 0.5));
const noScale = { leagueSlug: 'nowhere-at-all' };
ok('an unknown league still has a scale (the default\'s)', G.mean('team', 'efg', 'nowhere-at-all') != null);
ok('a stat that is not a factor has no points added', C.pointsAdded(S, TA, 'ts', 0) === null);

console.log('-- the estimated margin (possession battle + scoring battle)');
{
  const H = { tov: 10, oreb: 12, efg: 55, ftr: 30, pts: 90 }, A = { tov: 14, oreb: 8, efg: 50, ftr: 20, pts: 80 };
  const B = C.battle([H, A]);
  const want = { tov: (14 - 10) * 1.1, oreb: (12 - 8) * 1.1, efg: (55 - 50) * 1.77 * 0.75, ftr: (30 - 20) * 0.25 * 0.75 };
  ok('turnovers and offensive rebounds are worth 1.1 points each', near(B.tov, want.tov) && near(B.oreb, want.oreb), [B.tov, B.oreb]);
  ok('efg is 1.77 and free throw rate 0.25 per point, over 75 possessions', near(B.efg, want.efg) && near(B.ftr, want.ftr), [B.efg, B.ftr]);
  ok('the estimate is the two battles together, and the actual margin sits beside it', near(B.estimated, want.tov + want.oreb + want.efg + want.ftr) && B.actual === 10 && near(B.possession + B.scoring, B.estimated));
}

console.log('-- the margin at the end of the game: real possessions when it is over, a predicted pace while it is on');
{
  const mk = (min, poss, pace) => [{ minutes: min * 5, possessions: poss, pace, tov: 5, oreb: 4, efg: 50, ftr: 25, pts: 40 }, { minutes: min * 5, possessions: poss, pace, tov: 8, oreb: 3, efg: 45, ftr: 20, pts: 35 }];
  const done = C.outlook({ status: 'final', leagueSlug: 'slb-men' }, mk(40, 84, 84));
  ok('a finished game uses its real possessions, and the counts as they were', done.final && near(done.poss, 84) && done.k === 1);
  const lgPace = G.mean('team', 'paceOwn', 'slb-men');
  const early = C.outlook({ status: 'live', leagueSlug: 'slb-men' }, mk(4, 10, 100));
  const frac = 4 / 40, wantPace = frac * 100 + (1 - frac) * lgPace;
  ok('early on, the pace is pulled towards the league average', !early.final && near(early.pace, wantPace) && early.pace < 100 && early.pace > lgPace, early.pace);
  ok('...and the game is run to its full length: poss = pace x 40 / 40, the counts carried forward by poss / so far', near(early.poss, wantPace) && near(early.k, wantPace / 10), early);
  const late = C.outlook({ status: 'live', leagueSlug: 'slb-men' }, mk(40, 84, 84));
  ok('by the final minute the pace is its own', near(late.pace, 84) && near(late.poss, 84));
  ok('nothing is drawn before a possession has been played', C.outlook({ status: 'live', leagueSlug: 'slb-men' }, mk(0, 0, 0)) === null);
  const B = C.battle(mk(40, 100, 100), 100, 2);
  ok('the possession battle is carried forward by k and the scoring battle worked over the possessions', near(B.tov, (8 - 5) * 1.1 * 2) && near(B.efg, 5 * 1.77 * 1.0), [B.tov, B.efg]);
}

console.log('-- a chart in a card, and the scorer untouched');
const html = C.chart('<div class="mrrow"></div>', { label: 'efg%', h: 56, a: 48, fmt: v => v.toFixed(1), hWin: true, aWin: false, k: 'efg', TA, S: { leagueSlug: 'slb-men', teams: [{ color: '#112233' }, { color: '#445566' }] }, tname: t => t < 0 ? '' : ['Home', 'Away'][t] });
ok('it is wrapped in a card with the difference under it', /class="fchart has-pa"/.test(html) && /\+8\.0 pp/.test(html) && /Home/.test(html), html.slice(0, 200));
ok('the four factors say how many points each side gained or lost', (html.match(/fpa-v/g) || []).length === 2 && /points added/.test(html));
const box = readFileSync(path.join(ROOT, 'boxscore.js'), 'utf8');
ok('boxscore.js hands its rows over only where EpinoiaCards exists', /globalThis\.EpinoiaCards/.test(box) && /CK && CK\.chart/.test(box) && /CK && CK\.players/.test(box) && /CK && CK\.box/.test(box));
const scorer = readFileSync(path.join(ROOT, 'score', 'index.html'), 'utf8');
ok('the scorer does not load cards.js', !/<script[^>]*cards\.js/.test(scorer));
const page = readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');
ok('the game page loads cards.js and cards.css', /cards\.js\?v=/.test(page) && /cards\.css\?v=/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
