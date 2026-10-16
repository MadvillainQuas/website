'use strict';
/* ============================================================================
   NEWS POSTS - a story drawn as a sports desk's Instagram post, in the creator hub (creators/hub/posts.js).
   window.EpinoiaNewsPost

   Louie, 2026-10-16: "social media news post graphics (i.e. Instagram professional sports news posts) for the articles
   with input'able images i.e. of a game, of a player etc." - and, with three examples (an injury report, a signing, a
   quote), "take inspiration from these to use as modular elements that can be adapted to whatever article/structure of
   the piece/content as required".

   SO A POST IS A STACK OF PIECES, and a template is only which pieces, where:

     the ground     a photograph (moved and zoomed by hand, darkened, blurred), two side by side, or the story's own
                    cover art (newsart.js) when there is no picture
     cut-outs       a player with no background (a PNG), stood over the big type the way the examples stand them
     the crest      the club's, enormous behind the subject (a signing), or a medallion on the table's edge (a report)
     big type       the giant two-word title in two colours (INJURY / REPORT), or the stacked headline whose last line is
                    the accent's (LONNIE WALKER / JOINS BESIKTAS); *stars* put any words in the accent
     the strap      a small line under it (VIA MULTIPLE REPORTS)
     the quote      the panel's edge, a rule in the accent with its square badge, the words in capitals, who said them
                    and when
     the table      a white card: the club's band, a row a player - position, name, a status pill, when, a note
     a badge        the icon on a glossy disc (a cross for an injury, a star, a bolt, quotation marks)
     the sponsor    PRESENTED BY: and the sponsor's name or logo
     the corners    the accent's arcs in the lower corners
     the brand      the outlet's mark, top left
     the score      both crests, the score and FINAL, on a bar
     the number     the night's number huge, what it counts and whose

     TEMPLATES   headline · quote · report · result · stat · cover (the story's 16:9 cover, to use as its picture)
     compose(article, facts, over)   -> a post: the template the story suits and every piece's words filled in from it
     draw(ctx, post, { size })       one post onto a 2D context (any template, any size; the tests drive it)
     png(post, { size, scale })      -> Blob image/png
     caption(post)                   the words to post it with
     SIZES                           square, portrait, story (Instagram's three) and wide (a 16:9 cover)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsPost = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const NA = () => root.EpinoiaNewsArt || (typeof require === 'function' ? require('./newsart.js') : null);

const SIZES = {
  square:   { w: 1080, h: 1080, top: 0, bottom: 0, label: 'square 1:1' },
  portrait: { w: 1080, h: 1350, top: 0, bottom: 0, label: 'portrait 4:5' },
  story:    { w: 1080, h: 1920, top: 250, bottom: 330, label: 'story 9:16' },
  wide:     { w: 1600, h: 900, top: 0, bottom: 0, label: 'cover 16:9' }
};
const TEMPLATES = [
  ['headline', 'Headline'], ['quote', 'Quote'], ['report', 'Report'], ['result', 'Result'], ['stat', 'Big number'], ['cover', 'Cover art']
];
/* the pieces a template draws, and the ones a person can switch off */
const PIECES = {
  headline: ['brand', 'kicker', 'crest', 'cutouts', 'headline', 'sub', 'corners'],
  quote:    ['brand', 'photos', 'badge', 'quote', 'who', 'corners'],
  report:   ['brand', 'title', 'badge', 'sponsor', 'cutouts', 'table', 'crest'],
  result:   ['brand', 'kicker', 'cutouts', 'headline', 'score', 'sub'],
  stat:     ['brand', 'kicker', 'cutouts', 'stat', 'headline', 'corners'],
  cover:    ['brand']
};
const ICONS = ['cross', 'star', 'bolt', 'quote', 'ball', 'none'];

/* ------------------------------------------------------------------ words --- */
const up = s => String(s || '').toLocaleUpperCase('en');
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
/* a headline as lines of segments: a typed line break is kept, *stars* mark the accent's words; with no stars, the
   last line of two or more takes the accent (the examples' second line) */
function parseHeadline(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const marked = /\*[^*]+\*/.test(raw);
  const toWords = line => {
    const out = [];
    let acc = false;
    line.split(/(\*)/).forEach(part => {
      if (part === '*') { acc = !acc; return; }
      part.split(/\s+/).filter(Boolean).forEach(w => out.push({ text: up(w), accent: acc }));
    });
    return out;
  };
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean).map(toWords);
  return { lines, marked, explicit: lines.length > 1 };
}

/* the status of a row in a report: its pill's colours, by what it says */
function statusStyle(s) {
  const t = String(s || '').toLowerCase();
  if (/\b(out|ruled out|surgery|season|doubtful|suspended|ban)\b/.test(t)) return { bg: '#fde2e2', ink: '#c81e1e' };
  if (/game[- ]?time|questionable|probable|50|day[- ]to[- ]day|dtd/.test(t)) return { bg: '#fff1c2', ink: '#8a5a00' };
  if (/\b(in|available|cleared|back|returns?|fit|playing)\b/.test(t)) return { bg: '#d9f7e3', ink: '#147a3d' };
  return { bg: '#e7e9ee', ink: '#3d4350' };
}
/* a report's table from text: a row a line, cells split by | (or by tabs, pasted from a spreadsheet) */
function parseRows(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 12)
    .map(l => l.split(/\s*[|\t]\s*/).map(c => c.trim()));
}

/* ---------------------------------------------------------------- compose --- */
/* EVERYTHING A POST NEEDS FROM ITS STORY, filled in for a person to change:
   article: { title, summary, kind, brand: { name, colour, logo }, url, league: { name, slug, colour } }
   facts:   newsart.js analyse() of it
   over:    anything already chosen (the template, the size, the words) - kept */
function compose(article, facts, over) {
  const a = article || {}, f = facts || {}, o = over || {};
  const topic = f.topic || { key: 'news', words: ['LATEST', 'NEWS'] };
  const auto = f.quote ? 'quote' : topic.key === 'injury' ? 'report' : (f.layout === 'duel' && f.score) ? 'result'
    : f.number ? 'stat' : 'headline';
  const who = (f.names && f.names[0]) || '';
  const lead = f.clubs && f.clubs[0] && !f.clubs[0].guess ? f.clubs[0] : null;
  /* the headline in two lines when the story's subject opens it (LONNIE WALKER / JOINS BESIKTAS) */
  let headline = clean(a.title);
  if (who && headline.toLowerCase().startsWith(who.toLowerCase()) && headline.length > who.length + 3) {
    headline = who + '\n' + headline.slice(who.length).replace(/^[\s:,’'s-]+/, '').replace(/^s\s/, '');
  }
  const post = {
    template: auto, size: 'portrait',
    palette: f.palette || null, accent: null, theme: 'auto',
    headline, kicker: topic.words.join(' '),
    sub: a.brand && a.brand.name && a.kind === 'story' ? 'via ' + a.brand.name : '',
    title: topic.key === 'injury' ? ['INJURY', 'REPORT'] : topic.words.slice(0, 2),
    quote: f.quote || '', who: who ? up(who) : '', whoLine: '',
    stat: f.number ? { value: f.number.value, label: f.number.label, who: who ? up(who) : '' } : { value: '', label: '', who: '' },
    score: f.layout === 'duel' ? { home: f.clubs[0], away: f.clubs[1], hs: f.score ? f.score[0] : '', as: f.score ? f.score[1] : '', label: 'FINAL' } : null,
    club: lead, rows: [], tableHead: lead ? lead.name : '', sponsor: { text: '', name: '' },
    icon: topic.key === 'injury' ? 'cross' : f.quote ? 'quote' : topic.key === 'award' ? 'star' : 'bolt',
    off: [], handle: '', dim: 0.35, blur: 0,
    photos: [], cutouts: [], images: { crest: null, crests: [], brand: null, sponsor: null },
    facts: f, article: { title: a.title || '', summary: a.summary || '', url: a.url || '', league: a.league || null, brand: a.brand || {} }
  };
  return Object.assign(post, o);
}

/* ------------------------------------------------------------------ paint --- */
const on = (p, piece) => !(p.off || []).includes(piece);
function pal(p) {
  const A = NA();
  const base = p.palette || A.palette(null, null, (p.article && p.article.title) || 'news');
  return p.accent ? Object.assign({}, base, { accent: p.accent }) : base;
}
function photoOf(p, i) { const x = (p.photos || [])[i]; return x && x.img ? x : null; }

/* THE GROUND: the photograph (or two), darkened toward the foot where the words go; or the story's cover art */
function groundPhoto(ctx, W, H, p, P, box) {
  const A = NA();
  const b = box || { x: 0, y: 0, w: W, h: H };
  const ph = [photoOf(p, 0), photoOf(p, 1)].filter(Boolean);
  if (!ph.length) return false;
  if (ph.length === 2 && p.split !== false) {
    const half = b.w / 2;
    A.cover(ctx, ph[0].img, b.x, b.y, half, b.h, ph[0]);
    A.cover(ctx, ph[1].img, b.x + half, b.y, b.w - half, b.h, ph[1]);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(b.x + half - Math.max(2, W * 0.002), b.y, Math.max(4, W * 0.004), b.h);
  } else {
    A.cover(ctx, ph[0].img, b.x, b.y, b.w, b.h, Object.assign({}, ph[0], { blur: p.blur ? p.blur * W / 1080 : 0 }));
  }
  if (p.dim) { ctx.fillStyle = 'rgba(0,0,0,' + Math.max(0, Math.min(0.85, p.dim)) + ')'; ctx.fillRect(b.x, b.y, b.w, b.h); }
  return true;
}
function groundArt(ctx, W, H, p, P) {
  const A = NA();
  A.ground(ctx, W, H, P, (p.facts && p.facts.seed) || 7, { lightX: W * 0.7 });
  A.slash(ctx, W, H, W * 0.58, P.accent, { alpha: 0.1, band: W * 0.07 });
}
/* the foot darkened into the field's deep colour, so white words read on any photograph */
function footShade(ctx, W, H, P, from, strength) {
  const A = NA();
  const g = ctx.createLinearGradient(0, H * from, 0, H);
  g.addColorStop(0, A.rgba(P.deep, 0));
  g.addColorStop(0.55, A.rgba(P.deep, 0.78 * (strength || 1)));
  g.addColorStop(1, A.rgba(P.deep, Math.min(1, 0.96 * (strength || 1))));
  ctx.fillStyle = g; ctx.fillRect(0, H * from, W, H * (1 - from));
}

/* a cut-out, stood with its feet on a line: { img, x (its centre, share of the width), scale (its height, share of the
   post's), y (nudged up or down, share) } */
function cutouts(ctx, W, H, p, baseY, defaults) {
  const list = (p.cutouts || []).filter(c => c && c.img);
  list.forEach((c, i) => {
    const d = (defaults || [])[i] || { x: list.length > 1 ? (i ? 0.66 : 0.34) : 0.58, h: 0.62 };
    const hgt = H * (c.scale || d.h);
    const iw = c.img.naturalWidth || c.img.width, ih = c.img.naturalHeight || c.img.height;
    const wdt = hgt * iw / ih;
    const cx = W * (c.x != null ? c.x : d.x);
    const bottom = baseY + H * (c.y || 0);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = W * 0.03;
    ctx.drawImage(c.img, cx - wdt / 2, bottom - hgt, wdt, hgt);
    ctx.restore();
  });
  return list.length;
}

/* the brand's mark, top left: its logo on a disc, or its name in the condensed capitals */
function brandMark(ctx, W, H, p, P, top, pad) {
  const A = NA();
  const s = W * 0.045;
  const img = p.images && p.images.brand;
  if (img) { A.disc(ctx, pad + s, top + pad + s, s, img, { name: p.article.brand.name }); return; }
  const name = p.handle || (p.article && p.article.brand && p.article.brand.name);
  if (!name) return;
  A.font(ctx, s * 0.7, 800, 'semi-condensed');
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(up(name), pad, top + pad + s * 0.6);
  ctx.textBaseline = 'alphabetic';
}

/* THE STACKED HEADLINE in a box, as big as it goes: { x, w, bottom (its last baseline's floor), maxH, maxLines, align }
   -> its top (for whatever stands on it) */
function headlineBlock(ctx, W, p, P, box) {
  const A = NA();
  const parsed = parseHeadline(p.headline);
  if (!parsed.lines.length) return box.bottom;
  const lead = 0.9;
  const colourOf = (w, li, n) => (w.accent || (!parsed.marked && n > 1 && li === n - 1) ? P.accent : '#ffffff');
  let best = null;
  const maxS = box.maxSize || W * 0.14, minS = W * 0.035;
  for (let s = maxS; s >= minS; s *= 0.94) {
    let ls;
    if (parsed.explicit) ls = parsed.lines;
    else ls = A.wrap(ctx, parsed.lines[0], box.w, s);
    const segs = ls.map((l, li) => l.map((w, wi) => ({ text: (wi ? ' ' : '') + w.text, colour: colourOf(w, li, ls.length) })));
    const fits = A.fit(ctx, segs, box.w, box.maxH, { lead, max: s, min: 1 });
    if (fits >= s * 0.999 && ls.length <= (box.maxLines || 5)) { best = { segs, s }; break; }
    if (parsed.explicit) { best = { segs, s: fits }; break; }
  }
  if (!best) {
    const ls = A.wrap(ctx, parsed.lines.flat(), box.w, minS);
    best = { segs: ls.map((l, li) => l.map((w, wi) => ({ text: (wi ? ' ' : '') + w.text, colour: colourOf(w, li, ls.length) }))), s: minS };
  }
  const n = best.segs.length;
  const top = box.bottom - (n - 1) * best.s * lead - best.s * 0.78;
  A.lines(ctx, best.segs, box.align === 'left' ? box.x : box.x + box.w / 2, top + best.s * 0.78, best.s,
    { lead, align: box.align === 'left' ? 'left' : 'center', shadow: 'rgba(0,0,0,0.35)' });
  return top;
}
/* a small tracked line in capitals: the strap under a headline, the context under a quote's name */
function smallLine(ctx, text, x, y, size, colour, align, weight, caps) {
  const A = NA();
  A.font(ctx, size, weight || 500, 'normal');
  const t = caps === false ? String(text) : up(text);
  ctx.fillStyle = colour; ctx.textAlign = align || 'center'; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) { ctx.letterSpacing = caps === false ? '0px' : Math.round(size * 0.08) + 'px'; }
  ctx.fillText(t, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
/* words wrapped to a width in one face, centred lines -> the y under them */
function para(ctx, text, cx, y, w, size, colour, weight, lead, maxLines) {
  const A = NA();
  A.font(ctx, size, weight || 500, 'normal');
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  words.forEach(wd => { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > w && cur) { out.push(cur); cur = wd; } else cur = t; });
  if (cur) out.push(cur);
  const ls = out.slice(0, maxLines || 3);
  ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ls.forEach((l, i) => ctx.fillText(l, cx, y + i * size * (lead || 1.25)));
  return y + ls.length * size * (lead || 1.25);
}
/* THE BADGE: an icon on a glossy disc in the accent */
function badge(ctx, cx, cy, r, icon, P, square) {
  const A = NA();
  if (!icon || icon === 'none') return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.12;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  g.addColorStop(0, A.mix(P.accent, '#ffffff', 0.35)); g.addColorStop(0.6, P.accent); g.addColorStop(1, A.mix(P.accent, '#000000', 0.3));
  ctx.fillStyle = square ? P.accent : g;
  if (square) { A.rr(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.12); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  const ink = A.lum(P.accent) > 0.6 ? '#0b0d10' : '#ffffff';
  ctx.save();
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = r * 0.12;
  if (icon === 'cross') {
    const a = r * 0.5, t = r * 0.2;
    A.rr(ctx, cx - t, cy - a, t * 2, a * 2, t * 0.5); ctx.fill();
    A.rr(ctx, cx - a, cy - t, a * 2, t * 2, t * 0.5); ctx.fill();
  } else if (icon === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.26 : r * 0.58, ang = -Math.PI / 2 + i * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](cx + rad * Math.cos(ang), cy + rad * Math.sin(ang));
    }
    ctx.closePath(); ctx.fill();
  } else if (icon === 'bolt') {
    const k = r / 10;
    ctx.beginPath();
    [[1.5, -6], [-3.5, 0.8], [-0.2, 0.8], [-1.6, 6], [3.6, -1.2], [0.4, -1.2], [1.5, -6]].forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](cx + x * k, cy + y * k));
    ctx.closePath(); ctx.fill();
  } else if (icon === 'quote') {
    A.font(ctx, r * 1.9, 900, 'normal');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('“', cx, cy + r * 0.42);
    ctx.textBaseline = 'alphabetic';
  } else if (icon === 'ball') {
    ctx.lineWidth = r * 0.09;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx + r * 0.55, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.55); ctx.lineTo(cx, cy + r * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - r * 0.75, cy, r * 0.5, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + r * 0.75, cy, r * 0.5, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
  }
  ctx.restore();
}
/* the accent's arcs in the two lower corners */
function corners(ctx, W, H, P, bottom) {
  ctx.save();
  ctx.strokeStyle = P.accent; ctx.lineWidth = Math.max(3, W * 0.006); ctx.lineCap = 'round';
  const r = W * 0.2, y = H - bottom;
  ctx.beginPath(); ctx.arc(-r * 0.15, y + r * 0.62, r, -Math.PI * 0.5, -Math.PI * 0.05); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - W * 0.17, y); ctx.lineTo(W - W * 0.17, y - W * 0.035); ctx.lineTo(W, y - W * 0.035); ctx.stroke();
  ctx.restore();
}
/* a pill in the accent */
function kicker(ctx, p, P, x, y, size, align) {
  const A = NA();
  if (!p.kicker || !on(p, 'kicker')) return 0;
  return A.pill(ctx, p.kicker, x, y, size, P.accent, A.lum(P.accent) > 0.5 ? '#0b0d10' : '#ffffff', align);
}

/* ---------------------------------------------------------------- templates --- */
function drawHeadline(ctx, W, H, S, p, P) {
  const A = NA();
  const pad = W * 0.06, top = S.top, bottom = S.bottom;
  const hasPhoto = groundPhoto(ctx, W, H, p, P);
  if (!hasPhoto) groundArt(ctx, W, H, p, P);
  const subS = W * 0.026;
  const hasSub = p.sub && on(p, 'sub');
  const floor = H - bottom - pad * (hasSub ? 1.15 : 0.9) - (hasSub ? subS * 1.4 : 0);
  /* the headline's top is known before anything is drawn (estimateTop): the crest and the cut-outs are sized to the
     room above it, and the kicker sits on it */
  const probe = { x: pad, w: W - pad * 2, bottom: floor, maxH: (H - top - bottom) * 0.3, maxLines: 4 };
  const parsed = parseHeadline(p.headline);
  const showHead = on(p, 'headline') && parsed.lines.length;
  const est = showHead ? estimateTop(ctx, W, p, P, probe) : floor;
  const room = est - W * 0.07 - (top + pad * 1.6);
  /* THE CREST, enormous behind the subject (the signing's) */
  const crest = p.images && p.images.crest;
  if (crest && on(p, 'crest')) {
    const big = Math.max(W * 0.3, Math.min(W * 0.72, room));
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = W * 0.03;
    A.contain(ctx, crest, -big * 0.04, top + pad * 1.6 + Math.max(0, room - big) * 0.4, big, big);
    ctx.restore();
  }
  footShade(ctx, W, H, P, hasPhoto ? 0.42 : 0.55, hasPhoto ? 1 : 0.6);
  let headTop = floor;
  /* cut-outs stand a little into the headline (the examples' figure stands behind its words) */
  const tall = Math.min(0.66, (est - top - pad) / H);
  if (on(p, 'cutouts') && cutouts(ctx, W, H, p, est + W * 0.06, [{ x: 0.6, h: tall }, { x: 0.36, h: tall * 0.92 }])) {
    footShade(ctx, W, H, P, Math.max(0, est / H - 0.08), 1);
  }
  if (showHead) headTop = headlineBlock(ctx, W, p, P, probe);
  if (hasSub) smallLine(ctx, p.sub, W / 2, H - bottom - pad * 0.95, subS, 'rgba(255,255,255,0.78)', 'center', 500);
  const ks = W * 0.026;
  if (on(p, 'kicker') && p.kicker) kicker(ctx, p, P, W / 2, headTop - ks * 2.6 - W * 0.012, ks, 'center');
  if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.7);
  if (on(p, 'corners') && !hasPhoto) corners(ctx, W, H, P, bottom);
}
/* where a headline's top would fall, without drawing it */
function estimateTop(ctx, W, p, P, box) {
  const A = NA();
  const parsed = parseHeadline(p.headline);
  const lead = 0.9, maxS = box.maxSize || W * 0.14, minS = W * 0.035;
  for (let s = maxS; s >= minS; s *= 0.94) {
    const ls = parsed.explicit ? parsed.lines : A.wrap(ctx, parsed.lines[0] || [], box.w, s);
    const segs = ls.map(l => l.map((w, wi) => ({ text: (wi ? ' ' : '') + w.text, colour: '#fff' })));
    const fits = A.fit(ctx, segs, box.w, box.maxH, { lead, max: s, min: 1 });
    if ((fits >= s * 0.999 && ls.length <= (box.maxLines || 5)) || parsed.explicit) {
      const sz = parsed.explicit ? fits : s;
      return box.bottom - (ls.length - 1) * sz * lead - sz * 0.78;
    }
  }
  return box.bottom - W * 0.1;
}

function drawQuote(ctx, W, H, S, p, P) {
  const A = NA();
  const pad = W * 0.07, top = S.top, bottom = S.bottom;
  const panelH = top + (H - top - bottom) * (H / W > 1.5 ? 0.46 : 0.5);
  /* the lower panel: near black, warmed by the accent toward the foot */
  ctx.fillStyle = A.mix(P.deep, '#050608', 0.6); ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 1.05, W * 0.05, W / 2, H * 1.05, W * 0.9);
  glow.addColorStop(0, A.rgba(P.accent, 0.35)); glow.addColorStop(1, A.rgba(P.accent, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, panelH, W, H - panelH);
  /* the photographs over the top, or the story's art */
  if (!on(p, 'photos') || !groundPhoto(ctx, W, H, Object.assign({}, p, { dim: Math.min(p.dim || 0, 0.2), blur: 0 }), P, { x: 0, y: 0, w: W, h: panelH })) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, panelH); ctx.clip();
    groundArt(ctx, W, panelH, p, P);
    if (p.who) {
      const nl = A.nameLines(p.who);
      const ls = nl.length === 2 ? [[{ text: nl[0], colour: '#ffffff' }], [{ text: nl[1], colour: P.accent }]] : [[{ text: nl[0], colour: P.accent }]];
      const s = A.fit(ctx, ls, W - pad * 2, (panelH - top) * 0.62, { max: W * 0.2 });
      A.lines(ctx, ls, pad, top + (panelH - top) * 0.2 + s * 0.8, s, { shadow: 'rgba(0,0,0,0.3)' });
    }
    ctx.restore();
  }
  /* the rule and its badge */
  const ruleH = Math.max(4, W * 0.007);
  ctx.fillStyle = P.accent; ctx.fillRect(0, panelH - ruleH / 2, W, ruleH);
  const br = W * 0.058;
  if (on(p, 'badge')) badge(ctx, W / 2, panelH, br, 'quote', P, true);
  /* the words: capitals, as big as the room under the badge allows, then who and when */
  const whoS = W * 0.032, lineS = W * 0.03;
  const whoH = (p.who && on(p, 'who') ? whoS * 1.6 : 0) + (p.whoLine && on(p, 'who') ? lineS * 2.6 : 0);
  const qTop = panelH + br * 1.5, qBottom = H - bottom - pad * 0.9 - whoH;
  let qEnd = qTop;
  if (p.quote && on(p, 'quote')) {
    const words = clean(p.quote).replace(/^["“«]|["”»]$/g, '').replace(/[,;:]+$/, '.').split(' ').filter(Boolean).map(w => ({ text: up(w), accent: false }));
    let s = W * 0.1, ls = null;
    for (; s > W * 0.03; s *= 0.95) {
      ls = A.wrap(ctx, words, W - pad * 2, s);
      if (ls.length * s * 0.92 <= qBottom - qTop) break;
    }
    const segs = ls.map(l => l.map((w, i) => ({ text: (i ? ' ' : '') + w.text, colour: '#ffffff' })));
    const blockH = ls.length * s * 0.92;
    const y0 = qTop + Math.max(0, (qBottom - qTop - blockH) * 0.35) + s * 0.78;
    qEnd = A.lines(ctx, segs, W / 2, y0, s, { align: 'center', lead: 0.92 }) + s * 0.5;
  }
  if (on(p, 'who')) {
    let y = Math.max(qEnd + whoS * 1.1, H - bottom - pad * 0.9 - whoH + whoS);
    if (p.who) { smallLine(ctx, p.who, W / 2, y, whoS, '#ffffff', 'center', 800); y += whoS * 1.25; }
    if (p.whoLine) para(ctx, p.whoLine, W / 2, y + lineS * 0.2, W * 0.6, lineS, 'rgba(255,255,255,0.86)', 500, 1.2, 2);
  }
  if (on(p, 'corners')) {
    ctx.save(); ctx.strokeStyle = P.accent; ctx.lineWidth = Math.max(3, W * 0.005);
    const y = H - bottom - W * 0.06;
    ctx.beginPath(); ctx.arc(W * 0.05, y + W * 0.42, W * 0.42, -Math.PI * 0.62, -Math.PI * 0.32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.72, H - bottom); ctx.lineTo(W * 0.72, y + W * 0.03); ctx.lineTo(W, y + W * 0.03); ctx.stroke();
    ctx.restore();
  }
  if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.6);
}

function drawReport(ctx, W, H, S, p, P) {
  const A = NA();
  const pad = W * 0.055, top = S.top, bottom = S.bottom;
  if (!groundPhoto(ctx, W, H, Object.assign({}, p, { blur: p.blur || 6, dim: Math.max(p.dim || 0, 0.5) }), P)) groundArt(ctx, W, H, p, P);
  /* THE TITLE: two words across the top, the first white and the second in the accent */
  const t = (p.title || []).map(up).filter(Boolean);
  let titleBottom = top + pad * 0.6;
  let crossX = W / 2, titleS = 0, titleTop = top + pad;
  if (t.length && on(p, 'title')) {
    const segs = [[{ text: t[0], colour: '#ffffff' }].concat(t[1] ? [{ text: ' ' + t[1], colour: P.accent }] : [])];
    titleS = A.fit(ctx, segs, W - pad * 2, (H - top - bottom) * 0.2, { max: W * 0.24, lead: 1 });
    /* under the brand's mark when there is one, the mark's own line kept clear */
    titleTop = top + pad * (on(p, 'brand') ? 2.2 : 1.2) + titleS * 0.1;
    A.lines(ctx, segs, W / 2, titleTop + titleS * 0.78, titleS, { align: 'center', shadow: 'rgba(0,0,0,0.4)' });
    A.font(ctx, titleS, 900, 'extra-condensed');
    const wAll = ctx.measureText(segs[0].map(x => x.text).join('')).width, w0 = ctx.measureText(t[0]).width;
    crossX = W / 2 - wAll / 2 + w0 + ctx.measureText(' ').width / 2;
    titleBottom = titleTop + titleS * 0.86;
  }
  /* the badge over the gap between the two words, sitting on their top edge (the example's cross) */
  if (on(p, 'badge') && titleS) badge(ctx, crossX, titleTop - titleS * 0.08, titleS * 0.3, p.icon, P);
  /* PRESENTED BY, under the title on the right */
  let sponsorBottom = titleBottom;
  const sp = p.sponsor || {};
  if (on(p, 'sponsor') && (sp.name || (p.images && p.images.sponsor))) {
    const ss = W * 0.034;
    const y = titleBottom + ss * 1.5;
    const label = up(sp.text || 'PRESENTED BY:');
    let x = W - pad;
    if (p.images && p.images.sponsor) {
      const img = p.images.sponsor, h = ss * 1.4, w = h * (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
      ctx.drawImage(img, x - w, y - h * 0.82, w, h); x -= w + ss * 0.4;
    } else {
      A.font(ctx, ss * 1.25, 800, 'normal');
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(sp.name, x, y);
      x -= ctx.measureText(sp.name).width + ss * 0.4;
    }
    A.font(ctx, ss, 900, 'condensed'); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(label, x, y);
    sponsorBottom = y + ss * 0.4;
  }
  /* THE TABLE: a white card at the foot, the club's band on top, a row a player */
  const rows = (p.rows || []).filter(r => r && r.some(Boolean));
  const cardX = pad * 0.6, cardW = W - pad * 1.2;
  const cardBottom = H - bottom - pad * 0.6;
  const rowH0 = W * 0.075, headH = W * 0.06;
  const want = headH + Math.max(3, rows.length) * rowH0;
  const cardTop = on(p, 'table') ? Math.max(sponsorBottom + (H - top - bottom) * 0.3, cardBottom - want) : cardBottom;
  const tallR = Math.min(0.52, (cardTop + W * 0.06 - (titleTop + titleS * 0.35)) / H);
  if (on(p, 'cutouts')) cutouts(ctx, W, H, p, cardTop + W * 0.06, [{ x: 0.36, h: tallR * 0.96 }, { x: 0.64, h: tallR }]);
  if (!on(p, 'table')) { if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.6); return; }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = W * 0.03;
  ctx.fillStyle = '#ffffff'; A.rr(ctx, cardX, cardTop, cardW, cardBottom - cardTop, W * 0.025); ctx.fill();
  ctx.restore();
  ctx.save();
  A.rr(ctx, cardX, cardTop, cardW, cardBottom - cardTop, W * 0.025); ctx.clip();
  const band = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  const clubCol = A.hex(p.club && p.club.colour) || P.base;
  band.addColorStop(0, clubCol); band.addColorStop(1, A.mix(P.accent, clubCol, 0.25));
  ctx.fillStyle = band; ctx.fillRect(cardX, cardTop, cardW, headH);
  ctx.restore();
  const hs = headH * 0.36;
  const crestImg = p.images && p.images.crest;
  let hx = cardX + pad * 0.4;
  if (crestImg) { A.contain(ctx, crestImg, hx, cardTop + headH * 0.18, headH * 0.64, headH * 0.64); hx += headH * 0.8; }
  A.font(ctx, hs, 700, 'normal'); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(String(p.tableHead || ''), hx, cardTop + headH / 2);
  if (sp.name && on(p, 'sponsor')) { A.font(ctx, hs * 1.15, 800, 'normal'); ctx.textAlign = 'right'; ctx.fillText(sp.name, cardX + cardW - pad * 0.4, cardTop + headH / 2); }
  ctx.textBaseline = 'alphabetic';
  /* an empty table says how to fill it, on the preview only: a saved post never carries the hint */
  if (!rows.length && p.preview) {
    A.font(ctx, W * 0.026, 500, 'normal'); ctx.fillStyle = '#7a808c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Add the rows under Words, or fill them from the injury report', W / 2, cardTop + headH + (cardBottom - cardTop - headH) / 2);
    ctx.textBaseline = 'alphabetic';
  }
  /* the rows */
  const n = Math.max(1, rows.length);
  const rowH = Math.min(rowH0 * 1.25, (cardBottom - cardTop - headH) / n);
  const fs = Math.min(rowH * 0.3, W * 0.024);
  const cols = [0.09, 0.22, 0.15, 0.14, 0.40];
  const xs = []; let acc = cardX;
  cols.forEach(c => { xs.push(acc); acc += cardW * c; });
  const nameInk = A.lum(P.accent) > 0.5 ? A.mix(P.accent, '#000000', 0.45) : P.accent;
  rows.forEach((r, i) => {
    const y = cardTop + headH + i * rowH, cy = y + rowH / 2;
    if (i) { ctx.fillStyle = '#e6e8ec'; ctx.fillRect(cardX + pad * 0.3, y, cardW - pad * 0.6, Math.max(1, W * 0.0012)); }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    A.font(ctx, fs, 500, 'normal'); ctx.fillStyle = '#20242c';
    if (r[0]) ctx.fillText(r[0], xs[0] + cardW * cols[0] / 2, cy);
    if (r[1]) { A.font(ctx, fs, 600, 'normal'); ctx.fillStyle = nameInk; wrapCell(ctx, r[1], xs[1] + cardW * cols[1] / 2, cy, cardW * cols[1] * 0.9, fs, 2); }
    if (r[2]) {
      const st = statusStyle(r[2]);
      A.font(ctx, fs * 0.92, 600, 'normal');
      const pw = Math.min(cardW * cols[2] * 0.86, ctx.measureText(r[2]).width + fs * 1.6), ph = fs * 1.9;
      ctx.fillStyle = st.bg; A.rr(ctx, xs[2] + cardW * cols[2] / 2 - pw / 2, cy - ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.fillStyle = st.ink; wrapCell(ctx, r[2], xs[2] + cardW * cols[2] / 2, cy, pw - fs * 0.6, fs * 0.92, 2);
    }
    A.font(ctx, fs, 500, 'normal'); ctx.fillStyle = '#20242c';
    if (r[3]) wrapCell(ctx, r[3], xs[3] + cardW * cols[3] / 2, cy, cardW * cols[3] * 0.9, fs, 2);
    if (r[4]) { ctx.textAlign = 'left'; wrapCell(ctx, r[4], xs[4] + fs * 0.4, cy, cardW * cols[4] - fs * 1.4, fs * 0.95, 2, 'left', nameInk); }
    ctx.textBaseline = 'alphabetic';
  });
  /* the crest's medallion on the card's top edge */
  if (crestImg && on(p, 'crest')) A.disc(ctx, W / 2, cardTop, W * 0.07, crestImg, p.club || {}, { ring: P.accent });
  if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.6);
}
/* a cell's words in up to n lines, centred on cy; *stars* in a note are the accent's (the examples' highlighted cause) */
function wrapCell(ctx, text, x, cy, w, size, n, align, accentInk) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  words.forEach(wd => { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t.replace(/\*/g, '')).width > w && cur) { out.push(cur); cur = wd; } else cur = t; });
  if (cur) out.push(cur);
  let ls = out.slice(0, n || 2);
  if (out.length > ls.length) ls[ls.length - 1] = ls[ls.length - 1].replace(/\s*\S*$/, '') + '…';
  const lh = size * 1.22, y0 = cy - (ls.length - 1) * lh / 2;
  const base = ctx.fillStyle;
  ls.forEach((l, i) => {
    if (!/\*/.test(l) || !accentInk) { ctx.textAlign = align || 'center'; ctx.fillText(l.replace(/\*/g, ''), x, y0 + i * lh); return; }
    /* a line with a starred part: drawn piece by piece, left to right */
    let cx = align === 'left' ? x : x - ctx.measureText(l.replace(/\*/g, '')).width / 2;
    let acc = false;
    ctx.textAlign = 'left';
    l.split(/(\*)/).forEach(part => {
      if (part === '*') { acc = !acc; return; }
      ctx.fillStyle = acc ? accentInk : base; ctx.fillText(part, cx, y0 + i * lh); cx += ctx.measureText(part).width;
    });
    ctx.fillStyle = base;
  });
}

function drawResult(ctx, W, H, S, p, P) {
  const A = NA();
  const pad = W * 0.06, top = S.top, bottom = S.bottom;
  const sc = p.score || {};
  const hasPhoto = groundPhoto(ctx, W, H, p, P);
  const barH0 = W * 0.2, floor0 = (on(p, 'score') && sc.home ? H - bottom - pad * 0.7 - barH0 - W * 0.06 : H - bottom - pad);
  const est0 = on(p, 'headline') ? estimateTop(ctx, W, p, P, { x: pad, w: W - pad * 2, bottom: floor0, maxH: (H - top - bottom) * 0.26, maxLines: 3 }) : floor0;
  if (!hasPhoto) {
    const f = Object.assign({}, p.facts || {});
    if (sc.home && sc.away) {
      /* the two clubs' halves above the headline, the deep field under it */
      const artH = Math.max(H * 0.3, est0 - W * 0.03);
      f.layout = 'duel'; f.clubs = [sc.home, sc.away]; f.score = null; f.number = null;
      A.drawArt(ctx, W, artH, f, { clubs: (p.images && p.images.crests) || [] }, { safeTop: (top + W * 0.1) / artH, strap: false });
      ctx.fillStyle = A.mix(P.deep, '#05070a', 0.4); ctx.fillRect(0, artH, W, H - artH);
    } else groundArt(ctx, W, H, p, P);
  }
  footShade(ctx, W, H, P, hasPhoto ? 0.4 : 0.5, 1);
  /* THE SCORE BAR */
  const barH = W * 0.2, barY = H - bottom - pad * 0.7 - barH;
  if (on(p, 'score') && sc.home && sc.away) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = W * 0.03;
    ctx.fillStyle = 'rgba(8,10,14,0.88)'; A.rr(ctx, pad * 0.6, barY, W - pad * 1.2, barH, W * 0.025); ctx.fill();
    ctx.restore();
    const r = barH * 0.3, cy = barY + barH * 0.44;
    const crests = (p.images && p.images.crests) || [];
    A.disc(ctx, pad * 0.6 + barH * 0.5, cy, r, crests[0], sc.home);
    A.disc(ctx, W - pad * 0.6 - barH * 0.5, cy, r, crests[1], sc.away);
    const nm = c => A.clubWords(c).slice(-1)[0].toUpperCase();
    A.font(ctx, barH * 0.12, 800, 'condensed'); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
    ctx.fillText(nm(sc.home), pad * 0.6 + barH * 0.5, barY + barH * 0.9);
    ctx.fillText(nm(sc.away), W - pad * 0.6 - barH * 0.5, barY + barH * 0.9);
    const scoreT = (sc.hs !== '' && sc.hs != null ? sc.hs : '') + (sc.hs !== '' && sc.hs != null ? ' – ' : 'V') + (sc.as !== '' && sc.as != null ? sc.as : '');
    const s = A.fit(ctx, [[{ text: scoreT, colour: '#fff' }]], W * 0.42, barH * 0.62, { max: barH * 0.62 });
    A.lines(ctx, [[{ text: scoreT, colour: '#ffffff' }]], W / 2, barY + barH * 0.5 + s * 0.38, s, { align: 'center' });
    if (sc.label) A.pill(ctx, sc.label, W / 2, barY - W * 0.022, W * 0.024, P.accent, A.lum(P.accent) > 0.5 ? '#0b0d10' : '#ffffff', 'center');
  }
  const floor = (on(p, 'score') && sc.home ? barY - W * 0.06 : H - bottom - pad);
  let headTop = floor;
  const box = { x: pad, w: W - pad * 2, bottom: floor, maxH: (H - top - bottom) * 0.26, maxLines: 3 };
  if (on(p, 'cutouts')) cutouts(ctx, W, H, p, estimateTop(ctx, W, p, P, box) + W * 0.06, [{ x: 0.5, h: 0.6 }]);
  if (on(p, 'headline')) headTop = headlineBlock(ctx, W, p, P, box);
  if (p.sub && on(p, 'sub')) smallLine(ctx, p.sub, W / 2, H - bottom - pad * 0.3, W * 0.022, 'rgba(255,255,255,0.7)', 'center', 500);
  /* the bar says FINAL already: the kicker only where there is no score */
  if (on(p, 'kicker') && p.kicker && !(on(p, 'score') && sc.home)) kicker(ctx, p, P, W / 2, headTop - W * 0.075, W * 0.026, 'center');
  if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.7);
}

function drawStat(ctx, W, H, S, p, P) {
  const A = NA();
  const pad = W * 0.07, top = S.top, bottom = S.bottom;
  const hasPhoto = groundPhoto(ctx, W, H, p, P);
  if (!hasPhoto) { groundArt(ctx, W, H, p, P); }
  footShade(ctx, W, H, P, 0.3, hasPhoto ? 1 : 0.5);
  const st = p.stat || {};
  const floor = H - bottom - pad;
  let y = floor;
  if (on(p, 'headline') && p.headline) {
    y = headlineBlock(ctx, W, Object.assign({}, p, { headline: p.headline.replace(/\*/g, '') }), Object.assign({}, P, { accent: '#ffffff' }),
      { x: pad, w: W - pad * 2, bottom: floor, maxH: (H - top - bottom) * 0.12, maxLines: 2, align: 'left', maxSize: W * 0.06 }) - W * 0.05;
  }
  if (on(p, 'stat') && st.value) {
    const labelS = W * 0.07;
    A.lines(ctx, [[{ text: up(st.label || ''), colour: '#ffffff' }]], pad, y, labelS, { stretch: 'condensed' });
    const room = y - labelS * 1.05 - top - pad * 2.2;
    const ns = A.fit(ctx, [[{ text: String(st.value), colour: P.accent }]], W - pad * 2, room * 0.85, { max: W * 0.55 });
    const nb = y - labelS * 1.1;
    if (on(p, 'cutouts')) cutouts(ctx, W, H, p, nb + W * 0.04, [{ x: 0.68, h: 0.62 }]);
    A.lines(ctx, [[{ text: String(st.value), colour: P.accent }]], pad - ns * 0.03, nb, ns, { shadow: 'rgba(0,0,0,0.4)' });
    if (st.who) {
      const ws = W * 0.06;
      A.lines(ctx, [[{ text: up(st.who), colour: '#ffffff' }]], pad, nb - ns * 0.8 - ws * 0.3, ws, { stretch: 'condensed', weight: 800 });
      if (on(p, 'kicker') && p.kicker) kicker(ctx, p, P, pad, nb - ns * 0.8 - ws * 1.9, W * 0.024, 'left');
    } else if (on(p, 'kicker') && p.kicker) kicker(ctx, p, P, pad, nb - ns * 0.86 - W * 0.06, W * 0.024, 'left');
  }
  if (on(p, 'corners')) corners(ctx, W, H, P, bottom);
  if (on(p, 'brand')) brandMark(ctx, W, H, p, P, top, pad * 0.6);
}

function drawCover(ctx, W, H, S, p, P) {
  const A = NA();
  if (photoOf(p, 0)) { drawHeadline(ctx, W, H, S, Object.assign({}, p, { off: (p.off || []).concat(['corners']) }), P); return; }
  const f = Object.assign({}, p.facts || {}, { palette: P });
  /* the art in the band Instagram leaves clear (a story's), on its own ground edge to edge */
  A.ground(ctx, W, H, P, f.seed || 7, { dots: false });
  ctx.save(); ctx.translate(0, S.top);
  ctx.beginPath(); ctx.rect(0, 0, W, H - S.top - S.bottom); ctx.clip();
  A.drawArt(ctx, W, H - S.top - S.bottom, f, { clubs: (p.images && p.images.crests) || [], brand: p.images && p.images.brand }, { chrome: on(p, 'brand'), safeTop: 0.1 });
  ctx.restore();
}

const DRAW = { headline: drawHeadline, quote: drawQuote, report: drawReport, result: drawResult, stat: drawStat, cover: drawCover };

/* ONE POST onto a context at its size's full resolution (the context's own transform scales it) */
function draw(ctx, post, o) {
  const p = post || {};
  const opt = o || {};
  const S = SIZES[opt.size || p.size] || SIZES.portrait;
  const W = S.w, H = S.h;
  const P = pal(p);
  ctx.save();
  ctx.clearRect && ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  (DRAW[p.template] || drawHeadline)(ctx, W, H, S, Object.assign({}, p, { preview: !!opt.preview }), P);
  ctx.restore();
}
function canvas(post, o) {
  const opt = o || {};
  const S = SIZES[opt.size || post.size] || SIZES.portrait;
  const k = opt.scale || 1;
  const c = root.document.createElement('canvas');
  c.width = Math.round(S.w * k); c.height = Math.round(S.h * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  draw(ctx, post, opt);
  return c;
}
function png(post, o) {
  return new Promise((res, rej) => {
    try {
      const c = canvas(post, Object.assign({ scale: 1 }, o || {}));
      c.toBlob(b => (b ? res(b) : rej(new Error('the picture could not be made'))), 'image/png');
    } catch (e) { rej(e); }
  });
}
function filename(post, size) {
  const slug = String((post.article && post.article.title) || post.headline || 'post').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'post';
  return slug + '-' + (post.template || 'post') + '-' + (size || post.size || 'portrait') + '.png';
}

/* THE WORDS TO POST IT WITH: the headline as a sentence, the story's opening line, where to read it, and the tags (the
   league's, the clubs', the player's) */
function caption(post) {
  const p = post || {}, a = p.article || {};
  const out = [];
  const head = clean(String(p.headline || a.title || '').replace(/\*/g, '').replace(/\n/g, ' '));
  if (p.template === 'quote' && p.quote) {
    out.push('“' + clean(p.quote) + '”' + (p.who ? ' — ' + p.who.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : ''));
    if (a.title) out.push(clean(a.title));
  } else if (head) out.push(head.charAt(0) + head.slice(1));
  const lede = clean(a.summary).split(/(?<=[.!?])\s/)[0];
  if (lede && lede !== head) out.push(lede);
  if (a.url) out.push('Read it: ' + a.url);
  else if (a.brand && a.brand.name) out.push('via ' + a.brand.name);
  const tag = s => '#' + String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
  const tags = [];
  if (a.league && a.league.name) tags.push(tag(a.league.name));
  const f = p.facts || {};
  (f.clubs || []).forEach(c => { if (c && c.name) tags.push(tag(NA().clubWords(c).join(''))); });
  if (f.names && f.names[0]) tags.push(tag(f.names[0]));
  tags.push('#basketball');
  out.push([...new Set(tags.filter(t => t.length > 2))].join(' '));
  return out.join('\n\n');
}

return { SIZES, TEMPLATES, PIECES, ICONS, compose, draw, canvas, png, filename, caption, parseHeadline, parseRows, statusStyle };
}));
