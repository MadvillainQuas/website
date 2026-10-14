'use strict';
/* ============================================================================
   MANAGER - PLAYER ROLES BY POSITION (core: no site, no DOM).                                   window.Mgr.roles

   Louie, 2026-10-14: "For each position set (PG, SG etc.) on the tactics screen, can it actually set the player as that,
   and force the user to select their role ... which then alters their style/what they're looking to do in that spot
   rather than just simply being a generic set of instructions applied (which then has an affect on the engine lineup
   wide and how they all play - similar to player roles in football manager)". And: "use basketball logic alongside the
   what wins model - i.e. a certain amount of downhill pressure is needed in order to generate good 3pt looks"; on-ball
   and off-ball play types, true usage: "a passer can have a lot of pnr plays run through them despite not having a
   'high usage' or a heavy usage player like Steph Curry can actually have low actual on-ball time".

   A ROLE IS A PLAY-TYPE DIET, as a scouting service tracks a player's possessions: what share of the plays he finishes
   come from each kind of play (PT below) - on the ball (the pick-and-roll as its handler, isolations, post-ups,
   handoffs, pushing in transition) or off it (spot-ups, coming off screens, cuts, the roll, the pop, the short roll,
   put-backs) - and three loads that are not the same thing:
     init   HOW MUCH OF THE OFFENCE HE STARTS: his share of the five's on-ball time. A pass-first point guard starts
            most possessions and ends few; a movement shooter ends many and starts almost none. One ball: a five's
            init adds up to about one, and roles that ask for more than there is take it from each other (engine.js);
     use    how many of the plays he ENDS himself (shots, trips, turnovers): his scoring usage, on the usage dial's scale;
     pass   how much he looks to set others up (his assists: true usage = the plays he ends + the shots he creates).
   And what he does for the others: screen (the screens he sets: a pick-and-roll and an off-screen shooter need them),
   crash (the glass), run (transition), def (a 3-and-D player's effort at the other end), hub (a connector: the extra
   pass, the handoff).
   Each kind of play's own shots (where they come from, how many off a pass, how often it turns over or draws a foul,
   how hard it pushes the defence into the paint) are PT's: a diet is turned into a shot mix, a share of his own
   creation, a turnover and a foul rate, the pressure he puts on the rim and where he stands. engine.js plays them -
   against his own numbers (a shooting role for a man who cannot shoot costs him at his own rates) and against the four
   men beside him.

     ROLES / BY / forSlot(k)             the roles, by key, of a position (0 PG .. 4 C)
     profile(role)                       what the diet adds up to: {mix, un, on, tov, ft, press, perim, paint}
     resolve(key, k, card, ref)          the role a man plays at position k: the one chosen, else the position's
                                         default (PG: Mixed PG, SG: Combo Mixed SG, SF/PF/C: the role that suits him best)
     fit(role, card, ref)                how well he suits it: {s 0..1, stars, word, band, why: [plain sentences]}
     locks(role)                         the player instructions the role rules out (and why)
     family(role)                        the player instructions it uses: g (guard), w (wing), b (big)
     demo(role)                          the scenes its demonstration plays (views/ui.js draws them)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.roles = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const CARDS = () => (root.Mgr && root.Mgr.cards) || (typeof require === 'function' ? require('./cards.js') : null);
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const POS_PLURAL = ['point guards', 'shooting guards', 'small forwards', 'power forwards', 'centres'];

/* ------------------------------------------------------------------ the kinds of play --- */
/* each: on (how much of it is on the ball: his own time with it), mix (where its shots come from: rim, the other twos,
   three), un (the share of its makes off no pass), tov and ft (its turnovers and its trips to the line against an
   average play), press (how hard it pushes the defence into the paint: the drive, the roll, the post-up, the cut), perim
   (how much of it he spends out on the arc, where a shooter spaces the floor), ppp (the points a play the league
   credits it with - the order of what is efficient: a cut and a roll near the top, an isolation and a handler's
   pick-and-roll near the bottom; the engine never adds them, a man scores at his own rates).
   MEASURED (docs/manager-mode.md, Roles): a professional league's every play by type over four seasons - its share of
   threes and of shots at the rim, its turnovers and trips per play against the average play's (the plays before any
   action left out), its assisted makes; a European league's hand-coded season gives the same order. The pop and the
   roll are counted together there (about three in ten of the screeners' shots are popped threes): split here. The
   short roll is not counted anywhere: between a roll and a handoff. */
const PT = {
  pnr:   { label: 'Pick-and-roll ball handler', on: 1.0, mix: [0.22, 0.48, 0.30], un: 0.95, tov: 1.59, ft: 0.96, press: 1.00, perim: 0.55, ppp: 0.90 },
  iso:   { label: 'Isolation', on: 1.0, mix: [0.18, 0.57, 0.25], un: 0.96, tov: 1.03, ft: 1.29, press: 0.75, perim: 0.60, ppp: 0.92 },
  post:  { label: 'Post-up', on: 0.9, mix: [0.31, 0.69, 0.00], un: 0.80, tov: 1.35, ft: 1.60, press: 0.80, perim: 0.00, ppp: 0.98 },
  dho:   { label: 'Handoffs', on: 0.6, mix: [0.11, 0.445, 0.445], un: 0.30, tov: 1.12, ft: 0.81, press: 0.55, perim: 0.80, ppp: 0.93 },
  tr:    { label: 'Transition', on: 0.5, mix: [0.475, 0.11, 0.415], un: 0.20, tov: 1.25, ft: 1.27, press: 0.60, perim: 0.40, ppp: 1.13 },
  spot:  { label: 'Spot-ups', on: 0.0, mix: [0.06, 0.20, 0.74], un: 0.08, tov: 0.58, ft: 0.47, press: 0.10, perim: 1.00, ppp: 1.04 },
  offs:  { label: 'Off screens', on: 0.1, mix: [0.06, 0.40, 0.54], un: 0.12, tov: 0.79, ft: 0.66, press: 0.20, perim: 0.90, ppp: 0.98 },
  cut:   { label: 'Cuts', on: 0.0, mix: [0.78, 0.22, 0.00], un: 0.05, tov: 0.62, ft: 1.46, press: 0.40, perim: 0.00, ppp: 1.30 },
  roll:  { label: 'Roll man', on: 0.0, mix: [0.62, 0.36, 0.02], un: 0.10, tov: 0.74, ft: 1.45, press: 0.85, perim: 0.00, ppp: 1.15 },
  pop:   { label: 'Pick-and-pop', on: 0.0, mix: [0.05, 0.17, 0.78], un: 0.05, tov: 0.55, ft: 0.40, press: 0.15, perim: 1.00, ppp: 1.08 },
  short: { label: 'Short roll', on: 0.3, mix: [0.40, 0.58, 0.02], un: 0.40, tov: 1.15, ft: 1.00, press: 0.60, perim: 0.10, ppp: 1.00 },
  put:   { label: 'Put-backs', on: 0.0, mix: [0.77, 0.20, 0.03], un: 1.00, tov: 0.79, ft: 1.24, press: 0.30, perim: 0.00, ppp: 1.11 }
};
const PTK = Object.keys(PT);
/* the on-ball kinds of play a role's shooting style bends (a slasher's pick-and-roll ends at the rim, a shooter's in a
   pull-up three); the off-ball ones are what they are */
const STYLED = new Set(['pnr', 'iso', 'dho', 'tr', 'short']);
/* a rip-through attacks the close-out: a spot-up that ends at the rim as often as it ends in a three */
const RIP_SPOT = [0.40, 0.16, 0.44];

/* ------------------------------------------------------------------ the roles --- */
/* R(key, slot, label, family, diet, o, desc, scenes): o = {init, use, pass, screen, crash, run, def, hub, rip, st (the
   shooting style of his on-ball plays: rim, mid, three multipliers), rho (how far the role moves his shots from his own
   game: a generic role a little, a specialist's a lot), gen (a general role: his on-ball time, his scoring and his
   passing stay his own, and his instructions shape it)} */
const ROLES = [], BY = new Map();
const S_RIM = { rim: 1.6, mid: 1.05, three: 0.5 }, S_3 = { rim: 0.6, mid: 1.2, three: 1.6 }, S_MID = { rim: 0.85, mid: 1.4, three: 1.05 }, S_MIX = { rim: 1.1, mid: 1.1, three: 1.1 };
function R(key, slot, label, family, diet, o, desc, scenes) {
  const t = PTK.reduce((a, k) => a + (diet[k] || 0), 0) || 1, d = {};
  PTK.forEach(k => { if (diet[k]) d[k] = diet[k] / t; });
  const r = Object.assign({ key, slot, label, family, diet: d, desc, scenes: scenes || [] },
    { init: 0, use: 0, pass: 0, screen: 0, crash: 0, run: 0, def: 0, hub: 0, rip: 0, st: null, rho: 0.5 }, o);
  r.short = label.replace(/\s+(PG|SG|SF|PF|C)$/, '');
  ROLES.push(r); BY.set(key, r);
  return r;
}
/* THE NUMBERS (docs/manager-mode.md, Roles, for the sources): each diet is the measured play-type mix of the archetype
   nearest the role (a league's tracked players grouped by role, 2025-26), moved toward what the role's description asks;
   init is the archetype's time on the ball as a share of a five's (a primary ball handler about 22% of his minutes, a
   median rotation player 8%, a rim runner 5%: shares of a five's 57% that adds to); use and pass place it on the
   archetype's usage and assist rate against its position's. */
/* ---- POINT GUARDS ---- */
R('pg-passspace', 0, 'Pass + Space PG', 'g', { pnr: 0.30, spot: 0.30, tr: 0.15, dho: 0.08, cut: 0.05, iso: 0.04, offs: 0.06, put: 0.02 }, { init: 0.30, use: -0.45, pass: 0.65, st: S_3 },
  'A pass-first point guard who starts the offence, then gets off the ball: relocates for spot-up threes, spaces the floor for others and attacks off the catch rather than living on the dribble.', ['pnr-kick', 'relocate']);
R('pg-slashpass', 0, 'Slashing Passer PG', 'g', { pnr: 0.42, iso: 0.10, tr: 0.20, dho: 0.05, spot: 0.12, cut: 0.07, put: 0.04 }, { init: 0.39, use: 0, pass: 0.7, st: { rim: 1.5, mid: 1.25, three: 0.5 } },
  'On the ball and downhill: attacks the paint to create for others - the dump-off, the kick-out - and finishes at the rim or in the mid-range when the defence gives it to him.', ['pnr-dump', 'pnr-drive']);
R('pg-euro', 0, 'Euro PG', 'g', { pnr: 0.45, iso: 0.05, dho: 0.07, tr: 0.15, spot: 0.22, offs: 0.03, cut: 0.03 }, { init: 0.45, use: -0.1, pass: 0.8, st: S_MID },
  'A pass-first point guard with the ball in his hands: more penetrating than a pass-and-space guard, but probing for the pull-up in the mid-range or from three rather than living at the rim.', ['pnr-pullmid', 'pnr-kick']);
R('pg-mixed', 0, 'Mixed PG', 'g', { pnr: 0.36, iso: 0.12, dho: 0.06, tr: 0.18, spot: 0.17, offs: 0.04, cut: 0.04, post: 0.01, put: 0.02 }, { init: 0.36, use: 0, pass: 0.2, rho: 0.25, gen: true },
  'A point guard who both passes and scores, as the play asks: the general role, which his own instructions shape the most.', ['pnr-kick', 'pnr-drive']);
R('pg-shoot', 0, 'Pure Shooting PG', 'g', { pnr: 0.27, iso: 0.12, dho: 0.13, tr: 0.14, spot: 0.12, offs: 0.14, cut: 0.05, post: 0.02, put: 0.01 }, { init: 0.33, use: 0.6, pass: -0.1, st: S_3 },
  'A scoring point guard who pulls up from distance whenever he gets space behind the arc, works his defender for mid-range looks, relocates into deep shots and plays two-man games with his bigs (gets and handoffs). His playmaking comes second.', ['pnr-pull3', 'dho-shoot']);
R('pg-slash', 0, 'Pure Slashing PG', 'g', { pnr: 0.36, iso: 0.14, tr: 0.24, cut: 0.08, spot: 0.10, dho: 0.04, put: 0.04 }, { init: 0.38, use: 0.6, pass: -0.1, run: 0.5, st: S_RIM },
  'A slashing scorer who drives downhill at speed: he can hit a dump-off or kick out to a shooter, but he is mostly looking to finish.', ['pnr-drive', 'trans-push']);
R('pg-mixscore', 0, 'Mixed Scoring PG', 'g', { pnr: 0.31, iso: 0.25, post: 0.04, dho: 0.04, tr: 0.14, spot: 0.12, offs: 0.05, cut: 0.03, put: 0.02 }, { init: 0.40, use: 0.7, pass: 0, st: S_MIX },
  'A three-level scorer who uses his threat from deep to open the way to the basket, and fills in as the playmaker when he is needed.', ['pnr-pull3', 'pnr-drive']);
/* ---- SHOOTING GUARDS ---- */
R('sg-combospacepass', 1, 'Combo Spacing Passing SG', 'g', { pnr: 0.24, spot: 0.28, dho: 0.08, offs: 0.06, tr: 0.18, cut: 0.06, iso: 0.06, put: 0.04 }, { init: 0.26, use: -0.2, pass: 0.45, st: S_3 },
  'A combo guard who shares the ball-handling with the point guard: spaces the floor off the ball, and on it looks to pass rather than to get deep into the paint.', ['relocate', 'pnr-kick']);
R('sg-comboslashpass', 1, 'Combo Slashing Passing SG', 'g', { pnr: 0.26, iso: 0.08, cut: 0.10, spot: 0.18, dho: 0.06, tr: 0.20, put: 0.04, offs: 0.03, post: 0.05 }, { init: 0.27, use: 0, pass: 0.45, rip: 1, st: S_RIM },
  'A combo guard who shares the ball-handling: slashes downhill on the ball with a passer’s eye, finishing at the rim or from mid-range when it is there, and off the ball rips through the close-out to score or pass.', ['pnr-dump', 'rip']);
R('sg-combomixed', 1, 'Combo Mixed SG', 'g', { pnr: 0.26, iso: 0.12, dho: 0.07, tr: 0.18, spot: 0.23, offs: 0.06, cut: 0.04, put: 0.02, post: 0.02 }, { init: 0.26, use: 0.1, pass: 0.1, rho: 0.25, gen: true },
  'The general combo guard: mixes scoring with playmaking when the ball is in his hands.', ['pnr-pull3', 'relocate']);
R('sg-comboslashscore', 1, 'Combo Slashing Scoring SG', 'g', { pnr: 0.24, iso: 0.16, cut: 0.12, spot: 0.12, tr: 0.22, dho: 0.06, put: 0.05, post: 0.03 }, { init: 0.27, use: 0.6, pass: -0.2, rip: 1, st: S_RIM },
  'Less of a floor spacer: rips through off the ball to get to the rim, and on the ball gets downhill to score, while sharing the ball-handling.', ['rip', 'pnr-drive']);
R('sg-comboshootscore', 1, 'Combo Shooting Scoring SG', 'g', { pnr: 0.24, dho: 0.12, offs: 0.10, spot: 0.24, iso: 0.10, tr: 0.17, cut: 0.03 }, { init: 0.26, use: 0.6, pass: -0.1, st: S_3 },
  'A floor spacer who scores on the ball too: smart two-man play with the bigs (gets, handoffs), pulling up from deep, while sharing the ball-handling.', ['dho-shoot', 'pnr-pull3']);
R('sg-comboiso', 1, 'Combo Iso Scoring SG', 'g', { iso: 0.28, pnr: 0.26, spot: 0.12, tr: 0.15, dho: 0.06, offs: 0.05, post: 0.04, cut: 0.02, put: 0.02 }, { init: 0.36, use: 0.8, pass: -0.3, st: S_MID },
  'A pure scorer who shakes his defender on the ball to get to his own shot off the dribble, rather than being a catch-and-shoot shooter.', ['iso-step', 'iso-drive']);
R('sg-moveshoot', 1, 'Movement Shooting SG', 'g', { offs: 0.30, spot: 0.30, tr: 0.17, dho: 0.12, pnr: 0.06, cut: 0.04, put: 0.01 }, { init: 0.11, use: 0.3, pass: -0.2 },
  'Very little ball-handling: runs off screens to pull up from deep (mostly) or curls into the mid-range. Mostly a floor spacer, and a scorer without the ball.', ['offscreen-3', 'offscreen-curl']);
R('sg-secslash', 1, 'Secondary BH Slashing SG', 'g', { pnr: 0.24, cut: 0.14, spot: 0.22, tr: 0.18, dho: 0.07, iso: 0.08, put: 0.04, offs: 0.03 }, { init: 0.24, use: 0.1, pass: 0.15, rip: 1, st: S_RIM },
  'Takes the ball in the half-court pick-and-roll once the point guard has started the play, threatening downhill to finish at the rim or kick out. Cuts often.', ['pnr-drive', 'cut']);
R('sg-secshoot', 1, 'Secondary BH Shooting SG', 'g', { pnr: 0.24, spot: 0.28, offs: 0.10, dho: 0.08, tr: 0.17, iso: 0.06, cut: 0.04, put: 0.03 }, { init: 0.23, use: 0.15, pass: 0.1, st: S_3 },
  'Takes the ball in the half-court pick-and-roll once the point guard has started the play: shoots behind the screen, hits the screener, or makes a mid-range or three off the dribble. Otherwise spaces the floor or comes off screens.', ['pnr-pull3', 'relocate']);
R('sg-offscreen', 1, 'Off-Screens Scoring SG', 'g', { offs: 0.26, spot: 0.18, iso: 0.14, dho: 0.12, pnr: 0.12, tr: 0.14, cut: 0.04 }, { init: 0.18, use: 0.6, pass: -0.2, st: S_MID },
  'A smart operator off screens: shoots the three or curls into the rim or the mid-range. More on-ball reps than a movement shooter, with isolations of his own.', ['offscreen-curl', 'offscreen-3']);
R('sg-3d', 1, '3&D SG', 'g', { spot: 0.55, tr: 0.20, cut: 0.07, pnr: 0.06, offs: 0.04, dho: 0.03, put: 0.05 }, { init: 0.12, use: -0.6, pass: -0.2, def: 1 },
  'A low-usage guard tasked with spot-up threes and good defence.', ['spot-3', 'defend']);
R('sg-offslash', 1, 'Off-Ball Slashing SG', 'g', { spot: 0.30, cut: 0.25, tr: 0.22, put: 0.10, offs: 0.05, dho: 0.04, iso: 0.04 }, { init: 0.13, use: 0.2, pass: -0.1, rip: 1 },
  'Attacks without the ball: rips through, attacks off the catch to the rim, or shoots the three.', ['rip', 'cut']);
/* ---- SMALL FORWARDS ---- */
R('sf-slashpoint', 2, 'Slashing Point SF', 'w', { pnr: 0.20, iso: 0.12, post: 0.06, cut: 0.10, spot: 0.14, tr: 0.24, dho: 0.06, put: 0.05, offs: 0.03 }, { init: 0.26, use: 0.3, pass: 0.35, rip: 1, st: S_RIM },
  'A forward who shares the ball-handling with the point guard, like a combo guard: slashes downhill to drive and kick or finish at the rim, and rips through off the ball.', ['pnr-drive', 'rip']);
R('sf-shootpoint', 2, 'Shooting Point SF', 'w', { pnr: 0.20, spot: 0.28, dho: 0.08, offs: 0.08, tr: 0.20, iso: 0.08, cut: 0.05, post: 0.03 }, { init: 0.25, use: -0.1, pass: 0.45, st: S_3 },
  'A forward who shares the ball-handling: spaces the floor off the ball and on it looks to pass rather than to get deep into the paint.', ['relocate', 'pnr-kick']);
R('sf-secshoot', 2, 'Secondary BH Shooting SF', 'w', { spot: 0.36, pnr: 0.12, offs: 0.10, dho: 0.08, tr: 0.20, cut: 0.06, iso: 0.05, put: 0.03 }, { init: 0.19, use: 0, pass: 0.15, st: S_3 },
  'A floor-spacing forward who sometimes takes the half-court pick-and-roll after the point guard starts it: a quick look from deep, or a quick pass to the screener.', ['spot-3', 'pnr-pull3']);
R('sf-secslash', 2, 'Secondary BH Slashing SF', 'w', { cut: 0.16, spot: 0.18, pnr: 0.15, tr: 0.22, iso: 0.10, dho: 0.07, put: 0.07, post: 0.05 }, { init: 0.20, use: 0.2, pass: 0.15, rip: 1, st: S_RIM },
  'A slashing, cutting forward who, given the ball in the pick-and-roll, gets to the rim to finish or drives and kicks as the second option.', ['cut', 'pnr-drive']);
R('sf-iso', 2, 'Iso Scoring SF', 'w', { iso: 0.26, pnr: 0.18, post: 0.08, dho: 0.06, tr: 0.15, spot: 0.14, offs: 0.08, cut: 0.03, put: 0.02 }, { init: 0.30, use: 0.9, pass: -0.3, st: { rim: 1.05, mid: 1.35, three: 1.0 } },
  'Carries the individual scoring: asked to create points one-on-one in space rather than being handed the pick-and-roll or the playmaking.', ['iso-step', 'iso-drive']);
R('sf-moveshoot', 2, 'Movement Shooting SF', 'w', { offs: 0.28, spot: 0.32, tr: 0.18, dho: 0.12, pnr: 0.05, cut: 0.04, put: 0.01 }, { init: 0.11, use: 0.3, pass: -0.2 },
  'Very little ball-handling: runs off screens to pull up from deep (mostly) or curls into the mid-range. Mostly a floor spacer.', ['offscreen-3', 'offscreen-curl']);
R('sf-3d', 2, '3&D SF', 'w', { spot: 0.55, tr: 0.20, cut: 0.08, pnr: 0.05, offs: 0.04, dho: 0.03, put: 0.05 }, { init: 0.12, use: -0.6, pass: -0.2, def: 1 },
  'Little to no ball-handling: spot-up threes and good defence.', ['spot-3', 'defend']);
R('sf-dualthreat', 2, 'Dual Threat Off-Ball SF', 'w', { spot: 0.38, cut: 0.14, tr: 0.22, offs: 0.08, iso: 0.06, put: 0.07, dho: 0.03, pnr: 0.02 }, { init: 0.13, use: 0.1, pass: 0, rip: 1, rho: 0.35 },
  'Little to no ball-handling, but aggressive: rips through the close-out or takes the spot-up three, and now and then attacks in open space.', ['rip', 'spot-3']);
R('sf-slashoff', 2, 'Slashing Off-Ball SF', 'w', { cut: 0.25, spot: 0.22, tr: 0.25, put: 0.12, iso: 0.06, dho: 0.04, offs: 0.03, pnr: 0.03 }, { init: 0.13, use: 0.2, pass: -0.1, rip: 1, run: 0.4 },
  'Little to no ball-handling, but aggressive: rips through and cuts.', ['cut', 'rip']);
R('sf-cuthustle', 2, 'Cuts & Hustle SF', 'w', { cut: 0.26, put: 0.18, spot: 0.24, tr: 0.20, roll: 0.05, post: 0.02, pnr: 0.02, dho: 0.03 }, { init: 0.11, use: -0.3, pass: -0.1, crash: 1, screen: 0.4 },
  'Little to no ball-handling, and less aggressive attacking the close-out: lives off cuts and the offensive glass, and sets screens as an extra big.', ['cut', 'crash']);
R('sf-hub', 2, 'Connective Passing Hub SF', 'w', { spot: 0.32, cut: 0.14, tr: 0.22, short: 0.05, dho: 0.08, offs: 0.04, pnr: 0.07, put: 0.05, iso: 0.03 }, { init: 0.18, use: -0.4, pass: 0.8, screen: 0.4, hub: 1 },
  'Little to no ball-handling, but the connector: on the wing or as an extra screener he moves the ball - finding cutters, making the extra pass around the arc.', ['hub-pass', 'relocate']);
/* ---- POWER FORWARDS ---- */
R('pf-slashpoint', 3, 'Slashing Point PF', 'w', { pnr: 0.16, iso: 0.12, post: 0.11, cut: 0.08, spot: 0.13, tr: 0.23, dho: 0.04, put: 0.06, roll: 0.04, offs: 0.03 }, { init: 0.26, use: 0.3, pass: 0.35, rip: 1, st: S_RIM },
  'A forward who shares the ball-handling with the point guard: slashes downhill to drive and kick or finish at the rim, and rips through off the ball.', ['pnr-drive', 'rip']);
R('pf-shootpoint', 3, 'Shooting Point PF', 'w', { pnr: 0.18, spot: 0.28, dho: 0.08, offs: 0.06, tr: 0.20, iso: 0.08, post: 0.05, cut: 0.04, pop: 0.03 }, { init: 0.24, use: -0.1, pass: 0.45, st: S_3 },
  'A forward who shares the ball-handling: spaces the floor off the ball and on it looks to pass rather than to get deep into the paint.', ['relocate', 'pnr-kick']);
R('pf-secshoot', 3, 'Secondary BH Shooting PF', 'w', { spot: 0.34, pnr: 0.10, offs: 0.06, pop: 0.12, dho: 0.08, tr: 0.18, cut: 0.05, put: 0.04, post: 0.03 }, { init: 0.17, use: 0, pass: 0.15, screen: 0.3, st: S_3 },
  'A floor-spacing forward who sometimes takes the half-court pick-and-roll after the point guard starts it: a quick look from deep, or a quick pass to the screener.', ['spot-3', 'pop']);
R('pf-secslash', 3, 'Secondary BH Slashing PF', 'w', { cut: 0.18, spot: 0.14, pnr: 0.14, tr: 0.20, iso: 0.10, put: 0.12, post: 0.06, roll: 0.04, dho: 0.02 }, { init: 0.18, use: 0.2, pass: 0.15, rip: 1, st: S_RIM },
  'A slashing, cutting forward who, given the ball in the pick-and-roll, gets to the rim to finish or drives and kicks as the second option.', ['cut', 'pnr-drive']);
R('pf-iso', 3, 'Iso Scoring PF', 'w', { iso: 0.22, post: 0.20, pop: 0.08, roll: 0.05, spot: 0.14, tr: 0.14, pnr: 0.08, put: 0.06, cut: 0.03 }, { init: 0.29, use: 0.9, pass: -0.3, screen: 0.3, st: S_MID },
  'Carries the individual scoring: creates one-on-one, sometimes in the post or after setting a screen, sometimes out on the perimeter, rather than being handed the pick-and-roll or the playmaking.', ['post-score', 'iso-drive']);
R('pf-moveshoot', 3, 'Movement Shooting PF', 'w', { offs: 0.25, spot: 0.32, pop: 0.10, tr: 0.16, dho: 0.10, cut: 0.05, put: 0.02 }, { init: 0.10, use: 0.3, pass: -0.2, screen: 0.2 },
  'Very little ball-handling: runs off screens to pull up from deep or curls into the mid-range. Mostly a floor spacer.', ['offscreen-3', 'pop']);
R('pf-3d', 3, '3&D PF', 'w', { spot: 0.48, pop: 0.12, cut: 0.08, tr: 0.18, put: 0.08, pnr: 0.03, post: 0.03 }, { init: 0.11, use: -0.5, pass: -0.2, screen: 0.5, def: 1 },
  'Little to no ball-handling: spot-up threes, screens and good defence.', ['spot-3', 'pop']);
R('pf-cuthustle', 3, 'Cuts & Hustle PF', 'w', { cut: 0.26, put: 0.22, roll: 0.14, spot: 0.12, tr: 0.20, post: 0.04, pop: 0.02 }, { init: 0.10, use: -0.3, pass: -0.1, crash: 1, screen: 0.6 },
  'Little to no ball-handling: lives off cuts and attacking the offensive glass.', ['cut', 'crash']);
R('pf-hub', 3, 'Connective Passing Hub PF', 'w', { spot: 0.28, cut: 0.14, short: 0.12, dho: 0.10, put: 0.07, tr: 0.20, post: 0.04, pnr: 0.05 }, { init: 0.18, use: -0.4, pass: 0.8, screen: 0.5, hub: 1 },
  'Little to no ball-handling, but the connector: moves the ball to cutters and makes the extra pass around the arc.', ['hub-pass', 'short-pass']);
R('pf-dualspot', 3, 'Dual-Big Spot-Up PF', 'b', { pop: 0.30, spot: 0.32, post: 0.10, put: 0.05, tr: 0.12, cut: 0.06, iso: 0.02, dho: 0.03 }, { init: 0.09, use: 0, pass: 0, screen: 0.8 },
  'The stretch four in a two-big lineup: screens and pops, spots up for catch-and-shoot threes, and now and then takes his man into the post.', ['pop', 'spot-3']);
R('pf-dualthreat', 3, 'Dual-Big Dual Threat PF', 'b', { pop: 0.22, spot: 0.22, post: 0.12, roll: 0.10, iso: 0.06, put: 0.07, tr: 0.14, cut: 0.07 }, { init: 0.12, use: 0.3, pass: 0, screen: 0.7, rip: 1 },
  'The stretch four in a two-big lineup who screens and pops, then shoots the three or attacks downhill; spots up to shoot or slash, or plays out of the post.', ['pop', 'rip']);
R('pf-dualpost', 3, 'Dual-Big Post PF', 'b', { post: 0.38, put: 0.14, roll: 0.12, spot: 0.06, cut: 0.13, iso: 0.06, tr: 0.06, dho: 0.02, pop: 0.03 }, { init: 0.18, use: 0.5, pass: 0, screen: 0.5 },
  'Lives on post touches: attacks out of the post rather than stretching the floor.', ['post-score', 'crash']);
R('pf-dualroll', 3, 'Dual-Big Roller PF', 'b', { roll: 0.30, cut: 0.26, put: 0.18, tr: 0.12, post: 0.06, spot: 0.04, pop: 0.04 }, { init: 0.09, use: -0.2, pass: -0.1, screen: 0.9, crash: 0.6 },
  'A finisher with few post touches and plenty of screens: rolls hard to the rim to finish rather than stretching the floor.', ['roll', 'crash']);
R('pf-playslash', 3, 'Playmaking Slashing PF', 'w', { dho: 0.16, pnr: 0.12, iso: 0.10, cut: 0.10, spot: 0.14, tr: 0.16, short: 0.12, post: 0.05, put: 0.05 }, { init: 0.22, use: 0.2, pass: 0.55, screen: 0.3, hub: 1, st: S_RIM },
  'Handles the ball on the perimeter for handoffs and the like: finds cutters, or slashes downhill for shots at the rim.', ['dho-give', 'iso-drive']);
/* ---- CENTRES ---- */
R('c-spot', 4, 'Spot-Up C', 'b', { pop: 0.34, spot: 0.30, post: 0.10, put: 0.05, tr: 0.12, cut: 0.06, iso: 0.02, dho: 0.01 }, { init: 0.09, use: 0, pass: 0, screen: 0.9 },
  'Screens and pops, spots up for catch-and-shoot threes, and now and then takes his man into the post.', ['pop', 'spot-3']);
R('c-dualpnp', 4, 'Dual Threat PNP C', 'b', { pop: 0.24, roll: 0.14, spot: 0.18, post: 0.12, put: 0.08, iso: 0.05, tr: 0.12, cut: 0.07 }, { init: 0.11, use: 0.3, pass: 0, screen: 0.9, rip: 1 },
  'Screens and pops to shoot the three or attack downhill, and sometimes rolls to the rim; spots up to shoot or slash, or plays out of the post.', ['pop', 'roll']);
R('c-slashpnp', 4, 'Slashing PNP C', 'b', { pop: 0.22, spot: 0.14, roll: 0.14, put: 0.12, post: 0.08, iso: 0.10, tr: 0.12, cut: 0.08 }, { init: 0.12, use: 0.3, pass: 0, screen: 0.9, rip: 1, st: S_RIM },
  'Pops out after the screen, then slashes downhill off the catch rather than threatening as a shooter.', ['pop', 'rip']);
R('c-post', 4, 'Post C', 'b', { post: 0.30, roll: 0.20, put: 0.15, cut: 0.14, iso: 0.06, spot: 0.06, tr: 0.06, dho: 0.03 }, { init: 0.18, use: 0.6, pass: -0.1, screen: 0.6 },
  'Lives on post touches: attacks out of the post rather than screening hard or rolling - most of his screens become post possessions.', ['post-score', 'crash']);
R('c-postplay', 4, 'Post Playmaker C', 'b', { post: 0.24, dho: 0.08, roll: 0.16, put: 0.10, cut: 0.12, iso: 0.06, spot: 0.10, tr: 0.10, short: 0.04 }, { init: 0.22, use: 0.1, pass: 0.7, screen: 0.6, hub: 1 },
  'Lives on post touches, but to pass as much as to score: his screens become post possessions where he scores or finds the cutter and the open shooter.', ['post-pass', 'post-score']);
R('c-roller', 4, 'Rim Roller C', 'b', { roll: 0.35, cut: 0.30, put: 0.20, tr: 0.10, post: 0.05 }, { init: 0.09, use: -0.5, pass: -0.1, screen: 1, crash: 0.6 },
  'Few touches: sets the screen and rolls to the rim to finish.', ['roll', 'crash']);
R('c-shortplay', 4, 'Short Roll Playmaking C', 'b', { short: 0.35, roll: 0.15, put: 0.10, cut: 0.12, spot: 0.14, tr: 0.10, pop: 0.04 }, { init: 0.16, use: -0.2, pass: 0.7, screen: 1, hub: 1 },
  'Plays out of the short roll rather than diving to the rim: quick passes out to shooters or to backdoor cutters, a floater, or a dribble to finish as the last option.', ['short-pass', 'roll']);
R('c-shortattack', 4, 'Short Roll Attacking C', 'b', { short: 0.35, roll: 0.22, put: 0.14, cut: 0.12, post: 0.05, tr: 0.08, spot: 0.04 }, { init: 0.14, use: 0.3, pass: 0.1, screen: 1, st: { rim: 1.35, mid: 1.15, three: 0.3 } },
  'Plays out of the short roll, but to attack: downhill toward the rim from the short roll rather than passing, or the mid-range shot.', ['short-attack', 'roll']);
R('c-playslash', 4, 'Playmaking Slashing C', 'b', { dho: 0.14, iso: 0.10, short: 0.15, roll: 0.10, cut: 0.10, put: 0.10, spot: 0.12, tr: 0.10, post: 0.05, pnr: 0.04 }, { init: 0.22, use: 0.2, pass: 0.6, screen: 0.6, hub: 1, st: S_RIM },
  'Handles the ball on the perimeter for handoffs: finds the cutters, or slashes downhill for shots at the rim.', ['dho-give', 'iso-drive']);
R('c-playscreen', 4, 'Playmaking Screener C', 'b', { roll: 0.22, short: 0.20, cut: 0.15, put: 0.12, dho: 0.12, spot: 0.08, tr: 0.08, post: 0.03 }, { init: 0.20, use: 0, pass: 0.6, screen: 1, hub: 1 },
  'Handles the ball on the perimeter for handoffs: finds the cutters, or slips and screens and rolls to the rim for assisted looks.', ['dho-give', 'roll']);

const forSlot = k => ROLES.filter(r => r.slot === k);
const DEFAULT = { 0: 'pg-mixed', 1: 'sg-combomixed' };

/* ------------------------------------------------------------------ what a diet adds up to --- */
const PROF = new Map();
function profile(role) {
  const r = typeof role === 'string' ? BY.get(role) : role;
  if (!r) return null;
  if (PROF.has(r.key)) return PROF.get(r.key);
  const st = r.st || { rim: 1, mid: 1, three: 1 };
  const mix = { rim: 0, mid: 0, three: 0 }, made = { rim: 0, mid: 0, three: 0 };
  /* how hard an on-ball play leans on the rim goes with its style: a slasher's pick-and-roll more than a pull-up shooter's */
  const lean = clamp(0.4 + 0.6 * st.rim, 0.5, 1.4);
  let on = 0, tov = 0, ft = 0, press = 0, perim = 0, onW = 0, onP = 0;
  Object.keys(r.diet).forEach(k => {
    const w = r.diet[k], p = PT[k];
    let m = (k === 'spot' && r.rip ? RIP_SPOT : p.mix).slice();
    if (STYLED.has(k)) { m = [m[0] * st.rim, m[1] * st.mid, m[2] * st.three]; const t = m[0] + m[1] + m[2]; m = m.map(v => v / t); }
    ['rim', 'mid', 'three'].forEach((z, i) => { mix[z] += w * m[i]; made[z] += w * m[i] * (k === 'spot' && r.rip && z !== 'three' ? 0.6 : p.un); });
    const pr = p.press * (k === 'spot' && r.rip ? 2.5 : 1) * (STYLED.has(k) ? lean : 1);
    on += w * p.on; tov += w * p.tov; ft += w * p.ft; press += w * pr; perim += w * p.perim;
    onW += w * p.on; onP += w * p.on * pr;
  });
  const un = {}; ['rim', 'mid', 'three'].forEach(z => { un[z] = mix[z] > 1e-6 ? clamp(made[z] / mix[z], 0.02, 0.97) : 0.3; });
  const paint = (r.diet.cut || 0) + (r.diet.roll || 0) + (r.diet.post || 0) + (r.diet.put || 0) + 0.5 * (r.diet.short || 0);
  /* onPress: the pressure of his time on the ball (his on-ball plays, by how on-ball each is) */
  const out = { mix, un, on, tov, ft, press, perim, paint, onPress: onW > 0 ? onP / onW : 0 };
  PROF.set(r.key, out);
  return out;
}

/* ------------------------------------------------------------------ how well he suits it --- */
/* his line against his position's and his league's: the few things a role leans on (core/instruct.js traits) */
function traits(c, ref) {
  const C = CARDS(), at = st => (C && ref ? C.atPos(ref, c.pos, st) : null), rel = (v, st, d) => { const a = at(st); return isNum(v) && isNum(a) && a > 0 ? v / a : d; };
  const tr = (c.off && c.off.tr) || {}, trShare = ref && ref.trShare > 0 && isNum(tr.share) ? tr.share / ref.trShare : 1;
  return {
    create: isNum(c.creator) ? c.creator : 0.35, usg: rel(c.usg, 'usg', 1), pass: rel(c.off && c.off.ast, 'ast_pct', 1),
    shoot: isNum(c.p3Rel) ? c.p3Rel : 1, vol3: c.mixRel ? c.mixRel.three : 1, pull: c.un ? c.un.three : 0.12,
    rim: isNum(c.rimRel) ? c.rimRel : 1, volRim: c.mixRel ? c.mixRel.rim : 1, mid: c.off && isNum(c.off.dMid) ? c.off.dMid : 0,
    run: trShare, trEff: ref && isNum(tr.ppp) ? tr.ppp - ref.trPpp : 0, stl: rel(c.def && c.def.stl, 'stl_pct', 1),
    blk: rel(c.def && c.def.blk, 'blk_pct', 1), orb: rel(c.off && c.off.orb, 'oreb_pct', 1), hands: c.off && isNum(c.off.dTov) ? -c.off.dTov : 0,
    fta: c.off && isNum(c.off.rFta) ? c.off.rFta : 1, pos: isNum(c.pos) ? c.pos : 3,
    lg3: ref && isNum(ref.p3) ? ref.p3 : 0.34, lgMid: ref && isNum(ref.mid) ? ref.mid : 0.4
  };
}
/* ATTACKING THE CLOSE-OUT against his open three (core/instruct.js, rip through: a tracked league's drives - a shot on
   0.45 of them at 49%, a foul on 7%, a pass on half), 0.5 where they are worth the same to him */
function ripFit(t) {
  const ex = x => 1 / (1 + Math.exp(-x)), lo = p => Math.log(p / (1 - p));
  const catch3 = 3 * (clamp(t.lg3 * t.shoot, 0.1, 0.6) + 0.025), midRel = ex(lo(t.lgMid) + clamp(t.mid, -1, 1)) / t.lgMid;
  const drive = 0.441 * (0.65 * t.rim + 0.35 * midRel) + 0.105 * t.fta + 0.456;
  return 0.5 + 1.6 * (drive - catch3) + 0.25 * (t.create - 0.35);
}
/* how well each kind of play suits him: 0.5 for a man average at everything it leans on (so every role suits an average
   man alike, and what decides is where he is better or worse than that); the style of his on-ball plays decides what
   they lean on */
function ptFit(k, t, st) {
  const s = st || { rim: 1, mid: 1, three: 1 }, rimW = clamp(s.rim - 0.8, 0, 1), threeW = clamp(s.three - 0.8, 0, 1), midW = clamp(s.mid - 0.9, 0, 1);
  const style = 0.45 * rimW * (t.rim - 1) * 2 + 0.5 * threeW * ((t.shoot - 1) * 1.6 + (t.pull - 0.12)) + 0.25 * midW * t.mid;
  switch (k) {
    case 'pnr': return 0.5 + 0.65 * (t.create - 0.35) + 0.25 * (t.pass - 1) + 0.12 * t.hands + style;
    case 'iso': return 0.5 + 0.85 * (t.create - 0.35) + 0.3 * (t.usg - 1) + 0.08 * t.hands + style;
    case 'post': return 0.5 + 0.5 * (t.create - 0.35) + 0.45 * (t.rim - 1) + 0.25 * t.mid + 0.15 * (t.fta - 1) + 0.12 * (t.pos - 4);
    case 'dho': return 0.5 + 0.35 * (t.create - 0.35) + 0.5 * (t.shoot - 1) + 0.25 * (t.rim - 1) + style * 0.5;
    case 'tr': return 0.5 + 0.35 * (t.run - 1) + 1.0 * t.trEff;
    case 'spot': return 0.5 + 1.4 * (t.shoot - 1) + 0.15 * (t.vol3 - 1);
    case 'offs': return 0.5 + 1.3 * (t.shoot - 1) + 0.3 * (t.pull - 0.12) + 0.2 * t.mid + 0.1 * (t.vol3 - 1);
    case 'cut': return 0.5 + 0.9 * (t.rim - 1) + 0.2 * (t.volRim - 1);
    case 'roll': return 0.5 + 0.9 * (t.rim - 1) + 0.2 * (t.orb - 1) + 0.2 * (t.volRim - 1) + 0.08 * (t.pos - 4);
    case 'pop': return 0.5 + 1.5 * (t.shoot - 1) + 0.25 * (t.vol3 - 1);
    case 'short': return 0.5 + 0.5 * (t.pass - 1) + 0.3 * t.mid + 0.1 * t.hands;
    case 'put': return 0.5 + 0.5 * (t.orb - 1) + 0.3 * (t.rim - 1);
    default: return 0.5;
  }
}
const WORDS = [[0.7, 'Natural fit', 'a4'], [0.52, 'Good fit', 'a3'], [0.36, 'Workable', 'a2'], [-1, 'Poor fit', 'a1']];
const howVs = r => (r >= 1.3 ? 'much more often than' : r >= 1.1 ? 'a bit more often than' : r > 0.9 ? 'about as often as' : r > 0.75 ? 'a bit less often than' : 'much less often than');
const pct0 = v => Math.round(100 * v) + '%';
/* THE WORDS FOR WHY, IN PLAIN TERMS (Louie: "needs to make more intuitive sense for a layman"): what he does, against
   the league or his position, never a ratio of rates */
function whyOf(r, c, ref) {
  const t = traits(c, ref), pos = POS_PLURAL[clamp(Math.round(t.pos) - 1, 0, 4)], out = [];
  const lg3 = ref && isNum(ref.p3) ? ref.p3 : 0.34, lgRim = ref && isNum(ref.rim) ? ref.rim : 0.6;
  const d = r.diet, shooter = (d.spot || 0) + (d.offs || 0) + (d.pop || 0) + (r.st && r.st.three > 1.2 ? (d.pnr || 0) + (d.dho || 0) : 0);
  const finisher = (d.cut || 0) + (d.roll || 0) + (d.put || 0) + (r.st && r.st.rim > 1.2 ? (d.pnr || 0) + (d.iso || 0) : 0);
  const onball = (d.pnr || 0) + (d.iso || 0) + (d.post || 0);
  if (shooter >= 0.3) out.push('He makes ' + pct0(t.shoot * lg3) + ' of his threes (the league: ' + pct0(lg3) + ')' + (t.pull >= 0.3 ? ', many of them off the dribble.' : t.pull < 0.12 ? ', almost all of them off a pass.' : '.'));
  if (finisher >= 0.3 || r.rip) out.push('He makes ' + pct0(t.rim * lgRim) + ' of his shots at the rim (the league: ' + pct0(lgRim) + ').');
  if (onball >= 0.3 || r.init >= 0.3) out.push(pct0(t.create) + ' of his points come from shots he makes for himself (a typical player: about 35%).');
  if (r.pass >= 0.4) out.push('He sets up teammates ' + howVs(t.pass) + ' most ' + pos + '.');
  if ((d.post || 0) >= 0.25) out.push('He draws fouls ' + howVs(t.fta) + ' a typical player' + (t.mid > 0.15 ? ', and he makes his mid-range shots.' : '.'));
  if (r.crash) out.push('He grabs offensive rebounds ' + howVs(t.orb) + ' most ' + pos + '.');
  if (r.def) out.push('He gets his hands on the ball (steals) ' + howVs(t.stl) + ' most ' + pos + '.');
  if ((d.tr || 0) >= 0.2 || r.run) out.push('He plays in transition ' + howVs(t.run) + ' most ' + pos + '.');
  return out.slice(0, 3);
}
function fit(role, c, ref) {
  const r = typeof role === 'string' ? BY.get(role) : role;
  if (!r || !c) return { s: 0.5, stars: 3, word: '', band: '', why: [] };
  const t = traits(c, ref);
  let s = 0;
  /* a role that rips through plays half its spot-ups as drives past the close-out */
  Object.keys(r.diet).forEach(k => { s += r.diet[k] * (k === 'spot' && r.rip ? 0.5 * ptFit(k, t) + 0.5 * ripFit(t) : ptFit(k, t, STYLED.has(k) ? r.st : null)); });
  /* what the role asks beyond its plays: the passing, the glass, the defence, the screens (size), the ball (handling) */
  s += 0.18 * r.pass * (t.pass - 1) + 0.15 * r.crash * (t.orb - 1) + 0.15 * r.def * ((t.stl - 1) + 0.5 * (t.shoot - 1)) + 0.04 * r.screen * (t.pos - 3.5)
    + 0.1 * clamp(r.init - 0.3, 0, 1) * (t.create - 0.35 + 0.1 * t.hands) + 0.08 * r.use * (t.usg - 1);
  /* a position far from his own costs (a centre asked to be a point guard) */
  s -= 0.08 * Math.max(0, Math.abs(t.pos - (r.slot + 1)) - 1);
  s = clamp(s, 0, 1);
  const w = WORDS.find(x => s >= x[0]);
  return { s, stars: Math.max(1, Math.min(5, Math.round(1 + 4 * s))), word: w[1], band: w[2], why: whyOf(r, c, ref) };
}
/* the role a man plays at a position: the one chosen for it, else the position's default - a point guard and a shooting
   guard the general one, a forward and a centre the role that suits him best */
const bestCache = new Map();
function bestFor(k, c, ref) {
  if (!c) return BY.get(DEFAULT[k] || forSlot(k)[0].key);
  const key = k + '|' + c.id + '|' + (ref ? ref.n : '');
  if (bestCache.has(key)) return bestCache.get(key);
  let best = null, bs = -1;
  forSlot(k).forEach(r => { const f = fit(r, c, ref).s; if (f > bs) { bs = f; best = r; } });
  if (bestCache.size > 2000) bestCache.clear();
  bestCache.set(key, best);
  return best;
}
function resolve(key, k, c, ref) {
  const r = key ? BY.get(key) : null;
  if (r && r.slot === k) return r;
  if (DEFAULT[k]) return BY.get(DEFAULT[k]);
  return bestFor(k, c, ref);
}

/* ------------------------------------------------------------------ what a role rules out --- */
/* the player instructions that go against the role (Louie: "lock off non-compatible instructions when these roles are
   active"): each with the reason the panel gives */
const LOCKS = new Map();
function locks(role) {
  const r = typeof role === 'string' ? BY.get(role) : role;
  if (!r) return new Map();
  if (LOCKS.has(r.key)) return LOCKS.get(r.key);
  const out = new Map(), P = profile(r), d = r.diet, add = (keys, why) => keys.forEach(k => { if (!out.has(k)) out.set(k, why); });
  const st = r.st || { rim: 1, mid: 1, three: 1 };
  /* a general role rules nothing out: his instructions are what shape it */
  if (r.gen) { LOCKS.set(r.key, out); return out; }
  if (r.init >= 0.45) add(['pas', 'hl', 'spot', 'fin'], 'He runs the offence in this role');
  if (r.init <= 0.1) add(['agg', 'hm', 'arc', 'dh', 'slow', 'pm'], 'He has very little of the ball in this role');
  if (r.use >= 0.5) add(['pas', 'hl', 'spot', 'fin'], 'He is a scorer in this role');
  if (r.use <= -0.4) add(['agg', 'hm', 'green'], 'He is not a shot-taker in this role');
  if (st.three >= 1.3 || ((d.spot || 0) + (d.offs || 0) >= 0.55 && !r.rip)) add(['dh', 'rip', 'fin', 'dive', 'cut'], 'He looks for his three in this role');
  if (st.rim >= 1.3 || ((d.cut || 0) + (d.roll || 0) >= 0.4)) add(['arc', 'green', 'space', 'pop'], 'He attacks the rim in this role');
  if ((d.pop || 0) >= 0.25) add(['roll', 'dive', 'short'], 'He pops after his screens in this role');
  if ((d.roll || 0) >= 0.3) add(['pop', 'space', 'short'], 'He rolls to the rim in this role');
  if ((d.short || 0) >= 0.3) add(['pop', 'dive'], 'He plays from the short roll in this role');
  if ((d.post || 0) >= 0.3) add(['nop', 'pl'], 'He plays in the post in this role');
  if (r.family === 'b' && (d.post || 0) < 0.08) add(['pm'], 'No post-ups in this role');
  if (r.crash) add(['space'], 'He works inside (cuts, the glass) in this role');
  if ((d.offs || 0) >= 0.35) add(['cut'], 'He runs off screens in this role');
  if (r.rip) add(['spot'], 'He attacks the close-out in this role');
  void P;
  LOCKS.set(r.key, out);
  return out;
}
const family = role => { const r = typeof role === 'string' ? BY.get(role) : role; return r ? r.family : 'w'; };

/* ------------------------------------------------------------------ the demonstration --- */
/* THE SCENES A ROLE'S DEMONSTRATION PLAYS (Louie: "Can each role also get a visual demonstration?"): a half court, the
   basket at the top (x 0..100, y 0..90), the role's man (P), two teammates (T the ball handler or passer, S a screener or
   shooter) and the ball, frame by frame; each frame moves them, a note says what is happening, a shot flies to the rim.
   views/ui.js draws and plays them. */
const SPOT = { rim: [50, 9], top: [50, 52], lw: [16, 42], rw: [84, 42], lc: [6, 10], rc: [94, 10], le: [35, 30], re: [65, 30], lb: [40, 16], rb: [60, 16],
  ft: [50, 30], ls: [30, 47], rs: [70, 47], lmid: [30, 28], rmid: [70, 28], half: [50, 88], lwd: [20, 66], rwd: [80, 66] };
const f = (P, T, S, ball, note, shot) => ({ P: SPOT[P] || P, T: SPOT[T] || T, S: SPOT[S] || S, ball, note, shot: shot || null });
const SCENES = {
  'pnr-kick': [f('top', 'rw', 'ls', 'P', 'He brings it up'), f([54, 46], 'rw', [50, 44], 'P', 'A screen at the top'), f('re', 'rw', 'ft', 'P', 'Into the paint: the defence collapses'), f('re', 'rc', 'ft', 'T', 'Kick-out to the corner', 'three-T')],
  'pnr-drive': [f('top', 'lw', 'ls', 'P', 'He brings it up'), f([54, 46], 'lw', [50, 44], 'P', 'The screen'), f('re', 'lw', 'ft', 'P', 'Turns the corner downhill'), f([56, 13], 'lw', 'ft', 'P', 'Attacks the rim', 'rim-P')],
  'pnr-dump': [f('top', 'lc', [52, 44], 'P', 'Pick-and-roll at the top'), f('re', 'lc', [50, 38], 'P', 'Downhill, the big rolls'), f([58, 20], 'lc', 'lb', 'S', 'Draws the help: dump-off to the roller', 'rim-S')],
  'pnr-pullmid': [f('top', 'rw', [52, 44], 'P', 'The screen at the top'), f('le', 'rw', 'ft', 'P', 'Probes into the lane'), f('le', 'rw', 'ft', 'P', 'Pulls up in the mid-range', 'mid-P')],
  'pnr-pull3': [f('top', 'rw', [53, 44], 'P', 'The screen at the top'), f([40, 54], 'rw', [52, 40], 'P', 'His man goes under the screen'), f([40, 54], 'rw', 'ft', 'P', 'Pulls up from three', 'three-P')],
  relocate: [f('top', 'rw', 'ft', 'P', 'He starts the play'), f('top', 'rw', 'ft', 'T', 'Swings it and moves'), f('lc', 're', 'ft', 'T', 'Relocates to the corner as the drive comes'), f('lc', 're', 'ft', 'P', 'Catch and shoot', 'three-P')],
  'dho-shoot': [f('lw', 'top', 'ls', 'T', 'The big brings it to him'), f([30, 52], [34, 50], 'ls', 'P', 'Takes the handoff'), f([30, 52], [34, 46], 'ls', 'P', 'Shoots off the handoff', 'three-P')],
  'trans-push': [f('half', 'lwd', 'rwd', 'P', 'The defensive board: he pushes'), f([50, 60], [20, 30], [80, 30], 'P', 'At speed, before the defence is set'), f([50, 14], 'lc', 'rc', 'P', 'All the way to the rim', 'rim-P')],
  'iso-step': [f('rw', 'lc', 'top', 'P', 'Isolation on the wing'), f([78, 40], 'lc', 'top', 'P', 'Sizes up his man'), f([88, 46], 'lc', 'top', 'P', 'Step-back jumper', 'three-P')],
  'iso-drive': [f('lw', 'rc', 'top', 'P', 'One-on-one in space'), f([24, 34], 'rc', 'top', 'P', 'Beats his man off the dribble'), f([44, 12], 'rc', 'top', 'P', 'Finishes at the rim', 'rim-P')],
  'offscreen-3': [f('lb', 'top', [32, 26], 'T', 'Waits on the baseline'), f([24, 38], 'top', [30, 30], 'T', 'Runs off the down-screen'), f('lw', 'top', [30, 30], 'P', 'Catch and shoot off the screen', 'three-P')],
  'offscreen-curl': [f('lb', 'top', [32, 26], 'T', 'Starts on the block'), f([30, 32], 'top', [30, 30], 'T', 'Curls tight around the screen'), f('ft', 'top', [30, 30], 'P', 'Into the mid-range jumper', 'mid-P')],
  'spot-3': [f('rc', 'top', 'lw', 'T', 'Spotted up in the corner'), f('rc', 're', 'lw', 'T', 'The drive draws his man'), f('rc', 're', 'lw', 'P', 'Catch and shoot', 'three-P')],
  defend: [f([60, 50], 'top', 'rw', 'T', 'Guards the ball on the perimeter'), f([56, 44], [56, 40], 'rw', 'T', 'Stays in front, contests'), f([56, 44], [56, 40], 'rw', 'P', 'A deflection: the ball is his')],
  rip: [f('rw', 'top', 'lc', 'T', 'On the wing'), f('rw', 'top', 'lc', 'P', 'The catch: his man flies out'), f([74, 30], 'top', 'lc', 'P', 'Rips through past the close-out'), f([58, 13], 'top', 'lc', 'P', 'Attacks the rim', 'rim-P')],
  cut: [f('lw', 'top', 'rw', 'T', 'His man denies the wing'), f([30, 30], 'top', 'rw', 'T', 'Backdoor cut'), f([44, 13], 'top', 'rw', 'P', 'The pass finds him at the rim', 'rim-P')],
  crash: [f('rb', 'lw', 'top', 'T', 'The shot goes up'), f([54, 12], 'lw', 'top', null, 'He crashes the glass'), f([52, 11], 'lw', 'top', 'P', 'Tip-in', 'rim-P')],
  'hub-pass': [f('rw', 'top', 'lc', 'P', 'The ball swings to him'), f('rw', [58, 30], 'lc', 'P', 'Spots the cutter'), f('rw', [56, 14], 'lc', 'T', 'One touch: the pass to the cut', 'rim-T')],
  pop: [f([46, 48], 'top', 'rc', 'T', 'He sets the screen'), f([30, 50], 're', 'rc', 'T', 'Pops to the arc as the guard drives'), f([30, 50], 're', 'rc', 'P', 'Catch and shoot', 'three-P')],
  roll: [f([46, 48], 'top', 'lc', 'T', 'He sets the screen'), f([48, 30], 're', 'lc', 'T', 'Rolls hard to the rim'), f([50, 13], 're', 'lc', 'P', 'The pass over the top: finish', 'rim-P')],
  'short-pass': [f([46, 48], 'top', 'lc', 'T', 'He sets the screen'), f('ft', 'rw', 'lc', 'P', 'Catches on the short roll'), f('ft', 'rw', [10, 14], 'S', 'The defence steps up: pass to the cutter', 'rim-S')],
  'short-attack': [f([46, 48], 'top', 'rc', 'T', 'He sets the screen'), f('ft', 'rw', 'rc', 'P', 'Catches on the short roll'), f([50, 14], 'rw', 'rc', 'P', 'Attacks downhill to the rim', 'rim-P')],
  'post-score': [f('lb', 'lw', 'rw', 'T', 'Seals his man on the block'), f('lb', 'lw', 'rw', 'P', 'The entry pass'), f([44, 12], 'lw', 'rw', 'P', 'Backs down, turns, scores', 'rim-P')],
  'post-pass': [f('rb', 'rw', 'lc', 'P', 'The ball goes into the post'), f('rb', 'rw', 'lc', 'P', 'The double team comes'), f('rb', 'rw', 'lc', 'S', 'Kicks out to the open shooter', 'three-S')],
  'dho-give': [f([40, 50], 'lw', 'rw', 'P', 'He handles it at the top'), f([30, 52], [32, 50], 'rw', 'T', 'The handoff'), f([30, 52], [40, 14], 'rw', 'T', 'The guard attacks off it', 'rim-T')]
};
function demo(role) {
  const r = typeof role === 'string' ? BY.get(role) : role;
  return r ? r.scenes.map(k => ({ key: k, frames: SCENES[k] || [] })).filter(s => s.frames.length) : [];
}

return { PT, ROLES, BY, SLOTS, POS_PLURAL, DEFAULT, forSlot, profile, traits, fit, bestFor, resolve, locks, family, demo, SCENES, SPOT, WORDS };
}));
