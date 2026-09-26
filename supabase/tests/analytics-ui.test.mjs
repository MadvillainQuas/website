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
let liveFails = null, searchFails = null;
const SEARCH = { range: { days: 30 }, totals: { searches: 40, queries: 25, picked: 30, no_results: 6 },
  daily: [{ day: '2026-09-24', searches: 15, picked: 11, no_results: 2 }, { day: '2026-09-25', searches: 25, picked: 19, no_results: 4 }],
  top: [{ q: 'diggins', searches: 9, results: 1, picked: 7, no_results: 0 }, { q: 'newcastle', searches: 6, results: 2, picked: 5, no_results: 0 }],
  nothing: [{ q: 'apu udine', searches: 3 }, { q: 'zzz', searches: 1 }],
  picked_kinds: [{ kind: 'player', n: 18 }, { kind: 'team', n: 10 }, { kind: 'league', n: 2 }],
  picked: [{ kind: 'player', ref: 'michael-diggins', n: 7, name: 'Michael Diggins' }, { kind: 'team', ref: 'newcastle-eagles', n: 5, name: 'Newcastle Eagles' }],
  devices: [{ k: 'desktop', n: 30 }, { k: 'phone', n: 10 }], langs: [{ k: 'en', n: 38 }, { k: 'ja', n: 2 }], apps: [{ k: 'web', n: 40 }] };
const sb = { rpc: async (fn, args) => { calls.push(fn); if (fn === 'analytics_report') return { data: REPORT };
  if (fn === 'analytics_search_report') return searchFails ? { error: { message: searchFails } } : { data: SEARCH }; if (liveFails) return { error: { message: liveFails } }; return { data: LIVE }; } };

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

console.log('-- what people search for (migration 0180)');
{
  HOST.textContent = ''; ROOT.children = [HOST];
  UI.mount({ host: HOST, sb }); await tick(); await tick(); await tick();
  const text = HOST.textContent;
  ok('the tab asks for it with the same range as the visits', calls.filter(c => c === 'analytics_search_report').length >= 1);
  ok('it draws under the visits: a heading, and the three figures - searches, picked, found nothing',
     /What people search for/.test(text) && /searches/.test(text) && /picked a result/.test(text) && /found nothing/.test(text) && /75%/.test(text) && /15%/.test(text), text.slice(-700));
  const card = title => HOST.find(n => n.tag === 'section' && new RegExp(title).test(n.children[0] && n.children[0].textContent))[0];
  ok('the most common searches, with how many results and how often one was picked', /diggins/.test(card('Most common searches').textContent) && /78%/.test(card('Most common searches').textContent), card('Most common searches') && card('Most common searches').textContent);
  ok('the ones that found nothing, to read down', /apu udine/.test(card('Searches that found nothing').textContent));
  ok('what gets picked, by kind and by name', /Player/.test(card('What gets picked').textContent) && /Michael Diggins/.test(card('Most picked results').textContent));
  ok('it says what is kept and what is not (no account, no visit token; no address, phone number or web address)', /no visit token/.test(text) && /never kept/.test(text));
  searchFails = 'Could not find the function public.analytics_search_report(p_days) in the schema cache';
  HOST.textContent = ''; ROOT.children = [HOST];
  UI.mount({ host: HOST, sb }); await tick(); await tick(); await tick();
  ok('a database without 0180 says so in a line, and the visits still draw', /migration 0180 has not been applied/.test(HOST.textContent) && /Most read leagues/.test(HOST.textContent));
  searchFails = null;
}

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
