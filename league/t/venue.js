'use strict';
/* ============================================================================
   HOME VENUE — where the club plays, how to get there, and what it looks like.

   Three things, in the order somebody needs them: the name, the address laid
   out to be read and copied, and then a picture and a map side by side.

   THE MAP IS CLICK-TO-LOAD ON PURPOSE. An embedded Google map is third-party
   content that can profile whoever loads it, and this platform is a data
   controller for children's data — the ICO's Age Appropriate Design Code is
   the reason, not squeamishness. It also sits under a standing rule that no
   third-party scripts load under /league/. So nothing reaches Google until a
   visitor asks, the address is printed in full so most never need to, and
   plain links out to Maps and to directions are there for anyone who would
   rather use the real thing.

   WHERE THERE IS NO PHOTOGRAPH THE ARENA IS DRAWN. That is every club right
   now. A placeholder that looks like a missing image makes a club look
   neglected, so this is built in the same screenprint language as the club
   cards — one ink, a halftone, paper grain — and reads as a deliberate
   illustration rather than an absence.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideVenue = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* ------------------------------------------------------------- the arena ---
   The bowl in section: tiered seating, the floor lit from trusses above.
   Flat shapes only — this is a print, not a render, and a gradient here would
   put it in a different visual language from everything around it. */
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

  /* roof trusses */
  const truss = { stroke: ink, 'stroke-width': 1.4, opacity: 0.45, fill: 'none' };
  add('path', Object.assign({ d: 'M24 62 L160 26 L296 62' }, truss));
  add('path', Object.assign({ d: 'M52 56 L160 38 L268 56' }, truss));
  add('path', Object.assign({ d: 'M160 26 L160 44' }, truss));
  add('path', Object.assign({ d: 'M96 48 L96 58 M224 48 L224 58' }, truss));

  /* floodlights, and the light they throw */
  add('rect', { x: 86, y: 40, width: 20, height: 7, rx: 1, fill: ink, opacity: 0.9 });
  add('rect', { x: 214, y: 40, width: 20, height: 7, rx: 1, fill: ink, opacity: 0.9 });
  add('path', { d: 'M86 47 L106 47 L150 118 L60 118 Z', fill: ink, opacity: 0.12 });
  add('path', { d: 'M214 47 L234 47 L260 118 L170 118 Z', fill: ink, opacity: 0.12 });

  /* the bowl: three rings, tightening towards the floor */
  add('ellipse', { cx: 160, cy: 132, rx: 140, ry: 56, fill: 'none', stroke: ink,
                   'stroke-width': 1.6, opacity: 0.55 });
  add('ellipse', { cx: 160, cy: 132, rx: 112, ry: 44, fill: 'none', stroke: ink,
                   'stroke-width': 1.3, opacity: 0.45 });
  add('ellipse', { cx: 160, cy: 132, rx: 86, ry: 33, fill: 'none', stroke: ink,
                   'stroke-width': 1.1, opacity: 0.38 });

  /* radial ticks between the rings — the thing that reads as a crowd */
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x1 = 160 + Math.cos(a) * 92,  y1 = 132 + Math.sin(a) * 35;
    const x2 = 160 + Math.cos(a) * 136, y2 = 132 + Math.sin(a) * 54;
    add('path', { d: 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
                     ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1),
                  stroke: ink, 'stroke-width': 1, opacity: 0.28, fill: 'none' });
  }

  /* the floor, lit, with just enough court marking to be unmistakable */
  add('ellipse', { cx: 160, cy: 132, rx: 64, ry: 24, fill: ink, opacity: 0.2 });
  const court = { fill: 'none', stroke: ink, 'stroke-width': 1.2, opacity: 0.75 };
  add('rect', Object.assign({ x: 106, y: 116, width: 108, height: 32, rx: 2 }, court));
  add('circle', Object.assign({ cx: 160, cy: 132, r: 9 }, court));
  add('path', Object.assign({ d: 'M106 122 h14 v20 h-14' }, court));
  add('path', Object.assign({ d: 'M214 122 h-14 v20 h14' }, court));
  add('path', Object.assign({ d: 'M160 116 v32' }, court));

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

  const ask = el('div', 'vmap-ask');
  ask.appendChild(el('div', 'vmap-pin', '◎'));
  const btn = el('button', 'cs-btn', 'Show the map');
  btn.type = 'button';
  ask.appendChild(btn);
  ask.appendChild(el('div', 'vmap-why',
    'The map comes from Google, so it is only fetched when you ask for it — ' +
    'nothing is sent to them before that.'));

  const links = el('div', 'vlinks');
  const ext = el('a', null, 'Open in Maps');
  ext.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
  const dir = el('a', null, 'Directions');
  dir.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(query);
  [ext, dir].forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  links.append(ext, dir);
  ask.appendChild(links);
  pane.appendChild(ask);

  btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    /* The keyless embed, so this works without anybody provisioning a Maps API
       key. If Google ever withdraws it the official replacement is
       /maps/embed/v1/place?key=KEY&q=… and only this line changes. */
    f.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(query) +
            '&z=15&output=embed';
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer';
    f.title = (team.home_venue || 'Venue') + ' on a map';
    pane.textContent = '';
    pane.appendChild(f);
  });

  return pane;
}

/* opts: { host, team, api, cfg } */
async function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return { photo: false };
  const team = opts.team || {};
  host.textContent = '';

  const name = team.home_venue, addr = team.home_venue_address;
  if (!name && !addr) {
    host.appendChild(el('div', 'empty',
      'No home venue recorded for this club yet. A league administrator can add ' +
      'one, and every home fixture inherits it.'));
    return { photo: false };
  }

  /* an approved venue photograph, if one exists. Nothing unapproved is shown —
     that decision belongs to the moderation queue. */
  let photoUrl = null;
  try {
    const rows = await opts.api('media?owner_type=eq.team&kind=eq.venue' +
      '&status=eq.approved&owner_id=eq.' + team.id + '&select=storage_path&limit=1');
    if (rows && rows.length) {
      photoUrl = opts.cfg.supabaseUrl + '/storage/v1/object/public/' + rows[0].storage_path;
    }
  } catch (_) { /* the drawing stands in */ }

  const wrap = el('div', 'vwrap');
  wrap.style.setProperty('--ink-c', team.colour || '#93f2bf');

  const head = el('div', 'vhead');
  head.appendChild(el('div', 'vname', name || 'Home venue'));
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

  const query = [name, addr].filter(Boolean).join(', ');
  const grid = el('div', 'vgrid');
  grid.append(photoUrl ? photoPane(team, photoUrl) : drawnPane(team),
              mapPane(team, query));
  wrap.appendChild(grid);
  host.appendChild(wrap);

  return { photo: !!photoUrl };
}

return { render, arenaSVG };
}));
