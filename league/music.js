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

   ---------------------------------------------------------------------------
   IT CARRIES ACROSS A NAVIGATION, and it is worth being precise about what
   that can and cannot mean.

   A full page load destroys the iframe, so nothing literally keeps playing.
   What can happen is that the next page picks the track up where the last one
   dropped it — so the position and the fact that it was playing are written to
   sessionStorage as it goes, and a page that finds that record seeks there and
   resumes. sessionStorage rather than local: it is per tab and dies with the
   tab, which is exactly the lifetime of "this visit".

   ARRIVING DIRECTLY DOES NOT START ANYTHING. No record means no autoplay
   request in the widget's URL and no play() call — somebody who opened the
   countries page from a link never asked for music, and a page that starts it
   anyway is the thing everybody hates. Only the splash asks unprompted, and
   only the splash carries the first-interaction fallback.

   AND THE RESUME MAY STILL BE REFUSED. User activation does not survive a
   navigation; what makes this work in practice is Chrome's media engagement
   heuristic, which grants autoplay on an origin the visitor has already played
   media on. Safari and Firefox are stricter and will often want the play
   button pressed again. The position is still restored, so pressing it
   continues rather than restarts, which is the part that matters.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMusic = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const TRACK = 'https://soundcloud.com/jxhxstutqmco/nitsua-carriage-twoots-remix';
const API = 'https://w.soundcloud.com/player/api.js';
const STATE = 'epinoia.track';

/* How much of the gap between pages to make up. Adding the wall-clock time
   spent navigating is what makes the resume feel continuous rather than like a
   rewind — but only for a gap that IS a navigation. A tab left in the
   background for an hour would otherwise resume an hour further on, which is
   not continuity, it is a different part of the track. */
const GAP_CAP_MS = 5000;

function readState() {
  try {
    const raw = sessionStorage.getItem(STATE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.pos !== 'number') return null;
    return s;
  } catch (_) { return null; }
}

function writeState(playing, pos) {
  try {
    sessionStorage.setItem(STATE, JSON.stringify({
      playing: !!playing, pos: Math.max(0, pos | 0), at: Date.now()
    }));
  } catch (_) { /* private mode with storage blocked: the feature just stops */ }
}

/* The widget's own parameters. Everything social is off: this is a piece of
   the page's furniture, not an invitation to go and read the comments. The
   colour is the pool's deep water, so the one thing on screen we do not draw
   ourselves still belongs to it.

   auto_play IS A PARAMETER OF THE CALL, not a constant, because whether this
   page may start playing on its own is the caller's decision and not the
   widget's. */
function params(autoplay) {
  return [
    'url=' + encodeURIComponent(TRACK),
    'color=%234ea6c6',
    'auto_play=' + (autoplay ? 'true' : 'false'),
    'hide_related=true',
    'show_comments=false',
    'show_user=false',
    'show_reposts=false',
    'show_teaser=false',
    'visual=false'
  ].join('&');
}

let started = false;

/* opts: { autoplay, kickOnInteraction }
     autoplay          may this page start the track without being asked?
                       The splash: yes. Anywhere else: only if the track was
                       already playing when the visitor left the last page.
     kickOnInteraction start it on the first click if the browser refused the
                       autoplay. The splash only — on a later page a click was
                       almost certainly meant for something else. */
function mount(host, opts) {
  const box = typeof host === 'string' ? document.querySelector(host) : host;
  if (!box) return null;
  const o = opts || {};
  const prior = readState();

  /* THE RESUME DECIDES ITSELF. A page that was not told it may autoplay still
     resumes if the record says the track was playing a moment ago, because
     that is not this page starting something — it is the last page's music
     not being interrupted by a navigation. */
  const carry = !!(prior && prior.playing);
  const wantPlay = !!o.autoplay || carry;

  box.textContent = '';
  const frame = document.createElement('iframe');
  frame.className = 'sc-frame';
  frame.title = 'Nitsua — Carriage (Twoots remix) on SoundCloud';
  frame.src = 'https://w.soundcloud.com/player/?' + params(wantPlay);
  frame.allow = 'autoplay';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('frameborder', 'no');
  frame.loading = 'eager';
  box.appendChild(frame);

  loadApi(() => wire(frame, {
    wantPlay,
    resumeAt: carry ? resumePosition(prior) : null,
    kick: !!o.kickOnInteraction
  }));
  return frame;
}

/* Where to pick the track up: where it stopped, plus however long the
   navigation took, capped so a backgrounded tab does not skip forward. */
function resumePosition(prior) {
  const gap = Math.min(Math.max(0, Date.now() - (prior.at || 0)), GAP_CAP_MS);
  return Math.max(0, (prior.pos | 0) + gap);
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

function wire(frame, cfg) {
  if (!window.SC || !window.SC.Widget) return;
  const w = SC.Widget(frame);
  const c = cfg || {};

  /* SEEK, THEN PLAY, ONCE — and NOT from READY alone.

     READY DOES NOT FIRE FOR A LATE BIND. That is the whole bug, and it is
     invisible on a page that has the API script cached: there, SC.Widget is
     available immediately, the handler is bound before the widget is ready,
     and the seek lands. On a fresh page load the script is fetched, the iframe
     gets there first, READY has already gone by the time wire() binds — so the
     seek never ran and auto_play started the track from zero. Measured: the
     resume landed at 18s when it should have been at 92s, and a probe bound
     after the fact confirmed READY never came.

     So both orders are covered. getDuration is the readiness probe: if the
     widget is already up it answers immediately and the resume happens now; if
     it is not, the callback does not come and READY does it instead. One flag
     means whichever wins, it happens exactly once. */
  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    if (c.resumeAt != null) w.seekTo(c.resumeAt);
    if (c.wantPlay) w.play();
  };
  w.bind(SC.Widget.Events.READY, resume);
  try { w.getDuration(d => { if (d) resume(); }); } catch (_) { /* READY will */ }

  /* THE LOOP. seekTo(0) then play(), rather than relying on a parameter that
     does not exist. Both are needed: a finished widget is paused AND at the
     end, and seeking alone leaves it sitting there. */
  w.bind(SC.Widget.Events.FINISH, () => {
    w.seekTo(0);
    w.play();
    writeState(true, 0);
  });

  w.bind(SC.Widget.Events.PLAY, () => { started = true; });
  w.bind(SC.Widget.Events.PAUSE, () => {
    /* A DELIBERATE PAUSE MUST NOT BE UNDONE by the next page. The position is
       kept — pressing play there continues rather than restarts — but the
       playing flag goes, so nothing resumes on its own. */
    w.getPosition(p => writeState(false, p));
  });

  /* The record that lets the next page pick it up. Throttled: PLAY_PROGRESS
     fires several times a second and sessionStorage is synchronous, so writing
     every tick would be a small, pointless tax on the main thread. */
  let lastWrite = 0;
  w.bind(SC.Widget.Events.PLAY_PROGRESS, (e) => {
    const pos = e && typeof e.currentPosition === 'number' ? e.currentPosition : null;
    if (pos == null) return;
    const now = Date.now();
    if (now - lastWrite < 900) return;
    lastWrite = now;
    writeState(true, pos);
  });

  /* And once more on the way out, so the last second before a navigation is
     not lost to the throttle. pagehide rather than beforeunload: it is the one
     that fires on iOS and on a back-forward-cache eviction. */
  window.addEventListener('pagehide', () => {
    if (!started) return;
    w.getPosition(p => writeState(true, p));
  });

  /* The fallback for every browser that blocked the autoplay — the splash
     only. On a later page the first click was almost certainly meant for
     something else, and starting music out of it would be a page taking a
     liberty with an action aimed elsewhere. */
  if (c.kick) {
    const kick = () => { if (!started) w.play(); };
    ['pointerdown', 'keydown'].forEach(ev =>
      window.addEventListener(ev, kick, { once: true, passive: true }));
  }
}


return { mount, TRACK, readState, writeState };
}));
