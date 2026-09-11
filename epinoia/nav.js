'use strict';
/* ============================================================================
   Injects the navigation rail into every public page.

   Self-injecting so a new page needs one script tag rather than a block of
   markup to keep in sync — the last thing this site needs is nine copies of a
   menu drifting apart.

   ---------------------------------------------------------------------------
   TWO VIEWS, ONE RAIL

   At rest the rail is a list of LEAGUES and nothing else. Pick one and it
   slides sideways to that league's own pages, with the league in the header
   and a way back. The reason is not decoration: "fixtures" is not a
   destination on a platform with a dozen leagues, it is half a destination,
   and a flat rail has to smuggle the other half in through a query string that
   nobody can see. Making the league the FIRST choice means every row beneath
   it means exactly one thing.

   Three rows never move — sign in, contact, and back to Prophesy — because
   they are how somebody gets out, and a way out that relocates is not one.

   WHICH VIEW IT OPENS IN is decided by the page, not remembered: a page that
   knows its league opens drilled in, because showing "all leagues" while
   somebody is reading a league's table would be the rail disagreeing with the
   screen. Backing out is a view change and nothing more; it does not navigate,
   and it is not persisted, so the next page decides again.
   ============================================================================ */
(function () {
  if (document.querySelector('.ep-nav')) return;

  /* THE SPLASH HAS NO RAIL. /epinoia/ with no league asked for is the
     platform's front page — a full-bleed pool with its own way into
     everything — and a dark fixed column down the side of it is a navigation
     bar arguing with a landing page. Every other page keeps the rail,
     including /epinoia/?l=slug, which is a different page at the same path.

     ASKED OF THE PAGE, NOT OF THE URL. This used to match the path against
     /league/$, and renaming the section to /epinoia/ broke it silently: the
     regex stopped matching and the rail came back on the one page that must
     not have one, pushing the whole pool 174px to the right. A folder name is
     not a fact about a page, and a rename should not be able to change what a
     page is.

     So it asks the document instead. mode.js settles m-splash from the URL
     before the first paint, and #splash exists in this one file only — the two
     together identify the splash exactly. Neither depends on where the folder
     lives. The second half matters: the news archive also carries m-splash
     when no league is named, and that page does want its rail. */
  const atSplash = document.documentElement.classList.contains('m-splash')
                   && !!document.getElementById('splash');
  if (atSplash) return;

  const here = location.pathname.replace(/\/index\.html$/, '/');
  /* Climb back to /epinoia/ by counting the directories below it, rather than
     assuming one. Subpages exist (stats/wowy/), and a hard-coded '../'
     silently pointed them at their parent, which resolved to a real URL and so
     failed as a wrong destination rather than a broken link. */
  const seg = here.split('/epinoia/')[1] || '';
  const parts = seg.split('/').filter(Boolean);
  if (parts.length && parts[parts.length - 1].indexOf('.') !== -1) parts.pop();
  const root = parts.length ? '../'.repeat(parts.length) : './';

  /* Keep the league in hand when we know it.

     The catch is WHEN we know it. A page opened without ?l= resolves its
     league from the network, which lands well after this script has built the
     rail. Rather than make every page call a refresh hook, the slug is defined
     as a property below: the assignment those pages already make
     (`window.__CS_LEAGUE_SLUG = league.slug`) rebuilds the rail itself. */
  const qp = new URLSearchParams(location.search);
  let lg = qp.get('l') || (window.__CS_LEAGUE_SLUG || '');
  /* The league THIS PAGE is about, as opposed to the one the rail is currently
     showing. They are the same until somebody browses to another league in the
     rail without leaving the page, and then the "you are here" marks have to
     stop claiming otherwise. */
  let pageLeague = lg;
  const withLeague = (path, slug) => (slug || lg)
    ? path + (path.includes('?') ? '&' : '?') + 'l=' + encodeURIComponent(slug || lg)
    : path;

  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
    if (x != null) n.textContent = x; return n; };
  const reduced = () => window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Run once, after the browser has had a chance to lay out.
     requestAnimationFrame alone is not enough: a tab that is not compositing
     — backgrounded, or hidden behind another window — never fires one, and
     the rail would sit for ever with its titles unmeasured and its animation
     still suppressed. The timeout is the floor, and whichever lands first
     wins. */
  function afterPaint(fn) {
    let done = false;
    const once = () => { if (!done) { done = true; fn(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(once);
    setTimeout(once, 60);
  }

  /* ------------------------------------------------------- league pages ---
     What a league HAS. Order is the order somebody wants them: what is on,
     how it is going, then the deep end. The last three need an account, and
     each needs a DIFFERENT account — a team manager has no business being
     shown "league admin". They stay hidden until somebody signs in and then
     only the ones their roles justify appear. Hiding a row is a courtesy, not
     a control: pressing one you should not have is refused by the database. */
  const PAGES = [
    { href: 'fixtures/',   ic: '▥', tx: 'fixtures',   lg: true, key: 'fixtures',
      match: /\/epinoia\/fixtures\// },
    { href: 'stats/',      ic: '▦', tx: 'statistics', lg: true, key: 'statistics',
      match: /\/epinoia\/stats\/$/ },
    { href: 'stats/wowy/', ic: '◫', tx: 'wowy',       lg: true, key: 'wowy',
      match: /\/epinoia\/stats\/wowy\// },
    { href: 'l/',          ic: '▤', tx: 'table',      lg: true, key: 'table',
      match: /\/epinoia\/l\// },
    /* not a page: a layer of the rail (the clubs), see openTeams */
    { href: 'l/',          ic: '◉', tx: 'teams',      lg: true, key: 'teams', teams: true,
      match: /\/epinoia\/t\// },
    { href: 'news/',       ic: '❑', tx: 'news',       lg: true, key: 'news',
      match: /\/epinoia\/news\// },
    { label: 'take part', auth: true },
    /* SCORING IS THE ONE ROW THAT DOES NOT DISAPPEAR.

       Every other gated row is hidden from an account that cannot use it,
       because there is nothing behind it for them. The scorer is different:
       it has a real, complete demo — two invented squads, nothing written
       anywhere — and hiding the row hid that as well, so the one thing a
       curious visitor SHOULD be able to press was the thing they could not
       find. Hidden, it also read as "this platform has no scoring app".

       So the row stays and changes what it IS. With the role it opens the
       fixture list and says "score a game"; without it, it opens the practice
       game and says so plainly. The two are different destinations with
       different labels, so nobody presses "demo score" expecting to record a
       real fixture — and nobody without the role reaches one, because the
       scorer refuses a real fixture id independently of anything here. */
    { href: 'score/', ic: '●', tx: 'score a game', match: /\/epinoia\/score\//, auth: true,
      key: 'score', role: w => (w.scoring || []).length || adminsThis(w),
      demo: { href: 'score/?train=1', tx: 'demo score',
              title: 'a practice game with two invented squads — nothing is saved' } },
    { href: 'app/',   ic: '◆', tx: 'club portal',  match: /\/epinoia\/app\//,  auth: true,
      key: 'portal', role: w => (w.teams || []).length || adminsThis(w) },
    { href: 'admin/', ic: '▲', tx: 'league admin', match: /\/epinoia\/admin\//, auth: true,
      key: 'admin', role: w => adminsThis(w) }
  ];

  /* Scoped to the league on screen where it can be. `leagues` from whoami() is
     the list of leagues this account administers, so matching on slug answers
     "may they administer THIS one" rather than "any one at all". */
  function adminsThis(w) {
    if (w.is_platform_admin) return true;
    const mine = w.leagues || [];
    if (!lg) return mine.length;
    return mine.some(l => l.slug === lg);
  }

  /* --------------------------------------------------------------- marquee ---
     A row scrolls only if its text does not fit. Measuring is the whole trick:
     animating everything would move rows that had no need to move, and a rail
     where six names slide at once is unreadable in a different way from one
     where they are cut off. */
  let marqN = 0;
  function marquee(text) {
    const box = el('span', 'marq');
    const inner = el('span', null, text);
    /* a small negative offset per row, so a rail of long names is not a
       departures board sliding in lockstep */
    box.style.setProperty('--stag', (-1.3 * (marqN++ % 5)).toFixed(1) + 's');
    box.appendChild(inner);
    /* after layout, not during it */
    afterPaint(() => {
      const over = inner.scrollWidth - box.clientWidth;
      if (over > 2) {
        box.classList.add('scrolls');
        box.style.setProperty('--shift', (-over - 4) + 'px');
      }
    });
    return box;
  }

  function crest(l) {
    const c = el('span', 'crest');
    c.style.setProperty('--ca', l.colour_a || '#93f2bf');
    c.style.setProperty('--cb', l.colour_b || l.colour_a || '#8ff5ff');
    const cfg = window.EPINOIA_CONFIG;
    if (l.logo_path && cfg && cfg.supabaseUrl) {
      const img = document.createElement('img');
      img.src = cfg.supabaseUrl + '/storage/v1/object/public/media-public/' + l.logo_path;
      img.alt = '';
      /* a logo that fails to load falls back to the monogram rather than
         leaving a blank plate */
      img.addEventListener('error', () => { img.remove(); c.append(halftone(), mono(l)); });
      c.appendChild(img);
      return c;
    }
    c.append(halftone(), mono(l));
    return c;
  }
  const halftone = () => el('span', 'halftone');
  const mono = (l) => el('span', 'mono',
    (l.name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().charAt(0).toUpperCase() || '?');

  /* =============================================================== build === */
  const nav = document.createElement('nav');
  nav.className = 'ep-nav';
  nav.setAttribute('aria-label', 'Epinoia');
  nav.dataset.view = 'root';
  /* No sliding until the rail has settled into the view this page belongs in.
     Removed once the leagues have arrived and the first view is chosen. */
  nav.classList.add('noanim');

  /* EVERYTHING THAT SCROLLS, IN ITS OWN BOX. On the phone bar this is what
     actually gets overflow-x:auto; the menu toggle appended at the very end
     of this function is a sibling of it, not a child, so it can never be
     something you have to swipe the bar to reach. An earlier version pinned
     the toggle with position:sticky INSIDE the scrolling element instead —
     the same element supplying both the containing block and the scroll
     context for its own sticky child, which is exactly the combination
     Safari has never reliably supported. A real sibling outside the
     scroller needs no browser-specific fix because it was never inside the
     thing that scrolls. Invisible to desktop layout (display:contents,
     defined in kit/nav.css) — only the mobile media query gives it a shape
     of its own. */
  const navScroll = el('div', 'ep-nav-scroll');

  const navdeck = el('div', 'navdeck');
  const deck = el('div', 'deck');
  /* THREE LEVELS: countries, then that country's leagues, then the league's
     pages. All three live in the document at once so the deck can slide
     between them; only one is ever in the tab order. */
  const countryPanel = el('div', 'panel countrypanel');
  const rootPanel = el('div', 'panel rootpanel');
  const leaguePanel = el('div', 'panel leaguepanel');
  /* THE CLUBS, A LAYER DEEPER. "Teams" in the league's pages slides the deck one more panel
     along: the league's clubs, each with its crest (or a monogram in its colour where none
     has been published), each a link to the club's profile. The list is fetched the first
     time the layer opens and kept for the page. */
  const teamsPanel = el('div', 'panel teamspanel');
  deck.append(countryPanel, rootPanel, leaguePanel, teamsPanel);
  navdeck.appendChild(deck);
  navScroll.appendChild(navdeck);

  /* ---- country panel: every country with a league in it ---- */
  const ctitle = el('a', 'ptitle', 'Countries');
  /* THE HEADING GOES TO THE COUNTRIES PAGE, not to the splash. Every other
     panel title in this rail opens the thing the panel is a list OF — a
     league's name opens that league — and this one pointed at the front door
     instead, so the one heading that had somewhere obvious to go was the one
     that sent you back out. */
  ctitle.href = root + 'countries/';
  ctitle.title = 'Every country, as a page';
  const clist = el('div', 'leagues');
  clist.appendChild(el('div', 'gempty', '…'));
  countryPanel.append(ctitle, clist);

  /* ---- root panel: the title, then the leagues ---- */
  const title = el('a', 'ptitle', 'Leagues');
  title.href = root;
  /* The heading is also the way to the hub. It costs no row and it keeps a
     destination that would otherwise be unreachable now the wordmark is gone. */
  title.title = 'All leagues';
  const list = el('div', 'leagues');
  const holding = el('div', 'gempty', '…');
  list.appendChild(holding);
  rootPanel.append(title, list);

  /* ADMINISTRATION, AT THE TOP LEVEL.

     The role-gated rows live inside a league, which is right for scoring a
     game and for the club portal — both of those are things you do TO a
     league. Administration is not: the console picks its own league from the
     account's memberships, so making somebody drill into one first was asking
     them to answer a question the destination was about to ask again.

     It sits under the leagues rather than above them because the list is what
     the rail is for. Hidden entirely for everybody else — and hiding it is a
     courtesy, not a control: pressing it without the rights gets a console
     that shows nothing, because every action in there is refused by the
     database. */
  const adminRow = el('a', 'item admin-row');
  adminRow.href = root + 'admin/';
  adminRow.append(el('span', 'ic', '▲'), el('span', 'tx', 'admin controls'));
  adminRow.title = 'league administration';
  /* Not `/epinoia/admin/` loosely, or the platform console below would light
     this row up as well — its address is underneath this one. */
  if (/\/epinoia\/admin\/(?!platform\/)/.test(here)) adminRow.classList.add('on');
  adminRow.hidden = true;

  /* THE PLATFORM CONSOLE IS A SEPARATE ROW, not a tab inside the league one,
     because it is a different scope rather than a different page: everything
     in there reaches across every league at once. Somebody who administers
     two leagues should not find "delete any league" one tab away from their
     fixture list. Platform admins only, and again that is a courtesy — the
     page itself is gated by the database. */
  const platRow = el('a', 'item admin-row');
  platRow.href = root + 'admin/platform/';
  platRow.append(el('span', 'ic', '◆'), el('span', 'tx', 'platform'));
  platRow.title = 'platform administration — every league, accounts, settings';
  if (/\/epinoia\/admin\/platform\//.test(here)) platRow.classList.add('on');
  platRow.hidden = true;

  /* The way back OUT of a country. The country panel has no back button
     because there is nothing above it; this one sits at the top of the
     leagues, in the same place the league panel's does, so the gesture is the
     same at every level. */
  const chead = el('div', 'phead');
  const cback = el('button', 'back', '\u2039');
  cback.type = 'button';
  cback.title = 'All countries';
  cback.setAttribute('aria-label', 'Back to all countries');
  const cname = el('a', 'lname');
  cname.href = root;
  chead.append(cback, cname);
  rootPanel.insertBefore(chead, title);
  title.classList.add('hide');          // the country's name replaces it

  /* ---- league panel: the header, then the pages ---- */
  const phead = el('div', 'phead');
  const back = el('button', 'back', '‹');
  back.type = 'button';
  back.title = 'All leagues';
  back.setAttribute('aria-label', 'Back to all leagues');
  const lnameLink = el('a', 'lname');
  phead.append(back, lnameLink);
  const pages = el('div', 'pages');
  leaguePanel.append(phead, pages);
  const thead = el('div', 'phead');
  const tback = el('button', 'back', '\u2039');
  tback.type = 'button';
  tback.title = 'Back to the league';
  tback.setAttribute('aria-label', 'Back to the league');
  const tname = el('a', 'lname');
  thead.append(tback, tname);
  const tlist = el('div', 'teams');
  teamsPanel.append(thead, tlist);
  const teamsCache = {};
  async function fillTeams(l) {
    tname.textContent = '';
    tname.append(crest(l), marquee('Teams \u00b7 ' + l.name));
    tname.href = root + 'l/?l=' + encodeURIComponent(l.slug);
    tname.title = l.name + ' \u2014 the table';
    tlist.textContent = '';
    tlist.appendChild(el('div', 'gempty', '\u2026'));
    sizeDeck(false);
    let rows = teamsCache[l.slug];
    if (!rows) {
      const c = window.EPINOIA_CONFIG || {};
      try {
        const scope = l.id ? 'league_id=eq.' + encodeURIComponent(l.id) : 'leagues.slug=eq.' + encodeURIComponent(l.slug);
        const r = await fetch(c.supabaseUrl + '/rest/v1/teams?' + scope + '&select=id,slug,name,short_name,colour,logo_path&order=name',
          { headers: { apikey: c.supabaseAnonKey } });
        rows = r.ok ? await r.json() : [];
      } catch (_) { rows = []; }
      teamsCache[l.slug] = rows;
    }
    tlist.textContent = '';
    if (!rows.length) { tlist.appendChild(el('div', 'gempty', 'no clubs yet')); sizeDeck(false); return; }
    rows.forEach(t => {
      const a = el('a', 'item trow');
      a.href = root + 't/?t=' + encodeURIComponent(t.slug);
      a.title = t.name;
      const badge = window.epinoiaCrest ? window.epinoiaCrest(t, { cls: 'ep-crest ic' }) : el('span', 'ic', '\u25cf');
      a.append(badge, marquee(t.name));
      if (new RegExp('/epinoia/t/').test(here) && qp.get('t') === t.slug) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); }
      tlist.appendChild(a);
    });
    afterPaint(() => sizeDeck(false));
  }
  function openTeams(animate) {
    const l = bySlug();
    if (!l) return;
    fillTeams(l);
    setView('teams', animate !== false);
    /* the top half is the scroller: start it at the top of the list */
    navScroll.scrollTop = 0; nav.scrollTop = 0;
  }
  tback.addEventListener('click', () => {
    setView('league', true);
    const row = pages.querySelector('a[data-teams-row]');
    if (row) row.focus({ preventScroll: true });
  });
  window.epinoiaOpenTeams = () => openTeams(true);

  const gated = [];            // [node, predicate] — shown once roles are known
  const demoRows = [];         // [node, spec, demoHref] — rows that downgrade rather than hide
  const carriers = [];         // [anchor, base path] — links that take the league
  const navKeyed = [];         // [node, key] — rows a league may switch off

  /* Anything at all: this row is not about the league on screen, because at
     the top level there is no league on screen. A platform administrator, or
     anybody who administers so much as one league, gets the console — and the
     console asks which one. */
  gated.push([adminRow, w => !!w.is_platform_admin || (w.leagues || []).length > 0]);
  gated.push([platRow,  w => !!w.is_platform_admin]);

  PAGES.forEach(it => {
    if (it.label) {
      const d = el('div', 'grouplbl', it.label);
      if (it.auth) { d.hidden = true; gated.push([d, () => true]); }
      pages.appendChild(d);
      return;
    }
    const a = el('a', 'item');
    if (it.match && it.match.test(here)) a.dataset.hereIs = '1';
    a.href = it.lg ? withLeague(root + it.href) : root + it.href;
    if (it.demo) demoRows.push([a, it, root + it.demo.href]);
    if (it.lg) carriers.push([a, root + it.href]);
    a.append(el('span', 'ic', it.ic), el('span', 'tx', it.tx));
    a.title = it.tx;
    if (it.auth) { a.hidden = true; gated.push([a, it.role || (() => true)]); }
    if (it.key) navKeyed.push([a, it.key]);
    if (it.teams) {
      a.dataset.teamsRow = '1';
      a.append(el('span', 'lgo', '\u203a'));
      a.addEventListener('click', e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openTeams(true);
      });
    }
    pages.appendChild(a);
  });
  retarget();          // set the initial "you are here" marks

  /* ---- the rows that never move ---- */
  navScroll.appendChild(el('div', 'gap'));

  /* ADMINISTRATION LIVES DOWN HERE NOW, with the account and the contact link,
     because that is what it is: a thing about YOU rather than a thing about
     the league on screen. It sat in the leagues panel, which meant the two
     most powerful destinations on the platform were mixed in with a browse
     list — and disappeared the moment you drilled into a league, which is
     exactly when an administrator wants them.

     Both stay hidden until whoami() says otherwise, and hiding them is a
     courtesy: the consoles refuse everything to somebody without the role. */
  /* THE RAIL IN TWO HALVES. Everything about WHERE YOU ARE -- countries, leagues, a league's
     pages, its clubs -- scrolls in the top half; everything about YOU -- administration, the
     account, contact, the way out -- stays put in a foot beneath it. On a phone the sheet
     keeps the same shape: the list scrolls, the foot does not. */
  const navFoot = el('div', 'ep-nav-foot');
  navFoot.append(adminRow, platRow);

  const acct = el('div', 'acct');
  const acctLink = el('a', 'item');
  const acctIc = el('span', 'ic', '◐');
  const acctTx = el('span', 'tx', 'sign in');
  acctLink.append(acctIc, acctTx);
  acctLink.href = root + 'signin/?next=' +
    encodeURIComponent(location.pathname + location.search);
  acctLink.title = 'sign in';
  acct.appendChild(acctLink);
  /* a fan's own page: clubs, players, colour, light or dark, how to be told */
  const meLink = el('a', 'item');
  meLink.append(el('span', 'ic', '☆'), el('span', 'tx', 'your profile'));
  meLink.href = root + 'me/';
  meLink.title = 'your clubs, players and notifications';
  meLink.hidden = true;
  acct.appendChild(meLink);
  navFoot.appendChild(acct);

  /* ------------------------------------------------------- add to home screen ---
     The app is installable (manifest.webmanifest + sw.js). On Android the browser fires
     beforeinstallprompt and the banner's button hands that prompt to the person; on iPhone
     there is no such event and the banner explains the share sheet instead. Shown once a
     visit on a phone-sized screen that is not already the installed app; a dismissal is
     remembered for a fortnight. window.epinoiaInstall() offers the same from a page. */
  let installEvt = null, installBanner = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismissed = () => { try { return (+localStorage.getItem('epinoia_install_dismissed') || 0) > Date.now() - 14 * 86400000; } catch (_) { return false; } };
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(root + 'sw.js', { scope: root }).catch(() => {});
  }
  function showInstall(force) {
    if (installBanner || standalone()) return;
    if (!force && (dismissed() || window.innerWidth > 900)) return;
    if (!installEvt && !isIOS() && !force) return;
    installBanner = el('div', 'ep-install');
    const ic = el('img'); ic.src = root + 'brand/epinoia-mark-192.png'; ic.alt = '';
    const tx = el('div', 'tx');
    tx.appendChild(el('b', null, 'Add Epinoia to your home screen'));
    /* SAMSUNG INTERNET packages a home-screen app itself, and Google Play Protect warns about
       its packaging ("built for an older version of Android"). That is Samsung's installer, not
       the site: "Install anyway" is safe, and Chrome on the same phone installs it cleanly. */
    const samsung = /SamsungBrowser/i.test(navigator.userAgent);
    tx.appendChild(el('span', null, installEvt
      ? (samsung
          ? 'Scores, fixtures and your clubs one tap away. If Play Protect warns about Samsung’s packaging, choose “Install anyway”, or install from Chrome instead.'
          : 'Scores, fixtures and your clubs one tap away, with alerts when you ask for them.')
      : isIOS() ? 'Tap Share \u2191 below, then \u201cAdd to Home Screen\u201d. Alerts for your clubs work from there.'
      : 'Open this page in Chrome or Edge on your phone and add it from the browser menu.'));
    const go = el('button', 'go', installEvt ? 'add' : 'got it'); go.type = 'button';
    const x = el('button', 'x', '\u00d7'); x.type = 'button'; x.title = 'not now';
    const close = () => { try { localStorage.setItem('epinoia_install_dismissed', String(Date.now())); } catch (_) {} installBanner.remove(); installBanner = null; };
    go.onclick = async () => {
      if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (_) {} installEvt = null; }
      close();
    };
    x.onclick = close;
    installBanner.append(ic, tx, go, x);
    document.body.appendChild(installBanner);
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(false); });
  window.addEventListener('appinstalled', () => { if (installBanner) { installBanner.remove(); installBanner = null; } });
  window.epinoiaInstall = () => showInstall(true);
  window.epinoiaCanInstall = () => !!installEvt;
  if (isIOS()) setTimeout(() => showInstall(false), 2500);

  /* --------------------------------------------------------------- the bell ---
     Top right of every page for a signed-in person: what the platform has to tell them, by
     the settings on their profile. Read straight off the notifications table with the stored
     token (RLS shows a person only their own rows); the count refreshes every minute. */
  let bell = null, bellTimer = null;
  function bellHeaders(sess) {
    const c = window.EPINOIA_CONFIG;
    return { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + sess.token, 'Content-Type': 'application/json' };
  }
  async function bellCount(sess) {
    const c = window.EPINOIA_CONFIG;
    const r = await fetch(c.supabaseUrl + '/rest/v1/notifications?select=id&read_at=is.null&limit=1', {
      cache: 'no-store', headers: Object.assign(bellHeaders(sess), { Prefer: 'count=exact' }) });
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    return m ? +m[1] : 0;
  }
  async function bellList(sess) {
    const c = window.EPINOIA_CONFIG;
    const r = await fetch(c.supabaseUrl + '/rest/v1/notifications?select=id,kind,title,body,link,created_at,read_at&order=created_at.desc&limit=25',
      { cache: 'no-store', headers: bellHeaders(sess) });
    return r.ok ? r.json() : [];
  }
  async function bellReadAll(sess) {
    const c = window.EPINOIA_CONFIG;
    await fetch(c.supabaseUrl + '/rest/v1/notifications?read_at=is.null', {
      method: 'PATCH', headers: bellHeaders(sess), body: JSON.stringify({ read_at: new Date().toISOString() }) });
  }
  function unmountBell() {
    if (bell) bell.remove(); bell = null;
    if (bellTimer) clearInterval(bellTimer); bellTimer = null;
  }
  async function mountBell(sess) {
    /* a person who turned the bell off on their profile does not get one */
    try {
      const c = window.EPINOIA_CONFIG;
      const r = await fetch(c.supabaseUrl + '/rest/v1/fan_prefs?select=notify_inapp,theme', { cache: 'no-store', headers: bellHeaders(sess) });
      const rows = r.ok ? await r.json() : [];
      /* THE THEME TRAVELS WITH THE ACCOUNT: chosen on a laptop, it applies on the phone at the
         next sign-in, and is kept in this browser so the next page opens in it before paint */
      if (rows.length && rows[0].theme) {
        const want = rows[0].theme === 'dark' ? 'dark' : 'light';
        let have = 'light';
        try { have = localStorage.getItem('epinoia_theme') === 'dark' ? 'dark' : 'light'; } catch (_) { /* private */ }
        if (want !== have) {
          try { localStorage.setItem('epinoia_theme', want); } catch (_) { /* private */ }
          if (want === 'light') document.documentElement.setAttribute('data-theme', 'light');
          else document.documentElement.removeAttribute('data-theme');
          if (window.epinoiaColourScheme) window.epinoiaColourScheme(want === 'light');
        }
      }
      if (rows.length && rows[0].notify_inapp === false) { unmountBell(); return; }
    } catch (_) { /* no answer: show the bell */ }
    if (bell) return;
    bell = el('div', 'ep-bell');
    const btn = el('button'); btn.type = 'button'; btn.title = 'notifications'; btn.setAttribute('aria-label', 'notifications');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';
    const n = el('span', 'n');
    btn.appendChild(n);
    const panel = el('div', 'panel'); panel.hidden = true;
    bell.append(btn, panel);
    document.body.appendChild(bell);
    const refresh = async () => { try { const k = await bellCount(sess); n.textContent = k ? (k > 99 ? '99+' : String(k)) : ''; } catch (_) { /* offline */ } };
    const open = async () => {
      panel.hidden = false;
      panel.innerHTML = '<div class="ph">notifications</div><div class="empty">loading…</div>';
      let rows = [];
      try { rows = await bellList(sess); } catch (_) { rows = []; }
      panel.textContent = '';
      const ph = el('div', 'ph', 'notifications');
      const me = el('a', null, 'settings'); me.href = root + 'me/';
      const ra = el('button', null, 'mark all read'); ra.type = 'button';
      ra.onclick = async () => { await bellReadAll(sess); open(); refresh(); };
      ph.append(me, ra); panel.appendChild(ph);
      if (!rows.length) {
        panel.appendChild(el('div', 'empty', 'Nothing yet. Follow a club or a player on your profile and their next result lands here.'));
        return;
      }
      rows.forEach(x => {
        const a = el('a', 'it' + (x.read_at ? '' : ' unread'));
        a.href = root + (x.link || 'me/');
        const mid = el('div'); mid.append(el('b', null, x.title), el('small', null, x.body || ''));
        const d = new Date(x.created_at);
        a.append(el('span', 'k', x.kind), mid, el('time', null, d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
        panel.appendChild(a);
      });
    };
    btn.onclick = () => { if (panel.hidden) open(); else panel.hidden = true; };
    document.addEventListener('click', e => { if (bell && !bell.contains(e.target)) panel.hidden = true; });
    refresh();
    bellTimer = setInterval(refresh, 60000);
  }

  const contact = el('a', 'item' + (/\/epinoia\/contact\//.test(here) ? ' on' : ''));
  contact.href = root + 'contact/';
  contact.append(el('span', 'ic', '✉'), el('span', 'tx', 'contact'));
  contact.title = 'contact';
  navFoot.appendChild(contact);

  /* THE WAY OUT IS EPINOIA, not Prophe(s)y. This rail is on the public half
     of the site, and the row at the bottom of it should be the way back to
     that half's own front page — the splash. The scouting side is reachable
     from the splash's first deck, which is a better place for it: a link
     labelled with the OTHER brand, at the foot of every league page, was
     pointing most of the people who pressed it at a members-only sign-in.

     In the logotype, so the brand is never set in the rail's own face. */
  const home = el('a', 'item');
  home.href = root;
  const homeTx = el('span', 'tx epinoia-mark', 'EPINOIΛ');
  home.append(el('span', 'ic', '←'), homeTx);
  home.title = 'back to Epinoia';
  navFoot.appendChild(home);
  /* ------------------------------------------------------------ the tab bar ---
     ON A PHONE THE BAR IS THE LEAGUE'S FIVE PLACES, NOT THE WHOLE RAIL. The rail's row-flow
     put the countries/leagues deck, the account, contact and the admin rows into one sideways
     scroller, so what showed at the bottom of the screen was whatever happened to be scrolled
     into view -- "admin controls · platform · your@email" -- and the pages a fan actually wants
     were off to the left. This bar is fixed: home, fixtures, table, statistics, news, then
     the menu, which opens the full rail as the sheet. Hidden above 820px; left out when the
     page has no league to point at, where the old row does its job. */
  const tabbar = el('div', 'ep-tabbar');
  const TABS = [
    { key: 'home', ic: '⌂', tx: 'home', href: '', on: () => /\/epinoia\/$/.test(here) && !!qp.get('l') },
    { key: 'fixtures' }, { key: 'table' }, { key: 'teams' }, { key: 'statistics' }, { key: 'news' }
  ];
  function paintTabbar() {
    tabbar.textContent = '';
    if (!lg) { nav.classList.remove('has-tabbar'); return; }
    TABS.forEach(t => {
      const spec = t.href !== undefined ? t : PAGES.find(p => p.key === t.key);
      if (!spec) return;
      const a = el('a', 'tab');
      a.href = withLeague(root + (spec.href || ''));
      a.append(el('span', 'ic', spec.ic), el('span', 'tx', spec.tx));
      const on = t.on ? t.on() : (spec.match && spec.match.test(here));
      if (on) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); }
      if (spec.teams) {
        /* the clubs are a layer of the sheet, not a page: open the sheet on that layer */
        a.dataset.teamsTab = '1';
        a.addEventListener('click', e => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          if (!nav.classList.contains('drawer-open')) navToggle.click();
          openTeams(false);
        });
      }
      tabbar.appendChild(a);
    });
    nav.classList.add('has-tabbar');
  }
  paintTabbar();
  nav.appendChild(tabbar);
  nav.appendChild(navScroll);
  nav.appendChild(navFoot);

  /* THE WAY IN, ON A PHONE.
     The bar below 820px is every one of these same rows, reflowed into a
     58px strip you swipe sideways — nothing in it is hidden, but nothing
     about a row of icons tells a reader that swiping reveals more, and the
     group labels and panel titles (what a section actually IS, not just its
     icon) are dropped entirely to fit the strip's height. This button opens
     the identical rail a desktop visitor sees, full labels included, as a
     sheet over the page — the honest route to everything the bar itself
     already links to. Hidden by CSS above 820px, where the rail needs no
     toggle because it is simply always on screen.

     A DIRECT CHILD OF nav, NOT OF navScroll — that is the whole fix. It sits
     outside the element that scrolls, so it can never be scrolled away from,
     with no positioning trick required to keep it in view. */
  const navToggle = el('button', 'item navtoggle');
  navToggle.type = 'button';
  navToggle.setAttribute('aria-label', 'Menu');
  navToggle.setAttribute('aria-expanded', 'false');
  const navToggleIc = el('span', 'ic', '☰');
  const navToggleTx = el('span', 'tx', 'menu');
  navToggle.append(navToggleIc, navToggleTx);
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('drawer-open');
    document.body.classList.toggle('nav-drawer-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    navToggleIc.textContent = open ? '×' : '☰';
    navToggleTx.textContent = open ? 'close' : 'menu';
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('drawer-open')) navToggle.click();
  });
  /* the dimmed page above the sheet closes it, as does choosing anything inside it */
  document.addEventListener('click', e => {
    if (!nav.classList.contains('drawer-open')) return;
    if (!nav.contains(e.target)) { navToggle.click(); return; }
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && nav.contains(a) && !a.dataset.teamsRow && !a.dataset.teamsTab) setTimeout(() => { if (nav.classList.contains('drawer-open')) navToggle.click(); }, 50);
  });
  nav.appendChild(navToggle);

  /* ============================================================== views === */
  let leagues = [];
  const bySlug = () => leagues.find(l => l.slug === lg) || null;

  /* The deck's height is measured rather than assumed. Both panels are in the
     document at once so the transform can slide between them, which means the
     taller one would otherwise set the height and leave a hole beneath the
     shorter one. */
  function panelFor(view) {
    return view === 'teams'  ? teamsPanel
         : view === 'league' ? leaguePanel
         : view === 'root'   ? rootPanel
         : countryPanel;
  }

  function sizeDeck(animate) {
    const active = panelFor(nav.dataset.view);
    const h = active.offsetHeight;
    if (!h) return;
    if (!animate) {
      const t = navdeck.style.transition;
      navdeck.style.transition = 'none';
      navdeck.style.height = h + 'px';
      void navdeck.offsetHeight;              // commit before restoring
      navdeck.style.transition = t;
    } else {
      navdeck.style.height = h + 'px';
    }
  }

  function setView(view, animate) {
    const changing = nav.dataset.view !== view;
    nav.dataset.view = view;
    /* Both panels stay visible FOR THE DURATION of the slide — hiding the one
       being left would make it vanish mid-travel — and the one that ends up
       off screen is then taken out of the tab order, because a keyboard user
       must never land on a link they cannot see. */
    if (changing && animate && !reduced()) {
      navdeck.classList.add('animating');
      countryPanel.setAttribute('aria-hidden', 'false');
      rootPanel.setAttribute('aria-hidden', 'false');
      leaguePanel.setAttribute('aria-hidden', 'false');
      teamsPanel.setAttribute('aria-hidden', 'false');
      setTimeout(() => {
        navdeck.classList.remove('animating');
        applyHidden();
      }, 360);
    } else {
      applyHidden();
    }
    sizeDeck(animate && !reduced());
  }
  function applyHidden() {
    const v = nav.dataset.view;
    countryPanel.setAttribute('aria-hidden', String(v !== 'country'));
    rootPanel.setAttribute('aria-hidden', String(v !== 'root'));
    leaguePanel.setAttribute('aria-hidden', String(v !== 'league'));
    teamsPanel.setAttribute('aria-hidden', String(v !== 'teams'));
  }

  function fillHeader(l) {
    lnameLink.textContent = '';
    /* The chevron matters more than it looks. Picking a league in the list no
       longer navigates, so this name is the ONLY route to the league's front
       page from the rail — and a heading that happens to be a link, with
       nothing saying so, is a route nobody finds. */
    lnameLink.append(crest(l), marquee(l.name), el('span', 'lgo', '›'));
    lnameLink.href = root + '?l=' + encodeURIComponent(l.slug);
    lnameLink.title = l.name + ' — open the league’s front page';
  }

  back.addEventListener('click', () => {
    /* Coming back out abandons the browse. If you drilled into another league
       without leaving the page, the rail goes back to describing the page you
       are actually on — otherwise the highlight in the list would be marking a
       league you only looked at. */
    const from = lg;
    if (lg !== pageLeague) {
      lg = pageLeague;
      markCurrent();
      retarget();
      const l = bySlug();
      if (l) fillHeader(l);
    }
    setView('root', true);
    /* focus follows the eye: the row you came from is where you are now */
    const row = list.querySelector('a[data-league-slug="' + (from || '') + '"]');
    if (row) row.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------ countries ---
     A FLAG IS DERIVED, NEVER STORED. The two letters of an ISO 3166-1 code map
     directly onto the two regional-indicator code points that a font renders
     as that flag, so there is nothing to keep up to date and nothing that can
     disagree with the code beside it. A stored emoji would be a second copy of
     the same fact, and the one that goes stale.

     The NAME comes from Intl.DisplayNames, which knows every region in the
     reader's own language. Where it is unavailable the code stands in, which
     is ugly and correct — better than a hard-coded English list that is wrong
     for half the world and out of date for the rest. */
  function flagOf(code) {
    /* A GLOBE for a league nobody has filed yet, and the same globe the
       countries page uses. The rail said "Elsewhere" behind a white flag and
       the page said "Not yet filed" behind a globe — two names and two glyphs
       for one state, which is the kind of thing a reader notices and cannot
       account for. */
    if (!/^[A-Za-z]{2}$/.test(code || '')) return '\u{1F30D}';
    return String.fromCodePoint(...[...code.toUpperCase()]
      .map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  let regionNames = null;
  function countryName(code) {
    if (!code) return 'Not yet filed';
    if (regionNames === undefined) return code;
    if (!regionNames) {
      try { regionNames = new Intl.DisplayNames(undefined, { type: 'region' }); }
      catch (_) { regionNames = undefined; return code; }
    }
    try { return regionNames.of(code.toUpperCase()) || code; }
    catch (_) { return code; }
  }

  let country = null;                 // the country being browsed, '' = the rest

  function drawCountries() {
    clist.textContent = '';
    const groups = new Map();
    leagues.forEach(l => {
      const k = l.country || '';
      if (!groups.has(k)) groups.set(k, 0);
      groups.set(k, groups.get(k) + 1);
    });
    if (!groups.size) {
      clist.appendChild(el('div', 'gempty', 'none yet'));
      return;
    }
    /* Named countries first, alphabetically by the name a reader sees rather
       than by the code — sorting by code puts Germany under D. */
    [...groups.keys()]
      .sort((a, b) => (a === '') - (b === '') ||
                      countryName(a).localeCompare(countryName(b)))
      .forEach(code => {
        const row = el('button', 'item crow' + (country === code ? ' on' : ''));
        row.type = 'button';
        const name = countryName(code);
        row.title = name + ' \u00b7 ' + groups.get(code) +
                    (groups.get(code) === 1 ? ' league' : ' leagues');
        row.append(el('span', 'ic', flagOf(code)), marquee(name));
        row.addEventListener('click', () => {
          country = code;
          fillCountryHead(code);
          drawLeagues();
          setView('root', true);
          const first = list.querySelector('a[data-league-slug]');
          if (first) first.focus({ preventScroll: true });
        });
        clist.appendChild(row);
      });
  }

  /* THE COUNTRY IS ALWAYS NAMED at the top of the leagues panel. It was only
     written when somebody CLICKED a country row, so a page that opened drilled
     into a league — which is most of them — showed an empty header with a back
     button beside it and nothing saying where you were. */
  function fillCountryHead(code) {
    const name = countryName(code);
    cname.textContent = '';
    cname.append(el('span', 'ic', flagOf(code)), marquee(name));
    cname.title = name;
    cname.href = root + 'countries/';
  }

  cback.addEventListener('click', () => {
    setView('country', true);
    const row = clist.querySelector('.crow.on') || clist.querySelector('.crow');
    if (row) row.focus({ preventScroll: true });
  });

  /* ---------------------------------------------------------- the leagues ---
     Built empty and filled once the list arrives, because the rail must appear
     immediately — navigation that pops in after a network round trip is worse
     than navigation that shows a placeholder. */
  async function fillLeagues() {
    const cfg = window.EPINOIA_CONFIG;
    if (!cfg || !cfg.supabaseUrl) { holding.textContent = ''; return; }
    try {
      const r = await fetch(cfg.supabaseUrl +
        '/rest/v1/leagues?select=id,slug,name,colour_a,colour_b,logo_path,country,nav&order=name',
        { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      leagues = await r.json();
    } catch (_) {
      holding.textContent = 'unavailable';
      return;
    }
    /* The country the page's own league is in, so a page that knows its
       league opens with the right country already chosen rather than in the
       list of every country. */
    const mine = leagues.find(l => l.slug === (lg || pageLeague));
    if (mine) country = mine.country || '';
    drawCountries();
    /* named before the leagues are drawn, so the header is never briefly blank */
    fillCountryHead(country === null ? '' : country);
    drawLeagues();
  }

  function drawLeagues() {
    list.textContent = '';
    const inCountry = country === null
      ? leagues
      : leagues.filter(l => (l.country || '') === country);
    if (!inCountry.length) {
      list.appendChild(el('div', 'gempty', 'none yet'));
      sizeDeck(false);
      return;
    }
    inCountry.forEach(l => {
      const a = el('a', 'item lrow' + (lg && l.slug === lg ? ' on' : ''));
      a.href = root + '?l=' + encodeURIComponent(l.slug);
      a.dataset.leagueSlug = l.slug;
      a.title = l.name;
      a.append(crest(l), marquee(l.name));

      a.addEventListener('click', (e) => {
        /* Let a middle click, a modified click or a right click do what the
           browser would do — this is a real link to a real page and hijacking
           every activation of it would break opening a league in a new tab. */
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
            e.shiftKey || e.altKey) return;
        e.preventDefault();

        /* PICKING A LEAGUE CHANGES THE RAIL AND NOTHING ELSE. It used to load
           the splash as well, which meant choosing where to go cost a full page
           load before you had chosen anything — and threw away whatever you
           were already reading. Opening the league's front page is a separate,
           deliberate act: press its name at the top of the panel, which is
           where the eye already is once the slide finishes. */
        lg = l.slug;
        markCurrent();
        fillHeader(l);
        retarget();
        setView('league', true);
      });

      list.appendChild(a);
    });
    markCurrent();
    const l = bySlug();
    /* A page that names a league opens inside it; anything else opens at the
       top, which is now the countries rather than a flat list of every league
       on the platform. */
    if (l) { fillHeader(l); applyNav(l); setView('league', false); }
    else { setView(country === null ? 'country' : 'root', false); }
    /* one more measure after the marquee pass has run, and only then is the
       rail allowed to animate — everything up to here is the page's opening
       position, not a change somebody made */
    afterPaint(() => {
      sizeDeck(false);
      afterPaint(() => nav.classList.remove('noanim'));
    });
  }

  /* WHICH TABS A LEAGUE SHOWS (0053). Absent means shown, so a league that
     has never had an opinion gets everything and a tab added later appears
     for everybody rather than being hidden for every league that predates it.
     The gated rows are ANDed with this: turning the club portal off in the
     settings hides it from a manager too, which is the point of the switch. */
  function applyNav(l) {
    const want = (l && l.nav) || {};
    navKeyed.forEach(([node, key]) => {
      const off = want[key] === false;
      node.dataset.navOff = off ? '1' : '';
      /* A ROLE-GATED ROW IS LEFT TO THE GATE, which runs later and would
         otherwise un-hide what a league has just switched off. It reads
         navOff and ANDs the two. Everything else is decided here and here
         only, including turning a row back ON when browsing to a league that
         has not disabled it — an applyNav that could only hide would leave
         the previous league's switches on screen. */
      if (!isGated(node)) node.hidden = off;
      else if (off) node.hidden = true;
    });
  }
  const isGated = node => gated.some(g => g[0] === node);

  function markCurrent() {
    list.querySelectorAll('a[data-league-slug]').forEach(a => {
      a.classList.toggle('on', !!lg && a.dataset.leagueSlug === lg);
    });
  }
  function retarget() {
    carriers.forEach(([a, base]) => { a.href = withLeague(base); });
    /* "You are here" only while the rail is showing the league this page is
       actually about. Browse the rail to another league and the highlight goes
       out, because the row now points somewhere you are not. */
    const sameLeague = (lg || '') === (pageLeague || '');
    pages.querySelectorAll('a.item').forEach(a => {
      a.classList.toggle('on', sameLeague && a.dataset.hereIs === '1');
    });
  }

  /* --------------------------------------------------------------- account ---
     The rail does NOT load the Supabase SDK. It is on every public page and
     the SDK is a large dependency for a page that only needs to know whether
     somebody is signed in — so the stored session is read directly, and the
     sign-in flow lives on its own page, which does load it.

     The session key is the SDK's own convention: sb-<project-ref>-auth-token,
     with the ref taken from the configured URL so this keeps working if the
     project ever moves. */
  function projectRef() {
    const c = window.EPINOIA_CONFIG;
    if (!c || !c.supabaseUrl) return null;
    const m = String(c.supabaseUrl).match(/^https?:\/\/([^.]+)\./);
    return m ? m[1] : null;
  }

  function storedSession() {
    const ref = projectRef();
    if (!ref) return null;
    let raw;
    try { raw = localStorage.getItem('sb-' + ref + '-auth-token'); } catch (_) { return null; }
    if (!raw) return null;
    let j;
    try { j = JSON.parse(raw); } catch (_) { return null; }
    const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
    if (!tok) return null;
    /* an expired token is not a session — showing somebody as signed in when
       every request will 401 is worse than showing them signed out */
    const exp = j.expires_at || (j.currentSession && j.currentSession.expires_at);
    if (exp && Number(exp) * 1000 < Date.now()) return null;
    const user = j.user || (j.currentSession && j.currentSession.user) || {};
    return { token: tok, email: user.email || '' };
  }

  /* Ask the database what this account may actually do. whoami() is the same
     RPC the admin console uses, so the rail and the console can never disagree
     about somebody's roles. */
  async function whoami(token) {
    const c = window.EPINOIA_CONFIG;
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/whoami', {
      method: 'POST', cache: 'no-store',
      headers: {
        apikey: c.supabaseAnonKey,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  /* Swap a row between its real destination and its demo. Both states are
     spelled out rather than one being "the default", so repeated calls — and
     applyAuth runs again whenever the session changes — always land on the
     right one instead of drifting. */
  function applyDemo(node, spec, demoHref, toDemo) {
    if (node.dataset.navOff === '1') { node.hidden = true; return; }
    node.hidden = false;
    const tx = node.querySelector('.tx');
    if (toDemo) {
      node.href = demoHref;
      if (tx) tx.textContent = spec.demo.tx;
      node.title = spec.demo.title;
      node.dataset.demo = '1';
    } else {
      node.href = spec.lg ? withLeague(root + spec.href) : root + spec.href;
      if (tx) tx.textContent = spec.tx;
      node.title = spec.tx;
      delete node.dataset.demo;
    }
  }

  /* Which run of applyAuth is the current one. Switching accounts fires this
     twice in quick succession — once for the sign-out, once for the sign-in —
     and whoami() is a round trip, so without this the FIRST answer can land
     after the second and repaint the rail with the previous account's roles.
     A signed-out answer arriving late is the same hazard in reverse. */
  let authRun = 0;

  async function applyAuth() {
    const run = ++authRun;
    const sess = storedSession();

    if (!sess) {
      gated.forEach(([node]) => { node.hidden = true; });
      demoRows.forEach(([node, spec, demoHref]) => applyDemo(node, spec, demoHref, true));
      acctTx.textContent = 'sign in';
      acctIc.textContent = '◐';
      meLink.hidden = true;
      unmountBell();
      acctLink.href = root + 'signin/?next=' +
        encodeURIComponent(location.pathname + location.search);
      acctLink.title = 'sign in';
      sizeDeck(false);
      return;
    }

    acctTx.textContent = sess.email || 'account';
    acctIc.textContent = '◉';
    meLink.hidden = false;
    mountBell(sess);
    acctLink.href = root + 'signin/';
    acctLink.title = sess.email ? sess.email + ' — manage or sign out' : 'account';

    let who = {};
    try { who = await whoami(sess.token) || {}; } catch (_) { who = {}; }
    if (run !== authRun) return;          // a newer sign-in overtook this one
    gated.forEach(([node, pred]) => {
      let ok = false;
      try { ok = !!pred(who); } catch (_) { ok = false; }
      /* Both have to agree. Holding the role is not enough if the league has
         switched the page off, and the league switching it on does not hand
         it to somebody without the role. */
      node.hidden = !ok || node.dataset.navOff === '1';
      /* A row with a demo behind it never simply disappears: without the role
         it becomes the practice game instead. Still respects the league
         switching the page off entirely — navOff wins over both. */
      const demo = demoRows.find(d => d[0] === node);
      if (demo) applyDemo(node, demo[1], demo[2], !ok);
    });
    /* If every entry under it is hidden, hide the heading too rather than
       leaving a label with nothing beneath it.

       Counted WITHIN THE LEAGUE PANEL, not across the whole rail. The admin
       row at the top level is gated as well now, and a rail-wide count would
       let it hold up a "take part" heading in a panel where nothing is
       actually shown. */
    const anyShown = [...pages.querySelectorAll('a.item')].some(a => !a.hidden);
    gated.forEach(([n]) => { if (n.tagName !== 'A') n.hidden = !anyShown; });
    sizeDeck(false);
  }

  /* ================================================================ mount === */
  const mount = () => {
    document.body.appendChild(nav);
    document.body.classList.add('has-nav');
    applyHidden();
    sizeDeck(false);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  fillLeagues();
  applyAuth();

  /* ===================== WATCHING WHO IS SIGNED IN =====================

     The rail read the token once, at load, and then only listened for the
     browser's `storage` event — which by specification does NOT fire in the
     tab that made the change. Every ordinary sign-in and sign-out happens in
     the tab you are looking at, so the rail was told about none of them: sign
     out of one account, sign into another, and it went on showing the first
     account's email and, worse, the first account's gated rows until
     something happened to reload the page.

     Four sources now, because no single one covers every case:

       the SDK        instant and authoritative, but only on pages that load
                      it — the rail deliberately does not, being on every
                      public page where 200kB of auth library would be paid
                      for by everybody to benefit the few;
       storage event  the other tabs, which the SDK in this tab cannot see;
       focus/visible  coming back to a tab after signing in elsewhere;
       a slow poll    the backstop that catches everything else, including a
                      token that expired while the page sat open.

     The poll is a localStorage read and a JSON parse against a cached
     signature — nothing happens unless the answer actually changed, so the
     cost of the common case is one string comparison every two seconds. */
  let authSig = null;
  function currentSig() {
    const sess = storedSession();
    return sess ? (sess.email || '?') + '|' + sess.token.slice(-24) : 'signed-out';
  }
  function checkAuth() {
    const sig = currentSig();
    if (sig === authSig) return;
    authSig = sig;
    applyAuth();
  }
  authSig = currentSig();          // applyAuth() above already drew this one

  window.addEventListener('storage', e => {
    if (e.key && e.key.indexOf('-auth-token') !== -1) checkAuth();
  });
  /* fired by epinoiaSignOut in this same tab, where a storage event cannot
     reach — the difference between the rail updating now and in two seconds */
  window.addEventListener('epinoia:auth', checkAuth);
  window.addEventListener('focus', checkAuth);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAuth();
  });
  setInterval(checkAuth, 2000);

  /* When the page does carry the SDK, take the authoritative signal too: it
     fires the instant a session changes rather than up to two seconds later. */
  (function subscribeSdk() {
    const attach = () => {
      const sb = window.__sb || (window.epinoiaClient && window.supabase && window.epinoiaClient());
      if (!sb || !sb.auth || subscribeSdk.done) return false;
      subscribeSdk.done = true;
      try { sb.auth.onAuthStateChange(() => checkAuth()); } catch (_) {}
      return true;
    };
    if (attach()) return;
    /* the SDK is loaded with defer on most pages, and lazily on some, so try
       again a few times rather than assuming it was there at first paint */
    let n = 0;
    const t = setInterval(() => { if (attach() || ++n > 20) clearInterval(t); }, 250);
  })();
  /* the rail is a fixed column; a resize changes what fits in it */
  window.addEventListener('resize', () => sizeDeck(false));

  /* The assignment pages already make repoints the rail and drills it in, with
     no page edit. This is how a page that resolved its league from the network
     rather than from ?l= ends up on the right view. */
  try {
    Object.defineProperty(window, '__CS_LEAGUE_SLUG', {
      configurable: true,
      get() { return lg; },
      set(v) {
        lg = v || '';
        try { paintTabbar(); } catch (_) { /* before the bar exists */ }
        pageLeague = lg;              // the page has just told us what it is about
        markCurrent();
        retarget();
        const l = bySlug();
        if (l) { fillHeader(l); setView('league', false); }
        else { setView('root', false); }
        applyAuth();                 // role gating is league-scoped
      }
    });
  } catch (e) { /* a page that froze the global keeps the rail it was built with */ }
})();
