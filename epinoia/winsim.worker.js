'use strict';
/* ============================================================================
   WHAT WINS: THE SIMULATOR'S WORKER. Runs epinoia/winsim.js (and winstats.js) off the page's main thread.

   The page builds this worker's URL with its own script's ?v= stamp (new Worker('../winsim.worker.js?v=568')), and the
   worker loads its two scripts with the same stamp, so a deploy never mixes versions.

   PROTOCOL (docs/what-wins-model.md §8.5, addendum A.2)
     page -> worker   {id, op, args}         op: simulate | counterfactual | needed | shapley | season | calibrate |
                                              refit | bootstrap; args positional (an array) or named (an object)
                      {id, op: 'cancel'}     stops that job at its next slice; it answers {id, ok: false, error: 'cancelled'}
     worker -> page   {id, progress}         0..1, after every slice of about 40 ms of work (so at least every ~150 ms)
                      {id, ok: true, result}
                      {id, ok: false, error}
   Work runs in slices (EpinoiaWinSim.drive), so a cancel or a second job is heard between them.
   ============================================================================ */
(function () {
  var v = '';
  try {
    var m = /[?&]v=([^&#]*)/.exec(String((self.location && (self.location.search || self.location.href)) || ''));
    v = m ? m[1] : '';
  } catch (e) { v = ''; }
  importScripts('winstats.js?v=' + v, 'winsim.js?v=' + v);
  var Sim = self.EpinoiaWinSim, jobs = {};
  self.onmessage = function (e) {
    var msg = e.data || {}, id = msg.id;
    if (msg.op === 'cancel') { if (jobs[id]) jobs[id].cancelled = true; return; }
    var gen;
    try { gen = Sim.steps(msg.op, msg.args); }
    catch (err) { self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) }); return; }
    var job = jobs[id] = { cancelled: false };
    Sim.drive(gen, {
      slice: 40,
      onProgress: function (p) { if (!job.cancelled) self.postMessage({ id: id, progress: p }); },
      cancelled: function () { return job.cancelled; }
    }).then(function (result) {
      delete jobs[id];
      self.postMessage({ id: id, ok: true, result: result });
    }, function (err) {
      delete jobs[id];
      self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
    });
  };
}());
