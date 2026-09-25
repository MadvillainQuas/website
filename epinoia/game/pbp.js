'use strict';
/* ============================================================================
   THE PLAY-BY-PLAY, AS CARDS.

   A presentation of the same log the box score is built from: nothing here changes
   an event, the feed or the engine. It reads window.S (the log) and the engine's
   replay (d.pbp: every line with its score, d.locs: where each shot was taken),
   groups plays that belong together, and draws each group as one card.

   WHAT IS COMBINED, and why: the log records one action per row, so a single
   basket reads as three rows ("2pt made", "assist", nothing else happened). A
   card is a play, not a row:
     · a made shot and its assist
     · a missed shot and the block on it
     · a missed shot (or a missed free throw) and the rebound that followed
     · a turnover and the steal that caused it
   A miss can carry both a block and a rebound: three plays, one card (the shot,
   the block, and the rebound that came of it, offensive or defensive). A combined
   card is taller and shows every player in it; the first face is the one the play
   is about.

   SUBSTITUTIONS ARE ONE CARD PER TEAM PER STOPPAGE: every sub a team made at the
   same period and clock (other teams' subs and timeouts may sit between them; any
   other play ends the group), listed in and out, and under them the five that
   were on the floor once those subs were done, as the match report's row of player
   circles and names - the players who have just come on are marked. The five are
   replayed from the starters through every substitution, a player coming on in
   the place of the one going off so the row keeps its order.

   Pairing is done by position and clock, never by trusting feed order alone:
   an assist or a block may be logged just before or just after its shot, within
   three seconds; a rebound follows its miss (and its block) with nothing but
   substitutions or timeouts in between, and within fifteen seconds: the feed
   stamps a rebound when it is entered, and in the real games checked that was up to nine
   seconds after the shot (a blocked ball that had to be chased down), so six
   seconds split those. What guards the pairing is that nothing else happened
   first, not the clock.

   COST: this file is not loaded with the page. game.js fetches it the first time
   somebody opens the play-by-play tab. It then keeps its cards: a new play adds a
   card (animated) instead of the whole list being rebuilt, and the small court on
   each shot card is only drawn when the card comes near the screen.

   The scroll pop-in is the home page's draw-distance effect (kit/haze.css): a
   scroll-driven CSS animation, run by the browser, never by a script per frame.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPBP = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const AST_MS = 3000, BLK_MS = 3000, REB_MS = 15000, STL_MS = 3000;
const SHOT = /^p[23]_/, MISS = /^(p[23]|ft)_miss$/, MADE = /^p[23]_made$/;
const QUIET = new Set(['sub', 'timeout']);            // may sit between a miss and its rebound
const ORDER_KEY = 'epinoia_pbp_order', PER_KEY = 'epinoia_pbp_period';

/* ------------------------------------------------------------------ pure --- */

/* The groups, in game order. `lines` is d.pbp (each {id, period, clock, s}); `byId` the raw events.
   Returns [{ key, main, extras:[{role, ev, line}], subs?, period, clock, score, idx }]; a substitution card
   carries `subs`, every sub of its team at that stoppage (main first). */
function group(lines, byId) {
  const L = lines.map((l, i) => ({ l, ev: byId[l.id] || {}, i })).filter(x => x.ev.t);
  const used = new Array(L.length).fill(false);
  const extras = L.map(() => []);
  const near = (a, b, ms) => a.ev.period === b.ev.period && Math.abs((a.ev.clock || 0) - (b.ev.clock || 0)) <= ms;
  const find = (i, from, to, test) => {
    for (let j = from; j <= to; j++) {
      if (j < 0 || j >= L.length || j === i || used[j]) continue;
      if (test(L[j])) return j;
    }
    return -1;
  };
  /* 1. an assist to its basket, a block to its miss, a steal to its turnover: either side */
  L.forEach((x, i) => {
    const e = x.ev;
    if (MADE.test(e.t)) {
      const j = find(i, i - 2, i + 3, y => y.ev.t === 'ast' && y.ev.team === e.team && near(x, y, AST_MS) && y.ev.pid !== e.pid);
      if (j >= 0) { used[j] = true; extras[i].push({ role: 'assist', ...L[j] }); }
    } else if (/^p[23]_miss$/.test(e.t)) {
      const j = find(i, i - 2, i + 3, y => y.ev.t === 'blk' && near(x, y, BLK_MS) && y.ev.pid !== e.pid);
      if (j >= 0) { used[j] = true; extras[i].push({ role: 'block', ...L[j] }); }
    } else if (e.t === 'to') {
      const j = find(i, i - 2, i + 2, y => y.ev.t === 'stl' && y.ev.team !== e.team && near(x, y, STL_MS));
      if (j >= 0) { used[j] = true; extras[i].push({ role: 'steal', ...L[j] }); }
    }
  });
  /* 2. a rebound to the miss before it (after the block, if there was one) */
  L.forEach((x, i) => {
    if (used[i] || !MISS.test(x.ev.t)) return;
    for (let j = i + 1; j < L.length && j <= i + 5; j++) {
      const y = L[j];
      if (used[j] && !extras[i].some(z => z.i === j)) continue;
      if (extras[i].some(z => z.i === j)) continue;          // its own block
      if (y.ev.t === 'reb') {
        if (near(x, y, REB_MS)) { used[j] = true; extras[i].push({ role: 'rebound', ...y }); }
        break;
      }
      if (!QUIET.has(y.ev.t) && y.ev.t !== 'blk') break;   // anything else happened first
    }
  });
  /* 3. a team's substitutions at one stoppage: same team, period and clock. The other team's subs and timeouts
        at that moment may sit between them; any other play ends the group. */
  const subs = L.map(() => null);
  L.forEach((x, i) => {
    if (used[i] || x.ev.t !== 'sub') return;
    const e = x.ev, mine = [x];
    for (let j = i + 1; j < L.length; j++) {
      const y = L[j];
      if (y.ev.period !== e.period || y.ev.clock !== e.clock) break;
      if (used[j]) continue;
      if (y.ev.t === 'sub' && y.ev.team === e.team) { used[j] = true; mine.push(y); continue; }
      if (y.ev.t === 'sub' || y.ev.t === 'timeout') continue;
      break;
    }
    subs[i] = mine;
  });
  const out = [];
  L.forEach((x, i) => {
    if (used[i]) return;
    const ex = extras[i].sort((a, b) => a.i - b.i);
    const all = subs[i] || null;
    const last = all ? all[all.length - 1] : ex.reduce((m, z) => (z.i > m.i ? z : m), x);
    const g = { key: String(x.l.id), main: x, extras: ex, period: x.ev.period || 1, clock: x.ev.clock,
                score: last.l.s || x.l.s || [0, 0], idx: x.i };
    if (all) g.subs = all;
    out.push(g);
  });
  return out;
}

/* WHO WAS ON THE FLOOR after each substitution: id of the sub -> that team's players, from the starters,
   a player coming on taking the place of the one going off so the row keeps its order. `lines` is d.pbp
   (the engine's order), `byId` the raw events, `starters` [[pids], [pids]]. A team with no starters on
   record has no lineup to show (a row of only the players who came on would be a lie): null for it. */
function lineupsAfter(lines, byId, starters) {
  const on = [0, 1].map(t => ((starters && starters[t]) || []).slice());
  const known = on.map(a => a.length > 0);
  const after = {};
  lines.forEach(l => {
    const ev = byId[l.id];
    if (!ev || ev.t !== 'sub' || (ev.team !== 0 && ev.team !== 1)) return;
    const a = on[ev.team];
    const k = ev.out != null ? a.indexOf(ev.out) : -1;
    if (ev.in != null && a.indexOf(ev.in) < 0) { if (k >= 0) a[k] = ev.in; else a.push(ev.in); }
    else if (k >= 0) a.splice(k, 1);
    after[ev.id] = known[ev.team] ? a.slice() : null;
  });
  return after;
}

/* the words for one action (each piece a separate text node, so the translator can take each) */
function actionParts(ev, stype, tags) {
  const st = stype ? [stype] : [];
  const tg = tags && tags.size ? [...tags] : [];
  switch (ev.t) {
    case 'p2_made': return { lead: '2PT', verb: 'made', bits: st.concat(tg), pts: 2 };
    case 'p3_made': return { lead: '3PT', verb: 'made', bits: st.concat(tg), pts: 3 };
    case 'p2_miss': return { lead: '2PT', verb: 'missed', bits: st.concat(tg) };
    case 'p3_miss': return { lead: '3PT', verb: 'missed', bits: st.concat(tg) };
    case 'ft_made': return { lead: 'Free throw', verb: 'made', bits: [], pts: 1 };
    case 'ft_miss': return { lead: 'Free throw', verb: 'missed', bits: [] };
    case 'reb':     return { lead: ev.off ? 'Offensive rebound' : 'Defensive rebound', bits: ev.pid ? [] : ['team'] };
    case 'ast':     return { lead: 'Assist', bits: [] };
    case 'blk':     return { lead: 'Block', bits: [] };
    case 'stl':     return { lead: 'Steal', bits: [] };
    case 'to':      return { lead: 'Turnover', bits: (stype ? [stype] : []).concat(ev.pid ? [] : ['team']) };
    case 'foul':    return { lead: (FOUL[ev.kind] || 'Personal') + ' foul', bits: [] };
    case 'timeout': return { lead: 'Timeout', bits: [] };
    case 'sub':     return { lead: 'Substitution', bits: [] };
    case 'jump':    return { lead: 'Held ball', bits: ['alternating possession'] };
    case 'game_end':return { lead: 'Final', bits: [] };
  }
  return { lead: ev.t, bits: [] };
}
const FOUL = { personal: 'Personal', shooting: 'Shooting', floor: 'On-the-floor', offensive: 'Offensive', tech: 'Technical',
               unsport: 'Unsportsmanlike', disq: 'Disqualifying' };
const ROLE = { assist: 'Assist', block: 'Block', rebound: null, steal: 'Steal' };

/* ------------------------------------------------------------------ html --- */
let B = null;
const esc = s => (B ? B.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));

function players(S) {
  const m = {};
  (S.teams || []).forEach((tm, t) => (tm.players || []).forEach(p => { m[p.id] = { p, t }; }));
  return m;
}

function colours(S) {
  /* the club's colour as it reads on THIS theme's ground (a black club on the dark page, a white one on the
     light page, is nudged until it shows), for the stripe, the shot, the badges and the tint */
  const TC = root.EpinoiaTeamColour;
  return [0, 1].map(t => {
    const c = B.safeColour(S.teams[t].color, t ? '#8ff5ff' : '#93f2bf');
    return (TC && TC.ink && TC.ink(c)) || c;
  });
}

function tagMap(S) {
  const tags = {};
  (S.events || []).forEach(ev => {
    if (ev.t !== 'tag') return;
    const s = tags[ev.ref] = tags[ev.ref] || new Set();
    s.has(ev.tag) ? s.delete(ev.tag) : s.add(ev.tag);
  });
  return tags;
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
}

function face(ctx, pid, team, small) {
  const who = pid && ctx.pm[pid];
  const col = ctx.col[who ? who.t : team] || ctx.col[0];
  if (!who) {
    const tm = ctx.S.teams[team] || {};
    const label = tm.short_name || initials(tm.name);
    return '<span class="pb-p pb-team' + (small ? ' sm' : '') + '" style="--c:' + esc(col) + '"><span translate="no">' + esc(label) + '</span></span>';
  }
  return '<span class="pb-p' + (small ? ' sm' : '') + '" data-pid="' + esc(pid) + '">' +
    '<span class="sq-face" style="--c:' + esc(col) + '"><span class="sq-nm">' + esc(who.p.name) + '</span></span>' +
    (who.p.num !== '' && who.p.num != null ? '<span class="pb-num">' + esc(who.p.num) + '</span>' : '') + '</span>';
}

function whoHTML(ctx, ev) {
  const pid = ev.t === 'sub' ? ev.in : ev.pid;
  const who = pid && ctx.pm[pid];
  if (!who) return '<b class="pb-who" translate="no">' + esc((ctx.S.teams[ev.team] || {}).name || '') + '</b>';
  return '<a class="pb-who" translate="no" href="../p/?p=' + encodeURIComponent(pid) + '">' + esc(who.p.name) + '</a>';
}

function lineHTML(ctx, ev, role) {
  const a = actionParts(ev, ctx.d.stypes && ctx.d.stypes[ev.id], ctx.tags[ev.id]);
  const lead = role && ROLE[role] ? ROLE[role] : a.lead;
  let what = '<span class="pb-lead">' + esc(lead) + '</span>' +
    (a.verb && !role ? ' <span class="pb-verb ' + a.verb + '">' + esc(a.verb) + '</span>' : '') +
    a.bits.map(b => '<span class="pb-bit">' + esc(b) + '</span>').join('');
  if (ev.t === 'sub') {
    const out = ev.out && ctx.pm[ev.out];
    what = '<span class="pb-lead">in</span>' + (out ? ' <span class="pb-bit">for</span> <span class="pb-bit" translate="no">' + esc(out.p.name) + '</span>' : '');
  }
  if (ev.t === 'foul' && ev.drawn && ctx.pm[ev.drawn]) {
    what += ' <span class="pb-bit">on</span> <span class="pb-bit" translate="no">' + esc(ctx.pm[ev.drawn].p.name) + '</span>';
  }
  return '<span class="pb-txt">' + whoHTML(ctx, ev) + '<span class="pb-what">' + what + '</span></span>';
}

/* the kind of card: what colours it and how prominent it is */
function kindOf(g) {
  const t = g.main.ev.t;
  if (MADE.test(t) || t === 'ft_made') return 'score';
  if (MISS.test(t)) return 'miss';
  if (t === 'to' || t === 'stl') return 'to';
  if (t === 'foul') return 'foul';
  if (t === 'sub' || t === 'timeout' || t === 'jump') return 'slim';
  if (t === 'period_start' || t === 'game_end') return 'marker';
  return 'plain';
}

/* the shot this card is about, if it has a place on the floor */
function locOf(ctx, g) {
  const ids = [g.main.ev].concat(g.extras.map(x => x.ev)).filter(e => SHOT.test(e.t));
  for (const e of ids) {
    const l = ctx.d.locs && ctx.d.locs[e.id];
    if (l && l.x != null && l.y != null) return { l, e };
  }
  return null;
}

/* THE SUBSTITUTION CARD: each sub as a line (who came on, for whom), then the five on the floor now as the match
   report's row of circles with the names under them, the ones who have just come on marked */
function subCardHTML(ctx, g) {
  const ev = g.main.ev, team = ev.team != null ? ev.team : 0;
  const col = ctx.col[team] || ctx.col[0];
  const per = B.perName(g.period).toUpperCase();
  const came = new Set(g.subs.map(x => x.ev.in).filter(Boolean));
  const lines = g.subs.map(x => '<div class="pb-row pb-sub">' + face(ctx, x.ev.in, team, true) + lineHTML(ctx, x.ev) + '</div>').join('');
  const five = g.lineup && g.lineup.length
    ? '<div class="pb-lu" aria-label="' + esc('on court') + '"><span class="pb-lu-h">on court</span><div class="pb-lu-row">' +
      g.lineup.map(pid => {
        const who = ctx.pm[pid];
        if (!who) return '';
        return '<a class="pb-lu-p' + (came.has(pid) ? ' new' : '') + '" translate="no" href="../p/?p=' + encodeURIComponent(pid) + '" title="' + esc(who.p.name) + '">' +
          face(ctx, pid, team, false) + (came.has(pid) ? '<span class="pb-lu-in" data-i18n-ctx="pbpin">in</span>' : '') + '<span class="pb-lu-n">' + esc(ctx.label ? ctx.label(pid) : String(who.p.name).split(/\s+/).pop()) + '</span></a>';
      }).join('') + '</div></div>'
    : '';
  return '<div class="pb-card k-slim k-subs" data-key="' + esc(g.key) + '" data-p="' + g.period + '" data-t="' + team + '" style="--c:' + esc(col) +
    ';--on:' + esc(ctx.on[team] || '#0b0f0d') + '"><div class="pb-in">' +
    '<div class="pb-rows"><div class="pb-subhead"><span class="pb-lead">' + (g.subs.length > 1 ? 'Substitutions' : 'Substitution') + '</span> <span class="pb-bit" translate="no">' +
      esc((ctx.S.teams[team] || {}).name || '') + '</span></div>' + lines + five + '</div>' +
    '<div class="pb-meta"><span class="pb-clock"><span class="pb-per">' + esc(per) + '</span> ' + esc(g.clock != null ? B.fmtClock(g.clock) : '') + '</span>' +
      '<span class="pb-score"><b>' + g.score[0] + '</b>–<b>' + g.score[1] + '</b></span></div>' +
    '</div></div>';
}

function cardHTML(ctx, g) {
  if (g.subs) return subCardHTML(ctx, g);
  const ev = g.main.ev, kind = kindOf(g);
  const team = ev.team != null ? ev.team : 0;
  const col = ctx.col[team] || ctx.col[0];
  const per = B.perName(g.period).toUpperCase();
  if (kind === 'marker') {
    return '<div class="pb-card pb-marker" data-key="' + esc(g.key) + '" data-p="' + g.period + '"><div class="pb-in">' +
      '<span class="pb-mk">' + esc(ev.t === 'game_end' ? 'final' : per) + '</span>' +
      '<span class="pb-mks">' + g.score[0] + '–' + g.score[1] + '</span></div></div>';
  }
  const double = g.extras.length > 0;
  const loc = kind === 'slim' ? null : locOf(ctx, g);
  const a = actionParts(ev);
  const scored = a.pts && /made$/.test(ev.t);
  const rows = '<div class="pb-row pb-first">' + face(ctx, ev.t === 'sub' ? ev.in : ev.pid, team, kind === 'slim') + lineHTML(ctx, ev) + '</div>' +
    g.extras.map(x => '<div class="pb-row pb-second">' + face(ctx, x.ev.pid, x.ev.team != null ? x.ev.team : team, true) +
      lineHTML(ctx, x.ev, x.role) + '</div>').join('');
  return '<div class="pb-card k-' + kind + (double ? ' double' : '') + (scored ? ' scored' : '') + '" data-key="' + esc(g.key) +
    '" data-p="' + g.period + '" data-t="' + team + '" style="--c:' + esc(col) + ';--on:' + esc(ctx.on[team] || '#0b0f0d') + '">' +
    '<div class="pb-in">' +
      '<div class="pb-rows">' + rows + '</div>' +
      (loc ? '<div class="pb-court" data-x="' + loc.l.x + '" data-y="' + loc.l.y + '" data-made="' + (MADE.test(loc.e.t) ? 1 : 0) +
             '" data-three="' + (loc.e.t[1] === '3' ? 1 : 0) + '" aria-hidden="true"></div>' : '') +
      '<div class="pb-meta"><span class="pb-clock"><span class="pb-per">' + esc(per) + '</span> ' +
        esc(g.clock != null ? B.fmtClock(g.clock) : '') + '</span>' +
        '<span class="pb-score"><b class="' + (scored && team === 0 ? 'up' : '') + '">' + g.score[0] + '</b>–<b class="' +
          (scored && team === 1 ? 'up' : '') + '">' + g.score[1] + '</b></span>' +
        (scored ? '<span class="pb-pts">+' + a.pts + '</span>' : '') +
      '</div>' +
    '</div></div>';
}

/* a small half court with the one shot on it, drawn when the card nears the screen */
let courtBase = null;
function drawCourt(el) {
  if (el.dataset.drawn) return;
  el.dataset.drawn = '1';
  if (!courtBase) courtBase = B.courtSVG(null, { plain: true });
  const C = B.COURT;
  const nx = +el.dataset.x, ny = +el.dataset.y, three = el.dataset.three === '1', made = el.dataset.made === '1';
  const p = B.snapToValue ? B.snapToValue(nx, ny, three) : { x: nx, y: ny };
  const x = (p.x * C.W).toFixed(0), y = (p.y * C.H).toFixed(0), a = 62;
  const mark = made
    ? '<circle class="pb-dot made" cx="' + x + '" cy="' + y + '" r="82"/><circle class="pb-ring" cx="' + x + '" cy="' + y + '" r="82"/>'
    : '<g class="pb-dot miss"><line x1="' + (x - a) + '" y1="' + (y - a) + '" x2="' + (+x + a) + '" y2="' + (+y + a) + '"/>' +
      '<line x1="' + (x - a) + '" y1="' + (+y + a) + '" x2="' + (+x + a) + '" y2="' + (y - a) + '"/></g>';
  el.innerHTML = courtBase.replace('</svg>', mark + '</svg>');
}

/* ----------------------------------------------------------------- state --- */
let st = null;

function store(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* fine */ } }
function stored(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }

function mount(host, S, d, box) {
  B = box || root.EpinoiaBox;
  if (!host) return;
  const live = S.status === 'live';
  st = {
    host, S, d, groups: [], nodes: new Map(), sigs: new Map(),
    per: stored(PER_KEY) || 'all',
    order: stored(ORDER_KEY) || (live ? 'new' : 'old'),
    io: null
  };
  host.innerHTML = '<div class="pb" data-i18n-ctx="pbp"><div class="pb-bar"><div class="pb-tabs" role="tablist"></div>' +
    '<button type="button" class="pb-order"></button></div><div class="pb-list"></div></div>';
  st.tabs = host.querySelector('.pb-tabs');
  st.list = host.querySelector('.pb-list');
  st.orderBtn = host.querySelector('.pb-order');
  st.orderBtn.addEventListener('click', () => {
    st.order = st.order === 'new' ? 'old' : 'new';
    store(ORDER_KEY, st.order);
    draw(false);
  });
  if (root.IntersectionObserver) {
    st.io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { drawCourt(en.target); st.io.unobserve(en.target); }
    }), { rootMargin: '400px 0px' });
  }
  update(S, d, true);
}

function update(S, d, first) {
  if (!st) return;
  st.S = S; st.d = d;
  const byId = {};
  (S.events || []).forEach(e => { byId[e.id] = e; });
  const col = colours(S), TC = root.EpinoiaTeamColour;
  st.ctx = { S, d, pm: players(S), col, on: col.map(c => (TC && TC.on ? TC.on(c) : '#0b0f0d')), tags: tagMap(S) };
  st.groups = group(d.pbp || [], byId);
  /* the five on the floor after each stoppage's substitutions, and the names to print under their circles */
  const after = lineupsAfter(d.pbp || [], byId, S.starters);
  st.groups.forEach(g => { if (g.subs) g.lineup = after[g.subs[g.subs.length - 1].ev.id] || null; });
  const MB = root.EpinoiaModernBox;
  const everyone = [];
  (S.teams || []).forEach(tm => (tm.players || []).forEach(p => everyone.push(p)));
  const labels = MB && MB.nameLabels ? MB.nameLabels(everyone) : {};
  const last = n => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return w.length ? w[w.length - 1] : '?'; };
  st.ctx.label = pid => (labels[pid]) || last((st.ctx.pm[pid] || { p: {} }).p.name);
  drawTabs();
  draw(!first);
}

function periodsIn() {
  const ps = [...new Set(st.groups.map(g => g.period))].sort((a, b) => a - b);
  const cur = +st.S.period || 1;
  if (st.S.status === 'live' && ps.indexOf(cur) === -1) ps.push(cur);
  return ps;
}

function drawTabs() {
  const ps = periodsIn();
  if (st.per !== 'all' && ps.indexOf(+st.per) === -1) st.per = 'all';
  const want = ['all'].concat(ps.map(String)).join(',');
  if (st.tabs.dataset.have !== want) {
    st.tabs.dataset.have = want;
    st.tabs.innerHTML = ['all'].concat(ps).map(p =>
      '<button type="button" role="tab" class="pb-tab" data-per="' + p + '">' + (p === 'all' ? 'All' : esc(B.perName(p).toUpperCase())) + '</button>').join('');
    st.tabs.querySelectorAll('.pb-tab').forEach(b => b.addEventListener('click', () => {
      st.per = b.dataset.per;
      store(PER_KEY, st.per);
      paintTabs();
      draw(false);
    }));
  }
  paintTabs();
  st.orderBtn.textContent = st.order === 'new' ? 'newest first' : 'oldest first';
}

function paintTabs() {
  st.tabs.querySelectorAll('.pb-tab').forEach(b => {
    const on = b.dataset.per === String(st.per);
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
}

/* the list: cards kept where they have not changed, new ones animated in */
function draw(animate) {
  const ctx = st.ctx;
  let gs = st.groups.filter(g => st.per === 'all' || String(g.period) === String(st.per));
  if (st.order === 'new') gs = gs.slice().reverse();
  st.orderBtn.textContent = st.order === 'new' ? 'newest first' : 'oldest first';
  if (!gs.length) {
    st.list.innerHTML = '<div class="pb-empty">' + (st.groups.length ? 'No plays in this period yet.' : 'No plays yet.') + '</div>';
    st.nodes.clear(); st.sigs.clear();
    return;
  }
  const keep = new Set();
  const frag = [];
  gs.forEach(g => {
    const sig = [g.main.i].concat(g.extras.map(x => x.i), (g.subs || []).map(x => x.i)).join(',') + '|' + g.score.join('-') + '|' + (ctx.col.join()) + '|' + (g.lineup || []).join();
    let node = st.nodes.get(g.key);
    const known = !!node;
    if (!node || st.sigs.get(g.key) !== sig) {
      const t = document.createElement('div');
      t.innerHTML = cardHTML(ctx, g);
      const fresh = t.firstChild;
      if (animate) fresh.classList.add(known ? 'pb-grow' : 'pb-new');
      node = fresh;
      st.nodes.set(g.key, node);
      st.sigs.set(g.key, sig);
    }
    keep.add(g.key);
    frag.push(node);
  });
  /* in order, moving only what has to move */
  const list = st.list;
  [...list.children].forEach(c => { if (!c.dataset || !keep.has(c.dataset.key) || c.classList.contains('pb-empty')) c.remove(); });
  frag.forEach((node, i) => {
    const at = list.children[i];
    if (at !== node) list.insertBefore(node, at || null);
  });
  for (const k of [...st.nodes.keys()]) if (!keep.has(k)) { st.nodes.delete(k); st.sigs.delete(k); }
  list.querySelectorAll('.pb-court:not([data-drawn])').forEach(c => { if (st.io) st.io.observe(c); else drawCourt(c); });
  /* the new-arrival animation plays once */
  list.querySelectorAll('.pb-new, .pb-grow').forEach(n => setTimeout(() => n.classList.remove('pb-new', 'pb-grow'), 1400));
}

function mounted() { return !!(st && st.host && st.host.isConnected && st.host.querySelector('.pb')); }

return { mount, update, mounted, _test: { group, actionParts, kindOf, lineupsAfter, cardHTML, setBox: b => { B = b; } } };
}));
