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
let boxes = { clock: null, home: null, away: null, period: null };   // fractions of the video frame
let drawing = null, dragFrom = null;
let period = 1, running = false, clockMs = null, locked = false;
/* the physics -- what a clock is allowed to do between two frames -- lives in
   clock.js, where a test can run a whole bad quarter through it. See the note at
   the top of that file for why a jump DOWN is as suspect as a jump up. */
const CLK = window.CCClock.makeClock();
let scores = { home: null, away: null };
let lastDurable = 0, lastPost = 0;
let camTrack = null, camFail = '', wake = null, grab = 0;

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
  setInterval(tick, 125);          // captured at 8/s, read at 4/s -- see RING
  chan = sb.channel('game:' + gameId);
  chan.on('broadcast', { event: 'frame' }, m => onFrame(m && m.payload));
  chan.subscribe(st => { joined = (st === 'SUBSCRIBED'); paintStatus(); });
  setInterval(hello, 5000);
  hello();
}

/* ------------------------------------------------------------- telemetry ---
   A hello every five seconds while the app is open on this game, so the control
   room can say "phone connected" before the first reading and show the last one
   after. It carries a PICTURE of what the phone is looking at, because the one
   thing the person in the control room cannot otherwise know is whether the box
   at the table is on the right digits -- and a box that is slightly off does not
   announce itself, it just reads less often and refuses more. A hundred and sixty
   pixels wide at middling quality is two or three kilobytes; every five seconds
   that is nothing next to the readings themselves. */
function peek() {
  try {
    const v = $('#cam'); if (!v.videoWidth || !boxes.clock) return null;
    const m = boxToVideo(boxes.clock); if (!m || m.sw < 2 || m.sh < 2) return null;
    const c = document.createElement('canvas');
    c.width = 160; c.height = Math.max(20, Math.min(120, Math.round(160 * m.sh / m.sw)));
    c.getContext('2d').drawImage(v, m.sx, m.sy, m.sw, m.sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.5);
  } catch (_) { return null; }
}
function hello() {
  if (!chan || !joined) return;
  const st = CLK.stats;
  try {
    chan.send({ type: 'broadcast', event: 'frame', payload: {
      phone: true, hello: true, sending,
      reading: clockMs, period, running, locked,
      health: {
        cam: camLive() ? 'live' : (camFail || 'no camera'),
        awake: !!wake, hidden: !!document.hidden, sent,
        refused: st.reads ? Math.round(100 * st.refused / st.reads) : 0,
        hunting: !!hunt, nudged,
        boxes: Object.keys(boxes).filter(k => boxes[k]).join(',')
      },
      shot: peek()
    } });
  } catch (_) {}
}

/* ---------------------------------------------------------- being driven ---
   The control room knows which period it is -- from the scorer, or the feed, or
   the person sitting in it -- and the phone at the table often does not. Rather
   than making somebody walk over, the control room can set it from there. Nothing
   else is accepted: the clock itself is the camera's to read. */
function onFrame(f) {
  if (!f || f.phone) return;
  const cmd = f.phoneCmd;
  if (!cmd) return;
  if (cmd.period != null) {
    const p = Math.max(1, Math.min(6, cmd.period | 0));
    if (p !== period) { period = p; resetLock(); paintRead(); }
    $('#boxHint').textContent = 'The control room set this to period ' + p + '.';
    publish(true);
  }
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
    const stream = await navigator.mediaDevices.getUserMedia({
      /* 15fps rather than whatever the phone fancies: the reader looks four times
         a second, and a camera running at 60 for ninety minutes is a warm phone
         with a flat battery by the third quarter. */
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 15, max: 30 } },
      audio: false
    });
    v.srcObject = stream;
    camTrack = stream.getVideoTracks()[0] || null;
    camFail = '';
    await v.play();
    /* KEEP THE CAMERA HONEST ABOUT A SCOREBOARD. Left alone a phone hunts: it
       refocuses on the crowd between the phone and the board, and it meters for
       the dark hall, which blows the LED digits into one white blob. Asking for
       continuous focus and exposure is the most any browser will allow, and on
       the phones that allow it, it is the difference between a board that reads
       and one that does not. Every one of these is optional -- ask for what the
       track says it can do and never for anything else. */
    if (camTrack && camTrack.getCapabilities) {
      try {
        const caps = camTrack.getCapabilities() || {}, adv = [];
        const wants = { focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous' };
        Object.keys(wants).forEach(k => { const c = caps[k]; if (c && c.indexOf && c.indexOf(wants[k]) >= 0) adv.push({ [k]: wants[k] }); });
        if (adv.length) await camTrack.applyConstraints({ advanced: adv });
      } catch (_) { /* the picture is fine without it */ }
    }
    /* a camera can be taken away mid-game -- a call comes in, another app grabs
       it, iOS suspends the tab. Losing it silently is the failure nobody notices
       until the clock has been frozen for a quarter. */
    if (camTrack) camTrack.addEventListener('ended', () => { camTrack = null; camFail = 'the camera stopped'; paintStatus(); });
  } catch (e) {
    camTrack = null; camFail = 'camera: ' + (e.message || 'not available');
    $('#rSt').textContent = camFail;
  }
}

/* the camera is live if we hold a track that is neither ended nor muted AND the
   video element is actually delivering pixels */
function camLive() {
  const v = $('#cam');
  /* MUTED IS NOT THE SAME AS ENDED, and this said it checked both while checking
     one. When iOS suspends a backgrounded tab's camera the track stays 'live' and
     goes muted: no new pixels arrive, the last frame sits there, and every check
     here said the camera was fine. That is the exact state the reader must not
     read in, because a frozen frame agrees with itself forever. */
  return !!(camTrack && camTrack.readyState === 'live' && !camTrack.muted && v && v.videoWidth > 0);
}
async function ensureCamera() {
  if (camLive()) return;
  await startCamera();
  paintStatus();
}

/* ---------------------------------------------------------- stay awake ---
   A phone locks its screen after thirty seconds of nobody touching it, and a
   locked screen is a stopped camera. Without this the clock cam works until the
   person puts the phone down, which is the moment they were always going to put
   it down -- it is on a clamp pointing at a scoreboard. */
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) { const w = wake; wake = null; await w.release(); }
  } catch (_) { wake = null; }
}

/* WHEN THE PAGE IS HIDDEN THE PICTURE FREEZES BUT THE READER DOES NOT.
   Every quarter-second it would read the same frozen frame again, agree with
   itself, and publish a clock that stopped when the person switched apps -- and
   the layers would take it, because a camera reading is the authority. So
   reading stops with the page, and the camera and the lock are both taken back
   when it returns. */
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  await ensureCamera();
  if (sending) keepAwake(true);
});

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
  const colours = { clock: '#93f2bf', home: '#ffd166', away: '#8ff5ff', period: '#d0a0ff' };
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
  const BOXIDS = ['boxClock', 'boxHome', 'boxAway', 'boxPeriod'];
  const arm = kind => { drawing = { kind, cur: null }; BOXIDS.forEach(id => $('#' + id).classList.remove('on')); $('#box' + kind[0].toUpperCase() + kind.slice(1)).classList.add('on'); $('#boxHint').textContent = 'Now drag a rectangle round the ' + (kind === 'clock' ? 'clock digits' : kind === 'period' ? 'period number' : kind + ' score digits') + '.'; };
  $('#boxClock').onclick = () => arm('clock');
  $('#boxHome').onclick = () => arm('home');
  $('#boxAway').onclick = () => arm('away');
  $('#boxPeriod').onclick = () => arm('period');
  $('#boxClear').onclick = () => { boxes = { clock: null, home: null, away: null, period: null }; localStorage.removeItem('cc:' + gameId); resetLock(); paintBoxes(); };
  stage.addEventListener('pointerdown', e => { if (!drawing) return; dragFrom = toFrac(e); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drawing || !dragFrom) return; drawing.cur = toFrac(e); paintBoxes(); });
  const finish = e => {
    if (!drawing || !dragFrom) return;
    const to = toFrac(e);
    const b = { x: Math.min(dragFrom.x, to.x), y: Math.min(dragFrom.y, to.y), w: Math.abs(to.x - dragFrom.x), h: Math.abs(to.y - dragFrom.y) };
    if (b.w > 0.03 && b.h > 0.02) { boxes[drawing.kind] = b; localStorage.setItem('cc:' + gameId, JSON.stringify(boxes)); resetLock(); }
    BOXIDS.forEach(id => $('#' + id).classList.remove('on'));
    $('#boxHint').textContent = 'Boxes are kept for this game on this phone. Re-draw one any time.';
    drawing = null; dragFrom = null; paintBoxes();
  };
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish);
  window.addEventListener('resize', paintBoxes);
  $('#go').onclick = () => { sending = !sending; $('#go').classList.toggle('on', sending); $('#go').textContent = sending ? 'sending — tap to stop' : 'connect & send'; keepAwake(sending); if (sending) ensureCamera(); paintStatus(); };
  $('#pDown').onclick = () => { period = Math.max(1, period - 1); publish(true); paintRead(); };
  $('#pUp').onclick = () => { period = Math.min(6, period + 1); resetLock(); publish(true); paintRead(); };
  $('#pcMode').onchange = () => { $('#pcHint').classList.toggle('hide', !$('#pcMode').checked); };
  $('#pcHint').classList.add('hide');
}

/* ------------------------------------------------------------ reading --- */
const work = document.createElement('canvas');

/* THE BOX IS DRAWN ON THE PICTURE, NOT ON THE VIDEO.

   The stage shows the camera with object-fit: cover, which scales the frame to
   fill the box and throws away the overhang. So a rectangle at the middle of the
   stage is only the middle of the VIDEO when the two have the same shape. The
   stage is 4:3 and the camera is ASKED for 4:3, but "ideal" is a request, not a
   promise: plenty of phones hand back 1280x720 regardless, and on those every
   box was being read from the wrong part of the frame -- shifted and squashed,
   with no clue on screen that anything was wrong, because the overlay is drawn
   on the stage where the person put it.

   So the cover mapping is done properly: work out how the browser fitted the
   frame, then take the box back through that fit into video pixels. */
function boxToVideo(box) {
  const v = $('#cam'), r = stageRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh || !r.width || !r.height || !box) return null;
  const k = Math.max(r.width / vw, r.height / vh);
  const offX = (r.width - vw * k) / 2, offY = (r.height - vh * k) / 2;
  return {
    sx: (box.x * r.width - offX) / k, sy: (box.y * r.height - offY) / k,
    sw: (box.w * r.width) / k, sh: (box.h * r.height) / k
  };
}
function cropOf(box, w) {
  const v = $('#cam'); if (!v.videoWidth || !box) return null;
  const m = boxToVideo(box); if (!m || m.sw < 2 || m.sh < 2) return null;
  const W = w || 240, H = Math.max(24, Math.round(W * m.sh / m.sw));
  work.width = W; work.height = H;
  const g = work.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, m.sx, m.sy, m.sw, m.sh, 0, 0, W, H);
  return g.getImageData(0, 0, W, H);
}
/* THE DECODER LIVES IN decode.js, and the test renders scoreboards at it.

   These six functions are pure arithmetic over a crop, which makes them the one
   part of the clock cam that can be measured rather than eyeballed: see
   supabase/tests/clockcam.decode.test.mjs. Pulling them out of this file is what
   lets the browser and the bench run the SAME code instead of two copies that
   drift apart the first time one of them is fixed. */
const { binarise, stack, glyphs, segDigit, frameWidth, readClock, readScore } = window.CCDecode;

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

function resetLock() { CLK.reset(); locked = false; ring = []; hunt = null; lastReadAt = 0; }

/* the last few crops, so the reader can average across a board's flicker -- see
   stack() in decode.js for why that is the difference between a board that reads
   and one that does not */
const RING = 3;
let ring = [];
let lastReadAt = 0, hunt = null, nudged = 0, boxPending = false;

/* ------------------------------------------------------- when it is nudged ---
   A phone on a clamp for two hours gets knocked: somebody leans on the table, a
   ball hits the stanchion, the clamp creeps. The board is still in shot, but the
   box is no longer on the digits -- and nothing announces that. The readings
   simply stop, the graphics go on ticking from the last clock they were given,
   and the first anyone knows is that the clock on the stream has drifted away
   from the one in the hall.

   So when nothing has been read for a few seconds, the box goes looking. The
   offsets are tried nearest-first, because a knock moves a phone a little; a
   whole sweep takes about a second, and it repeats until it finds the digits or
   somebody redraws the box by hand.

   A FOUND READING HAS TO AGREE WITH THE CLOCK WE ALREADY HAD. Otherwise hunting
   is a licence to wander: some offset somewhere will eventually read SOMETHING --
   the shot clock, the period, half of two digits -- and the box would move there
   and then have to be found again from further away. Matching the clock we last
   believed is what makes this recovery rather than a search. */
const HUNT_OFFSETS = (() => {
  const step = [-0.06, -0.03, 0, 0.03, 0.06], out = [];
  for (const dx of step) for (const dy of step) if (dx || dy) out.push({ dx, dy });
  out.sort((a, b) => (a.dx * a.dx + a.dy * a.dy) - (b.dx * b.dx + b.dy * b.dy));
  return out;
})();
function shifted(box, o) {
  return { x: Math.max(0, Math.min(1 - box.w, box.x + o.dx)), y: Math.max(0, Math.min(1 - box.h, box.y + o.dy)), w: box.w, h: box.h };
}
function tryHunt(inv, adj, now) {
  if (!boxes.clock) return;
  const pred = CLK.predict(now);
  /* WITHOUT A CLOCK TO CHECK AGAINST, HUNTING IS NOT RECOVERY, IT IS A SEARCH.
     Some offset somewhere always reads SOMETHING -- the shot clock, the period,
     the halves of two digits -- and with nothing to compare it to the box moves
     there and is lost from further away than it started. So the box only ever
     goes looking when we still know roughly what the clock should say. If even
     that has been forgotten, the right answer is to re-acquire where we are. */
  if (pred == null) { hunt = null; return; }
  if (!hunt) hunt = { i: 0 };
  for (let n = 0; n < 6 && hunt.i < HUNT_OFFSETS.length; n++) {
    const o = HUNT_OFFSETS[hunt.i++];
    const box = shifted(boxes.clock, o);
    const img = cropOf(box); if (!img) continue;
    const got = readClock(binarise(img, inv, adj), pred);
    if (got == null) continue;
    if (pred != null && Math.abs(got - pred) > 30000) continue;   // not our clock
    /* Moved, but not written down yet: one reading is not proof the box is right,
       and a box saved to this phone is what it will open on next time. It is kept
       once the clock has locked on at the new place, which is proof. */
    boxes.clock = box; boxPending = true;
    ring = []; hunt = null; lastReadAt = now; nudged++;
    paintBoxes();
    $('#boxHint').textContent = 'The board had moved in the frame \u2014 the box has been nudged back onto the digits.';
    return;
  }
  if (hunt.i >= HUNT_OFFSETS.length) hunt = { i: 0 };
}

function tick() {
  if (!boxes.clock) return;
  /* a hidden page is a frozen picture, and a frozen picture read four times a
     second is a stopped clock published with total confidence */
  if (document.hidden) { ring = []; return; }
  if (!camLive()) { if (sending) ensureCamera(); ring = []; return; }
  const inv = $('#invert').checked ? true : null, adj = +$('#thr').value || 0;
  const img = cropOf(boxes.clock); if (!img) return;
  ring.push(img); if (ring.length > RING) ring.shift();
  /* captured at twice the rate it is read, so three frames span a third of a
     second rather than most of one: the shorter the window, the less often a
     digit changes inside it */
  if ((grab = (grab + 1) % 2) !== 0) { if ($('#pcMode').checked) postCrop(); return; }
  const now0 = Date.now();
  /* THE STACK MUST BE SHORTER THAN THE BOARD'S OWN TICK.

     Averaging three frames works because a board showing whole seconds changes
     once a second and the stack spans a quarter of one. Under a minute the board
     switches to tenths and changes ten times a second, so all three frames hold
     different numbers and the average is a blur of them -- which does not read as
     any of the three. On 34.5 -> 34.4 -> 34.3 it came back 34.9.

     So below a minute the newest frame is read on its own. The flicker that
     averaging was there to beat costs a few more refused frames; a tenth that was
     never on the board costs the last seconds of a quarter, which is the part
     anybody watching is actually looking at. */
  const predNow = CLK.predict(now0);
  const tenths = predNow != null && predNow < 60000;
  const b = binarise(tenths ? ring[ring.length - 1] : stack(ring), inv, adj);
  if ($('#pcMode').checked) { postCrop(); thumb('clock', b, 'to the PC'); return; }
  const now = now0;
  const ms = readClock(b, predNow);
  thumb('clock', b, ms == null ? null : fmt(ms));
  if (ms != null) {
    lastReadAt = now; hunt = null;
    const out = CLK.consider(ms, now);
    locked = CLK.locked; running = CLK.running;
    if (out) { clockMs = out.ms; publish(out.force); }
    /* the nudged box has earned its place: the clock locked on at it */
    if (boxPending && locked) {
      boxPending = false;
      try { localStorage.setItem('cc:' + gameId, JSON.stringify(boxes)); } catch (_) {}
    }
  } else if (sending && lastReadAt && now - lastReadAt > 6000) {
    tryHunt(inv, adj, now);
  }
  if ($('#sendScore').checked) readScores(inv, adj);
  readPeriod(inv, adj);
  paintRead();
}

/* ---------------------------------------------------------- the score ---
   THE CLOCK HAS PHYSICS AND THE SCORE HAD NONE. A clock is checked against what a
   clock can do between two frames; a score was taken from a single frame and sent
   as it was. But a score is the easier thing to misread badly -- 8 and 0 differ by
   one segment, 48 and 40 by one lamp -- and a wrong score on a stream is more
   obvious than a wrong clock and stays until the next basket.

   A score also has physics, just simpler ones: it only ever goes up, it goes up by
   one, two or three, and it never moves twice in the same tenth of a second. So a
   reading is believed when the same number arrives twice running, and a fall is
   only believed when it keeps saying it -- the table correcting itself does
   happen, and it looks exactly like a misread until it repeats. */
let scoreSeen = { home: null, away: null };
function readScores(inv, adj) {
  ['home', 'away'].forEach(k => {
    if (!boxes[k]) return;
    const im = cropOf(boxes[k], 120); if (!im) return;
    const bb = binarise(im, inv, adj);
    const v = readScore(bb);
    thumb(k, bb, v);
    if (v == null) { scoreSeen[k] = null; return; }
    const s = scoreSeen[k];
    if (s && s.v === v) s.n++; else scoreSeen[k] = { v, n: 1 };
    const n = scoreSeen[k].n, cur = scores[k];
    const rising = cur == null || (v >= cur && v - cur <= 3);
    if (rising ? n >= 2 : n >= 4) scores[k] = v;
  });
}

/* --------------------------------------------------------- the period ---
   Boxing the period number is optional, and worth it. The clock cam otherwise
   relies on somebody at the table remembering to press P+ between quarters, and
   the one time nobody does, the stream carries the wrong period for ten minutes
   while the clock beside it is perfectly right -- which looks worse than both
   being wrong. The board already knows.

   Three readings agreeing before it moves, for the same reason the clock wants
   three: a single frame is a photograph, not a fact. And a period is only ever
   allowed to be 1 to 6, which throws away most of what a misread produces. */
let perSeen = null;
function readPeriod(inv, adj) {
  if (!boxes.period) return;
  const im = cropOf(boxes.period, 90); if (!im) return;
  const bb = binarise(im, inv, adj);
  const v = readScore(bb);
  thumb('period', bb, v == null ? null : 'P' + v);
  if (!(v >= 1 && v <= 6)) { perSeen = null; return; }
  if (perSeen && perSeen.v === v) perSeen.n++; else perSeen = { v, n: 1 };
  if (perSeen.n >= 3 && v !== period) {
    period = v; resetLock(); paintRead(); publish(true);
    $('#boxHint').textContent = 'The board says period ' + v + '.';
  }
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
  durable(state, now);
  paintStatus();
}

/* A DURABLE COPY, EVERY FEW SECONDS.

   Broadcast frames reach whoever is listening at the time and nobody else. A
   layer opened at the start of the third quarter, a club's own page, the fixture
   strip on somebody's website -- all of them begin by reading game_state, and
   for a game whose clock comes from a phone that row was never written. The PC
   reader has always kept it up to date; this is the same thing from the phone,
   through an RPC that can only ever set the clock, so a club manager entitled to
   broadcast cannot reach the score with it. */
async function durable(state, now) {
  if (now - lastDurable < 5000 || !sb) return;
  lastDurable = now;
  try {
    await sb.rpc('broadcast_clock', { p_game: gameId, p_period: state.period, p_clock_ms: state.clock_ms, p_running: state.running });
  } catch (_) { /* the live frames are the path that matters; this is the safety net */ }
}
async function postCrop() {
  if (!sending || !sb || !boxes.clock) return;
  const now = Date.now(); if (now - lastPost < 400) return; lastPost = now;
  /* THE SAME COVER MAPPING AS EVERY OTHER CROP. This path multiplied the box
     straight by the video's own size, which is only the right rectangle when the
     stage and the camera happen to share a shape. They often do not -- a phone
     asked for 4:3 hands back 16:9 as often as not -- and then PC mode was posting
     a picture of the wrong part of the board to a reader that had no way to know.
     Fixing cropOf and leaving this was half a fix. */
  const v = $('#cam'); const m = boxToVideo(boxes.clock); if (!m || m.sw < 2 || m.sh < 2) return;
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.max(40, Math.round(320 * m.sh / m.sw));
  c.getContext('2d').drawImage(v, m.sx, m.sy, m.sw, m.sh, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.7);
  try { await sb.from('cam_frames').upsert({ game_id: gameId, taken_at: new Date(now).toISOString(), crop: url, kind: 'clock', posted_by: user.id }, { onConflict: 'game_id' }); sent++; } catch (_) {}
  paintStatus();
}
function paintRead() {
  $('#rPer').textContent = 'P' + period;
  const c = $('#rClk'); c.textContent = fmt(locked && clockMs != null ? clockMs : CLK.raw); c.classList.toggle('run', running);
  $('#rSc').textContent = ($('#sendScore').checked && scores.home != null && scores.away != null) ? scores.home + ' – ' + scores.away : '';
}
function paintStatus() {
  const bits = [];
  bits.push(joined ? 'live channel connected' : 'connecting…');
  if (camFail) bits.push(camFail);
  bits.push(sending ? ($('#pcMode').checked ? 'posting crops to the PC' : 'sending readings') : 'not sending');
  if (sent) bits.push(sent + ' sent');
  if (!locked) bits.push('waiting for the clock to run');
  /* what the reader is throwing away is worth showing: a box that is slightly
     wrong reads often and is refused often, and that is the only symptom */
  else { const st = CLK.stats; if (st.refused && st.reads) bits.push(Math.round(100 * st.refused / st.reads) + '% refused'); }
  if (hunt) bits.push('looking for the digits again');
  if (nudged) bits.push('box nudged ' + nudged + '\u00d7');
  if (wake) bits.push('screen held awake');
  $('#rSt').textContent = bits.join(' · ');
}

window.__clockcam = { binarise, glyphs, readClock, readScore, segDigit, boxToVideo, stageRect, CLK, get boxes() { return boxes; } };
document.addEventListener('DOMContentLoaded', boot);
}());
