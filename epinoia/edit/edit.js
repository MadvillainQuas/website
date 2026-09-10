'use strict';
/* ============================================================================
   Edit Suite — a finished reel, trimmed, cropped and captioned.

   Opens a highlight job's MP4 (?hl=<job>), lets the person who asked for it trim the ends,
   drag a crop window and lay text over the picture, and sends the result back as a second
   job (0110: source_path + edits) for the worker to render with ffmpeg. Every position is
   kept as a fraction of the frame, so what is dragged here lands where it was on the full
   1080x1920 export. Nothing is rendered in the browser; the preview is the video with the
   overlays drawn on top.
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const qp = new URLSearchParams(location.search);
let sess = null, job = null, dur = 0;
let edits = { trim: { start: 0, end: null }, crop: null, texts: [] };
let cur = -1;                       // the selected text layer
const pub = p => CFG.supabaseUrl + '/storage/v1/object/public/highlights/' + p;
const hdr = () => ({ apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + sess.token, 'Content-Type': 'application/json' });
const fmt = s => (Math.round(s * 10) / 10).toFixed(1) + 's';

async function api(path, opts) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, Object.assign({ headers: hdr(), cache: 'no-store' }, opts || {}));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ------------------------------------------------------------- the frame --- */
const frame = () => $('#frame'), vid = () => $('#vid');
function frameRect() { return frame().getBoundingClientRect(); }
/* the picture inside the frame (object-fit:contain leaves bars when the reel is not 9:16) */
function pictureRect() {
  const f = frameRect(), v = vid();
  const vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const s = Math.min(f.width / vw, f.height / vh);
  const w = vw * s, h = vh * s;
  return { x: (f.width - w) / 2, y: (f.height - h) / 2, w, h };
}

/* --------------------------------------------------------------- crop --- */
function paintCrop() {
  const box = $('#cropbox'), p = pictureRect();
  const c = edits.crop || { x: 0, y: 0, w: 1, h: 1 };
  box.style.left = (p.x + c.x * p.w) + 'px'; box.style.top = (p.y + c.y * p.h) + 'px';
  box.style.width = (c.w * p.w) + 'px'; box.style.height = (c.h * p.h) + 'px';
}
function dragCrop() {
  const box = $('#cropbox');
  let mode = null, start = null, c0 = null;
  const down = (e, m) => { e.preventDefault(); e.stopPropagation(); mode = m; start = [e.clientX, e.clientY]; c0 = Object.assign({}, edits.crop || { x: 0, y: 0, w: 1, h: 1 }); box.setPointerCapture && box.setPointerCapture(e.pointerId); };
  box.addEventListener('pointerdown', e => down(e, e.target.tagName === 'I' ? 'size' : 'move'));
  box.addEventListener('pointermove', e => {
    if (!mode) return;
    const p = pictureRect();
    const dx = (e.clientX - start[0]) / p.w, dy = (e.clientY - start[1]) / p.h;
    let c = Object.assign({}, c0);
    if (mode === 'move') { c.x = Math.max(0, Math.min(1 - c.w, c0.x + dx)); c.y = Math.max(0, Math.min(1 - c.h, c0.y + dy)); }
    else {
      c.w = Math.max(0.2, Math.min(1 - c.x, c0.w + dx)); c.h = Math.max(0.2, Math.min(1 - c.y, c0.h + dy));
      if ($('#cropLock').checked) {                       // keep the reel's own shape
        const v = vid(); const ar = (v.videoWidth || 1080) / (v.videoHeight || 1920);
        const fw = v.videoWidth || 1080, fh = v.videoHeight || 1920;
        c.h = Math.min(1 - c.y, (c.w * fw) / ar / fh);     // same aspect as the picture
      }
    }
    edits.crop = c; paintCrop();
  });
  const up = () => { mode = null; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  $('#cropOn').onclick = () => { frame().classList.toggle('cropping'); if (!edits.crop) edits.crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; paintCrop(); };
  $('#cropReset').onclick = () => { edits.crop = null; frame().classList.remove('cropping'); paintCrop(); };
}

/* --------------------------------------------------------------- text --- */
function paintTexts() {
  frame().querySelectorAll('.tx').forEach(n => n.remove());
  const p = pictureRect();
  edits.texts.forEach((t, i) => {
    const n = el('div', 'tx' + (i === cur ? ' on' : ''), t.text || 'text');
    n.style.left = (p.x + t.x * p.w) + 'px'; n.style.top = (p.y + t.y * p.h) + 'px';
    n.style.fontSize = (t.size * (p.w / 1080)) + 'px';
    n.style.color = t.colour || '#fff';
    n.style.background = t.plate === false ? 'transparent' : 'rgba(4,16,11,.75)';
    n.dataset.i = i;
    n.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); cur = i; paintTexts(); paintList(); paintEditor();
      const start = [e.clientX, e.clientY], x0 = t.x, y0 = t.y;
      const move = ev => { const pr = pictureRect(); t.x = Math.max(0.02, Math.min(0.98, x0 + (ev.clientX - start[0]) / pr.w)); t.y = Math.max(0.02, Math.min(0.98, y0 + (ev.clientY - start[1]) / pr.h)); paintTexts(); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    frame().appendChild(n);
  });
  /* only the layers whose time window holds the playhead are visible */
  const now = vid().currentTime;
  frame().querySelectorAll('.tx').forEach(n => {
    const t = edits.texts[+n.dataset.i];
    const a = t.from != null ? t.from : 0, b = t.to != null ? t.to : Infinity;
    n.style.opacity = (now >= a && now <= b) || +n.dataset.i === cur ? '1' : '.25';
  });
}
function paintList() {
  const host = $('#txList'); host.textContent = '';
  edits.texts.forEach((t, i) => {
    const r = el('div', 'tli' + (i === cur ? ' on' : ''));
    r.append(el('b', null, t.text || 'text'), el('span', 'ep-micro', (t.from != null ? fmt(t.from) : '0.0s') + ' → ' + (t.to != null ? fmt(t.to) : 'end')));
    r.onclick = () => { cur = i; paintTexts(); paintList(); paintEditor(); };
    host.appendChild(r);
  });
}
function paintEditor() {
  const t = edits.texts[cur];
  $('#txEd').classList.toggle('hide', !t);
  if (!t) return;
  $('#txText').value = t.text || ''; $('#txSize').value = t.size; $('#txColour').value = t.colour || '#ffffff';
  $('#txFrom').max = $('#txTo').max = dur || 100;
  $('#txFrom').value = t.from != null ? t.from : 0; $('#txTo').value = t.to != null ? t.to : (dur || 100);
  $('#txFromv').textContent = fmt(+$('#txFrom').value); $('#txTov').textContent = t.to != null ? fmt(t.to) : 'end';
  $('#txPlate').checked = t.plate !== false;
}
function wireText() {
  $('#txAdd').onclick = () => { edits.texts.push({ text: 'YOUR TEXT', x: 0.5, y: 0.8, size: 72, colour: '#ffffff', from: null, to: null, plate: true }); cur = edits.texts.length - 1; paintTexts(); paintList(); paintEditor(); };
  $('#txDel').onclick = () => { if (cur >= 0) { edits.texts.splice(cur, 1); cur = -1; paintTexts(); paintList(); paintEditor(); } };
  const upd = () => { const t = edits.texts[cur]; if (!t) return;
    t.text = $('#txText').value; t.size = +$('#txSize').value; t.colour = $('#txColour').value; t.plate = $('#txPlate').checked;
    t.from = +$('#txFrom').value > 0.05 ? +$('#txFrom').value : null;
    t.to = +$('#txTo').value < (dur || 100) - 0.05 ? +$('#txTo').value : null;
    $('#txFromv').textContent = fmt(+$('#txFrom').value); $('#txTov').textContent = t.to != null ? fmt(t.to) : 'end';
    paintTexts(); paintList(); };
  ['#txText', '#txSize', '#txColour', '#txFrom', '#txTo', '#txPlate'].forEach(s => { $(s).oninput = upd; $(s).onchange = upd; });
}

/* --------------------------------------------------------------- trim --- */
function wireTrim() {
  const a = $('#trimA'), b = $('#trimB');
  const upd = () => {
    if (+a.value > +b.value - 0.5) a.value = Math.max(0, +b.value - 0.5);
    edits.trim = { start: +a.value, end: +b.value >= dur - 0.05 ? null : +b.value };
    $('#trimAv').textContent = fmt(+a.value); $('#trimBv').textContent = edits.trim.end == null ? 'end' : fmt(edits.trim.end);
  };
  a.oninput = () => { upd(); vid().currentTime = +a.value; };
  b.oninput = () => { upd(); vid().currentTime = +b.value; };
}

/* ------------------------------------------------------------- export --- */
async function exportEdit() {
  const clean = { trim: edits.trim, crop: edits.crop, texts: edits.texts.map(t => ({ text: t.text, x: t.x, y: t.y, size: t.size, colour: t.colour, from: t.from, to: t.to, plate: t.plate !== false })) };
  $('#status').textContent = 'sending…';
  try {
    const rows = await api('highlight_jobs', { method: 'POST', headers: Object.assign(hdr(), { Prefer: 'return=representation' }), body: JSON.stringify({
      game_id: job.game_id, requested_by: job.requested_by, player_id: job.player_id, player_name: job.player_name, kinds: job.kinds,
      orientation: job.orientation, clips: [], parent_id: job.id, source_path: job.output_path, edits: clean
    }) });
    const nj = rows[0];
    $('#status').textContent = 'queued — rendering on the league’s PC; this page will open it when done';
    const tick = async () => {
      const r = (await api('highlight_jobs?id=eq.' + nj.id + '&select=status,progress,error'))[0];
      if (!r) return;
      if (r.status === 'done') { location.href = '?hl=' + nj.id; return; }
      if (r.status === 'failed') { $('#status').textContent = 'failed: ' + (r.error || ''); return; }
      $('#status').textContent = (r.progress && r.progress.stage) || r.status;
      setTimeout(tick, 4000);
    };
    setTimeout(tick, 3000);
  } catch (e) { $('#status').textContent = 'could not send: ' + String(e.message || e).slice(0, 140); }
}

/* ------------------------------------------------- export, in the browser ---
   THE EDIT NEED NOT LEAVE THE PHONE. The reel is already a public MP4 with CORS on it, so the
   browser can play it through a canvas -- cropped, with the text drawn on -- and record what
   the canvas shows with MediaRecorder, sound included. That is how the web editors people
   already use do it: no upload, no queue, the file lands in the downloads folder as soon as
   the reel has played through once. Chrome and Edge (126 up) and Safari write MP4; Firefox
   writes WebM, and is told so. The league's PC stays available for the cases a browser cannot
   do: a phone that cannot record, or somebody who wants the render done for them.

   The reel plays audibly while it records -- a muted element gives a silent capture -- so the
   suite says so and turns the volume down to a murmur rather than off. */
function recorderMime() {
  if (!window.MediaRecorder) return null;
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
                 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || null;
}
function drawTexts(ctx, ow, oh, W, H, sx, sy, sw, sh, now) {
  edits.texts.forEach(t => {
    if (!String(t.text || '').trim()) return;
    const a = t.from != null ? t.from : 0, b = t.to != null ? t.to : Infinity;
    if (now < a || now > b) return;
    const x = ((t.x * W) - sx) / sw * ow, y = ((t.y * H) - sy) / sh * oh;
    const size = Math.max(10, (t.size || 64) * (ow / 1080) * (W / (sw || W)));
    ctx.font = '700 ' + size + 'px Bahnschrift, Archivo, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = String(t.text).split('\n');
    const lh = size * 1.15, tw = Math.max(...lines.map(l => ctx.measureText(l).width)), th = lh * lines.length;
    if (t.plate !== false) {
      const pad = size * 0.35;
      ctx.fillStyle = 'rgba(4,16,11,.75)';
      const rx = x - tw / 2 - pad, ry = y - th / 2 - pad * 0.6, rw = tw + pad * 2, rh = th + pad * 1.2, r = size * 0.2;
      ctx.beginPath(); ctx.moveTo(rx + r, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r); ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
      ctx.arcTo(rx, ry + rh, rx, ry, r); ctx.arcTo(rx, ry, rx + rw, ry, r); ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = Math.max(1, size / 24); ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.fillStyle = t.colour || '#fff';
    lines.forEach((l, i) => { const ly = y - th / 2 + lh * (i + 0.5); ctx.strokeText(l, x, ly); ctx.fillText(l, x, ly); });
  });
}
let localBusy = false;
async function exportLocal() {
  if (localBusy) return;
  const v = vid();
  const mime = recorderMime();
  if (!mime || !(v.captureStream || v.mozCaptureStream)) { $('#status').textContent = 'this browser cannot record video — use the league’s PC below'; return; }
  localBusy = true;
  const W = v.videoWidth || 1080, H = v.videoHeight || 1920;
  const c = edits.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * W), sy = Math.round(c.y * H), sw = Math.max(2, Math.round(c.w * W)), sh = Math.max(2, Math.round(c.h * H));
  let ow = W, oh = Math.abs(sw / sh - W / H) < 0.02 ? H : Math.round(W * sh / sw);
  ow -= ow % 2; oh -= oh % 2;
  const canvas = document.createElement('canvas'); canvas.width = ow; canvas.height = oh;
  const ctx = canvas.getContext('2d', { alpha: false });
  /* frames are pushed by hand after every draw (captureStream(0) + requestFrame): a timed
     capture of a canvas painted from a video delivered two frames in six seconds here */
  const stream = canvas.captureStream(0);
  const vtrack = stream.getVideoTracks()[0];
  const push = () => { if (vtrack && vtrack.requestFrame) vtrack.requestFrame(); };
  let media = null;
  try { media = v.captureStream ? v.captureStream() : v.mozCaptureStream(); } catch (_) { media = null; }
  if (media) media.getAudioTracks().forEach(t => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000, audioBitsPerSecond: 128000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const t0 = edits.trim.start || 0, t1 = edits.trim.end != null ? edits.trim.end : (dur || v.duration);
  const status = $('#status');
  const wasMuted = v.muted, wasVol = v.volume;
  v.muted = false; v.volume = 0.15;
  const draw = () => { ctx.drawImage(v, sx, sy, sw, sh, 0, 0, ow, oh); drawTexts(ctx, ow, oh, W, H, sx, sy, sw, sh, v.currentTime); push(); };
  let finish = null;
  const done = new Promise(r => { finish = r; });
  rec.onstop = () => finish();
  try {
    v.pause();
    await new Promise(res => { const h = () => { v.removeEventListener('seeked', h); res(); }; v.addEventListener('seeked', h); v.currentTime = t0; });
    draw();
    rec.start(500);
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; v.pause(); try { rec.stop(); } catch (_) { finish(); } };
    const loop = () => {
      if (stopped) return;
      draw();
      status.textContent = 'recording in your browser — ' + fmt(Math.max(0, v.currentTime - t0)) + ' of ' + fmt(t1 - t0) + ' (keep this page open)';
      if (v.currentTime >= t1 - 0.03 || v.ended) { stop(); return; }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
    };
    await v.play();
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
    await done;
  } catch (e) {
    status.textContent = 'could not record: ' + String(e.message || e).slice(0, 120);
    localBusy = false; v.muted = wasMuted; v.volume = wasVol;
    return;
  }
  v.muted = wasMuted; v.volume = wasVol;
  const isMp4 = /mp4/.test(mime);
  const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  const name = ((job.player_name || 'reel') + '-edit.' + (isMp4 ? 'mp4' : 'webm')).toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  const a = $('#localDl');
  if (a.href && a.href.startsWith('blob:')) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(blob); a.download = name; a.classList.remove('hide');
  a.textContent = 'save ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)';
  status.textContent = isMp4 ? 'done — saved in your browser; the file is yours to post' : 'done — this browser writes WebM, not MP4; for an MP4 use the league’s PC below';
  localBusy = false;
}

/* --------------------------------------------------------------- boot --- */
(async function boot() {
  const F = window.EpinoiaFollow;
  sess = F && F.session();
  if (!sess) { $('#signedout').classList.remove('hide'); return; }
  const mine = await api('highlight_jobs?select=id,game_id,player_name,orientation,status,output_path,requested_at,parent_id&order=requested_at.desc&limit=30');
  const host = $('#mine');
  mine.forEach(j => {
    const a = el('a', null, (j.player_name || 'everyone') + ' · ' + (j.parent_id ? 'edit' : 'reel') + ' · ' + j.status + ' · ' + new Date(j.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    a.href = '?hl=' + j.id; host.appendChild(a);
  });
  const id = qp.get('hl');
  if (!id) { $('#empty').classList.remove('hide'); if (mine.length) $('#suite').style.display = ''; return; }
  const rows = await api('highlight_jobs?id=eq.' + id + '&select=*');
  job = rows[0];
  if (!job) { $('#empty').classList.remove('hide'); return; }
  $('#suite').style.display = '';
  $('#sub').textContent = (job.player_name || 'everyone') + ' · ' + job.status + (job.progress && job.progress.clips ? ' · ' + job.progress.clips + ' clips' : '');
  if (job.status !== 'done' || !job.output_path) {
    $('#status').textContent = job.status === 'failed' ? 'this reel failed: ' + (job.error || '') : 'still rendering — ' + ((job.progress && job.progress.stage) || job.status) + '; come back in a few minutes';
    $('#exportBtn').disabled = true; $('#dlBtn').classList.add('hide');
    setTimeout(() => location.reload(), 15000);
    return;
  }
  const v = vid();
  v.src = pub(job.output_path);
  $('#dlBtn').href = pub(job.output_path);
  if (job.orientation === 'landscape') frame().classList.add('land');
  v.addEventListener('loadedmetadata', () => {
    dur = v.duration || 0;
    $('#trimA').max = $('#trimB').max = dur; $('#trimB').value = dur; $('#trimBv').textContent = 'end';
    paintCrop(); paintTexts();
  });
  v.addEventListener('timeupdate', paintTexts);
  window.addEventListener('resize', () => { paintCrop(); paintTexts(); });
  dragCrop(); wireText(); wireTrim();
  $('#exportBtn').onclick = exportEdit;
  $('#localBtn').onclick = exportLocal;
  if (!recorderMime()) { $('#localBtn').disabled = true; $('#localNote').textContent = 'this browser cannot record video, so the export runs on the league’s PC'; }
  else if (!/mp4/.test(recorderMime())) $('#localNote').textContent = 'this browser saves WebM rather than MP4; the league’s PC export gives an MP4';
})();
