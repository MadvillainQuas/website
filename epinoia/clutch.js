'use strict';
/* ============================================================================
   CLUTCH - what a club and its players did when the game was on the line.      window.EpinoiaClutch

   THE RULE. A moment is CLUTCH when it is in the last four minutes of the fourth quarter (of the second half, in a game
   played in halves), or in overtime, and the score is within five points (either way) going into it. Both are read from
   the play-by-play itself: the period and the clock on each play, and the score replayed play by play. A game that was a
   blowout at 4:00 and came back within five is clutch from the play that brought it within five. Change RULE to change the
   definition everywhere it is used.

   ONE GAME, ONE SIDE: clutchGame(g, side) replays the game through the engine (engine.js deriveGame, its read-only
   observer, so the fives on the floor are the engine's own) and keeps, for that side, only what happened in clutch time:
     dur                 seconds of clutch time
     own, opp            the box of each side: pts fga fgm p3a p3m fta ftm tov or dr
     players             { pid: the same box, plus sec (seconds on the floor), use (the team's plays while on: FGA +
                          0.44 FTA + TOV), mine (the ones the player ended): usage = mine / use, and orOn (the team's
                          offensive rebounds while on): playerPoss = use - orOn, the possessions he was on for }
     fives               { key: { ids, sec, own, opp } } - the side's five on the floor, and both sides' boxes while it was
     seqs                the ids (seq) of every play in clutch time, so other modules (the shot chart) can pick theirs out
     final               [the side's score, the other's] at the end of the log (who won)
   A game that never had clutch time (a blowout) has dur 0 and empty boxes; one with no usable log has ok: false.

   season(list) sums clutchGame over games ({ game, side, won }); ratings(own, opp), shooting(box) and usage(player) read
   the sums (possessions estimated, FGA - OREB + TOV + 0.44 FTA, as everywhere a box has no counted possessions).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaClutch = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const req = p => { try { return typeof require === 'function' ? require(p) : null; } catch (_) { return null; } };
const Engine = () => root.EpinoiaEngine || req('./engine.js');

/* THE DEFINITION: the last `fromMs` of the last regular period (the fourth quarter; the second half of a game played in halves)
   and all of overtime, with the margin `margin` points or fewer */
const RULE = Object.freeze({ fromMs: 4 * 60000, margin: 5 });

const num = v => (typeof v === 'number' && isFinite(v) ? v : +v || 0);
const BOX = ['pts', 'fga', 'fgm', 'p3a', 'p3m', 'fta', 'ftm', 'tov', 'or', 'dr'];
const box = () => { const b = {}; BOX.forEach(k => { b[k] = 0; }); return b; };
const addBox = (a, b) => { BOX.forEach(k => { a[k] += num(b[k]); }); return a; };

/* is this moment clutch: the period, the clock left in it (ms), the margin going into it, and how many regular periods the
   game has (4 quarters, or 2 halves) */
function isClutch(period, clockMs, margin, rule, periods) {
  const R = rule || RULE, last = num(periods) || 4;
  const p = num(period);
  if (p < last) return false;
  if (p === last && num(clockMs) > R.fromMs) return false;
  return Math.abs(num(margin)) <= R.margin;
}

/* a play's effect on a box: points, and the counts */
function apply(b, t, ev) {
  switch (t) {
    case 'p2_made': b.fga++; b.fgm++; b.pts += 2; break;
    case 'p2_miss': b.fga++; break;
    case 'p3_made': b.fga++; b.fgm++; b.p3a++; b.p3m++; b.pts += 3; break;
    case 'p3_miss': b.fga++; b.p3a++; break;
    case 'ft_made': b.fta++; b.ftm++; b.pts++; break;
    case 'ft_miss': b.fta++; break;
    case 'to': b.tov++; break;
    case 'reb': if (ev && ev.off) b.or++; else b.dr++; break;
    default: break;
  }
}
const POINTS = { p2_made: 2, p3_made: 3, ft_made: 1 };
const DESC = { loc: 1, tag: 1, stype: 1 };                 // descriptors of another play, not plays
const USE = { p2_made: 1, p2_miss: 1, p3_made: 1, p3_miss: 1, ft_made: 0.44, ft_miss: 0.44, to: 1 };

function clutchGame(g, side, rule) {
  const E = Engine();
  const R = rule || RULE;
  const fail = reason => ({ ok: false, reason, id: g && g.id, dur: 0, own: box(), opp: box(), players: {}, fives: {}, seqs: new Set(), final: [0, 0] });
  if (!E || !E.deriveGame || !E.cumEl) return fail('modules');
  const st = g && g.starters;
  if (!Array.isArray(st) || !Array.isArray(st[0]) || !Array.isArray(st[1]) || !st[0].length || !st[1].length) return fail('starters');
  const evs = ((g && g.events) || []).filter(Boolean);
  if (!evs.length) return fail('events');
  const s = side === 1 ? 1 : 0, o = 1 - s;
  const out = { ok: true, id: g.id, dur: 0, own: box(), opp: box(), players: {}, fives: {}, seqs: new Set() };
  const score = [0, 0];
  let five = [st[0].slice().sort(), st[1].slice().sort()];
  let lastCum = 0;
  const pl = pid => (out.players[pid] = out.players[pid] || Object.assign(box(), { sec: 0, use: 0, mine: 0, orOn: 0 }));
  const fiveOf = ids => { const k = ids.join(','); return out.fives[k] = out.fives[k] || { ids: ids.slice(), sec: 0, own: box(), opp: box() }; };
  /* the game's periods (engine.js formatOf: its own format, or halves read off the log), and the moment of the game clutch time
     can start: 4:00 left in the last regular period */
  const F = E.formatOf ? E.formatOf(Object.assign({}, g, { events: evs })) : null;
  const last = (F && F.periods) || 4;
  const t0 = E.cumEl(last, R.fromMs, F);
  const onFor = sec => { out.dur += sec; fiveOf(five[s]).sec += sec; five[s].forEach(pid => { pl(pid).sec += sec; }); };

  const observe = (ev, d, cum) => {
    const c = num(cum);
    /* the time since the last play: clutch for the five that was on, when the margin going into it was close enough */
    if (c > lastCum && Math.abs(score[s] - score[o]) <= R.margin) {
      const from = Math.max(lastCum, t0);
      if (c > from) onFor((c - from) / 1000);
    }
    lastCum = Math.max(lastCum, c);
    const t = ev.t;
    if (t === 'sub' || DESC[t] || !(ev.team === 0 || ev.team === 1)) {
      if (d && d.onCourt) five = [d.onCourt[0].slice().sort(), d.onCourt[1].slice().sort()];
      return;
    }
    const clutch = isClutch(ev.period, ev.clock, score[s] - score[o], R, last);
    if (clutch) {
      out.seqs.add(ev.seq != null ? ev.seq : ev.id);
      const mine = ev.team === s;
      apply(mine ? out.own : out.opp, t, ev);
      const U = fiveOf(five[s]);
      apply(mine ? U.own : U.opp, t, ev);
      if (mine) {
        if (ev.pid) apply(pl(ev.pid), t, ev);
        if (USE[t]) {
          five[s].forEach(pid => { pl(pid).use += USE[t]; });
          if (ev.pid) pl(ev.pid).mine += USE[t];
        }
        /* the side's offensive rebounds while he was on: they keep a possession going, so his possessions are his plays less them */
        if (t === 'reb' && ev.off) five[s].forEach(pid => { pl(pid).orOn++; });
      }
    }
    if (POINTS[t]) score[ev.team] += POINTS[t];
    if (d && d.onCourt) five = [d.onCourt[0].slice().sort(), d.onCourt[1].slice().sort()];
  };

  const lastPeriod = Math.max(evs.reduce((m, e) => Math.max(m, num(e.period)), 0), num(g.period)) || last;
  try {
    E.deriveGame({ teams: [{ players: [] }, { players: [] }], starters: [st[0].slice(), st[1].slice()], events: evs,
                   period: lastPeriod, clockMs: 0, format: F || undefined, observe });
  } catch (e) { return fail('replay'); }
  /* the time after the last play to the final buzzer */
  const end = E.cumEl(lastPeriod, 0, F);
  if (end > lastCum && Math.abs(score[s] - score[o]) <= R.margin) {
    const from = Math.max(lastCum, t0);
    if (end > from) onFor((end - from) / 1000);
  }
  out.final = [score[s], score[o]];                    // the side's score and the other's, at the end of the log
  return out;
}

/* many games summed: { games (with clutch time), of (all), dur, own, opp, players, fives, seqs: Map game -> Set } */
function season(list, rule) {
  const S = { games: 0, of: 0, dur: 0, own: box(), opp: box(), players: {}, fives: {}, seqs: new Map(), wins: 0, losses: 0 };
  (list || []).forEach(x => {
    const G = clutchGame(x.game, x.side, rule);
    if (!G.ok) return;
    S.of++;
    S.seqs.set(G.id, G.seqs);
    if (!(G.dur > 0) && !G.seqs.size) return;
    S.games++;
    S.dur += G.dur;
    addBox(S.own, G.own); addBox(S.opp, G.opp);
    Object.keys(G.players).forEach(pid => {
      const p = G.players[pid], q = S.players[pid] = S.players[pid] || Object.assign(box(), { sec: 0, use: 0, mine: 0, orOn: 0, games: 0 });
      addBox(q, p); q.sec += p.sec; q.use += p.use; q.mine += p.mine || 0; q.orOn += p.orOn || 0; if (p.sec > 0) q.games++;
    });
    Object.keys(G.fives).forEach(k => {
      const f = G.fives[k], q = S.fives[k] = S.fives[k] || { ids: f.ids, sec: 0, own: box(), opp: box() };
      q.sec += f.sec; addBox(q.own, f.own); addBox(q.opp, f.opp);
    });
    /* won: as given, or the log's own final score */
    const won = typeof x.won === 'boolean' ? x.won : G.final[0] !== G.final[1] ? G.final[0] > G.final[1] : null;
    if (won === true) S.wins++; else if (won === false) S.losses++;
  });
  return S;
}

/* a box read: possessions (estimated), ratings per 100, shooting */
const poss = b => Math.max(0, num(b.fga) - num(b.or) + num(b.tov) + 0.44 * num(b.fta));
function ratings(own, opp) {
  const po = poss(own), pd = poss(opp), n = (po + pd) / 2;
  const ortg = n > 0 ? 100 * own.pts / n : null, drtg = n > 0 ? 100 * opp.pts / n : null;
  return { poss: n, ortg, drtg, net: ortg != null && drtg != null ? ortg - drtg : null, pm: own.pts - opp.pts };
}
function shooting(b) {
  const tsa = num(b.fga) + 0.44 * num(b.fta);
  return {
    efg: b.fga ? 100 * (b.fgm + 0.5 * b.p3m) / b.fga : null,
    ts: tsa > 0 ? 100 * b.pts / (2 * tsa) : null,
    ft: b.fta ? 100 * b.ftm / b.fta : null
  };
}
/* a player's usage in the clutch: the share of the team's plays while they were on the floor that they ended */
const usage = p => (p && p.use > 0 ? 100 * num(p.mine) / p.use : null);
/* the club's possessions while a player was on the floor in clutch time (estimated, as poss() is: its plays less its offensive
   rebounds), the sample his usage and shooting rest on */
const playerPoss = p => (p ? Math.max(0, num(p.use) - num(p.orOn)) : 0);

return { RULE, isClutch, clutchGame, season, ratings, shooting, usage, poss, playerPoss, BOX };
}));
