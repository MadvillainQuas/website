'use strict';
/* ============================================================================
   EPINOIA EMBED — one line on someone else's page.

     <script src="https://prophesyscouting.co.uk/epinoia/embed.js"
             data-epinoia="strip" data-league="your-league-slug"></script>

     <script src="https://prophesyscouting.co.uk/epinoia/embed.js"
             data-epinoia="game" data-game="<uuid>"></script>

   Or place it precisely by giving a target:

     <div id="scores"></div>
     <script src=".../embed.js" data-epinoia="strip" data-into="#scores"></script>

   Design notes, all of them about being a guest on a page we do not control:

   AN IFRAME, NOT INJECTED MARKUP. The host's stylesheet cannot reach inside it
   and our CSS cannot leak out. A widget that reflows someone's article is worse
   than no widget.

   HEIGHT COMES FROM THE CHILD. The host cannot know how tall a strip of six
   fixtures wants to be, so the frame posts its height out and this applies it.
   Messages are checked against our own origin — a page can contain other
   frames, and any of them can post.

   IT WEARS THE PAGE'S COLOURWAY. Light or dark is read from the background
   actually behind the embed, and the site's brand colour from what the site
   itself declares: its theme-color, a primary/accent colour variable (WordPress
   themes publish --wp--preset--color--primary), or the colour of its links. Both
   are sent to the embed and sent again when the page changes — a dark-mode
   switch, a class on <html>, the system theme — so the embed follows. What the
   snippet says outright wins: data-theme, data-accent, data-accent2.
   data-colourway="off" turns the reading off and leaves only those.

   NOTHING IS TRACKED. No cookies, no storage, no third-party requests. The
   embed reads public fixtures with the anonymous key and nothing else.
   ============================================================================ */
(function () {
  const me = document.currentScript;
  if (!me) return;

  const kind = (me.dataset.epinoia || 'strip').toLowerCase();
  const base = new URL('.', me.src).href;          // .../epinoia/

  /* A NOTIFICATION BUTTON IS NOT A FRAME (docs/notify-embed.md §1): a browser will not
     ask for notification permission from a frame on another site. The snippet is
     queued for embed/notify/notify.js, which draws the button into the page itself
     (in a closed shadow root, so neither side's styles leak), and that file is loaded
     once however many buttons the page carries. */
  if (kind === 'notify') {
    (window.EpinoiaNotifyButtons = window.EpinoiaNotifyButtons || []).push(me);
    if (!document.querySelector('script[data-epinoia-notify-loader]')) {
      const loader = document.createElement('script');
      loader.src = new URL('embed/notify/notify.js', base).href;
      loader.async = true;
      loader.setAttribute('data-epinoia-notify-loader', '1');
      (document.head || document.documentElement).appendChild(loader);
    }
    return;
  }

  const PATHS = { strip: 'embed/strip/', game: 'embed/game/',
                  standings: 'embed/table/', leaders: 'embed/table/',
                  shop: 'embed/merch/' };
  const path = PATHS[kind];
  if (!path) {
    console.warn('[epinoia] unknown embed "' + kind +
                 '" — expected strip, game, standings, leaders, shop or notify');
    return;
  }

  /* ---------------------------------------------------- the page's colourway --- */
  const auto = (me.dataset.colourway || '').toLowerCase() !== 'off';
  const target = me.dataset.into ? document.querySelector(me.dataset.into) : null;

  /* 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', '#abc', '#aabbcc' -> [r, g, b, a] */
  function rgba(v) {
    const s = String(v || '').trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (!m) return null;
    let a = m[4] == null ? 1 : parseFloat(m[4]);
    if (m[4] && /%$/.test(m[4])) a /= 100;
    return [+m[1], +m[2], +m[3], a];
  }
  const hexOf = c => '#' + c.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const lum = c => {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  /* a colour, not a tone: saturated, and neither near-black nor near-white */
  const chromatic = c => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1) + 1e-9);
    return s >= 0.25 && l >= 0.12 && l <= 0.85;
  };

  /* the first opaque background from the embed's own container up: what the embed sits on */
  function ground(from) {
    for (let n = from; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c && c[3] >= 0.5) return c;
    }
    return [255, 255, 255, 1];                    /* nothing painted: the browser's white */
  }

  function brand() {
    const found = [];
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const meta = metas.find(x => { const q = x.getAttribute('media'); try { return !q || matchMedia(q).matches; } catch (_) { return !q; } });
    if (meta) found.push(meta.getAttribute('content'));
    const root = getComputedStyle(document.documentElement);
    ['--wp--preset--color--primary', '--primary', '--color-primary', '--brand', '--brand-color',
     '--accent', '--color-accent', '--theme-color'].forEach(k => found.push(root.getPropertyValue(k)));
    const link = document.querySelector('main a[href], article a[href], a[href]');
    if (link) found.push(getComputedStyle(link).color);
    for (const v of found) {
      const c = rgba(v);
      if (c && c[3] >= 0.5 && chromatic(c)) return hexOf(c);
    }
    return null;
  }

  function detect() {
    const d = me.dataset;
    const host = (frame && frame.parentElement) || target || me.parentElement || document.body;
    const under = auto ? ground(host) : null;
    const theme = d.theme === 'light' || d.theme === 'dark' ? d.theme
      : (under ? (lum(under) < 0.35 ? 'dark' : 'light') : null);
    /* the ground too, so the embed sits in the page rather than on a panel of our own green-black;
       only when it agrees with the theme (a dark embed asked for on a white page keeps its own) */
    const agrees = under && theme && ((lum(under) < 0.35) === (theme === 'dark'));
    return { epinoiaEmbed: 'colourway', theme,
             accent: d.accent || (auto ? brand() : null), accent2: d.accent2 || null,
             ground: d.bg || (agrees ? hexOf(under) : null) };
  }

  let frame = null;
  const first = detect();

  const url = new URL(path, base);
  if (me.dataset.league) url.searchParams.set('l', me.dataset.league);
  if (me.dataset.game)   url.searchParams.set('g', me.dataset.game);
  if (me.dataset.count)  url.searchParams.set('n', me.dataset.count);
  if (me.dataset.stat)   url.searchParams.set('stat', me.dataset.stat);
  /* the colourway as the URL too, so the first paint is already right; validated on the far side
     before any of it is written into a style */
  if (first.theme)   url.searchParams.set('theme', first.theme);
  if (first.accent)  url.searchParams.set('accent', first.accent);
  if (first.accent2) url.searchParams.set('accent2', first.accent2);
  if (first.ground)  url.searchParams.set('bg', first.ground);
  if (kind === 'standings' || kind === 'leaders') url.searchParams.set('kind', kind);

  frame = document.createElement('iframe');
  frame.src = url.href;
  frame.title = { game: 'Epinoia box score', strip: 'Epinoia fixtures',
                  standings: 'Epinoia standings', leaders: 'Epinoia leaders',
                  shop: 'Epinoia shop' }[kind] || 'Epinoia';
  frame.loading = 'lazy';
  frame.setAttribute('scrolling', 'no');
  /* no allow-* beyond scripts and same-origin: the frame needs neither popups
     nor forms nor storage access, and granting what is not needed is how a
     widget becomes a liability on someone else's domain */
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  frame.style.cssText = [
    'display:block', 'width:100%', 'border:0',
    'height:' + (kind === 'game' ? '210px'
               : kind === 'strip' ? '120px' : '320px'),
    'background:' + (first.theme === 'light' ? '#ffffff' : '#04100b'),
    'color-scheme:' + (first.theme === 'light' ? 'light' : 'dark'),
    'border-radius:' + (me.dataset.radius || '4px'),
    'overflow:hidden'
  ].join(';');

  if (target) target.appendChild(frame);
  else me.parentNode.insertBefore(frame, me.nextSibling);

  /* Only listen to our own frame, from our own origin. A host page may hold
     several embeds and any number of unrelated frames; without both checks one
     of them could resize another. */
  const origin = new URL(base).origin;
  let sent = '';
  const send = force => {
    const cw = detect();
    const key = JSON.stringify(cw);
    if (!force && key === sent) return;
    sent = key;
    frame.style.colorScheme = cw.theme === 'light' ? 'light' : 'dark';
    try { if (frame.contentWindow) frame.contentWindow.postMessage(cw, origin); } catch (_) { /* not loaded yet */ }
  };
  window.addEventListener('message', ev => {
    if (ev.origin !== origin) return;
    if (ev.source !== frame.contentWindow) return;
    const d = ev.data;
    if (!d) return;
    if (d.epinoiaEmbed === 'colourway?') { send(true); return; }
    if (d.epinoiaEmbed !== 'height') return;
    const h = Number(d.height);
    if (!isFinite(h) || h < 60 || h > 2000) return;   // never trust a posted number
    frame.style.height = Math.ceil(h) + 'px';
  });

  if (!auto) return;
  /* THE PAGE CHANGES ITS CLOTHES: a dark-mode switch is nearly always a class, an attribute or a
     style on <html> or <body>, or the system theme. Each is watched, and the embed told only when
     what it would be told has actually changed. */
  frame.addEventListener('load', () => send(true));
  let queued = false;
  const later = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; send(false); }, 120); };
  try {
    const opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-bs-theme', 'data-mode', 'data-color-scheme'] };
    new MutationObserver(later).observe(document.documentElement, opts);
    if (document.body) new MutationObserver(later).observe(document.body, opts);
  } catch (_) { /* no observer: the colourway the embed opened with stands */ }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', later); } catch (_) { /* old browser */ }
  window.addEventListener('load', later);
})();
