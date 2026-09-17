/* ============================================================================
   GAME PERCENTILES — the preset a box score reads its numbers against.

   epinoia/gamepct.js has the rules (gated, shrunk on a small sample, weighted to
   season averages), epinoia/gamepct-data.js the scales tools/build-gamepct.mjs
   built from a season of real games. These hold:

     the preset       every stat the pages colour has a scale, each scale is a
                      proper one (rising, finite), and the league averages are
                      basketball, not a broken rebuild
     the reading      direction, the neutral stats, the gate, the small-sample
                      cap, the shrink, the defence view's flip, the league
                      fallback, a live game's counts
     the pages        on a real LiveStats game the full stats and the events tab
                      shade their numbers when the scales are loaded and draw
                      exactly as before when they are not; the game page loads
                      the scales, its theme carries the kit's zoom to the letter,
                      and asks for the league's colours

     node supabase/tests/gamepct.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const GP = require(path.join(ROOT, 'epinoia', 'gamepct.js'));
const DATA = require(path.join(ROOT, 'epinoia', 'gamepct-data.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const median = q => q[GP.GRID.indexOf(50)];

/* ------------------------------------------------------------------ preset --- */
console.log('\nthe preset');
{
  ok('two leagues built, SLB the fallback', !!DATA.leagues['slb-men'] && !!DATA.leagues.bcb && DATA.fallback === 'slb-men');
  ok('the grid the data was built on is the one gamepct.js reads', JSON.stringify(DATA.grid) === JSON.stringify(GP.GRID));
  ['slb-men', 'bcb'].forEach(lg => {
    const L = DATA.leagues[lg];
    const need = ['team', 'player', 'sit'].flatMap(sc => Object.keys(GP.SCOPES[sc]).map(k => [sc, k]));
    const missing = need.filter(([sc, k]) => !(L[sc] && L[sc][k])).map(x => x.join('.'));
    ok(lg + ': every team, player and situation stat the pages colour has a scale', !missing.length, missing.join(', '));
    ok(lg + ': the zone and player-situation scales are there for every whole-game split',
      ['team', 'player'].every(w => ['rim', 'mid', 'three', 'all'].every(z => L.zone[w + '.all.' + z])) && !!L.psit['all.efg']);
    const bad = [];
    Object.keys(L).filter(sc => GP.SCOPES[sc]).forEach(sc => Object.entries(L[sc]).forEach(([k, s]) => {
      if (!GP.SCOPES[sc][k]) bad.push(sc + '.' + k + ' is not a stat');
      else if (!Array.isArray(s.q) || s.q.length !== GP.GRID.length || !s.q.every(Number.isFinite)) bad.push(sc + '.' + k + ' malformed');
      else if (s.q.some((v, i) => i && v < s.q[i - 1])) bad.push(sc + '.' + k + ' falls');
      else if (!Number.isFinite(s.mu)) bad.push(sc + '.' + k + ' has no average');
    }));
    ok(lg + ': every scale is a stat of gamepct.js, rising, finite, with an average', !bad.length, bad.slice(0, 5).join('; '));
  });
  const S0 = DATA.leagues['slb-men'];
  const within = (v, lo, hi) => v >= lo && v <= hi;
  ok('SLB\'s middles are basketball: team eFG% ' + median(S0.team.efg.q) + ', ORtg ' + median(S0.team.ortg.q) + ', TOV% ' + median(S0.team.tovp.q) +
     ', player TS% ' + median(S0.player.ts.q) + ', points per chance ' + median(S0.sit['all.ppp'].q),
     within(median(S0.team.efg.q), 47, 58) && within(median(S0.team.ortg.q), 98, 125) && within(median(S0.team.tovp.q), 10, 20) &&
     within(median(S0.player.ts.q), 48, 62) && within(median(S0.sit['all.ppp'].q), 0.8, 1.15));
  ok('...and the spread is a season\'s, not a single game\'s alone: team eFG% p10-p90 inside 44-62',
     S0.team.efg.q[GP.GRID.indexOf(10)] > 44 && S0.team.efg.q[GP.GRID.indexOf(90)] < 62);
  ok('BCB shoots worse than SLB, and its scale says so', median(DATA.leagues.bcb.team.efg.q) < median(S0.team.efg.q));
}

/* ----------------------------------------------------------------- reading --- */
console.log('\nreading a number');
{
  const q = [10, 20, 30, 30, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
  ok('below the scale is 0.5, above it 99.5', GP.percentileOf(q, 5) === 0.5 && GP.percentileOf(q, 500) === 99.5);
  ok('on a stored point, that point\'s percentile', GP.percentileOf(q, 100) === 50);
  ok('between two, the straight line', Math.abs(GP.percentileOf(q, 105) - 52.5) < 1e-9);
  ok('a plateau many games share reads at its middle', GP.percentileOf(q, 30) === 10);

  const team = (efg, fga, tovp) => ({ T: { efg, fga, fta: 20, tov: 12, tovp, minutes: 200, possessions: 75 }, O: {}, c: {} });
  const hi = GP.rate('team', 'efg', team(61, 70), { league: 'slb-men' });
  const lo = GP.rate('team', 'efg', team(42, 70), { league: 'slb-men' });
  ok('a 61% eFG game is a top band, a 42% one a bottom band', hi.band >= 5 && lo.band <= 1, hi.band + ' / ' + lo.band);
  const tGood = GP.rate('team', 'tovp', team(50, 70, 8), { league: 'slb-men' });
  const tBad = GP.rate('team', 'tovp', team(50, 70, 24), { league: 'slb-men' });
  ok('less is better for a turnover rate: 8% is green, 24% red, and the percentile is of goodness',
     tGood.band >= 5 && tBad.band <= 1 && tGood.g === 100 - tGood.p, [tGood.g, tBad.g].join(' / '));

  const pl = (a, x) => ({ a, x: Object.assign({ p2a: 0, p3a: 0, fta: 0, to: 0, oc: {} }, x), TT: { minutes: 200, fgm: 30, oreb: 10, dreb: 25, fga: 70, fta: 20, tov: 12, fg3a: 25 }, OT: { minutes: 200, oreb: 10, dreb: 25, fga: 70, fta: 20, tov: 12, fg3a: 25 } });
  const usg = GP.rate('player', 'usg', pl({ usg: 30, min: 30 }, {}), { league: 'slb-men' });
  ok('usage is a style: a percentile, no colour', usg && usg.band == null && usg.d === 0 && usg.p > 50);
  ok('no shots, no true shooting percentile', GP.rate('player', 'ts', pl({ ts: 0 }, {}), { league: 'slb-men' }) === null);
  ok('one three, made, is under the gate', GP.rate('player', 'p3P', pl({ p3P: 100 }, { p3a: 1 }), { league: 'slb-men' }) === null);
  const twoTwo = GP.rate('player', 'p3P', pl({ p3P: 100 }, { p3a: 2 }), { league: 'slb-men' });
  ok('two for two is read, but a sample under k cannot reach an outer band', twoTwo && twoTwo.small && twoTwo.g <= 89 && twoTwo.band <= 5, JSON.stringify(twoTwo));
  const ts3 = GP.rate('player', 'ts', pl({ ts: 70 }, { p2a: 3 }), { league: 'slb-men' });
  const ts20 = GP.rate('player', 'ts', pl({ ts: 70 }, { p2a: 18, fta: 5 }), { league: 'slb-men' });
  ok('the same 70% TS on twenty shots reads higher than on three (' + Math.round(ts20.g) + ' v ' + Math.round(ts3.g) + ')', ts20.g > ts3.g);

  const sit = { s: { ppp: 1.3, chances: 90, efg: 0.6, fga: 70, tovPct: 0.1 } };
  const off = GP.rate('sit', 'all.ppp', sit, { league: 'slb-men' });
  const def = GP.rate('sit', 'all.ppp', sit, { league: 'slb-men', flip: true });
  ok('the defence view turns the direction round: 1.30 per chance is great for the side, poor for its opponent',
     off.band === 6 && def.band === 0 && Math.abs(off.g + def.g - 100) < 1e-9, off.g + ' / ' + def.g);

  ok('SLB women and an unknown league read SLB men\'s scales; BCB its own',
     GP.leagueKey('slb-women') === 'slb-men' && GP.leagueKey('nobody') === 'slb-men' && GP.leagueKey(null) === 'slb-men' && GP.leagueKey('bcb') === 'bcb');

  const st = GP.TEAM.paint, mu = DATA.leagues['slb-men'].team.paint.mu;
  ok('a count at half time is its tally plus a league-average second half', Math.abs(GP.adjusted(st, 20, 20, mu) - (20 + mu / 2)) < 1e-9);
  ok('...and a finished game in overtime is read per forty minutes', Math.abs(GP.adjusted(st, 45, 45, mu) - 40) < 1e-9);
  ok('ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 101st',
     [1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(GP.ord).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 101st');
}

/* ------------------------------------------------------------------- pages --- */
console.log('\nthe pages, on a real LiveStats game');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'sys.stdout.write(json.dumps(translate(raw, lambda team, pno: "%s:%s" % (team, pno))))'
  ].join('\n');
  const feed = path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702542.json');
  let T = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), feed], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
  }
  ok('the feed translates', !!T);
  if (T) {
    const engineSrc = read('supabase', 'functions', '_shared', 'engine.js');
    const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));
    const B = require(path.join(ROOT, 'epinoia', 'boxscore.js'));
    const Ev = require(path.join(ROOT, 'epinoia', 'game', 'events.js'));
    const G = {
      teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0, status: 'final', phase: 'final', leagueSlug: 'slb-men',
      events: T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    globalThis.S = G; globalThis.derive = () => d;

    delete globalThis.EpinoiaGamePct;
    const plainAdv = B.advHTML(d);
    Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
    const plainEv = Ev.render(G);
    ok('without the scales, full stats and events carry no shading', !/gp-b\d|gp-pc|percentile against/.test(plainAdv + plainEv));

    globalThis.EpinoiaGamePct = GP;
    const adv = B.advHTML(d);
    const ffShaded = (adv.match(/class="ffval[^"]* gp gp-b\d"/g) || []).length;
    ok('full stats: the four factors and additional metrics shade each side\'s figure (' + ffShaded + ')', ffShaded >= 50);
    const neutral = adv.match(/<span class="ffval( r)?( winner)?" title="(possessions|pace \/ 40): \d+(st|nd|rd|th) percentile[^"]*">[\d.]+<i class="gp-pc">\d+<\/i><\/span>/g) || [];
    ok('...possessions and pace carry a percentile but no colour (' + neutral.length + ' of 4)', neutral.length === 4);
    const cells = (adv.match(/<td class="[^"]*gp gp-b\d"/g) || []).length;
    ok('full stats: the player tables shade their rate columns (' + cells + ' cells)', cells > 100);
    ok('...and never a counting column', !/<td [^>]*title="(made|ast|pts|\+ast|tpc|min|rim|mid|3pt): /.test(adv));
    ok('...and say what the shading is', /shaded cells: the rate’s percentile against SLB 2025-26 games/.test(adv));
    ok('...the markup around the shading is what it was: strip the shading and the tables are the plain ones',
       adv.replace(/ gp gp-b\d/g, '').replace(/ title="[^"]*"/g, '').replace(/<i class="gp-pc[^"]*">\d+<\/i>/g, '')
          .replace(/<div class="setup-note gpnote">[^<]*<\/div>/, '').replace(/ · shaded cells:[^<]*/g, '').replace(/<span class="">([^<]*)<\/span>/g, '$1') ===
       plainAdv.replace(/ title="[^"]*"/g, ''));

    Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
    const ev = Ev.render(G);
    ok('events: the lede shades points per chance, eFG% and turnovers',
       /<b class="gp gp-b\d" title="points per chance: [^"]+">[\d.]+<\/b> points per chance, <span class="gp gp-b\d" title="eFG%[^"]*">[\d.]+%<\/span> eFG, <span class="gp gp-b\d" title="turnover rate[^"]*">\d+%<\/span> turnovers/.test(ev));
    ok('events: every situation row carries its percentiles in its tooltip', (ev.match(/data-tip="[^"]*points per (chance|possession): \d+(st|nd|rd|th) percentile/g) || []).length >= 5);
    const ledeBand = h => +/<b class="gp gp-b(\d)" title="points per chance/.exec(h)[1];
    const offBand = ledeBand(ev);
    Ev.setView({ team: 1, side: 'def', sit: 'second', pid: null });
    const defBand = ledeBand(Ev.render(G));
    ok('events: the same offence read as the other side\'s defence mirrors its band (' + offBand + ' -> ' + defBand + ')', Math.abs(offBand + defBand - 6) <= 1);
    Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
    delete globalThis.EpinoiaGamePct;
  }
}

/* ------------------------------------------------------------- game page --- */
console.log('\nthe game page');
{
  const html = read('epinoia', 'game', 'index.html');
  const at = s => html.indexOf(s);
  ok('loads the scales before the module that reads them, both before game.js',
     at('../gamepct-data.js') > 0 && at('../gamepct-data.js') < at('../gamepct.js') && at('../gamepct.js') < at('game.js?v'));
  ok('loads theme.css last among the stylesheets', at('theme.css?v') > at('../kit/nav.css') && at('theme.css?v') < at('<style>'));
  const kit = read('epinoia', 'kit', 'epinoia-kit.css');
  const theme = read('epinoia', 'game', 'theme.css');
  const zooms = kit.match(/@media \(min-width:\d+px\)\{ body\{ zoom:[\d.]+ \} \}/g) || [];
  ok('theme.css carries the kit\'s zoom steps to the letter (' + zooms.length + ')', zooms.length === 2 && zooms.every(z => theme.includes(z)));
  ok('the league\'s colours paint the tabs, the switches and the ground', /body\.league-themed \.tabbtn\.on/.test(theme) && /body\.league-themed \.mv-switch button\.on/.test(theme) && /body\.league-themed\{[\s\S]*?background:/.test(theme));
  ok('the shading is --good and --bad, never the league\'s colour', /\.gp-b6\{ --gp:color-mix\(in oklch,var\(--good\)/.test(theme) && !/\.gp-b\d\{[^}]*--lume/.test(theme));
  ok('the statistics pages\' heat and chips are green for good on a league\'s or club\'s own page too',
     /heatStyle[\s\S]{0,600}var\(--good\) 34%/.test(read('epinoia', 'fulltable.js')) && /\.sp-pct\.b3\{--sp-b:var\(--good\)\}/.test(read('epinoia', 'kit', 'sitpanel.css')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
