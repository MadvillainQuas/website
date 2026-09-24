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
  /* ------------------------------------------------------------ THE APP SHELL ---
     window.EpinoiaAppShell: the decisions about the Android app that the rail's banners and
     HOME's app card share (roadmap Phase 6), kept as plain functions of what they are handed
     so supabase/tests/app-shell.test.mjs can hold them without a browser. Defined before
     anything else in this file returns early, so it exists on every page that loads nav.js.

       where(env)           'app' | 'ios' | 'android' | 'other'
                            env = { app, mApp, ua, platform, maxTouchPoints }
       installOffer(env)    what the install banner offers: 'none' in the app and on the
                            download page itself, 'android-app' on an Android browser once
                            the app is out (the real app, not the web app), 'ios' (Add to
                            Home Screen, as it always was), 'web' elsewhere, and on Android
                            until then (only on beforeinstallprompt)
                            env adds { path, released }
       appCard(env, ver)    HOME's card: null, or { href, versionName } on an Android browser
                            when version.json says released: true
       promo(env)           the standing phone links to the download page: null, or
                            { kind, href, icon, row, title, sub } (env adds { path, released,
                            standalone }); window.EpinoiaAppPromo carries the answer to pages
       NOT BEFORE THE FIRST RELEASE. epinoia/android/version.json carries "released"; until
       the owner's first signed build is out and that is flipped to true, an Android browser
       keeps the web-app offer it always had and nothing points at a download that 404s.
       readShell(store)     sessionStorage epinoia_shell, as appmode.js stored it, or null
       needsUpdate(sh, ver) the launch's shell build is below version.json's minShell
       cleanVersion(json)   version.json reduced to the fields the site trusts
       version(url, deps)   version.json, fetched at most once a session (sessionStorage
                            epinoia_android_version), never rejecting: null when unknown

     THE IPHONE APP (ios/) has its own file, epinoia/ios/version.json, and the same rules: an
     iPhone is offered it ('ios-app' from installOffer, kind 'ios-app' from promo, HOME's card
     with platform 'ios') only once that file says released: true (env.iosReleased), and until
     then keeps the Home Screen steps, now on the iPhone page. An iPhone is never sent to the
     Android page.
       cleanIosVersion(json) ios/version.json reduced: { build, version, minShell, appStoreId,
                            appStore, released }
       iosVersion(url, deps) that file, once a session (sessionStorage epinoia_ios_version)
       nativeShell(nat)     the iPhone app's window.EpinoiaNative as { shell: build }, for
                            needsUpdate, or null */
  const AppShell = (() => {
    const VERSION_KEY = 'epinoia_android_version';
    const whole = v => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isInteger(n) ? n : null;
    };
    const where = env => {
      const e = env || {};
      if (e.app === true || e.mApp === true) return 'app';
      const ua = String(e.ua || '');
      /* iPadOS asks for the desktop site and reports itself as a Mac with a touch screen */
      if (/iPhone|iPad|iPod/i.test(ua) || (e.platform === 'MacIntel' && (e.maxTouchPoints || 0) > 1)) return 'ios';
      /* Chrome, Samsung Internet, Firefox, Edge, Opera...: every Android browser says Android */
      if (/Android/i.test(ua)) return 'android';
      return 'other';
    };
    const installOffer = env => {
      const w = where(env);
      if (w === 'app') return 'none';
      if (w === 'android') {
        if (/^\/epinoia\/android(\/|$)/.test(String((env && env.path) || ''))) return 'none';
        return env.released === true ? 'android-app' : 'web';
      }
      /* AN IPHONE IS OFFERED THE IPHONE APP once epinoia/ios/version.json says it is out
         (iosReleased), never the Android one; until then Add to Home Screen, as always */
      if (w === 'ios') {
        /* the iPhone page says all of it itself, the Home Screen steps included */
        if (/^\/epinoia\/ios(\/|$)/.test(String((env && env.path) || ''))) return 'none';
        return env.iosReleased === true ? 'ios-app' : 'ios';
      }
      return 'web';
    };
    const cleanVersion = j => {
      if (!j || typeof j !== 'object') return null;
      const name = typeof j.versionName === 'string' && /^\d+(\.\d+){1,3}$/.test(j.versionName) ? j.versionName : '';
      return { versionCode: whole(j.versionCode), versionName: name, minShell: whole(j.minShell), released: j.released === true };
    };
    /* epinoia/ios/version.json reduced the same way: build, version, minShell, the App Store's
       numeric id and released. appStore is the listing's https link, or null before there is one. */
    const cleanIosVersion = j => {
      if (!j || typeof j !== 'object') return null;
      const name = typeof j.version === 'string' && /^\d+(\.\d+){1,3}$/.test(j.version) ? j.version : '';
      const id = /^\d{6,12}$/.test(String(j.appStoreId == null ? '' : j.appStoreId)) ? String(j.appStoreId) : null;
      const build = whole(j.build);
      /* released needs a build too, so the Android file (versionCode, no build) is never read as the iPhone's */
      return { build, version: name, minShell: whole(j.minShell), appStoreId: id,
               appStore: id ? 'https://apps.apple.com/app/id' + id : null, released: j.released === true && build !== null && build > 0 };
    };
    const appCard = (env, ver) => {
      const w = where(env);
      if (w === 'ios') {
        const v = cleanIosVersion(ver);
        if (!v || !v.released) return null;
        return { href: (env && env.iosHref) || '../ios/', versionName: v.version, platform: 'ios' };
      }
      if (w !== 'android') return null;
      const v = cleanVersion(ver);
      if (!v || !v.released) return null;
      return { href: (env && env.href) || '../android/', versionName: v.versionName };
    };
    /* THE APP, SIGNPOSTED ON A PHONE. The standing links to the download page (the rail's
       row, the strip at the end of a page, the notification sheet's line): null on a desktop,
       in the app, on the download pages themselves and on the staff tools; on an Android
       browser, the Android app, only once it is out; on an iPhone, the iPhone app once IT is out
       (iosReleased), and until then the iPhone page's Home Screen steps, unless EPINOIΛ is
       already opened from the Home Screen. An iPhone is never pointed at the Android page.
       href is relative to the rail's root. */
    const NO_PROMO = /^\/epinoia\/(android|ios|admin|app|edit|embed|broadcast|api|signin|join|score|clockcam)(\/|$)/;
    const promo = env => {
      const e = env || {};
      if (NO_PROMO.test(String(e.path || ''))) return null;
      const w = where(e);
      if (w === 'android' && e.released === true) {
        return { kind: 'android', href: 'android/', icon: 'android/icon-192.png', row: 'get the app',
          title: 'Get the EPINOIΛ app', sub: 'Scores, fixtures and game alerts that pop up, in an app of its own.' };
      }
      if (w === 'ios' && e.iosReleased === true) {
        return { kind: 'ios-app', href: 'ios/', icon: 'ios/icon-192.png', row: 'get the app',
          title: 'Get the EPINOIΛ app', sub: 'Scores, fixtures and game alerts on your iPhone, in an app of its own.' };
      }
      if (w === 'ios' && e.standalone !== true) {
        return { kind: 'ios', href: 'ios/#homeScreen', icon: 'brand/epinoia-mark-192.png', row: 'add to home screen',
          title: 'EPINOIΛ on your iPhone', sub: 'Add it to your Home Screen: it opens full screen, with game alerts.' };
      }
      return null;
    };
    const readShell = store => {
      try {
        const j = JSON.parse((store && store.getItem('epinoia_shell')) || 'null');
        return j && typeof j === 'object' ? j : null;
      } catch (_) { return null; }
    };
    const needsUpdate = (sh, ver) => {
      const code = sh ? whole(sh.shell) : null;
      const v = cleanVersion(ver);
      return code !== null && code > 0 && !!v && v.minShell !== null && code < v.minShell;
    };
    /* ONE FETCH A SESSION. A good answer is kept in sessionStorage for the rest of the session
       (a new minShell reaches the app on its next launch, which is when an update could be
       installed anyway); a failure is not kept, so the next page tries again. Within one page
       the promise itself is shared. */
    /* THE IPHONE APP'S FILE is iosVersion(url, deps): the same once-a-session fetch, kept under
       its own key and reduced by cleanIosVersion, with its own shared promise. */
    const IOS_VERSION_KEY = 'epinoia_ios_version';
    const pending = new Map();
    const version = (url, deps) => {
      const d = deps || {};
      const store = d.store;
      const key = d.key || VERSION_KEY;
      const clean = typeof d.clean === 'function' ? d.clean : cleanVersion;
      try {
        const hit = clean(JSON.parse((store && store.getItem(key)) || 'null'));
        if (hit) return Promise.resolve(hit);
      } catch (_) { /* a spoilt copy is fetched again */ }
      if (pending.has(key) && !d.fresh) return pending.get(key);
      const get = d.fetch || (typeof fetch === 'function' ? fetch : null);
      if (!get) return Promise.resolve(null);
      const p = Promise.resolve()
        .then(() => get(url, { cache: 'no-store' }))
        .then(r => (r && r.ok ? r.json() : null))
        .then(j => {
          const v = clean(j);
          if (v) { try { store && store.setItem(key, JSON.stringify(v)); } catch (_) { /* private mode */ } }
          else pending.delete(key);
          return v;
        })
        .catch(() => { pending.delete(key); return null; });
      pending.set(key, p);
      return p;
    };
    const iosVersion = (url, deps) => version(url, Object.assign({}, deps || {}, { key: IOS_VERSION_KEY, clean: cleanIosVersion }));
    /* THE IPHONE APP SAYS WHICH BUILD IT IS through window.EpinoiaNative: { shell: build } in the
       shape readShell gives the Android launcher's report, so needsUpdate reads both */
    const nativeShell = nat => {
      const n = nat && nat.platform === 'ios' ? whole(nat.build) : null;
      return n !== null && n > 0 ? { shell: n, platform: 'ios' } : null;
    };
    return { where, installOffer, appCard, promo, readShell, needsUpdate, cleanVersion, version, VERSION_KEY,
             cleanIosVersion, iosVersion, IOS_VERSION_KEY, nativeShell };
  })();
  window.EpinoiaAppShell = AppShell;

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
  /* this file's own ?v= stamp, so a script it loads later is the same build */
  const stamp = (() => {
    const me = document.currentScript;
    const m = me && /[?&]v=(\d+)/.exec(me.src || '');
    return m ? '?v=' + m[1] : '';
  })();
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
  /* THE PLATFORM'S OWN PAGES ARE NOBODY'S LEAGUE. HOME, the global fixtures and
     global scouting reach across every league at once, so a stray ?l= in their
     address (a shared link, a sign-in that came back with one) must not drill
     the rail into a league or draw that league's tab bar over a page that is
     not about it. */
  const PLATFORM_PAGE = /\/epinoia\/(home|games|scouting)\//;
  const onPlatform = PLATFORM_PAGE.test(here);
  const atHome = /\/epinoia\/home\/$/.test(here);
  let lg = onPlatform ? '' : (qp.get('l') || (window.__CS_LEAGUE_SLUG || ''));
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
    /* the league's Table page: its standings and, a tab along, every club's statistics. The one
       label longer than a row is wide, so it may take TWO lines (the rail and the phone bar),
       and the no-break space keeps "Team Stats" together: it breaks after the slash or not at all. */
    { href: 'l/',          ic: '▤', tx: 'Table / Team\xa0Stats', two: true, lg: true, key: 'table',
      match: /\/epinoia\/l\// },
    /* not a page: a layer of the rail (the clubs), see openTeams */
    { href: 'l/',          ic: '◉', tx: 'teams',      lg: true, key: 'teams', teams: true,
      match: /\/epinoia\/t\// },
    /* WHO IS MISSING. Worked out from the box scores rather than filed by anybody
       (epinoia/injuries.js), so every league has one the moment it has games. */
    { href: 'injuries/',   ic: '✚', tx: 'injury report', lg: true, key: 'injuries',
      match: /\/epinoia\/injuries\// },
    { href: 'news/',       ic: '❑', tx: 'news',       lg: true, key: 'news',
      match: /\/epinoia\/news\// },
    /* EVERY WEEK'S FANS' PICKS (epinoia/votes/, migration 0150). Probed like the video
       hub: a league appears here once its first weekly vote has opened, and not
       before, so no league is offered an empty page. */
    { href: 'votes/',      ic: '★', tx: 'fans’ vote', lg: true, key: 'votes', probe: 'votes',
      match: /\/epinoia\/votes\// },
    /* THE VIDEO HUB IS THE ONE ROW THAT DEPENDS ON CONTENT RATHER THAN ON WHO
       YOU ARE. Most leagues have no game whose broadcast has been read by the
       clock reader, and a row leading to an empty page is worse than no row:
       it advertises a feature the league does not have. So it starts hidden
       like the role-gated rows do, and a probe of the league on screen
       (probeLeague below) is what shows it. */
    { href: 'video/',      ic: '▶', tx: 'video hub',  lg: true, key: 'video', probe: 'video',
      match: /\/epinoia\/video\// },
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
    inner.setAttribute('translate', 'no');     // a league or club name, never a dictionary word
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
      /* at the size the rail draws it (0158): the uploads are 400-512 px, the plate ~30 */
      img.src = (window.epinoiaLogoUrl && window.epinoiaLogoUrl(l.logo_path, 64)) ||
                cfg.supabaseUrl + '/storage/v1/object/public/media-public/' + l.logo_path;
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
  /* A WOMEN'S LEAGUE IS MARKED, QUIETLY: a small "W" after its name in the rail, and on the league tab
     of the phone's bar. It is read off leagues.gender (0131, set by the console or by a source row's
     league_gender), so a league with no stated gender is never marked. */
  const isWomen = (l) => !!l && l.gender === 'women';
  const wtag = () => {
    const t = el('span', 'wtag', 'W');
    t.title = 'Women\u2019s league';
    t.setAttribute('role', 'img');
    t.setAttribute('aria-label', 'women\u2019s league');
    return t;
  };
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
  /* FIVE LEVELS: the platform itself, then countries, then that country's
     leagues, then the league's pages, then its clubs. All five live in the
     document at once so the deck can slide between them; only one is ever in
     the tab order. */
  const homePanel = el('div', 'panel homepanel');
  const countryPanel = el('div', 'panel countrypanel');
  const rootPanel = el('div', 'panel rootpanel');
  const leaguePanel = el('div', 'panel leaguepanel');
  /* THE CLUBS, A LAYER DEEPER. "Teams" in the league's pages slides the deck one more panel
     along: the league's clubs, each with its crest (or a monogram in its colour where none
     has been published), each a link to the club's profile. The list is fetched the first
     time the layer opens and kept for the page. */
  const teamsPanel = el('div', 'panel teamspanel');
  /* YOUR OWN, off the footer. Not another rung of the ladder above it — it is
     reached from "your profile" at the bottom of the rail, not by drilling down
     through countries — but it rides the same deck so it inherits the slide,
     the focus handling, the height animation and the phone drawer rather than
     growing a second mechanism beside them. */
  const followsPanel = el('div', 'panel followspanel');
  deck.append(homePanel, countryPanel, rootPanel, leaguePanel, teamsPanel, followsPanel);
  navdeck.appendChild(deck);
  navScroll.appendChild(navdeck);

  /* ---- country panel: every country with a league in it ---- */
  const ctitle = el('a', 'ptitle', 'HOME');
  /* THE HEADING IS HOME. It used to say Countries and open a second water page
     listing them; HOME now lists every league grouped by country, above the
     day's fixtures and the best players, so the heading of the list of
     countries opens the page that is that list and more. Highlighted while
     you are on it, like any row that names where you are. */
  ctitle.href = root + 'home/';
  ctitle.title = 'HOME — every league, today’s fixtures, the best players';
  if (atHome) { ctitle.classList.add('on'); ctitle.setAttribute('aria-current', 'page'); }
  const clist = el('div', 'leagues');
  clist.appendChild(el('div', 'gempty', '…'));
  /* The way back to the platform layer. The heading stays the same link it has
     always been — pressing HOME goes HOME, from here and from the panel above
     it — and the chevron beside it is the one that only moves the rail. */
  const chome = el('button', 'back', '‹');
  chome.type = 'button';
  chome.title = 'Back';
  chome.setAttribute('aria-label', 'Back to the Epinoia menu');
  chome.addEventListener('click', () => setView('home', true));
  const cphead = el('div', 'phead titlehead');
  cphead.append(chome, ctitle);
  countryPanel.append(cphead, clist);

  /* ---- home panel: the platform, before any league ----
     WHAT BELONGS TO NO LEAGUE, IN ONE PLACE. Global fixtures and global
     scouting are pages about every league at once; in the rail they used to
     sit in the foot among the rows about YOU (your account, your consoles,
     contact), which put "every league's fixtures" three inches below the
     league you were reading and in the wrong half of the rail.

     This layer is where the rail now starts, and the countries are one step
     in from it rather than the top of the tree. */
  /* THE MARK ITSELF, at the head of the rail — the one place the drawn logo can
     sit on every page without competing with a league's own crest: small, in
     front of the logotype, the way a masthead carries a device. */
  const htitle = el('a', 'ptitle');
  htitle.classList.add('epinoia-mark');
  const hmark = el('img');
  hmark.src = root + 'brand/mark-256.png';
  hmark.alt = '';
  hmark.width = 22;
  hmark.height = 22;
  hmark.className = 'ep-brandmark';
  /* NO CLASS ON THE WORD. `wm` is the kit's wordmark CHIP (epinoia-kit.css:
     a green gradient block with the score face on it) and putting it here drew
     exactly that, next to the mark, in the wrong font and too wide for the
     rail. The heading already carries epinoia-mark; the word needs nothing. */
  htitle.append(hmark, el('span', null, 'EPINOIΛ'));
  htitle.href = root + 'home/';
  htitle.title = 'HOME — every league, today’s fixtures, the best players';
  if (atHome) { htitle.classList.add('on'); htitle.setAttribute('aria-current', 'page'); }

  const hlist = el('div', 'pages');
  const platformRow = (icon, text, href, hereRe, title) => {
    const a = el('a', 'item' + (hereRe.test(here) ? ' on' : ''));
    a.href = root + href;
    a.append(el('span', 'ic', icon), el('span', 'tx', text));
    a.title = title;
    if (a.classList.contains('on')) a.setAttribute('aria-current', 'page');
    return a;
  };
  hlist.append(
    platformRow('⌂', 'home', 'home/', /\/epinoia\/home\/$/,
                'HOME — every league, today’s fixtures, the best players'),
    platformRow('▥', 'fixtures', 'games/', /\/epinoia\/games\//,
                'global fixtures: every league’s games on one page'),
    platformRow('⌕', 'scouting', 'scouting/', /\/epinoia\/scouting\//,
                'global scouting: every league in one table'),
    platformRow('✚', 'injury report', 'injuries/', /\/epinoia\/injuries\/$/,
                'the waiver wire: who is missing, in every league, by club'));

  /* and on, into the leagues. A row rather than a bare chevron, because this is
     the journey the rail exists for. */
  const leaguesRow = el('a', 'item');
  leaguesRow.href = root + 'home/#leagues';
  leaguesRow.append(el('span', 'ic', '◉'), el('span', 'tx', 'leagues'),
                    el('span', 'lgo', '›'));
  leaguesRow.title = 'every league, by country';
  leaguesRow.dataset.leaguesRow = '1';
  /* IT MOVES THE RAIL; IT DOES NOT GO ANYWHERE. The sheet closes on any link tapped inside it,
     which took a phone reader out of the menu the moment they pressed "leagues ›" — the rail
     slid to the countries behind a sheet that was no longer there. Rows like this one say so,
     and the closer leaves them alone (reported 2026-09-18). */
  leaguesRow.dataset.railMove = '1';
  leaguesRow.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setView(country === null ? 'country' : 'root', true);
  });
  hlist.appendChild(leaguesRow);
  homePanel.append(htitle, hlist);

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
  cname.href = root + 'home/#leagues';
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

  /* ------------------------------------------------------- your own panel ---
     "Your profile" in the footer was a link straight to /me/. It is now a way
     in to the two things that are yours: the profile itself, and everything you
     follow — clubs and leagues together, in one list, because a follow is a
     follow and a reader looking for "that league I joined" does not first
     decide which kind of thing it was.

     IT IS THE ONLY ROUTE BACK TO A PRIVATE LEAGUE. A private league is not
     listed, not searchable and not on the front page, so without this the way
     back is the original invitation message. Redeeming a link follows the
     league (0142), which puts it here. */
  const fhead = el('div', 'phead');
  const fback = el('button', 'back', '‹');
  fback.type = 'button';
  fback.title = 'Back';
  fback.setAttribute('aria-label', 'Back');
  const fname = el('a', 'lname');
  fname.href = root + 'me/';
  fname.append(marquee('Your profile'));
  fhead.append(fback, fname);
  const flist = el('div', 'pages');
  followsPanel.append(fhead, flist);

  fback.addEventListener('click', () => {
    setView('country', true);
    if (meLink) meLink.focus({ preventScroll: true });
  });

  let followsDrawn = false;
  function openFollows() {
    setView('follows', true);
    /* AND AGAIN WHEN THE ROWS LAND. setView sizes the deck immediately, which
       for this panel is before the follows have been fetched — so the height is
       measured against a panel holding a heading and the word "loading", and
       everything that arrives after it is clipped. The clubs panel re-sizes the
       same way for the same reason.

       Only if this is still the open view: somebody who slides back out while
       the request is in flight must not have the deck resized to a panel they
       have left. */
    drawFollows()
      .then(() => afterPaint(() => {
        if (nav.dataset.view === 'follows') sizeDeck(false);
      }))
      .catch(() => { /* the panel says what went wrong; the deck keeps its height */ });
    const first = flist.querySelector('a');
    if (first) first.focus({ preventScroll: true });
  }
  window.epinoiaOpenFollows = () => openFollows();

  /* Drawn the first time it is opened, then kept: this is a rail on every page
     and most visits never touch it.

     KEPT ONLY WHEN IT WORKED, though. Opened once while signed out, the panel
     said "sign in to follow clubs and leagues" — and caching that would have
     left it saying so for the rest of the session, including after signing in
     on the very page it is drawn on. A draw that could not reach the answer
     leaves the flag off and is tried again next time it is opened. */
  async function drawFollows() {
    if (followsDrawn) return;
    flist.textContent = '';

    const mk = (cls, ic, tx, href) => {
      const a = el('a', 'item ' + cls);
      a.href = href;
      a.append(el('span', 'ic', ic), marquee(tx));
      a.title = tx;
      return a;
    };
    flist.appendChild(mk('', '☆', 'profile', root + 'me/'));

    const hd = el('div', 'gtitle', 'your follows');
    flist.appendChild(hd);
    const holding2 = el('div', 'gempty', 'loading…');
    flist.appendChild(holding2);

    const cfg = window.EPINOIA_CONFIG;
    const sess = storedSession();
    if (!cfg || !cfg.supabaseUrl || !sess || !sess.token) {
      holding2.textContent = 'sign in to follow clubs and leagues';
      return;                                     // not drawn: ask again next time
    }
    const headers = { apikey: cfg.supabaseAnonKey, Accept: 'application/json',
                      Authorization: 'Bearer ' + sess.token };
    const get = async (p) => {
      const r = await fetch(cfg.supabaseUrl + '/rest/v1/' + p, { cache: 'no-store', headers });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };

    let prefs = null;
    try { prefs = (await get('fan_prefs?select=fav_league_ids,fav_team_ids&limit=1'))[0] || null; }
    catch (_) { holding2.textContent = 'unavailable'; return; }
    followsDrawn = true;                          // the answer arrived; keep it

    const lids = (prefs && prefs.fav_league_ids) || [];
    const tids = (prefs && prefs.fav_team_ids) || [];
    let ls = [], ts = [];
    try {
      /* Both as the account: a followed league can be a PRIVATE one, whose row
         an anonymous request does not return at all. */
      if (lids.length) ls = await get('leagues?id=in.(' + lids.join(',') +
        ')&select=id,slug,name,colour_a,logo_path,visibility&order=name');
      if (tids.length) ts = await get('teams?id=in.(' + tids.join(',') +
        ')&select=id,slug,name,short_name,colour,logo_path&order=name');
    } catch (_) { /* draw whichever arrived */ }

    holding2.remove();
    if (!ls.length && !ts.length) {
      flist.appendChild(el('div', 'gempty',
        'nothing yet — press the bell on a club or a league'));
      return;
    }
    ls.forEach(l => {
      const a = el('a', 'item lrow');
      a.href = root + '?l=' + encodeURIComponent(l.slug);
      a.title = l.name + (l.visibility === 'private' ? ' · private' : '');
      a.append(crest(l), marquee(l.name));
      if (l.visibility === 'private') a.append(el('span', 'lgo', '\u{1F511}'));
      flist.appendChild(a);
    });
    ts.forEach(t => {
      /* EXACTLY WHAT THE CLUBS PANEL DOES, because a club's crest is not a
         league's. crest() above is the league plate — colour_a/colour_b and a
         monogram — so a club drawn with it lost the crest it already has
         everywhere else on the rail. epinoiaCrest is the shared club badge.
         And the link is ?t= alone, the clubs panel's own shape: adding an ?l=
         built from a league list this club's league may not be in produced
         /t/?l=&t=slug, which is broken rather than merely plain. */
      const a = el('a', 'item trow');
      a.href = root + 't/?t=' + encodeURIComponent(t.slug);
      a.title = t.name;
      const badge = window.epinoiaCrest
        ? window.epinoiaCrest(t, { cls: 'ep-crest ic' })
        : el('span', 'ic', '●');
      a.append(badge, marquee(t.name));
      flist.appendChild(a);
    });
  }
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
  const probed = [];           // [node, kind] — rows shown once a probe finds the content
  /* kind|slug -> true/false for this page's lifetime, and which questions are
     already in flight, so browsing back and forth in the rail asks once */
  const probeSaid = {};
  const probeAsked = {};

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
    if (it.two) a.classList.add('two-line');
    if (it.auth) { a.hidden = true; gated.push([a, it.role || (() => true)]); }
    if (it.probe) { a.hidden = true; probed.push([a, it.probe]); }
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

  /* THE WAY OUT IS HOME, and it is the FIRST row of the foot. It went back to
     the splash, the water page, which has no rail, no fixtures and no way on
     except through itself; HOME is the platform's front page on the web and in
     the app alike, so the logotype means one place wherever it appears.

     At the top of the foot rather than the bottom because of the phone sheet: a
     drawer opened on a league page starts on that league's panel, and the only
     other route to HOME, the panel heading, sits two panels back. The first row
     of the foot is on screen the moment the sheet opens.

     In the logotype, so the brand is never set in the rail's own face. */
  const home = el('a', 'item home-row');
  home.href = root + 'home/';
  const homeTx = el('span', 'tx epinoia-mark', 'EPINOIΛ');
  home.append(el('span', 'ic', '⌂'), homeTx);
  home.title = 'HOME';
  home.setAttribute('aria-label', 'HOME');
  if (atHome) { home.classList.add('on'); home.setAttribute('aria-current', 'page'); }
  navFoot.append(home, adminRow, platRow);

  const acct = el('div', 'acct');
  const acctLink = el('a', 'item');
  const acctIc = el('span', 'ic', '◐');
  const acctTx = el('span', 'tx', 'sign in');
  acctLink.append(acctIc, acctTx);
  acctLink.href = root + 'signin/?next=' +
    encodeURIComponent(location.pathname + location.search);
  acctLink.title = 'sign in';
  acct.appendChild(acctLink);
  /* A fan's own page, and everything they follow. Still a real link to /me/ —
     a middle click, a modified click and the phone drawer must all behave like
     the link this has always been — but an ordinary click slides the rail into
     the panel instead, where the profile and the follows both are. The chevron
     says so; a row that opens a rail with nothing announcing it is a row people
     click once, get taken somewhere unexpected, and stop trusting. */
  const meLink = el('a', 'item');
  meLink.append(el('span', 'ic', '☆'), el('span', 'tx', 'your profile'),
                el('span', 'lgo', '›'));
  meLink.href = root + 'me/';
  meLink.title = 'your profile, and the clubs and leagues you follow';
  meLink.hidden = true;
  meLink.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
        e.shiftKey || e.altKey) return;
    /* in the phone sheet the row is the link it is: the sheet closes on any tap
       inside it, so sliding the rail here would shut it with nothing opened */
    if (nav.classList.contains('drawer-open')) return;
    e.preventDefault();
    openFollows();
  });
  acct.appendChild(meLink);
  navFoot.appendChild(acct);

  /* ------------------------------------------------------- add to home screen ---
     The app is installable (manifest.webmanifest + sw.js). On Android the browser fires
     beforeinstallprompt and the banner's button hands that prompt to the person; on iPhone
     there is no such event and the banner explains the share sheet instead. Shown once a
     visit on a phone-sized screen that is not already the installed app; a dismissal is
     remembered for a fortnight. window.epinoiaInstall() offers the same from a page.

     THE ANDROID APP CHANGES TWO THINGS (roadmap Phase 6). Inside any app (appmode.js's
     html.m-app and window.epinoiaApp) there is no banner at all: you are already in it. And an
     Android browser is offered the real app, a link to /epinoia/android/, instead of the web
     app: on a Samsung the web app's alerts are posted by Samsung Internet and do not pop up,
     which is the problem the Android app exists to solve. It is offered after the same 2.5 s
     as the iPhone's, whether or not the browser fired beforeinstallprompt, and never on the
     download page itself. ONLY ONCE IT IS OUT: until version.json says released: true, an
     Android browser keeps the web-app offer. An iPhone gets the same treatment from the iPhone
     app once epinoia/ios/version.json says it is out (showIosApp), and the Home Screen steps
     until then; desktop is exactly as it was. */
  let installEvt = null, installBanner = null;
  /* set once version.json says the Android app is out (released: true); until then an
     Android browser is offered the web app, exactly as before the app existed */
  let appReleased = false;
  /* the same for the iPhone app: set once epinoia/ios/version.json says released: true */
  let iosReleased = false;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismissed = () => { try { return (+localStorage.getItem('epinoia_install_dismissed') || 0) > Date.now() - 14 * 86400000; } catch (_) { return false; } };
  const shellEnv = () => ({
    app: window.epinoiaApp === true,
    mApp: document.documentElement.classList.contains('m-app'),
    ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    path: location.pathname, released: appReleased, iosReleased
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(root + 'sw.js', { scope: root }).catch(() => {});
  }
  function showInstall(force) {
    if (installBanner || standalone()) return;
    const offer = AppShell.installOffer(shellEnv());
    if (offer === 'none') return;
    if (!force && (dismissed() || window.innerWidth > 900)) return;
    if (offer === 'android-app') { showAndroidApp(); return; }
    if (offer === 'ios-app') { showIosApp(); return; }
    if (!installEvt && !isIOS() && !force) return;
    installBanner = el('div', 'ep-install');
    const ic = el('img'); ic.src = root + 'brand/epinoia-mark-192.png'; ic.alt = '';
    const tx = el('div', 'tx');
    tx.appendChild(el('b', null, 'Add EPINOIΛ to your home screen'));
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
  /* THE ANDROID APP, OFFERED. The same card and the same fortnight's dismissal as the web-app
     banner, but the button is a link: the download page explains the steps (unknown apps, Play
     Protect, Chrome) better than a banner can. */
  function showAndroidApp() {
    installBanner = el('div', 'ep-install ep-app-offer');
    /* the app's own icon, not the site mark: it is what the phone will show once installed */
    const ic = el('img'); ic.src = root + 'android/icon-192.png'; ic.alt = '';
    const tx = el('div', 'tx');
    tx.appendChild(el('b', null, 'Get the EPINOIΛ app for Android'));
    tx.appendChild(el('span', null, 'Scores, fixtures and your clubs one tap away, with game alerts that pop up.'));
    const go = el('a', 'go', 'get it'); go.href = root + 'android/';
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'not now';
    const close = () => { try { localStorage.setItem('epinoia_install_dismissed', String(Date.now())); } catch (_) {} if (installBanner) installBanner.remove(); installBanner = null; };
    go.addEventListener('click', close);
    x.onclick = close;
    installBanner.append(ic, tx, go, x);
    document.body.appendChild(installBanner);
  }
  /* THE IPHONE APP, OFFERED to an iPhone once it is out: the same card and dismissal, pointing
     at the iPhone page (its App Store button), never at the Android one */
  function showIosApp() {
    installBanner = el('div', 'ep-install ep-app-offer');
    const ic = el('img'); ic.src = root + 'ios/icon-192.png'; ic.alt = '';
    const tx = el('div', 'tx');
    tx.appendChild(el('b', null, 'Get the EPINOIΛ app for iPhone'));
    tx.appendChild(el('span', null, 'Scores, fixtures and your clubs one tap away, with game alerts. Free on the App Store.'));
    const go = el('a', 'go', 'get it'); go.href = root + 'ios/';
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'not now';
    const close = () => { try { localStorage.setItem('epinoia_install_dismissed', String(Date.now())); } catch (_) {} if (installBanner) installBanner.remove(); installBanner = null; };
    go.addEventListener('click', close);
    x.onclick = close;
    installBanner.append(ic, tx, go, x);
    document.body.appendChild(installBanner);
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(false); });
  window.addEventListener('appinstalled', () => { if (installBanner) { installBanner.remove(); installBanner = null; } });
  window.epinoiaInstall = () => showInstall(true);
  window.epinoiaCanInstall = () => !!installEvt;
  {
    const env = shellEnv();
    const offer = AppShell.installOffer(env);
    if (offer === 'ios') {
      /* AN IPHONE ASKS ios/version.json first (once a session, shared with HOME's card): the
         iPhone app when it is out, the Home Screen steps when it is not or there is no answer */
      let store = null;
      try { store = window.sessionStorage; } catch (_) { store = null; }
      AppShell.iosVersion(root + 'ios/version.json', { store }).then(ver => {
        if (ver && ver.released === true) iosReleased = true;
        setTimeout(() => showInstall(false), 2500);
      });
    }
    else if (offer === 'web' && AppShell.where(env) === 'android') {
      /* AN ANDROID BROWSER ASKS version.json (once a session, shared with HOME's card) whether
         the app is out. Not yet, or no answer: nothing on a timer, and beforeinstallprompt
         still offers the web app. Out: the Android app, after the same 2.5 s. */
      let store = null;
      try { store = window.sessionStorage; } catch (_) { store = null; }
      AppShell.version(root + 'android/version.json', { store }).then(ver => {
        if (!ver || ver.released !== true) return;
        appReleased = true;
        setTimeout(() => showInstall(false), 2500);
      });
    }
  }

  /* ------------------------------------------------- the app, signposted ---
     THE BANNER IS ONCE A FORTNIGHT; THESE STAY. On a phone, every page with the rail links the
     download page twice more: a row under HOME in the menu sheet, and a strip at the end of the
     page, before its footer (not on HOME for Android, whose own card sits under the wordmark).
     What each says is AppShell.promo's answer, so none of them appears on a desktop, in the
     app, before the app is out, or on the download page. window.EpinoiaAppPromo hands the same
     answer to push.js, whose notification sheet points an Android browser at the app. */
  const promoReady = (() => {
    const env = shellEnv();
    const w = AppShell.where(env);
    if (w !== 'android' && w !== 'ios') return Promise.resolve(null);
    let store = null;
    try { store = window.sessionStorage; } catch (_) { store = null; }
    if (w === 'ios') {
      return AppShell.iosVersion(root + 'ios/version.json', { store })
        .then(ver => AppShell.promo(Object.assign(env, { standalone: standalone(), iosReleased: !!ver && ver.released === true })),
              () => AppShell.promo(Object.assign(env, { standalone: standalone() })));
    }
    return AppShell.version(root + 'android/version.json', { store })
      .then(ver => AppShell.promo(Object.assign(env, { released: !!ver && ver.released === true })), () => null);
  })();
  let promoNow = null;
  window.EpinoiaAppPromo = { ready: promoReady, current: () => promoNow, href: p => root + p.href };
  function promoRow(p) {
    const a = el('a', 'item app-row');
    a.href = root + p.href;
    const ic = el('span', 'ic');
    const img = el('img'); img.src = root + p.icon; img.alt = '';
    ic.appendChild(img);
    a.append(ic, el('span', 'tx', p.row));
    a.title = p.title;
    return a;
  }
  function promoStrip(p) {
    const a = el('a', 'ep-appstrip');
    a.href = root + p.href;
    a.dataset.kind = p.kind;
    const img = el('img'); img.src = root + p.icon; img.alt = '';
    const tx = el('span', 'tx');
    tx.append(el('b', null, p.title), el('span', null, p.sub));
    const go = el('span', 'go', '→');
    go.setAttribute('aria-hidden', 'true');
    a.append(img, tx, go);
    return a;
  }
  promoReady.then(p => {
    promoNow = p;
    if (!p) return;
    navFoot.insertBefore(promoRow(p), adminRow);
    if ((p.kind === 'android' || p.kind === 'ios-app') && document.getElementById('homeApp')) return;
    const frame = document.querySelector('.ep-frame') || document.querySelector('body > .wrap');
    if (!frame) return;
    const foot = Array.prototype.find.call(frame.children, c => c.tagName === 'FOOTER' || c.classList.contains('foot'));
    frame.insertBefore(promoStrip(p), foot || null);
  }, () => {});

  /* ------------------------------------------------------- update the app ---
     THE ANDROID APP SAYS WHICH BUILD IT IS on every launch (shell=, kept by appmode.js in
     sessionStorage epinoia_shell). Website changes never need a new app, so this appears only
     when epinoia/android/version.json's minShell has been raised above that build: the site
     has started to depend on something only a newer app does. version.json is fetched once a
     session. Dismissed, it stays away for the rest of this launch and comes back on the next,
     because an app that is too old stays too old until it is updated. Not on the download
     page, which says the same thing in its own words. */
  const UPDATE_DISMISSED = 'epinoia_update_dismissed';
  function showUpdate(ver, ios) {
    const bar = el('div', 'ep-install ep-update');
    bar.setAttribute('role', 'status');
    const ic = el('img'); ic.src = root + (ios ? 'ios/' : 'android/') + 'icon-192.png'; ic.alt = '';
    const tx = el('div', 'tx');
    tx.appendChild(el('b', null, 'Update the EPINOIΛ app'));
    const name = ios ? ver.version : ver.versionName;
    tx.appendChild(el('span', null, name
      ? 'Version ' + name + ' is ready. Some things on the site need it.'
      : 'A new version is ready. Some things on the site need it.'));
    /* the iPhone app updates from the App Store listing; its page links it */
    const go = el('a', 'go', 'update'); go.href = ios && ver.appStore ? ver.appStore : root + (ios ? 'ios/' : 'android/');
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'later';
    const close = () => { try { sessionStorage.setItem(UPDATE_DISMISSED, String(ver.minShell)); } catch (_) {} bar.remove(); };
    x.onclick = close;
    bar.append(ic, tx, go, x);
    document.body.appendChild(bar);
  }
  (() => {
    let store = null;
    try { store = window.sessionStorage; } catch (_) { store = null; }
    if (!store || AppShell.where(shellEnv()) !== 'app') return;
    if (/^\/epinoia\/(android|ios)(\/|$)/.test(location.pathname)) return;
    /* the iPhone app's build comes from the app itself, and its minShell from ios/version.json */
    const nat = AppShell.nativeShell(window.EpinoiaNative);
    if (nat) {
      AppShell.iosVersion(root + 'ios/version.json', { store }).then(ver => {
        if (!AppShell.needsUpdate(nat, ver)) return;
        let gone = null;
        try { gone = store.getItem(UPDATE_DISMISSED); } catch (_) { gone = null; }
        if (gone === String(ver.minShell)) return;
        showUpdate(ver, true);
      });
      return;
    }
    const sh = AppShell.readShell(store);
    if (!sh || !(Number(sh.shell) > 0)) return;          // not the Android app: nothing to update
    AppShell.version(root + 'android/version.json', { store }).then(ver => {
      if (!AppShell.needsUpdate(sh, ver)) return;
      let gone = null;
      try { gone = store.getItem(UPDATE_DISMISSED); } catch (_) { gone = null; }
      if (gone === String(ver.minShell)) return;
      showUpdate(ver);
    });
  })();

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

  /* GLOBAL SCOUTING IS NOT DOWN HERE ANY MORE. It belongs to no league, which
     is why it used to sit in the foot — but the foot is the half of the rail
     about YOU, and "every league in one table" is not about you. It is now the
     third row of the home panel, beside global fixtures, which is the layer
     that holds everything belonging to no league. */

  const contact = el('a', 'item' + (/\/epinoia\/contact\//.test(here) ? ' on' : ''));
  contact.href = root + 'contact/';
  contact.append(el('span', 'ic', '✉'), el('span', 'tx', 'contact'));
  contact.title = 'contact';
  navFoot.appendChild(contact);

  /* LANGUAGE, the last row of the foot: bottom-left on a desktop, the bottom of the phone's menu
     sheet. One press per language, each written in itself; i18n.js keeps the choice. */
  const I18N = window.EpinoiaI18n;
  if (I18N && I18N.LANGS) {
    const langRow = el('div', 'lang-row');
    langRow.setAttribute('role', 'group');
    langRow.setAttribute('aria-label', 'Language · 言語 · Idioma');
    langRow.setAttribute('translate', 'no');
    langRow.title = 'Language · 言語 · Idioma';
    const langs = el('span', 'langs');
    /* a language still being built is hidden (tools/i18n.mjs new-language); ?lang= reaches it */
    I18N.LANGS.filter(l => !l.hidden || l.code === I18N.lang).forEach(l => {
      const on = l.code === I18N.lang;
      const b = el('button', 'lang' + (on ? ' on' : ''), l.short);
      b.type = 'button';
      b.lang = l.code;
      b.title = l.native;
      b.setAttribute('aria-label', l.native);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => { if (!on) I18N.set(l.code); });
      langs.appendChild(b);
    });
    langRow.append(el('span', 'ic', '文'), langs);
    navFoot.appendChild(langRow);
  }

  /* ------------------------------------------------------------ the tab bar ---
     ON A PHONE THE BAR IS THE LEAGUE'S FIVE PLACES, NOT THE WHOLE RAIL. The rail's row-flow
     put the countries/leagues deck, the account, contact and the admin rows into one sideways
     scroller, so what showed at the bottom of the screen was whatever happened to be scrolled
     into view -- "admin controls · platform · your@email" -- and the pages a fan actually wants
     were off to the left. This bar is fixed: league, fixtures, table, statistics, news, then
     the menu, which opens the full rail as the sheet. Hidden above 820px.

     THE LEAGUE'S FRONT PAGE IS "league", NOT "home". HOME is the platform's front page now,
     and two tabs called home that open different pages is one too many. */
  const tabbar = el('div', 'ep-tabbar');
  let pageWomen = false;              // the page's own league is a women's league (settled when the list arrives)
  const TABS = [
    { key: 'home', ic: '◈', tx: 'league', href: '', on: () => /\/epinoia\/$/.test(here) && !!qp.get('l') },
    { key: 'fixtures' }, { key: 'table' }, { key: 'teams' }, { key: 'statistics' }, { key: 'news' }
  ];
  /* A PAGE WITH NO LEAGUE GETS THE PLATFORM'S FIVE PLACES. The bar used to be removed there,
     which left the sideways strip of country flags: the right thing for nobody, and on HOME,
     the page the app opens on, the first thing a phone showed. These are the places that are
     about every league at once, plus your own page. "leagues" is HOME's own section, so on
     HOME it is a jump down the page rather than a reload. */
  const PLATFORM_TABS = [
    { key: 'home',     ic: '⌂', tx: 'home',     href: 'home/',         on: () => atHome },
    { key: 'games',    ic: '▥', tx: 'games',    href: 'games/',        on: () => /\/epinoia\/games\//.test(here) },
    { key: 'scouting', ic: '▦', tx: 'scouting', href: 'scouting/',     on: () => /\/epinoia\/scouting\//.test(here) },
    { key: 'leagues',  ic: '◉', tx: 'leagues',  href: 'home/#leagues', on: () => false },
    { key: 'profile',  ic: '☆', tx: 'profile',  href: 'me/',           on: () => /\/epinoia\/me\//.test(here) }
  ];
  function paintPlatformTabs() {
    PLATFORM_TABS.forEach(t => {
      const a = el('a', 'tab');
      a.href = root + t.href;
      a.dataset.tab = t.key;
      a.append(el('span', 'ic', t.ic), el('span', 'tx', t.tx));
      if (t.on()) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); }
      tabbar.appendChild(a);
    });
    nav.classList.add('has-tabbar');
  }
  function paintTabbar() {
    tabbar.textContent = '';
    tabbar.classList.remove('fit');
    if (!lg) { paintPlatformTabs(); return; }
    TABS.forEach(t => {
      const spec = t.href !== undefined ? t : PAGES.find(p => p.key === t.key);
      if (!spec) return;
      const a = el('a', 'tab');
      a.href = withLeague(root + (spec.href || ''));
      if (spec.two) { a.classList.add('two-line'); tabbar.classList.add('fit'); }
      a.append(el('span', 'ic', spec.ic), el('span', 'tx', spec.tx));
      if (t.key === 'home' && pageWomen) { a.classList.add('is-women'); a.title = 'Women\u2019s league'; }
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
    /* …except the rows that only move the rail (the clubs layer, "leagues ›"): those are a step
       through the menu, not a way out of it */
    if (a && nav.contains(a) && !a.dataset.teamsRow && !a.dataset.teamsTab && !a.dataset.railMove) {
      setTimeout(() => { if (nav.classList.contains('drawer-open')) navToggle.click(); }, 50);
    }
  });
  nav.appendChild(navToggle);

  /* ============================================================== views === */
  let leagues = [];
  const bySlug = () => leagues.find(l => l.slug === lg) || null;

  /* The deck's height is measured rather than assumed. Both panels are in the
     document at once so the transform can slide between them, which means the
     taller one would otherwise set the height and leave a hole beneath the
     shorter one. */
  /* EVERY VIEW, OR THE DECK IS MEASURED AGAINST THE WRONG PANEL. The deck is
     `overflow:hidden` with an explicit height, and sizeDeck sets that height
     from whichever panel this returns — so a view missing from this chain falls
     through to homePanel, the deck is sized to the home list, and the panel that
     is actually open is CLIPPED at that height with no way to scroll to the
     rest. That is what 'follows' did: the last club in the list was cut in half
     and nothing below it could be reached. */
  function panelFor(view) {
    return view === 'teams'   ? teamsPanel
         : view === 'league'  ? leaguePanel
         : view === 'root'    ? rootPanel
         : view === 'country' ? countryPanel
         : view === 'follows' ? followsPanel
         : homePanel;
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
      homePanel.setAttribute('aria-hidden', 'false');
      countryPanel.setAttribute('aria-hidden', 'false');
      rootPanel.setAttribute('aria-hidden', 'false');
      leaguePanel.setAttribute('aria-hidden', 'false');
      teamsPanel.setAttribute('aria-hidden', 'false');
      followsPanel.setAttribute('aria-hidden', 'false');
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
    homePanel.setAttribute('aria-hidden', String(v !== 'home'));
    countryPanel.setAttribute('aria-hidden', String(v !== 'country'));
    rootPanel.setAttribute('aria-hidden', String(v !== 'root'));
    leaguePanel.setAttribute('aria-hidden', String(v !== 'league'));
    teamsPanel.setAttribute('aria-hidden', String(v !== 'teams'));
    followsPanel.setAttribute('aria-hidden', String(v !== 'follows'));
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
  /* A PRIVATE LEAGUE IS NOT A COUNTRY'S LEAGUE, IT IS YOURS. It has no place in
     the geography — it is not listed, not searchable, and the only people who
     can see it at all are the ones who were let in — so it gets a group of its
     own at the top rather than falling into "Not yet filed" beside whichever
     public leagues nobody has got round to filing. That bucket is where one
     landed, under a heading that reads like a mistake. */
  const PRIVATE_KEY = '~private';
  function groupKey(l) {
    return l && l.visibility === 'private' ? PRIVATE_KEY : ((l && l.country) || '');
  }

  /* THE FLAG AS A PICTURE WHERE WE HAVE ONE.

     Segoe UI Emoji has never carried the regional-indicator PAIRS, so Chrome
     and Edge on Windows draw "CZ", "DE", "GB" — the two letters a flag emoji is
     built from — straight down the rail, which reads as something broken rather
     than as a decision. No CSS or markup changes that; the only cure is to stop
     asking the font and ship the picture. The drawn flags are our own SVGs in
     brand/flags, and everything we have not drawn keeps the emoji, which is a
     real flag on a Mac, a phone and Firefox.

     THE LIST IS HERE AND ALSO IN country.js, which is the rule's home. This
     file already carries its own flagOf and countryName for the same reason:
     the rail is on every page and country.js is on two, so depending on it here
     would mean either loading it twenty more times or a rail with no flags on
     most of the site. Add a flag in both places — or move the rail onto
     country.js and delete all three copies, which is the better fix and a
     bigger one than this.

     Returns a NODE, because one of the two answers is an <img>. */
  const HAVE_FLAG = ['AU', 'BE', 'CA', 'CZ', 'DE', 'ES', 'EU', 'FI', 'FR', 'GB', 'IT', 'JP', 'LT', 'MX', 'NL', 'PL', 'SK', 'XB', 'XK'];
  /* A region filed under a user-assigned code (country.js says why); its
     "flag" is an outline of the area, and its name is ours, not Intl's. */
  const REGIONS = { XB: { name: 'Balkans', glyph: '\u{1F5FA}\uFE0F' } };

  /* A LEAGUE IN SEVERAL COUNTRIES names them joined by '+' (0160: the BNXT League is 'BE+NL'), and
     the rail shows each flag beside its own name: the first in the row's flag slot, the others
     inline before theirs - "[BE] Belgium + [NL] Netherlands". */
  function countryCodes(code) {
    const p = String(code || '').split('+').map(s => s.trim());
    return p.length <= 4 && p.every(s => /^[A-Za-z]{2}$/.test(s)) ? p.map(s => s.toUpperCase()) : [];
  }
  function inlineFlag(code) {
    const node = flagNode(code);
    node.className = 'flagin' + (node.classList.contains('flagimg') ? ' flagimg' : '');
    return node;
  }
  /* [flag slot, the name] for a country row or the leagues panel's head */
  function countryLabel(code) {
    const cs = countryCodes(code);
    if (cs.length < 2) return [flagNode(code), marquee(countryName(code))];
    const box = marquee('');
    const inner = box.firstChild;
    cs.forEach((c, i) => {
      if (!i) { inner.append(countryName(c)); return; }
      /* a flag never parts from its name: a desktop rail wraps a long name, and the break
         belongs after the "+", not between the Dutch flag and "Netherlands" */
      const part = el('span', 'cpart');
      part.append(inlineFlag(c), countryName(c));
      inner.append(' + ', part);
    });
    return [flagNode(cs[0]), box];
  }

  function flagNode(code) {
    const c = /^[A-Za-z]{2}$/.test(code || '') ? code.toUpperCase() : '';
    if (c && HAVE_FLAG.indexOf(c) >= 0) {
      const wrap = el('span', 'ic flagimg');
      const i = document.createElement('img');
      i.src = root + 'brand/flags/' + c.toLowerCase() + '.svg';
      i.alt = '';
      /* a file that fails to load leaves the emoji behind, not a gap */
      i.addEventListener('error', () => {
        wrap.textContent = flagOf(code);
        wrap.classList.remove('flagimg');
      });
      wrap.appendChild(i);
      return wrap;
    }
    return el('span', 'ic', flagOf(code));
  }

  function flagOf(code) {
    if (code === PRIVATE_KEY) return '\u{1F511}';
    /* A GLOBE for a league nobody has filed yet, and the same globe the
       countries page uses. The rail said "Elsewhere" behind a white flag and
       the page said "Not yet filed" behind a globe — two names and two glyphs
       for one state, which is the kind of thing a reader notices and cannot
       account for. */
    if (!/^[A-Za-z]{2}$/.test(code || '')) return '\u{1F30D}';
    if (REGIONS[code.toUpperCase()]) return REGIONS[code.toUpperCase()].glyph;
    return String.fromCodePoint(...[...code.toUpperCase()]
      .map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  let regionNames = null;
  function countryName(code) {
    if (code === PRIVATE_KEY) return 'Private';
    if (!code) return 'Not yet filed';
    const cs = countryCodes(code);
    if (cs.length > 1) return cs.map(countryName).join(' + ');
    if (REGIONS[String(code).toUpperCase()]) return REGIONS[String(code).toUpperCase()].name;
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
      const k = groupKey(l);
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
      .sort((a, b) => (b === PRIVATE_KEY) - (a === PRIVATE_KEY) ||
                      (a === '') - (b === '') ||
                      countryName(a).localeCompare(countryName(b)))
      .forEach(code => {
        const row = el('button', 'item crow' + (country === code ? ' on' : ''));
        row.type = 'button';
        const name = countryName(code);
        row.title = name + ' \u00b7 ' + groups.get(code) +
                    (groups.get(code) === 1 ? ' league' : ' leagues');
        row.append(...countryLabel(code));
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
    cname.append(...countryLabel(code));
    cname.title = name + ' — every league, by country, on HOME';
    cname.href = root + 'home/#leagues';
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
    /* AS THE ACCOUNT, WHEN THERE IS ONE. This read was anonymous, which was
       invisible while every league was public and wrong the moment one was not:
       a private league (0139) is hidden from an anonymous request, so it was
       missing from the rail entirely — and because the rail works out which
       country to open from the page's own league, a page showing a private
       league found nothing, fell back to the "every country" sentinel, and put
       "Not yet filed" above a list of every league on the platform.

       A signed-out visitor still sends the anonymous, cacheable request they
       always did. For a signed-in one the answer genuinely differs per person —
       which private leagues they are in — so there was never a shared cache of
       it to lose. */
    const sess = storedSession();
    const url = cfg.supabaseUrl +
      '/rest/v1/leagues?select=id,slug,name,colour_a,colour_b,colour_source,theme,logo_path,country,nav,visibility,gender&order=name';
    /* `gender` (0131) marks a women's league in the rail; a database without it answers 400 and the
       list is asked for again without it, so the rail never depends on it */
    const urlNoGender = url.replace(',gender&', '&');
    /* A TOKEN MUST NEVER COST SOMEBODY THE WHOLE RAIL. storedSession only
       refuses an EXPIRED token; one that is malformed, revoked, or left over
       from a rotated project passes that check and comes back 401 — and this
       list is the navigation on every page, so failing it would replace the
       rail with "unavailable" for somebody who was browsing perfectly well a
       moment ago. Signed-in reads are attempted, then fall back to exactly the
       anonymous request this has always made. */
    const pull = async (anon) => {
      const headers = { apikey: cfg.supabaseAnonKey, Accept: 'application/json' };
      if (!anon && sess && sess.token) headers.Authorization = 'Bearer ' + sess.token;
      let r = await fetch(url, { cache: 'no-store', headers });
      if (r.status === 400) r = await fetch(urlNoGender, { cache: 'no-store', headers });
      if (r.status === 401 && headers.Authorization) return pull(true);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    /* KEPT FOR FIVE MINUTES IN THIS TAB, AND CHECKED AGAIN AFTER HALF A MINUTE. The rail is on
       every page, so a visit of ten pages read the whole league list, theme and nav blocks
       included, ten times. The copy is keyed by who asked (the token's tail, as data.js keys its
       shared reads), so a sign-in, a sign-out or a refreshed token starts clean, and a signed-in
       list is never shown to anybody else. sessionStorage, so it ends with the tab; any failure
       just reads again.
       A COPY IS SHOWN AT ONCE BUT NEVER LEFT TO GO STALE. A league's logo, colours or name changed
       in the console, or a league added, did not reach a tab that already held the list until the
       five minutes were up (reported 2026-09-24: the Finnish leagues sat as lettered tiles in a
       tab opened before their logos went up). So a copy older than 30 seconds is drawn first and
       then re-read in the background, and the rail is redrawn only if the answer differs. */
    const heldKey = 'ep-nav-leagues:' + (sess && sess.token ? String(sess.token).slice(-16) : 'anon');
    let held = null, heldAt = 0;
    try {
      const j = JSON.parse(sessionStorage.getItem(heldKey) || 'null');
      if (j && Array.isArray(j.rows) && Date.now() >= j.at && Date.now() - j.at < 5 * 60 * 1000) { held = j.rows; heldAt = j.at; }
    } catch (_) { held = null; }
    const keep = (rows) => { try { sessionStorage.setItem(heldKey, JSON.stringify({ at: Date.now(), rows })); } catch (_) { /* full */ } };
    try {
      leagues = held || await pull(false);
      if (!held) keep(leagues);
    } catch (_) {
      holding.textContent = 'unavailable';
      return;
    }
    /* The country the page's own league is in, so a page that knows its
       league opens with the right country already chosen rather than in the
       list of every country. */
    const mine = leagues.find(l => l.slug === (lg || pageLeague));
    if (mine) country = groupKey(mine);
    drawCountries();
    /* named before the leagues are drawn, so the header is never briefly blank */
    fillCountryHead(country === null ? '' : country);
    drawLeagues();
    themeLeague();
    syncWomen();
    if (held && Date.now() - heldAt > 30 * 1000) {
      pull(false).then(fresh => {
        if (!Array.isArray(fresh)) return;
        keep(fresh);
        if (JSON.stringify(fresh) === JSON.stringify(leagues)) return;       // nothing changed: nothing redrawn
        leagues = fresh;
        drawCountries();
        drawLeagues();
        themeLeague();
        syncWomen();
      }).catch(() => { /* the copy on screen stands */ });
    }
  }

  /* the league tab of the phone's bar wears the marker when the page's league is a women's league */
  function syncWomen() {
    const now = isWomen(bySlug());
    if (now === pageWomen) return;
    pageWomen = now;
    try { paintTabbar(); } catch (_) { /* before the bar exists */ }
  }

  /* SETTLED LATE, for a page that names its league only after this ran. `country` starts at
     `null` — the sentinel drawLeagues() reads as "every league of every country" and
     fillCountryHead() labels "Not yet filed" — and fillLeagues() above only resolves it away
     from null when (lg || pageLeague) already names a real league AT FETCH TIME. The game page
     (and any other that works its league out from the network rather than from ?l=) sets
     __CS_LEAGUE_SLUG once that resolves, which can land after this file's own leagues fetch has
     already finished and drawn the panel — so `country` was left at `null` for the rest of the
     page's life. Scrolling back out of the league rail then landed on "Not yet filed" showing
     every league on the platform, not the one the page is actually about (reported 2026-09-18).
     Redrawing here corrects the panel the same way fillLeagues() would have, had it known. */
  function settleCountry(l) {
    if (!l || !leagues.length) return;
    const want = groupKey(leagues.find(x => x.id === l.id) || l);
    if (country === want) return;
    country = want;
    drawCountries();
    fillCountryHead(country);
    drawLeagues();
  }

  /* ------------------------------------------------ the league's colours ---
     EVERY PAGE ABOUT A LEAGUE WEARS THE LEAGUE'S COLOURS (0122's theme: --league-a/-b,
     their inks, body.league-themed, and the kit's accent). The front page and the hub
     paint them themselves (home.js, l/league.js). Every other page that is about one
     league — its fixtures, statistics, WOWY, news, a game, joining it — is painted from
     here, the one script all of them load, as soon as both the page's league and the
     league's row are known: from ?l=, or from the __CS_LEAGUE_SLUG a page sets once it
     has worked its league out. A league that picked its own accent in Appearance keeps
     it, as on its hub.

     NOT a club's page or a player's: those wear the CLUB's colours (teamcolour.js
     apply). And not the platform's own tools (the console, the scorer, the broadcast
     room, a profile), which are nobody's league. teamcolour.js is loaded only when a
     page needs it and has not loaded it already, at this file's own stamp. */
  /* injuries is here for the LEAGUE's report (?l=…). The global wire is the same path with no
     league named, and themeLeague only paints when a page has named one, so it stays the
     platform's own colours without needing a rule of its own. */
  const LEAGUE_PAGE = /\/epinoia\/(fixtures|stats|news|game|video|join|injuries)\//;
  const CLUB_PAGE = /\/epinoia\/(t|p)\//;
  let themedFor = '';
  let teamColour = null;
  function loadTeamColour() {
    if (window.EpinoiaTeamColour) return Promise.resolve(window.EpinoiaTeamColour);
    if (!teamColour) {
      teamColour = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = root + 'teamcolour.js' + stamp;
        s.onload = () => resolve(window.EpinoiaTeamColour || null);
        s.onerror = () => resolve(null);
        (document.head || document.documentElement).appendChild(s);
      });
    }
    return teamColour;
  }
  function themeLeague() {
    if (!LEAGUE_PAGE.test(here) || CLUB_PAGE.test(here)) return;
    const l = pageLeague ? leagues.find(x => x.slug === pageLeague) : null;
    const want = l ? l.slug : '';
    if (want === themedFor) return;
    themedFor = want;
    loadTeamColour().then(TC => {
      if (!TC || themedFor !== want) return;            // the page moved on while this loaded
      if (typeof TC.clearLeague === 'function') TC.clearLeague();
      if (!l || typeof TC.league !== 'function') return;
      const ownAccent = l.theme && /^#[0-9a-f]{6}$/i.test(l.theme.accent || '') ? l.theme.accent : null;
      Promise.resolve(TC.league(l, { keepAccent: !!ownAccent })).then(() => {
        if (ownAccent && themedFor === want) document.documentElement.style.setProperty('--lume', ownAccent);
      });
    });
  }

  function drawLeagues() {
    list.textContent = '';
    const inCountry = country === null
      ? leagues
      : leagues.filter(l => groupKey(l) === country);
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
      if (isWomen(l)) { a.appendChild(wtag()); a.title = l.name + ' · women’s league'; }

      a.addEventListener('click', (e) => {
        /* Let a middle click, a modified click or a right click do what the
           browser would do — this is a real link to a real page and hijacking
           every activation of it would break opening a league in a new tab. */
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
            e.shiftKey || e.altKey) return;
        /* IN THE PHONE SHEET A LEAGUE IS A PLACE TO GO. The sheet closes on any link tapped
           inside it (the document listener below), so sliding the rail into the league here
           closed the sheet with nothing opened, and the reader had to open the menu again to
           get anywhere. On a phone the row is simply the link it is: the league's front page. */
        if (nav.classList.contains('drawer-open')) return;
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
    else { setView(country === null ? 'home' : 'root', false); }
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
      if (!isLatched(node)) node.hidden = off;
      else if (off) node.hidden = true;
    });
  }
  /* A ROW WHOSE VISIBILITY IS SOMEBODY ELSE'S DECISION: the role gate, which
     runs after this, or the content probe, which answers over the network.
     applyNav may HIDE one (the league switched the page off) but must never
     show one, or it would undo a gate that has not run yet. */
  const isLatched = node => gated.some(g => g[0] === node) || probed.some(p => p[0] === node);

  /* --------------------------------------------- what the league actually has ---
     THE VIDEO HUB EXISTS FOR A LEAGUE THAT HAS READ VIDEO, AND FOR NO OTHER.

     One question, asked of the league the rail is currently showing: is there a
     single game here whose primary recording carries a clock track and whose
     reading job finished? limit=1, no payload beyond the id, so the answer costs
     one small round trip and is then remembered for the session — the rail is on
     every page and a fan browsing five pages of a league must not ask five times.

     WHAT IT DELIBERATELY DOES NOT ASK is whether the reading is any GOOD. That
     needs every candidate's clock track, which is hundreds of kilobytes of
     readings, and the hub itself judges each game properly when it opens. So the
     rail's promise is "there is read video here", and the page is what says
     whether it can be used. A league whose only readings are junk gets a row and
     a page that tells the reader so, which is the honest pair.

     FAILS CLOSED, like the role gate: no answer, a network error or a page with
     no league at all leaves the row exactly as it was built, hidden.

     ASKED ANONYMOUSLY, because the rail carries no session of its own and will
     not load the auth library for a question this small. In a members-only
     league row-level security answers "none" to that, so the row stays hidden
     even for a member — the hub itself is still reachable by its address and
     reads it properly with their token. Nothing is disclosed by the reverse. */
  /* Function declarations rather than consts, all the way down: retarget() runs
     while the rail is being built, long before this point in the file, and a
     const here would still be in its dead zone when it called. */
  function probeStore() { try { return window.sessionStorage || null; } catch (_) { return null; } }
  function probeRemembered(key) {
    const s = probeStore();
    if (!s) return null;
    try { const v = s.getItem('ep-nav-probe-' + key); return v === '1' ? true : v === '0' ? false : null; }
    catch (_) { return null; }
  }
  function probeRemember(key, yes) {
    const s = probeStore();
    if (!s) return;
    try { s.setItem('ep-nav-probe-' + key, yes ? '1' : '0'); } catch (_) { /* full, or private browsing */ }
  }
  function paintProbes() {
    probed.forEach(([node, kind]) => {
      node.hidden = probeSaid[kind + '|' + lg] !== true || node.dataset.navOff === '1';
    });
  }
  /* the listing epinoia/video/videohub.js draws, reduced to "does one exist" */
  function probeQuery(kind, slug) {
    /* the fans' vote: has this league had a round yet (fanvote_rounds is readable
       wherever its league is, 0150) */
    if (kind === 'votes') {
      return 'fanvote_rounds?select=id,leagues!inner(slug)&leagues.slug=eq.' +
        encodeURIComponent(slug) + '&limit=1';
    }
    if (kind !== 'video') return null;
    /* every embedded table named IN THE SELECT, which is what makes the !inner
       filters below legal: PostgREST answers 400 (PGRST108) for a filter on a
       table the select does not embed, and a 400 here is a row that never
       appears rather than an error anybody sees. */
    return 'games?select=id,competitions!inner(seasons!inner(leagues!inner(slug))),' +
      'game_videos!inner(id),video_jobs!inner(status)' +
      '&competitions.seasons.leagues.slug=eq.' + encodeURIComponent(slug) +
      '&game_videos.is_primary=eq.true' +
      '&game_videos.clock_track->samples->0=not.is.null' +
      '&video_jobs.status=eq.done&limit=1';
  }
  function probeLeague() {
    if (!probed.length) return;
    const slug = lg;
    if (!slug) { paintProbes(); return; }
    probed.forEach(([, kind]) => {
      const key = kind + '|' + slug;
      if (probeSaid[key] !== undefined || probeAsked[key]) { paintProbes(); return; }
      const held = probeRemembered(key);
      if (held !== null) { probeSaid[key] = held; paintProbes(); return; }
      const cfg = window.EPINOIA_CONFIG, q = probeQuery(kind, slug);
      if (!cfg || !cfg.supabaseUrl || !q) return;
      probeAsked[key] = true;
      let asked;
      try {
        asked = fetch(cfg.supabaseUrl + '/rest/v1/' + q,
          { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
      } catch (_) { return; }                 // no fetch at all: the row stays hidden
      Promise.resolve(asked).then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }).then(rows => {
        const yes = Array.isArray(rows) && rows.length > 0;
        probeSaid[key] = yes;
        probeRemember(key, yes);
        paintProbes();
        try { sizeDeck(false); } catch (_) { /* before the deck has been measured */ }
      }).catch(() => { probeAsked[key] = false; });
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
    /* The rows that depend on what the league HAS are repointed here with
       everything else, so browsing the rail into another league asks that
       league's question rather than keeping the last one's answer. */
    probeLeague();
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
  /* ...and so does a font arriving. On the desktop rail names wrap onto a second line
     (nav.css), so a row's height depends on Silkscreen having loaded: a deck measured
     against the fallback face would clip the bottom of the list or leave a gap under it.
     loadingdone as well as ready, because ready can resolve before the rail's text has
     asked for its font at all. */
  if (document.fonts) {
    document.fonts.ready.then(() => sizeDeck(false));
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => sizeDeck(false));
  }

  /* The assignment pages already make repoints the rail and drills it in, with
     no page edit. This is how a page that resolved its league from the network
     rather than from ?l= ends up on the right view. */
  try {
    Object.defineProperty(window, '__CS_LEAGUE_SLUG', {
      configurable: true,
      get() { return lg; },
      set(v) {
        /* a shared script that names a league on HOME, games or scouting is not the
           page saying what it is about: those pages are about every league */
        if (onPlatform) return;
        lg = v || '';
        try { paintTabbar(); } catch (_) { /* before the bar exists */ }
        pageLeague = lg;              // the page has just told us what it is about
        markCurrent();
        retarget();
        const l = bySlug();
        if (l) { fillHeader(l); setView('league', false); settleCountry(l); }
        else { setView('root', false); }
        applyAuth();                 // role gating is league-scoped
        themeLeague();               // and the page wears that league's colours
      }
    });
  } catch (e) { /* a page that froze the global keeps the rail it was built with */ }
})();
