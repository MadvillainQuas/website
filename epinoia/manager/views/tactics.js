'use strict';
/* ============================================================================
   MANAGER - TACTICS (#/tactics). Louie, 2026-10-09: "a big high-fidelity half court plus bench; players to drag and
   drop ... hover stats, and a position's key stats against the league average. Up to 4 lineups, fully simmed
   (positions matter, as deep as possible), with minutes shares up to 40. A tactics dropdown with per-lineup sliders",
   and "the efficacy of all have to be dependent on the players".

   Every change is played straight away (engine.preview: the lineups on the clock, every stretch its own matchup, a few
   hundred games): against an average club of this league, and against the next opponent at its venue - with the
   tactics against the same lineups without them, so what a slider does with THESE players is a number.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const E = () => Mgr.engine;
/* the five spots on the half court (the basket at the foot): x, y in % */
const SPOT = [[50, 17], [84, 36], [16, 36], [70, 66], [33, 72]];
const MAXL = 4, G = 40;

function render(host) {
  let lineups = JSON.parse(JSON.stringify(A.lineups())).map(l => Object.assign({ tac: {} }, l));
  if (!lineups.length) { host.appendChild(h('div.mg-panel', 'Your squad needs at least five players.')); return; }
  let cur = 0, sel = null, dirty = false, pvT = null, pvRun = 0;
  const roster = [...A.mine.cards.keys()];
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Tactics'), h('div.meta', h('span', 'Up to four lineups, each with its own tactics; every change is simulated'))),
    h('div.grow'), h('button.mg-btn', { type: 'button', onclick: () => { lineups = JSON.parse(JSON.stringify(A.autoLineups())).map(l => Object.assign({ tac: {} }, l)); cur = 0; dirty = true; draw(); } }, 'Pick for me'),
    h('button.mg-btn.primary', { type: 'button', id: 'mgTacSave', onclick: save }, 'Save')));
  const tabs = h('div.mg-lineups'), grid = h('div.mg-tactics'), leftCol = h('div.mg-stack'), rightCol = h('div.mg-stack');
  grid.appendChild(leftCol); grid.appendChild(rightCol);
  host.appendChild(tabs); host.appendChild(grid);
  const courtPanel = h('div.mg-panel.glow'), minsPanel = h('div.mg-panel'), previewPanel = h('div.mg-panel'), benchPanel = h('div.mg-panel'), tacPanel = h('div.mg-panel');
  leftCol.appendChild(courtPanel); leftCol.appendChild(previewPanel); leftCol.appendChild(minsPanel);
  rightCol.appendChild(benchPanel); rightCol.appendChild(tacPanel);

  const L = () => lineups[cur];
  function draw() { drawTabs(); drawCourt(); drawBench(); drawTac(); drawMins(); preview(); }
  function changed() { dirty = true; const b = root.document.getElementById('mgTacSave'); if (b) b.textContent = 'Save changes'; }

  /* ---- the lineups ---- */
  function drawTabs() {
    tabs.textContent = '';
    lineups.forEach((l, i) => tabs.appendChild(h('button', { type: 'button', 'aria-pressed': String(i === cur), onclick: () => { cur = i; sel = null; draw(); } },
      h('b', 'Lineup ' + (i + 1)), h('span', Math.round(l.min) + ' min'))));
    if (lineups.length < MAXL) tabs.appendChild(h('button', { type: 'button', onclick: () => {
      const used = new Set(L().ids), rest = roster.filter(id => !used.has(id)).concat(L().ids).slice(0, 5);
      lineups.push({ ids: rest, min: 6, tac: {} }); rebalance(lineups.length - 1); cur = lineups.length - 1; changed(); draw();
    } }, h('b', '+ Lineup'), h('span', 'up to four')));
    if (lineups.length > 1) tabs.appendChild(h('button', { type: 'button', onclick: () => { lineups.splice(cur, 1); cur = 0; rebalance(-1); changed(); draw(); } }, h('b', '− Remove'), h('span', 'this lineup')));
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

  /* ---- the court ---- */
  function drawCourt() {
    courtPanel.textContent = '';
    courtPanel.appendChild(h('div.mg-h', h('h3', 'Lineup ' + (cur + 1)), h('span.mg-sub', 'Drag a player onto a spot, or press one and then a spot')));
    const court = h('div.mg-court');
    court.innerHTML = '<svg class="lines" viewBox="0 0 500 420" preserveAspectRatio="none" aria-hidden="true"><rect x="10" y="10" width="480" height="400" rx="6"/>' +
      '<rect x="180" y="250" width="140" height="160"/><path d="M180 250 A70 70 0 0 1 320 250"/><path d="M45 410 L45 300 A210 210 0 0 1 455 300 L455 410"/>' +
      '<circle cx="250" cy="375" r="9"/><path d="M225 392 L275 392"/><path d="M190 10 A60 60 0 0 0 310 10"/></svg>';
    const l = L();
    l.ids.forEach((id, k) => {
      const c = A.cardOf(id), oop = c && Math.abs(k + 1 - c.pos) > 1.05;
      const who = h('div.who' + (oop ? '.oop' : '') + (sel && sel.from === 'spot' && sel.k === k ? '.sel' : ''), { draggable: 'true', tabindex: '0', role: 'button',
        'aria-label': E().SLOTS[k] + ': ' + A.nameOf(id), title: oop ? 'Out of his position: it costs both ends' : '' },
        A.nm(A.nameOf(id), 'b'), h('span', mini(id, k)));
      who.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'spot', k })); });
      who.addEventListener('click', () => pick({ from: 'spot', k, id }));
      who.addEventListener('mouseenter', ev => hint(id, k, ev.currentTarget));
      who.addEventListener('mouseleave', unhint);
      who.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick({ from: 'spot', k, id }); } });
      const usage = (l.tac.usage || {})[id] || 0;
      const dial = h('div.dial', h('button', { type: 'button', 'aria-label': 'Less of the plays', onclick: () => setUsage(id, usage - 0.5) }, '−'),
        h('span', usage > 0 ? 'usage +' + usage : usage < 0 ? 'usage ' + usage : 'usage'), h('button', { type: 'button', 'aria-label': 'More of the plays', onclick: () => setUsage(id, usage + 0.5) }, '+'));
      const spot = h('div.mg-spot', { style: { left: SPOT[k][0] + '%', top: SPOT[k][1] + '%' } }, h('span.tag', E().SLOTS[k]), who, dial);
      spot.addEventListener('dragover', ev => { ev.preventDefault(); spot.classList.add('over'); });
      spot.addEventListener('dragleave', () => spot.classList.remove('over'));
      spot.addEventListener('drop', ev => { ev.preventDefault(); spot.classList.remove('over'); try { place(JSON.parse(ev.dataTransfer.getData('text/plain')), k); } catch (_) { /* not ours */ } });
      court.appendChild(spot);
    });
    courtPanel.appendChild(court);
  }
  const mini = (id, k) => { const r = A.rowOf(id); if (!r || !(r.gp > 0)) return A.posOf(id); return A.posOf(id) + ' · ' + A.fmt(r.pts / r.gp) + ' ppg'; };
  function setUsage(id, v) {
    const l = L(); l.tac = l.tac || {}; l.tac.usage = Object.assign({}, l.tac.usage || {}); l.tac.usage[id] = Math.max(-1, Math.min(1, v));
    if (!l.tac.usage[id]) delete l.tac.usage[id];
    changed(); drawCourt(); preview();
  }
  function pick(p) {
    if (!sel) { sel = p; drawCourt(); drawBench(); return; }
    const a = sel; sel = null;
    if (p.from === 'spot') place(a, p.k); else { drawCourt(); drawBench(); }
  }
  /* a player onto spot k: from the bench he takes it (the man there goes to the bench); from another spot they swap */
  function place(src, k) {
    const l = L(), ids = l.ids.slice();
    if (src.from === 'spot') { if (src.k === k) return; const t = ids[k]; ids[k] = ids[src.k]; ids[src.k] = t; }
    else if (src.from === 'bench') { if (ids.includes(src.id)) return; ids[k] = src.id; }
    l.ids = ids; sel = null; changed(); draw();
  }

  /* ---- the bench ---- */
  function drawBench() {
    benchPanel.textContent = '';
    benchPanel.appendChild(h('div.mg-h', h('h3', 'Bench'), h('span.mg-sub', 'Everybody not in lineup ' + (cur + 1))));
    const ul = h('ul.mg-bench');
    const inL = new Set(L().ids), mins = E().minutesOf(E().rotation(lineups, G));
    roster.filter(id => !inL.has(id)).sort((a, b) => ((A.priceOf(b) || {}).value || 0) - ((A.priceOf(a) || {}).value || 0)).forEach(id => {
      const li = h('li' + (sel && sel.from === 'bench' && sel.id === id ? '.sel' : ''), { draggable: 'true', tabindex: '0', role: 'button', 'aria-label': A.nameOf(id) },
        h('span.mg-pos', A.posOf(id)), A.nm(A.nameOf(id), 'span.nm'), h('span.m', Math.round(mins.get(id) || 0) + ' min'));
      li.addEventListener('dragstart', ev => ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'bench', id })));
      li.addEventListener('click', () => pick({ from: 'bench', id }));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick({ from: 'bench', id }); } });
      li.addEventListener('mouseenter', ev => hint(id, null, ev.currentTarget));
      li.addEventListener('mouseleave', unhint);
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(h('li', { style: { cursor: 'default' } }, 'Everybody is in this lineup.'));
    benchPanel.appendChild(ul);
  }

  /* ---- the sliders ---- */
  function drawTac() {
    tacPanel.textContent = '';
    tacPanel.appendChild(h('div.mg-h', h('h3', 'Tactics for lineup ' + (cur + 1)), h('button.mg-btn.ghost', { type: 'button', style: { marginLeft: 'auto', padding: '6px 12px' },
      onclick: () => { const u = (L().tac || {}).usage; L().tac = u ? { usage: u } : {}; changed(); drawTac(); preview(); } }, 'Reset')));
    let group = '';
    E().TACTICS.forEach(t => {
      if (t.group !== group) { group = t.group; tacPanel.appendChild(h('div.mg-cap', { style: { margin: '12px 0 2px' } }, group)); }
      const v = +((L().tac || {})[t.k] || 0), two = t.lo < 0;
      const rng = h('input.mg-range', { type: 'range', min: String(t.lo * 100), max: String(t.hi * 100), step: '10', value: String(Math.round(v * 100)), 'aria-label': t.label || (t.left + ' or ' + t.right) });
      const out = h('span.v', label(v, two));
      /* a one-sided slider fills from its left end; a two-sided one from its middle, toward the side it leans */
      const paint = () => {
        const x = (+rng.value - t.lo * 100) / ((t.hi - t.lo) * 100);
        if (!two) { rng.style.setProperty('--p', (100 * x).toFixed(1) + '%'); return; }
        const a = Math.min(50, 100 * x), b = Math.max(50, 100 * x);
        rng.style.background = 'linear-gradient(90deg, var(--mg-glass-3) ' + a + '%, var(--mg-royal) ' + a + '%, var(--mg-royal) ' + b + '%, var(--mg-glass-3) ' + b + '%)';
      };
      rng.addEventListener('input', () => { const x = +rng.value / 100; L().tac = Object.assign({}, L().tac, { [t.k]: x }); out.textContent = label(x, two); paint(); changed(); preview(); });
      paint();
      tacPanel.appendChild(h('div.mg-slider', h('div.lab', h('span', t.label || (t.left + ' ↔ ' + t.right)), out), rng,
        two ? h('div.ends', h('span', t.left), h('span', t.right)) : null, h('div.how', t.how)));
    });
  }
  const label = (v, two) => (!v ? 'off' : two ? (v < 0 ? '◀ ' : '') + Math.round(Math.abs(v) * 100) + '%' + (v > 0 ? ' ▶' : '') : Math.round(v * 100) + '%');

  /* ---- the minutes ---- */
  function drawMins() {
    minsPanel.textContent = '';
    minsPanel.appendChild(h('div.mg-h', h('h3', 'Minutes'), h('span.mg-sub', 'Lineup 1 starts and closes every quarter; the others play the middles')));
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
      tb.appendChild(h('tr', h('td.l', A.nm(A.nameOf(id))), h('td', A.fmt(m)), h('td', load > 1 ? h('span.mg-chip.bad', 'Tired') : load > 0.2 ? h('span.mg-chip', { style: { color: 'var(--mg-warn)' } }, 'Heavy') : h('span.mg-chip.good', 'Fresh'))));
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
    previewPanel.appendChild(h('div.mg-h', h('h3', 'Simulated'), h('span.mg-sub', 'A few hundred games of these lineups and tactics')));
    const box = h('div.mg-preview'), note = h('p.mg-sub');
    previewPanel.appendChild(box); previewPanel.appendChild(note);
    box.appendChild(h('div.p', h('div.mg-spin', { style: { width: '22px', height: '22px', margin: '6px auto' } })));
    await new Promise(r => setTimeout(r, 30));
    if (my !== pvRun) return;
    try {
      const X = A.X(), me = { id: 'me', segs: E().rotation(lineups, G), cards: A.mine.cards };
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
      box.appendChild(h('div.p', h('b.d.' + (d >= 0.05 ? 'up' : d <= -0.05 ? 'dn' : ''), (d >= 0 ? '+' : '') + A.fmt(d)), h('span', 'What the tactics add')));
      box.appendChild(vsNext ? h('div.p', h('b', Math.round(100 * vsNext.pWin) + '%'), h('span', h('span', 'Chance v '), A.nm(A.clubAt(opp).short))) : h('div.p', h('b', '–'), h('span', 'No game to come')));
      note.textContent = 'Points a play: ' + A.fmt(vsAvg.ppp[0], 3) + ' scored, ' + A.fmt(vsAvg.ppp[1], 3) + ' allowed. Every number is the players’ own, at the volume these tactics ask of them.';
    } catch (e) { box.textContent = ''; box.appendChild(h('div.p', h('span', 'The simulation could not run: ' + (e && e.message || e)))); }
  }

  /* ---- a player's numbers against his position's ---- */
  let tip = null;
  function hint(id, k, anchor) {
    unhint();
    const r = A.rowOf(id), ref = A.lg.ref, c = A.cardOf(id);
    if (!r || !c) return;
    const at = k == null ? A.slotOf(c.share) : k, P = ref.byPos[at];
    const rows = [['USG%', r.usg, P.usg], ['AST%', r.ast_pct, P.ast_pct], ['ORB%', r.oreb_pct, P.oreb_pct], ['DRB%', r.dreb_pct, P.dreb_pct], ['STL%', r.stl_pct, P.stl_pct], ['BLK%', r.blk_pct, P.blk_pct],
      ['3P%', r.p3_pct, 100 * ref.p3], ['Rim FG%', r.rim_pct, 100 * ref.rim], ['TS%', r.ts, null]];
    tip = h('div.mg-hint', h('b', A.nm(A.nameOf(id))), h('div.mg-sub', 'Against the league’s average ' + E().SLOTS[at]),
      h('table', h('tbody', rows.map(([k2, v, lg]) => h('tr', h('td', k2), h('td.n', h('b', A.fmt(+v))), h('td.n.mg-sub', lg == null ? '' : A.fmt(+lg)))))));
    root.document.body.appendChild(tip);
    const b = anchor.getBoundingClientRect();
    tip.style.left = Math.min(root.innerWidth - 262, b.right + 10) + 'px';
    tip.style.top = Math.max(8, Math.min(root.innerHeight - tip.offsetHeight - 8, b.top)) + 'px';
  }
  function unhint() { if (tip) { tip.remove(); tip = null; } }

  async function save() {
    try { await A.save({ lineups }); dirty = false; const b = root.document.getElementById('mgTacSave'); if (b) b.textContent = 'Saved'; A.toast('Lineups and tactics saved.'); }
    catch (e) { A.toast('Could not save: ' + (e && e.message || e), true); }
  }
  root.addEventListener('hashchange', function off() { unhint(); root.removeEventListener('hashchange', off); if (dirty) A.save({ lineups }).catch(() => {}); });
  draw();
}

A.views.tactics = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
