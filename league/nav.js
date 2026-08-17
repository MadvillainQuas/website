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

  /* THE SPLASH HAS NO RAIL. /league/ with no league asked for is the
     platform's front page — a full-bleed pool with its own way into
     everything — and a dark fixed column down the side of it is a navigation
     bar arguing with a landing page. Every other page keeps the rail,
     including /league/?l=slug, which is a different page at the same path. */
  const atSplash = /\/league\/$/.test(location.pathname.replace(/index\.html$/, ''))
                   && !new URLSearchParams(location.search).has('l');
  if (atSplash) return;

  const here = location.pathname.replace(/\/index\.html$/, '/');
  /* Climb back to /league/ by counting the directories below it, rather than
     assuming one. Subpages exist (stats/wowy/), and a hard-coded '../'
     silently pointed them at their parent, which resolved to a real URL and so
     failed as a wrong destination rather than a broken link. */
  const seg = here.split('/league/')[1] || '';
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
    { href: 'fixtures/',   ic: '▥', tx: 'fixtures',   lg: true, match: /\/league\/fixtures\// },
    { href: 'stats/',      ic: '▦', tx: 'statistics', lg: true, match: /\/league\/stats\/$/ },
    { href: 'stats/wowy/', ic: '◫', tx: 'wowy',       lg: true, match: /\/league\/stats\/wowy\// },
    { href: 'l/',          ic: '▤', tx: 'table',      lg: true, match: /\/league\/l\// },
    { label: 'take part', auth: true },
    { href: 'score/', ic: '●', tx: 'score a game', match: /\/league\/score\//, auth: true,
      role: w => (w.scoring || []).length || adminsThis(w) },
    { href: 'app/',   ic: '◆', tx: 'club portal',  match: /\/league\/app\//,  auth: true,
      role: w => (w.teams || []).length || adminsThis(w) },
    { href: 'admin/', ic: '▲', tx: 'league admin', match: /\/league\/admin\//, auth: true,
      role: w => adminsThis(w) }
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
      img.src = cfg.supabaseUrl + '/storage/v1/object/public/' + l.logo_path;
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

  const navdeck = el('div', 'navdeck');
  const deck = el('div', 'deck');
  const rootPanel = el('div', 'panel rootpanel');
  const leaguePanel = el('div', 'panel leaguepanel');
  deck.append(rootPanel, leaguePanel);
  navdeck.appendChild(deck);
  nav.appendChild(navdeck);

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
  /* Not `/league/admin/` loosely, or the platform console below would light
     this row up as well — its address is underneath this one. */
  if (/\/league\/admin\/(?!platform\/)/.test(here)) adminRow.classList.add('on');
  adminRow.hidden = true;
  rootPanel.appendChild(adminRow);

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
  if (/\/league\/admin\/platform\//.test(here)) platRow.classList.add('on');
  platRow.hidden = true;
  rootPanel.appendChild(platRow);

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

  const gated = [];            // [node, predicate] — shown once roles are known
  const carriers = [];         // [anchor, base path] — links that take the league

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
    if (it.lg) carriers.push([a, root + it.href]);
    a.append(el('span', 'ic', it.ic), el('span', 'tx', it.tx));
    a.title = it.tx;
    if (it.auth) { a.hidden = true; gated.push([a, it.role || (() => true)]); }
    pages.appendChild(a);
  });
  retarget();          // set the initial "you are here" marks

  /* ---- the three that never move ---- */
  nav.appendChild(el('div', 'gap'));

  const acct = el('div', 'acct');
  const acctLink = el('a', 'item');
  const acctIc = el('span', 'ic', '◐');
  const acctTx = el('span', 'tx', 'sign in');
  acctLink.append(acctIc, acctTx);
  acctLink.href = root + 'signin/?next=' +
    encodeURIComponent(location.pathname + location.search);
  acctLink.title = 'sign in';
  acct.appendChild(acctLink);
  nav.appendChild(acct);

  const contact = el('a', 'item' + (/\/league\/contact\//.test(here) ? ' on' : ''));
  contact.href = root + 'contact/';
  contact.append(el('span', 'ic', '✉'), el('span', 'tx', 'contact'));
  contact.title = 'contact';
  nav.appendChild(contact);

  const prophesy = el('a', 'item');
  prophesy.href = '/index.html';
  prophesy.append(el('span', 'ic', '←'), el('span', 'tx', 'prophesy'));
  prophesy.title = 'back to Prophesy';
  nav.appendChild(prophesy);

  /* ============================================================== views === */
  let leagues = [];
  const bySlug = () => leagues.find(l => l.slug === lg) || null;

  /* The deck's height is measured rather than assumed. Both panels are in the
     document at once so the transform can slide between them, which means the
     taller one would otherwise set the height and leave a hole beneath the
     shorter one. */
  function sizeDeck(animate) {
    const active = nav.dataset.view === 'league' ? leaguePanel : rootPanel;
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
      rootPanel.setAttribute('aria-hidden', 'false');
      leaguePanel.setAttribute('aria-hidden', 'false');
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
    const league = nav.dataset.view === 'league';
    rootPanel.setAttribute('aria-hidden', String(league));
    leaguePanel.setAttribute('aria-hidden', String(!league));
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

  /* ---------------------------------------------------------- the leagues ---
     Built empty and filled once the list arrives, because the rail must appear
     immediately — navigation that pops in after a network round trip is worse
     than navigation that shows a placeholder. */
  async function fillLeagues() {
    const cfg = window.EPINOIA_CONFIG;
    if (!cfg || !cfg.supabaseUrl) { holding.textContent = ''; return; }
    try {
      const r = await fetch(cfg.supabaseUrl +
        '/rest/v1/leagues?select=slug,name,colour_a,colour_b,logo_path&order=name',
        { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      leagues = await r.json();
    } catch (_) {
      holding.textContent = 'unavailable';
      return;
    }
    drawLeagues();
  }

  function drawLeagues() {
    list.textContent = '';
    if (!leagues.length) {
      list.appendChild(el('div', 'gempty', 'none yet'));
      sizeDeck(false);
      return;
    }
    leagues.forEach(l => {
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
    if (l) { fillHeader(l); setView('league', false); }
    else { setView('root', false); }
    /* one more measure after the marquee pass has run, and only then is the
       rail allowed to animate — everything up to here is the page's opening
       position, not a change somebody made */
    afterPaint(() => {
      sizeDeck(false);
      afterPaint(() => nav.classList.remove('noanim'));
    });
  }

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

  async function applyAuth() {
    const sess = storedSession();

    if (!sess) {
      gated.forEach(([node]) => { node.hidden = true; });
      acctTx.textContent = 'sign in';
      acctIc.textContent = '◐';
      acctLink.href = root + 'signin/?next=' +
        encodeURIComponent(location.pathname + location.search);
      acctLink.title = 'sign in';
      sizeDeck(false);
      return;
    }

    acctTx.textContent = sess.email || 'account';
    acctIc.textContent = '◉';
    acctLink.href = root + 'signin/';
    acctLink.title = sess.email ? sess.email + ' — manage or sign out' : 'account';

    let who = {};
    try { who = await whoami(sess.token) || {}; } catch (_) { who = {}; }
    gated.forEach(([node, pred]) => {
      let ok = false;
      try { ok = !!pred(who); } catch (_) { ok = false; }
      node.hidden = !ok;
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

  /* signing out in another tab should not leave this one showing an admin
     link that no longer works */
  window.addEventListener('storage', e => {
    if (e.key && e.key.indexOf('-auth-token') !== -1) applyAuth();
  });
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
