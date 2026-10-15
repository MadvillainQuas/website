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
const MAXL = 4, G = 40;
/* each lineup's colour on the chart and its tab */
const LC = ['var(--mg-l0)', 'var(--mg-l1)', 'var(--mg-l2)', 'var(--mg-l3)'];
/* the colour of a man's share of the plays: cool for a few, hot for many */
const heat = u => { const t = Math.max(0, Math.min(1, (u - 12) / 16)); return 'hsl(' + Math.round(205 - 205 * t) + ' 84% ' + Math.round(56 - 8 * t) + '%)'; };
const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const surname = name => { const p = String(name || '').split(/\s+/).filter(Boolean); return p.length > 1 ? p.slice(1).join(' ') : p[0] || ''; };

/* ------------------------------------------------------------------ THE COURT, TO SCALE --- */
/* Louie, 2026-10-15: "this doesn't look like a basketball set up". The half court as a playbook draws it - the basket at the
   top, the half-court line at the foot - in FIBA's own measures, on the same feet the roles' spots are in (roles.js SPOTS:
   u across, v up from the baseline, the basket at v 5.25), ten units a foot: so a wing stands outside the arc, an elbow at
   the corner of the free-throw line, a corner man in the corner. Sidelines 15 m apart (24.6 ft either side), the
   half-court line 14 m out (45.9 ft); the lane 4.9 m wide and 5.8 m deep; the three-point line 6.75 m from the basket,
   6.6 m in the corners; the free-throw circle 1.8 m; the no-charge semicircle 1.25 m; the backboard 1.2 m in. The box
   is drawn at the court's own shape (520 x 485), so nothing is stretched. */
const CW = 520, CH = 485, CX = u => (260 + 10 * u) / CW * 100, CY = v => (15 + 10 * v) / CH * 100;
const COURT_SVG = '<svg class="lines" viewBox="0 0 520 485" preserveAspectRatio="none" aria-hidden="true">' +
  '<rect x="14" y="15" width="492" height="459"/>' +
  '<rect x="179.5" y="15" width="161" height="190"/>' +
  '<path d="M201 205 A59 59 0 0 0 319 205"/><path class="dash" d="M201 205 A59 59 0 0 1 319 205"/>' +
  '<path d="M43.5 15 L43.5 114.2 A221.5 221.5 0 0 0 476.5 114.2 L476.5 15"/>' +
  '<path d="M219 55 L219 67.5 A41 41 0 0 0 301 67.5 L301 55"/>' +
  '<path class="board" d="M230.5 55 L289.5 55"/><circle class="rim" cx="260" cy="67.5" r="7.5"/>' +
  '<path d="M201 474 A59 59 0 0 1 319 474"/></svg>';

/* ------------------------------------------------------------------ THE FIVE LAID OUT ON THE COURT --- */
/* Louie, 2026-10-15: "can the player placing on the tactics screen be much more adaptive and look nicer". Football
   Manager's tactics pitch never lets one tile cover another. Here each man's disc stands at his role's spot (two too close
   for their discs are eased apart) and his nameplate goes on whichever side of him is clear - of the other discs, the
   other nameplates and the court's edge: every arrangement of the five is tried (ten places each, 100,000 in all) and
   the clearest kept - below him first, then above (either slid a little to one side if need be), then beside, then a
   corner. A narrow court has smaller discs and plates;
   one still too crowded for them drops the role line (pressing him still opens it). Again whenever the court's size
   changes. */
const SIDES = [['b', 0], ['t', 1], ['b<', 0.8], ['b>', 0.8], ['t<', 1.8], ['t>', 1.8], ['r', 2.2], ['l', 2.2], ['br', 3.4], ['bl', 3.4]];
const PREF = 60, CLEAR = 60;
/* the overlap of two boxes, each given AIR pixels of room around it */
const AIR = 3;
const inBox = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const ovl = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + 2 * AIR) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + 2 * AIR);
function arrange(spots, W, H) {
  const pad = 4, g = 6, n = spots.length, S = SIDES.length;
  const P = spots.map(sp => ({ x: W * (+sp.dataset.x) / 100, y: H * (+sp.dataset.y) / 100 }));
  const d0 = spots[0].querySelector('.mg-dot'), D = d0 ? d0.offsetWidth || 64 : 64, R = D / 2;
  /* discs too close eased apart, inside the court */
  const md = D * 1.3;
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.hypot(dx, dy);
      if (d >= md) continue;
      if (d < 0.01) { dx = 1; dy = 0; d = 1; }
      const push = (md - d) / 2;
      P[i].x -= dx / d * push; P[i].y -= dy / d * push; P[j].x += dx / d * push; P[j].y += dy / d * push; moved = true;
    }
    P.forEach(p => { p.x = Math.max(R + pad, Math.min(W - R - pad, p.x)); p.y = Math.max(R + pad, Math.min(H - R - pad, p.y)); });
    if (!moved) break;
  }
  const discs = P.map(p => ({ x: p.x - R, y: p.y - R, w: D, h: D })), box = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
  const sz = spots.map(sp => { const l = sp.querySelector('.lab'); return { w: l.offsetWidth, h: l.offsetHeight }; });
  const rect = (i, s) => {
    const p = P[i], w = sz[i].w, h = sz[i].h, c = R * 0.72, sl = s[1] === '<' ? -0.32 * w : s[1] === '>' ? 0.32 * w : 0;
    const v = s[0];
    return (v === 'b' || v === 't') && s !== 'br' && s !== 'bl' ? { x: p.x - w / 2 + sl, y: v === 'b' ? p.y + R + g : p.y - R - g - h, w, h }
      : s === 'r' ? { x: p.x + R + g, y: p.y - h / 2, w, h } : s === 'l' ? { x: p.x - R - g - w, y: p.y - h / 2, w, h }
      : s === 'br' ? { x: p.x + c, y: p.y + c + g / 2, w, h } : { x: p.x - c - w, y: p.y + c + g / 2, w, h };
  };
  /* each plate at each side: off the court, over another's disc */
  const RS = [], base = [];
  for (let i = 0; i < n; i++) {
    RS[i] = []; base[i] = [];
    for (let s = 0; s < S; s++) {
      const r = rect(i, SIDES[s][0]);
      let c = r.w * r.h - inBox(r, box);
      for (let j = 0; j < n; j++) if (j !== i) c += ovl(r, discs[j]);
      RS[i][s] = r; base[i][s] = c;
    }
  }
  /* every arrangement: the plates over each other too */
  let best = null;
  const idx = new Array(n).fill(0), total = Math.pow(S, n);
  for (let c = 0; c < total; c++) {
    let v = c, clash = 0, pref = 0;
    for (let i = 0; i < n; i++) { idx[i] = v % S; v = (v - idx[i]) / S; clash += base[i][idx[i]]; pref += SIDES[idx[i]][1]; }
    if (best && clash + PREF * pref >= best.cost) continue;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) clash += ovl(RS[i][idx[i]], RS[j][idx[j]]);
    const cost = clash + PREF * pref;
    if (!best || cost < best.cost) best = { cost, clash, sides: idx.slice() };
  }
  return { P, R, clash: best.clash, rects: best.sides.map((s, i) => RS[i][s]), sides: best.sides.map(s => SIDES[s][0]) };
}
function fitCourt(court) {
  if (!court || !court.isConnected) return;
  const W = court.clientWidth, H = court.clientHeight, spots = [...court.querySelectorAll('.mg-spot.c')];
  if (!W || !H || !spots.length) return;
  court.classList.toggle('narrow', W < 600);
  /* the fullest plates that fit: with the role line, without it, then small discs with just the name */
  const TIERS = [[], ['tight'], ['tight', 'mini']];
  let L = null, tier = null;
  for (const t of TIERS) {
    court.classList.remove('tight', 'mini');
    t.forEach(c => court.classList.add(c));
    const A2 = arrange(spots, W, H);
    if (!L || A2.clash < L.clash) { L = A2; tier = t; }
    if (A2.clash <= CLEAR) break;
  }
  court.classList.remove('tight', 'mini');
  tier.forEach(c => court.classList.add(c));
  spots.forEach((sp, i) => {
    const p = L.P[i], r = L.rects[i], lab = sp.querySelector('.lab');
    sp.style.left = p.x.toFixed(1) + 'px'; sp.style.top = p.y.toFixed(1) + 'px';
    lab.style.left = (r.x - p.x).toFixed(1) + 'px'; lab.style.top = (r.y - p.y).toFixed(1) + 'px';
    lab.dataset.at = L.sides[i];
    /* a plate not straight above or below its disc is tied to it by a line in his colour */
    const ld = sp.querySelector('.lead');
    if (ld) {
      const nx = Math.max(r.x, Math.min(r.x + r.w, p.x)), ny = Math.max(r.y, Math.min(r.y + r.h, p.y)), dx = nx - p.x, dy = ny - p.y, d = Math.hypot(dx, dy);
      const R0 = L.R + 2, len = d - R0, show = L.sides[i] !== 'b' && L.sides[i] !== 't' && len > 6;
      ld.style.display = show ? 'block' : 'none';
      if (show) { ld.style.width = len.toFixed(1) + 'px'; ld.style.transform = 'rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad) translateX(' + R0.toFixed(1) + 'px)'; }
    }
  });
  court.classList.add('laid');
}
/* the court laid out now and whenever it changes size (one watcher: the court drawn last) */
let courtRO = null;
function watchCourt(court) {
  if (courtRO) courtRO.disconnect();
  courtRO = null;
  const run = () => root.requestAnimationFrame(() => fitCourt(court));
  if (root.ResizeObserver) { courtRO = new root.ResizeObserver(run); courtRO.observe(court); }
  run();
  if (root.document.fonts && root.document.fonts.ready) root.document.fonts.ready.then(run).catch(() => {});
}

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
      h('b', h('i.sw', { 'aria-hidden': 'true' }), (i + 1) + ' · ', h('span', { translate: 'no' }, nameOf(i))), h('span', Math.round(l.min) + ' min' + (l.roles.some(r => !r) ? ' · roles to choose' : '')))));
    if (lineups.length < MAXL) tabs.appendChild(h('button.add', { type: 'button', onclick: addLineup }, h('b', '+ Lineup'), h('span', 'up to four')));
    if (lineups.length > 1) tabs.appendChild(h('button.rm', { type: 'button', onclick: removeLineup }, h('b', '− Remove'), h('span', 'this lineup')));
  }
  function addLineup() {
    const used = new Set(L().ids), rest = squad.filter(id => !used.has(id)).concat(L().ids).slice(0, 5);
    lineups.push({ ids: rest, min: 0, tac: JSON.parse(JSON.stringify(L().tac || {})), roles: [null, null, null, null, null], when: [] });
    const n = lineups.length - 1;
    /* it starts with the middle of each half (four minutes: two a half), taken from whoever had them */
    [[8, 10], [28, 30]].forEach(([a, b]) => paint(n, a, b));
    hist.length = 0;
    cur = n; brush = n; changed(); draw();
  }
  function removeLineup() {
    hist.length = 0;
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
    /* the lineup's name, the reader's to change (Starters, Bench, Closers...) */
    const nameIn = h('input.mg-lname', { type: 'text', value: nameOf(cur), maxlength: '20', 'aria-label': 'Name of lineup ' + (cur + 1), translate: 'no' });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim().slice(0, 20); if (v) L().name = v; else delete L().name; nameIn.value = nameOf(cur); changed(); drawTabs(); drawRot(); });
    courtPanel.appendChild(h('div.mg-h', h('h3', h('i.sw', { style: { '--lc': LC[cur] }, 'aria-hidden': 'true' }), (cur + 1) + ' · ', nameIn),
      h('span.mg-sub', sel ? 'Now press a place or a bench player to swap' : 'Press a player for his role and instructions; drag one from the bench onto a place to bring him in')));
    const court = h('div.mg-court.big.dots');
    court.innerHTML = COURT_SVG;
    const l = L();
    /* THE ALIGNMENT the roles make (roles.layout: each role's home spot - Louie: "player roles imply team spacing"): the
       circles stand where their roles play when the ball is not theirs */
    const lay = RO().layout(l.roles, l.ids.map(id => A.cardOf(id)), A.lg.ref);
    courtPanel.querySelector('.mg-h').appendChild(h('span.mg-chip.royal.mg-align', { title: 'Where the roles stand when the ball is not theirs: ' + lay.out + ' around the arc, ' + lay.inn + ' inside' }, lay.label));
    l.ids.forEach((id, k) => {
      const c = A.cardOf(id), oop = c && RO().posGap(c.pos, k) > 0, m = side ? side.men[k] : null, R = roleOfAt(k, id), chosen = !!l.roles[k];
      const fit = RO().fit(R, c, A.lg.ref), u = m ? m.u2 : (c ? c.usg : 18), onb = m && m.onb != null ? m.onb : 0;
      const ringPct = Math.max(0, Math.min(100, 100 * onb / 0.5));
      const name = A.nameOf(id);
      const dot = h('div.mg-dot' + (sel && sel.from === 'spot' && sel.k === k ? '.sel' : '') + (oop ? '.oop' : ''), {
        style: { '--heat': heat(u), '--ring': ringPct.toFixed(1) + '%' }, draggable: 'true', tabindex: '0', role: 'button',
        'aria-label': E().SLOTS[k] + ': ' + name + ', ' + R.label + (chosen ? '' : ' (default)') + '. Role and instructions' },
        h('span.in', h('b', initials(name)), h('small', Math.round(u) + '%')));
      const badges = [];
      if (oop) badges.push(h('i.bd.oop', { title: 'Two or more positions from his own: it costs both ends' }, '!'));
      if (m && m.lost > 0.02) badges.push(h('i.bd.warn', { title: 'He wants the ball more than this five can give him' }, '⚠'));
      if (m && m.forced > 0.02) badges.push(h('i.bd.warn', { title: 'Nobody else runs the offence: he has to' }, '⚑'));
      const mix = m ? m.m : null;
      const bar = mix ? h('div.mg-mixbar', { title: 'His shots: ' + Math.round(100 * mix.rim) + '% at the rim, ' + Math.round(100 * mix.mid) + '% other twos, ' + Math.round(100 * mix.three) + '% threes' },
        h('i.rim', { style: { width: (100 * mix.rim).toFixed(1) + '%' } }), h('i.mid', { style: { width: (100 * mix.mid).toFixed(1) + '%' } }), h('i.three', { style: { width: (100 * mix.three).toFixed(1) + '%' } })) : null;
      /* his nameplate (FM's player tile): his place and name, his role (press it to choose), his shots */
      const lab = h('div.lab', h('div.nm', h('span.pos', { 'data-i18n-ctx': 'pos' }, E().SLOTS[k]), A.nm(surname(name), 'b')),
        h('button.mg-rolechip.' + fit.band + (chosen ? '' : '.dflt'), { type: 'button', title: chosen ? R.desc : 'No role chosen: he plays the default (' + R.label + '). Press to choose', onclick: ev => { ev.stopPropagation(); openPlayer(id, dot, k); } },
          h('i.mg-fit.' + fit.band, { 'aria-hidden': 'true' }), h('span', R.label), chosen ? null : h('em', ' ▾')),
        bar);
      dot.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'spot', k })); unhint(); });
      dot.addEventListener('click', () => { if (sel) return place(sel, k); openPlayer(id, dot, k); });
      dot.addEventListener('mouseenter', ev => hint(id, ev.currentTarget, R.label + (chosen ? '' : ' (default)')));
      dot.addEventListener('mouseleave', unhint);
      dot.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (sel) place(sel, k); else openPlayer(id, dot, k); } });
      /* his spot on this court (the basket at the foot, ten pixels of the drawing a foot); fitCourt settles the disc and
         his nameplate around it */
      const [su, sv] = lay.at[k], x = CX(su), y = Math.max(3, Math.min(97, CY(sv)));
      const spot = h('div.mg-spot.c', { style: { left: x.toFixed(2) + '%', top: y.toFixed(2) + '%', '--heat': heat(u) }, 'data-x': x.toFixed(2), 'data-y': y.toFixed(2), title: lay.spots[k] }, h('i.lead', { 'aria-hidden': 'true' }), h('div.dotwrap', dot, badges), lab);
      spot.addEventListener('dragover', ev => { ev.preventDefault(); spot.classList.add('over'); });
      spot.addEventListener('dragleave', () => spot.classList.remove('over'));
      spot.addEventListener('drop', ev => { ev.preventDefault(); spot.classList.remove('over'); try { place(JSON.parse(ev.dataTransfer.getData('text/plain')), k); } catch (_) { /* not ours */ } });
      court.appendChild(spot);
    });
    courtPanel.appendChild(court);
    watchCourt(court);
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
      tb.appendChild(h('tr', h('td.l', h('span.mg-pos', E().SLOTS[k]), ' ', A.nm(surname(A.nameOf(m.id)))), h('td.l', R.label + (L().roles[k] ? '' : ' (default)')),
        h('td', Math.round(m.u2) + '%'), h('td', Math.round(m.tusg || m.u2) + '%'), h('td', m.onb != null ? Math.round(100 * m.onb) + '%' : '–'),
        h('td', Math.round(100 * m.m.rim) + ' · ' + Math.round(100 * m.m.mid) + ' · ' + Math.round(100 * m.m.three))));
    });
    t.appendChild(tb);
    readPanel.appendChild(h('div.mg-tablewrap', t));
  }
  const listNames = ids => { const n = (ids || []).map(id => surname(A.nameOf(id))); return n.length <= 1 ? (n[0] || 'He') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };

  /* ---- THE ROTATION: the game's minutes, a lineup at a time ----
     Louie, 2026-10-15: "Please can the rotation editor look nicer and be more intuitive. There needs to be typical
     basketball presets (i.e. lineup 1 [implied to be starting unit] plays 5 minutes in the 1st then gets subbed out, has
     to close out the game in the 4th etc.)". Lineup 1 is the starting unit; each lineup has a name (Starters, Bench...);
     the game's four quarters, a cell a minute, each stretch labelled with its lineup; the patterns a coach uses; an undo. */
  const NAMES = ['Starters', 'Bench', 'Second unit', 'Closers'];
  const nameOf = i => ((lineups[i] && lineups[i].name) || NAMES[i] || 'Lineup ' + (i + 1));
  /* the minutes [a, b) to lineup n, taken from whoever had them */
  function paint(n, a, b) {
    lineups.forEach(l => {
      const out = [];
      (l.when || []).forEach(([x, y]) => { if (y <= a || x >= b) out.push([x, y]); else { if (x < a) out.push([x, a]); if (y > b) out.push([b, y]); } });
      l.when = out;
    });
    lineups[n].when = merge((lineups[n].when || []).concat([[a, b]]));
    tally();
  }
  function merge(ws) {
    const s = ws.filter(w => w[1] > w[0]).map(w => [+w[0], +w[1]]).sort((p, q) => p[0] - q[0]), out = [];
    s.forEach(w => { const l = out[out.length - 1]; if (l && w[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], w[1]); else out.push(w.slice()); });
    return out;
  }
  const whoAt = m => lineups.findIndex(l => (l.when || []).some(([a, b]) => a <= m + 0.5 && m + 0.5 < b));
  /* the undo: each stroke, pattern and removal kept before it happens */
  const hist = [];
  const keep = () => { hist.push(JSON.stringify(lineups.map(l => l.when || []))); if (hist.length > 40) hist.shift(); };
  const undo = () => { const s = hist.pop(); if (!s) return; const w = JSON.parse(s); lineups.forEach((l, i) => { l.when = w[i] || []; }); tally(); changed(); afterMins(); };
  /* THE PATTERNS: [lineup, from, to] in a 40-minute game, for n lineups. The bench minutes go to the bench units in turn
     (lineup 2, then 3, then 4); a closing unit is the last lineup */
  const BU = (n, i) => (n <= 1 ? 0 : 1 + (i % (n - 1)));
  const PATTERNS = [
    { k: 'classic', label: 'Classic', how: 'The starters open each half (6 and 7 minutes), the bench bridges the quarter breaks, and the starters come back to close each half.',
      build: n => [[0, 0, 6], [BU(n, 0), 6, 10], [BU(n, 1), 10, 14], [0, 14, 20], [0, 20, 27], [BU(n, 2), 27, 30], [BU(n, 3), 30, 34], [0, 34, 40]] },
    { k: 'five', label: 'Five-minute starters', how: 'The starters play the first five minutes of the game, sub out, come back for the end of each half and close the game in the fourth.',
      build: n => [[0, 0, 5], [BU(n, 0), 5, 10], [BU(n, 1), 10, 15], [0, 15, 20], [0, 20, 25], [BU(n, 2), 25, 30], [BU(n, 3), 30, 34], [0, 34, 40]] },
    { k: 'ride', label: 'Ride the starters', how: 'The starters play about 31 minutes: short bench stints around the quarter breaks, the starters on for everything that matters.',
      build: n => [[0, 0, 7], [BU(n, 0), 7, 10], [BU(n, 1), 10, 12], [0, 12, 20], [0, 20, 28], [BU(n, 2), 28, 30], [BU(n, 3), 30, 32], [0, 32, 40]] },
    { k: 'platoon', label: 'Platoon', how: 'Five-minute shifts, every lineup in turn: the minutes spread evenly - a deep bench, or legs to save.',
      build: n => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i % n, 5 * i, 5 * i + 5]) },
    { k: 'closers', label: 'Closing unit', need: 2, how: 'As Classic, but your last lineup closes both halves (the last four minutes of the second and fourth quarters): your best five for the end of games.',
      build: n => { const c = n - 1, b = i => (n <= 2 ? 1 : 1 + (i % (n - 2))); return [[0, 0, 6], [b(0), 6, 10], [b(1), 10, 16], [c, 16, 20], [0, 20, 27], [b(2), 27, 30], [0, 30, 36], [c, 36, 40]]; } }
  ];
  function applyPattern(p) {
    keep();
    const n = lineups.length;
    lineups.forEach(l => { l.when = []; });
    p.build(n).forEach(([i, a, b]) => { lineups[Math.min(i, n - 1)].when.push([a, b]); });
    lineups.forEach(l => { l.when = merge(l.when); });
    tally(); changed(); afterMins();
    A.toast(p.label + ': ' + lineups.map((l, i) => nameOf(i) + ' ' + Math.round(l.min) + '′').join(', ') + '.');
  }
  /* a pattern drawn small: its forty minutes in the lineups' colours */
  const preview = p => h('span.mg-pat-bar', { 'aria-hidden': 'true' }, p.build(lineups.length).map(([i, a, b]) => h('i', { style: { '--lc': LC[Math.min(i, lineups.length - 1)], flexGrow: String(b - a) } })));
  /* the clock of a minute: its quarter, and the game clock it runs from and to */
  const clockOf = m => { const q = Math.floor(m / 10), w = m % 10; return 'Q' + (q + 1) + ' ' + (10 - w) + ':00–' + (9 - w) + ':00'; };
  let painting = false;
  function drawRot() {
    rotPanel.textContent = '';
    rotPanel.appendChild(h('div.mg-h', h('h3', 'Rotation'), h('span.mg-sub', 'Who plays when. Start from a pattern, then paint: choose a lineup and drag across the minutes')));
    /* the patterns */
    const pats = h('div.mg-pats');
    PATTERNS.forEach(p => {
      const off = p.need && lineups.length < p.need;
      pats.appendChild(h('button.mg-pat', { type: 'button', disabled: off ? true : null, title: off ? 'Needs two lineups or more' : p.how, onclick: () => applyPattern(p) },
        h('b', p.label), preview(p), h('span', p.how)));
    });
    rotPanel.appendChild(pats);
    /* the brushes: each lineup, its name, its minutes */
    const brushes = h('div.mg-brushes', lineups.map((l, i) => h('button.mg-brush', { type: 'button', 'aria-pressed': String(i === brush), style: { '--lc': LC[i] }, onclick: () => { brush = i; drawRot(); } },
      h('i.sw', { 'aria-hidden': 'true' }), h('b', nameOf(i)), h('span', Math.round(l.min) + '′'))));
    const tools = h('div.mg-row.mg-rottools', h('span.mg-sub', 'Painting with ', h('b', { style: { color: LC[brush] } }, nameOf(brush))),
      h('button.mg-btn.ghost.sm', { type: 'button', disabled: hist.length ? null : true, onclick: undo }, '↶ Undo'));
    rotPanel.appendChild(h('div.mg-row.between.mg-rothead', brushes, tools));
    /* the timeline: four quarters, ten minutes each; the stretches labelled */
    const grid = h('div.mg-rot2');
    grid.appendChild(h('span.nm'));
    [0, 1, 2, 3].forEach(q => grid.appendChild(h('div.mg-rq-h', h('b', 'Q' + (q + 1)), h('span', '10:00'), h('span', '5:00'), h('span', '0:00'))));
    grid.appendChild(h('span.nm.lu', h('b', 'Lineup')));
    const cellsAll = [];
    [0, 1, 2, 3].forEach(q => {
      const box = h('div.mg-rq', { role: 'group', 'aria-label': 'Quarter ' + (q + 1) + ': press or drag to give minutes to ' + nameOf(brush) });
      for (let w = 0; w < 10; w++) {
        const m = q * 10 + w, n = whoAt(m);
        const c = h('button.c', { type: 'button', 'data-m': String(m), style: { '--lc': n >= 0 ? LC[n] : 'transparent', gridColumn: String(w + 1) }, 'aria-label': clockOf(m) + ': ' + (n >= 0 ? nameOf(n) : 'nobody'), title: clockOf(m) + ' · ' + (n >= 0 ? nameOf(n) : '–') });
        c.addEventListener('pointerdown', ev => { ev.preventDefault(); keep(); painting = true; give(m); });
        c.addEventListener('pointerenter', () => { if (painting) give(m); });
        c.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); keep(); give(m); afterMins(); } });
        box.appendChild(c); cellsAll[m] = c;
      }
      /* each stretch of this quarter's minutes, its lineup's name over it */
      let w0 = 0;
      for (let w = 1; w <= 10; w++) {
        const a = whoAt(q * 10 + w0), b = w < 10 ? whoAt(q * 10 + w) : -2;
        if (b !== a) {
          const len = w - w0;
          if (a >= 0) box.appendChild(h('span.run', { style: { gridColumn: (w0 + 1) + ' / span ' + len }, 'aria-hidden': 'true' }, len >= 3 ? nameOf(a) + ' ' + len + '′' : len + '′'));
          w0 = w;
        }
      }
      grid.appendChild(box);
    });
    const stopPaint = () => { if (painting) { painting = false; afterMins(); } };
    grid.addEventListener('pointerup', stopPaint);
    grid.addEventListener('pointerleave', stopPaint);
    /* touch: the finger's cell, as it moves */
    grid.addEventListener('pointermove', ev => {
      if (!painting || ev.pointerType === 'mouse') return;
      const t = root.document.elementFromPoint(ev.clientX, ev.clientY), c = t && t.closest ? t.closest('[data-m]') : null;
      if (c && grid.contains(c)) give(+c.dataset.m);
    });
    function give(m) {
      if (whoAt(m) === brush) return;
      paint(brush, m, m + 1);
      changed();
      const cell = cellsAll[m]; if (cell) cell.style.setProperty('--lc', LC[brush]);
    }
    /* the men's rows, the box score's way: who is on the floor, minute by minute */
    const mins = E().minutesOf(E().rotation(lineups, G));
    const starters = new Set(lineups[0] ? lineups[0].ids.map(String) : []);
    [...mins.entries()].sort((a, b) => (starters.has(b[0]) - starters.has(a[0])) || (b[1] - a[1])).forEach(([id, mm]) => {
      const c = A.cardOf(id), load = c ? E().fatigueLoad(mm, c.usg, G) - E().fatigueLoad(c.mpg, c.usg, G) : 0;
      grid.appendChild(h('span.nm', starters.has(id) ? h('i.st', { title: 'Starter' }, 'S') : null, A.nm(surname(A.nameOf(id)), 'b'), h('small', Math.round(mm) + '′'),
        load > 1 ? h('i.legs.bad', { title: 'Too many minutes for his legs: he tires' }, 'Tired') : load > 0.2 ? h('i.legs.warn', { title: 'More minutes than he is used to' }, 'Heavy') : null));
      [0, 1, 2, 3].forEach(q => {
        const box = h('div.mg-rq.men');
        for (let w = 0; w < 10; w++) { const m = q * 10 + w, n = whoAt(m), on = n >= 0 && lineups[n].ids.includes(id); box.appendChild(h('i' + (on ? '' : '.off'), on ? { style: { '--lc': LC[n] } } : null)); }
        grid.appendChild(box);
      });
    });
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
