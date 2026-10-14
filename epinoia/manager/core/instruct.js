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
     (the bundles of instructions this once offered as roles are core/roles.js's roles at each position now)
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

/* KEPT TO WHAT HE MAY DO: the role's own instructions ('*': any - what the engine is handed, which keeps to each five's
   roles itself), one of each choice (the later wins), nothing that needs another that is off, the usage level -2..2
   in whole steps */
function norm(entry, role) {
  const e = entry || {}, r = role || e.role || 'w';
  const u = clamp(Math.round(+e.u || 0), -U_MAX, U_MAX);
  const keep = [], taken = new Map();
  (Array.isArray(e.ins) ? e.ins : Array.isArray(e.keys) ? e.keys : []).forEach(k => {
    const d = BY.get(k);
    if (!d || (r !== '*' && !d.roles.includes(r))) return;
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
    protect: c.def ? (c.def.rimSave || 0) + 0.5 * (c.def.rimDeter || 0) : 0,
    fta: c.off && isNum(c.off.rFta) ? c.off.rFta : 1,
    /* the league's own rates, and his, for the words (and for what a shot is worth to him) */
    pos: clamp(Math.round(isNum(c.pos) ? c.pos : 3), 1, 5),
    lg3: ref && isNum(ref.p3) ? ref.p3 : 0.34, lgRim: ref && isNum(ref.rim) ? ref.rim : 0.6, lgMid: ref && isNum(ref.mid) ? ref.mid : 0.4,
    sh3: c.mix && isNum(c.mix.three) ? c.mix.three : null, posSh3: ref && ref.byPos && C ? ref.byPos[clamp(Math.round(isNum(c.pos) ? c.pos : 3), 1, 5) - 1].p3sh : null
  };
}
/* ------------------------------------------------------------------ the words for why --- */
/* IN PLAIN TERMS (Louie, 2026-10-14: "Block rate 80% of his position's [what does this mean!? - needs to make more
   intuitive sense for a layman]"): what he does, against the league or the men who play his position, never a ratio */
const POS_PLURAL = ['point guards', 'shooting guards', 'small forwards', 'power forwards', 'centres'];
const pct0 = v => Math.round(100 * v) + '%';
const howVs = r => (r >= 1.3 ? 'much more often than' : r >= 1.1 ? 'more often than' : r > 0.9 ? 'about as often as' : r > 0.75 ? 'a bit less often than' : 'much less often than');
const expit = x => 1 / (1 + Math.exp(-x)), logit = p => Math.log(p / (1 - p));
/* what a shot is worth to him (points a shot): his three, his catch-and-shoot three (a little better), the rim, the mid-range */
const worth = t => {
  const p3 = clamp(t.lg3 * t.shoot, 0.1, 0.6), rim = clamp(t.lgRim * t.rim, 0.25, 0.9), mid = clamp(expit(logit(t.lgMid) + clamp(t.mid, -1, 1)), 0.15, 0.7);
  return { p3, rim, mid, three: 3 * p3, catch3: 3 * (p3 + 0.025), atRim: 2 * rim + 0.12 * t.fta, inMid: 2 * mid };
};
/* WHAT ATTACKING A CLOSE-OUT IS WORTH (a professional league's tracked drives: 0.45 shots a drive at 49%, a foul drawn
   on 7%, a pass on about half - the possession going on, about a point - a turnover on 7%): the drive's shot at his own
   finishing at the rim and in the mid-range against the league's, its fouls at his own rate */
const driveWorth = (t, w) => 0.45 * 2 * 0.49 * (0.65 * w.rim / t.lgRim + 0.35 * w.mid / t.lgMid) + 0.105 * t.fta + 0.456;
const S = {
  three: t => 'He makes ' + pct0(clamp(t.lg3 * t.shoot, 0, 1)) + ' of his threes (the league: ' + pct0(t.lg3) + ')'
    + (isNum(t.sh3) && isNum(t.posSh3) && t.posSh3 > 0 ? ' and takes ' + (t.sh3 / t.posSh3 >= 1.15 ? 'more of them than' : t.sh3 / t.posSh3 > 0.87 ? 'about as many as' : 'fewer of them than') + ' most ' + POS_PLURAL[t.pos - 1] : '') + '.',
  rim: t => 'He makes ' + pct0(clamp(t.lgRim * t.rim, 0, 1)) + ' of his shots at the rim (the league: ' + pct0(t.lgRim) + ').',
  create: t => pct0(t.create) + ' of his points come from shots he makes for himself (a typical player: about 35%).',
  pass: t => 'He sets up teammates ' + howVs(t.pass) + ' most ' + POS_PLURAL[t.pos - 1] + '.',
  run: t => 'He plays in transition ' + howVs(t.run) + ' most ' + POS_PLURAL[t.pos - 1] + (t.trEff > 0.08 ? ', and scores well when he does.' : t.trEff < -0.08 ? ', and does not score well when he does.' : '.'),
  orb: t => 'He grabs offensive rebounds ' + howVs(t.orb) + ' most ' + POS_PLURAL[t.pos - 1] + '.',
  stl: t => 'He gets his hands on the ball (steals) ' + howVs(t.stl) + ' most ' + POS_PLURAL[t.pos - 1] + '.',
  blk: t => 'He blocks shots ' + howVs(t.blk) + ' most ' + POS_PLURAL[t.pos - 1] + '.',
  fouls: t => 'He fouls ' + howVs(t.fouls) + ' most ' + POS_PLURAL[t.pos - 1] + '.',
  pull: t => (t.pull >= 0.3 ? 'Many of his threes are off the dribble.' : t.pull < 0.1 ? 'Almost all of his threes come off a pass.' : 'Some of his threes are off the dribble.')
};
/* each instruction's fit: a score (0.5 an average man of his position) and why, in sentences */
const FIT = {
  pas: t => [0.5 + 0.35 * (t.pass - 1) - 0.3 * (t.create - 0.35), [S.pass(t), S.create(t)]],
  agg: t => [0.35 + 0.9 * (t.create - 0.35) + 0.4 * (t.usg - 1) + 0.25 * (t.rim - 1) + 0.25 * (t.shoot - 1), [S.create(t)]],
  push: t => [0.45 + 0.35 * (t.run - 1) + 1.2 * t.trEff, [S.run(t)]],
  slow: t => [0.5 + 1.2 * (t.hcEff - t.trEff) + 0.15 * (1 - t.run), [t.hcEff - t.trEff > 0.05 ? 'He scores better in the half court than on the break.' : t.hcEff - t.trEff < -0.05 ? 'He scores better on the break than in the half court.' : 'He scores about as well in the half court as on the break.']],
  arc: t => [0.5 + 1.5 * (t.shoot - 1) + 0.9 * (t.pull - 0.12) + 0.1 * (t.vol3 - 1), [S.three(t), S.pull(t)]],
  dh: t => [0.5 + 0.9 * (t.rim - 1) + 0.25 * (t.volRim - 1) + 0.3 * (t.create - 0.35) + 0.08 * t.hands, [S.rim(t), S.create(t)]],
  kick: t => [0.5 + 0.45 * (t.pass - 1), [S.pass(t)]],
  dump: t => [0.5 + 0.45 * (t.pass - 1), [S.pass(t)]],
  hm: t => [0.35 + 0.8 * (t.create - 0.35) + 0.3 * (t.usg - 1) + 0.15 * (t.pass - 1), [S.create(t)]],
  hl: t => [0.5 - 0.6 * (t.create - 0.35) + 0.1, [S.create(t)]],
  spot: t => [0.5 + 0.9 * (t.shoot - 1) - 0.6 * (t.create - 0.35) + 0.2 * (t.vol3 - 1), [S.three(t), S.create(t)]],
  fin: t => [0.5 + 0.8 * (t.rim - 1) - 0.6 * (t.create - 0.35), [S.rim(t), S.create(t)]],
  cut: t => [0.5 + 0.9 * (t.rim - 1) - 0.3 * (t.shoot - 1), [S.rim(t)]],
  space: t => [0.5 + 1.4 * (t.shoot - 1) + 0.15 * (t.vol3 - 1), [S.three(t)]],
  /* GREEN LIGHT and RIP THROUGH, by what the shot is worth to HIM (Louie: "Thomas Hurley (a great shooter and solid
     slasher) should not be getting a more positive rip through colour vs green light"): the green light trades his
     mid-range (and some rim shots) for threes; ripping through trades an open catch-and-shoot three for a drive at a
     closing defender - worth it only where his drive is worth more than that three, which for a real shooter it is not */
  green: t => { const w = worth(t); return [0.5 + 1.5 * (w.three - (0.6 * w.inMid + 0.4 * w.atRim)) + 0.25 * (t.vol3 - 1), [S.three(t)]]; },
  rip: t => {
    const w = worth(t), drive = driveWorth(t, w);
    return [0.5 + 1.6 * (drive - w.catch3) + 0.25 * (t.create - 0.35), [S.three(t), S.rim(t), drive > w.catch3 + 0.04 ? 'Attacking the close-out is worth more to him than his open three.' : drive < w.catch3 - 0.04 ? 'His open three is the better shot: turning it down costs.' : 'Attacking the close-out and his open three are worth about the same to him.']];
  },
  crash: t => [0.5 + 0.45 * (t.orb - 1), [S.orb(t)]],
  roll: t => [0.5 + 0.9 * (t.rim - 1), [S.rim(t)]],
  pop: t => [0.5 + 1.5 * (t.shoot - 1) + 0.25 * (t.vol3 - 1), [S.three(t)]],
  short: t => [0.5 + 0.5 * (t.pass - 1) + 0.1 * t.hands, [S.pass(t)]],
  dive: t => [0.5 + 0.9 * (t.rim - 1), [S.rim(t)]],
  pm: t => [0.35 + 0.8 * (t.create - 0.35) + 0.5 * (t.rim - 1) + 0.2 * t.mid, [S.create(t), S.rim(t)]],
  pl: t => [0.5 - 0.5 * (t.create - 0.35), [S.create(t)]],
  nop: t => [0.55 - 0.6 * (t.create - 0.35), [S.create(t)]],
  gam: t => [0.45 + 0.45 * (t.stl - 1), [S.stl(t)]],
  sol: t => [0.55 - 0.2 * (t.stl - 1) + 0.15 * (1 - t.fouls), [S.fouls(t)]],
  rimp: t => [0.4 + 0.4 * (t.blk - 1) - 0.15 * (t.fouls - 1), [S.blk(t), S.fouls(t)]],
  hedge: t => [0.45 + 0.5 * (t.stl - 1) - 0.1 * (t.blk - 1), [S.stl(t) + ' (Quick hands and feet: what a hedge needs.)']],
  cont: t => [0.55, ['The usual coverage: it asks nothing special of him.']],
  drop: t => [0.45 + 0.35 * (t.blk - 1) + 0.08 * t.protect, [S.blk(t)]],
  rima: t => [0.4 + 0.4 * (t.blk - 1) - 0.15 * (t.fouls - 1), [S.blk(t), S.fouls(t)]],
  cons: t => [0.5 + 0.25 * (t.fouls - 1) - 0.1 * (t.blk - 1), [S.fouls(t)]]
};
const WORDS = [[0.7, 'Natural fit', 'a4'], [0.52, 'Good fit', 'a3'], [0.36, 'Workable', 'a2'], [-1, 'Poor fit', 'a1']];
/* -> {s 0..1, word, band, why: the sentences, joined} */
function fit(key, card, ref) {
  const f = FIT[key];
  if (!f || !card) return { s: 0.5, word: '', band: '', why: '' };
  const [raw, why] = f(traits(card, ref));
  const s = clamp(isNum(raw) ? raw : 0.5, 0, 1), w = WORDS.find(x => s >= x[0]);
  return { s, word: w[1], band: w[2], why: Array.isArray(why) ? why.join(' ') : why };
}

/* ------------------------------------------------------------------ for the engine --- */
/* the roster's entries -> Map id -> {u, k: Set} (engine.js sideOf X.ins). Every instruction he has goes: at each place
   the engine keeps to the ones his role there takes (a guard's at the point, a wing's or a big's at the four) */
function forEngine(entries, cardOf, slotOf) {
  const out = new Map();
  (entries || []).forEach(e => {
    if (!e || e.id == null) return;
    const id = String(e.id), c = cardOf ? cardOf(id) : null, role = roleOf(c, slotOf ? slotOf(id) : null), n = norm(e, '*');
    if (n.u || n.keys.length) out.set(id, { u: n.u, k: new Set(n.keys), role });
  });
  return out;
}
const keyOf = ins => (ins && ins.size ? [...ins.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, x]) => id + ':' + x.u + ':' + [...x.k].sort().join('.')).join('|') : '');

return { LIST, BY, SEC, ROLE, U_MAX, roleOf, list, norm, toggle, traits, fit, forEngine, keyOf, WORDS };
}));
