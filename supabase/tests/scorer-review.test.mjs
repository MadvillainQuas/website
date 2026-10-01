/* ============================================================================
   THE SCORER'S ROUND OF FIXES (2026-10-01): the rules it got wrong, the gaps a real game falls into, and the
   places a thumb went wrong.

   What is held here, on the engine itself and on the scorer's own functions lifted out of the page (the shipped
   source, not a paraphrase):
     * one engine: the scorer derives through epinoia/engine.js, loaded before its script;
     * a missed shot the shooter was fouled on is no attempt: the foul carries its shot, and while it stands the
       shot is p2_fouled / p3_fouled, which nothing counts and the play-by-play still prints; delete or soften the
       foul and it is a miss again;
     * a team that runs out of players plays short: a change with one side empty ({out, in:null} / {out:null, in}),
       in the engine, RAPM and the rotation alike; the bulk panel allows it only when nobody is left to send on;
       fouled-out and disqualified players never come back on;
     * bench fouls: a coach's or substitute's technical, unsportsmanlike or disqualifying foul is no team foul;
     * rebounds only where the ball is live (not after the first of two, not after a technical's free throw),
       no assist or block on a free throw — the same answer for gestures, chips and typed commands;
     * the window's foul survives its free throws (no double foul, the chips change the recorded foul);
     * the editor: a substitution added or moved at a past time, checked against who was on court then; ties at
       the end of a period stay in it; an unchanged time keeps its milliseconds;
     * undo: a play with its descriptors, an offensive foul with its turnover, a period start with the period;
     * ending: a level score offers overtime, an early end or a fouled-out player on court is named, and the final
       screen reopens the game; a finalised one is read-only;
     * saving: a game in progress is never replaced without a question and a copy, a read-only tab never writes,
       the clock is stamped so a restored game can catch up.

     node supabase/tests/scorer-review.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const page = read('epinoia/score/index.html');
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'epinoia', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 400))); } };

function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}
/* the named functions of the page, run in a context holding the stand-ins they read */
function pageFns(names, ctx) {
  const box = vm.createContext(Object.assign({ console, Set, Map, Math, JSON, Number, String, Array, Object }, ctx));
  vm.runInContext(names.map(n => lift(page, 'function ' + n + '(')).join('\n'), box);
  return box;
}

/* ------------------------------------------------------------------ a small game for the engine --- */
const squad = (t, n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + t + '_' + i, name: 'player ' + t + i, num: String(i + 4) }));
const game = (events, extra) => Object.assign({
  teams: [{ name: 'home', players: squad(0, 7) }, { name: 'away', players: squad(1, 7) }],
  starters: [squad(0, 5).map(p => p.id), squad(1, 5).map(p => p.id)],
  events, period: 1, clockMs: 300000, tipWinner: 0, arrowInit: 1
}, extra || {});
let id = 0;
const ev = (t, o) => Object.assign({ id: ++id, t, period: 1, clock: 600000 - id * 1000 }, o || {});

console.log('one engine');
{
  const engineTag = page.indexOf('<script src="../engine.js');
  const inline = page.indexOf('/* ==================== core state ==================== */');
  ok('the scorer loads engine.js before its own script (and so its offline copy holds it)', engineTag > 0 && engineTag < inline);
  const derive = lift(page, 'function derive(');
  ok('derive() is the engine\'s deriveGame on the scorer\'s state, the page\'s copy only the fallback',
     /EpinoiaEngine/.test(derive) && /deriveGame\(\{teams:S\.teams, starters:S\.starters, events:S\.events/.test(derive) && /format:gameFmt\(\)/.test(derive) && /return deriveHere\(\)/.test(derive));
}

console.log('\na missed shot the shooter was fouled on');
{
  id = 0;
  const shot = ev('p2_fouled', { team: 0, pid: 'p0_0' });
  const g = game([ev('period_start', { clock: 600000 }), shot,
    ev('foul', { team: 1, pid: 'p1_0', kind: 'shooting', drawn: 'p0_0', shot: shot.id }),
    ev('ft_miss', { team: 0, pid: 'p0_0' }), ev('ft_made', { team: 0, pid: 'p0_0' }),
    ev('p3_miss', { team: 0, pid: 'p0_1' })]);
  const d = E.deriveGame(g);
  ok('the engine counts no attempt for it: p2a 0, two free throws, one point', d.stats.p0_0.p2a === 0 && d.stats.p0_0.fta === 2 && d.stats.p0_0.pts === 1, d.stats.p0_0);
  ok('...and the team\'s on-court shooting has only the real attempt (one FGA: the 3)', d.stats.p0_0.oc.tFGA === 1, d.stats.p0_0.oc);
  ok('...while the play-by-play still says what happened', d.pbp.some(l => /2pt missed, fouled/.test(l.txt)), d.pbp.map(l => l.txt));

  const S = { events: [ { id: 1, t: 'p2_miss', team: 0 }, { id: 2, t: 'foul', team: 1, kind: 'shooting', shot: 1 },
                        { id: 3, t: 'p3_miss', team: 0 }, { id: 4, t: 'foul', team: 1, kind: 'unsport', shot: 3 } ] };
  const box = pageFns(['syncFouledShots'], { S, SHOT_FOULS: ['shooting', 'unsport', 'disq'] });
  box.syncFouledShots();
  ok('the scorer marks the shot while its shooting (or unsportsmanlike) foul stands', S.events[0].t === 'p2_fouled' && S.events[2].t === 'p3_fouled');
  S.events[1].kind = 'personal'; box.syncFouledShots();
  ok('...a plain personal foul does not (it was not in the act of shooting)', S.events[0].t === 'p2_miss' && S.events[2].t === 'p3_fouled');
  S.events.splice(3, 1); box.syncFouledShots();
  ok('...and a foul deleted or undone gives the shot back as a miss', S.events[2].t === 'p3_miss');
  const save = lift(page, 'function save(');
  ok('save() keeps it true on every write, whichever route changed the log', /syncFouledShots\(\);/.test(save));
  const tap = lift(page, 'function tap(');
  ok('the fouler tapped in a missed shot\'s window carries that shot', /if\(s0 && \/\^p\[23\]_miss\$\/\.test\(s0\.t\) && s0\.team===p\.team\) fe\.shot = s0\.id;/.test(tap));
}

console.log('\na team that runs out of players');
{
  id = 0;
  const g = game([ev('period_start', { clock: 600000 }),
    ev('sub', { team: 0, out: 'p0_0', in: null, clock: 400000 }),
    ev('p2_made', { team: 1, pid: 'p1_0', clock: 350000 }),
    ev('sub', { team: 0, out: null, in: 'p0_5', clock: 300000 })], { clockMs: 300000 });
  const d = E.deriveGame(g);
  ok('{out, in:null}: he leaves and nobody replaces him — four on court, his minutes stop', d.stats.p0_0.min === 200000 && d.stats.p0_1.pm === -2 && d.stats.p0_0.pm === 0, [d.stats.p0_0.min, d.stats.p0_0.pm]);
  ok('{out:null, in}: a player comes on to a team that was short — five again', d.onCourt[0].length === 5 && d.onCourt[0].includes('p0_5') && !d.onCourt[0].includes(null), d.onCourt[0]);
  ok('the play-by-play says both in words', d.pbp.some(l => /leaves the court, no substitute/.test(l.txt)) && d.pbp.some(l => /comes on$/.test(l.txt)), d.pbp.map(l => l.txt));
  ok('RAPM and the rotation never put a null on court', /if \(ev\.in != null && onCourt\[t\]\.indexOf\(ev\.in\) === -1\)/.test(read('epinoia/rapm.js')) && /if \(ev\.in != null && lastIn\[ev\.in\] == null\)/.test(read('epinoia/rotation.js')));

  const D = { onCourt: [['a', 'b', 'c', 'd', 'e'], []], stats: { a: { pf: 5 }, b: {}, c: {}, d: {}, e: {}, f: { pf: 5 }, g: { dq: true }, h: {} } };
  const S = { teams: [{ players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(x => ({ id: x })) }] };
  const box = pageFns(['eligible', 'subPanelState'], { D, S, SUBP: null });
  box.SUBP = { team: 0, outs: new Set(['a']), ins: new Set() };
  ok('the panel will not take a player off with nobody on while somebody can still play', box.subPanelState().ok === false && /1 on the bench can still play/.test(box.subPanelState().why), box.subPanelState());
  box.SUBP = { team: 0, outs: new Set(['a']), ins: new Set(['h']) };
  ok('...a straight change is fine', box.subPanelState().ok === true);
  D.stats.h = { pf: 5 };
  box.SUBP = { team: 0, outs: new Set(['a']), ins: new Set() };
  ok('...and with nobody eligible left (fouled out, disqualified) the team plays with four', box.subPanelState().ok === true && box.subPanelState().after === 4, box.subPanelState());
  box.SUBP = { team: 0, outs: new Set(), ins: new Set(['b']) };
  ok('...never six on court', box.subPanelState().ok === false && /6 on court/.test(box.subPanelState().why));
  ok('fouled-out and disqualified players are not eligible to come on', box.eligible('f') === false && box.eligible('g') === false && box.eligible('b') === true);
  ok('the gesture, the tap and the panel all refuse them', /ui\.subOut\.team===team && !onCourtHas\(team,pid\) && eligible\(pid\)/.test(page) &&
     /if\(!eligible\(pid\)\)\{ toast\(pname\(pid\)\+' has fouled out — they cannot come back on'/.test(page) && /c\.classList\.contains\('locked'\)/.test(page));
  ok('the header says when a team is not five on court', /D\.onCourt\[t\]\.length!==5\?' <span class="bonus">· '\+D\.onCourt\[t\]\.length\+' on court<\/span>'/.test(page));
}

console.log('\nbench fouls');
{
  id = 0;
  const d = E.deriveGame(game([ev('period_start', { clock: 600000 }),
    ev('foul', { team: 0, pid: null, kind: 'tech' }), ev('foul', { team: 0, pid: null, kind: 'unsport' }), ev('foul', { team: 0, pid: null, kind: 'disq', by: 'p0_6' }),
    ev('foul', { team: 0, pid: null, kind: 'personal' }), ev('foul', { team: 0, pid: 'p0_1', kind: 'tech' })]));
  ok('a bench technical, unsportsmanlike or disqualifying foul is no team foul; a player\'s technical and a team personal foul are',
     d.team[0].foulsP[1] === 2 && d.team[0].foulTot === 5, [d.team[0].foulsP, d.team[0].foulTot]);
  ok('a fouled-out player\'s foul is recorded as the bench\'s, with who it was', /addEvent\(\{t:'foul',team,pid:null,kind:bk,by:pid\}\)/.test(page));
}

console.log('\nwhat a window offers');
{
  const evs = { 7: { id: 7, t: 'foul', kind: 'shooting' }, 8: { id: 8, t: 'foul', kind: 'tech' } };
  const box = pageFns(['foulKindOf', 'reboundLive', 'followUpWhyNot'], { evById: x => evs[x] });
  const W = o => Object.assign({ kind: 'miss', shot: 'p2' }, o);
  ok('a missed field goal: rebound and block', box.followUpWhyNot('reb', W()) === null && box.followUpWhyNot('blk', W()) === null);
  ok('the first of two free throws: no rebound (the ball is dead)', box.followUpWhyNot('reb', W({ shot: 'ft', foulIdx: 7, ftCount: 1, ftExp: 2 })) !== null);
  ok('the last of them: the rebound', box.followUpWhyNot('reb', W({ shot: 'ft', foulIdx: 7, ftCount: 2, ftExp: 2 })) === null);
  ok('a technical\'s free throw: never a rebound', box.followUpWhyNot('reb', W({ shot: 'ft', foulIdx: 8, ftCount: 1, ftExp: 1 })) !== null);
  ok('no block on a free throw, no assist on one', box.followUpWhyNot('blk', W({ shot: 'ft' })) !== null && box.followUpWhyNot('ast', { kind: 'made', shot: 'ft' }) !== null && box.followUpWhyNot('ast', { kind: 'made', shot: 'p3' }) === null);
  ok('the gestures, the pick chips and the typed commands all ask the same function',
     /if\(reboundLive\(p\)\) o\.push\(\{dir:inw, label:'rebound', act:'reb'\}\)/.test(page) && /if\(followUpWhyNot\(act,p\)\) return false;/.test(page) && /const why = followUpWhyNot\(f\.act, ui\.pending\);/.test(page));
  const setPend = lift(page, 'function setPend(');
  ok('the window\'s foul survives its free throws (no second foul, the chips change the recorded one)', /const foulIdx = ui\.pending \? ui\.pending\.foulIdx : null;/.test(setPend) && /steps, foulIdx\}/.test(setPend));
}

console.log('\nthe play-by-play editor');
{
  const PLEN = p => (p <= 4 ? 600000 : 300000);
  const cumEl = (p, clk) => { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); };
  const S = { starters: [['a', 'b', 'c', 'd', 'e'], []], events: [
    { id: 1, t: 'period_start', period: 1, clock: 600000 },
    { id: 2, t: 'sub', team: 0, out: 'a', in: 'f', period: 1, clock: 400000 },
    { id: 3, t: 'period_start', period: 2, clock: 600000 },
    { id: 4, t: 'sub', team: 0, out: 'f', in: 'g', period: 2, clock: 500000 } ] };
  const box = pageFns(['insertPos', 'onCourtAt', 'lineupProblem'], { S, PLEN, cumEl, pname: x => x, perName: p => 'q' + p, fmtClock: ms => String(ms / 1000) });
  ok('an action added at Q1 0:00 goes before Q2\'s start, not after it', box.insertPos(cumEl(1, 0), 1) === 2);
  ok('who was on court at a moment comes from the starters and the changes before it', JSON.stringify(box.onCourtAt(0, 1, 500000)) === JSON.stringify(['a', 'b', 'c', 'd', 'e']) && box.onCourtAt(0, 1, 300000).includes('f') && !box.onCourtAt(0, 1, 300000).includes('a'));
  ok('...leaving out the change being edited', box.onCourtAt(0, 1, 300000, 2).includes('a'));
  ok('a log whose changes fit has no problem', box.lineupProblem() === null);
  ok('deleting a change the later ones build on is named', /f is taken off but is not on court then/.test(box.lineupProblem(S.events.filter(e => e.id !== 2)) || ''), box.lineupProblem(S.events.filter(e => e.id !== 2)));
  ok('substitutions can be added and edited in the editor, checked against who was on court',
     /\['sub','substitution'\]/.test(page) && !/subs can’t be edited/.test(page) && /is not on court at '\+perName\(EM\.period\)/.test(page));
  ok('an unchanged time keeps its milliseconds and its video stamp (compared to the second, as the box shows it)',
     /Math\.ceil\(\(ev\.clock\|\|0\)\/1000\) !== Math\.ceil\(clock\/1000\)/.test(page) && /clock: moved \? clock : ev\.clock/.test(page));
}

console.log('\nundo, ending, reopening');
{
  const undo = lift(page, 'function undo('), redo = lift(page, 'function redo(');
  ok('undoing a period start takes the game back to the end of the period before', /S\.period = last\.period - 1; S\.clockMs = 0; S\.running = false;/.test(undo) && /the start of the game cannot be undone/.test(undo));
  ok('...a play\'s descriptors come off with it, and an offensive foul with its turnover', /DESC\.includes\(e\.t\) && e\.ref===ref/.test(undo) && /e\.kind==='offensive'/.test(undo));
  ok('...and redo puts a group back, re-advancing a period it restores', /Array\.isArray\(x\)/.test(redo) && /S\.period = ev\.period; S\.clockMs = PLEN\(ev\.period\)/.test(redo));
  const req = lift(page, 'function requestEndGame(');
  ok('ending at a level score offers overtime first', /a game cannot end tied/.test(req) && /'play overtime'/.test(req));
  ok('...an early end and a fouled-out player on court are named', /only '\+perName\(S\.period\)\+' has been reached/.test(req) && /fouled out and/.test(req));
  ok('the menu\'s "end game" asks through it', /\$\('#btnEnd'\)\.addEventListener\('click', \(\)=>\{\s*\$\('#sheet'\)\.classList\.remove\('open'\);\s*requestEndGame\(\);/.test(page));
  const fin = lift(page, 'function renderFinal(');
  ok('the final screen reopens the game, and offers the scoresheet and the match details', /id="reopenB"/.test(fin) && /#finSheet/.test(fin) && /#finDetails/.test(fin));
  ok('a finalised game is read-only in the editor until it is reopened (through finalise-game)',
     /function saveEvModal\(\)\{\s*if\(finalisedHold\(\)\) return;/.test(page) && /window\.epReopenFixture/.test(lift(page, 'function reopenGame(')));
}

console.log('\nsaving');
{
  const save = lift(page, 'function save(');
  ok('a tab that is not the one scoring never writes over the game', /if\(window\.epReadOnly\) return;/.test(save));
  ok('every write is stamped, and a page going away writes the clock as it stands', /S\.savedAt = Date\.now\(\)/.test(save) && /addEventListener\('pagehide', saveOnLeave\)/.test(page));
  const launch = lift(page, 'function launchGame(');
  ok('starting a new game over one in progress asks, and keeps a copy of the old one', /if\(savedInPlay\)/.test(launch) && /EP_KEY\+':replaced'/.test(launch));
  ok('a practice game says so, so bootstrap.js never publishes it', /if\(trainingSetup \|\| EP_TRAIN\) S\.training = true;/.test(launch));
  ok('a game restored with its clock running offers the time the board should show', /offerClockCatchUp\(Date\.now\(\) - at\)/.test(page));
}

console.log('\nthe thumb');
{
  ok('the click a row tap leaves behind never lands on the team header', /if\(Date\.now\(\) - rowGestureAt < 450\) return;/.test(page));
  ok('the "✓ done" and "✕ back" pills in the legend are buttons', /data-hact/.test(page) && /b\.dataset\.hact==='done'\) finishWindow\(\); else cancelStep\(\);/.test(page));
  ok('the done disc is readable on a phone', /#doneB \.xin\{color:var\(--lume, #93f2bf\);\}/.test(page));
  ok('a held ball and a violation stop the clock', /S\.running = false;\s*\/\/ a held ball is a dead ball/.test(page) && /DEAD\.includes\(v\)/.test(page));
  ok('a foul with no free throws due closes by itself', /const idleFoul = ui\.pending && ui\.pending\.kind==='foul' && !ui\.pending\.ftExp/.test(page));
  ok('starting needs a full set of starters', /has '\+S\.starters\[t\]\.length\+' starters — pick '\+want\+' in edit squads/.test(page));
}

console.log('\nthe sheet and who was fouled');
{
  const sheet = lift(page, 'function scoresheetHTML(');
  ok('the scoresheet lists each team\'s timeouts and its bench fouls, with who committed them',
     /<span>timeouts<\/span>/.test(sheet) && /<span>bench fouls<\/span>/.test(sheet) && /e\.by && PMAP\[e\.by\]/.test(sheet));
  const evs = { 5: { id: 5, t: 'foul', pid: 'x', kind: 'personal' }, 6: { id: 6, t: 'foul', pid: 'y', kind: 'tech' } };
  const box = pageFns(['drawnBy'], { evById: k => evs[k] });
  box.drawnBy({ foulIdx: 5 }, 'z'); box.drawnBy({ foulIdx: 6 }, 'z');
  ok('a foul from the foul button learns who was fouled from the first free throw — not a technical\'s', evs[5].drawn === 'z' && evs[6].drawn === undefined);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
