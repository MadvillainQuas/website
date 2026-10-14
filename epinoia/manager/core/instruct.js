'use strict';
/* ============================================================================
   MANAGER - PLAYER INSTRUCTIONS (core: no site, no DOM, no database).                       window.Mgr.instruct

   Louie, 2026-10-14: "add individual instructions to each player" - for guards, wings and bigs, in the Football
   Manager way: shown when a player is pressed, set apart from the team's own instructions, with his touches (usage)
   moved two steps either way. And "Make sure that player abilities have a strong effect on outcomes (i.e. can't just
   give a low transition player the transition based instructions and it work optimally, or ask a poor shooter to shoot
   more)", "Use football manager engine design/philosophy".

   FM'S WAY, KEPT HERE: an instruction changes what a player TRIES - how much of the ball he has, where he shoots from,
   whether he runs, gambles, hedges or drops - and his own numbers decide how it goes (engine.js sideOf: every volume
   moved is paid for at his own make rates and at the volume cost of his habits). So the catalogue carries, beside each
   instruction, how well THIS player suits it (fit: his own line against his position's in his league), the way FM
   rates a player for a role; an instruction he does not suit is allowed, and costs.

     roleOf(card, slot)        'g' guard, 'w' wing, 'b' big: his listed position (slot 0..4), else his minutes'
     list(role)                the instructions a role has, in their sections (In possession, Out of possession)
     norm(entry, role)         {u: -2..2, keys: [..]} kept to one of each choice and to what the role allows
     fit(key, card, ref)       {s: 0..1, word, why}: how well he suits it
     roles(role)               the role presets (a bundle of instructions), and roleFit(...) how well he suits one
     forEngine(entries, cards) Map id -> {u, k: Set} for engine.js sideOf (X.ins)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.instruct = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const M = () => root.Mgr || {};
const CARDS = () => M().cards || (typeof require === 'function' ? require('./cards.js') : null);
const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ the catalogue --- */
/* each: k (kept in the club's roster), label, sec ('ip' in possession, 'op' out of possession), roles it is offered to,
   x (the choice it belongs to: one of a choice at a time), needs (another that must be on), how (what it does) */
const LIST = [
  /* guards: on the ball */
  { k: 'pas', label: 'Be more passive', sec: 'ip', roles: 'g', x: 'ball',
    how: 'Less time on the ball: fewer of the plays and fewer unassisted shots at the rim and from mid-range (what is left of them comes late in the clock); more passing when he has it' },
  { k: 'agg', label: 'Be aggressive', sec: 'ip', roles: 'g', x: 'ball',
    how: 'More time on the ball: more of the plays and more unassisted baskets from his own shot diet; fewer assists and less ball movement. Costly for a player who does not create his own shot' },
  { k: 'push', label: 'Push in transition', sec: 'ip', roles: 'gw', x: 'tempo',
    how: 'Runs when he gets the ball: more transition chances, and more first-option shots early in the half court. Pays off for players who score in transition; a player who rarely runs turns the extra chances over and misses them' },
  { k: 'slow', label: 'Slow it down', sec: 'ip', roles: 'g', x: 'tempo',
    how: 'Walks it up: more of his chances in the half court and a slower game; good for players who score better in the half court than in transition' },
  { k: 'arc', label: 'Punish behind the arc', sec: 'ip', roles: 'g', x: 'shot',
    how: 'More unassisted threes for him (pull-ups). Made at his own three-point rate, and every extra attempt costs him a little more the less he is used to making his own' },
  { k: 'dh', label: 'Put pressure downhill', sec: 'ip', roles: 'g', x: 'shot',
    how: 'More unassisted shots at the rim and from mid-range, and more trips to the line; the dribble penetration makes passes for a good passer. Loose handles turn it over' },
  { k: 'kick', label: 'Look for kick-outs', sec: 'ip', roles: 'g',
    how: 'Passes to the shooters rather than finishing himself: fewer rim and mid-range shots of his own, more catch-and-shoot threes for the shooters around him. Only as good as his passing and their shooting' },
  { k: 'dump', label: 'Look for dump-off passes', sec: 'ip', roles: 'g',
    how: 'At the rim, finds the big: more assisted shots at the rim for the bigs. Only as good as his passing and their finishing' },
  /* wings and bigs: the ball */
  { k: 'hm', label: 'Handle the ball more', sec: 'ip', roles: 'wb', x: 'ball',
    how: 'More chances to create: more of the plays, more unassisted shots, more chances to assist. Costly for a player who does not create' },
  { k: 'hl', label: 'Handle the ball less', sec: 'ip', roles: 'wb', x: 'ball',
    how: 'Fewer chances to create: fewer of the plays, fewer unassisted shots and assists' },
  { k: 'spot', label: 'Only spot-ups and cuts', sec: 'ip', roles: 'w', x: 'ball',
    how: 'No plays of his own unless the clock is running down: his shots are catch-and-shoot threes and cuts, set up by others' },
  { k: 'fin', label: 'Finisher only', sec: 'ip', roles: 'b', x: 'ball',
    how: 'No plays of his own: he finishes what others set up (rolls, lobs, dump-offs, put-backs)' },
  { k: 'cut', label: 'Cut more', sec: 'ip', roles: 'w', x: 'move',
    how: 'More assisted shots at the rim, fewer assisted threes, less floor spacing. Needs passers to find him and a finisher to cut' },
  { k: 'space', label: 'Space more', sec: 'ip', roles: 'w', x: 'move',
    how: 'More assisted threes, fewer assisted rim shots; spaces the floor (if defences have to respect his shot)' },
  { k: 'green', label: 'Green light', sec: 'ip', roles: 'w', x: 'three',
    how: 'Takes more of the threes he is offered, assisted and off the dribble, at his own three-point rate' },
  { k: 'rip', label: 'Rip through', sec: 'ip', roles: 'w', x: 'three',
    how: 'Turns down threes to attack: the rim or the mid-range, whichever he scores better at' },
  { k: 'crash', label: 'Crash the glass', sec: 'ip', roles: 'w',
    how: 'Attacks the offensive boards (as well as he rebounds); less spacing, and the other side runs out against you more' },
  /* bigs: the screen and the post */
  { k: 'roll', label: 'Roller big', sec: 'ip', roles: 'b', x: 'screen',
    how: 'Rolls to the rim after his screens: more assisted shots at the rim, at his own finishing' },
  { k: 'pop', label: 'Pick and pop', sec: 'ip', roles: 'b', x: 'screen',
    how: 'Pops out after his screens: more assisted threes (at his own three-point rate), and drives past the close-out for a big who can put it on the floor' },
  { k: 'short', label: 'Play more short roll', sec: 'ip', roles: 'b', x: 'roll', needs: 'roll',
    how: 'With Roller big: catches in the middle and makes the play - more assists for a passer, more shots at the rim, assisted and his own; a poor passer turns it over' },
  { k: 'dive', label: 'Dive to the rim', sec: 'ip', roles: 'b', x: 'roll', needs: 'roll',
    how: 'With Roller big: all the way to the rim - more assisted rim shots, less of everything else' },
  { k: 'pm', label: 'Play out of the post more', sec: 'ip', roles: 'b', x: 'post',
    how: 'More post-ups: more unassisted shots at the rim and from mid-range, more chances to pass out of the double. At his own finishing; a big who does not create pays for it' },
  { k: 'pl', label: 'Play out of the post less', sec: 'ip', roles: 'b', x: 'post', how: 'Fewer post-ups' },
  { k: 'nop', label: 'Don’t post up', sec: 'ip', roles: 'b', x: 'post', how: 'No post-ups at all' },
  /* out of possession */
  { k: 'gam', label: 'Gamble for steals', sec: 'op', roles: 'gw', x: 'stl',
    how: 'Goes for steals: more of them for quick hands, but open shots and fouls when the gambles miss - most of them, for a player without quick hands' },
  { k: 'sol', label: 'Stay solid', sec: 'op', roles: 'gw', x: 'stl',
    how: 'Contests rather than gambles: fewer steals, better contests, fewer fouls' },
  { k: 'rimp', label: 'More aggressive rim protection', sec: 'op', roles: 'w',
    how: 'Rotates over to block shots: more blocks for a shot blocker, more fouls for anybody' },
  { k: 'hedge', label: 'Hedge big', sec: 'op', roles: 'b', x: 'cover',
    how: 'Jumps out at the ball handler: more turnovers forced (by a mobile big), less rim protection from him, more of it asked of the others' },
  { k: 'cont', label: 'Contain big', sec: 'op', roles: 'b', x: 'cover',
    how: 'Between a hedge and a drop: the default coverage' },
  { k: 'drop', label: 'Drop big', sec: 'op', roles: 'b', x: 'cover',
    how: 'Sags back to protect the rim: more rim protection (from a rim protector), more and easier mid-range shots for the other side' },
  { k: 'rima', label: 'Defend the rim aggressively', sec: 'op', roles: 'b', x: 'rimd',
    how: 'Goes for blocks: more of them for a shot blocker, more fouls for anybody' },
  { k: 'cons', label: 'Be foul-conservative', sec: 'op', roles: 'b', x: 'rimd',
    how: 'Stays out of foul trouble: fewer fouls, fewer blocks and less rim protection' }
];
const BY = new Map(LIST.map(d => [d.k, d]));
const SEC = { ip: 'In possession', op: 'Out of possession' };
const ROLE = { g: 'Guard', w: 'Wing', b: 'Big' };
const U_MAX = 2;

/* his instruction set: his listed position (0 PG .. 4 C) where there is one, else where his minutes are */
function roleOf(card, slot) {
  const k = isNum(slot) ? slot : card && isNum(card.pos) ? Math.round(card.pos) - 1 : 2;
  return k <= 1 ? 'g' : k === 2 ? 'w' : 'b';
}
const list = role => LIST.filter(d => d.roles.includes(role));

/* KEPT TO WHAT HE MAY DO: the role's own instructions, one of each choice (the later wins), nothing that needs another
   that is off, the usage level -2..2 in whole steps */
function norm(entry, role) {
  const e = entry || {}, r = role || e.role || 'w';
  const u = clamp(Math.round(+e.u || 0), -U_MAX, U_MAX);
  const keep = [], taken = new Map();
  (Array.isArray(e.ins) ? e.ins : Array.isArray(e.keys) ? e.keys : []).forEach(k => {
    const d = BY.get(k);
    if (!d || !d.roles.includes(r)) return;
    if (d.x) { const was = taken.get(d.x); if (was) keep.splice(keep.indexOf(was), 1); taken.set(d.x, k); }
    if (!keep.includes(k)) keep.push(k);
  });
  const out = keep.filter(k => { const d = BY.get(k); return !d.needs || keep.includes(d.needs); });
  return { u, keys: out };
}
/* a choice made: k on (its choice's other options off), or off */
function toggle(entry, role, k, on) {
  const cur = norm(entry, role), d = BY.get(k);
  let keys = cur.keys.filter(x => x !== k);
  if (on && d) {
    if (d.x) keys = keys.filter(x => BY.get(x).x !== d.x);
    keys.push(k);
    if (d.needs && !keys.includes(d.needs)) { const n = BY.get(d.needs); if (n && n.x) keys = keys.filter(x => BY.get(x).x !== n.x); keys.push(d.needs); }
  }
  /* what needed k goes with it */
  if (!on) keys = keys.filter(x => BY.get(x).needs !== k);
  return norm({ u: cur.u, ins: keys }, role);
}

/* ------------------------------------------------------------------ how well he suits it --- */
/* his line against his position's in his league (cards.atPos), as the few things an instruction leans on */
function traits(c, ref) {
  const C = CARDS(), at = st => (C && ref ? C.atPos(ref, c.pos, st) : null), rel = (v, st, d) => { const a = at(st); return isNum(v) && isNum(a) && a > 0 ? v / a : d; };
  const tr = (c.off && c.off.tr) || {}, trShare = ref && ref.trShare > 0 && isNum(tr.share) ? tr.share / ref.trShare : 1;
  return {
    create: isNum(c.creator) ? c.creator : 0.35,
    usg: rel(c.usg, 'usg', 1),
    pass: rel(c.off && c.off.ast, 'ast_pct', 1),
    shoot: isNum(c.p3Rel) ? c.p3Rel : 1,
    vol3: c.mixRel ? c.mixRel.three : 1,
    pull: c.un ? c.un.three : 0.12,
    rim: isNum(c.rimRel) ? c.rimRel : 1,
    volRim: c.mixRel ? c.mixRel.rim : 1,
    mid: c.off && isNum(c.off.dMid) ? c.off.dMid : 0,
    run: trShare,
    trEff: ref && isNum(tr.ppp) ? tr.ppp - ref.trPpp : 0,
    hcEff: ref && isNum(tr.hcPpp) ? tr.hcPpp - ref.hcPpp : 0,
    stl: rel(c.def && c.def.stl, 'stl_pct', 1),
    blk: rel(c.def && c.def.blk, 'blk_pct', 1),
    orb: rel(c.off && c.off.orb, 'oreb_pct', 1),
    fouls: rel(c.def && c.def.pf40, 'pf40', 1),
    hands: c.off && isNum(c.off.dTov) ? -c.off.dTov : 0,
    protect: c.def ? (c.def.rimSave || 0) + 0.5 * (c.def.rimDeter || 0) : 0
  };
}
const pctTxt = v => Math.round(100 * v) + '%';
/* each instruction's fit: a score (0.5 an average man of his position) and the line it rests on */
const FIT = {
  pas: t => [0.5 + 0.35 * (t.pass - 1) - 0.3 * (t.create - 0.35), 'Assist rate ' + pctTxt(t.pass) + ' of his position’s'],
  agg: t => [0.35 + 0.9 * (t.create - 0.35) + 0.4 * (t.usg - 1) + 0.25 * (t.rim - 1) + 0.25 * (t.shoot - 1), 'Creates ' + pctTxt(t.create) + ' of his own points'],
  push: t => [0.45 + 0.35 * (t.run - 1) + 1.2 * t.trEff, (t.run >= 1 ? 'Runs ' : 'Rarely runs: ') + pctTxt(t.run) + ' of his position’s transition plays'],
  slow: t => [0.5 + 1.2 * (t.hcEff - t.trEff) + 0.15 * (1 - t.run), 'Half court ' + (t.hcEff >= 0 ? '+' : '') + t.hcEff.toFixed(2) + ' points a play against the league'],
  arc: t => [0.5 + 1.5 * (t.shoot - 1) + 0.9 * (t.pull - 0.12) + 0.1 * (t.vol3 - 1), 'Three-point rate ' + pctTxt(t.shoot) + ' of the league’s; ' + pctTxt(t.pull) + ' of his threes off the dribble'],
  dh: t => [0.5 + 0.9 * (t.rim - 1) + 0.25 * (t.volRim - 1) + 0.3 * (t.create - 0.35) + 0.08 * t.hands, 'Finishes at the rim at ' + pctTxt(t.rim) + ' of the league'],
  kick: t => [0.5 + 0.45 * (t.pass - 1), 'Assist rate ' + pctTxt(t.pass) + ' of his position’s'],
  dump: t => [0.5 + 0.45 * (t.pass - 1), 'Assist rate ' + pctTxt(t.pass) + ' of his position’s'],
  hm: t => [0.35 + 0.8 * (t.create - 0.35) + 0.3 * (t.usg - 1) + 0.15 * (t.pass - 1), 'Creates ' + pctTxt(t.create) + ' of his own points'],
  hl: t => [0.5 - 0.6 * (t.create - 0.35) + 0.1, 'Creates ' + pctTxt(t.create) + ' of his own points'],
  spot: t => [0.45 + 0.9 * (t.shoot - 1) - 0.6 * (t.create - 0.35) + 0.2 * (t.vol3 - 1), 'Three-point rate ' + pctTxt(t.shoot) + ' of the league’s'],
  fin: t => [0.45 + 0.8 * (t.rim - 1) - 0.6 * (t.create - 0.35), 'Finishes at the rim at ' + pctTxt(t.rim) + ' of the league'],
  cut: t => [0.5 + 0.9 * (t.rim - 1) - 0.3 * (t.shoot - 1), 'Finishes at the rim at ' + pctTxt(t.rim) + ' of the league'],
  space: t => [0.5 + 1.4 * (t.shoot - 1) + 0.15 * (t.vol3 - 1), 'Three-point rate ' + pctTxt(t.shoot) + ' of the league’s'],
  green: t => [0.45 + 1.6 * (t.shoot - 1) + 0.2 * (t.vol3 - 1), 'Three-point rate ' + pctTxt(t.shoot) + ' of the league’s'],
  rip: t => [0.5 + 0.8 * (t.rim - 1) + 0.3 * t.mid - 0.8 * (t.shoot - 1), 'Rim ' + pctTxt(t.rim) + ', three ' + pctTxt(t.shoot) + ' of the league'],
  crash: t => [0.45 + 0.45 * (t.orb - 1), 'Offensive rebounding ' + pctTxt(t.orb) + ' of his position’s'],
  roll: t => [0.5 + 0.9 * (t.rim - 1), 'Finishes at the rim at ' + pctTxt(t.rim) + ' of the league'],
  pop: t => [0.4 + 1.5 * (t.shoot - 1) + 0.25 * (t.vol3 - 1), 'Three-point rate ' + pctTxt(t.shoot) + ' of the league’s'],
  short: t => [0.45 + 0.5 * (t.pass - 1) + 0.1 * t.hands, 'Assist rate ' + pctTxt(t.pass) + ' of his position’s'],
  dive: t => [0.5 + 0.9 * (t.rim - 1), 'Finishes at the rim at ' + pctTxt(t.rim) + ' of the league'],
  pm: t => [0.35 + 0.8 * (t.create - 0.35) + 0.5 * (t.rim - 1) + 0.2 * t.mid, 'Creates ' + pctTxt(t.create) + ' of his own points'],
  pl: t => [0.5 - 0.5 * (t.create - 0.35), 'Creates ' + pctTxt(t.create) + ' of his own points'],
  nop: t => [0.55 - 0.6 * (t.create - 0.35), 'Creates ' + pctTxt(t.create) + ' of his own points'],
  gam: t => [0.45 + 0.45 * (t.stl - 1), 'Steal rate ' + pctTxt(t.stl) + ' of his position’s'],
  sol: t => [0.55 - 0.2 * (t.stl - 1) + 0.15 * (1 - t.fouls), 'Fouls ' + pctTxt(t.fouls) + ' of his position’s'],
  rimp: t => [0.4 + 0.4 * (t.blk - 1) - 0.15 * (t.fouls - 1), 'Block rate ' + pctTxt(t.blk) + ' of his position’s'],
  hedge: t => [0.45 + 0.5 * (t.stl - 1) - 0.1 * (t.blk - 1), 'Steal rate (his feet) ' + pctTxt(t.stl) + ' of his position’s'],
  cont: t => [0.55, 'The default coverage'],
  drop: t => [0.45 + 0.35 * (t.blk - 1) + 0.08 * t.protect, 'Block rate ' + pctTxt(t.blk) + ' of his position’s'],
  rima: t => [0.4 + 0.4 * (t.blk - 1) - 0.15 * (t.fouls - 1), 'Block rate ' + pctTxt(t.blk) + ' of his position’s'],
  cons: t => [0.5 + 0.25 * (t.fouls - 1) - 0.1 * (t.blk - 1), 'Fouls ' + pctTxt(t.fouls) + ' of his position’s']
};
const WORDS = [[0.7, 'Natural fit', 'a4'], [0.52, 'Good fit', 'a3'], [0.36, 'Workable', 'a2'], [-1, 'Poor fit', 'a1']];
function fit(key, card, ref) {
  const f = FIT[key];
  if (!f || !card) return { s: 0.5, word: '', band: '', why: '' };
  const [raw, why] = f(traits(card, ref));
  const s = clamp(isNum(raw) ? raw : 0.5, 0, 1), w = WORDS.find(x => s >= x[0]);
  return { s, word: w[1], band: w[2], why };
}

/* ------------------------------------------------------------------ roles (FM's presets) --- */
const ROLES = {
  g: [
    { k: 'fg', label: 'Floor general', keys: ['pas', 'kick', 'dump', 'slow', 'sol'], u: 0, how: 'Runs the offence for the others: kicks out to the shooters, finds the bigs, walks it up' },
    { k: 'sg', label: 'Scoring guard', keys: ['agg', 'push', 'sol'], u: 1, how: 'Hunts his own shot, in transition and in the half court' },
    { k: 'sh', label: 'Shot-maker', keys: ['agg', 'arc', 'sol'], u: 1, how: 'Pull-up threes, early and often' },
    { k: 'sl', label: 'Slasher', keys: ['agg', 'dh', 'push'], u: 1, how: 'Lives in the paint and at the line' },
    { k: 'td', label: '3-and-D guard', keys: ['pas', 'gam'], u: -1, how: 'Spaces the floor and hounds the ball' }
  ],
  w: [
    { k: 'tw', label: '3-and-D wing', keys: ['spot', 'space', 'green', 'sol'], u: -1, how: 'Catch-and-shoot threes, and a solid defender' },
    { k: 'sl', label: 'Slasher', keys: ['hm', 'cut', 'rip', 'push'], u: 1, how: 'Attacks the rim off the catch and in transition' },
    { k: 'sc', label: 'Secondary creator', keys: ['hm', 'green', 'push'], u: 1, how: 'A second ball handler who makes his own shot' },
    { k: 'gl', label: 'Glue wing', keys: ['hl', 'cut', 'crash', 'rimp'], u: -1, how: 'Cuts, crashes and protects: the dirty work' }
  ],
  b: [
    { k: 'rr', label: 'Rim runner', keys: ['fin', 'roll', 'dive', 'drop', 'rima'], u: -1, how: 'Screens, dives and protects the rim' },
    { k: 'st', label: 'Stretch big', keys: ['hl', 'pop', 'nop', 'cont'], u: 0, how: 'Pops for threes and pulls the other big away' },
    { k: 'ph', label: 'Post hub', keys: ['hm', 'pm', 'cont'], u: 1, how: 'The offence runs through his post-ups and his passing' },
    { k: 'pb', label: 'Playmaking big', keys: ['hm', 'roll', 'short', 'hedge'], u: 0, how: 'Short rolls and makes the play, and shows on the ball' },
    { k: 'rp', label: 'Rim protector', keys: ['fin', 'roll', 'drop', 'rima', 'nop'], u: -1, how: 'Stays home and owns the paint' }
  ]
};
const roles = role => ROLES[role] || [];
function roleFit(preset, card, ref) {
  const fs = preset.keys.filter(k => k !== 'cont').map(k => fit(k, card, ref).s);
  const s = fs.length ? fs.reduce((a, v) => a + v, 0) / fs.length : 0.5, w = WORDS.find(x => s >= x[0]);
  return { s, word: w[1], band: w[2], stars: Math.max(1, Math.min(5, Math.round(1 + 4 * s))) };
}
/* the preset he is on, if his instructions are exactly one */
function presetOf(entry, role) {
  const n = norm(entry, role), set = new Set(n.keys);
  return roles(role).find(p => p.u === n.u && p.keys.length === set.size && p.keys.every(k => set.has(k))) || null;
}

/* ------------------------------------------------------------------ for the engine --- */
/* the roster's entries -> Map id -> {u, k: Set} (engine.js sideOf X.ins); the role from the entry, else his card */
function forEngine(entries, cardOf, slotOf) {
  const out = new Map();
  (entries || []).forEach(e => {
    if (!e || e.id == null) return;
    const id = String(e.id), c = cardOf ? cardOf(id) : null, role = e.role || roleOf(c, slotOf ? slotOf(id) : null), n = norm(e, role);
    if (n.u || n.keys.length) out.set(id, { u: n.u, k: new Set(n.keys), role });
  });
  return out;
}
const keyOf = ins => (ins && ins.size ? [...ins.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, x]) => id + ':' + x.u + ':' + [...x.k].sort().join('.')).join('|') : '');

return { LIST, BY, SEC, ROLE, U_MAX, roleOf, list, norm, toggle, traits, fit, roles, roleFit, presetOf, forEngine, keyOf, WORDS };
}));
