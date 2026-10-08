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
    if (group.dataset && group.dataset.mdWide === 'auto' && !WIDE.refused && !isWide()) wide(true);
    if (CINE.group === group) return;
    if (CINE.group) cineExit(true);
    CINE.group = group;
    const veil = CINE.veil || (CINE.veil = el('div', 'md-veil'));
    veil.setAttribute('aria-hidden', 'true');
    veil.onclick = () => cineExit();
    document.body.appendChild(veil);
    /* a transformed, filtered or isolated ancestor would hold the group under the veil: those are flattened while it lasts */
    for (let a = group.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain)
          || cs.isolation === 'isolate') {
        CINE.lifted.push([a, a.style.transform, a.style.filter, a.style.perspective, a.style.contain, a.style.isolation]);
        a.style.transform = 'none'; a.style.filter = 'none'; a.style.perspective = 'none'; a.style.contain = 'none'; a.style.isolation = 'auto';
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
      CINE.lifted.forEach(([a, t, f, p, c, i]) => { a.style.transform = t; a.style.filter = f; a.style.perspective = p; a.style.contain = c; a.style.isolation = i || ''; });
      CINE.lifted = [];
      if (veil && veil.isConnected) veil.remove();
    };
    CINE.group = null;
    if (now || reduced()) done(); else setTimeout(done, 460);
  }
  /* WIDE: the side menu slides away and the page takes the whole width of the screen, so the player does too
     (kit/media.css html.md-wide; a desktop's menu only - a phone's is a bar along the foot). It comes on by itself when a
     video starts playing on a stage that asks for it (data-md-wide="auto": the playlist's stage, HOME's VIDEO theatre),
     and a WIDE toggle in the player's head turns it on and off by hand; turned off by hand, it stays off for that
     stage until it is closed. Closing the stage gives the menu back. */
  const WIDE = { refused: false };
  const isWide = () => document.documentElement.classList.contains('md-wide');
  function wide(on) {
    document.documentElement.classList.toggle('md-wide', !!on);
    document.querySelectorAll('.md-widebtn').forEach(b => { b.setAttribute('aria-pressed', String(!!on)); b.lastChild.textContent = on ? tr('Menu') : tr('Wide'); });
  }
  function wideReset() { WIDE.refused = false; wide(false); }
  function wideButton() {
    const b = el('button', 'ep-btn mini md-widebtn');
    b.type = 'button';
    b.title = tr('Hide the menu and play across the whole screen');
    b.setAttribute('aria-pressed', String(isWide()));
    b.append(el('span', 'ic'), el('span', null, isWide() ? tr('Menu') : tr('Wide')));
    b.addEventListener('click', () => { const on = !isWide(); WIDE.refused = !on; wide(on); });
    return b;
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
  /* onEnd(): called when the video ends; true when the page has taken it (the next of a list is coming), so the dark stays */
  function watchYouTube(f, group, onEnd) {
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
      else if (st === 0) { if (!(onEnd && onEnd())) cineExitSoon(); }
      else if (st === 2) cineExitSoon();
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
  function playFrame(at, src, title, group, onEnd) {
    const f = document.createElement('iframe');
    const yt = /^https:\/\/www\.youtube(-nocookie)?\.com\//.test(src);
    f.src = yt ? src + (src.includes('?') ? '&' : '?') + 'enablejsapi=1&origin=' + encodeURIComponent(location.origin) : src;
    f.title = title || 'video';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    at.replaceWith(f);
    if (yt) watchYouTube(f, group, onEnd); else if (group) cineEnter(group);
    return f;
  }

  /* THE PLAYER: the cover until pressed, then youtube-nocookie with autoplay.
     opts: {id, title, start (s), autoplay, group (what stays lit with it while it plays), onEnd (the video ended: true
     when the page has taken it), onFrame(f) (the frame, once it is made)} */
  function player(host, opts) {
    host.textContent = '';
    host.classList.add('md-player');
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', tr('Play') + ': ' + (opts.title || 'video'));
    const img = el('img'); img.src = thumb(opts.id, true); img.alt = ''; img.decoding = 'async';
    b.append(img, el('span', 'md-play'));
    b.addEventListener('click', () => {
      const f = playFrame(b, 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(opts.id) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1'
        + (opts.start ? '&start=' + Math.max(0, Math.floor(opts.start)) : ''), opts.title, opts.group, opts.onEnd);
      if (opts.onFrame) opts.onFrame(f);
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
  /* how long ago, in the news cards' words (newscard.js ago): just now, 2 h ago, yesterday, 3 days ago, 12 Sep */
  function when(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return tr('just now');
    if (s < 3600) return Math.floor(s / 60) + ' ' + tr('min ago');
    if (s < 86400) return Math.floor(s / 3600) + ' ' + tr('h ago');
    if (s < 2 * 86400) return tr('yesterday');
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' ' + tr('days ago');
    try { return d.toLocaleDateString(document.documentElement.lang || 'en-GB', { day: 'numeric', month: 'short' }); } catch (_) { return String(iso).slice(0, 10); }
  }
  const KIND = { highlights: ['HIGHLIGHTS', ''], full: ['FULL GAME', 'f'], press: ['PRESS CONFERENCE', 'p'], video: ['VIDEO', 'v'] };
  /* ONE TILE A VIDEO. A channel added twice (a league's own and the platform's) reads each of its videos twice, as two
     stories; the board shows it once, the copy that is on a game if one is. */
  /* A STREAM STILL TO COME is no video yet: a channel publishes its "LIVE ..." stream days before the game, the matcher puts
     it on the fixture as a full game, and LATEST VIDEOS showed a FULL GAME of a game nobody had played (Louie, 2026-10-08).
     It belongs in the VIDEO view's LIVE, under SCHEDULED (home/videohub.js), and on the fixture's WATCH pill (watch.js);
     every list of videos leaves it out (uniq, below, is the one every list goes through). */
  function upcoming(r) {
    return !!(r && r.video_kind === 'full' && r.game && r.game.status === 'scheduled');
  }
  function uniq(list) {
    const at = new Map(), out = [];
    (list || []).forEach(r => {
      const k = r && (r.video_id || r.id);
      if (!k || upcoming(r)) return;
      if (!at.has(k)) { at.set(k, out.length); out.push(r); }
      else if (r.game && !out[at.get(k)].game) out[at.get(k)] = r;
    });
    return out;
  }

  /* HIGHLIGHTS FIRST, wherever a game's highlights and other videos are shown together (HOME's All, a league's All
     videos, a club's). The rows keep the order they came in (the feed's ranking, or newest first), except that:
       * a game's highlights from the last FRESH_DAYS lead, in that order, and an older one moves up LIFT places;
       * highlights on no game (a cup's, a player's, a week's best) from the last FRESH_DAYS move up HL_LIFT places, an
         older one LIFT / 2 (2026-10-07: they had no lift at all);
       * anything that looks like a YouTube Short (feedrank.js isShort) goes to the very end. */
  const FRESH_DAYS = 7, LIFT = 8, HL_LIFT = 12;
  function prioritise(rows, now) {
    const t = now || Date.now();
    const F = window.EpinoiaFeedRank;
    return (rows || []).map((r, i) => {
      const hl = !!r && r.video_kind === 'highlights';
      const fresh = hl && (t - new Date(r.published_at).getTime()) <= FRESH_DAYS * 86400000;
      const short = !!(F && typeof F.isShort === 'function' && F.isShort(r));
      const k = short ? i + 1e6
        : hl && r.game ? (fresh ? i - 1e6 : i - LIFT - 0.5)
        : hl ? (fresh ? i - HL_LIFT - 0.5 : i - LIFT / 2 - 0.5) : i;
      return { r, k };
    }).sort((a, b) => a.k - b.k).map(x => x.r);
  }

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
  /* A COLOUR ON BLACK, whatever the page's own light or dark: HOME's VIDEO view is black on both (videohub.js), so its
     inks are made for that ground - lifted towards white until they read as text (6.5:1) or show as a surface (1.6:1) */
  const DARK_GROUND = [4, 16, 11];
  function onBlack(hex, min) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    let c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const lum = x => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]); };
    const ratio = (a, b) => { const x = lum(a) + 0.05, y = lum(b) + 0.05; return x > y ? x / y : y / x; };
    for (let i = 0; i < 28 && ratio(c, DARK_GROUND) < min; i++) c = c.map(v => v + (255 - v) * 0.09);
    return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function inks(node, it, dark) {
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
      if (dark) {
        const B2 = B || (TC.derived ? TC.derived(A) : A);
        node.style.setProperty('--ink-t', onBlack(A, 6.5)); node.style.setProperty('--ink-t2', onBlack(B2, 6.5));
        node.style.setProperty('--ink-s', onBlack(A, 1.6)); node.style.setProperty('--ink-s2', onBlack(B2, 1.6));
      }
    } else { node.style.setProperty('--ink-c', A); if (B) node.style.setProperty('--ink-c2', B); }
  }
  /* THE CHANNEL'S COLOUR, as a news card colours its brand (newscard.js: its own colour, else one made from its name, so
     a channel's videos and its stories wear the same block in the kicker) */
  function brand(node, it) {
    const own = HEX.test((it && it.source_colour) || '') ? it.source_colour : null;
    let h = 0;
    for (const ch of String((it && it.source_name) || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    node.style.setProperty('--bc', own || 'hsl(' + h + ' 52% 46%)');
    const TC = window.EpinoiaTeamColour;
    node.style.setProperty('--bc-on', own && TC && TC.on ? TC.on(own) : '#fff');
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
     across the seam (the competition and the day); for a game's video the scoreboard; the title; where it is from and how
     long ago (no numbering since 2026-10-07). The large tile adds scan lines. The words are the kit's Archivo; all of
     it is CSS over the one picture: nothing more is fetched for it. onOpen(it) on a press; a tile is a button.
     pos: {no, of}. */
  function tile(it, onOpen, big, pos) {
    const dark = !!(pos && pos.dark);
    const id = idOf(it);
    const k = KIND[it.video_kind] || KIND.video;
    const b = el('button', 'md-tile' + (big ? ' md-lead' : ''));
    b.type = 'button';
    b.dataset.id = it.id;
    inks(b, it, dark);
    brand(b, it);
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
    /* THE WORDS, AS A NEWS CARD SETS THEM (kit/newscard.css): the kicker - the channel in its colour, how long ago - then
       the headline (no "NO 01/04" numbering: 2026-10-07); the foot under a dashed rule, the channel's logo and name and the
       call to watch */
    const cap = el('div', 'md-cap');
    const kick = el('div', 'md-kick');
    kick.appendChild(el('b', null, it.source_name || tr(k[0])));
    const ago = when(it.published_at);
    if (ago) kick.appendChild(el('span', null, ago));
    cap.append(kick, el('div', 'md-title', it.title || ''));
    b.appendChild(cap);
    const foot = el('div', 'md-foot');
    const from = el('span', 'md-from');
    if (it.source_logo) {
      const lg = el('span', 'md-src');
      const i = el('img'); i.src = String(it.source_logo).replace(/#fill$/, ''); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async';
      i.addEventListener('error', () => lg.remove());
      lg.appendChild(i);
      from.appendChild(lg);
    }
    from.appendChild(el('span', null, it.source_name || ''));
    foot.append(from, el('span', 'md-go', tr('Watch') + ' · YouTube →'));
    b.appendChild(foot);
    b.setAttribute('aria-label', (it.title || 'video') + (it.source_name ? ', ' + it.source_name : ''));
    b.addEventListener('click', () => onOpen && onOpen(it, b));
    return b;
  }

  /* THE GAME, AS ITS EMBED: the modern box score (embed/game: the game page's modern view - the five on each floor on
     a half court, the bench beneath, a face for each player's full line - with the score over it), live by itself, in a
     frame. The frame says how tall it is (epinoiaEmbed 'height'); teamcolour.js gives it the page's light/dark and
     colours. */
  /* opts: { theme: 'dark' (the frame keeps it), fit: true (the whole box score in one screen: embed/game fit()) } */
  const FIT_GAP = 44;                                       // the box's own padding and a little air, above and below
  /* the screen's height in the frame's own pixels: the kit zooms the page on a wide screen (epinoia-kit.css: 1.25, 1.5)
     and the frame with it, so a 900px screen holds 600 of the frame's pixels at 1.5 */
  function zoomOf(node) {
    try {
      const r = node.getBoundingClientRect().height, o = node.offsetHeight;
      if (o > 0 && r > 0) return r / o;
      return parseFloat(getComputedStyle(document.body).zoom) || 1;
    } catch (_) { return 1; }
  }
  const fitHeight = node => Math.max(300, Math.round((window.innerHeight || 800) / zoomOf(node) - FIT_GAP));
  function embedGame(host, gameId, opts) {
    const eo = opts || {};
    host.textContent = '';
    const f = document.createElement('iframe');
    f.src = BASE + 'embed/game/?g=' + encodeURIComponent(gameId) + (eo.theme ? '&theme=' + encodeURIComponent(eo.theme) : '') + (eo.fit ? '&fit=1' : '')
      + (eo.story ? '&story=1' : '');
    /* a frame that keeps its own theme (the VIDEO view's dark): the page's light/dark is not sent to it (teamcolour.js) */
    if (eo.theme) f.setAttribute('data-own-theme', eo.theme);
    f.title = tr('Box score');
    /* eo.story(story): the game's storylines, worked out by the frame from what it holds (embed/game storyOf) for the drawer
       over the video (storyline.js) - so the frame is loaded at once, not when the page reaches it */
    f.loading = eo.story ? 'eager' : 'lazy';
    f.className = 'md-embed';
    /* THE HOST SPEAKS FOR THE FRAME: its theme, as the page that holds it - so the reader's own light/dark switch, kept
       for every embed on this site, does not paint a light box score into the black VIDEO view - and, to fit, how tall
       the screen is now. Said when the frame loads, when it asks, and when the window changes size. */
    const tell = () => {
      const w = f.contentWindow;
      if (!w) return;
      try {
        if (eo.theme) w.postMessage({ epinoiaEmbed: 'colourway', theme: eo.theme }, location.origin);
        if (eo.fit) w.postMessage({ epinoiaEmbed: 'fit', height: fitHeight(f) }, location.origin);
      } catch (_) { /* not ready: it asks */ }
    };
    const onMsg = ev => {
      if (ev.origin !== location.origin || ev.source !== f.contentWindow || !ev.data) return;
      if (ev.data.epinoiaEmbed === 'colourway?') { tell(); return; }
      if (ev.data.epinoiaEmbed === 'story') { if (eo.story && ev.data.story) { try { eo.story(ev.data.story); } catch (_) { /* the drawer's */ } } return; }
      if (ev.data.epinoiaEmbed !== 'height') return;
      const h = Number(ev.data.height);
      if (isFinite(h) && h >= 60 && h <= 2000) f.style.height = Math.ceil(h) + 'px';
    };
    window.addEventListener('message', onMsg);
    f.addEventListener('load', tell);
    let soon = null;
    const onResize = () => { clearTimeout(soon); soon = setTimeout(tell, 150); };
    if (eo.fit) window.addEventListener('resize', onResize);
    host.appendChild(f);
    return { frame: f, stop() { window.removeEventListener('message', onMsg); window.removeEventListener('resize', onResize); clearTimeout(soon); f.remove(); } };
  }

  /* THE WAY DOWN TO THE BOX SCORE: a tab hanging from the foot of the video - "Box score" and an arrow - that takes the
     reader down to the game's box score, out of sight under a video that fills the screen. target: the box (or a
     function giving it). */
  const CUE_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function boxCue(target) {
    const bar = el('div', 'md-cuebar');
    const b = el('button', 'md-cue');
    b.type = 'button';
    const a = el('span', 'md-cue-a');
    a.innerHTML = CUE_ARROW;
    b.append(el('span', 'md-cue-t', tr('Box score')), a);
    b.setAttribute('aria-label', tr('Down to the box score'));
    b.addEventListener('click', () => {
      const t = typeof target === 'function' ? target() : target;
      if (!t) return;
      const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      t.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      /* a frame above it (another box score, loaded as the page goes past) can grow while the page glides and push the
         box down: when the glide is over, the box is brought to the top again, at most three times */
      let tries = 0, last = null;
      const settle = () => {
        const top = t.getBoundingClientRect().top;
        const more = window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 2;
        if (tries++ >= 3 || Math.abs(top) < 40 || !more || (last !== null && Math.abs(top - last) < 2 && top < 40)) return;
        last = top;
        t.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
        setTimeout(settle, calm ? 120 : 700);
      };
      setTimeout(settle, calm ? 120 : 900);
    });
    bar.appendChild(b);
    return bar;
  }
  /* AND BACK UP, at the foot of the box score: on a phone the box score is a long way under the stream (the chat is
     between them), so whoever went down to it gets an arrow back to the video (kit/media.css shows it on phones only) */
  function upCue(target) {
    const bar = el('div', 'md-cuebar up');
    const b = el('button', 'md-cue up');
    b.type = 'button';
    const a = el('span', 'md-cue-a');
    a.innerHTML = CUE_ARROW;
    b.append(el('span', 'md-cue-t', tr('Video')), a);
    b.setAttribute('aria-label', tr('Back up to the video'));
    b.addEventListener('click', () => {
      const t = typeof target === 'function' ? target() : target;
      if (!t) return;
      const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      t.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
    bar.appendChild(b);
    return bar;
  }

  /* THE STAGE, wherever a tile opens one (the league's board, HOME's video feed): in the video's inks (its edge and its
     viewfinder corners), its head a NOW PLAYING mark with the video's kind, the title, where it is from and when, and
     Close. Returns the head; the caller puts the player and the game's embed under it. */
  /* THE STAGE, PLAYING DOWN A LIST: the videos in the order the board or the feed shows them (o.list()), as a playlist.
       * the head: NOW PLAYING with the video's kind, its title, where it is from; Up next (the list's toggle) and Close;
       * the player, and beside it (under it on a phone) UP NEXT - the video playing, then what comes after it, each a
         press away - with an Autoplay switch; the toggle and the switch are remembered on this device;
       * when a video ends and Autoplay is on, a card over the player says what is next and counts NEXT_IN seconds down
         (Play now, Cancel), then the next one plays IN THE SAME PLAYER (YouTube's own loadVideoById, through the frame's
         messages): nothing is loaded again, the sound stays on, and the page stays dark;
       * the game's box score under it follows the video (the same game kept, another game's swapped in, none taken away).
     o: { list: () => [videos], onClose(), onChange(it) (a video is now the stage's) } -> { play(it, quiet), go(it) } */
  const NEXT_IN = 5, Q_KEY = 'epinoia.md.upnext', AUTO_KEY = 'epinoia.md.autoplay';
  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (_) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (_) { /* private mode */ } };
  function stagePlayer(stage, o) {
    let cur = null, frame = null, boxer = null, timer = null, card = null, held = null, back = [], prevB = null, nextB = null;
    let open = pref(Q_KEY, !(window.matchMedia && matchMedia('(max-width: 720px)').matches));
    let auto = pref(AUTO_KEY, true);
    let nowKind, titleEl, metaEl, qBtn, body, vid, queue, qList, box, autoBox, qPos, cue, upBar;

    const playable = it => !!(it && idOf(it));
    function upcoming() {
      const L = ((o.list && o.list()) || []).filter(playable);
      const i = cur ? L.findIndex(x => x.id === cur.id) : -1;
      return i >= 0 ? L.slice(i + 1) : L.filter(x => !cur || x.id !== cur.id);
    }
    function build() {
      stage.hidden = false;
      stage.textContent = '';
      const head = el('div', 'md-stage-h');
      const words = el('div', 'md-stage-w');
      const now = el('div', 'md-now');
      nowKind = el('span', 'md-kind');
      now.append(el('span', 'md-dot'), el('span', null, tr('Now playing')), nowKind);
      titleEl = el('div', 'md-title');
      metaEl = el('div', 'md-yt');
      words.append(now, titleEl, metaEl);
      const ctl = el('div', 'md-stage-ctl');
      qBtn = el('button', 'ep-btn mini md-qbtn');
      qBtn.type = 'button';
      qBtn.addEventListener('click', () => { open = !open; setPref(Q_KEY, open); layout(); });
      const close = el('button', 'ep-btn mini md-close', tr('Close'));
      close.type = 'button';
      close.addEventListener('click', () => { stop(); if (o.onClose) o.onClose(); });
      /* BACK AND NEXT: back to the video played before this one (or the one before it in the list), on to the next */
      prevB = el('button', 'ep-btn mini md-prev', '‹ ' + tr('Back'));
      prevB.type = 'button';
      prevB.addEventListener('click', goBack);
      nextB = el('button', 'ep-btn mini md-fwd', tr('Next') + ' ›');
      nextB.type = 'button';
      nextB.addEventListener('click', () => { const nx = upcoming()[0]; if (nx) go(nx); });
      ctl.append(prevB, nextB, wideButton(), qBtn, close);
      stage.dataset.mdWide = 'auto';
      head.append(words, ctl);
      body = el('div', 'md-stage-b');
      vid = el('div');
      queue = el('aside', 'md-q');
      queue.setAttribute('aria-label', tr('Up next'));
      const qin = el('div', 'md-q-in');
      const qh = el('div', 'md-q-h');
      autoBox = el('input');
      autoBox.type = 'checkbox';
      autoBox.checked = auto;
      autoBox.addEventListener('change', () => { auto = autoBox.checked; setPref(AUTO_KEY, auto); if (!auto) cancelNext(); });
      const sw = el('label', 'md-auto');
      sw.append(autoBox, el('span', null, tr('Autoplay')));
      qPos = el('span', 'md-q-pos');
      const qt = el('span', 'md-q-ht');
      qt.append(el('b', null, tr('Up next')), qPos);
      qh.append(qt, sw);
      qList = el('div', 'md-q-list');
      qin.append(qh, qList);
      queue.appendChild(qin);
      body.append(vid, queue);
      box = el('div', 'md-boxwrap');
      /* the arrow down to the box score, hanging from the foot of the video, while the video has a game */
      cue = boxCue(box);
      cue.hidden = true;
      upBar = upCue(stage);
      upBar.hidden = true;
      stage.append(head, body, cue, box, upBar);
      stage.__md = { ended, upcoming };                     // the page's own handle (the tests end a video with it)
    }
    function stop() {
      cancelNext();
      cineExit(true); stage.hidden = true; stage.textContent = '';
      wideReset();
      if (boxer) boxer.stop();
      boxer = null; frame = null; cur = null;
      if (deck) deck.stop();
      deck = null; deckGame = null; deckStory = null;
    }
    function layout() {
      body.classList.toggle('q-open', open);
      queue.hidden = !open;
      qBtn.setAttribute('aria-expanded', String(open));
    }
    /* THE GAME'S STORYLINES at the foot of the video, while the video has a game (storyline.js; the box score frame works
       them out). The player is drawn afresh into `vid` on every play, so the drawer is put back after it (play). */
    let deck = null, deckGame = null, deckStory = null;
    function stageDeck(gid) {
      if (!gid) { if (deck) deck.stop(); deck = null; deckGame = null; deckStory = null; return; }
      if (deckGame !== gid) { deckGame = gid; deckStory = null; if (deck) deck.reset(); }
      if (deck) { if (!vid.contains(deck.el)) vid.appendChild(deck.el); return; }
      css('kit/storyline.css');
      load('storyline.js', 'EpinoiaStoryline').then(SL => {
        if (!SL || deckGame !== gid || stage.hidden || !vid) return;
        if (!deck) deck = SL.mount(vid, { tr });
        else if (!vid.contains(deck.el)) vid.appendChild(deck.el);
        if (deckStory) deck.update(deckStory);
      }).catch(() => { /* no drawer: the video as it was */ });
    }
    /* the head, the inks, the box score and the list, for `it` */
    function fill(it) {
      stage.style.cssText = '';
      inks(stage, it, o.dark);
      const k = KIND[it.video_kind] || KIND.video;
      nowKind.className = 'md-kind' + (k[1] ? ' ' + k[1] : '');
      nowKind.textContent = tr(k[0]);
      titleEl.textContent = it.title || '';
      metaEl.textContent = (it.source_name || '') + (it.published_at ? ' · ' + when(it.published_at) : '');
      const gid = it.game && it.game.id;
      if (!boxer || boxer.game !== gid) {
        if (boxer) boxer.stop();
        boxer = null;
        box.textContent = '';
        if (gid) {
          boxer = embedGame(box, gid, Object.assign(o.dark ? { theme: 'dark', fit: true } : { fit: true }, {
            story: s => { if (!s || s.game !== gid) return; deckStory = s; if (deck && deckGame === gid) deck.update(s); } }));
          boxer.game = gid;
        }
      }
      stageDeck(gid);
      box.hidden = !gid;
      cue.hidden = !gid;
      upBar.hidden = !gid;
      drawList();
    }
    function row(it, now, past) {
      const b = el('button', 'md-q-row' + (now ? ' now' : '') + (past ? ' past' : ''));
      b.type = 'button';
      if (now) b.setAttribute('aria-current', 'true');
      inks(b, it, o.dark);
      const th = el('span', 'md-q-th');
      const id = idOf(it);
      if (id) { const im = el('img'); im.src = thumb(id); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; th.appendChild(im); }
      const k = KIND[it.video_kind] || KIND.video;
      const tx = el('span', 'md-q-tx');
      tx.append(el('span', 'md-q-k' + (k[1] ? ' ' + k[1] : ''), now ? tr('Now playing') : tr(k[0])), el('span', 'md-q-t', it.title || ''),
                el('span', 'md-q-m', (it.source_name || '') + (it.published_at ? ' · ' + when(it.published_at) : '')));
      b.append(th, tx);
      if (!now) b.addEventListener('click', () => go(it));
      return b;
    }
    /* THE WHOLE LIST, not only what comes next: every video of the view, the one playing marked and brought to the top of
       the panel, the ones before it above (scroll up for them, a little dimmed), the ones after it below */
    function drawList() {
      const next = upcoming();
      const L = ((o.list && o.list()) || []).filter(playable);
      const at = cur ? L.findIndex(x => x.id === cur.id) : -1;
      qList.textContent = '';
      let nowRow = null;
      if (at < 0) { nowRow = row(cur, true); qList.appendChild(nowRow); next.forEach(it => qList.appendChild(row(it, false))); }
      else L.forEach((it, j) => { const r = row(it, j === at, j < at); if (j === at) nowRow = r; qList.appendChild(r); });
      if (!next.length) qList.appendChild(el('p', 'md-q-end', tr('Nothing after this one.')));
      qPos.textContent = at >= 0 && L.length > 1 ? (at + 1) + ' / ' + L.length : '';
      if (nowRow) requestAnimationFrame(() => { if (nowRow.isConnected) qList.scrollTop = Math.max(0, nowRow.offsetTop - qList.offsetTop - 6); });
      qBtn.textContent = tr('Up next') + (next.length ? ' · ' + next.length : '');
      nextB.disabled = !next.length;
      prevB.disabled = !(back.length || before());
      layout();
    }
    /* A VIDEO ENDED. With Autoplay on and something after it: the card, the count, then the next. True: the page has it. */
    function ended() {
      if (!auto || !cur || held === cur.id) return false;
      if (timer) return true;
      const nx = upcoming()[0];
      if (!nx) return false;
      let n = NEXT_IN;
      card = el('div', 'md-next');
      card.setAttribute('role', 'status');
      const im = el('img'); im.src = thumb(idOf(nx)); im.alt = '';
      const count = el('span', 'md-next-n');
      const tx = el('span', 'md-next-tx');
      tx.append(el('span', 'md-next-k', tr('Up next')), el('span', 'md-next-t', nx.title || ''), count);
      const now = el('button', 'ep-btn mini pri', tr('Play now'));
      now.type = 'button';
      now.addEventListener('click', () => swap(nx));
      const no = el('button', 'ep-btn mini', tr('Cancel'));
      no.type = 'button';
      no.addEventListener('click', () => { held = cur && cur.id; cancelNext(); cineExitSoon(); });
      const btns = el('span', 'md-next-b');
      btns.append(now, no);
      card.append(im, tx, btns);
      vid.appendChild(card);
      const tick = () => {
        if (n <= 0) { swap(nx); return; }
        count.textContent = tr('in') + ' ' + n + ' s';
        n -= 1;
        timer = setTimeout(tick, 1000);
      };
      tick();
      return true;
    }
    function cancelNext() { clearTimeout(timer); timer = null; if (card) card.remove(); card = null; }
    /* the next video IN THE SAME PLAYER: the frame is told to load it, so it plays at once, sound and all */
    /* the video before this one in the list, when nothing was played before it */
    function before() {
      const L = ((o.list && o.list()) || []).filter(playable);
      const i = cur ? L.findIndex(x => x.id === cur.id) : -1;
      return i > 0 ? L[i - 1] : null;
    }
    /* the one now playing goes on the way back, unless it is the way back being taken */
    function leave(it, returning) {
      if (!returning && cur && it && cur.id !== it.id) { back.push(cur); if (back.length > 50) back.shift(); }
    }
    function goBack() {
      const prev = back.pop() || before();
      if (prev) go(prev, true);
    }
    function swap(it, returning) {
      cancelNext();
      if (!frame || !frame.isConnected) return play(it, false, returning);
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'loadVideoById', args: [idOf(it)], id: 'md', channel: 'widget' }), '*');
      } catch (_) { return play(it, false, returning); }
      held = null;
      leave(it, returning);
      cur = it;
      frame.title = it.title || 'video';
      fill(it);
      if (o.onChange) o.onChange(it);
    }
    /* A VIDEO ON THE STAGE, from its cover (quiet: opened by the address, so nothing plays and nothing scrolls) */
    function play(it, quiet, returning) {
      cancelNext();
      if (stage.hidden || !body || !stage.contains(body)) { build(); back = []; }
      held = null;
      leave(it, returning);
      cur = it;
      frame = null;
      fill(it);
      vid.textContent = '';
      const id = idOf(it);
      if (id) player(vid, { id, title: it.title, autoplay: !quiet, group: stage, onEnd: ended, onFrame: f => { frame = f; } });
      if (deck && deckGame && it.game && it.game.id === deckGame) vid.appendChild(deck.el);
      if (o.onChange) o.onChange(it);
      if (!quiet) stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
    /* a tile or a row pressed: into the playing player when one is playing, else onto the stage */
    function go(it, returning) {
      if (frame && frame.isConnected && playable(it) && !stage.hidden) {
        swap(it, returning);
        stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
      } else play(it, false, returning);
    }
    return { play, go, back: goBack, stop, refresh: () => { if (cur && !stage.hidden) drawList(); } };
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
    let kind = 'highlights', club = '', items = [], last = null, playing = null, first = true, shownNow = [];
    /* the stage plays down the board, in the order its tiles stand (a club picked: that club's) */
    const sp = stagePlayer(stage, {
      list: () => shownNow,
      onClose: () => { playing = null; setParam(null); paint(); },
      onChange: it => { playing = it; setParam(it.id); paint(); }
    });
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
      const picked = items.filter(it => !club || (it.game && [it.game.home, it.game.away].some(t => t && t.slug === club)));
      const shown = kind ? picked : prioritise(picked);           // All videos: the games' highlights lead
      shownNow = shown;
      sp.refresh();
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
      items = uniq(items.concat(rows));
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
    /* a tile pressed: onto the stage, or into its player when one is playing; quiet: opened by the address */
    function play(it, _btn, quiet) {
      if (quiet) sp.play(it, true); else sp.go(it);
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

  window.EpinoiaMedia = { load, css, player, playFrame, cineEnter, cineExit, embedGame, boxCue, upCue, videoBoard, stagePlayer, wide, wideButton, wideReset, tile, inks, uniq, upcoming, prioritise, crest, abbr, when, day, idOf, thumb, rest, rpc, token, idle, el, tr, BASE };
})();
