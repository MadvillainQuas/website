// THE CLUB REPORT'S THREE ADDITIONS (2026-10-03; teamviz.js, report-teampages.js, kit/teamviz.css). What is held here, with
// no browser and no database (the pages themselves were drawn against live data and read by eye):
//   * THE MOST-USED FIVE names one player a spot: each position's first choice in the depth chart, but a player who leads
//     two (or three) positions is placed once, at the one he plays the most minutes at, and each other spot takes the next
//     player in its depth chart who is not already placed; a spot with nobody left is empty; never a name twice;
//   * TRUE SHOT ATTEMPTS a game (field goal attempts + 0.44 of the free throw attempts) for the club and against it, the gap,
//     and the gap's three parts - turnovers, offensive rebounds, possessions - which add up to it exactly (true shots =
//     possessions + offensive rebounds - turnovers), per game however many games, and nothing without the play-by-play;
//   * THE DEFENCE'S SHOT CLOCK: how each first chance ended (a basket, free throws, a miss they won back, a turnover, a stop),
//     the three windows drawn for the defence alone, laid out as shares (flex) as the depth bars are, which the PDF's
//     renderer lays out;
//   * the report's wiring: the cover asks for every player's minutes, the true shots block is a club page's (not a single
//     game's) and sits under the rebounds, the defence's shot clock under the shot clock, each defined in the legend.
//
//   node supabase/tests/team-report-extras.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const V = createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'teamviz.js'));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };
const names = five => five.map(p => (p ? p.name : null));
const S = (...lists) => lists.map(l => ({ players: l.map(([name, min, id]) => ({ name, min, id: id == null ? name : id })) }));

console.log('\nthe most-used five, one player a spot');
{
  const plain = S([['Patterson', 50], ['Delph', 45]], [['Jack', 47], ['Delph', 45]], [['Bairstow', 34], ['Jack', 33]], [['Lee', 41], ['Onwas', 32]], [['Alihodzic', 54], ['Ochereobia', 29]]);
  ok('first choices that differ are the five, as before', names(V.fiveOf(plain)).join() === 'Patterson,Jack,Bairstow,Lee,Alihodzic');
  const sharks = S([['Patterson', 50], ['Delph', 45]], [['Jack', 47], ['Delph', 45]], [['Jack', 34], ['Bairstow', 34], ['Ratinho', 28]], [['Lee', 41], ['Onwas', 32]], [['Alihodzic', 54], ['Ochereobia', 29]]);
  ok('a player first at two positions keeps the one he plays most (shooting guard, 47 minutes against 34); small forward goes to the next player',
     names(V.fiveOf(sharks)).join() === 'Patterson,Jack,Bairstow,Lee,Alihodzic', names(V.fiveOf(sharks)));
  const flipped = S([['A', 40]], [['B', 20], ['C', 10]], [['B', 35], ['D', 30]], [['E', 40]], [['F', 40]]);
  ok('...and where he plays more at the later position, he goes there and the earlier one takes its next player',
     names(V.fiveOf(flipped)).join() === 'A,C,B,E,F', names(V.fiveOf(flipped)));
  const three = S([['X', 30], ['P', 20]], [['X', 50], ['Q', 20]], [['X', 40], ['R', 20]], [['W', 40]], [['Z', 40]]);
  ok('first at three positions: placed at his most, the other two take the next in line', names(V.fiveOf(three)).join() === 'P,X,R,W,Z', names(V.fiveOf(three)));
  const chain = S([['A', 40], ['B', 30]], [['B', 35], ['C', 5]], [['C', 45], ['D', 1]], [['E', 40]], [['F', 40]]);
  ok('the next player may himself lead another position: that is settled by his minutes too, down the line',
     names(V.fiveOf(chain)).join() === 'A,B,C,E,F' && new Set(names(V.fiveOf(chain))).size === 5, names(V.fiveOf(chain)));
  const thin = S([['A', 40]], [['A', 30]], [['B', 40]], [['C', 40]], [['D', 40]]);
  ok('a position with nobody else to go to is left empty, never the same name again', V.fiveOf(thin)[0].name === 'A' && V.fiveOf(thin)[1] === null && names(V.fiveOf(thin)).filter(Boolean).join() === 'A,B,C,D', names(V.fiveOf(thin)));
  const tie = S([['A', 30]], [['A', 30], ['B', 10]], [['C', 40]], [['D', 40]], [['E', 40]]);
  ok('a tie in minutes keeps the earlier position', names(V.fiveOf(tie)).join() === 'A,B,C,D,E', names(V.fiveOf(tie)));
  const byName = [{ players: [{ name: 'Jack', min: 20 }] }, { players: [{ name: 'jack ', min: 10 }, { name: 'Lee', min: 5 }] }];
  ok('without ids the name is the identity (any case, any spacing)', names(V.fiveOf(byName)).join() === 'Jack,Lee', names(V.fiveOf(byName)));
  ok('a player with no minutes at a position is not a choice there', names(V.fiveOf(S([['A', 0], ['B', 10]], [['C', 5]]))).join() === 'B,C');
  const frozen = JSON.stringify(sharks); V.fiveOf(sharks);
  ok('the depth chart it was given is left as it was', JSON.stringify(sharks) === frozen);
  ok('nothing at all: five empty spots from five empty positions, and none from none', V.fiveOf(S([], [], [], [], [])).every(p => p === null) && V.fiveOf(null).length === 0 && V.fiveOf([]).length === 0);
  /* whatever the depth chart, nobody is named twice */
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let twice = 0, five = 0;
  for (let t = 0; t < 2000; t++) {
    const pool = Array.from({ length: 4 + Math.floor(rnd() * 8) }, (_, i) => 'P' + i);
    const slots = Array.from({ length: 5 }, () => ({ players: pool.filter(() => rnd() < 0.55).map(id => ({ id, name: id, min: Math.floor(rnd() * 60) + 1 })).sort((a, b) => b.min - a.min) }));
    const got = V.fiveOf(slots).filter(Boolean).map(p => p.id);
    if (new Set(got).size !== got.length) twice++;
    if (got.length === 5) five++;
  }
  ok('2000 random depth charts: nobody is ever named twice (' + five + ' of them filled all five spots)', twice === 0 && five > 500, twice);
}

console.log('\ntrue shot attempts');
const sharksRow = { ev_gp: 1, evd_gp: 1, ev_all_fga: 70, ev_all_fta: 13, ev_all_tov: 7, evd_all_fga: 61, evd_all_fta: 12, evd_all_tov: 15 };
const reb = { rb_ready: true, rb_all_o: 11, rb_all_go: 9 };
const near = (a, b) => Math.abs(a - b) < 1e-9;
{
  const t = V.tsaOf(sharksRow);
  ok('FGA + .44 FTA: the club 70 + 5.72, its opponents 61 + 5.28, the gap between them', near(t.own, 75.72) && near(t.vs, 66.28) && near(t.gap, 9.44), t);
  const ts = V.trueShotsOf(sharksRow, reb), P = ts.parts;
  ok('the gap is made of turnovers (they lose 15, it loses 7: +8), offensive rebounds (11 against 9: +2) and possessions (-0.56)',
     near(P.tov, 8) && near(P.oreb, 2) && near(P.poss, -0.56) && near(P.possF, 71.72) && near(P.possV, 72.28), P);
  ok('...and they add up to the gap exactly', near(P.tov + P.oreb + P.poss, ts.gap), [P.tov + P.oreb + P.poss, ts.gap]);
  const two = V.trueShotsOf({ ev_gp: 2, evd_gp: 2, ev_all_fga: 140, ev_all_fta: 26, ev_all_tov: 14, evd_all_fga: 122, evd_all_fta: 24, evd_all_tov: 30 }, { rb_ready: true, rb_all_o: 22, rb_all_go: 18 });
  ok('a game is a game, however many: two games of the same numbers read the same', near(two.own, 75.72) && near(two.gap, 9.44) && near(two.parts.tov, 8), two);
  ok('without the rebounds (not read yet) the shots and the gap stand and the parts are left out', V.trueShotsOf(sharksRow, { rb_ready: false }).parts === null && V.trueShotsOf(sharksRow, null).gap > 9);
  ok('without the play-by-play (no games with it) there is nothing to say', V.trueShotsOf({ ev_gp: 0, evd_gp: 0, ev_all_fga: 0 }, reb) === null && V.trueShotsOf({}, reb) === null && V.tsaOf(null).own === null);
  ok('a club with no free throws counts shots alone', near(V.tsaOf({ ev_gp: 1, evd_gp: 1, ev_all_fga: 10, evd_all_fga: 8 }).gap, 2));
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, r = n => Math.floor(rnd() * n);
  let off = 0;
  for (let i = 0; i < 1000; i++) {
    const g = 1 + r(30), row = { ev_gp: g, evd_gp: g, ev_all_fga: g * (50 + r(40)), ev_all_fta: g * r(30), ev_all_tov: g * r(20), evd_all_fga: g * (50 + r(40)), evd_all_fta: g * r(30), evd_all_tov: g * r(20) };
    const x = V.trueShotsOf(row, { rb_ready: true, rb_all_o: g * r(20), rb_all_go: g * r(20) });
    if (Math.abs(x.parts.tov + x.parts.oreb + x.parts.poss - x.gap) > 1e-9) off++;
  }
  ok('1000 random seasons: the three parts always add up to the gap', off === 0, off);
}

console.log('\nhow each first chance ended');
{
  const c = (o) => Object.assign({ fgm: 0, fga: 0, fta: 0, tov: 0, reb: null }, o);
  const list = [c({ fgm: 1, fga: 1 }), c({ fgm: 1, fga: 1, fta: 1 }), c({ tov: 1 }), c({ fta: 2 }), c({ fga: 1, reb: 'off' }), c({ fga: 1, reb: 'def' }), c({ fga: 1 }),
    c({ fga: 1, tov: 1 }), c({ fga: 1, fta: 2, reb: 'def' })];
  const o = V.outcomesOf(list);
  ok('a basket is a basket (an and-one too); a turnover; free throws alone; a miss they won back; any other miss is a stop',
     o.made === 2 && o.to === 2 && o.ft === 2 && o.oreb === 1 && o.stop === 2 && o.n === 9, o);
  ok('every chance ends one way: the five add up to the chances', o.made + o.ft + o.oreb + o.to + o.stop === o.n && V.outcomesOf([]).n === 0 && V.outcomesOf(null).n === 0);
}

console.log('\nwhat is drawn');
{
  const ts = V.trueShotsOf(sharksRow, reb);
  const html = V.trueShots(ts, { bands: { own: 2, vs: 4, gap: 4 }, ranks: { own: '6th of 10', vs: '1st of 10', gap: '1st of 10' } });
  ok('the club\'s TSA, its opponents\' and the gap, each on its colour with its place and its words', /TSA a game<\/span>/.test(html) && /TSA allowed a game<\/span>/.test(html) && /the true shots gap<\/span>/.test(html) && /<b>75\.7<\/b>/.test(html) && /<b>66\.3<\/b>/.test(html) && /<b>\+9\.4<\/b>/.test(html) &&
     /data-b="2"[^>]*><b>75\.7/.test(html) && /6th of 10/.test(html) && /1st of 10/.test(html) && /70\.0 shots \+ 13\.0 free throws × \.44/.test(html), html.slice(0, 400));
  ok('...and where the gap comes from: turnovers, offensive rebounds, possessions, each signed, with its words',
     /Turnovers<\/b>[\s\S]*\+8\.0[\s\S]*forces 15\.0 a game, gives away 7\.0/.test(html) && /Offensive rebounds<\/b>[\s\S]*\+2\.0[\s\S]*takes 11\.0 a game, allows 9\.0/.test(html) &&
     /Possessions<\/b>[\s\S]*−0\.6[\s\S]*71\.7 a game to their 72\.3/.test(html) && /true shots = possessions \+ offensive rebounds − turnovers/.test(html));
  ok('...a bar from the middle: green to the right where the club gains, red to the left where it loses, the biggest part half the width',
     /class="pos" style="width:50\.0%;left:50%"/.test(html) && /class="neg" style="width:[\d.]+%;right:50%"/.test(html));
  const bare = V.trueShots(V.trueShotsOf(sharksRow, null), {});
  ok('with no rebounds the tiles stand alone', /<b>75\.7<\/b>/.test(bare) && !/Where the gap comes from/.test(bare) && V.trueShots(null) === '');
  ok('a level club is told so, a club behind is told so',
     /level with its opponents/.test(V.trueShots(V.trueShotsOf({ ev_gp: 1, evd_gp: 1, ev_all_fga: 60, evd_all_fga: 60 }, null), {})) &&
     /fewer shots a game than its opponents get/.test(V.trueShots(V.trueShotsOf({ ev_gp: 1, evd_gp: 1, ev_all_fga: 55, evd_all_fga: 60 }, null), {})));

  const sum = n => ({ ppp: 1.08, efg: 0.75, tovPct: 0.25, orebPct: 0.333, ftr: 0.25, n });
  const row = (label, n, out) => ({ label, n, all: 100, s: sum(n), out });
  const dh = V.shotClockDef([row('0–7 s', 12, { n: 12, made: 5, ft: 1, oreb: 1, to: 3, stop: 2 }), row('8–16 s', 35, { n: 35, made: 12, ft: 0, oreb: 5, to: 7, stop: 11 }), row('17–24 s', 26, { n: 0, made: 0, ft: 0, oreb: 0, to: 0, stop: 0 })], sum(73));
  ok('three windows for the defence alone: points a possession, its share of theirs, and the club\'s defence named',
     (dh.match(/class="tv-sc-w"/g) || []).length === 3 && (dh.match(/The club’s defence<\/h6>/g) || []).length === 3 && /1\.08/.test(dh) && /12% of theirs · 12/.test(dh) && /Early<\/b><span>0–7 s · the first 7 seconds of theirs/.test(dh));
  ok('...the chips are the defence\'s: their shooting, turnovers forced, its own defensive rebounding (the other side of their OREB), their free throws',
     /eFG <b>75\.0<\/b>/.test(dh) && /TO <b>25\.0<\/b>/.test(dh) && /DREB <b>66\.7<\/b>/.test(dh) && /FTr <b>25\.0<\/b>/.test(dh) && !/OREB/.test(dh));
  ok('...each window ends in a bar of how the chances ended, as shares (flex, which the PDF\'s renderer lays out), the large ones labelled, none for a window with no chances',
     /<i class="made" style="flex:5 1 0"[^>]*>42<\/i>/.test(dh) && /<i class="to" style="flex:3 1 0"[^>]*>25<\/i>/.test(dh) && /<i class="ft" style="flex:1 1 0"[^>]*><\/i>/.test(dh) &&
     !/class="ft" style="flex:0/.test(dh) && (dh.match(/class="tv-oc-bar"><\/div>/g) || []).length === 1 && !/width:\d+(\.\d+)?%" title/.test(dh));
  ok('...with the colours and what each colour is said underneath', /tv-oc-key/.test(dh) && ['basket', 'free throws', 'their rebound', 'turnover', 'stop'].every(w => dh.includes('</i>' + w + '</span>')) && /against the club’s defence over every possession/.test(dh));
  ok('the green of a chip is the club\'s: a high DREB is better, a high eFG allowed is worse',
     /DREB <b>80\.0<\/b>/.test(V.shotClockDef([row('0–7 s', 5, { n: 5, made: 1, ft: 0, oreb: 1, to: 1, stop: 2 })].map(r => Object.assign(r, { s: Object.assign(sum(5), { orebPct: 0.2 }) })), sum(73))) &&
     V.bandVs(100 * 0.8, 100 * 0.6, 4, false) === 4 && V.bandVs(75, 60, 3, true) === 1);
}

console.log('\nthe report\'s wiring');
{
  const src = read('epinoia', 'report-teampages.js'), css = read('epinoia', 'kit', 'teamviz.css');
  ok('the cover asks for every player\'s minutes at each position and names the five through fiveOf; the note says what it does',
     /const d = await ctx\.depth\(true\);/.test(src) && /names = V\.fiveOf\(d\.c\.slots\)\.map\(p => \(p \? surname\(p\.name\) : ''\)\)/.test(src) && /A player who leads two positions is named once, at the one he plays most/.test(src));
  ok('every club\'s true shots are worked out with the rest of its derived figures (so the club has a place among them)', /V0\.tsaOf\(r\)/.test(src) && /r\.tsa_for = t\.own; r\.tsa_vs = t\.vs; r\.tsa_gap = t\.gap;/.test(src));
  ok('...the three are statistics of the report: more is better, fewer allowed is better, the gap is signed; each defined for the legend',
     /tsa_for: \{ l: 'TSA A GAME', dp: 1 \}, tsa_vs: \{ l: 'TSA ALLOWED A GAME', dp: 1, low: true \}, tsa_gap: \{ l: 'TRUE SHOTS GAP', dp: 1, signed: true \}/.test(src) &&
     /tsa_for: \['True shooting attempts \(TSA\) a game'/.test(src) && /tsa_gap: \['True shots gap'/.test(src) && /R\.legend\.push\(\.\.\.ks\);/.test(src));
  const reb = src.indexOf("title('Rebounds analysis'"), ts = src.indexOf("title('True shots gap'");
  ok('the true shots block is a club\'s (a single game has its own margin block) and sits under the rebounds analysis',
     reb > 0 && ts > reb && /const TS = them \? null : V\.trueShotsOf\(me, srcRow\);/.test(src) && /'rp-tsa'\)\)/.test(src) && /Why true shot attempts matter/.test(src));
  const sc = src.indexOf("title('Shot clock'"), sd = src.indexOf("title('Shot clock · defence'");
  ok('the defence\'s shot clock sits under the shot clock, from the opponents\' first chances, each window with its outcomes',
     sc > 0 && sd > sc && /V\.shotClockDef\(rowsOf\(opp\), SCk\.summary\(firsts\(opp\)\)\)/.test(src) && /out: V\.outcomesOf\(sub\)/.test(src));
  ok('...the legend says what it is, and the report is no longer than before for it (the legend\'s entry is short)', /\['SHOT CLOCK · DEFENCE', /.test(src) && !/R\.legendExtra\.push\(\['TRUE SHOTS'/.test(src));
  ok('the pieces are drawn in the kit\'s own stylesheet', /\.tv-tsa-k\{/.test(css) && /\.tv-tsa-r\{/.test(css) && /\.tv-oc-bar\{/.test(css) && /\.tv-oc-k i\.made/.test(css));
  ok('the game analysis keeps its own margin block and cover: it asks for neither new block', /them \? null/.test(src) && !/trueShots|shotClockDef|fiveOf/.test(read('epinoia', 'game', 'analysis.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
