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
      const gid = rows.length ? rows[0].gameId : null;
      const side = (opts.sideOf && gid != null) ? opts.sideOf(gid) : null;
      rows.forEach(e => {
        if (!/^p[23]_(made|miss)$/.test(e.t)) return;
        if (playerId != null && String(e.pid) !== String(playerId)) return;
        if (side != null && +e.team !== +side) return;
        const l = locs[e.id != null ? e.id : e.seq];
        if (!l) return;                        // unlocated shots cannot be drawn
        const three = e.t[1] === '3';
        /* A shot's value and its position are two separate events and nothing
           used to make them agree, so a three could be logged in the paint —
           on the demo season, 615 of 709 of them were, while not one of 1,249
           twos sat outside the arc. The value is the deliberate fact and the
           position is a thumb, so the position moves. snapToValue is the
           scorer's own geometry, borrowed like the court itself. */
        const B = (typeof window !== 'undefined') && window.EpinoiaBox;
        const fix = (B && B.snapToValue) ? B.snapToValue(+l.x, +l.y, three)
                                         : { x: +l.x, y: +l.y, moved: false };
        out.push({ x: fix.x, y: fix.y, moved: fix.moved,
                   made: /_made$/.test(e.t), three });
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
      if (!c) { c = { cx, cy, att: 0, made: 0, three: 0, moved: 0 }; cells.set(k, c); }
      c.att++; if (s.made) c.made++; if (s.three) c.three++; if (s.moved) c.moved++;
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
    const moved = cells.reduce((a, c) => a + (c.moved || 0), 0);
    host.innerHTML =
      '<div class="sc-wrap">' + svg + '</div>' +
      '<div class="sc-note">' +
        (att
          ? shown.length + ' area' + (shown.length === 1 ? '' : 's') + ' with ' + floor +
            '+ attempts, from ' + att + ' located shot' + (att === 1 ? '' : 's') +
            (moved ? ' · ' + moved + ' moved to the side of the arc they were worth' : '')
          : 'No located shots yet — a shot is placed on the court in the scorer, ' +
            'and the ones taken without a location cannot be charted.') +
      '</div>';
    return { cells, shown: shown.length, attempts: att };
  }

  /* ---- the zones ------------------------------------------------------------
     THE BOX SCORE'S CHART, OVER MANY GAMES. The same court, the same dots and crosses in the
     club's colour, and on top of them the floor cut into the areas people talk about: the
     restricted area, the rest of the paint, the two baselines, the two wings and the top on
     the mid-range, the two corners, the two wings and the top beyond the arc. Every zone
     carries its makes, attempts and percentage, tinted cold to hot against what a shot from
     THAT zone is worth -- a 40% mid-range zone and a 40% corner are not the same news.

     The geometry is the scorer's: a shot's zone is decided from the same COURT measurements
     the lines are drawn from, so the zone a dot sits in is the zone it is counted in. */
  const ZONES = [
    { k: 'ra',    kind: 'paint', label: 'at the rim',     x: 750,  y: 350 },
    { k: 'paint', kind: 'paint', label: 'paint',          x: 750,  y: 500 },
    { k: 'bl',    kind: 'mid',   label: 'baseline',       x: 330,  y: 300 },
    { k: 'br',    kind: 'mid',   label: 'baseline',       x: 1170, y: 300 },
    { k: 'wl',    kind: 'mid',   label: 'wing',           x: 330,  y: 720 },
    { k: 'wr',    kind: 'mid',   label: 'wing',           x: 1170, y: 720 },
    { k: 'tm',    kind: 'mid',   label: 'top',            x: 750,  y: 730 },
    { k: 'c3l',   kind: 'three', label: 'corner',         x: 140,  y: 470 },
    { k: 'c3r',   kind: 'three', label: 'corner',         x: 1360, y: 470 },
    { k: 'w3l',   kind: 'three', label: 'wing 3',         x: 240,  y: 1000 },
    { k: 'w3r',   kind: 'three', label: 'wing 3',         x: 1260, y: 1000 },
    { k: 't3',    kind: 'three', label: 'top 3',          x: 750,  y: 1120 }
  ];
  function zoneOf(x, y, three) {
    /* x, y in centimetres on the scorer's court; the ring at (RIM_X, RIM_Y) */
    const C = dims();
    const RX = C.RIM_X || 750, RY = C.RIM_Y || 157.5, KH = C.KEY_HALF || 245, KL = C.KEY_LEN || 580, RA = C.RA_R || 125;
    const dx = x - RX, dy = y - RY;
    const ang = Math.atan2(Math.abs(dx), Math.max(1, dy)) * 180 / Math.PI;   // 0 straight ahead, 90 along the baseline
    if (three) {
      if (y < (C.CORNER_Y || 299) + 45) return dx < 0 ? 'c3l' : 'c3r';
      if (ang < 32) return 't3';
      return dx < 0 ? 'w3l' : 'w3r';
    }
    if (Math.hypot(dx, dy) <= RA + 25) return 'ra';
    if (x > RX - KH && x < RX + KH && y < KL) return 'paint';
    if (y < KL) return dx < 0 ? 'bl' : 'br';
    if (ang < 26) return 'tm';
    return dx < 0 ? 'wl' : 'wr';
  }
  /* cold to hot against the zone's own break-even: paint 58%, mid-range 40%, three 35% */
  function heat(pct, kind, att, floor) {
    if (att < floor) return { fill: 'rgba(150,180,170,.14)', stroke: 'rgba(150,180,170,.35)' };
    const anchor = kind === 'paint' ? 58 : kind === 'three' ? 35 : 40;
    const t = Math.max(0, Math.min(1, (pct - (anchor - 16)) / 32));
    const r = Math.round(60 + t * 195), g = Math.round(200 - t * 80), b = Math.round(150 - t * 90);
    return { fill: 'rgba(' + r + ',' + g + ',' + b + ',' + (0.22 + 0.5 * t).toFixed(2) + ')', stroke: 'rgba(' + r + ',' + g + ',' + b + ',.9)' };
  }
  function zones(shots) {
    const C = dims();
    const out = {};
    ZONES.forEach(z => { out[z.k] = Object.assign({ att: 0, made: 0 }, z); });
    shots.forEach(sh => {
      const k = zoneOf(sh.x * C.W, sh.y * C.H, !!sh.three);
      const z = out[k]; if (!z) return;
      z.att++; if (sh.made) z.made++;
    });
    Object.values(out).forEach(z => { z.pct = z.att ? 100 * z.made / z.att : 0; });
    return out;
  }
  /* the faint boundaries between zones, drawn from the same measurements */
  function zoneLines() {
    const C = dims();
    const RX = C.RIM_X || 750, RY = C.RIM_Y || 157.5, KH = C.KEY_HALF || 245, KL = C.KEY_LEN || 580, ARC = C.ARC_R || 675;
    const CY = (C.CORNER_Y || 299) + 45;
    const line = 'var(--line-hi, rgba(190,255,225,.38))';
    const ray = (deg, r0, r1) => {
      const a = deg * Math.PI / 180;
      return 'M ' + (RX + Math.sin(a) * r0).toFixed(1) + ' ' + (RY + Math.cos(a) * r0).toFixed(1) +
             ' L ' + (RX + Math.sin(a) * r1).toFixed(1) + ' ' + (RY + Math.cos(a) * r1).toFixed(1);
    };
    const far = 1500;
    const d = [
      /* baseline mid-range from the wings: level with the free-throw line, key to arc */
      'M ' + (RX - KH) + ' ' + KL + ' L ' + (RX - Math.sqrt(Math.max(0, ARC * ARC - (KL - RY) * (KL - RY)))).toFixed(1) + ' ' + KL,
      'M ' + (RX + KH) + ' ' + KL + ' L ' + (RX + Math.sqrt(Math.max(0, ARC * ARC - (KL - RY) * (KL - RY)))).toFixed(1) + ' ' + KL,
      /* corners from the wings beyond the arc */
      'M 3 ' + CY + ' L ' + (RX - Math.sqrt(Math.max(0, ARC * ARC - (CY - RY) * (CY - RY)))).toFixed(1) + ' ' + CY,
      'M ' + (C.W - 3) + ' ' + CY + ' L ' + (RX + Math.sqrt(Math.max(0, ARC * ARC - (CY - RY) * (CY - RY)))).toFixed(1) + ' ' + CY,
      /* top from the wings: 26 degrees inside the arc (from the free-throw line), 32 beyond it */
      ray(26, (KL - RY) / Math.cos(26 * Math.PI / 180), ARC), ray(-26, (KL - RY) / Math.cos(26 * Math.PI / 180), ARC),
      ray(32, ARC, far), ray(-32, ARC, far)
    ];
    return '<path d="' + d.join(' ') + '" fill="none" stroke="' + line + '" stroke-width="4" stroke-dasharray="14 18" opacity=".8"/>';
  }
  /* a club colour the marks can be seen in on this theme's ground (white on white was the
     alternative); the team-colour module knows the ground, the fallback is the colour itself */
  function markColour(hex) {
    const TC = (typeof window !== 'undefined') && window.EpinoiaTeamColour;
    if (TC && TC.ink) { const k = TC.ink(hex); if (k) return k; }
    return hex || '#93f2bf';
  }
  function renderZones(o) {
    const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
    if (!host) return;
    const C = dims();
    const B = (typeof window !== 'undefined') && window.EpinoiaBox;
    const floor = o.minAttempts == null ? 3 : o.minAttempts;
    const shots = o.shots || [];
    const col = markColour(o.colour);
    const z = zones(shots);
    const dots = shots.map(sh => {
      const x = sh.x * C.W, y = sh.y * C.H, a = 22;
      return sh.made
        ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="24" fill="' + col + '" opacity=".85"/>'
        : '<g stroke="' + col + '" stroke-width="11" stroke-linecap="round" opacity=".6">' +
          '<line x1="' + (x - a).toFixed(1) + '" y1="' + (y - a).toFixed(1) + '" x2="' + (x + a).toFixed(1) + '" y2="' + (y + a).toFixed(1) + '"/>' +
          '<line x1="' + (x - a).toFixed(1) + '" y1="' + (y + a).toFixed(1) + '" x2="' + (x + a).toFixed(1) + '" y2="' + (y - a).toFixed(1) + '"/></g>';
    }).join('');
    const pills = ZONES.map(zz => {
      const v = z[zz.k]; const h = heat(v.pct, zz.kind, v.att, floor);
      const txt = v.att ? (v.made + '/' + v.att + ' \u00b7 ' + v.pct.toFixed(0) + '%') : '\u2014';
      const w = 120 + Math.max(txt.length * 24, zz.label.length * 20);
      return '<g class="sc-zone" opacity="' + (v.att ? 1 : .55) + '">' +
        '<rect x="' + (zz.x - w / 2).toFixed(1) + '" y="' + (zz.y - 42) + '" width="' + w + '" height="84" rx="42" fill="' + h.fill + '" stroke="' + h.stroke + '" stroke-width="4"/>' +
        '<text x="' + zz.x + '" y="' + (zz.y - 8) + '" text-anchor="middle" font-size="28" fill="var(--ink, #e6fff1)" font-family="var(--f-micro, monospace)" letter-spacing="2">' + zz.label.toUpperCase() + '</text>' +
        '<text x="' + zz.x + '" y="' + (zz.y + 30) + '" text-anchor="middle" font-size="40" font-weight="700" fill="var(--ink, #e6fff1)" font-family="var(--f-data, monospace)">' + txt + '</text>' +
        '<title>' + zz.label + ': ' + v.made + ' of ' + v.att + '</title></g>';
    }).join('');
    const court = (B && B.courtSVG) ? B.courtSVG(null, { plain: true }) : '<svg viewBox="0 0 ' + C.W + ' ' + C.H + '"></svg>';
    const svg = court.replace(/<\/svg>\s*$/, zoneLines() + dots + pills + '</svg>');
    const made = shots.filter(x => x.made).length;
    const chip = (name, pred) => { const a = shots.filter(pred); const m = a.filter(x => x.made).length;
      return '<span class="sc-chip">' + name + '<b>' + m + '/' + a.length + (a.length ? ' \u00b7 ' + Math.round(100 * m / a.length) + '%' : '') + '</b></span>'; };
    const kindOf = sh => { const k = zoneOf(sh.x * C.W, sh.y * C.H, !!sh.three); return (ZONES.find(zz => zz.k === k) || {}).kind; };
    const chips = '<div class="sc-chips">' +
      chip('paint', sh => kindOf(sh) === 'paint') + chip('mid-range', sh => kindOf(sh) === 'mid') + chip('three', sh => !!sh.three) +
      chip('left side', sh => sh.x < 0.4) + chip('right side', sh => sh.x > 0.6) + '</div>';
    host.innerHTML = '<div class="sc-wrap">' + svg + '</div>' +
      '<div class="sc-note">' + (shots.length
        ? '\u25cf made \u00b7 \u2715 missed \u00b7 ' + shots.length + ' located shot' + (shots.length === 1 ? '' : 's') + ', ' + made + ' made' + (o.note ? ' \u00b7 ' + o.note : '') +
          ' \u00b7 zones tinted against their own break-even (paint 58%, mid-range 40%, three 35%); fewer than ' + floor + ' attempts stays grey'
        : 'No located shots yet \u2014 a shot is placed on the court in the scorer, and the ones taken without a location cannot be charted.') + '</div>' +
      (shots.length ? chips : '');
    return { zones: z, attempts: shots.length };
  }

  return { gather, bin, render, shade, zones, zoneOf, renderZones, markColour, ZONES };
}));
