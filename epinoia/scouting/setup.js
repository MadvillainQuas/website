'use strict';
/* ============================================================================
   SET UP YOUR SCOUT — what the scouting page loads, chosen before it loads it.
                                                        window.EpinoiaScoutSetup

   The scouting page used to read every league on the platform the moment it
   opened: dozens of season reads for a scout who wanted two leagues' under-23s.
   Now it opens on this panel, drawn from the light read alone (global.js
   catalogue(): the leagues, what the viewer may see, their seasons), and reads
   nothing heavy until LOAD. What is chosen:

     leagues   a tile per league with its crest, grouped by country with its flag,
               searchable, all of a country at once, the reader's followed leagues
     seasons   each league's current season, or named seasons where a league has them
     who       men's, women's or all (leagues.gender); a league that has not said
               shows under "all", or under either when the scout asks for it
     players   age, height, weight (each a range, either end optional), position
               (G / F / C, from the roster's position), a floor on games and minutes,
               and whether a player with no value for a range stays in

   THE ADDRESS IS THE SET-UP. ?leagues=slug,slug&season=2025-26&g=women&age=18-23
   &ht=190-&wt=-110&pos=G,F&gp=5&mpg=10&unk=1, and &go=1 to load at once (a shared
   link does; a returning reader's own set-up, kept in this browser per account,
   pre-fills the panel and waits for LOAD). The table's own state (?s=, ?f=, ?lg= …)
   rides beside it untouched. An older link keeps working: ?lg=<league> (the table's
   league filter) loads that league, and ?g= was always the gender.

   UMD: node requires the pure parts for supabase/tests/scouting-setup.test.mjs;
   the browser gets mount() as well, which scouting.js calls.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaScoutSetup = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const fin = v => typeof v === 'number' && isFinite(v);

/* the ranges a scout can set, and the ends an input is held to */
const BOUNDS = Object.freeze({ age: [14, 45], ht: [150, 235], wt: [45, 160], gp: [0, 82], mpg: [0, 48] });
const POS = ['G', 'F', 'C'];
/* more leagues than this asks first: every one is a season read */
const HUGE = 25;

const DEFAULT_SETUP = Object.freeze({ leagues: [], seasons: [], g: '', gu: false, age: null, ht: null, wt: null,
  pos: [], gp: 0, mpg: 0, unk: false });
const SP = Object.freeze({ leagues: 'leagues', seasons: 'season', g: 'g', gu: 'gu', age: 'age', ht: 'ht', wt: 'wt',
  pos: 'pos', gp: 'gp', mpg: 'mpg', unk: 'unk', go: 'go' });
const OWNED = Object.keys(SP).map(k => SP[k]);

const blank = () => ({ leagues: [], seasons: [], g: '', gu: false, age: null, ht: null, wt: null, pos: [], gp: 0, mpg: 0, unk: false });

/* ------------------------------------------------------------- a range ---
   '18-23', '18-' (18 and over), '-23' (23 and under). Each end within the bounds, the
   two the right way round; nothing usable is null (no range, everyone passes). */
function clampTo(kind, n) {
  const b = BOUNDS[kind] || [-Infinity, Infinity];
  return Math.min(b[1], Math.max(b[0], n));
}
function cleanRange(r, kind) {
  if (!Array.isArray(r)) return null;
  let [a, b] = r.map(v => (v === '' || v == null || !fin(Number(v)) ? null : clampTo(kind, Math.round(Number(v)))));
  if (a == null && b == null) return null;
  if (a != null && b != null && a > b) { const t = a; a = b; b = t; }
  const lo = (BOUNDS[kind] || [])[0], hi = (BOUNDS[kind] || [])[1];
  /* the whole range is no range */
  if ((a == null || a === lo) && (b == null || b === hi)) return null;
  return [a, b];
}
function parseRange(v, kind) {
  if (v == null) return null;
  const m = /^\s*(\d{1,3})?\s*-\s*(\d{1,3})?\s*$/.exec(String(v)) || /^\s*(\d{1,3})\s*$/.exec(String(v));
  if (!m) return null;
  if (m.length === 2) return cleanRange([m[1], m[1]], kind);   // '20': exactly
  return cleanRange([m[1], m[2]], kind);
}
const fmtRange = r => (r ? (r[0] != null ? r[0] : '') + '-' + (r[1] != null ? r[1] : '') : '');

const SLUG = /^[\w.~-]{1,80}$/;
const cleanList = (v, max) => String(v || '').split(',').map(s => s.trim()).filter(s => s && SLUG.test(s))
  .filter((s, i, a) => a.indexOf(s) === i).slice(0, max);
const cleanSeason = s => String(s || '').trim().slice(0, 20);

/* any object (the address, this browser's copy) as a set-up with nothing odd in it */
function cleanSetup(o) {
  const x = o || {};
  const out = blank();
  out.leagues = cleanList(Array.isArray(x.leagues) ? x.leagues.join(',') : x.leagues, 200);
  out.seasons = (Array.isArray(x.seasons) ? x.seasons : String(x.seasons || '').split(','))
    .map(cleanSeason).filter(s => /^[\w -]{1,20}$/.test(s)).filter((s, i, a) => a.indexOf(s) === i).slice(0, 8);
  if (out.seasons.length === 1 && out.seasons[0].toLowerCase() === 'current') out.seasons = [];
  out.g = x.g === 'men' || x.g === 'women' ? x.g : '';
  out.gu = !!x.gu && !!out.g;
  ['age', 'ht', 'wt'].forEach(k => { out[k] = typeof x[k] === 'string' ? parseRange(x[k], k) : cleanRange(x[k], k); });
  const pos = Array.isArray(x.pos) ? x.pos : String(x.pos || '').split(',');
  out.pos = POS.filter(p => pos.map(s => String(s).trim().toUpperCase()).indexOf(p) >= 0);
  if (out.pos.length === POS.length) out.pos = [];            // every position is no filter
  ['gp', 'mpg'].forEach(k => { const n = Math.round(Number(x[k])); out[k] = fin(n) && n > 0 ? clampTo(k, n) : 0; });
  out.unk = !!x.unk;
  return out;
}

/* ------------------------------------------------------------ the address ---
   -> { setup, go, has, legacy }. has: the address says something about the set-up at all
   (it then wins over this browser's copy). legacy: an older link, mapped. */
function readSetup(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const g = k => p.get(SP[k]);
  const has = OWNED.some(k => k !== 'go' && p.has(k));
  const setup = cleanSetup({
    leagues: g('leagues') || '', seasons: g('seasons') || '', g: (g('g') || '').toLowerCase(),
    gu: g('gu') === '1', age: g('age'), ht: g('ht'), wt: g('wt'), pos: g('pos') || '',
    gp: g('gp'), mpg: g('mpg'), unk: g('unk') === '1'
  });
  let go = g('go') === '1' && setup.leagues.length > 0;
  let legacy = false;
  /* THE TABLE'S LEAGUE FILTER (?lg=), from before the set-up: the link was to that league's
     rows, so it loads that league (and keeps ?lg=, which the table still reads) */
  const lg = p.get('lg');
  if (!setup.leagues.length && lg && SLUG.test(lg)) { setup.leagues = [lg]; go = true; legacy = true; }
  return { setup, go, has: has || legacy, legacy };
}

/* a set-up -> the query string, keeping every parameter it does not own (the table's) */
function writeSetup(setup, search, opts) {
  const p = new URLSearchParams(search || '');
  OWNED.forEach(k => p.delete(k));
  const s = cleanSetup(setup);
  if (s.leagues.length) p.set(SP.leagues, s.leagues.join(','));
  if (s.seasons.length) p.set(SP.seasons, s.seasons.join(','));
  if (s.g) p.set(SP.g, s.g);
  if (s.gu) p.set(SP.gu, '1');
  ['age', 'ht', 'wt'].forEach(k => { if (s[k]) p.set(SP[k], fmtRange(s[k])); });
  if (s.pos.length) p.set(SP.pos, s.pos.join(','));
  if (s.gp) p.set(SP.gp, String(s.gp));
  if (s.mpg) p.set(SP.mpg, String(s.mpg));
  if (s.unk) p.set(SP.unk, '1');
  if (opts && opts.go && s.leagues.length) p.set(SP.go, '1');
  const out = p.toString().replace(/%2C/g, ',');
  return out ? '?' + out : '';
}

/* ------------------------------------------------------------- a player ---
   bio is ages.js loadBio's answer for him ({h, w, a, y}) or nothing. */
function ageOf(bio, year) {
  if (!bio) return null;
  if (fin(bio.a)) return bio.a;
  if (fin(bio.y)) return (fin(year) ? year : new Date().getUTCFullYear()) - bio.y;
  return null;
}
function inRange(v, r, keepUnknown) {
  if (!r) return true;
  if (!fin(v) || v <= 0) return !!keepUnknown;
  if (r[0] != null && v < r[0]) return false;
  if (r[1] != null && v > r[1]) return false;
  return true;
}
/* a roster's position as G, F and C: 'PG', 'SHOOTING_GUARD', 'GF', 'C/F', 'F-C' … */
const POS_WORD = { PG: 'G', SG: 'G', G: 'G', GUARD: 'G', POINTGUARD: 'G', SHOOTINGGUARD: 'G', COMBOGUARD: 'G', BASE: 'G', ESCOLTA: 'G',
  SF: 'F', PF: 'F', F: 'F', FORWARD: 'F', SMALLFORWARD: 'F', POWERFORWARD: 'F', WING: 'F', ALERO: 'F', ALAPIVOT: 'F',
  C: 'C', CENTER: 'C', CENTRE: 'C', PIVOT: 'C', PÍVOT: 'C' };
function posBuckets(pos) {
  const out = new Set();
  String(pos || '').toUpperCase().split(/[\/,;|\s-]+/).forEach(tok => {
    const t = tok.replace(/[^A-ZÍ_]/g, '');
    if (!t) return;
    const w = POS_WORD[t.replace(/_/g, '')];
    if (w) { out.add(w); return; }
    if (/^[GFC]{2,3}$/.test(t)) [...t].forEach(ch => out.add(ch));
  });
  return POS.filter(p => out.has(p));
}
function needsBio(setup) { const s = setup || {}; return !!(s.age || s.ht || s.wt); }

/* does this row stay in the table? gp and min are the season totals on the row */
function rowPasses(row, bio, setup, year) {
  const s = setup || DEFAULT_SETUP;
  const r = row || {};
  const gp = Number(r.gp) || 0;
  if (s.gp && gp < s.gp) return false;
  if (s.mpg && (gp ? (Number(r.min) || 0) / gp : 0) < s.mpg) return false;
  if (s.pos && s.pos.length) {
    const b = posBuckets(r.position);
    if (!b.length) { if (!s.unk) return false; }
    else if (!b.some(p => s.pos.indexOf(p) >= 0)) return false;
  }
  if (!inRange(ageOf(bio, year), s.age, s.unk)) return false;
  if (!inRange(bio && bio.h, s.ht, s.unk)) return false;
  if (!inRange(bio && bio.w, s.wt, s.unk)) return false;
  return true;
}

/* how much of a loaded selection has each number: {players, age, ht, wt} as whole percents */
function coverage(rows, bioOf) {
  const list = rows || [];
  const n = list.length;
  if (!n) return { players: 0, age: 0, ht: 0, wt: 0 };
  let a = 0, h = 0, w = 0;
  list.forEach(r => {
    const b = bioOf(r);
    if (!b) return;
    if (fin(b.a) || fin(b.y)) a++;
    if (fin(b.h) && b.h > 0) h++;
    if (fin(b.w) && b.w > 0) w++;
  });
  const pc = x => Math.round(100 * x / n);
  return { players: n, age: pc(a), ht: pc(h), wt: pc(w) };
}

/* ------------------------------------------------------------ the leagues --- */
/* the leagues a scout of this gender is offered: a league that has not said only under
   "all", unless the scout asks for those too (gu) */
function leaguesFor(leagues, g, gu) {
  return (leagues || []).filter(L => !g || L.gender === g || (!!gu && !L.gender));
}
/* ids or slugs -> the catalogue's leagues, in the catalogue's order */
function resolve(list, leagues) {
  const want = new Set((list || []).map(String));
  return (leagues || []).filter(L => want.has(String(L.id)) || want.has(String(L.slug)));
}
/* the season names these leagues have, newest first, each with how many of them have it */
function seasonChoices(leagues) {
  const m = new Map();
  (leagues || []).forEach(L => (L.seasons || []).forEach((s, i) => {
    if (!s || !s.name) return;
    const e = m.get(s.name) || { name: s.name, n: 0, startsOn: s.startsOn || '', current: 0 };
    e.n++; if (i === 0) e.current++;
    if ((s.startsOn || '') > e.startsOn) e.startsOn = s.startsOn;
    m.set(s.name, e);
  }));
  return [...m.values()].sort((a, b) => (b.startsOn || '').localeCompare(a.startsOn || '') || b.name.localeCompare(a.name));
}
/* the (league, season) reads a set-up makes */
function unitsOf(leagues, seasons) {
  const want = (seasons || []).map(s => String(s).toLowerCase());
  if (!want.length) return (leagues || []).filter(L => (L.seasons || []).length || L.seasonId).length;
  let n = 0;
  (leagues || []).forEach(L => (L.seasons || []).forEach((s, i) => {
    if ((i === 0 && want.indexOf('current') >= 0) || want.indexOf(String(s.name).toLowerCase()) >= 0) n++;
  }));
  return n;
}
/* ~players and how heavy: a club is about twelve players; a league we know nothing of, ten clubs */
const PER_TEAM = 12;
function estimate(leagues, seasons, teamCount) {
  const tc = teamCount || {};
  const units = unitsOf(leagues, seasons);
  const perSeason = (leagues || []).length ? units / leagues.length : 0;
  let players = 0;
  (leagues || []).forEach(L => { players += (fin(tc[L.id]) && tc[L.id] > 0 ? tc[L.id] : 10) * PER_TEAM * perSeason; });
  players = Math.round(players / 50) * 50;
  const weight = units <= 4 ? 'light' : units <= 12 ? 'medium' : 'heavy';
  return { leagues: (leagues || []).length, units, players, weight, huge: units > HUGE };
}

/* ------------------------------------------------------------ the summary ---
   The line over the table: ['12 leagues', '2026-27', 'men’s', 'age 18-23', '190-210 cm'].
   o.height / o.weight format a centimetre or kilogram figure in the reader's units. */
function rangeWords(r, unit, f) {
  const x = v => (f ? f(v) : String(v) + (unit ? ' ' + unit : ''));
  if (r[0] != null && r[1] != null) return f ? x(r[0]) + '–' + x(r[1]) : r[0] + '–' + r[1] + (unit ? ' ' + unit : '');
  if (r[0] != null) return x(r[0]) + '+';
  return 'up to ' + x(r[1]);
}
function summaryParts(setup, o) {
  const s = cleanSetup(setup);
  const opt = o || {};
  const n = fin(opt.leagues) ? opt.leagues : s.leagues.length;
  const out = [n + (n === 1 ? ' league' : ' leagues')];
  out.push(s.seasons.length ? s.seasons.map(x => (x.toLowerCase() === 'current' ? 'current season' : x)).join(' + ') : 'current season');
  out.push(s.g === 'men' ? 'men’s' : s.g === 'women' ? 'women’s' : 'men’s and women’s');
  if (s.age) out.push('age ' + rangeWords(s.age, ''));
  if (s.ht) out.push(rangeWords(s.ht, 'cm', opt.height));
  if (s.wt) out.push(rangeWords(s.wt, 'kg', opt.weight));
  if (s.pos.length) out.push(s.pos.join('/'));
  if (s.gp) out.push(s.gp + '+ games');
  if (s.mpg) out.push(s.mpg + '+ min');
  if (s.unk && (s.age || s.ht || s.wt || s.pos.length)) out.push('unknowns kept');
  return out;
}

/* ------------------------------------------------------------ this browser --- */
const STORE_V = 'epinoia.scout.v1';
const storeKey = uid => STORE_V + ':' + (uid ? String(uid).slice(0, 64) : 'anon');
function loadStored(store, key) {
  try {
    const raw = store && store.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? cleanSetup(j) : null;
  } catch (_) { return null; }
}
function saveStored(store, key, setup) {
  try { if (store) store.setItem(key, JSON.stringify(cleanSetup(setup))); return true; } catch (_) { return false; }
}
/* the signed-in account's id, from the session Supabase keeps in this browser (never a request) */
function userId(store, supabaseUrl) {
  try {
    const m = String(supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
    const raw = m && store && store.getItem('sb-' + m[1] + '-auth-token');
    const j = raw && JSON.parse(raw);
    const u = j && (j.user || (j.currentSession && j.currentSession.user));
    return (u && u.id) || '';
  } catch (_) { return ''; }
}

/* =============================================================== the panel ===
   mount(o) wires the panel already in the page (index.html #su), so it is on screen and
   usable before any script has read anything; the league tiles and the season chips fill
   in when the catalogue lands.
     o.initial      the set-up to start from
     o.catalogue    Promise of global.js catalogue()
     o.teamCount    Promise of {leagueId: clubs} (the size estimate; optional)
     o.follows      Promise of [leagueId] the reader follows (optional)
     o.onChange(setup)   every change (the page keeps it)
     o.onLoad(setup, info)   LOAD pressed; info {leagues, estimate}
   Returns { get(), set(setup), open(), close(), busy(bool) }. */
function mount(o) {
  const doc = root.document;
  const form = doc && doc.querySelector('#su');
  if (!form) return null;
  const $ = s => form.querySelector(s);
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const U = () => root.EpinoiaUnits || null;
  const Country = root.EpinoiaCountry || null;

  let setup = cleanSetup(o.initial);
  let cat = null;                          // the catalogue, once it lands
  let teamCount = {};
  let follows = [];
  let query = '';

  const emit = () => { paintSize(); if (typeof o.onChange === 'function') { try { o.onChange(cleanSetup(setup)); } catch (_) { /* the panel still works */ } } };
  const offered = () => (cat ? leaguesFor(cat.leagues, setup.g, setup.gu) : []);
  const chosen = () => (cat ? resolve(setup.leagues, cat.leagues) : []);

  /* ---- who ---- */
  const seg = $('#suWho');
  const paintWho = () => {
    [].forEach.call(seg.querySelectorAll('button[data-g]'), b => b.setAttribute('aria-pressed', String(b.getAttribute('data-g') === setup.g)));
    const box = $('#suUnstatedL');
    const n = cat ? cat.leagues.filter(L => !L.gender).length : 0;
    if (box) box.classList.toggle('hide', !setup.g || !n);
    const cb = $('#suUnstated'); if (cb) cb.checked = !!setup.gu;
    const nn = $('#suUnstatedN'); if (nn) nn.textContent = String(n);
  };
  seg.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button[data-g]');
    if (!b) return;
    const g = b.getAttribute('data-g') || '';
    if (g === setup.g) return;
    setup.g = g;
    if (!g) setup.gu = false;
    keepOffered();
    paintWho(); paintLeagues(); paintSeasons(); emit();
  });
  const unst = $('#suUnstated');
  if (unst) unst.addEventListener('change', () => { setup.gu = !!unst.checked; keepOffered(); paintLeagues(); paintSeasons(); emit(); });
  /* a league the gender now hides is not quietly loaded anyway */
  function keepOffered() {
    if (!cat) return;
    const ok = new Set(offered().map(L => L.id));
    setup.leagues = resolve(setup.leagues, cat.leagues).filter(L => ok.has(L.id)).map(L => L.slug || L.id);
  }

  /* ---- leagues ---- */
  const groupsHost = $('#suGroups');
  const find = $('#suFind');
  if (find) find.addEventListener('input', () => { query = find.value.trim().toLowerCase(); paintLeagues(); });
  const matches = L => !query || [L.name, L.short, L.slug, L.country, Country ? Country.countryName(L.country) : '']
    .some(v => String(v || '').toLowerCase().indexOf(query) >= 0);
  const isOn = L => setup.leagues.indexOf(L.slug) >= 0 || setup.leagues.indexOf(L.id) >= 0;
  function setOn(L, on) {
    setup.leagues = setup.leagues.filter(x => x !== L.slug && x !== L.id);
    if (on) setup.leagues.push(L.slug || L.id);
  }
  function crest(L) {
    const box = el('span', 'su-crest');
    box.setAttribute('aria-hidden', 'true');
    const initials = () => { box.textContent = (L.short || '?').replace(/\s+/g, '').slice(0, 4); box.classList.add('ini');
      if (L.colour) box.style.setProperty('--su-c', L.colour); };
    const url = L.logoPath && root.epinoiaLogoUrl ? root.epinoiaLogoUrl(L.logoPath, 96) : null;
    if (!url) { initials(); return box; }
    const img = el('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 40; img.height = 40;
    img.addEventListener('error', () => { img.remove(); initials(); });
    img.src = url;
    box.appendChild(img);
    return box;
  }
  function flag(code) {
    const box = el('span', 'su-flag');
    box.setAttribute('aria-hidden', 'true');
    const parts = Country ? Country.parts(code) : [];
    if (!parts.length) { box.textContent = Country ? Country.flagOf(code) : ''; return box; }
    parts.forEach(p => {
      if (p.src) { const i = el('img'); i.alt = ''; i.width = 20; i.height = 14; i.src = '../' + p.src; box.appendChild(i); }
      else box.appendChild(doc.createTextNode(p.flag));
    });
    return box;
  }
  function tile(L) {
    const lab = el('label', 'su-tile' + (L.locked ? ' locked' : ''));
    if (L.colour) lab.style.setProperty('--su-c', L.colour);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !L.locked && isOn(L);
    cb.disabled = !!L.locked;
    cb.value = L.slug || L.id;
    cb.addEventListener('change', () => { setOn(L, cb.checked); lab.classList.toggle('on', cb.checked); paintCounts(); paintSeasons(); emit(); });
    lab.classList.toggle('on', cb.checked);
    const txt = el('span', 'su-tt');
    const nm = el('span', 'su-nm', L.name);
    nm.setAttribute('translate', 'no');
    const meta = el('span', 'su-mt');
    const bits = [];
    if (L.gender === 'men') bits.push('men’s'); else if (L.gender === 'women') bits.push('women’s');
    if (L.locked) bits.push('members only');
    else if (L.seasons && L.seasons.length) bits.push(L.seasons.length > 1 ? L.seasons.length + ' seasons' : L.seasons[0].name);
    else bits.push('no season yet');
    if (fin(teamCount[L.id])) bits.push(teamCount[L.id] + (teamCount[L.id] === 1 ? ' club' : ' clubs'));
    meta.textContent = bits.join(' · ');
    txt.append(nm, meta);
    lab.append(cb, crest(L), txt);
    return lab;
  }
  let groupEls = [];
  function paintLeagues() {
    if (!cat || !groupsHost) return;
    groupsHost.removeAttribute('aria-busy');
    groupsHost.textContent = '';
    groupEls = [];
    const ids = new Set(offered().map(L => L.id));
    const locked = (cat.all || []).filter(L => L.locked && (!setup.g || L.gender === setup.g || (setup.gu && !L.gender)));
    const list = cat.leagues.filter(L => ids.has(L.id)).concat(locked).filter(matches);
    if (!list.length) {
      const e = el('div', 'pg-empty');
      e.appendChild(el('p', '', cat.leagues.length ? 'No league matches that. Try another name or country.' : 'No league is open to you yet.'));
      groupsHost.appendChild(e);
      paintCounts();
      return;
    }
    const groups = Country ? Country.group(list) : [{ code: '', name: '', leagues: list }];
    groups.forEach(g => {
      const box = el('div', 'su-group');
      const head = el('div', 'su-gh');
      const title = el('span', 'su-gn');
      title.append(flag(g.code), el('span', '', g.name));
      const cnt = el('span', 'su-gc');
      const all = el('button', 'ep-chip su-gall', 'all');
      all.type = 'button';
      const open = g.leagues.filter(L => !L.locked);
      all.setAttribute('aria-label', 'Choose every league in ' + g.name);
      all.disabled = !open.length;
      all.addEventListener('click', () => {
        const every = open.every(isOn);
        open.forEach(L => setOn(L, !every));
        paintLeagues(); paintSeasons(); emit();
        const again = groupsHost.querySelector('.su-group[data-code="' + g.code + '"] .su-gall');
        if (again) again.focus();
      });
      head.append(title, cnt, all);
      const grid = el('div', 'su-grid');
      g.leagues.forEach(L => grid.appendChild(tile(L)));
      box.setAttribute('data-code', g.code);
      box.append(head, grid);
      groupsHost.appendChild(box);
      groupEls.push({ g, cnt, all, open });
    });
    paintCounts();
  }
  function paintCounts() {
    groupEls.forEach(x => {
      const on = x.open.filter(isOn).length;
      x.cnt.textContent = on + '/' + x.open.length;
      x.all.textContent = x.open.length && on === x.open.length ? 'none' : 'all';
      x.all.setAttribute('aria-pressed', String(!!x.open.length && on === x.open.length));
    });
    const mine = $('#suMine');
    if (mine) {
      const ids = follows.filter(id => cat && cat.leagues.some(L => L.id === id));
      mine.classList.toggle('hide', !ids.length);
      mine.textContent = 'my leagues (' + ids.length + ')';
    }
  }
  const btn = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
  btn('#suAll', () => { if (!cat) return; offered().filter(matches).forEach(L => setOn(L, true)); paintLeagues(); paintSeasons(); emit(); });
  btn('#suNone', () => { setup.leagues = []; paintLeagues(); paintSeasons(); emit(); });
  btn('#suMine', () => {
    if (!cat) return;
    const mine = cat.leagues.filter(L => follows.indexOf(L.id) >= 0);
    if (setup.g && mine.some(L => !leaguesFor([L], setup.g, setup.gu).length)) { setup.g = ''; setup.gu = false; paintWho(); }
    setup.leagues = mine.map(L => L.slug || L.id);
    paintLeagues(); paintSeasons(); emit();
  });

  /* ---- seasons ---- */
  const chips = $('#suSeasonChips');
  function paintSeasons() {
    if (!chips || !cat) return;
    const pool = chosen().length ? chosen() : offered();
    const list = seasonChoices(pool);
    chips.textContent = '';
    const want = setup.seasons.map(s => s.toLowerCase());
    const cur = el('button', 'ep-chip' + (!want.length || want.indexOf('current') >= 0 ? ' on' : ''), 'current season');
    cur.type = 'button';
    cur.setAttribute('aria-pressed', String(!want.length || want.indexOf('current') >= 0));
    cur.addEventListener('click', () => {
      const on = !want.length || want.indexOf('current') >= 0;
      if (on && !want.length) return;                    // current alone stays on: something must be read
      setup.seasons = on ? setup.seasons.filter(s => s.toLowerCase() !== 'current') : setup.seasons.concat('current');
      if (setup.seasons.length === 1 && setup.seasons[0] === 'current') setup.seasons = [];
      paintSeasons(); emit();
    });
    chips.appendChild(cur);
    list.forEach(s => {
      const on = want.indexOf(s.name.toLowerCase()) >= 0;
      const b = el('button', 'ep-chip' + (on ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.append(el('span', '', s.name), el('span', 'su-cn', ' · ' + s.n));
      b.setAttribute('aria-label', s.name + ', ' + s.n + (s.n === 1 ? ' league' : ' leagues'));
      b.addEventListener('click', () => {
        if (on) setup.seasons = setup.seasons.filter(x => x.toLowerCase() !== s.name.toLowerCase());
        else setup.seasons = (setup.seasons.length ? setup.seasons : ['current']).concat(s.name);
        /* the current season named alongside nothing else is the default */
        if (setup.seasons.length === 1 && setup.seasons[0] === 'current') setup.seasons = [];
        paintSeasons(); emit();
      });
      chips.appendChild(b);
    });
    const hint = $('#suSeasonHint');
    if (hint) {
      const past = list.filter(s => s.n > s.current);
      hint.textContent = past.length ? 'Earlier seasons are read only where a league has them.'
        : 'Each league’s newest season. Earlier seasons appear here where a league has them.';
    }
  }

  /* ---- players ---- */
  const RANGE = [['age', '#suAgeMin', '#suAgeMax'], ['ht', '#suHtMin', '#suHtMax'], ['wt', '#suWtMin', '#suWtMax']];
  const num = sel => { const i = $(sel); if (!i) return null; const v = String(i.value).trim(); return v === '' ? null : Number(v); };
  function readRanges() {
    RANGE.forEach(([k, a, b]) => { setup[k] = cleanRange([num(a), num(b)], k); });
    ['gp', 'mpg'].forEach(k => { const v = num(k === 'gp' ? '#suGp' : '#suMpg'); setup[k] = fin(v) && v > 0 ? clampTo(k, Math.round(v)) : 0; });
    const u = $('#suUnk'); setup.unk = !!(u && u.checked);
  }
  function paintEq() {
    const Un = U();
    const eq = (sel, k, f) => {
      const n = $(sel); if (!n) return;
      const r = setup[k];
      n.textContent = r && Un ? '≈ ' + [r[0], r[1]].map(v => (v == null ? '…' : f(v))).join(' – ') : '';
    };
    eq('#suHtEq', 'ht', v => Un.height(v, 'imperial'));
    eq('#suWtEq', 'wt', v => Un.weight(v, 'imperial'));
  }
  function paintPlayers() {
    RANGE.forEach(([k, a, b]) => {
      const r = setup[k]; const ia = $(a), ib = $(b);
      if (ia) ia.value = r && r[0] != null ? String(r[0]) : '';
      if (ib) ib.value = r && r[1] != null ? String(r[1]) : '';
    });
    const gp = $('#suGp'); if (gp) gp.value = setup.gp ? String(setup.gp) : '';
    const mpg = $('#suMpg'); if (mpg) mpg.value = setup.mpg ? String(setup.mpg) : '';
    const u = $('#suUnk'); if (u) u.checked = !!setup.unk;
    [].forEach.call(form.querySelectorAll('#suPos button[data-pos]'), b => b.setAttribute('aria-pressed', String(setup.pos.indexOf(b.getAttribute('data-pos')) >= 0)));
    paintEq();
  }
  [].forEach.call(form.querySelectorAll('#suPlayers input'), i => {
    i.addEventListener('input', () => { readRanges(); paintEq(); emit(); });
    /* on leaving a box, its value as it will be used (held to the range, the ends in order) */
    i.addEventListener('change', () => { readRanges(); paintPlayers(); emit(); });
  });
  const posBox = $('#suPos');
  if (posBox) posBox.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button[data-pos]');
    if (!b) return;
    const p = b.getAttribute('data-pos');
    setup.pos = setup.pos.indexOf(p) >= 0 ? setup.pos.filter(x => x !== p) : POS.filter(x => x === p || setup.pos.indexOf(x) >= 0);
    if (setup.pos.length === POS.length) setup.pos = [];
    paintPlayers(); emit();
  });

  /* ---- the size, and LOAD ---- */
  const size = $('#suSize'), load = $('#suLoad');
  function paintSize() {
    const L = chosen();
    if (load) load.disabled = !L.length || busy;
    if (!size) return;
    size.textContent = '';
    if (!cat) { size.textContent = 'Reading the leagues…'; return; }
    if (!L.length) { size.textContent = 'Choose at least one league to load.'; return; }
    const e = estimate(L, setup.seasons, teamCount);
    const w = el('span', 'su-w ' + e.weight, e.weight);
    size.append(el('span', '', L.length + (L.length === 1 ? ' league' : ' leagues')),
      doc.createTextNode(' · '), el('span', '', '~' + e.players.toLocaleString('en-GB') + ' players'),
      doc.createTextNode(' · '), w);
    if (e.units !== L.length) size.append(doc.createTextNode(' · '), el('span', '', e.units + ' seasons'));
  }
  let busy = false;
  form.addEventListener('submit', e => {
    e.preventDefault();
    readRanges();
    const L = chosen();
    if (!L.length || busy) return;
    const est = estimate(L, setup.seasons, teamCount);
    if (est.huge && typeof root.confirm === 'function' &&
        !root.confirm('All ' + est.units + ' of these will take a while to load. Continue?')) return;
    if (typeof o.onLoad === 'function') o.onLoad(cleanSetup(setup), { leagues: L, estimate: est });
  });
  btn('#suReset', () => { setup = blank(); if (find) { find.value = ''; query = ''; } paintAll(); emit(); });

  function paintAll() { paintWho(); paintLeagues(); paintSeasons(); paintPlayers(); paintSize(); }
  paintPlayers(); paintWho(); paintSize();

  Promise.resolve(o.catalogue).then(c => {
    cat = c || { leagues: [], all: [] };
    /* a set-up naming leagues this reader may not load keeps only those they may */
    paintAll();
  }, () => {
    if (groupsHost) { groupsHost.removeAttribute('aria-busy'); groupsHost.textContent = '';
      const e = el('div', 'pg-empty'); e.appendChild(el('p', '', 'Could not read the leagues. Check your connection and reload.')); groupsHost.appendChild(e); }
    if (size) size.textContent = '';
  });
  if (o.teamCount) Promise.resolve(o.teamCount).then(t => { teamCount = t || {}; if (cat) { paintLeagues(); paintSize(); } }, () => {});
  if (o.follows) Promise.resolve(o.follows).then(f => { follows = Array.isArray(f) ? f : []; paintCounts(); }, () => {});

  const sec = doc.querySelector('#setup');
  return {
    get: () => cleanSetup(setup),
    set(s) { setup = cleanSetup(s); paintAll(); },
    open() {
      if (!sec) return;
      sec.classList.remove('hide', 'su-closed');
      sec.classList.add('su-opening');
      setTimeout(() => sec.classList.remove('su-opening'), 700);
    },
    close() { if (sec) sec.classList.add('hide'); },
    busy(b) { busy = !!b; if (load) { load.textContent = b ? 'loading…' : 'LOAD'; } paintSize(); },
    catalogue: () => cat
  };
}

return { mount, readSetup, writeSetup, cleanSetup, parseRange, cleanRange, fmtRange, ageOf, inRange, posBuckets,
  rowPasses, needsBio, coverage, leaguesFor, resolve, seasonChoices, unitsOf, estimate, summaryParts,
  storeKey, loadStored, saveStored, userId, DEFAULT_SETUP, BOUNDS, POS, HUGE, SP, OWNED };
}));
