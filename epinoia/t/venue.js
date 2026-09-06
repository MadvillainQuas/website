'use strict';
/* ============================================================================
   HOME VENUE + CONTACT — where the club plays, and how to reach it.

   Four things, in the order somebody needs them: the name, the address laid
   out to be read and copied, a picture and a map side by side, and then the
   way to get hold of a human.

   THE MAP LOADS ITSELF, from the venue's own address — a club records an
   address once and gets a working map with nothing else to configure. It is a
   third-party embed on a site used by under-18s, so two mitigations stay:
   loading="lazy", so nothing is fetched until the panel is actually scrolled
   to, and referrerPolicy="no-referrer", so the page somebody is reading stays
   out of Google's logs. The address is also printed in full, and links out to
   Maps and directions sit over the corner, because the embed cannot give a
   route.

   WHERE THERE IS NO PHOTOGRAPH THE ARENA IS DRAWN. That is every club right
   now. A placeholder that looks like a missing image makes a club look
   neglected, so this is built in the same screenprint language as the club
   cards — one ink, a halftone, paper grain — and reads as a deliberate
   illustration rather than an absence.

   THE CONTACT FORM NEVER LEARNS THE ADDRESS. It posts a team id; the Edge
   Function resolves the recipient from a table no browser can read. A club may
   publish its email and telephone or keep them private, and either way the
   form still works — which is the only kind of contact form worth putting on a
   page a scraper will visit.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVenue = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* ------------------------------------------------------------- the arena ---
   A BASKETBALL arena, which is a specific building and not a generic bowl.

   The previous drawing was an ellipse of tiered seating around a lit oval,
   which is a football ground — the shape says "pitch" before anything else
   does. What makes an arena read as basketball is a short list, and all of it
   is here: a RECTANGULAR floor in perspective with the markings anyone would
   recognise (keys, three-point arcs, centre circle), a BACKBOARD AND RIM at
   each end on its stanchion, and a CENTRE-HUNG SCOREBOARD, which no other
   sport puts over the middle of the playing surface.

   The court markings are not drawn by eye. A perspective map takes real court
   coordinates — FIBA's 28m by 15m — and puts them on the picture, so the keys
   are the right proportion of the floor and the arcs meet the sidelines where
   they should. Drawing them freehand is what makes an illustration look almost
   right, which is worse than looking stylised.

   Flat shapes only. This is a print, not a render, and a gradient would put it
   in a different visual language from everything around it. */
function arenaSVG(ink) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 200');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');

  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    svg.appendChild(n);
    return n;
  };
  const stroke = (d, opacity, width) => add('path',
    { d, fill: 'none', stroke: ink, 'stroke-width': width || 1,
      opacity, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

  /* ---- the perspective map -------------------------------------------------
     u runs baseline to baseline (0 → 1), v runs far sideline to near (0 → 1).
     Straight-line interpolation between a narrow far edge and a wide near one
     is not true perspective, but at this size the difference is invisible and
     the maths stays readable. */
  const P = (u, v) => {
    const xFar = 62 + u * 196, xNear = 22 + u * 276;
    return [xFar + (xNear - xFar) * v, 118 + 60 * v];
  };
  const at = (u, v) => { const p = P(u, v); return p[0].toFixed(1) + ' ' + p[1].toFixed(1); };
  const path = (pairs, close) =>
    pairs.map(([u, v], i) => (i ? 'L' : 'M') + at(u, v)).join(' ') + (close ? ' Z' : '');
  const arc = (cu, cv, ru, rv, a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      out.push([cu + ru * Math.cos(a), cv + rv * Math.sin(a)]);
    }
    return out;
  };

  /* FIBA dimensions as fractions of the floor: 28m long, 15m wide. */
  const L = 28, W = 15;
  const KEY_D = 5.8 / L, KEY_HW = 2.45 / W;          // paint: 5.8m deep, 4.9m wide
  const CIRC_U = 1.8 / L, CIRC_V = 1.8 / W;          // 1.8m radius circles
  const BASKET_U = 1.575 / L;                        // rim centre from baseline
  const ARC_U = 6.75 / L, ARC_V = 6.75 / W;          // three-point radius
  const CORNER_V = 0.9 / W;                          // corner lines, 0.9m in
  const CORNER_A = Math.asin((0.5 - CORNER_V) / ARC_V) * 180 / Math.PI;

  /* ---- roof and rig --------------------------------------------------------
     Two trusses and a lattice between them. An arena roof is flat and gridded,
     not the pitched span a stadium has. */
  stroke('M14 30 H306', 0.34, 1.4);
  stroke('M26 44 H294', 0.28, 1.2);
  let lattice = '';
  for (let x = 26; x <= 294; x += 22) lattice += `M${x} 30 L${x + 11} 44 L${x + 22} 30 `;
  stroke(lattice, 0.18, 0.9);

  /* ---- the centre-hung scoreboard -----------------------------------------
     The single object that says basketball before the floor is even read. Four
     faces, hung on two cables over the middle of the court. */
  stroke('M141 44 V57 M179 44 V57', 0.4, 1);
  add('path', { d: 'M132 57 H188 L182 79 H138 Z', fill: ink, opacity: 0.22 });
  stroke('M132 57 H188 L182 79 H138 Z', 0.75, 1.3);
  stroke('M152 57 V79 M168 57 V79', 0.3, 0.9);              // the corner edges
  // two score panels on the near face, unreadable and unmistakable
  add('rect', { x: 137, y: 62, width: 12, height: 8, fill: ink, opacity: 0.6 });
  add('rect', { x: 171, y: 62, width: 12, height: 8, fill: ink, opacity: 0.6 });
  stroke('M138 79 H182', 0.5, 1);
  stroke('M146 79 V83 M160 79 V84 M174 79 V83', 0.3, 0.9);  // the light ring beneath

  /* ---- the bowl ------------------------------------------------------------
     Rectangular and steep, converging on the floor. The ticks are the crowd;
     the gaps in them are vomitories, which is what stops a stand reading as a
     fence. */
  const inner = s => [52 + s * 216, 116];
  const outer = s => [4 + s * 312, 84];
  add('path', {
    d: `M${outer(0).join(' ')} L${outer(1).join(' ')} L${inner(1).join(' ')} L${inner(0).join(' ')} Z`,
    fill: ink, opacity: 0.07
  });
  const VOMS = [[0.16, 0.20], [0.475, 0.525], [0.80, 0.84]];
  let seats = '';
  for (let i = 0; i <= 46; i++) {
    const s = i / 46;
    if (VOMS.some(([a, b]) => s > a && s < b)) continue;
    const [x1, y1] = inner(s), [x2, y2] = outer(s);
    seats += `M${x1.toFixed(1)} ${y1} L${x2.toFixed(1)} ${y2} `;
  }
  stroke(seats, 0.3, 1);
  [0.34, 0.67].forEach(f => {                                 // the tier walkways
    const a = inner(0), b = outer(0), c = inner(1), d = outer(1);
    stroke(`M${(a[0] + (b[0] - a[0]) * f).toFixed(1)} ${(a[1] + (b[1] - a[1]) * f).toFixed(1)}` +
           ` L${(c[0] + (d[0] - c[0]) * f).toFixed(1)} ${(c[1] + (d[1] - c[1]) * f).toFixed(1)}`,
           0.24, 1);
  });
  // the near stand, cropped — we are sitting in it
  stroke('M0 186 H320', 0.24, 1.2);
  let near = '';
  for (let x = 4; x <= 316; x += 9) near += `M${x} 186 V200 `;
  stroke(near, 0.22, 1);

  /* ---- the floor -----------------------------------------------------------
     Lit, and marked. Every line below is a real court line placed by the
     perspective map rather than by eye. */
  add('path', { d: path([[0, 0], [1, 0], [1, 1], [0, 1]], true), fill: ink, opacity: 0.14 });
  stroke(path([[0, 0], [1, 0], [1, 1], [0, 1]], true), 0.8, 1.4);       // sidelines
  stroke(path([[0.5, 0], [0.5, 1]]), 0.6, 1.1);                          // halfway
  stroke(path(arc(0.5, 0.5, CIRC_U, CIRC_V, 0, 360, 40), true), 0.6, 1.1); // centre circle

  [0, 1].forEach(end => {
    const flip = u => end ? 1 - u : u;                 // the far end is a mirror
    const dir = end ? -1 : 1;

    // the key, and the free-throw circle on top of it
    stroke(path([[flip(0), 0.5 - KEY_HW], [flip(KEY_D), 0.5 - KEY_HW],
                 [flip(KEY_D), 0.5 + KEY_HW], [flip(0), 0.5 + KEY_HW]]), 0.65, 1.1);
    stroke(path(arc(flip(KEY_D), 0.5, CIRC_U, CIRC_V, 0, 360, 32), true), 0.55, 1);

    /* the three-point line: two corner runs and the arc between them.
       `dir` alone mirrors the arc — flipping the ANGLES as well would mirror it
       twice and swing it back outside the court, which is exactly what it did
       the first time round. */
    const corner = ARC_U * Math.cos(CORNER_A * Math.PI / 180);
    stroke(path([[flip(0), CORNER_V], [flip(BASKET_U + corner), CORNER_V]]), 0.6, 1.1);
    stroke(path([[flip(0), 1 - CORNER_V], [flip(BASKET_U + corner), 1 - CORNER_V]]), 0.6, 1.1);
    stroke(path(arc(flip(BASKET_U), 0.5, ARC_U * dir, ARC_V, -CORNER_A, CORNER_A, 30)), 0.6, 1.1);

    /* the basket. Stanchion behind the baseline, arm over the floor, backboard,
       rim, net — the silhouette that no other sport has. */
    const base = P(flip(-0.075), 0.5);
    const bb = P(flip(-0.012), 0.5);
    stroke(`M${base[0].toFixed(1)} ${base[1].toFixed(1)} V${(base[1] - 34).toFixed(1)}`, 0.85, 2);
    stroke(`M${base[0].toFixed(1)} ${(base[1] - 31).toFixed(1)} ` +
           `L${bb[0].toFixed(1)} ${(base[1] - 31).toFixed(1)}`, 0.85, 1.6);
    add('rect', { x: (bb[0] - (end ? 1.5 : 0)).toFixed(1), y: (base[1] - 39).toFixed(1),
                  width: 1.8, height: 17, fill: ink, opacity: 0.5 });
    stroke(`M${bb[0].toFixed(1)} ${(base[1] - 39).toFixed(1)} V${(base[1] - 22).toFixed(1)}`, 0.9, 2.2);
    const rim = [bb[0] + dir * 7, base[1] - 25];
    add('ellipse', { cx: rim[0].toFixed(1), cy: rim[1].toFixed(1), rx: 6.5, ry: 2.2,
                     fill: 'none', stroke: ink, 'stroke-width': 1.5, opacity: 0.95 });
    stroke(`M${(rim[0] - 6.5).toFixed(1)} ${rim[1].toFixed(1)} L${(rim[0] - 3).toFixed(1)} ${(rim[1] + 7).toFixed(1)} ` +
           `M${rim[0].toFixed(1)} ${(rim[1] + 2.2).toFixed(1)} V${(rim[1] + 8).toFixed(1)} ` +
           `M${(rim[0] + 6.5).toFixed(1)} ${rim[1].toFixed(1)} L${(rim[0] + 3).toFixed(1)} ${(rim[1] + 7).toFixed(1)} ` +
           `M${(rim[0] - 3).toFixed(1)} ${(rim[1] + 7).toFixed(1)} L${(rim[0] + 3).toFixed(1)} ${(rim[1] + 7).toFixed(1)}`,
           0.55, 0.9);
  });

  return svg;
}

function drawnPane(team) {
  const pane = el('div', 'vpane');
  const a = el('div', 'arena');
  a.appendChild(arenaSVG(team.colour || '#93f2bf'));
  pane.append(a, el('div', 'vtone'), el('div', 'vgrain'),
              el('div', 'vcap', 'Illustrated — no photograph yet'));
  return pane;
}

/* ---------------------------------------------------------------- socials ---
   The club's own accounts, and up to four posts, directly under the venue
   image — which is where a supporter looking at "where do I go on Saturday"
   is most likely to also want "what are this lot like".

   IFRAMES rather than Instagram's script, for the same reason as the league
   section: their embed.js is a third-party script on a public page that sets
   cookies and can change under us, and the sandboxed frame renders the same
   post. A shortcode is re-validated here even though the database already
   reduced it, because this value goes into a src. */
const IG_CODE = /^[A-Za-z0-9_-]{4,32}$/;

async function socialBlock(team, opts, wrap) {
  let s = null;
  try {
    const rows = await opts.api('team_socials?team_id=eq.' + team.id +
      '&select=instagram,x_handle,facebook,website,pinned&limit=1');
    s = rows && rows[0];
  } catch (_) { return; }
  if (!s) return;

  const links = [];
  if (s.instagram) links.push(['Instagram', 'https://www.instagram.com/' +
    encodeURIComponent(s.instagram) + '/', '@' + s.instagram]);
  if (s.x_handle)  links.push(['X', 'https://x.com/' +
    encodeURIComponent(s.x_handle) + '', '@' + s.x_handle]);
  if (s.facebook)  links.push(['Facebook', 'https://www.facebook.com/' +
    encodeURIComponent(s.facebook) + '/', s.facebook]);
  if (s.website)   links.push(['Website', s.website, s.website.replace(/^https?:\/\//, '')]);

  const posts = (s.pinned || []).filter(c => IG_CODE.test(c)).slice(0, 4);
  if (!links.length && !posts.length) return;

  const box = el('div', 'vsocial');
  const head = el('div', 'vsocial-h');
  head.appendChild(el('span', 'vsocial-t', 'Follow the club'));
  links.forEach(l => {
    const a = el('a', 'vsocial-l', l[2]);
    a.href = l[1]; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = l[0];
    head.appendChild(a);
  });
  box.appendChild(head);

  /* Tiles from igtile.js, which is also what the league's Socials section uses.
     This built its own before, at minmax(250px,1fr) — so a club with one pinned
     post got it at the full width of the column. */
  if (posts.length) {
    const grid = window.EpinoiaIgTile && window.EpinoiaIgTile.grid(posts, 4);
    if (grid) box.appendChild(grid);
  }
  wrap.appendChild(box);
}

function photoPane(team, url) {
  const pane = el('div', 'vpane');
  const img = document.createElement('img');
  img.className = 'vphoto';
  img.src = url;
  img.alt = team.home_venue || 'The venue';
  img.loading = 'lazy';
  /* a photograph that fails to load falls back to the drawing rather than
     leaving a hole where the venue should be */
  img.addEventListener('error', () => {
    const replacement = drawnPane(team);
    if (pane.parentNode) pane.parentNode.replaceChild(replacement, pane);
  });
  pane.append(img, el('div', 'vcap', team.home_venue || 'Home venue'));
  return pane;
}

function mapPane(team, query) {
  const pane = el('div', 'vpane vmap');

  /* The venue's own address goes straight into the embed, so a club that
     records an address gets a working map with nothing else to configure.
     The keyless embed is used so this needs no Maps API key; if Google ever
     withdraws it the official replacement is
     /maps/embed/v1/place?key=KEY&q=… and only this line changes. */
  const f = document.createElement('iframe');
  f.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(query) + '&z=15&output=embed';
  f.loading = 'lazy';
  f.referrerPolicy = 'no-referrer';
  f.title = (team.home_venue || 'Venue') + ' on a map';
  pane.appendChild(f);

  /* Links out ride over the corner of the map. The embed cannot give
     directions, and an address without a route is half an answer. */
  const links = el('div', 'vlinks over');
  const ext = el('a', null, 'Open in Maps');
  ext.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
  const dir = el('a', null, 'Directions');
  dir.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(query);
  [ext, dir].forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  links.append(ext, dir);
  pane.appendChild(links);

  return pane;
}

/* ================================================================ contact ===
   What a visitor can see, and what a manager can change.

   `team_contact()` decides both: it returns the details only when the club has
   published them, and tells us separately whether an address exists at all, so
   a private club reads as private rather than as absent.
   ========================================================================== */

function detail(label, value, href) {
  const d = el('div', 'vcitem');
  d.appendChild(el('div', 'k', label));
  if (href) {
    const a = el('a', 'v', value);
    a.href = href;
    /* An address written into the DOM by script is not in the served HTML and
       is not in the repository, so the cheap scrapers never see it. This is a
       speed bump, not a wall — anyone running a real browser reads it fine —
       and the form below is the route that gives nothing away at all. */
    a.rel = 'nofollow';
    d.appendChild(a);
  } else {
    d.appendChild(el('div', 'v', value));
  }
  return d;
}

/* The pop-up. A native <dialog>: Escape closes it, focus is trapped, and the
   backdrop comes free — all of which would otherwise be a hundred lines of
   keyboard handling that some browser eventually disagrees with. */
function messageDialog(team, cfg) {
  const dlg = document.createElement('dialog');
  dlg.className = 'vdlg';

  const form = el('form', 'vform');
  form.method = 'dialog';

  const head = el('div', 'vdhead');
  head.appendChild(el('div', 'vdtitle', 'Message ' + (team.name || 'the club')));
  head.appendChild(el('div', 'vdsub',
    'This goes straight to the club. They see your email address so they can ' +
    'reply; nobody else does, and the club\'s own address is never shown to you.'));
  form.appendChild(head);

  const field = (id, label, type, attrs) => {
    const wrap = el('label', 'vfield');
    wrap.htmlFor = 'vc-' + id;
    wrap.appendChild(el('span', 'vflabel', label));
    const input = type === 'textarea'
      ? document.createElement('textarea') : document.createElement('input');
    input.id = 'vc-' + id;
    input.name = id;
    if (type !== 'textarea') input.type = type;
    Object.assign(input, attrs || {});
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
  };

  const yourName = field('name', 'Your name', 'text', { maxLength: 120, required: true });
  const yourMail = field('email', 'Your email', 'email', { maxLength: 200, required: true });
  const subject  = field('subject', 'Subject', 'text', { maxLength: 160 });
  const bodyText = field('body', 'Message', 'textarea', { maxLength: 5000, rows: 6, required: true });

  /* the honeypot: no human sees it, and bots fill everything in */
  const hp = el('div', 'vhp');
  hp.setAttribute('aria-hidden', 'true');
  const hpi = document.createElement('input');
  hpi.type = 'text'; hpi.name = 'website'; hpi.tabIndex = -1; hpi.autocomplete = 'off';
  hp.appendChild(hpi);
  form.appendChild(hp);

  const note = el('div', 'vnote');
  form.appendChild(note);

  const row = el('div', 'vdactions');
  const cancel = el('button', 'ep-chip', 'Close');
  cancel.type = 'button';
  const send = el('button', 'ep-chip on', 'Send');
  send.type = 'submit';
  row.append(cancel, send);
  form.appendChild(row);

  cancel.addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.className = 'vnote';
    const payload = {
      team_id: team.id,
      name: yourName.value.trim(),
      email: yourMail.value.trim(),
      subject: subject.value.trim(),
      body: bodyText.value.trim(),
      website: hpi.value
    };
    if (!payload.name) { note.textContent = 'A name, so a reply knows who it is to.';
                         note.className = 'vnote err'; return yourName.focus(); }
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(payload.email)) {
      note.textContent = 'That email address does not look right — a reply would bounce.';
      note.className = 'vnote err'; return yourMail.focus();
    }
    if (payload.body.length < 10) {
      note.textContent = 'Say a little more than that.';
      note.className = 'vnote err'; return bodyText.focus();
    }

    send.disabled = true;
    const label = send.textContent;
    send.textContent = 'sending…';
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey },
        body: JSON.stringify(payload)
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) {
        send.disabled = false; send.textContent = label;
        note.textContent = out.error || ('That was refused (' + r.status + ').');
        note.className = 'vnote err';
        return;
      }
      /* Whether the email left the building is not the sender's problem — the
         message is recorded either way, and saying "not delivered" would only
         invite them to send it twice. */
      form.querySelectorAll('input,textarea').forEach(i => { i.value = ''; });
      send.textContent = 'sent';
      note.textContent = 'Sent. If you asked for a reply it will come to ' +
                         payload.email + '.';
      note.className = 'vnote ok';
    } catch (err) {
      send.disabled = false; send.textContent = label;
      note.textContent = 'Could not reach the server: ' + (err.message || err) +
                         '. Nothing was lost, but it needs sending again.';
      note.className = 'vnote err';
    }
  });

  dlg.appendChild(form);
  return dlg;
}

/* The manager's editor. Inline, because a separate screen for four fields is a
   screen nobody opens. Nothing here decides who may edit — the database was
   asked, and a save that should not happen is refused whatever this believes. */
function editor(team, c, sb, onSaved) {
  const box = el('details', 'vcedit');
  box.appendChild(el('summary', null, 'Edit the club\'s contact details'));

  const grid = el('div', 'vegrid');
  const mk = (key, label, type, value, ph) => {
    const w = el('label', 'vfield');
    w.appendChild(el('span', 'vflabel', label));
    const i = document.createElement('input');
    i.type = type; i.value = value || ''; i.placeholder = ph || '';
    i.maxLength = type === 'email' ? 200 : 120;
    w.appendChild(i);
    grid.appendChild(w);
    return i;
  };
  const nameIn  = mk('contact_name', 'Contact', 'text', c.contact_name, 'Club Secretary');
  const mailIn  = mk('email', 'Email', 'email', c.email, 'someone@club.example');
  const phoneIn = mk('phone', 'Telephone', 'tel', c.phone, '01234 567890');
  box.appendChild(grid);

  const opts = el('div', 'veopts');
  const toggle = (label, on, hint) => {
    const w = el('label', 'vetoggle');
    const i = document.createElement('input');
    i.type = 'checkbox'; i.checked = !!on;
    w.append(i, el('span', 'vetx', label));
    if (hint) w.appendChild(el('span', 'vehint', hint));
    opts.appendChild(w);
    return i;
  };
  const pubIn = toggle('Show these publicly', c.is_public !== false,
    'Off keeps them for league officials only. The form below still works.');
  const formIn = toggle('Accept messages through the site', c.accepts_form !== false,
    'Off removes the button entirely.');
  box.appendChild(opts);

  const note = el('div', 'vnote');
  const save = el('button', 'ep-chip on', 'Save');
  save.type = 'button';
  const row = el('div', 'vdactions');
  row.append(save);
  box.append(row, note);

  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = 'saving…';
    note.className = 'vnote';
    const { error } = await sb.rpc('set_team_contact', {
      p_team: team.id,
      p_contact_name: nameIn.value.trim(),
      p_email: mailIn.value.trim(),
      p_phone: phoneIn.value.trim(),
      p_is_public: pubIn.checked,
      p_accepts_form: formIn.checked
    });
    save.disabled = false; save.textContent = 'Save';
    if (error) {
      note.textContent = error.message;
      note.className = 'vnote err';
      return;
    }
    note.textContent = 'Saved.';
    note.className = 'vnote ok';
    onSaved();
  });

  return box;
}

/* team_contact() answers differently depending on who is asking — a manager
   sees their own club's details even when they are unpublished, and is told
   they may edit. So it has to be called WITH the session where there is one.
   The SDK client carries the token; the bare fetch is the signed-out path and
   the fallback for a page that never loaded the SDK. */
async function readContact(team, cfg) {
  const sb = window.epinoiaClient && window.epinoiaClient();
  if (sb) {
    const { data, error } = await sb.rpc('team_contact', { p_team: team.id });
    if (error) throw new Error(error.message);
    return (data && data[0]) || {};
  }
  const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/team_contact', {
    method: 'POST', cache: 'no-store',
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_team: team.id })
  });
  if (!r.ok) throw new Error(String(r.status));
  const rows = await r.json();
  return (rows && rows[0]) || {};
}

async function contactBlock(team, opts) {
  const wrap = el('div', 'vcontact');
  wrap.appendChild(el('div', 'vclabel', 'Contact'));

  let c = {};
  try { c = await readContact(team, opts.cfg); } catch (_) { c = {}; }

  const body = el('div', 'vcbody');
  wrap.appendChild(body);

  const draw = () => {
    body.textContent = '';
    const row = el('div', 'vcrow');

    if (c.contact_name) row.appendChild(detail('Club contact', c.contact_name));
    if (c.email)  row.appendChild(detail('Email', c.email, 'mailto:' + c.email));
    else if (c.has_email) row.appendChild(detail('Email', 'Held, not published'));
    if (c.phone)  row.appendChild(detail('Telephone', c.phone,
      'tel:' + c.phone.replace(/[^\d+]/g, '')));
    else if (c.has_phone) row.appendChild(detail('Telephone', 'Held, not published'));

    if (c.accepts_form) {
      const btn = el('button', 'ep-chip on vcbtn', 'Message the club');
      btn.type = 'button';
      const dlg = messageDialog(team, opts.cfg);
      document.body.appendChild(dlg);
      btn.addEventListener('click', () => dlg.showModal());
      row.appendChild(btn);
    }

    if (!row.children.length) {
      body.appendChild(el('div', 'empty',
        'No contact details for this club yet. Whoever manages the club can add ' +
        'them, and they appear here.'));
    } else {
      body.appendChild(row);
    }
  };
  draw();

  /* the editor, for whoever runs the club */
  if (c.can_edit) {
    const sb = window.epinoiaClient && window.epinoiaClient();
    if (sb) {
      wrap.appendChild(editor(team, c, sb, async () => {
        try { c = await readContact(team, opts.cfg); }
        catch (_) { /* keep what is on screen */ }
        draw();
      }));
    }
  }

  return wrap;
}

/* opts: { host, team, api, cfg } */
async function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return { photo: false };
  const team = opts.team || {};
  host.textContent = '';

  /* a recorded venue, else the one the club's home fixtures name most often */
  const name = team.home_venue || team.home_venue_auto || null, addr = team.home_venue_address;
  const wrap = el('div', 'vwrap');
  wrap.style.setProperty('--ink-c', team.colour || '#93f2bf');

  if (!name && !addr) {
    /* No venue is not the same as no page. The contact panel still belongs
       here — a club with no registered hall is exactly the one somebody needs
       to ring. */
    wrap.appendChild(el('div', 'empty',
      'No home venue recorded for this club yet. A league administrator can add ' +
      'one, and every home fixture inherits it.'));
  } else {
    /* an approved venue photograph, if one exists. Nothing unapproved is
       shown — that decision belongs to the moderation queue. */
    let photoUrl = null;
    try {
      const rows = await opts.api('media?owner_type=eq.team&kind=eq.venue' +
        '&status=eq.approved&owner_id=eq.' + team.id + '&select=storage_path&limit=1');
      if (rows && rows.length) {
        photoUrl = opts.cfg.supabaseUrl + '/storage/v1/object/public/media-public/' + rows[0].storage_path;
      }
    } catch (_) { /* the drawing stands in */ }

    /* A club may also have supplied its own address for a photograph rather
       than uploading one (0049). The approved upload wins, because it has been
       through moderation; this is the fallback, and only over https — a http
       image on an https page is blocked by the browser and would read as a
       club that uploaded something broken. */
    if (!photoUrl && /^https:\/\//.test(team.home_venue_image || '')) {
      photoUrl = team.home_venue_image;
    }

    const head = el('div', 'vhead');
    head.appendChild(el('div', 'vname', name || 'Home venue'));
    if (!team.home_venue && team.home_venue_auto) {
      head.appendChild(el('div', 'vaddr', 'from the club\u2019s home fixtures' +
        (team.home_venue_auto_n > 1 ? ' (' + team.home_venue_auto_n + ' games)' : '') +
        ' \u2014 a league administrator or the club can set the address'));
    }
    if (addr) {
      /* Each line of the address on its own line, as it would be written on an
         envelope. A comma-separated run is harder to read and harder to copy. */
      const a = el('div', 'vaddr');
      const parts = String(addr).split(',').map(x => x.trim()).filter(Boolean);
      parts.forEach((part, i) => {
        a.appendChild(document.createTextNode(part + (i < parts.length - 1 ? ',' : '')));
        if (i < parts.length - 1) a.appendChild(document.createElement('br'));
      });
      head.appendChild(a);
    }
    wrap.appendChild(head);

    /* WHAT THE MAP IS ASKED FOR. The address when the club recorded one.
       Otherwise the venue's name — and, because "Sports Centre" alone lands
       anywhere on earth, the league's country beside it, which is enough for
       Google to pick the right hall from a name like "Netball Centre
       Loughborough University". */
    const COUNTRY = { GB: 'United Kingdom', IE: 'Ireland', ES: 'Spain', DE: 'Germany', FR: 'France',
                      IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal', US: 'United States',
                      CA: 'Canada', AU: 'Australia', NZ: 'New Zealand' };
    const cc = team.leagues && team.leagues.country;
    const hint = !addr && cc ? (COUNTRY[String(cc).toUpperCase()] || cc) : null;
    const query = [name, addr, hint].filter(Boolean).join(', ');
    const grid = el('div', 'vgrid');
    grid.append(photoUrl ? photoPane(team, photoUrl) : drawnPane(team),
                mapPane(team, query));
    wrap.appendChild(grid);
    wrap.dataset.photo = photoUrl ? '1' : '';
  }

  host.appendChild(wrap);
  wrap.appendChild(await contactBlock(team, opts));
  await socialBlock(team, opts, wrap);

  return { photo: wrap.dataset.photo === '1' };
}

return { render, arenaSVG };
}));
