'use strict';
/* ============================================================================
   MANAGER - THE MATCH: the reader's game today, live (#/match), and a game played, again (#/live/<round>).

   Louie, 2026-10-14: "Instead of a game being at a fixed time, now with the simulation ability, can the user choose to
   play the game anytime on that day", and "create a new 'live play' feature where the user manages in real time with
   subs, tactics changes, individual instructions etc. in a full screen display with football manager like screens".

   MATCH DAY. The reader's game is theirs to start any time on its day (their own midnight to midnight: core/season.js
   matchday): live, managing it here, or straight to the result. Started, the round's other games are played with it
   and the game in hand is kept (app.js S.live) - left, it waits where it was, and the day over, the assistant plays it
   out. Nothing is played at a set hour any more.

   THE SCREEN, FM's: the scoreboard and the speed along the top; the reader's five down the left (each man's legs, fouls,
   line and match rating; his bench under it); the court in the middle - the ten men in their places, the ball, every
   shot - with the commentary and the game's flow under it; the match's numbers down the right (the team comparison,
   the box score, the play-by-play, the assistant's notes, the opposition); the touchline's buttons along the foot (the
   team's instructions, a player's, a timeout, the assistant's substitutions, the rest of the game now).

   THE CLOCK. The game is played a possession at a time (core/match.js) just ahead of the clock on the screen, and shown
   as the clock reaches it: so a change - a substitution (at the next dead ball, as the rules have it), the team's
   instructions or a man's (from the next possession), a timeout (at the next dead ball) - is the game's from then on.
   The speed is the game clock's against real time (1x is real time). The breaks are the game's: a quarter's end a
   moment, half-time and the reader's own timeouts until they carry on.

   A GAME PLAYED, AGAIN: the same screen on the game's kept play-by-play, at any speed, with nothing to change.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const MT = () => Mgr.match, SE = () => Mgr.season;
const doc = root.document;
const SPEEDS = [1, 2, 4, 8, 16];
const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sv = (tag, attrs) => { const n = doc.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k])); return n; };
const hashOf = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const u01 = s => (hashOf(s) % 100003) / 100003;
const ORD = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

/* ------------------------------------------------------------------ names --- */
const isFill = id => String(id == null ? '' : id).startsWith('fill:');
const who = id => (id == null ? 'a teammate' : isFill(id) ? 'a reserve' : A.nameOf(id));
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
/* a name's words, less the copy's mark and a suffix (Jr, Sr, II, III, IV) */
const words = id => { const p = A.nameOf(id).replace(/\s*\*$/, '').trim().split(/\s+/); while (p.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(p[p.length - 1])) p.pop(); return p; };
/* the name a man goes by on the court: his surname (a particle kept with it: van, de, da) */
function surname(id) {
  if (id == null) return '';
  if (isFill(id)) return 'Reserve';
  const p = words(id);
  if (p.length < 2) return p[0] || '';
  return p.length > 2 && /^[a-z]/.test(p[p.length - 2]) ? p.slice(-2).join(' ') : p[p.length - 1];
}
/* on his dot: his number where the league lists one, else his initials */
function tagOf(id) {
  if (isFill(id)) return 'R';
  const n = A.namedOf(id);
  if (n && n.jersey != null && String(n.jersey) !== '') return String(n.jersey).slice(0, 2);
  const p = words(id);
  return (((p[0] || '')[0] || '') + ((p.length > 1 ? p[p.length - 1] : '')[0] || '')).toUpperCase();
}

/* ------------------------------------------------------------------ the clock --- */
function clockAt(t, G, Tot) {
  const T = G * 60, q = T / 4;
  if (t < T - 1e-6) { const p = Math.min(3, Math.floor((t + 1e-6) / q)); return { p, label: 'Q' + (p + 1), left: (p + 1) * q - t }; }
  const o = Math.max(0, Math.floor((t - T + 1e-6) / Tot));
  return { p: 4 + o, label: o ? 'OT' + (o + 1) : 'OT', left: T + (o + 1) * Tot - t };
}
/* the scoreboard's: tenths in a period's last minute, as the arenas show it */
const fmtLeft = s => { s = Math.max(0, s); if (s > 0 && s < 60) return s.toFixed(1); const c = Math.ceil(s - 1e-6); return Math.floor(c / 60) + ':' + String(c % 60).padStart(2, '0'); };
const fmtMin = s => { const c = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(c / 60) + ':' + String(c % 60).padStart(2, '0'); };
const stampOf = (t, G, Tot) => { const c = clockAt(t, G, Tot); return c.label + ' ' + fmtMin(c.left); };

/* ------------------------------------------------------------------ the game so far --- */
/* EVERYTHING ON THE SCREEN IS THE PLAY-BY-PLAY UP TO THE CLOCK (the engine is a possession ahead): the score, each man's
   line and plus-minus (the five on the floor at each moment: the lineups), the team fouls of the period, the clubs'
   comparison (points in the paint, on the break, second chances, off turnovers), the shots, the margin's path, the
   longest unanswered run, the biggest leads */
function tracker(G, Tot, limit) {
  const team0 = () => ({ fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, paint: 0, fb: 0, sc: 0, ptov: 0 });
  const st = { score: [0, 0], per: 0, box: [new Map(), new Map()], tf: [0, 0], team: [team0(), team0()], shots: [], flow: [[0, 0]], lead: [0, 0], changes: 0, leader: -1,
    ua: { s: -1, n: 0 }, poss: null, toNext: -1, half: null };
  const line = (s, id) => {
    if (id == null) return null;
    const B = st.box[s];
    if (!B.has(id)) B.set(id, { id, pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 });
    return B.get(id);
  };
  const scored = (s, v, fl, t) => {
    if (!v) return;
    st.score[s] += v;
    if (fl) { fl[s].forEach(id => { line(s, id).pm += v; }); fl[s ^ 1].forEach(id => { line(s ^ 1, id).pm -= v; }); }
    const m = st.score[0] - st.score[1];
    st.flow.push([t, m]);
    st.lead[0] = Math.max(st.lead[0], m); st.lead[1] = Math.max(st.lead[1], -m);
    const ldr = m > 0 ? 0 : m < 0 ? 1 : -1;
    if (ldr >= 0 && st.leader >= 0 && ldr !== st.leader) st.changes++;
    if (ldr >= 0) st.leader = ldr;
    if (st.ua.s === s) st.ua.n += v; else st.ua = { s, n: v };
    const P = st.poss, T = st.team[s];
    if (P && P.s === s) { if (P.oreb) T.sc += v; if (P.offTO) T.ptov += v; }
  };
  const foul = (s, id) => {
    const L = line(s, id); if (!L) return null;
    L.pf++; st.team[s].pf++; st.tf[s]++;
    return L.pf;
  };
  st.line = line;
  /* one event; -> what it adds to the commentary besides itself (a man fouled out) */
  st.on = (e, fl) => {
    const p = clockAt(e.t, G, Tot).p;
    if (p !== st.per) { st.per = p; st.tf = [0, 0]; }
    if (p === 2 && !st.half) st.half = { score: st.score.slice(), team: JSON.parse(JSON.stringify(st.team)) };
    const T = e.s != null ? st.team[e.s] : null, extra = [];
    switch (e.k) {
      case 'P': st.poss = { s: e.s, st: e.st, oreb: false, offTO: st.toNext === e.s }; st.toNext = -1; break;
      case 'S': {
        const L = line(e.s, e.p), three = e.z === 2, v = three ? 3 : 2;
        if (L) { L.fga++; if (three) L.p3a++; }
        T.fga++; if (three) T.p3a++;
        if (e.m) {
          if (L) { L.fgm++; L.pts += v; if (three) L.p3m++; }
          T.fgm++; if (three) T.p3m++;
          if (e.a) { const a = line(e.s, e.a); if (a) a.ast++; T.ast++; }
          if (e.z === 0) T.paint += v;
          if (e.tr) T.fb += v;
          scored(e.s, v, fl, e.t);
        }
        if (e.b) { const b = line(e.s ^ 1, e.b); if (b) b.blk++; st.team[e.s ^ 1].blk++; }
        st.shots.push({ s: e.s, z: e.z, m: e.m ? 1 : 0, p: e.p, t: e.t, i: st.shots.length });
        break;
      }
      case 'F': {
        const L = line(e.s, e.p);
        if (L) { L.fta += e.n || 0; L.ftm += e.m || 0; L.pts += e.m || 0; }
        T.fta += e.n || 0; T.ftm += e.m || 0;
        scored(e.s, e.m || 0, fl, e.t);
        if (e.f) { const n = foul(e.s ^ 1, e.f); if (n >= limit) extra.push({ k: 'out', s: e.s ^ 1, p: e.f, t: e.t }); }
        break;
      }
      case 'T': {
        const L = line(e.s, e.p); if (L) L.tov++;
        T.tov++;
        if (e.st) { const x = line(e.s ^ 1, e.st); if (x) x.stl++; st.team[e.s ^ 1].stl++; }
        if (e.of) { const n = foul(e.s, e.p); if (n >= limit) extra.push({ k: 'out', s: e.s, p: e.p, t: e.t }); }
        st.toNext = e.s ^ 1;
        break;
      }
      case 'O': { const L = line(e.s, e.p); if (L) L.oreb++; T.oreb++; if (st.poss) st.poss.oreb = true; break; }
      case 'D': { const L = line(e.s, e.p); if (L) L.dreb++; T.dreb++; break; }
      case 'f': { const n = foul(e.s, e.p); if (n >= limit) extra.push({ k: 'out', s: e.s, p: e.p, t: e.t }); break; }
      case 'X': scored(e.s, 1, fl, e.t); break;
      default: break;
    }
    return extra;
  };
  return st;
}
/* a man's game: Game Score (points, shooting, the boards, the passes, the hands, less the misses, the fouls and the
   turnovers), on the 1-10 scale FM rates a match on, with what his minutes did to the score */
const gameScore = L => L.pts + 0.4 * L.fgm - 0.7 * L.fga - 0.4 * (L.fta - L.ftm) + 0.7 * L.oreb + 0.3 * L.dreb + L.stl + 0.7 * L.ast + 0.7 * L.blk - 0.4 * L.pf - L.tov;
const ratingOf = L => (L ? clamp(6.4 + 0.11 * gameScore(L) + 0.025 * L.pm, 3, 10) : null);
const rtBand = v => (v == null ? '' : v >= 8 ? 'a4' : v >= 7 ? 'a3' : v >= 6 ? 'a2' : 'a1');

/* ------------------------------------------------------------------ the commentary --- */
const pick = (list, n) => list[n % list.length];
/* the words for an event (the reader's language engine leaves the names alone); null for what goes unsaid */
function say(e, ctx) {
  const n = hashOf(e.k + ':' + e.t + ':' + (e.p || '') + ':' + (e.a || '') + ':' + (e.n || 0)), p = who(e.p);
  const club = s => ctx.clubName(s);
  switch (e.k) {
    case 'S': {
      if (e.m) {
        let x = e.z === 2 ? pick([p + ' buries the three', p + ' knocks down a three', p + ' hits from deep', 'Three! ' + p + ' from downtown', p + ' drills the three'], n)
          : e.z === 0 ? (e.pb ? pick([p + ' puts it back in', p + ' with the put-back'], n)
            : e.tr ? pick([p + ' finishes the break', p + ' runs out and scores at the rim', p + ' with the fast-break layup'], n)
              : pick([p + ' scores at the rim', p + ' lays it in', p + ' finishes inside', p + ' throws it down', p + ' with the layup'], n))
            : pick([p + ' hits the jumper', p + ' pulls up and scores', p + ' knocks down the mid-range jumper', p + ' with the floater'], n);
        if (e.a) x += pick([', ' + who(e.a) + ' with the assist', ' off the pass from ' + who(e.a), ', set up by ' + who(e.a)], n >>> 4);
        return { x: cap1(x), big: true, sc: true };
      }
      if (e.b) return { x: cap1(pick([who(e.b) + ' blocks ' + p + '!', 'Rejected! ' + who(e.b) + ' swats ' + p, who(e.b) + ' gets a hand on ' + p + '’s shot'], n)), big: true };
      return { x: cap1(e.z === 2 ? pick([p + ' misses the three', p + ' can’t connect from deep', p + '’s three rims out'], n)
        : e.z === 0 ? pick([p + ' misses at the rim', p + ' can’t finish inside', p + '’s layup won’t drop'], n)
          : pick([p + ' misses the jumper', p + '’s pull-up is off', p + ' misses from mid-range'], n)) };
    }
    case 'F': {
      if (e.kind === 2) return e.m ? { x: 'And one! ' + cap1(p) + ' completes the three-point play', big: true, sc: true } : { x: cap1(p) + ' misses the and-one free throw' };
      const why = e.kind === 3 ? 'Foul to stop the clock' + (e.f ? ' by ' + who(e.f) : '') + '. ' : e.kind === 1 ? 'Shooting foul' + (e.f ? ' on ' + who(e.f) : '') + '. ' : e.f ? 'Foul on ' + who(e.f) + '. ' : '';
      return { x: why + cap1(p) + ' makes ' + e.m + ' of ' + e.n + ' at the line', sc: e.m > 0 };
    }
    case 'T':
      return e.st ? { x: cap1(pick([who(e.st) + ' steals it from ' + p, who(e.st) + ' picks ' + p + '’s pocket', 'Stolen! ' + who(e.st) + ' jumps the pass from ' + p], n)), big: true }
        : e.of ? { x: 'Offensive foul on ' + p + (ctx.pf ? ' (his ' + ORD(ctx.pf) + ')' : '') }
          : { x: cap1(pick([p + ' turns it over', p + ' throws it away', 'Turnover by ' + p, p + ' loses it out of bounds'], n)) };
    case 'O': return { x: cap1(pick([p + ' grabs the offensive rebound', p + ' keeps it alive on the glass', 'Second chance: ' + p + ' with the board'], n)) };
    case 'D': return { x: cap1(p) + ' rebounds', quiet: true };
    case 'f': return { x: 'Foul on ' + p + (ctx.pf ? ' (his ' + ORD(ctx.pf) + ')' : '') };
    case 'U': return { x: 'Substitution, ' + club(e.s) + ': ' + who(e.in) + ' on for ' + who(e.out) + (e.why && e.why !== 'coach' ? ' (' + e.why + ')' : '') };
    case 'Y': return { x: 'Timeout, ' + club(e.s) + (e.why === 'stops the run' ? ', to stop the run' : ''), big: true };
    case 'q': return { x: ['', 'The second quarter is under way', 'The second half is under way', 'The fourth quarter is under way'][e.p] || '', mark: true };
    case 'Q': return e.p ? { x: (e.p > 1 ? 'Overtime ' + e.p : 'Overtime') + ': level at the end of ' + (e.p > 1 ? 'overtime ' + (e.p - 1) : 'regulation'), mark: true } : { x: 'Tip-off', mark: true };
    case 'X': return { x: 'Still level after six overtimes: ' + club(e.s) + ' are awarded the game', big: true, sc: true };
    case 'out': return { x: cap1(p) + ' has fouled out', big: true };
    default: return null;
  }
}

/* ------------------------------------------------------------------ the court --- */
/* the court in feet x10 (94 by 50), the right basket 5.25 feet from its baseline. Spots for the five attacking the right
   basket (the point, the wings, the elbow, the block); the defence between each man and the rim; the other way, mirrored */
const BX = 887.5, BY = 250;
const OFF = [[632, 250], [712, 88], [712, 412], [802, 348], [846, 162]];
const DEF = OFF.map(([x, y]) => [x + 0.36 * (BX - x), y + 0.28 * (BY - y)]);
const mir = (pt, right) => (right ? pt : [940 - pt[0], pt[1]]);
/* where a shot from a zone was taken (rim, mid-range, three: the corner or above the break), attacking right */
function shotSpot(z, a, b) {
  if (z === 0) { const ang = (a - 0.5) * 2.2, r = 14 + 30 * b; return [BX - r * Math.cos(ang), BY + r * Math.sin(ang)]; }
  if (z === 1) { const ang = (a - 0.5) * 2.5, r = 90 + 115 * b; return [BX - r * Math.cos(ang), BY + r * Math.sin(ang)]; }
  if (a < 0.16 || a > 0.84) return [812 + 68 * b, a < 0.16 ? 22 : 478];
  const ang = (a - 0.5) / 0.34 * 0.95, r = 252 + 24 * b;
  return [BX - r * Math.cos(ang), BY + r * Math.sin(ang)];
}
function courtLines(g) {
  g.appendChild(sv('rect', { x: 4, y: 4, width: 932, height: 492, rx: 8, class: 'ln' }));
  g.appendChild(sv('line', { x1: 470, y1: 4, x2: 470, y2: 496, class: 'ln' }));
  g.appendChild(sv('circle', { cx: 470, cy: 250, r: 60, class: 'ln' }));
  [true, false].forEach(right => {
    const X = x => (right ? 940 - x : x), sweep = right ? 0 : 1;
    g.appendChild(sv('path', { class: 'ln', d: 'M' + X(4) + ' 170 L' + X(190) + ' 170 L' + X(190) + ' 330 L' + X(4) + ' 330' }));
    g.appendChild(sv('path', { class: 'ln', d: 'M' + X(190) + ' 190 A60 60 0 0 ' + sweep + ' ' + X(190) + ' 310' }));
    g.appendChild(sv('path', { class: 'ln', d: 'M' + X(4) + ' 30 L' + X(142) + ' 30 A237.5 237.5 0 0 ' + sweep + ' ' + X(142) + ' 470 L' + X(4) + ' 470' }));
    g.appendChild(sv('path', { class: 'ln', d: 'M' + X(52.5) + ' 210 A40 40 0 0 ' + sweep + ' ' + X(52.5) + ' 290' }));
    g.appendChild(sv('line', { x1: X(40), y1: 220, x2: X(40), y2: 280, class: 'ln' }));
    g.appendChild(sv('circle', { cx: X(52.5), cy: 250, r: 7.5, class: 'hoop' }));
  });
}
/* THE COURT: the ten men in their places (the five attacking, the five between them and the rim), the ball with the
   man who has it, a shot's result over the rim; or every shot so far (the shot chart view) */
function makeCourt(wrap, ctx) {
  const s = sv('svg', { viewBox: '0 0 940 500', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'The court' });
  const lines = sv('g'), shots = sv('g'), men = sv('g'), fx = sv('g');
  courtLines(lines);
  s.appendChild(lines); s.appendChild(shots); s.appendChild(men); s.appendChild(fx);
  const ball = sv('circle', { r: 7, class: 'ball' });
  const dots = [0, 1].map(side => [0, 1, 2, 3, 4].map(k => {
    const g = sv('g', { class: 'pl ' + (side === ctx.me ? 'me' : 'op') });
    const c = sv('circle', { r: 17 }), t = sv('text', { x: 0, y: 0 }), lab = sv('text', { x: 0, y: 32, class: 'lab' });
    g.appendChild(c); g.appendChild(t); g.appendChild(lab);
    men.appendChild(g);
    return { g, t, lab, id: null, x: 470, y: 250 };
  }));
  men.appendChild(ball);
  wrap.appendChild(s);
  let view = 'live', hand = null;
  const put = (d, x, y) => { d.x = x; d.y = y; d.g.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; };
  const putBall = (x, y) => { ball.style.transform = 'translate(' + (x + 13).toFixed(1) + 'px,' + (y - 13).toFixed(1) + 'px)'; };
  const holder = (side, k) => { if (hand) hand.g.classList.remove('hand'); hand = side == null ? null : dots[side][k]; if (hand) { hand.g.classList.add('hand'); putBall(hand.x, hand.y); } };
  const names = fl => [0, 1].forEach(side => fl[side].forEach((id, k) => { const d = dots[side][k]; if (!d || d.id === id) return; d.id = id; d.t.textContent = tagOf(id); d.lab.textContent = surname(id); }));
  const slotOf = (fl, side, id) => fl[side].indexOf(id);
  /* the five attacking `side`'s way: in their places, the defence with them */
  const set = (fl, side, right) => {
    names(fl);
    [0, 1, 2, 3, 4].forEach(k => {
      const o = mir(OFF[k], right), d = mir(DEF[k], right), j = (u01(ctx.seed + ':' + k + ':' + side + ':' + Math.round(o[0])) - 0.5) * 24;
      put(dots[side][k], o[0] + j, o[1] + j / 2); put(dots[side ^ 1][k], d[0] - j / 3, d[1]);
    });
    holder(side, 0);
  };
  const pop = (x, y, text, cls) => {
    const t = sv('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'pop ' + cls });
    t.textContent = text; fx.appendChild(t);
    setTimeout(() => t.remove(), 1300);
  };
  const banner = text => {
    fx.querySelectorAll('.banner').forEach(b => b.remove());
    const t = sv('text', { x: 470, y: 262, class: 'banner' }); t.textContent = text; fx.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };
  const jump = fl => {
    names(fl);
    [0, 1].forEach(side => [0, 1, 2, 3, 4].map(k => put(dots[side][k], 470 + (side ? 1 : -1) * (40 + 60 * (k % 3)), 110 + 70 * k)));
    holder(null); putBall(457, 237);
  };
  /* one event on the court, the five attacking `right` or not */
  const play = (e, fl, right, cls) => {
    if (view !== 'live') return;
    const B = mir([BX, BY], right);
    if (e.k === 'P') { set(fl, e.s, right); return; }
    if (e.k === 'Q' || e.k === 'q') { jump(fl); banner(e.k === 'Q' ? (e.p ? 'OVERTIME' : 'TIP-OFF') : ['', 'Q2', 'HALF 2', 'Q4'][e.p] || ''); return; }
    if (e.k === 'Y') { banner('TIMEOUT'); return; }
    if (e.k === 'U') { names(fl); return; }
    const k = slotOf(fl, e.s, e.p), d = k >= 0 ? dots[e.s][k] : null;
    if (e.k === 'S') {
      const sp = mir(shotSpot(e.z, u01(ctx.seed + ':a:' + e.t + ':' + e.p), u01(ctx.seed + ':b:' + e.t + ':' + e.p)), right);
      if (d) { put(d, sp[0], sp[1]); holder(e.s, k); }
      setTimeout(() => putBall(B[0] - 13, B[1] + 13), 90);
      if (e.m) pop(B[0] + (right ? -40 : 40), B[1] - 30, '+' + (e.z === 2 ? 3 : 2), cls(e.s));
      else if (e.b) pop(B[0] + (right ? -46 : 46), B[1] - 30, 'BLOCK', 'miss');
      else pop(B[0] + (right ? -34 : 34), B[1] - 30, '✕', 'miss');
      return;
    }
    if (e.k === 'O' || e.k === 'D') {
      if (d) { put(d, B[0] + (right ? -1 : 1) * (36 + 50 * u01(e.t + 'r' + e.p)), B[1] + (u01(e.t + 'y' + e.p) - 0.5) * 150); holder(e.s, k); }
      return;
    }
    if (e.k === 'F') {
      if (d) { put(d, right ? 742 : 198, 250); holder(e.s, k); }
      if (e.m) pop(B[0] + (right ? -40 : 40), B[1] - 30, '+' + e.m, cls(e.s));
      return;
    }
    if (e.k === 'T') {
      if (e.st) { const j = slotOf(fl, e.s ^ 1, e.st); if (j >= 0 && hand) { put(dots[e.s ^ 1][j], hand.x + 10, hand.y + 6); holder(e.s ^ 1, j); } pop(470, 70, 'STEAL', cls(e.s ^ 1)); }
      else pop(470, 70, 'TURNOVER', 'miss');
    }
  };
  /* every shot so far: each club at the end it attacks first (the home side the right) */
  const chart = list => {
    shots.textContent = '';
    if (view !== 'shots') return;
    list.forEach(x => {
      const sp = mir(shotSpot(x.z, u01(ctx.seed + ':a:' + x.t + ':' + x.p), u01(ctx.seed + ':b:' + x.t + ':' + x.p)), x.s === 0);
      const cls = 'shot ' + (x.s === ctx.me ? 'me' : 'op') + (x.m ? ' m' : ' x');
      if (x.m) shots.appendChild(sv('circle', { cx: sp[0].toFixed(1), cy: sp[1].toFixed(1), r: 7, class: cls }));
      else { const p = 'M' + (sp[0] - 6) + ' ' + (sp[1] - 6) + ' L' + (sp[0] + 6) + ' ' + (sp[1] + 6) + ' M' + (sp[0] + 6) + ' ' + (sp[1] - 6) + ' L' + (sp[0] - 6) + ' ' + (sp[1] + 6); shots.appendChild(sv('path', { d: p, class: cls })); }
    });
  };
  const setView = (v, list) => { view = v; men.style.display = v === 'live' ? '' : 'none'; fx.style.display = v === 'live' ? '' : 'none'; chart(list || []); };
  return { set, jump, play, names, chart, setView, view: () => view, speed: x => s.style.setProperty('--mx-t', clamp(0.6 / x, 0.08, 0.6).toFixed(2) + 's') };
}

/* the margin's path: the reader's lead above the line, the other club's below; the quarters marked */
function flowSvg(flow, endT, G, me, now) {
  const W = 600, H = 56, T = G * 60, X = t => (W * t / Math.max(endT, 1)).toFixed(1);
  const sign = me === 0 ? 1 : -1, pts = flow.filter(p => p[0] <= now + 1e-6).map(p => [p[0], sign * p[1]]);
  pts.push([now, pts.length ? pts[pts.length - 1][1] : 0]);
  const max = Math.max(8, ...pts.map(p => Math.abs(p[1]))), Y = v => (H / 2 - (H / 2 - 4) * v / max).toFixed(1);
  const s = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const defs = sv('defs');
  const up = sv('clipPath', { id: 'mxUp' }); up.appendChild(sv('rect', { x: 0, y: 0, width: W, height: H / 2 }));
  const dn = sv('clipPath', { id: 'mxDn' }); dn.appendChild(sv('rect', { x: 0, y: H / 2, width: W, height: H / 2 }));
  defs.appendChild(up); defs.appendChild(dn); s.appendChild(defs);
  [1, 2, 3].forEach(i => s.appendChild(sv('line', { x1: X(i * T / 4), x2: X(i * T / 4), y1: 0, y2: H, stroke: 'currentColor', 'stroke-opacity': '.18', 'stroke-dasharray': '3 3' })));
  s.appendChild(sv('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: 'currentColor', 'stroke-opacity': '.3' }));
  let d = 'M0 ' + Y(0);
  pts.forEach(p => { d += ' L' + X(p[0]) + ' ' + Y(p[1]); });
  const area = d + ' L' + X(now) + ' ' + (H / 2) + ' Z';
  s.appendChild(sv('path', { d: area, fill: 'var(--mx-me)', 'fill-opacity': '.35', 'clip-path': 'url(#mxUp)' }));
  s.appendChild(sv('path', { d: area, fill: 'var(--mx-op)', 'fill-opacity': '.35', 'clip-path': 'url(#mxDn)' }));
  s.appendChild(sv('path', { d, fill: 'none', stroke: 'var(--mg-ink-2)', 'stroke-width': '1.6', 'vector-effect': 'non-scaling-stroke' }));
  return s;
}

/* a club's colour on the court, kept apart from the reader's royal blue (a blue club plays in orange) */
function opColour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ff9f43';
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.18 || l < 0.2 || l > 0.85) return '#ff9f43';
  let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return hue > 185 && hue < 265 ? '#ff9f43' : '#' + m[1];
}

/* ------------------------------------------------------------------ THE SCREEN --- */
function screen(host, o) {
  const S = A.club.state, live = o.mode === 'live';
  let M = null, f, events, segs, G, Tot, limit, seed;
  if (live) {
    const lv = A.liveGame();
    try { M = A.liveMatch(); } catch (e) { M = null; o.err = e; }
    f = lv ? S.fixtures.find(x => x.r === lv.r && (x.h === 0 || x.a === 0)) : null;
    if (!M || !f) {
      host.appendChild(h('div.mg-panel', h('h2', 'This game cannot be opened just now'), h('p.mg-sub', 'Your squad or the other club could not be read in full' + (o.err ? ' (' + (o.err.message || o.err) + ')' : '') + '. Try again in a moment; if the day ends first, your assistant plays it out.'),
        h('a.mg-btn', { href: '#/' }, '← Back to the club')));
      return;
    }
    events = M.events; segs = M.lineups; G = M.G; Tot = M.Tot; limit = M.limit; seed = M.seed;
  } else {
    f = S.fixtures.find(x => x.r === o.r && (x.h === 0 || x.a === 0));
    const P = S.pbp && S.pbp[o.r];
    events = SE().decodeEvents(S, P.e);
    segs = (P.l || []).map(x => ({ t0: x[0], t1: x[1], h: x[2].map(i => S.people[i]), a: x[3].map(i => S.people[i]) }));
    G = Math.round((A.lg.sim.T || 2400) / 60); Tot = A.lg.sim.Tot || 300; limit = G >= 48 ? 6 : 5; seed = hashOf(S.seed + ':' + o.r);
  }
  const r = f.r, clubs = [f.h, f.a], me = f.h === 0 ? 0 : 1, op = me ^ 1;
  const club = s => A.clubAt(clubs[s]);
  const clubName = s => club(s).short || club(s).name;
  const colOp = opColour(club(op).colour);
  /* the game's end: the live game's clock as far as it has been played; a game played, its last buzzer */
  const endOf = () => (live ? M.g.t : G * 60 + (f.res[2] || 0) * Tot);
  const tr = tracker(G, Tot, limit);

  /* ---- the floor at a moment: the lineups on the clock (in minutes) ---- */
  let segI = 0;
  const floorAt = t => {
    if (!segs.length) return [[], []];
    if (segI >= segs.length || segs[segI].t0 * 60 > t + 1e-6) segI = 0;
    while (segI + 1 < segs.length && segs[segI + 1].t0 * 60 <= t + 1e-6) segI++;
    return [segs[segI].h.slice(), segs[segI].a.slice()];
  };
  /* each man's minutes up to the clock */
  const minutesAt = t => {
    const out = [new Map(), new Map()];
    segs.forEach((x, i) => {
      const a = x.t0 * 60, b = Math.min(t, i + 1 < segs.length ? segs[i + 1].t0 * 60 : t);
      if (b <= a) return;
      x.h.forEach(id => out[0].set(id, (out[0].get(id) || 0) + (b - a)));
      x.a.forEach(id => out[1].set(id, (out[1].get(id) || 0) + (b - a)));
    });
    return out;
  };
  /* everybody a side may play */
  const rosterOf = s => {
    if (live) return M.sides[s].roster.slice();
    const ids = new Set();
    segs.forEach(x => (s ? x.a : x.h).forEach(id => ids.add(id)));
    tr.box[s].forEach((_, id) => ids.add(id));
    return [...ids];
  };

  /* ---- the frame ---- */
  doc.body.classList.add('mg-full');
  const el = h('div.mg-match' + (live ? '.live' : '.replay'));
  el.style.setProperty('--mx-op', colOp);
  el.style.setProperty('--mx-h', me === 0 ? 'var(--mx-me)' : 'var(--mx-op)');
  el.style.setProperty('--mx-v', me === 1 ? 'var(--mx-me)' : 'var(--mx-op)');
  host.appendChild(el);
  /* the scoreboard */
  const ptsEl = [h('b.pts', '0'), h('b.pts', '0')], metaEl = [h('span.meta'), h('span.meta')];
  const perEl = h('span.per', 'Q1'), clkEl = h('b.clk', fmtLeft(G * 15)), stEl = h('span.st', live ? 'Live' : 'Replay');
  const sideEl = s => h('div.side.' + (s ? 'a' : 'h'), s ? ptsEl[1] : null, s ? A.crest(clubs[1], 38) : null,
    h('div.nm', h('b', { translate: 'no' }, club(s).name), metaEl[s]), s ? null : A.crest(clubs[0], 38), s ? null : ptsEl[0]);
  const leave = h('button.mg-mx-leave', { type: 'button', onclick: () => leaveScreen() }, h('span', { 'aria-hidden': 'true' }, '←'), h('span.lbl', live ? ' Save and leave' : ' Back'));
  const speedTabs = h('div.mg-tabs', { role: 'group', 'aria-label': 'Speed' });
  const pauseBtn = h('button', { type: 'button', 'aria-label': 'Pause', onclick: () => togglePause() }, '❚❚');
  speedTabs.appendChild(pauseBtn);
  SPEEDS.forEach(x => speedTabs.appendChild(h('button', { type: 'button', 'data-x': String(x), onclick: () => setSpeed(x) }, x + '×')));
  el.appendChild(h('header.mg-mx-top', leave, h('div.mg-mx-sb', sideEl(0), h('div.mid', perEl, clkEl, stEl), sideEl(1)), h('div.mg-mx-speed', h('span.mg-cap', 'Speed'), speedTabs)));
  /* the body */
  const L = h('aside.mg-mx-l'), C = h('section.mg-mx-c'), R = h('aside.mg-mx-r');
  el.appendChild(h('div.mg-mx-body', L, C, R));
  const fiveCard = h('div.mg-mx-card'), benchCard = h('div.mg-mx-card');
  L.appendChild(fiveCard); L.appendChild(benchCard);
  const courtWrap = h('div.mg-mx-courtwrap'), overEl = h('div.mg-mx-over', { hidden: true });
  const viewTabs = h('div.mg-tabs', { role: 'group', 'aria-label': 'Court view' });
  const court = makeCourt(courtWrap, { me, seed });
  [['live', 'Court'], ['shots', 'Shot chart']].forEach(([k, l]) => viewTabs.appendChild(h('button', { type: 'button', 'aria-pressed': String(k === 'live'), onclick: () => { court.setView(k, tr.shots); viewTabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === l))); } }, l)));
  courtWrap.appendChild(h('div.mg-mx-view', viewTabs));
  courtWrap.appendChild(overEl);
  const commT = h('span.t'), commX = h('span.x'), comm = h('div.mg-mx-comm', { 'aria-live': 'polite' }, commT, commX);
  const flowEl = h('div.mg-mx-flow');
  C.appendChild(courtWrap); C.appendChild(comm); C.appendChild(flowEl);
  /* the right: the numbers */
  const TABS = [['match', 'Match'], ['box', 'Box score'], ['feed', 'Plays']].concat(live ? [['asst', 'Assistant']] : []).concat([['opp', 'Opposition']]);
  let tab = A.stored('mgr_mx_tab') || 'match';
  if (!TABS.some(t => t[0] === tab)) tab = 'match';
  const tabsEl = h('div.mg-tabs', { role: 'tablist' }), tabBody = h('div.mg-mx-card');
  TABS.forEach(([k, l]) => tabsEl.appendChild(h('button', { type: 'button', role: 'tab', 'data-k': k, 'aria-selected': String(k === tab), onclick: () => { tab = k; A.store('mgr_mx_tab', k); tabsEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === k))); drawTab(true); } }, l)));
  R.appendChild(tabsEl); R.appendChild(tabBody);
  /* the touchline */
  const bar = h('footer.mg-mx-bar');
  el.appendChild(bar);
  const tiBtn = h('button.mg-btn.mg-pop-keep', { type: 'button', onclick: ev => openTeam(ev.currentTarget) }, h('span.ic', '⚙'), h('span', 'Team ', h('span.lbl-long', 'instructions')));
  const piBtn = h('button.mg-btn.mg-pop-keep', { type: 'button', onclick: ev => openPick(ev.currentTarget) }, h('span.ic', '☰'), h('span', 'Player ', h('span.lbl-long', 'instructions')));
  const toBtn = h('button.mg-btn', { type: 'button', onclick: () => callTimeout() }, h('span.ic', '⏱'), h('span.t', 'Timeout'));
  const auBtn = h('button.mg-btn', { type: 'button', onclick: () => toggleAuto() }, h('span.ic', '⇄'), h('span', h('span.lbl-long', 'Assistant subs: '), h('span.lbl-short', 'Subs: '), h('span.t', 'on')));
  const simBtn = h('button.mg-btn', { type: 'button', onclick: () => simToEnd() }, h('span.ic', '⏩'), h('span', h('span.lbl-long', live ? 'Rest of the game' : 'To the end'), h('span.lbl-short', 'Finish')));
  if (live) { bar.appendChild(tiBtn); bar.appendChild(piBtn); bar.appendChild(toBtn); bar.appendChild(auBtn); }
  bar.appendChild(simBtn);

  /* ---- the state of the screen ---- */
  let vt = 0, evI = 0, speed = +A.stored('mgr_speed') || 4, paused = true, brk = null, done = false, ended = false, lastFrame = 0, raf = 0;
  if (!SPEEDS.includes(speed)) speed = 4;
  let feed = [], latest = null, dirty = { men: true, tab: true, flow: true, sb: true, shots: -1 }, lastSlow = 0, savedAt = 0, hardAt = Date.now(), dragging = false, pressing = false;
  const onUp = () => { pressing = false; };
  el.addEventListener('pointerdown', () => { pressing = true; });
  root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp);
  let pendTac = null, tacT = 0, pendIns = null, insT = 0;
  const cls = s => (s === me ? 'me' : 'op');
  const mySd = () => (live ? M.sides[me] : null);

  /* one event shown: the numbers, the court, the commentary */
  function show(e, quiet) {
    const fl = floorAt(e.t);
    const extra = tr.on(e, fl);
    /* the basket: the one the side with the ball attacks (a defensive board or a steal belongs to its possession) */
    if (!quiet) court.play(e, fl, attacksRight(tr.poss ? tr.poss.s : (e.s || 0), e.t), cls);
    const pf = e.k === 'f' || (e.k === 'T' && e.of) ? (tr.box[e.s].get(e.p) || {}).pf : 0;
    const w = say(e, { clubName, pf });
    if (w && w.x) {
      const item = { t: e.t, s: e.s != null ? e.s : null, x: w.x, big: !!w.big, sc: !!w.sc, mark: !!w.mark, quiet: !!w.quiet, score: tr.score.slice() };
      feed.push(item);
      if (!w.quiet) latest = item;
    }
    extra.forEach(x => { const w2 = say(x, { clubName }); if (w2) { const it = { t: x.t, s: x.s, x: w2.x, big: true, score: tr.score.slice() }; feed.push(it); latest = it; } });
    if (feed.length > 400) feed = feed.slice(-300);
    if (e.k === 'S' || e.k === 'F' || e.k === 'X' || e.k === 'Y' || e.k === 'f' || e.k === 'q' || e.k === 'Q') dirty.sb = true;
    dirty.men = dirty.tab = dirty.flow = true;
  }
  /* which basket a side attacks: the home side the right one in the first half, the left in the second (and in overtime) */
  const attacksRight = (s, t) => (s === 0) === (clockAt(t, G, Tot).p < 2);

  /* ---- the clock moves ---- */
  /* THE ENGINE NEVER RUNS AHEAD OF WHAT IS SHOWN BY MORE THAN A POSSESSION: the next one is played only when everything so
     far has been shown and the clock has reached its start - so a period's end (and a timeout the reader called) is on
     the screen before the possession after it is played, and what the reader changes at the break is in that one */
  function frame(now) {
    raf = 0;
    if (!el.isConnected) { cleanup(); return; }
    const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    try {
      if (brk && !paused && brk.until && Date.now() >= brk.until) endBreak();
      if (!paused && !brk && !done) {
        vt += dt * speed;
        if (live) {
          let n = 0;
          for (;;) {
            reveal();
            if (brk || paused || done || M.g.over || evI < events.length || M.g.t >= vt || n >= 12) break;
            MT().step(M); n++;
          }
          if (n) { dirty.men = true; if (Date.now() - savedAt > 2000) { savedAt = Date.now(); A.keepLive(false); } }
          if (Date.now() - hardAt > 60000) { hardAt = Date.now(); A.keepLive(true); }
          if (!brk && !paused) vt = Math.min(vt, M.g.t);
        } else { vt = Math.min(vt, endOf()); reveal(); }
      }
    } catch (e) { fail(e); return; }
    paint(now);
    raf = root.requestAnimationFrame(frame);
  }
  /* the events up to the clock; a period's start stops the clock at the break, the reader's own timeout stops it for
     them; the last event shown and the buzzer reached, full time */
  function reveal(quiet) {
    while (evI < events.length && events[evI].t <= vt + 1e-6) {
      const e = events[evI];
      evI++;
      if (!quiet && (e.k === 'q' || (e.k === 'Q' && e.p > 0))) { vt = e.t; show(e); startBreak(e); return; }
      show(e, quiet);
      if (!quiet && live && e.k === 'Y' && e.s === me && e.why === 'called by the coach') { vt = e.t; timeoutBreak(); return; }
    }
    if (!quiet && evI >= events.length && (!live || M.g.over) && vt >= endOf() - 1e-6) final();
  }

  /* ---- the breaks ---- */
  function startBreak(e) {
    const half = e.k === 'q' && e.p === 2, ot = e.k === 'Q';
    if (live) A.keepLive(true);
    if (half && live) { brk = { label: 'Half-time' }; overlay(halfTime()); return; }
    brk = { label: half ? 'Half-time' : ot ? 'End of ' + (e.p > 1 ? 'overtime ' + (e.p - 1) : 'regulation') : 'End of Q' + e.p, until: Date.now() + (half ? 3500 : live ? 2600 : 1600) };
    dirty.sb = true;
  }
  function endBreak() { brk = null; overlay(null); dirty.sb = true; }
  function timeoutBreak() {
    paused = true; drawSpeed();
    overlay(h('div.in', h('h2', 'Timeout'), h('p.mg-sub', 'The game stops with you. Make your substitutions and change the instructions, then carry on.'),
      h('div.sc', tr.score[0] + ' – ' + tr.score[1]), notesList(3),
      h('div.go', h('button.mg-btn.mg-pop-keep', { type: 'button', onclick: ev => openTeam(ev.currentTarget) }, 'Team instructions'), h('button.mg-btn.primary', { type: 'button', onclick: () => { overlay(null); play(); } }, '▶ Back to the game'))));
  }
  function halfTime() {
    const a = tr.team[me], b = tr.team[op];
    const pct = (m, n) => (n ? Math.round(100 * m / n) + '%' : '–');
    return h('div.in', h('h2', 'Half-time'), h('div.sc', tr.score[0] + ' – ' + tr.score[1]),
      h('div.stars',
        h('div', h('span', 'Shooting'), h('b', pct(a.fgm, a.fga) + ' v ' + pct(b.fgm, b.fga))),
        h('div', h('span', 'Threes'), h('b', a.p3m + '/' + a.p3a + ' v ' + b.p3m + '/' + b.p3a)),
        h('div', h('span', 'Rebounds'), h('b', (a.oreb + a.dreb) + ' v ' + (b.oreb + b.dreb))),
        h('div', h('span', 'Turnovers'), h('b', a.tov + ' v ' + b.tov))),
      notesList(3),
      h('div.go', h('button.mg-btn.mg-pop-keep', { type: 'button', onclick: ev => openTeam(ev.currentTarget) }, 'Team instructions'),
        h('button.mg-btn.primary', { type: 'button', onclick: () => { endBreak(); play(); } }, '▶ Start the second half')));
  }
  function overlay(node) { overEl.textContent = ''; if (node) { overEl.appendChild(node); overEl.hidden = false; } else overEl.hidden = true; }

  /* ---- full time ---- */
  async function final() {
    if (done) return;
    done = true; paused = true; brk = null;
    dirty.sb = dirty.men = dirty.tab = dirty.flow = true;
    const won = tr.score[me] > tr.score[op];
    const top = s => [...tr.box[s].values()].sort((x, y) => (ratingOf(y) - ratingOf(x)) || (y.pts - x.pts))[0];
    const star = s => { const b = top(s); return b ? h('div', h('span', A.nm(who(b.id)), ' · ', A.nm(clubName(s))), h('b', b.pts + ' pts, ' + (b.oreb + b.dreb) + ' reb, ' + b.ast + ' ast')) : null; };
    const box = h('div.in', h('h2', live ? (won ? 'Full time: a win' : 'Full time: a defeat') : 'Final'), h('div.sc', tr.score[0] + ' – ' + tr.score[1]),
      M && M.g.ot ? h('p.mg-sub', M.g.ot > 1 ? 'After ' + M.g.ot + ' overtimes' : 'After overtime') : null,
      h('div.stars', star(me), star(op)), h('p.mg-sub', live ? 'Saving the game into your season…' : ''));
    overlay(box);
    if (live && !ended) {
      ended = true;
      try { await A.endLive(); box.querySelector('p.mg-sub:last-of-type').textContent = 'In your season: the table, the statistics and the leaderboards have it.'; }
      catch (e) { box.querySelector('p.mg-sub:last-of-type').textContent = 'It could not be saved just now: it is kept here and saved on your next visit.'; }
    }
    box.appendChild(h('div.go', h('a.mg-btn.primary', { href: '#/game/' + r }, 'The box score'), h('a.mg-btn', { href: '#/' }, 'Back to the club')));
    drawSpeed();
  }

  /* ---- what the screen shows ---- */
  function paint(now) {
    /* the clock, every frame */
    const c = clockAt(Math.min(vt, endOf()), G, Tot);
    if (done) { perEl.textContent = 'FINAL'; clkEl.textContent = (M ? M.g.ot : 0) ? 'OT' : '0:00'; }
    else if (brk) { perEl.textContent = brk.label.toUpperCase(); clkEl.textContent = '0:00'; }
    else { perEl.textContent = c.label; clkEl.textContent = fmtLeft(c.left); }
    stEl.textContent = done ? 'Final' : brk ? 'Break' : paused ? 'Paused' : live ? 'Live' : 'Replay';
    stEl.classList.toggle('live', !done && !paused && !brk && live);
    if (dirty.sb) { dirty.sb = false; drawBoard(); }
    if (latest && commX._it !== latest) {
      commX._it = latest;
      commT.textContent = stampOf(latest.t, G, Tot);
      commX.textContent = latest.x;
      commX.classList.toggle('big', latest.big);
      comm.classList.remove('flash'); void comm.offsetWidth; if (latest.big) comm.classList.add('flash');
    }
    /* the rest: twice a second at most, and never under a press (a list redrawn between a press and its release would
       lose the click) */
    if (now - lastSlow > 450) {
      lastSlow = now;
      if (dirty.flow) { dirty.flow = false; flowEl.textContent = ''; flowEl.appendChild(flowSvg(tr.flow, Math.max(G * 60, endOf()), G, me, Math.min(vt, endOf()))); }
      if (!pressing && !dragging) {
        if (dirty.men) { dirty.men = false; drawMen(); }
        if (dirty.tab) { dirty.tab = false; drawTab(); }
      }
      if (court.view() === 'shots' && dirty.shots !== tr.shots.length) { dirty.shots = tr.shots.length; court.chart(tr.shots); }
      drawBar();
    }
  }
  function drawBoard() {
    [0, 1].forEach(s => {
      const v = String(tr.score[s]);
      if (ptsEl[s].textContent !== v) { ptsEl[s].textContent = v; ptsEl[s].classList.remove('flash'); void ptsEl[s].offsetWidth; ptsEl[s].classList.add('flash'); }
      metaEl[s].textContent = '';
      if (live) { const to = M.sides[s].to; metaEl[s].appendChild(h('span', 'TO ', h('span.mg-mx-pips', [0, 1, 2].map(i => h('i' + (i < to ? '.on' : '')))))); }
      /* the period's team fouls, FIBA's five lights: red from the fourth (every foul after it is two free throws) */
      const tf = tr.tf[s];
      metaEl[s].appendChild(h('span', { title: tf + ' team fouls this period' }, 'Fouls ', h('span.mg-mx-pips.f', [0, 1, 2, 3, 4].map(i => h('i' + (i < tf ? (tf >= 4 ? '.pen' : '.on') : ''))))));
    });
  }
  function drawSpeed() {
    pauseBtn.textContent = paused || done ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    pauseBtn.setAttribute('aria-pressed', String(!paused && !done));
    speedTabs.querySelectorAll('button[data-x]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.x === speed)));
    court.speed(speed);
  }
  function drawBar() {
    if (!live) { simBtn.disabled = done ? true : null; return; }
    const sd = M.sides[me];
    toBtn.querySelector('.t').textContent = sd.wantTO ? 'Timeout called' : 'Timeout (' + sd.to + ')';
    toBtn.classList.toggle('wait', !!sd.wantTO);
    toBtn.disabled = done || sd.to <= 0 ? true : null;
    auBtn.querySelector('.t').textContent = sd.auto ? 'on' : 'off';
    auBtn.classList.toggle('on', !!sd.auto);
    [tiBtn, piBtn, auBtn, simBtn].forEach(b => { b.disabled = done ? true : null; });
  }

  /* ---- your team: the five and the bench ---- */
  function manRow(s, id, k, mins, onFloor) {
    const L = tr.box[s].get(id), sd = live ? M.sides[s] : null, en = sd ? sd.en[id] : null;
    const pf = L ? L.pf : 0, outF = pf >= limit, rt = L && (mins.get(id) || 0) > 30 ? ratingOf(L) : null;
    const trouble = pf >= (clockAt(vt, G, Tot).p < 3 ? MT().TROUBLE[Math.min(3, clockAt(vt, G, Tot).p)] + (limit - 5) : limit - 1);
    const pend = sd && s === me ? sd.pend.find(p => p.out === id || p.in === id) : null;
    const li = h('li' + (outF ? '.gone' : '') + (pend ? '.out' : ''), { 'data-id': id, tabindex: outF || s !== me || !live ? null : '0', draggable: live && s === me && !outF ? 'true' : null, role: live && s === me ? 'button' : null,
      'aria-label': live && s === me ? A.nameOf(id) + ': substitution and instructions' : null },
      h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, onFloor ? A.SLOTS[k] : A.posOf(id)),
      h('div.nm', h('b', { translate: 'no' }, A.nameOf(id)),
        h('span.ln', h('span', L || onFloor ? (L ? L.pts : 0) + ' pts · ' + (L ? L.oreb + L.dreb : 0) + ' reb · ' + (L ? L.ast : 0) + ' ast' : 'Not on yet'), h('span', fmtMin(mins.get(id) || 0))),
        en != null ? h('div.mg-mx-en', { title: 'Energy ' + Math.round(en) + '%' }, h('i' + (en < 50 ? '.low' : en < 70 ? '.mid' : ''), { style: { width: Math.round(en) + '%' } })) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } },
        h('span.mg-mx-rt.' + (rtBand(rt) || 'a0'), { title: 'Match rating' }, rt == null ? '–' : rt.toFixed(1)),
        h('span.mg-mx-fl' + (trouble && !outF ? '.trouble' : ''), { title: pf + (pf === 1 ? ' foul' : ' fouls') }, [0, 1, 2, 3, 4].slice(0, limit).map(i => h('i' + (i < pf ? '.on' : ''))))),
      pend ? h('span.pend', pend.out === id ? '⇄ ' + who(pend.in) + ' comes on at the next dead ball' : '⇄ on for ' + who(pend.out) + ' at the next dead ball') : null,
      outF ? h('span.pend', { style: { color: 'var(--mg-bad)' } }, 'Fouled out') : null);
    if (live && s === me && !outF) {
      li.addEventListener('click', () => openMan(id, li));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openMan(id, li); } });
      li.addEventListener('dragstart', ev => { dragging = true; ev.dataTransfer.setData('text/plain', id); });
      li.addEventListener('dragend', () => { dragging = false; dirty.men = true; });
      li.addEventListener('dragover', ev => { ev.preventDefault(); li.classList.add('over'); });
      li.addEventListener('dragleave', () => li.classList.remove('over'));
      li.addEventListener('drop', ev => {
        ev.preventDefault(); li.classList.remove('over'); dragging = false;
        const other = ev.dataTransfer.getData('text/plain');
        if (!other || other === id) return;
        const fl = M.sides[me].floor, a = fl.includes(id), b = fl.includes(other);
        if (a !== b) sub(a ? id : other, a ? other : id);
      });
    }
    return li;
  }
  function drawMen() {
    const fl = floorAt(vt), mins = minutesAt(Math.min(vt, endOf()));
    const sd = mySd();
    fiveCard.textContent = ''; benchCard.textContent = '';
    fiveCard.appendChild(h('div.hd', h('h3', live ? 'On the floor' : A.club.name), live ? h('span.mg-chip' + (sd.auto ? '.good' : ''), sd.auto ? 'Assistant subs on' : 'Your subs') : null));
    const ul = h('ul.mg-mx-men');
    fl[me].forEach((id, k) => ul.appendChild(manRow(me, id, k, mins[me], true)));
    fiveCard.appendChild(ul);
    benchCard.appendChild(h('div.hd', h('h3', 'Bench'), live ? h('span.mg-sub', { style: { fontSize: '11px' } }, 'Drag onto a man, or press') : null));
    const ub = h('ul.mg-mx-men');
    rosterOf(me).filter(id => !fl[me].includes(id)).sort((a, b) => (mins[me].get(b) || 0) - (mins[me].get(a) || 0)).forEach(id => ub.appendChild(manRow(me, id, -1, mins[me], false)));
    if (!ub.children.length) ub.appendChild(h('li', { style: { cursor: 'default' } }, 'Nobody on the bench.'));
    benchCard.appendChild(ub);
  }

  /* ---- the right: the tabs ---- */
  function drawTab(force) {
    if (force) dirty.tab = false;
    const keep = tabBody.scrollTop;
    tabBody.textContent = '';
    if (tab === 'match') tabBody.appendChild(compare());
    else if (tab === 'box') { tabBody.appendChild(boxOf(me)); tabBody.appendChild(h('div', { style: { height: '12px' } })); tabBody.appendChild(boxOf(op)); }
    else if (tab === 'feed') tabBody.appendChild(feedList());
    else if (tab === 'asst') tabBody.appendChild(assistant());
    else if (tab === 'opp') tabBody.appendChild(opposition());
    tabBody.scrollTop = keep;
  }
  function compare() {
    const H = tr.team[0], V = tr.team[1];
    const pc = (m, n) => (n ? Math.round(100 * m / n) + '%' : '–');
    const rows = [
      ['Points', tr.score[0], tr.score[1]],
      ['Field goals', H.fgm + '/' + H.fga + ' ' + pc(H.fgm, H.fga), V.fgm + '/' + V.fga + ' ' + pc(V.fgm, V.fga), H.fga ? H.fgm / H.fga : 0, V.fga ? V.fgm / V.fga : 0],
      ['Three-pointers', H.p3m + '/' + H.p3a, V.p3m + '/' + V.p3a, H.p3a ? H.p3m / H.p3a : 0, V.p3a ? V.p3m / V.p3a : 0],
      ['Free throws', H.ftm + '/' + H.fta, V.ftm + '/' + V.fta, H.ftm, V.ftm],
      ['Rebounds (offensive)', (H.oreb + H.dreb) + ' (' + H.oreb + ')', (V.oreb + V.dreb) + ' (' + V.oreb + ')', H.oreb + H.dreb, V.oreb + V.dreb],
      ['Assists', H.ast, V.ast], ['Turnovers', H.tov, V.tov], ['Steals', H.stl, V.stl], ['Blocks', H.blk, V.blk],
      ['Points in the paint', H.paint, V.paint], ['Fast-break points', H.fb, V.fb], ['Second-chance points', H.sc, V.sc], ['Points off turnovers', H.ptov, V.ptov],
      ['Biggest lead', tr.lead[0], tr.lead[1]], ['Fouls', H.pf, V.pf]
    ];
    const wrap = h('div.mg-mx-cmp');
    wrap.appendChild(h('div.mg-row.between', h('span.mg-row', A.crest(clubs[0], 20), h('b', { translate: 'no' }, clubName(0))), h('span.mg-row', h('b', { translate: 'no' }, clubName(1)), A.crest(clubs[1], 20))));
    rows.forEach(([k, a, b, x, y]) => {
      const va = x != null ? x : +a || 0, vb = y != null ? y : +b || 0, tot = va + vb;
      const wa = tot > 0 ? 100 * va / tot : 50;
      wrap.appendChild(h('div.row', h('span.k', k), h('span.a', String(a)), h('div.bar', h('i.h', { style: { width: wa.toFixed(1) + '%' } }), h('i.v', { style: { width: (100 - wa).toFixed(1) + '%' } })), h('span.b', String(b))));
    });
    if (tr.changes) wrap.appendChild(h('p.mg-sub', { style: { textAlign: 'center', margin: '4px 0 0' } }, tr.changes + (tr.changes === 1 ? ' lead change' : ' lead changes')));
    return wrap;
  }
  function boxOf(s) {
    const mins = minutesAt(Math.min(vt, endOf()))[s], fl = floorAt(vt)[s];
    const ids = [...new Set(rosterOf(s).concat([...tr.box[s].keys()]))].filter(id => fl.includes(id) || (mins.get(id) || 0) > 0 || tr.box[s].has(id));
    ids.sort((a, b) => (fl.includes(b) - fl.includes(a)) || ((mins.get(b) || 0) - (mins.get(a) || 0)));
    const t = h('table.mg-table.mg-mx-box', h('thead', h('tr', h('th.l', { translate: 'no' }, clubName(s)), ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FG', '3P', 'FT', '+/−'].map(x => h('th', x)))));
    const tb = h('tbody'), tot = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0 };
    ids.forEach(id => {
      const L = tr.box[s].get(id) || { pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 };
      Object.keys(tot).forEach(k => { tot[k] += k === 'reb' ? L.oreb + L.dreb : L[k] || 0; });
      tb.appendChild(h('tr' + (fl.includes(id) ? '.on' : ''), h('td.l', A.nm(surname(id))), h('td', fmtMin(mins.get(id) || 0)), h('td', h('b', String(L.pts))), h('td', String(L.oreb + L.dreb)), h('td', String(L.ast)),
        h('td', String(L.stl)), h('td', String(L.blk)), h('td', String(L.tov)), h('td', String(L.pf)), h('td', L.fgm + '/' + L.fga), h('td', L.p3m + '/' + L.p3a), h('td', L.ftm + '/' + L.fta),
        h('td', (L.pm > 0 ? '+' : '') + L.pm)));
    });
    tb.appendChild(h('tr', h('td.l', h('b', 'Team')), h('td', ''), h('td', h('b', String(tot.pts))), h('td', String(tot.reb)), h('td', String(tot.ast)), h('td', String(tot.stl)), h('td', String(tot.blk)), h('td', String(tot.tov)),
      h('td', String(tot.pf)), h('td', tot.fgm + '/' + tot.fga), h('td', tot.p3m + '/' + tot.p3a), h('td', tot.ftm + '/' + tot.fta), h('td', '')));
    t.appendChild(tb);
    return h('div.mg-tablewrap', t);
  }
  function feedList() {
    const ul = h('ul.mg-mx-feed');
    feed.slice(-160).reverse().forEach(it => {
      if (it.mark) { ul.appendChild(h('li.mark', it.x)); return; }
      ul.appendChild(h('li' + (it.sc ? '.sc' : '') + (it.s != null ? '.' + cls(it.s) : ''), h('span.t', stampOf(it.t, G, Tot).replace(/^(Q\d|OT\d?) /, '$1 ')),
        it.s != null ? A.crest(clubs[it.s], 18) : h('span'), h('span', it.x, it.sc ? h('b', { style: { marginLeft: '6px' } }, it.score[0] + '–' + it.score[1]) : null)));
    });
    if (!ul.children.length) ul.appendChild(h('li.mark', 'Nothing yet'));
    return ul;
  }
  /* the opposition: their five and their bench, as the reader's own */
  function opposition() {
    const fl = floorAt(vt), mins = minutesAt(Math.min(vt, endOf()));
    const wrap = h('div');
    wrap.appendChild(h('div.hd', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' } }, h('span.mg-cap', 'On the floor'), A.crest(clubs[op], 22)));
    const ul = h('ul.mg-mx-men');
    fl[op].forEach((id, k) => ul.appendChild(manRow(op, id, k, mins[op], true)));
    wrap.appendChild(ul);
    wrap.appendChild(h('div.mg-cap', { style: { margin: '12px 0 8px' } }, 'Bench'));
    const ub = h('ul.mg-mx-men');
    rosterOf(op).filter(id => !fl[op].includes(id)).sort((a, b) => (mins[op].get(b) || 0) - (mins[op].get(a) || 0)).forEach(id => ub.appendChild(manRow(op, id, -1, mins[op], false)));
    wrap.appendChild(ub);
    return wrap;
  }

  /* ---- THE ASSISTANT (FM's): what he sees, in a sentence each ---- */
  function notes() {
    const out = [], sd = mySd(), fl = floorAt(vt)[me], c = clockAt(vt, G, Tot), mine = tr.team[me], theirs = tr.team[op];
    if (live) {
      fl.forEach(id => {
        const en = sd.en[id];
        if (en < 45) out.push(['bad', cap1(who(id)) + ' is exhausted (energy ' + Math.round(en) + '%): his shooting, his hands and his defence are going. Rest him.']);
        else if (en < 62) out.push(['warn', cap1(who(id)) + ' is tiring (energy ' + Math.round(en) + '%).']);
      });
      const tLim = c.p < 3 ? MT().TROUBLE[c.p] + (limit - 5) : limit - 1;
      fl.forEach(id => { const L = tr.box[me].get(id); if (L && L.pf >= tLim) out.push(['warn', cap1(who(id)) + ' is in foul trouble (' + L.pf + ' fouls)' + (c.p < 3 ? ': one more and he should sit until the next quarter.' : '.')]); });
    }
    const ua = tr.ua;
    if (ua.s === op && ua.n >= 8) out.push(['bad', clubName(op) + ' are on a ' + ua.n + '–0 run' + (live && sd.to > 0 ? ': a timeout would stop it.' : '.')]);
    if (ua.s === me && ua.n >= 8) out.push(['good', 'We are on a ' + ua.n + '–0 run.']);
    const hot = [...tr.box[op].values()].sort((a, b) => b.pts - a.pts)[0];
    if (hot && hot.pts >= 12 && hot.fga && hot.fgm / hot.fga >= 0.5) out.push(['warn', cap1(who(hot.id)) + ' is hurting us: ' + hot.pts + ' points on ' + hot.fgm + ' of ' + hot.fga + '. Put your best defender on him, or Stay solid and make him beat a set defence.']);
    const ours = [...tr.box[me].values()].sort((a, b) => b.pts - a.pts)[0];
    if (ours && ours.pts >= 14 && ours.fga && ours.fgm / ours.fga >= 0.5) out.push(['good', cap1(who(ours.id)) + ' has the hot hand (' + ours.pts + ' points): more touches for him (his player instructions).']);
    if (mine.p3a >= 8 && mine.p3m / mine.p3a < 0.27) out.push(['warn', 'We are cold from three (' + mine.p3m + ' of ' + mine.p3a + '). Ball handlers: Get downhill, or Off-ball cutting, finds better shots.']);
    if (mine.tov >= 7 && mine.tov > theirs.tov + 2) out.push(['warn', 'We have turned it over ' + mine.tov + ' times. Fewer touches for a loose handler, or Slow it down for your guard, steadies it.']);
    if (theirs.oreb >= 6 && theirs.oreb > mine.oreb + 2) out.push(['warn', 'They have ' + theirs.oreb + ' offensive rebounds. Less Leak out keeps more men back for the glass.']);
    if (theirs.paint >= 20 && theirs.paint > mine.paint + 6) out.push(['warn', 'They have ' + theirs.paint + ' points in the paint. No paint touches, or a rim protector with Defend the rim aggressively, closes it.']);
    if (theirs.tov >= 8 && theirs.tov > mine.tov + 3) out.push(['good', 'Our pressure is working: ' + theirs.tov + ' turnovers forced.']);
    if (live && !sd.auto) out.push(['info', 'You are making the substitutions: watch the legs and the fouls (only a man who fouls out is changed for you).']);
    if (live && sd.auto && sd.hold === Infinity) out.push(['info', 'Your changes stand until the next quarter: then the assistant follows your lineups again.']);
    if (!out.length) out.push(['good', 'Nothing to worry about: the plan is working.']);
    return out;
  }
  const notesList = n => { const ul = h('ul.mg-mx-notes', { style: { marginTop: '12px', textAlign: 'left' } }); notes().slice(0, n || 99).forEach(([lvl, x]) => ul.appendChild(h('li', h('i.' + lvl), h('span', x)))); return ul; };
  function assistant() {
    const sd = mySd(), wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    wrap.appendChild(h('div.mg-mx-switch', h('span', 'The assistant makes the substitutions', h('br'), h('span.mg-sub', { style: { fontSize: '11.5px' } }, 'Your lineups and minutes, changed for legs, fouls and a decided game')),
      h('button.mg-btn' + (sd.auto ? '.primary' : ''), { type: 'button', onclick: () => toggleAuto() }, sd.auto ? 'On' : 'Off')));
    wrap.appendChild(notesList());
    return wrap;
  }

  /* ---- the reader's changes ---- */
  function sub(outId, inId) {
    if (!live || done) return;
    const sd = M.sides[me];
    if (!sd.floor.includes(outId) || sd.floor.includes(inId)) { A.toast('That substitution is not possible now.', true); return; }
    if ((sd.pf[inId] || 0) >= limit) { A.toast(who(inId) + ' has fouled out.', true); return; }
    sd.pend = sd.pend.filter(p => p.out !== outId && p.in !== inId);
    MT().act(M, me, { type: 'sub', out: outId, in: inId });
    A.ui.close();
    A.toast(cap1(who(inId)) + ' comes on for ' + who(outId) + ' at the next dead ball.');
    dirty.men = true;
    A.keepLive(false);
  }
  /* a man pressed: his instructions for this game, and the substitution */
  function openMan(id, anchor) {
    const sd = M.sides[me], onFloor = sd.floor.includes(id), k = sd.floor.indexOf(id);
    const entry0 = (A.club.roster || []).find(x => String(x.id) === String(id)) || {};
    const cur = (pendIns && pendIns[id]) || (sd.T.ins && sd.T.ins.get(id) ? { u: sd.T.ins.get(id).u, k: [...sd.T.ins.get(id).k] } : null);
    const entry = { u: cur ? cur.u : 0, ins: cur ? cur.k.slice() : [], role: entry0.role };
    const actions = [];
    const pend = sd.pend.find(p => p.out === id || p.in === id);
    if (pend) actions.push(h('button.mg-btn', { type: 'button', onclick: () => { MT().act(M, me, { type: 'unsub', out: pend.out, in: pend.in }); A.ui.close(); dirty.men = true; } }, '✕ Cancel the substitution'));
    else if (onFloor) {
      const cands = MT().available(M, sd).map(x => ({ id: x, s: fitAt(sd, x, k) })).sort((a, b) => b.s - a.s);
      actions.push(h('span.mg-cap', { style: { width: '100%' } }, 'Take him off for'));
      cands.slice(0, 8).forEach(c => actions.push(h('button.mg-btn', { type: 'button', style: { padding: '6px 10px', fontSize: '12px' }, onclick: () => sub(id, c.id) },
        h('span.mg-pos', A.posOf(c.id)), ' ', A.nm(surname(c.id)), h('span.mg-sub', { style: { fontSize: '11px' } }, ' ' + Math.round(sd.en[c.id]) + '%'))));
      if (!cands.length) actions.push(h('span.mg-sub', 'Nobody is free to come on.'));
    } else if ((sd.pf[id] || 0) < limit) {
      actions.push(h('span.mg-cap', { style: { width: '100%' } }, 'Bring him on for'));
      sd.floor.forEach((x, kk) => actions.push(h('button.mg-btn', { type: 'button', style: { padding: '6px 10px', fontSize: '12px' }, onclick: () => sub(x, id) },
        h('span.mg-pos', A.SLOTS[kk]), ' ', A.nm(surname(x)), h('span.mg-sub', { style: { fontSize: '11px' } }, ' ' + Math.round(sd.en[x]) + '%'))));
    }
    A.ui.pop(A.ui.playerPanel(id, { entry, actions, sub: 'This game: from the next possession', onChange: x => setIns(id, x) }), anchor, { label: 'Player: ' + A.nameOf(id) });
  }
  /* a bench man's fit at a place: his minutes there, his position near it, his legs */
  function fitAt(sd, id, k) {
    const c = sd.T.cards.get(id); if (!c) return -9;
    const share = Array.isArray(c.share) ? (c.share[k] || 0) : 0, d = Math.abs((c.pos || 3) - (k + 1));
    return 2 * share - 0.6 * Math.max(0, d - 0.6) + 1.2 * (sd.en[id] || 0) / 100 + 0.8 * clamp((c.mpg || 10) / 30, 0, 1.3);
  }
  function setIns(id, x) {
    const sd = M.sides[me];
    const obj = pendIns || MT().insObj(sd.T.ins);
    if ((x.u || 0) || (x.ins && x.ins.length)) obj[id] = { u: x.u || 0, k: (x.ins || []).slice() }; else delete obj[id];
    pendIns = obj;
    clearTimeout(insT);
    insT = setTimeout(() => { if (pendIns) { MT().act(M, me, { type: 'ins', ins: pendIns }); pendIns = null; A.keepLive(false); } }, 300);
  }
  /* "Player instructions" on the touchline: the squad to choose from */
  function openPick(anchor) {
    const sd = M.sides[me], fl = sd.floor;
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('h3', { style: { margin: '0 30px 6px 0' } }, 'Player instructions'), h('p.mg-sub', { style: { margin: '0 0 6px' } }, 'For this game, from the next possession. Your squad’s own (Tactics) are untouched.'));
    fl.concat(sd.roster.filter(x => !fl.includes(x))).forEach(id => {
      const b = h('button.mg-btn', { type: 'button', style: { justifyContent: 'flex-start', padding: '8px 10px' }, onclick: () => openMan(id, anchor) },
        h('span.mg-pos', A.posOf(id)), A.nm(A.nameOf(id)), fl.includes(id) ? h('span.mg-chip.good', { style: { marginLeft: 'auto' } }, 'on the floor') : null);
      list.appendChild(b);
    });
    A.ui.pop(list, anchor, { above: true, label: 'Player instructions' });
  }
  function openTeam(anchor) {
    const sd = M.sides[me], tac = sd.tac || MT().planAt(sd.T.segs, Math.min(vt, G * 60 - 1) / 60, G).tac || {};
    const back = h('button.mg-btn', { type: 'button', onclick: () => { clearTimeout(tacT); pendTac = null; MT().act(M, me, { type: 'tac', tac: null }); A.ui.close(); A.toast('Back to each lineup’s own instructions.'); } }, 'Each lineup’s own');
    A.ui.pop(A.ui.teamPanel({ tac, title: 'Team instructions', sub: 'This game, from the next possession: every lineup plays them until you change them again',
      onChange: t => { pendTac = t; clearTimeout(tacT); tacT = setTimeout(() => { if (pendTac) { MT().act(M, me, { type: 'tac', tac: pendTac }); pendTac = null; A.keepLive(false); } }, 300); },
      extra: sd.tac ? back : null }), anchor, { above: true, cls: 'wide', label: 'Team instructions' });
  }
  function callTimeout() {
    const sd = M.sides[me];
    if (done || sd.to <= 0 || sd.wantTO) return;
    MT().act(M, me, { type: 'timeout' });
    A.toast('Timeout: at the next dead ball.');
    drawBar();
  }
  function toggleAuto() {
    const sd = M.sides[me];
    MT().act(M, me, { type: 'auto', on: !sd.auto });
    A.toast(sd.auto ? 'Your assistant makes the substitutions again.' : 'You make the substitutions now (only a man who fouls out is changed for you).');
    dirty.men = dirty.tab = true; drawBar();
  }
  function simToEnd() {
    if (done) return;
    if (live && !root.confirm('Play the rest of the game now? Your assistant takes the decisions from here.')) return;
    try {
      if (live) { MT().act(M, me, { type: 'auto', on: true }); MT().finish(M); }
      overlay(null); brk = null;
      vt = endOf();
      reveal(true);
      final();
    } catch (e) { fail(e); }
  }

  /* ---- play, pause, speed ---- */
  function play() { if (done) return; paused = false; lastFrame = 0; overlay(null); drawSpeed(); }
  function pause() { paused = true; drawSpeed(); if (live) A.keepLive(true); }
  function togglePause() { if (done) return; if (paused) { if (brk && !brk.until) endBreak(); play(); } else pause(); }
  function setSpeed(x) { speed = x; A.store('mgr_speed', String(x)); if (paused && !done && !brk) play(); drawSpeed(); }
  function fail(e) {
    paused = true; drawSpeed();
    if (root.console) console.error(e);
    overlay(h('div.in', h('h2', 'The game stopped'), h('p.mg-sub', String(e && e.message || e)),
      live ? h('div.go', h('button.mg-btn.primary', { type: 'button', onclick: async () => { try { await A.finishLive(); A.go('/game/' + r); } catch (e2) { A.toast('It could not be finished just now: ' + (e2 && e2.message || e2), true); } } }, 'Let the assistant finish it')) : null));
  }

  /* ---- coming and going ---- */
  const onKey = ev => {
    if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
    if (doc.querySelector('.mg-pop')) return;
    if (ev.key === ' ') { ev.preventDefault(); togglePause(); }
    else if (ev.key === '+' || ev.key === '=') { const i = SPEEDS.indexOf(speed); if (i < SPEEDS.length - 1) setSpeed(SPEEDS[i + 1]); }
    else if (ev.key === '-') { const i = SPEEDS.indexOf(speed); if (i > 0) setSpeed(SPEEDS[i - 1]); }
  };
  const onVis = () => { if (doc.hidden) { if (!paused && !done) pause(); else if (live && !done) A.keepLive(true); } };
  const onHash = () => cleanup();
  let gone = false;
  function cleanup() {
    if (gone) return;
    gone = true;
    if (raf) root.cancelAnimationFrame(raf);
    doc.body.classList.remove('mg-full');
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('visibilitychange', onVis);
    root.removeEventListener('hashchange', onHash);
    root.removeEventListener('pointerup', onUp); root.removeEventListener('pointercancel', onUp);
    A.ui.close();
    if (live && !done && A.liveGame()) {
      if (pendTac) MT().act(M, me, { type: 'tac', tac: pendTac });
      if (pendIns) MT().act(M, me, { type: 'ins', ins: pendIns });
      A.keepLive(true);
    }
  }
  function leaveScreen() {
    if (live && !done) { pause(); A.toast('Your game is kept where it is: carry on any time today.'); A.go('/'); }
    else A.go(live ? '/' : '/game/' + r);
  }
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('visibilitychange', onVis);
  root.addEventListener('hashchange', onHash);

  /* ---- start: the game as far as it has gone ---- */
  if (live) vt = M.g.t;
  reveal(true);
  const fl0 = floorAt(vt);
  if (evI === 0 || vt === 0) court.jump(fl0);
  else if (tr.poss) court.set(fl0, tr.poss.s, attacksRight(tr.poss.s, vt));
  latest = feed.slice().reverse().find(x => !x.quiet) || null;
  drawSpeed(); drawBoard(); drawBar();
  if (live && M.g.over) final();
  else if (live) {
    const starters = s => h('div', h('div.mg-cap', { style: { marginBottom: '6px' } }, clubName(s)), h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' } },
      fl0[s].map((id, k) => h('span', h('span.mg-pos', A.SLOTS[k]), ' ', A.nm(A.nameOf(id))))));
    overlay(M.g.k === 0
      ? h('div.in', h('h2', 'Tip-off'), h('p.mg-sub', 'Round ' + r + ' · ' + (f.h === 0 ? 'at home' : 'away') + '. The game is yours to manage: press a man to substitute him or change his instructions, the touchline for the team\'s.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'left', margin: '12px 0' } }, starters(me), starters(op)),
        h('div.go', h('button.mg-btn.mg-pop-keep', { type: 'button', onclick: ev => openTeam(ev.currentTarget) }, 'Team instructions'), h('button.mg-btn.primary.big', { type: 'button', onclick: () => { overlay(null); play(); } }, '▶ Tip off')))
      : h('div.in', h('h2', 'Your game'), h('div.sc', tr.score[0] + ' – ' + tr.score[1]), h('p.mg-sub', stampOf(vt, G, Tot) + ' · as you left it'),
        h('div.go', h('button.mg-btn.primary.big', { type: 'button', onclick: () => { overlay(null); play(); } }, '▶ Carry on'))));
  } else {
    overlay(h('div.in', h('h2', 'Replay'), h('p.mg-sub', 'Round ' + r + ': the game again, at any speed.'), h('div.go', h('button.mg-btn.primary.big', { type: 'button', onclick: () => { overlay(null); play(); } }, '▶ Play'))));
  }
  raf = root.requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ MATCH DAY: before the game --- */
function prematch(host, md) {
  const f = md.f, home = f.h === 0, opp = home ? f.a : f.h;
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 56), h('div.who', h('h1', 'Match day'), h('div.meta', h('span', 'Round ' + f.r), h('span', home ? 'At home' : 'Away'), h('span', 'Play it any time today')))));
  const meter = h('div.mg-meter', h('i', { style: { width: '50%' } })), chance = h('b', '…');
  const go = h('div.go');
  const p = h('div.mg-panel.glow.mg-pre',
    h('div.mg-next', h('div.side', A.crest(f.h, 72), f.h === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.h)), h('div.vs', h('span.mg-cap', 'Today'), h('span.big', 'v')),
      h('div.side', A.crest(f.a, 72), f.a === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.a))),
    meter, h('p.mg-sub', { style: { textAlign: 'center', margin: '8px 0 0' } }, 'Your chance, simulated with your lineups, tactics and instructions: ', chance), go);
  go.appendChild(h('button.mg-btn.primary.big', { type: 'button', onclick: () => start('live') }, '▶ Play it live'));
  go.appendChild(h('button.mg-btn.big', { type: 'button', onclick: () => start('quick') }, '⏩ Straight to the result'));
  go.appendChild(h('a.mg-btn.big.ghost', { href: '#/tactics' }, 'Tactics'));
  p.appendChild(h('p.mg-sub', { style: { textAlign: 'center', margin: '12px 0 0' } }, 'Live, you make the substitutions, the team’s instructions and each man’s as it happens, and can stop and come back to it today. If you have not played it by midnight, your assistant plays it for you.'));
  host.appendChild(p);
  /* the two fives */
  try {
    const mine = A.lineups()[0], T = A.teamObj(opp, null), theirs = T.segs[0];
    const five = (ids, title, mineToo) => h('div', h('div.mg-cap', { style: { marginBottom: '8px' } }, title), h('ol', ids.map((id, k) => h('li', h('span.mg-pos', A.SLOTS[k]), A.nm(A.nameOf(id), 'span.nm'),
      h('span.m', mineToo ? ((A.ui.brief((A.club.roster || []).find(e => String(e.id) === String(id)), id).role) || '') : '')))));
    host.appendChild(h('div.mg-panel.mg-pre', { style: { marginTop: '16px' } }, h('div.fives', five(mine.ids, 'Your starting five', true), five(theirs.ids, 'Their starting five (their real starters)', false))));
  } catch (_) { /* the fives are a nicety */ }
  setTimeout(() => {
    try {
      const pv = Mgr.engine.preview(A.teamObj(0, null), A.teamObj(opp, null), Object.assign({}, A.X(), { home: home ? 1 : -1, seed: 17 }), 300);
      chance.textContent = Math.round(100 * pv.pWin) + '% (' + (pv.margin >= 0 ? '+' : '') + A.fmt(pv.margin) + ')';
      meter.firstChild.style.width = Math.round(100 * pv.pWin) + '%';
    } catch (_) { chance.textContent = '–'; }
  }, 60);
  async function start(mode) {
    go.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const out = await A.startMatch(mode);
      if (out === 'live') A.go('/match');
      else if (out === 'done') A.go('/game/' + f.r);
      else A.route_();
    } catch (e) { A.toast('The game could not be started: ' + (e && e.message || e), true); A.route_(); }
  }
}

/* ------------------------------------------------------------------ the club's home: match day, a game on --- */
A.livePanel = host => {
  const lv = A.liveGame(), md = A.matchday();
  if (!lv && !md) return null;
  const S = A.club.state, r = lv ? lv.r : md.r, f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  if (!f) return null;
  const opp = f.h === 0 ? f.a : f.h;
  let p;
  if (lv) {
    const snap = A.liveSnap ? A.liveSnap() : null, g = snap ? snap.g : null;
    const G = Math.round((A.lg.sim.T || 2400) / 60), Tot = A.lg.sim.Tot || 300;
    const where = g ? (g.over ? 'Full time' : stampOf(g.t, G, Tot)) : 'Tip-off to come';
    p = h('div.mg-panel.glow.mg-md',
      h('div.mg-row.between', h('span.mg-chip.live', h('span.mg-live-dot'), ' YOUR GAME IS ON'), h('span.mg-sub', 'Round ' + r)),
      h('div.mg-next', { style: { marginTop: '8px' } }, h('div.side', A.crest(f.h, 56), f.h === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.h)),
        h('div.vs', h('span.mg-cap', where), h('span.big', g ? g.score[0] + ' – ' + g.score[1] : 'v')), h('div.side', A.crest(f.a, 56), f.a === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.a))),
      h('div.go', h('a.mg-btn.primary.big', { href: '#/match' }, '▶ Carry on'),
        h('button.mg-btn', { type: 'button', onclick: async ev => { ev.currentTarget.disabled = true; try { await A.finishLive(); A.go('/game/' + r); } catch (e) { A.toast('It could not be finished just now: ' + (e && e.message || e), true); } } }, 'Let your assistant finish it')),
      h('p.mg-sub.note', 'It waits for you where you left it. If it is still going at midnight, your assistant plays it out.'));
  } else {
    const meter = h('div.mg-meter', h('i', { style: { width: '50%' } })), chance = h('b', '…');
    p = h('div.mg-panel.glow.mg-md',
      h('div.mg-row.between', h('span.mg-chip.royal', '★ MATCH DAY'), h('span.mg-sub', 'Round ' + r + ' · ' + (f.h === 0 ? 'at home' : 'away'))),
      h('div.mg-next', { style: { marginTop: '8px' } }, h('div.side', A.crest(f.h, 64), f.h === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.h)), h('div.vs', h('span.mg-cap', 'Today'), h('span.big', 'v')),
        h('div.side', A.crest(f.a, 64), f.a === 0 ? A.nm(A.club.name, 'b') : A.clubLink(f.a))),
      meter, h('p.mg-sub', { style: { textAlign: 'center', margin: '8px 0 0' } }, 'Your chance, simulated: ', chance),
      h('div.go', h('a.mg-btn.primary.big', { href: '#/match' }, '▶ Play it live'), h('button.mg-btn.big', { type: 'button', onclick: async ev => {
        ev.currentTarget.disabled = true;
        try { const out = await A.startMatch('quick'); if (out === 'done') A.go('/game/' + r); else A.route_(); } catch (e) { A.toast('The game could not be played: ' + (e && e.message || e), true); A.route_(); }
      } }, '⏩ Straight to the result'), h('a.mg-btn.big.ghost', { href: '#/tactics' }, 'Tactics')),
      h('p.mg-sub.note', 'Play it whenever you like today. If you have not by midnight, your assistant plays it for you.'));
    setTimeout(() => {
      try {
        const pv = Mgr.engine.preview(A.teamObj(0, null), A.teamObj(opp, null), Object.assign({}, A.X(), { home: f.h === 0 ? 1 : -1, seed: 17 }), 300);
        chance.textContent = Math.round(100 * pv.pWin) + '% (' + (pv.margin >= 0 ? '+' : '') + A.fmt(pv.margin) + ')';
        meter.firstChild.style.width = Math.round(100 * pv.pWin) + '%';
      } catch (_) { chance.textContent = '–'; }
    }, 60);
  }
  host.appendChild(p);
  return p;
};

/* ------------------------------------------------------------------ the routes --- */
/* #/match: the game in hand, else today's game to start, else when the next one is */
function renderMatch(host) {
  if (A.liveGame()) return screen(host, { mode: 'live' });
  const md = A.matchday();
  if (md) return prematch(host, md);
  const S = A.club.state, nx = S ? SE().next(S, 0) : null;
  host.appendChild(h('div.mg-panel', h('h2', 'No game today'), h('p.mg-sub', nx ? 'Your next game is round ' + nx.r + ', on ' + SE().dayStart(nx.d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ': play it any time that day.' : 'Your season’s games are all played.'),
    h('a.mg-btn', { href: '#/' }, '← Back to the club')));
}
/* #/live/<round>: a game played, again (the game in hand is the match screen's) */
function renderReplay(host, args) {
  const S = A.club.state, r = +args[0], lv = A.liveGame();
  if (lv && lv.r === r) { A.go('/match'); return; }
  const f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  if (!f || !f.res || !S.pbp || !S.pbp[r]) { host.appendChild(h('div.mg-panel', h('p', 'This game has not been played yet.'), h('a.mg-btn', { href: '#/fixtures' }, 'Fixtures'))); return; }
  screen(host, { mode: 'replay', r });
}

A.views.match = { render: renderMatch };
A.views.live = { render: renderReplay };
A.match = { clockAt, stampOf, say, tracker, ratingOf };
})(typeof globalThis !== 'undefined' ? globalThis : self);
