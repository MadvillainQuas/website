'use strict';
/* ============================================================================
   EpinoiaMedia - what the video surfaces share (0237): a script or a stylesheet loaded when it is first needed (with
   the page's own ?v= stamp), the click-to-play YouTube player, and the video tile.

   NOTHING OF YOUTUBE LOADS UNTIL SOMEBODY PRESSES PLAY. A tile and the player's cover are the video's own thumbnail
   (i.ytimg.com, lazy); the iframe - and the half megabyte of YouTube's player behind it - is made on the click, from
   youtube-nocookie.com, so a page of twenty highlights costs twenty small pictures.
   ============================================================================ */
(function () {
  if (window.EpinoiaMedia) return;
  const me = document.currentScript;
  const SRC = me && me.src ? me.src : '';
  const BASE = SRC ? SRC.replace(/media\.js(\?.*)?$/, '') : '../';          // the site's /epinoia/
  const STAMP = (/[?&]v=(\d+)/.exec(SRC) || [])[1] || '';
  const V = p => BASE + p + (STAMP ? (p.includes('?') ? '&' : '?') + 'v=' + STAMP : '');

  const loading = {};
  /* a script once, in order of asking; resolves when it has run (or at once when its global is there already) */
  function load(path, global) {
    if (global && window[global]) return Promise.resolve(window[global]);
    if (loading[path]) return loading[path];
    loading[path] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = V(path); s.async = false;
      s.onload = () => res(global ? window[global] : true);
      s.onerror = () => { delete loading[path]; rej(new Error('could not load ' + path)); };
      document.head.appendChild(s);
    });
    return loading[path];
  }
  function css(path) {
    if (document.querySelector('link[data-md="' + path + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = V(path); l.dataset.md = path;
    document.head.appendChild(l);
  }

  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const tr = s => { try { return window.EpinoiaI18n && window.EpinoiaI18n.t ? window.EpinoiaI18n.t(s) : s; } catch (_) { return s; } };
  const VID = /^[A-Za-z0-9_-]{6,20}$/;
  function idOf(it) {
    if (it && it.video_id && VID.test(it.video_id)) return it.video_id;
    try {
      const u = new URL(it && it.url);
      const v = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v');
      return v && VID.test(v) ? v : null;
    } catch (_) { return null; }
  }
  const thumb = (id, big) => 'https://i.ytimg.com/vi/' + id + '/' + (big ? 'hqdefault' : 'mqdefault') + '.jpg';

  /* ---------------------------------------------------------------------------------------- CINEMA ---
     WHILE A VIDEO PLAYS, THE REST OF THE PAGE GOES DARK. The video and what belongs to it (its group: the stage with
     the game's embed, and on the Live tab the chat) stay lit above a veil that fades in; once it has, everything
     outside the group is set to paint nothing (visibility:hidden, so nothing moves) - the page under the dark is not
     drawn at all while the video runs. Paused, ended, Esc, or a press on the dark, and it all comes back.
     Play and pause come from YouTube's own frame messages (enablejsapi), not its iframe_api script, which is never
     loaded; a frame that says nothing (Twitch) goes dark when its play is pressed. Reduced motion: no fade. */
  const CINE = { group: null, veil: null, off: [], lifted: [], timer: null, exitT: null };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  function cineEnter(group) {
    if (!group || !group.isConnected) return;
    clearTimeout(CINE.exitT);
    if (CINE.group === group) return;
    if (CINE.group) cineExit(true);
    CINE.group = group;
    const veil = CINE.veil || (CINE.veil = el('div', 'md-veil'));
    veil.setAttribute('aria-hidden', 'true');
    veil.onclick = () => cineExit();
    document.body.appendChild(veil);
    /* a transformed or filtered ancestor would hold the group under the veil: those are flattened while it lasts */
    for (let a = group.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain)) {
        CINE.lifted.push([a, a.style.transform, a.style.filter, a.style.perspective, a.style.contain]);
        a.style.transform = 'none'; a.style.filter = 'none'; a.style.perspective = 'none'; a.style.contain = 'none';
      }
    }
    group.classList.add('md-lit');
    document.documentElement.classList.add('md-cine');
    requestAnimationFrame(() => veil.classList.add('on'));
    /* when the dark is complete, what it covers stops being drawn */
    CINE.timer = setTimeout(() => {
      if (CINE.group !== group) return;
      for (let n = group; n && n !== document.body; n = n.parentElement) {
        const p = n.parentElement;
        if (!p) break;
        [...p.children].forEach(s => {
          if (s !== n && s !== veil && !s.contains(group) && s.tagName !== 'SCRIPT' && s.tagName !== 'STYLE' && s.tagName !== 'LINK') {
            s.classList.add('md-unlit'); CINE.off.push(s);
          }
        });
      }
    }, reduced() ? 0 : 520);
  }
  function cineExit(now) {
    clearTimeout(CINE.timer); clearTimeout(CINE.exitT);
    const g = CINE.group;
    if (!g) return;
    CINE.off.forEach(s => s.classList.remove('md-unlit')); CINE.off = [];
    const veil = CINE.veil;
    if (veil) veil.classList.remove('on');
    const done = () => {
      if (CINE.group) return;                       // entered again meanwhile
      g.classList.remove('md-lit');
      document.documentElement.classList.remove('md-cine');
      CINE.lifted.forEach(([a, t, f, p, c]) => { a.style.transform = t; a.style.filter = f; a.style.perspective = p; a.style.contain = c; });
      CINE.lifted = [];
      if (veil && veil.isConnected) veil.remove();
    };
    CINE.group = null;
    if (now || reduced()) done(); else setTimeout(done, 460);
  }
  /* a pause is not an exit until it has lasted a moment (a seek reports a pause too) */
  const cineExitSoon = () => { clearTimeout(CINE.exitT); CINE.exitT = setTimeout(() => cineExit(), 900); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && CINE.group) cineExit(); });

  /* YouTube's frame reports its state to a page that says it is listening: 1 playing, 3 buffering, 2 paused, 0 ended */
  const YT_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
  function watchYouTube(f, group) {
    if (!group) return;
    const hello = () => {
      try {
        f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'md', channel: 'widget' }), '*');
        f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 'md', channel: 'widget' }), '*');
      } catch (_) { /* gone */ }
    };
    const onMsg = ev => {
      if (!YT_ORIGINS.includes(ev.origin) || ev.source !== f.contentWindow) return;
      let d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (_) { return; }
      if (!d) return;
      const st = d.event === 'onStateChange' ? d.info : (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number') ? d.info.playerState : null;
      if (st === 1 || st === 3) cineEnter(group);
      else if (st === 2 || st === 0) cineExitSoon();
    };
    window.addEventListener('message', onMsg);
    f.addEventListener('load', () => { hello(); setTimeout(hello, 800); });
    /* the frame removed (the stage closed, another video): the page comes back, the listener goes */
    const gone = new MutationObserver(() => {
      if (!f.isConnected) { window.removeEventListener('message', onMsg); gone.disconnect(); if (CINE.group === group) cineExit(); }
    });
    gone.observe(document.body, { childList: true, subtree: true });
  }

  /* A FRAME A PRESS HAS OPENED: a YouTube one is watched for play and pause, any other goes dark at once */
  function playFrame(at, src, title, group) {
    const f = document.createElement('iframe');
    const yt = /^https:\/\/www\.youtube(-nocookie)?\.com\//.test(src);
    f.src = yt ? src + (src.includes('?') ? '&' : '?') + 'enablejsapi=1&origin=' + encodeURIComponent(location.origin) : src;
    f.title = title || 'video';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    at.replaceWith(f);
    if (yt) watchYouTube(f, group); else if (group) cineEnter(group);
    return f;
  }

  /* THE PLAYER: the cover until pressed, then youtube-nocookie with autoplay.
     opts: {id, title, start (s), autoplay, group (what stays lit with it while it plays)} */
  function player(host, opts) {
    host.textContent = '';
    host.classList.add('md-player');
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', tr('Play') + ': ' + (opts.title || 'video'));
    const img = el('img'); img.src = thumb(opts.id, true); img.alt = ''; img.decoding = 'async';
    b.append(img, el('span', 'md-play'));
    b.addEventListener('click', () => {
      playFrame(b, 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(opts.id) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1'
        + (opts.start ? '&start=' + Math.max(0, Math.floor(opts.start)) : ''), opts.title, opts.group);
    }, { once: true });
    host.appendChild(b);
    if (opts.autoplay) b.click();
  }

  function logoUrl(p) { try { return window.epinoiaLogoUrl ? window.epinoiaLogoUrl(p) : (/^https?:/.test(p || '') ? p : null); } catch (_) { return null; } }
  function crest(t) {
    const c = el('span', 'md-crest');
    const u = t && logoUrl(t.logo);
    if (u) { const i = el('img'); i.src = u; i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.addEventListener('error', () => { i.remove(); c.textContent = abbr(t); }); c.appendChild(i); }
    else c.textContent = abbr(t);
    c.setAttribute('translate', 'no');
    return c;
  }
  const abbr = t => ((t && (t.short || t.name)) || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 3).toUpperCase();
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' ' + tr('min ago');
    if (s < 86400) return Math.round(s / 3600) + ' ' + tr('h ago');
    if (s < 86400 * 7) return Math.round(s / 86400) + ' ' + tr('d ago');
    try { return d.toLocaleDateString(document.documentElement.lang || 'en-GB', { day: 'numeric', month: 'short' }); } catch (_) { return iso.slice(0, 10); }
  }
  const KIND = { highlights: ['HIGHLIGHTS', ''], full: ['FULL GAME', 'f'], video: ['VIDEO', 'v'] };

  /* A TILE: the thumbnail with its kind and, for a game's video, the two crests and the score over it; the title and
     where it is from under it. onOpen(it) on a press; a tile is a button. */
  function tile(it, onOpen, big) {
    const id = idOf(it);
    const b = el('button', 'md-tile');
    b.type = 'button';
    b.dataset.id = it.id;
    const th = el('div', 'md-thumb');
    if (id) {
      const img = el('img'); img.alt = ''; img.loading = big ? 'eager' : 'lazy'; img.decoding = 'async';
      if (big) {
        /* the large tile at full width: YouTube's 1280 frame when the video has one (a missing one comes back as a
           120-pixel stand-in, not an error), else its 480 */
        img.addEventListener('load', () => { if (img.naturalWidth < 200 && !img.dataset.fell) { img.dataset.fell = '1'; img.src = thumb(id, true); } });
        img.addEventListener('error', () => { if (!img.dataset.fell) { img.dataset.fell = '1'; img.src = thumb(id, true); } });
        img.src = 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
      } else img.src = thumb(id);
      th.appendChild(img);
    }
    else if (it.image_url) { const img = el('img'); img.src = it.image_url; img.alt = ''; img.loading = 'lazy'; th.appendChild(img); }
    th.appendChild(el('span', 'md-play'));
    const k = KIND[it.video_kind] || KIND.video;
    th.appendChild(el('span', 'md-kind' + (k[1] ? ' ' + k[1] : ''), tr(k[0])));
    const g = it.game;
    if (g && g.home && g.away) {
      const sc = el('div', 'md-score');
      const hs = g.home_score, as = g.away_score, played = hs != null && as != null && g.status !== 'scheduled';
      const pts = el('span', 'md-pts');
      if (played) {
        pts.append(el('span', hs >= as ? 'w' : 'l', String(hs)), document.createTextNode(' – '), el('span', as >= hs ? 'w' : 'l', String(as)));
      }
      sc.append(crest(g.home), pts, crest(g.away));
      th.appendChild(sc);
    }
    b.appendChild(th);
    const cap = el('div', 'md-cap');
    const t = el('div', 'md-title', it.title || '');
    const m = el('div', 'md-meta');
    if (it.source_logo) { const i = el('img', 'md-src'); i.src = String(it.source_logo).replace(/#fill$/, ''); i.alt = ''; i.loading = 'lazy'; m.appendChild(i); }
    m.appendChild(el('span', null, (it.source_name || '') + (it.published_at ? ' · ' + when(it.published_at) : '')));
    cap.append(t, m);
    b.appendChild(cap);
    b.setAttribute('aria-label', (it.title || 'video') + (it.source_name ? ', ' + it.source_name : ''));
    b.addEventListener('click', () => onOpen && onOpen(it, b));
    return b;
  }

  /* THE GAME, AS ITS EMBED: the site's own single-game card (embed/game: score, period and clock, the quarters, each
     side's top scorer, the way to the full box score), live by itself, in a frame - the box score is never drawn twice.
     The frame says how tall it is (epinoiaEmbed 'height'); teamcolour.js gives it the page's light/dark and colours. */
  function embedGame(host, gameId) {
    host.textContent = '';
    const f = document.createElement('iframe');
    f.src = BASE + 'embed/game/?g=' + encodeURIComponent(gameId);
    f.title = tr('Box score');
    f.loading = 'lazy';
    f.className = 'md-embed';
    const onMsg = ev => {
      if (ev.origin !== location.origin || ev.source !== f.contentWindow || !ev.data || ev.data.epinoiaEmbed !== 'height') return;
      const h = Number(ev.data.height);
      if (isFinite(h) && h >= 60 && h <= 2000) f.style.height = Math.ceil(h) + 'px';
    };
    window.addEventListener('message', onMsg);
    host.appendChild(f);
    return { frame: f, stop() { window.removeEventListener('message', onMsg); f.remove(); } };
  }

  /* the public REST and RPC, with the signed-in reader's token where there is one (for chat_my_status, video_feed_mine) */
  const CFG = () => window.EPINOIA_CONFIG || {};
  function token() {
    try { const s = window.EpinoiaAccess && window.EpinoiaAccess.session && window.EpinoiaAccess.session(); return s && s.token ? s.token : null; } catch (_) { return null; }
  }
  async function rest(path, opt) {
    const c = CFG(), tk = (opt && opt.auth) ? token() : null;
    const r = await fetch(c.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + (tk || c.supabaseAnonKey), Accept: 'application/json' } });
    if (!r.ok) throw Object.assign(new Error('read ' + r.status), { status: r.status });
    return r.json();
  }
  async function rpc(name, body, opt) {
    const c = CFG(), tk = (opt && opt.auth) ? token() : null;
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST', cache: 'no-store',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + (tk || c.supabaseAnonKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}) });
    if (!r.ok) throw Object.assign(new Error(name + ' ' + r.status), { status: r.status });
    return r.json();
  }

  /* run fn when the browser is idle (or after a beat where it cannot say) - the probes a page does not wait for */
  const idle = fn => ('requestIdleCallback' in window) ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600);

  window.EpinoiaMedia = { load, css, player, playFrame, cineEnter, cineExit, embedGame, tile, crest, abbr, when, idOf, thumb, rest, rpc, token, idle, el, tr, BASE };
})();
