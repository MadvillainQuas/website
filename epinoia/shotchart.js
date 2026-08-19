'use strict';
/* ============================================================================
   A SEASON'S SHOOTING, ON THE COURT IT WAS SHOT ON.

   The box score draws where each shot in one game came from. Over a season the
   same drawing stops working: two hundred dots on a half-court is a smear, and
   the thing a reader wants from a season chart is not "where was that shot"
   but "where does this player actually score from".

   SO IT IS BINNED, AND THAT IS THE WHOLE POINT. A shot is recorded by a thumb
   on a court a few inches wide, so no two attempts from the same spot share a
   coordinate. Asking "how many shots from exactly here" answers one, always.
   Asking "how many from this square metre" answers something a person can act
   on — and a cell that has been shot from four times says more about a player
   than forty singletons scattered around it.

   The threshold is the second half of that. A cell with one attempt in it is
   noise dressed as a fact: at 0% or 100% it draws the eye exactly as hard as a
   cell with twelve attempts at 58%, and it is the one you should ignore. Cells
   below the floor are drawn faintly rather than dropped, so a reader can see
   the difference between "never shoots here" and "shot here once".

   THE COURT IS THE SCORER'S COURT. COURT and courtSVG come from boxscore.js,
   which is generated from the scoring app itself and kept in step by
   extract-boxscore. Drawing a second half-court here would be a second set of
   FIBA measurements to get wrong.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaShotChart = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

  /* Court dimensions in centimetres — half of 28 x 15 m. Taken from the shared
     COURT when boxscore.js is present, which it is on every page that draws
     one; the literals are the fallback for a page that has not loaded it. */
  const dims = () => {
    const B = (typeof window !== 'undefined') && window.EpinoiaBox;
    return (B && B.COURT) ? B.COURT : { W: 1500, H: 1400 };
  };

  /* ---- gathering ----------------------------------------------------------
     Locations live in the event log, not in the season aggregates: a 'loc'
     event points at the shot it belongs to by id. So the shots and the
     locations are fetched together and paired here rather than asking the
     database for a join it has no view for. */
  async function gather(opts) {
    const { fetchEvents, gameIds, playerId } = opts;
    if (!gameIds || !gameIds.length) return [];
    const out = [];
    for (const rows of await fetchEvents(gameIds)) {
      const locs = {};
      rows.forEach(e => { if (e.t === 'loc') locs[e.ref] = e; });
      rows.forEach(e => {
        if (!/^p[23]_(made|miss)$/.test(e.t)) return;
        if (String(e.pid) !== String(playerId)) return;
        const l = locs[e.id != null ? e.id : e.seq];
        if (!l) return;                        // unlocated shots cannot be drawn
        out.push({ x: +l.x, y: +l.y, made: /_made$/.test(e.t), three: e.t[1] === '3' });
      });
    }
    return out;
  }

  /* ---- binning ------------------------------------------------------------
     Cell size is given in centimetres because that is the unit the court is in
     and the unit a reader can reason about: 120cm is a bit over a stride, and
     a cell that size holds a genuine spot on the floor rather than a pixel. */
  function bin(shots, cellCm) {
    const C = dims();
    const cell = Math.max(30, cellCm || 120);
    const cells = new Map();
    shots.forEach(s => {
      const cx = Math.floor((s.x * C.W) / cell);
      const cy = Math.floor((s.y * C.H) / cell);
      const k = cx + ':' + cy;
      let c = cells.get(k);
      if (!c) { c = { cx, cy, att: 0, made: 0, three: 0 }; cells.set(k, c); }
      c.att++; if (s.made) c.made++; if (s.three) c.three++;
    });
    return [...cells.values()].map(c => Object.assign(c, {
      pct: c.att ? (c.made / c.att) * 100 : 0,
      x: (c.cx + 0.5) * cell,
      y: (c.cy + 0.5) * cell,
      size: cell
    }));
  }

  /* Cold to hot, and deliberately not a rainbow: a reader should be able to
     rank two cells at a glance without consulting a key, which a hue cycle
     does not allow. Anchored at 45% because that is roughly a break-even
     two-point shot, so the colour means "better or worse than an average
     attempt" rather than an arbitrary midpoint. */
  function shade(pct, att, floor) {
    if (att < floor) return { fill: 'rgba(150,180,170,.16)', stroke: 'rgba(150,180,170,.22)' };
    const t = Math.max(0, Math.min(1, (pct - 25) / 40));      // 25% .. 65%
    const r = Math.round(60 + t * 195), g = Math.round(200 - t * 80), b = Math.round(150 - t * 90);
    return { fill: 'rgba(' + r + ',' + g + ',' + b + ',' + (0.30 + 0.45 * t).toFixed(2) + ')',
             stroke: 'rgba(' + r + ',' + g + ',' + b + ',.85)' };
  }

  function render(o) {
    const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
    if (!host) return;
    const C = dims();
    const floor = o.minAttempts == null ? 2 : o.minAttempts;
    const cells = bin(o.shots || [], o.cellCm);
    const B = (typeof window !== 'undefined') && window.EpinoiaBox;

    /* THE FULL COURT, NOT THE PLAIN ONE. courtSVG's `plain` flag drops the lane
       space marks, which is right for the thumbnail in a box-score row where
       four ticks a side become a smudge — and wrong here, where the chart is
       the whole card and a reader is judging distance from the basket by the
       markings around it. Same drawing as the scorer and the box score, which
       is the point of borrowing it rather than drawing a second court. */
    const court = (B && B.courtSVG) ? B.courtSVG(null) : '';
    /* the court comes back as a whole <svg>; the cells go inside it, before
       the closing tag, so they sit in the same coordinate space as the lines */
    const marks = cells.map(c => {
      const s = shade(c.pct, c.att, floor);
      const half = c.size / 2;
      const r = Math.max(18, half * (0.55 + Math.min(1, c.att / 8) * 0.45));
      return '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="' + r.toFixed(1) +
             '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="4">' +
             '<title>' + c.made + ' of ' + c.att + ' — ' + c.pct.toFixed(0) + '%</title></circle>';
    }).join('');

    const svg = court
      ? court.replace(/<\/svg>\s*$/, marks + '</svg>')
      : '<svg viewBox="0 0 ' + C.W + ' ' + C.H + '">' + marks + '</svg>';

    const shown = cells.filter(c => c.att >= floor);
    const att = cells.reduce((a, c) => a + c.att, 0);
    host.innerHTML =
      '<div class="sc-wrap">' + svg + '</div>' +
      '<div class="sc-note">' +
        (att
          ? shown.length + ' area' + (shown.length === 1 ? '' : 's') + ' with ' + floor +
            '+ attempts, from ' + att + ' located shot' + (att === 1 ? '' : 's')
          : 'No located shots yet — a shot is placed on the court in the scorer, ' +
            'and the ones taken without a location cannot be charted.') +
      '</div>';
    return { cells, shown: shown.length, attempts: att };
  }

  return { gather, bin, render, shade };
}));
