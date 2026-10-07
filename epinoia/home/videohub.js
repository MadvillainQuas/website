'use strict';
/* ============================================================================
   HOME - THE VIDEO VIEW (opened by vhmode.js, the MAIN | VIDEO strip). Black, whatever the page's own light or dark.

   LIVE, on top: every game streaming now, in any league (live_streams, 0242: a game's own video - a broadcast the ingest
   found, or a channel's video the matcher put on the game - or else its league's channel, live). A row of the games;
   the chosen one in a THEATRE: the stream (nothing of YouTube until play is pressed), a scorebug under it, the game's
   modern box score (its embed, dark) and, where the league has it open, the game's chat beside it. FULL SCREEN puts the
   whole theatre - stream, scorebug and chat - on the screen. Read again every minute while the view is open and seen.
   With nothing live, a test card says so.

   LATEST VIDEOS, under it: the newest videos of every league, the ones from what the reader follows first, each part
   in the feed's own order (feedrank.js: their reading, the highlights of a game first, a series as its newest episode);
   ALL, HIGHLIGHTS or VIDEOS. A tile opens the cinema player as a playlist (media.js stagePlayer): Up next beside it,
   Back and Next, the next one playing when one ends.

   While a video or a stream plays, the page around it goes dark (media.js cinema). close() takes everything down: the
   players stop, the chat and the reads end.
   ============================================================================ */
(function () {
  const STEP = 10;                      // the newest large, then three rows of three
  const LIVE_EVERY = 60000;
  let S = null;                         // the open view's state

  const cfg = () => window.EPINOIA_CONFIG || {};
  function rpc(name, body, token) {
    const c = cfg();
    return fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST', cache: 'no-store',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + (token || c.supabaseAnonKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}) }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  function script(src, global) {
    if (window[global]) return Promise.resolve(window[global]);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => res(window[global]); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const stamp = () => (/[?&]v=(\d+)/.exec(((document.querySelector('script[src*="videohub.js"]') || {}).src) || '') || [])[1] || '';
  const withStamp = p => p + (stamp() ? '?v=' + stamp() : '');

  async function open(host, opts) {
    close();
    const base = (opts && opts.base) || '../';
    const M = await script(withStamp(base + 'media.js'), 'EpinoiaMedia');
    M.css('kit/media.css');
    const el = M.el, tr = M.tr;
    const st = S = { host, M, timers: [], chat: null, boxer: null, sp: null, alive: true };
    host.textContent = '';
    const wrap = el('div', 'vh-wrap');

    /* ------------------------------------------------------------------------------------------- LIVE --- */
    const live = el('section', 'vh-sec vh-live');
    live.setAttribute('aria-labelledby', 'vhLiveH');
    const lh = el('header', 'vh-h');
    const lt = el('h2', 'vh-t'); lt.id = 'vhLiveH';
    lt.append(el('span', 'vh-dot'), document.createTextNode(tr('Live')));
    const lsub = el('span', 'vh-sub', tr('Every game streaming now'));
    const full = el('button', 'vh-full', tr('Full screen'));
    full.type = 'button'; full.hidden = true;
    const wideB = M.wideButton();
    lh.append(lt, lsub, wideB, full);
    const gamesRow = el('div', 'vh-games');
    gamesRow.setAttribute('role', 'tablist');
    gamesRow.setAttribute('aria-label', tr('Games streaming now'));
    const theatre = el('div', 'vh-theatre');
    theatre.hidden = true;
    theatre.dataset.mdWide = 'auto';     // a stream playing: the menu slides away (media.js wide)
    const tMain = el('div', 'vh-tmain');
    const screen = el('div', 'vh-screen');
    const bug = el('div', 'vh-bug');
    const box = el('div', 'vh-box');
    tMain.append(screen, bug, box);
    const side = el('aside', 'vh-chat');
    theatre.append(tMain, side);
    const none = el('div', 'vh-none');
    none.hidden = true;
    none.innerHTML = '<div class="vh-bars" aria-hidden="true"></div><div class="vh-none-t"><b></b><span></span></div>';
    none.querySelector('b').textContent = tr('Nothing live right now');
    none.querySelector('span').textContent = tr('Games appear here the moment their stream goes live.');
    live.append(lh, gamesRow, theatre, none);

    let games = [], chosen = null;
    const abbr = t => M.abbr(t);
    function scoreOf(g) { return g.home_score != null && g.away_score != null ? [g.home_score, g.away_score] : null; }
    function card(g) {
      const b = el('button', 'vh-game');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(!!chosen && chosen.id === g.id));
      M.inks(b, { game: g }, true);
      const lg = el('span', 'vh-game-lg', (g.league && g.league.name) || '');
      const row = el('span', 'vh-game-r');
      const sc = scoreOf(g);
      const side1 = el('span', 'vh-game-s');
      side1.append(M.crest(g.home), el('b', null, abbr(g.home)));
      const side2 = el('span', 'vh-game-s a');
      side2.append(el('b', null, abbr(g.away)), M.crest(g.away));
      row.append(side1, el('span', 'vh-game-sc', sc ? sc[0] + ' – ' + sc[1] : tr('VS')), side2);
      const st = el('span', 'vh-game-st');
      st.append(el('i'), document.createTextNode(g.status === 'finalising' ? tr('Final minutes') : tr('Live')));
      b.append(lg, row, st);
      b.addEventListener('click', () => { if (!chosen || chosen.id !== g.id) { chosen = g; drawGames(); enter(g); } });
      return b;
    }
    function drawGames() {
      gamesRow.textContent = '';
      games.forEach(g => gamesRow.appendChild(card(g)));
      gamesRow.hidden = !games.length;
    }
    function drawBug(g) {
      bug.textContent = '';
      M.inks(bug, { game: g }, true);
      const sc = scoreOf(g);
      const h = el('span', 'vh-bug-s');
      h.append(M.crest(g.home), el('b', null, g.home.name || abbr(g.home)));
      const a = el('span', 'vh-bug-s a');
      a.append(el('b', null, g.away.name || abbr(g.away)), M.crest(g.away));
      const mid = el('span', 'vh-bug-sc');
      if (sc) mid.append(el('span', sc[0] >= sc[1] ? 'w' : 'l', String(sc[0])), el('i', null, '–'), el('span', sc[1] >= sc[0] ? 'w' : 'l', String(sc[1])));
      else mid.textContent = tr('VS');
      const lgx = el('span', 'vh-bug-lg');
      lgx.append(el('i'), document.createTextNode(((g.league && g.league.name) || '') + (g.competition ? ' · ' + g.competition : '')));
      bug.append(h, mid, a, lgx);
    }
    /* the stream: the game's own video (YouTube: its cover until play), or its league's channel, live */
    function stream(g) {
      screen.textContent = '';
      screen.className = 'vh-screen';
      const v = g.video, ch = g.channel;
      const yt = v && v.provider === 'youtube' && /^[A-Za-z0-9_-]{6,20}$/.test(v.ref || '') ? v.ref : null;
      if (yt) return M.player(screen, { id: yt, title: g.home.name + ' v ' + g.away.name, group: theatre });
      if (ch && ch.ref && (ch.platform === 'youtube' || ch.platform === 'twitch')) {
        screen.classList.add('md-player');
        const b = el('button', 'vh-cover');
        b.type = 'button';
        b.setAttribute('aria-label', tr('Watch the live stream'));
        b.append(el('span', 'md-play'), el('span', 'vh-cover-t', (ch.platform === 'twitch' ? 'Twitch' : 'YouTube') + ' · ' + tr('Live')));
        b.addEventListener('click', () => {
          M.playFrame(b, ch.platform === 'youtube'
            ? 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + encodeURIComponent(ch.ref) + '&autoplay=1&rel=0&playsinline=1'
            : 'https://player.twitch.tv/?channel=' + encodeURIComponent(ch.ref) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=true',
            tr('Live stream'), theatre);
        }, { once: true });
        screen.appendChild(b);
      }
    }
    async function enter(g) {
      M.cineExit(true);
      if (st.chat) { try { st.chat.stop(); } catch (_) { /* gone */ } st.chat = null; }
      if (st.boxer) { st.boxer.stop(); st.boxer = null; }
      theatre.hidden = false;
      full.hidden = !(theatre.requestFullscreen || theatre.webkitRequestFullscreen);
      M.inks(theatre, { game: g }, true);
      stream(g);
      drawBug(g);
      box.textContent = '';
      st.boxer = M.embedGame(box, g.id, { theme: 'dark' });
      side.textContent = '';
      side.hidden = !g.chat;
      theatre.classList.toggle('no-chat', !g.chat);
      if (g.chat) {
        try {
          const C = await script(withStamp(base + 'gamechat.js'), 'EpinoiaGameChat');
          if (st.alive && chosen && chosen.id === g.id && C) st.chat = C.mount(side, g.id, { base });
        } catch (_) { side.hidden = true; theatre.classList.add('no-chat'); }
      }
    }
    async function readLive(first) {
      const list = await rpc('live_streams', {});
      if (!st.alive) return;
      games = Array.isArray(list) ? list.filter(g => g && g.id && g.home && g.away) : [];
      try { if (window.EpinoiaHomeModes && window.EpinoiaHomeModes.setLive) window.EpinoiaHomeModes.setLive(games.length); } catch (_) { /* the strip's own */ }
      lsub.textContent = games.length ? (games.length === 1 ? tr('1 game streaming now') : games.length + ' ' + tr('games streaming now')) : tr('Every game streaming now');
      none.hidden = !!games.length;
      live.classList.toggle('is-on', !!games.length);
      if (!games.length) { gamesRow.textContent = ''; return; }
      const keep = chosen && games.find(g => g.id === chosen.id);
      if (keep) { chosen = keep; drawGames(); drawBug(keep); }
      else if (first || !chosen) { chosen = games[0]; drawGames(); enter(chosen); }
      else drawGames();
    }
    full.addEventListener('click', () => {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      (theatre.requestFullscreen || theatre.webkitRequestFullscreen).call(theatre);
    });
    const onFs = () => { full.textContent = (document.fullscreenElement === theatre) ? tr('Exit full screen') : tr('Full screen'); };
    document.addEventListener('fullscreenchange', onFs);
    st.timers.push(() => document.removeEventListener('fullscreenchange', onFs));

    /* --------------------------------------------------------------------------------------- VIDEOS --- */
    const vids = el('section', 'vh-sec vh-vids');
    vids.setAttribute('aria-labelledby', 'vhVidsH');
    const vh = el('header', 'vh-h');
    const vt = el('h2', 'vh-t', tr('Latest videos'));
    vt.id = 'vhVidsH';
    const vsub = el('span', 'vh-sub', tr('From what you follow first, then in your feed’s order'));
    const seg = el('div', 'md-seg');
    seg.setAttribute('role', 'group');
    vh.append(vt, vsub, seg);
    const stage = el('section', 'md-stage');
    stage.hidden = true;
    stage.setAttribute('aria-label', tr('Now playing'));
    const grid = el('div', 'md-grid has-hero');
    const more = el('button', 'ep-btn md-more', tr('Show more'));
    more.type = 'button'; more.hidden = true;
    vids.append(vh, stage, grid, more);
    wrap.append(live, vids);
    host.appendChild(wrap);

    let kind = null, rows = [], shown = STEP, playing = null;
    const R = () => window.EpinoiaFeedRank;
    st.sp = M.stagePlayer(stage, {
      dark: true,
      list: () => rows,
      onClose: () => { playing = null; paint(); },
      onChange: it => {
        playing = it;
        paint();
        try { const F = R(); if (F && typeof F.opened === 'function') F.opened(it); } catch (_) { /* never in the way */ }
      }
    });
    [['All', null], ['Highlights', 'highlights'], ['Videos', 'video']].forEach(([label, k]) => {
      const b = el('button', 'md-chip', tr(label));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(k === kind));
      b.addEventListener('click', () => {
        if (k === kind) return;
        kind = k;
        seg.querySelectorAll('.md-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        loadVideos();
      });
      seg.appendChild(b);
    });
    /* WHAT IS SHOWN: the reader's follows first, then everything else, each in the feed's own order */
    async function read() {
      const F = window.EpinoiaFollow, s = F && F.session ? F.session() : null;
      const [all, mine] = await Promise.all([rpc('video_feed', { p_kind: kind, p_limit: 60 }),
        s && s.token ? rpc('video_feed_mine', { p_kind: kind, p_limit: 60 }, s.token) : Promise.resolve(null)]);
      if (!all) return [];
      const pool = M.uniq((mine || []).concat(all));
      const FR = R();
      let ranked = pool;
      if (FR && typeof FR.rankRows === 'function') {
        try { ranked = (await FR.rankRows(pool, { followedIds: (mine || []).map(r => r.id) })).rows; } catch (_) { /* newest first */ }
      }
      const followed = new Set((mine || []).map(r => r.id));
      const lead = ranked.filter(r => followed.has(r.id)), rest = ranked.filter(r => !followed.has(r.id));
      const order = kind ? lead.concat(rest) : M.prioritise(lead).concat(M.prioritise(rest));
      return FR && typeof FR.latestEpisodes === 'function' ? FR.latestEpisodes(order) : order;
    }
    function paint() {
      grid.textContent = '';
      if (!rows.length) { grid.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : 'No videos yet.'))); more.hidden = true; return; }
      rows.slice(0, shown).forEach((it, i) => {
        const t = M.tile(it, x => st.sp.go(x), i === 0, { no: i + 1, of: rows.length, dark: true });
        if (playing && playing.id === it.id) t.setAttribute('aria-current', 'true');
        grid.appendChild(t);
      });
      more.hidden = rows.length <= shown;
    }
    async function loadVideos() {
      grid.textContent = '';
      for (let i = 0; i < 7; i++) grid.appendChild(el('div', 'md-skel'));
      const got = await read();
      if (!st.alive) return;
      rows = got; shown = STEP;
      paint();
    }
    more.addEventListener('click', () => { shown += STEP - 1; paint(); });

    await Promise.all([readLive(true), loadVideos()]);
    /* LIVE again every minute, while the view is open and seen */
    const iv = setInterval(() => { if (!document.hidden && st.alive) readLive(false); }, LIVE_EVERY);
    st.timers.push(() => clearInterval(iv));
  }

  function close() {
    const st = S;
    S = null;
    if (!st) return;
    st.alive = false;
    try { st.M.cineExit(true); st.M.wideReset(); } catch (_) { /* nothing */ }
    try { if (st.sp) st.sp.stop(); } catch (_) { /* nothing */ }
    try { if (st.chat) st.chat.stop(); } catch (_) { /* nothing */ }
    try { if (st.boxer) st.boxer.stop(); } catch (_) { /* nothing */ }
    st.timers.forEach(f => { try { f(); } catch (_) { /* nothing */ } });
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { /* nothing */ }
    if (st.host) st.host.textContent = '';
  }

  window.EpinoiaVideoHub = { open, close };
})();
