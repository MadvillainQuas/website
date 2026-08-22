'use strict';
/* ============================================================================
   POSSESSIONS AND CHANCES — the unit a play type attaches to.

   This exists because of what a Synergy-style tracker actually is. Every one of
   its numbers — points per possession, frequency, percentile rank — is
   arithmetic over a list of offensive plays, each carrying one play type, one
   attributed player, and a points value. The play type is the only part a
   basketball database does not already know.

   So the whole tracker reduces to: enumerate the plays exactly, then label
   them. This file is the first half, and it needs nothing that is not already
   in the event log.

   TWO UNITS, AND CONFUSING THEM IS THE CLASSIC MISTAKE.

     POSSESSION  from gaining the ball to losing it. An offensive rebound does
                 NOT end one. This is the denominator of an offensive rating,
                 and it is what pace is counted in.

     CHANCE      one attempt sequence inside a possession: down the floor,
                 shoot or turn it over. An offensive rebound starts a NEW
                 chance in the SAME possession.

   Synergy counts CHANCES, which is why "Putback" is one of its play types at
   all — a putback is a second chance inside one possession. Aggregate play
   types over possessions instead and every second-chance play silently
   disappears into the one before it.

   WHY NOT THE ENGINE'S POSSESSION COUNT. engine.js has one already:
   0.96 × (FGA + TOV + 0.44×FTA − OREB). That is the standard ESTIMATE and it
   is right for pace, where only the total matters. It cannot be used here,
   because a play type has to attach to a particular play — you cannot label
   0.96 of anything.

   THE TRANSITION RULES ARE THE ENGINE'S. Who has the ball after each event is
   decided exactly as deriveGame decides it, including the FIBA rule that
   unsportsmanlike and disqualifying free throws keep the ball with the shooting
   team. Two sets of possession rules that drift apart is two answers to the
   same question, and this platform's whole shape is one calculator read by
   everything.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPossessions = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const PLEN = p => (p <= 4 ? 600000 : 300000);
const cumEl = (period, clock) => {
  let s = 0;
  for (let q = 1; q < Math.max(1, period || 1); q++) s += PLEN(q);
  return s + (PLEN(period || 1) - Math.max(0, clock || 0));
};

const SHOT_MADE = { p2_made: 2, p3_made: 3 };
const SHOT_MISS = { p2_miss: 2, p3_miss: 3 };
const isShot = t => t in SHOT_MADE || t in SHOT_MISS;

/* Descriptors decorate an event that is already in the walk; counting them
   would double a basket and invent a chance out of a shot location. */
const DESCRIPTOR = { loc: 1, tag: 1, stype: 1 };

/* ---------------------------------------------------------------------------
   HOW A CHANCE ENDS. The label a tagger and a model both have to agree on, and
   the thing an outcome column is built from.
   --------------------------------------------------------------------------- */
const OUTCOME = {
  MADE_2: 'made_2', MADE_3: 'made_3',
  MISS_2: 'miss_2', MISS_3: 'miss_3',
  TURNOVER: 'turnover',
  FOUL_FT: 'shooting_foul',      // ended at the line rather than with a shot
  PERIOD: 'period_end'           // the clock, not the offence
};

function enumerate(game) {
  const out = { possessions: [], chances: [] };
  if (!game || !Array.isArray(game.events)) return out;

  let poss = null;         // the open possession
  let chance = null;       // the open chance inside it
  let lastFoulKind = null;
  let pendingShot = null;  // a miss waiting on a rebound to say whose it was

  const closeChance = (outcome, ev) => {
    if (!chance) return;
    /* A chance that already knows how it ended keeps that answer. The clock
       running out is only the outcome for one that ended no other way. */
    chance.outcome = (outcome === OUTCOME.PERIOD && chance.pendingOutcome)
      ? chance.pendingOutcome : outcome;
    delete chance.pendingOutcome;
    chance.endClock = ev ? ev.clock : chance.endClock;
    chance.endPeriod = ev ? ev.period : chance.endPeriod;
    chance.endEventId = ev ? (ev.seq != null ? ev.seq : ev.id) : null;
    chance.endWall = ev && typeof ev.wall === 'number' ? ev.wall : chance.endWall;
    out.chances.push(chance);
    if (poss) poss.chances.push(chance.index);
    chance = null;
  };

  const closePossession = () => {
    if (!poss) return;
    if (chance) closeChance(OUTCOME.PERIOD, null);
    poss.points = out.chances
      .filter(c => c.possession === poss.index)
      .reduce((a, c) => a + c.points, 0);
    out.possessions.push(poss);
    poss = null;
  };

  const openPossession = (team, ev) => {
    closePossession();
    if (team == null) return;
    poss = {
      index: out.possessions.length,
      team: team,
      period: ev ? ev.period : 1,
      startClock: ev ? ev.clock : PLEN(1),
      startEventId: ev ? (ev.seq != null ? ev.seq : ev.id) : null,
      chances: [],
      points: 0
    };
    openChance(ev, false);
  };

  const openChance = (ev, secondChance) => {
    if (!poss) return;
    chance = {
      index: out.chances.length + (chance ? 1 : 0),
      possession: poss.index,
      team: poss.team,
      period: ev ? ev.period : poss.period,
      startClock: ev ? ev.clock : poss.startClock,
      startEventId: ev ? (ev.seq != null ? ev.seq : ev.id) : null,
      startWall: ev && typeof ev.wall === 'number' ? ev.wall : null,
      endWall: null,
      /* A chance that began with an offensive rebound. It is the reason chances
         exist at all — a missed shot ends a play, and the rebound starts a new
         one inside the same possession. */
      secondChance: !!secondChance,
      /* WHO GOT THE REBOUND, AND WHY IT IS NOT THE SAME QUESTION AS "PUTBACK".

         A second chance is NOT automatically a putback. The convention is that
         the rebounder must go back up with it BEFORE passing or resetting into
         something else; an offensive rebound kicked out for a fresh possession
         is whatever that possession then produced, and typically a spot-up.

         Keeping the rebounder here is what lets that distinction be drawn: if
         the man who rebounded is also the man who finished, it is a putback with
         very little doubt. If it is somebody else, the ball moved, and only the
         footage can say what it moved into. */
      rebounder: secondChance && ev ? (ev.pid || null) : null,
      points: 0,
      finisher: null,
      outcome: null
    };
    chance.index = out.chances.length;
  };

  for (const ev of game.events) {
    if (!ev || DESCRIPTOR[ev.t]) continue;

    /* A SHOT IS RESOLVED BY WHAT COMES AFTER IT, AND THAT HAS TO HAPPEN FIRST.

       A basket does not end anything on its own: a shooting foul turns it into
       an and-one, and an offensive rebound turns a miss into a second chance.
       Only the next event says which. So the pending shot is settled here, at
       the top, before any possession logic touches the state.

       Resolving it at the BOTTOM — which is where this started — meant the
       possession machinery ran first: it saw a new team, closed the possession,
       and the open chance was flushed as "period_end" before the shot that
       actually ended it could be applied. Every made basket came out labelled
       as the clock running out, and a pending shot then leaked forward onto
       somebody else's free throws. */
    if (pendingShot) {
      const sameTeam = ev.team === pendingShot.team;
      /* What can still belong to the shot: the foul on it, the free throws
         that foul produced, and an offensive rebound of it. */
      const continues =
        (ev.t === 'foul' && ev.team !== pendingShot.team) ||
        ((ev.t === 'ft_made' || ev.t === 'ft_miss') && sameTeam) ||
        (ev.t === 'reb' && ev.off && sameTeam);

      if (!continues) {
        closeChance(pendingShot.outcome, pendingShot.ev);
        /* A make ends the possession unless the free throws were
           unsportsmanlike or disqualifying, which keep the ball — the same
           rule deriveGame applies. A miss is settled by the rebound, so it
           ends nothing here. */
        if (pendingShot.made) {
          const keepsBall = lastFoulKind === 'unsport' || lastFoulKind === 'disq';
          if (!keepsBall) closePossession();
        }
        pendingShot = null;
      }
    }

    if (ev.t === 'period_start') {
      closePossession();
      /* Who starts a period is the arrow, and deriveGame already tracks it.
         Rather than keep a second copy of that rule, the possession opens at
         the first event that names a team — a shot, a turnover, a rebound. */
      continue;
    }
    if (ev.t === 'game_end') { closePossession(); continue; }

    if (ev.t === 'foul') { lastFoulKind = ev.kind || 'personal'; }

    /* The offence is whoever the event says it is, for anything that names a
       team and belongs to the team with the ball. */
    const team = ev.team;

    if (!poss && team != null &&
        (isShot(ev.t) || ev.t === 'to' || ev.t === 'ft_made' || ev.t === 'ft_miss')) {
      openPossession(team, ev);
    }

    switch (ev.t) {
      case 'p2_made': case 'p3_made': {
        if (!poss || poss.team !== team) openPossession(team, ev);
        if (chance) {
          chance.points += SHOT_MADE[ev.t];
          chance.finisher = ev.pid || chance.finisher;
        }
        /* AND-ONE. A made shot with a shooting foul on it is not the end of
           anything yet: the free throw belongs to this chance. The foul has
           not been seen at this point in the log — it follows the basket — so
           the chance is left open and closed by whatever comes next. */
        pendingShot = { made: true, team: team, ev: ev,
                        outcome: ev.t === 'p3_made' ? OUTCOME.MADE_3 : OUTCOME.MADE_2 };
        break;
      }
      case 'p2_miss': case 'p3_miss': {
        if (!poss || poss.team !== team) openPossession(team, ev);
        if (chance) chance.finisher = ev.pid || chance.finisher;
        pendingShot = { made: false, team: team, ev: ev,
                        outcome: ev.t === 'p3_miss' ? OUTCOME.MISS_3 : OUTCOME.MISS_2 };
        break;
      }
      case 'ft_made': case 'ft_miss': {
        if (!poss || poss.team !== team) openPossession(team, ev);
        if (chance) {
          if (ev.t === 'ft_made') chance.points += 1;
          if (!chance.finisher) chance.finisher = ev.pid || null;
          /* A trip to the line that did not follow a shot ended the chance
             there rather than with a field goal, and there is nothing after it
             to settle — so it is closed on the last of the free throws by the
             event that changes hands. Marked now, applied on close. */
          if (!pendingShot) chance.pendingOutcome = OUTCOME.FOUL_FT;
        }
        break;
      }
      case 'reb': {
        /* An offensive rebound is the only event that keeps a possession alive
           through a missed shot, and it is the reason chances exist at all. */
        if (pendingShot) { closeChance(pendingShot.outcome, pendingShot.ev); pendingShot = null; }
        if (ev.off) {
          if (poss) openChance(ev, true);
          else if (team != null) openPossession(team, ev);
        } else {
          closePossession();
          if (team != null) openPossession(team, ev);
        }
        break;
      }
      case 'to': {
        if (!poss || poss.team !== team) openPossession(team, ev);
        if (chance) chance.finisher = ev.pid || chance.finisher;
        closeChance(OUTCOME.TURNOVER, ev);
        closePossession();
        pendingShot = null;
        break;
      }
      case 'stl': {
        /* The steal names the DEFENDER's team; the turnover event beside it
           names the offence. Whichever arrives first, the ball has changed
           hands. */
        if (poss && poss.team !== team) {
          closeChance(OUTCOME.TURNOVER, ev);
          closePossession();
        }
        pendingShot = null;
        break;
      }
      default: break;
    }
  }

  if (pendingShot) closeChance(pendingShot.outcome, pendingShot.ev);
  closePossession();
  return out;
}

/* ---------------------------------------------------------------------------
   WHERE A CHANCE IS IN THE FOOTAGE.

   The reason this is worth anything: a tagger, and later a model, has to jump
   to the play. epinoia/video.js already turns a tap into a position in a
   recording; this hands it a whole chance, with the run-up a person needs to
   see the action develop rather than only its result.
   --------------------------------------------------------------------------- */
const LEAD_IN_MS = 6000;      // enough to see the set-up, not the previous play
const TAIL_MS = 3000;

function withVideo(chances, video, V) {
  if (!V || !video || !V.hasAnchor(video)) return [];
  const out = [];
  for (const c of chances) {
    const startAt = c.startWall != null
      ? V.videoMsOf({ wall: c.startWall }, video) : null;
    const endAt = c.endWall != null
      ? V.videoMsOf({ wall: c.endWall }, video) : null;
    if (startAt == null && endAt == null) continue;
    const from = startAt != null ? startAt : endAt;
    const to = endAt != null ? endAt : startAt;
    out.push(Object.assign({}, c, {
      videoStart: Math.max(0, from - LEAD_IN_MS),
      videoEnd: to + TAIL_MS,
      videoAt: from
    }));
  }
  return out;
}

/* ---------------------------------------------------------------------------
   The numbers a play-type tracker reports, over whatever set of chances it is
   handed. Points per chance is the headline; frequency is the share of a
   player's or team's chances that were of that type.
   --------------------------------------------------------------------------- */
function summarise(chances) {
  const n = chances.length;
  const pts = chances.reduce((a, c) => a + c.points, 0);
  const scoring = chances.filter(c => c.points > 0).length;
  const tov = chances.filter(c => c.outcome === OUTCOME.TURNOVER).length;
  const fga = chances.filter(c => c.outcome && /^(made|miss)_/.test(c.outcome)).length;
  const made = chances.filter(c => c.outcome === OUTCOME.MADE_2 ||
                                   c.outcome === OUTCOME.MADE_3).length;
  return {
    chances: n,
    points: pts,
    /* The Synergy headline. Points divided by plays, not by possessions —
       see the note at the top about which unit this is. */
    ppp: n ? pts / n : 0,
    scoreFrequency: n ? scoring / n : 0,
    turnoverFrequency: n ? tov / n : 0,
    fga: fga,
    fgPct: fga ? made / fga : 0
  };
}

return { enumerate, withVideo, summarise, OUTCOME, cumEl, LEAD_IN_MS, TAIL_MS };
}));
