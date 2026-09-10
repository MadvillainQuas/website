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
const pub = p => CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + p;
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
})();
