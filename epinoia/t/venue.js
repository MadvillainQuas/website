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

   WHERE THERE IS NO PHOTOGRAPH A COURT STANDS IN. That is every club right
   now. A placeholder that looks like a missing image makes a club look
   neglected, so a real court is shown instead, washed in the club's own ink
   and captioned as what it is — see "the court" below.

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

/* ------------------------------------------------------------ the court ---
   WHERE THERE IS NO PHOTOGRAPH, A COURT STANDS IN. That is every club right
   now, and a placeholder that looks like a missing image makes a club look
   neglected.

   This used to be a drawing — an arena in one ink, with the floor markings
   mapped from real FIBA dimensions. It was accurate and it still read as a
   diagram of a building rather than a picture of one, so it is a photograph
   instead: a public-domain (CC0) US Navy picture of a full court laid on a
   flight deck, dusk behind it. It is unmistakably basketball, it is nobody's
   home hall, and the caption says as much, so no club is credited with an
   arena it does not have.

   TWO WIDTHS, because a phone should not fetch a 1600px picture to fill a
   card three inches wide, and it is washed in the club's own ink so it sits
   in the same language as everything around it. */
const COURT = { wide: 'brand/court.jpg', narrow: 'brand/court-800.jpg' };

/* Climb back to /epinoia/ by counting the directories below it rather than
   assuming one — the same rule nav.js uses for the rail's links, so this keeps
   working from a subpage. */
function epinoiaRoot() {
  const here = (typeof location !== 'undefined' && location.pathname) || '';
  const seg = here.split('/epinoia/')[1] || '';
  const parts = seg.split('/').filter(Boolean);
  if (parts.length && parts[parts.length - 1].indexOf('.') !== -1) parts.pop();
  return parts.length ? '../'.repeat(parts.length) : './';
}

function courtImage() {
  const root = epinoiaRoot();
  const img = document.createElement('img');
  img.className = 'vphoto vstock';
  img.src = root + COURT.wide;
  img.srcset = root + COURT.narrow + ' 800w, ' + root + COURT.wide + ' 1600w';
  img.sizes = '(max-width:760px) 100vw, 40vw';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

function stockPane() {
  const pane = el('div', 'vpane');
  pane.append(courtImage(), el('div', 'vwash'), el('div', 'vgrain'),
              el('div', 'vcap', 'No photograph of this venue yet'));
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
  /* a photograph that fails to load falls back to the stand-in court rather
     than leaving a hole where the venue should be */
  img.addEventListener('error', () => {
    const replacement = stockPane();
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
    } catch (_) { /* the stand-in court is shown */ }

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
    grid.append(photoUrl ? photoPane(team, photoUrl) : stockPane(),
                mapPane(team, query));
    wrap.appendChild(grid);
    wrap.dataset.photo = photoUrl ? '1' : '';
  }

  host.appendChild(wrap);
  wrap.appendChild(await contactBlock(team, opts));
  await socialBlock(team, opts, wrap);

  return { photo: wrap.dataset.photo === '1' };
}

return { render, stockPane };
}));
