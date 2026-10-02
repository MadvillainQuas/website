'use strict';
/* ============================================================================
   SUGGEST AN EDIT (0199).   window.EpinoiaSuggest

   The details only a club, a league or the platform may change - a player's name, height, weight, wingspan,
   position and previous club, a player's photograph and a club's crest, the coaching staff, an arena's name,
   address, city and place on the map - can be SUGGESTED by any signed-in fan, from the page they are reading.

   Hovering one of them (a mouse) shows "suggest an edit" on its corner; every page that has them also has a
   "suggest an edit" button beside its follow bell, which is how a touch screen gets there and how a fan
   reaches a detail the page does not show (a wingspan, a previous club, a coach nobody has listed). The
   dialog asks for the new value in the form the database keeps it - a height typed in feet and inches goes
   in as centimetres - with a note and a source, and sends it to the moderators of the league it belongs to
   and to the platform's. Nothing on the page changes until one of them accepts it; the fan hears what they
   decided in their notifications. A player under 18 is never offered: their details are the league's alone.

     attach(node, choice | [choices], opts?)   the hover chip on a detail (opts.at: 'inset' inside the box,
                                              for a photograph whose frame clips; 'icon' the pencil alone,
                                              for a crest too small for the words; 'top' inside at the top,
                                              over a map whose links hold the bottom; else on its corner)
     button(choices | () => choices, opts?)   the page's "suggest an edit" button (a list: a picker first)
     open(choices, opts?)                     the dialog itself
     setEditor({ covers(choices), open(choices, opts) })
                                              someone who may change a detail directly (adminedit.js, 0214):
                                              the chips and the button read "edit" and open their panel
                                              for every detail it covers; the rest stay suggestions
     choice = { type: 'player'|'team'|'staff'|'venue', id, field, subject, current?, label? }

   For the test (supabase/tests/suggestions.test.mjs):  toCm(ft, in)  toKg(lb)  readPin(text)  FIELDS  REASONS
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSuggest = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const CFG = () => root.EPINOIA_CONFIG || {};
const LB_PER_KG = 2.20462;

/* ---------------------------------------------------------------- the fields --- */
const POSITIONS = [['PG', 'Point guard'], ['SG', 'Shooting guard'], ['SF', 'Small forward'], ['PF', 'Power forward'],
                   ['C', 'Centre'], ['G', 'Guard'], ['F', 'Forward'], ['G/F', 'Guard / forward'], ['F/C', 'Forward / centre']];
const ROLES = ['Head Coach', 'Assistant Coach', 'Associate Head Coach', 'Player Development', 'General Manager', 'Team Manager',
               'Strength and Conditioning', 'Physiotherapist', 'Doctor', 'Video Analyst', 'Scout', 'Equipment Manager'];
/* what each detail is called, the form it is asked in, and its bounds (the database's own, 0199 suggestion_value) */
const FIELDS = {
  name:          { label: 'name', kind: 'name' },                      // first and last, sent as one or two
  first_name:    { label: 'first name', kind: 'text', max: 60 },
  last_name:     { label: 'last name', kind: 'text', max: 60 },
  height_cm:     { label: 'height', kind: 'length', min: 100, max: 260 },
  wingspan_cm:   { label: 'wingspan', kind: 'length', min: 120, max: 280 },
  weight_kg:     { label: 'weight', kind: 'mass', min: 30, max: 250 },
  position:      { label: 'position', kind: 'position' },
  previous_club: { label: 'previous club', kind: 'text', max: 80 },
  photo:         { label: 'photograph', kind: 'photo' },
  staff_add:     { label: 'a coach or member of staff', kind: 'staff_add' },
  staff_name:    { label: 'name', kind: 'text', max: 60 },
  staff_role:    { label: 'role', kind: 'text', max: 80, list: ROLES },
  staff_remove:  { label: 'no longer with the club', kind: 'remove' },
  venue_name:    { label: 'arena name', kind: 'text', max: 200 },
  venue_address: { label: 'address', kind: 'text', max: 200 },
  venue_city:    { label: 'city', kind: 'text', max: 80 },
  venue_pin:     { label: 'place on the map', kind: 'pin' }
};
/* why the database said no, in words (suggest_edit / suggest_photo's reasons) */
const REASONS = {
  signed_out: 'Sign in to suggest an edit.',
  field: 'That cannot be suggested here.',
  not_found: 'That is no longer on the site.',
  withheld: 'The details of a player under 18 are the league’s alone.',
  note: 'The note is too long: 400 characters at most.',
  source: 'The source must be a web address (https://…).',
  words: 'That has a word in it the site does not allow.',
  same: 'That is what it says already.',
  too_many: 'You have a lot waiting already. Give the moderators a little time.',
  path: 'The picture did not upload. Try again.',
  no_file: 'The picture did not upload. Try again.'
};
const VALUE = {
  height_cm: 'A height between 100 and 260 cm (3′3″ and 8′6″).',
  wingspan_cm: 'A wingspan between 120 and 280 cm.',
  weight_kg: 'A weight between 30 and 250 kg (66 and 551 lb).',
  position: 'Choose one of the positions.',
  first_name: 'A name is letters (and spaces, hyphens and apostrophes).',
  last_name: 'A name is letters (and spaces, hyphens and apostrophes).',
  staff_name: 'A name is letters (and spaces, hyphens and apostrophes), three at least.',
  staff_role: 'A role is 2 to 80 characters.',
  staff_add: 'A name (letters) and a role, both.',
  previous_club: 'A club’s name is 2 to 80 characters.',
  venue_name: 'An arena’s name is 3 to 200 characters.',
  venue_address: 'An address is 3 to 200 characters.',
  venue_city: 'A city is 2 to 80 characters.',
  venue_pin: 'Paste the arena’s place from Google Maps: two numbers, such as 41.3809, 2.1206, or its link.'
};

/* ----------------------------------------------------------- conversions --- */
/* feet and inches to whole centimetres; null when nothing was typed */
function toCm(ft, inch) {
  const f = Number(ft) || 0, i = Number(inch) || 0;
  if (f <= 0 && i <= 0) return null;
  return Math.round((f * 12 + i) * 2.54);
}
const toKg = lb => { const n = Number(lb); return n > 0 ? Math.round(n / LB_PER_KG) : null; };
/* A PLACE ON THE MAP, from what a fan can copy out of Google Maps: the two numbers a right-click gives
   ("41.3809, 2.1206"), or a link - whose !3d…!4d… is the place itself and wins over @…, which is only where
   the map was looking. null for anything else, or for a point off the Earth or at 0,0. */
function readPin(text) {
  const t = String(text || '').trim();
  const m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t) ||
            /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(t) ||
            /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i.exec(t) ||
            /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const la = Number(m[1]), lo = Number(m[2]);
  if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180) || (la === 0 && lo === 0)) return null;
  return la.toFixed(6) + ',' + lo.toFixed(6);
}

/* -------------------------------------------------------------- the page --- */
const doc = root.document;
const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const units = () => (root.EpinoiaUnits && root.EpinoiaUnits.get && root.EpinoiaUnits.get()) || 'metric';
const labelOf = c => c.label || (c.field === 'photo' && c.type === 'team' ? 'crest' : (FIELDS[c.field] || {}).label || c.field);

/* what it says now, for "Now:" - in the reader's units where it is a measure */
function nowText(c) {
  const v = c.current;
  if (v == null || v === '') return null;
  const U = root.EpinoiaUnits;
  if (c.field === 'height_cm' || c.field === 'wingspan_cm') {
    return U && units() === 'imperial' ? U.height(v, 'imperial') + ' (' + Math.round(v) + ' cm)' : Math.round(v) + ' cm';
  }
  if (c.field === 'weight_kg') return U && units() === 'imperial' ? U.weight(v, 'imperial') + ' (' + Math.round(v) + ' kg)' : Math.round(v) + ' kg';
  if (c.field === 'name') return [v.first, v.last].filter(Boolean).join(' ') || null;
  if (c.field === 'photo' || c.field === 'staff_add') return null;
  return String(v);
}

/* ------------------------------------------------------------ the server --- */
async function session() {
  const A = root.EpinoiaAccess;
  if (!A) return null;
  try { return A.session() || (A.sessionReady ? await A.sessionReady() : null); } catch (_) { return null; }
}
async function rpc(fn, body, sess) {
  const c = CFG();
  const send = s => fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', body: JSON.stringify(body),
    headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' } });
  let r = await send(sess);
  /* the token can rotate between the dialog opening and the send (another tab refreshing it): once more */
  if (r.status === 401) { const s2 = await session(); if (s2) r = await send(s2); }
  const j = await r.json().catch(() => null);
  if (r.status === 404 || (j && j.code === 'PGRST202')) throw new Error('Suggestions are not switched on here yet.');
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || 'The server said ' + r.status + '.');
  return j;
}
/* a file into the private bucket, in the subject's own folder, named suggested-… (the storage policy, 0199) */
async function put(path, blob, type, sess) {
  const c = CFG();
  const r = await fetch(c.supabaseUrl + '/storage/v1/object/media-pending/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', body: blob,
    headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + sess.token, 'Content-Type': type, 'x-upsert': 'false' } });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error('The picture did not upload' + (j && (j.message || j.error) ? ': ' + (j.message || j.error) : '') + '.');
  }
}
function stamp() {
  const a = new Uint8Array(12);
  (root.crypto && root.crypto.getRandomValues ? root.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }));
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

/* --------------------------------------------------------------- the forms --- */
/* each builds its inputs into `host` and returns read(): { calls: [{ field, value }] } or { error } */
function textInput(host, label, value, attrs) {
  const w = host.appendChild(el('label', 'sg-field'));
  w.appendChild(el('span', 'sg-lab', label));
  const i = w.appendChild(el('input', 'sg-in'));
  i.type = 'text';
  Object.assign(i, attrs || {});
  if (value != null) i.value = value;
  return i;
}
function listFor(values) {
  const id = 'sg-list-' + values.length;
  if (!doc.getElementById(id)) {
    const dl = doc.body.appendChild(el('datalist')); dl.id = id;
    values.forEach(v => { const o = dl.appendChild(el('option')); o.value = v; });
  }
  return id;
}

const FORMS = {
  text(host, c) {
    const f = FIELDS[c.field];
    const i = textInput(host, 'Suggested ' + labelOf(c), c.current == null ? '' : String(c.current), { maxLength: f.max || 200, autocomplete: 'off' });
    if (f.list) i.setAttribute('list', listFor(f.list));
    return () => {
      const v = i.value.replace(/\s+/g, ' ').trim();
      return v ? { calls: [{ field: c.field, value: v }] } : { error: 'Type what it should say.' };
    };
  },
  name(host, c) {
    const cur = c.current || {};
    const a = textInput(host, 'First name', cur.first || '', { maxLength: 60, autocomplete: 'off' });
    const b = textInput(host, 'Last name', cur.last || '', { maxLength: 60, autocomplete: 'off' });
    return () => {
      const clean = s => s.replace(/\s+/g, ' ').trim();
      const calls = [];
      if (clean(a.value) !== clean(cur.first || '')) calls.push({ field: 'first_name', value: clean(a.value) });
      if (clean(b.value) !== clean(cur.last || '')) calls.push({ field: 'last_name', value: clean(b.value) });
      if (calls.some(x => !x.value)) return { error: 'A first and a last name, both.' };
      return calls.length ? { calls } : { error: REASONS.same };
    };
  },
  length(host, c) { return measure(host, c, 'length'); },
  mass(host, c) { return measure(host, c, 'mass'); },
  position(host, c) {
    const w = host.appendChild(el('label', 'sg-field'));
    w.appendChild(el('span', 'sg-lab', 'Suggested position'));
    const s = w.appendChild(el('select', 'sg-in'));
    s.appendChild(el('option', null, '—')).value = '';
    POSITIONS.forEach(([k, name]) => { const o = s.appendChild(el('option', null, k + ' · ' + name)); o.value = k; });
    return () => (s.value ? { calls: [{ field: 'position', value: s.value }] } : { error: VALUE.position });
  },
  pin(host, c) {
    const i = textInput(host, 'The arena’s place', '', { placeholder: '41.3809, 2.1206', autocomplete: 'off', inputMode: 'text' });
    host.appendChild(el('p', 'sg-hint',
      'In Google Maps, right-click the arena and click the two numbers at the top of the menu: they are copied. ' +
      'Paste them here. A Google Maps link to the arena works too.'));
    return () => { const v = readPin(i.value); return v ? { calls: [{ field: 'venue_pin', value: v }] } : { error: VALUE.venue_pin }; };
  },
  staff_add(host, c) {
    const a = textInput(host, 'Name', '', { maxLength: 60, autocomplete: 'off' });
    const b = textInput(host, 'Role', '', { maxLength: 80, autocomplete: 'off', placeholder: 'Head Coach' });
    b.setAttribute('list', listFor(ROLES));
    return () => {
      const n = a.value.replace(/\s+/g, ' ').trim(), r = b.value.replace(/\s+/g, ' ').trim();
      return n && r ? { calls: [{ field: 'staff_add', value: JSON.stringify({ name: n, role: r }) }] } : { error: VALUE.staff_add };
    };
  },
  remove(host, c) {
    host.appendChild(el('p', 'sg-hint', 'Say that this person has left the club. A note on where you read it helps the moderators.'));
    return () => ({ calls: [{ field: 'staff_remove', value: 'remove' }] });
  },
  photo(host, c) {
    const crest = c.type === 'team';
    const w = host.appendChild(el('label', 'sg-field'));
    w.appendChild(el('span', 'sg-lab', crest ? 'The club’s crest' : 'A photograph'));
    const f = w.appendChild(el('input', 'sg-in sg-file'));
    f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp';
    const pv = host.appendChild(el('div', 'sg-preview' + (crest ? ' crest' : '')));
    pv.hidden = true;
    host.appendChild(el('p', 'sg-hint', crest
      ? 'The club’s current crest, as large as you have it: PNG, JPEG or WebP.'
      : 'A clear, recent picture of the player alone, the face easy to see. One you took, or one you may share.'));
    let url = null;
    f.addEventListener('change', () => {
      if (url) URL.revokeObjectURL(url);
      const file = f.files && f.files[0];
      pv.textContent = ''; pv.hidden = !file;
      if (!file) return;
      url = URL.createObjectURL(file);
      const img = pv.appendChild(el('img')); img.alt = ''; img.src = url;
    });
    return () => {
      const file = f.files && f.files[0];
      if (!file) return { error: crest ? 'Choose the crest’s file.' : 'Choose a picture.' };
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) return { error: 'A PNG, JPEG or WebP picture.' };
      return { photo: file };
    };
  }
};

/* a height, a wingspan or a weight, in the reader's units (units.js), sent in the database's */
function measure(host, c, kind) {
  const f = FIELDS[c.field];
  let sys = units();
  const box = host.appendChild(el('div', 'sg-measure'));
  const sw = host.appendChild(el('div', 'sg-units'));
  sw.setAttribute('role', 'group');
  let read = null;
  const draw = () => {
    box.textContent = '';
    if (kind === 'length' && sys === 'imperial') {
      const a = textInput(box, 'Feet', '', { inputMode: 'numeric', maxLength: 1, autocomplete: 'off', placeholder: '6' });
      const b = textInput(box, 'Inches', '', { inputMode: 'decimal', maxLength: 4, autocomplete: 'off', placeholder: '9' });
      read = () => toCm(a.value, b.value);
    } else if (kind === 'mass' && sys === 'imperial') {
      const a = textInput(box, 'Pounds', '', { inputMode: 'numeric', maxLength: 3, autocomplete: 'off', placeholder: '243' });
      read = () => toKg(a.value);
    } else {
      const a = textInput(box, kind === 'mass' ? 'Kilograms' : 'Centimetres', '', { inputMode: 'numeric', maxLength: 3, autocomplete: 'off',
                                                                                  placeholder: kind === 'mass' ? '110' : '206' });
      read = () => { const n = Number(String(a.value).replace(',', '.')); return n > 0 ? Math.round(n) : null; };
    }
    [...sw.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === sys)));
  };
  [['metric', kind === 'mass' ? 'kg' : 'cm'], ['imperial', kind === 'mass' ? 'lb' : 'ft · in']].forEach(([u, t]) => {
    const b = sw.appendChild(el('button', null, t)); b.type = 'button'; b.dataset.u = u;
    b.addEventListener('click', () => { sys = u; draw(); });
  });
  draw();
  return () => {
    const v = read();
    return v != null && v >= f.min && v <= f.max ? { calls: [{ field: c.field, value: String(v) }] } : { error: VALUE[c.field] };
  };
}

/* ------------------------------------------------------------- the editor --- */
/* WHOEVER MAY CHANGE A DETAIL THEMSELVES does not suggest it (adminedit.js asks the database who that is): the
   chip and the button say "edit" and open that panel instead. A detail it does not cover stays a suggestion. */
let editor = null;
const listOf = l => [].concat(typeof l === 'function' ? l() : l).filter(Boolean);
function edits(list) { try { return !!(editor && editor.covers(listOf(list))); } catch (_) { return false; } }
function labelButton(b) {
  const ed = edits(b.__sgList);
  b.classList.toggle('sg-ed', ed);
  b.lastChild.textContent = ed ? 'edit' : (b.__sgLabel || 'suggest an edit');
  b.title = ed ? 'Edit this page’s details: your changes go live at once'
               : 'Suggest a correction to this page’s details: the league’s moderators check it first';
}
function setEditor(e) {
  editor = e && typeof e.covers === 'function' && typeof e.open === 'function' ? e : null;
  if (doc) doc.querySelectorAll('.sg-btn').forEach(b => { if (b.__sgList) labelButton(b); });
}

/* ------------------------------------------------------------- the dialog --- */
let openNow = null;
function open(list, opts) {
  if (!doc) return null;
  const o = opts || {};
  const choices = [].concat(typeof list === 'function' ? list() : list)
    .filter(c => c && c.id && FIELDS[c.field] && (c.field !== 'photo' || root.EpinoiaUpload));
  if (!choices.length) return null;
  if (editor && edits(choices)) return editor.open(choices, o);
  if (openNow) { try { openNow.close(); } catch (_) { /* gone */ } }

  const dlg = doc.body.appendChild(el('dialog', 'sg-dlg'));
  dlg.setAttribute('data-i18n-ctx', 'suggest');         // its words: the 'suggest' context of the dictionaries
  openNow = dlg;
  dlg.setAttribute('aria-labelledby', 'sgTitle');
  const form = dlg.appendChild(el('form', 'sg-form'));
  form.method = 'dialog'; form.noValidate = true;

  const head = form.appendChild(el('div', 'sg-head'));
  head.appendChild(el('div', 'sg-kick', 'Suggest an edit'));
  const title = head.appendChild(data('div', 'sg-title', o.title || choices[0].subject || ''));
  title.id = 'sgTitle';
  head.appendChild(el('p', 'sg-sub',
    'The league’s moderators read every suggestion. Nothing changes until one of them accepts it, and you will hear what they decide in your notifications.'));

  const main = form.appendChild(el('div', 'sg-main'));
  const status = el('p', 'sg-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const acts = el('div', 'sg-acts');
  const cancel = acts.appendChild(el('button', 'ep-btn', 'Cancel')); cancel.type = 'button';
  const send = acts.appendChild(el('button', 'ep-btn pri', 'Send suggestion')); send.type = 'submit';
  cancel.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { dlg.remove(); if (openNow === dlg) openNow = null; });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });     // a tap on the backdrop

  const say = (t, cls) => { status.textContent = t || ''; status.className = 'sg-status' + (cls ? ' ' + cls : ''); };
  let current = null, read = null, noteIn = null, srcIn = null;

  const drawForm = () => {
    main.textContent = '';
    /* WHAT NEEDS CHANGING, when there is a choice: grouped by who or what it is about */
    if (choices.length > 1) {
      const w = main.appendChild(el('label', 'sg-field'));
      w.appendChild(el('span', 'sg-lab', 'What needs changing?'));
      const s = w.appendChild(el('select', 'sg-in sg-pick'));
      const groups = new Map();
      choices.forEach((c, i) => {
        const key = c.group || c.subject || '';
        if (!groups.has(key)) {
          const g = s.appendChild(el('optgroup')); g.label = key; groups.set(key, g);
        }
        const op = groups.get(key).appendChild(el('option', null, labelOf(c)));
        op.value = String(i);
      });
      const at = Math.max(0, choices.indexOf(o.start || null));
      s.value = String(at);
      s.addEventListener('change', () => pickChoice(choices[Number(s.value)]));
      main.appendChild(el('div', 'sg-fields'));
      pickChoice(choices[at]);
    } else {
      main.appendChild(el('div', 'sg-fields'));
      pickChoice(choices[0]);
    }
    const more = main.appendChild(el('div', 'sg-more'));
    const nw = more.appendChild(el('label', 'sg-field'));
    nw.appendChild(el('span', 'sg-lab', 'A note for the moderators (optional)'));
    noteIn = nw.appendChild(el('textarea', 'sg-in'));
    noteIn.rows = 2; noteIn.maxLength = 400;
    const sr = textInput(more, 'Where it says so (optional)', '', { type: 'url', maxLength: 500, placeholder: 'https://', autocomplete: 'off' });
    sr.type = 'url'; srcIn = sr;
    main.appendChild(status);
    main.appendChild(acts);
  };
  const pickChoice = c => {
    current = c;
    const host = main.querySelector('.sg-fields');
    host.textContent = '';
    const now = nowText(c);
    if (c.field !== 'photo') {                         // a picture's own field says what it is
      const line = host.appendChild(el('p', 'sg-now'));
      line.appendChild(el('span', 'sg-lab', labelOf(c)));
      if (now) { line.appendChild(el('span', 'sg-now-k', 'Now')); line.appendChild(data('span', 'sg-now-v', now)); }
      else if (!/^(staff_add|staff_remove)$/.test(c.field)) line.appendChild(el('span', 'sg-now-k', 'Not on the site yet'));
    }
    read = FORMS[FIELDS[c.field].kind](host, c);
    say('');
    const first = host.querySelector('input:not([type=file]),select');
    if (first && o.focus !== false) setTimeout(() => { try { first.focus(); } catch (_) { /* fine */ } }, 30);
  };

  const signIn = () => {
    main.textContent = '';
    main.appendChild(el('p', 'sg-sub', 'Sign in to suggest an edit. It takes a moment, and you will hear what the moderators decide.'));
    if (!acts.querySelector('a.sg-signin')) {
      const a = acts.appendChild(el('a', 'ep-btn pri sg-signin', 'Sign in'));
      a.href = root.EpinoiaAccess && root.EpinoiaAccess.signinHref ? root.EpinoiaAccess.signinHref() : '../signin/';
    }
    send.remove();
    main.appendChild(acts);
  };
  const done = (c, extra) => {
    main.textContent = '';
    main.appendChild(el('p', 'sg-done', 'Sent. Thank you.'));
    main.appendChild(el('p', 'sg-sub', extra ||
      'The moderators will look at it. When they decide, it is in your notifications — and if they accept it, on this page.'));
    cancel.textContent = 'Close';
    send.remove();
    main.appendChild(acts);
    if (typeof o.onSent === 'function') { try { o.onSent(c); } catch (_) { /* the page's business */ } }
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!read || !current) return;
    const got = read();
    if (got.error) return say(got.error, 'err');
    const note = (noteIn.value || '').trim(), source = (srcIn.value || '').trim();
    if (source && !/^https?:\/\/[^\s<>"]+$/i.test(source)) return say(REASONS.source, 'err');
    const sess = await session();
    if (!sess) return signIn();
    send.disabled = true;
    say('Sending…');
    try {
      if (got.photo) {
        const U = root.EpinoiaUpload;
        const out = await U.prepare(got.photo, current.type === 'team' ? 'logo' : 'photo');
        if (out.vector) throw new Error('A PNG, JPEG or WebP picture.');
        const ext = out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg';
        const name = 'suggested-' + stamp();
        const base = current.type + '/' + current.id + '/';
        await put(base + name + '.' + ext, out.main, out.type, sess);
        await put(base + name + '-thumb.' + ext, out.thumb, out.type, sess).catch(() => { /* the main file is what is judged */ });
        const r = await rpc('suggest_photo', { p_type: current.type, p_id: current.id, p_path: base + name + '.' + ext,
          p_width: out.w || 0, p_height: out.h || 0, p_bytes: out.main.size || 0, p_note: note, p_source: source || null }, sess);
        if (!r || r.ok === false) throw new Error(REASONS[r && r.reason] || 'That was not taken.');
        return done(current, 'The moderators will look at it with the other pictures waiting. When they decide, it is in your notifications.');
      }
      for (const call of got.calls) {
        const r = await rpc('suggest_edit', { p_type: current.type, p_id: current.id, p_field: call.field, p_value: call.value,
                                              p_note: note, p_source: source || null }, sess);
        if (!r || r.ok === false) {
          const why = r && r.reason;
          if (why === 'signed_out') return signIn();
          throw new Error(why === 'value' ? (VALUE[call.field] || 'That is not a value this detail can take.') : (REASONS[why] || 'That was not taken.'));
        }
      }
      done(current);
    } catch (err) {
      send.disabled = false;
      say(err.message || String(err), 'err');
    }
  });

  drawForm();
  try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
  session().then(s => { if (!s && dlg.isConnected) signIn(); });
  return dlg;
}

/* ------------------------------------------------------ the hover chip --- */
/* ON A DETAIL, WITH A MOUSE: a dashed outline and "suggest an edit" on its corner while the pointer is over it.
   The chip lives inside the detail (absolutely placed), so no coordinate is ever measured: the page's own
   zoom (the kit scales the body on wide screens) moves it with everything else. A touch screen has no hover,
   and gets there by the page's button instead. */
const HOVER = root.matchMedia ? root.matchMedia('(hover: hover) and (pointer: fine)') : null;
function attach(node, list, opts) {
  if (!node || !doc || !HOVER || !HOVER.matches) return node;
  const o = opts || {};
  node.__sg = { list, opts: o };
  if (node.__sgOn) return node;
  node.__sgOn = true;
  node.classList.add('sg-on');
  if (o.at === 'inset' || o.at === 'icon' || o.at === 'top') node.classList.add('sg-inset');
  if (o.at === 'icon') node.classList.add('sg-icon');
  if (o.at === 'top') node.classList.add('sg-top');
  if (root.getComputedStyle && root.getComputedStyle(node).position === 'static') node.classList.add('sg-rel');
  node.addEventListener('mouseenter', () => {
    if (node.querySelector(':scope > .sg-chip')) return;
    const ed = edits((node.__sg || {}).list);
    const chip = node.appendChild(el('button', 'sg-chip' + (ed ? ' sg-ed' : '')));
    chip.type = 'button';
    chip.setAttribute('data-i18n-ctx', 'suggest');
    chip.appendChild(el('span', 'sg-chip-i', '✎'));
    chip.appendChild(el('span', 'sg-chip-t', ed ? 'edit' : 'suggest an edit'));
    chip.title = ed ? 'edit' : 'suggest an edit';
    chip.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const s = node.__sg || {};
      open(s.list, Object.assign({}, s.opts || {}));
    });
  });
  node.addEventListener('mouseleave', () => {
    const chip = node.querySelector(':scope > .sg-chip');
    if (chip) chip.remove();
  });
  return node;
}

/* THE PAGE'S BUTTON: every suggestible detail of the page, a picker first when there is more than one */
function button(list, opts) {
  if (!doc) return null;
  const o = opts || {};
  const b = el('button', 'ep-btn sg-btn' + (o.cls ? ' ' + o.cls : ''));
  b.type = 'button';
  b.setAttribute('data-i18n-ctx', 'suggest');
  b.appendChild(el('span', 'sg-chip-i', '✎'));
  b.appendChild(el('span', null, o.label || 'suggest an edit'));
  b.title = 'Suggest a correction to this page’s details: the league’s moderators check it first';
  b.__sgList = list; b.__sgLabel = o.label || null;
  if (editor) labelButton(b);
  b.addEventListener('click', () => open(typeof list === 'function' ? list() : list, o));
  return b;
}

return { open, attach, button, setEditor, toCm, toKg, readPin, FIELDS, REASONS, VALUE, POSITIONS };
}));
