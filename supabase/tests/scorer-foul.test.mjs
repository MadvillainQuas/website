/* ============================================================================
   THE ✕ THAT DELETED THE FOUL IT WAS ADVERTISED TO CANCEL.

   A defensive personal foul not in the bonus is the commonest foul in a game.
   It opens a follow-up window holding one step — the foul — with no flow behind
   it, and the legend for that window named exactly one way out:

       ✕  —  no free throws

   cancelStep then fell through every guard above it (no pick, no armed free
   throws, one step not two, no flow to walk back) and reached
   removeEventKeep(steps[0]) — which is the foul. The toast read "cancelled:
   foul on #12 smith" and was gone in a couple of seconds; the player's foul
   badge quietly dropped back a number.

   Nothing else says so. By the fourth quarter a player carrying five fouls is
   still on the floor, and the team count — the thing that decides when the
   bonus starts, and therefore who shoots free throws for the rest of the
   period — is short by however many times it happened.

   Two changes, tested here: the green disc is named as the exit that means "no
   free throws", and the delete asks first.

     node supabase/tests/scorer-foul.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* the same lift the takeover test uses: pull one function out of the page and
   run the shipped source, not a paraphrase of it */
function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}

/* --------------------------------------------------------------- the legend */
console.log('\nwhat the foul window says it does');

const foulLegend = src.slice(src.indexOf("} else if(p.kind==='foul'){"),
                             src.indexOf("} else if(p.kind==='foul'){") + 1400);

ok('the exit that means "no free throws" is the green one, and is named',
   /k\(DONEK\(\),'no free throws/.test(foulLegend));
ok('...and the cancel key says what it actually does',
   /k\(CANCK\(\),'delete the foul','x'\)/.test(foulLegend));
ok('...and nothing still calls the delete "no free throws"',
   !/k\('✕','no free throws'/.test(src));

/* --------------------------------------------------------- and what it does */
console.log('\nand what it actually does');

/* One standalone foul window: a defensive personal, not in the bonus, nothing
   recorded after it. This is the shape that lost fouls. */
function harness(pending) {
  const events = new Map([[41, { id: 41, t: 'foul', team: 0, pid: 'p12', kind: 'personal' }]]);
  const log = { removed: [], toasts: [], asked: null, saved: 0 };
  const ui = { pending, subOut: null, armed: null, foulType: null };
  const cancelStep = new Function(
    'ui', 'evById', 'removeEventKeep', 'renderAll', 'toast', 'save', 'resetPend',
    'evLabel', 'askConfirm', 'pname', 'flowSteps',
    lift(src, 'function cancelStep()') + '\nreturn cancelStep;')(
      ui,
      id => events.get(id) || null,
      id => { log.removed.push(id); events.delete(id); },
      () => {}, m => log.toasts.push(m), () => log.saved++, () => {},
      ev => (ev ? ev.t : ''),
      (title, yes) => { log.asked = { title, yes }; },
      pid => '#12 smith',
      () => ['where']);
  return { cancelStep, events, log, ui };
}

const foulPending = () => ({ kind: 'foul', team: 0, pid: 'p12', anchorIdx: 41,
                             foulIdx: 41, steps: [41], ftExp: 0 });

{
  const h = harness(foulPending());
  h.cancelStep();
  ok('a foul is not deleted on the first press', h.events.has(41));
  ok('...the scorer is asked, and the question names the player',
     !!h.log.asked && /delete the foul on #12 smith\?/.test(h.log.asked.title),
     h.log.asked ? h.log.asked.title : 'nothing was asked');
  ok('...and the window is still open behind the question', h.ui.pending !== null);

  h.log.asked.yes();
  ok('saying yes deletes it', !h.events.has(41) && h.log.removed[0] === 41);
  ok('...closes the window', h.ui.pending === null);
  ok('...and says plainly what happened', /foul deleted/.test(h.log.toasts.join(' ')));
}

{
  /* Saying no is the whole point: the foul survives and the window is untouched,
     so the scorer can still take the free throws it might turn out to need. */
  const h = harness(foulPending());
  h.cancelStep();
  ok('saying nothing leaves the foul on the sheet', h.events.has(41));
  ok('...and leaves the window open to take free throws in', h.ui.pending !== null);
}

{
  /* The window can expire while the question is on screen, and the scorer can be
     inside a NEW window by the time they answer. The answer must still delete the
     foul it was asked about, and must not close somebody else's window. */
  const h = harness(foulPending());
  h.cancelStep();
  const other = { kind: 'made', team: 1, pid: 'p7', steps: [55] };
  h.ui.pending = other;
  h.log.asked.yes();
  ok('a late yes still deletes the foul it asked about', !h.events.has(41));
  ok('...and does not close the window the scorer has since opened',
     h.ui.pending === other);
}

{
  /* Everything else in this window is still a draft and still goes at once. A
     shooting foul arrives as a SECOND step on a shot's window, so ✕ there pops
     the foul off the top without a question — which is what ✕ means there, and
     the shot beneath it is untouched. */
  const h = harness({ kind: 'miss', team: 0, pid: 'p9', shot: 'p2',
                      anchorIdx: 40, foulIdx: 41, steps: [40, 41] });
  h.events.set(40, { id: 40, t: 'p2_miss', team: 0, pid: 'p9' });
  h.cancelStep();
  ok('a foul recorded as a follow-up to a shot still cancels with one press',
     h.log.asked === null && !h.events.has(41));
  ok('...and the shot it was attached to is untouched', h.events.has(40));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
