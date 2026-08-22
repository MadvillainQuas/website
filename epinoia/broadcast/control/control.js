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
/* Everything written into a note goes through this. A scene URL carries the
   game id and whatever the operator typed into the chroma field, and a page
   that builds HTML out of either without escaping is one paste away from
   rewriting its own controls. */
const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Every graphic this platform can put on air. Described in the words a director
   would use, because "plusminus" is a field name and "who is winning the
   minutes" is a reason to press a button. */
const SCENES = [
  /* PRE-GAME FIRST, because the twenty minutes before tip is when a stream is
     actually looking for something to show, and it is the half the platform
     was not serving at all. */
  ['fixture',   'pre',  'Fixture card',      'Who, where and when. What a stream sits on while people arrive.'],
  ['five',      'pre',  'Starting five — home', 'Full frame. The five, standing, with the club on the rail.', { side: '0' }],
  ['five',      'pre',  'Starting five — away', 'The other club, same treatment.', { side: '1' }],
  ['starters',  'pre',  'Starting fives',    'Both fives with faces — or both squads, until the fives are picked.'],
  ['squad',     'pre',  'Squad — home',      'The whole squad, in shirt order. Works before the fives are picked.', { side: '0' }],
  ['squad',     'pre',  'Squad — away',      'The other club’s squad.', { side: '1' }],
  ['bench',     'pre',  'Bench — home',      'Only the players not starting. Needs the fives picked first.', { side: '0' }],
  ['bench',     'pre',  'Bench — away',      'The other club’s bench.', { side: '1' }],
  ['officials', 'pre',  'Match officials',   'The court crew and the table crew, as named on the fixture.'],

  ['scorebug',  'live', 'Scorebug',          'Score, clock, period, team fouls and the bonus. The one that stays up.'],
  ['lower',     'live', 'Player lower third','The leading scorer on court, or a named player. Take it after a big shot.'],
  ['scorers',   'live', 'Top scorers',       'Both squads ranked by points. The default stoppage graphic.'],
  ['plusminus', 'live', 'Plus / minus',      'Who is actually winning their minutes — often not the top scorer.'],
  ['rebounds',  'live', 'Rebounds',          'Both squads ranked by total rebounds.'],
  ['assists',   'live', 'Assists',           'Both squads ranked by assists.'],
  ['index',     'live', 'Index leaders',     'FIBA valuation — everything that helped minus everything that did not. Often disagrees with the points column, which is the point of showing it.'],
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

/* Take nothing. The layer renders an empty scene; a driven mixer hides every
   source it owns. Both paths, because a gallery running OBS still wants one
   button that means "clean" rather than a hunt for the visible eyeball. */
async function clearAir() {
  currentKey = 'blank';
  publish('blank', null);
  document.querySelectorAll('.tile').forEach(t => t.classList.remove('on'));
  $('#prev').src = sceneURL('blank', false, null);
  if (mx && mx.drives && $('#mxDrive') && $('#mxDrive').checked) {
    try {
      if (mxKind === 'vmix') await mx.clearAll();
      else await mx.take(SCENE_NAME, null, graphicsList().map(g => g.name));
    } catch (_) { /* the layer went clean regardless, which is the point */ }
  }
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
  paintReady();

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
  /* The single-source input goes in FIRST, so it is input 1 in vMix and the
     obvious one to put on an overlay channel. A production that wants the
     twelve individual inputs has them underneath; a production that wants one
     source switched from the control room has it at the top of the list. */
  const inputs = [
    '    <!-- One source, switched from the Epinoia control room. Put this on\n' +
    '         overlay channel 1 and leave it there. -->\n' +
    '    <input type="Browser" title="' + x('Epinoia · live layer') + '">\n' +
    '      <browser url="' + x(sceneURL('scorebug', true)) + '" ' +
    'width="1920" height="1080" />\n    </input>'
  ].concat(SCENES.map(([key, , title, , opts]) =>
    '    <input type="Browser" title="' + x('Epinoia · ' + title) + '">\n' +
    '      <browser url="' + x(sceneURL(key, false, opts)) + '" ' +
    'width="1920" height="1080" />\n    </input>'));
  return '<?xml version="1.0" encoding="utf-8"?>\n<preset>\n  <inputs>\n' +
    inputs.join('\n') + '\n  </inputs>\n</preset>\n';
}

/* ---- Wirecast, and every other mixer without an API ----------------------
   A SHEET OF PAPER, because that is what the situation actually calls for.

   Wirecast cannot be driven from a web page and does not need to be: one Web
   Page shot pointing at the live layer, and every take in this control room
   reaches it over the socket. But somebody has to set that shot up, in a hall,
   probably on a laptop that is also running the stream — so the instructions
   have to survive being read away from this screen.

   The full URL list is included underneath rather than only the single one.
   A production that would rather have twelve shots and switch them in Wirecast
   is a perfectly good production; it just does not get take-follows-mixer. */
function wirecastSheet() {
  const line = '-'.repeat(72);
  const one = sceneURL('scorebug', true);
  return [
    'EPINOIA GRAPHICS — WIRECAST SETUP',
    (document.title.split(' · ')[0] || ''),
    line,
    '',
    'THE SHORT VERSION',
    '  Add ONE Web Page shot with the URL under "THE ONE URL" below.',
    '  Leave it live on your top layer for the whole game.',
    '  Every "take" in the Epinoia control room changes what it shows.',
    '  Nothing else to press in Wirecast, and nothing to install.',
    '',
    line,
    'STEP BY STEP',
    '',
    '  1. In Wirecast, choose a layer to keep graphics on — layer 1 or 2,',
    '     above your cameras.',
    '  2. Click the + under that layer and choose Web Page.',
    '  3. Paste the URL from "THE ONE URL" below.',
    '  4. Set the size to 1920 x 1080.',
    '  5. Leave the background transparent. The page draws nothing at all when',
    '     no graphic is on air, so this shot can sit over your camera all night.',
    '  6. Make the shot live and leave it live.',
    '',
    '  That is the whole setup. Switching is done from the control room in a',
    '  browser, not from Wirecast.',
    '',
    line,
    'THE ONE URL',
    '',
    '  ' + one,
    '',
    line,
    'IF YOU WOULD RATHER HAVE ONE SHOT PER GRAPHIC',
    '',
    '  Every graphic is also its own URL. Add them as separate Web Page shots',
    '  and switch them in Wirecast as you would any other shot. You lose',
    '  take-follows-mixer — the control room cannot tell Wirecast anything —',
    '  and you gain Wirecast transitions and hotkeys on each one.',
    '',
    SCENES.map(([key, group, title, , opts]) =>
      '  ' + title + '  (' + group + ')\n    ' + sceneURL(key, false, opts)).join('\n\n'),
    '',
    line,
    'TROUBLESHOOTING',
    '',
    '  Nothing appears when I press take',
    '    Check the tag at the top of the control room says "live layer',
    '    connected". If it does not, the socket is down: the individual URLs',
    '    above still work, switched in Wirecast.',
    '',
    '  The graphic is there but the wrong game',
    '    The game id is in the URL. One URL per fixture — re-copy it from the',
    '    control room for the game you are actually covering.',
    '',
    '  It shows a white box instead of nothing',
    '    The shot is not transparent. Wirecast: shot properties, and make sure',
    '    no background colour is set behind the Web Page shot.',
    ''
  ].join('\n');
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

/* WHAT EACH PRODUCT ACTUALLY OFFERS, said before anybody presses anything.

   These three are not three flavours of the same integration. OBS has a real
   bidirectional API; vMix has a one-way one that may or may not let us read
   the reply; Wirecast has none at all and does not need one. Asking vMix for a
   password, or drawing a green light for Wirecast, is how somebody concludes
   the whole feature is broken. */
const MX_HELP = {
  obs:
    'In OBS: <b>Tools &rarr; WebSocket Server Settings</b>, tick <b>Enable</b>, ' +
    'and copy the password in. Nothing to install — it has been built in since ' +
    'OBS 28. This is the fullest integration: the rundown is built for you, ' +
    'takes are driven from here, and OBS reports the stream back, including ' +
    'exactly how long it has been running.',
  vmix:
    'In vMix: <b>Settings &rarr; Web Controller</b>, tick <b>Enable</b>, and ' +
    'note the port. The rundown is built for you and takes go to <b>overlay ' +
    'channel 1</b>. Whether this page can READ vMix back depends on your ' +
    'install — it checks on connect and says which one you have got.',
  wirecast:
    'Wirecast has no control API a web page can reach — AppleScript on macOS, ' +
    'keyboard shortcuts everywhere else. <b>It does not need one.</b> Add ONE ' +
    'Web Page shot pointing at the single URL below, and every take here ' +
    'reaches it directly over the socket. Press <b>Connect</b> for the steps.',
  manual:
    'Livestream Studio, Streamlabs, mimoLive, Ecamm, a hardware switcher with ' +
    'an HTML input — anything that can open a web page. Add ONE full-frame ' +
    'browser source pointing at the single URL below and switch it from here. ' +
    'Press <b>Connect</b> for the steps.'
};
const MX_PORTS = { obs: '4455', vmix: '8088', wirecast: '', manual: '' };

function mxKindChanged() {
  const kind = $('#mxKind').value;
  const networked = kind === 'obs' || kind === 'vmix';
  $('#mxPass').style.display = kind === 'obs' ? '' : 'none';
  $('#mxHost').style.display = networked ? '' : 'none';
  $('#mxPort').style.display = networked ? '' : 'none';
  $('#mxConnect').textContent = networked ? 'Connect' : 'Show me the steps';
  if (!$('#mxPort').dataset.touched && MX_PORTS[kind]) $('#mxPort').value = MX_PORTS[kind];
  $('#mxNote').innerHTML = MX_HELP[kind] || MX_HELP.manual;
  /* A mixer that is not driven must not offer to build a rundown in it. */
  $('#mxLayout').style.display = networked ? '' : 'none';
  const drive = $('#mxDrive');
  if (drive) drive.closest('label').style.display = networked ? '' : 'none';
}

/* ---- the one-source path, written out ------------------------------------
   The whole Wirecast integration, and the whole integration with everything
   else that cannot be driven. Deliberately a numbered list rather than prose:
   somebody is reading this in a sports hall twenty minutes before tip. */
function manualSteps(product) {
  const url = sceneURL('scorebug', true);
  const wirecast = product === 'wirecast';
  return '<b>' + (wirecast ? 'Wirecast' : 'Any mixer') + ' — one source, switched from here</b>' +
    '<ol class="mxsteps">' +
      '<li>' + (wirecast
        ? 'Add a shot: <b>Shot &rarr; Add Web Page Shot</b>, or the <b>+</b> under a layer.'
        : 'Add a <b>browser</b> or <b>web page</b> source to your scene.') + '</li>' +
      '<li>Paste this URL:<br><code class="mxurl">' + esc(url) + '</code>' +
        '<button class="ep-btn ghost mxcopy" data-copy="' + esc(url) + '">copy</button></li>' +
      '<li>Set it to <b>1920 &times; 1080</b> and leave the background ' +
        '<b>transparent</b> — the page draws nothing where there is no graphic, ' +
        'so it can sit over your camera all night.</li>' +
      '<li>Put it on your <b>topmost layer</b>' + (wirecast ? ' (Wirecast layer 1 or 2)' : '') +
        ' and leave it live for the whole game.</li>' +
      '<li>That is the setup. Every <b>take</b> on this page now changes what ' +
        'that source shows, over the socket — nothing else to press in ' +
        (wirecast ? 'Wirecast' : 'your mixer') + '.</li>' +
    '</ol>' +
    '<p class="mxwarn">If the tag above says the live layer is not connected, ' +
    'takes will not reach it. The tiles still work as individual URLs in that ' +
    'case — one source per graphic, switched in your mixer.</p>';
}

async function mxConnect() {
  const kind = $('#mxKind').value;
  const host = $('#mxHost').value.trim() || 'localhost';
  const port = parseInt($('#mxPort').value, 10) || (kind === 'obs' ? 4455 : 8088);
  mxRemember();

  if (mx && mx.close) { try { mx.close(); } catch (_) {} }
  mx = null; mxKind = kind;
  $('#mxLayout').disabled = true;

  if (kind === 'wirecast' || kind === 'manual') {
    /* Nothing to connect TO, and that is the design rather than a shortfall.
       See the note on manual() in mixers.js: the take goes to the layer over
       the socket, not to the mixer. */
    mx = window.EpinoiaMixers.manual(kind);
    mxSay('one source, driven from here', 'on');
    $('#mxNote').innerHTML = manualSteps(kind);
    wireCopy();
    return;
  }

  if (kind === 'vmix') {
    /* vMix has no handshake, so "connecting" means finding out whether its
       replies are readable — which decides whether the layout can be a diff
       and whether transport state can be reported at all. */
    mx = window.EpinoiaMixers.vmix(host, port);
    mxSay('checking vMix…');
    const { readable, state } = await mx.probe();
    mxSay(readable ? 'vMix connected' : 'sending to vMix (one-way)', 'on');
    $('#mxNote').innerHTML = readable
      ? 'vMix <b>' + esc(state.version || '') + '</b> is answering and this page ' +
        'can read it back: <b>' + state.inputs.length + ' inputs</b> seen. Building ' +
        'the rundown will update what is already there rather than duplicating it, ' +
        'and the on-air panel below reports vMix truthfully.'
      : '<b>Commands will be sent, but vMix will not let this page read its ' +
        'replies</b> — that is a CORS restriction in the browser, not a fault ' +
        'in your setup. Everything still works; what changes is that this page ' +
        'cannot confirm anything, so it says a command was <b>sent</b>, and ' +
        'building the rundown twice would add the inputs twice.';
    $('#mxLayout').disabled = false;
    pollLive();
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
    checkDestination();
    pollLive();
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
      if (!mx.readable &&
          !confirm('Add ' + list.length + ' browser inputs to vMix?\n\n' +
                   'This vMix will not let the page read its replies, so it ' +
                   'cannot tell what is already there — running this twice ' +
                   'adds them twice.')) { $('#mxLayout').disabled = false; return; }
      await mx.layout(list, msg => mxSay(msg));
      mxSay(mx.readable ? 'vMix connected' : 'inputs sent to vMix', 'on');
      $('#mxNote').innerHTML = mx.readable
        ? 'Updated <b>' + list.length + '</b> browser inputs in vMix. Takes go to ' +
          '<b>overlay channel 1</b>; running this again updates them rather than ' +
          'adding a second set.'
        : 'Sent <b>' + list.length + '</b> browser inputs to vMix. Takes go to ' +
          '<b>overlay channel 1</b>. This page cannot confirm they arrived — check ' +
          'the vMix input list.';
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
  /* drives:false is the whole Wirecast path — the take already reached the
     layer over the socket, and there is nothing here to tell. */
  if (!mx || !mx.drives || !$('#mxDrive').checked) return;
  const list = graphicsList();
  const want = list.find(g => g.key === key);
  if (!want) return;
  try {
    if (mxKind === 'vmix') mx.take(want.name);
    else mx.take(SCENE_NAME, want.name, list.map(g => g.name));
  } catch (_) { /* the layer changed regardless */ }
}

/* Copy buttons inside a note that was just written into the DOM. Wired on
   demand rather than once at load, because the note is replaced wholesale. */
function wireCopy() {
  document.querySelectorAll('.mxcopy').forEach(b => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy)
        .then(() => { b.textContent = 'copied'; setTimeout(() => { b.textContent = 'copy'; }, 1400); })
        .catch(() => { b.textContent = 'select it by hand'; });
    };
  });
}

function wireMixer() {
  $('#clearAir').addEventListener('click', clearAir);
  $('#mxKind').addEventListener('change', mxKindChanged);
  $('#mxPort').addEventListener('input', () => { $('#mxPort').dataset.touched = '1'; });
  $('#mxConnect').addEventListener('click', mxConnect);
  $('#mxLayout').addEventListener('click', mxLayout);
  mxRestore();
}

/* ==========================================================================
   GOING LIVE FROM HERE.

   The mixer is already connected for the graphics, so the stream is two more
   requests. What it is NOT is a place to type a stream key: obs-websocket will
   let this page write one and it must not. A key typed into a web page is a key
   that page is now responsible for — in localStorage, in a form field, in a
   screenshot of the control room somebody posts. OBS holds it already, the
   destination is set once a season, and the honest thing is to say so and point
   at OBS's own settings.

   So this drives transport and reports state. Stopping asks first, because a
   stream is public and a misclick is public too.
   ========================================================================== */
let liveTimer = null, liveState = { streaming: false, recording: false };

function fmtDur(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) +
         ':' + String(s).padStart(2, '0');
}

async function pollLive() {
  const panel = $('#golive');
  if (!panel) return;

  /* Three states, not two. A mixer that is not connected is different from one
     that is connected but cannot be read — vMix behind a browser that will not
     let us see its replies can still be told to start streaming, and refusing
     to offer the button would be wrong. */
  const usable = mx && mx.kind !== 'manual' && (mx.kind !== 'obs' || mx.ready);
  if (!usable) {
    panel.dataset.state = 'off';
    $('#lvState').textContent = mx && mx.kind === 'manual'
      ? 'start the stream in your mixer' : 'mixer not connected';
    $('#lvStats').textContent = '';
    $('#lvGo').disabled = true; $('#lvRec').disabled = true;
    return;
  }
  try {
    const [st, rec] = await Promise.all([mx.streamStatus(), mx.recordStatus()]);
    liveState = { streaming: st.outputActive, recording: rec.outputActive };

    /* THE STREAM MAY HAVE BEEN STARTED SOMEWHERE ELSE, and the anchor for the
       whole video timeline should not depend on which button was pressed. The
       poll notices the output going active however it happened — this page,
       OBS directly, or before anybody opened the control room — and anchors
       from the mixer's own duration counter. See stampStreamStart. */
    if (st.outputActive) stampStreamStart();

    const unknown = st.unknown === true;
    panel.dataset.state = st.outputActive ? 'live' : (unknown ? 'off' : 'ready');
    $('#lvState').textContent = st.outputActive ? 'ON AIR'
      : unknown ? 'cannot read this mixer' : 'ready';
    $('#lvGo').disabled = false;
    $('#lvGo').textContent = st.outputActive ? 'Stop the stream'
      : unknown ? 'Start streaming' : 'Go live';
    $('#lvGo').className = 'ep-btn' + (st.outputActive ? ' danger' : '');
    $('#lvRec').disabled = false;
    $('#lvRec').textContent = rec.outputActive ? 'Stop recording' : 'Record';

    /* vMix answers whether it is streaming but not for how long, so the
       statistics below would all be zero. Saying nothing is better than
       reporting 0 kbps on a healthy stream. */
    if (unknown || st.outputDuration == null) {
      $('#lvStats').textContent = unknown ? 'state not readable from this mixer' : '';
      panel.dataset.warn = '';
      return;
    }

    if (st.outputActive) {
      /* Bitrate is not reported, so it is derived from bytes over duration —
         which is the number an operator is actually watching for, because a
         bitrate that sags is a stream about to buffer. */
      const secs = Math.max(1, (st.outputDuration || 0) / 1000);
      const kbps = Math.round(((st.outputBytes || 0) * 8) / secs / 1000);
      const dropped = st.outputTotalFrames
        ? ((st.outputSkippedFrames || 0) / st.outputTotalFrames * 100) : 0;
      const bits = [fmtDur(st.outputDuration), kbps.toLocaleString() + ' kbps'];
      if (dropped > 0.1) bits.push(dropped.toFixed(1) + '% dropped');
      if (st.outputCongestion > 0.3) bits.push('congested');
      $('#lvStats').textContent = bits.join('  ·  ');
      /* dropped frames and congestion are the two things worth colouring */
      panel.dataset.warn = (dropped > 2 || st.outputCongestion > 0.5) ? '1' : '';
    } else {
      $('#lvStats').textContent = rec.outputActive
        ? 'recording · ' + fmtDur(rec.outputDuration) : '';
      panel.dataset.warn = '';
    }
  } catch (_) {
    panel.dataset.state = 'off';
    $('#lvState').textContent = 'mixer not connected';
  }
}

/* THE LEAGUE'S OWN CHANNEL, PUSHED INTO OBS.

   A league administrator sets the destination once in the admin console; this
   reads it for the fixture in hand and writes it into OBS. The key is never
   rendered — it goes from the request straight into a socket to the same
   machine — and it is only ever fetched by somebody the database already
   trusts with it. */
async function sendLeagueDestination() {
  if (!mx || mxKind !== 'obs' || !mx.ready) return;
  const btn = $('#lvSend');
  btn.disabled = true;
  try {
    const sb2 = await window.epinoiaClient();
    const { data, error } = await sb2.rpc('stream_target_for_game', { p_game: gameId });
    if (error) throw error;
    const t = (data || [])[0];
    if (!t) {
      $('#lvNote').innerHTML = '<b>This league has no destination set.</b> A league ' +
        'administrator adds one under <b>Streaming destination</b> in the league ' +
        'console — then it lands here by itself.';
      return;
    }
    await mx.setDestination(t.server, t.stream_key);
    $('#lvNote').innerHTML = 'OBS is now pointed at <b>' + (t.label || 'the league channel') +
      '</b> (' + String(t.server).replace(/^rtmps?:\/\//, '').split('/')[0] + '). ' +
      'The key went straight from the database into OBS — this page never showed it.';
    checkDestination();
  } catch (err) {
    $('#lvNote').innerHTML = '<b>Could not set the destination.</b> ' +
      ((err && err.message) || err) +
      '<br>Only a league administrator can read their own stream key.';
  } finally { btn.disabled = false; }
}

async function checkDestination() {
  const note = $('#lvNote');
  if (!mx || mxKind !== 'obs' || !mx.ready) { note.textContent = ''; return; }
  /* OBS only: vMix does not publish its destination, and inventing one would
     have this page telling an operator their stream is going somewhere it is
     not. */
  const d = await mx.destination();
  if (d.ready) {
    note.innerHTML = 'OBS will send this to <b>' +
      (d.server ? String(d.server).replace(/^rtmps?:\/\//, '') : d.type || 'its configured destination') +
      '</b>. The key stays in OBS — this page never asks for it and never stores it.';
  } else {
    note.innerHTML = '<b>No destination is set in OBS yet.</b> If your league has ' +
      'one saved, press <b>Use the league channel</b> above. Otherwise set it in ' +
      '<b>OBS → Settings → Stream</b>. Recording works without one either way.';
  }
}

async function toggleStream() {
  if (!mx) return;
  const btn = $('#lvGo');
  if (liveState.streaming) {
    /* A stream is public and so is a misclick. */
    if (!confirm('Stop the stream?\n\nAnybody watching will see it end.')) return;
    btn.disabled = true;
    try { await mx.stopStream(); } catch (err) { $('#lvNote').textContent = err.message; }
  } else {
    btn.disabled = true;
    try {
      await mx.startStream();
      /* THE ANCHOR IS NOT STAMPED HERE, deliberately. pollLive runs shortly
         after, sees the output active, and stamps from the mixer's own
         duration counter — one path, whether the stream was started by this
         button, by OBS directly, or before this page was ever opened. Stamping
         here as well would be a second path that is right only sometimes. */

      /* AND THE REQUEST SUCCEEDING IS NOT THE STREAM STARTING.

         Found against a real OBS: StartStream and StartRecord both return
         success and then quietly do nothing at all if the output cannot
         start — a destination that is not configured, an encoder that will
         not initialise, an audio source that has wedged. OBS logs "failed to
         start"; obs-websocket says nothing; this page said nothing either,
         and the operator watched a button that had visibly worked while
         nothing went out.

         So the claim is checked rather than assumed. */
      if (mx.kind === 'obs') confirmStarted();

      if (mx.kind === 'vmix' && !mx.readable) {
        $('#lvNote').innerHTML = 'Start sent to vMix. This vMix will not let the ' +
          'page read its replies, so check vMix itself that it went live — and ' +
          'note that the video anchor is taken from <b>now</b> rather than from ' +
          'vMix, which does not report how long it has been streaming.';
      }
    }
    catch (err) {
      /* The commonest failure by a mile is no destination configured, and the
         mixer's own message for it mentions an output, which tells nobody
         anything. */
      const who = mx.kind === 'vmix' ? 'vMix' : 'OBS';
      $('#lvNote').innerHTML = '<b>' + who + ' would not start the stream.</b> ' +
        (/output/i.test(err.message || '')
          ? 'That usually means no destination is set — <b>' + who +
            ' &rarr; Settings &rarr; Stream</b>.'
          : (err.message || String(err)));
    }
  }
  setTimeout(pollLive, 400);
}

/* Did it actually start? Asked for a few seconds, because encoders take a beat
   to spin up and reporting a failure at 200ms would be a false alarm on every
   healthy stream. Silent when it works: an operator who pressed Go live and
   went live does not need telling. */
async function confirmStarted() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await new Promise(r => setTimeout(r, 900));
    try {
      const st = await mx.streamStatus();
      if (st.outputActive) return true;
    } catch (_) { /* a blip is not a verdict */ }
  }
  $('#lvNote').innerHTML =
    '<b>OBS accepted the request but the stream has not started.</b> ' +
    'That is OBS reporting success and then failing quietly, and it means one ' +
    'of three things: no destination is set (<b>OBS &rarr; Settings &rarr; ' +
    'Stream</b>), the encoder will not initialise, or a source has wedged — ' +
    'check <b>Help &rarr; Log Files &rarr; View Current Log</b> for a line ' +
    'saying an output failed to start. Nothing has been anchored to this ' +
    'attempt, so try again once it is fixed and the video will still line up.';
  return false;
}

/* WHEN THE STREAM STARTED, TAKEN FROM THE MIXER RATHER THAN FROM A BUTTON.

   This used to stamp "now" the moment somebody pressed Go live here, which is
   wrong in three ordinary situations: the stream was started in OBS directly,
   it was started twenty minutes before anybody opened this page, or the page
   was reloaded since. All three produce a video whose every clip is out by
   however long the difference was, with nothing on any screen to say so.

   OBS counts its own output duration, so the start is now minus that — and
   what is sent is the DURATION, not an instant, so the database stamps the
   moment on its own clock. That matters more than it looks: the other end of
   this subtraction is a tip-off stamped by the same database, and two ends of
   one subtraction have to be on one clock or a laptop that is a minute fast
   moves every clip in the game by a minute.

   vMix reports whether it is streaming but not for how long, so it falls back
   to now — which is right when this page pressed the button and is the best
   available guess otherwise. The video screen in the scorer is where a human
   corrects it, and it is one number.

   ONCE PER STREAM. Restarting a dropped stream does not move the anchor: the
   video a viewer ends up watching is the one that began at the first attempt.
   A genuinely new recording for the second half is a judgement, and belongs to
   the person in the hall rather than to a reconnect. */
let stampedStart = false;
async function stampStreamStart() {
  if (stampedStart || !gameId || !window.epinoiaClient || !mx) return;
  stampedStart = true;
  try {
    const ago = await mx.streamStartedMsAgo();
    const sb2 = await window.epinoiaClient();
    if (!sb2) return;
    const dest = mx.destination ? await mx.destination() : {};
    const patch = {
      p_game: gameId,
      /* elapsed, so the server stamps it — never an instant from this laptop */
      p_stream_ms_ago: ago != null ? ago : 0,
      p_is_live: true
    };
    /* The platform, from what the encoder is configured for rather than from a
       dropdown. A link pasted later inherits it and cannot disagree with it. */
    if (dest && dest.provider) patch.p_provider = dest.provider;
    /* A destination with no watchable URL still anchors the timeline — the link
       can be pasted afterwards and every clip position is already right. */
    const url = (($('#lvWatch') && $('#lvWatch').value) || '').trim();
    if (url) patch.p_url = url;

    const { error } = await sb2.rpc('set_game_video', patch);
    if (error) { console.warn('[video] could not stamp the stream start', error); return; }
    const note = $('#lvNote');
    if (note && ago != null && ago > 5000) {
      note.innerHTML = 'Anchored to the stream, which OBS says has been running ' +
        '<b>' + fmtDur(ago) + '</b>. Every play in the log now has a position in ' +
        'the video.';
    }
  } catch (e) { console.warn('[video]', e); }
}

async function toggleRecord() {
  if (!mx) return;
  $('#lvRec').disabled = true;
  try {
    if (liveState.recording) await mx.stopRecord(); else await mx.startRecord();
  } catch (err) { $('#lvNote').textContent = err.message; }
  setTimeout(pollLive, 400);
}

/* Attaching the watch link is its own button rather than a side effect of
   going live, because the link usually does not exist until AFTER the stream
   has started — YouTube hands it out when the broadcast goes up. */
async function saveWatchLink() {
  const input = $('#lvWatch');
  const raw = (input.value || '').trim();
  const note = $('#lvNote');
  if (!raw) { note.textContent = 'Paste the public link first.'; return; }
  if (!gameId) { note.textContent = 'No fixture is loaded, so there is nothing to attach it to.'; return; }
  const V = window.EpinoiaVideo;
  const parsed = V ? V.parse(raw) : { ok: false, provider: 'other', ref: '' };
  const btn = $('#lvWatchSave');
  btn.disabled = true;
  try {
    const sb2 = await window.epinoiaClient();
    const { error } = await sb2.rpc('set_game_video', {
      p_game: gameId, p_url: raw,
      p_provider: parsed.provider || 'other', p_ref: parsed.ref || '',
      p_is_live: true
    });
    if (error) throw new Error(error.message);
    note.innerHTML = parsed.ok
      ? 'Attached. The box score will embed it, and every line of the ' +
        'play-by-play will seek into it once the clocks are lined up.'
      : '<b>Saved, but not recognised.</b> It will show as a plain link — ' +
        'plays will not be able to seek into it.';
  } catch (e) {
    note.textContent = 'Could not attach it: ' + (e.message || e);
  }
  btn.disabled = false;
}

function wireLive() {
  $('#lvGo').addEventListener('click', toggleStream);
  $('#lvWatchSave').addEventListener('click', saveWatchLink);
  $('#lvRec').addEventListener('click', toggleRecord);
  $('#lvSend').addEventListener('click', sendLeagueDestination);
  clearInterval(liveTimer);
  /* Two seconds: fast enough that a dropped-frame problem is noticed while it
     can still be fixed, slow enough that it is not a request per frame. */
  liveTimer = setInterval(pollLive, 2000);
  pollLive();
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
  on('#expWirecast', () => download(base + '-wirecast-setup.txt', wirecastSheet()));
  on('#expUrls', () => download(base + '-graphics.txt', urlList()));
}

/* ==========================================================================
   WHAT THE STATISTICIAN HAS DONE, SEEN FROM THE GALLERY.

   The two halves of a broadcast sit at opposite ends of a sports hall and
   cannot see each other's screens. A director takes "starting fives" and gets
   a card headed "squads" — correct, honest, and no use, because nothing told
   them the fives had not been picked yet.

   So the control room reads the same fixture the graphics read, and says which
   graphics are ready. A tile that cannot work yet is marked rather than
   removed: the reason a director wants it is the reason they need to know it
   is coming.
   ========================================================================== */
let ready = { roster: false, fives: false, officials: false, status: 'scheduled' };
let readyTimer = null;

async function pollReady() {
  if (!CFG.supabaseUrl || !gameId) return;
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/games?id=eq.' +
      encodeURIComponent(gameId) +
      '&select=status,starters,roster_snapshot,home_team_id,away_team_id&limit=1',
      { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey } });
    const g = (await r.json())[0];
    if (!g) return;

    const fives = Array.isArray(g.starters) && (g.starters[0] || []).length >= 5
                  && (g.starters[1] || []).length >= 5;

    /* A ROSTER IS EITHER SOURCE, and getting this wrong made the tile lie:
       every squad tile was marked "needs the squads picked in the scorer"
       while the graphic beside it rendered twelve players perfectly happily,
       because before tip the layer falls back to the clubs' own published
       rosters. The control room has to mirror the layer's rules, not guess at
       them — a tile that says a working graphic is unavailable is worse than
       no tile at all. */
    let roster = !!(g.roster_snapshot && g.roster_snapshot.teams &&
                    (g.roster_snapshot.teams[0] || {}).players);
    if (!roster && g.home_team_id) {
      try {
        const r3 = await fetch(CFG.supabaseUrl + '/rest/v1/roster_entries' +
          '?select=player_id&active=eq.true&team_id=in.(' +
          [g.home_team_id, g.away_team_id].filter(Boolean).join(',') + ')&limit=1',
          { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey } });
        roster = ((await r3.json()) || []).length > 0;
      } catch (_) { /* leave it false; the tile says so */ }
    }

    let officials = ready.officials;
    try {
      const r2 = await fetch(CFG.supabaseUrl + '/rest/v1/games?id=eq.' +
        encodeURIComponent(gameId) + '&select=officials&limit=1',
        { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey } });
      const o = (await r2.json())[0];
      officials = !!(o && o.officials && Object.keys(o.officials).length);
    } catch (_) { /* before 0076 there is no such column */ }

    const next = { roster, fives, officials, status: g.status };
    if (JSON.stringify(next) !== JSON.stringify(ready)) {
      ready = next;
      paintReady();
    }
  } catch (_) { /* the tiles simply stay as they were */ }
}

/* Which graphics can work right now. Mirrors the layer's own rules rather than
   guessing at them — if these two disagree, the tile lies. */
const blockedReason = key => {
  /* A bench is the only one that genuinely cannot exist: it is defined by who
     is NOT starting, so without the fives there is nothing to draw. */
  if (key.startsWith('bench')) return ready.fives ? null : 'needs the starting fives';
  if (!ready.roster && (key.startsWith('squad') || key.startsWith('five') || key === 'starters'))
    return 'no squads on this fixture yet';
  /* These DO work without the fives — they show the squad and say so. That is
     worth telling a director before they take it, not instead of. */
  if ((key.startsWith('five') || key === 'starters') && !ready.fives)
    return 'shows squads until the fives are picked';
  if (key === 'officials') return ready.officials ? null : 'no officials entered yet';
  if (['scorebug', 'lower', 'scorers', 'plusminus', 'rebounds', 'assists', 'lineups', 'compare']
      .includes(key)) {
    return ready.status === 'scheduled' ? 'nothing to show until the game starts' : null;
  }
  return null;
};

/* Marked, but not the same kind of marked. A graphic that will show something
   slightly different is not a graphic that will show nothing, and colouring
   them alike trains a director to ignore both. */
const isHardBlock = key =>
  key.startsWith('bench') ? !ready.fives
  : (!ready.roster && (key.startsWith('squad') || key.startsWith('five') || key === 'starters')) ? true
  : key === 'officials' ? !ready.officials
  : ['scorebug', 'lower', 'scorers', 'plusminus', 'rebounds', 'assists', 'lineups', 'compare']
      .includes(key) ? ready.status === 'scheduled'
  : false;

function paintReady() {
  document.querySelectorAll('.tile').forEach(t => {
    const why = blockedReason(t.dataset.key);
    const hard = isHardBlock(t.dataset.key);
    t.classList.toggle('blocked', !!why && hard);
    t.classList.toggle('caveat', !!why && !hard);
    let tag = t.querySelector('.blockwhy');
    if (why) {
      if (!tag) { tag = document.createElement('div'); tag.className = 'blockwhy';
                  t.insertBefore(tag, t.querySelector('.row')); }
      tag.textContent = why;
    } else if (tag) tag.remove();
  });
  const pill = $('#fxReady');
  if (pill) {
    const bits = [];
    bits.push(ready.roster ? 'squads ✓' : 'squads —');
    bits.push(ready.fives ? 'fives ✓' : 'fives —');
    bits.push(ready.officials ? 'officials ✓' : 'officials —');
    pill.textContent = bits.join('   ') + '   ·   ' + ready.status;
    pill.className = 'fxready' + (ready.fives && ready.roster ? ' on' : '');
  }
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
  wireLive();
  pollReady();
  /* The same eight seconds the graphics use, so the gallery and the layer
     never disagree about what exists. */
  readyTimer = setInterval(pollReady, 8000);

  /* AUTO-CONNECT WHEN PRIMED. "Prime for broadcast" means the operator has
     already decided they are streaming this fixture, so making them press
     Connect on arrival is a step that exists only because the page was written
     before the button was. Only when settings have been saved before — the
     first time, they still choose. */
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(MX_KEY) || 'null'); } catch (_) {}
  if (saved && (qp.get('connect') === '1' || saved.auto)) setTimeout(mxConnect, 250);
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
