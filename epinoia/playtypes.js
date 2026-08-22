'use strict';
/* ============================================================================
   PLAY TYPES — the one field a basketball database does not already know.

   A Synergy-style tracker is not a computer-vision product. It is a table with
   one row per offensive play, carrying a type, an attributed player, and a
   points value; every number it reports — points per play, frequency, rank —
   is arithmetic over that table. epinoia/possessions.js already produces every
   column but one, exactly, from the event log.

   The missing column is the type. That is the entire problem, and it is worth
   saying plainly because it decides how the thing gets built: a human with the
   footage can fill it in from day one, and a model can fill it in later
   WITHOUT ANY OTHER PART OF THE SYSTEM CHANGING. The aggregation below does not
   know or care which of them wrote the label.

   THE TAXONOMY IS A CONTRACT. A tagger, a model and every report have to mean
   the same thing by "handoff". So the list is closed, versioned, and each entry
   says what it is in the words a coach would use — not a definition invented
   here. Adding a type is a version bump, never an edit, because a label written
   last season has to keep meaning what it meant when it was written.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPlayTypes = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const VERSION = 1;

/* ---------------------------------------------------------------------------
   THE OFFENSIVE PLAY TYPES.

   Deliberately the industry's own set rather than a better one. A league that
   buys this is comparing its numbers with numbers it has seen elsewhere, and a
   taxonomy that is cleverer but incomparable is worth less than one that is
   ordinary and lines up.

   ROLE matters as much as type: a pick-and-roll produces TWO tracked plays
   depending on who finishes it, and they are scouted completely differently —
   the guard who comes off it and the big who rolls out of it are different
   players having different nights.
   --------------------------------------------------------------------------- */
const TYPES = [
  { key: 'pnr_handler', label: 'P&R ball handler', family: 'pnr',
    hint: 'The ball handler keeps it off a ball screen — shoots, drives or turns it over.' },
  { key: 'pnr_roll',    label: 'P&R roll man', family: 'pnr',
    hint: 'The screener finishes: a roll, a slip, or a pop behind the screen.' },
  { key: 'isolation',   label: 'Isolation', family: 'iso',
    hint: 'One-on-one, no screen, the defence left to deal with it alone.' },
  { key: 'post_up',     label: 'Post-up', family: 'post',
    hint: 'A player receives with his back to the basket and works from there.' },
  { key: 'spot_up',     label: 'Spot-up', family: 'catch',
    hint: 'Catch and shoot, or catch and drive, without a screen for the shooter.' },
  { key: 'off_screen',  label: 'Off screen', family: 'catch',
    hint: 'The shooter comes off an off-ball screen — a curl, a flare, a fade.' },
  { key: 'handoff',     label: 'Hand-off', family: 'pnr',
    hint: 'A dribble hand-off, with or without the screen that usually follows.' },
  { key: 'cut',         label: 'Cut', family: 'cut',
    hint: 'A basket cut finished at the rim — backdoor, flash, or off a duck-in.' },
  { key: 'putback',     label: 'Putback', family: 'second',
    hint: 'A second chance finished off an offensive rebound.' },
  { key: 'transition',  label: 'Transition', family: 'transition',
    hint: 'Before the defence is set — a break, a leak-out, an early drag.' },
  { key: 'misc',        label: 'Miscellaneous', family: 'misc',
    hint: 'A play that is genuinely none of the above. Rare, and worth reading.' }
];

const BY_KEY = {};
TYPES.forEach(t => { BY_KEY[t.key] = t; });
const isType = k => Object.prototype.hasOwnProperty.call(BY_KEY, k);

/* ---------------------------------------------------------------------------
   HOW A DEFENCE PLAYED IT. Only meaningful for the screening families, and the
   half of pick-and-roll scouting that actually changes what a coach does.
   --------------------------------------------------------------------------- */
const COVERAGES = [
  { key: 'drop',    label: 'Drop',        hint: 'The big sits back at the level of the screen or below.' },
  { key: 'hedge',   label: 'Hedge',       hint: 'The big steps out and recovers.' },
  { key: 'blitz',   label: 'Blitz / trap', hint: 'Two to the ball, forcing it out.' },
  { key: 'switch',  label: 'Switch',      hint: 'The two defenders exchange assignments.' },
  { key: 'ice',     label: 'Ice / down',  hint: 'The screen is refused and the ball forced to the sideline.' },
  { key: 'over',    label: 'Over the top', hint: 'The on-ball defender fights over and stays attached.' },
  { key: 'under',   label: 'Under',       hint: 'The on-ball defender goes beneath the screen.' },
  { key: 'unknown', label: 'Not clear',   hint: 'The camera did not show it. Honest, and better than a guess.' }
];
const COVERAGE_BY_KEY = {};
COVERAGES.forEach(c => { COVERAGE_BY_KEY[c.key] = c; });

/* WHERE A LABEL CAME FROM, and it is never mixed silently.

   A model's guess and a human's judgement are not the same evidence, and a
   report that averages them without saying so is a report nobody can defend.
   Every tag carries this, every aggregation can filter on it, and the default
   everywhere is to show them apart. */
const SOURCE = { HUMAN: 'human', MODEL: 'model' };

/* ---------------------------------------------------------------------------
   WHAT THE LOG CAN ALREADY TELL US — and, just as important, what it cannot.

   Two of these types are fully determined by the event log, so nobody should
   ever be asked to tag them:

     putback     a chance that began with an offensive rebound. That is the
                 definition, and possessions.js already marks it.
     transition  a chance that began within a few seconds of the other team
                 losing the ball. A time test, not a judgement.

   EVERYTHING ELSE NEEDS EYES. The log records no passes bar assists, no
   screens, and no dribbles, so it cannot distinguish a pick-and-roll from an
   isolation — they look identical in it. Pretending otherwise would produce a
   tracker that is confidently wrong, which is worse than an empty one.
   --------------------------------------------------------------------------- */
const TRANSITION_WINDOW_MS = 7000;

function suggest(chance, prevChance) {
  if (!chance) return null;
  if (chance.secondChance) {
    return { type: 'putback', confidence: 1, why: 'began with an offensive rebound' };
  }
  if (prevChance && prevChance.team !== chance.team &&
      prevChance.outcome === 'turnover' &&
      chance.startWall != null && prevChance.endWall != null &&
      (chance.startWall - prevChance.endWall) <= TRANSITION_WINDOW_MS) {
    return { type: 'transition', confidence: 0.8,
             why: 'started within seven seconds of a live-ball turnover' };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   THE REPORT. One row per play type, for whatever set of tagged chances it is
   given — a player, a team, a season, a defence.
   --------------------------------------------------------------------------- */
function report(tagged, opts) {
  const o = opts || {};
  const rows = {};
  let total = 0;

  for (const t of tagged) {
    if (!t || !isType(t.type)) continue;
    if (o.source && t.source !== o.source) continue;
    if (o.minConfidence != null && (t.confidence || 0) < o.minConfidence) continue;

    const r = rows[t.type] || (rows[t.type] = {
      type: t.type, label: BY_KEY[t.type].label, family: BY_KEY[t.type].family,
      plays: 0, points: 0, scores: 0, turnovers: 0, fga: 0, fgm: 0,
      human: 0, model: 0
    });
    r.plays++; total++;
    r.points += t.points || 0;
    if ((t.points || 0) > 0) r.scores++;
    if (t.outcome === 'turnover') r.turnovers++;
    if (/^(made|miss)_/.test(t.outcome || '')) { r.fga++; if (/^made_/.test(t.outcome)) r.fgm++; }
    if (t.source === SOURCE.MODEL) r.model++; else r.human++;
  }

  const list = Object.values(rows).map(r => Object.assign(r, {
    /* THE HEADLINE. Points per play — the number every one of these reports is
       read for, and the reason the unit had to be a chance rather than a
       possession. */
    ppp: r.plays ? r.points / r.plays : 0,
    frequency: total ? r.plays / total : 0,
    scoreFrequency: r.plays ? r.scores / r.plays : 0,
    turnoverFrequency: r.plays ? r.turnovers / r.plays : 0,
    fgPct: r.fga ? r.fgm / r.fga : 0
  }));

  list.sort((a, b) => b.plays - a.plays);
  return { version: VERSION, total: total, types: list };
}

/* A row is only worth reading at a sample it can support. Six plays at 1.50
   points a play is not a strength, it is six plays — and a tracker that prints
   it as a strength is one a coach stops trusting. */
const THIN = 15;
const isThin = row => row.plays < THIN;

return { VERSION, TYPES, BY_KEY, isType, COVERAGES, COVERAGE_BY_KEY, SOURCE,
         suggest, report, isThin, THIN, TRANSITION_WINDOW_MS };
}));
