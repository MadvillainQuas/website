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
/* THE DECODER LIVES IN decode.js, and the test renders scoreboards at it.

   These six functions are pure arithmetic over a crop, which makes them the one
   part of the clock cam that can be measured rather than eyeballed: see
   supabase/tests/clockcam.decode.test.mjs. Pulling them out of this file is what
   lets the browser and the bench run the SAME code instead of two copies that
   drift apart the first time one of them is fixed. */
const { binarise, glyphs, segDigit, frameWidth, readClock, readScore } = window.CCDecode;

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
