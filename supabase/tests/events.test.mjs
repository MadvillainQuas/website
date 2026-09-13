/* ============================================================================
   EVENTS — what second chances, breaks, turnovers and timeouts turned into.

   epinoia/game/events.js stamps every shot, free throw and turnover with the
   engine's own situation windows and hangs each on a possessions.js chance.
   These check it on a log small enough to work out by hand -- every rule, the
   timeout edge cases, the engine's free-throw quirk -- and then on three real
   LiveStats games through the ingest's translator, where second-chance,
   off-turnover and fast-break points must be the box score's to the point.

     node supabase/tests/events.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Ev = require(path.join(ROOT, 'epinoia', 'game', 'events.js'));
globalThis.EpinoiaBox = require(path.join(ROOT, 'epinoia', 'boxscore.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) <= e;

/* ---- a game small enough to do by hand ------------------------------------ */
const player = (t, i, name) => ({ id: (t ? 'a' : 'h') + i, name, num: String(i) });
const S = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6].map(i => player(0, i, ['', 'Ada Stone', 'Bea Moss', 'Cy Hart', 'Dee Lowe', 'Eve Park', 'Flo <b>Ray</b>'][i])) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5, 6].map(i => player(1, i, ['', 'Gus Roe', 'Hal Fox', 'Ian Pike', 'Jo Kent', 'Kit Lane', 'Lou Dale'][i])) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  period: 2, clockMs: 500000,
  events: []
};
let seq = 0;
/* as the page loads them: id is the seq, descriptors point at it */
const ev = (t, team, pid, clock, extra, period) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team, pid, period: period || 1, clock }, extra || {})); return s; };
const desc = (t, ref, extra) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team: null, pid: null, period: 1, clock: null, ref }, extra)); };

ev('period_start', null, null, 600000);
ev('p2_miss', 0, 'h1', 590000);                                   // A1  half court
ev('reb', 0, 'h2', 588000, { off: true });
const putback = ev('p2_made', 0, 'h2', 587000);                   // A2  second chance, 2
desc('stype', putback, { v: 'putback' });
ev('p3_miss', 1, 'a1', 570000);                                   // B1  half court
ev('reb', 0, 'h3', 568000, { off: false });                       //     the break opens
const layup = ev('p2_made', 0, 'h3', 563000);                     // A3  transition (5 s), 2, assisted
desc('stype', layup, { v: 'layup' });
ev('ast', 0, 'h1', 563000);
ev('p2_miss', 1, 'a2', 550000);                                   // B2  half court
ev('reb', 0, 'h4', 548000, { off: false });
const jumper = ev('p2_miss', 0, 'h4', 530000);                    // A4  18 s after the rebound: half court
desc('stype', jumper, { v: 'jump shot' }); desc('loc', jumper, { x: 0.5, y: 0.3 });   // in the paint, but a jump shot
ev('reb', 1, 'a3', 528000, { off: false });
ev('to', 1, 'a3', 515000);                                        // B3  half court turnover
ev('stl', 0, 'h5', 515000);
ev('p3_made', 0, 'h5', 505000);                                   // A5  off the turnover, 3 (10 s: not a break)
ev('timeout', 1, null, 505000);                                   //     Hull's timeout
ev('p2_miss', 1, 'a4', 490000);                                   // B4  after timeout (own)
ev('reb', 1, 'a5', 488000, { off: true });
ev('p2_made', 1, 'a5', 487000);                                   // B5  second chance, 2 -- the same set
ev('p2_miss', 0, 'h1', 470000);                                   // A6  half court
ev('reb', 0, 'h1', 468000, { off: true });
ev('foul', 1, 'a1', 466000, { kind: 'shooting' });
ev('ft_made', 0, 'h1', 466000);                                   // A7  second chance, 1
ev('timeout', 0, null, 466000);                                   //     Leeds' timeout between free throws
ev('ft_made', 0, 'h1', 466000);                                   //     the engine has shut the window: not second chance
ev('p3_made', 1, 'a1', 450000);                                   // B6  after timeout (theirs), 3, assisted
ev('ast', 1, 'a2', 450000);
ev('foul', 0, 'h2', 440000, { kind: 'shooting' });
ev('ft_made', 1, 'a3', 440000);                                   // B7  half court, 1
ev('ast', 1, 'a4', 440000);                                       //     a pass that drew free throws
ev('ft_miss', 1, 'a3', 440000);
ev('reb', 0, 'h2', 438000, { off: false });
ev('timeout', 1, null, 438000);                                   //     the last timeout of the period: sets nothing up
ev('period_start', null, null, 600000, null, 2);
const late = ev('p2_made', 0, 'h6', 590000, null, 2);             // A9  half court, 2
desc('loc', late, { x: 0.5, y: 0.2 });

console.log('\nthe situations, worked out by hand');
{
  const d = E.deriveGame(S);
  const C = Ev.compute(S);
  const [L, H] = C.side.map(x => x.sits);
  ok('the engine agrees with the hand count (11-6; Leeds sc 3 pot 3 fast 2; Hull sc 2)',
     d.score[0] === 11 && d.score[1] === 6 && d.team[0].sc === 3 && d.team[0].pot === 3 && d.team[0].fast === 2 &&
     d.team[1].sc === 2 && d.team[1].pot === 0 && d.team[1].fast === 0,
     JSON.stringify([d.score, [0, 1].map(t => [d.team[t].sc, d.team[t].pot, d.team[t].fast])]));
  [0, 1].forEach(t => {
    const s = C.side[t].sits;
    ok('team ' + t + ': all, second chance, off-turnover and transition points are the engine\'s',
       s.all.pts === d.score[t] && s.second.pts === d.team[t].sc && s.offTo.pts === d.team[t].pot && s.transition.pts === d.team[t].fast,
       [s.all.pts, s.second.pts, s.offTo.pts, s.transition.pts].join(','));
  });
  ok('Leeds: 8 chances with something in them (the rebound the period ended on is not one)', L.all.chances === 8, L.all.chances);
  ok('...11 points, 1.375 per chance, 4/7 FG with a three: eFG 64.3%', L.all.pts === 11 && near(L.all.ppp, 1.375) && L.all.fgm === 4 && L.all.fga === 7 && near(L.all.efg, 4.5 / 7));
  ok('second chance: the putback and ONE free throw -- the engine shuts the window on the first made free throw',
     L.second.chances === 2 && L.second.pts === 3 && L.second.fga === 1 && L.second.fta === 1 && near(L.second.ppp, 1.5),
     JSON.stringify({ ch: L.second.chances, pts: L.second.pts, fga: L.second.fga, fta: L.second.fta }));
  ok('transition: the layup five seconds after the rebound, not the jumper eighteen after', L.transition.chances === 1 && L.transition.pts === 2 && L.transition.fga === 1);
  ok('a steal ten seconds before the shot is off a turnover but not a break', L.offTo.chances === 1 && L.offTo.pts === 3 && L.offTo.p3m === 1 && near(L.offTo.efg, 1.5));
  ok('half court is whatever was none of the four: 4 chances, 2 points, 1/4', L.half.chances === 4 && L.half.pts === 2 && L.half.fgm === 1 && L.half.fga === 4);
  ok('zones follow the engine: putback and layup at the rim, a jump shot in the paint is not, an untyped shot in the paint is',
     L.all.zones.rim.a === 3 && L.all.zones.rim.m === 3 && L.all.zones.mid.a === 3 && L.all.zones.mid.m === 0 && L.all.zones.three.a === 1,
     JSON.stringify(L.all.zones));
  const rimA = S.teams[0].players.reduce((n, p) => n + d.stats[p.id].rimA, 0);
  ok('...and the rim count is the box score\'s', L.all.zones.rim.a === rimA, L.all.zones.rim.a + ' vs ' + rimA);
  ok('shot types are counted with their makes', L.all.types.some(T => T.type === 'putback' && T.a === 1 && T.m === 1) && L.all.types.some(T => T.three && T.a === 1));
  ok('the shot map knows which shots were located', L.all.shots.filter(x => x.x != null).length === 2);

  const [atoH1, atoH2] = C.side[1].ato;
  ok('Hull: two plays after a timeout, none for Leeds', C.side[1].ato.length === 2 && C.side[0].ato.length === 0, JSON.stringify(C.side.map(x => x.ato.length)));
  ok('after their own timeout: the miss AND the putback, one possession, 2 points',
     atoH1 && atoH1.calledBy === 'own' && atoH1.chances === 2 && atoH1.pts === 2 && atoH1.seq === 21 && /putback|two/.test(atoH1.how), JSON.stringify(atoH1));
  ok('a timeout between free throws sets up the other side\'s inbound (their timeout, a three)',
     atoH2 && atoH2.calledBy === 'opp' && atoH2.pts === 3 && atoH2.chances === 1 && /three · Roe/.test(atoH2.how), JSON.stringify(atoH2));
  ok('a timeout that ends a period sets up nothing', !C.side[0].ato.some(p => p.period === 2));
  ok('the after-timeout row counts possessions: 2, 5 points, 2.50 each', H.ato.chances === 2 && H.ato.pts === 5 && near(H.ato.ppp, 2.5));
  ok('Hull half court leaves out the after-timeout set, putback included', H.half.chances === 4 && H.half.pts === 1 && H.half.tov === 1 && H.second.chances === 1);

  const [AL, AH] = C.side.map(x => x.assists);
  ok('Leeds: 1 assisted basket, 3 unassisted for 7 points', AL.ast.fgm === 1 && AL.ast.pts === 2 && AL.unast.fgm === 3 && AL.unast.pts === 7);
  ok('...led by the unassisted three, then the rest in the order they came', AL.leaders.map(p => p.pid).join() === 'h5,h2,h6', AL.leaders.map(p => p.pid).join());
  ok('Hull: the assist on a pass that drew free throws is kept apart from assisted baskets',
     AH.ast.fgm === 1 && AH.ast.pts === 3 && AH.unast.fgm === 1 && AH.ftAssists === 1);
  [0, 1].forEach(t => {
    const ast = S.teams[t].players.reduce((n, p) => n + d.stats[p.id].ast, 0);
    ok('team ' + t + ': assisted baskets + free-throw assists = the box score\'s assists', C.side[t].assists.ast.fgm + C.side[t].assists.ftAssists === ast);
  });

  /* every player's own line, by the side's rules */
  const PL = C.side[0].players;
  const za = (q, a, m) => !!q && q.a === a && q.m === m;
  const h1 = PL.h1 && PL.h1.sits;
  ok('Ada Stone: both jumpers missed from mid-range, both free throws made, 2 points',
     h1 && h1.all.fga === 2 && h1.all.fgm === 0 && za(h1.all.zones.mid, 2, 0) && h1.all.fta === 2 && h1.all.ftm === 2 && h1.all.pts === 2, h1 && JSON.stringify(h1.all));
  ok('...and ONE of the free throws is her second-chance point, as the engine credits it',
     h1 && h1.second.fta === 1 && h1.second.ftm === 1 && h1.second.pts === 1 && h1.second.fga === 0 && h1.second.pts === d.stats.h1.sc, h1 && JSON.stringify(h1.second));
  ok('Bea Moss\'s putback is her second chance: rim 1/1, 2 points',
     za(PL.h2.sits.second.zones.rim, 1, 1) && PL.h2.sits.second.pts === 2 && PL.h2.sits.second.fga === 1, JSON.stringify(PL.h2.sits.second));
  ok('Eve Park\'s three off the steal is her off-turnover line: 1/1, 3 points, eFG 150%',
     za(PL.h5.sits.offTo.zones.three, 1, 1) && PL.h5.sits.offTo.pts === 3 && near(PL.h5.sits.offTo.efg, 1.5), JSON.stringify(PL.h5.sits.offTo));
  ok('half court per player: Ada mid 0/2, Dee mid 0/1 (the jump shot in the paint), Flo rim 1/1',
     za(h1.half.zones.mid, 2, 0) && h1.half.fga === 2 && h1.half.fta === 0 &&
     za(PL.h4.sits.half.zones.mid, 1, 0) && PL.h4.sits.half.fga === 1 && za(PL.h6.sits.half.zones.rim, 1, 1) && PL.h6.sits.half.pts === 2);
  ok('a player with nothing in a situation has a zero line there, not a missing one',
     PL.h4.sits.second.fga === 0 && PL.h4.sits.second.efg === null && PL.h4.sits.ato.pts === 0);
  ok('a player who did nothing has no line at all', !('a6' in C.side[1].players) && Object.keys(PL).length === 6, Object.keys(C.side[1].players).join());
  [0, 1].forEach(t => {
    const bad = S.teams[t].players.filter(p => C.side[t].players[p.id]).filter(p => {
      const s = C.side[t].players[p.id].sits, x = d.stats[p.id];
      return s.second.pts !== x.sc || s.offTo.pts !== x.pot || s.transition.pts !== x.fast || s.all.pts !== x.pts || s.all.fga !== x.p2a + x.p3a || s.all.zones.rim.a !== x.rimA;
    }).map(p => p.id);
    ok('team ' + t + ': every player\'s second-chance, off-turnover, transition and total points, FGA and rim attempts are the engine\'s', !bad.length, bad.join());
  });
  ok('Leeds baskets by zone: assisted rim 1; unassisted rim 2 and the three',
     AL.ast.zones.rim === 1 && AL.ast.zones.mid === 0 && AL.ast.zones.three === 0 && AL.unast.zones.rim === 2 && AL.unast.zones.mid === 0 && AL.unast.zones.three === 1,
     JSON.stringify([AL.ast.zones, AL.unast.zones]));
  const zq = (q, a, m, ast, unast) => !!q && q.a === a && q.m === m && q.ast === ast && q.unast === unast;
  ok('...beside every attempt from each zone: rim 3/3, mid 0/3, three 1/1',
     zq(AL.zones.rim, 3, 3, 1, 2) && zq(AL.zones.mid, 3, 0, 0, 0) && zq(AL.zones.three, 1, 1, 0, 1), JSON.stringify(AL.zones));
  ok('a player\'s own split: Cy Hart\'s layup was assisted, Bea Moss\'s putback and Eve Park\'s three were not',
     PL.h3.ast.fgm === 1 && PL.h3.ast.zones.rim === 1 && PL.h3.unast.fgm === 0 &&
     PL.h2.unast.zones.rim === 1 && PL.h2.ast.fgm === 0 && PL.h5.unast.p3m === 1 && PL.h5.unast.pts === 3 && PL.h5.ast.fgm === 0);
}

console.log('\nthe tab, drawn');
{
  Ev.setView({ team: 0, side: 'off', sit: 'second' });
  let html = Ev.render(S);
  ok('six rows, the chosen one pressed', (html.match(/class="ev-row[ "]/g) || []).length === 6 && /ev-row on" data-evsit="second"/.test(html));
  ok('the lede reads the offence', /<b>Leeds Force<\/b> on offence: 8 chances, 11 points, <b>1\.38<\/b> points per chance/.test(html));
  ok('a situation with no located shots says so rather than drawing an empty court', /No shot locations were recorded for this shot\./.test(html) && !/ev-dot/.test(html));
  Ev.setView({ sit: 'all' });
  html = Ev.render(S);
  ok('a court is drawn with the located shots on it, made and missed', /<svg[^>]*>/.test(html) && (html.match(/ev-dot made/g) || []).length === 1 && (html.match(/ev-dot miss/g) || []).length === 1 && /2 of 7 shots located/.test(html));
  ok('a name with markup in it is escaped', html.includes('Flo &lt;b&gt;Ray&lt;/b&gt;') || !html.includes('<b>Ray</b>'));
  Ev.setView({ side: 'def' });
  html = Ev.render(S);
  ok('defence is the other side\'s offence against this one', /<b>Hull Pirates<\/b> against <b>Leeds Force<\/b>’s defence: 7 chances, 6 points/.test(html));
  Ev.setView({ team: 1, side: 'off', sit: 'ato' });
  html = Ev.render(S);
  ok('the after-timeout list names whose timeout it was', (html.match(/<li class="(scored|blank)">/g) || []).length === 2 &&
     html.includes('Hull Pirates timeout') && html.includes('Leeds Force timeout'));
  ok('no video, no WATCH VIDEO', !/ev-watch/.test(html));
  ok('the free-throw assist is explained under the split', /Plus 1 assist on a pass that drew free throws/.test(html));
  /* with footage that can place only the three */
  globalThis.EpinoiaVideo = { index: () => [{ id: 30 }] };
  const withVideo = Object.assign({}, S, { video: { url: 'https://youtu.be/AbCdEfGhIjK' } });
  html = Ev.render(withVideo);
  ok('WATCH VIDEO only on a play the footage has, naming that play',
     (html.match(/class="ev-watch"/g) || []).length === 1 && /data-evwatch="30"/.test(html), (html.match(/data-evwatch="[^"]*"/g) || []).join());
  delete globalThis.EpinoiaVideo;
  ok('a game with no plays says so', /No plays yet/.test(Ev.render({ teams: S.teams, events: [] })));
  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
}

/* the numbers a row of a drawn table shows, in order (the <b>s; the <small>s are their captions) */
const strip = x => x.replace(/<[^>]+>/g, '');
const rowOf = (html, attr, k) => { const r = html.match(new RegExp('<tr[^>]*' + attr + '="' + k + '"[\\s\\S]*?</tr>')); return r ? r[0] : ''; };
const nums = row => (row.match(/<b[^>]*>[^<]*<\/b>/g) || []).map(strip).join('|');

console.log('\nevery player, tapped open');
{
  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
  let html = Ev.render(S);
  const order = [...html.matchAll(/class="ev-prow" data-evpid="([^"]+)"/g)].map(m => m[1]);
  ok('a players card with a row for each Leeds player who did anything, by points then shots', order.join() === 'h5,h1,h2,h3,h6,h4', order.join());
  ok('...all shut: no breakdown drawn, and no profile link for a pid that is not a platform id',
     (html.match(/aria-expanded="false"/g) || []).length === 6 && !/aria-expanded="true"/.test(html) && !/<table class="ev-mx">/.test(html) && !/ev-plink/.test(html));
  ok('...each row reads points, FG and eFG with the rim · mid · three diet',
     /data-evpid="h1" aria-expanded="false">[\s\S]*?<b>2<\/b><small>pts<\/small>[\s\S]*?<b>0\/2<\/b><small>FG<\/small>[\s\S]*?ev-pefg few"><b>0%<\/b>[\s\S]*?0 rim · 2 mid · 0 three/.test(html));
  ok('who scored and most unassisted: a Shots button beside each name (2 + 3), none inside a link',
     (html.match(/class="ev-pbtn" data-evpid=/g) || []).length === 5 && /class="ev-pbtn" data-evpid="h5"/.test(html));
  ok('the card adds no court and leaves the counted classes alone',
     (html.match(/class="ev-row[ "]/g) || []).length === 6 && !/ev-dot/.test(html) && !/<li class="(scored|blank)">/.test(html) && !/data-pid=|data-team-slot/.test(html));

  Ev.setView({ pid: 'h1' });
  html = Ev.render(S);
  let mx = html.match(/<table class="ev-mx">[\s\S]*?<\/table>/g) || [];
  ok('setView({pid}) opens exactly that player\'s breakdown, under that player\'s row',
     mx.length === 1 && (html.match(/aria-expanded="true"/g) || []).length === 1 && /data-evpid="h1" aria-expanded="true" aria-controls="ev-pm-1"/.test(html) && /<li class="ev-pitem open">/.test(html) && /id="ev-pm-1"/.test(html));
  const row = k => rowOf(mx[0] || '', 'data-evk', k);
  ok('...eight rows: six situations, then assisted and unassisted', ['all', 'second', 'transition', 'offTo', 'ato', 'half', 'ast', 'unast'].every(k => row(k)) && /All shots[\s\S]*Second chance[\s\S]*Transition[\s\S]*Off turnovers[\s\S]*After timeout[\s\S]*Half court[\s\S]*Assisted[\s\S]*Unassisted/.test(mx[0] || ''));
  ok('...all shots: 2 points (2/2 FT), 0/2, eFG 0%, no rim shots, mid 0/2, no threes', nums(row('all')) === '2|0/2|0%|–|0/2|–' && /2\/2 FT/.test(row('all')), nums(row('all')));
  ok('...second chance: the one free throw inside the window', nums(row('second')) === '1|–|–|–|–|–' && /1\/1 FT/.test(row('second')), nums(row('second')));
  ok('...half court: the two missed jumpers, greyed on so few', nums(row('half')) === '0|0/2|0%|–|0/2|–' && /<b class="few">0%<\/b>/.test(row('half')), nums(row('half')));
  ok('...nothing in transition is a dimmed zero row', /class="ev-mxsit zero" data-evk="transition"/.test(mx[0] || ''));
  ok('...made baskets: none, so nothing to split', nums(row('ast')) === '0|0|–|–|–|–' && nums(row('unast')) === '0|0|–|–|–|–', nums(row('ast')) + ' / ' + nums(row('unast')));
  ok('...and the note says why those rows count makes', /a missed shot has no assist/.test(html));
  ok('the Shots buttons know which player is open (Ada is in who scored on second chances)',
     (html.match(/class="ev-pbtn on"/g) || []).length === 1 && /class="ev-pbtn on" data-evpid="h1"/.test(html));

  Ev.setView({ pid: 'h5' });
  html = Ev.render(S);
  mx = html.match(/<table class="ev-mx">[\s\S]*?<\/table>/g) || [];
  ok('Eve Park: the three off the turnover, 1/1 and eFG 150%', nums(row('offTo')) === '3|1/1|150%|–|–|1/1', nums(row('offTo')));
  ok('...unassisted: 1 basket (100% of her makes), 3.00 points a basket, from three; assisted: none',
     nums(row('unast')) === '3|1|3.00|–|–|1' && /100% of makes/.test(row('unast')) && nums(row('ast')) === '0|0|–|–|–|0', nums(row('unast')) + ' / ' + nums(row('ast')));
  ok('...the shot distribution bar is all threes, with its share written', /data-evk="offTo"[\s\S]*?ev-mxbar"><span class="ev-stack"><i class="z2" style="flex:1"[^>]*><\/i><\/span><small>0 · 0 · 100%<\/small>/.test(mx[0] || ''));
  ok('...and her Shots buttons show open', /class="ev-pbtn on" data-evpid="h5"/.test(html));

  /* a platform player: the profile link sits beside the toggle, never inside a button */
  const U = '6f845299-c63c-4fca-9c14-19092991ba8f';
  const swap = v => (v === 'h1' ? U : v);
  const SU = Object.assign({}, S, {
    teams: S.teams.map(tm => Object.assign({}, tm, { players: tm.players.map(p => Object.assign({}, p, { id: swap(p.id) })) })),
    events: S.events.map(e => Object.assign({}, e, { pid: swap(e.pid) }))
  });
  Ev.setView({ pid: U });
  html = Ev.render(SU);
  ok('a platform player keeps the profile link beside the row, and no link is inside a button',
     html.includes('<a class="ev-plink" href="../p/?p=' + U + '"') && html.includes('data-evpid="' + U + '" aria-expanded="true"') &&
     !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a /.test(html));

  Ev.setView({ team: 0, side: 'off', pid: 'h1' });
  Ev.setView({ team: 1 });
  ok('another team shuts the open player', Ev.view.pid === null && !/aria-expanded="true"/.test(Ev.render(S)));
  Ev.setView({ team: 0, pid: 'h1' });
  Ev.setView({ side: 'def' });
  ok('...and so does the other end', Ev.view.pid === null);
  Ev.setView({ team: 0, side: 'off', pid: 'a1' });
  html = Ev.render(S);
  ok('a player of the other side is never drawn open', !/aria-expanded="true"/.test(html) && !/<table class="ev-mx">/.test(html));

  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
  html = Ev.render(S);
  const az = (html.match(/<table class="ev-mx az">[\s\S]*?<\/table>/) || [''])[0];
  const zr = k => rowOf(az, 'data-evz', k);
  ok('assisted and unassisted by zone: rim 3/3, 100%, eFG 100%, 1 assisted, 2 not, 33% assisted', nums(zr('rim')) === '3/3|100%|100%|1|2|33%', nums(zr('rim')));
  ok('...mid 0/3 with no baskets to split', nums(zr('mid')) === '0/3|0%|0%|0|0|–', nums(zr('mid')));
  ok('...3PT 1/1, eFG 150% (greyed: one shot), the make unassisted', nums(zr('three')) === '1/1|100%|150%|0|1|0%' && /<b class="few">150%<\/b>/.test(zr('three')), nums(zr('three')));
  ok('...all 4/7, eFG 64%, 1 assisted and 3 not, 25% assisted', nums(zr('all')) === '4/7|57%|64%|1|3|25%', nums(zr('all')));
  ok('...points per basket: 2.00 assisted, 2.33 unassisted', nums(zr('ppb')) === '2.00|2.33', nums(zr('ppb')));
  ok('...each zone\'s share of each group\'s baskets', /100% of assisted/.test(zr('rim')) && /67% of unassisted/.test(zr('rim')) && /33% of unassisted/.test(zr('three')));
  ok('...and a note on why there is no assisted eFG%', /There is no eFG% for assisted shots\. Only a basket can be assisted, a miss cannot/.test(html));
  Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
}

/* ---- real games, through the ingest's own translator ----------------------- */
console.log('\nreal LiveStats games agree with the box score');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    'sys.stdout.write(json.dumps(T))',
  ].join('\n');
  const feeds = [
    path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702542.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702545.json')
  ];
  for (const f of feeds) {
    let T = null;
    for (const exe of ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), f], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
    }
    const name = path.basename(f);
    ok(name + ' translates', !!T);
    if (!T) continue;
    const G = {
      teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0,
      events: T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    const C = Ev.compute(G);
    [0, 1].forEach(t => {
      const s = C.side[t].sits;
      ok(name + ' team ' + t + ': points, 2nd chance, off turnovers and fast break are the box score\'s',
         s.all.pts === d.score[t] && s.second.pts === d.team[t].sc && s.offTo.pts === d.team[t].pot && s.transition.pts === d.team[t].fast,
         [s.all.pts, d.score[t], s.second.pts, d.team[t].sc, s.offTo.pts, d.team[t].pot, s.transition.pts, d.team[t].fast].join(' '));
      const P = G.teams[t].players.map(p => d.stats[p.id]).filter(Boolean);
      const sum = k => P.reduce((n, x) => n + x[k], 0);
      ok(name + ' team ' + t + ': field goals, rim attempts and assists are the box score\'s',
         s.all.fga === sum('p2a') + sum('p3a') && s.all.fgm === sum('p2m') + sum('p3m') && s.all.zones.rim.a === sum('rimA') &&
         C.side[t].assists.ast.fgm + C.side[t].assists.ftAssists === sum('ast'),
         [s.all.fga, sum('p2a') + sum('p3a'), s.all.zones.rim.a, sum('rimA'), C.side[t].assists.ast.fgm, C.side[t].assists.ftAssists, sum('ast')].join(' '));
      ok(name + ' team ' + t + ': every situation is a subset of the whole',
         ['second', 'transition', 'offTo', 'ato', 'half'].every(k => s[k].chances <= s.all.chances && s[k].pts <= s.all.pts && s[k].fga <= s.all.fga));
    });
    [0, 1].forEach(t => {
      const PL = C.side[t].players;
      const bad = [];
      G.teams[t].players.forEach(p => {
        const x = d.stats[p.id];
        if (!x) return;
        const q = PL[p.id];
        if (!q) { if (x.pts || x.p2a || x.p3a || x.fta) bad.push(p.id + ' has no line'); return; }
        const s = q.sits;
        if (s.second.pts !== x.sc || s.offTo.pts !== x.pot || s.transition.pts !== x.fast) bad.push(p.id + ' sc/pot/fast ' + [s.second.pts, x.sc, s.offTo.pts, x.pot, s.transition.pts, x.fast].join(' '));
        if (s.all.pts !== x.pts || s.all.fga !== x.p2a + x.p3a || s.all.zones.rim.a !== x.rimA) bad.push(p.id + ' pts/fga/rimA ' + [s.all.pts, x.pts, s.all.fga, x.p2a + x.p3a, s.all.zones.rim.a, x.rimA].join(' '));
        if (q.ast.fgm + q.unast.fgm !== x.p2m + x.p3m) bad.push(p.id + ' ast+unast ' + [q.ast.fgm, q.unast.fgm, x.p2m + x.p3m].join(' '));
      });
      ok(name + ' team ' + t + ': every player\'s second-chance, off-turnover and fast-break points, points, FGA, rim attempts and baskets are the engine\'s',
         !bad.length && Object.keys(PL).length > 0, bad.slice(0, 4).join('; '));
    });
    const timeouts = G.events.filter(e => e.t === 'timeout').length;
    const atos = C.side[0].ato.length + C.side[1].ato.length;
    ok(name + ': no more after-timeout plays than timeouts (' + atos + ' of ' + timeouts + ')', atos <= timeouts && (timeouts === 0 || atos > 0));
    Ev.setView({ team: 0, side: 'off', sit: 'second', pid: null });
    let html = Ev.render(G);
    ok(name + ': the tab renders', /class="ev-rows"/.test(html) && /ev-assist/.test(html));
    const rows = (html.match(/class="ev-prow"/g) || []).length;
    const top = [...html.matchAll(/class="ev-prow" data-evpid="([^"]+)"/g)].map(m => m[1])[0];
    Ev.setView({ pid: top });
    html = Ev.render(G);
    ok(name + ': a row per player who did anything (' + rows + '), and the top scorer opens with 8 rows and the zone table',
       rows === Object.keys(C.side[0].players).length && (html.match(/<table class="ev-mx">/g) || []).length === 1 &&
       (html.match(/data-evk="/g) || []).length === 8 && /<table class="ev-mx az">/.test(html));
    Ev.setView({ pid: null });
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
