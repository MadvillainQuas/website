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
    { label: 'take part' },
    { href: root + 'score/',             ic: '●', tx: 'score a game', match: /\/league\/score\// },
    { href: root + 'app/',               ic: '◆', tx: 'club portal',  match: /\/league\/app\// },
    { href: root + 'admin/',             ic: '▲', tx: 'league admin', match: /\/league\/admin\// },
    { gap: true },
    { href: '/index.html',               ic: '←', tx: 'prophesy' }
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

  ITEMS.forEach(it => {
    if (it.leagues) { leagueGroup = buildLeagueGroup(); nav.appendChild(leagueGroup.root); return; }
    if (it.gap) { const d = document.createElement('div'); d.className = 'gap'; nav.appendChild(d); return; }
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; nav.appendChild(d); return; }
    if (it.label) {
      const d = document.createElement('div');
      d.className = 'grouplbl'; d.textContent = it.label;
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
    nav.appendChild(a);
  });

  const mount = () => {
    document.body.appendChild(nav);
    document.body.classList.add('has-nav');
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  fillLeagues().then(apply);

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
