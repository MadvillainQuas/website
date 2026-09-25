'use strict';
/* ============================================================================
   WHO'S YOUR FAVOURITE? — HOME's prompt for somebody who follows nothing
   (migration 0161, docs/favourites.md).

   THE PANEL. Once, for somebody signed in who follows no club, a panel unrolls out of the
   rule under the daily fixtures as they scroll to it — black in the light theme, white in the dark —
   and asks WHICH LEAGUES DO YOU PREFER TO WATCH? A row of country cards (ten in view on a wide screen,
   more a click or a swipe away); a country slides open into its leagues, the way the rail's panels
   slide; a league is picked by tapping it. Then they may pick another league or ADVANCE to WHO DO YOU
   BACK?, one row of every club in the leagues they follow.

   WHO IS ASKED. Anybody signed in who follows no club: a first sign-in, and everybody already signed in
   when this arrived, once. A fan who follows leagues but no club opens straight onto WHO DO YOU BACK? for
   those leagues (one click back to add more); a fan who follows nothing starts at the countries.

   WHAT IS PICKED IS FOLLOWED. Not a second list: the same fan_prefs lists every bell writes
   (follow.js), so a pick is on their profile, in the rail's "your follows" and in MY FOLLOWED at once,
   and it comes off again by tapping it again. Taps are saved one after another (so the last tap is
   what the database ends up holding), shown at once, and put back with a word if one does not save.

   THE RULE IS THE HANDLE, as the fans' vote's is (fanvote.js). Once the panel has been closed the line it
   rolled out of stays for good, and clicking it rolls the panel back out to add another favourite.
   Signed out, the same line leads to sign-in and comes back here with the panel open.

   BY ITSELF, ONCE. It opens on its own for a signed-in fan who follows no club and has not seen it, once
   per browser for each account, as the fans' vote's is. Closing it (x), finishing, or simply leaving it
   are all "seen"; REMIND ME LATER brings it back six hours on; DON'T SHOW THIS AGAIN turns it off for
   good, for the account (fan_prefs.want_favourites, which the profile turns back on) and for this
   browser. A fan who follows a club is never asked: they have found their way.

   Pure logic (the once rule, the country and club rows) is exported and run by
   supabase/tests/favourites.test.mjs; the rest needs a page.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFavourites = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const STORE = 'epinoia.favourites';          // { users: { <user id>: { at, later?, never? } } }
const LATER_MS = 6 * 3600 * 1000;            // "remind me later": the next visit six hours on
const DEADLINE_MS = 10000;                   // a request gives up after this
const KEEP_USERS = 12;                       // browsers are shared: a note per account, the newest twelve kept
const OPEN_AFTER_MS = 500;                   // the line has been in view this long before the panel unrolls
const DONE_CLOSE_MS = 6500;
const STAGES = ['countries', 'leagues', 'teams', 'done'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* a country has no colours of its own: each takes one of the kit's five inks, always the same one */
const INKS = ['var(--lume)', 'var(--aqua)', 'var(--amber)', 'var(--flare)', 'var(--violet)'];
const MINT = '#93f2bf';
const UNFILED = 'Other leagues';

const HEAD = {
  countries: { step: 'Step 1 of 2 · Leagues', title: 'Who’s Your Favourite?', sub: 'Which Leagues Do You Prefer to Watch?' },
  teams:     { step: 'Step 2 of 2 · Clubs', title: 'Who Do You Back?', sub: 'Tap the clubs you want to follow.' },
  done:      { step: 'All set', title: 'You’re In', sub: 'Here’s who you’re following.' }
};
HEAD.leagues = HEAD.countries;

/* ---------------------------------------------------------- pure logic --- */

/* Does this fan back a club? A club is what the panel is for: somebody who follows leagues, players or
   games and no club is still asked (once), and one who follows a club has found their way and is not. */
function followsTeam(prefs) {
  const p = prefs || {};
  return Array.isArray(p.fav_team_ids) && p.fav_team_ids.length > 0;
}

/* THE ONCE RULE. Opens by itself only for a signed-in fan whose follow lists were read (a failed read
   is not "follows no club"), who follows no club, whose account has not said "don't show this again",
   and who has not seen it: no note on this browser for this account, or "remind me later" that has run
   out. That is everybody already signed in when this arrived, once, as well as a first sign-in. A note
   of any other kind — closed, finished, or left open and scrolled past — is "seen". The browser's own
   "never" holds even where the account's switch is on: a missing panel is a smaller fault than one that
   comes back after being sent away. */
function shouldAutoOpen(o) {
  const s = o || {};
  if (!s.signedIn || !s.ready) return false;
  if (s.account === false) return false;
  const n = s.note || null;
  if (n && n.never) return false;
  if (followsTeam(s.prefs)) return false;
  if (!n || !n.at) return true;
  if (n.later) return s.now >= n.later;
  return false;
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : (many || one + 's'));
}

function inkFor(code) {
  let h = 0;
  String(code || '').split('').forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  return INKS[h % INKS.length];
}

/* the user id out of an access token, for a session stored without its user */
function jwtSub(token) {
  try {
    const p = String(token || '').split('.')[1];
    if (!p) return '';
    let b = p.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const raw = typeof root.atob === 'function' ? root.atob(b) : Buffer.from(b, 'base64').toString('binary');
    const j = JSON.parse(decodeURIComponent(raw.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
    return typeof j.sub === 'string' ? j.sub : '';
  } catch (_) { return ''; }
}

/* THE COUNTRY CARDS: one per country (country.js group), the leagues in each by name, countries by the
   name a reader sees, and leagues with no country last as "Other leagues". A private league is never
   offered: it is not listed for anybody to pick. */
function countryCards(leagues, C) {
  const pub = (Array.isArray(leagues) ? leagues : []).filter(l => l && l.id && l.visibility !== 'private');
  const groups = C && typeof C.group === 'function' ? C.group(pub) : [];
  return groups.map(g => ({ code: g.code, name: g.code ? g.name : UNFILED, leagues: g.leagues }));
}

/* THE CLUB ROW: every club of the leagues in `leagues`, in that league order, each league's by name */
function orderTeams(teams, leagues) {
  const rank = new Map((leagues || []).map((l, i) => [l.id, i]));
  return (Array.isArray(teams) ? teams : []).filter(t => t && rank.has(t.league_id)).sort((a, b) =>
    rank.get(a.league_id) - rank.get(b.league_id) || String(a.name || '').localeCompare(String(b.name || '')));
}

/* "ABA League, NBL and 3 more" */
function nameList(names, max) {
  const n = names.filter(Boolean);
  const m = max || 4;
  if (n.length <= m) return n.join(', ');
  return n.slice(0, m).join(', ') + ' and ' + (n.length - m) + ' more';
}

/* ---------------------------------------------------------- the store --- */
function storage() { try { return root.localStorage || null; } catch (_) { return null; } }
function readStore() {
  const ls = storage();
  try {
    const j = ls ? JSON.parse(ls.getItem(STORE) || '{}') : {};
    return { users: (j && typeof j === 'object' && j.users && typeof j.users === 'object') ? j.users : {} };
  } catch (_) { return { users: {} }; }
}
function writeStore(s) {
  const ls = storage();
  if (!ls) return;
  const keep = Object.keys(s.users || {}).sort((a, b) => ((s.users[b] || {}).at || 0) - ((s.users[a] || {}).at || 0)).slice(0, KEEP_USERS);
  const users = {};
  keep.forEach(k => { users[k] = s.users[k]; });
  try { ls.setItem(STORE, JSON.stringify({ users })); } catch (_) { /* full, or private browsing */ }
}
function noteOf(uid) {
  const u = readStore().users[uid];
  return u && typeof u === 'object' ? u : null;
}
/* a note REPLACES the last one: "closed" ends a "remind me later", and "never" is final */
function setNote(uid, patch) {
  const s = readStore();
  s.users[uid] = Object.assign({}, patch, { at: Date.now() });
  writeStore(s);
}

/* the signed-in account, read the way follow.js reads the session: from the stored one */
function storedUserId() {
  const c = root.EPINOIA_CONFIG || {};
  const ref = (String(c.supabaseUrl || '').match(/^https?:\/\/([^.]+)\./) || [])[1];
  const ls = storage();
  if (!ref || !ls) return '';
  try {
    const j = JSON.parse(ls.getItem('sb-' + ref + '-auth-token') || 'null');
    const s = (j && j.currentSession) || j || {};
    return (s.user && s.user.id) || jwtSub(s.access_token) || '';
  } catch (_) { return ''; }
}

/* ------------------------------------------------------------- the DOM --- */
const doc = () => root.document;
function el(t, c, x) {
  const n = doc().createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n;
}
function btn(c, x, label) {
  const b = el('button', c, x); b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
}
const reduced = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);

function tickSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = doc().createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  const p = doc().createElementNS(NS, 'path');
  p.setAttribute('d', 'M3.4 8.6l3.1 3.1 6.1-7.2');
  s.appendChild(p);
  return s;
}

/* a card's inks: the club's or league's own colours where it has them */
function paint(a, colour, colour2) {
  const TC = root.EpinoiaTeamColour;
  if (TC && TC.card) TC.card(a, colour || MINT, colour2);
  else a.style.setProperty('--ink-c', colour || MINT);
}

function monogram(name, short) {
  const s = String(short || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const words = String(name || '').trim().split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  if (words.length >= 2) return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
  return String(name || '?').slice(0, 3).toUpperCase();
}

/* THE PLATE every card is drawn on (kit/card.css): ink flood, halftone, registration crosses, the mark,
   a stencil band and paper grain. */
function plate(mark, bandText, markClass) {
  const p = el('div', 'club-plate');
  p.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => p.appendChild(el('span', 'club-reg ' + c)));
  const m = el('div', 'club-mark' + (markClass ? ' ' + markClass : ''));
  m.appendChild(mark);
  p.appendChild(m);
  if (bandText) {
    const band = el('div', 'club-band');
    band.appendChild(el('span', null, bandText));
    p.appendChild(band);
  }
  p.appendChild(el('div', 'club-grain'));
  return p;
}
function monoNodes(text) {
  const f = doc().createDocumentFragment();
  f.append(el('span', 'club-mono ghost', text), el('span', 'club-mono', text));
  return f;
}

/* A COUNTRY'S FLAG, THE DRAWN ONE where country.js has it (Windows draws a flag emoji as two letters),
   else the emoji; a league in two countries ('BE+NL') shows both, one above the other. */
function flagTile(code, C, base) {
  const parts = C && typeof C.parts === 'function' ? C.parts(code) : [];
  const list = parts.length ? parts : [{ code: '', src: '', flag: '\u{1F30D}' }];
  const emoji = p => { const s = el('span', 'fav-emoji', p.flag); s.setAttribute('aria-hidden', 'true'); return s; };
  const tile = el('span', 'fav-tile' + (list.length > 1 ? ' two' : ''));
  list.forEach(p => {
    if (!p.src) { tile.appendChild(emoji(p)); return; }
    const img = el('img', 'fav-flag');
    img.alt = ''; img.decoding = 'async'; img.draggable = false;
    img.addEventListener('error', () => { img.replaceWith(emoji(p)); tile.classList.add('emoji'); }, { once: true });
    img.src = base + p.src;
    tile.appendChild(img);
  });
  if (!list.some(p => p.src)) tile.classList.add('emoji');
  return tile;
}

function countryCard(g, ctx) {
  const b = btn('club fav-card fav-country');
  b.dataset.code = g.code;
  b.style.setProperty('--ink-c', inkFor(g.code));
  const p = plate(flagTile(g.code, ctx.C, ctx.base), plural(g.leagues.length, 'league'), 'fav-mark');
  const count = el('span', 'fav-tick fav-count');
  count.setAttribute('aria-hidden', 'true');
  p.appendChild(count);
  const foot = el('div', 'club-foot fav-foot');
  foot.appendChild(el('span', 'club-name fav-name', g.name));
  b.append(p, foot);
  b.favCount = count;
  return b;
}

function leagueCard(l, clubs) {
  const b = btn('club lgc fav-card fav-league');
  b.dataset.id = l.id;
  const own = l.colour_source === 'logo' || l.colour_source === 'manual';
  paint(b, own && hex(l.colour_a) ? l.colour_a : MINT, own ? (hex(l.colour_b) || hex(l.colour_a)) : null);
  if (!own) b.classList.add('lgc-mint');

  const mark = el('div', 'club-mark lgc-mark');
  const url = root.epinoiaLogoUrl ? root.epinoiaLogoUrl(l.logo_path) : null;
  const mono = monogram(l.name);
  if (url) {
    const tile = el('span', 'lgc-tile');
    const img = el('img', 'lgc-logo');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
    img.addEventListener('error', () => { tile.remove(); mark.appendChild(monoNodes(mono)); }, { once: true });
    img.src = url;
    tile.appendChild(img);
    mark.appendChild(tile);
  } else mark.appendChild(monoNodes(mono));

  const p = el('div', 'club-plate');
  p.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => p.appendChild(el('span', 'club-reg ' + c)));
  p.appendChild(mark);
  const band = el('div', 'club-band');
  band.appendChild(el('span', null, clubs == null ? 'league' : (clubs ? plural(clubs, 'club') : 'no clubs')));
  p.append(band, el('div', 'club-grain'));
  if (l.gender === 'women') {
    const w = el('span', 'lgc-tag lgc-w', 'W');
    w.title = 'Women’s league'; w.setAttribute('aria-hidden', 'true');
    p.appendChild(w);
  }
  const tick = el('span', 'fav-tick');
  tick.setAttribute('aria-hidden', 'true');
  tick.appendChild(tickSvg());
  p.appendChild(tick);

  const foot = el('div', 'club-foot lgc-foot fav-foot');
  const nm = el('span', 'club-name lgc-name', l.name || l.slug || 'League');
  nm.setAttribute('translate', 'no');
  foot.appendChild(nm);
  b.append(p, foot);
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', (l.name || l.slug) + (l.gender === 'women' ? ', women’s league' : '') +
    (clubs ? ', ' + plural(clubs, 'club') : ''));
  return b;
}

/* `league` names the club's league on its band, which is only worth saying where leagues are mixed on the row */
function teamCard(t, league) {
  const b = btn('club fav-card fav-team');
  b.dataset.id = t.id;
  paint(b, hex(t.colour), hex(t.colour_2));
  const mark = doc().createDocumentFragment();
  const url = root.epinoiaLogoUrl ? root.epinoiaLogoUrl(t.logo_path) : null;
  const mono = monogram(t.name, t.short_name);
  if (url) {
    const img = el('img', 'club-logo');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
    img.addEventListener('error', () => { img.replaceWith(monoNodes(mono)); }, { once: true });
    img.src = url;
    mark.appendChild(img);
  } else mark.appendChild(monoNodes(mono));
  const wrap = el('div', 'fav-crest');
  wrap.appendChild(mark);
  const p = plate(wrap, league && league.name ? league.name : '', null);
  const tick = el('span', 'fav-tick');
  tick.setAttribute('aria-hidden', 'true');
  tick.appendChild(tickSvg());
  p.appendChild(tick);
  const foot = el('div', 'club-foot fav-foot');
  const nm = el('span', 'club-name fav-name', t.name || t.slug || 'Club');
  nm.setAttribute('translate', 'no');
  foot.appendChild(nm);
  b.append(p, foot);
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', (t.name || t.slug) + (league && league.name ? ', ' + league.name : ''));
  return b;
}

/* THE STRIP: every card on one row that scrolls sideways, a button at each end that moves it most of a
   strip's width (dimmed where there is no further to go), a swipe on a phone. Ten cards in view on a wide
   panel, fewer as it narrows (favourites.css). */
function strip(label) {
  const wrap = el('div', 'fav-rail');
  const deck = el('div', 'fav-strip');
  const prev = btn('fav-nav prev', '‹', 'Previous ' + label);
  const next = btn('fav-nav next', '›', 'More ' + label);
  wrap.append(prev, deck, next);
  const step = dir => {
    const by = Math.max(120, Math.round(deck.clientWidth * 0.85));
    try { deck.scrollBy({ left: dir * by, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch (_) { deck.scrollLeft += dir * by; }
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  const paintNav = () => {
    const max = deck.scrollWidth - deck.clientWidth;
    prev.disabled = deck.scrollLeft <= 2;
    next.disabled = deck.scrollLeft >= max - 2;
    wrap.classList.toggle('fits', max <= 2);
  };
  deck.addEventListener('scroll', paintNav, { passive: true });
  try { new root.ResizeObserver(paintNav).observe(deck); } catch (_) { root.addEventListener('resize', paintNav); }
  return { wrap, deck, paint: paintNav };
}

/* ----------------------------------------------------------- the network --- */
function timed(url, init, ms) {
  let ctl = null, timer = null;
  try { ctl = new root.AbortController(); timer = setTimeout(() => ctl.abort(), ms); } catch (_) { /* no abort: no deadline */ }
  return root.fetch(url, ctl ? Object.assign({ signal: ctl.signal }, init) : init).finally(() => clearTimeout(timer));
}

/* a public read, the way HOME's other sections make it: globalgames.js's transport where it is loaded */
async function pub(path) {
  const G = root.EpinoiaGlobalGames;
  if (G && typeof G.request === 'function') return G.request(path, false);
  const c = root.EPINOIA_CONFIG;
  if (!c || !c.supabaseUrl) throw new Error('config.js has not loaded');
  const r = await timed(c.supabaseUrl + '/rest/v1/' + path,
    { cache: 'no-store', headers: { apikey: c.supabaseAnonKey, Accept: 'application/json' } }, DEADLINE_MS);
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0]);
  return r.json();
}

function loadLeagues() {
  const G = root.EpinoiaGlobalGames;
  if (G && typeof G.leagues === 'function') return G.leagues();
  return pub('leagues?select=id,slug,name,country,colour_a,colour_b,colour_source,logo_path&order=name.asc');
}

/* clubs in each league, counted here: one small request for every league */
async function clubCounts() {
  const rows = await pub('teams?select=league_id&league_id=not.is.null');
  const m = new Map();
  rows.forEach(r => { if (r.league_id) m.set(r.league_id, (m.get(r.league_id) || 0) + 1); });
  return m;
}

/* THE ACCOUNT'S SWITCH (0161), read on its own and tolerantly: a database without the column answers
   400, which is "no answer", and the browser's note decides. */
async function accountSwitch() {
  const F = root.EpinoiaFollow;
  const s = F && F.session();
  const c = root.EPINOIA_CONFIG;
  if (!s || !c || !c.supabaseUrl) return null;
  try {
    const r = await timed(c.supabaseUrl + '/rest/v1/fan_prefs?select=want_favourites&limit=1', {
      cache: 'no-store',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + s.token, Accept: 'application/json' }
    }, DEADLINE_MS);
    if (!r.ok) return null;
    const rows = await r.json();
    return rows && rows[0] && typeof rows[0].want_favourites === 'boolean' ? rows[0].want_favourites : null;
  } catch (_) { return null; }
}
async function setAccountSwitch(on) {
  const F = root.EpinoiaFollow;
  const s = F && F.session();
  const c = root.EPINOIA_CONFIG;
  if (!s || !c || !c.supabaseUrl) return false;
  try {
    const r = await timed(c.supabaseUrl + '/rest/v1/rpc/set_fan_prefs', {
      method: 'POST',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: { want_favourites: !!on } })
    }, DEADLINE_MS);
    return r.ok;
  } catch (_) { return false; }
}

/* ------------------------------------------------------------- mounting ---
   mount({ anchor, base }): anchor is #favourites, the empty element between the daily fixtures and MY
   FOLLOWED; the rule and the panel are drawn into it. Resolves once the rule is drawn. */
async function mount(o) {
  const anchor = o && o.anchor;
  if (!root.document || !anchor) return null;
  const F = root.EpinoiaFollow, C = root.EpinoiaCountry;
  if (!F || !C) return null;
  const ctx = {
    anchor, base: o.base || '../', F, C,
    panel: null, dataP: null, data: null, teams: new Map(),
    override: new Map(), pend: new Map(), chain: Promise.resolve(),
    added: new Map(), changed: false, tried: false, open: false, opening: false, watching: false
  };

  const signIn = () => {
    const next = (root.location && root.location.pathname ? root.location.pathname : '/epinoia/home/') + '#favourites';
    root.location.href = ctx.base + 'signin/?next=' + encodeURIComponent(next);
  };
  const uid = () => storedUserId() || 'signed-in';

  /* ---- a follow is what the fan sees, at once, until it has saved ---- */
  const key = (kind, id) => kind + ':' + id;
  const on = (kind, id) => (ctx.override.has(key(kind, id)) ? ctx.override.get(key(kind, id)) : F.has(kind, id));
  const save = (kind, id, name, want) => {
    const run = ctx.chain
      .then(() => F.toggle(kind, id, name, { want, quiet: true }))
      .catch(e => ({ ok: false, reason: (e && e.message) || 'could not be saved' }));
    ctx.chain = run;
    return run;
  };
  const followedLeagues = () => ((ctx.data && ctx.data.leagues) || []).filter(l => on('league', l.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const followedTeams = () => {
    const out = [];
    ctx.teams.forEach(rows => rows.forEach(t => { if (on('team', t.id)) out.push(t); }));
    return out;
  };

  /* ---- the rule: the handle, always there ---- */
  const rule = btn('fav-rule', '', 'Who’s your favourite? Pick the leagues you watch and the clubs you back');
  rule.title = 'Who’s your favourite?';
  rule.appendChild(el('span', 'fav-rule-tab', 'Who’s your favourite?'));
  anchor.appendChild(rule);
  ctx.rule = rule;
  rule.addEventListener('click', () => {
    if (!F.session()) { signIn(); return; }
    const P = ctx.panel;
    if (P && P.sec.classList.contains('open')) close('x'); else openPanel(true);
  });

  /* ------------------------------------------------------------ the panel --- */
  function stage(name) {
    const s = el('div', 'fav-stage');
    s.dataset.stage = name;
    return s;
  }
  const acts = (...kids) => { const a = el('div', 'fav-acts'); a.append(...kids.filter(Boolean)); return a; };
  const hint = () => { const h = el('p', 'fav-hint'); h.setAttribute('aria-live', 'polite'); return h; };

  function build() {
    const sec = el('section', 'fav');
    sec.id = 'fav';
    sec.setAttribute('aria-label', 'Who’s your favourite?');
    const roll = el('div', 'fav-roll'), inner = el('div', 'fav-in'), body = el('div', 'fav-body');
    roll.appendChild(inner); inner.appendChild(body); sec.appendChild(roll);

    const x = btn('fav-x', '×', 'Close');
    const head = el('div', 'fav-head');
    const step = el('div', 'fav-step'), title = el('h2', 'fav-title'), sub = el('p', 'fav-sub');
    head.append(step, title, sub);
    body.append(x, head);

    const deck = el('div', 'fav-deck still');
    const track = el('div', 'fav-track');
    deck.appendChild(track);
    body.appendChild(deck);

    /* 1. the countries */
    const sC = stage('countries');
    const cStrip = strip('countries');
    const cHint = hint();
    const cSkip = btn('fav-skip', 'Skip'), cGo = btn('fav-go', 'Advance');
    sC.append(cStrip.wrap, acts(cHint, cSkip, cGo));

    /* 2. one country's leagues */
    const sL = stage('leagues');
    const back = btn('fav-back', '‹', 'Back to the countries');
    const crumb = el('div', 'fav-crumb');
    const crumbFlag = el('span', 'fav-crumb-flag'), crumbName = el('span', 'fav-crumb-name'), crumbN = el('span', 'fav-crumb-n');
    crumb.append(back, crumbFlag, crumbName, crumbN);
    const lStrip = strip('leagues');
    const lHint = hint();
    const lAlt = btn('fav-alt', 'Pick another league'), lSkip = btn('fav-skip', 'Skip'), lGo = btn('fav-go', 'Advance');
    sL.append(crumb, lStrip.wrap, acts(lHint, lAlt, lSkip, lGo));

    /* 3. the clubs */
    const sT = stage('teams');
    const tStrip = strip('clubs');
    const tHint = hint();
    const tAlt = btn('fav-alt', 'Add more leagues'), tSkip = btn('fav-skip', 'Skip'), tGo = btn('fav-go', 'Done');
    sT.append(tStrip.wrap, acts(tHint, tAlt, tSkip, tGo));

    /* 4. done */
    const sD = stage('done');
    const said = el('div', 'fav-said');
    const dAlt = btn('fav-alt', 'Add more'), dGo = btn('fav-go', 'Close');
    sD.append(el('div', 'fav-stamp', 'Following'), said,
      el('p', 'fav-how', 'Following is how you get notifications - game reminders, line-ups and final scores - on your phone and on the site.'),
      el('p', 'fav-how', 'Find them on your profile and in My followed.'), acts(null, dAlt, dGo));

    track.append(sC, sL, sT, sD);

    const links = el('div', 'fav-links');
    const later = btn('fav-later', 'Remind me later'), never = btn('fav-never', 'Don’t show this again');
    links.append(later, never);
    body.appendChild(links);

    const P = {
      sec, body, deck, track, x, step, title, sub, headKey: '', at: 'countries',
      stages: [sC, sL, sT, sD], countryCards: [], leagueCards: [], teamCards: [], country: null,
      c: { strip: cStrip, hint: cHint, skip: cSkip, go: cGo },
      l: { strip: lStrip, hint: lHint, alt: lAlt, skip: lSkip, go: lGo, back, flag: crumbFlag, name: crumbName, n: crumbN },
      t: { strip: tStrip, hint: tHint, alt: tAlt, skip: tSkip, go: tGo },
      d: { said, alt: dAlt, go: dGo }, later, never, filled: false
    };

    x.addEventListener('click', () => close('x'));
    later.addEventListener('click', () => close('later'));
    never.addEventListener('click', () => close('never'));
    cSkip.addEventListener('click', () => close('skip'));
    lSkip.addEventListener('click', () => close('skip'));
    cGo.addEventListener('click', () => toTeams(P));
    lGo.addEventListener('click', () => toTeams(P));
    lAlt.addEventListener('click', () => backToCountries(P));
    back.addEventListener('click', () => backToCountries(P));
    tAlt.addEventListener('click', () => backToCountries(P));
    tSkip.addEventListener('click', () => finish(P));
    tGo.addEventListener('click', () => finish(P));
    dAlt.addEventListener('click', () => { clearTimeout(P.autoClose); backToCountries(P); });
    dGo.addEventListener('click', () => close('done'));
    /* anybody touching the panel is not done with it */
    body.addEventListener('pointerdown', () => clearTimeout(P.autoClose));
    sec.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close('x'); } });

    sec.hidden = true;
    anchor.appendChild(sec);
    /* the stages are as tall as their content, and the deck follows the one in view */
    try {
      P.ro = new root.ResizeObserver(() => size(P));
      P.stages.forEach(s => P.ro.observe(s));
    } catch (_) { root.addEventListener('resize', () => size(P)); }
    settle(P);
    setHead(P, 'countries', true);
    ctx.panel = P;
    return P;
  }

  function size(P) {
    const s = P.stages[STAGES.indexOf(P.at)];
    if (s && s.offsetHeight) P.deck.style.height = s.offsetHeight + 'px';
  }
  /* the stage that ends up off screen leaves the tab order, and the reading order: a keyboard must never
     land on a card it cannot see */
  function settle(P) {
    P.stages.forEach(s => {
      const off = s.dataset.stage !== P.at;
      if (off) s.setAttribute('inert', ''); else s.removeAttribute('inert');
      s.setAttribute('aria-hidden', off ? 'true' : 'false');
    });
  }
  function setHead(P, name, instant) {
    const h = HEAD[name] || HEAD.countries;
    const k = h.title;
    if (P.headKey === k) return;
    const write = () => { P.step.textContent = h.step; P.title.textContent = h.title; P.sub.textContent = h.sub; };
    P.headKey = k;
    if (instant || reduced()) { write(); return; }
    P.body.classList.remove('swap'); void P.body.offsetWidth;
    write();
    P.body.classList.add('swap');
  }
  function go(P, name, instant) {
    const i = STAGES.indexOf(name);
    if (i < 0) return;
    P.at = name;
    P.sec.dataset.stage = name;
    /* A SCREEN THAT IS STILL ARRIVING TAKES NO PICKS. A country's leagues slide in where the
       countries were, so a second tap on the country (a quick double tap, or the delayed click a
       phone sends after a touch) landed on whichever league was now under the finger and FOLLOWED
       it - every game of a league nobody chose, straight to their phone (an easyCredit BBL follow
       nobody made, reported 2026-09-24). pick() ignores a tap until the slide has settled. */
    P.quietUntil = Date.now() + (instant || reduced() ? 150 : 500);
    P.stages.forEach(s => { s.removeAttribute('inert'); s.setAttribute('aria-hidden', 'false'); });
    clearTimeout(P.settleT);
    if (instant || reduced()) { P.deck.classList.add('still'); }
    else P.deck.classList.remove('still');
    P.track.style.setProperty('--i', String(i));
    setHead(P, name, instant);
    size(P);
    if (instant || reduced()) { settle(P); void P.deck.offsetWidth; P.deck.classList.remove('still'); }
    else P.settleT = setTimeout(() => settle(P), 420);
    paintAll(P);
  }

  function note(P, which, text, retry) {
    const d = P[which].strip.deck;
    d.textContent = '';
    const n = el('div', 'fav-empty');
    n.appendChild(el('span', null, text));
    if (retry) {
      const r = btn('fav-retry', 'Try again');
      r.addEventListener('click', retry);
      n.appendChild(r);
    }
    d.appendChild(n);
    P[which].strip.paint();
  }

  /* --------------------------------------------------- what is on the cards --- */
  function paintAll(P) {
    P.countryCards.forEach(({ b, g }) => {
      const n = g.leagues.filter(l => on('league', l.id)).length;
      b.classList.toggle('on', n > 0);
      b.favCount.textContent = n ? String(n) : '';
      b.setAttribute('aria-label', g.name + ', ' + plural(g.leagues.length, 'league') + (n ? ', ' + n + ' followed' : ''));
    });
    P.leagueCards.forEach(({ b, l }) => {
      const v = on('league', l.id);
      b.classList.toggle('on', v);
      b.setAttribute('aria-pressed', String(v));
    });
    P.teamCards.forEach(({ b, t }) => {
      const v = on('team', t.id);
      b.classList.toggle('on', v);
      b.setAttribute('aria-pressed', String(v));
    });
    const nl = followedLeagues().length, nt = followedTeams().length;
    /* "skip" until something is picked, then the way on: one button in that place, never both */
    P.c.skip.hidden = nl > 0; P.c.go.hidden = nl === 0;
    P.l.skip.hidden = nl > 0; P.l.go.hidden = nl === 0;
    P.t.skip.hidden = nt > 0; P.t.go.hidden = nt === 0;
    const says = (h, n, what, none) => {
      h.textContent = '';
      if (P.flash && P.flash.until > Date.now() && P.flash.hint === h) { h.textContent = P.flash.text; return; }
      if (!n) { h.textContent = none; return; }
      /* WHAT FOLLOWING IS FOR, right beside the word: it is how a fan gets notifications */
      h.append(el('span', 'fav-hint-k', 'Following'), ' ', el('b', null, plural(n, what)),
               el('span', 'fav-hint-why', 'You’ll get their notifications on your phone and this site.'));
    };
    says(P.c.hint, nl, 'league', 'Tap a country to see its leagues.');
    says(P.l.hint, nl, 'league', 'Tap a league to follow it.');
    says(P.t.hint, nt, 'club', 'Tap the clubs you back.');
    if (P.at === 'teams') size(P);
  }
  /* A WORD ON THE SCREEN'S HINT LINE (a pick that did not save), kept for a few seconds against the repaints
     that follow every tap, then the line goes back to what it says */
  function said(P, text) {
    const h = P.at === 'teams' ? P.t.hint : P.at === 'leagues' ? P.l.hint : P.c.hint;
    P.flash = { hint: h, text, until: Date.now() + 4000 };
    clearTimeout(P.flashT);
    P.flashT = setTimeout(() => paintAll(P), 4100);
    paintAll(P);
    h.classList.remove('shake'); void h.offsetWidth; h.classList.add('shake');
  }

  /* A TAP: shown at once, saved in turn, put back with a word if it does not save */
  async function pick(P, kind, item) {
    if (P.quietUntil && Date.now() < P.quietUntil) return;      /* see go(): a tap meant for the last screen */
    const k = key(kind, item.id);
    const want = !on(kind, item.id);
    ctx.override.set(k, want);
    ctx.pend.set(k, (ctx.pend.get(k) || 0) + 1);
    paintAll(P);
    const r = await save(kind, item.id, item.name, want);
    const left = (ctx.pend.get(k) || 1) - 1;
    if (left) ctx.pend.set(k, left); else { ctx.pend.delete(k); ctx.override.delete(k); }
    if (r && r.ok) {
      ctx.changed = true;
      if (want) ctx.added.set(k, { kind, name: item.name }); else ctx.added.delete(k);
      paintAll(P);
    } else {
      said(P, 'Not saved: ' + ((r && r.reason) || 'try again'));
    }
  }

  /* ------------------------------------------------------ the three screens --- */
  function fillCountries(P) {
    const d = P.c.strip.deck;
    d.textContent = '';
    P.countryCards = ctx.data.groups.map(g => {
      const b = countryCard(g, ctx);
      b.addEventListener('click', () => { P.lastCountry = b; showCountry(P, g); });
      d.appendChild(b);
      return { b, g };
    });
    if (!P.countryCards.length) note(P, 'c', 'No leagues yet. One appears here the moment a league is created.');
    P.filled = true;
    P.c.strip.paint();
    paintAll(P);
  }

  function showCountry(P, g) {
    P.country = g;
    const counts = (ctx.data && ctx.data.counts) || null;
    const d = P.l.strip.deck;
    d.textContent = '';
    P.leagueCards = g.leagues.map(l => {
      const b = leagueCard(l, counts ? (counts.get(l.id) || 0) : null);
      b.addEventListener('click', () => pick(P, 'league', l));
      d.appendChild(b);
      return { b, l };
    });
    d.scrollLeft = 0;
    P.l.flag.textContent = '';
    P.l.flag.appendChild(flagTile(g.code, C, ctx.base));
    P.l.name.textContent = g.name;
    P.l.n.textContent = plural(g.leagues.length, 'league');
    P.l.strip.paint();
    go(P, 'leagues');
    const first = P.leagueCards[0];
    if (first) setTimeout(() => { try { first.b.focus({ preventScroll: true }); } catch (_) { /* a courtesy */ } }, reduced() ? 0 : 380);
  }

  function backToCountries(P) {
    go(P, 'countries');
    const back = P.lastCountry;
    if (back) setTimeout(() => { try { back.focus({ preventScroll: true }); } catch (_) { /* a courtesy */ } }, reduced() ? 0 : 380);
  }

  async function loadTeams(leagues) {
    const need = leagues.filter(l => !ctx.teams.has(l.id) && UUID.test(String(l.id)));
    if (need.length) {
      const rows = await pub('teams?select=id,slug,name,short_name,colour,colour_2,logo_path,league_id&league_id=in.(' +
        need.map(l => l.id).join(',') + ')&order=name.asc');
      need.forEach(l => ctx.teams.set(l.id, []));
      rows.forEach(t => { if (ctx.teams.has(t.league_id)) ctx.teams.get(t.league_id).push(t); });
    }
    const all = [];
    leagues.forEach(l => (ctx.teams.get(l.id) || []).forEach(t => all.push(t)));
    return all;
  }

  async function toTeams(P, instant) {
    const leagues = followedLeagues();
    go(P, 'teams', instant);
    P.teamCards = [];
    if (!leagues.length) { note(P, 't', 'Pick a league first, and its clubs are here.'); return; }
    note(P, 't', 'Loading the clubs…');
    let rows;
    try { rows = await loadTeams(leagues); }
    catch (_) { if (P.at === 'teams') note(P, 't', 'The clubs could not be loaded just now.', () => toTeams(P)); return; }
    if (P.at !== 'teams') return;                    // they went back while it loaded
    const ordered = orderTeams(rows, leagues);
    if (!ordered.length) { note(P, 't', 'These leagues have no clubs listed yet.'); paintAll(P); return; }
    const by = new Map(leagues.map(l => [l.id, l]));
    const d = P.t.strip.deck;
    d.textContent = '';
    const mixed = leagues.length > 1;
    P.teamCards = ordered.map(t => {
      const b = teamCard(t, mixed ? by.get(t.league_id) : null);
      b.addEventListener('click', () => pick(P, 'team', t));
      d.appendChild(b);
      return { b, t };
    });
    d.scrollLeft = 0;
    P.t.strip.paint();
    paintAll(P);
    const first = P.teamCards[0];
    if (first) setTimeout(() => { try { first.b.focus({ preventScroll: true }); } catch (_) { /* a courtesy */ } }, reduced() ? 0 : 380);
  }

  function finish(P) {
    const ls = followedLeagues(), ts = followedTeams();
    if (!ls.length && !ts.length) { close('skip'); return; }
    const s = P.d.said;
    s.textContent = '';
    const row = (k, v) => {
      const r = el('div', 'fav-said-row'), val = el('span', 'fav-said-v', v);
      val.setAttribute('translate', 'no');
      r.append(el('span', 'fav-said-k', k), val);
      s.appendChild(r);
    };
    if (ls.length) row('Leagues', nameList(ls.map(l => l.name)));
    if (ts.length) row('Clubs', nameList(ts.map(t => t.name)));
    go(P, 'done');
    clearTimeout(P.autoClose);
    P.autoClose = setTimeout(() => close('done'), reduced() ? DONE_CLOSE_MS + 3000 : DONE_CLOSE_MS);
  }

  /* ---------------------------------------------------- opening and closing --- */
  /* the public leagues and their club counts, once: globalgames.js has the league list already, so this
     is one small request for the counts. A failure is forgotten, so the next ask tries again. */
  function ensureData() {
    if (!ctx.dataP) {
      ctx.dataP = Promise.all([loadLeagues(), clubCounts().catch(() => null)])
        .then(([leagues, counts]) => { ctx.data = { leagues, counts, groups: countryCards(leagues, C) }; return ctx.data; });
      ctx.dataP.catch(() => { ctx.dataP = null; });
    }
    return ctx.dataP;
  }
  async function loadCountries(P) {
    note(P, 'c', 'Loading the leagues…');
    try { await ensureData(); fillCountries(P); }
    catch (_) { note(P, 'c', 'The leagues could not be loaded just now.', () => loadCountries(P)); }
  }

  async function openPanel(byHand) {
    if (ctx.opening || ctx.open) return;
    if (!F.session()) { if (byHand) signIn(); return; }
    ctx.opening = true;
    try {
      try { await F.load(); } catch (_) { /* supports() below says what it says */ }
      const P = ctx.panel || build();
      P.sec.hidden = false;
      go(P, 'countries', true);
      anchor.classList.add('fav-live');
      if (reduced()) P.sec.classList.add('open');
      else { void P.sec.offsetWidth; P.sec.classList.add('open'); }
      ctx.open = true;
      ctx.changed = false; ctx.added.clear();
      if (!byHand) setNote(uid(), { shown: true });
      /* by hand: brought into view and focused, because they asked. By itself it opens where they are
         scrolling, and takes neither their scroll position nor their keyboard. */
      if (byHand) {
        try { P.sec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (_) { /* old browser */ }
        setTimeout(() => { try { P.x.focus({ preventScroll: true }); } catch (_) { /* focus is a courtesy */ } }, 400);
      }

      if (!(F.supports('league') && F.supports('team'))) {
        note(P, 'c', 'Following is not available just now. Try again in a little while.');
        return;
      }
      if (P.filled) paintAll(P); else await loadCountries(P);
      /* SOMEBODY WHO FOLLOWS LEAGUES BUT NO CLUB has already answered the first question: it opens on the
         second, for those leagues, and "Add more leagues" is one click back. (By hand they get the
         countries: the line is for adding another favourite, and Advance is there.) */
      if (!byHand && P.filled && P.at === 'countries' && followedLeagues().length) await toTeams(P, true);
    } finally { ctx.opening = false; }
  }

  function close(how) {
    const P = ctx.panel;
    if (!P || !ctx.open) return;
    clearTimeout(P.autoClose);
    const id = uid();
    if (how === 'later') setNote(id, { later: Date.now() + LATER_MS });
    else if (how === 'never') {
      setNote(id, { never: true });
      /* and the account's, where the database has the switch; the browser's note stands where it does not */
      setAccountSwitch(false);
    } else setNote(id, { shown: true });
    ctx.open = false;
    P.sec.classList.remove('open');
    P.sec.classList.add('closing');
    anchor.classList.remove('fav-live');
    const done = () => {
      P.sec.classList.remove('closing');
      P.sec.hidden = true;
      afterClose(how);
    };
    if (reduced()) done(); else setTimeout(done, 760);
  }

  /* WHAT THE PICKS CHANGED, once the panel is out of the way: MY FOLLOWED drawn again, and the one push
     offer for the follows made (not for somebody who said later or never) */
  function afterClose(how) {
    if (!ctx.changed) return;
    ctx.changed = false;
    const H = root.EpinoiaHome;
    if (H && typeof H.refresh === 'function') H.refresh('followed');
    if (how === 'later' || how === 'never' || !ctx.added.size || typeof F.offer !== 'function') return;
    const all = [...ctx.added.values()];
    const first = all.find(a => a.kind === 'team') || all[0];
    try { F.offer(first.kind, first.name); } catch (_) { /* the follows saved; the offer is a nicety */ }
    ctx.added.clear();
  }

  /* -------------------------------------------- by itself, and by an address --- */
  function watch() {
    if (ctx.watching) return;
    ctx.watching = true;
    const start = () => setTimeout(() => { if (!ctx.open && !ctx.opening) openPanel(false); }, reduced() ? 0 : OPEN_AFTER_MS);
    try {
      const io = new root.IntersectionObserver(es => {
        if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); }
      }, { rootMargin: '0px 0px -15% 0px' });
      io.observe(rule);
    } catch (_) { start(); }
  }

  async function evaluate() {
    if (ctx.tried || !F.session()) return;
    ctx.tried = true;
    let prefs = null;
    try { prefs = await F.load(); } catch (_) { return; }
    const s = { signedIn: true, ready: F.supports('league') && F.supports('team'), prefs, note: noteOf(uid()), now: Date.now(), account: null };
    if (!shouldAutoOpen(s)) return;
    s.account = await accountSwitch();
    if (shouldAutoOpen(s)) watch();
  }

  function fromAddress() {
    if (!root.location || root.location.hash !== '#favourites' || !F.session()) return;
    try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (_) { /* leave it */ }
    openPanel(true);
  }

  root.addEventListener('epinoia:auth', () => { evaluate(); fromAddress(); });
  root.addEventListener('storage', e => { if (e && e.key && String(e.key).indexOf('-auth-token') !== -1) { evaluate(); } });
  root.addEventListener('hashchange', fromAddress);
  fromAddress();
  evaluate();
  return ctx;
}

/* on HOME: at DOMContentLoaded, when every deferred script has run (front.js does the same) */
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  const a = root.document.getElementById('favourites');
  if (a) mount({ anchor: a, base: '../' }).catch(e => console.warn('[home] favourites', e));
}
if (typeof document !== 'undefined' && root.document === document) {
  if (document.readyState === 'complete') setTimeout(boot, 0);
  else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    root.addEventListener('load', boot, { once: true });
  }
}

return { mount, followsTeam, shouldAutoOpen, plural, inkFor, jwtSub, countryCards, orderTeams, nameList,
         noteOf, setNote, readStore, storedUserId, STORE, LATER_MS, UNFILED, HEAD, STAGES };
}));
