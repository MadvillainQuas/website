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
function R(key, slot, label, family, cat, diet, o, desc, scenes) {
  const t = PTK.reduce((a, k) => a + (diet[k] || 0), 0) || 1, d = {};
  PTK.forEach(k => { if (diet[k]) d[k] = diet[k] / t; });
  const r = Object.assign({ key, slot, label, family, cat, diet: d, desc, scenes: scenes || [] },
    { init: 0, use: 0, pass: 0, screen: 0, crash: 0, run: 0, def: 0, hub: 0, rip: 0, st: null, rho: 0.5 }, o);
  r.short = label.replace(/\s+(PG|SG|SF|PF|C)$/, '');
  ROLES.push(r); BY.set(key, r);
  return r;
}
/* THE CATEGORIES, in the order the panel shows them (Louie, 2026-10-15: "Can each role please be grouped in categories
   (i.e. all combo roles grouped in 'combo' for SG)?") */
const CATS = [
  ['Floor general', 'Scorer', 'Combo', 'All-round'],
  ['Combo', 'Secondary handler', 'Off-ball scorer', '3&D'],
  ['Point forward', 'Secondary handler', 'Shot creator', 'Off-ball scorer', 'Role player'],
  ['Playmaking forward', 'Secondary handler', 'Shot creator', 'Stretch & glue', 'Dual big'],
  ['Stretch five', 'Post', 'Roll man', 'Playmaking big']
];
/* THE NUMBERS (docs/manager-mode.md, Roles, for the sources): each diet is the measured play-type mix of the archetype
   nearest the role (a league's tracked players grouped by role, 2025-26), moved toward what the role's description asks;
   init is the archetype's time on the ball as a share of a five's (a primary ball handler about 22% of his minutes, a
   median rotation player 8%, a rim runner 5%: shares of a five's 57% that adds to); use and pass place it on the
   archetype's usage and assist rate against its position's. Each role in a category (CATS: how the panel groups them). */
/* ---- POINT GUARDS ---- */
R('pg-passspace', 0, 'Pass + Space PG', 'g', 'Floor general', { pnr: 0.30, spot: 0.30, tr: 0.15, dho: 0.08, cut: 0.05, iso: 0.04, offs: 0.06, put: 0.02 }, { init: 0.30, use: -0.45, pass: 0.65, st: S_3 },
  'A pass-first initiator who gets the offence into its action and then plays off the ball. He brings it up and runs the first pick-and-roll or swing, then relocates - lifting, drifting, filling the corner - for catch-and-shoot threes, and attacks closeouts rather than creating from a standstill. Low usage and few turnovers: the creation he gives up has to come from a second handler or a hub big.', ['pnr-kick', 'relocate']);
R('pg-slashpass', 0, 'Slashing Passer PG', 'g', 'Floor general', { pnr: 0.42, iso: 0.10, tr: 0.20, dho: 0.05, spot: 0.12, cut: 0.07, put: 0.04 }, { init: 0.39, use: 0, pass: 0.7, st: { rim: 1.5, mid: 1.25, three: 0.5 } },
  'A downhill initiator who creates by getting into the paint. He lives in the high pick-and-roll, turns the corner to collapse the defence, then hits the roller, the dump-off to the dunker spot or the kick-out to the corner, and finishes at the rim or with a floater when the help never comes. His assists come from the help he draws: he needs shooters spotted up around him and a roll threat.', ['pnr-dump', 'pnr-drive']);
R('pg-euro', 0, 'Euro PG', 'g', 'Floor general', { pnr: 0.45, iso: 0.05, dho: 0.07, tr: 0.15, spot: 0.22, offs: 0.03, cut: 0.03 }, { init: 0.45, use: -0.1, pass: 0.8, st: S_MID },
  'A pass-first pick-and-roll orchestrator in the European mould. He plays with pace: probes with patient dribbles, snakes back to keep his man in jail, reads the low man, and takes the mid-range or three-point pull-up when the big drops. The offence runs on his decisions - the most time on the ball of any role, modest usage, a lot of assists.', ['pnr-pullmid', 'pnr-kick']);
R('pg-mixed', 0, 'Mixed PG', 'g', 'All-round', { pnr: 0.36, iso: 0.12, dho: 0.06, tr: 0.18, spot: 0.17, offs: 0.04, cut: 0.04, post: 0.01, put: 0.02 }, { init: 0.36, use: 0, pass: 0.2, rho: 0.25, gen: true },
  'The all-round point guard: runs the offence and takes what the defence gives, scoring or passing as the play asks. His own game decides the balance between the two, and his player instructions shape it.', ['pnr-kick', 'pnr-drive']);
R('pg-shoot', 0, 'Pure Shooting PG', 'g', 'Scorer', { pnr: 0.27, iso: 0.12, dho: 0.13, tr: 0.14, spot: 0.12, offs: 0.14, cut: 0.05, post: 0.02, put: 0.01 }, { init: 0.33, use: 0.6, pass: -0.1, st: S_3 },
  'A scoring guard built on the pull-up three. A defender going under a screen or a big dropping is punished from deep; off the ball he relocates and comes off screens into threes, and he plays two-man game with his big (gets and handoffs). Playmaking comes second: he needs a big who screens for him and a second passer beside him.', ['pnr-pull3', 'dho-shoot']);
R('pg-slash', 0, 'Pure Slashing PG', 'g', 'Scorer', { pnr: 0.36, iso: 0.14, tr: 0.24, cut: 0.08, spot: 0.10, dho: 0.04, put: 0.04 }, { init: 0.38, use: 0.6, pass: -0.1, run: 0.5, st: S_RIM },
  'A downhill scoring guard who gets to the rim at speed - out of the pick-and-roll, in isolation and above all in transition, where he pushes the pace. Lives on rim pressure and free throws; he will hit the dump-off or the kick-out when the help comes early, but he is looking to score. Shooters around him keep his lanes open.', ['pnr-drive', 'trans-push']);
R('pg-mixscore', 0, 'Mixed Scoring PG', 'g', 'Scorer', { pnr: 0.31, iso: 0.25, post: 0.04, dho: 0.04, tr: 0.14, spot: 0.12, offs: 0.05, cut: 0.03, put: 0.02 }, { init: 0.40, use: 0.7, pass: 0, st: S_MIX },
  'A three-level scoring guard: the pull-up three keeps his man high, which opens the drive to the rim and the mid-range pull-up. Heavy on-ball usage in the pick-and-roll and in isolation; he fills in as the playmaker when he is needed, but the shot is his first read.', ['pnr-pull3', 'pnr-drive']);
R('pg-combospacepass', 0, 'Combo Spacing Passing PG', 'g', 'Combo', { pnr: 0.28, spot: 0.26, dho: 0.08, offs: 0.06, tr: 0.18, cut: 0.06, iso: 0.05, put: 0.03 }, { init: 0.30, use: -0.2, pass: 0.45, st: S_3 },
  'A point guard who shares the ball with a second handler. On the ball he makes the quick, simple read - the swing, the pocket pass, the kick-out - rather than probing deep; off it he spaces the floor for catch-and-shoot threes. Fits beside a ball-dominant wing or a point forward.', ['relocate', 'pnr-kick']);
R('pg-comboslashpass', 0, 'Combo Slashing Passing PG', 'g', 'Combo', { pnr: 0.30, iso: 0.08, cut: 0.09, spot: 0.15, dho: 0.06, tr: 0.20, put: 0.04, offs: 0.03, post: 0.05 }, { init: 0.31, use: 0, pass: 0.45, rip: 1, st: S_RIM },
  'A point guard who splits the handling and attacks downhill with a passer\'s eye: rim finishes, floaters and dump-offs out of the pick-and-roll, and off the ball he rips through closeouts and cuts into the gaps.', ['pnr-dump', 'rip']);
R('pg-combomixed', 0, 'Combo Mixed PG', 'g', 'Combo', { pnr: 0.30, iso: 0.12, dho: 0.07, tr: 0.18, spot: 0.19, offs: 0.06, cut: 0.04, put: 0.02, post: 0.02 }, { init: 0.30, use: 0.1, pass: 0.1 },
  'A combo point guard who shares the ball-handling: some pick-and-roll and handoffs, some spot-ups, scoring or passing as the play asks, with a second handler beside him.', ['pnr-pull3', 'relocate']);
R('pg-comboslashscore', 0, 'Combo Slashing Scoring PG', 'g', 'Combo', { pnr: 0.28, iso: 0.16, cut: 0.11, spot: 0.10, tr: 0.22, dho: 0.06, put: 0.05, post: 0.02 }, { init: 0.31, use: 0.6, pass: -0.2, rip: 1, st: S_RIM },
  'A scoring point guard who shares the handling and attacks the rim: gets downhill in the pick-and-roll, rips through closeouts, gets to the line and fills the lanes in transition. Less of a floor spacer.', ['rip', 'pnr-drive']);
R('pg-comboshootscore', 0, 'Combo Shooting Scoring PG', 'g', 'Combo', { pnr: 0.28, dho: 0.12, offs: 0.10, spot: 0.20, iso: 0.10, tr: 0.17, cut: 0.03 }, { init: 0.30, use: 0.6, pass: -0.1, st: S_3 },
  'A shooting point guard who shares the handling: pull-up threes off screens and handoffs, catch-and-shoot threes off the ball, and two-man game with the bigs.', ['dho-shoot', 'pnr-pull3']);
R('pg-comboiso', 0, 'Combo Iso Scoring PG', 'g', 'Combo', { iso: 0.30, pnr: 0.28, spot: 0.10, tr: 0.15, dho: 0.06, offs: 0.05, post: 0.03, cut: 0.02, put: 0.01 }, { init: 0.38, use: 0.8, pass: -0.3, st: S_MID },
  'A shot-creating point guard who shares the handling: he gets his own shot one-on-one - jab series, step-backs, side-steps and drives against a set defender - rather than running the offence. High usage, few assists; the floor has to be cleared for him.', ['iso-step', 'iso-drive']);
/* ---- SHOOTING GUARDS ---- */
R('sg-combospacepass', 1, 'Combo Spacing Passing SG', 'g', 'Combo', { pnr: 0.24, spot: 0.28, dho: 0.08, offs: 0.06, tr: 0.18, cut: 0.06, iso: 0.06, put: 0.04 }, { init: 0.26, use: -0.2, pass: 0.45, st: S_3 },
  'A combo guard who shares the ball-handling with the point guard. Off the ball he spaces the floor for catch-and-shoot threes; on it he makes quick, simple reads - the swing, the kick-out, the hit to the roller - rather than probing deep into the paint.', ['relocate', 'pnr-kick']);
R('sg-comboslashpass', 1, 'Combo Slashing Passing SG', 'g', 'Combo', { pnr: 0.26, iso: 0.08, cut: 0.10, spot: 0.18, dho: 0.06, tr: 0.20, put: 0.04, offs: 0.03, post: 0.05 }, { init: 0.27, use: 0, pass: 0.45, rip: 1, st: S_RIM },
  'A combo guard who shares the ball-handling and gets downhill with a passer\'s eye: drives the pick-and-roll for rim finishes, floaters and dump-offs, and off the ball rips through closeouts to score or to pass.', ['pnr-dump', 'rip']);
R('sg-combomixed', 1, 'Combo Mixed SG', 'g', 'Combo', { pnr: 0.26, iso: 0.12, dho: 0.07, tr: 0.18, spot: 0.23, offs: 0.06, cut: 0.04, put: 0.02, post: 0.02 }, { init: 0.26, use: 0.1, pass: 0.1, rho: 0.25, gen: true },
  'The general combo guard: some pick-and-roll and handoffs, some spot-ups, scoring or passing as the play asks. His own game decides the balance, and his instructions shape it.', ['pnr-pull3', 'relocate']);
R('sg-comboslashscore', 1, 'Combo Slashing Scoring SG', 'g', 'Combo', { pnr: 0.24, iso: 0.16, cut: 0.12, spot: 0.12, tr: 0.22, dho: 0.06, put: 0.05, post: 0.03 }, { init: 0.27, use: 0.6, pass: -0.2, rip: 1, st: S_RIM },
  'A scoring combo guard who attacks the rim: drives the pick-and-roll and rips through closeouts to score, gets to the line and fills the lanes in transition. Less of a floor spacer.', ['rip', 'pnr-drive']);
R('sg-comboshootscore', 1, 'Combo Shooting Scoring SG', 'g', 'Combo', { pnr: 0.24, dho: 0.12, offs: 0.10, spot: 0.24, iso: 0.10, tr: 0.17, cut: 0.03 }, { init: 0.26, use: 0.6, pass: -0.1, st: S_3 },
  'A shooting combo guard: two-man game with the bigs (gets and handoffs) into pull-up threes, catch-and-shoot threes off the ball, and his share of the ball-handling.', ['dho-shoot', 'pnr-pull3']);
R('sg-comboiso', 1, 'Combo Iso Scoring SG', 'g', 'Combo', { iso: 0.28, pnr: 0.26, spot: 0.12, tr: 0.15, dho: 0.06, offs: 0.05, post: 0.04, cut: 0.02, put: 0.02 }, { init: 0.36, use: 0.8, pass: -0.3, st: S_MID },
  'A shot creator who gets his own look one-on-one rather than in the pick-and-roll: jab series, step-backs and mid-range pull-ups, drives against a set defender. High usage and few assists; he needs the floor cleared for him.', ['iso-step', 'iso-drive']);
R('sg-secslash', 1, 'Secondary BH Slashing SG', 'g', 'Secondary handler', { pnr: 0.28, cut: 0.12, spot: 0.20, tr: 0.18, dho: 0.07, iso: 0.08, put: 0.04, offs: 0.03 }, { init: 0.29, use: 0.1, pass: 0.15, rip: 1, st: S_RIM },
  'The second ball handler: once the point guard has started the possession, he takes the ball in a side pick-and-roll or attacks the tilted defence downhill - finishing at the rim or kicking out. Off the ball he cuts and attacks closeouts. Real on-ball reps without running the offence.', ['pnr-drive', 'cut']);
R('sg-secshoot', 1, 'Secondary BH Shooting SG', 'g', 'Secondary handler', { pnr: 0.28, spot: 0.26, offs: 0.08, dho: 0.08, tr: 0.17, iso: 0.06, cut: 0.04, put: 0.03 }, { init: 0.28, use: 0.15, pass: 0.1, st: S_3 },
  'The second ball handler with a jumper: takes the side pick-and-roll after the first action - shooting behind the screen, hitting the screener, or pulling up for the mid-range or three. Otherwise he spaces the floor or comes off screens.', ['pnr-pull3', 'relocate']);
R('sg-moveshoot', 1, 'Movement Shooting SG', 'g', 'Off-ball scorer', { offs: 0.30, spot: 0.30, tr: 0.17, dho: 0.12, pnr: 0.06, cut: 0.04, put: 0.01 }, { init: 0.11, use: 0.3, pass: -0.2 },
  'A movement shooter: barely dribbles but never stops moving - runs off pin-downs, staggers and floppy screens to catch and shoot from deep, or curls into the mid-range. He needs screeners and a passer who finds him on the move; his gravity bends the defence even when he never touches the ball.', ['offscreen-3', 'offscreen-curl']);
R('sg-offscreen', 1, 'Off-Screens Scoring SG', 'g', 'Off-ball scorer', { offs: 0.26, spot: 0.18, iso: 0.14, dho: 0.12, pnr: 0.12, tr: 0.14, cut: 0.04 }, { init: 0.18, use: 0.6, pass: -0.2, st: S_MID },
  'A scorer off screens with more on-ball game than a pure movement shooter: comes off pin-downs and handoffs to shoot the three or curl to the rim and the mid-range, and gets a few isolations of his own.', ['offscreen-curl', 'offscreen-3']);
R('sg-offslash', 1, 'Off-Ball Slashing SG', 'g', 'Off-ball scorer', { spot: 0.30, cut: 0.25, tr: 0.22, put: 0.10, offs: 0.05, dho: 0.04, iso: 0.04 }, { init: 0.13, use: 0.2, pass: -0.1, rip: 1 },
  'A closeout attacker and cutter: rarely creates from a standstill but punishes a tilted defence - rips through closeouts to the rim, cuts backdoor when he is overplayed, runs the floor and takes the open three.', ['rip', 'cut']);
R('sg-3d', 1, '3&D SG', 'g', '3&D', { spot: 0.55, tr: 0.20, cut: 0.07, pnr: 0.06, offs: 0.04, dho: 0.03, put: 0.05 }, { init: 0.12, use: -0.6, pass: -0.2, def: 1 },
  'Spots up for catch-and-shoot threes (the corners first) and guards the other side\'s best perimeter player. Low usage and few dribbles: his value is spacing and point-of-attack defence.', ['spot-3', 'defend']);
/* ---- SMALL FORWARDS ---- */
R('sf-slashpoint', 2, 'Slashing Point SF', 'w', 'Point forward', { pnr: 0.20, iso: 0.12, post: 0.06, cut: 0.10, spot: 0.14, tr: 0.24, dho: 0.06, put: 0.05, offs: 0.03 }, { init: 0.27, use: 0.3, pass: 0.35, rip: 1, st: S_RIM },
  'A point forward who shares the ball-handling: grabs and goes in transition, runs the pick-and-roll and drives downhill to finish or kick out, and attacks closeouts off the ball. Turns the wing spot into a second creator.', ['pnr-drive', 'rip']);
R('sf-shootpoint', 2, 'Shooting Point SF', 'w', 'Point forward', { pnr: 0.20, spot: 0.28, dho: 0.08, offs: 0.08, tr: 0.20, iso: 0.08, cut: 0.05, post: 0.03 }, { init: 0.25, use: -0.1, pass: 0.45, st: S_3 },
  'A point forward who shares the ball-handling and plays with the pass and the jumper: quick reads on the ball, spot-up and relocation threes off it.', ['relocate', 'pnr-kick']);
R('sf-secshoot', 2, 'Secondary BH Shooting SF', 'w', 'Secondary handler', { spot: 0.32, pnr: 0.18, offs: 0.08, dho: 0.08, tr: 0.20, cut: 0.06, iso: 0.05, put: 0.03 }, { init: 0.24, use: 0, pass: 0.15, st: S_3 },
  'A floor-spacing forward who takes the second-side pick-and-roll after the guard starts the play: a quick look from deep or a quick pass to the screener. Otherwise he spots up.', ['spot-3', 'pnr-pull3']);
R('sf-secslash', 2, 'Secondary BH Slashing SF', 'w', 'Secondary handler', { cut: 0.14, spot: 0.18, pnr: 0.20, tr: 0.19, iso: 0.10, dho: 0.07, put: 0.07, post: 0.05 }, { init: 0.25, use: 0.2, pass: 0.15, rip: 1, st: S_RIM },
  'A slashing forward used as the second handler: attacks a scrambled defence downhill in a side pick-and-roll or off the catch, cuts often and finishes at the rim.', ['cut', 'pnr-drive']);
R('sf-iso', 2, 'Iso Scoring SF', 'w', 'Shot creator', { iso: 0.26, pnr: 0.18, post: 0.08, dho: 0.06, tr: 0.15, spot: 0.14, offs: 0.08, cut: 0.03, put: 0.02 }, { init: 0.30, use: 0.9, pass: -0.3, st: { rim: 1.05, mid: 1.35, three: 1.0 } },
  'The designated one-on-one scorer. He is not handed the pick-and-roll: the floor is cleared and he goes to work in space - jab series, step-backs and mid-range pull-ups, drives against a set defender, mid-post touches. High-usage, tough-shot-making possessions that matter late in the clock; he needs shooters around him so the help cannot load up.', ['iso-step', 'iso-drive']);
R('sf-moveshoot', 2, 'Movement Shooting SF', 'w', 'Off-ball scorer', { offs: 0.28, spot: 0.32, tr: 0.18, dho: 0.12, pnr: 0.05, cut: 0.04, put: 0.01 }, { init: 0.11, use: 0.3, pass: -0.2 },
  'A movement shooter at the forward spot: runs off pin-downs and staggers to catch and shoot, curls into the mid-range. Very little ball-handling and a lot of gravity.', ['offscreen-3', 'offscreen-curl']);
R('sf-dualthreat', 2, 'Dual Threat Off-Ball SF', 'w', 'Off-ball scorer', { spot: 0.38, cut: 0.14, tr: 0.22, offs: 0.08, iso: 0.06, put: 0.07, dho: 0.03, pnr: 0.02 }, { init: 0.13, use: 0.1, pass: 0, rip: 1, rho: 0.35 },
  'An off-ball forward who is a spot-up shooter and a closeout attacker at once: a short closeout and he shoots, a hard one and he rips through to the rim. Runs the floor in transition.', ['rip', 'spot-3']);
R('sf-slashoff', 2, 'Slashing Off-Ball SF', 'w', 'Off-ball scorer', { cut: 0.25, spot: 0.22, tr: 0.25, put: 0.12, iso: 0.06, dho: 0.04, offs: 0.03, pnr: 0.03 }, { init: 0.13, use: 0.2, pass: -0.1, rip: 1, run: 0.4 },
  'An off-ball slasher: 45 cuts and backdoors, runs the lanes in transition and attacks closeouts to the rim. He lives on the passes of others, so he needs a passer who finds him.', ['cut', 'rip']);
R('sf-3d', 2, '3&D SF', 'w', 'Role player', { spot: 0.55, tr: 0.20, cut: 0.08, pnr: 0.05, offs: 0.04, dho: 0.03, put: 0.05 }, { init: 0.12, use: -0.6, pass: -0.2, def: 1 },
  'Spots up in the corners for catch-and-shoot threes and guards the other side\'s best wing. Minimal ball-handling: the classic complementary wing.', ['spot-3', 'defend']);
R('sf-cuthustle', 2, 'Cuts & Hustle SF', 'w', 'Role player', { cut: 0.26, put: 0.18, spot: 0.24, tr: 0.20, roll: 0.05, post: 0.02, pnr: 0.02, dho: 0.03 }, { init: 0.11, use: -0.3, pass: -0.1, crash: 1, screen: 0.4 },
  'A glue forward: cuts, crashes the offensive glass, sets screens as an extra big and plays without needing touches. Little ball-handling; he scores on put-backs and cuts.', ['cut', 'crash']);
R('sf-hub', 2, 'Connective Passing Hub SF', 'w', 'Role player', { spot: 0.32, cut: 0.14, tr: 0.22, short: 0.05, dho: 0.08, offs: 0.04, pnr: 0.07, put: 0.05, iso: 0.03 }, { init: 0.18, use: -0.4, pass: 0.8, screen: 0.4, hub: 1 },
  'A connector: makes the 0.5-second decision - the swing, the extra pass, the hit to the cutter, the handoff - and keeps the advantage alive without holding the ball. Low usage, a lot of touches; he also screens as an extra big.', ['hub-pass', 'relocate']);
/* ---- POWER FORWARDS ---- */
R('pf-slashpoint', 3, 'Slashing Point PF', 'w', 'Playmaking forward', { pnr: 0.16, iso: 0.12, post: 0.11, cut: 0.08, spot: 0.13, tr: 0.23, dho: 0.04, put: 0.06, roll: 0.04, offs: 0.03 }, { init: 0.26, use: 0.3, pass: 0.35, rip: 1, st: S_RIM },
  'A point forward at the four: grabs and goes in transition, runs the pick-and-roll and attacks downhill to finish or kick out - a mismatch the other side\'s big has to guard in space.', ['pnr-drive', 'rip']);
R('pf-shootpoint', 3, 'Shooting Point PF', 'w', 'Playmaking forward', { pnr: 0.18, spot: 0.28, dho: 0.08, offs: 0.06, tr: 0.20, iso: 0.08, post: 0.05, cut: 0.04, pop: 0.03 }, { init: 0.24, use: -0.1, pass: 0.45, st: S_3 },
  'A point forward at the four who plays with the pass and the jumper: quick reads on the ball, pick-and-pop and spot-up threes off it.', ['relocate', 'pnr-kick']);
R('pf-playslash', 3, 'Playmaking Slashing PF', 'w', 'Playmaking forward', { dho: 0.16, pnr: 0.12, iso: 0.10, cut: 0.10, spot: 0.14, tr: 0.16, short: 0.12, post: 0.05, put: 0.05 }, { init: 0.22, use: 0.2, pass: 0.55, screen: 0.3, hub: 1, st: S_RIM },
  'A perimeter-playmaking four: runs handoffs and short rolls from the top, finds the cutters, and attacks downhill himself for shots at the rim.', ['dho-give', 'iso-drive']);
R('pf-secshoot', 3, 'Secondary BH Shooting PF', 'w', 'Secondary handler', { spot: 0.31, pnr: 0.15, offs: 0.04, pop: 0.12, dho: 0.08, tr: 0.18, cut: 0.05, put: 0.04, post: 0.03 }, { init: 0.22, use: 0, pass: 0.15, screen: 0.3, st: S_3 },
  'A floor-spacing four who sometimes takes the second-side pick-and-roll: a quick three or a quick pass to the screener. He screens and pops otherwise.', ['spot-3', 'pop']);
R('pf-secslash', 3, 'Secondary BH Slashing PF', 'w', 'Secondary handler', { cut: 0.16, spot: 0.14, pnr: 0.18, tr: 0.20, iso: 0.10, put: 0.10, post: 0.06, roll: 0.04, dho: 0.02 }, { init: 0.23, use: 0.2, pass: 0.15, rip: 1, st: S_RIM },
  'A slashing four used as a second handler: attacks a tilted defence downhill, cuts and crashes for put-backs.', ['cut', 'pnr-drive']);
R('pf-iso', 3, 'Iso Scoring PF', 'w', 'Shot creator', { iso: 0.22, post: 0.20, pop: 0.08, roll: 0.05, spot: 0.14, tr: 0.14, pnr: 0.08, put: 0.06, cut: 0.03 }, { init: 0.29, use: 0.9, pass: -0.3, screen: 0.3, st: S_MID },
  'A scoring four who creates one-on-one: faces up from the elbow, posts mismatches, pops and attacks, gets to his mid-range spots. He carries scoring load rather than running the offence.', ['post-score', 'iso-drive']);
R('pf-moveshoot', 3, 'Movement Shooting PF', 'w', 'Stretch & glue', { offs: 0.25, spot: 0.32, pop: 0.10, tr: 0.16, dho: 0.10, cut: 0.05, put: 0.02 }, { init: 0.10, use: 0.3, pass: -0.2, screen: 0.2 },
  'A shooting four who moves: runs off screens and pops after his own screens for catch-and-shoot threes. Very little ball-handling.', ['offscreen-3', 'pop']);
R('pf-3d', 3, '3&D PF', 'w', 'Stretch & glue', { spot: 0.48, pop: 0.12, cut: 0.08, tr: 0.18, put: 0.08, pnr: 0.03, post: 0.03 }, { init: 0.11, use: -0.5, pass: -0.2, screen: 0.5, def: 1 },
  'A stretch four who spots up, screens and pops, and defends more than one position. Low usage.', ['spot-3', 'pop']);
R('pf-cuthustle', 3, 'Cuts & Hustle PF', 'w', 'Stretch & glue', { cut: 0.26, put: 0.22, roll: 0.14, spot: 0.12, tr: 0.20, post: 0.04, pop: 0.02 }, { init: 0.10, use: -0.3, pass: -0.1, crash: 1, screen: 0.6 },
  'A glue four: cuts, rolls, crashes the offensive glass and finishes what others create. Little ball-handling.', ['cut', 'crash']);
R('pf-hub', 3, 'Connective Passing Hub PF', 'w', 'Stretch & glue', { spot: 0.28, cut: 0.14, short: 0.12, dho: 0.10, put: 0.07, tr: 0.20, post: 0.04, pnr: 0.05 }, { init: 0.18, use: -0.4, pass: 0.8, screen: 0.5, hub: 1 },
  'A connector at the four: handoffs, short-roll passes and the extra pass around the arc; he keeps the ball moving without holding it.', ['hub-pass', 'short-pass']);
R('pf-dualspot', 3, 'Dual-Big Spot-Up PF', 'b', 'Dual big', { pop: 0.30, spot: 0.32, post: 0.10, put: 0.05, tr: 0.12, cut: 0.06, iso: 0.02, dho: 0.03 }, { init: 0.09, use: 0, pass: 0, screen: 0.8 },
  'The stretch four beside a centre: screens and pops, spots up for catch-and-shoot threes and now and then punishes a smaller defender in the post. He pulls the second big away from the rim.', ['pop', 'spot-3']);
R('pf-dualthreat', 3, 'Dual-Big Dual Threat PF', 'b', 'Dual big', { pop: 0.22, spot: 0.22, post: 0.12, roll: 0.10, iso: 0.06, put: 0.07, tr: 0.14, cut: 0.07 }, { init: 0.12, use: 0.3, pass: 0, screen: 0.7, rip: 1 },
  'A four in a two-big lineup who screens and pops, then shoots the three or attacks the closeout downhill; he spots up, slashes and posts mismatches.', ['pop', 'rip']);
R('pf-dualpost', 3, 'Dual-Big Post PF', 'b', 'Dual big', { post: 0.38, put: 0.14, roll: 0.12, spot: 0.06, cut: 0.13, iso: 0.06, tr: 0.06, dho: 0.02, pop: 0.03 }, { init: 0.18, use: 0.5, pass: 0, screen: 0.5 },
  'A back-to-the-basket four: lives on post touches on the block and the mid-post, scores with footwork and draws fouls. He plays inside beside the centre (3-out 2-in), so he needs shooters around him.', ['post-score', 'crash']);
R('pf-dualroll', 3, 'Dual-Big Roller PF', 'b', 'Dual big', { roll: 0.30, cut: 0.26, put: 0.18, tr: 0.12, post: 0.06, spot: 0.04, pop: 0.04 }, { init: 0.09, use: -0.2, pass: -0.1, screen: 0.9, crash: 0.6 },
  'A rim-running four: sets screens and dives hard, catches lobs and dump-offs at the dunker spot and crashes the glass. Few post touches and little spacing.', ['roll', 'crash']);
/* ---- CENTRES ---- */
R('c-spot', 4, 'Spot-Up C', 'b', 'Stretch five', { pop: 0.34, spot: 0.30, post: 0.10, put: 0.05, tr: 0.12, cut: 0.06, iso: 0.02, dho: 0.01 }, { init: 0.09, use: 0, pass: 0, screen: 0.9 },
  'A stretch five: screens and pops for catch-and-shoot threes and spots up on the weak side, pulling the other side\'s rim protector out of the paint; now and then he posts a smaller man.', ['pop', 'spot-3']);
R('c-dualpnp', 4, 'Dual Threat PNP C', 'b', 'Stretch five', { pop: 0.24, roll: 0.14, spot: 0.18, post: 0.12, put: 0.08, iso: 0.05, tr: 0.12, cut: 0.07 }, { init: 0.11, use: 0.3, pass: 0, screen: 0.9, rip: 1 },
  'A pick-and-pop centre who is a threat both ways: pops to shoot, attacks a hard closeout downhill, sometimes rolls; he also scores from the post.', ['pop', 'roll']);
R('c-slashpnp', 4, 'Slashing PNP C', 'b', 'Stretch five', { pop: 0.22, spot: 0.14, roll: 0.14, put: 0.12, post: 0.08, iso: 0.10, tr: 0.12, cut: 0.08 }, { init: 0.12, use: 0.3, pass: 0, screen: 0.9, rip: 1, st: S_RIM },
  'A face-up five: pops out after the screen, then attacks the closeout off the dribble rather than shooting - a driver from the top of the key.', ['pop', 'rip']);
R('c-post', 4, 'Post C', 'b', 'Post', { post: 0.30, roll: 0.20, put: 0.15, cut: 0.14, iso: 0.06, spot: 0.06, tr: 0.06, dho: 0.03 }, { init: 0.18, use: 0.6, pass: -0.1, screen: 0.6 },
  'A back-to-the-basket centre: his screens turn into post seals and his touches come on the block - drop steps, hooks and fouls drawn. He needs shooters around him and slows the game down.', ['post-score', 'crash']);
R('c-postplay', 4, 'Post Playmaker C', 'b', 'Post', { post: 0.24, dho: 0.08, roll: 0.16, put: 0.10, cut: 0.12, iso: 0.06, spot: 0.10, tr: 0.10, short: 0.04 }, { init: 0.22, use: 0.1, pass: 0.7, screen: 0.6, hub: 1 },
  'A post hub: the ball goes into him on the block or the elbow and the offence plays off him - he scores against single coverage and passes out of the double to the cutters and the shooters (split cuts, kick-outs).', ['post-pass', 'post-score']);
R('c-roller', 4, 'Rim Roller C', 'b', 'Roll man', { roll: 0.35, cut: 0.30, put: 0.20, tr: 0.10, post: 0.05 }, { init: 0.09, use: -0.5, pass: -0.1, screen: 1, crash: 0.6 },
  'A rim runner and vertical spacer: sets the screen and dives hard to the rim, catches lobs and dump-offs at the dunker spot, runs the floor and crashes the glass. Few touches at high efficiency; he needs a handler who can find him.', ['roll', 'crash']);
R('c-shortplay', 4, 'Short Roll Playmaking C', 'b', 'Roll man', { short: 0.35, roll: 0.15, put: 0.10, cut: 0.12, spot: 0.14, tr: 0.10, pop: 0.04 }, { init: 0.16, use: -0.2, pass: 0.7, screen: 1, hub: 1 },
  'A short-roll playmaker: catches in the middle of the floor when the defence traps the ball handler and plays four-on-three - passes to the weak-side shooter and the backdoor cutter, the floater, or a dribble to finish.', ['short-pass', 'roll']);
R('c-shortattack', 4, 'Short Roll Attacking C', 'b', 'Roll man', { short: 0.35, roll: 0.22, put: 0.14, cut: 0.12, post: 0.05, tr: 0.08, spot: 0.04 }, { init: 0.14, use: 0.3, pass: 0.1, screen: 1, st: { rim: 1.35, mid: 1.15, three: 0.3 } },
  'Catches on the short roll and attacks: drives to the rim or takes the floater and the mid-range jumper rather than passing.', ['short-attack', 'roll']);
R('c-playslash', 4, 'Playmaking Slashing C', 'b', 'Playmaking big', { dho: 0.14, iso: 0.10, short: 0.15, roll: 0.10, cut: 0.10, put: 0.10, spot: 0.12, tr: 0.10, post: 0.05, pnr: 0.04 }, { init: 0.22, use: 0.2, pass: 0.6, screen: 0.6, hub: 1, st: S_RIM },
  'A delay hub who handles at the top of the key: runs the handoffs, finds the cutters and attacks downhill himself.', ['dho-give', 'iso-drive']);
R('c-playscreen', 4, 'Playmaking Screener C', 'b', 'Playmaking big', { roll: 0.22, short: 0.20, cut: 0.15, put: 0.12, dho: 0.12, spot: 0.08, tr: 0.08, post: 0.03 }, { init: 0.20, use: 0, pass: 0.6, screen: 1, hub: 1 },
  'A screening hub: runs handoffs at the top, slips and rolls to the rim and makes the read from the short roll - the big the offence flows through without being a post scorer.', ['dho-give', 'roll']);

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
    lg3: ref && isNum(ref.p3) ? ref.p3 : 0.34, lgMid: ref && isNum(ref.mid) ? ref.mid : 0.4,
    /* his three-point VOLUME against his own position's (a centre who takes a third of his shots from three is a volume
       shooter for a centre): what a shooting role needs besides the percentage */
    vol3P: (() => {
      const P = ref && ref.byPos ? ref.byPos[clamp(Math.round(isNum(c.pos) ? c.pos : 3), 1, 5) - 1] : null, sh = c.mix && isNum(c.mix.three) ? c.mix.three : null;
      return P && isNum(P.p3sh) && P.p3sh > 0.02 && isNum(sh) ? clamp(sh / P.p3sh, 0, 3) : (c.mixRel ? c.mixRel.three : 1);
    })()
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
    /* the shooting plays need the volume as well as the percentage (Louie, 2026-10-15: "Can movement shooters need more 3PT
       volume") - most of all the movement shooter, whose job is to take them */
    case 'spot': return 0.5 + 1.2 * (t.shoot - 1) + 0.3 * (clamp(t.vol3P, 0, 2.5) - 1);
    case 'offs': return 0.5 + 1.1 * (t.shoot - 1) + 0.45 * (clamp(t.vol3P, 0, 2.5) - 1) + 0.2 * (t.pull - 0.12) + 0.15 * t.mid;
    case 'cut': return 0.5 + 0.9 * (t.rim - 1) + 0.2 * (t.volRim - 1);
    case 'roll': return 0.5 + 0.9 * (t.rim - 1) + 0.2 * (t.orb - 1) + 0.2 * (t.volRim - 1) + 0.08 * (t.pos - 4);
    case 'pop': return 0.5 + 1.3 * (t.shoot - 1) + 0.35 * (clamp(t.vol3P, 0, 2.5) - 1);
    case 'short': return 0.5 + 0.5 * (t.pass - 1) + 0.3 * t.mid + 0.1 * t.hands;
    case 'put': return 0.5 + 0.5 * (t.orb - 1) + 0.3 * (t.rim - 1);
    default: return 0.5;
  }
}
const WORDS = [[0.7, 'Natural fit', 'a4'], [0.52, 'Good fit', 'a3'], [0.36, 'Workable', 'a2'], [-1, 'Poor fit', 'a1']];
/* HOW FAR OUT OF POSITION (Louie, 2026-10-15: "not have much of a docking of stats unless it's a position 2 positions up
   from them or more"): nothing within one position of his own (a shooting guard at small forward, a power forward at
   centre), then a unit for each position past one and a quarter - a shooting guard at power forward 1, at centre 2.3 */
const posGap = (pos, slot) => { const d = Math.abs((isNum(pos) ? pos : 3) - (slot + 1)); return d <= 1.25 ? 0 : (d - 1.25) * 1.33; };
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
  /* what the role asks beyond its plays: the passing, the glass, the defence, the screens (size), the ball (handling: a
     role with real time on the ball needs a handle that holds up and some creation), the scoring load, the connector's
     sure hands */
  s += 0.18 * r.pass * (t.pass - 1) + 0.15 * r.crash * (t.orb - 1) + 0.15 * r.def * ((t.stl - 1) + 0.5 * (t.shoot - 1)) + 0.04 * r.screen * (t.pos - 3.5)
    + 0.25 * clamp(r.init - 0.2, 0, 1) * (t.create - 0.35 + 0.15 * t.hands) + 0.08 * r.use * (t.usg - 1) + 0.08 * r.hub * t.hands;
  /* a position two or more from his own costs (a shooting guard at power forward); one either way does not */
  s -= 0.1 * Math.max(0, posGap(t.pos, r.slot));
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

/* ------------------------------------------------------------------ where he stands: the five's spacing --- */
/* Louie, 2026-10-15: "Can player roles imply team spacing (i.e. dual-big post PF implies 3-out 2-in spacing, having two
   perimeter-based roles on the PF and C implies 5-out)?" Each role has a home on the floor when the ball is not his -
   the top, a slot, a wing, a corner (out), an elbow, a block, the dunker spot (in) - and a five's homes laid out side by
   side are its alignment: 5-out, 4-out 1-in, 3-out 2-in. The tactics screen stands the circles there; the live court
   starts each half-court possession from it. SPOTS: feet across (u, + to the right as the offence faces the basket)
   and up from the baseline (v); the basket at (0, 5.25). */
const SPOTS = { top: [0, 30.5], 'left slot': [-10.5, 28], 'right slot': [10.5, 28], 'left wing': [-18.5, 22], 'right wing': [18.5, 22],
  'left corner': [-22.5, 3.5], 'right corner': [22.5, 3.5], 'left elbow': [-7, 19], 'right elbow': [7, 19], nail: [0, 19],
  'left block': [-7.5, 7.5], 'right block': [7.5, 7.5], 'left dunker': [-9.5, 2.5], 'right dunker': [9.5, 2.5],
  'left short corner': [-15, 5], 'right short corner': [15, 5], rim: [0, 5.25] };
const INSIDE = new Set(['elbow', 'block', 'dunker']);
function home(role) {
  const r = typeof role === 'string' ? BY.get(role) : role;
  if (!r) return 'wing';
  const d = r.diet;
  if (r.init >= 0.33 || (r.slot === 0 && r.init >= 0.25) || (r.gen && r.slot === 0)) return 'top';
  if ((d.post || 0) >= 0.22) return 'block';
  if (r.family !== 'g' && (d.roll || 0) + (d.put || 0) + 0.5 * (d.cut || 0) >= 0.45) return 'dunker';
  if (r.family === 'b' && ((d.short || 0) >= 0.2 || (d.dho || 0) >= 0.1)) return 'elbow';
  if ((d.pop || 0) >= 0.2 || r.init >= 0.2) return 'slot';
  if ((d.spot || 0) >= 0.45 || r.def) return 'corner';
  return 'wing';
}
/* THE FIVE'S ALIGNMENT, AS A PLAYBOOK DRAWS IT (Louie, 2026-10-15: "this doesn't look like a basketball set up"). The men
   inside first, each to the first free spot his home allows on his side of the floor (the point guard in the middle, the
   two and the four on the right, the three and the five on the left). Then the men outside to the spots a set of that
   shape spreads them to - not each to the spot he likes best, which bunched three men around the top of the key:
     5-out          the top, both wings, both corners
     4-out 1-in     the top, both wings and the corner away from the big (both corners and the wing above the big when
                    two of them are corner shooters); with nobody at the point, both slots and both corners
     3-out 2-in     the top and both wings, or both corners for corner shooters; with nobody at the point, both slots and
                    the corner away from the bigs
   each man to the one nearest his home's depth (top, slot, wing, corner), on his own side where it can be */
const SIDE = [0, 1, -1, 1, -1];
const CHAIN = { top: ['top', 'S slot', 'O slot', 'S wing'], slot: ['S slot', 'O slot', 'top', 'S wing', 'O wing'], wing: ['S wing', 'O wing', 'S corner', 'O corner', 'S slot'],
  corner: ['S corner', 'O corner', 'S wing', 'O wing'], elbow: ['S elbow', 'O elbow', 'nail', 'S slot'], block: ['S block', 'O block', 'S short corner', 'O short corner'],
  dunker: ['S dunker', 'O dunker', 'S short corner', 'O short corner', 'S block'] };
const PRIO = { top: 0, block: 1, dunker: 1, elbow: 1, slot: 2, wing: 3, corner: 3 };
const DEPTH = { top: 0, slot: 1, wing: 2, corner: 3 };
const depthOf = s => DEPTH[String(s).replace(/^(left|right) /, '')];
const sideOfSpot = s => (/^left /.test(s) ? -1 : /^right /.test(s) ? 1 : 0);
function perimeter(n, hasTop, corners, away, near) {
  if (n >= 5) return ['top', 'left wing', 'right wing', 'left corner', 'right corner'];
  if (n === 4) return hasTop ? (corners >= 2 ? ['top', near + ' wing', 'left corner', 'right corner'] : ['top', 'left wing', 'right wing', away + ' corner'])
    : ['left slot', 'right slot', 'left corner', 'right corner'];
  if (n === 3) return hasTop ? (corners >= 2 ? ['top', 'left corner', 'right corner'] : ['top', 'left wing', 'right wing']) : ['left slot', 'right slot', away + ' corner'];
  if (n === 2) return hasTop ? ['top', away + (corners ? ' corner' : ' wing')] : corners >= 2 ? ['left corner', 'right corner'] : ['left wing', 'right wing'];
  return n === 1 ? ['top'] : [];
}
function permutations(a) { return a.length <= 1 ? [a.slice()] : a.flatMap((x, i) => permutations(a.slice(0, i).concat(a.slice(i + 1))).map(p => [x].concat(p))); }
function layout(roles, cards, ref) {
  const R5 = [0, 1, 2, 3, 4].map(k => { const x = roles ? roles[k] : null, r = typeof x === 'string' ? BY.get(x) : x; return r && r.slot === k ? r : resolve(null, k, cards ? cards[k] : null, ref); });
  const homes = R5.map(home), taken = new Set(), spots = [];
  const ins = [0, 1, 2, 3, 4].filter(k => INSIDE.has(homes[k])), outs = [0, 1, 2, 3, 4].filter(k => !INSIDE.has(homes[k]));
  ins.sort((a, b) => (PRIO[homes[a]] - PRIO[homes[b]]) || (a - b)).forEach(k => {
    const S = SIDE[k] >= 0 ? 'right' : 'left', O = S === 'right' ? 'left' : 'right';
    const chain = CHAIN[homes[k]].map(x => x.replace(/^S /, S + ' ').replace(/^O /, O + ' '));
    const spot = chain.find(x => !taken.has(x)) || Object.keys(SPOTS).find(x => x !== 'rim' && !taken.has(x));
    taken.add(spot); spots[k] = spot;
  });
  /* the side the bigs are on: the corner away from them is the open one */
  const inSide = ins.reduce((a, k) => a + sideOfSpot(spots[k]), 0), near = inSide > 0 ? 'right' : 'left', away = near === 'right' ? 'left' : 'right';
  const corners = outs.filter(k => homes[k] === 'corner').length, hasTop = outs.some(k => homes[k] === 'top');
  let set = perimeter(outs.length, hasTop, corners, away, near).filter(x => !taken.has(x));
  ['top', 'left wing', 'right wing', 'left corner', 'right corner', 'left slot', 'right slot'].forEach(x => { if (set.length < outs.length && !taken.has(x) && !set.includes(x)) set.push(x); });
  set = set.slice(0, outs.length);
  /* each man outside to the spot nearest his home's depth, on his side where it can be: the cheapest of every way */
  const cost = (k, x) => Math.abs((DEPTH[homes[k]] != null ? DEPTH[homes[k]] : 2) - depthOf(x)) + (SIDE[k] && sideOfSpot(x) && SIDE[k] !== sideOfSpot(x) ? 0.35 : 0);
  let best = null;
  permutations(set).forEach(p => { const c = outs.reduce((a, k, i) => a + cost(k, p[i]), 0); if (!best || c < best.c - 1e-9) best = { c, p }; });
  outs.forEach((k, i) => { spots[k] = best ? best.p[i] : 'top'; taken.add(spots[k]); });
  const inn = ins.length;
  return { roles: R5, homes, spots, at: spots.map(s => SPOTS[s]), inn, out: 5 - inn, label: inn ? (5 - inn) + '-out ' + inn + '-in' : '5-out' };
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

return { PT, ROLES, BY, CATS, SLOTS, POS_PLURAL, DEFAULT, forSlot, profile, traits, fit, bestFor, resolve, locks, family, demo, SCENES, SPOT, WORDS, SPOTS, home, layout, posGap };
}));
