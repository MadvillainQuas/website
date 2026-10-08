'use strict';
/* ============================================================================
   WHERE TO WATCH — the little pill under a fixture's "v" or score, and its card.

   Every league EPINOIA knows a broadcaster for has one entry below: how the games can be seen (free, a
   subscription, or a note), and the links. The entries are made from the streaming spreadsheet by
   tools/build-watch.py — edit the sheet and run it; do not edit the block by hand.

     EpinoiaWatch.of(slug)          -> the league's entry, or null
     EpinoiaWatch.pill(slug, opts)  -> <button class="ep-watch"> (null for a league with no entry)
                                       opts.big: the game page's larger pill
     EpinoiaWatch.site(id, cb)      -> cb(kind) when the site itself has a video for the game (0255, one read a page)
     EpinoiaWatch.sitePill(id, k)   -> the pill for that video, in any league: a press into the site's own player

   THE PILL SITS INSIDE A CARD THAT IS ITSELF A LINK, so a tap on it must never reach the card: its click is
   stopped, and the card it opens lives on <body>, outside every card. With a mouse the card opens on hover
   (and stays while the pointer moves onto it); a click or a tap pins it open, a second one, Escape, or a
   tap anywhere else closes it. Its links open in a new tab.

   THE KIT ZOOMS <body> ON A DESKTOP (1.25 / 1.5): a fixed card inside it is placed in unzoomed pixels, while
   getBoundingClientRect answers in zoomed ones, so the pill's box is divided by the zoom before the card is
   placed.
   ============================================================================ */
(function (root) {
  /* where this file is: the site's own pages are found from it (WATCH HERE's link to HOME's VIDEO view) */
  const SRC = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : '';
  const DATA = /* WATCH-DATA:BEGIN */
{
"aba-league": {"n": "AdmiralBet ABA League", "k": "free", "a": "Free, full replays available on YouTube", "l": [["YouTube · ABAligajtd", "https://www.youtube.com/@ABAligajtd/playlists"]]},
"aba-league-2": {"n": "NLB ABA League 2", "k": "free", "a": "Free, full replays available on YouTube", "l": [["YouTube · ABAligajtd", "https://www.youtube.com/@ABAligajtd/videos"]]},
"basketligaen": {"n": "Basketligaen", "k": "paid", "a": "Subscription-based", "l": [["Jysk Fynske Medier", "https://basketligaen.dk/se-basketligaen-pa-jysk-fynske-medier/"]]},
"basketligan": {"n": "Svenska Basketligan", "k": "paid", "a": "Subscription-based (single-game purchase possible)", "l": [["SBL Play", "https://www.sblplay.se/"]]},
"bbl": {"n": "easycredit BBL", "k": "paid", "a": "Subscription-based, 40 games streamed for free (VPN required)", "l": [["Dyn", "https://dynmedia.com"], ["YouTube playlist", "https://www.youtube.com/playlist?list=PLRd4ycxjS7YvW2-LCuEGTxlA7WTo5GhyA"]]},
"bnxt-league": {"n": "betFirst BNXT League", "k": "paid", "a": "Subscription-based", "l": [["BNXT TV", "https://www.bnxt.tv/"]]},
"czech-nbl": {"n": "National Basketball League", "k": "free", "a": "Free", "l": [["TVCOM", "https://www.tvcom.cz/Zapasy/Sport-Basketbal/Soutez-Kooperativa-NBL/Pohlavi-Muzi/"]]},
"estonian-latvian-basketball-league": {"n": "Latvian-Estonian Basketball League", "k": "info", "a": "League recently shifted away from streaming games on YouTube, check website for broadcasters", "l": [["YouTube channel", "https://www.youtube.com/channel/UCg6hLhhgvJePwoiFY_f0zzw/videos"], ["Game centre", "https://www.estlatbl.com/en/game-center"]]},
"eurocup": {"n": "BKT EuroCup", "k": "paid", "a": "Subscription-based (available as a bundle with EuroLeague)", "l": [["EuroLeague TV", "https://tv.euroleague.net"]]},
"euroleague": {"n": "EuroLeague", "k": "paid", "a": "Subscription-based (available as a bundle with EuroCup)", "l": [["EuroLeague TV", "https://tv.euroleague.net"]]},
"greek-elite-league": {"n": "Elite League", "k": "free", "a": "Free (select number of games available)", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PLL21i4p0ebrrI3nDKgYReRhBPfLpRXXVr"]]},
"korisliiga": {"n": "Korisliiga", "k": "paid", "a": "Subscription-based", "l": [["Ruutu", "https://www.ruutu.fi/ohjelmat/korisliiga"]]},
"kosovo-superliga": {"n": "ProCredit Superliga", "k": "free", "a": "Free (select number of games available)", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PLtEFICRB5G4Af1NCaSjIl7OdNQnrKdQ8I"]]},
"lega-basket-serie-a": {"n": "Lega Basket Serie A", "k": "free", "a": "Free (sign-up required), several teams post full replays on their YouTube channels (see links)", "l": [["LBA TV", "https://www.lbatv.com/"], ["YouTube · DinamoTVSassari", "https://www.youtube.com/c/DinamoTVSassari/videos"], ["YouTube · PallacanestroVarese", "https://www.youtube.com/user/PallacanestroVarese/videos"], ["YouTube playlist", "https://www.youtube.com/playlist?list=PLj4KqAI9jF3PoCCySM3KHls48V0U0xaZk"]]},
"liga-endesa": {"n": "Liga ACB", "k": "paid", "a": "Subscription-based (check list)", "l": [["ACB: where to watch, by country", "https://acb.com/es/liga/noticias/consulta-donde-ver-la-liga-endesa-2026-27-en-cada-pais-146139"]]},
"lkl": {"n": "Betsafe-LKL", "k": "free", "a": "Free (select number of games available, VPN required)", "l": [["LNK", "https://lnk.lt/tiesiogiai#btv"]]},
"lnb-elite": {"n": "Betclic Élite", "k": "paid", "a": "Subscription-based, additional VPN necessary outside of France, one free stream per week (VPN required)", "l": [["DAZN", "https://dazn.com/en"], ["L'Équipe", "https://www.lequipe.fr/tv/"]]},
"lnb-elite-2": {"n": "LNB Pro B", "k": "free", "a": "Free (sign-up required)", "l": [["LNB TV", "https://www.lnb.tv/fr-int/page/replay"]]},
"nbl-bulgaria": {"n": "Sesame NBL Bulgaria", "k": "free", "a": "Free, games streamed on YouTube", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PL8I2JkL-Q4rFmPM2FT9vbA4l7oyvMRIs5"]]},
"nbl-d1": {"n": "National Basketball League", "k": "free", "a": "Free (select number of games available)", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PLNGcgIBh8kClNuhOGbXsIXYyoRGiR-EV8"]]},
"orlen-basket-liga": {"n": "Orlen Basket Liga", "k": "free", "a": "Free (select number of games available)", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PLbQfDpYU_wHtASWi3eVbcDrluYhbDASLt"], ["Polsat Box Go", "https://polsatboxgo.pl/start"]]},
"primera-feb": {"n": "LEB Oro", "k": "free", "a": "Free (select number of games available, sign-up required)", "l": [["Canal FEB", "https://canalfeb.tv/"]]},
"proa": {"n": "Pro A", "k": "free", "a": "Free (single-game purchase for select games required), replays are generally for free", "l": [["Sport Europe TV", "https://sporteurope.tv/barmer-2-basketball-bundesliga"]]},
"prob": {"n": "Pro B", "k": "free", "a": "Free (select number of games available)", "l": [["Sportdeutschland.TV", "https://sportdeutschland.tv/barmer-2-basketball-bundesliga"]]},
"sb-league": {"n": "SB League", "k": "free", "a": "Free, games streamed on YouTube", "l": [["YouTube playlist", "https://www.youtube.com/playlist?list=PLehi_sVuvkbdV5hrS6TNuWHltc64LtZVc"]]},
"segunda-feb": {"n": "LEB Plata", "k": "free", "a": "Free (select number of games available)", "l": [["Canal FEB", "https://canalfeb.tv/"]]},
"slb-men": {"n": "Super League Basketball", "k": "free", "a": "Free (sign-up required)", "l": [["DAZN", "https://www.dazn.com/en-GB/competition/Competition:4cxogf67l5rq2a40gegqiwq38"]]},
"slovak-sbl": {"n": "Slovenská Basketbalová Liga", "k": "free", "a": "Free", "l": [["TIPOS TV", "https://www.tipos.sk/tipos-tv/kategoria?id=basketbal"]]}
}
/* WATCH-DATA:END */;

  const KIND = { free: 'Free', paid: 'Subscription', info: 'Check listings' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const of = slug => (slug && Object.prototype.hasOwnProperty.call(DATA, slug) ? DATA[slug] : null);

  const TV = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="9" rx="1.5"/><path d="M6.5 5.6v3.8L10 7.5z" class="f"/><path d="M5 14.5h6"/></svg>';

  /* opts.game: the game's id - its card then leads with WATCH HERE when the site has the game to play (below);
     opts.here(j): the page plays it itself (the game page's own video tab): true when it has */
  function pill(slug, opts) {
    const w = of(slug);
    if (!w || typeof document === 'undefined') return null;
    const o = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-watch' + (o.big ? ' big' : '') + ' k-' + w.k;
    b.setAttribute('data-watch', slug);
    if (o.game && /^[0-9a-f-]{36}$/i.test(String(o.game))) b.setAttribute('data-game', String(o.game));
    if (typeof o.here === 'function') b.__here = o.here;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'where to watch ' + w.n);
    b.innerHTML = TV + '<span>watch</span><i class="ew-dot" aria-hidden="true"></i>';
    if (o.big) b.querySelector('span').textContent = 'where to watch';
    wire();
    return b;
  }

  /* ------------------------------------------------------------ the card --- */
  let pop = null, owner = null, pinned = false, shutT = 0, openT = 0;
  function cardHTML(w) {
    /* each service a tile: YouTube its red with the play mark, anything else its initials */
    const tile = name => {
      if (/^YouTube/.test(name)) return '<span class="ew-ic yt" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 4.8v6.4L11.4 8z"/></svg></span>';
      const ini = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
      return '<span class="ew-ic" aria-hidden="true">' + esc(ini || '▶') + '</span>';
    };
    const links = (w.l || []).map(l => {
      const yt = /^YouTube · (.+)$/.exec(l[0]);
      return '<a class="ew-ln" href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + tile(l[0]) +
        '<span class="ew-nm"><b>' + esc(yt ? 'YouTube' : l[0]) + '</b>' + (yt ? '<small>' + esc(yt[1]) + '</small>' : '') + '</span>' +
        '<i aria-hidden="true">↗</i></a>';
    }).join('');
    return '<div class="ew-hd"><span class="ew-k">▶ where to watch</span>' +
      '<button type="button" class="ew-x" aria-label="close">×</button></div>' +
      '<div class="ew-bd">' +
      '<div class="ew-lg">' + esc(w.n) + '</div>' +
      '<div class="ew-av"><b class="ew-tag k-' + esc(w.k) + '">' + esc(KIND[w.k] || KIND.info) + '</b>' +
      '<span>' + esc(w.a) + '</span></div>' +
      (links ? '<div class="ew-lns">' + links + '</div>' : '') +
      '<p class="ew-ft">What is shown can differ from country to country.</p></div>';
  }
  /* WATCH HERE: a game the site has to play - streaming now on a channel it reads, or its stream kept, a channel's full
     game, its highlights (0244 game_watch) - leads its card with a press straight into the site's own player: HOME's
     VIDEO view opened on that game (?view=video&play=<game>), or on the game page its own video tab. One small read
     the first time a game's card opens, kept for the page; before 0244, or for a game with nothing, the card as it was. */
  const BASE = (SRC || '').replace(/watch\.js(\?.*)?$/, '') || '../';
  const HERE = new Map();
  function ask(id) {
    if (HERE.has(id)) return HERE.get(id);
    const C = root.EPINOIA_CONFIG;
    const p = !C || !C.supabaseUrl || typeof fetch !== 'function' ? Promise.resolve(null)
      : fetch(C.supabaseUrl + '/rest/v1/rpc/game_watch', {
          method: 'POST',
          headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ p_game: id })
        }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    HERE.set(id, p);
    return p;
  }
  const HERE_KIND = { live: ['Live now', 'live'], full: ['Full game', 'full'], highlights: ['Highlights', 'hl'] };
  function hereHTML(id, j) {
    const v = j.video, k = HERE_KIND[j.live ? 'live' : (v && v.kind)] || HERE_KIND.full;
    const vid = v && /^[A-Za-z0-9_-]{6,20}$/.test(v.video_id || '') ? v.video_id : null;
    return '<a class="ew-here k-' + k[1] + '" href="' + esc(BASE + 'home/?view=video&play=' + encodeURIComponent(id)) + '">' +
      '<span class="ew-here-th">' + (vid ? '<img src="https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg" alt="" loading="lazy" decoding="async">' : '') +
      '<i aria-hidden="true"></i></span>' +
      '<span class="ew-here-tx"><b>' + esc(k[0]) + ' · watch here</b><small>' + esc(v && v.title ? v.title : 'on EPINOIΛ’s player') + '</small></span>' +
      '<em aria-hidden="true">→</em></a>';
  }
  function here(btn) {
    const id = btn.getAttribute('data-game');
    if (!id) return;
    ask(id).then(j => {
      if (!j || !(j.live || j.video) || owner !== btn || !pop || !pop.classList.contains('on')) return;
      const bd = pop.querySelector('.ew-bd');
      if (!bd || bd.querySelector('.ew-here, .ew-sched-row')) return;
      /* A GAME STILL TO COME whose stream is already out (a channel publishes it days ahead): it is not a full game to
         watch, it is to be streamed here from tip-off - said so, with the press to be told when it starts (0256) */
      const gj = j.game_json || null;
      if (!j.live && gj && gj.status === 'scheduled') {
        bd.insertAdjacentHTML('afterbegin', schedRowHTML(id, gj.tipoff_at));
        notifyInto(bd, gj);
        place();
        return;
      }
      bd.insertAdjacentHTML('afterbegin', hereHTML(id, j));
      const a = bd.querySelector('.ew-here');
      a.addEventListener('click', e => {
        let mine = false;
        try { mine = typeof btn.__here === 'function' && btn.__here(j) === true; } catch (_) { mine = false; }
        if (mine) { e.preventDefault(); close(); }
      });
      place();
    });
  }
  function zoom() {
    const z = parseFloat(getComputedStyle(document.body).zoom);
    return z > 0 ? z : 1;
  }
  /* A LIVE GAME'S HEAD IS REDRAWN ON EVERY UPDATE, the pill with it: an open card follows the new pill for the same
     league rather than pointing at one that has left the page */
  function follow() {
    if (!owner || owner.isConnected) return !!owner;
    const slug = owner.getAttribute('data-watch'), big = owner.classList.contains('big');
    const now = [...document.querySelectorAll('.ep-watch')].find(b => b.getAttribute('data-watch') === slug && b.classList.contains('big') === big);
    if (!now) { close(); return false; }
    owner = now;
    now.classList.add('on');
    now.setAttribute('aria-expanded', 'true');
    return true;
  }
  function place() {
    if (!pop || !owner || !follow()) return;
    const z = zoom();
    const r = owner.getBoundingClientRect();
    const vw = root.innerWidth / z, vh = root.innerHeight / z;
    const W = Math.min(300, vw - 24);
    pop.style.width = W + 'px';
    const cx = (r.left + r.width / 2) / z;
    const left = Math.max(12, Math.min(vw - W - 12, cx - W / 2));
    pop.style.left = left + 'px';
    const h = pop.offsetHeight;
    const below = r.bottom / z + 8, above = r.top / z - 8 - h;
    const down = below + h <= vh - 8 || above < 8;
    pop.style.top = (down ? below : above) + 'px';
    pop.classList.toggle('up', !down);
    pop.style.setProperty('--ax', Math.max(14, Math.min(W - 14, cx - left)) + 'px');
  }
  function ensurePop() {
    if (pop) return;
    pop = document.createElement('div');
    pop.className = 'ep-watch-pop';
    pop.setAttribute('data-i18n-ctx', 'watch');   // FREE here is the price (i18n ctx.watch), not a free throw or a free agent
    pop.setAttribute('role', 'dialog');
    pop.addEventListener('mouseenter', () => clearTimeout(shutT));
    pop.addEventListener('mouseleave', () => { if (!pinned) shutSoon(); });
    pop.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('.ew-x')) close();
    });
    document.body.appendChild(pop);
  }
  function open(btn, pin) {
    clearTimeout(shutT); clearTimeout(openT);
    if (btn.classList.contains('ew-sched')) { openSched(btn, pin); return; }
    const w = of(btn.getAttribute('data-watch'));
    if (!w) return;
    if (owner && owner !== btn) owner.setAttribute('aria-expanded', 'false');
    ensurePop();
    const fresh = owner !== btn || !pop.classList.contains('on');
    if (fresh) pop.innerHTML = cardHTML(w);
    pop.setAttribute('aria-label', 'where to watch ' + w.n);
    pinned = !!pin || (pinned && owner === btn);
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('on');
    pop.classList.add('on');
    place();
    if (fresh) here(btn);
  }
  function close() {
    clearTimeout(shutT); clearTimeout(openT);
    if (pop) pop.classList.remove('on');
    if (owner) { owner.setAttribute('aria-expanded', 'false'); owner.classList.remove('on'); }
    owner = null; pinned = false;
  }
  function shutSoon() { clearTimeout(shutT); shutT = setTimeout(close, 260); }

  let wired = false;
  function wire() {
    if (wired || typeof document === 'undefined') return;
    wired = true;
    const fine = () => root.matchMedia && root.matchMedia('(hover:hover) and (pointer:fine)').matches;
    /* the pill's own press must not become the card's: stopped at the capture phase on the way down, so a
       card's own click handlers (and the link) never see it */
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.ep-watch');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        /* a pill for the site's own video (site, below): straight into the player, no card */
        if (b.classList.contains('ew-site') && !b.classList.contains('ew-sched')) { close(); airGo(b.getAttribute('data-game')); return; }
        if (owner === b && pinned) close(); else open(b, true);
        return;
      }
      if (pop && pop.classList.contains('on') && !(e.target.closest && e.target.closest('.ep-watch-pop'))) close();
    }, true);
    document.addEventListener('mouseover', e => {
      if (!fine()) return;
      const b = e.target.closest && e.target.closest('.ep-watch');
      if (!b || (owner === b && pop && pop.classList.contains('on'))) return;
      clearTimeout(openT);
      openT = setTimeout(() => { if (!pinned) open(b, false); }, 140);
    });
    document.addEventListener('mouseout', e => {
      const b = e.target.closest && e.target.closest('.ep-watch');
      if (!b || (e.relatedTarget && b.contains(e.relatedTarget))) return;
      clearTimeout(openT);
      if (owner === b && !pinned) shutSoon();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop && pop.classList.contains('on')) { const b = owner; close(); if (b) b.focus(); } });
    root.addEventListener('resize', () => { if (pop && pop.classList.contains('on')) place(); });
    root.addEventListener('scroll', () => { if (pop && pop.classList.contains('on')) { if (pinned) place(); else close(); } }, { passive: true, capture: true });
  }

  /* ------------------------------------------------------------ ON AIR --- */
  /* A GAME STREAMING NOW ON THE SITE'S OWN PLAYER (live_streams, 0242/0247: a live game with a vetted stream, or its
     league's channel live) is said where the game is shown (2026-10-07):
       onAir(card, id, { slot })   a fixture card lit, and a WATCH LIVE badge in `slot` - a press into HOME's VIDEO view,
                                   its LIVE on that game (?view=video&play=<game>), never the card's own link
       livePill(id)                the game page's pill beside the score: LIVE ON EPINOIΛ, the same press
     ONE LIST FOR THE PAGE: read when a live game's card or pill first asks, again each minute while one is on the screen
     and the page is seen, never for a page with no live game on it. HOME's own LIVE mark (home/vhmode.js) and the VIDEO
     view's LIVE hand over their reads (airFeed), so the page never asks twice for the same thing. */
  const AIR_MS = 60000;
  let air = null, airAt = 0, airP = null, airT = 0;
  const airEls = new Set(), airSlot = new WeakMap();
  const playUrl = id => BASE + 'home/?view=video&play=' + encodeURIComponent(id);
  const UUID = /^[0-9a-f-]{36}$/i;
  function airFeed(list) {
    if (!Array.isArray(list)) return;
    air = new Set(list.filter(g => g && g.id).map(g => String(g.id)));
    airAt = Date.now();
    airPaint();
  }
  const airFresh = () => (air && Date.now() - airAt < AIR_MS ? air : null);
  function airRead() {
    if (airP || (typeof document !== 'undefined' && document.hidden)) return airP;
    const C = root.EPINOIA_CONFIG;
    if (!C || !C.supabaseUrl || typeof fetch !== 'function') return null;
    airP = fetch(C.supabaseUrl + '/rest/v1/rpc/live_streams', { method: 'POST', cache: 'no-store',
      headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey, 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(list => { airP = null; if (Array.isArray(list)) airFeed(list); else airAt = Date.now(); });
    return airP;
  }
  function airAlive() { [...airEls].forEach(e => { if (!e.isConnected) airEls.delete(e); }); return airEls.size > 0; }
  function airTick() {
    if (airT) return;
    airT = setTimeout(function tick() {
      airT = 0;
      if (!airAlive()) return;                                      // nothing live on the screen: nothing asked
      if (!airFresh()) airRead();
      airT = setTimeout(tick, AIR_MS);
    }, AIR_MS);
  }
  function airPaint() { [...airEls].forEach(e => { if (!e.isConnected) airEls.delete(e); else airSet(e); }); }
  function airGo(id, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    root.location.href = playUrl(id);
  }
  function airSet(e) {
    const id = e.getAttribute('data-onair'), on = !!(air && air.has(id));
    if (e.classList.contains('ew-air')) { e.hidden = !on; return; }   // the game page's pill: there or not
    e.classList.toggle('ew-onair', on);                               // a card: lit, and its badge
    const slot = airSlot.get(e) || e;
    let b = slot.querySelector(':scope > .ew-air-b');
    if (on && !b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'ew-air-b';
      b.setAttribute('aria-label', 'watch this game live on EPINOIΛ');
      b.innerHTML = '<i aria-hidden="true"></i><span>watch live</span>';
      b.addEventListener('click', ev => airGo(id, ev));
      slot.insertBefore(b, slot.querySelector(':scope > .fxc-st, :scope > .st') || null);
    } else if (!on && b) b.remove();
  }
  function onAir(el, id, opts) {
    if (!el || !UUID.test(String(id || '')) || typeof document === 'undefined') return;
    el.setAttribute('data-onair', String(id));
    if (opts && opts.slot) airSlot.set(el, opts.slot);
    airEls.add(el);
    if (air) airSet(el);
    if (!airFresh()) airRead();
    airTick();
  }
  function livePill(id) {
    if (!UUID.test(String(id || '')) || typeof document === 'undefined') return null;
    const a = document.createElement('a');
    a.className = 'ew-air';
    a.href = playUrl(id);
    a.hidden = true;
    a.innerHTML = '<i class="ew-air-dot" aria-hidden="true"></i><span><b>live on EPINOIΛ</b><small>the stream, the chat and the storylines</small></span><em aria-hidden="true">watch →</em>';
    onAir(a, id);
    return a;
  }

  /* ------------------------------------------------------------ ON THE SITE --- */
  /* A GAME THE SITE HAS A VIDEO FOR - its highlights, its whole game, its kept stream (games_watchable, 0255) - gets a
     WATCH pill even in a league with no entry above, the FIBA Europe Cup's say (2026-10-08); in a league with one, its
     pill is marked (ew-has) and its card leads with WATCH HERE as before.
       site(id, cb)        cb(kind) once the game is known to have a video (live | full | highlights); never for one
                           without. ONE READ FOR THE PAGE: the games asked about within a moment go in one call (at most
                           200), and the answers are kept for the page, so a card redrawn by the live updates asks nothing
                           and gets its pill at once.
       sitePill(id, kind)  that pill: its press opens HOME's VIDEO view on the game (?view=video&play=<game>).
     Before 0255 the read fails, and the cards keep the pills they had. */
  const SITE = new Map();                 // id -> kind | null, answered; undefined while asked
  const siteWait = new Map();             // id -> [cb]
  let siteT = 0, siteOff = false;
  function siteFlush() {
    siteT = 0;
    const C = root.EPINOIA_CONFIG;
    const ids = [...siteWait.keys()].filter(id => !SITE.has(id)).slice(0, 200);
    if (!ids.length || siteOff || !C || !C.supabaseUrl || typeof fetch !== 'function') return;
    ids.forEach(id => SITE.set(id, undefined));
    fetch(C.supabaseUrl + '/rest/v1/rpc/games_watchable', { method: 'POST',
      headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_games: ids }) })
      .then(r => { if (r.status === 404) siteOff = true; return r.ok ? r.json() : null; })
      .catch(() => null)
      .then(rows => {
        const got = new Map((Array.isArray(rows) ? rows : []).map(x => [String(x.game), x.kind]));
        ids.forEach(id => {
          const k = got.get(id) || null, cbs = siteWait.get(id) || [];
          siteWait.delete(id);
          if (Array.isArray(rows)) SITE.set(id, k); else SITE.delete(id);   // a failed read is asked again on the next draw
          if (k) cbs.forEach(cb => { try { cb(k); } catch (_) { /* one card's trouble is its own */ } });
        });
        if (siteWait.size && !siteT) siteT = setTimeout(siteFlush, 0);    // more than one read's worth, or asked meanwhile
      });
  }
  function site(id, cb) {
    id = String(id || '');
    if (!UUID.test(id) || typeof cb !== 'function' || siteOff) return;
    if (SITE.get(id) !== undefined) { const k = SITE.get(id); if (k) cb(k); return; }
    if (!siteWait.has(id)) siteWait.set(id, []);
    siteWait.get(id).push(cb);
    if (!siteT) siteT = setTimeout(siteFlush, 30);
  }
  const SITE_SAYS = { live: 'watch the game live on EPINOIΛ', full: 'watch the whole game on EPINOIΛ', highlights: 'watch the highlights on EPINOIΛ',
                      scheduled: 'to be streamed live on EPINOIΛ from tip-off' };
  function sitePill(id, kind, tip) {
    if (!UUID.test(String(id || '')) || typeof document === 'undefined') return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-watch k-here ew-site' + (kind === 'scheduled' ? ' ew-sched' : '');
    b.setAttribute('data-game', String(id));
    b.setAttribute('data-kind', SITE_SAYS[kind] ? kind : 'full');
    if (tip) b.setAttribute('data-tip', String(tip));
    b.setAttribute('aria-label', SITE_SAYS[kind] || SITE_SAYS.full);
    b.title = SITE_SAYS[kind] || SITE_SAYS.full;
    if (kind === 'scheduled') { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); }
    b.innerHTML = TV + '<span>watch</span><i class="ew-dot" aria-hidden="true"></i>';
    wire();
    return b;
  }

  /* ------------------------------------------------------------ SCHEDULED --- */
  /* A GAME STILL TO COME WITH A STREAM TO BE PLAYED HERE (0256 games_watchable 'scheduled': a channel's stream published
     ahead of the game, or the game's own stream found by the ingest; Louie, 2026-10-08). Its WATCH pill opens a card
     of its own: it is to be fed live on the site at tip-off, NOTIFY ME (the game's own follow bell - its followers are
     told the moment the stream starts, 0256 notify_stream_live) and the VIDEO view's list of every scheduled stream. A
     league's own pill on such a game leads its card with the same row (here, above). */
  const ALL_SCHED = () => BASE + 'home/?view=video#scheduled';
  function whenText(tip) {
    const d = tip ? new Date(tip) : null;
    if (!d || isNaN(d)) return '';
    const lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';     // as the fixtures say it: Sun 11 Oct, 16:00
    try { return d.toLocaleString(/^en\b/.test(lang) ? 'en-GB' : lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
    catch (_) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function schedRowHTML(id, tip) {
    const when = whenText(tip);
    return '<div class="ew-sched-row"><span class="ew-sched-ic" aria-hidden="true"><i></i></span>' +
      '<span class="ew-here-tx"><b>Live here at tip-off</b><small>Scheduled to be fed live on the website at tip-off</small>' +
      (when ? '<em class="ew-sched-when">' + esc(when) + '</em>' : '') + '</span></div>' +
      '<div class="ew-sched-act"><span class="ew-notify" data-game="' + esc(id) + '"></span>' +
      '<a class="ew-sched-all" href="' + esc(ALL_SCHED()) + '">All scheduled streams →</a></div>';
  }
  function schedHTML(id, tip) {
    return '<div class="ew-hd"><span class="ew-k">▶ live on EPINOIΛ</span>' +
      '<button type="button" class="ew-x" aria-label="close">×</button></div>' +
      '<div class="ew-bd">' + schedRowHTML(id, tip) +
      '<p class="ew-ft">With the box score and the chat beside the stream, in the VIDEO view.</p></div>';
  }
  /* the game's follow bell, labelled NOTIFY ME; follow.js where the page has not loaded it (a league's page) */
  let followP = null;
  function followJs() {
    if (root.EpinoiaFollow) return Promise.resolve(root.EpinoiaFollow);
    if (followP) return followP;
    const q = /\?.*$/.exec(SRC || '');
    followP = new Promise(res => {
      const s = document.createElement('script');
      s.src = BASE + 'follow.js' + (q ? q[0] : '');
      s.onload = () => res(root.EpinoiaFollow || null);
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
    return followP;
  }
  function notifyInto(host, game) {
    host.querySelectorAll('.ew-notify:not(.on)').forEach(slot => {
      slot.classList.add('on');
      const id = slot.getAttribute('data-game');
      followJs().then(F => {
        if (!slot.isConnected) return;
        if (F && typeof F.bell === 'function') {
          const name = game && game.home && game.away ? (game.home.name || '') + ' v ' + (game.away.name || '') : undefined;
          const b = F.bell('game', id, { label: 'Notify me', labelOn: 'You will be told', cls: 'lbl ew-bell', name });
          b.title = 'Be told the moment the stream starts (this follows the game: its reminder, line-ups and result too)';
          slot.appendChild(b);
        } else {
          const a = document.createElement('a');
          a.className = 'ew-bell-ln';
          a.href = BASE + 'game/?g=' + encodeURIComponent(id);
          a.textContent = 'Notify me on the game’s page';
          slot.appendChild(a);
        }
        place();
      });
    });
  }
  function openSched(btn, pin) {
    clearTimeout(shutT); clearTimeout(openT);
    if (owner && owner !== btn) owner.setAttribute('aria-expanded', 'false');
    ensurePop();
    const id = btn.getAttribute('data-game');
    const fresh = owner !== btn || !pop.classList.contains('on');
    if (fresh) { pop.innerHTML = schedHTML(id, btn.getAttribute('data-tip')); notifyInto(pop); }
    pop.setAttribute('aria-label', 'to be streamed live on EPINOIΛ from tip-off');
    pinned = !!pin || (pinned && owner === btn);
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('on');
    pop.classList.add('on');
    place();
  }

  /* the cards' one call: in `slot` (where the card keeps its pill), mark the league's pill if it has one, else put the
     site's own in; opts.cls goes on a new pill, opts.added(pill) runs once it is in */
  /* opts.status: the card's game's status - a game still to come takes only a stream to come ('scheduled'; before 0256 the
     read answered 'full' for a channel's stream on it), a game played never takes one; opts.tip its tip-off, for the card */
  function siteInto(slot, id, opts) {
    if (!slot) return;
    const o = opts || {};
    site(id, kind0 => {
      let kind = kind0;
      if (o.status === 'scheduled') { if (kind !== 'full' && kind !== 'scheduled') return; kind = 'scheduled'; }
      else if (kind === 'scheduled') return;
      const have = slot.querySelector('.ep-watch');
      if (have) { have.classList.add('ew-has'); return; }
      const sp = sitePill(id, kind, o.tip);
      if (!sp) return;
      if (o.cls) sp.classList.add(o.cls);
      slot.appendChild(sp);
      if (typeof o.added === 'function') o.added(sp);
    });
  }

  root.EpinoiaWatch = { of, pill, close, sync: () => { if (pop && pop.classList.contains('on')) place(); }, DATA, KIND, onAir, livePill, airFeed, airFresh, site, sitePill, siteInto,
                         schedRowHTML, notifyInto, whenText };
})(typeof window !== 'undefined' ? window : globalThis);
