'use strict';
/* ============================================================================
   GAME FLOW — the GAMEVIS tab, on the EPINOIA box score.

   A port of GAMEVIS_with_ShotChart_v2_6.html's Game Flow tab, chart for chart:

     Player Scoring Runs      renderRunsMomentumChart (player half)
     Team Momentum Runs       renderRunsMomentumChart (team half)
     Scoring Development      renderScoreMarginChart
     Expected Points Added    renderPossessionMarginChart
     Scoring Battle           renderScoringBattleChart
     Points Per Possession    renderPPPDevelopmentChart
     the summary strip        renderGameFlowTab

   GAMEVIS builds its series while it parses a FIBA play-by-play page
   (gameFlowData, playerRuns, teamMomentumRuns). EPINOIA already has the game as
   an event log, so compute() replays that log once, in the same order the
   engine replays it, and produces the same three things with the same formulas:

     possessions   0.96 x (FGA + TOV + 0.44 FTA - OREB), per team, running
     PPP           points / possessions
     EPA           (TO margin + OREB margin) x 1.05
     Scoring Battle (eFG% margin x 1.77 + FT-rate margin x 0.25) x pace / 100
     a point       after every score, every field-goal attempt, every turnover
     a run         consecutive points by one side; 6+ is a team momentum run,
                   and any player with 6+ inside it is a player run

   THREE THINGS ARE DELIBERATELY NOT COPIED, because they are bugs rather than
   behaviour anybody could want:

     * GAMEVIS pushes a turnover's point BEFORE it counts the turnover, so the
       turnover only shows up one point later (and the last one of a game never
       does). Here the turnover is in its own point.
     * Its run markers are sized by a duration string it formats as 1'23" and
       then splits on ':', so every width was minutes-only. Here they are sized
       by the real seconds.
     * Scoring Battle divides by elapsed time, which is Infinity for a shot at
       10:00 of the first period. Here that case takes GAMEVIS's own fallback
       pace, 75.

   And one thing is drawn differently: the gridlines. GAMEVIS labels from -max
   upwards in a fixed step, so an axis could read -11, -7, -3, +1 and never say
   where zero is, and an early Scoring Battle swing of 140 put fifty-seven labels
   on top of one another. The values plotted are the same; the axis is rounded
   out to a whole number of steps either side of zero, and the step widens until
   there are at most a dozen lines.

   THE CHARTS SHARE THE ROTATIONS' TIME AXIS. Rotations is the first card after the
   runs, and Scoring Development, EPA, Scoring Battle and PPP follow it in one tight
   stack. All of them draw on the same axis: the whole game, from the tip to the last
   period's buzzer, laid across the same columns the rotations grid uses (a label
   gutter --gf-lw to the left, then the cells to the edge), so a moment is the same
   distance across whichever card you look at - a run in the margin sits over the five
   who were out there for it. Pointing at any of them draws a line through all of them and the
   rotations at that moment and names the game clock, the score and both five on the floor (a tap
   does the same on a phone). Each chart in the stack has move up / move down buttons,
   so the one being read can be brought up against the rotations; the order is kept in
   the browser. On a phone the cards scroll sideways together.

   Everything is rebuilt from window.S whenever the log changes (game.js's body
   key), so a live game's charts move with it. The interaction — hovering or
   tapping a run lights it in both the strip and the list beneath — is one
   delegated listener bound once by mounted().
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGameFlow = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PLEN = p => (p <= 4 ? 600000 : 300000);
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }

/* engine.js's own ordering (inGameOrder): by game time, ties kept in log order,
   so an assist or a free throw stays behind the play it belongs to */
function inGameOrder(evs) {
  const keyed = evs.map((ev, i) => ({ ev, i, k: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1)) }));
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map(x => x.ev);
}

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* GAMEVIS's "display name": the surname, suffixes skipped */
const surname = name => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  let last = w[w.length - 1];
  if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && w.length > 1) last = w[w.length - 2];
  return last;
};
const firstWord = name => String(name || '').split(' ')[0];

/* formatDuration, exactly: 83 seconds is 1'23" */
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + "'" + String(s % 60).padStart(2, '0') + '"';
}

const periodEnd = p => (p <= 4 ? p * 600 : 2400 + (p - 4) * 300);

/* ---------------------------------------------------------------- compute --- */
function compute(S) {
  const teams = (S && S.teams) || [{}, {}];
  const pmap = {};
  teams.forEach((tm, t) => (tm.players || []).forEach(p => { pmap[p.id] = { team: t, p }; }));
  const fullName = pid => {
    const m = pmap[pid];
    if (!m) return '#?';
    return m.p.name || (m.p.num != null && m.p.num !== '' ? '#' + m.p.num : '#?');
  };
  const shortName = pid => (pmap[pid] && pmap[pid].p.name ? surname(pmap[pid].p.name) : fullName(pid));

  const run0 = () => ({ points: 0, fga: 0, fgm: 0, fg3m: 0, fg3a: 0, fta: 0, ftm: 0, tov: 0, oreb: 0 });
  const R = [run0(), run0()];
  const starters = (S && S.starters) || [[], []];
  const onCourt = [[...(starters[0] || [])], [...(starters[1] || [])]];
  /* who was on the floor, from the tip and after every substitution (names, for the hover): the last entry at or
     before a moment is the five each side had then */
  const lineups = [{ sec: 0, on: [onCourt[0].map(fullName), onCourt[1].map(fullName)] }];

  const points = [];
  const playerRuns = [];
  const teamRuns = [];
  let run = { team: null, pts: 0, players: {}, order: [], baskets: [] };
  /* the id a play has in the video index (epinoia/video.js index(): seq, else id) */
  const idOf = ev => (ev.seq != null ? ev.seq : ev.id);

  const finalize = () => {
    if (run.team === null || run.pts < 6) return;
    const duration = run.endElapsed - run.startElapsed;
    run.order.forEach(pid => {
      const pts = run.players[pid];
      if (pts >= 6) {
        const mine = run.baskets.filter(b => b.pid === pid);
        playerRuns.push({
          /* A RUN HAS A NAME THAT SURVIVES A REDRAW: its first basket. A link to the video
             carries it (?vr=), so it must not be a position in a list that grows. */
          key: 'p' + mine[0].id + '-' + pid, ids: mine.map(b => b.id),
          pid, playerName: shortName(pid), playerFull: fullName(pid), team: teams[run.team].name || '', teamIdx: run.team, points: pts,
          startPeriod: run.startPeriod, startClock: run.startClock, endPeriod: run.endPeriod, endClock: run.endClock,
          startElapsed: run.startElapsed, endElapsed: run.endElapsed,
          seconds: duration, duration: formatDuration(duration),
          startScore: run.startHome + '-' + run.startAway, endScore: run.endHome + '-' + run.endAway
        });
      }
    });
    let top = null, topPts = 0;
    run.order.forEach(pid => { if (run.players[pid] > topPts) { topPts = run.players[pid]; top = pid; } });
    teamRuns.push({
      key: 'm' + run.baskets[0].id, ids: run.baskets.map(b => b.id),
      team: teams[run.team].name || '', teamIdx: run.team, points: run.pts,
      startPeriod: run.startPeriod, startClock: run.startClock, endPeriod: run.endPeriod, endClock: run.endClock,
      lineup: run.lineup, lineupNames: run.lineup.map(fullName),
      startElapsed: run.startElapsed, endElapsed: run.endElapsed,
      seconds: duration, duration: formatDuration(duration),
      scoreDiff: run.team === 0 ? run.pts + '-0' : '0-' + run.pts,
      startScore: run.startHome + '-' + run.startAway, endScore: run.endHome + '-' + run.endAway,
      topScorer: top ? shortName(top) : '', topScorerPoints: topPts
    });
  };

  let period = 1, lastElapsed = 0;
  inGameOrder((S && S.events) || []).forEach(ev => {
    const p = ev.period || 1;
    period = Math.max(period, p);
    const elapsed = cumEl(p, ev.clock != null ? ev.clock : PLEN(p)) / 1000;
    lastElapsed = elapsed;
    const t = ev.team;

    if (ev.t === 'sub' && (t === 0 || t === 1)) {
      onCourt[t] = onCourt[t].filter(x => x !== ev.out);
      if (ev.in && !onCourt[t].includes(ev.in)) onCourt[t].push(ev.in);
      lineups.push({ sec: elapsed, on: [onCourt[0].map(fullName), onCourt[1].map(fullName)] });
      return;
    }
    if (t !== 0 && t !== 1) return;
    const r = R[t];
    let pts = 0, isFGA = false, isTO = false;

    switch (ev.t) {
      case 'p2_made': r.fga++; r.fgm++; pts = 2; isFGA = true; break;
      case 'p2_miss': r.fga++; isFGA = true; break;
      case 'p3_made': r.fga++; r.fgm++; r.fg3a++; r.fg3m++; pts = 3; isFGA = true; break;
      case 'p3_miss': r.fga++; r.fg3a++; isFGA = true; break;
      case 'ft_made': r.fta++; r.ftm++; pts = 1; break;
      case 'ft_miss': r.fta++; break;
      case 'reb': if (ev.off) r.oreb++; return;          // counted, but not a point of its own
      case 'to': r.tov++; isTO = true; break;
      default: return;
    }
    if (pts > 0) r.points += pts;

    /* PLAYER RUNS & TEAM MOMENTUM TRACKING, as GAMEVIS: only a scoring play with a scorer */
    if (pts > 0 && ev.pid) {
      if (run.team === t) {
        run.pts += pts;
        if (!(ev.pid in run.players)) { run.players[ev.pid] = 0; run.order.push(ev.pid); }
        run.players[ev.pid] += pts;
        run.baskets.push({ id: idOf(ev), pid: ev.pid });
      } else {
        finalize();
        run = {
          team: t, pts, players: { [ev.pid]: pts }, order: [ev.pid], baskets: [{ id: idOf(ev), pid: ev.pid }],
          startElapsed: elapsed, startPeriod: p, startClock: ev.clock != null ? ev.clock : PLEN(p),
          startHome: R[0].points - (t === 0 ? pts : 0), startAway: R[1].points - (t === 1 ? pts : 0),
          lineup: [...onCourt[t]]
        };
      }
      run.endElapsed = elapsed; run.endPeriod = p; run.endClock = ev.clock != null ? ev.clock : PLEN(p);
      run.endHome = R[0].points; run.endAway = R[1].points;
    }

    if (pts > 0 || isFGA || isTO) {
      const h = R[0], a = R[1];
      const homePoss = 0.96 * (h.fga + h.tov + 0.44 * h.fta - h.oreb);
      const awayPoss = 0.96 * (a.fga + a.tov + 0.44 * a.fta - a.oreb);
      const homePPP = homePoss > 0 ? h.points / homePoss : 0;
      const awayPPP = awayPoss > 0 ? a.points / awayPoss : 0;
      const toMargin = a.tov - h.tov;
      const orebMargin = h.oreb - a.oreb;
      const epa = (toMargin + orebMargin) * 1.05;
      const homeEfg = h.fga > 0 ? (h.fgm + 0.5 * h.fg3m) / h.fga * 100 : 0;
      const awayEfg = a.fga > 0 ? (a.fgm + 0.5 * a.fg3m) / a.fga * 100 : 0;
      const efgMargin = homeEfg - awayEfg;
      const homeFtRate = h.fga > 0 ? h.ftm / h.fga * 100 : 0;
      const awayFtRate = a.fga > 0 ? a.ftm / a.fga * 100 : 0;
      const ftRateMargin = homeFtRate - awayFtRate;
      const avgPoss = (homePoss + awayPoss) / 2;
      const gamePace = (avgPoss > 0 && elapsed > 0) ? avgPoss / (elapsed / 2400) : 75;
      const scoringBattle = ((efgMargin * 1.77) + (ftRateMargin * 0.25)) * (gamePace / 100);
      points.push({
        elapsed, period: p,
        homePoints: h.points, awayPoints: a.points, margin: h.points - a.points,
        homePoss, awayPoss, possMargin: homePoss - awayPoss, homePPP, awayPPP,
        homeTov: h.tov, awayTov: a.tov, homeOreb: h.oreb, awayOreb: a.oreb,
        toMargin, orebMargin, epa,
        homeEfg, awayEfg, efgMargin, homeFtRate, awayFtRate, ftRateMargin, scoringBattle
      });
    }
  });
  finalize();                                        // the run the game ended on

  return { points, playerRuns, teamRuns, summary: summarise(points), period, lastElapsed, lineups };
}

/* renderGameFlowTab's strip: lead changes and runs read off the flow points */
function summarise(points) {
  let leadChanges = 0, leader = null, homeRun = 0, awayRun = 0, curH = 0, curA = 0, last = 0;
  points.forEach(d => {
    const now = d.margin > 0 ? 'home' : (d.margin < 0 ? 'away' : null);
    if (now && leader && now !== leader) leadChanges++;
    if (now) leader = now;
    const ch = d.margin - last;
    if (ch > 0) { curH += ch; curA = 0; homeRun = Math.max(homeRun, curH); }
    else if (ch < 0) { curA += -ch; curH = 0; awayRun = Math.max(awayRun, curA); }
    last = d.margin;
  });
  const fin = points[points.length - 1] || {};
  return {
    leadChanges, biggestHomeRun: homeRun, biggestAwayRun: awayRun,
    finalEpa: fin.epa || 0, homePPP: fin.homePPP || 0, awayPPP: fin.awayPPP || 0,
    homePoints: fin.homePoints || 0, awayPoints: fin.awayPoints || 0
  };
}

/* ----------------------------------------------------------------- render --- */
const f1 = n => n.toFixed(1);
/* a plot is drawn in these units and stretched to its box (preserveAspectRatio none): x is a share of the game,
   so the lines are stroked without scaling (vector-effect) and every word is HTML, never distorted */
const VW = 1000, VH = 200;
const pct = (v, of) => (100 * v / of).toFixed(3);

/* THE GAME'S TIME AXIS, the rotations' own: the number of periods is rotation.js's rule (four, or the
   period the game is in, or the last one with a play in it), each period's length is FIBA's, and the axis
   is all of it - a live game's charts are drawn on the same width, filled as far as it has got. Seconds. */
function timeline(S) {
  const events = ((S && S.events) || []).filter(Boolean);
  const seen = events.reduce((m, e) => Math.max(m, e.period || 1), 1);
  const nP = Math.max(4, (S && S.period) || 1, seen);
  const periods = [];
  for (let n = 1; n <= nP; n++) periods.push({ n, label: n <= 4 ? 'Q' + n : 'OT' + (n - 4), from: n === 1 ? 0 : periodEnd(n - 1), to: periodEnd(n) });
  return { periods, total: periodEnd(nP) };
}
const xOf = (sec, tl) => Math.max(0, Math.min(VW, sec / tl.total * VW));

/* the dashed line between two periods, through the whole plot */
function periodLines(tl) {
  return tl.periods.slice(0, -1).map(p => {
    const x = f1(p.to / tl.total * VW);
    return '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + VH + '" class="gf-period-line"/>';
  }).join('');
}

/* the area between the line and zero, one closed shape per side of it */
function fillAreas(pts, key, zeroY) {
  let out = '', cur = '', d = '';
  pts.forEach((p, i) => {
    const side = p[key] >= 0 ? 'positive' : 'negative';
    if (side !== cur || i === 0) {
      if (cur) out += '<path d="' + d + ' L ' + f1(pts[i - 1].x) + ' ' + zeroY + ' Z" class="gf-area ' + cur + '"/>';
      d = 'M ' + f1(p.x) + ' ' + zeroY + ' L ' + f1(p.x) + ' ' + f1(p.y);
      cur = side;
    } else {
      d += ' L ' + f1(p.x) + ' ' + f1(p.y);
    }
  });
  if (cur) out += '<path d="' + d + ' L ' + f1(pts[pts.length - 1].x) + ' ' + zeroY + ' Z" class="gf-area ' + cur + '"/>';
  return out;
}

/* generateSegmentedLinePaths: the line changes colour where it crosses zero */
function segmentedLines(pts, key) {
  let out = '', path = '', cls = null;
  pts.forEach((p, i) => {
    const v = p[key], now = v >= 0 ? 'home' : 'away';
    if (i === 0) { path = 'M ' + f1(p.x) + ' ' + f1(p.y); cls = now; return; }
    const q = pts[i - 1], pv = q[key];
    if ((pv >= 0 && v < 0) || (pv < 0 && v >= 0)) {
      const ratio = Math.abs(pv) / (Math.abs(pv) + Math.abs(v));
      const cx = q.x + ratio * (p.x - q.x), cy = q.y + ratio * (p.y - q.y);
      path += ' L ' + f1(cx) + ' ' + f1(cy);
      out += '<path d="' + path + '" class="gf-line ' + cls + '"/>';
      path = 'M ' + f1(cx) + ' ' + f1(cy) + ' L ' + f1(p.x) + ' ' + f1(p.y);
      cls = now;
    } else {
      path += ' L ' + f1(p.x) + ' ' + f1(p.y);
    }
  });
  if (path) out += '<path d="' + path + '" class="gf-line ' + cls + '"/>';
  return out;
}

const legend = (a, b) =>
  '<div class="gf-legend" data-i18n-ctx="legend">' +
    '<span class="gf-legend-item"><span class="gf-legend-line home"></span><span class="gf-home">' + a + '</span></span>' +
    '<span class="gf-legend-item"><span class="gf-legend-line away"></span><span class="gf-away">' + b + '</span></span>' +
  '</div>';

/* A CHART OF THE STACK: a label column, then the plot, the rotations' own two columns (so the plot
   begins where its cells begin and ends where they end), and the periods under it in the same place.
   The y labels and the axis title are HTML in the label column; the plot is one stretched svg, with the
   periods named along its top edge. */
function chartCard(o) {
  const ticks = o.ticks.map(t => '<span class="gf-yt" style="top:' + pct(t.y, VH) + '%">' + t.label + '</span>').join('');
  /* the periods are named inside the plot, along its top edge, so a card has no axis row of its own: the stack stays tight */
  const plabels = o.tl.periods.map(p =>
    '<span class="gf-pl" style="left:' + pct((p.from + p.to) / 2, o.tl.total) + '%">' + p.label + '</span>').join('');
  return '<section class="gf-card gf-chart" data-chart="' + o.key + '">' +
    '<div class="gf-card-head"><h3 class="gf-title">' + o.title + '</h3>' + o.legendHTML + '<span class="gf-mv"></span>' + foldButton(o.key) + '</div>' +
    (o.note ? '<div class="gf-note">' + o.note + '</div>' : '') +
    '<div class="gf-scroll"><div class="gf-al gf-plotrow">' +
      '<div class="gf-yl" aria-hidden="true">' + ticks + '<span class="gf-ytitle">' + esc(o.ytitle) + '</span></div>' +
      '<div class="gf-plot"><svg class="gf-svg" viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="none" role="img" aria-label="' + esc(o.title) + '">' + o.svg + '</svg>' +
        plabels + (o.overlay || '') + '<i class="gf-guide" aria-hidden="true"></i></div>' +
    '</div></div>' +
  '</section>';
}

/* WHAT WAS HAPPENING AT A MOMENT. model: { tl, points, lineups, until } from render(). The clock is the box score's
   (remaining time in the period, rounded up), the score is the last one on or before the moment, and the lineups are
   the last substitution's at or before it - so at the very second of a substitution the new five are shown. Nothing
   for a moment a live game has not got to. */
function stateAt(model, sec) {
  if (!model || !model.tl || !(sec >= 0) || sec > model.until + 1) return null;
  const at = (list, key) => { let k = -1; for (let i = 0; i < list.length && list[i][key] <= sec; i++) k = i; return k; };
  const tl = model.tl;
  const p = tl.periods.find(q => sec < q.to) || tl.periods[tl.periods.length - 1];
  const pi = at(model.points, 'elapsed'), li = at(model.lineups, 'sec');
  const pt = pi >= 0 ? model.points[pi] : null;
  return {
    sec, period: p.n, clock: clockText(p.n, Math.max(0, (p.to - Math.min(sec, p.to)) * 1000)),
    score: pt ? [pt.homePoints, pt.awayPoints] : [0, 0], margin: pt ? pt.margin : 0,
    on: li >= 0 ? model.lineups[li].on : [[], []]
  };
}

/* a value's end of line, in words above or below the point (HTML, so it never stretches) */
function endLabel(pt, text, side, up) {
  const near = pt.x < VW * 0.1;
  return '<span class="gf-endl ' + side + (up ? '' : ' down') + (near ? ' start' : '') + '" style="left:' + pct(pt.x, VW) + '%;top:' + pct(pt.y, VH) + '%">' + text + '</span>';
}
const endDot = (pt, side) => '<span class="gf-dotm ' + side + '" style="left:' + pct(pt.x, VW) + '%;top:' + pct(pt.y, VH) + '%"></span>';

const signed = (v, dp) => (v >= 0 ? '+' : '') + (dp == null ? v : v.toFixed(dp));

/* the order of the stack, and which of its cards have data */
const CHART_KEYS = ['margin', 'epa', 'battle', 'ppp'];
const ORDER_KEY = 'epinoia_gf_order';
let order = null;
function normaliseOrder(list) {
  const a = Array.isArray(list) ? list.filter((k, i) => CHART_KEYS.indexOf(k) >= 0 && list.indexOf(k) === i) : [];
  CHART_KEYS.forEach(k => { if (a.indexOf(k) < 0) a.push(k); });
  return a;
}
function orderNow() {
  if (!order) {
    let saved = null;
    try { saved = JSON.parse(root.localStorage.getItem(ORDER_KEY)); } catch (_) { /* private mode, or nothing kept */ }
    order = normaliseOrder(saved);
  }
  return order;
}
function keepOrder(list) {
  order = normaliseOrder(list);
  try { root.localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (_) { /* a nicety */ }
}
/* FOLDING: any of the four charts, and either side's rotations, can be shut to its title. Which are
   shut is kept per reader (this browser), like the order, and put back after every redraw. */
const FOLD_KEY = 'epinoia_gf_fold';
function foldState() {
  try { const v = JSON.parse(root.localStorage.getItem(FOLD_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; }
}
function keepFold(key, shut) {
  const st = foldState();
  if (shut) st[key] = true; else delete st[key];
  try { root.localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch (_) { /* a nicety */ }
}
const foldButton = key =>
  '<button type="button" class="gf-fold" data-fold="' + key + '" aria-expanded="true" title="Collapse" aria-label="Collapse"><i aria-hidden="true"></i></button>';
/* the rotations are rotation.js's markup (shared with the club page), so their buttons are put in here */
function wireFolds(host) {
  host.querySelectorAll('.gf-rot .rot-team').forEach((t, side) => {
    t.dataset.fold = 'rot' + side;
    const h = t.querySelector('.rot-h');
    if (h && !h.querySelector('.gf-fold')) h.insertAdjacentHTML('beforeend', foldButton('rot' + side));
  });
  const st = foldState();
  host.querySelectorAll('.gf-fold').forEach(b => setFold(host, b, !!st[b.dataset.fold]));
}
function setFold(host, b, shut) {
  const box = b.closest('.gf-chart, .rot-team');
  if (!box) return;
  box.classList.toggle('gf-shut', shut);
  b.setAttribute('aria-expanded', shut ? 'false' : 'true');
  b.title = shut ? 'Expand' : 'Collapse';
  b.setAttribute('aria-label', b.title);
}

const moveButtons = (i, n) =>
  '<span class="gf-mv"><button type="button" class="gf-mvb" data-mv="up" title="Move up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
  '<button type="button" class="gf-mvb" data-mv="down" title="Move down" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>▼</button></span>';

/* a symmetric axis: GAMEVIS's step, widened until 2 x max / step is at most 12, and the
   max rounded out to a whole number of steps so zero is always a labelled line */
const NICE = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
function symAxis(yMax, step) {
  let i = NICE.indexOf(step); if (i < 0) i = 0;
  while ((2 * yMax) / NICE[i] > 12 && i < NICE.length - 1) i++;
  const st = NICE[i];
  return { yMax: Math.ceil(yMax / st) * st, step: st };
}
const sideCls = v => (v >= 0 ? 'gf-home' : 'gf-away');

/* THE RUNS, MADE TO READ.

   GAMEVIS pins a labelled block to each run's moment in the game, 55 to 150 pixels
   wide whatever the run lasted. Runs a minute apart sat on top of one another, a
   player's name was cut to four letters, and on a phone the track had to be dragged
   sideways before any of it could be read.

   So the chart does two jobs in two places. The STRIP says when and how big: one bar
   per run, as wide as the run lasted and as tall as it was against the biggest run in
   the chart, home above the line and away below, across the full width at any screen
   size, each bar numbered. The LIST beneath says everything GAMEVIS kept in its
   tooltip — the run, where it started and finished on the game clock, the score either
   side of it, who scored most and the five on the floor — as text a phone can read, in
   game order, under the same numbers. Hovering or tapping either lights the other. */
const clockText = (period, ms) => {
  const s = Math.ceil(Math.max(0, ms || 0) / 1000);                 // boxscore.js fmtClock
  return (period <= 4 ? 'Q' + period : 'OT' + (period - 4)) + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const whenText = r => {
  const a = clockText(r.startPeriod, r.startClock), b = clockText(r.endPeriod, r.endClock);
  return a + ' – ' + (r.endPeriod === r.startPeriod ? b.replace(/^\S+ /, '') : b);
};
const dash = score => String(score).replace('-', '–');

function runsCharts(F, names, watch) {
  const data = F.points;
  if (data.length < 2) return '';
  const maxElapsed = Math.max(...data.map(d => d.elapsed)) || 1;
  const maxPeriod = Math.max(...data.map(d => d.period));
  const pct = sec => Math.max(0, Math.min(100, sec / maxElapsed * 100));

  let dividers = '', quarters = '';
  for (let p = 1; p <= maxPeriod; p++) {
    const a = pct(p === 1 ? 0 : periodEnd(p - 1)), b = pct(periodEnd(p));
    if (p > 1) dividers += '<span class="gf-strip-div" style="left:' + a.toFixed(2) + '%"></span>';
    if (b > a) quarters += '<span class="gf-strip-q" style="left:' + ((a + b) / 2).toFixed(2) + '%">' + (p <= 4 ? 'Q' + p : 'OT' + (p - 4)) + '</span>';
  }

  const chart = (runs, kind, emptyText, rowHTML) => {
    if (!runs.length) return '<p class="gf-none">' + emptyText + '</p>';
    const maxPts = Math.max(7, ...runs.map(r => r.points));             // the biggest run fills the height
    /* two players can each have 6+ inside ONE team run: same side, same stretch of
       clock. They share its width side by side rather than drawing over each other. */
    const groups = {};
    runs.forEach(r => { const k = r.teamIdx + ':' + r.startElapsed + ':' + r.endElapsed; (groups[k] = groups[k] || []).push(r); });
    /* a number that would land within 5% of the one before it on the same side goes up
       (or down) a row, so neighbouring runs never print their numbers over each other */
    const lastInRow = [[], []];
    const bars = runs.map((r, i) => {
      const g = groups[r.teamIdx + ':' + r.startElapsed + ':' + r.endElapsed], gi = g.indexOf(r);
      const x0 = pct(r.startElapsed), span = Math.max(0, pct(r.endElapsed) - x0) / g.length;
      const left = x0 + gi * span, cx = left + span / 2;
      const rows = lastInRow[r.teamIdx];
      let row = 0;
      while (row < 2 && rows[row] != null && cx - rows[row] < 5) row++;
      if (row === 2) row = 0;
      rows[row] = cx;
      const f = 0.3 + 0.7 * Math.min(1, (r.points - 6) / (maxPts - 6));
      return '<span class="gf-bar ' + (r.teamIdx === 0 ? 'home' : 'away') + '" data-run="' + kind + i + '"' +
        ' title="' + esc('#' + (i + 1) + '  ' + (kind === 'p' ? r.playerFull + ' ' + r.points + ' pts' : r.team + ' ' + dash(r.scoreDiff)) +
                         ' · ' + whenText(r) + ' · ' + dash(r.startScore || '') + (r.startScore ? ' → ' + dash(r.endScore) : '')) + '"' +
        ' style="--x:' + left.toFixed(2) + '%;--w:' + span.toFixed(2) + '%;--f:' + f.toFixed(3) + ';--row:' + row + '">' +
        '<span class="gf-badge">' + (i + 1) + '</span></span>';
    }).join('');
    return '<div class="gf-strip" aria-hidden="true"><span class="gf-strip-mid"></span>' + dividers + bars + '</div>' +
      '<div class="gf-strip-axis" aria-hidden="true">' + quarters + '</div>' +
      '<ol class="gf-runlist">' + runs.map((r, i) =>
        '<li class="gf-runrow ' + (r.teamIdx === 0 ? 'home' : 'away') + '" data-run="' + kind + i + '">' +
          '<span class="gf-runno">' + (i + 1) + '</span>' + rowHTML(r) +
          /* WATCH VIDEO: the video tab, on this run, playing from its first basket to its last */
          (watch ? '<button type="button" class="gf-watch" data-watch="' + esc(r.key) + '" aria-label="' +
                   esc('Watch run ' + (i + 1) + ' on video') + '">▶ Watch video</button>' : '') +
        '</li>').join('') +
      '</ol>';
  };

  /* the score either side of a run is only known for a team run; a player run carries it too */
  const score = r => '<span class="gf-runscore">' + dash(r.startScore) + ' → ' + dash(r.endScore) + '</span>';
  const playerRow = r =>
    '<span class="gf-runbig">' + r.points + '<small> pts</small></span>' +
    '<span class="gf-runmain"><b>' + esc(r.playerFull) + '</b><span class="gf-runwhen">' + esc(r.team) + '</span></span>' +
    '<span class="gf-runwhen gf-runclock">' + whenText(r) + ' · ' + r.duration + '</span>' + score(r);
  const teamRow = r =>
    '<span class="gf-runbig">' + dash(r.scoreDiff) + '</span>' +
    '<span class="gf-runmain"><b>' + esc(r.team) + '</b><span class="gf-runwhen">' + whenText(r) + ' · ' + r.duration + '</span></span>' +
    '<span class="gf-runtop">Top scorer <b>' + esc(r.topScorer) + '</b> ' + r.topScorerPoints + '</span>' +
    score(r) +
    '<span class="gf-runline">On court: ' + esc(r.lineupNames.join(', ')) + '</span>';

  const count = (list, t) => list.filter(r => r.teamIdx === t).length;
  const sideLegend = list => legend('▲ ' + esc(names[0]) + ' (' + count(list, 0) + ')', '▼ ' + esc(names[1]) + ' (' + count(list, 1) + ')');

  return '<section class="gf-card gf-runs">' +
      '<div class="gf-card-head"><h3 class="gf-title">Player Scoring Runs (6+ consecutive pts)</h3>' + sideLegend(F.playerRuns) + '</div>' +
      chart(F.playerRuns, 'p', 'No individual player runs (6+ pts) detected', playerRow) +
    '</section>' +
    '<section class="gf-card gf-runs">' +
      '<div class="gf-card-head"><h3 class="gf-title">Team Momentum Runs (6+ consecutive pts by lineup)</h3>' + sideLegend(F.teamRuns) + '</div>' +
      chart(F.teamRuns, 'm', 'No team momentum runs (6+ pts) detected', teamRow) +
    '</section>';
}

/* renderScoreMarginChart */
function marginChart(F, names, tl) {
  const data = F.points;
  if (data.length < 2) return '';
  const maxMargin = Math.max(...data.map(d => Math.abs(d.margin)));
  const ax = symAxis(Math.max(30, Math.ceil(maxMargin / 5) * 5 + 5), 10);
  const yMax = ax.yMax;
  const zeroY = VH / 2;
  const pts = data.map(d => ({ x: xOf(d.elapsed, tl), y: zeroY - (d.margin / yMax) * (VH / 2), margin: d.margin }));
  let grid = '';
  const ticks = [];
  for (let v = -yMax; v <= yMax; v += ax.step) {
    const y = zeroY - (v / yMax) * (VH / 2);
    ticks.push({ y, label: (v > 0 ? '+' : '') + v });
    grid += '<line x1="0" y1="' + f1(y) + '" x2="' + VW + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  return chartCard({ key: 'margin', title: 'Scoring Development (Score Margin)', legendHTML: legend(esc(names[0]) + ' Lead', esc(names[1]) + ' Lead'), ytitle: 'Score Margin', tl, ticks,
    svg: grid + '<line x1="0" y1="' + zeroY + '" x2="' + VW + '" y2="' + zeroY + '" class="gf-zero-line"/>' +
         periodLines(tl) + fillAreas(pts, 'margin', zeroY) + segmentedLines(pts, 'margin') });
}

/* ROTATIONS: a row per player and a cell per minute, shaded by how much of that minute he was
   on the floor, both sides with the margin between them (epinoia/rotation.js). Coloured with the
   same theme-inked club colours as every other chart on this tab. */
function rotationCard(S, names) {
  const R = root.EpinoiaRotation;
  if (!R) return '';
  const M = R.compute(S);
  if (!M.teams.some(t => t.rows.some(r => !r.dnp))) return '';
  /* no margin strip between the sides: the Scoring Development chart under it is the margin, on the same minutes */
  return '<section class="gf-card gf-rot">' +
    '<div class="gf-card-head"><h3 class="gf-title">Rotations</h3></div>' +
    '<div class="gf-note">Each cell is a minute of the game, shaded by how much of it the player was on the floor. ' +
      '<span>The charts beneath use these same minutes: move one up to read it against the rotations.</span></div>' +
    R.html(M, { colours: ['var(--vis-t0, var(--team0))', 'var(--vis-t1, var(--team1))'], margin: false }) +
  '</section>';
}

/* the EPA and Scoring Battle charts share one shape: a signed value about zero, an end label */
function signedChart(opts) {
  const { data, key, title, names, note, axisTitle, tl } = opts;
  /* the chart's id (key) is not always the name of the value in the points: the Scoring Battle chart is 'battle' and its
     value is scoringBattle. It read d.battle, which is nothing, so the whole chart was drawn at zero. */
  const field = opts.field || key;
  const maxAbs = Math.max(...data.map(d => Math.abs(d[field] || 0)));
  const raw = Math.max(5, Math.ceil(maxAbs) + 2);
  const ax = symAxis(raw, raw > 15 ? 5 : (raw > 8 ? 4 : 2));
  const yMax = ax.yMax, step = ax.step;
  const zeroY = VH / 2;
  const pts = data.map(d => {
    const v = d[field] || 0;
    return { x: xOf(d.elapsed, tl), y: zeroY - (v / yMax) * (VH / 2), [key]: v };
  });
  let grid = '';
  const ticks = [];
  for (let v = -yMax; v <= yMax; v += step) {
    const y = zeroY - (v / yMax) * (VH / 2);
    ticks.push({ y, label: (v > 0 ? '+' : '') + v.toFixed(0) });
    grid += '<line x1="0" y1="' + f1(y) + '" x2="' + VW + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  const end = pts[pts.length - 1], fin = end[key];
  return chartCard({ key: opts.key, title, legendHTML: legend(esc(names[0]) + ' Advantage', esc(names[1]) + ' Advantage'), note, ytitle: axisTitle, tl, ticks,
    svg: grid + '<line x1="0" y1="' + zeroY + '" x2="' + VW + '" y2="' + zeroY + '" class="gf-zero-line"/>' +
         periodLines(tl) + fillAreas(pts, key, zeroY) + segmentedLines(pts, key),
    overlay: endLabel(end, signed(fin, 1), fin >= 0 ? 'home' : 'away', fin >= 0) });
}

function epaChart(F, names, tl) {
  const data = F.points;
  if (data.length < 2) return '';
  const last = data[data.length - 1];
  const note = 'EPA = (TO Margin + OREB Margin) × 1.05 PPP | ' +
    '<span class="' + sideCls(last.toMargin) + '">TO: ' + signed(last.toMargin) + '</span> | ' +
    '<span class="' + sideCls(last.orebMargin) + '">OREB: ' + signed(last.orebMargin) + '</span>';
  return signedChart({ key: 'epa', data, title: 'Expected Points Added (EPA)', names, note, axisTitle: 'EPA (pts)', tl });
}

function battleChart(F, names, tl) {
  const all = F.points;
  if (all.length < 2) return '';
  /* buffered until both sides have scored, so one early basket is not a landslide */
  const first = all.findIndex(d => d.homePoints > 0 && d.awayPoints > 0);
  const data = first >= 0 ? all.slice(first) : all;
  if (data.length < 2) return '';
  const last = data[data.length - 1];
  const note = 'SB = (eFG% Margin × 1.77 + FT Rate Margin × 0.25) × Pace/100 | ' +
    '<span class="' + sideCls(last.efgMargin) + '">eFG%: ' + signed(last.efgMargin, 1) + '</span> | ' +
    '<span class="' + sideCls(last.ftRateMargin) + '">FT Rate: ' + signed(last.ftRateMargin, 1) + '</span>';
  return signedChart({ key: 'battle', field: 'scoringBattle', data, title: 'Scoring Battle (eFG% + FT Rate)', names, note, axisTitle: 'SB (pts)', tl });
}

/* renderPPPDevelopmentChart */
function pppChart(F, names, tl) {
  const all = F.points;
  const data = all.filter(d => d.homePPP > 0 || d.awayPPP > 0);
  if (data.length < 2) return '';
  const maxPPP = Math.max(...all.map(d => Math.max(d.homePPP, d.awayPPP)));
  const minPPP = Math.min(...data.map(d => Math.min(d.homePPP || 99, d.awayPPP || 99)));
  const yMin = Math.max(0, Math.floor((minPPP - 0.1) * 10) / 10);
  const yMax = Math.min(2.0, Math.ceil((maxPPP + 0.1) * 10) / 10);
  const yRange = (yMax - yMin) || 1;
  const toY = v => VH - ((v - yMin) / yRange) * VH;
  const line = k => data.filter(d => d[k] > 0).map(d => ({ x: xOf(d.elapsed, tl), y: toY(d[k]), ppp: d[k] }));
  const hp = line('homePPP'), ap = line('awayPPP');
  const pathOf = ps => ps.map((p, i) => (i ? 'L ' : 'M ') + f1(p.x) + ' ' + f1(p.y)).join(' ');
  const step = yRange > 0.6 ? 0.2 : 0.1;
  let grid = '';
  const ticks = [];
  for (let i = 0, v = yMin; v <= yMax + 1e-9; i++, v = yMin + i * step) {
    const y = toY(v);
    ticks.push({ y, label: v.toFixed(2) });
    grid += '<line x1="0" y1="' + f1(y) + '" x2="' + VW + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  const avgY = toY(1.0);
  const showRef = avgY >= 0 && avgY <= VH;
  const ref = showRef ? '<line x1="0" y1="' + f1(avgY) + '" x2="' + VW + '" y2="' + f1(avgY) + '" class="gf-ref-line"/>' : '';
  /* GAMEVIS put the 1.00 label at the right-hand end, exactly where a side finishing near 1.00 prints its own
     PPP; inside the left edge it collides with nothing */
  const refLabel = showRef ? '<span class="gf-refl" style="top:' + pct(avgY, VH) + '%">1.00</span>' : '';
  /* the two ends are labelled on opposite sides of their points - the higher above, the lower below - so
     two sides finishing close together never print over each other */
  const eh = hp[hp.length - 1], ea = ap[ap.length - 1];
  const homeUp = !eh || !ea || eh.y <= ea.y;
  const overlay = refLabel +
    (eh ? endDot(eh, 'home') + endLabel(eh, eh.ppp.toFixed(3), 'home', homeUp) : '') +
    (ea ? endDot(ea, 'away') + endLabel(ea, ea.ppp.toFixed(3), 'away', !homeUp) : '');
  return chartCard({ key: 'ppp', title: 'Points Per Possession Development', legendHTML: legend(esc(names[0]), esc(names[1])), ytitle: 'PPP', tl, ticks,
    svg: grid + ref + periodLines(tl) + '<path d="' + pathOf(hp) + '" class="gf-line home"/><path d="' + pathOf(ap) + '" class="gf-line away"/>', overlay });
}

/* a video row that can be wound to a moment: a recording or an archived stream, not the
   league channel's live edge (that has no video id to seek within) */
const hasFootage = S => !!(S && S.video && S.video.url);
let model = null;                       // the last render's, for the hover

/* the timeline, and the model the hover reads: the moment a live game has got to is its last play, or its clock */
function setModel(S, F, names) {
  const tl = timeline(S);
  const until = S && S.status === 'final' ? tl.total
    : Math.max(F.lastElapsed || 0, S && S.clockMs != null && S.period ? cumEl(S.period, S.clockMs) / 1000 : 0);
  model = { tl, points: F.points, lineups: F.lineups, until, names };
  return tl;
}

/* THE SCORING DEVELOPMENT CHART ALONE, for the modern box score: the same card the Game Flow tab draws
   (same axis, fold button and hover), without the tab's other charts. Empty until there is a game to draw. */
function marginOnly(S) {
  const F = compute(S);
  if (F.points.length < 2) return '';
  const names = [0, 1].map(t => (S && S.teams && S.teams[t] && S.teams[t].name) || (t ? 'Away' : 'Home'));
  const tl = setModel(S, F, names);
  return '<div class="gf gf-solo">' + marginChart(F, names, tl).replace('<span class="gf-mv"></span>', '') + '</div>';
}

function render(S) {
  const F = compute(S);
  const names = [0, 1].map(t => (S && S.teams && S.teams[t] && S.teams[t].name) || (t ? 'Away' : 'Home'));
  if (F.points.length < 2) {
    return '<div class="gf"><section class="gf-card gf-empty">' +
      '<h3 class="gf-title">Game flow is not available yet</h3>' +
      '<p>The charts are drawn from the play-by-play, and this game does not have enough of it yet.</p>' +
      '</section></div>';
  }
  const s = F.summary;
  const item = (label, value, cls) =>
    '<div class="gf-stat"><span class="gf-stat-label">' + label + '</span><span class="gf-stat-value' + (cls ? ' ' + cls : '') + '">' + value + '</span></div>';
  /* the rotations, then the four charts on their minutes in one tight stack, in the reader's order */
  const tl = setModel(S, F, names);
  const charts = { margin: marginChart(F, names, tl), epa: epaChart(F, names, tl), battle: battleChart(F, names, tl), ppp: pppChart(F, names, tl) };
  const shown = orderNow().filter(k => charts[k]);
  const stack = shown.length
    ? '<div class="gf-stack">' + shown.map((k, i) => charts[k].replace('<span class="gf-mv"></span>', moveButtons(i, shown.length))).join('') + '</div>'
    : '';
  return '<div class="gf">' +
    runsCharts(F, names, hasFootage(S)) + rotationCard(S, names) + stack +
    '<div class="gf-summary">' +
      item('Final Score', s.homePoints + ' - ' + s.awayPoints, s.homePoints > s.awayPoints ? 'gf-home' : 'gf-away') +
      item('Lead Changes', s.leadChanges) +
      item('Biggest ' + esc(firstWord(names[0])) + ' Run', s.biggestHomeRun + '-0', 'gf-home') +
      item('Biggest ' + esc(firstWord(names[1])) + ' Run', '0-' + s.biggestAwayRun, 'gf-away') +
      item('Final EPA', signed(s.finalEpa, 1) + ' pts', s.finalEpa >= 0 ? 'gf-home' : 'gf-away') +
      item(esc(firstWord(names[0])) + ' PPP', s.homePPP.toFixed(3), 'gf-home') +
      item(esc(firstWord(names[1])) + ' PPP', s.awayPPP.toFixed(3), 'gf-away') +
    '</div></div>';
}

/* THE CLUBS' COLOURS, MADE TO READ ON THIS THEME'S GROUND. game.js inks them for the
   light theme only; on the dark one a navy club's lines and labels were navy on near-black.
   The page's raw colours are read back, inked with EpinoiaTeamColour against whichever
   ground is showing, and set on the host both tabs draw into; the text on a solid marker is
   chosen against the inked colour. */
function inkTeams(host) {
  const TC = root.EpinoiaTeamColour;
  if (!host || !TC || !TC.ink || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  ['0', '1'].forEach(t => {
    const c = cs.getPropertyValue('--team' + t).trim();
    if (!/^#[0-9a-f]{6}$/i.test(c)) return;
    const k = TC.ink(c) || c;
    host.style.setProperty('--vis-t' + t, k);
    if (TC.on) host.style.setProperty('--gf-on' + t, TC.on(k));
  });
}

/* THE HOVER. Pointing at a chart's plot (a tap, on a phone) reads the moment under the pointer off the shared
   axis: a line goes through every chart and through the rotations at that minute, the players on the floor are
   marked in the rotations, and a card by the pointer says the clock, the score and both five. It is one card on
   the page (fixed to the window, so no box clips it), told which colours to use by the host. */
let tipEl = null, hasHoverBound = false;
function ensureTip() {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'gf-tip';
  tipEl.hidden = true;
  tipEl.setAttribute('role', 'status');
  document.body.appendChild(tipEl);
  return tipEl;
}

/* a line through the rotations' cells, one per side: the rotations are rotation.js's markup, so the line is put in */
function wireGuides(host) {
  host.querySelectorAll('.gf-rot .rot-team').forEach(t => {
    if (t.querySelector('.gf-guidebox')) return;
    const b = document.createElement('span');
    b.className = 'gf-guidebox';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = '<i class="gf-guide"></i>';
    t.appendChild(b);
  });
}

function hideProbe(host) {
  if (tipEl) tipEl.hidden = true;
  if (!host) return;
  host.querySelectorAll('.gf-guide.on').forEach(g => g.classList.remove('on'));
  host.querySelectorAll('.rot-row.on-floor').forEach(r => r.classList.remove('on-floor'));
}

function probe(host, plot, clientX, clientY) {
  const M = host.__gfModel;
  const rect = plot.getBoundingClientRect();
  if (!M || !(rect.width > 0)) return hideProbe(host);
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const st = stateAt(M, frac * M.tl.total);
  if (!st) return hideProbe(host);
  host.querySelectorAll('.gf-guide').forEach(g => { g.style.left = (frac * 100).toFixed(3) + '%'; g.classList.add('on'); });
  /* the players on the floor, marked in the rotations (matched by name within each side) */
  host.querySelectorAll('.gf-rot .rot-team').forEach((t, side) => {
    const on = new Set(st.on[side] || []);
    t.querySelectorAll('.rot-row').forEach(r => {
      const b = r.querySelector('.rot-nm b');
      r.classList.toggle('on-floor', !!b && on.has(b.textContent));
    });
  });
  const tip = ensureTip();
  ['--vis-t0', '--vis-t1'].forEach(k => { const v = host.style.getPropertyValue(k); if (v) tip.style.setProperty(k, v); else tip.style.removeProperty(k); });
  const name = i => esc((M.names && M.names[i]) || (i ? 'Away' : 'Home'));
  const lead = st.margin === 0 ? 'level' : signed(st.margin);
  const side = i => '<div class="gf-tip-t ' + (i ? 'away' : 'home') + '"><b>' + name(i) + '</b><span>' +
    (st.on[i].length ? st.on[i].map(esc).join(' · ') : '—') + '</span></div>';
  tip.innerHTML = '<div class="gf-tip-h"><b>' + esc(st.clock) + '</b><span class="gf-tip-s">' + name(0) + ' ' + st.score[0] + '–' + st.score[1] + ' ' + name(1) +
    ' · <span class="' + (st.margin > 0 ? 'gf-home' : st.margin < 0 ? 'gf-away' : '') + '">' + lead + '</span></span></div>' + side(0) + side(1);
  tip.hidden = false;
  /* by the pointer: above it, to its right, and kept inside the window. THE PAGE IS ZOOMED on a desktop (theme.css: 1.25
     from 1000px, 1.5 from 1200px) and the card sits on the body, so the sums are done in screen pixels and divided back
     by the card's own scale, read off the card (as modern.js place does), right at any zoom and in a browser with none. */
  const box = tip.getBoundingClientRect();
  const k = tip.offsetWidth ? (box.width / tip.offsetWidth) || 1 : 1;
  const w = box.width, h = box.height, vw = window.innerWidth, vh = window.innerHeight;
  let x = clientX + 16, y = clientY - h - 14;
  if (x + w > vw - 8) x = Math.max(8, clientX - w - 16);
  if (y < 8) y = Math.max(8, Math.min(vh - h - 8, clientY + 18));
  tip.style.left = (x / k).toFixed(1) + 'px';
  tip.style.top = (y / k).toFixed(1) + 'px';
}

/* A run is drawn twice, as a bar and as a row, under one data-run id. Hovering either
   lights both; a tap (a phone has no hover) pins them, and tapping a bar brings its row
   into view. One set of listeners on the host, which renderBody keeps across redraws. */
function mounted(host) {
  if (!host) return;
  inkTeams(host);
  host.__gfModel = model;
  hideProbe(host);
  wireGuides(host);
  wireFolds(host);
  if (host.__gfBound) return;
  host.__gfBound = true;
  host.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.gf-fold');
    if (!b || !host.contains(b)) return;
    const shut = b.getAttribute('aria-expanded') !== 'false';
    setFold(host, b, shut);
    keepFold(b.dataset.fold, shut);
    hideProbe(host);
  });
  const runOf = e => { const m = e.target && e.target.closest && e.target.closest('[data-run]'); return m && host.contains(m) ? m : null; };
  const mark = (id, cls, on) => host.querySelectorAll('[data-run="' + id + '"]').forEach(x => x.classList.toggle(cls, on));
  host.addEventListener('pointerover', e => { const m = runOf(e); if (m) mark(m.dataset.run, 'hi', true); });
  host.addEventListener('pointerout', e => {
    const m = runOf(e);
    if (m && !(e.relatedTarget && m.contains(e.relatedTarget))) mark(m.dataset.run, 'hi', false);
  });
  const plotOf = e => { const p = e.target && e.target.closest && e.target.closest('.gf-plot'); return p && host.contains(p) ? p : null; };
  host.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;                 // a finger scrolls; it taps instead
    const p = plotOf(e);
    if (p) probe(host, p, e.clientX, e.clientY); else hideProbe(host);
  });
  host.addEventListener('pointerleave', () => hideProbe(host));
  host.addEventListener('click', e => {
    const p = plotOf(e);
    if (p) probe(host, p, e.clientX, e.clientY);
    else if (!(e.target.closest && e.target.closest('.gf-mvb, .gf-fold'))) hideProbe(host);
  });
  if (!hasHoverBound) {
    hasHoverBound = true;
    /* the card is fixed to the window, so anything that moves the page moves the moment away from under it */
    document.addEventListener('scroll', () => { if (tipEl) tipEl.hidden = true; }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && tipEl) tipEl.hidden = true; });
  }
  /* MOVE A CHART: one place up or down in the stack, the card itself moved (nothing is redrawn), the order kept.
     A button that has just been used keeps the focus, and the card stays in view. */
  host.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.gf-mvb');
    if (!b || !host.contains(b) || b.disabled) return;
    const card = b.closest('.gf-chart'), stack = card && card.parentNode;
    if (!stack) return;
    const cards = () => Array.prototype.slice.call(stack.children).filter(c => c.classList && c.classList.contains('gf-chart'));
    const at = cards().indexOf(card);
    if (b.dataset.mv === 'up' && at > 0) stack.insertBefore(card, cards()[at - 1]);
    else if (b.dataset.mv === 'down' && at < cards().length - 1) stack.insertBefore(cards()[at + 1], card);
    else return;
    const now = cards();
    keepOrder(now.map(c => c.dataset.chart));
    now.forEach((c, i) => {
      const up = c.querySelector('[data-mv="up"]'), down = c.querySelector('[data-mv="down"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === now.length - 1;
    });
    (b.disabled ? (card.querySelector('.gf-mvb:not(:disabled)') || b) : b).focus();
    if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  /* the rotations and the charts scroll sideways together (a phone gives them a width of their own),
     so a moment stays over the same minute whichever card is being looked at */
  const scrollers = () => host.querySelectorAll('.gf-rot .rot, .gf-scroll');
  host.addEventListener('scroll', e => {
    const t = e.target;
    if (host.__gfSyncing || !t || !t.matches || !t.matches('.gf-rot .rot, .gf-scroll')) return;
    host.__gfSyncing = true;
    scrollers().forEach(x => { if (x !== t) x.scrollLeft = t.scrollLeft; });
    const done = () => { host.__gfSyncing = false; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done)); else done();
  }, true);
  host.addEventListener('click', e => {
    const w = e.target && e.target.closest && e.target.closest('.gf-watch');
    if (w && host.contains(w)) {
      /* the page owns the tabs (game.js), so this only says which run; it switches */
      if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent('epinoia:watchrun', { detail: { key: w.dataset.watch } }));
      }
      return;
    }
    const m = runOf(e);
    const was = m && m.classList.contains('pin');
    host.querySelectorAll('[data-run].pin').forEach(x => x.classList.remove('pin'));
    if (!m || was) return;
    mark(m.dataset.run, 'pin', true);
    if (m.classList.contains('gf-bar')) {
      const row = m.closest('.gf-card') && m.closest('.gf-card').querySelector('.gf-runrow[data-run="' + m.dataset.run + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

return { compute, summarise, render, margin: marginOnly, mounted, formatDuration, symAxis, inkTeams, clockText, hasFootage, timeline, normaliseOrder, keepOrder, orderNow, stateAt };
}));
