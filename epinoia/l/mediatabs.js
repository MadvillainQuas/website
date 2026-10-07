'use strict';
/* ============================================================================
   A LEAGUE'S VIDEO AND LIVE TABS (0237), on the league page.

   WHAT THE PAGE PAYS: this file, and one small call once the page is idle (league_media: has the league any
   highlights, which of its games are live, is its chat on). Both tabs start hidden and appear only when there is
   something in them. Their code (media.js, kit/media.css, gamechat.js) is loaded the first time one is opened.

   VIDEO: the league's highlights as tiles, newest first and the newest large; "All videos" for every video about
   the league; a club picker. A tile opens the stage above them: the video (nothing of YouTube loads until play is
   pressed; while it plays the rest of the page goes dark, media.js cinema) with the game under it as its embed (embed/game: the score, the quarters, the top scorers, the way to
   the full box score). ?vid=<id>#video opens one.

   LIVE: the league's games that are on now, one card each. The chosen one (?lg=<game id>#live) shows its stream -
   the game's own video or the league's channel - over its embed, and beside them the game's chat (gamechat.js),
   AI-moderated, for fans with an EPINOIA GO username. The list is asked again every two minutes while it is open.
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const tabBtn = id => document.querySelector('.ep-tab[data-p="' + id + '"]');
  const pane = id => document.getElementById('pane-' + id);
  let league = null, probe = null, probing = null, videoDone = false, liveDone = false;

  function rpc(name, body) {
    const c = window.EPINOIA_CONFIG;
    return fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(r => r.ok ? r.json() : null).catch(() => null);
  }
  function ask() {
    if (!league) return Promise.resolve(null);
    if (!probing) probing = rpc('league_media', { p_league: league.id }).then(r => { probe = r; probing = null; return r; });
    return probing;
  }
  function show() {
    if (!probe) return;
    const v = tabBtn('video'), l = tabBtn('live');
    if (v) v.hidden = !probe.highlights;
    if (l) l.hidden = !(probe.live && probe.live.length);
  }
  async function deps(live) {
    const base = (document.querySelector('script[src*="mediatabs.js"]') || {}).src || '';
    const v = (/[?&]v=(\d+)/.exec(base) || [])[1];
    if (!window.EpinoiaMedia) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = '../media.js' + (v ? '?v=' + v : '');
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    window.EpinoiaMedia.css('kit/media.css');
    if (live) await window.EpinoiaMedia.load('gamechat.js', 'EpinoiaGameChat');
    return window.EpinoiaMedia;
  }
  const param = k => new URLSearchParams(location.search).get(k);
  function setParam(k, v) {
    const u = new URL(location.href);
    if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    history.replaceState(null, '', u.toString());
  }

  /* ------------------------------------------------------------------------------------------- VIDEO --- */
  async function openVideo() {
    if (videoDone || !league) return;
    videoDone = true;
    const host = pane('video');
    const M = await deps(false);
    const el = M.el, tr = M.tr;
    host.textContent = '';
    const wrap = el('div', 'md-wrap');
    const stage = el('section', 'md-stage');
    stage.hidden = true;
    stage.setAttribute('aria-label', tr('Now playing'));
    const bar = el('div', 'md-bar');
    const grid = el('div', 'md-grid has-hero');
    const more = el('button', 'ep-btn md-more', tr('More videos'));
    more.type = 'button'; more.hidden = true;
    wrap.append(stage, bar, grid, more);
    host.appendChild(wrap);

    let kind = 'highlights', club = '', items = [], last = null, playing = null, boxer = null;
    const chip = (label, k) => {
      const b = el('button', 'md-chip', tr(label));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(kind === k));
      b.addEventListener('click', () => { if (kind === k) return; kind = k; items = []; last = null; bar.querySelectorAll('.md-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); page(); });
      return b;
    };
    const pick = el('select', 'md-select');
    pick.setAttribute('aria-label', tr('Club'));
    pick.addEventListener('change', () => { club = pick.value; paint(); });
    bar.append(chip('Highlights', 'highlights'), chip('All videos', null), pick);

    function clubsOf() {
      const seen = new Map();
      items.forEach(it => { const g = it.game; if (g) [g.home, g.away].forEach(t => t && t.slug && seen.set(t.slug, t.name)); });
      const keep = club;
      pick.textContent = '';
      const all = el('option', null, tr('Every club')); all.value = ''; pick.appendChild(all);
      [...seen].sort((a, b) => a[1].localeCompare(b[1])).forEach(([slug, name]) => { const o = el('option', null, name); o.value = slug; pick.appendChild(o); });
      pick.value = seen.has(keep) ? keep : '';
      pick.hidden = seen.size < 2;
    }
    function paint() {
      grid.textContent = '';
      const shown = items.filter(it => !club || (it.game && [it.game.home, it.game.away].some(t => t && t.slug === club)));
      if (!shown.length) { grid.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : 'No videos yet.'))); return; }
      shown.forEach((it, i) => {
        const t = M.tile(it, play, i === 0);
        if (playing && playing.id === it.id) t.setAttribute('aria-current', 'true');
        grid.appendChild(t);
      });
    }
    async function page() {
      if (!items.length) { grid.textContent = ''; for (let i = 0; i < 6; i++) grid.appendChild(el('div', 'md-skel')); }
      const rows = (await rpc('league_videos', { p_league: league.id, p_kind: kind, p_before: last, p_limit: 24 })) || [];
      items = items.concat(rows);
      last = rows.length ? rows[rows.length - 1].published_at : last;
      more.hidden = rows.length < 24;
      clubsOf(); paint();
      const want = param('vid');
      if (want && !playing) { const it = items.find(x => x.id === want); if (it) play(it, null, true); }
    }
    more.addEventListener('click', page);

    function play(it, _btn, quiet) {
      playing = it;
      stage.hidden = false;
      stage.textContent = '';
      const head = el('div', 'md-stage-h');
      const words = el('div');
      words.append(el('div', 'md-title', it.title || ''), el('div', 'md-yt', (it.source_name || '') + (it.published_at ? ' · ' + M.when(it.published_at) : '')));
      const close = el('button', 'ep-btn mini md-close', tr('Close'));
      close.type = 'button';
      close.addEventListener('click', () => { M.cineExit(true); stage.hidden = true; stage.textContent = ''; if (boxer) boxer.stop(); boxer = null; playing = null; setParam('vid', null); paint(); });
      head.append(words, close);
      const vid = el('div');
      stage.append(head, vid);
      const id = M.idOf(it);
      if (id) M.player(vid, { id, title: it.title, autoplay: !quiet, group: stage });
      if (boxer) boxer.stop();
      boxer = null;
      if (it.game && it.game.id) {
        const box = el('div', 'md-boxwrap');
        stage.appendChild(box);
        boxer = M.embedGame(box, it.game.id);
      }
      setParam('vid', it.id);
      paint();
      if (!quiet) stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
    page();
  }

  /* -------------------------------------------------------------------------------------------- LIVE --- */
  async function openLive() {
    if (liveDone || !league) return;
    liveDone = true;
    const host = pane('live');
    const M = await deps(true);
    const el = M.el, tr = M.tr;
    host.textContent = '';
    const wrap = el('div', 'md-wrap');
    const list = el('div', 'lv-list');
    list.setAttribute('role', 'tablist');
    const room = el('div', 'lv-room');
    wrap.append(list, room);
    host.appendChild(wrap);
    let chosen = param('lg'), chat = null, boxer = null, games = [];

    function cards() {
      list.textContent = '';
      if (!games.length) { list.appendChild(el('div', 'md-empty', tr('No game is live right now.'))); return; }
      games.forEach(g => {
        const b = el('button', 'lv-card');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-current', String(g.id === chosen));
        const t = el('div');
        t.append(el('div', 't', (g.home.short || g.home.name) + ' v ' + (g.away.short || g.away.name)), el('div', 'c', tr('LIVE')));
        t.firstChild.setAttribute('translate', 'no');
        b.append(M.crest(g.home), el('span', 's', (g.home_score ?? 0) + '–' + (g.away_score ?? 0)), M.crest(g.away), t);
        b.addEventListener('click', () => { if (chosen !== g.id) { chosen = g.id; setParam('lg', g.id); cards(); enter(); } });
        list.appendChild(b);
      });
    }
    function stream(holder, g) {
      const v = g.video, ch = g.channel;
      const yt = v && v.provider === 'youtube' && /^[A-Za-z0-9_-]{6,20}$/.test(v.ref || '') ? v.ref : null;
      if (yt) return M.player(holder, { id: yt, title: g.home.name + ' v ' + g.away.name, group: room });
      if (ch && ch.ref && (ch.platform === 'youtube' || ch.platform === 'twitch')) {
        holder.classList.add('md-player');
        const b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', tr('Watch the live stream'));
        b.append(el('span', 'md-play'));
        b.addEventListener('click', () => {
          M.playFrame(b, ch.platform === 'youtube'
            ? 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + encodeURIComponent(ch.ref) + '&autoplay=1&rel=0&playsinline=1'
            : 'https://player.twitch.tv/?channel=' + encodeURIComponent(ch.ref) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=true',
            tr('Live stream'), room);
        }, { once: true });
        holder.appendChild(b);
        return;
      }
      holder.remove();
    }
    function enter() {
      if (chat) chat.stop();
      if (boxer) boxer.stop();
      chat = boxer = null;
      room.textContent = '';
      const g = games.find(x => x.id === chosen);
      if (!g) return;
      const main = el('div', 'lv-main');
      const st = el('div', 'md-stage');
      const vid = el('div');
      const box = el('div', 'md-boxwrap');
      st.append(vid, box);
      main.appendChild(st);
      stream(vid, g);
      boxer = M.embedGame(box, g.id);
      room.appendChild(main);
      if (probe && probe.chat) {
        const side = el('div');
        room.appendChild(side);
        chat = window.EpinoiaGameChat.mount(side, g.id, { base: M.BASE });
      }
    }
    function load(r) {
      games = (r && r.live) || [];
      if (!games.some(g => g.id === chosen)) chosen = games.length ? games[0].id : null;
      cards();
    }
    load(probe);
    enter();
    /* the list again every two minutes while the tab is open and the page is seen: a new tip-off joins it */
    setInterval(async () => {
      if (document.hidden || !pane('live').classList.contains('on')) return;
      probe = null;
      const r = await ask();
      if (!r) return;
      const before = chosen;
      load(r);
      show();
      if (chosen !== before) enter();
    }, 120000);
  }

  /* ----------------------------------------------------------------------------------- the wiring --- */
  function onTab() {
    if (pane('video') && pane('video').classList.contains('on')) openVideo();
    if (pane('live') && pane('live').classList.contains('on')) openLive();
  }
  ['video', 'live'].forEach(id => { const b = tabBtn(id); if (b) b.addEventListener('click', () => setTimeout(onTab, 0)); });
  /* another tab chosen while a video plays: the page comes back */
  document.querySelectorAll('.ep-tab').forEach(b => b.addEventListener('click', () => { if (window.EpinoiaMedia) window.EpinoiaMedia.cineExit(true); }));
  window.addEventListener('hashchange', () => setTimeout(onTab, 0));

  function start(lg) {
    if (league || !lg || !lg.id) return;
    league = lg;
    const wanted = /^#(video|live)$/.test(location.hash);
    const go = () => ask().then(() => { show(); onTab(); });
    /* asked at once when the address opens one of these tabs; otherwise when the page has nothing better to do */
    if (wanted) go();
    else if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1200);
  }
  window.addEventListener('epinoia:league', e => start(e.detail));
  if (window.EPINOIA_LEAGUE) start(window.EPINOIA_LEAGUE);
})();
