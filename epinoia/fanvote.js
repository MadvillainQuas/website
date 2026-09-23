'use strict';
/* ============================================================================
   MAKE YOUR VOICE HEARD — the weekly fans' vote on a league's front page
   (migration 0148, docs/fanvote.md).

   Two things on the page:

   THE PANEL. The first time somebody opens the league's page in a week the
   league played, a panel in the league's colour unrolls out of the rule under
   the hero and asks WHO WAS THE BEST LAST WEEK? — the week's fifteen best players by
   BPM, to be put 1st, 2nd and 3rd by dragging them onto a podium (or tapping them
   in order) — and then WHO HAD THE BEST PERFORMANCE? — every club that won that
   week, one slot, skippable. Once a week: closing it, voting, or just leaving it
   are all "seen", and only REMIND ME LATER brings it back by itself (six hours
   on). DON'T SHOW THIS AGAIN turns it off for good: for the account when signed
   in (fan_prefs.want_fanvote, which the profile can turn back on), for the
   browser otherwise. It can always be opened by hand from the section below.

   THE WINNERS. Above the Stars: last week's fans' player and club of the week,
   with the laurels, and a way into the open vote and into every week's winners.

   The ballot is the SERVER'S (the fanvote function picks it with the Stars
   podium's own rule; this file only draws what fanvote_state returns), and the
   vote is one per browser or per account (fanvote_cast). The voter key is the
   Team of the Year ballot's (toty.js), so one browser is one voter everywhere.

   Pure logic (the once-a-week rule, the podium's moves) is exported and run by
   supabase/tests/fanvote.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFanVote = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const STORE = 'epinoia.fanvote';
const VOTER_KEY = 'epinoia.ballot.voter';          // the Team of the Year ballot's (toty.js)
const LATER_MS = 6 * 3600 * 1000;                  // "remind me later": the next visit six hours on
const KEEP_MS = 60 * 86400 * 1000;                 // a round's note is forgotten after two months
const PLACES = ['1st', '2nd', '3rd'];

/* ---------------------------------------------------------- pure logic --- */

/* Has this voter finished the round? Players: as many as the ballot allows,
   up to three. Club: picked or skipped, unless there were no clubs to pick. */
function fullyVoted(open) {
  const b = open && open.ballot;
  if (!b) return false;
  const need = Math.min(3, ((open && open.players) || []).length);
  const playersDone = need === 0 || ((b.players || []).length >= need);
  const clubDone = !((open && open.teams) || []).length || !!b.team || !!b.skipped;
  return playersDone && clubDone;
}

/* THE ONCE-A-WEEK RULE. Opens by itself only on the first visit to the league
   in a round (anything after that — closed, voted, or simply seen — is "seen"),
   or on the first visit after "remind me later" ran out. Never once voted, never
   when the account's switch is off, and never for a signed-out browser that
   said "don't show this again". A signed-in fan's switch outranks the browser's
   note, so turning it back on in the profile works on every device. */
function shouldAutoOpen(state, store, now) {
  const open = state && state.open;
  if (!open || state.off) return false;
  if (!(open.players || []).length && !(open.teams || []).length) return false;
  if (fullyVoted(open)) return false;
  if (state.prompt === false) return false;
  if (state.prompt !== true && store && store.never) return false;
  const note = ((store && store.rounds) || {})[open.round_id];
  if (!note) return true;
  if (note.later) return now >= note.later;
  return false;
}

/* Where a voter who comes back starts: the players unless they are in, then
   the club unless that is in, then the thank-you. */
function firstStage(open) {
  const b = open && open.ballot;
  const need = Math.min(3, ((open && open.players) || []).length);
  if (need && !(b && (b.players || []).length >= need)) return 'players';
  if (((open && open.teams) || []).length && !(b && (b.team || b.skipped))) return 'team';
  return 'done';
}

/* THE PODIUM'S MOVES, as a pure function of the picks (an array, one id or null
   per place). place(): the card goes to that place; whatever was there goes to
   where the card came from (a swap between places) or back to the deck.
   tap(): into the first empty place, or out again if it is already placed. */
function place(picks, id, to, from) {
  const next = picks.slice();
  const was = next.indexOf(id);
  const displaced = next[to];
  if (was >= 0) next[was] = null;
  next[to] = id;
  if (displaced && displaced !== id) {
    if (typeof from === 'number' && from !== to && next[from] == null) next[from] = displaced;
  }
  return next;
}
function tap(picks, id) {
  const next = picks.slice();
  const at = next.indexOf(id);
  if (at >= 0) { next[at] = null; return { picks: next, full: false }; }
  const free = next.indexOf(null);
  if (free < 0) {
    if (next.length === 1) { next[0] = id; return { picks: next, full: false }; }   // one slot: replace
    return { picks: next, full: true };
  }
  next[free] = id;
  return { picks: next, full: false };
}

/* the week, in the reader's calendar: "15–21 Sept" */
function weekLabel(startsAt, endsAt, locale) {
  try {
    const a = new Date(startsAt), b = new Date(new Date(endsAt).getTime() - 1);
    const d = x => x.toLocaleDateString(locale || 'en-GB', { day: 'numeric' });
    const dm = x => x.toLocaleDateString(locale || 'en-GB', { day: 'numeric', month: 'short' });
    return a.getMonth() === b.getMonth() ? d(a) + '–' + dm(b) : dm(a) + ' – ' + dm(b);
  } catch (_) { return ''; }
}

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function monogram(t) {
  const s = String((t && t.short_name) || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const words = String((t && t.name) || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String((t && t.name) || '?').slice(0, 2).toUpperCase();
}

/* a player's week: "21p 8r 4a" (per game, as the Stars print it) */
function lineText(l) {
  if (!l) return '';
  const f = (v, s) => (v == null ? '' : (Number(v).toFixed(v % 1 ? 1 : 0) + s));
  return [f(l.ppg, 'p'), f(l.rpg, 'r'), f(l.apg, 'a')].filter(Boolean).join(' ');
}
function bpmText(l) {
  if (!l || l.bpm == null) return '';
  return (l.bpm > 0 ? '+' : '') + Number(l.bpm).toFixed(1) + ' BPM';
}
/* a club's week: "W 80–70 v OWL" for one game, "2–0 · +24" for more */
function recordText(l) {
  if (!l) return '';
  const res = l.results || [];
  if (res.length === 1) {
    const r = res[0];
    return (r.won ? 'W ' : 'L ') + r.for + '–' + r.against + (r.vs ? ' v ' + r.vs : '');
  }
  return (l.wins || 0) + '–' + (l.losses || 0) + (l.diff ? ' · ' + (l.diff > 0 ? '+' : '') + l.diff : '');
}

/* ---------------------------------------------------------- the store --- */
function storage() { try { return root.localStorage || null; } catch (_) { return null; } }
function readStore() {
  const ls = storage();
  try {
    const j = ls ? JSON.parse(ls.getItem(STORE) || '{}') : {};
    return j && typeof j === 'object' ? Object.assign({ rounds: {} }, j) : { rounds: {} };
  } catch (_) { return { rounds: {} }; }
}
function writeStore(s) {
  const ls = storage();
  if (!ls) return;
  const now = Date.now();
  Object.keys(s.rounds || {}).forEach(k => {
    const n = s.rounds[k];
    if (!n || !(n.at > now - KEEP_MS)) delete s.rounds[k];
  });
  try { ls.setItem(STORE, JSON.stringify(s)); } catch (_) { /* full, or private browsing */ }
}
function note(roundId, patch) {
  const s = readStore();
  s.rounds = s.rounds || {};
  s.rounds[roundId] = Object.assign({}, patch, { at: Date.now() });
  writeStore(s);
}

/* the Team of the Year ballot's key: one browser is one voter */
function voterKey() {
  const ls = storage();
  try {
    let v = ls && ls.getItem(VOTER_KEY);
    if (!v) {
      v = (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID()
        : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      if (ls) ls.setItem(VOTER_KEY, v);
    }
    return v;
  } catch (_) {
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
}

/* ------------------------------------------------------------- the DOM --- */
const doc = () => root.document;
function el(t, c, x) {
  const n = doc().createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n;
}
function btn(c, x, label) {
  const b = el('button', c, x); b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
}
const reduced = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

function paint(a, colour, colour2) {
  const TC = root.EpinoiaTeamColour;
  if (TC && TC.card) TC.card(a, colour || '#93f2bf', colour2);
  else a.style.setProperty('--ink-c', colour || '#93f2bf');
}
function logoUrl(path) {
  if (!path || typeof root.epinoiaLogoUrl !== 'function') return null;
  try { return root.epinoiaLogoUrl(path); } catch (_) { return null; }
}

/* THE CARD — the club plate every card on this page is drawn from (kit/card.css),
   the player's initials where a club's monogram goes and the week's BPM across
   the band, so it reads as the Stars' card it is. */
function plate(markText, bandText, logo) {
  const p = el('div', 'club-plate');
  p.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => p.appendChild(el('span', 'club-reg ' + c)));
  const mark = el('div', 'club-mark');
  const mono = () => mark.append(el('span', 'club-mono ghost', markText), el('span', 'club-mono', markText));
  if (logo) {
    const img = el('img', 'club-logo'); img.src = logo; img.alt = ''; img.loading = 'lazy';
    img.draggable = false;
    img.addEventListener('error', () => { img.remove(); mono(); });
    mark.appendChild(img);
  } else mono();
  p.appendChild(mark);
  if (bandText) {
    const band = el('div', 'club-band'); band.appendChild(el('span', null, bandText));
    p.appendChild(band);
  }
  p.appendChild(el('div', 'club-grain'));
  return p;
}

function playerCard(p) {
  const team = p.team || {};
  const b = btn('club star small fv-card');
  b.dataset.id = p.id;
  paint(b, team.colour, team.colour_2);
  b.setAttribute('aria-label', p.name + (team.name ? ', ' + team.name : '') +
    (p.line && p.line.bpm != null ? ', ' + bpmText(p.line) : ''));
  const foot = el('div', 'club-foot star-foot');
  const who = el('div', 'star-who');
  who.append(el('span', 'star-name', p.name), el('span', 'star-team', team.short_name || team.name || ''));
  foot.append(who, el('span', 'club-ed', lineText(p.line)));
  b.append(plate(initials(p.name), bpmText(p.line)), foot);
  return b;
}

function teamCard(t) {
  const b = btn('club small fv-card fv-team');
  b.dataset.id = t.id;
  paint(b, t.colour, t.colour_2);
  b.setAttribute('aria-label', t.name + ', ' + recordText(t.line));
  const foot = el('div', 'club-foot');
  foot.append(el('span', 'club-name', t.name));
  b.append(plate(monogram(t), recordText(t.line), logoUrl(t.logo_path)), foot);
  return b;
}

/* ----------------------------------------------------------- the podium ---
   picker(): a deck of cards and a row of places. A card goes in by dragging it
   onto a place (mouse: press and move; touch: press and hold, then move, so a
   swipe still scrolls the page) or by tapping it (into the first empty place).
   A placed card comes out by tapping its place or dragging it off. Places swap
   by dragging one onto another. Buttons throughout, so a keyboard does all of
   it with Tab and Enter. */
function picker(o) {
  let picks = new Array(o.slots.length).fill(null);
  const cards = new Map();
  o.cards.forEach(c => cards.set(c.dataset.id, c));
  let quietUntil = 0;
  let drag = null;

  function render() {
    cards.forEach((c, id) => {
      const at = picks.indexOf(id);
      c.classList.toggle('picked', at >= 0);
      c.dataset.place = at >= 0 ? String(at + 1) : '';
    });
    o.slots.forEach((s, i) => {
      const id = picks[i];
      const was = s.dataset.id || '';
      s.dataset.id = id || '';
      s.classList.toggle('filled', !!id);
      const hold = s.querySelector('.fv-hold');
      if (id !== (was || null)) {
        hold.textContent = '';
        if (id && cards.has(id)) {
          const mini = cards.get(id).cloneNode(true);
          mini.removeAttribute('data-place');
          mini.classList.remove('picked', 'lifting');
          mini.classList.add('fv-mini');
          mini.tabIndex = -1;
          mini.setAttribute('aria-hidden', 'true');
          hold.appendChild(mini);
          if (!reduced()) { s.classList.remove('landed'); void s.offsetWidth; s.classList.add('landed'); }
        }
      }
      s.setAttribute('aria-label', (o.labels ? o.labels[i] : PLACES[i]) +
        (id && cards.has(id) ? ': ' + cards.get(id).getAttribute('aria-label') + '. Tap to take it off.' : ': empty'));
    });
    o.onChange(picks.slice());
  }
  function set(next) { picks = next; render(); }

  function hint(msg) {
    if (!o.hint) return;
    o.hint.textContent = msg;
    o.hint.classList.remove('shake'); void o.hint.offsetWidth; o.hint.classList.add('shake');
  }

  /* tapping */
  o.deck.addEventListener('click', e => {
    const c = e.target.closest('.fv-card');
    if (!c || Date.now() < quietUntil) return;
    const r = tap(picks, c.dataset.id);
    if (r.full) { hint('Your podium is full: tap a place to clear it first.'); return; }
    set(r.picks);
  });
  o.slots.forEach((s, i) => s.addEventListener('click', () => {
    if (Date.now() < quietUntil || !picks[i]) return;
    const next = picks.slice(); next[i] = null; set(next);
  }));

  /* dragging */
  const slotAt = (x, y) => {
    const hit = doc().elementFromPoint(x, y);
    const s = hit && hit.closest && hit.closest('.fv-slot');
    return s && o.slots.indexOf(s) >= 0 ? o.slots.indexOf(s) : -1;
  };
  const stopScroll = e => { if (drag && drag.started) e.preventDefault(); };

  function begin() {
    if (!drag || drag.started) return;
    drag.started = true;
    clearTimeout(drag.timer);
    const r = drag.src.getBoundingClientRect();
    const g = (drag.from === 'deck' ? drag.src : cards.get(drag.id)).cloneNode(true);
    g.classList.remove('picked'); g.classList.add('fv-ghost');
    g.removeAttribute('data-place');
    g.style.width = r.width + 'px';
    g.setAttribute('aria-hidden', 'true');
    doc().body.appendChild(g);
    drag.ghost = g;
    drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
    move(drag.x0, drag.y0);
    drag.src.classList.add('lifting');
    doc().addEventListener('touchmove', stopScroll, { passive: false });
    try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(8); } catch (_) { /* no haptics */ }
  }
  function move(x, y) {
    if (!drag || !drag.ghost) return;
    drag.ghost.style.transform = 'translate(' + (x - drag.dx) + 'px,' + (y - drag.dy) + 'px) rotate(-3deg)';
    const at = slotAt(x, y);
    o.slots.forEach((s, i) => s.classList.toggle('over', i === at));
  }
  function end() {
    if (!drag) return;
    clearTimeout(drag.timer);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    doc().removeEventListener('touchmove', stopScroll, { passive: false });
    if (drag.ghost) drag.ghost.remove();
    drag.src.classList.remove('lifting');
    o.slots.forEach(s => s.classList.remove('over'));
    drag = null;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (!drag.started) {
      if (drag.touch) { if (dist > 10) end(); return; }      // a swipe: the page scrolls
      if (dist < 5) return;
      begin();
    }
    e.preventDefault();
    move(e.clientX, e.clientY);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (drag.started) {
      const at = slotAt(e.clientX, e.clientY);
      if (at >= 0) set(place(picks, drag.id, at, drag.from));
      else if (drag.from !== 'deck') { const next = picks.slice(); next[drag.from] = null; set(next); }
      quietUntil = Date.now() + 350;                  // the click that follows a drop is not a tap
    }
    end();
  }
  function onCancel() { end(); }

  o.root.addEventListener('pointerdown', e => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const src = e.target.closest('.fv-card, .fv-slot.filled');
    if (!src || !o.root.contains(src) || src.classList.contains('fv-mini')) return;
    const fromSlot = src.classList.contains('fv-slot');
    const id = src.dataset.id;
    if (!id || !cards.has(id)) return;
    drag = { id, src, from: fromSlot ? o.slots.indexOf(src) : 'deck',
             x0: e.clientX, y0: e.clientY, pid: e.pointerId, started: false,
             touch: e.pointerType !== 'mouse' };
    if (drag.touch) drag.timer = setTimeout(begin, 170);
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) end(); });

  return {
    get: () => picks.slice(),
    set: ids => set(o.slots.map((_, i) => (ids && ids[i] && cards.has(ids[i]) ? ids[i] : null)))
  };
}

/* ------------------------------------------------------------- the panel --- */
function podium(n, labels) {
  const row = el('div', 'fv-podium' + (n === 1 ? ' one' : ''));
  const slots = [];
  for (let i = 0; i < n; i++) {
    const s = btn('fv-slot p' + (i + 1));
    s.dataset.idx = String(i);
    s.append(el('span', 'fv-place', labels[i]), el('span', 'fv-hold'));
    slots.push(s);
  }
  /* on a wide screen the podium stands 2nd, 1st, 3rd; the DOM stays 1st, 2nd,
     3rd for a screen reader and the keyboard, and CSS order draws the podium */
  slots.forEach(s => row.appendChild(s));
  return { row, slots };
}

/* THE STRIP. Every card on one row that scrolls sideways, with a button at each end
   that moves it a strip's width at a time (and is dimmed when there is no further
   to go), so fifteen players and every winning club fit in a panel that does not
   take over the page. A swipe scrolls it on a phone; a card is still dragged from
   it with a press and hold, or tapped. */
function rail(deck, label) {
  const wrap = el('div', 'fv-rail');
  const prev = btn('fv-nav prev', '\u2039', 'Previous ' + label);
  const next = btn('fv-nav next', '\u203a', 'More ' + label);
  wrap.append(prev, deck, next);
  const step = dir => {
    const by = Math.max(120, Math.round(deck.clientWidth * 0.85));
    try { deck.scrollBy({ left: dir * by, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch (_) { deck.scrollLeft += dir * by; }
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  const paint = () => {
    const max = deck.scrollWidth - deck.clientWidth;
    prev.disabled = deck.scrollLeft <= 2;
    next.disabled = deck.scrollLeft >= max - 2;
    wrap.classList.toggle('fits', max <= 2);
  };
  deck.addEventListener('scroll', paint, { passive: true });
  try { new root.ResizeObserver(paint).observe(deck); } catch (_) { root.addEventListener('resize', paint); }
  return { wrap, paint };
}

function buildPanel(ctx) {
  const open = ctx.state.open;
  const sec = el('section', 'fv');
  sec.id = 'fv';
  sec.setAttribute('aria-label', 'Make your voice heard');
  const roll = el('div', 'fv-roll');
  const inner = el('div', 'fv-in');
  const body = el('div', 'fv-body');
  roll.appendChild(inner); inner.appendChild(body); sec.appendChild(roll);

  const x = btn('fv-x', '×', 'Close');
  const head = el('div', 'fv-head');
  head.append(el('div', 'fv-title', 'Make Your Voice Heard'),
              el('div', 'fv-week', 'The week of ' + weekLabel(open.starts_at, open.ends_at) +
                 ' · voting closes ' + closesText(open.closes_at)));
  body.append(x, head);

  const stages = el('div', 'fv-stages');
  body.appendChild(stages);

  /* 1. the players */
  const sp = el('div', 'fv-stage'); sp.dataset.stage = 'players';
  const needP = Math.min(3, open.players.length);
  const pask = el('div', 'fv-ask');
  sp.appendChild(pask);
  pask.append(el('h3', 'fv-q', 'Who Was The Best Last Week?'),
            el('p', 'fv-how', needP === 3
              ? 'Drag three onto the podium, or tap them in order: 1st, 2nd, 3rd.'
              : 'Put the players in order, best first.'));
  const pp = podium(needP, PLACES);
  const pdeck = el('div', 'fv-deck');
  const pcards = open.players.map(playerCard);
  pcards.forEach(c => pdeck.appendChild(c));
  const prail = rail(pdeck, 'players');
  const pplay = el('div', 'fv-play');
  pplay.append(pp.row, prail.wrap);
  const phint = el('p', 'fv-hint'); phint.setAttribute('aria-live', 'polite');
  const pgo = btn('fv-go', 'Confirm');
  pgo.disabled = true;
  const pacts = el('div', 'fv-acts'); pacts.append(phint, pgo);
  sp.append(pplay, pacts);
  const pick1 = picker({ root: sp, deck: pdeck, slots: pp.slots, cards: pcards, hint: phint,
                         labels: PLACES, onChange: ps => { pgo.disabled = ps.some(v => !v); if (!ps.some(v => !v)) phint.textContent = ''; } });

  /* 2. the club */
  const st = el('div', 'fv-stage'); st.dataset.stage = 'team';
  const task = el('div', 'fv-ask');
  st.appendChild(task);
  task.append(el('h3', 'fv-q', 'Who Had The Best Performance?'),
            el('p', 'fv-how', 'Every club that won last week. Drag one into the slot, or tap it.'));
  const tp = podium(1, ['Team of the week']);
  const tdeck = el('div', 'fv-deck teams');
  const tcards = open.teams.map(teamCard);
  tcards.forEach(c => tdeck.appendChild(c));
  const trail = rail(tdeck, 'clubs');
  const tplay = el('div', 'fv-play');
  tplay.append(tp.row, trail.wrap);
  const thint = el('p', 'fv-hint'); thint.setAttribute('aria-live', 'polite');
  const tskip = btn('fv-skip', 'Skip');
  const tgo = btn('fv-go', 'Confirm'); tgo.disabled = true;
  const tacts = el('div', 'fv-acts'); tacts.append(thint, tskip, tgo);
  st.append(tplay, tacts);
  const pick2 = picker({ root: st, deck: tdeck, slots: tp.slots, cards: tcards, hint: thint,
                         labels: ['Team of the week'], onChange: ps => { tgo.disabled = !ps[0]; } });

  /* 3. done */
  const sd = el('div', 'fv-stage'); sd.dataset.stage = 'done';
  const stamp = el('div', 'fv-stamp', 'Vote cast');
  const said = el('div', 'fv-said');
  const change = btn('fv-change', 'Change my vote');
  sd.append(stamp, el('h3', 'fv-q', 'Thank you. Your voice is heard.'), said,
            el('p', 'fv-how', 'The fans’ player and club of the week go up on this page when voting closes, ' +
                               closesText(open.closes_at) + '.'),
            change);

  [sp, st, sd].forEach(s => { s.hidden = true; stages.appendChild(s); });
  if (!needP) sp.remove();
  if (!open.teams.length) st.remove();

  const foot = el('div', 'fv-foot');
  const later = btn('fv-later', 'Remind me later');
  const never = btn('fv-never', 'Don’t show this again');
  foot.append(later, never);
  body.appendChild(foot);

  const b = open.ballot || {};
  if (b.players && b.players.length) pick1.set(b.players);
  if (b.team) pick2.set([b.team]);

  return { sec, body, stages, foot, x, later, never, pgo, tgo, tskip, change, said,
           pick1, pick2, rails: [prail, trail], stage: { players: sp, team: st, done: sd } };
}

function closesText(iso) {
  try {
    const d = new Date(new Date(iso).getTime() - 60000);
    return d.toLocaleDateString('en-GB', { weekday: 'long' }) + ' night';
  } catch (_) { return 'on Thursday night'; }
}

/* ----------------------------------------------------- the laurels ---
   A wreath drawn, not loaded: two branches of leaves on an arc, in the league's
   ink, behind the winner's card. */
function laurel() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc().createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('class', 'fvw-laurel');
  svg.setAttribute('aria-hidden', 'true');
  /* SVG's y runs down, so 90 degrees is the foot of the circle and 180 its left
     side: the left branch climbs from 110 to 246 degrees, and the right branch
     is its mirror (x negated, and a leaf turned by phi becomes one turned by
     180 - phi). Each leaf lies along the arc, tipped 30 degrees outward. */
  const R = 80;
  [-1, 1].forEach(side => {
    const g = doc().createElementNS(NS, 'g');
    g.setAttribute('class', 'fvw-branch');
    for (let i = 0; i < 9; i++) {
      const deg = 110 + i * 17;
      const a = deg * Math.PI / 180;
      const cx = (side < 0 ? 1 : -1) * R * Math.cos(a);
      const cy = R * Math.sin(a);
      const phiLeft = deg + 90 + 30;
      const phi = side < 0 ? phiLeft : 180 - phiLeft;
      /* the turn goes on a wrapping group, the grow animation on the bare leaf: a CSS
         transform-origin on an element that also has a transform attribute moves it */
      const turn = doc().createElementNS(NS, 'g');
      turn.setAttribute('transform', 'rotate(' + phi.toFixed(1) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')');
      const leaf = doc().createElementNS(NS, 'ellipse');
      leaf.setAttribute('cx', cx.toFixed(1)); leaf.setAttribute('cy', cy.toFixed(1));
      leaf.setAttribute('rx', (10.5 - i * .5).toFixed(1)); leaf.setAttribute('ry', (4.6 - i * .2).toFixed(1));
      leaf.style.setProperty('--i', String(i));
      turn.appendChild(leaf);
      g.appendChild(turn);
    }
    svg.appendChild(g);
  });
  return svg;
}

function award(kind, title, cardEl, meta) {
  const w = el('div', 'fvw-award ' + kind);
  const stage = el('div', 'fvw-stage');
  stage.append(el('div', 'fvw-rays'), laurel());
  const holder = el('div', 'fvw-card');
  holder.appendChild(cardEl);
  const ribbon = el('div', 'fvw-ribbon', title);
  stage.append(holder, ribbon);
  for (let i = 0; i < 14; i++) {
    const c = el('i', 'fvw-confetti');
    c.style.setProperty('--k', String(i));
    stage.appendChild(c);
  }
  w.append(stage, el('div', 'fvw-meta', meta));
  return w;
}

function winnerPlayerCard(p, base) {
  const team = p.team || {};
  const a = el('a', 'club star fvw-win');
  a.href = (base || '') + 'p/?p=' + encodeURIComponent(p.slug || '');
  paint(a, team.colour, team.colour_2);
  a.setAttribute('aria-label', 'Fans’ player of the week: ' + p.name + (team.name ? ', ' + team.name : ''));
  const foot = el('div', 'club-foot star-foot');
  const who = el('div', 'star-who');
  who.append(el('span', 'star-name', p.name), el('span', 'star-team', team.name || ''));
  foot.append(who, el('span', 'club-ed', lineText(p.line)));
  a.append(plate(initials(p.name), 'Fans’ pick'), foot);
  return a;
}
function winnerTeamCard(t, base) {
  const a = el('a', 'club fvw-win');
  a.href = (base || '') + 't/?t=' + encodeURIComponent(t.slug || '');
  paint(a, t.colour, t.colour_2);
  a.setAttribute('aria-label', 'Fans’ club of the week: ' + t.name);
  const foot = el('div', 'club-foot');
  foot.append(el('span', 'club-name', t.name), el('span', 'club-ed', recordText(t.line)));
  a.append(plate(monogram(t), 'Fans’ pick', logoUrl(t.logo_path)), foot);
  return a;
}

/* THE WINNERS SECTION: last week's picks, the way into the open vote, and the
   link to every week's winners. Hidden when there is nothing to show. */
function renderSection(ctx) {
  const { sec, state, base, league } = ctx;
  if (!sec) return;
  const host = sec.querySelector('#fvw') || sec;
  host.textContent = '';
  const last = state.last;
  const open = state.open;
  const note = sec.querySelector('#fvNote');
  if (!last && !open) { sec.classList.add('hide'); return; }
  sec.classList.remove('hide');
  if (note) {
    note.textContent = last
      ? 'the week of ' + weekLabel(last.starts_at, last.ends_at) + ' · ' + last.ballots +
        (last.ballots === 1 ? ' vote' : ' votes')
      : 'the first vote is open';
  }

  if (last && (last.player || last.team)) {
    const row = el('div', 'fvw');
    if (last.player) {
      const firsts = last.player_ballots ? Math.round(100 * (last.player.firsts || 0) / last.player_ballots) : 0;
      row.appendChild(award('player', 'Fans’ player of the week', winnerPlayerCard(last.player, base),
        last.player.points + ' points · 1st on ' + firsts + '% of ballots'));
    }
    if (last.team) {
      row.appendChild(award('team', 'Fans’ club of the week', winnerTeamCard(last.team, base),
        last.team.votes + (last.team.votes === 1 ? ' vote' : ' votes') + ' · ' + (last.team.share || 0) + '% of the club vote'));
    }
    host.appendChild(row);
    /* the burst plays once, when the section is first on screen */
    try {
      const io = new root.IntersectionObserver(es => {
        if (es.some(e => e.isIntersecting)) { row.classList.add('lit'); io.disconnect(); }
      }, { threshold: .35 });
      io.observe(row);
    } catch (_) { row.classList.add('lit'); }
  }

  const foot = el('div', 'fvw-foot');
  const all = el('a', 'fvw-all', 'Every week’s winners →');
  all.href = (base || '') + 'votes/?l=' + encodeURIComponent(league.slug);
  foot.appendChild(all);
  if (open) {
    const done = fullyVoted(open);
    const go = btn('fvw-vote' + (done ? ' done' : ''),
      done ? 'You have voted · see or change your vote' : 'Vote now: who was the best last week?');
    go.addEventListener('click', () => ctx.openPanel(true));
    foot.appendChild(go);
  }
  host.appendChild(foot);
}

/* ----------------------------------------------------------- the network --- */
function client(cfg, token) {
  let tok = token || null;
  const headers = () => {
    const h = { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  };
  async function rpc(fn, args) {
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fn,
      { method: 'POST', cache: 'no-store', headers: headers(), body: JSON.stringify(args || {}) });
    if (r.status === 401 && tok) { tok = null; return rpc(fn, args); }   // a stale token: ask as nobody
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const e = new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
      e.status = r.status; e.code = j && j.code;
      throw e;
    }
    return j;
  }
  async function openRound(leagueId) {
    const r = await fetch(cfg.supabaseUrl + '/functions/v1/fanvote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey },
      body: JSON.stringify({ league: leagueId })
    });
    const j = await r.json().catch(() => null);
    return !!(r.ok && j && j.opened);
  }
  return { rpc, openRound, signedIn: () => !!tok };
}

/* ------------------------------------------------------------- mounting ---
   mount({league, cfg, anchor, sec, base}):
     anchor  the element the panel unrolls from (the hero, whose rule is its top)
     sec     the winners section (#fvSec), above the Stars
   Resolves when the section is drawn; the panel opens itself a moment later if
   the once-a-week rule says so. */
async function mount(o) {
  const cfg = o.cfg || root.EPINOIA_CONFIG;
  const league = o.league;
  if (!cfg || !league || !league.id) return null;
  if (!root.document || typeof root.fetch !== 'function') return null;

  let token = null;
  const A = root.EpinoiaAccess;
  try {
    const s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : null;
    token = (s && s.token) || null;
  } catch (_) { token = null; }
  const api = client(cfg, token);
  const key = voterKey();

  let state = await api.rpc('fanvote_state', { p_league: league.id, p_voter: key }).catch(() => null);
  if (state && state.due && !state.open) {
    const opened = await api.openRound(league.id).catch(() => false);
    if (opened) state = await api.rpc('fanvote_state', { p_league: league.id, p_voter: key }).catch(() => state);
  }
  if (!state || state.off) { if (o.sec) o.sec.classList.add('hide'); return null; }

  const ctx = { state, sec: o.sec, base: o.base || '', league, api, key, panel: null, openPanel: null };

  function stageTo(P, name, instant) {
    const cur = P.stages.querySelector('.fv-stage:not([hidden])');
    const next = P.stage[name] && P.stage[name].isConnected ? P.stage[name] : P.stage.done;
    if (cur === next) return;
    const before = P.body.getBoundingClientRect().height;
    if (cur) cur.hidden = true;
    next.hidden = false;
    /* "remind me later" and "don't show this again" ride on the stage's own action row,
       so the panel does not spend a row of its own on them */
    const acts = next.querySelector('.fv-acts');
    if (acts) acts.insertBefore(P.foot, acts.firstChild); else next.appendChild(P.foot);
    P.rails.forEach(r => r.paint());
    if (name === 'done' || next === P.stage.done) paintSaid(P);
    if (instant || reduced()) return;
    const after = P.body.getBoundingClientRect().height;
    next.classList.remove('enter'); void next.offsetWidth; next.classList.add('enter');
    try {
      P.body.animate([{ height: before + 'px' }, { height: after + 'px' }],
                     { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } catch (_) { /* no Web Animations: it simply jumps */ }
  }

  function paintSaid(P) {
    const open = ctx.state.open;
    const b = open.ballot || {};
    P.said.textContent = '';
    const byId = new Map(open.players.map(p => [p.id, p]));
    (b.players || []).forEach((id, i) => {
      const p = byId.get(id); if (!p) return;
      const r = el('div', 'fv-said-row');
      r.append(el('span', 'fv-said-k', PLACES[i]), el('span', 'fv-said-v', p.name));
      P.said.appendChild(r);
    });
    const t = open.teams.find(x => x.id === b.team);
    const r = el('div', 'fv-said-row');
    r.append(el('span', 'fv-said-k', 'Club'), el('span', 'fv-said-v', t ? t.name : (b.skipped ? 'skipped' : '—')));
    if (open.teams.length) P.said.appendChild(r);
  }

  function close(how) {
    const P = ctx.panel;
    if (!P || !P.sec.classList.contains('open')) return;
    const open = ctx.state.open;
    if (how === 'later') note(open.round_id, { later: Date.now() + LATER_MS });
    else if (how) note(open.round_id, fullyVoted(open) ? { voted: true } : { closed: true });
    P.sec.classList.remove('open');
    P.sec.classList.add('closing');
    const done = () => { P.sec.classList.remove('closing'); P.sec.hidden = true; };
    if (reduced()) done(); else setTimeout(done, 760);
    const anchor = o.anchor;
    if (anchor) anchor.classList.remove('fv-live');
  }

  async function cast(args, button) {
    const open = ctx.state.open;
    button.disabled = true;
    const was = button.textContent;
    button.textContent = 'Saving…';
    try {
      const j = await api.rpc('fanvote_cast', Object.assign({ p_round: open.round_id, p_voter: key }, args));
      open.ballot = j && j.ballot ? j.ballot : open.ballot;
      button.textContent = was;
      return true;
    } catch (e) {
      button.textContent = was;
      button.disabled = false;
      const h = button.parentNode && button.parentNode.querySelector('.fv-hint');
      if (h) h.textContent = e.status === 429 ? 'Too many votes from this network just now. Try again in a few minutes.'
                                              : 'Not saved: ' + e.message;
      return false;
    }
  }

  function afterVote() {
    if (fullyVoted(ctx.state.open)) {
      note(ctx.state.open.round_id, { voted: true });
      renderSection(ctx);
    }
  }

  function build() {
    const P = buildPanel(ctx);
    ctx.panel = P;
    P.sec.hidden = true;
    if (o.anchor && o.anchor.parentNode) o.anchor.parentNode.insertBefore(P.sec, o.anchor.nextSibling);
    else doc().body.appendChild(P.sec);

    P.x.addEventListener('click', () => close('x'));
    P.later.addEventListener('click', () => close('later'));
    P.never.addEventListener('click', async () => {
      const s = readStore(); s.never = true; writeStore(s);
      close('x');
      if (api.signedIn()) {
        try { await api.rpc('set_fan_prefs', { p: { want_fanvote: false } }); } catch (_) { /* the browser's note stands */ }
      }
    });
    P.pgo.addEventListener('click', async () => {
      const ids = P.pick1.get();
      if (ids.some(v => !v)) return;
      if (await cast({ p_players: ids }, P.pgo)) {
        stageTo(P, ctx.state.open.teams.length && !(ctx.state.open.ballot || {}).team && !(ctx.state.open.ballot || {}).skipped ? 'team' : 'done');
        afterVote();
        if (fullyVoted(ctx.state.open)) finishSoon(P);
      }
    });
    P.tgo.addEventListener('click', async () => {
      const id = P.pick2.get()[0];
      if (!id) return;
      if (await cast({ p_team: id }, P.tgo)) { stageTo(P, 'done'); afterVote(); finishSoon(P); }
    });
    P.tskip.addEventListener('click', async () => {
      if (await cast({ p_skip_team: true }, P.tskip)) { stageTo(P, 'done'); afterVote(); finishSoon(P); }
    });
    P.change.addEventListener('click', () => { clearTimeout(P.autoClose); stageTo(P, P.stage.players.isConnected ? 'players' : 'team'); });
    /* any touch inside the panel keeps it open: somebody reading is not done */
    P.body.addEventListener('pointerdown', () => clearTimeout(P.autoClose));
    return P;
  }

  function finishSoon(P) {
    clearTimeout(P.autoClose);
    P.autoClose = setTimeout(() => close('voted'), reduced() ? 6000 : 4200);
  }

  function openPanel(byHand) {
    const open = ctx.state.open;
    if (!open) return;
    const P = ctx.panel || build();
    stageTo(P, firstStage(open), true);
    if (!byHand) note(open.round_id, { shown: true });
    P.sec.hidden = false;
    if (o.anchor) o.anchor.classList.add('fv-live');
    if (reduced()) { P.sec.classList.add('open'); }
    else {
      void P.sec.offsetWidth;
      P.sec.classList.add('open');
    }
    if (byHand) {
      try { P.sec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (_) { /* old browser */ }
    }
    setTimeout(() => { try { P.x.focus({ preventScroll: true }); } catch (_) { /* focus is a courtesy */ } }, 400);
  }
  ctx.openPanel = openPanel;

  renderSection(ctx);
  if (shouldAutoOpen(state, readStore(), Date.now())) {
    setTimeout(() => openPanel(false), reduced() ? 0 : 900);
  }
  return ctx;
}

return { mount, fullyVoted, shouldAutoOpen, firstStage, place, tap, weekLabel, initials,
         monogram, lineText, bpmText, recordText, closesText, STORE, LATER_MS, VOTER_KEY };
}));
