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
    postHeight();
  });

  function draw() {
    const d = S.events.length ? window.derive() : null;
    head(d);
    tabs();
    const host = $('#host');
    host.dataset.side = String(side);
    if (!d) { host.innerHTML = '<div class="eb-empty">The courts fill in from the first play.</div>'; return postHeight(); }
    host.innerHTML = MB.courts(d);
    MB.mounted(host);
    faces(host);
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
