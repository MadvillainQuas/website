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
        const sh = { x: fix.x, y: fix.y, moved: fix.moved,
                   made: /_made$/.test(e.t), three, gameId: e.gameId != null ? e.gameId : gid, team: e.team, pid: e.pid,
                   period: e.period != null ? +e.period : null, clock: e.clock != null ? +e.clock : null };
        if (opts.tag) sh.ast = !!opts.tag(e);        // the caller's mark on the shot's event (assisted, say)
        out.push(sh);
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
     restricted area, the rest of the paint, the two baselines and the top of the mid-range
     (the whole band from the free-throw line out to the arc), the two corners, the two wings
     and the top beyond the arc. Every zone
     carries its makes, attempts and percentage, tinted cold to hot against what a shot from
     THAT zone is worth -- a 40% mid-range zone and a 40% corner are not the same news.

     The geometry is the scorer's: a shot's zone is decided from the same COURT measurements
     the lines are drawn from, so the zone a dot sits in is the zone it is counted in. */
  const ZONES = [
    { k: 'ra',    kind: 'paint', label: 'rim',            x: 750,  y: 250 },
    { k: 'paint', kind: 'paint', label: 'paint',          x: 750,  y: 480 },
    { k: 'bl',    kind: 'mid',   label: 'baseline',       x: 330,  y: 250 },
    { k: 'br',    kind: 'mid',   label: 'baseline',       x: 1170, y: 250 },
    { k: 'tm',    kind: 'mid',   label: 'top mid',        x: 750,  y: 700 },
    { k: 'c3l',   kind: 'three', label: 'corner',         x: 48,   y: 200 },
    { k: 'c3r',   kind: 'three', label: 'corner',         x: 1452, y: 200 },
    { k: 'w3l',   kind: 'three', label: 'wing 3',         x: 200,  y: 960 },
    { k: 'w3r',   kind: 'three', label: 'wing 3',         x: 1300, y: 960 },
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
    /* ONE ZONE FROM THE FREE-THROW LINE OUT TO THE ARC. It was cut in three (a wing each side of a
       top), and the two wings were slivers too thin to fill: over a season they stood empty and the
       chart looked as if nobody tracked that part of the floor. */
    return 'tm';
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
  /* THE ZONES AS SHAPES. Each is a closed path built from the court's own measurements --
     the key, the restricted area, the arc, the corner lines and the rays that split the
     wings from the top beyond the arc -- so the shape a dot sits in is the shape it is counted
     in. They are tinted and laid UNDER the court lines; the numbers sit on plates above. */
  function zonePaths() {
    const C = dims();
    const RX = C.RIM_X || 750, RY = C.RIM_Y || 157.5, KH = C.KEY_HALF || 245, KL = C.KEY_LEN || 580;
    const RA = (C.RA_R || 125) + 25, ARC = C.ARC_R || 675, CX = C.CORNER_X || 90, CY = C.CORNER_Y || 299, CYb = CY + 45;
    const W = C.W, H = C.H;
    const hw = y => Math.sqrt(Math.max(0, ARC * ARC - (y - RY) * (y - RY)));
    const xKL = RX - hw(KL), xKLr = RX + hw(KL), xC = RX - hw(CYb), xCr = RX + hw(CYb);
    const r32 = 32 * Math.PI / 180;
    const a32 = [RX - ARC * Math.sin(r32), RY + ARC * Math.cos(r32)], a32r = [RX + ARC * Math.sin(r32), a32[1]];
    const tEdge = RX / Math.sin(r32), yEdge = Math.min(H, RY + tEdge * Math.cos(r32));
    const f = v => (+v).toFixed(1);
    const A = (sweep, x, y) => ' A ' + ARC + ' ' + ARC + ' 0 0 ' + sweep + ' ' + f(x) + ' ' + f(y);
    const kl = RX - KH, kr = RX + KH;
    return {
      ra:    'M ' + f(RX - RA) + ' ' + f(RY) + ' A ' + RA + ' ' + RA + ' 0 1 0 ' + f(RX + RA) + ' ' + f(RY) + ' A ' + RA + ' ' + RA + ' 0 1 0 ' + f(RX - RA) + ' ' + f(RY) + ' Z',
      paint: 'M ' + kl + ' 0 H ' + kr + ' V ' + KL + ' H ' + kl + ' Z M ' + f(RX - RA) + ' ' + f(RY) + ' A ' + RA + ' ' + RA + ' 0 1 0 ' + f(RX + RA) + ' ' + f(RY) + ' A ' + RA + ' ' + RA + ' 0 1 0 ' + f(RX - RA) + ' ' + f(RY) + ' Z',
      bl:    'M ' + CX + ' 0 H ' + kl + ' V ' + KL + ' H ' + f(xKL) + A(1, CX, CY) + ' Z',
      br:    'M ' + kr + ' 0 H ' + (W - CX) + ' V ' + CY + A(1, xKLr, KL) + ' H ' + kr + ' Z',
      tm:    'M ' + f(xKL) + ' ' + KL + ' H ' + f(xKLr) + A(1, xKL, KL) + ' Z',
      c3l:   'M 0 0 H ' + CX + ' V ' + CY + A(0, xC, CYb) + ' H 0 Z',
      c3r:   'M ' + (W - CX) + ' 0 H ' + W + ' V ' + CYb + ' H ' + f(xCr) + A(0, W - CX, CY) + ' Z',
      w3l:   'M 0 ' + CYb + ' H ' + f(xC) + A(0, a32[0], a32[1]) + ' L 0 ' + f(yEdge) + ' Z',
      w3r:   'M ' + W + ' ' + CYb + ' H ' + f(xCr) + A(1, a32r[0], a32r[1]) + ' L ' + W + ' ' + f(yEdge) + ' Z',
      t3:    'M ' + f(a32[0]) + ' ' + f(a32[1]) + A(0, a32r[0], a32r[1]) + ' L ' + W + ' ' + f(yEdge) + ' V ' + H + ' H 0 V ' + f(yEdge) + ' Z'
    };
  }
  /* ---- the zones as a table ---------------------------------------------
     The twelve areas melded into the eight people talk about (the two corners are one
     "corner 3"), then the larger cuts: left / centre / right, the rim against jump shots
     (everything outside the paint), all mid-range, all threes, and every shot. Each row
     carries the share of attempts, attempts and makes and misses per game, FG% and eFG%.
     Games are the caller's count -- the chart cannot know how many games a player played
     without a shot -- and per-game columns are left out when it is not given. */
  const ALL = ['ra', 'paint', 'bl', 'br', 'tm', 'c3l', 'c3r', 'w3l', 'w3r', 't3'];
  const GROUPS = [
    { k: 'rim',   label: 'at the rim',        zones: ['ra'],           kind: 'paint' },
    { k: 'paint', label: 'paint (not rim)',   zones: ['paint'],        kind: 'paint' },
    { k: 'base',  label: 'baseline mid',      zones: ['bl', 'br'],     kind: 'mid' },
    { k: 'topm',  label: 'top mid',           zones: ['tm'],           kind: 'mid' },
    { k: 'c3',    label: 'corner 3',          zones: ['c3l', 'c3r'],   kind: 'three' },
    { k: 'w3',    label: 'wing 3',            zones: ['w3l', 'w3r'],   kind: 'three' },
    { k: 't3',    label: 'top 3',             zones: ['t3'],           kind: 'three' }
  ];
  const BIG = [
    { k: 'left',   label: 'left side',                    zones: ['bl', 'c3l', 'w3l'] },
    { k: 'centre', label: 'centre',                       zones: ['ra', 'paint', 'tm', 't3'] },
    { k: 'right',  label: 'right side',                   zones: ['br', 'c3r', 'w3r'] },
    { k: 'atrim',  label: 'rim & paint',                  zones: ['ra', 'paint'],  kind: 'paint' },
    { k: 'jump',   label: 'jump shots (outside the paint)', zones: ['bl', 'br', 'tm', 'c3l', 'c3r', 'w3l', 'w3r', 't3'] },
    { k: 'mid',    label: 'all mid-range',                zones: ['bl', 'br', 'tm'],  kind: 'mid' },
    { k: 'three',  label: 'all threes',                   zones: ['c3l', 'c3r', 'w3l', 'w3r', 't3'], kind: 'three' },
    { k: 'all',    label: 'every shot',                   zones: ALL }
  ];
  /* THE TABLE IN PARTS (2026-10-03). Every table of zones (the player's page, the club's page, both reports) draws its rows
     under a heading for each kind of shot - rim and paint, mid-range, threes - and the larger cuts under a heading for each
     way of cutting them, so that seventeen rows read as a few. This is the one place that says which row goes under which,
     in order; a row it does not name goes last, under no heading. `kind` colours the heading and its rows. */
  const PARTS = {
    groups: [{ kind: 'paint', title: 'rim & paint', keys: ['rim', 'paint'] },
             { kind: 'mid',   title: 'mid-range',   keys: ['base', 'topm'] },
             { kind: 'three', title: 'threes',      keys: ['c3', 'w3', 't3'] }],
    big:    [{ kind: null, title: 'by side of the floor', keys: ['left', 'centre', 'right'] },
             { kind: null, title: 'by kind of shot',      keys: ['atrim', 'jump', 'mid', 'three'] },
             { kind: null, title: null,                   keys: ['all'] }]
  };
  /* a list of rows (any with a `k`) cut into [{ kind, title, rows }] by PARTS[which] */
  function parts(list, which) {
    const spec = PARTS[which] || [], rows = list || [], by = new Map(rows.map(r => [r.k, r]));
    const out = spec.map(p => ({ kind: p.kind, title: p.title, rows: p.keys.map(k => by.get(k)).filter(Boolean) })).filter(p => p.rows.length);
    const rest = rows.filter(r => !spec.some(p => p.keys.indexOf(r.k) >= 0));
    if (rest.length) out.push({ kind: null, title: null, rows: rest });
    return out;
  }
  /* EACH ROW'S BREAK-EVEN, for the table's colours: a zone's is its kind's (ANCHOR, below), and a cut of several kinds
     is held to the mix it was shot from, weighted by attempts -- "every shot" taken mostly at the rim is not judged
     against the three's 35%. eFG% counts a three as one and a half makes, and so does its break-even (35% from three
     is 52.5% eFG). With no attempts, a single-kind row keeps its kind's number and a mixed one has none. */
  const KIND_OF = {};
  ZONES.forEach(z => { KIND_OF[z.k] = z.kind; });
  const beOf = (zs, per, efg) => {
    let att = 0, sum = 0;
    zs.forEach(k => { const a = per[k].att, kind = KIND_OF[k]; att += a; sum += a * ANCHOR[kind] * (efg && kind === 'three' ? 1.5 : 1); });
    if (att) return sum / att;
    const kinds = [...new Set(zs.map(k => KIND_OF[k]))];
    return kinds.length === 1 ? ANCHOR[kinds[0]] * (efg && kinds[0] === 'three' ? 1.5 : 1) : null;
  };
  function zoneRows(shots, games) {
    const C = dims();
    const per = {};
    ALL.forEach(k => { per[k] = { att: 0, made: 0, m3: 0 }; });
    shots.forEach(sh => {
      const k = zoneOf(sh.x * C.W, sh.y * C.H, !!sh.three);
      const z = per[k]; if (!z) return;
      z.att++; if (sh.made) { z.made++; if (sh.three) z.m3++; }
    });
    const total = shots.length;
    const row = g => {
      const att = g.zones.reduce((n, k) => n + per[k].att, 0);
      const made = g.zones.reduce((n, k) => n + per[k].made, 0);
      const m3 = g.zones.reduce((n, k) => n + per[k].m3, 0);
      return { k: g.k, label: g.label, kind: g.kind || null, att, made, miss: att - made, m3,
               share: total ? 100 * att / total : null,
               attG: games ? att / games : null, madeG: games ? made / games : null, missG: games ? (att - made) / games : null,
               fg: att ? 100 * made / att : null, efg: att ? 100 * (made + 0.5 * m3) / att : null,
               be: beOf(g.zones, per, false), beE: beOf(g.zones, per, true) };
    };
    return { groups: GROUPS.map(row), big: BIG.map(row), total, games: games || 0 };
  }
  /* THE ZONES AS A TABLE, in the club page's table dress (t/team.js zoneStats, kit/clubstats.css table.czt): a heading
     row over each group, each zone's swatch by kind, the share of the shots as a bar, and FG% and eFG% on a pill
     COLOURED AS THE COURT IS -- the same diverging scale against the same break-even, blue below and orange above,
     grey within two points -- with the gap to the break-even under it. A row under the court's attempt floor is
     hatched rather than coloured, as its zone is: too few to rate is not average. Under 600px of its own width
     (a container query: the rail eats the page) every row is a card. o: { minAttempts, colour } */
  function zoneTableHTML(rows, o) {
    o = o || {};
    const few = o.minAttempts == null ? 3 : o.minAttempts;
    const f1 = v => v == null ? '\u2014' : v.toFixed(1);
    const g = rows.games > 0;
    const lb = t => '<span class="scz-lb" data-i18n-ctx="col">' + t + '</span>';
    const pill = (pct, be, att) => {
      if (pct == null) return '<span class="scz-pill nil">\u2014</span>';
      if (att < few || be == null) return '<span class="scz-pill few" title="fewer than ' + few + ' attempts: too few to rate">' + pct.toFixed(1) + '</span>';
      const d = pct - be;
      return '<span class="scz-pill ' + bandCls(bandAt(pct, be)) + '" title="break-even ' + be.toFixed(1) + '%">' + pct.toFixed(1) + '</span>' +
        '<span class="scz-be"><b>' + (d > 0 ? '+' : d < 0 ? '\u2212' : '\u00b1') + Math.abs(d).toFixed(1) + '</b><span class="scz-bev"> v ' + be.toFixed(0) + '</span></span>';
    };
    const SW = { paint: 'k-paint', mid: 'k-mid', three: 'k-three' };
    const tr = (r, max) => {
      const w = r.share == null || !(max > 0) ? 0 : Math.min(100, Math.max(2, 100 * r.share / max));
      return '<tr class="r' + (r.att ? '' : ' none') + (r.k === 'all' ? ' tot' : '') + '"' + (r.kind ? ' data-k="' + r.kind + '"' : '') + '>' +
        '<th class="l" scope="row" data-i18n-ctx="zone">' + (r.kind ? '<i class="scz-sw ' + SW[r.kind] + '"></i>' : '') + r.label + '</th>' +
        '<td>' + lb('made / att') + '<span class="scz-v">' + r.made + '/' + r.att + '</span></td>' +
        '<td class="scz-share">' + lb('% of shots') + '<span class="scz-v">' + (r.share == null ? '\u2014' : f1(r.share) + '%') + '</span>' +
          '<span class="scz-bar"><i style="width:' + w.toFixed(1) + '%"></i></span></td>' +
        (g ? '<td>' + lb('att / g') + '<span class="scz-v">' + f1(r.attG) + '</span></td><td>' + lb('made / g') + '<span class="scz-v">' + f1(r.madeG) + '</span></td>'
           : '<td>' + lb('missed') + '<span class="scz-v">' + r.miss + '</span></td>') +
        '<td class="scz-p">' + lb('fg%') + pill(r.fg, r.be, r.att) + '</td>' +
        '<td class="scz-p">' + lb('efg%') + pill(r.efg, r.beE, r.att) + '</td></tr>';
    };
    const cols = g ? 7 : 6;
    /* a heading over each part (parts, above): the kind of shot's swatch and name, its rows on a bar of the same colour */
    const block = (title, list, which) => {
      const max = Math.max(0, ...list.filter(r => r.k !== 'all').map(r => +r.share || 0));
      const body = parts(list, which).map(p => (p.title
        ? '<tr class="scz-kh"' + (p.kind ? ' data-k="' + p.kind + '"' : '') + '><th colspan="' + cols + '" data-i18n-ctx="zone">' +
          (p.kind ? '<i class="scz-sw ' + SW[p.kind] + '"></i>' : '') + p.title + '</th></tr>' : '') + p.rows.map(r => tr(r, max)).join('')).join('');
      return '<tbody><tr class="scz-gh"><th colspan="' + cols + '">' + title + '</th></tr>' + body + '</tbody>';
    };
    const tint = hexOk(o.colour) ? ' style="--scz-a:' + o.colour + '"' : '';
    return '<div class="scz-wrap" data-i18n-ctx="zonetable"' + tint + '><table class="scz' + (g ? ' pg' : '') + '">' +
      '<thead><tr><th class="l">zone</th><th>made / att</th><th>% of shots</th>' + (g ? '<th>att / g</th><th>made / g</th>' : '<th>missed</th>') +
      '<th>fg%</th><th>efg%</th></tr></thead>' +
      block('every zone', rows.groups, 'groups') + block('the larger cuts', rows.big, 'big') + '</table>' +
      '<div class="scz-key"><span class="rl">below break-even</span><i class="bm3"></i><i class="bm2"></i><i class="bm1"></i><i class="b0"></i><i class="bp1"></i><i class="bp2"></i><i class="bp3"></i><span class="rl">above</span>' +
        '<span class="scz-fewkey"><i></i>fewer than ' + few + ' attempts</span></div>' +
      '<div class="scz-note">fg% and efg% are coloured as the court is: against the zone\u2019s break-even (paint ' + ANCHOR.paint + '%, mid-range ' + ANCHOR.mid + '%, three ' + ANCHOR.three +
        '%), and a cut of several zones against the mix it was shot from; the figure under each is the gap \u00b7 eFG% counts a three as one and a half makes \u00b7 % of shots is the share of every located attempt' +
        (g ? ' \u00b7 per game over ' + rows.games + (rows.games === 1 ? ' game' : ' games') : '') + '</div></div>';
  }

  /* ---- the zones on a season's team rows ------------------------------------
     ONE READ, EVERY TEAM. The season aggregation (data.js season()) has the games and the
     team rows but no shot locations; those live in the event logs. This fetches the logs
     once for a set of games, cuts every side's located shots into the zones, and writes the
     numbers onto each team row under z_<zone>_<measure>, which is what the full table's
     "shot zones" columns and the club profile's block both read. Cached per set of games. */
  const attachCache = {};

  /* THE REBOUNDS OFF EACH ZONE'S MISSES, from the same logs (situations.js reboundZones: rim / mid / three by the
     box score's rule, whose rebound each miss ended in). Per club, both ends: `off` its own shots -- o its own
     offensive rebounds off them, d the other side's defensive ones -- and `def` the shots taken against it -- o the
     other side's offensive rebounds, d its own defensive ones. Only where situations.js is on the page. */
  const REB_ZONES = ['rim', 'mid', 'three'];
  function reboundsOf(byG, side) {
    const Sit = (typeof globalThis !== 'undefined' && globalThis.EpinoiaSituations) || null;
    if (!Sit || !Sit.reboundZones) return null;
    const cells = () => ({ rim: { a: 0, m: 0, o: 0, d: 0 }, mid: { a: 0, m: 0, o: 0, d: 0 }, three: { a: 0, m: 0, o: 0, d: 0 } });
    const add = (into, from) => REB_ZONES.forEach(z => { ['a', 'm', 'o', 'd'].forEach(f => { into[z][f] += from[z][f]; }); });
    const out = {};
    Object.keys(byG).forEach(gid => {
      const sd = side[gid];
      if (!sd) return;
      const rz = Sit.reboundZones(byG[gid]);
      [0, 1].forEach(t => {
        const tid = sd[t];
        if (!tid) return;
        const r = out[tid] = out[tid] || { off: cells(), def: cells() };
        add(r.off, rz[t]); add(r.def, rz[1 - t]);
      });
    });
    return out;
  }
  /* one zone's line on a club's row, per shot ATTEMPT at each end: own = the club's shots (a attempts, m made, o its own
     offensive rebounds off the misses, d the other side's defensive ones), against = the shots taken against it (o the
     other side's offensive rebounds, d its own defensive ones); the rates are shares of those attempts */
  function rebRow(r, z) {
    const g = (end, f) => (z === 'all' ? REB_ZONES.reduce((n, k) => n + r[end][k][f], 0) : r[end][z][f]);
    const line = end => ({ a: g(end, 'a'), m: g(end, 'm'), o: g(end, 'o'), d: g(end, 'd') });
    const own = line('off'), against = line('def');
    const pct = (n, d) => (d ? 100 * n / d : null);
    return { own, against,
             orp: pct(own.o, own.a),           // its own offensive rebounds, per attempt of its own
             odp: pct(own.d, own.a),           // the other side's defensive rebounds off them
             drp: pct(against.d, against.a),   // its own defensive rebounds, per attempt against it
             oop: pct(against.o, against.a),   // the other side's offensive rebounds off them
             /* ORB% AND DRB% BY ZONE, as the four factors count them: of the misses somebody rebounded, the share
                this club took (a miss with no rebound, a foul's free throws or a turnover, is nobody's) */
             orb: pct(own.o, own.o + own.d),
             drb: pct(against.d, against.d + against.o) };
  }

  async function attachZoneStats(S, D) {
    if (!S || !S.games || !S.games.length || !S.teams || !D || !D.events) return {};
    const key = S.games.map(g => g.id).sort().join(',');
    let cached = attachCache[key];
    if (!cached) {
      const evs = await D.events(S.games.map(g => g.id));
      const byG = {}; evs.forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
      /* which made shots were assisted (situations.js, the box score's own reading of a pass before a basket) */
      const SI = typeof window !== 'undefined' && window.EpinoiaSituations;
      const astd = new Set();
      if (SI && SI.assistedShots && SI.inGameOrder) Object.keys(byG).forEach(gid => {
        try { SI.assistedShots(SI.inGameOrder(byG[gid]).filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t))).assisted.forEach(e => astd.add(e)); }
        catch (_) { /* that game unmarked */ }
      });
      const all = await gather({ fetchEvents: async () => Object.values(byG), gameIds: S.games.map(g => g.id), playerId: null,
                                 tag: astd.size ? (e => astd.has(e)) : null });
      const side = {}; S.games.forEach(g => { side[g.id] = [g.home_team_id, g.away_team_id]; });
      const shotsBy = {}, shotsAg = {};
      all.forEach(sh => {
        const sd = side[sh.gameId] || [], tid = sd[+sh.team], opp = sd[1 - +sh.team];
        if (tid) (shotsBy[tid] = shotsBy[tid] || []).push(sh);
        if (opp) (shotsAg[opp] = shotsAg[opp] || []).push(sh);
      });
      cached = attachCache[key] = { perTeam: shotsBy, against: shotsAg, ast: astd.size > 0, reb: reboundsOf(byG, side) };
    }
    const perTeam = cached.perTeam;
    const out = {};
    /* each cut's share of the makes that came off a pass, and the rim's share of the points scored in the paint */
    const astOf = shots => {
      const C = dims(), per = {};
      ALL.forEach(k => { per[k] = { m: 0, a: 0 }; });
      shots.forEach(sh => { if (!sh.made) return; const z = per[zoneOf(sh.x * C.W, sh.y * C.H, !!sh.three)]; if (z) { z.m++; if (sh.ast) z.a++; } });
      const o = {};
      GROUPS.concat(BIG).forEach(g => { const m = g.zones.reduce((n, k) => n + per[k].m, 0), a = g.zones.reduce((n, k) => n + per[k].a, 0); o[g.k] = m ? 100 * a / m : null; });
      return o;
    };
    const put = (tm, pre, shots, gp) => {
      const zr = zoneRows(shots, gp);
      const poss = tm.poss || null;
      zr.groups.concat(zr.big).forEach(r => {
        tm[pre + r.k + '_share'] = r.share; tm[pre + r.k + '_att100'] = poss ? 100 * r.att / poss : null;
        tm[pre + r.k + '_attG'] = r.attG; tm[pre + r.k + '_madeG'] = r.madeG;
        tm[pre + r.k + '_fg'] = r.fg; tm[pre + r.k + '_efg'] = r.efg; tm[pre + r.k + '_att'] = r.att;
      });
      const rim = zr.groups.find(r => r.k === 'rim'), pnt = zr.groups.find(r => r.k === 'paint');
      tm[pre + 'rim_ptsh'] = rim && pnt && rim.made + pnt.made ? 100 * rim.made / (rim.made + pnt.made) : null;
      if (cached.ast) { const A = astOf(shots); Object.keys(A).forEach(k => { tm[pre + k + '_astp'] = A[k]; }); }
      return zr;
    };
    S.teams.forEach(tm => {
      const shots = perTeam[tm.id] || [];
      const gp = tm.gp || S.games.filter(g => g.home_team_id === tm.id || g.away_team_id === tm.id).length || 1;
      const zr = put(tm, 'z_', shots, gp);
      put(tm, 'zd_', (cached.against || {})[tm.id] || [], gp);       // the same, of the shots taken against it
      tm.z_located = shots.length;
      const rb = cached.reb && cached.reb[tm.id];
      if (rb) {
        REB_ZONES.concat('all').forEach(z => {
          const r = rebRow(rb, z);
          ['a', 'm', 'o', 'd'].forEach(f => { tm['rb_' + z + '_' + f] = r.own[f]; tm['rb_' + z + '_g' + f] = r.against[f]; });
          tm['rb_' + z + '_orp'] = r.orp; tm['rb_' + z + '_odp'] = r.odp; tm['rb_' + z + '_drp'] = r.drp; tm['rb_' + z + '_oop'] = r.oop;
          tm['rb_' + z + '_orb'] = r.orb; tm['rb_' + z + '_drb'] = r.drb;
          tm['rb_' + z + '_fg'] = r.own.a ? 100 * r.own.m / r.own.a : null;
          tm['rb_' + z + '_gfg'] = r.against.a ? 100 * r.against.m / r.against.a : null;
        });
        tm.rb_ready = true;
      }
      out[tm.id] = zr;
    });
    return out;
  }

  /* a club colour the marks can be seen in on this theme's ground (white on white was the
     alternative); the team-colour module knows the ground, the fallback is the colour itself */
  function markColour(hex) {
    const TC = (typeof window !== 'undefined') && window.EpinoiaTeamColour;
    if (TC && TC.ink) { const k = TC.ink(hex); if (k) return k; }
    return hex || '#93f2bf';
  }
  /* ======================================================== THE CHART, TO USE ===
     One interactive chart for every place a shot is drawn over a court: a club's season, a player's,
     and a box score's two sides. It is an HTML string plus one set of listeners on the document, so a
     page that redraws its whole tab from a string on every live update (the game page) keeps the
     reader's choices: the state lives here, keyed by the chart, not in the markup.

       THE CONTROLS   what to show (the zones, the shots, or both), which games (the last five, ten,
                      all), two or three, makes or misses, a quarter, a player, a side. The zones are
                      always worked out from makes AND misses -- "makes only" hides the crosses, it
                      does not turn every zone into 100%.
       THE ZONES      tinted on a diverging scale against each zone's own break-even (paint 58%,
                      mid-range 40%, three 35%): blue below, orange above, a neutral grey within two
                      points of it, three steps a side. A zone with fewer attempts than the floor is
                      left untinted, so "not enough to say" never looks like "average".
       THE NUMBERS    on small black plates, so a shot can never sit on top of one.
       THE MARKS      a made shot a filled dot with a ring of the floor round it, a miss a cross; in
                      the club's colour, or in ink when the zones' colours are under them.
       HOVER / TAP    a zone gives its percentage, makes of attempts, the gap to break-even and its
                      share of the shots; a shot gives made or missed, two or three, who, when.
       THE TILES      paint, mid-range, three, left side, right side: the percentage, makes of
                      attempts, and a bar with the break-even marked on it.
     ZONES: FALSE is the free chart (docs/memberships.md §6): the court, the marks and every filter,
     but no zone tints, plates, tiles or table -- the zone analysis is the paid part. */
  const ANCHOR = { paint: 58, mid: 40, three: 35 };
  const ZNAME = { ra: 'at the rim', paint: 'paint', bl: 'left baseline', br: 'right baseline',
                  tm: 'top mid', c3l: 'left corner 3', c3r: 'right corner 3', w3l: 'left wing 3', w3r: 'right wing 3', t3: 'top 3' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = c => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(c || ''));
  const two = n => (n < 10 ? '0' : '') + n;
  const clockTxt = ms => { if (ms == null || !isFinite(ms) || ms < 0 || ms > 3600000) return ''; const t = Math.ceil(ms / 1000); return Math.floor(t / 60) + ':' + two(t % 60); };
  /* quarters, or a game in halves (NCAA men): the shots' own clocks say, as engine.js formatOf does --
     a first- or second-period clock above 10:00 can only be a half */
  const halvesIn = shots => (shots || []).some(s => s && (+s.period || 1) <= 2 && +s.clock > 600000);
  let PREG = 4;                                        // set by innerHTML for the chart being drawn
  const perTxt = p => (!p ? '' : p <= PREG ? (PREG === 2 ? 'H' : 'Q') + p : 'OT' + (p > PREG + 1 ? p - PREG : ''));
  /* the band a zone's percentage falls in against its break-even: -3 .. 3, 0 within two points */
  function band(pct, kind) { return bandAt(pct, ANCHOR[kind]); }
  /* ...against any break-even: the zone table's cuts of several kinds have their own (zoneRows) */
  function bandAt(pct, anchor) {
    const d = pct - anchor;
    const a = Math.abs(d), n = a <= 2 ? 0 : a <= 6 ? 1 : a <= 12 ? 2 : 3;
    return d < 0 ? -n : n;
  }
  const bandCls = b => (b === 0 ? 'b0' : b > 0 ? 'bp' + b : 'bm' + (-b));
  const kindOfShot = sh => { const C = dims(); const k = zoneOf(sh.x * C.W, sh.y * C.H, !!sh.three); return (ZONES.find(zz => zz.k === k) || {}).kind; };

  /* a game's date as a tooltip line: "Sat 27 Sep" (the reader's own words in another language) */
  function whenOf(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const lang = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en';
    if (/^en\b/i.test(lang)) {
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' +
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    }
    try { return d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, ''); }
    catch (_) { return d.toDateString().slice(0, 10); }
  }
  /* games as the chart wants them, newest first: [{id, when}] */
  const gameListOf = gs => (gs || []).slice()
    .sort((a, b) => String(b.tipoff_at || '').localeCompare(String(a.tipoff_at || '')))
    .map(g => ({ id: g.id, when: whenOf(g.tipoff_at) }));

  const REG = {};
  let seq = 0;
  function initState(o) {
    let view = !o.zones ? 'shots' : (o.shots || []).length > 90 ? 'zones' : 'both';
    if (o.zones) {
      try { const v = localStorage.getItem('epinoia.sc.view'); if (/^(zones|both|shots)$/.test(v || '')) view = v; } catch (_) { /* the default */ }
    }
    return { view, res: 'all', type: 'all', per: 'all', last: 'all', pid: 'all', side: 'both' };
  }

  /* the shots the current choices leave: forMarks also applies makes / misses */
  function pick(r, forMarks, side) {
    const o = r.o, st = r.st, reg = halvesIn(o.shots) ? 2 : 4;
    const last = st.last !== 'all' && o.gameList ? new Set(o.gameList.slice(0, +st.last).map(g => g.id)) : null;
    return (o.shots || []).filter(s =>
      (side == null || +s.team === side) &&
      (st.type === 'all' || (st.type === '3') === !!s.three) &&
      (st.per === 'all' || (st.per === 'ot' ? s.period > reg : +s.period === +st.per)) &&
      (st.pid === 'all' || String(s.pid) === st.pid) &&
      (!last || last.has(s.gameId)) &&
      (!forMarks || st.res === 'all' || (st.res === 'made') === !!s.made));
  }

  function segHTML(key, cur, label, opts) {
    return '<div class="scw-grp"><span class="scw-sl">' + esc(label) + '</span><div class="scw-seg" role="group" aria-label="' + esc(label) + '">' +
      opts.map(([v, t]) => {
        const on = String(cur) === String(v);
        return '<button type="button" data-sca="' + key + '" data-v="' + esc(v) + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : '') + '>' + esc(t) + '</button>';
      }).join('') + '</div></div>';
  }
  function controlsHTML(r) {
    const o = r.o, st = r.st, out = [];
    if (o.controls === false) return '';               // a printed page (report.js): the view it was asked for, no buttons
    if (o.zones) out.push(segHTML('view', st.view, 'view', [['zones', 'zones'], ['both', 'zones + shots'], ['shots', 'shots']]));
    if (o.kind === 'game' && o.sides) out.push(segHTML('side', st.side, 'team', [['both', 'both']].concat(o.sides.map((sd, i) => [String(i), sd.short || sd.name]))));
    const gl = o.gameList || [];
    if (gl.length > 5) {
      const opts = [['5', 'last 5']];
      if (gl.length > 10) opts.push(['10', 'last 10']);
      opts.push(['all', 'all ' + gl.length]);
      out.push(segHTML('last', st.last, 'games', opts));
    }
    out.push(segHTML('type', st.type, 'shots', [['all', 'all'], ['2', '2pt'], ['3', '3pt']]));
    if (st.view !== 'zones') out.push(segHTML('res', st.res, 'show', [['all', 'all'], ['made', 'makes'], ['miss', 'misses']]));
    const pers = [...new Set((o.shots || []).map(s => s.period).filter(p => p != null && p > 0))].sort((a, b) => a - b);
    if (pers.length > 1) {
      const opts = [['all', 'all']].concat(pers.filter(p => p <= PREG).map(p => [String(p), (PREG === 2 ? 'H' : 'Q') + p]));
      if (pers.some(p => p > PREG)) opts.push(['ot', 'OT']);
      out.push(segHTML('per', st.per, PREG === 2 ? 'half' : 'quarter', opts));
    }
    /* a player, where the chart holds more than one: grouped by side on a box score */
    const names = o.names || {};
    const pids = [...new Set((o.shots || []).map(s => s.pid).filter(p => p != null && names[p]))];
    if (pids.length > 1) {
      const opt = p => '<option value="' + esc(p) + '"' + (String(st.pid) === String(p) ? ' selected' : '') + '>' + esc(names[p]) + '</option>';
      const byName = (a, b) => String(names[a]).localeCompare(String(names[b]));
      let list;
      if (o.kind === 'game' && o.sides) {
        list = o.sides.map((sd, i) => {
          const mine = pids.filter(p => (o.shots || []).some(s => String(s.pid) === String(p) && +s.team === i)).sort(byName);
          return mine.length ? '<optgroup label="' + esc(sd.name) + '">' + mine.map(opt).join('') + '</optgroup>' : '';
        }).join('');
      } else list = pids.sort(byName).map(opt).join('');
      out.push('<div class="scw-grp"><span class="scw-sl">player</span><select class="scw-sel" data-sca="pid" aria-label="player">' +
        '<option value="all">every player</option>' + list + '</select></div>');
    }
    return '<div class="scw-bar">' + out.join('') + '</div>';
  }

  /* one court: the zone tints under the lines, the marks over them, the plates on top */
  function courtHTML(r, shots, marks, colour, ci) {
    const o = r.o, st = r.st, C = dims();
    const B = (typeof window !== 'undefined') && window.EpinoiaBox;
    const floor = o.minAttempts;
    const showZ = o.zones && st.view !== 'shots';
    const showM = st.view !== 'zones';
    const z = zones(shots);
    r.cur[ci] = { marks, zones: z, total: shots.length };
    const paths = zonePaths();
    /* a zone with too few attempts to rate, or none, is hatched faintly rather than left bare: measured, not missing */
    const hid = 'scwh' + (++seq);
    const hatch = '<defs><pattern id="' + hid + '" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="22" style="stroke:var(--sc-ink);stroke-opacity:.13;stroke-width:5"/></pattern></defs>';
    const tints = showZ ? hatch + ZONES.map(zz => {
      const v = z[zz.k];
      const cls = v.att >= floor ? bandCls(band(v.pct, zz.kind)) : (v.att ? 'few' : 'none');
      const say = ZNAME[zz.k] + ': ' + v.made + ' of ' + v.att + (v.att ? ', ' + Math.round(v.pct) + '%' : '');
      return '<path class="zt ' + cls + '" d="' + paths[zz.k] + '" fill-rule="evenodd" data-z="' + zz.k + '" data-c="' + ci + '" tabindex="0" role="img" aria-label="' + esc(say) + '"' +
        (v.att >= floor ? '' : ' style="fill:url(#' + hid + ')"') + '/>';
    }).join('') : '';
    const mk = showM ? marks.map((s, i) => {
      const x = (s.x * C.W).toFixed(1), y = (s.y * C.H).toFixed(1), a = 15;
      const shape = s.made
        ? '<circle class="dot" cx="' + x + '" cy="' + y + '" r="18"/>'
        : '<path class="cross" d="M ' + (x - a) + ' ' + (y - a) + ' L ' + (+x + a) + ' ' + (+y + a) + ' M ' + (x - a) + ' ' + (+y + a) + ' L ' + (+x + a) + ' ' + (y - a) + '"/>';
      return '<g class="mk ' + (s.made ? 'in' : 'out') + '" data-s="' + i + '" data-c="' + ci + '">' + shape + '<circle class="hit" cx="' + x + '" cy="' + y + '" r="44"/></g>';
    }).join('') : '';
    const plates = showZ ? ZONES.map(zz => {
      const v = z[zz.k];
      const few = v.att < floor;
      const big = few ? '' : Math.round(v.pct) + '%';
      const small = v.made + '/' + v.att;
      if (zz.k === 'c3l' || zz.k === 'c3r') {
        const txt = (big ? big + ' ' : '') + small, w = txt.length * 16 + 26, h = 46;
        return '<g class="pl' + (few ? ' few' : '') + '" transform="translate(' + zz.x + ' ' + zz.y + ') rotate(' + (zz.k === 'c3l' ? -90 : 90) + ')">' +
          '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="8"/>' +
          '<text class="sm" x="0" y="8" text-anchor="middle">' + txt + '</text></g>';
      }
      const w = Math.max(big.length * 26, small.length * 15) + 34, h = few ? 46 : 88;
      return '<g class="pl' + (few ? ' few' : '') + '" transform="translate(' + zz.x + ' ' + zz.y + ')">' +
        '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="10"/>' +
        (big ? '<text class="big" x="0" y="6" text-anchor="middle">' + big + '</text><text class="sm" x="0" y="34" text-anchor="middle">' + small + '</text>'
             : '<text class="sm" x="0" y="8" text-anchor="middle">' + small + '</text>') + '</g>';
    }).join('') : '';
    const court = (B && B.courtSVG) ? B.courtSVG(null) : '<svg viewBox="0 0 ' + C.W + ' ' + C.H + '"><rect x="0" y="0" width="' + C.W + '" height="' + C.H + '"/></svg>';
    let svg = court.replace(/(<rect[^>]*\/>)/, '$1' + tints);
    svg = svg.replace(/<\/svg>\s*$/, mk + plates + '</svg>');
    /* the marks in ink over the tints (a club's orange would vanish into a hot zone), in the club's colour on the bare floor */
    const mkc = showZ ? 'var(--sc-ink)' : (hexOk(colour) ? colour : 'var(--lume)');
    svg = svg.replace('<svg ', '<svg class="scw-svg" role="img" aria-label="shot chart" style="--mk:' + mkc + '" ');
    const empty = !shots.length ? '<div class="scw-empty">No shots match these choices.</div>' : '';
    return '<div class="scw-court">' + svg + empty + '<div class="scw-tip" role="status" hidden></div></div>';
  }

  /* a tile takes the scale's colour only from five attempts: 3 of 4 is not "hot" */
  function tileHTML(label, list, anchor) {
    const m = list.filter(s => s.made).length, a = list.length;
    const pct = a ? 100 * m / a : null;
    const cls = pct != null && anchor != null && a >= 5 ? bandCls(band(pct, anchor)) : 'bn';
    return '<div class="scw-tile"><span class="t">' + esc(label) + '</span><b>' + (pct == null ? '—' : Math.round(pct) + '%') + '</b>' +
      '<span class="n">' + m + '/' + a + '</span>' +
      '<i class="trk" aria-hidden="true"><i class="fl ' + cls + '" style="width:' + (pct == null ? 0 : pct.toFixed(1)) + '%"></i>' +
      (anchor != null ? '<i class="be" style="left:' + ANCHOR[anchor] + '%" title="break-even ' + ANCHOR[anchor] + '%"></i>' : '') + '</i></div>';
  }
  function tilesHTML(shots, sides) {
    const k = shots.map(sh => ({ sh, kind: kindOfShot(sh) }));
    const of = kind => k.filter(x => x.kind === kind).map(x => x.sh);
    return '<div class="scw-tiles">' +
      tileHTML('paint', of('paint'), 'paint') + tileHTML('mid-range', of('mid'), 'mid') + tileHTML('three', of('three'), 'three') +
      (sides ? tileHTML('left side', shots.filter(sh => sh.x < 0.4), null) + tileHTML('right side', shots.filter(sh => sh.x > 0.6), null) : '') +
      '</div>';
  }
  function legendHTML(r, shown, madeN) {
    const o = r.o, st = r.st, bits = [];
    if (st.view !== 'zones') {
      bits.push('<span class="lg"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/></svg>made</span>');
      bits.push('<span class="lg"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5 L15 15 M5 15 L15 5"/></svg>missed</span>');
    }
    if (o.zones && st.view !== 'shots') {
      bits.push('<span class="lg ramp"><span class="rl">below break-even</span><i class="bm3"></i><i class="bm2"></i><i class="bm1"></i><i class="b0"></i><i class="bp1"></i><i class="bp2"></i><i class="bp3"></i><span class="rl">above</span></span>');
      bits.push('<span class="lg"><i class="fewkey"></i>fewer than ' + o.minAttempts + ' attempts</span>');
    }
    const note = shown + ' shot' + (shown === 1 ? '' : 's') + ' · ' + madeN + ' made' + (o.note && st.last === 'all' ? ' · ' + esc(o.note) : '') +
      (st.last !== 'all' ? ' · last ' + st.last + ' games' : '');
    return '<div class="scw-legend">' + bits.join('') + '<span class="lg note">' + note + '</span></div>' +
      (o.zones && st.view !== 'shots' ? '<div class="scw-be">break-even: paint ' + ANCHOR.paint + '% · mid-range ' + ANCHOR.mid + '% · three ' + ANCHOR.three + '% · point at a zone or a shot for its numbers</div>'
                                      : '<div class="scw-be">point at a shot for who took it and when</div>');
  }

  function innerHTML(r) {
    const o = r.o, st = r.st;
    PREG = halvesIn(o.shots) ? 2 : 4;       // the labels of the chart being drawn
    r.cur = [];
    if (!(o.shots || []).length) {
      return '<div class="scw-none">No located shots yet — a shot is placed on the court in the scorer, and the ones taken without a location cannot be charted.</div>';
    }
    let body = '';
    if (o.kind === 'game' && o.sides) {
      const sides = st.side === 'both' ? [0, 1] : [+st.side];
      /* a player picked on one side is that side's chart alone */
      const pSide = st.pid !== 'all' ? (o.shots.find(s => String(s.pid) === st.pid) || {}).team : null;
      const show = pSide != null ? [+pSide] : sides;
      body = '<div class="scw-courts' + (show.length === 1 ? ' one' : '') + '">' + show.map(i => {
        const sd = o.sides[i] || {};
        const all = pick(r, false, i), marks = pick(r, true, i);
        const m = all.filter(s => s.made).length;
        return '<div class="scw-card" style="--side:' + (hexOk(sd.colour) ? sd.colour : 'var(--lume)') + '">' +
          '<div class="scw-ch"><span class="sw"></span><b>' + esc(sd.name) + '</b><span class="tot">' + m + '/' + all.length + (all.length ? ' · ' + Math.round(100 * m / all.length) + '%' : '') + '</span></div>' +
          courtHTML(r, all, marks, sd.colour, i) + tilesHTML(all, false) + '</div>';
      }).join('') + '</div>';
      const shownAll = show.reduce((n, i) => n + pick(r, false, i).length, 0);
      const madeAll = show.reduce((n, i) => n + pick(r, false, i).filter(s => s.made).length, 0);
      return controlsHTML(r) + body + legendHTML(r, shownAll, madeAll) +
        (o.located ? '<div class="scw-be">' + esc(o.located) + '</div>' : '');
    }
    const all = pick(r, false), marks = pick(r, true);
    const madeN = all.filter(s => s.made).length;
    body = courtHTML(r, all, marks, o.colour, 0) + legendHTML(r, all.length, madeN) + (o.zones && all.length ? tilesHTML(all, true) : '');
    let games = o.games || 0;
    if (st.last !== 'all' && o.gameList) games = Math.min(+st.last, o.gameList.length);
    const table = o.zones && o.table !== false && all.length ? zoneTableHTML(zoneRows(all, games), { minAttempts: o.minAttempts, colour: o.colour }) : '';
    return controlsHTML(r) + body + table;
  }

  function repaint(id, focusKey, focusVal) {
    const r = REG[id];
    if (!r || typeof document === 'undefined') return;
    const w = document.querySelector('.scw[data-scw="' + id + '"]');
    if (!w) return;
    w.innerHTML = innerHTML(r);
    if (focusKey) {
      const b = w.querySelector('[data-sca="' + focusKey + '"]' + (focusVal != null ? '[data-v="' + focusVal + '"]' : ''));
      if (b && b.focus) b.focus({ preventScroll: true });
    }
  }

  /* ---- the tooltip ---- */
  function tipFor(el) {
    const w = el.closest('.scw'); const r = w && REG[w.dataset.scw];
    if (!r) return null;
    const cur = r.cur[+el.dataset.c || 0];
    if (!cur) return null;
    if (el.dataset.z) {
      const v = cur.zones[el.dataset.z]; if (!v) return null;
      const zz = ZONES.find(x => x.k === el.dataset.z);
      const few = v.att < r.o.minAttempts;
      const d = v.att ? Math.round(v.pct - ANCHOR[zz.kind]) : null;
      return { v: v.att ? Math.round(v.pct) + '%' : '—', k: ZNAME[zz.k],
               d: [v.made + ' of ' + v.att, v.att ? 'break-even ' + ANCHOR[zz.kind] + '%' + (few ? '' : ' · ' + (d > 0 ? '+' : '') + d) : null,
                   cur.total ? Math.round(100 * v.att / cur.total) + '% of these shots' : null, few && v.att ? 'too few attempts to rate' : null].filter(Boolean) };
    }
    const s = cur.marks[+el.dataset.s]; if (!s) return null;
    const who = (r.o.names || {})[s.pid];
    const g = r.o.gameList ? r.o.gameList.find(x => x.id === s.gameId) : null;
    const when = [perTxt(s.period), clockTxt(s.clock)].filter(Boolean).join(' ');
    return { v: (s.made ? 'made' : 'missed') + ' ' + (s.three ? '3pt' : '2pt'), k: who || '',
             d: [[when, g && g.when].filter(Boolean).join(' · '), s.moved ? 'placed on the side of the arc it was worth' : null].filter(Boolean) };
  }
  function showTip(el, x, y) {
    const court = el.closest('.scw-court'); const tip = court && court.querySelector('.scw-tip');
    const t = tip && tipFor(el);
    if (!t) return;
    tip.textContent = '';
    const add = (tag, cls, txt) => { const n = document.createElement(tag); n.className = cls; n.textContent = txt; tip.appendChild(n); };
    add('b', 'v', t.v);
    if (t.k) add('span', 'k', t.k);
    t.d.forEach(line => add('span', 'd', line));
    const box = court.getBoundingClientRect();
    let px = x, py = y;
    if (px == null) { const b = el.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
    /* the page's zoom scales the box but not the pointer: work in the box's own pixels */
    const zx = court.offsetWidth ? box.width / court.offsetWidth : 1;
    const lx = (px - box.left) / zx, ly = (py - box.top) / zx;
    tip.hidden = false;
    tip.style.left = Math.max(70, Math.min(court.offsetWidth - 70, lx)) + 'px';
    tip.style.top = ly + 'px';
    tip.classList.toggle('below', ly < 90);
    const w = el.closest('.scw');
    w.querySelectorAll('.lit').forEach(n => n.classList.remove('lit'));
    el.classList.add('lit');
  }
  function hideTips() {
    document.querySelectorAll('.scw-tip:not([hidden])').forEach(t => { t.hidden = true; });
    document.querySelectorAll('.scw .lit').forEach(n => n.classList.remove('lit'));
  }

  let bound = false;
  function bind() {
    if (bound || typeof document === 'undefined' || !document.addEventListener) return;
    bound = true;
    const act = (el, v) => {
      const w = el.closest('.scw'); const r = w && REG[w.dataset.scw];
      if (!r) return;
      const key = el.dataset.sca;
      r.st[key] = v;
      if (key === 'view') { try { localStorage.setItem('epinoia.sc.view', v); } catch (_) { /* this page only */ } }
      if (key === 'side' && v !== 'both' && r.st.pid !== 'all') {
        const s = r.o.shots.find(x => String(x.pid) === r.st.pid);
        if (s && String(s.team) !== v) r.st.pid = 'all';
      }
      repaint(w.dataset.scw, key, el.tagName === 'BUTTON' ? v : null);
    };
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('.scw button[data-sca]') : null;
      if (b) { act(b, b.dataset.v); return; }
      const m = e.target && e.target.closest ? e.target.closest('.scw [data-s], .scw [data-z]') : null;
      if (m) showTip(m, e.clientX, e.clientY); else hideTips();
    });
    document.addEventListener('change', e => {
      const s = e.target && e.target.closest ? e.target.closest('.scw select[data-sca]') : null;
      if (s) act(s, s.value);
    });
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const m = e.target && e.target.closest ? e.target.closest('.scw [data-s], .scw [data-z]') : null;
      if (m) showTip(m, e.clientX, e.clientY);
      else if (document.querySelector('.scw-tip:not([hidden])')) hideTips();
    }, { passive: true });
    document.addEventListener('focusin', e => {
      const m = e.target && e.target.closest ? e.target.closest('.scw [data-z]') : null;
      if (m) showTip(m); else hideTips();
    });
  }

  /* A CLUB'S OR A PLAYER'S SEASON. o: host, shots, colour, zones (false: the free chart), minAttempts,
     games (a count, for the table's per-game columns), gameList ([{id, when}] newest first, for the games
     control and the tooltip's date), names ({pid: label}, for the player control), table, note. A second
     call on the same host keeps the reader's choices. */
  function renderZones(o) {
    const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
    if (!host) return;
    const opts = Object.assign({ kind: 'profile', minAttempts: o.minAttempts == null ? 3 : o.minAttempts, zones: o.zones !== false }, o);
    opts.zones = o.zones !== false;
    opts.minAttempts = o.minAttempts == null ? 3 : o.minAttempts;
    opts.colour = markColour(o.colour);
    let id = host.dataset && host.dataset.scwId;
    if (!id || !REG[id]) { id = 'c' + (++seq); if (host.dataset) host.dataset.scwId = id; REG[id] = { st: initState(opts) }; }
    REG[id].o = opts;
    if (!opts.zones) REG[id].st.view = 'shots';
    else if (/^(zones|both|shots)$/.test(o.view || '')) REG[id].st.view = o.view;   // a fixed view (report.js), not the reader's last
    bind();
    host.innerHTML = '<div class="scw" data-scw="' + id + '">' + innerHTML(REG[id]) + '</div>';
    return { zones: zones(o.shots || []), attempts: (o.shots || []).length };
  }

  /* A BOX SCORE'S TWO SIDES, as a string for a page that draws its tabs from strings: the state is kept
     under one key per page, so a live update (which redraws the tab) keeps the reader's choices.
     o: shots (x, y, made, three, team 0/1, pid, period, clock), sides ([{name, short, colour}] x 2),
     names ({pid: label}), located (a line on how many shots have a place). */
  function gameHTML(o) {
    const opts = Object.assign({ kind: 'game', zones: false, minAttempts: 3 }, o);
    opts.sides = (o.sides || []).map(sd => Object.assign({}, sd, { colour: markColour(sd.colour) }));
    if (!REG.game) REG.game = { st: initState(opts) };
    REG.game.o = opts;
    REG.game.st.view = 'shots';
    bind();
    return '<div class="scw scw-game" data-scw="game">' + innerHTML(REG.game) + '</div>';
  }

  return { gather, bin, render, shade, zones, zoneOf, zonePaths, zoneRows, zoneTableHTML, parts, PARTS, renderZones, gameHTML, gameListOf, whenOf, band, bandAt, attachZoneStats, reboundsOf, rebRow, markColour, ZONES, GROUPS, BIG, ANCHOR };
}));
