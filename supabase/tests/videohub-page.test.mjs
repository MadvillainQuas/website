/* ============================================================================
   THE VIDEO HUB — epinoia/video/index.html, videohub.js and the rail's row.

   What goes wrong quietly on this page:
   - the CSP loses frame-src, or one of the four platforms, and the player is
     blocked on this page while it still works on the game page;
   - appmode.js stops being first and blocking (the app flashes the wrong page),
     or a script runs before the module it reads;
   - an inline script or handler creeps in and the CSP silently drops it;
   - the listing stops asking for a FINISHED job or a track with readings in it,
     and games with no reading at all appear in the picker;
   - a game whose reading places nothing is offered anyway — the fault a reader
     reported, where a game's first play jumped to the moment the score was 7-9;
   - a partly read game is offered with nothing said about what is missing;
   - EpinoiaVideoTab is rendered twice, or without reset() between two games, so
     one game's play list is drawn over another game's footage;
   - the whole log of every game is fetched to draw a dropdown;
   - the rail's row stops starting hidden, and every league on the platform
     advertises a video hub it has nothing in.

   videohub.js is run for real: its pure parts through require, and boot()
   against a small DOM stub over the REAL epinoia/video.js, so the judgement is
   made by the same code that places a play.

     node supabase/tests/videohub-page.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};

const HTML = rd('epinoia', 'video', 'index.html');
const JS = rd('epinoia', 'video', 'videohub.js');
const NAV = rd('epinoia', 'nav.js');
/* the page's own stamp, so a stamp bump never breaks this test */
const V = (/\?v=(\d+)/.exec(HTML) || [])[1] || 'unstamped';

/* ------------------------------------------------------------------ the head --- */
console.log('\nthe page');
{
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const firstScript = /<script\b[^>]*>/i.exec(head);
  ok('appmode.js is the first script, in <head>', !!firstScript && firstScript[0].includes('src="../appmode.js?v=' + V + '"'));
  ok('appmode.js is blocking (no defer, no async)', !!firstScript && !/\b(defer|async)\b/.test(firstScript[0]));
  ok('appmode.js comes before any stylesheet', head.indexOf('appmode.js') < head.indexOf('<link rel="stylesheet"'));
  ok('the manifest is linked', /<link rel="manifest" href="\/epinoia\/manifest\.webmanifest">/.test(head));
  ok('the app title is EPINOIΛ', /<meta name="apple-mobile-web-app-title" content="EPINOIΛ">/.test(head));
  ok('the touch icon and the favicon are the brand\'s',
     /<link rel="apple-touch-icon" href="\.\.\/brand\/epinoia-app-180\.png">/.test(head) &&
     /<link rel="icon"[^>]*href="\.\.\/brand\/epinoia-mark-32\.png">/.test(head));

  /* THE PLAYER IS THE POINT OF THIS PAGE, so the frame policy is checked entry
     by entry rather than "a frame-src exists". */
  const csp = (/Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(head) || [])[1] || '';
  ok('CSP: scripts from self (plus the OCR\'s wasm), never unsafe-inline or unsafe-eval',
     /script-src 'self' 'wasm-unsafe-eval'(;|$)/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp);
  ['\'self\'', 'https://www.youtube.com', 'https://www.youtube-nocookie.com',
   'https://player.twitch.tv', 'https://player.vimeo.com', 'https://www.facebook.com']
    .forEach(src => ok('CSP: frame-src allows ' + src,
      new RegExp('frame-src[^;]*' + src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(csp), csp));
  ok('CSP: media-src carries the mp4 case', /media-src 'self' blob: https:/.test(csp), csp);
  ok('CSP: connects to supabase over https and wss',
     /connect-src[^;]*https:\/\/\*\.supabase\.co/.test(csp) && /connect-src[^;]*wss:\/\/\*\.supabase\.co/.test(csp), csp);
  /* the one line that must not drift from the game page's */
  const gameCsp = (/Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(rd('epinoia', 'game', 'index.html')) || [])[1] || '';
  eq('the policy is the game page\'s, character for character', csp, gameCsp);

  const css = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  eq('stylesheets, in order', css,
     ['../kit/epinoia-kit.css?v=' + V, '../kit/access.css?v=' + V,
      '../kit/nav.css?v=' + V, '../video.css?v=' + V, '../kit/legibility.css?v=' + V]);

  const scripts = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  ok('no inline script: every <script> has a src and no body', scripts.every(m => /\bsrc="/.test(m[1]) && !m[2].trim()));
  ok('no inline event handlers', !/\son[a-z]+\s*=/i.test(HTML));

  const body = HTML.slice(HTML.indexOf('</head>'));
  const deferred = [...body.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(m => m[1].replace('?v=' + V, ''));
  eq('deferred scripts, in order', deferred,
     ['../config.js', '../access.js', '../follow.js', '../engine.js', '../data.js',
      '../video.js', '../videoanchor.js', '../game/video.js', '../game/flow.js',
      'videohub.js', '../nav.js']);
  ok('the page script runs after the tab it renders, and before the rail',
     deferred.indexOf('../game/video.js') < deferred.indexOf('videohub.js') &&
     deferred.indexOf('videohub.js') < deferred.indexOf('../nav.js'));
  ok('game/game.js is NOT loaded (it would drive a page that is not this one)', !/game\/game\.js/.test(HTML));
  ok('every script is stamped ?v=' + V, [...body.matchAll(/<script src="([^"]+)"/g)].every(m => m[1].endsWith('?v=' + V)));

  /* every local file the page asks for is in the repo */
  {
    const here = path.join(ROOT, 'epinoia', 'video');
    const refs = [...HTML.matchAll(/\b(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(m => m[1])
      .filter(u => !/^\/\//.test(u) && u !== '' && !u.startsWith('mailto'));
    const missing = refs.filter(u => {
      const abs = u.startsWith('/') ? path.join(ROOT, u) : path.join(here, u);
      return !existsSync(u.endsWith('/') ? path.join(abs, 'index.html') : abs);
    });
    ok('every script, stylesheet and link the page references exists', refs.length > 10 && !missing.length, missing.join(' '));
  }

  ok('the EPINOIΛ wordmark links to HOME',
     /<a href="\.\.\/home\/"[^>]*>\s*<span[^>]*epinoia-mark[^>]*>EPINOIΛ<\/span><\/a>/.test(HTML));
  ok('the heading is the video hub', /<h1>Video hub<\/h1>/.test(HTML));
  ok('a .hero the kit trims in the league\'s colours', /class="hero"/.test(HTML));
  ok('the three pickers are native selects (a phone\'s own picker, no overflow)',
     /<select id="compPick">/.test(HTML) && /<select id="teamPick">/.test(HTML) && /<select id="gamePick">/.test(HTML));
  ok('every picker is labelled', (HTML.match(/<label for="(comp|team|game)Pick">/g) || []).length === 3);
  ok('a select can never be wider than the gutter at 375px',
     /\.pick select\{[^}]*width:100%[^}]*max-width:100%[^}]*box-sizing:border-box/.test(HTML));
  ok('a host for the tab, and a line for what the reading covers',
     /id="vidHost"/.test(HTML) && /id="cover"/.test(HTML));
  ok('the sitemap lists /epinoia/video/',
     rd('epinoia', 'sitemap.xml').includes('<loc>https://prophesyscouting.co.uk/epinoia/video/</loc>'));
}

/* --------------------------------------------------------------- the query --- */
const HUB = require(path.join(ROOT, 'epinoia', 'video', 'videohub.js'));
const VID = require(path.join(ROOT, 'epinoia', 'video.js'));

/* EVERY TABLE A FILTER NAMES MUST BE EMBEDDED IN THE SELECT.

   PostgREST answers 400 (PGRST108, "'x' is not an embedded resource in this
   request") to a filter on a table the select does not embed — and both places
   these queries are used swallow a failure quietly, one showing no games and
   the other hiding a rail row, so the mistake looks like "this league has no
   video" rather than like an error. This is the shape of that mistake, checked
   rather than the spelling of one query. */
function embedsMatchFilters(q) {
  const select = (/[?&]select=([^&]*)/.exec(q) || [])[1] || '';
  const embedded = new Set([...select.matchAll(/([a-z_]+)!inner\(/g)].map(m => m[1]));
  const filtered = new Set([...q.matchAll(/[?&]([a-z_]+)\.[a-z_]+[=.\-]/g)].map(m => m[1]));
  return [...filtered].filter(t => !embedded.has(t));
}

console.log('\nwhat counts as a read game');
{
  const q = HUB.listingPath('bcb');
  ok('the league is matched through competition and season, inner all the way',
     /competitions!inner\(id,name,seasons!inner\(name,leagues!inner\(id,slug,name\)\)\)/.test(q) &&
     /competitions\.seasons\.leagues\.slug=eq\.bcb/.test(q), q);
  ok('only the PRIMARY recording', /game_videos!inner\([^)]*\)/.test(q) && /game_videos\.is_primary=eq\.true/.test(q), q);
  ok('...which must carry at least one reading',
     q.includes('game_videos.clock_track->samples->0=not.is.null'), q);
  ok('...and a FINISHED reading job', /video_jobs!inner\(status\)/.test(q) && /video_jobs\.status=eq\.done/.test(q), q);
  ok('the anchor columns come with the track (nothing can be placed without them)',
     ['url', 'provider', 'video_ref', 'stream_started_at', 'tip_at', 'tip_wall', 'tip_offset_ms', 'trim_ms', 'clock_track']
       .every(c => HUB.VIDEO_COLS.split(',').indexOf(c) !== -1), HUB.VIDEO_COLS);
  ok('the game\'s own last period is read, so an unread overtime is noticed', /select=id,tipoff_at,status,period,/.test(q), q);
  ok('newest first', /order=tipoff_at\.desc/.test(q), q);
  ok('the slug is encoded', HUB.listingPath('a b&c').includes('slug=eq.a%20b%26c'));
  ok('the listing asks for no event log at all', !/game_events/.test(q), q);
  eq('every table the listing filters on is embedded in its select (PGRST108)', embedsMatchFilters(q), []);
  /* the wall clock is the only axis a recording shares with the log */
  ok('the event read asks for created_at', /select=seq,t,team,pid,period,clock,payload,created_at/.test(JS));
}

/* ----------------------------------------------------------- the judgement --- */
console.log('\njudging a reading');
const clockTrack = (runs, extra) => Object.assign({
  mode: 'clock+score', format: 'epinoia-clock-track/1',
  samples: runs.length ? [{ t: runs[0].t0, how: 'free', conf: 0.9, period: runs[0].period, clock_ms: runs[0].c0 }] : [],
  runs: runs
}, extra || {});
const run = (period, t0, c0) => ({ period, t0, t1: t0 + 40, c0, c1: c0 - 40000 });
const scoreTrack = samples => ({ mode: 'score', format: 'epinoia-clock-track/1', samples });
const reads = (period, n, conf) => Array.from({ length: n }, (_, i) =>
  ({ t: period * 1000 + i * 20, how: 'score', conf: conf == null ? 0.95 : conf, period, clock_ms: 500000 - i * 20000 }));
/* readings a long way apart with the clock standing still: confident, and no run
   in them, which is the reader watching a stopped scoreboard */
const stalled = (period, n) => Array.from({ length: n }, (_, i) =>
  ({ t: i * 100, how: 'candidates', conf: 0.9, period, clock_ms: 300000 }));

{
  const full = HUB.judge({ clock_track: clockTrack([run(1, 100, 600000), run(2, 900, 600000), run(3, 1800, 600000), run(4, 2700, 600000)]) }, 4, VID);
  eq('a clock read in all four quarters: listed, nothing to warn about', [full.usable, full.read, full.short, full.note], [true, [1, 2, 3, 4], '', '']);

  const noQ1 = HUB.judge({ clock_track: clockTrack([run(2, 900, 600000), run(3, 1800, 600000), run(4, 2700, 600000)]) }, 4, VID);
  ok('a clock that never locked onto the first quarter is listed', noQ1.usable);
  eq('...labelled in the picker', noQ1.short, 'no Q1');
  ok('...and says so in full', /^The first quarter was not read/.test(noQ1.note), noQ1.note);

  const q4 = HUB.judge({ clock_track: clockTrack([run(4, 8000, 137000)]) }, 4, VID);
  eq('a broadcast read only in its fourth quarter: listed, plainly labelled', [q4.usable, q4.short], [true, 'Q4 only']);
  ok('...and says which quarter it can place', /^Only the fourth quarter/.test(q4.note), q4.note);

  const half = HUB.judge({ clock_track: clockTrack([run(3, 1800, 600000), run(4, 2700, 600000)]) }, 4, VID);
  eq('the second half only, said as a half rather than as a list', [half.short, half.note],
     ['second half only', 'Only the second half of this broadcast was read.']);

  /* WHAT A MISSING PERIOD MEANS depends on the log, not on the reading: video.js
     places those plays from the log's own time of day, near the moment rather
     than on it, unless the log was imported in bulk and has no time of day. */
  const live = Array.from({ length: 30 }, (_, i) =>
    ({ period: 1, clock: 600000 - i * 20000, created_at: new Date(1789234000000 + i * 20000).toISOString(), wall: 1 }));
  ok('a live-scored log: the plays are placed roughly, and the tilde is explained',
     /placed from the scorer’s own timing/.test(HUB.placingNote(live, VID)) &&
     /tilde/.test(HUB.placingNote(live, VID)), HUB.placingNote(live, VID));
  const bulk = Array.from({ length: 30 }, (_, i) =>
    ({ period: 1, clock: 600000 - i * 20000, created_at: '2026-09-12T20:00:00.00' + (i % 9) + 'Z' }));
  ok('a log imported in bulk: they are not in the list at all, and it says why',
     /imported in bulk/.test(HUB.placingNote(bulk, VID)), HUB.placingNote(bulk, VID));

  const none = HUB.judge({ clock_track: { mode: 'clock+score', format: 'epinoia-clock-track/1', samples: stalled(1, 8), runs: [] } }, 4, VID);
  eq('a clock read but never running is NOT listed', [none.usable, none.read], [false, []]);
  ok('...and says why', /never read running/.test(none.note), none.note);
  eq('a track with no readings at all says that instead',
     HUB.judge({ clock_track: clockTrack([]) }, 4, VID).note, 'This broadcast has not been read.');

  /* the fault a reader reported: one stray low-confidence reading, every play
     in the game pinned to the one instant it names */
  const junk = HUB.judge({ clock_track: scoreTrack([{ t: 1293, how: 'score', conf: 0, period: 1, clock_ms: 473000 }]) }, 4, VID);
  eq('a score track of one unsure reading is not listed', [junk.usable, junk.read], [false, []]);
  const thin = HUB.judge({ clock_track: scoreTrack([{ t: 100, how: 'score', conf: 1, period: 1, clock_ms: 500000 },
                                                    { t: 200, how: 'score', conf: 1, period: 1, clock_ms: 480000 }]) }, 4, VID);
  ok('two confident readings are still a straight line through a game, not a map', !thin.usable);
  ok('three are a map', HUB.judge({ clock_track: scoreTrack(reads(1, 3)) }, 4, VID).usable);

  const scored = HUB.judge({ clock_track: scoreTrack(reads(1, 6).concat(reads(2, 6), reads(3, 6), reads(4, 6))) }, 4, VID);
  eq('a score track read in every quarter: listed, nothing to warn about', [scored.usable, scored.short], [true, '']);
  const noOt = HUB.judge({ clock_track: scoreTrack(reads(1, 6).concat(reads(2, 6), reads(3, 6), reads(4, 6))) }, 5, VID);
  eq('...and an overtime nobody read is not passed over in silence', noOt.short, 'no OT1');
  ok('...in English too', /^The first overtime was not read/.test(noOt.note), noOt.note);

  eq('no track at all is not listed', HUB.judge({ clock_track: null }, 4, VID).usable, false);
  eq('no video row at all is not listed', HUB.judge(null, 4, VID).usable, false);

  /* the reader's own confidence floor, applied here exactly as video.js applies it */
  ok('readings the reader was unsure of do not count as coverage',
     !HUB.judge({ clock_track: scoreTrack(reads(1, 8, 0.05)) }, 4, VID).usable);
  eq('the floor for a score track is three readings in a period', HUB.MIN_SCORE_READS, 3);
}

console.log('\nsaying it in English');
{
  eq('one quarter', HUB.periodWords([2]), 'the second quarter');
  eq('two quarters', HUB.periodWords([1, 2]), 'the first and second quarters');
  eq('three, with the Oxford-free list the rest of the site uses', HUB.periodWords([1, 2, 4]), 'the first, second and fourth quarters');
  eq('an overtime', HUB.periodWords([5]), 'the first overtime');
  eq('quarters and overtimes together', HUB.periodWords([4, 5]), 'the fourth quarter and the first overtime');
  eq('a day with no year when it is this year',
     HUB.dayText(new Date(Date.now() - 86400000).toISOString()).includes(String(new Date().getFullYear())), false);
  eq('a game from another year carries it', HUB.dayText('2019-03-04T18:00:00Z'), '4 Mar 2019');
  eq('a nonsense date says nothing rather than NaN', HUB.dayText('not a date'), '');
  ok('the picker\'s label is the day, the fixture, the score and the warning',
     HUB.gameLabel({ tipoff_at: '2019-03-04T18:00:00Z', home: { name: 'Essex Rebels' }, away: { name: 'Worthing Thunder' },
                     home_score: 73, away_score: 86, judged: { short: 'no Q1' } }) ===
     '4 Mar 2019  ·  Essex Rebels v Worthing Thunder  73-86  · no Q1');
}

/* ------------------------------------------------------------------- boot --- */
class Node_ {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this._text = ''; this.hidden = false; this.disabled = false;
    this.attrs = {}; this.listeners = {}; this.value = ''; this.html = '';
    this.cls = new Set();
    const self = this;
    this.classList = {
      add: c => self.cls.add(c), remove: c => self.cls.delete(c),
      contains: c => self.cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on;
        if (want) self.cls.add(c); else self.cls.delete(c); return want; }
    };
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = v == null ? '' : String(v); }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.children = []; this._text = ''; this.html = String(v); }
  appendChild(n) { this.children.push(n); this.html = ''; return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t) { (this.listeners[t] || []).forEach(fn => fn({})); }
}
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 24) => { for (let i = 0; i < n; i++) await tick(); };

/* two clock-read games, one of them missing its first quarter; one score-read
   game; one junk reading that must not be offered at all */
const LISTING = [
  { id: 'G1', tipoff_at: '2026-09-12T17:30:00Z', status: 'final', period: 4, home_score: 80, away_score: 85,
    home: { id: 'T1', name: 'Loughborough Riders' }, away: { id: 'T2', name: 'Hemel Storm' },
    competitions: { id: 'C1', name: 'BCB Trophy 2027', seasons: { name: '2026-27', leagues: { id: 'L1', slug: 'bcb', name: 'BCB' } } },
    game_videos: [{ url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube', video_ref: 'abc',
      clock_track: clockTrack([run(1, 100, 600000), run(2, 900, 600000), run(3, 1800, 600000), run(4, 2700, 600000)]) }],
    video_jobs: [{ status: 'done' }] },
  { id: 'G2', tipoff_at: '2026-09-12T17:00:00Z', status: 'final', period: 4, home_score: 73, away_score: 86,
    home: { id: 'T3', name: 'Essex Rebels' }, away: { id: 'T2', name: 'Hemel Storm' },
    competitions: { id: 'C1', name: 'BCB Trophy 2027', seasons: { name: '2026-27', leagues: { id: 'L1', slug: 'bcb', name: 'BCB' } } },
    game_videos: [{ url: 'https://www.youtube.com/watch?v=def', provider: 'youtube', video_ref: 'def',
      clock_track: clockTrack([run(2, 900, 600000), run(3, 1800, 600000), run(4, 2700, 600000)]) }],
    video_jobs: [{ status: 'done' }] },
  { id: 'G3', tipoff_at: '2026-09-06T14:00:00Z', status: 'final', period: 4, home_score: 96, away_score: 95,
    home: { id: 'T4', name: 'Milton Keynes Breakers' }, away: { id: 'T1', name: 'Loughborough Riders' },
    competitions: { id: 'C2', name: 'BCB League', seasons: { name: '2026-27', leagues: { id: 'L1', slug: 'bcb', name: 'BCB' } } },
    game_videos: [{ url: 'https://www.youtube.com/watch?v=ghi', provider: 'youtube', video_ref: 'ghi',
      clock_track: scoreTrack([{ t: 1293, how: 'score', conf: 0, period: 1, clock_ms: 473000 }]) }],
    video_jobs: [{ status: 'done' }] },
  { id: 'G4', tipoff_at: '2026-09-05T14:00:00Z', status: 'final', period: 4, home_score: 68, away_score: 84,
    home: { id: 'T5', name: 'Oaklands Wolves' }, away: { id: 'T4', name: 'Milton Keynes Breakers' },
    competitions: { id: 'C2', name: 'BCB League', seasons: { name: '2026-27', leagues: { id: 'L1', slug: 'bcb', name: 'BCB' } } },
    game_videos: [{ url: 'https://www.youtube.com/watch?v=jkl', provider: 'youtube', video_ref: 'jkl',
      clock_track: scoreTrack(reads(1, 6).concat(reads(2, 6), reads(3, 6), reads(4, 6))) }],
    video_jobs: [{ status: 'done' }] }
];

async function bootWith({ search = '?l=bcb', listing = LISTING, access = null } = {}) {
  const ids = ['ctx', 'foot', 'fxLink', 'cover', 'picks', 'compWrap', 'teamWrap',
               'compPick', 'teamPick', 'gamePick', 'vidHost', 'accessWall'];
  const nodes = {};
  ids.forEach(id => { nodes['#' + id] = new Node_(/Pick$/.test(id) ? 'select' : 'div'); });
  nodes['#accessWall'].cls.add('hide');
  const log = { urls: [], renders: [], resets: [], order: [] };

  const g = globalThis;
  g.document = {
    title: '',
    querySelector: s => (s in nodes ? nodes[s] : null),
    createElement: t => new Node_(t)
  };
  g.location = { search, pathname: '/epinoia/video/' };
  g.history = { state: null, replaceState: (s, t, u) => log.urls.push(u) };
  g.EPINOIA_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' };
  g.EpinoiaVideo = VID;
  g.EpinoiaEngine = { deriveGame: S => ({ pbp: [], from: S }) };
  g.EpinoiaVideoTab = {
    reset: () => { log.resets.push(1); log.order.push('reset'); },
    render: o => { log.renders.push(o); log.order.push('render:' + (o.game && o.game.id)); }
  };
  g.EpinoiaAccess = access;
  g.fetch = async url => {
    log.urls.push(url);
    const body = url.includes('leagues?slug=') ? [{ id: 'L1', slug: 'bcb', name: 'BCB' }]
      : /games\?select=id,tipoff_at/.test(url) ? listing
      : /games\?id=eq\./.test(url) ? [{ id: 'G', status: 'final', period: 4,
          roster_snapshot: { teams: [{ name: 'loughborough riders', color: '#111111', players: [{ id: 'p1', num: 4, name: 'jax bouknight' }] },
                                     { name: 'hemel storm', color: '#222222', players: [{ id: 'p2', num: 7, name: "sean o'neil" }] }] },
          starters: [['p1'], ['p2']], tip_winner: 0, arrow_init: 1 }]
      : /game_events\?/.test(url) ? [{ seq: 1, t: 'shot_made', team: 0, pid: 'p1', period: 1, clock: 599000,
          payload: { pts: 2, wall: 1 }, created_at: '2026-09-12T17:31:00Z' }]
      : [];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  HUB.boot();
  await settle();
  return { nodes, log };
}

console.log('\nthe page boots');
{
  const { nodes, log } = await bootWith({});
  const games = nodes['#gamePick'].children.map(o => o.value);
  eq('only the games whose reading can place a play are offered', games, ['G1', 'G2', 'G4']);
  ok('the junk reading is not in the picker', games.indexOf('G3') === -1);
  const labels = nodes['#gamePick'].children.map(o => o.textContent);
  ok('a partly read game carries its warning in the picker', /no Q1/.test(labels[1]), labels.join(' | '));
  ok('a fully read game carries none', !/·\s*no |only/.test(labels[0]), labels[0]);
  ok('the league is named for the rail, so the page wears its colours', globalThis.__CS_LEAGUE_SLUG === 'bcb');
  ok('the newest read game opens by itself', log.order[log.order.length - 1] === 'render:G1', JSON.stringify(log.order));
  eq('the tab is reset before it is ever rendered', log.order[0], 'reset');
  eq('one game on screen means one render', log.renders.length, 1);
  ok('the render got the tab everything it needs',
     log.renders[0].host === '#vidHost' && !!log.renders[0].video && !!log.renders[0].S && !!log.renders[0].d &&
     log.renders[0].events.length === 1 && log.renders[0].canEdit === false);
  ok('the event log arrived flattened, with the wall clock on it',
     log.renders[0].events[0].wall === 1 && log.renders[0].events[0].created_at === '2026-09-12T17:31:00Z');
  ok('the club\'s own name and the roster\'s capitals win over the snapshot\'s lower case',
     log.renders[0].S.teams[0].name === 'Loughborough Riders' &&
     log.renders[0].S.teams[0].players[0].name === 'Jax Bouknight' &&
     log.renders[0].S.teams[1].players[0].name === "Sean O'Neil",
     JSON.stringify(log.renders[0].S.teams));
  ok('the chosen game is in the address, without a history entry per choice',
     /[?&]g=G1\b/.test(log.urls[log.urls.length - 1] || '') || log.urls.some(u => /[?&]g=G1\b/.test(u)));

  /* ONE LOG, NOT FOUR: the dropdown is drawn from the listing alone */
  const logReads = log.urls.filter(u => /game_events\?/.test(u));
  eq('only the chosen game\'s log is fetched', logReads.length, 1);
  ok('...and it is that game\'s', /game_id=eq\.G1/.test(logReads[0]), logReads[0]);

  /* choosing another game */
  nodes['#gamePick'].value = 'G2';
  nodes['#gamePick'].fire('change');
  await settle();
  const tail = log.order.slice(log.order.indexOf('render:G1') + 1);
  ok('a second game resets the tab before rendering it', tail.indexOf('reset') > -1 &&
     tail.indexOf('reset') < tail.indexOf('render:G2'), JSON.stringify(tail));
  ok('...and never renders two at once', log.renders.length === 2);
  ok('the coverage line says what the reading missed', /first quarter was not read/.test(nodes['#cover'].textContent),
     nodes['#cover'].textContent);
  ok('...and is marked as a warning', nodes['#cover'].cls.has('warn'));

  /* the filters */
  nodes['#teamPick'].value = 'T5';        // Oaklands, who are only in G4
  nodes['#teamPick'].fire('change');
  await settle();
  eq('a club filter narrows the games to that club\'s', nodes['#gamePick'].children.map(o => o.value), ['G4']);
  ok('...and opens what is left', log.order[log.order.length - 1] === 'render:G4', JSON.stringify(log.order.slice(-3)));
  eq('the competition picker offers every competition, plus all of them',
     nodes['#compPick'].children.map(o => o.textContent), ['All competitions', 'BCB Trophy 2027', 'BCB League']);
  eq('the club picker is alphabetical', nodes['#teamPick'].children.map(o => o.textContent),
     ['All clubs', 'Essex Rebels', 'Hemel Storm', 'Loughborough Riders', 'Milton Keynes Breakers', 'Oaklands Wolves']);
  nodes['#compPick'].value = 'C1';        // the Trophy, which Oaklands did not play in
  nodes['#compPick'].fire('change');
  await settle();
  ok('filters that leave nothing say so rather than showing a dead picker',
     /No read game matches/.test(nodes['#vidHost'].innerHTML), nodes['#vidHost'].innerHTML);
}
{
  /* a link to one game opens that game rather than the newest */
  const { log } = await bootWith({ search: '?l=bcb&g=G4' });
  ok('a shared link opens the game it names', log.order[log.order.length - 1] === 'render:G4', JSON.stringify(log.order));
}
{
  const { nodes, log } = await bootWith({ listing: [LISTING[2]] });
  ok('a league whose only reading is junk offers nothing', log.renders.length === 0);
  ok('...and says plainly that the readings cannot be trusted',
     /no stretch of any of them the clock could be trusted in/.test(nodes['#vidHost'].innerHTML), nodes['#vidHost'].innerHTML);
  ok('...with the pickers taken away', nodes['#picks'].cls.has('hide'));
}
{
  const { nodes, log } = await bootWith({ listing: [] });
  ok('a league with no reading at all says so', /has had its broadcast read yet/.test(nodes['#vidHost'].innerHTML));
  ok('...and renders no tab', log.renders.length === 0);
}
{
  const { nodes, log } = await bootWith({ search: '' });
  ok('the page opened with no league asks for one', /belongs to a league/.test(nodes['#vidHost'].innerHTML));
  ok('...and asks the database nothing', log.urls.length === 0);
}
{
  /* memberships: a league this viewer may not see gets the card, not the hub */
  const { nodes, log } = await bootWith({ access: {
    load: async () => {}, get: () => ({ known: true }), canView: () => false,
    analyticsOk: () => false, paywallHTML: () => '<section class="ep-paywall">members only</section>',
    authHeaders: () => ({}) } });
  ok('a members-only league shows the paywall card', /ep-paywall/.test(nodes['#accessWall'].innerHTML));
  ok('...instead of the hub', log.renders.length === 0 && nodes['#picks'].cls.has('hide') && !nodes['#accessWall'].cls.has('hide'));
  ok('...and never asks for a game', !log.urls.some(u => /game_events/.test(u)));
}
{
  /* the runs are game flow's analysis, which is the members' where analytics are locked */
  const { log } = await bootWith({ access: {
    load: async () => {}, get: () => ({ known: true }), canView: () => true,
    analyticsOk: () => false, paywallHTML: () => '', authHeaders: () => ({}) } });
  ok('a locked league renders the tab with its runs locked', log.renders.length === 1 && log.renders[0].runsLocked === true);
}
{
  const { log } = await bootWith({ access: {
    load: async () => {}, get: () => ({ known: true }), canView: () => true,
    analyticsOk: () => true, paywallHTML: () => '', authHeaders: () => ({}) } });
  ok('an open league renders the tab with its runs', log.renders[0].runsLocked === false);
}

/* ------------------------------------------------------------- the rail --- */
console.log('\nthe rail\'s row');
{
  ok('the hub is a league page in nav.js PAGES', /href: 'video\/',[^\n]*key: 'video'/.test(NAV), (/\{ href: 'video\/'[\s\S]{0,140}/.exec(NAV) || [])[0]);
  ok('...and a league may switch it off like any other', /key: 'video', probe: 'video'/.test(NAV));
  ok('a probed row starts hidden', /if \(it\.probe\) \{ a\.hidden = true; probed\.push\(\[a, it\.probe\]\); \}/.test(NAV));
  ok('...and applyNav may hide it but never show it',
     /const isLatched = node => gated\.some\([^)]*\) \|\| probed\.some\([^)]*\);/.test(NAV) &&
     /if \(!isLatched\(node\)\) node\.hidden = off;/.test(NAV));
  ok('the row is shown only when the probe said yes',
     /node\.hidden = probeSaid\[kind \+ '\|' \+ lg\] !== true \|\| node\.dataset\.navOff === '1';/.test(NAV));
  ok('a page with no league never asks, and shows nothing',
     /if \(!slug\) \{ paintProbes\(\); return; \}/.test(NAV));
  const probe = (/function probeQuery\(kind, slug\) \{[\s\S]*?\n  \}/.exec(NAV) || [''])[0];
  ok('the probe is the listing reduced to "does one exist"',
     /game_videos\.is_primary=eq\.true/.test(probe) &&
     probe.includes('game_videos.clock_track->samples->0=not.is.null') &&
     /video_jobs\.status=eq\.done/.test(probe) && /limit=1/.test(probe), probe);
  ok('...carrying no payload beyond the id', /select=id,/.test(probe) && !/tipoff_at|clock_track\)/.test(probe), probe);
  /* the probe builds one string; run it as the rail would and check its shape */
  {
    const built = (/return ('games\?[\s\S]*?);\n/.exec(probe) || [])[1] || '';
    const url = built.replace(/'\s*\+\s*'/g, '').replace(/'\s*\+\s*encodeURIComponent\(slug\)\s*\+\s*'/g, 'bcb')
      .replace(/'\s*\+\s*encodeURIComponent\(slug\);?/, 'bcb').replace(/^'|'$/g, '');
    ok('the probe assembles into one query', /^games\?select=id,/.test(url), url);
    eq('every table the probe filters on is embedded in its select (PGRST108)', embedsMatchFilters(url), []);
  }
  ok('the answer is remembered for the session', /sessionStorage/.test(NAV) && /ep-nav-probe-/.test(NAV));
  ok('...and a failure leaves the row hidden rather than shown',
     /\.catch\(\(\) => \{ probeAsked\[key\] = false; \}\)/.test(NAV));
  ok('the phone tab bar is untouched by it',
     /\{ key: 'fixtures' \}, \{ key: 'table' \}, \{ key: 'teams' \}, \{ key: 'statistics' \}, \{ key: 'news' \}/.test(NAV));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
