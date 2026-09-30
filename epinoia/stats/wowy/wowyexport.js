'use strict';
/* ============================================================================
   THE WOWY IMAGE — a unit or a pair as a PNG in the house style (the same drawing kit as the social cards and
   the report sheet: reportcard.js util, so the faces, the colours and the crest rules are one set).

     EpinoiaWowyExport.unit(spec)  -> Promise<Blob>   five circles, the net rating, eight stats in their heat colours
     EpinoiaWowyExport.pair(spec)  -> Promise<Blob>   two circles, the four ways they shared the floor
     EpinoiaWowyExport.save(blob, name)

   spec.players: [{ name, jersey, photo, colour, crest, ring: 'on' | 'off' }] (photo and crest are URLs, read
   only if the browser lets the canvas stay saveable; initials on the club's colour stand in otherwise).
   Nothing is drawn that the page does not show, and nothing is drawn from a number the engine does not have.
   ============================================================================ */
(function (root) {
const W = root.EpinoiaWowyLogic;
const RC = () => root.EpinoiaReportCard;

const SIZE = { w: 1200, h: 630 };

function theme(U, RCm) {
  const light = root.document && root.document.documentElement.getAttribute('data-theme') === 'light';
  return light ? RCm.THEMES.light : RCm.THEMES.dark;
}

async function readImg(url) {
  if (!url) return null;
  try { return await RC().util.readableCrest(url); } catch (_) { return null; }
}

/* one player: disc (photo, or initials on the club colour), ring for on/off, crest on the edge, number, name */
function drawPlayer(ctx, U, th, p, cx, cy, r, o) {
  const col = U.rgb(p.colour) ? p.colour : th.lume;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  ctx.clip();
  if (p.photoImg && p.photoImg.width) {
    const iw = p.photoImg.naturalWidth || p.photoImg.width, ih = p.photoImg.naturalHeight || p.photoImg.height;
    const s = Math.max(2 * r / iw, 2 * r / ih);
    ctx.drawImage(p.photoImg, cx - iw * s / 2, cy - ih * s / 2 + r * 0.1, iw * s, ih * s);
  } else {
    U.font(ctx, r * 0.78, U.F.score); ctx.textAlign = 'center'; ctx.fillStyle = U.lum(col) > 0.4 ? '#04100b' : '#ffffff';
    ctx.fillText(W.initialsOf(p.name), cx, cy + r * 0.27); ctx.textAlign = 'left';
  }
  ctx.restore();
  /* the ring: green on the floor, red off it */
  if (p.ring) {
    ctx.save(); ctx.lineWidth = Math.max(4, r * 0.09); ctx.strokeStyle = p.ring === 'on' ? th.good : th.bad;
    ctx.beginPath(); ctx.arc(cx, cy, r + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (p.crestImg && p.crestImg.width) {
    const cr = r * 0.34, ex = cx + r * 0.72, ey = cy + r * 0.72;
    ctx.save(); ctx.beginPath(); ctx.arc(ex, ey, cr, 0, Math.PI * 2); ctx.fillStyle = U.crestGround(p.crestImg, th); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = th.ground; ctx.stroke(); ctx.clip();
    const iw = p.crestImg.naturalWidth || p.crestImg.width, ih = p.crestImg.naturalHeight || p.crestImg.height, s = Math.min(1.5 * cr / iw, 1.5 * cr / ih);
    ctx.drawImage(p.crestImg, ex - iw * s / 2, ey - ih * s / 2, iw * s, ih * s); ctx.restore();
  }
  if (p.jersey && o.num !== false) {
    const nr = Math.max(10, r * 0.24), nx = cx - r * 0.72, ny = cy - r * 0.72;
    ctx.save(); ctx.beginPath(); ctx.arc(nx, ny, nr, 0, Math.PI * 2); ctx.fillStyle = '#0a0a0a'; ctx.fill();
    U.font(ctx, nr * 1.05, U.F.score); ctx.textAlign = 'center'; ctx.fillStyle = '#ffe14d'; ctx.fillText(String(p.jersey).slice(0, 2), nx, ny + nr * 0.36); ctx.restore();
  }
  if (o.name) {
    ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = th.ink;
    U.fit(ctx, o.name, r * 2.3, Math.round(r * 0.32), 12, U.F.ui, '700');
    ctx.fillText(U.ellipsis(ctx, o.name, r * 2.3), cx, cy + r + r * 0.5 + 6); ctx.restore();
  }
}

function tintFill(ctx, th, t) {
  if (t == null) return null;
  const a = Math.min(1, Math.abs(t)) * 0.4;
  return a < 0.03 ? null : RC().util.rgba(t > 0 ? th.good : th.bad, a);
}

function frame(ctx, U, th, spec, kicker) {
  ctx.fillStyle = th.ground; ctx.fillRect(0, 0, SIZE.w, SIZE.h);
  const col = U.rgb(spec.colour) ? spec.colour : th.lume;
  ctx.fillStyle = col; ctx.fillRect(0, 0, SIZE.w, 14);
  ctx.fillStyle = th.panel; ctx.fillRect(0, SIZE.h - 62, SIZE.w, 62);
  ctx.fillStyle = th.rule; ctx.fillRect(0, SIZE.h - 62, SIZE.w, 2);
  U.font(ctx, 20, U.F.micro); ctx.fillStyle = U.accentOn(col, th); ctx.fillText(String(kicker || '').toUpperCase().slice(0, 70), 48, 58);
  U.font(ctx, 24, U.F.mark); ctx.fillStyle = th.ink; ctx.fillText('EPINOIΛ', 48, SIZE.h - 22);
  U.font(ctx, 15, U.F.micro); ctx.fillStyle = th.ink3; ctx.textAlign = 'right';
  ctx.fillText((spec.foot || 'prophesyscouting.co.uk/epinoia').toUpperCase(), SIZE.w - 48, SIZE.h - 24); ctx.textAlign = 'left';
}

async function prepare(spec) {
  const list = spec.players || [];
  await Promise.all(list.map(async p => {
    [p.photoImg, p.crestImg] = await Promise.all([readImg(p.photo), readImg(p.crest)]);
  }));
}

async function newCanvas() {
  const U = RC().util;
  await U.fontsReady();
  const c = root.document.createElement('canvas'); c.width = SIZE.w * 2; c.height = SIZE.h * 2;
  const ctx = c.getContext('2d'); ctx.scale(2, 2);
  return { c, ctx, U, th: theme(U, RC()) };
}

/* ---------------------------------------------------------------- unit --- */
async function unit(spec) {
  const { c, ctx, U, th } = await newCanvas();
  await prepare(spec);
  frame(ctx, U, th, spec, spec.kicker);
  U.font(ctx, 46, U.F.score); ctx.fillStyle = th.ink; ctx.fillText(String(spec.title || 'LINEUP').toUpperCase(), 48, 112);
  U.font(ctx, 18, U.F.ui, '600'); ctx.fillStyle = th.ink2; ctx.fillText(U.ellipsis(ctx, spec.sub || '', 700), 48, 142);
  /* the circles */
  const n = spec.players.length, r = n > 3 ? 62 : 74, gap = r * 2 + 44;
  const x0 = 48 + r + 6;
  spec.players.forEach((p, i) => drawPlayer(ctx, U, th, p, x0 + i * gap, 268, r, { name: W.surname(p.name) }));
  /* the net, big, in its heat colour */
  const line = spec.line || {};
  const bx = 800, by = 168, bw = 352, bh = 190;
  const netTone = spec.tones && spec.tones.net;
  ctx.fillStyle = th.panel2; U.roundRect(ctx, bx, by, bw, bh, 10); ctx.fill();
  const tf = tintFill(ctx, th, netTone); if (tf) { ctx.fillStyle = tf; U.roundRect(ctx, bx, by, bw, bh, 10); ctx.fill(); }
  ctx.strokeStyle = th.rule2; ctx.lineWidth = 2; U.roundRect(ctx, bx, by, bw, bh, 10); ctx.stroke();
  U.font(ctx, 16, U.F.micro); ctx.fillStyle = th.ink2; ctx.textAlign = 'center'; ctx.fillText('NET RATING PER 100', bx + bw / 2, by + 40);
  U.font(ctx, 96, U.F.score); ctx.fillStyle = line.net > 0 ? th.good : line.net < 0 ? th.bad : th.ink; ctx.fillText(W.fmt('net', line.net), bx + bw / 2, by + 132);
  U.font(ctx, 15, U.F.micro); ctx.fillStyle = th.ink3;
  ctx.fillText(W.fmt('mins', line.mins) + ' MIN · ' + W.fmt('poss', line.poss) + ' POSS · ' + (line.stints || 0) + ' STINTS', bx + bw / 2, by + 168); ctx.textAlign = 'left';
  /* eight stats, each in its heat colour, laid out as tiles */
  const keys = spec.keys || ['ortg', 'drtg', 'pace', 'efg', 'tov', 'oreb', 'ftr', 'ts'];
  const tw = (SIZE.w - 96 - 7 * 14) / 8, ty = 402, th2 = 110;
  keys.slice(0, 8).forEach((k, i) => {
    const col = W.col(k), x = 48 + i * (tw + 14);
    ctx.fillStyle = th.panel; U.roundRect(ctx, x, ty, tw, th2, 8); ctx.fill();
    const t = spec.tones && spec.tones[k]; const f = tintFill(ctx, th, t); if (f) { ctx.fillStyle = f; U.roundRect(ctx, x, ty, tw, th2, 8); ctx.fill(); }
    ctx.strokeStyle = th.rule; ctx.lineWidth = 1.5; U.roundRect(ctx, x, ty, tw, th2, 8); ctx.stroke();
    ctx.textAlign = 'center'; U.font(ctx, 13, U.F.micro); ctx.fillStyle = th.ink2; ctx.fillText(col.label, x + tw / 2, ty + 30);
    U.fit(ctx, W.fmt(k, line[k]), tw - 12, 40, 20, U.F.score); ctx.fillStyle = th.ink; ctx.fillText(W.fmt(k, line[k]), x + tw / 2, ty + 74);
    if (t != null && Math.abs(t) >= 0.6) { U.font(ctx, 14, U.F.ui); ctx.fillStyle = t > 0 ? th.good : th.bad; ctx.fillText(t > 0 ? '▲' : '▼', x + tw / 2, ty + 98); }
    ctx.textAlign = 'left';
  });
  U.font(ctx, 14, U.F.ui); ctx.fillStyle = th.ink3;
  ctx.fillText(U.ellipsis(ctx, spec.note || '', SIZE.w - 96), 48, 548);
  if (spec.small) {
    U.font(ctx, 14, U.F.micro); ctx.fillStyle = th.mid || '#ffd166'; ctx.fillText('SMALL SAMPLE: READ WITH CARE', 48, 574);
  }
  return U.blobOf(c, 'image/png');
}

/* ---------------------------------------------------------------- pair --- */
async function pair(spec) {
  const { c, ctx, U, th } = await newCanvas();
  await prepare(spec);
  frame(ctx, U, th, spec, spec.kicker);
  U.font(ctx, 46, U.F.score); ctx.fillStyle = th.ink; ctx.fillText('WITH OR WITHOUT', 48, 112);
  U.font(ctx, 18, U.F.ui, '600'); ctx.fillStyle = th.ink2; ctx.fillText(U.ellipsis(ctx, spec.sub || '', 900), 48, 142);
  const cw = (SIZE.w - 96 - 3 * 18) / 4;
  (spec.buckets || []).slice(0, 4).forEach((b, i) => {
    const x = 48 + i * (cw + 18), y = 176, h = 350;
    ctx.fillStyle = th.panel2; U.roundRect(ctx, x, y, cw, h, 10); ctx.fill();
    const tf = tintFill(ctx, th, b.tone); if (tf) { ctx.fillStyle = tf; U.roundRect(ctx, x, y, cw, h, 10); ctx.fill(); }
    ctx.strokeStyle = th.rule2; ctx.lineWidth = 2; U.roundRect(ctx, x, y, cw, h, 10); ctx.stroke();
    const r = 40;
    drawPlayer(ctx, U, th, Object.assign({}, spec.players[0], { ring: b.a ? 'on' : 'off' }), x + cw / 2 - r - 10, y + 68, r, { num: false });
    drawPlayer(ctx, U, th, Object.assign({}, spec.players[1], { ring: b.b ? 'on' : 'off' }), x + cw / 2 + r + 10, y + 68, r, { num: false });
    ctx.textAlign = 'center';
    U.fit(ctx, b.label, cw - 24, 20, 12, U.F.ui, '700'); ctx.fillStyle = th.ink; ctx.fillText(b.label, x + cw / 2, y + 160);
    const has = b.line && b.line.stints;
    U.font(ctx, 78, U.F.score); ctx.fillStyle = !has ? th.ink3 : b.line.net > 0 ? th.good : b.line.net < 0 ? th.bad : th.ink;
    ctx.fillText(has ? W.fmt('net', b.line.net) : '—', x + cw / 2, y + 240);
    U.font(ctx, 13, U.F.micro); ctx.fillStyle = th.ink2; ctx.fillText('NET PER 100', x + cw / 2, y + 264);
    U.font(ctx, 15, U.F.micro); ctx.fillStyle = th.ink3;
    ctx.fillText(has ? W.fmt('mins', b.line.mins) + ' MIN · ' + W.fmt('poss', b.line.poss) + ' POSS' : 'NEVER HAPPENED', x + cw / 2, y + 298);
    if (has) ctx.fillText('ORTG ' + W.fmt('ortg', b.line.ortg) + ' · DRTG ' + W.fmt('drtg', b.line.drtg), x + cw / 2, y + 322);
    if (b.small) { U.font(ctx, 12, U.F.micro); ctx.fillStyle = th.mid || '#ffd166'; ctx.fillText('SMALL SAMPLE', x + cw / 2, y + h - 12); }
    ctx.textAlign = 'left';
  });
  if (spec.swing != null) { U.font(ctx, 16, U.F.ui, '600'); ctx.fillStyle = th.ink2; ctx.fillText(U.ellipsis(ctx, spec.swingText || '', SIZE.w - 96), 48, 552); }
  return U.blobOf(c, 'image/png');
}

function save(blob, name) {
  const url = root.URL.createObjectURL(blob);
  const a = root.document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  root.document.body.appendChild(a); a.click();
  setTimeout(() => { root.URL.revokeObjectURL(url); a.remove(); }, 4000);
}

root.EpinoiaWowyExport = { unit, pair, save, SIZE };
})(typeof window !== 'undefined' ? window : globalThis);
