'use strict';
/* ============================================================================
   THE CONTROL ROOM — what a director presses between plays.

   Two ways to use the same graphics, and both are first-class:

     LIVE  one browser source, opened with ?live=1, subscribed to a channel.
           This page publishes a scene name and the layer changes. One source in
           OBS, arranged once, and a director who never touches the mixer.

     FIXED every tile carries a plain URL. Point eight sources at eight
           addresses and never depend on this page being open at all.

   The clever path is the default and the dumb path is always available, because
   the dumb path is the one that still works when the hall's wifi does not. A
   control room that becomes a single point of failure for the graphics is worse
   than no control room.

   THE CHANNEL IS THE GAME. Two people can have this page open — a director in
   the hall and somebody at home — and the layer follows whoever pressed last,
   which is the same thing a hardware panel does.
   ============================================================================ */
(function () {

const qp = new URLSearchParams(location.search);
const CFG = window.EPINOIA_CONFIG || {};
const gameId = (qp.get('g') || qp.get('game') || '').trim();

const $ = s => document.querySelector(s);

/* Every graphic this platform can put on air. Described in the words a director
   would use, because "plusminus" is a field name and "who is winning the
   minutes" is a reason to press a button. */
const SCENES = [
  ['scorebug',  'Scorebug',        'Score, clock, period, team fouls and the bonus. The one that stays up.'],
  ['lower',     'Player lower third', 'The leading scorer on court, or a named player. Take it after a big shot.'],
  ['scorers',   'Top scorers',     'Both squads ranked by points. The default stoppage graphic.'],
  ['plusminus', 'Plus / minus',    'Who is actually winning their minutes — often not the top scorer.'],
  ['rebounds',  'Rebounds',        'Both squads ranked by total rebounds.'],
  ['assists',   'Assists',         'Both squads ranked by assists.'],
  ['lineups',   'Best lineups',    'Five-man units with four minutes together or more, by plus/minus.'],
  ['compare',   'Team comparison',  'Points, rebounds, assists, turnovers and fouls, side by side.'],
  ['final',     'Final score',     'The result, with crests. For the whistle.']
];

let current = qp.get('scene') || 'scorebug';
let sb = null, chan = null, joined = false;

/* ---- the URL a scene is served at ------------------------------------- */
function sceneURL(scene, live) {
  const p = new URLSearchParams();
  p.set('g', gameId);
  if (live) p.set('live', '1'); else p.set('scene', scene);
  p.set('pos', $('#pos').value);
  const sc = parseFloat($('#scale').value);
  if (sc && sc !== 1) p.set('scale', String(sc));
  const ch = $('#chroma').value.trim();
  if (ch) p.set('chroma', ch);
  if (!$('#safe').checked) p.set('safe', '0');
  return location.origin + '/epinoia/broadcast/?' + p.toString();
}

/* ---- publishing --------------------------------------------------------- */
/* Broadcast on the game's own channel, through the SDK — rt.js is deliberately
   receive-only (it is the reader the strip and the layer use, and giving it a
   send path would mean every embed carrying code it never runs). The layer
   listens with rt.js; this end is the only one that ever speaks.

   Publishing is best-effort by design: if the socket is down, the tiles still
   work as URLs and a production using fixed sources never noticed. */
async function connect() {
  if (!CFG.supabaseUrl || !window.epinoiaClient || !gameId) return;
  try {
    sb = await window.epinoiaClient();
    if (!sb) return;
    chan = sb.channel('bcast:' + gameId);
    chan.subscribe(st => { joined = (st === 'SUBSCRIBED'); paintLive(); });
  } catch (_) { /* the fixed URLs still work, which is the whole point */ }
}

function publish(scene) {
  if (!chan || !joined) return false;
  try {
    chan.send({ type: 'broadcast', event: 'scene', payload: {
      scene,
      pos: $('#pos').value,
      scale: parseFloat($('#scale').value) || 1,
      side: qp.get('side') || '0',
      at: Date.now()
    }});
    return true;
  } catch (_) { return false; }
}

function paintLive() {
  const tag = $('#liveTag');
  tag.classList.toggle('on', joined);
  tag.textContent = joined ? 'live layer connected' : 'live layer not connected';
}

/* ---- rendering ---------------------------------------------------------- */
function take(scene) {
  current = scene;
  publish(scene);
  $('#prev').src = sceneURL(scene, false);
  document.querySelectorAll('.tile').forEach(t =>
    t.classList.toggle('on', t.dataset.scene === scene));
  const u = new URL(location.href);
  u.searchParams.set('scene', scene);
  history.replaceState(null, '', u);
}

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';
  SCENES.forEach(([key, title, desc]) => {
    const tile = document.createElement('div');
    tile.className = 'tile' + (key === current ? ' on' : '');
    tile.dataset.scene = key;
    tile.innerHTML =
      '<div class="t">' + title + '</div>' +
      '<div class="d">' + desc + '</div>' +
      '<div class="u">' + sceneURL(key, false).replace(location.origin, '') + '</div>' +
      '<div class="row"><button data-act="take">take</button>' +
      '<button data-act="copy">copy url</button></div>';

    tile.addEventListener('click', e => {
      const act = e.target && e.target.dataset ? e.target.dataset.act : null;
      if (act === 'copy') {
        e.stopPropagation();
        const url = sceneURL(key, false);
        navigator.clipboard.writeText(url).then(
          () => { e.target.textContent = 'copied'; setTimeout(() => e.target.textContent = 'copy url', 1400); },
          () => { window.prompt('Copy this into your browser source:', url); });
        return;
      }
      take(key);
    });
    grid.appendChild(tile);
  });
  $('#how').innerHTML =
    '<b>One source, driven from here:</b> add a browser source at ' +
    '<code>' + sceneURL('scorebug', true).replace(location.origin, '') + '</code> ' +
    'and it will show whatever you take above.<br><br>' +
    '<b>Or one source per graphic:</b> copy any tile’s URL and point a source at it. ' +
    'Those never depend on this page being open — which is the version to use if ' +
    'the hall’s connection is unreliable.<br><br>' +
    'Set every source to <b>1920×1080</b> and let the mixer scale it. Tick ' +
    '“shutdown source when not visible” on anything you hide, so a ' +
    'graphic that is off screen is not holding a socket open for two hours.';
}

/* ---- boot --------------------------------------------------------------- */
(function boot() {
  if (!gameId) {
    $('#fx').textContent = 'no game — open this from a fixture';
    return;
  }
  $('#fx').textContent = gameId;

  ['#pos', '#scale', '#chroma', '#safe'].forEach(sel => {
    $(sel).addEventListener('change', () => { render(); take(current); });
  });

  render();
  $('#prev').src = sceneURL(current, false);
  connect();

  /* Name the fixture rather than its uuid, once the row arrives. A director
     with three games open needs to know which tab is which. */
  if (CFG.supabaseUrl) {
    fetch(CFG.supabaseUrl + '/rest/v1/games?id=eq.' + encodeURIComponent(gameId) +
      '&select=home:home_team_id(name),away:away_team_id(name),tipoff_at&limit=1',
      { headers: { apikey: CFG.supabaseAnonKey } })
      .then(r => r.json())
      .then(g => {
        if (!g || !g.length) return;
        const h = (g[0].home || {}).name || 'home', a = (g[0].away || {}).name || 'away';
        $('#fx').textContent = h + ' v ' + a;
        document.title = h + ' v ' + a + ' · broadcast control';
      })
      .catch(() => {});
  }
})();

})();
