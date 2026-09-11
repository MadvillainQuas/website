'use strict';
/* ============================================================================
   THE CLOCK CAM, ON A PHONE.

   Point the phone at the hall's scoreboard, draw a box round the clock digits (and the two
   scores if you like), and the phone reads them a few times a second and sends the real
   clock to every graphics layer on the game, over the same live channel the scoring app
   uses. The layers treat a camera reading as the authority for twenty seconds, tick between
   readings and slide to each correction.

   THE READER IS A SEVEN-SEGMENT DECODER, ON PURPOSE. A hall's scoreboard is LED digits on a
   dark board: the person has just told us exactly where they are, so the honest job is not
   general text recognition but "which segments are lit". Each glyph in the box is found by
   its columns, cut to its bounding box, and seven small regions are sampled (top, upper-left,
   upper-right, middle, lower-left, lower-right, bottom); the lit pattern names the digit. It
   runs at four frames a second on any phone with no model to download, and it is right on
   the boards it was built for. For a board it cannot read -- a dim one, a dot-matrix font --
   PC mode posts the boxed crop to the league's PC, where the scoreboard model reads it
   (scripts/worker/clock_cam.py --source phone).

   THE SAME PHYSICS AS THE PC READER: nothing is a clock until it runs down at the speed of
   time or repeats; a reading that jumps the clock forward is held until it repeats; running
   means it came down since the last reading.
   ======================================================================== */
(function () {
const CFG = window.EPINOIA_CONFIG || {};
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

let sb = null, user = null, gameId = (qp.get('g') || '').trim(), game = null;
let chan = null, joined = false, sending = false, sent = 0;
let boxes = { clock: null, home: null, away: null };     // fractions of the video frame
let drawing = null, dragFrom = null;
let period = 1, running = false, clockMs = null, prevMs = null, prevAt = 0, pendingUp = null, locked = false, provisional = null;
let scores = { home: null, away: null };
let lastDurable = 0, lastPost = 0;

/* ------------------------------------------------------------ session --- */
async function boot() {
  try { sb = await window.epinoiaClient(); } catch (_) { sb = null; }
  if (!sb) { $('#signedout').classList.remove('hide'); return; }
  const { data } = await sb.auth.getSession();
  if (!data || !data.session) { $('#signedout').classList.remove('hide'); return; }
  user = data.session.user;
  if (!gameId) { await pickGame(); return; }
  await openGame();
}

async function pickGame() {
  $('#pick').classList.remove('hide');
  const host = $('#games'); host.textContent = '';
  const from = new Date(Date.now() - 6 * 3600e3).toISOString(), to = new Date(Date.now() + 14 * 3600e3).toISOString();
  const { data } = await sb.from('games').select('id,tipoff_at,status,home:home_team_id(name),away:away_team_id(name)')
    .in('status', ['scheduled', 'live']).gte('tipoff_at', from).lte('tipoff_at', to).order('tipoff_at').limit(30);
  if (!data || !data.length) { host.appendChild(el('div', 'hint', 'No games on today. Open this page from a game’s page (the broadcast caret) to pick any fixture.')); return; }
  data.forEach(g => {
    const a = el('a', null, ((g.home || {}).name || 'home') + ' v ' + ((g.away || {}).name || 'away'));
    a.href = '?g=' + encodeURIComponent(g.id);
    a.appendChild(el('small', null, new Date(g.tipoff_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + (g.status === 'live' ? ' · live now' : '')));
    host.appendChild(a);
  });
}

async function openGame() {
  const { data: may } = await sb.rpc('may_broadcast_game', { p_game: gameId });
  if (may !== true) { $('#signedout').classList.remove('hide'); $('#signedout h2').textContent = 'Not your game'; $('#signedout .hint').textContent = 'This account may not broadcast this game. A league admin or a manager of either club can.'; return; }
  const { data } = await sb.from('games').select('id,period,status,home:home_team_id(name,short_name),away:away_team_id(name,short_name)').eq('id', gameId).maybeSingle();
  game = data;
  if (game && game.period) period = game.period;
  $('#ctx').textContent = 'clock cam · ' + (((game || {}).home || {}).short_name || 'home') + ' v ' + (((game || {}).away || {}).short_name || 'away');
  $('#app').classList.remove('hide');
  try { boxes = Object.assign(boxes, JSON.parse(localStorage.getItem('cc:' + gameId) || '{}')); } catch (_) {}
  await startCamera();
  wire();
  paintBoxes();
  setInterval(tick, 250);
  chan = sb.channel('game:' + gameId);
  chan.subscribe(st => { joined = (st === 'SUBSCRIBED'); paintStatus(); });
  /* a hello every five seconds while the app is open on this game, so the control room can
     say "phone connected" before the first reading and show the last one after */
  setInterval(() => {
    if (!chan || !joined) return;
    try { chan.send({ type: 'broadcast', event: 'frame', payload: { phone: true, hello: true, sending, reading: clockMs, period, running } }); } catch (_) {}
  }, 5000);
}

/* ------------------------------------------------------------ install --- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = $('#installBtn'); if (b) b.classList.remove('hide'); });
document.addEventListener('DOMContentLoaded', () => {
  const b = $('#installBtn');
  if (b) b.onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (_) {} installEvt = null; b.classList.add('hide'); };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) $('#iosHint').classList.remove('hide');
});

/* ------------------------------------------------------------- camera --- */
async function startCamera() {
  const v = $('#cam');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    v.srcObject = stream;
    await v.play();
  } catch (e) { $('#rSt').textContent = 'camera: ' + (e.message || 'not available'); }
}

/* -------------------------------------------------------------- boxes --- */
function stageRect() { return $('#stage').getBoundingClientRect(); }
function toFrac(e) {
  const r = stageRect();
  return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
}
function paintBoxes() {
  const c = $('#ov'), r = stageRect();
  c.width = Math.round(r.width * devicePixelRatio); c.height = Math.round(r.height * devicePixelRatio);
  const g = c.getContext('2d'); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, r.width, r.height);
  const colours = { clock: '#93f2bf', home: '#ffd166', away: '#8ff5ff' };
  Object.keys(boxes).forEach(k => {
    const b = boxes[k]; if (!b) return;
    g.strokeStyle = colours[k]; g.lineWidth = 2; g.setLineDash([]);
    g.strokeRect(b.x * r.width, b.y * r.height, b.w * r.width, b.h * r.height);
    g.fillStyle = colours[k]; g.font = '10px monospace'; g.fillText(k.toUpperCase(), b.x * r.width + 3, b.y * r.height - 4);
  });
  if (drawing && dragFrom && drawing.cur) {
    g.strokeStyle = colours[drawing.kind]; g.setLineDash([4, 3]);
    g.strokeRect(Math.min(dragFrom.x, drawing.cur.x) * r.width, Math.min(dragFrom.y, drawing.cur.y) * r.height,
                 Math.abs(drawing.cur.x - dragFrom.x) * r.width, Math.abs(drawing.cur.y - dragFrom.y) * r.height);
  }
}
function wire() {
  const stage = $('#stage');
  const arm = kind => { drawing = { kind, cur: null }; ['boxClock', 'boxHome', 'boxAway'].forEach(id => $('#' + id).classList.remove('on')); $('#box' + kind[0].toUpperCase() + kind.slice(1)).classList.add('on'); $('#boxHint').textContent = 'Now drag a rectangle round the ' + (kind === 'clock' ? 'clock digits' : kind + ' score digits') + '.'; };
  $('#boxClock').onclick = () => arm('clock');
  $('#boxHome').onclick = () => arm('home');
  $('#boxAway').onclick = () => arm('away');
  $('#boxClear').onclick = () => { boxes = { clock: null, home: null, away: null }; localStorage.removeItem('cc:' + gameId); locked = false; prevMs = null; paintBoxes(); };
  stage.addEventListener('pointerdown', e => { if (!drawing) return; dragFrom = toFrac(e); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drawing || !dragFrom) return; drawing.cur = toFrac(e); paintBoxes(); });
  const finish = e => {
    if (!drawing || !dragFrom) return;
    const to = toFrac(e);
    const b = { x: Math.min(dragFrom.x, to.x), y: Math.min(dragFrom.y, to.y), w: Math.abs(to.x - dragFrom.x), h: Math.abs(to.y - dragFrom.y) };
    if (b.w > 0.03 && b.h > 0.02) { boxes[drawing.kind] = b; localStorage.setItem('cc:' + gameId, JSON.stringify(boxes)); locked = false; prevMs = null; }
    ['boxClock', 'boxHome', 'boxAway'].forEach(id => $('#' + id).classList.remove('on'));
    $('#boxHint').textContent = 'Boxes are kept for this game on this phone. Re-draw one any time.';
    drawing = null; dragFrom = null; paintBoxes();
  };
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish);
  window.addEventListener('resize', paintBoxes);
  $('#go').onclick = () => { sending = !sending; $('#go').classList.toggle('on', sending); $('#go').textContent = sending ? 'sending — tap to stop' : 'connect & send'; paintStatus(); };
  $('#pDown').onclick = () => { period = Math.max(1, period - 1); publish(true); paintRead(); };
  $('#pUp').onclick = () => { period = Math.min(6, period + 1); prevMs = null; locked = false; publish(true); paintRead(); };
  $('#pcMode').onchange = () => { $('#pcHint').classList.toggle('hide', !$('#pcMode').checked); };
  $('#pcHint').classList.add('hide');
}

/* ------------------------------------------------------------ reading --- */
const work = document.createElement('canvas');
function cropOf(box, w) {
  const v = $('#cam'); if (!v.videoWidth || !box) return null;
  const sw = box.w * v.videoWidth, sh = box.h * v.videoHeight;
  const W = w || 240, H = Math.max(24, Math.round(W * sh / sw));
  work.width = W; work.height = H;
  const g = work.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, box.x * v.videoWidth, box.y * v.videoHeight, sw, sh, 0, 0, W, H);
  return g.getImageData(0, 0, W, H);
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
  const runs = []; let x = 0;
  while (x < W) {
    if (col[x] > 0) { let s = x; while (x < W && col[x] > 0) x++; runs.push([s, x]); } else x++;
  }
  return runs.map(([x0, x1]) => {
    let y0 = H, y1 = 0;
    for (let y = 0; y < H; y++) for (let xx = x0; xx < x1; xx++) if (bits[y * W + xx]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const ink = col.slice(x0, x1).reduce((a, v) => a + v, 0);
    return { x0, x1, y0, y1: y1 + 1, w: x1 - x0, h: y1 + 1 - y0, ink };
  }).filter(g => g.h > 0);
}
const SEG = { '1111110': 0, '0110000': 1, '1101101': 2, '1111001': 3, '0110011': 4, '1011011': 5, '1011111': 6, '1110000': 7, '1111111': 8, '1111011': 9, '1110010': 7 };
function segDigit(b, g, frameW) {
  const { W, H, bits } = b;
  /* A DIGIT IS READ IN A FULL-WIDTH FRAME. A 1, a 3 and a 7 have no left-hand segments, so
     their ink is narrower than the digit cell and sits at its right edge; sampling the seven
     regions over the ink alone puts the left regions on top of the bars and reads a 3 as an 8
     or a 1. The frame is the width of a full digit (the median tall glyph on the line),
     right-aligned on the ink when the ink is narrow. */
  const fw = Math.max(g.w, frameW || g.w);
  const x0 = g.w < fw * 0.85 ? g.x1 - fw : g.x0;
  const sample = (fx0, fy0, fx1, fy1) => {
    let n = 0, t = 0;
    for (let y = g.y0 + Math.floor(fy0 * g.h); y < g.y0 + Math.ceil(fy1 * g.h); y++)
      for (let x = Math.max(0, x0 + Math.floor(fx0 * fw)); x < Math.min(W, x0 + Math.ceil(fx1 * fw)); x++) { t++; n += bits[y * W + x]; }
    return t ? n / t : 0;
  };
  // a: top, b: upper right, c: lower right, d: bottom, e: lower left, f: upper left, g: middle
  const s = [sample(0.2, 0.0, 0.8, 0.16), sample(0.7, 0.12, 1.0, 0.45), sample(0.7, 0.55, 1.0, 0.88),
             sample(0.2, 0.84, 0.8, 1.0), sample(0.0, 0.55, 0.3, 0.88), sample(0.0, 0.12, 0.3, 0.45), sample(0.2, 0.42, 0.8, 0.58)];
  const key = s.map(v => v > 0.38 ? '1' : '0').join('');
  if (SEG[key] != null) return SEG[key];
  if (g.w < g.h * 0.3) return 1;                               // a bare stroke is a one whatever else it reads as
  return null;
}
function frameWidth(gs) {
  /* a digit cell is about half as wide as it is tall; a line of ones alone must not shrink it */
  const ws = gs.map(g => g.w).sort((a, b) => a - b), hs = gs.map(g => g.h).sort((a, b) => a - b);
  if (!ws.length) return 0;
  return Math.max(ws[Math.floor(ws.length / 2)], Math.round(0.5 * hs[Math.floor(hs.length / 2)]));
}
function readClock(b) {
  const gs = glyphs(b).filter(g => g.h >= b.H * 0.35);
  if (!gs.length) return null;
  const tall = gs.filter(g => g.h >= b.H * 0.5);
  // separators: short things between tall ones (a colon, a dot); digits: the tall ones
  const digits = []; let colonAt = -1, dotAt = -1;
  const fw = frameWidth(tall);
  gs.forEach(g => {
    if (g.h >= b.H * 0.5) { digits.push(segDigit(b, g, fw)); }
    else if (g.w < b.W * 0.08) { if (g.h > b.H * 0.25) colonAt = digits.length; else dotAt = digits.length; }
  });
  if (digits.some(d => d == null) || !digits.length) return null;
  if (colonAt > 0 && digits.length - colonAt === 2) {            // M:SS or MM:SS
    const m = +digits.slice(0, colonAt).join(''), s = +digits.slice(colonAt).join('');
    if (s > 59) return null;
    return (m * 60 + s) * 1000;
  }
  if (dotAt > 0 && digits.length - dotAt === 1) {                // SS.t under a minute
    const s = +digits.slice(0, dotAt).join(''), t = digits[dotAt];
    return s * 1000 + t * 100;
  }
  if (digits.length === 3 && colonAt < 0 && dotAt < 0) return (+digits.slice(0, 2).join('')) * 1000 + digits[2] * 100;   // "453" boards drop the dot
  if (digits.length === 4 && colonAt < 0) { const m = +digits.slice(0, 2).join(''), s = +digits.slice(2).join(''); return s <= 59 ? (m * 60 + s) * 1000 : null; }
  if (digits.length === 3 && colonAt < 0) { const m = digits[0], s = +digits.slice(1).join(''); return s <= 59 ? (m * 60 + s) * 1000 : null; }
  return null;
}
function readScore(b) {
  const gs = glyphs(b).filter(g => g.h >= b.H * 0.5);
  if (!gs.length || gs.length > 3) return null;
  const fw = frameWidth(gs);
  const ds = gs.map(g => segDigit(b, g, fw));
  return ds.some(d => d == null) ? null : +ds.join('');
}
function thumb(kind, b, text) {
  const host = $('#thumbs'); let wrap = host.querySelector('[data-k="' + kind + '"]');
  if (!wrap) { wrap = el('div'); wrap.dataset.k = kind; wrap.appendChild(el('canvas')); wrap.appendChild(el('span')); host.appendChild(wrap); }
  const c = wrap.querySelector('canvas'); c.width = b.W; c.height = b.H;
  const g = c.getContext('2d'); const im = g.createImageData(b.W, b.H);
  for (let i = 0; i < b.W * b.H; i++) { const v = b.bits[i] ? 255 : 0; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  wrap.querySelector('span').textContent = kind + ' · ' + (text == null ? '?' : text);
}
function fmt(ms) { if (ms == null) return '–:––'; const s = Math.ceil(ms / 1000); return ms < 60000 ? (ms / 1000).toFixed(1) : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function tick() {
  if (!boxes.clock) return;
  const inv = $('#invert').checked ? true : null, adj = +$('#thr').value || 0;
  const img = cropOf(boxes.clock); if (!img) return;
  const b = binarise(img, inv, adj);
  if ($('#pcMode').checked) { postCrop(); thumb('clock', b, 'to the PC'); return; }
  const ms = readClock(b);
  thumb('clock', b, ms == null ? null : fmt(ms));
  const now = Date.now();
  if (ms != null) {
    if (!locked) {
      const runs = provisional && provisional.ms > ms && Math.abs((provisional.ms - ms) / 1000 - (now - provisional.at) / 1000) <= 2.5;
      const same = provisional && provisional.ms === ms && now - provisional.at > 1200;
      if (runs || same) { locked = true; } else { provisional = { ms, at: now }; paintRead(); return; }
    }
    if (prevMs != null && prevMs + 300 < ms && ms < prevMs + 60000) {
      if (pendingUp != null && Math.abs(pendingUp - ms) <= 1500) { pendingUp = null; }
      else { pendingUp = ms; return; }
    }
    pendingUp = null;
    if (prevMs != null) {
      const dt = (now - prevAt) / 1000, down = (prevMs - ms) / 1000;
      if (down > 0.2 && Math.abs(down - dt) <= Math.max(1.0, 0.6 * dt)) running = true;
      else if (ms === prevMs && now - prevAt > 1600) running = false;
      else if (ms > prevMs + 1500) running = false;
    }
    if (ms !== prevMs) { prevAt = now; }
    prevMs = ms; clockMs = ms;
    publish(false);
  }
  if ($('#sendScore').checked) {
    ['home', 'away'].forEach(k => { if (!boxes[k]) return; const im = cropOf(boxes[k], 120); if (!im) return; const bb = binarise(im, inv, adj); const v = readScore(bb); thumb(k, bb, v); if (v != null) scores[k] = v; });
  }
  paintRead();
}

/* ------------------------------------------------------------ sending --- */
let lastSentMs = null, lastSentAt = 0;
function publish(force) {
  if (!sending || !chan || !joined || clockMs == null) return;
  const now = Date.now();
  if (!force && clockMs === lastSentMs && now - lastSentAt < 1500) return;
  const state = { game_id: gameId, period, clock_ms: Math.round(clockMs), running, updated_at: new Date(now).toISOString(), source: 'cam' };
  if ($('#sendScore').checked && scores.home != null && scores.away != null) { state.score_home = scores.home; state.score_away = scores.away; }
  try { chan.send({ type: 'broadcast', event: 'frame', payload: { cam: true, phone: true, sending: true, state } }); sent++; lastSentMs = clockMs; lastSentAt = now; } catch (_) {}
  paintStatus();
}
async function postCrop() {
  if (!sending || !sb || !boxes.clock) return;
  const now = Date.now(); if (now - lastPost < 400) return; lastPost = now;
  const v = $('#cam'); const b = boxes.clock;
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.max(40, Math.round(320 * (b.h * v.videoHeight) / (b.w * v.videoWidth)));
  c.getContext('2d').drawImage(v, b.x * v.videoWidth, b.y * v.videoHeight, b.w * v.videoWidth, b.h * v.videoHeight, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.7);
  try { await sb.from('cam_frames').upsert({ game_id: gameId, taken_at: new Date(now).toISOString(), crop: url, kind: 'clock', posted_by: user.id }, { onConflict: 'game_id' }); sent++; } catch (_) {}
  paintStatus();
}
function paintRead() {
  $('#rPer').textContent = 'P' + period;
  const c = $('#rClk'); c.textContent = fmt(clockMs != null ? clockMs : (provisional ? provisional.ms : null)); c.classList.toggle('run', running);
  $('#rSc').textContent = ($('#sendScore').checked && scores.home != null && scores.away != null) ? scores.home + ' – ' + scores.away : '';
}
function paintStatus() {
  $('#rSt').textContent = (joined ? 'live channel connected' : 'connecting…') + ' · ' + (sending ? ($('#pcMode').checked ? 'posting crops to the PC' : 'sending readings') : 'not sending') + (sent ? ' · ' + sent + ' sent' : '') + (locked ? '' : ' · waiting for the clock to run');
}

window.__clockcam = { binarise, glyphs, readClock, readScore, segDigit };
document.addEventListener('DOMContentLoaded', boot);
}());
