'use strict';
/* ============================================================================
   MANAGER - THE TRADE (#/trade). Louie, 2026-10-09: "if the user has more budget they can trade for higher value - just
   needs to be in budget. Also please create a trade screen that shows the stats of each individual in a cool, stylish
   manner (with the same dropdowns as comparison to make it easy to select)".

   One of the squad's men out (or an open spot, with fewer than twelve), any player of any league in: the profile's
   compare picker's way - a league, a club, a player - and the two side by side, every attribute and every number mirrored
   on one line. It goes through when the squad's wages stay within its budget. The man traded in leaves his real club's
   rotation in this league (if he plays in it); the man traded out goes back to his.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const OPEN = '__open';
const LINES = [
  ['Points', r => r.pts / r.gp], ['Rebounds', r => (r.reb || 0) / r.gp], ['Assists', r => (r.ast || 0) / r.gp], ['Steals', r => (r.stl || 0) / r.gp], ['Blocks', r => (r.blk || 0) / r.gp],
  ['Minutes', r => r.min / r.gp], ['TS%', r => r.ts], ['3P%', r => r.p3_pct], ['USG%', r => r.usg], ['AST%', r => r.ast_pct], ['DRB%', r => r.dreb_pct], ['BLK%', r => r.blk_pct]];

async function render(host) {
  const q = A.route.q || new URLSearchParams();
  const roster = (A.club.roster || []).slice();
  const st = { out: q.get('out') || (roster[0] ? String(roster[0].id) : OPEN), lid: q.get('l') || A.lg.L.id, club: '', inId: q.get('in') || '' };
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Trade'), h('div.meta', h('span', 'Any player of any league, as long as your wages stay within your budget')))));
  const grid = h('div.mg-trade'), left = h('div.mg-panel.mg-tside'), right = h('div.mg-panel.glow.mg-tside');
  grid.appendChild(left); grid.appendChild(h('div.swap', { 'aria-hidden': 'true' }, '⇄')); grid.appendChild(right);
  host.appendChild(grid);
  const vs = h('div.mg-panel', { style: { marginTop: '16px' } }), act = h('div.mg-panel.glow', { style: { marginTop: '16px' } });
  host.appendChild(vs); host.appendChild(act);

  /* ---- out: one of the squad ---- */
  const outSel = h('select.mg-in', { 'aria-label': 'Your player' });
  roster.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0)).forEach(e => outSel.appendChild(h('option', { value: String(e.id), translate: 'no' }, A.SLOTS[e.slot || 0] + ' · ' + A.nameOf(e.id))));
  if (roster.length < 12) outSel.appendChild(h('option', { value: OPEN }, 'An open spot (' + (12 - roster.length) + ' free)'));
  outSel.value = st.out;
  outSel.addEventListener('change', () => { st.out = outSel.value; drawOut(); compare(); });
  const outCard = h('div');
  left.appendChild(h('div.mg-cap', { style: { marginBottom: '8px' } }, 'Out'));
  left.appendChild(h('div.pick', { style: { gridTemplateColumns: '1fr' } }, outSel));
  left.appendChild(outCard);

  /* ---- in: the compare picker's dropdowns, a league, a club, a player ---- */
  const lgSel = h('select.mg-in', { 'aria-label': 'League' }), clSel = h('select.mg-in', { 'aria-label': 'Club' }), plSel = h('select.mg-in', { 'aria-label': 'Player', style: { gridColumn: '1 / -1' } });
  const inCard = h('div');
  right.appendChild(h('div.mg-cap', { style: { marginBottom: '8px' } }, 'In'));
  right.appendChild(h('div.pick', lgSel, clSel, plSel));
  right.appendChild(inCard);
  const leagues = await Mgr.site.leagues(), C = root.EpinoiaCountry;
  const groups = C ? C.group(leagues) : [{ name: '', leagues }];
  groups.forEach(g => { const og = h('optgroup', { label: (g.flag ? g.flag + ' ' : '') + g.name }); g.leagues.forEach(L => og.appendChild(h('option', { value: L.id, translate: 'no' }, L.name))); lgSel.appendChild(og); });
  lgSel.value = st.lid;
  lgSel.addEventListener('change', () => { st.lid = lgSel.value; st.club = ''; st.inId = ''; loadLeague(); });
  clSel.addEventListener('change', () => { st.club = clSel.value; st.inId = ''; fillPlayers(); });
  plSel.addEventListener('change', () => { st.inId = plSel.value; drawIn(); compare(); });
  let L = null;
  async function loadLeague() {
    clSel.textContent = ''; plSel.textContent = ''; clSel.appendChild(h('option', { value: '' }, 'Reading…'));
    try { L = await A.loadLeagueFor(st.lid); } catch (_) { L = null; }
    clSel.textContent = '';
    if (!L) { clSel.appendChild(h('option', { value: '' }, 'This league could not be read')); return; }
    clSel.appendChild(h('option', { value: '' }, 'Every club'));
    L.teams.filter(t => (+t.gp || 0) > 0).slice().sort((a, b) => String((a.meta || {}).name || '').localeCompare(String((b.meta || {}).name || '')))
      .forEach(t => clSel.appendChild(h('option', { value: String(t.id), translate: 'no' }, (t.meta || {}).name || 'Club')));
    if (st.inId && !st.club) { const tid = L.teamOf(st.inId); if (tid) st.club = String(tid); }
    clSel.value = st.club;
    fillPlayers();
  }
  function fillPlayers() {
    plSel.textContent = '';
    plSel.appendChild(h('option', { value: '' }, 'A player'));
    const mine = new Set(roster.map(e => String(e.id)));
    L.rows.filter(r => (!st.club || String(r.teamId) === st.club) && !mine.has(String(r.playerId)) && L.priced.get(String(r.playerId)))
      .sort((a, b) => (L.priced.get(String(b.playerId)).value - L.priced.get(String(a.playerId)).value))
      .forEach(r => { const p = L.priced.get(String(r.playerId)); plSel.appendChild(h('option', { value: String(r.playerId), translate: 'no' }, r.name + ' · ' + (r.teamName || '') + ' · ' + A.money(p.value))); });
    plSel.value = st.inId;
    drawIn(); compare();
  }

  /* ---- the cards ---- */
  const cardOf = (id, LL, isOut) => {
    const row = LL && LL.byId.get(String(id)), named = LL && LL.named.get(String(id)), price = LL && LL.priced.get(String(id));
    if (!row || !named || !price) return h('p.mg-sub', isOut ? 'An open spot: the squad has room for him without anybody leaving.' : 'Pick a player.');
    const share = LL.share.get(String(id)) || Mgr.cards.shareOf(row);
    return h('div.mg-tcard', h('div.hd', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.SLOTS[A.slotIn(LL, id, share)]), h('div', A.nm(named.name, 'b'), h('span', A.nm(named.teamName || ''), ' · ', A.nm(LL.L.name)))),
      h('div.mg-row', h('span.mg-chip', 'Value ', h('b', A.money(price.value))), h('span.mg-chip.royal', 'Wage ', h('b', A.money(price.wage))), h('a', { href: '#/player/' + encodeURIComponent(id) + '?l=' + encodeURIComponent(LL.L.id) }, 'profile →')));
  };
  const outLeague = () => A.leagueDataOf(st.out);
  function drawOut() { outCard.textContent = ''; outCard.appendChild(st.out === OPEN ? cardOf(null, null, true) : cardOf(st.out, outLeague(), true)); }
  function drawIn() { inCard.textContent = ''; inCard.appendChild(st.inId && L ? cardOf(st.inId, L) : cardOf(null, null)); }

  /* ---- side by side: every attribute and number mirrored ---- */
  function compare() {
    vs.textContent = ''; act.textContent = '';
    const oL = st.out === OPEN ? null : outLeague(), oRow = oL && oL.byId.get(String(st.out)), iRow = L && st.inId ? L.byId.get(String(st.inId)) : null;
    vs.appendChild(h('div.mg-h', h('h3', 'Side by side'), h('span.mg-sub', 'Attributes against each man’s own league; numbers his season’s')));
    const oA = oRow ? (oL.attrs.get(String(st.out)) || {}) : {}, iA = iRow ? (L.attrs.get(String(st.inId)) || {}) : {};
    const row = (k, a, b, max, fmtF) => {
      const win = isFinite(a) && isFinite(b) ? (a > b ? 'a' : b > a ? 'b' : '') : '';
      return [h('span.a' + (win === 'a' ? '.win' : ''), isFinite(a) ? fmtF(a) : '–'), h('div.ba', h('i', { style: { width: isFinite(a) ? Math.min(100, 100 * a / max) + '%' : '0' } })), h('span.k', k),
        h('div.bb', h('i', { style: { width: isFinite(b) ? Math.min(100, 100 * b / max) + '%' : '0' } })), h('span.b' + (win === 'b' ? '.win' : ''), isFinite(b) ? fmtF(b) : '–')];
    };
    const g1 = h('div.mg-vs');
    Mgr.ratings.ATTRS.forEach(a => g1.appendChild(h('div', { style: { display: 'contents' } }, row(a.label, +oA[a.k], +iA[a.k], 20, v => String(v)))));
    vs.appendChild(h('div.mg-cap', { style: { margin: '6px 0' } }, 'Attributes'));
    vs.appendChild(g1);
    const g2 = h('div.mg-vs', { style: { marginTop: '12px' } });
    LINES.forEach(([k, f]) => {
      const a = oRow && oRow.gp ? f(oRow) : NaN, b = iRow && iRow.gp ? f(iRow) : NaN, max = Math.max(isFinite(a) ? a : 0, isFinite(b) ? b : 0, 1) * 1.15;
      g2.appendChild(h('div', { style: { display: 'contents' } }, row(k, +a, +b, max, v => A.fmt(v))));
    });
    vs.appendChild(h('div.mg-cap', { style: { margin: '14px 0 6px' } }, 'A game, and his rates'));
    vs.appendChild(g2);

    /* the money and the button */
    const budget = A.club.budget || 0, wages = roster.reduce((a, e) => a + (e.wage || 0), 0);
    const outE = roster.find(e => String(e.id) === st.out), inP = L && st.inId ? L.priced.get(String(st.inId)) : null;
    const after = wages - (outE ? outE.wage : 0) + (inP ? inP.wage : 0), ok = !!inP && after <= budget;
    act.appendChild(h('div.mg-budget' + (after > budget ? '.over' : ''), h('div.line', h('span', 'Wages after the trade ', h('b', A.money(after))), h('span', 'Budget ', h('b', A.money(budget)))),
      h('div.mg-bar', h('i', { style: { width: Math.min(100, 100 * after / Math.max(1, budget)) + '%' } })),
      h('div.line', h('span', after <= budget ? 'Left after it' : 'Over the budget by'), h('b', A.money(Math.abs(budget - after))))));
    const btn = h('button.mg-btn.primary.big', { type: 'button', disabled: ok ? null : true }, st.out === OPEN ? 'Sign him' : 'Make the trade');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const share = L.share.get(String(st.inId)) || Mgr.cards.shareOf(L.byId.get(String(st.inId)));
        const entry = { id: String(st.inId), league: L.L.id, value: inP.value, wage: inP.wage, slot: A.slotIn(L, st.inId, share), signed: new Date().toISOString().slice(0, 10) };
        const next = st.out === OPEN ? roster.concat([entry]) : roster.map(e => (String(e.id) === st.out ? entry : e));
        const lineups = (A.club.lineups || []).map(l => Object.assign({}, l, { ids: l.ids.map(x => (String(x) === st.out ? entry.id : x)),
          tac: l.tac && l.tac.usage && l.tac.usage[st.out] != null ? Object.assign({}, l.tac, { usage: Object.assign({}, l.tac.usage, { [entry.id]: l.tac.usage[st.out] }) }) : l.tac }));
        await A.save({ roster: next, lineups });
        A.club.roster = next; A.club.lineups = lineups;
        await A.reloadMine();
        A.toast(st.out === OPEN ? A.nameOf(entry.id) + ' signed.' : 'Trade done: ' + A.nameOf(entry.id) + ' joins, ' + (outE ? A.nameOf(outE.id) : '') + ' leaves.');
        A.go('/squad');
      } catch (e) { btn.disabled = false; A.toast('The trade could not be saved: ' + (e && e.message || e), true); }
    });
    act.appendChild(h('div.mg-row.between', h('span.mg-sub', ok ? 'Your lineups keep their shape: he takes the place of the man he replaces.' : !inP ? 'Pick the player you want.' : 'Over your budget: pick a cheaper player, or trade a more expensive one out.'), btn));
  }
  drawOut();
  await loadLeague();
}

A.views.trade = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
