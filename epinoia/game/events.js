'use strict';
/* ============================================================================
   EVENTS — what each kind of play turned into, per team, at both ends.

   The box score already says how many points came off an offensive rebound, off
   a turnover and on the break. It does not say what those plays LOOKED like:
   which shots they produced, how well they were made, who took them. This tab
   is that, for five situations and the assisted / unassisted split:

     second chance   the engine's window: opened by the side's own offensive
                     rebound, shut by its basket, a made free throw, its
                     turnover, a defensive rebound or a new period
     transition      the engine's rule: tagged 'transition', or within eight
                     seconds of a defensive rebound or a steal
     off turnovers   the engine's window: opened by the other side's turnover
     after timeout   the first play after a timeout, to the end of that
                     possession (so a putback off the set counts)
     half court      a chance that was none of the four

   THE FIRST THREE ARE THE BOX SCORE'S NUMBERS TO THE POINT. Each shot, free
   throw and turnover is stamped with the window state deriveGame holds at that
   moment, by a walk that copies deriveGame's own flag rules rather than a second
   opinion of what a second chance is. So "second chance: 14" here and "2nd
   chance pts 14" on the box score are one answer, and supabase/tests/
   events.test.mjs holds them equal on a real game. The consequence worth
   knowing: the engine shuts a window on the FIRST made free throw of a trip, so
   the second free throw is not in it — here or there.

   A CHANCE is epinoia/possessions.js's: a trip down the floor that ends in a
   shot, a turnover or a trip to the line; an offensive rebound starts a new one.
   Points per chance divides a situation's points by the chances whose first
   action (shot, free throw or turnover) was in it. After-timeout plays are
   counted per possession, because the question asked of them is what the set
   produced, second chances included.

   Defence is the other side's offence, read against this side.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaEvents = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* possessions.js: a global on the page, a module in node */
const Poss = () => root.EpinoiaPossessions ||
  (typeof require === 'function' ? require('../possessions.js') : null);

const PLEN = p => (p <= 4 ? 600000 : 300000);
/* engine.js's cumEl, unguarded like it: a play with no clock compares as NaN there too */
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }
/* engine.js's inGameOrder: by game time, ties in log order */
function inGameOrder(evs) {
  const keyed = evs.map((ev, i) => ({ ev, i, k: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1)) }));
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map(x => x.ev);
}

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DESCRIPTOR = { loc: 1, tag: 1, stype: 1 };
const FG = { p2_made: 2, p3_made: 3, p2_miss: 0, p3_miss: 0 };
const FT = { ft_made: 1, ft_miss: 0 };
const TRANSITION_MS = 8000;          // engine.js TRANSITION_MS

/* engine.js isRim: the shot TYPE decides when it is decisive, location fills the gaps */
const RIM_TYPE = new Set(['layup', 'dunk', 'tip-in', 'tip in', 'putback', 'alley-oop']);
const FAR_TYPE = new Set(['jump shot', 'jumper', 'fadeaway', 'step-back', 'stepback',
                          'pull-up', 'pullup', 'catch & shoot', 'catch and shoot']);

const SITS = [
  { key: 'second',     name: 'Second chance', what: 'after an offensive rebound', slot: 1 },
  { key: 'transition', name: 'Transition',    what: 'tagged, or within 8 s of a defensive rebound or steal', slot: 2 },
  { key: 'offTo',      name: 'Off turnovers', what: 'after the other side turned it over', slot: 3 },
  { key: 'ato',        name: 'After timeout', what: 'the possession after a timeout', slot: 4 },
  { key: 'half',       name: 'Half court',    what: 'none of the above', slot: 0 },
  { key: 'all',        name: 'All chances',   what: 'every chance', slot: 0 }
];
const SIT = {}; SITS.forEach(s => { SIT[s.key] = s; });

/* ---------------------------------------------------------------- compute --- */
function bucket() {
  return { chances: 0, pts: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0,
           zones: { rim: { a: 0, m: 0 }, mid: { a: 0, m: 0 }, three: { a: 0, m: 0 } },
           types: {}, scorers: {}, shots: [] };
}

function compute(S) {
  const teams = (S && S.teams) || [{}, {}];
  const names = {};
  teams.forEach(tm => (tm.players || []).forEach(p => {
    names[p.id] = p.name || (p.num != null && p.num !== '' ? '#' + p.num : '#?');
  }));
  const all = inGameOrder((S && S.events) || []);

  /* the descriptors, read exactly as deriveGame reads them (a repeated tag or type toggles) */
  const tags = {}, stypes = {}, locs = {};
  all.forEach(ev => {
    if (ev.t === 'tag') { const s = tags[ev.ref] = tags[ev.ref] || new Set(); s.has(ev.tag) ? s.delete(ev.tag) : s.add(ev.tag); }
    else if (ev.t === 'stype') { stypes[ev.ref] = stypes[ev.ref] === ev.v ? null : ev.v; }
    else if (ev.t === 'loc') { locs[ev.ref] = { x: ev.x, y: ev.y }; }
  });
  const zoneOf = ev => {
    if (ev.t[1] === '3') return 'three';
    const ty = (stypes[ev.id] || '').toLowerCase();
    if (ty && RIM_TYPE.has(ty)) return 'rim';
    if (ty && FAR_TYPE.has(ty)) return 'mid';
    const l = locs[ev.id];
    return ((l && l.x > 0.33 && l.x < 0.67 && l.y < 0.42) || (tags[ev.id] && tags[ev.id].has('paint'))) ? 'rim' : 'mid';
  };

  const plays = all.filter(ev => ev && !DESCRIPTOR[ev.t]);
  const isAction = ev => (ev.t in FG || ev.t in FT || ev.t === 'to') && (ev.team === 0 || ev.team === 1);

  /* ---- the engine's windows, stamped on every action ----
     deriveGame scores a play BEFORE it updates the windows (its first switch,
     then its second), so the stamp is taken first and the rules applied after,
     line for line, including the assignments it makes without a guard. */
  const flag = { sc: [false, false], pot: [false, false] };
  const breakAt = [null, null];
  const stamp = new Map();
  plays.forEach(ev => {
    if (isAction(ev)) {
      const tg = tags[ev.id];
      const quick = breakAt[ev.team] != null && (cumEl(ev.period, ev.clock) - breakAt[ev.team]) <= TRANSITION_MS;
      stamp.set(ev, { second: flag.sc[ev.team], offTo: flag.pot[ev.team], transition: !!((tg && tg.has('transition')) || quick) });
    }
    switch (ev.t) {
      case 'p2_made': case 'p3_made': case 'ft_made':
        flag.sc[ev.team] = false; flag.pot[ev.team] = false; break;
      case 'reb':
        if (ev.off) flag.sc[ev.team] = true;
        else { flag.sc = [false, false]; flag.pot = [false, false]; breakAt[ev.team] = cumEl(ev.period, ev.clock); }
        break;
      case 'stl': breakAt[ev.team] = cumEl(ev.period, ev.clock); break;
      case 'to':
        flag.sc[ev.team] = false; flag.pot[ev.team] = false;
        flag.sc[1 - ev.team] = false; flag.pot[1 - ev.team] = true; break;
      case 'period_start':
        flag.sc = [false, false]; flag.pot = [false, false]; breakAt[0] = breakAt[1] = null; break;
    }
  });

  /* ---- chances, and which one each action belongs to ----
     possessions.js names a chance by its first event. An action belongs to the
     latest chance of its own side that began at or before it, which is also
     where an and-one's free throw lands (the chance is closed on the basket). */
  const P = Poss();
  const E = P ? P.enumerate({ events: plays }) : { chances: [], possessions: [] };
  const at = new Map();
  plays.forEach((ev, i) => { const k = ev.seq != null ? ev.seq : ev.id; if (!at.has(k)) at.set(k, i); });
  const chances = E.chances.map(c => ({ c, start: at.has(c.startEventId) ? at.get(c.startEventId) : -1, acts: [] }));
  const bySide = [chances.filter(x => x.c.team === 0), chances.filter(x => x.c.team === 1)];
  const ptr = [-1, -1];
  const actions = [];
  plays.forEach((ev, i) => {
    if (!isAction(ev)) return;
    const list = bySide[ev.team];
    while (ptr[ev.team] + 1 < list.length && list[ptr[ev.team] + 1].start <= i) ptr[ev.team]++;
    const ch = ptr[ev.team] >= 0 ? list[ptr[ev.team]] : null;
    const a = { ev, i, ch, stamp: stamp.get(ev) };
    if (ch) ch.acts.push(a);
    actions.push(a);
  });
  const live = chances.filter(x => x.acts.length);          // a chance with no action in it is the clock running out

  /* ---- after a timeout ----
     The play a timeout sets up is the chance of the first action after it --
     unless that chance was already under way before the timeout (a timeout
     between free throws), in which case, if the trip ended in a basket, it is
     the inbound that follows. Nothing carries across a new period. */
  const ato = new Map();                                     // chance -> { calledBy, timeout }
  const nextLive = ch => { const k = live.indexOf(ch); return k >= 0 && k + 1 < live.length ? live[k + 1] : null; };
  plays.forEach((ev, i) => {
    if (ev.t !== 'timeout') return;
    const first = actions.find(a => a.i > i);
    if (!first || !first.ch) return;
    if (plays.slice(i + 1, first.i).some(x => x.t === 'period_start')) return;
    let ch = first.ch;
    if (ch.acts[0].i < i) {
      const last = ch.acts[ch.acts.length - 1].ev;
      if (!(last.t === 'p2_made' || last.t === 'p3_made' || last.t === 'ft_made')) return;
      ch = nextLive(ch);
      if (!ch || ch.acts[0].ev.period !== ev.period) return;
    }
    if (!ato.has(ch)) ato.set(ch, { calledBy: ev.team === ch.c.team ? 'own' : ev.team == null ? 'official' : 'opp', timeout: ev });
  });

  /* ---- adding an action to a bucket ---- */
  const add = (b, a) => {
    const ev = a.ev;
    if (ev.t in FG) {
      const made = FG[ev.t] > 0, three = ev.t[1] === '3', z = zoneOf(ev);
      b.fga++; b.zones[z].a++;
      if (three) b.p3a++;
      if (made) { b.fgm++; b.zones[z].m++; b.pts += FG[ev.t]; if (three) b.p3m++; }
      const ty = stypes[ev.id] || '';
      const key = (three ? 'three' : 'two') + '|' + ty;
      const T = b.types[key] = b.types[key] || { three, type: ty, a: 0, m: 0 };
      T.a++; if (made) T.m++;
      const l = locs[ev.id];
      b.shots.push({ id: ev.seq != null ? ev.seq : ev.id, x: l ? l.x : null, y: l ? l.y : null, made, three, zone: z,
                     type: ty, pid: ev.pid || null, period: ev.period, clock: ev.clock });
      if (ev.pid) { const s = b.scorers[ev.pid] = b.scorers[ev.pid] || { pid: ev.pid, pts: 0, fgm: 0, fga: 0 }; s.fga++; if (made) { s.fgm++; s.pts += FG[ev.t]; } }
    } else if (ev.t in FT) {
      b.fta++;
      if (FT[ev.t]) { b.ftm++; b.pts++; if (ev.pid) { const s = b.scorers[ev.pid] = b.scorers[ev.pid] || { pid: ev.pid, pts: 0, fgm: 0, fga: 0 }; s.pts++; } }
    } else if (ev.t === 'to') b.tov++;
  };

  const side = [0, 1].map(t => {
    const B = { all: bucket(), second: bucket(), transition: bucket(), offTo: bucket(), ato: bucket(), half: bucket() };
    const mine = live.filter(x => x.c.team === t);

    /* the whole possession from an after-timeout chance on */
    const atoChances = new Set();
    const atoPlays = [];
    mine.forEach(x => {
      if (!ato.has(x) || atoChances.has(x)) return;      // a second timeout inside one set is still one set
      const run = mine.filter(y => y.c.possession === x.c.possession && y.c.index >= x.c.index);
      run.forEach(y => atoChances.add(y));
      const acts = run.reduce((m, y) => m.concat(y.acts), []);
      const lastAct = acts[acts.length - 1].ev;
      const pts = acts.reduce((n, a) => n + (a.ev.t in FG ? FG[a.ev.t] : a.ev.t in FT ? FT[a.ev.t] : 0), 0);
      const first = acts[0].ev;
      atoPlays.push({ seq: first.seq != null ? first.seq : first.id, seqs: acts.map(a => (a.ev.seq != null ? a.ev.seq : a.ev.id)),
                      period: first.period, clock: first.clock,
                      calledBy: ato.get(x).calledBy, pts, chances: run.length,
                      how: howEnded(lastAct, stypes, names), made: pts > 0 });
      B.ato.chances++;
      acts.forEach(a => add(B.ato, a));
    });

    mine.forEach(x => {
      B.all.chances++;
      x.acts.forEach(a => add(B.all, a));
      const s0 = x.acts[0].stamp;
      ['second', 'transition', 'offTo'].forEach(k => { if (s0[k]) B[k].chances++; });
      if (!s0.second && !s0.transition && !s0.offTo && !atoChances.has(x)) {
        B.half.chances++;
        x.acts.forEach(a => add(B.half, a));
      }
    });
    /* the box score's three, by the play's own stamp */
    actions.forEach(a => {
      if (a.ev.team !== t) return;
      ['second', 'transition', 'offTo'].forEach(k => { if (a.stamp[k]) add(B[k], a); });
    });

    const total = B.all.pts;
    const sits = {};
    Object.keys(B).forEach(k => { sits[k] = finish(B[k], total, names); });
    return { sits, ato: atoPlays, assists: null };
  });

  /* ---- assisted and unassisted: connections.js's pairing ----
     An assist belongs to the last made field goal, if it was the same side's;
     either way that basket is spent. */
  const assisted = new Set();
  const ftAssists = [0, 0];
  let last = null;
  plays.forEach(ev => {
    if ((ev.t === 'p2_made' || ev.t === 'p3_made') && ev.pid) last = ev;
    else if (ev.t === 'ast') {
      if (ev.pid && last && last.team === ev.team) assisted.add(last);
      else if (ev.team === 0 || ev.team === 1) ftAssists[ev.team]++;   // FIBA credits a pass that drew free throws
      last = null;
    }
  });
  [0, 1].forEach(t => {
    const grp = () => ({ fgm: 0, pts: 0, zones: { rim: 0, mid: 0, three: 0 } });
    const A = { ast: grp(), unast: grp() };
    const by = {};
    plays.forEach(ev => {
      if (ev.team !== t || !(ev.t === 'p2_made' || ev.t === 'p3_made')) return;
      const g = assisted.has(ev) ? A.ast : A.unast, v = FG[ev.t];
      g.fgm++; g.pts += v; g.zones[zoneOf(ev)]++;
      if (!ev.pid) return;
      const p = by[ev.pid] = by[ev.pid] || { pid: ev.pid, name: names[ev.pid] || '#?', fgm: 0, unFgm: 0, unPts: 0, un3: 0 };
      p.fgm++;
      if (!assisted.has(ev)) { p.unFgm++; p.unPts += v; if (v === 3) p.un3++; }
    });
    A.ftAssists = ftAssists[t];
    A.leaders = Object.values(by).filter(p => p.unFgm > 0)
      .sort((a, b) => (b.unFgm - a.unFgm) || (b.unPts - a.unPts)).slice(0, 5);
    side[t].assists = A;
  });

  return { side, names: [0, 1].map(t => (teams[t] && teams[t].name) || (t ? 'Away' : 'Home')) };
}

function finish(b, total, names) {
  const types = Object.values(b.types).sort((x, y) => (y.a - x.a) || (y.m - x.m));
  return {
    chances: b.chances, pts: b.pts, fga: b.fga, fgm: b.fgm, p3a: b.p3a, p3m: b.p3m, fta: b.fta, ftm: b.ftm, tov: b.tov,
    ppp: b.chances ? b.pts / b.chances : null,
    efg: b.fga ? (b.fgm + 0.5 * b.p3m) / b.fga : null,
    tovPct: b.chances ? b.tov / b.chances : null,
    share: total ? b.pts / total : 0,
    zones: b.zones, types, shots: b.shots,
    scorers: Object.values(b.scorers).filter(s => s.pts > 0).map(s => Object.assign({ name: names[s.pid] || '#?' }, s))
      .sort((x, y) => (y.pts - x.pts) || (y.fgm - x.fgm)).slice(0, 5)
  };
}

/* game flow's surname: the last word, a suffix skipped */
const surname = name => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w[w.length - 1]) && w.length > 1 ? w[w.length - 2] : w[w.length - 1];
};
function howEnded(ev, stypes, names) {
  const who = ev.pid && names[ev.pid] ? ' · ' + surname(names[ev.pid]) : '';
  if (ev.t === 'to') return 'turnover' + who;
  if (ev.t in FT) return (FT[ev.t] ? 'free throws' : 'missed free throw') + who;
  const three = ev.t[1] === '3', ty = stypes[ev.id];
  const shot = three ? (ty && ty !== 'jump shot' ? ty + ' three' : 'three') : (ty || 'two');
  return (FG[ev.t] ? '' : 'missed ') + shot + who;
}

/* ----------------------------------------------------------------- render --- */
/* the view survives a redraw (a live game redraws on every play) */
const view = { team: 0, side: 'off', sit: 'second' };
let memo = { ref: null, len: -1, out: null };
function computed(S) {
  const len = S && S.events ? S.events.length : 0;
  if (memo.ref !== (S && S.events) || memo.len !== len) memo = { ref: S && S.events, len, out: compute(S) };
  return memo.out;
}

const pct = v => (v == null ? '–' : Math.round(v * 100) + '%');
const dec2 = v => (v == null ? '–' : v.toFixed(2));
const clockText = ms => { if (ms == null) return ''; const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const qText = p => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
const person = (pid, name) => UUID.test(pid || '')
  ? '<a class="ev-person" href="../p/?p=' + encodeURIComponent(pid) + '">' + esc(name) + '</a>'
  : '<span class="ev-person">' + esc(name) + '</span>';
const hasFootage = S => !!(S && S.video && S.video.url);
const sitColour = k => (SIT[k].slot ? 'var(--ev-s' + SIT[k].slot + ')' : 'var(--ev-neutral)');
const typeLabel = T => (T.three ? (T.type && T.type !== 'jump shot' ? T.type + ' three' : 'three') : (T.type || 'two, type not recorded'));

/* rim · mid · three as one ordered bar, darkest nearest the basket, each part named beneath */
function dietHTML(z, colour) {
  const n = z.rim.a + z.mid.a + z.three.a;
  if (!n) return '<span class="ev-diet none"><span class="ev-stack"></span><small>no shots</small></span>';
  const seg = (k, cls) => (z[k].a ? '<i class="' + cls + '" style="flex:' + z[k].a + '"></i>' : '');
  return '<span class="ev-diet" style="--s:' + colour + '"><span class="ev-stack">' +
    seg('rim', 'z0') + seg('mid', 'z1') + seg('three', 'z2') + '</span>' +
    '<small>' + z.rim.a + ' rim · ' + z.mid.a + ' mid · ' + z.three.a + ' three</small></span>';
}

function rowHTML(key, s, base, scale) {
  const S0 = SIT[key], on = view.sit === key;
  const few = s.fga < 3;
  const tip = S0.name + ': ' + s.pts + ' pts on ' + s.chances + (key === 'ato' ? ' possessions' : ' chances') +
    (s.ppp != null ? ', ' + s.ppp.toFixed(2) + ' per ' + (key === 'ato' ? 'possession' : 'chance') : '') +
    ' · FG ' + s.fgm + '/' + s.fga + ' · 3PT ' + s.p3m + '/' + s.p3a + ' · FT ' + s.ftm + '/' + s.fta + ' · ' + s.tov + ' turnovers';
  return '<button type="button" class="ev-row' + (on ? ' on' : '') + (key === 'all' ? ' ref' : '') + '" data-evsit="' + key + '" aria-pressed="' + on + '" style="--s:' + sitColour(key) + '" data-tip="' + esc(tip) + '">' +
    '<span class="ev-name"><i class="ev-sw"></i><span><b>' + S0.name + '</b><small>' + S0.what + '</small></span></span>' +
    '<span class="ev-pts"><b>' + s.pts + '</b><small>' + (key === 'all' ? 'points' : pct(s.share) + ' of points') + '</small></span>' +
    '<span class="ev-ppp"><span class="ev-track"><i class="ev-fill" style="width:' + (s.ppp == null ? 0 : Math.min(100, 100 * s.ppp / scale)).toFixed(1) + '%"></i>' +
      (key === 'all' || base == null ? '' : '<i class="ev-tick" style="left:' + Math.min(100, 100 * base / scale).toFixed(1) + '%"></i>') + '</span>' +
      '<b>' + dec2(s.ppp) + '</b><small>' + s.chances + (key === 'ato' ? ' poss.' : ' chances') + '</small></span>' +
    '<span class="ev-efg' + (few ? ' few' : '') + '"><b>' + (s.efg == null ? '–' : (100 * s.efg).toFixed(0) + '%') + '</b><small>' + s.fgm + '/' + s.fga + ' FG' + (few && s.fga ? ' · few shots' : '') + '</small></span>' +
    dietHTML(s.zones, sitColour(key)) +
  '</button>';
}

function courtHTML(s, colour, names) {
  const Box = root.EpinoiaBox;
  const located = s.shots.filter(x => x.x != null && x.y != null);
  if (!Box || !Box.courtSVG) return '';
  if (!located.length) return '<div class="ev-court empty"><p>No shot locations were recorded for ' + (s.fga === 1 ? 'this shot.' : s.fga ? 'these ' + s.fga + ' shots.' : 'this situation.') + '</p></div>';
  const C = Box.COURT;
  const dots = located.slice().sort((a, b) => a.made - b.made).map(x => {   // makes drawn last, on top
    const p = Box.snapToValue ? Box.snapToValue(x.x, x.y, x.three) : x;
    const cx = (p.x * C.W).toFixed(0), cy = (p.y * C.H).toFixed(0);
    const tip = qText(x.period) + ' ' + clockText(x.clock) + ' · ' + (x.pid ? names[x.pid] || '' : '') + ' · ' +
      typeLabel({ three: x.three, type: x.type }) + ' · ' + (x.made ? 'made' : 'missed');
    return x.made
      ? '<circle class="ev-dot made" cx="' + cx + '" cy="' + cy + '" r="34" data-tip="' + esc(tip) + '"/>'
      : '<circle class="ev-dot miss" cx="' + cx + '" cy="' + cy + '" r="27" data-tip="' + esc(tip) + '"/>';
  }).join('');
  return '<div class="ev-court" style="--s:' + colour + '">' + Box.courtSVG(null, { plain: true }).replace('</svg>', dots + '</svg>') +
    '<p class="ev-key"><span><i class="made"></i>made</span><span><i class="miss"></i>missed</span><span>' + located.length + ' of ' + s.fga + ' shots located</span></p></div>';
}

function typesHTML(s) {
  if (!s.types.length) return '<p class="ev-none">No field goals.</p>';
  const top = s.types.slice(0, 7), rest = s.types.slice(7);
  if (rest.length) top.push({ three: null, type: 'other', a: rest.reduce((n, T) => n + T.a, 0), m: rest.reduce((n, T) => n + T.m, 0), other: true });
  const max = Math.max(...top.map(T => T.a));
  return '<ul class="ev-types">' + top.map(T => {
    const label = T.other ? 'everything else' : typeLabel(T);
    return '<li data-tip="' + esc(label + ': ' + T.m + ' made of ' + T.a + (T.a ? ' (' + Math.round(100 * T.m / T.a) + '%)' : '')) + '">' +
      '<span class="ev-tlabel">' + esc(label) + '</span>' +
      '<span class="ev-tbar"><i class="att" style="width:' + (100 * T.a / max).toFixed(1) + '%"></i><i class="made" style="width:' + (100 * T.m / max).toFixed(1) + '%"></i></span>' +
      '<span class="ev-tval">' + T.m + '/' + T.a + '</span></li>';
  }).join('') + '</ul>';
}

function scorersHTML(s) {
  if (!s.scorers.length) return '<p class="ev-none">Nobody scored.</p>';
  const max = s.scorers[0].pts;
  return '<ol class="ev-scorers">' + s.scorers.map(p =>
    '<li>' + person(p.pid, p.name) + '<span class="ev-sbar"><i style="width:' + (100 * p.pts / max).toFixed(1) + '%"></i></span>' +
    '<b>' + p.pts + '</b><small>' + p.fgm + '/' + p.fga + ' FG</small></li>').join('') + '</ol>';
}

/* WATCH VIDEO ONLY WHERE THE FOOTAGE HAS THE PLAY. The video tab lists what epinoia/video.js
   index() could place; a button for a play it could not place would open the tab on nothing.
   The button names the first action of the set that was placed. */
let placedMemo = { key: '', ids: null };
function placedIds(S) {
  const V = root.EpinoiaVideo;
  if (!hasFootage(S) || !V || !V.index) return null;
  const v = S.video;
  const key = S.events.length + ':' + (v.tip_wall || v.tip_at || '') + ':' + (v.stream_started_at || '') + ':' + (v.trim_ms || 0) + ':' +
              (v.clock_track && v.clock_track.samples ? v.clock_track.samples.length : 0);
  if (placedMemo.key !== key) {
    const ids = new Set();
    try { V.index(S.events, v, { skipStructural: true }).forEach(p => ids.add(String(p.id))); } catch (_) { /* no buttons */ }
    placedMemo = { key, ids };
  }
  return placedMemo.ids;
}

/* whose timeout it was, by name: "own" and "their" turn over when the tab shows the defence */
function atoHTML(list, S, nm, o) {
  if (!list.length) return '<p class="ev-none">No timeouts were followed by a play from this side.</p>';
  const placed = placedIds(S);
  return '<ol class="ev-ato">' + list.map(p => {
    const at = placed ? p.seqs.find(q => placed.has(String(q))) : undefined;
    return '<li class="' + (p.made ? 'scored' : 'blank') + '">' +
      '<span class="ev-when">' + qText(p.period) + ' ' + clockText(p.clock) + '</span>' +
      '<span class="ev-chip ' + p.calledBy + '">' + (p.calledBy === 'official' ? 'official timeout' : esc(nm[p.calledBy === 'own' ? o : 1 - o]) + ' timeout') + '</span>' +
      '<span class="ev-how">' + esc(p.how) + (p.chances > 1 ? ' <small>(' + p.chances + ' chances)</small>' : '') + '</span>' +
      '<b class="ev-atopts">' + (p.pts ? '+' + p.pts : '0') + '</b>' +
      (at != null ? '<button type="button" class="ev-watch" data-evwatch="' + esc(at) + '">Watch video</button>' : '') +
    '</li>';
  }).join('') + '</ol>';
}

function assistsHTML(A, colour) {
  const max = Math.max(1, A.ast.fgm, A.unast.fgm);
  const made = A.ast.fgm + A.unast.fgm;
  const line = (label, g) => {
    const z = g.zones, n = g.fgm;
    const seg = (k, cls, word) => (z[k] ? '<i class="' + cls + '" style="flex:' + z[k] + '" data-tip="' + esc(label + ': ' + z[k] + ' ' + word) + '">' + (z[k] / max >= 0.12 ? z[k] : '') + '</i>' : '');
    return '<div class="ev-aline">' +
      '<span class="ev-alabel"><b>' + label + '</b><small>' + g.fgm + ' baskets · ' + g.pts + ' pts</small></span>' +
      '<span class="ev-abar"><span class="ev-stack big" style="width:' + (100 * n / max).toFixed(1) + '%">' +
        seg('rim', 'z0', 'at the rim') + seg('mid', 'z1', 'mid-range') + seg('three', 'z2', 'threes') + '</span></span>' +
      '<span class="ev-apct">' + (made ? Math.round(100 * g.fgm / made) + '%' : '–') + '</span></div>';
  };
  const lead = A.leaders;
  const top = lead.length ? Math.max(...lead.map(p => p.unFgm)) : 1;
  return '<div class="ev-assist" style="--s:' + colour + '">' +
    line('Assisted', A.ast) + line('Unassisted', A.unast) +
    '<p class="ev-key"><span><i class="z0"></i>rim</span><span><i class="z1"></i>mid-range</span><span><i class="z2"></i>three</span><span>share of made baskets on the right</span></p>' +
    (A.ftAssists ? '<p class="ev-note">Plus ' + A.ftAssists + ' assist' + (A.ftAssists === 1 ? '' : 's') + ' on a pass that drew free throws, which the box score’s assists include.</p>' : '') +
    '<h4 class="ev-sub">Most unassisted baskets</h4>' +
    (lead.length ? '<ol class="ev-scorers">' + lead.map(p =>
      '<li>' + person(p.pid, p.name) + '<span class="ev-sbar"><i style="width:' + (100 * p.unFgm / top).toFixed(1) + '%"></i></span>' +
      '<b>' + p.unFgm + '</b><small>' + p.unPts + ' pts · ' + Math.round(100 * p.unFgm / p.fgm) + '% of their baskets</small></li>').join('') + '</ol>'
      : '<p class="ev-none">Every basket was assisted.</p>') +
  '</div>';
}

function inner(S) {
  const C = computed(S);
  const t = view.team, off = view.side === 'off';
  const o = off ? t : 1 - t;                      // whose offence is on show
  const D = C.side[o];
  const all = D.sits.all;
  const nm = C.names, me = esc(nm[t]), them = esc(nm[1 - t]), attackers = esc(nm[o]);
  if (!all.chances) {
    return controlsHTML(nm) + '<section class="ev-card ev-empty"><h3 class="ev-title">No plays yet</h3><p>This tab is drawn from the play-by-play, and there is none for this game yet.</p></section>';
  }
  const keys = ['second', 'transition', 'offTo', 'ato', 'half', 'all'];
  const scale = Math.max(1.6, ...keys.map(k => D.sits[k].ppp || 0)) * 1.05;
  const sit = view.sit in D.sits ? view.sit : 'second';
  const s = D.sits[sit], colour = sitColour(sit);
  const lede = off
    ? '<b>' + me + '</b> on offence'
    : '<b>' + them + '</b> against <b>' + me + '</b>’s defence';
  return controlsHTML(nm) +
    '<p class="ev-lede">' + lede + ': ' + all.chances + ' chances, ' + all.pts + ' points, <b>' + dec2(all.ppp) + '</b> points per chance, ' +
      (all.efg == null ? '' : (100 * all.efg).toFixed(1) + '% eFG, ') + pct(all.tovPct) + ' turnovers.</p>' +
    '<section class="ev-card">' +
      '<div class="ev-head"><h3 class="ev-title">Where ' + attackers + '’ points came from</h3>' +
        '<p class="ev-key"><span><i class="tick"></i>' + dec2(all.ppp) + ' per chance overall</span><span>shots: rim · mid · three</span></p></div>' +
      '<div class="ev-cols" aria-hidden="true"><span>situation</span><span>points</span><span>points per chance</span><span>eFG%</span><span>shot diet</span></div>' +
      '<div class="ev-rows">' + keys.map(k => rowHTML(k, D.sits[k], all.ppp, scale)).join('') + '</div>' +
      '<p class="ev-note">Second chance, transition and off-turnover points are the box score’s, and a basket can be in more than one. ' +
        'After-timeout plays run from the first play after the timeout to the end of that possession. Tap a row to see its shots.</p>' +
    '</section>' +
    '<section class="ev-card ev-detail" style="--s:' + colour + '">' +
      '<div class="ev-head"><h3 class="ev-title"><i class="ev-sw"></i>' + SIT[sit].name + ' <small>' + attackers + (off ? '' : ' against ' + me) + '</small></h3>' +
        '<p class="ev-figs"><span><b>' + s.pts + '</b>pts</span><span><b>' + dec2(s.ppp) + '</b>per ' + (sit === 'ato' ? 'poss.' : 'chance') + '</span>' +
        '<span><b>' + (s.efg == null ? '–' : (100 * s.efg).toFixed(0) + '%') + '</b>eFG</span><span><b>' + s.ftm + '/' + s.fta + '</b>FT</span><span><b>' + pct(s.tovPct) + '</b>TO</span></p></div>' +
      '<div class="ev-grid">' + courtHTML(s, colour, namesOf(S)) +
        '<div class="ev-side-col"><h4 class="ev-sub">Shot types</h4>' + typesHTML(s) +
        '<div class="ev-zones">' + ['rim', 'mid', 'three'].map(z => '<span><small>' + (z === 'mid' ? 'mid-range' : z) + '</small><b>' + s.zones[z].m + '/' + s.zones[z].a + '</b><em>' + (s.zones[z].a ? Math.round(100 * s.zones[z].m / s.zones[z].a) + '%' : '–') + '</em></span>').join('') + '</div>' +
        '<h4 class="ev-sub">Who scored</h4>' + scorersHTML(s) + '</div></div>' +
      (sit === 'ato' ? '<h4 class="ev-sub">Every play after a timeout</h4>' + atoHTML(D.ato, S, nm, o) : '') +
    '</section>' +
    '<section class="ev-card">' +
      '<div class="ev-head"><h3 class="ev-title">Assisted and unassisted baskets <small>' + attackers + '</small></h3></div>' +
      assistsHTML(D.assists, 'var(--vis-t' + o + ',var(--team' + o + '))') +
    '</section>';
}

function namesOf(S) {
  const n = {};
  ((S && S.teams) || []).forEach(tm => (tm.players || []).forEach(p => { n[p.id] = p.name || '#' + (p.num || '?'); }));
  return n;
}

function controlsHTML(nm) {
  return '<div class="ev-bar">' +
    '<div class="ev-teams" role="group" aria-label="Team">' + [0, 1].map(t =>
      '<button type="button" data-evteam="' + t + '" aria-pressed="' + (view.team === t) + '"' + (view.team === t ? ' class="on"' : '') + ' style="--c:var(--vis-t' + t + ',var(--team' + t + '))"><i></i>' + esc(nm[t]) + '</button>').join('') + '</div>' +
    '<div class="ev-seg" role="group" aria-label="Offence or defence">' + [['off', 'Offence'], ['def', 'Defence']].map(x =>
      '<button type="button" data-evside="' + x[0] + '" aria-pressed="' + (view.side === x[0]) + '"' + (view.side === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>').join('') + '</div>' +
  '</div>';
}

function render(S) {
  return '<div class="ev">' + inner(S) + '<div class="ev-tip" role="tooltip" hidden></div></div>';
}

/* the clubs' colours, inked for this theme, as game flow does it */
function inkTeams(host) {
  const TC = root.EpinoiaTeamColour;
  if (!host || !TC || !TC.ink || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  ['0', '1'].forEach(t => {
    const c = cs.getPropertyValue('--team' + t).trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) host.style.setProperty('--vis-t' + t, TC.ink(c) || c);
  });
}

/* One set of listeners on the host renderBody keeps: the controls redraw the tab in place,
   a hover (or a tap, on a phone) shows what a mark is, and WATCH VIDEO asks the page for
   the video tab at that play. */
function mounted(host) {
  if (!host) return;
  inkTeams(host);
  if (host.__evBound) return;
  host.__evBound = true;
  const wrap = () => host.querySelector('.ev');
  const redraw = () => {
    const w = wrap(); if (!w) return;
    const tip = w.querySelector('.ev-tip');
    w.innerHTML = inner(root.S);
    if (tip) { tip.hidden = true; w.appendChild(tip); }
  };
  const tipOf = e => { const m = e.target && e.target.closest && e.target.closest('[data-tip]'); return m && wrap() && wrap().contains(m) ? m : null; };
  const show = m => {
    const w = wrap(), tip = w && w.querySelector('.ev-tip');
    if (!tip || !m) return;
    tip.textContent = m.getAttribute('data-tip');
    tip.hidden = false;
    const r = m.getBoundingClientRect(), R = w.getBoundingClientRect();
    const x = Math.max(8, Math.min(R.width - tip.offsetWidth - 8, r.left - R.left + r.width / 2 - tip.offsetWidth / 2));
    const above = r.top - R.top - tip.offsetHeight - 8;
    tip.style.left = x + 'px';
    tip.style.top = (above > 0 ? above : r.bottom - R.top + 8) + 'px';
  };
  const hide = () => { const w = wrap(), tip = w && w.querySelector('.ev-tip'); if (tip) tip.hidden = true; };
  host.addEventListener('pointerover', e => { if (!wrap()) return; const m = tipOf(e); if (m && e.pointerType !== 'touch') show(m); });
  host.addEventListener('pointerout', e => { if (wrap() && tipOf(e) && e.pointerType !== 'touch') hide(); });
  host.addEventListener('click', e => {
    if (!wrap()) return;
    const b = e.target.closest && e.target.closest('[data-evteam],[data-evside],[data-evsit],[data-evwatch]');
    if (b && wrap().contains(b)) {
      if (b.dataset.evwatch != null) {
        root.dispatchEvent(new CustomEvent('epinoia:watchplay', { detail: { seq: b.dataset.evwatch } }));
        return;
      }
      if (b.dataset.evteam != null) view.team = +b.dataset.evteam;
      if (b.dataset.evside != null) view.side = b.dataset.evside;
      if (b.dataset.evsit != null) {
        view.sit = b.dataset.evsit;
        redraw();
        const d = wrap() && wrap().querySelector('.ev-detail');
        /* a phone shows the table and the detail one above the other: bring the detail up */
        if (d && d.getBoundingClientRect && d.getBoundingClientRect().top > (root.innerHeight || 800) * 0.8) d.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      redraw();
      return;
    }
    /* a tap on a mark shows its tooltip; a tap anywhere else puts it away */
    const m = tipOf(e);
    if (m && !m.closest('button')) show(m); else hide();
  });
}

return { compute, render, mounted, view, SITS, setView: v => Object.assign(view, v) };
}));
