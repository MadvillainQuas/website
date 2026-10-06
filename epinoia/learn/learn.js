'use strict';
/* ============================================================================
   LEARN MORE (rebuilt 2026-10-06): the tabs, the live figures, the leagues by country, the framed product and "Save as PDF".

   THE TABS. Overview, Platform, Data & models, Deploy, Contact. The choice is in the address (?t=) so a tab can be sent to somebody,
   with replaceState, because a tab is not a place to press Back out of. A link with data-go switches tab in place. The addresses the
   page had before keep working (?t=who and ?t=new open Overview and Platform, ?t=how Data & models), and so does /contact/, which
   forwards to ?t=contact, and ?topic= (the contact form's). nav.js's ON THIS PAGE follows the tab shown (epinoia:sections).

   THE FIGURES are counts the database gives any visitor (PostgREST's Content-Range, one row asked for): leagues, competitions,
   clubs, games, finished games, player box scores, venues and roster places exactly; the play-by-play events by the planner's
   estimate, because an exact count of over a million rows is not worth a visitor's wait. Countries are worked out from the leagues
   (a league in two countries counts both, a region such as Europe or the Balkans counts none). A figure that cannot be read says
   so with a dash; the page never shows a number it made up.
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const CFG = window.EPINOIA_CONFIG || {};
  const TABS = ['overview', 'platform', 'data', 'deploy', 'contact'];
  const OLD = { who: 'overview', new: 'platform', how: 'data' };
  const panes = [...document.querySelectorAll('.lm-pane')];
  const btns = [...document.querySelectorAll('.lm-tabs [data-t]')];

  function show(which, remember) {
    if (TABS.indexOf(which) < 0) which = 'overview';
    panes.forEach(p => { p.hidden = p.dataset.p !== which; });
    btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === which)));
    if (remember) {
      try {
        const u = new URL(location.href);
        u.searchParams.set('t', which);
        if (which !== 'contact') u.searchParams.delete('topic');
        u.hash = '';
        history.replaceState(null, '', u);
      } catch (_) { /* the tab is what matters */ }
    }
    try { window.dispatchEvent(new Event('epinoia:sections')); } catch (_) { /* the index catches up by itself */ }
    setTimeout(fitShots, 0);
  }
  btns.forEach(b => b.addEventListener('click', () => {
    show(b.dataset.t, true);
    const top = $('.lm-tabs');
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
  }));
  /* a link inside the page that names a tab (Talk to us, the cards' links) switches in place and goes to its section */
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[data-go]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const url = new URL(a.getAttribute('href'), location.href);
    show(a.dataset.go, true);
    const topic = url.searchParams.get('topic'), sel = $('#topic');
    if (topic && sel && [...sel.options].some(o => o.value === topic)) { sel.value = topic; sel.dispatchEvent(new Event('change')); }
    const to = url.hash ? document.getElementById(url.hash.slice(1)) : null;
    if (to) setTimeout(() => to.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  });

  const q = new URLSearchParams(location.search);
  let want = q.get('t') || '';
  want = OLD[want] || want;
  if (!want && q.get('topic')) want = 'contact';
  show(want || 'overview', false);
  if (location.hash) { const to = document.getElementById(location.hash.slice(1)); if (to) setTimeout(() => to.scrollIntoView({ block: 'start' }), 60); }

  /* Save as PDF: every tab but the form, printed (kit/learn.css @media print) */
  const pr = $('#lmPrint');
  if (pr) pr.addEventListener('click', () => { try { window.print(); } catch (_) { /* nothing to do */ } });

  /* ---------------------------------------------------------------- the figures --- */
  const fmt = n => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-GB'));
  async function count(path, estimated) {
    if (!CFG.supabaseUrl) return null;
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
      headers: { apikey: CFG.supabaseAnonKey, Prefer: 'count=' + (estimated ? 'estimated' : 'exact'), Range: '0-0', 'Range-Unit': 'items' }
    });
    if (!r.ok && r.status !== 206) return null;
    const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
    return m ? +m[1] : null;
  }
  function put(k, v) {
    const box = document.querySelector('.lm-kpi[data-k="' + k + '"]');
    if (!box) return;
    box.classList.remove('wait');
    box.querySelector('.v').textContent = fmt(v);
    if (v == null) box.title = 'Not readable just now';
  }
  const C = () => window.EpinoiaCountry || null;
  function countriesOf(leagues) {
    const set = new Set(), R = (C() && C().REGIONS) || {};
    leagues.forEach(l => String(l.country || '').split('+').map(s => s.trim().toUpperCase()).forEach(c => {
      if (/^[A-Z]{2}$/.test(c) && !R[c] && c !== 'EU') set.add(c);
    }));
    return set.size;
  }
  async function figures() {
    let leagues = [];
    try {
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/leagues?select=slug,name,country&order=name', { headers: { apikey: CFG.supabaseAnonKey } });
      leagues = r.ok ? await r.json() : [];
    } catch (_) { leagues = []; }
    put('leagues', leagues.length || null);
    put('countries', leagues.length ? countriesOf(leagues) : null);
    coverage(leagues);
    const jobs = [
      ['competitions', 'competitions?select=id'], ['clubs', 'teams?select=id'], ['games', 'games?select=id'],
      ['final', 'games?select=id&status=eq.final'], ['lines', 'player_game_stats?select=game_id'],
      ['venues', 'venues?select=id'], ['roster', 'roster_entries?select=id'], ['events', 'game_events?select=id', true]
    ];
    await Promise.all(jobs.map(async ([k, p, est]) => { let v = null; try { v = await count(p, est); } catch (_) { v = null; } put(k, v); }));
    const at = new Date();
    const asof = $('#asof');
    if (asof) asof.textContent = 'As of ' + at.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) +
      '. Play-by-play events are an estimate; every other figure is an exact count of what the public can see.';
  }

  /* ---------------------------------------------------------- the leagues, by country --- */
  function coverage(leagues) {
    const host = $('#cov');
    if (!host) return;
    host.textContent = '';
    if (!leagues.length) {
      const d = document.createElement('div'); d.className = 'c';
      d.textContent = 'The list of leagues could not be read just now.';
      host.appendChild(d);
      return;
    }
    const groups = C() && C().group ? C().group(leagues) : [{ name: 'Leagues', leagues }];
    groups.forEach(g => {
      const c = document.createElement('div'); c.className = 'c';
      const h = document.createElement('h4');
      const nm = document.createElement('b'); nm.textContent = ((g.flag ? g.flag + ' ' : '') + (g.name || '')).trim();
      const n = document.createElement('span'); n.textContent = String(g.leagues.length);
      h.append(nm, n);
      c.appendChild(h);
      g.leagues.forEach(l => {
        const a = document.createElement('a');
        a.href = '../l/?l=' + encodeURIComponent(l.slug);
        a.textContent = l.name;
        a.setAttribute('translate', 'no');
        c.appendChild(a);
      });
      host.appendChild(c);
    });
  }

  /* ---------------------------------------------------------- the framed product --- */
  /* A whole page in a card is rendered at a desktop width and scaled down, not squeezed (a 400px frame serves the phone layout) */
  function fitShots() {
    document.querySelectorAll('.port[data-scale]').forEach(port => {
      const frame = port.querySelector('iframe');
      if (!frame) return;
      const w = +port.dataset.w || 1280, h = +port.dataset.h || 860;
      const avail = port.clientWidth || port.getBoundingClientRect().width;
      if (!avail) return;
      const k = avail / w;
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      frame.style.transform = 'scale(' + k + ')';
      port.style.height = Math.round(h * k) + 'px';
    });
  }
  addEventListener('resize', fitShots, { passive: true });
  addEventListener('load', fitShots);
  fitShots();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', figures); else figures();
}());
