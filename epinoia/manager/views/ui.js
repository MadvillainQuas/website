'use strict';
/* ============================================================================
   MANAGER - THE POP-UPS THE TACTICS AND THE LIVE GAME SHARE (Louie, 2026-10-14: "Can the tactics be in a pop up menu at
   the top? Can individual instructions show like football manager if you click/tap on the player?").      Mgr.app.ui

     pop(node, anchor, o)          one floating panel at a time, beside (or under) what opened it; a sheet on a phone;
                                   Escape, a press outside it or its × closes it
     teamPanel(o)                  THE TEAM INSTRUCTIONS in Football Manager's three phases (In possession, In transition,
                                   Out of possession): o {tac, title, sub, onChange(tac), extra (nodes for its foot)}
     playerPanel(id, o)            A PLAYER, FM's way: at a position (o.slot), HIS ROLE there (core/roles.js: the
                                   position's roles, how well each suits him, what it asks, a demonstration), his touches
                                   (two steps either way) and his instructions (the ones his role rules out greyed, and
                                   why); o {entry, onChange(entry), slot, role, onRole(key | null), actions, sub, done}
     roleDemo(role, label)         a role's demonstration: its plays drawn on a half court, frame by frame
     attrCard(id)                  his 1-20 attributes (what the tactics screen shows on hover)
     fitDot(fit)                   the coloured dot of a fit
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const E = () => Mgr.engine, IN = () => Mgr.instruct, RO = () => Mgr.roles;
const doc = root.document;

/* ------------------------------------------------------------------ one pop-up at a time --- */
let cur = null;
function close() {
  if (!cur) return;
  const c = cur; cur = null;
  c.wrap.remove();
  doc.removeEventListener('keydown', c.key, true);
  doc.removeEventListener('pointerdown', c.out, true);
  if (c.o && c.o.onClose) c.o.onClose();
}
function pop(node, anchor, o) {
  close();
  o = o || {};
  const x = h('button.x', { type: 'button', 'aria-label': 'Close', onclick: close }, '×');
  const wrap = h('div.mg-pop' + (o.cls ? '.' + o.cls : ''), { role: 'dialog', 'aria-label': o.label || '' }, x, node);
  (o.host || doc.body).appendChild(wrap);
  place(wrap, anchor, o);
  const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const out = ev => { if (!wrap.contains(ev.target) && !(anchor && anchor.contains && anchor.contains(ev.target)) && !(ev.target.closest && ev.target.closest('.mg-pop-keep'))) close(); };
  doc.addEventListener('keydown', key, true);
  setTimeout(() => doc.addEventListener('pointerdown', out, true), 0);
  cur = { wrap, key, out, o, anchor };
  const first = wrap.querySelector('button:not(.x), input, select');
  try { (first || x).focus({ preventScroll: true }); } catch (_) { /* fine */ }
  return wrap;
}
/* beside the player, under the button that opened it (o.under) or over it (o.above); inside the window, never taller
   than it; a phone's sheet at the foot */
function place(el, anchor, o) {
  const vw = root.innerWidth, vh = root.innerHeight, gap = 10;
  const b = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  el.style.maxHeight = (vh - 2 * gap) + 'px';
  if (!b || vw <= 760) { el.classList.add('sheet'); return; }
  const W = el.offsetWidth, H = Math.min(el.offsetHeight, vh - 2 * gap);
  if (o.above) {
    /* over the button that opened it (the live game's touchline, along the foot) */
    el.style.left = Math.max(gap, Math.min(vw - W - gap, b.left + b.width / 2 - W / 2)) + 'px';
    el.style.top = Math.max(gap, b.top - 8 - H) + 'px';
  } else if (o.under) {
    el.style.left = Math.max(gap, Math.min(vw - W - gap, b.left)) + 'px';
    el.style.top = Math.max(gap, Math.min(vh - H - gap, b.bottom + 8)) + 'px';
  } else {
    const right = b.right + gap, left = b.left - gap - W;
    el.style.left = (right + W <= vw - gap ? right : Math.max(gap, left)) + 'px';
    el.style.top = Math.max(gap, Math.min(vh - H - gap, b.top - 30)) + 'px';
  }
}

/* ------------------------------------------------------------------ the team instructions --- */
const PHASES = ['In possession', 'In transition', 'Out of possession'];
const label = (v, two) => (!v ? 'off' : two ? (v < 0 ? '◀ ' : '') + Math.round(Math.abs(v) * 100) + '%' + (v > 0 ? ' ▶' : '') : Math.round(v * 100) + '%');
function slider(t, tac, onChange) {
  const v = +((tac || {})[t.k] || 0), two = t.lo < 0;
  const rng = h('input.mg-range', { type: 'range', min: String(t.lo * 100), max: String(t.hi * 100), step: '10', value: String(Math.round(v * 100)), 'aria-label': t.label || (t.left + ' or ' + t.right) });
  const out = h('span.v', label(v, two));
  const paint = () => {
    const x = (+rng.value - t.lo * 100) / ((t.hi - t.lo) * 100);
    if (!two) { rng.style.setProperty('--p', (100 * x).toFixed(1) + '%'); return; }
    const a = Math.min(50, 100 * x), b = Math.max(50, 100 * x);
    rng.style.background = 'linear-gradient(90deg, var(--mg-glass-3) ' + a + '%, var(--mg-royal) ' + a + '%, var(--mg-royal) ' + b + '%, var(--mg-glass-3) ' + b + '%)';
  };
  rng.addEventListener('input', () => { const x = +rng.value / 100; out.textContent = label(x, two); paint(); onChange(t.k, x); });
  paint();
  return h('div.mg-slider', h('div.lab', h('span', t.label ? (two ? t.label + ': ' + t.left + ' ↔ ' + t.right : t.label) : (t.left + ' ↔ ' + t.right)), out), rng,
    two ? h('div.ends', h('span', t.left), h('span', t.right)) : null, h('div.how', t.how));
}
function teamPanel(o) {
  let tac = Object.assign({}, o.tac || {}), phase = o.phase || PHASES[0];
  const tabs = h('div.mg-tabs', { role: 'tablist' }), body = h('div.mg-tp-body'), sumLine = h('div.mg-tp-sum');
  const set = (k, v) => { tac = Object.assign({}, tac, { [k]: v }); if (!v) delete tac[k]; drawSum(); if (o.onChange) o.onChange(tac); };
  const draw = () => {
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === phase)));
    body.textContent = '';
    E().TACTICS.filter(t => t.group === phase).forEach(t => body.appendChild(slider(t, tac, set)));
  };
  const drawSum = () => { sumLine.textContent = ''; summary(tac).forEach(s => sumLine.appendChild(h('span.mg-chip', s))); if (!sumLine.children.length) sumLine.appendChild(h('span.mg-sub', 'No team instructions: the players play their own games')); };
  PHASES.forEach(p => tabs.appendChild(h('button', { type: 'button', role: 'tab', 'data-p': p, onclick: () => { phase = p; draw(); } }, p)));
  const reset = h('button.mg-btn.ghost', { type: 'button', onclick: () => {
    const keep = tac.usage ? { usage: tac.usage } : {};
    E().TACTICS.filter(t => t.group === phase).forEach(t => { delete tac[t.k]; });
    tac = Object.assign(keep, tac); draw(); drawSum(); if (o.onChange) o.onChange(tac);
  } }, 'Reset this phase');
  draw(); drawSum();
  return h('div.mg-tp', h('div.mg-tp-hd', h('div', h('h3', o.title || 'Team instructions'), o.sub ? h('div.mg-sub', o.sub) : null)), sumLine, tabs, body,
    h('div.mg-row.between', { style: { marginTop: '10px' } }, reset, o.extra || null));
}
/* the team's instructions in a few words */
function summary(tac) {
  const out = [];
  (E().TACTICS || []).forEach(t => {
    const v = +((tac || {})[t.k] || 0);
    if (!v) return;
    const pct = Math.round(Math.abs(v) * 100) + '%';
    out.push(t.lo < 0 ? (t.label ? t.label + ': ' : '') + (v < 0 ? t.left : t.right) + ' ' + pct : t.label + ' ' + pct);
  });
  return out;
}

/* ------------------------------------------------------------------ his attributes --- */
/* HIS ATTRIBUTES ON HOVER (Louie, 2026-10-14: "Instead of hovering over a player and it showing their season stats, can it
   show their Attributes?"): the eleven 1-20 attributes, coloured as the squad shows them */
function attrCard(id, o) {
  o = o || {};
  const at = A.attrs(id) || {};
  return h('div.mg-attrcard', h('div.hd', h('b', { translate: 'no' }, A.nameOf(id)), h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), o.role ? h('span.r', o.role) : null),
    h('div.mg-attrgrid', Mgr.ratings.ATTRS.map(a => h('div.row', h('span', a.label), A.attrChip(at[a.k])))),
    o.foot ? h('div.mg-sub', o.foot) : null);
}

/* ------------------------------------------------------------------ a role, shown --- */
const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const pctR = v => Math.round(100 * v) + '%';
/* WHAT A ROLE ASKS OF HIM, in a few lines (its loads and its shots, core/roles.js) */
function roleFacts(r) {
  const P = RO().profile(r), out = [];
  if (r.gen) out.push('His own game: his time on the ball, his scoring and his passing stay as they are, and his instructions shape the rest.');
  else {
    out.push(r.init >= 0.35 ? 'Has the ball a lot: he runs the offence.' : r.init >= 0.2 ? 'Shares the ball-handling.' : r.init >= 0.12 ? 'Some time on the ball.' : 'Very little time on the ball.');
    out.push(r.use >= 0.6 ? 'A scorer: looks for his own shot.' : r.use >= 0.2 ? 'Scores when it is there.' : r.use <= -0.4 ? 'Takes few shots of his own.' : 'Shoots as the play asks.');
    if (r.pass >= 0.6) out.push('Looks to set up his teammates first.'); else if (r.pass >= 0.3) out.push('A willing passer.'); else if (r.pass <= -0.2) out.push('Looks for his own shot before the pass.');
  }
  out.push('His shots: ' + pctR(P.mix.rim) + ' at the rim, ' + pctR(P.mix.mid) + ' other twos, ' + pctR(P.mix.three) + ' threes.');
  if (r.screen >= 0.8) out.push('Sets lots of screens.'); else if (r.screen >= 0.4) out.push('Sets some screens.');
  if (r.rip) out.push('Attacks close-outs rather than settling for the three.');
  if (r.crash) out.push('Crashes the offensive glass.');
  if (r.run) out.push('Runs the floor.');
  if (r.def) out.push('Puts his energy into defending the ball and closing out on shooters.');
  if (r.hub) out.push('Keeps the ball moving: handoffs, the extra pass, finding cutters.');
  return out;
}
/* A ROLE'S DEMONSTRATION (Louie: "Can each role also get a visual demonstration?"): its scenes (core/roles.js SCENES) on
   a half court, the basket at the top: the role's man in blue, two teammates, the ball; each frame moves them, a line
   says what is happening, a shot flies to the rim. It plays on a loop (paused for a reader who asks for less motion). */
function roleDemo(role, tag) {
  const scenes = RO().demo(role);
  if (!scenes.length) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => { const x = doc.createElementNS(NS, n); Object.keys(a || {}).forEach(k => x.setAttribute(k, a[k])); return x; };
  const svg = el('svg', { viewBox: '0 0 100 90', class: 'mg-demo-court', role: 'img', 'aria-label': 'A demonstration of the role' });
  const lines = el('g', { class: 'ln' });
  [el('rect', { x: 1, y: 1, width: 98, height: 87, rx: 2 }), el('rect', { x: 35, y: 1, width: 30, height: 35 }), el('path', { d: 'M41 36 A9 9 0 0 0 59 36' }),
    el('path', { d: 'M6 1 L6 14 A44 44 0 0 0 94 14 L94 1' }), el('line', { x1: 44, y1: 5, x2: 56, y2: 5 }), el('circle', { cx: 50, cy: 9, r: 2 }),
    el('path', { d: 'M38 88 A12 12 0 0 1 62 88' })].forEach(x => lines.appendChild(x));
  svg.appendChild(lines);
  const man = (cls, txt) => { const g = el('g', { class: 'man ' + cls }); g.appendChild(el('circle', { r: cls === 'p' ? 4.6 : 3.8 })); const t = el('text', { 'text-anchor': 'middle', dy: '1.6' }); t.textContent = txt; g.appendChild(t); svg.appendChild(g); return g; };
  const gP = man('p', tag || '★'), gT = man('t', ''), gS = man('t', '');
  const ball = el('circle', { class: 'ball', r: 1.7 });
  svg.appendChild(ball);
  const note = h('div.mg-demo-note', ''), dots = h('div.mg-demo-dots');
  const playBtn = h('button.mg-btn.ghost.sm', { type: 'button' }, '❚❚ Pause');
  const wrap = h('div.mg-demo', svg, h('div.mg-demo-foot', note, h('div.mg-row', dots, playBtn)));
  const reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let si = 0, fi = 0, t0 = null, playing = !reduce, started = false, raf = 0;
  const MOVE = 900, HOLD = 700, FLY = 650;
  const setPos = (g, p) => g.setAttribute('transform', 'translate(' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ')');
  const lerp = (a, b, x) => [a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * x];
  const ease = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const holder = (fr, which) => (which === 'P' ? fr.P : which === 'T' ? fr.T : which === 'S' ? fr.S : null);
  const drawDots = () => { dots.textContent = ''; scenes.forEach((s, i) => dots.appendChild(h('button.d' + (i === si ? '.on' : ''), { type: 'button', 'aria-label': 'Scene ' + (i + 1), onclick: () => { si = i; fi = 0; t0 = null; drawDots(); paint(0); } }))); };
  function paint(now) {
    const fr = scenes[si].frames, a = fr[fi], b = fr[Math.min(fr.length - 1, fi + 1)];
    if (t0 == null) t0 = now;
    const el2 = now - t0, last = fi >= fr.length - 1;
    const x = last ? 1 : ease(Math.min(1, el2 / MOVE));
    const P = lerp(a.P, (last ? a : b).P, x), T = lerp(a.T, (last ? a : b).T, x), S = lerp(a.S, (last ? a : b).S, x);
    setPos(gP, P); setPos(gT, T); setPos(gS, S);
    const cur = last ? a : (x < 1 ? a : b);
    note.textContent = (last ? a : b).note || '';
    /* the ball: with its holder, or flying to the rim on a shot (the frame's own: 'rim-P', 'three-T' ...) */
    const shot = last && a.shot ? a.shot : null;
    if (shot) {
      const who = shot.split('-')[1], from = who === 'P' ? P : who === 'T' ? T : S, f = Math.min(1, Math.max(0, (el2 - 150) / FLY));
      const arc = lerp(from, [50, 9], f); arc[1] -= Math.sin(Math.PI * f) * (shot.startsWith('three') ? 9 : 5);
      ball.setAttribute('cx', arc[0].toFixed(2)); ball.setAttribute('cy', arc[1].toFixed(2)); ball.style.opacity = '1';
    } else {
      const hb = holder({ P, T, S }, (last ? a : b).ball || cur.ball);
      if (hb) { ball.setAttribute('cx', (hb[0] + 2.6).toFixed(2)); ball.setAttribute('cy', (hb[1] + 2.2).toFixed(2)); ball.style.opacity = '1'; } else ball.style.opacity = '0';
    }
    gP.classList.toggle('has', ((last ? a : b).ball || '') === 'P');
  }
  function tick(now) {
    if (!wrap.isConnected) { if (started) return; raf = root.requestAnimationFrame(tick); return; }
    started = true;
    if (playing) {
      if (t0 == null) t0 = now;
      const fr = scenes[si].frames, last = fi >= fr.length - 1, el2 = now - t0;
      if (!last && el2 > MOVE + HOLD) { fi++; t0 = now; }
      else if (last && el2 > (fr[fi].shot ? FLY + 1100 : 1300)) { si = (si + 1) % scenes.length; fi = 0; t0 = now; drawDots(); }
      paint(now);
    }
    raf = root.requestAnimationFrame(tick);
  }
  playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play'; t0 = null; });
  if (!playing) playBtn.textContent = '▶ Play';
  drawDots(); paint(0);
  raf = root.requestAnimationFrame(tick);
  void raf;
  return wrap;
}

/* ------------------------------------------------------------------ a player's role and instructions --- */
/* the instructions' choices, as the panel heads them ("His shot" is TENDENCIES: Louie, 2026-10-14) */
const GROUP = { ball: 'On the ball', tempo: 'Tempo', shot: 'Tendencies', move: 'Off the ball', three: 'Threes', screen: 'After his screen', roll: 'The roll',
  post: 'The post', stl: 'Defending the ball', cover: 'Pick-and-roll coverage', rimd: 'At the rim' };
const LONE = { kick: 'Passing', dump: 'Passing', crash: 'The glass', rimp: 'Help defence' };
const fitDot = f => h('i.mg-fit.' + (f && f.band ? f.band : 'a0'), { title: f && f.word ? f.word + (f.why ? ': ' + f.why : '') : '', 'aria-hidden': 'true' });
function touchesText(u) { return u === 0 ? 'His usual touches' : (u > 0 ? 'More touches +' + u : 'Fewer touches ' + u); }
/* the instruction family he takes at a place: his role's (a guard's, a wing's, a big's), else his own position's */
function famOf(id, slot, roleKey) {
  const card = A.cardOf(id), L = A.leagueDataOf(id), ref = (L && L.ref) || A.lg.ref;
  if (slot != null && RO()) { const r = RO().resolve(roleKey || null, slot, card, ref); if (r) return { fam: r.family, role: r }; }
  return { fam: IN().roleOf(card, A.slotOfId(id)), role: null };
}
function playerPanel(id, o) {
  o = o || {};
  const card = A.cardOf(id), L = A.leagueDataOf(id), ref = (L && L.ref) || A.lg.ref;
  let entry = Object.assign({}, o.entry || {}), roleKey = o.role || null;
  const slot = o.slot != null ? o.slot : null;
  const info = h('div.mg-pi-info', 'Press an instruction to see what it does for him.');
  const body = h('div.mg-pi-body');
  const cur0 = () => famOf(id, slot, roleKey);
  const commit = () => { const F = cur0(); entry = Object.assign({}, entry, IN().norm(entry, F.fam)); entry.ins = entry.keys; delete entry.keys; delete entry.role; if (o.onChange) o.onChange(entry); draw(); };
  const say = (d, f, lockWhy) => d.label + ': ' + d.how + '. ' + (lockWhy ? 'Not in his role: ' + lockWhy.toLowerCase() + '.' : 'For him: ' + (f.word || '') + (f.why ? ' - ' + f.why : '.'));
  const draw = () => {
    body.textContent = '';
    const F = cur0(), fam = F.fam, R = F.role;
    const n = IN().norm(entry, fam), set = new Set(n.keys);
    /* HIS ROLE AT THIS PLACE (core/roles.js): the position's roles, how well each suits him; the one chosen, else the
       position's default (what he plays if nothing is chosen) */
    if (slot != null && RO()) {
      /* the position's roles in their categories (Louie, 2026-10-15: "grouped in categories (i.e. all combo roles grouped
         in 'combo' for SG)"), the best fits first in each, every one by its full name ("Slashing Passer PG") */
      const sec = h('div.mg-pi-sec.mg-rolesec'), list = h('div.mg-rolecats');
      const dflt = RO().resolve(null, slot, card, ref);
      const all = RO().forSlot(slot).map(r => ({ r, f: RO().fit(r, card, ref) }));
      RO().CATS[slot].forEach(cat => {
        const inCat = all.filter(x => x.r.cat === cat).sort((a, b) => b.f.s - a.f.s);
        if (!inCat.length) return;
        const grid = h('div.mg-roles');
        inCat.forEach(({ r, f }) => {
          const on = roleKey ? r.key === roleKey : false, isD = r.key === dflt.key;
          grid.appendChild(h('button.mg-role' + (on ? '.on' : '') + (!roleKey && isD ? '.dflt' : ''), { type: 'button', 'aria-pressed': String(on), title: r.desc,
            onclick: () => { roleKey = r.key; if (o.onRole) o.onRole(r.key); draw(); } },
            h('b', r.label), h('span.st.' + f.band, stars(f.stars)), h('span.w', f.word + (isD ? ' · default' : ''))));
        });
        list.appendChild(h('div.mg-rolecat', h('div.mg-rolecat-h', h('span', cat), h('i', inCat.length)), grid));
      });
      const shown = R || dflt, ff = RO().fit(shown, card, ref);
      sec.appendChild(h('div.mg-cap', 'Role at ' + E().SLOTS[slot] + (roleKey ? '' : ' · none chosen: he plays the default')));
      sec.appendChild(list);
      const detail = h('div.mg-roledetail',
        h('div.t', h('b', shown.label), h('span.st.' + ff.band, stars(ff.stars)), h('span.w', ff.word), roleKey ? h('button.mg-chip', { type: 'button', onclick: () => { roleKey = null; if (o.onRole) o.onRole(null); draw(); } }, 'Use the default') : h('span.mg-chip.royal', 'Default')),
        h('p.desc', shown.desc),
        h('ul.facts', roleFacts(shown).map(x => h('li', x))),
        ff.why && ff.why.length ? h('div.why', h('span.mg-cap', 'For him'), h('ul', ff.why.map(x => h('li', x)))) : null);
      const demo = roleDemo(shown, E().SLOTS[slot]);
      sec.appendChild(h('div.mg-rolebox', detail, demo));
      const locks = RO().locks(shown);
      if (locks.size) sec.appendChild(h('div.mg-sub.locks', 'This role rules out: ' + [...locks.keys()].map(k => (IN().BY.get(k) || {}).label).filter(Boolean).join(', ') + '.'));
      body.appendChild(sec);
    }
    /* his touches */
    const u = n.u;
    const pips = h('div.mg-pips', [-2, -1, 0, 1, 2].map(v => h('i' + (v === u ? '.on' : v === 0 ? '.mid' : ''), { 'aria-hidden': 'true' })));
    body.appendChild(h('div.mg-pi-sec', h('div.mg-cap', 'Touches'), h('div.mg-touch',
      h('button.mg-btn', { type: 'button', 'aria-label': 'Fewer touches', disabled: u <= -2 ? true : null, onclick: () => { entry.u = Math.max(-2, u - 1); commit(); } }, '−'),
      h('div.t', h('b', touchesText(u)), pips),
      h('button.mg-btn', { type: 'button', 'aria-label': 'More touches', disabled: u >= 2 ? true : null, onclick: () => { entry.u = Math.min(2, u + 1); commit(); } }, '+')),
      h('div.mg-sub', 'How much of the ball he has: more for a creator costs him little, more for a role player costs him more')));
    /* the instructions, in their phases: what his role rules out is greyed, with why (Louie: "lock off non-compatible
       instructions when these roles are active") */
    const lock = R && RO() ? RO().locks(R) : new Map();
    ['ip', 'op'].forEach(sec => {
      const list = IN().list(fam).filter(d => d.sec === sec);
      if (!list.length) return;
      const box = h('div.mg-pi-sec', h('div.mg-cap', IN().SEC[sec]));
      const groups = new Map();
      /* a choice's options on one row; instructions on their own with the same heading (the two passes) share one too */
      list.forEach(d => { const g = d.x || ('_' + (LONE[d.k] || d.k)); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); });
      groups.forEach((ds, g) => {
        const title = g[0] === '_' ? (LONE[ds[0].k] || '') : (GROUP[g] || '');
        const row = h('div.mg-ins-row', title ? h('span.g', title) : null);
        const opts = h('div.opts');
        ds.forEach(d => {
          const f = IN().fit(d.k, card, ref), on = set.has(d.k), lk = lock.get(d.k) || null;
          const btn = h('button.mg-ins' + (on ? '.on' : '') + (lk ? '.locked' : ''), { type: 'button', 'aria-pressed': String(on), 'aria-disabled': lk ? 'true' : null, title: lk ? lk : d.how,
            onclick: () => {
              if (lk) { info.textContent = say(d, f, lk); return; }
              const nx = IN().toggle(entry, fam, d.k, !on); entry.ins = nx.keys; entry.u = nx.u; commit(); info.textContent = say(d, f) + (d.needs && !set.has(d.needs) ? ' (With it: Roller big.)' : '');
            },
            onmouseenter: () => { info.textContent = say(d, f, lk); } },
            lk ? h('i.mg-lock', { 'aria-hidden': 'true' }, '🔒') : fitDot(f), h('span', d.label));
          opts.appendChild(btn);
        });
        row.appendChild(opts);
        box.appendChild(row);
      });
      body.appendChild(box);
    });
  };
  draw();
  const head = h('div.mg-pi-hd', A.crestOfPlayer ? A.crestOfPlayer(id) : null, h('div.t', h('a', { href: '#/player/' + encodeURIComponent(String(id).replace(/^dup:/, '')), translate: 'no' }, h('b', A.nameOf(id))),
    h('span', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), ' ', o.sub || (slot != null ? 'At ' + E().SLOTS[slot] + ': his role and instructions' : 'Player instructions'))));
  return h('div.mg-pi' + (slot != null ? '.wide' : ''), head, o.actions ? h('div.mg-row', { style: { margin: '2px 0 8px' } }, o.actions) : null, body, info,
    h('div.mg-row.between', { style: { marginTop: '8px' } }, h('button.mg-btn.ghost', { type: 'button', onclick: () => { entry = { u: 0, ins: [] }; commit(); } }, 'Clear his instructions'), o.done || null));
}
/* a man's instructions in a few words (the court's and the bench's cards) */
function brief(entry, id) {
  const card = A.cardOf(id), fam = IN().roleOf(card, A.slotOfId(id)), n = IN().norm(entry || {}, '*');
  void fam;
  return { u: n.u, n: n.keys.length, role: n.keys.length ? n.keys.length + (n.keys.length === 1 ? ' instruction' : ' instructions') : '', keys: n.keys };
}

A.ui = { pop, close, place, teamPanel, playerPanel, summary, brief, fitDot, attrCard, roleDemo, roleFacts, PHASES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
