'use strict';
/* ============================================================================
   ARENAS — the platform console's arena editor (EPINOIA GO step 1.5, docs/epinoia-go.md).

   Every arena EPINOIA GO can stamp: where Google Maps put it (scripts/ingest/pin_arenas.py, step 1.4),
   whether a person has looked, and why the ones that need a look need one. From here an administrator:
     * opens the pin in Google Maps and looks,
     * says it is right ("right as it is": the note goes, the check is recorded),
     * moves it, by pasting the address of the right place from Google Maps, or typing lat, lng,
     * flags one for a look, sets how near the pin a stamp must be, renames it,
     * merges two rows that are one arena (merge_venues, migration 0164).

   It reads and writes `venues` directly: 0162 lets a platform administrator do both, and 0164's
   trigger records each change by hand in the audit log, with the person who made it. A merge is one
   call to merge_venues, one transaction. Until 0164 is pushed the merge says so; the rest works.

   A stamp trusts a pin only while it has no note (docs/epinoia-go.md, 3.2): flagging one here stops
   stamps at that arena until somebody puts the pin right.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaArenasUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a name, a note, a number: data, never run through the translator */
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

const PAGE = 40;
const FIELDS = 'id,name,country,city,address,lat,lng,radius_m,place_id,pin_source,pin_note,pinned_at,' +
               'checked_by,checked_at,games(count),venue_aliases(spelling),teams!teams_home_venue_id_fkey(id,name)';
const KEEP_PLACE_M = 150;             // a pin nudged this little is still the same Google place

/* ---------------------------------------------------------------- pure --- */

/* A Google Maps address, as copied from the browser's address bar, read for a pin.
   The place's own point (!3d..!4d..) beats the map's centre (@lat,lng), which is only where the
   map happened to be looking. A short link (maps.app.goo.gl) cannot be opened from here. */
function parseMapsLink(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  try { s = decodeURIComponent(s); } catch (_) {}
  if (/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(s)) return { error: 'short' };
  const num = x => Number(x);
  const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const pid = (/[?&]query_place_id=([A-Za-z0-9_-]{10,})/.exec(s) || /place_id[:=]([A-Za-z0-9_-]{10,})/.exec(s) || [])[1] || null;
  const tries = [
    [/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, 'place'],
    [/[?&](?:query|q|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/, 'query'],
    [/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, 'centre'],
    [/^\s*(-?\d{1,3}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*$/, 'typed'],
  ];
  for (const [re, how] of tries) {
    const m = re.exec(s);
    if (m && inRange(num(m[1]), num(m[2]))) return { lat: num(m[1]), lng: num(m[2]), placeId: pid, how };
  }
  return { error: 'none' };
}

function metres(a, b) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
}

/* where a row stands: 'look' (a note: a doubtful pin, or none found), 'open' (never pinned),
   'pinned' (pinned, nobody has looked), 'checked' */
function stateOf(v) {
  if (v.pin_note) return 'look';
  if (v.lat == null) return 'open';
  return v.checked_at ? 'checked' : 'pinned';
}

const gamesOf = v => (v.games && v.games[0] && v.games[0].count) || 0;

/* Google Maps at the pin, or a search for the arena where there is none. The Maps URLs form
   needs no key and opens the app on a phone. */
function mapsUrl(v) {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (v.lat != null) return base + v.lat + ',' + v.lng + (v.place_id ? '&query_place_id=' + encodeURIComponent(v.place_id) : '');
  return base + encodeURIComponent([v.name, v.city, v.country].filter(Boolean).join(', '));
}

/* the place id a moved pin keeps: the one pasted, else the old one if the pin barely moved */
function placeFor(v, p) {
  if (p.placeId) return p.placeId;
  if (v.place_id && v.lat != null && metres(v, p) <= KEEP_PLACE_M) return v.place_id;
  return null;
}

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function matches(v, q) {
  if (!q) return true;
  const hay = [v.name, v.city, v.country, v.address, ...(v.venue_aliases || []).map(a => a.spelling),
               ...(v.teams || []).map(t => t.name)].map(fold).join(' | ');
  return fold(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function sorted(rows, filter, q) {
  const want = { look: s => s === 'look' || s === 'open', pinned: s => s === 'pinned', checked: s => s === 'checked',
                 all: () => true }[filter] || (() => true);
  return rows.filter(v => want(stateOf(v)) && matches(v, q))
             .sort((a, b) => gamesOf(b) - gamesOf(a) || String(a.name).localeCompare(String(b.name)));
}

/* ---------------------------------------------------------------- page --- */

let S = null;

const STATE_WORDS = { look: 'needs a look', open: 'not pinned', pinned: 'pinned, not checked', checked: 'checked' };
const STATE_PILL = { look: 'pill off', open: 'pill', pinned: 'pill pa', checked: 'pill la' };

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  S = { sb: o.sb, say: o.say || (() => {}), oops: o.oops || (e => S.say(e && e.message, 'err')), me: o.me || null,
        host, rows: [], filter: (S && S.filter) || 'look', q: (S && S.q) || '', page: 0, open: null };
  /* its own words: "Address" is a street's here, not an email's; "Name" an arena's, not a person's */
  host.setAttribute('data-i18n-ctx', 'arenas');
  host.textContent = '';
  host.appendChild(el('p', 'lead',
    'Every arena EPINOIA GO can stamp. The pins came from Google Maps; the ones marked for a look ' +
    'are where the answer was doubtful - a shop, a park, another town - and a stamp does not trust ' +
    'them until somebody puts them right here.'));
  S.tiles = host.appendChild(el('div', 'tiles'));
  const row = S.ctrl = host.appendChild(el('div', 'row'));
  S.sel = row.appendChild(el('select', 'ep-input'));
  S.sel.style.flex = '0 0 auto';
  [['look', 'needs a look'], ['pinned', 'pinned, not checked'], ['checked', 'checked'], ['all', 'every arena']]
    .forEach(([v, t]) => { const op = el('option', null, t); op.value = v; S.sel.appendChild(op); });
  S.sel.value = S.filter;
  S.qIn = row.appendChild(el('input', 'ep-input grow'));
  S.qIn.placeholder = 'search: arena, town, club or spelling';
  S.qIn.autocomplete = 'off';
  S.qIn.value = S.q;
  S.count = row.appendChild(el('span', 'ep-micro'));
  S.listBox = host.appendChild(el('div'));
  S.detail = host.appendChild(el('div', 'hide'));
  S.sel.addEventListener('change', () => { S.filter = S.sel.value; S.page = 0; drawList(); });
  S.qIn.addEventListener('input', () => { S.q = S.qIn.value; S.page = 0; drawList(); });
  return load();
}

async function load() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data: got, error } = await S.sb.from('venues').select(FIELDS).order('name').range(from, from + 999);
    if (error) { S.oops(error); return; }
    all.push(...(got || []));
    if (!got || got.length < 1000) break;
  }
  S.rows = all;
  drawTiles();
  if (S.open) {
    const again = S.rows.find(v => v.id === S.open);
    if (again) return drawDetail(again);
    S.open = null;
  }
  drawList();
}

function tile(n, k, cls) {
  const t = el('div', 'tile');
  t.appendChild(data('div', 'n' + (cls ? ' ' + cls : ''), String(n)));
  t.appendChild(el('div', 'k', k));
  return t;
}

function drawTiles() {
  const by = { look: 0, open: 0, pinned: 0, checked: 0 };
  let games = 0, gChecked = 0;
  S.rows.forEach(v => { const s = stateOf(v); by[s]++; games += gamesOf(v); if (s === 'checked') gChecked += gamesOf(v); });
  S.tiles.textContent = '';
  S.tiles.appendChild(tile(S.rows.length, 'arenas', 'dim'));
  S.tiles.appendChild(tile(by.checked, 'arenas checked'));
  S.tiles.appendChild(tile(games ? Math.round(100 * gChecked / games) + '%' : '—', 'of games at a checked arena', 'dim'));
  S.tiles.appendChild(tile(by.look, 'need a look', by.look ? 'warn' : 'dim'));
  /* the two that are nought once the pinning script has run: shown only when they are not */
  if (by.pinned) S.tiles.appendChild(tile(by.pinned, 'pinned, not checked', 'dim'));
  if (by.open) S.tiles.appendChild(tile(by.open, 'not pinned', 'dim'));
}

function drawList() {
  S.detail.classList.add('hide');
  S.listBox.classList.remove('hide');
  S.ctrl.classList.remove('hide');
  const rows = sorted(S.rows, S.filter, S.q);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  S.page = Math.min(S.page, pages - 1);
  S.count.textContent = '';
  S.count.appendChild(data('span', null, String(rows.length)));
  S.count.appendChild(el('span', null, ' shown'));
  S.listBox.textContent = '';
  if (!rows.length) {
    S.listBox.appendChild(el('p', 'empty', S.filter === 'look' && !S.q
      ? 'Nothing needs a look: every pinned arena is either checked or has no note.' : 'No arena matches.'));
    return;
  }
  const wrap = S.listBox.appendChild(el('div', 'scroll'));
  const t = wrap.appendChild(el('table', 'tbl'));
  const hr = t.appendChild(el('thead')).appendChild(el('tr'));
  ['Arena', 'Games', 'State', 'Why it needs a look', ''].forEach((h, i) => {
    const th = hr.appendChild(el('th', null, h)); if (i === 1) th.style.textAlign = 'right'; });
  const tb = t.appendChild(el('tbody'));
  rows.slice(S.page * PAGE, S.page * PAGE + PAGE).forEach(v => {
    const tr = tb.appendChild(el('tr'));
    tr.dataset.id = v.id;
    const a = tr.appendChild(el('td'));
    a.appendChild(data('div', 'nm', v.name));
    a.appendChild(data('div', 'mt', [v.city, v.country].filter(Boolean).join(' · ')));
    tr.appendChild(data('td', 'num', String(gamesOf(v))));
    tr.appendChild(el('td')).appendChild(el('span', STATE_PILL[stateOf(v)], STATE_WORDS[stateOf(v)]));
    tr.appendChild(data('td', 'det', v.pin_note || ''));
    const b = tr.appendChild(el('td', 'ac')).appendChild(el('button', 'ep-btn mini', 'open'));
    b.type = 'button';
    b.addEventListener('click', () => { S.open = v.id; drawDetail(v); });
  });
  if (pages > 1) {
    const pg = S.listBox.appendChild(el('div', 'pager'));
    const prev = pg.appendChild(el('button', 'ep-btn mini', 'previous')); prev.type = 'button';
    pg.appendChild(data('span', null, (S.page + 1) + ' / ' + pages));
    const next = pg.appendChild(el('button', 'ep-btn mini', 'next')); next.type = 'button';
    prev.disabled = S.page === 0; next.disabled = S.page >= pages - 1;
    prev.addEventListener('click', () => { S.page--; drawList(); });
    next.addEventListener('click', () => { S.page++; drawList(); });
  }
}

/* one "label: value" line; the label is translated, the value is data */
function fact(dl, label, value) {
  dl.appendChild(el('dt', null, label));
  const dd = dl.appendChild(el('dd'));
  if (value instanceof Node) dd.appendChild(value); else dd.appendChild(data('span', null, value == null || value === '' ? '—' : String(value)));
  return dd;
}

/* THE CLUBS THAT PLAY HOME GAMES HERE WITHOUT THIS BEING THEIR RECORDED ARENA, added to the "Home arena
   of" line as they are found: the recorded clubs stay as they were, and these follow in a smaller,
   lighter type with their counts. The rule for what counts is homearenas.js's, the same one the team
   profile uses. Counted from the games on request: an arena's card is opened one at a time. */
const SEC_LIMIT = 3000;

async function addSecondary(v, dd) {
  const H = root.EpinoiaHomeArenas;
  if (!H || !S.sb) return;
  const open = S.open;
  try {
    const at = await S.sb.from('games').select('home_team_id,teams:home_team_id(name)')
      .eq('venue_id', v.id).not('home_team_id', 'is', null).limit(SEC_LIMIT);
    if (at.error || !at.data || !at.data.length) return;
    const recorded = (v.teams || []).map(t => t.id);
    const names = {};
    at.data.forEach(r => { names[r.home_team_id] = r.teams && r.teams.name; });
    const cands = [...new Set(at.data.map(r => r.home_team_id))].filter(id => !recorded.includes(id));
    if (!cands.length) return;
    const tot = await S.sb.from('games').select('home_team_id').in('home_team_id', cands)
      .not('venue_id', 'is', null).limit(SEC_LIMIT * 2);
    if (tot.error) return;
    const totals = {};
    (tot.data || []).forEach(r => { totals[r.home_team_id] = (totals[r.home_team_id] || 0) + 1; });
    const more = H.clubsUsing(at.data.map(r => r.home_team_id), totals, recorded);
    if (!more.length || S.open !== open) return;      // nothing to add, or another arena has been opened since
    const box = el('span', 'sec-arenas');
    more.forEach(c => {
      if (recorded.length || box.childNodes.length) box.appendChild(document.createTextNode(' · '));
      box.appendChild(data('span', null, names[c.id] || '—'));
      const w = el('small', 'mt', '(secondary · ' + c.n + ' of ' + c.total + ' home games)');
      w.style.marginLeft = '6px';
      box.appendChild(w);
    });
    const first = dd.querySelector('span');
    if (first && first.textContent === '—') first.remove();     // the "—" shown while nobody had it as a home
    dd.appendChild(box);
  } catch (_) { /* the line stays as it was */ }
}

async function write(v, body, done) {
  const { data: got, error } = await S.sb.from('venues').update(body).eq('id', v.id).select('id');
  if (error) return S.oops(error);
  if (!got || !got.length) return S.say('Nothing was saved: this account may not change arenas.', 'err');
  S.say(done, 'ok');
  await load();
  return true;
}

/* WHAT THE PIN SAYS ABOUT WHERE IT IS. A moved pin left the name, address, town and Google place of the
   OLD spot beside it (Saga's arena read Wembley). The arena-place function reads the new spot from Google
   and puts an arena of that place on the row - name, address, town, country, place - or finds nothing and
   leaves the name (the database has already dropped the old address and town). The pin is never moved. */
async function errText(error) {
  try {
    const b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
    if (b && b.error) return b.error;
  } catch (_) { /* fall through */ }
  return (error && error.message) || 'unknown error';
}

async function readPlace(v) {
  S.say('Reading the place at the pin…', 'ok');
  const { data: out, error } = await S.sb.functions.invoke('arena-place', { body: { venueId: v.id } });
  if (error) { S.say('The place at the pin could not be read: ' + await errText(error), 'err'); return; }
  if (!out || !out.found) {
    S.say('Google lists no arena within 150 m of the pin, so the name is left as it was and the old address stays cleared.', 'ok');
  } else {
    const a = out.applied || {};
    S.say('Updated from Google Maps: ' + [a.name || v.name, a.city].filter(Boolean).join(', ') +
          (out.aliasNote ? ' (' + out.aliasNote + ')' : '') + '.', 'ok');
  }
  await load();
}

function drawDetail(v) {
  S.listBox.classList.add('hide');
  S.ctrl.classList.add('hide');           // the list's filter and search mean nothing on one arena's card
  const d = S.detail;
  d.classList.remove('hide');
  d.textContent = '';
  const back = d.appendChild(el('button', 'ep-btn mini', 'back to the list'));
  back.type = 'button';
  back.addEventListener('click', () => { S.open = null; drawList(); });

  const card = d.appendChild(el('div', 'org-card'));
  card.appendChild(data('div', 'org-crumbs', [v.city, v.country].filter(Boolean).join(' · ')));
  card.appendChild(data('div', 'org-title', v.name));
  const st = stateOf(v);
  card.appendChild(el('span', STATE_PILL[st], STATE_WORDS[st]));
  if (v.pin_note) {
    const n = card.appendChild(el('div', 'note bad'));
    n.appendChild(el('b', null, 'Why it needs a look'));
    n.appendChild(document.createTextNode(': '));
    n.appendChild(data('span', null, v.pin_note));
  }

  const dl = card.appendChild(el('dl', 'pr-dl'));
  dl.style.marginTop = '12px';
  fact(dl, 'Games', gamesOf(v));
  fact(dl, 'Spellings the feeds use', (v.venue_aliases || []).map(a => a.spelling).join(' · '));
  const homeOf = fact(dl, 'Home arena of', (v.teams || []).map(t => t.name).join(' · '));
  addSecondary(v, homeOf);
  fact(dl, 'Address', v.address);
  fact(dl, 'Pin', v.lat != null ? v.lat.toFixed(6) + ', ' + v.lng.toFixed(6) : null);
  fact(dl, 'Google place', v.place_id);
  fact(dl, 'Pinned by', v.pin_source === 'google' ? 'Google Maps' : v.pin_source === 'manual' ? 'hand' : null)
    .querySelector('span').removeAttribute('translate');
  fact(dl, 'A stamp must be within', (v.radius_m || 300) + ' m');
  const chk = fact(dl, 'Checked', v.checked_at ? new Date(v.checked_at).toLocaleDateString() : null);
  if (v.checked_at && !v.checked_by) chk.appendChild(el('span', 'mt', ' (in the review of every pin, 24 Sep 2026)'));

  const acts = card.appendChild(el('div', 'row'));
  acts.style.marginTop = '12px';
  const open = acts.appendChild(el('a', 'ep-btn mini', v.lat != null ? 'open the pin in Google Maps' : 'search for it in Google Maps'));
  open.href = mapsUrl(v); open.target = '_blank'; open.rel = 'noopener noreferrer';
  if (v.lat != null) {
    const rp = acts.appendChild(el('button', 'ep-btn mini', 'read the name and address at this pin'));
    rp.type = 'button';
    rp.addEventListener('click', () => readPlace(v));
  }
  if (v.lat != null && (v.pin_note || !v.checked_at)) {
    const ok = acts.appendChild(el('button', 'ep-btn mini pri', 'right as it is'));
    ok.type = 'button';
    ok.addEventListener('click', () => write(v, { pin_note: null, checked_at: new Date().toISOString(), checked_by: S.me },
      'Checked: stamps now trust this pin.'));
  }
  if (!v.pin_note) {
    const fl = acts.appendChild(el('button', 'ep-btn mini danger', 'flag for a look'));
    fl.type = 'button';
    fl.addEventListener('click', () => {
      const why = window.prompt('What is wrong with this pin?', '');
      if (why == null) return;
      write(v, { pin_note: (why.trim() || 'flagged by hand').slice(0, 300), checked_at: null },
        'Flagged: stamps will not trust this pin until it is put right.');
    });
  }

  /* moving the pin */
  const mv = card.appendChild(el('div', 'org-sec'));
  mv.appendChild(el('h3', null, 'Move the pin'));
  mv.appendChild(el('p', 'lead',
    'Find the arena in Google Maps and click on it, then copy the address from the browser’s address bar ' +
    'and paste it here. Or type the coordinates, lat, lng.'));
  const mrow = mv.appendChild(el('div', 'row'));
  const inp = mrow.appendChild(el('input', 'ep-input grow'));
  inp.placeholder = 'https://www.google.com/maps/place/… or 60.4712, 26.9432';
  inp.autocomplete = 'off';
  const save = mrow.appendChild(el('button', 'ep-btn pri', 'save this pin'));
  save.type = 'button'; save.disabled = true;
  const read = mv.appendChild(el('div', 'lead'));
  let parsed = null;
  inp.addEventListener('input', () => {
    parsed = parseMapsLink(inp.value);
    read.textContent = '';
    save.disabled = !(parsed && !parsed.error);
    if (!parsed) return;
    if (parsed.error === 'short') return read.appendChild(el('span', null,
      'That is a short link. Open it, then copy the address from the address bar.'));
    if (parsed.error) return read.appendChild(el('span', null,
      'No coordinates in that. Click the arena on the map first, so the address has its point.'));
    const how = { place: 'The place’s own point', query: 'The point in the link', typed: 'Typed',
                  centre: 'The map’s centre (zoom in on the arena first, or click it)' }[parsed.how];
    /* a label and its value: the colon apart, so the label is a phrase of its own in every language */
    read.appendChild(el('span', null, how));
    read.appendChild(document.createTextNode(': '));
    read.appendChild(data('b', null, parsed.lat.toFixed(6) + ', ' + parsed.lng.toFixed(6)));
    if (v.lat != null) {
      read.appendChild(el('br'));
      read.appendChild(el('span', null, 'Distance from the pin now'));
      read.appendChild(document.createTextNode(': '));
      read.appendChild(data('b', null, Math.round(metres(v, parsed)) + ' m'));
    }
  });
  save.addEventListener('click', async () => {
    if (!parsed || parsed.error) return;
    const saved = await write(v, { lat: parsed.lat, lng: parsed.lng, place_id: placeFor(v, parsed), pin_source: 'manual',
               pinned_at: new Date().toISOString(), pin_note: null,
               checked_at: new Date().toISOString(), checked_by: S.me },
          'Pin moved and checked.');
    // a pin that moved to another place takes that place's name and address; a nudge within the
    // building has nothing new to read
    if (saved && (v.lat == null || metres(v, parsed) > KEEP_PLACE_M)) await readPlace(v);
  });

  /* how near */
  const rs = card.appendChild(el('div', 'org-sec'));
  rs.appendChild(el('h3', null, 'How near the pin a stamp must be'));
  rs.appendChild(el('p', 'lead', 'In metres, 50 to 3000. 300 covers an arena and its car park; a big campus or a park needs more.'));
  const rrow = rs.appendChild(el('div', 'row'));
  const rad = rrow.appendChild(el('input', 'ep-input'));
  rad.type = 'number'; rad.min = '50'; rad.max = '3000'; rad.step = '10'; rad.value = String(v.radius_m || 300);
  rad.style.flex = '0 0 120px';
  const rsave = rrow.appendChild(el('button', 'ep-btn', 'save'));
  rsave.type = 'button';
  rsave.addEventListener('click', () => {
    const m = Math.round(Number(rad.value));
    if (!(m >= 50 && m <= 3000)) return S.say('The distance must be between 50 and 3000 metres.', 'err');
    write(v, { radius_m: m }, 'Saved.');
  });

  /* the name */
  const nm = card.appendChild(el('div', 'org-sec'));
  nm.appendChild(el('h3', null, 'Name'));
  nm.appendChild(el('p', 'lead', 'The name EPINOIA GO shows. The spellings the feeds use stay as they are, so every game still finds the arena.'));
  const nrow = nm.appendChild(el('div', 'row'));
  const name = nrow.appendChild(el('input', 'ep-input grow'));
  name.value = v.name; name.maxLength = 200;
  const nsave = nrow.appendChild(el('button', 'ep-btn', 'rename'));
  nsave.type = 'button';
  nsave.addEventListener('click', () => {
    const n = name.value.replace(/\s+/g, ' ').trim();
    if (!n) return S.say('An arena needs a name.', 'err');
    if (n !== v.name) write(v, { name: n }, 'Renamed.');
  });

  /* merging */
  const mg = card.appendChild(el('div', 'org-sec'));
  mg.appendChild(el('h3', null, 'Merge another arena into this one'));
  mg.appendChild(el('p', 'lead',
    'When two rows are one arena: a feed’s short form and another league’s full name. The other row’s ' +
    'spellings, games and clubs move here, and the other row goes. This cannot be undone from here.'));
  const mq = mg.appendChild(el('input', 'ep-input'));
  mq.placeholder = 'search for the other arena';
  mq.autocomplete = 'off';
  mq.style.width = '100%';
  const mlist = mg.appendChild(el('div'));
  mq.addEventListener('input', () => {
    mlist.textContent = '';
    const q = mq.value.trim();
    if (q.length < 2) return;
    S.rows.filter(o => o.id !== v.id && matches(o, q)).slice(0, 8).forEach(o => {
      const r = mlist.appendChild(el('div', 'row'));
      r.style.margin = '6px 0';
      const b = r.appendChild(el('button', 'ep-btn mini danger', 'merge into this one'));
      b.type = 'button';
      r.appendChild(data('span', 'nm', o.name));
      r.appendChild(data('span', 'mt', [o.city, o.country].filter(Boolean).join(' · ')));
      r.appendChild(el('span', 'mt', gamesOf(o) + ' games'));
      b.addEventListener('click', () => merge(v, o));
    });
  });

  /* asking Google again */
  const ag = card.appendChild(el('div', 'org-sec'));
  ag.appendChild(el('h3', null, 'Ask Google Maps again'));
  ag.appendChild(el('p', 'lead', 'From the computer that holds the Google key:'));
  ag.appendChild(data('div', 'det', 'python scripts/ingest/pin_arenas.py --worker-config --venue ' + v.id + ' --write'));
}

async function merge(keep, other) {
  if (!window.confirm('Merge “' + other.name + '” into “' + keep.name + '”? Its spellings, games and clubs move here, and it goes.')) return;
  const { data: r, error } = await S.sb.rpc('merge_venues', { p_keep: keep.id, p_other: other.id });
  if (error) return S.oops(error);
  S.say('Merged.', 'ok');
  await load();
  return r;
}

return { mount, parseMapsLink, metres, stateOf, mapsUrl, placeFor, sorted, matches, KEEP_PLACE_M };
}));
