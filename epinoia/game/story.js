'use strict';
/* ============================================================================
   THE MATCH REPORT ENGINE.

   Two jobs, one machine: the preview written before a game, and the long-form
   report written the moment it finishes. Both are the same problem — decide
   what is worth saying about a pile of numbers, then say it — so both run
   through the same three stages, which is how natural-language generation is
   built when it has to be right rather than merely fluent:

       FACTS        mine everything the game produced and turn each finding
                    into a typed object carrying its own numbers
       SALIENCE     score every fact for how newsworthy it is, and drop the
                    ones that are merely true
       REALISATION  turn the survivors into sentences, in an order a person
                    would actually write them

   The point of the split is that the interesting work happens in the first two
   stages, where it can be tested. A fact is a structure with numbers in it, so
   "was this claim right" is a question with an answer; only the last stage
   deals in words. It is also the reason this can be handed to a language model
   later without being rewritten: facts() already produces exactly the
   structured brief such a model needs, and realise() becomes one of two
   possible back ends rather than the whole system.

   WHY IT DERIVES RATHER THAN PROMPTS, for now. The report sits directly above
   the box score it describes, so a sentence that disagrees with the table
   underneath it is worse than no sentence — and inventing a plausible number
   is the one thing a language model reliably does when asked to write about
   sport. Everything here is computed from the event log, so a claim cannot
   drift from the data it came from. It costs nothing per view, needs no key on
   a public page, and reads the same on the second refresh as on the first.

   WHAT IT READS. Everything the game produced: the replayed event log, the
   derived box, quarter scoring, the four factors both ways, shot locations,
   and — the part that makes it more than a table in prose — the LINEUP STINTS,
   which is where "the game was decided in a six-minute stretch in the third"
   actually lives. Nothing else on the platform can see that, because nothing
   else replays possession-by-possession who was on the floor.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStory = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const num  = v => (v == null || v === '' || isNaN(v) ? null : +v);
const one  = v => (num(v) == null ? '—' : (+v).toFixed(1));
const pct1 = v => (num(v) == null ? '—' : (+v).toFixed(1) + '%');
const mins = ms => Math.floor((ms || 0) / 60000) + ':' +
  String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0');
const plural = (n, s, p) => n + ' ' + (n === 1 ? s : (p || s + 's'));

/* A fact is { kind, side, salience, data, text }. `side` is 0, 1 or null for
   something about the game rather than about one club. Salience is on an open
   scale — nothing depends on the maximum, only on the order. */
const F = (kind, side, salience, data, text) =>
  ({ kind, side, salience, data, text });

/* ============================================================== extractors ===
   Each returns an array of facts, or none. They are deliberately independent:
   a new one can be added without touching the others, and one that finds
   nothing simply contributes nothing to the report. */

/* ---- the result, and how comfortable it was ------------------------------ */
function factResult(g) {
  const [a, b] = g.score;
  const w = a >= b ? 0 : 1, l = 1 - w;
  const margin = Math.abs(a - b);
  const how = margin === 0 ? 'tie'
            : margin <= 3  ? 'squeaker'
            : margin <= 8  ? 'close'
            : margin <= 15 ? 'comfortable'
            : margin <= 25 ? 'convincing'
            : 'rout';
  return [F('result', w, 100,
    { winner: w, loser: l, margin, how, score: [a, b] },
    g.names[w] + ' beat ' + g.names[l] + ' ' + Math.max(a, b) + '–' + Math.min(a, b))];
}

/* ---- quarter by quarter: where the game actually turned ------------------ */
function factQuarters(g) {
  const out = [];
  const per = g.perQ;                       // per[t][p] = points
  const last = g.periods;
  let best = null;
  for (let p = 1; p <= last; p++) {
    const d0 = (per[0][p] || 0) - (per[1][p] || 0);
    if (best == null || Math.abs(d0) > Math.abs(best.diff)) {
      best = { period: p, diff: d0, pf: per[0][p] || 0, pa: per[1][p] || 0 };
    }
  }
  if (best && Math.abs(best.diff) >= 6) {
    const side = best.diff > 0 ? 0 : 1;
    out.push(F('quarter', side, 78, best,
      g.names[side] + ' won the ' + ordinal(best.period) + ' by ' +
      Math.abs(best.diff)));
  }
  /* a side that was outscored in every period has been beaten in a particular
     way, and it is worth saying so rather than only reporting the total */
  for (const t of [0, 1]) {
    let all = true;
    for (let p = 1; p <= last; p++) if ((per[t][p] || 0) >= (per[1 - t][p] || 0)) all = false;
    if (all && last >= 4) {
      out.push(F('sweep', 1 - t, 74, { periods: last },
        g.names[1 - t] + ' won every period'));
    }
  }
  return out;
}

/* ---- scoring runs, lead changes, the biggest lead ------------------------ */
/* Walked from the event log rather than inferred from the box, because a run
   is a sequence and a box score has no sequence in it. */
function factFlow(g) {
  const out = [];
  const ev = g.events || [];
  const pts = { p2_made: 2, p3_made: 3, ft_made: 1 };
  let s = [0, 0], lead = [0, 0], changes = 0, prevLeader = null;
  let run = { team: null, n: 0 }, bestRun = null;
  let lastPeriod = 1, runStartClock = null;

  ev.forEach(e => {
    const v = pts[e.t];
    if (e.period) lastPeriod = e.period;
    if (!v || e.team == null) return;
    s[e.team] += v;

    /* the run */
    if (run.team === e.team) run.n += v;
    else { run = { team: e.team, n: v, period: lastPeriod, clock: e.clock }; }
    if (!bestRun || run.n > bestRun.n) {
      bestRun = { team: run.team, n: run.n, period: run.period, clock: run.clock };
    }

    /* leads and lead changes */
    const diff = s[0] - s[1];
    const leader = diff > 0 ? 0 : diff < 0 ? 1 : null;
    if (leader != null && prevLeader != null && leader !== prevLeader) changes++;
    if (leader != null) prevLeader = leader;
    if (diff > lead[0]) lead[0] = diff;
    if (-diff > lead[1]) lead[1] = -diff;
  });

  if (bestRun && bestRun.n >= 8) {
    out.push(F('run', bestRun.team, 88, bestRun,
      g.names[bestRun.team] + ' put together a ' + bestRun.n + '–0 run'));
  }
  const biggest = lead[0] >= lead[1] ? { side: 0, by: lead[0] } : { side: 1, by: lead[1] };
  if (biggest.by >= 10) {
    out.push(F('biggestLead', biggest.side, 60, biggest,
      g.names[biggest.side] + ' led by as many as ' + biggest.by));
  }
  if (changes >= 8) {
    out.push(F('leadChanges', null, 72, { changes },
      plural(changes, 'lead change')));
  }
  /* a win after trailing by a distance is the story of the game */
  const w = g.score[0] >= g.score[1] ? 0 : 1;
  const deficit = lead[1 - w];
  if (deficit >= 10) {
    out.push(F('comeback', w, 95, { deficit },
      g.names[w] + ' came back from ' + deficit + ' down'));
  }
  return out;
}

/* ---- the four factors, and which one actually decided it ----------------- */
function factFactors(g) {
  const out = [];
  const FF = [
    { k: 'efg',  label: 'shooting',        get: t => g.adv[t].efg,   unit: '%', big: 4 },
    { k: 'tov',  label: 'turnovers',       get: t => g.adv[t].tovp,  unit: '%', big: 4, low: true },
    { k: 'oreb', label: 'the offensive glass', get: t => g.adv[t].orebp, unit: '%', big: 8 },
    { k: 'ftr',  label: 'free throws',     get: t => g.adv[t].ftr,   unit: '%', big: 8 }
  ];
  FF.forEach(f => {
    const a = num(f.get(0)), b = num(f.get(1));
    if (a == null || b == null) return;
    const raw = a - b;
    const gap = f.low ? -raw : raw;                 // positive => side 0 better
    if (Math.abs(gap) < f.big) return;
    const side = gap > 0 ? 0 : 1;
    out.push(F('factor', side, 70 + Math.min(15, Math.abs(gap)),
      { factor: f.k, label: f.label, a, b, gap: Math.abs(gap), low: !!f.low },
      g.names[side] + ' won ' + f.label));
  });
  return out;
}

/* ---- the lineups: the part no table on this platform shows --------------- */
/* An aggregated lineup is a group of five and what happened while they were
   out there. The report wants two things from it: the group that decided the
   game, and — when one stretch dominates — the stretch itself. */
function factLineups(g) {
  const out = [];
  for (const t of [0, 1]) {
    const rows = (g.lineups[t] || []).filter(l => l.dur >= 180000);   // 3 minutes
    if (!rows.length) continue;
    rows.sort((x, y) => (y.pf - y.pa) - (x.pf - x.pa));
    const top = rows[0], bottom = rows[rows.length - 1];

    if (top && (top.pf - top.pa) >= 6) {
      out.push(F('lineupBest', t, 84,
        { ids: top.ids, pm: top.pf - top.pa, dur: top.dur,
          ortg: top.ortg, drtg: top.drtg, net: top.net },
        g.names[t] + '’s best group was ' + (top.pf - top.pa > 0 ? '+' : '') +
        (top.pf - top.pa)));
    }
    if (bottom && bottom !== top && (bottom.pf - bottom.pa) <= -6) {
      out.push(F('lineupWorst', t, 66,
        { ids: bottom.ids, pm: bottom.pf - bottom.pa, dur: bottom.dur },
        g.names[t] + ' struggled with one group'));
    }
  }
  /* THE DECIDING STRETCH. Individual stints, not aggregates: the single
     unbroken spell that moved the score furthest. This is the sentence the
     brief asked for — "this stretch, with this five on the floor, was the
     game" — and it is only answerable because the engine replays substitutions
     alongside scoring. */
  let best = null;
  for (const t of [0, 1]) {
    (g.stints[t] || []).forEach(l => {
      if (l.dur < 120000) return;                    // two minutes of basketball
      const swing = l.pf - l.pa;
      if (best == null || Math.abs(swing) > Math.abs(best.swing)) {
        best = { side: t, swing, dur: l.dur, ids: l.ids };
      }
    });
  }
  if (best && Math.abs(best.swing) >= 9) {
    const side = best.swing > 0 ? best.side : 1 - best.side;
    out.push(F('stretch', side, 92,
      { ids: best.ids, owner: best.side, swing: Math.abs(best.swing), dur: best.dur },
      'a ' + mins(best.dur) + ' stretch worth ' + Math.abs(best.swing) + ' points'));
  }
  return out;
}

/* ---- individual performances -------------------------------------------- */
function factPlayers(g) {
  const out = [];
  g.players.forEach(p => {
    if (!p.min) return;
    const pts = p.pts || 0, reb = (p.or || 0) + (p.dr || 0), ast = p.ast || 0;
    const dd = [pts >= 10, reb >= 10, ast >= 10, (p.stl || 0) >= 10, (p.blk || 0) >= 10]
      .filter(Boolean).length;
    if (dd >= 3) {
      out.push(F('tripleDouble', p.team, 99, { p }, p.name + ' had a triple-double'));
    } else if (dd === 2) {
      out.push(F('doubleDouble', p.team, 80, { p },
        p.name + ' had ' + pts + ' and ' + reb));
    }
    if (pts >= 20) {
      out.push(F('bigScore', p.team, 76 + Math.min(14, pts - 20), { p },
        p.name + ' scored ' + pts));
    }
    /* efficiency worth remarking on, in either direction, on real volume */
    const fga = (p.p2a || 0) + (p.p3a || 0);
    if (fga >= 8 && num(p.ts) != null) {
      if (p.ts >= 65) out.push(F('efficient', p.team, 68, { p }, p.name + ' was ruthless'));
      else if (p.ts <= 35) out.push(F('inefficient', p.team, 52, { p },
        p.name + ' could not find it'));
    }
    if ((p.p3m || 0) >= 4) {
      out.push(F('shooter', p.team, 71, { p },
        p.name + ' hit ' + p.p3m + ' from three'));
    }
  });
  return out;
}

/* ---- the bench, and the turnover-to-points chain ------------------------- */
function factTeamShape(g) {
  const out = [];
  for (const t of [0, 1]) {
    const T = g.team[t], O = g.team[1 - t];
    if (num(T.bench) != null && T.bench >= 25 && T.bench > (O.bench || 0) + 10) {
      out.push(F('bench', t, 64, { bench: T.bench, other: O.bench || 0 },
        g.names[t] + '’s bench outscored the other'));
    }
    if (num(T.pot) != null && T.pot >= 16) {
      out.push(F('pointsOffTurnovers', t, 62, { pot: T.pot, tov: O.toTot },
        g.names[t] + ' punished turnovers'));
    }
    if (num(T.paint) != null && O.paint != null && T.paint - O.paint >= 14) {
      out.push(F('paint', t, 58, { a: T.paint, b: O.paint },
        g.names[t] + ' owned the paint'));
    }
    if (num(T.sc) != null && T.sc >= 14) {
      out.push(F('secondChance', t, 56, { sc: T.sc },
        g.names[t] + ' scored on second chances'));
    }
  }
  return out;
}

/* ---- defence: the half of the game the report never mentioned ------------
   Measured 0 of 12 games talking about a steal, a block or a defensive rating,
   which is a report describing one team's night twice rather than two teams'
   once. Forced turnovers are the honest version of "they defended well": a
   turnover is credited to whoever gave it away, so the defence's share of it
   only exists as the opponent's turnover rate. */
function factDefence(g) {
  const out = [];
  for (const t of [0, 1]) {
    const A = g.adv[t], O = g.adv[1 - t];
    if (!A || !O) continue;

    /* a defensive rating well clear of the other end of the floor */
    if (num(A.drtg) != null && num(O.drtg) != null) {
      const gap = num(O.drtg) - num(A.drtg);
      if (gap >= 12) {
        out.push(F('defRating', t, 73, { drtg: A.drtg, theirs: O.drtg, gap },
          g.names[t] + ' defended far better'));
      }
    }
    /* turnovers forced, read off the opponent's rate */
    if (num(O.tovp) != null && O.tovp >= 18) {
      out.push(F('forcedTurnovers', t, 69, { rate: O.tovp, tov: (g.team[1 - t] || {}).toTot },
        g.names[t] + ' forced the ball loose'));
    }
    /* the disruptive individuals, taken together rather than one at a time */
    const mine = g.players.filter(p => p.team === t);
    const stl = mine.reduce((a, p) => a + (p.stl || 0), 0);
    const blk = mine.reduce((a, p) => a + (p.blk || 0), 0);
    if (stl + blk >= 12) {
      const topS = mine.slice().sort((a, b) => (b.stl || 0) - (a.stl || 0))[0];
      const topB = mine.slice().sort((a, b) => (b.blk || 0) - (a.blk || 0))[0];
      out.push(F('disruption', t, 64, { stl, blk, topS, topB },
        g.names[t] + ' were busy defensively'));
    }
  }
  /* a single defensive performance worth naming */
  g.players.forEach(p => {
    if ((p.stl || 0) >= 4 || (p.blk || 0) >= 4) {
      out.push(F('defender', p.team, 67, { p },
        p.name + ' was a problem defensively'));
    }
  });
  return out;
}

/* ---- fouls: trouble, disqualification, and who lived at the line --------- */
function factFouls(g) {
  const out = [];
  g.players.forEach(p => {
    /* dq is the engine's own disqualification flag, set when a player is
       actually sent off; counting to five fouls guesses at the same thing
       and gets it wrong wherever the rule differs. */
    if (p.dq || (p.pf || 0) >= 5) {
      out.push(F('fouledOut', p.team, 75, { p },
        p.name + ' fouled out'));
    } else if ((p.pf || 0) === 4 && (p.min || 0) > 900000) {
      out.push(F('foulTrouble', p.team, 48, { p },
        p.name + ' played the closing stretch on four'));
    }
    if ((p.fd || 0) >= 7) {
      out.push(F('drawsFouls', p.team, 58, { p },
        p.name + ' kept getting to the line'));
    }
  });
  /* a whistle that fell one way all night is part of how a game felt */
  const fa = (g.team[0] || {}).foulTot, fb = (g.team[1] || {}).foulTot;
  if (num(fa) != null && num(fb) != null && Math.abs(fa - fb) >= 8) {
    const side = fa < fb ? 0 : 1;
    out.push(F('whistle', side, 54, { mine: Math.min(fa, fb), theirs: Math.max(fa, fb) },
      'the whistle favoured ' + g.names[side]));
  }
  return out;
}

/* ---- ball movement ------------------------------------------------------- */
function factPassing(g) {
  const out = [];
  for (const t of [0, 1]) {
    const A = g.adv[t];
    if (!A) continue;
    if (num(A.astp) != null && A.astp >= 60) {
      out.push(F('sharing', t, 61, { astp: A.astp },
        g.names[t] + ' shared it'));
    }
  }
  g.players.forEach(p => {
    if ((p.ast || 0) >= 7) {
      out.push(F('creator', p.team, 72, { p, ratio: (p.to || 0) ? (p.ast / p.to) : null },
        p.name + ' set the table'));
    }
  });
  return out;
}

/* ---- where the shots came from ------------------------------------------- */
/* The engine already splits attempts by zone. A side that won by living at the
   rim and one that won from the arc played different games, and a report that
   only gives a shooting percentage cannot tell them apart. */
function factZones(g) {
  const out = [];
  for (const t of [0, 1]) {
    const A = g.adv[t], O = g.adv[1 - t];
    if (!A || !O) continue;

    /* Rim and mid-range attempts only exist for shots the statistician
       LOCATED (engine.js isRim reads locs[ev.id]); a game scored without shot
       positions has rimA at zero, which would read as a side that never went
       inside. Only speak about shot diet when most of the two-pointers can
       actually be placed. */
    const twos = num(A.fga) - num(A.fg3a);
    const placed = num(A.rimA) + num(A.midA);
    const trusted = twos > 0 && placed / twos >= 0.6;

    if (trusted && num(A.rimr) != null && num(O.rimr) != null &&
        A.rimr - O.rimr >= 12) {
      out.push(F('atRim', t, 63,
        { share: A.rimr, theirs: O.rimr, acc: num(A.rimp) },
        g.names[t] + ' worked inside'));
    }
    if (num(A.p3r) != null && num(O.p3r) != null && A.p3r - O.p3r >= 12) {
      /* three-point attempts need no location, so this one is always safe */
      out.push(F('fromRange', t, 63,
        { share: A.p3r, theirs: O.p3r, acc: num(A.p3p) },
        g.names[t] + ' shot from distance'));
    }
  }
  return out;
}

/* ---- tempo and efficiency ------------------------------------------------ */
function factTempo(g) {
  const out = [];
  const A = g.adv[0], B = g.adv[1];
  if (!A || !B) return out;
  if (num(A.pace) != null && A.pace >= 78) {
    out.push(F('fast', null, 50, { pace: A.pace }, 'it was played at pace'));
  } else if (num(A.pace) != null && A.pace > 0 && A.pace <= 62) {
    out.push(F('slow', null, 50, { pace: A.pace }, 'it was a slow game'));
  }
  for (const t of [0, 1]) {
    const T = g.adv[t];
    if (num(T.ortg) != null && T.ortg >= 120) {
      out.push(F('efficientTeam', t, 66, { ortg: T.ortg },
        g.names[t] + ' scored at will'));
    }
  }
  return out;
}

/* ---- SEASON CONTEXT: is this normal for them? ----------------------------
   The single largest gap the evaluator found. "24 points" is a fact; "24
   points, nine clear of his average" is the sentence somebody reads. Only runs
   when the caller supplied season aggregates — the game page has them because
   the preview already fetches them, and a report without them simply omits
   these sentences rather than guessing. */
function factSeasonContext(g) {
  const out = [];
  const S = g.season;
  if (!S) return out;

  (S.players || []).forEach(sp => {
    const p = g.byId[sp.id];
    if (!p || !p.min || !sp.gp || sp.gp < 3) return;
    const avg = num(sp.ppg);
    if (avg == null) return;
    const diff = (p.pts || 0) - avg;
    if (diff >= Math.max(8, avg * 0.5)) {
      out.push(F('aboveSelf', p.team, 82, { p, avg, diff },
        p.name + ' went well past his average'));
    } else if (avg >= 12 && diff <= -Math.max(8, avg * 0.5)) {
      out.push(F('belowSelf', p.team, 59, { p, avg, diff },
        p.name + ' was kept quiet'));
    }
  });

  (S.teams || []).forEach(st => {
    const t = (S.teamIndex || {})[st.id];
    if (t !== 0 && t !== 1) return;
    if (!st.gp || st.gp < 3) return;
    const scored = g.score[t], avg = num(st.ppg);
    if (avg == null) return;
    if (scored - avg >= 12) {
      out.push(F('teamAbove', t, 70, { scored, avg },
        g.names[t] + ' scored well above their season rate'));
    } else if (avg - scored >= 12) {
      out.push(F('teamBelow', t, 65, { scored, avg },
        g.names[t] + ' were held below their season rate'));
    }
  });
  return out;
}

function ordinal(n) {
  return n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third'
       : n === 4 ? 'fourth' : n + 'th';
}

/* ================================================================== facts ===
   Everything, ranked. Callers take the top of the list; nothing downstream
   needs to know how many extractors there were. */
function facts(g) {
  return [].concat(
    factResult(g), factQuarters(g), factFlow(g), factFactors(g),
    factLineups(g), factPlayers(g), factTeamShape(g),
    factDefence(g), factFouls(g), factPassing(g), factZones(g),
    factTempo(g), factSeasonContext(g)
  ).filter(Boolean).sort((a, b) => b.salience - a.salience);
}

/* FACTS ONLY. The prose that reads these lives in report.js, deliberately
   behind a seam: everything here is numbers with names attached and can be
   tested for being right, everything there is phrasing and cannot. It is also
   where a language model would be handed the brief. */
return { facts, F, esc, num, one, pct1, mins, ordinal, plural,
         __x: { factResult, factQuarters, factFlow, factFactors,
                factLineups, factPlayers, factTeamShape,
                factDefence, factFouls, factPassing, factZones,
                factTempo, factSeasonContext } };
}));
