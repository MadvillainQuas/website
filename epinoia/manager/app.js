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
A.rowOf = id => { id = String(id).replace(/^dup:/, ''); return A.mine.rows.get(id) || (A.lg && A.lg.byId.get(id)) || null; };
A.namedOf = id => {
  id = String(id);
  /* a real club's copy of a man the reader signed: the same man, marked * */
  if (id.startsWith('dup:')) { const r = A.namedOf(id.slice(4)); return r ? Object.assign({}, r, { name: r.name + ' *' }) : null; }
  const lid = A.mine.league.get(id), L = lid && A.ext.get(lid);
  return (L && L.named.get(id)) || (A.lg && A.lg.named.get(id)) || null;
};
A.nameOf = id => { const r = A.namedOf(id); return (r && r.name) || 'Player'; };
A.playerLink = (id, cls) => h('a' + (cls ? '.' + cls : ''), { href: '#/player/' + encodeURIComponent(String(id).replace(/^dup:/, '')), translate: 'no' }, A.nameOf(id));
A.cardOf = id => { id = String(id).replace(/^dup:/, ''); return A.mine.cards.get(id) || (A.lg && A.lg.cards.get(id)) || null; };
/* his position: the one the site lists him at, where it names one (adapter: cards.listedSlot), else his minutes' */
A.slotIn = (L, id, share) => { const s = L && L.slot && L.slot.get(String(id)); return s != null ? s : slotOf(share); };
A.slotOfId = id => { const c = A.cardOf(id); return A.slotIn(A.leagueDataOf(id), id, c ? c.share : null); };
A.posOf = id => (A.cardOf(id) || A.rowOf(id) ? SLOTS[A.slotOfId(id)] : '–');
A.leagueDataOf = id => { const lid = A.mine.league.get(String(id).replace(/^dup:/, '')); return (lid && A.ext.get(lid)) || A.lg; };
A.attrs = id => { const L = A.leagueDataOf(id); return (L && L.attrs.get(String(id).replace(/^dup:/, ''))) || null; };
A.priceOf = id => { const L = A.leagueDataOf(id); return (L && L.priced.get(String(id).replace(/^dup:/, ''))) || null; };
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
  /* A SEASON NOT STARTED YET takes in every club of the league (a club missing from it before is added) - only before its
     first tip-off, and from its own start date: once a round is due it is played, never drawn away (season.redrawable) */
  if (club.status === 'active' && club.state && Mgr.season.redrawable(club.state, Date.now())) {
    const want = ['me'].concat(A.realClubs());
    if (want.join() !== club.state.clubs.join()) {
      club.state = Mgr.season.create({ clubs: want, start: club.state.start || new Date().toISOString().slice(0, 10), perWeek: club.per_week || 2, meetings: 3 });
      try { await site().save(club.id, { state: club.state, summary: Mgr.season.summary(club.state, 0) }); } catch (_) { /* again next visit */ }
    }
  }
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
  /* every club that has played (Louie: all of the league's clubs in the table); a cup's guest is cut only once the season is well under way */
  return T.filter(t => (+t.gp || 0) >= (top >= 10 ? 0.34 * top : 1)).map(t => String(t.id));
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
/* A REAL CLUB: its own men at their own minutes, less the reader's draft; fewer than five, replacement-level fillers. It
   opens with ITS REAL STARTERS (Louie, 2026-10-14: "Can IRL teams also use their real life styles ... and rotations?"):
   the five its games have started most, the recent ones counting most (adapters/epinoia.js starts), and plays its real
   style (engine.identityOf: its shot mix, its running, its pace, then its four factors) */
function realTeam(tid, form) {
  const lg = A.lg, drafted = new Set([...A.mine.league.entries()].filter(([, l]) => l === lg.L.id).map(([id]) => id));
  const T = lg.teams.find(t => String(t.id) === tid) || {}, gp = Math.max(1, +T.gp || 1);
  const all = lg.S.players.filter(r => String(lg.teamOf(r.id)) === tid && r.min > 0);
  const men = p => ({ id: String(p.id), mpg: p.min / gp, share: lg.share.get(String(p.id)) || Mgr.cards.shareOf(p) });
  const cards = new Map(lg.cards);
  /* the reader's signings are copies: the real clubs keep their own men (Louie: "duplicated rather than ripped from teams") */
  /* a man the reader signed plays here too, as a copy with his own id (so his two seasons never add together) */
  const idOf = id => (drafted.has(id) ? 'dup:' + id : id);
  let list = all.map(men).map(m => { if (!drafted.has(m.id)) return m; const id = 'dup:' + m.id; if (lg.cards.get(m.id)) cards.set(id, Object.assign({}, lg.cards.get(m.id), { id })); return Object.assign({}, m, { id }); });
  /* nobody at a position, or fewer than five: replacement-level men in the gaps */
  const fill = k => { const id = 'fill:' + tid + ':' + k; cards.set(id, Mgr.cards.fillerCard(lg.ref, k, id)); return { id, mpg: 8, share: [0, 1, 2, 3, 4].map(j => (j === k ? 1 : 0)) }; };
  for (let k = 0; list.length < 8 && k < 5; k++) list.push(fill(k));
  const st = lg.starts && lg.starts.get(tid), have = new Set(list.map(m => m.id));
  const starters = st ? [...st.entries()].map(([id, w]) => [idOf(String(id)), w]).filter(([id]) => have.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id) : null;
  let segs = Mgr.engine.autoRotation(list, 40, { starters });
  if (!segs.length) { list = list.concat([0, 1, 2, 3, 4].map(fill)); segs = Mgr.engine.autoRotation(list, 40, { starters }); }
  if (!A.identity.has(tid)) {
    let id = null;
    try { const full = Mgr.engine.autoRotation(all.map(men), 40, { starters: st ? [...st.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([x]) => String(x)) : null }); if (full.length) id = Mgr.engine.identityOf({ id: tid, segs: full, cards: lg.cards }, T, X()); } catch (_) { id = null; }
    A.identity.set(tid, id);
  }
  return { id: tid, segs, cards, identity: A.identity.get(tid), form, bench: list.map(m => m.id) };
}
/* THE READER'S CLUB: its lineups on the clock, every man of the squad on the bench (a live game may play any of them),
   and each man's instructions (core/instruct.js, kept on his roster entry) */
A.insMap = () => Mgr.instruct ? Mgr.instruct.forEngine(A.club.roster || [], A.cardOf, A.slotOfId) : null;
function myTeam(form) {
  const segs = Mgr.engine.rotation(A.lineups(), 40);
  return { id: 'me', segs, cards: A.mine.cards, form, ins: A.insMap(), bench: [...A.mine.cards.keys()] };
}
A.teamObj = (i, form) => { const id = A.club.state.clubs[i]; return id === 'me' ? myTeam(form) : realTeam(String(id), form); };
A.X = X;

/* ------------------------------------------------------------------ the season on this visit --- */
const dateOfRound = (S, r) => (S.fixtures.find(f => f.r === r) || {}).d;
/* THE FORM BEFORE A ROUND (the fantasy part: real games move the players): his real games from the end of the round
   before (a week before the first) to the moment the round is played - never past its own day */
const formLo = (S, r) => (r > 1 ? Mgr.season.dayEnd(dateOfRound(S, r - 1)) : new Date(Mgr.season.dayStart(dateOfRound(S, r)).getTime() - 7 * 86400000));
const formHi = (S, r, now) => new Date(Math.min(now, Mgr.season.dayEnd(dateOfRound(S, r)).getTime()));
async function formLines(S, rounds, now) {
  const from = formLo(S, rounds[0]).toISOString(), to = formHi(S, rounds[rounds.length - 1], now).toISOString();
  const abroad = [...A.mine.league.entries()].filter(([, l]) => l !== A.lg.L.id).map(([id]) => id);
  try { return await site().formFor(A.lg.L, from, to, abroad); } catch (_) { return new Map(); }
}
function formOfRound(S, r, lines, now) {
  const lo = formLo(S, r).toISOString(), hi = formHi(S, r, now).toISOString(), form = new Map();
  lines.forEach((games, id) => {
    const g = games.filter(x => x.t > lo && x.t <= hi), row = A.rowOf(id);
    if (g.length && row) { const z = Mgr.cards.formOf(row, g); if (z) form.set(id, z); }
  });
  return form;
}
const ctxOf = (form, skip) => { const teams = new Map(); return { X: X(), me: 0, skip, team: i => { if (!teams.has(i)) teams.set(i, A.teamObj(i, form)); return teams.get(i); } }; };
async function catchUp() {
  const S = A.club.state, SE = Mgr.season, now = Date.now();
  /* a live game whose day is over: the assistant plays it out. One that cannot be taken up again (a man of either side no
     longer to hand) is let go, and played from the start below with the clubs as they are - never left unplayed */
  if (S.live && SE.dayEnd(dateOfRound(S, S.live.r)).getTime() <= now) {
    try { await finishLive(); }
    catch (e) { if (root.console) console.warn('Manager: the live game could not be finished; playing it again', e); delete S.live; A._live = null; A.store(LKEY(), null); }
  }
  const due = SE.due(S, now, 0);
  if (!due.length) return;
  A.loading(due.length === 1 ? 'Playing round ' + due[0] + '…' : 'Playing rounds ' + due[0] + '–' + due[due.length - 1] + '…');
  /* the real games of the days before each round: one read for every round to play */
  const lines = await formLines(S, due, now);
  for (const r of due) {
    const form = formOfRound(S, r, lines, now);
    const played = SE.play(S, r, ctxOf(form, f => !!(S.live && S.live.r === r && (f.h === 0 || f.a === 0))));
    played.forEach(({ f, g, error }) => {
      if (g && (f.h === 0 || f.a === 0)) A.news.push(newsOf(r, f, g, form));
      if (error && root.console) console.warn('Manager: round ' + r + ', ' + f.h + ' v ' + f.a + ' not played:', error);
    });
    /* the reader's own game left unplayed (the squad's men could not all be read just now: a league file that did not
       load): said so, and played on the next visit - never silently missing */
    const mine = S.fixtures.find(f => f.r === r && (f.h === 0 || f.a === 0));
    if (mine && mine.res == null && !(S.live && S.live.r === r)) A.toast('Your round ' + r + ' game could not be played just now (your squad could not be read in full). It will be played on your next visit.', true);
    await new Promise(res => setTimeout(res, 0));     // a breath for the page between rounds
  }
  await saveSeason();
}
function newsOf(r, f, g, form) {
  const home = f.h === 0, us = home ? g.pts[0] : g.pts[1], them = home ? g.pts[1] : g.pts[0], opp = home ? f.a : f.h;
  const box = g.box[home ? 0 : 1].slice().sort((a, b) => b.pts - a.pts)[0];
  const hot = box && form && form.get && form.get(box.id) > 0.8;
  return { r, d: f.d, won: us > them, us, them, opp, home, ot: g.ot, top: box ? { id: box.id, pts: box.pts, reb: box.reb, ast: box.ast, hot } : null };
}

/* ------------------------------------------------------------------ the reader's game: live, or to the result --- */
/* MATCH DAY (Louie, 2026-10-14): the reader plays their game when they like on its day - live, managing it (views/match.js),
   or straight to the result. Started, the round's other games are played with it (their results come out with the
   game's), and the game in hand is kept (S.live: the match's snapshot, each side's plan and form as they were at
   tip-off) so it can be left and taken up again that day; the day over, the assistant plays it out. */
const LKEY = () => 'mgr_live_' + (A.club && A.club.id);
A.matchday = () => { const S = A.club && A.club.state; return S && A.club.status === 'active' ? Mgr.season.matchday(S, Date.now(), 0) : null; };
A.liveGame = () => { const S = A.club && A.club.state; return S && S.live && !S.live.done ? S.live : null; };
/* the plan a side carries into the game (kept, so a game taken up again plays the same men the same way) */
const planOf = T => ({ id: T.id, segs: T.segs.map(x => ({ t0: x.t0, t1: x.t1, ids: x.ids.slice(), tac: x.tac || null })), identity: T.identity || null, bench: T.bench || null });
function liveTeams(S) {
  const lv = S.live, f = S.fixtures.find(x => x.r === lv.r && (x.h === 0 || x.a === 0)), form = new Map(lv.form || []);
  const build = (i, plan) => {
    const base = A.teamObj(i, form);
    return Object.assign({}, base, { segs: plan.segs, identity: plan.identity, bench: (plan.bench || base.bench || []).filter(id => base.cards.has(id)) });
  };
  return { f, H: build(f.h, lv.plan.h), A: build(f.a, lv.plan.a), form };
}
/* the game in hand as it was last kept: the newer of this browser's copy and the saved one */
A.liveSnap = () => {
  const lv = A.liveGame();
  if (!lv) return null;
  let snap = lv.snap;
  try { const loc = JSON.parse(A.stored(LKEY()) || 'null'); if (loc && loc.r === lv.r && loc.snap && (!snap || loc.snap.g.k > snap.g.k || (loc.snap.g.k === snap.g.k && loc.snap.log.length > snap.log.length))) snap = loc.snap; } catch (_) { /* the saved one */ }
  return snap || null;
};
/* the game in hand, from its snapshot */
A.liveMatch = () => {
  const S = A.club.state, lv = A.liveGame();
  if (!lv) return null;
  if (A._live && A._live.r === lv.r && A._live.club === A.club.id) return A._live.M;
  const snap = A.liveSnap();
  const t = liveTeams(S);
  const M = snap ? Mgr.match.restore(snap, t.H, t.A, X()) : Mgr.match.create(t.H, t.A, X(), { seed: Mgr.season.gameSeed(S, lv.r, t.f), home: 1 });
  A._live = { r: lv.r, club: A.club.id, M, f: t.f, form: t.form };
  return M;
};
/* kept: in this browser every time it is asked, in the season (the database) when `hard` */
A.keepLive = async hard => {
  const S = A.club.state, lv = A.liveGame();
  if (!lv || !A._live) return;
  const snap = Mgr.match.snapshot(A._live.M);
  A.store(LKEY(), JSON.stringify({ r: lv.r, snap }));
  if (hard) { lv.snap = snap; try { await site().save(A.club.id, { state: S, summary: Mgr.season.summary(A.view(), 0) }); } catch (_) { /* kept here; saved next time */ } }
};
/* START THE GAME: 'live' (the match screen) or 'quick' (to the result now) */
A.startMatch = async mode => {
  const S = A.club.state, SE = Mgr.season, md = A.matchday();
  if (!md || S.live) return null;
  const r = md.r, f = md.f, now = Date.now();
  A.loading(mode === 'live' ? 'Getting the game ready…' : 'Playing the game…');
  const form = formOfRound(S, r, await formLines(S, [r], now), now);
  /* the round's other games, now */
  const ctx = ctxOf(form, x => x === f);
  SE.play(S, r, ctx);
  const H = ctx.team(f.h), Aw = ctx.team(f.a);
  S.live = { r, started: now, mode, plan: { h: planOf(H), a: planOf(Aw) }, form: [...form.entries()], snap: null };
  A._live = null;
  const M = A.liveMatch();
  if (mode !== 'live') { Mgr.match.finish(M); await A.endLive(); return 'done'; }
  await A.keepLive(true);
  return 'live';
};
/* THE GAME OVER: into the season, the round's results out, the snapshot let go */
A.endLive = async () => {
  const S = A.club.state, lv = A.liveGame();
  if (!lv || !A._live) return;
  const M = A._live.M;
  if (!M.g.over) Mgr.match.finish(M);
  const g = Mgr.match.result(M), f = A._live.f;
  /* when it was played (its box score's tip-off) */
  f.at = new Date(lv.started || Date.now()).toISOString();
  Mgr.season.record(S, f, g, 0);
  A.news.push(newsOf(lv.r, f, g, A._live.form));
  delete S.live;
  A._live = null;
  A.store(LKEY(), null);
  await saveSeason();
};
/* the day over with the game still going: the assistant takes both benches and plays it out */
async function finishLive() {
  const M = A.liveMatch();
  if (!M) return;
  M.sides.forEach(sd => { sd.auto = true; sd.hold = -1; sd.pend = []; });
  Mgr.match.finish(M);
  await A.endLive();
}
A.finishLive = finishLive;
/* THE SEASON AS THE READER MAY SEE IT: the round of a game in hand is left out - its results, until it ends (the round's
   other games are played when it starts; the game's own lines are not in the totals until it is over) */
A.hiddenRound = () => { const lv = A.liveGame(); return lv ? lv.r : null; };
A.view = () => {
  const S = A.club && A.club.state, r = S ? A.hiddenRound() : null;
  if (!S || r == null) return S;
  const out = Object.assign({}, S, { fixtures: S.fixtures.map(f => (f.r === r ? Object.assign({}, f, { res: null, live: true }) : f)) });
  out.played = out.fixtures.filter(f => f.res != null).reduce((a, f) => Math.max(a, f.r), 0);
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
