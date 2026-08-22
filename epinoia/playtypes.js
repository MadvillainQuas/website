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

   ---------------------------------------------------------------------------
   THE ATTRIBUTION RULE, WHICH IS THE MOST IMPORTANT LINE IN THIS FILE

   A play is typed by THE ACTION THAT ENDED THE CHANCE, not by the action that
   started it.

   If a ball screen is set, the handler comes off it, draws two, and kicks to a
   shooter in the corner who shoots — that chance is a SPOT_UP. It is not a
   pick-and-roll, even though a pick-and-roll is plainly what the offence ran,
   and even though the screen is why the shot existed. The chance ended with a
   spot-up shooter, so it is charged to the spot-up.

   This is the industry convention and it is not obvious; roughly half of all
   spot-ups in a professional season arise this way, out of pick-and-rolls,
   isolations and post-ups that were passed out of. Anyone typing plays by what
   the offence was RUNNING rather than by how the chance ENDED will produce a
   table that disagrees with every other table in basketball, in a way that
   looks like a modest difference of opinion and is in fact a different
   statistic wearing the same column headings.

   THE ONE DOCUMENTED EXCEPTION: A DOUBLE TEAM ON THE ROOT ACTION.

   When the player running an Isolation, a Post-up or a Pick and Roll is
   DOUBLE TEAMED and gives the ball up because of it, the chance stays with him
   and with his action — it does not become a spot-up. The vendor whose taxonomy
   this mirrors carries two player fields for exactly this case, a root player
   and the player who finished, and says they differ precisely when a double team
   on one of those three actions forced the ball out.

   The reasoning is sound and worth understanding rather than memorising: the
   defence chose to send two, so the shot that resulted is a consequence of the
   root action working, not of the shooter standing in a corner. Charging it to
   the spot-up would credit the offence's best action to whoever it happened to
   free up.

   Note the boundary carefully. It is a DOUBLE TEAM, not ordinary help, and it
   applies to THREE actions only. A handler who draws one defender a step across
   and kicks out has produced a spot-up, exactly as rule above says.

   Two consequences worth stating out loud:

     - A tracker built this way UNDERCOUNTS pick-and-roll relative to how often
       teams actually run it, and the size of that gap is not small. Geometric
       screen detectors find roughly 47 ball screens per team per game; a
       possession-ending tracker logs something like 15 to 20 pick-and-roll
       ball-handler plays in the same game. Both numbers are right. They are
       answers to different questions, and anybody comparing them without
       knowing that will conclude the tracker is broken.
     - It also means the type answers "how did this chance finish", which is the
       question points-per-play is an answer to. That coherence is the reason
       the convention is what it is.
   --------------------------------------------------------------------------- */
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
  /* MISC IS A BASKETBALL JUDGEMENT, NOT A CONFESSION.

     It means the play really was none of the above — a scramble, a broken
     set, an end-of-clock heave, an illegal screen. It is a genuine category
     with a genuine and famously poor points-per-play, which is exactly why a
     chance nobody could READ must never be filed here. That is a footage
     problem, and mixing footage problems into misc quietly turns a statement
     about bad offence into a statement about bad camera work.

     A chance that cannot be read is left UNTAGGED. Coverage then reads 94%
     instead of 100%, which is the honest thing for it to say. (The commercial
     API this taxonomy mirrors carries both values for the same reason — a
     "no play type" distinct from an "unknown".) */
  { key: 'misc',        label: 'Miscellaneous', family: 'misc',
    hint: 'A play that is genuinely none of the above. Not "I could not tell" — ' +
          'that is left untagged.' }
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
/* A TIME WINDOW IS A PROXY, AND IT IS THE WRONG DEFINITION.

   Transition is properly defined by THE DEFENCE NOT BEING SET — the industry
   convention has no clock cutoff at all, precisely because a slow break against
   a scrambling defence is transition and a fast one into a set defence is not.
   The event log cannot see a defence, so it cannot apply the real definition.

   Seven seconds after a live-ball turnover is therefore a deliberate
   approximation, offered at confidence 0.8 rather than 1 for that reason, and
   it is the one suggestion here that a tagger should feel free to overrule from
   the footage. `putback` is a definition and cannot be overruled; this is a
   guess and can. */
const TRANSITION_WINDOW_MS = 7000;

function suggest(chance, prevChance) {
  if (!chance) return null;
  /* A SECOND CHANCE IS NOT AUTOMATICALLY A PUTBACK.

     This used to return putback at confidence 1 for any chance that began with
     an offensive rebound, and that is not what the type means. The convention
     requires the rebounder to go back up with it BEFORE passing the ball or
     settling into another action. An offensive rebound kicked back out to the
     arc is a spot-up, or whatever else the reset produced — and roughly as
     often as not, that is what happens.

     So the log can only settle this when the man who rebounded is the man who
     finished. Then the ball never left him and it is a putback with very little
     doubt — though not none, which is why it is 0.95 rather than 1: he could
     have given it up and got it straight back.

     When somebody else finished it, the ball moved, and the log records no
     passes. That chance needs an eye like any other. */
  if (chance.secondChance) {
    if (chance.rebounder && chance.finisher && chance.rebounder === chance.finisher) {
      return { type: 'putback', confidence: 0.95,
               why: 'the player who took the offensive rebound also finished it' };
    }
    return null;
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

  let dropped = 0;
  for (const t of tagged) {
    if (!t || !isType(t.type)) continue;
    if (o.source && t.source !== o.source) continue;
    if (o.minConfidence != null && (t.confidence || 0) < o.minConfidence) continue;

    /* THE DENOMINATOR IS NOT "EVERY CHANCE". IT IS EVERY CHANCE THAT ENDED.

       A play counts when it ends in a field-goal attempt, a turnover, or a foul
       that sends someone to the line. A chance that simply ran out of clock
       ended in none of those — the offence was interrupted, not completed — and
       counting it adds a guaranteed nought to the numerator and a one to the
       denominator. Every play type it touches is dragged down, and the types it
       touches most are the ones run late in a period, so the bias is not even
       spread evenly.

       Left in the tag list rather than filtered by the caller, because a caller
       that forgets is a caller that quietly under-reports. `endedPlays` says how
       many were actually counted so the difference is visible. */
    if (t.outcome === 'period_end') { dropped++; continue; }

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
  return { version: VERSION, total: total, types: list,
           /* Chances that were tagged but did not end in a shot, a turnover or
              a foul — clock-outs at the end of a period. Reported so nobody has
              to wonder why the counts do not add up to the tag list. */
           notEnded: dropped };
}

/* A row is only worth reading at a sample it can support. Six plays at 1.50
   points a play is not a strength, it is six plays — and a tracker that prints
   it as a strength is one a coach stops trusting. */
/* WHAT A SAMPLE HAS TO REACH BEFORE A ROW MEANS ANYTHING.

   THIN was 15, which was far too generous and would have let this platform
   publish rankings that are noise. The arithmetic is not close: points per play
   has a standard deviation near 1.05, so the 95% half-width is about +/-0.29 at
   50 plays, +/-0.21 at 100, and +/-0.10 at 400. The difference between an elite
   and a poor play type is roughly 0.15 to 0.25 points per play. So below a few
   hundred plays the interval swallows the entire effect being reported, and a
   league table built on it ranks sampling noise.

   Two thresholds, because they answer different questions:
     THIN         below this a row should not be shown at all.
     RESOLVABLE   below this a row may be shown WITH ITS INTERVAL, but must
                  never be ranked against another row.

   Worth knowing: the commercial standard is weaker than this. Synergy's own
   percentile ranks are published with no stated minimum sample at all, and the
   best-known public criticism of them is exactly this — that at 150 plays a
   single made three moves a player two points per hundred and reorders the
   leaderboard. Being stricter than the incumbent is the correct call here. */
const THIN = 50;
const RESOLVABLE = 400;
const isThin = row => row.plays < THIN;
const isResolvable = row => row.plays >= RESOLVABLE;

return { VERSION, TYPES, BY_KEY, isType, COVERAGES, COVERAGE_BY_KEY, SOURCE,
         suggest, report, isThin, THIN, isResolvable, RESOLVABLE,
         TRANSITION_WINDOW_MS };
}));
