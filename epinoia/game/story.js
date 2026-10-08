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

/* ---- where the points came from: the events tab, in facts -----------------
   The box score counts second-chance, fast-break and off-turnover points. The events tab
   (situations.js) says more: how many chances of each kind a side got, what it scored per
   chance, and — against the league's own games — whether getting that many is unusual. A
   report that says "they scored 22 on the break" has said half of it; "they got a quarter of
   their chances on the break and scored 1.4 a time" is the other half. g.sits is [side0, side1]
   of situations.js buckets, or null when nothing computed them, and then nothing is said. */
const SIT_NAME = { transition: 'in transition', second: 'on second chances', offTo: 'off turnovers' };
function sitGrade(g, scope, key, ctx) {
  const GP = typeof globalThis !== 'undefined' && globalThis.EpinoiaGamePct;
  if (!GP || !GP.rate) return null;
  const r = GP.rate(scope, key, ctx, { league: (g.meta && g.meta.leagueSlug) || null });
  return r ? (r.d ? r.g : r.p) : null;
}
function factSituations(g) {
  const out = [];
  const S = g.sits;
  if (!S || !S[0] || !S[1] || !S[0].all || !S[1].all) return out;
  const line = (t, k) => {
    const s = S[t][k], all = S[t].all;
    if (!s) return null;
    return { pts: s.pts || 0, chances: s.chances || 0, ppp: s.ppp, efg: s.efg,
             freq: all.chances ? 100 * s.chances / all.chances : null,
             freqPct: sitGrade(g, 'sit', k + '.freq', { s, all }),
             pppPct: sitGrade(g, 'sit', k + '.ppp', { s }) };
  };

  /* the opportunistic situation the two sides were furthest apart on, in points */
  let best = null;
  ['transition', 'second', 'offTo'].forEach(k => {
    const a = line(0, k), b = line(1, k);
    if (!a || !b) return;
    const gap = a.pts - b.pts;
    if (Math.abs(gap) < 6) return;
    const side = gap > 0 ? 0 : 1;
    const mine = side === 0 ? a : b, theirs = side === 0 ? b : a;
    if (mine.chances < 4) return;
    if (!best || Math.abs(gap) > best.gap) best = { key: k, side, gap: Math.abs(gap), mine, theirs };
  });
  if (best) {
    out.push(F('sitEdge', best.side, 66 + Math.min(12, best.gap),
      { key: best.key, where: SIT_NAME[best.key], gap: best.gap, mine: best.mine, theirs: best.theirs },
      g.names[best.side] + ' outscored the other side ' + SIT_NAME[best.key] + ' by ' + best.gap));
  }

  /* the half court: where most of any game is played, and the honest test of an offence */
  const h0 = line(0, 'half'), h1 = line(1, 'half');
  if (h0 && h1 && h0.chances >= 15 && h1.chances >= 15 && h0.ppp != null && h1.ppp != null &&
      Math.abs(h0.ppp - h1.ppp) >= 0.15) {
    const side = h0.ppp > h1.ppp ? 0 : 1;
    out.push(F('halfCourt', side, 60,
      { mine: side === 0 ? h0 : h1, theirs: side === 0 ? h1 : h0 },
      g.names[side] + ' were the better half-court offence'));
  }

  /* a side that lives in one situation, read against the league rather than the opponent */
  for (const t of [0, 1]) {
    ['transition', 'second'].forEach(k => {
      const x = line(t, k);
      if (x && x.freqPct != null && x.freqPct >= 88 && x.chances >= 8) {
        out.push(F('sitStyle', t, 52, { key: k, where: SIT_NAME[k], freq: x.freq, pct: x.freqPct, ppp: x.ppp },
          g.names[t] + ' got an unusual share of their chances ' + SIT_NAME[k]));
      }
    });
  }

  /* straight out of a timeout: the one set a coach draws up with the clock stopped */
  for (const t of [0, 1]) {
    const x = line(t, 'ato');
    if (!x || x.chances < 3 || x.ppp == null) continue;
    if (x.ppp >= 1.4) out.push(F('atoSharp', t, 48, x, g.names[t] + ' scored out of timeouts'));
    else if (x.ppp <= 0.35 && x.chances >= 4) out.push(F('atoBlank', t, 46, x, g.names[t] + ' drew blanks out of timeouts'));
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

/* ============================================================================
   THE NEWER STATS, IN FACTS (2026-09-26): what the four factors were worth, how long each side kept the ball, how
   the baskets were made, what became of the misses, and who led for how long. Each is the number the full stats
   tab already draws, so a sentence here cannot disagree with the page under it; each is left out when the brief does
   not carry what it needs (a server-side brief has no shot-clock or situations counts, and says nothing about them).
   ============================================================================ */

/* POINTS ADDED, strength of schedule's: (the factor - the league average) x its weight, in points per 100
   possessions per 1%, turnovers the other way round, then scaled to the side's possessions in this game. The league
   average is the game scale's own; with none it is the mean of the two sides. The weights are sos.js's
   POINTS_PER_PCT (supabase/tests/cards.test.mjs holds the copies equal). */
const PA_W = { efg: 2.0, tovp: 1.4, orebp: 0.7, ftr: 0.4 };
const PA_LABEL = { efg: 'shooting', tovp: 'turnovers', orebp: 'the offensive glass', ftr: 'free throws' };
function paBase(g, k) {
  const GP = typeof globalThis !== 'undefined' && globalThis.EpinoiaGamePct;
  const mu = GP && GP.mean ? GP.mean('team', k, (g.meta && g.meta.leagueSlug) || null) : null;
  if (mu != null) return { v: mu, league: true };
  return { v: ((num(g.adv[0][k]) || 0) + (num(g.adv[1][k]) || 0)) / 2, league: false };
}
/* THE LEAGUE'S OWN WIN MODEL (Louie, 2026-10-07): where the brief carries the league's What wins weights (g.model,
   winmodel.js explainOf: b in points of margin for one percentage point of difference between the sides, its
   competitive margin = home + Σ b Δ factor), a factor's part is b × (the side's factor − the baseline): the model's own
   equation for this league in place of the fixed weights, the turnovers' b already negative. Without them, as before */
const modelB = g => {
  const b = g && g.model && g.model.b;
  return b && ['efg', 'tovp', 'orebp', 'ftr'].every(k => num(b[k]) != null) ? b : null;
};
function paSide(g, k, t) {
  const A = g.adv[t], v = num(A[k]), poss = num(A.possessions);
  if (v == null || poss == null) return null;
  const b = paBase(g, k).v, MB = modelB(g);
  if (MB) return MB[k] * (v - b);
  return (k === 'tovp' ? b - v : v - b) * PA_W[k] * poss / 100;
}
const modelTag = g => (modelB(g) ? { n: num(g.model.n), season: g.model.season || null } : null);
function factEstimatedMargin(g) {
  const out = [];
  if (!g.adv || !g.adv[0] || !g.adv[1]) return out;
  const net = {};
  for (const k of Object.keys(PA_W)) {
    const a = paSide(g, k, 0), b = paSide(g, k, 1);
    if (a == null || b == null) return out;
    net[k] = a - b;
  }
  const est = net.efg + net.tovp + net.orebp + net.ftr;
  const actual = g.score[0] - g.score[1];
  if (!(g.adv[0].possessions > 0)) return out;
  /* EVERY FACTOR, BOTH SIDES: what each gained or lost in it, and what it was worth to the margin (home minus away) */
  out.push(F('pointsAdded', null, 70, {
    rows: Object.keys(PA_W).map(k => ({ key: k, label: PA_LABEL[k], pts: [paSide(g, k, 0), paSide(g, k, 1)], net: net[k] })),
    estimated: est, actual, baseline: paBase(g, 'efg').league ? 'league' : 'game', model: modelTag(g)
  }, 'the four factors, in points'));
  if (Math.abs(est) < 3) return out;
  const side = est > 0 ? 0 : 1, sgn = side === 0 ? 1 : -1;
  /* each factor from the favoured side's end: positive helped them */
  const parts = Object.keys(PA_W).map(k => ({ key: k, label: PA_LABEL[k], pts: net[k] * sgn })).sort((x, y) => y.pts - x.pts);
  const lead = parts[0], second = parts[1] && parts[1].pts >= 2 ? parts[1] : null;
  const against = parts.filter(p => p.pts <= -2).sort((x, y) => x.pts - y.pts)[0] || null;
  out.push(F('estMargin', side, 79, {
    estimated: Math.abs(est), actual: Math.abs(actual), actualSide: actual === 0 ? null : (actual > 0 ? 0 : 1),
    agrees: actual !== 0 && (actual > 0) === (est > 0), lead, second, against,
    baseline: paBase(g, 'efg').league ? 'league' : 'game', model: modelTag(g)
  }, g.names[side] + ' were worth ' + Math.round(Math.abs(est)) + ' points on the four factors'));
  return out;
}

/* THE PACE OF IT: how long each side kept the ball, and how the game's pace sits against the league's */
function factClock(g) {
  const out = [];
  if (g.atop && g.atop[0] != null && g.atop[1] != null && isFinite(g.atop[0]) && isFinite(g.atop[1])) {
    const a = g.atop[0], b = g.atop[1];
    if (Math.abs(a - b) >= 1.5 && Math.min(a, b) > 3) {
      const slow = a > b ? 0 : 1;                       // the side that holds the ball longer
      out.push(F('possessionTime', slow, 58, { slow: Math.max(a, b), quick: Math.min(a, b) },
        g.names[slow] + ' worked the clock'));
    }
  }
  const GP = typeof globalThis !== 'undefined' && globalThis.EpinoiaGamePct;
  const lg = GP && GP.mean ? GP.mean('team', 'paceOwn', (g.meta && g.meta.leagueSlug) || null) : null;
  const p = g.adv && g.adv[0] ? num(g.adv[0].pace) : null;
  if (lg != null && p != null && p > 0 && Math.abs(p - lg) >= 6) {
    out.push(F('paceVsLeague', null, 40, { pace: p, league: lg, faster: p > lg }, 'the pace against the league'));
  }
  return out;
}

/* HOW THE BASKETS WERE MADE: assisted or on their own */
function factHowScored(g) {
  const out = [];
  const A = g.assists;
  if (!A || !A[0] || !A[1] || !A[0].ast || !A[1].ast) return out;
  const made = t => A[t].ast.fgm + A[t].unast.fgm;
  if (made(0) < 8 || made(1) < 8) return out;
  const share = t => 100 * A[t].ast.fgm / made(t);
  const s0 = share(0), s1 = share(1);
  if (Math.abs(s0 - s1) >= 14) {
    const hi = s0 > s1 ? 0 : 1;
    out.push(F('assistedShare', hi, 57, {
      share: [s0, s1], made: [made(0), made(1)], assisted: [A[0].ast.fgm, A[1].ast.fgm],
      unastPts: [A[0].unast.pts, A[1].unast.pts], unastThrees: [A[0].unast.p3m, A[1].unast.p3m]
    }, g.names[hi] + ' scored off the pass'));
  }
  return out;
}

/* WHAT BECAME OF THE MISSES: the offensive rebound is a second shot, and the side that lives on them says so */
function factMisses(g) {
  const out = [];
  const S = g.sits;
  if (!S || !S[0] || !S[1] || !S[0].all || !S[1].all || !S[0].all.zones || !S[1].all.zones) return out;
  const tot = t => {
    const Z = S[t].all.zones, o = { a: 0, m: 0, o: 0, d: 0 };
    ['rim', 'mid', 'three'].forEach(z => { const q = Z[z] || {}; o.a += q.a || 0; o.m += q.m || 0; o.o += q.o || 0; o.d += q.d || 0; });
    o.miss = Math.max(0, o.a - o.m);
    return o;
  };
  const a = tot(0), b = tot(1);
  if (a.miss < 12 || b.miss < 12) return out;
  const sa = 100 * a.o / a.miss, sb = 100 * b.o / b.miss;
  if (Math.abs(sa - sb) >= 12) {
    const hi = sa > sb ? 0 : 1, m = hi === 0 ? a : b, o = hi === 0 ? b : a;
    out.push(F('missFate', hi, 59, { orb: m.o, misses: m.miss, share: hi === 0 ? sa : sb, theirs: { orb: o.o, misses: o.miss, share: hi === 0 ? sb : sa } },
      g.names[hi] + ' kept their misses alive'));
  }
  return out;
}

/* WHO LED, AND FOR HOW LONG: the share of the game each side was in front, from the scoring log */
function factTimeLed(g) {
  const out = [];
  const ev = g.events || [];
  if (!clocked(ev) || g.score[0] === g.score[1]) return out;
  let s = [0, 0], led = [0, 0], level = 0, last = 0, first = null, levelled = 0, trailedAt = [false, false];
  const H = halvesOf(g);
  const upTo = t => { const d = Math.max(0, t - last); const diff = s[0] - s[1]; if (diff > 0) led[0] += d; else if (diff < 0) led[1] += d; else level += d; last = t; };
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (!v || e.team == null || e.clock == null) return;
    upTo(elapsed(e.period, e.clock, H));
    s[e.team] += v;
    if (first == null) first = e.team;
    if (s[0] === s[1]) levelled++;                                   // the score was level again after a basket
    else if (s[0] > s[1]) trailedAt[1] = true; else trailedAt[0] = true;   // somebody was behind, if only for a moment
  });
  let total = 0;
  for (let p = 1; p <= (g.periods || regOf(g)); p++) total += PLEN_(p, H);
  upTo(total);
  if (total <= 0) return out;
  const w = g.score[0] > g.score[1] ? 0 : 1;
  const wShare = led[w] / total, lShare = led[1 - w] / total;
  /* THE EXACT STORY, not a rounded one: did the winners ever trail (a single basket by the other side counts), was the score ever
     level again after the first basket, and did they score first. "From the first basket to the last" is only true when all three
     hold; "never trailed" when the first two do. The shares are for everything else. */
  const neverTrailed = !trailedAt[w] && led[1 - w] === 0;
  const perfect = neverTrailed && first === w && levelled === 0;
  const data = { winner: w, led, level, total, winnerShare: wShare, loserShare: lShare, neverTrailed, perfect, scoredFirst: first === w, levelled };
  if (lShare >= 0.55) out.push(F('timeLed', 1 - w, 77, Object.assign({ kind: 'ledMost' }, data), g.names[1 - w] + ' led most of the game and lost it'));
  else if (perfect) out.push(F('timeLed', w, 70, Object.assign({ kind: 'wire' }, data), g.names[w] + ' led from the first basket to the last'));
  else if (neverTrailed) out.push(F('timeLed', w, 66, Object.assign({ kind: 'wire' }, data), g.names[w] + ' never trailed'));
  else if (wShare >= 0.93) out.push(F('timeLed', w, 64, Object.assign({ kind: 'wire' }, data), g.names[w] + ' led almost throughout'));
  return out;
}

/* ============================================================================
   THE THREE TABS THE REPORT READS TOO: connections, play type + rebounds, and the shot clock.
   ============================================================================ */

/* CONNECTIONS: who set up whom. A pair's count is assists; every figure is the connections tab's own. */
function factConnections(g) {
  const out = [];
  const C = g.connections;
  if (!C || !C[0] || !C[1]) return out;
  for (const t of [0, 1]) {
    const list = C[t];
    const total = list.reduce((n, c) => n + c.count, 0);
    if (total < 5) continue;
    const top = list[0];
    if (top && top.count >= 3) {
      out.push(F('duo', t, 55 + Math.min(10, top.count),
        { assister: top.assisterName, scorer: top.scorerName, count: top.count, points: top.points, threes: top.threes, twos: top.twos, total, pairs: list.length },
        g.names[t] + ': ' + top.assisterName + ' to ' + top.scorerName));
    }
    const by = {};
    list.forEach(c => { by[c.assisterName] = (by[c.assisterName] || 0) + c.count; });
    const hub = Object.keys(by).map(n => ({ name: n, count: by[n] })).sort((a, b) => b.count - a.count)[0];
    if (hub && hub.count >= 5 && hub.count / total >= 0.4) {
      out.push(F('passingHub', t, 57, { name: hub.name, count: hub.count, total, targets: list.filter(c => c.assisterName === hub.name).length },
        hub.name + ' ran the offence'));
    }
    const got = {};
    list.forEach(c => { got[c.scorerName] = (got[c.scorerName] || 0) + c.points; });
    const fed = Object.keys(got).map(n => ({ name: n, pts: got[n] })).sort((a, b) => b.pts - a.pts)[0];
    if (fed && fed.pts >= 12) out.push(F('fedScorer', t, 52, { name: fed.name, pts: fed.pts, total }, fed.name + ' scored off the pass'));
  }
  return out;
}

/* PLAY TYPE: who scored the breaks, the second chances and the points off turnovers; and the mid-range that did not go in */
function factPlayTypes(g) {
  const out = [];
  const P = g.sitPlayers, S = g.sits;
  if (P && S && S[0] && S[1]) {
    const found = [];
    for (const t of [0, 1]) {
      ['transition', 'second', 'offTo'].forEach(k => {
        const team = S[t] && S[t][k] ? S[t][k].pts : 0;
        if (team < 10) return;
        let best = null;
        Object.keys(P[t] || {}).forEach(pid => {
          const x = P[t][pid].sits && P[t][pid].sits[k];
          if (x && (!best || x.pts > best.pts)) best = { name: P[t][pid].name, pts: x.pts };
        });
        if (best && best.pts >= 6 && best.pts / team >= 0.4) found.push({ t, k, name: best.name, pts: best.pts, team });
      });
    }
    found.sort((a, b) => b.pts - a.pts).slice(0, 2).forEach(f => out.push(F('sitLeader', f.t, 53,
      { key: f.k, where: SIT_NAME[f.k], name: f.name, pts: f.pts, teamPts: f.team }, f.name + ' led the scoring ' + SIT_NAME[f.k])));
  }
  if (S) {
    for (const t of [0, 1]) {
      const z = S[t] && S[t].all && S[t].all.zones && S[t].all.zones.mid;
      if (z && z.a >= 8 && z.m / z.a <= 0.2) out.push(F('midCold', t, 51, { m: z.m, a: z.a }, g.names[t] + ' could not buy a mid-range basket'));
    }
  }
  return out;
}

/* REBOUNDS BY ZONE: where a side's misses came back to it, against where the other side's did */
const ZONE_WORDS = { rim: 'at the rim', mid: 'from mid-range', three: 'from three' };
function factRebZones(g) {
  const out = [];
  const S = g.sits;
  if (!S || !S[0] || !S[1] || !S[0].all || !S[1].all || !S[0].all.zones || !S[1].all.zones) return out;
  let best = null;
  ['rim', 'mid', 'three'].forEach(z => {
    const a = S[0].all.zones[z], b = S[1].all.zones[z];
    if (!a || !b) return;
    const ma = a.a - a.m, mb = b.a - b.m;
    if (ma < 6 || mb < 6) return;
    const ra = 100 * (a.o || 0) / ma, rb = 100 * (b.o || 0) / mb;
    const gap = Math.abs(ra - rb);
    if (gap >= 18 && (!best || gap > best.gap)) best = { z, gap, side: ra > rb ? 0 : 1, a, b, ma, mb };
  });
  if (best) {
    const m = best.side === 0 ? best.a : best.b, o = best.side === 0 ? best.b : best.a;
    out.push(F('zoneBoards', best.side, 55, {
      zone: best.z, where: ZONE_WORDS[best.z], mine: { o: m.o || 0, miss: m.a - m.m }, theirs: { o: o.o || 0, miss: o.a - o.m }
    }, g.names[best.side] + ' got their ' + best.z + ' misses back'));
  }
  return out;
}

/* THE SHOT CLOCK: how each side did early in it, and how often it ran the clock down */
function factShotClock(g) {
  const out = [];
  const C = g.clock && g.clock.chances;
  if (!C || !C.length) return out;
  const stats = (t, lo, hi) => {
    const xs = C.filter(r => r.team === t && !r.second && r.dur != null && r.dur >= lo && r.dur < hi);
    const pts = xs.reduce((n, r) => n + r.pts, 0);
    return { n: xs.length, pts, ppp: xs.length ? pts / xs.length : null };
  };
  const all = [0, 1].map(t => stats(t, 0, 1e9));
  const early = [0, 1].map(t => stats(t, 0, 8)), late = [0, 1].map(t => stats(t, 17, 1e9));
  if (early[0].n >= 8 && early[1].n >= 8 && Math.abs(early[0].ppp - early[1].ppp) >= 0.25) {
    const hi = early[0].ppp > early[1].ppp ? 0 : 1;
    out.push(F('clockEarly', hi, 56, { mine: early[hi], theirs: early[1 - hi] }, g.names[hi] + ' were sharper early in the clock'));
  }
  for (const t of [0, 1]) {
    const share = all[t].n ? late[t].n / all[t].n : 0;
    if (late[t].n >= 6 && share >= 0.25 && late[t].ppp != null && all[t].ppp != null && late[t].ppp <= all[t].ppp - 0.2) {
      out.push(F('clockLate', t, 54, { late: late[t], all: all[t], share: 100 * share, theirShare: all[1 - t].n ? 100 * late[1 - t].n / all[1 - t].n : null },
        g.names[t] + ' ran the clock down and paid for it'));
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
  /* THE AVERAGE BEFORE THIS GAME where context.js could work it out (the season line read after a final already has
     the night in it, which pulls the average toward the very score it is compared with) */
  const before = g.ctx && g.ctx.players ? g.ctx.players : null;

  (S.players || []).forEach(sp0 => {
    const pre = before && before[sp0.id];
    const sp = pre && pre.gp >= 3 ? { id: sp0.id, gp: pre.gp, ppg: pre.ppg } : sp0;
    const p = g.byId[sp.id];
    if (!p || !p.min || !sp.gp || sp.gp < 3) return;
    const avg = num(sp.ppg);
    if (avg == null) return;
    const diff = (p.pts || 0) - avg;
    if (diff >= Math.max(8, avg * 0.5)) {
      out.push(F('aboveSelf', p.team, 82, { p, avg, diff },
        p.name + ' went well past their average'));
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

/* elapsed ms from the tip to (period, clock-remaining) — the same arithmetic
   the engine uses for minutes, kept local so a brief from any source works */
/* quarters, or NCAA men's two 20-minute halves: the brief says (g.reg, gamefacts.js, from the engine's
   format), else the log does -- a first- or second-period clock above 10:00 is a half */
const PLEN_ = (p, h) => (h ? (p <= 2 ? 1200000 : 300000) : (p <= 4 ? 600000 : 300000));
const halvesOf = g => (g && g.reg != null) ? g.reg === 2
  : !!(g && g.events && g.events.some(e => e && (+e.period || 1) <= 2 && +e.clock > 600000));
const regOf = g => (halvesOf(g) ? 2 : 4);
function elapsed(period, clock, h) {
  let t = 0;
  for (let p = 1; p < (period || 1); p++) t += PLEN_(p, h);
  return t + (PLEN_(period || 1, h) - (clock == null ? 0 : clock));
}
const SCORE_PTS = { p2_made: 2, p3_made: 3, ft_made: 1 };
/* does the log carry a clock at all? a bulk import may not */
function clocked(ev) {
  let n = 0, c = 0;
  (ev || []).forEach(e => { if (SCORE_PTS[e.t]) { n++; if (e.clock != null) c++; } });
  return n > 0 && c / n >= 0.8;
}

/* ---- the half: where it stood at the break, and what the second half did -- */
function factHalf(g) {
  const out = [];
  const reg = regOf(g);              // 4 quarters, or 2 halves: the first half is periods 1..reg/2
  if (!g.perQ || g.periods < reg) return out;
  const per = g.perQ;
  const h1 = [0, 0];
  for (let p = 1; p <= reg / 2; p++) { h1[0] += per[0][p] || 0; h1[1] += per[1][p] || 0; }
  const h2 = [g.score[0] - h1[0], g.score[1] - h1[1]];          // OT included
  const w = g.score[0] >= g.score[1] ? 0 : 1;
  const halfLead = h1[w] - h1[1 - w];
  const secondHalf = h2[w] - h2[1 - w];
  out.push(F('half', null, 55, { h1, h2, halfLead, secondHalf, winner: w }, 'the score at the break'));
  if (halfLead <= -4) {
    out.push(F('turnedAfterHalf', w, 86, { deficit: -halfLead, h1, h2, secondHalf },
      g.names[w] + ' turned it round after the break'));
  } else if (halfLead >= 15) {
    out.push(F('overByHalf', w, 62, { halfLead, h1 }, g.names[w] + ' had it won by half-time'));
  } else if (secondHalf >= 15) {
    out.push(F('secondHalfSurge', w, 66, { secondHalf, h2, halfLead },
      g.names[w] + ' won the second half by ' + secondHalf));
  }
  if (g.periods > reg) {
    const ot = [0, 0];
    for (let p = reg + 1; p <= g.periods; p++) { ot[0] += per[0][p] || 0; ot[1] += per[1][p] || 0; }
    const regScore = [g.score[0] - ot[0], g.score[1] - ot[1]];
    out.push(F('overtime', w, 93, { ots: g.periods - reg, ot, reg: regScore },
      g.names[w] + ' won in overtime'));
  }
  return out;
}

/* ---- the closing minutes: the part everybody who was there remembers ----- */
function factClosing(g) {
  const out = [];
  const ev = g.events || [];
  if (!clocked(ev)) return out;
  const last = g.periods, final = g.score;
  const s = [0, 0];
  let at5 = null, at2 = null;
  const ft = [[0, 0], [0, 0]];                    // [made, attempted] in the last two minutes
  const lastScorers = [];                          // scoring plays inside the last five minutes
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (e.period === last && e.clock != null) {
      if (at5 == null && e.clock <= 300000) at5 = s.slice();
      if (at2 == null && e.clock <= 120000) at2 = s.slice();
      if (e.clock <= 120000 && e.team != null) {
        if (e.t === 'ft_made') { ft[e.team][0]++; ft[e.team][1]++; }
        else if (e.t === 'ft_miss') ft[e.team][1]++;
      }
      if (v && e.team != null && e.clock <= 300000) lastScorers.push({ team: e.team, v, pid: e.pid, clock: e.clock });
    }
    if (v && e.team != null) s[e.team] += v;
  });
  if (at5 == null) return out;
  const w = final[0] >= final[1] ? 0 : 1, l = 1 - w;
  const lead5 = at5[w] - at5[l];                   // the eventual winner's lead with five to play
  const margin = final[w] - final[l];
  const late = [final[0] - at5[0], final[1] - at5[1]];   // points in the last five minutes
  const base = { at5, at2, late, lead5, margin, ft, winner: w, last };
  out.push(F('closing', null, 57, base, 'the last five minutes'));
  if (Math.abs(lead5) <= 5 && margin <= 6 && margin > 0) {
    out.push(F('closeFinish', w, 82, base, 'it went to the last five minutes'));
  } else if (Math.abs(lead5) <= 6 && margin >= 12) {
    out.push(F('pulledAway', w, 83, base, g.names[w] + ' pulled away late'));
  } else if (lead5 >= 10 && margin <= 5) {
    out.push(F('heldOn', w, 84, base, g.names[w] + ' held on'));
  } else if (lead5 <= -8 && margin > 0) {
    out.push(F('stolenLate', w, 96, base, g.names[w] + ' stole it late'));
  }
  /* the line, in the last two minutes: where close games are kept or lost */
  if (ft[w][1] >= 4 && ft[w][0] / ft[w][1] >= 0.75 && margin <= 10) {
    out.push(F('icedIt', w, 61, { made: ft[w][0], att: ft[w][1] }, g.names[w] + ' closed it out at the line'));
  }
  if (ft[l][1] >= 4 && ft[l][0] / ft[l][1] <= 0.5 && margin <= 8) {
    out.push(F('lineCostThem', l, 63, { made: ft[l][0], att: ft[l][1], margin }, g.names[l] + ' missed at the line late'));
  }
  /* the last points of the game: one side scoring the last N unanswered */
  let tail = 0, tailTeam = null;
  for (let i = lastScorers.length - 1; i >= 0; i--) {
    const x = lastScorers[i];
    if (tailTeam == null) tailTeam = x.team;
    if (x.team !== tailTeam) break;
    tail += x.v;
  }
  if (tailTeam != null && tail >= 7) {
    out.push(F('lastPoints', tailTeam, 64, { n: tail }, g.names[tailTeam] + ' scored the last ' + tail));
  }
  return out;
}

/* ---- the box score, said: shooting lines, the boards, the break ----------- */
function factTeamLines(g) {
  const out = [];
  for (const t of [0, 1]) {
    const A = g.adv[t], O = g.adv[1 - t], T = g.team[t] || {}, OT = g.team[1 - t] || {};
    if (!A || !O) continue;
    const line = {
      fgm: num(A.fgm), fga: num(A.fga), fg3m: num(A.fg3m), fg3a: num(A.fg3a), ftm: num(A.ftm), fta: num(A.fta),
      reb: (num(A.oreb) || 0) + (num(A.dreb) || 0), oreb: num(A.oreb), dreb: num(A.dreb),
      ast: num(A.ast), tov: num(A.tov), stl: num(A.stl), blk: num(A.blk),
      fgp: num(A.fga) ? num(A.fgm) / num(A.fga) * 100 : null, p3p: num(A.p3p), ftp: num(A.ftp),
      fast: num(T.fast), oppFast: num(OT.fast), lead: num(T.lead)
    };
    out.push(F('teamLine', t, 40, line, g.names[t] + '\u2019s line'));
    if (line.fg3a >= 15 && line.p3p != null && line.p3p <= 22) {
      out.push(F('coldThree', t, 63, { m: line.fg3m, a: line.fg3a, pct: line.p3p }, g.names[t] + ' went cold from three'));
    } else if (line.fg3a >= 12 && line.p3p != null && line.p3p >= 42) {
      out.push(F('hotThree', t, 67, { m: line.fg3m, a: line.fg3a, pct: line.p3p }, g.names[t] + ' shot it from three'));
    }
    if (line.fta >= 12 && line.ftp != null && line.ftp <= 60) {
      out.push(F('poorLine', t, 60, { m: line.ftm, a: line.fta, pct: line.ftp }, g.names[t] + ' struggled at the line'));
    }
    if (line.fast != null && line.oppFast != null && line.fast >= 12 && line.fast - line.oppFast >= 8) {
      out.push(F('fastBreak', t, 59, { mine: line.fast, theirs: line.oppFast }, g.names[t] + ' ran'));
    }
    if (line.tov != null && line.tov >= 18) {
      out.push(F('careless', t, 56, { tov: line.tov }, g.names[t] + ' turned it over ' + line.tov + ' times'));
    }
  }
  const A = g.adv[0], B = g.adv[1];
  if (A && B) {
    const ra = (num(A.oreb) || 0) + (num(A.dreb) || 0), rb = (num(B.oreb) || 0) + (num(B.dreb) || 0);
    if (Math.abs(ra - rb) >= 10) {
      const side = ra > rb ? 0 : 1;
      out.push(F('boards', side, 65, { mine: Math.max(ra, rb), theirs: Math.min(ra, rb) }, g.names[side] + ' won the boards'));
    }
    if (num(A.fga) && num(B.fga)) {
      const fa = num(A.fgm) / num(A.fga) * 100, fb = num(B.fgm) / num(B.fga) * 100;
      out.push(F('floor', fa >= fb ? 0 : 1, 42, { a: fa, b: fb }, 'from the floor'));
    }
  }
  return out;
}

/* ---- players, in full: the line, the bench, the spree, the boards --------- */
function factPlayerLines(g) {
  const out = [];
  const starters = g.starters || [[], []];
  g.players.forEach(p => {
    if (!p.min) return;
    const reb = (p.or || 0) + (p.dr || 0);
    const known = (starters[p.team] || []).length >= 5;      // no five on record: nobody is "off the bench"
    const isStarter = (starters[p.team] || []).indexOf(p.id) >= 0;
    if (known && !isStarter && (p.pts || 0) >= 15) {
      out.push(F('benchSpark', p.team, 68, { p, pts: p.pts }, p.name + ' came off the bench for ' + p.pts));
    }
    if (reb >= 14) {
      out.push(F('rebounder', p.team, 70, { p, reb }, p.name + ' pulled down ' + reb));
    }
    if ((p.fta || 0) >= 10) {
      out.push(F('lineLiving', p.team, 60, { p, made: p.ftm || 0, att: p.fta }, p.name + ' lived at the line'));
    }
    if ((p.to || 0) >= 5) {
      out.push(F('turnoverProne', p.team, 57, { p, to: p.to }, p.name + ' gave it away ' + p.to + ' times'));
    }
    if ((p.min || 0) >= 38 * 60000) {
      out.push(F('bigMinutes', p.team, 44, { p, min: p.min }, p.name + ' barely sat'));
    }
    const margin = Math.abs(g.score[0] - g.score[1]);
    if (num(p.pm) != null && p.pm >= 18 && p.pm - margin >= 8) {
      out.push(F('plusMinus', p.team, 58, { p, pm: p.pm }, p.name + ' was ' + p.pm + ' on the night'));
    }
    const near = [p.pts || 0, reb, p.ast || 0].filter(v => v >= 8).length === 3 &&
                 [p.pts || 0, reb, p.ast || 0].filter(v => v >= 10).length === 2;
    if (near) out.push(F('nearTriple', p.team, 77, { p, reb }, p.name + ' was a rebound or two from a triple-double'));
  });
  /* a personal spree: one man scoring his side's points, unanswered by his own team-mates,
     for a stretch — read from the log, because a box score has no order in it */
  const ev = g.events || [];
  let cur = { pid: null, team: null, n: 0, period: 1 }, best = null;
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (!v || e.team == null) return;
    if (e.pid && cur.pid === e.pid) cur.n += v;
    else cur = { pid: e.pid, team: e.team, n: v, period: e.period || 1 };
    if (cur.pid && (!best || cur.n > best.n)) best = Object.assign({}, cur);
  });
  if (best && best.n >= 9 && g.byId[best.pid]) {
    out.push(F('spree', best.team, 73, { p: g.byId[best.pid], n: best.n, period: best.period },
      g.byId[best.pid].name + ' scored ' + best.n + ' straight for their side'));
  }
  return out;
}

/* ---- ties, the early going, and the drought ------------------------------- */
function factTexture(g) {
  const out = [];
  const ev = g.events || [];
  const s = [0, 0];
  let ties = 0, early = null;
  const lastFG = [null, null], worst = [null, null];
  const hasClock = clocked(ev), H = halvesOf(g);
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (e.t === 'period_start' && hasClock) {
      /* a drought does not run through the interval */
      for (const t of [0, 1]) lastFG[t] = elapsed(e.period, PLEN_(e.period, H), H);
    }
    if (!v || e.team == null) return;
    s[e.team] += v;
    if (s[0] === s[1] && s[0] > 0) ties++;
    if ((e.period || 1) === 1 && early == null) {
      const d = s[0] - s[1];
      if (Math.abs(d) >= 8 && Math.min(s[0], s[1]) <= 6) early = { side: d > 0 ? 0 : 1, score: s.slice() };
    }
    if (hasClock && e.t !== 'ft_made') {
      const now = elapsed(e.period || 1, e.clock, H);
      const t = e.team;
      if (lastFG[t] != null) {
        const gap = now - lastFG[t];
        if (!worst[t] || gap > worst[t].dur) worst[t] = { dur: gap, period: e.period || 1, endScore: s.slice() };
      }
      lastFG[t] = now;
    }
  });
  if (ties >= 6) out.push(F('ties', null, 58, { ties }, 'level ' + ties + ' times'));
  if (early) out.push(F('earlyLead', early.side, 52, early, g.names[early.side] + ' led ' + early.score[early.side] + '\u2013' + early.score[1 - early.side] + ' early'));
  for (const t of [0, 1]) {
    if (worst[t] && worst[t].dur >= 300000) {
      out.push(F('drought', t, 62, { dur: worst[t].dur, period: worst[t].period },
        g.names[t] + ' went ' + mins(worst[t].dur) + ' without a field goal'));
    }
  }
  return out;
}

/* ---- where and when: the dateline ---------------------------------------- */
function factMeta(g) {
  const m = g.meta;
  if (!m) return [];
  let day = null, evening = null;
  if (m.tipoff_at) {
    const d = new Date(m.tipoff_at);
    if (!isNaN(d)) {
      /* the VENUE's clock, not the machine's: this runs in the reader's browser and in
         UTC on the server, and a 19:30 Melbourne tip is "morning" to both. m.timezone is
         the league's IANA zone; null (or a name Intl rejects) keeps the machine clock. */
      let dow = d.getDay(), h = d.getHours();
      if (m.timezone) {
        try {
          const p = new Intl.DateTimeFormat('en-GB', { timeZone: m.timezone, weekday: 'long',
            hour: 'numeric', hourCycle: 'h23' }).formatToParts(d);
          const wd = p.find(x => x.type === 'weekday'), hr = p.find(x => x.type === 'hour');
          const di = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(wd && wd.value);
          if (di >= 0 && hr) { dow = di; h = +hr.value; }
        } catch (_) { /* unknown zone: fall back to the machine clock */ }
      }
      day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
      evening = h >= 17 ? 'evening' : h >= 12 ? 'afternoon' : 'morning';
    }
  }
  const att = num(m.attendance);
  return [F('meta', null, 20, { venue: m.venue || null, attendance: att && att > 0 ? att : null,
    day, evening, competition: m.competition || null, league: m.league || null }, 'the dateline')];
}

function ordinal(n) {
  return n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third'
       : n === 4 ? 'fourth' : n + 'th';
}

/* ============================================================================
   WHAT DECIDED IT, IN POINTS (What Wins, 2026-10-07).

   The four factors were already counted in points (factEstimatedMargin). This is the full ledger the league's own
   model makes possible (docs/what-wins-model.md §7.11, "causes of a result"), every facet of the game given a value in
   points of the final margin, home side's view:

     the shots they got     b_efg x (expected eFG of the shots taken - the other side's): rim, mid-range and three at
                            the league's make rates (two zones when the shots were not placed)
     the shots that fell    the rest of the shooting: what was made beyond what those shots usually give
     turnovers, the offensive glass, getting to the line     b x the difference, as factEstimatedMargin
     free-throw shooting    free throws made beyond the league's rate, in points (each is one)
     home court             the model's home edge, where it has one
     everything else        whatever the margin was beyond all of that (garbage time, a model's error, the rest)

   The rows sum to the scoreboard margin exactly, which is what lets a sentence say "shooting was worth nine of the
   twelve". Each row is also a FACET, and every other fact about that facet is promoted by its share of the margin
   (weighFacets below): a game the model says was decided on turnovers is reported as one.
   ============================================================================ */
const FACET_LABEL = { quality: 'the shots they got', making: 'the shots that fell', efg: 'shooting', tovp: 'turnovers',
  orebp: 'the offensive glass', ftr: 'getting to the line', ft: 'free-throw shooting', home: 'home court', rest: 'everything else' };
function ledgerRates(g) {
  const C = g.ctx && g.ctx.rates;
  if (C && num(C.three) != null && num(C.two) != null) return Object.assign({ from: 'league' }, C);
  const A = g.adv[0], B = g.adv[1];
  const s = k => (num(A[k]) || 0) + (num(B[k]) || 0);
  const fga = s('fga'), fgm = s('fgm'), fg3a = s('fg3a'), fg3m = s('fg3m');
  return { from: 'game', rim: s('rimA') ? s('rimM') / s('rimA') : null, mid: s('midA') ? s('midM') / s('midA') : null,
           three: fg3a ? fg3m / fg3a : null, two: fga - fg3a > 0 ? (fgm - fg3m) / (fga - fg3a) : null,
           ft: s('fta') ? s('ftm') / s('fta') : null };
}
/* the eFG% a side's shots would have given at the baseline's make rates */
function xefgOf(A, R) {
  const fga = num(A.fga), fg3a = num(A.fg3a);
  if (!fga || fg3a == null || R.three == null || R.two == null) return null;
  const twos = fga - fg3a, placed = (num(A.rimA) || 0) + (num(A.midA) || 0);
  const zones = twos > 0 && placed / twos >= 0.6 && R.rim != null && R.mid != null;
  const made2 = zones ? (num(A.rimA) || 0) * R.rim + (num(A.midA) || 0) * R.mid + Math.max(0, twos - placed) * R.two : twos * R.two;
  return { x: 100 * (made2 + 1.5 * fg3a * R.three) / fga, zones };
}
function factLedger(g) {
  const out = [];
  if (!g.adv || !g.adv[0] || !g.adv[1] || !(num(g.adv[0].possessions) > 0) || !(num(g.adv[1].possessions) > 0)) return out;
  const net = {};
  for (const k of Object.keys(PA_W)) {
    const a = paSide(g, k, 0), b = paSide(g, k, 1);
    if (a == null || b == null) return out;
    net[k] = a - b;
  }
  const R = ledgerRates(g), MB = modelB(g);
  const poss = (num(g.adv[0].possessions) + num(g.adv[1].possessions)) / 2;
  const cE = MB ? MB.efg : PA_W.efg * poss / 100;                 // margin points per point of eFG between the sides
  const x0 = xefgOf(g.adv[0], R), x1 = xefgOf(g.adv[1], R);
  const rows = [];
  if (x0 && x1) {
    const quality = cE * (x0.x - x1.x);
    rows.push({ key: 'quality', pts: quality, x: [x0.x, x1.x], zones: x0.zones && x1.zones });
    rows.push({ key: 'making', pts: net.efg - quality, efg: [num(g.adv[0].efg), num(g.adv[1].efg)], x: [x0.x, x1.x] });
  } else rows.push({ key: 'efg', pts: net.efg });
  rows.push({ key: 'tovp', pts: net.tovp }, { key: 'orebp', pts: net.orebp }, { key: 'ftr', pts: net.ftr });
  if (R.ft != null) {
    const f = t => (num(g.adv[t].ftm) || 0) - (num(g.adv[t].fta) || 0) * R.ft;
    rows.push({ key: 'ft', pts: f(0) - f(1), made: [num(g.adv[0].ftm), num(g.adv[1].ftm)], att: [num(g.adv[0].fta), num(g.adv[1].fta)] });
  }
  const home = g.model && num(g.model.home) != null && !(g.meta && g.meta.neutral) ? +g.model.home : null;
  if (home != null) rows.push({ key: 'home', pts: home });
  const actual = g.score[0] - g.score[1];
  const explained = rows.reduce((s, r) => s + r.pts, 0);
  rows.push({ key: 'rest', pts: actual - explained });
  rows.forEach(r => { r.label = FACET_LABEL[r.key]; });
  const w = actual === 0 ? null : actual > 0 ? 0 : 1, sgn = w === 1 ? -1 : 1;
  /* the facets that mattered, from the winners' end: what won it, and what they gave back */
  const play = rows.filter(r => r.key !== 'home' && r.key !== 'rest');
  const forW = play.filter(r => r.pts * sgn >= 1).sort((a, b) => b.pts * sgn - a.pts * sgn);
  const against = play.filter(r => r.pts * sgn <= -1).sort((a, b) => a.pts * sgn - b.pts * sgn);
  const expect = g.ctx && g.ctx.expect && num(g.ctx.expect.margin) != null ? g.ctx.expect : null;
  out.push(F('ledger', w, 74, {
    rows, actual, explained, winner: w, decisive: forW[0] || null, second: forW[1] || null, against: against[0] || null,
    rates: R.from, model: modelTag(g), expect, possessions: poss
  }, 'what decided it, in points'));
  return out;
}

/* WHICH FACET A FACT IS ABOUT: the four factors and what hangs off them. A player's scoring is not a facet (it is the
   result of all of them); his shooting, his boards, his steals and his trips to the line are. */
const FACET_OF_KIND = {
  floor: 'efg', hotThree: 'efg', coldThree: 'efg', efficient: 'efg', inefficient: 'efg', shooter: 'efg', efficientTeam: 'efg',
  midCold: 'efg', atRim: 'efg', fromRange: 'efg', paint: 'efg', halfCourt: 'efg', assistedShare: 'efg', sharing: 'efg',
  forcedTurnovers: 'tovp', careless: 'tovp', pointsOffTurnovers: 'tovp', disruption: 'tovp', turnoverProne: 'tovp', defender: 'tovp',
  boards: 'orebp', missFate: 'orebp', zoneBoards: 'orebp', secondChance: 'orebp', rebounder: 'orebp',
  whistle: 'ftr', drawsFouls: 'ftr', lineLiving: 'ftr', poorLine: 'ft', icedIt: 'ft', lineCostThem: 'ft'
};
function facetOf(f) {
  if (!f) return null;
  if (f.kind === 'factor') return { efg: 'efg', tov: 'tovp', oreb: 'orebp', ftr: 'ftr' }[f.data.factor] || null;
  if (f.kind === 'sitEdge') return { offTo: 'tovp', second: 'orebp' }[f.data.key] || null;
  return FACET_OF_KIND[f.kind] || null;
}
/* each fact on a facet carries the facet's value (points toward the fact's own side) and is promoted by the facet's share
   of everything the ledger counted: up to 14 for the facet that decided it, 4 more when the fact is about the side it
   favoured. The order of the report then follows what the model says mattered. */
function weighFacets(fs) {
  const L = fs.find(f => f.kind === 'ledger');
  if (!L) return fs;
  const val = {};
  L.data.rows.forEach(r => {
    const k = r.key === 'quality' || r.key === 'making' ? 'efg' : r.key;
    val[k] = (val[k] || 0) + r.pts;
  });
  const tot = Object.keys(val).filter(k => k !== 'home' && k !== 'rest').reduce((s, k) => s + Math.abs(val[k]), 0);
  if (!(tot > 0)) return fs;
  fs.forEach(f => {
    const k = facetOf(f);
    if (!k || val[k] == null) return;
    const toward = f.side === 1 ? -val[k] : val[k];
    f.facet = k;
    f.value = f.side == null ? Math.abs(val[k]) : toward;
    f.salience += Math.round(14 * Math.abs(val[k]) / tot) + (toward > 0 ? 4 : 0);
  });
  return fs;
}

/* ============================================================================
   THE MOMENTS: the basket that won it, the man who closed it, the shot at the buzzer. A report that only has totals has
   no scene in it; these are the three a person who was there would tell first. All from the log, so only for a game
   whose log carries a clock.
   ============================================================================ */
function factMoments(g) {
  const out = [];
  const ev = g.events || [];
  if (!clocked(ev) || g.score[0] === g.score[1]) return out;
  const H = halvesOf(g), reg = regOf(g), last = g.periods || reg;
  let total = 0;
  for (let p = 1; p <= last; p++) total += PLEN_(p, H);
  const w = g.score[0] > g.score[1] ? 0 : 1;
  const s = [0, 0];
  let take = null, at5 = null;
  const late = {};                                            // points per player in the last five minutes of the last period
  const buzz = [];
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (e.period === last && e.clock != null && at5 == null && e.clock <= 300000) at5 = s.slice();
    if (!v || e.team == null) return;
    const before = s[w] - s[1 - w];
    s[e.team] += v;
    const after = s[w] - s[1 - w];
    if (e.team === w && before <= 0 && after > 0) take = { e, score: s.slice(), before };
    else if (after <= 0) take = null;
    if (e.period === last && e.clock != null && e.clock <= 300000 && e.pid != null) {
      late[e.team + ':' + e.pid] = (late[e.team + ':' + e.pid] || 0) + v;
    }
    if (e.t !== 'ft_made' && e.clock != null && e.clock <= 2000) buzz.push({ e, score: s.slice(), before, after });
  });
  /* THE GO-AHEAD BASKET FOR GOOD: after it the winners were never level or behind again */
  if (take) {
    const e = take.e, el = elapsed(e.period, e.clock, H), left = total - el;
    const p = e.pid != null ? g.byId[e.pid] : null;
    const kind = e.t === 'p3_made' ? 'three' : e.t === 'ft_made' ? 'free throw' : 'basket';
    /* early in the game it is not a moment: it is the start of a lead that held, which factTimeLed tells */
    if (el / total >= 0.5) {
      const winner = e.period === last && e.clock <= 10000;
      out.push(F(winner ? 'gameWinner' : 'goAhead', w, winner ? 97 : left <= 300000 ? 85 : 62,
        { p, kind, period: e.period, clock: e.clock, left, score: take.score, wasLevel: take.before === 0, last, reg },
        (p ? p.name : g.names[w]) + ' put them ahead for good'));
    }
  }
  /* THE CLOSER: who scored the winners' points when the game was there to be won */
  if (at5 && Math.abs(at5[0] - at5[1]) <= 6) {
    const lateW = g.score[w] - at5[w];
    const best = Object.keys(late).filter(k => +k.split(':')[0] === w).map(k => ({ pid: k.split(':').slice(1).join(':'), pts: late[k] }))
      .sort((a, b) => b.pts - a.pts)[0];
    if (best && best.pts >= 6 && lateW > 0 && best.pts / lateW >= 0.4 && g.byId[best.pid]) {
      out.push(F('closer', w, 72, { p: g.byId[best.pid], pts: best.pts, team: lateW, at5 }, g.byId[best.pid].name + ' closed it'));
    }
  }
  /* AT THE BUZZER: a basket in the last two seconds of a period (the game's last is the winner above, or a consolation) */
  buzz.forEach(b => {
    const e = b.e;
    if (e.period === last) return;
    const p = e.pid != null ? g.byId[e.pid] : null;
    if (!p || e.t !== 'p3_made') return;
    out.push(F('buzzer', e.team, 54, { p, period: e.period, reg, score: b.score }, p.name + ' hit a three at the buzzer'));
  });
  return out.slice(0, 4);
}

/* ============================================================================
   THE SHAPE OF THE GAME: one word for how it went, read off the score line minute by minute, so the writer can choose
   its register before it writes a sentence (a rout is not told like a see-saw). Kinds, in the order they are tested:
     overtime   it needed extra time                       comeback   the winners were down ten or more
     heist      down at five to play and won it            collapse   a lead of fifteen or more, thrown away (comeback,
                                                                      told from the other side: the winners' view wins)
     wire       never behind, and won by ten or more       rout       won by twenty or more
     pulledAway close with five to play, won by twelve     heldOn     ten up with five to play, won by five or fewer
     seesaw     ten lead changes or more                   grind      under 130 points between them and close
     shootout   190 or more between them                   tight      four points or fewer
     control    everything else: in front, kept there
   ============================================================================ */
function factArc(g) {
  const ev = g.events || [];
  const w = g.score[0] >= g.score[1] ? 0 : 1, l = 1 - w;
  const margin = Math.abs(g.score[0] - g.score[1]), total = g.score[0] + g.score[1];
  const s = [0, 0];
  let maxW = 0, maxL = 0, changes = 0, prev = null, at5 = null;
  const last = g.periods || regOf(g);
  const clockedLog = clocked(ev);
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (clockedLog && e.period === last && e.clock != null && at5 == null && e.clock <= 300000) at5 = s.slice();
    if (!v || e.team == null) return;
    s[e.team] += v;
    const d = s[w] - s[l];
    if (d > maxW) maxW = d;
    if (-d > maxL) maxL = -d;
    const leader = d > 0 ? w : d < 0 ? l : null;
    if (leader != null && prev != null && leader !== prev) changes++;
    if (leader != null) prev = leader;
  });
  const lead5 = at5 ? at5[w] - at5[l] : null;
  const reg = regOf(g);
  const kind = margin === 0 ? 'tie'
    : (g.periods || reg) > reg ? 'overtime'
    : maxL >= 15 ? 'collapse'
    : lead5 != null && lead5 <= -4 ? 'heist'
    : maxL >= 10 ? 'comeback'
    : margin >= 20 ? 'rout'
    : maxL === 0 && margin >= 10 && ev.length ? 'wire'
    : lead5 != null && Math.abs(lead5) <= 6 && margin >= 12 ? 'pulledAway'
    : lead5 != null && lead5 >= 10 && margin <= 5 ? 'heldOn'
    : changes >= 10 ? 'seesaw'
    : total <= 130 && margin <= 8 ? 'grind'
    : total >= 190 ? 'shootout'
    : margin <= 4 ? 'tight'
    : 'control';
  return [F('arc', w, 30, { kind, maxW, maxL, changes, lead5, margin, total, winner: w }, 'the shape of it: ' + kind)];
}

/* ============================================================================
   THE GAME IN ITS SEASON (g.ctx, context.js): streaks made and ended, the table, upsets, the meetings between them,
   the schedule, the fans' picks, season highs, returns and milestones. Every one of these is a claim about OTHER games,
   so each is only made when context.js could work it out from games that tipped off before this one.
   ============================================================================ */
function factContext(g) {
  const out = [];
  const C = g.ctx;
  if (!C || !C.sides || !C.sides[0] || !C.sides[1] || g.score[0] === g.score[1]) return out;
  const w = g.score[0] > g.score[1] ? 0 : 1, l = 1 - w;
  const W = C.sides[w], Lo = C.sides[l];

  /* STREAKS: extended, or ended */
  const sw = W.after && W.after.streak, sb = W.before && W.before.streak;
  if (sw && sw.won && sw.n >= 3) out.push(F('winStreak', w, 70 + Math.min(16, 2 * sw.n), { n: sw.n, record: [W.after.w, W.after.l] }, g.names[w] + ' have won ' + sw.n + ' in a row'));
  if (sb && !sb.won && sb.n >= 3) out.push(F('skidEnded', w, 74 + Math.min(12, 2 * sb.n), { n: sb.n, record: [W.after.w, W.after.l] }, g.names[w] + ' ended a run of ' + sb.n + ' defeats'));
  const lb = Lo.before && Lo.before.streak, la = Lo.after && Lo.after.streak;
  if (lb && lb.won && lb.n >= 3) out.push(F('streakEnded', l, 78 + Math.min(12, 2 * lb.n), { n: lb.n, record: [Lo.after.w, Lo.after.l] }, g.names[w] + ' ended ' + g.names[l] + '’s run of ' + lb.n + ' wins'));
  if (la && !la.won && la.n >= 3) out.push(F('loseStreak', l, 62 + Math.min(14, 2 * la.n), { n: la.n, record: [Lo.after.w, Lo.after.l] }, g.names[l] + ' have lost ' + la.n + ' in a row'));
  /* the season's first and the unbeaten */
  if (W.after && W.after.w === 1 && W.before.gp >= 2) out.push(F('firstWin', w, 82, { gp: W.after.gp }, g.names[w] + ' won for the first time this season'));
  if (W.after && W.after.l === 0 && W.after.w >= 4) out.push(F('unbeaten', w, 72 + Math.min(10, W.after.w), { w: W.after.w }, g.names[w] + ' are still unbeaten'));
  if (Lo.after && Lo.after.w === 0 && Lo.after.l >= 4) out.push(F('winless', l, 60, { l: Lo.after.l }, g.names[l] + ' are still looking for a first win'));
  if (Lo.before && Lo.before.l === 0 && Lo.before.w >= 3) out.push(F('firstDefeat', l, 84, { w: Lo.before.w }, g.names[l] + ' lost for the first time'));

  /* THE TABLE: where the result leaves them (only for a game in the table the league page shows, and not before three
     games each: "climb to third in Group C" after a club's first game is a table that has not formed yet) */
  const T = C.table;
  if (T && T[w] && T[l] && (T[w].gp || 0) >= 3 && (T[l].gp || 0) >= 3) {
    const tw = T[w], tl = T[l];
    if (tw.leader && tw.before && tw.before.rank != null && !tw.before.leader && C.inTable) {
      out.push(F('wentTop', w, 86, { rank: 1, of: tw.of, w: tw.w, l: tw.l, group: tw.group }, g.names[w] + ' went top'));
    } else if (tl.before && tl.before.leader && !tl.leader && C.inTable) {
      out.push(F('lostTop', l, 80, { rank: tl.rank, w: tl.w, l: tl.l, group: tl.group }, g.names[l] + ' lost top spot'));
    } else if (tw.leader && C.inTable) {
      out.push(F('stayTop', w, 58, { of: tw.of, w: tw.w, l: tw.l, next: tw.next, group: tw.group }, g.names[w] + ' stay top'));
    }
    if (C.inTable && tw.before && tw.before.rank != null && tw.rank < tw.before.rank && !tw.leader) {
      out.push(F('climbed', w, 60, { from: tw.before.rank, to: tw.rank, of: tw.of, w: tw.w, l: tw.l, group: tw.group }, g.names[w] + ' climbed to ' + tw.rank));
    }
    out.push(F('standing', null, 20, { ranks: [T[0].rank, T[1].rank], of: [T[0].of, T[1].of], rec: [[T[0].w, T[0].l], [T[1].w, T[1].l]],
      gbTop: [T[0].gbTop, T[1].gbTop], groups: [T[0].group, T[1].group], inTable: !!C.inTable }, 'where they stand'));
    /* AN UPSET BY THE TABLE: the winners four or more places below, both with a few games behind them */
    const bw = tw.before && tw.before.rank, bl = tl.before && tl.before.rank;
    if (C.inTable && bw != null && bl != null && bw - bl >= 4 && (W.before.gp || 0) >= 3 && (Lo.before.gp || 0) >= 3) {
      out.push(F('upset', w, 84 + Math.min(8, bw - bl), { by: 'table', rank: [bw, bl], of: tw.of }, g.names[w] + ' beat a side ' + (bw - bl) + ' places above them'));
    }
  }
  /* AN UPSET BY THE NUMBERS: the season's four factors made the other side favourites by a distance */
  const X = C.expect;
  if (X && num(X.margin) != null) {
    const toW = w === 0 ? X.margin : -X.margin;               // what the season said, from the winners' end
    out.push(F('expectation', w, toW <= -5 ? 80 : 36, { toWinner: toW, margin: X.margin, actual: g.score[w] - g.score[l], model: !!X.model, n: X.n },
      'the season’s numbers said ' + (toW >= 0 ? g.names[w] : g.names[l]) + ' by ' + Math.abs(toW).toFixed(1)));
  }

  /* THE MEETINGS: a series, a revenge, a sweep */
  const H = C.h2h;
  if (H && H.meetings && H.meetings.length) {
    const prevW = H.last.won;                                     // 0 or 1 in brief sides
    const series = [H.wins[0] + (w === 0 ? 1 : 0), H.wins[1] + (w === 1 ? 1 : 0)];
    out.push(F('h2h', w, prevW === l ? 66 : 48, { meetings: H.meetings.length + 1, series, revenge: prevW === l, lastScore: H.last.score, lastAt: H.last.at,
      sweep: series[l] === 0 && series[w] >= 2 }, prevW === l ? g.names[w] + ' turned round the last meeting' : 'the meetings this season'));
  } else if (C.sides[0].before.gp >= 1 && C.sides[1].before.gp >= 1) {
    out.push(F('h2hFirst', null, 22, {}, 'the first meeting this season'));
  }

  /* THE SCHEDULE: the second game in two days, and the next one */
  [0, 1].forEach(t => {
    const r = C.sides[t].rest;
    if (r != null && r < 1.5 && r > 0) out.push(F('backToBack', t, t === l ? 52 : 44, { rest: r }, g.names[t] + ' were playing on the second night of two'));
  });
  if (C.next && (C.next[0] || C.next[1])) out.push(F('nextUp', null, 25, { next: C.next }, 'what comes next'));

  /* THE CROWD: the home side's biggest of the season */
  const hc = C.sides[0].before;
  if (num(C.crowd) > 0 && hc && hc.homeCrowds >= 3 && hc.bestCrowd && C.crowd > hc.bestCrowd) {
    out.push(F('bigCrowd', 0, 50, { crowd: C.crowd, before: hc.bestCrowd }, 'the biggest crowd of ' + g.names[0] + '’s season'));
  }
  /* WHAT THEY SCORED AND ALLOWED, against their own season */
  if (W.before && W.before.gp >= 4 && W.before.highFor != null && g.score[w] > W.before.highFor) {
    out.push(F('teamSeasonHigh', w, 64, { pts: g.score[w], before: W.before.highFor }, g.names[w] + ' scored their most of the season'));
  }
  if (W.before && W.before.gp >= 4 && W.before.lowAgainst != null && g.score[l] < W.before.lowAgainst) {
    out.push(F('stingiest', w, 60, { pts: g.score[l], before: W.before.lowAgainst }, g.names[w] + ' allowed their fewest of the season'));
  }

  /* THE FANS' PICKS: who the people who predicted it backed */
  const P = C.tally;
  if (P && P.n >= 12) {
    const forW = w === 0 ? P.home : P.away, share = 100 * forW / P.n;
    if (share <= 35) out.push(F('fansWrong', w, 68, { share, n: P.n }, 'most fans picked ' + g.names[l]));
    else if (share >= 80) out.push(F('fansRight', w, 34, { share, n: P.n }, 'the fans saw it coming'));
  }

  /* THE PLAYERS, against their own season: a season high, a run of big nights, a return, a milestone */
  const PL = C.players || {};
  const back = C.back || {};
  (g.players || []).forEach(p => {
    const c = PL[p.id];
    if (!p.min) return;
    const reb = (p.or || 0) + (p.dr || 0);
    if (c && c.gp >= 3) {
      const hi = c.high || {};
      if ((p.pts || 0) >= 15 && hi.pts != null && p.pts > hi.pts) out.push(F('careerNight', p.team, 76 + Math.min(10, p.pts - hi.pts), { p, stat: 'pts', v: p.pts, before: hi.pts }, p.name + ' set a season high'));
      else if ((p.pts || 0) >= 18 && hi.pts != null && p.pts === hi.pts) out.push(F('careerNight', p.team, 60, { p, stat: 'pts', v: p.pts, before: hi.pts, matched: true }, p.name + ' matched a season high'));
      if (reb >= 10 && hi.reb != null && reb > hi.reb) out.push(F('careerNight', p.team, 64, { p, stat: 'reb', v: reb, before: hi.reb }, p.name + ' set a season high on the boards'));
      if ((p.ast || 0) >= 8 && hi.ast != null && p.ast > hi.ast) out.push(F('careerNight', p.team, 62, { p, stat: 'ast', v: p.ast, before: hi.ast }, p.name + ' set a season high in assists'));
      if ((p.p3m || 0) >= 5 && hi.p3m != null && p.p3m > hi.p3m) out.push(F('careerNight', p.team, 60, { p, stat: 'p3m', v: p.p3m, before: hi.p3m }, p.name + ' set a season high from three'));
      if (c.run20 >= 3) out.push(F('hotStreak', p.team, 66 + Math.min(10, 2 * c.run20), { p, n: c.run20 }, p.name + ' has scored 20 or more ' + c.run20 + ' games running'));
      /* a milestone: the season's points passing a hundred, from 200 up */
      const before = c.totalBefore || 0, after = before + (p.pts || 0);
      const mark = Math.floor(after / 100) * 100;
      if (mark >= 200 && before < mark) out.push(F('milestone', p.team, 52, { p, mark, total: after, gp: c.gp + 1 }, p.name + ' passed ' + mark + ' points for the season'));
    }
    const b = back[p.id];
    if (b && b.missed >= 2 && (p.min || 0) >= 600000) out.push(F('returned', p.team, 58 + Math.min(8, b.missed), { p, missed: b.missed }, p.name + ' was back'));
  });
  /* THE LEAGUE'S SEASON BESTS, set or matched in this game (records_board, read after it) */
  const RC = C.records || {};
  (RC.player || []).forEach(r => {
    const p = (g.players || []).find(x => x.id === r.pid) || (g.players || []).find(x => r.name && String(x.name).toLowerCase() === String(r.name).toLowerCase());
    if (!p) return;
    out.push(F('leagueRecord', p.team, r.shared > 1 ? 70 : 88, { p, stat: r.k, v: r.v, shared: r.shared }, p.name + ' set the league’s season best'));
  });
  (RC.team || []).forEach(r => {
    if (r.side !== 0 && r.side !== 1) return;
    out.push(F('teamRecord', r.side, r.shared > 1 ? 58 : 74, { stat: r.k, v: r.v, shared: r.shared }, g.names[r.side] + ' set a league season best'));
  });
  /* AGE, where the register gives it: the youngest and the oldest who mattered (never for a player without a bio) */
  const BI = C.bios || {};
  const aged = (g.players || []).filter(p => p.min && BI[p.id] && num(BI[p.id].age) != null);
  if (aged.length) {
    const top = aged.slice().sort((a, b) => (b.pts || 0) - (a.pts || 0))[0];
    const age = num(BI[top.id].age);
    if (top && (top.pts || 0) >= 20 && (age <= 20 || age >= 35)) out.push(F('ageNote', top.team, 46, { p: top, age }, top.name + ' is ' + age));
  }
  return out;
}

/* ============================================================================
   THE NUMBERS' PLAYER OF THE GAME: game box plus-minus (bpm.js game(), the figure the box score's own circles print),
   when bpm.js is loaded. The points leader is the obvious answer; this is the other one, and it is only said when it
   is somebody else or a clear margin.
   ============================================================================ */
function factBPM(g) {
  const B = typeof globalThis !== 'undefined' && globalThis.EpinoiaBPM;
  if (!B || !B.game) return [];
  let res = null;
  try {
    const season = g.season && Array.isArray(g.season.players) ? new Map(g.season.players.map(r => [r.id, r])) : null;
    res = B.game({ lines: (g.players || []).map(p => ({ id: p.id, side: p.team, stats: p })), clubs: g.adv && g.adv[0] && g.adv[1] ? [g.adv[0], g.adv[1]] : null, season });
  } catch (_) { return []; }
  if (!res || !res.size) return [];
  const rows = (g.players || []).filter(p => res.has(p.id) && (p.min || 0) >= 900000).map(p => ({ p, bpm: res.get(p.id).bpm }))
    .filter(x => x.bpm != null && isFinite(x.bpm)).sort((a, b) => b.bpm - a.bpm);
  if (!rows.length) return [];
  const top = rows[0], second = rows[1] || null;
  if (top.bpm < 8) return [];
  const scorer = (g.players || []).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0))[0];
  return [F('bpmTop', top.p.team, scorer && scorer.id !== top.p.id ? 63 : 41, { p: top.p, bpm: top.bpm, next: second && { p: second.p, bpm: second.bpm }, notScorer: !!(scorer && scorer.id !== top.p.id) },
    top.p.name + ' had the best game by box plus-minus')];
}

/* ================================================================== facts ===
   Everything, ranked. Callers take the top of the list; nothing downstream
   needs to know how many extractors there were. */
function facts(g) {
  const all = [].concat(
    factResult(g), factQuarters(g), factFlow(g), factFactors(g),
    factLineups(g), factPlayers(g), factTeamShape(g), factSituations(g),
    factDefence(g), factFouls(g), factPassing(g), factZones(g),
    factTempo(g), factSeasonContext(g),
    factEstimatedMargin(g), factClock(g), factHowScored(g), factMisses(g), factTimeLed(g),
    factConnections(g), factPlayTypes(g), factRebZones(g), factShotClock(g),
    /* 2026-09-07: the half, the finish, the box score in words, fuller player
       lines, ties/droughts/early leads, and the dateline */
    factHalf(g), factClosing(g), factTeamLines(g), factPlayerLines(g),
    factTexture(g), factMeta(g),
    /* 2026-10-07: what each facet was worth (the league's own model), the moments, the shape, the season around it */
    factLedger(g), factMoments(g), factArc(g), factContext(g), factBPM(g)
  ).filter(Boolean);
  return weighFacets(all).sort((a, b) => b.salience - a.salience);
}

/* ============================================================================
   THE SCOUT'S LEDGER — the same game, asked the questions a coach asks on the
   Monday: what decided it, what we did well, what we did badly.

   The rest of this file mines what was NEWSWORTHY. A report has to be readable
   by somebody who did not watch, so a 19-point night and a six-minute run are
   the right things to lead with. None of that is what a coach wants on the
   Monday morning, and the difference is the reference point: news compares a
   game to itself, scouting compares it to every other game in the league.

   So this reads the same four factors and rates through gamepct.js -- the
   preset built by replaying a season of real games -- and asks where each side
   sat in that distribution. "They shot 43%" is a fact. "They shot worse from
   the field than eight games in ten in this league, and gave the ball away more
   often than nine in ten" is a scouting report, and it is the same two numbers.

   WHAT DECIDED IT is the gap between the two sides on each measure, in
   percentile points, direction-aware. It deliberately does not weight the
   factors against each other: the honest claim is "this is where the two teams
   were furthest apart", not "this is worth 6.2 points of margin", which would
   need a model this page does not have and could not show its working for.

   DEGRADES. Without the preset (a league with no scales built yet, or a test
   running in node) every percentile is null; the ledger then compares the two
   sides directly and says so, rather than going quiet.
   ============================================================================ */

/* the measures worth a coach's Monday, in the order a coach would ask them */
const SCOUT = [
  { k: 'efg',     lab: 'shooting from the field',      short: 'eFG%' },
  { k: 'tovp',    lab: 'looking after the ball',       short: 'TOV%' },
  { k: 'orebp',   lab: 'the offensive glass',          short: 'OREB%' },
  { k: 'drebp',   lab: 'the defensive glass',          short: 'DREB%' },
  { k: 'ftr',     lab: 'getting to the line',          short: 'FTA rate' },
  { k: 'ftp',     lab: 'free throws',                  short: 'FT%' },
  { k: 'p3p',     lab: 'shooting from three',          short: '3PT%' },
  { k: 'p3r',     lab: 'how much they shot from three', short: '3PA rate', style: true },
  { k: 'rimr',    lab: 'how much they got to the rim', short: 'rim rate', style: true },
  { k: 'rimp',    lab: 'finishing at the rim',         short: 'rim%' },
  { k: 'astp',    lab: 'sharing the ball',             short: 'AST%' },
  { k: 'astTo',   lab: 'assists against turnovers',    short: 'AST/TO' },
  { k: 'stlp',    lab: 'forcing turnovers',            short: 'STL%' },
  { k: 'blkp',    lab: 'protecting the rim',           short: 'BLK%' },
  { k: 'ppp',     lab: 'scoring per possession',       short: 'PPP', mirror: true },
  { k: 'drtg',    lab: 'their defence',                short: 'DRTG', mirror: true }
];

/* how far from ordinary a percentile is — 50 is the middle, so this is the distance from it */
const notable = p => (p == null ? 0 : Math.abs(p - 50));

function scout(g, opts) {
  const o = opts || {};
  /* NOT `root`. This module's factory is called with no arguments (see the wrapper at the top),
     so `root` inside it is undefined and a lookup through it silently finds nothing -- which
     would have left every game ungraded, in the browser as well as in a test, with no error to
     say so. globalThis is the thing that exists in both. */
  const GP = o.gamepct || (typeof globalThis !== 'undefined' && globalThis.EpinoiaGamePct) || null;
  const league = o.league || (g.meta && g.meta.leagueSlug) || null;
  const sides = [0, 1].map(t => {
    const ctx = { T: g.adv[t], O: g.adv[1 - t] };
    const rows = [];
    SCOUT.forEach(m => {
      const T = g.adv[t] || {}, O = g.adv[1 - t] || {};
      const v = T[m.k];
      if (v == null || !isFinite(v)) return;
      let pct = null, band = null;
      if (GP && GP.rate) {
        const r = GP.rate('team', m.k, ctx, { league });
        if (r) { pct = (r.d ? r.g : r.p); band = r.band; }
      }
      rows.push({ key: m.k, label: m.lab, short: m.short, style: !!m.style,
                  value: v, theirs: O[m.k], pct, band });
    });
    /* a style is not a strength: shooting a lot of threes is neither good nor bad, so it is
       described but never listed as something they did well or badly */
    const judged = rows.filter(r => !r.style && r.pct != null);
    const byPct = judged.slice().sort((x, y) => y.pct - x.pct);
    return {
      t, rows,
      good: byPct.filter(r => r.pct >= 60).slice(0, 3),
      bad: byPct.filter(r => r.pct <= 40).reverse().slice(0, 3),
      graded: judged.length > 0
    };
  });

  /* WHERE THE TWO WERE FURTHEST APART. On percentiles when the preset has them, because a
     20-point gap in eFG% and a 20-point gap in OREB% are not the same size of gap; on the raw
     rates when it does not, which is cruder and is labelled as such. */
  const decided = [];
  SCOUT.forEach(m => {
    /* A MIRROR IS NOT A SECOND REASON. One side's points per possession IS the other side's
       defensive rating; listing both as places the teams were far apart says the same thing
       twice and pushes a genuinely different reason off the end of the list. Each still appears
       in its own side's strengths and weaknesses, where it is about that side alone. */
    if (m.style || m.mirror) return;
    const a = sides[0].rows.find(r => r.key === m.k), b = sides[1].rows.find(r => r.key === m.k);
    if (!a || !b) return;
    const graded = a.pct != null && b.pct != null;
    const gap = graded ? (a.pct - b.pct) : null;
    if (graded && Math.abs(gap) < 20) return;                 // both sides in much the same place
    decided.push({ key: m.k, label: m.lab, short: m.short, graded,
                   winner: graded ? (gap > 0 ? 0 : 1) : null,
                   gap: graded ? Math.abs(gap) : null,
                   values: [a.value, b.value], pcts: [a.pct, b.pct] });
  });
  decided.sort((x, y) => (y.gap || 0) - (x.gap || 0));

  const w = g.score[0] >= g.score[1] ? 0 : 1;
  return { league: GP && GP.against ? null : null, graded: sides[0].graded && sides[1].graded,
           sides, decided: decided.slice(0, 4), winner: w,
           margin: Math.abs(g.score[0] - g.score[1]) };
}

/* ============================================================ the preview ===
   THE WEEK'S PREVIEW, AND HOW IT PLAYED OUT (Louie, 2026-10-08: "integrate these with the match report"). The newsroom's
   games-to-watch piece (newsroom.js fWatch, in the league's public newsdesk file) keeps what it said of each of its games:
   the favourite and by how much, the reason with its two season figures, the player it named. previewFor() finds the piece
   that named this game and turns its clubs into the game's sides (0 the hosts, 1 the visitors); previewCall() reads the game
   against it - did the favourite win, did the reason decide anything, what the named player did. Facts only: report.js says
   them (sectionPreview), and nothing here is said when the brief has no preview. */
const PV_SLOTS = /^reason\.(run|runWall|rim|rimWall|three|threeWall|glass|ball|tempo|duel|spot)$/;
function previewFor(desk, gameId, homeId, awayId) {
  const arts = desk && Array.isArray(desk.articles) ? desk.articles : [];
  const side = id => (id != null && String(id) === String(homeId) ? 0 : id != null && String(id) === String(awayId) ? 1 : null);
  const fig = f => (f ? { label: String(f.label || ''), value: String(f.value == null ? '' : f.value), rank: num(f.rank), of: num(f.of) } : null);
  for (const a of arts) {
    if (!a || a.kind !== 'watch' || !Array.isArray(a.games)) continue;
    const x = a.games.find(y => y && String(y.game) === String(gameId));
    if (!x) continue;
    const out = { id: a.id || null, head: a.head || null, top: !!x.top, lean: null, reason: null, player: null };
    if (x.lean && side(x.lean.favourite) != null && num(x.lean.margin) != null) out.lean = { fav: side(x.lean.favourite), margin: num(x.lean.margin) };
    const r = x.reason;
    if (r && PV_SLOTS.test(String(r.slot || '')) && r.a && r.b && side(r.a.team) != null && side(r.b.team) != null) {
      out.reason = { slot: r.slot, o: side(r.a.team), d: side(r.b.team), a: fig(r.a), b: fig(r.b) };
    }
    if (x.player && x.player.name && side(x.player.team) != null) {
      out.player = { side: side(x.player.team), name: String(x.player.name), pid: x.player.pid || null, line: x.player.line || null };
    }
    return out;
  }
  return null;
}
/* a season figure as the preview printed it ("19.5%", "1.14", "+3.2", "72.4") */
const pvNum = s => { const m = /[-−]?\d+(?:\.\d+)?/.exec(String(s == null ? '' : s)); return m ? +m[0].replace('−', '-') : null; };
function previewCall(g) {
  const P = g && g.preview;
  if (!P || !g.score || g.score[0] === g.score[1]) return null;
  const w = g.score[0] > g.score[1] ? 0 : 1, margin = Math.abs(g.score[0] - g.score[1]);
  const out = { top: !!P.top, winner: w, margin, lean: null, reason: null, player: null };
  if (P.lean) {
    const m = P.lean.margin, band = m < 2 ? 'tossup' : m < 4.5 ? 'slight' : m < 8 ? 'clear' : 'heavy';
    out.lean = { fav: P.lean.fav, band, won: P.lean.fav === w, close: margin <= 6 };
  }
  const R = P.reason, A = g.adv || [], T = g.sits || null;
  if (R && A[R.o] && A[R.d]) {
    const kind = R.slot.replace(/^reason\./, ''), O = A[R.o], season = pvNum(R.a.value);
    const sitLine = (t, k) => (T && T[t] && T[t][k] && T[t].all && T[t].all.chances ? { pts: T[t][k].pts || 0, chances: T[t][k].chances || 0, freq: 100 * (T[t][k].chances || 0) / T[t].all.chances } : null);
    let c = null;
    if (kind === 'run' || kind === 'runWall') {
      const s = sitLine(R.o, 'transition');
      if (s && season != null) c = { kind, freq: s.freq, pts: s.pts, chances: s.chances, season,
        held: kind === 'run' ? (s.freq >= 0.9 * season || s.pts >= 15) : s.freq < season && s.pts < 15 };
    } else if (kind === 'rim' || kind === 'rimWall') {
      const twos = (num(O.fga) || 0) - (num(O.fg3a) || 0), placed = (num(O.rimA) || 0) + (num(O.midA) || 0);
      if (twos > 0 && placed / twos >= 0.6 && num(O.rimr) != null && season != null) c = { kind, share: O.rimr, acc: num(O.rimp), season,
        held: kind === 'rim' ? O.rimr >= 0.9 * season : O.rimr < season };
    } else if (kind === 'three' || kind === 'threeWall') {
      const allowed = pvNum(R.b.value);
      if (num(O.p3r) != null && num(O.p3p) != null && num(O.fg3a) >= 8) c = { kind, share: O.p3r, acc: O.p3p, season, allowed,
        held: kind === 'three' ? O.p3p >= 35 : O.p3p < (allowed != null ? allowed + 2 : 33) };
    } else if (kind === 'glass') {
      if (num(O.orebp) != null && season != null) c = { kind, rate: O.orebp, season, held: O.orebp >= 0.9 * season };
    } else if (kind === 'ball') {
      if (num(O.tovp) != null && season != null) c = { kind, rate: O.tovp, season, held: O.tovp >= season };
    } else if (kind === 'tempo') {
      const fast = season, slow = pvNum(R.b.value), pace = num(O.pace);
      if (pace != null && fast != null && slow != null) c = { kind, pace, fast, slow, held: Math.abs(pace - fast) < Math.abs(pace - slow) };
    } else if (kind === 'duel' || kind === 'spot') {
      const find = n => (g.players || []).find(p => p && String(p.name || '').toLowerCase() === String(n || '').toLowerCase());
      const p1 = find(R.a.label), p2 = find(R.b.label);
      if (p1 && p2) c = { kind, p1: { name: p1.name, side: p1.team, pts: p1.pts || 0 }, p2: { name: p2.name, side: p2.team, pts: p2.pts || 0 }, held: (p1.pts || 0) >= (p2.pts || 0) };
    }
    if (c) out.reason = Object.assign(c, { o: R.o, d: R.d });
  }
  if (P.player) {
    const byId = P.player.pid && g.byId ? g.byId[P.player.pid] : null;
    const p = byId || (g.players || []).find(q => q && String(q.name || '').toLowerCase() === P.player.name.toLowerCase());
    const avg = P.player.line ? pvNum(P.player.line) : null;
    if (p && p.min && p.team === P.player.side) out.player = { side: p.team, name: p.name, pts: p.pts || 0, reb: (p.or || 0) + (p.dr || 0), ast: p.ast || 0, avg, mins: num(p.min) };
  }
  return out.lean || out.reason || out.player ? out : null;
}

/* FACTS ONLY. The prose that reads these lives in report.js, deliberately
   behind a seam: everything here is numbers with names attached and can be
   tested for being right, everything there is phrasing and cannot. It is also
   where a language model would be handed the brief. */
return { facts, scout, SCOUT, F, esc, num, one, pct1, mins, ordinal, plural, facetOf, FACET_LABEL, previewFor, previewCall,
         __x: { factResult, factQuarters, factFlow, factFactors,
                factLineups, factPlayers, factTeamShape,
                factDefence, factFouls, factPassing, factZones,
                factTempo, factSeasonContext,
                factHalf, factClosing, factTeamLines, factPlayerLines, factTexture, factMeta,
                factLedger, factMoments, factArc, factContext, factBPM, weighFacets, xefgOf, ledgerRates } };
}));
