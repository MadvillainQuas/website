'use strict';
/* ============================================================================
   Embed theme — the host page's colourway: light or dark, and its colours.

   Every embed (the strip, the box score, the standings and leaders, the shop) runs on somebody
   else's page and should look like part of it. Three sources, the later ones winning:

     1. THE URL           ?theme=light|dark, ?accent= / ?accent2= (club colours), ?bg=
     2. THE READER        the switch on the embed, kept in this browser (localStorage is
                          partitioned per host site, so a choice on one club's site is theirs on
                          that site); it outranks the URL's theme, as it always has
     3. THE HOST PAGE     a message from the page that framed us:
                            { epinoiaEmbed: 'colourway', theme, accent, accent2, ground }
                          sent by embed.js on a club's site (which reads the site's own
                          background and brand colour) and by teamcolour.js on Epinoia's own pages
                          (the league's or the club's colours). It is sent again whenever the
                          page changes — a dark-mode switch, a league's colours arriving — so the
                          embed follows along. A host that speaks for the page makes the reader's
                          switch redundant, so the switch is hidden.

   Colours are made readable the way a club's are on its own page (teamcolour.js): the accent
   as a surface is nudged off the ground until it shows (--ep-accent / --ep-accent-2), as text
   until it reads at 4.5:1 (--ep-accent-ink), and text ON it is near-black or white, whichever
   contrasts (--ep-on-accent). So a navy club on a dark site and a gold one on a white site both
   work. Every colour is validated as #rgb / #rrggbb before it touches a style: these strings
   come from a URL or a message on a page we do not control.

   The strip keeps its switch on the bar itself; every other embed puts it in the corner.
   ============================================================================ */
(function () {
  const q = new URLSearchParams(location.search);
  const TC = () => window.EpinoiaTeamColour;
  const hex = v => {
    const s = String(v == null ? '' : v).trim();
    if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
    let h = s.charAt(0) === '#' ? s.slice(1) : s;
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.toLowerCase();
  };

  let raw = { accent: hex(q.get('accent')), accent2: hex(q.get('accent2')) };
  let hostDriven = false;
  let toggle = null;

  /* the colours as surfaces and ink for the ground the embed is on now */
  function paint() {
    const s = document.body.style;
    const T = TC();
    if (!raw.accent) {
      ['--ep-accent', '--ep-accent-2', '--ep-accent-ink', '--ep-on-accent'].forEach(k => s.removeProperty(k));
      return;
    }
    const a = T ? T.surface(raw.accent) : raw.accent;
    const b = raw.accent2 ? (T ? T.surface(raw.accent2) : raw.accent2) : a;
    s.setProperty('--ep-accent', a);
    s.setProperty('--ep-accent-2', b);
    s.setProperty('--ep-accent-ink', T ? T.ink(a) : a);
    s.setProperty('--ep-on-accent', T ? T.on(a) : '#04100b');
  }

  /* the theme on <body> (embed.css reads .cse[data-theme]) and on <html> (teamcolour.js reads it
     there to pick the ground the colours are measured against) */
  function setTheme(t) {
    const light = t !== 'dark';
    [document.body, document.documentElement].forEach(n => {
      if (light) n.setAttribute('data-theme', 'light'); else n.removeAttribute('data-theme');
    });
    if (toggle) {
      toggle.textContent = light ? '☾' : '☀';
      toggle.title = light ? 'switch to dark' : 'switch to light';
      toggle.setAttribute('aria-label', toggle.title);
    }
    paint();
  }
  const current = () => (document.body.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  function postHeight() {
    try { parent.postMessage({ epinoiaEmbed: 'height', height: document.body.scrollHeight }, '*'); }
    catch (_) { /* not framed */ }
  }

  function go() {
    let stored = null;
    try { stored = localStorage.getItem('epinoia_embed_theme'); } catch (_) { stored = null; }
    const asked = (q.get('theme') || '').toLowerCase();
    setTheme(stored === 'light' || stored === 'dark' ? stored : (asked === 'dark' ? 'dark' : 'light'));

    const bg = hex(q.get('bg'));
    if (bg) document.body.style.setProperty('--ep-ground', bg);

    toggle = document.createElement('button');
    toggle.type = 'button';
    const bar = document.querySelector('.ep-strip');
    toggle.className = bar ? 'ep-theme' : 'ep-theme fixed';
    toggle.addEventListener('click', () => {
      const next = current() === 'light' ? 'dark' : 'light';
      setTheme(next);
      try { localStorage.setItem('epinoia_embed_theme', next); } catch (_) { /* private mode */ }
    });
    (bar || document.body).appendChild(toggle);
    setTheme(current());          // label the switch
    if (hostDriven) toggle.hidden = true;

    /* a host that loaded before us, or missed our load event, answers this */
    try { if (parent !== window) parent.postMessage({ epinoiaEmbed: 'colourway?' }, '*'); } catch (_) { /* not framed */ }
  }

  /* THE HOST PAGE SPEAKS FOR ITS COLOURWAY. Only our own parent is listened to: a host page can
     hold other frames, and none of them may repaint this one. */
  window.addEventListener('message', ev => {
    if (ev.source !== window.parent || window.parent === window) return;
    const d = ev.data;
    if (!d || d.epinoiaEmbed !== 'colourway') return;
    hostDriven = true;
    if (toggle) toggle.hidden = true;
    if ('accent' in d || 'accent2' in d) raw = { accent: hex(d.accent), accent2: hex(d.accent2) };
    /* the page's own background, when the host sends one (embed.js on a club's site); a host that
       sends none leaves the embed's ground to its theme */
    if ('ground' in d) {
      const g = hex(d.ground);
      if (g) document.body.style.setProperty('--ep-ground', g); else document.body.style.removeProperty('--ep-ground');
    }
    if (d.theme === 'light' || d.theme === 'dark') setTheme(d.theme); else paint();
    postHeight();
  });

  window.EpinoiaEmbedTheme = { setTheme, current, hex, isHostDriven: () => hostDriven };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
