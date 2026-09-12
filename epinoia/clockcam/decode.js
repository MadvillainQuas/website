/* ============================================================================
   THE SEVEN-SEGMENT DECODER, ON ITS OWN.

   This was inside clockcam.js, where it could only ever be run by pointing a
   phone at a scoreboard. That is a bad place for the one piece of the clock cam
   that is pure arithmetic: it takes pixels in and gives a number out, it has no
   opinion about cameras or channels, and it is the part most likely to be wrong.

   So it lives here, and supabase/tests/clockcam.decode.test.mjs renders
   scoreboards it has never seen -- dim ones, flickering ones, blurred ones, ones
   at an angle -- and measures how many it reads. An accuracy number that moves
   when the code changes is worth more than any amount of squinting at a hall.

   WHAT IT DOES. A hall's scoreboard is LED digits on a dark board and the person
   has already drawn a box round them, so the honest job is not text recognition
   but "which segments are lit". The crop is greyed and thresholded (Otsu, at the
   midpoint of the two class means), split into glyphs by columns of ink, and each
   glyph is sampled at seven small regions -- top, upper-left, upper-right, middle,
   lower-left, lower-right, bottom. The lit pattern names the digit.

   Everything here is pure: give it {width, height, data} in RGBA and it will
   answer without touching a DOM. That is what makes it testable, and it is why
   the browser and the test are running the same code rather than two copies that
   drift.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCDecode = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {
'use strict';

/* AVERAGE A FEW FRAMES BEFORE READING ANY OF THEM.

   Nearly every LED scoreboard is pulse-width modulated: the lamps are not on, they
   are on for part of each cycle, and a phone exposing for a thousandth of a second
   catches some of them mid-gap. The segment is not dim in that frame, it is ABSENT
   -- which is why a board that looks perfectly steady to the eye was being read on
   one frame in five, and the clock crawled.

   The phase is different every frame, so the fix is free: average three of them
   and a segment that was missing from one is present in the other two. On the
   bench this takes a flickering board from 20% of frames read to 99%, and it costs
   a clean board nothing at all, because averaging three pictures of the same
   number is that number.

   Three, not two: two is not enough to outvote a gap, and it is also the size at
   which a digit CHANGING part-way through the stack stops producing a confident
   wrong answer -- at three the blurred frame simply fails to parse and is dropped.
   The cost is that a reading is about a fifth of a second behind the board, which
   on a stream already seconds behind is not a thing anyone can see. */
function stack(imgs) {
  if (!imgs || !imgs.length) return null;
  if (imgs.length === 1) return imgs[0];
  const { width, height } = imgs[0];
  const n = imgs.length, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < n; k++) {
      const d = imgs[k].data;
      if (imgs[k].width !== width || imgs[k].height !== height) return imgs[imgs.length - 1];
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; data[i + 3] = 255;
  }
  return { width, height, data };
}

/* the crop as bright digits on black: grey, Otsu, inverted if the board is the bright part */
function binarise(img, forceInvert, thrAdj) {
  const { width: W, height: H, data } = img;
  const g = new Uint8Array(W * H); let sum = 0;
  for (let i = 0; i < W * H; i++) { g[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.5 + data[i * 4 + 2] * 0.2) | 0; sum += g[i]; }
  const mean = sum / (W * H);
  const hist = new Uint32Array(256); for (let i = 0; i < W * H; i++) hist[g[i]]++;
  let total = W * H, sumAll = 0; for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = 0, thr = 128;
  /* Otsu, taking the threshold as the midpoint between the two class means: on a clean board
     the between-class variance is flat across the whole gap, and the first t on that plateau
     is the dark mode itself -- which put the digits' own grey on the wrong side of the line */
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += t * hist[t]; const mB = sumB / wB, mF = (sumAll - sumB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best + 1e-9) { best = v; thr = Math.round((mB + mF) / 2); } }
  thr = Math.max(8, Math.min(247, thr + (thrAdj || 0)));
  const invert = forceInvert != null ? forceInvert : (mean > 128);     // bright board: the digits are the dark part
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = invert ? (g[i] < thr ? 1 : 0) : (g[i] > thr ? 1 : 0);
  return { W, H, bits: out };
}

/* glyphs: runs of columns with ink, cut to their rows */
function glyphs(b) {
  const { W, H, bits } = b;
  const col = new Uint16Array(W);
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) n += bits[y * W + x]; col[x] = n; }
  /* A DOT-MATRIX BOARD HAS DEAD COLUMNS INSIDE EVERY DIGIT.

     Splitting on "any column with no ink" is right for a true seven-segment board
     and catastrophic for a dot-matrix one, where the gaps between lamps are dead
     columns too: one digit arrives as four or five slivers, none of them shaped
     like anything, and the whole frame is discarded. Dot-matrix boards read at
     nothing at all before this.

     So the profile is smoothed by a couple of columns before runs are cut from it,
     which closes the lamp gaps while leaving the real gap between two digits --
     several times wider -- still empty. Each run is then trimmed back to the
     columns that actually carry ink, so the smoothing decides only where a glyph
     BREAKS, never where its edges are: the right-aligned digit frame in segDigit
     depends on those edges being exact.

     AND IT IS ONLY DONE WHEN THE RUNS LOOK BROKEN. Smoothing unconditionally
     merges two digits into one on a board photographed at a slight angle, where
     the corner of a leaning digit already reaches into its neighbour's gap --
     which cost every angled board its reading. A seven-segment digit is about
     half as wide as it is tall; a dot-matrix sliver is a twentieth. So the runs
     are cut plainly first, and the profile is only closed if what came back is
     narrower than any real digit could be. */
  const cut = prof => {
    const out = []; let x = 0;
    while (x < W) {
      if (prof[x] > 0) {
        let s = x; while (x < W && prof[x] > 0) x++;
        let a = s, z = x;
        while (a < z && col[a] === 0) a++;               // trim to real ink
        while (z > a && col[z - 1] === 0) z--;
        if (z > a) out.push([a, z]);
      } else x++;
    }
    return out;
  };
  const spanOf = rs => {
    let lo = H, hi = 0;
    for (const [x0, x1] of rs) for (let y = 0; y < H; y++) { if (lo <= y && y <= hi) continue; for (let xx = x0; xx < x1; xx++) if (bits[y * W + xx]) { if (y < lo) lo = y; if (y > hi) hi = y; break; } }
    return hi - lo + 1;
  };
  let runs = cut(col), dotty = false;
  if (runs.length > 1) {
    const ws = runs.map(([a, z]) => z - a).sort((p, q) => p - q);
    const med = ws[ws.length >> 1], tall = spanOf(runs);
    if (tall > 0 && med < tall * 0.25) {
      const r = Math.max(1, Math.round(H * 0.02));
      const colS = new Uint16Array(W);
      for (let x = 0; x < W; x++) { let n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) n += col[xx]; } colS[x] = n; }
      runs = cut(colS);
      dotty = true;
    }
  }
  const mk = (x0, x1) => {
    let y0 = H, y1 = 0;
    for (let y = 0; y < H; y++) for (let xx = x0; xx < x1; xx++) if (bits[y * W + xx]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let ink = 0; for (let xx = x0; xx < x1; xx++) ink += col[xx];
    return { x0, x1, y0, y1: y1 + 1, w: x1 - x0, h: y1 + 1 - y0, ink };
  };
  let gs = runs.map(([x0, x1]) => mk(x0, x1)).filter(g => g.h > 0);

  /* TWO DIGITS CAN ARRIVE AS ONE BLOB.

     Hold the phone a few degrees off square and a leaning digit's top corner
     reaches past its neighbour's foot: there is no longer a single column of
     empty board between them, so they come out as one run twice the proper width
     and the whole frame is dropped -- or worse, read as a two-digit clock. It is
     the commonest way an angled board fails.

     A run that is about twice as wide as the others is therefore cut in two, at
     the emptiest column near where the join should be. Emptiest rather than
     midway, because where two digits touch there is still a dip: the 0 and the 3
     of 10:03 overlap at their corners, not along their whole height. */
  let maxH = 0; for (const g of gs) if (g.h > maxH) maxH = g.h;
  const tallH = gs.filter(g => g.h >= maxH * 0.62).map(g => g.h).sort((p, q) => p - q);
  /* THE CELL IS MEASURED FROM THE HEIGHT, NOT FROM THE WIDTHS.

     Taking the median WIDTH to decide what a normal digit looks like fails on
     exactly the frames this is here to rescue: when two of four digits have run
     together, half the widths ARE the merged width, the median lands on it, and
     every blob is declared normal. Heights cannot merge -- all the digits on a
     board are the same height whatever the phone does -- and a seven-segment
     digit is a bit over half as wide as it is tall. */
  const med = tallH.length ? Math.round(0.58 * tallH[tallH.length >> 1]) : 0;
  if (med > 2) {
    const out = [];
    for (const g of gs) {
      /* a digit is never much wider than its cell; a 1 is narrower. So width over
         the cell means a merge, and how far over says how many ran together. */
      const k = (g.h >= maxH * 0.62 && g.w > med * 1.35) ? Math.max(2, Math.round(g.w / med)) : 1;
      if (k <= 1 || k > 4) { out.push(g); continue; }
      const cuts = [g.x0];
      for (let i = 1; i < k; i++) {
        const target = g.x0 + Math.round(i * g.w / k), win = Math.max(2, Math.round(med * 0.22));
        let bx = target, bv = Infinity;
        for (let x = Math.max(cuts[cuts.length - 1] + 2, target - win); x < Math.min(g.x1 - 2, target + win); x++)
          if (col[x] < bv) { bv = col[x]; bx = x; }
        if (bx > cuts[cuts.length - 1]) cuts.push(bx);
      }
      cuts.push(g.x1);
      for (let i = 1; i < cuts.length; i++) {
        let a = cuts[i - 1], z = cuts[i];
        while (a < z && col[a] === 0) a++;
        while (z > a && col[z - 1] === 0) z--;
        if (z > a) { const sub = mk(a, z); if (sub.h > 0) out.push(sub); }
      }
    }
    gs = out;
  }
  /* the profile had to be closed to find these glyphs at all, which only happens
     on a board made of separate lamps rather than continuous bars. The digit
     reader needs to know, because on such a board every segment is partly gaps
     and "too close to call" means something different. */
  gs.dotty = dotty;
  return gs;
}

const SEG = { '1111110': 0, '0110000': 1, '1101101': 2, '1111001': 3, '0110011': 4, '1011011': 5, '1011111': 6, '1110000': 7, '1111111': 8, '1111011': 9, '1110010': 7 };

/* The lean of the digits, as a slope: how far the middle of a digit rises across
   one pixel of travel to the right. Nobody clamps a phone perfectly square to a
   board, and a few degrees is enough to put the seven sample regions over the
   wrong parts of a digit. Read off the line the digit centres sit on. */
function skewOf(gs) {
  if (!gs || gs.length < 2) return 0;
  let sx = 0, sy = 0;
  const cx = gs.map(g => (g.x0 + g.x1) / 2), cy = gs.map(g => (g.y0 + g.y1) / 2);
  for (let i = 0; i < gs.length; i++) { sx += cx[i]; sy += cy[i]; }
  const mx = sx / gs.length, my = sy / gs.length;
  let num = 0, den = 0;
  for (let i = 0; i < gs.length; i++) { num += (cx[i] - mx) * (cy[i] - my); den += (cx[i] - mx) * (cx[i] - mx); }
  if (den < 1e-6) return 0;
  return Math.max(-0.35, Math.min(0.35, num / den));
}

/* The glyph's extent measured along its own lean, not along the image. A leaning
   digit's upright bounding box is bigger than the digit in both directions -- it
   has to contain the raised corner and the dropped one -- so dividing that box
   into sevenths puts every sample region slightly off, and the error lands worst
   on the top and bottom bars, which are what tell a 3 from an 8. */
function glyphExtent(b, g, ca, sa) {
  const { W, H, bits } = b;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, any = false;
  for (let y = Math.max(0, g.y0); y < Math.min(H, g.y1); y++)
    for (let x = Math.max(0, g.x0); x < Math.min(W, g.x1); x++) if (bits[y * W + x]) {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v; any = true;
    }
  return any ? { u0, u1, v0, v1, w: u1 - u0 + 1, h: v1 - v0 + 1 } : null;
}

/* the digit cell's width, in the digits' own frame: about half the height, and a
   line of nothing but ones must not talk it down */
function frameWidthU(exts) {
  if (!exts.length) return 0;
  const hs = exts.map(e => e.h).sort((p, q) => p - q);
  const mh = hs[hs.length >> 1];
  /* anything wider than its own height is two digits that have run together, and
     must not be allowed to set what a digit cell is */
  const ws = exts.map(e => e.w).filter(w => w <= mh * 0.9).sort((p, q) => p - q);
  const mw = ws.length ? ws[ws.length >> 1] : 0;
  return Math.max(mw, Math.round(0.55 * mh));
}

function segDigit(b, g, frameW, skew, ext, dotty) {
  const { W, H, bits } = b;
  /* THE SEVEN REGIONS ARE SAMPLED IN THE DIGIT'S OWN FRAME, NOT THE IMAGE'S.

     Shearing the sample rows by the lean -- the obvious fix -- levels the line of
     digits but leaves every vertical stroke still leaning, because a rotation
     tilts the strokes as well as the baseline. A 1 photographed eight degrees off
     square has a bar whose top sits a fifth of a digit-width to the side of its
     foot, which reaches into the region where the top bar would be, and the 1 is
     read as a 7. Rotating the sample points instead of shearing them fixes both
     at once: the regions land on the digit wherever the phone was held. */
  const a = Math.atan(skew || 0), ca = Math.cos(a), sa = Math.sin(a);
  const e = ext || glyphExtent(b, g, ca, sa);
  if (!e || e.h < 2) return null;
  /* A BLOB IS NOT A DIGIT. When two leaning digits touch and the splitter has not
     managed to part them, what arrives here is half again as wide as a digit cell
     -- and read as a single digit it comes back as something confident and wrong,
     which is the one outcome worth paying to avoid. Refusing it costs a frame. */
  if (frameW && e.w > frameW * 1.25) return null;

  /* A DIGIT IS READ IN A FULL-WIDTH FRAME. A 1, a 3 and a 7 have no left-hand
     segments, so their ink is narrower than the digit cell and sits at its right
     edge; sampling the seven regions over the ink alone puts the left regions on
     top of the bars and reads a 3 as an 8 or a 1. The frame is the width of a full
     digit, right-aligned on the ink when the ink is narrow. */
  const fw = Math.max(e.w, frameW || e.w);
  const uBase = e.w < fw * 0.85 ? e.u1 - fw : e.u0;

  const sample = (fx0, fy0, fx1, fy1) => {
    let n = 0, t = 0;
    const ua = uBase + fx0 * fw, ub = uBase + fx1 * fw;
    const va = e.v0 + fy0 * e.h, vb = e.v0 + fy1 * e.h;
    for (let u = ua; u < ub; u++) for (let v = va; v < vb; v++) {
      const x = Math.round(u * ca - v * sa), y = Math.round(u * sa + v * ca);
      t++; if (x >= 0 && x < W && y >= 0 && y < H) n += bits[y * W + x];
    }
    return t ? n / t : 0;
  };
  // a: top, b: upper right, c: lower right, d: bottom, e: lower left, f: upper left, g: middle
  const s = [sample(0.2, 0.0, 0.8, 0.16), sample(0.7, 0.12, 1.0, 0.45), sample(0.7, 0.55, 1.0, 0.88),
             sample(0.2, 0.84, 0.8, 1.0), sample(0.0, 0.55, 0.3, 0.88), sample(0.0, 0.12, 0.3, 0.45), sample(0.2, 0.42, 0.8, 0.58)];

  /* THE CUT IS RELATIVE TO THE DIGIT'S OWN BRIGHTEST SEGMENT, not a fixed 0.38.

     A fixed cut assumes a segment that is on fills its sample region. Three real
     boards break that assumption at once: a dot-matrix board lights maybe a third
     of the region because the rest is the gaps between lamps; an LED board caught
     mid-PWM-cycle by a short phone exposure comes out half dark; and a blurred or
     distant board smears every segment below the line. All three used to read as
     "no segments lit" and the frame was thrown away.

     Asking instead which segments are bright RELATIVE TO THE BRIGHTEST ONE IN
     THIS DIGIT is scale-free: it does not care how well lit the board is, only
     which of the seven are doing something. The absolute floor stays, because a
     blank cell has no brightest segment worth the name and must stay unread. */
  const smax = Math.max.apply(null, s);
  if (smax < 0.22) return null;
  const cut = Math.max(0.20, 0.45 * smax);

  /* AND A SEGMENT TOO CLOSE TO CALL MAKES THE WHOLE DIGIT UNREADABLE.

     Knowing where the line is does not help if a segment is sitting on it. That
     happens on a badly flickering board, where a lamp caught half-way through its
     cycle lands between "lit" and "not", and whichever side it falls is a coin
     toss -- a 9 that comes back as a 2. The digit is not hard to read, it is
     genuinely ambiguous, and a reader that answers anyway is the one that puts a
     clock nobody recognises on the stream.

     So every segment has to be clearly one thing or the other, measured against
     this digit's own spread between its brightest and dimmest. When one is not,
     the frame is dropped and the next one is along in an eighth of a second. */
  const smin = Math.min.apply(null, s);
  /* On a dot-matrix board a lit segment is mostly the gaps between its lamps, so
     every reading sits closer to the line and demanding a clear margin refuses the
     board outright. There the physics upstream is the guard instead. */
  const margin = dotty ? 0 : 0.06 * Math.max(0.3, smax - smin);
  if (margin) for (let i = 0; i < s.length; i++) if (Math.abs(s[i] - cut) < margin) return null;

  const key = s.map(v => v > cut ? '1' : '0').join('');
  if (SEG[key] != null) return SEG[key];
  /* a bare stroke is a one -- but only a stroke that is narrow FOR THIS BOARD and
     has both right-hand segments lit. The old test compared the glyph's width to
     its own height, which calls anything tall and thin a one, including a digit
     the resampler has squeezed. That turned unreadable frames into confident 1s. */
  if (e.w < fw * 0.42 && s[1] > cut && s[2] > cut) return 1;
  return null;
}

function frameWidth(gs) {
  /* a digit cell is about half as wide as it is tall; a line of ones alone must not shrink it */
  const ws = gs.map(g => g.w).sort((a, b) => a - b), hs = gs.map(g => g.h).sort((a, b) => a - b);
  if (!ws.length) return 0;
  return Math.max(ws[Math.floor(ws.length / 2)], Math.round(0.5 * hs[Math.floor(hs.length / 2)]));
}

/* One reading of a row of digits, given where the separator is and which one it
   is. Returns null for anything a basketball clock cannot be -- which is most of
   the arrangements a misread produces, and is the cheapest filter there is. */
function interpret(ds, at, kind) {
  if (at <= 0 || at >= ds.length) return null;
  if (kind === 'colon') {
    if (ds.length - at !== 2) return null;
    const m = +ds.slice(0, at).join(''), s = +ds.slice(at).join('');
    if (s > 59 || m > 20) return null;                 // no period runs longer than 20:00
    return (m * 60 + s) * 1000;
  }
  if (ds.length - at !== 1) return null;               // the tenth is one digit
  const s = +ds.slice(0, at).join(''), t = ds[at];
  if (s > 59) return null;
  return s * 1000 + t * 100;                           // only ever under a minute
}

/* The clock, read from a crop.
   hintMs, when given, is the clock the caller last accepted. It is used only to
   choose between readings that are equally valid as pictures -- see below. */
function readClock(b, hintMs) {
  const all = glyphs(b);
  if (!all.length) return null;

  /* A DIGIT IS TALL RELATIVE TO THE OTHER GLYPHS, NOT TO THE CROP.

     These thresholds used to be fractions of the crop's height: a digit was
     anything over half of it. That silently required the person to have boxed the
     board tightly. Box it loosely -- and on a phone, at arm's length, everybody
     does -- and the digits fall under half the crop, the colon falls under the
     separator threshold entirely, and a 9:59 arrives as three unseparated digits
     and is read as 95.9 seconds. Measuring against the tallest glyph instead makes
     the whole reader indifferent to how much air is round the board. */
  let maxH = 0; for (const g of all) if (g.h > maxH) maxH = g.h;
  if (maxH < b.H * 0.22) return null;

  const digitGs = [], seps = [];
  for (const g of all) {
    if (g.h >= maxH * 0.62) digitGs.push(g);
    else if (g.h >= maxH * 0.06 && g.w <= maxH * 0.45) seps.push(g);
  }
  if (!digitGs.length || digitGs.length > 4) return null;

  const skew = skewOf(digitGs);
  const rA = Math.atan(skew), rC = Math.cos(rA), rS = Math.sin(rA);
  const exts = digitGs.map(g => glyphExtent(b, g, rC, rS));
  if (exts.some(e => !e)) return null;
  const fw = frameWidthU(exts);
  const ds = digitGs.map((g, i) => segDigit(b, g, fw, skew, exts[i], all.dotty));
  if (ds.some(d => d == null)) return null;

  const top = Math.min.apply(null, digitGs.map(g => g.y0));
  const bot = Math.max.apply(null, digitGs.map(g => g.y1));
  const band = Math.max(1, bot - top);
  const idxOf = s => { const c = (s.x0 + s.x1) / 2; let n = 0; for (const g of digitGs) if ((g.x0 + g.x1) / 2 < c) n++; return n; };

  /* A COLON AND A DECIMAL POINT ARE TOLD APART BY WHERE THEY SIT, NOT BY SIZE.
     A colon is two lamps straddling the middle of the digit band; a decimal point
     is one lamp on the baseline. The old test compared their heights to the crop,
     which on a board whose colon is small read the colon as a decimal point and
     turned 9:59 into 95.9 seconds just as surely. */
  let at = -1, kind = null;
  for (const s of seps) {
    const mid = ((s.y0 + s.y1) / 2 - top) / band;
    const k = mid < 0.72 ? 'colon' : 'dot';
    const i = idxOf(s);
    if (i > 0 && i < digitGs.length) { at = i; kind = k; }
  }

  const cands = [];
  if (kind) {
    const v = interpret(ds, at, kind);
    if (v != null) cands.push(v);
  } else {
    /* NO SEPARATOR IN THE PICTURE. On most boards the colon BLINKS, so something
       like half of all frames look like this, and guessing is how 5:00 becomes
       50.0 seconds on air. But the colon still occupies a slot on the board even
       when it is dark, so the gap it leaves is far wider than the gap between two
       digits -- and that is a reading of the picture rather than a guess. */
    const gaps = [];
    for (let i = 1; i < digitGs.length; i++) gaps.push({ i, g: digitGs[i].x0 - digitGs[i - 1].x1 });
    const sorted = gaps.map(x => x.g).slice().sort((p, q) => p - q);
    const med = sorted.length ? sorted[sorted.length >> 1] : 0;
    const wide = gaps.filter(x => med > 0 && x.g > med * 1.55).sort((p, q) => q.g - p.g);
    if (wide.length === 1) {
      const i = wide[0].i;
      const k = ds.length === 4 ? 'colon' : (i === 1 ? 'colon' : 'dot');
      const v = interpret(ds, i, k);
      if (v != null) cands.push(v);
    } else {
      /* nothing in the picture says where the separator is, so every arrangement
         the digits could stand for is offered and the caller's clock decides */
      for (let i = 1; i < ds.length; i++) for (const k of ['colon', 'dot']) {
        const v = interpret(ds, i, k);
        if (v != null && !cands.includes(v)) cands.push(v);
      }
      /* four digits with nothing between them are MM:SS on every board ever made */
      if (ds.length === 4) { const v = interpret(ds, 2, 'colon'); if (v != null) return v; }
    }
  }

  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  /* TWO HONEST READINGS OF THE SAME PICTURE. "500" is five minutes or fifty
     seconds and the pixels do not say which. The clock we last accepted does:
     one of them is a step away and the other is nine minutes away. With no clock
     yet to compare against, the frame is dropped -- a dropped frame costs a
     quarter of a second, a wrong one costs the broadcast. */
  if (hintMs == null) return null;
  let best = null, bestD = Infinity;
  for (const v of cands) { const d = Math.abs(v - hintMs); if (d < bestD) { bestD = d; best = v; } }
  return bestD <= 90000 ? best : null;
}

function readScore(b) {
  const all = glyphs(b);
  if (!all.length) return null;
  /* the same scale-free rule as the clock: tallest glyph sets what a digit is, so
     a loosely drawn box round the score reads exactly like a tight one */
  let maxH = 0; for (const g of all) if (g.h > maxH) maxH = g.h;
  if (maxH < b.H * 0.22) return null;
  const gs = all.filter(g => g.h >= maxH * 0.62);
  if (!gs.length || gs.length > 3) return null;
  const sk = skewOf(gs);
  const sA = Math.atan(sk), sC = Math.cos(sA), sS = Math.sin(sA);
  const exts = gs.map(g => glyphExtent(b, g, sC, sS));
  if (exts.some(e => !e)) return null;
  const fw = frameWidthU(exts);
  const ds = gs.map((g, i) => segDigit(b, g, fw, sk, exts[i], all.dotty));
  if (ds.some(d => d == null)) return null;
  const v = +ds.join('');
  return v > 199 ? null : v;                 // nobody scores 200 in a half
}

return { binarise, stack, glyphs, segDigit, frameWidth, frameWidthU, glyphExtent, skewOf, interpret, readClock, readScore, SEG };
}));
