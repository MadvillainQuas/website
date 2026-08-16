'use strict';
/* ============================================================================
   Injects the navigation rail into every public page.

   Self-injecting so a new page needs one script tag rather than a block of
   markup to keep in sync — the last thing this site needs is nine copies of a
   menu drifting apart.

   The current league is carried through the links where a page knows it, so
   moving from a team page to the season table does not silently drop you into
   a different competition.

   Not loaded by the scorer: see the note in kit/nav.css.
   ============================================================================ */
(function () {
  if (document.querySelector('.cs-nav')) return;

  const here = location.pathname.replace(/\/index\.html$/, '/');
  /* Climb back to /league/ by counting the directories below it, rather than
     assuming one. Subpages exist now (stats/wowy/), and a hard-coded '../'
     silently pointed them at their parent, which resolved to a real URL and so
     failed as a wrong destination rather than a broken link. */
  const seg = here.split('/league/')[1] || '';
  const parts = seg.split('/').filter(Boolean);
  /* a trailing filename is not a directory to climb out of */
  if (parts.length && parts[parts.length - 1].indexOf('.') !== -1) parts.pop();
  const root = parts.length ? '../'.repeat(parts.length) : './';

  /* Keep the league in hand when we know it.

     The catch is WHEN we know it. A page that was opened without ?l= resolves
     its league from the network, which lands well after this script has built
     the rail — so the links were being written league-less and moving from a
     team page to the season table quietly dropped you into the default
     competition. Rather than make every page call a refresh hook, the slug is
     defined as a property here: the assignment those pages already make
     (`window.__CS_LEAGUE_SLUG = league.slug`) rewrites the links itself. */
  const qp = new URLSearchParams(location.search);
  let lg = qp.get('l') || (window.__CS_LEAGUE_SLUG || '');
  const withLeague = path => lg ? path + (path.includes('?') ? '&' : '?') + 'l=' + encodeURIComponent(lg) : path;
  const carriers = [];   // [anchor, base path] for links that take the league

  /* Named, grouped and labelled. Glyphs are decoration only — several of
     these destinations are not guessable from an icon, and a couple of the
     symbols used before did not render in the self-hosted faces at all,
     which is how the rail ended up as a logo followed by nothing. */
  const ITEMS = [
    { label: 'watch' },
    /* The leagues themselves go here, injected once they have been fetched —
       see fillLeagues below. A platform with one league should not make you
       navigate a directory to reach it, and one with nine should not hide them
       behind a page called "all games". */
    { leagues: true },
    { href: root + 'stats/',       lg: true, ic: '▦', tx: 'statistics',   match: /\/league\/stats\/$/ },
    { href: root + 'stats/wowy/',  lg: true, ic: '◫', tx: 'wowy',    match: /\/league\/stats\/wowy\// },
    /* Everything below needs an account, and each entry needs a DIFFERENT
       account — a team manager has no business being shown "league admin".
       The group is hidden entirely until somebody signs in, and then only the
       entries their roles justify appear. Hiding a button is a courtesy, not a
       control: pressing one you should not have is refused by the database. */
    { label: 'take part', auth: true },
    { href: root + 'score/', ic: '●', tx: 'score a game', match: /\/league\/score\//,
      auth: true, role: w => (w.scoring || []).length || (w.leagues || []).length },
    { href: root + 'app/',   ic: '◆', tx: 'club portal',  match: /\/league\/app\//,
      auth: true, role: () => true },
    { href: root + 'admin/', ic: '▲', tx: 'league admin', match: /\/league\/admin\//,
      auth: true, role: w => (w.leagues || []).length || w.is_platform_admin },
    { gap: true },
    { account: true },
    { href: root + 'contact/', ic: '✉', tx: 'contact', match: /\/league\/contact\// },
    { href: '/index.html',     ic: '←', tx: 'prophesy' }
  ];

  /* ------------------------------------------------------------- leagues ---
     A collapsible group holding the leagues themselves.

     It is built empty and filled once the list arrives, because the rail must
     appear immediately — a navigation that pops in after a network round trip
     is worse than one that shows a placeholder. The open/closed state is
     remembered, since somebody who collapsed it does not want it reopening on
     every page.

     Each league points at its OWN splash page rather than at the table
     directly: the splash is where a reader finds out what happened last night,
     and the table is one click on from it. */
  const LS_KEY = 'cs-nav-leagues-open';
  function buildLeagueGroup() {
    const wrap = document.createElement('div');
    wrap.className = 'lgroup';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'item ghead';
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = '▤';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = 'leagues';
    const car = document.createElement('span'); car.className = 'caret'; car.textContent = '›';
    head.append(ic, tx, car);
    head.title = 'leagues';

    const list = document.createElement('div');
    list.className = 'glist';
    const holding = document.createElement('div');
    holding.className = 'gempty';
    holding.textContent = '…';
    list.appendChild(holding);

    let open = true;
    try { open = localStorage.getItem(LS_KEY) !== '0'; } catch (_) {}
    const apply = () => {
      wrap.classList.toggle('closed', !open);
      head.setAttribute('aria-expanded', String(open));
    };
    head.addEventListener('click', () => {
      open = !open;
      try { localStorage.setItem(LS_KEY, open ? '1' : '0'); } catch (_) {}
      apply();
    });
    apply();

    wrap.append(head, list);
    return { root: wrap, list, holding };
  }

  /* The rail is on public pages that already carry config.js. Where it is not
     — or where the request fails — the group simply says so rather than
     sitting on an ellipsis for ever. */
  async function fillLeagues() {
    if (!leagueGroup) return;
    const cfg = window.COURTSIDE_CONFIG;
    if (!cfg || !cfg.supabaseUrl) { leagueGroup.holding.textContent = ''; return; }
    let rows = [];
    try {
      const r = await fetch(cfg.supabaseUrl + '/rest/v1/leagues?select=slug,name,colour_a&order=name',
        { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      rows = await r.json();
    } catch (_) {
      leagueGroup.holding.textContent = 'unavailable';
      return;
    }

    leagueGroup.list.textContent = '';
    if (!rows.length) {
      const d = document.createElement('div');
      d.className = 'gempty'; d.textContent = 'none yet';
      leagueGroup.list.appendChild(d);
      return;
    }
    rows.forEach(l => {
      const a = document.createElement('a');
      a.className = 'item sub';
      a.href = root + '?l=' + encodeURIComponent(l.slug);
      /* the current league is marked whether you arrived via ?l= or the page
         resolved it for itself */
      if (lg && l.slug === lg) a.classList.add('on');
      const dot = document.createElement('span');
      dot.className = 'ic dot';
      dot.style.background = l.colour_a || 'var(--lume)';
      const t = document.createElement('span');
      t.className = 'tx'; t.textContent = l.name;
      a.append(dot, t);
      a.title = l.name;
      a.dataset.leagueSlug = l.slug;
      leagueGroup.list.appendChild(a);
    });
  }

  /* ------------------------------------------------------------- account ---
     Who is signed in, and the way in or out.

     The rail does NOT load the Supabase SDK. It is on every public page and
     the SDK is a large dependency to add to a page that only needs to know
     whether somebody is signed in — so the stored session is read directly,
     and the actual sign-in flow lives on its own page which does load it.

     The session key is the SDK's own convention: sb-<project-ref>-auth-token,
     with the ref taken from the configured URL so this keeps working if the
     project ever moves. */
  let accountSlot = null;

  function projectRef() {
    const c = window.COURTSIDE_CONFIG;
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

  function buildAccount() {
    const wrap = document.createElement('div');
    wrap.className = 'acct';
    const link = document.createElement('a');
    link.className = 'item';
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = '◐';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = 'sign in';
    link.append(ic, tx);
    link.href = root + 'signin/?next=' + encodeURIComponent(location.pathname + location.search);
    link.title = 'sign in';
    wrap.appendChild(link);
    return { root: wrap, link, ic, tx };
  }

  /* Ask the database what this account may actually do. whoami() is the same
     RPC the admin console uses, so the rail and the console can never disagree
     about somebody's roles. */
  async function whoami(token) {
    const c = window.COURTSIDE_CONFIG;
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/whoami', {
      method: 'POST',
      cache: 'no-store',
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
    if (!accountSlot) return;

    if (!sess) {
      /* signed out: the take-part group stays hidden entirely */
      gated.forEach(([node]) => { node.hidden = true; });
      accountSlot.tx.textContent = 'sign in';
      accountSlot.ic.textContent = '◐';
      accountSlot.link.href = root + 'signin/?next=' +
        encodeURIComponent(location.pathname + location.search);
      accountSlot.link.title = 'sign in';
      return;
    }

    accountSlot.tx.textContent = sess.email || 'account';
    accountSlot.ic.textContent = '◉';
    accountSlot.link.href = root + 'signin/';
    accountSlot.link.title = sess.email ? sess.email + ' — manage or sign out' : 'account';

    let who = {};
    try { who = await whoami(sess.token) || {}; } catch (_) { who = {}; }
    gated.forEach(([node, pred]) => {
      let ok = false;
      try { ok = !!pred(who); } catch (_) { ok = false; }
      node.hidden = !ok;
    });
    /* if every entry under it is hidden, hide the heading too rather than
       leaving a label with nothing beneath it */
    const anyShown = gated.some(([n]) => n.tagName === 'A' && !n.hidden);
    gated.forEach(([n]) => { if (n.tagName !== 'A') n.hidden = !anyShown; });
  }

  const nav = document.createElement('nav');
  nav.className = 'cs-nav';
  nav.setAttribute('aria-label', 'Courtside');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = root;
  const mark = document.createElement('span');
  mark.className = 'mark'; mark.textContent = 'C';
  const word = document.createElement('span');
  word.className = 'word'; word.textContent = 'Courtside';
  brand.append(mark, word);
  nav.appendChild(brand);

  let leagueGroup = null;      // filled asynchronously

  const gated = [];            // [node, predicate] — shown once roles are known

  ITEMS.forEach(it => {
    if (it.leagues) { leagueGroup = buildLeagueGroup(); nav.appendChild(leagueGroup.root); return; }
    if (it.account) { accountSlot = buildAccount(); nav.appendChild(accountSlot.root); return; }
    if (it.gap) { const d = document.createElement('div'); d.className = 'gap'; nav.appendChild(d); return; }
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; nav.appendChild(d); return; }
    if (it.label) {
      const d = document.createElement('div');
      d.className = 'grouplbl'; d.textContent = it.label;
      /* signed out, the heading goes with the things it heads */
      if (it.auth) { d.hidden = true; gated.push([d, () => true]); }
      nav.appendChild(d); return;
    }
    const a = document.createElement('a');
    a.className = 'item' + (it.match && it.match.test(here) ? ' on' : '');
    a.href = it.lg ? withLeague(it.href) : it.href;
    if (it.lg) carriers.push([a, it.href]);
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = it.ic;
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = it.tx;
    a.append(ic, tx);
    a.title = it.tx;
    if (it.auth) { a.hidden = true; gated.push([a, it.role || (() => true)]); }
    nav.appendChild(a);
  });

  const mount = () => {
    document.body.appendChild(nav);
    document.body.classList.add('has-nav');
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  fillLeagues().then(apply);
  applyAuth();
  /* signing out in another tab should not leave this one showing an
     admin link that no longer works */
  window.addEventListener('storage', e => {
    if (e.key && e.key.indexOf('-auth-token') !== -1) applyAuth();
  });

  /* the assignment pages already make now repoints the rail, with no page edit */
  const apply = () => {
    carriers.forEach(([a, base]) => { a.href = withLeague(base); });
    /* and the league that is being viewed becomes the highlighted one */
    if (leagueGroup) {
      leagueGroup.list.querySelectorAll('a[data-league-slug]').forEach(a => {
        a.classList.toggle('on', !!lg && a.dataset.leagueSlug === lg);
      });
    }
  };
  try {
    Object.defineProperty(window, '__CS_LEAGUE_SLUG', {
      configurable: true,
      get() { return lg; },
      set(v) { lg = v || ''; apply(); }
    });
  } catch (e) { /* a page that froze the global keeps the links it was built with */ }
})();
