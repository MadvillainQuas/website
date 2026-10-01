'use strict';
/* ============================================================================
   LINEUP EVENTS — every play of a game handed to the two fives on the floor.
                                                     window.EpinoiaLineupEvents

   lineup_stints (lineups.js) carries one side's five and a summed box per stint:
   points, FGA, FGM, 3PM, FTA, turnovers and rebounds. That is all a stint can
   say, and it cannot say who the OTHER side had on. The event log can: it holds
   the starters of both sides and every substitution, and every shot with its
   place, every assist, rebound and turnover in order. This file replays it once
   per game and cuts the game into SEGMENTS: stretches in which neither five
   changed. Each segment carries both fives and, for each side, what it did:

     the stints' box       pts fga fgm p3m fta tov or dr      (the same counts the
                           engine puts in lineup_stints, so a five's minutes,
                           +/- and ratings are the box score's Lineups tab)
     shooting by zone      rimA rimM midA midM, p3a p3m, ftm   (situations.js's
                           zone rule: shot type first, then the marker)
     assisted makes        rimAst midAst p3Ast                 (situations.js's
                           pairing: an assist belongs to the last made basket)
     rebound origins       orbR orbM orb3: its own offensive rebounds, by the
                           zone of its own miss; drbR drbM drb3: its defensive
                           rebounds, by the zone of the opponent's miss
                           (situations.js reboundOutcomes: the first rebound
                           after a miss, before anything else happens)
     possessions           pn ppts: counted possessions (possessions.js) and
                           their points, each given to the fives on the floor at
                           its FIRST action; trN trP / hcN hcP the same split by
                           whether that first action was in transition (the
                           engine's window: 8 s from a defensive rebound or a
                           steal, or tagged) or not; scN scS the possessions
                           shotclock.js could time and their seconds
     usage                 u: per player, FGA + 0.44 FTA + TOV while on the floor

   NOTHING HERE IS A NEW DEFINITION. The replay is engine.deriveGame itself,
   through its read-only observer, so the fives and the segment boundaries are
   the engine's (the stints are cut at exactly the same substitutions). The
   zones, the windows, the assist pairing and the rebound links are
   situations.js's, the possessions possessions.js's, the clock shotclock.js's.

   A RECORD is a segment (or, before the log is read, a stint) seen from one
   side: { g, ids, oids, dur, own, opp, ost, ev }. ost is how many of the
   opponent's starters for that game were on the floor (null when that game's
   starters are unknown), ev whether it came from the log (a stint record has
   only the box). Every view on the WOWY page sums records with blank/add and
   reads them with line(): a stint record and a segment record sum the same way,
   and the event stats are worked out from the event records alone, so a game
   whose log is missing never dilutes a rate.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLineupEvents = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const req = p => { try { return typeof require === 'function' ? require(p) : null; } catch (_) { return null; } };
const Engine = () => root.EpinoiaEngine || req('./engine.js');
const Sit = () => root.EpinoiaSituations || req('./situations.js');
const Clock = () => root.EpinoiaShotClock || req('./shotclock.js');
const Lin = () => root.EpinoiaLineups || req('./lineups.js');
/* shotclock.js and situations.js find possessions.js on the global: make sure node has it there */
if (typeof root.EpinoiaPossessions === 'undefined') { const P = req('./possessions.js'); if (P) root.EpinoiaPossessions = P; }

const DESC = { loc: 1, tag: 1, stype: 1 };
const BASIC = ['pts', 'fga', 'fgm', 'p3m', 'fta', 'tov', 'or', 'dr'];
const EXTRA = ['p3a', 'ftm', 'rimA', 'rimM', 'midA', 'midM', 'rimAst', 'midAst', 'p3Ast',
               'orbR', 'orbM', 'orb3', 'drbR', 'drbM', 'drb3', 'pn', 'ppts', 'trN', 'trP', 'hcN', 'hcP', 'scN', 'scS', 'zk'];
const ALL = BASIC.concat(EXTRA);
const VERSION = 1;

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const r1 = v => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (a, b) => (b > 0 ? 100 * a / b : null);

function blankX() { const x = { u: {} }; ALL.forEach(k => { x[k] = 0; }); return x; }
const seqOf = ev => (ev.seq != null ? ev.seq : ev.id);

/* ------------------------------------------------------------ one game ---
   g: { id, starters: [[ids], [ids]], events (the flattened log, data.js events()), period }
   -> { ok, reason, id, segs: [{ ids: [five0, five1], dur, s: [X0, X1] }], starters, poss } */
function gameSegments(g) {
  const E = Engine(), S = Sit(), SC = Clock();
  const fail = reason => ({ ok: false, reason, id: g && g.id, segs: [] });
  if (!E || !S || !SC) return fail('modules');
  const st = g && g.starters;
  if (!Array.isArray(st) || !Array.isArray(st[0]) || !Array.isArray(st[1]) || !st[0].length || !st[1].length) return fail('starters');
  const evs = ((g && g.events) || []).filter(Boolean);
  if (!evs.some(e => e.t === 'sub' || e.t in { p2_made: 1, p2_miss: 1, p3_made: 1, p3_miss: 1 })) return fail('events');

  const all = S.inGameOrder(evs);
  const plays = all.filter(e => !DESC[e.t]);
  const D = S.describe(all);
  const rebOf = S.reboundOutcomes(plays);
  const assisted = S.assistedShots(plays).assisted;
  const stamp = S.stamps(plays, D.tags);
  const bySeq = new Map();
  plays.forEach(e => { const k = seqOf(e); if (!bySeq.has(k)) bySeq.set(k, e); });

  const sorted = a => a.slice().sort();
  const keyOf = (a, b) => sorted(a).join(',') + '|' + sorted(b).join(',');
  const segs = [];
  let cur = null;
  const open = (a, b, cum) => { cur = { ids: [sorted(a), sorted(b)], key: keyOf(a, b), start: cum, dur: 0, s: [blankX(), blankX()] }; segs.push(cur); };
  open(st[0], st[1], 0);
  const segAt = new Map();                                  // seq of a play -> the segment it happened in
  const use = (X, pid, v) => { if (pid) X.u[pid] = (X.u[pid] || 0) + v; };
  const zone = ev => D.zoneOf(ev);
  /* a two whose zone the log can tell: it has a marker, a shot type or a paint tag. A feed with none of them
     (Liga Endesa's has no markers) would put every two in mid-range, so line() says so rather than show it */
  const known = ev => !!(D.locs[ev.id] || D.stypes[ev.id] || (D.tags[ev.id] && D.tags[ev.id].has('paint')));

  const observe = (ev, d, cum) => {
    if (ev.t === 'sub') {
      const k = keyOf(d.onCourt[0], d.onCourt[1]);
      if (k !== cur.key) { cur.dur = Math.max(0, num(cum) - cur.start); open(d.onCourt[0], d.onCourt[1], num(cum)); }
      return;
    }
    if (DESC[ev.t] || !(ev.team === 0 || ev.team === 1)) return;
    segAt.set(seqOf(ev), cur);
    const X = cur.s[ev.team], O = cur.s[1 - ev.team];
    switch (ev.t) {
      case 'p2_made': case 'p2_miss': {
        const made = ev.t === 'p2_made', z = zone(ev) === 'rim' ? 'rim' : 'mid';
        X.fga++; X[z + 'A']++; use(X, ev.pid, 1);
        if (known(ev)) X.zk++;
        if (made) { X.fgm++; X.pts += 2; X[z + 'M']++; if (assisted.has(ev)) X[z + 'Ast']++; }
        else { const r = rebOf.get(ev); if (r === 'off') X[z === 'rim' ? 'orbR' : 'orbM']++; else if (r === 'def') O[z === 'rim' ? 'drbR' : 'drbM']++; }
        break;
      }
      case 'p3_made': case 'p3_miss': {
        const made = ev.t === 'p3_made';
        X.fga++; X.p3a++; use(X, ev.pid, 1);
        if (made) { X.fgm++; X.p3m++; X.pts += 3; if (assisted.has(ev)) X.p3Ast++; }
        else { const r = rebOf.get(ev); if (r === 'off') X.orb3++; else if (r === 'def') O.drb3++; }
        break;
      }
      case 'ft_made': X.fta++; X.ftm++; X.pts++; use(X, ev.pid, 0.44); break;
      case 'ft_miss': X.fta++; use(X, ev.pid, 0.44); break;
      case 'to': X.tov++; use(X, ev.pid, 1); break;
      case 'reb': if (ev.off) X.or++; else X.dr++; break;
      default: break;
    }
  };

  const lastPeriod = all.reduce((m, e) => Math.max(m, num(e.period)), 0) || num(g.period) || 4;
  let d;
  try {
    d = E.deriveGame({ teams: [{ players: [] }, { players: [] }], starters: [st[0].slice(), st[1].slice()], events: evs,
                       period: Math.max(lastPeriod, num(g.period)), clockMs: 0, observe });
  } catch (e) { return fail('replay'); }
  cur.dur = Math.max(0, E.cumEl(Math.max(lastPeriod, num(g.period)), 0) - cur.start);

  /* possessions: each to the fives at its first action, with its points, its window and its clock */
  let poss = 0;
  try {
    const C = SC.compute({ events: evs });
    (C.possessions || []).forEach(p => {
      const seg = segAt.get(p.first);
      if (!seg || !(p.team === 0 || p.team === 1)) return;
      const X = seg.s[p.team];
      X.pn++; X.ppts += p.pts; poss++;
      const first = bySeq.get(p.first);
      const sp = first ? stamp.get(first) : null;
      if (sp && sp.transition) { X.trN++; X.trP += p.pts; } else { X.hcN++; X.hcP += p.pts; }
      if (p.dur != null) { X.scN++; X.scS += p.dur; }
    });
  } catch (_) { /* the box and the shots stand; the possession columns read as not covered */ }

  const out = segs.filter(s => s.dur > 0 || s.s.some(x => x.fga || x.fta || x.tov || x.pts || x.or || x.dr))
    .map(s => ({ ids: s.ids, dur: s.dur, s: s.s }));
  return { ok: true, id: g.id, segs: out, starters: [st[0].slice(), st[1].slice()], poss, v: VERSION, d: !!d };
}

/* ------------------------------------------------------ one side's records --- */
function oppStarters(five, starters) {
  if (!Array.isArray(starters) || starters.length < 5 || !Array.isArray(five) || five.length !== 5) return null;
  const s = new Set(starters);
  return five.reduce((n, id) => n + (s.has(id) ? 1 : 0), 0);
}
/* a game's segments as the records of the side it was on (side 0 home, 1 away) */
function recordsOf(G, side) {
  if (!G || !G.ok) return [];
  const t = side, o = 1 - side;
  return G.segs.map(s => ({ g: G.id, ids: s.ids[t], oids: s.ids[o], dur: s.dur, own: s.s[t], opp: s.s[o],
    ost: oppStarters(s.ids[o], G.starters && G.starters[o]), ev: true }));
}
/* a stint as a record: the box only, the opponent unknown */
function fromStints(stints) {
  return (stints || []).map(st => {
    const s = st.stats || st, own = blankX(), opp = blankX();
    BASIC.forEach(k => { const kk = k === 'p3m' ? 'f3m' : k; own[k] = num((s.off || {})[kk]); opp[k] = num((s.def || {})[kk]); });
    return { g: st.game_id || null, ids: (st.player_ids || []).slice().sort(), oids: null, dur: num(s.dur), own, opp, ost: null, ev: false };
  });
}

/* ------------------------------------------------ the opponent's starters --- */
/* BUCKETS: who the other side had on. 'start' all five of that game's starters, 'mixed' three or four of them,
   'bench' two or fewer. A record whose opponent five is unknown is in none. */
const BUCKETS = ['start', 'mixed', 'bench'];
function bucketOf(r) {
  if (!r || r.ost == null) return null;
  return r.ost >= 5 ? 'start' : r.ost >= 3 ? 'mixed' : 'bench';
}
function inBucket(recs, b) {
  if (!b || b === 'all') return recs || [];
  return (recs || []).filter(r => bucketOf(r) === b);
}

/* ------------------------------------------------------------- summing --- */
function blank() {
  return { n: 0, dur: 0, own: blankX(), opp: blankX(), en: 0, edur: 0, eown: blankX(), eopp: blankX(), games: {} };
}
function addX(dst, src, keys, sign) {
  keys.forEach(k => { dst[k] += sign * num(src[k]); });
}
function addU(dst, src, sign) {
  for (const p in src) { const v = (dst[p] || 0) + sign * src[p]; if (Math.abs(v) < 1e-9) delete dst[p]; else dst[p] = v; }
}
function add(acc, r, sign) {
  const sg = sign == null ? 1 : sign;
  acc.n += sg; acc.dur += sg * num(r.dur);
  addX(acc.own, r.own, BASIC, sg); addX(acc.opp, r.opp, BASIC, sg);
  if (r.ev) {
    acc.en += sg; acc.edur += sg * num(r.dur);
    addX(acc.eown, r.own, ALL, sg); addX(acc.eopp, r.opp, ALL, sg);
    const fk = r.ids.join(','), src = r.own.u || {}, uu = {};
    for (const p in src) uu[fk + '|' + p] = src[p];
    addU(acc.eown.u, uu, sg);
  }
  if (r.g) { const v = (acc.games[r.g] || 0) + sg * (num(r.own.pts) - num(r.opp.pts)); acc.games[r.g] = v; }
  return acc;
}
/* a - b, for "the rest of the team": everything minus the slice */
function minus(a, b) {
  const c = blank();
  const mv = (x, s) => {
    c.n += s * x.n; c.dur += s * x.dur; c.en += s * x.en; c.edur += s * x.edur;
    addX(c.own, x.own, BASIC, s); addX(c.opp, x.opp, BASIC, s);
    addX(c.eown, x.eown, ALL, s); addX(c.eopp, x.eopp, ALL, s); addU(c.eown.u, x.eown.u, s);
  };
  mv(a, 1); mv(b, -1);
  return c;
}
function sum(recs, pred) {
  const acc = blank();
  (recs || []).forEach(r => { if (!pred || pred(r)) add(acc, r); });
  return acc;
}
const has = (ids, want) => { for (let i = 0; i < want.length; i++) if (ids.indexOf(want[i]) === -1) return false; return true; };

/* every group of `size` players who shared the floor (a five holds ten pairs), summed: [{ ids, acc }] */
function units(recs, size) {
  const k = Math.max(1, Math.min(5, size | 0 || 5));
  const by = new Map();
  const pick = (ids, from, cur, out) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = from; i < ids.length; i++) { cur.push(ids[i]); pick(ids, i + 1, cur, out); cur.pop(); }
  };
  (recs || []).forEach(r => {
    const ids = r.ids;
    if (ids.length < k) return;
    const groups = [];
    if (k >= ids.length) groups.push(ids); else pick(ids, 0, [], groups);
    groups.forEach(gr => {
      const key = gr.join(',');
      let v = by.get(key);
      if (!v) { v = { ids: gr, acc: blank() }; by.set(key, v); }
      add(v.acc, r);
    });
  });
  return [...by.values()];
}
/* every on/off arrangement of up to five players (lineups.js matrix, over records) */
function matrix(recs, ids) {
  const picked = (ids || []).slice(0, 5);
  if (!picked.length) return [];
  const rows = [];
  for (let mask = 0; mask < (1 << picked.length); mask++) {
    const on = [], off = [];
    picked.forEach((id, i) => ((mask & (1 << i)) ? on : off).push(id));
    const acc = sum(recs, r => has(r.ids, on) && off.every(id => r.ids.indexOf(id) === -1));
    rows.push({ on, off, state: picked.map(id => on.indexOf(id) !== -1), acc });
  }
  return rows;
}
/* two players, four buckets (lineups.js wowy, over records) */
function pairs(recs, a, b) {
  const out = { both: blank(), aOnly: blank(), bOnly: blank(), neither: blank() };
  (recs || []).forEach(r => {
    const x = r.ids.indexOf(a) !== -1, y = r.ids.indexOf(b) !== -1;
    add(out[x && y ? 'both' : x ? 'aOnly' : y ? 'bOnly' : 'neither'], r);
  });
  return out;
}

/* ------------------------------------------------------------ the line ---
   HELIOCENTRISM: how much of a unit's offence runs through one man, from usage.

     1. USAGE: each player's used plays (FGA + 0.44 FTA + TOV, the usage numerator the engine and season.js use)
        over the plays the team's players used while he was on the floor, in the minutes being read. Pooled over
        all of them, so it rests on every play he was on for, not on one five's handful. Team plays with no
        player (a team turnover) are left out.
     2. For every five those minutes were played in, its members' usage as shares of the five (they sum to 1),
        and the Herfindahl index of those shares, H = sum of the squared shares.
     3. The mean of H over the fives, weighted by the plays each five used, read as the EFFECTIVE NUMBER OF
        PLAYERS sharing the load, 1/H, and put on 0..100 against the five on the floor: 100 x (5 - 1/H) / (5 - 1).

   0: five equal hands. 100: one man used every play. A lead creator at 40% usage with four at 15% is 25; 50% and
   four at 12.5% is 45; a typical five (30 / 24 / 20 / 14 / 12) is about 12. Needs 10 used plays. The top user and
   his share of all the plays ride along for the card and the tooltip. */
const COURT = 5, HELIO_MIN = 10;
function helio(u) {
  const fives = new Map(), plays = new Map(), onFor = new Map();
  Object.keys(u || {}).forEach(k => {
    const v = u[k]; if (!(v > 0)) return;
    const i = k.lastIndexOf('|'), f = i >= 0 ? k.slice(0, i) : '', pid = i >= 0 ? k.slice(i + 1) : k;
    if (!fives.has(f)) fives.set(f, 0);
    fives.set(f, fives.get(f) + v);
    plays.set(pid, (plays.get(pid) || 0) + v);
  });
  const U = [...plays.values()].reduce((a, v) => a + v, 0);
  if (!(U >= HELIO_MIN)) return { v: null, top: null, share: null, used: Math.round(U * 10) / 10 };
  /* the plays used while each player was on */
  fives.forEach((N, f) => f.split(',').forEach(pid => { if (pid) onFor.set(pid, (onFor.get(pid) || 0) + N); }));
  const usage = pid => (onFor.get(pid) > 0 ? (plays.get(pid) || 0) / onFor.get(pid) : 0);
  let wsum = 0, hsum = 0;
  fives.forEach((N, f) => {
    const us = f.split(',').filter(Boolean).map(usage);
    const tot = us.reduce((a, v) => a + v, 0);
    if (!(tot > 0)) return;
    const H = us.reduce((a, v) => a + (v / tot) * (v / tot), 0);
    wsum += N; hsum += N * H;
  });
  let top = null, best = -1;
  plays.forEach((v, pid) => { if (v > best) { best = v; top = pid; } });
  const Hbar = wsum > 0 ? hsum / wsum : null;
  const v = Hbar == null ? null : Hbar <= 1 / COURT ? 0 : Math.max(0, Math.min(100, 100 * (COURT - 1 / Hbar) / (COURT - 1)));
  return { v: v == null ? null : Math.round(v * 10) / 10, top, share: Math.round(1000 * best / U) / 10,
           used: Math.round(U * 10) / 10, eff: Hbar ? Math.round(10 / Hbar) / 10 : null, usage: top ? Math.round(1000 * usage(top)) / 10 : null };
}

const box = X => ({ pts: X.pts, fga: X.fga, fgm: X.fgm, f3m: X.p3m, fta: X.fta, tov: X.tov, or: X.or, dr: X.dr });
/* the line every view reads: the stints' numbers from every record, the event numbers from the event records */
function line(acc) {
  const L = Lin();
  const a = acc || blank();
  const base = L.finish({ dur: a.dur, pf: a.own.pts, pa: a.opp.pts, stints: a.n, off: box(a.own), def: box(a.opp) });
  const op = L.poss(box(a.own));
  const out = {
    stints: a.n, mins: base.mins, poss: base.poss, pm: base.pm, pf: base.pf, pa: base.pa,
    net: base.poss ? base.net : null, ortg: base.ortg, drtg: base.drtg,
    pace40: r1(a.dur > 0 ? op / (a.dur / 60000) * 40 : null),
    efg: base.efg, tov: base.tov, oreb: base.oreb, ftr: base.ftr,
    defg: base.defg, dtov: base.dtov, drb: base.drb, dftr: base.dftr, ts: base.ts,
    games: a.games, evn: a.en, evMins: r1(a.edur / 60000)
  };
  const E = a.eown;
  const ev = a.en > 0;
  const ep = ev ? L.poss(box(E)) : 0;
  const h = ev ? helio(E.u) : { v: null };
  const rebD = E.drbR + E.drbM + E.drb3, rebO = E.orbR + E.orbM + E.orb3;
  /* rim or mid-range needs to know where a two was taken: at least 80% of them, or the split is not shown */
  const twos = E.rimA + E.midA, zok = ev && twos > 0 && E.zk >= 0.8 * twos;
  const oz = a.eopp, otwos = oz.rimA + oz.midA, ozok = ev && (otwos === 0 || oz.zk >= 0.8 * otwos);
  Object.assign(out, {
    sclock: ev ? r1(E.scN > 0 ? E.scS / E.scN : null) : null,
    helio: ev ? h.v : null, helioTop: ev ? h.top : null, helioShare: ev ? h.share : null, helioUsed: ev ? h.used : null, helioEff: ev ? h.eff : null, helioUsage: ev ? h.usage : null,
    rimfg: zok ? r1(pct(E.rimM, E.rimA)) : null, rim100: zok ? r1(pct(E.rimA, ep)) : null, rimast: zok ? r1(pct(E.rimAst, E.rimM)) : null,
    midfg: zok ? r1(pct(E.midM, E.midA)) : null, mid100: zok ? r1(pct(E.midA, ep)) : null, midast: zok ? r1(pct(E.midAst, E.midM)) : null,
    p3: ev ? r1(pct(E.p3m, E.p3a)) : null, p3a100: ev ? r1(pct(E.p3a, ep)) : null, p3ast: ev ? r1(pct(E.p3Ast, E.p3m)) : null,
    trfreq: ev ? r1(pct(E.trN, E.pn)) : null, trppp: ev ? r2(E.trN > 0 ? E.trP / E.trN : null) : null,
    hcfreq: ev ? r1(pct(E.hcN, E.pn)) : null, hcppp: ev ? r2(E.hcN > 0 ? E.hcP / E.hcN : null) : null,
    drbR: ozok ? r1(pct(E.drbR, rebD)) : null, drbM: ozok ? r1(pct(E.drbM, rebD)) : null, drb3: ev ? r1(pct(E.drb3, rebD)) : null,
    orbR: zok ? r1(pct(E.orbR, rebO)) : null, orbM: zok ? r1(pct(E.orbM, rebO)) : null, orb3: ev ? r1(pct(E.orb3, rebO)) : null,
    /* the counts behind the rates, for the tooltips (a '—' says why) */
    _ev: ev ? { rimA: E.rimA, midA: E.midA, p3a: E.p3a, rimM: E.rimM, midM: E.midM, p3m: E.p3m, pn: E.pn, trN: E.trN, hcN: E.hcN, scN: E.scN, rebD, rebO, poss: r1(ep), zones: zok || twos === 0, ozones: ozok } : null
  });
  return out;
}

/* ------------------------------------------------------ the cache format ---
   A game's segments, small enough for sessionStorage: each side's counts as a fixed-order array. */
function pack(G) {
  if (!G || !G.ok) return null;
  return { v: VERSION, id: G.id, st: G.starters, p: G.poss,
    s: G.segs.map(s => [s.ids[0], s.ids[1], s.dur, s.s.map(x => [ALL.map(k => x[k]), x.u])]) };
}
function unpack(o) {
  if (!o || o.v !== VERSION || !Array.isArray(o.s)) return null;
  return { ok: true, id: o.id, starters: o.st, poss: o.p, v: VERSION,
    segs: o.s.map(a => ({ ids: [a[0], a[1]], dur: a[2], s: a[3].map(([vals, u]) => { const x = { u: u || {} }; ALL.forEach((k, i) => { x[k] = vals[i] || 0; }); return x; }) })) };
}

return { VERSION, BASIC, EXTRA, ALL, BUCKETS, gameSegments, recordsOf, fromStints, oppStarters, bucketOf, inBucket,
  blank, blankX, add, minus, sum, units, matrix, pairs, helio, line, pack, unpack };
}));
