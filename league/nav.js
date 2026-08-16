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
  /* every page under /league/ is one directory deep except the hub itself */
  const root = /\/league\/[^/]+\//.test(here) ? '../' : './';

  /* keep the league in hand when we know it */
  const qp = new URLSearchParams(location.search);
  const lg = qp.get('l') || (window.__CS_LEAGUE_SLUG || '');
  const withLeague = path => lg ? path + (path.includes('?') ? '&' : '?') + 'l=' + encodeURIComponent(lg) : path;

  const ITEMS = [
    { href: root,                       ic: '⌂',  tx: 'home',    match: /\/league\/$/ },
    { href: withLeague(root + 'l/'),    ic: '▤',  tx: 'league',  match: /\/league\/l\// },
    { href: withLeague(root + 'stats/'),ic: '▦',  tx: 'stats',   match: /\/league\/stats\// },
    { sep: true },
    { href: root + 'score/',            ic: '⏱',  tx: 'scorer',  match: /\/league\/score\// },
    { href: root + 'app/',              ic: '◈',  tx: 'portal',  match: /\/league\/app\// },
    { href: root + 'admin/',            ic: '⚙',  tx: 'admin',   match: /\/league\/admin\// },
    { gap: true },
    { href: '/index.html',              ic: '←',  tx: 'prophesy' }
  ];

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

  ITEMS.forEach(it => {
    if (it.gap) { const d = document.createElement('div'); d.className = 'gap'; nav.appendChild(d); return; }
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; nav.appendChild(d); return; }
    const a = document.createElement('a');
    a.className = 'item' + (it.match && it.match.test(here) ? ' on' : '');
    a.href = it.href;
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
})();
