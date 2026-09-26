'use strict';
/* ===========================================================================
   CARDS — the game page's box score and full stats, each chart and each row a card.

   THE RENDERERS STAY THE SCORER'S. boxscore.js is lifted verbatim from the scorer's screen, where a
   box score is a table and a chart is a bare row of bars. This module is the game page's own dress
   for them: the renderers look for `globalThis.EpinoiaCards` and, where it exists, hand it what
   they have worked out and draw what it returns. The scorer never loads this file, so its screens
   are exactly what they were (the way gamepct.js is only ever loaded here).

     chart(row, o)     one mirrored bar, in a card, with the difference between the sides under it;
                       the four factors also say how many points each side gained or lost in them
     factorNote(S,TA)  the line that says how those points are worked out
     players(ctx)      full stats: a player is a card, the face and name at its left, every stat
                       drawn as a bar, a pill or a shaded figure
     box(ctx)          the traditional box score: a player is a card, the face and name at its left
     mounted(el)       binds sorting and the group switches after a draw

   POINTS ADDED ARE STRENGTH OF SCHEDULE'S (sos.js): (the factor minus the league average) times
   how many points per 100 possessions a point of that factor is worth, turnovers the other way
   round. The league average is the one the game's percentile scale holds; a league with none uses
   the mean of the two sides, which makes the sides' figures mirror each other and says so. Each
   figure is then scaled to the side's possessions in this game, so it reads as points in the game.
   The weights are sos.js's POINTS_PER_PCT; supabase/tests/cards.test.mjs holds the two equal.
   =========================================================================== */
(function () {
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* SoS's POINTS_PER_PCT, keyed by the team-advanced key each factor has here */
  const FACTOR = {
    efg:   { w: 2.0, inv: false, sos: 'efg' },
    tovp:  { w: 1.4, inv: true,  sos: 'tovPct' },
    orebp: { w: 0.7, inv: false, sos: 'orebPct' },
    ftr:   { w: 0.4, inv: false, sos: 'ftRate' }
  };
  /* rows whose difference is a difference of percentages, said in percentage points */
  const PP = { efg: 1, tovp: 1, orebp: 1, drebp: 1, ftr: 1, ts: 1, astp: 1, ftp: 1, astPtsP: 1, rimp: 1, rimr: 1, midp: 1, p3p: 1, p3r: 1, stlp: 1, blkp: 1 };

  const ink = c => { const T = window.EpinoiaTeamColour; return (T && T.ink && T.ink(c)) || c; };
  const teamColour = (S, t) => ink(window.EpinoiaBox.safeColour((S.teams[t] || {}).color, t ? '#8ff5ff' : '#93f2bf'));
  const signed = (v, dec) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dec);

  /* ------------------------------------------------------------ the charts --- */
  function baseline(S, TA, k) {
    const G = window.EpinoiaGamePct;
    const mu = G && G.mean ? G.mean('team', k, S.leagueSlug) : null;
    return mu != null ? { v: mu, league: true } : { v: ((TA[0][k] || 0) + (TA[1][k] || 0)) / 2, league: false };
  }

  /* points a side gained (+) or lost (-) in one factor, in this game */
  function pointsAdded(S, TA, k, t) {
    const f = FACTOR[k]; if (!f) return null;
    const b = baseline(S, TA, k).v, v = TA[t][k] || 0;
    const per100 = (f.inv ? b - v : v - b) * f.w;
    return per100 * (TA[t].possessions || 0) / 100;
  }

  /* A CLUB'S SHORT NAME where its full one is long (the chips are small): the club's own short_name from the
     fixture's club rows, else the full name, which the chip then cuts with an ellipsis */
  function shortName(S, t, tname) {
    const full = tname(t);
    if (full.length <= 14) return full;
    const club = S.meta && (t === 0 ? S.meta.home : S.meta.away);
    const sn = club && club.short_name;
    return sn && sn.length < full.length ? sn : full;
  }

  function chart(row, o) {
    const { label, h, a, fmt, hWin, aWin, k, TA, S, tname } = o;
    if (!isFinite(h) || !isFinite(a)) return row;
    const c0 = teamColour(S, 0), c1 = teamColour(S, 1);
    const diff = Math.abs(h - a);
    let txt = String(fmt(diff));
    const pct = /%$/.test(txt) || PP[k];
    txt = txt.replace(/%$/, '');
    if (!/^-?[\d.]+$/.test(txt)) txt = diff.toFixed(1);
    const level = diff < 1e-9 || Number(txt) === 0;
    const lead = level ? -1 : (hWin ? 0 : aWin ? 1 : (h > a ? 0 : 1));
    const neutral = !level && !hWin && !aWin;
    const arrow = lead === 0 ? '◀' : lead === 1 ? '▶' : '';
    const chip = level
      ? '<span class="fd-chip level"><b>level</b></span>'
      : '<span class="fd-chip ' + (neutral ? 'neutral' : 'lead') + '" style="--lc:' + (lead === 0 ? c0 : c1) + '">' +
          '<i aria-hidden="true">' + arrow + '</i><b>+' + esc(txt) + (pct ? ' pp' : '') + '</b><em title="' + esc(tname(lead)) + '">' + esc(shortName(S, lead, tname)) + (neutral ? ' higher' : '') + '</em></span>';
    /* ONE FOOTER LINE: the difference in the middle and, for a factor, each side's points added at its own end */
    let l = '', r = '';
    if (FACTOR[k]) {
      const p = [0, 1].map(t => pointsAdded(S, TA, k, t));
      const cell = (v, t) => '<span class="fpa-v ' + (v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '') + '" title="' + esc(tname(t) + ': ' + signed(v, 1) + ' points added from ' + label) + '">' + signed(v, 1) + '<small>pts</small></span>';
      l = cell(p[0], 0); r = cell(p[1], 1);
    }
    return '<div class="fchart' + (FACTOR[k] ? ' has-pa' : '') + '" data-k="' + esc(k || '') + '">' + row +
      '<div class="fdelta">' + l + chip + r + '</div></div>';
  }

  function factorNote(S, TA) {
    const G = window.EpinoiaGamePct;
    const league = G && G.mean && G.mean('team', 'efg', S.leagueSlug) != null;
    const from = league && G.against ? G.against(G.scaleOf(S.leagueSlug)) : null;
    return '<div class="setup-note gpnote fpa-note">points added = (the factor − ' +
      (from ? 'the league average, ' + esc(from) : 'the average of the two sides') + ') × its weight in points per 100 possessions per 1% ' +
      '(efg 2.0 · tov 1.4 · oreb 0.7 · ft rate 0.4), as in strength of schedule, scaled to each side’s possessions' +
      (from ? '' : ' · with no league scale yet, the two sides mirror each other') + '</div>';
  }

  /* THE ESTIMATED MARGIN AT THE END OF THE GAME IS THE POINTS ADDED, SUMMED. Each factor's pill under a chart says how
     many points that side gained or lost in it; the two sides' pills, taken one from the other, are what that factor
     was worth to the margin, and the four together are the margin the four factors say there should have been:
       possession battle   the turnover and offensive rebound pills, home minus away
       scoring battle      the efg and free throw rate pills, home minus away
       estimated margin    the two together
     They are worked by pointsAdded(), the function that draws the pills, so what is summed is what is on the page.
     A FINISHED GAME is on its real possessions: what the four factors say the margin should have been, beside the
     one it was. A GAME STILL GOING is the game so far, on the possessions played, so the battles read against the
     pills above them; the estimate at the end is the margin now plus what is still to come: the battle's rate per
     possession over the possessions left, PULLED TOWARDS LEVEL, because what one game's shooting and turnovers say
     about the rest of that game is a fraction of what they said so far (a rate over n possessions counts
     n / (n + 100): 29% after forty, 46% after a whole game). The possessions left come from a predicted pace: the
     pace so far, pulled towards the league's average (75 with no scale) by how little of the game is gone, run
     over the full length. With no possession played there is nothing to say. */
  const PRIOR = 100;
  function outlook(S, TA) {
    const final = S.status === 'final' || S.phase === 'final';
    const min = Math.max(0, (TA[0].minutes || 0) / 5);
    const soFar = ((TA[0].possessions || 0) + (TA[1].possessions || 0)) / 2;
    if (final) return soFar > 0 ? { final: true, poss: soFar, total: soFar, remaining: 0, shrink: 1, pace: TA[0].pace || 0, min } : null;
    if (soFar <= 0 || min <= 0) return null;
    const G = window.EpinoiaGamePct;
    const lg = (G && G.mean ? G.mean('team', 'paceOwn', S.leagueSlug) : null) || 75;
    const REG = 40, frac = Math.min(1, min / REG);
    const pace = frac * (TA[0].pace || lg) + (1 - frac) * lg;
    const total = Math.max(soFar, pace * Math.max(REG, min) / REG);
    return { final: false, poss: soFar, total, remaining: total - soFar, shrink: soFar / (soFar + PRIOR), pace, min };
  }

  function battle(S, TA) {
    const net = k => (pointsAdded(S, TA, k, 0) || 0) - (pointsAdded(S, TA, k, 1) || 0);
    const efg = net('efg'), ftr = net('ftr'), tov = net('tovp'), oreb = net('orebp');
    return { tov, oreb, efg, ftr, possession: tov + oreb, scoring: efg + ftr, estimated: tov + oreb + efg + ftr, actual: (TA[0].pts || 0) - (TA[1].pts || 0) };
  }

  /* the margin at the end: a finished game's is the battle itself; a live one's is the margin now plus the rest */
  function projected(B, O) {
    if (O.final) return { end: B.estimated, toCome: 0 };
    const toCome = O.poss > 0 ? O.shrink * (B.estimated / O.poss) * O.remaining : 0;
    return { end: B.actual + toCome, toCome };
  }

  function margin(S, TA) {
    const O = outlook(S, TA);
    if (!O) return '';
    const B = battle(S, TA);
    const P = projected(B, O);
    if (![B.estimated, B.actual, P.end].every(isFinite)) return '';
    const c = [teamColour(S, 0), teamColour(S, 1)];
    const name = t => window.EpinoiaBox.tname(t);
    const short = t => shortName(S, t, name);
    const sg = v => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(1);
    const side = v => (v >= 0 ? 0 : 1);
    const tile = (cls, label, v, sub, dec) => {
      const t = side(v), txt = dec === 0 ? (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v) : sg(v);
      return '<div class="fm-t ' + cls + '" style="--lc:' + c[t] + '"><small>' + label + '</small><b>' + txt + '</b>' +
        '<em title="' + esc(name(t)) + '">' + (Math.abs(v) < 0.05 ? 'level' : esc(short(t))) + '</em>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    };
    const basis = O.final
      ? 'the points added, summed \u00b7 ' + O.poss.toFixed(0) + ' possessions'
      : 'the points added so far, summed (' + O.poss.toFixed(0) + ' possessions), projected to a predicted ' + O.total.toFixed(0) + ' at pace ' + O.pace.toFixed(0);
    const so = O.final ? '' : ' so far';
    return '<div class="fmargin"><div class="fm-h">estimated margin at the end of the game <span>' + basis + '</span></div><div class="fm-row">' +
      tile('', 'possession battle' + so, B.possession, 'to ' + sg(B.tov) + ' \u00b7 oreb ' + sg(B.oreb)) +
      tile('', 'scoring battle' + so, B.scoring, 'efg ' + sg(B.efg) + ' \u00b7 ft ' + sg(B.ftr)) +
      tile('est', 'est. margin at the end', P.end, O.final ? '' : 'now ' + (B.actual > 0 ? '+' : B.actual < 0 ? '\u2212' : '') + Math.abs(B.actual) + ' \u00b7 to come ' + sg(P.toCome)) +
      tile('act', O.final ? 'actual margin' : 'margin now', B.actual, TA[0].pts + ' \u2013 ' + TA[1].pts, 0) + '</div></div>';
  }

  /* ------------------------------------------------------------ faces ---
     The face is report.css's .sq-face (a silhouette, or the photograph squadPhotos swaps in). */
  function face(p, colour, cls) {
    return '<span class="sq-face ' + (cls || '') + '" style="--c:' + esc(colour) + '"><span class="sq-nm">' + esc(p.name) + '</span></span>';
  }
  function nameHTML(p) {
    return UUID.test(p.id || '') ? '<a href="../p/?p=' + encodeURIComponent(p.id) + '">' + esc(p.name) + '</a>' : esc(p.name);
  }

  /* ------------------------------------------------------- full stats players --- */
  const GROUP_KEY = 'epinoia_pcs_groups';
  const VIEW_KEY = 'epinoia_pcs_view';
  let view = 'rows';                    // 'rows': the table, each row a card | 'cards': a card a player
  try { if (localStorage.getItem(VIEW_KEY) === 'cards') view = 'cards'; } catch (_) { /* the table */ }
  let sortK = 'min', sortDir = -1;
  const hiddenGroups = new Set();
  try { JSON.parse(localStorage.getItem(GROUP_KEY) || '[]').forEach(k => hiddenGroups.add(k)); } catch (_) { /* all shown */ }
  const SORTS = [['min', 'min'], ['pts', 'pts'], ['usg', 'usg'], ['ts', 'ts%'], ['ocOrtg', 'ortg'], ['net', 'net']];

  function players(c) {
    const { d, t, TT, OT, rows, ranges, gameAvg, groups, S, tname, gpRate } = c;
    const colour = teamColour(S, t);
    const barW = (v, k) => { const r = ranges[k]; return !r || r.max === r.min ? 0 : Math.max(0, Math.min(100, (v - r.min) / (r.max - r.min) * 100)); };
    let rated = false;
    const rate = (r, col) => { const R = col.gp ? gpRate('player', col.k, { a: r, x: d.stats[r.id], TT, OT }) : null; if (R) rated = true; return R; };
    const shade = R => R ? R.cls : '';
    const tip = (col, R) => R ? ' title="' + esc(col.l + ': ' + R.tip) + '"' : '';

    const item = (r, col) => {
      const v = r[col.k], R = rate(r, col);
      if (col.pill) {
        const dec = col.dec != null ? col.dec : 0;
        return '<span class="pcs-pill ' + (v >= 0 ? 'pos' : 'neg') + shade(R) + '"' + tip(col, R) + '><b>' + (v > 0 ? '+' : '') + v.toFixed(dec) + '</b><small>' + col.l + '</small></span>';
      }
      if (col.diff) {
        const dff = v - gameAvg[col.diff], good = col.inv ? dff < 0 : dff > 0, eff = col.inv ? -dff : dff;
        const cls = Math.abs(dff) < 0.5 ? '' : (good ? 'pos' : 'neg');
        const w = Math.max(0, Math.min(50, Math.abs(eff) / 15 * 50));
        return '<div class="pcs-d' + shade(R) + '"' + tip(col, R) + '><span class="pcs-l">' + col.l + '</span>' +
          '<span class="pcs-dt"><i class="' + cls + '" style="' + (eff >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></span>' +
          '<b class="' + cls + '">' + (dff > 0 ? '+' : '') + dff.toFixed(0) + '</b></div>';
      }
      if (col.bar) {
        let w = barW(v, col.k); if (col.invbar) w = 100 - w;
        return '<div class="pcs-b' + shade(R) + '"' + tip(col, R) + '><span class="pcs-l">' + col.l + '</span><b>' + col.f(v, r) + '</b>' +
          '<span class="pcs-bt"><i class="' + col.bar + '" style="width:' + Math.max(2, w).toFixed(0) + '%"></i></span></div>';
      }
      return '<div class="pcs-n' + shade(R) + '"' + tip(col, R) + '><b>' + col.f(v, r) + '</b><small>' + col.l + '</small></div>';
    };

    /* shot distribution is one picture: a bar cut into rim / mid-range / three by attempts, and the
       percentage made under each part */
    const shots = r => {
      const parts = [['rim', r.rimA, r.rimP, 'z0'], ['mid', r.midA, r.midP, 'z1'], ['3pt', r.p3a, r.p3P, 'z2']];
      const n = parts.reduce((s, p) => s + p[1], 0);
      const cols = { rim: 'rimP', mid: 'midP', '3pt': 'p3P' };
      const bar = n ? parts.filter(p => p[1]).map(p => '<i class="' + p[3] + '" style="flex:' + p[1] + '" title="' + p[0] + ': ' + p[1] + ' attempts">' + (p[1] / n >= 0.14 ? p[1] : '') + '</i>').join('') : '';
      const pills = parts.map(p => {
        const col = groups.find(g => g.key === 'shotdist').cols.find(x => x.k === cols[p[0]]);
        const R = p[1] ? rate(r, col) : null;
        return '<span class="pcs-zone ' + p[3] + shade(R) + '"' + tip(col, R) + '><small>' + p[0] + '</small><b>' + (p[1] ? p[2].toFixed(0) + '%' : '–') + '</b><em>' + p[1] + ' att</em></span>';
      }).join('');
      /* effective field goal %, the fourth figure, counts a three as one and a half twos */
      const ef = r.rimA + r.midA + r.p3a ? r.efg.toFixed(1) + '%' : '\u2013';
      const efg = '<span class="pcs-zone efg"><small>efg%</small><b>' + ef + '</b><em>' + (r.rimA + r.midA + r.p3a) + ' fga</em></span>';
      return '<div class="pcs-shots"><div class="pcs-stack">' + (bar || '<span class="pcs-none">no shots</span>') + '</div><div class="pcs-zones">' + pills + efg + '</div></div>';
    };

    /* every numeric column can be sorted on, in either view: the value rides on the row */
    const sortKeys = [...new Set(groups.flatMap(g => g.cols.map(x => x.k)))];
    const sortAttrs = r => sortKeys.map(k => ' data-s-' + k.toLowerCase() + '="' + (+r[k] || 0).toFixed(3) + '"').join('');

    /* ---- THE TABLE: a row is a card, the face and name at its left, and every column is still a column ---
       Each figure is drawn where it stands: a bar under it, a centred bar for an on-court difference, a
       pill for a net, the percentile's shade behind it. Columns are fixed widths so every row lines up. */
    const wOf = col => col.pill ? 'w-pill' : col.diff ? 'w-diff' : (col.bar || col.shot) ? 'w-bar' : col.k === 'min' ? 'w-bar' : 'w-n';
    const tcell = (r, col) => {
      const v = r[col.k], R = rate(r, col);
      const base = 'pt-c ' + wOf(col) + (col.sep ? ' sep' : '') + shade(R);
      const t = tip(col, R);
      if (col.pill) {
        const dec = col.dec != null ? col.dec : 0;
        return '<span class="' + base + '"' + t + '><i class="pt-pill ' + (v >= 0 ? 'pos' : 'neg') + '">' + (v > 0 ? '+' : '') + v.toFixed(dec) + '</i></span>';
      }
      if (col.diff) {
        const dff = v - gameAvg[col.diff], good = col.inv ? dff < 0 : dff > 0, eff = col.inv ? -dff : dff;
        const cls = Math.abs(dff) < 0.5 ? '' : (good ? 'pos' : 'neg');
        const w = Math.max(0, Math.min(50, Math.abs(eff) / 15 * 50));
        return '<span class="' + base + '"' + t + '><b class="' + cls + '">' + (dff > 0 ? '+' : '') + dff.toFixed(0) + '</b>' +
          '<span class="pt-dt"><i class="' + cls + '" style="' + (eff >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></span></span>';
      }
      if (col.shot) {
        return '<span class="' + base + '"' + t + '><b>' + v + '</b><span class="pt-bt"><i class="shooting" style="width:' + Math.max(2, Math.min(100, v / 10 * 100)).toFixed(0) + '%"></i></span></span>';
      }
      if (col.bar) {
        let w = barW(v, col.k); if (col.invbar) w = 100 - w;
        return '<span class="' + base + '"' + t + '><b>' + col.f(v, r) + '</b><span class="pt-bt"><i class="' + col.bar + '" style="width:' + Math.max(2, w).toFixed(0) + '%"></i></span></span>';
      }
      return '<span class="' + base + '"' + t + '><b>' + col.f(v, r) + '</b></span>';
    };
    const trow = r => {
      const on = d.onCourt[t].indexOf(r.id) !== -1;
      return '<div class="ptr' + (on ? ' on' : '') + '" data-pid="' + esc(r.id) + '"' + sortAttrs(r) + '><div class="pt-id">' +
        face({ id: r.id, name: r.name }, colour) +
        '<span class="pt-who"><b>' + nameHTML({ id: r.id, name: r.name }) + '</b><small>#' + esc(r.num) + '</small></span></div>' +
        groups.map(g => '<div class="pt-grp g-' + g.key + '">' + g.cols.map(col => tcell(r, col)).join('') + '</div>').join('') + '</div>';
    };
    const thead = '<div class="ptr head"><div class="pt-id"><span class="pt-who"><small>player</small></span></div>' +
      groups.map(g => '<div class="pt-grp g-' + g.key + '"><div class="pt-gh" data-grp="' + g.key + '" role="button" tabindex="0" title="' + esc(g.label) + ' \u2014 click to fold or open">' + esc(g.label) + '</div><div class="pt-gl">' +
        g.cols.map(col => '<button type="button" class="pt-c ' + wOf(col) + (col.sep ? ' sep' : '') + (sortK === col.k ? ' sorted' : '') + '" data-sk="' + col.k + '">' + esc(col.l) +
          (sortK === col.k ? '<i>' + (sortDir < 0 ? '\u25BC' : '\u25B2') + '</i>' : '') + '</button>').join('') + '</div></div>').join('') + '</div>';

    const card = r => {
      const s = d.stats[r.id];
      const body = groups.map(g => {
        const inner = g.key === 'shotdist' ? shots(r) : '<div class="pcs-items">' + g.cols.filter(col => !col.pillHead).map(col => item(r, col)).join('') + '</div>';
        return '<section class="pcg g-' + g.key + '"><h5>' + esc(g.label) + '</h5>' + inner + '</section>';
      }).join('');
      const net = r.net, on = d.onCourt[t].indexOf(r.id) !== -1;
      return '<article class="pcr' + (on ? ' on' : '') + '" data-pid="' + esc(r.id) + '"' + sortAttrs(r) + '>' +
        '<header class="pcr-id">' + face({ id: r.id, name: r.name }, colour) +
          '<div class="pcr-who"><b>' + nameHTML({ id: r.id, name: r.name }) + '</b><small><span class="pcr-num">#' + esc(r.num) + '</span>' + esc(r.minTxt) + ' min</small></div>' +
          '<div class="pcr-pills"><span class="pcs-pill pts"><b>' + s.pts + '</b><small>pts</small></span>' +
            '<span class="pcs-pill ' + (net >= 0 ? 'pos' : 'neg') + '"><b>' + (net > 0 ? '+' : '') + net.toFixed(0) + '</b><small>net</small></span></div>' +
        '</header><div class="pcr-body">' + body + '</div></article>';
    };

    const tools = '<div class="pcs-tools"><div class="pcs-view"><span>view</span>' +
      [['rows', 'table'], ['cards', 'cards']].map(([k, l]) => '<button type="button" data-view="' + k + '" class="' + (view === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="pcs-sort"><span>sort</span>' +
      SORTS.map(([k, l]) => '<button type="button" data-sortk="' + k + '" class="' + (sortK === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="pcs-grp"><span>show</span>' + groups.map(g => '<button type="button" data-grp="' + g.key + '" class="' + (hiddenGroups.has(g.key) ? '' : 'on') + '">' + esc(g.label) + '</button>').join('') + '</div></div>';
    const hide = [...hiddenGroups].map(k => ' hide-' + k).join('');
    const G = window.EpinoiaGamePct;
    return '<div class="glass bxteam advcard pcs view-' + view + hide + '" data-team="' + t + '" style="--c:' + esc(colour) + '">' +
      '<h3 data-team-slot="' + t + '" style="color:' + esc(colour) + '">' + esc(tname(t)) + '</h3>' + tools +
      '<div class="pt-wrap"><div class="pt-in">' + thead + '<div class="pt-body">' + rows.map(trow).join('') + '</div></div></div>' +
      '<div class="pcs-list">' + rows.map(card).join('') + '</div>' +
      '<div class="setup-note" style="text-align:left;padding-top:8px">on-court bars = difference from the game average · a/u = ast% ÷ usg% · possessions = 0.96 × (fga + tov + 0.44 fta − oreb)' +
        (rated && G ? ' · shaded figures: the rate’s percentile against ' + esc(G.against(G.scaleOf(S.leagueSlug))) + ' (green good, red poor; hover for the number)' : '') + '</div></div>';
  }

  /* --------------------------------------------------- traditional box score --- */
  function box(c) {
    const { d, t, T, S, five, rest, ordered, cols, teamChips, tname, fmtMin } = c;
    const colour = teamColour(S, t);
    const startIds = five.map(p => p.id);
    const num = v => (v > 0 ? '+' : '') + v;
    const cells = s => [fmtMin(s.min), s.pts, s.p2m + '-' + s.p2a, s.p3m + '-' + s.p3a, s.ftm + '-' + s.fta, s.or, s.dr, s.or + s.dr,
      s.ast, s.to, s.stl, s.blk, s.pf, s.fd, num(s.pm)];
    const cellHTML = arr => arr.map((v, i) => '<span class="bxc-c' + (cols[i] === 'pts' ? ' key' : '') + '">' + esc(v) + '</span>').join('');
    const line = p => {
      const s = d.stats[p.id], on = d.onCourt[t].indexOf(p.id) !== -1;
      return '<div class="bxr' + (on ? ' on' : '') + '" data-pid="' + esc(p.id) + '"><div class="bxc-id">' + face(p, colour) +
        '<span class="bxc-who"><b>' + nameHTML(p) + '</b><small>#' + esc(p.num) + '</small></span></div>' + cellHTML(cells(s)) + '</div>';
    };
    const sum = k => S.teams[t].players.reduce((a, p) => a + d.stats[p.id][k], 0);
    const tot = ['p2m', 'p2a', 'p3m', 'p3a', 'ftm', 'fta', 'or', 'dr', 'ast', 'stl', 'blk', 'fd', 'min'].reduce((o, k) => { o[k] = sum(k); return o; }, {});
    let html = '<div class="bxr head"><div class="bxc-id"><span class="bxc-who"><small>player</small></span></div>' +
      cols.map(x => '<span class="bxc-c">' + esc(x) + '</span>').join('') + '</div>';
    html += five.length ? five.map(line).join('') : ordered.map(line).join('');
    if (five.length && rest.length) html += '<div class="bxc-sep">bench</div>' + rest.map(line).join('');
    if (T.teamRebO + T.teamRebD + T.teamTo > 0) {
      html += '<div class="bxr aux"><div class="bxc-id"><span class="bxc-who"><b>team</b></span></div>' +
        cellHTML(['', '', '', '', '', T.teamRebO, T.teamRebD, T.teamRebO + T.teamRebD, '', T.teamTo, '', '', '', '', '']) + '</div>';
    }
    html += '<div class="bxr tot"><div class="bxc-id"><span class="bxc-who"><b>totals</b></span></div>' +
      cellHTML([fmtMin(tot.min), T.pts, tot.p2m + '-' + tot.p2a, tot.p3m + '-' + tot.p3a, tot.ftm + '-' + tot.fta, tot.or + T.teamRebO, tot.dr + T.teamRebD,
        tot.or + tot.dr + T.teamRebO + T.teamRebD, tot.ast, T.toTot, tot.stl, tot.blk, T.foulTot, tot.fd, '']) + '</div>';
    return '<div class="glass bxteam bxcards" style="--c:' + esc(colour) + '"><h3 data-team-slot="' + t + '">' + esc(tname(t)) + '</h3>' + teamChips +
      '<div class="bxc-wrap"><div class="bxc-in">' + html + '</div></div></div>';
  }

  /* ----------------------------------------------------------- after a draw --- */
  function resort(host) {
    const attr = 'data-s-' + sortK.toLowerCase();
    host.querySelectorAll('.pcs-list, .pt-body').forEach(list => {
      const items = [...list.children];
      items.sort((x, y) => ((+x.getAttribute(attr) || 0) - (+y.getAttribute(attr) || 0)) * sortDir);
      items.forEach(c => list.appendChild(c));
    });
    host.querySelectorAll('.pcs-sort button').forEach(b => b.classList.toggle('on', b.dataset.sortk === sortK));
    host.querySelectorAll('.pt-c[data-sk]').forEach(b => {
      const on = b.dataset.sk === sortK;
      b.classList.toggle('sorted', on);
      const i = b.querySelector('i'); if (i) i.remove();
      if (on) { const m = document.createElement('i'); m.textContent = sortDir < 0 ? '\u25BC' : '\u25B2'; b.appendChild(m); }
    });
  }
  function pick(host, k) {
    if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = -1; }
    resort(host);
  }
  function mounted(host) {
    if (!host) return;
    if (sortK !== 'min' || sortDir !== -1) resort(host);
    if (host.dataset.cardsBound) return;
    host.dataset.cardsBound = '1';
    host.addEventListener('click', ev => {
      const v = ev.target.closest && ev.target.closest('.pcs-view button');
      if (v) {
        view = v.dataset.view;
        try { localStorage.setItem(VIEW_KEY, view); } catch (_) { /* this visit only */ }
        host.querySelectorAll('.pcs').forEach(p => { p.classList.toggle('view-rows', view === 'rows'); p.classList.toggle('view-cards', view === 'cards'); });
        host.querySelectorAll('.pcs-view button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
        return;
      }
      const h = ev.target.closest && ev.target.closest('.pt-c[data-sk]');
      if (h) { pick(host, h.dataset.sk); return; }
      const s = ev.target.closest && ev.target.closest('.pcs-sort button');
      if (s) { pick(host, s.dataset.sortk); return; }
      const g = ev.target.closest && ev.target.closest('.pcs-grp button, .pt-gh[data-grp]');
      if (!g) return;
      const k = g.dataset.grp;
      if (hiddenGroups.has(k)) hiddenGroups.delete(k); else hiddenGroups.add(k);
      try { localStorage.setItem(GROUP_KEY, JSON.stringify([...hiddenGroups])); } catch (_) { /* this visit only */ }
      host.querySelectorAll('.pcs').forEach(p => p.classList.toggle('hide-' + k, hiddenGroups.has(k)));
      host.querySelectorAll('.pcs-grp button[data-grp="' + k + '"]').forEach(b => b.classList.toggle('on', !hiddenGroups.has(k)));
    });
  }

  window.EpinoiaCards = { chart, factorNote, margin, battle, outlook, projected, players, box, mounted, pointsAdded, FACTOR };
}());
