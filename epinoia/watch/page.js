'use strict';
/* ============================================================================
   watch/ - one game video as its own page (2026-10-07), built to the page standard (docs/page-standard.md).

   A BAKED COPY (tools/build-seo.py: watch/<home>-v-<away>-<kind>-<id>.html) arrives drawn: the head, the video's cover,
   the result and the game's other videos are in the HTML, with what this script needs in <script id="wpData">. Here the
   cover becomes the player (media.js player: youtube-nocookie, made only when pressed) and the box score is put under
   the result when the reader nears it (one frame, so a reader who leaves at the video costs no box-score reads). The
   page wears the league's colours (nav.js, from __CS_LEAGUE_SLUG).

   THE BARE PAGE (watch/?g=<game>&v=<youtube id>: a game page's video tab links here) goes to the video's own address
   when the last build wrote one (watch/paths.json), else draws the video from the game's own list (0237 game_highlights).
   ============================================================================ */
(function () {
  const M = window.EpinoiaMedia;
  const frame = document.getElementById('watch');
  if (!M || !frame) return;
  const VID = /^[A-Za-z0-9_-]{6,20}$/;
  const UUID = /^[0-9a-f-]{36}$/i;
  const $ = id => document.getElementById(id);
  const KIND = { highlights: 'Highlights', full: 'Full game', press: 'Press conference', video: 'Video' };

  function data() {
    const s = $('wpData');
    if (!s) return null;
    try { return JSON.parse(s.textContent); } catch (_) { return null; }
  }

  function league(slug) {
    if (!slug) return;
    try { window.__CS_LEAGUE_SLUG = slug; } catch (_) { /* nav.js keeps its own */ }
  }

  function playerIn(host, id, title) {
    if (!host || !VID.test(id || '')) return;
    M.player(host, { id, title });
  }

  /* the box score, once, when the reader is near it */
  function boxWhenNear(host, gameId) {
    if (!host || !UUID.test(gameId || '')) return;
    let done = false;
    const go = () => { if (done) return; done = true; M.embedGame(host, gameId, {}); };
    if (!('IntersectionObserver' in window)) { go(); return; }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); }
    }, { rootMargin: '400px 0px' });
    io.observe(host);
  }

  function baked(d) {
    league(d.league);
    playerIn($('wpPlayer'), d.video, d.title);
    boxWhenNear($('wpBox'), d.game);
    if (d.kind === 'Full game') offerTagging(d);
  }

  /* A FULL GAME, FOR THE PEOPLE WHO MAY ATTACH ITS VIDEO: a way to the tagger (videotag.js), where each play
     is placed on the footage by hand. The tagger works on the game's own video (game_videos), so the link
     says whether that is this one. Asked of the database (may_attach_video), never guessed; a reader who is
     not signed in, or not allowed, sees nothing and costs one read at most. */
  async function offerTagging(d) {
    if (!UUID.test(d.game || '')) return;
    for (let i = 0; i < 6 && !M.token(); i++) await new Promise(r => setTimeout(r, 500));   // the session restores
    if (!M.token()) return;
    let may = false;
    try { may = (await M.rpc('may_attach_video', { p_game: d.game }, { auth: true })) === true; } catch (_) { may = false; }
    if (!may) return;
    let own = null;
    try {
      const rows = await M.rest('game_videos?game_id=eq.' + encodeURIComponent(d.game) + '&is_primary=eq.true&select=url,video_ref&limit=1');
      own = rows && rows[0] ? rows[0] : null;
    } catch (_) { own = null; }
    if (!own || !own.url) return;            // nothing attached to the game to tag
    const same = own.video_ref === d.video || (own.url || '').indexOf(d.video) !== -1;
    const h = $('videoH');
    const head = h && h.parentElement;
    if (!head || head.querySelector('.wp-tag')) return;
    const a = M.el('a', 'showall wp-tag', same ? M.tr('tag plays in this video') + ' →' : M.tr('tag plays in the game’s own video') + ' →');
    a.href = '../game/?g=' + encodeURIComponent(d.game) + '&tag=1';
    a.title = M.tr('Place each play on the footage by hand (admins of this game)');
    head.appendChild(a);
  }

  /* ---------------------------------------------------------------- the bare page */
  function empty() {
    frame.querySelectorAll('.wp-skel').forEach(n => n.remove());
    const e = $('wpEmpty');
    if (e) e.hidden = false;
  }

  function dayOf(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString(document.documentElement.lang || 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return String(iso).slice(0, 10); }
  }

  /* a section of the standard: .sec with an id, its title (h2) and one-line subtitle, then its body */
  function section(id, title, note, link) {
    const s = M.el('section', 'sec');
    s.id = id;
    s.setAttribute('aria-labelledby', id + 'H');
    const h = M.el('div', 'sec-h');
    const h2 = M.el('h2', null, title);
    h2.id = id + 'H';
    h.append(h2, M.el('p', 'note', note));
    if (link) h.appendChild(link);
    const b = M.el('div', 'sec-b');
    s.append(h, b);
    return { s, b };
  }
  function link(text, href, ext) {
    const a = M.el('a', 'showall', text);
    a.href = href;
    if (ext) { a.rel = 'noopener'; a.target = '_blank'; }
    return a;
  }

  function draw(game, it, list) {
    const kind = M.tr(KIND[it.video_kind] || 'Video');
    const t = $('wpTitle');
    if (t) { t.textContent = (it.title || M.tr('Game video')) + ' '; t.appendChild(M.el('span', 'wp-kind', kind)); }
    const sub = $('wpDesc');
    const day = dayOf(it.published_at);
    if (sub) sub.textContent = M.tr('The video, with the result and the full box score under it.');
    frame.querySelectorAll('section.sec').forEach(n => n.remove());
    const at = $('wpHead');
    const v = section('video', kind, [it.source_name ? M.tr('From') + ' ' + it.source_name : '', day].filter(Boolean).join(', ').slice(0, 70) || M.tr('The game’s video, played here'),
      link(M.tr('on YouTube') + ' ↗', 'https://www.youtube.com/watch?v=' + encodeURIComponent(it.video_id), true));
    const fig = M.el('figure', 'wp-stage');
    const pl = M.el('div', 'wp-player');
    pl.id = 'wpPlayer';
    fig.appendChild(pl);
    v.b.appendChild(fig);
    const g = section('game', M.tr('The game'), M.tr('The result, both clubs and the full box score'),
      link(M.tr('box score, play-by-play and shot chart') + ' →', '../game/?g=' + encodeURIComponent(game)));
    const box = M.el('div', 'wp-box');
    g.b.appendChild(box);
    const parts = [v.s, g.s];
    const others = list.filter(x => x.video_id !== it.video_id && VID.test(x.video_id || ''));
    if (others.length) {
      const mo = section('more', M.tr('More from this game'), M.tr('The game’s other videos, each on its own page'));
      const ul = M.el('ul', 'wp-more');
      others.forEach(o => {
        const li = M.el('li'), a = M.el('a');
        a.href = '?g=' + encodeURIComponent(game) + '&v=' + encodeURIComponent(o.video_id);
        const img = M.el('img'); img.src = M.thumb(o.video_id); img.alt = ''; img.loading = 'lazy';
        a.append(img, M.el('span', 'wp-mk', M.tr(KIND[o.video_kind] || 'Video')), M.el('span', 'wp-mt', o.title || ''));
        li.appendChild(a); ul.appendChild(li);
      });
      mo.b.appendChild(ul);
      parts.push(mo.s);
    }
    if (at) at.after(...parts); else frame.append(...parts);
    document.title = (it.title || M.tr('Game video')) + ' | Epinoia';
    playerIn(pl, it.video_id, it.title);
    boxWhenNear(box, game);
  }

  async function bare() {
    const q = new URLSearchParams(location.search);
    const game = q.get('g') || '', v = q.get('v') || '';
    if (!UUID.test(game)) { empty(); return; }
    if (VID.test(v)) {
      try {
        const r = await fetch('paths.json', { cache: 'no-cache' });
        const paths = r.ok ? await r.json() : null;
        const to = paths && paths[v];
        if (typeof to === 'string' && /^\/epinoia\/watch\/[A-Za-z0-9_.-]+\.html$/.test(to)) { location.replace(to); return; }
      } catch (_) { /* no list yet: drawn from the game's own */ }
    }
    let list = [];
    try { list = await M.rpc('game_highlights', { p_game: game }); } catch (_) { list = []; }
    list = (Array.isArray(list) ? list : []).filter(x => x && VID.test(x.video_id || ''));
    const it = list.find(x => x.video_id === v) || list[0];
    if (!it) { empty(); return; }
    draw(game, it, list);
  }

  const d = data();
  if (d) baked(d); else bare();
})();
