/* ============================================================================
   REBOUNDS OFF EACH ZONE'S MISSES -- epinoia/situations.js, the events tab and the club profile.

   Every missed field goal is followed by the first rebound that comes before anything else happens to the
   ball; the zone it was shot from (rim, mid, three: the box score's rule) keeps whose rebound it was, the
   shooter's own side (offensive) or the other side's (defensive). These check the rule on a log small enough
   to work out by hand (every way a miss can end), that the side's zone cells and reboundZones() agree, what
   the events tab draws from them, and on a real LiveStats game that nothing is lost or invented.

     node supabase/tests/rebound-zones.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
const Ev = require(path.join(ROOT, 'epinoia', 'game', 'events.js'));
globalThis.EpinoiaBox = require(path.join(ROOT, 'epinoia', 'boxscore.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };

/* ---- a game, every way a miss can end -------------------------------------- */
let seq = 0;
const log = [];
const ev = (t, team, pid, clock, extra, period) => { const s = ++seq; log.push(Object.assign({ id: s, seq: s, t, team, pid, period: period || 1, clock }, extra || {})); return s; };
const desc = (t, ref, extra) => { const s = ++seq; log.push(Object.assign({ id: s, seq: s, t, team: null, pid: null, period: 1, clock: null, ref }, extra)); };

ev('period_start', null, null, 600000);
const m1 = ev('p2_miss', 0, 'h1', 590000); desc('stype', m1, { v: 'layup' });          // 1  rim, own rebound
ev('reb', 0, 'h2', 589000, { off: true });
const m2 = ev('p2_miss', 0, 'h2', 585000); desc('stype', m2, { v: 'dunk' });           // 2  rim, the other side's
ev('blk', 1, 'a1', 585000);                                                             //    a block between the miss and the rebound
ev('reb', 1, 'a2', 583000, { off: false });
const m3 = ev('p2_miss', 1, 'a3', 570000); desc('stype', m3, { v: 'jump shot' });       // 3  mid, the other side's (team rebound)
ev('reb', 0, null, 568000, { off: false });
ev('p3_miss', 0, 'h3', 560000);                                                         // 4  three, own rebound
ev('reb', 0, 'h4', 558000, { off: true });
ev('p3_miss', 0, 'h4', 550000);                                                         // 5  three, no rebound: the next thing is a turnover
ev('to', 1, 'a4', 545000);
const m6 = ev('p2_miss', 1, 'a5', 530000); desc('stype', m6, { v: 'layup' });           // 6  rim, drew a foul and free throws: none
ev('foul', 0, 'h5', 530000, { kind: 'shooting' });
ev('ft_miss', 1, 'a5', 530000);                                                         //    (this missed free throw is not a field goal)
ev('reb', 0, 'h5', 528000, { off: false });                                             //    ...and its rebound is nobody's zone
ev('p2_miss', 0, 'h1', 510000);                                                         // 7  mid (untyped, unlocated), no rebound: the next thing is a shot
ev('p2_made', 1, 'a1', 500000);
const m8 = ev('p2_miss', 1, 'a2', 480000); desc('stype', m8, { v: 'jump shot' });        // 8  mid, none: the period ends
ev('period_start', null, null, 600000, null, 2);
ev('reb', 1, 'a3', 595000, { off: true }, 2);                                           //    a rebound in the next period belongs to nothing above
ev('p3_miss', 1, 'a4', 590000, null, 2);                                                // 9  three, a rebound with no team: none
ev('reb', null, null, 588000, { off: false }, 2);

const S = { teams: [{ name: 'Leeds Force', players: [] }, { name: 'Hull Pirates', players: [] }], events: log };

console.log('\nwhat became of each miss, worked out by hand');
{
  const plays = log.filter(e => !/^(loc|tag|stype)$/.test(e.t));
  const R = Sit.reboundOutcomes(plays);
  const of = id => R.get(plays.find(e => e.id === id));
  ok('an own rebound is offensive, the other side\'s defensive', of(m1) === 'off' && of(m2) === 'def');
  ok('a block between the miss and the rebound does not end the search', of(m2) === 'def');
  ok('a team rebound (no player) counts', of(m3) === 'def');
  ok('a turnover, a foul and free throws, another shot or the end of the period leave it with no rebound',
     [...R.values()].filter(v => v === 'none').length === 5, [...R.values()].join());
  ok('...a missed free throw is not a field goal, so its rebound is nobody\'s', of(m6) === 'none' && R.size === 9);
  ok('a rebound with no team is not either side\'s', R.get(plays.find(e => e.t === 'p3_miss' && e.period === 2)) === 'none');

  const C = Sit.compute(S);
  const [L, H] = C.side.map(x => x.sits.all.zones);
  const cell = q => q.a + '/' + q.m + '/' + q.o + '/' + q.d;
  ok('Leeds: rim 2 shots, 0 made, 1 own rebound and 1 the other side\'s', cell(L.rim) === '2/0/1/1', cell(L.rim));
  ok('...three 2 shots, 1 own rebound, 1 with none', cell(L.three) === '2/0/1/0', cell(L.three));
  ok('...mid 1 shot, none', cell(L.mid) === '1/0/0/0', cell(L.mid));
  ok('Hull: rim 1 shot (the foul), mid 3 shots with 1 made, 1 the other side\'s, three 1 with none',
     cell(H.rim) === '1/0/0/0' && cell(H.mid) === '3/1/0/1' && cell(H.three) === '1/0/0/0', [H.rim, H.mid, H.three].map(cell).join(' '));
  const Z = Sit.reboundZones(log);
  ok('reboundZones() over the whole log is the side\'s zone cells, both sides',
     [0, 1].every(t => ['rim', 'mid', 'three'].every(z => cell(Z[t][z]) === cell(C.side[t].sits.all.zones[z]))), JSON.stringify(Z));
  ok('every situation holds the rebounds of the misses it holds', ['second', 'transition', 'offTo', 'half', 'ato'].every(k =>
     [0, 1].every(t => ['rim', 'mid', 'three'].every(z => { const q = C.side[t].sits[k].zones[z]; return q.o + q.d <= q.a - q.m; }))));
  const second = C.side[0].sits.second.zones;
  ok('the miss taken after an own offensive rebound is a second chance, and its rebound is in that situation too',
     second.rim.a === 1 && second.rim.d === 1, JSON.stringify(second.rim));
  ok('the stored line is untouched (the zone cells carry extra numbers, the stored fields are the same twelve)',
     Sit.toStored(C).teams[0].all.length === 13 && Sit.FIELDS.length === 13 && Sit.VERSION === 1);
}

console.log('\nwhat the events tab draws');
{
  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
  let html = Ev.render(S);
  const tables = h => h.match(/<table class="ev-mx az rb"[\s\S]*?<\/table>/g) || [];
  const [rb, rbH] = tables(html);
  const nums = row => [...(row.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/g) || [])].slice(1, 6).map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join('|');
  const rowOf = (tb, k) => (tb.match(new RegExp('<tr[^>]*data-evrb="' + k + '"[\\s\\S]*?</tr>')) || [''])[0];
  ok('a card with a table for each team\'s own shot attempts, whichever team and end is on show',
     /ev-rebounds/.test(html) && tables(html).length === 2 && /<h4 class="ev-sub"><span translate="no">Leeds Force<\/span>’s shot attempts<\/h4>/.test(html) &&
     /<h4 class="ev-sub"><span translate="no">Hull Pirates<\/span>’s shot attempts<\/h4>/.test(html));
  ok('Leeds rim: 2 attempts (2 missed), 0 made, 1 offensive rebound (50%), 1 defensive (50%), none 0',
     nums(rowOf(rb, 'rim')) === '2 2 missed|0 0%|1 50%|1 50%|0 0%', nums(rowOf(rb, 'rim')));
  ok('...three: 2 attempts, 0 made, 1 offensive, 0 defensive, 1 with none', nums(rowOf(rb, 'three')) === '2 2 missed|0 0%|1 50%|0 0%|1 50%', nums(rowOf(rb, 'three')));
  ok('...all: 5 attempts, 0 made, 2 offensive (40%), 1 defensive (20%), 2 with none (40%): the four add up',
     nums(rowOf(rb, 'all')) === '5 5 missed|0 0%|2 40%|1 20%|2 40%', nums(rowOf(rb, 'all')));
  ok('Hull: 5 attempts with 1 made (20%), no offensive rebound, 1 defensive (the team rebound), 3 with none',
     nums(rowOf(rbH, 'all')) === '5 4 missed|1 20%|0 0%|1 20%|3 60%', nums(rowOf(rbH, 'all')));
  ok('...its mid-range: 3 attempts, 1 made (33%), 1 defensive rebound', nums(rowOf(rbH, 'mid')) === '3 2 missed|1 33%|0 0%|1 33%|1 33%', nums(rowOf(rbH, 'mid')));
  ok('percentages on fewer than three attempts are greyed', /<small class="few">50%<\/small>/.test(rowOf(rb, 'rim')));
  ok('each table says whose rebound is whose', /<span translate="no">Leeds Force<\/span> offensive rebound[\s\S]*<span translate="no">Hull Pirates<\/span> defensive rebound/.test(html) &&
     /<span translate="no">Hull Pirates<\/span> offensive rebound[\s\S]*<span translate="no">Leeds Force<\/span> defensive rebound/.test(html));
  ok('the note says what "neither" is, that the four add up, and that the situation rows do not change it',
     /Neither is a foul and free throws, a turnover/.test(html) && /the four add up to the attempts/.test(html) && /they are every shot/.test(html));

  Ev.setView({ team: 1, side: 'def' });
  const after = tables(Ev.render(S));
  ok('the team and end switches leave it alone: the same two tables', after.length === 2 && after[0] === rb && after[1] === rbH);
  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });

  const none = Ev.render({ teams: S.teams, events: log.filter(e => !/^p[23]_/.test(e.t) && !/^(loc|tag|stype|reb|blk)$/.test(e.t)) });
  ok('a game with no shot attempts draws no such table', !/ev-mx az rb/.test(none));
}

console.log('\nthe club profile: a season of logs, both ends');
{
  globalThis.EpinoiaSituations = Sit;
  const SC = require(path.join(ROOT, 'epinoia', 'shotchart.js'));
  const withGame = gid => log.map(e => Object.assign({}, e, { gameId: gid }));
  const byG = { g1: withGame('g1') };
  const side = { g1: ['leeds', 'hull'] };
  const R = SC.reboundsOf(byG, side);
  const cell = q => q.a + '/' + q.m + '/' + q.o + '/' + q.d;
  ok('each club has both ends', !!R.leeds && !!R.hull && !!R.leeds.off && !!R.leeds.def);
  ok('a club\'s offence is its own side\'s shots: Leeds\' rim (2 shots, none made, 1 own rebound, 1 the other side\'s)',
     cell(R.leeds.off.rim) === '2/0/1/1' && cell(R.hull.off.rim) === '1/0/0/0', [R.leeds.off.rim, R.hull.off.rim].map(cell).join(' '));
  ok('...and its defence is the other side\'s shots: what Hull shot against Leeds', cell(R.leeds.def.mid) === '3/1/0/1' && cell(R.leeds.def.three) === '1/0/0/0');
  const L = SC.rebRow(R.leeds, 'all'), Lr = SC.rebRow(R.leeds, 'rim');
  ok('Leeds, all zones, per attempt: 5 attempts, 2 offensive rebounds (40%), 1 taken by the other side (20%); against it: 5 attempts, 1 defensive rebound (20%)',
     L.own.a === 5 && L.own.o === 2 && Math.abs(L.orp - 40) < 1e-9 && Math.abs(L.odp - 20) < 1e-9 && L.against.a === 5 && L.against.d === 1 && Math.abs(L.drp - 20) < 1e-9 && L.oop === 0, JSON.stringify(L));
  ok('...rim: 2 own attempts, 50% offensive rebounds, 50% the other side\'s; the one attempt against it had no rebound',
     Lr.own.a === 2 && Lr.orp === 50 && Lr.odp === 50 && Lr.against.a === 1 && Lr.drp === 0, JSON.stringify(Lr));
  const nothing = { rim: { a: 0, m: 0, o: 0, d: 0 }, mid: { a: 0, m: 0, o: 0, d: 0 }, three: { a: 0, m: 0, o: 0, d: 0 } };
  /* a second game with the clubs the other way round adds each club's other end to its own: a season is the sum */
  const R2 = SC.reboundsOf({ g1: withGame('g1'), g2: withGame('g2') }, { g1: ['leeds', 'hull'], g2: ['hull', 'leeds'] });
  ok('over two games, home once each, a club\'s offence is its side\'s shots in one and the other side\'s in the other',
     cell(R2.leeds.off.rim) === '3/0/1/1' && cell(R2.leeds.off.mid) === '4/1/0/1' && cell(R2.hull.off.rim) === '3/0/1/1',
     [R2.leeds.off.rim, R2.leeds.off.mid, R2.hull.off.rim].map(cell).join(' '));
  delete globalThis.EpinoiaSituations;
  ok('without situations.js on the page the season rows simply have no rebound columns', SC.reboundsOf(byG, side) === null);
  const teamJs = fs.readFileSync(path.join(ROOT, 'epinoia', 't', 'team.js'), 'utf8').replace(/\r\n/g, '\n');
  ok('the club page draws them under the shot zones, with or without located shots, each rate a percentile among the teams',
     /function reboundZones\(host, S, mine\)/.test(teamJs) && /reboundZones\(host, S, mine\);\s*\n\}/.test(teamJs) && /reboundZones\(host, S, mine\); return; \}/.test(teamJs)
     && /'rb_' \+ z \+ '_' \+ m/.test(teamJs) && /window\.EpinoiaSeason/.test(teamJs));
  ok('the page loads situations.js (the calculator) before the club page runs',
     /situations\.js\?v=\d+" defer><\/script>[\s\S]*team\.js\?v=/.test(fs.readFileSync(path.join(ROOT, 'epinoia', 't', 'index.html'), 'utf8')));
}

console.log('\nreal LiveStats game');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    'sys.stdout.write(json.dumps(T))',
  ].join('\n');
  const f = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json');
  let T = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), f], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
  }
  ok('the fixture translates', !!T);
  if (T) {
    const events = T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}));
    const Z = Sit.reboundZones(events);
    const zs = ['rim', 'mid', 'three'];
    const C = Sit.compute({ teams: T.roster_snapshot.teams, events });
    [0, 1].forEach(t => {
      const a = zs.reduce((n, z) => n + Z[t][z].a, 0), m = zs.reduce((n, z) => n + Z[t][z].m, 0);
      const o = zs.reduce((n, z) => n + Z[t][z].o, 0), d = zs.reduce((n, z) => n + Z[t][z].d, 0);
      const fgs = events.filter(e => e.team === t && /^p[23]_(made|miss)$/.test(e.t));
      ok('side ' + t + ': every field goal is in a zone (' + a + ') and every miss is a rebound or neither (' + (a - m) + ' = ' + o + ' + ' + d + ' + the rest)',
         a === fgs.length && o + d <= a - m);
      const rebs = events.filter(e => e.t === 'reb' && e.team === t && e.off).length;
      const oppD = events.filter(e => e.t === 'reb' && e.team === 1 - t && !e.off).length;
      ok('side ' + t + ': its offensive rebounds off misses (' + o + ') are no more than the game\'s (' + rebs + '), and the other side\'s defensive ones (' + d + ') no more than theirs (' + oppD + ')',
         o <= rebs && d <= oppD);
      ok('side ' + t + ': the side\'s zone cells are reboundZones()', zs.every(z => C.side[t].sits.all.zones[z].o === Z[t][z].o && C.side[t].sits.all.zones[z].d === Z[t][z].d));
    });
    const linked = [0, 1].reduce((n, t) => n + zs.reduce((k, z) => k + Z[t][z].o + Z[t][z].d, 0), 0);
    const all = events.filter(e => e.t === 'reb').length;
    ok('most of the game\'s rebounds are found off field-goal misses (' + linked + ' of ' + all + '; the rest follow missed free throws)', linked >= 0.6 * all && linked <= all, linked + '/' + all);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
