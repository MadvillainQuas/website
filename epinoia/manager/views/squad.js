'use strict';
/* ============================================================================
   MANAGER - THE SQUAD (#/squad). Before the season: the DRAFT (Louie, 2026-10-09: "a global pool, FM draft-like ...
   budget = the league's average wage x 12 roster spots ... a shortlist; a big expandable list with filters (auto-filtered
   to the user's league, viewable worldwide); a hover card with full season stats (simple plus scouting views) and
   position minutes; a link to the player profile, recoloured blue ... a confirm-squad button bottom right"). After it:
   the squad as it stands, its men's attributes, values and simulated season.

   THE POOL. The home league's players first; the SCOUTING NETWORK adds any other league the reader chooses (Louie: "the
   user selects what leagues to sim to increase the player pool"), each read once from the CDN and priced in its own
   league's range (a man is worth what his league pays). A man may be signed while the squad's wages stay within the
   budget; 8 to 12 men make a squad.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const MAX = 12, MIN = 8, PAGE = 60;
const KEY_ATTRS = [['usg', 'USG'], ['rim', 'RIM'], ['three', '3PT'], ['pass', 'PAS'], ['handle', 'HND'], ['rimp', 'PRT'], ['dreb', 'DRB']];

/* ------------------------------------------------------------------ the pool --- */
const pool = { leagues: new Map(), extra: [] };       // league id -> loaded league; the network the reader added
const listKey = () => 'mgr_net_' + (A.club ? A.club.id : '');
const shortKey = () => 'mgr_short_' + (A.club ? A.club.id : '');
const shortlist = () => { try { return new Set(JSON.parse(A.stored(shortKey()) || '[]')); } catch (_) { return new Set(); } };
const saveShort = s => A.store(shortKey(), JSON.stringify([...s]));
async function network() {
  pool.leagues.set(A.lg.L.id, A.lg);
  let ids = [];
  try { ids = JSON.parse(A.stored(listKey()) || '[]'); } catch (_) { ids = []; }
  for (const id of ids) { try { const L = await A.loadLeagueFor(id); if (L) pool.leagues.set(id, L); } catch (_) { /* a league that cannot be read today is left out */ } }
}
/* every pooled man, with what the list and the card need */
function entries() {
  const out = [];
  pool.leagues.forEach((L, lid) => L.rows.forEach(r => {
    const id = String(r.playerId), row = L.byId.get(id), price = L.priced.get(id);
    if (!row || !price || !(row.min > 0)) return;
    const share = L.share.get(id) || Mgr.cards.shareOf(row);
    out.push({ id, lid, L, row, named: r, price, attrs: L.attrs.get(id) || {}, slot: A.slotIn(L, id, share), share,
      mpg: row.gp ? row.min / row.gp : 0, ppg: row.gp ? row.pts / row.gp : 0 });
  }));
  return out;
}

/* ------------------------------------------------------------------ the player card --- */
function card(e, anchor) {
  root.document.querySelectorAll('.mg-card').forEach(c => c.remove());
  const r = e.row, g = Math.max(1, r.gp || 1), at = e.attrs || {};
  const tabs = h('div.mg-tabs', { role: 'group', 'aria-label': 'Simple or scouting' });
  const body = h('div');
  const simple = () => h('div.mg-statgrid', [['MPG', r.min / g], ['PPG', r.pts / g], ['RPG', (r.reb || 0) / g], ['APG', (r.ast || 0) / g], ['SPG', (r.stl || 0) / g], ['BPG', (r.blk || 0) / g],
    ['TOPG', (r.tov || 0) / g], ['GP', r.gp, 0], ['FG%', r.fg_pct], ['3P%', r.p3_pct], ['FT%', r.ft_pct], ['TS%', r.ts]].map(([k, v, d]) => h('div.s', h('b', A.fmt(+v, d)), h('span', k))));
  const scout = () => h('div.mg-statgrid', [['USG%', r.usg], ['AST%', r.ast_pct], ['TOV%', r.tov_pct], ['AST/USG', r.au, 2], ['ORB%', r.oreb_pct], ['DRB%', r.dreb_pct], ['STL%', r.stl_pct], ['BLK%', r.blk_pct],
    ['Rim rate', r.rim_rate], ['Rim FG%', r.rim_pct], ['3PA rate', r.p3_rate], ['Unast. pts', r.ev_unast_pts_sh], ['Rim /100', r.rim_a100], ['3PA /100', r.p3_a100], ['On/off net', r.diff_net], ['BPM', r.bpm]]
    .map(([k, v, d]) => h('div.s', h('b', A.fmt(+v, d)), h('span', k))));
  const put = k => { body.textContent = ''; body.appendChild(k === 'scout' ? scout() : simple()); tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k))); };
  [['simple', 'Simple'], ['scout', 'Scouting']].forEach(([k, l]) => tabs.appendChild(h('button', { type: 'button', 'data-k': k, onclick: () => put(k) }, l)));
  const tot = e.share.reduce((a, v) => a + v, 0) || 1;
  const posm = h('div.mg-posmins', { 'data-i18n-ctx': 'pos' }, A.SLOTS.map((s, k) => h('div.c', h('i', { style: { height: Math.max(3, Math.round(56 * e.share[k] / tot)) + 'px' } }), h('b', s), h('span', Math.round(100 * e.share[k] / tot) + '%'))));
  const attrs = h('div.mg-attrs', Mgr.ratings.ATTRS.map(a => h('div.row', h('span', a.label), A.attrChip(at[a.k]))));
  const c = h('div.mg-card', { role: 'dialog', 'aria-label': e.named.name || 'Player' },
    h('button.close', { type: 'button', 'aria-label': 'Close', onclick: () => c.remove() }, '×'),
    h('div.hd', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.SLOTS[e.slot]), h('div.t', A.nm(e.named.name, 'b'), h('span', A.nm(e.named.teamName || ''), ' · ', A.nm(e.L.L.name)))),
    h('div.money', h('span', 'Value ', h('b', A.money(e.price.value))), h('span', 'Wage ', h('b', A.money(e.price.wage))),
      e.price.boost > 0 ? h('span.mg-chip.royal', 'Continental +' + Math.round(100 * e.price.boost) + '%') : null),
    h('div.sec', h('span.mg-cap', 'Attributes'), attrs),
    h('div.sec', h('span.mg-cap', 'Minutes at each position'), posm),
    h('div.sec', h('div.mg-row.between', h('span.mg-cap', 'Season'), tabs), body),
    h('div.mg-row', h('a.mg-profile', { href: '#/player/' + encodeURIComponent(e.id) + '?l=' + encodeURIComponent(e.lid), onclick: () => c.remove() }, 'Manager profile →'),
      h('a.mg-profile', { href: '../p/?p=' + encodeURIComponent(e.id), target: '_blank', rel: 'noopener' }, 'EPINOIA profile ↗')));
  put('simple');
  root.document.body.appendChild(c);
  A.place(c, anchor);
  const off = ev => { if (!c.contains(ev.target) && ev.target !== anchor) { c.remove(); root.document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => root.document.addEventListener('pointerdown', off, true), 0);
  const esc = ev => { if (ev.key === 'Escape') { c.remove(); root.document.removeEventListener('keydown', esc); } };
  root.document.addEventListener('keydown', esc);
}
A.playerCard = (id, lid, anchor) => {
  const L = (lid && pool.leagues.get(lid)) || A.leagueDataOf(id);
  const row = L && L.byId.get(String(id)), named = L && L.named.get(String(id)), price = L && L.priced.get(String(id));
  if (!row || !named || !price) return;
  const share = L.share.get(String(id)) || Mgr.cards.shareOf(row);
  card({ id: String(id), lid: L.L.id, L, row, named, price, attrs: L.attrs.get(String(id)) || {}, slot: A.slotIn(L, id, share), share }, anchor);
};

/* ------------------------------------------------------------------ the draft --- */
async function draft(host) {
  A.loading('Opening the scouting network…', host);
  await network();
  const budget = A.club.budget || A.lg.budget;
  let roster = (A.club.roster || []).slice();
  /* every signing and release kept at once (another screen, or a reload, loses nothing): in this browser until the
     squad is confirmed (app.js A.save) */
  const keep = () => { A.save({ roster: roster.slice() }).catch(() => {}); A.reloadMine().catch(() => {}); };
  const st = { q: '', pos: -1, lid: 'all', sort: 'value', dir: -1, afford: false, shortOnly: false, shown: PAGE };
  let list = entries();
  host.textContent = '';
  const used = () => roster.reduce((a, e) => a + (e.wage || 0), 0);
  const has = id => roster.some(e => String(e.id) === String(id));

  /* the head */
  const tacBtn = h('a.mg-btn', { href: '#/tactics' }, 'Lineups and tactics →');
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Build your squad'),
    h('div.meta', h('span', 'Budget ', h('b', A.money(budget))), h('span', 'The league’s average wage × 12'), h('span', MIN + '–' + MAX + ' players'))), h('div.grow'), tacBtn));
  const wrap = h('div.mg-builder'), left = h('div.mg-panel.pool'), right = h('div.mg-panel.glow.squad');
  wrap.appendChild(left); wrap.appendChild(right); host.appendChild(wrap);

  /* the filters */
  const search = h('input.mg-in', { type: 'search', placeholder: 'Search a player or a club', 'aria-label': 'Search' });
  const posSel = h('select.mg-in', { 'aria-label': 'Position' }, h('option', { value: '-1' }, 'Every position'), A.SLOTS.map((s, k) => h('option', { value: String(k) }, s)));
  const lgSel = h('select.mg-in', { 'aria-label': 'League' });
  const fillLeagues = () => {
    lgSel.textContent = '';
    lgSel.appendChild(h('option', { value: 'all' }, 'Every scouted league'));
    pool.leagues.forEach((L, id) => lgSel.appendChild(h('option', { value: id, translate: 'no' }, L.L.name)));
    lgSel.value = pool.leagues.has(st.lid) ? st.lid : 'all';
  };
  fillLeagues();
  const sortSel = h('select.mg-in', { 'aria-label': 'Sort by' }, [['value', 'Value'], ['wage', 'Wage'], ['ppg', 'Points a game'], ['mpg', 'Minutes a game']]
    .concat(KEY_ATTRS.map(([k, l]) => ['a:' + k, l + ' attribute'])).map(([v, l]) => h('option', { value: v }, l)));
  const afford = h('label.mg-chip', h('input', { type: 'checkbox', onchange: e => { st.afford = e.target.checked; draw(); } }), 'Affordable now');
  const shortT = h('label.mg-chip', h('input', { type: 'checkbox', onchange: e => { st.shortOnly = e.target.checked; draw(); } }), '★ Shortlist');
  const netBtn = h('button.mg-btn', { type: 'button', onclick: () => pickLeague() }, '+ Scout another league');
  left.appendChild(h('div.mg-h', h('h2', 'Players'), h('span.mg-sub', 'Press a name for his card')));
  left.appendChild(h('div.filters', search, posSel, lgSel, sortSel, afford, shortT, netBtn));
  const tableHost = h('div'), more = h('div.mg-more');
  left.appendChild(tableHost); left.appendChild(more);
  search.addEventListener('input', () => { st.q = search.value.trim().toLowerCase(); st.shown = PAGE; draw(); });
  posSel.addEventListener('change', () => { st.pos = +posSel.value; st.shown = PAGE; draw(); });
  lgSel.addEventListener('change', () => { st.lid = lgSel.value; st.shown = PAGE; draw(); });
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; draw(); });

  function draw() {
    const short = shortlist(), room = budget - used();
    const val = e => st.sort === 'value' ? e.price.value : st.sort === 'wage' ? e.price.wage : st.sort === 'ppg' ? e.ppg : st.sort === 'mpg' ? e.mpg
      : st.sort.startsWith('a:') ? (e.attrs[st.sort.slice(2)] || 0) : 0;
    const rows = list.filter(e => (st.lid === 'all' || e.lid === st.lid) && (st.pos < 0 || e.slot === st.pos) && (!st.afford || e.price.wage <= room)
      && (!st.shortOnly || short.has(e.id))
      && (!st.q || String(e.named.name || '').toLowerCase().includes(st.q) || String(e.named.teamName || '').toLowerCase().includes(st.q)))
      .sort((a, b) => st.dir * (val(a) - val(b)) || (b.price.value - a.price.value));
    tableHost.textContent = '';
    const t = h('table.mg-table');
    t.appendChild(h('thead', h('tr', h('th.l', { colspan: '2' }, 'Player'), h('th', 'Pos'), h('th', 'MPG'), h('th', 'PPG'), KEY_ATTRS.map(([, l]) => h('th', l)), h('th', 'Value'), h('th', 'Wage'), h('th', ''))));
    const tb = h('tbody');
    rows.slice(0, st.shown).forEach(e => {
      const star = h('button.mg-star', { type: 'button', 'aria-pressed': String(short.has(e.id)), 'aria-label': 'Shortlist', onclick: () => {
        const s = shortlist(); if (s.has(e.id)) s.delete(e.id); else s.add(e.id); saveShort(s); star.setAttribute('aria-pressed', String(s.has(e.id)));
      } }, '★');
      const nameBtn = h('button.rowbtn', { type: 'button', onclick: ev => card(e, ev.currentTarget) }, h('div.who', h('div', A.nm(e.named.name, 'b'), h('br'), h('span', A.nm(e.named.teamName || ''), e.lid !== A.lg.L.id ? ' · ' : '', e.lid !== A.lg.L.id ? A.nm(e.L.L.name) : ''))));
      const inS = has(e.id), afford = e.price.wage <= room;
      const add = h('button.mg-add' + (inS ? '.on' : ''), { type: 'button', disabled: !inS && (!afford || roster.length >= MAX) ? true : null,
        title: inS ? 'In your squad' : !afford ? 'Over your budget' : roster.length >= MAX ? 'Your squad is full' : 'Sign', onclick: () => toggle(e) }, inS ? '✓' : '+ Sign');
      tb.appendChild(h('tr', h('td', star), h('td.l', nameBtn), h('td', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.SLOTS[e.slot])), h('td', A.fmt(e.mpg)), h('td', A.fmt(e.ppg)),
        KEY_ATTRS.map(([k]) => h('td', A.attrChip(e.attrs[k]))), h('td', A.money(e.price.value)), h('td', A.money(e.price.wage)), h('td', add)));
    });
    t.appendChild(tb);
    tableHost.appendChild(h('div.mg-tablewrap', t));
    more.textContent = '';
    if (rows.length > st.shown) more.appendChild(h('button.mg-btn', { type: 'button', onclick: () => { st.shown += PAGE; draw(); } }, 'Show more (' + (rows.length - st.shown) + ')'));
    if (!rows.length) tableHost.appendChild(h('p.mg-sub', 'Nobody fits these filters.'));
    drawSquad();
  }
  function toggle(e) {
    if (has(e.id)) roster = roster.filter(x => String(x.id) !== e.id);
    else {
      if (roster.length >= MAX) return A.toast('Your squad is full: twelve players.', true);
      if (used() + e.price.wage > budget) return A.toast('Over your budget.', true);
      roster.push({ id: e.id, league: e.lid, value: e.price.value, wage: e.price.wage, slot: e.slot });
    }
    keep();
    draw();
  }

  /* the squad and its budget */
  const confirm = h('button.mg-btn.primary.big.mg-confirm', { type: 'button' }, 'Confirm squad');
  root.document.body.appendChild(confirm);
  root.addEventListener('hashchange', function off() { confirm.remove(); root.removeEventListener('hashchange', off); });
  function drawSquad() {
    right.textContent = '';
    const u = used(), over = u > budget;
    right.appendChild(h('div.mg-h', h('h3', 'Your squad'), h('span.mg-sub', roster.length + ' of ' + MAX)));
    right.appendChild(h('div.mg-budget' + (over ? '.over' : ''), h('div.line', h('span', 'Wages ', h('b', A.money(u))), h('span', 'Budget ', h('b', A.money(budget)))),
      h('div.mg-bar', h('i', { style: { width: Math.min(100, 100 * u / budget) + '%' } })), h('div.line', h('span', 'Left'), h('b', A.money(budget - u)))));
    const ul = h('ul.mg-slots');
    const bySlot = roster.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
    for (let i = 0; i < MAX; i++) {
      const e = bySlot[i];
      if (!e) { ul.appendChild(h('li.empty', i < MIN ? 'A squad needs at least ' + MIN : 'Open')); continue; }
      const L = pool.leagues.get(e.league) || A.lg, named = L.named.get(String(e.id)) || {};
      ul.appendChild(h('li', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.SLOTS[e.slot || 0]), h('button.rowbtn.nm', { type: 'button', onclick: ev => A.playerCard(e.id, e.league, ev.currentTarget) }, A.nm(named.name || 'Player')),
        h('span.mg-sub', A.money(e.wage)), h('button.x', { type: 'button', 'aria-label': 'Release', onclick: () => { roster = roster.filter(x => x !== e); keep(); draw(); } }, '×')));
    }
    right.appendChild(ul);
    const counts = A.SLOTS.map((_, k) => roster.filter(e => e.slot === k).length);
    right.appendChild(h('div.mg-row', { style: { marginTop: '12px' } }, A.SLOTS.map((s, k) => h('span.mg-chip' + (counts[k] ? '' : '.bad'), s + ' ' + counts[k]))));
    const ok = roster.length >= MIN && roster.length <= MAX && !over;
    tacBtn.classList.toggle('off', roster.length < 5);
    tacBtn.title = roster.length < 5 ? 'Sign five players to set your lineups' : '';
    confirm.disabled = !ok;
    confirm.title = ok ? '' : roster.length < MIN ? 'At least ' + MIN + ' players' : 'Over your budget';
  }
  confirm.addEventListener('click', async () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try {
      const state = await A.confirmSquad({ roster: roster.slice(), budget });
      confirm.remove();
      A.toast('Squad confirmed. Your first game: ' + new Date(state.fixtures[0].d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + '.');
      A.go('/tactics');
    } catch (e) {
      confirm.disabled = false;
      const m = String(e && e.message || e);
      A.toast(/three clubs/.test(m) ? 'You already have three clubs: delete one in its settings first.'
        : /club name|manager name/.test(m) ? 'One of the names is not allowed: change it in Club settings.' : 'The squad could not be saved: ' + m, true);
    }
  });

  /* the scouting network: another league into the pool */
  async function pickLeague() {
    const every = await Mgr.site.leagues(), C = root.EpinoiaCountry;
    const dlg = h('div.mg-card', { role: 'dialog', 'aria-label': 'Scout another league', style: { left: '50%', top: '10vh', transform: 'translateX(-50%)' } });
    dlg.appendChild(h('button.close', { type: 'button', 'aria-label': 'Close', onclick: () => dlg.remove() }, '×'));
    dlg.appendChild(h('div.mg-h', h('h3', 'Scout another league'), h('span.mg-sub', 'Its players join the pool, valued in their own league')));
    const q = h('input.mg-in', { type: 'search', placeholder: 'Search a league or a country' });
    const out = h('div', { style: { marginTop: '10px', maxHeight: '50vh', overflowY: 'auto' } });
    const fill = () => {
      out.textContent = '';
      const t = q.value.trim().toLowerCase();
      const groups = C ? C.group(every) : [{ name: '', leagues: every }];
      groups.forEach(g => {
        const ls = g.leagues.filter(L => !pool.leagues.has(L.id) && (!t || L.name.toLowerCase().includes(t) || String(g.name).toLowerCase().includes(t)));
        if (!ls.length) return;
        out.appendChild(h('div.mg-cap', { style: { margin: '10px 0 6px' } }, (g.flag || '') + ' ' + g.name));
        ls.forEach(L => out.appendChild(h('button.mg-btn.ghost', { type: 'button', style: { width: '100%', justifyContent: 'space-between', marginBottom: '4px' }, onclick: async ev => {
          ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Reading…';
          try {
            const loaded = await A.loadLeagueFor(L.id);
            pool.leagues.set(L.id, loaded);
            let ids = []; try { ids = JSON.parse(A.stored(listKey()) || '[]'); } catch (_) { ids = []; }
            if (!ids.includes(L.id)) ids.push(L.id);
            A.store(listKey(), JSON.stringify(ids));
            list = entries();
            fillLeagues(); dlg.remove(); draw();
            A.toast(L.name + ' added to your scouting network.');
          } catch (_) { A.toast(L.name + ' could not be read just now.', true); }
        } }, A.nm(L.name), h('span.mg-sub', L.seasonName || ''))));
      });
    };
    q.addEventListener('input', fill);
    dlg.appendChild(q); dlg.appendChild(out);
    root.document.body.appendChild(dlg);
    fill(); q.focus();
  }
  draw();
}

/* ------------------------------------------------------------------ the squad, after the draft --- */
function squadView(host) {
  const S = A.club.state, roster = A.club.roster || [];
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Squad'), h('div.meta', h('span', roster.length + ' players'),
    h('span', 'Wages ', h('b', A.money(roster.reduce((a, e) => a + (e.wage || 0), 0))), ' of ', A.money(A.club.budget || 0)))), h('div.grow'),
    h('a.mg-btn.primary', { href: '#/trade' }, 'Trade a player')));
  const t = h('table.mg-table');
  t.appendChild(h('thead', h('tr', h('th.l', 'Player'), h('th', 'Pos'), Mgr.ratings.ATTRS.map(a => h('th', { title: a.label }, a.short || a.label)), h('th', 'GP'), h('th', 'MIN'), h('th', 'PTS'), h('th', 'REB'), h('th', 'AST'), h('th', 'Wage'))));
  const tb = h('tbody');
  roster.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0)).forEach(e => {
    const at = A.attrs(e.id) || {}, line = S ? Mgr.season.lineOf(S, e.id) : null, g = line ? Math.max(1, line.gp) : 1;
    tb.appendChild(h('tr', h('td.l', h('button.rowbtn', { type: 'button', onclick: ev => A.playerCard(e.id, e.league, ev.currentTarget) }, A.nm(A.nameOf(e.id), 'b'))),
      h('td', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(e.id))), Mgr.ratings.ATTRS.map(a => h('td', A.attrChip(at[a.k]))),
      h('td', line ? String(line.gp) : '0'), h('td', line ? A.fmt(line.min / g) : '–'), h('td', line ? A.fmt(line.pts / g) : '–'),
      h('td', line ? A.fmt((line.oreb + line.dreb) / g) : '–'), h('td', line ? A.fmt(line.ast / g) : '–'), h('td', A.money(e.wage))));
  });
  t.appendChild(tb);
  host.appendChild(h('div.mg-panel', h('div.mg-tablewrap', t), h('p.mg-sub', { style: { marginTop: '10px' } },
    'Attributes are for reading a player at a glance (1-20 against his league, moved by its level). The games themselves run on the players’ own numbers.')));
}

A.views.squad = { render: async host => { if (A.club.status === 'draft') return draft(host); squadView(host); } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
