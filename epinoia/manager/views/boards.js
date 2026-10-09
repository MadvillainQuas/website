'use strict';
/* ============================================================================
   MANAGER - THE LEADERBOARDS (#/boards) AND THE CLUB'S SETTINGS (#/settings).

   THE BOARDS (Louie, 2026-10-09: "First priority is to get an individual mode up and running, with full global
   leaderboard"): every club that has played, everybody's or a league's, ranked by its winning share, then its points
   difference a game (0259 manager_leaderboard). A club's own names and badge only (chosen for the game; never the
   account behind it). The uploaded badge images come on their own, a board's at once (manager_badges), so the board
   itself stays small. Open to everyone, signed in or not.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;

async function boards(host) {
  host.appendChild(h('div.mg-top', h('div.who', h('h1', 'Leaderboards'), h('div.meta', h('span', 'Every manager’s club, ranked by winning share, then points difference a game')))));
  const tabs = h('div.mg-tabs', { role: 'group' }), sel = h('select.mg-in', { 'aria-label': 'League', style: { width: 'auto' } }), body = h('div');
  host.appendChild(h('div.mg-panel', h('div.mg-h', tabs, sel), body));
  let league = A.route.q && A.route.q.get('l') ? A.route.q.get('l') : null;
  let lgs = [];
  try { lgs = await Mgr.site.boardLeagues(); } catch (_) { lgs = []; }
  sel.appendChild(h('option', { value: '' }, 'A league…'));
  lgs.forEach(l => sel.appendChild(h('option', { value: l.league_id, translate: 'no' }, l.league + ' (' + l.clubs + ')')));
  const mark = () => { tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.k === 'all') === !league))); sel.value = league || ''; };
  tabs.appendChild(h('button', { type: 'button', 'data-k': 'all', onclick: () => { league = null; mark(); draw(); } }, 'Everyone'));
  if (A.lg) tabs.appendChild(h('button', { type: 'button', 'data-k': 'mine', onclick: () => { league = A.lg.L.id; mark(); draw(); } }, h('span', { translate: 'no' }, A.lg.L.name)));
  sel.addEventListener('change', () => { league = sel.value || null; mark(); draw(); });
  async function draw() {
    body.textContent = '';
    A.loading('Reading the board…', body);
    let rows = [];
    try { rows = await Mgr.site.board(league, 200); }
    catch (e) { body.textContent = ''; body.appendChild(h('p.mg-sub', e && e.code === 'missing' ? 'The leaderboards open as soon as the first clubs have played.' : 'The board could not be read just now.')); return; }
    body.textContent = '';
    if (!rows.length) { body.appendChild(h('p.mg-sub', 'Nobody is on this board yet: confirm a squad and play a round to be the first.')); return; }
    const t = h('table.mg-table.mg-board', h('thead', h('tr', h('th', '#'), h('th.l', 'Club'), h('th.l', 'League'), h('th', 'W'), h('th', 'L'), h('th', 'PCT'), h('th', '+/− a game'), h('th', 'Place'), h('th', 'Played'))));
    const tb = h('tbody'), slots = new Map();
    rows.forEach(r => {
      const badge = h('span');
      badge.appendChild(A.badge(r.badge, 30));
      if (r.has_img) slots.set(r.id, { el: badge, b: r.badge });
      tb.appendChild(h('tr' + (r.me ? '.me' : '') + (r.rank <= 3 ? '.r' + r.rank : ''), h('td', h('span.rank', String(r.rank))),
        h('td.l', h('div.who', badge, h('div', A.nm(r.name, 'b'), h('br'), h('span', A.nm(r.manager))))), h('td.l', A.nm(r.league)),
        h('td', String(r.w)), h('td', String(r.l)), h('td', (+r.pct).toFixed(3).replace(/^0/, '')), h('td', (+r.diff >= 0 ? '+' : '') + (+r.diff).toFixed(1)),
        h('td', r.pos ? r.pos + ' / ' + r.of_n : '–'), h('td', r.played + (r.rounds ? ' / ' + r.rounds : ''))));
    });
    t.appendChild(tb);
    body.appendChild(h('div.mg-tablewrap', t));
    /* the uploaded badges, after the board */
    if (slots.size) {
      try {
        (await Mgr.site.badges([...slots.keys()])).forEach(x => { const s = slots.get(x.id); if (s && x.img) { s.el.textContent = ''; s.el.appendChild(A.badge(Object.assign({}, s.b, { img: x.img }), 30)); } });
      } catch (_) { /* the drawings stand */ }
    }
  }
  mark(); draw();
}

/* ------------------------------------------------------------------ the club's settings --- */
function settings(host) {
  if (!A.club) { A.go('/new'); return; }
  const c = A.club;
  host.appendChild(h('div.mg-top', A.badge(c.badge, 56), h('div.who', h('h1', 'Club settings'), h('div.meta', A.nm(c.name), ' · ', A.nm(A.lg ? A.lg.L.name : '')))));
  const grid = h('div.mg-grid.c2');
  host.appendChild(grid);
  /* the names */
  const nameIn = h('input.mg-in', { value: c.name, maxlength: '28' }), mgrIn = h('input.mg-in', { value: c.manager, maxlength: '28' }), err = h('p.mg-err', { 'aria-live': 'polite' });
  const saveNames = h('button.mg-btn.primary', { type: 'button', onclick: async () => {
    const n = Mgr.names.clean(nameIn.value), m = Mgr.names.clean(mgrIn.value), a = Mgr.names.check(n), b = Mgr.names.check(m);
    if (a || b) { err.textContent = (a ? 'Club name: ' + a : 'Manager name: ' + b) + '.'; return; }
    err.textContent = '';
    try { await A.save({ name: n, manager: m }); A.toast('Saved.'); A.go('/settings'); } catch (e) { err.textContent = String(e && e.message || e); }
  } }, 'Save the names');
  grid.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Names')), h('div.mg-stack', h('label.mg-lab', 'Club', nameIn), h('label.mg-lab', 'Manager', mgrIn), err, h('div', saveNames))));
  /* the badge: the maker's own options, in place */
  let b = Mgr.badge.sanitise(c.badge);
  const pv = h('div', { style: { display: 'grid', placeItems: 'center', padding: '8px' } });
  const draw = () => { pv.textContent = ''; pv.appendChild(A.badge(b, 120)); };
  const opt = (label, list, key) => {
    const s = h('select.mg-in', { 'aria-label': label });
    list.forEach(v => s.appendChild(h('option', { value: v, selected: b[key] === v ? true : null }, v)));
    s.addEventListener('change', () => { b = Mgr.badge.sanitise(Object.assign({}, b, { [key]: s.value })); draw(); });
    return h('label.mg-lab', label, s);
  };
  const col = k => { const i = h('input', { type: 'color', value: b[k], style: { width: '48px', height: '34px', border: '0', background: 'none' } }); i.addEventListener('input', () => { b = Mgr.badge.sanitise(Object.assign({}, b, { [k]: i.value })); draw(); }); return i; };
  const txt = h('input.mg-in', { value: b.text, maxlength: '3', style: { width: '90px' } });
  txt.addEventListener('input', () => { b = Mgr.badge.sanitise(Object.assign({}, b, { text: txt.value })); draw(); });
  grid.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Badge')), pv, h('div.mg-grid.c3', opt('Shape', Mgr.badge.SHAPES, 'shape'), opt('Pattern', Mgr.badge.PATTERNS, 'pattern'), opt('Emblem', Mgr.badge.EMBLEMS, 'emblem')),
    h('div.mg-row', { style: { marginTop: '10px' } }, col('c1'), col('c2'), col('c3'), txt, h('button.mg-btn.primary', { type: 'button', onclick: async () => {
      try { await A.save({ badge: b }); A.toast('Badge saved.'); A.go('/settings'); } catch (e) { A.toast(String(e && e.message || e), true); }
    } }, 'Save the badge'))));
  draw();
  /* the end of the club */
  const del = h('button.mg-btn.danger', { type: 'button', onclick: async () => {
    if (!root.confirm('Delete ' + c.name + ' for good? Its squad, its season and its place on the leaderboards go with it.')) return;
    try {
      await Mgr.site.remove(c.id);
      A.clubs = await Mgr.site.clubs();
      A.club = null; A.lg = null; A.store('mgr_club', null);
      if (A.clubs.length) await A.openClub(A.clubs[A.clubs.length - 1]);
      A.go(A.clubs.length ? '/' : '/new');
    } catch (e) { A.toast('Could not delete it: ' + (e && e.message || e), true); }
  } }, 'Delete this club');
  host.appendChild(h('div.mg-panel', { style: { marginTop: '16px' } }, h('div.mg-h', h('h3', 'The club')), h('p.mg-sub', 'You can keep up to three clubs.'), h('div.mg-row', del,
    A.clubs.length < 3 ? h('a.mg-btn', { href: '#/new' }, 'Start another club') : null)));
}

A.views.boards = { render: boards };
A.views.settings = { render: settings };
})(typeof globalThis !== 'undefined' ? globalThis : self);
