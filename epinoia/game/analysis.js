'use strict';
/* ============================================================================
   THE GAME ANALYSIS (2026-10-02): a final game as A4 pages, downloaded as one PDF like the club and player reports
   (report.js), from the side of one of the two clubs. Under the scoresheet button ("Game analysis · PDF"); for members
   (access.js club_report, the club report's own tier).

     COVER         the matchup over both crests, the score by quarter and both starting fives
     MAIN STATS    the club report's (report-teampages.js) as a head-to-head (c.vs): THIS GAME's figures for both clubs,
                   each ranked and coloured against the competition's clubs over the season: the four factors, the
                   season line, both clubs' starters and bench, the shot distribution, the rebounds
     SHOT CHART    the club report's, both clubs on every page: the zones, the half court, transition, the events
     FULL STATS    the game page's Full stats tab, three pages of two column groups, both teams on each
     GAME FLOW     the Game Flow tab (game/flow.js), every chart of it
     LEGEND

   ?analysis=0 (home) or 1 (away) opens it on load: the mailer's way in (scripts/report_mailer.mjs).
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const qp = new URLSearchParams(location.search);
  if (qp.get('mgr') === '1') return;   // a Manager game (game.js ?mgr=1) has no PDFs
  const ver = (() => { const s = [...document.scripts].find(x => /game\/analysis\.js/.test(x.src) || /\/analysis\.js/.test(x.src)); const m = s && /v=(\d+)/.exec(s.src); return m ? m[1] : ''; })();
  const NEED = [['EpinoiaLineupsCore', '../lineups.js'], ['EpinoiaMemLock', '../memlock.js'], ['EpinoiaStatInfo', '../statinfo.js'], ['EpinoiaLineupEvents', '../lineupevents.js'],
    ['EpinoiaSeasonLine', '../t/seasonline.js'], ['EpinoiaRaster', '../raster.js'], ['EpinoiaTeamViz', '../teamviz.js'],
    ['EpinoiaA4', '../report.js'], ['EpinoiaReportTeam', '../report-teampages.js']];
  const CSS = ['../kit/report.css', '../kit/teamviz.css', '../kit/sitpanel.css', '../kit/shotchart.css', '../kit/table.css'];
  const add = (tag, attrs) => new Promise((res, rej) => { const n = document.createElement(tag); Object.assign(n, attrs); n.onload = res; n.onerror = rej; document.head.appendChild(n); });
  let loaded = null;
  function load() {
    if (loaded) return loaded;
    const q = ver ? '?v=' + ver : '';
    CSS.forEach(h => { if (![...document.styleSheets].some(x => x.href && x.href.indexOf(h.slice(2)) >= 0)) add('link', { rel: 'stylesheet', href: h + q }).catch(() => {}); });
    /* the page's own EpinoiaReport (the match report) is put back once the A4 engine has taken the name too */
    loaded = (async () => { const match = window.EpinoiaReport, tab = window.EpinoiaLineups; for (const [g, src] of NEED) if (!window[g]) await add('script', { src: src + q }); if (match) window.EpinoiaReport = match; if (tab) window.EpinoiaLineups = tab; })();
    loaded.catch(() => { loaded = null; });
    return loaded;
  }

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* a club's colour (the game page's, clash-resolved) and the ink that reads on it */
  const tc = t => { const v = ((window.S.teams || [])[t] || {}).color; return /^#[0-9a-f]{6}$/i.test(v || '') ? v : t ? '#5b8def' : '#08603f'; };
  const onInk = hex => { const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, bl = n & 255; return (0.299 * r + 0.587 * g + 0.114 * bl) > 165 ? '#0d1f17' : '#ffffff'; };

  /* ---------------------------------------------------------------- the data, scoped to the game --- */
  const SHARED = {};
  function context(side) {
    const S = window.S, M = S.meta || {}, D = window.EpinoiaData, SC = window.EpinoiaShotChart;
    const gid = qp.get('g');
    const teamId = side ? M.awayTeamId : M.homeTeamId;
    const game = { id: gid, home_team_id: M.homeTeamId, away_team_id: M.awayTeamId, starters: S.starters, period: S.period, tipoff_at: M.tipoff_at,
      competition_id: M.competitionId };
    const SH = SHARED[gid] = SHARED[gid] || {};
    let seasonP = null;
    const events = () => SH.ev || (SH.ev = D.events([gid]));
    const base = () => SH.base || (SH.base = (async () => {
      const comps = [M.competitionId];
      const [all, one] = await Promise.all([D.season(comps, { rows: false, trim: true }), D.season(comps, { rows: false, trim: true, gameIds: [gid] })]);
      SH.Ss = all;
      /* this game's line for both clubs and their players, the rest of the competition's season around it */
      const gT = new Map(one.teams.map(r => [r.id, r])), gP = new Map(one.players.map(r => [r.id, r]));
      const teams = all.teams.map(r => gT.get(r.id) || r).concat(one.teams.filter(r => !all.teams.some(x => x.id === r.id)));
      const players = all.players.map(r => gP.get(r.id) || r).concat(one.players.filter(r => !all.players.some(x => x.id === r.id)));
      return { S: Object.assign({}, all, { teams, players, games: one.games, gameOnly: one }), comps };
    })());
    const season = () => seasonP || (seasonP = base().then(B => ({ S: B.S, mine: B.S.teams.find(r => r.id === teamId) || null, scopeComps: B.comps, kind: 'all' })));
    const logs = async () => { const evs = await events(); return { gs: [game], byG: { [gid]: evs }, sideOf: { [gid]: side } }; };
    /* a side's lineup records over the game (lineupevents.js), each against the other club */
    const recsOf = async t => {
      const LE = window.EpinoiaLineupEvents;
      const evs = await events();
      const G = SH.seg || (SH.seg = LE ? LE.gameSegments({ id: gid, starters: S.starters, events: evs, period: S.period }) : null);
      if (!G || !G.ok) return { why: 'no lineups for this game' };
      const recs = LE.recordsOf(G, t); recs.forEach(r => { r.oteam = t ? M.homeTeamId : M.awayTeamId; });
      return { recs, games: 1 };
    };
    return {
      season,
      logs,
      clubLogs: () => recsOf(side),
      /* the other club's, for its own starters and bench beside this one's */
      otherLogs: () => recsOf(1 - side),
      /* either club's, for its lineups */
      sideRecs: t => recsOf(t),
      /* each club's average time of possession, this one's first (shotclock.js, the box score's own figure) */
      atop: async () => { const A = window.EpinoiaShotClock && window.EpinoiaShotClock.averages ? window.EpinoiaShotClock.averages(S) : null; return A ? [A[side], A[1 - side]] : null; },
      starters: async () => [game],
      /* the cover's five: the game's starters */
      depth: async () => {
        const ids = (S.starters && S.starters[side]) || [];
        const pl = ((S.teams[side] || {}).players) || [];
        const nm = id => (pl.find(p => p.id === id) || {}).name || '';
        return ids.length ? { c: { slots: ids.slice(0, 5).map(id => ({ players: [{ id, name: nm(id) }] })), games: 1 } } : null;
      },
      /* both ends' zones: the competition's clubs over the season, the two clubs over this game */
      zones: async T => {
        if (!SC || !SC.attachZoneStats) return;
        try { if (SH.Ss) await SC.attachZoneStats(SH.Ss, D); } catch (_) { /* the game alone */ }
        const two = T.teams.filter(r => r.id === M.homeTeamId || r.id === M.awayTeamId);
        try { await SC.attachZoneStats({ games: T.games, teams: two }, D); } catch (_) { /* without */ }
      },
      rebounds: async () => '',
      meta: ids => D.playerMeta(ids),
      stints: () => Promise.resolve([]),
      rapm: null,
      bigGames: D.BIG_GAMES || 0,
      week: null
    };
  }

  /* ---------------------------------------------------------------- both teams' full stats --- */
  /* THE GAME PAGE'S OWN FULL STATS (boxscore.js advHTML): the same players, columns, figures, bars and percentile
     shading, taken from the data the tab draws (game/cards.js players() is handed it) and printed as a table of the
     report's own: two of the tab's column groups to a page, both teams on every page, each group under a band of its
     own colour, every rated figure shaded by its percentile (green good to red poor, blue a style), a bar under each
     figure for its size beside the game's other players, and what each column means in plain words */
  /* the printed labels: the standard abbreviations, broken where a column is too narrow for one line */
  const COL = {
    fgm: ['FGM'], ast: ['AST'], pts: ['PTS'], ptsAst: ['AST', 'PTS'], tpc: ['PTS', 'CREATED'], ppp: ['PTS /', 'POSS'], ts: ['TS%'],
    usg: ['USG%'], au: ['AST /', 'USG'], min: ['MIN'],
    rimA: ['RIM', 'FGA'], rimP: ['RIM', 'FG%'], midA: ['MID', 'FGA'], midP: ['MID', 'FG%'], p3a: ['3PA'], p3P: ['3P%'], efg: ['eFG%'],
    astPct: ['AST%'], tovP: ['TOV%'], stlP: ['STL%'], blkP: ['BLK%'], ftr: ['FT', 'RATE'], orebP: ['OREB%'], drebP: ['DREB%'],
    ocOrtg: ['ORTG'], ocEfg: ['eFG%'], ocOreb: ['OREB%'], ocTov: ['TOV%'], ocFtr: ['FT', 'RATE'], pacePM: ['PACE', '±'],
    ocDrtg: ['DRTG'], ocOppEfg: ['OPP', 'eFG%'], ocOppOreb: ['OPP', 'OREB%'], ocTovF: ['TOV', 'FORCED'], ocOppFtr: ['OPP FT', 'RATE'], net: ['NET', 'RTG']
  };
  const GRP = { scoring: 'Scoring', usage: 'Usage', shotdist: 'Shot selection', individual: 'Individual rates',
    offcourt: 'Team offence · player on court', defcourt: 'Team defence · player on court' };
  /* the tab's data for both teams: cards.js players() is handed it once a team; it is borrowed for the one call */
  function tabData() {
    const B = window.EpinoiaBox, K = window.EpinoiaCards;
    if (!B || !B.advHTML || !K || !K.players || !window.derive) return null;
    const got = [null, null], orig = K.players;
    K.players = c => { got[c.t] = c; return ''; };
    try { B.advHTML(window.derive()); } catch (_) { /* below */ } finally { K.players = orig; }
    return got[0] && got[1] ? got : null;
  }
  /* a percentile (gamepct.js: g its goodness, d its direction) in the report's four bands, 9 a style */
  const bandOf = R => (!R ? 0 : !R.d ? 9 : R.g >= 75 ? 4 : R.g >= 50 ? 3 : R.g >= 25 ? 2 : 1);
  const signed = (v, dp) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp || 0);
  function fsTable(c, keep, t) {
    const groups = c.groups.filter(g => keep.indexOf(g.key) >= 0);
    const TT = c.TT, OT = c.OT, avg = c.gameAvg || {};
    const barW = (v, k) => { const r = c.ranges && c.ranges[k]; if (!r || r.max === r.min) return 0; return Math.max(0, Math.min(100, (v - r.min) / (r.max - r.min) * 100)); };
    const fig = (col, v, r, R, tot) => {
      let txt, bar = '', cls = '';
      if (!isFinite(v)) return '<td class="fs-v"><b>–</b></td>';
      if (col.pill) { txt = signed(v, col.dec != null ? col.dec : 0); cls = v > 0 ? ' pos' : v < 0 ? ' neg' : ''; }
      else if (col.diff) {
        const dff = v - (avg[col.diff] || 0), eff = col.inv ? -dff : dff, w = Math.max(0, Math.min(50, Math.abs(eff) / 15 * 50));
        txt = (dff > 0 ? '+' : dff < 0 ? '−' : '') + Math.abs(dff).toFixed(0);
        cls = Math.abs(dff) < 0.5 ? '' : eff > 0 ? ' pos' : ' neg';
        if (!tot) bar = '<span class="fs-d"><i class="' + (eff >= 0 ? 'p' : 'n') + '" style="' + (eff >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(0) + '%"></i></span>';
      } else if (col.shot) { txt = String(v); if (!tot) bar = '<span class="fs-b"><i style="width:' + Math.max(3, Math.min(100, v / 10 * 100)).toFixed(0) + '%"></i></span>'; }
      else {
        txt = col.f(v, r);
        if (col.bar && !tot) { let w = barW(v, col.k); if (col.invbar) w = 100 - w; bar = '<span class="fs-b"><i style="width:' + Math.max(3, w).toFixed(0) + '%"></i></span>'; }
      }
      const b = tot ? 0 : bandOf(R);
      return '<td class="fs-v' + cls + '"' + (b ? ' data-b="' + b + '"' : '') + '><b>' + esc(txt) + '</b>' + bar + '</td>';
    };
    const head = '<colgroup><col class="fs-cn">' + groups.map(g => g.cols.map(() => '<col>').join('')).join('') + '</colgroup>' +
      '<thead><tr class="fs-gr"><th class="fs-n" rowspan="2">Player</th>' + groups.map(g => '<th class="fs-g g-' + g.key + '" colspan="' + g.cols.length + '">' + esc(GRP[g.key] || g.label) + '</th>').join('') + '</tr>' +
      '<tr class="fs-lr">' + groups.map(g => g.cols.map((col, i) => '<th class="g-' + g.key + (i === 0 ? ' fs-first' : '') + '">' + (COL[col.k] || [col.l.toUpperCase()]).map(esc).join('<br>') + '</th>').join('')).join('') + '</tr></thead>';
    const pl = c.S.teams[t].players || [];
    const rows = c.rows.map(r => {
      const p = pl.find(x => x.id === r.id) || {};
      return '<tr><td class="fs-n"><span class="fs-no">' + esc(r.num != null ? r.num : p.num != null ? p.num : '') + '</span><span class="fs-who"><b>' + esc(r.name || p.name || '') + '</b><em>' + esc(r.minTxt || '') + ' min</em></span></td>' +
        groups.map(g => g.cols.map((col, i) => {
          const R = col.gp ? c.gpRate('player', col.k, { a: r, x: c.d.stats[r.id], TT, OT }) : null;
          return fig(col, r[col.k], r, R).replace('<td class="fs-v', '<td class="fs-v g-' + g.key + (i === 0 ? ' fs-first' : ''));
        }).join('')).join('') + '</tr>';
    }).join('');
    /* the team's own figure in every column (the tab's totals row, and the plain counts too) */
    const T2 = { fgm: TT.fgm, ast: TT.ast, pts: TT.pts, ptsAst: TT.ptsAst, tpc: TT.pts + TT.ptsAst, ppp: TT.ppp, ts: TT.ts,
      rimA: TT.rimA, rimP: TT.rimp, midA: TT.midA, midP: TT.midp, p3a: TT.fg3a, p3P: TT.p3p, efg: TT.efg,
      ocOrtg: TT.ortg, ocEfg: TT.efg, ocOreb: TT.orebp, ocTov: TT.tovp, ocFtr: TT.ftr,
      ocDrtg: TT.drtg, ocOppEfg: OT.efg, ocOppOreb: OT.orebp, ocTovF: OT.tovp, ocOppFtr: OT.ftr, net: TT.ortg - TT.drtg,
      astPct: TT.astp, tovP: TT.tovp, stlP: TT.stlp, blkP: TT.blkp, ftr: TT.ftr, orebP: TT.orebp, drebP: TT.drebp };
    const tot = '<tr class="fs-tot"><td class="fs-n"><span class="fs-who"><b>Team totals</b></span></td>' + groups.map(g => g.cols.map((col, i) => {
      const v = T2[col.k];
      return (v == null ? '<td class="fs-v"><b>–</b></td>' : fig(col, v, T2, null, true)).replace('<td class="fs-v', '<td class="fs-v g-' + g.key + (i === 0 ? ' fs-first' : ''));
    }).join('')).join('') + '</tr>';
    return '<table class="ga-fs">' + head + '<tbody>' + rows + tot + '</tbody></table>';
  }
  const PARTS = [
    ['Scoring and usage', ['scoring', 'usage'], 'points, shooting efficiency and share of the offence',
      [['FGM', 'field goals made'], ['AST', 'assists'], ['PTS', 'points'], ['AST PTS', 'points scored from the player’s assists'],
       ['PTS CREATED', 'own points plus points assisted'], ['PTS / POSS', 'points for each possession the player used'],
       ['TS%', 'true shooting: efficiency counting threes and free throws'], ['USG%', 'share of the team’s possessions the player finished while on court'],
       ['AST / USG', 'assists for each possession used (a passer reads high)'], ['MIN', 'minutes played']]],
    ['Shot selection and individual rates', ['shotdist', 'individual'], 'where each player shot from, and their share of the plays at both ends',
      [['RIM / MID FGA, 3PA', 'shots at the rim, from mid-range and from three'], ['RIM / MID FG%, 3P%', 'the share of them made'],
       ['eFG%', 'field-goal percentage with a three worth one and a half twos'], ['AST%', 'share of team-mates’ baskets assisted while on court'],
       ['TOV%', 'possessions used that ended in a turnover (lower is better)'], ['STL% / BLK%', 'opponent possessions stolen, opponent shots blocked'],
       ['FT RATE', 'free throws attempted per 100 field-goal attempts'], ['OREB% / DREB%', 'share of available rebounds taken at each end']]],
    ['On the floor at both ends', ['offcourt', 'defcourt'], 'the team with each player on court, against its whole game',
      [['ORTG / DRTG', 'points scored / allowed per 100 possessions (lower DRTG is better)'], ['eFG%', 'the team’s shooting'],
       ['OREB%', 'the team’s offensive rebounding'], ['TOV%', 'the team’s turnovers (lower is better)'], ['FT RATE', 'free throws drawn'],
       ['PACE ±', 'faster (+) or slower (−) with the player on court'], ['OPP eFG% / OREB% / FT RATE', 'the opponent’s shooting, rebounding and free throws (lower is better)'],
       ['TOV FORCED', 'opponent turnovers forced'], ['NET RTG', 'points per 100 scored minus allowed with the player on court'],
       ['ALL FIGURES', 'the difference from the team’s whole game: green better, red worse']]]
  ];
  function boxesModule() {
    const E = window.EpinoiaA4;
    return {
      key: 'boxes', title: 'Full stats', page: 'FULL STATS', on: true,
      async build(c, R) {
        const S = window.S, M = S.meta || {};
        const data = tabData();
        if (!data) return [];
        R.legendExtra.push(['FULL STATS', 'The game page’s Full stats tab, player by player, both teams on each page: scoring and usage, shot selection and individual rates, then how each team did on the floor with the player at both ends. Shading is the figure’s percentile (green good, red poor, blue a style); a bar shows its size beside the game’s other players.']);
        const sc = [M.home_score, M.away_score];
        return PARTS.flatMap(([what, keep, note, key], pi) => {
          const team = t => '<div class="ga-team" style="--tc:' + tc(t) + ';--ti:' + onInk(tc(t)) + ';--tk:' + window.EpinoiaA4.inkOn(tc(t)) + '"><div class="ga-th"><b>' + esc(S.teams[t].name || '') + '</b><span>' + esc(sc[t]) + '</span></div>' +
            fsTable(data[t], keep, t) + '</div>';
          const keyHTML = '<dl class="ga-key">' + key.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>';
          return (pi ? [E.block('', 'rp-break')] : []).concat([E.block(E.title('Full stats · ' + what, note) + team(0) + team(1) + keyHTML, 'ga-advb')]);
        });
      }
    };
  }

  /* ---------------------------------------------------------------- the margin, explained --- */
  /* UNDER THE REBOUNDS: each club's true shooting attempts and possessions, then the game page's own breakdown of the
     margin (game/cards.js battle: the points the shooting and free throws earned against the league, the points
     turnovers and offensive rebounds earned, together the estimated margin) beside the real one */
  function battleBlock(side) {
    const E = window.EpinoiaA4, B = window.EpinoiaBox, K = window.EpinoiaCards, S = window.S;
    if (!B || !B.teamAdv || !K || !K.battle || !window.derive) return null;
    const d = window.derive();
    const TA = [B.teamAdv(d, 0), B.teamAdv(d, 1)];
    const Bt = K.battle(S, TA);
    if (![Bt.scoring, Bt.possession, Bt.estimated, Bt.actual].every(isFinite)) return null;
    const M = S.meta || {};
    const short = t => { const cl = t ? M.away : M.home; return (cl && cl.short_name) || (S.teams[t] || {}).name || ''; };
    const order = [side, 1 - side];
    const box = (t, v, sub) => '<div class="ga-bt-s" style="--tc:' + tc(t) + '"><b>' + v + '</b><span>' + esc(short(t)) + '</span>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
    const pair = (h, f, sub) => '<div class="ga-bt-c"><h4>' + h + '</h4><div class="ga-bt-p">' + order.map(t => box(t, f(TA[t]), sub(TA[t]))).join('') + '</div></div>';
    const per = (a, b) => (b ? (a / b).toFixed(2) : '–');
    /* a battle's value read for the club that won it (home minus away underneath) */
    const won = v => (Math.abs(v) < 0.05 ? -1 : v > 0 ? 0 : 1);
    const tile = (label, v, sub, cls) => { const t = won(v), col = t < 0 ? '#5d6b64' : tc(t);
      return '<div class="ga-eq-t' + (cls ? ' ' + cls : '') + '" style="--tc:' + col + ';--tk:' + E.inkOn(col) + '"><small>' + label + '</small><b>' + (t < 0 ? 'level' : '+' + Math.abs(v).toFixed(cls === 'act' ? 0 : 1)) + '</b>' +
        '<span>' + (t < 0 ? '' : esc(short(t))) + '</span>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; };
    const part = (a, b) => [a, b].map(([l, v]) => { const t = won(v); return l + ' ' + (t < 0 ? 'level' : '+' + Math.abs(v).toFixed(1) + ' ' + esc(short(t))); }).join(' · ');
    const html = E.title('The margin, explained', 'shot attempts and possessions, and where the points were won') +
      '<div class="ga-bt-row">' +
        pair('True shooting attempts · TSA', T => (T.tsa || 0).toFixed(0), T => per(T.pts, T.tsa) + ' pts each') +
        pair('Possessions', T => (T.possessions || 0).toFixed(0), T => per(T.pts, T.possessions) + ' pts each') +
      '</div><div class="ga-eq">' +
        tile('Scoring battle', Bt.scoring, part(['eFG', Bt.efg], ['FT', Bt.ftr])) + '<i>+</i>' +
        tile('Possession battle', Bt.possession, part(['TO', Bt.tov], ['OREB', Bt.oreb])) + '<i>=</i>' +
        tile('Estimated margin', Bt.estimated, 'the two battles added', 'est') +
        tile('Actual margin', Bt.actual, (TA[0].pts || 0) + '–' + (TA[1].pts || 0), 'act') +
      '</div>';
    return E.block(html, 'ga-btb');
  }

  /* ---------------------------------------------------------------- the lineups --- */
  /* EACH CLUB'S MOST-USED FIVES OF THE GAME as the club report's lineup cards (teamviz.js lineupCards): the offence, the
     defence and how it played, every number against that club over the whole game; a page a club, in its colour */
  function lineupsModule(CX, side) {
    const E = window.EpinoiaA4;
    return {
      key: 'lineups', title: 'Lineups', page: 'LINEUPS', on: true,
      async build(c, R) {
        const X = window.EpinoiaLineupEvents, V = window.EpinoiaTeamViz, S = window.S;
        if (!X || !V || !V.lineupCards || !CX.sideRecs) return [];
        const out = [];
        for (const t of [side, 1 - side]) {
          const L = await CX.sideRecs(t);
          if (!L || !L.recs || !L.recs.length) continue;
          const base = X.line(X.sum(L.recs));
          let floor = 4;
          const pick = () => X.units(L.recs, 5).map(u => ({ ids: u.ids, line: X.line(u.acc) })).filter(u => u.line.mins >= floor).sort((a, b) => b.line.mins - a.line.mins);
          let units = pick();
          while (units.length < 4 && floor > 1) { floor = floor / 2; units = pick(); }
          units = units.slice(0, 4);
          if (!units.length) continue;
          const names = {}; ((S.teams[t] || {}).players || []).forEach(p => { names[p.id] = p.name; });
          const d = E.frag(V.lineupCards(units, base, { names }));
          const cards = [...d.querySelectorAll('.tv-lu')], keyEl = d.querySelector('.tv-key');
          const ink = E.inkOn(tc(t)), nm = (S.teams[t] || {}).name || '';
          if (out.length) out.push(E.block('', 'rp-break'));
          const keyHTML = keyEl ? keyEl.outerHTML.replace('the club over all its minutes', 'the club over the whole game') : '';
          cards.forEach((cd, i) => out.push(E.block((i === 0 ? E.title(nm + ': most-used lineups', 'the ' + units.length + ' fives with the most minutes · coloured against the club’s whole game') : '') +
            '<div class="tv tv-lus ga-lus" style="--rp-a:' + ink + '">' + cd.outerHTML + '</div>' + (i === cards.length - 1 && keyHTML ? '<div class="tv" style="--rp-a:' + ink + '">' + keyHTML + '</div>' : ''))));
        }
        if (out.length) R.legendExtra.push(['LINEUP CARDS', 'Each five’s offence (points per 100 possessions and the four factors), its defence (the four factors allowed) and how it played (the share of its baskets made off a pass; rim, mid-range and three-point attempts per 100 possessions; three-point %). Each tile is coloured against its club over the whole game: green better, red worse; blue a style. The small figure is the gap to the club.']);
        return out;
      }
    };
  }

  /* ---------------------------------------------------------------- the game flow --- */
  /* THE GAME FLOW TAB (game/flow.js), its cards three pages deep: the game in numbers and its scoring runs; the
     rotations with the margin beneath them on the same clock; then expected points, the scoring battle and points per
     possession. Each card a block at the page's full width, read at the size the tab draws it */
  function flowModule() {
    const E = window.EpinoiaA4;
    return {
      key: 'flow', title: 'Game flow', page: 'GAME FLOW', on: true,
      async build(c, R) {
        const F = window.EpinoiaGameFlow;
        if (!F || !F.render) return [];
        const d = document.createElement('div');
        d.innerHTML = F.render(window.S);
        const root = d.querySelector('.gf');
        if (!root) return [];
        R.legendExtra.push(['GAME FLOW', 'The game in numbers; scoring runs (six points or more in a row); the rotations minute by minute with the margin beneath them; expected points added from turnovers and offensive rebounds; the scoring battle (shooting and free throws); points per possession. All on the game’s clock.']);
        const wrap = (n, stack, tall) => '<div class="ga-flow' + (tall ? ' ga-tall' : '') + '"><div class="gf">' + (stack ? '<div class="gf-stack">' + n.outerHTML + '</div>' : n.outerHTML) + '</div></div>';
        const kids = [...root.children];
        const summary = kids.find(n => n.classList.contains('gf-summary'));
        const runs = kids.filter(n => n.classList.contains('gf-runs') && !n.querySelector('.gf-none'));
        const rot = kids.find(n => n.classList.contains('gf-rot'));
        const charts = [...((kids.find(n => n.classList.contains('gf-stack')) || {}).children || [])];
        const pages = [
          [summary ? wrap(summary) : ''].concat(runs.map(n => wrap(n))),
          [rot ? wrap(rot) : ''].concat(charts.slice(0, 1).map(n => wrap(n, true))),
          charts.slice(1).map(n => wrap(n, true, true))
        ].map(p => p.filter(Boolean)).filter(p => p.length);
        const out = [];
        pages.forEach((p, pi) => {
          if (pi) out.push(E.block('', 'rp-break'));
          p.forEach((h, i) => out.push(E.block((pi === 0 && i === 0 ? E.title('Game flow', 'how the game went, minute by minute, for both teams') : '') + h, 'ga-flowb')));
        });
        return out;
      }
    };
  }

  /* ---------------------------------------------------------------- the panel --- */
  let current = null;
  async function open(side) {
    const S = window.S;
    if (!S || S.status !== 'final') return;
    let wrap = $('#gaWrap');
    if (!wrap) {
      wrap = document.createElement('section');
      wrap.id = 'gaWrap'; wrap.className = 'ga-wrap';
      document.querySelector('#view').appendChild(wrap);
    }
    wrap.innerHTML = '<div class="ga-top"><h2>Game analysis</h2><div class="ga-sides">' + [0, 1].map(t =>
      '<button type="button" class="ep-btn' + (t === side ? ' pri' : '') + '" data-ga="' + t + '">' + esc((S.teams[t] || {}).name || (t ? 'Away' : 'Home')) + '</button>').join('') +
      '</div><button type="button" class="ep-btn ga-x" aria-label="Close">close</button></div><div id="gaTabs" class="ep-tabs" style="display:none"></div><div id="gaPanel"></div>';
    wrap.querySelectorAll('[data-ga]').forEach(b => { b.onclick = () => open(+b.dataset.ga); });
    wrap.querySelector('.ga-x').onclick = () => { wrap.remove(); current = null; document.body.classList.remove('rptab'); };
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await load();
    const E = window.EpinoiaA4, RT = window.EpinoiaReportTeam;
    /* ONE SET OF PAGES, BOTH CLUBS ON EVERY ONE: in a single game what the club report calls "allowed" and "opponents"
       is the other club, so each page is a head-to-head, named for both (c.vs); the side it was opened for (or the
       member's club) reads first. Then both teams' full stats and the game flow. */
    const CX = context(side);
    const RTm = RT.modules(CX);
    /* THE COVER: the matchup over both crests; on paper, the score quarter by quarter and the two starting fives,
       each in its club's colour, beside the report's details */
    const cover = {
      key: 'cover', title: 'Cover', on: true,
      async build(c) {
        const M2 = S.meta || {}, d = window.derive ? window.derive() : null;
        c.name = (S.teams[0].name || 'Home') + ' vs. ' + (S.teams[1].name || 'Away');
        const sc = [M2.home_score, M2.away_score];
        c.facts = [['Result', S.teams[0].name + ' ' + sc[0] + '–' + sc[1] + ' ' + S.teams[1].name], ['Date', M2.tipoff_at ? new Date(M2.tipoff_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''],
          ['Venue', M2.venue || S.venue || ''], ['Competition', [...new Set([M2.leagueName, M2.competitionName].filter(Boolean))].join(' · ')], ['Prepared for', mine.name || '']];
        if (!d) return '';
        const short = t => esc(shortOf(t));
        /* the score by quarter (and each extra period), the winner's total in bold */
        const per = [...new Set([0, 1].flatMap(t => Object.keys(d.perQ[t] || {}).map(Number)))].sort((x, y) => x - y);
        const pl = q => (q <= 4 ? 'Q' + q : 'OT' + (q - 4 > 1 ? q - 4 : ''));
        const win = sc[0] === sc[1] ? -1 : +sc[0] < +sc[1] ? 1 : 0;
        const qs = '<table class="ga-qs"><thead><tr><th class="l"></th>' + per.map(q => '<th>' + pl(q) + '</th>').join('') + '<th class="f">Final</th></tr></thead><tbody>' +
          [0, 1].map(t => '<tr style="--tc:' + tc(t) + '"><td class="l"><i></i>' + short(t) + '</td>' +
            per.map(q => { const a = (d.perQ[t] || {})[q] || 0, o = (d.perQ[1 - t] || {})[q] || 0; return '<td' + (a > o ? ' class="w"' : '') + '>' + a + '</td>'; }).join('') +
            '<td class="f' + (win === t ? ' w' : '') + '">' + esc(sc[t]) + '</td></tr>').join('') + '</tbody></table>';
        /* each club's five who started: minutes, points, rebounds, assists, plus-minus */
        const five = t => {
          const ids = ((S.starters && S.starters[t]) || []).slice(0, 5), all = (S.teams[t] || {}).players || [];
          const rows = ids.map(id => {
            const p = all.find(x => x.id === id) || {}, st = d.stats[id] || {};
            const mins = Math.round((st.min || 0) / 60000), pm = st.pm || 0;
            return '<tr><td class="n">' + esc(p.num != null ? p.num : '') + '</td><td class="l">' + esc(p.name || '') + '</td><td>' + mins + '</td><td class="b">' + (st.pts || 0) + '</td><td>' + ((st.or || 0) + (st.dr || 0)) + '</td><td>' + (st.ast || 0) + '</td>' +
              '<td class="' + (pm > 0 ? 'pos' : pm < 0 ? 'neg' : '') + '">' + (pm > 0 ? '+' : '') + pm + '</td></tr>';
          }).join('');
          const col = tc(t);
          return '<table class="ga-five" style="--tc:' + col + ';--ti:' + onInk(col) + '"><thead><tr class="t"><th colspan="7">' + esc(S.teams[t].name || '') + '</th></tr>' +
            '<tr><th class="n">#</th><th class="l">starter</th><th>min</th><th>pts</th><th>reb</th><th>ast</th><th>+/−</th></tr></thead><tbody>' + rows + '</tbody></table>';
        };
        return '<h4>Score by quarter</h4>' + qs + '<h4 class="ga-h4">The starting fives</h4>' + five(0) + five(1);
      }
    };
    /* the cover's title is the matchup; every other page's labels name the club it reads from (c.name) */
    const keepName = m => m && Object.assign({}, m, { build: (c, R) => m.build(Object.assign({}, c, { name: mine.name }), R) });
    /* main stats, with the margin explained in the room the rebounds leave */
    const withBattle = m => m && Object.assign({}, m, { build: async (c, R) => { const out = await m.build(c, R); const bb = battleBlock(side);
      if (bb) R.legendExtra.push(['THE MARGIN, EXPLAINED', 'True shooting attempts (field-goal attempts plus 0.44 of the free-throw attempts) and possessions for each club, with the points each was worth. The scoring battle is the points shooting (eFG%) and free throws earned against the league’s average, the possession battle the points turnovers and offensive rebounds earned; added, they estimate the margin.']);
      return bb ? out.concat([bb]) : out; } });
    const mods = [cover, keepName(withBattle(RTm.find(m => m.key === 'main'))), keepName(RTm.find(m => m.key === 'shots'))].filter(Boolean)
      .concat([lineupsModule(CX, side), boxesModule(), flowModule(), RTm.find(m => m.key === 'legend')]).filter(Boolean);
    const M = S.meta || {}, mine = S.teams[side] || {}, opp = S.teams[1 - side] || {};
    const shortOf = t => { const cl = t ? M.away : M.home; return (cl && cl.short_name) || (S.teams[t] || {}).name || ''; };
    const sc = [M.home_score, M.away_score];
    const when = M.tipoff_at ? new Date(M.tipoff_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const club = side ? M.away : M.home;
    const crestOf = t => { const cl = t ? M.away : M.home; return { crest: cl && cl.logo_path && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(cl.logo_path, 512) : null,
      monogram: cl && cl.short_name && cl.short_name.length <= 4 ? cl.short_name : null, club: (S.teams[t] || {}).name || '' }; };
    const line = (S.teams[0].name + ' ' + sc[0] + '–' + sc[1] + ' ' + S.teams[1].name);
    current = E.mount({
      tabs: '#gaTabs', panel: '#gaPanel', kind: 'team', label: 'Game analysis', title: 'Game analysis', store: 'epinoia_report_game',
      lock: { key: 'gameReport', what: 'The game analysis', league: S.leagueId || null, leagueSlug: S.leagueSlug || '',
              lines: ['A printable A4 analysis of any game: four factors, shot charts, both box scores and the game flow.'] },
      modules: mods,
      context: () => ({
        /* every page's head: the game itself, home v away, its score, date and venue (Louie, 2026-10-02) */
        vs: { a: mine.name, b: opp.name, as: shortOf(side), bs: shortOf(1 - side), bid: side ? M.homeTeamId : M.awayTeamId, bcol: E.inkOn(tc(1 - side)) },
        accentB: E.inkOn(tc(1 - side)),
        crests: [0, 1].map(crestOf),
        kind: 'team', head: (S.teams[0].name || 'Home') + ' vs. ' + (S.teams[1].name || 'Away'), name: mine.name, club: mine.name, kicker: 'Game analysis',
        crest: club && club.logo_path && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(club.logo_path, 512) : null,
        colour: tc(side), accent: E.inkOn(tc(side)),
        monogram: club && club.short_name && club.short_name.length <= 4 ? club.short_name : null,
        line: [sc[0] + '–' + sc[1], when, M.venue || S.venue, M.leagueName].filter(Boolean).join(' · '),
        scope: line + (when ? ' · ' + when : ''), subtitle: ['Final ' + sc[0] + '–' + sc[1], when, M.venue || S.venue].filter(Boolean).join(' · '),
        file: ('game-analysis-' + (mine.name || 'club') + '-v-' + (opp.name || 'opponent')).replace(/[^\w-]+/g, '-').toLowerCase()
      })
    });
    if (current) current.show(true);
  }
  window.EpinoiaGameAnalysis = { open };

  /* the button, under the scoresheet's, once the head has drawn it */
  const place = () => {
    const sheet = $('#csSheet');
    if (!sheet || $('#csAnalysis')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'csAnalysis'; b.className = 'bt-sheet bt-ga'; b.textContent = 'Game analysis · PDF';
    const AX = window.EpinoiaAccess, S = window.S;
    if (AX && AX.featureLocked && S && AX.featureLocked('gameReport', S.leagueId || null)) b.classList.add('locked');
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); open(0); };
    sheet.insertAdjacentElement('afterend', b);
  };
  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  if (qp.has('analysis')) {
    const go = () => (window.S && window.S.status === 'final' ? open(+qp.get('analysis') === 1 ? 1 : 0) : setTimeout(go, 500));
    setTimeout(go, 800);
  }
})();
