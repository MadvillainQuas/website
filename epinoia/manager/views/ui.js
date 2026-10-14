'use strict';
/* ============================================================================
   MANAGER - THE POP-UPS THE TACTICS AND THE LIVE GAME SHARE (Louie, 2026-10-14: "Can the tactics be in a pop up menu at
   the top? Can individual instructions show like football manager if you click/tap on the player?").      Mgr.app.ui

     pop(node, anchor, o)          one floating panel at a time, beside (or under) what opened it; a sheet on a phone;
                                   Escape, a press outside it or its × closes it
     teamPanel(o)                  THE TEAM INSTRUCTIONS in Football Manager's three phases (In possession, In transition,
                                   Out of possession): o {tac, title, sub, onChange(tac), extra (nodes for its foot)}
     playerPanel(id, o)            A PLAYER'S INSTRUCTIONS, FM's way: his touches (two steps either way), the roles that
                                   suit him (stars), and each instruction with how well HE suits it; o {entry, onChange(entry),
                                   actions (nodes: swap, sub...), live}
     fitDot(fit)                   the coloured dot of a fit
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const E = () => Mgr.engine, IN = () => Mgr.instruct;
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

/* ------------------------------------------------------------------ a player's instructions --- */
const GROUP = { ball: 'On the ball', tempo: 'Tempo', shot: 'His shot', move: 'Off the ball', three: 'Threes', screen: 'After his screen', roll: 'The roll',
  post: 'The post', stl: 'Defending the ball', cover: 'Pick-and-roll coverage', rimd: 'At the rim' };
const LONE = { kick: 'Passing', dump: 'Passing', crash: 'The glass', rimp: 'Help defence' };
const fitDot = f => h('i.mg-fit.' + (f && f.band ? f.band : 'a0'), { title: f && f.word ? f.word + (f.why ? ': ' + f.why : '') : '', 'aria-hidden': 'true' });
const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
function touchesText(u) { return u === 0 ? 'His usual touches' : (u > 0 ? 'More touches +' + u : 'Fewer touches ' + u); }
function playerPanel(id, o) {
  o = o || {};
  const card = A.cardOf(id), L = A.leagueDataOf(id), ref = (L && L.ref) || A.lg.ref;
  let entry = Object.assign({}, o.entry || {});
  let role = entry.role || IN().roleOf(card, A.slotOfId(id));
  const info = h('div.mg-pi-info', 'Press an instruction to see what it does for him.');
  const body = h('div.mg-pi-body');
  const commit = () => { entry = Object.assign({}, entry, IN().norm(entry, role)); entry.ins = entry.keys; delete entry.keys; if (role !== IN().roleOf(card, A.slotOfId(id))) entry.role = role; else delete entry.role; if (o.onChange) o.onChange(entry); draw(); };
  const draw = () => {
    body.textContent = '';
    const n = IN().norm(entry, role), set = new Set(n.keys);
    /* his touches */
    const u = n.u;
    const pips = h('div.mg-pips', [-2, -1, 0, 1, 2].map(v => h('i' + (v === u ? '.on' : v === 0 ? '.mid' : ''), { 'aria-hidden': 'true' })));
    body.appendChild(h('div.mg-pi-sec', h('div.mg-cap', 'Touches'), h('div.mg-touch',
      h('button.mg-btn', { type: 'button', 'aria-label': 'Fewer touches', disabled: u <= -2 ? true : null, onclick: () => { entry.u = Math.max(-2, u - 1); commit(); } }, '−'),
      h('div.t', h('b', touchesText(u)), pips),
      h('button.mg-btn', { type: 'button', 'aria-label': 'More touches', disabled: u >= 2 ? true : null, onclick: () => { entry.u = Math.min(2, u + 1); commit(); } }, '+')),
      h('div.mg-sub', 'How much of the ball he has: more for a creator costs him little, more for a role player costs him more')));
    /* the roles that suit him */
    const pre = IN().presetOf(entry, role);
    const roles = h('div.mg-roles');
    IN().roles(role).forEach(p => {
      const f = IN().roleFit(p, card, ref);
      roles.appendChild(h('button.mg-role' + (pre && pre.k === p.k ? '.on' : ''), { type: 'button', title: p.how + ' · ' + f.word, 'aria-pressed': String(!!(pre && pre.k === p.k)),
        onclick: () => { entry.ins = p.keys.slice(); entry.u = p.u; commit(); info.textContent = p.label + ': ' + p.how + '. For him: ' + f.word + '.'; } },
        h('b', p.label), h('span.st.' + f.band, stars(f.stars)), h('span.w', f.word)));
    });
    body.appendChild(h('div.mg-pi-sec', h('div.mg-cap', 'Roles'), roles));
    /* the instructions, in their phases */
    ['ip', 'op'].forEach(sec => {
      const list = IN().list(role).filter(d => d.sec === sec);
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
          const f = IN().fit(d.k, card, ref), on = set.has(d.k), blocked = d.needs && !set.has(d.needs);
          opts.appendChild(h('button.mg-ins' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), title: d.how,
            onclick: () => { const nx = IN().toggle(entry, role, d.k, !on); entry.ins = nx.keys; entry.u = nx.u; commit(); info.textContent = d.label + ': ' + d.how + '. For him: ' + (f.word || '') + (f.why ? ' (' + f.why + ')' : '') + (blocked ? '. With it: Roller big.' : '.'); },
            onmouseenter: () => { info.textContent = d.label + ': ' + d.how + '. For him: ' + (f.word || '') + (f.why ? ' (' + f.why + ')' : '') + '.'; } },
            fitDot(f), h('span', d.label)));
        });
        row.appendChild(opts);
        box.appendChild(row);
      });
      body.appendChild(box);
    });
  };
  const roleSel = h('select.mg-in', { 'aria-label': 'Instructions as', style: { width: 'auto', padding: '6px 9px', fontSize: '12px' } },
    ['g', 'w', 'b'].map(k => h('option', { value: k, selected: k === role ? true : null }, 'As a ' + IN().ROLE[k].toLowerCase())));
  roleSel.addEventListener('change', () => { role = roleSel.value; commit(); });
  draw();
  const head = h('div.mg-pi-hd', A.crestOfPlayer ? A.crestOfPlayer(id) : null, h('div.t', h('a', { href: '#/player/' + encodeURIComponent(String(id).replace(/^dup:/, '')), translate: 'no' }, h('b', A.nameOf(id))),
    h('span', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id)), ' ', o.sub || 'Player instructions')), roleSel);
  return h('div.mg-pi', head, o.actions ? h('div.mg-row', { style: { margin: '2px 0 8px' } }, o.actions) : null, body, info,
    h('div.mg-row.between', { style: { marginTop: '8px' } }, h('button.mg-btn.ghost', { type: 'button', onclick: () => { entry = { u: 0, ins: [] }; commit(); } }, 'Clear his instructions'), o.done || null));
}
/* a man's instructions in a few words (the court's cards) */
function brief(entry, id) {
  const card = A.cardOf(id), role = (entry && entry.role) || IN().roleOf(card, A.slotOfId(id)), n = IN().norm(entry || {}, role);
  const pre = IN().presetOf(entry || {}, role);
  return { u: n.u, n: n.keys.length, role: pre ? pre.label : n.keys.length ? n.keys.length + (n.keys.length === 1 ? ' instruction' : ' instructions') : '', keys: n.keys };
}

A.ui = { pop, close, place, teamPanel, playerPanel, summary, brief, fitDot, PHASES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
