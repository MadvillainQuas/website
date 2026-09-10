'use strict';
/* ============================================================================
   Embed theme — light or dark, with a switch the reader can press.

   Every embed runs on somebody else's page. It takes that page's choice from ?theme=light or
   ?theme=dark, opens light when nothing is said, and keeps a reader's own press of the switch
   in this browser (localStorage is partitioned per host site, so a choice on one club's site
   is theirs on that site). The strip carries its own copy of this logic on the bar itself;
   this one is for the box score, the standings and the shop.
   ============================================================================ */
(function () {
  const q = new URLSearchParams(location.search);
  const apply = t => {
    if (t === 'dark') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', 'light');
  };
  let stored = null;
  try { stored = localStorage.getItem('epinoia_embed_theme'); } catch (_) { stored = null; }
  const asked = (q.get('theme') || '').toLowerCase();
  const start = (stored === 'light' || stored === 'dark') ? stored : (asked === 'dark' ? 'dark' : 'light');
  const go = () => {
    apply(start);
    const tg = document.createElement('button');
    tg.type = 'button'; tg.className = 'ep-theme fixed';
    const paint = t => { tg.textContent = t === 'light' ? '☾' : '☀'; tg.title = t === 'light' ? 'switch to dark' : 'switch to light'; tg.setAttribute('aria-label', tg.title); };
    paint(start);
    tg.addEventListener('click', () => {
      const next = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      apply(next); paint(next);
      try { localStorage.setItem('epinoia_embed_theme', next); } catch (_) { /* private mode */ }
    });
    document.body.appendChild(tg);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
