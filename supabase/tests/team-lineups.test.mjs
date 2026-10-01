// THE CLUB PAGE'S LINEUPS (epinoia/t/teamwowy.js): the WOWY / Lineups page's own views for one club, in the club
// page's three lineup sections. The table that would not sort (a header lit up and nothing moved: the old list had no
// sort at all) is the WOWY page's list now, sorted by any column, again for the other way; what members get and
// what everyone keeps; the state; the links to the WOWY page; the page's wiring.
//   node supabase/tests/team-lineups.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

/* ------------------------------------------------------------ a fake page --- */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.title = ''; this.scrolled = 0;
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: k => props[k] };
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return { contains: c => list().includes(c), add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
             remove: c => { self.className = list().filter(x => x !== c).join(' '); } };
  }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  removeChild(n) { this.children = this.children.filter(c => c !== n); return n; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { const want = sel.split('.').filter(Boolean); return this.all().filter(n => want.every(c => n.classList.contains(c))); }
  scrollIntoView() { this.scrolled++; }
  get clientWidth() { return this._w || 1100; }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => new Text(t), querySelectorAll: () => [] };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.location = { href: 'https://example.org/epinoia/t/?t=cheshire-phoenix', search: '?t=cheshire-phoenix', pathname: '/epinoia/t/' };
const copied = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async t => { copied.push(t); } } } });

globalThis.EpinoiaLineups = require(path.join(root, 'epinoia', 'lineups.js'));
globalThis.EpinoiaLineupEvents = require(path.join(root, 'epinoia', 'lineupevents.js'));
globalThis.EpinoiaWowyLogic = require(path.join(root, 'epinoia', 'wowylogic.js'));
const W = globalThis.EpinoiaWowyLogic;
require(path.join(root, 'epinoia', 'stats', 'wowy', 'wowyui.js'));
const REAL_UI = globalThis.EpinoiaWowyUI;

/* ---------------------------------------------- the circles say where to go --- */
console.log('\nthe player circles link from wherever they are drawn');
{
  const meta = { p1: { name: 'Jordan Valge', jersey: '3' } };
  const a = REAL_UI.circle({ meta, team: { colour: '#1d3c6e' }, photos: {}, playerHref: id => '../p/?p=' + id }, { id: 'p1' });
  const b = REAL_UI.circle({ meta, team: { colour: '#1d3c6e' }, photos: {} }, { id: 'p1' });
  ok('a page that says where the players are (the club page, one folder down) is followed', a.href === '../p/?p=p1', a.href);
  ok('...and the WOWY page, two down, keeps its own', b.href === '../../p/?p=p1', b.href);
}

/* ---------- the views, recorded: what each section was drawn with, and when ---------- */
const drawn = [];
const spy = name => (ctx, host) => { drawn.push({ name, ctx, host }); host.textContent = ''; };
globalThis.EpinoiaWowyUI = Object.assign({}, REAL_UI, { wowyView: spy('wowy'), buildView: spy('build'), lineupsView: spy('lineups'), hydrate: () => {} });
require(path.join(root, 'epinoia', 't', 'teamwowy.js'));
const TW = globalThis.EpinoiaTeamWowy;

/* ---------------------------------------------------------- the pure rules --- */
console.log('\nthe state a visit opens on');
{
  const wide = TW.initialState('cheshire', {}, false), phone = TW.initialState('cheshire', {}, true);
  ok('a table where there is the room (the section always was one), cards on a phone', wide.lay === 'table' && phone.lay === 'cards');
  ok('...most used first, every minute, the WOWY page\'s sample thresholds', wide.sort === 'mins' && wide.dir === 'desc' && wide.vs === 'all' && wide.sz === 5 &&
     wide.mm === W.DEFAULT_THR.minMinutes && wide.mp === W.DEFAULT_THR.minPoss);
  const saved = TW.initialState('cheshire', { lay: 'cards', dm: 'values', mm: 4, mp: 8 }, false);
  ok('the reader\'s own reading where they chose one', saved.lay === 'cards' && saved.dm === 'values' && saved.mm === 4 && saved.mp === 8);
  const junk = TW.initialState('cheshire', { lay: 'grid', dm: 'x', mm: -3, mp: 'many' }, false);
  ok('...and nothing it does not know', junk.lay === 'table' && junk.dm === W.DEFAULT_STATE.dm && junk.mm === W.DEFAULT_THR.minMinutes && junk.mp === W.DEFAULT_THR.minPoss, junk);
}

console.log('\nwho sees what');
{
  const m = TW.gates(false, 1);
  ok('a member: the WOWY page\'s whole gate in every section', ['wowy', 'build', 'lineups'].every(v => !m[v].preview && m[v].events && m[v].sizes.length === 4 && m[v].matrixMax === 5));
  const g = TW.gates(true, 1);
  ok('without analytics, every five and the filter as the club page always had them', g.lineups.rows === Infinity && !g.lineups.preview && g.build.builder && g.build.players === 5);
  ok('...the play-by-play and the split by the opponent\'s five locked, units of two to four the members\'',
     !g.lineups.events && !g.build.events && g.lineups.sizes.join() === '5');
  ok('...and the combinations one player at a time, with the WOWY page\'s preview (as they were)', g.wowy.preview && g.wowy.matrixMax === 1 && !g.wowy.events);
}

console.log('\nwhich sections a change draws again');
ok('a sort, an order, a unit size or a with/without filter: the list only', ['sort', 'dir', 'best', 'sz', 'inc', 'exc'].every(k => TW.touched({ [k]: 1 }).join() === 'lineups'));
ok('the combinations\' players: theirs; the builder\'s: its', TW.touched({ w: [] }).join() === 'wowy' && TW.touched({ u: [] }).join() === 'build');
ok('how a list reads, the opponent split and the thresholds: all three', ['lay', 'dm', 'vs', 'mm', 'mp'].every(k => TW.touched({ [k]: 1 }).join() === 'wowy,build,lineups'));

/* ------------------------------------------------------ a club, mounted --- */
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ids = Array.from({ length: 9 }, (_, i) => '00000000-0000-4000-8000-0000000000' + String(i + 1).padStart(2, '0'));
const meta = Object.fromEntries(ids.map((id, i) => [id, { name: 'Player ' + 'ABCDEFGHI'[i], jersey: String(i + 1) }]));
const games = [], stints = [], other = [];
for (let g = 0; g < 8; g++) {
  const id = 'g' + g;
  games.push({ id, home_team_id: g % 2 ? 'T1' : 'T2', away_team_id: g % 2 ? 'T2' : 'T1', starters: null, period: 4, tipoff_at: '2026-09-' + String(10 + g).padStart(2, '0') + 'T19:00:00Z', finalised_at: null, competition_id: 'C1' });
  for (let s = 0; s < 6; s++) {
    const five = s === 0 ? ids.slice(0, 5) : ids.slice().sort(() => rnd() - 0.5).slice(0, 5);
    const b = () => ({ pts: 8 + Math.round(rnd() * 12), fga: 10, fgm: 4 + Math.round(rnd() * 4), f3m: 1, fta: 3, tov: 1 + Math.round(rnd() * 2), or: 1, dr: 4 });
    const off = b(), def = b();
    stints.push({ game_id: id, team_idx: g % 2 ? 0 : 1, player_ids: five, stats: { dur: (4 + Math.round(rnd() * 5)) * 60000, pf: off.pts, pa: def.pts, off, def } });
    other.push({ game_id: id, team_idx: g % 2 ? 1 : 0, player_ids: ['x1', 'x2', 'x3', 'x4', 'x5'], stats: { dur: 6 * 60000, pf: def.pts, pa: off.pts, off: def, def: off } });
  }
}
const asked = [];
globalThis.EpinoiaData = {
  all: async q => { asked.push(q); return /^games\?competition_id=in\.\(C1\)/.test(q) ? games : []; },
  stints: async gids => { asked.push('stints:' + gids.length); return stints.concat(other).filter(s => gids.indexOf(s.game_id) !== -1); },
  get: async q => { asked.push(q); return []; },
  teamMeta: async () => ({ T2: { name: 'Leicester Riders', teamShort: 'Leicester' } })
};
const hosts = { wowy: new El('div'), build: new El('div'), lineups: new El('div') };
const T = TW.mount({
  team: { id: 'T1', name: 'Cheshire Phoenix', short_name: 'Cheshire', slug: 'cheshire-phoenix', colour: '#1d3c6e' },
  league: { id: 'L1', slug: 'slb', name: 'SLB' }, games, stints: stints.slice(), meta, hosts, locked: false, previewMax: 1,
  compIds: ['C1'], season: '2026-27', base: '../', readLogs: undefined
});
const flush = () => new Promise(r => setTimeout(r, 0));
await flush(); await flush(); await flush();

console.log('\nthe three sections are the WOWY page\'s views');
{
  const names = drawn.map(d => d.name);
  ok('With or without is its combinations, the filter its builder, Every lineup its list', ['wowy', 'build', 'lineups'].every(n => names.includes(n)));
  ok('...each in its own section', drawn.find(d => d.name === 'wowy').host === hosts.wowy && drawn.find(d => d.name === 'build').host === hosts.build &&
     drawn.find(d => d.name === 'lineups').host === hosts.lineups);
  const lc = drawn.find(d => d.name === 'lineups').ctx;
  ok('the list is a table on a desktop, most used first', lc.state.lay === 'table' && lc.state.sort === 'mins' && lc.state.dir === 'desc');
  ok('the roster in minutes order, the club\'s colour, its players\' names', lc.rosterIds().length === 9 && lc.team.colour === '#1d3c6e' && lc.meta[ids[0]].name === 'Player A');
  ok('the play-by-play stats say they could not be read (no log reader here), never "reading..." for ever', lc.ev.status === 'error' && lc.evState() === 'ok');
  ok('under each: a line for "Copy link" and the way to the rest on the WOWY page',
     ['wowy', 'build', 'lineups'].every(v => hosts[v].querySelector('tlu-say') && hosts[v].querySelector('tlu-more')));
  const href = hosts.lineups.querySelector('tlu-more').href;
  ok('...that link opens this club, this season, this view', /^\.\.\/stats\/wowy\/\?/.test(href) && /[?&]l=slb/.test(href) && /[?&]s=2026-27/.test(href) &&
     /[?&]t=cheshire-phoenix/.test(href) && /[?&]v=lineups/.test(href), href);
}

console.log('\nthe sort (the bug: a header lit, the rows did not move)');
{
  const before = drawn.length;
  const lc = drawn.find(d => d.name === 'lineups').ctx;
  lc.go({ sort: 'ortg', dir: 'desc', best: '' });   // what a header's click asks for (wowyui lineupsView onSort)
  const after = drawn.slice(before).map(d => d.name);
  ok('a header click sorts the list by that column', lc.state.sort === 'ortg' && lc.state.dir === 'desc');
  ok('...and draws the list again, and only the list', after.join() === 'lineups', after);
  const rows = W.sortRows(lc.unitRows(5).map(r => Object.assign({}, r, { ortg: r.line.ortg, mins: r.line.mins, poss: r.line.poss })), 'ortg', 'desc', lc.thr, false);
  const v = rows.map(r => r.ortg).filter(x => typeof x === 'number');
  ok('...the units in that order, highest first', v.length > 3 && v.every((x, i) => i === 0 || v[i - 1] >= x), v.slice(0, 8));
  lc.go({ sort: 'ortg', dir: 'asc' });
  const up = W.sortRows(lc.unitRows(5).map(r => Object.assign({}, r, { ortg: r.line.ortg, mins: r.line.mins, poss: r.line.poss })), lc.state.sort, lc.state.dir, lc.thr, false).map(r => r.ortg).filter(x => typeof x === 'number');
  ok('...and the same header again the other way', lc.state.dir === 'asc' && up.every((x, i) => i === 0 || up[i - 1] <= x), up.slice(0, 8));
  ok('the sort goes into the WOWY page\'s address', /[?&]sort=ortg/.test(hosts.lineups.querySelector('tlu-more').href) && /[?&]dir=asc/.test(hosts.lineups.querySelector('tlu-more').href));
}

console.log('\nthe units, the rest of the team, the colours\' reference');
{
  const lc = drawn.find(d => d.name === 'lineups').ctx;
  const rows = lc.unitRows(5);
  const top = rows.slice().sort((a, b) => b.line.mins - a.line.mins)[0];
  ok('every five with its line and the rest of the team\'s', rows.length > 1 && rows.every(r => r.line && r.rest && r.ids.length === 5));
  ok('...the rest is the team\'s other minutes (the two make the whole)', Math.abs(top.line.mins + top.rest.mins - lc.rowFor([]).line.mins) < 0.2, [top.line.mins, top.rest.mins, lc.rowFor([]).line.mins]);
  ok('...and a small sample says so', rows.every(r => ['ok', 'thin', 'tiny'].includes(r.rel)));
  ok('the league\'s stints were read for the colours, once, for this season\'s competitions',
     asked.filter(q => /^games\?competition_id=in\.\(C1\)&status=eq\.final&select=/.test(q)).length === 1 && asked.some(q => /^stints:8$/.test(q)), asked);
  ok('...so the colours are measured against the league\'s units', /^the league’s \d+ five-man units/.test(lc.scaleNote(5)), lc.scaleNote(5));
  ok('the photos are asked for once, for the club\'s players', asked.filter(q => /^players\?id=in\./.test(q)).length === 1);
}

console.log('\n"Open in builder", "Open in WOWY" and the WOWY page\'s other views');
{
  const lc = drawn.find(d => d.name === 'lineups').ctx;
  const before = drawn.length;
  lc.go({ v: 'build', u: ids.slice(0, 5) });
  ok('a unit opened in the builder goes to the builder section, with the five in it', lc.state.u.length === 5 && drawn.slice(before).map(d => d.name).join() === 'build' && hosts.build.scrolled === 1);
  lc.go({ v: 'wowy', w: ids.slice(0, 3) });
  ok('...and in WOWY to the combinations', lc.state.w.length === 3 && hosts.wowy.scrolled === 1);
  lc.go({ v: 'onoff', p: ids[0] });
  ok('a view the club page has not got opens on the WOWY page', /stats\/wowy\/\?.*v=onoff/.test(globalThis.location.href) && /p=00000000/.test(globalThis.location.href), globalThis.location.href);
  globalThis.location.href = 'https://example.org/epinoia/t/?t=cheshire-phoenix';   // (a browser would have gone there)
  drawn.find(d => d.name === 'build').ctx.link();
  await flush();
  ok('"Copy link" copies the WOWY page\'s address for that section, whole', /^https:\/\/example\.org\/epinoia\/stats\/wowy\/\?/.test(copied[0] || '') && /[?&]v=build/.test(copied[0] || ''), copied);
}

console.log('\nwhat is kept on the device');
{
  const lc = drawn.find(d => d.name === 'lineups').ctx;
  ok('a sort is not kept (it is this visit\'s)', !store[TW.KEEP] || JSON.parse(store[TW.KEEP]).sort === undefined);
  lc.go({ lay: 'cards' });
  ok('the layout the reader picked is', JSON.parse(store[TW.KEEP]).lay === 'cards');
  ok('...and only what they picked (a default is not a choice)', !('dm' in JSON.parse(store[TW.KEEP])) && !('mm' in JSON.parse(store[TW.KEEP])), store[TW.KEEP]);
}

/* ------------------------------------------- without analytics, mounted --- */
console.log('\nwithout analytics');
{
  drawn.length = 0;
  const h2 = { wowy: new El('div'), build: new El('div'), lineups: new El('div') };
  let read = 0;
  TW.mount({ team: { id: 'T1', name: 'Cheshire Phoenix', slug: 'cheshire-phoenix', colour: '#1d3c6e' }, league: { id: 'L1', slug: 'slb' }, games, stints: stints.slice(), meta,
    hosts: h2, locked: true, previewMax: 1, compIds: ['C1'], base: '../', readLogs: async () => { read++; return { gs: [], byG: {}, sideOf: {} }; } });
  await flush();
  const lc = drawn.find(d => d.name === 'lineups').ctx, wc = drawn.find(d => d.name === 'wowy').ctx;
  ok('the play-by-play is never read for a preview', read === 0 && lc.ev.status === 'locked' && lc.evState() === 'locked');
  ok('the list has its own gate, the combinations the WOWY page\'s preview', lc.gate.rows === Infinity && wc.gate.preview && wc.gate.matrixMax === 1);
  lc.go({ vs: 'start' });
  ok('the opponent split stays at every minute', lc.state.vs === 'all');
}

/* ------------------------------------------------------------ the wiring --- */
console.log('\nthe club page');
{
  const page = read('epinoia', 't', 'index.html');
  const team = read('epinoia', 't', 'team.js');
  const pos = s => page.indexOf('src="' + s);   // the script tags themselves, not a mention in a comment
  ok('it loads the WOWY page\'s parts: the logic, the views, then this', pos('../wowylogic.js') > 0 && pos('../stats/wowy/wowyui.js') > pos('../wowylogic.js') && pos('teamwowy.js') > pos('../stats/wowy/wowyui.js'));
  ok('...after what they read when they load (lineups.js, lineupevents.js, the lock)', pos('../lineups.js') > 0 && pos('../lineups.js') < pos('../wowylogic.js') &&
     pos('../lineupevents.js') < pos('../stats/wowy/wowyui.js') && pos('../memlock.js') > 0 && pos('../memlock.js') < pos('teamwowy.js'));
  ok('...and before the page\'s script', pos('teamwowy.js') < pos('team.js?v='));
  ok('the old list and matrix are gone from this page (lineupui.js; wowy.js stays the player page\'s)', !/lineupui\.js/.test(page) && !/src="\.\.\/wowy\.js/.test(page));
  const sheet = s => page.indexOf('href="../' + s);
  ok('the WOWY page\'s sheet, before the teletext and legibility sheets', sheet('kit/wowy.css') > 0 && sheet('kit/wowy.css') < sheet('kit/teletext.css') && sheet('kit/wowy.css') < sheet('kit/legibility.css'));
  ok('the three sections, each a .tlu', /id="wowy" class="tlu/.test(page) && /id="lufilter" class="tlu/.test(page) && /id="lulist" class="tlu/.test(page));
  ok('the old panels\' rules are gone from the page', !/\.lu-chips\{|\.wowy-bar\{|\.tiles\{/.test(page));
  ok('team.js mounts it with the three sections, the gate and the page\'s own play-by-play',
     /TW\.mount\(\{/.test(team) && /hosts = \{ wowy: \$\('#wowy'\), build: \$\('#lufilter'\), lineups: \$\('#lulist'\) \}/.test(team) &&
     /locked: ACCESS\.locked/.test(team) && /readLogs: \(\) => seasonLogs\(team\), segCache/.test(team));
  ok('...reading the games with what the views need', /select=\$\{TW\.GAME_SELECT\}/.test(team) && /starters/.test(TW.GAME_SELECT) && /tipoff_at/.test(TW.GAME_SELECT));
  ok('...starting when the first of the three comes near', /whenNear\(\$\('#wowy'\) \|\| \$\('#lulist'\)/.test(team));
  ok('...and the season\'s name for the links', /SEASON_NAME = season\.name/.test(team) && /season: SEASON_NAME/.test(team));
  const css = read('epinoia', 'kit', 'teampage.css');
  ok('the switch and the empty box, for the lineups alone (the page cannot load kit/page.css)', /\.tlu \.pg-seg\{/.test(css) && /\.tlu \.pg-seg button\[aria-pressed="true"\]/.test(css) && /\.tlu \.pg-empty\{/.test(css));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
