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

  /* --------------------------------------------------------------- data --- */
  let advByPid = {};          // pid -> playerAdv row, for the popover
  let posByPid = {};          // pid -> { n: estimate 1..5, src: 'bpm'|'listed'|'none', listed: text }
  let bpmByPid = {};
  let pinned = null;          // pid whose popover is pinned open

  function compute(d) {
    const S = window.S, B = window.EpinoiaBox, E = window.EpinoiaEngine;
    advByPid = {}; posByPid = {}; bpmByPid = {};
    const listed = window.__rosterPos || {};
    const TA = [0, 1].map(t => { try { return B.teamAdv(d, t); } catch (_) { return null; } });
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
  function faceHTML(p, colour, cls) {
    return '<span class="sq-face ' + cls + '" style="--c:' + esc(colour) + '"><span class="sq-nm">' + esc(p.name) + '</span></span>';
  }

  function circleHTML(p, x, colour, opts) {
    const o = opts || {};
    const reb = (x.or || 0) + (x.dr || 0);
    const b = bpmByPid[p.id];
    const dnp = !(x.min > 0 || x.pts > 0);
    return '<div class="mv-p' + (o.bench ? ' bench' : ' floor') + (dnp ? ' dnp' : '') + (pinned === p.id ? ' pinned' : '') + '" data-pid="' + esc(p.id) + '"' +
      (o.style ? ' style="' + o.style + '"' : '') + ' tabindex="0" role="button" aria-label="' + esc(p.name) + '">' +
      '<span class="mv-shadow"></span>' +
      faceHTML(p, colour, '') +
      (p.num !== '' && p.num != null ? '<span class="mv-num">' + esc(p.num) + '</span>' : '') +
      '<span class="mv-nm">' + esc(surname(p.name)) + '</span>' +
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
    const colour = B.safeColour(team.color, t ? '#8ff5ff' : '#93f2bf');
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
    return '<div class="glass bxteam mv-card t' + t + '" data-t="' + t + '">' +
      '<div class="mv-head"><h3 data-team-slot="' + t + '" style="color:' + colour + '">' + esc(B.tname(t)) + '</h3>' +
        '<span class="mv-tag">' + (final ? 'starters' : 'on the floor') + ' · ' + (T.pts || 0) + ' pts</span></div>' +
      '<div class="mv-court">' + court + '<div class="mv-five">' + floor + '</div></div>' +
      (bench.length ? '<div class="mv-benchlabel">bench</div><div class="mv-bench">' +
        bench.map(p => circleHTML(p, d.stats[p.id] || B.mkP(), colour, { bench: true })).join('') + '</div>' : '') +
      '</div>';
  }

  function render(d) {
    compute(d);
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
    const colour = B.safeColour((S.teams[t] || {}).color, t ? '#8ff5ff' : '#93f2bf');
    const f1 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(1);
    const f0 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(0);
    const pm = (x.pm > 0 ? '+' : '') + (x.pm || 0);
    const b = bpmByPid[pid];
    const slot = SLOTS[Math.max(0, Math.min(4, Math.round((pos.n || 3)) - 1))];
    const cell = (l, v, cls) => '<div class="mv-cell' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + l + '</span></div>';
    const href = /^[0-9a-f-]{36}$/i.test(pid) ? '../p/?p=' + encodeURIComponent(pid) : null;
    return '<div class="mv-pophead" style="--c:' + esc(colour) + '">' +
        '<span class="mv-popnum">' + esc(p.num || '') + '</span>' +
        '<div><b>' + (href ? '<a href="' + esc(href) + '">' + esc(p.name) + '</a>' : esc(p.name)) + '</b>' +
        '<small>' + esc(slot.label) + (pos.src === 'season' ? ' (season)' : pos.src === 'game' ? ' (this game)' : '') + (pos.listed ? ' · listed ' + esc(pos.listed) : '') + ' · ' + B.fmtMin(x.min || 0) + ' min' +
          (b == null ? '' : ' · ' + (b > 0 ? '+' : '') + b.toFixed(1) + ' bpm') + '</small></div>' +
        '<button class="mv-close" type="button" aria-label="close">×</button></div>' +
      '<div class="mv-grid">' +
        cell('pts', x.pts || 0, 'big') + cell('2fg', (x.p2m || 0) + '-' + (x.p2a || 0)) + cell('3fg', (x.p3m || 0) + '-' + (x.p3a || 0)) + cell('ft', (x.ftm || 0) + '-' + (x.fta || 0)) +
        cell('reb', ((x.or || 0) + (x.dr || 0)) + '<i>' + (x.or || 0) + '/' + (x.dr || 0) + '</i>') + cell('ast', x.ast || 0) + cell('stl', x.stl || 0) + cell('blk', x.blk || 0) +
        cell('to', x.to || 0) + cell('pf', x.pf || 0) + cell('fd', x.fd || 0) + cell('+/-', pm, (x.pm > 0 ? 'pos' : x.pm < 0 ? 'neg' : '')) +
      '</div>' +
      '<div class="mv-sect">shooting &amp; usage</div><div class="mv-grid">' +
        cell('ts%', f1(a.ts)) + cell('usg%', f1(a.usg)) + cell('ppp', a.ppp == null ? '—' : a.ppp.toFixed(2)) + cell('ft rate', f0(a.ftr)) +
        cell('rim', (a.rimA || 0) + '<i>' + f0(a.rimP) + '%</i>') + cell('mid', (a.midA || 0) + '<i>' + f0(a.midP) + '%</i>') + cell('3pt', (a.p3a || 0) + '<i>' + f0(a.p3P) + '%</i>') + cell('pts + ast', a.tpc == null ? '—' : a.tpc) +
      '</div>' +
      '<div class="mv-sect">rates</div><div class="mv-grid">' +
        cell('ast%', f1(a.astPct)) + cell('to%', f1(a.tovP)) + cell('orb%', f1(a.orebP)) + cell('drb%', f1(a.drebP)) +
        cell('stl%', f1(a.stlP)) + cell('blk%', f1(a.blkP)) + cell('a/u', a.au == null ? '—' : a.au.toFixed(2)) + cell('pace ±', a.pacePM == null ? '—' : (a.pacePM > 0 ? '+' : '') + f1(a.pacePM)) +
      '</div>' +
      '<div class="mv-sect">on court</div><div class="mv-grid four">' +
        cell('ortg', f1(a.ocOrtg)) + cell('drtg', f1(a.ocDrtg)) + cell('net', (a.net > 0 ? '+' : '') + f1(a.net), a.net > 0 ? 'pos' : a.net < 0 ? 'neg' : '') + cell('efg', f1(a.ocEfg)) +
      '</div>';
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
    el.dataset.pid = pid;
    el.hidden = false;
    place(el, anchor);
  }
  function hidePop() { const el = document.getElementById('mvPop'); if (el) el.hidden = true; pinned = null;
    document.querySelectorAll('.mv-p.pinned').forEach(e => e.classList.remove('pinned')); }

  /* On a phone the card is a sheet along the bottom; on a desktop it sits beside the face,
     flipped to whichever side has room, and never off the screen. */
  function place(el, anchor) {
    const phone = window.matchMedia('(max-width: 720px)').matches;
    el.classList.toggle('sheet', phone);
    if (phone) { el.style.left = el.style.top = ''; return; }
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 320, h = el.offsetHeight || 300;
    let left = r.right + 12, top = r.top - 8;
    if (left + w > window.innerWidth - 8) left = r.left - w - 12;
    if (left < 8) left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px';
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
  function mounted(host) {
    bind(host);
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

  window.EpinoiaModernBox = { render, mounted, loadListed, loadSeason, hidePop, listedToNumber, SLOTS, placed, _pos: () => posByPid };
}());
