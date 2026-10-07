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
  /* ...and in the game's embed, where a tap leaves the focus (embed/game passes it up) */
  window.addEventListener('message', ev => {
    if (ev.origin === location.origin && ev.data && ev.data.epinoiaEmbed === 'escape' && CINE.group) cineExit();
  });

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
  /* a day as the band prints it: 04 OCT 2026 (day, month, year in the page's language; Japanese keeps its own order) */
  function day(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    const lang = document.documentElement.lang || 'en-GB';
    try {
      if (/^(ja|zh|ko)/i.test(lang)) return d.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });
      const p = {};
      new Intl.DateTimeFormat(lang, { day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
      return (p.day + ' ' + p.month + ' ' + p.year).replace(/\./g, '').toUpperCase();
    } catch (_) { return String(iso).slice(0, 10); }
  }

  /* IN ITS CLUBS' INKS, as the club plates are printed (kit/card.css reads the same variables; teamcolour.js card() sets
     them, the text-safe ink for each on the page's light or dark): the home club's colour is the tile's ink - its
     edge, its shadow, the halftone - and the away club's the band and its half of the scoreboard. Two clubs in one
     colour (a red against a red) print the away side in its second colour. A video with no game takes its channel's
     colour; with neither, the page's accent stands. */
  const HEX = /^#?[0-9a-f]{6}$/i;
  function inks(node, it) {
    const TC = window.EpinoiaTeamColour, g = it && it.game, h = g && g.home, a = g && g.away;
    const A = h && HEX.test(h.colour || '') ? h.colour : (HEX.test((it && it.source_colour) || '') ? it.source_colour : null);
    if (!A) return;
    let B = a && HEX.test(a.colour || '') ? a.colour : null;
    if (B && TC && TC.contrast && TC.contrast(A, B) < 1.6) {
      B = [a.colour_2, h && h.colour_2].find(c => HEX.test(c || '') && TC.contrast(A, c) >= 1.6) || B;
    }
    if (TC && TC.card) {
      TC.card(node, A, B);
      /* the same inks as surfaces (an edge, a shadow, a ring): a white club on the light page, a black one on the dark,
         nudged until it shows */
      if (TC.surface) { node.style.setProperty('--ink-s', TC.surface(A)); node.style.setProperty('--ink-s2', TC.surface(B || TC.derived(A))); }
    } else { node.style.setProperty('--ink-c', A); if (B) node.style.setProperty('--ink-c2', B); }
  }

  /* THE SCOREBUG under a game's video, as a broadcast draws it: a row for each club, its crest in a ring of its colour
     and its whole name in its ink, its score in a black cell at the end of the row (the winner's lit) */
  function board(g) {
    const hs = g.home_score, as = g.away_score, played = hs != null && as != null && g.status !== 'scheduled';
    const side = (t, c) => {
      const s = el('span', 'md-side ' + c);
      const n = el('b', 'md-nm', t.name || abbr(t));
      n.setAttribute('translate', 'no');
      if (c === 'h') s.append(crest(t), n); else s.append(n, crest(t));
      return s;
    };
    const pts = el('span', 'md-pts');
    if (played) pts.append(el('span', hs >= as ? 'w' : 'l', String(hs)), el('i', null, '–'), el('span', as >= hs ? 'w' : 'l', String(as)));
    else pts.append(el('span', 'w', tr('VS')));
    const b = el('div', 'md-board');
    b.append(side(g.home, 'h'), pts, side(g.away, 'a'));
    return b;
  }

  /* A TILE, PRINTED LIKE THE SITE'S OTHER CARDS (the club plate's halftone and registration crosses, the news cards'
     corner tag, the games list's scoreboard): the video's own picture with its home club's ink rising into its foot as
     a halftone, the printer's crosses at its corners, its kind in a black tag, a square play mark; a stencil band
     across the seam (the competition and the day); for a game's video the scoreboard; the title; where it is from, how
     long ago, and its edition mark (NO 03/07). The large tile adds scan lines. The words are the kit's Archivo; all of
     it is CSS over the one picture: nothing more is fetched for it. onOpen(it) on a press; a tile is a button.
     pos: {no, of}. */
  function tile(it, onOpen, big, pos) {
    const id = idOf(it);
    const k = KIND[it.video_kind] || KIND.video;
    const b = el('button', 'md-tile' + (big ? ' md-lead' : ''));
    b.type = 'button';
    b.dataset.id = it.id;
    inks(b, it);
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
    th.appendChild(el('span', 'md-tone'));
    ['tl', 'tr', 'bl', 'br'].forEach(c => th.appendChild(el('i', 'md-reg ' + c)));
    if (big) th.appendChild(el('span', 'md-scan'));
    th.append(el('span', 'md-kind' + (k[1] ? ' ' + k[1] : ''), tr(k[0])), el('span', 'md-play'));
    b.appendChild(th);
    const g = it.game && it.game.home && it.game.away ? it.game : null;
    const band = el('div', 'md-band');
    band.setAttribute('aria-hidden', 'true');
    band.appendChild(el('span', null, [g ? g.competition : it.source_name, day(g ? g.tipoff_at : it.published_at)].filter(Boolean).join('  ·  ')));
    b.appendChild(band);
    if (g) b.appendChild(board(g));
    else b.classList.add('no-game');
    const cap = el('div', 'md-cap');
    const t = el('div', 'md-title', it.title || '');
    const m = el('div', 'md-meta');
    if (it.source_logo) { const i = el('img', 'md-src'); i.src = String(it.source_logo).replace(/#fill$/, ''); i.alt = ''; i.loading = 'lazy'; m.appendChild(i); }
    m.appendChild(el('span', 'md-from', (it.source_name || '') + (it.published_at ? ' · ' + when(it.published_at) : '')));
    if (pos && pos.no) m.appendChild(el('span', 'md-ed', 'NO ' + String(pos.no).padStart(2, '0') + '/' + String(pos.of || pos.no).padStart(2, '0')));
    cap.append(t, m);
    b.appendChild(cap);
    b.setAttribute('aria-label', (it.title || 'video') + (it.source_name ? ', ' + it.source_name : ''));
    b.addEventListener('click', () => onOpen && onOpen(it, b));
    return b;
  }

  /* THE GAME, AS ITS EMBED: the modern box score (embed/game: the game page's modern view - the five on each floor on
     a half court, the bench beneath, a face for each player's full line - with the score over it), live by itself, in a
     frame. The frame says how tall it is (epinoiaEmbed 'height'); teamcolour.js gives it the page's light/dark and
     colours. */
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

  /* THE STAGE, wherever a tile opens one (the league's board, HOME's video feed): in the video's inks (its edge and its
     viewfinder corners), its head a NOW PLAYING mark with the video's kind, the title, where it is from and when, and
     Close. Returns the head; the caller puts the player and the game's embed under it. */
  function stageOpen(stage, it, onClose) {
    stage.hidden = false;
    stage.textContent = '';
    stage.style.cssText = '';
    inks(stage, it);
    const k = KIND[it.video_kind] || KIND.video;
    const head = el('div', 'md-stage-h');
    const words = el('div', 'md-stage-w');
    const now = el('div', 'md-now');
    now.append(el('span', 'md-dot'), el('span', null, tr('Now playing')), el('span', 'md-kind' + (k[1] ? ' ' + k[1] : ''), tr(k[0])));
    words.append(now, el('div', 'md-title', it.title || ''), el('div', 'md-yt', (it.source_name || '') + (it.published_at ? ' · ' + when(it.published_at) : '')));
    const close = el('button', 'ep-btn mini md-close', tr('Close'));
    close.type = 'button';
    close.addEventListener('click', onClose);
    head.append(words, close);
    stage.appendChild(head);
    return head;
  }

  /* A LEAGUE'S VIDEO BOARD, wherever a league shows its videos (the stats page's Video tab, the league's front page):
     HIGHLIGHTS or ALL VIDEOS, a club picker, the tiles (the newest large), MORE, and the stage above them - the video
     (nothing of YouTube until play) over the game's own embed, the page dark around them while it plays.
     opts: {leagueId, limit (a page, 24), param (the address key that opens one, 'vid'), empty (called when there is
     nothing at all to show)}. Resolves with how many videos the first page had. */
  function videoBoard(host, opts) {
    const o = Object.assign({ limit: 24, param: 'vid' }, opts || {});
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
    const getParam = () => o.param ? new URLSearchParams(location.search).get(o.param) : null;
    const setParam = v => {
      if (!o.param) return;
      const u = new URL(location.href);
      if (v) u.searchParams.set(o.param, v); else u.searchParams.delete(o.param);
      history.replaceState(null, '', u.toString());
    };
    let kind = 'highlights', club = '', items = [], last = null, playing = null, boxer = null, first = true;
    const chip = (label, k) => {
      const b = el('button', 'md-chip', tr(label));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(kind === k));
      b.addEventListener('click', () => {
        if (kind === k) return;
        kind = k; items = []; last = null;
        bar.querySelectorAll('.md-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        page();
      });
      return b;
    };
    const pick = el('select', 'md-select');
    pick.setAttribute('aria-label', tr('Club'));
    pick.addEventListener('change', () => { club = pick.value; paint(); });
    const seg = el('div', 'md-seg');
    seg.setAttribute('role', 'group');
    seg.append(chip('Highlights', 'highlights'), chip('All videos', null));
    /* how many are on the board, beside a little level meter (the kit's pixel bars) */
    const count = el('span', 'md-note');
    count.setAttribute('aria-live', 'polite');
    bar.append(seg, pick, count);

    function clubsOf() {
      const seen = new Map();
      items.forEach(it => { const g = it.game; if (g) [g.home, g.away].forEach(t => t && t.slug && seen.set(t.slug, t.name)); });
      const keep = club;
      pick.textContent = '';
      const all = el('option', null, tr('Every club')); all.value = ''; pick.appendChild(all);
      [...seen].sort((a, b) => a[1].localeCompare(b[1])).forEach(([slug, name]) => { const op = el('option', null, name); op.value = slug; pick.appendChild(op); });
      pick.value = seen.has(keep) ? keep : '';
      pick.hidden = seen.size < 2;
    }
    function paint() {
      grid.textContent = '';
      const shown = items.filter(it => !club || (it.game && [it.game.home, it.game.away].some(t => t && t.slug === club)));
      count.textContent = shown.length ? String(shown.length).padStart(2, '0') + ' ' + tr(kind === 'highlights' ? 'highlights' : 'videos') : '';
      if (!shown.length) { grid.appendChild(el('div', 'md-empty', tr(kind === 'highlights' ? 'No highlights yet.' : 'No videos yet.'))); return; }
      shown.forEach((it, i) => {
        const t = tile(it, play, i === 0, { no: i + 1, of: shown.length });
        if (playing && playing.id === it.id) t.setAttribute('aria-current', 'true');
        grid.appendChild(t);
      });
    }
    async function page() {
      if (!items.length) { grid.textContent = ''; for (let i = 0; i < 6; i++) grid.appendChild(el('div', 'md-skel')); }
      const rows = (await rpc('league_videos', { p_league: o.leagueId, p_kind: kind, p_before: last, p_limit: o.limit }).catch(() => null)) || [];
      items = items.concat(rows);
      last = rows.length ? rows[rows.length - 1].published_at : last;
      more.hidden = rows.length < o.limit;
      clubsOf(); paint();
      const want = getParam();
      if (want && !playing) { const it = items.find(x => x.id === want); if (it) play(it, null, true); }
      if (first) {
        first = false;
        /* no highlights yet but other videos: open on all of them */
        if (!rows.length && kind === 'highlights') { bar.querySelectorAll('.md-chip')[1].click(); return 0; }
        if (!rows.length && o.empty) o.empty();
      }
      return rows.length;
    }
    more.addEventListener('click', page);
    function play(it, _btn, quiet) {
      playing = it;
      stageOpen(stage, it, () => { cineExit(true); stage.hidden = true; stage.textContent = ''; if (boxer) boxer.stop(); boxer = null; playing = null; setParam(null); paint(); });
      const vid = el('div');
      stage.appendChild(vid);
      const id = idOf(it);
      if (id) player(vid, { id, title: it.title, autoplay: !quiet, group: stage });
      if (boxer) boxer.stop();
      boxer = null;
      if (it.game && it.game.id) { const box = el('div', 'md-boxwrap'); stage.appendChild(box); boxer = embedGame(box, it.game.id); }
      setParam(it.id);
      paint();
      if (!quiet) stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
    return page();
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

  window.EpinoiaMedia = { load, css, player, playFrame, cineEnter, cineExit, embedGame, videoBoard, stageOpen, tile, inks, crest, abbr, when, day, idOf, thumb, rest, rpc, token, idle, el, tr, BASE };
})();
