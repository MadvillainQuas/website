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
  /* PRE-GAME FIRST, because the twenty minutes before tip is when a stream is
     actually looking for something to show, and it is the half the platform
     was not serving at all. */
  ['fixture',   'pre',  'Fixture card',      'Who, where and when. What a stream sits on while people arrive.'],
  ['starters',  'pre',  'Starting fives',    'Both fives with faces — or both squads, until the fives are picked.'],
  ['lineup',    'pre',  'Squad — home',      'One club’s full squad, in shirt order, with faces.', { side: '0' }],
  ['lineup',    'pre',  'Squad — away',      'The other club’s squad.', { side: '1' }],
  ['officials', 'pre',  'Match officials',   'The court crew and the table crew, as named on the fixture.'],

  ['scorebug',  'live', 'Scorebug',          'Score, clock, period, team fouls and the bonus. The one that stays up.'],
  ['lower',     'live', 'Player lower third','The leading scorer on court, or a named player. Take it after a big shot.'],
  ['scorers',   'live', 'Top scorers',       'Both squads ranked by points. The default stoppage graphic.'],
  ['plusminus', 'live', 'Plus / minus',      'Who is actually winning their minutes — often not the top scorer.'],
  ['rebounds',  'live', 'Rebounds',          'Both squads ranked by total rebounds.'],
  ['assists',   'live', 'Assists',           'Both squads ranked by assists.'],
  ['lineups',   'live', 'Best lineups',      'Five-man units with four minutes together or more, by plus/minus.'],
  ['compare',   'live', 'Team comparison',   'Points, rebounds, assists, turnovers and fouls, side by side.'],
  ['final',     'post', 'Final score',       'The result, with crests. For the whistle.']
];

const GROUPS = [
  ['pre',  'Before tip',  'These work now — the squads, the officials and the fixture are all recorded before a ball is thrown.'],
  ['live', 'During play', 'Driven by the event log as the statistician scores.'],
  ['post', 'After',       '']
];

/* A tile's identity is its scene AND its options: two squad screens are the
   same scene with a different side, and they must not fight over which one is
   "on". */
const keyOf = (scene, opts) => scene + (opts && opts.side ? ':' + opts.side : '');

let sb = null, chan = null, joined = false;

/* ---- the URL a scene is served at ------------------------------------- */
function sceneURL(scene, live, opts) {
  const p = new URLSearchParams();
  p.set('g', gameId);
  if (live) p.set('live', '1'); else p.set('scene', scene);
  if (opts && opts.side) p.set('side', opts.side);
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

function publish(scene, opts) {
  if (!chan || !joined) return false;
  try {
    chan.send({ type: 'broadcast', event: 'scene', payload: {
      scene,
      pos: $('#pos').value,
      scale: parseFloat($('#scale').value) || 1,
      side: (opts && opts.side) || '0',
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
let currentKey = qp.get('scene') || 'scorebug';

function take(scene, opts) {
  currentKey = keyOf(scene, opts);
  publish(scene, opts);
  mxTake(currentKey);
  $('#prev').src = sceneURL(scene, false, opts);
  document.querySelectorAll('.tile').forEach(t =>
    t.classList.toggle('on', t.dataset.key === currentKey));
  const u = new URL(location.href);
  u.searchParams.set('scene', currentKey);
  history.replaceState(null, '', u);
}

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';

  GROUPS.forEach(([g, title, note]) => {
    const rows = SCENES.filter(x => x[1] === g);
    if (!rows.length) return;

    const head = document.createElement('div');
    head.className = 'grouphd';
    head.innerHTML = '<span>' + title + '</span>' + (note ? '<i>' + note + '</i>' : '');
    grid.appendChild(head);

    const band = document.createElement('div');
    band.className = 'band';
    rows.forEach(([key, , title2, desc, opts]) => {
      const k = keyOf(key, opts);
      const tile = document.createElement('div');
      tile.className = 'tile' + (k === currentKey ? ' on' : '');
      tile.dataset.key = k;
      tile.innerHTML =
        '<div class="t">' + title2 + '</div>' +
        '<div class="d">' + desc + '</div>' +
        '<div class="row"><button data-act="take">take</button>' +
        '<button data-act="copy">copy url</button></div>';
      tile.addEventListener('click', e => {
        const act = e.target && e.target.dataset ? e.target.dataset.act : null;
        if (act === 'copy') {
          e.stopPropagation();
          const url = sceneURL(key, false, opts);
          navigator.clipboard.writeText(url).then(
            () => { e.target.textContent = 'copied';
                    setTimeout(() => { e.target.textContent = 'copy url'; }, 1400); },
            () => window.prompt('Copy this into your browser source:', url));
          return;
        }
        take(key, opts);
      });
      band.appendChild(tile);
    });
    grid.appendChild(band);
  });

  $('#how').innerHTML =
    '<b>One source, driven from here:</b> add a browser source at ' +
    '<code>' + sceneURL('scorebug', true).replace(location.origin, '') + '</code> ' +
    'and it will show whatever you take above.<br><br>' +
    '<b>Or one source per graphic:</b> use the export buttons, or copy any ' +
    'tile&rsquo;s URL. Those never depend on this page being open &mdash; which ' +
    'is the version to use if the connection in the hall is unreliable.';
}

/* ==========================================================================
   EXPORT — into whatever the production actually runs.

   "Integrate with your broadcasting application" comes down to one of two
   things, and neither of them is an API: either the mixer reads a scene file,
   or somebody pastes URLs into it. Driving OBS over its websocket would mean a
   password, a port, a plugin version and a machine on the same network — four
   things to go wrong in a sports hall, to save a one-off import.

   So this writes the file. An OBS scene collection is plain JSON and importing
   one is two clicks; vMix reads an XML preset the same way. Every source comes
   out at 1920x1080, named after the graphic, with the scorebug visible and
   everything else hidden — so a director opens the mixer and the rundown is
   already laid out in the order they will call it.
   ========================================================================== */
function obsCollection() {
  const sources = SCENES.map(([key, , title, , opts]) => ({
    prev_ver: 503316482,
    name: 'Epinoia · ' + title,
    id: 'browser_source',
    versioned_id: 'browser_source',
    settings: {
      url: sceneURL(key, false, opts),
      width: 1920, height: 1080, fps: 30, fps_custom: false,
      reroute_audio: false, restart_when_active: true,
      /* a hidden layer must not hold a socket open for two hours */
      shutdown: true,
      css: ''
    }
  }));

  const items = SCENES.map(([key, , title, , opts], i) => ({
    name: 'Epinoia · ' + title,
    /* the scorebug is the one that lives on screen; everything else starts
       hidden and is revealed when the director wants it */
    visible: keyOf(key, opts) === 'scorebug',
    locked: false, rot: 0.0,
    pos: { x: 0.0, y: 0.0 }, scale: { x: 1.0, y: 1.0 },
    align: 5, bounds_type: 0, bounds_align: 0,
    bounds: { x: 0.0, y: 0.0 },
    id: i + 1
  }));

  return {
    name: 'Epinoia — ' + (document.title.split(' · ')[0] || 'broadcast'),
    current_scene: 'Epinoia graphics',
    current_program_scene: 'Epinoia graphics',
    scene_order: [{ name: 'Epinoia graphics' }],
    sources: sources.concat([{
      prev_ver: 503316482,
      name: 'Epinoia graphics',
      id: 'scene', versioned_id: 'scene',
      settings: { custom_size: false, id_counter: SCENES.length, items }
    }])
  };
}

/* vMix reads an XML preset. ONLY the inputs are written — a preset describing
   the whole production would overwrite the cameras, which is a thing you do to
   somebody once. */
function vmixPreset() {
  const x = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<?xml version="1.0" encoding="utf-8"?>\n<preset>\n  <inputs>\n' +
    SCENES.map(([key, , title, , opts]) =>
      '    <input type="Browser" title="' + x('Epinoia · ' + title) + '">\n' +
      '      <browser url="' + x(sceneURL(key, false, opts)) + '" ' +
      'width="1920" height="1080" />\n    </input>').join('\n') +
    '\n  </inputs>\n</preset>\n';
}

/* And a plain list, for CasparCG, Singular, a hardware panel, or anything else
   that takes a URL. Everything here is a URL underneath. */
function urlList() {
  return '# Epinoia broadcast graphics\n' +
    '# ' + (document.title.split(' · ')[0] || '') + '\n' +
    '# Set every browser source to 1920x1080.\n\n' +
    SCENES.map(([key, group, title, , opts]) =>
      '# ' + title + '  (' + group + ')\n' + sceneURL(key, false, opts)).join('\n\n') +
    '\n\n# One source, switched from the control room\n' + sceneURL('scorebug', true) + '\n';
}

/* ==========================================================================
   DRIVING THE MIXER.

   The exports lay the sources out once. This keeps hold of the connection, so
   pressing take here shows the graphic in OBS as well as on the live layer —
   which is the difference between a control room and a bookmark folder.

   The settings live in localStorage per machine, because a password typed
   before every game is a password written on a post-it instead.
   ========================================================================== */
const SCENE_NAME = 'Epinoia graphics';
const MX_KEY = 'epinoia_mixer';

let mx = null, mxKind = null;

const mxSay = (text, cls) => {
  const el = $('#mxState');
  el.textContent = text;
  el.className = 'mxstate' + (cls ? ' ' + cls : '');
};

const graphicsList = () => SCENES.map(([key, , title, , opts]) => ({
  name: 'Epinoia · ' + title,
  url: sceneURL(key, false, opts),
  visible: keyOf(key, opts) === 'scorebug',
  key: keyOf(key, opts)
}));

function mxRemember() {
  try {
    localStorage.setItem(MX_KEY, JSON.stringify({
      kind: $('#mxKind').value, host: $('#mxHost').value,
      port: $('#mxPort').value, pass: $('#mxPass').value
    }));
  } catch (_) { /* a private window simply retypes it */ }
}

function mxRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(MX_KEY) || 'null'); } catch (_) {}
  if (saved) {
    $('#mxKind').value = saved.kind || 'obs';
    $('#mxHost').value = saved.host || 'localhost';
    $('#mxPort').value = saved.port || (saved.kind === 'vmix' ? '8088' : '4455');
    $('#mxPass').value = saved.pass || '';
  }
  mxKindChanged();
}

/* The two products need different things, and asking vMix for a password is
   how somebody concludes the whole feature is broken. */
function mxKindChanged() {
  const kind = $('#mxKind').value;
  const isObs = kind === 'obs';
  $('#mxPass').style.display = isObs ? '' : 'none';
  if (!$('#mxPort').dataset.touched) $('#mxPort').value = isObs ? '4455' : '8088';
  $('#mxNote').innerHTML = isObs
    ? 'In OBS: <b>Tools &rarr; WebSocket Server Settings</b>, tick <b>Enable</b>, ' +
      'and copy the password in. Nothing to install — it has been built in since ' +
      'OBS 28.'
    : 'In vMix: <b>Settings &rarr; Web Controller</b>, tick <b>Enable</b>. vMix ' +
      'answers without CORS headers, so this page can send commands but cannot ' +
      'read the reply — it will say a command was <b>sent</b> rather than claim ' +
      'it worked.';
}

async function mxConnect() {
  const kind = $('#mxKind').value;
  const host = $('#mxHost').value.trim() || 'localhost';
  const port = parseInt($('#mxPort').value, 10) || (kind === 'obs' ? 4455 : 8088);
  mxRemember();

  if (mx && mx.close) { try { mx.close(); } catch (_) {} }
  mx = null; mxKind = kind;
  $('#mxLayout').disabled = true;

  if (kind === 'vmix') {
    /* Nothing to connect to: vMix has no handshake and no readable reply. The
       honest thing is to say so rather than draw a green light. */
    mx = window.EpinoiaMixers.vmix(host, port);
    mxSay('sending to vMix', 'on');
    $('#mxLayout').disabled = false;
    return;
  }

  mxSay('connecting…');
  const client = window.EpinoiaMixers.obs();
  try {
    await client.connect({ host, port, password: $('#mxPass').value,
      onStatus: s => { if (s === 'closed' && mx === client) {
        mxSay('disconnected', 'bad'); $('#mxLayout').disabled = true; } } });
    mx = client;
    mxSay('OBS connected', 'on');
    $('#mxLayout').disabled = false;
  } catch (err) {
    mxSay('not connected', 'bad');
    $('#mxNote').innerHTML = '<b>' + String((err && err.message) || err) + '</b><br>' +
      'Everything still works without this — every graphic below is a URL, and ' +
      'the live layer still switches from here.';
  }
}

async function mxLayout() {
  if (!mx) return;
  const list = graphicsList();
  $('#mxLayout').disabled = true;
  try {
    if (mxKind === 'vmix') {
      if (!confirm('Add ' + list.length + ' browser inputs to vMix?\n\n' +
                   'vMix cannot tell this page what it already has, so running ' +
                   'this twice adds them twice.')) { $('#mxLayout').disabled = false; return; }
      await mx.layout(list);
      mxSay('inputs sent to vMix', 'on');
    } else {
      await mx.layout(SCENE_NAME, list, msg => mxSay(msg));
      mxSay('OBS connected', 'on');
      $('#mxNote').innerHTML = 'Built <b>' + list.length + '</b> sources in a scene ' +
        'called <b>' + SCENE_NAME + '</b>. Running this again updates them rather ' +
        'than adding a second set.';
    }
  } catch (err) {
    mxSay('failed', 'bad');
    $('#mxNote').innerHTML = '<b>' + String((err && err.message) || err) + '</b>';
  } finally { $('#mxLayout').disabled = false; }
}

/* Called by take(). Deliberately silent on failure: a director pressing take
   wants the graphic, and the live layer has already changed — an alert about
   OBS in the middle of a game helps nobody. */
function mxTake(key) {
  if (!mx || !$('#mxDrive').checked) return;
  const list = graphicsList();
  const want = list.find(g => g.key === key);
  if (!want) return;
  try {
    if (mxKind === 'vmix') mx.take(want.name);
    else mx.take(SCENE_NAME, want.name, list.map(g => g.name));
  } catch (_) { /* the layer changed regardless */ }
}

function wireMixer() {
  $('#mxKind').addEventListener('change', mxKindChanged);
  $('#mxPort').addEventListener('input', () => { $('#mxPort').dataset.touched = '1'; });
  $('#mxConnect').addEventListener('click', mxConnect);
  $('#mxLayout').addEventListener('click', mxLayout);
  mxRestore();
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function wireExports() {
  const base = (document.title.split(' · ')[0] || 'epinoia')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'epinoia';
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('#expObs', () => download(base + '-obs-scenes.json',
      JSON.stringify(obsCollection(), null, 2), 'application/json'));
  on('#expVmix', () => download(base + '-vmix.xml', vmixPreset(), 'application/xml'));
  on('#expUrls', () => download(base + '-graphics.txt', urlList()));
}

/* ---- boot --------------------------------------------------------------- */
(function boot() {
  if (!gameId) {
    $('#fx').textContent = 'no game — open this from a fixture';
    return;
  }
  $('#fx').textContent = gameId;

  ['#pos', '#scale', '#chroma', '#safe'].forEach(sel => {
    $(sel).addEventListener('change', () => {
      render();
      const [sc, sd] = currentKey.split(':');
      take(sc, sd ? { side: sd } : null);
    });
  });

  render();
  wireExports();
  wireMixer();
  const [sc0, sd0] = currentKey.split(':');
  $('#prev').src = sceneURL(sc0, false, sd0 ? { side: sd0 } : null);
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
