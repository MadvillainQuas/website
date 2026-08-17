/* ============================================================================
   The live path — publishing corrections, not just additions.

   The scorer has always had undo, redo, and an edit mode that inserts an event
   earlier in the log. The publisher tracked a high-water mark on the array's
   LENGTH, which cannot see any of those: an undo shortened the array below the
   mark, so nothing was published, and the mark stayed high so the next events
   were swallowed too.

   These tests drive the real diff and the real publisher through a fake
   transport, and assert what a viewer would end up holding. The final check is
   the one that matters: replay the published stream and compare the resulting
   box score against the scorer's own.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../epinoia/live.js');
const E = require('../../epinoia/engine.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + g + '\n        want ' + w); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

const ev = (id, extra) => Object.assign({ id, t: 'p2_made', team: 0, pid: 'h4' }, extra || {});

console.log('\ndiffLog — what changed since we last published');

eq('a fresh log is all new',
   L.diffLog([], [ev(1), ev(2)]).added.map(e => e.id), [1, 2]);
eq('and retracts nothing',
   L.diffLog([], [ev(1), ev(2)]).removed, []);

eq('an append publishes only the new one',
   L.diffLog([1, 2], [ev(1), ev(2), ev(3)]).added.map(e => e.id), [3]);

{
  const d = L.diffLog([1, 2, 3], [ev(1), ev(2)]);
  eq('an undo retracts the last event', d.removed, [3]);
  eq('and adds nothing', d.added, []);
}

{
  /* the case the old code broke on: undo, then score something else */
  const d = L.diffLog([1, 2, 3], [ev(1), ev(2), ev(4)]);
  eq('after an undo the replacement IS published', d.added.map(e => e.id), [4]);
  eq('and the retracted event is named', d.removed, [3]);
}

{
  /* a redo puts it back */
  const d = L.diffLog([1, 2], [ev(1), ev(2), ev(3)]);
  eq('a redo republishes the event', d.added.map(e => e.id), [3]);
}

{
  /* edit mode inserts earlier in the log — invisible to a length comparison */
  const d = L.diffLog([1, 2, 3], [ev(1), ev(9), ev(2), ev(3)]);
  eq('an insert republishes the tail', d.added.map(e => e.id), [9, 2, 3]);
  eq('and retracts what it displaced', d.removed, [2, 3]);
}

{
  const d = L.diffLog([1, 2, 3], [ev(1), ev(2), ev(3)]);
  ok('an unchanged log publishes nothing',
     !d.added.length && !d.removed.length);
}

{
  /* clearing the whole log */
  const d = L.diffLog([1, 2, 3], []);
  eq('every event is retracted', d.removed, [1, 2, 3]);
}

console.log('\nthe publisher carries retractions to the transport');
{
  /* The local transport persists through localStorage, which Node has not
     got. Give it just enough of one to observe what actually lands durably —
     a retraction that only reaches the socket would still leave a late joiner
     reading the retracted event out of the snapshot. */
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };

  const pub = L.publisher({ gameId: 'g1', mode: 'local' });
  const held = () => JSON.parse(store['eplive:g1'] || '{"events":[]}').events.map(e => e.seq);

  /* flush is async — the local transport writes inside a promise, so reading
     the store synchronously after calling it races the write */
  pub.pushEvents([{ seq: 1, t: 'p2_made' }, { seq: 2, t: 'p3_made' }]);
  await pub.flushNow();
  eq('both events reach the durable store', held(), [1, 2]);

  pub.pushEvents([], [2]);
  await pub.flushNow();
  eq('a retraction removes it from the store too', held(), [1]);

  pub.pushEvents([{ seq: 3, t: 'p2_made' }], []);
  await pub.flushNow();
  eq('and the replacement lands after it', held(), [1, 3]);

  pub.stop();
  delete globalThis.localStorage;
}

console.log('\nend to end: a scorer that corrects itself');
{
  /* Build a small game, undo one basket, and check the log a viewer would
     hold after applying the published stream. */
  const scorer = [
    ev(1, { t: 'period_start', team: null, pid: null, period: 1 }),
    ev(2, { t: 'p2_made', pid: 'h4' }),
    ev(3, { t: 'p3_made', pid: 'h5' }),
    ev(4, { t: 'p2_made', pid: 'h6' })
  ];

  /* the viewer's merge, exactly as the pages implement it */
  function applyFrame(held, frame) {
    if (frame.removed && frame.removed.length) {
      const gone = new Set(frame.removed);
      held = held.filter(e => !gone.has(e.id));
    }
    if (frame.full && frame.events) {
      return frame.events.slice().sort((a, b) => a.id - b.id);
    }
    if (frame.events) {
      const seen = new Set(held.map(e => e.id));
      frame.events.forEach(e => { if (!seen.has(e.id)) { seen.add(e.id); held.push(e); } });
      held.sort((a, b) => a.id - b.id);
    }
    return held;
  }

  let sentIds = [], viewer = [];
  const publish = (log) => {
    const d = L.diffLog(sentIds, log);
    if (!d.added.length && !d.removed.length) return;
    viewer = applyFrame(viewer, { events: d.added, removed: d.removed });
    sentIds = d.ids;
  };

  publish(scorer);
  eq('the viewer has the whole game', viewer.map(e => e.id), [1, 2, 3, 4]);

  /* the statistician undoes the last basket */
  const undone = scorer.slice(0, 3);
  publish(undone);
  eq('after an undo the viewer drops it too', viewer.map(e => e.id), [1, 2, 3]);

  /* and scores the right one instead */
  const corrected = undone.concat([ev(5, { t: 'p3_made', pid: 'h7' })]);
  publish(corrected);
  eq('and receives the replacement', viewer.map(e => e.id), [1, 2, 3, 5]);

  /* the box scores must now agree, which is the whole point */
  const teams = [
    { name: 'home', players: [{ id: 'h4', name: 'A' }, { id: 'h5', name: 'B' },
                              { id: 'h6', name: 'C' }, { id: 'h7', name: 'D' },
                              { id: 'h8', name: 'E' }] },
    { name: 'away', players: [{ id: 'a4', name: 'F' }, { id: 'a5', name: 'G' },
                              { id: 'a6', name: 'H' }, { id: 'a7', name: 'I' },
                              { id: 'a8', name: 'J' }] }
  ];
  const starters = [['h4','h5','h6','h7','h8'], ['a4','a5','a6','a7','a8']];
  const derive = evs => E.deriveGame({ teams, starters, events: evs, period: 1, clockMs: 0 });

  const theirs = derive(corrected), ours = derive(viewer);
  eq('the scores agree', ours.score, theirs.score);
  eq('and so does the retracted player\'s line',
     ours.stats['h6'].pts, theirs.stats['h6'].pts);
  eq('the replacement is credited', ours.stats['h7'].pts, 3);
  eq('the undone basket is not', ours.stats['h6'].pts, 0);
}

console.log('\na full snapshot is authoritative');
{
  /* Even a viewer that missed the retraction frame entirely must self-heal,
     because the scorer republishes its whole log every ten seconds. */
  let viewer = [ev(1), ev(2), ev(3)];      // holding a retracted event 3
  const frame = { full: true, events: [ev(1), ev(2)] };
  const gone = new Set(frame.removed || []);
  viewer = viewer.filter(e => !gone.has(e.id));
  if (frame.full) viewer = frame.events.slice().sort((a, b) => a.id - b.id);
  eq('a snapshot replaces rather than merges', viewer.map(e => e.id), [1, 2]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
