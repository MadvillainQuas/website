/* ============================================================================
   THE WOWY PAGE'S PLAY-BY-PLAY LAYER (epinoia/lineupevents.js over the engine, possessions.js, situations.js and
   shotclock.js), pure, on a synthetic game worked out by hand.

     node supabase/tests/wowy-events.test.mjs

   Held: every play goes to both fives on the floor, with the stints' own boundaries; who the opponent had on is
   bucketed (starters / mixed / bench) and a game without its starters counts in none; each new stat is the
   formula on hand-computed counts (zones, assisted shares, transition against half court, pace per 40, the average
   shot clock, heliocentrism's bounds and known cases, rebound origins adding to 100); deltas turn by direction;
   the page gates the log to members, keeps pairs and WOWY apart and round-trips the new switches.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
globalThis.EpinoiaLineups = require(path.join(ROOT, 'epinoia/lineups.js'));
const LE = require(path.join(ROOT, 'epinoia/lineupevents.js'));
const W = require(path.join(ROOT, 'epinoia/wowylogic.js'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : ''}`); };
const near = (a, b, e) => typeof a === 'number' && Math.abs(a - b) <= (e == null ? 0.051 : e);

/* ------------------------------------------------------- the synthetic game ---
   One ten-minute period. Home A1..A5, away B1..B5; at 9:00 the away side brings B6 on for B1 (four starters on).

     10:00  period start
      9:50  A1 two at the rim (marker in the paint), assisted by A2          home 2-0   (poss: from the tip, 10 s)
      9:35  B1 misses a three; A3 rebounds at 9:33                                       (away poss 15 s)
      9:28  A1 two from mid-range, 5 s after the defensive rebound: TRANSITION  4-0     (home poss 5 s)
      9:20  B2 turnover, A2 steal                                                        (away poss 8 s)
      9:00  A4 three, assisted by A5 (20 s after the steal: half court)       7-0       (home poss 20 s)
      9:00  sub: B6 on for B1
      8:50  B2 misses at the rim; B3 offensive rebound 8:49; B3 scores at the rim 8:48  7-2 (away poss 12 s)
      8:40  foul on A1; A1 makes one of two; B4 rebounds the miss                8-2   (home poss 8 s) */
const A = ['A1', 'A2', 'A3', 'A4', 'A5'], B = ['B1', 'B2', 'B3', 'B4', 'B5'];
let seq = 0;
const ev = (t, o) => Object.assign({ t, id: ++seq, seq, period: 1 }, o);
const s = sec => sec * 1000;
const events = [
  ev('period_start', { clock: s(600) }),
  ev('p2_made', { team: 0, pid: 'A1', clock: s(590) }), ev('loc', { ref: 2, x: 0.5, y: 0.1, clock: s(590) }), ev('ast', { team: 0, pid: 'A2', clock: s(590) }),
  ev('p3_miss', { team: 1, pid: 'B1', clock: s(575) }),
  ev('reb', { team: 0, pid: 'A3', off: false, clock: s(573) }),
  ev('p2_made', { team: 0, pid: 'A1', clock: s(568) }), ev('loc', { ref: 7, x: 0.5, y: 0.6, clock: s(568) }),
  ev('to', { team: 1, pid: 'B2', clock: s(560) }), ev('stl', { team: 0, pid: 'A2', clock: s(560) }),
  ev('p3_made', { team: 0, pid: 'A4', clock: s(540) }), ev('loc', { ref: 11, x: 0.9, y: 0.5, clock: s(540) }), ev('ast', { team: 0, pid: 'A5', clock: s(540) }),
  ev('sub', { team: 1, in: 'B6', out: 'B1', clock: s(540) }),
  ev('p2_miss', { team: 1, pid: 'B2', clock: s(530) }), ev('loc', { ref: 15, x: 0.5, y: 0.1, clock: s(530) }),
  ev('reb', { team: 1, pid: 'B3', off: true, clock: s(529) }),
  ev('p2_made', { team: 1, pid: 'B3', clock: s(528) }), ev('loc', { ref: 18, x: 0.5, y: 0.1, clock: s(528) }),
  ev('foul', { team: 1, pid: 'B4', kind: 'shooting', clock: s(520) }),
  ev('ft_made', { team: 0, pid: 'A1', clock: s(520) }), ev('ft_miss', { team: 0, pid: 'A1', clock: s(520) }),
  ev('reb', { team: 1, pid: 'B4', off: false, clock: s(519) }),
  ev('game_end', { clock: 0 })
];
const G = LE.gameSegments({ id: 'g1', starters: [A, B], events, period: 1 });

console.log('attribution: every play to both fives, cut where the stints are cut');
ok('the game replays', G.ok, G.reason);
ok('two segments: the starters for 60 s, then four away starters for 540 s', G.segs.length === 2 && G.segs[0].dur === 60000 && G.segs[1].dur === 540000, G.segs.map(x => x.dur));
ok('...each carrying BOTH fives', G.segs[0].ids[1].join() === 'B1,B2,B3,B4,B5' && G.segs[1].ids[1].join() === 'B2,B3,B4,B5,B6' && G.segs.every(x => x.ids[0].join() === A.join()));
const home = LE.recordsOf(G, 0), away = LE.recordsOf(G, 1);
ok('the first segment\'s plays are the home side\'s 7 points and the away side\'s miss and turnover', home[0].own.pts === 7 && home[0].own.fga === 3 && home[0].opp.fga === 1 && home[0].opp.tov === 1);
ok('the second\'s: home 1 point from two free throws, away 2 from a putback', home[1].own.pts === 1 && home[1].own.fta === 2 && home[1].own.ftm === 1 && away[1].own.pts === 2 && away[1].own.or === 1);
ok('a side\'s record is the other\'s mirror', home[0].own === away[0].opp && home[1].opp === away[1].own);
ok('the whole game adds up to the score, 8-2 in 10 minutes', (() => { const l = LE.line(LE.sum(home)); return l.pf === 8 && l.pa === 2 && l.mins === 10 && l.pm === 6; })());
ok('and the engine\'s own stints agree to the millisecond (lineupAgg over the same log)', (() => {
  const E = require(path.join(ROOT, 'epinoia/engine.js'));
  const d = E.deriveGame({ teams: [{ players: [] }, { players: [] }], starters: [A, B], events: events.slice(), period: 1, clockMs: 0 });
  const st = E.lineupAgg(d, 1);
  return st.length === 2 && st.find(x => x.ids.join() === 'B1,B2,B3,B4,B5').dur === 60000 && st.find(x => x.ids.join() === 'B2,B3,B4,B5,B6').pf === 2;
})());

console.log('\nwho the opponent had on');
ok('starters: all five of that game\'s on = 5; after the sub, 4', home[0].ost === 5 && home[1].ost === 4);
ok('buckets: starters, then mixed; nothing is bench', LE.bucketOf(home[0]) === 'start' && LE.bucketOf(home[1]) === 'mixed' && LE.inBucket(home, 'bench').length === 0);
ok('0-2 starters is bench', LE.bucketOf({ ost: 2 }) === 'bench' && LE.bucketOf({ ost: 0 }) === 'bench' && LE.bucketOf({ ost: 3 }) === 'mixed');
ok('against the starting five: 1 minute, 7-0', (() => { const l = LE.line(LE.sum(LE.inBucket(home, 'start'))); return l.mins === 1 && l.pf === 7 && l.pa === 0; })());
const G2 = LE.gameSegments({ id: 'g2', starters: [A, B.slice(0, 4)], events, period: 1 });
ok('a game whose opponent five is not whole is in no bucket, and still counts for All', G2.ok && LE.recordsOf(G2, 0).every(r => r.ost === null && LE.bucketOf(r) === null) && LE.inBucket(LE.recordsOf(G2, 0), 'start').length === 0 && LE.inBucket(LE.recordsOf(G2, 0), 'all').length === 2);
ok('a game with no starters at all is not replayed (nobody is known to be on)', LE.gameSegments({ id: 'g3', starters: null, events }).ok === false && LE.gameSegments({ id: 'g4', starters: [A, B], events: [] }).ok === false);
ok('a stint record carries no opponent, so it is in no bucket', LE.fromStints([{ player_ids: A, stats: { dur: 1, off: {}, def: {} } }]).every(r => r.ost === null && !r.ev));

console.log('\nthe new stats, by hand');
const H = LE.line(LE.sum(home)), Aw = LE.line(LE.sum(away));
ok('zones: rim 1/1, mid 1/1, three 1/1 (the marker decides: y .1 in the key is the rim, y .6 mid-range)', H.rimfg === 100 && H.midfg === 100 && H.p3 === 100 && H._ev.rimA === 1 && H._ev.midA === 1);
ok('assisted: the rim make and the three were, the mid-range one was not', H.rimast === 100 && H.midast === 0 && H.p3ast === 100);
const hp = 0.96 * (3 + 0.44 * 2);
ok('per 100: one rim attempt over 0.96 × (3 FGA + 0.44 × 2 FTA) possessions', near(H.rim100, Math.round(100 / hp * 10) / 10) && near(H.p3a100, Math.round(100 / hp * 10) / 10));
ok('PACE per 40: those possessions over 10 minutes × 40', near(H.pace40, Math.round(hp / 10 * 40 * 10) / 10), H.pace40);
ok('transition: 1 of the 4 home possessions (the two 5 s after the rebound), 2 points = 2.00 PPP', H.trfreq === 25 && H.trppp === 2 && H._ev.pn === 4 && H._ev.trN === 1);
ok('half court: the other 3, 2 + 3 + 1 points = 2.00 PPP, and the two frequencies make 100', H.hcfreq === 75 && H.hcppp === 2 && H.trfreq + H.hcfreq === 100);
ok('the away side ran no transition: its 3 possessions are all half court', Aw.trfreq === 0 && Aw.hcfreq === 100 && Aw.trppp === null && Aw._ev.pn === 3);
ok('avg shot clock: home (10 + 5 + 20 + 8) / 4 = 10.8 s; away (15 + 8 + 12) / 3 = 11.7 s', H.sclock === 10.8 && Aw.sclock === 11.7, [H.sclock, Aw.sclock]);
ok('rebound origins: the home DRB came off a missed three (100%); the away ORB off its own rim miss', H.drb3 === 100 && H.drbR === 0 && H.drbM === 0 && Aw.orbR === 100);
ok('...and a missed free throw\'s rebound is no zone\'s (the away DRB after A1\'s miss is not counted)', Aw._ev.rebD === 0 && Aw.drbR === null);
ok('rebound-origin shares add up to 100 where there is any', near(H.drbR + H.drbM + H.drb3, 100) && near(Aw.orbR + Aw.orbM + Aw.orb3, 100));

console.log('\nheliocentrism');
const five = 'A1,A2,A3,A4,A5';
const U = o => { const u = {}; Object.keys(o).forEach(p => { u[five + '|' + p] = o[p]; }); return u; };
ok('one man uses every play: 100', LE.helio(U({ A1: 20 })).v === 100);
ok('five equal hands: 0', LE.helio(U({ A1: 4, A2: 4, A3: 4, A4: 4, A5: 4 })).v === 0);
ok('40% and four at 15%: 25 (the load shared like 4 equal hands)', LE.helio(U({ A1: 8, A2: 3, A3: 3, A4: 3, A5: 3 })).v === 25 && LE.helio(U({ A1: 8, A2: 3, A3: 3, A4: 3, A5: 3 })).eff === 4);
ok('50% and four at 12.5%: 45', near(LE.helio(U({ A1: 8, A2: 2, A3: 2, A4: 2, A5: 2 })).v, 45, 0.1));
ok('the top user and his share ride along', (() => { const h = LE.helio(U({ A1: 8, A2: 3, A3: 3, A4: 3, A5: 3 })); return h.top === 'A1' && h.share === 40; })());
ok('under 10 used plays it says nothing', LE.helio(U({ A1: 5, A2: 4 })).v === null);
ok('always inside 0..100, whatever the mix of fives', (() => {
  for (let i = 0; i < 200; i++) {
    const u = {}; const n = 1 + (i % 4);
    for (let f = 0; f < n; f++) ['P' + f, 'Q' + f, 'R', 'S', 'T'].forEach((p, j) => { u[['P' + f, 'Q' + f, 'R', 'S', 'T'].join(',') + '|' + p] = ((i * 7 + j * 13 + f) % 11) + (j === 0 ? i % 5 : 0); });
    const v = LE.helio(u).v; if (v != null && (v < 0 || v > 100)) return false;
  }
  return true;
})());
ok('usage is pooled over every five a man was in: a star at 40% everywhere reads 25 across two fives too', (() => {
  const u = { 'A1,A2,A3,A4,A5|A1': 8, 'A1,A2,A3,A4,A5|A2': 3, 'A1,A2,A3,A4,A5|A3': 3, 'A1,A2,A3,A4,A5|A4': 3, 'A1,A2,A3,A4,A5|A5': 3,
              'A1,A2,A3,A4,A6|A1': 8, 'A1,A2,A3,A4,A6|A2': 3, 'A1,A2,A3,A4,A6|A3': 3, 'A1,A2,A3,A4,A6|A4': 3, 'A1,A2,A3,A4,A6|A6': 3 };
  return LE.helio(u).v === 25;
})());
ok('explained where the site explains its stats', /helio:\s*e\('Heliocentrism'/.test(read('epinoia/statinfo.js')));

console.log('\ndeltas: this slice minus the rest, turned by direction');
ok('a unit against the rest: minus() is the team without it, and the two add back', (() => { const tot = LE.sum(home), u = LE.sum(home, r => r.ost === 5); const rest = LE.minus(tot, u); return rest.dur === 540000 && rest.own.pts === 1 && LE.line(rest).mins === 9; })());
ok('lower-is-better: DRTG 100 against 105 is good', W.delta('drtg', { drtg: 100 }, { drtg: 105 }).good > 0 && W.delta('drtg', { drtg: 100 }, { drtg: 105 }).arrow === '▼');
ok('higher-is-better: NET +5 against -2 is good, and signed', W.delta('net', { net: 5 }, { net: -2 }).d === 7 && W.delta('net', { net: 5 }, { net: -2 }).good > 0 && W.fmtDelta('net', 7) === '+7.0');
ok('a style stat has a direction of change and no verdict', W.delta('pace40', { pace40: 70 }, { pace40: 72 }).good === null && W.delta('pace40', { pace40: 70 }, { pace40: 72 }).arrow === '▼');
ok('PPP deltas keep two decimals', W.delta('trppp', { trppp: 1.25 }, { trppp: 1.1 }).d === 0.15 && W.fmtDelta('trppp', 0.15) === '+0.15');
ok('no value on either side, no delta', W.delta('rimfg', { rimfg: null }, { rimfg: 50 }).d === null);

console.log('\ncache format');
ok('a game packs for sessionStorage and comes back the same', (() => { const b = LE.unpack(JSON.parse(JSON.stringify(LE.pack(G)))); return JSON.stringify(LE.line(LE.sum(LE.recordsOf(b, 0)))) === JSON.stringify(H); })());
ok('a pack from another version is refused', LE.unpack({ v: 999, s: [] }) === null);

console.log('\nthe page: gating, tabs, address');
const js = read('epinoia/stats/wowy/wowy.js'), ui = read('epinoia/stats/wowy/wowyui.js'), html = read('epinoia/stats/wowy/index.html');
ok('a preview never reads the log: ensureEvents stops at the gate, and the with-panel returns before any read', /function ensureEvents\(t\) \{\s*if \(preview \|\| !t/.test(js) && /if \(preview\) \{[\s\S]{0,900}?return;\s*\}[\s\S]*?D\.events\(need\)/.test(js.slice(js.indexOf('async function drawWith'))));
ok('the event reads are only in segmentsOf and the with-panel', (js.match(/D\.events\(/g) || []).length === 2);
ok('a preview is held to All (no vs-starters), wherever the address says', /if \(preview\) state\.vs = 'all'/.test(js) && /const bucket = \(\) => \(preview \? 'all'/.test(js));
ok('locked play-by-play cells, switches and the tab wear memlock.js\'s lock', /EpinoiaMemLock/.test(ui) && /lockIt\(ctx, b, 'The vs-starters split'\)/.test(ui) && /M\.placeholder\(/.test(ui) && /src="\.\.\/\.\.\/memlock\.js/.test(html));
ok('pairs and WOWY are separate tabs: pairs has no combinations, WOWY has them', (() => {
  const pair = ui.slice(ui.indexOf('function pairView'), ui.indexOf('function wowyView'));
  const wowy = ui.slice(ui.indexOf('function wowyView'), ui.indexOf('function vsView'));
  return !/matrixRows/.test(pair) && /pairRows/.test(pair) && /matrixRows/.test(wowy) && /id="pair"/.test(html) && /id="wowy"/.test(html) && /id="vs"/.test(html);
})());
ok('every section carries the against switch', ['function overviewView', 'function lineupsView', 'function onOffView', 'function pairView', 'function wowyView', 'function vsView', 'function buildView']
  .every(f => { const i = ui.indexOf(f); const body = ui.slice(i, ui.indexOf('\nfunction ', i + 10)); return /facedBar\(ctx/.test(body); }));
ok('the play-by-play layer loads before the page, after its rules', ['engine.js', 'possessions.js', 'situations.js', 'shotclock.js', 'lineupevents.js'].every((f, i, a) => html.indexOf(f + '?v=') > 0 && (i === 0 || html.indexOf(a[i - 1] + '?v=') < html.indexOf(f + '?v='))) && html.indexOf('lineupevents.js?v=') < html.indexOf('src="wowy.js'));
const rt = W.encodeState({ v: 'wowy', vs: 'mixed', lay: 'table', dm: 'values', w: ['A1', 'A2', 'A3'] }, '?l=slb-men');
const back = W.decodeState(rt);
ok('the new switches round-trip in the address', back.v === 'wowy' && back.vs === 'mixed' && back.lay === 'table' && back.dm === 'values' && back.w.join() === 'A1,A2,A3' && /l=slb-men/.test(rt), rt);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
