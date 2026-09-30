'use strict';
/* ============================================================================
   THE REPORT AS A PAGE — the weekly report drawn as one sheet, to save as an image or a PDF.

   The weekly tab (weekly.js) is a reading on a screen. A coach takes the week somewhere else: into
   the Monday meeting, a team chat, a printed pack for the staff, a post. So the same numbers are
   drawn here as a designed page, from the report weekly.js has already built (cardModel), never
   from a second reading of the database: the sheet and the tab cannot disagree.

     draw(ctx, model, opts)   the page onto any 2D context (pure layout; the tests drive it)
     canvas(model, opts)      a canvas at opts.scale (default 2) with the page on it
     png(model, opts)         -> Blob image/png
     pdf(model, opts)         -> Blob application/pdf: one A4 page, the sheet on it (print colours)
     save(model, kind)        png or pdf, downloaded under a name that says whose week it is

   FORMATS. a4 (1240 x 1754, the PDF's page at 150 dpi, drawn at twice that) and post (1080 x 1350,
   Instagram's portrait) share one layout that flows down the page: the heading, the week in numbers,
   what to keep and what to work on, every measure against the league, the report's own words where
   there is room, and the footer. The measures take the height that is left, so a longer list (a
   team's sixteen) and a shorter one (a player's twelve) both fill the page.

   THE PDF IS WRITTEN HERE (pdfFromJpeg), not by a library: a page, an image on it and the document's
   title, which is all a one-page sheet needs, in some sixty lines whose every byte offset is checked
   by supabase/tests/reportcard.test.mjs.

   A CREST IS DRAWN ONLY IF IT CAN BE READ BACK. An image from another origin without CORS taints the
   canvas and the save throws; it is asked for with crossOrigin and, if that fails, the club's
   initials are drawn in its colour instead, as the profile's badge does.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportCard = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const FORMATS = {
  a4:   { w: 1240, h: 1754 },
  post: { w: 1080, h: 1350 }
};

/* the kit's two colourways (kit/epinoia-kit.css section 2): the screen's, and paper's */
const THEMES = {
  dark: {
    ground: '#04100b', panel: '#0a1a13', panel2: '#102419', ink: '#e6fff1', ink2: 'rgba(230,255,241,.86)',
    ink3: 'rgba(230,255,241,.62)', rule: 'rgba(147,242,191,.20)', rule2: 'rgba(147,242,191,.44)',
    lume: '#93f2bf', good: '#63ffa0', bad: '#ff5f6b', mid: '#ffd166', style: 'rgba(230,255,241,.42)',
    track: 'rgba(147,242,191,.10)', fringe: true
  },
  light: {
    ground: '#ffffff', panel: '#f3faf6', panel2: '#e9f4ee', ink: '#0d1f17', ink2: 'rgba(13,31,23,.9)',
    ink3: 'rgba(13,31,23,.66)', rule: 'rgba(13,31,23,.16)', rule2: 'rgba(13,31,23,.36)',
    lume: '#08603f', good: '#0a6d43', bad: '#b32433', mid: '#8a5a00', style: 'rgba(13,31,23,.38)',
    track: 'rgba(13,31,23,.07)', fringe: false
  }
};

const F = {
  score: "'Jersey25', ui-monospace, monospace",
  micro: "'Silkscreen', ui-monospace, monospace",
  ui: "'Archivo', system-ui, sans-serif",
  data: "'MartianMono', ui-monospace, monospace",
  mark: "'EpinoiaMark', 'Archivo', system-ui, sans-serif"
};

/* --------------------------------------------------------------- helpers --- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HEX = /^#([0-9a-f]{6})$/i;
function rgb(hex) {
  const m = HEX.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function rgba(hex, a) {
  const c = rgb(hex);
  return c ? 'rgba(' + c.join(',') + ',' + a + ')' : 'rgba(147,242,191,' + a + ')';
}
/* relative luminance, for the ink on a club-coloured disc */
function lum(hex) {
  const c = rgb(hex);
  return c ? lumOf(c) : 0.5;
}
/* the club's colour, readable on this ground: a pale kit on paper, or a dark one on the screen's green-black, is
   mixed towards the ink a step at a time until it reads at 4.5:1 against the page (WCAG's line for small text:
   the kicker and the edge are drawn in it) */
function accentOn(hex, th) {
  const c = rgb(hex) || rgb(th.lume);
  const ground = rgb(th.ground), ink = rgb(th.ink);
  for (let t = 0; t <= 0.9; t += 0.05) {
    const x = c.map((v, i) => Math.round(v + (ink[i] - v) * t));
    if (contrast(x, ground) >= 4.5) return 'rgb(' + x.join(',') + ')';
  }
  return 'rgb(' + ink.join(',') + ')';
}
function lumOf(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a, b) {
  const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function initials(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function font(ctx, size, fam, weight) {
  ctx.font = (weight ? weight + ' ' : '') + Math.round(size) + 'px ' + fam;
}

/* the largest size up to `max` at which `text` fits `width` (never below `min`) */
function fit(ctx, text, width, max, min, fam, weight) {
  let s = max;
  font(ctx, s, fam, weight);
  const w = ctx.measureText(text).width;
  if (w > width) s = Math.max(min, Math.floor(max * width / w));
  font(ctx, s, fam, weight);
  return s;
}

/* THE NAME: one line as large as fits; a name too long for one line even at `min` goes onto two (a club called
   Associação Desportiva Recreativa e Cultural Icasa is not rare), and only a name too long for two is cut short */
function nameBlock(ctx, text, width, max, min, fam) {
  const face = fam || F.score;
  const one = fit(ctx, text, width, max, min, face);
  if (ctx.measureText(text).width <= width) return { size: one, lines: [text] };
  for (let s = Math.round(max * 0.7); s >= Math.round(min * 0.6); s -= 2) {
    font(ctx, s, face);
    const lines = wrap(ctx, text, width);
    if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= width && !/…$/.test(l))) return { size: s, lines };
  }
  const s = Math.round(min * 0.6);
  font(ctx, s, face);
  const lines = wrap(ctx, text, width);
  return { size: s, lines: lines.length <= 2 ? lines : [lines[0], ellipsis(ctx, lines.slice(1).join(' '), width)] };
}

/* words onto lines no wider than `width`; a word longer than the line is cut with an ellipsis */
function wrap(ctx, text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(w => {
    const next = line ? line + ' ' + w : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  });
  if (line) lines.push(line);
  return lines.map(l => (ctx.measureText(l).width > width ? ellipsis(ctx, l, width) : l));
}
function ellipsis(ctx, text, width) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= width) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/* a display line with the kit's lens fringe (card.css, sectitle.css): a red and a cyan copy either side */
function display(ctx, th, text, x, y, colour, fringe) {
  if (fringe && th.fringe) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(255,95,107,.9)'; ctx.fillText(text, x - fringe, y);
    ctx.fillStyle = 'rgba(143,245,255,.9)'; ctx.fillText(text, x + fringe, y);
    ctx.restore();
  }
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function band(p) {
  if (p == null) return 'none';
  return p >= 70 ? 'good' : p <= 30 ? 'bad' : 'mid';
}
function ordinal(n) {
  const v = Math.round(n), t = v % 100;
  if (t >= 11 && t <= 13) return v + 'th';
  return v + (['th', 'st', 'nd', 'rd'][v % 10] || 'th');
}

/* ------------------------------------------------------------------ page --- */
/* The model (weekly.js cardModel):
     kind 'team' | 'player', name, sub (league · club), range ('23–30 Sep 2026'), games, record,
     colour '#rrggbb', crest (a loaded image, or null), monogram,
     tiles [{ label, value }], rows [{ short, label, value, text, pct, style }],
     good / bad [{ label, pct }], prose [string], url, generated ('30 Sep 2026')                     */
function draw(ctx, model, opts) {
  const o = opts || {};
  const fmt = FORMATS[o.format] || FORMATS.a4;
  const th = THEMES[o.theme] || THEMES.dark;
  const W = fmt.w, H = fmt.h;
  const m = model || {};
  const M = Math.round(W * 0.06);
  const inner = W - 2 * M;
  const accent = accentOn(m.colour, th);
  const post = fmt === FORMATS.post;
  const k = W / 1240;                              // type scale: the a4 page is the reference
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /* the ground: the kit's green-black, a wash of the club's colour from the top right */
  ctx.fillStyle = th.ground;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.92, H * 0.02, 0, W * 0.92, H * 0.02, W * 0.9);
  glow.addColorStop(0, rgba(m.colour || '#93f2bf', th.fringe ? 0.20 : 0.10));
  glow.addColorStop(1, rgba(m.colour || '#93f2bf', 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  if (rgb(m.leagueColour)) {                            // the league's colour, rising from the opposite corner
    const lg = ctx.createRadialGradient(W * 0.05, H * 1.02, 0, W * 0.05, H * 1.02, W * 0.75);
    lg.addColorStop(0, rgba(m.leagueColour, th.fringe ? 0.14 : 0.07));
    lg.addColorStop(1, rgba(m.leagueColour, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, Math.round(10 * k), H);           // the club's edge, the length of the page
  if (rgb(m.colour2)) {                                 // and its second colour at the foot of it
    ctx.fillStyle = accentOn(m.colour2, th);
    ctx.fillRect(0, H * 0.7, Math.round(10 * k), H * 0.3);
  }

  let y = M;

  /* ---- the heading ---- */
  font(ctx, 19 * k, F.micro);
  ctx.fillStyle = accent;
  const kicker = 'WEEKLY REPORT · ' + (m.kind === 'player' ? 'PLAYER' : 'TEAM');
  ctx.fillText(kicker, M, y + 19 * k);
  ctx.textAlign = 'right';
  ctx.fillStyle = th.ink3;
  ctx.fillText(String(m.range || '').toUpperCase(), W - M, y + 19 * k);
  ctx.textAlign = 'left';
  y += 19 * k + 26 * k;

  const disc = Math.round((post ? 150 : 170) * k);
  const nameW = inner - disc - 30 * k;
  const nb = nameBlock(ctx, String(m.name || '').toUpperCase(), nameW, (post ? 128 : 138) * k, 54 * k);
  const nameTop = y;
  nb.lines.forEach((l, i) => display(ctx, th, l, M, y + nb.size * (0.8 + i * 0.92), th.ink, 1.6 * k));
  y += nb.size * (0.86 + (nb.lines.length - 1) * 0.92) + 16 * k;
  /* the league's logo before the sub-line that names it */
  let lx = M;
  if (m.leagueCrest && m.leagueCrest.width) {
    const lh = 34 * k, iw = m.leagueCrest.naturalWidth || m.leagueCrest.width, ih = m.leagueCrest.naturalHeight || m.leagueCrest.height;
    const s2 = Math.min(lh / ih, 110 * k / iw);
    ctx.drawImage(m.leagueCrest, M, y + 22 * k - 26 * k + (lh - ih * s2) / 2 - 2 * k, iw * s2, ih * s2);
    lx = M + iw * s2 + 12 * k;
  }
  font(ctx, 25 * k, F.ui, 500);
  ctx.fillStyle = th.ink2;
  ctx.fillText(ellipsis(ctx, m.sub || '', nameW - (lx - M)), lx, y + 22 * k);
  y += 22 * k + 12 * k;

  /* the crest in a disc of the club's colour, or the club's initials on it */
  const cx = W - M - disc / 2, cy = nameTop + disc / 2 - 6 * k;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, disc / 2, 0, Math.PI * 2);
  ctx.fillStyle = m.crest ? crestGround(m.crest, th) : (rgb(m.colour) ? m.colour : th.lume);
  ctx.fill();
  ctx.lineWidth = 3 * k; ctx.strokeStyle = accent; ctx.stroke();
  if (m.crest && m.crest.width) {
    const r = disc * 0.36, iw = m.crest.naturalWidth || m.crest.width, ih = m.crest.naturalHeight || m.crest.height;
    const s = Math.min(2 * r / iw, 2 * r / ih);
    ctx.drawImage(m.crest, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s);
  } else {
    font(ctx, disc * 0.42, F.score);
    ctx.textAlign = 'center';
    ctx.fillStyle = lum(rgb(m.colour) ? m.colour : '#93f2bf') > 0.4 ? '#04100b' : '#ffffff';
    ctx.fillText(m.monogram || initials(m.name), cx, cy + disc * 0.15);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  y = Math.max(y, nameTop + disc) + 22 * k;

  /* ---- the week in numbers ---- */
  const tiles = (m.tiles || []).slice(0, 6);
  if (tiles.length) {
    const th1 = 116 * k;
    ctx.fillStyle = th.panel;
    roundRect(ctx, M, y, inner, th1, 14 * k); ctx.fill();
    ctx.strokeStyle = th.rule; ctx.lineWidth = 1.5 * k; ctx.stroke();
    const tw = inner / tiles.length;
    tiles.forEach((t, i) => {
      const tx = M + i * tw;
      if (i) { ctx.fillStyle = th.rule; ctx.fillRect(tx, y + 18 * k, 1.5 * k, th1 - 36 * k); }
      ctx.textAlign = 'center';
      const vs = fit(ctx, String(t.value), tw - 20 * k, 62 * k, 30 * k, F.score);
      ctx.fillStyle = t.tone === 'good' ? th.good : t.tone === 'bad' ? th.bad : th.ink;
      ctx.fillText(String(t.value), tx + tw / 2, y + 22 * k + vs * 0.78);
      font(ctx, 15 * k, F.micro);
      ctx.fillStyle = th.ink3;
      ctx.fillText(String(t.label).toUpperCase(), tx + tw / 2, y + th1 - 20 * k);
      ctx.textAlign = 'left';
    });
    y += th1 + 30 * k;
  }

  /* ---- keep doing / work on ---- */
  const colW = (inner - 26 * k) / 2;
  const list = (items, title, colour, x, emptyLine) => {
    font(ctx, 17 * k, F.micro);
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(x + 7 * k, y + 11 * k, 6 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(title, x + 22 * k, y + 17 * k);
    let ly = y + 30 * k;
    if (!items.length) {
      font(ctx, 19 * k, F.ui, 400);
      ctx.fillStyle = th.ink3;
      wrap(ctx, emptyLine, colW).slice(0, 2).forEach((l, i) => ctx.fillText(l, x, ly + 26 * k + i * 26 * k));
      return;
    }
    items.slice(0, 3).forEach((r, i) => {
      const rowY = ly + i * 48 * k;
      ctx.fillStyle = th.panel;
      roundRect(ctx, x, rowY, colW, 40 * k, 8 * k); ctx.fill();
      ctx.fillStyle = colour;
      ctx.fillRect(x, rowY + 8 * k, 4 * k, 24 * k);
      font(ctx, 20 * k, F.ui, 600);
      ctx.fillStyle = th.ink;
      const pill = ordinal(r.pct);
      font(ctx, 16 * k, F.data, 600);
      const pw = ctx.measureText(pill).width + 18 * k;
      font(ctx, 20 * k, F.ui, 600);
      ctx.fillText(ellipsis(ctx, r.label, colW - pw - 34 * k), x + 16 * k, rowY + 27 * k);
      font(ctx, 16 * k, F.data, 600);
      ctx.fillStyle = colour;
      ctx.textAlign = 'right';
      ctx.fillText(pill, x + colW - 12 * k, rowY + 26 * k);
      ctx.textAlign = 'left';
    });
  };
  const listTop = y;
  list(m.good || [], 'KEEP DOING', th.good, M, 'Nothing well above the league this week.');
  list(m.bad || [], 'WORK ON', th.bad, M + colW + 26 * k, 'Nothing well below the league this week.');
  const listRows = Math.max(1, Math.min(3, Math.max((m.good || []).length, (m.bad || []).length)));
  y = listTop + 30 * k + listRows * 48 * k + 24 * k;

  /* ---- every measure against the league ---- */
  const footH = 74 * k;
  const rows = (m.rows || []).filter(r => r && (r.value != null));
  const prose = post ? [] : (m.prose || []).filter(Boolean).slice(0, 2);
  font(ctx, 20 * k, F.ui, 400);
  const proseLines = [];
  prose.forEach(p => wrap(ctx, p, inner).forEach(l => proseLines.push(l)));
  const proseH = proseLines.length ? Math.min(proseLines.length, 7) * 29 * k + 30 * k : 0;
  const barsTop = y;
  const midLabelH = 30 * k;                            // "LEAGUE MIDDLE", under the last bar
  const barsBottom = H - M - footH - proseH - midLabelH;
  font(ctx, 17 * k, F.micro);
  ctx.fillStyle = th.ink2;
  ctx.fillText('WHERE THE WEEK SAT', M, barsTop + 17 * k);
  ctx.textAlign = 'right';
  font(ctx, 14 * k, F.micro);
  ctx.fillStyle = th.ink3;
  ctx.fillText('PERCENTILE AGAINST THIS LEAGUE', W - M, barsTop + 16 * k);
  ctx.textAlign = 'left';
  const rowsTop = barsTop + 34 * k;
  const rowH = rows.length ? clamp((barsBottom - rowsTop) / rows.length, 26 * k, 58 * k) : 0;
  /* a row tall enough for two lines says what the measure is as well as its name: "DRTG" / "their defence" */
  const twoLine = rowH >= 46 * k;
  const labW = (twoLine ? 290 : 160) * k, valW = 104 * k, pctW = 70 * k;
  const barX = M + labW + valW, barW = inner - labW - valW - pctW;
  if (rows.length) {                                    // the league's middle, a faint line through every bar
    const mx = barX + barW * 0.5;
    ctx.save();
    ctx.setLineDash([4 * k, 6 * k]);
    ctx.strokeStyle = th.rule2; ctx.lineWidth = 1.2 * k;
    ctx.beginPath(); ctx.moveTo(mx, rowsTop - 4 * k); ctx.lineTo(mx, rowsTop + rows.length * rowH); ctx.stroke();
    ctx.restore();
    font(ctx, 12 * k, F.micro);
    ctx.fillStyle = th.ink3;
    ctx.textAlign = 'center';
    ctx.fillText('LEAGUE MIDDLE', mx, rowsTop + rows.length * rowH + 16 * k);
    ctx.textAlign = 'left';
  }
  const bh = clamp(rowH * 0.38, 9 * k, 18 * k);
  rows.forEach((r, i) => {
    const ry = rowsTop + i * rowH, mid = ry + rowH / 2;
    const p = r.pct == null ? null : clamp(Math.round(r.pct), 0, 100);
    const b = r.style ? 'style' : band(p);
    const col = b === 'good' ? th.good : b === 'bad' ? th.bad : b === 'mid' ? th.mid : th.style;
    if (i % 2 === 0) { ctx.fillStyle = th.track; ctx.fillRect(M, ry, inner, rowH); }
    font(ctx, clamp(rowH * 0.4, 15 * k, 21 * k), F.ui, 700);
    ctx.fillStyle = r.style ? th.ink3 : th.ink;
    if (twoLine) {
      ctx.fillText(ellipsis(ctx, String(r.short || ''), labW - 16 * k), M + 14 * k, mid - 2 * k);
      font(ctx, 14.5 * k, F.ui, 400);
      ctx.fillStyle = th.ink3;
      ctx.fillText(ellipsis(ctx, String(r.label || '') + (r.style ? ' · a style' : ''), labW - 16 * k), M + 14 * k, mid + 17 * k);
    } else {
      ctx.fillText(ellipsis(ctx, String(r.short || ''), labW - 16 * k), M + 14 * k, mid + 7 * k);
    }
    font(ctx, clamp(rowH * 0.4, 14 * k, 21 * k), F.data, 500);
    ctx.fillStyle = th.ink2;
    ctx.textAlign = 'right';
    ctx.fillText(r.text != null ? String(r.text) : String(r.value), barX - 18 * k, mid + 7 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = th.track;
    roundRect(ctx, barX, mid - bh / 2, barW, bh, bh / 2); ctx.fill();
    if (p != null) {
      ctx.fillStyle = col;
      roundRect(ctx, barX, mid - bh / 2, Math.max(bh, barW * p / 100), bh, bh / 2); ctx.fill();
    }
    font(ctx, clamp(rowH * 0.42, 14 * k, 22 * k), F.data, 700);
    ctx.fillStyle = p == null ? th.ink3 : r.style ? th.ink3 : col;
    ctx.textAlign = 'right';
    ctx.fillText(p == null ? '—' : String(p), W - M - 8 * k, mid + 7 * k);
    ctx.textAlign = 'left';
  });
  if (!rows.length) {
    font(ctx, 22 * k, F.ui, 400);
    ctx.fillStyle = th.ink3;
    ctx.fillText('No games in this window yet.', M, rowsTop + 30 * k);
  }

  /* ---- the report's own words, where the page has room ---- */
  if (proseLines.length) {
    let py = barsBottom + midLabelH + 34 * k;
    ctx.fillStyle = th.rule;
    ctx.fillRect(M, py - 20 * k, inner, 1.5 * k);
    font(ctx, 20 * k, F.ui, 400);
    ctx.fillStyle = th.ink2;
    proseLines.slice(0, 7).forEach((l, i) => ctx.fillText(l, M, py + 14 * k + i * 29 * k));
  }

  /* ---- the footer ---- */
  const fy = H - M - footH + 26 * k;
  ctx.fillStyle = th.rule;
  ctx.fillRect(M, fy - 22 * k, inner, 1.5 * k);
  font(ctx, 36 * k, F.mark);
  ctx.fillStyle = th.ink;
  ctx.fillText('EPINOIΛ', M, fy + 30 * k);
  const markW = ctx.measureText('EPINOIΛ').width;
  font(ctx, 14 * k, F.micro);
  ctx.fillStyle = th.ink3;
  const note = (m.games ? m.games + (m.games === 1 ? ' GAME' : ' GAMES') + ' · ' : '') + 'RATES FROM THE WEEK\'S OWN TOTALS';
  ctx.fillText(ellipsis(ctx, note, inner - markW - 40 * k), M + markW + 24 * k, fy + 14 * k);
  ctx.fillText(ellipsis(ctx, (m.url || '').replace(/^https?:\/\//, '') + (m.generated ? ' · ' + m.generated : ''),
    inner - markW - 40 * k), M + markW + 24 * k, fy + 36 * k);
  return { rowH, rows: rows.length, prose: proseLines.length, format: o.format || 'a4' };
}

/* ------------------------------------------------------------- assets ------ */
const FACES = ['400 40px Jersey25', '400 20px Silkscreen', '500 20px Archivo', '600 20px Archivo',
  '500 20px MartianMono', '700 20px MartianMono', '400 36px EpinoiaMark'];

/* the page's faces, loaded before a single glyph is drawn: a canvas does not wait for a web font, and a
   sheet set in the fallback would be the one thing on it that looked wrong. Never more than 4 s. */
function fontsReady() {
  const d = root.document;
  if (!d || !d.fonts || !d.fonts.load) return Promise.resolve();
  const all = Promise.all(FACES.map(f => d.fonts.load(f).catch(() => null)));
  return Promise.race([all, new Promise(r => setTimeout(r, 4000))]);
}

function loadImage(url) {
  if (!url || typeof root.Image !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new root.Image();
    let done = false;
    const end = v => { if (!done) { done = true; resolve(v); } };
    img.crossOrigin = 'anonymous';
    img.onload = () => end(img.naturalWidth ? img : null);
    img.onerror = () => end(null);
    setTimeout(() => end(null), 6000);
    img.src = url;
  });
}

/* the crest, only if the canvas can still be saved with it on */
async function readableCrest(url) {
  const img = await loadImage(url);
  if (!img) return null;
  try {
    const c = root.document.createElement('canvas');
    c.width = c.height = 24;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 24, 24);
    img.__tone = crestTone(x.getImageData(0, 0, 24, 24).data);
    return img;
  } catch (_) { return null; }
}

/* WHAT A CREST IS DRAWN ON. Most crests are made for white paper and vanish on the screen's green-black (ASVEL's
   black shield); a few are white marks made for dark shirts and vanish on white. So a crest is read once: the
   mean lightness of its opaque pixels. A dark crest ('dark') goes on a light disc, a light one ('light') on the
   dark disc, and a crest that fills its square (its own ground, 'solid') on either. */
function crestTone(px, side) {
  const S = side || 24, EDGE = 4 * S - 4;
  let n = 0, sum = 0, edge = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    n++;
    const p = i / 4, x = p % S, y = (p - x) / S;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) edge++;
  }
  if (!n) return 'dark';
  if (edge / EDGE > 0.85 && n > S * S * 0.9) return 'solid';
  return sum / n > 0.62 ? 'light' : 'dark';
}

/* the disc a crest sits on, for its tone: a light one under a dark crest, the page's panel under a light one */
function crestGround(img, th) {
  const tone = img && img.__tone;
  if (tone === 'light') return th.fringe ? th.panel2 : '#1c2b24';
  return th.fringe ? '#f2f6f4' : '#ffffff';
}

async function canvas(model, opts) {
  const o = Object.assign({ format: 'a4', theme: 'dark', scale: 2 }, opts || {});
  const fmt = FORMATS[o.format] || FORMATS.a4;
  await fontsReady();
  const m = Object.assign({}, model);
  const [crest, leagueCrest] = await Promise.all([m.crestUrl && !m.crest ? readableCrest(m.crestUrl) : null,
    m.leagueCrestUrl && !m.leagueCrest ? readableCrest(m.leagueCrestUrl) : null]);
  if (crest) m.crest = crest;
  if (leagueCrest) m.leagueCrest = leagueCrest;
  const c = root.document.createElement('canvas');
  c.width = Math.round(fmt.w * o.scale);
  c.height = Math.round(fmt.h * o.scale);
  const ctx = c.getContext('2d');
  ctx.scale(o.scale, o.scale);
  draw(ctx, m, o);
  return c;
}

const blobOf = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('the page could not be drawn'))), type, q));

async function png(model, opts) {
  return blobOf(await canvas(model, Object.assign({ format: 'post', theme: 'dark' }, opts)), 'image/png');
}

/* ------------------------------------------------------------------- PDF --- */
/* One A4 page with the sheet on it, edge to edge. The JPEG goes in as it is (DCTDecode), so the file is the
   image and a few hundred bytes of structure; every object's byte offset is counted as it is written. */
const A4_PT = [595.28, 841.89];

function pdfText(s) {
  /* the title as UTF-16BE hex, so a club named Äänekosken Huima keeps its letters */
  let hex = 'FEFF';
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}

function pdfDate(d) {
  const z = n => String(n).padStart(2, '0');
  return 'D:' + d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate()) + z(d.getUTCHours()) +
    z(d.getUTCMinutes()) + z(d.getUTCSeconds()) + 'Z';
}

function pdfFromJpeg(jpeg, pxW, pxH, meta) {
  const mt = meta || {};
  const page = mt.page || A4_PT;
  const enc = s => {                                   // the structure is ASCII: one byte per character
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  };
  const parts = [], offsets = [];
  let len = 0;
  const put = b => { parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    put(enc(n + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n')));
    if (stream) { put(stream); put(enc('\nendstream\nendobj\n')); }
  };
  /* the image fills the page, its own proportions kept, centred */
  const s = Math.min(page[0] / pxW, page[1] / pxH);
  const w = +(pxW * s).toFixed(2), h = +(pxH * s).toFixed(2);
  const x = +((page[0] - w) / 2).toFixed(2), y = +((page[1] - h) / 2).toFixed(2);
  const draw = enc('q ' + w + ' 0 0 ' + h + ' ' + x + ' ' + y + ' cm /Im0 Do Q');
  put(enc('%PDF-1.4\n%âãÏÓ\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + page[0] + ' ' + page[1] + '] ' +
         '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  obj(4, '<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH +
         ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
  obj(5, '<< /Length ' + draw.length + ' >>', draw);
  obj(6, '<< /Title ' + pdfText(mt.title || 'Weekly report') + ' /Producer (Epinoia) /Creator (Epinoia weekly report)' +
         ' /CreationDate (' + pdfDate(mt.date || new Date()) + ') >>');
  const xref = len;
  let table = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n <= 6; n++) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  put(enc(table + 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
  const out = new Uint8Array(len);
  let at = 0;
  parts.forEach(b => { out.set(b, at); at += b.length; });
  return out;
}

async function pdf(model, opts) {
  const o = Object.assign({ format: 'a4', theme: 'light', scale: 2 }, opts || {});
  const c = await canvas(model, o);
  const jpg = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.92)).arrayBuffer());
  const bytes = pdfFromJpeg(jpg, c.width, c.height, { title: model && model.title, date: new Date() });
  return new root.Blob([bytes], { type: 'application/pdf' });
}

/* ------------------------------------------------------------------ save --- */
const slug = s => String(s || 'report').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';

function filename(model, kind) {
  const d = new Date();
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return 'epinoia-weekly-' + slug(model && model.name) + '-' + day + '.' + (kind === 'pdf' ? 'pdf' : 'png');
}

async function save(model, kind, opts) {
  const blob = kind === 'pdf' ? await pdf(model, opts) : await png(model, opts);
  const url = root.URL.createObjectURL(blob);
  const a = root.document.createElement('a');
  a.href = url;
  a.download = filename(model, kind);
  root.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => root.URL.revokeObjectURL(url), 30000);
  return blob;
}

/* the drawing kit, for the other pages drawn in this house style (socialcard.js): one set of faces, colours and
   measuring rules, so a post and a report sheet from the same league look like they came from the same place */
const util = { F, font, fit, nameBlock, wrap, ellipsis, display, roundRect, rgb, rgba, lum, accentOn, contrast, initials, ordinal,
               fontsReady, loadImage, readableCrest, crestTone, crestGround, blobOf };

return { draw, canvas, png, pdf, save, pdfFromJpeg, filename, wrap, fit, ordinal, initials, accentOn, contrast,
         FORMATS, THEMES, util };
}));
