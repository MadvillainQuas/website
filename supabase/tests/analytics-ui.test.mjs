// The console's Analytics tab: live view runs only when switched on, and every table is capped. No browser, no network:
// a small stand-in for the page, a fake database client, and a clock the test moves by hand.
//
//   node supabase/tests/analytics-ui.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

/* ---------------------------------------------------------------- a stand-in page --- */
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.text = ''; this.attrs = {}; this.handlers = {}; this.style = {}; this._cls = new Set(); this.hidden = false; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); } }; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? Object.assign(new N('#text'), { text: c }) : c)); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.text = v == null ? '' : String(v); }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  click() { (this.handlers.click || []).forEach(f => f({})); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === ROOT; }
  getClientRects() { return SHOWN ? [1] : []; }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find(pred, out)); return out; }
  cls(c) { return this.find(n => n._cls.has(c)); }
}
const ROOT = new N('root');
let SHOWN = true;
globalThis.document = {
  createElement: t => new N(t), createElementNS: (_, t) => new N(t), createTextNode: t => Object.assign(new N('#text'), { text: t }),
  getElementById: () => null, head: new N('head'), hidden: false,
  querySelector: () => HOST
};
globalThis.window = { EPINOIA_CONFIG: { analytics: true } };
const HOST = new N('div'); ROOT.appendChild(HOST);

/* the clock and the timers, moved by hand */
let NOW = 1_000_000;
const realNow = Date.now; Date.now = () => NOW;
let timers = [], tid = 0;
globalThis.setInterval = (f, ms) => { timers.push({ id: ++tid, f, ms }); return tid; };
globalThis.clearInterval = id => { timers = timers.filter(t => t.id !== id); };
const advance = async ms => { NOW += ms; for (const t of [...timers]) await t.f(); await new Promise(r => setImmediate(r)); };

/* a fake database client that counts what is asked of it */
const calls = [];
const REPORT = { totals: { views: 1, sessions: 1 }, daily: [], hourly: [], pages: [], leagues: [], teams: [], games: [], game_tabs: [], league_pages: [], tabs: [],
                 go: {}, devices: [], langs: [], apps: [], referrers: [], live: { sessions: 0, views: 0 } };
const LIVE = { window_s: 300, sessions: 3, signed_in: 1, last_30m: 5, devices: [{ k: 'phone', sessions: 2 }, { k: 'desktop', sessions: 1 }],
  apps: [], langs: [], where: [{ page: 'game', sessions: 2 }], leagues: [{ name: 'Live League', sessions: 2 }],
  games: [{ id: 'g1', home: 'Home Club', away: 'Away Club', league: 'Live League', status: 'live', sessions: 2 }], tabs: [{ tab: 'shotclock', sessions: 1 }],
  visitors: [{ page: 'game', tab: 'shotclock', home: 'Home Club', away: 'Away Club', device: 'desktop', lang: 'en', app: 'web', signed_in: false, idle_s: 12, on_page_s: 95 }],
  feed: [{ ago_s: 5, kind: 'tab', page: 'game', tab: 'shotclock', home: 'Home Club', away: 'Away Club' }],
  per_minute: Array.from({ length: 30 }, (_, i) => ({ ago_min: 29 - i, views: i % 3, sessions: 1 })) };
let liveFails = null, searchFails = null, activityFails = null;
const SEARCH = { range: { days: 30 }, totals: { searches: 40, queries: 25, picked: 30, no_results: 6 },
  daily: [{ day: '2026-09-24', searches: 15, picked: 11, no_results: 2 }, { day: '2026-09-25', searches: 25, picked: 19, no_results: 4 }],
  top: [{ q: 'diggins', searches: 9, results: 1, picked: 7, no_results: 0 }, { q: 'newcastle', searches: 6, results: 2, picked: 5, no_results: 0 }],
  nothing: [{ q: 'apu udine', searches: 3 }, { q: 'zzz', searches: 1 }],
  picked_kinds: [{ kind: 'player', n: 18 }, { kind: 'team', n: 10 }, { kind: 'league', n: 2 }],
  picked: [{ kind: 'player', ref: 'michael-diggins', n: 7, name: 'Michael Diggins' }, { kind: 'team', ref: 'newcastle-eagles', n: 5, name: 'Newcastle Eagles' }],
  devices: [{ k: 'desktop', n: 30 }, { k: 'phone', n: 10 }], langs: [{ k: 'en', n: 38 }, { k: 'ja', n: 2 }], apps: [{ k: 'web', n: 40 }] };
const sb = { rpc: async (fn, args) => { calls.push(fn); if (fn === 'analytics_report') return { data: REPORT };
  if (fn === 'analytics_search_report') return searchFails ? { error: { message: searchFails } } : { data: SEARCH };
  if (fn === 'analytics_activity_report') return activityFails ? { error: { message: activityFails } } : { data: ACTIVITY };
  if (fn === 'analytics_sources_report') return { data: {} }; if (liveFails) return { error: { message: liveFails } }; return { data: LIVE }; } };

const UI = createRequire(import.meta.url)(path.join(here, '..', '..', 'epinoia', 'admin', 'platform', 'analytics-ui.js'));
const T = UI._test;
const tick = () => new Promise(r => setImmediate(r));
const count = fn => calls.filter(c => c === fn).length;

console.log('-- live view is off until somebody turns it on');
UI.mount({ host: HOST, sb });
await tick(); await tick();
ok('opening the tab reads the report, and nothing live', count('analytics_report') === 1 && count('analytics_live') === 0, calls);
ok('no timer is running', timers.length === 0, timers.length);
const btn = HOST.find(n => n.tag === 'button' && /live view/.test(n.textContent))[0];
ok('there is a button, and the card says it is off and what turning it on costs', btn && /Off\. Live view/.test(HOST.cls('an-live')[0].textContent) && /only then/.test(HOST.cls('an-live')[0].textContent));
await advance(60_000);
ok('a minute later, still nothing asked', count('analytics_live') === 0, calls);

console.log('-- pressing the button');
btn.click(); await tick(); await tick();
ok('one read at once', count('analytics_live') === 1, calls);
ok('...and a timer every ten seconds', timers.length === 1 && timers[0].ms === T.LIVE_EVERY_MS);
ok('the card shows the visitors and the game being watched', /Home Club v Away Club/.test(HOST.cls('an-live')[0].textContent) && /Shot clock analysis/.test(HOST.cls('an-live')[0].textContent));
ok('it is marked running, and the button now stops it', HOST.cls('an-live')[0].classList.contains('running') && btn.textContent === 'stop');
await advance(10_000);
ok('ten seconds later, a second read', count('analytics_live') === 2, calls);
await advance(10_000); await advance(10_000);
ok('and a third and fourth: one per interval, never more', count('analytics_live') === 4, calls);

console.log('-- it stops itself');
const before = count('analytics_live');
btn.click(); await tick();
ok('the button stops it: the timer is gone and nothing more is asked', timers.length === 0 && btn.textContent === 'start live view');
await advance(60_000);
ok('a minute after stopping, no more reads', count('analytics_live') === before, calls);
ok('the last reading stays on screen, marked as such', /Last reading - live view is off/.test(HOST.cls('an-live')[0].textContent));
btn.click(); await tick(); await tick();
const t0 = count('analytics_live');
document.hidden = true;
await advance(30_000);
ok('while the window is hidden it asks nothing, and says it is paused', count('analytics_live') === t0 && /paused/.test(HOST.cls('an-live')[0].textContent), calls.slice(-2));
document.hidden = false;
await advance(10_000);
ok('and carries on when the window is back', count('analytics_live') === t0 + 1);
SHOWN = false;
await advance(10_000);
ok('leaving the Analytics tab stops it', timers.length === 0 && /left the Analytics tab/.test(HOST.cls('an-live')[0].textContent), HOST.cls('an-live')[0].textContent.slice(0, 120));
SHOWN = true;
btn.click(); await tick(); await tick();
for (let i = 0; i < 61; i++) await advance(10_000);
ok('after ten minutes it stops by itself and says so', timers.length === 0 && /Stopped after 10 minutes/.test(HOST.cls('an-live')[0].textContent));
ok('it never made more than 60 reads in that ten minutes', count('analytics_live') <= t0 + 1 + 1 + 62, count('analytics_live'));

console.log('-- extending it to an hour');
const more = HOST.find(n => n.tag === 'button' && n.textContent === 'extend to 1 hr')[0];
ok('there is an "extend to 1 hr" button, hidden while live view is off', !!more && more.hidden === true);
btn.click(); await tick(); await tick();
ok('...and shown while it runs', more.hidden === false);
for (let i = 0; i < 30; i++) await advance(10_000);                 // five minutes in
more.click(); await tick();
ok('pressing it hides the button and moves the stop to an hour from now', more.hidden === true && /stops in 60 min/.test(HOST.cls('an-live')[0].textContent), HOST.cls('an-live')[0].textContent.slice(0, 160));
for (let i = 0; i < 61; i++) await advance(10_000);                 // past where ten minutes would have stopped it
ok('it is still running after the original ten minutes, still one timer', timers.length === 1 && HOST.cls('an-live')[0].classList.contains('running'), timers.length);
for (let i = 0; i < 330; i++) await advance(10_000);
ok('and it stops by itself after the hour, and says so', timers.length === 0 && /Stopped after 60 minutes/.test(HOST.cls('an-live')[0].textContent), HOST.cls('an-live')[0].textContent.slice(0, 160));
ok('the next live view starts from ten minutes again, with the button back', (btn.click(), await tick(), await tick(), more.hidden === false && timers.length === 1));
btn.click(); await tick();

console.log('-- a refresh of the report does not reset a running live view');
btn.click(); await tick(); await tick();
const liveBefore = HOST.cls('an-live')[0];
HOST.find(n => n.tag === 'button' && n.textContent === 'refresh')[0].click(); await tick(); await tick(); await tick();
ok('the same live card is back after the redraw, still running', HOST.cls('an-live')[0] === liveBefore && liveBefore.classList.contains('running') && timers.length === 1);
btn.click(); await tick();

console.log('-- when migration 0176 is not applied');
liveFails = 'Could not find the function public.analytics_live(p_window_s) in the schema cache';
btn.click(); await tick(); await tick(); await tick();
ok('it stops and says the migration is missing, rather than retrying', timers.length === 0 && /needs migration 0176/.test(HOST.cls('an-live')[0].textContent));
liveFails = null;

console.log('-- every table is capped');
const css = readFileSync(path.join(here, '..', '..', 'epinoia', 'admin', 'platform', 'analytics-ui.js'), 'utf8');
ok('tables are held to a height and scroll, with the header pinned', /\.an-card \.scroll\{max-height:\d+px;overflow:auto/.test(css) && /\.an-card \.scroll thead th\{position:sticky;top:0/.test(css));
ok('about ten rows show at once', T.ROWS_SHOWN === 10);
// a report with 100 games: the table holds them all (they scroll) and says so
Object.assign(REPORT, { games: Array.from({ length: 100 }, (_, i) => ({ id: 'g' + i, home: 'H' + i, away: 'A' + i, league: 'L', views: 100 - i, sessions: 1 })) });
HOST.textContent = ''; ROOT.children = [HOST];
UI.mount({ host: HOST, sb }); await tick(); await tick();
const gamesCard = HOST.find(n => n.tag === 'section' && /Most read games/.test(n.children[0] && n.children[0].textContent))[0];
ok('the games table has 100 rows inside one scrolling box, and a note that says to scroll',
   gamesCard && gamesCard.find(n => n.tag === 'tr').length === 101 && gamesCard.cls('scroll').length === 1 && /100 rows - scroll/.test(gamesCard.textContent), gamesCard && gamesCard.textContent.slice(0, 80));

console.log('-- what a visitor is doing, in words');
ok('a game and its tab', T.doing({ page: 'game', home: 'A', away: 'B', tab: 'shotclock', device: 'phone', app: 'android', lang: 'ja', signed_in: true }).what === 'Game (box score): A v B - Shot clock analysis');
ok('who: device, app, language, signed in - and nothing else', T.doing({ page: 'l', league: 'X', device: 'phone', app: 'android', lang: 'ja', signed_in: true }).who === 'Phone · Android app · Japanese · signed in');
ok('a club page', T.doing({ page: 't', club: 'Home Club' }).what === 'Club profile: Home Club');
ok('seconds, then minutes', T.ago(5) === '5 s' && T.ago(89) === '89 s' && T.ago(120) === '2 min');

const openView = name => { const b = HOST.find(n => n.tag === 'button' && n._cls.has('an-view') && n.textContent === name)[0]; if (!b) throw new Error('no view ' + name); b.click(); };
console.log('-- what people search for (migration 0180)');
{
  HOST.textContent = ''; ROOT.children = [HOST];
  UI.mount({ host: HOST, sb }); await tick(); await tick(); await tick();
  ok('the visits do not ask for the searches: each view reads its own report', calls.filter(c => c === 'analytics_search_report').length === 0);
  openView('Search'); await tick(); await tick(); await tick();
  const text = HOST.textContent;
  ok('the Search view asks for it with the same range as the visits', calls.filter(c => c === 'analytics_search_report').length >= 1);
  ok('it draws in its own view: a heading, and the three figures - searches, picked, found nothing',
     /What people search for/.test(text) && /searches/.test(text) && /picked a result/.test(text) && /found nothing/.test(text) && /75%/.test(text) && /15%/.test(text), text.slice(-700));
  const card = title => HOST.find(n => n.tag === 'section' && new RegExp(title).test(n.children[0] && n.children[0].textContent))[0];
  ok('the most common searches, with how many results and how often one was picked', /diggins/.test(card('Most common searches').textContent) && /78%/.test(card('Most common searches').textContent), card('Most common searches') && card('Most common searches').textContent);
  ok('the ones that found nothing, to read down', /apu udine/.test(card('Searches that found nothing').textContent));
  ok('what gets picked, by kind and by name', /Player/.test(card('What gets picked').textContent) && /Michael Diggins/.test(card('Most picked results').textContent));
  ok('it says what is kept and what is not (no account, no visit token; no address, phone number or web address)', /no visit token/.test(text) && /never kept/.test(text));
  searchFails = 'Could not find the function public.analytics_search_report(p_days) in the schema cache';
  HOST.textContent = ''; ROOT.children = [HOST];
  UI.mount({ host: HOST, sb }); await tick(); await tick(); await tick();
  const without = HOST.textContent;
  openView('Overview'); await tick(); await tick();
  ok('a database without 0180 says so in a line, and the visits still draw', /migration 0180 has not been applied/.test(without) && /Most read leagues/.test(HOST.textContent));
  searchFails = null;
}

console.log('-- what people do on a page (migration 0260): the views');
var ACTIVITY = {
  totals: { median_page_secs: 71, median_visit_secs: 262, engaged_hours: 12.5, bounce_rate: 38.6, video_plays: 40, video_hours: 3, downloads: 25, outbound: 9, shares: 4, errors: 6, embeds: 100, median_speed_ms: 1460 },
  pages: [
    { page: 'game', views: 400, timed: 300, median_secs: 132, p75_secs: 410, quick: 14, avg_depth: 72, read_most: 41, landings: 100, bounces: 30, exits: 120, median_ms: 1800, p75_ms: 4700, speed_n: 300, errors: 6 },
    { page: 't', views: 200, timed: 150, median_secs: 61, p75_secs: 170, quick: 44, avg_depth: 47, read_most: 18, landings: 80, bounces: 52, exits: 60, median_ms: 1200, p75_ms: 2300, speed_n: 150 }
  ],
  leagues: [{ slug: 'slb', name: 'Super League Basketball', secs: 36000, visits: 90, median_secs: 88 }],
  video_funnel: { opened: 60, played: 40, q25: 30, q50: 20, q75: 12, done: 8 },
  videos: [{ what: 'youtube:abc', provider: 'youtube', opens: 50, plays: 30, half: 15, done: 6, minutes: 140, page: 'home/video', title: 'Highlights: Lions v Riders', league: 'Super League Basketball' }],
  video_pages: [{ page: 'home/video', opens: 50, plays: 30, minutes: 140 }], video_daily: [],
  downloads: [{ what: 'report', fmt: 'pdf', page: 't', n: 12, visits: 10, about: 'London Lions', about_kind: 'club' },
              { what: 'season-stats', fmt: 'csv', page: 'stats', n: 8, visits: 8, about: 'Super League Basketball', about_kind: 'league' }],
  download_kinds: [{ what: 'report', fmt: 'pdf', n: 12 }, { what: 'season-stats', fmt: 'csv', n: 8 }],
  outbound: [{ host: 'tickets.example.com', n: 9, visits: 8, page: 'game' }],
  shares: [{ kind: 'copy', what: 'link', page: 'game', n: 4 }],
  errors: [{ page: 'game', what: 'boxscore.js:412', n: 6, visits: 5, last_at: '2026-10-13T10:00:00Z' }],
  speed_devices: [{ device: 'phone', n: 200, median_ms: 1900, p75_ms: 3400 }, { device: 'desktop', n: 100, median_ms: 900, p75_ms: 1500 }],
  embeds: [{ widget: 'embed/table', host: 'clubsite.co.uk', n: 100 }]
};
{
  HOST.textContent = ''; ROOT.children = [HOST];
  calls.length = 0;
  UI.mount({ host: HOST, sb }); await tick(); await tick();
  ok('the tab opens on one view and reads only its report', count('analytics_report') === 1 && count('analytics_activity_report') === 0, calls);
  openView('Insights'); await tick(); await tick();
  const ins = HOST.textContent;
  ok('Insights: the headline figures and what they suggest', /median time on a page/.test(ins) && /1 m 11 s/.test(ins) && /What the figures suggest/.test(ins), ins.slice(0, 300));
  ok('...a script error first, as something to fix, with its file and line and how many visits',
     HOST.cls('an-in')[0] && HOST.cls('an-in')[0]._cls.has('fix') && /boxscore\.js:412 failed in 5 visits/.test(HOST.cls('an-in')[0].textContent));
  ok('...a slow page, and a club page people leave fast, each with its numbers',
     /Game \(box score\) is slow to appear/.test(ins) && /4\.7 s/.test(ins) && /Visitors who arrive on Club profile leave without going further/.test(ins) && /65%/.test(ins));
  openView('Time on page'); await tick();
  const tm = HOST.textContent;
  ok('Time on page: every page with its median, 75%, quick exits, depth, bounce, exit rate and load',
     /Every page, by traffic/.test(tm) && /2 m 12 s/.test(tm) && /6 m 50 s/.test(tm) && /Time spent, league by league/.test(tm) && /10 h 00 m/.test(tm), tm.slice(0, 400));
  openView('Video'); await tick();
  ok('Video: plays, how far viewers get, and the videos by title', /How far viewers get/.test(HOST.textContent) && /Highlights: Lions v Riders/.test(HOST.textContent) && /YouTube/.test(HOST.textContent));
  openView('Downloads'); await tick();
  const dl = HOST.textContent;
  ok('Downloads: "a club report, PDF, from the club page, about London Lions"; a season stats CSV from Statistics',
     /Club reportPDFClub profileLondon Lions \(club\)/.test(dl) && /Season stats tableCSVStatistics/.test(dl), dl.slice(0, 400));
  openView('Links & sharing'); await tick();
  ok('Links & sharing: other sites by name, copies by kind, widgets by site', /tickets\.example\.com/.test(HOST.textContent) && /Copied a link/.test(HOST.textContent) && /clubsite\.co\.uk/.test(HOST.textContent));
  openView('Speed & errors'); await tick();
  ok('Speed & errors: slowest pages, by device, the errors', /Slowest pages/.test(HOST.textContent) && /Phone/.test(HOST.textContent) && /boxscore\.js:412/.test(HOST.textContent));
  ok('six views, ONE read of the activity report', count('analytics_activity_report') === 1, calls);
  const refresh = HOST.find(n => n.tag === 'button' && n.textContent === 'refresh')[0];
  refresh.click(); await tick(); await tick();
  ok('refresh reads it again', count('analytics_activity_report') === 2, calls);
  activityFails = 'Could not find the function public.analytics_activity_report(p_days) in the schema cache';
  refresh.click(); await tick(); await tick();
  ok('a database without 0260 says so in a line', /need migration 0260/.test(HOST.textContent), HOST.textContent.slice(-300));
  activityFails = null;
}

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
