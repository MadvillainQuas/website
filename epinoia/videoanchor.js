'use strict';
/* ============================================================================
   EPINOIA VIDEO ANCHOR — finding the tip-off in the footage without asking.

   epinoia/video.js places every play once it knows ONE number: where the
   jump ball is in the video. This module works that number out, three ways,
   in order of how much each can be trusted (docs/video-livestats-sync-roadmap.md,
   Phase 1):

     1. THE STREAM'S OWN START TIME. A platform that ran the stream knows the
        instant it began (YouTube: liveStreamingDetails.actualStartTime). The
        tip-off's wall clock is in the event log, so the gap is a subtraction.
        Error: the platform's ingest delay, a constant of 5–30 s.

     2. THE FILE'S OWN CLOCK. An MP4/MOV carries the moment it was created
        (the mvhd atom; phones and OBS also write an ISO date into the
        QuickTime metadata). Same subtraction. Error: whatever the camera's
        clock was wrong by, which can be minutes — so it is a PROPOSAL, shown
        with its source, never silently applied.

     3. THE SCOREBOARD IN THE PICTURE. Read the clock overlay off sampled
        frames (Tesseract, vendored under epinoia/vendor/tesseract — the
        page's CSP allows no third-party script). The first frame where the
        first-period clock is below 10:00 is a frame the game had started in,
        and the clock says by how much. Error: the sampling step, then refined
        to about a second. Works on a local file (never uploaded) or a
        same-origin video; an embedded YouTube player cannot be sampled.

   Nothing here writes anywhere. It returns numbers with the evidence beside
   them, and the attach-video sheet decides what to do with them.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVideoAnchor = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------ MP4 clock --- */
/* QuickTime/MP4 epoch: seconds since 1904-01-01 UTC. */
const MP4_EPOCH_MS = Date.UTC(1904, 0, 1);
const MOOV_CAP = 24 * 1024 * 1024;     // a moov bigger than this is not a moov

function be32(dv, o) { return dv.getUint32(o); }
function be64(dv, o) { return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4); }
function fourcc(dv, o) {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
}

async function readSlice(file, start, len) {
  const blob = file.slice(start, Math.min(file.size, start + len));
  return new DataView(await blob.arrayBuffer());
}

/* Walk the top-level boxes without reading the media. Each header is 8 or 16
   bytes; mdat is skipped by its size, which is the whole point — a 6 GB game
   costs a handful of tiny reads. */
async function findBox(file, wanted) {
  let off = 0, guard = 0;
  while (off + 8 <= file.size && guard++ < 200) {
    const h = await readSlice(file, off, 16);
    if (h.byteLength < 8) break;
    let size = be32(h, 0);
    const type = fourcc(h, 4);
    let hdr = 8;
    if (size === 1 && h.byteLength >= 16) { size = be64(h, 8); hdr = 16; }
    else if (size === 0) size = file.size - off;
    if (size < hdr) break;
    if (type === wanted) return { off, size, hdr };
    off += size;
  }
  return null;
}

/* Children of a box held in memory; returns [{type, start, size}] over the
   payload. Depth-limited by the caller. */
function children(dv, start, end) {
  const out = [];
  let o = start, guard = 0;
  while (o + 8 <= end && guard++ < 5000) {
    let size = be32(dv, o); const type = fourcc(dv, o + 4); let hdr = 8;
    if (size === 1 && o + 16 <= end) { size = be64(dv, o + 8); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o + hdr, end: o + size });
    o += size;
  }
  return out;
}

function mvhdCreation(dv, box) {
  const v = dv.getUint8(box.start);
  const secs = v === 1 ? be64(dv, box.start + 4) : be32(dv, box.start + 4);
  if (!secs) return null;
  const d = new Date(MP4_EPOCH_MS + secs * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/* An ISO date written by the recorder itself (Riverside, phones, OBS with
   metadata on). Found by text rather than by walking ilst, because the keys
   vary (©day, com.apple.quicktime.creationdate, creation_time) and the value
   does not. Preferred over mvhd when present: a re-encode keeps the text and
   zeroes or resets the atom. */
function isoDateIn(dv, start, end) {
  const n = Math.min(end - start, 4 * 1024 * 1024);
  let s = '';
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + start, n);
  for (let i = 0; i < n; i += 65536) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(n, i + 65536)));
  const m = s.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (!m) return null;
  const d = new Date(m[0].replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/* {at: Date, source: 'metadata'|'mvhd', raw} or null. Never throws on a file
   that is not an MP4 — "no idea" is an answer this is allowed to give. */
async function mp4CreationTime(file) {
  try {
    const moov = await findBox(file, 'moov');
    if (!moov || moov.size > MOOV_CAP) return null;
    const dv = await readSlice(file, moov.off, moov.size);
    const kids = children(dv, moov.hdr, dv.byteLength);
    const meta = isoDateIn(dv, moov.hdr, dv.byteLength);
    const mvhd = kids.find(k => k.type === 'mvhd');
    const atom = mvhd ? mvhdCreation(dv, mvhd) : null;
    /* An atom date before 2000 is an unset clock (1904 + 0) or a camera that
       never had one; the metadata string is the only thing left to trust. */
    if (meta) return { at: meta, source: 'metadata', atom: atom };
    if (atom && atom.getTime() > Date.UTC(2000, 0, 1)) return { at: atom, source: 'mvhd' };
    return null;
  } catch (_) { return null; }
}

/* ---------------------------------------------------------- stream start --- */
/* YouTube only, and only with a key: the page's CSP names googleapis.com for
   exactly this call. Returns {at: Date, source: 'youtube'} or null. */
async function youtubeStreamStart(videoId, apiKey) {
  if (!videoId || !apiKey) return null;
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=' +
      encodeURIComponent(videoId) + '&key=' + encodeURIComponent(apiKey), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const d = j && j.items && j.items[0] && j.items[0].liveStreamingDetails;
    const iso = d && (d.actualStartTime || d.scheduledStartTime);
    if (!iso) return null;
    const at = new Date(iso);
    return isNaN(at.getTime()) ? null : { at, source: d.actualStartTime ? 'youtube' : 'youtube-scheduled' };
  } catch (_) { return null; }
}

/* ------------------------------------------------------------------ OCR --- */
let ocrWorker = null, ocrLoading = null;
const VENDOR = (function () {
  /* resolved against this script's own URL, so the game page and the scorer
     both find the same files */
  try {
    const me = (document.currentScript && document.currentScript.src) || '';
    return me ? new URL('vendor/tesseract/', me).href : 'vendor/tesseract/';
  } catch (_) { return 'vendor/tesseract/'; }
}());

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/* One worker, made on first use, kept for the session. ~7 MB of wasm and
   language data come off this origin the first time, so the sheet says so. */
async function loadOcr(onStatus) {
  if (ocrWorker) return ocrWorker;
  if (ocrLoading) return ocrLoading;
  ocrLoading = (async () => {
    onStatus && onStatus('loading the reader (about 7 MB, once)…');
    if (!root0().Tesseract) await loadScript(VENDOR + 'tesseract.min.js');
    const T = root0().Tesseract;
    const w = await T.createWorker('eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR,
      langPath: VENDOR + 'lang',
      gzip: true,
      logger: m => { if (onStatus && m && m.status && m.progress != null && m.status !== 'recognizing text')
                       onStatus(m.status + ' ' + Math.round(m.progress * 100) + '%'); }
    });
    await w.setParameters({
      tessedit_char_whitelist: '0123456789:.QOTP ',
      tessedit_pageseg_mode: '7',           // one line: a clock is one line
      preserve_interword_spaces: '1'
    });
    ocrWorker = w;
    return w;
  })();
  try { return await ocrLoading; } finally { ocrLoading = null; }
}
function root0() { return typeof globalThis !== 'undefined' ? globalThis : self; }

/* A frame of the video, cropped and made legible: scaled up, greyscale,
   contrast-stretched, and inverted when the overlay is light-on-dark (which
   broadcast scoreboards nearly always are) so the reader sees dark digits on
   a light ground, which is what it was trained on. */
function sampleFrame(video, crop, scale) {
  const c = crop || { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
  const k = scale || Math.max(1, Math.min(4, Math.round(120 / Math.max(1, c.h))));
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, Math.round(c.w * k)); cv.height = Math.max(8, Math.round(c.h * k));
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
  const img = g.getImageData(0, 0, cv.width, cv.height);     // throws on a tainted canvas — caller reports it
  const d = img.data;
  let lo = 255, hi = 0, sum = 0;
  const n = d.length / 4;
  const lum = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    lum[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; sum += v;
  }
  const mean = sum / n, range = Math.max(1, hi - lo), invert = mean < 128;
  for (let i = 0; i < n; i++) {
    let v = ((lum[i] - lo) * 255 / range) | 0;
    if (invert) v = 255 - v;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/* "9:41", "09:41.3", "Q3 1:28", "P1 09:58" → {m, s, tenths, period, text}. A
   reading that is not a clock is null, and a minute above 20 is not a
   basketball clock either. */
function parseClock(text) {
  const t = String(text || '').replace(/O/g, '0').replace(/[^\dQPT:. ]/g, ' ');
  const m = t.match(/(\d{1,2})[:.](\d{2})(?:[.:](\d))?/);
  if (!m) return null;
  const min = +m[1], sec = +m[2];
  if (min > 20 || sec > 59) return null;
  const per = (t.match(/[QP]\s?([1-4])/) || [])[1];
  return { m: min, s: sec, tenths: m[3] != null ? +m[3] : null, period: per ? +per : null,
           ms: (min * 60 + sec) * 1000 + (m[3] != null ? +m[3] * 100 : 0), text: t.trim() };
}

async function readClock(canvas) {
  const w = await loadOcr();
  const r = await w.recognize(canvas);
  const text = (r && r.data && r.data.text || '').trim();
  return { text, conf: r && r.data ? r.data.confidence : 0, clock: parseClock(text) };
}

function seek(video, t) {
  return new Promise((res, rej) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    const fail = () => { video.removeEventListener('error', fail); rej(new Error('seek failed')); };
    video.addEventListener('seeked', done); video.addEventListener('error', fail);
    video.currentTime = Math.max(0, Math.min(video.duration || t, t));
  });
}

/* THE SEARCH. Sample every `step` seconds from `from`; the first frame whose
   clock reads a running first period (below the period length, above zero)
   is a frame the game had started in, and `period length − clock` says how
   long before it the ball went up. Then refine: step back to the last frame
   that read the full clock (or nothing) and bisect at half-second grain until
   the reading changes. The result is where the clock STARTED, which is the
   tip to within the reader's own error.

   Returns {tipMs, evidence:[{t, text, clock}], refined} or {tipMs:null, why}. */
async function findTip(video, crop, opts) {
  const o = Object.assign({ from: 0, to: null, step: 2, periodLength: 600, onStatus: null, onSample: null }, opts || {});
  const to = o.to != null ? o.to : Math.min(video.duration || 0, o.from + 45 * 60);
  const evidence = [];
  const status = s => { if (o.onStatus) o.onStatus(s); };
  await loadOcr(status);
  let prev = null, hit = null;
  for (let t = o.from; t <= to; t += o.step) {
    await seek(video, t);
    const cv = sampleFrame(video, crop);
    const r = await readClock(cv);
    const e = { t, text: r.text, conf: r.conf, clock: r.clock };
    evidence.push(e);
    if (o.onSample) o.onSample(e, cv);
    status('reading the scoreboard at ' + stampS(t) + ' — "' + r.text + '"');
    const c = r.clock;
    const running = c && c.ms > 0 && c.ms < o.periodLength * 1000 && (c.period == null || c.period === 1);
    if (running) { hit = e; break; }
    prev = e;
  }
  if (!hit) return { tipMs: null, why: 'no running first-period clock was read between ' + stampS(o.from) + ' and ' + stampS(to), evidence };

  /* Refine between prev (full clock / no clock) and hit: bisect on "has the
     clock started", to half a second. Each probe is one OCR of a small crop. */
  let lo = prev ? prev.t : Math.max(0, hit.t - o.step), hi = hit.t, hiClock = hit.clock;
  let refined = false;
  for (let i = 0; i < 6 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    await seek(video, mid);
    const r = await readClock(sampleFrame(video, crop));
    evidence.push({ t: mid, text: r.text, conf: r.conf, clock: r.clock });
    const c = r.clock;
    if (c && c.ms > 0 && c.ms < o.periodLength * 1000) { hi = mid; hiClock = c; refined = true; }
    else lo = mid;
  }
  /* the tip is `hi` minus however much clock had already run off by then */
  const ran = o.periodLength * 1000 - hiClock.ms;
  const tipMs = Math.max(0, Math.round(hi * 1000 - ran));
  return { tipMs, refined, readAt: hi, read: hiClock, evidence };
}

/* WHERE IS THE SCOREBOARD? Nobody should have to draw a box. Broadcast overlays
   sit in a corner or along the top/bottom edge, so a handful of candidate
   crops at a frame the game is running in are tried and the one that reads
   as a clock wins. `t` should be a moment the game is on (the sheet uses the
   proposed tip + 60 s, or 60 s in when there is no proposal). Returns
   {crop, read, text} or null. */
const CANDIDATES = [
  // [x, y, w, h] as fractions of the frame
  [0.00, 0.00, 0.34, 0.14], [0.33, 0.00, 0.34, 0.14], [0.66, 0.00, 0.34, 0.14],
  [0.00, 0.86, 0.34, 0.14], [0.33, 0.86, 0.34, 0.14], [0.66, 0.86, 0.34, 0.14],
  [0.00, 0.00, 0.50, 0.20], [0.50, 0.00, 0.50, 0.20], [0.25, 0.00, 0.50, 0.20],
  [0.00, 0.80, 0.50, 0.20], [0.50, 0.80, 0.50, 0.20], [0.25, 0.80, 0.50, 0.20],
  [0.00, 0.14, 0.34, 0.14], [0.66, 0.14, 0.34, 0.14]
];
async function autoCrop(video, t, opts) {
  const o = opts || {};
  await loadOcr(o.onStatus);
  await seek(video, t);
  const W = video.videoWidth, H = video.videoHeight;
  const tried = [];
  for (const [fx, fy, fw, fh] of CANDIDATES) {
    const crop = { x: Math.round(fx * W), y: Math.round(fy * H), w: Math.round(fw * W), h: Math.round(fh * H) };
    let r;
    try { r = await readClock(sampleFrame(video, crop, 2)); } catch (e) { throw e; }
    tried.push({ crop, text: r.text, clock: r.clock });
    if (o.onStatus) o.onStatus('looking for the clock… "' + r.text + '"');
    if (r.clock && r.clock.ms > 0) {
      /* tighten: the clock is somewhere in this strip — split it in thirds and
         keep the third that still reads, so the search crops stay small */
      let best = crop;
      for (const k of [0, 1, 2]) {
        const sub = { x: crop.x + Math.round(k * crop.w / 3), y: crop.y, w: Math.round(crop.w / 3), h: crop.h };
        const rr = await readClock(sampleFrame(video, sub, 3));
        if (rr.clock && rr.clock.ms === r.clock.ms) { best = sub; break; }
      }
      return { crop: best, read: r.clock, text: r.text, tried };
    }
  }
  return { crop: null, tried };
}

/* THE WHOLE GAME CLOCK, READ OFF THE FOOTAGE.

   Every play-by-play event carries the game clock, so if the clock overlay is
   read at points through the video, every event can be placed by its clock —
   exactly, stoppages included — instead of by wall-clock arithmetic. This
   walks the footage at `step` seconds, reads the clock in the crop, keeps the
   readings that make sense (a valid period and a clock that never runs UP
   within a period), and returns a track the page stores on the video row:

     {format:'epinoia-clock-track/1', samples:[{t, period, clock_ms}, …]}

   The same shape is what a computer-vision model can produce offline and
   import; the page treats both alike. `onProgress(done, total, sample)` lets a
   sheet show it working; `signal` (an AbortSignal) lets it be stopped. */
async function trackClock(video, crop, opts) {
  const o = Object.assign({ from: 0, to: null, step: 5, periodLength: 600, onStatus: null, onProgress: null, signal: null }, opts || {});
  const to = o.to != null ? o.to : (video.duration || 0);
  const status = s => { if (o.onStatus) o.onStatus(s); };
  await loadOcr(status);
  const samples = [];
  let period = 1, lastClock = null, lastPeriodAt = -1;
  const total = Math.max(1, Math.floor((to - o.from) / o.step));
  let i = 0;
  for (let t = o.from; t <= to; t += o.step, i++) {
    if (o.signal && o.signal.aborted) break;
    try { await seek(video, t); } catch (_) { continue; }
    let r;
    try { r = await readClock(sampleFrame(video, crop)); } catch (_) { continue; }
    const c = r.clock;
    if (o.onProgress) o.onProgress(i, total, { t, text: r.text, clock: c });
    if (!c || c.ms < 0 || c.ms > o.periodLength * 1000) continue;
    /* which period: the overlay's own label when it prints one; otherwise the
       clock jumping back UP to (near) full after running down means a new
       period began since the last reading */
    if (c.period) period = c.period;
    else if (lastClock != null && c.ms > lastClock + 60 * 1000 && c.ms >= (o.periodLength - 30) * 1000 && t - lastPeriodAt > 120) {
      period += 1; lastPeriodAt = t;
    }
    /* a reading that runs up within a period is a misread (a 3 read as an 8) */
    if (lastClock != null && c.ms > lastClock + 2000 && !(c.period && c.period !== (samples.length ? samples[samples.length - 1].period : 0)) && period === (samples.length ? samples[samples.length - 1].period : period)) continue;
    samples.push({ t: Math.round(t * 10) / 10, period, clock_ms: c.ms });
    lastClock = c.ms;
  }
  status('read ' + samples.length + ' clock readings');
  return { format: 'epinoia-clock-track/1', samples };
}

/* An event's position in the footage from a clock track: the readings of its
   period that bracket its clock, interpolated on the clock (the clock runs
   at one second per second while it runs, so between two readings the map is
   linear); at a stoppage — two readings with the same clock — the earlier one.
   null when the track has nothing in that period. */
function positionFromTrack(track, period, clockMs) {
  const S = track && Array.isArray(track.samples) ? track.samples.filter(s => s.period === period) : [];
  if (!S.length) return null;
  S.sort((a, b) => a.t - b.t);
  let before = null, after = null;
  for (const s of S) {
    if (s.clock_ms > clockMs) before = s;           // the last reading still ahead of the event's clock
    else { after = s; break; }                      // the first reading at or past it
  }
  /* the clock stood at exactly this value: the FIRST reading of it is when the
     play happened (the whistle); later ones are the stoppage that followed */
  if (after && after.clock_ms === clockMs) return after.t * 1000;
  if (before && after) {
    const span = before.clock_ms - after.clock_ms;
    const frac = span > 0 ? (before.clock_ms - clockMs) / span : 0;
    return (before.t + (after.t - before.t) * frac) * 1000;
  }
  if (before) return (before.t + (before.clock_ms - clockMs) / 1000) * 1000;   // past the last reading: the clock runs on
  if (after) return Math.max(0, (after.t - (clockMs - after.clock_ms) / 1000)) * 1000;
  return null;
}

/* Period starts for the later quarters: the frames where a full clock
   (10:00) first gives way to a running one, searched from a hint. Optional
   and slower; the sheet offers it after the tip is found. */
async function findPeriodStart(video, crop, fromS, opts) {
  return findTip(video, crop, Object.assign({}, opts || {}, { from: fromS, to: fromS + 20 * 60 }));
}

function stampS(t) {
  const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}

/* ---------------------------------------------------- clips for the studio --- */
/* Phase 3's first slice: every placed play as a clip the labelling studio (or
   an editor) can take. Positions are in the video the row names; `approx`
   marks plays placed from their neighbours; `err_ms` is how far a fed play's
   stamp could be from the moment (the poll interval), null for a tapped one. */
function clipsExport(plays, video, game, events) {
  const err = {};
  (events || []).forEach(e => { if (e.wall_err != null) err[e.seq != null ? e.seq : e.id] = e.wall_err; });
  return {
    format: 'epinoia-clips/1',
    game: { id: game && game.id || null, home: game && game.home || null, away: game && game.away || null,
            tipoff_at: game && game.tipoff_at || null },
    video: { url: video && video.url || null, provider: video && video.provider || null,
             gap_ms: video && video.gap_ms != null ? video.gap_ms : null, trim_ms: video && video.trim_ms || 0 },
    clips: (plays || []).map(p => ({
      seq: p.id, type: p.t, pid: p.pid, team: p.team, period: p.period, clock_ms: p.clock,
      at_ms: Math.round(p.ms), start_ms: Math.round(p.start), end_ms: Math.round(p.end),
      approx: !!p.approx, err_ms: err[p.id] != null ? err[p.id] : null, label: p.label
    }))
  };
}

return { mp4CreationTime, youtubeStreamStart, loadOcr, sampleFrame, readClock, parseClock,
         autoCrop, findTip, findPeriodStart, trackClock, positionFromTrack, clipsExport, stampS, VENDOR };
}));
