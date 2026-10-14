'use strict';
/* ============================================================================
   The console's Analytics tab — how the site is used, from site_events (migration 0173).

   EVERYTHING HERE IS ANONYMOUS. The rows behind it carry no account, no IP address, no
   cookie and nothing that outlives a browser tab (track.js explains exactly what is sent).
   So a "visit" is one tab's session, and there is deliberately no "unique people" figure
   across days: counting the same person twice on two days is the price of never being able
   to recognise them.

   One call, analytics_report(p_days), returns every figure; it answers platform
   administrators only. WHAT PEOPLE SEARCH FOR (the rail's search box, migration 0180) is a second call,
   analytics_search_report(p_days), drawn under the visits: the searches, the most common, the ones that found
   nothing (what the site is missing, or how it is spelled), and what gets picked. It is as anonymous as the
   rest - only the folded words, how many results there were and what was picked; no visit token, so a search is
   tied to nothing - and a database that has not had 0180 says so in a line instead of failing the tab. LIVE NOW (analytics_live, migration 0176) is a separate call that runs only
   while somebody has switched it on: it is off when the tab opens, polls every ten seconds, pauses
   while the window is hidden, and stops by itself after ten minutes or when the tab is left. Charts are one accent hue on the kit's own tokens (light and dark),
   every bar list is also its own table, and every column carries its numbers on hover.
   VIEWS (2026-10-14): the tab is split into views, each fetching only its own report, once per range - Overview, then from
   analytics_activity_report (migration 0260) Insights (findings worked out from the figures, with their numbers), Time on page,
   Video, Downloads, Links & sharing and Speed & errors, then Search and Where visits come from.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAnalyticsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const LIVE_EVERY_MS = 10000;          // one call every ten seconds, and only while live mode is on
const LIVE_MAX_MS = 10 * 60 * 1000;   // ...for at most ten minutes at a time
const LIVE_LONG_MS = 60 * 60 * 1000;  // ...or an hour, when the button next to it is pressed
const ROWS_SHOWN = 10;                // a table shows this many rows and scrolls for the rest

const RANGES = [[1, 'last 24 hours'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];

/* what each page of the site is called here; anything new shows its path */
const PAGE = {
  splash: 'Splash', home: 'HOME', l: 'League table / team stats', t: 'Club profile', p: 'Player profile',
  game: 'Game (box score)', fixtures: 'Fixtures', stats: 'Statistics', 'stats/wowy': 'WOWY',
  injuries: 'Injury report', news: 'News', video: 'Video hub', games: 'Games (every league)',
  'home/video': 'HOME · VIDEO view', winning: 'What wins',
  scouting: 'Scouting', go: 'EPINOIA GO', 'go/stamps': 'GO · stamps', 'go/photos': 'GO · photos',
  me: 'Profile', signin: 'Sign in', join: 'Join', invite: 'Invite', learn: 'Learn more', api: 'API',
  contact: 'Contact', privacy: 'Privacy', android: 'Android app', ios: 'iPhone app', app: 'App',
  prophesy: 'Prophesy', fixtures_all: 'Fixtures',
  creators: 'Creators', 'creators/hub': 'Creator hub', 'creators/studio': 'Creator studio', community: 'Community', fan: 'Fan page',
  leaderboards: 'Leaderboards', 'go/leaderboards': 'GO · leaderboards', 'go/nearby': 'GO · near me', manager: 'EPINOIA Manager',
  profile: 'Profile dashboard', votes: "Fans' vote", watch: 'Watch page', edit: 'Video editor', countries: 'Countries',
  embed: 'Widget gallery', 'embed/table': 'Table widget', 'embed/strip': 'Scores strip widget', 'embed/game': 'Game widget',
  'embed/merch': 'Merch widget', 'embed/notify': 'Alerts widget'
};
const GAME_TAB = {
  box: 'Box score', pbp: 'Play-by-play', shots: 'Shot charts', adv: 'Full stats', lineups: 'Lineups',
  flow: 'Game flow', connections: 'Connections', events: 'Events', shotclock: 'Shot clock analysis',
  video: 'Video', report: 'Match report', preview: 'Preview'
};
/* what is done in the VIDEO view (HOME's, and a club page's Video tab) and the chat, as track.js action() names it */
const VIDEO_ACT = {
  'rail-videos': 'Rail: VIDEOS pressed', main: 'Back to MAIN',
  'kind-all': 'Chose ALL', 'kind-highlights': 'Chose HIGHLIGHTS', 'kind-full': 'Chose FULL GAMES',
  'kind-press': 'Chose PRESS CONFERENCES', 'kind-video': 'Chose VIDEOS',
  'league-pick': 'Picked a league', 'league-all': 'All leagues again',
  'play-highlights': 'Played a highlight', 'play-full': 'Played a full game', 'play-press': 'Played a press conference',
  'play-video': 'Played a video', 'play-live': 'Played a past stream',
  'live-game': 'Chose a live game', 'live-play': 'Started a live stream', 'live-fullscreen': 'Live in full screen',
  more: 'Show more', 'watch-here': 'Came by WATCH HERE', 'chat-join': 'Joined a game chat', 'chat-send': 'Sent a chat message'
};
const isVideoAct = k => Object.prototype.hasOwnProperty.call(VIDEO_ACT, k) || /^(play|kind|live)-/.test(k || '');
/* a tab or action key in words: a box score's tabs by their names, the VIDEO view's actions by theirs */
const tabName = (page, tab) => (page === 'game' ? GAME_TAB[tab] : VIDEO_ACT[tab]) || tab;
const DEVICE = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop', unknown: 'Unknown' };
const LANG = { en: 'English', ja: 'Japanese', es: 'Spanish', unknown: 'Unknown' };
const APP = { web: 'Browser', android: 'Android app', ios: 'iPhone app' };

const CSS = `
.an-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 calc(var(--u)*2)}
.an-bar .ep-btn.on{border-color:var(--lume);color:var(--lume)}
.an-note{font-family:var(--f-micro);font-size:9px;color:var(--ink-3);margin-left:auto}
.an-off{border:1px solid var(--amber);color:var(--amber);padding:10px 12px;font-family:var(--f-micro);
  font-size:9.5px;line-height:1.8;margin:0 0 calc(var(--u)*2)}
.an-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:calc(var(--u)*3);margin-bottom:calc(var(--u)*2)}
.an-card .tbl td{padding:6px 8px}
.an-card .tbl th.r{text-align:right}
.an-card .tbl td.num{width:1%}
.an-card{min-width:0}
.an-card h3{margin-top:calc(var(--u)*3)}
.an-meter{height:6px;border-radius:0 3px 3px 0;background:color-mix(in oklch,var(--lume) 78%,transparent);min-width:2px}
.an-meter-cell{width:26%;min-width:48px;vertical-align:middle !important}
.an-chart{width:100%;height:auto;display:block;overflow:visible}
.an-chart .col{fill:color-mix(in oklch,var(--lume) 78%,transparent)}
.an-chart .col:hover,.an-chart .col.hi{fill:var(--lume)}
.an-chart .axis{fill:var(--ink-3);font-family:var(--f-micro);font-size:9px}
.an-chart .grid{stroke:var(--rule);stroke-width:1}
.an-tip{position:fixed;pointer-events:none;z-index:50;background:var(--panel,var(--ground));
  border:1px solid var(--rule-2,var(--rule));padding:6px 9px;font-family:var(--f-data);font-size:11px;
  color:var(--ink);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.an-heat td.num{position:relative}
.an-empty{font-family:var(--f-micro);font-size:9.5px;color:var(--ink-3);padding:10px 0}
/* EVERY TABLE IS CAPPED. It shows about ten rows and scrolls for the rest, its header held in place, so a list
   that grows (games, clubs, pages) can never push the page out of reach. */
.an-card .scroll{max-height:340px;overflow:auto;overscroll-behavior:contain}
.an-card .scroll thead th{position:sticky;top:0;z-index:2;background:var(--ground)}
.an-more{font-family:var(--f-micro);font-size:9px;letter-spacing:.06em;color:var(--ink-3);margin:6px 0 0}
/* live now */
.an-live{border:1px solid var(--rule);padding:calc(var(--u)*2) calc(var(--u)*3);margin:0 0 calc(var(--u)*3)}
.an-live h3{margin:0}
.an-live-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px}
.an-live-head .an-note{margin-left:0}
.an-live .ep-btn.on{border-color:var(--lume);color:var(--lume)}
.an-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ink-3);margin-right:6px}
.an-live.running .an-dot{background:var(--lume);animation:an-pulse 1.4s ease-in-out infinite}
@keyframes an-pulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.an-live.running .an-dot{animation:none}}
.an-live-off{font-family:var(--f-micro);font-size:9.5px;line-height:1.8;color:var(--ink-3);margin:6px 0 0;max-width:70ch}
.an-views{display:flex;flex-wrap:wrap;gap:0;border-bottom:1px solid var(--rule);margin:0 0 calc(var(--u)*3)}
.an-view{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:9px 12px;cursor:pointer;
  font-family:var(--f-ui);font-weight:700;font-size:12.5px;letter-spacing:.02em;color:var(--ink-3)}
.an-view:hover{color:var(--ink)}
.an-view.on{color:var(--ink);border-bottom-color:var(--lume)}
.an-view:focus-visible{outline:2px solid var(--lume);outline-offset:-2px}
@media (max-width:719px){.an-views{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.an-view{white-space:nowrap}}
.an-body > .an-card{margin-bottom:calc(var(--u)*3)}
.an-ins{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.an-in{border:1px solid var(--rule);border-left-width:4px;padding:10px 12px;background:var(--ground)}
.an-in.fix{border-left-color:var(--bad)}
.an-in.improve{border-left-color:var(--amber)}
.an-in.works{border-left-color:var(--good)}
.an-in-h{font-family:var(--f-ui);font-weight:800;font-size:13.5px;color:var(--ink);display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.an-in-t{font-family:var(--f-ui);font-size:12.5px;line-height:1.55;color:var(--ink-2);margin-top:4px;max-width:80ch}
.an-tag{font-family:var(--f-micro);font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;padding:2px 6px;border:1px solid currentColor}
.an-in.fix .an-tag{color:var(--bad)}
.an-in.improve .an-tag{color:var(--amber)}
.an-in.works .an-tag{color:var(--good)}
.an-h2{font-family:var(--f-ui);font-weight:800;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);margin:calc(var(--u)*4) 0 calc(var(--u)*2)}
`;

function el(t, c, x) { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
const fmt = n => Number(n || 0).toLocaleString('en-GB');
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');

let st = null;

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  if (!document.getElementById('an-css')) { const s = el('style'); s.id = 'an-css'; s.textContent = CSS; document.head.appendChild(s); }
  st = st || { days: 30, live: { on: false } };
  st.sb = o.sb; st.say = o.say || (() => {}); st.host = host;
  draw(true);
}

/* ============================================================================
   THE VIEWS (2026-10-14). The tab is split into views, and a view fetches only its own report, once per range (refresh
   fetches again): Overview (analytics_report), and from ONE call to analytics_activity_report (0260) Insights, Time on page,
   Video, Downloads, Links & sharing and Speed & errors; Search and Where visits come from as before.
   ============================================================================ */
const VIEWS = [
  ['overview', 'Overview'], ['insights', 'Insights'], ['time', 'Time on page'], ['video', 'Video'], ['downloads', 'Downloads'],
  ['links', 'Links & sharing'], ['health', 'Speed & errors'], ['search', 'Search'], ['sources', 'Where visits come from']
];
const VIEW_KEY = 'epinoia.analytics.view';
function savedView() { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.some(x => x[0] === v) ? v : 'overview'; } catch (_) { return 'overview'; } }
function keepView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (_) { /* a private window */ } }

async function draw(fresh) {
  const host = st.host;
  if (fresh) st.cache = {};
  st.cache = st.cache || {};
  st.view = st.view || savedView();
  host.textContent = '';
  const bar = el('div', 'an-bar');
  RANGES.forEach(([d, label]) => {
    const b = el('button', 'ep-btn mini' + (st.days === d ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { st.days = d; draw(); });
    bar.appendChild(b);
  });
  const again = el('button', 'ep-btn mini', 'refresh'); again.type = 'button';
  again.addEventListener('click', () => draw(true));
  bar.appendChild(again);
  const note = el('span', 'an-note', 'loading…');
  bar.appendChild(note);
  host.appendChild(bar);

  const views = el('nav', 'an-views');
  views.setAttribute('aria-label', 'Analytics views');
  VIEWS.forEach(([k, label]) => {
    const b = el('button', 'an-view' + (st.view === k ? ' on' : ''), label);
    b.type = 'button';
    if (st.view === k) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { if (st.view !== k) { st.view = k; keepView(k); draw(); } });
    views.appendChild(b);
  });
  host.appendChild(views);
  host.appendChild(liveCard());          // its own element, kept across redraws so a running live view is not reset

  const cfg = window.EPINOIA_CONFIG || {};
  if (cfg.analytics !== true) {
    host.appendChild(el('div', 'an-off',
      'Counting is switched off on the site (config.js analytics: false), so the figures below only cover the time it was on.'));
  }
  const body = el('div', 'an-body');
  host.appendChild(body);
  const stamp = () => { note.textContent = 'updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  const v = st.view;

  if (v === 'search') { stamp(); return drawSearch(body); }
  if (v === 'sources') { stamp(); return drawSources(body); }
  if (v === 'overview') {
    const r = await cached('overview', 'analytics_report', note, body,
      'The analytics tables are not in the database yet: migration 0173 has not been applied.');
    if (r && st.view === v) { stamp(); render(body, r); }
    return;
  }
  const a = await cached('activity', 'analytics_activity_report', note, body,
    'Time on page, video, downloads, links, speed and errors need migration 0260, which has not been applied yet. ' +
    'Until it is, the tracker sends none of it (it stops after one refused call per page).');
  if (!a || st.view !== v) return;
  stamp();
  ({ insights: renderInsights, time: renderTime, video: renderVideo, downloads: renderDownloads,
     links: renderLinks, health: renderHealth })[v](body, a);
}
/* one call per report and range, kept until refresh */
async function cached(key, fn, note, body, missing) {
  const k = key + ':' + st.days;
  if (st.cache[k]) return st.cache[k];
  try {
    const res = await st.sb.rpc(fn, { p_days: st.days });
    if (res.error) throw res.error;
    st.cache[k] = res.data || {};
    return st.cache[k];
  } catch (e) {
    note.textContent = '';
    const msg = String((e && e.message) || e);
    body.appendChild(el('div', 'an-off', new RegExp(fn + '|schema cache|does not exist|PGRST202', 'i').test(msg + ' ' + ((e && e.code) || ''))
      ? missing : 'The report could not be read: ' + msg));
    return null;
  }
}

/* ---------------------------------------------------------------- words --- */
const secs = s => {
  s = Math.round(Number(s) || 0);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' m ' + String(s % 60).padStart(2, '0') + ' s';
  return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' m';
};
const msWords = ms => (ms == null ? '—' : (Number(ms) >= 1000 ? (Number(ms) / 1000).toFixed(1) + ' s' : Math.round(Number(ms)) + ' ms'));
const share = (a, b) => (b ? Math.round((100 * a) / b) : null);
const pctOr = v => (v == null ? '—' : Math.round(Number(v)) + '%');
const pageName = k => PAGE[k] || k;
const DOWNLOAD = {
  'season-stats': 'Season stats table', 'league-leaders': 'League leaders table', 'league-team-stats': 'League team stats table',
  'club-players': "A club's players table", 'player-career': "A player's career table", table: 'Stats table',
  calendar: 'Fixtures calendar', chart: 'Chart', 'compare-graphic': 'Player comparison graphic', 'stat-graphic': 'Stat graphic',
  'weekly-card': 'Weekly card', 'creator-graphics': 'Creator graphics', 'video-clips': 'Video clip list', 'video-edit': 'Edited video',
  'member-file': 'Member file', 'scouting-imports': 'Scouting imports', file: 'Other file'
};
const REPORT_ON = { t: 'Club report', p: 'Player report', scouting: 'Scouting report', game: 'Game report', l: 'League report' };
const downloadName = (what, page) => (what === 'report' ? (REPORT_ON[page] || 'Report') : (DOWNLOAD[what] || what));
const PROVIDER = { youtube: 'YouTube', 'youtube-live': 'YouTube live', vimeo: 'Vimeo', twitch: 'Twitch', 'twitch-live': 'Twitch live',
                   facebook: 'Facebook', tiktok: 'TikTok', instagram: 'Instagram', file: 'Site clip' };
const COPY = { link: 'Copied a link', 'embed-code': 'Copied widget code', text: 'Copied text', native: 'Used the share sheet' };

function tiles(list) {
  const t = el('div', 'tiles');
  list.forEach(([n, k, sub]) => {
    const d = el('div', 'tile');
    d.append(el('div', 'n', n), el('div', 'k', k));
    if (sub) d.appendChild(el('div', 'sub', sub));
    t.appendChild(d);
  });
  return t;
}
function grid(...cards) { const g = el('div', 'an-grid'); cards.forEach(c => g.appendChild(c)); return g; }
function lead(text) { return el('p', 'lead', text); }

/* ------------------------------------------------------------- insights --- */
/* Plain findings, worked out from the figures, each with the numbers behind it. A page needs enough visits before
   anything is said about it, so a quiet week cannot produce a recommendation. */
const MIN_VIEWS = 30, MIN_TIMED = 20;
function insightsOf(a) {
  const out = [];
  const pages = (a.pages || []).filter(p => +p.views >= MIN_VIEWS);
  let rule = '';
  const add = (level, impact, title, text) => out.push({ level, impact, title, text, rule });

  rule = 'error';
  (a.errors || []).filter(e => +e.visits >= 3).slice(0, 3).forEach(e => add('fix', 1e6 + +e.visits,
    'A script error on ' + pageName(e.page),
    e.what + ' failed in ' + fmt(e.visits) + ' visits (' + fmt(e.n) + ' times). Whatever that code draws may be missing for those readers.'));

  rule = 'slow';
  pages.filter(p => +p.speed_n >= 10 && +p.p75_ms > 4000).forEach(p => add('fix', 5e5 + +p.views,
    pageName(p.page) + ' is slow to appear',
    'A quarter of loads wait ' + msWords(p.p75_ms) + ' or more for the main content (median ' + msWords(p.median_ms) + '). ' +
    'Pages over about 2.5 s lose readers; look at what it fetches before it draws.'));

  rule = 'bounce';
  pages.filter(p => +p.landings >= MIN_VIEWS && share(+p.bounces, +p.landings) >= 60).forEach(p => add('improve', 4e5 + +p.landings,
    'Visitors who arrive on ' + pageName(p.page) + ' leave without going further',
    share(+p.bounces, +p.landings) + '% of the ' + fmt(p.landings) + ' visits that started here opened no second page. ' +
    'Clear routes onward (the league table, the club, related games) keep them on the site.'));

  rule = 'quick';
  pages.filter(p => +p.timed >= MIN_TIMED && +p.quick >= 40).forEach(p => add('improve', 3e5 + +p.views,
    'Many readers give ' + pageName(p.page) + ' under ten seconds',
    Math.round(+p.quick) + '% of visits to it were in use for less than 10 s (median ' + secs(p.median_secs) + '). ' +
    'Check that the top of the page shows what people came for, and that it is not waiting on data.'));

  rule = 'unseen';
  pages.filter(p => +p.timed >= MIN_TIMED && p.read_most != null && +p.read_most < 20 && +p.avg_depth < 50).forEach(p => add('improve', 2e5 + +p.views,
    'Most of ' + pageName(p.page) + ' goes unseen',
    'Only ' + Math.round(+p.read_most) + '% of readers scroll to its last quarter (on average they reach ' + Math.round(+p.avg_depth) + '%). ' +
    'Move what matters higher, or shorten it.'));

  rule = 'phones';
  const sd = {};
  (a.speed_devices || []).forEach(d => { sd[d.device] = d; });
  if (sd.phone && sd.desktop && +sd.phone.n >= 30 && +sd.desktop.n >= 30 && +sd.phone.p75_ms > 1.8 * +sd.desktop.p75_ms)
    add('improve', 1.5e5, 'Phones wait far longer than computers',
      'Three quarters of loads on phones are drawn within ' + msWords(sd.phone.p75_ms) + ', against ' + msWords(sd.desktop.p75_ms) + ' on computers. ' +
      'Lighter images and fewer requests on first load would help most people.');

  rule = 'video';
  const f = a.video_funnel || {};
  if (+f.opened >= MIN_VIEWS && share(+f.played, +f.opened) < 40)
    add('improve', 1.2e5, 'Video players are opened but not started',
      'Only ' + share(+f.played, +f.opened) + '% of ' + fmt(f.opened) + ' players put on a page were played.');
  if (+f.played >= MIN_VIEWS && share(+f.q50, +f.played) < 30)
    add('improve', 1.1e5, 'Most viewers stop before halfway',
      share(+f.q50, +f.played) + '% of plays reach the middle and ' + share(+f.done, +f.played) + '% the end. ' +
      'Shorter highlights, or chapters in the long ones, may hold them.');

  rule = 'engaging';
  const engaging = pages.filter(p => +p.timed >= MIN_TIMED).sort((x, y) => +y.median_secs - +x.median_secs).slice(0, 2);
  engaging.forEach(p => add('works', 1e4 + +p.views, 'Readers stay on ' + pageName(p.page),
    'Median ' + secs(p.median_secs) + ' in use, a quarter of visits ' + secs(p.p75_secs) + ' or more. ' +
    'Worth leading people to it from HOME and the rail.'));

  rule = 'download';
  const dl = (a.downloads || [])[0];
  if (dl && +dl.n >= 10) add('works', 5e3, 'Most downloaded: ' + downloadName(dl.what, dl.page),
    fmt(dl.n) + ' downloads (' + String(dl.fmt || '').toUpperCase() + ') from ' + pageName(dl.page) + (dl.about ? ', about ' + dl.about : '') + '.');
  rule = 'top-video';
  const vd = (a.videos || [])[0];
  if (vd && +vd.plays >= 10) add('works', 4e3, 'Most watched video: ' + (vd.title || vd.what),
    fmt(vd.plays) + ' plays, ' + fmt(vd.minutes) + ' minutes watched' + (vd.league ? ', ' + vd.league : '') + '.');

  /* the biggest first within each kind of finding, at most two of a kind, and room kept for what is working */
  const rank = { fix: 0, improve: 1, works: 2 }, room = { fix: 4, improve: 6, works: 3 }, perRule = {}, used = {};
  return out.sort((x, y) => rank[x.level] - rank[y.level] || y.impact - x.impact).filter(x => {
    perRule[x.rule] = (perRule[x.rule] || 0) + 1;
    if (perRule[x.rule] > 2) return false;
    used[x.level] = (used[x.level] || 0) + 1;
    return used[x.level] <= room[x.level];
  });
}
const LEVEL = { fix: 'Fix', improve: 'Improve', works: 'Working' };
function renderInsights(host, a) {
  const t = a.totals || {};
  host.appendChild(tiles([
    [secs(t.median_page_secs), 'median time on a page', 'in use: visible and touched in the last 30 s'],
    [secs(t.median_visit_secs), 'median time a visit', fmt(t.engaged_hours) + ' hours in all'],
    [pctOr(t.bounce_rate), 'bounce rate', 'visits that opened one page only'],
    [fmt(t.video_plays), 'video plays', fmt(t.video_hours) + ' hours watched'],
    [fmt(t.downloads), 'downloads'],
    [msWords(t.median_speed_ms), 'median load', 'until the main content is drawn']
  ]));
  const list = insightsOf(a);
  const box = el('section', 'an-card');
  box.appendChild(el('h3', null, 'What the figures suggest'));
  if (!list.length) {
    box.appendChild(el('div', 'an-empty', 'Nothing stands out yet: a page needs ' + MIN_VIEWS + ' views in the range before anything is said about it. Try a longer range.'));
  } else {
    const ul = el('ol', 'an-ins');
    list.forEach(x => {
      const li = el('li', 'an-in ' + x.level);
      const tag = el('span', 'an-tag', LEVEL[x.level]);
      const h = el('div', 'an-in-h'); h.append(tag, document.createTextNode(x.title));
      li.append(h, el('div', 'an-in-t', x.text));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
  host.appendChild(box);
  host.appendChild(lead('Worked out from this range only. "Fix" is something broken or slow; "Improve" a page that loses people; ' +
    '"Working" what to lean on. Each one names its numbers, and the other views have the detail.'));
}

/* --------------------------------------------------------- time on page --- */
function renderTime(host, a) {
  const pages = a.pages || [];
  const t = a.totals || {};
  host.appendChild(tiles([
    [secs(t.median_page_secs), 'median time on a page'],
    [secs(t.median_visit_secs), 'median time a visit'],
    [fmt(t.engaged_hours), 'hours spent on the site'],
    [pctOr(t.bounce_rate), 'bounce rate']
  ]));
  host.appendChild(lead('Time is time IN USE: the page in front of the reader and touched, scrolled or typed in within the last 30 seconds ' +
    '(or a video playing on it), so a tab left open in the background does not count. Median is the middle visit; "75% under" is the time ' +
    'three quarters of visits stay below. Bounce: of the visits that started on a page, the share that opened nothing else. Exit rate: of a ' +
    'page\'s views, the share that were the last of their visit.'));
  host.appendChild(card('Every page, by traffic', plain(pages, [
    ['Page', x => pageName(x.page)],
    ['Views', x => fmt(x.views), 'num'],
    ['Median time', x => (x.timed ? secs(x.median_secs) : '—'), 'num'],
    ['75% under', x => (x.timed ? secs(x.p75_secs) : '—'), 'num'],
    ['Under 10 s', x => pctOr(x.quick), 'num'],
    ['Read 75%+', x => pctOr(x.read_most), 'num'],
    ['Bounce', x => (+x.landings ? share(+x.bounces, +x.landings) + '%' : '—'), 'num'],
    ['Exit rate', x => (+x.views ? share(+x.exits, +x.views) + '%' : '—'), 'num'],
    ['Load', x => msWords(x.median_ms), 'num']
  ], 'No page views in this range yet.')));
  const timed = pages.filter(p => +p.timed >= 5);
  host.appendChild(grid(
    card('Where people stay longest (median time)', ranked(timed.slice().sort((x, y) => +y.median_secs - +x.median_secs), [
      ['Page', x => pageName(x.page)], ['Median', x => secs(x.median_secs), 'num'], ['Visits timed', x => fmt(x.timed), 'num']
    ], x => +x.median_secs)),
    card('Where people leave fastest (under 10 s)', ranked(timed.slice().sort((x, y) => +y.quick - +x.quick), [
      ['Page', x => pageName(x.page)], ['Under 10 s', x => pctOr(x.quick), 'num'], ['Visits timed', x => fmt(x.timed), 'num']
    ], x => +x.quick))));
  host.appendChild(grid(
    card('How far down pages are read', ranked(timed.filter(p => p.avg_depth != null).sort((x, y) => +x.avg_depth - +y.avg_depth), [
      ['Page', x => pageName(x.page)], ['Reached on average', x => pctOr(x.avg_depth), 'num'], ['Read 75%+', x => pctOr(x.read_most), 'num']
    ], x => +x.avg_depth, 'Least read first. A page shorter than the screen counts as read to the end.')),
    card('Time spent, league by league', ranked(a.leagues, [
      ['League', x => x.name || x.slug], ['Time', x => secs(x.secs), 'num'], ['Visits', x => fmt(x.visits), 'num'],
      ['Median a page', x => secs(x.median_secs), 'num']
    ], x => +x.secs, 'Every page about the league: its own, its clubs\', its players\' and its games\'.'))));
}

/* ----------------------------------------------------------------- video --- */
function renderVideo(host, a) {
  const f = a.video_funnel || {};
  const mins = (a.videos || []).reduce((s, v) => s + (+v.minutes || 0), 0);
  host.appendChild(tiles([
    [fmt(f.played), 'plays', fmt(f.opened) + ' players opened'],
    [pctOr(share(+f.played, +f.opened)), 'play rate', 'opened and then played'],
    [fmt((a.totals || {}).video_hours), 'hours watched', fmt(mins) + ' minutes on the top 50'],
    [pctOr(share(+f.q50, +f.played)), 'reach halfway', 'of plays'],
    [pctOr(share(+f.done, +f.played)), 'reach the end', 'of plays']
  ]));
  const steps = [['Opened', f.opened], ['Played', f.played], ['A quarter in', f.q25], ['Halfway', f.q50], ['Three quarters', f.q75], ['To the end', f.done]];
  host.appendChild(grid(
    card('How far viewers get', ranked(steps.map(([k, n]) => ({ k, n: +n || 0 })), [
      ['Stage', x => x.k], ['Videos', x => fmt(x.n), 'num'], ['Of plays', x => (x.k === 'Opened' ? '' : pctOr(share(x.n, +f.played))), 'num']
    ], x => x.n, 'One visit and one video counted once at each stage. Live streams have no end, so they stop at "Played".')),
    card('Plays a day', columns((a.video_daily || []).map(d => ({
      label: shortDay(d.day), value: +d.plays || 0, tip: shortDay(d.day) + ' — ' + fmt(d.plays) + ' plays, ' + fmt(d.minutes) + ' minutes watched'
    })), 'No plays in this range yet.'))));
  host.appendChild(card('Videos, most played first', plain(a.videos, [
    ['Video', x => x.title || x.what],
    ['Where', x => PROVIDER[x.provider] || x.provider],
    ['League', x => x.league || ''],
    ['Watched on', x => pageName(x.page)],
    ['Plays', x => fmt(x.plays), 'num'],
    ['Halfway', x => pctOr(share(+x.half, +x.plays)), 'num'],
    ['Finished', x => pctOr(share(+x.done, +x.plays)), 'num'],
    ['Minutes', x => fmt(x.minutes), 'num']
  ], 'No videos played in this range yet.')));
  host.appendChild(card('Where videos are watched', ranked(a.video_pages, [
    ['Page', x => pageName(x.page)], ['Opened', x => fmt(x.opens), 'num'], ['Played', x => fmt(x.plays), 'num'], ['Minutes', x => fmt(x.minutes), 'num']
  ], x => +x.plays)));
  host.appendChild(lead('Players from YouTube and Vimeo say when they play and how far they get. Twitch, Facebook, TikTok and Instagram players ' +
    'only say that they were opened, so they count under "Opened" alone. A video is named by its public id; the title comes from the news ' +
    'item or the game it belongs to.'));
}

/* ------------------------------------------------------------- downloads --- */
function renderDownloads(host, a) {
  const kinds = a.download_kinds || [];
  const total = +(a.totals || {}).downloads || 0;
  const fmts = {};
  kinds.forEach(k => { fmts[k.fmt] = (fmts[k.fmt] || 0) + (+k.n || 0); });
  const topFmt = Object.keys(fmts).sort((x, y) => fmts[y] - fmts[x])[0];
  host.appendChild(tiles([
    [fmt(total), 'downloads'],
    [fmt(kinds.length), 'kinds of file'],
    [topFmt ? String(topFmt).toUpperCase() : '—', 'most common format', topFmt ? pctOr(share(fmts[topFmt], total)) + ' of downloads' : '']
  ]));
  host.appendChild(card('What is downloaded, from where, and about whom', plain(a.downloads, [
    ['What', x => downloadName(x.what, x.page)],
    ['Format', x => String(x.fmt || '').toUpperCase()],
    ['From page', x => pageName(x.page)],
    ['About', x => (x.about ? x.about + (x.about_kind ? ' (' + x.about_kind + ')' : '') : '')],
    ['Downloads', x => fmt(x.n), 'num'],
    ['Visits', x => fmt(x.visits), 'num']
  ], 'No downloads in this range yet.')));
  host.appendChild(grid(
    card('By kind', ranked(kinds, [
      ['What', x => (x.what === 'report' ? 'Report (club, player, game or scouting)' : downloadName(x.what))],
      ['Format', x => String(x.fmt || '').toUpperCase()], ['Downloads', x => fmt(x.n), 'num']
    ], x => +x.n)),
    card('By format', ranked(Object.keys(fmts).map(k => ({ k, n: fmts[k] })).sort((x, y) => y.n - x.n), [
      ['Format', x => String(x.k).toUpperCase()], ['Downloads', x => fmt(x.n), 'num'], ['Share', x => pctOr(share(x.n, total)), 'num']
    ], x => x.n))));
  host.appendChild(lead('A download is counted as the kind of thing it is (a club report, a season stats table, the fixtures calendar), ' +
    'the page it was saved from and the league, club, player or game that page is about. File names are never sent.'));
}

/* ------------------------------------------------------- links & sharing --- */
function renderLinks(host, a) {
  const t = a.totals || {};
  host.appendChild(tiles([
    [fmt(t.outbound), 'links followed to other sites'],
    [fmt(t.shares), 'shares and copies'],
    [fmt(t.embeds), 'widgets shown on other sites']
  ]));
  host.appendChild(grid(
    card('Other sites people go to', ranked(a.outbound, [
      ['Site', x => x.host], ['Clicks', x => fmt(x.n), 'num'], ['Visits', x => fmt(x.visits), 'num'], ['Mostly from', x => pageName(x.page)]
    ], x => +x.n, 'The site\'s name only, never the page on it.')),
    card('Sharing and copying', ranked(a.shares, [
      ['What', x => COPY[x.what] || (x.kind === 'copy' ? 'Copied: ' + x.what : 'Shared: ' + x.what)], ['Page', x => pageName(x.page)],
      ['Times', x => fmt(x.n), 'num']
    ], x => +x.n, 'That it happened and the kind of thing, never what was copied.'))));
  host.appendChild(card('The site\'s widgets on other sites', ranked(a.embeds, [
    ['Widget', x => pageName(x.widget)], ['Shown on', x => x.host || '(opened directly)'], ['Times shown', x => fmt(x.n), 'num']
  ], x => +x.n, 'Each time a widget is drawn on a club\'s or league\'s own site. These are not visits to EPINOIA.')));
}

/* ------------------------------------------------------- speed & errors --- */
function renderHealth(host, a) {
  const t = a.totals || {};
  const slow = (a.pages || []).filter(p => +p.speed_n >= 5).sort((x, y) => +y.p75_ms - +x.p75_ms);
  host.appendChild(tiles([
    [msWords(t.median_speed_ms), 'median load', 'until the main content is drawn'],
    [fmt(t.errors), 'script errors', 'in the site\'s own code']
  ]));
  host.appendChild(grid(
    card('Slowest pages (75% of loads within)', ranked(slow, [
      ['Page', x => pageName(x.page)], ['75% within', x => msWords(x.p75_ms), 'num'], ['Median', x => msWords(x.median_ms), 'num'],
      ['Loads', x => fmt(x.speed_n), 'num']
    ], x => +x.p75_ms, 'Under 2.5 s is good, over 4 s is poor.')),
    card('By device', plain(a.speed_devices, [
      ['Device', x => DEVICE[x.device] || x.device], ['Loads', x => fmt(x.n), 'num'], ['Median', x => msWords(x.median_ms), 'num'],
      ['75% within', x => msWords(x.p75_ms), 'num']
    ], 'No loads measured in this range yet.'))));
  host.appendChild(card('Script errors', plain(a.errors, [
    ['Where in the code', x => x.what], ['Page', x => pageName(x.page)], ['Times', x => fmt(x.n), 'num'], ['Visits', x => fmt(x.visits), 'num'],
    ['Last seen', x => (x.last_at ? new Date(x.last_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')]
  ], 'No script errors in this range.')));
  host.appendChild(lead('An error is recorded as the file and line of the site\'s own code that failed, at most five a page, never its message. ' +
    'Load time is the browser\'s own measure of when the largest piece of the page was drawn.'));
}

/* ------------------------------------------------- where visitors came from --- */
const ENGINE = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', baidu: 'Baidu', yandex: 'Yandex',
                 ecosia: 'Ecosia', brave: 'Brave', qwant: 'Qwant', other: 'Another search engine' };
async function drawSources(box) {
  let s = null;
  try {
    const res = await st.sb.rpc('analytics_sources_report', { p_days: st.days });
    if (res.error) throw res.error;
    s = res.data;
  } catch (e) {
    const msg = String((e && e.message) || e);
    box.appendChild(el('div', 'an-off', /analytics_sources_report|schema cache|does not exist/i.test(msg)
      ? 'Where-from analytics are not in the database yet: migration 0234 has not been applied.'
      : 'The where-from report could not be read: ' + msg));
    return;
  }
  renderSources(box, s || {});
}

function renderSources(host, s) {
  const t = s.totals || {};
  const n = +t.landings || 0;
  host.appendChild(el('h2', 'an-h2', 'Where visitors came from'));
  const tiles = el('div', 'tiles');
  const tile = (v, k, sub, dim) => {
    const d = el('div', 'tile');
    d.append(el('div', 'n' + (dim ? ' dim' : ''), v), el('div', 'k', k));
    if (sub) d.appendChild(el('div', 'sub', sub));
    tiles.appendChild(d);
  };
  tile(fmt(n), 'visits', 'counted at the first page');
  tile(pct(+t.search || 0, n), 'from a search engine', fmt(t.search) + ' (' + fmt(t.google) + ' Google)');
  tile(pct(+t.site || 0, n), 'from another site', fmt(t.site));
  tile(pct(+t.campaign || 0, n), 'from a tagged link', fmt(t.campaign));
  tile(pct(+t.direct || 0, n), 'typed or bookmarked', fmt(t.direct), true);
  host.appendChild(tiles);
  host.appendChild(el('p', 'lead',
    'Counted on the first page of each visit. A search engine tells the site which engine sent the visitor and nothing more: Google no longer ' +
    'passes the words searched, so what shows is the page they landed on (the page that matched their search). The words themselves are in ' +
    "Google's own Search Console."));

  const g1 = el('div', 'an-grid');
  g1.appendChild(card('Visits a day', columns((s.daily || []).map(d => ({
    label: shortDay(d.day), value: +d.landings || 0,
    tip: shortDay(d.day) + ' — ' + fmt(d.landings) + ' visits, ' + fmt(d.search) + ' from search (' + fmt(d.google) + ' Google)'
  })), 'No visits in this range yet.')));
  g1.appendChild(card('Search engines', ranked(s.engines, [
    ['Engine', x => ENGINE[x.engine] || x.engine], ['Visits', x => fmt(x.landings), 'num'],
    ['Share', x => pct(+x.landings || 0, +t.search || 0), 'num']], x => +x.landings)));
  host.appendChild(g1);

  const g2 = el('div', 'an-grid');
  g2.appendChild(card('Pages people arrive on from a search', ranked(s.pages, [
    ['Page', x => (x.name ? x.name + ' ' : '') + '(' + (x.kind ? KIND[x.kind] || x.kind : '/' + (x.page || '')) + ')'],
    ['Engine', x => ENGINE[x.engine] || x.engine], ['Visits', x => fmt(x.landings), 'num']], x => +x.landings,
    'The page the search engine put in front of them: a player, club or league name here is what they searched for, roughly.')));
  g2.appendChild(card('Tagged links (campaigns)', ranked(s.campaigns, [
    ['Source', x => x.source || '—'], ['Medium', x => x.medium || '—'], ['Campaign', x => x.campaign || '—'],
    ['Visits', x => fmt(x.landings), 'num']], x => +x.landings,
    'Links of ours ending ?utm_source=…&utm_medium=…&utm_campaign=…; a Google advert click shows as google / cpc.')));
  host.appendChild(g2);

  const g3 = el('div', 'an-grid');
  g3.appendChild(card('Other sites that sent visitors', ranked(s.referrers, [
    ['Site', x => x.host], ['Visits', x => fmt(x.landings), 'num']], x => +x.landings)));
  host.appendChild(g3);
}

/* ------------------------------------------------------- what is searched --- */
async function drawSearch(box) {
  let s = null;
  try {
    const res = await st.sb.rpc('analytics_search_report', { p_days: st.days });
    if (res.error) throw res.error;
    s = res.data;
  } catch (e) {
    const msg = String((e && e.message) || e);
    box.appendChild(el('div', 'an-off', /analytics_search_report|schema cache|does not exist/i.test(msg)
      ? 'Search analytics are not in the database yet: migration 0180 has not been applied.'
      : 'The search report could not be read: ' + msg));
    return;
  }
  renderSearch(box, s || {});
}

const KIND = { league: 'League', team: 'Club', player: 'Player' };

function renderSearch(host, s) {
  const t = s.totals || {};
  const n = +t.searches || 0;
  host.appendChild(el('h2', 'an-h2', 'What people search for'));
  const tiles = el('div', 'tiles');
  const tile = (v, k, sub, dim) => {
    const d = el('div', 'tile');
    d.append(el('div', 'n' + (dim ? ' dim' : ''), v), el('div', 'k', k));
    if (sub) d.appendChild(el('div', 'sub', sub));
    tiles.appendChild(d);
  };
  tile(fmt(n), 'searches', fmt(t.queries) + ' different ones');
  tile(pct(+t.picked || 0, n), 'picked a result', fmt(t.picked) + ' of ' + fmt(n));
  tile(pct(+t.no_results || 0, n), 'found nothing', fmt(t.no_results) + ' of ' + fmt(n), true);
  host.appendChild(tiles);
  host.appendChild(el('p', 'lead',
    'Only the words typed (lower case, accents and punctuation off), how many results the box showed, and what was picked. ' +
    'No account, no visit token: a search is tied to no visit and to no other search. Anything that looks like an ' +
    'address, a phone number or a web address is never kept.'));

  const g1 = el('div', 'an-grid');
  g1.appendChild(card('Searches a day', columns((s.daily || []).map(d => ({
    label: shortDay(d.day), value: +d.searches || 0,
    tip: shortDay(d.day) + ' — ' + fmt(d.searches) + ' searches, ' + fmt(d.picked) + ' picked, ' + fmt(d.no_results) + ' found nothing'
  })), 'No searches in this range yet.')));
  g1.appendChild(card('What gets picked', ranked(s.picked_kinds, [
    ['Kind', x => KIND[x.kind] || x.kind], ['Picks', x => fmt(x.n), 'num'],
    ['Share', x => pct(+x.n || 0, +t.picked || 0), 'num']], x => +x.n)));
  host.appendChild(g1);

  const g2 = el('div', 'an-grid');
  g2.appendChild(card('Most common searches', ranked(s.top, [
    ['Search', x => x.q],
    ['Times', x => fmt(x.searches), 'num'],
    ['Results', x => (x.results == null ? '' : String(x.results)), 'num'],
    ['Picked', x => pct(+x.picked || 0, +x.searches || 0), 'num']
  ], x => +x.searches, 'Results is the average number the box showed; Picked is how often one was chosen.')));
  g2.appendChild(card('Searches that found nothing', ranked(s.nothing, [
    ['Search', x => x.q], ['Times', x => fmt(x.searches), 'num']], x => +x.searches,
    'A name the site does not have yet, or one spelled a way the search cannot reach: worth reading down.')));
  host.appendChild(g2);

  const g3 = el('div', 'an-grid');
  g3.appendChild(card('Most picked results', ranked(s.picked, [
    ['Result', x => x.name || x.ref || ''], ['Kind', x => KIND[x.kind] || x.kind],
    ['Picks', x => fmt(x.n), 'num']], x => +x.n)));
  const dev = el('div');
  dev.appendChild(ranked(s.devices, [['Device', x => DEVICE[x.k] || x.k], ['Searches', x => fmt(x.n), 'num']], x => +x.n));
  dev.appendChild(ranked(s.langs, [['Language shown', x => LANG[x.k] || x.k], ['Searches', x => fmt(x.n), 'num']], x => +x.n));
  g3.appendChild(card('Who searches, roughly', dev));
  host.appendChild(g3);
}

function render(host, r) {
  const t = r.totals || {}, live = r.live || {}, go = r.go || {};
  const views = +t.views || 0, sessions = +t.sessions || 0;

  /* ---- the headline figures ---- */
  const tiles = el('div', 'tiles');
  const tile = (n, k, sub, dim) => {
    const d = el('div', 'tile');
    d.append(el('div', 'n' + (dim ? ' dim' : ''), n), el('div', 'k', k));
    if (sub) d.appendChild(el('div', 'sub', sub));
    tiles.appendChild(d);
  };
  tile(fmt(live.sessions), 'on the site now', fmt(live.views) + ' pages in the last 5 minutes');
  tile(fmt(sessions), 'visits', 'one visit = one browser tab');
  tile(fmt(views), 'page views', sessions ? (views / sessions).toFixed(1) + ' pages a visit' : '');
  tile(pct(+t.signed_in_sessions || 0, sessions), 'signed in', fmt(t.signed_in_sessions) + ' of ' + fmt(sessions) + ' visits');
  tile(fmt(go.sessions), 'EPINOIA GO visits', pct(+go.sessions || 0, sessions) + ' of all visits');
  tile(fmt(t.tab_clicks), 'tab clicks', '', true);
  host.appendChild(tiles);

  host.appendChild(el('p', 'lead',
    'Anonymous by construction: no account, email, IP address, cookie or lasting identifier is ever recorded, ' +
    'so a visit is one browser tab and the same person on two days counts twice. Visitors whose browser sends ' +
    'Global Privacy Control or Do Not Track, or who switched counting off on the privacy page, are not counted.'));

  /* ---- over time ---- */
  const grid1 = el('div', 'an-grid');
  grid1.appendChild(card('Visits a day', columns((r.daily || []).map(d => ({
    label: shortDay(d.day), value: +d.sessions || 0,
    tip: shortDay(d.day) + ' — ' + fmt(d.sessions) + ' visits, ' + fmt(d.views) + ' views, ' +
         pct(+d.signed_in || 0, +d.sessions || 0) + ' signed in'
  })), 'No visits in this range yet.')));
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), value: 0 }));
  (r.hourly || []).forEach(h => { if (hours[h.hour]) hours[h.hour].value = +h.views || 0; });
  hours.forEach(h => { h.tip = h.label + ':00–' + h.label + ':59 UTC — ' + fmt(h.value) + ' views'; });
  grid1.appendChild(card('Page views by hour of day (UTC)', columns(hours, 'No views in this range yet.')));
  host.appendChild(grid1);

  /* ---- what is read ---- */
  const grid2 = el('div', 'an-grid');
  grid2.appendChild(card('Most read leagues', ranked(r.leagues, [
    ['League', x => x.name || x.slug],
    ['Views', x => fmt(x.views), 'num'],
    ['Visits', x => fmt(x.sessions), 'num'],
    ['Signed in', x => pct(+x.signed_in || 0, +x.sessions || 0), 'num']
  ], x => +x.views, 'A league counts every view of its own pages, its clubs and its games.')));
  grid2.appendChild(card('Most read clubs', ranked(r.teams, [
    ['Club', x => x.name || x.slug],
    ['League', x => x.league || ''],
    ['Views', x => fmt(x.views), 'num'],
    ['Visits', x => fmt(x.sessions), 'num']
  ], x => +x.views)));
  host.appendChild(grid2);

  const grid3 = el('div', 'an-grid');
  const pageVisits = {};
  (r.pages || []).forEach(p => { pageVisits[p.page] = +p.sessions || 0; });
  grid3.appendChild(card('Pages, across every league', ranked(r.pages, [
    ['Page', x => PAGE[x.page] || x.page],
    ['Views', x => fmt(x.views), 'num'],
    ['Visits', x => fmt(x.sessions), 'num'],
    ['Share', x => pct(+x.sessions || 0, sessions), 'num']
  ], x => +x.views)));
  grid3.appendChild(card('Box-score tabs opened', ranked(r.game_tabs, [
    ['Tab', x => GAME_TAB[x.tab] || x.tab],
    ['Opens', x => fmt(x.clicks), 'num'],
    ['Visits', x => fmt(x.sessions), 'num'],
    ['Share', x => pct(+x.sessions || 0, pageVisits.game || 0), 'num']
  ], x => +x.clicks, 'The box score itself is the page view; these are the tabs chosen after it.')));
  host.appendChild(grid3);

  host.appendChild(card('League pages, league by league (views)', heat(r.league_pages, r.leagues)));

  const grid4 = el('div', 'an-grid');
  grid4.appendChild(card('Most read games', ranked(r.games, [
    ['Game', x => (x.home || '?') + ' v ' + (x.away || '?')],
    ['League', x => x.league || ''],
    ['Views', x => fmt(x.views), 'num'],
    ['Visits', x => fmt(x.sessions), 'num']
  ], x => +x.views)));
  const goCard = el('div');
  const goTiles = el('div', 'tiles');
  [[fmt(go.sessions), 'visits'], [fmt(go.views), 'views'],
   [pct(+go.signed_in_sessions || 0, +go.sessions || 0), 'signed in']].forEach(([n, k]) => {
    const d = el('div', 'tile'); d.append(el('div', 'n', n), el('div', 'k', k)); goTiles.appendChild(d);
  });
  goCard.appendChild(goTiles);
  goCard.appendChild(ranked(go.pages, [
    ['Page', x => PAGE[x.page] || x.page], ['Views', x => fmt(x.views), 'num']], x => +x.views));
  if ((go.tabs || []).length) goCard.appendChild(ranked(go.tabs, [
    ['Tab', x => x.tab], ['Clicks', x => fmt(x.clicks), 'num']], x => +x.clicks));
  grid4.appendChild(card('EPINOIA GO', goCard));
  host.appendChild(grid4);

  /* ---- VIDEO: HOME's VIDEO view, a club page's Video tab, the game chat (track.js action keys) ---- */
  const vActs = {};
  (r.tabs || []).forEach(x => {
    if (!isVideoAct(x.tab)) return;
    const a = vActs[x.tab] || (vActs[x.tab] = { tab: x.tab, clicks: 0, sessions: 0, pages: new Set() });
    a.clicks += +x.clicks || 0; a.sessions += +x.sessions || 0; a.pages.add(PAGE[x.page] || x.page);
  });
  const vRows = Object.values(vActs);
  const vPage = (r.pages || []).find(p => p.page === 'home/video') || {};
  const plays = vRows.filter(a => /^play-/.test(a.tab)).reduce((n, a) => n + a.clicks, 0);
  const vCard = el('div');
  const vTiles = el('div', 'tiles');
  [[fmt(+vPage.sessions || 0), 'visits to VIDEO'], [fmt(+vPage.views || 0), 'views'], [fmt(plays), 'videos played'],
   [fmt((vActs['live-play'] || {}).clicks || 0), 'live streams started']].forEach(([n, k]) => {
    const d = el('div', 'tile'); d.append(el('div', 'n', n), el('div', 'k', k)); vTiles.appendChild(d);
  });
  vCard.appendChild(vTiles);
  vCard.appendChild(ranked(vRows, [
    ['What', x => VIDEO_ACT[x.tab] || x.tab], ['Where', x => [...x.pages].join(', ')],
    ['Times', x => fmt(x.clicks), 'num'], ['Visits', x => fmt(x.sessions), 'num']], x => +x.clicks,
    'HOME’s VIDEO view (home/?view=video), a club page’s Video tab and the game chat. A visit is counted once per action.'));
  host.appendChild(card('VIDEO', vCard));

  /* ---- who, roughly, and from where ---- */
  const grid5 = el('div', 'an-grid');
  grid5.appendChild(card('Devices (visits)', ranked(r.devices, [
    ['Device', x => DEVICE[x.k] || x.k], ['Visits', x => fmt(x.sessions), 'num'],
    ['Share', x => pct(+x.sessions || 0, sessions), 'num']], x => +x.sessions)));
  grid5.appendChild(card('App or browser (visits)', ranked(r.apps, [
    ['Where', x => APP[x.k] || x.k], ['Visits', x => fmt(x.sessions), 'num'],
    ['Share', x => pct(+x.sessions || 0, sessions), 'num']], x => +x.sessions)));
  grid5.appendChild(card('Language shown (visits)', ranked(r.langs, [
    ['Language', x => LANG[x.k] || x.k], ['Visits', x => fmt(x.sessions), 'num'],
    ['Share', x => pct(+x.sessions || 0, sessions), 'num']], x => +x.sessions)));
  grid5.appendChild(card('Arrived from (visits)', ranked(r.referrers, [
    ['Site', x => x.host], ['Visits', x => fmt(x.sessions), 'num']], x => +x.sessions,
    'The other site’s name only. Visits typed in, bookmarked or from an app show no site.')));
  host.appendChild(grid5);

  host.appendChild(card('Other tabs used', ranked(r.tabs, [
    ['Page', x => PAGE[x.page] || x.page], ['Tab', x => tabName(x.page, x.tab)],
    ['Clicks', x => fmt(x.clicks), 'num'], ['Visits', x => fmt(x.sessions), 'num']], x => +x.clicks)));
}

/* ------------------------------------------------------------- live now --- */
const ago = s => (s == null ? '' : s < 90 ? Math.max(0, s) + ' s' : Math.round(s / 60) + ' min');

/* what a visitor's tab is on, in words. Names come from the database and are only ever set as text. */
function doing(v) {
  const page = PAGE[v.page] || v.page;
  let what = page;
  if (v.page === 'game' && (v.home || v.away)) what = page + ': ' + (v.home || '?') + ' v ' + (v.away || '?');
  else if (v.club) what = page + ': ' + v.club;
  else if (v.league && v.page === 'l') what = page + ': ' + v.league;
  if (v.tab) what += ' - ' + tabName(v.page, v.tab);
  const who = [DEVICE[v.device] || v.device, APP[v.app] || v.app, LANG[v.lang] || v.lang, v.signed_in ? 'signed in' : null]
    .filter(Boolean).join(' · ');
  return { what, who };
}

/* a plain table (no bar), with the same cap and scroll as every other */
function plain(rows, cols, empty) {
  const wrap = el('div');
  if (!rows || !rows.length) { wrap.appendChild(el('div', 'an-empty', empty || 'Nothing right now.')); return wrap; }
  const sc = el('div', 'scroll');
  const tbl = el('table', 'tbl');
  const hr = el('tr');
  cols.forEach(([h, , cls]) => hr.appendChild(el('th', cls ? 'r' : null, h)));
  tbl.appendChild(el('thead')).appendChild(hr);
  const tb = el('tbody');
  rows.forEach(x => {
    const tr = el('tr');
    cols.forEach(([, f, cls], i) => tr.appendChild(el('td', cls || (i === 0 ? 'nm' : null), f(x))));
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  sc.appendChild(tbl);
  wrap.appendChild(sc);
  if (rows.length > ROWS_SHOWN) wrap.appendChild(el('p', 'an-more', rows.length + ' rows - scroll the table for the rest'));
  return wrap;
}

function liveCard() {
  if (st.liveEl) return st.liveEl;
  const c = el('section', 'an-live');
  const head = el('div', 'an-live-head');
  const dot = el('span', 'an-dot');
  const h = el('h3'); h.append(dot, document.createTextNode('Live now'));
  const btn = el('button', 'ep-btn mini', 'start live view'); btn.type = 'button';
  const more = el('button', 'ep-btn mini', 'extend to 1 hr'); more.type = 'button'; more.hidden = true;
  const status = el('span', 'an-note');
  head.append(h, btn, more, status);
  const body = el('div');
  c.append(head, body);
  st.liveEl = c; st.liveBtn = btn; st.liveMore = more; st.liveStatus = status; st.liveBody = body;
  btn.addEventListener('click', () => (st.live.on ? liveStop('Stopped.') : liveStart()));
  /* AN HOUR, FROM NOW, ON REQUEST. Still one call every ten seconds and only while this tab is showing; the only change is
     when it stops by itself. */
  more.addEventListener('click', () => {
    const L = st.live;
    if (!L || !L.on) return;
    L.at = Date.now(); L.max = LIVE_LONG_MS;
    paintLive(L.last);
  });
  paintLive(null);
  return c;
}

/* NOTHING RUNS UNTIL THIS IS PRESSED. */
function liveStart() {
  st.live = { on: true, at: Date.now(), max: LIVE_MAX_MS, busy: false, last: null };
  st.liveTimer = setInterval(liveTick, LIVE_EVERY_MS);
  paintLive(null);
  liveTick();
}

function liveStop(why) {
  if (st.liveTimer) clearInterval(st.liveTimer);
  st.liveTimer = null;
  st.live = { on: false, why: why || '', last: st.live && st.live.last };
  paintLive(st.live.last);
}

async function liveTick() {
  const L = st.live;
  if (!L.on || L.busy) return;
  if (!st.liveEl.isConnected || !st.host.getClientRects().length) return liveStop('Stopped: you left the Analytics tab.');
  if (Date.now() - L.at > L.max) return liveStop('Stopped after ' + Math.round(L.max / 60000) + ' minutes. Start it again to keep watching.');
  if (document.hidden) { st.liveStatus.textContent = 'paused while this window is hidden'; return; }
  L.busy = true;
  try {
    const res = await st.sb.rpc('analytics_live', { p_window_s: 300 });
    if (res.error) throw res.error;
    L.last = res.data || {};
    L.updated = new Date();
    if (st.live === L && L.on) paintLive(L.last);
  } catch (e) {
    const msg = String((e && e.message) || e);
    liveStop(/analytics_live|schema cache|does not exist/i.test(msg)
      ? 'Live view needs migration 0176, which has not been applied yet.' : 'The live view could not be read: ' + msg);
  } finally { L.busy = false; }
}

function paintLive(r) {
  const c = st.liveEl, L = st.live || {}, body = st.liveBody;
  c.classList.toggle('running', !!L.on);
  st.liveBtn.textContent = L.on ? 'stop' : 'start live view';
  st.liveBtn.classList.toggle('on', !!L.on);
  st.liveMore.hidden = !(L.on && L.max < LIVE_LONG_MS);      // once it has been extended there is nothing more to offer
  body.textContent = '';
  if (L.on) {
    const left = Math.max(0, Math.round((L.max - (Date.now() - L.at)) / 60000));
    st.liveStatus.textContent = L.updated ? 'updated ' + L.updated.toLocaleTimeString('en-GB') + ' · every 10 s · stops in ' + left + ' min' : 'reading…';
  } else {
    st.liveStatus.textContent = L.why || '';
    if (!r) {
      body.appendChild(el('p', 'an-live-off',
        'Off. Live view shows what visitors are doing on the site right now, with nothing that identifies anyone. ' +
        'It reads the last five minutes every ten seconds while it is on, and only then: it stops by itself after ten ' +
        'minutes (an hour if you extend it), when you leave this tab, and it pauses while this window is hidden.'));
      return;
    }
  }
  if (r) renderLive(body, r, !L.on);
}

function renderLive(host, r, stale) {
  const tiles = el('div', 'tiles');
  const tile = (n, k, sub, dim) => {
    const d = el('div', 'tile'); d.append(el('div', 'n' + (dim ? ' dim' : ''), n), el('div', 'k', k));
    if (sub) d.appendChild(el('div', 'sub', sub));
    tiles.appendChild(d);
  };
  const dev = (r.devices || []).map(x => fmt(x.sessions) + ' ' + (DEVICE[x.k] || x.k).toLowerCase()).join(', ');
  const open = (r.games || []).length;
  tile(fmt(r.sessions), 'on the site now', 'active in the last ' + Math.round((r.window_s || 300) / 60) + ' minutes');
  tile(fmt(r.last_30m), 'in the last 30 minutes', 'one per browser tab', true);
  tile(fmt(r.signed_in), 'signed in', dev);
  tile(fmt((r.games || []).reduce((a, g) => a + (+g.sessions || 0), 0)), 'reading a game', open + ' game' + (open === 1 ? '' : 's') + ' open');
  host.appendChild(tiles);
  if (stale) host.appendChild(el('p', 'an-more', 'Last reading - live view is off.'));

  const pm = (r.per_minute || []).map(m => ({
    label: m.ago_min ? '-' + m.ago_min + 'm' : 'now', value: +m.views || 0,
    tip: (m.ago_min ? m.ago_min + ' min ago' : 'this minute') + ' — ' + fmt(m.views) + ' views, ' + fmt(m.sessions) + ' tabs'
  }));
  const g0 = el('div', 'an-grid');
  g0.appendChild(card('Views a minute, last 30 minutes', columns(pm, 'No activity in the last half hour.')));
  g0.appendChild(card('What each visitor is doing', plain(r.visitors, [
    ['Doing', x => doing(x).what],
    ['On it', x => ago(x.on_page_s), 'num'],
    ['Idle', x => ago(x.idle_s), 'num'],
    ['Who', x => doing(x).who]], 'Nobody has done anything in the last five minutes.')));
  host.appendChild(g0);

  const g1 = el('div', 'an-grid');
  g1.appendChild(card('Games being watched', plain(r.games, [
    ['Game', x => (x.home || '?') + ' v ' + (x.away || '?')],
    ['League', x => x.league || ''],
    ['State', x => x.status || ''],
    ['Watching', x => fmt(x.sessions), 'num']], 'No game is open right now.')));
  g1.appendChild(card('Pages open now', plain(r.where, [
    ['Page', x => PAGE[x.page] || x.page], ['Tabs', x => fmt(x.sessions), 'num']])));
  host.appendChild(g1);

  const g2 = el('div', 'an-grid');
  g2.appendChild(card('Leagues being read', plain(r.leagues, [
    ['League', x => x.name], ['Tabs', x => fmt(x.sessions), 'num']])));
  g2.appendChild(card('Box-score tabs open now', plain(r.tabs, [
    ['Tab', x => GAME_TAB[x.tab] || x.tab], ['Tabs', x => fmt(x.sessions), 'num']], 'None.')));
  host.appendChild(g2);

  host.appendChild(card('Latest activity', plain(r.feed, [
    ['When', x => ago(x.ago_s) + ' ago'],
    ['What', x => (x.kind === 'tab' ? (isVideoAct(x.tab) && x.page !== 'game' ? (VIDEO_ACT[x.tab] || x.tab) + ' on '
      : 'opened the ' + (GAME_TAB[x.tab] || x.tab) + ' tab on ') : 'opened ') +
      doing({ page: x.page, club: x.club, league: x.league, home: x.home, away: x.away }).what]], 'Nothing in the last half hour.')));
}

/* ---------------------------------------------------------------- pieces --- */
function card(title, body) {
  const c = el('section', 'an-card');
  c.appendChild(el('h3', null, title));
  c.appendChild(body);
  return c;
}

/* a table whose first numeric column also draws as a bar: the list and its table are one */
function ranked(rows, cols, value, foot) {
  const wrap = el('div');
  rows = rows || [];
  if (!rows.length) { wrap.appendChild(el('div', 'an-empty', 'Nothing yet in this range.')); return wrap; }
  const max = Math.max(1, ...rows.map(value));
  const sc = el('div', 'scroll');
  const tbl = el('table', 'tbl');
  const hr = el('tr');
  cols.forEach(([h, , cls]) => hr.appendChild(el('th', cls ? 'r' : null, h)));
  hr.appendChild(el('th'));
  tbl.appendChild(el('thead')).appendChild(hr);
  const tb = el('tbody');
  rows.forEach(x => {
    const tr = el('tr');
    cols.forEach(([, f, cls], i) => tr.appendChild(el('td', cls || (i === 0 ? 'nm' : null), f(x))));
    const m = el('td', 'an-meter-cell');
    const b = el('div', 'an-meter');
    b.style.width = Math.max(1, Math.round((100 * value(x)) / max)) + '%';
    m.appendChild(b);
    tr.appendChild(m);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  sc.appendChild(tbl);
  wrap.appendChild(sc);
  if (rows.length > ROWS_SHOWN) wrap.appendChild(el('p', 'an-more', rows.length + ' rows - scroll the table for the rest'));
  if (foot) wrap.appendChild(el('p', 'lead', foot));
  return wrap;
}

/* single-series columns in SVG, each with its own hover tip */
function columns(points, empty) {
  const wrap = el('div');
  if (!points.length || !points.some(p => p.value)) { wrap.appendChild(el('div', 'an-empty', empty)); return wrap; }
  const W = 640, H = 170, padL = 34, padB = 20, padT = 8;
  const n = points.length, gap = 2;
  const colW = Math.max(2, (W - padL) / n - gap);
  const max = Math.max(1, ...points.map(p => p.value));
  const nice = niceMax(max);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('class', 'an-chart');
  svg.setAttribute('role', 'img');
  const mk = (t, a) => { const e = document.createElementNS(NS, t); Object.keys(a).forEach(k => e.setAttribute(k, a[k])); return e; };
  [0, 0.5, 1].forEach(f => {
    const y = padT + (H - padB - padT) * (1 - f);
    svg.appendChild(mk('line', { x1: padL, x2: W, y1: y, y2: y, class: 'grid' }));
    const tx = mk('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'axis' });
    tx.textContent = fmt(Math.round(nice * f));
    svg.appendChild(tx);
  });
  const every = Math.ceil(n / 12);
  const tip = el('div', 'an-tip'); tip.hidden = true;
  points.forEach((p, i) => {
    const x = padL + i * (colW + gap) + gap / 2;
    const h = Math.max(p.value ? 2 : 0, ((H - padB - padT) * p.value) / nice);
    const y = H - padB - h;
    /* the hit target is the whole column height, wider than the mark itself */
    const hit = mk('rect', { x: x - gap / 2, y: padT, width: colW + gap, height: H - padB - padT, fill: 'transparent' });
    const r = mk('rect', { x, y, width: colW, height: h, rx: Math.min(3, colW / 2), class: 'col' });
    const t = document.createElementNS(NS, 'title'); t.textContent = p.tip || (p.label + ': ' + fmt(p.value));
    r.appendChild(t);
    const on = e => { r.classList.add('hi'); tip.hidden = false; tip.textContent = p.tip || (p.label + ': ' + fmt(p.value));
      tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 30) + 'px'; };
    const off = () => { r.classList.remove('hi'); tip.hidden = true; };
    [hit, r].forEach(z => { z.addEventListener('mousemove', on); z.addEventListener('mouseleave', off); });
    svg.append(r, hit);
    if (i % every === 0) {
      const lx = mk('text', { x: x + colW / 2, y: H - 5, 'text-anchor': 'middle', class: 'axis' });
      lx.textContent = p.label;
      svg.appendChild(lx);
    }
  });
  wrap.append(svg, tip);
  return wrap;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* leagues down, their pages across, shaded by views — one hue, light to dark */
function heat(cells, leagues) {
  const wrap = el('div');
  cells = cells || [];
  if (!cells.length) { wrap.appendChild(el('div', 'an-empty', 'Nothing yet in this range.')); return wrap; }
  const names = {}; (leagues || []).forEach(l => { names[l.slug] = l.name; });
  const rowTotals = {}, colTotals = {};
  cells.forEach(c => { rowTotals[c.slug] = (rowTotals[c.slug] || 0) + +c.views; colTotals[c.page] = (colTotals[c.page] || 0) + +c.views; });
  const rowKeys = Object.keys(rowTotals).sort((a, b) => rowTotals[b] - rowTotals[a]);
  const colKeys = Object.keys(colTotals).sort((a, b) => colTotals[b] - colTotals[a]).slice(0, 10);
  const at = {}; cells.forEach(c => { at[c.slug + '|' + c.page] = +c.views; });
  const max = Math.max(1, ...cells.map(c => +c.views));
  const sc = el('div', 'scroll');
  const tbl = el('table', 'tbl an-heat');
  const hr = el('tr'); hr.appendChild(el('th', null, 'League'));
  colKeys.forEach(k => hr.appendChild(el('th', 'r', PAGE[k] || k)));
  tbl.appendChild(el('thead')).appendChild(hr);
  const tb = el('tbody');
  rowKeys.forEach(s => {
    const tr = el('tr');
    tr.appendChild(el('td', 'nm', names[s] || s));
    colKeys.forEach(k => {
      const v = at[s + '|' + k] || 0;
      const td = el('td', 'num', v ? fmt(v) : '·');
      if (v) td.style.background = 'color-mix(in oklch, var(--lume) ' + Math.round(8 + 42 * v / max) + '%, transparent)';
      td.title = (names[s] || s) + ' · ' + (PAGE[k] || k) + ': ' + fmt(v) + ' views';
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  sc.appendChild(tbl);
  wrap.appendChild(sc);
  wrap.appendChild(el('p', 'lead', 'The twelve most read leagues and their ten most used pages; hover a cell for its figure.'));
  return wrap;
}

function shortDay(d) {
  const x = new Date(String(d) + 'T00:00:00Z');
  return isNaN(x) ? String(d) : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

return { mount, _test: { niceMax, PAGE, GAME_TAB, VIDEO_ACT, tabName, doing, ago, LIVE_EVERY_MS, LIVE_MAX_MS, ROWS_SHOWN } };
}));
