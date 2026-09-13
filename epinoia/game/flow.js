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

   Everything is rebuilt from window.S whenever the log changes (game.js's body
   key), so a live game's charts move with it. The interaction — tooltips that
   open on hover, focus or a tap — is one delegated listener bound once by
   mounted().
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

  const points = [];
  const playerRuns = [];
  const teamRuns = [];
  let run = { team: null, pts: 0, players: {}, order: [] };

  const finalize = () => {
    if (run.team === null || run.pts < 6) return;
    const duration = run.endElapsed - run.startElapsed;
    run.order.forEach(pid => {
      const pts = run.players[pid];
      if (pts >= 6) {
        playerRuns.push({
          pid, playerName: shortName(pid), team: teams[run.team].name || '', teamIdx: run.team, points: pts,
          startElapsed: run.startElapsed, endElapsed: run.endElapsed,
          seconds: duration, duration: formatDuration(duration),
          startScore: run.startHome + '-' + run.startAway, endScore: run.endHome + '-' + run.endAway
        });
      }
    });
    let top = null, topPts = 0;
    run.order.forEach(pid => { if (run.players[pid] > topPts) { topPts = run.players[pid]; top = pid; } });
    teamRuns.push({
      team: teams[run.team].name || '', teamIdx: run.team, points: run.pts,
      lineup: run.lineup, lineupNames: run.lineup.map(fullName),
      startElapsed: run.startElapsed, endElapsed: run.endElapsed,
      seconds: duration, duration: formatDuration(duration),
      scoreDiff: run.team === 0 ? run.pts + '-0' : '0-' + run.pts,
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
      } else {
        finalize();
        run = {
          team: t, pts, players: { [ev.pid]: pts }, order: [ev.pid],
          startElapsed: elapsed,
          startHome: R[0].points - (t === 0 ? pts : 0), startAway: R[1].points - (t === 1 ? pts : 0),
          lineup: [...onCourt[t]]
        };
      }
      run.endElapsed = elapsed;
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

  return { points, playerRuns, teamRuns, summary: summarise(points), period, lastElapsed };
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
const W = 800, H = 240, PAD = { top: 20, right: 60, bottom: 40, left: 50 };
const CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom;
const f1 = n => n.toFixed(1);

function periodLines(maxPeriod, maxElapsed) {
  let out = '';
  for (let p = 1; p <= maxPeriod; p++) {
    const end = periodEnd(p);
    if (end < maxElapsed) {
      const x = PAD.left + (end / maxElapsed) * CW;
      out += '<line x1="' + f1(x) + '" y1="' + PAD.top + '" x2="' + f1(x) + '" y2="' + (H - PAD.bottom) + '" class="gf-period-line"/>' +
             '<text x="' + f1(x) + '" y="' + (H - 8) + '" class="gf-period-label" text-anchor="middle">' + (p <= 4 ? 'P' + p : 'OT' + (p - 4)) + '</text>';
    }
  }
  return out;
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
  '<div class="gf-legend">' +
    '<span class="gf-legend-item"><span class="gf-legend-line home"></span><span class="gf-home">' + a + '</span></span>' +
    '<span class="gf-legend-item"><span class="gf-legend-line away"></span><span class="gf-away">' + b + '</span></span>' +
  '</div>';

const card = (title, legendHTML, note, svg) =>
  '<section class="gf-card">' +
    '<div class="gf-card-head"><h3 class="gf-title">' + title + '</h3>' + legendHTML + '</div>' +
    (note ? '<div class="gf-note">' + note + '</div>' : '') +
    '<div class="gf-scroll"><svg class="gf-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(title) + '">' + svg + '</svg></div>' +
  '</section>';

const yTitle = label => '<text x="12" y="' + (H / 2) + '" class="gf-axis-label" text-anchor="middle" transform="rotate(-90, 12, ' + (H / 2) + ')">' + label + '</text>';
const signed = (v, dp) => (v >= 0 ? '+' : '') + (dp == null ? v : v.toFixed(dp));

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

/* renderRunsMomentumChart: two tracks, home runs up from the centre line, away runs down */
function runsCharts(F, names) {
  const data = F.points;
  if (data.length < 2) return '';
  const maxElapsed = Math.max(...data.map(d => d.elapsed)) || 1;
  const maxPeriod = Math.max(...data.map(d => d.period));
  let axis = '';
  for (let p = 1; p <= maxPeriod; p++) {
    const pct = Math.min(periodEnd(p) / maxElapsed * 100, 100);
    axis += '<span class="gf-tl-label" style="left:' + pct.toFixed(2) + '%">' + (p <= 4 ? 'Q' + p : 'OT' + (p - 4)) + '</span>';
  }
  const centre = r => ((r.startElapsed + r.endElapsed) / 2 / maxElapsed * 100).toFixed(2);
  const widthFor = (r, min, max) => Math.min(max, Math.max(min, min + (r.seconds / 180) * (max - min)));

  const playerMarkers = F.playerRuns.length
    ? F.playerRuns.map(r => {
        const h = Math.min(90, 50 + (r.points - 6) * 8);
        const tip = r.playerName + ': ' + r.points + ' pts in ' + r.duration + '\n' + r.startScore + ' → ' + r.endScore;
        return '<div class="gf-run ' + (r.teamIdx === 0 ? 'home' : 'away') + '" tabindex="0" role="button" aria-label="' + esc(tip) + '"' +
          ' data-tip="' + esc(tip) + '" style="left:' + centre(r) + '%;height:' + h + 'px;width:' + widthFor(r, 55, 140).toFixed(0) + 'px">' +
          '<span class="gf-run-player">' + esc(r.playerName) + '</span>' +
          '<span class="gf-run-stats">' + r.points + ' pts</span>' +
          '<span class="gf-run-duration">⏱ ' + r.duration + '</span></div>';
      }).join('')
    : '<div class="gf-none">No individual player runs (6+ pts) detected</div>';

  const teamMarkers = F.teamRuns.length
    ? F.teamRuns.map(r => {
        const h = Math.min(90, 55 + (r.points - 6) * 6);
        const tip = r.team + ': ' + r.scoreDiff + ' in ' + r.duration + '\n\nLineup:\n' + r.lineupNames.join(', ') +
                    '\n\nTop: ' + r.topScorer + ' (' + r.topScorerPoints + ' pts)';
        return '<div class="gf-mom ' + (r.teamIdx === 0 ? 'home' : 'away') + '" tabindex="0" role="button" aria-label="' + esc(tip) + '"' +
          ' data-tip="' + esc(tip) + '" style="left:' + centre(r) + '%;height:' + h + 'px;width:' + widthFor(r, 65, 150).toFixed(0) + 'px">' +
          '<span class="gf-mom-score">' + r.scoreDiff + '</span>' +
          '<span class="gf-mom-time">' + r.duration + '</span>' +
          '<span class="gf-mom-top">' + esc(r.topScorer) + ' ' + r.topScorerPoints + 'pts</span></div>';
      }).join('')
    : '<div class="gf-none">No team momentum runs (6+ pts) detected</div>';

  const count = (list, t) => list.filter(r => r.teamIdx === t).length;
  const track = (markers) =>
    '<div class="gf-scroll"><div class="gf-runs-inner">' +
      '<div class="gf-track">' +
        '<span class="gf-track-label top">' + esc(firstWord(names[0])) + '</span>' +
        '<span class="gf-track-label bottom">' + esc(firstWord(names[1])) + '</span>' +
        '<div class="gf-track-centre"></div>' + markers +
      '</div>' +
      '<div class="gf-tl">' + axis + '</div>' +
    '</div></div>';

  return '<section class="gf-card">' +
      '<div class="gf-card-head"><h3 class="gf-title">Player Scoring Runs (6+ consecutive pts)</h3>' +
        legend(esc(names[0]) + ' (' + count(F.playerRuns, 0) + ')', esc(names[1]) + ' (' + count(F.playerRuns, 1) + ')') + '</div>' +
      track(playerMarkers) +
    '</section>' +
    '<section class="gf-card">' +
      '<div class="gf-card-head"><h3 class="gf-title">Team Momentum Runs (6+ consecutive pts by lineup)</h3>' +
        legend(esc(names[0]) + ' (' + count(F.teamRuns, 0) + ')', esc(names[1]) + ' (' + count(F.teamRuns, 1) + ')') + '</div>' +
      track(teamMarkers) +
    '</section>';
}

/* renderScoreMarginChart */
function marginChart(F, names) {
  const data = F.points;
  if (data.length < 2) return '';
  const maxElapsed = Math.max(...data.map(d => d.elapsed)) || 1;
  const maxPeriod = Math.max(...data.map(d => d.period));
  const maxMargin = Math.max(...data.map(d => Math.abs(d.margin)));
  const ax = symAxis(Math.max(30, Math.ceil(maxMargin / 5) * 5 + 5), 10);
  const yMax = ax.yMax;
  const zeroY = PAD.top + CH / 2;
  const pts = data.map(d => ({ x: PAD.left + (d.elapsed / maxElapsed) * CW, y: zeroY - (d.margin / yMax) * (CH / 2), margin: d.margin }));
  let grid = '';
  for (let v = -yMax; v <= yMax; v += ax.step) {
    const y = zeroY - (v / yMax) * (CH / 2);
    grid += '<text x="' + (PAD.left - 8) + '" y="' + f1(y + 4) + '" class="gf-axis-label" text-anchor="end">' + (v > 0 ? '+' : '') + v + '</text>' +
            '<line x1="' + PAD.left + '" y1="' + f1(y) + '" x2="' + (W - PAD.right) + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  return card('Scoring Development (Score Margin)', legend(esc(names[0]) + ' Lead', esc(names[1]) + ' Lead'), '',
    grid +
    '<line x1="' + PAD.left + '" y1="' + zeroY + '" x2="' + (W - PAD.right) + '" y2="' + zeroY + '" class="gf-zero-line"/>' +
    periodLines(maxPeriod, maxElapsed) + fillAreas(pts, 'margin', zeroY) + segmentedLines(pts, 'margin') + yTitle('Score Margin'));
}

/* the EPA and Scoring Battle charts share one shape: a signed value about zero, an end label */
function signedChart(opts) {
  const { data, all, key, title, names, note, axisTitle } = opts;
  const maxElapsed = Math.max(...all.map(d => d.elapsed)) || 1;
  const maxPeriod = Math.max(...all.map(d => d.period));
  const maxAbs = Math.max(...data.map(d => Math.abs(d[key] || 0)));
  const raw = Math.max(5, Math.ceil(maxAbs) + 2);
  const ax = symAxis(raw, raw > 15 ? 5 : (raw > 8 ? 4 : 2));
  const yMax = ax.yMax, step = ax.step;
  const zeroY = PAD.top + CH / 2;
  const pts = data.map(d => {
    const v = d[key] || 0;
    return { x: PAD.left + (d.elapsed / maxElapsed) * CW, y: zeroY - (v / yMax) * (CH / 2), [key]: v };
  });
  let grid = '';
  for (let v = -yMax; v <= yMax; v += step) {
    const y = zeroY - (v / yMax) * (CH / 2);
    grid += '<text x="' + (PAD.left - 8) + '" y="' + f1(y + 4) + '" class="gf-axis-label" text-anchor="end">' + (v > 0 ? '+' : '') + v.toFixed(0) + '</text>' +
            '<line x1="' + PAD.left + '" y1="' + f1(y) + '" x2="' + (W - PAD.right) + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  const end = pts[pts.length - 1], fin = end[key];
  return card(title, legend(esc(names[0]) + ' Advantage', esc(names[1]) + ' Advantage'), note,
    grid +
    '<line x1="' + PAD.left + '" y1="' + zeroY + '" x2="' + (W - PAD.right) + '" y2="' + zeroY + '" class="gf-zero-line"/>' +
    periodLines(maxPeriod, maxElapsed) + fillAreas(pts, key, zeroY) + segmentedLines(pts, key) + yTitle(axisTitle) +
    '<text x="' + f1(end.x + 8) + '" y="' + f1(end.y + 4) + '" class="gf-end-label ' + (fin >= 0 ? 'home' : 'away') + '">' + signed(fin, 1) + '</text>');
}

function epaChart(F, names) {
  const data = F.points;
  if (data.length < 2) return '';
  const last = data[data.length - 1];
  const note = 'EPA = (TO Margin + OREB Margin) × 1.05 PPP | ' +
    '<span class="' + sideCls(last.toMargin) + '">TO: ' + signed(last.toMargin) + '</span> | ' +
    '<span class="' + sideCls(last.orebMargin) + '">OREB: ' + signed(last.orebMargin) + '</span>';
  return signedChart({ data, all: data, key: 'epa', title: 'Expected Points Added (EPA)', names, note, axisTitle: 'EPA (pts)' });
}

function battleChart(F, names) {
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
  return signedChart({ data, all, key: 'scoringBattle', title: 'Scoring Battle (eFG% + FT Rate)', names, note, axisTitle: 'SB (pts)' });
}

/* renderPPPDevelopmentChart */
function pppChart(F, names) {
  const all = F.points;
  const data = all.filter(d => d.homePPP > 0 || d.awayPPP > 0);
  if (data.length < 2) return '';
  const maxPPP = Math.max(...all.map(d => Math.max(d.homePPP, d.awayPPP)));
  const minPPP = Math.min(...data.map(d => Math.min(d.homePPP || 99, d.awayPPP || 99)));
  const maxElapsed = Math.max(...data.map(d => d.elapsed)) || 1;
  const maxPeriod = Math.max(...data.map(d => d.period));
  const yMin = Math.max(0, Math.floor((minPPP - 0.1) * 10) / 10);
  const yMax = Math.min(2.0, Math.ceil((maxPPP + 0.1) * 10) / 10);
  const yRange = (yMax - yMin) || 1;
  const toXY = v => PAD.top + CH - ((v - yMin) / yRange) * CH;
  const line = k => data.filter(d => d[k] > 0).map(d => ({ x: PAD.left + (d.elapsed / maxElapsed) * CW, y: toXY(d[k]), ppp: d[k] }));
  const hp = line('homePPP'), ap = line('awayPPP');
  const pathOf = ps => ps.map((p, i) => (i ? 'L ' : 'M ') + f1(p.x) + ' ' + f1(p.y)).join(' ');
  const step = yRange > 0.6 ? 0.2 : 0.1;
  let grid = '';
  for (let i = 0, v = yMin; v <= yMax + 1e-9; i++, v = yMin + i * step) {
    const y = toXY(v);
    grid += '<text x="' + (PAD.left - 8) + '" y="' + f1(y + 4) + '" class="gf-axis-label" text-anchor="end">' + v.toFixed(2) + '</text>' +
            '<line x1="' + PAD.left + '" y1="' + f1(y) + '" x2="' + (W - PAD.right) + '" y2="' + f1(y) + '" class="gf-axis-line"/>';
  }
  const avgY = toXY(1.0);
  const ref = (avgY >= PAD.top && avgY <= H - PAD.bottom)
    ? '<line x1="' + PAD.left + '" y1="' + f1(avgY) + '" x2="' + (W - PAD.right) + '" y2="' + f1(avgY) + '" class="gf-ref-line"/>' +
      /* GAMEVIS put this label at the right-hand end, exactly where a side finishing near
         1.00 prints its own PPP; inside the left edge it collides with nothing */
      '<text x="' + (PAD.left + 6) + '" y="' + f1(avgY - 5) + '" class="gf-axis-label" text-anchor="start">1.00</text>'
    : '';
  const endMark = (ps, side) => ps.length
    ? '<circle cx="' + f1(ps[ps.length - 1].x) + '" cy="' + f1(ps[ps.length - 1].y) + '" r="4" class="gf-dot ' + side + '"/>' +
      '<text x="' + f1(ps[ps.length - 1].x + 8) + '" y="' + f1(ps[ps.length - 1].y + 4) + '" class="gf-end-label ' + side + '">' + ps[ps.length - 1].ppp.toFixed(3) + '</text>'
    : '';
  return card('Points Per Possession Development', legend(esc(names[0]), esc(names[1])), '',
    grid + ref + periodLines(maxPeriod, maxElapsed) +
    '<path d="' + pathOf(hp) + '" class="gf-line home"/><path d="' + pathOf(ap) + '" class="gf-line away"/>' +
    yTitle('PPP') + endMark(hp, 'home') + endMark(ap, 'away'));
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
  return '<div class="gf">' +
    runsCharts(F, names) + marginChart(F, names) + epaChart(F, names) + battleChart(F, names) + pppChart(F, names) +
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

/* A run marker's tooltip opens on hover and on keyboard focus through CSS; a tap has
   neither, so a tap toggles it. One listener on the host, which renderBody keeps. The
   text drawn ON a solid marker is chosen against the club's colour, as the tabs do. */
function mounted(host) {
  if (!host) return;
  inkTeams(host);
  if (host.__gfBound) return;
  host.__gfBound = true;
  host.addEventListener('click', e => {
    const m = e.target.closest && e.target.closest('.gf-run, .gf-mom');
    host.querySelectorAll('.gf-run.open, .gf-mom.open').forEach(x => { if (x !== m) x.classList.remove('open'); });
    if (m && host.contains(m)) m.classList.toggle('open');
  });
}

return { compute, summarise, render, mounted, formatDuration, symAxis, inkTeams };
}));
