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

   A CLUB'S VERSION (opts.team = { id, slug, name }: the club page's Video tab, t/team.js): LIVE only while the club is
   playing (and not there at all when it is not), and under it the club's own videos (0248 team_videos: its games'
   highlights, full games and press conferences, the videos naming it), under the same five buttons, newest first;
   no leagues' strip, no follows.
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
    const team = opts && opts.team && opts.team.id ? opts.team : null;
    const isTeam = g => !!team && [g.home, g.away].some(t => t && team.slug && t.slug === team.slug);
    /* THE PLATFORM'S VISIT COUNTS (track.js action): what is done here, as keys - on HOME's VIDEO view ('home/video') or the
       club page's Video tab ('t') - with the league and game it was about. Anonymous, and never in the way. */
    const act = (k, o) => { try { const T = window.EpinoiaTrack; if (T && T.action) T.action(k, o); } catch (_) { /* no count */ } };
    const about = g => ({ game: g && g.id, league: g && g.league && g.league.slug });
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
    /* LANDSCAPE, a phone's (kit/videohub.css shows it there alone): the theatre across the whole screen, on its side.
       A tab hanging from the foot of the stream, beside BOX SCORE - inside the theatre, so it stays lit and can be
       pressed while the stream plays (in the header it was under cinema mode's veil the moment play was pressed) */
    /* ON A DESKTOP THE SAME TAB IS FULL SCREEN: the stream and the column beside it over the whole screen (the same mode,
       unturned) - pressable while the stream plays, where the header's button is under the veil */
    const landB = el('button', 'md-cue vh-landcue');
    landB.type = 'button'; landB.hidden = true;
    landB.innerHTML = '<svg class="ph" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="9" width="19" height="11.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/>'
      + '<path d="M6.5 6.2a8 8 0 0 1 10.6-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M17.6 1.6v3.6H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '<svg class="dk" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    landB.append(el('span', 'vh-landcue-t ph', tr('Landscape')), el('span', 'vh-landcue-t dk', tr('Full screen')));
    const phone = () => !!(window.matchMedia && matchMedia('(max-width: 719px), (max-height: 500px) and (orientation: landscape)').matches);
    const landLabel = () => { const t = tr(phone() ? 'Landscape view' : 'Full screen: the stream and the column beside it'); landB.setAttribute('aria-label', t); landB.title = t; };
    landLabel();
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
    /* the arrow down to the box score, hanging from the foot of the stream (media.js boxCue); the box score itself
       across the whole theatre under the stream and the chat, where it has the room to fit the screen */
    const cueBar = M.boxCue ? M.boxCue(box) : el('div', 'md-cuebar');
    cueBar.appendChild(landB);
    tMain.append(screen, bug, cueBar);
    const side = el('aside', 'vh-chat');
    /* the stream and the chat a row of their own, so the chat stays beside the stream as the page scrolls and stops
       there: it never rides over the box score under them */
    const tTop = el('div', 'vh-ttop');
    tTop.append(tMain, side);
    /* THE TEAM BOARD (storyline.js board): on a desktop, when the box score has gone into the column beside the stream,
       the room under the stream holds the team side of the story - four factors with their margins, the shooting, the
       game's flow */
    const statsEl = el('section', 'vh-stats');
    statsEl.setAttribute('aria-label', tr('Team stats'));
    /* and on a phone, at the box score's foot, the arrow back up to the stream (media.js upCue) */
    theatre.append(tTop, box, statsEl, M.upCue ? M.upCue(tMain) : el('div'));
    /* LANDSCAPE's own head, over the column beside the stream: CHAT | BOX SCORE, and the way out */
    const landTabs = el('div', 'vh-landtabs');
    landTabs.setAttribute('role', 'group');
    landTabs.setAttribute('aria-label', tr('Beside the stream'));
    const tabChat = el('button', 'vh-landtab', tr('Chat'));
    const tabBox = el('button', 'vh-landtab', tr('Box score'));
    /* VIDEO ONLY: the column folds away and the stream takes the whole screen; two small buttons over its corner bring
       the column back or leave */
    const landHide = el('button', 'vh-landhide');
    landHide.setAttribute('aria-label', tr('Video only'));
    landHide.title = tr('Video only');
    const landX = el('button', 'vh-landx');
    landX.setAttribute('aria-label', tr('Leave landscape'));
    landX.title = tr('Leave landscape');
    landTabs.append(tabChat, tabBox, landHide, landX);
    const landFloat = el('div', 'vh-landfloat');
    const landShow = el('button', 'vh-landshow', tr('Chat · Box score'));
    landShow.setAttribute('aria-label', tr('Show the chat and the box score'));
    const landX2 = el('button', 'vh-landx');
    landX2.setAttribute('aria-label', tr('Leave landscape'));
    landX2.title = tr('Leave landscape');
    landFloat.append(landShow, landX2);
    [tabChat, tabBox, landHide, landX, landShow, landX2].forEach(b => { b.type = 'button'; });
    theatre.append(landTabs, landFloat);
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
      b.addEventListener('click', () => { if (!chosen || chosen.id !== g.id) { chosen = g; drawGames(); enter(g); act('live-game', about(g)); } });
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
    /* THE STORYLINES, a drawer at the foot of the stream (storyline.js): a lip at rest, up on a resting pointer or a press */
    async function mountDeck(g) {
      if (st.deck) { try { st.deck.stop(); } catch (_) { /* gone */ } st.deck = null; }
      if (st.board) { try { st.board.stop(); } catch (_) { /* gone */ } st.board = null; }
      st.deckFor = g.id;
      landLabel();
      if (!st.story || st.story.game !== g.id) st.story = null;
      try {
        M.css('kit/storyline.css');
        const SL = await M.load('storyline.js', 'EpinoiaStoryline');
        if (!st.alive || !SL || !chosen || chosen.id !== g.id || st.deckFor !== g.id) return;
        st.deck = SL.mount(screen, { tr });
        if (SL.board) st.board = SL.board(statsEl, { tr });
        if (st.story) { st.deck.update(st.story); if (st.board) st.board.update(st.story); }
      } catch (_) { /* no drawer: the stream as it was */ }
    }
    async function enter(g) {
      M.cineExit(true);
      if (st.chat) { try { st.chat.stop(); } catch (_) { /* gone */ } st.chat = null; }
      if (st.boxer) { st.boxer.stop(); st.boxer = null; }
      theatre.hidden = false;
      full.hidden = !(theatre.requestFullscreen || theatre.webkitRequestFullscreen);
      landB.hidden = false;
      tabChat.hidden = !g.chat;
      /* the column beside the stream holds the CHAT or the BOX SCORE (a desktop's, and landscape's): a game with no chat
         has the box score there */
      panel(g.chat ? landPanel : 'box');
      M.inks(theatre, { game: g }, true);
      stream(g);
      drawBug(g);
      mountDeck(g);
      box.textContent = '';
      /* the box score frame works the game's storylines out from what it holds, for the drawer over the stream */
      st.boxer = M.embedGame(box, g.id, { theme: 'dark', fit: true, story: s => {
        if (!s || s.game !== g.id) return;
        st.story = s;
        if (st.deck && st.deckFor === g.id) st.deck.update(s);
        if (st.board && st.deckFor === g.id) st.board.update(s);
      } });
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
      games = Array.isArray(list) ? list.filter(g => g && g.id && g.home && g.away && (!team || isTeam(g))) : [];
      /* the club's version: LIVE is there only while the club is playing */
      if (team) live.hidden = !games.length;
      else try { if (window.EpinoiaHomeModes && window.EpinoiaHomeModes.setLive) window.EpinoiaHomeModes.setLive(games.length); } catch (_) { /* the strip's own */ }
      lsub.textContent = games.length ? (games.length === 1 ? tr('1 game streaming now') : games.length + ' ' + tr('games streaming now')) : tr('Every game streaming now');
      none.hidden = !!games.length;
      live.classList.toggle('is-on', !!games.length);
      if (!games.length) { gamesRow.textContent = ''; return; }
      const keep = chosen && games.find(g => g.id === chosen.id);
      if (keep) { chosen = keep; drawGames(); drawBug(keep); }
      else if (first || !chosen) { chosen = games[0]; drawGames(); enter(chosen); }
      else drawGames();
    }
    /* FULL SCREEN is the one full screen: the stream and the column beside it (landOn), as the tab under the stream */
    full.addEventListener('click', () => {
      if (land) { landOff(); return; }
      landOn();
      act('live-fullscreen', about(chosen));
    });
    /* a stream started: the first press on the screen of each game chosen (YouTube's cover, a channel's) */
    let liveStarted = null;
    screen.addEventListener('click', () => {
      if (chosen && liveStarted !== chosen.id) { liveStarted = chosen.id; act('live-play', about(chosen)); }
    }, true);
    const onFs = () => {
      full.textContent = land ? tr('Exit full screen') : tr('Full screen');
      /* full screen left by the phone's own back gesture: landscape goes with it */
      if (land && landFs && !(document.fullscreenElement || document.webkitFullscreenElement)) landOff();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    st.timers.push(() => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); });

    /* LANDSCAPE, ON A PHONE. Held upright, the stream was a strip across the top with the chat and the box score far
       below it. A press puts the theatre over the whole screen on its side: the stream as big as the screen allows
       with the score under it, and beside it one column - the CHAT or the BOX SCORE, a press between them - which
       folds away (VIDEO ONLY) for the stream alone.
         * THE PAGE goes full screen, not the theatre: the browser's bars go, and the theatre inside it can still be
           turned (a full-screen element itself cannot be: the browser holds it to transform: none). Then the screen is
           locked to landscape where the browser allows it (Android's Chrome).
         * Where the lock is refused (Samsung Internet, 2026-10-07) or there is no full screen (an iPhone), the theatre
           turns itself a quarter (.rot) while the phone is held upright, and stops the moment the phone is turned.
       The way out: the ✕, Escape, or leaving full screen. */
    const SIDE_KEY = 'epinoia.vh.side';
    let land = false, landFs = false, landPanel = (() => { try { return localStorage.getItem(SIDE_KEY) === 'box' ? 'box' : 'chat'; } catch (_) { return 'chat'; } })();
    function panel(p) {                           // what shows; landPanel is the reader's own choice, kept for a game with a chat
      theatre.classList.toggle('land-box', p === 'box');
      tabChat.setAttribute('aria-pressed', String(p === 'chat'));
      tabBox.setAttribute('aria-pressed', String(p === 'box'));
    }
    function videoOnly(on) {
      theatre.classList.toggle('land-wide', !!on);
      try { (on ? landShow : landHide).focus({ preventScroll: true }); } catch (_) { /* an old browser */ }
    }
    function landTurn() {
      if (!land) return;
      theatre.classList.toggle('rot', window.innerHeight > window.innerWidth);
    }
    function onLandKey(e) { if (e.key === 'Escape') landOff(); }
    /* A FIXED THEATRE IS ONLY FIXED TO THE SCREEN when nothing above it holds it. The LIVE section is one of haze.js's
       blocks: a scroll-driven animation moves it (and fades it) as it comes and goes, and a transform - like a filter,
       containment or a z-index - makes an ancestor the box a fixed element is placed in: the theatre sat inside the
       section, under the videos, not over the screen. Whether the section is mid-animation depends on where the page
       was, so while landscape is on EVERY ancestor lets go (.vh-land-free: no animation, transform, filter, containment
       or stacking, full opacity); moving the theatre out of the page instead would reload the stream. */
    function free(on) {
      if (!on) { document.querySelectorAll('.vh-land-free').forEach(e => e.classList.remove('vh-land-free')); return; }
      for (let e = theatre.parentElement; e && e !== document.documentElement; e = e.parentElement) e.classList.add('vh-land-free');
    }
    async function landOn() {
      if (land) return;
      land = true; landFs = false;
      full.textContent = tr('Exit full screen');
      free(true);
      theatre.classList.add('vh-land', 'md-land');
      document.documentElement.classList.add('vh-land-on');
      panel(chosen && chosen.chat ? landPanel : 'box');
      landTurn();
      window.addEventListener('resize', landTurn);
      document.addEventListener('keydown', onLandKey);
      const root = document.documentElement;
      try {
        const rq = root.requestFullscreen || root.webkitRequestFullscreen;
        if (rq && !(document.fullscreenElement || document.webkitFullscreenElement)) { await rq.call(root, { navigationUI: 'hide' }); landFs = true; }
      } catch (_) { /* no full screen for a page (an iPhone): the browser's bars stay */ }
      try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') await screen.orientation.lock('landscape');
      } catch (_) { /* no lock: the theatre turns itself while the phone is upright */ }
      landTurn();
      try { landX.focus({ preventScroll: true }); } catch (_) { /* an old browser */ }
    }
    function landOff() {
      if (!land) return;
      land = false;
      full.textContent = tr('Full screen');
      theatre.classList.remove('vh-land', 'md-land', 'rot', 'land-wide');
      document.documentElement.classList.remove('vh-land-on');
      free(false);
      window.removeEventListener('resize', landTurn);
      document.removeEventListener('keydown', onLandKey);
      try { if (screen.orientation && typeof screen.orientation.unlock === 'function') screen.orientation.unlock(); } catch (_) { /* never locked */ }
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (landFs && fs === document.documentElement) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* gone */ } }
      landFs = false;
      try { landB.focus({ preventScroll: true }); } catch (_) { /* an old browser */ }
    }
    landB.addEventListener('click', landOn);
    landX.addEventListener('click', landOff);
    landX2.addEventListener('click', landOff);
    landHide.addEventListener('click', () => videoOnly(true));
    landShow.addEventListener('click', () => videoOnly(false));
    const choose = p => { landPanel = p; panel(p); try { localStorage.setItem(SIDE_KEY, p); } catch (_) { /* private mode */ } };
    tabChat.addEventListener('click', () => choose('chat'));
    tabBox.addEventListener('click', () => choose('box'));
    st.timers.push(() => landOff());

    /* --------------------------------------------------------------------------------------- VIDEOS --- */
    const vids = el('section', 'vh-sec vh-vids');
    vids.setAttribute('aria-labelledby', 'vhVidsH');
    const vh = el('header', 'vh-h');
    const vt = el('h2', 'vh-t', tr(team ? 'Videos' : 'Latest videos'));
    vt.id = 'vhVidsH';
    const vsub = el('span', 'vh-sub', team ? (team.name || '') + ' · ' + tr('highlights, full games, press conferences and more, newest first')
      : tr('From what you follow first, then in your feed’s order'));
    const seg = el('div', 'md-seg');
    seg.setAttribute('role', 'group');
    vh.append(vt, vsub, seg);
    const stage = el('section', 'md-stage');
    stage.hidden = true;
    stage.setAttribute('aria-label', tr('Now playing'));
    const grid = el('div', 'md-grid has-hero');
    const more = el('button', 'ep-btn md-more', tr('Show more'));
    more.type = 'button'; more.hidden = true;
    /* THE LEAGUES WITH HIGHLIGHTS, on HIGHLIGHTS: a strip that scrolls sideways, a button for each league (its logo, its
       name, how many), the reader's own first - the leagues they follow, then the ones they read most (feedrank.js, on this
       device) - then the newest. A press shows that league's highlights alone; ALL LEAGUES, or the same press again, all of
       them. 0244 video_leagues; before it, the leagues of the highlights already read. */
    const lgs = el('div', 'vh-lgs');
    lgs.hidden = true;
    const lgPrev = el('button', 'vh-lgs-arrow prev');
    lgPrev.type = 'button'; lgPrev.setAttribute('aria-label', tr('Earlier leagues'));
    const lgNext = el('button', 'vh-lgs-arrow next');
    lgNext.type = 'button'; lgNext.setAttribute('aria-label', tr('More leagues'));
    const lgRow = el('div', 'vh-lgs-row');
    lgRow.setAttribute('role', 'group');
    lgRow.setAttribute('aria-label', tr('Leagues with highlights'));
    lgs.append(lgPrev, lgRow, lgNext);
    vids.append(vh, lgs, stage, grid, more);
    if (team) live.hidden = true;                // until the club is seen to be playing
    wrap.append(live, vids);
    host.appendChild(wrap);

    /* the leagues' strip is over HIGHLIGHTS and FULL GAMES (each kind its own leagues, read once) */
    const STRIP = { highlights: 1, full: 1, press: 1 };
    let kind = null, rows = [], shown = STEP, playing = null, league = null, followedLg = new Set();
    const leaguesBy = {};
    const R = () => window.EpinoiaFeedRank;
    st.sp = M.stagePlayer(stage, {
      dark: true,
      list: () => rows,
      onClose: () => { playing = null; paint(); },
      onChange: it => {
        playing = it;
        paint();
        /* a video played, by its kind (highlights, full, press, video), with its league and game */
        const vk = String((it && (it.video_kind || it.piece_kind)) || 'video').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'video';
        act('play-' + (vk === 'youtube' ? 'video' : vk), { league: it && it.league_slug, game: it && it.game && it.game.id });
        try { const F = R(); if (F && typeof F.opened === 'function') F.opened(it); } catch (_) { /* never in the way */ }
      }
    });
    /* FULL GAMES: whole games already played - a channel's broadcasts and streams kept after they ended ("LIVE: ...",
       "Full game"), and the games' own streams (0244 video_full_games) */
    /* PRESS CONFERENCES: before a game and after it, each on the game it is about where the matcher found it (0244) */
    [['All', null], ['Highlights', 'highlights'], ['Full games', 'full'], ['Press conferences', 'press'], ['Videos', 'video']].forEach(([label, k]) => {
      const b = el('button', 'md-chip', tr(label));
      b.type = 'button';
      if (k) b.dataset.kind = k;
      b.setAttribute('aria-pressed', String(k === kind));
      b.addEventListener('click', () => {
        if (k === kind) return;
        kind = k;
        league = null;
        act('kind-' + (k || 'all'));
        seg.querySelectorAll('.md-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        /* on a phone the pill scrolls sideways (kit/media.css): the chip pressed comes wholly into it */
        const sr = seg.getBoundingClientRect(), br = b.getBoundingClientRect();
        if (br.left < sr.left || br.right > sr.right) seg.scrollTo({ left: seg.scrollLeft + br.left - sr.left - 24, behavior: 'smooth' });
        if (!STRIP[kind] || team) lgs.hidden = true;
        loadVideos().then(showLeagues);
      });
      seg.appendChild(b);
    });
    /* ---- the leagues' strip ---- */
    const HEXC = /^#?[0-9a-f]{6}$/i;
    async function rankLeagues(list) {
      followedLg = new Set();
      try {
        const F = window.EpinoiaFollow, s = F && F.session ? F.session() : null;
        if (s && s.token && typeof F.load === 'function') { const pr = await F.load(); ((pr && pr.fav_league_ids) || []).forEach(id => followedLg.add(id)); }
      } catch (_) { /* signed out */ }
      const pts = {};
      try {
        const FR = R();
        if (FR && FR.enabled && FR.enabled() && FR.store && FR.decay) {
          const l = FR.store().profile().l || {}, now = Date.now();
          Object.keys(l).forEach(k => { pts[k] = FR.decay(l[k], now); });
        }
      } catch (_) { /* nothing learned */ }
      return list.slice().sort((a, b) => (Number(followedLg.has(b.id)) - Number(followedLg.has(a.id)))
        || ((pts[b.slug] || 0) - (pts[a.slug] || 0)) || ((Date.parse(b.newest) || 0) - (Date.parse(a.newest) || 0)));
    }
    async function readLeagues(k) {
      let list = await rpc('video_leagues', { p_kind: k });
      if (!Array.isArray(list)) {
        /* before 0244: the leagues of the videos already read */
        const by = new Map();
        rows.forEach(r => { const sl = r.league_slug; if (!sl) return; const e = by.get(sl) || { id: null, slug: sl, name: r.league_name || sl, logo: null, colour: null, videos: 0, newest: r.published_at }; e.videos++; by.set(sl, e); });
        list = [...by.values()];
      }
      return rankLeagues(list.filter(l => l && l.slug && l.name));
    }
    function lgButton(l) {
      const b = el('button', 'vh-lg' + (l ? '' : ' all'));
      b.type = 'button';
      const on = l ? !!league && league.slug === l.slug : !league;
      b.setAttribute('aria-pressed', String(on));
      const logo = el('span', 'vh-lg-logo');
      if (l) {
        if (HEXC.test(l.colour || '')) b.style.setProperty('--lg', l.colour.charAt(0) === '#' ? l.colour : '#' + l.colour);
        const u = l.logo && typeof window.epinoiaLogoUrl === 'function' ? window.epinoiaLogoUrl(l.logo, 64) : null;
        if (u) { const im = el('img'); im.src = u; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.addEventListener('error', () => { im.remove(); logo.textContent = M.abbr({ name: l.name }); }); logo.appendChild(im); }
        else logo.textContent = M.abbr({ name: l.name });
        b.append(logo, el('span', 'vh-lg-n', l.name), el('span', 'vh-lg-c', String(l.videos || '')));
        if (followedLg.has(l.id)) { b.classList.add('is-followed'); b.title = tr('You follow this league'); }
      } else {
        b.append(logo, el('span', 'vh-lg-n', tr('All leagues')));
      }
      b.addEventListener('click', () => {
        const want = l && !(league && league.slug === l.slug) ? l : null;
        if ((want && league && want.slug === league.slug) || (!want && !league)) return;
        league = want;
        act(want ? 'league-pick' : 'league-all', { league: want && want.slug });
        drawLeagues();
        loadVideos();
      });
      return b;
    }
    function drawLeagues() {
      lgRow.textContent = '';
      lgRow.appendChild(lgButton(null));
      (leaguesBy[kind] || []).forEach(l => lgRow.appendChild(lgButton(l)));
      requestAnimationFrame(arrows);
    }
    function arrows() {
      const over = lgRow.scrollWidth > lgRow.clientWidth + 2;
      lgPrev.hidden = !over || lgRow.scrollLeft < 4;
      lgNext.hidden = !over || lgRow.scrollLeft + lgRow.clientWidth > lgRow.scrollWidth - 4;
    }
    lgRow.addEventListener('scroll', arrows, { passive: true });
    window.addEventListener('resize', arrows);
    st.timers.push(() => window.removeEventListener('resize', arrows));
    const slide = dir => lgRow.scrollBy({ left: dir * lgRow.clientWidth * 0.8, behavior: 'smooth' });
    lgPrev.addEventListener('click', () => slide(-1));
    lgNext.addEventListener('click', () => slide(1));
    const leaguesFor = async k => (leaguesBy[k] || (leaguesBy[k] = await readLeagues(k)));
    async function showLeagues() {
      const k = kind;
      if (!STRIP[k] || team) { lgs.hidden = true; return; }
      const list = await leaguesFor(k);
      if (!st.alive || kind !== k) return;
      lgs.hidden = !list.length;
      lgRow.setAttribute('aria-label', tr(k === 'full' ? 'Leagues with full games' : k === 'press' ? 'Leagues with press conferences' : 'Leagues with highlights'));
      drawLeagues();
    }
    function caption() {
      if (team) return;
      vsub.textContent = league ? league.name + ' · ' + tr(kind === 'full' ? 'every full game, newest first in your order'
        : kind === 'press' ? 'every press conference, newest first in your order' : 'every highlight, newest first in your order')
        : tr('From what you follow first, then in your feed’s order');
    }
    /* the videos of a kind (of one league): FULL GAMES from video_full_games (before 0244: the full games among the
       videos), the rest from video_feed */
    async function fetchKind(k, lg) {
      const one = lg && lg.id ? { p_league: lg.id } : {};
      if (k === 'full') {
        const got = await rpc('video_full_games', Object.assign({ p_limit: 60 }, one));
        if (Array.isArray(got)) return got;
        return ((await rpc('video_feed', Object.assign({ p_kind: 'video', p_limit: 60 }, one))) || []).filter(r => r.video_kind === 'full');
      }
      return rpc('video_feed', Object.assign({ p_kind: k, p_limit: 60 }, one));
    }

    /* WHAT IS SHOWN: the reader's follows first, then everything else, each in the feed's own order; one league's alone
       when a league is chosen on the strip */
    async function read() {
      caption();
      /* THE CLUB'S OWN: its videos of the kind, newest first (a series still down to its newest episode) */
      if (team) {
        const got = await rpc('team_videos', { p_team: team.id, p_kind: kind, p_limit: 60 });
        const pool = M.uniq(Array.isArray(got) ? got : []);
        const FR = R();
        const list0 = FR && typeof FR.latestEpisodes === 'function' ? FR.latestEpisodes(pool) : pool;
        const list = kind ? list0 : M.prioritise(list0);                                  // ALL: highlights up
        return FR && typeof FR.shortsLast === 'function' ? FR.shortsLast(list) : list;   // a YouTube Short last
      }
      if (league) {
        const got = league.id ? await fetchKind(kind, league)
          : ((await fetchKind(kind, null)) || []).filter(r => r.league_slug === league.slug);
        const pool = M.uniq(got || []);
        const FR = R();
        let ranked = pool;
        if (FR && typeof FR.rankRows === 'function') { try { ranked = (await FR.rankRows(pool, {})).rows; } catch (_) { /* newest first */ } }
        return FR && typeof FR.latestEpisodes === 'function' ? FR.latestEpisodes(ranked) : ranked;
      }
      const F = window.EpinoiaFollow, s = F && F.session ? F.session() : null;
      const [all, mine0] = await Promise.all([fetchKind(kind, null),
        s && s.token ? rpc('video_feed_mine', { p_kind: kind, p_limit: 60 }, s.token) : Promise.resolve(null)]);
      if (!all) return [];
      let mine = mine0;
      /* FULL GAMES: a game's own stream is followed when its league is (the leagues' strip knows their ids) */
      if (kind === 'full' && s && s.token) {
        try {
          const lg = await leaguesFor('full');
          const fav = new Set(lg.filter(l => followedLg.has(l.id)).map(l => l.slug));
          const have = new Set((mine || []).map(r => r.id));
          mine = (mine || []).concat(all.filter(r => fav.has(r.league_slug) && !have.has(r.id)));
        } catch (_) { /* in the feed's order */ }
      }
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
      if (!rows.length) { grid.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : kind === 'full' ? 'No full games yet.' : kind === 'press' ? 'No press conferences yet.' : 'No videos yet.'))); more.hidden = true; return; }
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
    more.addEventListener('click', () => { shown += STEP - 1; paint(); act('more'); });

    await Promise.all([readLive(true), loadVideos()]);
    /* OPENED ON ONE GAME (?view=video&play=<game>: WATCH HERE in a fixture's where-to-watch card, watch.js): streaming
       now, it is LIVE's game; else its best video (its whole game, else its highlights: 0244 game_watch) plays on the
       stage, first in the list */
    const want = team ? null : new URLSearchParams(location.search).get('play');
    if (want && /^[0-9a-f-]{36}$/i.test(want) && st.alive) {
      act('watch-here', { game: want });
      const g = games.find(x => x.id === want);
      if (g) {
        if (!chosen || chosen.id !== g.id) { chosen = g; drawGames(); enter(g); }
        theatre.scrollIntoView({ block: 'start' });
      } else {
        const j = await rpc('game_watch', { p_game: want });
        const v = j && j.video;
        if (st.alive && v && /^[A-Za-z0-9_-]{6,20}$/.test(v.video_id || '')) {
          const gj = j.game_json || null, lg = (gj && gj.league) || {};
          const row = { kind: 'channel', id: v.id, title: v.title, url: 'https://www.youtube.com/watch?v=' + v.video_id, published_at: v.published_at,
            source_name: v.source_name, league_slug: lg.slug || null, league_name: lg.name || null, piece_kind: 'youtube',
            video_id: v.video_id, video_kind: v.kind === 'live' ? 'full' : v.kind, game: gj };
          rows = [row].concat(rows.filter(r => r.video_id !== row.video_id));
          shown = STEP;
          paint();
          st.sp.go(row);
          vids.scrollIntoView({ block: 'start' });
        }
      }
    }
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
    try { if (st.deck) st.deck.stop(); } catch (_) { /* nothing */ }
    try { if (st.board) st.board.stop(); } catch (_) { /* nothing */ }
    st.timers.forEach(f => { try { f(); } catch (_) { /* nothing */ } });
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { /* nothing */ }
    if (st.host) st.host.textContent = '';
  }

  window.EpinoiaVideoHub = { open, close };
})();
