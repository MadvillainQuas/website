/* GENERATED from epinoia/story.js by supabase/tests/extract-shared.mjs — do not edit. */
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
function paSide(g, k, t) {
  const A = g.adv[t], v = num(A[k]), poss = num(A.possessions);
  if (v == null || poss == null) return null;
  const b = paBase(g, k).v;
  return (k === 'tovp' ? b - v : v - b) * PA_W[k] * poss / 100;
}
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
  if (Math.abs(est) < 3 || !(g.adv[0].possessions > 0)) return out;
  const side = est > 0 ? 0 : 1, sgn = side === 0 ? 1 : -1;
  /* each factor from the favoured side's end: positive helped them */
  const parts = Object.keys(PA_W).map(k => ({ key: k, label: PA_LABEL[k], pts: net[k] * sgn })).sort((x, y) => y.pts - x.pts);
  const lead = parts[0], second = parts[1] && parts[1].pts >= 2 ? parts[1] : null;
  const against = parts.filter(p => p.pts <= -2).sort((x, y) => x.pts - y.pts)[0] || null;
  out.push(F('estMargin', side, 79, {
    estimated: Math.abs(est), actual: Math.abs(actual), actualSide: actual === 0 ? null : (actual > 0 ? 0 : 1),
    agrees: actual !== 0 && (actual > 0) === (est > 0), lead, second, against,
    baseline: paBase(g, 'efg').league ? 'league' : 'game'
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
  let s = [0, 0], led = [0, 0], level = 0, last = 0;
  const upTo = t => { const d = Math.max(0, t - last); const diff = s[0] - s[1]; if (diff > 0) led[0] += d; else if (diff < 0) led[1] += d; else level += d; last = t; };
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (!v || e.team == null || e.clock == null) return;
    upTo(elapsed(e.period, e.clock));
    s[e.team] += v;
  });
  let total = 0;
  for (let p = 1; p <= (g.periods || 4); p++) total += PLEN_(p);
  upTo(total);
  if (total <= 0) return out;
  const w = g.score[0] > g.score[1] ? 0 : 1;
  const wShare = led[w] / total, lShare = led[1 - w] / total;
  const data = { winner: w, led, level, total, winnerShare: wShare, loserShare: lShare };
  if (lShare >= 0.55) out.push(F('timeLed', 1 - w, 77, Object.assign({ kind: 'ledMost' }, data), g.names[1 - w] + ' led most of the game and lost it'));
  else if (wShare >= 0.93) out.push(F('timeLed', w, 64, Object.assign({ kind: 'wire' }, data), g.names[w] + ' led almost throughout'));
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

/* elapsed ms from the tip to (period, clock-remaining) — the same arithmetic
   the engine uses for minutes, kept local so a brief from any source works */
const PLEN_ = p => (p <= 4 ? 600000 : 300000);
function elapsed(period, clock) {
  let t = 0;
  for (let p = 1; p < (period || 1); p++) t += PLEN_(p);
  return t + (PLEN_(period || 1) - (clock == null ? 0 : clock));
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
  if (!g.perQ || g.periods < 4) return out;
  const per = g.perQ;
  const h1 = [(per[0][1] || 0) + (per[0][2] || 0), (per[1][1] || 0) + (per[1][2] || 0)];
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
  if (g.periods > 4) {
    const ot = [0, 0];
    for (let p = 5; p <= g.periods; p++) { ot[0] += per[0][p] || 0; ot[1] += per[1][p] || 0; }
    const reg = [g.score[0] - ot[0], g.score[1] - ot[1]];
    out.push(F('overtime', w, 93, { ots: g.periods - 4, ot, reg },
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
      g.byId[best.pid].name + ' scored ' + best.n + ' straight for his side'));
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
  const hasClock = clocked(ev);
  ev.forEach(e => {
    const v = SCORE_PTS[e.t];
    if (e.t === 'period_start' && hasClock) {
      /* a drought does not run through the interval */
      for (const t of [0, 1]) lastFG[t] = elapsed(e.period, PLEN_(e.period));
    }
    if (!v || e.team == null) return;
    s[e.team] += v;
    if (s[0] === s[1] && s[0] > 0) ties++;
    if ((e.period || 1) === 1 && early == null) {
      const d = s[0] - s[1];
      if (Math.abs(d) >= 8 && Math.min(s[0], s[1]) <= 6) early = { side: d > 0 ? 0 : 1, score: s.slice() };
    }
    if (hasClock && e.t !== 'ft_made') {
      const now = elapsed(e.period || 1, e.clock);
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

/* ================================================================== facts ===
   Everything, ranked. Callers take the top of the list; nothing downstream
   needs to know how many extractors there were. */
function facts(g) {
  return [].concat(
    factResult(g), factQuarters(g), factFlow(g), factFactors(g),
    factLineups(g), factPlayers(g), factTeamShape(g), factSituations(g),
    factDefence(g), factFouls(g), factPassing(g), factZones(g),
    factTempo(g), factSeasonContext(g),
    factEstimatedMargin(g), factClock(g), factHowScored(g), factMisses(g), factTimeLed(g),
    /* 2026-09-07: the half, the finish, the box score in words, fuller player
       lines, ties/droughts/early leads, and the dateline */
    factHalf(g), factClosing(g), factTeamLines(g), factPlayerLines(g),
    factTexture(g), factMeta(g)
  ).filter(Boolean).sort((a, b) => b.salience - a.salience);
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

/* FACTS ONLY. The prose that reads these lives in report.js, deliberately
   behind a seam: everything here is numbers with names attached and can be
   tested for being right, everything there is phrasing and cannot. It is also
   where a language model would be handed the brief. */
return { facts, scout, SCOUT, F, esc, num, one, pct1, mins, ordinal, plural,
         __x: { factResult, factQuarters, factFlow, factFactors,
                factLineups, factPlayers, factTeamShape,
                factDefence, factFouls, factPassing, factZones,
                factTempo, factSeasonContext,
                factHalf, factClosing, factTeamLines, factPlayerLines, factTexture, factMeta } };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaStory;
export const { facts, F, esc, num, one, pct1, mins, ordinal, plural } = __api;
export default __api;
