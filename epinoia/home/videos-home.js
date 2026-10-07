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
    /* SIX AT A TIME, AS THE NEWS CARDS ARE (feedview.js): each six a block of its own - on a phone a row to swipe through
       (kit/media.css .md-row-m), on a wider screen two rows of three - and SHOW MORE adds the next six under the last,
       fading in, where the reader is looking, rather than drawing everything again */
    const grid = el('div', 'md-rows');
    const block = () => el('div', 'md-grid md-row-m');
    const more = el('button', 'ep-btn md-more', tr('Show more'));
    more.type = 'button';
    let rows = [], shown = STEP;

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
    /* THE STAGE PLAYS DOWN THE FEED, in the reader's order (media.js stagePlayer): a video ends, the next one plays in the
       same player, and UP NEXT beside it lists the rest */
    let playing = null;
    const sp = M.stagePlayer(stage, {
      list: () => rows,
      onClose: () => { playing = null; paint(); },
      onChange: it => {
        playing = it;
        paint();
        /* A VIDEO PLAYED IS A STORY OPENED (feedrank.js noteOpen): its channel and its leagues rise for this reader, on this
           device, and it is read - the next time the feed is drawn it has left it, as a read story leaves the news feed */
        try { const R = window.EpinoiaFeedRank; if (R && typeof R.opened === 'function') R.opened(it); } catch (_) { /* never in the way */ }
      }
    });
    const play = it => sp.go(it);
    function addBlock(from, to) {
      const g = block();
      rows.slice(from, to).forEach(it => {
        const t = M.tile(it, play, false);
        if (playing && playing.id === it.id) t.setAttribute('aria-current', 'true');
        g.appendChild(t);
      });
      grid.appendChild(g);
      return g;
    }
    function paint() {
      grid.textContent = '';
      for (let at = 0; at < Math.min(shown, rows.length); at += STEP) addBlock(at, Math.min(at + STEP, shown));
      more.hidden = rows.length <= shown;
    }
    async function load() {
      grid.textContent = '';
      const sk = block();
      for (let i = 0; i < STEP; i++) sk.appendChild(el('div', 'md-skel'));
      grid.appendChild(sk);
      const got = await read();
      if (!got || (!got.length && !kind)) { sec.hidden = true; return false; }
      sec.hidden = false;
      rows = got; shown = STEP;
      if (!rows.length) { grid.textContent = ''; const g = block(); g.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : 'No videos yet.'))); grid.appendChild(g); more.hidden = true; return true; }
      paint();
      return true;
    }
    more.addEventListener('click', () => {
      const from = shown;
      shown += STEP;
      const g = addBlock(from, shown);
      if (ctx.fadeIn) ctx.fadeIn(g);
      more.hidden = rows.length <= shown;
    });
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
