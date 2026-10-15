'use strict';
/* ============================================================================
   MANAGER - THE PLAYS ON THE LIVE COURT (core: no site, no DOM).                                window.Mgr.plays

   Louie, 2026-10-15: "Can it be that watching the game, it gives a good visual representation of how the team would play
   in real life with the set roles (use research to see how teams would play and player archetypes and try to represent
   that in a 2D visual engine during games)", and "Use real life plays from playbooks to use in your visual engine (and
   assign them properly according to the player roles, position and what the playing engine needs in terms of usage,
   shots etc.)".

   The engine (core/match.js) has already played each possession: who ended it and how - the shot's zone, the pass that
   made it, a break, an offensive board, a turnover, a trip to the line. This draws it the way a coach would have drawn it:
     1. THE KIND OF PLAY behind that finish, from the finisher's role (core/roles.js: its play-type diet and each kind's
        measured shot mix and assisted share - a rim runner's dunk is a roll, a movement shooter's three comes off
        screens, a post scorer's hook off an entry; a turnover by each kind's turnover rate, a trip by its foul rate);
     2. A SET FROM THE PLAYBOOK (BOOK) with a finish of that kind, in that zone, made by that pass: each set is cast from
        the five on the floor (a ball handler, the screener, a hub big, the shooters), weighed by how often a FIBA side
        runs it, how well the men suit its places and the clock (the drag and Pistol early, an isolation late);
     3. ITS FRAMES, from where the men are: the inbound or the outlet, the advance into the five's alignment (their roles'
        homes: 5-out, 4-out 1-in, 3-out 2-in - core/roles.js layout), the set's own alignment, its screens, cuts, passes
        and handoffs, the shot from the engine's own spot, the board, the free throws (a dead ball: the clock stops).
     The defence each moment: on the ball a yard off, between him and the basket; one pass away up the line; two passes
     away the help "i" (the top man at the nail, the low man on the weak-side block); the help sinking on a drive; the
     screener's man dropping, the low man tagging the roller, a trap and the nail man taking the short roll.
   Feet on a FIBA court, the attacking half: u across (+ to the offence's right as it faces its basket), v up from its
   end line; the basket 5.17 ft in (1.575 m), the free-throw line at 19.03, the three-point arc 22.15 ft from the basket
   (21.65 in the corners). The match screen (views/match.js) turns them into its court.
     plan(o)          the possession's frames, its dead-ball stops and its play calls (o below)
     at(plan, t, hp)  the moment: the five attacking (exact), where each defender wants to be, the ball (hp: the progress
                      of a dead-ball stop at t, 0..1)
   Sources (the research behind the sets, the alignments, the help and the weights) are in docs/manager-mode.md.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.plays = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
const RO = () => root.Mgr.roles;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, x) => [a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * x];
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const copy = ps => ps.map(p => p.slice());
const FIVE = [0, 1, 2, 3, 4];
function hashOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pickW(R, list, w) {
  let tot = 0;
  list.forEach((x, i) => { tot += Math.max(0, w(x, i)); });
  if (!(tot > 0)) return list[0];
  let r = R() * tot;
  for (let i = 0; i < list.length; i++) { r -= Math.max(0, w(list[i], i)); if (r < 0) return list[i]; }
  return list[list.length - 1];
}

/* ------------------------------------------------------------------ the court (FIBA, feet) --- */
const COURT = { L: 91.86, W: 49.21, basket: 5.17, board: 3.94, boardW: 5.91, lane: 8.04, ft: 19.03, ftR: 5.91, arc: 22.15, corner: 21.65, ra: 4.1, centre: 5.91, rim: 0.75 };
const RIM = [0, COURT.basket];
/* where the men stand: the top, the slots, the wings, the corners outside; the elbows, the nail, the blocks, the dunker
   spots, the short corners inside; under the basket */
const SPOT = { top: [0, 29.6], slot: [9.8, 27.6], wing: [19.7, 19.5], corner: [23, 3.4], elbow: [8.4, 19.2], nail: [0, 19.4], block: [9.3, 7.9],
  dunker: [10.4, 3.1], 'short corner': [15.7, 4], rim: [0, 6.4] };
const INSIDE = new Set(['elbow', 'block', 'dunker', 'nail', 'rim', 'short corner']);
/* a spot by name: 'R wing' on the play's right (dir +1 the offence's right; -1 mirrored), 'L wing' its left; 'left wing'
   and 'right wing' (core/roles.js layout) as they are; 'top', 'nail', 'rim' in the middle */
function spot(name, dir) {
  let m = /^([RL]) (.+)$/.exec(name);
  if (m) { const p = SPOT[m[2]] || SPOT.wing, s = (m[1] === 'R' ? 1 : -1) * (dir || 1); return [p[0] * s, p[1]]; }
  m = /^(left|right) (.+)$/.exec(name);
  if (m) { const p = SPOT[m[2]] || SPOT.wing; return [m[1] === 'left' ? -p[0] : p[0], p[1]]; }
  return (SPOT[name] || SPOT.top).slice();
}
const kindOfSpot = name => String(name).replace(/^([RL]|left|right) /, '');
/* THE ENGINE'S SHOT SPOT: a zone (rim, mid-range, three) and two draws -> feet. At the rim within 4.5 ft of the basket;
   a mid-range shot 9-20 ft out, inside the arc; a three in a corner (beyond 21.65 ft, under 10 ft up) or above the break.
   A three nobody passed him is a pull-up, and pull-ups go up above the break: a corner three is a catch-and-shoot nineteen
   times in twenty (Louie, 2026-10-16: "dribble to the corner where a teammate was and attempt a three") - so unassisted
   (ast === false) the corners take 5% of them, not 32% */
function shotSpot(z, a, b, ast) {
  if (z === 0) { const ang = (a - 0.5) * 2.2, r = 1.4 + 3 * b; return [r * Math.sin(ang), COURT.basket + r * Math.cos(ang)]; }
  if (z === 1) { const ang = (a - 0.5) * 2.5, r = 9 + 11 * b; return [r * Math.sin(ang), COURT.basket + r * Math.cos(ang)]; }
  const cw = ast === false ? 0.025 : 0.16;
  if (a < cw || a > 1 - cw) return [(a < cw ? -1 : 1) * (22.5 + 1.1 * b), 2 + 7.5 * b];
  if (ast === false) a = 0.16 + (a - cw) / (1 - 2 * cw) * 0.68;
  const ang = (a - 0.5) / 0.34 * 0.95, r = 23.4 + 2.6 * b;
  return [r * Math.sin(ang), COURT.basket + r * Math.cos(ang)];
}
const onCourt = p => [clamp(p[0], -24.9, 24.9), clamp(p[1], 0.6, 92.4)];

/* ------------------------------------------------------------------ the kind of play --- */
/* the half-court kinds (a break and a put-back are the engine's own: its tr flag and an offensive board) */
const HALF = ['pnr', 'iso', 'post', 'dho', 'spot', 'offs', 'cut', 'roll', 'pop', 'short'];
const STYLED = new Set(['pnr', 'iso', 'dho', 'short']);
const RIP_SPOT = [0.40, 0.16, 0.44];
/* a kind's shots for this role: its measured mix, bent by the role's shooting style for the on-ball kinds (as roles.js
   profile does) - a slasher's pick-and-roll ends at the rim, a pull-up shooter's in a three */
function mixOf(role, k) {
  const p = RO().PT[k];
  let m = (k === 'spot' && role && role.rip ? RIP_SPOT : p.mix).slice();
  if (role && role.st && STYLED.has(k)) { m = [m[0] * role.st.rim, m[1] * role.st.mid, m[2] * role.st.three]; const t = m[0] + m[1] + m[2]; m = m.map(v => v / t); }
  return m;
}
/* THE KIND behind a finish: his diet's share of each kind x how often that kind ends in this zone x how often its make is
   assisted (or not); a turnover by each kind's turnover rate, a trip to the line by its foul rate */
function kindOf(R, role, c) {
  const PT = RO().PT, d = role ? role.diet : { spot: 0.35, pnr: 0.25, cut: 0.2, iso: 0.1, offs: 0.1 };
  const w = HALF.map(k => {
    const x = d[k] || 0;
    if (!x) return 0;
    if (c.end === 'T') return x * PT[k].tov;
    if (c.end === 'F') return x * PT[k].ft * (0.4 + mixOf(role, k)[0]);
    const un = k === 'spot' && role && role.rip && c.z !== 2 ? 0.6 : PT[k].un;
    return x * mixOf(role, k)[c.z] * (c.assisted == null ? 1 : c.assisted ? 1 - un : un);
  });
  if (!(w.reduce((a, v) => a + v, 0) > 1e-9)) return c.assisted ? (c.z === 0 ? 'cut' : 'spot') : 'iso';
  return pickW(R, HALF, (_, i) => w[i]);
}

/* ------------------------------------------------------------------ the people --- */
/* the five by place (0 PG .. 4 C) with their roles: who handles, who screens, who passes from the elbow, who posts, who
   shoots off the catch, who runs - and how well each suits a set's place (0..1) */
function people(roles) {
  const R = k => roles[k] || {}, D = k => R(k).diet || {};
  const big = k => k >= 3 || R(k).family === 'b';
  const initW = k => (R(k).init || 0) + (k === 0 ? 0.04 : 0);
  const screenW = k => (R(k).screen || 0) + (k >= 3 ? 0.6 : 0) + (k === 4 ? 0.3 : 0) + 1.5 * ((D(k).roll || 0) + (D(k).pop || 0) + (D(k).short || 0));
  const hub = k => (R(k).hub || 0) > 0 || (D(k).dho || 0) >= 0.08 || (D(k).short || 0) >= 0.15;
  const post = k => (D(k).post || 0) >= 0.15;
  const cs = k => (D(k).spot || 0) + (D(k).offs || 0) + (D(k).pop || 0);
  const pops = k => (D(k).pop || 0) > (D(k).roll || 0);
  const score = (type, k) => {
    switch (type) {
      case 'bh': return 4 * initW(k) + 0.3 * (R(k).pass || 0) - (big(k) ? 0.6 : 0);
      case 'bh2': return 3 * initW(k) + (k <= 2 ? 0.4 : 0) - (big(k) ? 0.6 : 0);
      case 'g': return (k <= 1 ? 1 : k === 2 ? 0.5 : 0) + initW(k) + 0.5 * cs(k);
      case 'wing': return (k <= 2 ? 1 : k === 3 ? 0.5 : 0) + 0.5 * cs(k) + initW(k);
      case 'iso': return 3 * (D(k).iso || 0) + initW(k) - (big(k) ? 0.3 : 0);
      case 'hub': return (big(k) ? 1 : 0) + (hub(k) ? 1.2 : 0) + 0.3 * (R(k).pass || 0);
      case 'post': return (big(k) ? 1 : 0) + 3 * (D(k).post || 0);
      case 'big': case 'big2': return (big(k) ? 1 : 0) + screenW(k);
      case 'run': return (big(k) ? 1 : 0) + (R(k).run || 0) + 2 * (D(k).tr || 0) + (D(k).roll || 0) + (D(k).put || 0);
      case 'shoot': return cs(k) + (k <= 2 ? 0.25 : 0);
      default: return -0.01 * k;
    }
  };
  const suit = (type, k) => {
    switch (type) {
      case 'bh': return clamp(initW(k) / 0.3, 0.15, 1);
      case 'bh2': return clamp(initW(k) / 0.2, 0.25, 1);
      case 'g': return k <= 1 ? 1 : k === 2 ? 0.75 : 0.35;
      case 'wing': return k <= 2 ? 1 : k === 3 ? 0.65 : 0.3;
      case 'iso': return clamp((D(k).iso || 0) / 0.14, 0.3, 1);
      case 'hub': return big(k) ? (hub(k) ? 1 : 0.65) : 0.35;
      case 'post': return post(k) ? 1 : big(k) ? 0.5 : 0.2;
      case 'big': case 'big2': case 'run': return big(k) ? 1 : k === 2 ? 0.4 : 0.15;
      default: return 1;
    }
  };
  const best = (f, not) => FIVE.filter(k => !(not || []).includes(k)).sort((a, b) => (f(b) - f(a)) || (a - b))[0];
  return { big, initW, screenW, hub, post, cs, pops, score, suit, best };
}

/* ------------------------------------------------------------------ the playbook --- */
/* A SET: its name; base, how often a FIBA/European side runs it (the research's weights, fitted to the published
   play-type and ball-screen shares); early (the drag and Pistol: the first seconds of a possession) and late (a boost
   when the shot clock runs down); act, the side its main action is drawn on; its places (bh a ball handler, bh2 a second
   one, g a guard, iso a one-on-one scorer, hub a big who passes and hands off, post a post scorer, big and big2 the
   screeners, run a rim runner, shoot a shooter, any) and where each lines up (drawn with the main action on the R side);
   run, its phases (steps); fin, its finishes: [place, the kinds of play it is for the finisher, the zones (0 rim, 1 mid,
   2 three), the passer's place ('-' his own shot), flags (k: the passer touches the paint first, l: a lob, d: a handoff,
   C/W/T: a three from the corner / above the break / the top), weight]. A step: {w (its share of the time), mv: {man:
   point}, hold (who has the ball), pass: [from, to], lob, dho, scr: [screener, point], hint (the defence: drop, tag,
   trap, nail, help), call: [the men in it] (the set's name is shown as it starts)}. */
const step = (w, o) => Object.assign({ w }, o);
const BOOK = [];
const SET = (id, o) => { o.id = id; BOOK.push(o); return o; };
/* a screen on the ball at the top for a handler going the play's way */
const ballScreen = d => [d * 2.2, 28.6];

SET('spread', { name: 'High pick-and-roll', base: 15,
  places: { h: 'bh', s: 'big', c: 'shoot', w: 'shoot', d: 'big2' },
  align: { h: 'top', s: 'nail', c: 'R corner', w: 'L wing', d: 'L dunker' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s] }),
    step(0.8, { mv: { [m.s]: ballScreen(d) }, hold: m.h, scr: [m.s, ballScreen(d)], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(1.2, { mv: { [m.h]: [d * 8.5, 21], [m.s]: [d * 2.2, 11.5], [m.w]: c.X === m.w ? null : sp('L corner') }, hold: m.h, hint: { pnr: [m.h, m.s], ph: 1, tag: [m.d, m.s] } })],
  fin: [['h', 'pnr', '012', '-'], ['s', 'roll', '01', 'h'], ['d', 'cut roll', '0', 'h', 'k'], ['w', 'spot', '2', 'h', 'kW'], ['c', 'spot', '2', 'h', 'kC']] });

SET('side', { name: 'Side pick-and-roll (ram)', base: 12, late: 1.5,
  places: { h: 'bh', s: 'big', r: 'g', c: 'shoot', w: 'shoot' },
  align: { h: 'R wing', c: 'R corner', r: 'L slot', s: 'L block', w: 'L corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s] }),
    step(0.8, { mv: { [m.r]: [0, 19.5], [m.s]: [d * 4.5, 16.5] }, hold: m.h, scr: [m.r, [0, 19.5]] }),
    step(0.8, { mv: { [m.s]: [d * 16.2, 23.4], [m.r]: sp('L slot') }, hold: m.h, scr: [m.s, [d * 16.2, 23.4]], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(1.2, { mv: { [m.h]: [d * 8.5, 17.5], [m.s]: [d * 4, 9.5] }, hold: m.h, hint: { pnr: [m.h, m.s], ph: 1, tag: [m.w, m.s] } })],
  fin: [['s', 'roll', '01', 'h'], ['h', 'pnr', '012', '-'], ['c', 'spot', '2', 'h', 'kC'], ['w', 'spot', '2', 'h', 'kC'], ['r', 'spot offs', '2', 'h', 'kW']] });

SET('horns', { name: 'Horns', base: 10,
  places: { h: 'bh', s: 'big', p: 'big2', c: 'shoot', w: 'shoot' },
  align: { h: 'top', p: 'L elbow', s: 'R elbow', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s] }),
    step(0.8, { mv: { [m.s]: ballScreen(d) }, hold: m.h, scr: [m.s, ballScreen(d)], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(1.2, { mv: { [m.h]: [d * 8.5, 21], [m.s]: [d * 2.2, 11.5], [m.p]: sp('L slot') }, hold: m.h, hint: { pnr: [m.h, m.s], ph: 1, tag: [m.w, m.s] } })],
  fin: [['s', 'roll', '01', 'h'], ['p', 'pop spot', '2', 'h', 'W'], ['p', 'pop short spot', '1', 'h'], ['h', 'pnr', '012', '-'], ['w', 'spot', '2', 'h', 'kC'], ['c', 'spot', '2', 'h', 'kC']] });

SET('pop', { name: 'Pick-and-pop', base: 5,
  places: { h: 'bh', s: 'big', d: 'big2', c: 'shoot', w: 'shoot' },
  align: { h: 'top', s: 'L elbow', d: 'R dunker', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s] }),
    step(0.8, { mv: { [m.s]: ballScreen(d) }, hold: m.h, scr: [m.s, ballScreen(d)], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(1.1, { mv: { [m.h]: [d * 8.5, 21], [m.s]: sp('L slot') }, hold: m.h, hint: { pnr: [m.h, m.s], ph: 1 } })],
  fin: [['s', 'pop spot', '2', 'h', 'W'], ['s', 'pop iso', '1', '-'], ['h', 'pnr', '012', '-'], ['d', 'cut roll', '0', 'h', 'k'], ['w', 'spot', '2', 's', 'C'], ['c', 'spot', '2', 'h', 'kC']] });

SET('short', { name: 'Short roll', base: 3.5,
  places: { h: 'bh', s: 'big', d: 'big2', c: 'shoot', w: 'shoot' },
  align: { h: 'top', s: 'nail', d: 'L dunker', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s] }),
    step(0.8, { mv: { [m.s]: ballScreen(d) }, hold: m.h, scr: [m.s, ballScreen(d)], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(0.9, { mv: { [m.h]: [d * 11, 30.5], [m.s]: [d * 0.5, 20] }, hold: m.h, hint: { pnr: [m.h, m.s], ph: 1, short: 1, nail: m.d, tag: [m.w, m.s] } }),
    step(0.6, { pass: [m.h, m.s], hint: { pnr: [m.h, m.s], ph: 2, short: 1, nail: m.d } })],
  fin: [['d', 'cut roll', '0', 's', 'l'], ['w', 'spot', '2', 's', 'C'], ['c', 'spot', '2', 's', 'C'], ['s', 'short roll', '01', '-'], ['s', 'short roll', '01', 'h'], ['h', 'spot', '2', 's', 'W']] });

SET('spain', { name: 'Spain pick-and-roll', base: 3,
  places: { h: 'bh', s: 'big', g: 'shoot', w: 'shoot', c: 'any' },
  align: { h: 'top', s: 'nail', g: 'rim', w: 'L corner', c: 'R corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.s, m.g] }),
    step(0.8, { mv: { [m.s]: ballScreen(d), [m.g]: [-d * 1, 18.5] }, hold: m.h, scr: [m.s, ballScreen(d)], hint: { pnr: [m.h, m.s], ph: 0 } }),
    step(1.1, { mv: { [m.h]: [d * 8.5, 21], [m.s]: [d * 2.2, 11.5], [m.g]: [0, 17.5] }, hold: m.h, scr: [m.g, [0, 17.5]], hint: { pnr: [m.h, m.s], ph: 1, tag: [m.w, m.s] } }),
    step(0.6, { mv: { [m.g]: [0, 28.4] }, hold: m.h })],
  fin: [['s', 'roll', '0', 'h'], ['g', 'offs spot pop', '2', 'h', 'T'], ['h', 'pnr', '012', '-'], ['w', 'spot', '2', 'h', 'kC'], ['c', 'spot', '2', 'h', 'kC']] });

SET('drag', { name: 'Drag screen', base: 6, early: true,
  places: { h: 'bh', t: 'big', r: 'run', c: 'shoot', w: 'shoot' },
  align: { h: 'R slot', c: 'R corner', w: 'L corner', r: 'rim', t: 'top' },
  run: (c, m, sp, d) => {
    const pops = c.X === m.t ? c.z === 2 : c.P.pops(m.t);
    return [step(1.3, { mv: c.al, hold: m.h, call: [m.h, m.t] }),
      step(0.6, { mv: { [m.t]: [d * 7.4, 29.2] }, hold: m.h, scr: [m.t, [d * 7.4, 29.2]], hint: { pnr: [m.h, m.t], ph: 0 } }),
      step(1, { mv: { [m.h]: [0, 20.5], [m.t]: pops ? [-d * 2, 29] : [-d * 1.5, 12], [m.r]: sp('L dunker') }, hold: m.h, hint: { pnr: [m.h, m.t], ph: 1, tag: [m.w, m.t] } })];
  },
  fin: [['h', 'pnr', '012', '-'], ['t', 'roll', '0', 'h'], ['t', 'pop spot', '2', 'h', 'T'], ['w', 'spot', '2', 'h', 'kC'], ['c', 'spot', '2', 'h', 'kC'], ['r', 'cut roll', '0', 'h', 'k']] });

SET('pistol', { name: 'Pistol', base: 4, early: true,
  places: { h: 'bh', b: 'bh2', s: 'big', c: 'shoot', d: 'big2' },
  align: { h: 'R slot', b: 'R wing', s: 'top', c: 'L corner', d: 'L dunker' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1.3, { mv: c.al, hold: m.h, call: [m.h, m.b, m.s] })];
    if (fx[0] === 'b' && fx[1].includes('cut')) return out.concat([step(0.6, { mv: { [m.h]: [d * 15, 25.5] }, hold: m.h })]);   // denied: the backdoor
    out.push(step(0.8, { mv: { [m.h]: [d * 16.6, 23.4], [m.b]: [d * 15.2, 24.6] }, hold: m.h }), step(0.3, { pass: [m.h, m.b], dho: 1 }));
    if (fx[0] === 'b' && fx[3] === 'h') return out;                                                  // the three off the handoff
    out.push(step(0.8, { mv: { [m.s]: [d * 10.5, 26.5], [m.h]: sp('R corner') }, hold: m.b, scr: [m.s, [d * 10.5, 26.5]], hint: { pnr: [m.b, m.s], ph: 0 } }),
      step(1, { mv: { [m.b]: [0, 19.5], [m.s]: [d * 2.2, 11.5] }, hold: m.b, hint: { pnr: [m.b, m.s], ph: 1, tag: [m.c, m.s] } }));
    return out;
  },
  fin: [['b', 'pnr dho', '012', '-'], ['b', 'dho spot offs', '2', 'h', 'dW'], ['b', 'cut', '0', 'h'], ['s', 'roll', '0', 'b'], ['h', 'spot', '2', 'b', 'kC'], ['c', 'spot', '2', 'b', 'kC'], ['d', 'cut roll', '0', 'b', 'k']] });

SET('hornsdho', { name: 'Horns elbow handoff', base: 4, act: 'L',
  places: { g: 'bh', e: 'hub', v: 'big2', c: 'shoot', w: 'shoot' },
  align: { g: 'top', e: 'L elbow', v: 'R elbow', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.g, call: [m.g, m.e] }), step(0.6, { pass: [m.g, m.e] }), step(0.8, { mv: { [m.v]: [d * 2, 8] }, hold: m.e })];
    if (fx[0] === 'v' && fx[3] === 'e') return out;                                                  // high-low on the dive
    out.push(step(0.8, { mv: { [m.v]: sp('R dunker'), [m.g]: [-d * 8.4, 26.6], [m.e]: [-d * 8.6, 24.2] }, hold: m.e }), step(0.3, { pass: [m.e, m.g], dho: 1 }));
    if (fx[0] === 'g' && fx[3] === 'e') return out;                                                  // the three off the handoff
    out.push(step(1, { mv: { [m.g]: [-d * 6, 17], [m.e]: c.X === m.e && c.z === 2 ? sp('L wing') : [-d * 2.5, 10] }, hold: m.g, hint: { pnr: [m.g, m.e], ph: 1, tag: [m.c, m.e] } }));
    return out;
  },
  fin: [['v', 'roll cut', '0', 'e', 'l'], ['g', 'dho pnr', '012', '-'], ['g', 'dho spot offs', '2', 'e', 'dW'], ['e', 'roll', '0', 'g'], ['e', 'pop spot', '2', 'g', 'W'],
    ['v', 'cut roll', '0', 'g', 'k'], ['w', 'spot', '2', 'g', 'kC'], ['c', 'spot', '2', 'g', 'kC']] });

SET('chicago', { name: 'Chicago', base: 4,
  places: { b: 'hub', p: 'bh', x: 'shoot', s: 'big2', c: 'shoot' },
  align: { b: 'top', p: 'L wing', x: 'R block', s: 'R elbow', c: 'L corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.p, call: [m.x, m.b] }), step(0.6, { pass: [m.p, m.b] })];
    if (fx[0] === 'x' && fx[1].includes('cut')) return out.concat([step(0.6, { mv: { [m.x]: [d * 16, 17.5] }, hold: m.b })]);   // top-locked: the backdoor
    out.push(step(0.9, { mv: { [m.x]: [d * 17, 21.5], [m.s]: [d * 10, 10] }, hold: m.b, scr: [m.s, [d * 10, 10]] }),
      step(0.7, { mv: { [m.b]: [d * 8.8, 26.4], [m.x]: [d * 11.6, 27] }, hold: m.b }), step(0.3, { pass: [m.b, m.x], dho: 1 }));
    if (fx[0] === 'x' && fx[3] === 'b') return out;
    out.push(step(1, { mv: { [m.b]: [d * 2.2, 11], [m.s]: sp('R corner'), [m.x]: [d * 4, 19.5] }, hold: m.x, hint: { pnr: [m.x, m.b], ph: 1, tag: [m.c, m.b] } }));
    return out;
  },
  fin: [['x', 'dho offs spot', '2', 'b', 'dW'], ['x', 'dho pnr', '012', '-'], ['x', 'cut', '0', 'b'], ['b', 'roll', '0', 'x'], ['s', 'spot pop', '2', 'x', 'kC'], ['c', 'spot', '2', 'x', 'kC'], ['p', 'spot', '2', 'x', 'kW']] });

SET('delay', { name: 'Delay', base: 2, act: 'L',
  places: { b: 'hub', h: 'bh', x: 'shoot', c: 'shoot', w: 'any' },
  align: { b: 'top', h: 'R wing', x: 'L wing', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.h, call: [m.b, m.x] }), step(0.6, { pass: [m.h, m.b] })];
    if (fx[0] === 'x' && fx[1].includes('cut')) return out.concat([step(0.5, { mv: { [m.x]: [-d * 21, 21.5], [m.w]: c.X === m.w ? null : sp('L wing') }, hold: m.b })]);   // denied: the backdoor
    out.push(step(0.8, { mv: { [m.b]: [-d * 8.6, 26.6], [m.x]: [-d * 12, 26] }, hold: m.b }), step(0.3, { pass: [m.b, m.x], dho: 1 }));
    if (fx[0] === 'x' && fx[3] === 'b') return out;
    out.push(step(1, { mv: { [m.b]: c.X === m.b && c.z === 2 ? [0, 28.5] : [-d * 2.2, 11], [m.w]: c.X === m.w ? null : sp('L wing'), [m.x]: [-d * 6, 18.5] }, hold: m.x, hint: { pnr: [m.x, m.b], ph: 1, tag: [m.c, m.b] } }));
    return out;
  },
  fin: [['x', 'dho spot offs', '2', 'b', 'dW'], ['x', 'dho pnr', '012', '-'], ['x', 'cut', '0', 'b', 'l'], ['b', 'roll', '0', 'x'], ['b', 'pop spot', '2', 'x', 'T'], ['w', 'spot', '2', 'x', 'k'], ['c', 'spot', '2', 'x', 'kC']] });

SET('flare', { name: 'Horns flare', base: 2,
  places: { h: 'g', e: 'hub', s: 'big2', c: 'shoot', w: 'shoot' },
  align: { h: 'top', e: 'L elbow', s: 'R elbow', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.e] }), step(0.6, { pass: [m.h, m.e] }),
    step(0.9, { mv: { [m.s]: [d * 8.5, 26], [m.h]: [d * 17, 22] }, hold: m.e, scr: [m.s, [d * 8.5, 26]] }),
    step(0.5, { mv: { [m.s]: [d * 3, 12] }, hold: m.e })],
  fin: [['h', 'offs spot', '2', 'e', 'W'], ['s', 'roll cut', '0', 'e', 'l'], ['e', 'spot pop', '1', 'h'], ['e', 'iso post pnr', '01', '-'], ['c', 'spot', '2', 'e', 'C'], ['w', 'spot', '2', 'e', 'C']] });

SET('zipper', { name: 'Zipper', base: 3,
  places: { p: 'bh2', x: 'bh', z: 'big', s: 'big2', c: 'shoot' },
  align: { p: 'L wing', x: 'L block', z: 'L elbow', s: 'R elbow', c: 'R corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.p, call: [m.x, m.z] }),
      step(0.9, { mv: { [m.z]: [-d * 8.5, 11], [m.x]: [-d * 1, 28.8] }, hold: m.p, scr: [m.z, [-d * 8.5, 11]] }),
      step(0.6, { pass: [m.p, m.x], mv: { [m.z]: c.X === m.z ? null : sp('L corner') } })];
    if (fx[0] === 'x' && fx[3] === 'p') return out;
    out.push(step(0.8, { mv: { [m.s]: ballScreen(d) }, hold: m.x, scr: [m.s, ballScreen(d)], hint: { pnr: [m.x, m.s], ph: 0 } }),
      step(1.1, { mv: { [m.x]: [d * 8.5, 21], [m.s]: [d * 2.2, 11.5] }, hold: m.x, hint: { pnr: [m.x, m.s], ph: 1, tag: [m.p, m.s] } }));
    return out;
  },
  fin: [['x', 'offs spot dho', '2', 'p', 'T'], ['x', 'pnr', '012', '-'], ['s', 'roll', '0', 'x'], ['c', 'spot', '2', 'x', 'kC'], ['p', 'spot', '2', 'x', 'kW'], ['z', 'spot pop', '2', 'x', 'kC']] });

SET('floppy', { name: 'Floppy', base: 1,
  places: { p: 'bh', x: 'shoot', a: 'big2', b: 'big', e: 'any' },
  align: { p: 'top', x: 'rim', a: 'L block', b: 'R block', e: 'R elbow' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.p, call: [m.x] }),
    step(0.6, { mv: { [m.x]: [d * 6, 8] }, hold: m.p, scr: [m.b, sp('R block')] }),
    step(0.6, { mv: { [m.x]: [d * 13, 15] }, hold: m.p, scr: [m.e, sp('R elbow')] })],
  fin: [['x', 'offs spot', '2', 'p', 'W'], ['x', 'offs spot', '1', 'p'], ['x', 'offs iso pnr', '1', '-'], ['b', 'post', '01', 'x'], ['e', 'spot pop', '2', 'p', 'T'], ['a', 'spot pop', '1', 'p']] });

SET('stagger', { name: 'Stagger screens', base: 2, act: 'L',
  places: { p: 'bh', x: 'shoot', a: 'big', b: 'big2', c: 'shoot' },
  align: { p: 'R slot', x: 'L dunker', a: 'L block', b: 'L elbow', c: 'R corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.p, call: [m.x] }),
    step(0.6, { mv: { [m.x]: [-d * 12.5, 10] }, hold: m.p, scr: [m.a, sp('L block')] }),
    step(0.6, { mv: { [m.x]: [-d * 15, 17] }, hold: m.p, scr: [m.b, sp('L elbow')] })],
  fin: [['x', 'offs spot', '2', 'p', 'W'], ['x', 'offs spot', '1', 'p'], ['x', 'offs iso', '1', '-'], ['a', 'roll cut post', '0', 'p'], ['b', 'pop spot', '2', 'p', 'T']] });

SET('elevator', { name: 'Elevator doors', base: 1,
  places: { p: 'bh', x: 'shoot', a: 'big', b: 'big2', c: 'shoot' },
  align: { p: 'L wing', a: 'L elbow', b: 'R elbow', x: 'rim', c: 'R corner' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.p, call: [m.x] }),
    step(0.8, { mv: { [m.x]: [0, 20.5] }, hold: m.p }),
    step(0.5, { mv: { [m.x]: [0, 25.5], [m.a]: [-1.3, 19.5], [m.b]: [1.3, 19.5] }, hold: m.p, scr: [m.a, [-1.3, 19.5]] })],
  fin: [['x', 'offs spot', '2', 'p', 'T'], ['b', 'roll cut', '0', 'p', 'l']] });

SET('hammer', { name: 'Hammer', base: 1,
  places: { h: 'bh', s: 'big', t: 'any', x: 'shoot', m: 'big2' },
  align: { h: 'R wing', s: 'R slot', t: 'top', x: 'L wing', m: 'L dunker' },
  run: (c, m, sp, d) => [
    step(1, { mv: c.al, hold: m.h, call: [m.h, m.x] }),
    step(0.6, { mv: { [m.s]: [d * 17, 23.5] }, hold: m.h, scr: [m.s, [d * 17, 23.5]] }),
    step(1, { mv: { [m.h]: [d * 9.5, 4.6], [m.s]: sp('R elbow') }, hold: m.h, hint: { help: true } }),
    step(0.6, { mv: { [m.m]: [-d * 15, 6], [m.x]: c.X === m.x ? null : sp('L corner') }, hold: m.h, scr: [m.m, [-d * 15, 6]] })],
  fin: [['x', 'spot', '2', 'h', 'C', 3], ['h', 'pnr iso', '01', '-'], ['s', 'spot pop short', '1', 'h'], ['m', 'cut roll', '0', 'h', 'l'], ['t', 'spot', '2', 'h', 'T']] });

SET('iverson', { name: 'Iverson cut', base: 3,
  places: { p: 'bh2', x: 'bh', w: 'shoot', s: 'big', q: 'big2' },
  align: { p: 'top', x: 'L wing', w: 'R wing', s: 'L elbow', q: 'R elbow' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.p, call: [m.x] }),
      step(1, { mv: { [m.x]: [d * 17.5, 22.5], [m.w]: [d * 3, 7] }, hold: m.p, scr: [m.q, sp('R elbow')] }),
      step(0.6, { pass: [m.p, m.x], mv: { [m.w]: c.X === m.w ? null : sp('L wing'), [m.p]: c.X === m.p ? null : sp('L slot') } })];
    if (fx[0] === 'x' && fx[3] === 'p') return out;
    out.push(step(0.8, { mv: { [m.s]: [d * 16.2, 23.4], [m.q]: [0, 28.5] }, hold: m.x, scr: [m.s, [d * 16.2, 23.4]], hint: { pnr: [m.x, m.s], ph: 0 } }),
      step(1.1, { mv: { [m.x]: [d * 8.5, 18], [m.s]: [d * 4, 9.5] }, hold: m.x, hint: { pnr: [m.x, m.s], ph: 1, tag: [m.w, m.s] } }));
    return out;
  },
  fin: [['x', 'offs spot', '2', 'p', 'W'], ['x', 'pnr', '012', '-'], ['s', 'roll', '0', 'x'], ['q', 'pop spot', '2', 'x', 'T'], ['w', 'spot', '2', 'x', 'kW'], ['p', 'spot', '2', 'x', 'kW']] });

SET('ucla', { name: 'UCLA cut', base: 4,
  places: { x: 'bh', w: 'bh2', s: 'big', a: 'any', c: 'shoot' },
  align: { x: 'R slot', w: 'R wing', s: 'R elbow', a: 'L wing', c: 'L corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.x, call: [m.x, m.s] }), step(0.6, { pass: [m.x, m.w] }),
      step(0.9, { mv: { [m.x]: [d * 4, 11] }, hold: m.w, scr: [m.s, sp('R elbow')] })];
    if (fx[0] === 'x' && fx[1].includes('cut')) return out;
    out.push(step(0.8, { mv: { [m.x]: fx[0] === 'x' && fx[1].includes('post') ? sp('R block') : sp('R corner'), [m.s]: [0, 28.5] }, hold: m.w }));
    if (fx[0] === 'w' || (fx[0] === 's' && fx[1].includes('roll'))) {
      out.push(step(0.8, { mv: { [m.s]: [d * 16.2, 23.4] }, hold: m.w, scr: [m.s, [d * 16.2, 23.4]], hint: { pnr: [m.w, m.s], ph: 0 } }),
        step(1, { mv: { [m.w]: [d * 8.5, 17.5], [m.s]: [d * 4, 9.5] }, hold: m.w, hint: { pnr: [m.w, m.s], ph: 1, tag: [m.c, m.s] } }));
    }
    return out;
  },
  fin: [['x', 'cut', '0', 'w'], ['s', 'pop spot', '12', 'w', 'T'], ['s', 'roll', '0', 'w'], ['w', 'pnr', '012', '-'], ['x', 'post', '01', 'w'], ['x', 'spot', '2', 'w', 'C'], ['a', 'spot', '2', 's', 'W']] });

SET('chin', { name: 'Chin', base: 2, act: 'L',
  places: { x: 'bh', g: 'shoot', w: 'shoot', p: 'any', s: 'hub' },
  align: { x: 'L slot', g: 'R slot', w: 'L wing', p: 'R wing', s: 'L elbow' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.x, call: [m.x, m.s] }), step(0.5, { pass: [m.x, m.g] }), step(0.5, { pass: [m.g, m.p] }),
      step(0.9, { mv: { [m.x]: [-d * 3, 10] }, hold: m.p, scr: [m.s, sp('L elbow')] })];
    if (fx[0] === 'x' && fx[1].includes('cut')) return out;
    out.push(step(0.6, { mv: { [m.x]: sp('R corner') }, hold: m.p }),
      step(0.8, { mv: { [m.s]: [d * 2, 21], [m.g]: [d * 2, 29] }, hold: m.p, scr: [m.s, [d * 2, 21]] }));
    return out;
  },
  fin: [['x', 'cut', '0', 'p'], ['g', 'offs spot', '2', 'p', 'T'], ['s', 'roll cut', '0', 'p', 'l'], ['g', 'iso pnr', '1', '-'], ['x', 'spot', '2', 'p', 'C']] });

SET('flex', { name: 'Flex', base: 1, act: 'L',
  places: { p: 'bh', q: 'bh2', x: 'any', c: 'shoot', s: 'big' },
  align: { p: 'L slot', q: 'R slot', x: 'L corner', c: 'R corner', s: 'L block' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.p, call: [m.x, m.s] }), step(0.6, { pass: [m.p, m.q] }),
      step(0.9, { mv: { [m.x]: [d * 2, 6] }, hold: m.q, scr: [m.s, sp('L block')] })];
    if (fx[0] === 'x') return out;
    out.push(step(0.8, { mv: { [m.p]: [-d * 9, 10], [m.x]: sp('R block') }, hold: m.q, scr: [m.p, [-d * 9, 10]] }),
      step(0.7, { mv: { [m.s]: sp('L elbow'), [m.p]: c.X === m.p ? null : sp('L corner') }, hold: m.q }));
    return out;
  },
  fin: [['x', 'cut', '0', 'q'], ['x', 'post', '01', 'q'], ['s', 'spot pop short', '1', 'q'], ['s', 'pop spot', '2', 'q', 'T'], ['p', 'spot', '2', 's', 'C'], ['c', 'spot', '2', 'q', 'C']] });

SET('split', { name: 'Post split', base: 7,
  places: { s: 'post', w: 'any', g: 'shoot', f: 'any', c: 'shoot' },
  align: { s: 'R block', w: 'R wing', g: 'R slot', f: 'L slot', c: 'L corner' },
  run: (c, m, sp, d, fx) => {
    const out = [step(1, { mv: c.al, hold: m.w, call: [m.s] }), step(0.6, { pass: [m.w, m.s] })];
    if (fx[0] === 's') return out;
    const gc = fx[0] === 'g' && fx[1].includes('cut'), wc = fx[0] === 'w' && fx[1].includes('cut');
    out.push(step(0.9, { mv: { [m.w]: sp('R elbow'), [m.g]: [d * 10, 21] }, hold: m.s, scr: [m.w, sp('R elbow')] }),
      step(0.6, { mv: { [m.g]: gc ? [d * 4, 10] : sp('R wing'), [m.w]: wc ? [d * 3, 10] : [0, 28.5] }, hold: m.s }));
    return out;
  },
  fin: [['s', 'post iso', '01', '-'], ['s', 'post cut roll', '01', 'w'], ['g', 'spot offs', '2', 's', 'W'], ['w', 'cut', '0', 's'], ['g', 'cut', '0', 's'], ['w', 'spot pop', '2', 's', 'T'],
    ['c', 'spot', '2', 's', 'C'], ['f', 'spot', '2', 's', 'W']] });

SET('highlow', { name: 'High-low', base: 3,
  places: { h: 'hub', x: 'post', g: 'bh', c: 'shoot', w: 'shoot' },
  align: { h: 'L elbow', x: 'R block', g: 'top', c: 'R corner', w: 'L corner' },
  run: (c, m, sp, d) => [step(1, { mv: c.al, hold: m.g, call: [m.h, m.x] }), step(0.6, { pass: [m.g, m.h] }), step(0.6, { mv: { [m.x]: [d * 5, 7] }, hold: m.h })],
  fin: [['x', 'post cut roll', '01', 'h', 'l'], ['h', 'spot pop', '1', 'g'], ['h', 'iso post', '01', '-'], ['c', 'spot', '2', 'h', 'C'], ['w', 'spot', '2', 'h', 'C']] });

SET('iso', { name: 'Isolation', base: 6, late: 2,
  places: { x: 'iso', a: 'shoot', b: 'shoot', d: 'big', e: 'big2' },
  align: { x: 'top', a: 'R corner', b: 'L corner', d: 'L dunker', e: 'R dunker' },
  run: (c, m, sp, d) => [step(1.2, { mv: c.al, hold: m.x, call: [m.x] }), step(0.8, { mv: { [m.x]: [d * 1.5, 28.5] }, hold: m.x })],
  fin: [['x', 'iso pnr post', '012', '-'], ['e', 'cut roll', '0', 'x', 'k'], ['a', 'spot', '2', 'x', 'kC'], ['b', 'spot', '2', 'x', 'kC']] });

SET('clear', { name: 'Clear-out', base: 3, late: 2,
  places: { x: 'iso', p: 'bh2', a: 'shoot', d: 'big', e: 'big2' },
  align: { x: 'R wing', p: 'L slot', a: 'L corner', d: 'L dunker', e: 'L elbow' },
  run: (c, m, sp, d) => [step(1.2, { mv: c.al, hold: m.p, call: [m.x] }), step(0.6, { pass: [m.p, m.x] }), step(0.8, { mv: { [m.x]: [d * 18.4, 21.6] }, hold: m.x })],
  fin: [['x', 'iso pnr post', '012', '-'], ['p', 'spot', '2', 'x', 'kW'], ['a', 'spot', '2', 'x', 'kC'], ['e', 'cut roll', '01', 'x', 'k']] });

SET('swing', { name: 'Swing and attack the closeout', base: 5, act: 'L',
  places: { h: 'bh', t: 'any', x: 'wing', c: 'shoot', d: 'big' },
  align: { h: 'R wing', t: 'top', x: 'L wing', c: 'R corner', d: 'L dunker' },
  run: (c, m, sp, d) => [step(1, { mv: c.al, hold: m.h, call: [m.x] }),
    step(0.8, { mv: { [m.h]: [d * 8, 16] }, hold: m.h, hint: { help: true } }),
    step(0.5, { pass: [m.h, m.t], mv: { [m.h]: sp('R wing') } }), step(0.5, { pass: [m.t, m.x] })],
  fin: [['x', 'spot iso dho', '01', '-'], ['x', 'spot', '2', 't', 'W'], ['d', 'cut roll', '0', 'x', 'k'], ['t', 'spot', '2', 'x', 'kT'], ['c', 'spot', '2', 'x', 'kC'], ['h', 'spot', '2', 'x', 'kW']] });

/* ------------------------------------------------------------------ choosing the set --- */
function fits(fx, c, anyKind) {
  if (!anyKind && !fx[1].split(' ').includes(c.kind)) return false;
  if (c.z != null && !fx[2].includes(String(c.z))) return false;
  if (c.assisted === true && fx[3] === '-') return false;
  if (c.assisted === false && fx[3] !== '-') return false;
  const fl = fx[4] || '';
  if (c.z === 2 && c.F) {
    const corner = c.F[1] < 10.5 && Math.abs(c.F[0]) > 19;
    if (fl.includes('C') && !corner) return false;
    if ((fl.includes('W') || fl.includes('T')) && corner) return false;
    if (fl.includes('T') && Math.abs(c.F[0]) > 12) return false;
  }
  return true;
}
const ORDER = ['bh', 'iso', 'bh2', 'hub', 'post', 'big', 'run', 'big2', 'g', 'wing', 'shoot', 'any'];
/* the five into the set's places: the finisher and his passer where the finish puts them, the rest each to the place
   that suits him best, the ball handlers first and the bigs next */
function cast(set, c, fx) {
  const m = {}, used = new Set();
  m[fx[0]] = c.X; used.add(c.X);
  if (fx[3] !== '-' && c.A != null) { if (used.has(c.A)) return null; m[fx[3]] = c.A; used.add(c.A); }
  const pls = Object.keys(set.places).filter(p => m[p] == null).sort((a, b) => ORDER.indexOf(set.places[a]) - ORDER.indexOf(set.places[b]));
  for (const pl of pls) {
    let best = null, bs = -Infinity;
    FIVE.forEach(k => { if (used.has(k)) return; const s = c.P.score(set.places[pl], k); if (s > bs) { bs = s; best = k; } });
    if (best == null) return null;
    m[pl] = best; used.add(best);
  }
  return m;
}
const fitOf = (set, m, c) => Object.keys(set.places).reduce((f, pl) => { const t = set.places[pl]; return t === 'any' || t === 'shoot' ? f : f * (0.2 + 0.8 * c.P.suit(t, m[pl])); }, 1);
/* THE SET SUITS THE ROLES (Louie, 2026-10-16: "Plays that more correspond with their role (i.e. for secondary ball handlers
   more side PNR or spot up or off-screen plays, for combos and PGs more middle PNR etc.)"): the man with the ball in the
   set's action - a point guard or a combo guard runs the middle and high ball screens, a secondary handler or a point
   forward the side pick-and-roll; a shooter whose role lives off the ball is run off screens */
const MIDDLE = new Set(['spread', 'horns', 'spain', 'drag', 'pistol', 'short', 'pop']);
const OFFSCREEN = new Set(['zipper', 'floppy', 'stagger', 'elevator', 'chicago', 'flare', 'iverson', 'hammer']);
function roleW(set, m, c) {
  let w = 1;
  const k = m.h, r = k != null && c.roles ? c.roles[k] : null;
  if (r) {
    const primary = r.slot === 0 || r.cat === 'Combo', second = r.cat === 'Secondary handler' || r.cat === 'Point forward' || r.cat === 'Playmaking forward';
    if (MIDDLE.has(set.id)) w *= primary ? 1.5 : second ? 0.35 : 0.6;
    else if (set.id === 'side') w *= second ? 2.2 : primary ? 0.8 : 1;
  }
  const rx = c.roles ? c.roles[c.X] : null;
  if (rx && OFFSCREEN.has(set.id) && /Off-ball scorer|Secondary handler|3&D|Stretch/.test(rx.cat)) w *= 1.4;
  return w;
}
function choose(R, c) {
  for (const anyKind of [false, true]) {
    const cand = [];
    BOOK.forEach(set => {
      if (set.early && (!c.early || c.reset)) return;
      set.fin.forEach(fx => {
        if (!fits(fx, c, anyKind)) return;
        const m = cast(set, c, fx);
        if (!m) return;
        const w = set.base * (fx[5] || 1) * fitOf(set, m, c) * roleW(set, m, c) * (c.late && set.late ? set.late : 1) * (c.hurry && set.early ? 4 : 1);
        if (w > 0) cand.push({ set, fx, m, w });
      });
    });
    if (cand.length) return pickW(R, cand, x => x.w);
  }
  return null;
}
/* the set's alignment for these men; a man who is not in the action keeps his own kind of spot (his role's home: a post
   big stays inside, a shooter outside), on the same side, so the five's spacing is their roles' */
function alignOf(set, c, m) {
  const mv = {}, taken = [];
  const free = p => !taken.some(q => dist(p, q) < 4);
  Object.keys(set.align).forEach(pl => {
    const k = m[pl];
    if (k == null) return;
    let p = spot(set.align[pl], c.dir);
    const t = set.places[pl];
    if ((t === 'shoot' || t === 'any') && k !== c.X && k !== c.A && c.homes) {
      const hm = c.homes[k], here = kindOfSpot(set.align[pl]);
      if (hm && INSIDE.has(hm) !== INSIDE.has(here) && hm !== 'top') {
        const alt = spot((p[0] < 0 ? 'left ' : 'right ') + hm);
        if (free(alt)) p = alt;
      }
    }
    if (!free(p)) { const q = [-p[0], p[1]]; if (free(q)) p = q; }
    taken.push(p);
    mv[k] = p;
  });
  return mv;
}

/* ------------------------------------------------------------------ a possession --- */
/* o: {evs (the possession's events, its P first, up to the next possession), idx(id) -> 0-4 the offence, 5-9 the defence
   (each defender guarding the man of his own place), roles (the offence's five by place, role objects), from: {pos: the
   ten where they are, hold (0-9 or null), ball (where it is when nobody has it)}, prev: {how: make | dreb | steal | dead |
   start, by (0-9)}: how the ball changed hands, spot(e) -> the shot's spot in feet, seed, dins (the defending five's
   instruction keys by place: their bigs' coverage on the ball screen, gambling, rim protection), dtac (the defending
   team's instructions: scheme, gamble)} */
/* ROOM FOR THE SHOT (Louie, 2026-10-16: "needs to be real to basketball logic"): a teammate standing where the shooter
   is going lifts or drifts to the most open spot outside (a spacer never shares a corner with the man shooting from it).
   Where each man will be at the shot is read from the steps (his last move, else where he is); one within 9 ft of the
   spot moves in the last step, to the perimeter spot furthest from everybody else and the shot */
const ROOM = ['L corner', 'R corner', 'L wing', 'R wing', 'L slot', 'R slot', 'top'];
function makeRoom(steps, X, F, pos) {
  if (!steps.length) return;
  const at = FIVE.map(k => { let p = pos[k]; steps.forEach(s => { if (s.mv && s.mv[k]) p = s.mv[k]; }); return p; });
  at[X] = F;
  const last = steps[steps.length - 1], passer = last.pass ? last.pass[0] : null;
  FIVE.forEach(k => {
    if (k === X || k === passer || !at[k] || Math.hypot(at[k][0] - F[0], at[k][1] - F[1]) >= 9) return;
    const best = ROOM.map(n => spot(n, 1)).filter(q => Math.hypot(q[0] - F[0], q[1] - F[1]) >= 12)
      .map(q => ({ q, d: Math.min(...FIVE.filter(j => j !== k).map(j => Math.hypot(q[0] - at[j][0], q[1] - at[j][1]))) }))
      .sort((a, b) => b.d - a.d)[0];
    if (!best) return;
    last.mv = Object.assign({}, last.mv || {}, { [k]: best.q });
    at[k] = best.q;
  });
}
function plan(o) {
  const evs = o.evs, P0 = evs[0], t0 = P0.t;
  const R = rng(hashOf(String(o.seed) + ':' + t0 + ':' + (P0.s || 0)));
  const roles = o.roles || [], P = people(roles);
  let lay = null;
  try { lay = RO().layout(roles); } catch (e) { lay = null; }
  const homes = lay ? lay.homes : [], home = lay ? lay.spots.map(s => spot(s)) : FIVE.map(k => spot(['top', 'right wing', 'left wing', 'right corner', 'left block'][k]));
  const frames = [], stops = [], calls = [];
  let pos = copy(o.from.pos.slice(0, 5)).map(onCourt), hold = o.from.hold != null ? o.from.hold : null, loose = o.from.ball ? o.from.ball.slice() : [0, 47];
  const ballSpec = () => (hold != null ? { h: hold } : { at: loose.slice() });
  /* every frame after the one before it (a possession squeezed by the clock never runs backwards) */
  const add = f => { const last = frames[frames.length - 1]; if (last && f.t < last.t) f.t = last.t; frames.push(f); return f; };
  const push = (t, extra) => add(Object.assign({ t, pos: copy(pos), ball: ballSpec() }, extra || {}));
  push(t0);
  /* the chances: from the start (or an offensive board) to the shot, the turnover or the trip */
  const chances = [{ t0, ev: [], from: null }];
  for (const e of evs.slice(1)) {
    if (e.k === 'P' || e.k === 'Q' || e.k === 'q') break;
    const ch = chances[chances.length - 1];
    if (e.k === 'O') { ch.reb = e; chances.push({ t0: e.t, ev: [], from: e }); continue; }
    if (e.k === 'D') { ch.reb = e; continue; }
    ch.ev.push(e);
    if (!ch.end && (e.k === 'S' || e.k === 'T' || (e.k === 'F' && e.kind !== 2))) ch.end = e;
    else if (e.k === 'F' && e.kind === 2) ch.and1 = e;
  }
  /* the steps into frames over [ta, tb]: each step its share of the time; a pass or a handoff flies at the end of its
     step; a man asked to have the ball who has not got it is passed it */
  function normalise(steps) {
    const out = [];
    let h = hold;
    steps.forEach(s => {
      if (s.pass && s.pass[0] != null && h != null && h <= 4 && h !== s.pass[0]) { out.push(step(0.5, { pass: [h, s.pass[0]] })); h = s.pass[0]; }
      else if (!s.pass && s.pick == null && s.hold != null && h != null && h <= 4 && h !== s.hold) { out.push(Object.assign({}, s, { pass: [h, s.hold], hold: null })); h = s.hold; return; }
      out.push(s);
      if (s.pass) h = s.pass[1]; else if (s.pick != null) h = s.pick; else if (s.hold != null) h = s.hold;
    });
    return out;
  }
  /* THE TIME EACH STEP TAKES: at least what its busiest man needs at a jog (vAvg feet a second on average; the easing
     peaks half as fast again) and a pass its flight, the rest of the time shared by the steps' weights; a possession too
     short for all of it squeezes every step alike */
  let fin = null;
  function pushSteps(steps0, ta, tb, vAvg) {
    const steps = normalise(steps0);
    const q = copy(pos), v = vAvg || 15;
    const need = steps.map(s => {
      let d = 0;
      Object.keys(s.mv || {}).forEach(k => { const p = s.mv[k]; if (p && +k >= 0 && +k <= 4) { const np = onCourt(p); d = Math.max(d, dist(q[+k], np)); q[+k] = np; } });
      return Math.max(d / v, s.pass ? (s.dho ? 0.25 : 0.45) : 0.12);
    });
    const total = Math.max(0.05, tb - ta), W = steps.reduce((a, s) => a + (s.w || 1), 0) || 1, sumNeed = need.reduce((a, x) => a + x, 0);
    const dts = sumNeed >= total ? need.map(x => total * x / sumNeed) : steps.map((s, i) => need[i] + (total - sumNeed) * (s.w || 1) / W);
    let t = ta;
    steps.forEach((s, i) => {
      const dt = dts[i], t1 = t + dt;
      if (s.call && s.text) calls.push({ t, text: s.text, ks: s.call.filter(k => k != null) });
      /* nobody faster than a man can run: the men in the action (the ball, the pass, the screen, the finisher) at a
         sprint, the others at a hard jog - a spacer short of time gets as far as he can and trails into the next step */
      const key = new Set([s.hold, s.pick, s.pass && s.pass[0], s.pass && s.pass[1], s.scr && s.scr[0], fin].filter(k => k != null));
      const was = copy(pos);
      Object.keys(s.mv || {}).forEach(k => {
        const p = s.mv[k];
        if (!p || +k < 0 || +k > 4) return;
        const np = onCourt(p), d = dist(pos[+k], np), cap = (key.has(+k) ? 26 : 17) * Math.max(dt, 0.05);
        pos[+k] = d > cap && d > 1e-6 ? lerp(pos[+k], np, cap / d) : np;
      });
      /* A DRIVE OR A CUT TO THE RIM IS NOT A STRAIGHT LINE (Louie, 2026-10-16: "a player not just linearly driving straight to
         the rim at an odd angle through defenders"): he attacks a gap - his man's shoulder, middle or baseline - and turns
         the corner to the basket; a man in the corner or low on the wing goes baseline. A waypoint at 45% of the way, set
         4.5 ft off the straight line (where his man stands), the speed carried through it (vel below). Only in a step
         with no pass in it, so the ball's flights keep their timing */
      if (!(s.pass && s.pass[0] !== s.pass[1]) && s.pick == null && dt > 0.35) {
        const mid = copy(pos).map((q, j) => lerp(was[j], q, 0.45));
        let bent = false;
        FIVE.forEach(k => {
          const p0 = was[k], q = pos[k], d = dist(p0, q);
          if (d < 12 || dist(q, RIM) > 9 || p0[1] > 47) return;
          const u = [(q[0] - p0[0]) / d, (q[1] - p0[1]) / d], n = [-u[1], u[0]];
          const h = ((Math.round(t * 1000) * 2654435761 + k * 97) >>> 0) % 1000 / 1000;
          let side;
          if (Math.abs(p0[0]) > 11) { const base = p0[1] < 17 || h < 0.45, wantX = (base ? 1 : -1) * Math.sign(p0[0]); side = Math.sign(n[0]) === wantX || n[0] === 0 ? 1 : -1; }
          else side = h < 0.5 ? 1 : -1;
          const m = lerp(p0, q, 0.45);
          mid[k] = onCourt([m[0] + n[0] * side * 4.5, m[1] + n[1] * side * 4.5]);
          bent = true;
        });
        if (bent) add({ t: t + dt * 0.45, pos: mid, ball: ballSpec(), hint: s.hint || null });
      }
      let b;
      if (s.pass && s.pass[0] !== s.pass[1] && s.pass[0] != null && s.pass[1] != null) {
        b = { fly: { from: s.pass[0], to: s.pass[1], arc: s.lob ? 0.9 : 0.12, dur: Math.max(0.15, Math.min(s.dho ? 0.25 : 0.65, dt * 0.85)) } };
        hold = s.pass[1];
      } else if (s.pick != null) { b = { pick: s.pick, at: s.at.slice() }; hold = s.pick; }
      else { if (s.hold != null && (hold == null || hold > 4)) { b = { pick: s.hold, at: loose.slice() }; hold = s.hold; } else b = ballSpec(); }
      add({ t: t1, pos: copy(pos), ball: b, scr: s.scr ? { k: s.scr[0], at: onCourt(s.scr[1]) } : null, hint: s.hint || null, dset: s.dset || null });
      t = t1;
    });
  }
  /* the ball after a change of hands: the inbound under the basket after a make, the outlet after a board, the steal,
     the throw-in from the side */
  const H0 = P.best(P.initW, []);
  function startSteps(H) {
    const pr = o.prev || {}, by = pr.by;
    if (pr.how === 'make') {
      const IB = P.best(k => P.score('big', k), [H]), at = [-2.6, 92.1];
      return [step(0.8, { mv: { [IB]: at, [H]: [5.5, 84] }, pick: IB, at }), step(0.6, { pass: [IB, H] })];
    }
    if (pr.how === 'dreb' && by != null && by <= 4 && by !== H) {
      const s = Math.sign(pos[by][0]) || 1;
      return [step(0.6, { mv: { [H]: [s * 15, clamp(pos[by][1] - 6, 60, 86)] }, hold: by }), step(0.5, { pass: [by, H] })];
    }
    if (pr.how === 'steal' && by != null && by <= 4 && by !== H) return [step(0.4, { hold: by }), step(0.5, { pass: [by, H] })];
    if (pr.how === 'dead') {
      const IB = P.best(k => (k === 1 || k === 2 ? 1 : 0) + P.cs(k), [H]), s = (loose[0] || 1) >= 0 ? 1 : -1, v = clamp(loose[1], 52, 86), at = [s * 24.75, v];
      return [step(0.8, { mv: { [IB]: at, [H]: [s * 14, v - 5] }, pick: IB, at }), step(0.5, { pass: [IB, H] })];
    }
    return hold == null ? [step(0.4, { mv: { [H]: pos[H] }, pick: H, at: pos[H] })] : [];
  }
  /* a dead ball at the line: the shooter at the line, two of his men on the lane's second places, two behind the arc;
     the defence on the first places, one more on the lane, the shooter's man behind the arc; the clock stopped */
  function ftStop(te, X, n, made, missedLast) {
    const lane = FIVE.filter(k => k !== X).sort((a, b) => (P.score('big', b) - P.score('big', a)) || (a - b));
    const L = {}, ds = {};
    L[X] = [0, 20.1];
    L[lane[0]] = [9.4, 11.6]; L[lane[1]] = [-9.4, 11.6]; L[lane[2]] = [14, 28.5]; L[lane[3]] = [-14, 28.5];
    ds[lane[0]] = [9.4, 7.3]; ds[lane[1]] = [-9.4, 7.3]; ds[lane[2]] = [9.4, 14.6]; ds[lane[3]] = [-12, 26.5]; ds[X] = [3.5, 28.8];
    const from = copy(pos), last = frames[frames.length - 1];
    if (last && te < last.t) te = last.t;
    FIVE.forEach(k => { pos[k] = L[k]; });
    hold = null;
    loose = missedLast ? RIM.slice() : [0, 4.2];
    stops.push({ t: te, d: 0.9 + 0.6 * n, n, made, X, from, lineup: copy(pos), dset: ds });
    add({ t: te, pos: copy(pos), ball: { at: loose.slice() }, dset: ds });
  }
  chances.forEach((ch, ci) => {
    const end = ch.end;
    if (!end) return;
    const te = end.t, X = o.idx(end.p);
    if (!(X >= 0 && X <= 4)) return;
    const Ai = end.a != null ? o.idx(end.a) : -1, A = Ai >= 0 && Ai <= 4 && Ai !== X ? Ai : null;
    const z = end.k === 'S' ? end.z : end.k === 'F' ? 0 : null;
    const F = end.k === 'S' ? onCourt(o.spot(end)) : end.k === 'F' ? [(R() - 0.5) * 7, 6.4 + R() * 3] : [(R() - 0.5) * 24, 17 + R() * 10];
    const tStart = Math.max(ch.t0, frames[frames.length - 1].t), quick = te - ch.t0;
    fin = X;
    /* off a pass or not: a make says (its assist); a missed three from a corner was a catch-and-shoot (a pull-up goes up
       above the break: shotSpot) */
    const assisted = end.k === 'S' && end.m ? A != null : end.k === 'S' && z === 2 && Math.abs(F[0]) > 20 && F[1] < 11 ? true : null;
    const tShot = end.k === 'S' ? te - 0.5 : end.k === 'F' ? te - 0.1 : te;
    const rebK = ch.from ? o.idx(ch.from.p) : -1;
    const putback = ch.from && rebK === X && end.k === 'S' && end.z === 0 && quick <= 4;
    const endGame = end.k === 'F' && end.kind === 3;
    let steps = [], tSet = tStart;
    if (putback) { steps = [step(1, { mv: { [X]: F }, hold: X, text: 'Put-back', call: [X] })]; }
    else if (endGame) {
      /* the foul to stop the clock: on the man who catches the inbound */
      const st = ci === 0 ? startSteps(X) : [];
      steps = st.length ? st : [step(1, { hold: X })];
      steps[0] = Object.assign({}, steps[0], { text: 'Foul to stop the clock', call: [X] });
    } else if (ci > 0 && rebK >= 0 && rebK !== X && quick <= 6 && end.k === 'S') {
      /* the kick-out off the offensive board */
      steps = [step(1, { mv: { [X]: F }, pass: [rebK, X], text: 'Second-chance kick-out', call: [rebK, X] })];
    } else if (end.k === 'S' && end.tr) {
      /* THE BREAK: the outlet, the ball pushed up the middle, the wings wide to the corners, the rim runner to the
         basket, the trailer behind - and the finish: the push, the hit-ahead, the rim run, the trailer three */
      const H = A != null ? A : (P.initW(X) >= 0.18 || X <= 1 ? X : H0 === X ? X : H0);
      const rest = FIVE.filter(k => k !== H);
      const runR = rest.slice().sort((a, b) => P.score('run', b) - P.score('run', a))[0];
      const trail = rest.filter(k => k !== runR).sort((a, b) => P.score('big', b) - P.score('big', a))[0];
      const wings = rest.filter(k => k !== runR && k !== trail);
      const d = Math.abs(F[0]) > 1 ? Math.sign(F[0]) : (R() < 0.5 ? -1 : 1);
      const mv = { [H]: [d * 2.5, 27], [runR]: [-d * 4, 9], [trail]: [-d * 9.8, 33] };
      wings.forEach((k, i) => { mv[k] = spot(i ? 'L corner' : 'R corner', d); });
      if (X !== H) mv[X] = lerp(F, [F[0], F[1] + 8], z === 0 ? 0.6 : 0.2);
      const st = ci === 0 ? startSteps(H) : [];
      steps = st.concat([step(1.4, { mv, hold: H, text: 'Fast break', call: [H] })]);
      steps.push(X === H ? step(0.7, { mv: { [X]: F }, hold: X }) : step(0.7, { mv: { [X]: F }, pass: [H, X], lob: z === 0 && P.big(X) }));
      steps.vAvg = 20;
    } else {
      /* THE HALF COURT: the start, the advance into the five's alignment, the set */
      const role = roles[X];
      const kind = kindOf(R, role, { end: end.k, z: z == null ? 1 : z, assisted });
      const hurry = ci === 0 && quick < 8;
      const c = { R, P, roles, X, A, F, z, kind, assisted, homes, early: quick <= 9 && ci === 0, hurry, late: quick >= 16, reset: ci > 0 };
      const pick = choose(R, c);
      if (pick) {
        const set = pick.set, fx = pick.fx, m = pick.m;
        const xs = set.align[fx[0]] || 'top', side = /^R /.test(xs) ? 1 : /^L /.test(xs) ? -1 : (set.act === 'L' ? -1 : 1);
        c.dir = side * (Math.abs(F[0]) > 1.5 ? Math.sign(F[0]) : (R() < 0.5 ? -1 : 1));
        if (fx[3] !== '-' && c.A == null) c.A = m[fx[3]];
        c.al = alignOf(set, c, m);
        const sp = n => spot(n, c.dir);
        steps = set.run(c, m, sp, c.dir, fx).map(s => (s.call ? Object.assign({}, s, { text: set.name }) : s));
        /* the finish: his own shot, or the pass (after the passer touches the paint, when the finish says so) */
        let h = hold;
        steps.forEach(s => { if (s.pass) h = s.pass[1]; else if (s.hold != null) h = s.hold; });
        const Ap = fx[3] !== '-' ? m[fx[3]] : null, fl = fx[4] || '';
        if (Ap == null || Ap === X) steps.push(step(1, { mv: { [X]: F }, hold: X, hint: z === 0 ? { help: true } : null }));
        else {
          let ap = c.al[Ap] || pos[Ap];
          steps.forEach(s => { if (s.mv && s.mv[Ap]) ap = s.mv[Ap]; });
          if (fl.includes('k')) steps.push(step(0.6, { mv: { [Ap]: [(Math.sign(ap[0]) || c.dir) * 3.5, 12] }, hold: Ap, hint: { help: true } }));
          if (h === X && !fl.includes('k')) steps.push(step(0.6, { mv: { [X]: F }, hold: X }));
          else steps.push(step(0.8, { mv: { [X]: F }, pass: [Ap, X], lob: fl.includes('l') || (z === 0 && P.big(X)), dho: fl.includes('d') ? 1 : 0 }));
        }
        if (ci === 0 && !c.hurry && !(set.early && c.early)) {
          /* the advance: the start, then the five straight into the set's alignment (the spacers in their own roles'
             spots), the ball brought over the top by its handler; the play called as they set up (as FM names a set
             piece when it starts) */
          const first = steps.find(s => s.hold != null || s.pass), H = first ? (first.pass ? first.pass[0] : first.hold) : H0;
          /* THE BALL IS BROUGHT UP BY THE FIVE'S PRIMARY HANDLER, whoever runs the set (Louie, 2026-10-16: a secondary
             handler SF "bringing the ball up every 3rd or so play"): he enters it to the set's man - and with the time for
             it, the ball goes side to side first (a reversal through a man outside), so a possession is not one pass */
          const Hb = H0 != null ? H0 : H;
          const adv = Object.assign({}, c.al);
          adv[Hb] = [(c.al[Hb] ? c.al[Hb][0] : 0) * 0.35, 32];
          steps[0] = Object.assign({}, steps[0], { w: 0.4 });
          const out = k => k != null && k !== Hb && k !== H && k !== X && c.al[k] && dist(c.al[k], RIM) >= 18;
          const R1 = quick >= 12 ? FIVE.filter(out).sort((a, b) => Math.abs(c.al[b][0]) - Math.abs(c.al[a][0]))[0] : undefined;
          const home = c.al[Hb] ? { [Hb]: c.al[Hb] } : null, entry = [];
          if (H != null && H !== Hb) {
            if (R1 != null) entry.push(step(0.8, { pass: [Hb, R1], mv: home }), step(0.8, { pass: [R1, H] }));
            else entry.push(step(0.8, { pass: [Hb, H], mv: home }));
          } else if (R1 != null && R() < 0.7) entry.push(step(0.8, { pass: [Hb, R1] }), step(0.8, { pass: [R1, Hb] }));
          steps = startSteps(Hb).concat([step(2.2, { mv: adv, hold: Hb })], entry, steps);
        } else if (ci === 0) {
          steps = startSteps(m.h != null ? m.h : H0).concat(steps);
        } else if (rebK >= 0 && rebK <= 4) {
          /* a reset off the offensive board: he kicks it out to the man who starts the set */
          const first = steps.find(s => s.hold != null || s.pass);
          const H = first ? (first.pass ? first.pass[0] : first.hold) : H0;
          if (H !== rebK && H != null) steps.unshift(step(0.6, { pass: [rebK, H] }));
        }
      } else steps = [step(1, { mv: { [X]: F }, hold: X })];
      /* a possession squeezed by the buzzer: no set, the shot from where it was taken */
      if (tShot - tSet < 2.2) steps = A != null && A !== X ? [step(1, { mv: { [X]: F }, pass: [A, X] })] : [step(1, { mv: { [X]: F }, hold: X })];
    }
    if (end.k === 'S' && z !== 0) makeRoom(steps, X, F, pos);
    pushSteps(steps, tSet, Math.max(tSet + 0.3, tShot), steps.vAvg);
    /* the end: the shot, the trip to the line, the ball lost */
    if (end.k === 'S') {
      add({ t: te, pos: copy(pos), ball: { fly: { from: X, to: 'rim', arc: z === 2 ? 1 : z === 1 ? 0.85 : 0.5, dur: 0.5 } } });
      hold = null; loose = RIM.slice();
      if (end.m) { add({ t: te + 0.3, pos: copy(pos), ball: { at: [0, 4.2] } }); loose = [0, 4.2]; }
      if (ch.and1) {
        const a1 = ch.and1, miss = !a1.m && !!ch.reb;
        ftStop(te + 0.31, X, 1, a1.m || 0, miss);
      }
    } else if (end.k === 'F') {
      push(te);                                          // the whistle
      ftStop(te + 0.01, X, end.n || 2, end.m || 0, (end.m || 0) < (end.n || 2) && !!ch.reb);
    } else if (end.k === 'T') {
      const st = end.st != null ? o.idx(end.st) : -1;
      if (st >= 5) {
        const pt = onCourt([pos[X][0] * 0.92, pos[X][1] + 2]);
        add({ t: te + 0.35, pos: copy(pos), ball: { fly: { from: X, to: st, arc: 0, dur: 0.3 } }, dset: { [st - 5]: pt } });
        hold = st;
      } else if (end.of) { push(te + 0.3, { hint: { charge: X } }); }
      else {
        const s = Math.sign(pos[X][0]) || 1, out = [s * 25.6, clamp(pos[X][1] + 4, 4, 44)];
        add({ t: te + 0.6, pos: copy(pos), ball: { at: out } }); hold = null; loose = out;
      }
    }
    /* the board: the bigs crash, the guards get back; the ball off the rim to the rebounder */
    if (ch.reb && (end.k === 'S' ? !end.m : true)) {
      const rb = o.idx(ch.reb.p);
      if (rb >= 0) {
        const tl = frames[frames.length - 1].t, tr = Math.max(tl + 0.45, Math.min(ch.reb.t, tl + 1.3));
        const near = rb <= 4 ? pos[rb] : lerp(pos[rb - 5], RIM, 0.4);
        const sp = onCourt(lerp([clamp(-0.4 * F[0], -11, 11), 7.2], near, 0.3));
        const run = Math.max(0.3, tr - tl) * 17, toward = (p, q, d) => { const e = dist(p, q); return e > d ? lerp(p, q, d / e) : q.slice(); };
        FIVE.forEach(k => { if (k === X || k === rb) return; pos[k] = onCourt(P.big(k) && pos[k][1] < 30 ? toward(pos[k], [pos[k][0] * 0.55, 8], Math.min(run, 9)) : toward(pos[k], [pos[k][0] * 0.9, pos[k][1] + 7], Math.min(run, 7))); });
        if (rb <= 4) pos[rb] = toward(pos[rb], sp, run * 1.5);
        /* a defensive board: the guards who did not get it leak out toward half court for the outlet */
        const ds = rb >= 5 ? { [rb - 5]: sp } : null;
        if (ds) [0, 1].forEach(j => { if (j !== rb - 5) ds[j] = [pos[j][0] * 0.5 + (j ? 6 : -6), 36]; });
        add({ t: tr, pos: copy(pos), ball: { fly: { from: 'rim', to: rb, arc: 0.35, dur: Math.max(0.2, tr - tl - 0.05) } }, dset: ds });
        hold = rb;
      }
    }
  });
  /* the speed each man carries through a waypoint (a gentle turn keeps it, a sharp cut stops and goes) */
  FIVE.forEach(k => {
    for (let j = 0; j < frames.length; j++) {
      const f = frames[j], a = frames[j - 1], b = frames[j + 1];
      let v = [0, 0];
      if (a && b) {
        const p = f.pos[k], pa = a.pos[k], pb = b.pos[k], da = f.t - a.t, db = b.t - f.t;
        if (dist(pa, p) > 0.05 && dist(p, pb) > 0.05 && da > 1e-3 && db > 1e-3) {
          const va = [(p[0] - pa[0]) / da, (p[1] - pa[1]) / da], vb = [(pb[0] - p[0]) / db, (pb[1] - p[1]) / db];
          const cos = (va[0] * vb[0] + va[1] * vb[1]) / Math.max(1e-6, Math.hypot(va[0], va[1]) * Math.hypot(vb[0], vb[1]));
          if (cos > 0) { const sh = Math.min(Math.hypot(va[0], va[1]), Math.hypot(vb[0], vb[1])) / Math.max(1e-6, Math.hypot((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2)); v = [(va[0] + vb[0]) / 2 * cos * Math.min(1, sh), (va[1] + vb[1]) / 2 * cos * Math.min(1, sh)]; }
        }
      }
      (f.vel = f.vel || [])[k] = v;
    }
  });
  return { t0, t1: frames[frames.length - 1].t, frames, stops, calls, D: defOf(o) };
}

/* ------------------------------------------------------------------ a moment --- */
function seg(F, t) { let i = 0; while (i + 1 < F.length && F[i + 1].t <= t) i++; return i; }
function manAt(F, i, k, t) {
  const a = F[i], b = F[i + 1];
  if (!b || t <= a.t) return a.pos[k].slice();
  const dt = b.t - a.t;
  if (dt < 1e-6) return b.pos[k].slice();
  const s = clamp((t - a.t) / dt, 0, 1), s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const p0 = a.pos[k], p1 = b.pos[k], v0 = (a.vel && a.vel[k]) || [0, 0], v1 = (b.vel && b.vel[k]) || [0, 0];
  return [h00 * p0[0] + h10 * dt * v0[0] + h01 * p1[0] + h11 * dt * v1[0], h00 * p0[1] + h10 * dt * v0[1] + h01 * p1[1] + h11 * dt * v1[1]];
}
const offAt = (F, t) => { const i = seg(F, t); return FIVE.map(k => manAt(F, i, k, t)); };
/* where a ball state leaves it at its frame's time */
const endOf = sp => (!sp ? { hold: null, at: null } : sp.h != null ? { hold: sp.h } : sp.fly ? (sp.fly.to === 'rim' ? { hold: null, at: RIM } : { hold: sp.fly.to }) : sp.pick != null ? { hold: sp.pick } : { hold: null, at: sp.at });
/* THE DEFENCE, played as its own instructions say (Louie, 2026-10-15: "the visual defense is based off of what you set
   the screen defenders to do (i.e. hedge big = hedging, contain = show and recover, drop big = drop etc.)"): on the ball
   a yard off, between him and the basket (picked up near half court in the backcourt) - tighter for a man told to gamble,
   a step off for one told to stay solid; one pass away up the line toward the ball (further into the passing lane for a
   gambler); two passes away the help "i" - the higher man toward the nail, the lower on the weak-side block; on a drive
   the help comes (harder from a man told to protect the rim, hardly at all from a foul-conservative one). The team's
   scheme: no paint touches packs the lane, funnel leaves the shooters' men home and the rim protector waiting.
   ON A BALL SCREEN (or a handoff) the screener's man plays HIS COVERAGE (core/instruct.js):
     Hedge big    jumps out into the handler's path above the screen, then recovers to the roller (against the short
                  roll it is a trap: two on the ball, the weak-side big at the nail for the short roll);
     Contain big  (the default) shows level with the screen, then recovers;
     Drop big     sags into the paint between the ball and the rim, giving up the pull-up (and the pop);
   the handler's man goes over the screen and trails him, back in front as the big contains him (behind all the way
   against a drop); the low man tags the roller while the big is out of the paint. */
const NO_D = { cover: [], flags: [], tac: { scheme: 0, gamble: 0 } };
/* the defending five's instructions by place (o.dins: each man's instruction keys) and the team's (o.dtac) */
function defOf(o) {
  const ins = Array.isArray(o.dins) ? o.dins : [], tac = o.dtac || {};
  const has = (j, k) => { const x = ins[j]; return !!x && (x instanceof Set ? x.has(k) : Array.isArray(x) ? x.includes(k) : false); };
  return {
    cover: FIVE.map(j => (has(j, 'hedge') ? 'hedge' : has(j, 'drop') ? 'drop' : 'cont')),
    flags: FIVE.map(j => ({ gam: has(j, 'gam'), sol: has(j, 'sol'), rimp: has(j, 'rimp'), rima: has(j, 'rima'), cons: has(j, 'cons') })),
    tac: { scheme: clamp(+tac.scheme || 0, -1, 1), gamble: clamp(+tac.gamble || 0, 0, 1) }
  };
}
function defence(off, ball, hold, hint, prog, D, hv) {
  D = D || NO_D;
  const fl = j => D.flags[j] || {}, scheme = D.tac.scheme || 0, teamGam = (D.tac.gamble || 0) >= 0.5;
  const out = off.map((p, k) => {
    const f = fl(k), gam = f.gam || teamGam, toR = [RIM[0] - p[0], RIM[1] - p[1]], dr = Math.hypot(toR[0], toR[1]) || 1;
    if (k === hold) {
      /* BEATEN ON A DRIVE: a man attacking the rim at speed has his defender hip to hip - beside him on the middle's side,
         half a step behind - not standing in his path for him to run through (Louie, 2026-10-16); the help comes from
         the others (below) */
      if (hv && p[1] <= 40 && dr > 4) {
        const sp = Math.hypot(hv[0], hv[1]), toward = sp > 0 ? (hv[0] * toR[0] + hv[1] * toR[1]) / (sp * dr) : 0;
        if (sp > 9 && toward > 0.5) {
          const u = [hv[0] / sp, hv[1] / sp], n = [-u[1], u[0]], side = n[0] * -p[0] >= 0 ? 1 : -1;
          return [p[0] + n[0] * side * 2.1 - u[0] * 0.6, p[1] + n[1] * side * 2.1 - u[1] * 0.6];
        }
      }
      let gap = p[1] > 47 ? Math.min(14, p[1] - 38) : dr < 8 ? 1.8 : 3.3;
      if (p[1] <= 47 && dr >= 8) gap += (gam ? -0.9 : 0) + (f.sol ? 0.4 : 0) + 1.2 * Math.max(0, scheme);
      return [p[0] + toR[0] / dr * gap, p[1] + toR[1] / dr * gap];
    }
    if (p[1] > 40) return [p[0] * 0.7, clamp(p[1] - 14, 16, 40)];
    const b = ball || [0, 26], ballSide = Math.abs(b[0]) < 5 || Math.sign(p[0]) === Math.sign(b[0]);
    let q;
    if (ballSide && dist(p, b) < 26) q = p[1] < 10 && Math.abs(p[0]) > 18 ? lerp(p, RIM, 0.12) : lerp(lerp(p, b, gam ? 0.4 : 0.28), RIM, gam ? 0.1 : 0.16);
    else q = p[1] < 14 ? lerp(p, [Math.sign(p[0] || 1) * 5.5, 6.5], 0.62) : lerp(p, [Math.sign(p[0] || 1) * 2.5, 19], 0.58);
    if (scheme > 0) q = lerp(q, [q[0] * 0.72, Math.min(q[1], 14)], 0.35 * scheme);
    else if (scheme < 0) q = lerp(q, lerp(p, RIM, 0.12), 0.35 * -scheme);
    return q;
  });
  /* funnel: the rim protector (the centre's man) waits at the rim */
  if (scheme < 0 && hold !== 4) out[4] = lerp(out[4], [0, 8.5], 0.4 * -scheme);
  if (ball && hold != null && hold <= 4 && Math.abs(ball[0]) < 10 && ball[1] < 16) {
    off.forEach((p, k) => {
      if (k === hold) return;
      const f = fl(k), far = dist(p, ball) > 10;
      const w = f.cons ? (far ? 0.14 : 0.05) : f.rimp || f.rima ? (far ? 0.6 : 0.25) : (far ? 0.38 : 0.12);
      out[k] = lerp(out[k], lerp(ball, RIM, 0.5), w);
    });
  } else if (hint && hint.help && ball) off.forEach((p, k) => { if (k !== hold && dist(p, ball) > 12) out[k] = lerp(out[k], lerp(ball, RIM, 0.55), fl(k).cons ? 0.12 : 0.3); });
  if (hint && hint.pnr && hint.pnr[0] != null && hint.pnr[1] != null && hint.pnr[0] !== hint.pnr[1]) cover(out, off, ball, hint, prog == null ? 1 : prog, D);
  else if (hint && hint.tag && hint.tag[0] != null && hint.tag[1] != null) out[hint.tag[0]] = lerp(off[hint.tag[1]], RIM, 0.45);
  return out;
}
/* a ball screen's coverage, moment by moment: ph 0 the screen being set, 1 the handler coming off it, 2 the pass out of
   the trap (p: how far through the moment) */
function cover(out, off, ball, hint, p, D) {
  const h = hint.pnr[0], s = hint.pnr[1], cov = D.cover[s] || 'cont', H = off[h], Sc = off[s];
  const d0 = [H[0] - Sc[0], H[1] - Sc[1]], n0 = Math.hypot(d0[0], d0[1]) || 1, dv = [d0[0] / n0, d0[1] / n0];
  const toR = [RIM[0] - H[0], RIM[1] - H[1]], nR = Math.hypot(toR[0], toR[1]) || 1;
  const back = lerp(Sc, RIM, 0.3), B = ball || H;
  if (hint.ph === 0) {
    /* waiting for it: up beside the screen to hedge, level with it to show, under it to drop */
    out[s] = cov === 'hedge' ? [Sc[0] + dv[0] * 1.2, Sc[1] + 1.6] : cov === 'drop' ? lerp(RIM, Sc, 0.55) : lerp(lerp(Sc, H, 0.15), RIM, 0.04);
    return;
  }
  const trap = !!hint.short && cov === 'hedge';
  /* the hedge: in front of the handler, between him and the basket (two men on the ball); the show: level with the
     screen, beside his own man; the drop: back in the paint between the ball and the rim */
  const inFront = [H[0] + toR[0] / nR * 2.2, H[1] + toR[1] / nR * 2.2], level = lerp(lerp(Sc, H, 0.3), RIM, 0.04);
  const drop = lerp(RIM, B, Math.min(0.42, 11 / Math.max(1, dist(RIM, B))));
  out[s] = cov === 'hedge' ? (trap || p < 0.55 ? inFront : lerp(inFront, back, (p - 0.55) / 0.45)) : cov === 'drop' ? drop : p < 0.35 ? level : lerp(level, back, (p - 0.35) / 0.65);
  /* the handler's man: over the screen and trailing him; in front of him again once the big has contained him and gone
     back (behind all the way against a drop); on a trap, the second man on the ball */
  const trail = [H[0] - dv[0] * 2.4, H[1] - dv[1] * 2.4 + 0.6], guard = lerp(H, RIM, 0.14);
  out[h] = trap ? [H[0] - dv[0] * 1.6, H[1] + 1.5] : cov === 'drop' ? trail : cov === 'hedge' ? lerp(trail, guard, clamp((p - 0.45) / 0.55, 0, 1)) : lerp(trail, guard, clamp(p * 1.4, 0, 1));
  /* the low man tags the roller while the big is out of the paint; on a trap the weak-side big takes the nail */
  const bigOut = cov === 'hedge' || (cov === 'cont' && p < 0.7);
  if (hint.tag && hint.tag[0] != null && hint.tag[1] != null && bigOut && hint.tag[0] !== h && hint.tag[0] !== s) out[hint.tag[0]] = lerp(off[hint.tag[1]], RIM, 0.45);
  if (trap && hint.nail != null && hint.nail !== h && hint.nail !== s) out[hint.nail] = [0, 17.5];
}
function at(pl, t, hp) {
  const F = pl.frames;
  if (hp != null) { const s = pl.stops.find(x => Math.abs(x.t - t) < 1e-6); if (s) return atStop(pl, s, hp); }
  const i = seg(F, t), a = F[i], b = F[i + 1] || null;
  const off = FIVE.map(k => manAt(F, i, k, t));
  /* the ball */
  let hold = null, ball = null, air = 0, pass = null;
  const prevEnd = endOf(a.ball);
  const sp = b && t > a.t ? b.ball : null;
  const manPos = (k, tt) => (k <= 4 ? manAt(F, seg(F, tt), k, tt) : null);
  if (!sp) { hold = prevEnd.hold; ball = hold == null ? prevEnd.at : null; }
  else if (sp.h != null) hold = sp.h;
  else if (sp.fly) {
    const tf = b.t - sp.fly.dur;
    if (t < tf) { if (sp.fly.from === 'rim') ball = RIM; else hold = sp.fly.from; }
    else {
      const x = clamp((t - tf) / Math.max(1e-6, sp.fly.dur), 0, 1);
      const p0 = sp.fly.from === 'rim' ? RIM : (manPos(sp.fly.from, tf) || RIM);
      const p1 = sp.fly.to === 'rim' ? RIM : sp.fly.to <= 4 ? manPos(sp.fly.to, b.t) : ((b.dset && b.dset[sp.fly.to - 5]) || RIM);
      ball = lerp(p0, p1, x); air = sp.fly.arc * Math.sin(Math.PI * x);
      if (sp.fly.from !== 'rim' && sp.fly.to !== 'rim') pass = [sp.fly.from, sp.fly.to];
    }
  } else if (sp.pick != null) { const x = ease(clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1)); ball = lerp(prevEnd.at || sp.at, sp.at, x); }
  else if (sp.at) { const p0 = prevEnd.at || (prevEnd.hold != null && prevEnd.hold <= 4 ? manPos(prevEnd.hold, a.t) : sp.at); ball = lerp(p0, sp.at, ease(clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1))); }
  /* the defence: they react a moment late */
  const lagT = Math.max(F[0].t, t - 0.3), off2 = offAt(F, lagT);
  const bAt = hold != null && hold <= 4 ? off2[hold] : ball;
  const hint = b ? b.hint : a.hint, prog = b ? clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1) : 1;
  /* the handler's speed, a moment back (the defence sees what he was doing) */
  let hv = null;
  if (hold != null && hold <= 4) { const tp = Math.max(F[0].t, lagT - 0.25); if (lagT - tp > 0.05) { const q = offAt(F, tp)[hold]; hv = [(off2[hold][0] - q[0]) / (lagT - tp), (off2[hold][1] - q[1]) / (lagT - tp)]; } }
  const def = defence(off2, bAt, hold != null && hold <= 4 ? hold : null, hint, prog, pl.D, hv);
  const ds = (b && b.dset) || (!b && a.dset) || null;
  if (ds) Object.keys(ds).forEach(j => { def[+j] = ds[j].slice(); });
  const call = pl.calls.filter(c => c.t <= t + 1e-6).slice(-1)[0] || null;
  return { off, def, hold, ball, air, pass, scr: b && b.scr && t > a.t ? b.scr : null, call, fixed: ds ? Object.keys(ds).map(Number) : [] };
}
/* a dead ball at the line: the walk into the lane, then each free throw */
function atStop(pl, s, hp) {
  const x = ease(clamp(hp / 0.3, 0, 1));
  const off = FIVE.map(k => lerp(s.from[k], s.lineup[k], x));
  const def = defence(off, off[s.X], s.X, null, 1, pl.D);
  Object.keys(s.dset).forEach(j => { def[+j] = s.dset[j].slice(); });
  let hold = s.X, ball = null, air = 0;
  if (hp > 0.3) {
    const q = 0.7 / s.n, i = Math.min(s.n - 1, Math.floor((hp - 0.3) / q)), f = (hp - 0.3 - i * q) / q;
    if (f > 0.45) { hold = null; const y = clamp((f - 0.45) / 0.45, 0, 1); ball = lerp(s.lineup[s.X], RIM, y); air = 0.8 * Math.sin(Math.PI * y); if (y >= 1) ball = i < s.made ? [0, 4.2] : RIM; }
  }
  return { off, def, hold, ball, air, pass: null, scr: null, call: null, fixed: Object.keys(s.dset).map(Number), ft: true };
}

return { plan, at, shotSpot, kindOf, people, defOf, BOOK, COURT, SPOT, spot, RIM };
}));
