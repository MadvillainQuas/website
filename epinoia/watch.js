'use strict';
/* ============================================================================
   WHERE TO WATCH — the little pill under a fixture's "v" or score, and its card.

   Every league EPINOIA knows a broadcaster for has one entry below: how the games can be seen (free, a
   subscription, or a note), and the links. The entries are made from the streaming spreadsheet by
   tools/build-watch.py — edit the sheet and run it; do not edit the block by hand.

     EpinoiaWatch.of(slug)          -> the league's entry, or null
     EpinoiaWatch.pill(slug, opts)  -> <button class="ep-watch"> (null for a league with no entry)
                                       opts.big: the game page's larger pill

   THE PILL SITS INSIDE A CARD THAT IS ITSELF A LINK, so a tap on it must never reach the card: its click is
   stopped, and the card it opens lives on <body>, outside every card. With a mouse the card opens on hover
   (and stays while the pointer moves onto it); a click or a tap pins it open, a second one, Escape, or a
   tap anywhere else closes it. Its links open in a new tab.

   THE KIT ZOOMS <body> ON A DESKTOP (1.25 / 1.5): a fixed card inside it is placed in unzoomed pixels, while
   getBoundingClientRect answers in zoomed ones, so the pill's box is divided by the zoom before the card is
   placed.
   ============================================================================ */
(function (root) {
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

  function pill(slug, opts) {
    const w = of(slug);
    if (!w || typeof document === 'undefined') return null;
    const o = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-watch' + (o.big ? ' big' : '') + ' k-' + w.k;
    b.setAttribute('data-watch', slug);
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
  function open(btn, pin) {
    clearTimeout(shutT); clearTimeout(openT);
    const w = of(btn.getAttribute('data-watch'));
    if (!w) return;
    if (owner && owner !== btn) owner.setAttribute('aria-expanded', 'false');
    if (!pop) {
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
    if (owner !== btn || !pop.classList.contains('on')) pop.innerHTML = cardHTML(w);
    pop.setAttribute('aria-label', 'where to watch ' + w.n);
    pinned = !!pin || (pinned && owner === btn);
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('on');
    pop.classList.add('on');
    place();
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

  root.EpinoiaWatch = { of, pill, close, sync: () => { if (pop && pop.classList.contains('on')) place(); }, DATA, KIND };
})(typeof window !== 'undefined' ? window : globalThis);
