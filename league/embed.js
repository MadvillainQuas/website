'use strict';
/* ============================================================================
   COURTSIDE EMBED — one line on someone else's page.

     <script src="https://prophesyscouting.co.uk/league/embed.js"
             data-courtside="strip" data-league="demo-league"></script>

     <script src="https://prophesyscouting.co.uk/league/embed.js"
             data-courtside="game" data-game="<uuid>"></script>

   Or place it precisely by giving a target:

     <div id="scores"></div>
     <script src=".../embed.js" data-courtside="strip" data-into="#scores"></script>

   Design notes, all of them about being a guest on a page we do not control:

   AN IFRAME, NOT INJECTED MARKUP. The host's stylesheet cannot reach inside it
   and our CSS cannot leak out. A widget that reflows someone's article is worse
   than no widget.

   HEIGHT COMES FROM THE CHILD. The host cannot know how tall a strip of six
   fixtures wants to be, so the frame posts its height out and this applies it.
   Messages are checked against our own origin — a page can contain other
   frames, and any of them can post.

   NOTHING IS TRACKED. No cookies, no storage, no third-party requests. The
   embed reads public fixtures with the anonymous key and nothing else.
   ============================================================================ */
(function () {
  const me = document.currentScript;
  if (!me) return;

  const kind = (me.dataset.courtside || 'strip').toLowerCase();
  const base = new URL('.', me.src).href;          // .../league/

  const PATHS = { strip: 'embed/strip/', game: 'embed/game/',
                  standings: 'embed/table/', leaders: 'embed/table/' };
  const path = PATHS[kind];
  if (!path) {
    console.warn('[courtside] unknown embed "' + kind +
                 '" — expected strip, game, standings or leaders');
    return;
  }

  const url = new URL(path, base);
  if (me.dataset.league) url.searchParams.set('l', me.dataset.league);
  if (me.dataset.game)   url.searchParams.set('g', me.dataset.game);
  if (me.dataset.count)  url.searchParams.set('n', me.dataset.count);
  if (me.dataset.stat)   url.searchParams.set('stat', me.dataset.stat);
  if (me.dataset.theme)  url.searchParams.set('theme', me.dataset.theme);
  if (kind === 'standings' || kind === 'leaders') url.searchParams.set('kind', kind);

  const frame = document.createElement('iframe');
  frame.src = url.href;
  frame.title = { game: 'Courtside box score', strip: 'Courtside fixtures',
                  standings: 'Courtside standings',
                  leaders: 'Courtside leaders' }[kind] || 'Courtside';
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
    'background:' + (me.dataset.theme === 'light' ? '#ffffff' : '#04100b'),
    'color-scheme:' + (me.dataset.theme === 'light' ? 'light' : 'dark'),
    'border-radius:' + (me.dataset.radius || '4px'),
    'overflow:hidden'
  ].join(';');

  const target = me.dataset.into ? document.querySelector(me.dataset.into) : null;
  if (target) target.appendChild(frame);
  else me.parentNode.insertBefore(frame, me.nextSibling);

  /* Only listen to our own frame, from our own origin. A host page may hold
     several embeds and any number of unrelated frames; without both checks one
     of them could resize another. */
  const origin = new URL(base).origin;
  window.addEventListener('message', ev => {
    if (ev.origin !== origin) return;
    if (ev.source !== frame.contentWindow) return;
    const d = ev.data;
    if (!d || d.courtsideEmbed !== 'height') return;
    const h = Number(d.height);
    if (!isFinite(h) || h < 60 || h > 2000) return;   // never trust a posted number
    frame.style.height = Math.ceil(h) + 'px';
  });
})();
