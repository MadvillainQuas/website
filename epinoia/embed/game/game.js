'use strict';
/* ============================================================================
   embed/game - one game, as the modern box score: ?g=<game id>  (2026-10-07; it was a scoreboard card before)

   The scoreboard (crests, score, period and clock) over the game page's modern view: the five on each floor dealt
   onto a half court by their positions, the bench beneath, a tap or hover on a face for the full line
   (game/modern.js: courts(), mounted()). Live, the five are the ones on the floor now and move as subs land.

   FED LIKE THE EMBEDS: a finished game's log is one file from the CDN (snapshots/events/<id>.json, 0156), otherwise
   read once in pages; a live game is kept current by a delta read (the plays after the last one held, and the state
   row) every 15 s while the frame is seen, and at once when the database's frame on game:<id> (0157) says something
   moved - heard on rt.js's small socket. Hidden, it does nothing. The frame tells its host how tall it is.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG;
  const E = window.EpinoiaEngine, B = window.EpinoiaBox, MB = window.EpinoiaModernBox;
  const gameId = new URLSearchParams(location.search).get('g') || '';
  const POLL_MS = 15000;
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let game = null, maxSeq = 0, photos = {}, busy = false, timer = null;
  /* ONE CLUB AT A TIME: a two-button switch under the score shows one court and its bench, so the frame is half as tall.
     The choice is kept for this game in this browser (sessionStorage); a club's own site can open on its side (?side=1). */
  const SIDE_KEY = 'epinoia_ebox_side_' + gameId;
  let side = 0;
  try {
    const q = new URLSearchParams(location.search).get('side');
    const k = sessionStorage.getItem(SIDE_KEY);
    side = (k === '0' || k === '1') ? +k : (q === '1' ? 1 : 0);
  } catch (_) { /* private mode: the home side */ }

  window.S = null;
  window.derive = () => E.deriveGame(window.S);
  /* a player's card opens beside their face, never as a sheet at the foot of the (frame-tall) window: modern.js place() */
  window.EPINOIA_MV_NO_SHEET = true;
  /* Esc pressed in here (the reader's focus is in the frame after a tap) is the page's too: its cinema closes on it */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    try { if (parent !== window) parent.postMessage({ epinoiaEmbed: 'escape' }, '*'); } catch (_) { /* not framed */ }
  });

  async function api(p) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + p, { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  const rowToEvent = r => {
    const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock }, r.payload || {});
    if (r.team != null) e.team = r.team;
    if (r.pid != null) e.pid = r.pid;
    return e;
  };
  async function fileLog() {
    try {
      const r = await fetch(CFG.supabaseUrl + '/storage/v1/object/public/snapshots/events/' + encodeURIComponent(gameId) + '.json');
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.game === gameId && Array.isArray(j.rows) ? j.rows : null;
    } catch (_) { return null; }
  }
  async function readLog(after) {
    const out = [];
    for (let off = 0; off < 20000; off += 1000) {
      const page = await api('game_events?game_id=eq.' + encodeURIComponent(gameId) + (after ? '&seq=gt.' + after : '') +
        '&select=seq,t,team,pid,period,clock,payload&order=seq&limit=1000&offset=' + off);
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }

  /* the frame says how tall it is; a popover opening changes nothing (it floats) */
  let lastH = 0;
  function postHeight() {
    /* the body's own height: a player's card floats (position:fixed) and is not part of it */
    const h = Math.ceil(document.body.offsetHeight);
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    try { parent.postMessage({ epinoiaEmbed: 'height', height: h }, '*'); } catch (_) { /* not framed */ }
  }
  try { new ResizeObserver(postHeight).observe(document.body); } catch (_) { /* old browser: posted on each draw */ }

  /* FIT (?fit=1: under a video, on HOME and a league's pages): the whole box score in one screen. The host says how tall
     the screen is ({ epinoiaEmbed: 'fit', height }) and the court is drawn as large as fits in it (--court-w): beside its
     bench where the frame is wide enough, both clubs side by side where it is wider (game.css body.fit). Smaller than
     COURT_MIN the faces crowd each other: the frame is then a little taller than the screen. */
  const FIT = new URLSearchParams(location.search).get('fit') === '1';
  if (FIT) document.body.classList.add('fit');
  const COURT_MAX = 460, COURT_MIN = 280, COURT_RATIO = 1400 / 1500, BENCH_COL = 152;
  let fitH = 0, fitting = false;
  function fit() {
    if (!FIT || !fitH || fitting) return;
    const court = [...document.querySelectorAll('.mv-court')].find(c => c.offsetParent !== null);
    if (!court) return;
    fitting = true;
    const card = court.closest('.mv-card') || court.parentElement;
    const cs = getComputedStyle(card);
    const inner = card.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const beside = window.matchMedia && matchMedia('(min-width: 600px)').matches;
    const set = w => document.body.style.setProperty('--court-w', Math.round(w) + 'px');
    let w = Math.max(COURT_MIN, Math.min(COURT_MAX, inner - (beside ? BENCH_COL : 0)));
    set(w);
    /* smaller until it fits; a court whose bench is the taller side gains nothing by shrinking, and is left as it was */
    for (let i = 0; i < 5; i++) {
      const h = document.body.offsetHeight, over = h - fitH;
      if (over <= 1) break;
      const nw = Math.max(COURT_MIN, Math.floor(w - over / COURT_RATIO));
      if (nw >= w - 1) break;
      set(nw);
      if (document.body.offsetHeight >= h - 1) { set(w); break; }
      w = nw;
    }
    fitting = false;
    postHeight();
  }
  if (FIT) {
    window.addEventListener('message', ev => {
      if (ev.source !== window.parent || window.parent === window || !ev.data || ev.data.epinoiaEmbed !== 'fit') return;
      const h = Number(ev.data.height);
      if (!isFinite(h) || h < 200 || h > 4000 || Math.abs(h - fitH) < 2) return;
      fitH = h;
      fit();
    });
    let soon = null;
    window.addEventListener('resize', () => { clearTimeout(soon); soon = setTimeout(fit, 120); });
  }

  /* the full box score opens in the page on our own pages, in a tab on anybody else's (the same test as embed/game) */
  (function fullTarget() {
    let ours = false;
    try { ours = window.parent !== window && window.parent.location.origin === location.origin; } catch (_) { ours = false; }
    const a = document.getElementById('full');
    if (a) { a.target = ours ? '_top' : '_blank'; a.href = new URL('../../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase', location.href).href; }
  })();

  function colours() {
    const TC = window.EpinoiaTeamColour;
    const c0 = B.safeColour(S.teams[0].color, '#93f2bf'), c1 = B.safeColour(S.teams[1].color, '#8ff5ff');
    const k0 = (TC && TC.ink && TC.ink(c0)) || c0, k1 = (TC && TC.ink && TC.ink(c1)) || c1;
    const glow = (h, a) => { const m = String(h).replace('#', ''); return m.length !== 6 ? 'rgba(147,242,191,' + a + ')'
      : 'rgba(' + parseInt(m.slice(0, 2), 16) + ',' + parseInt(m.slice(2, 4), 16) + ',' + parseInt(m.slice(4, 6), 16) + ',' + a + ')'; };
    const r = document.documentElement.style;
    r.setProperty('--team0', k0); r.setProperty('--team1', k1);
    r.setProperty('--team0-glow', glow(k0, .4)); r.setProperty('--team1-glow', glow(k1, .4));
  }

  /* THE CLUBS' OWN COLOURS, as the game page wears them: a fed game's snapshot carries the kit's mint and cyan, so the
     club row wins; two clubs in one colour, and the away side wears its second */
  const HEX = /^#[0-9a-f]{6}$/i;
  function clubColour(i) {
    const h = HEX.test(String(game.home.colour || '')) ? game.home.colour : null;
    const a = HEX.test(String(game.away.colour || '')) ? game.away.colour : null;
    if (i === 0) return h;
    if (a && h && a.toLowerCase() === h.toLowerCase() && HEX.test(String(game.away.colour_2 || ''))) return game.away.colour_2;
    return a;
  }

  function crest(t) {
    const u = t && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(t.logo_path) : null;
    return '<span class="eb-crest">' + (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : esc(((t && (t.short_name || t.name)) || '?').slice(0, 3).toUpperCase())) + '</span>';
  }
  function head(d) {
    const live = game.status === 'live' || game.status === 'finalising', final = game.status === 'final';
    const hs = d ? d.score[0] : (game.home_score || 0), as = d ? d.score[1] : (game.away_score || 0);
    const F = d ? (d.format || E.formatOf(S)) : undefined;
    const clk = final ? 'FINAL' : live ? E.perName(S.period || 1, F).toUpperCase() + ' · ' + E.fmtClock(S.clockMs || 0)
      : game.tipoff_at ? new Date(game.tipoff_at).toLocaleString(document.documentElement.lang || 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    $('#head').innerHTML =
      '<div class="eb-side" translate="no">' + crest(game.home) + '<b class="' + (final && hs < as ? 'lose' : '') + '">' + esc(game.home.name) + '</b></div>' +
      '<div class="eb-mid"><div class="eb-sc">' + hs + '<i>–</i>' + as + '</div><div class="eb-clk' + (live ? ' live' : '') + '">' + esc(clk) + '</div></div>' +
      '<div class="eb-side away" translate="no">' + crest(game.away) + '<b class="' + (final && as < hs ? 'lose' : '') + '">' + esc(game.away.name) + '</b></div>';
  }

  function tabs() {
    const box = $('#sides');
    if (!box || !game) return;
    box.innerHTML = [game.home, game.away].map((t, i) =>
      '<button type="button" role="tab" aria-selected="' + (side === i) + '" data-side="' + i + '" style="--c:var(--team' + i + ')" translate="no">' +
      '<i></i>' + esc(t.short_name || t.name) + '</button>').join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#sides button[data-side]');
    if (!b) return;
    const n = +b.dataset.side;
    if (n === side) return;
    side = n;
    try { sessionStorage.setItem(SIDE_KEY, String(n)); } catch (_) { /* private mode */ }
    if (MB.hidePop) MB.hidePop();
    $('#host').dataset.side = String(n);
    tabs();
    fit();
    postHeight();
  });

  /* ---- THE GAME'S STORYLINES, for the host (?story=1: the drawer over a video, storyline.js) ----
     Worked out here from the replay this frame already holds - the same derive(), team ratings and BPM the box score
     prints - and posted to the page, so the drawer costs the database nothing: the frame's own 15 s read and its
     socket keep both current. Posted only when something in it changed. */
  const STORY = new URLSearchParams(location.search).get('story') === '1';
  let lastStory = '';
  const SCORE_PTS = { p2_made: 2, p3_made: 3, ft_made: 1 };
  function surname(n) {
    const w = String(n || '').trim().split(/\s+/).filter(Boolean);
    while (w.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w[w.length - 1])) w.pop();
    return w.length ? w[w.length - 1] : '';
  }
  function storyOf(d) {
    const F = d.format || E.formatOf(S);
    const per = (p, c) => E.perName(p || 1, F).toUpperCase() + ' ' + E.fmtClock(c || 0);
    const who = {};
    S.teams.forEach((t, side) => (t.players || []).forEach(p => { who[p.id] = { id: p.id, name: p.name, short: surname(p.name), num: p.num, side }; }));
    const line = (id, s) => Object.assign({}, who[id], { pts: s.pts || 0, reb: (s.or || 0) + (s.dr || 0), ast: s.ast || 0,
      fgm: (s.p2m || 0) + (s.p3m || 0), fga: (s.p2a || 0) + (s.p3a || 0), p3m: s.p3m || 0, p3a: s.p3a || 0, ftm: s.ftm || 0, fta: s.fta || 0,
      min: Math.round((s.min || 0) / 60000) });
    /* the leading scorers, three a side */
    const leaders = [0, 1].map(side => (S.teams[side].players || []).map(p => d.stats[p.id] ? line(p.id, d.stats[p.id]) : null)
      .filter(r => r && (r.pts > 0 || r.min > 0)).sort((a, b) => b.pts - a.pts || (b.fgm / Math.max(1, b.fga)) - (a.fgm / Math.max(1, a.fga))).slice(0, 3));
    /* the game's BPM from its box score (bpm.js game(): the box score's own estimate), five best with five minutes or more */
    let bpm = [];
    try {
      const BPM = window.EpinoiaBPM;
      if (BPM && BPM.game) {
        const lines = [];
        S.teams.forEach((t, side) => (t.players || []).forEach(p => { const s = d.stats[p.id]; if (s && s.min > 0) lines.push({ id: p.id, side, stats: s }); }));
        const m = BPM.game({ lines });
        bpm = lines.filter(l => l.stats.min >= 5 * 60000 && m.get(l.id) && isFinite(m.get(l.id).bpm))
          .map(l => Object.assign(line(l.id, l.stats), { bpm: Math.round(m.get(l.id).bpm * 10) / 10 }))
          .sort((a, b) => b.bpm - a.bpm).slice(0, 5);
      }
    } catch (_) { bpm = []; }
    /* the four factors and the shooting, per side */
    const ff = [], shoot = [];
    [0, 1].forEach(t => {
      try {
        /* the box score's own calculator (the advanced tab's); the engine's takes the game first */
        const A = B.teamAdv ? B.teamAdv(d, t) : E.teamAdv(S, d, t), T = A;
        ff.push({ efg: A.efg, tov: A.tovp, orb: A.orebp, ftr: A.ftr });
        shoot.push({ p2: [T.fgm - T.fg3m, T.fga - T.fg3a], p3: [T.fg3m, T.fg3a], ft: [T.ftm, T.fta], rim: T.rimA ? [T.rimM, T.rimA] : null });
      } catch (_) { ff.push(null); shoot.push(null); }
    });
    /* the flow: every basket in order - the margin over time, the runs (unanswered points), one player's streak */
    const pts = [[0, 0]], sc = [0, 0];
    let run = null, best = null, streak = null, bestStreak = null, changes = 0, prevLead = null;
    const lead = [0, 0];
    (S.events || []).forEach(e => {
      const v = SCORE_PTS[e.t];
      if (!v || e.team == null) return;
      sc[e.team] += v;
      const at = E.cumEl(e.period || 1, e.clock || 0, F);
      pts.push([Math.round(at / 1000), sc[0] - sc[1]]);
      if (run && run.side === e.team) { run.n += v; run.by[e.pid] = (run.by[e.pid] || 0) + v; }
      else run = { side: e.team, n: v, since: per(e.period, e.clock), from: Math.round(at / 1000), by: { [e.pid]: v } };
      if (!best || run.n > best.n) best = { side: run.side, n: run.n, since: run.since };
      if (streak && streak.pid === e.pid && e.pid) streak.n += v;
      else streak = { pid: e.pid, side: e.team, n: v, since: per(e.period, e.clock) };
      if (streak.pid && (!bestStreak || streak.n > bestStreak.n)) bestStreak = Object.assign({}, streak);
      const df = sc[0] - sc[1], ld = df > 0 ? 0 : df < 0 ? 1 : null;
      if (ld != null && prevLead != null && ld !== prevLead) changes++;
      if (ld != null) prevLead = ld;
      if (df > lead[0]) lead[0] = df;
      if (-df > lead[1]) lead[1] = -df;
    });
    const scorers = r => Object.keys(r.by).filter(id => who[id]).map(id => ({ short: who[id].short, pts: r.by[id] })).sort((a, b) => b.pts - a.pts);
    const regMs = Array.from({ length: (F && F.periods) || 4 }, (_, i) => E.PLEN(i + 1, F)).reduce((a, b) => a + b, 0);
    const nowAt = Math.round(E.cumEl(S.period || 1, S.clockMs || 0, F) / 1000);
    const live = game.status === 'live' || game.status === 'finalising';
    return {
      v: 1, game: gameId, status: game.status, live, score: d.score.slice(),
      when: game.status === 'final' ? 'FINAL' : live ? per(S.period, S.clockMs) : '',
      teams: [game.home, game.away].map((t, i) => ({ name: t.name, short: t.short_name || surname(t.name),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--team' + i).trim() || null,
        logo: t && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(t.logo_path) : null })),
      leaders, bpm, ff, shoot,
      run: run && run.n >= 6 ? { side: run.side, n: run.n, since: run.since, from: run.from, scorers: scorers(run) } : null,
      bestRun: best && best.n >= 6 ? best : null,
      streak: streak && streak.pid && who[streak.pid] && streak.n >= 6 ? { short: who[streak.pid].short, side: streak.side, n: streak.n, since: streak.since } : null,
      bestStreak: bestStreak && who[bestStreak.pid] && bestStreak.n >= 7 ? { short: who[bestStreak.pid].short, side: bestStreak.side, n: bestStreak.n } : null,
      flow: { pts, len: Math.max(Math.round(regMs / 1000), nowAt, pts.length ? pts[pts.length - 1][0] : 0), now: live ? nowAt : null, lead, changes }
    };
  }
  function postStory(d) {
    if (!STORY || !game || parent === window) return;
    let s;
    try {
      s = d ? storyOf(d) : { v: 1, game: gameId, status: game.status, empty: true, score: [game.home_score || 0, game.away_score || 0],
        teams: [game.home, game.away].map((t, i) => ({ name: t.name, short: t.short_name || surname(t.name),
          ink: getComputedStyle(document.documentElement).getPropertyValue('--team' + i).trim() || null })) };
    } catch (_) { return; }
    const k = JSON.stringify(s);
    if (k === lastStory) return;
    lastStory = k;
    try { parent.postMessage({ epinoiaEmbed: 'story', story: s }, location.origin); } catch (_) { /* not ours */ }
  }

  function draw() {
    const d = S.events.length ? window.derive() : null;
    if (d) postStory(d);
    head(d);
    tabs();
    const host = $('#host');
    host.dataset.side = String(side);
    if (!d) { postStory(null); host.innerHTML = '<div class="eb-empty">The courts fill in from the first play.</div>'; return postHeight(); }
    host.innerHTML = MB.courts(d);
    MB.mounted(host);
    faces(host);
    fit();
    postHeight();
  }

  /* the players' photographs on their faces, asked once per game (as the game page does) */
  let photosAsked = false;
  async function faces(host) {
    const ids = [...new Set([...host.querySelectorAll('.mv-p[data-pid]')].map(e => e.dataset.pid).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!photosAsked && ids.length) {
      photosAsked = true;
      try {
        for (let i = 0; i < ids.length; i += 40) {
          const rows = await api('media?owner_type=eq.player&kind=eq.photo&status=eq.approved&owner_id=in.(' + ids.slice(i, i + 40).join(',') +
            ')&select=owner_id,storage_path&order=created_at.desc');
          rows.forEach(m => { if (!photos[m.owner_id]) photos[m.owner_id] = CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + m.storage_path; });
        }
      } catch (_) { /* silhouettes stay */ }
    }
    host.querySelectorAll('.mv-p[data-pid]').forEach(e => {
      const url = photos[e.dataset.pid];
      const face = e.querySelector('.sq-face');
      if (!url || !face || face.querySelector('img')) return;
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('load', () => face.classList.add('has-img'));
      img.addEventListener('error', () => img.remove());
      face.appendChild(img);
    });
  }

  async function delta() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const [rows, st, g] = await Promise.all([readLog(maxSeq),
        api('game_state?game_id=eq.' + encodeURIComponent(gameId) + '&select=period,clock_ms,score_home,score_away').then(r => r[0] || null).catch(() => null),
        api('games?id=eq.' + encodeURIComponent(gameId) + '&select=status,home_score,away_score,roster_snapshot,starters&limit=1').then(r => r[0] || null).catch(() => null)]);
      if (g) {
        Object.assign(game, { status: g.status, home_score: g.home_score, away_score: g.away_score });
        if (g.roster_snapshot && g.roster_snapshot.teams) S.teams = g.roster_snapshot.teams.map((t, i) => Object.assign({}, t, { color: (S.teams[i] || {}).color || t.color }));
        if (g.starters) S.starters = g.starters;
        S.status = g.status; S.phase = g.status === 'final' ? 'final' : 'game';
      }
      if (rows.length) {
        const seen = new Set(S.events.map(e => e.id));
        rows.forEach(r => { const e = rowToEvent(r); if (!seen.has(e.id)) S.events.push(e); maxSeq = Math.max(maxSeq, r.seq || 0); });
        S.events.sort((a, b) => a.id - b.id);
      }
      if (st) { S.period = st.period || S.period; S.clockMs = st.clock_ms || 0; }
      draw();
      if (game.status === 'final') clearInterval(timer);
    } catch (_) { /* the next beat */ }
    busy = false;
  }

  async function boot() {
    if (!gameId || !E || !B || !MB) { $('#host').innerHTML = '<div class="eb-empty">No game.</div>'; return postHeight(); }
    const gs = await api('games?id=eq.' + encodeURIComponent(gameId) +
      '&select=id,status,period,tipoff_at,home_score,away_score,roster_snapshot,starters,tip_winner,arrow_init,competition_id,home_team_id,away_team_id,' +
      'home:home_team_id(name,short_name,colour,colour_2,logo_path),away:away_team_id(name,short_name,colour,colour_2,logo_path),' +
      'competitions(name,seasons(leagues(slug,name))),game_state(period,clock_ms)&limit=1');
    if (!gs.length) { $('#host').innerHTML = '<div class="eb-empty">Game not found.</div>'; return postHeight(); }
    game = gs[0];
    const st = Array.isArray(game.game_state) ? game.game_state[0] : game.game_state;
    let rows = game.status === 'final' ? await fileLog() : null;
    if (!rows) rows = await readLog(0).catch(() => []);
    maxSeq = rows.reduce((m, r) => Math.max(m, r.seq || 0), 0);
    const snap = game.roster_snapshot;
    const lg = (((game.competitions || {}).seasons || {}).leagues) || {};
    window.S = {
      teams: ((snap && snap.teams) || [{ name: game.home.name, players: [] }, { name: game.away.name, players: [] }])
        .map((t, i) => Object.assign({}, t, { color: clubColour(i) || t.color })),
      starters: game.starters || [[], []], events: rows.map(rowToEvent),
      period: (st && st.period) || game.period || 1, clockMs: (st && st.clock_ms) || 0,
      tipWinner: game.tip_winner, arrowInit: game.arrow_init,
      phase: game.status === 'final' ? 'final' : 'game', status: game.status, leagueSlug: lg.slug || null,
      meta: { homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, competitionId: game.competition_id, status: game.status }
    };
    if (B.rebuildPmap) try { B.rebuildPmap(); } catch (_) { /* the box score's own index */ }
    colours();
    draw();
    /* the clubs' listed positions steer where each player stands, as on the game page */
    MB.loadListed(api, S).then(ok => { if (ok) draw(); }).catch(() => {});
    if (game.status !== 'final') {
      timer = setInterval(delta, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) delta(); });
      if (window.EpinoiaRT) {
        try {
          const rt = window.EpinoiaRT.create({ url: CFG.supabaseUrl, key: CFG.supabaseAnonKey });
          let soon = null;
          rt.watch('game:' + gameId, () => { clearTimeout(soon); soon = setTimeout(delta, 400); });
        } catch (_) { /* the poll keeps it current */ }
      }
    }
  }
  boot().catch(() => { $('#host').innerHTML = '<div class="eb-empty">This game could not be read.</div>'; postHeight(); });
})();
