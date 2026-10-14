'use strict';
/* ============================================================================
   MANAGER - TACTICS (#/tactics). Louie, 2026-10-09: "a big high-fidelity half court plus bench; players to drag and
   drop ... hover stats, and a position's key stats against the league average. Up to 4 lineups, fully simmed
   (positions matter, as deep as possible), with minutes shares up to 40. A tactics dropdown with per-lineup sliders",
   and "the efficacy of all have to be dependent on the players".
   2026-10-14 (Louie: "Can the tactics be in a pop up menu at the top? Can individual instructions show like football
   manager if you click/tap on the player? Can the tactics screen look nicer?"): the team's instructions are a pop-up
   from the top (views/ui.js teamPanel: FM's three phases), and a press on a player opens HIS instructions (ui.js
   playerPanel: his touches, the roles that suit him, each instruction with how well he suits it), kept on his roster
   entry so they go wherever he plays. Moving men is the drag and drop, or Swap in his pop-up.

   Every change is played straight away (engine.preview: the lineups on the clock, every stretch its own matchup, a few
   hundred games): against an average club of this league, and against the next opponent at its venue - with the
   tactics and the instructions against the same lineups without them, so what they do with THESE players is a number.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const E = () => Mgr.engine, IN = () => Mgr.instruct;
/* the five spots on the half court (the basket at the foot): x, y in % */
const SPOT = [[50, 16], [84, 36], [16, 36], [70, 67], [32, 73]];
const MAXL = 4, G = 40;

async function render(host) {
  /* while the squad is being drafted (Louie: the tactics "also viewable while constructing the squad to aid it"): the men
     signed so far, their lineups kept with the draft until it is confirmed */
  if (A.isDraft()) await A.reloadMine();
  let lineups = JSON.parse(JSON.stringify(A.lineups())).map(l => Object.assign({ tac: {} }, l));
  if (!lineups.length) {
    host.appendChild(h('div.mg-panel', h('h2', 'Tactics'), h('p', A.isDraft() ? 'Sign at least five players and your lineups and tactics can be set here, while you build the squad.' : 'Your squad needs at least five players.'),
      A.isDraft() ? h('a.mg-btn.primary', { href: '#/squad' }, '← Back to the squad') : null));
    return;
  }
  /* the squad's entries, with their instructions (edited here, saved with the lineups) */
  let roster = JSON.parse(JSON.stringify(A.club.roster || []));
  const entryOf = id => roster.find(e => String(e.id) === String(id)) || null;
  const insMap = () => IN().forEngine(roster, A.cardOf, A.slotOfId);
  let cur = 0, sel = null, dirty = false, pvT = null, pvRun = 0;
  const squad = [...A.mine.cards.keys()];
  const saveBtn = h('button.mg-btn.primary', { type: 'button', id: 'mgTacSave', onclick: save }, 'Save');
  const tiBtn = h('button.mg-btn.mg-pop-keep', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => openTeam() }, '⚙ Team instructions ▾');
  host.appendChild(h('div.mg-top.tac', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Tactics'), h('div.meta', h('span', 'Up to four lineups, each with its own team instructions; every player his own; every change simulated'))),
    h('div.grow'), tiBtn,
    h('button.mg-btn', { type: 'button', onclick: () => { lineups = JSON.parse(JSON.stringify(A.autoLineups())).map(l => Object.assign({ tac: {} }, l)); cur = 0; changed(); draw(); } }, 'Pick for me'),
    saveBtn));
  const tabs = h('div.mg-lineups'), chips = h('div.mg-tac-chips'), grid = h('div.mg-tactics'), leftCol = h('div.mg-stack'), rightCol = h('div.mg-stack');
  grid.appendChild(leftCol); grid.appendChild(rightCol);
  host.appendChild(h('div.mg-tac-head', tabs, chips)); host.appendChild(grid);
  const courtPanel = h('div.mg-panel.glow.mg-courtpanel'), minsPanel = h('div.mg-panel'), previewPanel = h('div.mg-panel'), benchPanel = h('div.mg-panel'), squadPanel = h('div.mg-panel');
  leftCol.appendChild(courtPanel); leftCol.appendChild(previewPanel); leftCol.appendChild(minsPanel);
  rightCol.appendChild(benchPanel); rightCol.appendChild(squadPanel);

  const L = () => lineups[cur];
  function draw() { drawTabs(); drawChips(); drawCourt(); drawBench(); drawSquad(); drawMins(); preview(); }
  function changed() { dirty = true; saveBtn.textContent = 'Save changes'; saveBtn.classList.add('pulse'); }

  /* ---- the lineups ---- */
  function drawTabs() {
    tabs.textContent = '';
    lineups.forEach((l, i) => tabs.appendChild(h('button', { type: 'button', 'aria-pressed': String(i === cur), onclick: () => { cur = i; sel = null; A.ui.close(); draw(); } },
      h('b', 'Lineup ' + (i + 1)), h('span', Math.round(l.min) + ' min' + (i === 0 ? ' · starts' : '')))));
    if (lineups.length < MAXL) tabs.appendChild(h('button.add', { type: 'button', onclick: () => {
      const used = new Set(L().ids), rest = squad.filter(id => !used.has(id)).concat(L().ids).slice(0, 5);
      lineups.push({ ids: rest, min: 6, tac: JSON.parse(JSON.stringify(L().tac || {})) }); rebalance(lineups.length - 1); cur = lineups.length - 1; changed(); draw();
    } }, h('b', '+ Lineup'), h('span', 'up to four')));
    if (lineups.length > 1) tabs.appendChild(h('button.rm', { type: 'button', onclick: () => { lineups.splice(cur, 1); cur = 0; rebalance(-1); changed(); draw(); } }, h('b', '− Remove'), h('span', 'this lineup')));
  }
  function drawChips() {
    chips.textContent = '';
    const s = A.ui.summary(L().tac || {});
    chips.appendChild(h('span.mg-cap', 'Lineup ' + (cur + 1) + ':'));
    if (!s.length) chips.appendChild(h('button.mg-chip.mg-pop-keep', { type: 'button', onclick: () => openTeam() }, 'No team instructions: + add'));
    s.forEach(x => chips.appendChild(h('button.mg-chip.royal.mg-pop-keep', { type: 'button', onclick: () => openTeam() }, x)));
  }
  /* minutes always add up to the game: the others give or take in proportion */
  function rebalance(fixed) {
    const tot = lineups.reduce((a, l) => a + l.min, 0);
    if (Math.abs(tot - G) < 1e-6) return;
    const others = lineups.filter((_, i) => i !== fixed), keep = fixed >= 0 ? lineups[fixed].min : 0, ot = others.reduce((a, l) => a + l.min, 0);
    if (ot <= 0) { if (fixed >= 0) lineups[fixed].min = G; return; }
    others.forEach(l => { l.min = Math.max(1, l.min * (G - keep) / ot); });
    const t2 = lineups.reduce((a, l) => a + l.min, 0); lineups[fixed >= 0 ? fixed : 0].min += G - t2;
  }

  /* ---- the team's instructions: the pop-up from the top ---- */
  function openTeam() {
    const all = h('button.mg-btn', { type: 'button', onclick: () => { const t = JSON.parse(JSON.stringify(L().tac || {})); lineups.forEach((l, i) => { if (i !== cur) l.tac = Object.assign({}, t, { usage: (l.tac || {}).usage }); }); changed(); A.toast('Lineup ' + (cur + 1) + '’s team instructions are now every lineup’s.'); preview(); } }, 'Use for every lineup');
    A.ui.pop(A.ui.teamPanel({ tac: L().tac || {}, title: 'Team instructions', sub: 'Lineup ' + (cur + 1) + ' · how the five plays: what each asks is tried by your players, and their own numbers decide how it goes',
      onChange: t => { L().tac = t; changed(); drawChips(); preview(); }, extra: lineups.length > 1 ? all : null }), tiBtn, { under: true, cls: 'wide', label: 'Team instructions' });
  }

  /* ---- the court ---- */
  function drawCourt() {
    courtPanel.textContent = '';
    courtPanel.appendChild(h('div.mg-h', h('h3', 'Lineup ' + (cur + 1)), h('span.mg-sub', sel ? 'Now press a spot or a bench player to swap' : 'Press a player for his instructions; drag one onto a spot to move him')));
    const court = h('div.mg-court.big');
    court.innerHTML = '<svg class="lines" viewBox="0 0 500 420" preserveAspectRatio="none" aria-hidden="true"><rect x="10" y="10" width="480" height="400" rx="6"/>' +
      '<rect x="180" y="250" width="140" height="160"/><path d="M180 250 A70 70 0 0 1 320 250"/><path d="M45 410 L45 300 A210 210 0 0 1 455 300 L455 410"/>' +
      '<circle cx="250" cy="375" r="9"/><path d="M225 392 L275 392"/><path d="M190 10 A60 60 0 0 0 310 10"/></svg>';
    const l = L();
    l.ids.forEach((id, k) => {
      const c = A.cardOf(id), oop = c && Math.abs(k + 1 - c.pos) > 1.05, br = A.ui.brief(entryOf(id), id), lu = ((l.tac || {}).usage || {})[id] || 0;
      const who = h('div.who' + (oop ? '.oop' : '') + (sel && sel.from === 'spot' && sel.k === k ? '.sel' : ''), { draggable: 'true', tabindex: '0', role: 'button',
        'aria-label': E().SLOTS[k] + ': ' + A.nameOf(id) + ', player instructions', title: oop ? 'Out of his position: it costs both ends' : '' },
        A.nm(A.nameOf(id), 'b'), h('span', mini(id)),
        h('span.ins', br.role ? h('i.r', br.role) : h('i.none', 'No instructions'), br.u ? h('i.u' + (br.u > 0 ? '.up' : '.dn'), (br.u > 0 ? '▲' : '▼') + Math.abs(br.u)) : null, lu ? h('i.u', { title: 'Lineup ' + (cur + 1) + ' usage dial (from before)' }, 'L' + (lu > 0 ? '+' : '') + lu) : null));
      who.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'spot', k })); });
      who.addEventListener('click', () => { if (sel) return place(sel, k); openPlayer(id, who, k); });
      who.addEventListener('mouseenter', ev => hint(id, k, ev.currentTarget));
      who.addEventListener('mouseleave', unhint);
      who.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (sel) place(sel, k); else openPlayer(id, who, k); } });
      const spot = h('div.mg-spot', { style: { left: SPOT[k][0] + '%', top: SPOT[k][1] + '%' } }, h('span.tag', { 'data-i18n-ctx': 'pos' }, E().SLOTS[k]), who);
      spot.addEventListener('dragover', ev => { ev.preventDefault(); spot.classList.add('over'); });
      spot.addEventListener('dragleave', () => spot.classList.remove('over'));
      spot.addEventListener('drop', ev => { ev.preventDefault(); spot.classList.remove('over'); try { place(JSON.parse(ev.dataTransfer.getData('text/plain')), k); } catch (_) { /* not ours */ } });
      court.appendChild(spot);
    });
    courtPanel.appendChild(court);
    if (sel) courtPanel.appendChild(h('div.mg-row', { style: { justifyContent: 'center', marginTop: '10px' } }, h('button.mg-btn.ghost', { type: 'button', onclick: () => { sel = null; draw(); } }, 'Cancel the swap')));
  }
  const mini = id => { const r = A.rowOf(id); if (!r || !(r.gp > 0)) return A.posOf(id); return A.posOf(id) + ' · ' + A.fmt(r.pts / r.gp) + ' ppg'; };
  /* HIS INSTRUCTIONS, the pop-up beside him: his entry on the roster, edited here and saved with the lineups */
  function openPlayer(id, anchor, k) {
    unhint();
    const e = entryOf(id);
    if (!e) { A.toast('Only your own players take instructions.', true); return; }
    const lu = ((L().tac || {}).usage || {})[id];
    const actions = [];
    if (k != null) actions.push(h('button.mg-btn', { type: 'button', onclick: () => { A.ui.close(); sel = { from: 'spot', k, id }; draw(); } }, '⇄ Swap or move him'));
    else actions.push(h('span.mg-sub', 'Put him in lineup ' + (cur + 1) + ' at:'), ...E().SLOTS.map((s, kk) => h('button.mg-btn', { type: 'button', style: { padding: '6px 10px' }, onclick: () => { A.ui.close(); place({ from: 'bench', id }, kk); } }, s)));
    if (lu) actions.push(h('button.mg-chip', { type: 'button', title: 'The old per-lineup usage dial: clear it, and set his touches here instead', onclick: () => { const t = L().tac; t.usage = Object.assign({}, t.usage); delete t.usage[id]; changed(); drawCourt(); preview(); A.ui.close(); } }, 'Lineup ' + (cur + 1) + ' usage ' + (lu > 0 ? '+' : '') + lu + ' ✕'));
    A.ui.pop(A.ui.playerPanel(id, { entry: e, actions,
      onChange: x => { Object.assign(e, { u: x.u || 0, ins: x.ins || [] }); if (x.role) e.role = x.role; else delete e.role; if (!e.u) delete e.u; if (!e.ins.length) delete e.ins; changed(); drawCourt(); drawSquad(); preview(); } }), anchor, { label: 'Player instructions: ' + A.nameOf(id) });
  }
  /* a player onto spot k: from the bench he takes it (the man there goes to the bench); from another spot they swap */
  function place(src, k) {
    const l = L(), ids = l.ids.slice();
    if (src.from === 'spot') { if (src.k === k) { sel = null; draw(); return; } const t = ids[k]; ids[k] = ids[src.k]; ids[src.k] = t; }
    else if (src.from === 'bench') { if (ids.includes(src.id)) { sel = null; draw(); return; } ids[k] = src.id; }
    l.ids = ids; sel = null; changed(); draw();
  }

  /* ---- the bench ---- */
  function drawBench() {
    benchPanel.textContent = '';
    benchPanel.appendChild(h('div.mg-h', h('h3', 'Bench'), h('span.mg-sub', 'Not in lineup ' + (cur + 1))));
    const ul = h('ul.mg-bench');
    const inL = new Set(L().ids), mins = E().minutesOf(E().rotation(lineups, G));
    squad.filter(id => !inL.has(id)).sort((a, b) => ((A.priceOf(b) || {}).value || 0) - ((A.priceOf(a) || {}).value || 0)).forEach(id => {
      const br = A.ui.brief(entryOf(id), id);
      const li = h('li' + (sel && sel.from === 'bench' && sel.id === id ? '.sel' : ''), { draggable: 'true', tabindex: '0', role: 'button', 'aria-label': A.nameOf(id) + ', player instructions' },
        h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), A.nm(A.nameOf(id), 'span.nm'), br.role ? h('span.mg-chip', br.role) : null, h('span.m', Math.round(mins.get(id) || 0) + ' min'));
      li.addEventListener('dragstart', ev => ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'bench', id })));
      li.addEventListener('click', () => { if (sel && sel.from === 'spot') { const k = sel.k; sel = null; place({ from: 'bench', id }, k); return; } openPlayer(id, li, null); });
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPlayer(id, li, null); } });
      li.addEventListener('mouseenter', ev => hint(id, null, ev.currentTarget));
      li.addEventListener('mouseleave', unhint);
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(h('li', { style: { cursor: 'default' } }, 'Everybody is in this lineup.'));
    benchPanel.appendChild(ul);
  }
  /* ---- the squad's instructions at a glance ---- */
  function drawSquad() {
    squadPanel.textContent = '';
    squadPanel.appendChild(h('div.mg-h', h('h3', 'Player instructions'), h('span.mg-sub', 'They go with the player into every lineup')));
    const ul = h('ul.mg-bench.plain');
    squad.slice().sort((a, b) => A.slotOfId(a) - A.slotOfId(b)).forEach(id => {
      const br = A.ui.brief(entryOf(id), id);
      const li = h('li', { tabindex: '0', role: 'button', 'aria-label': A.nameOf(id) + ', player instructions' }, h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), A.nm(A.nameOf(id), 'span.nm'),
        br.u ? h('span.mg-chip', (br.u > 0 ? '▲ ' : '▼ ') + Math.abs(br.u)) : null, h('span.m', br.role || '–'));
      li.addEventListener('click', () => openPlayer(id, li, L().ids.includes(id) ? L().ids.indexOf(id) : null));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPlayer(id, li, L().ids.includes(id) ? L().ids.indexOf(id) : null); } });
      ul.appendChild(li);
    });
    squadPanel.appendChild(ul);
  }

  /* ---- the minutes ---- */
  function drawMins() {
    minsPanel.textContent = '';
    minsPanel.appendChild(h('div.mg-h', h('h3', 'Minutes'), h('span.mg-sub', 'Lineup 1 starts and closes every quarter; the others play the middles. In a live game you can change any of it')));
    const g = h('div.mg-mins');
    lineups.forEach((l, i) => {
      const rng = h('input.mg-range', { type: 'range', min: '1', max: '40', step: '1', value: String(Math.round(l.min)), 'aria-label': 'Minutes of lineup ' + (i + 1) });
      const out = h('b', Math.round(l.min) + '′');
      rng.style.setProperty('--p', (100 * l.min / G) + '%');
      rng.addEventListener('change', () => { l.min = +rng.value; rebalance(i); changed(); drawMins(); drawTabs(); drawBench(); preview(); });
      rng.addEventListener('input', () => { out.textContent = rng.value + '′'; rng.style.setProperty('--p', (100 * rng.value / G) + '%'); });
      g.appendChild(h('span', 'Lineup ' + (i + 1))); g.appendChild(rng); g.appendChild(out);
    });
    minsPanel.appendChild(g);
    /* each man's night, and his legs (squad.js stamina: nothing until the upper thirties, then fast, heavier with usage) */
    const mins = E().minutesOf(E().rotation(lineups, G));
    const rows = [...mins.entries()].sort((a, b) => b[1] - a[1]);
    const t = h('table.mg-table', { style: { marginTop: '12px' } }, h('thead', h('tr', h('th.l', 'Player'), h('th', 'Minutes'), h('th', 'Legs'))));
    const tb = h('tbody');
    rows.forEach(([id, m]) => {
      const c = A.cardOf(id), load = c ? E().fatigueLoad(m, c.usg, G) - E().fatigueLoad(c.mpg, c.usg, G) : 0;
      tb.appendChild(h('tr', h('td.l', h('a', { href: '#/player/' + encodeURIComponent(id), title: 'Full profile', translate: 'no' }, A.nameOf(id))), h('td', A.fmt(m)), h('td', load > 1 ? h('span.mg-chip.bad', 'Tired') : load > 0.2 ? h('span.mg-chip', { style: { color: 'var(--mg-warn)' } }, 'Heavy') : h('span.mg-chip.good', 'Fresh'))));
    });
    t.appendChild(tb);
    minsPanel.appendChild(h('div.mg-tablewrap', t));
  }

  /* ---- fully simmed: the preview ---- */
  function preview() {
    clearTimeout(pvT);
    pvT = setTimeout(run, 350);
  }
  function avgTeam() {
    const cards = new Map();
    [0, 1, 2, 3, 4].forEach(k => cards.set('avg' + k, Mgr.cards.averageCard(A.lg.ref, k, 'avg' + k)));
    return { id: 'avg', segs: [{ t0: 0, t1: G, ids: ['avg0', 'avg1', 'avg2', 'avg3', 'avg4'] }], cards };
  }
  async function run() {
    const my = ++pvRun;
    previewPanel.textContent = '';
    previewPanel.appendChild(h('div.mg-h', h('h3', 'Simulated'), h('span.mg-sub', 'A few hundred games of these lineups, tactics and instructions')));
    const box = h('div.mg-preview'), note = h('p.mg-sub');
    previewPanel.appendChild(box); previewPanel.appendChild(note);
    box.appendChild(h('div.p', h('div.mg-spin', { style: { width: '22px', height: '22px', margin: '6px auto' } })));
    await new Promise(r => setTimeout(r, 30));
    if (my !== pvRun) return;
    try {
      const X = A.X(), ins = insMap(), me = { id: 'me', segs: E().rotation(lineups, G), cards: A.mine.cards, ins };
      const plain = { id: 'me', segs: E().rotation(lineups.map(l => Object.assign({}, l, { tac: (l.tac && l.tac.usage) ? { usage: l.tac.usage } : {} })), G), cards: A.mine.cards };
      const vsAvg = E().preview(me, avgTeam(), Object.assign({}, X, { home: 0, seed: 11 }), 300);
      await new Promise(r => setTimeout(r, 0)); if (my !== pvRun) return;
      const vsPlain = E().preview(plain, avgTeam(), Object.assign({}, X, { home: 0, seed: 11 }), 300);
      await new Promise(r => setTimeout(r, 0)); if (my !== pvRun) return;
      const S = A.club.state, nx = S ? Mgr.season.next(S, 0) : null;
      let vsNext = null, opp = null;
      if (nx) { opp = nx.h === 0 ? nx.a : nx.h; vsNext = E().preview(me, A.teamObj(opp, null), Object.assign({}, X, { home: nx.h === 0 ? 1 : -1, seed: 13 }), 300); }
      if (my !== pvRun) return;
      box.textContent = '';
      const d = vsAvg.margin - vsPlain.margin;
      box.appendChild(h('div.p', h('b', (vsAvg.margin >= 0 ? '+' : '') + A.fmt(vsAvg.margin)), h('span', 'Margin v an average club')));
      box.appendChild(h('div.p', h('b.d.' + (d >= 0.05 ? 'up' : d <= -0.05 ? 'dn' : ''), (d >= 0 ? '+' : '') + A.fmt(d)), h('span', 'What your instructions add')));
      box.appendChild(vsNext ? h('div.p', h('b', Math.round(100 * vsNext.pWin) + '%'), h('span', h('span', 'Chance v '), A.nm(A.clubAt(opp).short))) : h('div.p', h('b', '–'), h('span', 'No game to come')));
      note.textContent = 'Points a play: ' + A.fmt(vsAvg.ppp[0], 3) + ' scored, ' + A.fmt(vsAvg.ppp[1], 3) + ' allowed. Every number is the players’ own, at the volume these tactics and instructions ask of them.';
    } catch (e) { box.textContent = ''; box.appendChild(h('div.p', h('span', 'The simulation could not run: ' + (e && e.message || e)))); }
  }

  /* ---- a player's numbers against his position's ---- */
  let tip = null;
  function hint(id, k, anchor) {
    unhint();
    if (root.document.querySelector('.mg-pop')) return;
    const r = A.rowOf(id), ref = A.lg.ref, c = A.cardOf(id);
    if (!r || !c) return;
    const at = k == null ? A.slotOfId(id) : k, P = ref.byPos[at];
    const rows = [['USG%', r.usg, P.usg], ['AST%', r.ast_pct, P.ast_pct], ['ORB%', r.oreb_pct, P.oreb_pct], ['DRB%', r.dreb_pct, P.dreb_pct], ['STL%', r.stl_pct, P.stl_pct], ['BLK%', r.blk_pct, P.blk_pct],
      ['3P%', r.p3_pct, 100 * ref.p3], ['Rim FG%', r.rim_pct, 100 * ref.rim], ['TS%', r.ts, null]];
    tip = h('div.mg-hint', h('a', { href: '#/player/' + encodeURIComponent(id), translate: 'no' }, h('b', A.nameOf(id)), ' · FULL PROFILE →'), h('div.mg-sub', 'Against the league’s average ' + E().SLOTS[at]),
      h('table', h('tbody', rows.map(([k2, v, lg]) => h('tr', h('td', k2), h('td.n', h('b', A.fmt(+v))), h('td.n.mg-sub', lg == null ? '' : A.fmt(+lg)))))));
    root.document.body.appendChild(tip);
    A.place(tip, anchor, { dy: 0 });
  }
  function unhint() { if (tip) { tip.remove(); tip = null; } }

  async function save() {
    try { await A.save({ lineups, roster }); dirty = false; saveBtn.textContent = 'Saved'; saveBtn.classList.remove('pulse'); A.toast('Lineups, tactics and instructions saved.'); }
    catch (e) { A.toast('Could not save: ' + (e && e.message || e), true); }
  }
  root.addEventListener('hashchange', function off() { unhint(); A.ui.close(); root.removeEventListener('hashchange', off); if (dirty) A.save({ lineups, roster }).catch(() => {}); });
  draw();
}

A.views.tactics = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
