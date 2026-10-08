'use strict';
/* ============================================================================
   EPINOIA VIDEO TAGGER — placing the play-by-play on the footage by hand (2026-10-08).

   The reader (the PC worker's clock reading) places most plays to a second or two; some games it
   cannot read, some periods it misses, and a person watching knows better. This is the admin's
   tool for saying "this play starts HERE":

     - the play-by-play down the left, in game order; pressing a play goes to it in the video;
     - the video, controlled exactly (YouTube through its own message channel, a file directly);
     - a timeline along the bottom with every play's start on it: a tag dragged to move it, the
       playhead dragged to scrub, zoom from the whole broadcast down to a few seconds;
     - keys to work through a game without the mouse (? shows them).

   A TAG IS {seq, t, period, clock_ms}: the play, and the second of video it starts at. Tags are
   saved into the video row's clock_track as `manual`, beside the reader's samples, through the same
   set_video_clock_track the page's import uses (who may attach a video may tag it). video.js places
   a tagged play exactly on its tag and moves its untagged neighbours by the error the tags showed,
   so a few tags correct a whole stretch. The worker keeps them when it re-reads the game.

   Opened from the game page (the box score's "tag video" button, the video tab's "Tag plays") and
   from a full game's watch page, for people who may attach video to the game.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVideoTagger = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const G = () => (typeof globalThis !== 'undefined' ? globalThis : self);
const V = () => G().EpinoiaVideo;
const SKIP = { loc: 1, tag: 1, stype: 1 };
const STRUCT = { sub: 1, period_start: 1, period_end: 1, jump: 1, game_end: 1, timeout: 1 };
const SCORE = { p2_made: 1, p3_made: 1, ft_made: 1 };
/* the timeline's spans, widest first: the whole broadcast, then an hour down to ten seconds */
const SPANS = [null, 3600, 1200, 300, 120, 30, 10];
const seqOf = e => (e.seq != null ? e.seq : e.id);

/* ---------------------------------------------------------------- pure parts --- */
/* The plays a person can tag, in the order they happened: by period, then the clock running down,
   then the order they were logged (a free-throw pair shares a clock). Descriptors are not plays. */
function playsOf(events, labels) {
  const out = [];
  (Array.isArray(events) ? events : []).forEach(e => {
    if (!e || SKIP[e.t]) return;
    const seq = seqOf(e);
    if (seq == null) return;
    const label = (labels && labels[seq]) || '';
    out.push({ seq, t: e.t, period: e.period || 1, clock: e.clock != null ? +e.clock : 0, team: e.team != null ? e.team : null,
               label: label || e.t, structural: !!STRUCT[e.t], scoring: !!SCORE[e.t], e });
  });
  out.sort((a, b) => a.period - b.period || b.clock - a.clock || (+a.seq - +b.seq) || 0);
  return out;
}

/* the tags on a track, as a Map seq -> tag */
function tagsOf(track) {
  const m = new Map();
  (track && Array.isArray(track.manual) ? track.manual : []).forEach(x => {
    if (x && x.seq != null && isFinite(+x.t) && +x.t >= 0) m.set(String(x.seq), x);
  });
  return m;
}

/* A new track with one tag set (or moved). Never edits the one it is given: the page's own copy
   stays as it was until a save succeeds. */
function withTag(track, play, tSec, by) {
  const base = track && typeof track === 'object' ? track : { format: 'epinoia-clock-track/1', samples: [] };
  const keep = (Array.isArray(base.manual) ? base.manual : []).filter(x => x && String(x.seq) !== String(play.seq));
  const tag = { seq: play.seq, t: Math.max(0, Math.round(tSec * 100) / 100), period: play.period, clock_ms: play.clock,
                by: by || 'tagger', at: new Date().toISOString() };
  return Object.assign({}, base, { samples: Array.isArray(base.samples) ? base.samples : [], manual: keep.concat([tag]) });
}
function withoutTag(track, seq) {
  const base = track && typeof track === 'object' ? track : { samples: [] };
  return Object.assign({}, base, { samples: Array.isArray(base.samples) ? base.samples : [],
                                   manual: (Array.isArray(base.manual) ? base.manual : []).filter(x => x && String(x.seq) !== String(seq)) });
}

/* Where every play would be placed with this track: video.js's own answer (tags, the reading, the
   wall clock), so the tagger shows exactly what the page will. seq -> {ms, tagged, approx}. */
function placements(events, video, track) {
  const out = new Map();
  if (!V() || !V().index) return out;
  const v = Object.assign({}, video, { clock_track: track });
  V().index(events, v, { label: e => e.t }).forEach(p => {
    out.set(String(p.id), { ms: p.ms, tagged: !!p.tagged, approx: !!p.approx, byClock: !!p.byClock });
  });
  return out;
}

/* the timeline's window: `span` seconds around `centre`, inside [0, dur] */
function windowOf(dur, span, centre) {
  const d = Math.max(1, dur || 1);
  if (!span || span >= d) return { t0: 0, t1: d };
  let t0 = (centre || 0) - span / 2;
  t0 = Math.max(0, Math.min(d - span, t0));
  return { t0, t1: t0 + span };
}
const xOf = (t, win, w) => ((t - win.t0) / (win.t1 - win.t0)) * w;
const tOf = (x, win, w) => win.t0 + (x / Math.max(1, w)) * (win.t1 - win.t0);
/* the ruler's step: about one label every 90 px */
function tickStep(win, w) {
  const per = (win.t1 - win.t0) / Math.max(1, w / 90);
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find(s => s >= per) || 3600;
}
function hms(t, tenths) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + ss;
}
function clockText(ms) {
  ms = Math.max(0, +ms || 0);
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/* the next or previous play in the shown list from `seq` (dir +1 / -1) */
function step(list, seq, dir) {
  if (!list.length) return null;
  const i = list.findIndex(p => String(p.seq) === String(seq));
  if (i === -1) return list[dir > 0 ? 0 : list.length - 1];
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
}

/* ---------------------------------------------------------------- the players --- */
/* YouTube WITHOUT YouTube's script. The page's security policy loads no third-party script, and it
   does not need to: the embed answers the same postMessage protocol its JavaScript API uses.
   "listening" makes it report (infoDelivery: currentTime, duration, playerState) about four times a
   second while playing; commands are {event:'command', func, args}. Between reports the time is
   carried forward by the clock, so the playhead moves smoothly. */
const YT_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
function ytPlayer(host, videoId, startS) {
  const f = document.createElement('iframe');
  f.className = 'vt-frame';
  f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
    '?enablejsapi=1&rel=0&playsinline=1&modestbranding=1&start=' + Math.max(0, Math.floor(startS || 0)) +
    '&origin=' + encodeURIComponent(location.origin);
  f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.title = 'Game video';
  host.appendChild(f);
  const s = { t: startS || 0, dur: 0, playing: false, at: performance.now(), rate: 1, ready: false };
  const send = (func, args) => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [], id: 'vt', channel: 'widget' }), '*'); } catch (_) { /* gone */ } };
  const hello = () => {
    try {
      f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'vt', channel: 'widget' }), '*');
      send('addEventListener', ['onStateChange']);
    } catch (_) { /* not yet */ }
  };
  const onMsg = ev => {
    if (!YT_ORIGINS.includes(ev.origin) || ev.source !== f.contentWindow) return;
    let d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (_) { return; }
    if (!d) return;
    const info = d.info && typeof d.info === 'object' ? d.info : null;
    if (d.event === 'onReady' || d.event === 'initialDelivery') s.ready = true;
    if (info) {
      s.ready = true;
      if (typeof info.currentTime === 'number') { s.t = info.currentTime; s.at = performance.now(); }
      if (typeof info.duration === 'number' && info.duration > 0) s.dur = info.duration;
      if (typeof info.playbackRate === 'number') s.rate = info.playbackRate;
      if (typeof info.playerState === 'number') s.playing = info.playerState === 1;
    }
    if (d.event === 'onStateChange' && typeof d.info === 'number') { s.playing = d.info === 1; s.at = performance.now(); }
  };
  window.addEventListener('message', onMsg);
  f.addEventListener('load', () => { hello(); setTimeout(hello, 600); setTimeout(hello, 2000); });
  return {
    kind: 'youtube',
    time: () => s.playing ? s.t + ((performance.now() - s.at) / 1000) * (s.rate || 1) : s.t,
    duration: () => s.dur,
    playing: () => s.playing,
    ready: () => s.ready,
    seek(t) { s.t = Math.max(0, t); s.at = performance.now(); send('seekTo', [s.t, true]); },
    play() { send('playVideo'); s.playing = true; s.at = performance.now(); },
    pause() { s.t = this.time(); send('pauseVideo'); s.playing = false; },
    toggle() { if (s.playing) this.pause(); else this.play(); },
    destroy() { window.removeEventListener('message', onMsg); f.remove(); }
  };
}
function filePlayer(host, url, startS) {
  const v = document.createElement('video');
  v.className = 'vt-frame';
  v.controls = true; v.playsInline = true; v.preload = 'metadata';
  v.src = url;
  v.addEventListener('loadedmetadata', () => { if (startS) v.currentTime = startS; }, { once: true });
  host.appendChild(v);
  return {
    kind: 'file',
    time: () => v.currentTime || 0,
    duration: () => (isFinite(v.duration) ? v.duration : 0),
    playing: () => !v.paused,
    ready: () => v.readyState > 0,
    seek(t) { v.currentTime = Math.max(0, t); },
    play() { v.play().catch(() => {}); },
    pause() { v.pause(); },
    toggle() { if (v.paused) this.play(); else this.pause(); },
    destroy() { v.pause(); v.remove(); }
  };
}

/* ---------------------------------------------------------------- the screen --- */
const KEYS = [
  ['↓ / J', 'next play (goes to it)'], ['↑ / K', 'previous play'],
  ['Enter / T', 'tag the chosen play at the playhead'], ['Space', 'play / pause'],
  ['← / →', 'playhead back / on 1 s (Shift 5 s, Alt 0.2 s)'], ['[ / ]', 'move the chosen play’s tag 0.2 s (Shift 1 s)'],
  ['Delete', 'remove the chosen play’s tag'], ['G', 'go to the chosen play'],
  ['+ / −', 'zoom the timeline in / out'], ['0', 'whole broadcast'],
  ['Ctrl+S', 'save'], ['Esc', 'close'], ['?', 'this list']
];

let open_ = null;

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function open(opts) {
  if (open_) open_.close(true);
  const o = opts || {};
  const video = o.video || {};
  const parsed = V() && V().parse ? V().parse(video.url || '') : null;
  const ytId = (parsed && parsed.provider === 'youtube' && parsed.id) || (video.provider === 'youtube' && video.video_ref) || null;
  const fileUrl = !ytId && video.provider === 'mp4' && V() && V().safeUrl ? V().safeUrl(video.url) : null;
  const all = playsOf(o.events, o.labels);
  const teams = o.teams || ['Home', 'Away'];
  const original = video.clock_track || null;
  let draft = original ? Object.assign({}, original) : null;
  let placed = placements(o.events, video, draft);
  let dirty = 0, saving = false;
  let filter = 'plays', current = null, advance = true, preroll = 2;
  let spanIdx = 0, follow = true, winCentre = null, drag = null;
  let raf = 0, lastPaintT = -1;

  /* ---- the frame ---- */
  const root = el('div', 'vt-root');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Tag the plays in the video');
  root.setAttribute('translate', 'no');
  const head = el('header', 'vt-head');
  const title = el('div', 'vt-title');
  title.append(el('b', null, 'TAG PLAYS'), el('span', null, o.title || ''));
  const status = el('span', 'vt-status', '');
  const helpB = el('button', 'vt-btn', '? keys');
  const saveB = el('button', 'vt-btn vt-save', 'Save');
  const closeB = el('button', 'vt-btn', 'Close');
  [helpB, saveB, closeB].forEach(b => { b.type = 'button'; });
  head.append(title, status, helpB, saveB, closeB);

  const side = el('aside', 'vt-side');
  const chips = el('div', 'vt-chips');
  [['plays', 'Plays'], ['all', 'All'], ['scoring', 'Scores'], ['untagged', 'Untagged']].forEach(([k, t]) => {
    const b = el('button', 'vt-chip', t); b.type = 'button'; b.dataset.f = k; chips.appendChild(b);
  });
  const count = el('div', 'vt-count', '');
  const list = el('ol', 'vt-list');
  side.append(chips, count, list);

  const main = el('section', 'vt-main');
  const stage = el('div', 'vt-stage');
  const bar = el('div', 'vt-bar');
  const now = el('div', 'vt-now');
  const tagB = el('button', 'vt-btn vt-primary', 'Tag at playhead  ⏎');
  const goB = el('button', 'vt-btn', 'Go to play  G');
  const unB = el('button', 'vt-btn', 'Remove tag  Del');
  const advL = el('label', 'vt-opt');
  const advC = el('input'); advC.type = 'checkbox'; advC.checked = true;
  advL.append(advC, document.createTextNode(' next play after tagging'));
  const preL = el('label', 'vt-opt');
  const preS = el('select');
  [[0, 'at the play'], [2, '2 s before'], [5, '5 s before']].forEach(([v, t]) => { const op = el('option', null, t); op.value = v; if (v === preroll) op.selected = true; preS.appendChild(op); });
  preL.append(document.createTextNode('go to '), preS);
  [tagB, goB, unB].forEach(b => { b.type = 'button'; });
  bar.append(now, tagB, goB, unB, advL, preL);
  const tl = el('div', 'vt-tl');
  const tlTools = el('div', 'vt-tltools');
  const zOut = el('button', 'vt-btn', '−'), zIn = el('button', 'vt-btn', '+'), zFit = el('button', 'vt-btn', 'Whole');
  const zLab = el('span', 'vt-zlab', '');
  [zOut, zIn, zFit].forEach(b => { b.type = 'button'; });
  tlTools.append(zOut, zLab, zIn, zFit, el('span', 'vt-tlhint', 'drag a tag to move it · drag the line to scrub · Ctrl+wheel zooms, wheel scrolls'));
  const canvas = el('canvas', 'vt-canvas');
  tl.append(tlTools, canvas);
  main.append(stage, bar, tl);

  const help = el('div', 'vt-help');
  help.hidden = true;
  const hl = el('dl');
  KEYS.forEach(([k, t]) => { hl.append(el('dt', null, k), el('dd', null, t)); });
  help.append(el('b', null, 'KEYS'), hl);

  root.append(head, side, main, help);
  document.body.appendChild(root);
  document.documentElement.classList.add('vt-open');

  /* ---- the player ---- */
  const firstTag = [...tagsOf(draft).values()].sort((a, b) => a.t - b.t)[0];
  const start = firstTag ? firstTag.t : 0;
  let player = null;
  if (ytId) player = ytPlayer(stage, ytId, start);
  else if (fileUrl) player = filePlayer(stage, fileUrl, start);
  else stage.appendChild(el('div', 'vt-none', 'This video cannot be controlled from here (only YouTube and video files can).'));

  /* ---- the list ---- */
  const shown = () => all.filter(p => filter === 'all' ? true
    : filter === 'plays' ? !p.structural || p.t === 'period_start'
    : filter === 'scoring' ? p.scoring
    : !tagsOf(draft).has(String(p.seq)));
  const rowOf = new Map();
  function teamTxt(p) { return p.team === 0 ? teams[0] : p.team === 1 ? teams[1] : ''; }
  function drawList() {
    list.textContent = '';
    rowOf.clear();
    const items = shown();
    const tags = tagsOf(draft);
    items.forEach(p => {
      const li = el('li', 'vt-row');
      li.tabIndex = -1;
      li.dataset.seq = p.seq;
      const when = el('span', 'vt-when', 'Q' + p.period + ' ' + clockText(p.clock));
      if (p.period > 4) when.textContent = 'OT' + (p.period - 4) + ' ' + clockText(p.clock);
      const who = el('span', 'vt-team t' + (p.team == null ? 'x' : p.team), teamTxt(p).slice(0, 3).toUpperCase());
      const what = el('span', 'vt-what', p.label);
      const at = el('span', 'vt-at');
      li.append(when, who, what, at);
      li.addEventListener('click', () => choose(p, true));
      list.appendChild(li);
      rowOf.set(String(p.seq), { li, at, p });
    });
    count.textContent = items.length + ' shown · ' + tags.size + ' tagged';
    paintRows();
    chips.querySelectorAll('.vt-chip').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
  }
  function paintRows() {
    const tags = tagsOf(draft);
    rowOf.forEach(({ li, at, p }) => {
      const k = String(p.seq);
      const tag = tags.get(k), pl = placed.get(k);
      li.classList.toggle('tagged', !!tag);
      li.classList.toggle('on', current != null && String(current.seq) === k);
      at.textContent = tag ? hms(+tag.t, true) : pl ? '~' + hms(pl.ms / 1000) : '—';
      at.title = tag ? 'tagged by hand' : pl ? (pl.approx ? 'estimated (approximate)' : 'estimated from the reading') : 'no position yet';
    });
  }
  function choose(p, seek) {
    current = p;
    paintRows();
    const r = rowOf.get(String(p.seq));
    if (r && r.li.scrollIntoView) r.li.scrollIntoView({ block: 'nearest' });
    if (seek) goTo(p);
    paintNow();
    paintTimeline(true);
  }
  function posOf(p) {
    const tag = tagsOf(draft).get(String(p.seq));
    if (tag) return +tag.t;
    const pl = placed.get(String(p.seq));
    return pl ? pl.ms / 1000 : null;
  }
  function goTo(p) {
    const t = posOf(p);
    if (t == null || !player) return;
    player.seek(Math.max(0, t - preroll));
    follow = true;
  }

  /* ---- editing ---- */
  function changed(nextTrack) {
    draft = nextTrack;
    placed = placements(o.events, video, draft);
    dirty++;
    paintRows();
    count.textContent = shown().length + ' shown · ' + tagsOf(draft).size + ' tagged';
    paintStatus();
    paintTimeline(true);
  }
  function tagAt(p, t) {
    if (!p || t == null || !isFinite(t)) return;
    changed(withTag(draft, p, t, o.by));
  }
  function tagNow() {
    if (!current || !player) return;
    tagAt(current, player.time());
    if (advance) {
      const next = step(shown(), current.seq, +1);
      if (next && String(next.seq) !== String(current.seq)) {
        current = next;
        paintRows();
        const r = rowOf.get(String(next.seq));
        if (r && r.li.scrollIntoView) r.li.scrollIntoView({ block: 'nearest' });
        paintNow();
      }
    }
  }
  function untag() {
    if (!current || !tagsOf(draft).has(String(current.seq))) return;
    changed(withoutTag(draft, current.seq));
  }
  function nudgeTag(ds) {
    if (!current) return;
    const tag = tagsOf(draft).get(String(current.seq));
    if (!tag) return;
    tagAt(current, +tag.t + ds);
    if (player) player.seek(Math.max(0, +tag.t + ds));
  }

  /* ---- saving ---- */
  function paintStatus(msg) {
    saveB.disabled = !dirty || saving;
    saveB.textContent = saving ? 'Saving…' : dirty ? 'Save (' + dirty + ')' : 'Saved';
    status.textContent = msg || (dirty ? 'unsaved changes' : '');
  }
  async function save() {
    if (!dirty || saving || typeof o.save !== 'function') return;
    saving = true; paintStatus('saving…');
    let ok = false;
    try { ok = await o.save(draft); } catch (_) { ok = false; }
    saving = false;
    if (ok) { dirty = 0; paintStatus('saved'); } else paintStatus('could not save (still signed in?)');
  }

  /* ---- the readout under the player ---- */
  function paintNow() {
    const t = player ? player.time() : 0;
    const p = current;
    const tag = p ? tagsOf(draft).get(String(p.seq)) : null;
    now.innerHTML = '';
    now.append(el('b', null, hms(t, true)));
    if (p) {
      now.append(el('span', null, ' · ' + (p.period > 4 ? 'OT' + (p.period - 4) : 'Q' + p.period) + ' ' + clockText(p.clock) + ' · ' + p.label));
      now.append(el('i', null, tag ? '  tagged ' + hms(+tag.t, true) : ''));
    }
    unB.disabled = !tag;
    tagB.disabled = !p || !player;
  }

  /* ---- the timeline ---- */
  function dur() {
    const d = player ? player.duration() : 0;
    if (d) return d;
    let m = 0;
    placed.forEach(x => { m = Math.max(m, x.ms / 1000); });
    tagsOf(draft).forEach(x => { m = Math.max(m, +x.t); });
    return Math.max(60, m + 60);
  }
  function win() {
    const d = dur(), span = SPANS[spanIdx];
    const t = player ? player.time() : 0;
    if (span == null || span >= d) return { t0: 0, t1: d };
    if (winCentre == null) winCentre = t;
    if (follow) {
      const w = windowOf(d, span, winCentre);
      if (t < w.t0 || t > w.t1 - span * 0.1) winCentre = t + span * 0.4;
    }
    return windowOf(d, span, winCentre);
  }
  function zoom(dir, atT) {
    const before = spanIdx;
    spanIdx = Math.max(0, Math.min(SPANS.length - 1, spanIdx + dir));
    if (spanIdx === before) return;
    winCentre = atT != null ? atT : (player ? player.time() : 0);
    zLab.textContent = SPANS[spanIdx] ? (SPANS[spanIdx] >= 60 ? SPANS[spanIdx] / 60 + ' min' : SPANS[spanIdx] + ' s') : 'whole';
    paintTimeline(true);
  }
  function markers(w) {
    const out = [];
    const tags = tagsOf(draft);
    all.forEach(p => {
      const k = String(p.seq);
      const tag = tags.get(k);
      const t = tag ? +tag.t : (placed.get(k) ? placed.get(k).ms / 1000 : null);
      if (t == null || t < w.t0 - 1 || t > w.t1 + 1) return;
      out.push({ p, t, tagged: !!tag, approx: !tag && !!(placed.get(k) || {}).approx });
    });
    return out;
  }
  function paintTimeline(force) {
    const t = player ? player.time() : 0;
    if (!force && Math.abs(t - lastPaintT) < 0.02 && !drag) return;
    lastPaintT = t;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 120;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(root);
    const ink = css.getPropertyValue('--vt-ink').trim() || '#e8f0ec';
    const dim = css.getPropertyValue('--vt-dim').trim() || '#6d7d76';
    const tagC = css.getPropertyValue('--vt-tag').trim() || '#7dffb0';
    const selC = css.getPropertyValue('--vt-sel').trim() || '#ffd34d';
    const headC = css.getPropertyValue('--vt-head').trim() || '#ff4b4b';
    c.clearRect(0, 0, W, H);
    const w = win();
    /* the ruler */
    const stepS = tickStep(w, W);
    c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = dim; c.strokeStyle = dim; c.lineWidth = 1;
    for (let s = Math.ceil(w.t0 / stepS) * stepS; s <= w.t1; s += stepS) {
      const x = Math.round(xOf(s, w, W)) + 0.5;
      c.globalAlpha = 0.55; c.beginPath(); c.moveTo(x, 14); c.lineTo(x, H); c.stroke(); c.globalAlpha = 1;
      c.fillText(hms(s, stepS < 1), x + 3, 10);
    }
    /* the periods, from where their plays sit */
    const per = new Map();
    markers(w).concat([]).forEach(m => {
      const r = per.get(m.p.period) || [Infinity, -Infinity];
      per.set(m.p.period, [Math.min(r[0], m.t), Math.max(r[1], m.t)]);
    });
    per.forEach((r, p) => {
      const x0 = xOf(r[0], w, W), x1 = xOf(r[1], w, W);
      c.fillStyle = p % 2 ? 'rgba(125,255,176,.07)' : 'rgba(110,180,255,.07)';
      c.fillRect(x0, 16, Math.max(2, x1 - x0), H - 16);
      c.fillStyle = dim; c.fillText(p > 4 ? 'OT' + (p - 4) : 'Q' + p, x0 + 3, H - 4);
    });
    /* the plays: an estimate is an outline, a tag is solid, the chosen play is tall and yellow */
    const sel = current ? String(current.seq) : null;
    markers(w).forEach(m => {
      const x = Math.round(xOf(m.t, w, W)) + 0.5;
      const isSel = sel === String(m.p.seq);
      const y = m.p.team === 1 ? 54 : 34;
      c.strokeStyle = isSel ? selC : m.tagged ? tagC : dim;
      c.fillStyle = isSel ? selC : m.tagged ? tagC : 'transparent';
      c.lineWidth = isSel ? 2 : 1;
      c.beginPath(); c.moveTo(x, isSel ? 16 : y - 8); c.lineTo(x, isSel ? H - 14 : y + 12); c.stroke();
      c.beginPath();
      if (m.tagged || isSel) { c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.fill(); }
      else { c.setLineDash(m.approx ? [2, 2] : []); c.arc(x, y, 3.5, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      if (isSel) { c.fillStyle = selC; c.fillText(m.p.label.slice(0, 48), Math.min(W - 260, x + 7), 80); }
    });
    /* the playhead */
    const hx = Math.round(xOf(drag && drag.kind === 'head' ? drag.t : t, w, W)) + 0.5;
    c.strokeStyle = headC; c.lineWidth = 2;
    c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, H); c.stroke();
    c.fillStyle = headC; c.beginPath(); c.moveTo(hx - 5, 0); c.lineTo(hx + 5, 0); c.lineTo(hx, 7); c.closePath(); c.fill();
    if (drag && drag.kind === 'tag') {
      const x = Math.round(xOf(drag.t, w, W)) + 0.5;
      c.strokeStyle = selC; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x, 14); c.lineTo(x, H); c.stroke(); c.setLineDash([]);
      c.fillStyle = selC; c.fillText(hms(drag.t, true), x + 4, 26);
    }
    zLab.textContent = SPANS[spanIdx] ? (SPANS[spanIdx] >= 60 ? SPANS[spanIdx] / 60 + ' min' : SPANS[spanIdx] + ' s') : 'whole';
  }
  /* A POINTER IN THE CANVAS'S OWN PIXELS. The kit zooms the page body on wide screens: a pointer
     arrives in screen pixels and getBoundingClientRect measures in them too, while the canvas is
     drawn in its own (unzoomed) pixels. Scaled across, a press lands on the tag under it. */
  function local(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (canvas.clientWidth / (r.width || 1)),
             y: (ev.clientY - r.top) * (canvas.clientHeight / (r.height || 1)) };
  }
  function hit(x, y) {
    const W = canvas.clientWidth, w = win();
    let best = null, bd = 7;
    /* plays stacked on one pixel (a feed that stamped a minute of them at once): the press goes to the
       chosen play, then to a tagged one, before an estimate under it */
    const sel = current ? String(current.seq) : null;
    markers(w).forEach(m => {
      const yy = m.p.team === 1 ? 54 : 34;
      const d = Math.abs(xOf(m.t, w, W) - x) + (Math.abs(yy - y) > 14 ? 6 : 0)
        - (sel === String(m.p.seq) ? 1.5 : 0) - (m.tagged ? 1 : 0);
      if (d < bd) { bd = d; best = m; }
    });
    return best;
  }
  canvas.addEventListener('pointerdown', ev => {
    const { x, y } = local(ev);
    const w = win(), W = canvas.clientWidth;
    const m = hit(x, y);
    canvas.setPointerCapture(ev.pointerId);
    if (m) { drag = { kind: 'tag', m, x0: x, t: m.t, moved: false }; choose(m.p, false); }
    else { drag = { kind: 'head', x0: x, t: tOf(x, w, W) }; follow = false; }
    paintTimeline(true);
  });
  canvas.addEventListener('pointermove', ev => {
    if (!drag) return;
    const { x } = local(ev);
    const w = win(), W = canvas.clientWidth;
    if (Math.abs(x - drag.x0) > 2) drag.moved = true;
    drag.t = Math.max(0, tOf(x, w, W));
    paintTimeline(true);
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'tag') {
      if (d.moved) { tagAt(d.m.p, Math.round(d.t * 10) / 10); if (player) player.seek(d.t); }
      else if (player) player.seek(Math.max(0, d.m.t - preroll));
    } else if (player) { player.seek(d.t); winCentre = d.t; }
    follow = true;
    paintTimeline(true);
  });
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const { x } = local(ev);
    const w = win(), W = canvas.clientWidth;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) { zoom(ev.deltaY < 0 ? +1 : -1, tOf(x, w, W)); return; }
    const span = w.t1 - w.t0;
    follow = false;
    winCentre = (winCentre == null ? (w.t0 + w.t1) / 2 : winCentre) + ((ev.deltaX || ev.deltaY) / W) * span;
    paintTimeline(true);
  }, { passive: false });

  /* ---- keys ---- */
  function onKey(ev) {
    const tg = ev.target;
    if (tg && (tg.tagName === 'INPUT' && tg.type !== 'checkbox' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
    const k = ev.key;
    let used = true;
    if ((ev.ctrlKey || ev.metaKey) && (k === 's' || k === 'S')) save();
    else if (ev.ctrlKey || ev.metaKey) used = false;
    else if (k === 'ArrowDown' || k === 'j' || k === 'J') { const n = step(shown(), current && current.seq, +1); if (n) choose(n, true); }
    else if (k === 'ArrowUp' || k === 'k' || k === 'K') { const n = step(shown(), current && current.seq, -1); if (n) choose(n, true); }
    else if (k === 'Enter' || k === 't' || k === 'T') tagNow();
    else if (k === ' ') { if (player) player.toggle(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = (ev.shiftKey ? 5 : ev.altKey ? 0.2 : 1) * (k === 'ArrowLeft' ? -1 : 1);
      if (player) { player.seek(Math.max(0, player.time() + d)); follow = true; }
    }
    else if (k === '[' || k === ']' || k === '{' || k === '}') nudgeTag((ev.shiftKey || k === '{' || k === '}' ? 1 : 0.2) * (k === '[' || k === '{' ? -1 : 1));
    else if (k === 'Delete' || k === 'Backspace') untag();
    else if (k === 'g' || k === 'G') { if (current) goTo(current); }
    else if (k === '+' || k === '=') zoom(+1);
    else if (k === '-' || k === '_') zoom(-1);
    else if (k === '0') { spanIdx = 0; paintTimeline(true); }
    else if (k === '?' || k === '/') help.hidden = !help.hidden;
    else if (k === 'Escape') { if (!help.hidden) help.hidden = true; else close(); }
    else used = false;
    if (used) { ev.preventDefault(); ev.stopPropagation(); }
  }
  document.addEventListener('keydown', onKey, true);
  const beforeUnload = ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  /* ---- buttons ---- */
  chips.addEventListener('click', ev => { const b = ev.target.closest('.vt-chip'); if (b) { filter = b.dataset.f; drawList(); } });
  tagB.onclick = tagNow;
  goB.onclick = () => { if (current) goTo(current); };
  unB.onclick = untag;
  advC.onchange = () => { advance = advC.checked; };
  preS.onchange = () => { preroll = +preS.value || 0; };
  zIn.onclick = () => zoom(+1);
  zOut.onclick = () => zoom(-1);
  zFit.onclick = () => { spanIdx = 0; paintTimeline(true); };
  saveB.onclick = save;
  closeB.onclick = () => close();
  helpB.onclick = () => { help.hidden = !help.hidden; };

  function close(force) {
    if (!force && dirty && !window.confirm('Close without saving ' + dirty + ' change' + (dirty === 1 ? '' : 's') + '?')) return;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('resize', onResize);
    if (player) player.destroy();
    root.remove();
    document.documentElement.classList.remove('vt-open');
    open_ = null;
    if (typeof o.onClose === 'function') o.onClose();
  }
  const onResize = () => paintTimeline(true);
  window.addEventListener('resize', onResize);
  let lastNow = 0;
  const loop = () => {
    paintTimeline(false);
    const ts = performance.now();
    if (ts - lastNow > 200) { lastNow = ts; paintNow(); }
    raf = requestAnimationFrame(loop);
  };

  drawList();
  paintStatus();
  const firstUntagged = shown().find(p => !tagsOf(draft).has(String(p.seq)));
  const startAt = o.seq != null ? all.find(p => String(p.seq) === String(o.seq)) : null;
  if (startAt || firstUntagged || shown()[0]) choose(startAt || firstUntagged || shown()[0], false);
  raf = requestAnimationFrame(loop);
  open_ = { close, state: () => ({ draft, dirty, current, spanIdx, filter }) };
  return open_;
}

return { open, playsOf, tagsOf, withTag, withoutTag, placements, windowOf, xOf, tOf, tickStep, hms, clockText, step, SPANS, KEYS,
         isOpen: () => !!open_ };
}));
