'use strict';
/* ============================================================================
   THE GAME, ON VIDEO — the tab where the play-by-play becomes footage.

   Everything here rests on one fact established elsewhere: every event carries
   the wall clock of the moment it was recorded, and the video row carries the
   wall clock of the moment the stream started. epinoia/video.js turns that
   pair into a position in the footage. So this file has no arithmetic of its
   own; it is a player, a set of filters, and a list.

   WHY A LIST AND NOT A REEL. The obvious build is "press play and watch the
   highlights". The obvious build is also the one that is wrong for the person
   who actually opens this: a coach checking whether a call went their way, a
   parent looking for one basket, a player cutting their own tape. Those people
   want to ARRIVE at a moment, not to be shown a sequence. So the list is the
   primary thing and the sequence is a switch on top of it.

   SEEKING WITHOUT THE PLATFORM'S JAVASCRIPT API. Each seek rebuilds the
   iframe with a new start time. That costs a beat — the player reloads —
   and buys the page not loading a script from YouTube, which is both a CSP
   hole and a tracker on a page about a schools game. When "in sequence" is
   on, the advance is a timer of the clip's own length rather than a report
   from the player, so it drifts by whatever the buffering cost. That is an
   honest trade and it is why the clip lengths are generous.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVideoTab = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const V = () => root0().EpinoiaVideo;
function root0() { return typeof globalThis !== 'undefined' ? globalThis : self; }
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* One tab's worth of state. Deliberately module-level rather than on the DOM:
   the game page rebuilds its body whenever the log changes, and a filter the
   reader chose must survive that. */
let st = { filter: 'all', pid: '', team: '', reel: false, current: null, seekMs: 0,
           hlOpen: false, hlSel: null, hlKinds: null, hlOr: 'portrait', hlJob: null, hlMsg: '', hlDone: null,
           /* EVENTS, PLAYER MINUTES or LINEUPS. A clock-read game knows when the clock ran, so
              it can show not only where each play is but every stretch a player, or a five,
              was on the floor -- and take the viewer to the start of any of them. */
           tab: 'events',
           /* HOW MANY ROWS ARE IN THE DOCUMENT, which is not the same question
              as how many plays match. A full game is four hundred actions and
              a busy one more; the list is a scroller, so all of them were being
              built and laid out to show twelve. On a mid-range phone that is a
              visible pause every time a filter changes, for rows nobody has
              scrolled to. Two hundred is comfortably more than a screen and
              cheap to build; the rest arrive on request. */
           shown: 200 };
const PAGE = 200;
let reelTimer = null;
let host = null, ctx = null;

/* -------------------------------------------------------------- the list --- */
/* INDEXED ONCE PER LOG, NOT ONCE PER GLANCE.

   plays() walks every event in the game and builds a clip for each. selected()
   then filters it — and selected() was being called three times to draw one
   frame (the list, the current game, and again inside every click handler), so
   a 786-event log was being re-indexed on every chip press and every render
   tick. The result cannot change unless the log or the anchor does, so it is
   computed when one of those changes and not otherwise. */
let indexed = null, indexedKey = '';
function plays() {
  const v = ctx.video;
  const key = (ctx.events.length) + ':' + (v.tip_wall || v.tip_at || '') + ':' +
              (v.stream_started_at || '') + ':' + (v.trim_ms || 0) + ':' +
              (v.clock_track && v.clock_track.samples ? v.clock_track.samples.length : 0);
  if (indexed && key === indexedKey) return indexed;
  indexedKey = key;
  indexed = buildPlays();
  return indexed;
}
function buildPlays() {
  const v = ctx.video;
  /* Labels come from the replay, not from a second wording of the same event.
     engine.js already writes "T. Okafor — 3pt made (assisted)" and there is no
     version of this page where a different sentence would be an improvement. */
  const byId = {};
  (ctx.d.pbp || []).forEach(p => { byId[p.id] = p; });
  /* names for the ASSIST tag, off the roster the page already holds */
  const names = {};
  ((ctx.S && ctx.S.teams) || []).forEach(t => (t.players || []).forEach(p => { names[p.id] = p.name; }));
  const all = V().index(ctx.events, v, {
    skipStructural: true,
    names: names,
    label: e => {
      const p = byId[e.seq != null ? e.seq : e.id];
      return p ? p.txt : e.t;
    }
  });
  /* An event with no line in the replay is one the replay chose not to show —
     a descriptor, or something engine.js deliberately renders silently. It
     should not appear here either. */
  return all.filter(p => p.label && p.label !== p.t);
}

/* ------------------------------------------------------ minutes & fives --- */
/* Player intervals and lineup intervals from the log (video.js stints), each placed in the
   footage by the clock's runs. Built once per log, like the plays. */
let stinted = null, stintedKey = '';
function stintsOf() {
  const v = ctx.video;
  const key = (ctx.events.length) + ':' + (v.clock_track && v.clock_track.samples ? v.clock_track.samples.length : 0);
  if (stinted && key === stintedKey) return stinted;
  stintedKey = key;
  const starters = (ctx.S && ctx.S.starters) || null;
  const raw = V().stints(ctx.events, starters);
  const place = (period, clock) => V().positionFromTrack(v.clock_track, period, clock);
  const span = x => Object.assign({}, x, {
    ms: (x.c0 - x.c1),
    start: place(x.period, x.c0), end: place(x.period, x.c1),
    key: x.period + ':' + x.c0 + ':' + x.c1
  });
  const players = raw.players.map(span), lineups = raw.lineups.map(span);
  const names = {}, nums = {};
  ((ctx.S && ctx.S.teams) || []).forEach(t => (t.players || []).forEach(p => { names[p.id] = p.name; nums[p.id] = p.num; }));
  /* per player: the intervals, in game order, and the total */
  const byPid = {};
  players.forEach(x => {
    const b = byPid[x.pid] || (byPid[x.pid] = { pid: x.pid, team: x.team, name: names[x.pid] || 'unknown', num: nums[x.pid] || '', ms: 0, spans: [] });
    b.ms += x.ms; b.spans.push(x);
  });
  const byFive = {};
  lineups.forEach(x => {
    const k = x.team + '|' + x.key.split(':')[0] + '|' + x.ids.join(',');
    const id = x.team + '|' + x.ids.join(',');
    const b = byFive[id] || (byFive[id] = { id, team: x.team, ids: x.ids, names: x.ids.map(i => names[i] || '?'), ms: 0, spans: [] });
    b.ms += x.ms; b.spans.push(x);
  });
  stinted = {
    known: raw.known,
    players: Object.values(byPid).sort((a, b) => (a.team - b.team) || (b.ms - a.ms)),
    fives: Object.values(byFive).sort((a, b) => (a.team - b.team) || (b.ms - a.ms))
  };
  return stinted;
}
const mmss = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function spanChips(spans, who) {
  return spans.map(x =>
    '<button class="vidspan' + (st.current === who + '@' + x.key ? ' on' : '') + '"' +
      ' data-seek="' + (x.start != null ? Math.round(x.start) : '') + '" data-cur="' + esc(who + '@' + x.key) + '"' +
      (x.start == null ? ' disabled title="this stretch is in a period the clock was not read in"' : '') +
      ' title="' + esc(perName(x.period) + ' ' + fmtClock(x.c0) + ' to ' + fmtClock(x.c1) + (x.start != null ? ' · from ' + V().stamp(x.start) + ' in the video' : '')) + '">' +
      '<b>' + esc(perName(x.period)) + '</b> ' + esc(fmtClock(x.c0)) + '–' + esc(fmtClock(x.c1)) +
      ' <i>' + mmss(x.ms) + '</i></button>').join('');
}
function minutesHTML() {
  const S = stintsOf();
  if (!S.known) return '<div class="vidwarn">This game\'s log has no starting fives recorded, so who was on the floor cannot be followed.</div>';
  const teams = (ctx.S && ctx.S.teams) || [];
  const list = S.players.filter(p => (!st.pid || p.pid === st.pid) && (st.team === '' || p.team === st.team));
  if (!list.length) return '<ol class="vidlist"><li class="viditem empty">Nobody matches that filter.</li></ol>';
  let out = '', team = null;
  list.forEach(p => {
    if (p.team !== team) { team = p.team; out += '<div class="vidsec">' + esc((teams[team] && teams[team].name) || ('team ' + (team + 1))) + '</div>'; }
    out += '<div class="vidmin">' +
      '<div class="vidmin-h"><span class="vidmin-n">' + (p.num ? '<i>' + esc(p.num) + '</i> ' : '') + esc(p.name) + '</span>' +
        '<span class="vidmin-t">' + mmss(p.ms) + ' <small>' + p.spans.length + (p.spans.length === 1 ? ' stint' : ' stints') + '</small></span></div>' +
      '<div class="vidspans">' + spanChips(p.spans, p.pid) + '</div></div>';
  });
  return out;
}
function lineupsHTML() {
  const S = stintsOf();
  if (!S.known) return '<div class="vidwarn">This game\'s log has no starting fives recorded, so the fives cannot be followed.</div>';
  const teams = (ctx.S && ctx.S.teams) || [];
  const list = S.fives.filter(f => (!st.pid || f.ids.includes(st.pid)) && (st.team === '' || f.team === st.team));
  if (!list.length) return '<ol class="vidlist"><li class="viditem empty">No five matches that filter.</li></ol>';
  let out = '', team = null;
  list.forEach(f => {
    if (f.team !== team) { team = f.team; out += '<div class="vidsec">' + esc((teams[team] && teams[team].name) || ('team ' + (team + 1))) + '</div>'; }
    out += '<div class="vidmin five">' +
      '<div class="vidmin-h"><span class="vidmin-n">' + f.names.map(esc).join(' <em>·</em> ') + '</span>' +
        '<span class="vidmin-t">' + mmss(f.ms) + ' <small>' + f.spans.length + (f.spans.length === 1 ? ' stint' : ' stints') + '</small></span></div>' +
      '<div class="vidspans">' + spanChips(f.spans, f.id) + '</div></div>';
  });
  return out;
}

function selected() {
  return V().select(plays(), {
    filter: st.filter,
    pid: st.pid || null,
    team: st.team === '' ? null : +st.team
  });
}

/* ------------------------------------------------------------- rendering --- */
function playerOptions() {
  const opts = ['<option value="">anybody</option>'];
  (ctx.S.teams || []).forEach((t, i) => {
    if (!t.players || !t.players.length) return;
    opts.push('<optgroup label="' + esc(t.name) + '">');
    /* THE SIDE ITSELF IS A CHOICE: every play, every stint, every five of one club */
    opts.push('<option value="team:' + i + '"' + (st.team === i && !st.pid ? ' selected' : '') + '>' +
              'everyone — ' + esc(t.name) + '</option>');
    t.players.forEach(p => opts.push('<option value="' + esc(p.id) + '"' +
      (st.pid === p.id ? ' selected' : '') + '>' +
      (p.num ? esc(p.num) + ' · ' : '') + esc(p.name) + '</option>'));
    opts.push('</optgroup>');
  });
  return opts.join('');
}

function frameHTML() {
  const v = ctx.video;
  /* A channel embed is the live edge and has no video id to seek within, so it
     ignores the seek entirely rather than pretending to honour it. */
  const src = v.live_src && !v.url
    ? v.live_src
    : V().embedSrc(v, { ms: st.seekMs, autoplay: st.current != null });
  if (v.provider === 'mp4') {
    /* Through the same gate as everything else — a <video src> is as good a
       place to put a javascript: URL as an iframe is. */
    const file = V().safeUrl(v.url);
    if (!file) return '<div class="vidwarn">That video link cannot be played here.</div>';
    return '<video id="vidFrame" class="vidframe" controls playsinline preload="metadata" ' +
      'src="' + esc(file) + '#t=' + Math.floor(st.seekMs / 1000) + '"></video>';
  }
  if (!src) return '<div class="vidwarn">That video link cannot be played here.</div>';
  return '<iframe id="vidFrame" class="vidframe" src="' + esc(src) + '" ' +
    'allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
    'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen ' +
    'title="' + esc(v.label || 'Game video') + '"></iframe>';
}

/* THE PLAYER IS BUILT ONCE AND LEFT ALONE.

   Everything used to be one innerHTML, so choosing a filter destroyed the
   iframe and created a new one — which reloads the player, drops whatever was
   buffered, and restarts the video from the top. Pressing "every point" while
   watching a basket threw you back to the start of the game, which makes the
   filters unusable for the thing they exist for.

   So the stage is written once and only its src is ever touched, and only when
   the position actually changes. Everything below it redraws freely. */
function mount() {
  host.innerHTML = '<div class="vidwrap">' +
    '<div class="vidstage"></div><div class="vidbody"></div></div>';
  paintStage();
}
function paintStage() {
  const stage = host.querySelector('.vidstage');
  if (!stage) return;
  const wanted = frameHTML();
  if (stage.dataset.sig === wanted) return;       // nothing to do, so do nothing
  stage.dataset.sig = wanted;
  stage.innerHTML = wanted;
}

function render() {
  const v = ctx.video;
  /* A channel embed shows the live edge and cannot be seeked — there is no
     video id, only "what is on now". So the play list is not offered against
     it, and the reason is said out loud. */
  const channelOnly = !!(v.live_src && !v.url);
  /* a clock track places plays by the game clock, so neither a timed log nor
     a tip-off anchor is needed when one is present */
  const hasTrack = !!(v.clock_track && Array.isArray(v.clock_track.samples) && v.clock_track.samples.length);
  /* a clock was read (not score changes alone): the runs exist, so minutes and fives can be placed */
  const clocked = hasTrack && v.clock_track.mode !== 'score' && V().runsFromTrack(v.clock_track).length > 0;
  if (!clocked && st.tab !== 'events') st.tab = 'events';
  const timed = !channelOnly && (hasTrack || V().logIsTimed(ctx.events));
  const list = timed ? selected() : [];
  const lined = (V().hasAnchor(v) || hasTrack) && timed;

  if (!host.querySelector('.vidbody')) mount();
  const body = host.querySelector('.vidbody');

  body.innerHTML =
      (lined ? '' : channelOnly
        ? '<div class="vidwarn">This is the league channel, live. It plays whatever ' +
          'is on air now and cannot be wound back to a particular play — there is ' +
          'no recording to seek within yet. <b>The play list appears here as soon ' +
          'as the archive link is attached</b>, and every position in it is already ' +
          'known.</div>'
        : !timed
        ? '<div class="vidwarn">The play-by-play for this game was <b>imported in bulk</b> rather ' +
          'than scored live, so its events carry no time of day and cannot be located in the ' +
          'footage. The video is here in full; the play list is not available for this game.</div>'
        : '<div class="vidwarn">This video has not been lined up with the game clock yet, ' +
          'so individual plays cannot be found in it. Whoever scored the game can ' +
          'line it up from <b>video sync</b> in the scoring app — it takes one number.</div>') +

      /* the tabs, on a game whose clock was read: minutes and fives need the clock's runs */
      (timed && clocked ? '<div class="vidtabs" role="tablist">' + [['events', 'Events'], ['minutes', 'Player minutes'], ['lineups', 'Lineups']].map(t =>
        '<button class="vidtab' + (st.tab === t[0] ? ' on' : '') + '" role="tab" data-tab="' + t[0] + '"' +
        ' aria-selected="' + (st.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' : '') +

      (timed ? '<div class="vidbar">' +
        (st.tab === 'events' ? '<div class="vidchips">' + V().FILTERS.map(f =>
          '<button class="vidchip' + (st.filter === f.key ? ' on' : '') + '" ' +
          'data-f="' + f.key + '">' + esc(f.label) + '</button>').join('') + '</div>' : '') +
        '<div class="vidpick">' +
          '<select id="vidWho" class="ep-in">' + playerOptions() + '</select>' +
          '<label class="vidreel"><input type="checkbox" id="vidReel"' +
            (st.reel ? ' checked' : '') + '> in sequence</label>' +
        '</div>' +
      '</div>' : '') +

      (timed && clocked && st.tab === 'minutes'
        ? '<div class="vidcount">every stretch on the floor, by the game clock · tap one to watch it from the start</div>' + minutesHTML()
        : timed && clocked && st.tab === 'lineups'
        ? '<div class="vidcount">every five, and every stretch it was on · tap one to watch it from the start</div>' + lineupsHTML()
        : '') +

      (timed && !(clocked && st.tab !== 'events') ? '<div class="vidcount">' + list.length + ' ' +
        (list.length === 1 ? 'play' : 'plays') +
        (lined ? ' · tap one to jump to it' : '') + '</div>' : '') +

      (timed && !(clocked && st.tab !== 'events') ? '<ol class="vidlist' + (st.hlOpen ? ' picking' : '') + '">' + (list.length ? list.slice(0, st.shown).map(p =>
        /* A row is a control, so it is one to a keyboard and to a screen
           reader as well as to a mouse. It was a bare <li> with an onclick,
           which is unreachable without a pointer. */
        '<li class="viditem' + (st.current === p.id ? ' on' : '') + '" data-id="' + p.id + '"' +
          ' role="button" tabindex="0"' +
          ' aria-label="' + esc(p.label + ', at ' + V().stamp(p.start) + ' in the video') + '"' +
          (st.current === p.id ? ' aria-current="true"' : '') + '>' +
          (st.hlOpen ? '<input type="checkbox" class="hlpick" data-id="' + p.id + '"' + (hlSel().has(p.id) ? ' checked' : '') +
            ' aria-label="in the reel" title="in the reel">' : '') +
          '<span class="vidt">' + esc(V().stamp(p.start)) +
            (p.approx ? '<i class="vidapx" title="placed by hand — this position is ' +
                        'worked out from the plays either side">~</i>' : '') + '</span>' +
          '<span class="vidq">' + esc(perName(p.period)) + ' ' +
            esc(fmtClock(p.clock)) + '</span>' +
          '<span class="vidtxt">' + esc(p.label) + '</span>' +
          /* the same moment as a link: a clip anybody can be sent */
          (channelOnly ? '' : '<a class="vidlink" href="' + esc(V().watchHref(v, p.start)) + '" target="_blank" rel="noopener" ' +
            'title="open this play on its own, at ' + esc(V().stamp(p.start)) + '">↗</a>') +
        '</li>').join('')
        : '<li class="viditem empty">Nothing matches that filter.</li>') +
        (list.length > st.shown
          ? '<li class="viditem more" id="vidMore" role="button" tabindex="0">' +
            'show ' + Math.min(PAGE, list.length - st.shown) + ' more · ' +
            (list.length - st.shown) + ' left</li>'
          : '') +
      '</ol>' : '') +

      '<div class="vidfoot">' +
        /* No link out for a channel embed: there is no video id, so every URL
           this could build would be a guess at somebody's live page. */
        (channelOnly ? '<span>live on the league channel</span>'
          : '<a href="' + esc(V().watchHref(v, st.seekMs)) + '" target="_blank" rel="noopener">' +
            'open on ' + esc(v.provider === 'youtube' ? 'YouTube'
                           : v.provider === 'twitch' ? 'Twitch'
                           : v.provider === 'vimeo' ? 'Vimeo' : 'the source') + ' ↗</a>') +
        (lined ? '<span class="vidgap">' + esc(V().gapText(v)) + '</span>' : '') +
        /* HOW SURE. A fed game's plays were stamped by a poll, so each carries
           how far back it could really have happened; a tapped game's plays
           carry no such number and the run-up covers the reaction time. */
        (hasTrack && v.clock_track.mode === 'score'
          ? '<span class="vidacc" title="no clock on this broadcast: the score overlay was read instead, so each basket is placed by its own score change and only scoring plays are listed">' +
            'placed by score changes · ' + v.clock_track.samples.length + ' baskets · scoring plays only</span>'
          : hasTrack && v.clock_track.mode === 'wall'
          ? '<span class="vidacc" title="no clock could be read off this broadcast, so every play is placed by the moment the live log recorded it against the stream\u2019s own start time">' +
            'placed by the broadcast\u2019s timestamps · ' + v.clock_track.samples.length + ' plays' +
            (v.clock_track.samples.length && v.clock_track.samples[0].err_ms ? ' · ±' + Math.ceil(v.clock_track.samples[0].err_ms / 1000) + ' s' : '') + '</span>'
          : hasTrack
          ? '<span class="vidacc" title="the clock overlay was read at these points in the footage; every play sits where its clock was on screen' +
            (v.clock_track.wall_check ? '; checked against the broadcast\u2019s own timestamps on ' + v.clock_track.wall_check.plays + ' plays' : '') + '">' +
            'placed by the game clock · ' + v.clock_track.samples.length + ' readings' +
            (v.clock_track.wall_check ? ' · checked' : '') + '</span>'
          : (lined && accuracyMs() != null
          ? '<span class="vidacc" title="a fed game\'s plays are stamped by the ingest worker\'s poll; this is the poll interval">' +
            'plays placed to within ±' + Math.ceil(accuracyMs() / 1000) + ' s</span>' : '')) +
        /* THE NUDGE. If the clips land early the gap is too small: the video
           needs to run later, so + adds to it. Shown to the same people who may
           attach the video, saved as trim_ms, cumulative. */
        (lined && ctx.canEdit && ctx.onTrim
          ? '<span class="vidnudge">clips land early? ' +
            '<button data-n="1000" title="move every clip 1 s later">+1 s</button>' +
            '<button data-n="5000" title="move every clip 5 s later">+5 s</button>' +
            ' · late? <button data-n="-1000" title="move every clip 1 s earlier">−1 s</button>' +
            '<button data-n="-5000" title="move every clip 5 s earlier">−5 s</button>' +
            (v.trim_ms ? '<i>(' + (v.trim_ms > 0 ? '+' : '') + (v.trim_ms / 1000) + ' s)</i>' : '') + '</span>' : '') +
        (lined && timed && list.length
          ? '<button class="videxport" id="vidExport" title="every listed play as a clip list (JSON) for the labelling studio or an editor">export clips</button>' : '') +
        (lined && timed && list.length
          ? '<button class="videxport hl" id="vidHl" title="a vertical reel of the plays you choose, cut from the footage, the ball kept in frame">export highlights</button>' : '') +
      '</div>' +
      (st.hlOpen ? hlPanelHTML() : '');

  wire();
}

/* The worst-case stamp error among this game's timed plays (payload.wall_err,
   written by the ingest worker), or null for a log with none. */
function accuracyMs() {
  let worst = null;
  for (const e of ctx.events) {
    const x = e.wall_err;
    if (x == null || !isFinite(+x)) continue;
    if (worst == null || +x > worst) worst = +x;
  }
  return worst;
}

function exportClips() {
  const A = root0().EpinoiaVideoAnchor;
  if (!A) return;
  const v = ctx.video;
  const data = A.clipsExport(selected(), Object.assign({ gap_ms: V().gapMs(v) }, v), ctx.game, ctx.events);
  const name = ((ctx.game && ctx.game.home || 'game') + '-v-' + (ctx.game && ctx.game.away || '') + '-clips.json')
    .toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* perName/fmtClock live on the engine; the page has them as free variables in
   its own scope but this module does not, so they are reached deliberately. */
function perName(p) { return root0().EpinoiaEngine.perName(p); }
function fmtClock(ms) { return root0().EpinoiaEngine.fmtClock(ms); }

/* ------------------------------------------------------- export highlights --- */
/* THE REEL. A player (or a side, or everyone), the kinds of play wanted, portrait or landscape:
   the plays the page has already placed become clips, and the worker on the league's PC cuts
   them from the stream, follows the ball into a 9:16 frame and joins them. The finished MP4
   opens in the edit suite. Signed-in people only -- it is minutes of somebody's computer. */
const HL_KINDS = [['points', 'every point'], ['fg', 'field goals'], ['three', 'three-pointers'], ['reb', 'rebounds'],
                  ['ast', 'assists'], ['def', 'steals & blocks'], ['to', 'turnovers'], ['foul', 'fouls']];
function hlPanelHTML() {
  const who = st.pid ? (playerNameOf(st.pid) || 'this player') : (st.team !== '' ? ((ctx.S.teams[+st.team] || {}).name || 'this side') : 'everyone');
  const n = hlClips().length;
  const shown = selected().length;
  return '<div class="hlpanel">' +
    '<div class="hlh"><b>Export highlights</b><span>' + esc(who) + ' \u00b7 tick the plays in the list, or tick whole kinds here. Choose a player above to narrow it.</span></div>' +
    '<div class="hlkinds">' +
      '<label class="hlk"><input type="checkbox" id="hlAll"' + (shown && hlAllShownIn() ? ' checked' : '') + '> <b>every play listed</b> (' + shown + ')</label>' +
      HL_KINDS.map(k => { const c = hlKindCount(k[0]); return '<label class="hlk' + (c ? '' : ' none') + '"><input type="checkbox" data-k="' + k[0] + '"' + (c && hlKindAllIn(k[0]) ? ' checked' : '') + (c ? '' : ' disabled') + '> ' + esc(k[1]) + ' <i>' + c + '</i></label>'; }).join('') +
      '<button type="button" class="hlclear" id="hlNone">clear</button>' +
    '</div>' +
    '<div class="hlrow">' +
      '<label class="hlk"><input type="radio" name="hlOr" value="portrait"' + (st.hlOr !== 'landscape' ? ' checked' : '') + '> vertical 9:16 (Instagram, TikTok)</label>' +
      '<label class="hlk"><input type="radio" name="hlOr" value="landscape"' + (st.hlOr === 'landscape' ? ' checked' : '') + '> landscape</label>' +
      '<span class="hln">' + n + (n === 1 ? ' clip' : ' clips') + (n > 80 ? ' \u00b7 the first 80 go in' : '') + '</span>' +
      '<button class="ep-btn pri" id="hlGo"' + (n ? '' : ' disabled') + '>create the reel</button>' +
    '</div>' +
    '<div class="hlstatus" id="hlStatus">' + (st.hlMsg ? esc(st.hlMsg) : '') + '</div>' +
  '</div>';
}
function playerNameOf(pid) {
  let nm = null;
  (ctx.S.teams || []).forEach(t => (t.players || []).forEach(p => { if (p.id === pid) nm = p.name; }));
  return nm;
}
/* THE CHOICE IS A SET OF PLAYS, not a set of kinds. The kind boxes are shortcuts that tick or
   untick every play of that kind for the player (or side) chosen above; a row's own box is the
   last word. The first time the panel opens it is seeded with points, assists and defence. */
function hlSel() {
  if (!st.hlSel) {
    st.hlSel = new Set();
    ['points', 'ast', 'def'].forEach(k => hlKindPlays(k).forEach(p => st.hlSel.add(p.id)));
  }
  return st.hlSel;
}
function hlKindPlays(k) {
  return V().select(plays(), { filter: k, pid: st.pid || null, team: st.team === '' ? null : +st.team });
}
function hlKindCount(k) { return hlKindPlays(k).length; }
function hlKindAllIn(k) { const sel = hlSel(); const ps = hlKindPlays(k); return ps.length > 0 && ps.every(p => sel.has(p.id)); }
function hlAllShownIn() { const sel = hlSel(); const ps = selected(); return ps.length > 0 && ps.every(p => sel.has(p.id)); }
function hlKindOf(id) {
  for (const k of HL_KINDS) { if (V().select(plays(), { filter: k[0] }).some(p => p.id === id)) return k[0]; }
  return 'play';
}
function hlClips() {
  const sel = hlSel();
  const out = plays().filter(p => sel.has(p.id)).map(p => ({ id: p.id, start_ms: Math.round(p.start), end_ms: Math.round(p.end), label: p.label, kind: hlKindOf(p.id) }));
  return out.sort((a, b) => a.start_ms - b.start_ms).slice(0, 80);
}
async function hlCreate() {
  const F = root0().EpinoiaFollow;
  const sess = F && F.session();
  if (!sess) { location.href = '../signin/?next=' + encodeURIComponent(location.pathname + location.search); return; }
  const clips = hlClips();
  if (!clips.length) return;
  const c = root0().EPINOIA_CONFIG;
  st.hlMsg = 'sending\u2026'; render();
  const who = st.pid ? playerNameOf(st.pid) : null;
  const body = {
    game_id: ctx.game.id, requested_by: JSON.parse(atob(sess.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub,
    player_id: st.pid || null, player_name: who, kinds: HL_KINDS.map(k => k[0]).filter(hlKindAllIn),
    orientation: st.hlOr === 'landscape' ? 'landscape' : 'portrait', clips: clips
  };
  const r = await fetch(c.supabaseUrl + '/rest/v1/highlight_jobs', {
    method: 'POST', headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + sess.token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { st.hlMsg = 'could not ask: ' + (await r.text()).slice(0, 120); render(); return; }
  const row = (await r.json())[0];
  st.hlJob = row.id;
  st.hlMsg = 'queued \u2014 the reel is cut on the league\u2019s PC; it opens in the edit suite when ready (your bell will say)';
  render();
  hlWatch(sess);
}
let hlTimer = null;
function hlWatch(sess) {
  clearTimeout(hlTimer);
  const c = root0().EPINOIA_CONFIG;
  const tick = async () => {
    if (!st.hlJob) return;
    try {
      const r = await fetch(c.supabaseUrl + '/rest/v1/highlight_jobs?id=eq.' + st.hlJob + '&select=status,progress,output_path,error',
                            { headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + sess.token }, cache: 'no-store' });
      const j = (await r.json())[0];
      if (!j) return;
      const p = j.progress || {};
      if (j.status === 'done') { st.hlMsg = 'ready'; st.hlDone = j.output_path; render(); return; }
      if (j.status === 'failed') { st.hlMsg = 'failed: ' + (j.error || ''); render(); return; }
      st.hlMsg = (j.status === 'queued' ? 'queued' : (p.stage || 'working')) + (p.n ? ' \u00b7 ' + p.i + '/' + p.n : '') + (p.last ? ' \u00b7 ' + p.last : '');
      const el = host.querySelector('#hlStatus'); if (el) el.textContent = st.hlMsg;
    } catch (_) { /* next tick */ }
    hlTimer = setTimeout(tick, 5000);
  };
  tick();
}

/* ---------------------------------------------------------------- wiring --- */
function wire() {
  const hb = host.querySelector('#vidHl');
  if (hb) hb.onclick = () => { st.hlOpen = !st.hlOpen; render(); };
  const all = host.querySelector('#hlAll');
  if (all) all.onchange = () => { const sel = hlSel(); selected().forEach(p => { if (all.checked) sel.add(p.id); else sel.delete(p.id); }); render(); };
  const none = host.querySelector('#hlNone');
  if (none) none.onclick = () => { hlSel().clear(); render(); };
  host.querySelectorAll('.hlkinds input[data-k]').forEach(cb => {
    cb.onchange = () => {
      const sel = hlSel();
      hlKindPlays(cb.dataset.k).forEach(p => { if (cb.checked) sel.add(p.id); else sel.delete(p.id); });
      render();
    };
  });
  host.querySelectorAll('.hlpick').forEach(cb => {
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => {
      const sel = hlSel();
      if (cb.checked) sel.add(+cb.dataset.id); else sel.delete(+cb.dataset.id);
      /* the panel's counts follow; the list itself is left alone so the scroll stays put */
      const panel = host.querySelector('.hlpanel');
      if (panel) { const d = document.createElement('div'); d.innerHTML = hlPanelHTML(); panel.replaceWith(d.firstChild); wire(); }
    };
  });
  host.querySelectorAll('input[name="hlOr"]').forEach(rb => { rb.onchange = () => { st.hlOr = rb.value; }; });
  const go = host.querySelector('#hlGo');
  if (go) go.onclick = hlCreate;
  const done = host.querySelector('#hlStatus');
  if (done && st.hlDone) {
    done.innerHTML = 'ready \u2014 <a href="../edit/?hl=' + esc(st.hlJob) + '">open in the edit suite</a> \u00b7 <a href="' + esc(root0().EPINOIA_CONFIG.supabaseUrl + '/storage/v1/object/public/highlights/' + st.hlDone) + '" download>download the MP4</a>';
  }
  host.querySelectorAll('.vidtab').forEach(b => {
    b.onclick = () => { st.tab = b.dataset.tab; st.shown = PAGE; stopReel(); render(); };
  });
  host.querySelectorAll('.vidspan[data-seek]').forEach(b => {
    b.onclick = () => {
      if (b.disabled || b.dataset.seek === '') return;
      stopReel();
      st.current = b.dataset.cur;
      st.seekMs = +b.dataset.seek;
      paintStage();
      render();
      const on = host.querySelector('.vidspan.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    };
  });
  host.querySelectorAll('.vidchip').forEach(b => {
    b.onclick = () => { st.filter = b.dataset.f; st.shown = PAGE; stopReel(); render(); };
  });
  const who = host.querySelector('#vidWho');
  if (who) who.onchange = () => {
    const m = /^team:(\d)$/.exec(who.value);
    st.pid = m ? '' : who.value;
    st.team = m ? +m[1] : '';
    st.shown = PAGE; stopReel(); render();
  };
  const reel = host.querySelector('#vidReel');
  if (reel) reel.onchange = () => {
    st.reel = reel.checked;
    if (!st.reel) stopReel();
    else if (st.current != null) advanceAfter(st.current);
  };
  const more = host.querySelector('#vidMore');
  if (more) {
    const grow = () => { st.shown += PAGE; render(); };
    more.onclick = grow;
    more.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grow(); }
    };
  }
  host.querySelectorAll('.vidnudge button').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      const ok = ctx.onTrim ? await ctx.onTrim(+b.dataset.n) : false;
      if (!ok) { b.disabled = false; b.textContent = 'not saved'; }
    };
  });
  const ex = host.querySelector('#vidExport');
  if (ex) ex.onclick = exportClips;
  host.querySelectorAll('.vidlink').forEach(a => { a.onclick = e => e.stopPropagation(); });
  host.querySelectorAll('.viditem[data-id]').forEach(li => {
    const go = () => jumpTo(+li.dataset.id);
    li.onclick = e => { if (e.target && e.target.classList && e.target.classList.contains('hlpick')) return; go(); };
    li.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    };
  });
}

function jumpTo(id) {
  const list = selected();
  const i = list.findIndex(x => x.id === id);
  if (i === -1) return;
  const p = list[i];
  /* "In sequence" walks past the end of the window, and a row that is not in
     the document cannot be scrolled to or marked. */
  if (i >= st.shown) st.shown = Math.ceil((i + 1) / PAGE) * PAGE;
  st.current = id;
  st.seekMs = p.start;
  paintStage();              // the seek — the only thing that touches the frame
  render();                  // the list, to mark which row is playing
  /* Keep the chosen play in view. The list can be two hundred rows and the
     re-render puts the scroll back at the top of it otherwise. */
  const li = host.querySelector('.viditem.on');
  if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  if (st.reel) advanceAfter(id);
}

function advanceAfter(id) {
  stopReel();
  const list = selected();
  const i = list.findIndex(x => x.id === id);
  if (i === -1) return;
  const p = list[i];
  const next = list[i + 1];
  if (!next) return;
  /* Plus a beat for the player to actually start. Without it every clip in a
     sequence loses its first second to buffering and the run-up — the whole
     reason the clip starts early — is spent on a spinner. */
  const wait = Math.max(4000, (p.end - p.start) + 1800);
  reelTimer = setTimeout(() => jumpTo(next.id), wait);
}
function stopReel() { if (reelTimer) { clearTimeout(reelTimer); reelTimer = null; } }

/* ------------------------------------------------------------------ api --- */
/* `focus` lets a caller arrive with a player already chosen — which is how a
   link from a player's profile lands on the right list rather than on all
   four hundred plays of a game they were in. */
function render_(opts) {
  host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const fresh = !ctx || ctx.video !== opts.video || ctx.events !== opts.events;
  ctx = { video: opts.video, events: opts.events || [], S: opts.S, d: opts.d,
          canEdit: !!opts.canEdit, onTrim: opts.onTrim || null, game: opts.game || null };
  if (opts.focus && opts.focus.pid != null) st.pid = opts.focus.pid;
  if (opts.focus && opts.focus.filter) st.filter = opts.focus.filter;
  /* A new game, or a log that has been replaced wholesale, invalidates both
     the index and the mounted player. The same game redrawing does not — that
     is the whole point of the split above. */
  if (fresh) { indexed = null; indexedKey = ''; stinted = null; stintedKey = ''; }
  if (fresh || !host.querySelector('.vidbody')) mount();
  render();
  /* a link that names a play (?vs=<seq>) lands on it, playing */
  if (opts.focus && opts.focus.seq != null && st.current == null) {
    const want = String(opts.focus.seq);
    const p = selected().find(x => String(x.id) === want);
    if (p) jumpTo(p.id);
  }
}

function reset() {
  stopReel();
  st = { filter: 'all', pid: '', team: '', reel: false, current: null, seekMs: 0,
         tab: 'events', shown: PAGE };
  indexed = null; indexedKey = ''; stinted = null; stintedKey = ''; ctx = null;
}

return { render: render_, reset, state: () => st };
}));
