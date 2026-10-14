'use strict';
/* ============================================================================
   MANAGER - TACTICS (#/tactics). Louie, 2026-10-09: "a big high-fidelity half court plus bench; players to drag and
   drop ... Up to 4 lineups ... A tactics dropdown with per-lineup sliders", and "the efficacy of all have to be dependent
   on the players". 2026-10-14: the team's instructions a pop-up from the top (views/ui.js teamPanel), a press on a player
   his own (ui.js playerPanel).
   2026-10-14, THE ROLES (Louie): "players represented by circles on the tactics screen, and ... the bench placed next to
   the lineup graphic (for easy drag and replace)"; "a visual indicator as to how the lineup with the current settings
   will work (i.e. colour coding a player as to how much usage they'll have, how much they've been asked to get to the
   rim vs. shoot 3's etc.) similar to Football Manager, things like flagging when you've designated too many high usage
   players and ball handlers"; "Instead of hovering over a player and it showing their season stats, can it show their
   Attributes?"; each position's ROLE chosen at its place (core/roles.js, applied as the default when none is); the
   Simulated panel gone; and the minutes "like an interactive rotations chart on box score pages" ("I'd rather lineup
   granularity"): each lineup is given its minutes on the game's clock, painted a minute at a time.

   What the circles say is the engine's own reading of the five (engine.sideOf, its men and five): the share of the plays
   each man ends (the circle's colour), his time on the ball (its ring), where his shots come from (the bar), and the
   five's ball, paint pressure, spacing, screens and passing, with what is wrong or right about them (engine.roleNotes).
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const E = () => Mgr.engine, IN = () => Mgr.instruct, RO = () => Mgr.roles;
/* the five spots on the half court (the basket at the foot): x, y in % */
const SPOT = [[50, 17], [84, 37], [16, 37], [70, 66], [31, 72]];
const MAXL = 4, G = 40;
/* each lineup's colour on the chart and its tab */
const LC = ['var(--mg-l0)', 'var(--mg-l1)', 'var(--mg-l2)', 'var(--mg-l3)'];
/* the colour of a man's share of the plays: cool for a few, hot for many */
const heat = u => { const t = Math.max(0, Math.min(1, (u - 12) / 16)); return 'hsl(' + Math.round(205 - 205 * t) + ' 84% ' + Math.round(56 - 8 * t) + '%)'; };
const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const surname = name => { const p = String(name || '').split(/\s+/).filter(Boolean); return p.length > 1 ? p.slice(1).join(' ') : p[0] || ''; };

async function render(host) {
  /* while the squad is being drafted (Louie: the tactics "also viewable while constructing the squad to aid it"): the men
     signed so far, their lineups kept with the draft until it is confirmed */
  if (A.isDraft()) await A.reloadMine();
  let lineups = JSON.parse(JSON.stringify(A.lineups({ all: true }))).map(l => Object.assign({ tac: {} }, l, { roles: A.rolesOf(l) }));
  if (!lineups.length) {
    host.appendChild(h('div.mg-panel', h('h2', 'Tactics'), h('p', A.isDraft() ? 'Sign at least five players and your lineups and tactics can be set here, while you build the squad.' : 'Your squad needs at least five players.'),
      A.isDraft() ? h('a.mg-btn.primary', { href: '#/squad' }, '← Back to the squad') : null));
    return;
  }
  /* a plan from before the chart: its minutes painted as they were played (engine.paintOf) */
  const paintAll = () => { if (!lineups.some(l => Array.isArray(l.when) && l.when.length)) { const w = E().paintOf(lineups, G); lineups.forEach((l, i) => { l.when = w[i]; }); } tally(); };
  /* each lineup's minutes: what it was painted */
  function tally() { lineups.forEach(l => { l.min = (l.when || []).reduce((a, w) => a + Math.max(0, +w[1] - +w[0]), 0); }); }
  paintAll();
  /* the squad's entries, with their instructions (edited here, saved with the lineups) */
  let roster = JSON.parse(JSON.stringify(A.club.roster || []));
  const entryOf = id => roster.find(e => String(e.id) === String(id)) || null;
  const insMap = () => IN().forEngine(roster, A.cardOf, A.slotOfId);
  let cur = 0, sel = null, dirty = false, brush = 0;
  const squad = [...A.mine.cards.keys()];
  const saveBtn = h('button.mg-btn.primary', { type: 'button', id: 'mgTacSave', onclick: save }, 'Save');
  const tiBtn = h('button.mg-btn.mg-pop-keep', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => openTeam() }, '⚙ Team instructions ▾');
  host.appendChild(h('div.mg-top.tac', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Tactics'), h('div.meta', h('span', 'Up to four lineups, a role at every position, each with its own team instructions; every player his own'))),
    h('div.grow'), tiBtn,
    h('button.mg-btn', { type: 'button', onclick: () => { lineups = JSON.parse(JSON.stringify(A.autoLineups())).map(l => Object.assign({ tac: {} }, l, { roles: A.rolesOf(l), when: null })); paintAll(); cur = 0; brush = 0; changed(); draw(); } }, 'Pick for me'),
    saveBtn));
  const tabs = h('div.mg-lineups'), chips = h('div.mg-tac-chips');
  host.appendChild(h('div.mg-tac-head', tabs, chips));
  const courtPanel = h('div.mg-panel.glow.mg-courtpanel'), benchPanel = h('div.mg-panel.mg-benchpanel'), readPanel = h('div.mg-panel.mg-readpanel'), rotPanel = h('div.mg-panel.mg-rotpanel');
  host.appendChild(h('div.mg-tac2', h('div.mg-tac2-court', courtPanel, benchPanel), readPanel, rotPanel));

  const L = () => lineups[cur];
  let side = null;
  function draw() { read(); drawTabs(); drawChips(); drawCourt(); drawBench(); drawRead(); drawRot(); }
  function changed() { dirty = true; saveBtn.textContent = 'Save changes'; saveBtn.classList.add('pulse'); }

  /* ---- the engine's reading of the lineup: its men and the five, with its roles, instructions and minutes ---- */
  function read() {
    side = null;
    try {
      const l = L(), mins = E().minutesOf(E().rotation(lineups, G));
      const five = l.ids.map((id, k) => ({ card: A.cardOf(id), k, role: l.roles[k] || null }));
      if (five.some(x => !x.card)) return;
      side = E().sideOf(five, { mu: A.lg.sim.rates, ref: A.lg.ref, tac: l.tac || null, G, dTr: A.lg.sim.dTr || 0, ins: insMap(), mins });
    } catch (e) { side = null; if (root.console) console.warn('Manager: the lineup could not be read', e); }
  }
  const roleOfAt = (k, id) => { const c = A.cardOf(id), key = L().roles[k]; return RO().resolve(key || null, k, c, A.lg.ref); };

  /* ---- the lineups ---- */
  function drawTabs() {
    tabs.textContent = '';
    lineups.forEach((l, i) => tabs.appendChild(h('button', { type: 'button', 'aria-pressed': String(i === cur), style: { '--lc': LC[i] }, onclick: () => { cur = i; brush = i; sel = null; A.ui.close(); draw(); } },
      h('b', h('i.sw', { 'aria-hidden': 'true' }), 'Lineup ' + (i + 1)), h('span', Math.round(l.min) + ' min' + (l.roles.some(r => !r) ? ' · roles to choose' : '')))));
    if (lineups.length < MAXL) tabs.appendChild(h('button.add', { type: 'button', onclick: addLineup }, h('b', '+ Lineup'), h('span', 'up to four')));
    if (lineups.length > 1) tabs.appendChild(h('button.rm', { type: 'button', onclick: removeLineup }, h('b', '− Remove'), h('span', 'this lineup')));
  }
  function addLineup() {
    const used = new Set(L().ids), rest = squad.filter(id => !used.has(id)).concat(L().ids).slice(0, 5);
    lineups.push({ ids: rest, min: 0, tac: JSON.parse(JSON.stringify(L().tac || {})), roles: [null, null, null, null, null], when: [] });
    const n = lineups.length - 1;
    /* it starts with the middle of each half (four minutes: two a half), taken from whoever had them */
    [[8, 10], [28, 30]].forEach(([a, b]) => paint(n, a, b));
    cur = n; brush = n; changed(); draw();
  }
  function removeLineup() {
    const gone = lineups.splice(cur, 1)[0];
    /* its minutes to lineup 1 */
    (gone.when || []).forEach(([a, b]) => { lineups[0].when.push([a, b]); });
    lineups[0].when = merge(lineups[0].when);
    cur = 0; brush = 0; tally(); changed(); draw();
  }
  function drawChips() {
    chips.textContent = '';
    const s = A.ui.summary(L().tac || {});
    chips.appendChild(h('span.mg-cap', 'Lineup ' + (cur + 1) + ':'));
    if (!s.length) chips.appendChild(h('button.mg-chip.mg-pop-keep', { type: 'button', onclick: () => openTeam() }, 'No team instructions: + add'));
    s.forEach(x => chips.appendChild(h('button.mg-chip.royal.mg-pop-keep', { type: 'button', onclick: () => openTeam() }, x)));
  }

  /* ---- the team's instructions: the pop-up from the top ---- */
  function openTeam() {
    const all = h('button.mg-btn', { type: 'button', onclick: () => { const t = JSON.parse(JSON.stringify(L().tac || {})); lineups.forEach((l, i) => { if (i !== cur) l.tac = Object.assign({}, t, { usage: (l.tac || {}).usage }); }); changed(); A.toast('Lineup ' + (cur + 1) + '’s team instructions are now every lineup’s.'); read(); drawCourt(); drawRead(); } }, 'Use for every lineup');
    A.ui.pop(A.ui.teamPanel({ tac: L().tac || {}, title: 'Team instructions', sub: 'Lineup ' + (cur + 1) + ' · how the five plays: what each asks is tried by your players, and their own numbers decide how it goes',
      onChange: t => { L().tac = t; changed(); drawChips(); read(); drawCourt(); drawRead(); }, extra: lineups.length > 1 ? all : null }), tiBtn, { under: true, cls: 'wide', label: 'Team instructions' });
  }

  /* ---- the court: the five as circles ---- */
  function drawCourt() {
    courtPanel.textContent = '';
    courtPanel.appendChild(h('div.mg-h', h('h3', h('i.sw', { style: { '--lc': LC[cur] }, 'aria-hidden': 'true' }), 'Lineup ' + (cur + 1)),
      h('span.mg-sub', sel ? 'Now press a place or a bench player to swap' : 'Press a player for his role and instructions; drag one from the bench onto a place to bring him in')));
    const court = h('div.mg-court.big.dots');
    court.innerHTML = '<svg class="lines" viewBox="0 0 500 420" preserveAspectRatio="none" aria-hidden="true"><rect x="10" y="10" width="480" height="400" rx="6"/>' +
      '<rect x="180" y="250" width="140" height="160"/><path d="M180 250 A70 70 0 0 1 320 250"/><path d="M45 410 L45 300 A210 210 0 0 1 455 300 L455 410"/>' +
      '<circle cx="250" cy="375" r="9"/><path d="M225 392 L275 392"/><path d="M190 10 A60 60 0 0 0 310 10"/></svg>';
    const l = L();
    l.ids.forEach((id, k) => {
      const c = A.cardOf(id), oop = c && Math.abs(k + 1 - c.pos) > 1.05, m = side ? side.men[k] : null, R = roleOfAt(k, id), chosen = !!l.roles[k];
      const fit = RO().fit(R, c, A.lg.ref), u = m ? m.u2 : (c ? c.usg : 18), onb = m && m.onb != null ? m.onb : 0;
      const ringPct = Math.max(0, Math.min(100, 100 * onb / 0.5));
      const name = A.nameOf(id);
      const dot = h('div.mg-dot' + (sel && sel.from === 'spot' && sel.k === k ? '.sel' : '') + (oop ? '.oop' : ''), {
        style: { '--heat': heat(u), '--ring': ringPct.toFixed(1) + '%' }, draggable: 'true', tabindex: '0', role: 'button',
        'aria-label': E().SLOTS[k] + ': ' + name + ', ' + R.label + (chosen ? '' : ' (default)') + '. Role and instructions' },
        h('span.in', h('b', initials(name)), h('small', Math.round(u) + '%')));
      const badges = [];
      if (oop) badges.push(h('i.bd.oop', { title: 'Out of his position: it costs both ends' }, '!'));
      if (m && m.lost > 0.02) badges.push(h('i.bd.warn', { title: 'He wants the ball more than this five can give him' }, '⚠'));
      if (m && m.forced > 0.02) badges.push(h('i.bd.warn', { title: 'Nobody else runs the offence: he has to' }, '⚑'));
      const mix = m ? m.m : null;
      const bar = mix ? h('div.mg-mixbar', { title: 'His shots: ' + Math.round(100 * mix.rim) + '% at the rim, ' + Math.round(100 * mix.mid) + '% other twos, ' + Math.round(100 * mix.three) + '% threes' },
        h('i.rim', { style: { width: (100 * mix.rim).toFixed(1) + '%' } }), h('i.mid', { style: { width: (100 * mix.mid).toFixed(1) + '%' } }), h('i.three', { style: { width: (100 * mix.three).toFixed(1) + '%' } })) : null;
      const lab = h('div.lab', A.nm(surname(name), 'b'),
        h('button.mg-rolechip.' + fit.band + (chosen ? '' : '.dflt'), { type: 'button', title: chosen ? R.desc : 'No role chosen: he plays the default (' + R.label + '). Press to choose', onclick: ev => { ev.stopPropagation(); openPlayer(id, dot, k); } },
          h('i.mg-fit.' + fit.band, { 'aria-hidden': 'true' }), h('span', R.short), chosen ? null : h('em', ' ▾')),
        bar);
      dot.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'spot', k })); unhint(); });
      dot.addEventListener('click', () => { if (sel) return place(sel, k); openPlayer(id, dot, k); });
      dot.addEventListener('mouseenter', ev => hint(id, ev.currentTarget, R.label + (chosen ? '' : ' (default)')));
      dot.addEventListener('mouseleave', unhint);
      dot.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (sel) place(sel, k); else openPlayer(id, dot, k); } });
      const spot = h('div.mg-spot.c', { style: { left: SPOT[k][0] + '%', top: SPOT[k][1] + '%' } }, h('span.tag', { 'data-i18n-ctx': 'pos' }, E().SLOTS[k]), h('div.dotwrap', dot, badges), lab);
      spot.addEventListener('dragover', ev => { ev.preventDefault(); spot.classList.add('over'); });
      spot.addEventListener('dragleave', () => spot.classList.remove('over'));
      spot.addEventListener('drop', ev => { ev.preventDefault(); spot.classList.remove('over'); try { place(JSON.parse(ev.dataTransfer.getData('text/plain')), k); } catch (_) { /* not ours */ } });
      court.appendChild(spot);
    });
    courtPanel.appendChild(court);
    courtPanel.appendChild(h('div.mg-legend',
      h('span', h('i.heat', { 'aria-hidden': 'true' }), 'Colour: his share of the plays (cool few, hot many)'),
      h('span', h('i.ring', { 'aria-hidden': 'true' }), 'Ring: his time on the ball'),
      h('span', h('i.mix', { 'aria-hidden': 'true' }, h('b.rim'), h('b.mid'), h('b.three')), 'Bar: his shots at the rim · other twos · threes')));
    if (sel) courtPanel.appendChild(h('div.mg-row', { style: { justifyContent: 'center', marginTop: '10px' } }, h('button.mg-btn.ghost', { type: 'button', onclick: () => { sel = null; draw(); } }, 'Cancel the swap')));
  }
  /* HIS ROLE AND INSTRUCTIONS, the pop-up beside him: the role at this place (the lineup's), his instructions on his
     roster entry (they go with him into every lineup), both saved with the lineups */
  function openPlayer(id, anchor, k) {
    unhint();
    const e = entryOf(id);
    if (!e) { A.toast('Only your own players take instructions.', true); return; }
    const lu = ((L().tac || {}).usage || {})[id];
    const actions = [];
    if (k != null) actions.push(h('button.mg-btn', { type: 'button', onclick: () => { A.ui.close(); sel = { from: 'spot', k, id }; draw(); } }, '⇄ Swap or move him'));
    else actions.push(h('span.mg-sub', 'Put him in lineup ' + (cur + 1) + ' at:'), ...E().SLOTS.map((s, kk) => h('button.mg-btn', { type: 'button', style: { padding: '6px 10px' }, onclick: () => { A.ui.close(); place({ from: 'bench', id }, kk); } }, s)));
    if (lu) actions.push(h('button.mg-chip', { type: 'button', title: 'The old per-lineup usage dial: clear it, and set his touches here instead', onclick: () => { const t = L().tac; t.usage = Object.assign({}, t.usage); delete t.usage[id]; changed(); read(); drawCourt(); drawRead(); A.ui.close(); } }, 'Lineup ' + (cur + 1) + ' usage ' + (lu > 0 ? '+' : '') + lu + ' ✕'));
    A.ui.pop(A.ui.playerPanel(id, { entry: e, actions, slot: k, role: k != null ? L().roles[k] : null,
      onRole: key => { L().roles[k] = key || null; changed(); read(); drawTabs(); drawCourt(); drawRead(); },
      onChange: x => { Object.assign(e, { u: x.u || 0, ins: x.ins || [] }); delete e.role; if (!e.u) delete e.u; if (!e.ins.length) delete e.ins; changed(); read(); drawCourt(); drawBench(); drawRead(); } }),
      anchor, { label: 'Player: ' + A.nameOf(id), cls: k != null ? 'wide' : '' });
  }
  /* a player onto place k: from the bench he takes it (the man there goes to the bench); from another place they swap.
     The ROLE stays with the place (Football Manager's way: a position's role is the tactic's, whoever plays it) */
  function place(src, k) {
    const l = L(), ids = l.ids.slice();
    if (src.from === 'spot') { if (src.k === k) { sel = null; draw(); return; } const t = ids[k]; ids[k] = ids[src.k]; ids[src.k] = t; }
    else if (src.from === 'bench') { if (ids.includes(src.id)) { sel = null; draw(); return; } ids[k] = src.id; }
    l.ids = ids; sel = null; changed(); draw();
  }

  /* ---- the bench, beside the court ---- */
  function drawBench() {
    benchPanel.textContent = '';
    benchPanel.appendChild(h('div.mg-h', h('h3', 'Bench'), h('span.mg-sub', 'Drag onto a place, or press')));
    const ul = h('ul.mg-bench');
    const inL = new Set(L().ids), mins = E().minutesOf(E().rotation(lineups, G));
    squad.filter(id => !inL.has(id)).sort((a, b) => (A.slotOfId(a) - A.slotOfId(b)) || (((A.priceOf(b) || {}).value || 0) - ((A.priceOf(a) || {}).value || 0))).forEach(id => {
      const br = A.ui.brief(entryOf(id), id), at = A.attrs(id) || {};
      const li = h('li' + (sel && sel.from === 'bench' && sel.id === id ? '.sel' : ''), { draggable: 'true', tabindex: '0', role: 'button', 'aria-label': A.nameOf(id) + ', bench: role and instructions' },
        h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), A.nm(A.nameOf(id), 'span.nm'),
        h('span.ks', ['rim', 'three', 'pass'].map(k => A.attrChip(at[k]))),
        br.n ? h('span.mg-chip', { title: br.role }, '✎' + br.n) : null, h('span.m', Math.round(mins.get(id) || 0) + '′'));
      li.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'bench', id })); unhint(); });
      li.addEventListener('click', () => { if (sel && sel.from === 'spot') { const k = sel.k; sel = null; place({ from: 'bench', id }, k); return; } openPlayer(id, li, null); });
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPlayer(id, li, null); } });
      li.addEventListener('mouseenter', ev => hint(id, ev.currentTarget, null));
      li.addEventListener('mouseleave', unhint);
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(h('li', { style: { cursor: 'default' } }, 'Everybody is in this lineup.'));
    benchPanel.appendChild(h('div.mg-sub.keys', 'Attributes: rim attack · 3PT · passing'));
    benchPanel.appendChild(ul);
  }

  /* ---- how the five plays: the engine's reading, Football Manager's way ---- */
  function drawRead() {
    readPanel.textContent = '';
    readPanel.appendChild(h('div.mg-h', h('h3', 'How this five plays'), h('span.mg-sub', 'Lineup ' + (cur + 1) + ', with its roles, instructions and minutes')));
    if (!side) { readPanel.appendChild(h('p.mg-sub', 'This lineup could not be read just now.')); return; }
    const f = side.five, pc = v => Math.round(100 * v) + '%';
    const meter = (label, v, lo, hi, txt, hint2, two) => {
      /* the bar: 0 .. 2 x the usual, the usual band shaded; short of it is bad, past it good (for the ball, both bad) */
      const x = Math.max(0, Math.min(1, v / 2));
      const cls = v < lo ? 'lo' : v > hi ? (two ? 'hi' : 'good') : 'ok';
      return h('div.mg-gauge.' + cls, { title: hint2 || '' }, h('div.lab', h('span', label), h('b', txt)),
        h('div.track', h('i.band', { style: { left: (50 * lo).toFixed(1) + '%', width: (50 * (hi - lo)).toFixed(1) + '%' } }), h('i.v', { style: { width: (100 * x).toFixed(1) + '%' } }), h('i.mk', { style: { left: '50%' } })));
    };
    const K = E().ROLEK;
    readPanel.appendChild(h('div.mg-gauges',
      meter('Time on the ball', f.ball / ((K.ballMin + K.ballMax) / 2), K.ballMin / ((K.ballMin + K.ballMax) / 2), K.ballMax / ((K.ballMin + K.ballMax) / 2),
        pc(f.ball) + ' of the ball', 'What the roles ask of one ball: under ' + pc(K.ballMin) + ' nobody runs the offence, over ' + pc(K.ballMax) + ' too many want it', true),
      meter('Pressure on the rim', f.pressure / f.pRef, 0.8, 1.2, pc(f.pressure / f.pRef) + ' of usual', 'Drives, rolls, cuts and post-ups: what opens the threes'),
      meter('Spacing', f.spacing, 0.8, 1.2, pc(f.spacing) + ' of usual', 'Shooters out on the arc that the defence has to guard'),
      meter('Screens', f.screens / f.sRef, 0.7, 1.3, pc(f.screens / f.sRef) + ' of usual', 'What the pick-and-roll and the off-screen shooters need'),
      meter('Passing', f.passing, 0.85, 1.15, pc(f.passing) + ' of usual', 'How well the five moves the ball and finds the open man')));
    const notes = (f.notes || []).map(n => h('li.' + n.lvl, h('i', { 'aria-hidden': 'true' }, n.lvl === 'bad' ? '✖' : n.lvl === 'warn' ? '!' : '✓'),
      h('span', n.text.split('{who}').reduce((acc, part, i, arr) => { acc.push(part); if (i < arr.length - 1) acc.push(h('b', { translate: 'no' }, listNames(n.ids))); return acc; }, []))));
    readPanel.appendChild(h('ul.mg-notes', notes.length ? notes : h('li.good', h('i', '✓'), h('span', 'Nothing stands out: a five that fits together.'))));
    /* each man: his share of the plays (and his true usage: the plays he ends and the shots he makes for others), his
       time on the ball */
    const t = h('table.mg-table.mg-readmen', h('thead', h('tr', h('th.l', 'Place'), h('th.l', 'Role'), h('th', { title: 'The share of the five’s plays he finishes: shots, trips to the line, turnovers' }, 'Plays'),
      h('th', { title: 'True usage: the plays he finishes and the shots he makes for others' }, 'True usage'), h('th', { title: 'His share of the five’s time on the ball' }, 'On the ball'), h('th', { title: 'Where his shots come from' }, 'Rim · 2 · 3'))));
    const tb = h('tbody');
    side.men.forEach((m, k) => {
      const R = roleOfAt(k, m.id);
      tb.appendChild(h('tr', h('td.l', h('span.mg-pos', E().SLOTS[k]), ' ', A.nm(surname(A.nameOf(m.id)))), h('td.l', R.short + (L().roles[k] ? '' : ' (default)')),
        h('td', Math.round(m.u2) + '%'), h('td', Math.round(m.tusg || m.u2) + '%'), h('td', m.onb != null ? Math.round(100 * m.onb) + '%' : '–'),
        h('td', Math.round(100 * m.m.rim) + ' · ' + Math.round(100 * m.m.mid) + ' · ' + Math.round(100 * m.m.three))));
    });
    t.appendChild(tb);
    readPanel.appendChild(h('div.mg-tablewrap', t));
  }
  const listNames = ids => { const n = (ids || []).map(id => surname(A.nameOf(id))); return n.length <= 1 ? (n[0] || 'He') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };

  /* ---- THE ROTATION: the game's minutes, painted a lineup at a time ---- */
  /* the minutes [a, b) to lineup n, taken from whoever had them */
  function paint(n, a, b) {
    lineups.forEach((l, i) => {
      const out = [];
      (l.when || []).forEach(([x, y]) => { if (y <= a || x >= b) out.push([x, y]); else { if (x < a) out.push([x, a]); if (y > b) out.push([b, y]); } });
      l.when = out;
    });
    lineups[n].when = merge(lineups[n].when.concat([[a, b]]));
    tally();
  }
  function merge(ws) {
    const s = ws.filter(w => w[1] > w[0]).map(w => [+w[0], +w[1]]).sort((p, q) => p[0] - q[0]), out = [];
    s.forEach(w => { const l = out[out.length - 1]; if (l && w[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], w[1]); else out.push(w.slice()); });
    return out;
  }
  const whoAt = m => lineups.findIndex(l => (l.when || []).some(([a, b]) => a <= m + 0.5 && m + 0.5 < b));
  let painting = false;
  function drawRot() {
    rotPanel.textContent = '';
    rotPanel.appendChild(h('div.mg-h', h('h3', 'Rotation'), h('span.mg-sub', 'Choose a lineup, then press or drag across the minutes to give it them')));
    const brushes = h('div.mg-brushes', lineups.map((l, i) => h('button.mg-brush', { type: 'button', 'aria-pressed': String(i === brush), style: { '--lc': LC[i] }, onclick: () => { brush = i; drawRot(); } },
      h('i.sw', { 'aria-hidden': 'true' }), 'Lineup ' + (i + 1), h('span', Math.round(l.min) + '′'))));
    const presets = h('div.mg-row.mg-presets',
      h('button.mg-btn.ghost.sm', { type: 'button', title: 'Lineup 1 opens and closes every quarter, the others play the middle, by the minutes they have now', onclick: () => { const w = E().paintOf(lineups.map(l => Object.assign({}, l, { when: null, min: Math.max(1, l.min) })), G); lineups.forEach((l, i) => { l.when = w[i]; }); tally(); changed(); afterMins(); } }, 'Starters open and close'),
      h('button.mg-btn.ghost.sm', { type: 'button', title: 'The same minutes for every lineup', onclick: () => { const w = E().paintOf(lineups.map(l => Object.assign({}, l, { when: null, min: G / lineups.length })), G); lineups.forEach((l, i) => { l.when = w[i]; }); tally(); changed(); afterMins(); } }, 'Share evenly'),
      h('button.mg-btn.ghost.sm', { type: 'button', title: 'Every quarter as the first one is', onclick: () => { const q = G / 4; for (let m = 0; m < q; m++) { const n = whoAt(m); if (n >= 0) for (let k = 1; k < 4; k++) paint(n, m + k * q, m + k * q + 1); } changed(); afterMins(); } }, 'Every quarter as the first'));
    rotPanel.appendChild(h('div.mg-row.between.mg-rothead', brushes, presets));
    /* the lineups' strip: a cell a minute */
    const strip = h('div.mg-rot-strip', { role: 'group', 'aria-label': 'The game’s minutes: press to give a minute to the chosen lineup' });
    for (let m = 0; m < G; m++) {
      const n = whoAt(m);
      const c = h('button.c' + (m % (G / 4) === 0 && m ? '.q' : ''), { type: 'button', style: { '--lc': n >= 0 ? LC[n] : 'transparent' }, 'aria-label': 'Minute ' + (m + 1) + ': lineup ' + (n + 1), title: 'Minute ' + (m + 1) + ' · lineup ' + (n + 1) });
      c.addEventListener('pointerdown', ev => { ev.preventDefault(); painting = true; give(m); });
      c.addEventListener('pointerenter', () => { if (painting) give(m); });
      c.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); give(m); afterMins(); } });
      strip.appendChild(c);
    }
    const stopPaint = () => { if (painting) { painting = false; afterMins(); } };
    strip.addEventListener('pointerup', stopPaint);
    strip.addEventListener('pointerleave', stopPaint);
    /* touch: the finger's cell, as it moves */
    strip.addEventListener('pointermove', ev => {
      if (!painting || ev.pointerType === 'mouse') return;
      const t = root.document.elementFromPoint(ev.clientX, ev.clientY);
      if (t && t.parentNode === strip) { const m = [...strip.children].indexOf(t); if (m >= 0) give(m); }
    });
    function give(m) {
      if (whoAt(m) === brush) return;
      paint(brush, m, m + 1);
      changed();
      const cell = strip.children[m]; if (cell) cell.style.setProperty('--lc', LC[brush]);
    }
    const axis = h('div.mg-rot-ax', ['Q1', 'Q2', 'Q3', 'Q4'].map(q => h('span', q)));
    const grid = h('div.mg-rot');
    grid.appendChild(h('div.mg-rot-row.strip', h('span.nm', h('b', 'Lineup')), strip));
    /* the men's rows, the box score's way: who is on the floor, minute by minute */
    const mins = E().minutesOf(E().rotation(lineups, G));
    const men = [...mins.entries()].sort((a, b) => b[1] - a[1]);
    men.forEach(([id, mm]) => {
      const c = A.cardOf(id), load = c ? E().fatigueLoad(mm, c.usg, G) - E().fatigueLoad(c.mpg, c.usg, G) : 0;
      const cells = h('span.cells');
      for (let m = 0; m < G; m++) { const n = whoAt(m), on = n >= 0 && lineups[n].ids.includes(id); cells.appendChild(h('i' + (on ? '' : '.off') + (m % (G / 4) === 0 && m ? '.q' : ''), on ? { style: { '--lc': LC[n] } } : null)); }
      grid.appendChild(h('div.mg-rot-row', h('span.nm', A.nm(surname(A.nameOf(id)), 'b'), h('small', Math.round(mm) + '′'),
        load > 1 ? h('i.legs.bad', { title: 'Too many minutes for his legs: he tires' }, 'Tired') : load > 0.2 ? h('i.legs.warn', { title: 'More minutes than he is used to' }, 'Heavy') : null), cells));
    });
    grid.appendChild(h('div.mg-rot-row.axis', h('span.nm'), axis));
    rotPanel.appendChild(h('div.mg-rot-wrap', grid));
  }
  /* minutes changed: the tabs, the bench's minutes, the reading (legs) and the chart */
  function afterMins() { read(); drawTabs(); drawBench(); drawCourt(); drawRead(); drawRot(); }

  /* ---- a player's attributes, on hover ---- */
  let tip = null;
  function hint(id, anchor, roleTxt) {
    unhint();
    if (root.document.querySelector('.mg-pop') || !root.matchMedia || !root.matchMedia('(hover: hover)').matches) return;
    tip = h('div.mg-hint.attrs', A.ui.attrCard(id, { role: roleTxt, foot: 'Press for his role and instructions' }));
    root.document.body.appendChild(tip);
    A.place(tip, anchor, { dy: 0 });
  }
  function unhint() { if (tip) { tip.remove(); tip = null; } }

  async function save() {
    try { await A.save({ lineups, roster }); dirty = false; saveBtn.textContent = 'Saved'; saveBtn.classList.remove('pulse'); A.toast('Lineups, roles, tactics and instructions saved.'); }
    catch (e) { A.toast('Could not save: ' + (e && e.message || e), true); }
  }
  root.addEventListener('hashchange', function off() { unhint(); A.ui.close(); root.removeEventListener('hashchange', off); if (dirty) A.save({ lineups, roster }).catch(() => {}); });
  draw();
}

A.views.tactics = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
