'use strict';
/* ============================================================================
   EPINOIA VIDEO — the play-by-play, on the footage.

   A game already has a complete, timed, attributed list of everything that
   happened: game_events. A video of that game is a second timeline over the
   same afternoon. This module is the join between them, and it exists so that
   "show me all his three-pointers" is a filter over a list we already have
   rather than an afternoon in an editor.

   THE JOIN IS WALL CLOCK, AND ONLY WALL CLOCK.

   Not the game clock — the game clock stops. Ten minutes of fourth quarter is
   twenty-five minutes of video, and the ratio is different in every game and
   in every quarter of it. The one axis both timelines actually share is the
   time of day, which the database stamps on every event as created_at and
   which the platform also knows for the moment the stream started.

     position in the video  =  gap  +  (this event's clock − tip-off's clock)

   where the gap is the dead air at the front — stream up, pre-game graphics,
   warm-ups, ball goes up. See migration 0082 for where those instants come
   from and why the gap is derived rather than stored.

   WHAT ABOUT THE STATISTICIAN'S REACTION TIME? A tap lands a second or two
   after the play it records. It very largely CANCELS: tip-off is a tap too, so
   the subtraction above removes whatever lag is common to both. What is left
   is well inside the eight seconds of run-up every clip gets, and the trim knob
   on the video row exists for the rest.

   Nothing here fetches anything or touches the DOM. It is arithmetic plus a
   list, so the box score, a player profile and any future editing tool all
   agree about where a play is without having to be kept in agreement.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVideo = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ---------------------------------------------------------------- URLs --- */
/* Every shape of link a person might actually paste. Deliberately permissive
   about the surroundings and strict about the id: a YouTube id is eleven
   characters of a known alphabet, so a mistyped link fails here rather than
   producing an embed of somebody else's video. */
const PATTERNS = [
  [/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/, 'youtube'],
  [/twitch\.tv\/videos\/(\d+)/, 'twitch'],
  [/twitch\.tv\/([A-Za-z0-9_]{3,25})\/?(?:$|\?)/, 'twitch-channel'],
  [/vimeo\.com\/(?:video\/)?(\d+)/, 'vimeo'],
  [/facebook\.com\/.+\/videos\/(\d+)/, 'facebook']
];

function parse(url) {
  const raw = String(url || '').trim();
  if (!raw) return { ok: false, provider: 'other', ref: '', url: '' };
  for (const [re, kind] of PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    if (kind === 'twitch-channel') {
      return { ok: true, provider: 'twitch', ref: m[1], url: raw, channel: true };
    }
    return { ok: true, provider: kind, ref: m[1], url: raw };
  }
  /* A direct file is a perfectly good answer and needs no id at all — a club
     with a recording on its own server should not be told to upload it to
     YouTube first. */
  if (/^https?:\/\/\S+\.(mp4|webm|m3u8)(\?\S*)?$/i.test(raw) && safeUrl(raw)) {
    return { ok: true, provider: 'mp4', ref: '', url: raw };
  }
  return { ok: false, provider: 'other', ref: '', url: raw };
}

/* ---------------------------------------------------------------- SAFETY ---
   A STORED URL IS UNTRUSTED INPUT, AND IT WAS REACHING AN IFRAME SRC.

   parse() only reports ok for a link it recognises, but nothing forced a
   caller to act on that: the row is written by whoever may score the game, and
   an unrecognised link was stored anyway and handed back verbatim by the
   default branches below. Rendered into <iframe src>, a javascript: URL runs
   in THIS page's origin — stored cross-site scripting on a public box score,
   reachable by anyone with a statistician's account. Escaping does not touch
   it: the string contains no quotes and no angle brackets, so it passes
   through esc() unchanged and is still a script.

   So there is one gate, and everything that can become a src goes through it.
   http and https only — not data:, not blob:, not javascript:, and not a
   protocol-relative //host that inherits whatever this page is served over.

   Deliberately a scheme ALLOWLIST rather than a javascript: blocklist. A
   blocklist has to anticipate ' javascript:', 'JaVaScRiPt:', a tab inside the
   word, and whatever the next one is; an allowlist has to anticipate nothing. */
function safeUrl(u) {
  const raw = String(u == null ? '' : u).trim();
  if (!raw) return '';
  try {
    /* Parsed rather than pattern-matched, so the browser's own reading of the
       string is what decides — the same reading the iframe would use. */
    const base = (typeof location !== 'undefined' && location.href) || 'https://x.invalid/';
    const parsed = new URL(raw, base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch (_) { return ''; }
}

/* The embed, seeked to a position.

   YouTube is given enablejsapi so a page that wants to drive it can, and
   origin so that API is allowed to talk back. Everything else takes a start
   parameter and that is all we need — seeking without the JS API means
   reloading the iframe, which is a beat slower and works everywhere. */
function embedSrc(v, opts) {
  const o = opts || {};
  const t = Math.max(0, Math.floor((o.ms || 0) / 1000));
  const auto = o.autoplay ? 1 : 0;
  const origin = (typeof location !== 'undefined' && location.origin) || '';
  switch (v && v.provider) {
    case 'youtube':
      return 'https://www.youtube.com/embed/' + encodeURIComponent(v.video_ref || v.ref || '') +
        '?start=' + t + '&autoplay=' + auto + '&rel=0&modestbranding=1&playsinline=1' +
        '&enablejsapi=1' + (origin ? '&origin=' + encodeURIComponent(origin) : '');
    case 'twitch': {
      const host = (typeof location !== 'undefined' && location.hostname) || 'localhost';
      const ref = v.video_ref || v.ref || '';
      const base = /^\d+$/.test(ref)
        ? 'https://player.twitch.tv/?video=' + encodeURIComponent(ref) + '&time=' + hms(t)
        : 'https://player.twitch.tv/?channel=' + encodeURIComponent(ref);
      return base + '&parent=' + encodeURIComponent(host) + '&autoplay=' + (auto ? 'true' : 'false');
    }
    case 'vimeo':
      return 'https://player.vimeo.com/video/' + encodeURIComponent(v.video_ref || v.ref || '') +
        '#t=' + t + 's';
    case 'facebook':
      return 'https://www.facebook.com/plugins/video.php?href=' +
        encodeURIComponent(v.url || '') + '&t=' + t;
    default:
      /* An unrecognised link is shown as itself or not at all — never as
         whatever scheme happened to be stored. */
      return safeUrl(v && v.url);
  }
}

/* Twitch wants 1h23m45s rather than a count of seconds. */
function hms(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h + 'h' + String(m).padStart(2, '0') + 'm' + String(s).padStart(2, '0') + 's';
}

/* Where to send somebody who would rather watch it on the platform itself —
   which is also the fallback when an embed is refused, and embeds do get
   refused: a channel can forbid them, and Facebook needs an app id. */
function watchHref(v, ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  switch (v && v.provider) {
    case 'youtube': return 'https://youtu.be/' + (v.video_ref || v.ref || '') + '?t=' + t;
    case 'twitch':  return 'https://www.twitch.tv/videos/' + (v.video_ref || v.ref || '') +
                           '?t=' + hms(t);
    case 'vimeo':   return 'https://vimeo.com/' + (v.video_ref || v.ref || '') + '#t=' + t + 's';
    default:        return safeUrl(v && v.url) || '#';
  }
}

/* --------------------------------------------- what the mixer already knows --
   A MIXER KNOWS THE PLATFORM, SO NOBODY SHOULD HAVE TO CHOOSE IT.

   OBS reports the ingest URL it is configured for, and an ingest host names
   its platform unambiguously. That is one fewer dropdown for somebody in a
   sports hall, and one fewer way to attach a Twitch link to a YouTube row. */
function providerFromServer(server, serviceName) {
  const hay = String(server || '') + ' ' + String(serviceName || '');
  if (/youtube/i.test(hay)) return 'youtube';
  if (/twitch/i.test(hay)) return 'twitch';
  if (/facebook|fbcdn/i.test(hay)) return 'facebook';
  if (/vimeo/i.test(hay)) return 'vimeo';
  return null;
}

/* WHATEVER THIS CHANNEL IS STREAMING RIGHT NOW.

   The one thing a mixer genuinely cannot tell us is the public watch URL:
   YouTube issues that to the broadcast, not to the encoder, and obs-websocket
   has no request that would return it. Guessing would be worse than asking.

   But YouTube publishes a stable embed for a channel's current live stream, so
   a league that has recorded its channel id once needs nothing typed per
   fixture — the box score embeds the channel and the right game is on it.

   IT DOES NOT SEEK, and it cannot: there is no video id to seek within, only
   "the live edge". So a game watched this way plays live and the play list
   waits for the archive link. That is stated in the interface rather than
   discovered by a viewer pressing a play and going nowhere. */
function liveEmbedSrc(platform, channelRef) {
  const ref = String(channelRef || '').trim();
  if (!ref) return null;
  const host = (typeof location !== 'undefined' && location.hostname) || 'localhost';
  if (platform === 'youtube') {
    return 'https://www.youtube.com/embed/live_stream?channel=' +
      encodeURIComponent(ref) + '&autoplay=0&rel=0&modestbranding=1&playsinline=1';
  }
  if (platform === 'twitch') {
    return 'https://player.twitch.tv/?channel=' + encodeURIComponent(ref) +
      '&parent=' + encodeURIComponent(host) + '&autoplay=false';
  }
  return null;
}

/* ------------------------------------------------------------ the anchor --- */
const ms = v => { const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : null; };

/* The dead air at the front, in milliseconds — or null when we cannot know it
   yet, which is a real and common state: a video registered before tip-off has
   no tip to measure from until the ball goes up.

   Returning null rather than zero is the whole point. Zero would silently
   claim every play is at the moment the stream started and send a viewer to
   an empty court, and nothing on the page would look wrong. */
/* TWO KINDS OF VIDEO, TWO WAYS OF KNOWING THE GAP.

     A RECORDING — somebody found the game on YouTube and read the jump ball
     off the scrub bar. What they have is a plain number: tip-off is 7:45 in.
     No clock is involved on any machine, so none can be wrong.

     A STREAM — the platform started it through OBS and knows the instant it
     began. The gap is the distance between two timestamps, both stamped by
     the database so no clock is compared across machines (see 0083).

   THE OFFSET WINS WHEN BOTH ARE PRESENT. A stream start is inferred from a
   mixer's own duration counter; an offset was typed by somebody looking at the
   footage everybody will actually watch. The person with the video in front of
   them is better informed than the encoder. */
function gapMs(v) {
  if (!v) return null;
  const trim = v.trim_ms || 0;

  const off = v.tip_offset_ms;
  if (off != null && isFinite(+off)) return (+off) + trim;

  const tip = ms(v.tip_at), start = ms(v.stream_started_at);
  if (tip == null || start == null) return null;
  return (tip - start) + trim;
}

/* Which of the two this row is, for anything that needs to say so out loud. */
function anchorKind(v) {
  if (!v) return null;
  if (v.tip_offset_ms != null && isFinite(+v.tip_offset_ms)) return 'recording';
  if (ms(v.tip_at) != null && ms(v.stream_started_at) != null) return 'stream';
  return null;
}
/* "CAN THIS VIDEO BE SEEKED TO A PLAY", which is what all four callers ask it.

   It used to be gapMs(v) != null, and that is only half the question. Placing
   a play needs the gap AND something to measure the play against — tip_wall
   for a device-stamped log, tip_at for an older one. A recording carrying only
   an offset satisfies the gap and nothing else: hasAnchor said yes, every
   videoMsOf returned null, and the tab drew an empty list under the words "tap
   one to jump to it". Nothing looked broken and nothing worked.

   Both halves, or it is not anchored. */
const hasAnchor = v => {
  if (gapMs(v) == null) return false;
  if (!v) return false;
  const tw = v.tip_wall;
  if (tw != null && isFinite(+tw)) return true;
  return ms(v.tip_at) != null;
};

/* How long after tip-off this event happened — the second of the two
   durations, and the one that decides whether a clip is on the play or on the
   dead ball after it.

   IT IS MEASURED ON THE SCORING DEVICE, NOT ON THE SERVER, whenever the
   scorer told us so. `payload.wall` is the scorer's own clock at the moment of
   the tap and `tip_wall` is the same clock at the tip, so the subtraction is
   one device against itself: a phone nine seconds fast cancels, and — much
   more importantly — a wifi drop cannot move anything, because the number was
   fixed before the row was ever sent.

   created_at is the fallback, and it is a real one: every game scored before
   this existed has nothing else, and a bulk import has nothing at all. It is
   the INSERT time, so it carries the coalescing frame, the network and any
   retry with it. Fine for a clip with eight seconds of run-up; useless for the
   stretch either side of an outage, which is exactly why it is second. */
function deviceStamp(e) {
  if (!e) return null;
  const w = e.wall;
  if (typeof w === 'number' && isFinite(w)) return w;
  if (w != null && isFinite(+w)) return +w;
  return null;
}
function tipStamp(v) {
  if (!v) return null;
  const tw = v.tip_wall;
  if (typeof tw === 'number' && isFinite(tw)) return tw;
  if (tw != null && isFinite(+tw)) return +tw;
  return null;
}

/* `allow` says which sources this caller will accept:
     'device' — only the tap stamp. A miss means "nobody tapped this live",
                which is a fact worth knowing rather than one to paper over.
     'insert' — only created_at, for a log that predates the tap stamp.
     'auto'   — device first, insert second. The single-event answer. */
function sinceTipMs(e, v, allow) {
  const mode = allow || 'auto';
  if (mode !== 'insert') {
    const w = deviceStamp(e), tw = tipStamp(v);
    if (w != null && tw != null) return w - tw;
    if (mode === 'device') return null;
  }
  const at = ms(e && (e.created_at || e.at));
  const tip = ms(v && v.tip_at);
  if (at == null || tip == null) return null;
  return at - tip;
}

/* An event's position in the footage. Accepts either the event itself — which
   is what every caller has, and the only form that can use the device clock —
   or a bare wall time, kept because the arithmetic is worth being able to
   check with one number in a test. */
function videoMsOf(atOrEvent, v) {
  const gap = gapMs(v);
  if (gap == null) return null;
  const since = (atOrEvent && typeof atOrEvent === 'object' && !(atOrEvent instanceof Date))
    ? sinceTipMs(atOrEvent, v)
    : sinceTipMs({ created_at: atOrEvent, at: atOrEvent }, v);
  if (since == null) return null;
  const pos = gap + since;
  /* Before the video existed is not a position in it. A pre-game event, or an
     event whose clock is wrong, would otherwise seek to a negative time and
     land wherever the player felt like. */
  return pos < 0 ? null : pos;
}

/* ------------------------------------------------- is this log even timed? --
   A LOG THAT WAS IMPORTED IN BULK HAS NO WALL CLOCK WORTH THE NAME.

   created_at is the moment a row was INSERTED, which for a game scored live is
   the moment of the play, and for a game imported from a CSV or a federation
   feed is the moment of the import — all eight hundred events inside the same
   second. Anchor a video to that and every clip in the game lands on the same
   frame, the page reports no error, and the feature looks like it works.

   The test is a physical one rather than a heuristic. Elapsed real time can
   never be LESS than elapsed game time: the clock stops, it does not run
   backwards, so forty minutes of basketball takes at least forty minutes of
   afternoon. A log whose first and last events are nine seconds apart is a log
   whose timestamps mean something other than when things happened.

   Deliberately generous — 60% rather than 100% — because a log can legitimately
   start late (a scorer who joined mid-first-quarter) or end early, and the
   failure this guards against is off by a factor of a hundred, not by a fifth. */
const PLEN = p => (p <= 4 ? 600000 : 300000);

function logIsTimed(events) {
  if (!Array.isArray(events) || events.length < 2) return false;
  let firstT = null, lastT = null, lastEv = null;
  for (const e of events) {
    /* The device stamp when there is one — a log that carries it is a log that
       was scored live, which is the thing being tested for. */
    const t = (typeof e.wall === 'number') ? e.wall : ms(e.created_at || e.at);
    if (t == null) continue;
    if (firstT == null || t < firstT) firstT = t;
    if (lastT == null || t > lastT) { lastT = t; }
    lastEv = e;
  }
  if (firstT == null || lastT == null || !lastEv) return false;

  /* How much game clock the log covers: whole periods before the last one,
     plus what had run off in it. */
  const per = Math.max(1, lastEv.period || 1);
  let played = 0;
  for (let q = 1; q < per; q++) played += PLEN(q);
  played += PLEN(per) - Math.max(0, Math.min(PLEN(per), lastEv.clock || 0));

  return (lastT - firstT) >= played * 0.6;
}

/* -------------------------------------------------------------- the clip --- */
/* How much of the run-up a play needs to make sense, by what kind of play it
   is. A three needs the ball moving before it; a rebound needs the miss; a
   foul needs whatever provoked it. These are the numbers that decide whether a
   highlight reel looks edited or looks like a machine cut it. */
const ROLL = {
  p3_made: [9500, 4500], p3_miss: [9000, 5500],
  p2_made: [8500, 4000], p2_miss: [8000, 5500],
  ft_made: [6000, 3000], ft_miss: [6000, 5000],
  reb:     [7500, 4000],
  ast:     [9000, 4000],
  stl:     [7000, 6500],
  blk:     [7000, 6000],
  to:      [7000, 5500],
  foul:    [8500, 5500],
  timeout: [6000, 2000],
  sub:     [4000, 3000],
  jump:    [5000, 6000],
  period_start: [3000, 8000],
  game_end:     [10000, 4000]
};
const DEFAULT_ROLL = [7000, 4500];

function clipOf(t) { return ROLL[t] || DEFAULT_ROLL; }

/* ------------------------------------------- plays that nobody tapped live --
   A PLAY PLACED BY HAND DID NOT HAPPEN WHEN IT WAS TYPED.

   The scorer can add an action that was missed, and can move one to a
   different game clock — that is deliberate and it is how a log gets corrected.
   Neither carries a truthful tap time: an add has none at all, and a move
   throws its own away (see saveEvModal). Falling through to created_at would
   put the clip at the moment somebody opened the editor, which on a play
   corrected at half-time is twenty minutes wrong and looks exactly as
   confident as a right answer.

   The plays either side of it are the answer. They were tapped live, they
   bracket it in the log, and the game clock says where between them it sits.
   Interpolating on cumulative elapsed game time is not perfect — the clock
   stops, so real time and game time do not run at one rate — but over the
   handful of seconds between two neighbouring events the error is small, and
   it is bounded by two facts instead of unbounded by one guess.

   With only one side available it offsets by elapsed game time alone, which
   UNDER-estimates (it ignores stoppages) and is still the right direction.
   With neither, the play gets no position and is left out rather than placed
   somewhere plausible. */
function cumElapsed(e) {
  const per = Math.max(1, e.period || 1);
  let s = 0;
  for (let q = 1; q < per; q++) s += PLEN(q);
  return s + (PLEN(per) - Math.max(0, Math.min(PLEN(per), e.clock || 0)));
}

function fillGaps(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].since != null) continue;
    let before = null, after = null;
    for (let j = i - 1; j >= 0; j--) if (rows[j].since != null) { before = rows[j]; break; }
    for (let j = i + 1; j < rows.length; j++) if (rows[j].since != null) { after = rows[j]; break; }

    const mine = cumElapsed(rows[i].e);
    if (before && after) {
      const a = cumElapsed(before.e), b = cumElapsed(after.e);
      const span = b - a;
      const frac = span > 0 ? Math.max(0, Math.min(1, (mine - a) / span)) : 0.5;
      rows[i].since = before.since + (after.since - before.since) * frac;
      rows[i].guessed = true;
    } else if (before) {
      rows[i].since = before.since + (mine - cumElapsed(before.e));
      rows[i].guessed = true;
    } else if (after) {
      rows[i].since = after.since - (cumElapsed(after.e) - mine);
      rows[i].guessed = true;
    }
  }
  return rows;
}

/* ------------------------------------------------------------- the index --- */
/* Turn a game's event log into a list of watchable plays.

   `events` are rows as they come back from PostgREST — the flat shape with
   created_at still on them. `label` is supplied by the caller because naming a
   player is the box score's job, not this module's: engine.js already writes
   those lines and there is no reason to have a second wording of them. */
function index(events, video, opts) {
  const o = opts || {};
  const label = o.label || (e => e.t);
  const out = [];
  if (!Array.isArray(events)) return out;

  const gap = gapMs(video);
  if (gap == null) return out;

  /* Two passes. The first takes every play that can say for itself how long
     after tip it happened; the second fills in the ones that cannot, from
     their neighbours. Doing it in one pass would mean a hand-placed play could
     only ever look backwards. */
  /* WHICH KIND OF LOG IS THIS?

     A log that carries tap stamps anywhere is a log that was scored live, and
     in one of those a MISSING stamp is not an old event — it is a play that
     was added or re-timed by hand, whose created_at is the moment somebody
     opened the editor. Reading that as the time of the play is what put a
     corrected first-quarter basket at half-time.

     A log with no tap stamps at all is a different animal: an older game, or
     an import. There, created_at is the only thing there is and it is used for
     everything, exactly as before. */
  const timedByDevice = tipStamp(video) != null &&
                        events.some(e => deviceStamp(e) != null);
  const mode = timedByDevice ? 'device' : 'insert';

  const rows = [];
  for (const e of events) {
    /* Descriptors are not plays. A 'loc', a 'tag' and a 'stype' each decorate
       an event that is already in this list; including them would show the
       same basket three times. */
    if (e.t === 'loc' || e.t === 'tag' || e.t === 'stype') continue;
    if (o.skipStructural && (e.t === 'sub' || e.t === 'period_start' ||
                             e.t === 'jump' || e.t === 'game_end')) continue;
    rows.push({ e: e, since: sinceTipMs(e, video, mode) });
  }
  fillGaps(rows);

  for (const row of rows) {
    if (row.since == null) continue;
    const e = row.e;
    const pos = gap + row.since;
    if (pos < 0) continue;
    const [pre, post] = clipOf(e.t);
    out.push({
      id: e.seq != null ? e.seq : e.id,
      t: e.t,
      pid: e.pid != null ? e.pid : (e.payload || {}).pid || null,
      team: e.team != null ? e.team : null,
      period: e.period, clock: e.clock,
      at: e.created_at || e.at || null,
      ms: pos,
      /* Marked, because a reader deciding whether a clip is worth clipping
         should know which ones were placed rather than timed. */
      approx: !!row.guessed,
      start: Math.max(0, pos - pre),
      end: pos + post,
      label: label(e)
    });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/* ------------------------------------------------------------- filtering --- */
/* The questions a person actually arrives with. Each is a predicate over the
   indexed play plus the player id the page is focused on, if any. */
const FILTERS = [
  { key: 'all',    label: 'everything',   fn: () => true },
  { key: 'points', label: 'every point',
    fn: p => p.t === 'p2_made' || p.t === 'p3_made' || p.t === 'ft_made' },
  { key: 'fg',     label: 'field goals',
    fn: p => /^p[23]_(made|miss)$/.test(p.t) },
  { key: 'three',  label: 'three-pointers', fn: p => /^p3_/.test(p.t) },
  { key: 'reb',    label: 'rebounds',     fn: p => p.t === 'reb' },
  { key: 'ast',    label: 'assists',      fn: p => p.t === 'ast' },
  { key: 'def',    label: 'steals & blocks',
    fn: p => p.t === 'stl' || p.t === 'blk' },
  { key: 'to',     label: 'turnovers',    fn: p => p.t === 'to' },
  { key: 'foul',   label: 'fouls',        fn: p => p.t === 'foul' }
];
const filterBy = key => (FILTERS.find(f => f.key === key) || FILTERS[0]).fn;

function select(plays, opts) {
  const o = opts || {};
  const fn = filterBy(o.filter);
  return plays.filter(p =>
    (!o.pid || p.pid === o.pid) &&
    (o.team == null || p.team === o.team) &&
    (!o.period || p.period === o.period) &&
    fn(p));
}

/* ---------------------------------------------------------------- format --- */
/* m:ss into the video, which is what a person reads off a scrub bar, with an
   hour only when there is one — 1:02:11 rather than 62:11. */
function stamp(msIn) {
  const t = Math.max(0, Math.floor((msIn || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) +
         ':' + String(s).padStart(2, '0');
}

/* AN HOUR AND A HALF OF DEAD AIR IS PROBABLY A MISTAKE, AND MIGHT NOT BE.

   The live anchor is taken from the mixer's own duration counter, which is
   right about how long IT has been streaming and knows nothing about which
   game is on. Leave OBS running after the early fixture, open the control room
   for the late one, and it reports three hours — so every clip in the second
   game is three hours out and nothing anywhere says so.

   But a league that runs both games on ONE continuous stream has a genuinely
   three-hour offset, and refusing it would break the case it was built for. So
   this flags and never blocks: the number is shown, the doubt is shown beside
   it, and the person who can see both the hall and the stream decides.

   Only the live anchor is questioned. A typed offset was read off the footage
   by somebody looking at it, and second-guessing that would be impertinent. */
const ODD_GAP_MS = 90 * 60 * 1000;

function gapLooksOdd(v) {
  if (!v) return false;
  if (anchorKind(v) !== 'stream') return false;
  const g = gapMs(v);
  return g != null && g > ODD_GAP_MS;
}

/* The gap, written the way the person setting it thinks about it: "the stream
   was up eleven and a half minutes before the ball went up". Signed, because
   somebody who started recording after the tip has a negative one and needs to
   see that rather than a confusing large number. */
function gapText(v) {
  const g = gapMs(v);
  if (g == null) return 'not lined up yet';
  const sign = g < 0 ? '−' : '';
  return sign + stamp(Math.abs(g)) + ' before tip-off';
}

return { parse, safeUrl, embedSrc, watchHref, gapMs, anchorKind, gapLooksOdd,
         hasAnchor, videoMsOf, sinceTipMs,
         cumElapsed, logIsTimed,
         liveEmbedSrc, providerFromServer,
         index, select, FILTERS, filterBy, stamp, gapText, clipOf, ROLL };
}));
