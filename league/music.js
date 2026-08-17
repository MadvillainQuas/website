'use strict';
/* ============================================================================
   THE SPLASH'S TRACK — a SoundCloud embed in the top right, on loop.

   THIS IS THE ONE THIRD-PARTY SCRIPT ON THE PAGE, and it is worth being
   explicit about, because the socials sections on the league page deliberately
   avoid Instagram's embed script for exactly the reasons that apply here:
   somebody else's JavaScript, on a page we ship, changeable without notice.

   The difference is that there is no other way to LOOP. SoundCloud's iframe
   accepts auto_play and a dozen appearance parameters and has never had a loop
   one; looping means listening for the widget's FINISH event and seeking back
   to zero, and that means their Widget API. The alternative is talking to the
   iframe over postMessage using an undocumented protocol, which is a worse
   dependency than a supported wrapper — it just looks like less of one.

   So it is scoped as tightly as it can be:
     · the script is added to the CSP for w.soundcloud.com ONLY, nothing wider
     · it is injected by THIS FILE, which only runs on the splash — the league
       page shares the document and never loads it
     · nothing here reads or writes anything of ours; it holds one iframe

   AUTOPLAY WILL BE BLOCKED, and that is correct behaviour rather than a bug to
   work around. Every current browser refuses to start audio before the visitor
   has interacted with the page, and a landing page that found a way round that
   would deserve the reputation it got. So: auto_play is requested (it works
   where the browser already trusts the site, e.g. a return visit that has
   played before), and otherwise the first click or key press anywhere starts
   it. The widget's own play button is right there either way.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMusic = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const TRACK = 'https://soundcloud.com/jxhxstutqmco/nitsua-carriage-twoots-remix';
const API = 'https://w.soundcloud.com/player/api.js';

/* The widget's own parameters. Everything social is off: this is a piece of
   the page's furniture, not an invitation to go and read the comments. The
   colour is the pool's deep water, so the one thing on screen we do not draw
   ourselves still belongs to it. */
const PARAMS = [
  'url=' + encodeURIComponent(TRACK),
  'color=%234ea6c6',
  'auto_play=true',
  'hide_related=true',
  'show_comments=false',
  'show_user=false',
  'show_reposts=false',
  'show_teaser=false',
  'visual=false'
].join('&');

let started = false;

function mount(host) {
  const box = typeof host === 'string' ? document.querySelector(host) : host;
  if (!box) return null;
  box.textContent = '';

  const frame = document.createElement('iframe');
  frame.className = 'sc-frame';
  frame.title = 'Nitsua — Carriage (Twoots remix) on SoundCloud';
  frame.src = 'https://w.soundcloud.com/player/?' + PARAMS;
  frame.allow = 'autoplay';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('frameborder', 'no');
  frame.loading = 'eager';
  box.appendChild(frame);

  loadApi(() => wire(frame));
  return frame;
}

/* One script tag, once, and it resolves whether or not it was already there —
   the splash can be re-mounted by the auth listener and a second copy of
   somebody else's library is how a page ends up with two widgets fighting. */
function loadApi(done) {
  if (window.SC && window.SC.Widget) return done();
  const existing = document.querySelector('script[data-sc-api]');
  if (existing) { existing.addEventListener('load', done); return; }
  const s = document.createElement('script');
  s.src = API;
  s.async = true;
  s.dataset.scApi = '1';
  s.addEventListener('load', done);
  s.addEventListener('error', () => {
    /* No API means no loop, and the embed still plays once. A silent partial
       failure is worse than a short line in the console for whoever is
       wondering why it stopped after four minutes. */
    console.warn('SoundCloud widget API did not load — the track will not loop.');
  });
  document.head.appendChild(s);
}

function wire(frame) {
  if (!window.SC || !window.SC.Widget) return;
  const w = SC.Widget(frame);

  w.bind(SC.Widget.Events.READY, () => {
    /* Requested, and expected to be refused. Where it IS allowed the track is
       already going by the time anybody reads the title. */
    w.play();
  });

  /* THE LOOP. seekTo(0) then play(), rather than relying on a parameter that
     does not exist. Both are needed: a finished widget is paused AND at the
     end, and seeking alone leaves it sitting there. */
  w.bind(SC.Widget.Events.FINISH, () => {
    w.seekTo(0);
    w.play();
  });

  w.bind(SC.Widget.Events.PLAY, () => { started = true; });

  /* The fallback for every browser that blocked the autoplay: the first thing
     the visitor does, whatever it is. once:true, and it does not swallow the
     event — the click still does whatever it was going to do. */
  const kick = () => {
    if (started) return;
    w.play();
  };
  ['pointerdown', 'keydown'].forEach(ev =>
    window.addEventListener(ev, kick, { once: true, passive: true }));
}

return { mount, TRACK };
}));
