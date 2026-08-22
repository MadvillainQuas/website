'use strict';
/* ============================================================================
   ON VIDEO — every play a player has made, across every game with footage.

   The box score's video tab answers "what happened in this game". This answers
   the other question, the one a profile is actually for: show me this player.
   Same arithmetic (epinoia/video.js), same look (epinoia/video.css), one
   difference that changes the whole shape of the thing — the list spans GAMES,
   so the player has to change source as the reader moves down it.

   THE LABELS ARE WRITTEN HERE RATHER THAN LIFTED FROM THE REPLAY, and that is
   a deliberate exception to the rule that engine.js owns the wording. Its lines
   are "T. Okafor — 3pt made", built for a play-by-play where the reader needs
   telling who did it. On a page whose heading is already that player's name,
   repeating it on all ninety rows is noise. So the subject is dropped and only
   the predicate is kept: "three-pointer made". Nothing else about the event is
   reinterpreted — the type and its tags come straight off the log.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPlayerVideo = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const V = () => (typeof globalThis !== 'undefined' ? globalThis : self).EpinoiaVideo;
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WORDS = {
  p3_made: 'three-pointer made',   p3_miss: 'three-pointer missed',
  p2_made: 'two-pointer made',     p2_miss: 'two-pointer missed',
  ft_made: 'free throw made',      ft_miss: 'free throw missed',
  ast: 'assist', stl: 'steal', blk: 'block', to: 'turnover',
  foul: 'foul', sub: 'substitution', timeout: 'timeout'
};
const FOULS = { shooting: 'shooting foul', offensive: 'offensive foul',
  floor: 'foul on the floor', tech: 'technical foul',
  unsport: 'unsportsmanlike foul', disq: 'disqualifying foul',
  personal: 'personal foul' };

function words(e) {
  if (e.t === 'reb') return (e.off ? 'offensive' : 'defensive') + ' rebound';
  if (e.t === 'foul') return FOULS[e.kind] || 'personal foul';
  return WORDS[e.t] || e.t;
}

let st = { filter: 'all', gameId: null, current: null, seekMs: 0 };
let host = null, ctx = null;
/* Indexed once per set of games, not once per glance. selected() is called by
   the render, by currentGame() and again inside every click handler, and each
   call was re-walking the whole log of every game the club has played. */
let indexed = null;

/* --------------------------------------------------------------- the list --- */
/* One flat list across every game with footage, newest game first — a profile
   is read most-recent-first, unlike a game, which is read start to finish. */
function allPlays() {
  if (indexed) return indexed;
  const out = [];
  ctx.games.forEach(g => {
    const mine = g.events.filter(e => e.pid === ctx.playerId);
    V().index(mine, g.video, {
      skipStructural: true,
      label: e => words(e) + (e.tag ? ' (' + e.tag + ')' : '')
    }).forEach(p => out.push(Object.assign({ game: g }, p)));
  });
  out.sort((a, b) => (new Date(b.game.date || 0) - new Date(a.game.date || 0)) ||
                     (a.ms - b.ms));
  indexed = out;
  return out;
}
function selected() {
  const fn = V().filterBy(st.filter);
  return allPlays().filter(p => fn(p) && (!st.gameId || p.game.id === st.gameId));
}

/* ------------------------------------------------------------- rendering --- */
function currentGame() {
  const list = selected();
  if (st.current != null) {
    const p = list.find(x => key(x) === st.current);
    if (p) return p.game;
  }
  return (list[0] && list[0].game) || ctx.games[0] || null;
}
/* A play id is only unique inside its own game, so the key has to carry both.
   Two games in this list will each have a seq 41 and they are not the same
   basket. */
const key = p => p.game.id + ':' + p.id;

/* THE PLAYER IS BUILT ONCE AND ONLY RE-SOURCED WHEN THE POSITION CHANGES.

   Rebuilding it with the rest of the panel reloads the iframe, which restarts
   the video — so choosing a filter while watching a basket threw the reader
   back to the start of the game. Here the source can also change legitimately,
   because this list spans games; the signature covers both. */
function stageHTML(g) {
  if (!g) return '';
  const src = V().embedSrc(g.video, { ms: st.seekMs, autoplay: st.current != null });
  if (!src) return '<div class="vidwarn">That video link cannot be played here.</div>';
  return '<iframe class="vidframe" src="' + esc(src) + '" ' +
    'allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen ' +
    'title="' + esc(g.title || 'Game video') + '"></iframe>';
}
function paintStage(g) {
  const stage = host.querySelector('.vidstage');
  if (!stage) return;
  const wanted = stageHTML(g);
  if (stage.dataset.sig === wanted) return;
  stage.dataset.sig = wanted;
  stage.innerHTML = wanted;
}

function render() {
  const list = selected();
  const g = currentGame();

  if (!host.querySelector('.vidbody')) {
    host.innerHTML = '<div class="vidwrap"><div class="vidstage"></div>' +
      '<div class="vidbody"></div></div>';
  }
  paintStage(g);
  host.querySelector('.vidbody').innerHTML =

      '<div class="vidbar">' +
        '<div class="vidchips">' + V().FILTERS.map(f =>
          '<button class="vidchip' + (st.filter === f.key ? ' on' : '') + '" ' +
          'data-f="' + f.key + '">' + esc(f.label) + '</button>').join('') + '</div>' +
        '<div class="vidpick"><select id="pvGame" class="ep-in">' +
          '<option value="">every game with video</option>' +
          ctx.games.map(x => '<option value="' + esc(x.id) + '"' +
            (st.gameId === x.id ? ' selected' : '') + '>' +
            esc(x.title) + '</option>').join('') +
        '</select></div>' +
      '</div>' +

      '<div class="vidcount">' + list.length + ' ' +
        (list.length === 1 ? 'play' : 'plays') + ' on video · tap one to watch it</div>' +

      '<ol class="vidlist">' + (list.length ? list.map(p =>
        '<li class="viditem' + (st.current === key(p) ? ' on' : '') + '" ' +
          'data-k="' + esc(key(p)) + '" role="button" tabindex="0"' +
          ' aria-label="' + esc(p.label + ', ' + p.game.title + ', at ' +
                              V().stamp(p.start) + ' in the video') + '"' +
          (st.current === key(p) ? ' aria-current="true"' : '') + '>' +
          '<span class="vidt">' + esc(V().stamp(p.start)) +
            (p.approx ? '<i class="vidapx" title="placed by hand — this position ' +
                        'is worked out from the plays either side">~</i>' : '') + '</span>' +
          '<span class="vidq">' + esc(p.game.title) + '</span>' +
          '<span class="vidtxt">' + esc(p.label) + '</span>' +
        '</li>').join('')
        : '<li class="viditem empty">Nothing matches that filter.</li>') +
      '</ol>' +

      (g ? '<div class="vidfoot">' +
        '<a href="../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase">' +
          'the full box score for this game →</a>' +
        '<span class="vidgap">' + esc(V().gapText(g.video)) + '</span>' +
      '</div>' : '');

  wire();
}

function wire() {
  host.querySelectorAll('.vidchip').forEach(b => {
    b.onclick = () => { st.filter = b.dataset.f; st.current = null; render(); };
  });
  const sel = host.querySelector('#pvGame');
  if (sel) sel.onchange = () => { st.gameId = sel.value || null; st.current = null; render(); };
  host.querySelectorAll('.viditem[data-k]').forEach(li => {
    li.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); }
    };
    li.onclick = () => {
      const p = selected().find(x => key(x) === li.dataset.k);
      if (!p) return;
      st.current = key(p); st.seekMs = p.start;
      render();          // paintStage inside it does the seek, once
      const on = host.querySelector('.viditem.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    };
  });
}

/* ------------------------------------------------------------------ api --- */
/* games: [{ id, title, date, video, events }] — only games that actually have
   a video row, filtered by the caller, because "no footage" is a state this
   panel should never have to render. */
function render_(opts) {
  host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host || !V()) return false;
  /* Only games that have footage, an anchor, AND a log whose timestamps mean
     when things happened. A bulk-imported season passes the first two and
     would fill this panel with ninety plays all sitting on the same frame. */
  const games = (opts.games || []).filter(g =>
    g.video && V().hasAnchor(g.video) && V().logIsTimed(g.events));
  if (!games.length) return false;
  ctx = { games, playerId: opts.playerId };
  indexed = null;
  if (!allPlays().length) return false;
  render();
  return true;
}

return { render: render_ };
}));
