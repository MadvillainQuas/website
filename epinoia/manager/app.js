'use strict';
/* ============================================================================
   MANAGER - THE APP: the rail, the routes, the club, and the season played on this visit.      window.Mgr.app

   One page, its views by the address (#/squad, #/tactics, #/team/3, #/player/<id> ...), each drawn by a views/ file
   into the main column. What the views share is here:
     * THE CLUB: the reader's own (0259, through the adapter), its league loaded (adapters/epinoia.js league: the season
       file, the reference, the simulator's league, values, attributes, cards), its squad's men from other leagues with
       their leagues, and the cards they play with here (the league-strength shift);
     * THE SEASON ON THIS VISIT: every round whose tip-off has passed and that is not played yet is played now, here,
       before anything is drawn (core/season.js due + play), each with the form of the real games in the days before it
       (adapters formFor + cards.formOf), and the season saved back with the summary the boards read. The real clubs
       play their own men at their own minutes (engine.autoRotation), less any the reader has drafted, with their
       identity (engine.identityOf, worked out once from the club as it really is);
     * the small things every view draws: crests and badges, names and links, money, the 1-20 chips, a toast.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr = root.Mgr || {};
const site = () => Mgr.site;
const doc = root.document;
const isNum = v => typeof v === 'number' && isFinite(v);
const TIP = 'T' + String((Mgr.season && Mgr.season.TIP_UTC) || 19).padStart(2, '0') + ':00:00Z';

/* ------------------------------------------------------------------ elements --- */
/* h('div.mg-panel.glow', {attrs}, ...children): text is always text (never HTML), names carry translate="no" */
function h(sel, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel || 'div') || [];
  const n = doc.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, k, v) => { if (k === '.') n.classList.add(v); else n.id = v; return ''; });
  if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) Object.keys(attrs).forEach(k => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'cls') n.className += (n.className ? ' ' : '') + v;
    else if (k === 'name' && v === true) n.setAttribute('translate', 'no');
    else n.setAttribute(k, v === true ? '' : String(v));
  });
  kids.flat(Infinity).forEach(k => { if (k == null || k === false) return; n.appendChild(k.nodeType ? k : doc.createTextNode(String(k))); });
  return n;
}
/* a proper name (a player, a club, a league): never translated */
const nm = (s, tag) => h(tag || 'span', { translate: 'no' }, s == null ? '' : String(s));
const fmt = (v, d) => (isNum(v) ? v.toFixed(d == null ? 1 : d) : '–');
const pct = (v, d) => (isNum(v) ? (100 * v).toFixed(d == null ? 1 : d) : '–');
const money = v => (Mgr.value ? Mgr.value.money(v) : String(v));
const stored = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const slotOf = share => (Array.isArray(share) ? share.indexOf(Math.max(...share)) : 2);

/* ------------------------------------------------------------------ the state --- */
const A = {
  h, nm, fmt, pct, money, SLOTS, slotOf, stored, store,
  signedIn: false, clubs: [], club: null, lg: null, ext: new Map(),
  mine: { cards: new Map(), rows: new Map(), league: new Map() },
  identity: new Map(), news: [], views: {}, route: { name: 'home', args: [], q: new URLSearchParams() }
};
Mgr.app = A;

/* ------------------------------------------------------------------ the rail --- */
const ICON = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  squad: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 21c0-4 3-7 6-7s6 3 6 7zm13 0c0-2.5-.8-4.6-2.2-6 3.7-.4 7.2 2 7.2 6z',
  tactics: 'M4 4h16v16H4zM12 4v16M4 12h4a4 4 0 0 1 8 0h4',
  fixtures: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  table: 'M4 5h16M4 10h16M4 15h16M4 20h16',
  stats: 'M5 20V10M10 20V4M15 20v-7M20 20v-12',
  trade: 'M4 8h13l-3-3M20 16H7l3 3',
  boards: 'M7 21h10M12 17v4M6 4h12v4a6 6 0 0 1-12 0zM6 6H3a3 3 0 0 0 3 4M18 6h3a3 3 0 0 1-3 4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z'
};
const icon = k => { const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[k] || ICON.home); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round'); s.appendChild(p); return s; };
const NAV = [['home', 'Club'], ['squad', 'Squad'], ['tactics', 'Tactics'], ['fixtures', 'Fixtures'], ['table', 'Table'], ['stats', 'Statistics'], ['trade', 'Trade'], ['boards', 'Leaderboards'], ['settings', 'Club settings']];
const DRAFT_NAV = ['squad', 'tactics', 'boards', 'settings'];
function drawRail() {
  const nav = doc.getElementById('mgNav'), bar = doc.getElementById('mgTabbar'), chip = doc.getElementById('mgClubChip');
  if (!nav) return;
  /* while the squad is being drafted: the squad, its tactics beside it (Louie: "also viewable while constructing the
     squad to aid it"), the boards and the settings */
  const active = !!(A.club && A.club.status !== 'draft'), list = A.club ? NAV.filter(([k]) => active || DRAFT_NAV.includes(k)) : [['home', 'Club'], ['boards', 'Leaderboards']];
  nav.textContent = ''; bar.textContent = '';
  list.forEach(([k, label], i) => {
    if (k === 'boards') nav.appendChild(h('li.sep', { 'aria-hidden': 'true' }));
    const cur = A.route.name === k || (k === 'home' && A.route.name === 'home');
    nav.appendChild(h('li', h('a', { href: '#/' + (k === 'home' ? '' : k), 'aria-current': cur ? 'page' : null }, icon(k), label)));
    if (k !== 'settings') bar.appendChild(h('a', { href: '#/' + (k === 'home' ? '' : k), 'aria-current': cur ? 'page' : null }, icon(k), label));
  });
  chip.textContent = '';
  if (A.club) {
    const box = h('div.mg-clubchip', A.badge(A.club.badge, 38), h('div.t', nm(A.club.name, 'b'), h('span', nm(A.lg ? A.lg.L.name : ''), A.club.gp ? ' · ' + A.club.w + '–' + A.club.l : '')));
    if (A.clubs.length > 1 || A.clubs.length < 3) {
      const sel = h('select', { 'aria-label': 'Switch club' }), pend = A.pendingClub();
      A.clubs.forEach(c => sel.appendChild(h('option', { value: c.id, selected: c.id === A.club.id ? true : null, translate: 'no' }, c.name)));
      if (pend) sel.appendChild(h('option', { value: 'pending', selected: A.club.pending ? true : null, translate: 'no' }, pend.name + ' ✎'));
      if (A.clubs.length + (pend ? 1 : 0) < 3) sel.appendChild(h('option', { value: '+' }, '+ A new club'));
      sel.addEventListener('change', () => { if (sel.value === '+') location.hash = '#/new'; else switchClub(sel.value); });
      box.querySelector('.t').appendChild(sel);
    }
    chip.appendChild(box);
  }
}

/* ------------------------------------------------------------------ small shared things --- */
A.badge = (b, size) => { const s = h('span.mg-badge', { translate: 'no' }); s.innerHTML = Mgr.badge.svg(b, size || 40); return s; };   // badge.svg escapes every field it writes
/* a club of the manager league by its index: the reader's (0) or a real club's crest */
A.clubAt = i => {
  const S = A.club && A.club.state, id = S ? S.clubs[i] : null;
  if (id === 'me' || i === 0) return { me: true, id: 'me', name: A.club ? A.club.name : '', short: A.club ? A.club.name : '', badge: A.club ? A.club.badge : null };
  const T = A.lg && A.lg.teams.find(t => String(t.id) === String(id)), m = (T && T.meta) || {};
  return { me: false, id, name: m.name || 'Club', short: m.teamShort || m.name || 'Club', colour: m.colour || null, logo: m.logo || null, slug: m.slug || '' };
};
A.crest = (i, size) => {
  const c = A.clubAt(i), s = size || 32;
  if (c.me) return A.badge(c.badge, s);
  const el = root.epinoiaCrest ? root.epinoiaCrest({ name: c.name, short_name: c.short, colour: c.colour, logo_path: c.logo }, { cls: 'mg-crest' }) : h('span.mg-crest', c.short.slice(0, 3));
  el.style.width = el.style.height = s + 'px';
  return el;
};
A.clubLink = (i, cls) => { const c = A.clubAt(i); return h('a' + (cls ? '.' + cls : ''), { href: '#/team/' + i, translate: 'no' }, c.name); };
/* a player: his season row and his league's loaded data (the home league's, or his own league's for a man from abroad) */
A.rowOf = id => { id = String(id); return A.mine.rows.get(id) || (A.lg && A.lg.byId.get(id)) || null; };
A.namedOf = id => {
  id = String(id);
  const lid = A.mine.league.get(id), L = lid && A.ext.get(lid);
  return (L && L.named.get(id)) || (A.lg && A.lg.named.get(id)) || null;
};
A.nameOf = id => { const r = A.namedOf(id); return (r && r.name) || 'Player'; };
A.playerLink = (id, cls) => h('a' + (cls ? '.' + cls : ''), { href: '#/player/' + encodeURIComponent(id), translate: 'no' }, A.nameOf(id));
A.cardOf = id => { id = String(id); return A.mine.cards.get(id) || (A.lg && A.lg.cards.get(id)) || null; };
/* his position: the one the site lists him at, where it names one (adapter: cards.listedSlot), else his minutes' */
A.slotIn = (L, id, share) => { const s = L && L.slot && L.slot.get(String(id)); return s != null ? s : slotOf(share); };
A.slotOfId = id => { const c = A.cardOf(id); return A.slotIn(A.leagueDataOf(id), id, c ? c.share : null); };
A.posOf = id => (A.cardOf(id) || A.rowOf(id) ? SLOTS[A.slotOfId(id)] : '–');
A.leagueDataOf = id => { const lid = A.mine.league.get(String(id)); return (lid && A.ext.get(lid)) || A.lg; };
A.attrs = id => { const L = A.leagueDataOf(id); return (L && L.attrs.get(String(id))) || null; };
A.priceOf = id => { const L = A.leagueDataOf(id); return (L && L.priced.get(String(id))) || null; };
A.attrChip = v => h('span.mg-attr.' + (Mgr.ratings.band(v) || 'a0'), isNum(v) ? String(v) : '–');
A.toast = (msg, bad) => {
  const t = doc.getElementById('mgToast'); if (!t) return;
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('on');
  clearTimeout(A._toastT); A._toastT = setTimeout(() => t.classList.remove('on'), 4200);
};
/* A POP-UP (a player's card, a hint) beside what opened it, inside the window and never taller than it (Louie: "Some of
   the pop up is cut off"); a page zoom, where there is one, taken out of the measures. A phone: the sheet at the foot
   (manager.css) */
A.place = (el, anchor, o) => {
  const z = parseFloat(root.getComputedStyle(doc.body).zoom) || 1, vw = root.innerWidth / z, vh = root.innerHeight / z, gap = 12, dy = o && o.dy != null ? o.dy : -40;
  el.scrollTop = 0;
  const b = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  if (!b || vw <= 860) { el.style.left = gap + 'px'; el.style.bottom = gap + 'px'; return; }
  el.style.maxHeight = Math.max(200, vh - 2 * gap) + 'px';
  const W = el.offsetWidth, H = Math.min(el.offsetHeight, vh - 2 * gap), right = b.right / z + gap, left = b.left / z - gap - W;
  el.style.left = (right + W <= vw - gap ? right : Math.max(gap, left)) + 'px';
  el.style.top = Math.max(gap, Math.min(vh - H - gap, b.top / z + dy)) + 'px';
  el.style.bottom = 'auto';
};
A.loading = (msg, host) => { const m = host || doc.getElementById('mgMain'); m.textContent = ''; m.appendChild(h('div.mg-loading', h('div', h('div.mg-spin', { 'aria-hidden': 'true' }), h('p', msg || 'Loading…')))); };
A.go = path => { if (location.hash === '#' + path) route(); else location.hash = '#' + path; };

/* ------------------------------------------------------------------ the club --- */
async function switchClub(id) {
  const c = id === 'pending' ? A.pendingClub() : A.clubs.find(x => x.id === id);
  if (!c) return;
  A.lg = null; A.mine = { cards: new Map(), rows: new Map(), league: new Map() }; A.identity = new Map(); A.news = [];
  A.loading('Opening ' + c.name + '…');
  await openClub(c);
  A.go('/');
}
async function openClub(club) {
  A.club = club; store('mgr_club', club.pending ? 'pending' : club.id);
  restoreDraft(club);
  const leagues = await site().leagues();
  const L = leagues.find(l => l.id === club.league_id);
  if (!L) { A.lgError = 'This club’s league cannot be read just now.'; return; }
  A.loading('Reading ' + L.name + '…');
  A.lg = await site().league(L);
  await loadMine();
  if (club.status === 'active' && club.state) await catchUp();
}
/* THE SQUAD'S MEN: each with his own league (a man from abroad brings his league's file) and the card he plays with here */
async function loadMine() {
  const roster = Array.isArray(A.club.roster) ? A.club.roster : [];
  A.mine = { cards: new Map(), rows: new Map(), league: new Map() };
  const leagues = await site().leagues();
  for (const e of roster) {
    const id = String(e.id), lid = e.league || A.lg.L.id;
    A.mine.league.set(id, lid);
    let L = A.lg;
    if (lid !== A.lg.L.id) {
      if (!A.ext.has(lid)) { const LL = leagues.find(l => l.id === lid); if (LL) { try { A.ext.set(lid, await site().league(LL)); } catch (_) { /* his league is not there today */ } } }
      L = A.ext.get(lid) || null;
    }
    const row = L ? L.byId.get(id) : null;
    if (!row) continue;
    A.mine.rows.set(id, row);
    A.mine.cards.set(id, L === A.lg ? L.cards.get(id) : site().card(row, L, A.lg));
  }
}
A.loadLeagueFor = async lid => {
  if (!lid || lid === A.lg.L.id) return A.lg;
  if (!A.ext.has(lid)) { const LL = (await site().leagues()).find(l => l.id === lid); if (!LL) return null; A.ext.set(lid, await site().league(LL)); }
  return A.ext.get(lid);
};
A.reloadMine = loadMine;

/* THE MANAGER LEAGUE'S CLUBS: the real league's clubs that play most of its games (a cup's guest with a game or two is not
   one of them) */
A.realClubs = () => {
  const T = (A.lg && A.lg.teams) || [], top = T.reduce((a, t) => Math.max(a, +t.gp || 0), 0);
  return T.filter(t => (+t.gp || 0) >= Math.max(1, 0.34 * top)).map(t => String(t.id));
};

/* ------------------------------------------------------------------ the teams that play --- */
const X = () => ({ L: A.lg.sim, ref: A.lg.ref, G: 40 });
/* the reader's lineups as they stand, each checked: five different men of the squad; none valid, the squad's own */
A.lineups = () => {
  const ids = new Set(A.mine.cards.keys());
  const ok = (A.club.lineups || []).filter(l => l && Array.isArray(l.ids) && l.ids.length === 5 && new Set(l.ids).size === 5 && l.ids.every(id => ids.has(String(id))) && l.min > 0);
  return ok.length ? ok : autoLineups();
};
/* the squad's own lineups: its five most valuable men, set at the positions their own positions put them in (the
   smallest at the point, the biggest at centre - a man one position over costs little), twenty-eight minutes; the next
   five (with the starters the bench needs to make five), twelve */
function autoLineups() {
  const men = [...A.mine.cards.values()].sort((a, b) => ((A.priceOf(b.id) || {}).value || 0) - ((A.priceOf(a.id) || {}).value || 0));
  if (men.length < 5) return [];
  const order = five => five.slice().sort((a, b) => (A.slotOfId(a.id) - A.slotOfId(b.id)) || (a.pos - b.pos)).map(c => c.id);
  const first = men.slice(0, 5), rest = men.slice(5);
  if (!rest.length) return [{ ids: order(first), min: 40 }];
  const second = rest.slice(0, 5).concat(first.slice().reverse()).slice(0, 5);
  return [{ ids: order(first), min: 28 }, { ids: order(second), min: 12 }];
}
A.autoLineups = autoLineups;
/* a real club: its own men at their own minutes, less the reader's draft; fewer than five, replacement-level fillers */
function realTeam(tid, form) {
  const lg = A.lg, drafted = new Set([...A.mine.league.entries()].filter(([, l]) => l === lg.L.id).map(([id]) => id));
  const T = lg.teams.find(t => String(t.id) === tid) || {}, gp = Math.max(1, +T.gp || 1);
  const all = lg.S.players.filter(r => String(lg.teamOf(r.id)) === tid && r.min > 0);
  const men = p => ({ id: String(p.id), mpg: p.min / gp, share: lg.share.get(String(p.id)) || Mgr.cards.shareOf(p) });
  const cards = new Map(lg.cards);
  let list = all.filter(r => !drafted.has(String(r.id))).map(men);
  /* nobody at a position, or fewer than five: replacement-level men in the gaps */
  const fill = k => { const id = 'fill:' + tid + ':' + k; cards.set(id, Mgr.cards.fillerCard(lg.ref, k, id)); return { id, mpg: 8, share: [0, 1, 2, 3, 4].map(j => (j === k ? 1 : 0)) }; };
  for (let k = 0; list.length < 8 && k < 5; k++) list.push(fill(k));
  let segs = Mgr.engine.autoRotation(list, 40);
  if (!segs.length) { list = list.concat([0, 1, 2, 3, 4].map(fill)); segs = Mgr.engine.autoRotation(list, 40); }
  if (!A.identity.has(tid)) {
    let id = null;
    try { const full = Mgr.engine.autoRotation(all.map(men), 40); if (full.length) id = Mgr.engine.identityOf({ id: tid, segs: full, cards: lg.cards }, T, X()); } catch (_) { id = null; }
    A.identity.set(tid, id);
  }
  return { id: tid, segs, cards, identity: A.identity.get(tid), form };
}
function myTeam(form) {
  const segs = Mgr.engine.rotation(A.lineups(), 40);
  return { id: 'me', segs, cards: A.mine.cards, form };
}
A.teamObj = (i, form) => { const id = A.club.state.clubs[i]; return id === 'me' ? myTeam(form) : realTeam(String(id), form); };
A.X = X;

/* ------------------------------------------------------------------ the season on this visit --- */
const dateOfRound = (S, r) => (S.fixtures.find(f => f.r === r) || {}).d;
async function catchUp() {
  const S = A.club.state, SE = Mgr.season, due = SE.due(S, Date.now());
  if (!due.length) return;
  A.loading(due.length === 1 ? 'Playing round ' + due[0] + '…' : 'Playing rounds ' + due[0] + '–' + due[due.length - 1] + '…');
  /* the real games of the days before each round: one read for every round to play */
  const back = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 7); return x.toISOString().slice(0, 10); };
  const first = due[0], before = first > 1 ? dateOfRound(S, first - 1) : back(dateOfRound(S, first));
  const from = before + TIP, to = dateOfRound(S, due[due.length - 1]) + TIP;
  const abroad = [...A.mine.league.entries()].filter(([, l]) => l !== A.lg.L.id).map(([id]) => id);
  let lines = new Map();
  try { lines = await site().formFor(A.lg.L, from, to, abroad); } catch (_) { lines = new Map(); }
  for (const r of due) {
    const lo = (r > 1 ? dateOfRound(S, r - 1) : back(dateOfRound(S, r))) + TIP, hi = dateOfRound(S, r) + TIP, form = new Map();
    lines.forEach((games, id) => {
      const g = games.filter(x => x.t > lo && x.t <= hi), row = A.rowOf(id);
      if (g.length && row) { const z = Mgr.cards.formOf(row, g); if (z) form.set(id, z); }
    });
    const teams = new Map();
    const ctx = { X: X(), me: 0, team: i => { if (!teams.has(i)) teams.set(i, A.teamObj(i, form)); return teams.get(i); } };
    const played = SE.play(S, r, ctx);
    played.forEach(({ f, g }) => { if (f.h === 0 || f.a === 0) A.news.push(newsOf(r, f, g, form)); });
    await new Promise(res => setTimeout(res, 0));     // a breath for the page between rounds
  }
  await saveSeason();
}
function newsOf(r, f, g, form) {
  const home = f.h === 0, us = home ? g.pts[0] : g.pts[1], them = home ? g.pts[1] : g.pts[0], opp = home ? f.a : f.h;
  const box = g.box[home ? 0 : 1].slice().sort((a, b) => b.pts - a.pts)[0];
  const hot = box && form.get(box.id) > 0.8;
  return { r, d: f.d, won: us > them, us, them, opp, home, ot: g.ot, top: box ? { id: box.id, pts: box.pts, reb: box.reb, ast: box.ast, hot } : null };
}
/* THE SEASON AS THE READER MAY SEE IT: a round whose game they are watching (or are still to choose about) is left out
   - its results, its games' lines in the players' totals and the clubs' totals - until it ends (views/live.js) */
A.hiddenRound = () => { const lv = A.liveRound ? A.liveRound() : null; return lv ? lv.r : null; };
A.view = () => {
  const S = A.club && A.club.state, r = S ? A.hiddenRound() : null;
  if (!S || r == null) return S;
  const out = Object.assign({}, S, { fixtures: S.fixtures.map(f => (f.r === r ? Object.assign({}, f, { res: null, live: true }) : f)) });
  out.played = out.fixtures.filter(f => f.res != null).reduce((a, f) => Math.max(a, f.r), 0);
  /* the watched game's lines out of the totals (the other games of the round are not the reader's: their lines stay) */
  const B = S.box[r], LN = Mgr.season.LINE;
  if (B) {
    out.stats = Object.assign({}, S.stats);
    B.forEach(side => side.forEach(l => { const cur = out.stats[l[0]]; if (cur) out.stats[l[0]] = cur.map((v, j) => (j === 0 ? v - 1 : v - (l[j] || 0))); }));
    const f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
    out.tstats = S.tstats.slice();
    [f.h, f.a].forEach((club, s2) => {
      const T = S.tstats[club]; if (!T) return;
      const sum = k => B[s2].reduce((a, l) => a + (l[LN.indexOf(k)] || 0), 0), opp = k => B[1 - s2].reduce((a, l) => a + (l[LN.indexOf(k)] || 0), 0);
      out.tstats[club] = Object.assign({}, T, { gp: T.gp - 1, pts: T.pts - sum('pts'), opp: T.opp - opp('pts'), fga: T.fga - sum('fga'), fgm: T.fgm - sum('fgm'), p3a: T.p3a - sum('p3a'),
        p3m: T.p3m - sum('p3m'), fta: T.fta - sum('fta'), ftm: T.ftm - sum('ftm'), oreb: T.oreb - sum('oreb'), dreb: T.dreb - sum('dreb'), tov: T.tov - sum('tov'), ast: T.ast - sum('ast'),
        stl: T.stl - sum('stl'), blk: T.blk - sum('blk'), poss: T.poss * (T.gp - 1) / Math.max(1, T.gp) });
    });
  }
  return out;
};
async function saveSeason() {
  /* the boards' record is the reader's own: a game they are watching is not on it until it ends */
  const S = A.club.state, sum = Mgr.season.summary(A.view(), 0);
  if (S.played >= S.fixtures.reduce((a, f) => Math.max(a, f.r), 0) && A.hiddenRound() == null) A.club.status = 'done';
  try {
    await site().save(A.club.id, { state: S, summary: sum, status: A.club.status });
    Object.assign(A.club, { w: sum.w, l: sum.l, pf: sum.pf, pa: sum.pa, gp: sum.w + sum.l, pos: sum.pos, of_n: sum.of, rounds: sum.rounds, played: sum.played });
  } catch (e) { A.toast('The season could not be saved just now: it will be saved on your next visit.', true); }
}
A.saveSeason = saveSeason;
A.catchUp = catchUp;

/* ------------------------------------------------------------------ a club not made yet --- */
/* NOTHING IS SAVED BEFORE THE SQUAD IS CONFIRMED (Louie, 2026-10-09: "I need for teams to not be confirmed/saved until
   confirm squad has been clicked"). A new club - its names, badge, league and the squad being drafted - is kept in this
   browser (under the reader's account) until Confirm squad makes it (manager_create) and saves it whole; a club made
   before this, still drafting, keeps its draft (squad, lineups) here too. Another screen of the Manager, or leaving the
   page, loses nothing (Louie: "If I click club/squad it removes who I've added"). */
const PKEY = () => 'mgr_pending_' + (A.uid || 'me');
const DKEY = id => 'mgr_draft_' + id;
A.pendingClub = () => { try { const p = JSON.parse(stored(PKEY()) || 'null'); return p && p.pending && p.league_id ? p : null; } catch (_) { return null; } };
A.keepPending = p => store(PKEY(), p ? JSON.stringify(p) : null);
A.newPending = o => ({ id: 'pending', pending: true, status: 'draft', mode: 'solo', league_id: o.league, competition_id: o.competition, name: o.name, manager: o.manager,
  badge: o.badge || {}, per_week: o.perWeek || 2, budget: o.budget || null, roster: [], lineups: [], state: null, w: 0, l: 0, pf: 0, pa: 0, gp: 0, played: 0 });
A.isDraft = () => !!(A.club && A.club.status === 'draft');
/* the draft as it stands, kept */
function keepDraft() {
  if (!A.isDraft()) return;
  if (A.club.pending) A.keepPending(A.club);
  else store(DKEY(A.club.id), JSON.stringify({ roster: A.club.roster || [], lineups: A.club.lineups || [] }));
}
A.keepDraft = keepDraft;
function restoreDraft(club) {
  if (club.pending || club.status !== 'draft') return;
  try { const d = JSON.parse(stored(DKEY(club.id)) || 'null'); if (d) { if (Array.isArray(d.roster)) club.roster = d.roster; if (Array.isArray(d.lineups)) club.lineups = d.lineups; } } catch (_) { /* none kept */ }
}
A.save = async patch => {
  /* a club not made yet: everything stays here. A club still drafting: its squad and lineups stay here, its names and
     badge go to the database as before */
  if (A.club.pending) { Object.assign(A.club, patch); A.keepPending(A.club); return new Date().toISOString(); }
  if (A.isDraft()) {
    const here = {}, there = {};
    Object.keys(patch).forEach(k => { (k === 'roster' || k === 'lineups' ? here : there)[k] = patch[k]; });
    Object.assign(A.club, here); keepDraft();
    if (!Object.keys(there).length) return new Date().toISOString();
    const at = await site().save(A.club.id, there); Object.assign(A.club, there); return at;
  }
  const at = await site().save(A.club.id, patch); Object.assign(A.club, patch); return at;
};
/* CONFIRM SQUAD: the club made now (a new one), its squad, budget and lineups saved with the season drawn from today, and
   the draft kept here forgotten. Made but not saved (a dropped connection): a second press saves the club made, never a
   second club. -> the season's state */
A.confirmSquad = async ({ roster, budget }) => {
  const c = A.club;
  c.roster = roster; c.budget = budget;
  await loadMine();
  const lineups = A.lineups();
  const state = Mgr.season.create({ clubs: ['me'].concat(A.realClubs()), start: new Date().toISOString().slice(0, 10), perWeek: c.per_week || 2, meetings: 3 });
  let id = c.id;
  if (c.pending) {
    id = c.createdId || await site().create({ league: c.league_id, competition: c.competition_id, name: c.name, manager: c.manager, badge: Mgr.badge.sanitise(c.badge), perWeek: c.per_week });
    c.createdId = id; A.keepPending(c);
  }
  await site().save(id, { roster, budget, state, lineups, status: 'active', summary: Mgr.season.summary(state, 0) });
  if (c.pending) A.keepPending(null); else store(DKEY(id), null);
  try { A.clubs = await site().clubs(); } catch (_) { /* read again on the next visit */ }
  const made = A.clubs.find(x => x.id === id) || Object.assign({}, c, { id, pending: false, createdId: undefined });
  Object.assign(made, { roster, budget, state, lineups, status: 'active' });
  A.club = made; store('mgr_club', id);
  await loadMine();
  return state;
};
/* the club not made yet, let go */
A.discardPending = () => { A.keepPending(null); if (A.club && A.club.pending) { A.club = null; A.lg = null; store('mgr_club', null); } };

/* ------------------------------------------------------------------ the routes --- */
function parse() {
  const raw = (location.hash || '#/').replace(/^#\/?/, ''), cut = raw.indexOf('?');
  const path = cut >= 0 ? raw.slice(0, cut) : raw, query = cut >= 0 ? raw.slice(cut + 1) : '';
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: p[0] || 'home', args: p.slice(1), q: new URLSearchParams(query) };
}
async function route() {
  A.route = parse();
  drawRail();
  const main = doc.getElementById('mgMain');
  const name = A.route.name;
  const open = ['boards'];
  if (!A.signedIn && !open.includes(name)) return door(main);
  if (A.lgError && A.club && name !== 'settings' && name !== 'new') { main.textContent = ''; main.appendChild(h('div.mg-panel', A.lgError)); return; }
  if (!A.club && name !== 'new' && !open.includes(name)) { A.go('/new'); return; }
  if (A.club && A.club.status === 'draft' && !['squad', 'tactics', 'new', 'settings', 'boards', 'player'].includes(name)) { A.go('/squad'); return; }
  const v = A.views[name === 'home' ? 'home' : name];
  main.textContent = '';
  const host = h('div.mg-view-in');
  main.appendChild(host);
  if (!v) { host.appendChild(h('div.mg-panel', 'Nothing here.')); return; }
  try { await v.render(host, A.route.args); }
  catch (e) { host.textContent = ''; host.appendChild(h('div.mg-panel', h('b', 'Something went wrong drawing this page.'), h('p.mg-sub', String(e && e.message || e)))); if (root.console) console.error(e); }
  try { main.focus({ preventScroll: true }); } catch (_) { /* fine */ }
  root.scrollTo({ top: 0 });
}
A.route_ = route;
/* SIGNED OUT: the door (Louie: the onboarding starts at a login prompt) */
function door(main) {
  main.textContent = '';
  main.appendChild(h('div.mg-door', h('div.mg-panel.glow',
    h('div', h('span.mg-word', { translate: 'no' }, 'Manager')),
    h('h1', 'Take a club into a real league'),
    h('p', 'Draft a squad from the players of every league on EPINOIA within your budget, set your lineups and tactics, and play the real clubs on the real calendar, one or two rounds a week. Every game is simulated from the players’ own numbers, and their real form moves them.'),
    h('p', h('a.mg-btn.primary.big', { href: site().signinHref() }, 'Sign in to start')),
    h('p.mg-sub', h('a', { href: '#/boards' }, 'See the leaderboards')))));
}

/* ------------------------------------------------------------------ start --- */
async function start() {
  root.addEventListener('hashchange', () => route());
  try { A.signedIn = await site().signedIn(); } catch (_) { A.signedIn = false; }
  if (A.signedIn) {
    try { A.uid = await site().userId(); } catch (_) { A.uid = null; }
    try { A.clubs = await site().clubs(); } catch (e) { A.clubs = []; if (e && e.status === 404) A.missing = true; }
    const want = stored('mgr_club'), pend = A.pendingClub();
    /* a club not made yet that the server has since made (confirmed, then the page closed before it was forgotten) */
    if (pend && pend.createdId && A.clubs.some(x => x.id === pend.createdId && x.status !== 'draft')) A.keepPending(null);
    const p2 = A.pendingClub();
    const c = (want === 'pending' && p2) || A.clubs.find(x => x.id === want) || p2 || A.clubs[A.clubs.length - 1] || null;
    if (c) { try { await openClub(c); } catch (e) { A.lgError = 'This club’s league could not be read just now: ' + (e && e.message || e); } }
  }
  await route();
  setTimeout(() => { const app = doc.getElementById('mgApp'); if (app) app.classList.remove('mg-enter'); }, 900);
}
A.start = start;
A.openClub = openClub;
})(typeof globalThis !== 'undefined' ? globalThis : self);
