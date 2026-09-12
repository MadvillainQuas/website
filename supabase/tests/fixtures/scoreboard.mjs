/* ============================================================================
   A SCOREBOARD, RENDERED.

   The clock cam's decoder needs boards to read, and a sports hall is a poor place
   to run an experiment: one board, one light level, one afternoon. So this draws
   them -- true seven-segment geometry, then the things that actually go wrong in a
   hall: dim panels, LEDs caught mid-PWM-cycle, rolling-shutter banding, hand
   blur, sensor noise, glare, a phone that is not square to the board, dot-matrix
   lamps, and the colon that blinks off on half the frames.

   It lives beside the tests rather than inside one so that a bench run and a
   one-off "why did THAT frame fail" script are looking at identical boards.
   ============================================================================ */
/* ---------------------------------------------------------------- random ---
   Seeded, so a run is reproducible and a regression is a regression rather than
   an unlucky afternoon. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------ the board ---
   Standard seven-segment geometry. a is the top bar, then clockwise b c d e f,
   and g is the middle -- the same order the decoder samples in. */
const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

function segRects(w, h, t) {
  const half = h / 2;
  return {
    a: [t * 0.5, 0, w - t, t],
    b: [w - t, t * 0.5, t, half - t],
    c: [w - t, half + t * 0.5, t, half - t],
    d: [t * 0.5, h - t, w - t, t],
    e: [0, half + t * 0.5, t, half - t],
    f: [0, t * 0.5, t, half - t],
    g: [t * 0.5, half - t / 2, w - t, t],
  };
}

/* Draws the board into a float intensity buffer at high resolution: 1 where a
   segment is lit, 0 where the panel is. Everything else -- scaling, rotation,
   blur, noise -- happens on the way out of here, so the geometry stays honest. */
function drawBoard(text, opt, rnd) {
  const dh = 120, dw = Math.round(dh * 0.56), t = Math.round(dw * 0.2);
  const gap = Math.round(dw * 0.18), colonW = Math.max(3, Math.round(t * 0.9));
  const cells = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ':') { cells.push({ ch, x, w: colonW }); x += colonW + gap; }
    else if (ch === '.') { cells.push({ ch, x, w: colonW }); x += colonW + gap; }
    else { cells.push({ ch, x, w: dw }); x += dw + gap; }
  }
  const boardW = Math.max(1, x - gap), boardH = dh;
  const BW = boardW + 2, BH = boardH + 2;
  const buf = new Float32Array(BW * BH);
  const put = (x0, y0, w, h, v) => {
    for (let yy = Math.max(0, Math.round(y0)); yy < Math.min(BH, Math.round(y0 + h)); yy++)
      for (let xx = Math.max(0, Math.round(x0)); xx < Math.min(BW, Math.round(x0 + w)); xx++)
        buf[yy * BW + xx] = Math.max(buf[yy * BW + xx], v);
  };
  const R = segRects(dw, dh, t);
  for (const c of cells) {
    if (c.ch === ':') {
      /* the colon blinks on most boards; when it is off the digits are all the
         decoder sees, which is the single nastiest thing a real board does */
      if (opt.colonOff) continue;
      put(c.x, dh / 3 - colonW / 2, colonW, colonW, 1);
      put(c.x, 2 * dh / 3 - colonW / 2, colonW, colonW, 1);
      continue;
    }
    if (c.ch === '.') { put(c.x, dh - colonW, colonW, colonW, 1); continue; }
    const lit = SEGS[+c.ch] || '';
    for (const s of lit) {
      /* a board with a dead lamp row: this segment is simply not there on any
         digit, which is how a half-lit digit gets made -- and a half-lit digit
         used to be mistaken for a colon */
      if (opt.drop && opt.drop.indexOf(s) >= 0) continue;
      const [sx, sy, sw, sh] = R[s];
      /* PWM: a segment caught mid-cycle by a short exposure comes out dim */
      const v = opt.flicker ? (rnd() < opt.flicker ? 1 - opt.flickerDepth : 1) : 1;
      put(c.x + sx, sy, sw, sh, v);
    }
  }
  return { buf, BW, BH };
}

/* Resamples the board into the crop the phone would actually hand the decoder:
   rotated a little, padded a little, and at whatever size the crop came out. */
function renderCrop(text, opt, rnd) {
  const { buf, BW, BH } = drawBoard(text, opt, rnd);
  const fill = opt.fill == null ? 0.86 : opt.fill;       // digit height as a share of the crop
  const W = opt.W || 240;
  /* the crop keeps the board's aspect: a narrower crop is a LOWER-RESOLUTION
     picture of the same board, not a squashed one. Getting this wrong made the
     bench's "small crop" case a test of a squeezed aspect ratio instead. */
  const H = opt.H || Math.max(20, Math.round(W * (BH / fill) / (BW / 0.96)));
  const ang = (opt.angle || 0) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const sx = BW / (W * 0.96), sy = BH / (H * fill);
  const cx = W / 2, cy = H / 2, bx = BW / 2, by = BH / 2;
  const SS = 2;                                           // supersample, for clean edges
  const grey = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let oy = 0; oy < SS; oy++) for (let ox = 0; ox < SS; ox++) {
      const px = x + (ox + 0.5) / SS - cx, py = y + (oy + 0.5) / SS - cy;
      const rx = px * ca - py * sa, ry = px * sa + py * ca;
      const u = bx + rx * sx, v = by + ry * sy;
      if (u < 0 || v < 0 || u >= BW - 1 || v >= BH - 1) continue;
      const u0 = u | 0, v0 = v | 0, fu = u - u0, fv = v - v0;
      acc += buf[v0 * BW + u0] * (1 - fu) * (1 - fv) + buf[v0 * BW + u0 + 1] * fu * (1 - fv)
           + buf[(v0 + 1) * BW + u0] * (1 - fu) * fv + buf[(v0 + 1) * BW + u0 + 1] * fu * fv;
    }
    grey[y * W + x] = acc / (SS * SS);
  }

  /* rolling shutter across a PWM board: horizontal bands where the LEDs were off */
  if (opt.banding) {
    const period = opt.bandPeriod || 17, phase = rnd() * period;
    for (let y = 0; y < H; y++) {
      const k = 1 - opt.banding * 0.5 * (1 + Math.cos(2 * Math.PI * (y + phase) / period));
      for (let x = 0; x < W; x++) grey[y * W + x] *= k;
    }
  }
  if (opt.blur) {
    const r = opt.blur, tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; s += grey[y * W + xx]; n++; }
      tmp[y * W + x] = s / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; s += tmp[yy * W + x]; n++; }
      grey[y * W + x] = s / n;
    }
  }

  /* to pixels: a dark panel with bright digits, unless the board is the bright one */
  const fg = opt.bright ? 0.10 : (opt.dim == null ? 0.92 : opt.dim);
  const bg = opt.bright ? 0.88 : 0.06;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = bg + (fg - bg) * grey[y * W + x];
    if (opt.glare) {
      /* a bright wash over part of the crop -- a window, or the board's perspex */
      const gx = (opt.glareAt == null ? 0.25 : opt.glareAt) * W;
      const d = Math.hypot(x - gx, y - H * 0.3) / (W * 0.45);
      v += opt.glare * Math.exp(-d * d * 2);
    }
    if (opt.dots) {
      /* a dot-matrix board: the segment is there, but only where a lamp is */
      const p = opt.dots;
      const on = (x % p) < Math.max(1, p - 2) && (y % p) < Math.max(1, p - 2);
      if (!on) v = bg + (v - bg) * 0.15;
    }
    if (opt.noise) v += (rnd() + rnd() + rnd() - 1.5) * opt.noise;
    const c = Math.max(0, Math.min(1, v)) * 255;
    const i = (y * W + x) * 4;
    data[i] = c; data[i + 1] = c; data[i + 2] = c; data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}

export { rng, drawBoard, renderCrop, SEGS, segRects };
