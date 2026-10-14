'use strict';
/* THE BOX SCORE'S LOG, ASKED FOR BEFORE THE PAGE'S SCRIPTS HAVE ARRIVED (2026-10-15).

   The game page carries some sixty scripts, all deferred: on a first visit, or the first after a deploy (every
   stamp changes), they take seconds to arrive, and game.js only starts asking for the game once all of them have.
   A finished game's play-by-play is a public file (snapshots/events/<game>.json, 0156) that needs nothing but the
   game's id from the address, so this file - first in the page's head, loaded async, a few hundred bytes - asks
   for it at once and leaves the answer where game.js looks (window.EPINOIA_EARLY_LOG, fileRows()). Everything else
   is game.js's as before; if this file is late, blocked or fails, game.js simply asks for itself.

   A game that is not finished has no file: the answer is an uncached 400 and is never used. The project's address
   is written in here because this runs before config.js (supabase/tests/perf-early.test.mjs keeps the two equal). */
(function () {
  var SUPABASE_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
  try {
    var g = new URLSearchParams(location.search).get('g');
    if (!g || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)) return;
    window.EPINOIA_EARLY_LOG = {
      game: g,
      p: fetch(SUPABASE_URL + '/storage/v1/object/public/snapshots/events/' + g + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    };
  } catch (_) { /* an old browser: game.js asks as it always has */ }
}());
