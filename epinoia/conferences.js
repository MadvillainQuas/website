'use strict';
/* ============================================================================
   COLLEGE SYSTEMS AND THEIR CONFERENCES (Louie, 2026-10-16).

   U SPORTS and NCAA Division II are not read as one league each. Each is a SYSTEM, shown like a country - a hub page
   of its own, a rail of its own - and each of its CONFERENCES is shown like a league: a front page, a table, fixtures,
   statistics, teams, all of them that conference's clubs. The data stays one league per system (NCAA D2 one a side):
   a conference is a view, the clubs whose competition_teams.group_name is that conference (0144), so a non-conference
   game is on both conferences' pages and a club's season stays whole.

   A club with no conference in a conference league is not one of the system's (Baylor, UC Irvine and a touring side
   came into U SPORTS 2026-27 that way, 15 Oct): it is shown nowhere - not in a table, a club list, the statistics -
   though its games stay (Louie: "keep the existing games but no more after this").

   This file is the systems' own facts - each conference's name, logo, region and where its members are - and the
   one rule every page uses to decide which clubs it shows (scope). The logos are each conference's own, from its own
   site (Louie approved the 27 files, 2026-10-16), shown on a white tile so the light-ground versions read in the dark
   theme too. NCAA D2's conferences are grouped by the NCAA's own eight Division II basketball regions; U SPORTS's
   four are four regions of Canada. `where`: the states or provinces most of a conference's members are in (each
   conference's own 2026-27 member list, read 2026-10-16). A REGION'S `where` is where it is drawn on the hub's map
   (maps.js), each state or province in one region only (the one most of its D2 members play in); its colour is its
   own on the map and beside its name.

   Pure where it can be (the tests run it under node: supabase/tests/conferences.test.mjs); the DOM parts only run
   in a browser.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaConferences = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* this file's own folder, so the logos resolve from any page's depth */
const DIR = (function () {
  try {
    const s = root.document && root.document.currentScript && root.document.currentScript.src;
    return s ? s.replace(/[^/]*$/, '') : '';
  } catch (_) { return ''; }
}());

/* --------------------------------------------------------------- the systems --- */
const SYSTEMS = [
  {
    key: 'u-sports', name: 'U SPORTS', long: 'U SPORTS men\'s basketball', country: 'CA', map: 'ca',
    leagues: [{ slug: 'u-sports', part: 'Men' }], logoDir: 'usports',
    regions: [
      { key: 'west', name: 'Western Canada', where: ['BC', 'AB', 'SK', 'MB'], colour: '#2f6fd0' },
      { key: 'ontario', name: 'Ontario', where: ['ON'], colour: '#1f9d63' },
      { key: 'quebec', name: 'Quebec', where: ['QC'], colour: '#7a55c7' },
      { key: 'atlantic', name: 'Atlantic Canada', where: ['NB', 'NS', 'PE', 'NL'], colour: '#e0552f' }
    ],
    conferences: [
      { key: 'cw', short: 'Canada West', name: 'Canada West Universities Athletic Association', region: 'west',
        names: ['Canada West', 'CW', 'CWUAA'], logo: 'cw.png', colour: '#0b3d91', where: ['BC', 'AB', 'SK', 'MB'] },
      { key: 'oua', short: 'OUA', name: 'Ontario University Athletics', region: 'ontario',
        names: ['OUA'], logo: 'oua.png', colour: '#00274c', where: ['ON'] },
      { key: 'rseq', short: 'RSEQ', name: 'Réseau du sport étudiant du Québec', region: 'quebec',
        names: ['RSEQ'], logo: 'rseq.png', colour: '#003da5', where: ['QC'] },
      { key: 'aus', short: 'AUS', name: 'Atlantic University Sport', region: 'atlantic',
        names: ['AUS'], logo: 'aus.png', colour: '#c8102e', where: ['NS', 'NB', 'PE', 'NL'] }
    ]
  },
  {
    key: 'ncaa-d2', name: 'NCAA D2', long: 'NCAA Division II basketball', country: 'US', map: 'us',
    leagues: [{ slug: 'ncaa-d2-men', part: 'Men' }, { slug: 'ncaa-d2-women', part: 'Women' }], logoDir: 'ncaa-d2',
    regions: [
      { key: 'east', name: 'East', where: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE'], colour: '#2f6fd0' },
      { key: 'atlantic', name: 'Atlantic', where: ['PA', 'WV', 'MD', 'VA', 'DC'], colour: '#0e9aa7' },
      { key: 'southeast', name: 'Southeast', where: ['NC', 'SC'], colour: '#d99a00' },
      { key: 'south', name: 'South', where: ['GA', 'FL', 'AL', 'MS', 'TN'], colour: '#e0552f' },
      { key: 'midwest', name: 'Midwest', where: ['OH', 'MI', 'IN', 'IL', 'KY', 'WI'], colour: '#7a55c7' },
      { key: 'central', name: 'Central', where: ['MN', 'ND', 'SD', 'NE', 'KS', 'MO', 'IA', 'AR', 'OK'], colour: '#1f9d63' },
      { key: 'south-central', name: 'South Central', where: ['TX', 'NM', 'CO', 'UT'], colour: '#c2367a' },
      { key: 'west', name: 'West', where: ['CA', 'HI', 'WA', 'OR', 'ID', 'MT', 'AK'], colour: '#ea7f12' }
    ],
    conferences: [
      { key: 'cacc', short: 'CACC', name: 'Central Atlantic Collegiate Conference', region: 'east',
        names: ['CACC'], logo: 'cacc.svg', colour: '#00205b', where: ['PA', 'NJ', 'CT', 'DE'] },
      { key: 'ecc', short: 'ECC', name: 'East Coast Conference', region: 'east',
        names: ['ECC'], logo: 'ecc.svg', colour: '#0b2341', where: ['NY'] },
      { key: 'ne10', short: 'NE10', name: 'Northeast-10 Conference', region: 'east',
        names: ['NE10', 'NE-10', 'Northeast-10', 'Northeast 10'], logo: 'ne10.svg', colour: '#b5121b', where: ['MA', 'NH', 'NY'] },
      { key: 'ciaa', short: 'CIAA', name: 'Central Intercollegiate Athletic Association', region: 'atlantic',
        names: ['CIAA'], logo: 'ciaa.svg', colour: '#1d4f91', where: ['NC', 'VA'] },
      { key: 'mec', short: 'MEC', name: 'Mountain East Conference', region: 'atlantic',
        names: ['MEC', 'Mountain East'], logo: 'mec.svg', colour: '#00478f', where: ['WV'] },
      { key: 'psac', short: 'PSAC', name: 'Pennsylvania State Athletic Conference', region: 'atlantic',
        names: ['PSAC'], logo: 'psac.svg', colour: '#002f6c', where: ['PA'] },
      { key: 'conference-carolinas', short: 'Conf. Carolinas', name: 'Conference Carolinas', region: 'southeast',
        names: ['Conference Carolinas'], logo: 'conference-carolinas.svg', colour: '#002855', where: ['NC', 'SC', 'GA'] },
      { key: 'peach-belt', short: 'Peach Belt', name: 'Peach Belt Conference', region: 'southeast',
        names: ['Peach Belt', 'PBC'], logo: 'peach-belt.svg', colour: '#e35205', where: ['GA', 'SC'] },
      { key: 'sac', short: 'SAC', name: 'South Atlantic Conference', region: 'southeast',
        names: ['SAC', 'South Atlantic'], logo: 'sac.png', colour: '#1c1c1c', where: ['NC', 'SC', 'TN', 'VA'] },
      { key: 'gulf-south', short: 'Gulf South', name: 'Gulf South Conference', region: 'south',
        names: ['Gulf South', 'GSC'], logo: 'gulf-south.svg', colour: '#002d62', where: ['AL', 'TN', 'MS'] },
      { key: 'siac', short: 'SIAC', name: 'Southern Intercollegiate Athletic Conference', region: 'south',
        names: ['SIAC'], logo: 'siac.svg', colour: '#13294b', where: ['GA', 'AL', 'SC', 'TN'] },
      { key: 'sunshine-state', short: 'Sunshine State', name: 'Sunshine State Conference', region: 'south',
        names: ['Sunshine State', 'SSC'], logo: 'sunshine-state.svg', colour: '#f2a900', where: ['FL'] },
      { key: 'g-mac', short: 'G-MAC', name: 'Great Midwest Athletic Conference', region: 'midwest',
        names: ['G-MAC', 'G MAC', 'GMAC', 'Great Midwest'], logo: 'g-mac.png', colour: '#00205b', where: ['OH', 'MI', 'KY'] },
      { key: 'gliac', short: 'GLIAC', name: 'Great Lakes Intercollegiate Athletic Conference', region: 'midwest',
        names: ['GLIAC'], logo: 'gliac.svg', colour: '#003865', where: ['MI'] },
      { key: 'glvc', short: 'GLVC', name: 'Great Lakes Valley Conference', region: 'midwest',
        names: ['GLVC'], logo: 'glvc.svg', colour: '#002d72', where: ['MO', 'IL'] },
      { key: 'gac', short: 'GAC', name: 'Great American Conference', region: 'central',
        names: ['GAC', 'Great American'], logo: 'gac.png', colour: '#002855', where: ['AR', 'OK'] },
      { key: 'mid-america-intercollegiate', short: 'MIAA', name: 'Mid-America Intercollegiate Athletics Association',
        region: 'central', names: ['MIAA', 'Mid America Intercollegiate', 'Mid-America Intercollegiate'],
        logo: 'mid-america-intercollegiate.svg', colour: '#00205b', where: ['KS', 'MO', 'OK'] },
      { key: 'nsic', short: 'NSIC', name: 'Northern Sun Intercollegiate Conference', region: 'central',
        names: ['NSIC', 'Northern Sun'], logo: 'nsic.png', colour: '#002855', where: ['MN', 'ND', 'SD'] },
      { key: 'lone-star', short: 'Lone Star', name: 'Lone Star Conference', region: 'south-central',
        names: ['Lone Star', 'LSC'], logo: 'lone-star.png', colour: '#002f6c', where: ['TX', 'NM', 'OK'] },
      { key: 'rmac', short: 'RMAC', name: 'Rocky Mountain Athletic Conference', region: 'south-central',
        names: ['RMAC', 'Rocky Mountain'], logo: 'rmac.svg', colour: '#002f6c', where: ['CO', 'SD'] },
      { key: 'ccaa', short: 'CCAA', name: 'California Collegiate Athletic Association', region: 'west',
        names: ['CCAA'], logo: 'ccaa.png', colour: '#002855', where: ['CA'] },
      { key: 'great-northwest', short: 'GNAC', name: 'Great Northwest Athletic Conference', region: 'west',
        names: ['GNAC', 'Great Northwest'], logo: 'great-northwest.svg', colour: '#003a70', where: ['WA', 'AK'] },
      { key: 'pacwest', short: 'PacWest', name: 'Pacific West Conference', region: 'west',
        names: ['PacWest', 'Pacwest', 'Pac West'], logo: 'pacwest.png', colour: '#004b87', where: ['CA', 'HI'] },
      { key: 'independent', short: 'Independents', name: 'Division II Independents', region: null,
        names: ['Independent', 'Independents', 'Division II Independents', 'DII Independent', 'IND'], logo: null,
        colour: '#5b6770', where: [] }
    ]
  }
];

/* -------------------------------------------------------------------- lookups --- */
const fold = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const BY_LEAGUE = new Map();
SYSTEMS.forEach(s => s.leagues.forEach(l => BY_LEAGUE.set(l.slug, s)));

/* the system a league belongs to (a slug, or a league row), else null */
function systemOf(league) {
  const slug = typeof league === 'string' ? league : league && league.slug;
  return (slug && BY_LEAGUE.get(slug)) || null;
}
function system(key) {
  return SYSTEMS.find(s => s.key === key) || null;
}
function isSystemLeague(league) { return !!systemOf(league); }

/* the conference a stored group name is: its own entry when the system knows it, else one made from the name (a
   conference that appears later - a new member conference - is still shown, with a drawn badge) */
function conference(sys, groupName) {
  const S = typeof sys === 'string' ? (system(sys) || systemOf(sys)) : sys;
  const f = fold(groupName);
  if (!f) return null;
  const hit = S && S.conferences.find(c => fold(c.key) === f || fold(c.short) === f || fold(c.name) === f
    || (c.names || []).some(n => fold(n) === f));
  if (hit) return hit;
  const key = String(groupName).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { key, short: String(groupName), name: String(groupName), region: null, names: [String(groupName)],
           logo: null, colour: '#5b6770', where: [], made: true };
}
function conferenceByKey(sys, key) {
  const S = typeof sys === 'string' ? (system(sys) || systemOf(sys)) : sys;
  return (S && S.conferences.find(c => c.key === key)) || null;
}
function region(sys, key) {
  const S = typeof sys === 'string' ? system(sys) : sys;
  return (S && S.regions.find(r => r.key === key)) || null;
}

/* conferences in the system's order: region by region, then by name; the made-up ones and those with no region
   (Independents) last */
function order(S, list) {
  const rk = c => { const i = S.regions.findIndex(r => r.key === c.region); return i < 0 ? 99 : i; };
  return list.slice().sort((a, b) => (rk(a) - rk(b)) || a.short.localeCompare(b.short, undefined, { sensitivity: 'base' }));
}

/* [{region, conferences}] - regions in the system's order, the conferences with no region as a last group */
function byRegion(S, list) {
  const out = S.regions.map(r => ({ region: r, conferences: [] }));
  const rest = { region: null, conferences: [] };
  order(S, list).forEach(c => {
    const g = out.find(x => x.region.key === c.region);
    (g || rest).conferences.push(c);
  });
  return out.filter(g => g.conferences.length).concat(rest.conferences.length ? [rest] : []);
}

function logoUrl(S, c) {
  return c && c.logo ? DIR + 'img/conferences/' + S.logoDir + '/' + c.logo : null;
}

/* ---------------------------------------------------------------------- scope ---
   WHICH CLUBS A PAGE SHOWS. Every page of a league calls this once it knows the season's competitions:
     not a system league         every club (nothing changes)
     a system league             the clubs with a conference; with ?conf=<key>, that conference's alone
   assignments: [{team_id, group_name}] (competition_teams rows of the competitions in view). Pure. */
function scopeFrom(league, assignments, confKey) {
  const S = systemOf(league);
  if (!S) return { system: null, conference: null, keep: () => true, groupOf: () => null, conferenceOf: () => null,
                   conferences: [], ids: [] };
  const groupOf = new Map();
  (assignments || []).forEach(a => {
    const g = a && a.group_name != null ? String(a.group_name).trim() : '';
    if (a && a.team_id && g && !groupOf.has(a.team_id)) groupOf.set(a.team_id, g);
  });
  const present = new Map();
  groupOf.forEach(g => { if (!present.has(g)) present.set(g, conference(S, g)); });
  const conferences = order(S, [...new Set(present.values())]);
  const want = confKey ? conferences.find(c => c.key === confKey) || conferenceByKey(S, confKey) : null;
  const keepGroups = want ? new Set([...present].filter(([, c]) => c === want || c.key === want.key).map(([g]) => g)) : null;
  /* nothing assigned yet (a season before its groups are read): every club, rather than none */
  const keep = !groupOf.size ? () => true
    : keepGroups ? (id => keepGroups.has(groupOf.get(id)))
    : (id => groupOf.has(id));
  /* ids: the clubs kept, for a query (the games of a conference's clubs, either side) */
  return { system: S, conference: want || null, keep, groupOf: id => groupOf.get(id) || null,
           conferenceOf: id => (groupOf.has(id) ? present.get(groupOf.get(id)) : null), conferences,
           ids: [...groupOf.keys()].filter(keep) };
}

/* the read: competition_teams of the competitions in view, once a page (and an hour in this tab) */
const MEMO = new Map();
const CACHE = 'epinoia_cf1:';
async function assignments(D, compIds) {
  const ids = (compIds || []).filter(Boolean).slice().sort();
  if (!ids.length || !D) return [];
  const key = ids.join(',');
  if (MEMO.has(key)) return MEMO.get(key);
  try {
    const s = root.sessionStorage && root.sessionStorage.getItem(CACHE + key);
    if (s) {
      const v = JSON.parse(s);
      if (v && Date.now() - v.at < 3600e3) { MEMO.set(key, Promise.resolve(v.rows)); return v.rows; }
    }
  } catch (_) { /* private mode */ }
  const many = typeof D.all === 'function' ? D.all : D.get;
  const p = Promise.resolve()
    .then(() => many('competition_teams?competition_id=in.(' + ids.join(',') + ')&select=team_id,group_name'))
    .then(rows => {
      const out = (rows || []).map(r => ({ team_id: r.team_id, group_name: r.group_name }));
      try { root.sessionStorage && root.sessionStorage.setItem(CACHE + key, JSON.stringify({ at: Date.now(), rows: out })); }
      catch (_) { /* full or private */ }
      return out;
    })
    .catch(() => { MEMO.delete(key); return []; });
  MEMO.set(key, p);
  return p;
}

/* the page's scope in one call: o = {D, league (slug or row), compIds, conf (default: ?conf=)} */
async function scope(o) {
  const league = o && o.league;
  if (!systemOf(league)) return scopeFrom(league, [], null);
  let conf = o.conf;
  if (conf === undefined) {
    try { conf = new URLSearchParams(root.location.search).get('conf'); } catch (_) { conf = null; }
  }
  const rows = await assignments(o.D, o.compIds);
  return scopeFrom(league, rows, conf || null);
}

/* ---------------------------------------------------------------------- maps ---
   Tile maps: a square a state (a province), placed so the country's shape reads at a glance. Pure: returns SVG text. */
const TILES = {
  us: { cols: 12, rows: 8, at: {
    AK: [0, 0], ME: [11, 0], VT: [10, 1], NH: [11, 1],
    WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], WI: [7, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
    OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
    HI: [0, 7], TX: [4, 7], FL: [9, 7] } },
  ca: { cols: 7, rows: 3, at: {
    YT: [0, 0], NT: [1, 0], NU: [2, 0], NL: [6, 0],
    BC: [0, 1], AB: [1, 1], SK: [2, 1], MB: [3, 1], ON: [4, 1], QC: [5, 1], PE: [6, 1],
    NB: [5, 2], NS: [6, 2] } }
};

/* lit: the codes drawn in the accent; title: the map's name for a screen reader */
function mapSvg(kind, lit, o) {
  const T = TILES[kind];
  if (!T) return '';
  const opts = o || {};
  const cell = opts.cell || 10, gap = opts.gap == null ? 2 : opts.gap;
  const on = new Set(lit || []);
  const w = T.cols * (cell + gap) - gap, h = T.rows * (cell + gap) - gap;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let body = '';
  Object.keys(T.at).forEach(code => {
    const [x, y] = T.at[code];
    body += '<rect x="' + x * (cell + gap) + '" y="' + y * (cell + gap) + '" width="' + cell + '" height="' + cell +
      '" rx="' + Math.round(cell / 4) + '" class="' + (on.has(code) ? 'cfm-on' : 'cfm-off') + '"><title>' + code + '</title></rect>';
  });
  return '<svg class="cf-map" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' +
    esc(opts.title || '') + '">' + body + '</svg>';
}

/* ------------------------------------------------------------------- the DOM --- */
function el(tag, cls, text) {
  const n = root.document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* a conference's badge: its logo on a white tile, or its initials in its colour when it has none (or the logo fails) */
function badge(S, c, size) {
  const px = size || 36;
  const b = el('span', 'cf-badge');
  /* styled here, so a badge is right on any page, with or without the table's sheet (kit/standings.css adds to it) */
  b.style.cssText = 'width:' + px + 'px;height:' + px + 'px;flex:none;display:inline-grid;place-items:center;' +
    'background:#fff;border-radius:' + Math.max(4, Math.round(px / 4)) + 'px;overflow:hidden;vertical-align:middle;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.12)';
  const initials = () => {
    b.textContent = '';
    b.classList.add('cf-drawn');
    b.style.background = c.colour || '#5b6770';
    b.style.color = '#fff';
    const t = el('span', null, (c.short || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase());
    t.style.cssText = 'font-weight:800;letter-spacing:.02em;font-size:' +
      Math.max(7, Math.round(px / (t.textContent.length > 3 ? 3.6 : 3))) + 'px';
    b.appendChild(t);
  };
  const src = logoUrl(S, c);
  if (!src) { initials(); return b; }
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;padding:12%;box-sizing:border-box;display:block';
  img.src = src;
  img.addEventListener('error', initials, { once: true });
  b.appendChild(img);
  return b;
}

return { SYSTEMS, systemOf, system, isSystemLeague, conference, conferenceByKey, region, order, byRegion, logoUrl,
         scopeFrom, assignments, scope, mapSvg, TILES, badge, fold };
}));
