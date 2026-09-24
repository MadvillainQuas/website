/* ===========================================================================
   THE MODERN BOX SCORE — the five on the floor, drawn on the floor.

   A box score is a table because a newspaper was a table. On a phone, in the
   fourth quarter, what a fan wants to know is WHO IS OUT THERE and what each of
   them has done, and a half court with five faces on it answers that in one
   look. The rest of the squad sits along the bottom as a bench, smaller, in
   minutes order, and every face opens the full line on a tap or a hover.

   Where each of the five stands is not a position anybody typed for this game.
   BPM's position estimate (bpm.js: rebounds, assists, steals, blocks, fouls)
   gives every player a number between 1 and 5 — over the SEASON, from the same
   aggregation the stats pages read (data.js season()), with the club's listed
   position as the prior it leans on when the minutes are few. A player without
   twenty season minutes yet falls back to this game's own numbers. The five are
   sorted by it and dealt onto the five spots — point, off guard, wing, forward,
   big. A five-guard lineup still gets five spots; it just gets them by how
   those guards actually play.

   Live, the five are engine.js's onCourt, which follows every substitution in
   the log; on a final game they are the starters, the five the game began with.
   The view is rebuilt whenever the log changes (game.js's renderBody key), so a
   sub moves a face between the floor and the bench on the frame it lands.

   Renders HTML strings like the other tabs, and owns the popover interaction
   through one delegated listener on the body host. Reads window.S, the
   boxscore module (EpinoiaBox) and the BPM module the way game.js does.
   ======================================================================== */
(function () {
  'use strict';

  const SLOTS = [
    /* fractions of the half court (boxscore.js COURT: 1500 wide, 1400 deep, ring at the top) */
    { key: 'pg', label: 'point',   x: 0.50, y: 0.84 },
    { key: 'sg', label: 'guard',   x: 0.19, y: 0.62 },
    { key: 'sf', label: 'wing',    x: 0.81, y: 0.62 },
    { key: 'pf', label: 'forward', x: 0.29, y: 0.31 },
    { key: 'c',  label: 'big',     x: 0.71, y: 0.22 }
  ];

  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* "Guard", "PG", "F/C", "Wing", "Centre" -> a number on BPM's 1..5 scale, or null */
  function listedToNumber(txt) {
    const s = String(txt || '').trim().toLowerCase();
    if (!s) return null;
    const parts = s.split(/[\/,\-\s]+/).filter(Boolean);
    const one = w => {
      if (/^(pg|point|1)$/.test(w) || /point/.test(w)) return 1;
      if (/^(sg|shooting|2|off)$/.test(w) || /shooting/.test(w)) return 2;
      if (/^(sf|small|3|wing|swing)$/.test(w) || /small|wing|swing/.test(w)) return 3;
      if (/^(pf|power|4|stretch)$/.test(w) || /power/.test(w)) return 4;
      if (/^(c|5|centre|center|big|post|pivot)$/.test(w) || /cent|big|post/.test(w)) return 5;
      if (/^(g|guard|guards|combo)$/.test(w) || /guard/.test(w)) return 1.5;
      if (/^(f|forward|forwards)$/.test(w) || /forward/.test(w)) return 3.5;
      return null;
    };
    const nums = parts.map(one).filter(v => v != null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  const surname = name => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    let last = w[w.length - 1];
    if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && w.length > 1) last = w[w.length - 2];
    return last;
  };
  const initials = name => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();

  /* ---------------------------------------------------------- the name on a face ---
     A SURNAME IS ONLY A NAME WHILE IT IS THE ONLY ONE. Five circles saying "GARCIA",
     "GARCIA" and "GARCIA" name nobody, and two of those can be on the floor together.

     So the label is the shortest thing that still picks a player out of THIS GAME: the
     surname alone where it is unique, and where it is not, the least first-name that
     separates the players who share it — "T. Halbwachs" if one T, "Ta. Halbwachs" if
     the other is Tao's brother Theo, and so on. Brothers with the same first name get
     their shirt number, which is the only thing left that differs.

     Diacritics are folded for the COMPARISON only: Peña and Pena are the same surname
     to a reader glancing at a phone, and the label itself keeps its accents. */
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const givenOf = name => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return w.length > 1 ? w.slice(0, w.length - 1).join(' ') : '';
  };

  function nameLabels(players) {
    /* players: [{ id, name, num }] — everyone in the game, both teams */
    const groups = {};
    players.forEach(p => {
      const k = fold(surname(p.name));
      (groups[k] = groups[k] || []).push(p);
    });
    const out = {};
    Object.keys(groups).forEach(k => {
      const g = groups[k];
      if (g.length === 1) { out[g[0].id] = surname(g[0].name); return; }
      /* the shortest first-name prefix that tells every one of them apart */
      let n = 0;
      for (let len = 1; len <= 6; len++) {
        const seen = new Set(g.map(p => fold(givenOf(p.name)).slice(0, len)));
        if (seen.size === g.length) { n = len; break; }
      }
      g.forEach(p => {
        const given = givenOf(p.name);
        if (!n || !given) {
          /* same surname, same first name (or no first name at all): the shirt is what is left */
          out[p.id] = (p.num !== '' && p.num != null ? '#' + p.num + ' ' : '') + surname(p.name);
        } else {
          out[p.id] = given.slice(0, n) + '. ' + surname(p.name);
        }
      });
    });
    return out;
  }

  let labels = {}, labelKey = '';
  function labelsFor(S) {
    const all = [];
    (S.teams || []).forEach(tm => (tm.players || []).forEach(p => all.push(p)));
    const key = all.map(p => p.id + ':' + p.name).join('|');
    if (key !== labelKey) { labelKey = key; labels = nameLabels(all); }
    return labels;
  }

  /* --------------------------------------------------------------- data --- */
  let advByPid = {};          // pid -> playerAdv row, for the popover
  let posByPid = {};          // pid -> { n: estimate 1..5, src: 'bpm'|'listed'|'none', listed: text }
  let bpmByPid = {};
  let teamAdvs = null;        // [home, away] teamAdv rows, what the percentiles read a player against
  let pinned = null;          // pid whose popover is pinned open
  let lastPopColour = null;
  /* a club colour as text or a border on the page's ground: the ink form on the light theme */
  function teamInk(hex) {
    const TC = window.EpinoiaTeamColour;
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return (light && TC && TC.ink) ? TC.ink(hex) : hex;
  }

  function compute(d) {
    const S = window.S, B = window.EpinoiaBox, E = window.EpinoiaEngine;
    advByPid = {}; posByPid = {}; bpmByPid = {};
    const listed = window.__rosterPos || {};
    const TA = [0, 1].map(t => { try { return B.teamAdv(d, t); } catch (_) { return null; } });
    teamAdvs = TA;
    const gameAvg = {};
    if (TA[0] && TA[1]) {
      ['ortg', 'efg', 'orebp', 'tovp'].forEach(k => { gameAvg[k] = ((TA[0][k] || 0) + (TA[1][k] || 0)) / 2; });
    }
    [0, 1].forEach(t => {
      (S.teams[t].players || []).forEach(p => {
        const l = listed[p.id] ? listedToNumber(listed[p.id]) : null;
        posByPid[p.id] = { n: l != null ? l : 3, src: l != null ? 'listed' : 'none', listed: listed[p.id] || '' };
        if (TA[0] && TA[1] && d.stats[p.id]) {
          try { advByPid[p.id] = B.playerAdv(d, t, p, TA[t], TA[1 - t], gameAvg); } catch (_) { /* no line */ }
        }
      });
    });
    /* BPM, with the club's listed position as the prior it regresses towards */
    const BPM = window.EpinoiaBPM;
    if (BPM && BPM.forTeam && TA[0] && TA[1]) {
      const ortgs = TA.map(a => a.ortg).filter(v => v > 0);
      const leagueAvg = ortgs.length ? ortgs.reduce((a, b) => a + b, 0) / ortgs.length : 100;
      [0, 1].forEach(t => {
        const players = (S.teams[t].players || []).map(p => {
          const x = d.stats[p.id]; if (!x) return null;
          const lp = posByPid[p.id];
          return { id: p.id, minutes: (x.min || 0) / 60000, listedPosition: lp.src === 'listed' ? lp.n : undefined,
                   pts: x.pts || 0, tpm: x.p3m || 0, ast: x.ast || 0, to: x.to || 0, orb: x.or || 0, drb: x.dr || 0,
                   stl: x.stl || 0, blk: x.blk || 0, pf: x.pf || 0, fga: (x.p2a || 0) + (x.p3a || 0), fta: x.fta || 0 };
        }).filter(Boolean);
        const sum = k => players.reduce((n, q) => n + (q[k] || 0), 0);
        const tsa = sum('fga') + 0.44 * sum('fta');
        const mins = Math.max(1, sum('minutes') / 5);
        const poss = TA[t].pace ? TA[t].pace * mins / 40 : Math.max(1, tsa);
        const per100 = {}; ['pts', 'tpm', 'ast', 'to', 'orb', 'drb', 'stl', 'blk', 'pf', 'fga', 'fta'].forEach(k => { per100[k] = sum(k) * 100 / Math.max(1, poss); });
        per100.trb = per100.orb + per100.drb;
        const team = { pace: TA[t].pace || 70, netRtg: (TA[t].ortg || 0) - (TA[t].drtg || 0), offRtg: TA[t].ortg || null,
                       avgPtsPerTSA: tsa ? sum('pts') / tsa : 1.0, per100 };
        try {
          BPM.forTeam(team, players, leagueAvg).forEach(r => {
            bpmByPid[r.id] = r.bpm;
            if (r.position != null) posByPid[r.id] = Object.assign({}, posByPid[r.id], { n: r.position, src: 'game' });
          });
        } catch (_) { /* positions stay listed */ }
      });
    }
    /* THE SEASON'S ESTIMATE, where it exists. bpm.js regresses its estimate towards a listed
       position with a fifty-minute prior, and the season aggregation had no listed position to
       give it (it used 3.0). With the club's own listing to hand the prior is re-pointed at it:
       the raw season estimate is recovered, then regressed again towards what the club says. */
    if (seasonPos) {
      Object.keys(posByPid).forEach(pid => {
        const s = seasonPos[pid];
        if (!s || !(s.min >= 20)) return;
        let n = s.pos;
        const cur = posByPid[pid];
        if (cur.src === 'listed' || (cur.listed && listedToNumber(cur.listed) != null)) {
          const l = listedToNumber(cur.listed);
          const raw = (s.pos * (s.min + 50) - 50 * 3.0) / s.min;
          n = (s.min * raw + 50 * l) / (s.min + 50);
        }
        posByPid[pid] = Object.assign({}, cur, { n: Math.max(1, Math.min(5, n)), src: 'season', seasonMin: s.min });
      });
    }
  }

  /* the five for a side: on the floor while the game runs, the starters once it is over */
  function fiveFor(d, t) {
    const S = window.S;
    const starters = (S.starters && S.starters[t]) || [];
    const final = S.status === 'final' || S.phase === 'final';
    let ids = final ? starters.slice() : ((d.onCourt && d.onCourt[t]) || []).slice();
    if (!final && ids.length < 5) starters.forEach(id => { if (ids.length < 5 && ids.indexOf(id) < 0) ids.push(id); });
    if (!ids.length) ids = starters.slice();
    return ids.slice(0, 5);
  }

  /* deal the five onto the spots by their position number, low to high */
  function placed(ids, byId) {
    const list = ids.map(id => byId[id]).filter(Boolean);
    list.sort((a, b) => (posByPid[a.id] || {}).n - (posByPid[b.id] || {}).n || (+a.num || 99) - (+b.num || 99));
    /* fewer than five spots filled (a bad log): still spread from the point outwards */
    return list.map((p, i) => ({ p, slot: SLOTS[Math.min(SLOTS.length - 1, i)] }));
  }

  /* --------------------------------------------------------------- html --- */
  /* The silhouette that stands in for a photograph is drawn by .sq-face itself (report.css),
     so every view that uses the component gets it without three copies of an SVG. */
  function faceHTML(p, colour, cls) {
    return '<span class="sq-face ' + cls + '" style="--c:' + esc(colour) + '"><span class="sq-nm">' + esc(p.name) + '</span></span>';
  }

  function circleHTML(p, x, colour, opts) {
    const o = opts || {};
    const reb = (x.or || 0) + (x.dr || 0);
    const b = bpmByPid[p.id];
    const dnp = !(x.min > 0 || x.pts > 0);
    const label = (labels[p.id] || surname(p.name));
    /* the line the reader can actually see beside this face: what a flash is judged on */
    const shown = o.bench ? [x.pts || 0, reb] : [x.pts || 0, reb, x.ast || 0];
    return '<div class="mv-p' + (o.bench ? ' bench' : ' floor') + (dnp ? ' dnp' : '') + (pinned === p.id ? ' pinned' : '') + '" data-pid="' + esc(p.id) + '"' +
      ' data-shown="' + shown.join(',') + '"' +
      (o.style ? ' style="' + o.style + '"' : '') + ' tabindex="0" role="button" aria-label="' + esc(p.name) + '">' +
      '<span class="mv-shadow"></span>' +
      faceHTML(p, colour, '') +
      (p.num !== '' && p.num != null ? '<span class="mv-num">' + esc(p.num) + '</span>' : '') +
      /* --nl is the label's length; the size it picks is CSS's, so each breakpoint keeps its own */
      '<span class="mv-nm" style="--nl:' + label.length + '">' + esc(label) + '</span>' +
      (o.bench
        ? '<span class="mv-line">' + (dnp ? 'dnp' : window.EpinoiaBox.fmtMin(x.min || 0)) + '</span>' +
          (dnp ? '' : '<span class="mv-sub">' + (x.pts || 0) + ' pts · ' + reb + ' reb</span>')
        : '<span class="mv-line"><span class="w">' + (x.pts || 0) + ' pts · ' + reb + ' reb · ' + (x.ast || 0) + ' ast</span><span class="n">' + (x.pts || 0) + 'p ' + reb + 'r ' + (x.ast || 0) + 'a</span></span>' +
          '<span class="mv-sub">' + window.EpinoiaBox.fmtMin(x.min || 0) +
            (b == null ? '' : ' · <i class="' + (b >= 0 ? 'pos' : 'neg') + '">' + (b > 0 ? '+' : '') + b.toFixed(1) + ' bpm</i>') + '</span>') +
      '</div>';
  }

  function teamHTML(d, t) {
    const S = window.S, B = window.EpinoiaBox;
    const team = S.teams[t] || {};
    const colour = teamInk(B.safeColour(team.color, t ? '#8ff5ff' : '#93f2bf'));
    const byId = {}; (team.players || []).forEach(p => { byId[p.id] = p; });
    const final = S.status === 'final' || S.phase === 'final';
    const five = fiveFor(d, t);
    const onFloor = placed(five, byId);
    const bench = (team.players || []).filter(p => five.indexOf(p.id) < 0)
      .sort((a, b) => ((d.stats[b.id] || {}).min || 0) - ((d.stats[a.id] || {}).min || 0));
    const court = B.courtSVG(null, { plain: true });
    const floor = onFloor.map(({ p, slot }) => circleHTML(p, d.stats[p.id] || B.mkP(), colour,
      { style: 'left:' + (slot.x * 100).toFixed(1) + '%;top:' + (slot.y * 100).toFixed(1) + '%' })).join('');
    const T = d.team[t] || {};
    return '<div class="glass bxteam mv-card t' + t + '" data-t="' + t + '" style="--c:' + esc(colour) + '">' +
      '<div class="mv-head"><h3 data-team-slot="' + t + '" style="color:' + colour + '">' + esc(B.tname(t)) + '</h3>' +
        '<span class="mv-tag">' + (final ? 'starters' : 'on the floor') + ' · ' + (T.pts || 0) + ' pts</span></div>' +
      '<div class="mv-court">' + court + '<div class="mv-five">' + floor + '</div></div>' +
      (bench.length ? '<div class="mv-benchlabel">bench</div><div class="mv-bench">' +
        bench.map(p => circleHTML(p, d.stats[p.id] || B.mkP(), colour, { bench: true })).join('') + '</div>' : '') +
      '</div>';
  }

  function render(d) {
    compute(d);
    labelsFor(window.S);
    return '<div class="mv">' + teamHTML(d, 0) + teamHTML(d, 1) + '</div>' +
      '<div class="setup-note mv-note">positions from BPM’s season estimate, leaning on the club’s listed position (this game’s numbers until a player has twenty season minutes) · tap or hover a player for the full line</div>';
  }

  /* -------------------------------------------------------------- popover --- */
  function popHTML(pid) {
    const S = window.S, B = window.EpinoiaBox;
    let t = -1, p = null;
    S.teams.forEach((tm, i) => (tm.players || []).forEach(q => { if (q.id === pid) { t = i; p = q; } }));
    if (!p) return '';
    const d = window.derive();
    const x = d.stats[pid] || B.mkP();
    const a = advByPid[pid] || {};
    const pos = posByPid[pid] || {};
    const colour = teamInk(B.safeColour((S.teams[t] || {}).color, t ? '#8ff5ff' : '#93f2bf'));
    lastPopColour = colour;
    const f1 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(1);
    const f0 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(0);
    const pm = (x.pm > 0 ? '+' : '') + (x.pm || 0);
    const b = bpmByPid[pid];
    const slot = SLOTS[Math.max(0, Math.min(4, Math.round((pos.n || 3)) - 1))];
    const cell = (l, v, cls) => '<div class="mv-cell' + (cls ? ' ' + cls : '') + '" data-i18n-ctx="col"><b>' + v + '</b><span>' + l + '</span></div>';
    /* THE ADVANCED NUMBERS, EACH READ AGAINST REAL GAMES (gamepct.js): the cell takes the
       percentile's colour and carries the percentile in its corner. A number with too little
       behind it (a ts% on no shots) has none, and draws as before. A style rather than a
       success (usage, pace) gets the percentile without a colour. */
    const GPx = window.EpinoiaGamePct;
    const ctx = GPx && teamAdvs && teamAdvs[t] && teamAdvs[1 - t] && a.min != null && x.oc
      ? { a, x, TT: teamAdvs[t], OT: teamAdvs[1 - t] } : null;
    const rcell = (l, v, k, fallback) => {
      const r = ctx ? GPx.rate('player', k, ctx, { league: S.leagueSlug }) : null;
      if (!r) return cell(l, v, fallback);
      return '<div class="mv-cell' + GPx.cls(r) + '" data-i18n-ctx="col" title="' + esc(l + ': ' + GPx.words(r)) + '"><b>' + v + '</b><span>' + l + '</span>' + GPx.pcHTML(r) + '</div>';
    };
    const href = /^[0-9a-f-]{36}$/i.test(pid) ? '../p/?p=' + encodeURIComponent(pid) : null;
    return '<div class="mv-pophead" style="--c:' + esc(colour) + '">' +
        '<span class="mv-popnum">' + esc(p.num || '') + '</span>' +
        '<div><b>' + (href ? '<a href="' + esc(href) + '">' + esc(p.name) + '</a>' : esc(p.name)) + '</b>' +
        '<small data-i18n-ctx="pos">' + esc(slot.label) + (pos.src === 'season' ? ' (season)' : pos.src === 'game' ? ' (this game)' : '') + (pos.listed ? ' · listed ' + esc(pos.listed) : '') + ' · ' + B.fmtMin(x.min || 0) + ' min' +
          (b == null ? '' : ' · ' + (b > 0 ? '+' : '') + b.toFixed(1) + ' bpm') + '</small></div>' +
        '<button class="mv-close" type="button" aria-label="close">×</button></div>' +
      '<div class="mv-grid">' +
        cell('pts', x.pts || 0, 'big') + cell('2fg', (x.p2m || 0) + '-' + (x.p2a || 0)) + cell('3fg', (x.p3m || 0) + '-' + (x.p3a || 0)) + cell('ft', (x.ftm || 0) + '-' + (x.fta || 0)) +
        cell('reb', ((x.or || 0) + (x.dr || 0)) + '<i>' + (x.or || 0) + '/' + (x.dr || 0) + '</i>') + cell('ast', x.ast || 0) + cell('stl', x.stl || 0) + cell('blk', x.blk || 0) +
        cell('to', x.to || 0) + cell('pf', x.pf || 0) + cell('fd', x.fd || 0) + cell('+/-', pm, (x.pm > 0 ? 'pos' : x.pm < 0 ? 'neg' : '')) +
      '</div>' +
      '<div class="mv-sect">shooting &amp; usage</div><div class="mv-grid">' +
        rcell('ts%', f1(a.ts), 'ts') + rcell('usg%', f1(a.usg), 'usg') + rcell('ppp', a.ppp == null ? '—' : a.ppp.toFixed(2), 'ppp') + rcell('ft rate', f0(a.ftr), 'ftr') +
        rcell('rim', (a.rimA || 0) + '<i>' + f0(a.rimP) + '%</i>', 'rimP') + rcell('mid', (a.midA || 0) + '<i>' + f0(a.midP) + '%</i>', 'midP') + rcell('3pt', (a.p3a || 0) + '<i>' + f0(a.p3P) + '%</i>', 'p3P') + rcell('pts + ast', a.tpc == null ? '—' : a.tpc, 'tpc') +
      '</div>' +
      '<div class="mv-sect">rates</div><div class="mv-grid">' +
        rcell('ast%', f1(a.astPct), 'astPct') + rcell('to%', f1(a.tovP), 'tovP') + rcell('orb%', f1(a.orebP), 'orebP') + rcell('drb%', f1(a.drebP), 'drebP') +
        rcell('stl%', f1(a.stlP), 'stlP') + rcell('blk%', f1(a.blkP), 'blkP') + rcell('a/u', a.au == null ? '—' : a.au.toFixed(2), 'au') + rcell('pace ±', a.pacePM == null ? '—' : (a.pacePM > 0 ? '+' : '') + f1(a.pacePM), 'pacePM') +
      '</div>' +
      '<div class="mv-sect">on court</div><div class="mv-grid four">' +
        rcell('ortg', f1(a.ocOrtg), 'ocOrtg') + rcell('drtg', f1(a.ocDrtg), 'ocDrtg') + rcell('net', (a.net > 0 ? '+' : '') + f1(a.net), 'net', a.net > 0 ? 'pos' : a.net < 0 ? 'neg' : '') + rcell('efg', f1(a.ocEfg), 'ocEfg') +
      '</div>' +
      (ctx ? '<div class="mv-gpnote">coloured by percentile against ' + esc(GPx.against(GPx.scaleOf(S.leagueSlug))) + '</div>' : '');
  }

  function popEl() {
    let el = document.getElementById('mvPop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mvPop'; el.className = 'mv-pop'; el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  function showPop(pid, anchor) {
    const el = popEl();
    el.innerHTML = popHTML(pid);
    if (lastPopColour) el.style.setProperty('--c', lastPopColour);
    el.dataset.pid = pid;
    el.hidden = false;
    place(el, anchor);
  }
  function hidePop() { const el = document.getElementById('mvPop'); if (el) el.hidden = true; pinned = null;
    document.querySelectorAll('.mv-p.pinned').forEach(e => e.classList.remove('pinned')); }

  /* On a phone the card is a sheet along the bottom; on a desktop it sits beside the face,
     flipped to whichever side has room, and never off the screen.

     THE PAGE IS ZOOMED on a desktop (1.25 from 1000px, 1.5 from 1200px, as the rest of the
     site). getBoundingClientRect and the window measure the screen; the card's own left, top
     and size are its CSS pixels, which the zoom then scales. So the sums are done on the
     screen and divided back by the card's scale, read off the card itself rather than
     assumed, which is right at any zoom and in a browser that has none. */
  function place(el, anchor) {
    const phone = window.matchMedia('(max-width: 720px)').matches;
    el.classList.toggle('sheet', phone);
    if (phone) { el.style.left = el.style.top = ''; return; }
    const r = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const k = el.offsetWidth ? (box.width / el.offsetWidth) || 1 : 1;
    const w = box.width || 320 * k, h = box.height || 300 * k, gap = 12 * k, edge = 8 * k;
    let left = r.right + gap, top = r.top - edge;
    if (left + w > window.innerWidth - edge) left = r.left - w - gap;
    if (left < edge) left = Math.max(edge, Math.min(window.innerWidth - w - edge, r.left));
    if (top + h > window.innerHeight - edge) top = Math.max(edge, window.innerHeight - h - edge);
    el.style.left = (left / k) + 'px'; el.style.top = (top / k) + 'px';
  }

  let bound = false;
  function bind(host) {
    if (bound) return; bound = true;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const target = ev => ev.target.closest && ev.target.closest('.mv-p[data-pid]');
    host.addEventListener('click', ev => {
      const p = target(ev);
      if (!p) return;
      ev.preventDefault();
      const pid = p.dataset.pid;
      if (pinned === pid) { hidePop(); return; }
      hidePop(); pinned = pid; p.classList.add('pinned');
      showPop(pid, p);
    });
    if (!coarse) {
      host.addEventListener('mouseover', ev => {
        const p = target(ev); if (!p || pinned) return;
        showPop(p.dataset.pid, p);
      });
      host.addEventListener('mouseout', ev => {
        const p = target(ev); if (!p || pinned) return;
        const to = ev.relatedTarget;
        if (to && (p.contains(to) || (to.closest && to.closest('#mvPop')))) return;
        const el = document.getElementById('mvPop'); if (el) el.hidden = true;
      });
    }
    host.addEventListener('keydown', ev => {
      const p = target(ev); if (!p) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); p.click(); }
      if (ev.key === 'Escape') hidePop();
    });
    document.addEventListener('click', ev => {
      const el = document.getElementById('mvPop');
      if (!el || el.hidden) return;
      if (ev.target.closest && (ev.target.closest('#mvPop') && !ev.target.closest('.mv-close'))) return;
      if (ev.target.closest && ev.target.closest('.mv-p[data-pid]')) return;
      hidePop();
    });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hidePop(); });
    window.addEventListener('resize', () => {
      const el = document.getElementById('mvPop');
      if (!el || el.hidden) return;
      const a = document.querySelector('.mv-p[data-pid="' + el.dataset.pid + '"]');
      if (a) place(el, a); else hidePop();
    });
    /* the popover shows a live line, so refresh it when the body redraws underneath it */
    host.addEventListener('mv:redrawn', () => {
      const el = document.getElementById('mvPop');
      if (!el || el.hidden || !pinned) return;
      const a = document.querySelector('.mv-p[data-pid="' + pinned + '"]');
      if (!a) { hidePop(); return; }
      a.classList.add('pinned');
      el.innerHTML = popHTML(pinned); place(el, a);
    });
  }

  /* called by game.js after the modern body lands in the host */
  /* ------------------------------------------------------------------ the flash ---
     WHAT CHANGED SINCE THE LAST DRAW. The view is rebuilt from HTML strings whenever
     the log changes, so nothing in the DOM survives to animate from. What survives is
     this map: the line each face was showing last time. A face whose visible numbers
     moved gets the change spelled out beside it for a moment — "+2", "+1 REB" — and
     then the page is quiet again.

     Only the numbers the reader can SEE on that face count. A player whose steals went
     up flashes nothing, because nothing beside his face changed, and a flash pointing
     at an unchanged line is worse than no flash at all.

     The first draw never flashes: opening a game at 64-58 must not fire twenty pills. */
  let shownBefore = null;
  /* [suffix, the most one play can add] — a bigger jump than this is not a play, it is a tab
     that was left on another view for ten minutes, or a log being reconciled. Those get no
     flash: an animation is a way of saying "watch, this just happened". */
  const LINE_LABELS = [['', 4], ['REB', 2], ['AST', 2]];

  function flashChanges(host) {
    const now = {};
    const fire = [];
    host.querySelectorAll('.mv-p[data-shown]').forEach(el => {
      const pid = el.getAttribute('data-pid');
      const vals = el.getAttribute('data-shown').split(',').map(Number);
      now[pid] = vals;
      const was = shownBefore && shownBefore[pid];
      if (!was || was.length !== vals.length) return;
      const bits = [];
      vals.forEach((v, i) => {
        const d = v - was[i];
        const spec = LINE_LABELS[i] || ['', 4];
        if (d > 0 && d <= spec[1]) bits.push('+' + d + (spec[0] ? ' ' + spec[0] : ''));
      });
      if (bits.length) fire.push([el, bits.join(' · ')]);
    });
    if (shownBefore) fire.forEach(([el, text]) => {
      const pill = document.createElement('span');
      pill.className = 'mv-pop-delta';
      pill.textContent = text;
      el.appendChild(pill);
      el.classList.add('mv-hit');
      setTimeout(() => { pill.remove(); el.classList.remove('mv-hit'); }, 1600);
    });
    shownBefore = now;
  }

  /* ------------------------------------------------------------- the name that fits ---
     The CSS steps the size down by the label's length, which is close and costs nothing
     before the first paint. Close is not always enough: "Segno-Verbrugghe" wants 126px of
     an 86px caption at the size a five-letter surname gets, and an ellipsis in the middle
     of a name is the one thing this whole view exists to avoid. So once it is on the page
     each caption is measured and given the size that actually fits it — never smaller than
     it has to be, and never below the floor where it would stop being readable.

     Re-run when the webfont lands: a measurement taken against the fallback face is a
     measurement of the wrong letters. */
  const NAME_FLOOR = 6.6;         // below this a caption on a phone stops being a word

  function fitNames(host) {
    host.querySelectorAll('.mv-nm').forEach(n => {
      n.style.fontSize = '';
      const room = n.clientWidth;
      if (!room || n.scrollWidth <= room) return;
      /* ONE STEP IS NOT ENOUGH. Shrinking re-lays the letters out (this caption is uppercase
         and letter-spaced), so the proportion measured at one size is only close at the next.
         A few passes converge; the loop stops the moment it fits. */
      let size = parseFloat(getComputedStyle(n).fontSize) || 11;
      for (let i = 0; i < 4 && n.scrollWidth > room && size > NAME_FLOOR; i++) {
        size = Math.max(NAME_FLOOR, size * room / n.scrollWidth);
        n.style.fontSize = size.toFixed(2) + 'px';
      }
      /* AND WHAT STILL DOES NOT FIT IS CUT, AS IT ALWAYS WAS.
         A caption that beats the floor used to be allowed to wrap onto a second line. It
         should not be: a name is ONE line under a circle, and the circles are placed
         absolutely at fixed spots on a court while the lines under them are not -- so a
         caption that grows taller pushes that player's minutes and plus-minus down past the
         next player's, where they read as belonging to nobody. "Segno-Verbrugghe" has one
         hyphen to break at and the rest has to break mid-word, which made the caption nine
         lines and its owner's numbers an inch adrift (reported 2026-09-18).

         Measuring the name is what makes this rare: nearly everything fits once it is
         allowed to shrink, and the one surname in a league that still does not gets the
         ellipsis it got before any of this. A caption cannot change the height of the block
         it is in. */
    });
  }

  let fontsWatched = false;

  function mounted(host) {
    bind(host);
    try { flashChanges(host); } catch (_) { /* a flash is decoration: never break the box score */ }
    try {
      fitNames(host);
      if (!fontsWatched && document.fonts && document.fonts.ready) {
        fontsWatched = true;
        document.fonts.ready.then(() => { try { fitNames(host); } catch (_) {} });
      }
    } catch (_) { /* a caption at its CSS size is still a caption */ }
    host.dispatchEvent(new CustomEvent('mv:redrawn'));
  }

  /* the season's positions: one aggregation of the competition, cached for the page */
  let seasonPos = null, seasonLoading = null;
  function loadSeason(S) {
    if (seasonLoading) return seasonLoading;
    const D = window.EpinoiaData;
    const cid = S && S.meta && S.meta.competitionId;
    if (!D || !D.season || !cid) return Promise.resolve(false);
    seasonLoading = (async () => {
      try {
        const r = await D.season(cid);
        const map = {};
        (r.players || []).forEach(p => { if (p.bpm_pos != null) map[p.id] = { pos: p.bpm_pos, min: p.min || 0 }; });
        seasonPos = map;
        return Object.keys(map).length > 0;
      } catch (_) { return false; }
    })();
    return seasonLoading;
  }

  /* the clubs' listed positions, once per game, for BPM to lean on */
  let posLoaded = false;
  async function loadListed(api, S) {
    if (posLoaded || !S || !S.meta) return false;
    posLoaded = true;
    const ids = [S.meta.homeTeamId, S.meta.awayTeamId].filter(Boolean);
    if (!ids.length) return false;
    try {
      const rows = await api('roster_entries?team_id=in.(' + ids.join(',') + ')&active=eq.true&select=player_id,position');
      const m = {};
      (rows || []).forEach(r => { if (r.position) m[r.player_id] = r.position; });
      window.__rosterPos = m;
      return Object.keys(m).length > 0;
    } catch (_) { return false; }
  }

  window.EpinoiaModernBox = { render, mounted, loadListed, loadSeason, hidePop, listedToNumber, nameLabels, SLOTS, placed, _pos: () => posByPid };
}());
