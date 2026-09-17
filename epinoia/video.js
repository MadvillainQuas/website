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

/* LEEWAY. Every seek lands this much earlier again than the run-up asks for.
   A play's position is a best estimate — a poll interval, a clock reading, a
   score change pulled back to the basket — and an estimate that is a second
   late cuts the shot off; one that is two seconds early shows the whole play
   with a breath before it. Two seconds early is never wrong. */
const LEEWAY_MS = 2000;

/* A PLAY WE ARE LESS SURE OF NEEDS MORE ROOM IN FRONT OF IT.

   A fed play is stamped with the poll that SAW it, and payload.wall_err says how
   far back it could really have happened — a whole poll interval. At the ordinary
   ten-second live cadence that eats the entire run-up: the clip can open a second
   and a half before the shot, which shows the ball going in and nothing of how it
   was made. The number is already on the row; spending it here is what turns a
   technically-correct position into a clip worth watching.

   Capped, because the error can legitimately be large — a first write covering a
   minute and a half of play carries that minute and a half — and a three-minute
   run-up is not a highlight, it is the game. Past the cap the honest answer is the
   accuracy figure the tab already shows, not a longer clip. */
const ERR_ROOM_MAX = 15000;
function clipOf(t, errMs) {
  const r = ROLL[t] || DEFAULT_ROLL;
  const err = (errMs != null && isFinite(+errMs) && +errMs > 0) ? Math.min(+errMs, ERR_ROOM_MAX) : 0;
  return [r[0] + LEEWAY_MS + err, r[1]];
}

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

/* HOW MUCH REAL TIME A SECOND OF GAME CLOCK COSTS, measured from the rows that
   do know when they happened.

   A play with neighbours on BOTH sides is interpolated between them, and that
   absorbs every stoppage between the two by construction. A play with only one
   neighbour has to be projected, and projecting needs a rate — game clock and
   real time do not run together. Forty minutes of basketball inside a
   ninety-minute broadcast is about 2:1, and it is nowhere near uniform: a free
   throw pair, a timeout and a foul all cost real time and no game clock at all.

   So the rate is taken from the log itself: the first and last rows that carry a
   real position, which is the longest baseline available. Bounded to a sane
   band, because a nonsense rate is worse than no rate — under 1 would mean the
   game ran faster than the clock on the wall, and over 4 would mean a broadcast
   four times the length of the game it covers, which is a different recording. */
function paceOf(rows) {
  let first = null, last = null;
  for (const r of rows) {
    if (r.since == null || r.guessed) continue;
    if (!first) first = r;
    last = r;
  }
  if (!first || !last || first === last) return null;
  const dg = cumElapsed(last.e) - cumElapsed(first.e);
  const dr = last.since - first.since;
  if (!(dg > 0) || !(dr > 0)) return null;
  const p = dr / dg;
  return (p >= 1 && p <= 4) ? p : null;
}

/* Beyond this much game clock from its only neighbour, a play is not placed at
   all. Ten minutes is a whole quarter: the accumulated stoppage error over one
   is larger than any clip window, and by then the position is a guess dressed as
   an answer. An absent row is interpolated by nothing and shown by nothing,
   which is the honest outcome — the alternative is a viewer sent to the wrong
   quarter by a list that looked authoritative. */
const LONE_REACH_MS = 600000;

/* ONE STAMP CANNOT COVER MORE GAME THAN ITS ERROR BAR.

   A poll stamps every row it writes with its own instant and says how far back
   they could have happened (wall_err). Real time between two plays is never less
   than the game time between them, so a row that is more than wall_err of game
   clock before the latest row sharing its stamp cannot have happened within
   wall_err of that stamp. Such a stamp is not a time for that row at all.

   2026-09-12, measured against the footage: the old delete-then-insert rewrite lost
   its later batches, the next poll re-added 348 plays (a40d3cef) and 541 plays
   (8d63f891) as "new", and every one of them got that poll's instant with a
   10.5 s bar -- first-quarter plays placed up to 78 minutes late, confidently.

   So those rows are read as unstamped: fillGaps interpolates them from honest
   neighbours (and marks them approximate), a clock track places them if it can,
   and otherwise they are left out. Three seconds of slack for a clock that keys
   in whole seconds and a statistician's reaction. */
const BATCH_SLACK_MS = 3000;

/* AND AN INSERT TIME IS A BATCH STAMP TOO: THE WORST ONE THERE IS.

   The rule above was written for the device stamp and only ever consulted that,
   which left the fallback clock unguarded: a log with no tap stamps at all is
   placed by created_at, and created_at is the moment a row was WRITTEN. One
   ingest rewrite writes hundreds of rows inside a single transaction, so they
   all carry one instant, and every one of them was placed on it.

   52bfe03b (Milton Keynes Breakers v Loughborough Riders, 2026-09-13), measured:
   784 rows share five insert instants. Twenty plays covering the first four
   minutes of the game all sat at 13:28 of the footage, the first listed play
   among them, so the tab opened on a passage where the score was 7-9 with 7:52
   on the clock. A further 668 rows, re-inserted in bulk hours after the game,
   shared one instant six hours into a video an hour and fifty-five long.

   Same physics, same conclusion: a row more than the batch's error bar of game
   clock behind the latest row sharing its stamp did not happen at that stamp,
   so the stamp is not a time for it. The bar is wider here than for a tap,
   because an insert time carries the coalescing frame, the network and any
   retry with it: fifteen seconds of game clock is about the most one ordinary
   write can honestly cover, and it leaves the last few plays of each batch
   anchored so fillGaps has something real to interpolate between. */
const INSERT_SLACK_MS = 15000;

function distrustedStamps(events, mode) {
  /* 'insert' groups by created_at, the clock index() will actually place by in
     that mode; anything else groups by the tap stamp, as before. */
  const byInsert = mode === 'insert';
  const stampOf = byInsert ? (e => ms(e.created_at || e.at)) : deviceStamp;
  const slack = byInsert ? INSERT_SLACK_MS : BATCH_SLACK_MS;
  const byWall = new Map();
  for (const e of events || []) {
    if (!e || e.t === 'loc' || e.t === 'tag' || e.t === 'stype') continue;
    const w = stampOf(e);
    if (w == null) continue;
    let g = byWall.get(w);
    if (!g) byWall.set(w, g = []);
    g.push(e);
  }
  const out = new Set();
  byWall.forEach(g => {
    if (g.length < 2) return;
    let latest = -Infinity, err = 0;
    for (const e of g) {
      latest = Math.max(latest, cumElapsed(e));
      /* An insert time has no error bar of its own, nothing measured it, so
         the slack above is the whole allowance. A poll's wall_err is real and
         is still honoured. */
      const x = byInsert ? NaN : +e.wall_err;
      if (isFinite(x) && x > err) err = x;
    }
    for (const e of g) if (latest - cumElapsed(e) > err + slack) out.add(e);
  });
  return out;
}

function fillGaps(rows) {
  const pace = paceOf(rows);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].since != null) continue;
    /* A GUESS IS NOT AN ANCHOR, OR THE GUESS BECOMES THE GAME.

       These two scans took any row that had a position, and by the time the
       loop reached row i the rows behind it included the ones this same loop
       had just invented. So a single honest stamp seeded a chain: row 200 was
       projected from it, row 201 from row 200, row 202 from row 201, each hop
       adding its own stoppage error, and forty minutes of basketball was laid
       out at the projection's pace with nothing left to contradict it. The
       LONE_REACH_MS bound below was supposed to stop a projection running away
       and could not: every hop was inside ten minutes of its predecessor.

       Only a row that knows when it happened may say where another one is.
       Rows that no honest neighbour can reach are then left unplaced, which is
       the point: 52bfe03b lists 138 of its 357 plays instead of stretching all
       of them across footage the log cannot vouch for. Whoever reads the list
       is told so by coverageNote below rather than left to assume.

       (The forward scan cannot meet a guessed row, because the loop runs forwards, so
       nothing ahead of i has been filled yet, but it is written the same way
       so the rule does not depend on the direction of a loop.) */
    let before = null, after = null;
    for (let j = i - 1; j >= 0; j--) if (rows[j].since != null && !rows[j].guessed) { before = rows[j]; break; }
    for (let j = i + 1; j < rows.length; j++) if (rows[j].since != null && !rows[j].guessed) { after = rows[j]; break; }

    /* AND AN INTERPOLATION HAS TO ACTUALLY BRACKET THE ROW IN GAME TIME.

       The neighbours are found by position in the LOG, on the reasonable-looking
       assumption that a log runs in the order the game did. 52bfe03b does not:
       the ingest rewrite renumbered it, so seq 205 is a foul at Q1 4:14 sitting
       eighty rows after plays from Q1 4:11 onwards. Its honest neighbours either
       side of those plays were therefore both at 5:46 of elapsed game time, a
       span of zero, and the old code answered that with frac = 0.5 and gave
       thirty-two plays covering ten minutes of basketball one identical position.
       Clamping frac to [0,1] does the same, quietly, whenever the row is outside
       its neighbours rather than between them.

       So a bracket is required, and when there is not one the row is projected
       from whichever neighbour is NEARER in game time, which is bounded by
       LONE_REACH_MS and declines rather than inventing. */
    const mine = cumElapsed(rows[i].e);
    const a = before ? cumElapsed(before.e) : null;
    const b = after ? cumElapsed(after.e) : null;
    if (before && after && b > a && mine >= a && mine <= b) {
      rows[i].since = before.since + (after.since - before.since) * ((mine - a) / (b - a));
      rows[i].guessed = true;
    } else if (before || after) {
      /* ONE USABLE NEIGHBOUR, SO A PROJECTION — AT THE MEASURED RATE, AND NOT FOR
         EVER. Both branches used to add the game-clock difference straight onto the
         neighbour's position, which says a second of stopped clock costs no real
         time. It is the case that matters most right now: when a feed correction
         un-times the early part of a log, every surviving stamp is LATER than the
         gap, so every unplaced play in the first half has exactly one neighbour
         and all of them were being projected backwards at 1:1. */
      const anchor = (before && after)
        ? (Math.abs(mine - a) <= Math.abs(mine - b) ? before : after)
        : (before || after);
      const d = mine - cumElapsed(anchor.e);          // signed: negative looking back
      if (Math.abs(d) > LONE_REACH_MS) continue;      // too far to place honestly
      rows[i].since = anchor.since + d * (pace || 1);
      rows[i].guessed = true;
    }
  }
  return rows;
}

/* A play's position from a clock track: the reading at exactly its clock, or the
   interpolation between the readings either side (kept identical to
   videoanchor.js positionFromTrack). */
/* ------------------------------------------------------- the clock's runs --- */
/* THE CLOCK RUNS AND STOPS, AND THAT IS THE MAP. A clock track is a thousand readings of
   the overlay two seconds apart; what they describe is a few dozen stretches where the
   clock ran at the speed of time and the whistles between them. Those stretches -- runs --
   are the honest shape of the game: inside one, any clock value is a fixed second of video;
   between two, the clock stood still and the moment a play "happened" is the whistle that
   stopped it. The worker writes `runs` with the track (clock.py runs_from_samples); a track
   without them gets the same runs derived here, once, from its readings. */
function runsFromTrack(track) {
  if (!track) return [];
  if (Array.isArray(track.runs) && track.runs.length) return track.runs;
  if (track._runs) return track._runs;
  const S = (track.samples || []).filter(x => x && x.clock_ms != null && x.period != null && x.t != null)
    .slice().sort((x, y) => (x.period - y.period) || (x.t - y.t));
  const runs = [];
  let cur = null;
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    const dt = b.t - a.t, dc = (a.clock_ms - b.clock_ms) / 1000;
    /* the clock ran between these two readings: it fell by (about) the time that passed */
    const ran = a.period === b.period && dt > 0 && dt <= 30 && dc > 0 &&
                Math.abs(dc - dt) <= Math.max(1.5, 0.25 * dt);
    if (ran) {
      if (cur && cur.period === a.period && cur.t1 === a.t) { cur.t1 = b.t; cur.c1 = b.clock_ms; cur.n++; }
      else { if (cur) runs.push(cur); cur = { period: a.period, t0: a.t, t1: b.t, c0: a.clock_ms, c1: b.clock_ms, n: 2 }; }
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  /* a run is at least three readings and four seconds: two misreads in a row are not a run */
  const out = runs.filter(r => r.n >= 3 && (r.t1 - r.t0) >= 4).map(r => ({ period: r.period, t0: r.t0, t1: r.t1, c0: r.c0, c1: r.c1 }));
  try { Object.defineProperty(track, '_runs', { value: out, enumerable: false, configurable: true }); } catch (_) { /* frozen */ }
  return out;
}
/* the stoppages: between one run's end and the next run's start, the clock stood at c */
function stopsFromRuns(runs) {
  const out = [];
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1], b = runs[i];
    if (a.period === b.period && b.t0 > a.t1) out.push({ period: a.period, t0: a.t1, t1: b.t0, c: a.c1 });
  }
  return out;
}
/* where in the video a (period, clock) sits, by the runs: inside a run it is arithmetic;
   in a stoppage it is the whistle that began it; null when the period has no runs */
/* A GAP BETWEEN TWO RUNS IS NOT AUTOMATICALLY A STOPPAGE, and how much clock
   went missing across it says which it was.

   If the clock STOOD still, the reading either side of the gap is the same, and
   the moment a play "happened" is the whistle that stopped it — the end of the
   first run, which is what this always returned.

   But the clock also keeps running through a stretch the overlay cannot be read
   in: a full-screen replay, a scorebug graphic over the corner, a camera cut to
   the bench. runsFromTrack breaks a run when two readings are more than thirty
   seconds apart or the clock did not fall by about the time between them, so an
   unreadable-but-running stretch leaves two runs whose clocks do NOT meet. Every
   play in it was then placed on the last readable frame, and so were all the
   others — a minute of basketball collapsed onto one instant.

   The two cases are told apart by the clock itself. Standing still: c1 and the
   next c0 agree. Running through: the clock fell by roughly the real time that
   passed, so the fall is the measure of how far through the gap a given clock
   value sits. */
const GAP_STOOD_MS = 1500;

/* And how far outside the read runs a position may be projected at all.
   Beyond this the projection crosses stoppages nobody read, at a second of
   footage per second of clock, and the error is unbounded — the audit case was
   six minutes. Declining is cheap here in a way it is not elsewhere: index()
   falls back to the wall-clock arithmetic for a play the track will not vouch
   for, so the play keeps a position, just not this one's opinion of it. */
const RUN_REACH_MS = 120000;

function positionFromRuns(runs, period, clockMs) {
  const R = runs.filter(r => r.period === period).sort((x, y) => x.t0 - y.t0);
  if (!R.length) return null;
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    if (clockMs <= r.c0 && clockMs >= r.c1) return (r.t0 + (r.c0 - clockMs) / 1000) * 1000;
    const next = R[i + 1];
    if (next && clockMs < r.c1 && clockMs > next.c0) {
      const fell = r.c1 - next.c0;            // clock lost across the gap
      if (fell <= GAP_STOOD_MS) return r.t1 * 1000;   // it stood: the whistle is the moment
      /* it ran, unread: place proportionally through the gap */
      const frac = Math.max(0, Math.min(1, (r.c1 - clockMs) / fell));
      return (r.t1 + (next.t0 - r.t1) * frac) * 1000;
    }
  }
  const first = R[0], last = R[R.length - 1];
  if (clockMs > first.c0) {
    if (clockMs - first.c0 > RUN_REACH_MS) return null;
    return Math.max(0, first.t0 - (clockMs - first.c0) / 1000) * 1000;
  }
  if (clockMs < last.c1) {
    if (last.c1 - clockMs > RUN_REACH_MS) return null;
    return (last.t1 + (last.c1 - clockMs) / 1000) * 1000;
  }
  return null;
}
/* the readings themselves, for a period the runs do not cover */
function positionFromSamples(track, period, clockMs) {
  const S = track && Array.isArray(track.samples) ? track.samples.filter(s => s.period === period) : [];
  if (!S.length) return null;
  S.sort((a, b) => a.t - b.t);
  let before = null, after = null;
  for (const s of S) {
    if (s.clock_ms > clockMs) before = s;
    else { after = s; break; }
  }
  if (after && after.clock_ms === clockMs) return after.t * 1000;
  if (before && after) {
    const span = before.clock_ms - after.clock_ms;
    /* less footage between two readings than game clock between them cannot be one
       stretch of the same game: one of the two is a misread, and neither is vouched for */
    if (span > 0 && (after.t - before.t) * 1000 < span - 5000) return null;
    const frac = span > 0 ? (before.clock_ms - clockMs) / span : 0;
    return (before.t + (after.t - before.t) * frac) * 1000;
  }
  /* OUTSIDE THE READINGS, AND ONLY SO FAR -- the bound positionFromRuns and videoanchor.js
     already keep. This fallback had none, and a track that read only the last two minutes
     of a game placed the first quarter by projecting backwards from them, byClock, with
     full confidence (106394dc, 2026-09-12: 215 plays). */
  if (before) {
    if (before.clock_ms - clockMs > RUN_REACH_MS) return null;
    return (before.t + (before.clock_ms - clockMs) / 1000) * 1000;
  }
  if (after) {
    if (clockMs - after.clock_ms > RUN_REACH_MS) return null;
    return Math.max(0, (after.t - (clockMs - after.clock_ms) / 1000)) * 1000;
  }
  return null;
}

/* A READING THE GAME COULD NOT HAVE PRODUCED IS NOT A READING.

   The clock reader reads whatever clock is on screen. Before a game that is the
   pre-game countdown, which looks exactly like a first-quarter clock: on 8d63f891
   (2026-09-12) it put all 105 first-quarter plays between 0:15 and 0:31 of a video
   whose tip was at 1:03:20. And a misread period digit lands a "Q1 2:22" in the
   middle of the fourth quarter (106394dc). Each looked like the game clock, and the
   page placed plays by them ahead of everything else.

   When the video is anchored, every reading can be checked against physics. A
   reading of (period, clock) says the game had run E of game time, and it sits
   at footage time t, i.e. t - tip into the game in real time. Real time since the
   tip can never be less than E, and in a real game does not run past about four
   times E plus a half-time and change. Three minutes of slack below, because the
   tip's own stamp can be a poll late; 35 minutes above, for the break. Readings
   outside that window are dropped before any play is placed or any run is built.

   With no anchor there is nothing to check against, and only the confidence rule below applies. */
const SANE_BELOW_MS = 180000, SANE_ABOVE_MS = 35 * 60000, SANE_RATIO = 4, SANE_MIN_CONF = 0.3;
const saneCache = new WeakMap();
function saneTrack(track, video) {
  if (!track || !Array.isArray(track.samples)) return track;
  const gap = gapMs(video);
  const hit = saneCache.get(track);
  if (hit && hit.gap === gap) return hit.out;
  const ok = (period, clockMs, tSec) => {
    if (gap == null) return true;
    const E = cumElapsed({ period, clock: clockMs });
    const since = tSec * 1000 - gap;
    return since >= E - SANE_BELOW_MS && since <= E * SANE_RATIO + SANE_ABOVE_MS;
  };
  /* ...and a reading its own reader was not sure of is not one either. The reader scores
     every reading; on the tracks read so far the scores split cleanly, the real readings at
     0.6 and above and the guesses under 0.1 (168 of 176 "first-quarter" readings on
     8d63f891). 0.3 sits in the empty middle. A reading with no score is an older track's
     and is kept. */
  const sure = x => x.conf == null || !(+x.conf < SANE_MIN_CONF);
  const samples = track.samples.filter(s => s && s.period != null && s.clock_ms != null && s.t != null &&
                                            sure(s) && ok(s.period, s.clock_ms, s.t));
  const runs = Array.isArray(track.runs)
    ? track.runs.filter(r => ok(r.period, r.c0, r.t0) && ok(r.period, r.c1, r.t1))
    : track.runs;
  const out = Object.assign({}, track, { samples, runs, dropped: track.samples.length - samples.length });
  saneCache.set(track, { gap, out });
  return out;
}

/* THE SAME PHYSICS, ASKED OF A STAMP RATHER THAN OF A READING.

   saneTrack refuses a clock reading the game could not have produced, and the
   argument has nothing to do with where the number came from: a play that had
   run E of game clock cannot sit more than about four times E plus an interval
   after the tip, however confidently something stamped it. Only the tracks were
   ever asked.

   So the upper half of that window is asked of a wall or insert position too.
   Not the lower half: a log can legitimately begin late: a scorer who joined
   mid-quarter, a feed whose first poll covers ninety seconds of play, and
   refusing those would throw away honest rows to catch nothing.

   52bfe03b, measured: 668 rows re-inserted at 21:55 of the evening for a game
   that tipped at 16:05 said their plays happened five hours and fifty minutes
   after tip-off. Two hundred and fifty-six of them survived every other guard
   and were listed at 6:03:11 of a video one hour fifty-five long. This refuses
   all of them and costs one honestly-placed play elsewhere; the rows are then
   interpolated from their neighbours, or left out.

   A refused stamp is not a refused play. It returns null, which is the same
   state as no stamp at all, so fillGaps still gets its chance at the row. */
function stampIsPossible(e, sinceMs) {
  if (sinceMs == null) return false;
  return sinceMs <= cumElapsed(e) * SANE_RATIO + SANE_ABOVE_MS;
}
function positionFromTrack(track, period, clockMs) {
  if (!track) return null;
  const runs = runsFromTrack(track);
  const byRuns = positionFromRuns(runs, period, clockMs);
  if (byRuns != null) return byRuns;
  /* A CLOCK TRACK THAT NEVER SAW A QUARTER'S CLOCK RUN HAS NOT READ THAT QUARTER.
     The readings behind the runs are there to place a play just outside a run, not to
     stand in for one: on 8d63f891 (2026-09-12) the reader never locked onto the first
     quarter, and two stray "0:00" readings in the middle of it would have placed the
     whole quarter by projection. A score track is different -- its readings ARE the
     baskets -- so it keeps them. */
  if (track.mode && /clock/.test(track.mode) && !runs.some(r => r.period === period)) return null;
  return positionFromSamples(track, period, clockMs);
}
const positionFromTrackLocal = positionFromTrack;

/* ---------------------------------------------------------- who was on --- */
/* THE MINUTES, FROM THE LOG. Starters open the game; every substitution closes one man's
   interval and opens another's, and closes the five and opens a new five; a period ends at
   0:00 and the next opens at its full length. Each interval is (period, from-clock, to-clock),
   which the runs then turn into seconds of video. Nothing is estimated: the clock values are
   the log's own, the same ones the plays are placed by. */
function stints(events, starters, opts) {
  const o = opts || {};
  const perLen = p => (o.periodMs && o.periodMs[p]) || (p <= 4 ? 600000 : 300000);
  const on = [new Set((starters && starters[0]) || []), new Set((starters && starters[1]) || [])];
  if (!on[0].size && !on[1].size) return { players: [], lineups: [], known: false };
  const players = [], lineups = [];
  const openP = {};                 // pid -> {team, period, c0}
  const openL = [null, null];       // team -> {ids, period, c0}
  const key = ids => [...ids].sort().join(',');
  const closeP = (pid, period, c1) => {
    const x = openP[pid]; if (!x) return;
    if (x.period === period && x.c0 > c1) players.push({ pid, team: x.team, period, c0: x.c0, c1 });
    delete openP[pid];
  };
  const closeL = (team, period, c1) => {
    const x = openL[team]; if (!x) return;
    if (x.period === period && x.c0 > c1) lineups.push({ team, ids: x.ids, key: key(x.ids), period, c0: x.c0, c1 });
    openL[team] = null;
  };
  const openAll = (period, c0) => {
    [0, 1].forEach(team => {
      on[team].forEach(pid => { openP[pid] = { team, period, c0 }; });
      openL[team] = { ids: [...on[team]].sort(), period, c0 };
    });
  };
  const closeAll = (period, c1) => {
    Object.keys(openP).forEach(pid => closeP(pid, period, c1));
    [0, 1].forEach(team => closeL(team, period, c1));
  };
  let period = null;
  const evs = (events || []).filter(e => e && e.t !== 'loc' && e.t !== 'tag' && e.t !== 'stype');
  for (const e of evs) {
    const ep = e.period || 1, ec = e.clock != null ? e.clock : perLen(ep);
    if (period == null) { period = ep; openAll(ep, e.t === 'period_start' ? ec : perLen(ep)); if (e.t === 'period_start') continue; }
    if (ep !== period) {              // a period ended at 0:00 and this one opens in full
      closeAll(period, 0);
      period = ep;
      openAll(ep, e.t === 'period_start' ? ec : perLen(ep));
      if (e.t === 'period_start') continue;
    }
    const pl = e.payload || {};
    const pin = e.in != null ? e.in : pl.in, pout = e.out != null ? e.out : pl.out;
    if (e.t === 'sub' && e.team != null && (pin != null || pout != null)) {
      const team = e.team;
      if (pout != null) closeP(pout, ep, ec);
      closeL(team, ep, ec);
      if (pout != null) on[team].delete(pout);
      if (pin != null) on[team].add(pin);
      if (pin != null && !openP[pin]) openP[pin] = { team, period: ep, c0: ec };
      openL[team] = { ids: [...on[team]].sort(), period: ep, c0: ec };
    } else if (e.t === 'game_end') {
      closeAll(ep, ec != null ? Math.min(ec, perLen(ep)) : 0);
      period = null;
    }
  }
  if (period != null) closeAll(period, 0);
  return { players, lineups, known: true };
}

/* THE ASSIST RIDES ON THE BASKET. An assist is logged as its own event a beat
   after the made shot it belongs to, at the same clock. On the page it is
   the same moment of video, so the basket carries "ASSIST: X" — and in a
   score-only game, where only baskets can be placed, the basket also stands
   in for the assist itself (the assists filter finds it, the assister's
   profile lists it).

   Lifted out of index() so that coverageNote can count the rows this list is
   MEANT to hold. A paired assist is not a missing play: it is on screen, on
   its basket's row, and counting it as one would have the honest notice
   report a shortfall that is not there. */
const pidOf = e => (e.pid != null ? e.pid : (e.payload || {}).pid || null);
const seqOf = e => (e.seq != null ? e.seq : e.id);
function pairAssists(events) {
  const assistOf = {};
  const pairedAst = {};           // seq of every assist row that found its basket
  const recent = [];
  for (const e of (events || [])) {
    if (e.t === 'p2_made' || e.t === 'p3_made') {
      recent.push({ seq: seqOf(e), team: e.team, period: e.period, clock: e.clock, pid: pidOf(e) });
      if (recent.length > 3) recent.shift();
    } else if (e.t === 'ast' && pidOf(e) != null) {
      for (let i = recent.length - 1; i >= 0; i--) {
        const m = recent[i];
        if (m.team === e.team && m.period === e.period && m.pid !== pidOf(e) &&
            Math.abs((m.clock || 0) - (e.clock || 0)) <= 5000) {
          assistOf[m.seq] = { pid: pidOf(e), seq: seqOf(e) };
          pairedAst[seqOf(e)] = true;
          break;
        }
      }
    }
  }
  return { assistOf, pairedAst };
}

function index(events, video, opts) {
  const o = opts || {};
  const label = o.label || (e => e.t);
  const names = o.names || {};
  const out = [];
  /* `names` maps a pid to a name; without one the tag still says an assist
     happened. */
  const { assistOf, pairedAst } = pairAssists(Array.isArray(events) ? events : []);
  if (!Array.isArray(events)) return out;

  /* A CLOCK TRACK PLACES PLAYS BY THE GAME CLOCK. When the video row carries
     readings of the clock overlay (the page's scoreboard reader, or a vision
     model's import — epinoia-clock-track/1), every play is put where its
     period and clock were on screen: exact, stoppages included, and needing
     no tip-off anchor at all. Wall-clock placement below is the fallback for
     plays in a period the track did not read. */
  const A = (typeof globalThis !== 'undefined' ? globalThis : self).EpinoiaVideoAnchor;
  const sane = video && video.clock_track ? saneTrack(video.clock_track, video) : null;
  const track = sane && Array.isArray(sane.samples) && sane.samples.length ? sane : null;
  /* videoanchor.js carries the canonical positionFromTrack for the game page; a profile page
     does not load it, and a track-placed game there used to lose every play. Same arithmetic. */
  const posFromTrack = (A && A.positionFromTrack) ? A.positionFromTrack : positionFromTrackLocal;
  const byTrack = e => track ? posFromTrack(track, e.period || 1, e.clock || 0) : null;
  /* SCORE-ONLY TRACKS PLACE SCORING PLAYS AND NOTHING ELSE. With no clock on screen the
     readings are the baskets themselves; everything between two baskets would be an
     interpolation on a stopped clock, and a foul "placed" forty seconds wrong is worse
     than no foul in the list. So the list holds the plays the track can vouch for. */
  const scoreOnly = !!(track && track.mode === 'score');

  const gap = gapMs(video);
  if (gap == null && !track) return out;

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

  /* AND WHETHER ITS TIMES MEAN ANYTHING AT ALL.

     logIsTimed asks whether the log's stamps span roughly as much real time as
     the game covers. A bulk import fails it: every row was inserted inside one
     transaction, so created_at says when the CSV was loaded, not when the ball
     went in. The game page has always refused to place plays in that case, and
     says so in as many words: "imported in bulk rather than scored live".

     But the page asked `hasTrack || logIsTimed(events)`, one decision for the
     whole game. A clock track that covers PART of it — a vision pass that read
     the first half and lost the overlay after the break, which is the ordinary
     way an OCR pass ends — switched the refusal off for every play the track
     does not reach, and those fell through to `gap + since`, i.e. to the import
     instant. Measured: three separate fourth-quarter plays all placed at
     4:10:00 in the footage, each with a confident m:ss, byClock false and no
     '~'. The guard was written for exactly that log and was not consulted about
     those rows.

     So it is asked per play instead. A play the track can vouch for is placed by
     the track; a play it cannot is placed by wall clock only if the log's wall
     clock means something. Neither, and it is left out rather than invented.

     POSITIVE EVIDENCE, THOUGH, NOT MERELY A FAILED TEST. logIsTimed compares the
     span of the stamps against the game clock covered, so it needs a game's
     worth of log before its answer means anything — on one event it returns
     false because there is nothing to span, which is not a bulk import. And a
     log carrying a device stamp anywhere was scored live whatever its span, as
     the paragraph above already argues. So the refusal wants all three: no
     device stamp anywhere, enough of a log to have judged, and a judgement that
     the stamps do not cover the game. */
  const looksImported = !timedByDevice && events.length >= 20 && !logIsTimed(events);
  const wallMeansSomething = !looksImported;

  const rows = [];
  const distrusted = distrustedStamps(events, mode);
  for (const e of events) {
    /* Descriptors are not plays. A 'loc', a 'tag' and a 'stype' each decorate
       an event that is already in this list; including them would show the
       same basket three times. */
    if (e.t === 'loc' || e.t === 'tag' || e.t === 'stype') continue;
    if (scoreOnly && !(e.t === 'p2_made' || e.t === 'p3_made' || e.t === 'ft_made')) continue;
    /* ONE ROW PER MOMENT. An assist paired with its basket is the same second of video
       as the basket, which already reads "two-pointer made · ASSIST: X"; a second row
       saying "assist" underneath it was the same clip listed twice. Only an assist the
       pairing could not place beside a basket keeps its own row. */
    if (e.t === 'ast' && pairedAst[seqOf(e)]) continue;
    if (o.skipStructural && (e.t === 'sub' || e.t === 'period_start' ||
                             e.t === 'jump' || e.t === 'game_end')) continue;
    /* the stamp, unless a batch shared it or the game could not have produced it */
    let since = distrusted.has(e) ? null : sinceTipMs(e, video, mode);
    if (since != null && !stampIsPossible(e, since)) since = null;
    rows.push({ e: e, since: since, trackPos: byTrack(e) });
  }
  fillGaps(rows);

  for (const row of rows) {
    const e = row.e;
    const tp = row.trackPos;
    if (tp == null && (row.since == null || gap == null)) continue;
    /* see wallMeansSomething: an untracked play in an untimed log has no
       honest position, and the import instant is not one */
    if (tp == null && !wallMeansSomething) continue;
    const pos = tp != null ? tp : gap + row.since;
    if (pos < 0) continue;
    const [pre, post] = clipOf(e.t, e.wall_err);
    out.push({
      /* placed by the clock overlay rather than by wall clock */
      byClock: tp != null,
      id: e.seq != null ? e.seq : e.id,
      t: e.t,
      pid: e.pid != null ? e.pid : (e.payload || {}).pid || null,
      team: e.team != null ? e.team : null,
      period: e.period, clock: e.clock,
      at: e.created_at || e.at || null,
      ms: pos,
      /* Marked, because a reader deciding whether a clip is worth clipping
         should know which ones were placed rather than timed. */
      approx: tp == null && !!row.guessed,
      start: Math.max(0, pos - pre),
      end: pos + post,
      assist: assistOf[e.seq != null ? e.seq : e.id] || null,
      /* the basket IS the assist's place in the video (the assist's own row was dropped) */
      standsForAssist: !!assistOf[e.seq != null ? e.seq : e.id],
      label: label(e) + (assistOf[e.seq != null ? e.seq : e.id]
        ? (names[assistOf[e.seq != null ? e.seq : e.id].pid]
            ? ' \u00b7 ASSIST: ' + names[assistOf[e.seq != null ? e.seq : e.id].pid]
            : ' \u00b7 assisted')
        : '')
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
  { key: 'ast',    label: 'assists',      fn: p => p.t === 'ast' || !!p.standsForAssist },
  { key: 'def',    label: 'steals & blocks',
    fn: p => p.t === 'stl' || p.t === 'blk' },
  { key: 'to',     label: 'turnovers',    fn: p => p.t === 'to' },
  { key: 'foul',   label: 'fouls',        fn: p => p.t === 'foul' }
];
const filterBy = key => (FILTERS.find(f => f.key === key) || FILTERS[0]).fn;

function select(plays, opts) {
  const o = opts || {};
  const fn = filterBy(o.filter);
  return plays.filter(p => {
    if (o.team != null && p.team !== o.team) return false;
    if (o.period && p.period !== o.period) return false;
    if (o.pid && p.pid !== o.pid) {
      /* somebody else's basket that he assisted: his, but only as an assist -- never as
         his points or his field goals */
      const his = p.assist && p.assist.pid === o.pid;
      return his && (!o.filter || o.filter === 'all' || o.filter === 'ast');
    }
    return fn(p);
  });
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

/* ------------------------------------------------------- what was actually read --
   THE LINE UNDER THE LIST HAS TO DESCRIBE THE READING THAT WAS USED.

   The footer counted the readings on the STORED track, and the stored track is
   not what places anything: saneTrack throws away every reading the game could
   not have produced, and index() places plays by what is left. On an honest
   game the two numbers agree and the distinction never came up.

   106394dc (Loughborough Riders v Oaklands Wolves, 2026-09-12) is where it
   matters. Its job read 537 seconds of an 8,334-second broadcast: the last
   two minutes of the fourth quarter, and the footer said "placed by the game
   clock · 69 readings · checked", which is the sentence a fully-read game
   shows. Ninety-six per cent of the footage had never been looked at, the list
   began at Q3 1:57 with the first two quarters simply absent, and nothing on
   the page said so. A reader had no way to tell a missing half from a half
   with nothing in it.

   So the note is built from the SANE track, and it says what is not there:
   which periods of the log ended up with no play on screen at all, how many of
   the log's plays could be placed, and, when the worker stored one, how much
   of the footage the reading ever covered. The wording stays short because it
   sits in a footer; `title` carries the full sentence for a hover.

   Returns null only when there is nothing to describe (no log). The page keeps
   its own ±accuracy line for an untracked game; this is the part that has to be
   true whatever placed the plays.

   NOT YET WIRED INTO epinoia/game/video.js, which another session owns: that
   footer still counts v.clock_track.samples directly. It calls this instead the
   moment both changes are in one tree. */
const periodName = p => (p <= 4 ? 'Q' + p : p === 5 ? 'OT' : 'OT' + (p - 4));

function listOfNames(ps) {
  const n = ps.map(periodName);
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

function coverageNote(video, events, plays) {
  const evs = (events || []).filter(e => e && e.t !== 'loc' && e.t !== 'tag' && e.t !== 'stype');
  if (!evs.length) return null;

  const raw = video && video.clock_track;
  const sane = (raw && Array.isArray(raw.samples)) ? saneTrack(raw, video) : null;
  const samples = (sane && sane.samples) || [];
  const mode = (raw && raw.mode) || null;
  const scoreOnly = mode === 'score' && samples.length > 0;
  const dropped = sane ? (raw.samples.length - samples.length) : 0;

  /* what the list is MEANT to hold, counted exactly as index() counts it */
  const { pairedAst } = pairAssists(evs);
  const wanted = new Map();
  let total = 0;
  for (const e of evs) {
    if (scoreOnly && !(e.t === 'p2_made' || e.t === 'p3_made' || e.t === 'ft_made')) continue;
    if (e.t === 'ast' && pairedAst[seqOf(e)]) continue;
    const p = e.period || 1;
    wanted.set(p, (wanted.get(p) || 0) + 1);
    total++;
  }
  const got = new Map();
  for (const p of (plays || [])) got.set(p.period || 1, (got.get(p.period || 1) || 0) + 1);
  const listed = (plays || []).length;
  const missing = [...wanted.keys()].filter(p => !got.get(p)).sort((a, b) => a - b);

  /* how much of the footage the reading ever covered, when the worker said so */
  const cov = (raw && raw.coverage) || null;
  const readFrac = cov && isFinite(+cov.read_frac) ? +cov.read_frac : null;

  let kind, head, why;
  if (scoreOnly) {
    kind = 'score';
    head = 'placed by score changes · ' + samples.length + ' baskets · scoring plays only';
    why = 'no clock on this broadcast: the score overlay was read instead, so each basket is placed ' +
          'by its own score change and only scoring plays are listed';
  } else if (mode === 'wall' && samples.length) {
    kind = 'wall';
    head = 'placed by the broadcast’s timestamps · ' + samples.length + ' plays';
    why = 'no clock could be read off this broadcast, so every play is placed by the moment the live ' +
          'log recorded it against the stream’s own start time';
  } else if (samples.length) {
    kind = 'clock';
    head = 'placed by the game clock · ' + samples.length + ' readings' +
           (raw.wall_check ? ' · checked' : '');
    why = 'the clock overlay was read at these points in the footage; every play sits where its clock ' +
          'was on screen' +
          (raw.wall_check ? '; checked against the broadcast’s own timestamps on ' +
            raw.wall_check.plays + ' plays' : '');
  } else if (raw && Array.isArray(raw.samples) && raw.samples.length) {
    /* a reading existed and none of it survived: say that rather than nothing */
    kind = 'rejected';
    head = 'the reading of this broadcast was discarded';
    why = 'this game was read by the vision worker, but ' +
          (raw.samples.length === 1 ? 'its one reading could not have come from this game'
                                    : 'none of its ' + raw.samples.length + ' readings could have come from this game') +
          ', so the plays are placed by their timestamps instead';
  } else {
    kind = 'stamps';
    head = 'placed by the log’s own timestamps';
    why = 'nothing was read off the picture, so every play sits where the log says it happened';
  }

  const parts = [head];
  if (dropped > 0 && kind !== 'rejected') parts.push(dropped + ' readings discarded');
  if (readFrac != null && readFrac < 0.95) parts.push(Math.round(readFrac * 100) + '% of the footage read');
  if (missing.length) parts.push('nothing placed in ' + listOfNames(missing));
  else if (listed < total) parts.push(listed + ' of ' + total + ' plays placed');

  const tail = [];
  if (missing.length) {
    tail.push('No play in ' + listOfNames(missing) + ' could be placed in this footage at all, so ' +
              (missing.length === 1 ? 'that period is' : 'those periods are') + ' missing from the list.');
  }
  if (listed < total) tail.push(listed + ' of the log’s ' + total + ' plays are listed; the rest had no ' +
                               'position this footage can vouch for.');
  if (readFrac != null && readFrac < 0.95) {
    tail.push('The reader looked at ' + Math.round(readFrac * 100) + '% of the broadcast.');
  }

  return { kind, text: parts.join(' · '), title: [why + '.'].concat(tail).join(' '),
           readings: samples.length, dropped, listed, total, missing, readFrac };
}

return { parse, safeUrl, embedSrc, watchHref, gapMs, anchorKind, gapLooksOdd,
         runsFromTrack, stopsFromRuns, positionFromRuns, positionFromTrack, stints,
         hasAnchor, videoMsOf, sinceTipMs,
         cumElapsed, logIsTimed, distrustedStamps, saneTrack, stampIsPossible,
         liveEmbedSrc, providerFromServer, pairAssists, coverageNote,
         index, select, FILTERS, filterBy, stamp, gapText, clipOf, ROLL };
}));
