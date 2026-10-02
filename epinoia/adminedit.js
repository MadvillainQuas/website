'use strict';
/* ============================================================================
   EDIT FROM THE PAGE (0214).   window.EpinoiaAdminEdit

   A fan SUGGESTS a correction (suggest.js, 0199) and the league's moderators decide it. Whoever already has the
   right to change a club's or a player's details - the platform's administrators, the league's, the club's own
   managers - now changes them here, on the page, and the change is live when they save. Nothing on the page
   decides who that is: the database is asked (admin_edit_rights) and the same functions that save check it again
   (admin_edit_team, admin_edit_player, admin_edit_venue), take only their own columns, check every value, write
   the audit log and hand back the row.

   For someone who may edit, suggest.js hands over: its "suggest an edit" button and the hover chips read "edit"
   and open this panel instead of the suggestion dialog. Everybody else keeps the suggestion as it was.

     mount({ type: 'team' | 'player', id, name, host?, venue?, onSaved? })
        host     where to put an Edit button when the page has no suggest button (a player under 18 has none)
        venue    the club's arena (its id), edited in the same panel by the league's administrators
        onSaved  (row) => …  the page redraws what it alone draws (the player's measures, his position)

   Pictures arrive as every other upload does (upload.js prepare: resized, EXIF dropped): a crest straight into
   the public bucket and published by publish_team_logo; a photograph cropped to the profile's 4:5 frame here, then
   published at once by approve_media for the league's and the platform's administrators, or left in the league's
   Photographs queue for a club's manager.

   For the test (supabase/tests/admin-edits.test.mjs):  FIELDS  diff(before, after)  cropRect(...)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAdminEdit = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* what each function takes (0214); the test holds these to the migration */
const FIELDS = {
  team: ['name', 'short_name', 'initials', 'colour', 'colour_2', 'logo_media'],
  player: ['first_name', 'last_name', 'height_cm', 'weight_kg', 'wingspan_cm', 'previous_club', 'position', 'photo_media'],
  venue: ['name', 'address', 'city', 'pin']
};
/* the details suggest.js offers that this panel edits instead */
const COVERS = {
  team: ['photo'],
  player: ['name', 'first_name', 'last_name', 'photo', 'height_cm', 'weight_kg', 'wingspan_cm', 'position', 'previous_club'],
  venue: ['venue_name', 'venue_address', 'venue_city', 'venue_pin']
};
const PHOTO_ASPECT = 4 / 5;           // the profile's frame (kit/playerhero.css)

/* ONLY WHAT CHANGED goes in the patch: the database writes, and audits, nothing else. Values compare as text, so
   206 and '206' are the same height, and null and '' the same empty colour. */
function diff(before, after) {
  const out = {};
  const norm = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
  Object.keys(after).forEach(k => {
    const a = norm(after[k]), b = norm(before[k]);
    if (/colour/.test(k) ? a.toLowerCase() !== b.toLowerCase() : a !== b) out[k] = after[k];
  });
  return out;
}

/* THE CROP: the largest rectangle of the frame's shape inside the picture, made smaller by the zoom, and moved
   across what is left over by fx and fy (0 to 1). Whole pixels, never off the picture. */
function cropRect(iw, ih, aspect, zoom, fx, fy) {
  let w, h;
  if (iw / ih > aspect) { h = ih; w = ih * aspect; } else { w = iw; h = iw / aspect; }
  const z = Math.max(1, zoom || 1);
  w = Math.round(w / z); h = Math.round(h / z);
  const cx = Math.min(1, Math.max(0, fx == null ? 0.5 : fx)), cy = Math.min(1, Math.max(0, fy == null ? 0.5 : fy));
  return { x: Math.round((iw - w) * cx), y: Math.round((ih - h) * cy), w, h };
}

const doc = root.document;
if (!doc) return { FIELDS, COVERS, diff, cropRect };

const CFG = () => root.EPINOIA_CONFIG || {};
const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
/* A MESSAGE IS SENTENCES, each its own text (so each is translated whole): an Error carries them as parts */
const fail = (...parts) => { const e = new Error(parts.join(' ')); e.parts = parts; return e; };

/* ------------------------------------------------------------------------------------------ the server --- */
async function session() {
  const A = root.EpinoiaAccess;
  if (!A) return null;
  try { return A.session() || (A.sessionReady ? await A.sessionReady() : null); } catch (_) { return null; }
}
const heads = (s, extra) => Object.assign({ apikey: CFG().supabaseAnonKey, Authorization: 'Bearer ' + s.token }, extra || {});
async function rpc(fn, body) {
  const s = await session();
  if (!s) throw new Error('Sign in again to save.');
  const r = await fetch(CFG().supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', body: JSON.stringify(body), headers: heads(s, { 'Content-Type': 'application/json' }) });
  const j = await r.json().catch(() => null);
  if (r.status === 404 || (j && j.code === 'PGRST202')) throw new Error('Editing from the page is not switched on here yet.');
  if (r.status === 401 || r.status === 403 || (j && j.code === '42501')) throw fail('You cannot edit this.', 'Sign in with the account that manages it.');
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || 'The server said ' + r.status + '.');
  return j;
}
async function read(path) {
  const s = await session();
  const r = await fetch(CFG().supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers: s ? heads(s) : { apikey: CFG().supabaseAnonKey } });
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0]);
  return r.json();
}
/* a picture, as upload.js names and sends it: <type>/<id>/<kind>-<stamp>.<ext>, then its pending media row */
async function putPicture(type, id, kind, blob, bucket) {
  const U = root.EpinoiaUpload;
  if (!U) throw new Error('The uploader did not load.');
  const out = await U.prepare(blob, kind);
  const ext = out.type === 'image/svg+xml' ? 'svg' : out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg';
  const stamp = Date.now().toString(36);
  const path = type + '/' + id + '/' + kind + '-' + stamp + '.' + ext;
  const s = await session();
  if (!s) throw new Error('Sign in again to save.');
  const send = async (p, b) => {
    const r = await fetch(CFG().supabaseUrl + '/storage/v1/object/' + bucket + '/' + p.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST', body: b, headers: heads(s, { 'Content-Type': out.type, 'x-upsert': 'false' }) });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw fail(...['The picture did not upload.'].concat(j && (j.message || j.error) ? [String(j.message || j.error)] : []));
    }
  };
  await send(path, out.main);
  if (!out.vector) await send(path.replace(/\.(\w+)$/, '-thumb.$1'), out.thumb).catch(() => { /* the main file is what shows */ });
  const r = await fetch(CFG().supabaseUrl + '/rest/v1/media', {
    method: 'POST', headers: heads(s, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ owner_type: type, owner_id: id, kind, storage_path: path, width: out.w || null, height: out.h || null,
                           bytes: out.main.size || null, status: 'pending' }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j[0]) throw fail(...['The picture uploaded, but could not be recorded.'].concat(j && j.message ? [String(j.message)] : []));
  return { id: j[0].id, path, colour: out.colour || null };
}
/* the crest a new one replaced, removed through the storage API (SQL may not delete a file) */
async function removeFiles(paths) {
  if (!paths || !paths.length) return;
  const s = await session();
  if (!s) return;
  const all = paths.concat(paths.map(p => p.replace(/\.(\w+)$/, '-thumb.$1')));
  try {
    await fetch(CFG().supabaseUrl + '/storage/v1/object/media-public', {
      method: 'DELETE', headers: heads(s, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: all }) });
  } catch (_) { /* an orphaned file is a few kilobytes nobody points at */ }
}
const publicUrl = p => (p ? (/^https?:/.test(p) ? p : CFG().supabaseUrl + '/storage/v1/object/public/media-public/' + p) : null);

/* --------------------------------------------------------------------------------------------- state --- */
const S = { subject: null, rights: null, venues: new Map(), opts: null, button: null };
const WHY = {
  value: 'That is not a value this detail can take.',
  field: 'That cannot be edited here.',
  taken: 'Another club in the league uses those initials.',
  media: 'The picture did not upload. Try again.',
  photo_review: 'Your photograph waits for the league’s approval.',
  no_entry: 'He is on no squad you manage, so there is no position to set.',
  not_found: 'That is no longer on the site.',
  patch: 'Nothing to save.'
};
const FIELD_NAME = {
  name: 'Name', short_name: 'Short name', initials: 'Initials', colour: 'First colour', colour_2: 'Second colour',
  first_name: 'First name', last_name: 'Last name', height_cm: 'Height', weight_kg: 'Weight', wingspan_cm: 'Wingspan',
  previous_club: 'Previous club', position: 'Position', address: 'Address', city: 'City', pin: 'Place on the map'
};
const refusal = r => {
  const w = WHY[r && r.reason] || 'That was not saved.';
  return r && r.field && FIELD_NAME[r.field] ? [FIELD_NAME[r.field], w] : [w];
};

/* WHICH OF suggest.js's DETAILS THIS PANEL TAKES: the subject's own, and the arena's when its rights are known.
   An arena not asked about yet is asked now, for the next time; until then it stays a suggestion. */
function covers(list) {
  if (!S.rights || !S.rights.edit) return false;
  return [].concat(list || []).some(c => {
    if (!c || !c.id) return false;
    if (c.type === 'venue') {
      if (!COVERS.venue.includes(c.field)) return false;
      if (!S.venues.has(c.id)) { askVenue(c.id); return false; }
      return !!(S.venues.get(c.id) || {}).edit;
    }
    return c.type === S.subject.type && c.id === S.subject.id && COVERS[c.type].includes(c.field);
  });
}
function askVenue(id) {
  if (!id || S.venues.has(id)) return;
  S.venues.set(id, null);
  rpc('admin_edit_rights', { p_type: 'venue', p_id: id })
    .then(r => { S.venues.set(id, r || { edit: false }); relabel(); })
    .catch(() => S.venues.set(id, { edit: false }));
}
function relabel() {
  const SG = root.EpinoiaSuggest;
  if (SG && SG.setEditor) SG.setEditor({ covers, open: (list, o) => open(list, o) });
}

async function mount(opts) {
  const o = opts || {};
  if (!o.id || !FIELDS[o.type]) return null;
  S.subject = { type: o.type, id: o.id, name: o.name || '' };
  S.opts = o;
  const s = await session();
  if (!s) return null;
  let r = null;
  try { r = await rpc('admin_edit_rights', { p_type: o.type, p_id: o.id }); } catch (_) { r = null; }
  if (!r || !r.edit) return null;
  S.rights = r;
  if (o.venue) askVenue(o.venue);
  doc.body.classList.add('ae-on');
  relabel();
  /* a page with no suggest button (a player under 18 is never offered one) gets its own */
  const host = typeof o.host === 'string' ? doc.querySelector(o.host) : o.host;
  if (host && !host.querySelector('.sg-btn')) {
    const b = el('button', 'ep-btn sg-btn sg-ed mini');
    b.type = 'button';
    b.setAttribute('data-i18n-ctx', 'adminedit');
    b.appendChild(el('span', 'sg-chip-i', '✎'));
    b.appendChild(el('span', null, 'edit'));
    b.title = 'Edit this page’s details: your changes go live at once';
    b.addEventListener('click', () => open([]));
    host.appendChild(b);
    S.button = b;
  }
  return r;
}

/* -------------------------------------------------------------------------------------------- the panel --- */
let openNow = null;
function field(host, label, value, attrs) {
  const w = host.appendChild(el('label', 'sg-field'));
  w.appendChild(el('span', 'sg-lab', label));
  const i = w.appendChild(el('input', 'sg-in'));
  i.type = 'text'; i.autocomplete = 'off';
  Object.assign(i, attrs || {});
  i.value = value == null ? '' : String(value);
  return i;
}
function section(host, title, note) {
  const s = host.appendChild(el('section', 'ae-sec'));
  const h = s.appendChild(el('div', 'ae-sec-h'));
  h.appendChild(el('h3', 'ae-sec-t', title));
  if (note) h.appendChild(el('p', 'sg-hint', note));
  return s;
}
const hex6 = v => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim()); return m ? '#' + m[1].toLowerCase() : null; };

/* a colour: the picker and its hex, kept in step; the second may be emptied (worked out from the first) */
function colourField(host, label, value, optional, onChange) {
  const w = host.appendChild(el('div', 'sg-field ae-colour'));
  w.appendChild(el('span', 'sg-lab', label));
  const row = w.appendChild(el('div', 'ae-colour-row'));
  const pick = row.appendChild(el('input', 'ae-pick'));
  pick.type = 'color'; pick.value = hex6(value) || '#93f2bf';
  pick.setAttribute('aria-label', label);
  const txt = row.appendChild(data('input', 'sg-in ae-hex'));
  txt.type = 'text'; txt.maxLength = 7; txt.autocomplete = 'off'; txt.spellcheck = false;
  txt.value = hex6(value) || '';
  txt.placeholder = optional ? 'none' : '#93f2bf';
  pick.addEventListener('input', () => { txt.value = pick.value; onChange(); });
  txt.addEventListener('input', () => { const h = hex6(txt.value); if (h) pick.value = h; onChange(); });
  if (optional) {
    const clr = row.appendChild(el('button', 'ep-btn mini ae-clear', 'none'));
    clr.type = 'button';
    clr.title = 'No second colour: the site works one out from the first';
    clr.addEventListener('click', () => { txt.value = ''; onChange(); });
  }
  return { get: () => txt.value.trim(), set: v => { txt.value = v || ''; if (hex6(v)) pick.value = hex6(v); onChange(); } };
}

/* THE CREST: what it is now on the badge's white disc, and what a new file would look like there, fitted whole */
function crestField(host, current, onPick) {
  const w = host.appendChild(el('div', 'ae-pic'));
  const discs = w.appendChild(el('div', 'ae-discs'));
  const disc = (cls, url, cap) => {
    const f = discs.appendChild(el('figure', 'ae-disc-f'));
    const d = f.appendChild(el('div', 'ae-disc ' + cls));
    if (url) { const i = d.appendChild(el('img')); i.alt = ''; i.src = url; i.addEventListener('error', () => i.remove()); }
    f.appendChild(el('figcaption', 'sg-lab', cap));
    return d;
  };
  disc('now', publicUrl(current), 'now');
  const next = disc('next', null, 'new');
  next.parentNode.hidden = true;
  const lab = w.appendChild(el('label', 'sg-field'));
  lab.appendChild(el('span', 'sg-lab', 'A new crest'));
  const f = lab.appendChild(el('input', 'sg-in sg-file'));
  f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  w.appendChild(el('p', 'sg-hint', 'PNG, WebP or SVG with a transparent background is best. It is shown whole on the white disc, as above.'));
  let file = null, url = null;
  f.addEventListener('change', () => {
    if (url) URL.revokeObjectURL(url);
    file = f.files && f.files[0] || null;
    next.textContent = ''; next.parentNode.hidden = !file;
    if (!file) return;
    url = URL.createObjectURL(file);
    const i = next.appendChild(el('img')); i.alt = ''; i.src = url;
    onPick(url, file);
  });
  return { file: () => file, clear: () => { file = null; f.value = ''; next.textContent = ''; next.parentNode.hidden = true; } };
}

/* THE PHOTOGRAPH: the new picture in the profile's 4:5 frame, dragged into place and zoomed, cut here so the page
   shows exactly what was framed */
function photoField(host, current, review) {
  const w = host.appendChild(el('div', 'ae-pic'));
  const frames = w.appendChild(el('div', 'ae-frames'));
  const nowF = frames.appendChild(el('figure', 'ae-frame-f'));
  const nowB = nowF.appendChild(el('div', 'ae-frame'));
  if (current) { const i = nowB.appendChild(el('img')); i.alt = ''; i.src = publicUrl(current); i.addEventListener('error', () => i.remove()); }
  else nowB.appendChild(el('span', 'ae-none', 'no photograph'));
  nowF.appendChild(el('figcaption', 'sg-lab', 'now'));
  const newF = frames.appendChild(el('figure', 'ae-frame-f'));
  const cv = newF.appendChild(el('canvas', 'ae-frame ae-crop'));
  cv.width = 320; cv.height = 400;
  cv.setAttribute('aria-label', 'Drag the picture to place it in the frame');
  newF.appendChild(el('figcaption', 'sg-lab', 'new: drag to place'));
  newF.hidden = true;
  const lab = w.appendChild(el('label', 'sg-field'));
  lab.appendChild(el('span', 'sg-lab', 'A new photograph'));
  const f = lab.appendChild(el('input', 'sg-in sg-file'));
  f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp';
  const zl = w.appendChild(el('label', 'sg-field ae-zoom'));
  zl.appendChild(el('span', 'sg-lab', 'Zoom'));
  const zoom = zl.appendChild(el('input', 'ae-range'));
  zoom.type = 'range'; zoom.min = '1'; zoom.max = '3'; zoom.step = '0.01'; zoom.value = '1';
  zl.hidden = true;
  w.appendChild(el('p', 'sg-hint', review
    ? 'A clear picture of the player alone. As a club’s manager, yours waits for the league’s approval before it shows.'
    : 'A clear picture of the player alone, the face in the upper part of the frame.'));
  let bmp = null, fx = 0.5, fy = 0.3;
  const draw = () => {
    if (!bmp) return;
    const r = cropRect(bmp.width, bmp.height, PHOTO_ASPECT, Number(zoom.value), fx, fy);
    const cx = cv.getContext('2d');
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
  };
  f.addEventListener('change', async () => {
    const file = f.files && f.files[0];
    bmp = null; newF.hidden = zl.hidden = !file;
    if (!file) return;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) { try { bmp = await createImageBitmap(file); } catch (__) { bmp = null; } }
    fx = 0.5; fy = 0.3; zoom.value = '1';
    draw();
  });
  zoom.addEventListener('input', draw);
  let drag = null;
  cv.addEventListener('pointerdown', e => { if (!bmp) return; drag = [e.clientX, e.clientY]; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag || !bmp) return;
    const r = cropRect(bmp.width, bmp.height, PHOTO_ASPECT, Number(zoom.value), fx, fy);
    const box = cv.getBoundingClientRect();
    const k = r.w / Math.max(1, box.width);           // picture pixels per screen pixel
    const dx = (e.clientX - drag[0]) * k, dy = (e.clientY - drag[1]) * k;
    if (bmp.width > r.w) fx = Math.min(1, Math.max(0, fx - dx / (bmp.width - r.w)));
    if (bmp.height > r.h) fy = Math.min(1, Math.max(0, fy - dy / (bmp.height - r.h)));
    drag = [e.clientX, e.clientY];
    draw();
  });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  /* the framed part at full resolution (at most 1600 tall: upload.js brings it down to the profile's size) */
  const cut = () => new Promise(res => {
    if (!bmp) return res(null);
    const r = cropRect(bmp.width, bmp.height, PHOTO_ASPECT, Number(zoom.value), fx, fy);
    const k = Math.min(1, 1600 / r.h);
    const out = el('canvas'); out.width = Math.max(1, Math.round(r.w * k)); out.height = Math.max(1, Math.round(r.h * k));
    const cx = out.getContext('2d'); cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
    out.toBlob(b => res(b), 'image/jpeg', 0.92);
  });
  return { has: () => !!bmp, cut, clear: () => { bmp = null; f.value = ''; newF.hidden = zl.hidden = true; } };
}

/* a measure in whole cm or kg, with the other units beside it as it is typed */
function measureField(host, label, value, unit, min, max) {
  const w = host.appendChild(el('label', 'sg-field'));
  w.appendChild(el('span', 'sg-lab', label + ' (' + unit + ')'));
  const i = w.appendChild(el('input', 'sg-in'));
  i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = 3; i.autocomplete = 'off';
  i.value = value == null ? '' : String(Math.round(value));
  const alt = w.appendChild(data('span', 'ae-alt'));
  const U = root.EpinoiaUnits;
  const show = () => {
    const n = Number(i.value);
    alt.textContent = !i.value.trim() ? '' : !(n >= min && n <= max) ? min + '–' + max + ' ' + unit
      : U ? (unit === 'kg' ? U.weight(n, 'imperial') : U.height(n, 'imperial')) : '';
  };
  i.addEventListener('input', show); show();
  return i;
}

function open(list, opts) {
  if (!S.rights || !S.rights.edit) return null;
  const o = opts || {};
  const first = [].concat(list || []).find(c => c && (c.type === 'venue' ? COVERS.venue.includes(c.field) : COVERS[c.type] && COVERS[c.type].includes(c.field)));
  const venueId = ([].concat(list || []).find(c => c && c.type === 'venue') || {}).id || S.opts.venue || null;
  if (openNow) { try { openNow.close(); } catch (_) { /* gone */ } }
  const dlg = doc.body.appendChild(el('dialog', 'sg-dlg ae-dlg'));
  dlg.setAttribute('data-i18n-ctx', 'adminedit suggest');
  dlg.setAttribute('aria-labelledby', 'aeTitle');
  openNow = dlg;
  const form = dlg.appendChild(el('form', 'sg-form'));
  form.method = 'dialog'; form.noValidate = true;
  const head = form.appendChild(el('div', 'sg-head'));
  head.appendChild(el('div', 'sg-kick', S.subject.type === 'team' ? 'Edit the club' : 'Edit the player'));
  const title = head.appendChild(data('div', 'sg-title', S.subject.name || o.title || ''));
  title.id = 'aeTitle';
  head.appendChild(el('p', 'sg-sub', {
    platform: 'You are a platform administrator. What you save is live at once, and written to the audit log.',
    league: 'You administer this league. What you save is live at once, and written to the audit log.',
    club: 'You manage this club. What you save is live at once, and written to the audit log.'
  }[S.rights.role] || ''));
  const main = form.appendChild(el('div', 'sg-main'));
  main.appendChild(el('p', 'sg-status', 'Loading…'));
  const status = el('p', 'sg-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const acts = el('div', 'sg-acts');
  const cancel = acts.appendChild(el('button', 'ep-btn', 'Cancel')); cancel.type = 'button';
  const save = acts.appendChild(el('button', 'ep-btn pri', 'Save')); save.type = 'submit';
  cancel.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { dlg.remove(); if (openNow === dlg) openNow = null; });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  const say = (t, cls) => {
    status.textContent = '';
    [].concat(t || []).forEach((x, i) => status.appendChild(el('span', i ? 'ae-part' : null, x)));
    status.className = 'sg-status' + (cls ? ' ' + cls : '');
  };
  try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }

  (S.subject.type === 'team' ? teamForm : playerForm)(main, venueId).then(form2 => {
    main.appendChild(status); main.appendChild(acts);
    /* from a chip (one detail), straight to it; from the button (every detail), the top */
    const at = first && [].concat(list || []).length === 1 && form2.focus[first.field];
    if (at) setTimeout(() => { try { at.scrollIntoView({ block: 'center' }); at.focus({ preventScroll: true }); } catch (_) { /* fine */ } }, 40);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      save.disabled = true;
      say('Saving…');
      try {
        const msg = await form2.save(say);
        say(msg || 'Saved.', 'ok');
        cancel.textContent = 'Close';
        save.disabled = false;
      } catch (err) {
        save.disabled = false;
        say(err.parts || err.message || String(err), 'err');
      }
    });
  }).catch(err => { main.textContent = ''; main.appendChild(el('p', 'sg-status err', err.message || String(err))); main.appendChild(acts); save.remove(); });
  return dlg;
}

/* ------------------------------------------------------------------------------------------- a club --- */
async function teamForm(main, venueId) {
  const id = S.subject.id;
  const [t] = await read('teams?id=eq.' + id + '&select=id,name,short_name,initials,colour,colour_2,colour_source,logo_path&limit=1');
  if (!t) throw new Error('That is no longer on the site.');
  const vr = venueId ? S.venues.get(venueId) : null;
  let v = null;
  if (vr && vr.edit) { try { [v] = await read('venues?id=eq.' + venueId + '&select=id,name,address,city,lat,lng&limit=1'); } catch (_) { v = null; } }
  main.textContent = '';
  const focus = {};

  const club = section(main, 'The club');
  const g = club.appendChild(el('div', 'ae-grid'));
  const name = field(g, 'Name', t.name, { maxLength: 80 });
  const short = field(g, 'Short name', t.short_name, { maxLength: 40 });
  const ini = field(g, 'Initials', t.initials, { maxLength: 4, placeholder: 'auto' });
  ini.classList.add('ae-ini');
  club.appendChild(el('p', 'sg-hint', 'The short name is used where the full one will not fit. Initials (2 to 4 letters or digits) stand in for the crest on a narrow screen; empty, the site works them out.'));

  const col = section(main, 'Colours', 'The page, the cards and the graphics take these.');
  const sw = col.appendChild(el('div', 'ae-swatch'));
  const swA = sw.appendChild(el('span', 'ae-sw-a')), swB = sw.appendChild(el('span', 'ae-sw-b'));
  const swN = sw.appendChild(data('span', 'ae-sw-n', t.name));
  const paint = () => {
    const a = hex6(c1.get()) || '#93f2bf', b = hex6(c2.get());
    swA.style.background = a; swB.style.background = b || a;
    swN.textContent = name.value.trim() || t.name;
  };
  const cg = col.appendChild(el('div', 'ae-grid two'));
  const c1 = colourField(cg, 'First colour', t.colour, false, () => paint());
  const c2 = colourField(cg, 'Second colour', t.colour_2, true, () => paint());
  name.addEventListener('input', paint);
  paint();

  const cr = section(main, 'Crest');
  let fromCrest = null;
  const useCol = el('button', 'ep-btn mini ae-usecol', 'use the crest’s colours');
  useCol.type = 'button'; useCol.hidden = true;
  const crest = crestField(cr, t.logo_path, url => {
    fromCrest = null; useCol.hidden = true;
    const TC = root.EpinoiaTeamColour;
    if (TC && TC.fromImage) TC.fromImage(url).then(p => { if (p && p.primary) { fromCrest = p; useCol.hidden = false; } }).catch(() => {});
  });
  cr.appendChild(useCol);
  useCol.addEventListener('click', () => { if (fromCrest) { c1.set(fromCrest.primary); c2.set(fromCrest.secondary || ''); } });
  focus.photo = cr.querySelector('input[type=file]');

  let vin = null;
  if (v) {
    const ar = section(main, 'The arena', 'The arena itself: every club that plays there, and EPINOIA GO, shows the change.');
    const ag = ar.appendChild(el('div', 'ae-grid'));
    vin = {
      name: field(ag, 'Arena name', v.name, { maxLength: 200 }),
      address: field(ag, 'Address', v.address, { maxLength: 200 }),
      city: field(ag, 'City', v.city, { maxLength: 80 }),
      pin: field(ag, 'Place on the map', v.lat != null ? Number(v.lat).toFixed(6) + ', ' + Number(v.lng).toFixed(6) : '', { placeholder: '41.3809, 2.1206' })
    };
    ar.appendChild(el('p', 'sg-hint', 'In Google Maps, right-click the arena and click the two numbers at the top of the menu: they are copied. Paste them here. A Google Maps link to the arena works too.'));
    focus.venue_name = vin.name; focus.venue_address = vin.address; focus.venue_city = vin.city; focus.venue_pin = vin.pin;
  }

  const save = async say => {
    const c1v = c1.get(), c2v = c2.get();
    if (!hex6(c1v)) throw fail('First colour', 'A colour is a hex code such as #93f2bf.');
    if (c2v && !hex6(c2v)) throw fail('Second colour', 'A colour is a hex code such as #93f2bf, or none.');
    if (name.value.trim().length < 2) throw fail('Name', 'Two characters at least.');
    const patch = diff({ name: t.name, short_name: t.short_name, initials: t.initials, colour: t.colour, colour_2: t.colour_2 },
                       { name: name.value, short_name: short.value, initials: ini.value.toUpperCase(), colour: hex6(c1v), colour_2: hex6(c2v) || '' });
    let vpatch = {};
    if (vin) {
      const SG = root.EpinoiaSuggest;
      const pinTxt = vin.pin.value.trim();
      const pin = pinTxt ? (SG && SG.readPin ? SG.readPin(pinTxt) : pinTxt) : null;
      if (pinTxt && !pin) throw fail('Place on the map', 'Paste the two numbers from Google Maps, or its link.');
      vpatch = diff({ name: v.name, address: v.address, city: v.city }, { name: vin.name.value, address: vin.address.value, city: vin.city.value });
      const was = v.lat != null ? Number(v.lat).toFixed(6) + ',' + Number(v.lng).toFixed(6) : '';
      if (pin && pin !== was) vpatch.pin = pin;
    }
    const file = crest.file();
    if (!Object.keys(patch).length && !Object.keys(vpatch).length && !file) return 'Nothing has changed.';
    if (file) {
      say('Uploading the crest…');
      const up = await putPicture('team', id, 'logo', file, 'media-public');
      patch.logo_media = up.id;
    }
    let out = null;
    if (Object.keys(patch).length) {
      out = await rpc('admin_edit_team', { p_team: id, p_patch: patch });
      if (!out || out.ok === false) throw fail(...refusal(out));
      removeFiles(out.orphans || []);
      crest.clear();
      Object.assign(t, out.team || {});
      S.subject.name = t.name;
      paintTeam(t);
    }
    if (Object.keys(vpatch).length) {
      const vo = await rpc('admin_edit_venue', { p_venue: v.id, p_patch: vpatch });
      if (!vo || vo.ok === false) throw fail(...(out ? ['The club is saved; the arena is not.'] : []), ...refusal(vo));
      /* the arena card is drawn from several sources (the club's typed copy, its home games): drawn again from the top */
      setTimeout(() => root.location.reload(), 700);
      return ['Saved.', 'The page reloads to show the arena.'];
    }
    if (typeof S.opts.onSaved === 'function' && out) { try { S.opts.onSaved(out.team); } catch (_) { /* the page's business */ } }
    return ['Saved.', 'It is live.'];
  };
  return { save, focus };
}

/* THE CLUB'S PAGE, redrawn where it shows what was saved: the name, the crest, the colours */
function paintTeam(t) {
  const nm = doc.getElementById('tname');
  if (nm) nm.textContent = t.name;
  if (!doc.querySelector('meta[name="epinoia-entity"]')) doc.title = t.name + ' · Epinoia';
  const badge = doc.getElementById('badge');
  const url = root.epinoiaLogoUrl ? root.epinoiaLogoUrl(t.logo_path) : publicUrl(t.logo_path);
  if (badge && url) {
    let img = badge.querySelector('img');
    if (!img) { img = el('img'); img.alt = ''; badge.appendChild(img); }
    img.addEventListener('load', () => { [...badge.childNodes].forEach(n => { if (n !== img && !(n.classList && n.classList.contains('sg-chip'))) n.remove(); }); badge.classList.add('has-crest'); }, { once: true });
    img.src = url;
  }
  const TC = root.EpinoiaTeamColour;
  if (TC && t.colour) {
    const custom = String(t.colour).toLowerCase() !== '#93f2bf';
    doc.documentElement.style.setProperty('--team-a', t.colour);
    if (custom && TC.apply(doc.documentElement, t.colour, t.colour_2)) doc.body.classList.add('themed');
  }
}

/* ------------------------------------------------------------------------------------------ a player --- */
async function playerForm(main) {
  const id = S.subject.id;
  const [p] = await read('players?id=eq.' + id + '&select=id,first_name,last_name,height_cm,weight_kg,wingspan_cm,previous_club,photo_media_id&limit=1');
  if (!p) throw new Error('That is no longer on the site.');
  let pos = null, photo = null;
  try { const re = await read('roster_entries?player_id=eq.' + id + '&active=eq.true&select=position&order=created_at.desc&limit=1'); pos = re[0] ? re[0].position : null; } catch (_) { /* none */ }
  if (p.photo_media_id) {
    try { const md = await read('media?id=eq.' + p.photo_media_id + '&status=eq.approved&select=storage_path&limit=1'); photo = md[0] ? md[0].storage_path : null; } catch (_) { /* none */ }
  }
  main.textContent = '';
  const focus = {};
  const nm = section(main, 'Name');
  const ng = nm.appendChild(el('div', 'ae-grid two'));
  const fn = field(ng, 'First name', p.first_name, { maxLength: 60 });
  const ln = field(ng, 'Last name', p.last_name, { maxLength: 60 });
  focus.name = focus.first_name = fn; focus.last_name = ln;

  const review = S.rights.photo === 'review';
  const ph = section(main, 'Photograph');
  const pic = photoField(ph, photo, review);
  focus.photo = ph.querySelector('input[type=file]');

  const ms = section(main, 'Measures and position');
  const mg = ms.appendChild(el('div', 'ae-grid'));
  const ht = measureField(mg, 'Height', p.height_cm, 'cm', 100, 260);
  const wt = measureField(mg, 'Weight', p.weight_kg, 'kg', 30, 250);
  const ws = measureField(mg, 'Wingspan', p.wingspan_cm, 'cm', 120, 280);
  const pw = mg.appendChild(el('label', 'sg-field'));
  pw.appendChild(el('span', 'sg-lab', 'Position'));
  const ps = pw.appendChild(el('select', 'sg-in'));
  ps.appendChild(el('option', null, '—')).value = '';
  const POS = (root.EpinoiaSuggest && root.EpinoiaSuggest.POSITIONS) || [];
  POS.forEach(([k, n]) => { const op = ps.appendChild(el('option', null, k + ' · ' + n)); op.value = k; });
  /* a position the league writes its own way (not one of the game's) stays as it is unless another is chosen */
  if (pos && !POS.some(x => x[0] === pos)) { const op = ps.appendChild(data('option', null, pos)); op.value = pos; }
  ps.value = pos || '';
  const pc = field(mg, 'Previous club', p.previous_club, { maxLength: 80 });
  focus.height_cm = ht; focus.weight_kg = wt; focus.wingspan_cm = ws; focus.position = ps; focus.previous_club = pc;

  const save = async say => {
    if (!fn.value.trim()) throw fail('First name', 'It cannot be empty.');
    const patch = diff({ first_name: p.first_name, last_name: p.last_name, height_cm: p.height_cm, weight_kg: p.weight_kg,
                         wingspan_cm: p.wingspan_cm, previous_club: p.previous_club, position: pos || '' },
                       { first_name: fn.value, last_name: ln.value, height_cm: ht.value, weight_kg: wt.value, wingspan_cm: ws.value,
                         previous_club: pc.value, position: ps.value });
    let note = null;
    if (pic.has()) {
      say('Uploading the photograph…');
      const blob = await pic.cut();
      if (!blob) throw fail('The picture could not be read.');
      if (review) {
        await putPicture('player', id, 'photo', blob, 'media-pending');
        pic.clear();
        note = 'The photograph waits in the league’s Photographs queue.';
      } else {
        const up = await putPicture('player', id, 'photo', blob, 'media-public');
        patch.photo_media = up.id;
      }
    }
    if (!Object.keys(patch).length) return note ? ['Sent.', note] : 'Nothing has changed.';
    const out = await rpc('admin_edit_player', { p_player: id, p_patch: patch });
    if (!out || out.ok === false) throw fail(...refusal(out));
    pic.clear();
    const row = out.player || {};
    Object.assign(p, row); pos = row.position || null;
    if (row.photo_path) photo = row.photo_path;
    S.subject.name = [row.first_name, row.last_name].filter(Boolean).join(' ');
    paintPlayer(row);
    if (typeof S.opts.onSaved === 'function') { try { S.opts.onSaved(row); } catch (_) { /* the page's business */ } }
    return ['Saved.', 'It is live.'].concat(note ? [note] : []);
  };
  return { save, focus };
}

/* THE PLAYER'S PAGE, redrawn where it shows what was saved: his name and his photograph (the page redraws the rest) */
function paintPlayer(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
  const h1 = doc.getElementById('name');
  if (h1 && name) {
    [...h1.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
    h1.insertBefore(doc.createTextNode(name), h1.firstChild);
  }
  if (name && !doc.querySelector('meta[name="epinoia-entity"]')) doc.title = name + ' · Epinoia';
  const box = doc.getElementById('photo');
  if (box && row.photo_path) {
    let img = box.querySelector('img');
    if (!img) {
      img = el('img'); img.alt = name;
      const ini = doc.getElementById('ini'); if (ini) ini.remove();
      box.insertBefore(img, box.firstChild);
    }
    img.src = publicUrl(row.photo_path);
  }
}

return { mount, open, covers, FIELDS, COVERS, diff, cropRect };
}));
