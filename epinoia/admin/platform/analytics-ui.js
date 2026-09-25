'use strict';
/* ============================================================================
   The console's Analytics tab — how the site is used, from site_events (migration 0173).

   EVERYTHING HERE IS ANONYMOUS. The rows behind it carry no account, no IP address, no
   cookie and nothing that outlives a browser tab (track.js explains exactly what is sent).
   So a "visit" is one tab's session, and there is deliberately no "unique people" figure
   across days: counting the same person twice on two days is the price of never being able
   to recognise them.

   One call, analytics_report(p_days), returns every figure; it answers platform
   administrators only. Charts are one accent hue on the kit's own tokens (light and dark),
   every bar list is also its own table, and every column carries its numbers on hover.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAnalyticsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const RANGES = [[1, 'last 24 hours'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];

/* what each page of the site is called here; anything new shows its path */
const PAGE = {
  splash: 'Splash', home: 'HOME', l: 'League table / team stats', t: 'Club profile', p: 'Player profile',
  game: 'Game (box score)', fixtures: 'Fixtures', stats: 'Statistics', 'stats/wowy': 'WOWY',
  injuries: 'Injury report', news: 'News', video: 'Video hub', games: 'Games (every league)',
  scouting: 'Scouting', go: 'EPINOIA GO', 'go/stamps': 'GO · stamps', 'go/photos': 'GO · photos',
  me: 'Profile', signin: 'Sign in', join: 'Join', invite: 'Invite', learn: 'Learn more', api: 'API',
  contact: 'Contact', privacy: 'Privacy', android: 'Android app', ios: 'iPhone app', app: 'App',
  prophesy: 'Prophesy', fixtures_all: 'Fixtures'
};
const GAME_TAB = {
  box: 'Box score', pbp: 'Play-by-play', shots: 'Shot charts', adv: 'Full stats', lineups: 'Lineups',
  flow: 'Game flow', connections: 'Connections', events: 'Events', shotclock: 'Shot clock analysis',
  video: 'Video', report: 'Match report', preview: 'Preview'
};
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
`;

function el(t, c, x) { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
const fmt = n => Number(n || 0).toLocaleString('en-GB');
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');

let st = null;

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  if (!document.getElementById('an-css')) { const s = el('style'); s.id = 'an-css'; s.textContent = CSS; document.head.appendChild(s); }
  st = st || { days: 30 };
  st.sb = o.sb; st.say = o.say || (() => {}); st.host = host;
  draw();
}

async function draw() {
  const host = st.host;
  host.textContent = '';
  const bar = el('div', 'an-bar');
  RANGES.forEach(([d, label]) => {
    const b = el('button', 'ep-btn mini' + (st.days === d ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { st.days = d; draw(); });
    bar.appendChild(b);
  });
  const again = el('button', 'ep-btn mini', 'refresh'); again.type = 'button';
  again.addEventListener('click', draw);
  bar.appendChild(again);
  const note = el('span', 'an-note', 'loading…');
  bar.appendChild(note);
  host.appendChild(bar);

  const cfg = window.EPINOIA_CONFIG || {};
  if (cfg.analytics !== true) {
    host.appendChild(el('div', 'an-off',
      'Counting is switched off on the site (config.js analytics: false), so the figures below only cover the time it was on. ' +
      'It is turned on once migration 0173 is applied.'));
  }

  let r = null;
  try {
    const res = await st.sb.rpc('analytics_report', { p_days: st.days });
    if (res.error) throw res.error;
    r = res.data;
  } catch (e) {
    note.textContent = '';
    const msg = String((e && e.message) || e);
    host.appendChild(el('div', 'an-off', /analytics_report|schema cache|does not exist/i.test(msg)
      ? 'The analytics tables are not in the database yet: migration 0173 has not been applied.'
      : 'The report could not be read: ' + msg));
    return;
  }
  note.textContent = 'updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  render(host, r || {});
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
    ['Page', x => PAGE[x.page] || x.page], ['Tab', x => x.tab],
    ['Clicks', x => fmt(x.clicks), 'num'], ['Visits', x => fmt(x.sessions), 'num']], x => +x.clicks)));
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

return { mount, _test: { niceMax, PAGE, GAME_TAB } };
}));
