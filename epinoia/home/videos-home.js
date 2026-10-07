'use strict';
/* ============================================================================
   HOME - THE VIDEO FEED, section 'videos', under THE FEED (0237).

   Every league's new videos as tiles: ALL, HIGHLIGHTS (a game's highlights: a title that says so, or a channel the
   league marked for them, matched to the game - scripts/news/videos.py) or VIDEOS (everything else: features,
   interviews, whole games). Ranked as the feed is (feedrank.js, already on this page: the leagues the reader reads and
   follows, their country, the sources they open), six at a time. Signed in, the videos of what the reader follows join
   the pool (video_feed_mine).

   A tile opens a stage at the top of the section: the video (nothing of YouTube until play is pressed) and, for a
   game's video, the game's own embed under it; while it plays the page goes dark around them (media.js cinema).

   LIGHT: nothing is read until the reader is within 400 px of where the section starts; media.js and
   kit/media.css arrive then too. A database without 0237 answers nothing and the section stays shut.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;
  const KIND_KEY = 'epinoia.home.videos';
  const STEP = 6;

  function rpc(name, body, token) {
    const c = window.EPINOIA_CONFIG;
    return fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + (token || c.supabaseAnonKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(r => r.ok ? r.json() : null).catch(() => null);
  }
  function near(el) {
    return new Promise(res => {
      if (typeof IntersectionObserver !== 'function') return res();
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); res(); } }, { rootMargin: '400px 0px' });
      io.observe(el);
    });
  }
  function media(base) {
    if (window.EpinoiaMedia) return Promise.resolve(window.EpinoiaMedia);
    const v = (/[?&]v=(\d+)/.exec(((document.querySelector('script[src*="videos-home.js"]') || {}).src) || '') || [])[1];
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = base + 'media.js' + (v ? '?v=' + v : '');
      s.onload = () => res(window.EpinoiaMedia); s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* the section returns at once (HOME numbers its sections when they have all run) and draws itself when the reader
     comes near: the feed above it is the trip-wire, as this section is shut until it has something to show */
  H.register('videos', function (ctx) {
    const sec = document.getElementById('videos');
    if (!sec) return;
    /* a one-pixel marker where the section starts: it is laid out while the section is shut, so the read waits until
       the reader has scrolled to the end of what is above it */
    const wire = document.createElement('div');
    wire.setAttribute('aria-hidden', 'true');
    wire.style.cssText = 'height:1px;margin-top:-1px;pointer-events:none';
    sec.parentNode.insertBefore(wire, sec);
    near(wire).then(() => draw(ctx, sec)).catch(() => { sec.hidden = true; });
  });

  async function draw(ctx, sec) {
    const seg = document.getElementById('videosSeg');
    const M = await media(ctx.base);
    M.css('kit/media.css');
    const el = M.el, tr = M.tr;
    let kind = null;
    try { const k = localStorage.getItem(KIND_KEY); kind = k === 'highlights' || k === 'video' ? k : null; } catch (_) { /* private mode */ }

    const stage = el('section', 'md-stage');
    stage.hidden = true;
    const grid = el('div', 'md-grid');
    const more = el('button', 'ep-btn md-more', tr('Show more'));
    more.type = 'button';
    let rows = [], shown = STEP, boxer = null;

    async function read() {
      const F = window.EpinoiaFollow, s = F && F.session ? F.session() : null;
      const [all, mine] = await Promise.all([rpc('video_feed', { p_kind: kind, p_limit: 60 }),
        s && s.token ? rpc('video_feed_mine', { p_kind: kind, p_limit: 60 }, s.token) : Promise.resolve(null)]);
      if (!all) return null;
      /* one tile a video (a channel added twice reads each video twice) */
      const pool = M.uniq((mine || []).concat(all));
      const R = window.EpinoiaFeedRank;
      let ranked = pool;
      if (R && typeof R.rankRows === 'function') {
        try { ranked = (await R.rankRows(pool, { followedIds: (mine || []).map(r => r.id) })).rows; } catch (_) { /* newest first */ }
      }
      /* ALL: the games' highlights lead the reader's order (media.js prioritise); and a podcast's or a show's series is its
         newest episode alone (feedrank.js latestEpisodes) */
      const ordered = kind ? ranked : M.prioritise(ranked);
      return R && typeof R.latestEpisodes === 'function' ? R.latestEpisodes(ordered) : ordered;
    }
    function play(it) {
      M.stageOpen(stage, it, () => { M.cineExit(true); if (boxer) boxer.stop(); boxer = null; stage.hidden = true; stage.textContent = ''; });
      const vid = el('div');
      stage.appendChild(vid);
      const id = M.idOf(it);
      if (id) M.player(vid, { id, title: it.title, autoplay: true, group: stage });
      if (boxer) boxer.stop();
      boxer = null;
      if (it.game && it.game.id) { const box = el('div', 'md-boxwrap'); stage.appendChild(box); boxer = M.embedGame(box, it.game.id); }
      stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
    function paint() {
      grid.textContent = '';
      rows.slice(0, shown).forEach((it, i) => grid.appendChild(M.tile(it, play, false, { no: i + 1, of: rows.length })));
      more.hidden = rows.length <= shown;
    }
    async function load() {
      grid.textContent = '';
      for (let i = 0; i < STEP; i++) grid.appendChild(el('div', 'md-skel'));
      const got = await read();
      if (!got || (!got.length && !kind)) { sec.hidden = true; return false; }
      sec.hidden = false;
      rows = got; shown = STEP;
      if (!rows.length) { grid.textContent = ''; grid.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : 'No videos yet.'))); more.hidden = true; return true; }
      paint();
      return true;
    }
    more.addEventListener('click', () => { shown += STEP; paint(); });
    if (seg) {
      seg.querySelectorAll('button').forEach(b => {
        const k = b.dataset.vk || null;
        b.setAttribute('aria-pressed', String(k === kind));
        b.addEventListener('click', () => {
          if (k === kind) return;
          kind = k;
          try { localStorage.setItem(KIND_KEY, k || 'all'); } catch (_) { /* private mode */ }
          seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          load();
        });
      });
    }
    const host = ctx.host;
    host.textContent = '';
    host.append(stage, grid, more);
    const ok = await load();
    if (ok) {
      if (ctx.fadeIn) ctx.fadeIn(grid);
      /* a section that has just appeared: HOME's numbers again */
      renumber();
    }
  }
  function renumber() {
    let n = 0;
    document.querySelectorAll('.sec').forEach(sec => {
      const idx = sec.querySelector('.idx');
      if (!idx || sec.hidden) return;
      idx.textContent = String(++n).padStart(2, '0');
    });
  }
})();
