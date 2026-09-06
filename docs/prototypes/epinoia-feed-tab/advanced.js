/* ============================================================================
   advanced.js — the ADVANCED (FEED) tab of the game page.

   THE SCORER'S TABS READ AN EVENT LOG. A game that arrived from a league feed
   (FIBA LiveStats, 2BBL, EuroLeague …) through scripts/ingest has no event
   log here — it has a `game_advanced` row: box, team totals, four factors,
   shot zones, transition, and (when the adapter could derive them) stints and
   lineups, all in the 13-CSV shape the analytics engines already consume.
   This module renders THAT row, so an ingested game gets a full advanced
   view without pretending to be a scored one.

   Deliberately renderer-only: no fetching, no state beyond the per-75 toggle.
   game.js hands it the bundle and the page's S, and calls it again whenever
   the row changes (realtime) — same three-way render split as every other tab.

   Numbers here are computed from summed box rows, never averaged across rows.
   Where the worker already computed a figure (four_factors) the worker's
   number is shown and labelled; where it is derived on the page it says so.
   ============================================================================ */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const f0 = v => (v == null || isNaN(v)) ? '—' : Math.round(v).toString();
  const f1 = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(1);
  const pct = (a, b) => b > 0 ? a / b * 100 : null;
  const div = (a, b) => b > 0 ? a / b : null;
  const GAME_MIN = 40;

  /* "31:06" → 31.1 minutes; a bare number passes through */
  function minutes(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    const m = String(v).match(/^(\d+):(\d+)/);
    if (m) return +m[1] + (+m[2]) / 60;
    return n(v);
  }

  let per75 = false;                     // the one piece of UI state this tab owns

  /* --------------------------------------------------------------- teams --- */
  function sides(bundle, S) {
    const t = bundle.team || {};
    const home = t.home || {}, away = t.away || {};
    const c0 = (S && S.teams && S.teams[0] && S.teams[0].color) || '#93f2bf';
    const c1 = (S && S.teams && S.teams[1] && S.teams[1].color) || '#8ff5ff';
    return [
      { key: 'home', name: home.team || bundle.home_name || (S && S.teams[0].name) || 'home', row: home, colour: c0 },
      { key: 'away', name: away.team || bundle.away_name || (S && S.teams[1].name) || 'away', row: away, colour: c1 }
    ];
  }

  function teamRates(me, opp) {
    const poss = n(me.poss) || (n(me.fga) - n(me.oreb) + n(me.tov) + 0.44 * n(me.fta));
    const oposs = n(opp.poss) || (n(opp.fga) - n(opp.oreb) + n(opp.tov) + 0.44 * n(opp.fta));
    const tsa = n(me.fga) + 0.44 * n(me.fta);
    return {
      poss, pts: n(me.points), ptsA: n(opp.points),
      ortg: pct(n(me.points), poss), drtg: pct(n(opp.points), oposs),
      efg: pct(n(me.fgm) + 0.5 * n(me.fg3m), n(me.fga)),
      ts: tsa > 0 ? n(me.points) / (2 * tsa) * 100 : null,
      tov: pct(n(me.tov), n(me.fga) + 0.44 * n(me.fta) + n(me.tov)),
      oreb: pct(n(me.oreb), n(me.oreb) + n(opp.dreb)),
      dreb: pct(n(me.dreb), n(me.dreb) + n(opp.oreb)),
      ftr: pct(n(me.fta), n(me.fga)),
      threeRate: pct(n(me.fg3a), n(me.fga)), threePct: pct(n(me.fg3m), n(me.fg3a)),
      astRate: pct(n(me.ast), n(me.fgm)), astTo: div(n(me.ast), n(me.tov)),
      stlp: pct(n(me.stl), oposs), blkp: pct(n(me.blk), n(opp.fga) - n(opp.fg3a)),
      fb: n(me.pts_fast_break), sc: n(me.pts_second_chance), pot: n(me.pts_off_tov), paint: n(me.pts_paint)
    };
  }

  /* ------------------------------------------------------------ builders --- */
  function mirrorRow(label, h, a, opts) {
    const o = opts || {};
    const fmt = o.f || f1, max = o.max || 100, lowerBetter = !!o.lower;
    const hv = h == null || isNaN(h) ? null : h, av = a == null || isNaN(a) ? null : a;
    const hWin = hv != null && av != null && (lowerBetter ? hv < av : hv > av);
    const aWin = hv != null && av != null && (lowerBetter ? av < hv : av > hv);
    const w = v => v == null ? 0 : Math.max(0, Math.min(100, v / max * 100));
    return '<div class="ffrow"><span class="ffval' + (hWin ? ' winner' : '') + '">' + fmt(hv) + '</span>' +
      '<div class="ffmid"><div class="ffbar"><i style="width:' + w(hv) + '%"></i></div>' +
      '<div class="ffbar"><i style="width:' + w(av) + '%"></i></div><div class="fflabel">' + esc(label) + '</div></div>' +
      '<span class="ffval r' + (aWin ? ' winner' : '') + '">' + fmt(av) + '</span></div>';
  }
  function tugRow(label, h, a) {
    const tot = (n(h) + n(a)) || 1;
    return '<div class="mrrow"><span class="ffval' + (h > a ? ' winner' : '') + '">' + f0(h) + '</span>' +
      '<div><div class="tug"><i style="width:' + (n(h) / tot * 100) + '%"></i><i style="width:' + (n(a) / tot * 100) + '%"></i></div>' +
      '<div class="mrlabel">' + esc(label) + '</div></div><span class="ffval r' + (a > h ? ' winner' : '') + '">' + f0(a) + '</span></div>';
  }
  function teamStrip(T) {
    return '<div style="display:flex;justify-content:space-between;font-size:10px;letter-spacing:.2em;padding:0 0 6px;">' +
      '<span style="color:' + esc(T[0].colour) + '">' + esc(T[0].name) + '</span><span style="color:' + esc(T[1].colour) + '">' + esc(T[1].name) + '</span></div>';
  }

  /* 1. ratings + four factors --------------------------------------------- */
  function factorsCard(bundle, T, R) {
    const ff = bundle.four_factors || {};
    const wf = (side, k) => ff[side] && ff[side][k] != null ? ff[side][k] : null;
    const rows =
      mirrorRow('off rating', R[0].ortg, R[1].ortg, { max: 140 }) +
      mirrorRow('def rating', R[0].drtg, R[1].drtg, { max: 140, lower: true }) +
      mirrorRow('efg%', wf('home', 'efg') != null ? wf('home', 'efg') : R[0].efg, wf('away', 'efg') != null ? wf('away', 'efg') : R[1].efg, { max: 80 }) +
      mirrorRow('tov%', wf('home', 'tov') != null ? wf('home', 'tov') : R[0].tov, wf('away', 'tov') != null ? wf('away', 'tov') : R[1].tov, { max: 30, lower: true }) +
      mirrorRow('oreb%', wf('home', 'oreb') != null ? wf('home', 'oreb') : R[0].oreb, wf('away', 'oreb') != null ? wf('away', 'oreb') : R[1].oreb, { max: 60 }) +
      mirrorRow('fta rate', wf('home', 'ftr') != null ? wf('home', 'ftr') : R[0].ftr, wf('away', 'ftr') != null ? wf('away', 'ftr') : R[1].ftr, { max: 60 });
    const pace = (R[0].poss + R[1].poss) / 2;
    return '<div class="glass ffcard"><h3>ratings & four factors <span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· pace ' + f1(pace) + ' / 40 · ' +
      (ff.home ? 'factors from the feed worker' : 'factors derived on this page') + '</span></h3>' + teamStrip(T) + rows + '</div>';
  }

  /* 2. box score with per-game / per-75 toggle ---------------------------- */
  const BOX_COLS = [
    ['min', 'min'], ['pts', 'pts'], ['fg', 'fg'], ['3p', '3p'], ['ft', 'ft'], ['or', 'or'], ['dr', 'dr'], ['reb', 'reb'],
    ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['to', 'to'], ['pf', 'pf'], ['pm', '+/-'], ['eff', 'eff']
  ];
  function boxTable(bundle, side, T, R) {
    const rows = (bundle.box && bundle.box[side.key]) || [];
    const teamPoss = R[side.key === 'home' ? 0 : 1].poss;
    const scale = p => {
      if (!per75) return 1;
      const mins = minutes(p.sMinutes);
      const pposs = teamPoss * (mins / GAME_MIN);
      return pposs > 0 ? 75 / pposs : 0;
    };
    const cell = (v, s, dec) => (per75 && dec !== false) ? f1(n(v) * s) : f0(n(v));
    const tot = { min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, or: 0, dr: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, eff: 0 };
    const body = rows.slice().sort((a, b) => (n(b.starter) - n(a.starter)) || (minutes(b.sMinutes) - minutes(a.sMinutes))).map(p => {
      const mins = minutes(p.sMinutes), s = scale(p);
      tot.min += mins; tot.pts += n(p.sPoints); tot.fgm += n(p.sFieldGoalsMade); tot.fga += n(p.sFieldGoalsAttempted);
      tot.tpm += n(p.sThreePointersMade); tot.tpa += n(p.sThreePointersAttempted); tot.ftm += n(p.sFreeThrowsMade); tot.fta += n(p.sFreeThrowsAttempted);
      tot.or += n(p.sReboundsOffensive); tot.dr += n(p.sReboundsDefensive); tot.reb += n(p.sReboundsTotal); tot.ast += n(p.sAssists);
      tot.stl += n(p.sSteals); tot.blk += n(p.sBlocks); tot.to += n(p.sTurnovers); tot.pf += n(p.sFoulsPersonal); tot.eff += n(p.eff_1);
      const fg = per75 ? f1(n(p.sFieldGoalsMade) * s) + '-' + f1(n(p.sFieldGoalsAttempted) * s) : n(p.sFieldGoalsMade) + '-' + n(p.sFieldGoalsAttempted);
      const tp = per75 ? f1(n(p.sThreePointersMade) * s) + '-' + f1(n(p.sThreePointersAttempted) * s) : n(p.sThreePointersMade) + '-' + n(p.sThreePointersAttempted);
      const ft = per75 ? f1(n(p.sFreeThrowsMade) * s) + '-' + f1(n(p.sFreeThrowsAttempted) * s) : n(p.sFreeThrowsMade) + '-' + n(p.sFreeThrowsAttempted);
      const pm = n(p.sPlusMinusPoints);
      return '<tr' + (n(p.starter) ? ' class="oncourt"' : '') + '><td>' + esc(p.shirt || p.number || '') + '</td>' +
        '<td data-pid="' + esc(p.player_id || '') + '">' + esc(p.player_name) + (n(p.starter) ? ' <span style="color:var(--faint);font-size:9px">S</span>' : '') + '</td>' +
        '<td>' + f1(mins) + '</td><td>' + cell(p.sPoints, s) + '</td><td>' + fg + '</td><td>' + tp + '</td><td>' + ft + '</td>' +
        '<td>' + cell(p.sReboundsOffensive, s) + '</td><td>' + cell(p.sReboundsDefensive, s) + '</td><td>' + cell(p.sReboundsTotal, s) + '</td>' +
        '<td>' + cell(p.sAssists, s) + '</td><td>' + cell(p.sSteals, s) + '</td><td>' + cell(p.sBlocks, s) + '</td><td>' + cell(p.sTurnovers, s) + '</td>' +
        '<td>' + cell(p.sFoulsPersonal, s) + '</td><td class="' + (pm > 0 ? 'good' : pm < 0 ? 'bad' : '') + '">' + (pm > 0 ? '+' : '') + f0(pm) + '</td>' +
        '<td>' + f0(n(p.eff_1)) + '</td></tr>';
    }).join('');
    const totRow = '<tr class="tot"><td></td><td>total</td><td>' + f0(tot.min) + '</td><td>' + f0(tot.pts) + '</td><td>' + tot.fgm + '-' + tot.fga + '</td>' +
      '<td>' + tot.tpm + '-' + tot.tpa + '</td><td>' + tot.ftm + '-' + tot.fta + '</td><td>' + tot.or + '</td><td>' + tot.dr + '</td><td>' + tot.reb + '</td>' +
      '<td>' + tot.ast + '</td><td>' + tot.stl + '</td><td>' + tot.blk + '</td><td>' + tot.to + '</td><td>' + tot.pf + '</td><td></td><td>' + f0(tot.eff) + '</td></tr>';
    return '<div class="glass advcard"><h3 style="color:' + esc(side.colour) + '">' + esc(side.name) + ' · box score ' +
      '<span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· ' + (per75 ? 'per 75 possessions (minutes share × team pace)' : 'per game') + '</span></h3>' +
      '<div class="tblwrap"><table class="bx"><thead><tr><th>#</th><th>player</th>' + BOX_COLS.map(c => '<th>' + c[1] + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="17" style="text-align:left;color:var(--faint)">no player rows in the feed</td></tr>') + totRow + '</tbody></table></div></div>';
  }

  /* 3. shot zones + 4. transition --------------------------------------- */
  function zonesCard(bundle, T, R) {
    const z = bundle.shots || {};
    const zh = z.home || {}, za = z.away || {};
    const zone = (o, k) => o[k] || { att: 0, made: 0 };
    const have = ['rim', 'mid', 'three'].some(k => zone(zh, k).att + zone(za, k).att > 0);
    let rows = '';
    if (have) {
      const fgaH = ['rim', 'mid', 'three'].reduce((a, k) => a + zone(zh, k).att, 0) || n(T[0].row.fga);
      const fgaA = ['rim', 'mid', 'three'].reduce((a, k) => a + zone(za, k).att, 0) || n(T[1].row.fga);
      rows += '<div class="mrsep">— accuracy —</div>' +
        mirrorRow('rim %', pct(zone(zh, 'rim').made, zone(zh, 'rim').att), pct(zone(za, 'rim').made, zone(za, 'rim').att)) +
        mirrorRow('mid %', pct(zone(zh, 'mid').made, zone(zh, 'mid').att), pct(zone(za, 'mid').made, zone(za, 'mid').att)) +
        mirrorRow('3pt %', pct(zone(zh, 'three').made, zone(zh, 'three').att), pct(zone(za, 'three').made, zone(za, 'three').att)) +
        '<div class="mrsep">— shot diet (share of fga) —</div>' +
        mirrorRow('rim', pct(zone(zh, 'rim').att, fgaH), pct(zone(za, 'rim').att, fgaA)) +
        mirrorRow('mid', pct(zone(zh, 'mid').att, fgaH), pct(zone(za, 'mid').att, fgaA), { lower: true }) +
        mirrorRow('three', pct(zone(zh, 'three').att, fgaH), pct(zone(za, 'three').att, fgaA)) +
        mirrorRow('moreyball (rim+3)', pct(zone(zh, 'rim').att + zone(zh, 'three').att, fgaH), pct(zone(za, 'rim').att + zone(za, 'three').att, fgaA));
    } else {
      rows += mirrorRow('3pt %', R[0].threePct, R[1].threePct) + mirrorRow('3pta / fga', R[0].threeRate, R[1].threeRate) +
        '<div class="mrsep" style="color:var(--faint)">no shot-chart zones in this feed — 3pt split only</div>';
    }
    rows += '<div class="mrsep">— situational —</div>' +
      tugRow('fast break pts', (bundle.transition && bundle.transition.home && bundle.transition.home.fb) || R[0].fb, (bundle.transition && bundle.transition.away && bundle.transition.away.fb) || R[1].fb) +
      tugRow('2nd chance pts', (bundle.transition && bundle.transition.home && bundle.transition.home.sc) || R[0].sc, (bundle.transition && bundle.transition.away && bundle.transition.away.sc) || R[1].sc) +
      tugRow('pts off turnovers', (bundle.transition && bundle.transition.home && bundle.transition.home.pot) || R[0].pot, (bundle.transition && bundle.transition.away && bundle.transition.away.pot) || R[1].pot) +
      tugRow('paint pts', R[0].paint, R[1].paint);
    return '<div class="glass ffcard"><h3>shot zones & situational</h3>' + teamStrip(T) + rows + '</div>';
  }

  function metricsCard(T, R) {
    const rows = mirrorRow('true shooting %', R[0].ts, R[1].ts) + mirrorRow('ast / to', R[0].astTo, R[1].astTo, { max: 4, f: v => v == null ? '—' : v.toFixed(2) }) +
      mirrorRow('ast / fgm %', R[0].astRate, R[1].astRate) + mirrorRow('dreb %', R[0].dreb, R[1].dreb) +
      mirrorRow('stl %', R[0].stlp, R[1].stlp, { max: 20 }) + mirrorRow('blk %', R[0].blkp, R[1].blkp, { max: 20 });
    return '<div class="glass ffcard"><h3>additional metrics</h3>' + teamStrip(T) + rows + '</div>';
  }

  /* 5. lineups + 6. stint timeline (only when the adapter derived stints) --- */
  function stintSide(st, side) {
    const p = side === 'home' ? 'home_' : 'away_', o = side === 'home' ? 'away_' : 'home_';
    return {
      lineup: st[p + 'lineup'] || '', poss: n(st[p + 'possessions']) || n(st.possessions), oposs: n(st[o + 'possessions']) || n(st.possessions),
      pts: n(st[p + 'points']), ptsA: n(st[o + 'points']), fga: n(st[p + 'fga']), fgm: n(st[p + 'fgm']), fg3m: n(st[p + 'fg3m']),
      tov: n(st[p + 'tov']), fta: n(st[p + 'fta']), oreb: n(st[p + 'oreb']), odreb: n(st[o + 'dreb']), dur: n(st.duration)
    };
  }
  function lineupsCard(bundle, T) {
    const stints = Array.isArray(bundle.stints) ? bundle.stints : [];
    const pre = bundle.lineups || {};
    const build = side => {
      if (Array.isArray(pre[side.key]) && pre[side.key].length) return pre[side.key];
      const acc = new Map();
      stints.forEach(st => {
        const s = stintSide(st, side.key);
        if (!s.lineup) return;
        const a = acc.get(s.lineup) || { lineup: s.lineup, poss: 0, oposs: 0, pts: 0, ptsA: 0, fga: 0, fgm: 0, fg3m: 0, tov: 0, fta: 0, oreb: 0, odreb: 0, dur: 0 };
        Object.keys(a).forEach(k => { if (k !== 'lineup') a[k] += s[k]; });
        acc.set(s.lineup, a);
      });
      return [...acc.values()];
    };
    const rowsFor = side => build(side).map(l => ({
      lineup: l.lineup, poss: n(l.poss), dur: n(l.dur), pts: n(l.pts), ptsA: n(l.ptsA),
      ortg: pct(n(l.pts), n(l.poss)), drtg: pct(n(l.ptsA), n(l.oposs) || n(l.poss)),
      net: (pct(n(l.pts), n(l.poss)) != null && pct(n(l.ptsA), n(l.oposs) || n(l.poss)) != null) ? pct(n(l.pts), n(l.poss)) - pct(n(l.ptsA), n(l.oposs) || n(l.poss)) : null,
      efg: pct(n(l.fgm) + 0.5 * n(l.fg3m), n(l.fga)), tov: pct(n(l.tov), n(l.fga) + 0.44 * n(l.fta) + n(l.tov)), oreb: pct(n(l.oreb), n(l.oreb) + n(l.odreb))
    })).sort((a, b) => b.poss - a.poss);
    const table = side => {
      const rows = rowsFor(side);
      if (!rows.length) return '';
      return '<div class="glass advcard"><h3 style="color:' + esc(side.colour) + '">' + esc(side.name) + ' · lineups <span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· ratio of summed stints, sorted by possessions</span></h3>' +
        '<div class="tblwrap"><table class="bx lu"><thead><tr><th></th><th>lineup</th><th>min</th><th>poss</th><th>pts</th><th>pts a</th><th>ortg</th><th>drtg</th><th>net</th><th>efg%</th><th>tov%</th><th>oreb%</th></tr></thead><tbody>' +
        rows.slice(0, 14).map((r, i) => '<tr><td>' + (i + 1) + '</td><td style="max-width:260px;white-space:normal;font-size:11px">' + esc(r.lineup) + '</td><td>' + f1(r.dur / 60) + '</td><td>' + f0(r.poss) + '</td>' +
          '<td>' + f0(r.pts) + '</td><td>' + f0(r.ptsA) + '</td><td>' + f1(r.ortg) + '</td><td>' + f1(r.drtg) + '</td>' +
          '<td class="' + (r.net > 0 ? 'good' : r.net < 0 ? 'bad' : '') + '">' + (r.net == null ? '—' : (r.net > 0 ? '+' : '') + f1(r.net)) + '</td>' +
          '<td>' + f1(r.efg) + '</td><td>' + f1(r.tov) + '</td><td>' + f1(r.oreb) + '</td></tr>').join('') +
        '</tbody></table></div></div>';
    };
    return table(T[0]) + table(T[1]);
  }
  function timelineCard(bundle, T) {
    const stints = Array.isArray(bundle.stints) ? bundle.stints : [];
    if (!stints.length) return '';
    const W = 900, H = 170, padL = 34, padR = 10, padT = 12, padB = 26;
    const pts = [];
    let margin = 0, t = 0;
    stints.forEach(st => {
      const h = stintSide(st, 'home');
      margin += h.pts - h.ptsA; t += h.dur;
      pts.push({ x: t, m: margin, st, h });
    });
    const totalT = t || 1;
    const maxAbs = Math.max(5, ...pts.map(p => Math.abs(p.m)));
    const xAt = v => padL + v / totalT * (W - padL - padR);
    const yAt = m => padT + (1 - (m + maxAbs) / (2 * maxAbs)) * (H - padT - padB);
    let d = 'M' + xAt(0) + ',' + yAt(0), lastX = xAt(0), lastY = yAt(0);
    const segs = pts.map(p => {
      const x = xAt(p.x), y = yAt(p.m);
      const s = '<line x1="' + lastX.toFixed(1) + '" y1="' + lastY.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + (p.m >= 0 ? T[0].colour : T[1].colour) + '" stroke-width="2.2">' +
        '<title>' + esc('Q' + (p.st.period || '?') + ' ' + (p.st.start_time || '') + '→' + (p.st.end_time || '') + '\n' + T[0].name + ': ' + (p.h.lineup || '') + '\n' + T[1].name + ': ' + (stintSide(p.st, 'away').lineup || '') + '\nstint ' + (p.h.pts - p.h.ptsA > 0 ? '+' : '') + (p.h.pts - p.h.ptsA) + ' · margin ' + (p.m > 0 ? '+' : '') + p.m) + '</title></line>';
      lastX = x; lastY = y; return s;
    }).join('');
    const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map(m => '<line x1="' + padL + '" y1="' + yAt(m) + '" x2="' + (W - padR) + '" y2="' + yAt(m) + '" stroke="rgba(255,255,255,' + (m === 0 ? 0.35 : 0.08) + ')"/>' +
      '<text x="' + (padL - 4) + '" y="' + (yAt(m) + 3) + '" text-anchor="end" font-size="9" fill="var(--faint)">' + (m > 0 ? '+' : '') + Math.round(m) + '</text>').join('');
    let per = 0, pMarks = '';
    stints.forEach((st, i) => { if (st.period !== per) { per = st.period; const x = xAt(pts[i].x - n(st.duration)); pMarks += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (H - padB) + '" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 3"/><text x="' + (x + 3) + '" y="' + (H - padB + 12) + '" font-size="9" fill="var(--faint)">Q' + per + '</text>'; } });
    return '<div class="glass ffcard"><h3>margin by stint <span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· ' + stints.length + ' stints · hover a segment for the lineups on court</span></h3>' +
      '<div class="tblwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;min-width:640px;height:auto;display:block">' + ticks + pMarks + segs + '</svg></div></div>';
  }

  /* 7. starters vs bench split, from stints + the box's starter flag -------- */
  function starterCard(bundle, T) {
    const stints = Array.isArray(bundle.stints) ? bundle.stints : [];
    if (!stints.length) return '';
    const starters = side => new Set(((bundle.box || {})[side] || []).filter(p => n(p.starter)).map(p => String(p.player_name).trim().toLowerCase()));
    const isStart = (lineup, set) => { const names = String(lineup || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); return names.length === 5 && names.filter(x => set.has(x)).length >= 4; };
    const sH = starters('home'), sA = starters('away');
    if (sH.size < 5 && sA.size < 5) return '';
    const buckets = { both: { l: 'starters v starters' }, homeS: { l: T[0].name + ' starters v bench' }, awayS: { l: T[1].name + ' starters v bench' }, bench: { l: 'bench v bench' } };
    Object.values(buckets).forEach(b => Object.assign(b, { poss: 0, oposs: 0, pts: 0, ptsA: 0 }));
    stints.forEach(st => {
      const h = stintSide(st, 'home'), a = stintSide(st, 'away');
      const hs = isStart(h.lineup, sH), as = isStart(a.lineup, sA);
      const b = hs && as ? buckets.both : hs ? buckets.homeS : as ? buckets.awayS : buckets.bench;
      b.poss += h.poss; b.oposs += h.oposs; b.pts += h.pts; b.ptsA += h.ptsA;
    });
    const rows = Object.values(buckets).filter(b => b.poss > 0).map(b => {
      const o = pct(b.pts, b.poss), d = pct(b.ptsA, b.oposs || b.poss), net = o != null && d != null ? o - d : null;
      return '<tr><td></td><td>' + esc(b.l) + '</td><td>' + f0(b.poss) + '</td><td>' + f0(b.pts) + '</td><td>' + f0(b.ptsA) + '</td><td>' + f1(o) + '</td><td>' + f1(d) + '</td>' +
        '<td class="' + (net > 0 ? 'good' : net < 0 ? 'bad' : '') + '">' + (net == null ? '—' : (net > 0 ? '+' : '') + f1(net)) + '</td></tr>';
    }).join('');
    return '<div class="glass advcard"><h3>starters & bench <span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· a unit is “starters” with 4+ of the five who started · ' + esc(T[0].name) + ' perspective</span></h3>' +
      '<div class="tblwrap"><table class="bx"><thead><tr><th></th><th>units on court</th><th>poss</th><th>pts</th><th>pts a</th><th>ortg</th><th>drtg</th><th>net</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ------------------------------------------------------------- render --- */
  function render(bundle, S) {
    if (!bundle || !bundle.team) return '<div class="msg">No feed data has been ingested for this game yet.</div>';
    const T = sides(bundle, S);
    const R = [teamRates(T[0].row, T[1].row), teamRates(T[1].row, T[0].row)];
    const head = '<div class="glass ffcard" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">' +
      '<div style="font-size:10px;letter-spacing:.18em;color:var(--faint)">feed · ' + esc(bundle.adapter || 'ingest') + (bundle.external_id ? ' · #' + esc(bundle.external_id) : '') +
      ' · ' + esc(bundle.status || 'final') + (bundle.computed_at ? ' · updated ' + esc(String(bundle.computed_at).replace('T', ' ').slice(0, 16)) : '') + '</div>' +
      '<div class="tabrow" style="margin:0;gap:6px"><button class="tabbtn' + (per75 ? '' : ' on') + '" data-adv-mode="game" style="padding:6px 12px;flex:0">per game</button>' +
      '<button class="tabbtn' + (per75 ? ' on' : '') + '" data-adv-mode="per75" style="padding:6px 12px;flex:0">per 75</button></div></div>';
    return head + factorsCard(bundle, T, R) + boxTable(bundle, T[0], T, R) + boxTable(bundle, T[1], T, R) +
      zonesCard(bundle, T, R) + metricsCard(T, R) + timelineCard(bundle, T) + lineupsCard(bundle, T) + starterCard(bundle, T);
  }

  /* the toggle is delegated so game.js can re-render freely */
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-adv-mode]');
    if (!b) return;
    per75 = b.dataset.advMode === 'per75';
    if (window.EpinoiaAdvanced.onToggle) window.EpinoiaAdvanced.onToggle();
  });

  window.EpinoiaAdvanced = { render, get per75() { return per75; }, onToggle: null };
})();
