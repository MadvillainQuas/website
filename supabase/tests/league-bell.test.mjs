/* ============================================================================
   FOLLOWING A WHOLE LEAGUE, AND WHAT ARRIVES WHEN SEVERAL GAMES FINISH AT ONCE.

   A fan could follow a club, a player or one game. Following the league is one
   bell on its front page (0133): the audience expands it into the clubs playing
   in it, so every game reaches them — including a club that joins later.

   Which makes the second half necessary. A Saturday afternoon can finish four
   games inside a minute, and four notices is four slots on a lock screen that
   get cleared without being read. From the THIRD one they become a single
   notice that says how many and lists them, one game to a line, which Android
   expands when it is pulled down.

   What this file holds:

     1. follow.js knows the kind, and will not draw a bell for a list the
        database has never heard of — the write would be dropped and the bell
        would sit there lit, having saved nothing
     2. a labelled bell says which state it is in
     3. the league page mounts it under the title, only when it is supported
     4. the payload carries the pile a notice belongs to, and what to call it
     5. the worker: one and two are themselves, three is a summary; a
        replacement is not an addition; the summary grows; nothing without a
        league is ever folded; and a browser that will not answer still shows
        the notice

     node supabase/tests/league-bell.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* ------------------------------------------------------------- 1. follow.js --- */
console.log('\n1. follow.js knows what a league is');
{
  const src = rd('epinoia', 'follow.js');
  /* run for real: a fake document, a fake fetch, a stored session */
  const run = (o) => {
    const opt = o || {};
    const nodes = [];
    const mk = () => {
      const n = { tag: '', kids: [], dataset: {}, attrs: {}, listeners: {}, _html: '', _text: '' };
      n.cls = new Set();
      n.classList = { add: k => n.cls.add(k), remove: k => n.cls.delete(k), contains: k => n.cls.has(k),
                      toggle: (k, v) => (v ? n.cls.add(k) : n.cls.delete(k)) };
      n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
      n.removeAttribute = k => { delete n.attrs[k]; };
      n.getAttribute = k => (n.attrs[k] == null ? null : n.attrs[k]);
      n.appendChild = k => { n.kids.push(k); return k; };
      n.addEventListener = (t, fn) => { (n.listeners[t] = n.listeners[t] || []).push(fn); };
      n.click = () => (n.listeners.click || []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {} }));
      /* the bell sets .className, not classList.add — without this the document never
         finds it again and paintAll silently does nothing */
      Object.defineProperty(n, 'className', {
        get() { return [...n.cls].join(' '); },
        set(v) { n.cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
      });
      Object.defineProperty(n, 'innerHTML', {
        get() { return n._html; },
        /* the bell writes one <span>; that is all a test needs from it */
        set(v) { n._html = String(v); n.span = /<span>/.test(v) ? mk() : null; }
      });
      Object.defineProperty(n, 'textContent', { get() { return n._text; }, set(v) { n._text = String(v == null ? '' : v); } });
      n.querySelector = sel => (sel === 'span' ? n.span : null);
      n.querySelectorAll = () => [];
      nodes.push(n);
      return n;
    };
    const posted = [];
    const ctx = {
      console, JSON, Object, Array, Set, Date, String, Promise, encodeURIComponent,
      localStorage: { getItem: () => JSON.stringify({ access_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600 }) },
      location: { pathname: '/epinoia/', search: '?l=bcb', href: '' },
      /* paintAll finds every bell for the same thing through the document; without this
         the element is never repainted and the test would be measuring its own gap */
      document: { createElement: mk, querySelector: () => null, head: mk(),
        querySelectorAll: sel => {
          const m = /data-kind="([^"]+)"\]\[data-id="([^"]+)"/.exec(String(sel));
          if (!m) return [];
          return nodes.filter(n => n.cls.has('ep-follow') && n.dataset.kind === m[1] && n.dataset.id === m[2]);
        } },
      window: { EPINOIA_CONFIG: { supabaseUrl: 'https://p.supabase.co', supabaseAnonKey: 'k' } },
      fetch: async (url, init) => {
        if (/rpc\/set_fan_prefs/.test(url)) { posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; }
        /* the database without 0133 refuses the column and is asked again without it */
        if (opt.noColumn && /fav_league_ids/.test(url)) return { ok: false, status: 400, json: async () => ({}) };
        return { ok: true, json: async () => [opt.row || {}] };
      }
    };
    ctx.window.window = ctx.window;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'follow.js' });
    return { F: ctx.window.EpinoiaFollow, posted, mk };
  };

  const a = run({});
  ok('the module is there, with supports()', !!a.F && typeof a.F.supports === 'function');
  await a.F.load();
  ok('a database with the column supports a league follow', a.F.supports('league'));
  ok('...and still supports the three it always did',
     ['game', 'team', 'player'].every(k => a.F.supports(k)));

  const b = run({ noColumn: true });
  await b.F.load();
  ok('a database WITHOUT it says so, so no bell is drawn that could not save',
     !b.F.supports('league') && b.F.supports('team'));

  const c = run({ row: { fav_league_ids: [] } });
  await c.F.load();
  const bell = c.F.bell('league', 'lg1', { cls: 'big lbl', label: 'follow the league', labelOn: 'following the league' });
  eq('the bell is off, and says the off words', [bell.cls.has('on'), bell.span.textContent],
     [false, 'follow the league']);
  bell.click();
  await new Promise(s => setTimeout(s, 0));
  eq('following writes the league to the right list', c.posted, [{ p: { fav_league_ids: ['lg1'] } }]);
  eq('...and the bell lights and says the on words', [bell.cls.has('on'), bell.span.textContent],
     [true, 'following the league']);
  ok('it is announced as pressed, not just coloured', bell.attrs['aria-pressed'] === 'true');
  bell.click();
  await new Promise(s => setTimeout(s, 0));
  eq('unfollowing sends the empty list, which is what clears it',
     c.posted[1], { p: { fav_league_ids: [] } });
  eq('...and the words come back', bell.span.textContent, 'follow the league');
}

/* ------------------------------------------------------- 2. on the page --- */
console.log('\n2. the bell sits under the league\'s name');
{
  const page = rd('epinoia', 'index.html');
  const js = rd('epinoia', 'home.js');
  ok('there is a row for it in the hero, after the name', (() => {
    const head = page.indexOf('class="hero-head"');
    const acts = page.indexOf('id="leagueActs"');
    const tag = page.indexOf('class="tagline"');
    return head > 0 && acts > head && acts < tag;
  })());
  ok('an empty row takes no space, so the hub is unchanged', /\.hero-acts:empty\{display:none\}/.test(page));
  ok('home.js mounts it only for a league', /function leagueBell\(\)/.test(js) &&
     /if \(!host \|\| !F \|\| !LEAGUE \|\| !LEAGUE\.id/.test(js));
  ok('...and only when the database holds the list',
     /if \(!F\.supports \|\| !F\.supports\('league'\)/.test(js));
  ok('...and never twice', /host\.querySelector\('\.ep-follow'\)\) return;/.test(js));
  ok('it is the labelled pill, and says which state it is in',
     /cls: 'big lbl', label: 'follow the league', labelOn: 'following the league'/.test(js));
  ok('follow.js is loaded before home.js needs it',
     page.indexOf('follow.js?v=') < page.indexOf('home.js?v='));
  ok('the pill wears the league\'s own colour when it is on',
     /body\.league-themed \.hero-acts \.ep-follow\.on\{background:var\(--league-a\)/.test(page));
}

/* --------------------------------------------------------- 3. the payload --- */
console.log('\n3. a push says which pile it belongs to');
{
  const P = require(path.join(ROOT, 'supabase', 'functions', '_shared', 'pushpayload.js'));
  const row = { id: 'n1', kind: 'result', title: 'A 80–70 B', body: 'BCB', link: 'game/?g=g1',
                game_id: 'g1', league_id: 'lg1', created_at: '2026-09-18T15:00:00Z' };
  const p = P.payloadFor(row, 'https://x.test/epinoia/', 1, { groupName: 'British Championship' });
  eq('the league is the pile', p.group, 'lg:lg1');
  eq('...and it is named, so the summary can be a sentence', p.groupName, 'British Championship');
  ok('a notice with no league belongs to no pile',
     !('group' in P.payloadFor(Object.assign({}, row, { league_id: null }), 'https://x.test/epinoia/', 1)));
  ok('an unnamed pile is still a pile',
     P.payloadFor(row, 'https://x.test/epinoia/', 1).group === 'lg:lg1' &&
     !('groupName' in P.payloadFor(row, 'https://x.test/epinoia/', 1)));
  const notify = rd('supabase', 'functions', 'notify', 'index.ts');
  ok('notify reads the league off the row', /league_id,data,expires_at/.test(notify));
  ok('...and its name once for the whole batch',
     /const lgIds = \[\.\.\.new Set\(toPush\.map/.test(notify) && /from\('leagues'\)\.select\('id,name'\)/.test(notify));
}

/* ----------------------------------------------------- 4. the worker folds --- */
console.log('\n4. three that land together become one');
const swSrc = rd('epinoia', 'sw.js');
function loadSW(open) {
  const live = (open || []).slice();
  const shown = [];
  const self = {
    addEventListener: (t, fn) => { self['on' + t] = fn; },
    skipWaiting: () => {}, location: { origin: 'https://x.test' },
    registration: {
      showNotification: async (title, options) => { shown.push({ title, options }); },
      getNotifications: async () => (live.slice()),
      pushManager: { subscribe: async () => null }
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => ({}) }
  };
  const module = { exports: {} };
  const ctx = vm.createContext({ self, module, URL, atob, console, setTimeout,
    fetch: async () => ({ ok: true, status: 200 }), Response: function () {} });
  vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
  return { W: module.exports, self, shown, live };
}
/* a live notification as the browser hands one back */
const liveNote = (title, body, o) => ({ title, body, tag: (o || {}).tag || '',
  data: Object.assign({ url: '/epinoia/game/?g=' + title, group: 'lg:lg1' }, (o || {}).data || {}),
  close() { this.closed = true; } });
const push = async (sw, payload) => {
  const waits = [];
  await sw.self.onpush({ data: { json: () => payload }, waitUntil: p => waits.push(p) });
  await Promise.all(waits);
};
const P = (title, body, extra) => Object.assign(
  { title, body, url: '/epinoia/game/?g=' + title, kind: 'result', tag: 'result:' + title,
    group: 'lg:lg1', groupName: 'British Championship' }, extra || {});

{
  const one = loadSW([]);
  await push(one, P('A v B', '80–70'));
  eq('the first is itself', [one.shown.length, one.shown[0].title], [1, 'A v B']);
  ok('...and is not tagged as a pile', one.shown[0].options.tag === 'result:A v B');

  const two = loadSW([liveNote('A v B', '80–70', { tag: 'result:A v B' })]);
  await push(two, P('C v D', '91–88'));
  eq('the second is itself too — one game is the thing itself',
     [two.shown.length, two.shown[0].title], [1, 'C v D']);
  ok('the threshold is named, not buried', two.W.GROUP_MIN === 3);

  const three = loadSW([liveNote('A v B', '80–70', { tag: 'result:A v B' }),
                        liveNote('C v D', '91–88', { tag: 'result:C v D' })]);
  await push(three, P('E v F', '70–69'));
  eq('the third folds all three into one', three.shown.length, 1);
  eq('...which says how many, and where', three.shown[0].title, '3 updates in British Championship');
  eq('...and lists them, one to a line',
     three.shown[0].options.body.split('\n'),
     ['A v B — 80–70', 'C v D — 91–88', 'E v F — 70–69']);
  ok('...under one lock-screen slot that replaces itself',
     three.shown[0].options.tag === 'grp:lg:lg1' && three.shown[0].options.renotify === true);
  ok('the two it replaced are closed, not left underneath', three.live.every(n => n.closed));
  ok('it carries the pile, so the next one can extend it',
     three.shown[0].options.data.group === 'lg:lg1' &&
     three.shown[0].options.data.items.length === 3);
  ok('tapping it opens the one that has just arrived',
     three.shown[0].options.data.url === '/epinoia/game/?g=E v F');
  ok('...and a button opens all of them', (three.shown[0].options.actions || [])[0].action === 'all' &&
     three.shown[0].options.data.actions.all === '/epinoia/games/');

  /* a summary that grows */
  const four = loadSW([{ title: '3 updates in British Championship', body: 'x', tag: 'grp:lg:lg1',
    data: { group: 'lg:lg1', url: '/x', items: [
      { title: 'A v B', body: '80–70', url: '/a', tag: 'result:A v B' },
      { title: 'C v D', body: '91–88', url: '/c', tag: 'result:C v D' },
      { title: 'E v F', body: '70–69', url: '/e', tag: 'result:E v F' }] },
    close() { this.closed = true; } }]);
  await push(four, P('G v H', '60–59'));
  eq('a fourth extends the pile rather than starting a second one',
     [four.shown.length, four.shown[0].title], [1, '4 updates in British Championship']);
  eq('...and every game is still listed', four.shown[0].options.data.items.length, 4);

  /* a replacement, not an addition */
  const again = loadSW([{ title: '3 updates in British Championship', body: 'x', tag: 'grp:lg:lg1',
    data: { group: 'lg:lg1', url: '/x', items: [
      { title: 'A v B', body: 'in 2 days', url: '/a', tag: 'fixture:A v B' },
      { title: 'C v D', body: '91–88', url: '/c', tag: 'result:C v D' },
      { title: 'E v F', body: '70–69', url: '/e', tag: 'result:E v F' }] },
    close() { this.closed = true; } }]);
  await push(again, P('A v B', 'tip-off in 2 hours', { tag: 'fixture:A v B', kind: 'fixture' }));
  eq('the 2-hour reminder takes the 2-day one\'s place — the pile does not grow',
     [again.shown[0].title, again.shown[0].options.data.items.length],
     ['3 updates in British Championship', 3]);
  eq('...and it is the newer wording that is listed',
     again.shown[0].options.data.items.map(i => i.body),
     ['91–88', '70–69', 'tip-off in 2 hours']);

  /* the cap */
  const many = loadSW([{ title: '8 updates', body: 'x', tag: 'grp:lg:lg1',
    data: { group: 'lg:lg1', url: '/x', items: Array.from({ length: 8 },
      (_, i) => ({ title: 'G' + i, body: 'b' + i, url: '/g' + i, tag: 't' + i })) },
    close() {} }]);
  await push(many, P('New', 'now'));
  const lines = many.shown[0].options.body.split('\n');
  eq('a long pile lists the most recent and counts the rest',
     [lines.length, lines[lines.length - 1]], [7, '…and 3 more']);
  ok('the cap is named too', many.W.GROUP_MAX === 6);
  eq('...but the pile itself keeps all of them', many.shown[0].options.data.items.length, 9);
}

/* ------------------------------------------------- 5. what is never folded --- */
console.log('\n5. what is never folded, and what must never be lost');
{
  const solo = loadSW([liveNote('A v B', '1'), liveNote('C v D', '2')]);
  await push(solo, { title: 'Epinoia', body: 'an announcement', url: '/epinoia/home/', kind: 'announcement' });
  eq('a notice with no pile of its own is itself, whatever else is on screen',
     [solo.shown.length, solo.shown[0].title], [1, 'Epinoia']);

  const other = loadSW([{ title: 'A v B', body: '1', tag: 'a', data: { group: 'lg:OTHER', url: '/a' }, close() { this.closed = true; } },
                        { title: 'C v D', body: '2', tag: 'c', data: { group: 'lg:OTHER', url: '/c' }, close() { this.closed = true; } }]);
  await push(other, P('E v F', '3'));
  eq('another league\'s pile is not this one\'s', [other.shown.length, other.shown[0].title], [1, 'E v F']);
  ok('...and is left alone on the screen', other.live.every(n => !n.closed));

  const blind = loadSW([]);
  blind.self.registration.getNotifications = async () => { throw new Error('not allowed'); };
  await push(blind, P('A v B', '80–70'));
  eq('a browser that will not say what is on screen still shows the notice',
     [blind.shown.length, blind.shown[0].title], [1, 'A v B']);

  const older = loadSW([]);
  delete older.self.registration.getNotifications;
  await push(older, P('A v B', '80–70'));
  eq('and so does one that cannot be asked at all',
     [older.shown.length, older.shown[0].title], [1, 'A v B']);

  ok('the worker version moved, so phones take the new one',
     /const SW_VERSION = 'notifications-v2-2026-09-18/.test(swSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
