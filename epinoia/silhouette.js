'use strict';
/* ============================================================================
   SILHOUETTE — the picture of a player the site has no photograph of yet.

   A player from the shoulders up, in pixels, on a small screen: head, hair, neck, shoulders and
   the neckline and armholes of a vest. The screen is the site's own (dark or light, as the page
   is), with scanlines and a glow in the club's colour behind the head; the vest's trim, the frame
   and a headband are the club's colours. The figure is light on the dark screen and dark on the
   light one, modelled in a few tones of its own colour by one light high on the left: its left
   edge, the tops of the shoulders and the left deltoid lit; the right of the face, the neck under
   the jaw, the forehead under the hairline and the right arm in shadow; an edge of the club's
   colour behind it on the shadow side; the vest shaded down one side and creased under the arms.
   Nothing in it is a face: no eyes, no mouth, nothing that says who the person is.

   A MEN'S OR A WOMEN'S FIGURE, BY THE LEAGUE (Louie, 2026-10-15: "men/women specific based on
   women/men leagues"). opts.gender 'women' draws the women's figure, anything else the men's; the
   caller takes it from the league the player plays in (genderOf(league): the league's own gender,
   else the side its tier is filed under, else a women's league's name), never from the player's
   name or anything else about the player. The men's: a close crop, a buzz, a high top or a shaved
   head, on the broader neck and shoulders; the women's: a ponytail, a bun, braids tied back or a
   puff, on a slightly narrower neck and shoulder line. Which one, and the rest of what varies,
   is chosen from the player's id alone, so the same player always gets the same one and a squad
   without photographs is not one picture copied: the hair, a headband in the club's colour or
   none, a round or a V neck, the head straight or turned a touch to either side. A turn moves the
   ears, the light on the face and the hair; the head stays centred over a straight neck.

   Every colour is checked before it is drawn: the figure clears 7:1 against its screen and every
   other tone of it (the shadow, the light, the hair and its sheen, the vest and its folds, the
   rim, the club's edge) 4.5:1, so its outline holds in either theme; the trim 3:1 against the
   skin's three tones and the vest's two (a navy club's trim is lifted on the dark-on-light figure,
   a yellow club's darkened on the light one), the frame 3:1 against the screen. The maths is teamcolour.js's
   (WCAG relative luminance), repeated here so the module stands alone.

     EpinoiaSilhouette.variant(seed, gender)  -> { gender, hair, band: 0-1, neck: 0-1, turn: -1, 0, 1 }
     EpinoiaSilhouette.genderOf(league)       -> 'men' | 'women'  (a league row, or its slug)
     EpinoiaSilhouette.palette(opts)          -> { screen, glow, scan, figure, shade, light, hair, sheen, vest, fold, edge, rim, trim, frame, theme }
     EpinoiaSilhouette.grid(opts)             -> { cols, rows, cells, variant }  0 screen, 1 figure, 2 trim, 3 headband, 4 rim,
                                                 5 vest, 6 shadow, 7 light, 8 the vest's fold, 9 hair, 10 sheen, 11 the club's edge
     EpinoiaSilhouette.svg(opts)              -> '<svg role="img" ...>'  string; crisp rects, no network
     EpinoiaSilhouette.draw(ctx, x, y, w, h, opts)   the same picture on a canvas
     EpinoiaSilhouette.mount(host, opts)      puts the svg in host and redraws it when the theme flips
     EpinoiaSilhouette.label(name)            -> 'Ben Baker — no photograph yet'

   opts: { seed (the player's id), gender ('women' for a women's league; the men's figure
   otherwise), teamColour (the club's first colour: the glow, the bezel, the vest, its trim, the
   edge and the headband all come from it), theme 'dark' | 'light' | 'auto' (the page's
   data-theme), shape 'portrait' (4:5, the profile) | 'square' (a disc), res (columns: 32 by
   default), frame (default: true on a portrait), label, scan (default true) }

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
const round = c => c.map(Math.round);
/* move c away from `from`, a step at a time, until it clears `ratio` against it */
function clear(c, from, ratio) {
  const away = lum(from) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 40 && contrastRgb(round(c), from) < ratio; i++) c = mix(c, away, 0.08);
  return round(c);
}
/* ...against every colour it touches (they all lie on one side of it, so each step only helps the others) */
function clearAll(c, froms, ratio) {
  for (let k = 0; k < 4; k++) froms.forEach(f => { c = clear(c, f, ratio); });
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

/* The figure's tones. On the dark screen the light falls towards white and the shadow towards
   the screen; on the light screen the other way about. The tone that falls towards the screen is
   held at 4.5:1 against it, so the outline never melts, wherever a shadow or a highlight meets it. */
function palette(o) {
  o = o || {};
  const theme = themeOf(o.theme);
  const light = theme === 'light';
  const A = parse(o.teamColour) || parse(MINT);
  const ground = parse(light ? LIGHT_GROUND : DARK_GROUND);
  const W = [255, 255, 255], K = [0, 0, 0];
  /* the screen: the page's ground with a breath of the club in it */
  const screen = round(mix(ground, A, light ? 0.07 : 0.09));
  /* the figure: a phosphor grey on the dark screen, a dark slate on the light; 7:1 at least */
  const figure = clear(light ? [52, 63, 58] : [186, 203, 195], screen, 7);
  const fig = figure;
  /* its shadow, its light, and the hair (the darkest of them, in either theme) */
  let shade, lit, hair, sheen;
  if (light) {
    lit = clear(mix(fig, W, 0.3), screen, 4.6);
    shade = clear(mix(fig, K, 0.36), screen, 4.5);
    hair = clear(mix(fig, K, 0.76), screen, 4.5);
    sheen = clear(mix(hair, fig, 0.6), screen, 4.5);
  } else {
    lit = clear(mix(fig, W, 0.5), screen, 4.5);
    shade = clear(mix(fig, K, 0.2), screen, 4.8);
    hair = clear(mix(fig, K, 0.5), screen, 4.5);
    sheen = clear(mix(hair, fig, 0.45), screen, 4.5);
  }
  /* the vest: the figure with the club's colour through it, still a silhouette against the screen;
     its folds a step further from the screen (lighter on the dark one, darker on the light) */
  const vest = clear(mix(fig, A, light ? 0.3 : 0.32), screen, 4.5);
  let fold = clear(light ? mix(vest, K, 0.38) : mix(vest, W, 0.3), screen, 4.5);
  /* a vest already at the end of the scale (white on the dark screen, black on the light) creases the other way */
  if (contrastRgb(fold, vest) < 1.2) fold = clear(light ? mix(vest, W, 0.22) : mix(vest, K, 0.22), screen, 4.5);
  /* the rim, where the screen's light catches the figure's top edge */
  const rim = clear(light ? mix(fig, A, 0.45) : mix(fig, W, 0.62), screen, 4.5);
  /* the club's colour behind the figure, catching its shadow-side edge */
  const edge = clear(light ? mix(fig, A, 0.62) : mix(lit, A, 0.55), screen, 4.5);
  /* the trim sits on the figure: the club's colour, moved off the vest and the skin until it shows */
  const trim = clearAll(A.slice(), [vest, fold, figure, shade, lit], 3);
  /* the frame and the glow sit on the screen */
  const frame = clear(A.slice(), screen, 3);
  return {
    theme,
    screen: toHex(screen), figure: toHex(figure), shade: toHex(shade), light: toHex(lit), hair: toHex(hair), sheen: toHex(sheen),
    vest: toHex(vest), fold: toHex(fold), rim: toHex(rim), edge: toHex(edge), trim: toHex(trim),
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
const genderKey = g => (String(g == null ? '' : g).trim().toLowerCase() === 'women' ? 'women' : 'men');
const HAIR = { men: ['crop', 'buzz', 'hightop', 'shaved'], women: ['ponytail', 'bun', 'braids', 'puff'] };
/* The league chooses the figure, men's or women's; the id chooses the rest: the hair (of that figure's
   own), a headband or none, a round or a V neck, the head straight or turned a touch. */
function variant(seed, gender) {
  const h = hash(seed), g = genderKey(gender);
  const k = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return { gender: g, hair: HAIR[g][(k >>> 11) % HAIR[g].length], band: h & 1, neck: (h >>> 7) & 1, turn: ((h >>> 13) % 3) - 1 };
}
/* WOMEN'S OR MEN'S, from the league alone: its own gender (0131), else the side its tier is filed under
   (config.js EPINOIA_LEAGUE_TIERS), else its name. A league that says neither is a men's league. */
const WOMEN_LEAGUE = /\b(women|womens|women's|women’s|ladies|female|femenina|femminile|feminin|femra|femmes|kobiet|naisten|kvinde|dam|damen|zbl|wnbl|weabl|w league)\b/i;
function genderOf(league) {
  const l = typeof league === 'string' ? { slug: league } : (league || {});
  const g = String(l.gender || '').toLowerCase();
  if (g === 'women' || g === 'men') return g;
  const t = (root.EPINOIA_LEAGUE_TIERS || {})[l.slug];
  if (t && t[1] === 'w') return 'women';
  if (t && t[1] === 'm') return 'men';
  const text = String(l.name || '') + ' ' + String(l.slug || '').replace(/-/g, ' ');
  return text.trim() && WOMEN_LEAGUE.test(text) ? 'women' : 'men';
}

/* ---------------------------------------------------------------- the shape --- */
/* Drawn on a 32 x 40 design, the figure's centre line at x 16. Each test answers for one point. Two
   builds, the women's head, neck and shoulders a little narrower than the men's. The head is a profile
   of half-widths down from the crown, the same either side of the centre line whichever way it is
   turned: the jaw wider than the neck and the chin square across it, so the neck sits under the head,
   in its shadow, and never beside it. */
const CX = 16;
const BUILD = {
  men: {
    head: [[7.2, 0], [7.5, 2.6], [8.5, 4.6], [9.5, 5.1], [10.5, 5.65], [11.5, 5.85], [16.5, 5.85], [17.5, 5.4], [18.5, 5.05],
           [19.5, 4.6], [20.5, 3.8], [21.5, 2.8], [22, 0]],
    hy: 14.4, ry: 7.2, neck: 3.55, neckTop: 19.4, trapY: 22.4, shY: 27.4, shX: 10.9, delY: 31.6, wide: 14.25,
    earX: 5.85, earR: 1.15, earY: 15.2, ring: 4.6, hairline: 10.3
  },
  women: {
    head: [[7.6, 0], [7.9, 2.1], [8.5, 3.8], [9.5, 4.8], [10.5, 5.5], [11.5, 5.65], [16.5, 5.6], [17.5, 5.1], [18.5, 4.6],
           [19.5, 3.75], [20.5, 2.75], [21.5, 1.6], [21.9, 0]],
    hy: 14.6, ry: 7.0, neck: 2.95, neckTop: 19.6, trapY: 22.8, shY: 27.8, shX: 10.1, delY: 31.8, wide: 13.3,
    earX: 5.5, earR: 1.05, earY: 15.3, ring: 4.3, hairline: 10.0
  }
};
/* the head's half-width at height y, -1 above the crown and below the chin */
function headHalf(y, B) {
  const P = B.head;
  if (y <= P[0][0] || y >= P[P.length - 1][0]) return -1;
  for (let i = 1; i < P.length; i++) {
    if (y <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]); }
  }
  return -1;
}
function skullIn(x, y, B) { return Math.abs(x - CX) <= headHalf(y, B); }
/* the ears: a turn takes the one on the side the face turns towards back behind the cheek */
function earIn(x, y, v, B) {
  const dx = x - CX, side = dx < 0 ? -1 : 1;
  const far = v.turn !== 0 && side === v.turn;
  const ex = far ? B.earX - 0.5 : B.earX + (v.turn ? 0.15 : 0), er = far ? 0.75 : B.earR;
  return Math.pow((Math.abs(dx) - ex) / er, 2) + Math.pow((y - B.earY) / 1.75, 2) <= 1;
}
/* the half-width of neck, shoulders and chest at height y: a straight neck, the trapezius sloping from
   it, the round of the deltoid, the arm */
function bodyHalf(y, B) {
  if (y < B.neckTop) return 0;
  if (y < B.trapY) return B.neck;
  if (y < B.shY) return B.neck + (B.shX - B.neck) * Math.pow((y - B.trapY) / (B.shY - B.trapY), 1.55);
  if (y < B.delY) return B.shX + (B.wide - B.shX) * Math.sqrt(Math.max(0, 1 - Math.pow((B.delY - y) / (B.delY - B.shY), 2)));
  return B.wide + (y - B.delY) * 0.06;
}
function bodyIn(x, y, B) { return Math.abs(x - CX) <= bodyHalf(y, B); }
/* the top of the body above a column |dx| out from the centre (bodyHalf turned round) */
function bodyTop(adx, B) {
  if (adx <= B.neck) return B.neckTop;
  let lo = B.trapY, hi = 40;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (bodyHalf(m, B) >= adx) hi = m; else lo = m; }
  return hi;
}
/* where the armhole runs at height y: down from the strap on the shoulder, round under the deltoid */
function armX(y, B) {
  const k = B.wide / 14.25;
  const ax = 8.4 + 1.4 * Math.sqrt(Math.max(0, (y - 26.2) / 8.4));
  return k * (y > 30.6 ? ax - Math.pow((y - 30.6) / 4, 2) * 2.2 : ax);
}
function armholeX(y, B) { return y < 34.6 ? armX(y, B) : armX(34.6, B) + (y - 34.6) * 0.3; }
/* the neck opening: inside it is skin, not vest */
function neckOpen(x, y, v, B) {
  if (v.neck === 0) return Math.hypot(x - CX, y - 23.4) < B.ring;
  return Math.abs(x - CX) < 3.6 - (y - 24.6) * 0.62;
}
/* the vest itself: the chest and back between the armholes, below the neckline */
function vestIn(x, y, v, B) {
  if (y < 24.6 || !bodyIn(x, y, B)) return false;
  if (Math.abs(x - CX) > armholeX(y, B)) return false;
  return !neckOpen(x, y, v, B);
}
/* the vest's lines, `t` thick (a cell's width at least, so they survive a coarse grid) */
function trimIn(x, y, v, B, t) {
  const dx = Math.abs(x - CX);
  if (y < 24.6 || !bodyIn(x, y, B)) return false;
  if (v.neck === 0) {
    const r = Math.hypot(x - CX, y - 23.4);
    if (r >= B.ring - t * 0.5 && r <= B.ring + t * 0.5) return true;
  } else {
    const edge = 3.6 - (y - 24.6) * 0.62;                // a V down to the chest
    if (edge > -0.4 && Math.abs(dx - Math.max(0, edge)) <= t * 0.55 && y <= 30.6) return true;
  }
  if (y >= 26.2 && y < 34.6 && Math.abs(dx - armX(y, B)) <= t * 0.55) return true;
  return false;
}
/* the crease a vest takes under each arm: a short fold in from the armpit, down towards the middle */
function creaseIn(x, y, B) {
  if (y < 30.4 || y > 34.2) return false;
  return Math.abs(Math.abs(x - CX) - (armX(30.4, B) - 1.1 - (y - 30.4) * 0.85)) <= 0.7;
}

/* ---------------------------------------------------------------- the hair --- */
/* the hairline: the hair covers the head above it. Its height at |dx| from the centre line: a man's
   straight across the brow, cut back a touch at the temples and down to a short sideburn; a woman's,
   pulled back, in one soft curve from the brow down to the top of the ear. */
function hairline(adx, B, style) {
  const top = B.hairline + (style === 'buzz' ? -0.3 : 0);
  if (style === 'crop' || style === 'buzz' || style === 'hightop') {
    if (adx < 2.6) return top;
    if (adx < 4.0) return top - (adx - 2.6) * 0.36;
    return top - 0.5 + Math.min(3.3, (adx - 4.0) * 3);
  }
  return top + Math.pow(adx / 5.6, 3) * 3.8;
}
/* the light on hair: a sheen where it turns to the upper left */
function sheenAt(dx, dy, rx, ry) {
  const nx = Math.max(-0.98, Math.min(0.98, dx / rx)), ny = Math.max(-0.98, Math.min(0.98, dy / ry));
  return lightOf(nx, ny) > 0.93;
}
/* 0 none, 9 hair, 10 its sheen: what the hair is at (x, y) in front of the head (`front`), and what
   shows of it behind the head and the shoulders (`back`) */
function hairAt(x, y, v, B, inHead) {
  const style = v.hair, dx = x - CX, adx = Math.abs(dx);
  const out = { front: 0, back: 0 };
  if (style === 'shaved') return out;
  const crown = B.head[0][0];
  let cap = inHead && y < hairline(adx, B, style) ? 'cap' : '';
  if (!cap) {
    if (style === 'crop') {
      /* a little fuller than the head: the crown rounded up most of a pixel */
      const w = headHalf(y + 0.8, B) * 0.92;
      if (y < crown + 1.5 && w >= 1.6 && adx <= w) cap = 'lift';
    } else if (style === 'hightop') {
      /* a flat top standing above the crown, its corners rounded */
      const top = crown - 1.3;
      if (y >= top && y < B.hy - 3.5 && adx <= 5.05 - (y < top + 0.9 ? 1.0 : 0)) cap = 'top';
    } else if (style === 'bun') {
      if (Math.hypot(dx, y - (crown - 0.5)) <= 2.6) cap = 'bun';
    } else if (style === 'puff') {
      /* a round puff of curls on the crown, wider than a bun, its edge in small scallops */
      const r = Math.hypot(dx / 1.3, y - (crown + 0.6)), a = Math.atan2(y - (crown + 0.6), dx / 1.3);
      if (y < B.hy - 3 && r <= 3.25 + 0.3 * Math.cos(a * 9)) cap = 'puff';
    }
  }
  if (cap) {
    out.front = 9;
    const tv = v.turn * 0.6;
    if (style === 'buzz') { /* too short to shine */ }
    else if (style === 'braids') {
      /* cornrows, front to back: every other one catches the light */
      if (y < hairline(adx, B, style) - 0.6 && (Math.round((dx + 0.5) / 1.6) & 1) === 0) out.front = 10;
    } else if (cap === 'bun') {
      if (sheenAt(dx + 0.3, y - (crown - 0.5), 2.6, 2.6)) out.front = 10;
    } else if (cap === 'top') {
      if (dx < -1.4 && dx > -3.6 && y < crown + 1.2) out.front = 10;
    } else if (sheenAt(dx - tv, y - (B.hy - 1.5), 6.6, B.ry + 0.6)) out.front = 10;
    return out;
  }
  /* behind: the tail falling to one side of the neck (the side the face turns from): a ponytail, or the
     braids gathered into one, plaited */
  if (style === 'ponytail' || style === 'braids') {
    const s = v.turn ? -v.turn : style === 'braids' ? -1 : 1;
    const y0 = B.hy - 1, y1 = B.trapY + 3.2;
    if (y >= y0 && y <= y1) {
      const f = (y - y0) / (y1 - y0);
      const cx = CX + s * (4.3 + f * 2.1 + Math.sin(f * Math.PI) * 0.6);
      const w = style === 'braids' ? 1.5 - f * 0.6 : 1.9 - f * 0.9;
      if (Math.abs(x - cx) <= w) {
        out.back = style === 'braids' ? ((Math.floor(y / 1.2) & 1) ? 10 : 9) : ((x - CX) * s < 4.3 + (y - B.hy) * 0.2 ? 10 : 9);
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the light --- */
/* one light, high on the left and in front: how much of it a surface turned (nx, ny) takes */
const LX = -0.52, LY = -0.5, LZ = 0.69;
function lightOf(nx, ny) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return nx * LX + ny * LY + nz * LZ;
}
const clamp1 = n => Math.max(-0.98, Math.min(0.98, n));
/* the head, rounded, lit a little more from the side than the rest: its shadow side, the face turned
   with the head; the lower face a plane, so the jaw stays lit over the neck */
function headTone(x, y, v, B) {
  const dx = x - CX - v.turn * 0.7, dy = y - B.hy;
  const nx = clamp1(dx / 6.1), ny = clamp1(dy < 0 ? dy / (B.ry + 0.4) : 0.15 * dy / B.ry);
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return -0.62 * nx - 0.3 * ny + 0.72 * nz < 0.32 ? 6 : 1;
}
/* the neck in the jaw's shadow, and turned from the light on its right */
function neckTone(x, y, B) {
  if (skullIn(x, y - 1.5, B)) return 6;
  return x - CX > B.neck * 0.3 ? 6 : 1;
}
/* shoulders and arms: the tops face up into the light; the right side turns from it, the left's
   deltoid takes it; the arm darkens into the armpit */
function bodyTone(x, y, B) {
  const dx = x - CX, adx = Math.abs(dx), half = bodyHalf(y, B);
  if (y - bodyTop(adx, B) < 0.9) return 7;
  if (dx > 0 && y > B.shY - 0.5 && adx > half - 2.1) return 6;
  if (dx < 0 && y < B.delY + 0.4 && adx > half - 2.3) return 7;
  if (y > B.delY - 0.6 && adx < armholeX(y, B) + 1.4) return 6;
  return 1;
}

/* the design window each shape looks through */
function frameOf(shape) {
  return shape === 'square' ? { x0: 1, y0: 5, w: 30, h: 30 } : { x0: 0, y0: 0, w: 32, h: 40 };
}

const SKIN = [1, 6, 7];
function grid(o) {
  o = o || {};
  const ov = o.variant || null;
  const g0 = genderKey(ov && ov.gender ? ov.gender : o.gender);
  const v = Object.assign({ hair: HAIR[g0][0], band: 0, neck: 0, turn: 0 }, ov || variant(o.seed, g0), { gender: g0 });
  if (HAIR[g0].indexOf(v.hair) < 0) v.hair = HAIR[g0][0];
  const B = BUILD[g0];
  const win = frameOf(o.shape);
  const cols = Math.max(8, Math.min(64, Math.round(o.res || 32)));
  const rows = Math.round(cols * win.h / win.w);
  const step = win.w / cols;
  const t = Math.max(1, step * 1.05);
  const cells = new Uint8Array(cols * rows), face = new Uint8Array(cols * rows);
  const P = palette(o), theme = P.theme;
  /* the vest's second tone runs down its shadow side where it is the darker, its lit side where the lighter */
  const foldDark = contrast(P.fold, '#000000') < contrast(P.vest, '#000000');
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = win.x0 + (i + 0.5) * step, y = win.y0 + (j + 0.5) * step, dx = x - CX;
      const skull = skullIn(x, y, B), ear = !skull && earIn(x, y, v, B);
      const hair = hairAt(x, y, v, B, skull);
      let c = 0;
      if (hair.front) c = hair.front;
      else if (skull) { c = headTone(x, y, v, B); face[j * cols + i] = 1; }
      else if (ear) c = dx > 0 ? 6 : 1;
      else if (bodyIn(x, y, B)) {
        if (trimIn(x, y, v, B, t)) c = 2;
        else if (vestIn(x, y, v, B)) {
          const side = foldDark ? dx > 0 : dx < 0;
          c = (side && Math.abs(dx) > armholeX(y, B) - 1.7) || creaseIn(x, y, B) ? 8 : 5;
        } else if (Math.abs(dx) <= B.neck && y < 24.6 + 4) c = neckTone(x, y, B);
        else c = bodyTone(x, y, B);
      } else if (hair.back) c = hair.back;
      if (c && c !== 2 && v.band === 1 && (skull || hair.front) && y >= B.hairline - 0.1 && y <= B.hairline - 0.1 + Math.max(1.5, t)) c = 3;
      cells[j * cols + i] = c;
    }
  }
  /* a lone pixel of a tone is noise, not modelling: back to the tone around it */
  const base = { 6: 1, 7: 1, 8: 5 };
  if (cols >= 20) {
    const keep = cells.slice();
    const k = (a, b) => (a < 0 || b < 0 || a >= cols || b >= rows ? 0 : keep[b * cols + a]);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const c = keep[j * cols + i];
        if (base[c] && k(i - 1, j) !== c && k(i + 1, j) !== c && k(i, j - 1) !== c && k(i, j + 1) !== c) cells[j * cols + i] = base[c];
      }
    }
  }
  const snap = cells.slice();
  const was = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : snap[j * cols + i]);
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i, c = snap[n];
      /* the hair sits on the head: a pixel of its shadow along the hairline */
      if (face[n] && (c === 1 || c === 6) && (was(i, j - 1) === 9 || was(i, j - 1) === 10)) cells[n] = 6;
      /* the light's own edge: the outline of the lit side, one pixel */
      else if (c === 1 && win.x0 + (i + 0.5) * step < CX && was(i - 1, j) === 0) cells[n] = 7;
    }
  }
  /* on the dark screen its light catches the top edge of the skin (the hair is matte): one pixel, lit;
     and on either screen the club's colour behind it catches the shadow side's edge */
  if (o.rim !== false) {
    const headTop = Math.round((B.hy - B.ry - win.y0) / step);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (SKIN.indexOf(snap[j * cols + i]) < 0) continue;
        const x = win.x0 + (i + 0.5) * step, rightEdge = x > CX && was(i + 1, j) === 0;
        if (theme === 'dark' && j > 0 && was(i, j - 1) === 0 && !rightEdge) cells[j * cols + i] = 4;
        else if (rightEdge && j > headTop + 1) cells[j * cols + i] = 11;
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
/* cell class -> [svg class, palette key] */
const LAYERS = [null, ['sil-fig', 'figure'], ['sil-trim', 'trim'], ['sil-band', 'trim'], ['sil-rim', 'rim'], ['sil-vest', 'vest'],
  ['sil-shade', 'shade'], ['sil-light', 'light'], ['sil-fold', 'fold'], ['sil-hair', 'hair'], ['sil-sheen', 'sheen'], ['sil-edge', 'edge']];
const ORDER = [1, 6, 7, 9, 10, 5, 8, 4, 11, 2, 3];

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
  const v = g.variant;
  let s = '<svg class="sil' + (portrait ? ' sil-portrait' : ' sil-square') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' +
    ' preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" role="img" aria-label="' + esc(lab) + '"' +
    ' data-sil-figure="' + v.gender + '" data-sil-hair="' + v.hair + '"' +
    ' data-sil-band="' + v.band + '" data-sil-neck="' + v.neck + '" data-sil-turn="' + v.turn + '" data-sil-theme="' + p.theme + '">';
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
  ORDER.forEach(c => {
    const d = runs(g, c);
    if (d) s += '<path class="' + LAYERS[c][0] + '" fill="' + p[LAYERS[c][1]] + '" d="' + d + '"/>';
  });
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
  const fills = LAYERS.map(l => (l ? p[l[1]] : null));
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

return { variant, genderOf, palette, grid, svg, draw, mount, label, hash, contrast, HAIR };
}));
