'use strict';
/* ============================================================================
   SILHOUETTE — the picture of a player the site has no photograph of yet.

   A player from the shoulders up, in pixels, on a small screen: head, neck, shoulders and the
   neckline and armholes of a vest. The screen is the site's own (dark or light, as the page is),
   with scanlines and a glow in the club's colour behind the head; the vest's trim, the frame and
   a headband are the club's colours. The figure itself is one solid shape, light on the dark
   screen and dark on the light one, so nothing in it says anything about the person but that
   there is one.

   One head, one neck and one pair of shoulders for every player, men's leagues and women's alike:
   no hair, no build, no jewellery, nothing that says who the player is. What varies, chosen from
   the player's id alone (so the same player always gets the same one, and a squad without
   photographs is not one picture copied): a headband in the club's colour or none, a round
   or a V neck, the head straight or turned a touch to either side.

   Every colour is checked before it is drawn: the figure clears 7:1 against its screen, the trim
   3:1 against the figure it sits on (a navy club's trim is lifted on the dark-on-light figure, a
   yellow club's darkened on the light one), the frame 3:1 against the screen. The maths is
   teamcolour.js's (WCAG relative luminance), repeated here so the module stands alone.

     EpinoiaSilhouette.variant(seed)          -> { band: 0-1, neck: 0-1, turn: -1, 0, 1 }
     EpinoiaSilhouette.palette(opts)          -> { screen, glow, scan, figure, vest, rim, trim, frame, theme }
     EpinoiaSilhouette.grid(opts)             -> { cols, rows, cells }  0 screen, 1 figure, 2 trim, 3 headband, 4 rim, 5 vest
     EpinoiaSilhouette.svg(opts)              -> '<svg role="img" ...>'  string; crisp rects, no network
     EpinoiaSilhouette.draw(ctx, x, y, w, h, opts)   the same picture on a canvas
     EpinoiaSilhouette.mount(host, opts)      puts the svg in host and redraws it when the theme flips
     EpinoiaSilhouette.label(name)            -> 'Ben Baker — no photograph yet'

   opts: { seed (the player's id), teamColour (the club's first colour: the glow, the bezel, the
   vest, its trim and the headband all come from it), theme 'dark' | 'light' | 'auto' (the
   page's data-theme), shape 'portrait' (4:5, the profile) | 'square' (a disc), res (columns: 32
   by default), frame (default: true on a portrait), label, scan (default true) }

   kit/silhouette.css lays it into its box. node supabase/tests/silhouette.test.mjs
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSilhouette = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ---------------------------------------------------------------- colour --- */
const DARK_GROUND = '#04100b', LIGHT_GROUND = '#f3faf6', MINT = '#93f2bf';
const parse = hex => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = rgb => '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
const lum = rgb => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const contrastRgb = (a, b) => { const la = lum(a) + 0.05, lb = lum(b) + 0.05; return la > lb ? la / lb : lb / la; };
const contrast = (a, b) => contrastRgb(parse(a), parse(b));
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
/* move c away from `from`, a step at a time, until it clears `ratio` against it */
function clear(c, from, ratio) {
  const away = lum(from) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 40 && contrastRgb(c, from) < ratio; i++) c = mix(c, away, 0.08);
  return c;
}

function themeOf(t) {
  if (t === 'light' || t === 'dark') return t;
  try {
    const d = root.document && root.document.documentElement;
    if (d && d.getAttribute('data-theme') === 'light') return 'light';
    if (d && d.getAttribute('data-theme') === 'dark') return 'dark';
  } catch (_) { /* no document: the dark screen */ }
  return 'dark';
}

function palette(o) {
  o = o || {};
  const theme = themeOf(o.theme);
  const light = theme === 'light';
  const A = parse(o.teamColour) || parse(MINT);
  const ground = parse(light ? LIGHT_GROUND : DARK_GROUND);
  /* the screen: the page's ground with a breath of the club in it */
  const screen = mix(ground, A, light ? 0.07 : 0.09);
  /* the figure: a phosphor grey on the dark screen, near-black on the light; 7:1 at least */
  const figure = clear(light ? [22, 33, 28] : [150, 168, 160], screen, 7);
  /* the vest: the figure with the club's colour through it, still a silhouette against the screen */
  const vest = clear(mix(figure, A, light ? 0.3 : 0.32), screen, 4.5);
  /* the rim, where the screen's light catches the figure's top edge */
  const rim = light ? mix(figure, A, 0.45) : mix(figure, [255, 255, 255], 0.45);
  /* the trim sits on the figure: the club's colour, moved off the figure until it shows */
  const trim = clear(clear(A.slice(), vest, 3), figure, 3);
  /* the frame and the glow sit on the screen */
  const frame = clear(A.slice(), screen, 3);
  return {
    theme,
    screen: toHex(screen), figure: toHex(figure), vest: toHex(vest), rim: toHex(rim), trim: toHex(trim),
    frame: toHex(frame), glow: toHex(A), glowAlpha: light ? 0.2 : 0.34,
    scan: light ? '#0d1f17' : '#000000', scanAlpha: light ? 0.05 : 0.28
  };
}

/* ---------------------------------------------------------------- variant --- */
/* FNV-1a over the id: small, stable, the same in every browser */
function hash(s) {
  s = String(s == null ? '' : s);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/* Only the id decides it, and only in ways that say nothing about who the player is: a headband or
   none, a round or a V neck, the head straight or turned a touch. One head outline, one neck, one pair
   of shoulders for every player, in a men's league or a women's: no hair, no build, no jewellery. */
function variant(seed) {
  const h = hash(seed);
  return { band: h & 1, neck: (h >>> 7) & 1, turn: ((h >>> 13) % 3) - 1 };
}

/* ---------------------------------------------------------------- the shape --- */
/* Drawn on a 32 x 40 design: the head's centre at (16, 14.5). Each test answers for one point. */
const CX = 16;
function headIn(x, y, v) {
  /* a turn moves the head half a pixel to one side and tucks the far ear in; nothing else changes */
  const hx = CX + v.turn * 0.55, dx = x - hx, cy = 14.4, ry = 7.2, dy = y - cy;
  /* one close-cropped outline for everybody: a rounded-square crown, the jaw narrowing below the cheekbones */
  const n = dy < 0 ? 2.6 : 2.1;
  const rx = dy > 0 ? 5.9 * (1 - 0.22 * Math.pow(dy / ry, 2)) : 5.9;
  if (Math.pow(Math.abs(dx) / rx, n) + Math.pow(Math.abs(dy) / ry, n) <= 1) return true;
  /* the ears; the one the head turns from shows less */
  const far = v.turn !== 0 && Math.sign(dx) === -v.turn;
  if (Math.pow((Math.abs(dx) - (far ? 5.6 : 5.95)) / (far ? 0.8 : 1.05), 2) + Math.pow((y - 15.2) / 1.8, 2) <= 1) return true;
  return false;
}
/* the half-width of neck, shoulders and chest at height y */
function bodyHalf(y) {
  if (y < 20.5) return 0;
  if (y < 23.2) return 3.55;
  if (y < 28.2) return 3.55 + 7.1 * Math.pow((y - 23.2) / 5, 1.35);
  if (y < 32.4) return 10.65 + 3.6 * Math.sqrt(Math.max(0, 1 - Math.pow((32.4 - y) / 4.2, 2)));
  return 14.25 + (y - 32.4) * 0.06;
}
function bodyIn(x, y) { return Math.abs(x - CX) <= bodyHalf(y); }
/* where the armhole runs at height y: down from the strap on the shoulder, round under the deltoid */
function armX(y) {
  const ax = 8.4 + 1.4 * Math.sqrt(Math.max(0, (y - 26.2) / 8.4));
  return y > 30.6 ? ax - Math.pow((y - 30.6) / 4, 2) * 2.2 : ax;
}
/* the neck opening: inside it is skin, not vest */
function neckOpen(x, y, v) {
  if (v.neck === 0) return Math.hypot(x - CX, y - 23.4) < 4.6;
  return Math.abs(x - CX) < 3.6 - (y - 24.6) * 0.62;
}
/* the vest itself: the chest and back between the armholes, below the neckline */
function vestIn(x, y, v) {
  if (y < 24.6 || !bodyIn(x, y)) return false;
  if (Math.abs(x - CX) > (y < 34.6 ? armX(y) : armX(34.6) + (y - 34.6) * 0.3)) return false;
  return !neckOpen(x, y, v);
}
/* the vest's lines, `t` thick (a cell's width at least, so they survive a coarse grid) */
function trimIn(x, y, v, t) {
  const dx = Math.abs(x - CX);
  if (y < 24.6 || !bodyIn(x, y)) return false;
  if (v.neck === 0) {
    const r = Math.hypot(x - CX, y - 23.4);
    if (r >= 4.6 - t * 0.5 && r <= 4.6 + t * 0.5) return true;
  } else {
    const edge = 3.6 - (y - 24.6) * 0.62;                // a V down to the chest
    if (edge > -0.4 && Math.abs(dx - Math.max(0, edge)) <= t * 0.55 && y <= 30.6) return true;
  }
  if (y >= 26.2 && y < 34.6 && Math.abs(dx - armX(y)) <= t * 0.55) return true;
  return false;
}
function headbandIn(x, y, v, t) {
  return v.band === 1 && y >= 9.9 && y <= 9.9 + Math.max(1.5, t) && headIn(x, y, v);
}

/* the design window each shape looks through */
function frameOf(shape) {
  return shape === 'square' ? { x0: 1, y0: 5, w: 30, h: 30 } : { x0: 0, y0: 0, w: 32, h: 40 };
}

function grid(o) {
  o = o || {};
  const v = Object.assign({ band: 0, neck: 0, turn: 0 }, o.variant || variant(o.seed));
  const win = frameOf(o.shape);
  const cols = Math.max(8, Math.min(64, Math.round(o.res || 32)));
  const rows = Math.round(cols * win.h / win.w);
  const step = win.w / cols;
  const t = Math.max(1, step * 1.05);
  const cells = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = win.x0 + (i + 0.5) * step, y = win.y0 + (j + 0.5) * step;
      let c = 0;
      const head = headIn(x, y, v), body = bodyIn(x, y);
      if (head || body) c = 1;
      if (c && !head && vestIn(x, y, v)) c = 5;
      if (c && !head && trimIn(x, y, v, t)) c = 2;
      if (c && headbandIn(x, y, v, t)) c = 3;
      cells[j * cols + i] = c;
    }
  }
  /* on the dark screen its light catches the top edge of the head and the shoulders: one pixel, lit */
  if (o.rim !== false && palette(o).theme === 'dark') {
    for (let j = 1; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (cells[j * cols + i] === 1 && cells[(j - 1) * cols + i] === 0) cells[j * cols + i] = 4;
      }
    }
  }
  return { cols, rows, cells, variant: v };
}

/* ---------------------------------------------------------------- svg --- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* each class as one path of horizontal runs */
function runs(g, cls) {
  let d = '';
  for (let j = 0; j < g.rows; j++) {
    let i = 0;
    while (i < g.cols) {
      if (g.cells[j * g.cols + i] !== cls) { i++; continue; }
      let k = i;
      while (k < g.cols && g.cells[j * g.cols + k] === cls) k++;
      d += 'M' + i + ' ' + j + 'h' + (k - i) + 'v1h' + (i - k) + 'z';
      i = k;
    }
  }
  return d;
}

let uid = 0;
function label(name) {
  const n = String(name || '').trim();
  return (n ? n + ' — ' : '') + 'no photograph yet';
}

function svg(o) {
  o = o || {};
  const g = grid(o), p = palette(o);
  const id = 'silg' + (++uid).toString(36) + hash(o.seed).toString(36).slice(0, 4);
  const portrait = o.shape !== 'square';
  const frame = o.frame == null ? portrait : !!o.frame;
  const W = g.cols, H = g.rows;
  /* the head's centre in this grid, for the glow */
  const win = frameOf(o.shape), k = W / win.w;
  const gx = ((CX - win.x0) * k).toFixed(2), gy = ((14.6 - win.y0) * k).toFixed(2);
  const lab = o.label != null ? String(o.label) : label(o.name);
  let s = '<svg class="sil' + (portrait ? ' sil-portrait' : ' sil-square') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' +
    ' preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" role="img" aria-label="' + esc(lab) + '"' +
    ' data-sil-band="' + g.variant.band + '" data-sil-neck="' + g.variant.neck + '" data-sil-turn="' + g.variant.turn + '" data-sil-theme="' + p.theme + '">';
  s += '<defs><radialGradient id="' + id + '" cx="' + gx + '" cy="' + gy + '" r="' + (W * 0.62).toFixed(2) + '" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="' + p.glow + '" stop-opacity="' + p.glowAlpha + '"/>' +
    '<stop offset="1" stop-color="' + p.glow + '" stop-opacity="0"/></radialGradient></defs>';
  s += '<rect class="sil-scr" width="' + W + '" height="' + H + '" fill="' + p.screen + '"/>';
  s += '<rect class="sil-glow" width="' + W + '" height="' + H + '" fill="url(#' + id + ')"/>';
  if (frame) {
    /* the screen's bezel in the club's colour, one pixel in from the edge, broken at the corners; the figure stands in front of it */
    s += '<path class="sil-frame" fill="' + p.frame + '" d="M2 1h' + (W - 4) + 'v.5h-' + (W - 4) + 'z' +
      'M2 ' + (H - 1.5) + 'h' + (W - 4) + 'v.5h-' + (W - 4) + 'z' +
      'M1 2h.5v' + (H - 4) + 'h-.5z' + 'M' + (W - 1.5) + ' 2h.5v' + (H - 4) + 'h-.5z"/>';
  }
  s += '<path class="sil-fig" fill="' + p.figure + '" d="' + runs(g, 1) + '"/>';
  const tv = runs(g, 5), tr = runs(g, 4);
  if (tv) s += '<path class="sil-vest" fill="' + p.vest + '" d="' + tv + '"/>';
  if (tr) s += '<path class="sil-rim" fill="' + p.rim + '" d="' + tr + '"/>';
  const t1 = runs(g, 2), t2 = runs(g, 3);
  if (t1) s += '<path class="sil-trim" fill="' + p.trim + '" d="' + t1 + '"/>';
  if (t2) s += '<path class="sil-band" fill="' + p.trim + '" d="' + t2 + '"/>';
  if (o.scan !== false) {
    /* scanlines: a dark sliver along the foot of every row of pixels, and a fainter one up every column */
    let d = '';
    for (let j = 1; j <= H; j++) d += 'M0 ' + (j - 0.22) + 'h' + W + 'v.22h-' + W + 'z';
    s += '<path class="sil-scan" shape-rendering="auto" fill="' + p.scan + '" fill-opacity="' + p.scanAlpha + '" d="' + d + '"/>';
    let e = '';
    for (let i = 1; i < W; i++) e += 'M' + (i - 0.08) + ' 0v' + H + 'h.16v-' + H + 'z';
    s += '<path class="sil-grid" shape-rendering="auto" fill="' + p.scan + '" fill-opacity="' + (p.scanAlpha * 0.4).toFixed(3) + '" d="' + e + '"/>';
  }
  return s + '</svg>';
}

/* ---------------------------------------------------------------- canvas --- */
/* The same picture on a 2D context, inside (x, y, w, h); the caller clips it (a disc, a card). The
   grid is fitted the way the svg's "xMidYMax slice" fits it: filling the box, kept to its foot. */
function draw(ctx, x, y, w, h, o) {
  o = o || {};
  const g = grid(o), p = palette(o);
  const cell = Math.max(w / g.cols, h / g.rows);
  const ox = x + (w - g.cols * cell) / 2, oy = y + h - g.rows * cell;
  ctx.save();
  ctx.fillStyle = p.screen; ctx.fillRect(x, y, w, h);
  const win = frameOf(o.shape), k = g.cols / win.w;
  const gx = ox + (CX - win.x0) * k * cell, gy = oy + (14.6 - win.y0) * k * cell;
  if (ctx.createRadialGradient) {
    const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.cols * 0.62 * cell);
    const rgb = parse(p.glow);
    gr.addColorStop(0, 'rgba(' + rgb.join(',') + ',' + p.glowAlpha + ')');
    gr.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
  }
  const fills = [null, p.figure, p.trim, p.trim, p.rim, p.vest];
  for (let j = 0; j < g.rows; j++) {
    let i = 0;
    while (i < g.cols) {
      const c = g.cells[j * g.cols + i];
      if (!c) { i++; continue; }
      let e = i;
      while (e < g.cols && g.cells[j * g.cols + e] === c) e++;
      ctx.fillStyle = fills[c];
      /* whole device pixels, a hair over, so no seam shows between the cells */
      const x0 = Math.floor(ox + i * cell), y0 = Math.floor(oy + j * cell);
      ctx.fillRect(x0, y0, Math.ceil(ox + e * cell) - x0, Math.ceil(oy + (j + 1) * cell) - y0);
      i = e;
    }
  }
  if (o.scan !== false && cell >= 3) {
    ctx.globalAlpha = p.scanAlpha;
    ctx.fillStyle = p.scan;
    const sh = Math.max(1, cell * 0.22);
    for (let j = 1; j <= g.rows; j++) {
      const yy = oy + j * cell - sh;
      if (yy + sh < y || yy > y + h) continue;
      ctx.fillRect(x, yy, w, sh);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return g;
}

/* ---------------------------------------------------------------- the page --- */
/* hosts drawn with theme 'auto', redrawn when the page's theme changes */
const live = new Set();
let watching = false;
function watch() {
  if (watching || !root.document || typeof root.MutationObserver !== 'function') return;
  watching = true;
  new root.MutationObserver(() => {
    live.forEach(h => { if (!h.isConnected) live.delete(h); else paint(h); });
  }).observe(root.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
function paint(host) {
  const o = host.__sil;
  const old = host.querySelector(':scope > svg.sil');
  const tmp = root.document.createElement('div');
  tmp.innerHTML = svg(o);
  const fresh = tmp.firstChild;
  if (old) host.replaceChild(fresh, old);
  else host.insertBefore(fresh, host.firstChild);
  return fresh;
}
function mount(host, o) {
  if (!host || !root.document) return null;
  host.__sil = Object.assign({}, o || {});
  host.classList.add('has-sil');
  const node = paint(host);
  if (!o || !o.theme || o.theme === 'auto') { live.add(host); watch(); }
  return node;
}

return { variant, palette, grid, svg, draw, mount, label, hash, contrast };
}));
